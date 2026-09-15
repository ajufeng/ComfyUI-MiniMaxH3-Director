# -*- coding: utf-8 -*-
"""H3 漫剧导演台·一体节点（H3DirectorStudio）
单节点内部完成多段编排：编码参考图+提示词 → 采样 → 解码 → 存段视频/尾帧 → 合并。
段间文件接力（tail_segN.png），配置哈希匹配的段自动跳过，可断点续跑。
"""
import os
import gc
import sys
import re
import json
import glob
import hashlib
import math
import subprocess
import tempfile
import threading
import time

import numpy as np
import torch
from PIL import Image

import folder_paths
import nodes
import comfy.samplers
import comfy.utils
import comfy.model_management
import comfy.model_prefetch
import latent_preview
from comfy_execution.graph_utils import GraphBuilder
from comfy_execution.utils import get_executing_context
from comfy_extras.nodes_custom_sampler import Noise_EmptyNoise, Noise_RandomNoise, Guider_Basic
from comfy_extras.nodes_lt import LTXVConcatAVLatent, LTXVSeparateAVLatent
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ReferenceToVideo, MiniMaxH3ImageToVideo
from comfy_extras.nodes_audio import vae_decode_audio
from server import PromptServer

from .media_utils import (
    MERGE_AUDIO_RATE,
    enforce_continuity_start,
    extract_clean_tail_frame,
    lossless_tail_is_current,
    select_clean_tail_frame,
    stable_audio_filter,
    write_tail_frame_if_changed,
)

CATEGORY = "H3导演台"
OUTPUT_DIR = folder_paths.get_output_directory()
INPUT_DIR = folder_paths.get_input_directory()
VIDEO_DIR = os.path.join(OUTPUT_DIR, "video")
PROJECT_ROOT = os.path.join(VIDEO_DIR, "h3director")
FPS = 24
CACHE_SCHEMA = 15
CHECKPOINT_SCHEMA = 2  # 段级 MP4/尾帧/JSON 完成检查点

DEFAULT_REPAIR_PROMPT = (
    "修复一采中的结构畸形、重影、重复或缺失部件、破损边缘、纹理断裂和闪烁；"
    "严格保持原剧情时序、运镜、构图、主体身份、服装、动作、场景、画面风格和正常区域不变。"
)
SECOND_SAMPLE_PRESETS = {
    "light": {"steps": 5, "denoise": 0.15},
    "standard": {"steps": 7, "denoise": 0.22},
    "strong": {"steps": 9, "denoise": 0.30},
    "conservative": {"steps": 5, "denoise": 0.15},
    "balanced": {"steps": 7, "denoise": 0.22},
}
SECOND_SAMPLE_PRESET_VERSION = 4
SECOND_SAMPLE_TILE_MIN_AXIS = 64
SECOND_SAMPLE_TILE_OVERLAP = 8
SECOND_SAMPLE_COMMON_NODE_IDS = (
    "MinimaxH3LatentUpscaler3D",
    "MiniMaxH3AddNoise",
    "MiniMaxH3ShiftSigmas",
)
SECOND_SAMPLE_STAGES = (
    ("first_release", "释放一采运行资源"),
    ("latent_upscale", "3D latent 放大"),
    ("upscale_release", "释放放大临时资源"),
    ("h3_reload_or_prepare", "准备 H3 二采模型"),
    ("second_sampling", "H3 二次采样"),
    ("audio_restore", "恢复一采音频"),
)


class _SecondSampleFallbackError(RuntimeError):
    pass


def _log(msg):
    try:
        print(msg)
    except Exception:
        pass


def _validate_second_sample_model_name(value):
    name = str(value or "").strip()
    if (not name or len(name) > 500 or name != os.path.basename(name)
            or "/" in name or "\\" in name or os.path.isabs(name)
            or os.path.splitdrive(name)[0] or name in (".", "..")):
        raise ValueError("二采 upscaler_model 必须是本地权重文件名，不能包含路径")
    lower = name.lower()
    if ("3d" not in lower or "fp16" not in lower or "fp32" in lower or "bf16" in lower
            or not lower.endswith((".pth", ".safetensors"))):
        raise ValueError("二采 upscaler_model 必须是 MiniMax H3 3D FP16 权重")
    return name


def _normalize_second_sample_config(value, mode="create"):
    if mode not in ("create", "video", "text") or not isinstance(value, dict):
        return {"mode": "off"}
    sample_mode = str(value.get("mode") or "off")
    if sample_mode == "off":
        return {"mode": "off"}
    if sample_mode in SECOND_SAMPLE_PRESETS:
        numbers = SECOND_SAMPLE_PRESETS[sample_mode]
    elif sample_mode == "custom":
        numbers = {
            "steps": min(30, max(1, int(value.get("steps") or 4))),
            "denoise": min(0.95, max(0.01, float(value.get("denoise") or 0.15))),
        }
    else:
        return {"mode": "off"}
    repair_prompt = str(value.get("repair_prompt") or DEFAULT_REPAIR_PROMPT).strip()
    legacy_width = value.get("final_width")
    legacy_height = value.get("final_height")
    target_size_mode = str(value.get("target_size_mode") or "").strip().lower()
    if not target_size_mode and legacy_width and legacy_height:
        target_size_mode = "dimensions"
    elif target_size_mode not in ("megapixels", "dimensions"):
        target_size_mode = "megapixels"
    final_width = int(legacy_width or value.get("target_width") or 0)
    final_height = int(legacy_height or value.get("target_height") or 0)
    if bool(final_width) != bool(final_height):
        raise ValueError("二采 final_width/final_height 必须同时提供")
    if final_width and (final_width < 32 or final_height < 32):
        raise ValueError("二采 final_width/final_height 不能小于 32")
    if final_width and (final_width % 32 or final_height % 32):
        raise ValueError("二采 final_width/final_height 必须是 32 的倍数，不能静默改变尺寸")
    if target_size_mode == "dimensions" and not final_width:
        raise ValueError("尺寸模式缺少 final_width/final_height")
    source_preset_version = int(value.get("preset_version") or 0)
    upscaler_model = str(value.get("upscaler_model") or "").strip()
    if upscaler_model:
        upscaler_model = _validate_second_sample_model_name(upscaler_model)
    elif source_preset_version >= SECOND_SAMPLE_PRESET_VERSION:
        raise ValueError("二采配置缺少明确的 upscaler_model，请先选择 3D latent 放大权重")
    normalized = {
        "mode": sample_mode,
        "strategy": "latent_repair",
        "preset_version": SECOND_SAMPLE_PRESET_VERSION,
        "first_megapixels": min(4.0, max(0.1, float(value.get("first_megapixels") or 0.4))),
        "target_size_mode": target_size_mode,
        "steps": numbers["steps"],
        "denoise": numbers["denoise"],
        "repair_prompt": repair_prompt[:4000] or DEFAULT_REPAIR_PROMPT,
        "sampling_layout": "full" if value.get("sampling_layout") == "full" else "tiled",
        "freeze_audio": True,
        "save_comparison": value.get("save_comparison") is not False,
    }
    if upscaler_model:
        normalized["upscaler_model"] = upscaler_model
    else:
        normalized["legacy_upscaler_model"] = True
    if target_size_mode == "megapixels":
        target_megapixels = value.get("target_megapixels")
        target_megapixels = 1.0 if target_megapixels in (None, "") else float(target_megapixels)
        if not math.isfinite(target_megapixels) or target_megapixels <= 0:
            raise ValueError("二采 target_megapixels 必须是有限正数")
        normalized["target_megapixels"] = target_megapixels
    if final_width:
        normalized["final_width"] = final_width
        normalized["final_height"] = final_height
    return normalized


def _second_sample_target_size(config, width, height):
    width, height = int(width), int(height)
    if config["target_size_mode"] == "dimensions":
        return int(config["final_width"]), int(config["final_height"])
    scale = (float(config["target_megapixels"]) * 1_000_000.0 / (width * height)) ** 0.5
    target_width = max(32, int(width * scale / 32.0 + 0.5) * 32)
    target_height = max(32, int(height * scale / 32.0 + 0.5) * 32)
    final_width = int(config.get("final_width") or 0)
    final_height = int(config.get("final_height") or 0)
    if final_width and (final_width != target_width or final_height != target_height):
        raise ValueError(
            "二采运行载荷 final_width/final_height 与 target_megapixels 按当前画幅计算的对齐尺寸不一致")
    if final_width:
        return final_width, final_height
    return target_width, target_height


