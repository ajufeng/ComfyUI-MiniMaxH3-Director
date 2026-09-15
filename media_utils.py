# -*- coding: utf-8 -*-
"""H3 导演台的媒体写出/合并工具。

这个模块刻意不依赖 ComfyUI，方便用独立的合成视频做回归测试。
"""
import os
import shutil
import subprocess
import tempfile
import threading


MERGE_AUDIO_RATE = 32000
MERGE_FPS = 24
_MERGE_LOCKS = {}
_MERGE_LOCKS_GUARD = threading.Lock()

# 续接尾帧默认只检查最后约 1 秒。窗口太小会漏掉连续两三帧损坏，窗口太大则会把
# 正常的镜头运动误当成异常，也会增加上传长视频时的解码开销。
TAIL_SCAN_FRAMES = 24
TAIL_QUALITY_VERSION = 1


def enforce_continuity_start(frames_u8, anchor_u8, bridge_frames=8):
    """把上一段真实尾帧确定性写入下一段开头，并在固定帧数内平滑回到模型输出。

    FL2VA 的首帧条件在极限加速链（Turbo LoRA / TE-Speed / 注意力补丁）下仍可能
    被采样结果明显偏离。这里不改变帧数、时长或音频，只修改开头最多 8 帧：
    第 0 帧等于上一段尾帧，最后一帧完全回到原生成帧，中间做短促线性过渡。
    """
    import numpy as np
    from PIL import Image

    if frames_u8 is None or anchor_u8 is None:
        return frames_u8
    if not isinstance(frames_u8, np.ndarray) or frames_u8.ndim != 4 or frames_u8.shape[-1] != 3:
        raise ValueError("连续性桥接需要 [N,H,W,3] 视频帧")
    if len(frames_u8) < 1:
        return frames_u8
    anchor = np.asarray(anchor_u8)
    if anchor.ndim == 4:
        anchor = anchor[0]
    if anchor.ndim != 3 or anchor.shape[-1] != 3:
        raise ValueError("连续性尾帧需要 [H,W,3] 图像")
    anchor = np.clip(anchor, 0, 255).astype(np.uint8, copy=False)
    target_h, target_w = frames_u8.shape[1:3]
    if anchor.shape[:2] != (target_h, target_w):
        resampling = getattr(Image, "Resampling", Image)
        anchor = np.asarray(Image.fromarray(anchor).resize(
            (target_w, target_h), resampling.LANCZOS), dtype=np.uint8)

    count = min(len(frames_u8), max(1, int(bridge_frames)))
    if count == 1:
        frames_u8[0] = anchor
        return frames_u8
    anchor_f = anchor.astype(np.float32)
    for index in range(count):
        alpha = index / float(count - 1)
        if index == 0:
            frames_u8[index] = anchor
        elif index < count - 1:
            current = frames_u8[index].astype(np.float32)
            frames_u8[index] = np.rint(anchor_f * (1.0 - alpha) + current * alpha).astype(np.uint8)
        # index == count - 1 时 alpha=1，保留模型原始帧，避免多余复制。
    return frames_u8


