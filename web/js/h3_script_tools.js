/* H3 导演台 · 剧本资产与生产前检查纯函数。
   本文件不依赖 DOM/ComfyUI，可由浏览器和 Node 单元测试共同使用。 */

export const H3_ASSET_TYPES = Object.freeze({
  character: { label: "角色", prefix: "C", subject: "character" },
  prop: { label: "道具", prefix: "P", subject: "prop" },
  scene: { label: "场景", prefix: "S", subject: "scene" },
  general: { label: "通用参考", prefix: "G", subject: "reference asset" },
});

/* 输入框“关键词触发选择”的纯文本部分。UI 只负责展示选项；匹配与替换放在
   无 DOM 的工具文件中，便于 Node 回归测试，也避免文本页与创作页各写一套。 */
const H3_PROMPT_ASSIST_TRIGGERS = Object.freeze([
  { key: "story", label: "剧情", fieldOnly: true, pattern: /(?:剧情走向|故事走向|剧情|故事)\s*[:：]?\s*$/,
    context: /(?:剧情走向|故事走向|剧情|故事)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "game_ui", label: "游戏界面", fieldOnly: true, pattern: /(?:游戏界面|界面流程|界面)\s*[:：]?\s*$/,
    context: /(?:游戏界面|界面流程|界面)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "character", label: "人物", fieldOnly: true, pattern: /(?:人物设定|角色设定|人物|角色)\s*[:：]?\s*$/,
    context: /(?:人物设定|角色设定|人物|角色)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "scene", label: "场景", fieldOnly: true, pattern: /(?:场景布局|主场景|场景)\s*[:：]?\s*$/,
    context: /(?:场景布局|主场景|场景)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "equipment", label: "装备/道具", fieldOnly: true, pattern: /(?:装备|道具|武器)\s*[:：]?\s*$/,
    context: /(?:装备|道具|武器)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "action", label: "动作", fieldOnly: true, pattern: /(?:动作过程|动作设计|角色动作|动作)\s*[:：]?\s*$/,
    context: /(?:动作过程|动作设计|角色动作|动作)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "shot", label: "镜头", fieldOnly: true, pattern: /(?:镜头语言|镜头设计|镜头感觉|镜头)\s*[:：]?\s*$/,
    context: /(?:镜头语言|镜头设计|镜头感觉|镜头)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "ending", label: "结尾", fieldOnly: true, pattern: /(?:最后画面|结尾状态|结尾|尾帧)\s*[:：]?\s*$/,
    context: /(?:最后画面|结尾状态|结尾|尾帧)\s*[:：]\s*([^\n；;。！？!?]{0,120})$/ },
  { key: "core_idea", label: "核心创意", pattern: /(?:【\s*)?核心创意(?:\s*】)?\s*[:：]?\s*$/ },
  { key: "visual_process", label: "画面过程描述", pattern: /(?:【\s*)?画面过程描述(?:\s*】)?\s*[:：]?\s*$/ },
  { key: "overall_requirements", label: "整体要求补充", pattern: /(?:【\s*)?整体要求补充(?:\s*】)?\s*[:：]?\s*$/ },
  { key: "camera_rhythm", label: "相机节奏", pattern: /(?:【\s*)?相机节奏(?:\s*】)?\s*[:：]?\s*$/ },
  { key: "environment_sound", label: "环境音", pattern: /(?:【\s*)?(?:环境音|环境声音)(?:\s*】)?\s*[:：]?\s*$/ },
  { key: "duration", label: "时长", pattern: /(?:总时长|时长)\s*[:：]?\s*$/ },
  { key: "style", label: "风格", pattern: /(?:画面风格|视觉风格|画风|风格)\s*[:：]?\s*$/ },
  { key: "aspect", label: "画幅", pattern: /(?:画面比例|宽高比|画幅|比例)\s*[:：]?\s*$/ },
  { key: "genre", label: "类型", pattern: /(?:作品类型|视频类型|题材|类型)\s*[:：]?\s*$/ },
  { key: "pace", label: "节奏", pattern: /(?:叙事节奏|剪辑节奏|节奏)\s*[:：]?\s*$/ },
  { key: "dialogue", label: "对白", pattern: /(?:对白|台词|旁白)\s*[:：]?\s*$/ },
  { key: "camera", label: "运镜", pattern: /(?:镜头运动|摄影机|运镜)\s*[:：]?\s*$/ },
  { key: "focus", label: "重点", pattern: /(?:内容重点|创作重点|侧重|重点)\s*[:：]?\s*$/ },
  { key: "structure", label: "镜头结构", pattern: /(?:叙事结构|镜头结构)\s*[:：]?\s*$/ },
  { key: "transition", label: "转场", pattern: /(?:转场方式|转场)\s*[:：]?\s*$/ },
  { key: "sound", label: "声音", pattern: /(?:环境声音|声音设计|音效设计|音效|声音)\s*[:：]?\s*$/ },
  { key: "music", label: "配乐", pattern: /(?:背景音乐|非叙事音乐|配乐|音乐)\s*[:：]?\s*$/ },
  { key: "continuity", label: "连续性", pattern: /(?:连续性要求|连续性|镜头衔接|衔接|续接)\s*[:：]?\s*$/ },
  { key: "onscreen_text", label: "画面文字", pattern: /(?:屏幕文字|画面文字|字幕策略)\s*[:：]?\s*$/ },
  { key: "constraint", label: "限制", pattern: /(?:禁止项|负面限制|限制条件|限制)\s*[:：]?\s*$/ },
]);

export function detectH3PromptAssistTrigger(value, caretPosition = null) {
  const text = String(value || "");
  const explicitCaret = caretPosition !== null && caretPosition !== undefined && Number.isFinite(Number(caretPosition));
  const caret = Math.max(0, Math.min(text.length, explicitCaret ? Number(caretPosition) : text.length));
  const before = text.slice(0, caret);
  let best = null;
  for (const item of H3_PROMPT_ASSIST_TRIGGERS) {
    const match = before.match(item.pattern);
    if (!match) continue;
    const start = caret - match[0].length;
    if (item.fieldOnly && start > 0 && !/[\n；;。！？!?]/.test(before[start - 1])) continue;
    if (!best || match[0].length > (best.end - best.start)
        || (match[0].length === (best.end - best.start) && start > best.start)) {
      const keyword = String(match[0] || "").replace(/[\s:：]+$/g, "").trim() || item.label;
      best = { key: item.key, label: item.label, keyword, start, end: caret };
    }
  }
  /* 用户已经在某个栏目后输入了半句话时，候选仍留在蓝色辅助区。此时点击候选
     只在光标处追加，不覆盖刚刚输入的文字，也不自动确认或进入下一步。 */
  for (const item of H3_PROMPT_ASSIST_TRIGGERS) {
    if (!item.context) continue;
    const match = before.match(item.context);
    if (!match) continue;
    const currentValue = String(match[1] || "");
    const start = caret - currentValue.length;
    if (!best || start >= best.start) {
      best = {
        key: item.key,
        label: item.label,
        keyword: item.label,
        start: caret,
        end: caret,
        insertionOnly: true,
        hasCurrentValue: Boolean(currentValue.trim()),
      };
    }
  }
  return best;
}

/**
 * 主分镜框内联创作主题触发器。它只接受光标位于末尾的短自然语言主题，避免把已经
 * 生成的官方 Base、长剧本或逐行编辑内容误判成一句话创作入口。
 */
export function detectH3InlineCreativeTopic(value, caretPosition = null) {
  const text = String(value || "");
  const explicitCaret = caretPosition !== null && caretPosition !== undefined && Number.isFinite(Number(caretPosition));
  const caret = Math.max(0, Math.min(text.length, explicitCaret ? Number(caretPosition) : text.length));
  if (caret !== text.length) return null;
  const topic = text.trim();
  if (topic.length < 2 || topic.length > 180 || /[\n；;]/.test(topic)) return null;
  if (/(?:integrated_multimodal_description|subject_definitions|detailed_description|\[Shot\s+\d+\]|段\d+\s*[（(])/i.test(topic)) return null;
  if (/(?:核心创意|画面过程描述|整体要求补充|相机节奏|环境音|环境声音|总时长|时长|画幅|画面比例|风格|类型|镜头感觉|镜头语言|镜头调度|声音\/对白|画面文字|禁止项)\s*[:：]?$/i.test(topic)) return null;
  return { key: "creative_topic", label: "创作主题", keyword: topic, topic, start: 0, end: text.length };
}

export function appendH3GuidedQuickOption(currentValue, optionValue) {
  const current = String(currentValue || "").trim().replace(/[；;\s]+$/g, "");
  const option = String(optionValue || "").trim().replace(/^[；;\s]+|[；;\s]+$/g, "");
  if (!option) return current;
  if (!current) return option;
  if (current.includes(option)) return current;
  return `${current}；${option}`;
}

export function applyH3PromptAssistSelection(value, trigger, selection) {
  const text = String(value || "");
  if (!trigger || !Number.isInteger(trigger.start) || !Number.isInteger(trigger.end)) {
    return { text, caret: text.length };
  }
  const start = Math.max(0, Math.min(text.length, trigger.start));
  const end = Math.max(start, Math.min(text.length, trigger.end));
  const keyword = String(trigger.keyword || trigger.label || "条件").trim();
  const chosen = String(selection || "").trim().replace(/[；;，,。\s]+$/g, "");
  if (!chosen) return { text, caret: end };
  if (trigger.insertionOnly) {
    const prefix = trigger.hasCurrentValue && !/[；;，,、\s]$/.test(text.slice(0, end)) ? "；" : "";
    const suffix = /[；;。！？!?]$/.test(chosen) ? "" : "；";
    const replacement = `${prefix}${chosen}${suffix}`;
    const next = text.slice(0, end) + replacement + text.slice(end);
    return { text: next, caret: end + replacement.length };
  }
  const replacement = `${keyword}：${chosen}；`;
  const next = text.slice(0, start) + replacement + text.slice(end);
  return { text: next, caret: start + replacement.length };
}

function h3PromptAssistInternalShots(segments = []) {
  const shots = [];
  for (const segment of segments || []) {
    for (const line of String(segment && segment.internal_shots || "").split(/\n+/)) {
      const time = line.match(/全片(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒/);
      const action = line.match(/动作=([^；]+)(?:；|$)/);
      const camera = line.match(/摄影机触发=([^；]+)(?:；|$)/);
      const result = line.match(/本镜新增信息\/结果=([^；]+)(?:；|$)/);
      const sound = line.match(/同步声音=([^；]+)(?:；|$)/);
      if (!time || !action) continue;
      shots.push({
        start: Number(time[1]), end: Number(time[2]), action: action[1],
        camera: camera?.[1] || "主体动作后响应", result: result?.[1] || "动作结果清楚",
        sound: sound?.[1] || "环境底噪与可见动作同步",
      });
    }
  }
  return shots;
}

/** 为“核心创意/画面过程描述”等就地栏目生成当前方案的完整蓝色候选。 */
export function buildH3PromptAssistSection(sectionKey, fields = {}, segments = []) {
  const key = String(sectionKey || "");
  const templateId = String(fields.template_id || "");
  const duration = String(fields.duration || "15秒").trim();
  const aspect = String(fields.aspect || "横屏16:9").trim();
  const subject = String(fields.content || fields.story_premise || fields.knowledge_topic || fields.source_copy
    || fields.product_name || fields.brand_name || fields.game_name || fields.drawn_entity || "当前主题").trim();
  const shots = h3PromptAssistInternalShots(segments);
  if (key === "core_idea") {
    if (/handdrawn_live/.test(templateId)) {
      return `${duration}，${aspect}。将${fields.live_space}与手绘发光动画融合：${fields.contact_method}，同一${fields.drawn_entity}沿${fields.chase_route}连续变形（${fields.transform_chain}），最后形成${fields.space_finale}。整体${fields.emotional_tone}。`;
    }
    if (/(?:^|_)product_ad(?:_|$)/.test(templateId)) {
      return `${duration}，${aspect}。${fields.product_name}广告：先锁定${fields.product_material}，再连续显示${fields.product_action}，最终证明${fields.product_result}；${fields.text_mode === "无文字" ? "全片无文字，只保留产品和同步动作音效" : `结尾只显示唯一文案“${fields.ad_copy_text || fields.ad_copy || "待确认"}”`}。`;
    }
    return `${duration}，${aspect}。${subject}；视觉风格为${fields.style || "当前模板风格"}，场景、人物、道具和动作因果保持连续，结尾停在可验证结果。`;
  }
  if (key === "visual_process") {
    const process = shots.map((shot) => `${shot.start.toFixed(1)}–${shot.end.toFixed(1)}秒—正向：${shot.action}；相机：${shot.camera}；结果：${shot.result}`).join("。\n");
    return `${process}${process ? "。\n" : ""}反向：${fields.constraint || "不新增未建立的角色、道具、地点、随机文字或无来源效果"}。`;
  }
  if (key === "overall_requirements") {
    return `视觉（贯穿全片）：${fields.style || "保持当前模板风格"}；${fields.appearance || fields.product_material || fields.drawn_entity || "主体身份与外观锁定"}。空间（贯穿全片）：${fields.scene_layout || fields.live_space || fields.scene || "固定场景与动作轴线连续"}。连续性：${fields.continuity || "前一动作结果成为后一动作起点"}。禁止：${fields.constraint || "不新增角色、道具、场景或随机文字"}。`;
  }
  if (key === "camera_rhythm" || key === "camera") {
    const cameraEvents = [...new Set(shots.map((shot) => shot.camera))].slice(0, 4);
    return `相机节奏（贯穿全片）：${fields.camera || "主体动作先发生，摄影机随后响应"}；镜头路线=${fields.shot_language || "按当前模板镜头语言执行"}；${cameraEvents.join("；")}。不提前构图，结果出现后立即制动。`;
  }
  if (key === "environment_sound" || key === "sound") {
    const sounds = [...new Set(shots.map((shot) => shot.sound))].slice(0, 5);
    return `环境音（贯穿全片）：${fields.sound || "环境底噪与动作同步音效"}；${sounds.join("；")}；每个声音只在对应可见动作发生时出现，不提前播放后续声音。`;
  }
  if (key === "constraint") return String(fields.constraint || "不新增角色、道具、场景，不出现随机文字，不使用无来源效果").trim();
  return "";
}

const H3_GUIDED_FIELD_LABELS = Object.freeze({
  content: "内容", duration: "时长", style: "风格", aspect: "画幅", genre: "类型",
  story_route: "故事节拍", shot_language: "镜头调度",
  skill_source: "官方技能来源",
  game_name: "游戏名称", player1: "PLAYER 1", player2: "PLAYER 2",
  color_system: "颜色系统", ui_copy: "UI菜单文案",
  product_name: "产品名称", product_category: "产品类别", source_assets: "参考素材", product_variant: "主推款",
  product_color: "产品主色", product_material: "产品材质", product_action: "产品动作", product_result: "最终证明",
  ad_style: "广告模板", text_mode: "画面文字模式", ad_copy_text: "唯一文案", ad_copy: "广告文案", narrative_spine: "叙事脊柱",
  project_title: "项目名称", story_premise: "故事前提", core_prop: "核心道具",
  supporting_props: "辅助道具", destination: "送达终点", opening_layout: "起点布局",
  route_layout: "路线布局", receiver_timing: "接收者出场规则", first_action: "起点动作",
  primary_obstacle: "主要障碍", wrong_attempt: "错误尝试", failure_result: "失败尾帧",
  recovery_action: "续接恢复动作", climax_action: "高潮动作", payoff_action: "收束动作", emotional_arc: "情绪弧",
  character_lock: "角色卡锁", landmark_lock: "场景卡锁", hook_pattern: "Hook分布",
  knowledge_topic: "知识主题", learning_goal: "学习目标", target_audience: "目标受众",
  visual_metaphor: "视觉隐喻", paper_layers: "纸雕层级", paper_mechanism: "纸艺机关",
  narration_policy: "旁白策略", source_copy: "原始文案", collage_palette: "拼贴色板",
  object_groups: "纸片物件组", audio_policy: "拼贴音频",
  brand_name: "品牌/产品", verified_claim: "核验卖点", call_to_action: "行动号召",
  brand_palette: "品牌色板", copy_language: "文案语言",
  music_style: "音乐风格", master_audio: "主音轨", music_window: "音乐窗口",
  locked_lyrics: "锁定歌词", typography_style: "文字包装", reference_roles: "参考卡分工",
  beat_map: "节拍映射", stitch_policy: "衔接协议",
  live_space: "实拍空间", contact_method: "真实接触", drawn_entity: "手绘实体",
  center_color: "中心色", transform_chain: "变形链", chase_route: "追逐路线",
  filmer_reaction: "拍摄者反应", space_finale: "空间级结尾", emotional_tone: "情绪调性",
  characters: "角色", appearance: "角色外观/服装", scene: "场景", scene_layout: "场景固定布局",
  props: "道具/装备", focus: "重点",
  structure: "镜头结构", pace: "节奏", camera: "运镜", transition: "转场",
  dialogue: "对白模式", dialogue_language: "对白语言", dialogue_script: "精确台词",
  voice_direction: "声音表演", sound: "声音", music: "配乐", continuity: "连续性",
  onscreen_text: "画面文字", constraint: "限制",
});

function h3GuidedDurationSeconds(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  const seconds = match ? Number(match[0]) : 0;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(1800, seconds) : 15;
}

function h3GuidedNumber(value) {
  const number = Number(value) || 0;
  return Math.abs(number - Math.round(number)) < 0.001
    ? String(Math.round(number)) : number.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "");
}

/**
 * 本地逐步填写模式的分段计划。它不调用 AI，也不伪装成官方 Base：只把用户
 * 亲自选择的要求装入 15 秒以内的 Director 普通段，避免长提示词再次按字数
 * 估时并拆成错误数量。
 */
export function planH3GuidedSegments(durationValue, maxSegmentSeconds = 15) {
  const total = h3GuidedDurationSeconds(durationValue);
  const maxSeconds = Math.max(5, Math.min(15, Number(maxSegmentSeconds) || 15));
  const count = Math.max(1, Math.ceil(total / maxSeconds));
  const base = total / count;
  const segments = [];
  let start = 0;
  for (let index = 0; index < count; index++) {
    const end = index === count - 1 ? total : base * (index + 1);
    segments.push({ index, start, end, duration: end - start });
    start = end;
  }
  return { total, count, segments };
}

function h3GuidedPairs(fields, keys) {
  const pairs = [];
  for (const key of keys) {
    const value = String(fields && fields[key] || "").trim()
      .replace(/\s*\n+\s*/g, "；").replace(/[；;\s]+$/g, "");
    if (value) pairs.push(`${H3_GUIDED_FIELD_LABELS[key]}：${value}`);
  }
  return pairs.join("；");
}

export const H3_GUIDED_DIALOGUE_MODES = Object.freeze([
  "无对白无旁白（纯环境声和动作音效，最稳）",
  "无台词（允许清晰非语言呼吸/笑声）",
  "精确角色对白（必须填写时间、说话人和台词原文）",
  "精确旁白（必须填写时间和旁白原文）",
  "精确角色对白+旁白（必须填写全部原文）",
]);

export const H3_GUIDED_DIALOGUE_LANGUAGES = Object.freeze([
  "普通话（简体中文）",
  "English（英文）",
]);

export function isH3GuidedSpeechMode(value) {
  const text = String(value || "");
  return /精确(?:角色对白|旁白)|角色对白\s*\+\s*旁白/.test(text)
    && !/(?:无对白|无台词|仅环境声|纯环境声)/.test(text);
}

function h3GuidedDialogueModeKind(value) {
  const text = String(value || "");
  if (!isH3GuidedSpeechMode(text)) return /允许清晰非语言/.test(text) ? "nonverbal" : "silent";
  if (/角色对白\s*\+\s*旁白/.test(text)) return "both";
  if (/旁白/.test(text) && !/角色对白/.test(text)) return "narration";
  return "character";
}

function h3GuidedLanguageTag(value) {
  return /English|英文/i.test(String(value || "")) ? "English" : "Chinese";
}

function h3GuidedSpeechUnits(value) {
  const text = String(value || "").replace(/<[^>]+>/g, "");
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, " ").match(/[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g) || []).length;
  return han + words;
}

function h3GuidedCleanDialogueText(value) {
  return String(value || "")
    .replace(/<\/?d\b[^>]*>/gi, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

/**
 * 宽松读取对白编辑器的逐行内容。与正式校验不同，这个函数会保留格式错误、
 * 空白台词和“请填写准确台词”等待填行，供界面继续显示和修改；正式生成仍由
 * validateH3GuidedDialogueScript() 严格阻止无效内容。
 */
export function parseH3GuidedDialogueEntries(value) {
  const lines = String(value || "").split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
  return lines.map((rawLine, index) => {
    const raw = rawLine.replace(/^[-*]\s*/, "");
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[｜|]\s*([^｜|]*?)\s*[｜|]\s*(.*)$/i);
    if (!match) {
      return {
        start: null, end: null, speaker: "", text: raw, raw,
        sourceLine: index + 1, formatValid: false,
      };
    }
    return {
      start: Number(match[1]),
      end: Number(match[2]),
      speaker: String(match[3] || "").trim(),
      text: h3GuidedCleanDialogueText(match[4]),
      raw,
      sourceLine: index + 1,
      formatValid: true,
    };
  });
}

/**
 * 逐步填写的精确对白使用全片绝对秒数：
 *   0.000–2.000秒｜熊猫｜我一定要拿到那个红苹果。
 * 每句必须完整落在一个不超过15秒的 Director 生成段内，避免跨段截断或重复。
 */
export function validateH3GuidedDialogueScript(value, options = {}) {
  const mode = String(options.mode || "");
  const duration = h3GuidedDurationSeconds(options.duration || "15秒");
  const segmentSeconds = Math.max(5, Math.min(15, Number(options.segmentSeconds) || 15));
  const language = String(options.language || "普通话（简体中文）").trim() || "普通话（简体中文）";
  const languageTag = h3GuidedLanguageTag(language);
  const kind = h3GuidedDialogueModeKind(mode);
  const errors = [];
  const warnings = [];
  const entries = [];
  if (kind === "silent" || kind === "nonverbal") {
    return { ok: true, kind, duration, language, languageTag, entries, errors, warnings, normalized: "" };
  }
  const raw = String(value || "").trim();
  if (!raw) {
    errors.push("已选择精确对白/旁白，但没有填写台词清单。请按“0.000–2.000秒｜说话人｜准确原文”逐行填写。");
    return { ok: false, kind, duration, language, languageTag, entries, errors, warnings, normalized: "" };
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].replace(/^[-*]\s*/, "");
    const match = line.match(/^(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[｜|]\s*([^｜|]+?)\s*[｜|]\s*(.+)$/i);
    if (!match) {
      errors.push(`第 ${lineIndex + 1} 行格式不正确；必须写成“0.000–2.000秒｜说话人｜准确原文”。`);
      continue;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const speaker = String(match[3] || "").trim();
    const text = h3GuidedCleanDialogueText(match[4]);
    if (!(end > start)) errors.push(`第 ${lineIndex + 1} 行结束时间必须大于开始时间。`);
    if (start < -0.001 || end > duration + 0.001) {
      errors.push(`第 ${lineIndex + 1} 行时间 ${start.toFixed(3)}–${end.toFixed(3)} 秒超出全片 0–${duration.toFixed(3)} 秒。`);
    }
    if (!speaker || /^(?:角色名|说话人|speaker)$/i.test(speaker)) errors.push(`第 ${lineIndex + 1} 行必须填写真实说话人名称或“旁白”。`);
    if (!text || /^(?:请填写(?:准确)?台词|准确台词|准确原文|台词原文|旁白原文|text)$/i.test(text)) errors.push(`第 ${lineIndex + 1} 行必须填写最终要逐字说出的原文。`);
    const narration = /旁白|画外音|narrator|voiceover/i.test(speaker);
    if (kind === "character" && narration) errors.push(`第 ${lineIndex + 1} 行是旁白，但当前模式只允许角色对白。`);
    if (kind === "narration" && !narration) errors.push(`第 ${lineIndex + 1} 行不是旁白，但当前模式只允许精确旁白。`);
    const startSegment = Math.floor(Math.max(0, start) / segmentSeconds);
    const endSegment = Math.floor(Math.max(0, end - 0.001) / segmentSeconds);
    if (startSegment !== endSegment) {
      errors.push(`第 ${lineIndex + 1} 行跨越 ${segmentSeconds} 秒生成段边界；请拆成两句或调整到同一生成段内。`);
    }
    const seconds = Math.max(0.001, end - start);
    const units = h3GuidedSpeechUnits(text);
    if (units > seconds * 5.5 + 0.01) {
      errors.push(`第 ${lineIndex + 1} 行约 ${units} 字/词，超过 ${seconds.toFixed(1)} 秒可懂度绝对上限；请缩短台词或延长时间。`);
    } else if (units > seconds * 4 + 0.01) {
      warnings.push(`第 ${lineIndex + 1} 行约 ${units} 字/词，语速高于正常约4字/词每秒，可能影响清晰度。`);
    }
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && speaker && text) {
      entries.push({ start, end, speaker, text, narration, units, language, languageTag, sourceLine: lineIndex + 1 });
    }
  }
  entries.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < entries.length; index++) {
    if (entries[index].start < entries[index - 1].end - 0.001) {
      errors.push(`第 ${entries[index - 1].sourceLine} 行与第 ${entries[index].sourceLine} 行时间重叠；为避免串音，请不要让两句同时说。`);
    }
  }
  const normalized = entries.map((entry) => `${entry.start.toFixed(3)}–${entry.end.toFixed(3)}秒｜${entry.speaker}｜${entry.text}`).join("\n");
  return { ok: errors.length === 0, kind, duration, language, languageTag, entries, errors, warnings, normalized };
}

