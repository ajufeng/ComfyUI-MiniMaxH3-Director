export const H3_SECOND_SAMPLE_MODES = Object.freeze([
  { id: "off", label: "关闭" },
  { id: "light", label: "轻度修复" },
  { id: "standard", label: "标准修复" },
  { id: "strong", label: "强力修复" },
  { id: "custom", label: "自定义" },
]);

const PRESETS = Object.freeze({
  light: Object.freeze({ steps: 5, denoise: 0.15 }),
  standard: Object.freeze({ steps: 7, denoise: 0.22 }),
  strong: Object.freeze({ steps: 9, denoise: 0.30 }),
});

export const H3_SECOND_SAMPLE_DEFAULT_REPAIR_PROMPT =
  "修复一采中的结构畸形、重影、重复或缺失部件、破损边缘、纹理断裂和闪烁；严格保持原剧情时序、运镜、构图、主体身份、服装、动作、场景、画面风格和正常区域不变。";

export const H3_SECOND_SAMPLE_SIZE_MODES = Object.freeze([
  { id: "megapixels", label: "按百万像素" },
  { id: "dimensions", label: "按最终宽高（手动分辨率）" },
]);

export const H3_SECOND_SAMPLE_LAYOUTS = Object.freeze([
  { id: "tiled", label: "优先分块（2块，省显存，推荐）" },
  { id: "full", label: "整幅一次采样（高显存）" },
]);

export const H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES = Object.freeze([
  { id: "domestic", label: "国内线路（联网）" },
  { id: "official", label: "官方线路（联网）" },
  { id: "local", label: "本地离线环境包（不含权重）" },
]);

export const H3_SECOND_SAMPLE_WEIGHT_SOURCES = Object.freeze([
  { id: "domestic", label: "国内线路（推荐）" },
  { id: "official", label: "官方线路" },
]);

export const H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS = 1.0;
export const H3_SECOND_SAMPLE_SAFE_TARGET_MEGAPIXELS = 2.0;

export const H3_SECOND_SAMPLE_RUNTIME_STAGES = Object.freeze([
  Object.freeze({ id: "first_release", index: 1, label: "释放一采运行资源" }),
  Object.freeze({ id: "latent_upscale", index: 2, label: "3D latent 放大" }),
  Object.freeze({ id: "upscale_release", index: 3, label: "释放放大临时资源" }),
  Object.freeze({ id: "h3_reload_or_prepare", index: 4, label: "准备 H3 二采模型" }),
  Object.freeze({ id: "second_sampling", index: 5, label: "H3 二次采样" }),
  Object.freeze({ id: "audio_restore", index: 6, label: "恢复一采音频" }),
]);

export function h3SecondSampleSizeInputState(sizeMode, enabled = true) {
  const targetSizeMode = sizeMode === "dimensions" ? "dimensions" : "megapixels";
  return {
    target_size_mode: targetSizeMode,
    disabled: enabled !== true,
    megapixels_read_only: false,
    dimensions_read_only: false,
  };
}

const environmentSourceIds = new Set(H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES.map((item) => item.id));
const weightSourceIds = new Set(H3_SECOND_SAMPLE_WEIGHT_SOURCES.map((item) => item.id));

export function normalizeH3SecondSampleSetupSelection(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    environment_source: environmentSourceIds.has(source.environment_source)
      ? source.environment_source : "official",
    weight_source: weightSourceIds.has(source.weight_source) ? source.weight_source : "domestic",
    weight_id: typeof source.weight_id === "string" ? source.weight_id.trim() : "",
  };
}

export function h3SecondSampleAvailableEnvironmentSelection(status, selectedSource) {
  const sources = Array.isArray(status && status.environment_sources)
    ? status.environment_sources.filter((item) => item && item.available === true) : [];
  const selected = sources.some((item) => item.id === selectedSource)
    ? selectedSource : (sources.find((item) => item.id === "local") || sources[0])?.id || "";
  return { sources, environment_source: selected };
}

