# -*- coding: utf-8 -*-
"""H3 漫剧导演台 - 自定义节点
- H3DirectorTailFrame：从文件读取上一段尾帧（段间解耦的关键）
- H3DirectorMerge：ffmpeg 合并各段 mp4 为完整成片
"""
import os
import glob
import re

import numpy as np
import torch
from PIL import Image

import comfy.utils
import folder_paths
from comfy_api.latest import InputImpl, Types
from comfy_extras.nodes_upscale_model import ImageUpscaleWithModel

from .media_utils import extract_clean_tail_frame, merge_segment_videos, write_tail_frame_if_changed

CATEGORY = "H3导演台"
OUTPUT_DIR = folder_paths.get_output_directory()
VIDEO_DIR = os.path.join(OUTPUT_DIR, "video")
PROJECT_ROOT = os.path.join(VIDEO_DIR, "h3director")


def _log(msg):
    try:
        print(msg)
    except Exception:
        pass


def _latest(pattern):
    files = glob.glob(pattern)
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def _safe_project_id(value):
    value = re.sub(r"[^0-9A-Za-z_-]+", "_", str(value or "").strip())[:80].strip("_")
    return value


def _project_dir(project_id):
    project_id = _safe_project_id(project_id)
    return os.path.join(PROJECT_ROOT, project_id) if project_id else None


def _all_output_dirs():
    roots = [VIDEO_DIR]
    try:
        roots.extend(p for p in glob.glob(os.path.join(PROJECT_ROOT, "*")) if os.path.isdir(p))
    except OSError:
        pass
    return roots


def _tail_path(seg, project_id=""):
    exact = _project_dir(project_id)
    roots = [exact] if exact else _all_output_dirs()
    files = []
    for root in roots:
        files.extend(glob.glob(os.path.join(root, "tail_seg%d_*.png" % seg)))
    return max(files, key=os.path.getmtime) if files else None


def _merge_source_dir(project_id=""):
    exact = _project_dir(project_id)
    if exact:
        return exact
    candidates = []
    for root in _all_output_dirs():
        first = _latest(os.path.join(root, "漫剧_seg1_*.mp4"))
        if first:
            candidates.append((os.path.getmtime(first), root))
    return max(candidates)[1] if candidates else VIDEO_DIR


def _video_path(seg, project_id="", source_dir=None):
    root = source_dir or _project_dir(project_id) or _merge_source_dir("")
    return _latest(os.path.join(root, "漫剧_seg%d_*.mp4" % seg))


def _continuity_paths(seg, project_id=""):
    """把续接 PNG 与段视频固定解析到同一项目目录。

    旧工作流可能没有 ``project_id``。此前 tail 和 video 各自做一次全局“最新”查找，
    有机会分别命中项目 A/B，随后把 B 的尾帧覆盖写进 A。现在先以该段最新的续接
    资产（PNG 或 MP4）确定一个目录，再只在这个目录内解析两者。
    """
    exact = _project_dir(project_id)
    if exact:
        root = exact
    else:
        candidates = []
        for candidate_root in _all_output_dirs():
            tail = _latest(os.path.join(candidate_root, "tail_seg%d_*.png" % seg))
            video = _latest(os.path.join(candidate_root, "漫剧_seg%d_*.mp4" % seg))
            artifacts = [path for path in (tail, video) if path and os.path.isfile(path)]
            if artifacts:
                newest = max(artifacts, key=os.path.getmtime)
                candidates.append((os.path.getmtime(newest), candidate_root))
        root = max(candidates, key=lambda item: item[0])[1] if candidates else None
    if not root:
        return None, None, None
    tail = _latest(os.path.join(root, "tail_seg%d_*.png" % seg))
    video = _latest(os.path.join(root, "漫剧_seg%d_*.mp4" % seg))
    return tail, video, root


def _safe_output_stem(value):
    raw = str(value or "").strip()
    drive, _ = os.path.splitdrive(raw)
    if not raw or drive or os.path.isabs(raw) or ".." in raw or "/" in raw or "\\" in raw:
        raise ValueError("[H3导演台] 输出文件名只能是文件名，不能包含路径、盘符或 '..'")
    if raw.lower().endswith(".mp4"):
        raw = raw[:-4]
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", raw).strip(" ._")[:120]
    if not stem:
        raise ValueError("[H3导演台] 输出文件名为空或不合法")
    if re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", stem):
        raise ValueError("[H3导演台] 输出文件名是 Windows 保留设备名，请换一个名称")
    return stem


def _upscale_target_size(width, height, scale):
    scale = min(4.0, max(1.0, float(scale)))
    target_width = max(2, int(round(width * scale / 2.0)) * 2)
    target_height = max(2, int(round(height * scale / 2.0)) * 2)
    return target_width, target_height


def _upscale_progress_value(end, total):
    return min(9000, max(0, int(round(9000 * end / max(1, total)))))