function h3GuidedSoundForDialogue(value, fields) {
  const mode = String(fields.dialogue || "");
  const kind = h3GuidedDialogueModeKind(mode);
  const allowMusicVocals = String(fields.allow_music_vocals || "").toLowerCase() === "true";
  const source = String(value || "").trim();
  if (kind === "character" || kind === "narration" || kind === "both") {
    return `${source || "环境底噪和动作音效与画面同步"}；清单台词出现时压低动作音效和BGM，台词结束后平滑恢复`;
  }
  const kept = source.split(/[；;。]/).map((item) => item.trim()).filter(Boolean)
    .filter((item) => !/(?:对白|旁白|台词|口播|说话|耳语|咕哝|广播|解说|voiceover)/i.test(item))
    .filter((item) => allowMusicVocals || !/(?:歌词|歌唱|演唱|人声|vocal)/i.test(item));
  const base = kept.join("；") || "环境底噪、材质、脚步、接触、受力、按钮、机械和场景音效与可见动作同步";
  if (kind === "nonverbal") return `${base}；仅允许与可见表演对应的短促呼吸、笑声或惊呼，不得形成词句`;
  if (allowMusicVocals) return `${base}；禁止角色对白、旁白、广播、含混人声和模型新增歌词；歌曲人声只能来自唯一Master Audio与锁定歌词`;
  return `${base}；禁止任何语言、角色发声、旁白、歌词、广播、耳语、咕哝和伪语言`;
}

function h3GuidedDialogueContract(fields, segment) {
  const mode = String(fields.dialogue || "无对白无旁白（纯环境声和动作音效，最稳）").trim();
  const kind = h3GuidedDialogueModeKind(mode);
  const allowMusicVocals = String(fields.allow_music_vocals || "").toLowerCase() === "true";
  if (kind === "silent") {
    if (allowMusicVocals) {
      const lyrics = String(fields.locked_lyrics || "").trim();
      return {
        global: `无角色对白、无旁白、无广播、无耳语、无咕哝和无模型新增人声；歌曲人声只能来自唯一Master Audio，歌词只能逐字使用锁定歌词“${lyrics || "无歌词纯音乐MV"}”，禁止改词、补词或生成伪语言`,
        segment: "本段没有角色台词或旁白；仅按Master Audio时间轴播放已锁定歌曲人声，画面角色不生成额外说话口型",
      };
    }
    return {
      global: "无对白、无旁白、无歌词、无广播、无耳语、无咕哝、无伪语言或含混语言人声；角色不做说话口型；只保留环境声和与画面同步的动作音效",
      segment: "本段无任何语言或角色发声，不允许模型自行补写台词",
    };
  }
  if (kind === "nonverbal") {
    return {
      global: "无可辨识语言、无对白、无旁白、无歌词、无广播和无伪语言；只允许与画面动作明确对应的短促呼吸、笑声或惊呼，不得形成词句",
      segment: "本段没有台词；非语言人声必须短促、清楚且与可见表演同步",
    };
  }
  const validation = validateH3GuidedDialogueScript(fields.dialogue_script, {
    mode, duration: fields.duration, language: fields.dialogue_language, segmentSeconds: 15,
  });
  if (!validation.ok) {
    return {
      global: "精确台词清单缺失或无效；为避免乱码人声，本次强制按无对白、无旁白、无伪语言执行",
      segment: "本段无台词，不允许模型自行补写人声",
    };
  }
  const direction = String(fields.voice_direction || "自然语速、口齿清楚、逐字照读").trim();
  const lines = validation.entries.filter((entry) => entry.start >= segment.start - 0.001 && entry.start < segment.end - 0.001)
    .map((entry) => {
      const performance = entry.narration
        ? "离屏旁白；画面中角色嘴巴保持闭合，narrator-mouth-closed: true"
        : `${entry.speaker}说话时口型逐字同步；其他角色保持闭口`;
      return `- ${entry.start.toFixed(3)}–${entry.end.toFixed(3)}秒｜${entry.speaker}｜${performance}｜<d>[${entry.languageTag}]${entry.text}</d>`;
    });
  return {
    global: `模式=${mode}；对白语言=${validation.language}，统一使用 <d>[${validation.languageTag}]准确原文</d>；仅允许清单中的台词，必须逐字照读，不改写、不翻译、不添加；${direction}`,
    segment: lines.length ? lines.join("\n") : "本段没有清单台词；角色全部闭口，不允许模型自行补写人声",
  };
}

/** v2.24.x 兼容实现，仅保留给源码对照；新向导使用下方官方 Base 编译器。 */
function buildH3GuidedDirectorScriptLegacy(fields = {}, segmentTexts = []) {
  const plan = planH3GuidedSegments(fields.duration || "15秒");
  const content = String(fields.content || "").trim().replace(/[；;\s]+$/g, "");
  const isOfficial3d = String(fields.template_id || "") === "animation_3d_short_official";
  const isOfficialProduct = String(fields.template_id || "") === "minimalist_product_ad_official";
  const productNoCopy = isOfficialProduct
    && /(?:^|[，,；;：:\s])(?:无文案|不要文案|不显示文案|无屏幕文字|no\s*copy)(?:$|[，,；;。\s])/i.test(String(fields.ad_copy || ""));
  const narrativeTheme = isOfficial3d
    && String(fields.story_premise || "").trim()
    ? String(fields.story_premise).trim().replace(/[；;\s]+$/g, "") : content;
  const lockedKeys = ["skill_source", "style", "aspect", "game_name", "player1", "player2", "color_system", "ui_copy",
      "product_name", "source_assets", "product_variant", "product_color", "product_material", "product_action", "product_result", "ad_style", "ad_copy", "narrative_spine",
      "project_title", "story_premise", "core_prop", "supporting_props", "destination", "opening_layout", "route_layout",
      "receiver_timing", "primary_obstacle", "emotional_arc", "character_lock", "landmark_lock", "hook_pattern",
      "knowledge_topic", "learning_goal", "target_audience", "visual_metaphor", "paper_layers", "paper_mechanism", "narration_policy",
      "source_copy", "collage_palette", "object_groups", "audio_policy",
      "brand_name", "verified_claim", "call_to_action", "brand_palette", "copy_language",
      "music_style", "master_audio", "music_window", "locked_lyrics", "typography_style", "reference_roles", "beat_map", "stitch_policy",
      "live_space", "contact_method", "drawn_entity", "center_color", "transform_chain", "chase_route", "filmer_reaction", "space_finale", "emotional_tone",
      "characters", "appearance", "scene", "scene_layout", "props", "continuity", "onscreen_text", "constraint"];
  const locked = h3GuidedPairs(fields, productNoCopy ? lockedKeys.filter((key) => key !== "ad_copy") : lockedKeys);
  const executionFields = {
    ...fields,
    structure: isOfficial3d && plan.count === 1 ? "15秒紧凑4镜因果链" : fields.structure,
    sound: h3GuidedSoundForDialogue(fields.sound, fields),
  };
  const execution = h3GuidedPairs(executionFields,
    ["genre", "focus", "structure", "pace", "camera", "transition", "sound", "music"]);
  if (isOfficialProduct && plan.count === 1) {
    const details = segmentTexts[0] && typeof segmentTexts[0] === "object" ? segmentTexts[0] : {};
    const internalShots = String(details.internal_shots || "").trim();
    const productLocks = h3GuidedPairs(fields, ["skill_source", "product_name", "source_assets", "product_variant",
      "product_color", "product_material", "product_action", "product_result"]);
    const visualLocks = h3GuidedPairs(fields, ["style", "aspect", "ad_style", "continuity"]);
    const lines = [
      `段1（${h3GuidedNumber(plan.total)}秒）：`,
      `时间范围：0–${h3GuidedNumber(plan.total)}秒。`,
      `广告目标：只围绕“${String(fields.product_name || content || "当前产品").trim()}”完成一条连续证明链，不增加第二条故事。`,
      `产品锁定：${productLocks}。`,
      `画面锁定：${visualLocks}。`,
    ];
    if (internalShots) lines.push("镜头时间表（直接执行，不再二次扩写）：", internalShots);
    lines.push(`声音：${h3GuidedSoundForDialogue(fields.sound, fields)}；无对白、无旁白、无歌词、无广播、无耳语、无咕哝、无伪语言或含混人声。`);
    if (productNoCopy) {
      lines.push(`画面文字：${String(fields.onscreen_text || "无屏幕文字、无字幕、无标题、无Logo、无品牌名称").trim()}。`);
    } else {
      lines.push(`广告文案：只在结尾显示一行“${String(fields.ad_copy || "").trim()}”，不生成其它文字、字幕、Logo、字母或数字。`);
    }
    lines.push(`禁止项：${String(fields.constraint || "不重染产品，不生成第二商品、宫格、分屏、产品墙或假Logo").trim()}。`);
    lines.push(`最后帧：${String(details.end_state || fields.product_result || "产品结果稳定清楚").trim()}。`);
    return lines.join("\n").trim();
  }
  const storyRoute = String(fields.story_route || "").trim().replace(/\s*\n+\s*/g, "；");
  const shotLanguage = String(fields.shot_language || "").trim().replace(/\s*\n+\s*/g, "；");
  const segmentDetails = (index) => {
    const raw = segmentTexts[index];
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : { action: raw };
  };
  const cleanDetail = (details, key) => String(details && details[key] || "").trim()
    .replace(/\s*\n+\s*/g, "；").replace(/[；;。\s]+$/g, "");
  const concise = (value, max = 180) => {
    const text = String(value || "").trim();
    return text.length > max ? text.slice(0, max).replace(/[；;，,、\s]+$/g, "") + "…" : text;
  };
  const output = [];
  for (const segment of plan.segments) {
    const details = segmentDetails(segment.index);
    const detail = (key) => cleanDetail(details, key);
    const internalShots = String(details && details.internal_shots || "").trim();
    const provided = detail("action");
    let stage = provided;
    if (!stage && content) {
      if (plan.count === 1) stage = content;
      else if (segment.index === 0) stage = `建立角色、场景和明确目标：${content}`;
      else if (segment.index === plan.count - 1) stage = `完成核心动作并给出清晰结果：${content}`;
      else stage = `承接上一段状态，推进一个具体动作或变化：${content}`;
    }
    if (!stage) stage = segment.index === plan.count - 1
      ? "承接上一段状态，完成核心动作并给出清晰结果"
      : "承接上一段状态，推进一个具体可见动作";
    const objective = detail("objective");
    const previousDetails = segment.index > 0 ? segmentDetails(segment.index - 1) : null;
    const nextDetails = segment.index + 1 < plan.count ? segmentDetails(segment.index + 1) : null;
    const previousDuty = concise(cleanDetail(previousDetails, "objective") || cleanDetail(previousDetails, "action")
      || cleanDetail(previousDetails, "end_state"));
    const nextDuty = concise(cleanDetail(nextDetails, "objective") || cleanDetail(nextDetails, "action"));
    let currentDuty = concise(objective || stage);
    if (isOfficial3d && plan.count === 1) {
      currentDuty = "在15秒内完成一条紧凑因果链：建立送达任务→发生一次具体失败→改变方法解决障碍→完成交接与情绪回收";
    } else if (isOfficial3d && plan.count === 2) {
      currentDuty = segment.index === 0
        ? "建立主角携带核心道具前往终点的固定路线，发生一次具体失败，并停在唯一可续接状态"
        : "从上一段失败尾帧直接继续，改变方法解决已建立障碍，完成送达和情绪回收";
    }
    output.push(`段${segment.index + 1}（${h3GuidedNumber(segment.duration)}秒）：`);
    output.push(`时间范围：${h3GuidedNumber(segment.start)}–${h3GuidedNumber(segment.end)}秒。`);
    output.push(`本段唯一职责：${currentDuty}。`);
    if (isOfficial3d) {
      if (segment.index > 0) {
        output.push("禁止重演上一段：上一生成段已经建立角色、路线和障碍；本段第一帧直接继承上一段尾帧，不重新从起点出发，不重复第一次失误。");
      }
      if (segment.index + 1 < plan.count) {
        const firstHalfBoundary = segment.index === 0 && plan.count === 2
          ? "本段在失败尾帧停住，不抵达终点、不让接收者进入近景、不交接核心道具"
          : "完成当前职责后停在清楚尾帧，不提前表演下一段的高潮、交接或收束";
        output.push(`本段边界：${firstHalfBoundary}。`);
      }
    } else {
      if (previousDuty) {
        output.push(`禁止重演上一段：上一段已经完成“${previousDuty}”；本段不得重新建立同一开场、不得重新表演同一动作链，必须从上一段结果继续。`);
      }
      if (nextDuty) output.push(`本段边界：本段只完成当前职责，不提前执行后续段“${nextDuty}”。`);
      if (storyRoute) output.push(`故事节拍：${storyRoute}。`);
      if (shotLanguage) output.push(`镜头调度：${shotLanguage}。`);
    }
    if (internalShots) output.push("内部镜头调度（本段内执行，不增加Director生成段数量）：", internalShots);
    if (narrativeTheme) output.push(`全片主题：${narrativeTheme}。`);
    if (locked) output.push(`全片锁定：${locked}。`);
    const dialogueContract = h3GuidedDialogueContract(fields, segment);
    output.push(`对白模式：${String(fields.dialogue || "无对白无旁白（纯环境声和动作音效，最稳）").trim()}。`);
    if (isH3GuidedSpeechMode(fields.dialogue)) {
      output.push(`对白语言：${String(fields.dialogue_language || "普通话（简体中文）").trim()}。`);
      output.push(`声音表演：${String(fields.voice_direction || "自然语速、口齿清楚、逐字照读").trim()}。`);
    }
    output.push(`全片对白硬约束：${dialogueContract.global}。`);
    output.push("本段对白清单：", dialogueContract.segment);
    const sceneTime = detail("scene_time");
    let startState = detail("start_state") || (segment.index > 0
      ? "严格承接上一段最后帧的角色位置、朝向、动作进度、道具状态、光线方向和摄影机方位"
      : "从本段设定的场景、角色位置和道具初始状态开始");
    if (segment.index === 0 && /上一(?:段|阶段|镜头)/.test(startState)) {
      startState = "从本段设定的场景固定布局、角色初始位置、道具初始状态、主光方向和摄影机方位开始";
    }
    const previousEndState = concise(cleanDetail(previousDetails, "end_state"));
    if (segment.index > 0 && previousEndState) {
      startState = `上一段最后帧已经是“${previousEndState}”；本段第一帧必须直接继承该画面状态。${startState}`;
    }
    const positions = detail("positions");
    const obstacle = detail("obstacle");
    const framing = detail("framing");
    const camera = detail("camera");
    const lighting = detail("lighting");
    const sound = h3GuidedSoundForDialogue(detail("sound"), fields);
    const endState = detail("end_state") || (segment.index < plan.count - 1
      ? "停在动作尚可自然继续的清晰姿态，完整保留角色位置、朝向、动作进度、道具状态、光线方向和摄影机方位"
      : "完成本段核心动作并停在信息明确、构图稳定、无花屏的收束画面");
    if (isOfficial3d && internalShots) {
      output.push(`开场承接：${startState}。`);
      if (execution) output.push(`执行基线：${execution}。`);
      output.push(`最后帧：${endState}。`, "");
      continue;
    }
    if (sceneTime) output.push(`本段场景与时间：${sceneTime}。`);
    output.push(`开场承接：${startState}。`);
    if (positions) output.push(`角色位置与朝向：${positions}。`);
    if (objective) output.push(`本段目标：${objective}。`);
    if (obstacle) output.push(`障碍与变化：${obstacle}。`);
    output.push(`本段内容：${stage}。`);
    if (provided) output.push(`具体动作链：${provided}；每一步必须显示前因、接触、受力或状态变化以及明确结果。`);
    if (framing) output.push(`景别与构图：${framing}。`);
    if (camera) output.push(`镜头运动：${camera}；主体动作先发生，摄影机再跟随，不用无目的摇晃代替动作。`);
    if (lighting) output.push(`光线与色彩：${lighting}；主光方向和色彩关系在本段内保持连续。`);
    if (sound) output.push(`同步声音：${sound}；只在可见动作发生时出现对应声音。`);
    if (execution) output.push(`本段执行：${execution}。`);
    output.push(`最后帧：${endState}。`, "");
  }
  return output.join("\n").trim();
}