export function h3SecondSampleUpscalerModelName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  const lower = name.toLowerCase();
  return name && !name.includes("\0") && !name.includes("/") && !name.includes("\\")
      && !/^[A-Za-z]:/.test(name) && lower.includes("3d") && lower.includes("fp16")
      && !lower.includes("fp32") && !lower.includes("bf16")
      && /\.(?:pth|safetensors)$/i.test(name) ? name : "";
}

function h3SecondSampleSourceCatalog(payload, field, definitions) {
  const raw = payload && payload[field];
  const entries = Array.isArray(raw) ? raw
    : raw && typeof raw === "object" ? Object.entries(raw).map(([id, value]) =>
      value && typeof value === "object" ? { id, ...value } : { id, available: value === true }) : [];
  const byId = new Map(entries.map((item) => [String(item && item.id || ""), item]));
  return definitions.map((definition) => {
    const item = byId.get(definition.id);
    const available = item && item.available === true;
    return {
      id: definition.id,
      label: String(item && item.label || definition.label),
      online: item ? item.online === true : definition.id !== "local",
      available,
      requires_package: item && item.requires_package === true,
      reason: available ? String(item && item.reason || "")
        : String(item && item.reason || "缺少来源证据"),
    };
  });
}

export function normalizeH3SecondSampleSetupStatus(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const weights = Array.isArray(source.weights) ? source.weights.map((item) => {
    const id = String(item && item.id || "").trim();
    const filename = h3SecondSampleUpscalerModelName(item && (item.filename || item.model_name));
    const name = String(item && item.name || "").trim();
    const precision = String(item && item.precision || "").trim().toLowerCase();
    const size = Number(item && item.size);
    const sha256 = String(item && item.sha256 || "").trim().toLowerCase();
    const xetHash = String(item && item.xet_hash || "").trim().toLowerCase();
    const license = String(item && item.license || "").trim();
    const nodeCompatibility = Array.isArray(item && item.node_compatibility)
      ? item.node_compatibility.map(String).filter(Boolean) : [];
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || !filename || !name || precision !== "fp16"
        || !Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(sha256)
        || !license || !nodeCompatibility.includes("MinimaxH3LatentUpscaler3D")) return null;
    const sources = Array.isArray(item.sources) ? item.sources.map((entry) => {
      const sourceId = String(entry && entry.id || "");
      if (!weightSourceIds.has(sourceId)) return null;
      return {
        id: sourceId,
        available: entry.available === true,
        reason: String(entry.reason || ""),
      };
    }).filter(Boolean) : [];
    return {
      id,
      filename,
      name,
      precision,
      size,
      sha256,
      xet_hash: /^[a-f0-9]{64}$/.test(xetHash) ? xetHash : "",
      license,
      node_compatibility: nodeCompatibility,
      sources,
    };
  }).filter(Boolean) : [];
  const rawInstalled = source.installed && Array.isArray(source.installed.upscaler_models)
    ? source.installed.upscaler_models : [];
  const installed = [...new Set(rawInstalled.map(h3SecondSampleUpscalerModelName).filter(Boolean))];
  const selectionContract = source.installed && source.installed.upscaler_model_selection;
  const installedSelection = selectionContract
    && selectionContract.field === "upscaler_model"
    && selectionContract.id_type === "basename"
    && selectionContract.requires_setup === false
    ? { field: "upscaler_model", id_type: "basename", requires_setup: false } : null;
  const localContract = source.local_package_contract;
  const accepts = Array.isArray(localContract && localContract.accepts)
    ? localContract.accepts.filter((item) => item === "zip") : [];
  const localMaxSize = Number(localContract && localContract.max_size);
  const normalizedLocalContract = localContract && localContract.schema === 2
    && typeof localContract.manifest_name === "string" && localContract.manifest_name
    && typeof localContract.package_id === "string" && localContract.package_id
    && typeof localContract.package_version === "string" && localContract.package_version
    && accepts.length === 1 && localContract.contains_weights === false
    && localContract.contains_latent_upscaler_node === true
    && localContract.contains_python_wheels === true
    && localContract.weight_delivery === "director_online_catalog"
    && Number.isSafeInteger(localMaxSize) && localMaxSize > 0 ? {
      schema: 2,
      manifest_name: localContract.manifest_name,
      package_id: localContract.package_id,
      package_version: localContract.package_version,
      accepts,
      max_size: localMaxSize,
      contains_weights: false,
      contains_latent_upscaler_node: true,
      contains_python_wheels: true,
      weight_delivery: "director_online_catalog",
      target_runtime: String(localContract.target_runtime || ""),
    } : null;
  const rawStages = source.setup_stages && typeof source.setup_stages === "object"
    && !Array.isArray(source.setup_stages) ? source.setup_stages : {};
  const setupStages = {};
  for (const stage of ["environment", "weight"]) {
    const value = rawStages[stage] && typeof rawStages[stage] === "object"
      ? rawStages[stage] : {};
    const status = ["pending", "running", "completed", "failed"].includes(value.status)
      ? value.status : "pending";
    setupStages[stage] = {
      status,
      error: status === "failed" ? String(value.error || "请重试") : "",
    };
  }
  return {
    environment_sources: h3SecondSampleSourceCatalog(
      source, "environment_sources", H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES),
    weight_sources: h3SecondSampleSourceCatalog(
      source, "weight_sources", H3_SECOND_SAMPLE_WEIGHT_SOURCES),
    weights,
    installed: installedSelection ? installed : [],
    installed_selection: installedSelection,
    local_package_contract: normalizedLocalContract,
    setup_stages: setupStages,
    selection: normalizeH3SecondSampleSetupSelection(source.selection),
  };
}