def _tail_quality_sample(frame, size=96):
    """返回平滑缩略图和保留原像素高频的稀疏统计。

    单用 BILINEAR 缩到 96×96 会把 720p/1080p 随机花屏平均成近灰色，从而漏检。
    时序/明暗判断仍使用平滑缩略图；花屏/棋盘格判断则在原图上稀疏抽取相邻像素，
    只处理约 96×96 个采样点，不复制整张高分辨率图。
    """
    import numpy as np
    from PIL import Image

    arr = np.asarray(frame)
    if arr.ndim == 4 and arr.shape[0] == 1:
        arr = arr[0]
    if arr.ndim != 3 or arr.shape[-1] < 3 or arr.shape[0] < 2 or arr.shape[1] < 2:
        raise ValueError("尾帧必须是 [H,W,3] RGB 图像")
    arr = arr[..., :3]
    if np.issubdtype(arr.dtype, np.floating):
        finite = np.isfinite(arr)
        if not bool(finite.all()):
            raise ValueError("尾帧包含 NaN/Inf")
        scale = 255.0 if float(arr.max(initial=0.0)) <= 1.5 else 1.0
        arr = np.rint(np.clip(arr * scale, 0.0, 255.0)).astype(np.uint8)
    else:
        arr = np.clip(arr, 0, 255).astype(np.uint8, copy=False)
    resampling = getattr(Image, "Resampling", Image)
    smooth = np.asarray(Image.fromarray(arr, "RGB").resize(
        (int(size), int(size)), resampling.BILINEAR), dtype=np.uint8)

    height, width = arr.shape[:2]
    sample_h = max(1, min(int(size), height - 1))
    sample_w = max(1, min(int(size), width - 1))
    ys = np.linspace(0, height - 2, sample_h, dtype=np.intp)
    xs = np.linspace(0, width - 2, sample_w, dtype=np.intp)
    base = arr[ys[:, None], xs[None, :], :3].astype(np.float32)
    right = arr[ys[:, None], (xs + 1)[None, :], :3].astype(np.float32)
    down = arr[(ys + 1)[:, None], xs[None, :], :3].astype(np.float32)

    def gray(rgb):
        return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722

    base_gray = gray(base)
    detail = {
        "std": float(base_gray.std()),
        "spatial": 0.5 * (
            float(np.abs(base_gray - gray(right)).mean())
            + float(np.abs(base_gray - gray(down)).mean())
        ),
        "chroma": float((base.max(axis=2) - base.min(axis=2)).mean()),
        "clipped": float(((base_gray <= 2.0) | (base_gray >= 253.0)).mean()),
    }
    return smooth, detail


def _tail_frame_metrics(sample, detail=None):
    """返回低成本、可解释的画面统计；不依赖模型或 GPU。"""
    import numpy as np

    rgb = sample.astype(np.float32)
    gray = (rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722)
    dx = np.abs(gray[:, 1:] - gray[:, :-1])
    dy = np.abs(gray[1:, :] - gray[:-1, :])
    spatial = 0.5 * (float(dx.mean()) + float(dy.mean()))
    channel_range = rgb.max(axis=2) - rgb.min(axis=2)
    result = {
        "mean": float(gray.mean()),
        "std": float(gray.std()),
        "spatial": spatial,
        "chroma": float(channel_range.mean()),
        "clipped": float(((gray <= 2.0) | (gray >= 253.0)).mean()),
    }
    detail = detail or result
    result.update({
        "detail_std": float(detail["std"]),
        "detail_spatial": float(detail["spatial"]),
        "detail_chroma": float(detail["chroma"]),
        "detail_clipped": float(detail["clipped"]),
    })
    return result


def _tail_frame_delta(left, right):
    """小图 RGB 平均绝对差；比逐像素全分辨率比较更省内存。"""
    import numpy as np

    return float(np.abs(left.astype(np.float32) - right.astype(np.float32)).mean())


def _tail_static_reasons(metrics):
    """只拒绝非常确定的单帧损坏，避免把正常黑场、白场或像素风误删。"""
    reasons = []
    # 随机彩噪、棋盘格和大面积花屏通常同时具有极高空间跳变及亮度/色彩离散度。
    spatial = metrics.get("detail_spatial", metrics["spatial"])
    std = metrics.get("detail_std", metrics["std"])
    chroma = metrics.get("detail_chroma", metrics["chroma"])
    if spatial >= 72.0 and (std >= 52.0 or chroma >= 52.0):
        reasons.append("高频花屏/彩噪")
    if spatial >= 60.0 and chroma >= 68.0:
        reasons.append("彩色棋盘格/条纹")
    # 缩略采样会平滑随机噪点，但整屏彩噪仍会留下异常高的平均通道跨度。
    if chroma >= 82.0 and spatial >= 36.0 and std >= 34.0:
        reasons.append("整屏彩色噪点")
    return reasons