def _resize_video_frames(images, width, height, batch_size, pbar=None):
    batches = []
    for start in range(0, images.shape[0], batch_size):
        batch = images[start:start + batch_size]
        resized = comfy.utils.common_upscale(
            batch.movedim(-1, 1), width, height, "lanczos", "disabled").movedim(1, -1)
        batches.append(resized)
        if pbar is not None:
            pbar.update_absolute(_upscale_progress_value(start + batch.shape[0], images.shape[0]))
    return torch.cat(batches, dim=0)


def _model_upscale_video_frames(upscale_model, images, width, height, batch_size, pbar=None):
    batches = []
    for start in range(0, images.shape[0], batch_size):
        batch = ImageUpscaleWithModel.execute(
            upscale_model, images[start:start + batch_size])[0]
        if batch.shape[2] != width or batch.shape[1] != height:
            batch = comfy.utils.common_upscale(
                batch.movedim(-1, 1), width, height, "lanczos", "disabled").movedim(1, -1)
        batches.append(batch)
        if pbar is not None:
            pbar.update_absolute(_upscale_progress_value(start + batch.shape[0], images.shape[0]))
    return torch.cat(batches, dim=0)


class H3DirectorTailFrame:
    """读取上一段保存的尾帧 PNG，作为本段的 <Picture 4> 参考图。
    可选输入"排序依赖"仅用于整图运行时保证先后顺序，不参与计算。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "上一段编号": ("INT", {"default": 1, "min": 1, "max": 999, "step": 1}),
                "project_id": ("STRING", {"default": ""}),
            },
            "optional": {
                "排序依赖": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("上一段尾帧",)
    FUNCTION = "load"
    CATEGORY = CATEGORY
    DESCRIPTION = "从指定导演台项目读取尾帧；project_id 留空时兼容旧目录并选择最新文件。"

    def load(self, 上一段编号, project_id="", 排序依赖=None):
        path, video_path, source_dir = _continuity_paths(上一段编号, project_id)
        if video_path and os.path.isfile(video_path):
            frame, info = extract_clean_tail_frame(video_path)
            if frame is None:
                reasons = []
                for item in (info.get("rejected") or [])[:2]:
                    reasons.extend((item.get("reasons") or [])[:1])
                raise RuntimeError(
                    "[H3导演台] 第%d段最后%d帧均未通过续接质量检查%s；"
                    "请重抽该段或关闭尾帧续接。"
                    % (上一段编号, int(info.get("checked") or 0),
                       "（%s）" % "；".join(reasons) if reasons else "")
                )
            if not path:
                path = os.path.join(source_dir or os.path.dirname(video_path),
                                    "tail_seg%d_00001_.png" % 上一段编号)
            write_tail_frame_if_changed(path, frame)
            fallback = int(info.get("fallback_frames") or 0)
            if fallback:
                _log("[H3导演台] 第%d段末帧异常，自动回退%d帧后续接" % (
                    上一段编号, fallback))
        if not path:
            raise FileNotFoundError(
                "[H3导演台] 找不到第%d段的尾帧文件（project_id=%s）。"
                "请先在导演台面板运行第%d段，或使用面板的「从视频续接」上传一段视频。"
                % (上一段编号, project_id or "自动", 上一段编号)
            )
        img = Image.open(path).convert("RGB")
        arr = np.asarray(img).astype(np.float32) / 255.0
        _log("[H3导演台] 段%d 尾帧 <- %s" % (上一段编号 + 1, os.path.basename(path)))
        return (torch.from_numpy(arr)[None,],)

    @classmethod
    def IS_CHANGED(cls, 上一段编号, project_id="", 排序依赖=None):
        path, video_path, _source_dir = _continuity_paths(上一段编号, project_id)
        if not path and not video_path:
            return "missing"
        parts = []
        for candidate in (path, video_path):
            if candidate and os.path.isfile(candidate):
                parts.append("%s|%d" % (candidate, os.stat(candidate).st_mtime_ns))
        return "||".join(parts) or "missing"


class H3DirectorMerge:
    """把 output/video/漫剧_seg1..N 的最新 mp4 按顺序合并成一个成片。
    可选输入 seg_1..seg_6 仅用于整图运行时排在各段之后执行，不参与计算。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "段数": ("INT", {"default": 6, "min": 2, "max": 999, "step": 1}),
                "输出文件名": ("STRING", {"default": "漫剧_60s_合并"}),
                "project_id": ("STRING", {"default": ""}),
            },
            "optional": {
                "seg_1": ("VIDEO",), "seg_2": ("VIDEO",), "seg_3": ("VIDEO",),
                "seg_4": ("VIDEO",), "seg_5": ("VIDEO",), "seg_6": ("VIDEO",),
            },
        }

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "merge"
    CATEGORY = CATEGORY
    DESCRIPTION = "用 ffmpeg 拼接指定导演台项目的创作界面分段；project_id 留空时自动选择最近项目。"

    def merge(self, 段数, 输出文件名, project_id="", **kwargs):
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        output_stem = _safe_output_stem(输出文件名)
        source_dir = _merge_source_dir(project_id)

        vids = []
        missing = []
        for i in range(1, 段数 + 1):
            p = _video_path(i, project_id, source_dir=source_dir)
            if p:
                vids.append(p)
            else:
                missing.append(i)
        if missing:
            _log("[H3导演台] 缺少段 %s 的视频，本次不合并。" % ",".join(map(str, missing)))
            return ()

        os.makedirs(source_dir, exist_ok=True)
        out = os.path.join(source_dir, output_stem + ".mp4")
        merge_segment_videos(ffmpeg, vids, out, source_dir)
        _log("[H3导演台] 合并完成 -> %s" % out)
        return ()

    @classmethod
    def IS_CHANGED(cls, 段数, 输出文件名, project_id="", **kwargs):
        source_dir = _merge_source_dir(project_id)
        sig = []
        for i in range(1, 段数 + 1):
            p = _video_path(i, project_id, source_dir=source_dir)
            sig.append(str(os.path.getmtime_ns(p)) if p else "x")
        return "%s|%s" % (_safe_output_stem(输出文件名), "|".join(sig))