export function h3SecondSampleManualRequirements(payload) {
  return Array.isArray(payload && payload.manual_requirements)
    ? payload.manual_requirements.map((item) => typeof item === "string" ? item
      : String(item && (item.label || item.name || item.reason) || "")).filter(Boolean) : [];
}

function h3SecondSampleSetupItems(payload) {
  return Array.isArray(payload && payload.items) ? payload.items
    : payload && payload.items && typeof payload.items === "object"
      ? Object.values(payload.items) : [];
}

function h3SecondSampleSetupItemReady(item) {
  return item === true
    || ["ready", "installed", "complete", "completed"].includes(String(item).toLowerCase())
    || item && item.ready === true
    || ["ready", "installed", "complete", "completed"].includes(
      String(item && (item.state || item.status) || "").toLowerCase());
}

function h3SecondSampleAutomaticPending(payload) {
  const hasSourceContract = Array.isArray(payload && payload.environment_sources)
    && Array.isArray(payload && payload.weight_sources) && Array.isArray(payload && payload.weights);
  if (hasSourceContract) {
    const status = normalizeH3SecondSampleSetupStatus(payload);
    const availableEnvironment = status.environment_sources.some((entry) => entry.available);
    const availableWeightSource = new Set(status.weight_sources
      .filter((entry) => entry.available).map((entry) => entry.id));
    return availableEnvironment && status.weights.some((weight) =>
      weight.sources.some((entry) => entry.available && availableWeightSource.has(entry.id)));
  }
  if (payload && (payload.can_setup === true || payload.installable === true)) return true;
  if (h3SecondSampleSetupItems(payload).some((item) => item && item.installable !== false
    && !h3SecondSampleSetupItemReady(item))) return true;
  return false;
}

