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
