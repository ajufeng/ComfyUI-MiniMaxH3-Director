# -*- coding: utf-8 -*-
"""H3 漫剧导演台·一体节点（H3DirectorStudio）
单节点内部完成多段编排：编码参考图+提示词 → 采样 → 解码 → 存段视频/尾帧 → 合并。
常量、工具函数与异常类见 studio_core.py（本模块通过 import * 引入）。
"""
from .studio_core import *  # noqa: F401,F403

class H3DirectorStudio:
    """漫剧导演台·一体节点。segments_json 由节点内时间轴 UI 维护：
    [{"prompt": str, "seed": int, "refs": [input图片文件名...], "duration": float(秒，可省),
      "inherit_shared": bool, "use_tail": bool,
      "first_frame_mode": "none|previous_tail|custom", "first_frame": str, "last_frame": str,
      "enabled": bool, "force": bool}, ...]
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
                "audio_vae": ("VAE",),
                "width": ("INT", {"default": 832, "min": 32, "max": 4096, "step": 32}),
                "height": ("INT", {"default": 480, "min": 32, "max": 4096, "step": 32}),
                "时长秒": ("FLOAT", {"default": 10.0, "min": 2.0, "max": 15.0, "step": 1.0}),
                "steps": ("INT", {"default": 25, "min": 1, "max": 200, "step": 1}),
                "sampler": (comfy.samplers.SAMPLER_NAMES,),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES,),
                "ref_image_size": (["match", "max"],),
                "segments_json": ("STRING", {"default": "[]", "multiline": True, "hidden": True}),
                "vsegments_json": ("STRING", {"default": "[]", "multiline": True, "hidden": True}),
                "tsegments_json": ("STRING", {"default": "[]", "multiline": True, "hidden": True}),
                "ui_mode": ("STRING", {"default": "create", "hidden": True}),
                "global_prompt": ("STRING", {"default": "", "multiline": True, "hidden": True}),
                # 兼容旧工作流的隐藏字段：续接方式根据可用模型自动决定；
                # 旧工作流兼容槽位；功能已删除，后端始终忽略其值。
                "续接方式": (["硬首帧FL2VA(不跳帧)", "软参考Ref2VA(保人物)"], {"hidden": True}),
                "每段后卸载模型": ("BOOLEAN", {"default": False, "hidden": True}),
                # 末尾空字符串只用于兼容从 2.13.x 升级、尚未被前端迁移的旧工作流。
                # 默认仍是第一项；前端加载后会立即把空值改成“仅预览帧”。
                "汇总输出": (["仅预览帧(推荐)", "完整帧和音频(高内存)", ""],
                             {"default": "仅预览帧(推荐)", "hidden": True}),
                "project_id": ("STRING", {"default": "", "hidden": True}),
                "text_shared_refs_json": ("STRING", {"default": "[]", "multiline": True, "hidden": True}),
            },
            "hidden": {
                "h3_prompt_graph": "PROMPT",
                "h3_unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "INT", "STRING")
    RETURN_NAMES = ("images", "audio", "fps", "frame_count", "report")
    FUNCTION = "direct"
    CATEGORY = CATEGORY
    OUTPUT_NODE = True
    DESCRIPTION = "一体式多段漫剧导演台。段间文件接力，配置未变的段自动跳过。"

    # ---------------- 单段生成 ----------------
    def _prepare_segment_condition(self, seg_idx, seg_cfg, shared_refs, clip, vae, audio_vae,
                      width, height, default_dur, ref_image_size, mode="create",
                      global_prompt="", tail_mode="ref2v", project_id="default",
                      primary_model_kind="unknown", total_segments=1,
                      preserve_tail_visual_style=True):
        run_started = time.monotonic()
        # 0) 计算本段时长与帧数（缺失时用节点默认时长），帧数对齐 ≡5 (mod 17)
        # 段级分辨率覆盖（v2.8）：每段视频尺寸可不同；留空=跟随节点宽高
        _wo = int(seg_cfg.get("width") or 0)
        _ho = int(seg_cfg.get("height") or 0)
        if _wo >= 256 and _ho >= 256:
            width, height = _wo, _ho
        source_width, source_height = int(width), int(height)
        target_width, target_height = source_width, source_height
        second_sample = _normalize_second_sample_config(seg_cfg.get("second_sample"), mode)
        second_sample_model_name = ""
        if second_sample["mode"] != "off":
            second_sample_model_name = _second_sample_model_name(
                second_sample.get("upscaler_model"),
                second_sample.get("legacy_upscaler_model") is True)
            second_sample["upscaler_model"] = second_sample_model_name
            second_sample.pop("legacy_upscaler_model", None)
            target_width, target_height = _second_sample_target_size(
                second_sample, source_width, source_height)
            second_sample["final_width"] = target_width
            second_sample["final_height"] = target_height
            second_sample["actual_target_megapixels"] = (
                target_width * target_height / 1_000_000.0)
            width, height = _second_sample_first_pass_size(
                target_width, target_height, second_sample["first_megapixels"])
            if (target_width <= width or target_height <= height
                    or target_width * target_height <= width * height):
                raise ValueError(
                    "[H3导演台] 段%d二采目标 %dx%d 必须在宽、高和总像素上都严格大于首采 %dx%d；"
                    "请提高目标分辨率或降低首采像素" % (
                        seg_idx, target_width, target_height, width, height))
            _log("[H3导演台] 段%d缺陷修复二采：首采 %dx%d -> 修复 %dx%d" % (
                seg_idx, width, height, target_width, target_height))
        dur = _integer_segment_duration(seg_cfg.get("duration", default_dur))
        length = _segment_frame_count(dur)
        _log("[H3导演台] 段%d 请求时长 %d 秒 -> %d 帧" % (seg_idx, dur, length))
        task = _select_h3_task(primary_model_kind)
        first_frame_mode = _segment_first_frame_mode(seg_cfg)
        custom_first_frame, target_last_frame = _segment_keyframe_names(seg_cfg)
        ignored_hard_keyframes = task != "fl2va" and bool(custom_first_frame or target_last_frame)
        if ignored_hard_keyframes:
            _log("[H3导演台] 提示：段%d设置了官方硬首帧/目标尾帧，当前模型为 Ref2VA；"
                 "本次忽略硬关键帧并继续生成。" % seg_idx)

        # 1) 组装参考图（顺序决定 <Picture N> 编号，1 起始）：
        #    共享参考图(可选继承) -> 上一段尾帧(可选) -> 本段 refs
        #    内容完全相同的图自动去重（避免共享图和 refs 重复投喂）
        use_ref2va_material = primary_model_kind != "fl2va"
        ref_images = {}
        included = []
        pic_no = 1
        requested_image_references = 0

        def _push(img):
            nonlocal pic_no
            for old in included:
                if _is_same_image(old, img):
                    _log("[H3导演台] 跳过重复参考图（内容相同）")
                    return False
            ref_images["ref_image_%d" % (pic_no - 1)] = img
            included.append(img)
            pic_no += 1
            return True

        if use_ref2va_material and seg_cfg.get("inherit_shared", True):
            for img in shared_refs:
                if img is not None:
                    requested_image_references += 1
                    _push(img)
        tail_note = ""
        # v2.13.16：续接方式——硬首帧FL2VA 时上段尾帧作 first_frame 喂 ImageToVideo（像素级续接不跳帧），
        # 不进 ref_images（该段人物参考图/参考音频随之失效，人物靠尾帧传递）；软参考 Ref2VA 为原行为。
        first_frame_tensor = None
        last_frame_tensor = None
        continuity_anchor_u8 = None
        tail_picture_no = None
        keyframe_mode = "已忽略硬关键帧（当前模型为 Ref2VA）" if ignored_hard_keyframes else "无"
        use_previous_tail = first_frame_mode == "previous_tail"
        tail_is_fl2v = task == "fl2va" and use_previous_tail and seg_idx > 1
        if use_previous_tail and seg_idx > 1:
            tp = _seg_tail(seg_idx - 1, mode, project_id)
            if os.path.exists(tp):
                img = Image.open(tp).convert("RGB")
                arr = np.asarray(img).astype(np.float32) / 255.0
                if tail_is_fl2v:
                    first_frame_tensor = torch.from_numpy(arr)[None,]
                    continuity_anchor_u8 = np.asarray(img, dtype=np.uint8).copy()
                    tail_note = " + 段%d尾帧(FL2VA首帧)" % (seg_idx - 1)
                    keyframe_mode = "上段尾帧作为首帧"
                else:
                    requested_image_references += 1
                    next_picture_no = pic_no
                    if _push(torch.from_numpy(arr)[None,]):
                        tail_picture_no = next_picture_no
                        tail_note = " + 段%d尾帧(Picture %d)" % (seg_idx - 1, tail_picture_no)
                        keyframe_mode = "上段尾帧软参考"
            else:
                _log("[H3导演台] 警告：段%d 的尾帧不存在，段%d 将无续接参考" % (seg_idx - 1, seg_idx))
                tail_is_fl2v = False
        elif custom_first_frame and task == "fl2va":
            try:
                first_frame_tensor = _load_input_image(custom_first_frame)
            except Exception as e:
                raise ValueError("[H3导演台] 段%d自定义首帧加载失败 %s: %s" % (
                    seg_idx, custom_first_frame, e)) from e
            keyframe_mode = "自定义首帧"
            tail_note = " + 自定义首帧"
        if target_last_frame and task == "fl2va":
            try:
                last_frame_tensor = _load_input_image(target_last_frame)
            except Exception as e:
                raise ValueError("[H3导演台] 段%d目标尾帧加载失败 %s: %s" % (
                    seg_idx, target_last_frame, e)) from e
            keyframe_mode = (keyframe_mode + " + 目标尾帧") if keyframe_mode != "无" else "目标尾帧"
            tail_note += " + 目标尾帧"
        for name in (seg_cfg.get("refs") or []) if use_ref2va_material else []:
            requested_image_references += 1
            try:
                _push(_load_input_image(name))
            except Exception as e:
                _log("[H3导演台] 参考图加载失败 %s: %s" % (name, e))

        _log("[H3导演台] ==== 段%d 开始生成（参考图 %d 张%s）====" % (seg_idx, len(ref_images), tail_note))

        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

        # 本段自定义音频解析（三种用法见下：ref 驱动 / replace 替换 / mix 混合）
        custom_audio = None
        aname = seg_cfg.get("audio")
        if aname:
            candidate = _resolve_input(aname)
            if os.path.exists(candidate):
                custom_audio = candidate
            else:
                _log("[H3导演台] 警告：段%d 的音频文件不存在 %s，将使用 H3 原声" % (seg_idx, aname))

        # 参考音频（H3 最多 3 路独立 ref_audios）。两类来源按序占编号：
        #   1) 本段音频的「参考音频驱动」模式（复刻/复刻+环境音/仅音色）
        #   2) 参考音色槽 voice_refs（多角色音色，如唐僧音色给人物1 说新台词）
        # 关键（MiniMax 官方 R2V 提示词指南）：模型是否"用"参考音频取决于提示词里
        # 声明的保留关系——fully_copy=1:1 复用整轨；partially_copy=复用对话层+
        # 模型补环境音；reference=只学音色。不声明模型会忽略参考音频（实测踩坑）。
        ref_audios = {}
        audio_decls = []  # 每路一路："copy" | "partial" | "timbre" | "voice"
        if not use_ref2va_material and seg_cfg.get("audio_src") == "ref":
            custom_audio = None
        if use_ref2va_material and seg_cfg.get("audio_src") == "ref" and custom_audio:
            try:
                ref_audios["ref_audio_%d" % len(ref_audios)] = _load_audio_for_ref(custom_audio, seg_cfg, ffmpeg)
                custom_audio = None  # 音轨由模型生成/复用，事后不再替换
                if seg_cfg.get("audio_ref_mode", "copy") == "timbre":
                    audio_decls.append("timbre")
                elif seg_cfg.get("audio_ref_ambient"):
                    audio_decls.append("partial")
                else:
                    audio_decls.append("copy")
                _log("[H3导演台] 段%d 使用参考音频驱动（%s，占 <Audio 1>）" % (seg_idx, audio_decls[-1]))
            except Exception as e:
                _log("[H3导演台] 参考音频加载失败，回退 H3 原声: %s" % e)

        voice_modes = seg_cfg.get("voice_modes") or {}
        for vn in [n for n in (seg_cfg.get("voice_refs") or []) if n] if use_ref2va_material else []:
            if len(ref_audios) >= 3:
                _log("[H3导演台] 参考音频已达 3 路上限，音色 %s 被忽略" % vn)
                break
            vp = _resolve_input(vn)
            if not os.path.exists(vp):
                _log("[H3导演台] 警告：参考音色文件不存在 %s" % vn)
                continue
            try:
                ref_audios["ref_audio_%d" % len(ref_audios)] = _load_audio_for_ref(vp, {}, ffmpeg)
                # dub=对口型配音（该角色照这段音频说台词）；voice=只学音色（v1.10 槽级切换）
                audio_decls.append("dub" if voice_modes.get(vn) == "copy" else "voice")
            except Exception as e:
                _log("[H3导演台] 参考音色加载失败 %s: %s" % (vn, e))
        if audio_decls:
            _log("[H3导演台] 段%d 参考音频共 %d 路: %s" % (seg_idx, len(ref_audios), ",".join(audio_decls)))
        if not ref_audios:
            ref_audios = None

        # ---- 参考视频（v2.0 视频界面）：白模→成片 / 照片人物替换视频人物 ----
        # H3 原生 ref_videos：帧序列进 VAE + Qwen 按 2fps 带时间戳"看"视频，
        # 提示词里用 <Video N> 引用；ref_video_audio_N 按索引与 ref_video_N 配对。
        ref_videos = {}
        ref_video_audios = {}
        ref_video_modes = []
        requested_video_refs = [n for n in (seg_cfg.get("video_refs") or []) if n]
        for source_index, vn in enumerate(requested_video_refs if use_ref2va_material else []):
            if len(ref_videos) >= 3:
                _log("[H3导演台] 参考视频已达 3 路上限，%s 被忽略" % vn)
                break
            vp = _resolve_input(vn)
            if not os.path.exists(vp):
                _log("[H3导演台] 警告：参考视频不存在 %s" % vn)
                continue
            try:
                vframes, vaudio = _load_video_for_ref(vp, ffmpeg, seg_cfg)
                idx = len(ref_videos)
                ref_videos["ref_video_%d" % idx] = vframes
                if vaudio is not None:
                    ref_video_audios["ref_video_audio_%d" % idx] = vaudio
                ref_video_modes.append(_video_reference_mode(seg_cfg, vn, source_index))
                _log("[H3导演台] 段%d 参考视频 <Video %d>: %s（%d 帧%s）" % (
                    seg_idx, idx + 1, vn, vframes.shape[0],
                    "，已发送原音轨" if vaudio else "，仅参考画面、不发送原音轨"))
            except Exception as e:
                _log("[H3导演台] 参考视频加载失败 %s: %s" % (vn, e))
        if not ref_videos:
            ref_videos = None
            ref_video_audios = None

        seg_prompt = _compose_segment_prompt(
            global_prompt,
            seg_cfg.get("prompt", ""),
            use_tail=use_previous_tail,
            seg_idx=seg_idx,
            tail_picture_no=tail_picture_no,
            hard_first_frame=first_frame_tensor is not None,
            total_segments=total_segments,
            preserve_tail_visual_style=preserve_tail_visual_style,
        )
        prompt = _convert_at_refs(seg_prompt)
        reference_image_count = len(ref_images)
        prompt, removed_picture_numbers = _normalize_prompt_picture_references(
            prompt, reference_image_count)
        if removed_picture_numbers:
            _log("[H3导演台] 段%d 已移除超出实际参考图数量的 Picture 引用：%s（实际 %d 张）" % (
                seg_idx, ",".join(map(str, removed_picture_numbers)), reference_image_count))
        orig_prompt = prompt  # 声明跳过判定必须看用户原文，不能被自动追加的声明干扰
        has_ref2va_material = bool(reference_image_count or ref_audios or ref_videos)
        is_create_direct_picture = mode == "create" and bool(seg_cfg.get("asset_only_prompt_import"))
        _unused_prefix, prompt_fields = _split_official_prompt_fields(prompt)
        is_complete_ref2va = all(name in prompt_fields for name in (
            "subject_definitions", "summary", "retention_analysis", "detailed_description",
            "overall_soundscape", "non_diegetic_music"))
        reference_prompt_mode = "official-ref2va" if is_complete_ref2va else "plain"
        if use_ref2va_material and has_ref2va_material:
            if is_create_direct_picture and not is_complete_ref2va:
                reference_prompt_mode = "direct-picture"
            else:
                prompt = _ensure_official_ref2va_prompt(prompt, reference_image_count, force=True)
                reference_prompt_mode = "official-ref2va"
        extra_subjects = []
        extra_retentions = []
        extra_details = []
        if ref_audios:
            # 按官方 R2V 结构为每路音频生成声明。
            # 跳过条件（v1.14.1 修正）：只有提示词里真的写了【保留声明】才跳过——
            # 模板/AI 生成的提示词只含 <Audio 1> 绑定句（is the dialogue of...）却没有
            # retention_analysis，若仅按标签跳过会丢掉 fully_copy 声明，模型就自由发挥
            # 不复用音频（实测：模板生成的段音轨与配音相关性≈0，本 bug 的根因）。
            user_declared = (("retention_analysis" in orig_prompt and "<Audio" in orig_prompt)
                             or "fully_copy" in orig_prompt)
            defs, rets, dets = [], [], []
            for k, kind in enumerate(audio_decls, 1):
                tag = "<Audio %d>" % k
                if user_declared and kind != "voice":
                    continue
                if kind == "copy":
                    defs.append("%s is the dialogue source and voice reference for the main speaker (S%d)." % (tag, k))
                    rets.append("%s: fully_copy - %s is reused 1:1 as the target video's complete final audio track." % (tag, tag))
                    dets.append("The main speaker (S%d) performs exactly the lines from %s, lip movements precisely synchronized with %s." % (k, tag, tag))
                elif kind == "partial":
                    defs.append("%s is the dialogue source and voice reference for the main speaker (S%d)." % (tag, k))
                    rets.append("%s: partially_copy - the dialogue layer of %s is reused 1:1 as the target's dialogue track; ambient sounds, sound effects and music are newly generated around it." % (tag, tag))
                    dets.append("The main speaker (S%d) performs exactly the lines from %s with lip movements precisely synchronized, while ambient sounds and effects are generated naturally." % (k, tag))
                elif kind == "timbre":
                    defs.append("%s is the voice-timbre reference for the main speaker (S%d)." % (tag, k))
                    rets.append("%s: reference - the target speaker follows %s's voice timbre and delivery without copying the original signal." % (tag, tag))
                    dets.append("The main speaker (S%d) speaks the lines described above using the voice timbre referenced from %s." % (k, tag))
                elif kind == "dub":
                    # 对口型配音槽（v1.10+）：该说话人照 <Audio k> 说台词、口型同步（partially_copy）。
                    # 双人对话：两个 dub 槽各占一路，(S1)/(S2) 各自绑定各自的配音。
                    defs.append("%s is the dialogue source for speaker (S%d)." % (tag, k))
                    rets.append("%s: partially_copy - the dialogue lines of %s are reused 1:1 as speaker (S%d)'s lines in the target video." % (tag, tag, k))
                    dets.append("Speaker (S%d) performs exactly the lines from %s, lip movements precisely synchronized with %s." % (k, tag, tag))
                else:  # voice 音色槽：只声明音色归属，台词由提示词指定
                    defs.append("%s is the voice-timbre reference for speaker (S%d)." % (tag, k))
                    rets.append("%s: reference - speaker (S%d)'s voice follows %s's timbre and delivery without copying the original signal." % (tag, k, tag))
            if defs:
                extra_subjects.extend(defs)
                extra_retentions.extend(rets)
                extra_details.extend(dets)
            # v1.10：overall_soundscape 自动追加已移除——实测参考音频条件下模型不生成
            # 环境音，该行无效；「H3 环境音」勾选 UI 同步下架。
        # 参考视频声明（v2.0）：官方 reference 关系——动作/运镜/节奏跟 <Video N>，
        # 外观（人物长相/画风/场景）来自参考图和提示词。
        # 跳过条件（v2.5.1 修正，与音频 v1.14.1 同款）：只有用户原文里同时出现
        # retention_analysis 和 <Video 标签（=真的手写了视频保留声明）才跳过；
        # 只写 <Video 1> 引用句不算——否则自动声明被吞，模型不跟视频（实测踩坑）。
        _user_decl_video = ("retention_analysis" in orig_prompt) and ("<Video" in orig_prompt)
        if ref_videos and not _user_decl_video:
            vtags = ["<Video %d>" % (k + 1) for k in range(len(ref_videos))]
            extra_subjects.extend("%s is the source video." % tag for tag in vtags)
            for tag, mode in zip(vtags, ref_video_modes):
                assigned = VIDEO_REFERENCE_MODES[mode]
                extra_retentions.append(
                    "%s: reference - use only %s from %s; do not copy identities, costumes,"
                    " locations or visual style from that video." % (tag, assigned, tag))
            extra_details.append(
                "Combine the assigned purpose of each source video into one coherent result; all identities,"
                " costumes, locations and visual style come from the reference images and the prompt."
                " Do not let one source video override another source video's assigned purpose.")
        if use_ref2va_material and has_ref2va_material:
            prompt = _merge_official_ref2va_entries(
                prompt, extra_subjects, extra_retentions, extra_details)
        def _condition(condition_prompt, condition_width, condition_height):
            if task == "fl2va":
                return MiniMaxH3ImageToVideo.execute(
                    clip, vae, condition_prompt, condition_width, condition_height, length,
                    first_frame=first_frame_tensor, last_frame=last_frame_tensor)
            return MiniMaxH3ReferenceToVideo.execute(
                clip=clip, vae=vae, audio_vae=audio_vae, prompt=condition_prompt,
                width=condition_width, height=condition_height, length=length,
                ref_image_size=ref_image_size, ref_images=ref_images, ref_audios=ref_audios,
                ref_videos=ref_videos, ref_video_audios=ref_video_audios)

        if task == "fl2va":
            reference_prompt_mode = "fl2va"
        first_condition_started = time.monotonic()
        out = _condition(prompt, width, height)
        # v2.13.5：容错解包——新版 ComfyUI 内核的 H3 节点 result 可能返回 3+ 个值，
        # 按索引取前两个，避免 "too many values to unpack (expected 2)"。
        _res = out.result
        cond, latent = _res[0], _res[1]
        condition_image_reference_blocks = _count_condition_image_reference_blocks(cond)
        if task != "fl2va" and (requested_image_references != reference_image_count
                                or reference_image_count != condition_image_reference_blocks):
            _log("[H3导演台] 段%d参考图片计数不一致：请求%d张，成功加载%d张，条件图像块%d个；继续生成" % (
                seg_idx, requested_image_references, reference_image_count,
                condition_image_reference_blocks))
        first_condition_done = time.monotonic()
        repair_conditioning = None
        repair_condition_image_reference_blocks = 0
        repair_conditioning_time = 0.0
        if second_sample["mode"] != "off":
            repair_condition_started = time.monotonic()
            repair_condition_prompt = "%s\n\nrepair_instruction:\n%s" % (
                prompt, second_sample["repair_prompt"])
            repair_out = _condition(
                repair_condition_prompt, target_width, target_height)
            repair_result = repair_out.result
            repair_conditioning, repair_latent = repair_result[0], repair_result[1]
            repair_condition_image_reference_blocks = _count_condition_image_reference_blocks(
                repair_conditioning)
            del repair_out, repair_result, repair_latent
            repair_conditioning_time = time.monotonic() - repair_condition_started
        conditioning_done = time.monotonic()
        del out, _res, ref_images, ref_audios, ref_videos, ref_video_audios, included
        del first_frame_tensor, last_frame_tensor

        return cond, latent, {
            "width": target_width,
            "height": target_height,
            "first_pass_width": width,
            "first_pass_height": height,
            "second_sample": second_sample,
            "second_sample_model_name": second_sample_model_name,
            "requested_duration": dur,
            "frames": length,
            "picture_references": reference_image_count,
            "requested_image_references": requested_image_references,
            "loaded_image_references": reference_image_count,
            "condition_image_reference_blocks": condition_image_reference_blocks,
            "repair_condition_image_reference_blocks": repair_condition_image_reference_blocks,
            "repair_conditioning": repair_conditioning,
            "reference_prompt_mode": reference_prompt_mode,
            "keyframe_mode": keyframe_mode,
            "prepare_condition": conditioning_done - run_started,
            "first_conditioning": first_condition_done - first_condition_started,
            "repair_conditioning_time": repair_conditioning_time,
            "custom_audio": custom_audio,
            "continuity_anchor_u8": continuity_anchor_u8,
            "ffmpeg": ffmpeg,
            "ref_image_size": ref_image_size,
        }

    def _first_sample_prepared_latent(self, seg_cfg, model, cond, latent, steps,
                                      sampler_name, scheduler):
        sampling_started = time.monotonic()
        latent_metadata = {key: value for key, value in latent.items() if key != "samples"}
        sigmas = comfy.samplers.calculate_sigmas(
            model.get_model_object("model_sampling"), scheduler, steps).cpu()[-(steps + 1):]
        sampler = comfy.samplers.sampler_object(sampler_name)
        guider = Guider_Basic(model)
        guider.set_conds(cond)
        noise = Noise_RandomNoise(int(seg_cfg.get("seed", 0)))
        x0_output = {}
        callback = latent_preview.prepare_callback(
            guider.model_patcher, sigmas.shape[-1] - 1, x0_output)
        latent_image = comfy.sample.fix_empty_latent_channels(
            guider.model_patcher, latent["samples"],
            latent.get("downscale_ratio_spacial"), latent.get("downscale_ratio_temporal"))
        samples = guider.sample(
            noise.generate_noise(latent), latent_image, sampler, sigmas,
            callback=callback, disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
            seed=noise.seed)
        samples = samples.to(comfy.model_management.intermediate_device())
        sampling_elapsed = time.monotonic() - sampling_started
        release_started = time.monotonic()
        del latent_image, cond, guider, callback, x0_output, noise, sigmas, sampler
        return {
            "samples": samples,
            "latent_metadata": latent_metadata,
            "first_sampling": sampling_elapsed,
            "first_runtime_release": time.monotonic() - release_started,
        }

    def _second_sample_prepared_latent(self, seg_cfg, model, latent, samples,
                                       sampler_name, scheduler, prepared, diagnostics=None,
                                       project_id="default", event_display_node="",
                                       segment_index=1, page_mode="text"):
        config = prepared["second_sample"]
        upscale_node, add_noise_node, shift_sigmas_node = _second_sample_nodes()
        first_width = int(prepared["first_pass_width"])
        first_height = int(prepared["first_pass_height"])
        target_width = int(prepared["width"])
        target_height = int(prepared["height"])
        repair_conditioning = prepared.get("repair_conditioning")
        if repair_conditioning is None:
            raise RuntimeError("二采缺少独立高分辨率 repair conditioning")
        model_name = str(prepared.get("second_sample_model_name") or "")
        if not model_name:
            raise RuntimeError("二采没有已验证的本地 3D FP16 latent 放大模型")
        upscale_device, upscale_precision, comfy_device, upscale_fallback = (
            _second_sample_upscale_runtime())
        if upscale_fallback:
            _log("[H3导演台] 二采设备回退：%s" % upscale_fallback)

        second_steps = int(config["steps"])
        upscale_memory_required = (
            _second_sample_upscaler_memory_required(model_name)
            if torch.device(upscale_device).type == "cuda" else 0)
        diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
        diagnostics.update({
                "mode": config["mode"],
                "steps": second_steps,
                "denoise": config["denoise"],
                "first_width": first_width,
                "first_height": first_height,
                "target_width": target_width,
                "target_height": target_height,
                "target_megapixels": target_width * target_height / 1_000_000.0,
                "resource_handoff": 0.0,
                "handoff_before_models": None,
                "handoff_after_models": None,
                "upscale_resource_handoff": 0.0,
                "upscale_handoff_before_models": None,
                "upscale_handoff_after_models": None,
                "latent_upscale": 0.0,
                "h3_reload_or_prepare": 0.0,
                "second_sampling": 0.0,
                "second_sampling_tiled": False,
                "second_sampling_tile_axis": "",
                "second_sampling_tile_count": 1,
                "second_sampling_tile_overlap": 0,
                "second_sampling_tile_index": 0,
                "second_sampling_tile_disabled_reason": "",
                "audio_restore": 0.0,
                "repair_conditioning": True,
                "repair_prompt": config["repair_prompt"],
                "sampling_layout": config["sampling_layout"],
                "freeze_audio": config["freeze_audio"],
                "model_name": model_name,
                "precision": upscale_precision,
                "upscale_device": upscale_device,
                "comfy_device": comfy_device,
                "upscale_fallback": upscale_fallback,
                "upscale_memory_required": upscale_memory_required,
                "handoff_model_preserved": None,
                "handoff_cast_buffers_reset": None,
                "handoff_prefetch_queues_cleaned": None,
                "upscale_handoff_model_preserved": None,
                "external_upscaler_cached": False,
                "upscaler_cache_release": None,
                "second_pass_completed": False,
                "runtime_released": False,
                "failure": None,
                "stages": {},
            })
        stages = diagnostics["stages"]
        active_stage = None
        active_started = None
        active_step_current = None
        active_step_total = None
        external_upscaler_cached = False
        failure = None
        failed = False

        first_latent = None
        latent_metadata = None
        separated = None
        video_latent = None
        audio_latent = None
        video_upscaled = None
        video_noised = None
        audio_noised = None
        audio_sigmas = None
        joined = None
        sigmas = None
        noise = None
        sampler = None
        guider = None
        empty_noise = None
        x0_output = None
        preview_callback = None
        callback = None
        latent_image = None
        sample_noise = None
        refined = None
        refined_latent = None
        refined_video = None
        tile_plan = None
        tile_accumulator = None
        tile_weights = None
        tile_video = None
        tile_joined = None
        tile_refined = None
        tile_samples = None
        tile_window = None
        tile_conditioning = None
        video_samples = None

        def begin_stage(stage, step_current=None, step_total=None):
            nonlocal active_stage, active_started, active_step_current, active_step_total
            active_stage = stage
            active_started = time.monotonic()
            active_step_current = step_current
            active_step_total = step_total
            _emit_second_sample_stage(
                project_id, segment_index, event_display_node,
                stage, "running", step_current=step_current, step_total=step_total,
                external_upscaler_cached=(external_upscaler_cached
                                          if stage == "upscale_release" else None))
            return active_started

        def finish_stage(stage, started, external_cache=None):
            nonlocal active_stage, active_started, active_step_current, active_step_total
            elapsed = time.monotonic() - started
            snapshot = _second_sample_runtime_snapshot()
            step_current = second_steps if stage == "second_sampling" else None
            step_total = second_steps if stage == "second_sampling" else None
            stages[stage] = {
                "status": "completed",
                "elapsed_seconds": elapsed,
                "resident_models": snapshot["resident_models"],
                "memory": dict(snapshot["memory"]),
                "step_current": step_current,
                "step_total": step_total,
                "external_upscaler_cached": external_cache,
            }
            _emit_second_sample_stage(
                project_id, segment_index, event_display_node,
                stage, "completed", elapsed_seconds=elapsed,
                step_current=step_current, step_total=step_total,
                external_upscaler_cached=external_cache, snapshot=snapshot)
            active_stage = None
            active_started = None
            active_step_current = None
            active_step_total = None
            return elapsed

        try:
            first_latent = latent.copy()
            first_latent["samples"] = samples
            latent_metadata = {key: value for key, value in first_latent.items()
                               if key != "samples"}
            separated = _node_result(LTXVSeparateAVLatent.execute(first_latent))
            video_latent, audio_latent = separated[:2]
            first_latent = None
            separated = None

            started = begin_stage("first_release")
            handoff = _second_sample_resource_handoff(model, upscale_memory_required)
            diagnostics["resource_handoff"] = handoff["elapsed"]
            diagnostics["handoff_before_models"] = handoff["before_models"]
            diagnostics["handoff_after_models"] = handoff["after_models"]
            diagnostics["handoff_model_preserved"] = handoff["model_registered_after"]
            diagnostics["handoff_cast_buffers_reset"] = handoff["cast_buffers_reset"]
            diagnostics["handoff_prefetch_queues_cleaned"] = handoff["prefetch_queues_cleaned"]
            finish_stage("first_release", started)

            started = begin_stage("latent_upscale")
            external_upscaler_cached = True
            diagnostics["external_upscaler_cached"] = True
            video_upscaled = _second_sample_upscale_video(
                upscale_node, video_latent, model_name, target_width, target_height,
                upscale_device, upscale_precision)
            diagnostics["latent_upscale"] = finish_stage("latent_upscale", started)
            video_latent = None
            intermediate = comfy.model_management.intermediate_device()
            retained_audio = audio_latent["samples"].to(intermediate)
            if retained_audio is not audio_latent["samples"]:
                normalized_audio = audio_latent.copy()
                normalized_audio["samples"] = retained_audio
                audio_latent = normalized_audio

            started = begin_stage("upscale_release")
            cache_release = _second_sample_release_upscaler_cache(
                upscale_node, model_name, upscale_device, upscale_precision)
            diagnostics["upscaler_cache_release"] = cache_release
            external_upscaler_cached = cache_release["cached_after"] is not False
            diagnostics["external_upscaler_cached"] = external_upscaler_cached
            upscale_node = None
            handoff = _second_sample_resource_handoff(model)
            diagnostics["upscale_resource_handoff"] = handoff["elapsed"]
            diagnostics["upscale_handoff_before_models"] = handoff["before_models"]
            diagnostics["upscale_handoff_after_models"] = handoff["after_models"]
            diagnostics["upscale_handoff_model_preserved"] = handoff["model_registered_after"]
            finish_stage(
                "upscale_release", started,
                external_cache=external_upscaler_cached)

            started = begin_stage("h3_reload_or_prepare")
            total_steps = int(second_steps / float(config["denoise"]))
            sigmas = comfy.samplers.calculate_sigmas(
                model.get_model_object("model_sampling"), scheduler, total_steps).cpu()
            sigmas = sigmas[-(second_steps + 1):]
            seed = (int(seg_cfg.get("seed", 0)) + 1) & 0xffffffffffffffff
            noise = Noise_RandomNoise(seed)
            video_noised = _node_result(add_noise_node.execute(
                model, noise, sigmas, video_upscaled))[0]
            video_upscaled = None

            if config["freeze_audio"]:
                audio_noised = audio_latent
            else:
                model_sampling = model.get_model_object("model_sampling")
                shift_video = float(getattr(model_sampling, "shift", 12.0) or 12.0)
                shift_audio = float(getattr(model_sampling, "audio_shift", 3.0) or 3.0)
                audio_sigmas = _node_result(shift_sigmas_node.execute(
                    sigmas, shift_video, shift_audio))[0]
                audio_noised = _node_result(add_noise_node.execute(
                    model, noise, audio_sigmas, audio_latent))[0]
                audio_sigmas = None
            sampler = comfy.samplers.sampler_object(sampler_name)
            guider = Guider_Basic(model)
            empty_noise = Noise_EmptyNoise()
            tile_disabled_reason = _second_sample_tile_disabled_reason(
                video_noised.get("samples"), config,
                picture_references=prepared.get("picture_references", 0),
                allow_picture_references=page_mode in ("create", "video"))
            tile_plan = _second_sample_tile_plan(
                video_noised.get("samples"), config,
                picture_references=prepared.get("picture_references", 0),
                allow_picture_references=page_mode in ("create", "video"))
            if tile_plan is None:
                diagnostics["second_sampling_tile_disabled_reason"] = tile_disabled_reason
                guider.set_conds(repair_conditioning)
                _log("[H3导演台] 段%d二采方式：整幅采样；未分块原因：%s" % (
                    segment_index, tile_disabled_reason or "目标无需分块"))
                joined = _node_result(LTXVConcatAVLatent.execute(
                    video_noised, audio_noised))[0]
                video_noised = None
                audio_noised = None
                if not config["freeze_audio"]:
                    audio_latent = None
                x0_output = {}
                preview_callback = latent_preview.prepare_callback(
                    guider.model_patcher, sigmas.shape[-1] - 1, x0_output)
                latent_image = comfy.sample.fix_empty_latent_channels(
                    guider.model_patcher, joined["samples"],
                    joined.get("downscale_ratio_spacial"), joined.get("downscale_ratio_temporal"))
                sample_noise = empty_noise.generate_noise(joined)
                joined = None
            else:
                diagnostics["second_sampling_tiled"] = True
                diagnostics["second_sampling_tile_axis"] = tile_plan["axis_name"]
                diagnostics["second_sampling_tile_count"] = len(tile_plan["ranges"])
                diagnostics["second_sampling_tile_overlap"] = tile_plan["overlap"]
                _log("[H3导演台] 段%d二采方式：内置空间分块 %s轴 × %d，latent重叠 %d" % (
                    segment_index, tile_plan["axis_name"], len(tile_plan["ranges"]),
                    tile_plan["overlap"]))
            diagnostics["h3_reload_or_prepare"] = finish_stage(
                "h3_reload_or_prepare", started)

            started = begin_stage("second_sampling", step_current=0, step_total=second_steps)

            if tile_plan is None:
                def callback(step, x0, x, total_steps):
                    nonlocal active_step_current
                    if preview_callback is not None:
                        preview_callback(step, x0, x, total_steps)
                    active_step_current = min(second_steps, int(step) + 1)
                    _emit_second_sample_stage(
                        project_id, segment_index, event_display_node,
                        "second_sampling", "running",
                        elapsed_seconds=time.monotonic() - started,
                        step_current=active_step_current, step_total=second_steps)

                refined = guider.sample(
                    sample_noise, latent_image, sampler, sigmas,
                    callback=callback, disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
                    seed=seed)
                refined = refined.to(comfy.model_management.intermediate_device())
            else:
                video_samples = video_noised["samples"]
                intermediate = comfy.model_management.intermediate_device()
                tile_accumulator = torch.zeros_like(
                    video_samples, dtype=torch.float32, device=intermediate)
                tile_weights = torch.zeros(
                    (1, 1, 1, video_samples.shape[-2], video_samples.shape[-1]),
                    dtype=torch.float32, device=intermediate)
                ranges = tile_plan["ranges"]
                for tile_index, (tile_start, tile_end) in enumerate(ranges):
                    diagnostics["second_sampling_tile_index"] = tile_index + 1
                    tile_conditioning = _second_sample_tile_conditioning(
                        repair_conditioning, tile_plan["axis"], tile_start, tile_end,
                        int(video_samples.shape[-2]), int(video_samples.shape[-1]))
                    guider.set_conds(tile_conditioning)
                    _log("[H3导演台] 段%d二采分块 %d/%d：%s轴 latent %d:%d" % (
                        segment_index, tile_index + 1, len(ranges), tile_plan["axis_name"],
                        tile_start, tile_end))
                    tile_video = video_noised.copy()
                    if tile_plan["axis"] == -1:
                        tile_video["samples"] = video_samples[..., tile_start:tile_end].contiguous()
                    else:
                        tile_video["samples"] = video_samples[..., tile_start:tile_end, :].contiguous()
                    tile_joined = _node_result(LTXVConcatAVLatent.execute(
                        tile_video, audio_noised))[0]
                    latent_image = comfy.sample.fix_empty_latent_channels(
                        guider.model_patcher, tile_joined["samples"],
                        tile_joined.get("downscale_ratio_spacial"),
                        tile_joined.get("downscale_ratio_temporal"))
                    sample_noise = empty_noise.generate_noise(tile_joined)

                    def callback(step, x0, x, total_steps, tile_index=tile_index):
                        nonlocal active_step_current
                        completed = tile_index * second_steps + int(step) + 1
                        scaled = int(math.ceil(completed / float(len(ranges))))
                        active_step_current = max(
                            int(active_step_current or 0), min(second_steps, scaled))
                        _emit_second_sample_stage(
                            project_id, segment_index, event_display_node,
                            "second_sampling", "running",
                            elapsed_seconds=time.monotonic() - started,
                            step_current=active_step_current, step_total=second_steps)

                    tile_refined = guider.sample(
                        sample_noise, latent_image, sampler, sigmas,
                        callback=callback, disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
                        seed=seed)
                    tile_refined = tile_refined.to(intermediate)
                    refined_latent = tile_joined.copy()
                    refined_latent["samples"] = tile_refined
                    refined_video = _node_result(
                        LTXVSeparateAVLatent.execute(refined_latent))[0]
                    tile_samples = refined_video["samples"].to(intermediate)
                    fade_left = tile_plan["overlap"] if tile_index > 0 else 0
                    fade_right = tile_plan["overlap"] if tile_index + 1 < len(ranges) else 0
                    tile_window = _second_sample_tile_window(
                        tile_end - tile_start, fade_left, fade_right, intermediate)
                    if tile_plan["axis"] == -1:
                        tile_window = tile_window.view(1, 1, 1, 1, -1)
                        tile_accumulator[..., tile_start:tile_end] += tile_samples.float() * tile_window
                        tile_weights[..., tile_start:tile_end] += tile_window
                    else:
                        tile_window = tile_window.view(1, 1, 1, -1, 1)
                        tile_accumulator[..., tile_start:tile_end, :] += tile_samples.float() * tile_window
                        tile_weights[..., tile_start:tile_end, :] += tile_window
                    tile_joined = None
                    tile_video = None
                    tile_refined = None
                    tile_samples = None
                    tile_window = None
                    tile_conditioning = None
                    refined_latent = None
                    refined_video = None
                    latent_image = None
                    sample_noise = None
                refined_video = video_noised.copy()
                refined_video["samples"] = (
                    tile_accumulator / tile_weights.clamp(min=1e-6)).to(video_samples.dtype)
                refined = _node_result(LTXVConcatAVLatent.execute(
                    refined_video, audio_latent))[0]["samples"]
                tile_accumulator = None
                tile_weights = None
                video_noised = None
                audio_noised = None
                audio_latent = None
            sample_noise = None
            latent_image = None
            callback = None
            preview_callback = None
            x0_output = None
            guider = None
            sampler = None
            noise = None
            sigmas = None
            diagnostics["second_sampling"] = finish_stage("second_sampling", started)

            started = begin_stage("audio_restore")
            if config["freeze_audio"] and tile_plan is None:
                refined_latent = latent_metadata.copy()
                refined_latent["samples"] = refined
                refined_video = _node_result(
                    LTXVSeparateAVLatent.execute(refined_latent))[0]
                refined_latent = None
                restored = _node_result(LTXVConcatAVLatent.execute(
                    refined_video, audio_latent))[0]["samples"]
                refined = restored
                refined_video = None
                audio_latent = None
            diagnostics["audio_restore"] = finish_stage("audio_restore", started)
            diagnostics["second_pass_completed"] = True
            return refined, diagnostics
        except Exception as error:
            failed = True
            failure = _second_sample_failure(error)
            diagnostics["failure"] = failure
            raise
        finally:
            first_latent = None
            latent_metadata = None
            separated = None
            video_latent = None
            audio_latent = None
            video_upscaled = None
            video_noised = None
            audio_noised = None
            audio_sigmas = None
            joined = None
            sigmas = None
            noise = None
            sampler = None
            guider = None
            empty_noise = None
            x0_output = None
            preview_callback = None
            callback = None
            latent_image = None
            sample_noise = None
            refined_latent = None
            refined_video = None
            tile_plan = None
            tile_accumulator = None
            tile_weights = None
            tile_video = None
            tile_joined = None
            tile_refined = None
            tile_samples = None
            tile_window = None
            tile_conditioning = None
            video_samples = None
            runtime_released = False
            runtime_released = _second_sample_finally_cleanup(failed)
            diagnostics["runtime_released"] = runtime_released
            if failure is not None:
                failure["runtime_released"] = runtime_released
                snapshot = _second_sample_runtime_snapshot()
                elapsed = (time.monotonic() - active_started
                           if active_started is not None else None)
                if active_stage is not None:
                    stages[active_stage] = {
                        "status": "failed",
                        "elapsed_seconds": elapsed,
                        "resident_models": snapshot["resident_models"],
                        "memory": dict(snapshot["memory"]),
                        "step_current": active_step_current,
                        "step_total": active_step_total,
                        "external_upscaler_cached": (external_upscaler_cached
                                                     if active_stage in ("latent_upscale", "upscale_release")
                                                     else None),
                    }
                    _emit_second_sample_stage(
                        project_id, segment_index, event_display_node,
                        active_stage, "failed", elapsed_seconds=elapsed,
                        step_current=active_step_current, step_total=active_step_total,
                        external_upscaler_cached=(external_upscaler_cached
                                                  if active_stage in ("latent_upscale", "upscale_release")
                                                  else None),
                        failure=failure, snapshot=snapshot)

    def _decode_sampled_latent(self, samples, vae, audio_vae, model_audio_required):
        decode_started = time.monotonic()
        video_lat = samples
        if getattr(video_lat, "is_nested", False):
            video_lat = video_lat.unbind()[0]
        frames = vae.decode(video_lat)
        video_decode_done = time.monotonic()
        if frames.dim() == 5:
            frames = frames[0]
        frames_u8 = (
            frames.float()
            .clamp(0, 1)
            .mul(255)
            .round()
            .to(torch.uint8)
            .cpu()
            .numpy()
        )
        del frames, video_lat
        frame_transfer_done = time.monotonic()
        audio = (vae_decode_audio(audio_vae, {"samples": samples})
                 if model_audio_required else None)
        if audio is not None:
            audio = {
                "waveform": audio["waveform"].detach().float().cpu(),
                "sample_rate": int(audio["sample_rate"]),
            }
            audio_samples = int(audio["waveform"].shape[-1])
        else:
            audio_samples = 0
        decode_done = time.monotonic()
        return frames_u8, audio, audio_samples, {
            "decode": decode_done - decode_started,
            "video_decode": video_decode_done - decode_started,
            "frame_transfer": frame_transfer_done - video_decode_done,
            "audio_decode": (decode_done - frame_transfer_done
                             if model_audio_required else 0.0),
        }

    def _sample_prepared_segment(self, seg_idx, seg_cfg, model, vae, audio_vae, cond, latent,
                                 prepared, steps, sampler_name, scheduler, mode="create",
                                 project_id="default", prepare_condition_elapsed=None,
                                 event_display_node=""):
        run_started = time.monotonic()
        width = int(prepared["width"])
        height = int(prepared["height"])
        dur = float(prepared["requested_duration"])
        length = int(prepared["frames"])
        reference_image_count = int(prepared["picture_references"])
        requested_image_references = int(prepared.get("requested_image_references", reference_image_count))
        loaded_image_references = int(prepared.get("loaded_image_references", reference_image_count))
        condition_image_reference_blocks = int(prepared.get(
            "condition_image_reference_blocks", loaded_image_references))
        reference_prompt_mode = str(prepared.get("reference_prompt_mode", "plain") or "plain")
        keyframe_mode = str(prepared.get("keyframe_mode", "无") or "无")
        custom_audio = prepared.get("custom_audio")
        continuity_anchor_u8 = prepared.get("continuity_anchor_u8")
        ffmpeg = prepared["ffmpeg"]
        ref_image_size = str(prepared.get("ref_image_size", "match") or "match")
        has_custom_audio = bool(custom_audio and os.path.exists(custom_audio))
        model_audio_required = bool(
            seg_cfg.get("audio_enabled", True)
            and (not has_custom_audio or seg_cfg.get("audio_mode", "replace") == "mix")
        )

        sampling_started = time.monotonic()
        first_pass = self._first_sample_prepared_latent(
            seg_cfg, model, cond, latent, steps, sampler_name, scheduler)
        samples = first_pass["samples"]
        latent = dict(first_pass.get("latent_metadata") or {})
        first_sampling_elapsed = float(first_pass.get("first_sampling") or 0.0)
        first_runtime_release = float(first_pass.get("first_runtime_release") or 0.0)
        second_sample_config = prepared.get("second_sample", {"mode": "off"})
        second_sample_identity = _second_sample_event_identity(event_display_node)
        save_comparison = (second_sample_config.get("mode") != "off"
                           and second_sample_config.get("save_comparison") is True)
        first_pass_samples = samples if save_comparison else None
        second_diagnostics = {
            "mode": "off",
            "first_width": int(prepared.get("first_pass_width", width)),
            "first_height": int(prepared.get("first_pass_height", height)),
            "target_width": width,
            "target_height": height,
            "target_megapixels": width * height / 1_000_000.0,
            "first_runtime_release": first_runtime_release,
            "resource_handoff": 0.0,
            "handoff_before_models": None,
            "handoff_after_models": None,
            "upscale_resource_handoff": 0.0,
            "upscale_handoff_before_models": None,
            "upscale_handoff_after_models": None,
            "latent_upscale": 0.0,
            "h3_reload_or_prepare": 0.0,
            "second_sampling": 0.0,
            "second_sampling_tiled": False,
            "second_sampling_tile_axis": "",
            "second_sampling_tile_count": 1,
            "second_sampling_tile_overlap": 0,
            "second_sampling_tile_index": 0,
            "second_sampling_tile_disabled_reason": "",
            "audio_restore": 0.0,
            "repair_conditioning": False,
            "repair_prompt": "",
            "sampling_layout": "tiled",
            "freeze_audio": True,
            "model_name": "",
            "precision": "",
            "upscale_device": "",
            "comfy_device": "",
            "upscale_fallback": "",
            "upscale_memory_required": 0,
            "handoff_model_preserved": None,
            "handoff_cast_buffers_reset": None,
            "handoff_prefetch_queues_cleaned": None,
            "upscale_handoff_model_preserved": None,
            "external_upscaler_cached": False,
            "upscaler_cache_release": None,
            "second_pass_completed": False,
            "runtime_released": False,
            "failure": None,
            "stages": {},
        }
        second_sample_error = ""
        second_latent = None
        if second_sample_config.get("mode") != "off":
            second_latent = {key: value for key, value in latent.items()
                             if key != "samples"}
            latent = None
            try:
                samples, second_diagnostics = self._second_sample_prepared_latent(
                    seg_cfg, model, second_latent, samples, sampler_name, scheduler, prepared,
                    diagnostics=second_diagnostics, project_id=project_id,
                    event_display_node=event_display_node, segment_index=seg_idx,
                    page_mode=mode)
                second_diagnostics["first_runtime_release"] = first_runtime_release
            except Exception as error:
                failure = second_diagnostics.get("failure")
                if not isinstance(failure, dict):
                    released = _second_sample_finally_cleanup(True)
                    failure = _second_sample_failure(error, runtime_released=released)
                    second_diagnostics["failure"] = failure
                    second_diagnostics["runtime_released"] = released
                if failure.get("oom"):
                    second_sample_error = (
                        "二采失败；正在回退保存一采；二采缓存未写入：%s: %s" % (
                            failure["exception_type"], failure["exception_message"]))
                else:
                    second_sample_error = "二采失败；正在回退保存一采；二采缓存未写入：%s: %s" % (
                        failure["exception_type"], failure["exception_message"])
                _log("[H3导演台] 段%d二采失败；正在回退保存一次采样结果：%s" % (
                    seg_idx, second_sample_error))
        sampling_done = time.monotonic()

        # 采样完成后，VAE 只再需要 samples。提前释放采样对象，避免与解码峰值重叠。
        del latent
        second_latent = None
        gc.collect()
        if not second_sample_error:
            comfy.model_management.soft_empty_cache()

        os.makedirs(_project_dir(project_id), exist_ok=True)
        amb_audio = None
        amb_name = seg_cfg.get("amb_audio")
        if amb_name:
            amb_path = _resolve_input(amb_name)
            if os.path.exists(amb_path):
                amb_audio = amb_path
            else:
                _log("[H3导演台] 警告：段%d 的环境音文件不存在 %s" % (seg_idx, amb_name))

        def _apply_continuity(frames_u8):
            if continuity_anchor_u8 is None:
                return
            anchor = continuity_anchor_u8
            if anchor.shape[:2] != frames_u8.shape[1:3]:
                anchor = np.asarray(Image.fromarray(anchor).resize(
                    (frames_u8.shape[2], frames_u8.shape[1]), Image.Resampling.LANCZOS))
            enforce_continuity_start(frames_u8, anchor, bridge_frames=8)

        def _write_decoded(frames_u8, audio, version_label):
            _apply_continuity(frames_u8)
            return _write_segment_video(
                frames_u8, audio, seg_idx, ffmpeg,
                custom_audio=custom_audio,
                audio_mode=seg_cfg.get("audio_mode", "replace"),
                audio_vol=seg_cfg.get("audio_vol", 1.0),
                audio_enabled=seg_cfg.get("audio_enabled", True),
                audio_trim_start=seg_cfg.get("audio_trim_start", 0.0),
                audio_trim_end=seg_cfg.get("audio_trim_end", 0.0),
                audio_offset=seg_cfg.get("audio_offset", 0.0),
                audio_trim_mode=seg_cfg.get("audio_trim_mode", "keep"),
                out_fps=seg_cfg.get("fps", 24), mode=mode,
                amb_audio=amb_audio,
                amb_vol=seg_cfg.get("amb_vol", 0.25),
                project_id=project_id, version_label=version_label)

        comparison_path = ""
        comparison_decode = 0.0
        comparison_encode = 0.0
        with torch.inference_mode():
            if save_comparison and not second_sample_error:
                comparison_frames, comparison_audio, _comparison_audio_samples, comparison_timings = (
                    self._decode_sampled_latent(
                        first_pass_samples, vae, audio_vae, model_audio_required))
                comparison_write_started = time.monotonic()
                comparison_path = _write_decoded(
                    comparison_frames, comparison_audio, "一次采样")
                comparison_write_done = time.monotonic()
                comparison_decode = comparison_timings["decode"]
                comparison_encode = comparison_write_done - comparison_write_started
                del comparison_frames, comparison_audio
                first_pass_samples = None
                gc.collect()
                comfy.model_management.soft_empty_cache()

            frames_u8, audio, audio_samples, decode_timings = self._decode_sampled_latent(
                samples, vae, audio_vae, model_audio_required)
            version_label = ""
            if second_sample_config.get("mode") != "off":
                version_label = "一次采样" if second_sample_error else "二次采样"
            write_started = time.monotonic()
            out_path = _write_decoded(frames_u8, audio, version_label)
            write_done = time.monotonic()

        if second_sample_error:
            failure = second_diagnostics.get("failure")
            if isinstance(failure, dict):
                failure["first_pass_preserved"] = True
                release_note = ("运行资源已释放" if failure.get("runtime_released")
                                else "CUDA清理未完整完成")
                second_sample_error = (
                    "二采失败；一采已保存；二采缓存未写入；%s：%s: %s" % (
                        release_note, failure["exception_type"], failure["exception_message"]))
                _log("[H3导演台] 段%d二采失败；一次采样结果已保存为 %s" % (
                    seg_idx, os.path.basename(out_path)))
                failed_stage = next((stage for stage, _label in SECOND_SAMPLE_STAGES
                                     if (second_diagnostics["stages"].get(stage) or {}).get("status") == "failed"),
                                    None)
                if failed_stage:
                    stage_diagnostics = second_diagnostics["stages"][failed_stage]
                    _emit_second_sample_stage(
                        project_id, seg_idx, event_display_node, failed_stage, "failed",
                        elapsed_seconds=stage_diagnostics.get("elapsed_seconds"),
                        step_current=stage_diagnostics.get("step_current"),
                        step_total=stage_diagnostics.get("step_total"),
                        external_upscaler_cached=stage_diagnostics.get("external_upscaler_cached"),
                        failure=failure, snapshot={
                            "resident_models": stage_diagnostics.get("resident_models"),
                            "memory": dict(stage_diagnostics.get("memory") or {}),
                        })

        del samples, first_pass_samples
        if continuity_anchor_u8 is not None:
            _log("[H3导演台] 段%d 已执行尾帧确定性桥接：首帧完全继承，前8帧平滑回到生成结果" % seg_idx)

        del frames_u8, audio, continuity_anchor_u8
        gc.collect()
        condition_elapsed = (prepared.get("prepare_condition", 0.0)
                             if prepare_condition_elapsed is None else prepare_condition_elapsed)
        output_width = (second_diagnostics["first_width"]
                        if second_sample_error else second_diagnostics["target_width"])
        output_height = (second_diagnostics["first_height"]
                         if second_sample_error else second_diagnostics["target_height"])
        return out_path, audio_samples, {
            "width": output_width,
            "height": output_height,
            "requested_duration": dur,
            "frames": length,
            "generated_duration": length / float(FPS),
            "picture_references": reference_image_count,
            "requested_image_references": requested_image_references,
            "loaded_image_references": loaded_image_references,
            "condition_image_reference_blocks": condition_image_reference_blocks,
            "reference_prompt_mode": reference_prompt_mode,
            "keyframe_mode": keyframe_mode,
            "ref_image_size": ref_image_size,
            "prepare_condition": condition_elapsed,
            "first_conditioning": prepared.get("first_conditioning", 0.0),
            "repair_conditioning_time": prepared.get("repair_conditioning_time", 0.0),
            "sampling": sampling_done - sampling_started,
            "first_sampling": first_sampling_elapsed,
            "second_sample_mode": second_diagnostics["mode"],
            "second_sample_prompt_id": second_sample_identity["prompt_id"],
            "second_sample_node": second_sample_identity["node"],
            "second_sample_display_node": second_sample_identity["display_node"],
            "second_sample_project_id": str(project_id or "default"),
            "second_sample_segment_index": int(seg_idx),
            "second_sample_sampling_layout": second_diagnostics["sampling_layout"],
            "second_sample_steps": second_diagnostics.get("steps", 0),
            "second_sample_denoise": second_diagnostics.get("denoise", 0.0),
            "second_sample_first_width": second_diagnostics["first_width"],
            "second_sample_first_height": second_diagnostics["first_height"],
            "second_sample_target_width": second_diagnostics["target_width"],
            "second_sample_target_height": second_diagnostics["target_height"],
            "second_sample_target_megapixels": second_diagnostics["target_megapixels"],
            "second_sample_first_runtime_release": second_diagnostics["first_runtime_release"],
            "second_sample_resource_handoff": second_diagnostics["resource_handoff"],
            "second_sample_handoff_before_models": second_diagnostics["handoff_before_models"],
            "second_sample_handoff_after_models": second_diagnostics["handoff_after_models"],
            "second_sample_upscale_resource_handoff": second_diagnostics["upscale_resource_handoff"],
            "second_sample_upscale_handoff_before_models": second_diagnostics["upscale_handoff_before_models"],
            "second_sample_upscale_handoff_after_models": second_diagnostics["upscale_handoff_after_models"],
            "second_sample_latent_upscale": second_diagnostics["latent_upscale"],
            "second_sample_h3_reload_or_prepare": second_diagnostics["h3_reload_or_prepare"],
            "second_sampling": second_diagnostics["second_sampling"],
            "second_sampling_tiled": second_diagnostics["second_sampling_tiled"],
            "second_sampling_tile_axis": second_diagnostics["second_sampling_tile_axis"],
            "second_sampling_tile_count": second_diagnostics["second_sampling_tile_count"],
            "second_sampling_tile_overlap": second_diagnostics["second_sampling_tile_overlap"],
            "second_sampling_tile_index": second_diagnostics.get("second_sampling_tile_index", 0),
            "second_sampling_tile_disabled_reason": second_diagnostics.get(
                "second_sampling_tile_disabled_reason", ""),
            "second_sample_audio_restore": second_diagnostics["audio_restore"],
            "second_sample_repair_conditioning": second_diagnostics["repair_conditioning"],
            "second_sample_repair_prompt": second_diagnostics["repair_prompt"],
            "second_sample_freeze_audio": second_diagnostics["freeze_audio"],
            "second_sample_model_name": second_diagnostics["model_name"],
            "second_sample_precision": second_diagnostics["precision"],
            "second_sample_upscale_device": second_diagnostics["upscale_device"],
            "second_sample_comfy_device": second_diagnostics["comfy_device"],
            "second_sample_upscale_fallback": second_diagnostics["upscale_fallback"],
            "second_sample_upscale_memory_required": second_diagnostics["upscale_memory_required"],
            "second_sample_handoff_model_preserved": second_diagnostics["handoff_model_preserved"],
            "second_sample_handoff_cast_buffers_reset": second_diagnostics["handoff_cast_buffers_reset"],
            "second_sample_handoff_prefetch_queues_cleaned": second_diagnostics["handoff_prefetch_queues_cleaned"],
            "second_sample_upscale_handoff_model_preserved": second_diagnostics["upscale_handoff_model_preserved"],
            "second_sample_error": second_sample_error,
            "second_sample_comparison": comparison_path,
            "second_sample_current": out_path if second_diagnostics["mode"] != "off" else "",
            "second_sample_comparison_decode": comparison_decode,
            "second_sample_comparison_encode": comparison_encode,
            "second_sample_external_upscaler_cached": second_diagnostics["external_upscaler_cached"],
            "second_sample_upscaler_cache_release": second_diagnostics.get("upscaler_cache_release"),
            "second_sample_second_pass_completed": second_diagnostics["second_pass_completed"],
            "second_sample_runtime_released": second_diagnostics["runtime_released"],
            "second_sample_failure": second_diagnostics["failure"],
            "second_sample_stages": second_diagnostics["stages"],
            "decode": decode_timings["decode"] + comparison_decode,
            "video_decode": decode_timings["video_decode"],
            "frame_transfer": decode_timings["frame_transfer"],
            "audio_decode": decode_timings["audio_decode"],
            "model_audio_decoded": model_audio_required,
            "encode": write_done - write_started + comparison_encode,
            "run_total": condition_elapsed + write_done - run_started,
        }

    def _run_segment(self, seg_idx, seg_cfg, shared_refs, model, clip, vae, audio_vae,
                      width, height, default_dur, steps, sampler_name, scheduler, ref_image_size, mode="create",
                      global_prompt="", tail_mode="ref2v", unload_per_seg=False, project_id="default",
                      primary_model_kind="unknown", total_segments=1,
                      preserve_tail_visual_style=True, event_display_node=""):
        cond, latent, prepared = self._prepare_segment_condition(
            seg_idx, seg_cfg, shared_refs, clip, vae, audio_vae,
            width, height, default_dur, ref_image_size, mode,
            global_prompt, tail_mode, project_id, primary_model_kind, total_segments,
            preserve_tail_visual_style)
        return self._sample_prepared_segment(
            seg_idx, seg_cfg, model, vae, audio_vae, cond, latent, prepared,
            steps, sampler_name, scheduler, mode, project_id,
            event_display_node=event_display_node)

    def _expand_cached_reroll(self, seg_idx, seg_cfg, shared_ref_names, width, height,
                              default_dur, steps, sampler_name, scheduler, ref_image_size,
                              mode, global_prompt, tail_mode, project_id, primary_model_kind,
                              total_segments, preserve_tail_visual_style, run_hash, report,
                              h3_prompt_graph, h3_unique_id):
        links = {name: _upstream_link(h3_prompt_graph, h3_unique_id, name)
                 for name in ("model", "clip", "vae", "audio_vae")}
        if any(link is None for link in links.values()):
            return None

        condition_segment = dict(seg_cfg)
        condition_segment.pop("seed", None)
        condition_segment.pop("force", None)
        condition_segment.pop("enabled", None)
        first_frame_mode = _segment_first_frame_mode(seg_cfg)
        first_frame_name, last_frame_name = _segment_keyframe_names(seg_cfg)
        tail_path = (_seg_tail(seg_idx - 1, mode, project_id)
                     if first_frame_mode == "previous_tail" and seg_idx > 1 else None)
        condition_payload = {
            "segment": condition_segment,
            "segment_index": seg_idx,
            "shared_ref_names": list(shared_ref_names),
            "width": width,
            "height": height,
            "default_duration": default_dur,
            "ref_image_size": ref_image_size,
            "mode": mode,
            "global_prompt": global_prompt,
            "tail_mode": tail_mode,
            "project_id": project_id,
            "primary_model_kind": primary_model_kind,
            "total_segments": total_segments,
            "preserve_tail_visual_style": preserve_tail_visual_style,
            "signatures": {
                "refs": [_input_signature(name) for name in (seg_cfg.get("refs") or [])],
                "shared_refs": [_input_signature(name) for name in shared_ref_names],
                "audio": _input_signature(seg_cfg.get("audio")),
                "voice_refs": [_input_signature(name) for name in (seg_cfg.get("voice_refs") or [])],
                "video_refs": [_input_signature(name) for name in (seg_cfg.get("video_refs") or [])],
                "first_frame": _input_signature(first_frame_name),
                "last_frame": _input_signature(last_frame_name),
                "tail": _path_signature(tail_path) if tail_path else None,
            },
        }
        sample_payload = {
            "segment": dict(seg_cfg),
            "segment_index": seg_idx,
            "mode": mode,
            "project_id": project_id,
            "run_hash": run_hash,
            "report": list(report),
            "width": width,
            "height": height,
            "sampler_name": sampler_name,
            "scheduler": scheduler,
            "display_node": str(h3_unique_id or ""),
        }
        graph = GraphBuilder()
        condition = graph.node(
            "H3DirectorOfficialConditionCache", id="condition_%s_%d" % (mode, seg_idx),
            clip=links["clip"], vae=links["vae"], audio_vae=links["audio_vae"],
            condition_json=json.dumps(condition_payload, ensure_ascii=False, sort_keys=True))
        condition.set_override_display_id(str(h3_unique_id))
        sample_json = json.dumps(sample_payload, ensure_ascii=False, sort_keys=True)
        sample = graph.node(
            "H3DirectorOfficialSampleCommit", id="sample_%s_%d" % (mode, seg_idx),
            model=links["model"], vae=links["vae"], audio_vae=links["audio_vae"],
            positive=condition.out(0), latent=condition.out(1), prepared=condition.out(2),
            seed=int(seg_cfg.get("seed", 0)), steps=int(steps), sampler_name=sampler_name,
            scheduler=scheduler, sample_json=sample_json)
        sample.set_override_display_id(str(h3_unique_id))
        return {
            "result": tuple(sample.out(index) for index in range(5)),
            "expand": graph.finalize(),
        }

    # ---------------- 主流程 ----------------
    def direct(self, model, clip, vae, audio_vae, width, height, 时长秒, steps,
               sampler, scheduler, ref_image_size, segments_json,
               vsegments_json="[]", tsegments_json="[]", ui_mode="create",
               global_prompt="", 续接方式="硬首帧FL2VA(不跳帧)", 每段后卸载模型=False,
               汇总输出="仅预览帧(推荐)", project_id="", text_shared_refs_json="[]",
               h3_prompt_graph=None, h3_unique_id=None):
        # v2.3: two independent workspaces; ui_mode selects the dataset,
        # outputs use per-mode file names so the two never overwrite each other.
        # v2.11: 文本界面（text）——纯提示词生成，无参考图/视频/音频，数据与产出同样独立。
        mode = ui_mode if ui_mode in ("video", "text") else "create"
        effective_global_prompt = _global_prompt_for_mode(mode, global_prompt)
        if mode == "video" and str(global_prompt or "").strip():
            _log("[H3导演台] 视频模式已隔离并忽略其它界面遗留的全局提示词")
        try:
            _src = {"video": vsegments_json, "text": tsegments_json}.get(mode, segments_json)
            segments = json.loads(_src or "[]")
        except Exception:
            raise ValueError("[H3导演台] segments_json 解析失败，请在节点时间轴界面里重新编辑分段")
        if not isinstance(segments, list):
            raise ValueError("[H3导演台] segments_json 必须是分段数组，请重新分析导入")
        if not segments:
            raise ValueError("[H3导演台] 没有任何分段，请在节点时间轴界面里添加分段")
        if any(not isinstance(segment, dict) for segment in segments):
            raise ValueError("[H3导演台] 分段数据损坏，请在节点时间轴界面里重新编辑分段")
        for segment in segments:
            segment["first_frame_mode"] = _segment_first_frame_mode(segment)
            segment["use_tail"] = segment["first_frame_mode"] == "previous_tail"
        # 源画幅、源时长契约只做运行报告提示，不阻断用户尝试生成。
        source_aspect_gate = None
        source_aspect_warning = ""
        try:
            source_aspect_gate = _validate_source_aspect_contract(segments, width, height)
        except _H3GenerationNotice as aspect_error:
            source_aspect_warning = str(aspect_error).replace("[H3导演台]", "").strip()
            _log("[H3导演台] 画幅提示（不阻断）：%s" % source_aspect_warning)
        source_duration_warning = ""
        try:
            source_duration_gate = _validate_authoritative_duration_contract(segments, 时长秒)
        except ValueError as duration_error:
            source_duration_gate = None
            source_duration_warning = str(duration_error).replace("[H3导演台]", "").strip()
            _log("[H3导演台] 时长提示（不阻断）：%s" % source_duration_warning)

        # v2.23：汇总输出控件已从界面移除。旧工作流即使保存了“完整帧和音频”，
        # 也统一迁移为省内存预览；完整音画始终保存在分段 MP4，并由前端自动合并成完整 MP4。
        汇总输出 = "仅预览帧(推荐)"
        # 8GB 优化和导演台内置 FFN 分块已删除。保留旧参数仅为了让历史工作流继续加载；
        # 旧的每段标记会被清理，不再改变步数、参考视频帧率、尺寸或模型计算。
        每段后卸载模型 = False
        for _sc in segments:
            if isinstance(_sc, dict):
                _sc.pop("_low_vram", None)
                _sc.pop("h3_chunk_ffn", None)
        # v2.7：视频界面恢复分段（时间轴回归：每段=照片+对应参考视频，可分段运行），
        # 时长回到段级配置（时间轴拖块/段行输入），节点「时长秒」仅作新建段默认值。
        # v2.10.17：视频界面各段完全独立——不续接上一段尾帧（每段是自己的照片+参考视频作业）
        if mode == "video":
            for _sc in segments:
                _sc["use_tail"] = False
        # 文本界面不再提供共享多参考图 UI；旧工作流保存的隐藏参考图数据仍兼容读取。
        # 视频/配音/音色字段始终清空，段间续接尾帧仍由段上开关控制。
        if mode == "text":
            for _sc in segments:
                _sc["video_refs"] = []
                _sc["voice_refs"] = []
                _sc["audio"] = None

        if mode in ("create", "video", "text"):
            second_sample_configs = [
                _normalize_second_sample_config(segment.get("second_sample"), mode)
                for segment in segments if segment.get("enabled", True)
            ]
            second_sample_configs = [
                config for config in second_sample_configs if config["mode"] != "off"]
            if second_sample_configs:
                _second_sample_nodes()
                for config in second_sample_configs:
                    _second_sample_model_name(
                        config.get("upscaler_model"),
                        config.get("legacy_upscaler_model") is True)

        project_id = _safe_project_id(project_id or ("node_" + str(h3_unique_id or "default")))
        os.makedirs(_project_dir(project_id), exist_ok=True)
        _cleanup_project_temp_files(project_id)

        shared_refs = []
        shared_ref_names = []
        if mode == "text":
            try:
                shared_ref_names = json.loads(text_shared_refs_json or "[]")
                if not isinstance(shared_ref_names, list):
                    raise TypeError
            except (TypeError, ValueError, json.JSONDecodeError):
                raise ValueError("[H3导演台] 旧工作流共享参考图数据损坏，请新建导演台节点")

        primary_model_kind = _upstream_model_kind(h3_prompt_graph, h3_unique_id, "model")
        tail_mode = "fl2v" if primary_model_kind == "fl2va" else "ref2v"
        tail_style_boundaries = _detect_tail_render_boundaries(segments)
        tail_style_warning = ""
        if tail_mode == "fl2v" and tail_style_boundaries:
            details = "、".join("段%d(%s→%s)" % (item["segment"], item["from"], item["to"])
                               for item in tail_style_boundaries)
            tail_style_warning = (
                "%s 同时要求硬风格切换和 FL2VA 硬首帧续接。FL2VA 会把上一段真实尾帧写入"
                "本段首帧，前8帧桥接也会保留旧渲染风格；本次继续生成，但第一帧可能无法立即成为新风格。"
                % details)
            _log("[H3导演台] 续接提示（不阻断）：%s" % tail_style_warning)
        tail_boundary_by_segment = {item["segment"]: item for item in tail_style_boundaries}
        ref_model_sig = _upstream_fingerprint(h3_prompt_graph, h3_unique_id, "model")
        report = ["H3 导演台运行报告", "段数 %d | %sx%s | 默认 %.1f 秒/段（每段可用 duration 覆盖）| %d steps %s/%s"
                  % (len(segments), width, height, 时长秒, steps, sampler, scheduler)]
        report.append("项目 %s | 自动续接 %s" % (
            project_id, "FL2VA硬首帧" if tail_mode == "fl2v" else "Ref2VA软参考"))
        if source_aspect_gate:
            aspect_sizes = ", ".join("%dx%d" % size for size in source_aspect_gate["sizes"])
            report.append("源画幅检查通过：%s | %d段有效尺寸 %s" % (
                source_aspect_gate["contract"], source_aspect_gate["segment_count"], aspect_sizes))
        if source_aspect_warning:
            report.append("⚠ 画幅提示（不阻断生成）：%s" % source_aspect_warning)
        if source_duration_warning:
            report.append("⚠ 时长提示（不阻断生成）：%s" % source_duration_warning)
        elif source_duration_gate:
            report.append("源时长检查通过：%.3f秒 -> %.3f秒（%.1f%%，%d个契约组覆盖%d段）" % (
                source_duration_gate["source"], source_duration_gate["imported"],
                source_duration_gate["ratio"] * 100.0,
                source_duration_gate.get("group_count", 1), source_duration_gate["segment_count"]))
        model_note = {
            "fl2va": "主模型已识别为 FL2VA（支持单模型模式）",
            "ref2va": "主模型已识别为 Ref2VA",
            "unknown": "主模型类型未识别，按 Ref2VA 兼容模式",
            "not_connected": "主模型上游未连接",
        }.get(primary_model_kind, "主模型类型未知")
        report.append(model_note)
        if primary_model_kind == "fl2va":
            ignored_reference_segments = [index for index, segment in enumerate(segments, 1)
                                          if segment.get("enabled", True)
                                          and _segment_has_reference_material(segment, len(shared_ref_names))]
            if ignored_reference_segments:
                report.append("FL2VA 单模型继续运行：段%s 的 Ref2VA 参考素材未送入模型。"
                              % ",".join(map(str, ignored_reference_segments)))
        report.append("资源策略：各段顺序生成；正常段间只做轻量清理并复用模型；内存压力、异常/取消或用户请求时，才在当前段安全写盘后深度释放。")
        if tail_style_warning:
            report.append("⚠ 续接提示（不阻断生成）：%s" % tail_style_warning)
        if tail_mode == "ref2v":
            for item in tail_style_boundaries:
                report.append("段%d：检测到 %s→%s 硬风格边界；Ref2VA 尾帧只保持身份、构图与运动，不保留旧渲染风格。"
                              % (item["segment"], item["from"], item["to"]))
        enabled_count = sum(1 for segment in segments if segment.get("enabled", True))
        done = []      # seg_idx 已就绪
        ran = []       # 本次新生成
        for k, seg_cfg in enumerate(segments):
            seg_idx = k + 1
            if comfy.model_management.processing_interrupted():
                raise comfy.model_management.InterruptProcessingException()
            if not seg_cfg.get("enabled", True):
                report.append("段%d: 跳过（未启用）" % seg_idx)
                continue

            tail_style_boundary = tail_boundary_by_segment.get(seg_idx)
            preserve_tail_visual_style = tail_style_boundary is None
            first_frame_mode = _segment_first_frame_mode(seg_cfg)
            first_frame_name, last_frame_name = _segment_keyframe_names(seg_cfg)
            use_previous_tail = first_frame_mode == "previous_tail"

            # 在计算缓存签名前先复查上一段真实视频的尾部。若末帧花屏，tail PNG 会只在
            # 内容确实变化时原子替换，因此仅受影响的后续段会自动失效并重新生成；正常
            # 项目不会因为一次质量复查而整批重跑。
            if use_previous_tail and seg_idx > 1:
                _refresh_segment_tail(seg_idx - 1, mode, project_id)

            run_cfg = {
                "cache_schema": CACHE_SCHEMA,
                "prompt": _compose_segment_prompt(
                    effective_global_prompt, seg_cfg.get("prompt", ""),
                    use_tail=use_previous_tail, seg_idx=seg_idx,
                    total_segments=len(segments),
                    preserve_tail_visual_style=preserve_tail_visual_style),
                "seed": seg_cfg.get("seed", 0),
                "refs": [_input_signature(n) for n in (seg_cfg.get("refs") or [])],
                "shared_refs": [_input_signature(n) for n in shared_ref_names],
                "duration": seg_cfg.get("duration", 时长秒),
                "inherit_shared": seg_cfg.get("inherit_shared", True),
                "use_tail": use_previous_tail,
                "first_frame_mode": first_frame_mode,
                "first_frame": _input_signature(first_frame_name),
                "last_frame": _input_signature(last_frame_name),
                "tail_mode": tail_mode,
                "tail_style_boundary": tail_style_boundary,
                "tail": (_path_signature(_seg_tail(seg_idx - 1, mode, project_id))
                         if use_previous_tail and seg_idx > 1 else None),
                "audio": _input_signature(seg_cfg.get("audio")),
                "audio_src": seg_cfg.get("audio_src", ""),
                "audio_ref_mode": seg_cfg.get("audio_ref_mode", "copy"),
                "audio_ref_ambient": bool(seg_cfg.get("audio_ref_ambient")),
                "voice_refs": [_input_signature(n) for n in (seg_cfg.get("voice_refs") or [])],
                "video_refs": [_input_signature(n) for n in (seg_cfg.get("video_refs") or [])],
                "video_ref_modes": seg_cfg.get("video_ref_modes") or {},
                "video_audio_reference": bool(seg_cfg.get("video_audio_reference")),
                "video_fps": seg_cfg.get("video_fps") or 24,
                "video_skip": seg_cfg.get("video_skip") or 0,
                "width": seg_cfg.get("width") or 0,
                "height": seg_cfg.get("height") or 0,
                "voice_modes": seg_cfg.get("voice_modes") or {},
                "amb_audio": _input_signature(seg_cfg.get("amb_audio")),
                "amb_vol": seg_cfg.get("amb_vol", 0.25),
                "audio_mode": seg_cfg.get("audio_mode", "replace"),
                "audio_vol": seg_cfg.get("audio_vol", 1.0),
                "audio_enabled": seg_cfg.get("audio_enabled", True),
                "audio_trim_start": seg_cfg.get("audio_trim_start", 0.0),
                "audio_trim_end": seg_cfg.get("audio_trim_end", 0.0),
                "audio_offset": seg_cfg.get("audio_offset", 0.0),
                "audio_trim_mode": seg_cfg.get("audio_trim_mode", "keep"),
                "fps": seg_cfg.get("fps", 24),
                "second_sample": _normalize_second_sample_config(
                    seg_cfg.get("second_sample"), mode),
                "w": width, "h": height, "steps": steps,
                "sampler": sampler, "scheduler": scheduler, "ris": ref_image_size,
                "ref_model": ref_model_sig,
            }
            h = _config_hash(run_cfg)
            video_path = _seg_video(seg_idx, mode, project_id)
            tail_path = _seg_tail(seg_idx, mode, project_id)
            meta_path = _seg_meta(seg_idx, mode, project_id)
            if seg_cfg.get("force"):
                # 重抽明确不会复用旧缓存；不必先打开旧 MP4、解码首尾并核对尾帧后再丢弃结果。
                checkpoint_ok, checkpoint_reason, _meta, checkpoint_probe, legacy_checkpoint = (
                    False, "用户要求重抽当前段", None, None, False)
            else:
                checkpoint_ok, checkpoint_reason, _meta, checkpoint_probe, legacy_checkpoint = (
                    _validate_segment_checkpoint(
                        seg_idx, h, mode, project_id,
                        expected_duration=seg_cfg.get("duration", 时长秒),
                        expected_fps=seg_cfg.get("fps", 24))
                )

            if checkpoint_ok and not seg_cfg.get("force"):
                if legacy_checkpoint:
                    _complete_segment_metadata(
                        meta_path, h, seg_cfg.get("prompt", ""), checkpoint_probe, legacy=True)
                    report.append("段%d: 旧缓存已验证并升级完成检查点，跳过生成" % seg_idx)
                else:
                    report.append("段%d: 完整缓存命中，跳过生成" % seg_idx)
            else:
                if os.path.exists(video_path) or os.path.exists(meta_path):
                    cache_reason = "用户要求重抽当前段" if seg_cfg.get("force") else checkpoint_reason
                    _log("[H3导演台] 段%d缓存未复用：%s" % (seg_idx, cache_reason))
                if enabled_count == 1:
                    cached_report = list(report)
                    for other_index, other_segment in enumerate(segments, 1):
                        if not other_segment.get("enabled", True):
                            cached_report.append("段%d: 跳过（未启用）" % other_index)
                    expansion = self._expand_cached_reroll(
                        seg_idx, seg_cfg, shared_ref_names, width, height, 时长秒,
                        steps, sampler, scheduler, ref_image_size, mode,
                        effective_global_prompt, tail_mode, project_id, primary_model_kind,
                        len(segments), preserve_tail_visual_style, h, cached_report,
                        h3_prompt_graph, h3_unique_id)
                    if expansion is not None:
                        return expansion
                if shared_ref_names and not shared_refs:
                    for name in shared_ref_names:
                        try:
                            shared_refs.append(_load_input_image(name))
                        except Exception as e:
                            raise ValueError("[H3导演台] 旧工作流共享参考图加载失败 %s: %s" % (name, e)) from e
                segment_started = time.monotonic()
                start_snapshot = _memory_snapshot()
                _log("[H3导演台] 段%d/%d开始；%s" % (
                    seg_idx, len(segments), _format_memory_snapshot(start_snapshot)))
                try:
                    # 先原子提交未完成标记，同时保留上一完成版本的指针。重抽失败时旧视频仍可预览，
                    # 但检查点不会误命中，重新运行会继续生成新的编号版本。
                    pending_meta = {
                        "schema": CHECKPOINT_SCHEMA,
                        "cache_schema": CACHE_SCHEMA,
                        "hash": h,
                        "prompt": str(seg_cfg.get("prompt", "") or ""),
                        "complete": False,
                        "started_at": time.time(),
                    }
                    previous_meta = _read_segment_metadata(seg_idx, mode, project_id) or {}
                    previous_version = previous_meta.get("version")
                    if previous_version is None:
                        previous_version = _segment_file_version(video_path, seg_idx, mode, tail=False)
                    if previous_version is not None:
                        pending_meta["version"] = previous_version
                    if os.path.isfile(video_path):
                        pending_meta["active_video"] = os.path.basename(video_path)
                        pending_meta["video"] = _path_signature(video_path)
                    if os.path.isfile(tail_path):
                        pending_meta["active_tail"] = os.path.basename(tail_path)
                        pending_meta["tail"] = _path_signature(tail_path)
                    _atomic_write_json(meta_path, pending_meta)
                    video_path, _audio_samples, segment_diagnostics = self._run_segment(
                        seg_idx, seg_cfg, shared_refs, model, clip, vae, audio_vae,
                        width, height, 时长秒, steps, sampler, scheduler, ref_image_size, mode,
                        effective_global_prompt,
                        tail_mode=tail_mode, unload_per_seg=False,
                        project_id=project_id, primary_model_kind=primary_model_kind,
                        total_segments=len(segments),
                        preserve_tail_visual_style=preserve_tail_visual_style,
                        event_display_node=str(h3_unique_id or ""))
                    tail_path = _matching_segment_tail(video_path, seg_idx, mode, project_id)
                    validation_started = time.monotonic()
                    artifacts_ok, artifacts_reason, probe = _validate_segment_artifacts(
                        seg_idx, mode, project_id,
                        expected_duration=seg_cfg.get("duration", 时长秒),
                        expected_fps=seg_cfg.get("fps", 24),
                        video_path=video_path, tail_path=tail_path)
                    validation_elapsed = time.monotonic() - validation_started
                    if not artifacts_ok:
                        raise RuntimeError("[H3导演台] 段%d生成后完整性验证失败：%s" % (
                            seg_idx, artifacts_reason))
                    if segment_diagnostics.get("second_sample_error"):
                        _record_second_sample_fallback(
                            meta_path, pending_meta, video_path, tail_path,
                            segment_diagnostics["second_sample_error"],
                            _second_sample_metadata(segment_diagnostics, False))
                        raise _SecondSampleFallbackError(
                            "[H3导演台] 段%d二采失败；一次采样结果已保存为 %s，"
                            "本段未写入二采完成缓存：%s" % (
                                seg_idx, os.path.basename(video_path),
                                segment_diagnostics["second_sample_error"]))
                    _complete_segment_metadata(
                        meta_path, h, seg_cfg.get("prompt", ""), probe,
                        second_sample_diagnostics=_second_sample_metadata(
                            segment_diagnostics, True))
                except _SecondSampleFallbackError as error:
                    _cleanup_project_temp_files(project_id)
                    gc.collect()
                    preserved = ",".join(map(str, done)) if done else "无"
                    _log("[H3导演台] 段%d/%d二采失败，一采回退已完成：%s" % (
                        seg_idx, len(segments), error))
                    _log("[H3导演台] 已保留完成段：%s；跳过CUDA异常态深度卸载，"
                         "由ComfyUI执行节点收口" % preserved)
                    raise
                except Exception as error:
                    _cleanup_project_temp_files(project_id)
                    cleanup = _segment_boundary_cleanup(
                        project_id, seg_idx, force_deep=True, reason="当前段异常或用户取消")
                    preserved = ",".join(map(str, done)) if done else "无"
                    _log("[H3导演台] 段%d/%d失败：%s" % (seg_idx, len(segments), error))
                    _log("[H3导演台] 已保留完成段：%s；重新运行将从段%d继续；失败后%s" % (
                        preserved, seg_idx, "已深度释放" if cleanup["deep"] else "已轻量清理"))
                    raise
                ran.append(seg_idx)
                cleanup_started = time.monotonic()
                cleanup = _segment_boundary_cleanup(project_id, seg_idx)
                cleanup_elapsed = time.monotonic() - cleanup_started
                elapsed = time.monotonic() - segment_started
                action = "深度释放" if cleanup["deep"] else "轻量清理并继续复用模型"
                report.append("段%d: 已生成 -> %s | 耗时 %.1f 秒 | %s" % (
                    seg_idx, os.path.basename(video_path), elapsed, action))
                report.append(
                    "段%d实际参数: %dx%d | 请求 %.3f 秒 -> %d 帧 / %.3f 秒 | 实际图片参考 %d 张 | 参考图模式 %s" % (
                        seg_idx, segment_diagnostics["width"], segment_diagnostics["height"],
                        segment_diagnostics["requested_duration"], segment_diagnostics["frames"],
                        segment_diagnostics["generated_duration"],
                        segment_diagnostics["picture_references"], segment_diagnostics["ref_image_size"]))
                if segment_diagnostics.get("second_sample_mode", "off") != "off":
                    report.append(
                        "段%d二采: 整段缺陷修复 | 首采 %dx%d -> 修复 %dx%d (%.3fMP) | %d steps | denoise %.2f | "
                        "repair conditioning %s | 沿用一采音频 %s | latent %s/%s | 首采 %.1fs / 二采 %.1fs | Seed %d" % (
                            seg_idx,
                            segment_diagnostics["second_sample_first_width"],
                            segment_diagnostics["second_sample_first_height"],
                            segment_diagnostics["second_sample_target_width"],
                            segment_diagnostics["second_sample_target_height"],
                            segment_diagnostics["second_sample_target_megapixels"],
                            segment_diagnostics["second_sample_steps"],
                            segment_diagnostics["second_sample_denoise"],
                            "是" if segment_diagnostics["second_sample_repair_conditioning"] else "否",
                            "是" if segment_diagnostics["second_sample_freeze_audio"] else "否",
                            segment_diagnostics["second_sample_upscale_device"],
                            segment_diagnostics["second_sample_precision"],
                            segment_diagnostics["first_sampling"],
                            segment_diagnostics["second_sampling"],
                            int(seg_cfg.get("seed", 0))))
                    report.append(
                        "段%d二采阶段: 首采条件 %.1fs | repair条件 %.1fs | 一采引用释放 %.1fs | "
                        "Comfy模型交接 %.1fs | 3D latent放大 %.1fs | 音频回填 %.1fs" % (
                            seg_idx, segment_diagnostics["first_conditioning"],
                            segment_diagnostics["repair_conditioning_time"],
                            segment_diagnostics["second_sample_first_runtime_release"],
                            segment_diagnostics["second_sample_resource_handoff"],
                            segment_diagnostics["second_sample_latent_upscale"],
                            segment_diagnostics["second_sample_audio_restore"]))
                    if segment_diagnostics.get("second_sampling_tiled"):
                        report.append("段%d二采显存路径: 内置空间分块 %s轴 × %d，latent重叠 %d" % (
                            seg_idx, segment_diagnostics["second_sampling_tile_axis"],
                            segment_diagnostics["second_sampling_tile_count"],
                            segment_diagnostics["second_sampling_tile_overlap"]))
                    elif segment_diagnostics.get("second_sampling_tile_disabled_reason"):
                        report.append("段%d二采显存路径: 整幅采样；未分块原因：%s" % (
                            seg_idx, segment_diagnostics["second_sampling_tile_disabled_reason"]))
                    if segment_diagnostics.get("second_sample_comparison"):
                        report.append("段%d二采对比: 一次采样 %s | 当前二次采样 %s | "
                                      "一采对比解码 %.1fs / 写盘 %.1fs" % (
                            seg_idx,
                            os.path.basename(segment_diagnostics["second_sample_comparison"]),
                            os.path.basename(segment_diagnostics["second_sample_current"]),
                            segment_diagnostics["second_sample_comparison_decode"],
                            segment_diagnostics["second_sample_comparison_encode"]))
                report.append(
                    "段%d参考图片: 请求%d张 | 成功加载%d张 | 条件图像块%d个 | %s" % (
                        seg_idx, segment_diagnostics["requested_image_references"],
                        segment_diagnostics["loaded_image_references"],
                        segment_diagnostics["condition_image_reference_blocks"],
                        segment_diagnostics["reference_prompt_mode"]))
                report.append("段%d官方关键帧: %s" % (
                    seg_idx, segment_diagnostics["keyframe_mode"]))
                diagnosed = (segment_diagnostics["prepare_condition"] + segment_diagnostics["sampling"]
                             + segment_diagnostics["decode"] + segment_diagnostics["encode"])
                audio_decode_text = ("%.1fs" % segment_diagnostics["audio_decode"]
                                     if segment_diagnostics["model_audio_decoded"] else "已跳过")
                report.append(
                    "段%d分项: 参考准备/条件编码 %.1fs | 采样 %.1fs | 视频VAE %.1fs | RGB8转存 %.1fs | 音频VAE %s | MP4编码 %.1fs | 完整性验证 %.1fs | 段后清理 %.1fs | 其它 %.1fs" % (
                        seg_idx, segment_diagnostics["prepare_condition"], segment_diagnostics["sampling"],
                        segment_diagnostics["video_decode"], segment_diagnostics["frame_transfer"],
                        audio_decode_text, segment_diagnostics["encode"], validation_elapsed,
                        cleanup_elapsed, max(0.0, elapsed - diagnosed - validation_elapsed - cleanup_elapsed)))
                _log("[H3导演台] 段%d/%d完成，耗时 %.1f 秒；%s" % (
                    seg_idx, len(segments), elapsed, action))
            if checkpoint_ok or seg_idx in ran:
                done.append(seg_idx)

        # 节点返回值只承载轻量预览；完整帧与音频不回灌 ComfyUI 张量，避免长项目系统内存
        # 在多段完成时暴涨。面板运行结束后会调用 /h3director/merge，按当前最新段文件合并完整 MP4。
        images = torch.zeros((1, height, width, 3))
        frame_count = 0
        for i in done:
            images, count = _read_segment_preview(i, mode, project_id, target_size=(width, height))
            frame_count += count
        sr = 32000
        waveform = torch.zeros((1, 2, 1))
        report.append("省内存输出：IMAGE 仅返回最后一段尾帧，AUDIO 返回静音占位；各段 MP4 保留完整音画，面板会按最新分段自动合并完整 MP4")
        audio = {"waveform": waveform, "sample_rate": sr}
        report.append("本次新生成段: %s" % (",".join(map(str, ran)) if ran else "无（全部缓存）"))
        _log("[H3导演台] 完成。新生成 %s，可合并段 %s" % (ran, done))
        result = (images, audio, FPS, frame_count, "\n".join(report))
        return _result_with_video_ui(result, (_seg_video(i, mode, project_id) for i in done))


class H3DirectorOfficialConditionCache:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "clip": ("CLIP",),
            "vae": ("VAE",),
            "audio_vae": ("VAE",),
            "condition_json": ("STRING", {"default": "", "multiline": True}),
        }}

    RETURN_TYPES = ("CONDITIONING", "LATENT", "H3_DIRECTOR_PREPARED")
    FUNCTION = "prepare"
    CATEGORY = "H3导演台/内部"

    def prepare(self, clip, vae, audio_vae, condition_json):
        payload = json.loads(condition_json)
        seg_cfg = dict(payload["segment"])
        shared_refs = []
        for name in payload.get("shared_ref_names") or []:
            shared_refs.append(_load_input_image(name))
        studio = H3DirectorStudio()
        return studio._prepare_segment_condition(
            int(payload["segment_index"]) if "segment_index" in payload else 1,
            seg_cfg, shared_refs, clip, vae, audio_vae,
            int(payload["width"]), int(payload["height"]), float(payload["default_duration"]),
            payload["ref_image_size"], payload["mode"], payload.get("global_prompt", ""),
            payload["tail_mode"], payload["project_id"], payload["primary_model_kind"],
            int(payload["total_segments"]), bool(payload.get("preserve_tail_visual_style", True)))


class H3DirectorOfficialSampleCommit:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "vae": ("VAE",),
            "audio_vae": ("VAE",),
            "positive": ("CONDITIONING",),
            "latent": ("LATENT",),
            "prepared": ("H3_DIRECTOR_PREPARED",),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
            "steps": ("INT", {"default": 8, "min": 1, "max": 100}),
            "sampler_name": (comfy.samplers.SAMPLER_NAMES,),
            "scheduler": (comfy.samplers.SCHEDULER_NAMES,),
            "sample_json": ("STRING", {"default": "", "multiline": True}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO", "INT", "INT", "STRING")
    FUNCTION = "sample_commit"
    CATEGORY = "H3导演台/内部"

    def sample_commit(self, model, vae, audio_vae, positive, latent, prepared,
                      seed, steps, sampler_name, scheduler, sample_json):
        return self._commit_prepared(
            model, vae, audio_vae, positive, latent, prepared,
            seed, steps, sampler_name, scheduler, sample_json)

    def _commit_prepared(self, model, vae, audio_vae, positive, latent, prepared,
                         seed, steps, sampler_name, scheduler, sample_json):
        payload = json.loads(sample_json)
        seg_cfg = dict(payload["segment"])
        seg_cfg["seed"] = int(seed)
        seg_idx = int(payload["segment_index"])
        mode = payload["mode"]
        project_id = payload["project_id"]
        run_hash = payload["run_hash"]
        report = list(payload.get("report") or [])
        width = int(payload["width"])
        height = int(payload["height"])
        video_path = _seg_video(seg_idx, mode, project_id)
        tail_path = _seg_tail(seg_idx, mode, project_id)
        meta_path = _seg_meta(seg_idx, mode, project_id)
        segment_started = time.monotonic()
        _log("[H3导演台] 段%d开始官方缓存重抽；条件节点仅在提示词或参考素材变化时重算" % seg_idx)
        try:
            pending_meta = {
                "schema": CHECKPOINT_SCHEMA,
                "cache_schema": CACHE_SCHEMA,
                "hash": run_hash,
                "prompt": str(seg_cfg.get("prompt", "") or ""),
                "complete": False,
                "started_at": time.time(),
            }
            previous_meta = _read_segment_metadata(seg_idx, mode, project_id) or {}
            previous_version = previous_meta.get("version")
            if previous_version is None:
                previous_version = _segment_file_version(video_path, seg_idx, mode, tail=False)
            if previous_version is not None:
                pending_meta["version"] = previous_version
            if os.path.isfile(video_path):
                pending_meta["active_video"] = os.path.basename(video_path)
                pending_meta["video"] = _path_signature(video_path)
            if os.path.isfile(tail_path):
                pending_meta["active_tail"] = os.path.basename(tail_path)
                pending_meta["tail"] = _path_signature(tail_path)
            _atomic_write_json(meta_path, pending_meta)

            studio = H3DirectorStudio()
            video_path, _audio_samples, diagnostics = studio._sample_prepared_segment(
                seg_idx, seg_cfg, model, vae, audio_vae, positive, latent, prepared,
                int(steps), sampler_name, scheduler, mode, project_id,
                prepare_condition_elapsed=0.0,
                event_display_node=str(payload.get("display_node") or ""))
            tail_path = _matching_segment_tail(video_path, seg_idx, mode, project_id)
            validation_started = time.monotonic()
            artifacts_ok, artifacts_reason, probe = _validate_segment_artifacts(
                seg_idx, mode, project_id,
                expected_duration=seg_cfg.get("duration", prepared["requested_duration"]),
                expected_fps=seg_cfg.get("fps", 24), video_path=video_path, tail_path=tail_path)
            validation_elapsed = time.monotonic() - validation_started
            if not artifacts_ok:
                raise RuntimeError("[H3导演台] 段%d生成后完整性验证失败：%s" % (
                    seg_idx, artifacts_reason))
            if diagnostics.get("second_sample_error"):
                _record_second_sample_fallback(
                    meta_path, pending_meta, video_path, tail_path,
                    diagnostics["second_sample_error"],
                    _second_sample_metadata(diagnostics, False))
                raise _SecondSampleFallbackError(
                    "[H3导演台] 段%d二采失败；一次采样结果已保存为 %s，"
                    "本段未写入二采完成缓存：%s" % (
                        seg_idx, os.path.basename(video_path), diagnostics["second_sample_error"]))
            _complete_segment_metadata(
                meta_path, run_hash, seg_cfg.get("prompt", ""), probe,
                second_sample_diagnostics=_second_sample_metadata(diagnostics, True))
        except _SecondSampleFallbackError:
            _cleanup_project_temp_files(project_id)
            gc.collect()
            _log("[H3导演台] 段%d二采失败，一采回退已完成；跳过CUDA异常态深度卸载，"
                 "由ComfyUI执行节点收口" % seg_idx)
            raise
        except Exception:
            _cleanup_project_temp_files(project_id)
            _segment_boundary_cleanup(project_id, seg_idx, force_deep=True, reason="当前段异常或用户取消")
            raise

        cleanup_started = time.monotonic()
        cleanup = _segment_boundary_cleanup(project_id, seg_idx)
        cleanup_elapsed = time.monotonic() - cleanup_started
        elapsed = time.monotonic() - segment_started
        action = "深度释放" if cleanup["deep"] else "轻量清理并继续复用模型"
        report.append("段%d: 已生成 -> %s | 采样到落盘耗时 %.1f 秒 | %s" % (
            seg_idx, os.path.basename(video_path), elapsed, action))
        report.append(
            "段%d实际参数: %dx%d | 请求 %.3f 秒 -> %d 帧 / %.3f 秒 | 实际图片参考 %d 张 | 参考图模式 %s" % (
                seg_idx, diagnostics["width"], diagnostics["height"],
                diagnostics["requested_duration"], diagnostics["frames"],
                diagnostics["generated_duration"], diagnostics["picture_references"],
                diagnostics["ref_image_size"]))
        if diagnostics.get("second_sample_mode", "off") != "off":
            report.append(
                "段%d二采: 整段缺陷修复 | 首采 %dx%d -> 修复 %dx%d (%.3fMP) | %d steps | denoise %.2f | "
                "repair conditioning %s | 沿用一采音频 %s | latent %s/%s | 首采 %.1fs / 二采 %.1fs | Seed %d" % (
                    seg_idx, diagnostics["second_sample_first_width"],
                    diagnostics["second_sample_first_height"],
                    diagnostics["second_sample_target_width"],
                    diagnostics["second_sample_target_height"],
                    diagnostics["second_sample_target_megapixels"],
                    diagnostics["second_sample_steps"],
                    diagnostics["second_sample_denoise"],
                    "是" if diagnostics["second_sample_repair_conditioning"] else "否",
                    "是" if diagnostics["second_sample_freeze_audio"] else "否",
                    diagnostics["second_sample_upscale_device"],
                    diagnostics["second_sample_precision"],
                    diagnostics["first_sampling"],
                    diagnostics["second_sampling"], int(seg_cfg.get("seed", 0))))
            report.append(
                "段%d二采阶段: 首采条件 %.1fs | repair条件 %.1fs | 一采引用释放 %.1fs | "
                "Comfy模型交接 %.1fs | 3D latent放大 %.1fs | 音频回填 %.1fs" % (
                    seg_idx, diagnostics["first_conditioning"],
                    diagnostics["repair_conditioning_time"],
                    diagnostics["second_sample_first_runtime_release"],
                    diagnostics["second_sample_resource_handoff"],
                    diagnostics["second_sample_latent_upscale"],
                    diagnostics["second_sample_audio_restore"]))
            if diagnostics.get("second_sampling_tiled"):
                report.append("段%d二采显存路径: 内置空间分块 %s轴 × %d，latent重叠 %d" % (
                    seg_idx, diagnostics["second_sampling_tile_axis"],
                    diagnostics["second_sampling_tile_count"],
                    diagnostics["second_sampling_tile_overlap"]))
            elif diagnostics.get("second_sampling_tile_disabled_reason"):
                report.append("段%d二采显存路径: 整幅采样；未分块原因：%s" % (
                    seg_idx, diagnostics["second_sampling_tile_disabled_reason"]))
            if diagnostics.get("second_sample_comparison"):
                report.append("段%d二采对比: 一次采样 %s | 当前二次采样 %s | "
                              "一采对比解码 %.1fs / 写盘 %.1fs" % (
                    seg_idx, os.path.basename(diagnostics["second_sample_comparison"]),
                    os.path.basename(diagnostics["second_sample_current"]),
                    diagnostics["second_sample_comparison_decode"],
                    diagnostics["second_sample_comparison_encode"]))
        report.append(
            "段%d参考图片: 请求%d张 | 成功加载%d张 | 条件图像块%d个 | %s" % (
                seg_idx, diagnostics["requested_image_references"],
                diagnostics["loaded_image_references"],
                diagnostics["condition_image_reference_blocks"],
                diagnostics["reference_prompt_mode"]))
        report.append("段%d官方关键帧: %s" % (seg_idx, diagnostics["keyframe_mode"]))
        audio_decode_text = ("%.1fs" % diagnostics["audio_decode"]
                             if diagnostics["model_audio_decoded"] else "已跳过")
        report.append(
            "段%d官方缓存分项: 采样 %.1fs | 视频VAE %.1fs | RGB8转存 %.1fs | 音频VAE %s | MP4编码 %.1fs | 完整性验证 %.1fs | 段后清理 %.1fs | 其它 %.1fs" % (
                seg_idx, diagnostics["sampling"], diagnostics["video_decode"],
                diagnostics["frame_transfer"], audio_decode_text, diagnostics["encode"],
                validation_elapsed, cleanup_elapsed,
                max(0.0, elapsed - diagnostics["sampling"] - diagnostics["decode"]
                    - diagnostics["encode"] - validation_elapsed - cleanup_elapsed)))
        report.append("官方条件缓存：提示词、参考素材、尺寸和时长不变时，Seed重抽不再重复Qwen3-VL条件编码。")
        images, frame_count = _read_segment_preview(
            seg_idx, mode, project_id, target_size=(width, height))
        audio = {"waveform": torch.zeros((1, 2, 1)), "sample_rate": 32000}
        report.append("省内存输出：IMAGE 仅返回当前段尾帧，AUDIO 返回静音占位；完整音画保存在分段 MP4。")
        report.append("本次新生成段: %d" % seg_idx)
        result = (images, audio, FPS, frame_count, "\n".join(report))
        return _result_with_video_ui(result, (video_path,))


NODE_CLASS_MAPPINGS = {
    "H3DirectorStudio": H3DirectorStudio,
    "H3DirectorOfficialConditionCache": H3DirectorOfficialConditionCache,
    "H3DirectorOfficialSampleCommit": H3DirectorOfficialSampleCommit,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3DirectorStudio": "导演台·一体节点",
    "H3DirectorOfficialConditionCache": "导演台·官方条件缓存（内部）",
    "H3DirectorOfficialSampleCommit": "导演台·官方采样提交（内部）",
}