class H3DirectorVideoUpscale:
    """独立视频后处理；不接入或改变 H3 的生成采样链。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO",),
                "mode": (["AI模型超分", "Lanczos普通放大"],),
                "output_scale": ("FLOAT", {"default": 2.0, "min": 1.0, "max": 4.0, "step": 0.5}),
                "frame_batch_size": ("INT", {"default": 4, "min": 1, "max": 32, "step": 1}),
                "filename_prefix": ("STRING", {"default": "video/h3director/upscale/H3超分"}),
            },
            "optional": {
                "upscale_model": ("UPSCALE_MODEL",),
            },
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("video",)
    FUNCTION = "upscale"
    CATEGORY = "H3导演台/后期处理"
    OUTPUT_NODE = True
    DESCRIPTION = "独立视频超分并保存 MP4；保留原音频、帧率和时长，不改变 H3 采样。"

    def upscale(self, video, mode, output_scale, frame_batch_size, filename_prefix,
                upscale_model=None):
        components = video.get_components()
        images = components.images
        if not isinstance(images, torch.Tensor) or images.ndim != 4 or images.shape[0] < 1:
            raise ValueError("[H3导演台] 输入视频没有可处理的画面帧")
        target_width, target_height = _upscale_target_size(
            int(images.shape[2]), int(images.shape[1]), output_scale)
        batch_size = min(32, max(1, int(frame_batch_size)))
        pbar = comfy.utils.ProgressBar(10000)
        pbar.update_absolute(0)
        if mode == "AI模型超分":
            if upscale_model is None:
                raise ValueError("[H3导演台] AI模型超分需要连接 UPSCALE_MODEL；普通放大可不连接模型")
            output_images = _model_upscale_video_frames(
                upscale_model, images, target_width, target_height, batch_size, pbar=pbar)
        elif mode == "Lanczos普通放大":
            output_images = _resize_video_frames(
                images, target_width, target_height, batch_size, pbar=pbar)
        else:
            raise ValueError("[H3导演台] 不支持的超分模式: %s" % mode)

        output_video = InputImpl.VideoFromComponents(Types.VideoComponents(
            images=output_images,
            audio=components.audio,
            frame_rate=components.frame_rate,
        ), bit_depth=video.get_bit_depth())
        prefix = str(filename_prefix or "").strip()
        if not prefix:
            raise ValueError("[H3导演台] 超分输出文件名不能为空")
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            prefix, folder_paths.get_output_directory(), target_width, target_height)
        file = "%s_%05d_.mp4" % (filename, counter)
        output_path = os.path.join(full_output_folder, file)
        try:
            pbar.update_absolute(9300)
            output_video.save_to(
                output_path, format=Types.VideoContainer.MP4,
                codec=Types.VideoCodec.H264, crf=18.0)
        except Exception:
            try:
                os.remove(output_path)
            except OSError:
                pass
            raise
        pbar.update_absolute(10000)
        _log("[H3导演台] 视频超分完成 %dx%d -> %s" % (
            target_width, target_height, output_path))
        return {
            "ui": {"images": [{
                "filename": file,
                "subfolder": subfolder,
                "type": "output",
                "format": "video/mp4",
            }], "animated": (True,), "h3_upscale": [{
                "mode": mode,
                "source_width": int(images.shape[2]),
                "source_height": int(images.shape[1]),
                "output_width": target_width,
                "output_height": target_height,
            }]},
            "result": (output_video,),
        }


NODE_CLASS_MAPPINGS = {
    "H3DirectorTailFrame": H3DirectorTailFrame,
    "H3DirectorMerge": H3DirectorMerge,
    "H3DirectorVideoUpscale": H3DirectorVideoUpscale,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "H3DirectorTailFrame": "导演台·上一段尾帧",
    "H3DirectorMerge": "导演台·合并成片",
    "H3DirectorVideoUpscale": "导演台·视频超分",
}