def select_clean_tail_frame(frames, max_backtrack=TAIL_SCAN_FRAMES):
    """从最后一帧开始向前寻找可用于续接的正常帧。

    返回 ``(frame_or_none, info)``。检测采用空间统计和最近历史帧的保守时序对比：
    正常镜头运动、渐黑/渐白不会仅因亮度改变而被拒绝；突发黑白坏帧、随机彩噪、
    棋盘格或相对前序画面异常爆炸的帧会依次回退 N-1、N-2……。
    """
    import numpy as np

    if frames is None:
        return None, {"ok": False, "checked": 0, "reason": "没有视频帧"}
    try:
        total = int(len(frames))
    except (TypeError, ValueError):
        total = 0
    if total < 1:
        return None, {"ok": False, "checked": 0, "reason": "没有视频帧"}

    window = max(1, min(int(max_backtrack or TAIL_SCAN_FRAMES), total))
    start = total - window
    originals = []
    samples = []
    metrics = []
    invalid = {}
    for local_index, frame in enumerate(frames[start:total]):
        originals.append(frame)
        try:
            sample, detail = _tail_quality_sample(frame)
            samples.append(sample)
            metrics.append(_tail_frame_metrics(sample, detail))
        except Exception as error:
            samples.append(None)
            metrics.append(None)
            invalid[local_index] = str(error)

    rejected = []
    for local_index in range(window - 1, -1, -1):
        absolute_index = start + local_index
        sample = samples[local_index]
        metric = metrics[local_index]
        reasons = []
        if sample is None or metric is None:
            reasons.append("无法解析: %s" % invalid.get(local_index, "无效帧"))
        else:
            reasons.extend(_tail_static_reasons(metric))
            history_start = max(0, local_index - 5)
            history = [samples[i] for i in range(history_start, local_index)
                       if samples[i] is not None]
            history_metrics = [metrics[i] for i in range(history_start, local_index)
                               if metrics[i] is not None]
            if history:
                history_stack = np.stack(history).astype(np.float32)
                history_median = np.median(history_stack, axis=0).astype(np.uint8)
                history_delta = _tail_frame_delta(sample, history_median)
                pair_deltas = [_tail_frame_delta(history[i], history[i - 1])
                               for i in range(1, len(history))]
                baseline = float(np.median(pair_deltas)) if pair_deltas else 0.0
                temporal_limit = max(68.0, baseline * 3.5 + 18.0)
                history_std = float(np.median([m["std"] for m in history_metrics]))
                history_spatial = float(np.median([
                    m.get("detail_spatial", m["spatial"]) for m in history_metrics]))
                history_clipped = float(np.median([m["clipped"] for m in history_metrics]))
                previous_metric = metrics[local_index - 1] if local_index > 0 else None
                previous_sample = samples[local_index - 1] if local_index > 0 else None
                previous_delta = (_tail_frame_delta(sample, previous_sample)
                                  if previous_sample is not None else history_delta)

                # 单独的纯黑/纯白帧常见于解码/生成末尾异常；渐变过程因 delta 较小会保留。
                blank_like = ((metric["mean"] <= 3.0 or metric["mean"] >= 252.0)
                              and metric["std"] <= 5.0)
                previous_far_from_blank = bool(previous_metric) and (
                    (metric["mean"] <= 3.0 and previous_metric["mean"] >= 45.0)
                    or (metric["mean"] >= 252.0 and previous_metric["mean"] <= 210.0))
                if (blank_like and history_std >= 8.0 and history_delta >= 14.0
                        and (previous_far_from_blank or previous_delta >= 30.0)):
                    reasons.append("突发黑帧/白帧")
                if (metric["std"] <= 1.0 and history_std >= 8.0 and history_delta >= 14.0
                        and previous_metric is not None and previous_metric["std"] >= 10.0
                        and previous_delta >= 24.0):
                    reasons.append("突发单色帧")
                if (metric["clipped"] >= 0.985 and history_clipped <= 0.70
                        and history_delta >= 18.0 and previous_delta >= 26.0):
                    reasons.append("大面积过曝/欠曝跳变")
                # 不能仅凭“与上一帧差异很大”拒绝：正常硬切、闪回和高速甩镜也会产生
                # 极高 MAD。只有同时出现异常边缘/噪点结构时才把时序离群作为花屏证据。
                # 边缘密度突然暴涨是花屏/马赛克的强信号；要求同时出现明显时序跳变。
                metric_spatial = metric.get("detail_spatial", metric["spatial"])
                metric_std = metric.get("detail_std", metric["std"])
                metric_chroma = metric.get("detail_chroma", metric["chroma"])
                if (metric_spatial >= max(34.0, history_spatial * 3.0 + 8.0)
                        and history_delta >= max(26.0, min(temporal_limit,
                                                          baseline * 2.0 + 10.0))
                        and (metric_std >= 38.0 or metric_chroma >= 42.0)):
                    reasons.append("边缘密度与时序差异同时突增，疑似花屏")

        # 去重，保证日志和接口返回简洁稳定。
        reasons = list(dict.fromkeys(reasons))
        if not reasons:
            selected = np.asarray(originals[local_index])
            if selected.ndim == 4 and selected.shape[0] == 1:
                selected = selected[0]
            if np.issubdtype(selected.dtype, np.floating):
                scale = 255.0 if float(selected.max(initial=0.0)) <= 1.5 else 1.0
                selected = np.rint(np.clip(selected * scale, 0.0, 255.0)).astype(np.uint8)
            else:
                selected = np.clip(selected, 0, 255).astype(np.uint8, copy=False)
            return selected[..., :3].copy(), {
                "ok": True,
                "quality_version": TAIL_QUALITY_VERSION,
                "total_frames": total,
                "selected_index": absolute_index,
                "fallback_frames": total - 1 - absolute_index,
                "checked": len(rejected) + 1,
                "rejected": rejected,
                "metrics": metric,
            }
        rejected.append({"index": absolute_index, "reasons": reasons, "metrics": metric})

    return None, {
        "ok": False,
        "quality_version": TAIL_QUALITY_VERSION,
        "total_frames": total,
        "checked": window,
        "rejected": rejected,
        "reason": "最后%d帧均未通过续接质量检查" % window,
    }