function h3GuidedClock(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const hh = Math.floor(totalMs / 3600000);
  const remHours = totalMs - hh * 3600000;
  const mm = Math.floor(remHours / 60000);
  const remMinutes = remHours - mm * 60000;
  const ss = Math.floor(remMinutes / 1000);
  const ms = remMinutes - ss * 1000;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function h3GuidedCleanSentence(value, fallback = "") {
  const text = String(value || fallback || "").replace(/\s*\n+\s*/g, "；")
    .replace(/^执行已选职责\s*[:：]\s*/, "").replace(/^已完成/, "")
    .replace(/[；;。\s]+$/g, "").trim();
  return text;
}

function h3GuidedParseInternalShots(segmentTexts = [], plan = { segments: [] }) {
  const shots = [];
  const parsePairs = (body) => {
    const output = {};
    for (const part of String(body || "").split("；")) {
      const match = part.match(/^([^=]+)=([\s\S]*)$/);
      if (match) output[String(match[1] || "").trim()] = String(match[2] || "").trim();
    }
    return output;
  };
  for (const segment of plan.segments || []) {
    const details = segmentTexts[segment.index] && typeof segmentTexts[segment.index] === "object"
      ? segmentTexts[segment.index] : { action: segmentTexts[segment.index] };
    const internal = String(details && details.internal_shots || "").trim();
    for (const line of internal.split(/\n+/).map((item) => item.trim()).filter(Boolean)) {
      const head = line.match(/^内部镜头\d+（本段(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒；全片(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒）：([\s\S]*)$/);
      if (!head) continue;
      const pairs = parsePairs(String(head[5] || "").replace(/[。\s]+$/g, ""));
      shots.push({
        start: Number(head[3]), end: Number(head[4]),
        role: pairs["镜头职责"], beat: pairs["故事节拍"], direction: pairs["所选镜头语言"],
        positions: pairs["空间与角色"], framing: pairs["景别与机位"], action: pairs["动作"],
        camera: pairs["摄影机触发"], lighting: pairs["光线"], sound: pairs["同步声音"],
        result: pairs["本镜新增信息/结果"], transition: pairs["衔接"], segmentIndex: segment.index,
      });
    }
    if (!internal || !shots.some((shot) => shot.segmentIndex === segment.index)) {
      shots.push({
        start: segment.start, end: segment.end, segmentIndex: segment.index,
        role: h3GuidedCleanSentence(details.objective, segment.index ? "续接并推进下一项职责" : "建立主体、空间与主动目标"),
        positions: h3GuidedCleanSentence(details.positions),
        framing: h3GuidedCleanSentence(details.framing),
        action: h3GuidedCleanSentence(details.action, "承接当前状态，完成一个可见动作并留下明确结果"),
        camera: h3GuidedCleanSentence(details.camera), lighting: h3GuidedCleanSentence(details.lighting),
        sound: h3GuidedCleanSentence(details.sound), result: h3GuidedCleanSentence(details.end_state),
      });
    }
  }
  return shots.sort((a, b) => a.start - b.start || a.end - b.end);
}

function h3GuidedCopyContract(fields = {}) {
  const mode = String(fields.text_mode || "").trim();
  const legacy = String(fields.ad_copy || "").trim();
  const legacyNoCopy = /(?:无文案|无文字|不要文案|不显示文案|无屏幕文字|no\s*copy)/i.test(legacy);
  let copy = String(fields.ad_copy_text || "").trim();
  if (!copy && !legacyNoCopy && !/(?:3[–-]5|文案.*进入|前后两段)/.test(legacy)) copy = legacy;
  copy = copy.replace(/^(?:结尾)?只?(?:显示|保留)(?:一行)?(?:中文|英文)?文案\s*[:：]?\s*/i, "")
    .replace(/^(?:唯一中文文案|唯一英文文案)\s*[:：]?\s*/i, "").trim();
  const noCopy = mode === "无文字" || (!mode && legacyNoCopy) || (!copy && /文案/.test(mode));
  return { mode: noCopy ? "none" : (/英文|English/i.test(mode) ? "en" : "zh"), copy: noCopy ? "" : copy };
}

function h3GuidedVisualLock(fields = {}, copyContract = { mode: "none", copy: "" }) {
  const product = String(fields.product_name || "").trim();
  const isProduct = /product_ad/.test(String(fields.template_id || "")) || Boolean(product);
  const facts = [];
  if (fields.skill_source) facts.push(`创作方法来自 ${h3GuidedCleanSentence(fields.skill_source)}`);
  if (fields.style) facts.push(`视觉风格为${h3GuidedCleanSentence(fields.style)}`);
  if (fields.aspect) facts.push(`画幅为${h3GuidedCleanSentence(fields.aspect)}`);
  if (isProduct) {
    const variant = h3GuidedCleanSentence(fields.product_variant, product || "产品");
    facts.push(/全片|同一|唯一/.test(variant) ? variant : `全片只展示同一${variant}`);
    if (product) facts.push(`主体为${product}`);
    if (fields.product_category) facts.push(`类别为${h3GuidedCleanSentence(fields.product_category)}`);
    if (fields.product_color) facts.push(`真实颜色锁定为${h3GuidedCleanSentence(fields.product_color)}`);
    if (fields.product_material) facts.push(`可见材质锁定为${h3GuidedCleanSentence(fields.product_material)}`);
    if (fields.product_result) facts.push(`结果数量与状态锁定为${h3GuidedCleanSentence(fields.product_result)}`);
  } else {
    if (fields.characters) facts.push(`角色固定为${h3GuidedCleanSentence(fields.characters)}`);
    if (fields.appearance) facts.push(`外观与服装固定为${h3GuidedCleanSentence(fields.appearance)}`);
    if (fields.scene) facts.push(`主要场景为${h3GuidedCleanSentence(fields.scene)}`);
    if (fields.scene_layout) facts.push(`空间布局为${h3GuidedCleanSentence(fields.scene_layout)}`);
    if (fields.props && !/^(?:无|没有)/.test(String(fields.props))) facts.push(`固定道具为${h3GuidedCleanSentence(fields.props)}`);
  }
  if (copyContract.mode === "none") {
    facts.push("全片任何时刻不得出现屏幕文字、字幕、标题卡、字母、数字、Logo、标签、品牌名或可读字符");
  } else if (copyContract.copy) {
    facts.push(`除最后一个镜头的唯一一行“${copyContract.copy}”外，不得出现其它屏幕文字、字幕、Logo或可读字符`);
  }
  if (fields.continuity) facts.push(h3GuidedCleanSentence(fields.continuity));
  if (fields.final_state) facts.push(`最终收束状态锁定为${h3GuidedCleanSentence(fields.final_state)}`);
  if (fields.constraint) facts.push(h3GuidedCleanSentence(fields.constraint));
  return facts.filter(Boolean).join("；");
}

/**
 * 将30套逐步填写模板统一编译为可直接解析的官方 Base：完整三字段、后续 Shot
 * 使用全片绝对时间，长片由官方解析器按 Shot 边界局部化为不超过15秒的生成段。
 * 本函数纯本地执行，不调用 AI。
 */
export function buildH3GuidedDirectorScript(fields = {}, segmentTexts = []) {
  const plan = planH3GuidedSegments(fields.duration || "15秒");
  const shots = h3GuidedParseInternalShots(segmentTexts, plan);
  const finalState = h3GuidedCleanSentence(fields.final_state);
  if (finalState && shots.length) shots[shots.length - 1].result = finalState;
  const copyContract = h3GuidedCopyContract(fields);
  const visualLock = h3GuidedVisualLock(fields, copyContract);
  const dialogueBySegment = new Map(plan.segments.map((segment) => [segment.index,
    h3GuidedDialogueContract(fields, segment)]));
  const shotLines = shots.map((shot, index) => {
    const pieces = [];
    const isFirstShotInSegment = !shots.slice(0, index).some((item) => item.segmentIndex === shot.segmentIndex);
    if (isFirstShotInSegment) {
      pieces.push(index === 0 ? `全片锁定：${visualLock}` : `本生成段继续保持全片锁定：${visualLock}`);
    }
    if (isFirstShotInSegment && shot.segmentIndex > 0) {
      pieces.push("第一帧直接从上一生成段最后帧继续：主体身份、数量、位置、朝向、动作进度、道具状态、光位和摄影机轴线不变；不重演开场或上一段动作");
    }
    const role = h3GuidedCleanSentence(shot.role);
    const positions = h3GuidedCleanSentence(shot.positions);
    if (role && positions) pieces.push(`${role}：${positions}`);
    else if (role) pieces.push(role);
    else if (positions) pieces.push(positions);
    const action = h3GuidedCleanSentence(shot.action, shot.beat || "完成当前可见动作");
    if (action) pieces.push(`画面动作：${action}`);
    const camera = [h3GuidedCleanSentence(shot.framing), h3GuidedCleanSentence(shot.camera)]
      .filter(Boolean).join("；");
    if (camera) pieces.push(`镜头在动作发生后响应：${camera}`);
    if (shot.lighting) pieces.push(`光线：${h3GuidedCleanSentence(shot.lighting)}`);
    if (shot.result) pieces.push(`画面结束时：${h3GuidedCleanSentence(shot.result)}`);
    if (shot.transition && index + 1 < shots.length) pieces.push(`下一镜由画面内事件触发：${h3GuidedCleanSentence(shot.transition)}`);
    const segmentContract = dialogueBySegment.get(shot.segmentIndex);
    const soundParts = [];
    if (shot.sound) soundParts.push(h3GuidedCleanSentence(shot.sound));
    if (isFirstShotInSegment && segmentContract && segmentContract.segment) {
      pieces.push(`对白与人声：${h3GuidedCleanSentence(fields.dialogue, "无对白无旁白（纯环境声和动作音效，最稳）")}；${h3GuidedCleanSentence(segmentContract.global)}`);
      soundParts.push(h3GuidedCleanSentence(segmentContract.segment));
    }
    if (soundParts.length) pieces.push(`同步声音：${soundParts.join("；")}`);
    const isFinalShot = index + 1 === shots.length;
    if (isFinalShot && copyContract.mode !== "none" && copyContract.copy) {
      pieces.push(`最后安全留白中只显示唯一一行精确文案“${copyContract.copy}”，保持单行、清楚可读，不改写、不翻译、不增加第二行`);
    }
    const prefix = index === 0 ? `[Shot 1]` : `[Shot ${index + 1}] At ${h3GuidedClock(shot.start)},`;
    return `${prefix} ${pieces.filter(Boolean).join("。")}。`;
  });
  if (!shotLines.length) {
    shotLines.push(`[Shot 1] 全片锁定：${visualLock}。画面动作：${h3GuidedCleanSentence(fields.content, "主体完成一个清楚动作并稳定停下")}。`);
  }
  const dialogueGlobal = h3GuidedDialogueContract(fields, plan.segments[0] || { start: 0, end: plan.total }).global;
  const overallSoundscape = [
    "每个声音只在对应可见动作发生时出现；环境底噪跨镜连续，接触、受力、材质、脚步、机械或界面声音按画面物理顺序同步",
    h3GuidedCleanSentence(fields.sound), h3GuidedCleanSentence(dialogueGlobal),
    "不得提前播放后续镜头的角色、场景、动作或声音",
  ].filter(Boolean).join("；") + "。";
  const music = h3GuidedCleanSentence(fields.music);
  const nonDiegeticMusic = !music || /^(?:无配乐|无背景音乐|N\/?A)/i.test(music)
    || /(?:可不使用配乐|如使用)/.test(music)
    ? "N/A" : `${music}；只使用一条连续非叙事音乐，人声或关键动作声出现时自动压低，不得生成歌词或第二主音轨。`;
  return [
    "integrated_multimodal_description:", shotLines.join("\n"), "",
    "overall_soundscape:", overallSoundscape, "",
    "non_diegetic_music:", nonDiegeticMusic, "",
    "director_import_manifest:", "format_version: 2",
    `source_total_duration_seconds: ${h3GuidedNumber(plan.total)}`, "duration_policy: preserve",
  ].join("\n").trim();
}

/** 只替换用户框选的范围；周围文本在任何情况下都保持逐字符不变。 */
export function replaceH3SelectedRange(value, startValue, endValue, replacement) {
  const text = String(value || "");
  const start = Math.max(0, Math.min(text.length, Number(startValue) || 0));
  const end = Math.max(start, Math.min(text.length, Number(endValue) || 0));
  const inserted = String(replacement || "");
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    start,
    end: start + inserted.length,
  };
}

/* 三份用户参考样例只提供“写法与镜头语法”，最终生成仍须服从官方 Base/Ref2VA
   字段。这里按用户真正选中的条件追加专项执行规则，避免每次把整份案例塞给 API，
   也防止案例人物、地点、品牌和具体剧情串入新项目。 */
export function buildH3ReferencePromptGuidance(value) {
  const text = String(value || "");
  const rules = [];
  const add = (rule) => { if (rule && !rules.includes(rule)) rules.push(rule); };

  if (/平面赛璐璐\s*[+＋与和]\s*抽象动态图形|抽象运动图形|abstract motion[- ]?graphics/i.test(text)) {
    add("平面赛璐璐+抽象动态图形：整幅画面保持二维平涂、有限高对比色和图形化构图；用色块、线段、UI轨迹、几何分解/重组承接动作和转场，不要退化成写实街景、PBR材质或仅给局部叠加特效。");
  }
  if (/实拍\s*[+＋与和]\s*手绘发光(?:涂鸦|动画)|手绘发光涂鸦融合|handdrawn live/i.test(text)) {
    add("实拍+手绘发光涂鸦融合：实拍环境、透视和自然光保持稳定；手绘层必须有逐帧线条抖动、颗粒和手工重画感。连续变形时每一形态保留前一形态的轮廓痕迹，明确它是同一存在，不得变成新角色、精密3DCG或平滑霓虹管。");
  }
  if (/写实动作大片预告|真人动作大片|超级英雄动作预告|live-action action blockbuster/i.test(text)) {
    add("写实动作大片预告：动作遵守重力、惯性、接触与受力结果；每次切镜都延续角色位置、速度和运动方向，运镜服务于可见动作而不是用模糊、摇晃或无因果爆炸替代动作。不得复制参考案例中的角色、品牌、城市或商业Logo。");
  }
  if (/同一(?:场景|物体)?连续变形|形态连续变形|保留(?:前一|上一)形态痕迹|不凭空换角色/i.test(text)) {
    add("连续变形：为主体建立至少一个始终不丢失的颜色、轮廓、纹理或道具锚点；每次变化写出上一状态→可见中间变化→下一状态，不允许旧形态消失后新对象凭空出现。");
  }
  if (/手机手持迟滞追拍|手持镜头慢半拍|相机跟随动作不提前构图/i.test(text)) {
    add("迟滞手持追拍：主体动作先发生，相机随后小幅平移、俯仰或追赶；保留合理的手持抖动、短暂失焦和运动模糊，但主体关键动作仍须清楚可读，不能变成持续花屏。");
  }
  if (/快速切镜但动作连续|高速动作跟拍|快速切镜连续动势/i.test(text)) {
    add("快速动作剪辑：每个Shot只承担一个主要动作或新信息；切点前后必须对齐动作姿态、屏幕方位、运动矢量和受力结果，避免用互不相干的漂亮镜头堆砌。");
  }
  if (/不切场景连续过渡|单场景连续变化|单镜头连续运动/i.test(text)) {
    add("单场景连续路线：保持同一空间地标和相对方位，用摄影机运动、遮挡、光线或主体形态变化推进，不得偷偷硬切到另一个地点。");
  }
  if (/真实环境音\s*[+＋与和]\s*动作同步音效|仅环境音不配乐/i.test(text)) {
    add("声音采用可见即有声的同步原则：环境底噪持续，脚步、接触、变形、按钮、撞击等具体声音写在对应Shot；overall_soundscape只做全片归纳，不重复对白。若选择仅环境音不配乐，non_diegetic_music必须为N/A。");
  }
  if (/无背景音乐|不使用背景音乐|配乐\s*[:：]\s*(?:无|N\/?A)/i.test(text)) {
    add("用户明确不要背景音乐：non_diegetic_music必须写N/A，不能用氛围音乐、预告配乐或自动BGM替代。");
  }
  if (/无屏幕文字和字幕|不出现随机文字|只保留用户指定文字/i.test(text)) {
    add("画面文字严格闭集：只允许用户明确给出的文字并保持原文和标点；选择无屏幕文字时，不生成字幕、标题、UI文案、Logo、水印或片尾字卡。");
  }

  if (!rules.length) return "";
  return "本次参考样例专项执行规则（只借鉴方法，不复制案例内容；最终仍输出官方H3字段）：\n- "
    + rules.join("\n- ");
}

/* “无对白无旁白”是用户的确定性契约。部分 API 模型即使收到禁止指令仍会
   擅自补一句台词；这类内容不应触发第二次付费修复调用，而应先在本地剥离，
   再让现有时长、结构、动作和官方字段门禁继续检查。 */
const H3_STORY_METADATA_LINE_RE = /^(?:目标总时长|硬时间与风格约束|创作要求|内容|全片主题|全片锁定|全片对白硬约束|本段对白清单|本段对白|对白模式|对白语言|精确台词|声音表演|导演设计|故事节拍|镜头调度|内部镜头调度(?:（[^）]*）)?|内部镜头\d+\s*[（(][^）)]*[）)]|本段唯一职责|本段边界|禁止重演上一段|本段内容|本段执行|时间范围|本段场景与时间|开场承接|角色位置与朝向|本段目标|障碍与变化|具体动作链|景别与构图|镜头运动|光线与色彩|同步声音|最后帧|角色|角色外观\/服装|人物设定|角色设定|场景固定布局|道具\/装备|主体|画面风格|视觉风格|美术风格|画面质感|视觉效果|色彩|配色|集数\s*\/\s*标题|集数|标题|场次编号|场次起止时间|场景与时间|出场人物|画幅|类型|风格|节奏|运镜|重点|镜头结构|转场|声音|配乐|连续性|画面文字|限制|integrated_multimodal_description|overall_soundscape|non_diegetic_music|director_import_manifest)\s*[:：]/i;
const H3_STORY_NONSPEECH_LABEL_RE = /^(?:环境音|场景音|音效|声音|声效|拟音|音乐|配乐|镜头|运镜|构图|光线|灯光|动作|转场|道具|场景说明)\s*[:：]/i;
const H3_INLINE_SPEECH_RE = /(?:[A-Za-z0-9_\u3400-\u9fff·（）()]{1,24}\s*)?(?:说道|说|问道|问|喊道|喊|回答|答道|低语|耳语|旁白|画外音|内心独白|解说)\s*[:：，,]?\s*[“"]([^”"\n]{1,1000})[”"]/gi;
const H3_ENGLISH_TAGGED_SPEECH_RE = /(?:(?:The|A|An)\s+[A-Za-z][A-Za-z0-9 '’_-]{0,80}?\s+)(?:says in an off-screen voiceover|says|asks|shouts|whispers|replies|speaks|sings|calls out|narrates)\s*[:：]?\s*<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi;
const H3_CHINESE_TAGGED_SPEECH_RE = /[A-Za-z0-9_\u3400-\u9fff·（）()]{1,30}(?:以[^，。！？\n]{0,30})?(?:说道|说|问道|问|喊道|喊|回答|答道|低语|耳语|旁白|画外音|内心独白|解说)\s*[:：，,]?\s*<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi;

export function isH3StoryDialogueLine(value) {
  const line = String(value || "").trim();
  if (!line || H3_STORY_METADATA_LINE_RE.test(line)
    || H3_STORY_NONSPEECH_LABEL_RE.test(line)
    || /^[-*]\s*(?:\d|[A-Za-z_]+\s*[:：])/.test(line)
    || /^△/.test(line)) return false;
  H3_INLINE_SPEECH_RE.lastIndex = 0;
  const inlineSpeech = H3_INLINE_SPEECH_RE.test(line);
  H3_INLINE_SPEECH_RE.lastIndex = 0;
  return /^[^\n:：]{1,18}\s*[:：]\s*\S+/.test(line) || inlineSpeech;
}

function stripInlineForbiddenSpeech(value) {
  let removed = 0;
  let text = String(value || "");
  text = text.replace(H3_ENGLISH_TAGGED_SPEECH_RE, () => { removed++; return ""; });
  text = text.replace(H3_CHINESE_TAGGED_SPEECH_RE, () => { removed++; return ""; });
  text = text.replace(/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi, () => { removed++; return ""; });
  H3_INLINE_SPEECH_RE.lastIndex = 0;
  text = text.replace(H3_INLINE_SPEECH_RE, () => { removed++; return ""; });
  return {
    text: text.replace(/[ \t]{2,}/g, " ").replace(/\s+([，。；！？,.!?;])/g, "$1")
      .replace(/([:：，,])\s*([。！？.!?])/g, "$2").trimEnd(),
    removed,
  };
}

export function stripForbiddenH3StoryDialogue(value) {
  const input = String(value || "");
  const output = [];
  let removed = 0;
  for (const rawLine of input.split(/\r?\n/)) {
    if (isH3StoryDialogueLine(rawLine)) { removed++; continue; }
    const cleaned = stripInlineForbiddenSpeech(rawLine);
    removed += cleaned.removed;
    const visible = cleaned.text.trim();
    if (!visible || /^△\s*[，,。；;:：-]*\s*$/.test(visible)) {
      if (rawLine.trim()) continue;
    }
    output.push(cleaned.text);
  }
  return { text: output.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

function stripDialogueSentencesFromShotBody(value) {
  const initial = stripInlineForbiddenSpeech(value);
  const body = initial.text;
  const chunks = body.match(/[^.!?。！？]*(?:[.!?。！？]+|$)/g) || [body];
  const kept = [];
  let removed = initial.removed;
  for (const chunk of chunks) {
    if (!chunk) continue;
    if (/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/i.test(chunk)) { removed++; continue; }
    kept.push(chunk);
  }
  const fallback = stripInlineForbiddenSpeech(kept.join(""));
  return { text: fallback.text, removed: removed + fallback.removed };
}

export function stripForbiddenH3OfficialDialogue(value) {
  const text = String(value || "");
  const shotRe = /\[Shot\s+\d+\](?:\s+At\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\s*,\s*)?/gi;
  const shots = [...text.matchAll(shotRe)];
  if (!shots.length) return stripInlineForbiddenSpeech(text);
  let output = text.slice(0, shots[0].index);
  let removed = 0;
  for (let index = 0; index < shots.length; index++) {
    const match = shots[index];
    const bodyStart = match.index + match[0].length;
    const bodyEnd = index + 1 < shots.length ? shots[index + 1].index : text.length;
    const cleaned = stripDialogueSentencesFromShotBody(text.slice(bodyStart, bodyEnd));
    const separator = index + 1 < shots.length && cleaned.text && !/\s$/.test(cleaned.text) ? " " : "";
    output += match[0] + cleaned.text + separator;
    removed += cleaned.removed;
  }
  return { text: output.replace(/\n{3,}/g, "\n\n").trim(), removed };
}

export function normalizeAssetType(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["character", "role", "人物", "角色"].includes(key)) return "character";
  if (["prop", "item", "object", "物品", "道具"].includes(key)) return "prop";
  if (["scene", "environment", "background", "场景", "环境"].includes(key)) return "scene";
  return "general";
}

export function normalizeAssetName(value) {
  let text = String(value || "").toLowerCase();
  try { text = text.normalize("NFKC"); } catch (e) { /* 旧浏览器 */ }
  return text.replace(/[\s_\-—–·•,，。:：;；()（）\[\]【】"'“”‘’]/g, "");
}

/** 读取剧本/全局提示词中的最终画幅契约。只处理生产画幅，不把镜头构图词当作契约。 */
export function detectAspectRatioContract(value) {
  const original = String(value || "");
  if (!original.trim()) return { orientation: "", targetRatio: 0, ambiguous: false, signals: [] };
  const negated = String.raw`(?:不要|不得|禁止|避免|并非|不是|非|no|not)\s*(?:使用|采用|输出|做成|设为|切成|要)?\s*`;
  const source = original
    .replace(new RegExp(negated + String.raw`(?:9\s*[:：]\s*16|竖屏|portrait)`, "gi"), " ")
    .replace(new RegExp(negated + String.raw`(?:16\s*[:：]\s*9|横屏|landscape|widescreen)`, "gi"), " ");
  /* “横向跟随 / 纵向构图”是镜头语言，不是成片比例；没有画幅上下文时绝不采纳。 */
  const portraitRatio = /9\s*[:：]\s*16/i.test(source);
  const landscapeRatio = /16\s*[:：]\s*9/i.test(source);
  const portrait = portraitRatio || /竖屏|portrait/i.test(source)
    || /(?:画幅|成片|输出|视频(?:比例|画面)?)[^\n，。；:：]{0,12}纵向|纵向[^\n，。；:：]{0,12}(?:画幅|成片|输出|视频比例)/i.test(source);
  const landscape = landscapeRatio || /横屏|landscape|widescreen/i.test(source)
    || /(?:画幅|成片|输出|视频(?:比例|画面)?)[^\n，。；:：]{0,12}横向|横向[^\n，。；:：]{0,12}(?:画幅|成片|输出|视频比例)/i.test(source);
  const signals = [];
  if (portrait) signals.push(/9\s*[:：]\s*16/i.test(source) ? "9:16" : "竖屏");
  if (landscape) signals.push(/16\s*[:：]\s*9/i.test(source) ? "16:9" : "横屏");
  return {
    orientation: portrait === landscape ? "" : portrait ? "portrait" : "landscape",
    targetRatio: portrait === landscape ? 0 : portraitRatio ? 9 / 16 : landscapeRatio ? 16 / 9 : 0,
    ambiguous: portrait && landscape,
    signals,
  };
}

/** 对比文本契约与真正送入工作流的宽高；返回 null 表示未声明或没有可比尺寸。 */
export function validateAspectRatioContract(contract, width, height) {
  const spec = contract || {};
  if (spec.ambiguous) {
    return { code: "aspect_contract_ambiguous", message: "脚本同时声明了竖屏 9:16 和横屏 16:9，无法确定最终生产画幅。" };
  }
  if (!spec.orientation) return null;
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!(w > 0 && h > 0)) return null;
  const actualOrientation = w < h ? "portrait" : w > h ? "landscape" : "square";
  const expectedLabel = spec.orientation === "portrait" ? "竖屏 9:16" : "横屏 16:9";
  if (actualOrientation !== spec.orientation) {
    return {
      code: "aspect_orientation_mismatch",
      message: `脚本要求${expectedLabel}，但真实工作流尺寸为 ${w}×${h}（${actualOrientation === "portrait" ? "竖屏" : actualOrientation === "landscape" ? "横屏" : "方形"}）。`,
    };
  }
  const actualRatio = w / h;
  if (spec.targetRatio > 0 && Math.abs(actualRatio - spec.targetRatio) / spec.targetRatio > 0.06) {
    return {
      code: "aspect_ratio_mismatch",
      message: `脚本要求${expectedLabel}，但真实工作流尺寸 ${w}×${h} 的比例不匹配。`,
    };
  }
  return null;
}

/** 检测一个短生成段是否错误携带了整片总时长/绝对时间范围。 */
export function detectProjectTimelineLeak(prompt, segmentDuration) {
  const text = String(prompt || "");
  const duration = Number(segmentDuration) || 0;
  if (!text.trim() || !(duration > 0)) return null;
  const tolerance = Math.max(0.75, duration * 0.08);
  const declared = text.match(/(?:目标|计划|要求|成片|视频|全片|故事|剧本)?\s*(?:总)?时长\s*[:：为是]?\s*(\d+(?:\.\d+)?)\s*秒/i);
  if (declared && Number(declared[1]) > duration + tolerance) {
    return {
      declaredDuration: Number(declared[1]),
      message: `本段只有 ${duration.toFixed(1)} 秒，但提示词仍携带全片 ${Number(declared[1]).toFixed(1)} 秒约束。`,
    };
  }
  const ranges = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[-—–~～至到]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/gi)) {
    ranges.push({ start: Number(match[1]), end: Number(match[2]) });
  }
  for (const match of text.matchAll(/((?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\s*[-—–~～至到]\s*((?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)/g)) {
    const start = parseOfficialClock(match[1]);
    const end = parseOfficialClock(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end });
  }
  const leakedRange = ranges.find((range) => range.end - range.start > duration + tolerance);
  return leakedRange == null ? null : {
    declaredDuration: leakedRange.end,
    message: `本段只有 ${duration.toFixed(1)} 秒，但提示词含有跨度 ${(leakedRange.end - leakedRange.start).toFixed(1)} 秒的全片时间范围（${leakedRange.start.toFixed(1)}–${leakedRange.end.toFixed(1)} 秒）。`,
  };
}

/**
 * 把导演台参考资产整理成可安全发送给文本 API 的目录。
 * 只包含稳定 ID、类型和用户确认后的名称；绝不包含本地文件名或磁盘路径。
 */
export function formatAssetPromptContext(catalog) {
  const groups = { character: [], scene: [], prop: [], general: [] };
  const seen = new Set();
  for (const raw of catalog || []) {
    const type = normalizeAssetType(raw && raw.type);
    const name = String(raw && raw.name || "").trim();
    if (!name) continue;
    const key = type + ":" + normalizeAssetName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const fallbackId = H3_ASSET_TYPES[type].prefix + (groups[type].length + 1);
    const assetId = String(raw && raw.asset_id || fallbackId).trim() || fallbackId;
    groups[type].push(`@${assetId}（${name}）`);
  }
  const lines = [
    ["角色", groups.character],
    ["场景", groups.scene],
    ["道具", groups.prop],
    ["通用参考", groups.general],
  ].filter(([, items]) => items.length)
    .map(([label, items]) => `${label}：${items.join("；")}`);
  return lines.length ? lines.join("\n") : "（参考资产库为空）";
}

function restoreH3AssetMentionRegion(value, catalog) {
  const text = String(value || "");
  const byId = new Map();
  const nameCounts = new Map();
  for (const raw of catalog || []) {
    const assetId = String(raw && raw.asset_id || "").trim().toUpperCase();
    const name = String(raw && raw.name || "").trim();
    if (!/^[CSPG]\d+$/.test(assetId) || !name) continue;
    if (!byId.has(assetId)) byId.set(assetId, { asset_id: assetId, name });
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  if (!byId.size) return text;

  const protectedParts = [];
  const protect = (content) => {
    const token = `\u0000H3ASSET${protectedParts.length}\u0000`;
    protectedParts.push(String(content || ""));
    return token;
  };
  let restored = text.replace(/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/gi, protect);
  restored = restored.replace(/[@＠]([CSPG]\d+)(?:\s*[（(]([^）)\r\n]+)[）)])?/gi,
    (match, rawId) => {
      const asset = byId.get(String(rawId || "").toUpperCase());
      return protect(asset ? `@${asset.asset_id}（${asset.name}）` : match);
    });

  const uniqueByName = new Map();
  for (const asset of byId.values()) {
    if (asset.name.length >= 2 && nameCounts.get(asset.name) === 1) uniqueByName.set(asset.name, asset);
  }
  const names = [...uniqueByName.keys()].sort((left, right) => right.length - left.length);
  if (names.length) {
    const exactName = new RegExp(names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    restored = restored.replace(exactName, (name) => {
      const asset = uniqueByName.get(name);
      return protect(`@${asset.asset_id}（${asset.name}）`);
    });
  }
  return restored.replace(/\u0000H3ASSET(\d+)\u0000/g,
    (match, index) => protectedParts[Number(index)] == null ? match : protectedParts[Number(index)]);
}

/**
 * 恢复文本 API 偶发删掉的可见资产锚点。只按唯一完整名称恢复，不猜别名、不处理
 * 单字名称；官方分镜只改视觉 Shot 字段，避免把资产标记写进对白或声音字段。
 */
export function restoreH3AssetMentions(value, catalog, { official = false } = {}) {
  const text = String(value || "");
  if (official) {
    const start = /(?:^|\n)\s*integrated_multimodal_description\s*[:：]\s*/i.exec(text);
    if (!start) return text;
    const bodyStart = start.index + start[0].length;
    const tail = /\n\s*overall_soundscape\s*[:：]/i.exec(text.slice(bodyStart));
    const bodyEnd = tail ? bodyStart + tail.index : text.length;
    return text.slice(0, bodyStart)
      + restoreH3AssetMentionRegion(text.slice(bodyStart, bodyEnd), catalog)
      + text.slice(bodyEnd);
  }
  return text.split(/(\r?\n)/).map((line) => {
    if (/^\s*(?:场景与时间|出场人物|△|人物分析|场景分析)\s*[:：]?/i.test(line)) {
      return restoreH3AssetMentionRegion(line, catalog);
    }
    return line;
  }).join("");
}

function stripMarkdownFence(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/^[ \t]*`{3}(?:text|txt|markdown|md)?[ \t]*$/gim, "")
    .trim();
}

const OFFICIAL_CLOCK_TOKEN = String.raw`(?:(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?|\d+(?:\.\d+)?\s*s)`;

function parseOfficialClock(value) {
  const text = String(value || "").trim();
  const seconds = text.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (seconds) return Number(seconds[1]);
  const parts = text.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const sec = Number(parts.pop());
  const min = Number(parts.pop());
  const hour = parts.length ? Number(parts.pop()) : 0;
  if (![hour, min, sec].every(Number.isFinite) || min < 0 || sec < 0 || sec >= 60) return null;
  return hour * 3600 + min * 60 + sec;
}

/**
 * 解析并移除官方 Shot 正文开头的时间前缀。
 * 兼容正确格式 `At 00:00:03.000, ...`，也兼容 AI 常生成的重复范围：
 * `At 00:00:03.000, 00:00:03.000—00:00:06.000 ...`。
 * 返回的 body 已去掉时间范围，便于重新输出为唯一的官方 At 时间轴。
 */
export function parseOfficialShotPrefix(value) {
  let body = String(value || "").trim();
  let start = null;
  let rangeStart = null;
  let rangeEnd = null;
  let hadAt = false;
  let hadRange = false;

  const atRe = new RegExp(`^[\\s,，]*At\\s+(${OFFICIAL_CLOCK_TOKEN})\\s*[,，]?\\s*`, "i");
  const at = body.match(atRe);
  if (at) {
    hadAt = true;
    start = parseOfficialClock(at[1]);
    body = body.slice(at[0].length).trim();
  }

  const rangeRe = new RegExp(`^[\\s,，]*(?:[（(]\\s*)?(${OFFICIAL_CLOCK_TOKEN})\\s*(?:-|—|–|~|～|to|至|到)\\s*(${OFFICIAL_CLOCK_TOKEN})(?:\\s*[）)])?\\s*[,，:：-]?\\s*`, "i");
  const range = body.match(rangeRe);
  if (range) {
    hadRange = true;
    rangeStart = parseOfficialClock(range[1]);
    rangeEnd = parseOfficialClock(range[2]);
    if (start == null) start = rangeStart;
    body = body.slice(range[0].length).trim();
  }

  return { body, start, rangeStart, rangeEnd, hadAt, hadRange };
}

function styleProfile(value) {
  const text = String(value || "");
  return {
    threeD: /(?:\b3d\b|three[ -]?dimensional|三维|三维动画|3D)/i.test(text),
    twoD: /(?:\b2d\b|two[ -]?dimensional|二维|平面动画|2D)/i.test(text),
    pixel: /(?:pixel(?:[ -]?art)?|8[ -]?bit|16[ -]?bit|像素|点阵)/i.test(text),
    live: /(?:live[ -]?action|photo[ -]?real(?:istic)?|photographic|真人|照片级写实|实拍)/i.test(text),
    animation: /(?:anime|animation|cartoon|toon|二次元|动画|卡通)/i.test(text),
    day: /(?:broad daylight|daytime|sunlit|白天|日间|阳光明媚)/i.test(text),
    night: /(?:nighttime|at night|moonlit|夜晚|夜间|月光)/i.test(text),
  };
}

const H3_STYLE_KEYS = Object.freeze(["threeD", "twoD", "pixel", "live", "animation", "day", "night"]);
const H3_STYLE_LABELS = Object.freeze({
  threeD: "3D",
  twoD: "2D",
  pixel: "像素",
  live: "真人/写实",
  animation: "动画",
  day: "白天",
  night: "夜晚",
});

function activeStyleProfile(value) {
  /* “不得出现 3D / no 3D models”是目标风格的排除规则，不能反过来被识别为
     当前仍在使用 3D。先移除紧邻否定词的风格短语，再做主动风格分类。 */
  const text = String(value || "")
    .replace(/(?:no|without|never|not|禁止|不得|不能|不再|不出现|不存在|没有|避免|去除)[^。！？；;,.，\n]{0,32}(?:\b3d\b|three[ -]?dimensional|三维(?:动画|渲染|模型)?|\b2d\b|two[ -]?dimensional|二维|pixel(?:[ -]?art)?|8[ -]?bit|16[ -]?bit|像素|live[ -]?action|photo[ -]?real(?:istic)?|photographic|真人|实拍|anime|animation|cartoon|toon|二次元|动画|卡通|daytime|sunlit|白天|日间|nighttime|moonlit|夜晚|夜间)/gi, " ");
  return styleProfile(text);
}

function styleRequirements(value) {
  /* 提取“必须是什么”时也必须尊重否定词。否则“完整 2D 像素风，
     不保留 3D/PBR”会被错误提取成同时要求 2D、像素和 3D。 */
  const profile = activeStyleProfile(value);
  const required = {};
  if (profile.threeD) required.threeD = true;
  if (profile.twoD) required.twoD = true;
  if (profile.pixel) required.pixel = true;
  if (profile.live) required.live = true;
  if (profile.animation && !profile.threeD && !profile.twoD && !profile.pixel) required.animation = true;
  if (profile.day) required.day = true;
  if (profile.night) required.night = true;
  return required;
}

function styleKeys(record) {
  return H3_STYLE_KEYS.filter((key) => !!(record && record[key]));
}

function styleLabel(record) {
  const keys = styleKeys(record);
  return keys.length ? keys.map((key) => H3_STYLE_LABELS[key] || key).join("+") : "未声明风格";
}

function styleForbiddenBy(required, otherRequired) {
  const forbidden = {};
  if (required.threeD && (otherRequired.twoD || otherRequired.pixel)) {
    if (otherRequired.twoD) forbidden.twoD = true;
    if (otherRequired.pixel) forbidden.pixel = true;
  }
  if ((required.twoD || required.pixel) && otherRequired.threeD) forbidden.threeD = true;
  if (required.live && (otherRequired.animation || otherRequired.pixel)) {
    if (otherRequired.animation) forbidden.animation = true;
    if (otherRequired.pixel) forbidden.pixel = true;
  }
  if ((required.animation || required.pixel) && otherRequired.live) forbidden.live = true;
  if (required.day && otherRequired.night) forbidden.night = true;
  if (required.night && otherRequired.day) forbidden.day = true;
  return forbidden;
}

function extractExplicitTotalDuration(value) {
  const text = String(value || "");
  const patterns = [
    /(?:source_total_duration_seconds|target_total_duration_seconds|源总时长秒|目标总时长秒)\s*[:：=]\s*(\d+(?:\.\d+)?)/i,
    /(?:目标|计划|要求|成片|视频|全片|故事|剧本)?\s*(?:总)?时长\s*[:：为是]?\s*(\d+(?:\.\d+)?)\s*秒/i,
    /(?:生成|制作|创建|做成|写成)(?:一个|一段|一条|约)?\s*(\d+(?:\.\d+)?)\s*秒/i,
    /(\d+(?:\.\d+)?)\s*秒(?:钟)?(?:的)?\s*(?:视频|动画|短片|短剧|预告片|片段|游戏动画|故事)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const duration = match ? Number(match[1]) : 0;
    if (duration > 0) return duration;
  }
  return 0;
}

function addTimelineSpan(spans, start, end, required, source, wholeFrame = false) {
  const a = Number(start);
  const b = Number(end);
  const keys = styleKeys(required);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a) || !keys.length) return;
  const duplicate = spans.find((item) => Math.abs(item.start - a) < 0.01 && Math.abs(item.end - b) < 0.01);
  if (duplicate) {
    keys.forEach((key) => { duplicate.required[key] = true; });
    duplicate.wholeFrame = duplicate.wholeFrame || wholeFrame;
    return;
  }
  spans.push({ start: a, end: b, required: { ...required }, forbidden: {}, source: String(source || "").trim(), wholeFrame });
}

/**
 * 从用户原文、中文剧本或 Director manifest 中提取明确的时间/风格硬契约。
 * 没有明确时间表达时绝不凭空创建“15 秒切换”规则。
 */
export function extractH3TimelineStyleContract(value) {
  const text = String(value || "").replace(/\r/g, "");
  let sourceDuration = extractExplicitTotalDuration(text);
  const spans = [];

  /* Director 写回的机器可读规则优先；它位于官方字段之后，不会被送进 H3。 */
  for (const match of text.matchAll(/hard_style_phase_\d+\s*[:：]\s*(\d+(?:\.\d+)?)\s*[-—–~～]\s*(\d+(?:\.\d+)?)\s*s?\s*\|\s*required\s*=\s*([^|\n]+)(?:\|\s*forbidden\s*=\s*([^\n]+))?/gi)) {
    const required = {};
    const forbidden = {};
    String(match[3] || "").split(/[,，+]/).map((item) => item.trim()).forEach((key) => {
      if (H3_STYLE_KEYS.includes(key)) required[key] = true;
    });
    String(match[4] || "").split(/[,，+]/).map((item) => item.trim()).forEach((key) => {
      if (H3_STYLE_KEYS.includes(key)) forbidden[key] = true;
    });
    addTimelineSpan(spans, Number(match[1]), Number(match[2]), required, match[0], required.pixel && required.twoD);
    const added = spans.find((item) => Math.abs(item.start - Number(match[1])) < 0.01
      && Math.abs(item.end - Number(match[2])) < 0.01);
    if (added) Object.assign(added.forbidden, forbidden);
  }
  const hasMachineStylePhases = spans.length > 0;

  /* AI 故事稿已经带有专用硬约束区时，只从该区读取人类可读范围，避免把
     后面的每个普通场次都升级成新的用户硬契约。 */
  const hardSection = text.match(/硬时间(?:与|\/)?风格约束\s*[:：]([\s\S]*?)(?=\n\s*(?:集数|标题|场次\s*(?:编号|\d)|第\s*\d+\s*场)|$)/i);
  /* hard_style_phase_N 是导演台已经确定并写回的权威规则。存在机器规则时，
     不再从每个 Shot 正文的普通时间范围重复推导硬阶段；否则 15–30 秒规则会
     与 15–20/20–25/25–30 的描述重复，且“不要 3D”等排除句也可能污染契约。 */
  const scanText = hasMachineStylePhases ? "" : (hardSection ? hardSection[1] : text);

  const rawBefore = [];
  const rawAfter = [];
  const wholeFrameHint = (snippet) => /(?:风格|画面|整个|全画面|完整|原生|render|style|entire|whole)/i.test(snippet);
  const addFromSnippet = (start, end, snippet) => {
    const required = styleRequirements(snippet);
    addTimelineSpan(spans, start, end, required, snippet, wholeFrameHint(snippet));
  };

  /* 0–15 秒 / 0秒到15秒 / 0-15s。限制同一行或同一短句，避免吞掉后续阶段。 */
  for (const match of scanText.matchAll(/(\d+(?:\.\d+)?)[ \t]*(?:秒|s)?[ \t]*(?:-|—|–|~|～|至|到)[ \t]*(\d+(?:\.\d+)?)[ \t]*(?:秒|s)[ \t]*[:：,，]?[ \t]*([^。！？；;\n]{0,120})/gi)) {
    addFromSnippet(Number(match[1]), Number(match[2]), match[3]);
    sourceDuration = Math.max(sourceDuration, Number(match[2]) || 0);
  }

  for (const match of scanText.matchAll(/(?:前|开头|最初)\s*(\d+(?:\.\d+)?)\s*秒(?:内|期间|部分)?\s*([^，。！？；;\n]{0,100})/gi)) {
    const required = styleRequirements(match[2]);
    if (styleKeys(required).length) rawBefore.push({ duration: Number(match[1]), required, source: match[0], wholeFrame: wholeFrameHint(match[2]) });
  }
  for (const match of scanText.matchAll(/(?:后|最后|剩余)\s*(\d+(?:\.\d+)?)\s*秒(?:内|期间|部分)?\s*([^，。！？；;\n]{0,100})/gi)) {
    const required = styleRequirements(match[2]);
    if (styleKeys(required).length) rawAfter.push({ duration: Number(match[1]), required, source: match[0], wholeFrame: wholeFrameHint(match[2]) });
  }
  if (!(sourceDuration > 0) && rawBefore.length && rawAfter.length) {
    sourceDuration = Math.max(...rawBefore.flatMap((before) => rawAfter.map((after) => before.duration + after.duration)));
  }
  rawBefore.forEach((item) => addTimelineSpan(spans, 0, item.duration, item.required, item.source, item.wholeFrame));
  if (sourceDuration > 0) {
    rawAfter.forEach((item) => addTimelineSpan(spans, Math.max(0, sourceDuration - item.duration), sourceDuration,
      item.required, item.source, item.wholeFrame));
  }

  /* 从15秒开始 / 第15秒后切换为 / at 15 seconds switch to。 */
  for (const match of scanText.matchAll(/(?:(?:从|自|第)\s*(\d+(?:\.\d+)?)\s*秒(?:时|开始|起)?|(\d+(?:\.\d+)?)\s*秒(?:后|开始|起))\s*(?:开始)?\s*(?:切换为|切换成|变为|转为|进入|保持|使用)?\s*([^，。！？；;\n]{0,100})/gi)) {
    const start = Number(match[1] || match[2]);
    const snippet = match[3];
    const required = styleRequirements(snippet);
    if (sourceDuration > start && styleKeys(required).length) {
      addTimelineSpan(spans, start, sourceDuration, required, match[0], wholeFrameHint(snippet));
    }
  }
  for (const match of scanText.matchAll(/(?:from|at)\s+(\d+(?:\.\d+)?)\s*seconds?\s*(?:onward|onwards|start(?:ing)?|switch(?:es|ing)?\s+to|becomes?)?\s*([^,.;\n]{0,100})/gi)) {
    const required = styleRequirements(match[2]);
    if (sourceDuration > Number(match[1]) && styleKeys(required).length) {
      addTimelineSpan(spans, Number(match[1]), sourceDuration, required, match[0], wholeFrameHint(match[2]));
    }
  }

  if (sourceDuration > 0) {
    const half = sourceDuration / 2;
    const firstHalf = scanText.match(/前半段\s*([^，。！？；;\n]{0,100})/i);
    const secondHalf = scanText.match(/后半段\s*([^，。！？；;\n]{0,100})/i);
    if (firstHalf) addFromSnippet(0, half, firstHalf[1]);
    if (secondHalf) addFromSnippet(half, sourceDuration, secondHalf[1]);
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  /* 相邻且互斥的阶段互相生成 forbidden 规则；白天/夜晚与渲染域都支持。 */
  for (let i = 0; i < spans.length; i++) {
    const previous = i > 0 && Math.abs(spans[i - 1].end - spans[i].start) < 0.05 ? spans[i - 1] : null;
    const next = i + 1 < spans.length && Math.abs(spans[i].end - spans[i + 1].start) < 0.05 ? spans[i + 1] : null;
    if (previous) Object.assign(spans[i].forbidden, styleForbiddenBy(spans[i].required, previous.required));
    if (next) Object.assign(spans[i].forbidden, styleForbiddenBy(spans[i].required, next.required));
    spans[i].name = `${spans[i].start.toFixed(3)}–${spans[i].end.toFixed(3)} 秒必须为 ${styleLabel(spans[i].required)}`;
  }
  return { sourceDuration, phases: spans, explicit: spans.length > 0 };
}

export function formatH3TimelineStyleContract(contract) {
  const phases = Array.isArray(contract && contract.phases) ? contract.phases : [];
  if (!phases.length) return "";
  const lines = phases.map((phase) => `- ${phase.start.toFixed(3)}–${phase.end.toFixed(3)}秒：${styleLabel(phase.required)}`);
  const boundaries = phases.slice(1).map((phase) =>
    `- 边界 ${phase.start.toFixed(3)}秒：从该时间对应 Shot 的第一帧起已经是${styleLabel(phase.required)}，不得把切换延后到镜头内部。`);
  return ["本次本地识别出的硬时间/风格契约（优先级最高，必须原样保留）：", ...lines, ...boundaries].join("\n");
}

export function parseH3OfficialTimelineShots(value, sourceDuration = 0) {
  const text = String(value || "");
  const main = text.match(/(?:integrated_multimodal_description|detailed_description)\s*[:：]([\s\S]*?)(?=\n\s*overall_soundscape\s*[:：]|$)/i);
  const body = main ? main[1] : "";
  if (!body) return [];
  const marks = [...body.matchAll(/\[Shot\s+(\d+)\s*\]/gi)];
  const shots = marks.map((mark, index) => {
    const endIndex = index + 1 < marks.length ? marks[index + 1].index : body.length;
    const raw = body.slice((mark.index || 0) + mark[0].length, endIndex).trim();
    const prefix = parseOfficialShotPrefix(raw);
    return {
      number: Number(mark[1]) || index + 1,
      start: index === 0 ? 0 : prefix.start,
      end: null,
      text: prefix.body,
    };
  });
  const declared = sourceDuration > 0 ? Number(sourceDuration) : extractExplicitTotalDuration(text);
  for (let index = 0; index < shots.length; index++) {
    shots[index].end = index + 1 < shots.length ? shots[index + 1].start : declared;
  }
  return shots.filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.end > shot.start);
}

const H3_CONCRETE_GEAR_TERMS = Object.freeze([
  "锤", "盾", "剑", "刀", "枪", "弓", "斧", "靴", "手套", "护甲", "头盔", "药水", "钥匙",
  "法杖", "炸弹", "钩爪", "镐", "能量瓶", "扳手", "护目镜", "护腕", "护臂", "工具", "地图",
  "hammer", "shield", "sword", "blade", "bow", "axe", "wrench", "goggles", "map", "tool",
  "boots", "gloves", "armor", "helmet", "potion", "staff", "bomb", "grappling hook",
]);

function hardPixelStyle(value) {
  const text = String(value || "");
  const profile = activeStyleProfile(text);
  return !!profile.pixel && (!!profile.twoD
    || /(?:完整|原生|全片|全程|始终|持续).{0,20}(?:2D|二维|pixel|像素)|(?:2D|二维).{0,12}(?:pixel|像素)/i.test(text));
}

function positiveVisualClauses(value) {
  return String(value || "").split(/[。！？；;，,\n]+/).map((clause) => clause.trim()).filter((clause) => {
    if (!clause) return false;
    return !/(?:禁止|不得|不要|不使用|不进行|不保留|不出现|无|没有|避免|去除|拒绝|never|without|\bno\b)/i.test(clause);
  });
}

function findConcreteGearTerms(value) {
  const text = String(value || "").toLowerCase();
  return H3_CONCRETE_GEAR_TERMS.filter((term) => text.includes(term.toLowerCase()));
}

/** 检查剧情是否仍是抽象占位、装备无命名/无回报，以及像素风与三维运镜是否冲突。 */
export function validateH3NarrativeExecutionQuality(value, {
  checkStyle = true, checkCausality = true, checkVague = true,
} = {}) {
  const text = String(value || "");
  const issues = [];
  const push = (severity, code, message) => issues.push({ severity, code, message });

  if (checkVague && /(?:复杂|丰富|精彩|激烈)(?:的)?(?:运镜|剧情|动作|场面)|后续(?:复杂|精彩)?剧情|若干(?:动作|镜头|装备)|第一组装备|第二组装备|最后一组装备|complex (?:camera|plot|action)|first (?:group|set) of equipment|equipment icon group/i.test(text)) {
    push("error", "vague_plot_placeholder",
      "剧情仍包含“复杂剧情/复杂运镜/若干装备/第几组装备”等抽象占位，必须改成明确的目标、障碍、动作和结果。不要用增加镜头数量代替具体剧情。 ");
  }

  if (checkCausality) {
    /* “角色身份/服装/道具全程锁定”是连续性规则，不是装备选择事件。先移除
       这些生产约束，再检查真正发生在剧情里的选择、确认或装备锁定动作。 */
    const equipmentActionText = text
      .replace(/全片锁定\s*[:：]/gi, "连续性条件：")
      .replace(/(?:角色身份\s*[\/、和与]\s*服装\s*[\/、和与]\s*)?(?:装备|武器|道具)(?:名称|外观|身份|状态)?(?:全程|始终|继续)?(?:保持)?锁定/gi, "")
      .replace(/(?:固定|保持|沿用)(?:的)?(?:装备|武器|道具)(?:名称|外观|身份|状态)?/gi, "")
      .replace(/(?:equipment|weapon|item)\s+(?:identity|appearance|state)\s+(?:remains?\s+)?locked/gi, "");
    const hasEquipmentSelection = /(?:选择|挑选|确认|锁定).{0,16}(?:装备|武器|道具)|(?:装备|武器|道具).{0,16}(?:选择|挑选|确认|锁定)|(?:selects?|chooses?|confirms?|locks?).{0,28}(?:equipment|weapon|item)|(?:equipment|weapon|item).{0,28}(?:selection|selected|chosen|confirmed|locked)/i.test(equipmentActionText);
    const gearTerms = findConcreteGearTerms(text);
    if (hasEquipmentSelection && !gearTerms.length) {
      push("error", "equipment_not_named",
        "剧情出现了装备选择，但没有写出任何具体装备名称。请明确选择了什么，并让该装备在后续剧情中产生可见作用。 ");
    } else if (hasEquipmentSelection && gearTerms.length) {
      const hasPayoff = gearTerms.some((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const around = `[^。！？；;\\n]{0,24}`;
        return new RegExp(`(?:使用|挥动|挥出|举起|握住|击打|砸|挡住|抵挡|穿上|启动|发射|劈开|打碎|uses?|swings?|raises?|holds?|blocks?|strikes?|smashes?|wears?|activates?|fires?)${around}${escaped}|${escaped}${around}(?:击打|砸|挡住|抵挡|启动|发射|劈开|打碎|blocks?|strikes?|smashes?|activates?|fires?)`, "i").test(text);
      });
      if (!hasPayoff) {
        push("warn", "equipment_without_payoff",
          `已经出现具体装备（${gearTerms.slice(0, 4).join("、")}），但没有明确写出它在后续障碍中如何被使用；画面因果可能断裂。`);
      }
    }
  }

  if (checkStyle) {
    /* 明确的 3D→2D/像素时间阶段不能整篇合并检查，否则前半段合法的 3D 会被
       当成后半段像素场次里的三维材质。存在分阶段契约时按场次检查；只有一句
       用户创意、尚未形成场次时交给后续时间契约校验，不制造假冲突。 */
    const timelineContract = extractH3TimelineStyleContract(text);
    const pixelPhases = timelineContract.phases.filter((phase) => phase.required && phase.required.pixel);
    const threeDPhases = timelineContract.phases.filter((phase) => phase.required && phase.required.threeD);
    const hasSeparatedRenderPhases = pixelPhases.some((pixel) => threeDPhases.some((threeD) =>
      pixel.end <= threeD.start + 0.05 || threeD.end <= pixel.start + 0.05));
    const sceneBlocks = hasSeparatedRenderPhases
      ? text.split(/(?=\n?\s*场次编号\s*[:：])/i).filter((block) => /场次编号\s*[:：]/i.test(block))
      : [text];
    const spatialPatterns = [
      /(?:环绕|绕着|围绕).{0,16}(?:旋转|一周|半周|360|180)/i,
      /(?:360|180).{0,12}(?:环绕|旋转)/i,
      /(?:低机位|侧后方.{0,10}跟拍|垂直俯冲|立体通道|三维透视|3D透视|透视旋转)/i,
      /(?:空间层级|空间坐标).{0,12}(?:重排|重新排列|旋转)/i,
      /(?:PBR|体积光|真实毛发|写实阴影|景深|shallow depth of field|volumetric light)/i,
      /(?:orbit|arc around|dolly around|camera circles|camera rotates around)/i,
    ];
    for (const scope of sceneBlocks) {
      if (!hardPixelStyle(scope)) continue;
      const positiveText = positiveVisualClauses(scope).join("；");
      const hits = spatialPatterns.filter((pattern) => pattern.test(positiveText));
      const explicitThreeD = activeStyleProfile(positiveText).threeD
        || /(?:PBR|真实毛发|体积光|3D模型|三维模型|2\.5D模型)/i.test(positiveText);
      if (explicitThreeD || hits.length >= 2) {
        push("error", "pixel_3d_camera_conflict",
          "完整原生2D像素风同时包含三维材质或多项空间摄影机语言。请改用固定侧视/俯视、横纵卷轴、视差背景、Sprite帧动画、画面缩放或屏幕震动。 ");
        break;
      }
      if (hits.length === 1) {
        push("warn", "pixel_spatial_camera_risk",
          "2D像素镜头仍包含一项偏三维的空间运镜，模型可能生成3D场景再贴像素纹理；建议改为固定视角或卷轴运动。 ");
        break;
      }
    }
  }

  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

/** 检查 H3 可执行镜头密度。一个 15 秒生成段不应承担十几个亚秒级 Shot。 */
export function validateH3ShotExecutionQuality({
  shots = [], duration = 0, text = "", checkNarrative = true,
  referenceCount = -1, tailContinuation = false,
} = {}) {
  const issues = [];
  const push = (severity, code, message, extra = {}) => issues.push({ severity, code, message, ...extra });
  const normalized = (shots || []).map((shot, index) => ({
    number: Number(shot && shot.number) || index + 1,
    start: Number(shot && shot.start),
    end: Number(shot && shot.end),
    text: String(shot && shot.text || ""),
  })).filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.end > shot.start)
    .sort((a, b) => a.start - b.start);
  const totalDuration = Number(duration) > 0 ? Number(duration)
    : normalized.length ? Math.max(...normalized.map((shot) => shot.end)) : 0;

  if (checkNarrative) {
    for (const issue of validateH3NarrativeExecutionQuality(text, { checkStyle: false }).issues) push(issue.severity, issue.code, issue.message);
  }
  for (const shot of normalized) {
    const style = validateH3NarrativeExecutionQuality(shot.text, {
      checkStyle: true, checkCausality: false, checkVague: false,
    });
    for (const issue of style.issues) {
      push(issue.severity, issue.code, `Shot ${shot.number}：${issue.message}`, { shot: shot.number, time: shot.start });
    }
  }
  if (!normalized.length) return { ok: !issues.some((issue) => issue.severity === "error"), issues, shots: normalized };

  /* 这些是参考提示词审核后得到的“镜头感”软门槛：不要求每种模板都写成动作片，
     但每镜至少应包含一个可见事件和结束状态；运镜必须说明由什么动作触发。 */
  const actionEventPattern = /(?:进入|出现|经过|聚集|滑动|移动|保持|停留|停下|确认|恢复|变化|留下|呼吸|眨眼|转眼|看向|目光|姿态|表情|走|跑|转身|抬头|低头|伸手|触碰|接触|按下|压下|拉动|推动|转动|打开|关闭|滑入|弹入|落位|折叠|翻页|切入|分离|落下|落稳|发射|击中|绷紧|摆荡|下坠|跳下|落地|抓住|递出|接住|挡住|劈开|击打|扫描|点亮|扩散|重组|变形|沉降|回弹|制动|停稳|move|enter|touch|press|pull|push|open|close|slide|fold|cut|separate|land|fire|hit|swing|fall)/i;
  const resultPattern = /(?:结果|画面结束时|停在|稳定|停稳|落稳|锁定|完成|打开|关闭|解除|改变|可见|清楚|形成|保持|回到|进入|离开|result|ends? with|settles?|locks?|opens?|closes?|changes?|visible|clear)/i;
  const cameraPattern = /(?:摄影机|镜头|机位|构图|推近|拉远|横移|跟随|跟拍|追拍|俯拍|低机位|主观|固定|卷轴|camera|shot|close-up|wide shot|tracking|push in|pull back|pan|POV)/i;
  const cameraTriggerPattern = /(?:动作发生后|主体先|角色先|产品先|纸片先|操作先|接触后|结果出现后|落稳后|绷紧后|随后|触发|等待|再|慢半拍|after|then|once|when)/i;
  const transitionPattern = /(?:下一镜|触发|匹配|遮挡|翻页|切镜|硬切|卷轴边缘|状态帧|墨迹|纸片|色块|道具轨迹|动作落点|transition|match cut|wipe|hard cut)/i;
  const dialogueTextPattern = /(?:对白|旁白|台词|歌词|字幕|文案|标题|CTA|PLAYER|READY|Continue|Start New Game|Settings|Exit Game|dialogue|voiceover|lyrics?|subtitle|headline)/ig;
  let untriggeredCameras = 0;
  for (const shot of normalized) {
    const textValue = shot.text;
    if (!actionEventPattern.test(textValue)) {
      push("warn", "shot_without_visible_event",
        `Shot ${shot.number}只有职责、构图或抽象描述，没有清楚的可见动作；请写明主体做了什么、接触什么并产生什么变化。`, { shot: shot.number, time: shot.start });
    }
    if (!resultPattern.test(textValue)) {
      push("warn", "shot_without_visible_result",
        `Shot ${shot.number}没有明确结束状态，下一镜难以连续继承；请补充动作后的可见结果或落定姿态。`, { shot: shot.number, time: shot.start });
    }
    if (cameraPattern.test(textValue) && !cameraTriggerPattern.test(textValue)) untriggeredCameras++;
    if (shot.number < normalized.length && !transitionPattern.test(textValue)) {
      push("warn", "shot_without_visual_transition",
        `Shot ${shot.number}没有说明由哪个画面内动作或物体触发下一镜；建议使用动作落点、接触结果、遮挡、纸片、墨迹、色块或状态变化。`, { shot: shot.number, time: shot.start });
    }
    const visibleTextMentions = textValue.match(dialogueTextPattern) || [];
    const explicitVisibleStrings = Array.from(textValue.matchAll(/[“\"]([^”\"]{1,80})[”\"]/g))
      .map((match) => String(match[1] || "").trim()).filter((item) => item && !/(?:无|禁止|不得|不要|不生成)/.test(item));
    const menuLiteralCount = ["PLAYER", "READY", "Continue", "Start New Game", "Settings", "Exit Game", "CTA"]
      .filter((term) => new RegExp(term, "i").test(textValue)).length;
    const genericTextEventCount = (textValue.match(/(?:显示|出现|写入|准确(?:显示|文字)|可读)(?:[^。；]{0,8})(?:文字|字幕|文案|标题|歌词|CTA)/g) || []).length;
    const permittedNegativeOnly = /(?:无|禁止|不得|不要|只允许|唯一|不生成|without|no\s)/i.test(textValue);
    const overloadedText = explicitVisibleStrings.length >= 2 || menuLiteralCount >= 3 || genericTextEventCount >= 2;
    if (visibleTextMentions.length >= 4 && overloadedText && !permittedNegativeOnly) {
      push("warn", "onscreen_text_overload",
        `Shot ${shot.number}同时要求多项准确文字，H3容易生成伪文字；建议只保留一个关键词，其余使用无字图形或留作后期。`, { shot: shot.number, time: shot.start });
    }
    if (/(?:白闪|白光|黑场|黑屏|闪白|flash to white|white flash)/i.test(textValue)
        && !/(?:来自|由|按钮|灯光|灯具|太阳|门缝光|门内光|门开启|纸片|遮挡|爆炸|电弧|接触点|屏幕|source|from)/i.test(textValue)) {
      push("warn", "unmotivated_flash_transition",
        `Shot ${shot.number}使用白闪/黑场，但没有可见光源、按钮、纸片遮挡或动作来源；容易变成通用转场。`, { shot: shot.number, time: shot.start });
    }
  }
  if (untriggeredCameras > Math.max(1, Math.floor(normalized.length / 2))) {
    push("warn", "camera_without_action_trigger",
      `${untriggeredCameras}个Shot写了运镜但没有说明主体先做什么、摄影机何时响应；容易出现无目的摇晃或提前构图。`);
  }
  const repeatedLockClauses = String(text || "").match(/(?:严格继承上一镜|本镜唯一职责|执行已选职责|本镜新增信息\/结果)/g) || [];
  if (repeatedLockClauses.length >= 2) {
    push("warn", "director_meta_language_repetition",
      "提示词重复包含导演台内部元语言，可能稀释画面动作；建议改成自然的初始画面、动作、接触、摄影机响应和结果。 ");
  }

  const average = totalDuration > 0 ? totalDuration / normalized.length : 0;
  if (average > 0 && average < 2 - 0.001) {
    push("error", "shot_average_too_short",
      `${totalDuration.toFixed(1)} 秒被拆成 ${normalized.length} 个 Shot，平均只有 ${average.toFixed(2)} 秒。建议30秒约6–10镜、每15秒约3–5镜。`);
  }
  if (totalDuration > 0) {
    for (let start = 0; start < totalDuration - 0.001; start += 15) {
      const end = Math.min(totalDuration, start + 15);
      const count = normalized.filter((shot) => shot.start >= start - 0.001 && shot.start < end - 0.001).length;
      if (count > 6) {
        push("error", "shot_density_overload",
          `${start.toFixed(1)}–${end.toFixed(1)}秒包含 ${count} 个 Shot，超过H3稳定执行范围；请压缩到约3–5个，最多不超过6个。`, { time: start });
      } else if (count === 6) {
        push("warn", "shot_density_high",
          `${start.toFixed(1)}–${end.toFixed(1)}秒包含6个 Shot，已接近上限；复杂动作建议进一步合并。`, { time: start });
      }
    }
  }

  const hasPixelShots = normalized.some((shot) => hardPixelStyle(shot.text));
  if (hasPixelShots && Number(referenceCount) === 0) {
    push("warn", "strong_style_without_reference",
      "检测到强原生2D像素要求，但本次没有角色/风格参考图；第一段可能漂移成3D角色加像素贴图。建议绑定一张真正的硬边像素Sprite参考图。 ");
    if (tailContinuation) {
      push("warn", "tail_style_error_propagation",
        "后续段启用了尾帧续接；如果第一段先生成成3D，错误风格会被尾帧稳定传给后续段。请先验收第一段风格再继续生成。 ");
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), issues, shots: normalized, averageShotDuration: average };
}

function isStyleBridgeShot(text, targetRequired = {}) {
  const value = String(text || "");
  const transition = /(?:transform(?:s|ed|ing)?\s+into|transition(?:s|ed|ing)?\s+into|morph(?:s|ed|ing)?\s+into|dissolv(?:e|es|ed|ing)\s+into|gradually\s+becomes?|压缩为|逐渐(?:变为|转为)|转化为|转换为|变形成|分解为|像素化过程|完成像素化|Final frame)/i.test(value);
  const finalTarget = /(?:final frame|最终帧|末帧|before\s+\d|之前完全|已经(?:完全|完整)|fully|complete(?:ly)?|entire frame|整个画面|全画面)/i.test(value)
    && styleKeys(targetRequired).every((key) => activeStyleProfile(value)[key]);
  return transition && finalTarget;
}

/** 纯函数：验证已规范化的 Shot 时间轴是否遵守用户明确声明的阶段。 */
export function validateH3TimelineStyleContract({ sourceDuration = 0, shots = [], phases = [] } = {}) {
  const issues = [];
  const push = (severity, code, message, extra = {}) => issues.push({ severity, code, message, ...extra });
  const normalizedShots = (shots || []).map((shot, index) => ({
    number: Number(shot && shot.number) || index + 1,
    start: Number(shot && shot.start),
    end: Number(shot && shot.end),
    text: String(shot && shot.text || ""),
  })).filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.end > shot.start)
    .sort((a, b) => a.start - b.start);
  const normalizedPhases = (phases || []).filter((phase) => Number.isFinite(Number(phase && phase.start))
    && Number.isFinite(Number(phase && phase.end)) && Number(phase.end) > Number(phase.start));
  if (!normalizedPhases.length) return { ok: true, issues: [] };
  if (!normalizedShots.length) {
    push("error", "timeline_style_no_shots", "检测到硬时间/风格契约，但生成结果没有可验证的 Shot 时间轴。");
    return { ok: false, issues };
  }

  const tolerance = 0.06;
  for (let phaseIndex = 0; phaseIndex < normalizedPhases.length; phaseIndex++) {
    const phase = normalizedPhases[phaseIndex];
    const start = Number(phase.start);
    const end = Number(phase.end);
    const required = phase.required || {};
    const forbidden = phase.forbidden || {};
    const phaseShots = normalizedShots.filter((shot) => shot.start < end - tolerance && shot.end > start + tolerance);
    const boundaryShot = normalizedShots.find((shot) => Math.abs(shot.start - start) <= tolerance);
    if (start > tolerance && !boundaryShot) {
      push("error", "timeline_style_boundary_missing",
        `硬风格边界 ${start.toFixed(3)} 秒没有对应的 Shot 起点；目标风格必须从一个明确 Shot 的第一帧开始。`, { time: start });
    }
    if (!phaseShots.length) {
      push("error", "timeline_style_phase_empty", `${phase.name || `${start}–${end}秒`}没有对应镜头。`, { time: start });
      continue;
    }
    for (const [shotIndex, shot] of phaseShots.entries()) {
      const profile = activeStyleProfile(shot.text);
      const missing = styleKeys(required).filter((key) => !profile[key]);
      const forbiddenActive = styleKeys(forbidden).filter((key) => profile[key]);
      const nextPhase = phaseIndex + 1 < normalizedPhases.length ? normalizedPhases[phaseIndex + 1] : null;
      const bridge = nextPhase && Math.abs(shot.end - end) <= tolerance
        && isStyleBridgeShot(shot.text, nextPhase.required || {});
      /* 每个阶段的第一镜必须明确声明目标风格；后续镜头允许继承，但如果主动
         声明了互斥风格仍会被 forbidden 拦截。像素阶段要求每镜显式保持像素，
         防止模型只把 UI/特效像素化、角色又回到 3D。 */
      const requireEveryShot = !!required.pixel;
      if (missing.length && (shotIndex === 0 || requireEveryShot)) {
        push("error", "timeline_style_required_missing",
          `Shot ${shot.number}（${shot.start.toFixed(3)}秒）缺少阶段要求：${missing.map((key) => H3_STYLE_LABELS[key] || key).join("、")}。`,
          { time: shot.start, shot: shot.number });
      }
      if (forbiddenActive.length && !bridge) {
        push("error", "timeline_style_forbidden_active",
          `Shot ${shot.number}（${shot.start.toFixed(3)}秒）仍在使用本阶段禁止的风格：${forbiddenActive.map((key) => H3_STYLE_LABELS[key] || key).join("、")}。`,
          { time: shot.start, shot: shot.number });
      }
      if (bridge) {
        push("info", "timeline_style_bridge",
          `Shot ${shot.number} 已在 ${end.toFixed(3)} 秒边界前完成跨风格桥接，下一段可从目标风格尾帧续接。`,
          { time: end, shot: shot.number });
      }
    }
    if (boundaryShot) {
      const boundaryProfile = activeStyleProfile(boundaryShot.text);
      const missingAtBoundary = styleKeys(required).filter((key) => !boundaryProfile[key]);
      if (missingAtBoundary.length) {
        const later = normalizedShots.find((shot) => shot.start > start + tolerance
          && shot.start < end - tolerance
          && styleKeys(required).every((key) => activeStyleProfile(shot.text)[key]));
        const actual = later ? later.start : null;
        push("error", "timeline_style_boundary_drift",
          actual != null
            ? `要求 ${start.toFixed(3)} 秒进入${styleLabel(required)}，但正文直到 ${actual.toFixed(3)} 秒才进入，边界偏移 ${(actual - start).toFixed(3)} 秒。`
            : `要求 ${start.toFixed(3)} 秒进入${styleLabel(required)}，但该 Shot 第一帧没有达到目标风格。`,
          { time: start, actualTime: actual });
      }
    }
  }
  if (sourceDuration > 0) {
    const lastEnd = Math.max(...normalizedShots.map((shot) => shot.end));
    if (Math.abs(lastEnd - Number(sourceDuration)) > 0.08) {
      push("error", "timeline_style_duration_mismatch",
        `硬契约总时长 ${Number(sourceDuration).toFixed(3)} 秒，但 Shot 时间轴结束于 ${lastEnd.toFixed(3)} 秒。`);
    }
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

export function validateGeneratedH3TimelineStyleContract(sourceText, generatedText, { mode = "official" } = {}) {
  const contract = extractH3TimelineStyleContract(sourceText);
  if (mode === "script") {
    if (!contract.phases.length) return { ok: true, issues: [], contract, shots: [] };
    const generated = extractH3TimelineStyleContract(generatedText);
    const issues = [];
    for (const phase of contract.phases) {
      const match = generated.phases.find((candidate) => Math.abs(candidate.start - phase.start) < 0.05
        && Math.abs(candidate.end - phase.end) < 0.05
        && styleKeys(phase.required).every((key) => candidate.required[key]));
      if (!match) {
        issues.push({ severity: "error", code: "story_timeline_contract_lost",
          message: `剧本没有完整保留硬约束：${phase.name}。` });
      }
    }
    return { ok: !issues.length, issues, contract, generatedContract: generated, shots: [] };
  }
  const shots = parseH3OfficialTimelineShots(generatedText, contract.sourceDuration);
  if (!contract.phases.length) return { ok: true, issues: [], contract, shots };
  return { ...validateH3TimelineStyleContract({ sourceDuration: contract.sourceDuration, shots, phases: contract.phases }), contract, shots };
}

export function buildH3TimelineRepairInstruction(contract, issues = [], { mode = "official" } = {}) {
  const formatted = formatH3TimelineStyleContract(contract);
  const problemLines = (issues || []).filter((issue) => issue.severity === "error")
    .map((issue) => "- " + issue.message);
  const issueCodes = new Set((issues || []).map((issue) => String(issue.code || "")));
  const qualityRules = [];
  if ([...issueCodes].some((code) => /shot_|short_shot|scene_density/.test(code))) {
    qualityRules.push("重新合并过碎镜头：每15秒约3–5个Shot、最多6个；通常每镜2–6秒，任何特殊快切不得低于1.5秒；一个Shot只承担一个主要动作。不得通过增加Shot数量保留微动作。 ");
  }
  if (issueCodes.has("pixel_3d_camera_conflict") || issueCodes.has("pixel_spatial_camera_risk")) {
    qualityRules.push("原生2D像素阶段删除环绕旋转、低机位空间跟拍、立体通道、PBR、体积光、真实毛发和写实景深；只使用固定侧视/俯视、横纵卷轴、视差背景、Sprite帧动画、画面缩放和屏幕震动。 ");
  }
  if (issueCodes.has("equipment_not_named") || issueCodes.has("equipment_without_payoff")) {
    qualityRules.push("把“第几组装备/装备图标”改为具体装备名称，并建立可见因果：选择装备→遇到障碍→使用同名装备→得到明确结果。若用户明确要求选择装备却没有命名，允许按题材和风格补全最多2件具体、非角色装备并立即锁定；这是最小必要补全，不得借机新增无关人物、敌人、Boss、地点、资产或支线。 ");
  }
  if (issueCodes.has("vague_plot_placeholder")) {
    qualityRules.push("把“复杂剧情/复杂运镜/精彩动作”等抽象词改成最少数量的具体事件，写清目标、障碍、动作与结果，不得用无目的运镜填充时长。 ");
  }
  const outputRule = mode === "script"
    ? "重新输出完整中文剧本；保留目标总时长、剧情顺序、角色、资产名称与原始台词，并在首行之后保留硬时间与风格约束清单。"
    : "重新输出完整 H3 Base 三字段及 director_import_manifest；不得只输出补丁或解释。保持总时长、角色、资产、道具、剧情顺序和台词不变。";
  return [
    qualityRules.length
      ? "本地H3可执行性校验失败。只重组镜头密度、具体动作因果和冲突运镜，不扩写新人物、物种、地点、对白、Boss、字幕或片尾字卡。"
      : "本地硬契约校验失败。只修正时间轴和风格边界，不扩写新人物、物种、武器、地点、对白、Boss、字幕或片尾字卡。",
    formatted,
    problemLines.length ? "需要修正的问题：\n" + problemLines.join("\n") : "请严格重新核对全部边界 Shot。",
    qualityRules.length ? "H3执行规则：\n- " + qualityRules.join("\n- ") : "",
    "若存在跨生成段风格转换，应在边界前最后一个 Shot 内完成转换，最终帧已经是目标风格或中性全屏白光/像素网格；边界 Shot 从第一帧起必须是目标风格。",
    outputRule,
  ].filter(Boolean).join("\n\n");
}

export function injectH3TimelineStyleContractManifest(value, contract) {
  const phases = Array.isArray(contract && contract.phases) ? contract.phases : [];
  if (!phases.length) return String(value || "").trim();
  let text = String(value || "").trim();
  text = text.replace(/^\s*hard_style_phase_\d+\s*[:：].*$/gim, "").replace(/\n{3,}/g, "\n\n").trim();
  const lines = phases.map((phase, index) => {
    const required = styleKeys(phase.required).join(",");
    const forbidden = styleKeys(phase.forbidden).join(",");
    return `hard_style_phase_${index + 1}: ${phase.start.toFixed(3)}-${phase.end.toFixed(3)}s | required=${required}`
      + (forbidden ? ` | forbidden=${forbidden}` : "");
  });
  const manifest = text.match(/(?:^|\n)\s*director_import_manifest\s*[:：]/i);
  if (!manifest) return text;
  return text + "\n" + lines.join("\n");
}

function hardStyleConflict(a, b) {
  if (a.threeD && (b.twoD || b.pixel)) return "3D 与 2D/像素风格";
  if ((a.twoD || a.pixel) && b.threeD) return "2D/像素与 3D 风格";
  if (a.live && (b.pixel || b.animation)) return "写实/实拍与动画/像素风格";
  if ((a.pixel || a.animation) && b.live) return "动画/像素与写实/实拍风格";
  if (a.day && b.night) return "白天与夜晚光照";
  if (a.night && b.day) return "夜晚与白天光照";
  return "";
}

function visualShotBodies(value) {
  const text = String(value || "");
  const main = text.match(/(?:integrated_multimodal_description|detailed_description)\s*[:：]([\s\S]*?)(?=\n\s*(?:overall_soundscape|non_diegetic_music|director_import_manifest)\s*[:：]|$)/i);
  const visual = main ? main[1] : text.split(/\n\s*(?:overall_soundscape|non_diegetic_music|director_import_manifest)\s*[:：]/i)[0];
  const marks = [...visual.matchAll(/\[Shot\s+\d+\s*\]/gi)];
  if (!marks.length) return [visual.trim()].filter(Boolean);
  return marks.map((mark, index) => visual.slice((mark.index || 0) + mark[0].length,
    index + 1 < marks.length ? marks[index + 1].index : visual.length).trim());
}

function endpointRenderStyle(value, endpoint = "first") {
  const bodies = visualShotBodies(value);
  if (!bodies.length) return { kind: "unknown", profile: styleProfile("") };
  let text = bodies[endpoint === "last" ? bodies.length - 1 : 0];
  /* 内容词不是渲染风格：3D printer、2D map、三维打印机、二维地图均忽略。 */
  text = text.replace(/\b3d\s+print(?:er|ing)?\b|\b2d\s+(?:map|diagram|layout)\b|三维打印机|二维(?:地图|图纸|布局)/gi, " ");
  const profile = activeStyleProfile(text);
  const hasTransition = /(?:transform(?:s|ed|ing)?\s+into|transition(?:s|ed|ing)?\s+into|morph(?:s|ed|ing)?\s+into|dissolv(?:e|es|ed|ing)\s+into|gradually\s+becomes?|压缩为|逐渐(?:变为|转为)|转化为|转换为|变形成|分解为|像素化过程)/i.test(text);
  const has3d = profile.threeD && !(profile.twoD || profile.pixel);
  const hasFlat = (profile.twoD || profile.pixel) && !profile.threeD;
  const hasLive = profile.live && !(profile.animation || profile.pixel);
  const hasAnimated = (profile.animation || profile.pixel) && !profile.live;
  let kind = "unknown";
  if (hasTransition || (profile.threeD && (profile.twoD || profile.pixel))
      || (profile.live && (profile.animation || profile.pixel))) kind = "transition";
  else if (has3d) kind = "3d";
  else if (hasFlat) kind = profile.pixel ? "2d_pixel" : "2d";
  else if (hasLive) kind = "live";
  else if (hasAnimated) kind = profile.pixel ? "2d_pixel" : "animation";
  return { kind, profile, text };
}

/** 只比较上一段最后 Shot 与下一段第一 Shot 的排他渲染域。 */
export function detectTailRenderBoundary(previousPrompt, currentPrompt) {
  const previous = endpointRenderStyle(previousPrompt, "last");
  const current = endpointRenderStyle(currentPrompt, "first");
  if (["unknown", "transition"].includes(previous.kind) || ["unknown", "transition"].includes(current.kind)) return null;
  const previous3dLike = previous.kind === "3d" || previous.kind === "live";
  const current3dLike = current.kind === "3d" || current.kind === "live";
  const previousFlatLike = ["2d", "2d_pixel", "animation"].includes(previous.kind);
  const currentFlatLike = ["2d", "2d_pixel", "animation"].includes(current.kind);
  if (!((previous3dLike && currentFlatLike) || (previousFlatLike && current3dLike))) return null;
  return { kind: "hard", from: previous.kind, to: current.kind };
}

export function detectTailRenderBoundaryIssues(segments = []) {
  const issues = [];
  for (let index = 1; index < (segments || []).length; index++) {
    const current = segments[index] || {};
    if (!current.use_tail) continue;
    const boundary = detectTailRenderBoundary(segments[index - 1] && segments[index - 1].prompt, current.prompt);
    if (!boundary) continue;
    issues.push({
      severity: "warn",
      code: "tail_hard_style_boundary",
      segment: index + 1,
      from: boundary.from,
      to: boundary.to,
      message: `第 ${index + 1} 段启用了尾帧续接，但上一段末镜是 ${boundary.from}、本段首镜要求立即成为 ${boundary.to}。若主模型为 FL2VA，硬首帧和前8帧桥接会保留旧风格；本次仍可生成，但第一帧可能无法立即成为新风格。`,
    });
  }
  return issues;
}

/** 检测全局提示词是否会把某段强行拉回另一种风格/时间状态。 */
export function detectGlobalPromptConflicts(globalPrompt, segments = []) {
  const globalText = String(globalPrompt || "").trim();
  if (!globalText || !Array.isArray(segments) || !segments.length) return [];
  const globalStyle = styleProfile(globalText);
  const issues = [];
  segments.forEach((segment, index) => {
    const local = String(segment && segment.prompt || segment || "");
    const conflict = hardStyleConflict(globalStyle, styleProfile(local));
    if (conflict) {
      issues.push({
        severity: "error",
        code: "global_style_conflict",
        segment: index + 1,
        message: `第 ${index + 1} 段与全局提示词存在${conflict}冲突；全局内容会在尾帧续接后把画面拉回旧风格/旧场景。`,
      });
    }
  });

  const sceneSpecific = /(?:\bscene\b|\bsetting\b|hall|lobby|room|forest|beach|street|door|portal|platform|metal wall|game interface|side-scroller|大厅|房间|竹林|森林|海边|街道|古门|传送门|平台|金属墙|候选角色屏幕|游戏界面|横版)/i.test(globalText);
  const cameraSpecific = /(?:camera|close[ -]?up|wide shot|low[ -]?angle|high[ -]?angle|镜头|特写|全景|俯拍|仰拍|运镜)/i.test(globalText);
  const phaseSpecific = /(?:前半段|后半段|上半段|下半段|第[一二三四五六七八九十\d]+段|随后(?:连续)?切换|主动(?:连续)?切换|切换为|逐渐(?:切换|变为|转为)|风格(?:变化|切换)|style transition|switch(?:es|ing)? to|transform(?:s|ing)? into)/i.test(globalText);
  const actionSpecific = /(?:角色模型|人物选择台|操作面板|武器栏|排列三把武器|360\s*度旋转|视线锁定|猛地按下|点击确认|身体前倾|身体僵住|双爪收紧|耳朵竖起|眼睛睁大|主光.*照亮|左侧显示|右侧排列|快速点击|向前跨步|抬头看向|character selection|selection panel|press(?:es)? confirm|locks? (?:his|her|its) gaze)/i.test(globalText);
  if (segments.length > 1 && (sceneSpecific || cameraSpecific || phaseSpecific || actionSpecific)) {
    issues.push({
      severity: "warn",
      code: "global_scope_too_specific",
      segment: 0,
      message: "全局提示词包含具体场景、构图或运镜；这些内容应留在对应分段，全局框只保留角色身份、真正共享的风格和通用限制。",
    });
  }
  return issues;
}

function splitPromptSentences(value) {
  return (String(value || "").match(/[^.!?。！？;；\n]+[.!?。！？;；]?/g) || [])
    .map((sentence) => sentence.replace(/^\s*(?:\[Shot\s+\d+\](?:\s+At\s+[^,，]+[,，]?)?|[a-z_]+\s*[:：])\s*/i, "").trim())
    .filter(Boolean);
}

function extractSafeIdentityClause(value, identityWords, characterWords, unsafeShared, sceneOrCamera,
  actionSpecific) {
  let candidate = String(value || "").trim();
  if (!candidate || !identityWords.test(candidate) || !characterWords.test(candidate)) return "";

  /* AI 经常把“前半段 3D、后半段 2D；全片主角为……”写成一个中文长句。
     若风格切换与身份混在同一子句，只从明确的角色身份锚点开始保留，绝不把
     3D/2D、场景或运镜一起带进全局框。 */
  const anchor = candidate.match(/(?:全片|始终|同一)?(?:的)?(?:主角|角色)(?:身份|设定|外貌)?(?:为|是|保持|[:：])?|the same(?:\s+[\w-]+){0,6}\s+(?:character|subject|protagonist)|stable\s+(?:character|subject)\s+identity/i);
  /* 只有明确写出“全片主角身份 / 角色身份保持 / the same protagonist”的定义句
     才能进入全局。仅仅在动作句里出现“熊猫毛发、角色模型、身体”不等于身份定义。 */
  if (!anchor || anchor.index == null) return "";
  candidate = candidate.slice(anchor.index).trim();

  const safeParts = [];
  for (const rawPart of candidate.split(/[,，]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    if (unsafeShared.test(part) || sceneOrCamera.test(part) || actionSpecific.test(part)) break;
    safeParts.push(part.replace(/[;；]\s*$/, ""));
  }
  const safe = safeParts.join("，").replace(/[;；]\s*$/, "").trim();
  return identityWords.test(safe) && characterWords.test(safe) ? safe : "";
}

/**
 * 从多个生成段中提取安全的全局提示词。
 * 永不把首段场景/构图/动作自动设为全局；风格发生主动切换时只保留角色身份与通用限制。
 */
export function deriveSafeGlobalPrompt(segments = []) {
  const prompts = (segments || []).map((segment) => String(segment && segment.prompt || segment || "").trim()).filter(Boolean);
  if (prompts.length < 2) return "";

  const sceneOrCamera = /(?:\bscene\b|\bsetting\b|hall|lobby|room|forest|beach|street|door|portal|platform|camera|shot|angle|view|frames?\b|game interface|side-scroller|大厅|房间|竹林|森林|海边|街道|古门|传送门|平台|游戏界面|横版|镜头|特写|全景|俯拍|仰拍|构图|运镜)/i;
  const styleWords = /(?:\b3d\b|\b2d\b|pixel|8[ -]?bit|16[ -]?bit|anime|animation|cartoon|cinematic|realistic|render|painting|illustration|comic|toon|写实|动画|卡通|像素|电影感)/i;
  const identityWords = /(?:same (?:character|subject|protagonist)|identity|identical|remain(?:s)? consistent|keep .*consistent|appearance|body proportions?|face|fur|hair|outfit|costume|weapon|accessor(?:y|ies)|prop|角色身份|主角身份|同一(?:个|只|名)|外貌一致|保持一致|体型|脸型|圆脸|毛色|毛发|发型|服装|武器|随身道具|固定道具|竹节长枪)/i;
  const characterWords = /(?:character|subject|protagonist|panda|dragon|man|woman|boy|girl|角色|主角|熊猫|龙|男人|女人|男孩|女孩)/i;
  const constraintWords = /(?:no subtitles?|no watermark|no text|do not|never|avoid|禁止字幕|不要字幕|无字幕|无水印|禁止文字|不得出现文字|禁止新增角色)/i;
  const unsafeShared = /(?:\b3d\b|\b2d\b|pixel|8[ -]?bit|16[ -]?bit|像素|横版|游戏界面|前半段|后半段|上半段|下半段|随后(?:连续)?切换|主动(?:连续)?切换|切换为|逐渐(?:切换|变为|转为)|进入像素|风格(?:变化|切换)|style transition|switch(?:es|ing)? to|transform(?:s|ing)? into)/i;
  const actionSpecific = /(?:角色模型|人物选择台|操作面板|武器栏|排列三把武器|360\s*度旋转|视线锁定|猛地按下|点击确认|身体前倾|身体僵住|双爪收紧|耳朵竖起|眼睛睁大|主光.*照亮|左侧显示|右侧排列|快速点击|向前跨步|抬头看向|character selection|selection panel|press(?:es)? confirm|locks? (?:his|her|its) gaze)/i;

  let styleConflict = false;
  const profiles = prompts.map(styleProfile);
  for (let i = 0; i < profiles.length && !styleConflict; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      if (hardStyleConflict(profiles[i], profiles[j])) { styleConflict = true; break; }
    }
  }

  const identity = [];
  const constraints = [];
  const seen = new Set();
  const addUnique = (list, sentence) => {
    const clean = sentence.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) { seen.add(key); list.push(clean); }
  };
  const allSentences = prompts.flatMap(splitPromptSentences);
  for (const sentence of allSentences) {
    if (constraintWords.test(sentence) && !sceneOrCamera.test(sentence)) addUnique(constraints, sentence);
    const safeIdentity = extractSafeIdentityClause(
      sentence, identityWords, characterWords, unsafeShared, sceneOrCamera, actionSpecific);
    if (safeIdentity) addUnique(identity, safeIdentity);
  }

  let sharedStyle = "";
  if (!styleConflict) {
    sharedStyle = splitPromptSentences(prompts[0]).find((sentence) =>
      styleWords.test(sentence) && !unsafeShared.test(sentence) && !sceneOrCamera.test(sentence)
      && !/\bAt\s+\d|\d+\s*(?:秒|s)\b/i.test(sentence)) || "";
  }

  if (!constraints.some((sentence) => /subtitle|字幕/i.test(sentence))) {
    addUnique(constraints, "No subtitles or watermarks on screen.");
  }
  const parts = [];
  if (sharedStyle) parts.push("Shared visual style:\n" + sharedStyle);
  if (identity.length) parts.push("Stable character identity:\n" + identity.slice(0, 6).join(" "));
  if (constraints.length) parts.push("Global constraints:\n" + constraints.slice(0, 6).join(" "));
  return parts.join("\n\n").trim();
}

/**
 * 只修复生产前检查已经识别出的全局范围问题。
 * 安全全局内容始终从全部分段重新提取；绝不把第一段场景静默当作全片设定。
 */
export function repairGlobalPrompt(segments = [], currentPrompt = "") {
  const current = String(currentPrompt || "").trim();
  const issues = detectGlobalPromptConflicts(current, segments);
  const conflictIssues = issues.filter((issue) => issue.code === "global_style_conflict");
  const scopeIssues = issues.filter((issue) => issue.code === "global_scope_too_specific");
  if (!conflictIssues.length && !scopeIssues.length) {
    return {
      prompt: current,
      changed: false,
      removedConflictCount: 0,
      removedScopeCount: 0,
    };
  }

  const prompt = deriveSafeGlobalPrompt(segments)
    || "Global constraints:\nNo subtitles or watermarks on screen.";
  return {
    prompt,
    changed: prompt !== current,
    removedConflictCount: conflictIssues.length,
    removedScopeCount: scopeIssues.length,
  };
}

const H3_PLACEHOLDER_LABEL_HINT = /(?:填写|插入|替换|待定|占位|todo|placeholder|整片风格|画风|配色|质感|场景|空间|地标|角色|人物|主角|五官|表情|穿搭|服装|动作|运镜|镜头|机位|光线|主色|强调色|产品|品牌|受众|卖点|文案|slogan|歌词|台词|旁白|环境音|音效|配乐|收尾|结尾|余韵|主体|目标|障碍|道具|装备|名称|机制|原理|案例|知识|总结|隐喻|色彩|贴字|鼓点|高潮)/i;

/** 返回会进入H3执行提示词的残留占位符；普通书名号式【作品名】不会一律误报。 */
export function findH3PromptPlaceholders(value = "") {
  const text = String(value || "");
  const matches = [];
  const add = (placeholder) => {
    const clean = String(placeholder || "").trim();
    if (clean && !matches.includes(clean)) matches.push(clean);
  };
  for (const match of text.matchAll(/\{\{[^{}\n]{1,80}\}\}/g)) add(match[0]);
  for (const match of text.matchAll(/【[^】\n]{1,80}】/g)) {
    if (H3_PLACEHOLDER_LABEL_HINT.test(match[0])) add(match[0]);
  }
  for (const match of text.matchAll(/<\s*(?:填写|插入|替换|待定|占位|TODO)[^>\n]{0,80}>/gi)) add(match[0]);
  for (const match of text.matchAll(/<\s*Picture\s+(?:TODO|PLACEHOLDER|待定|待填写|填写)[^>\n]{0,40}>/gi)) add(match[0]);
  for (const match of text.matchAll(/\b(?:TODO|PLACEHOLDER)\b/gi)) add(match[0]);
  return matches;
}

function h3PlaceholderVisualStyle(context) {
  const text = String(context || "");
  if (/(?:原生)?2D像素|pixel|Sprite/i.test(text)) return "完整原生2D像素风，有限色板、清楚像素轮廓和固定屏幕视角";
  if (/纸艺|纸雕|卡纸|papercraft/i.test(text)) return "手工纸艺定格风，可见纸张纤维、切边、厚度和真实层间投影";
  if (/拼贴|半调|collage/i.test(text)) return "扁平半调纸拼贴风，大纸片、手撕边缘、有限色块和真实纸片阴影";
  if (/水墨|宣纸|ink/i.test(text)) return "国风水墨动画，宣纸留白、墨色浓淡和少量设色保持统一";
  if (/手绘实拍|蜡笔|粉笔|涂鸦/i.test(text)) return "生活化实拍与逐帧手绘融合，真实空间光线和手工线条颗粒连续";
  if (/主菜单|Continue|PLAYER\s*[12]/i.test(text)) return "米白纸张底的潮流二次元游戏海报，粗黑手绘线、青绿功能强调和扁平贴纸边缘";
  if (/产品|商品|材质|功能证明/i.test(text)) return "真实商业产品摄影，产品颜色、比例和材质保真，背景与光线克制";
  if (/(?:风格化|写实比例)?3D|三维|C4D|Octane/i.test(text)) return "风格化3D动画，角色轮廓清楚、材质可信、电影光位连续";
  if (/赛璐璐|二维|2D漫画|漫剧/i.test(text)) return "二维赛璐璐动画，稳定线稿、有限明暗分层和角色身份连续";
  return "统一且可执行的电影化视觉风格，主体轮廓清楚，色彩、材质和光线全程一致";
}

function h3PlaceholderReplacement(placeholder, context) {
  const label = String(placeholder || "").replace(/^\{\{|\}\}$/g, "")
    .replace(/^【|】$/g, "").replace(/^<|>$/g, "").trim();
  /* 这些项目需要用户真实事实，自动编写会导致角色、品牌、台词或资产被伪造。 */
  if (/(?:品牌名|产品名|游戏名|角色名|人物名|姓名|名\s*[12]|Logo|CTA|行动号召|网址|日期|数字|Picture|图片|素材|歌词|台词|对白|旁白|slogan|文案)/i.test(label)) return "";
  if (/(?:整片风格|画风|风格|配色|质感|视觉)/i.test(label)) return h3PlaceholderVisualStyle(context);
  if (/(?:主色|强调色|色彩)/i.test(label)) {
    if (/苹果|果皮/.test(context)) return "自然深红色果皮、真实绿色叶片与浅暖灰背景";
    if (/主菜单|Continue/.test(context)) return "米白纸张、黑色粗线、青绿色功能强调和少量橙色辅助";
    return "不超过三种主色的克制配色，主体真实颜色作为唯一强调";
  }
  if (/(?:场景|空间|地标|地点)/i.test(label)) return "固定场景内，主体位于中景，背景地标、入口、动作轴线和主光方向清楚且全程连续";
  if (/(?:运镜|镜头运动|摄影机|相机|机位)/i.test(label)) return "主体动作先发生，摄影机随后短距离跟随或推近，结果出现后立即制动，不越轴、不无目的摇晃";
  if (/(?:景别|构图)/i.test(label)) return "先用中远景建立主体与固定地标，再用中近景证明接触和状态变化，最后回到稳定结果构图";
  if (/(?:动作|操作|过程|行为)/i.test(label)) return "主体观察目标→主动接近→发生一次清楚接触或受力→状态发生可见变化→结果稳定可读";
  if (/(?:光线|灯光|光影|照明)/i.test(label)) return "主光方向固定，局部补光只证明接触和结果，所有亮度变化都有画面内可见来源";
  if (/(?:环境音|音效|声音|声景)/i.test(label)) return "连续环境底噪；脚步、接触、受力、材质和落定声只在对应可见动作发生时出现";
  if (/(?:配乐|音乐|BGM)/i.test(label)) return "一条克制器乐配乐随动作逐步增强，在最终结果前快速制动，不遮盖同步动作声";
  if (/(?:收尾|结尾|余韵|最终帧|定格)/i.test(label)) return "主体、关键道具、动作结果和下一运动方向在稳定中远景中清楚可见，最后一秒保持完全稳定";
  if (/(?:目标|任务)/i.test(label)) return "主体主动完成一个可由画面验证的明确目标";
  if (/(?:障碍|阻力|压力)/i.test(label)) return "一个已经在固定场景中建立、能通过可见动作解决的物理阻碍";
  if (/(?:道具|装备)/i.test(label)) return "已经在前镜明确建立并保持同一名称、外观和归属的核心道具";
  if (/(?:角色|人物|主角|五官|表情|穿搭|服装|身份)/i.test(label)) return "";
  return "";
}

/**
 * 只修复能由当前文本和安全摄影规则确定的占位符；角色名、品牌、文案、台词、
 * 歌词和素材编号保持未解决并明确返回，绝不为了让检查变绿而伪造用户事实。
 */
export function repairH3PromptPlaceholders(value = "") {
  const source = String(value || "");
  let text = source;
  const repaired = [];
  const unresolved = [];
  for (const placeholder of findH3PromptPlaceholders(source)) {
    const replacement = h3PlaceholderReplacement(placeholder, source);
    if (!replacement) {
      unresolved.push(placeholder);
      continue;
    }
    text = text.split(placeholder).join(replacement);
    repaired.push({ placeholder, replacement });
  }
  return {
    text,
    changed: text !== source,
    repairedCount: repaired.length,
    repaired,
    unresolved,
  };
}

/**
 * “修复可安全修复项并复检”的结果文案。
 *
 * 这个按钮处理可由当前文本安全确定的脚本/分段占位符，以及全局提示词的
 * 风格/范围冲突；绝不能为了消除一条时长建议静默改写用户已经确认的镜头。
 * 把“本次无需修复”和“仍有非阻塞建议”分开说明，避免用户把 no-op 当成失败。
 */
export function formatGlobalRepairStatus(repaired = {}, report = {}) {
  const counts = report && report.counts || {};
  const errors = Number(counts.error) || 0;
  const warnings = Number(counts.warn) || 0;
  const issues = Array.isArray(report && report.issues) ? report.issues : [];
  const firstError = issues.find((issue) => issue && issue.severity === "error");
  const firstWarning = issues.find((issue) => issue && issue.severity === "warn");
  const placeholderCount = Number(repaired && repaired.placeholderRepairCount) || 0;
  const unresolved = Array.isArray(repaired && repaired.unresolvedPlaceholders)
    ? repaired.unresolvedPlaceholders : [];
  const didRepair = !!(repaired && (repaired.removedConflictCount || repaired.removedScopeCount
    || repaired.changed || placeholderCount));

  if (!didRepair) {
    if (errors) {
      let message = "复检仍未通过：当前有 " + errors + " 个硬性错误";
      if (warnings) message += "、" + warnings + " 条建议";
      message += unresolved.length
        ? `。不能安全自动填写：${unresolved.slice(0, 3).join("、")}；请在对应蓝色项目或脚本位置填写真实内容。`
        : "。没有可安全自动修复的内容；脚本分段、镜头和时长未被静默改写。";
      if (firstError && firstError.message) message += " 请处理：" + firstError.message;
      return message;
    }
    let message = "已完成复检：全局提示词无需修复（未发现可自动处理的风格/范围冲突）。";
    if (warnings) {
      message += "硬性错误 0；保留 " + warnings + " 条非阻塞建议";
      if (firstWarning && firstWarning.message) message += "：" + firstWarning.message;
      message += "。为保持你的分段与叙事节奏，未自动调整时长或改写镜头。";
      return message;
    }
    return message + "生产前检查通过，没有阻止生成的问题。";
  }

  let message = "已修复可安全确定的内容：";
  const repairedParts = [];
  if (placeholderCount) repairedParts.push(`${placeholderCount} 类脚本/分段占位符`);
  const conflictCount = Number(repaired && repaired.removedConflictCount) || 0;
  if (conflictCount) repairedParts.push(`${conflictCount} 个全局风格冲突`);
  const scopeCount = Number(repaired && repaired.removedScopeCount) || 0;
  if (scopeCount) repairedParts.push(`${scopeCount} 个全局范围问题`);
  message += repairedParts.join("、") || "0项";
  message += "；复检结果：错误 " + errors + " / 警告 " + warnings;
  if (errors) {
    message += "。复检仍未通过；不能安全推断的真实创作事实不会自动编造。";
    if (unresolved.length) message += ` 尚需填写：${unresolved.slice(0, 3).join("、")}。`;
    if (firstError && firstError.message) message += " 请处理：" + firstError.message;
  }
  else if (warnings) message += "。非阻塞建议未被静默改写。";
  else message += "。";
  return message;
}

export function buildContinuationDirective() {
  return "Continuity anchor: Continue strictly from the exact final frame of the previous segment. "
    + "Preserve the same subject identity, screen position, pose, motion direction, camera orientation, lighting and unfinished action at the opening. "
    + "Do not return to an earlier scene or earlier visual style, do not replay the previous establishing shot, and do not introduce a jump cut. "
    + "Any intended scene or style transition must develop forward from this inherited frame.";
}

function durationFromPrompt(value) {
  let end = 0;
  const text = String(value || "");
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:-|~|～|至|到|—|–)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)/gi,
    /\[(\d+(?:\.\d+)?)s\s*-\s*(\d+(?:\.\d+)?)s\]/gi,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) end = Math.max(end, Number(match[2]) || 0);
  }
  return end;
}

function explicitDurationFromPrompt(value) {
  const match = String(value || "").match(/(?:^|\n)\s*时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)(?:[。.]|\s|$)/i);
  return match ? (Number(match[1]) || 0) : 0;
}

function stripArchiveListPrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/^\s*(?:(?:\d{1,3})\s*[.．、)]|[（(]\s*\d{1,3}\s*[）)]|[一二三四五六七八九十百]+\s*[、.．])\s*/, "")
    .trim();
}

function parseArchiveAssetLines(lines, type) {
  const out = [];
  let current = null;
  for (const raw of lines) {
    const line = stripArchiveListPrefix(raw);
    if (!line || /^（.*）$/.test(line) || /^\(.*\)$/.test(line)) continue;
    const match = line.match(/^([^,，:：]{1,80})\s*[,，:：]\s*(.+)$/);
    if (match) {
      current = { name: match[1].trim(), description: match[2].trim(), type };
      out.push(current);
    } else if (current) {
      current.description = (current.description + " " + line).trim();
    }
  }
  const prefix = H3_ASSET_TYPES[type].prefix;
  out.forEach((asset, index) => { asset.asset_id = prefix + (index + 1); });
  return out;
}

function structuredJsonAsset(value, type, index) {
  const raw = value && typeof value === "object" ? value : { name: value };
  const name = String(raw.name || raw.label || raw.title || raw.character || raw.role || "").trim();
  if (!name) return null;
  const prefix = H3_ASSET_TYPES[type].prefix;
  const assetId = String(raw.asset_id || raw.assetId || raw.id || "").trim();
  return {
    name,
    type,
    asset_id: new RegExp("^" + prefix + "\\d+$", "i").test(assetId) ? assetId.toUpperCase() : prefix + (index + 1),
    description: String(raw.description || raw.profile || raw.appearance || raw.prompt || "").trim(),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map((item) => String(item || "").trim()).filter(Boolean)
      : String(raw.aliases || "").split(/[，,;；\n]/).map((item) => item.trim()).filter(Boolean),
  };
}

function structuredJsonPrompt(raw) {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const ref2vaFields = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "overall_soundscape", "non_diegetic_music"];
  if (ref2vaFields.every((key) => typeof raw[key] === "string")) {
    return ref2vaFields.map((key) => `${key}:\n${String(raw[key] || "").trim()}`).join("\n\n");
  }
  const baseFields = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  if (baseFields.every((key) => typeof raw[key] === "string")) {
    return baseFields.map((key) => `${key}:\n${String(raw[key] || "").trim()}`).join("\n\n");
  }
  for (const key of ["prompt", "content", "text", "script", "description", "detailed_description"]) {
    if (typeof raw[key] === "string" && raw[key].trim()) return raw[key].trim();
  }
  const parts = [];
  for (const key of ["title", "scene", "action", "camera", "dialogue", "audio"]) {
    if (typeof raw[key] === "string" && raw[key].trim()) parts.push(`${key}: ${raw[key].trim()}`);
  }
  return parts.join("\n");
}

function structuredJsonAssetMentions(raw) {
  if (!raw || typeof raw !== "object") return [];
  const values = [];
  for (const key of ["asset_ids", "assetIds", "references", "characters", "roles", "character_ids",
    "scene", "scenes", "scene_ids", "props", "prop_ids", "items"]) {
    const value = raw[key];
    for (const item of (Array.isArray(value) ? value : value == null ? [] : [value])) {
      const token = item && typeof item === "object"
        ? item.asset_id || item.assetId || item.id || item.name || item.label
        : item;
      if (token != null && String(token).trim()) values.push(String(token).trim());
    }
  }
  return [...new Set(values)];
}

/**
 * 解析导演台可移植结构化 JSON。只接受明确字段，不根据任意自然语言猜角色或资产。
 * 支持 segments/shots/storyboards 数组、角色/场景/道具定义，以及官方 Base/Ref2VA 字段对象。
 */
export function parseH3StructuredJson(value) {
  const sourceText = stripMarkdownFence(value).trim();
  if (!/^[\[{]/.test(sourceText)) return null;
  let parsed;
  try { parsed = JSON.parse(sourceText); } catch (error) { return null; }
  const root = Array.isArray(parsed) ? { segments: parsed } : parsed;
  if (!root || typeof root !== "object") return null;

  const isShotLike = (item) => typeof item === "string" || !!(item && typeof item === "object"
    && ["prompt", "content", "text", "script", "detailed_description", "duration", "duration_seconds",
      "start", "end", "start_time", "end_time"].some((key) => item[key] != null));
  let rawSegments = [];
  for (const key of ["segments", "shots", "storyboards", "storyboard", "clips", "scenes"]) {
    if (Array.isArray(root[key]) && root[key].some(isShotLike)) {
      rawSegments = root[key];
      break;
    }
  }
  if (!rawSegments.length && structuredJsonPrompt(root)) rawSegments = [root];
  if (!rawSegments.length) return null;

  const assetsRoot = root.assets && typeof root.assets === "object" && !Array.isArray(root.assets)
    ? root.assets : {};
  const assetSources = {
    character: [assetsRoot.character, assetsRoot.characters, assetsRoot.roles, root.characters, root.roles],
    scene: [assetsRoot.scene, assetsRoot.scenes, assetsRoot.locations, root.locations, root.environments,
      rawSegments === root.scenes ? null : root.scenes],
    prop: [assetsRoot.prop, assetsRoot.props, assetsRoot.items, root.props, root.items],
    general: [assetsRoot.general, assetsRoot.references, root.references],
  };
  const assets = { character: [], prop: [], scene: [], general: [] };
  for (const type of Object.keys(assets)) {
    const seen = new Set();
    for (const source of assetSources[type]) {
      for (const item of (Array.isArray(source) ? source : [])) {
        const asset = structuredJsonAsset(item, type, assets[type].length);
        const key = asset && normalizeAssetName(asset.name);
        if (!asset || seen.has(key)) continue;
        seen.add(key);
        assets[type].push(asset);
      }
    }
  }
  const allAssets = [...assets.character, ...assets.prop, ...assets.scene, ...assets.general];

  let allDurationsExplicit = true;
  const segments = [];
  for (let index = 0; index < rawSegments.length; index++) {
    const raw = rawSegments[index];
    const prompt = structuredJsonPrompt(raw);
    if (!prompt) continue;
    const item = raw && typeof raw === "object" ? raw : {};
    let duration = Number(item.duration_seconds ?? item.duration ?? item.seconds);
    if (!(duration > 0)) {
      const start = Number(item.start_time ?? item.start);
      const end = Number(item.end_time ?? item.end);
      duration = Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
    }
    if (!(duration > 0)) {
      duration = explicitDurationFromPrompt(prompt) || durationFromPrompt(prompt);
      allDurationsExplicit = false;
    }
    if (!(duration > 0)) duration = 10;
    const segment = {
      duration,
      prompt,
      structuredIndex: index + 1,
      assetIds: structuredJsonAssetMentions(item),
    };
    if (typeof item.use_tail === "boolean") segment.plannedUseTail = item.use_tail;
    else if (typeof item.continue_previous === "boolean") segment.plannedUseTail = item.continue_previous;
    segments.push(segment);
  }
  if (!segments.length) return null;

  const explicitTotal = Number(root.source_total_duration_seconds ?? root.total_duration_seconds
    ?? root.total_duration ?? root.duration);
  segments.sourceDuration = explicitTotal > 0
    ? explicitTotal : segments.reduce((sum, segment) => sum + Number(segment.duration || 0), 0);
  segments.sourceDurationAuthoritative = explicitTotal > 0 || allDurationsExplicit;
  segments.sourceFormat = "structured-json";
  segments.structured = true;
  segments.structuredFormat = "json";
  segments.assetDefinitions = allAssets;
  segments.official = segments.every((segment) => /^\s*(?:integrated_multimodal_description|subject_definitions)\s*:/i.test(segment.prompt));
  segments.officialFormat = segments.every((segment) => /^\s*subject_definitions\s*:/i.test(segment.prompt))
    ? "ref2va" : segments.every((segment) => /^\s*integrated_multimodal_description\s*:/i.test(segment.prompt)) ? "base" : "";
  segments.officialLabel = segments.officialFormat === "ref2va" ? "结构化 JSON · 官方 Ref2VA"
    : segments.officialFormat === "base" ? "结构化 JSON · 官方 Base" : "结构化 JSON 分镜";
  segments.globalStyle = String(root.global_prompt || root.globalPrompt || root.global_style || root.style || "").trim();
  segments.globalExtra = "";
  segments.warnings = [];
  return segments;
}

/** 解析“整体风格/角色档案/道具档案/场景档案/分镜”短剧格式。 */
export function parseH3Archive(value) {
  const text = stripMarkdownFence(value);
  const sectionLines = { style: [], character: [], prop: [], scene: [] };
  const shots = [];
  let section = null;
  let shot = null;

  const flushShot = () => {
    if (!shot) return;
    shot.prompt = shot.lines.join("\n").trim();
    shot.duration = explicitDurationFromPrompt(shot.prompt) || durationFromPrompt(shot.prompt);
    delete shot.lines;
    shots.push(shot);
    shot = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const sectionMatch = line.match(/^\s*\[(整体风格|角色档案|道具档案|场景档案)\]\s*[:：]?\s*(.*)$/);
    if (sectionMatch) {
      flushShot();
      const map = { 整体风格: "style", 角色档案: "character", 道具档案: "prop", 场景档案: "scene" };
      section = map[sectionMatch[1]];
      if (sectionMatch[2]) sectionLines[section].push(sectionMatch[2]);
      continue;
    }
    const shotMatch = line.match(/^\s*\[分镜\s*(\d+)\]\s*[:：]?\s*(.*)$/i);
    if (shotMatch) {
      flushShot();
      section = null;
      const title = shotMatch[2].trim();
      const bracketedScene = title.match(/^[\[【]\s*([^\]】]+?)\s*[\]】]\s*(?:[-—–]|$)/);
      const sceneName = (bracketedScene
        ? bracketedScene[1]
        : (title.split(/\s*[-—–]\s*/, 1)[0] || ""))
        .trim()
        .replace(/^[\[【]\s*|\s*[\]】]$/g, "");
      shot = { number: Number(shotMatch[1]), title, sceneName, lines: [] };
      continue;
    }
    if (shot) shot.lines.push(line);
    else if (section) sectionLines[section].push(line);
  }
  flushShot();

  const assets = {
    character: parseArchiveAssetLines(sectionLines.character, "character"),
    prop: parseArchiveAssetLines(sectionLines.prop, "prop"),
    scene: parseArchiveAssetLines(sectionLines.scene, "scene"),
  };
  const allAssets = [...assets.character, ...assets.prop, ...assets.scene];
  const globalStyle = sectionLines.style.join("\n").trim();
  const globalPromptParts = [];
  if (globalStyle) globalPromptParts.push("[整体风格]\n" + globalStyle);
  const appendAssets = (label, items) => {
    if (!items.length) return;
    globalPromptParts.push(`[${label}]\n` + items
      .map((asset) => `${asset.name}：${asset.description}`)
      .join("\n"));
  };
  appendAssets("角色定义", assets.character);
  appendAssets("道具定义", assets.prop);
  appendAssets("场景定义", assets.scene);
  return {
    recognized: !!(globalStyle || allAssets.length || shots.length),
    format: "archive",
    label: "中文档案分镜",
    globalStyle,
    globalPrompt: globalPromptParts.join("\n\n").trim(),
    assets,
    allAssets,
    segments: shots,
    sourceText: text,
  };
}

/** 把中文档案中的每个 [分镜N] 转成一个生成段；分镜内部时间块不会再次拆分。 */
export function buildH3ArchiveImportSegments(parsedOrText) {
  const parsed = typeof parsedOrText === "string" ? parseH3Archive(parsedOrText) : parsedOrText;
  if (!parsed || !parsed.recognized || !Array.isArray(parsed.segments) || !parsed.segments.length) return [];
  const segments = parsed.segments.map((shot) => ({
    duration: Number(shot.duration) || 0,
    prompt: [
      shot.title ? `[分镜${shot.number}]：${shot.title}` : "",
      String(shot.prompt || "").trim(),
    ].filter(Boolean).join("\n"),
    archiveNumber: Number(shot.number) || 0,
    archiveTitle: String(shot.title || ""),
    archiveSceneName: String(shot.sceneName || ""),
  }));
  segments.globalExtra = "";
  segments.globalStyle = String(parsed.globalPrompt || parsed.globalStyle || "");
  segments.official = false;
  segments.structured = true;
  segments.structuredFormat = "archive";
  segments.assetDefinitions = parsed.allAssets.map((asset) => ({ ...asset }));
  segments.officialLabel = parsed.label || "中文档案分镜";
  segments.sourceDuration = parsed.segments.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0);
  segments.sourceDurationAuthoritative = true;
  segments.sourceFormat = "chinese-archive";
  segments.warnings = [];
  return segments;
}

/** 检查叙事源时长与 H3 合法帧档位吸附后的导入时长是否守恒。 */
export function evaluateDurationConservation(sourceDuration, segments = []) {
  const source = Number(sourceDuration) || 0;
  const imported = (segments || []).reduce((sum, segment) => sum + (Number(segment && segment.duration) || 0), 0);
  const segmentCount = (segments || []).length;
  const drift = imported - source;
  const ratio = source > 0 ? imported / source : 0;
  const tolerance = Math.max(2, 0.4 * segmentCount);
  const hasContract = source > 0 && imported > 0;
  const ok = !hasContract || (Math.abs(drift) <= tolerance && ratio >= 0.95 && ratio <= 1.05);
  return { ok, hasContract, sourceDuration: source, importedDuration: imported,
    drift, ratio, tolerance, segmentCount };
}

function readSegmentDurationContract(segment, index) {
  if (!segment || typeof segment !== "object") return null;
  const nested = segment.source_contract && typeof segment.source_contract === "object"
    ? segment.source_contract : {};
  const textValues = (keys, nestedKeys = keys) => [
    ...keys.map((key) => segment[key]),
    ...nestedKeys.map((key) => nested[key]),
  ].map((value) => String(value == null ? "" : value).trim()).filter(Boolean);
  const numberValues = (keys, nestedKeys = keys) => [
    ...keys.map((key) => segment[key]),
    ...nestedKeys.map((key) => nested[key]),
  ].filter((value) => value != null && value !== "").map(Number);
  const uniqueText = (values, label, caseSensitive = false) => {
    const unique = [];
    for (const value of values) {
      const marker = caseSensitive ? value : value.toLowerCase();
      if (!unique.some((entry) => entry.marker === marker)) unique.push({ marker, value });
    }
    return unique.length > 1
      ? { error: `第 ${index + 1} 段的 ${label} 不一致：${unique.map((entry) => entry.value).join(" / ")}` }
      : { value: unique.length ? unique[0].value : "" };
  };
  const totals = numberValues(
    ["source_total_duration", "source_total_duration_seconds"],
    ["source_total_duration", "source_total_duration_seconds", "total_duration", "total_duration_seconds"]);
  if (!totals.length) return null;
  if (totals.some((value) => !Number.isFinite(value) || value <= 0)) {
    return { error: `第 ${index + 1} 段的权威源总时长不是大于 0 的有限数字。` };
  }
  if (totals.some((value) => Math.abs(value - totals[0]) > 0.001)) {
    return { error: `第 ${index + 1} 段的权威源总时长不一致：${totals.join(" / ")}` };
  }
  const formats = uniqueText(textValues(
    ["source_format", "source_format_id"],
    ["format", "format_id", "source_format", "source_format_id"]), "source format");
  if (formats.error) return formats;
  const policies = uniqueText(textValues(
    ["source_duration_policy", "duration_policy"],
    ["source_duration_policy", "duration_policy"]), "duration policy");
  if (policies.error) return policies;
  const ids = uniqueText(textValues(
    ["source_contract_id", "source_duration_contract_id"],
    ["contract_id", "source_contract_id", "source_duration_contract_id"]), "source_contract_id", true);
  if (ids.error) return ids;

  const authorityValues = [
    segment.source_duration_authoritative, segment.source_total_duration_authoritative,
    segment.duration_authoritative, nested.source_duration_authoritative,
    nested.source_total_duration_authoritative, nested.duration_authoritative,
  ];
  const kind = textValues(
    ["source_duration_kind", "source_duration_basis", "duration_basis"],
    ["source_duration_kind", "source_duration_basis", "duration_basis"]).join(" ").toLowerCase();
  const format = String(formats.value || "").toLowerCase();
  const policy = String(policies.value || "").toLowerCase();
  const authoritativeFormats = new Set([
    "official-base", "official_base", "official-ref2va", "official_ref2va",
    "chinese-archive", "chinese_archive", "structured-markdown-screenplay",
    "structured_markdown_screenplay", "markdown-screenplay", "director-manifest",
  ]);
  const explicitlyAuthoritative = authorityValues.some((value) => value === true)
    || /(?:authoritative|explicit|timeline|timecode|manifest|preserve)/.test(kind);
  const explicitlyEstimated = authorityValues.some((value) => value === false)
    || /(?:estimate|estimated|ordinary-text-estimate|reading-speed|heuristic)/.test(kind)
    || format === "ordinary-text" || format === "ordinary_text";
  const allowRetime = /^(?:retime|allow-retime|allow_retime|override|stretch|ignore)$/.test(policy);
  if (allowRetime) return null;
  if (explicitlyEstimated && !explicitlyAuthoritative && !authoritativeFormats.has(format)) return null;
  if (!explicitlyAuthoritative && !authoritativeFormats.has(format)
      && !/^(?:preserve|strict|conserve)$/.test(policy)) return null;

  const starts = numberValues(
    ["source_segment_start_seconds", "segment_start_seconds"],
    ["source_segment_start_seconds", "segment_start_seconds"]);
  const ends = numberValues(
    ["source_segment_end_seconds", "segment_end_seconds"],
    ["source_segment_end_seconds", "segment_end_seconds"]);
  if ((starts.length > 0) !== (ends.length > 0)) {
    return { error: `第 ${index + 1} 段的源区间必须同时包含 start 和 end。` };
  }
  if (starts.some((value) => !Number.isFinite(value) || value < 0)
      || ends.some((value) => !Number.isFinite(value) || value < 0)
      || starts.some((value) => Math.abs(value - starts[0]) > 0.001)
      || ends.some((value) => Math.abs(value - ends[0]) > 0.001)
      || (starts.length && ends[0] <= starts[0])) {
    return { error: `第 ${index + 1} 段的源区间无效。` };
  }
  return {
    index,
    source: totals[0],
    id: ids.value || "",
    format,
    policy,
    start: starts.length ? starts[0] : null,
    end: ends.length ? ends[0] : null,
    segment,
  };
}

/**
 * 当前分段带显式 source contract 时逐契约组守恒；无契约旧流程继续使用脚本源时长全局检查。
 * enabled 只控制执行，不改变契约成员。无契约的手动追加段不会被已有完整契约认领。
 */
export function evaluateScopedDurationConservation(segments = [], fallbackSourceDuration = 0) {
  const entries = [];
  for (let index = 0; index < (segments || []).length; index++) {
    const entry = readSegmentDurationContract(segments[index], index);
    if (entry && entry.error) {
      return { ok: false, hasContract: true, scoped: true, error: entry.error, groups: [] };
    }
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    return { ...evaluateDurationConservation(fallbackSourceDuration, segments), scoped: false, groups: [] };
  }

  const groups = [];
  const byId = new Map();
  const legacyGlobal = new Map();
  let legacySpanCurrent = null;
  const addGroup = (kind, entry, label) => {
    const group = {
      kind, label, id: entry.id || "", source: entry.source,
      format: entry.format, policy: entry.policy, members: [], lastEnd: null,
    };
    groups.push(group);
    return group;
  };
  const compatible = (group, entry) => {
    if (Math.abs(group.source - entry.source) > 0.001) {
      return `同一 source_contract_id 的源总时长冲突：${group.source.toFixed(3)} / ${entry.source.toFixed(3)} 秒。`;
    }
    if (group.format && entry.format && group.format !== entry.format) {
      return `同一 source_contract_id 的格式冲突：${group.format} / ${entry.format}。`;
    }
    if (group.policy && entry.policy && group.policy !== entry.policy) {
      return `同一 source_contract_id 的时长策略冲突：${group.policy} / ${entry.policy}。`;
    }
    if (!group.format) group.format = entry.format;
    if (!group.policy) group.policy = entry.policy;
    return "";
  };

  for (const entry of entries) {
    let group;
    if (entry.id) {
      legacySpanCurrent = null;
      group = byId.get(entry.id);
      if (!group) {
        group = addGroup("id", entry, `契约 ${entry.id.slice(0, 24)}`);
        byId.set(entry.id, group);
      } else {
        const conflict = compatible(group, entry);
        if (conflict) return { ok: false, hasContract: true, scoped: true, error: conflict, groups };
      }
    } else if (entry.start != null) {
      const signature = `${entry.source.toFixed(6)}|${entry.format}|${entry.policy}`;
      const continues = legacySpanCurrent && legacySpanCurrent.signature === signature
        && legacySpanCurrent.lastEnd != null && entry.start >= legacySpanCurrent.lastEnd - 0.001
        && !(entry.start <= 0.001 && legacySpanCurrent.lastEnd > 0.001);
      if (!continues) {
        group = addGroup("legacy-span", entry, `旧契约区间组 ${groups.length + 1}`);
        group.signature = signature;
        legacySpanCurrent = group;
      } else group = legacySpanCurrent;
      group.lastEnd = entry.end;
    } else {
      legacySpanCurrent = null;
      const signature = `${entry.source.toFixed(6)}|${entry.format}|${entry.policy}`;
      group = legacyGlobal.get(signature);
      if (!group) {
        group = addGroup("legacy-global", entry, `旧契约组 ${groups.length + 1}`);
        legacyGlobal.set(signature, group);
      }
    }
    group.members.push(entry);
  }

  const ambiguousLegacyGlobals = groups.filter((group) => group.kind === "legacy-global");
  if (ambiguousLegacyGlobals.length > 1) {
    return {
      ok: false,
      hasContract: true,
      scoped: true,
      error: "检测到多组没有 source_contract_id 和源区间、但格式或总时长不同的旧权威契约。"
        + "无法安全判断它们是独立导入还是元数据损坏，请分别重新执行“解析导入”或“导入到当前段”。",
      groups,
    };
  }

  const contracted = new Set(entries.map((entry) => entry.index));
  for (const group of groups) {
    if (group.kind !== "legacy-global" || group.members.length !== 1) continue;
    const first = group.members[0];
    if ((Number(first.segment.duration) || 0) >= group.source * 0.95) continue;
    const laterContracts = entries.filter((entry) => entry.index > first.index).map((entry) => entry.index);
    const boundary = laterContracts.length ? Math.min(...laterContracts) : segments.length;
    for (let index = first.index + 1; index < boundary; index++) {
      if (contracted.has(index)) break;
      group.members.push({ index, segment: segments[index] });
    }
  }

  const results = groups.map((group) => {
    const result = evaluateDurationConservation(group.source, group.members.map((entry) => entry.segment));
    return { ...result, label: group.label, id: group.id, indices: group.members.map((entry) => entry.index + 1) };
  });
  const failedGroup = results.find((result) => !result.ok) || null;
  const sourceDuration = results.reduce((sum, result) => sum + result.sourceDuration, 0);
  const importedDuration = results.reduce((sum, result) => sum + result.importedDuration, 0);
  const fallback = Number(fallbackSourceDuration) || 0;
  const sourceMatches = !(fallback > 0) || results.some((result) => Math.abs(result.sourceDuration - fallback) <= 0.001)
    || Math.abs(sourceDuration - fallback) <= Math.max(0.001, 0.4 * results.length);
  return {
    ok: !failedGroup && sourceMatches,
    hasContract: true,
    scoped: true,
    sourceMismatch: !sourceMatches,
    requestedSourceDuration: fallback,
    sourceDuration,
    importedDuration,
    drift: importedDuration - sourceDuration,
    ratio: sourceDuration > 0 ? importedDuration / sourceDuration : 0,
    tolerance: results.reduce((sum, result) => sum + result.tolerance, 0),
    segmentCount: results.reduce((sum, result) => sum + result.segmentCount, 0),
    groupCount: results.length,
    groups: results,
    failedGroup,
  };
}

function nextAssetId(catalog, type) {
  const prefix = H3_ASSET_TYPES[type].prefix;
  let max = 0;
  for (const asset of catalog) {
    const match = String(asset.asset_id || "").match(new RegExp("^" + prefix + "(\\d+)$", "i"));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return prefix + (max + 1);
}

/** 合并剧本档案与已上传素材。相同类型、同名素材会自动绑定文件。 */
export function buildAssetCatalog(parsed, uploadedAssets = []) {
  const archive = parsed && Array.isArray(parsed.allAssets) ? parsed.allAssets : [];
  const catalog = archive.map((asset) => ({ ...asset, file: asset.file || "", source: "archive" }));
  for (const raw of uploadedAssets || []) {
    const type = normalizeAssetType(raw && raw.type);
    const name = String(raw && raw.name || "").trim();
    if (!name) continue;
    const key = normalizeAssetName(name);
    let existing = catalog.find((asset) => asset.type === type
      && normalizeAssetName(asset.name) === key && !asset.file);
    if (existing) {
      existing.file = String(raw.file || "");
      existing.asset_id = String(raw.asset_id || existing.asset_id || nextAssetId(catalog, type));
      existing.source = "archive+upload";
      continue;
    }
    const item = {
      name,
      type,
      file: String(raw.file || ""),
      asset_id: String(raw.asset_id || ""),
      description: String(raw.description || ""),
      aliases: Array.isArray(raw.aliases) ? raw.aliases.slice() : String(raw.aliases || "")
        .split(/[，,;；\n]/).map((value) => value.trim()).filter(Boolean),
      filename: String(raw.filename || raw.original_name || raw.file || ""),
      source: "upload",
    };
    if (!item.asset_id) item.asset_id = nextAssetId(catalog, type);
    catalog.push(item);
  }
  return catalog;
}

function assetMatchNames(asset) {
  const rawAliases = Array.isArray(asset && asset.aliases) ? asset.aliases
    : String(asset && asset.aliases || "").split(/[，,;；\n]/);
  const filename = String(asset && (asset.filename || asset.original_name || asset.file) || "")
    .replace(/\\/g, "/").split("/").pop().replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[_\-]+/g, " ").trim();
  const values = [asset && asset.asset_id, asset && asset.name, ...rawAliases, filename]
    .map((value) => String(value || "").trim()).filter(Boolean);
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeAssetName(value);
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 按完整资产名、用户别名和原图片文件名匹配，并按文本中首次出现顺序排列。 */
export function matchAssetsToSegment(prompt, catalog) {
  const normalizedPrompt = normalizeAssetName(prompt);
  const matches = [];
  for (let index = 0; index < (catalog || []).length; index++) {
    const asset = catalog[index];
    let at = -1;
    let matchedLength = 0;
    for (const value of assetMatchNames(asset)) {
      const key = normalizeAssetName(value);
      const position = normalizedPrompt.indexOf(key);
      if (position >= 0 && (at < 0 || position < at || (position === at && key.length > matchedLength))) {
        at = position;
        matchedLength = key.length;
      }
    }
    if (at >= 0) matches.push({ asset, at, matchedLength, index });
  }
  matches.sort((a, b) => a.at - b.at || b.matchedLength - a.matchedLength || a.index - b.index);
  const seen = new Set();
  return matches.map((item) => item.asset).filter((asset) => {
    const key = String(asset.file || "") || asset.type + ":" + normalizeAssetName(asset.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 在不改变手工顺序的前提下去除重复参考资产。 */
export function uniqueH3SegmentAssets(assets = []) {
  const seen = new Set();
  const result = [];
  for (const asset of assets || []) {
    const type = normalizeAssetType(asset && asset.type);
    const key = String(asset && asset.file || "") || type + ":" + normalizeAssetName(asset && asset.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result;
}

/**
 * 明确要求无人、空镜或人物已经离场的段，不能再通过继承或 API 兜底加回角色参考。
 * 该判断同时供本地连续性规划和创作页 API 缺失类型计算使用，避免两条路径规则漂移。
 */
export function h3SegmentDisallowsCharacters(prompt = "") {
  return /(?:无人|空镜|空无一人|没有人物|无人物|人物(?:全部)?离场|角色(?:全部)?离场|主角离场|所有人离开|no\s+(?:people|person|character)|empty\s+shot)/i
    .test(String(prompt || ""));
}

/**
 * 普通剧本的确定性本地分配：显式名称优先；连续段可继承；无人/空镜/离场停止人物继承；
 * 明确换场但未匹配到新场景时不把旧场景偷偷带入。API 只能在此结果之后补充不确定项。
 */
export function planH3LocalAssetAssignments(prompts = [], catalog = []) {
  const library = Array.isArray(catalog) ? catalog : [];
  const assetsOfType = (assets, type) => (assets || [])
    .filter((asset) => normalizeAssetType(asset && asset.type) === type);
  const hasType = (assets, type) => assetsOfType(assets, type).length > 0;
  const soleGeneral = assetsOfType(library, "general").length === 1
    ? assetsOfType(library, "general")[0] : null;
  const assignments = [];
  let previous = [];
  for (let index = 0; index < prompts.length; index++) {
    const prompt = String(prompts[index] && prompts[index].prompt != null
      ? prompts[index].prompt : prompts[index] || "");
    const direct = uniqueH3SegmentAssets(matchAssetsToSegment(prompt, library));
    const inherited = [];
    const stopsCharacters = h3SegmentDisallowsCharacters(prompt);
    const changesScene = /(?:换场|场景(?:切换|变为|转为)|切换(?:到|至)|转到|来到|进入(?:新的)?(?:场景|房间|大厅|街道|森林|海边)|cut\s+to|new\s+scene)/i.test(prompt);
    const continuesAction = /(?:继续|仍然|依然|保持|承接|上一镜|同一|随后|紧接|他|她|他们|她们|主角|then|continue|same)/i.test(prompt);
    if (index > 0) {
      if (!stopsCharacters && !hasType(direct, "character")) {
        inherited.push(...assetsOfType(previous, "character"));
      }
      if (!changesScene && !hasType(direct, "scene")) inherited.push(...assetsOfType(previous, "scene"));
      if (!hasType(direct, "general")) inherited.push(...assetsOfType(previous, "general"));
      if (!hasType(direct, "prop") && continuesAction) inherited.push(...assetsOfType(previous, "prop"));
    }
    if (!hasType(direct, "general") && !hasType(inherited, "general") && soleGeneral) {
      inherited.push(soleGeneral);
    }
    const selected = uniqueH3SegmentAssets(stopsCharacters
      ? [...direct.filter((asset) => normalizeAssetType(asset.type) !== "character"), ...inherited]
      : [...direct, ...inherited]);
    assignments.push(selected);
    previous = selected;
  }
  return assignments;
}

/** 把项目稳定 ID 映射为本段实际 Subject/Picture 顺序。 */
export function formatAssetBinding(assets, useTail = false) {
  if (!Array.isArray(assets) || !assets.length) return "";
  const pictureOffset = useTail ? 1 : 0;
  const lines = assets.map((asset, index) => {
    const type = normalizeAssetType(asset.type);
    const spec = H3_ASSET_TYPES[type];
    const subject = index + 1;
    const picture = index + 1 + pictureOffset;
    return `<Subject ${subject}> is the ${spec.subject} ${asset.asset_id || spec.prefix + subject} "${asset.name}" defined by <Picture ${picture}>.`;
  });
  return "Reference asset bindings (project IDs stay stable; Subject/Picture numbers follow this segment's image order):\n"
    + lines.join("\n")
    + "\nReference identity contract: Each bound Picture is the authoritative visual identity and fixed appearance for that asset; preserve the pictured face, hair, age, body shape, hat, clothing, signature accessories, colors and material design when applicable. The surrounding text may direct action, camera, emotion and scene, but must not redesign those fixed visual traits.";
}

function countSpeechUnits(value) {
  const text = String(value || "");
  const cjk = (text.match(/[一-鿿]/g) || []).length;
  const words = (text.replace(/[一-鿿]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
  return cjk + words;
}

function extractDialogue(value) {
  const text = String(value || "");
  const parts = [];
  for (const match of text.matchAll(/<d>\s*\[[^\]]+\]\s*([\s\S]*?)<\/d>/gi)) parts.push(match[1]);
  for (const match of text.matchAll(/(?:说|说道|问|喊|答|对白)\s*[:：]?\s*["“]([^"”]{1,500})["”]/g)) parts.push(match[1]);
  return parts.join(" ");
}

function maxPictureNumber(value) {
  let max = 0;
  for (const match of String(value || "").matchAll(/<Picture\s+(\d+)>/gi)) max = Math.max(max, Number(match[1]) || 0);
  return max;
}

function hasNonDiegeticMusic(value) {
  const match = String(value || "").match(/non_diegetic_music\s*[:：]\s*([^\n]+)/i);
  if (!match) return false;
  return !/^\s*(?:N\/?A|none|无|没有|不使用)\s*[.。]?\s*$/i.test(match[1]);
}

function motionBlocks(value) {
  const text = String(value || "");
  const marks = [];
  const re = /(?:^|\n)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:-|~|～|至|到|—|–)\s*(\d+(?:\.\d+)?)\s*(?:秒|s)\s*[:：]/gi;
  let match;
  while ((match = re.exec(text))) marks.push({
    start: Number(match[1]), end: Number(match[2]), headerStart: match.index, bodyStart: re.lastIndex,
  });
  return marks.map((item, index) => ({
    ...item,
    body: text.slice(item.bodyStart, index + 1 < marks.length ? marks[index + 1].headerStart : text.length),
  }));
}

/* 在生产前检查里识别“看起来在写官方模板、但字段不完整”的源文本。
   纯旧 Shot 时间线（完全没有官方字段）保持普通文本兼容；一旦出现官方字段，
   就不能静默降级为普通提示词。 */
export function detectIncompleteOfficialTemplateSource(sourceText = "") {
  const source = String(sourceText || "").replace(/^\uFEFF/, "").trim();
  if (!source) return null;
  const names = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music", "director_import_manifest"];
  const fieldRe = new RegExp(`(?:^|\\n)\\s*(${names.join("|")})\\s*[:：]\\s*`, "gi");
  const marks = [];
  let match;
  while ((match = fieldRe.exec(source))) {
    marks.push({ name: match[1].toLowerCase(), start: match.index + (match[0].charAt(0) === "\n" ? 1 : 0), end: fieldRe.lastIndex });
  }
  const fieldNames = marks.map((mark) => mark.name);
  const countOf = (name) => fieldNames.filter((candidate) => candidate === name).length;
  const fieldBody = (index) => source.slice(marks[index].end, index + 1 < marks.length ? marks[index + 1].start : source.length).trim();
  const hasOneNonEmpty = (name) => {
    const index = fieldNames.indexOf(name);
    return index >= 0 && countOf(name) === 1 && !!fieldBody(index);
  };
  const baseRequired = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  const refRequired = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "overall_soundscape", "non_diegetic_music"];
  const hasRef = refRequired.slice(0, 4).some((name) => countOf(name) > 0);
  const hasBase = countOf("integrated_multimodal_description") > 0;
  const hasShot = /\[Shot\s+\d+\s*\]/i.test(source);
  const hasAudioSignal = countOf("overall_soundscape") > 0 || countOf("non_diegetic_music") > 0;
  const hasManifest = countOf("director_import_manifest") > 0;
  const resemblesOfficial = hasBase || hasRef || hasManifest || (hasShot && hasAudioSignal);
  if (!resemblesOfficial) return null;

  const inOrder = (required) => {
    const positions = required.map((name) => fieldNames.indexOf(name));
    return positions.every((position) => position >= 0)
      && positions.every((position, index) => index === 0 || position > positions[index - 1]);
  };
  const manifestIndex = fieldNames.indexOf("director_import_manifest");
  const manifestLast = manifestIndex < 0 || manifestIndex === fieldNames.length - 1;
  const completeBase = !hasRef && baseRequired.every(hasOneNonEmpty) && inOrder(baseRequired) && manifestLast;
  const completeRef = !hasBase && refRequired.every(hasOneNonEmpty) && inOrder(refRequired) && manifestLast;
  if (completeBase || completeRef) return null;

  const required = hasRef ? refRequired : baseRequired;
  const missing = required.filter((name) => !hasOneNonEmpty(name));
  if (!manifestLast) missing.push("director_import_manifest 必须位于最后");
  return {
    code: "official_incomplete_template",
    message: "源文本看起来是 H3 官方 " + (hasRef ? "Ref2VA 六字段" : "Base 三字段")
      + "，但" + (missing.length ? "缺少或留空 " + missing.join("、") : "字段顺序或重复字段不正确")
      + "。请先生成或修复完整官方模板。",
  };
}

/**
 * 生产前检查。segments: [{prompt,duration,refs,use_tail}]；catalog 可同时包含档案和上传素材。
 */
export function validateH3ProductionPlan({ sourceText = "", segments = [], catalog = [], formatLabel = "",
  sourceDuration = 0, sourceSegmentCount = 0, globalPrompt = "", sharedRefCount = 0,
  aspectContractText = "", workflowWidth = 0, workflowHeight = 0 } = {}) {
  const issues = [];
  const push = (severity, code, message, segment = 0) => issues.push({ severity, code, message, segment });
  const parsed = parseH3Archive(sourceText);
  const normalizedSegments = (segments || []).map((segment, index) => {
    const overrideWidth = Number(segment && segment.width) || 0;
    const overrideHeight = Number(segment && segment.height) || 0;
    const useOverride = overrideWidth >= 256 && overrideHeight >= 256;
    return {
      prompt: String(segment && segment.prompt || ""),
      duration: Number(segment && segment.duration) || durationFromPrompt(segment && segment.prompt) || 0,
      enabled: !(segment && segment.enabled === false),
      refs: Array.isArray(segment && segment.refs) ? segment.refs : [],
      use_tail: !!(segment && segment.use_tail) && index > 0,
      inherit_shared: !(segment && segment.inherit_shared === false),
      source_total_duration: segment && segment.source_total_duration,
      source_total_duration_seconds: segment && segment.source_total_duration_seconds,
      source_duration_authoritative: segment && segment.source_duration_authoritative,
      source_total_duration_authoritative: segment && segment.source_total_duration_authoritative,
      source_duration_kind: segment && segment.source_duration_kind,
      source_duration_basis: segment && segment.source_duration_basis,
      source_format: segment && segment.source_format,
      source_format_id: segment && segment.source_format_id,
      source_duration_policy: segment && segment.source_duration_policy,
      duration_policy: segment && segment.duration_policy,
      source_contract_id: segment && segment.source_contract_id,
      source_contract: segment && segment.source_contract && typeof segment.source_contract === "object"
        ? { ...segment.source_contract } : null,
      width: useOverride ? overrideWidth : (Number(workflowWidth) || 0),
      height: useOverride ? overrideHeight : (Number(workflowHeight) || 0),
      asset_confirmation_required: !!(segment && segment.asset_confirmation_required),
      asset_confirmation_missing_types: Array.isArray(segment && segment.asset_confirmation_missing_types)
        ? segment.asset_confirmation_missing_types.map(normalizeAssetType) : [],
    };
  });
  const executionPromptText = normalizedSegments.map((segment) => segment.prompt).filter(Boolean).join("\n");

  if (!normalizedSegments.length) push("error", "no_segments", "没有可检查的分镜段。", 0);
  const sourceOnlyPlaceholders = findH3PromptPlaceholders(sourceText)
    .filter((placeholder) => !executionPromptText.includes(placeholder));
  if (sourceOnlyPlaceholders.length) {
    push("error", "source_placeholder",
      `脚本源仍有未替换占位符：${sourceOnlyPlaceholders.slice(0, 3).join("、")}。重新解析时会再次带入，请先填写或使用安全修复。`, 0);
  }
  const globalPlaceholders = findH3PromptPlaceholders(globalPrompt);
  if (globalPlaceholders.length) {
    push("error", "global_placeholder",
      `全局提示词仍有未替换占位符：${globalPlaceholders.slice(0, 3).join("、")}。`, 0);
  }
  const totalDuration = normalizedSegments.reduce((sum, segment) => sum + segment.duration, 0);
  const durationContract = evaluateScopedDurationConservation(normalizedSegments, sourceDuration);
  if (!durationContract.ok) {
    if (durationContract.scoped) {
      const failed = durationContract.failedGroup;
      const detail = durationContract.error
        || (durationContract.sourceMismatch
          ? `脚本源时间轴 ${Number(sourceDuration).toFixed(1)} 秒与当前分段保存的 ${durationContract.groupCount} 个权威契约组不一致`
          : failed
            ? `${failed.label}（原时间轴第 ${failed.indices.join("、")} 段）源 ${failed.sourceDuration.toFixed(1)} 秒、组内合计 ${failed.importedDuration.toFixed(1)} 秒（${(failed.ratio * 100).toFixed(1)}%）`
            : "当前权威源契约无效");
      push("warn", "duration_not_conserved",
        `${detail}。该提示不会阻止生成；如果成片时长不符合预期，再重新解析有问题的官方源或把独立内容作为新段导入。`, 0);
    } else {
    const sourceSegmentsLabel = Number(sourceSegmentCount) > 0
      ? `，脚本解析结果 ${Math.floor(Number(sourceSegmentCount))} 段`
      : "";
    push("warn", "duration_not_conserved",
      `当前分段共 ${normalizedSegments.length} 段、${durationContract.importedDuration.toFixed(1)} 秒，与脚本源时间轴 ${durationContract.sourceDuration.toFixed(1)} 秒${sourceSegmentsLabel}不一致（${(durationContract.ratio * 100).toFixed(1)}%）。该提示不会阻止生成；如果成片时长不符合预期，再点“⚡ 解析导入”重新同步分段。`, 0);
    }
  }
  const sourceTemplateIssue = detectIncompleteOfficialTemplateSource(sourceText);
  if (sourceTemplateIssue) push("error", sourceTemplateIssue.code, sourceTemplateIssue.message, 0);
  const projectAspect = detectAspectRatioContract(
    [String(aspectContractText || sourceText), String(globalPrompt || "")].filter(Boolean).join("\n"));
  if (projectAspect.ambiguous) {
    const issue = validateAspectRatioContract(projectAspect, workflowWidth, workflowHeight);
    push("warn", issue.code, `${issue.message} 该提示不会阻止生成。`, 0);
  } else if (!projectAspect.orientation && Number(workflowWidth) > 0 && Number(workflowHeight) > 0
      && /(?:像素|pixel|平台游戏|横版游戏|竖版闯关|角色选择|game menu|platformer|side[- ]scroll)/i.test(executionPromptText)) {
    const actual = Number(workflowWidth) > Number(workflowHeight) ? "横屏" : Number(workflowHeight) > Number(workflowWidth) ? "竖屏" : "方形";
    push("warn", "implicit_game_aspect",
      `剧本没有明确横竖画幅，当前工作流为 ${Math.round(Number(workflowWidth))}×${Math.round(Number(workflowHeight))}（${actual}）。游戏选角/像素平台内容会按该画幅重组空间；如需横版请在剧本明确16:9，如需短视频竖版请明确9:16。`, 0);
  }

  const timelineStyleContract = extractH3TimelineStyleContract(sourceText);
  if (timelineStyleContract.phases.length
      && /(?:integrated_multimodal_description|detailed_description)\s*[:：]/i.test(sourceText)) {
    const timelineShots = parseH3OfficialTimelineShots(sourceText,
      timelineStyleContract.sourceDuration || sourceDuration);
    const timelineResult = validateH3TimelineStyleContract({
      sourceDuration: timelineStyleContract.sourceDuration || sourceDuration,
      shots: timelineShots,
      phases: timelineStyleContract.phases,
    });
    for (const issue of timelineResult.issues) {
      /* 风格文字检查用于提醒连贯性和边界漂移，不应让小白无法先运行。
         官方模板结构、缺段等真正不可执行的问题仍由其它硬检查负责。 */
      const severity = issue.severity === "error" ? "warn" : issue.severity;
      push(severity, issue.code, issue.message, Number(issue.segment) || 0);
    }
  }

  for (const issue of detectGlobalPromptConflicts(globalPrompt, normalizedSegments)) {
    const severity = issue.severity === "error" ? "warn" : issue.severity;
    push(severity, issue.code, issue.message, issue.segment);
  }
  for (const issue of detectTailRenderBoundaryIssues(normalizedSegments)) {
    push(issue.severity, issue.code, issue.message, issue.segment);
  }

  const nameGroups = new Map();
  for (const asset of catalog || []) {
    const key = normalizeAssetName(asset.name);
    if (!key) continue;
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push(asset);
  }
  for (const group of nameGroups.values()) {
    if (group.length > 1) push("warn", "duplicate_asset", `资产重名：${group.map((x) => `${x.asset_id || "?"}/${x.name}`).join("、")}。`, 0);
  }

  const characterCount = (catalog || []).filter((asset) => normalizeAssetType(asset.type) === "character").length;
  const hasUploadedAssets = (catalog || []).some((asset) => !!asset.file);
  const unboundArchiveAssets = new Map();
  let hasMusicAcrossSegments = false;
  let warnedStrongStyleWithoutReference = false;
  let warnedTailStylePropagation = false;
  for (const issue of validateH3NarrativeExecutionQuality(executionPromptText, { checkStyle: false }).issues) {
    push(issue.severity, issue.code, issue.message, 0);
  }
  normalizedSegments.forEach((segment, index) => {
    const n = index + 1;
    const prompt = segment.prompt;
    const knownOfficialFields = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
      "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music", "director_import_manifest"];
    const fieldIndex = (name) => prompt.search(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]`, "i"));
    const fieldPositions = new Map(knownOfficialFields.map((name) => [name, fieldIndex(name)]));
    const fieldBody = (name) => {
      const index = fieldPositions.get(name);
      if (!(index >= 0)) return "";
      const marker = prompt.slice(index).match(new RegExp(`^(?:\\n)?\\s*${name}\\s*[:：]\\s*`, "i"));
      if (!marker) return "";
      const start = index + marker[0].length;
      let end = prompt.length;
      for (const otherIndex of fieldPositions.values()) {
        if (otherIndex > index && otherIndex < end) end = otherIndex;
      }
      return prompt.slice(start, end).trim();
    };
    const refRequired = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
      "overall_soundscape", "non_diegetic_music"];
    const baseRequired = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
    const isRefOfficial = refRequired.slice(0, 4).some((name) => fieldIndex(name) >= 0);
    const isBaseOfficial = !isRefOfficial && fieldIndex("integrated_multimodal_description") >= 0;
    const requiredFields = isRefOfficial ? refRequired : isBaseOfficial ? baseRequired : [];
    if (requiredFields.length) {
      const indices = requiredFields.map((name) => fieldPositions.get(name));
      const missing = requiredFields.filter((name, fieldPosition) => indices[fieldPosition] < 0 || !fieldBody(name));
      if (missing.length) {
        push("error", "official_missing_field", `第 ${n} 段缺少 H3 官方${isRefOfficial ? " Ref2VA 六字段" : " Base 三字段"}：${missing.join("、")}。`, n);
      } else if (indices.some((value, fieldPosition) => fieldPosition > 0 && value <= indices[fieldPosition - 1])) {
        push("error", "official_field_order", `第 ${n} 段的 H3 官方字段顺序不正确。`, n);
      }
    }
    if (requiredFields.length) {
      // Ref2VA 的 retention_analysis 合法地会引用“[Shot 1] 至 [Shot N]”。
      // 时间轴门禁只能检查真正承载镜头正文的字段，否则这些引用会被误判为
      // 缺少 At 的新镜头。Base 同理只检查 integrated_multimodal_description。
      const timelineBody = fieldBody(isRefOfficial
        ? "detailed_description"
        : "integrated_multimodal_description");
      const shotMarks = [...timelineBody.matchAll(/\[Shot\s+(\d+)\s*\]/gi)];
      shotMarks.forEach((mark, shotIndex) => {
        const end = shotIndex + 1 < shotMarks.length ? shotMarks[shotIndex + 1].index : timelineBody.length;
        const body = timelineBody.slice((mark.index || 0) + mark[0].length, end).trim();
        const prefix = parseOfficialShotPrefix(body);
        if (shotIndex === 0 && prefix.hadAt) {
          push("error", "official_first_shot_time", `第 ${n} 段的 [Shot 1] 不应写 At 时间；第一镜必须从本段 0 秒开始。`, n);
        }
        if (shotIndex > 0 && !prefix.hadAt) {
          push("error", "official_missing_at", `第 ${n} 段的 [Shot ${shotIndex + 1}] 缺少严格递增的 At 时间。`, n);
        }
        if (prefix.hadRange) {
          push("warn", "official_duplicate_range", `第 ${n} 段的 [Shot ${shotIndex + 1}] 仍带起止时间范围；应只保留官方 At 起点。`, n);
        }
      });
    }
    const executableShots = parseH3OfficialTimelineShots(prompt, segment.duration);
    if (executableShots.length) {
      const inheritedSharedForQuality = segment.inherit_shared ? Math.max(0, Number(sharedRefCount) || 0) : 0;
      const quality = validateH3ShotExecutionQuality({
        shots: executableShots,
        duration: segment.duration,
        text: prompt,
        checkNarrative: false,
        referenceCount: inheritedSharedForQuality + segment.refs.length,
        tailContinuation: segment.use_tail,
      });
      for (const issue of quality.issues) {
        if (issue.code === "strong_style_without_reference") {
          if (warnedStrongStyleWithoutReference) continue;
          warnedStrongStyleWithoutReference = true;
        }
        if (issue.code === "tail_style_error_propagation") {
          if (warnedTailStylePropagation) continue;
          warnedTailStylePropagation = true;
        }
        push(issue.severity, issue.code, `第 ${n} 段：${issue.message}`, n);
      }
    }
    if (fieldPositions.get("director_import_manifest") >= 0) {
      push("error", "director_manifest_leak", `第 ${n} 段包含 director_import_manifest；该清单只能用于导演台导入，不能发送给 H3。`, n);
    }
    if (segment.duration > 0 && segment.duration < 5 - 0.01) push("warn", "short_segment", `第 ${n} 段 ${segment.duration.toFixed(1)} 秒，低于短剧建议的 5 秒。`, n);
    if (segment.duration > 15.1) push("error", "long_segment", `第 ${n} 段 ${segment.duration.toFixed(1)} 秒，超过 H3 单段约 15 秒上限。`, n);
    if (!segment.duration) push("warn", "unknown_duration", `第 ${n} 段没有可识别时长，请手动确认。`, n);

    /* 官方长时间轴拆段后，提示词可能仍保留全片时间/风格契约作为身份与阶段说明。
       它不等同于导入时长膨胀；真正的源时长守恒已由 duration_not_conserved 单独检查。
       不再把这种范围文本显示成阻断性红色提醒。 */

    const localAspect = detectAspectRatioContract(prompt);
    if (localAspect.ambiguous) {
      const issue = validateAspectRatioContract(localAspect, segment.width, segment.height);
      push("error", issue.code, `第 ${n} 段：${issue.message}`, n);
    } else {
      if (!projectAspect.ambiguous && projectAspect.orientation && localAspect.orientation
          && projectAspect.orientation !== localAspect.orientation) {
        push("error", "aspect_contract_conflict",
          `第 ${n} 段的${localAspect.orientation === "portrait" ? "竖屏" : "横屏"}要求与全片画幅契约冲突。`, n);
      }
      const effectiveAspect = localAspect.orientation ? localAspect : projectAspect;
      const issue = validateAspectRatioContract(effectiveAspect, segment.width, segment.height);
      if (issue) push("error", issue.code, `第 ${n} 段：${issue.message}`, n);
    }

    if (/(同上|如前|位置不变|保持不变即可|前述不变)/.test(prompt)) {
      push("error", "omitted_state", `第 ${n} 段使用了“同上/如前/位置不变”等省略词，H3 需要完整重写空间、动作和光影。`, n);
    }
    if (characterCount > 1 && /(?:^|[^其])(?:他们|她们|他|她|对方|此人)/.test(prompt)) {
      push("warn", "ambiguous_pronoun", `第 ${n} 段存在可能串角色的代词，建议改为角色完整名称。`, n);
    }
    const promptPlaceholders = findH3PromptPlaceholders(prompt);
    if (promptPlaceholders.length) {
      push("error", "placeholder",
        `第 ${n} 段仍有未替换占位符：${promptPlaceholders.slice(0, 3).join("、")}。`, n);
    }

    for (const block of motionBlocks(prompt)) {
      const span = block.end - block.start;
      if (span > 6.05 && /(推|拉|移|跟随|环绕|升降|摇|甩|变焦|push|pull|pan|truck|track|arc|zoom|tilt)/i.test(block.body)) {
        push("warn", "long_camera_motion", `第 ${n} 段有 ${span.toFixed(1)} 秒的核心运镜，建议拆到 5–6 秒以内。`, n);
        break;
      }
    }

    const dialogue = extractDialogue(prompt);
    const speechUnits = countSpeechUnits(dialogue);
    if (speechUnits && segment.duration) {
      const rate = /(?:慢|缓慢)语速|语速\s*[:：]\s*(?:慢|缓)/.test(prompt) ? 2.5
        : /(?:快|极快)语速|语速\s*[:：]\s*(?:快|极快)/.test(prompt) ? 5.5 : 4;
      if (speechUnits > segment.duration * 5.5 + 0.01) {
        push("error", "speech_absolute", `第 ${n} 段台词约 ${speechUnits} 字/词，超过 ${segment.duration.toFixed(1)} 秒的绝对上限。`, n);
      } else if (speechUnits > segment.duration * rate + 0.01) {
        push("warn", "speech_rate", `第 ${n} 段台词约 ${speechUnits} 字/词，超过当前约 ${rate} 字/秒的建议容量。`, n);
      }
    }

    const pictureMax = maxPictureNumber(prompt);
    const inheritedShared = segment.inherit_shared ? Math.max(0, Number(sharedRefCount) || 0) : 0;
    const availablePictures = inheritedShared + segment.refs.length + (segment.use_tail ? 1 : 0);
    if (pictureMax > availablePictures && availablePictures >= 0) {
      push("error", "missing_picture", `第 ${n} 段引用到 <Picture ${pictureMax}>，但当前只有 ${availablePictures} 张可用图片（含尾帧）。`, n);
    }
    const tailPictureNo = inheritedShared + 1;
    if (segment.use_tail && new RegExp(`<Picture\\s+${tailPictureNo}>[\\s\\S]{0,160}(?:角色|人物|character|subject)`, "i").test(prompt)) {
      push("warn", "tail_picture_shift", `第 ${n} 段启用尾帧后 Picture ${tailPictureNo} 会被尾帧占用，请确认该编号不是原角色/场景素材。`, n);
    }
    const refsByType = { character: [], scene: [], prop: [], general: [] };
    const catalogByFile = new Map((catalog || []).filter((asset) => asset && asset.file)
      .map((asset) => [String(asset.file), asset]));
    for (const file of segment.refs) {
      const asset = catalogByFile.get(String(file));
      if (asset) refsByType[normalizeAssetType(asset.type)].push(asset);
    }
    if (segment.asset_confirmation_required) {
      const missingTypes = segment.asset_confirmation_missing_types.length
        ? segment.asset_confirmation_missing_types.filter((type) => !refsByType[type].length)
        : (segment.refs.length ? [] : ["general"]);
      if (missingTypes.length) {
        push("error", "asset_assignment_unconfirmed",
          `第 ${n} 段无法确定${missingTypes.map((type) => H3_ASSET_TYPES[type].label).join("/")}参考；未向本段注入完整资产库，请手动选择后再生成。`, n);
      }
    }

    const matched = matchAssetsToSegment(prompt, catalog);
    const missing = matched.filter((asset) => !asset.file);
    for (const asset of missing) {
      const key = `${asset.type}:${normalizeAssetName(asset.name)}`;
      if (!unboundArchiveAssets.has(key)) unboundArchiveAssets.set(key, asset);
    }
    if (parsed.recognized && parsed.allAssets.length && hasUploadedAssets && !matched.length) {
      push("warn", "no_asset_match", `第 ${n} 段没有按完整名称匹配到角色/场景/道具，请检查名称是否被简称。`, n);
    }

    const soundscape = prompt.match(/overall_soundscape\s*[:：]([\s\S]*?)(?=\n\s*non_diegetic_music\s*[:：]|$)/i);
    if (soundscape && /<d>|(?:说|对白)\s*[:：]|["“][^"”]{4,}["”]/i.test(soundscape[1])) {
      push("warn", "soundscape_dialogue", `第 ${n} 段 overall_soundscape 疑似重复了对白；该字段只写环境、动作和非语言人声。`, n);
    }
    if (hasNonDiegeticMusic(prompt)) hasMusicAcrossSegments = true;
  });

  if (normalizedSegments.length > 1 && hasMusicAcrossSegments) {
    push("warn", "music_discontinuity", "多段分别生成配乐可能在合并处跳变；短剧默认建议 non_diegetic_music: N/A，需要配乐时优先后期统一配一条。", 0);
  }

  if (unboundArchiveAssets.size) {
    const names = [...unboundArchiveAssets.values()].map((asset) => asset.name);
    push("info", "unbound_archive_assets",
      `已识别档案资产但尚未绑定参考图：${names.join("、")}。当前可按纯文本描述生成；如需进一步锁定角色/场景/道具一致性，请上传同名图片。`, 0);
  }

  if (parsed.recognized) {
    const sceneNames = new Set((parsed.assets.scene || []).map((x) => normalizeAssetName(x.name)));
    for (const shot of parsed.segments || []) {
      if (shot.sceneName && !sceneNames.has(normalizeAssetName(shot.sceneName))) {
        push("warn", "undefined_scene", `分镜 ${shot.number} 使用场景“${shot.sceneName}”，但场景档案中没有同名条目。`, shot.number);
      }
    }
  }

  const counts = { error: 0, warn: 0, info: 0 };
  issues.forEach((issue) => { counts[issue.severity] = (counts[issue.severity] || 0) + 1; });
  return {
    ok: counts.error === 0,
    counts,
    issues,
    totalDuration,
    segmentCount: normalizedSegments.length,
    sourceSegmentCount: Math.max(0, Math.floor(Number(sourceSegmentCount) || 0)),
    formatLabel: String(formatLabel || (parsed.recognized ? parsed.label : "")),
    sourceDuration: durationContract.sourceDuration,
    durationContract,
    matchedAssets: normalizedSegments.map((segment) => matchAssetsToSegment(segment.prompt, catalog)),
  };
}

export function formatProductionReport(report) {
  const format = report.formatLabel ? `（${report.formatLabel}）` : "";
  const duration = report.sourceDuration > 0
    ? `脚本源 ${report.sourceDuration.toFixed(1)} 秒 → 当前执行 ${report.totalDuration.toFixed(1)} 秒`
    : `${report.formatLabel ? "当前执行" : "当前执行估算"} ${report.totalDuration.toFixed(1)} 秒`;
  const head = `生产前检查${format}：${report.segmentCount} 段 / ${duration}；错误 ${report.counts.error}，警告 ${report.counts.warn}`;
  if (!report.issues.length) return head + "\n✓ 未发现阻止生产的问题。";
  const icon = { error: "✕", warn: "⚠", info: "·" };
  return head + "\n" + report.issues.map((issue) => `${icon[issue.severity] || "·"} ${issue.message}`).join("\n");
}