export function h3SecondSampleSetupPresentation(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const state = source.ready === true ? "ready" : String(source.state || "missing");
  const manual = h3SecondSampleManualRequirements(source);
  const automaticPending = h3SecondSampleAutomaticPending(source);
  const progress = source.progress || {};
  const progressText = `${Number(progress.current) || 0}/${Number(progress.total) || 0}`
    + (progress.item ? `：${progress.item}` : "");
  if (state === "ready") {
    return { state, button_text: "环境已配齐", button_disabled: true,
      message: "二采环境与所选3D权重已配齐。", busy: false };
  }
  if (state === "running") {
    return { state, button_text: `正在配齐 ${progressText}`, button_disabled: true,
      message: `正在配齐 ${progressText}`, busy: true };
  }
  if (state === "failed") {
    return { state, button_text: "重试配齐", button_disabled: false,
      message: "配齐失败：" + String(source.error || "请重试")
        + (manual.length ? `；以下项目需手动安装：${manual.join("；")}` : ""), busy: false };
  }
  if (source.restart_required && !automaticPending) {
    return { state, button_text: "等待重启", button_disabled: true,
      message: "自动项已配齐；需要完全重启 ComfyUI"
        + (manual.length ? `；以下项目需手动安装：${manual.join("；")}` : ""), busy: false };
  }
  if (manual.length && !automaticPending) {
    return { state, button_text: "仍缺手动组件", button_disabled: true,
      message: `自动项已配齐；以下项目需手动安装：${manual.join("；")}`, busy: false };
  }
  if (!automaticPending) {
    return { state, button_text: "暂无可配齐来源", button_disabled: true,
      message: "尚无同时具备来源、版本、大小、SHA-256、许可证与节点兼容性证据的在线3D权重。",
      busy: false };
  }
  return { state, button_text: "开始一键配齐", button_disabled: false,
    message: "二采环境或所选3D权重未就绪；请检查环境来源、权重线路和明确权重选择"
      + (manual.length ? `；以下项目需手动安装：${manual.join("；")}` : "")
      + (source.restart_required ? "；自动项生效前需要完全重启 ComfyUI" : ""), busy: false };
}

const modeIds = new Set(H3_SECOND_SAMPLE_MODES.map((item) => item.id));

function h3PositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function h3SecondSampleSizeModeTransition(sizeMode, displayedWidth, displayedHeight,
    displayedMegapixels) {
  const targetSizeMode = sizeMode === "dimensions" ? "dimensions" : "megapixels";
  const width = Number(displayedWidth);
  const height = Number(displayedHeight);
  if (targetSizeMode === "dimensions") {
    return {
      target_size_mode: "dimensions",
      final_width: h3PositiveNumber(width, 832),
      final_height: h3PositiveNumber(height, 480),
    };
  }
  return {
    target_size_mode: "megapixels",
    target_megapixels: Number.isFinite(width) && width > 0
        && Number.isFinite(height) && height > 0
      ? width * height / 1_000_000
      : h3PositiveNumber(displayedMegapixels, H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS),
  };
}

function h3Align32(value, minimum = 32) {
  return Math.max(minimum, Math.round(h3PositiveNumber(value, minimum) / 32) * 32);
}

function h3SecondSampleLegacyDimensions(source, segment) {
  if (source.target_size_mode != null || source.final_width != null || source.final_height != null
      || Number(source.preset_version) >= 4) return null;
  const width = Number(segment && segment.width);
  const height = Number(segment && segment.height);
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? { width, height } : null;
}