def extract_clean_tail_frame(video_path, max_backtrack=TAIL_SCAN_FRAMES):
    """只解码视频尾部小窗口并选择正常帧；元数据/seek 异常时退回顺序解码。"""
    from collections import deque
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        return None, {"ok": False, "checked": 0, "reason": "无法打开视频"}
    declared = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    window = max(1, int(max_backtrack or TAIL_SCAN_FRAMES))
    frames = []
    base_index = 0
    try:
        if declared > 0:
            seek_index = max(0, declared - window)
            base_index = seek_index
            cap.set(cv2.CAP_PROP_POS_FRAMES, seek_index)
            ring = deque(maxlen=window)
            decoded = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                ring.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                decoded += 1
            frames = list(ring)
            base_index = seek_index + max(0, decoded - len(frames))
            if decoded:
                declared = max(declared, seek_index + decoded)
    finally:
        cap.release()

    # 某些可变帧率/损坏索引视频会错误报告 frame_count 或无法尾部 seek。
    if not frames:
        ring = deque(maxlen=window)
        cap = cv2.VideoCapture(video_path)
        count = 0
        try:
            while cap.isOpened():
                ok, frame = cap.read()
                if not ok:
                    break
                ring.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                count += 1
        finally:
            cap.release()
        frames = list(ring)
        base_index = max(0, count - len(frames))
        declared = count

    selected, info = select_clean_tail_frame(frames, max_backtrack=window)
    if info.get("selected_index") is not None:
        info["selected_index"] = base_index + int(info["selected_index"])
        info["total_frames"] = declared or (base_index + len(frames))
        info["fallback_frames"] = max(0, int(info["total_frames"]) - 1
                                      - int(info["selected_index"]))
    info["source"] = os.path.realpath(video_path)
    return selected, info


def write_tail_frame_if_changed(path, frame):
    """原子写入 PNG；内容相同则不碰 mtime，避免无意义地使段缓存失效。"""
    import numpy as np
    from PIL import Image

    arr = np.asarray(frame)
    if arr.ndim != 3 or arr.shape[-1] < 3:
        raise ValueError("尾帧必须是 [H,W,3]")
    arr = np.clip(arr[..., :3], 0, 255).astype(np.uint8, copy=False)
    try:
        if os.path.isfile(path):
            old = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
            if old.shape == arr.shape and bool(np.array_equal(old, arr)):
                return False
    except (OSError, ValueError):
        pass
    os.makedirs(os.path.dirname(os.path.realpath(path)), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="_h3_tail_", suffix=".png",
                                     dir=os.path.dirname(os.path.realpath(path)))
    os.close(fd)
    try:
        Image.fromarray(arr, "RGB").save(temp_path, format="PNG")
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass
    return True