def _second_sample_first_pass_size(width, height, megapixels):
    width, height = int(width), int(height)
    scale = min(1.0, (max(0.1, float(megapixels)) * 1_000_000.0 / (width * height)) ** 0.5)
    max_width = max(32, width // 32 * 32)
    max_height = max(32, height // 32 * 32)
    first_width = max(32, int(width * scale / 32.0 + 0.5) * 32)
    first_height = max(32, int(height * scale / 32.0 + 0.5) * 32)
    return min(max_width, first_width), min(max_height, first_height)


def _second_sample_model_name(selected_model="", legacy=False):
    try:
        choices = folder_paths.get_filename_list("latent_upscale_models")
    except (KeyError, OSError):
        raise RuntimeError("二采缺少 Minimax H3 3D latent 放大组件")
    valid = []
    for candidate in choices:
        try:
            valid.append(_validate_second_sample_model_name(candidate))
        except ValueError:
            continue
    choices = sorted(set(valid), key=str.casefold)
    if not choices:
        raise FileNotFoundError("没有找到本地 MiniMax H3 3D FP16 latent 放大模型")
    if selected_model:
        name = _validate_second_sample_model_name(selected_model)
        if name not in choices:
            raise FileNotFoundError("没有找到已选择的二采 3D latent 放大模型：%s" % name)
    elif legacy and len(choices) == 1:
        name = choices[0]
    elif legacy:
        raise RuntimeError("旧二采工作流检测到多个 3D FP16 权重，请明确选择 upscaler_model")
    else:
        raise ValueError("二采配置缺少明确的 upscaler_model")
    path = folder_paths.get_full_path("latent_upscale_models", name)
    if not path or not os.path.isfile(path):
        raise FileNotFoundError("没有找到二采 3D latent 放大模型：%s" % name)
    roots = folder_paths.get_folder_paths("latent_upscale_models")
    path_real = os.path.normcase(os.path.realpath(path))
    for root in roots:
        try:
            if os.path.commonpath((os.path.normcase(os.path.realpath(root)), path_real)) == os.path.normcase(os.path.realpath(root)):
                return name
        except ValueError:
            continue
    raise ValueError("二采模型不在 ComfyUI 配置目录内")


def _second_sample_upscaler_memory_required(model_name):
    path = folder_paths.get_full_path("latent_upscale_models", model_name)
    if not path or not os.path.isfile(path):
        raise FileNotFoundError("没有找到二采 3D latent 放大模型：%s" % model_name)
    return os.path.getsize(path) + int(comfy.model_management.minimum_inference_memory())


def _second_sample_upscale_runtime():
    model_management = comfy.model_management
    torch_device = model_management.get_torch_device()
    device_type = str(getattr(torch_device, "type", "") or "").lower()
    vram_state = str(getattr(getattr(model_management, "vram_state", None), "name", "") or "")
    if device_type == "cuda" and vram_state not in ("LOW_VRAM", "NO_VRAM"):
        if model_management.should_use_fp16(torch_device):
            precision = "fp16"
        elif model_management.should_use_bf16(torch_device):
            precision = "bf16"
        else:
            precision = "fp32"
        return "cuda", precision, str(torch_device), ""
    if device_type == "cuda":
        reason = "ComfyUI 处于 %s，3D latent upscaler 不支持模型卸载，改用 CPU FP32" % vram_state
    elif device_type == "cpu":
        reason = "ComfyUI 使用 CPU，3D latent upscaler 使用 CPU FP32"
    else:
        reason = "3D latent upscaler 仅接受 cuda/cpu，不支持 ComfyUI 设备 %s，改用 CPU FP32" % (
            device_type or str(torch_device))
    return "cpu", "fp32", str(torch_device), reason


def _second_sample_nodes():
    missing = [node_id for node_id in SECOND_SAMPLE_COMMON_NODE_IDS
               if node_id not in nodes.NODE_CLASS_MAPPINGS]
    if missing:
        raise RuntimeError(
            "[H3导演台] 二采缺少外部组件节点：%s。请安装 3D latent 放大与 H3 二采组件后重启 ComfyUI。"
            % ", ".join(missing))
    return tuple(nodes.NODE_CLASS_MAPPINGS[node_id]
                 for node_id in SECOND_SAMPLE_COMMON_NODE_IDS)


def _second_sample_resource_handoff(model, memory_required=0):
    started = time.monotonic()
    model_management = comfy.model_management
    before = _loaded_model_count()
    required = max(0, int(memory_required or 0))
    device = model.load_device
    free_before = int(model_management.get_free_memory(device))
    registered_before = any(loaded is model for loaded in (model_management.loaded_models() or ()))
    managed_unloaded = 0
    model_memory_released = 0
    cast_buffers_reset = False
    prefetch_queues_cleaned = False
    model_dynamic = bool(model.is_dynamic())
    if required > 0 and model_dynamic:
        model_management.reset_cast_buffers()
        cast_buffers_reset = True
        comfy.model_prefetch.cleanup_prefetch_queues()
        prefetch_queues_cleaned = True
    gc.collect()
    if required > 0:
        keep_loaded = [model_management.LoadedModel(model)] if registered_before else []
        unloaded = model_management.free_memory(required, device, keep_loaded=keep_loaded)
        managed_unloaded = len(unloaded or ())
        shortfall = max(0, required - int(model_management.get_free_memory(device)))
        if registered_before and shortfall > 0:
            model_memory_released = int(
                model.partially_unload(model.offload_device, shortfall) or 0)
    model_management.soft_empty_cache()
    after = _loaded_model_count()
    registered_after = any(loaded is model for loaded in (model_management.loaded_models() or ()))
    return {
        "elapsed": time.monotonic() - started,
        "before_models": before,
        "after_models": after,
        "memory_required": required,
        "free_before": free_before,
        "free_after": int(model_management.get_free_memory(device)),
        "managed_models_unloaded": managed_unloaded,
        "model_memory_released": model_memory_released,
        "cast_buffers_reset": cast_buffers_reset,
        "prefetch_queues_cleaned": prefetch_queues_cleaned,
        "model_dynamic": model_dynamic,
        "model_registered_before": registered_before,
        "model_registered_after": registered_after,
    }


def _second_sample_tile_disabled_reason(samples, config, picture_references=0,
                                        allow_picture_references=False):
    if not isinstance(samples, torch.Tensor) or samples.dim() != 5:
        return "目标视频 latent 不是 5 维"
    if config.get("sampling_layout") == "full":
        return "用户选择整幅一次采样"
    if config.get("freeze_audio") is not True:
        return "未冻结一采音频"
    if float(config.get("denoise") or 0.0) > 0.35:
        return "denoise 高于 0.35"
    if int(picture_references or 0) > 0 and allow_picture_references is not True:
        return "当前文本页包含参考图"
    height = int(samples.shape[-2])
    width = int(samples.shape[-1])
    if max(height, width) < SECOND_SAMPLE_TILE_MIN_AXIS:
        return "目标 latent 长轴小于 %d" % SECOND_SAMPLE_TILE_MIN_AXIS
    return ""


def _second_sample_tile_plan(samples, config, picture_references=0,
                             allow_picture_references=False):
    if _second_sample_tile_disabled_reason(
            samples, config, picture_references, allow_picture_references):
        return None
    height = int(samples.shape[-2])
    width = int(samples.shape[-1])
    axis = -1 if width >= height else -2
    total = width if axis == -1 else height
    tile_size = int(math.ceil((total + SECOND_SAMPLE_TILE_OVERLAP) / 2.0))
    second_start = total - tile_size
    overlap = tile_size - second_start
    return {
        "axis": axis,
        "axis_name": "W" if axis == -1 else "H",
        "ranges": ((0, tile_size), (second_start, total)),
        "overlap": overlap,
    }


def _second_sample_tile_conditioning(conditioning, axis, start, end,
                                     full_height, full_width):
    if not isinstance(conditioning, (list, tuple)):
        return conditioning
    changed = False
    tiled = []
    for entry in conditioning:
        if (not isinstance(entry, (list, tuple)) or len(entry) < 2
                or not isinstance(entry[1], dict)):
            tiled.append(entry)
            continue
        keyframes = entry[1].get("minimax_keyframes")
        if not isinstance(keyframes, (list, tuple)) or not keyframes:
            tiled.append(entry)
            continue
        tiled_keyframes = []
        for keyframe in keyframes:
            latent = keyframe.get("latent") if isinstance(keyframe, dict) else None
            if not isinstance(latent, torch.Tensor) or latent.dim() < 2:
                raise ValueError("H3 二采关键帧缺少有效 latent")
            if tuple(latent.shape[-2:]) != (int(full_height), int(full_width)):
                raise ValueError(
                    "H3 二采关键帧 latent 尺寸 %dx%d 与目标 %dx%d 不一致" % (
                        int(latent.shape[-1]), int(latent.shape[-2]),
                        int(full_width), int(full_height)))
            tiled_keyframe = dict(keyframe)
            if axis == -1:
                tiled_keyframe["latent"] = latent[..., start:end].contiguous()
            else:
                tiled_keyframe["latent"] = latent[..., start:end, :].contiguous()
            tiled_keyframes.append(tiled_keyframe)
        metadata = dict(entry[1])
        metadata["minimax_keyframes"] = tiled_keyframes
        tiled_entry = list(entry)
        tiled_entry[1] = metadata
        tiled.append(tuple(tiled_entry) if isinstance(entry, tuple) else tiled_entry)
        changed = True
    if not changed:
        return conditioning
    return tuple(tiled) if isinstance(conditioning, tuple) else tiled


def _second_sample_tile_window(length, fade_left, fade_right, device):
    window = torch.ones(length, dtype=torch.float32, device=device)
    if fade_left > 0:
        blend = 0.5 - 0.5 * torch.cos(torch.linspace(
            0.0, math.pi, fade_left, dtype=torch.float32, device=device))
        window[:fade_left] = blend
    if fade_right > 0:
        blend = 0.5 - 0.5 * torch.cos(torch.linspace(
            0.0, math.pi, fade_right, dtype=torch.float32, device=device))
        window[-fade_right:] = 1.0 - blend
    return window


def _node_result(output):
    result = output.result if hasattr(output, "result") else output
    if isinstance(result, tuple):
        return result
    if isinstance(result, list):
        return tuple(result)
    return (result,)


def _second_sample_upscale_video(upscale_node, video_latent, model_name,
                                target_width, target_height, device, precision):
    output = None
    result = None
    try:
        output = upscale_node.execute(
            video_latent, model_name,
            {"mode": "target dimensions", "width": target_width, "height": target_height},
            32, False, device, precision)
        result = _node_result(output)[0]
        samples = result["samples"]
        intermediate = comfy.model_management.intermediate_device()
        retained = samples.to(intermediate)
        if retained is samples:
            return result
        normalized = result.copy()
        normalized["samples"] = retained
        return normalized
    finally:
        output = None
        result = None


def _second_sample_release_upscaler_cache(upscale_node, model_name, device, precision):
    runtime_device = torch.device(device)
    if runtime_device.type != "cuda":
        return {
            "attempted": False,
            "released": False,
            "cache_key": "",
            "cached_before": None,
            "cached_after": True,
            "remaining_entries": None,
        }
    node_class = upscale_node if isinstance(upscale_node, type) else type(upscale_node)
    module_name = str(getattr(node_class, "__module__", "") or "")
    if (getattr(node_class, "__name__", "") != "MinimaxH3LatentUpscaler3D"
            or not module_name.endswith("minimax_h3_latent_upscaler_3d")):
        raise RuntimeError("作者 3D 放大节点版本不兼容：无法安全释放本次 CUDA 缓存")
    module = sys.modules.get(module_name)
    cache = getattr(module, "MODEL_CACHE", None) if module is not None else None
    if not isinstance(cache, dict):
        raise RuntimeError("作者 3D 放大节点未提供预期缓存结构，已停止二采以避免显存卡死")
    cache_key = "%s::%s::%s" % (model_name, runtime_device, precision)
    if cache_key not in cache:
        raise RuntimeError("没有找到本次 3D CUDA 模型缓存，已停止二采以避免误删其它模型")
    cache.pop(cache_key)
    return {
        "attempted": True,
        "released": True,
        "cache_key": cache_key,
        "cached_before": True,
        "cached_after": cache_key in cache,
        "remaining_entries": len(cache),
    }


# 用户友好的参考图引用写法 -> 模型原生 <Picture N> 标签
_AT_REF_PATTERNS = [
    (re.compile(r"[@＠]图\s*(\d+)"), r"<Picture \1>"),          # @图1 / ＠图1
    (re.compile(r"[@＠][Pp]icture\s*(\d+)"), r"<Picture \1>"),   # @picture1
    (re.compile(r"[@＠][Ii][Mm][Aa]?[Gg][Ee]?\s*(\d+)"), r"<Picture \1>"),  # @image1 / @img1
    (re.compile(r"【图\s*(\d+)】"), r"<Picture \1>"),            # 【图1】
]

# 用户友好的参考音色引用写法 -> 模型原生 <Audio N> 标签
_AT_AUDIO_REF_PATTERNS = [
    (re.compile(r"[@＠]音\s*(\d+)"), r"<Audio \1>"),            # @音1 / ＠音1
    (re.compile(r"[@＠][Aa]udio\s*(\d+)"), r"<Audio \1>"),      # @audio1
    (re.compile(r"【音\s*(\d+)】"), r"<Audio \1>"),              # 【音1】
]


def _convert_at_refs(prompt):
    if not prompt:
        return prompt
    out = prompt
    for pat, rep in _AT_REF_PATTERNS:
        out = pat.sub(rep, out)
    img_changed = out != prompt
    for pat, rep in _AT_AUDIO_REF_PATTERNS:
        out = pat.sub(rep, out)
    if img_changed or out != prompt:
        _log("[H3导演台] 提示词引用转换: @图N -> <Picture N>, @音N -> <Audio N>")
    return out


_GENERATED_ASSET_BINDING_HEADER_RE = re.compile(
    r"^\s*Reference asset bindings \(project IDs stay stable; "
    r"Subject/Picture numbers follow this segment's image order\):\s*$", re.I)
_GENERATED_ASSET_IDENTITY_RE = re.compile(r"^\s*Reference identity contract:", re.I)
_PICTURE_REF_RE = re.compile(r"<Picture\s+(\d+)>", re.I)
_SUBJECT_REF_RE = re.compile(r"<Subject\s+(\d+)>", re.I)
_MALFORMED_REFERENCE_CLOSE_RE = re.compile(r"(<(?:Picture|Subject)\s+\d+>)>+", re.I)


def _count_condition_image_reference_blocks(conditioning):
    counts = []
    for item in conditioning or []:
        if not isinstance(item, (list, tuple)) or len(item) < 2 or not isinstance(item[1], dict):
            continue
        refs = item[1].get("minimax_refs") or []
        counts.append(sum(1 for block in refs if isinstance(block, dict) and block.get("kind") == "image"))
    return max(counts, default=0)


def _normalize_prompt_picture_references(prompt, picture_count):
    """移除超出实际参考图数量的 Picture 声明，避免旧前端绑定污染当前段。"""
    try:
        picture_count = max(0, int(picture_count or 0))
    except (TypeError, ValueError):
        picture_count = 0
    removed = set()
    source = _MALFORMED_REFERENCE_CLOSE_RE.sub(r"\1", str(prompt or ""))
    generated_subject_pictures = []
    in_generated_binding = False
    for line in source.splitlines():
        if _GENERATED_ASSET_BINDING_HEADER_RE.match(line):
            in_generated_binding = True
            continue
        if not in_generated_binding:
            continue
        if re.match(r"^\s*<Subject\s+\d+>", line, re.I):
            picture = _PICTURE_REF_RE.search(line)
            if picture:
                generated_subject_pictures.append(int(picture.group(1)))
            continue
        if _GENERATED_ASSET_IDENTITY_RE.match(line) or not line.strip():
            continue
        in_generated_binding = False
    if generated_subject_pictures and len(generated_subject_pictures) <= picture_count:
        first_actual_picture = picture_count - len(generated_subject_pictures) + 1
        replacements = []
        for index, old_picture in enumerate(generated_subject_pictures):
            new_picture = first_actual_picture + index
            if old_picture == new_picture:
                continue
            placeholder = "__H3_RUNTIME_PICTURE_%d__" % index
            source = re.sub(r"<Picture\s+%d>" % old_picture, placeholder, source, flags=re.I)
            replacements.append((placeholder, new_picture))
        for placeholder, new_picture in replacements:
            source = source.replace(placeholder, "<Picture %d>" % new_picture)

    def normalize_line(line):
        matches = [int(match.group(1)) for match in _PICTURE_REF_RE.finditer(line)]
        invalid = [number for number in matches if number < 1 or number > picture_count]
        removed.update(invalid)
        if invalid and re.match(r"^\s*<Subject\s+\d+>", line, re.I):
            return None
        return _PICTURE_REF_RE.sub(
            lambda match: "<Picture %d>" % int(match.group(1))
            if 1 <= int(match.group(1)) <= picture_count else "", line)

    lines = source.splitlines()
    normalized = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if not _GENERATED_ASSET_BINDING_HEADER_RE.match(line):
            updated = normalize_line(line)
            if updated is not None:
                normalized.append(updated)
            index += 1
            continue

        index += 1
        subjects = []
        identity = None
        while index < len(lines):
            item = lines[index]
            if re.match(r"^\s*<Subject\s+\d+>", item, re.I):
                updated = normalize_line(item)
                if updated is not None:
                    subjects.append(updated)
                index += 1
                continue
            if _GENERATED_ASSET_IDENTITY_RE.match(item):
                identity = item
                index += 1
                continue
            if not item.strip():
                index += 1
            break
        if subjects:
            normalized.append(line)
            normalized.extend(subjects)
            if identity:
                normalized.append(identity)
            normalized.append("")

    return "\n".join(normalized).strip(), sorted(removed)


_OFFICIAL_FIELD_NAMES = (
    "subject_definitions", "summary", "retention_analysis", "detailed_description",
    "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music",
    "director_import_manifest",
)
_OFFICIAL_FIELD_RE = re.compile(
    r"(?:^|\n)[ \t]*(%s)[ \t]*[:：][ \t]*" % "|".join(_OFFICIAL_FIELD_NAMES), re.I)


def _split_official_prompt_fields(prompt):
    text = str(prompt or "").strip()
    marks = list(_OFFICIAL_FIELD_RE.finditer(text))
    if not marks:
        return text, {}
    prefix = text[:marks[0].start()].strip()
    fields = {}
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        fields.setdefault(mark.group(1).lower(), text[mark.end():end].strip())
    return prefix, fields


def _strip_generated_asset_binding(prompt):
    lines = str(prompt or "").splitlines()
    kept = []
    index = 0
    while index < len(lines):
        if not _GENERATED_ASSET_BINDING_HEADER_RE.match(lines[index]):
            kept.append(lines[index])
            index += 1
            continue
        index += 1
        while index < len(lines):
            line = lines[index]
            if re.match(r"^\s*<Subject\s+\d+>", line, re.I) \
                    or _GENERATED_ASSET_IDENTITY_RE.match(line) or not line.strip():
                index += 1
                continue
            break
    return "\n".join(kept).strip()


def _render_official_ref2va(fields):
    order = (
        "subject_definitions", "summary", "retention_analysis", "detailed_description",
        "overall_soundscape", "non_diegetic_music",
    )
    parts = ["%s:\n%s" % (name, str(fields.get(name, "")).strip()) for name in order]
    manifest = str(fields.get("director_import_manifest", "") or "").strip()
    if manifest:
        parts.append("director_import_manifest:\n" + manifest)
    return "\n\n".join(parts).strip()


def _ensure_official_ref2va_prompt(prompt, picture_count, force=False):
    """参考素材存在时只发送一套官方 Ref2VA 六字段，不保留旧的越界 Subject/Picture。"""
    try:
        picture_count = max(0, int(picture_count or 0))
    except (TypeError, ValueError):
        picture_count = 0
    prompt = _MALFORMED_REFERENCE_CLOSE_RE.sub(r"\1", str(prompt or ""))
    prefix, fields = _split_official_prompt_fields(prompt)
    is_ref2va = any(name in fields for name in (
        "subject_definitions", "summary", "retention_analysis", "detailed_description"))
    if not force and not is_ref2va:
        return str(prompt or "").strip()

    if fields:
        detailed = str(fields.get("detailed_description")
                       or fields.get("integrated_multimodal_description") or "").strip()
        if prefix:
            detailed = (prefix + "\n" + detailed).strip()
    else:
        detailed = str(prompt or "").strip()
    detailed = _strip_generated_asset_binding(detailed)
    detailed = _PICTURE_REF_RE.sub(
        lambda match: "<Subject %d>" % int(match.group(1))
        if 1 <= int(match.group(1)) <= picture_count else "", detailed)
    detailed = _SUBJECT_REF_RE.sub(
        lambda match: "<Subject %d>" % int(match.group(1))
        if 1 <= int(match.group(1)) <= picture_count else "", detailed).strip()

    existing_subjects = str(fields.get("subject_definitions", "") or "").splitlines()
    subject_by_picture = {}
    for line in existing_subjects:
        pictures = [int(match.group(1)) for match in _PICTURE_REF_RE.finditer(line)]
        if len(pictures) != 1 or not 1 <= pictures[0] <= picture_count:
            continue
        picture = pictures[0]
        subject_by_picture.setdefault(
            picture, re.sub(r"<Subject\s+\d+>", "<Subject %d>" % picture, line, flags=re.I).strip())
    subject_lines = [subject_by_picture.get(
        picture, "<Subject %d> is the visual subject defined by <Picture %d>." % (picture, picture))
        for picture in range(1, picture_count + 1)]

    existing_retention = str(fields.get("retention_analysis", "") or "").splitlines()
    retention_by_picture = {}
    retained_non_picture = []
    for line in existing_retention:
        pictures = [int(match.group(1)) for match in _PICTURE_REF_RE.finditer(line)]
        if not pictures:
            if line.strip():
                retained_non_picture.append(line.strip())
            continue
        if len(pictures) == 1 and 1 <= pictures[0] <= picture_count:
            retention_by_picture.setdefault(pictures[0], line.strip())
    retention_lines = [retention_by_picture.get(
        picture, "<Picture %d>: reference - preserve <Subject %d>'s identity, appearance and spatial role."
        % (picture, picture)) for picture in range(1, picture_count + 1)]
    retention_lines.extend(retained_non_picture)

    result = {
        "subject_definitions": "\n".join(subject_lines),
        "summary": str(fields.get("summary") or
                       "Generate the requested segment while preserving the supplied reference relationships.").strip(),
        "retention_analysis": "\n".join(dict.fromkeys(retention_lines)),
        "detailed_description": detailed,
        "overall_soundscape": str(fields.get("overall_soundscape") or
                                  "Natural ambient sound and physical action sounds matching the described shots.").strip(),
        "non_diegetic_music": str(fields.get("non_diegetic_music") or "N/A").strip(),
        "director_import_manifest": str(fields.get("director_import_manifest") or "").strip(),
    }
    return _MALFORMED_REFERENCE_CLOSE_RE.sub(r"\1", _render_official_ref2va(result))


def _merge_official_ref2va_entries(prompt, subject_entries=(), retention_entries=(), detail_entries=()):
    prefix, fields = _split_official_prompt_fields(prompt)
    if prefix or not all(name in fields for name in (
            "subject_definitions", "summary", "retention_analysis", "detailed_description",
            "overall_soundscape", "non_diegetic_music")):
        return prompt
    additions = {
        "subject_definitions": subject_entries,
        "retention_analysis": retention_entries,
        "detailed_description": detail_entries,
    }
    for field, entries in additions.items():
        values = [str(fields.get(field, "") or "").strip()]
        values.extend(str(entry or "").strip() for entry in entries if str(entry or "").strip())
        fields[field] = "\n".join(dict.fromkeys(value for value in values if value))
    return _render_official_ref2va(fields)


_CONTINUITY_DIRECTIVE = (
    "HIGHEST PRIORITY CONTINUITY CONTRACT: The opening frame is the exact final frame inherited from "
    "the previous segment. For the first 0.33 seconds preserve the same subject identity, screen position, "
    "pose, motion direction, camera orientation, lighting, scene, visual style and unfinished action. "
    "Do not return to an earlier scene. Do not restart the story, do not replay an establishing shot, "
    "and do not jump directly to the target "
    "scene. Any intended scene or style transition must develop forward on screen only after the inherited "
    "frame is visibly established."
)

_CROSS_STYLE_CONTINUITY_DIRECTIVE = (
    "HIGHEST PRIORITY CROSS-STYLE CONTINUITY CONTRACT: The inherited final frame is a soft continuity "
    "reference only. Preserve subject identity, screen position, pose, motion direction, camera orientation "
    "and unfinished action, but DO NOT preserve the previous rendering style. The first Shot of the current "
    "segment defines the new target rendering style from its first frame. Use the inherited frame only for "
    "identity, geometry and motion continuity; do not recreate the previous 3D/live-action look."
)

_SOFT_TAIL_QUALITY_DIRECTIVE = (
    "SOFT CONTINUITY QUALITY CONTRACT: The inherited picture is a temporal and geometric anchor, "
    "not a texture-quality ceiling. Render at the current segment's native output resolution with "
    "clean edges, stable exposure, full texture detail and the same identity fidelity. Do not copy or "
    "amplify compression blur, ringing, banding, chroma loss, accidental darkness, subtitles, watermarks "
    "or player borders from the reference. Do not cumulatively darken, soften, denoise or distort the "
    "subject across segments."
)

_SEGMENT_SCOPE_DIRECTIVE = (
    "HIGHEST PRIORITY SEGMENT SCOPE CONTRACT: Generate only the events explicitly listed in this "
    "segment's integrated_multimodal_description or detailed_description. Treat overall_soundscape "
    "only as audio texture; it does not authorize visual actions. Do not preview, foreshadow, or render "
    "any scene, action, character, visual style, or sound that belongs to an earlier or later segment. "
    "The final frame must realize the last listed Shot of this segment and must never advance beyond it."
)

_GLOBAL_IDENTITY_ANCHOR_RE = re.compile(
    r"(?:全片|始终|同一)?(?:的)?(?:主角|角色)(?:身份|设定|外貌)?(?:为|是|保持|[:：])?"
    r"|the same(?:\s+[\w-]+){0,6}\s+(?:character|subject|protagonist)"
    r"|stable\s+(?:character|subject)\s+identity",
    re.I,
)
_GLOBAL_SCOPE_RE = re.compile(
    r"(?:前半段|后半段|主动(?:连续)?切换|切换为|风格(?:变化|切换)|"
    r"角色模型|人物选择台|操作面板|武器栏|排列三把武器|360\s*度旋转|视线锁定|猛地按下|"
    r"点击确认|身体前倾|身体僵住|双爪收紧|耳朵竖起|眼睛睁大|主光.*照亮|左侧显示|右侧排列|"
    r"大厅|房间|竹林|森林|海边|街道|古门|传送门|平台|镜头|特写|全景|俯拍|仰拍|构图|运镜|"
    r"style transition|switch(?:es|ing)? to|character selection|selection panel|press(?:es)? confirm)",
    re.I,
)


def _sanitize_global_prompt(global_prompt):
    """运行前的最后一道保守净化：全局只保留明确身份定义与通用限制。"""
    text = str(global_prompt or "").strip()
    if not text:
        return ""
    identity_match = re.search(
        r"Stable\s+character\s+identity\s*[:：]\s*([\s\S]*?)(?=\n\s*Global\s+constraints\s*[:：]|$)",
        text, re.I)
    constraint_match = re.search(
        r"Global\s+constraints\s*[:：]\s*([\s\S]*)$", text, re.I)
    if not identity_match and not constraint_match:
        return "" if _GLOBAL_SCOPE_RE.search(text) else text

    parts = []
    if identity_match:
        identity = identity_match.group(1).strip()
        anchor = _GLOBAL_IDENTITY_ANCHOR_RE.search(identity)
        if anchor:
            identity = identity[anchor.start():]
            scope = _GLOBAL_SCOPE_RE.search(identity)
            if scope:
                identity = identity[:scope.start()]
            identity = re.sub(r"\s+", " ", identity).strip(" ,，;；。")
            if identity:
                parts.append("Stable character identity:\n" + identity)
    constraints = []
    if constraint_match:
        for sentence in re.split(r"[\r\n。！？]+", constraint_match.group(1)):
            sentence = sentence.strip()
            if sentence and re.search(
                    r"no subtitles?|no watermark|no text|无字幕|无水印|禁止字幕|禁止文字", sentence, re.I):
                constraints.append(sentence)
    if constraints:
        parts.append("Global constraints:\n" + " ".join(dict.fromkeys(constraints)))
    elif re.search(r"no subtitles?|无字幕", text, re.I):
        parts.append("Global constraints:\nNo subtitles or watermarks on screen.")
    return "\n\n".join(parts).strip()


def _build_continuity_directive(tail_picture_no=None, hard_first_frame=False,
                                preserve_visual_style=True):
    base = _CONTINUITY_DIRECTIVE if preserve_visual_style else _CROSS_STYLE_CONTINUITY_DIRECTIVE
    if tail_picture_no:
        tag = "<Picture %d>" % int(tail_picture_no)
        relation = (
            "preserve its opening composition, subject placement, pose, camera, lighting, scene and "
            "visual style before continuing the action."
            if preserve_visual_style else
            "preserve subject identity, placement, pose, camera geometry and motion direction, while the "
            "current segment's first Shot supplies the new rendering style."
        )
        return (base
                + "\nCONTINUITY REFERENCE: %s is the exact final frame inherited from the previous segment; %s" % (tag, relation)
                + "\n" + _SOFT_TAIL_QUALITY_DIRECTIVE)
    if hard_first_frame:
        return base + " The supplied FL2VA first-frame keyframe is mandatory."
    return base


def _inject_ref2va_tail_reference(local_prompt, tail_picture_no, preserve_visual_style=True):
    """把尾帧关系写进既有 Ref2VA 六字段正文，绝不创建重复字段或把 Base 混成 Ref2VA。"""
    text = str(local_prompt or "")
    if not tail_picture_no:
        return text
    required = ("subject_definitions", "summary", "retention_analysis", "detailed_description")
    marks = []
    for field in required:
        match = re.search(r"(?:^|\n)\s*%s\s*[:：]\s*" % field, text, re.I)
        if not match:
            return text
        marks.append(match.start())
    if marks != sorted(marks) or len(set(marks)) != len(marks):
        return text

    tag = "<Picture %d>" % int(tail_picture_no)
    retention = (
        "%s: reference - preserve its opening composition, subject placement, pose, camera, "
        "lighting, scene and visual style before continuing the action; keep native-resolution detail "
        "and stable exposure, and do not inherit compression blur, ringing, banding, chroma loss, "
        "subtitles, watermarks or player borders." % tag
        if preserve_visual_style else
        "%s: reference - preserve subject identity, placement, pose, camera geometry and motion direction; "
        "do not preserve the previous rendering style, because the current segment defines a new style." % tag
    )
    detail = (
        "Continuity requirement: [Shot 1] must begin from %s without a cut; transition forward only "
        "after this inherited frame is established. Use it as a geometry and motion anchor rather than "
        "a quality ceiling: do not cumulatively darken, soften, denoise or distort the subject." % tag
        if preserve_visual_style else
        "Cross-style continuity requirement: [Shot 1] uses %s only for identity, composition and motion "
        "continuity; from the first frame it must use the new rendering style explicitly defined by this Shot." % tag
    )
    additions = {
        "subject_definitions": (
            "%s is the exact final frame inherited from the previous segment." % tag),
        "retention_analysis": retention,
        "detailed_description": detail,
    }
    for field in ("detailed_description", "retention_analysis", "subject_definitions"):
        match = re.search(r"((?:^|\n)\s*%s\s*[:：]\s*)" % field, text, re.I)
        text = text[:match.end(1)] + additions[field] + "\n" + text[match.end(1):]
    return text


def _localize_segment_soundscape(local_prompt):
    """长时间轴旧项目的段提示可能仍携带整片声音场景；运行时只保留本段 Shot 声音。"""
    text = str(local_prompt or "")
    match = re.search(
        r"((?:^|\n)\s*overall_soundscape\s*[:：]\s*)([\s\S]*?)"
        r"(?=(?:\n\s*non_diegetic_music\s*[:：])|$)",
        text,
        re.I,
    )
    if not match:
        return text
    shot_text = text[:match.start()]
    sounds = []
    for sound_match in re.finditer(
            r"(?:具体声音(?:为|包括)?|声音(?:为|包括)?|soundscape(?: includes?|:)"
            r"|sounds?(?: include| includes|:)|audio(?: includes?|:))\s*([^。！？\n]+[。！？]?)",
            shot_text, re.I):
        clean = re.sub(r"\s+", " ", sound_match.group(1)).strip()
        if clean and clean not in sounds:
            sounds.append(clean)
    guard = (
        "Only the ambience, physical action sounds, and nonverbal vocal sounds explicitly named in "
        "this segment's Shots are allowed. Do not introduce sounds, characters, actions, or locations "
        "from any earlier or later segment."
    )
    localized = guard + ((" " + " ".join(sounds)) if sounds else "")
    return text[:match.start(2)] + localized + text[match.end(2):]


def _prompt_style_profile(value):
    text = str(value or "")
    return {
        "three_d": bool(re.search(r"(?:\b3d\b|three[ -]?dimensional|三维|3D)", text, re.I)),
        "two_d": bool(re.search(r"(?:\b2d\b|two[ -]?dimensional|二维|平面动画|2D)", text, re.I)),
        "pixel": bool(re.search(r"(?:pixel(?:[ -]?art)?|8[ -]?bit|16[ -]?bit|像素|点阵)", text, re.I)),
        "live": bool(re.search(r"(?:live[ -]?action|photo[ -]?real(?:istic)?|photographic|真人|照片级写实|实拍)", text, re.I)),
        "animation": bool(re.search(r"(?:anime|animation|cartoon|toon|二次元|动画|卡通)", text, re.I)),
        "day": bool(re.search(r"(?:broad daylight|daytime|sunlit|白天|日间|阳光明媚)", text, re.I)),
        "night": bool(re.search(r"(?:nighttime|at night|moonlit|夜晚|夜间|月光)", text, re.I)),
    }


def _active_prompt_style_profile(value):
    text = re.sub(
        r"(?:no|without|never|not|禁止|不得|不能|不再|不出现|不存在|没有|避免|去除)"
        r"[^。！？；;,.，\n]{0,32}(?:\b3d\b|three[ -]?dimensional|三维(?:动画|渲染|模型)?|"
        r"\b2d\b|two[ -]?dimensional|二维|pixel(?:[ -]?art)?|8[ -]?bit|16[ -]?bit|像素|"
        r"live[ -]?action|photo[ -]?real(?:istic)?|photographic|真人|实拍|anime|animation|"
        r"cartoon|toon|二次元|动画|卡通)",
        " ", str(value or ""), flags=re.I)
    return _prompt_style_profile(text)


def _visual_shot_bodies(value):
    text = str(value or "")
    main = re.search(
        r"(?:integrated_multimodal_description|detailed_description)\s*[:：]([\s\S]*?)"
        r"(?=\n\s*(?:overall_soundscape|non_diegetic_music|director_import_manifest)\s*[:：]|$)",
        text, re.I)
    visual = main.group(1) if main else re.split(
        r"\n\s*(?:overall_soundscape|non_diegetic_music|director_import_manifest)\s*[:：]",
        text, maxsplit=1, flags=re.I)[0]
    marks = list(re.finditer(r"\[Shot\s+\d+\s*\]", visual, re.I))
    if not marks:
        return [visual.strip()] if visual.strip() else []
    return [visual[mark.end():(marks[index + 1].start() if index + 1 < len(marks) else len(visual))].strip()
            for index, mark in enumerate(marks)]


def _endpoint_render_style(value, endpoint="first"):
    bodies = _visual_shot_bodies(value)
    if not bodies:
        return {"kind": "unknown", "text": ""}
    text = bodies[-1 if endpoint == "last" else 0]
    text = re.sub(r"\b3d\s+print(?:er|ing)?\b|\b2d\s+(?:map|diagram|layout)\b|三维打印机|二维(?:地图|图纸|布局)",
                  " ", text, flags=re.I)
    profile = _active_prompt_style_profile(text)
    transition = bool(re.search(
        r"transform(?:s|ed|ing)?\s+into|transition(?:s|ed|ing)?\s+into|"
        r"morph(?:s|ed|ing)?\s+into|dissolv(?:e|es|ed|ing)\s+into|gradually\s+becomes?|"
        r"压缩为|逐渐(?:变为|转为)|转化为|转换为|变形成|分解为|像素化过程", text, re.I))
    has_3d = profile["three_d"] and not (profile["two_d"] or profile["pixel"])
    has_flat = (profile["two_d"] or profile["pixel"]) and not profile["three_d"]
    has_live = profile["live"] and not (profile["animation"] or profile["pixel"])
    has_animation = (profile["animation"] or profile["pixel"]) and not profile["live"]
    kind = "unknown"
    if transition or (profile["three_d"] and (profile["two_d"] or profile["pixel"])) \
            or (profile["live"] and (profile["animation"] or profile["pixel"])):
        kind = "transition"
    elif has_3d:
        kind = "3d"
    elif has_flat:
        kind = "2d_pixel" if profile["pixel"] else "2d"
    elif has_live:
        kind = "live"
    elif has_animation:
        kind = "2d_pixel" if profile["pixel"] else "animation"
    return {"kind": kind, "text": text}


def _detect_tail_render_boundaries(segments):
    boundaries = []
    for index in range(1, len(segments or [])):
        current = segments[index] or {}
        if not current.get("enabled", True) or not current.get("use_tail", True):
            continue
        previous = _endpoint_render_style((segments[index - 1] or {}).get("prompt", ""), "last")
        following = _endpoint_render_style(current.get("prompt", ""), "first")
        if previous["kind"] in ("unknown", "transition") or following["kind"] in ("unknown", "transition"):
            continue
        previous_3d = previous["kind"] in ("3d", "live")
        following_3d = following["kind"] in ("3d", "live")
        previous_flat = previous["kind"] in ("2d", "2d_pixel", "animation")
        following_flat = following["kind"] in ("2d", "2d_pixel", "animation")
        if (previous_3d and following_flat) or (previous_flat and following_3d):
            boundaries.append({"segment": index + 1, "from": previous["kind"], "to": following["kind"]})
    return boundaries


def _hard_global_conflict(global_prompt, local_prompt):
    g = _prompt_style_profile(global_prompt)
    local = _prompt_style_profile(local_prompt)
    if g["three_d"] and (local["two_d"] or local["pixel"]):
        return "3D 与 2D/像素风格"
    if (g["two_d"] or g["pixel"]) and local["three_d"]:
        return "2D/像素与 3D 风格"
    if g["live"] and (local["pixel"] or local["animation"]):
        return "写实/实拍与动画/像素风格"
    if (g["pixel"] or g["animation"]) and local["live"]:
        return "动画/像素与写实/实拍风格"
    if g["day"] and local["night"]:
        return "白天与夜晚光照"
    if g["night"] and local["day"]:
        return "夜晚与白天光照"
    return ""


def _compose_segment_prompt(global_prompt, local_prompt, use_tail=False, seg_idx=1,
                            tail_picture_no=None, hard_first_frame=False, total_segments=1,
                            preserve_tail_visual_style=True):
    """合成实际送入 H3 的提示词；后端保留一道防线，避免旧工作流绕过前端预检。"""
    raw_global = str(global_prompt or "").strip()
    global_text = _sanitize_global_prompt(raw_global)
    if raw_global and global_text != raw_global:
        _log("[H3导演台] 已在运行前移除全局提示词中的分段场景/动作，只保留身份与通用限制")
    local_text = str(local_prompt or "").strip()
    if int(total_segments or 1) > 1:
        local_text = _localize_segment_soundscape(local_text).strip()
    if bool(use_tail) and int(seg_idx) > 1 and tail_picture_no:
        local_text = _inject_ref2va_tail_reference(
            local_text, tail_picture_no, preserve_visual_style=preserve_tail_visual_style).strip()
    conflict = _hard_global_conflict(global_text, local_text) if global_text and local_text else ""
    if conflict:
        _log("[H3导演台] 段%d 检测到全局/本段%s冲突，已仅对本段跳过冲突全局提示词" % (seg_idx, conflict))
        global_text = ""
    parts = []
    combined_audio_text = "\n".join((global_text, local_text))
    exact_dialogue = bool(re.search(r"<d>\s*\[[^\]]+\][\s\S]*?</d>", combined_audio_text, re.I))
    if exact_dialogue:
        parts.append(
            "HIGHEST PRIORITY AUDIO LANGUAGE CONTRACT: Only the exact text already enclosed in "
            "<d>[Language]...</d> may be spoken, by the named speaker and only at its listed time. "
            "Do not add, rewrite, translate, mumble, whisper, sing, broadcast, or generate any other "
            "voice, syllable, pseudo-language, or gibberish. All non-speaking characters keep their mouths closed."
        )
    else:
        # H3 只有在 <d>[Language]...</d> 中拿到精确台词时才允许生成语言人声。
        # 普通剧情文字里出现“说、问、喊”等并不能提供稳定台词，放行后最常见结果就是
        # 耳语、咕哝或伪语言。统一按无对白处理，用户若需要对白必须通过向导的精确台词字段写入 <d>。
        parts.append(
            "HIGHEST PRIORITY AUDIO LANGUAGE CONTRACT: Generate no intelligible or unintelligible speech, "
            "dialogue, narration, lyrics, broadcasts, whispers, mumbling, vocal syllables, pseudo-language, "
            "or gibberish. Characters keep their mouths closed. Only ambience and visible-action sound effects are allowed."
        )
    if bool(use_tail) and int(seg_idx) > 1:
        parts.append(_build_continuity_directive(
            tail_picture_no=tail_picture_no, hard_first_frame=hard_first_frame,
            preserve_visual_style=preserve_tail_visual_style))
    parts.append(_SEGMENT_SCOPE_DIRECTIVE)
    if global_text:
        parts.append(global_text)
    if local_text:
        parts.append(local_text)
    return "\n\n".join(parts).strip()


def _global_prompt_for_mode(mode, global_prompt):
    """视频界面没有全局提示词编辑器，禁止继承创作/文本界面的隐藏残留。"""
    if str(mode or "create") == "video":
        return ""
    return str(global_prompt or "")


def _is_same_image(a, b):
    """两张 IMAGE 张量内容是否一致（用于参考图去重）。"""
    try:
        return a.shape == b.shape and bool((a == b).all())
    except Exception:
        return False


def _latest(pattern):
    files = glob.glob(pattern)
    return max(files, key=os.path.getmtime) if files else None


# 三个界面独立命名（v2.3 视频 / v2.11 文本）：各页产出互不覆盖
_SEG_NAME = {"create": "漫剧_seg%d_00001_", "video": "漫剧v_seg%d_00001_", "text": "漫剧t_seg%d_00001_"}
_TAIL_NAME = {"create": "tail_seg%d_00001_.png", "video": "tailv_seg%d_00001_.png", "text": "tailt_seg%d_00001_.png"}
_SEG_PREFIX = {"create": "漫剧_seg", "video": "漫剧v_seg", "text": "漫剧t_seg"}
_TAIL_PREFIX = {"create": "tail_seg", "video": "tailv_seg", "text": "tailt_seg"}


def _safe_project_id(value):
    value = re.sub(r"[^0-9A-Za-z_-]+", "_", str(value or "").strip())[:80].strip("_")
    return value or "default"


def _project_dir(project_id):
    return os.path.join(PROJECT_ROOT, _safe_project_id(project_id))


def _video_ui_entry(path):
    """将 output 下的 MP4 描述为 ComfyUI 可登记、可预览的媒体输出。"""
    if not path or not os.path.isfile(path):
        return None
    output_root = os.path.realpath(OUTPUT_DIR)
    video_path = os.path.realpath(path)
    try:
        contained = os.path.normcase(os.path.commonpath((output_root, video_path))) == os.path.normcase(output_root)
    except ValueError:
        contained = False
    if not contained or not video_path.lower().endswith(".mp4"):
        _log("[H3导演台] 警告：视频不在 ComfyUI output 目录内，未登记到媒体资产")
        return None
    relative = os.path.relpath(video_path, output_root)
    subfolder, filename = os.path.split(relative)
    return {
        "filename": filename,
        "subfolder": subfolder.replace(os.sep, "/"),
        "type": "output",
        "format": "video/mp4",
    }


def _result_with_video_ui(result, video_paths):
    videos = []
    seen = set()
    for path in video_paths:
        entry = _video_ui_entry(path)
        if entry is None:
            continue
        key = (entry["subfolder"], entry["filename"])
        if key in seen:
            continue
        seen.add(key)
        videos.append(entry)
    if not videos:
        return result
    return {"ui": {"video": videos}, "result": result}


_DEEP_RELEASE_REQUESTS = set()
_DEEP_RELEASE_LOCK = threading.Lock()


def request_deep_release(project_id):
    """安排一次安全的深度释放；生成线程只会在当前段完成/失败后消费。"""
    key = _safe_project_id(project_id)
    with _DEEP_RELEASE_LOCK:
        _DEEP_RELEASE_REQUESTS.add(key)
    return key


def _consume_deep_release_request(project_id):
    key = _safe_project_id(project_id)
    with _DEEP_RELEASE_LOCK:
        if key not in _DEEP_RELEASE_REQUESTS:
            return False
        _DEEP_RELEASE_REQUESTS.remove(key)
        return True


def _memory_snapshot():
    """读取实际运行电脑的 RAM/VRAM 状态；失败时降级为仅执行轻量清理。"""
    snapshot = {
        "ram_total": None,
        "ram_available": None,
        "ram_percent": None,
        "ram_reserve": None,
        "vram_free": None,
        "pressure": False,
    }
    try:
        import psutil
        vm = psutil.virtual_memory()
        total = int(vm.total)
        available = int(vm.available)
        reserve = int(min(8 * 1024 ** 3, max(3 * 1024 ** 3, total * 0.18)))
        snapshot.update({
            "ram_total": total,
            "ram_available": available,
            "ram_percent": float(vm.percent),
            "ram_reserve": reserve,
            "pressure": available < reserve or float(vm.percent) >= 88.0,
        })
    except Exception:
        pass
    try:
        snapshot["vram_free"] = int(comfy.model_management.get_free_memory())
    except Exception:
        pass
    return snapshot


def _format_memory_snapshot(snapshot):
    gib = float(1024 ** 3)
    parts = []
    if snapshot.get("ram_available") is not None:
        parts.append("可用内存 %.2f/%.2f GiB" % (
            snapshot["ram_available"] / gib, snapshot["ram_total"] / gib))
    if snapshot.get("ram_percent") is not None:
        parts.append("内存占用 %.1f%%" % snapshot["ram_percent"])
    if snapshot.get("vram_free") is not None:
        parts.append("可用显存 %.2f GiB" % (snapshot["vram_free"] / gib))
    return "，".join(parts) if parts else "内存状态不可读"


def _loaded_model_count():
    try:
        loaded = comfy.model_management.loaded_models()
        return len(loaded) if loaded is not None else None
    except Exception:
        return None


def _second_sample_runtime_snapshot():
    memory = {
        "allocated_bytes": None,
        "reserved_bytes": None,
        "free_bytes": None,
    }
    try:
        device = comfy.model_management.get_torch_device()
    except Exception:
        device = None
    if device is not None:
        try:
            memory["free_bytes"] = int(comfy.model_management.get_free_memory(device))
        except Exception:
            pass
        if str(getattr(device, "type", "") or "").lower() == "cuda":
            try:
                stats = torch.cuda.memory_stats(device)
                allocated = stats.get("allocated_bytes.all.current")
                if allocated is None:
                    allocated = stats.get("active_bytes.all.current")
                memory["allocated_bytes"] = int(allocated) if allocated is not None else None
                reserved = stats.get("reserved_bytes.all.current")
                memory["reserved_bytes"] = int(reserved) if reserved is not None else None
            except Exception:
                pass
    return {
        "resident_models": _loaded_model_count(),
        "memory": memory,
    }


def _second_sample_event_identity(display_node=""):
    try:
        context = get_executing_context()
    except Exception:
        context = None
    prompt_id = str(context.prompt_id) if context is not None else ""
    node_id = str(context.node_id) if context is not None else ""
    return {
        "prompt_id": prompt_id,
        "node": node_id,
        "display_node": str(display_node or node_id),
    }


def _second_sample_stage_payload(identity, project_id, segment_index, stage, status,
                                 elapsed_seconds=None, step_current=None, step_total=None,
                                 external_upscaler_cached=None, failure=None, snapshot=None):
    stage_names = [item[0] for item in SECOND_SAMPLE_STAGES]
    stage_index = stage_names.index(stage) + 1
    stage_label = SECOND_SAMPLE_STAGES[stage_index - 1][1]
    runtime = snapshot or {
        "resident_models": None,
        "memory": {
            "allocated_bytes": None,
            "reserved_bytes": None,
            "free_bytes": None,
        },
    }
    memory = {
        "allocated_bytes": None,
        "reserved_bytes": None,
        "free_bytes": None,
    }
    memory.update(runtime.get("memory") or {})
    return {
        "schema": 1,
        "prompt_id": str(identity.get("prompt_id") or ""),
        "node": str(identity.get("node") or ""),
        "display_node": str(identity.get("display_node") or identity.get("node") or ""),
        "project_id": str(project_id or "default"),
        "segment_index": int(segment_index),
        "stage": stage,
        "stage_index": stage_index,
        "stage_total": len(SECOND_SAMPLE_STAGES),
        "label": stage_label,
        "status": status,
        "elapsed_seconds": float(elapsed_seconds) if elapsed_seconds is not None else None,
        "resident_models": runtime.get("resident_models"),
        "memory": memory,
        "step_current": int(step_current) if step_current is not None else None,
        "step_total": int(step_total) if step_total is not None else None,
        "external_upscaler_cached": external_upscaler_cached,
        "failure": dict(failure) if isinstance(failure, dict) else None,
    }


def _emit_second_sample_stage(project_id, segment_index, display_node, stage, status,
                              elapsed_seconds=None, step_current=None, step_total=None,
                              external_upscaler_cached=None, failure=None, snapshot=None):
    try:
        identity = _second_sample_event_identity(display_node)
        app = PromptServer.instance
        client_id = getattr(app, "client_id", None)
        if (not identity["prompt_id"] or not identity["node"] or not client_id
                or not hasattr(app, "send_sync")):
            return
        payload = _second_sample_stage_payload(
            identity, project_id, segment_index, stage, status,
            elapsed_seconds=elapsed_seconds, step_current=step_current,
            step_total=step_total, external_upscaler_cached=external_upscaler_cached,
            failure=failure, snapshot=snapshot)
        app.send_sync("h3director_second_sample_stage", payload, client_id)
    except Exception:
        pass


def _second_sample_failure(error, runtime_released=False):
    out_of_memory_type = getattr(torch, "OutOfMemoryError", None)
    is_oom = bool(out_of_memory_type and isinstance(error, out_of_memory_type))
    if not is_oom:
        message_lower = str(error).lower()
        is_oom = "out of memory" in message_lower or re.search(r"\boom\b", message_lower) is not None
    return {
        "oom": is_oom,
        "first_pass_preserved": False,
        "second_pass_completed": False,
        "second_pass_cache_written": False,
        "runtime_released": bool(runtime_released),
        "exception_type": type(error).__name__,
        "exception_message": str(error)[:2000],
    }


def _second_sample_finally_cleanup(failed):
    released = True
    gc.collect()
    if failed:
        try:
            comfy.model_management.cleanup_models()
        except Exception:
            pass
    try:
        comfy.model_management.soft_empty_cache()
    except Exception as error:
        released = False
        _log("[H3导演台] 二采清理缓存失败：%s" % error)
    return released


def _cleanup_runtime_resources(deep=False, reason="段间轻量清理"):
    """只在安全边界执行；深度模式会让下一段重新加载模型，但不改变采样数学。"""
    before = _loaded_model_count()
    if deep:
        try:
            comfy.model_management.unload_all_models()
        except Exception as error:
            _log("[H3导演台] 深度释放调用失败，将继续清理缓存：%s" % error)
        try:
            comfy.model_management.cleanup_models()
        except Exception:
            pass
    gc.collect()
    try:
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass
    after = _loaded_model_count()
    snapshot = _memory_snapshot()
    action = "深度释放" if deep else "轻量清理"
    count_note = ""
    if before is not None and after is not None:
        count_note = "，ComfyUI驻留模型 %d→%d" % (before, after)
    _log("[H3导演台] %s：%s%s；%s" % (
        action, reason, count_note, _format_memory_snapshot(snapshot)))
    return {
        "deep": bool(deep),
        "reason": reason,
        "before_models": before,
        "after_models": after,
        "memory": snapshot,
    }


def _segment_boundary_cleanup(project_id, seg_idx, force_deep=False, reason=""):
    snapshot = _memory_snapshot()
    manual = _consume_deep_release_request(project_id)
    pressure = bool(snapshot.get("pressure"))
    deep = bool(force_deep or manual or pressure)
    reasons = []
    if force_deep:
        reasons.append(reason or "当前段异常/取消")
    if manual:
        reasons.append("用户请求在当前段结束后释放")
    if pressure:
        reasons.append("实际运行电脑达到内存压力安全线")
    if not reasons:
        reasons.append(reason or "当前段已安全写盘")
    result = _cleanup_runtime_resources(deep=deep, reason="；".join(reasons))
    result.update({"segment": int(seg_idx), "manual": manual, "pressure": pressure})
    return result


def _cleanup_project_temp_files(project_id):
    """清理当前项目遗留的未提交临时文件，不碰分段成片、尾帧或用户媒体。"""
    project_dir = _project_dir(project_id)
    deleted = []
    for pattern in ("_h3_video_*.mp4", "_h3_mux_*.mp4", "_h3_meta_*.json", "_h3_tail_*.png",
                    "_h3_reserve_*.lock"):
        for path in glob.glob(os.path.join(project_dir, pattern)):
            try:
                os.remove(path)
                deleted.append(os.path.basename(path))
            except OSError:
                pass
    if deleted:
        _log("[H3导演台] 已清理 %d 个遗留临时文件：%s" % (
            len(deleted), "、".join(deleted[:4]) + ("…" if len(deleted) > 4 else "")))
    return deleted


def _seg_meta(seg, mode="create", project_id="default"):
    return os.path.join(_project_dir(project_id), (_SEG_NAME.get(mode, _SEG_NAME["create"]) % seg) + ".json")


def _segment_version_path(seg, version, mode="create", project_id="default", tail=False,
                          version_label=""):
    prefix = (_TAIL_PREFIX if tail else _SEG_PREFIX).get(mode, (_TAIL_PREFIX if tail else _SEG_PREFIX)["create"])
    suffix = ".png" if tail else ".mp4"
    label = str(version_label or "") if version_label in ("一次采样", "二次采样") else ""
    return os.path.join(
        _project_dir(project_id), "%s%d_%05d_%s%s" % (
            prefix, int(seg), int(version), label, suffix))


def _segment_file_version(path, seg, mode="create", tail=False):
    prefix = (_TAIL_PREFIX if tail else _SEG_PREFIX).get(mode, (_TAIL_PREFIX if tail else _SEG_PREFIX)["create"])
    suffix = "png" if tail else "mp4"
    match = re.match(
        r"^%s%d_(\d+)_(?:.*)\.%s$" % (re.escape(prefix), int(seg), suffix),
        os.path.basename(path), re.I)
    return int(match.group(1)) if match else None


def _read_segment_metadata(seg, mode="create", project_id="default"):
    path = _seg_meta(seg, mode, project_id)
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def _recorded_segment_path(meta, project_dir, name_key, signature_key, suffix):
    name = os.path.basename(str((meta or {}).get(name_key) or ""))
    if name:
        path = os.path.join(project_dir, name)
        if os.path.isfile(path):
            return path

    signature = (meta or {}).get(signature_key)
    if not isinstance(signature, dict):
        return None
    try:
        entries = os.scandir(project_dir)
    except OSError:
        return None
    try:
        for entry in entries:
            if not entry.is_file() or not entry.name.lower().endswith(suffix):
                continue
            if _signature_matches(signature, _path_signature(entry.path)):
                return entry.path
    finally:
        entries.close()
    return None


def _latest_segment_version_path(seg, mode="create", project_id="default", tail=False):
    project_dir = _project_dir(project_id)
    prefix = (_TAIL_PREFIX if tail else _SEG_PREFIX).get(mode, (_TAIL_PREFIX if tail else _SEG_PREFIX)["create"])
    suffix = ".png" if tail else ".mp4"
    best = None
    best_version = -1
    for path in glob.glob(os.path.join(project_dir, "%s%d_*%s" % (prefix, int(seg), suffix))):
        version = _segment_file_version(path, seg, mode, tail=tail)
        if version is not None and version > best_version:
            best = path
            best_version = version
    return best


def _find_segment_version_path(seg, version, mode="create", project_id="default", tail=False):
    project_dir = _project_dir(project_id)
    meta = _read_segment_metadata(seg, mode, project_id)
    name_key = "active_tail" if tail else "active_video"
    signature_key = "tail" if tail else "video"
    suffix = ".png" if tail else ".mp4"
    recorded = _recorded_segment_path(meta, project_dir, name_key, signature_key, suffix)
    if recorded and _segment_file_version(recorded, seg, mode, tail=tail) == int(version):
        return recorded

    prefix = (_TAIL_PREFIX if tail else _SEG_PREFIX).get(mode, (_TAIL_PREFIX if tail else _SEG_PREFIX)["create"])
    candidates = []
    for path in glob.glob(os.path.join(project_dir, "%s%d_*%s" % (prefix, int(seg), suffix))):
        if _segment_file_version(path, seg, mode, tail=tail) != int(version):
            continue
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        candidates.append((mtime, path))
    if candidates:
        return max(candidates, key=lambda item: item[0])[1]
    return _segment_version_path(seg, version, mode, project_id, tail=tail)


def _active_segment_path(seg, mode="create", project_id="default", tail=False):
    project_dir = _project_dir(project_id)
    meta = _read_segment_metadata(seg, mode, project_id)
    name_key = "active_tail" if tail else "active_video"
    signature_key = "tail" if tail else "video"
    suffix = ".png" if tail else ".mp4"
    recorded = _recorded_segment_path(meta, project_dir, name_key, signature_key, suffix)
    if recorded:
        return recorded
    if meta:
        signature = meta.get(signature_key)
        recorded_name = (meta.get(name_key)
                         or (signature.get("path") if isinstance(signature, dict) else None))
        if recorded_name:
            return os.path.join(project_dir, os.path.basename(str(recorded_name)))
        if meta.get("complete") is False:
            return _segment_version_path(seg, 1, mode, project_id, tail=tail)
    latest = _latest_segment_version_path(seg, mode, project_id, tail=tail)
    return latest or _segment_version_path(seg, 1, mode, project_id, tail=tail)


def _seg_video(seg, mode="create", project_id="default"):
    return _active_segment_path(seg, mode, project_id, tail=False)


def _seg_tail(seg, mode="create", project_id="default"):
    return _active_segment_path(seg, mode, project_id, tail=True)


def _matching_segment_tail(video_path, seg, mode="create", project_id="default"):
    version = _segment_file_version(video_path, seg, mode, tail=False)
    if version is None:
        return _seg_tail(seg, mode, project_id)
    return _find_segment_version_path(seg, version, mode, project_id, tail=True)


def _reserve_next_segment_video(seg, mode="create", project_id="default", version_label=""):
    versions = []
    meta = _read_segment_metadata(seg, mode, project_id)
    try:
        versions.append(int((meta or {}).get("version") or 0))
    except (TypeError, ValueError):
        pass
    for tail in (False, True):
        path = _latest_segment_version_path(seg, mode, project_id, tail=tail)
        version = _segment_file_version(path, seg, mode, tail=tail) if path else None
        if version is not None:
            versions.append(version)
    version = max(versions, default=0) + 1
    while True:
        path = _segment_version_path(
            seg, version, mode, project_id, tail=False, version_label=version_label)
        reservation = os.path.join(
            _project_dir(project_id), "_h3_reserve_%s_%d_%05d.lock" % (mode, int(seg), version))
        try:
            fd = os.open(reservation, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            version += 1
            continue
        os.close(fd)
        return version, path, _segment_version_path(
            seg, version, mode, project_id, tail=True, version_label=version_label), reservation


def _tail_rejection_summary(info, limit=2):
    rejected = (info or {}).get("rejected") or []
    parts = []
    for item in rejected[:max(1, int(limit))]:
        reasons = item.get("reasons") or []
        parts.append("帧%d: %s" % (int(item.get("index", -1)) + 1, "、".join(reasons[:2])))
    return "；".join(parts)


def _refresh_segment_tail(seg, mode="create", project_id="default"):
    """从真实段视频末尾检查并刷新续接 PNG；旧项目也会自动获得脏帧回退。"""
    video_path = _seg_video(seg, mode, project_id)
    tail_path = _seg_tail(seg, mode, project_id)
    if os.path.isfile(video_path):
        # Freshly rendered segments already have a lossless PNG selected directly from the model's
        # RGB output.  Keep it instead of decoding the H.264/YUV420 MP4 and overwriting it with a
        # softer, color-subsampled copy.  A newer MP4 means the segment was replaced, so rescan it.
        if lossless_tail_is_current(tail_path, video_path):
            try:
                with Image.open(tail_path) as source_image:
                    image = source_image.convert("RGB")
                    frame, info = select_clean_tail_frame(
                        [np.asarray(image, dtype=np.uint8)], max_backtrack=1)
                if frame is not None:
                    info = dict(info or {})
                    info.update({
                        "source": os.path.realpath(tail_path),
                        "preserved_lossless": True,
                    })
                    _log("[H3导演台] 段%d续接使用模型原始无损 PNG；跳过 H.264 二次解码，避免逐段变糊/变暗" % seg)
                    return Image.fromarray(frame, "RGB"), info
            except Exception as error:
                _log("[H3导演台] 段%d无损尾帧读取失败，将从视频重新提取：%s" % (seg, error))
        frame, info = extract_clean_tail_frame(video_path)
        if frame is None:
            try:
                os.remove(tail_path)
            except OSError:
                pass
            _log("[H3导演台] 警告：段%d尾部没有通过质量检查的续接帧，已禁用该尾帧。%s" % (
                seg, _tail_rejection_summary(info)))
            return None, info
        changed = write_tail_frame_if_changed(tail_path, frame)
        fallback = int(info.get("fallback_frames") or 0)
        if fallback:
            _log("[H3导演台] 段%d末帧异常，已自动回退 %d 帧作为续接帧（采用第%d/%d帧）。%s" % (
                seg, fallback, int(info.get("selected_index", 0)) + 1,
                int(info.get("total_frames") or 0), _tail_rejection_summary(info)))
        elif changed:
            _log("[H3导演台] 段%d续接尾帧已通过质量检查并刷新" % seg)
        return Image.fromarray(frame, "RGB"), info

    # “从视频续接”只保留已经检查过的 PNG，不一定存在对应段 MP4。
    if os.path.isfile(tail_path):
        try:
            image = Image.open(tail_path).convert("RGB")
            frame, info = select_clean_tail_frame([np.asarray(image, dtype=np.uint8)], max_backtrack=1)
            if frame is not None:
                return Image.fromarray(frame, "RGB"), info
        except Exception as error:
            info = {"ok": False, "reason": str(error), "rejected": []}
        _log("[H3导演台] 警告：段%d保存的续接 PNG 本身异常，已忽略：%s" % (
            seg, (info or {}).get("reason", "未知错误")))
        return None, info
    return None, {"ok": False, "reason": "尾帧文件不存在", "rejected": []}


def _resolve_input(name):
    """input 目录文件路径解析（兼容 ComfyUI 的 [input] 标注语法）。"""
    return folder_paths.get_annotated_filepath(name, INPUT_DIR)


def _input_signature(name):
    if not name:
        return None
    try:
        path = _resolve_input(name)
        st = os.stat(path)
        return {"name": name, "size": st.st_size, "mtime_ns": st.st_mtime_ns}
    except (OSError, ValueError):
        return {"name": name, "missing": True}


def _segment_first_frame_mode(seg_cfg):
    mode = str(seg_cfg.get("first_frame_mode") or "").strip()
    first_frame = str(seg_cfg.get("first_frame") or "").strip()
    if mode == "custom" and first_frame:
        return "custom"
    return "previous_tail" if seg_cfg.get("use_tail", True) else "none"


def _segment_keyframe_names(seg_cfg):
    first_frame = (str(seg_cfg.get("first_frame") or "").strip()
                   if _segment_first_frame_mode(seg_cfg) == "custom" else "")
    last_frame = str(seg_cfg.get("last_frame") or "").strip()
    return first_frame, last_frame


def _path_signature(path):
    try:
        st = os.stat(path)
        return {"path": os.path.basename(path), "size": st.st_size, "mtime_ns": st.st_mtime_ns}
    except OSError:
        return {"path": os.path.basename(path), "missing": True}


def _atomic_write_json(path, payload):
    """先完整写入同目录临时文件，再原子替换正式 JSON。"""
    directory = os.path.dirname(os.path.realpath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix="_h3_meta_", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path:
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _integer_segment_duration(duration):
    try:
        duration = float(duration)
    except (TypeError, ValueError):
        duration = 10.0
    return max(2, min(15, math.floor(duration + 0.5)))


def _segment_frame_count(duration):
    duration = _integer_segment_duration(duration)
    requested_frames = max(39, min(362, round(duration * FPS)))
    return min(range(39, 363, 17), key=lambda frames: abs(frames - requested_frames))


def _expected_segment_duration(duration):
    return _segment_frame_count(duration) / float(FPS)


def _probe_segment_video(path):
    """验证 MP4 可打开、首尾可解码，并返回确定性媒体信息。"""
    import cv2

    if not os.path.isfile(path):
        return False, "MP4 不存在", None
    try:
        if os.path.getsize(path) < 1024:
            return False, "MP4 文件过小，可能未写完", None
    except OSError as error:
        return False, "MP4 状态读取失败：%s" % error, None

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        cap.release()
        return False, "MP4 无法打开", None
    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        first_ok, first = cap.read()
        last_ok, last = False, None
        if frame_count > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count - 1))
            last_ok, last = cap.read()
        if not last_ok:
            # 索引损坏或可变帧率时顺序解码；不能仅凭容器声明帧数判定完成。
            cap.release()
            cap = cv2.VideoCapture(path)
            decoded = 0
            while cap.isOpened():
                ok, frame = cap.read()
                if not ok:
                    break
                last = frame
                decoded += 1
            last_ok = decoded > 0
            if decoded:
                frame_count = decoded
        if not first_ok or first is None:
            return False, "MP4 首帧无法解码", None
        if not last_ok or last is None:
            return False, "MP4 尾帧无法解码", None
        if fps <= 0.0 or frame_count <= 0 or width <= 0 or height <= 0:
            return False, "MP4 帧数、帧率或尺寸无效", None
        return True, "", {
            "fps": fps,
            "frames": frame_count,
            "duration": frame_count / fps,
            "width": width,
            "height": height,
        }
    finally:
        cap.release()


def _validate_segment_artifacts(seg, mode="create", project_id="default",
                                expected_duration=None, expected_fps=24,
                                video_path=None, tail_path=None):
    """把 MP4、无损尾帧视为同一个完成单元；任一无效都不能命中缓存。"""
    video_path = video_path or _seg_video(seg, mode, project_id)
    tail_path = tail_path or _seg_tail(seg, mode, project_id)
    ok, reason, probe = _probe_segment_video(video_path)
    if not ok:
        return False, reason, None
    if expected_duration is not None:
        expected = _expected_segment_duration(expected_duration)
        tolerance = max(0.50, expected * 0.08)
        if abs(float(probe["duration"]) - expected) > tolerance:
            return False, "MP4 时长 %.3f 秒与预期 %.3f 秒不一致" % (
                probe["duration"], expected), None
    try:
        expected_fps = max(8, min(24, int(expected_fps or 24)))
    except (TypeError, ValueError):
        expected_fps = 24
    if abs(float(probe["fps"]) - expected_fps) > 0.75:
        return False, "MP4 帧率 %.3f 与预期 %d 不一致" % (probe["fps"], expected_fps), None
    if not os.path.isfile(tail_path):
        return False, "尾帧 PNG 不存在", None
    try:
        with Image.open(tail_path) as image:
            tail = np.asarray(image.convert("RGB"), dtype=np.uint8)
    except (OSError, ValueError) as error:
        return False, "尾帧 PNG 无法读取：%s" % error, None
    if tail.shape[:2] != (probe["height"], probe["width"]):
        return False, "尾帧尺寸与 MP4 不一致", None
    if not lossless_tail_is_current(tail_path, video_path):
        return False, "尾帧早于当前 MP4，可能属于旧分段", None
    decoded_tail, tail_info = extract_clean_tail_frame(video_path)
    if decoded_tail is None:
        return False, "MP4 尾部无法提取：%s" % (tail_info or {}).get("reason", "未知错误"), None
    decoded_tail = np.asarray(decoded_tail, dtype=np.uint8)
    if decoded_tail.shape != tail.shape:
        return False, "尾帧与 MP4 尾部尺寸不一致", None
    mean_delta = float(np.abs(decoded_tail.astype(np.float32) - tail.astype(np.float32)).mean())
    if mean_delta > 24.0:
        return False, "尾帧与当前 MP4 尾部不对应（差异 %.2f）" % mean_delta, None
    probe = dict(probe)
    probe.update({
        "tail_delta": mean_delta,
        "video_signature": _path_signature(video_path),
        "tail_signature": _path_signature(tail_path),
    })
    return True, "", probe


def _signature_matches(saved, current):
    if not isinstance(saved, dict) or not isinstance(current, dict):
        return False
    return (int(saved.get("size", -1)) == int(current.get("size", -2))
            and int(saved.get("mtime_ns", -1)) == int(current.get("mtime_ns", -2)))


def _validate_segment_checkpoint(seg, expected_hash, mode="create", project_id="default",
                                 expected_duration=None, expected_fps=24):
    """返回 (有效, 原因, 元数据, 探测信息, 是否旧格式)。"""
    meta_path = _seg_meta(seg, mode, project_id)
    if not os.path.isfile(meta_path):
        return False, "完成 JSON 不存在", None, None, False
    try:
        with open(meta_path, encoding="utf-8") as handle:
            meta = json.load(handle)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        return False, "完成 JSON 损坏：%s" % error, None, None, False
    if not isinstance(meta, dict) or meta.get("hash") != expected_hash:
        return False, "配置哈希已变化", meta if isinstance(meta, dict) else None, None, False
    if meta.get("complete") is False:
        return False, "上次运行未完成", meta, None, False
    project_dir = _project_dir(project_id)
    video_path = _recorded_segment_path(meta, project_dir, "active_video", "video", ".mp4")
    tail_path = _recorded_segment_path(meta, project_dir, "active_tail", "tail", ".png")
    valid, reason, probe = _validate_segment_artifacts(
        seg, mode, project_id, expected_duration=expected_duration, expected_fps=expected_fps,
        video_path=video_path, tail_path=tail_path)
    if not valid:
        return False, reason, meta, None, False
    legacy = "complete" not in meta
    if not legacy:
        if not _signature_matches(meta.get("video"), probe.get("video_signature")):
            return False, "MP4 已在完成记录后被改动", meta, probe, False
        if not _signature_matches(meta.get("tail"), probe.get("tail_signature")):
            return False, "尾帧已在完成记录后被改动", meta, probe, False
    return True, "", meta, probe, legacy


def _complete_segment_metadata(meta_path, expected_hash, prompt, probe, legacy=False,
                               second_sample_diagnostics=None):
    active_video = probe["video_signature"]["path"]
    active_tail = probe["tail_signature"]["path"]
    version_match = re.search(r"_(\d+)_(?:.*)\.mp4$", active_video, re.I)
    payload = {
        "schema": CHECKPOINT_SCHEMA,
        "cache_schema": CACHE_SCHEMA,
        "hash": expected_hash,
        "prompt": str(prompt or ""),
        "complete": True,
        "active_video": active_video,
        "active_tail": active_tail,
        "version": int(version_match.group(1)) if version_match else 1,
        "video": probe["video_signature"],
        "tail": probe["tail_signature"],
        "media": {
            "fps": probe["fps"],
            "frames": probe["frames"],
            "duration": probe["duration"],
            "width": probe["width"],
            "height": probe["height"],
            "tail_delta": probe["tail_delta"],
        },
        "completed_at": time.time(),
    }
    if legacy:
        payload["upgraded_from_legacy"] = True
    if isinstance(second_sample_diagnostics, dict):
        payload["second_sample_diagnostics"] = second_sample_diagnostics
    _atomic_write_json(meta_path, payload)


def _record_second_sample_fallback(meta_path, pending_meta, video_path, tail_path, error,
                                   second_sample_diagnostics=None):
    payload = dict(pending_meta)
    match = re.search(r"_(\d+)_(?:.*)\.mp4$", os.path.basename(video_path), re.I)
    version = int(match.group(1)) if match else 1
    payload.update({
        "complete": False,
        "active_video": os.path.basename(video_path),
        "active_tail": os.path.basename(tail_path),
        "version": version,
        "video": _path_signature(video_path),
        "tail": _path_signature(tail_path),
        "second_sample_error": str(error),
        "failed_at": time.time(),
    })
    if isinstance(second_sample_diagnostics, dict):
        payload["second_sample_diagnostics"] = second_sample_diagnostics
    _atomic_write_json(meta_path, payload)
    return payload


def _second_sample_metadata(diagnostics, cache_written):
    if not isinstance(diagnostics, dict) or diagnostics.get("second_sample_mode", "off") == "off":
        return None
    failure = diagnostics.get("second_sample_failure")
    stages = dict(diagnostics.get("second_sample_stages") or {})
    identity = {
        "prompt_id": str(diagnostics.get("second_sample_prompt_id") or ""),
        "node": str(diagnostics.get("second_sample_node") or ""),
        "display_node": str(diagnostics.get("second_sample_display_node") or ""),
    }
    project_id = str(diagnostics.get("second_sample_project_id") or "default")
    segment_index = int(diagnostics.get("second_sample_segment_index") or 0)
    if isinstance(failure, dict):
        terminal_stage = next((stage for stage, _label in SECOND_SAMPLE_STAGES
                               if (stages.get(stage) or {}).get("status") == "failed"),
                              "first_release")
        terminal_status = "failed"
    else:
        terminal_stage = "audio_restore"
        terminal_status = "completed"
    terminal_diagnostics = stages.get(terminal_stage) or {}
    terminal_event = _second_sample_stage_payload(
        identity, project_id, segment_index, terminal_stage, terminal_status,
        elapsed_seconds=terminal_diagnostics.get("elapsed_seconds"),
        step_current=terminal_diagnostics.get("step_current"),
        step_total=terminal_diagnostics.get("step_total"),
        external_upscaler_cached=terminal_diagnostics.get("external_upscaler_cached"),
        failure=failure,
        snapshot={
            "resident_models": terminal_diagnostics.get("resident_models"),
            "memory": dict(terminal_diagnostics.get("memory") or {}),
        })
    return {
        "schema": 1,
        "prompt_id": identity["prompt_id"],
        "node": identity["node"],
        "display_node": identity["display_node"],
        "project_id": project_id,
        "segment_index": segment_index,
        "mode": diagnostics.get("second_sample_mode"),
        "sampling_layout": str(diagnostics.get("second_sample_sampling_layout") or "tiled"),
        "steps": int(diagnostics.get("second_sample_steps") or 0),
        "denoise": float(diagnostics.get("second_sample_denoise") or 0.0),
        "tiled": diagnostics.get("second_sampling_tiled") is True,
        "tile_axis": str(diagnostics.get("second_sampling_tile_axis") or ""),
        "tile_count": int(diagnostics.get("second_sampling_tile_count") or 1),
        "tile_overlap": int(diagnostics.get("second_sampling_tile_overlap") or 0),
        "tile_index": int(diagnostics.get("second_sampling_tile_index") or 0),
        "tile_disabled_reason": str(
            diagnostics.get("second_sampling_tile_disabled_reason") or ""),
        "first_width": int(diagnostics.get("second_sample_first_width") or 0),
        "first_height": int(diagnostics.get("second_sample_first_height") or 0),
        "target_width": int(diagnostics.get("second_sample_target_width") or 0),
        "target_height": int(diagnostics.get("second_sample_target_height") or 0),
        "upscale_memory_required": int(
            diagnostics.get("second_sample_upscale_memory_required") or 0),
        "handoff_model_preserved": diagnostics.get(
            "second_sample_handoff_model_preserved") is True,
        "handoff_cast_buffers_reset": diagnostics.get(
            "second_sample_handoff_cast_buffers_reset") is True,
        "handoff_prefetch_queues_cleaned": diagnostics.get(
            "second_sample_handoff_prefetch_queues_cleaned") is True,
        "upscale_handoff_model_preserved": diagnostics.get(
            "second_sample_upscale_handoff_model_preserved") is True,
        "external_upscaler_cached": diagnostics.get(
            "second_sample_external_upscaler_cached") is True,
        "upscaler_cache_release": dict(
            diagnostics.get("second_sample_upscaler_cache_release") or {}),
        "second_pass_completed": diagnostics.get(
            "second_sample_second_pass_completed") is True,
        "second_pass_cache_written": bool(cache_written),
        "runtime_released": diagnostics.get("second_sample_runtime_released") is True,
        "stages": stages,
        "failure": dict(failure) if isinstance(failure, dict) else None,
        "terminal_event": terminal_event,
    }


def _upstream_fingerprint(prompt, unique_id, input_name):
    if not isinstance(prompt, dict):
        return "unknown"
    node = prompt.get(str(unique_id)) or prompt.get(unique_id)
    if not isinstance(node, dict):
        return "unknown"

    prompt_ids = {str(k) for k in prompt}

    def visit(node_id, seen):
        key = str(node_id)
        if key in seen:
            return {"cycle": key}
        src = prompt.get(key) or prompt.get(node_id)
        if not isinstance(src, dict):
            return {"missing": key}
        seen = set(seen)
        seen.add(key)
        out = {"class_type": src.get("class_type"), "inputs": {}}
        for name, value in sorted((src.get("inputs") or {}).items()):
            if isinstance(value, list) and len(value) == 2 and str(value[0]) in prompt_ids:
                out["inputs"][name] = {"slot": value[1], "node": visit(value[0], seen)}
            elif isinstance(value, (str, int, float, bool)) or value is None:
                out["inputs"][name] = value
            else:
                out["inputs"][name] = repr(value)
        return out

    link = (node.get("inputs") or {}).get(input_name)
    if not (isinstance(link, list) and len(link) == 2):
        return "not_connected"
    payload = {"slot": link[1], "node": visit(link[0], set())}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _upstream_link(prompt, unique_id, input_name):
    if not isinstance(prompt, dict):
        return None
    node = prompt.get(str(unique_id)) or prompt.get(unique_id)
    if not isinstance(node, dict):
        return None
    link = (node.get("inputs") or {}).get(input_name)
    if isinstance(link, list) and len(link) == 2:
        return link
    return None


def _upstream_model_kind(prompt, unique_id, input_name="model"):
    """只读检查模型输入的上游节点，识别 FL2VA / Ref2VA。

    ComfyUI 的 MODEL 对象没有稳定公开的文件名属性；运行 prompt 图里则会保留
    UNETLoader 的模型文件名。这里只返回分类结果，不记录或输出上游字符串。
    """
    if not isinstance(prompt, dict):
        return "unknown"
    node = prompt.get(str(unique_id)) or prompt.get(unique_id)
    if not isinstance(node, dict):
        return "unknown"

    prompt_ids = {str(k) for k in prompt}
    texts = []

    def visit(node_id, seen):
        key = str(node_id)
        if key in seen:
            return
        src = prompt.get(key) or prompt.get(node_id)
        if not isinstance(src, dict):
            return
        seen = set(seen)
        seen.add(key)
        class_type = src.get("class_type")
        if isinstance(class_type, str):
            texts.append(class_type)
        for name, value in (src.get("inputs") or {}).items():
            if isinstance(name, str):
                texts.append(name)
            if isinstance(value, list) and len(value) == 2 and str(value[0]) in prompt_ids:
                visit(value[0], seen)
            elif isinstance(value, str):
                texts.append(value)

    link = (node.get("inputs") or {}).get(input_name)
    if not (isinstance(link, list) and len(link) == 2):
        return "not_connected"
    visit(link[0], set())
    marker = "\n".join(texts).lower()
    is_fl2va = any(x in marker for x in ("fl2va", "fl2v", "firstlast", "first_last"))
    is_ref2va = any(x in marker for x in ("ref2va", "ref2v", "reference_to_video"))
    if is_fl2va and not is_ref2va:
        return "fl2va"
    if is_ref2va and not is_fl2va:
        return "ref2va"
    return "unknown"


def _source_contract_views(segment):
    """返回段级兼容字段及可选 source_contract 对象，不从提示词正文猜测契约。"""
    if not isinstance(segment, dict):
        return []
    views = [segment]
    nested = segment.get("source_contract")
    if isinstance(nested, dict):
        views.append(nested)
    return views


class _H3GenerationNotice(ValueError):
    pass


def _normalize_source_aspect(value):
    text = str(value or "").strip().lower()
    if not text:
        return None
    text = text.replace("：", ":").replace("×", ":").replace("x", ":")
    compact = re.sub(r"\s+", "", text)
    if re.search(r"(?:^|[^0-9])9:16(?:[^0-9]|$)", compact):
        return "9:16"
    if re.search(r"(?:^|[^0-9])16:9(?:[^0-9]|$)", compact):
        return "16:9"
    if any(marker in compact for marker in ("portrait", "vertical", "竖屏", "竖版", "纵向")):
        return "portrait"
    if any(marker in compact for marker in ("landscape", "horizontal", "横屏", "横版", "横向")):
        return "landscape"
    raise _H3GenerationNotice("[H3导演台] 不支持的源画幅契约：%s（支持 9:16、16:9、portrait、landscape）" % value)


def _validate_source_aspect_contract(segments, width, height):
    """若有源画幅契约，逐段按与 _run_segment 相同的有效宽高规则检查。"""
    values = []
    top_keys = ("source_aspect_contract", "source_aspect", "source_aspect_ratio", "source_orientation")
    nested_keys = top_keys + ("aspect", "aspect_ratio", "orientation")
    for segment in segments:
        views = _source_contract_views(segment)
        for view_index, view in enumerate(views):
            keys = top_keys if view_index == 0 else nested_keys
            for key in keys:
                if key in view and str(view.get(key) or "").strip():
                    values.append(_normalize_source_aspect(view.get(key)))
    if not values:
        return None

    portrait_contracts = {value for value in values if value in ("9:16", "portrait")}
    landscape_contracts = {value for value in values if value in ("16:9", "landscape")}
    if portrait_contracts and landscape_contracts:
        raise _H3GenerationNotice("[H3导演台] segments_json 中存在互相冲突的源画幅契约：%s" % ", ".join(sorted(set(values))))

    contract = ("9:16" if "9:16" in portrait_contracts else
                "portrait" if portrait_contracts else
                "16:9" if "16:9" in landscape_contracts else "landscape")
    expected_portrait = contract in ("9:16", "portrait")

    try:
        global_width = int(width)
        global_height = int(height)
    except (TypeError, ValueError):
        raise ValueError("[H3导演台] 节点全局输出宽高无效：%sx%s" % (width, height))
    effective_sizes = []
    for segment_index, segment in enumerate(segments, 1):
        if not isinstance(segment, dict):
            raise ValueError("[H3导演台] 第%d段不是合法对象" % segment_index)
        try:
            override_width = int(segment.get("width") or 0)
            override_height = int(segment.get("height") or 0)
        except (TypeError, ValueError):
            raise ValueError("[H3导演台] 第%d段的宽高覆盖不是有效整数" % segment_index)
        if override_width >= 256 and override_height >= 256:
            actual_width, actual_height = override_width, override_height
        else:
            actual_width, actual_height = global_width, global_height
        if actual_width <= 0 or actual_height <= 0:
            raise ValueError(
                "[H3导演台] 第%d段实际输出宽高必须为正数，当前为 %dx%d"
                % (segment_index, actual_width, actual_height))
        effective_sizes.append((actual_width, actual_height))
        is_portrait = actual_height > actual_width
        if is_portrait != expected_portrait or actual_width == actual_height:
            expected_label = "竖屏" if expected_portrait else "横屏"
            raise _H3GenerationNotice(
                "[H3导演台] 第%d段源画幅契约为 %s（%s），但实际输出为 %dx%d。"
                "请先修改该段宽高覆盖或分辨率选择器，避免生成错误画幅。"
                % (segment_index, contract, expected_label, actual_width, actual_height))

        if contract in ("9:16", "16:9"):
            expected_ratio = 9.0 / 16.0 if contract == "9:16" else 16.0 / 9.0
            actual_ratio = actual_width / actual_height
            relative_error = abs(actual_ratio - expected_ratio) / expected_ratio
            if relative_error > 0.06:
                raise _H3GenerationNotice(
                    "[H3导演台] 第%d段源画幅契约为 %s，但实际输出 %dx%d 的宽高比偏差 %.1f%%。"
                    "请使用与源画幅一致的分辨率。"
                    % (segment_index, contract, actual_width, actual_height, relative_error * 100.0))
    return {
        "contract": contract,
        "segment_count": len(effective_sizes),
        "sizes": sorted(set(effective_sizes)),
    }


def _parse_contract_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError("[H3导演台] %s 不是有效数字：%s" % (label, value))
    if not math.isfinite(number) or number <= 0:
        raise ValueError("[H3导演台] %s 必须为大于 0 的有限数字：%s" % (label, value))
    return number


def _extract_authoritative_duration_contract(segments):
    """提取显式权威源时长；普通文本估算或缺少权威标记时返回 None。"""
    totals = []
    explicit_authority = False
    explicit_estimate = False
    authoritative_format = False
    preserve_policy = False
    allow_retime = False
    authoritative_formats = {
        "official-base", "official_base", "official-ref2va", "official_ref2va",
        "chinese-archive", "chinese_archive", "structured-markdown-screenplay",
        "structured_markdown_screenplay", "markdown-screenplay", "director-manifest",
    }
    authority_words = {"authoritative", "explicit", "timeline", "timecode", "manifest", "preserve"}
    estimate_words = {"estimate", "estimated", "ordinary-text-estimate", "reading-speed", "heuristic"}
    retime_words = {"retime", "allow-retime", "allow_retime", "override", "stretch", "ignore"}

    top_total_keys = ("source_total_duration", "source_total_duration_seconds")
    nested_total_keys = top_total_keys + ("total_duration", "total_duration_seconds")
    authority_keys = ("source_duration_authoritative", "source_total_duration_authoritative",
                      "duration_authoritative")
    kind_keys = ("source_duration_kind", "source_duration_basis", "duration_basis")
    format_keys = ("source_format", "source_format_id")
    policy_keys = ("source_duration_policy", "duration_policy")

    for segment in segments:
        views = _source_contract_views(segment)
        for view_index, view in enumerate(views):
            total_keys = top_total_keys if view_index == 0 else nested_total_keys
            for key in total_keys:
                if key in view and view.get(key) not in (None, ""):
                    totals.append(_parse_contract_number(view.get(key), key))
            for key in authority_keys:
                if key in view:
                    if view.get(key) is True:
                        explicit_authority = True
                    elif view.get(key) is False:
                        explicit_estimate = True
            for key in kind_keys:
                if key in view:
                    marker = str(view.get(key) or "").strip().lower()
                    explicit_authority = explicit_authority or marker in authority_words
                    explicit_estimate = explicit_estimate or marker in estimate_words
            for key in format_keys:
                if key in view:
                    marker = str(view.get(key) or "").strip().lower()
                    authoritative_format = authoritative_format or marker in authoritative_formats
                    explicit_estimate = explicit_estimate or marker in ("ordinary-text", "ordinary_text")
            for key in policy_keys:
                if key in view:
                    marker = str(view.get(key) or "").strip().lower()
                    allow_retime = allow_retime or marker in retime_words
                    preserve_policy = preserve_policy or marker in ("preserve", "strict", "conserve")

    if not totals:
        return None
    reference = totals[0]
    if any(abs(value - reference) > 0.001 for value in totals[1:]):
        raise ValueError("[H3导演台] segments_json 中的 source_total_duration 不一致：%s" % totals)
    if allow_retime:
        return {"source": reference, "authoritative": False, "retime": True}
    if explicit_estimate and not explicit_authority and not authoritative_format:
        return None
    if not explicit_authority and not authoritative_format and not preserve_policy:
        return None
    return {"source": reference, "authoritative": True, "retime": False}


def _duration_contract_scope_metadata(segment, segment_index):
    """读取契约身份与可选源区间；这些字段只用于分组，不从提示词正文推断。"""
    text_fields = {
        "contract_id": [],
        "format": [],
        "policy": [],
    }
    number_fields = {
        "start": [],
        "end": [],
    }
    for view_index, view in enumerate(_source_contract_views(segment)):
        id_keys = ("source_contract_id", "source_duration_contract_id") if view_index == 0 else (
            "contract_id", "source_contract_id", "source_duration_contract_id")
        format_keys = ("source_format", "source_format_id") if view_index == 0 else (
            "format", "format_id", "source_format", "source_format_id")
        policy_keys = ("source_duration_policy", "duration_policy")
        start_keys = ("source_segment_start_seconds", "segment_start_seconds")
        end_keys = ("source_segment_end_seconds", "segment_end_seconds")
        for field, keys in (("contract_id", id_keys), ("format", format_keys), ("policy", policy_keys)):
            for key in keys:
                value = str(view.get(key) or "").strip()
                if value:
                    text_fields[field].append(value)
        for field, keys in (("start", start_keys), ("end", end_keys)):
            for key in keys:
                if key not in view or view.get(key) in (None, ""):
                    continue
                try:
                    value = float(view.get(key))
                except (TypeError, ValueError):
                    raise ValueError(
                        "[H3导演台] 第%d段 %s 不是有效数字：%s"
                        % (segment_index, key, view.get(key)))
                if not math.isfinite(value) or value < 0:
                    raise ValueError(
                        "[H3导演台] 第%d段 %s 必须为非负有限数字：%s"
                        % (segment_index, key, view.get(key)))
                number_fields[field].append(value)

    normalized_text = {}
    for field, values in text_fields.items():
        unique = []
        for value in values:
            marker = value.lower() if field != "contract_id" else value
            if marker not in [item[0] for item in unique]:
                unique.append((marker, value))
        if len(unique) > 1:
            raise ValueError(
                "[H3导演台] 第%d段的 %s 不一致：%s"
                % (segment_index, field, [item[1] for item in unique]))
        normalized_text[field] = unique[0][1] if unique else ""

    normalized_number = {}
    for field, values in number_fields.items():
        if values and any(abs(value - values[0]) > 0.001 for value in values[1:]):
            raise ValueError(
                "[H3导演台] 第%d段的 source segment %s 不一致：%s"
                % (segment_index, field, values))
        normalized_number[field] = values[0] if values else None
    start = normalized_number["start"]
    end = normalized_number["end"]
    if (start is None) != (end is None):
        raise ValueError(
            "[H3导演台] 第%d段的源区间必须同时包含 start 和 end" % segment_index)
    if start is not None and end <= start:
        raise ValueError(
            "[H3导演台] 第%d段的源区间无效：%.3f–%.3f 秒"
            % (segment_index, start, end))
    return {
        "contract_id": normalized_text["contract_id"],
        "format": normalized_text["format"].strip().lower(),
        "policy": normalized_text["policy"].strip().lower(),
        "start": start,
        "end": end,
    }


def _group_authoritative_duration_contracts(segments):
    """按导入身份分组；停用段仍属于原契约，无契约的手动新增段不进入旧契约。"""
    groups = []
    groups_by_id = {}
    legacy_global_groups = {}
    legacy_span_current = None

    def new_group(kind, label, contract, metadata):
        group = {
            "kind": kind,
            "label": label,
            "contract_id": metadata.get("contract_id") or "",
            "source": contract["source"],
            "format": metadata.get("format") or "",
            "policy": metadata.get("policy") or "",
            "members": [],
            "last_span_end": None,
        }
        groups.append(group)
        return group

    def assert_compatible(group, contract, metadata, segment_index):
        if abs(group["source"] - contract["source"]) > 0.001:
            raise ValueError(
                "[H3导演台] 同一 source_contract_id 在第%d段出现冲突总时长：%.3f 与 %.3f 秒"
                % (segment_index, group["source"], contract["source"]))
        for key, label in (("format", "格式"), ("policy", "时长策略")):
            old_value = group.get(key) or ""
            new_value = metadata.get(key) or ""
            if old_value and new_value and old_value != new_value:
                raise ValueError(
                    "[H3导演台] 同一 source_contract_id 在第%d段出现冲突%s：%s 与 %s"
                    % (segment_index, label, old_value, new_value))
            if not old_value and new_value:
                group[key] = new_value

    for segment_index, segment in enumerate(segments, 1):
        if not isinstance(segment, dict):
            raise ValueError("[H3导演台] 第%d段不是合法对象" % segment_index)
        contract = _extract_authoritative_duration_contract([segment])
        if not contract or not contract.get("authoritative"):
            legacy_span_current = None
            continue
        metadata = _duration_contract_scope_metadata(segment, segment_index)
        contract_id = metadata["contract_id"]
        if contract_id:
            legacy_span_current = None
            group = groups_by_id.get(contract_id)
            if group is None:
                group = new_group("id", "契约 %s" % contract_id[:24], contract, metadata)
                groups_by_id[contract_id] = group
            else:
                assert_compatible(group, contract, metadata, segment_index)
        elif metadata["start"] is not None:
            signature = (round(contract["source"], 6), metadata["format"], metadata["policy"])
            start = metadata["start"]
            previous_end = legacy_span_current.get("last_span_end") if legacy_span_current else None
            continues = bool(
                legacy_span_current
                and legacy_span_current.get("signature") == signature
                and previous_end is not None
                and start >= previous_end - 0.001
                and not (start <= 0.001 and previous_end > 0.001)
            )
            if not continues:
                group = new_group(
                    "legacy-span", "旧契约区间组 %d" % (len(groups) + 1), contract, metadata)
                group["signature"] = signature
                legacy_span_current = group
            else:
                group = legacy_span_current
            group["last_span_end"] = metadata["end"]
        else:
            legacy_span_current = None
            signature = (round(contract["source"], 6), metadata["format"], metadata["policy"])
            group = legacy_global_groups.get(signature)
            if group is None:
                group = new_group(
                    "legacy-global", "旧契约组 %d" % (len(groups) + 1), contract, metadata)
                legacy_global_groups[signature] = group
        group["members"].append((segment_index, segment))
    if len(legacy_global_groups) > 1:
        summaries = [
            "%s/%.3f秒" % (group.get("format") or "未知格式", group["source"])
            for group in legacy_global_groups.values()
        ]
        raise ValueError(
            "[H3导演台] 检测到多组无 source_contract_id、无源区间且彼此不同的旧权威契约：%s。"
            "无法安全判断它们是独立导入还是元数据损坏，请分别重新执行“解析导入”或“导入到当前段”以建立独立契约。"
            % "，".join(summaries))
    return groups


def _validate_authoritative_duration_contract(segments, default_duration):
    """逐契约组验证权威时间轴；独立手动段不污染旧源时长，停用不能绕过门禁。"""
    groups = _group_authoritative_duration_contracts(segments)
    if not groups:
        return None
    # 极早期工作流可能只把权威契约写在导入批次的第一段。仅当这个单独旧契约段
    # 明显尚未覆盖源总时长时，才保守接纳其后的连续无契约段，直到下一个显式契约。
    # 若该段本身已经完整覆盖源时长（例如本次 8 秒官方段），后加普通段绝不被旧契约认领。
    contracted_indices = {
        segment_index
        for group in groups
        for segment_index, _segment in group["members"]
    }
    for group in groups:
        if group["kind"] != "legacy-global" or len(group["members"]) != 1:
            continue
        first_index, first_segment = group["members"][0]
        first_duration = _parse_contract_number(
            first_segment.get("duration", default_duration), "第%d段 duration" % first_index)
        if first_duration >= group["source"] * 0.95:
            continue
        next_contract_index = min(
            (index for index in contracted_indices if index > first_index),
            default=len(segments) + 1,
        )
        inferred = []
        for segment_index in range(first_index + 1, next_contract_index):
            if segment_index in contracted_indices:
                break
            inferred.append((segment_index, segments[segment_index - 1]))
        if inferred:
            group["members"].extend(inferred)
            group["legacy_inferred_members"] = [index for index, _segment in inferred]
    results = []
    for group in groups:
        imported = 0.0
        segment_indices = []
        for segment_index, segment in group["members"]:
            imported += _parse_contract_number(
                segment.get("duration", default_duration), "第%d段 duration" % segment_index)
            segment_indices.append(segment_index)
        source = group["source"]
        segment_count = len(group["members"])
        ratio = imported / source
        allowed_delta = max(2.0, 0.4 * segment_count)
        delta = abs(imported - source)
        if delta > allowed_delta or ratio < 0.95 or ratio > 1.05:
            raise ValueError(
                "[H3导演台] 权威源时长 %.3f 秒，但当前契约组 %s 的 %d 段合计 %.3f 秒（%.1f%%）。"
                "允许误差为 %.3f 秒且建议比例为 95%%–105%%；本次仍会继续生成。"
                "契约覆盖原时间轴第 %s 段；停用只控制本次执行，不会改变源契约。"
                "请重新按源时间码解析该契约组，不要只在全局提示词中写目标时长。"
                % (source, group["label"], segment_count, imported, ratio * 100.0,
                   allowed_delta, ",".join(map(str, segment_indices))))
        results.append({
            "source": source,
            "imported": imported,
            "ratio": ratio,
            "segment_count": segment_count,
            "allowed_delta": allowed_delta,
            "contract_id": group.get("contract_id") or "",
            "label": group["label"],
            "segment_indices": segment_indices,
        })
    source = sum(item["source"] for item in results)
    imported = sum(item["imported"] for item in results)
    return {
        "source": source,
        "imported": imported,
        "ratio": imported / source,
        "segment_count": sum(item["segment_count"] for item in results),
        "allowed_delta": sum(item["allowed_delta"] for item in results),
        "group_count": len(results),
        "groups": results,
    }


def _select_h3_task(primary_model_kind):
    """主 model 决定本段使用 FL2VA 还是 Ref2VA。"""
    return "fl2va" if primary_model_kind == "fl2va" else "ref2va"


def _segment_has_reference_material(segment, shared_ref_count=0):
    if not isinstance(segment, dict):
        return False
    has_shared = bool(shared_ref_count) and segment.get("inherit_shared", True)
    has_image = bool(segment.get("refs"))
    has_audio_ref = bool(segment.get("voice_refs")) or (
        bool(segment.get("audio")) and segment.get("audio_src") == "ref")
    has_video_ref = bool(segment.get("video_refs"))
    return has_shared or has_image or has_audio_ref or has_video_ref


VIDEO_REFERENCE_MODES = {
    "action": "the subject motion, body mechanics and blocking",
    "camera": "the camera trajectory, framing changes and camera orientation",
    "rhythm": "the visible action timing, acceleration, pauses and pacing",
    "comprehensive": "the camera trajectory, subject motion, blocking and visible pacing",
}


def _video_reference_mode(segment, name, index):
    modes = segment.get("video_ref_modes") or {}
    if isinstance(modes, dict):
        mode = modes.get(name)
    elif isinstance(modes, list) and index < len(modes):
        mode = modes[index]
    else:
        mode = None
    return mode if mode in VIDEO_REFERENCE_MODES else "comprehensive"


REF_AUDIO_SR = 32000  # H3 audio_vae 原生采样率


def _load_audio_for_ref(path, seg_cfg, ffmpeg):
    """把自定义音频解码成 ComfyUI AUDIO 类型，供 MiniMaxH3ReferenceToVideo 的
    ref_audios 参考驱动（模型听着这段音频生成台词，口型原生同步——与 ffmpeg
    事后替换音轨有本质区别，后者口型必然对不上）。

    复用与 _write_segment_video 相同的裁剪语义：trim_start/end + keep/cut + offset。
    音频经 ffmpeg 输出 f32le PCM 到 stdout（新版 torchaudio 强制 torchcodec，
    Windows 难装，刻意不用），offset 以前导静音补齐。"""
    ts = max(0.0, float(seg_cfg.get("audio_trim_start") or 0))
    te = float(seg_cfg.get("audio_trim_end") or 0)
    mode = seg_cfg.get("audio_trim_mode", "keep")
    off = max(0.0, float(seg_cfg.get("audio_offset") or 0))
    mid_cut = mode == "cut" and ts > 0 and te > ts

    args = [ffmpeg, "-y"]
    if mid_cut:
        # 删除 [ts,te] 保留首尾（同 _write_segment_video 的 _cut_pre 链）
        fc = ("[0:a]asplit=2[cax][cay];"
              "[cax]atrim=0:%.3f,asetpts=PTS-STARTPTS[cap];"
              "[cay]atrim=start=%.3f,asetpts=PTS-STARTPTS[caq];"
              "[cap][caq]concat=n=2:v=0:a=1[cac];"
              "[cac]aformat=sample_rates=%d:channel_layouts=stereo[aout]" % (ts, te, REF_AUDIO_SR))
        args += ["-i", path, "-filter_complex", fc, "-map", "[aout]"]
    else:
        # 与 _write_segment_video 的 ca_in 语义逐条对应（-ss/-t 均在 -i 之前）
        if mode == "cut":
            if te > 0:
                args += ["-ss", "%.3f" % te]     # 删除 [0,te] = 保留 [te,尾]
            elif ts > 0:
                args += ["-t", "%.3f" % ts]      # 删除 [ts,尾] = 保留 [0,ts]
        else:
            if ts > 0:
                args += ["-ss", "%.3f" % ts]
            if te > ts and te > 0:
                args += ["-t", "%.3f" % (te - ts)]
        args += ["-i", path, "-ar", str(REF_AUDIO_SR), "-ac", "2"]
    args += ["-f", "f32le", "-"]
    r = _run(args)
    arr = np.frombuffer(r.stdout, dtype=np.float32)
    if arr.size == 0:
        raise RuntimeError("音频解码结果为空: " + path)
    wav = torch.from_numpy(arr.reshape(-1, 2).T.copy()).unsqueeze(0)  # [1,2,L]
    if off > 0:
        pad = torch.zeros(1, 2, int(round(off * REF_AUDIO_SR)))
        wav = torch.cat([pad, wav], dim=-1)
    return {"waveform": wav, "sample_rate": REF_AUDIO_SR}


def _load_video_for_ref(path, ffmpeg, seg_cfg=None):
    """读参考视频（白模/成片参考）→ (IMAGE 帧 batch, AUDIO|None)。

    H3 原生 ref_videos 契约：IMAGE 帧序列 @24fps、2~15s（帧数由 H3 节点自己
    对齐 17k+5 网格并截断，这里只需不超 15s、不少于 5 帧）。
    解码走 imageio_ffmpeg read_frames 管道（避开 torchcodec/torchvision 视频 API
    在 Windows 的坑）；最长边预缩到 1280 控内存（H3 内部还会按画布再缩）。
    音轨复用 _load_audio_for_ref 的 PCM 管道（v2.2 起跟随段的裁剪/偏移设置，
    即视频界面 AUDIO 轨道上的拖拽调整对视频音轨同样生效）；
    无音轨（如白模渲染）返回 None。"""
    import imageio_ffmpeg
    # 加载帧率可调（v2.6）：默认 24=逐帧跟随；调低=抽帧概括动作（省显存、适合只取运镜）。
    cfg = seg_cfg or {}
    vfps = max(1, min(24, int(cfg.get("video_fps") or 24)))
    max_side = 1280
    vskip = max(0.0, float(cfg.get("video_skip") or 0))  # 起始秒（=教程的跳过前X帧，v2.6.1）
    gen = imageio_ffmpeg.read_frames(
        path, pix_fmt="rgb24",
        input_params=(["-ss", "%.3f" % vskip] if vskip > 0 else []),
        output_params=["-vf", "fps=%d,scale='if(gte(iw,ih),min(iw,%d),-2)':'if(gte(iw,ih),-2,min(ih,%d))'"
                       % (vfps, max_side, max_side)])
    meta = next(gen)
    vw, vh = meta["size"]
    # 预分配 uint8 缓冲，避免 list + np.stack 同时保留两份完整参考视频。
    source_duration = max(0.0, float(meta.get("duration") or 15.0) - vskip)
    max_frames = min(24 * 15, max(5, int(source_duration * vfps) + 18))
    frame_store = np.empty((max_frames, vh, vw, 3), dtype=np.uint8)
    frame_count = 0
    for buf in gen:
        frame_store[frame_count] = np.frombuffer(buf, np.uint8).reshape(vh, vw, 3)
        frame_count += 1
        if frame_count >= max_frames:  # H3 参考视频上限 15s
            break
    if frame_count < 5:
        raise RuntimeError("参考视频不足 5 帧（H3 要求 ≥0.2s）: " + path)
    # v2.6.1：向上补齐到 H3 的 17k+5 帧网格（重复末帧）。低帧率采样（如教程的
    # 1fps 人物替换）只有 ~10 帧，H3 节点向下截断会砍到 5 帧丢一半信息；
    # 补齐保持全部关键帧。超 15s 上限时才向下截断。
    frames = frame_store[:frame_count]
    nf = frame_count
    if nf % 17 != 5:
        up = nf + ((5 - nf) % 17)
        if up <= 24 * 15:
            aligned = np.empty((up, vh, vw, 3), dtype=np.uint8)
            aligned[:nf] = frames
            aligned[nf:] = frames[-1]
            frames = aligned
        else:
            frames = frames[:nf - ((nf - 5) % 17)]  # 向下取到 17k+5
    video = torch.from_numpy(frames).to(dtype=torch.float32)
    video.div_(255.0)  # [T,H,W,C]
    del frames, frame_store
    audio = None
    if bool((seg_cfg or {}).get("video_audio_reference")):
        try:
            audio = _load_audio_for_ref(path, seg_cfg or {}, ffmpeg)
        except Exception:
            audio = None  # 无音轨（白模渲染常见），不算错误
    return video, audio


def _load_input_image(name):
    img = Image.open(_resolve_input(name)).convert("RGB")
    arr = np.asarray(img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)[None,]


def _config_hash(cfg):
    s = json.dumps(cfg, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def _run(cmd, **kw):
    # 始终二进制捕获（不开 text 模式）：
    # 1) text 模式 + input=bytes 会让 writer 线程炸 "must be str, not bytes"
    # 2) Windows 中文系统 text 模式默认 GBK 解码，ffmpeg 输出含 UTF-8 字节
    #    （如中文文件名"漫剧"）时 reader 线程炸 UnicodeDecodeError: 'gbk' codec
    # 需要文本时调用方自行 .decode("utf-8", "ignore")。
    r = subprocess.run(cmd, capture_output=True, **kw)
    if r.returncode != 0:
        err = (r.stderr or b"").decode("utf-8", "ignore")
        # 留 1500 字符：ffmpeg 真正的错误行常在输入/输出信息之后，500 会截掉关键原因
        raise RuntimeError("ffmpeg 失败: " + err[-1500:])
    return r


def _run_rawvideo_stream(cmd, frames_u8):
    """逐帧把 RGB24 写入 ffmpeg，避免 ``frames_u8.tobytes()`` 的整段内存副本。

    15 秒 720p RGB 原始帧可接近 1 GiB；subprocess.run(input=...) 会先再复制一份
    连续 bytes，且 communicate 期间同时保留，低内存机器很容易出现持续换页或 OOM。
    这里每次只向管道暴露一帧的 memoryview，stderr 写临时文件避免管道填满死锁。
    """
    arr = np.asarray(frames_u8)
    if arr.ndim != 4 or arr.shape[-1] != 3 or len(arr) < 1:
        raise ValueError("rawvideo 写出需要 [N,H,W,3] 视频帧")

    process = None
    write_error = None
    with tempfile.TemporaryFile() as error_file:
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=error_file,
                bufsize=0,
            )
            for index in range(len(arr)):
                frame = arr[index]
                if frame.dtype != np.uint8:
                    frame = np.clip(frame, 0, 255).astype(np.uint8)
                elif not frame.flags.c_contiguous:
                    frame = np.ascontiguousarray(frame)
                view = memoryview(frame).cast("B")
                while len(view):
                    written = process.stdin.write(view)
                    if not written:
                        raise BrokenPipeError("ffmpeg rawvideo stdin 已关闭")
                    view = view[written:]
        except (BrokenPipeError, OSError) as error:
            write_error = error
        except Exception:
            if process is not None and process.poll() is None:
                process.kill()
            if process is not None:
                process.wait()
            raise
        finally:
            if process is not None and process.stdin is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass

        returncode = process.wait() if process is not None else -1
        error_file.seek(0)
        error_text = error_file.read().decode("utf-8", "ignore")

    if returncode != 0:
        raise RuntimeError("ffmpeg 失败: " + error_text[-1500:])
    if write_error is not None:
        raise RuntimeError("ffmpeg 原始帧流写入失败: %s" % write_error)


def _sanitize_model_audio(audio, target_peak=0.95):
    """清理 H3 audio VAE 的异常浮点并保留动态，而不是硬裁成方波。"""
    if not isinstance(audio, dict) or "waveform" not in audio:
        raise ValueError("H3 模型音频缺少 waveform")
    waveform = audio["waveform"]
    if not torch.is_tensor(waveform):
        waveform = torch.as_tensor(waveform)
    waveform = waveform.detach().float().cpu()
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0).unsqueeze(0)
    elif waveform.dim() == 2:
        waveform = waveform.unsqueeze(0)
    elif waveform.dim() != 3:
        raise ValueError("H3 模型音频 waveform 必须是 [L]、[C,L] 或 [B,C,L]")
    # 少数兼容节点返回 [B,L,C]；仅在最后一维明显是声道时安全转置。
    if waveform.shape[1] > 8 and waveform.shape[2] <= 8:
        waveform = waveform.transpose(1, 2).contiguous()
    if waveform.shape[1] < 1 or waveform.shape[1] > 8 or waveform.shape[-1] < 1:
        raise ValueError("H3 模型音频声道或采样长度无效")
    waveform = torch.nan_to_num(waveform, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(waveform.abs().max().item()) if waveform.numel() else 0.0
    limit = max(0.1, min(0.99, float(target_peak)))
    if peak > limit:
        waveform = waveform * (limit / peak)
    return {
        "waveform": waveform.contiguous(),
        "sample_rate": max(8000, int(audio.get("sample_rate") or REF_AUDIO_SR)),
    }


def _write_segment_video(frames_u8, audio, seg, ffmpeg,
                         custom_audio=None, audio_mode="replace", audio_vol=1.0,
                         audio_enabled=True,
                         audio_trim_start=0.0, audio_trim_end=0.0, audio_offset=0.0,
                          audio_trim_mode="keep", out_fps=24, mode="create",
                          amb_audio=None, amb_vol=0.25, project_id="default",
                          version_label=""):
    """frames_u8: [N,H,W,3] uint8；audio: dict(waveform[B,C,L], sample_rate)，不需要模型音频时可为 None。写出 mp4 + 尾帧。
    custom_audio: 用户上传的本段音频绝对路径（配音/台词），可选。
    audio_mode: replace=自定义音频顶替 H3 原声；mix=与 H3 原声混合（原声自动压到 60%）。
    audio_trim_start/end: 自定义音频的裁剪区间（秒，end<=start 表示取到文件尾）。
    audio_offset: 自定义音频在段视频时间轴上的起始位置（秒），用 adelay 实现。
    输出音轨一律用 -t 对齐视频时长：自定义音频偏长会被截断，偏短则尾部静音，不会拖长视频。"""
    n, h, w, _ = frames_u8.shape
    dur = n / float(FPS)
    audio_rate = MERGE_AUDIO_RATE
    work_dir = _project_dir(project_id)
    os.makedirs(work_dir, exist_ok=True)
    fd, tmpv = tempfile.mkstemp(prefix="_h3_video_", suffix=".mp4", dir=work_dir)
    os.close(fd)
    fd, tmpout = tempfile.mkstemp(prefix="_h3_mux_", suffix=".mp4", dir=work_dir)
    os.close(fd)

    def _run_video_cmd(command, **kwargs):
        try:
            return _run(command, **kwargs)
        except Exception:
            for path in (tmpv, tmpout):
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise

    out_fps = max(8, min(24, int(out_fps)))  # 输出帧率：低于原生 24 即抽帧，时长不变
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostats",
           "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", "%dx%d" % (w, h), "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
           "-movflags", "+faststart"]
    if out_fps != FPS:
        # 输出端 -r 在短片上会因时间基舍入额外丢掉数帧；fps filter 能保持原时长，
        # 只按目标帧率稳定抽帧。
        cmd += ["-vf", "fps=%d" % out_fps]
    cmd.append(tmpv)
    try:
        _run_rawvideo_stream(cmd, frames_u8)
    except Exception:
        for path in (tmpv, tmpout):
            try:
                os.remove(path)
            except OSError:
                pass
        raise

    has_custom_audio = bool(custom_audio and os.path.exists(custom_audio))
    model_audio_required = bool(audio_enabled and (not has_custom_audio or audio_mode == "mix"))
    if model_audio_required:
        # 音频不落地 wav、不用 torchaudio（新版强制要求 torchcodec，Windows 难装），
        # 直接把波形以 f32le 交错格式从 stdin 喂给 ffmpeg，与视频一步合并。
        audio = _sanitize_model_audio(audio)
        wav = audio["waveform"]
        if wav.dim() == 3:
            wav = wav[0]  # [B,C,L] -> [C,L]
        ch = wav.shape[0]
        sr = int(audio["sample_rate"])
        # 不在 Python 侧硬裁剪峰值（硬 clamp 会把偶发超幅直接切成方波，引入砂声）；
        # 统一交给 FFmpeg 的轻限幅尾链处理。
        pcm = wav.t().contiguous()  # [C,L] -> [L,C] 逐帧交错；sanitize 已保证 CPU float32
        audio_bytes = pcm.numpy().tobytes()

    # 自定义音频的输入侧裁剪参数（-ss/-t 放在 -i 之前，秒级精度足够配音场景）。
    # trim_mode=keep：保留 [ts,te]；=cut：删除 [ts,te] 保留首尾——
    # 删头/删尾可换算成 -ss/-t，中间挖洞则需 atrim+concat filter 链（mid_cut）。
    ca_in = []
    ts = max(0.0, float(audio_trim_start or 0))
    te = float(audio_trim_end or 0)
    mid_cut = False
    if has_custom_audio:
        if audio_trim_mode == "cut" and (ts > 0 or te > 0):
            if ts > 0 and te > ts:
                mid_cut = True                     # 删除中段 [ts,te]，保留首尾
            elif te > 0:
                ca_in += ["-ss", "%.3f" % te]      # 删除 [0,te] = 保留 [te,尾]
            elif ts > 0:
                ca_in += ["-t", "%.3f" % ts]       # 删除 [ts,尾] = 保留 [0,ts]
        else:
            if ts > 0:
                ca_in += ["-ss", "%.3f" % ts]
            if te > ts and te > 0:
                ca_in += ["-t", "%.3f" % (te - ts)]
        ca_in += ["-i", custom_audio]
    delay_ms = max(0, int(round(float(audio_offset or 0) * 1000)))

    # 中间挖洞预处理链：src 标签拆两路取首尾，concat 接回后输出到 cac
    def _cut_pre(src):
        # atrim 不会自动把时间戳归零。若直接 concat，后半段仍携带原始 PTS，
        # 会在输出中形成异常静音，甚至被视频时长截掉。两段都先归零再拼接。
        return ("[%s]asplit=2[cax][cay];"
                "[cax]atrim=0:%.3f,asetpts=PTS-STARTPTS[cap];"
                "[cay]atrim=start=%.3f,asetpts=PTS-STARTPTS[caq];"
                "[cap][caq]concat=n=2:v=0:a=1[cac];" % (src, ts, te))

    if not audio_enabled:
        # 首次编码已经是无音轨 faststart MP4，直接原子换名，避免再启动一次 FFmpeg 无损复制。
        try:
            os.replace(tmpv, tmpout)
        except OSError:
            for path in (tmpv, tmpout):
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise
    elif has_custom_audio:
        if audio_mode == "mix":
            # 两路先 aformat 统一采样率/声道再 amix——TTS 配音常见 22050Hz mono，
            # H3 原声是 32000Hz stereo，格式不一致 amix 直接报错（实测踩坑）。
            fc = ((_cut_pre("2:a") if mid_cut else "") +
                  "[1:a]aformat=sample_rates=%d:channel_layouts=stereo,volume=0.6[a1];"
                  "[%s]aformat=sample_rates=%d:channel_layouts=stereo,volume=%.2f,adelay=%d|%d[a2];"
                  # 禁用 amix 默认的整体 /2 归一化，否则“原声 60% + 自定义音量”
                  # 实际会再次减半，听感明显偏小。后面的 alimiter 会安全处理叠加峰值。
                  "[a1][a2]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[amx];"
                  % (audio_rate, "cac" if mid_cut else "2:a", audio_rate,
                     float(audio_vol), delay_ms, delay_ms)
                  + stable_audio_filter("amx", "aout", dur, audio_rate))
            _run_video_cmd([ffmpeg, "-y", "-i", tmpv,
                            "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-"] + ca_in + [
                            "-filter_complex", fc,
                            "-map", "0:v", "-map", "[aout]",
                            "-c:v", "copy", "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp", "-b:a", "192k",
                            "-ar", str(audio_rate), "-ac", "2",
                            "-movflags", "+faststart",
                            "-t", "%.3f" % dur, tmpout],
                           input=audio_bytes)
        else:
            # replace：自定义音频直接顶替 H3 原声。
            # 输出统一 -ar/-ac 2：否则本段 22050Hz mono、其他段 32000Hz stereo，
            # concat 无损合并时各段音轨参数不一致会出问题。
            fc = ((_cut_pre("1:a") if mid_cut else "") +
                  "[%s]aformat=sample_rates=%d:channel_layouts=stereo,adelay=%d|%d[apre];"
                  % ("cac" if mid_cut else "1:a", audio_rate, delay_ms, delay_ms)
                  + stable_audio_filter("apre", "aout", dur, audio_rate))
            _run_video_cmd([ffmpeg, "-y", "-i", tmpv] + ca_in + [
                            "-filter_complex", fc,
                            "-map", "0:v", "-map", "[aout]",
                            "-c:v", "copy", "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp", "-b:a", "192k",
                            "-ar", str(audio_rate), "-ac", "2",
                            "-movflags", "+faststart",
                            "-t", "%.3f" % dur, tmpout])
    else:
        if amb_audio and os.path.exists(amb_audio):
            # 环境音垫层（v1.8+）：模型音轨不动，环境音文件 -stream_loop 循环铺满整段、
            # 低音量垫在底下。H3 参考音频条件会压制模型自生成环境音（实测提示词无效），
            # 这是确定性的兜底方案。amix normalize=0 保持人声 1:1，alimiter 防叠加削波。
            fc = ("[1:a]aformat=sample_rates=%d:channel_layouts=stereo[a1];"
                  "[2:a]aformat=sample_rates=%d:channel_layouts=stereo,volume=%.2f[a2];"
                  "[a1][a2]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amx];"
                  % (audio_rate, audio_rate, float(amb_vol))
                  + stable_audio_filter("amx", "aout", dur, audio_rate))
            _run_video_cmd([ffmpeg, "-y", "-i", tmpv,
                            "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
                            "-stream_loop", "-1", "-i", amb_audio,
                            "-filter_complex", fc,
                            "-map", "0:v", "-map", "[aout]",
                            "-c:v", "copy", "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp", "-b:a", "192k",
                            "-ar", str(audio_rate), "-ac", "2",
                            "-movflags", "+faststart", "-t", "%.3f" % dur, tmpout],
                           input=audio_bytes)
        else:
            fc = stable_audio_filter("1:a", "aout", dur, audio_rate)
            _run_video_cmd([ffmpeg, "-y", "-i", tmpv,
                            "-f", "f32le", "-ar", str(sr), "-ac", str(ch), "-i", "-",
                            "-filter_complex", fc,
                            "-map", "0:v", "-map", "[aout]",
                            "-c:v", "copy", "-c:a", "aac", "-profile:a", "aac_low", "-sample_fmt", "fltp", "-b:a", "192k",
                            "-ar", str(audio_rate), "-ac", "2",
                            "-movflags", "+faststart", "-t", "%.3f" % dur, tmpout],
                           input=audio_bytes)

    try:
        os.remove(tmpv)
    except OSError:
        pass

    _version, out, tail_path, reservation = _reserve_next_segment_video(
        seg, mode, project_id, version_label=version_label)
    try:
        os.replace(tmpout, out)
    finally:
        try:
            os.remove(reservation)
        except OSError:
            pass
    tail_frame, tail_info = select_clean_tail_frame(frames_u8)
    if tail_frame is None:
        # 绝不能让同一项目中上一轮遗留的尾帧冒充本轮结果，否则下一段会续接到错误画面。
        try:
            os.remove(tail_path)
        except OSError:
            pass
        _log("[H3导演台] 警告：段%d最后%d帧均异常，未生成续接尾帧。%s" % (
            seg, int(tail_info.get("checked") or 0), _tail_rejection_summary(tail_info)))
    else:
        write_tail_frame_if_changed(tail_path, tail_frame)
        fallback = int(tail_info.get("fallback_frames") or 0)
        if fallback:
            _log("[H3导演台] 段%d末帧检测到异常，尾帧已自动回退 %d 帧（第%d/%d帧）。%s" % (
                seg, fallback, int(tail_info.get("selected_index", 0)) + 1,
                int(tail_info.get("total_frames") or len(frames_u8)),
                _tail_rejection_summary(tail_info)))
    return out


def _fit_frame(frame, target_size):
    if not target_size:
        return frame
    tw, th = target_size
    h, w = frame.shape[:2]
    if (w, h) == (tw, th):
        return frame
    scale = min(tw / float(w), th / float(h))
    rw, rh = max(1, round(w * scale)), max(1, round(h * scale))
    import cv2
    resized = cv2.resize(frame, (rw, rh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    canvas = np.zeros((th, tw, 3), dtype=np.uint8)
    x, y = (tw - rw) // 2, (th - rh) // 2
    canvas[y:y + rh, x:x + rw] = resized
    return canvas


def _read_segment_video(seg, mode="create", project_id="default", target_size=None, target_fps=FPS):
    """从 mp4 还原 frames float tensor + audio dict（用于缓存段的输出重建）。"""
    import cv2
    import imageio_ffmpeg
    import wave as wave_mod
    import io
    path = _seg_video(seg, mode, project_id)
    cap = cv2.VideoCapture(path)
    source_fps = float(cap.get(cv2.CAP_PROP_FPS) or target_fps)
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(_fit_frame(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), target_size))
    cap.release()
    if not frames:
        raise RuntimeError("[H3导演台] 无法读取缓存段视频: " + path)
    source_count = len(frames)
    arr = np.stack(frames)
    if abs(source_fps - target_fps) > 0.01:
        target_count = max(1, round(source_count * target_fps / source_fps))
        indices = np.minimum((np.arange(target_count) * source_fps / target_fps).astype(np.int64), source_count - 1)
        arr = arr[indices]
    arr = arr.astype(np.float32) / 255.0

    # 读音频同样绕开 torchaudio：ffmpeg 把音轨转成 16bit PCM wav 输出到 stdout，
    # 用标准库 wave 解析（采样率/声道数自动从 wav 头读，无需任何第三方依赖）。
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    # 先探测有无音轨：音频开关关闭的段（-an 生成）没有音轨，直接跑 -vn 提音频会
    # 报 "Output file does not contain any stream"。此时造等长静音保持输出结构一致。
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", path],
                           capture_output=True)
    if "Audio:" in (probe.stderr or b"").decode("utf-8", "ignore"):
        r = _run([ffmpeg, "-y", "-i", path, "-vn", "-acodec", "pcm_s16le", "-f", "wav", "-"])
        with wave_mod.open(io.BytesIO(r.stdout)) as wf:
            sr = wf.getframerate()
            ch = wf.getnchannels()
            raw = wf.readframes(wf.getnframes())
        a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        a = a.reshape(-1, ch).T.copy()  # 逐帧交错 [L*C] -> [C,L]
    else:
        sr, ch = 32000, 2
        n_silent = max(1, int(round(source_count / source_fps * sr)))
        a = np.zeros((ch, n_silent), dtype=np.float32)
    return torch.from_numpy(arr), {"waveform": torch.from_numpy(a)[None,], "sample_rate": sr}


def _read_segment_preview(seg, mode="create", project_id="default", target_size=None):
    import cv2
    path = _seg_video(seg, mode, project_id)
    cap = cv2.VideoCapture(path)
    source_fps = float(cap.get(cv2.CAP_PROP_FPS) or FPS)
    source_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    tail = _seg_tail(seg, mode, project_id)
    if not os.path.exists(tail):
        raise RuntimeError("[H3导演台] 找不到段%d尾帧: %s" % (seg, tail))
    frame = np.asarray(Image.open(tail).convert("RGB"))
    frame = _fit_frame(frame, target_size)
    total_frames = max(1, round(source_count * FPS / source_fps))
    return torch.from_numpy(frame.astype(np.float32) / 255.0)[None,], total_frames

__all__ = ['os', 'gc', 'sys', 're', 'json', 'glob', 'hashlib', 'math', 'subprocess', 'tempfile', 'threading', 'time', 'np', 'torch', 'Image', 'folder_paths', 'nodes', 'comfy', 'latent_preview', 'GraphBuilder', 'get_executing_context', 'Noise_EmptyNoise', 'Noise_RandomNoise', 'Guider_Basic', 'LTXVConcatAVLatent', 'LTXVSeparateAVLatent', 'MiniMaxH3ReferenceToVideo', 'MiniMaxH3ImageToVideo', 'vae_decode_audio', 'PromptServer', 'MERGE_AUDIO_RATE', 'enforce_continuity_start', 'extract_clean_tail_frame', 'lossless_tail_is_current', 'select_clean_tail_frame', 'stable_audio_filter', 'write_tail_frame_if_changed', 'CATEGORY', 'OUTPUT_DIR', 'INPUT_DIR', 'VIDEO_DIR', 'PROJECT_ROOT', 'FPS', 'CACHE_SCHEMA', 'CHECKPOINT_SCHEMA', 'DEFAULT_REPAIR_PROMPT', 'SECOND_SAMPLE_PRESETS', 'SECOND_SAMPLE_PRESET_VERSION', 'SECOND_SAMPLE_TILE_MIN_AXIS', 'SECOND_SAMPLE_TILE_OVERLAP', 'SECOND_SAMPLE_COMMON_NODE_IDS', 'SECOND_SAMPLE_STAGES', '_SecondSampleFallbackError', '_log', '_validate_second_sample_model_name', '_normalize_second_sample_config', '_second_sample_target_size', '_second_sample_first_pass_size', '_second_sample_model_name', '_second_sample_upscaler_memory_required', '_second_sample_upscale_runtime', '_second_sample_nodes', '_second_sample_resource_handoff', '_second_sample_tile_disabled_reason', '_second_sample_tile_plan', '_second_sample_tile_conditioning', '_second_sample_tile_window', '_node_result', '_second_sample_upscale_video', '_second_sample_release_upscaler_cache', '_AT_REF_PATTERNS', '_AT_AUDIO_REF_PATTERNS', '_convert_at_refs', '_GENERATED_ASSET_BINDING_HEADER_RE', '_GENERATED_ASSET_IDENTITY_RE', '_PICTURE_REF_RE', '_SUBJECT_REF_RE', '_MALFORMED_REFERENCE_CLOSE_RE', '_count_condition_image_reference_blocks', '_normalize_prompt_picture_references', '_OFFICIAL_FIELD_NAMES', '_OFFICIAL_FIELD_RE', '_split_official_prompt_fields', '_strip_generated_asset_binding', '_render_official_ref2va', '_ensure_official_ref2va_prompt', '_merge_official_ref2va_entries', '_CONTINUITY_DIRECTIVE', '_CROSS_STYLE_CONTINUITY_DIRECTIVE', '_SOFT_TAIL_QUALITY_DIRECTIVE', '_SEGMENT_SCOPE_DIRECTIVE', '_GLOBAL_IDENTITY_ANCHOR_RE', '_GLOBAL_SCOPE_RE', '_sanitize_global_prompt', '_build_continuity_directive', '_inject_ref2va_tail_reference', '_localize_segment_soundscape', '_prompt_style_profile', '_active_prompt_style_profile', '_visual_shot_bodies', '_endpoint_render_style', '_detect_tail_render_boundaries', '_hard_global_conflict', '_compose_segment_prompt', '_global_prompt_for_mode', '_is_same_image', '_latest', '_SEG_NAME', '_TAIL_NAME', '_SEG_PREFIX', '_TAIL_PREFIX', '_safe_project_id', '_project_dir', '_video_ui_entry', '_result_with_video_ui', '_DEEP_RELEASE_REQUESTS', '_DEEP_RELEASE_LOCK', 'request_deep_release', '_consume_deep_release_request', '_memory_snapshot', '_format_memory_snapshot', '_loaded_model_count', '_second_sample_runtime_snapshot', '_second_sample_event_identity', '_second_sample_stage_payload', '_emit_second_sample_stage', '_second_sample_failure', '_second_sample_finally_cleanup', '_cleanup_runtime_resources', '_segment_boundary_cleanup', '_cleanup_project_temp_files', '_seg_meta', '_segment_version_path', '_segment_file_version', '_read_segment_metadata', '_recorded_segment_path', '_latest_segment_version_path', '_find_segment_version_path', '_active_segment_path', '_seg_video', '_seg_tail', '_matching_segment_tail', '_reserve_next_segment_video', '_tail_rejection_summary', '_refresh_segment_tail', '_resolve_input', '_input_signature', '_segment_first_frame_mode', '_segment_keyframe_names', '_path_signature', '_atomic_write_json', '_integer_segment_duration', '_segment_frame_count', '_expected_segment_duration', '_probe_segment_video', '_validate_segment_artifacts', '_signature_matches', '_validate_segment_checkpoint', '_complete_segment_metadata', '_record_second_sample_fallback', '_second_sample_metadata', '_upstream_fingerprint', '_upstream_link', '_upstream_model_kind', '_source_contract_views', '_H3GenerationNotice', '_normalize_source_aspect', '_validate_source_aspect_contract', '_parse_contract_number', '_extract_authoritative_duration_contract', '_duration_contract_scope_metadata', '_group_authoritative_duration_contracts', '_validate_authoritative_duration_contract', '_select_h3_task', '_segment_has_reference_material', 'VIDEO_REFERENCE_MODES', '_video_reference_mode', 'REF_AUDIO_SR', '_load_audio_for_ref', '_load_video_for_ref', '_load_input_image', '_config_hash', '_run', '_run_rawvideo_stream', '_sanitize_model_audio', '_write_segment_video', '_fit_frame', '_read_segment_video', '_read_segment_preview']