export function normalizeH3SecondSample(value, legacySegment = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const legacyMode = source.mode === "conservative" ? "light"
    : source.mode === "balanced" ? "standard" : source.mode;
  const mode = modeIds.has(legacyMode) ? legacyMode : "off";
  if (mode === "off") return { mode: "off" };
  const custom = mode === "custom";
  const preset = PRESETS[mode];
  const firstMegapixels = Math.min(4.0, Math.max(0.1,
    Number(source.first_megapixels) || 0.4));
  const repairPrompt = typeof source.repair_prompt === "string"
    ? source.repair_prompt.trim().slice(0, 4000) : "";
  const sourcePresetVersion = Number(source.preset_version);
  const presetVersion = source.preset_version == null ? 3
    : Number.isFinite(sourcePresetVersion) && sourcePresetVersion <= 3
      ? Math.max(0, Math.round(sourcePresetVersion)) : 4;
  const upscalerModel = h3SecondSampleUpscalerModelName(source.upscaler_model);
  const legacyDimensions = h3SecondSampleLegacyDimensions(source, legacySegment);
  const sourceWidth = Number(source.final_width);
  const sourceHeight = Number(source.final_height);
  const hasDimensions = Number.isFinite(sourceWidth) && sourceWidth > 0
    && Number.isFinite(sourceHeight) && sourceHeight > 0;
  const sizeMode = source.target_size_mode === "dimensions"
    || (source.target_size_mode !== "megapixels" && (hasDimensions || legacyDimensions))
    ? "dimensions" : "megapixels";
  const normalized = {
    mode,
    strategy: "latent_repair",
    preset_version: presetVersion,
    first_megapixels: firstMegapixels,
    steps: custom
      ? Math.min(30, Math.max(1, Math.round(Number(source.steps) || 4)))
      : preset.steps,
    denoise: custom
      ? Math.min(0.95, Math.max(0.01, Number(source.denoise) || 0.15))
      : preset.denoise,
    repair_prompt: repairPrompt || H3_SECOND_SAMPLE_DEFAULT_REPAIR_PROMPT,
    sampling_layout: source.sampling_layout === "full" ? "full" : "tiled",
    freeze_audio: true,
    save_comparison: source.save_comparison !== false,
  };
  if (upscalerModel) normalized.upscaler_model = upscalerModel;
  if (sizeMode === "dimensions") {
    normalized.target_size_mode = "dimensions";
    normalized.final_width = hasDimensions ? sourceWidth : legacyDimensions.width;
    normalized.final_height = hasDimensions ? sourceHeight : legacyDimensions.height;
  } else {
    normalized.target_size_mode = "megapixels";
    normalized.target_megapixels = h3PositiveNumber(
      source.target_megapixels, H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS);
  }
  return normalized;
}

export function h3SecondSampleUpscalerModelError(value) {
  const config = normalizeH3SecondSample(value);
  if (config.mode === "off" || config.preset_version <= 3 || config.upscaler_model) return "";
  return "二采必须明确选择一个已安装或已核验的3D权重；不会按目录排序自动选第一个。";
}

export function h3SecondSampleSizeForMegapixels(width, height, targetMegapixels = 1.0) {
  const sourceWidth = h3PositiveNumber(width, 832);
  const sourceHeight = h3PositiveNumber(height, 480);
  const targetPixels = h3PositiveNumber(
    targetMegapixels, H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS) * 1_000_000;
  const ratio = sourceWidth / sourceHeight;
  return {
    width: h3Align32(Math.sqrt(targetPixels * ratio)),
    height: h3Align32(Math.sqrt(targetPixels / ratio)),
  };
}

export function h3SecondSampleFinalSize(value, aspectWidth, aspectHeight) {
  const config = normalizeH3SecondSample(value);
  const size = config.target_size_mode === "dimensions"
    ? { width: config.final_width, height: config.final_height }
    : h3SecondSampleSizeForMegapixels(
        aspectWidth, aspectHeight, config.target_megapixels);
  return {
    ...size,
    megapixels: size.width * size.height / 1_000_000,
    target_megapixels: config.target_size_mode === "megapixels"
      ? config.target_megapixels : null,
  };
}

export function h3SecondSampleExecutionConfig(value, aspectWidth, aspectHeight) {
  const config = normalizeH3SecondSample(value);
  if (config.mode === "off") return config;
  const final = h3SecondSampleFinalSize(config, aspectWidth, aspectHeight);
  return { ...config, final_width: final.width, final_height: final.height };
}

export function h3SecondSampleSizeStatus(value, aspectWidth, aspectHeight) {
  const config = normalizeH3SecondSample(value);
  if (config.mode === "off") return { error: "", warning: "", first: null, final: null };
  const final = h3SecondSampleFinalSize(config, aspectWidth, aspectHeight);
  const first = h3SecondSampleFirstPassSize(
    final.width, final.height, config.first_megapixels);
  const aligned = Number.isInteger(final.width) && Number.isInteger(final.height)
    && final.width >= 32 && final.height >= 32
    && final.width % 32 === 0 && final.height % 32 === 0;
  const larger = final.width > first.width && final.height > first.height
    && final.width * final.height > first.width * first.height;
  const error = !aligned
    ? `二采最终宽高 ${final.width}×${final.height} 必须是32的倍数；请重新输入。`
    : larger ? ""
      : `二采实际尺寸 ${final.width}×${final.height} 的宽、高和面积必须都大于一采 ${first.width}×${first.height}；请提高二采 MP 或最终宽高。`;
  const warning = !error && final.megapixels > H3_SECOND_SAMPLE_SAFE_TARGET_MEGAPIXELS
    ? `二采实际 ${final.megapixels.toFixed(3)}MP 可能显著增加显存；不会自动降低分辨率。`
    : "";
  return { error, warning, first, final };
}