def lossless_tail_is_current(tail_path, video_path):
    """Return True when ``tail_path`` is the lossless tail written for ``video_path``.

    Segment rendering writes the final MP4 first and then writes the selected tail directly
    from the decoded model RGB frames as PNG.  Therefore a valid tail belonging to the current
    segment is at least as new as its MP4.  Re-decoding that MP4 and overwriting the PNG would
    unnecessarily introduce H.264/YUV420 compression loss into the next generation segment.

    If the video is replaced or rerolled later its mtime becomes newer, so callers must rescan
    the new video.  Filesystems with coarse timestamp resolution can report equal mtimes; equal
    is safe because the renderer always commits the video before the PNG.
    """
    try:
        if not os.path.isfile(tail_path) or not os.path.isfile(video_path):
            return False
        tail_stat = os.stat(tail_path)
        video_stat = os.stat(video_path)
        return tail_stat.st_size > 0 and tail_stat.st_mtime_ns >= video_stat.st_mtime_ns
    except OSError:
        return False


def _merge_lock_for(output_path):
    """同一目标成片只允许一个合并任务写入，避免并发重抽/手动合并互相覆盖。"""
    key = os.path.normcase(os.path.realpath(output_path))
    with _MERGE_LOCKS_GUARD:
        lock = _MERGE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _MERGE_LOCKS[key] = lock
        return lock


def run_command(command, **kwargs):
    """运行二进制命令，失败时保留末尾错误信息。"""
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode != 0:
        error = (result.stderr or b"").decode("utf-8", "ignore")
        raise RuntimeError("ffmpeg 失败: " + error[-1800:])
    return result


def has_audio_stream(ffmpeg, path):
    result = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True)
    text = (result.stderr or b"").decode("utf-8", "ignore")
    return "Audio:" in text


def video_info(path):
    """返回 (width, height, fps, duration)，使用 OpenCV 避免依赖 ffprobe。"""
    import cv2

    cap = cv2.VideoCapture(path)
    try:
        if not cap.isOpened():
            raise RuntimeError("无法打开段视频: " + path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or MERGE_FPS)
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    finally:
        cap.release()
    if width < 2 or height < 2 or fps <= 0 or frames <= 0:
        raise RuntimeError("段视频元数据无效: " + path)
    return width, height, fps, max(1.0 / fps, frames / fps)


def stable_audio_filter(source, output, duration, sample_rate=MERGE_AUDIO_RATE, fade_seconds=0.012):
    """构造统一的安全音频尾链。

    - 固定 32kHz 双声道，避免分段采样率/声道不同；
    - async + first_pts 修正时间戳漂移；
    - 20Hz 高通去除解码直流偏置，保守限幅并关闭自动增益，给 AAC 编码留余量；
    - 12ms 首尾淡化消除段边界点击声；
    - apad + atrim 让音轨长度严格等于画面。
    """
    duration = max(0.05, float(duration))
    fade = min(max(0.0, float(fade_seconds)), duration / 4.0)
    fade_out = max(0.0, duration - fade)
    return (
        "[%s]aresample=%d:async=1:first_pts=0,"
        "aformat=sample_rates=%d:channel_layouts=stereo,"
        "highpass=f=20,alimiter=limit=0.90:level=0:latency=1,"
        "afade=t=in:st=0:d=%.4f,afade=t=out:st=%.4f:d=%.4f,"
        "apad,atrim=0:%.6f[%s]"
        % (source, sample_rate, sample_rate, fade, fade_out, fade, duration, output)
    )


def _concat_quote(path):
    return path.replace("\\", "/").replace("'", "'\\''")


