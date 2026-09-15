export const H3_UPSCALE_MODEL_CATALOG = Object.freeze([
  {
    id: "realesrgan_x2plus",
    label: "写实/通用 2×（推荐）— RealESRGAN_x2plus",
    filename: "RealESRGAN_x2plus.pth",
  },
  {
    id: "realesrgan_x4plus",
    label: "写实/通用 4× — RealESRGAN_x4plus",
    filename: "RealESRGAN_x4plus.pth",
  },
  {
    id: "realesrgan_anime_x4",
    label: "动漫 4× — RealESRGAN_x4plus_anime_6B",
    filename: "RealESRGAN_x4plus_anime_6B.pth",
  },
  {
    id: "ultrasharp_x4",
    label: "锐化 4× — 4x-UltraSharp",
    filename: "4x-UltraSharp.pth",
  },
]);

export function h3UpscaleComparePercent(clientX, left, width) {
  const safeWidth = Number(width);
  if (!Number.isFinite(safeWidth) || safeWidth <= 0) return 50;
  const percent = (Number(clientX) - Number(left)) / safeWidth * 100;
  return Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 50));
}

export function h3UpscaleMediaErrorMessage(label, error) {
  const code = Number(error && error.code) || 0;
  const reason = {
    1: "加载已中止",
    2: "网络或媒体路由失败",
    3: "视频解码失败",
    4: "文件或编码不受支持",
  }[code] || "未知媒体错误";
  return `${String(label || "视频")}加载失败（${reason}${code ? `，code ${code}` : ""}）；请检查文件是否存在且编码可播放。`;
}

export function h3UpscaleResultVideoRoute(result, cacheStamp = Date.now()) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  const filename = String(result.filename || "");
  const subfolder = String(result.subfolder || "").replaceAll("\\", "/");
  const type = String(result.type || "output");
  if (type !== "output" || !filename || filename.includes("\0")
      || filename.includes("/") || filename.includes("\\")
      || /^[A-Za-z]:/.test(filename) || !/\.mp4$/i.test(filename)) return "";
  if (subfolder.includes("\0") || subfolder.startsWith("/") || /^[A-Za-z]:/.test(subfolder)) return "";
  const parts = subfolder ? subfolder.split("/") : [];
  if (parts.some((part) => !part || part === "." || part === "..")) return "";
  return "/h3director/upscale_video"
    + `?filename=${encodeURIComponent(filename)}`
    + `&subfolder=${encodeURIComponent(subfolder)}`
    + "&type=output"
    + `&t=${encodeURIComponent(String(cacheStamp))}`;
}

export function normalizeH3UpscaleSettings(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: source.mode === "Lanczos普通放大" ? "Lanczos普通放大" : "AI模型超分",
    model_name: String(source.model_name || ""),
    output_scale: Math.min(4, Math.max(1, Number(source.output_scale) || 2)),
    frame_batch_size: Math.min(32, Math.max(1, Math.round(Number(source.frame_batch_size) || 4))),
    filename_prefix: String(source.filename_prefix || "video/h3director/upscale/H3超分").trim()
      || "video/h3director/upscale/H3超分",
  };
}

export function h3OutputVideoSource(projectId, filename) {
  const project = String(projectId || "").replace(/[^0-9A-Za-z_-]+/g, "_")
    .slice(0, 80).replace(/^_+|_+$/g, "");
  const name = String(filename || "").replaceAll("\\", "/").split("/").pop();
  if (!project || !name || !/\.(?:mp4|webm|mov|mkv|avi)$/i.test(name)) return "";
  return `video/h3director/${project}/${name} [output]`;
}

export function h3InputVideoSource(filename) {
  const value = String(filename || "").trim().replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value)
      || value.split("/").includes("..")
      || !/\.(?:mp4|webm|mov|mkv|avi)$/i.test(value)) return "";
  return value + " [input]";
}

export function buildH3VideoUpscalePrompt(sourceFile, rawSettings) {
  const source = String(sourceFile || "").trim();
  if (!source) throw new Error("请先选择待超分视频");
  const settings = normalizeH3UpscaleSettings(rawSettings);
  const prompt = {
    h3_upscale_source: {
      class_type: "LoadVideo",
      inputs: { file: source },
    },
    h3_upscale_output: {
      class_type: "H3DirectorVideoUpscale",
      inputs: {
        video: ["h3_upscale_source", 0],
        mode: settings.mode,
        output_scale: settings.output_scale,
        frame_batch_size: settings.frame_batch_size,
        filename_prefix: settings.filename_prefix,
      },
    },
  };
  if (settings.mode === "AI模型超分") {
    if (!settings.model_name) throw new Error("AI模型超分需要选择一个 UPSCALE_MODEL");
    prompt.h3_upscale_model = {
      class_type: "UpscaleModelLoader",
      inputs: { model_name: settings.model_name },
    };
    prompt.h3_upscale_output.inputs.upscale_model = ["h3_upscale_model", 0];
  }
  return prompt;
}

export function h3UpscaleResultFromExecuted(detail) {
  const values = detail && detail.output && (detail.output.images || detail.output.video);
  const item = Array.isArray(values) && values[0];
  if (!item || !item.filename) return null;
  const metadataValues = detail && detail.output && detail.output.h3_upscale;
  const metadata = Array.isArray(metadataValues) && metadataValues[0]
    && typeof metadataValues[0] === "object" ? metadataValues[0] : {};
  return {
    filename: String(item.filename),
    subfolder: String(item.subfolder || ""),
    type: item.type === "temp" ? "temp" : "output",
    mode: String(metadata.mode || ""),
    source_width: Math.max(0, Number(metadata.source_width) || 0),
    source_height: Math.max(0, Number(metadata.source_height) || 0),
    output_width: Math.max(0, Number(metadata.output_width) || 0),
    output_height: Math.max(0, Number(metadata.output_height) || 0),
  };
}

export async function readH3UpscaleHistory(fetchApi, promptId, attempts = 10, delayMs = 100) {
  const id = String(promptId || "").trim();
  if (!id) throw new Error("缺少超分任务 ID");
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    try {
      const response = await fetchApi("/history/" + encodeURIComponent(id));
      if (!response.ok) throw new Error("HTTP " + response.status);
      const payload = await response.json();
      const entry = payload && (payload[id] || payload);
      const output = entry && entry.outputs && entry.outputs.h3_upscale_output;
      const result = h3UpscaleResultFromExecuted({ output });
      if (result) return result;
      lastError = new Error("历史记录尚未写入超分结果");
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError || new Error("历史记录没有超分结果");
}