export function h3SecondSampleLongRunWarning(value, aspectWidth, aspectHeight, durationSeconds) {
  const config = normalizeH3SecondSample(value);
  const duration = Number(durationSeconds);
  if (config.mode === "off" || !Number.isFinite(duration) || duration < 12) return "";
  const status = h3SecondSampleSizeStatus(config, aspectWidth, aspectHeight);
  if (status.error || !status.final || status.final.megapixels < 2) return "";
  return `${duration.toFixed(duration % 1 ? 1 : 0)}秒 × ${status.final.megapixels.toFixed(3)}MP`
    + " 属于长时长高时空规模，16GB级显卡仍可能OOM；先保留5秒基线验证，"
    + "不会自动改变帧数、尺寸或采样参数。";
}

const h3SecondSampleRuntimeStageById = new Map(
  H3_SECOND_SAMPLE_RUNTIME_STAGES.map((stage) => [stage.id, stage]));
const h3SecondSampleRuntimeStatuses = new Set(["running", "completed", "failed"]);

function h3NullableNonNegativeInteger(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function h3NullableNonNegativeNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function h3NullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

export function normalizeH3SecondSampleRuntimeStage(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  if (source.schema !== 1) return null;
  const promptId = String(source.prompt_id || "").trim();
  const node = String(source.node || "").trim();
  const displayNode = String(source.display_node || "").trim();
  const projectId = String(source.project_id || "").trim();
  const segmentIndex = Number(source.segment_index);
  const stage = h3SecondSampleRuntimeStageById.get(String(source.stage || ""));
  const runtimeStatus = String(source.status || "");
  if (!promptId || !node || !displayNode || !projectId
      || !Number.isSafeInteger(segmentIndex) || segmentIndex < 1 || !stage
      || Number(source.stage_index) !== stage.index
      || Number(source.stage_total) !== H3_SECOND_SAMPLE_RUNTIME_STAGES.length
      || String(source.label || "") !== stage.label
      || !h3SecondSampleRuntimeStatuses.has(runtimeStatus)) return null;
  const stepCurrent = h3NullableNonNegativeInteger(source.step_current);
  const stepTotal = h3NullableNonNegativeInteger(source.step_total);
  if (stage.id === "second_sampling") {
    if (stepCurrent == null || stepTotal == null || stepTotal < 1 || stepCurrent > stepTotal) return null;
  } else if (source.step_current != null || source.step_total != null) {
    return null;
  }
  const rawFailure = source.failure;
  let failure = null;
  if (runtimeStatus === "failed") {
    if (!rawFailure || typeof rawFailure !== "object" || Array.isArray(rawFailure)
        || typeof rawFailure.oom !== "boolean"
        || typeof rawFailure.first_pass_preserved !== "boolean"
        || rawFailure.second_pass_completed !== false
        || rawFailure.second_pass_cache_written !== false
        || typeof rawFailure.runtime_released !== "boolean") return null;
    failure = {
      oom: rawFailure.oom,
      first_pass_preserved: rawFailure.first_pass_preserved,
      second_pass_completed: false,
      second_pass_cache_written: false,
      runtime_released: rawFailure.runtime_released,
      exception_type: String(rawFailure.exception_type || "").trim(),
      exception_message: String(rawFailure.exception_message || "").trim(),
    };
  } else if (rawFailure != null) {
    return null;
  }
  const rawMemory = source.memory && typeof source.memory === "object" ? source.memory : {};
  return {
    schema: 1,
    prompt_id: promptId,
    node,
    display_node: displayNode,
    project_id: projectId,
    segment_index: segmentIndex,
    stage: stage.id,
    stage_index: stage.index,
    stage_total: H3_SECOND_SAMPLE_RUNTIME_STAGES.length,
    label: stage.label,
    status: runtimeStatus,
    elapsed_seconds: h3NullableNonNegativeNumber(source.elapsed_seconds),
    resident_models: h3NullableNonNegativeInteger(source.resident_models),
    memory: {
      allocated_bytes: h3NullableNonNegativeInteger(rawMemory.allocated_bytes),
      reserved_bytes: h3NullableNonNegativeInteger(rawMemory.reserved_bytes),
      free_bytes: h3NullableNonNegativeInteger(rawMemory.free_bytes),
    },
    step_current: stage.id === "second_sampling" ? stepCurrent : null,
    step_total: stage.id === "second_sampling" ? stepTotal : null,
    external_upscaler_cached: h3NullableBoolean(source.external_upscaler_cached),
    failure,
  };
}

export function h3SecondSampleRuntimePresentation(payload) {
  const stage = normalizeH3SecondSampleRuntimeStage(payload);
  if (!stage) return null;
  let stageProgress = stage.status === "completed" ? 1 : 0;
  if (stage.stage === "second_sampling" && stage.status !== "failed") {
    stageProgress = stage.step_total ? stage.step_current / stage.step_total : 0;
  }
  const progress = Math.min(100, Math.max(0,
    ((stage.stage_index - 1 + stageProgress) / stage.stage_total) * 100));
  const prefix = `段${stage.segment_index} · `;
  if (stage.failure) {
    const release = stage.failure.runtime_released ? "运行态已释放" : "运行态释放未确认";
    const first = stage.failure.first_pass_preserved ? "一采已保留" : "一采保留未确认";
    const cache = stage.external_upscaler_cached === true ? "；外部3D模型仍缓存"
      : stage.external_upscaler_cached === false ? "；外部3D CUDA模型已释放" : "";
    const message = stage.failure.oom
      ? `${prefix}显存不足：${first}；二采未完成；${release}${cache}`
      : `${prefix}二采未完成：${stage.failure.exception_message || stage.failure.exception_type || "后端执行失败"}`
        + `；${first}；${release}${cache}`;
    return { stage, progress, message, tone: "error" };
  }
  const step = stage.stage === "second_sampling"
    ? ` ${stage.step_current}/${stage.step_total}` : "";
  const cache = stage.stage === "upscale_release" && stage.status === "completed"
    ? stage.external_upscaler_cached === true ? "；外部3D模型仍缓存"
      : stage.external_upscaler_cached === false ? "；外部3D CUDA模型已释放" : ""
    : "";
  return {
    stage,
    progress,
    message: `${prefix}${stage.label}${step}${stage.status === "completed" ? "完成" : "…"}${cache}`,
    tone: "busy",
  };
}

export function h3SecondSampleFirstPassSize(width, height, firstMegapixels = 0.4) {
  const targetWidth = Math.max(32, Number(width) || 32);
  const targetHeight = Math.max(32, Number(height) || 32);
  const targetPixels = targetWidth * targetHeight;
  const budget = Math.min(4.0, Math.max(0.1,
    Number(firstMegapixels) || 0.4)) * 1_000_000;
  const scale = Math.min(1, Math.sqrt(budget / targetPixels));
  const alignedTargetWidth = Math.max(32, Math.floor(targetWidth / 32) * 32);
  const alignedTargetHeight = Math.max(32, Math.floor(targetHeight / 32) * 32);
  const firstWidth = Math.min(alignedTargetWidth,
    Math.max(32, Math.round(targetWidth * scale / 32) * 32));
  const firstHeight = Math.min(alignedTargetHeight,
    Math.max(32, Math.round(targetHeight * scale / 32) * 32));
  return {
    width: firstWidth,
    height: firstHeight,
    megapixels: firstWidth * firstHeight / 1_000_000,
  };
}

export function normalizeH3SegmentSecondSample(segment) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) return;
  const active = normalizeH3SecondSample(segment.second_sample, segment);
  if (active.mode !== "off") {
    segment.second_sample = active;
    delete segment.second_sample_restore;
    return;
  }
  delete segment.second_sample;
  const restore = normalizeH3SecondSample(segment.second_sample_restore, segment);
  if (restore.mode === "off") delete segment.second_sample_restore;
  else segment.second_sample_restore = restore;
}