def _merge_segment_videos_unlocked(ffmpeg, paths, output_path, work_dir=None,
                                   fps=MERGE_FPS, audio_rate=MERGE_AUDIO_RATE):
    """把当前各段的已验收版本稳定合并成一个 MP4。

    每段先统一画布、帧率、H.264 参数和音频参数；没有音轨的段自动补等长静音。
    最后只做无损 concat，因此即使某一段被重新抽卡覆盖，也会按最新文件重新合成。
    """
    paths = [os.path.realpath(path) for path in paths]
    if not paths:
        raise ValueError("没有可合并的段视频")
    for path in paths:
        if not os.path.isfile(path):
            raise FileNotFoundError("找不到段视频: " + path)

    # 单段项目不需要“规范化 -> PCM 中间文件 -> AAC 再编码 -> concat”。段文件本身已经
    # 是导演台验收后的最终 H.264/AAC 成片，直接原子复制可保持画面与声音逐字节不变，
    # 同时避免一次完整视频转码、一次 AAC 有损压缩和相应的 CPU/内存等待。
    output_real = os.path.realpath(output_path)
    if len(paths) == 1:
        if paths[0] == output_real:
            return output_path
        work_dir = work_dir or os.path.dirname(output_real)
        os.makedirs(work_dir, exist_ok=True)
        fd, temp_output = tempfile.mkstemp(prefix="_h3_merged_single_", suffix=".mp4", dir=work_dir)
        os.close(fd)
        try:
            shutil.copyfile(paths[0], temp_output)
            os.replace(temp_output, output_path)
            temp_output = None
            return output_path
        finally:
            if temp_output:
                try:
                    os.remove(temp_output)
                except OSError:
                    pass

    first_w, first_h, _, _ = video_info(paths[0])
    target_w = max(2, first_w - first_w % 2)
    target_h = max(2, first_h - first_h % 2)
    work_dir = work_dir or os.path.dirname(os.path.realpath(output_path))
    os.makedirs(work_dir, exist_ok=True)
    normalized = []
    durations = []
    listfile = None
    temp_output = None
    try:
        for index, path in enumerate(paths, 1):
            _, _, _, duration = video_info(path)
            durations.append(duration)
            audio_present = has_audio_stream(ffmpeg, path)
            fd, normalized_path = tempfile.mkstemp(
                prefix="_h3_norm_%03d_" % index, suffix=".mkv", dir=work_dir)
            os.close(fd)
            normalized.append(normalized_path)

            command = [ffmpeg, "-y", "-i", path]
            audio_source = "0:a"
            if not audio_present:
                command += [
                    "-f", "lavfi", "-t", "%.6f" % duration,
                    "-i", "anullsrc=r=%d:cl=stereo" % audio_rate,
                ]
                audio_source = "1:a"
            video_filter = (
                "[0:v]fps=%d,"
                "scale=%d:%d:force_original_aspect_ratio=decrease,"
                "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,"
                "setsar=1,format=yuv420p[v]"
                % (fps, target_w, target_h, target_w, target_h)
            )
            audio_filter = stable_audio_filter(audio_source, "a", duration, audio_rate)
            command += [
                "-filter_complex", video_filter + ";" + audio_filter,
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-g", str(fps * 2), "-keyint_min", str(fps * 2), "-sc_threshold", "0",
                # 中间文件使用无损 PCM，避免每一段 AAC 的 encoder padding 在 concat 后累积，
                # 也避免“段文件 AAC -> 规范化 AAC -> 最终 AAC”的重复有损压缩。
                # Matroska 能稳定承载 H.264 + float PCM，最终完整视频只编码一次 AAC。
                "-c:a", "pcm_f32le", "-ar", str(audio_rate), "-ac", "2",
                "-t", "%.6f" % duration,
                normalized_path,
            ]
            run_command(command)

        fd, listfile = tempfile.mkstemp(prefix="_h3_concat_", suffix=".txt", dir=work_dir)
        os.close(fd)
        with open(listfile, "w", encoding="utf-8") as handle:
            for path in normalized:
                handle.write("file '%s'\n" % _concat_quote(path))

        fd, temp_output = tempfile.mkstemp(prefix="_h3_merged_", suffix=".mp4", dir=work_dir)
        os.close(fd)
        total_duration = sum(durations)
        final_audio_filter = stable_audio_filter("0:a", "a", total_duration, audio_rate)
        run_command([
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", listfile,
            "-filter_complex", final_audio_filter,
            "-map", "0:v:0", "-map", "[a]",
            "-c:v", "copy",
            "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp",
            "-b:a", "192k", "-ar", str(audio_rate), "-ac", "2",
            "-movflags", "+faststart", "-t", "%.6f" % total_duration,
            temp_output,
        ])
        os.replace(temp_output, output_path)
        temp_output = None
        return output_path
    finally:
        for path in normalized + [listfile, temp_output]:
            if not path:
                continue
            try:
                os.remove(path)
            except OSError:
                pass