export function setH3SegmentSecondSample(segment, value) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) return false;
  const next = normalizeH3SecondSample(value);
  if (next.mode !== "off") {
    segment.second_sample = next;
    delete segment.second_sample_restore;
    return true;
  }
  const active = normalizeH3SecondSample(segment.second_sample);
  if (active.mode !== "off") segment.second_sample_restore = active;
  delete segment.second_sample;
  return false;
}

export function applyH3SecondSampleDefault(segment, value) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)
      || Object.prototype.hasOwnProperty.call(segment, "second_sample")
      || Object.prototype.hasOwnProperty.call(segment, "second_sample_restore")) return false;
  const config = normalizeH3SecondSample(value);
  if (config.mode === "off") return false;
  segment.second_sample = { ...config };
  return true;
}

export function toggleH3SegmentSecondSample(segment) {
  if (!segment || typeof segment !== "object" || Array.isArray(segment)) return false;
  const active = normalizeH3SecondSample(segment.second_sample);
  if (active.mode !== "off") return setH3SegmentSecondSample(segment, { mode: "off" });
  const restore = normalizeH3SecondSample(segment.second_sample_restore);
  if (restore.mode === "off") return false;
  return setH3SegmentSecondSample(segment, restore);
}

export function setH3SegmentsSecondSampleEnabled(segments, enabled, fallback) {
  if (!Array.isArray(segments)) return 0;
  const normalizedFallback = normalizeH3SecondSample(fallback);
  const defaultConfig = normalizedFallback.mode === "off"
    ? normalizeH3SecondSample({ mode: "standard" }) : normalizedFallback;
  for (const segment of segments) {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) continue;
    if (!enabled) {
      setH3SegmentSecondSample(segment, { mode: "off" });
      continue;
    }
    const active = normalizeH3SecondSample(segment.second_sample, segment);
    if (active.mode !== "off") continue;
    const restore = normalizeH3SecondSample(segment.second_sample_restore, segment);
    setH3SegmentSecondSample(segment, restore.mode === "off" ? defaultConfig : restore);
  }
  return segments.filter((segment) => normalizeH3SecondSample(
    segment && segment.second_sample, segment).mode !== "off").length;
}

export function h3SecondSampleTargets(segments, selectedIndex, scope) {
  if (!Array.isArray(segments) || !segments.length) return [];
  const selected = Math.max(0, Math.min(
    Math.round(Number(selectedIndex) || 0), segments.length - 1));
  if (scope !== "checked") return [selected];
  return segments.map((segment, index) => segment && segment.enabled !== false ? index : -1)
    .filter((index) => index >= 0);
}

export function h3SecondSampleSummary(segments, targetIndexes, scope) {
  const configs = targetIndexes.map((index) => normalizeH3SecondSample(
    segments && segments[index] && segments[index].second_sample,
    segments && segments[index]));
  const labels = new Map(H3_SECOND_SAMPLE_MODES.map((item) => [item.id, item.label]));
  const layoutLabels = new Map([["tiled", "优先2块"], ["full", "整幅一次"]]);
  const modes = [...new Set(configs.map((config) => config.mode))];
  const layouts = [...new Set(configs.filter((config) => config.mode !== "off")
    .map((config) => config.sampling_layout))];
  const modeText = modes.length === 1 ? labels.get(modes[0]) : "分别设置";
  const layoutText = layouts.length === 1 ? ` · ${layoutLabels.get(layouts[0])}`
    : layouts.length > 1 ? " · 采样方式分别设置" : "";
  const scopeText = scope === "checked" ? `已勾选${targetIndexes.length}段` : "当段";
  return `${scopeText} · ${modeText || "关闭"}${layoutText}`;
}