def _merge_segment_videos_with_post_unlocked(ffmpeg, paths, output_path, work_dir,
                                             fps, audio_rate, post):
    paths = [os.path.realpath(path) for path in paths]
    if not paths:
        raise ValueError("没有可合并的段视频")
    for path in paths:
        if not os.path.isfile(path):
            raise FileNotFoundError("找不到段视频: " + path)

    transition = str(post.get("transition") or "cut").lower()
    if transition not in ("cut", "fade", "dissolve"):
        raise ValueError("不支持的段间转场: " + transition)
    try:
        requested_transition_duration = float(post.get("transition_duration") or 0.5)
    except (TypeError, ValueError):
        raise ValueError("转场时长必须是数字")
    if not 0.1 <= requested_transition_duration <= 2.0:
        raise ValueError("转场时长必须在 0.1～2 秒之间")
    try:
        bgm_volume = float(post.get("bgm_volume") if post.get("bgm_volume") is not None else 0.18)
    except (TypeError, ValueError):
        raise ValueError("背景音乐音量必须是数字")
    bgm_volume = min(1.0, max(0.0, bgm_volume))
    subtitle_path = os.path.realpath(post["subtitle_path"]) if post.get("subtitle_path") else ""
    bgm_path = os.path.realpath(post["bgm_path"]) if post.get("bgm_path") else ""
    if subtitle_path and not os.path.isfile(subtitle_path):
        raise FileNotFoundError("找不到字幕文件: " + subtitle_path)
    if bgm_path and not os.path.isfile(bgm_path):
        raise FileNotFoundError("找不到背景音乐: " + bgm_path)

    first_w, first_h, _, _ = video_info(paths[0])
    target_w = max(2, first_w - first_w % 2)
    target_h = max(2, first_h - first_h % 2)
    work_dir = work_dir or os.path.dirname(os.path.realpath(output_path))
    os.makedirs(work_dir, exist_ok=True)
    durations = [video_info(path)[3] for path in paths]
    transition_duration = min(
        requested_transition_duration,
        min(durations) / 3.0 if len(paths) > 1 else requested_transition_duration,
    )
    normalized = []
    listfile = None
    assembled = None
    temp_output = None
    subtitle_copy = None
    try:
        for index, (path, duration) in enumerate(zip(paths, durations)):
            audio_present = has_audio_stream(ffmpeg, path)
            fd, normalized_path = tempfile.mkstemp(
                prefix="_h3_post_norm_%03d_" % (index + 1), suffix=".mkv", dir=work_dir)
            os.close(fd)
            normalized.append(normalized_path)
            command = [ffmpeg, "-y", "-i", path]
            audio_source = "0:a"
            if not audio_present:
                command += [
                    "-f", "lavfi", "-t", "%.6f" % duration,
                    "-i", "anullsrc=r=%d:cl=stereo" % audio_rate,
                ]
                audio_source = "1:a"
            video_filter = (
                "[0:v]fps=%d,scale=%d:%d:force_original_aspect_ratio=decrease,"
                "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black,"
                "setsar=1,settb=AVTB,format=yuv420p"
                % (fps, target_w, target_h, target_w, target_h)
            )
            if transition == "fade" and index > 0:
                video_filter += ",fade=t=in:st=0:d=%.6f:color=black" % transition_duration
            if transition == "fade" and index + 1 < len(paths):
                video_filter += ",fade=t=out:st=%.6f:d=%.6f:color=black" % (
                    max(0.0, duration - transition_duration), transition_duration)
            video_filter += "[v]"
            smoothing_fade = 0.024 if post.get("audio_smoothing", True) else 0.012
            if transition == "fade":
                smoothing_fade = max(smoothing_fade, transition_duration)
            audio_filter = stable_audio_filter(
                audio_source, "a", duration, audio_rate, fade_seconds=smoothing_fade)
            command += [
                "-filter_complex", video_filter + ";" + audio_filter,
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-g", str(fps * 2), "-keyint_min", str(fps * 2), "-sc_threshold", "0",
                "-c:a", "pcm_f32le", "-ar", str(audio_rate), "-ac", "2",
                "-t", "%.6f" % duration, normalized_path,
            ]
            run_command(command)

        fd, assembled = tempfile.mkstemp(prefix="_h3_post_assembled_", suffix=".mkv", dir=work_dir)
        os.close(fd)
        if transition == "dissolve" and len(normalized) > 1:
            command = [ffmpeg, "-y"]
            for path in normalized:
                command += ["-i", path]
            filters = []
            video_source = "0:v"
            audio_source = "0:a"
            elapsed = durations[0]
            for index in range(1, len(normalized)):
                video_output = "vx%d" % index
                audio_output = "ax%d" % index
                offset = elapsed - transition_duration
                filters.append(
                    "[%s][%d:v]xfade=transition=fade:duration=%.6f:offset=%.6f[%s]"
                    % (video_source, index, transition_duration, offset, video_output))
                filters.append(
                    "[%s][%d:a]acrossfade=d=%.6f:c1=tri:c2=tri[%s]"
                    % (audio_source, index, transition_duration, audio_output))
                video_source = video_output
                audio_source = audio_output
                elapsed += durations[index] - transition_duration
            run_command(command + [
                "-filter_complex", ";".join(filters),
                "-map", "[%s]" % video_source, "-map", "[%s]" % audio_source,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                "-pix_fmt", "yuv420p", "-c:a", "pcm_f32le",
                "-ar", str(audio_rate), "-ac", "2", "-t", "%.6f" % elapsed,
                assembled,
            ])
            total_duration = elapsed
        else:
            fd, listfile = tempfile.mkstemp(prefix="_h3_post_concat_", suffix=".txt", dir=work_dir)
            os.close(fd)
            with open(listfile, "w", encoding="utf-8") as handle:
                for path in normalized:
                    handle.write("file '%s'\n" % _concat_quote(path))
            run_command([
                ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", listfile,
                "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", assembled,
            ])
            total_duration = sum(durations)

        fd, temp_output = tempfile.mkstemp(prefix="_h3_post_final_", suffix=".mp4", dir=work_dir)
        os.close(fd)
        command = [ffmpeg, "-y", "-i", assembled]
        if bgm_path:
            command += ["-stream_loop", "-1", "-i", bgm_path]
        audio_filters = []
        if bgm_path:
            audio_filters.extend([
                "[0:a]aresample=%d:async=1:first_pts=0,aformat=sample_rates=%d:channel_layouts=stereo[dialogue]"
                % (audio_rate, audio_rate),
                "[1:a]aresample=%d:async=1:first_pts=0,aformat=sample_rates=%d:channel_layouts=stereo,"
                "atrim=0:%.6f,asetpts=PTS-STARTPTS,volume=%.4f[music]"
                % (audio_rate, audio_rate, total_duration, bgm_volume),
                "[music][dialogue]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=450[ducked]",
                "[dialogue][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]",
                stable_audio_filter("mixed", "aout", total_duration, audio_rate),
            ])
        else:
            audio_filters.append(stable_audio_filter("0:a", "aout", total_duration, audio_rate))
        command += ["-filter_complex", ";".join(audio_filters), "-map", "0:v:0", "-map", "[aout]"]

        if subtitle_path:
            suffix = os.path.splitext(subtitle_path)[1].lower()
            fd, subtitle_copy = tempfile.mkstemp(prefix="_h3_post_subtitle_", suffix=suffix, dir=work_dir)
            os.close(fd)
            shutil.copyfile(subtitle_path, subtitle_copy)
            subtitle_name = os.path.basename(subtitle_copy).replace("'", "\\'")
            command += ["-vf", "subtitles=filename='%s'" % subtitle_name,
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                        "-pix_fmt", "yuv420p"]
        else:
            command += ["-c:v", "copy"]
        command += [
            "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp",
            "-b:a", "192k", "-ar", str(audio_rate), "-ac", "2",
            "-movflags", "+faststart", "-t", "%.6f" % total_duration, temp_output,
        ]
        run_command(command, cwd=work_dir)
        os.replace(temp_output, output_path)
        temp_output = None
        return output_path
    finally:
        for path in normalized + [listfile, assembled, temp_output, subtitle_copy]:
            if not path:
                continue
            try:
                os.remove(path)
            except OSError:
                pass


def merge_segment_videos(ffmpeg, paths, output_path, work_dir=None,
                         fps=MERGE_FPS, audio_rate=MERGE_AUDIO_RATE, post=None):
    """串行化同一输出路径的合并，并在完成后原子替换正式成片。"""
    with _merge_lock_for(output_path):
        if isinstance(post, dict) and post.get("enabled"):
            return _merge_segment_videos_with_post_unlocked(
                ffmpeg, paths, output_path, work_dir, fps, audio_rate, post)
        return _merge_segment_videos_unlocked(
            ffmpeg, paths, output_path, work_dir=work_dir, fps=fps, audio_rate=audio_rate)
