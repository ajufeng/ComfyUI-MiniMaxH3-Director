import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import {
  findH3WheelOwner,
  h3CanvasOffsetAfterPan,
  h3CanvasOffsetAtPoint,
  nextH3CanvasScale,
} from "./h3_ui_interactions.js";
import {
  H3_UPSCALE_MODEL_CATALOG,
  buildH3VideoUpscalePrompt,
  h3InputVideoSource,
  h3OutputVideoSource,
  h3UpscaleComparePercent,
  h3UpscaleMediaErrorMessage,
  h3UpscaleResultVideoRoute,
  h3UpscaleResultFromExecuted,
  normalizeH3UpscaleSettings,
  readH3UpscaleHistory,
} from "./h3_video_upscale.js";
import {
  H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS,
  H3_SECOND_SAMPLE_DEFAULT_REPAIR_PROMPT,
  H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES,
  H3_SECOND_SAMPLE_LAYOUTS,
  H3_SECOND_SAMPLE_MODES,
  H3_SECOND_SAMPLE_SIZE_MODES,
  H3_SECOND_SAMPLE_WEIGHT_SOURCES,
  h3SecondSampleExecutionConfig,
  h3SecondSampleAvailableEnvironmentSelection,
  h3SecondSampleFinalSize,
  h3SecondSampleLongRunWarning,
  h3SecondSampleManualRequirements,
  h3SecondSampleRuntimePresentation,
  h3SecondSampleSetupPresentation,
  h3SecondSampleSizeInputState,
  h3SecondSampleSizeModeTransition,
  h3SecondSampleSizeStatus,
  h3SecondSampleSummary,
  h3SecondSampleTargets,
  h3SecondSampleUpscalerModelError,
  h3SecondSampleUpscalerModelName,
  applyH3SecondSampleDefault,
  normalizeH3SegmentSecondSample,
  normalizeH3SecondSample,
  normalizeH3SecondSampleRuntimeStage,
  normalizeH3SecondSampleSetupSelection,
  normalizeH3SecondSampleSetupStatus,
  setH3SegmentSecondSample,
  setH3SegmentsSecondSampleEnabled,
  toggleH3SegmentSecondSample,
} from "./h3_second_sample.js";
import { H3_TEXT_TEMPLATES } from "./h3_templates.js";
import {
  addH3Project,
  backupH3Project,
  cloneH3ProjectValue,
  createH3ProjectStore,
  deleteH3Project,
  duplicateH3Project,
  getH3Project,
  renameH3Project,
  restoreH3ProjectBackup,
  saveH3Project,
} from "./h3_create_projects.js";
import {
  H3_GUIDED_TEMPLATES,
  applyH3GuidedTemplate,
  buildH3InlineGuidePlan,
  createH3GuidedTemplatePreviewDraft,
  applyH3GuidedCreativePackage,
  detectH3GuidedIntent,
  getH3GuidedFieldSuggestions,
  getH3GuidedCreativePackages,
  getH3GuidedDialogueSuggestions,
  getH3GuidedRouteAnswer,
  getH3GuidedRouteStages,
  getH3GuidedTemplateUi,
  getH3GuidedVisibleTemplateUi,
  getH3GuidedTopicSuggestions,
  inferH3ProductNameFromTopic,
  isValidH3ProductNameCandidate,
  normalizeH3CreativeTopic,
  setH3GuidedRouteAnswer,
  validateH3GuidedConcreteFields,
} from "./h3_guided_templates.js";
import {
  H3_ASSET_TYPES,
  H3_GUIDED_DIALOGUE_LANGUAGES,
  H3_GUIDED_DIALOGUE_MODES,
  buildH3ArchiveImportSegments,
  buildH3GuidedDirectorScript,
  buildH3PromptAssistSection,
  buildContinuationDirective,
  buildH3ReferencePromptGuidance,
  applyH3PromptAssistSelection,
  appendH3GuidedQuickOption,
  deriveSafeGlobalPrompt,
  buildH3TimelineRepairInstruction,
  detectAspectRatioContract,
  detectTailRenderBoundary,
  extractH3TimelineStyleContract,
  evaluateDurationConservation,
  formatAssetBinding,
  formatAssetPromptContext,
  formatH3TimelineStyleContract,
  injectH3TimelineStyleContractManifest,
  isH3GuidedSpeechMode,
  isH3StoryDialogueLine,
  normalizeAssetType,
  parseH3GuidedDialogueEntries,
  parseOfficialShotPrefix,
  parseH3Archive,
  parseH3StructuredJson,
  planH3LocalAssetAssignments,
  planH3GuidedSegments,
  replaceH3SelectedRange,
  restoreH3AssetMentions,
  stripForbiddenH3OfficialDialogue,
  stripForbiddenH3StoryDialogue,
  uniqueH3SegmentAssets,
  validateH3GuidedDialogueScript,
} from "./h3_script_tools.js";

/* 前端版本号：与 routes.py 的 BACKEND_VERSION 对应。
   status 接口返回的后端版本若与此不一致（用户改了代码但没重启/没强刷），状态栏红字提示。 */
const H3S_VERSION = "2.40.2";
const activeProjectIds = new Map();

/* “镜头”栏目只回答摄影机怎样运动。景别、构图、人物/手部特写、材质证明等
   属于其它创作决定，不再混进运镜候选，避免用户点了“镜头”却得到拍摄职责。 */
const H3_CAMERA_MOVEMENT_OPTIONS = Object.freeze([
  { label: "固定机位，摄影机保持不动", summary: "主体在画面内完成动作，适合需要稳定观察的时刻。" },
  { label: "缓慢推近，接近主体后平稳停止", summary: "逐渐靠近主体，加强注意力或情绪。" },
  { label: "缓慢拉远，逐步展示更大空间", summary: "从主体扩展到环境，适合揭示空间或收束结果。" },
  { label: "摄影机向左横移，保持速度均匀", summary: "沿水平方向向左移动，不改变主体动作。" },
  { label: "摄影机向右横移，保持速度均匀", summary: "沿水平方向向右移动，不改变主体动作。" },
  { label: "摄影机向上升起，逐步扩大俯瞰范围", summary: "垂直上升并展示更大的位置关系。" },
  { label: "摄影机向下降落，逐步靠近主体高度", summary: "垂直下降，让视线从空间回到主体。" },
  { label: "侧向平行跟拍，与主体保持相同速度", summary: "摄影机与主体并排行进，运动方向持续可读。" },
  { label: "从主体前方倒退跟拍，保持距离稳定", summary: "摄影机向后移动并持续面对前进中的主体。" },
  { label: "从主体后方跟随前进，保持距离稳定", summary: "摄影机在主体后方沿同一路线移动。" },
  { label: "水平摇镜，从一侧平稳转向另一侧", summary: "摄影机位置不变，只左右旋转观察方向。" },
  { label: "垂直摇镜，从下向上或从上向下转动", summary: "摄影机位置不变，只上下旋转观察方向。" },
  { label: "小弧度环绕主体，完成后平稳制动", summary: "围绕主体进行短距离弧形移动，不做无目的整圈旋转。" },
  { label: "快速甩镜到新方向，到位后立即停止", summary: "用于快速转移注意力，终点必须清楚稳定。" },
  { label: "手持迟滞追拍，动作发生后再跟上", summary: "保留轻微手持感，但不使用无目的抖动。" },
  { label: "二维画面整体推近或拉远，不旋转三维空间", summary: "适合像素、漫画和平面动画的画面缩放。" },
]);

/* 官方 H3 没有一个封闭的“风格枚举表”。这里提供的是安全、可执行的创作预设：
   点选后会写回用户文本，再由 AI 剧本和官方 Base 分镜两步共同遵守；“自定义”仍保留。 */
const H3_PROMPT_ASSIST_CATALOG = Object.freeze({
  story: {
    title: "补充剧情走向",
    placeholder: "例如 发现异常→尝试确认→证据反转→做出选择",
    options: [
      { label: "发现异常→主动调查→证据反转→做出选择", summary: "用于悬疑或关系冲突，让剧情有清楚的起因、证据和结果。" },
      { label: "明确目标→遇到一个阻碍→改变办法→完成目标", summary: "用于动作、冒险或游戏剧情，保持一条容易看懂的因果线。" },
      { label: "日常状态→意外变化→人物反应→关系发生改变", summary: "用于人物短剧，重点表现表情、距离和关系变化。" },
      { label: "立即钩子→信息升级→高潮动作→稳定收束", summary: "用于广告、预告或短片开场，在较短时间内建立强节奏。" },
    ],
  },
  game_ui: {
    title: "补充游戏界面过程",
    placeholder: "例如 角色卡出现→装备栏展开→确认选择→界面退场进入关卡",
    options: [
      { label: "角色卡出现→装备栏展开→确认选择→界面退场进入关卡", summary: "完整展示一次界面选择，并让选择自然连接后续游戏画面。" },
      { label: "固定侧视像素界面→光标移动→物品高亮→确认音后进入横向卷轴", summary: "适合原生2D像素游戏，避免使用不符合平面界面的三维环绕。" },
      { label: "角色全身预览→属性面板简短出现→选择技能→门或传送点开启", summary: "适合单人入场动画，让UI选择对后续场景产生可见作用。" },
      { label: "主菜单淡出→场景地图展开→目标地点锁定→镜头进入实际游戏空间", summary: "适合从菜单或地图平滑过渡到正式游戏。" },
    ],
  },
  character: {
    title: "补充人物与角色",
    placeholder: "例如 熊猫战士，黑白毛色，红色围巾，始终使用同一外观",
    options: [
      { label: "单一主角，全片保持同一脸型、发型、服装主色和标志物", summary: "减少人物漂移，适合角色宣传、游戏入场和单人剧情。" },
      { label: "主角与一名关系角色，明确左右位置、朝向、距离和各自动作", summary: "适合双人关系戏，帮助模型区分两人的空间关系。" },
      { label: "角色外观以轮廓、服装主色和一个签名道具作为身份锚点", summary: "只锁最有用的识别特征，避免写成长篇人物档案。" },
      { label: "角色名称和身份由我的草稿决定，AI不得新增或替换人物", summary: "要求AI只整理已写角色，不擅自扩写新人物。" },
    ],
  },
  scene: {
    title: "补充场景与布局",
    placeholder: "例如 固定侧视装备大厅，角色在左，装备台在中，入口在右",
    options: [
      { label: "单一固定主场景，写清左/中/右和前景/中景/背景位置", summary: "帮助跨镜头保持空间方向，适合短视频和连续剧情。" },
      { label: "固定侧视游戏空间，角色从左向右移动，目标入口始终位于右侧", summary: "适合横向卷轴或游戏入场，运动方向不跳变。" },
      { label: "先用大全景建立地点，再保持同一轴线拍人物与关键道具", summary: "适合真实空间、漫剧和电影式短片。" },
      { label: "场景只使用草稿中已写地点，AI不得另加房间、关卡或支线地点", summary: "限制AI擅自换场或扩写新空间。" },
    ],
  },
  equipment: {
    title: "补充装备或道具",
    placeholder: "例如 木盾和短剑；先选择，进入关卡后用木盾挡住飞石",
    options: [
      { label: "只保留1–2件会实际使用的道具；先出现、再接触、最后产生结果", summary: "让道具参与因果链，不只是装饰性地出现。" },
      { label: "装备名称由我的草稿决定，AI只保持名称和外观一致，不新增其它装备", summary: "适合你稍后自行填写具体装备名称。" },
      { label: "选择动作清楚显示手部、光标或接触点，选中后让同一装备进入后续画面", summary: "用于游戏装备选择，避免选择镜头和游戏镜头互相断开。" },
      { label: "没有关键装备；只使用角色自身动作完成剧情", summary: "不需要道具时明确排除，减少随机物件。" },
    ],
  },
  action: {
    title: "补充动作过程",
    placeholder: "例如 手靠近按钮→按下→界面确认→入口打开→角色进入",
    options: [
      { label: "接近目标→发生接触→出现受力或状态变化→结果稳定", summary: "通用可见因果动作，适合道具、机关、产品和游戏交互。" },
      { label: "人物先行动→摄影机短跟随→环境给出反馈→人物停下确认", summary: "动作主导镜头，避免摄影机无目的先动。" },
      { label: "选择或确认→同一对象进入后续画面→实际使用→结果被看见", summary: "适合装备、技能、产品功能等需要前后回报的动作。" },
      { label: "每个时间段只保留一个主要动作，动作完成后再切换下一镜", summary: "降低短时间内动作堆叠和模型重复重演。" },
    ],
  },
  shot: {
    title: "选择镜头运动",
    placeholder: "例如 缓慢推近，接近主体后平稳停止",
    options: H3_CAMERA_MOVEMENT_OPTIONS,
  },
  ending: {
    title: "补充结尾状态",
    placeholder: "例如 角色穿过开启的大门，界面完全退场，最后一秒稳定",
    options: [
      { label: "关键动作完成，人物和道具状态清楚，最后一秒完全稳定", summary: "通用稳定收束，也方便后续段从最后状态继续。" },
      { label: "只处理前面建立的问题，不新增人物、地点、文字或下一条支线", summary: "避免结尾突然扩写新内容。" },
      { label: "摄影机缓慢拉远，保留主角、目标地点和动作结果的空间关系", summary: "适合剧情、游戏或动作片的结果镜头。" },
      { label: "停在可继续生成的动作姿态，但不重演上一段已经完成的动作", summary: "适合多段视频续接。" },
    ],
  },
  core_idea: {
    title: "选择核心创意文案",
    placeholder: "例如 15秒横版视频，在同一电车车厢中让杏橙手绘线连续变形并温柔回收",
    options: [],
  },
  visual_process: {
    title: "选择画面过程描述",
    placeholder: "例如 按绝对秒数写清正向动作、相机响应、结果和反向禁止项",
    options: [],
  },
  overall_requirements: {
    title: "选择整体要求补充",
    placeholder: "例如 锁定手绘笔触、中心色、连续变形痕迹和同一真实空间",
    options: [],
  },
  camera_rhythm: {
    title: "选择相机节奏",
    placeholder: "例如 主体先动，相机慢半拍追赶，允许短暂失焦但关键动作清楚",
    options: [],
  },
  environment_sound: {
    title: "选择环境音与同步音效",
    placeholder: "例如 车轮轨道摩擦、扶手碰撞、脚步和粉笔线摩擦声逐项同步",
    options: [],
  },
  duration: {
    title: "选择成片总时长",
    placeholder: "例如 45秒",
    options: ["8秒", "10秒", "15秒", "30秒", "60秒", "90秒", "180秒"],
  },
  style: {
    title: "选择画面风格",
    placeholder: "例如 复古剪纸动画",
    options: [
      "完整原生2D像素风", "2D漫画漫剧", "黑白漫画网点风", "日系二维赛璐璐动画",
      "平面赛璐璐+抽象动态图形", "实拍+手绘发光涂鸦融合",
      "美式漫画粗线风", "儿童绘本手绘风", "国风水墨动画", "复古剪纸动画",
      "风格化3D动画", "黏土定格动画", "写实真人电影风", "赛博朋克霓虹风",
      "写实动作大片预告风", "蒸汽朋克机械风", "低多边形游戏风", "复古16-bit游戏风",
      "商业游戏宣传片风",
    ],
  },
  aspect: {
    title: "选择成片画幅",
    placeholder: "例如 4:5竖屏",
    options: ["横屏16:9", "竖屏9:16", "方形1:1", "经典4:3", "电影宽银幕21:9"],
  },
  genre: {
    title: "选择作品类型",
    placeholder: "例如 武侠漫剧",
    options: ["漫剧", "游戏入场动画", "剧情短片", "动作短片", "悬疑短剧", "喜剧短剧",
      "惊悚短剧", "角色宣传片", "产品宣传片", "音乐短片", "预告片"],
  },
  pace: {
    title: "选择叙事节奏",
    placeholder: "例如 前慢后快",
    options: ["舒缓叙事", "标准节奏", "快节奏但动作清晰", "快速切镜但动作连续",
      "高密度预告片节奏", "静帧爆发式动作节奏", "前慢后快", "前快后稳"],
  },
  dialogue: {
    title: "选择对白模式",
    placeholder: "默认无对白；需要说话时必须选择精确模式并填写逐字台词",
    options: H3_GUIDED_DIALOGUE_MODES,
  },
  camera: {
    title: "选择运镜方式",
    placeholder: "例如 缓慢推近后固定",
    options: H3_CAMERA_MOVEMENT_OPTIONS.map((item) => item.label),
  },
  focus: {
    title: "选择内容重点",
    placeholder: "例如 突出装备选择后的实际用途",
    options: ["角色外观与身份一致", "动作因果连续", "场景氛围", "角色表演与微表情",
      "道具选择与后续用途", "形态连续变形并保留痕迹", "角色位置/朝向/道具严格锁定",
      "剧情反转", "战斗动作", "产品卖点", "首尾转场衔接"],
  },
  structure: {
    title: "选择镜头与叙事结构",
    placeholder: "例如 单场景追逐后在结尾反转",
    options: ["单场景连续变化", "单镜头连续运动", "多镜头快速切换", "起因→障碍→解决→结果",
      "菜单展示→选择→实际使用→结果", "建立角色→动作升级→高潮→收束"],
  },
  transition: {
    title: "选择转场方式",
    placeholder: "例如 用角色挥刀动作匹配转场",
    options: ["动作匹配转场", "遮挡转场", "白闪硬切", "图形分解重组", "同一物体连续变形",
      "不切场景连续过渡", "快速硬切保持动势"],
  },
  sound: {
    title: "选择声音设计",
    placeholder: "例如 雨声、脚步与布料摩擦为主",
    options: ["真实环境音+动作同步音效", "界面电子音效", "颗粒化像素音效",
      "手绘粉笔/纸张质感音效", "电影动作冲击音效", "仅环境音不配乐", "完全静音"],
  },
  music: {
    title: "选择背景配乐",
    placeholder: "例如 前半极简钢琴，高潮进入低弦",
    options: ["无背景音乐", "低频电子脉冲", "管弦动作预告配乐", "极简钢琴与弦乐",
      "8-bit芯片音乐", "轻柔环境氛围音乐", "只在高潮进入配乐"],
  },
  continuity: {
    title: "选择连续性规则",
    placeholder: "例如 角色右手持刀且始终向右移动",
    options: ["角色身份/服装/道具全程锁定", "每次形态变化保留前一形态痕迹",
      "相机跟随动作不提前构图", "跨镜头保持位置/朝向/运动方向",
      "前段结尾状态成为后段起点", "风格切换只改变渲染不改变角色"],
  },
  onscreen_text: {
    title: "选择画面文字策略",
    placeholder: "例如 只允许结尾出现‘继续’",
    options: ["无屏幕文字和字幕", "只保留用户指定文字", "仅结尾标题", "游戏UI文字最少且可读",
      "字幕与对白严格同步"],
  },
  constraint: {
    title: "选择禁止项",
    placeholder: "例如 不出现额外人物或现代物品",
    options: ["不新增角色/道具/场景", "不复制商业Logo或水印", "不出现随机文字",
      "不使用3D/PBR/体积光", "不使用过度运镜", "不恐怖化或怪物化", "不切换到新场景"],
  },
});

/* “逐步填写”完全在本地工作。基础条件、模板专属故事节拍和镜头调度逐项选择后，
   再按总时长生成不超过 15 秒的 Director 内容段，并在每段内部写出带时间、职责、
   景别、摄影机触发、结果和衔接的镜头表；不依赖 AI 编写剧本。 */
const H3_GUIDED_PROMPT_STEPS = Object.freeze([
  { key: "content", label: "内容", title: "这条视频主要讲什么？", required: true,
    placeholder: "例如 熊猫和鳄鱼在蒸汽朋克大厅选择装备，打开黄铜大门进入游戏世界",
    options: [] },
  { key: "duration", label: "时长", title: "成片总时长", required: true, catalog: "duration" },
  { key: "style", label: "风格", title: "画面风格", catalog: "style" },
  { key: "aspect", label: "画幅", title: "画幅比例", catalog: "aspect" },
  { key: "genre", label: "类型", title: "作品类型", catalog: "genre" },
  { key: "story_route", label: "故事节拍", title: "故事怎样推进？", templateProfile: "story",
    placeholder: "例如 立即钩子→明确目标→一个阻碍→行动→可见结果",
    options: ["立即钩子→明确目标→一个阻碍→行动→可见结果", "人物发现→尝试→意外变化→调整→收束", "状态建立→状态改变→结果确认→最后帧交接"] },
  { key: "shot_language", label: "镜头调度", title: "每个镜头分别拍什么？", templateProfile: "shots",
    placeholder: "例如 空间建立→目标近景→接触特写→结果中远景",
    options: ["空间建立→目标近景→接触特写→结果中远景", "局部钩子→身份揭示→动作跟随→结果确认", "稳定建立→动作触发后短推→反应近景→稳定收束"] },
  { key: "game_name", label: "游戏名称", title: "双人合作游戏名称", required: true,
    onlyTemplates: ["coop_game_intro_official"],
    placeholder: "例如 熊猫大冒险；只写你自己的游戏名称，不要填写未授权品牌",
    options: [] },
  { key: "player1", label: "PLAYER 1", title: "PLAYER 1 名称（固定在左侧）", required: true,
    onlyTemplates: ["coop_game_intro_official"],
    placeholder: "例如 熊猫；应与左侧角色参考图或资产名称一致",
    options: [] },
  { key: "player2", label: "PLAYER 2", title: "PLAYER 2 名称（固定在右侧）", required: true,
    onlyTemplates: ["coop_game_intro_official"],
    placeholder: "例如 鳄鱼；应与右侧角色参考图或资产名称一致",
    options: [] },
  { key: "color_system", label: "颜色系统", title: "主菜单颜色系统（最多5种）",
    onlyTemplates: ["coop_game_intro_official"],
    placeholder: "例如 深蓝主体、青色UI、白色文字、黄色功能强调、红色危险提示",
    options: ["深蓝主体、青色UI、白色文字、黄色功能强调、红色危险提示",
      "黑色主体、像素绿UI、米白文字、金色功能强调、红色危险提示",
      "奶油白主体、橙色UI、深灰文字、天蓝功能强调、红色危险提示",
      "紫色主体、洋红UI、白色文字、青色功能强调、红色危险提示"] },
  { key: "ui_copy", label: "UI菜单文案", title: "主菜单固定文案",
    onlyTemplates: ["coop_game_intro_official"],
    defaultValue: "Continue、Start New Game、Settings、Exit Game",
    placeholder: "默认使用 Continue、Start New Game、Settings、Exit Game；按钮必须保持单行",
    options: ["Continue、Start New Game、Settings、Exit Game",
      "继续游戏、开始新游戏、设置、退出游戏"] },
  { key: "product_name", label: "产品名称", title: "先选择或填写要拍的产品", required: true,
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 红苹果；输入产品名称后，后续颜色、材质、动作和结果都会切换为该产品的专属候选",
    options: ["红苹果", "无线充电座", "折叠台灯", "便携音箱"] },
  { key: "product_category", label: "产品类别", title: "确认产品属于哪一类", required: true,
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "插件会根据产品名称自动识别；识别不对时再手动选择",
    options: ["食品与生鲜", "饮料与包装食品", "电子数码", "家电与家居", "美妆护肤", "服饰鞋包", "珠宝腕表", "软件与数字服务", "其它实体产品"] },
  { key: "source_assets", label: "参考素材", title: "参考素材（没有上传时选择纯文生视频）",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad", "brand_promo_official"],
    placeholder: "没有上传时选择“无参考素材·纯文生视频”；有素材时只选择实际已上传、核验或授权的内容",
    multiple: true,
    options: ["无参考素材·纯文生视频，不引用图片、Logo、包装或外部品牌资产", "已上传主商品图和细节图", "已上传主商品图、包装图和多款式图", "已上传官方Logo、产品图和界面截图", "只使用用户上传素材，不从网络猜测品牌资产"] },
  { key: "product_variant", label: "主推款", title: "单款、多款式和主推款策略",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 紫色款为主推，黑色与银色只在结尾辅助出现",
    options: ["单款商品，全片只展示这一款", "一个主推款，其他款式只在中后段辅助进入", "多颜色产品采用色彩家族型，但禁止满屏平铺"] },
  { key: "product_color", label: "产品主色", title: "产品本体必须保真的真实颜色",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 果皮保持自然深红色，叶片保持真实绿色；无参考素材时按文字锁定",
    options: ["按文字设定锁定真实主色，全片不重染", "有参考素材时严格沿用素材真实主色"] },
  { key: "product_material", label: "产品材质", title: "需要锁定的表面材质和结构",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 阳极氧化铝、细砂哑光表面、透明亚克力边缘、圆形磁吸结构",
    multiple: true,
    options: ["沿用参考图可见材质、边缘、接口与表面纹理", "突出哑光触感和克制边缘高光", "突出透明件、按钮、转轴、屏幕或接口的真实结构"] },
  { key: "product_action", label: "产品动作", title: "产品真实可展示的结构或功能动作",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 盒盖打开30度→磁吸组件升起→状态灯亮起",
    options: ["开合→停顿→内部结构显现", "旋转或表冠轻旋→边缘高光扫过", "磁吸/扣合→结构对齐→确认", "按钮/触控→产品响应→功能结果", "折叠/展开→结构锁定→使用状态"] },
  { key: "product_result", label: "最终证明", title: "动作完成后，观众必须看见什么真实结果？", required: true,
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 同一只苹果的两半稳定摆放，切面汁珠、果肉和果核层次清楚",
    options: ["操作前后状态形成清楚对比", "产品保持唯一视觉主体，结果稳定可见", "最终状态清楚，不新增第二商品或无关物体"] },
  { key: "ad_style", label: "广告模板", title: "极简产品广告视觉模板",
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "可自定义，但只改变背景与光线，不重染产品",
    options: ["白色科技风", "黑底轮廓光", "品牌色块", "生活方式轻场景"] },
  { key: "ad_copy", label: "广告文案", title: "结尾是否显示一行文案？", required: true,
    onlyTemplates: ["minimalist_product_ad_official"],
    placeholder: "可选“无文案”，也可直接填写一行中文或英文文案；最终只显示这一行",
    options: ["无文案，只保留产品和同步动作音效", "清脆多汁，一口新鲜。", "每一口，都是新鲜。", "Feel Every Detail"] },
  { key: "text_mode", label: "画面文字", title: "是否显示唯一一行文案？", required: true,
    onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "三种模式互斥；无文字最稳",
    options: ["无文字", "唯一中文文案", "唯一英文文案"] },
  { key: "ad_copy_text", label: "唯一文案", title: "填写最后真正显示的一行文案", required: true,
    spokenOnly: false, onlyTemplates: ["minimalist_product_ad_official", "product_ad"],
    placeholder: "例如 清脆多汁，一口新鲜。；只写文案原文，不写控制说明",
    options: ["清脆多汁，一口新鲜。", "每一口，都是新鲜。", "Feel Every Detail"] },
  { key: "narrative_spine", label: "叙事脊柱", title: "本片采用哪条产品或品牌叙事链",
    onlyTemplates: ["minimalist_product_ad_official", "brand_promo_official"],
    placeholder: "例如 产品发布型：主视觉→材质→动作→功能→文案收束",
    options: ["产品发布型：主视觉→材质/结构→产品动作→款式关系→文案收束", "功能触感型：静置→交互触发→功能动作→使用结果→收束", "色彩家族型：主推款→辅助款→色彩秩序→全套收束", "AI/SaaS：用户意图→规划→能力→执行→输出→证明→Logo", "实体品牌：英雄展示→交互→功能特写→使用场景→结果→Logo", "服务品牌：背景→流程→证据→成果→承诺→Logo"] },
  { key: "project_title", label: "项目名称", title: "3D动画短片项目名称",
    onlyTemplates: ["animation_3d_short_official"], section: "任务身份",
    placeholder: "例如 最后一只红苹果",
    options: [] },
  { key: "story_premise", label: "故事前提", title: "一句话What-if与主角主动目标", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "任务身份",
    placeholder: "例如 如果一只胆小的小浣熊必须在暴雨前把最后一只苹果送给山顶的奶奶",
    options: [] },
  { key: "core_prop", label: "核心道具", title: "贯穿任务、失败、高潮和结尾的同一个核心道具", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "任务身份",
    placeholder: "例如 最后一个红苹果；名称必须与道具/装备和参考资产一致",
    options: ["最后一个红苹果", "需要送达的药盒", "必须保护的信件", "需要归还的钥匙"] },
  { key: "supporting_props", label: "辅助道具", title: "除核心道具外允许出现哪些携带物", 
    onlyTemplates: ["animation_3d_short_official"], section: "任务身份",
    placeholder: "默认写“无辅助道具”；只有剧情确实需要并已建立/有参考资产时才填写",
    options: ["无辅助道具", "只使用场景中已建立的天然支点，不增加携带物"] },
  { key: "destination", label: "送达终点", title: "主角最终必须抵达并完成交接的具体地点或人物", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "任务身份",
    placeholder: "例如 山顶奶奶的小屋门前；必须能在最后一段画面中清楚验证",
    options: ["山顶目标人物所在的小屋门前", "森林尽头的固定木屋入口", "河对岸已经建立的目标地标", "城镇中心的明确交接位置"] },
  { key: "opening_layout", label: "起点布局", title: "第一镜中主角、核心道具、路线和终点分别在哪里", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "空间与出场", longInput: true,
    placeholder: "例如 熊猫位于左下前景并双手抱苹果；山路向右上延伸；山顶木屋只在右上远景",
    options: ["主角位于左下前景，核心道具在手；路线向右上延伸，终点只在右上远景", "主角位于中央前景，路线向背景延伸，终点只作为远景地标"] },
  { key: "route_layout", label: "路线布局", title: "起点、障碍和终点如何固定在同一空间轴线上", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "空间与出场", longInput: true,
    placeholder: "例如 起点在左下，陡坡和倒木位于路线中段，山顶木屋固定在右上远景；全片不交换方向",
    options: ["起点、主要障碍和终点保持在同一前进轴线上，跨镜不交换左右方向", "路线只有一个明确前进方向，不切换到未建立的新地点"] },
  { key: "receiver_timing", label: "接收者出场", title: "终点人物何时允许进入近景", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "空间与出场", longInput: true,
    placeholder: "例如 奶奶在主角抵达山顶前不出现在熊猫身边；抵达木屋后才进入中景接苹果",
    options: ["接收者在抵达终点前不进入主角身边、不出现近景；抵达后才进入中景", "接收者只通过远处终点地标提示，抵达前不提前完成交接"] },
  { key: "first_action", label: "起点动作", title: "主角第一镜怎样确认任务并开始移动", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "第一段失败链", longInput: true,
    placeholder: "例如 熊猫双手抱稳苹果→抬头确认山顶木屋→身体转向山路→迈出第一步",
    options: ["双手护住核心道具→确认终点→转向固定路线→迈出第一步", "先看核心道具是否完好→看向终点→收紧持握→开始前进"] },
  { key: "primary_obstacle", label: "主要障碍", title: "途中唯一主要物理障碍", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "第一段失败链",
    placeholder: "例如 通往山顶的陡坡、狭窄岔路和横在路中的倒木；不能临时新增反派",
    options: ["陡坡、狭窄岔路和路面阻挡", "暴雨造成的湿滑路面、积水和视线受阻", "倒木挡住主路，只能使用已建立环境寻找支点", "摇晃木桥与强风共同造成重心障碍"] },
  { key: "wrong_attempt", label: "错误尝试", title: "主角第一次具体怎样做错，并造成什么可见后果", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "第一段失败链", longInput: true,
    placeholder: "例如 熊猫为了赶时间单手抱苹果冲上湿滑陡坡，脚下一滑，苹果从怀里滚向路边；动作要写前因、接触、受力和结果",
    options: ["主角为了赶时间单手护住核心道具并仓促通过障碍，失衡后核心道具滑向路边", "主角只看地图没有看脚下，碰到障碍后被迫退回", "主角用力过猛拉动机关，使障碍范围反而扩大"] },
  { key: "failure_result", label: "失败尾帧", title: "失败后必须停在哪个唯一、清楚、可续接的状态", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "第一段失败链", longInput: true,
    placeholder: "例如 熊猫退回倒木前，双手抱住完好苹果，身体仍朝山顶；倒木挡住主路，奶奶仍未进入近景",
    options: ["主角退回障碍前，双手抱住完好核心道具，身体仍朝终点；障碍继续挡住主路", "主角停稳并确认核心道具未损坏，下一步方向和障碍接触点清楚"] },
  { key: "recovery_action", label: "续接恢复动作", title: "下一段第一镜怎样从失败尾帧开始换方法", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "解决与交接", longInput: true,
    placeholder: "例如 熊猫原地停稳→检查苹果→重新观察倒木和路线→双手贴胸固定苹果→调整重心",
    options: ["原地停稳→检查核心道具→观察障碍和路线→改变持握→调整脚步与重心", "从失败姿态抬眼寻找已建立支点→保护核心道具→摆出新方案预备姿态"] },
  { key: "climax_action", label: "高潮动作", title: "主角最终使用什么已建立方法解决障碍", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "解决与交接", longInput: true,
    placeholder: "例如 熊猫先把苹果贴胸固定，用地图确认安全支点，再借倒木保持平衡跨过窄路，落稳后立即检查苹果",
    options: ["先保护核心道具→观察路线→使用已建立支点→调整重心→跨过障碍→落稳确认", "利用早前失败留下的可见结果换一种方法完成动作", "使用已经建立的道具解除机关，不能出现新工具"] },
  { key: "payoff_action", label: "收束动作", title: "最终交接与情绪回收怎样在画面中成立", required: true,
    onlyTemplates: ["animation_3d_short_official"], section: "解决与交接", longInput: true,
    placeholder: "例如 熊猫抵达山顶小屋，双手把红苹果递给奶奶；奶奶稳稳接住，熊猫松一口气并露出小笑容",
    options: ["抵达终点→双手递出核心道具→目标人物接住→双方目光确认→温暖停留", "交接完成后回收开场姿态，但由紧张变为放松", "用一个小表情、手势或早前道具动作完成无对白回收"] },
  { key: "emotional_arc", label: "情绪弧", title: "主角情绪前提、低点和回收",
    onlyTemplates: ["animation_3d_short_official"], section: "角色与场景锁",
    placeholder: "例如 自信掩饰害怕→失败低点→主动承担→用早前苹果筐动作完成温暖回收",
    options: ["自信→失误→低点→主动选择→温暖回收", "孤独→建立关系→失去→冒险挽回→关系确认", "误会→升级→真相→尴尬回收", "恐惧→被迫行动→克服缺陷→安静余韵"] },
  { key: "character_lock", label: "角色卡锁", title: "角色卡必须锁定的身份特征",
    onlyTemplates: ["animation_3d_short_official"], section: "角色与场景锁",
    placeholder: "例如 Mia：3头身、棕色卷发、黄色雨衣、红色帆布鞋、苹果筐；全片固定",
    options: ["角色卡精确名称、年龄段、身材、发型、服装色和签名道具全程固定", "主角与施压角色外观分开锁定，单镜重要角色不超过3名"] },
  { key: "landmark_lock", label: "场景卡锁", title: "固定地标、人物位置和光位基线",
    onlyTemplates: ["animation_3d_short_official"], section: "角色与场景锁",
    placeholder: "例如 门框右侧1/3、厨房中岛底部居中；暖顶光+右侧冷反光",
    options: ["固定地标、人物屏幕位置、离屏人物状态和光位基线逐镜继承", "场景卡只含环境和地标，不出现人物或剪影"] },
  { key: "hook_pattern", label: "Hook分布", title: "全片Hook类型和回收规则",
    onlyTemplates: ["animation_3d_short_official"], section: "角色与场景锁",
    placeholder: "例如 S01 visual-joke；每3镜至少一次reveal/reversal；结尾callback",
    options: ["开场visual-joke，过程reversal/reveal，结尾callback", "开场suspense，过程chase/reveal，结尾tender", "开场expression-beat，高潮climax，结尾情绪回收"] },
  { key: "knowledge_topic", label: "知识主题", title: "要讲清楚的科学、教育或知识主题", required: true,
    onlyTemplates: ["papercraft_explainer_official"],
    placeholder: "例如 月相为什么会变化",
    options: [] },
  { key: "learning_goal", label: "学习目标", title: "观众最终应该记住的一句话", required: true,
    onlyTemplates: ["papercraft_explainer_official"],
    placeholder: "例如 月相变化来自月球绕地球运动时被太阳照亮部分的可见角度变化",
    options: [] },
  { key: "target_audience", label: "目标受众", title: "主要观众和使用场景",
    onlyTemplates: ["papercraft_explainer_official", "paper_collage_explainer_official", "brand_promo_official"],
    placeholder: "例如 8–12岁课堂学生、短视频泛知识观众、新用户或专业客户",
    options: ["儿童观众", "课堂学生", "社交媒体泛知识观众", "品牌教育观众", "专业观众", "新用户", "现有客户"] },
  { key: "visual_metaphor", label: "视觉隐喻", title: "不用长文字也能理解的具体画面隐喻", required: true,
    onlyTemplates: ["papercraft_explainer_official", "paper_collage_explainer_official"],
    placeholder: "例如 用可旋转纸盘展示地球、月球与太阳的相对位置；或用漏水纸桶表达时间泄漏",
    options: ["立体书旅程：每翻一页揭示概念一层", "纸艺实验室：纸偶在实验台演示机制", "分层剖面模型：核心对象逐层打开", "微缩自然剧场：生态/地理/天文在纸雕景观展开", "纸片机关板：齿轮、箭头、滑轨解释因果"] },
  { key: "paper_layers", label: "纸雕层级", title: "纸艺布景的前中后远景层级",
    onlyTemplates: ["papercraft_explainer_official"],
    placeholder: "例如 5层：前景云片、中景月球转盘、背景地球、远景星空底板、顶部太阳光片",
    options: ["4层：前景遮挡+中景模型+背景机关+远景底板", "5–7层：加入稳定标签层、滑轨层和光影层", "核心知识对象固定中景，标签位于稳定层"] },
  { key: "paper_mechanism", label: "纸艺机关", title: "负责讲解因果的真实纸片结构",
    onlyTemplates: ["papercraft_explainer_official"],
    placeholder: "例如 旋转圆盘控制月球位置，抽拉箭头展示光照方向",
    multiple: true,
    options: ["拉片", "滑轨", "旋转圆盘", "立体书展开", "折页/剖面层分开", "翻页", "剪纸门或纸质遮罩"] },
  { key: "narration_policy", label: "旁白策略", title: "旁白、标签和BGM如何使用",
    onlyTemplates: ["papercraft_explainer_official"],
    placeholder: "例如 中文女声简洁旁白；标签只写关键词；旁白下方压低BGM",
    options: ["默认无旁白，用纸艺机关和短标签讲清楚", "简洁旁白+必要纸质关键词标签，BGM在人声下ducking", "无旁白无字幕，只保留纸艺音效和轻柔配乐"] },
  { key: "source_copy", label: "原始文案", title: "要转成纸拼贴视觉隐喻的句子或概念", required: true,
    onlyTemplates: ["paper_collage_explainer_official"],
    placeholder: "例如 我们不是没有时间，而是时间从无数小漏洞里悄悄流走",
    options: [] },
  { key: "collage_palette", label: "拼贴色板", title: "主色场、强调色和纸张新旧程度",
    onlyTemplates: ["paper_collage_explainer_official"],
    placeholder: "例如 墨绿主色场、焦橙强调、暖白描边；干净精致不偏棕",
    options: ["焦橙/红色：劳动、压力、紧迫", "芥末黄：工具、警示、累积错误", "墨绿：认知、重置、判断", "深紫：记忆、结构、神秘", "青绿：协作、执行、系统流动", "玫红：荒诞、仪式、戏剧张力"] },
  { key: "object_groups", label: "纸片物件组", title: "每个隐喻节点使用多少可分离纸片组",
    onlyTemplates: ["paper_collage_explainer_official"],
    placeholder: "例如 4组：漏水纸桶、时间纸带、修补贴、人物半调剪影",
    options: ["每节点3个大纸片组", "每节点4个大纸片组", "每节点5–6个大纸片组，保持易读"] },
  { key: "audio_policy", label: "拼贴音频", title: "拼贴音效、BGM、旁白和字幕策略",
    onlyTemplates: ["paper_collage_explainer_official"],
    placeholder: "默认只保留触感拼贴音效；需要BGM/旁白/字幕必须明确选择",
    options: ["只保留纸片滑入/弹入/压平/摩擦/轻敲音效，无BGM无旁白无字幕", "保留拼贴音效并轻量混入BGM，不加旁白字幕", "保留拼贴音效并加入用户提供旁白，BGM在人声下压低"] },
  { key: "brand_name", label: "品牌/产品", title: "品牌、产品、网站、App或项目准确名称", required: true,
    onlyTemplates: ["brand_promo_official"],
    placeholder: "例如 H3 Director；只使用用户提供或官方可核验名称",
    options: [] },
  { key: "verified_claim", label: "核验卖点", title: "能够由素材或官方资料证明的功能与主张", required: true,
    onlyTemplates: ["brand_promo_official"],
    placeholder: "例如 一键把分镜批量生成并自动按最新片段重新合并；不要填写未经证实指标",
    options: [] },
  { key: "call_to_action", label: "行动号召", title: "结尾唯一CTA",
    onlyTemplates: ["brand_promo_official"],
    placeholder: "例如 Start Creating；没有CTA可写“只做品牌锁定”",
    options: ["Start Creating", "Explore More", "Try It Today", "Learn More", "只做品牌锁定，不出现CTA"] },
  { key: "brand_palette", label: "品牌色板", title: "来自品牌素材的2–5个真实色彩状态",
    onlyTemplates: ["brand_promo_official"],
    placeholder: "例如 深蓝主色、青色功能强调、白色文字、橙色峰值、深灰制动",
    options: ["使用官方主色+一个功能强调色+中性色", "2个主状态+1个高能峰值色+1个制动色", "严格沿用用户上传的品牌色，不自动生成新色盘"] },
  { key: "copy_language", label: "文案语言", title: "视频画面文案和旁白语言",
    onlyTemplates: ["brand_promo_official"],
    placeholder: "根据品牌素材、目标受众和投放平台选择，不机械跟随聊天语言",
    options: ["中文", "英文", "中英双语但同一画面只显示一种主要语言", "跟随品牌官方素材主语言"] },
  { key: "music_style", label: "音乐风格", title: "音乐、BPM、vocal模式和情绪温度", required: true,
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 92BPM Dark-pop / Cyber-grunge，女声低语副歌，冷峻但有爆发",
    options: ["Trap：808低频、hi-hat roll、强snare", "Dark-pop：冷调雾蓝、低语vocal、重低频", "Cyber-grunge：胶片扫描、复印纸颗粒、硬切故障", "Gospel hip-hop：合唱回应、鼓掌重拍、温暖高能", "纯器乐节拍MV，无人声"] },
  { key: "master_audio", label: "主音轨", title: "唯一Master Audio来源和状态", required: true,
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 已上传 song.wav，使用12.0–27.0秒；或未上传，按当前音乐风格设计纯器乐",
    options: ["使用用户上传的唯一Master Audio，全片不更换", "未上传音频：按已填写音乐风格设计主音轨", "使用完整音频，不拉伸不补长"] },
  { key: "music_window", label: "音乐窗口", title: "目标时长对应的音乐开始和结束位置",
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 00:42.000–00:57.000，使用副歌最强15秒",
    options: ["推荐窗口：选择最强副歌/hook/情绪转折", "用户时间戳：严格使用指定开始和结束秒数", "音频短于目标时长：使用完整音频，不拉伸"] },
  { key: "locked_lyrics", label: "锁定歌词", title: "唯一允许表演和显示的歌词原文", required: true,
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "粘贴歌词；没有歌词请明确写“无歌词纯音乐MV”",
    options: ["无歌词纯音乐MV，不生成可见歌词文字"] },
  { key: "typography_style", label: "文字包装", title: "歌词文字的字体、空间层和动效语言",
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 粗颗粒无衬线，文字在前景砸入，被肩膀短暂遮挡，不遮眼睛和嘴",
    options: ["文字作为前景空间图层砸入，人物可局部遮挡", "文字位于中景，跟随身体动作拉伸/错位", "文字贴在背景墙面或灯带，不做普通字幕条", "每镜只出现一个主文字事件"] },
  { key: "reference_roles", label: "参考卡分工", title: "人物、场景和文字参考必须职责隔离",
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 人物卡=歌手身份；场景卡=隧道空间；文字卡=粗颗粒字体和砸屏动效",
    multiple: true,
    options: ["人物卡只控制脸、发型、服装、比例和气场", "场景卡只控制空间、影像质感、背景和光影", "文字卡只控制字体、排版、比例和动效，不含人物场景"] },
  { key: "beat_map", label: "节拍映射", title: "鼓点、人声和视觉事件如何一一对应",
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 hi-hat=微震；snare=硬切/放大；808=压屏；vocal重音=文字砸入",
    multiple: true,
    options: ["hi-hat roll=微震/跳帧", "snare=放大/肩膀下压/硬切", "808 bass hit=低频压屏/拉伸/错位", "vocal重音=文字砸入或展开"] },
  { key: "stitch_policy", label: "衔接协议", title: "超过15秒时的首尾帧、硬切和音频连续规则",
    onlyTemplates: ["music_video_subtitle_official"],
    placeholder: "例如 同场景用上一镜尾帧续接；换场用同向Pan；切点只落在句间停顿或snare",
    multiple: true,
    options: ["同场景长镜延续：上一镜尾帧作为下一镜首帧", "换场：人物卡/服装/光影不变，使用同向运镜或Match Cut", "切点落在歌词停顿、呼吸、snare或drop", "只用硬切/跳切/扫描硬切/闪切，禁止淡入淡出"] },
  { key: "live_space", label: "实拍空间", title: "15秒内唯一或相邻的生活化实拍空间", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 雨天厨房水槽和相邻操作台",
    options: ["雨天厨房水槽", "旧阳台晾衣角", "清晨玄关", "小书店走廊", "火车窗边小桌", "浴室镜柜", "手作桌", "温室通道", "自助洗衣店长椅", "旧餐桌"] },
  { key: "contact_method", label: "真实接触", title: "0–3秒实拍手或物体如何触发手绘实体", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 手指划过起雾玻璃，雾痕缠住指尖并落入掌心",
    options: ["线条缠住手指", "发光形态落在掌心", "手伸去抓时实体逃跑", "从指尖摩擦痕诞生", "从真实物体表面被擦出"] },
  { key: "drawn_entity", label: "手绘实体", title: "初始手绘形态与可追踪母题", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 一只由三笔橙色蜡笔线组成的小纸船精灵",
    options: ["粗糙发光线条", "小植物", "生活小物件", "可爱小生物", "交通工具轮廓", "手绘记号"] },
  { key: "center_color", label: "中心色", title: "贯穿所有变形的核心颜色",
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 暖橙色+少量奶油白粉笔边",
    options: ["暖橙色", "湖蓝色", "草绿色", "粉红色", "金黄色", "紫罗兰色"] },
  { key: "transform_chain", label: "变形链", title: "同一实体连续变成哪些形态", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 小纸船→叶片小鱼→钥匙形小鸟→丝带花；每次保留橙色尾线",
    options: ["线条→植物→小鸟→丝带", "记号→小车→小鱼→花朵", "小物件→生物→纸片→云", "叶片→小船→风筝→巨大花"] },
  { key: "chase_route", label: "追逐路线", title: "同一空间内可连续拍摄的点位路线", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 掌心→水龙头→湿瓷砖→窗框→天花板",
    options: ["掌心→桌面→椅背→窗户", "镜面→水槽→柜门→天花板", "书页→书架→门框→走廊墙面", "晾衣夹→衣架→栏杆→窗外玻璃"] },
  { key: "filmer_reaction", label: "拍摄者反应", title: "拍摄者如何参与追逐和可爱节拍",
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 伸手抓→后退→打开柜门→接住掉队的小线点",
    multiple: true,
    options: ["伸手去抓但慢半拍", "边走边追并打开门/盒子", "后退躲开恶作剧", "在最后接住掉队的小点", "被花瓣或粉笔屑粘到镜头"] },
  { key: "space_finale", label: "空间级结尾", title: "13–15秒线条扩散成什么温柔大画面", required: true,
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 橙色线沿墙和天花板展开成会呼吸的巨大夕阳花园",
    options: ["巨大花朵", "手绘星空", "夕阳云层", "彩色丝带", "涂鸦小镇", "窗外纸片海洋"] },
  { key: "emotional_tone", label: "情绪调性", title: "全片的可爱、生活感和结尾余韵",
    onlyTemplates: ["handdrawn_live_official"],
    placeholder: "例如 温柔、怀旧、轻微俏皮，结尾感动后有一个笨拙小笑点",
    multiple: true,
    options: ["可爱、生活感、怀旧、温柔", "清晨轻快、略带俏皮", "雨天安静、最后温暖", "手作感、童年回忆、轻微幽默"] },
  { key: "characters", label: "角色", title: "角色或主体",
    placeholder: "只写完整角色名称，例如 熊猫、鳄鱼；必须与参考资产文件名或角色名一致",
    options: [] },
  { key: "appearance", label: "角色外观/服装", title: "角色固定外观、服装与身份锚点",
    placeholder: "例如 熊猫：黑白毛色、圆脸、红围巾；鳄鱼：绿色皮肤、长吻、黄背心；全片不换装",
    multiple: true,
    options: ["沿用参考图外观且全片不换装", "外观和服装全程固定", "风格转换只改变渲染方式，不改变角色轮廓与服装主色"] },
  { key: "scene", label: "场景", title: "主要场景",
    placeholder: "写场景完整名称，例如 蒸汽朋克游戏角色选择大厅",
    options: ["室内单场景", "室外单场景", "游戏角色选择大厅", "城市街道", "森林", "海边", "古风室内", "科幻控制室"] },
  { key: "scene_layout", label: "场景固定布局", title: "固定场景布局、地标和光源位置",
    placeholder: "例如 中央是圆形升降台，左侧机械菜单，右侧装备架，黄铜大门位于正前方，顶部冷蓝主光",
    multiple: true,
    options: ["场景地标、入口和主体相对位置全程固定", "主光方向和背景地标全程固定", "单场景内只移动角色和摄影机，不重排空间"] },
  { key: "props", label: "道具/装备", title: "固定道具或装备",
    placeholder: "必须写具体名称，例如 蒸汽扳手、黄铜护目镜；如果剧情选择装备，不能只写“装备”",
    multiple: true,
    options: ["无固定道具", "蒸汽扳手、黄铜护目镜", "短剑、圆盾", "能量护盾、脉冲工具", "钥匙、地图", "服装与随身道具保持不变"] },
  { key: "focus", label: "重点", title: "最需要保证什么？", catalog: "focus", multiple: true },
  { key: "structure", label: "镜头结构", title: "内容推进结构", catalog: "structure" },
  { key: "pace", label: "节奏", title: "叙事和剪辑节奏", catalog: "pace" },
  { key: "camera", label: "运镜", title: "主要镜头运动", catalog: "camera", multiple: true },
  { key: "transition", label: "转场", title: "段内和段间如何转场", catalog: "transition" },
  { key: "dialogue", label: "对白模式", title: "是否需要角色说话或旁白？", catalog: "dialogue",
    defaultValue: "无对白无旁白（纯环境声和动作音效，最稳）" },
  { key: "dialogue_language", label: "对白语言", title: "全部可听语言使用哪一种？", spokenOnly: true,
    defaultValue: "普通话（简体中文）", placeholder: "目前提供经过本地格式验证的普通话和英文；也可手动填写",
    options: H3_GUIDED_DIALOGUE_LANGUAGES },
  { key: "dialogue_script", label: "精确台词", title: "逐行填写全片绝对时间、说话人和最终台词", spokenOnly: true,
    requiredWhenSpeech: true, longInput: true,
    placeholder: "每行格式：0.000–2.000秒｜熊猫｜我一定要拿到那个红苹果。\n第二段必须继续使用全片时间，例如：16.000–18.000秒｜熊猫｜再试一次。",
    options: ["0.000–2.000秒｜角色名｜准确台词", "3.000–5.000秒｜旁白｜准确旁白"] },
  { key: "voice_direction", label: "声音表演", title: "台词怎样说才清楚？", spokenOnly: true, multiple: true,
    defaultValue: "自然语速、口齿清楚、逐字照读；禁止含混拟声、伪语言、乱码式发音和自动改词",
    placeholder: "例如 普通话自然语速，语气坚定；逐字照读，不改词",
    options: ["自然语速、口齿清楚、逐字照读", "语气温柔、音量稳定、句尾收干净", "语气紧张但不吞字", "语气坚定、短句清楚、动作音效在人声下压低", "旁白冷静克制，画面角色全程闭口"] },
  { key: "sound", label: "声音", title: "环境声与动作音效", catalog: "sound", defaultValue: "真实环境音+动作同步音效" },
  { key: "music", label: "配乐", title: "背景配乐", catalog: "music", defaultValue: "无背景音乐" },
  { key: "continuity", label: "连续性", title: "跨段连续性规则", catalog: "continuity", multiple: true,
    defaultValue: "角色身份/服装/道具全程锁定、前段结尾状态成为后段起点" },
  { key: "onscreen_text", label: "画面文字", title: "屏幕文字和字幕", catalog: "onscreen_text",
    defaultValue: "无屏幕文字和字幕" },
  { key: "constraint", label: "限制", title: "明确禁止出现的内容", catalog: "constraint", multiple: true },
]);

const H3_GUIDED_SEGMENT_FIELDS = Object.freeze([
  { key: "scene_time", label: "场景与时间", placeholder: "例如 同一蒸汽朋克大厅，夜晚；保持中央圆台、左右菜单和正前方黄铜大门" },
  { key: "start_state", label: "开场承接状态", placeholder: "第1段写初始状态；后续段写上一段最后帧中的位置、朝向、姿态、道具和摄影机方位" },
  { key: "positions", label: "角色位置与朝向", placeholder: "例如 熊猫位于左侧面向右前方，鳄鱼位于右侧面向正前方，两者间距不变" },
  { key: "objective", label: "本段目标", placeholder: "例如 两人完成具体装备确认，并让观众看清装备名称和归属" },
  { key: "obstacle", label: "障碍/变化", placeholder: "例如 机械菜单卡住，必须转动蒸汽扳手解除锁定；没有障碍可写“无额外障碍”" },
  { key: "action", label: "具体动作链", placeholder: "按先后顺序写可见动作：看向装备→伸手→握住蒸汽扳手→转动阀门→菜单亮起→黄铜大门解锁" },
  { key: "internal_shots", label: "内部镜头时间表", placeholder: "模板会按本段时长自动生成3–6个内部镜头，包含时间、职责、景别、摄影机触发、动作、结果和衔接；可直接修改" },
  { key: "framing", label: "景别与构图", placeholder: "例如 中景正面平衡构图，熊猫左、鳄鱼右，黄铜大门位于画面中央纵深处" },
  { key: "camera", label: "镜头运动", placeholder: "例如 固定镜头开始，角色转动阀门后缓慢推近；单次核心运镜不超过5秒" },
  { key: "lighting", label: "光线与色彩", placeholder: "例如 顶部冷蓝主光，黄铜大门内部暖橙补光；角色轮廓光方向不改变" },
  { key: "sound", label: "同步声音", placeholder: "例如 齿轮咬合声、扳手转动声、蒸汽喷射声、大门解锁低频确认音；声音与动作同步" },
  { key: "end_state", label: "最后帧/续接锚点", placeholder: "例如 两人停在黄铜大门前，熊猫右手握扳手、鳄鱼佩戴护目镜，大门打开一半，镜头保持正面中景" },
]);

/* 每段12项都提供可多选的快捷参考。点击只追加到当前输入框，不覆盖模板已经
   生成的详细内容；用户仍可在文本框中自由修改、删除或继续补充。 */
const H3_GUIDED_SEGMENT_QUICK_OPTIONS = Object.freeze({
  scene_time: [
    "同一场景、同一时间段，沿用固定布局和光源方向",
    "上一段场景原地续接，不切换地点",
    "同一场景，白天，自然光方向稳定",
    "同一场景，夜晚，已建立灯具位置不变",
    "同一场景，黄昏，冷暖光过渡连续",
    "只进入前文已经明确建立的相邻区域，不新增地点",
  ],
  start_state: [
    "从上一段最后帧完全续接角色位置、朝向、姿态和动作进度",
    "保持上一段道具归属、手持方式、开合状态和受力结果",
    "摄影机保持上一段轴线、屏幕方向和景别关系",
    "主光方向、环境亮度和色彩关系沿用上一段",
    "第一段从固定场景布局和角色初始姿态开始",
    "从上一段中性白光或遮挡帧后立即显现，但角色身份不变",
  ],
  positions: [
    "主体位于画面正中央，正面朝向镜头",
    "主角位于画面左侧，目标位于右侧，运动方向保持向右",
    "双人一左一右，朝向和相互距离全程不变",
    "主角位于前景，目标位于中景，固定地标位于背景",
    "主体侧身面向运动方向，视线指向明确目标",
    "跨镜头保持左/中/右位置、朝向和前后景关系",
  ],
  objective: [
    "建立角色、固定场景和当前明确目标",
    "让观众看清角色身份、外观和道具归属",
    "完成一次具体操作并得到可见反馈",
    "推进一个动作或线索，不增加无关支线",
    "使用前面已经建立的道具解决当前障碍",
    "完成核心动作并给出明确结果",
  ],
  obstacle: [
    "无额外障碍，重点展示当前动作和结果",
    "机关卡住或目标暂时锁定，必须通过具体操作解除",
    "前进路线被一个可见物体或环境结构阻挡",
    "信息暂时不完整，角色必须靠近、观察或接触确认",
    "时间压力增加，但不新增人物或地点",
    "第一次行动产生意外但可见的结果，需要立即调整",
  ],
  action: [
    "观察目标→靠近→伸手接触→目标反馈→角色确认结果",
    "看向道具→伸手→握住→操作→状态灯或环境发生变化",
    "沿固定方向移动→遇到障碍→停下判断→改变动作→继续前进",
    "主体动作先发生→摄影机随后跟随→接触点清楚→结果稳定",
    "使用已建立道具→产生真实接触或受力→障碍状态改变→目标完成",
    "确认上一动作结果→完成最后一个收束动作→停在清晰姿态",
  ],
  framing: [
    "中景正面平衡构图，主体、目标和固定地标同时可见",
    "大全景建立完整空间、入口、路线和角色位置",
    "中近景突出手部、道具和操作接触点",
    "近景突出表情、视线或关键状态变化",
    "固定侧视构图，运动方向从左到右保持不变",
    "第一人称构图，双手或道具位于画面下方，目标位于正前方",
    "前景遮挡、中景主体、背景地标形成清楚空间层次",
  ],
  internal_shots: [
    "每次切镜必须带来新的动作、信息、情绪或结果，不重复上一镜职责",
    "每个内部镜头只完成一个主要动作，时间、景别、摄影机触发和结果必须明确",
    "主体动作先发生，摄影机随后响应；不用无目的推拉摇移制造假镜头感",
    "接触、受力或状态改变必须给清楚镜头，随后用结果镜头确认空间变化",
    "本段最后一个内部镜头必须形成可续接最后帧，不提前执行下一生成段",
  ],
  camera: [
    "固定镜头，主体动作完整发生后再切换",
    "从中景缓慢推近至近景，单次核心运镜不超过5秒",
    "沿主体运动方向短距离跟随，不提前到达目标位置",
    "角色转头或伸手后，摄影机再小幅横移到目标",
    "稳定横向卷轴跟随，保持侧视方向不改变",
    "手机手持慢半拍追拍，允许轻微抖动和短暂失焦",
    "动作高潮后稳定拉远，展示明确结果和空间关系",
  ],
  lighting: [
    "顶部冷色主光保持固定，主体边缘由同方向轮廓光勾勒",
    "侧后方暖色主光配合柔和环境补光，方向全程不变",
    "冷暖对比照明，冷光负责环境、暖光只来自明确目标或入口",
    "自然日光稳定，阴影方向与场景时间一致",
    "夜景灯具位置固定，反射和阴影对应真实光源",
    "关键动作发生时只增强已有光源，不新增随机闪光",
  ],
  sound: [
    "持续真实环境底噪，空间远近和反射关系不改变",
    "脚步、呼吸、衣料和身体移动声与动作同步",
    "手部、道具、按钮、门锁或材质接触声逐项同步",
    "界面出现、选中、确认和启动分别使用不同电子提示音",
    "齿轮、阀门、链条、蒸汽和机械锁定声按操作顺序出现",
    "风压、破风、牵引、碰撞和落地声按受力顺序出现",
    "无对白无旁白，不在环境声字段重复配乐",
  ],
  end_state: [
    "停在动作可自然继续的清晰姿态，保留位置、朝向和动作进度",
    "角色、道具、目标和固定地标同时清楚，画面稳定无花屏",
    "道具归属、手持方式和开合状态明确，可供下一段直接继承",
    "核心动作完成，结果可见，不新增下一事件",
    "摄影机轴线、主光方向和角色屏幕位置保持到最后一帧",
    "最后一帧为纯白或明确遮挡的中性转换帧，下一段立即承接",
    "最终构图保留标题安全区，但不自动生成未指定文字",
  ],
});

const H3_API_PRESETS = Object.freeze({
  codexcn: {
    label: "CodexCN / Responses", base: "https://api2.codexcn.com/v1",
    models: [
      ["gpt-5.6-sol", "GPT-5.6 Sol（质量/编程）"],
      ["gpt-5.6-terra", "GPT-5.6 Terra（均衡）"],
      ["gpt-5.6-luna", "GPT-5.6 Luna（快速/省额度）"],
    ],
  },
  openai: {
    label: "OpenAI 官方", base: "https://api.openai.com/v1",
    models: [
      ["gpt-5", "GPT-5（图文/质量）"],
      ["gpt-5-mini", "GPT-5 mini（图文/省流量）"],
      ["gpt-4.1", "GPT-4.1（图文）"],
      ["gpt-4.1-mini", "GPT-4.1 mini（图文/省流量）"],
    ],
  },
  deepseek: {
    label: "DeepSeek 官方", base: "https://api.deepseek.com/v1",
    models: [
      ["deepseek-chat", "DeepSeek Chat（文本）"],
      ["deepseek-reasoner", "DeepSeek Reasoner（推理；长剧本不推荐）"],
    ],
  },
  zhipu: {
    label: "智谱 AI", base: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      ["glm-5.2", "GLM-5.2（文本/旗舰）"],
      ["glm-4.7", "GLM-4.7（文本/通用）"],
      ["glm-4.7-flash", "GLM-4.7 Flash（文本/免费）"],
      ["glm-4.5-air", "GLM-4.5 Air（文本/性价比）"],
      ["glm-5v-turbo", "GLM-5V Turbo（图文/旗舰）"],
      ["glm-4.6v-flash", "GLM-4.6V Flash（图文/免费）"],
    ],
  },
  openrouter: {
    label: "OpenRouter", base: "https://openrouter.ai/api/v1",
    models: [
      ["openai/gpt-5", "OpenRouter · GPT-5（图文）"],
      ["openai/gpt-5-mini", "OpenRouter · GPT-5 mini（图文）"],
      ["anthropic/claude-sonnet-4", "OpenRouter · Claude Sonnet 4（图文）"],
      ["google/gemini-2.5-pro", "OpenRouter · Gemini 2.5 Pro（图文）"],
    ],
  },
  siliconflow: {
    label: "硅基流动", base: "https://api.siliconflow.cn/v1",
    models: [
      ["Qwen/Qwen2.5-VL-72B-Instruct", "Qwen2.5-VL-72B（图文）"],
      ["deepseek-ai/DeepSeek-V3", "DeepSeek V3（文本）"],
      ["deepseek-ai/DeepSeek-R1", "DeepSeek R1（文本/推理）"],
    ],
  },
  dashscope: {
    label: "阿里云百炼", base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      ["qwen-vl-max", "Qwen VL Max（图文）"],
      ["qwen-plus", "Qwen Plus（文本）"],
      ["qwen-max", "Qwen Max（文本）"],
    ],
  },
  custom: { label: "自定义 / 中转站", base: "", models: [] },
});

function newProjectId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return "h3_" + globalThis.crypto.randomUUID();
    }
  } catch (e) { /* 使用时间戳回退 */ }
  const rand = Math.random().toString(36).slice(2, 12);
  return "h3_" + Date.now().toString(36) + "_" + rand;
}

/* 画布缩放系数：DOM 拖拽拿到的 clientX/Y 是屏幕像素，节点/面板尺寸是画布坐标，
   两者差 ds.scale 倍（如 59% 缩放时差 1.69 倍）。所有拖拽位移必须除以它，
   否则低缩放下拖一点就跳一大截（"缩放不可控"的根因）。 */
const canvasScale = () => {
  try { return (app.canvas && app.canvas.ds && app.canvas.ds.scale) || 1; } catch (e) { return 1; }
};

function attachH3CanvasWheelZoom(root) {
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 1) return;
    const canvas = app.canvas;
    const ds = canvas && canvas.ds;
    if (!ds || !Array.isArray(ds.offset)) return;
    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const startX = Number(event.clientX || 0);
    const startY = Number(event.clientY || 0);
    const startOffset = [Number(ds.offset[0] || 0), Number(ds.offset[1] || 0)];
    const previousCursor = root.style.cursor;
    root.style.cursor = "grabbing";
    let ended = false;

    const finish = (finishEvent) => {
      if (ended) return;
      if (finishEvent && pointerId != null && finishEvent.pointerId != null
          && finishEvent.pointerId !== pointerId) return;
      ended = true;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      root.style.cursor = previousCursor;
      if (finishEvent) {
        if (finishEvent.cancelable) finishEvent.preventDefault();
        finishEvent.stopPropagation();
      }
    };
    const onMove = (moveEvent) => {
      if (pointerId != null && moveEvent.pointerId !== pointerId) return;
      if (typeof moveEvent.buttons === "number" && (moveEvent.buttons & 4) === 0) {
        finish(moveEvent);
        return;
      }
      const nextOffset = h3CanvasOffsetAfterPan(
        startOffset,
        Number(moveEvent.clientX || 0) - startX,
        Number(moveEvent.clientY || 0) - startY,
        ds.scale,
      );
      ds.offset[0] = nextOffset[0];
      ds.offset[1] = nextOffset[1];
      canvas.setDirty(true, true);
      if (moveEvent.cancelable) moveEvent.preventDefault();
      moveEvent.stopPropagation();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }, { capture: true });
  root.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  root.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && findH3WheelOwner(
      event.target, root, event.deltaX, event.deltaY,
      (element) => globalThis.getComputedStyle(element))) return;
    const canvas = app.canvas;
    const ds = canvas && canvas.ds;
    if (!ds) return;
    const delta = Number(event.deltaY || event.deltaX || 0);
    if (!delta) return;
    const oldScale = Number(ds.scale) || 1;
    const newScale = nextH3CanvasScale(oldScale, delta, ds.min_scale, ds.max_scale);
    if (newScale === oldScale) return;
    event.preventDefault();
    event.stopPropagation();
    const canvasElement = canvas.canvas || app.canvasEl;
    const rect = canvasElement && typeof canvasElement.getBoundingClientRect === "function"
      ? canvasElement.getBoundingClientRect()
      : { left: 0, top: 0 };
    const point = [event.clientX - rect.left, event.clientY - rect.top];
    const appliedScale = Math.abs(newScale - 1) < 0.01 ? 1 : newScale;
    const nextOffset = h3CanvasOffsetAtPoint(ds.offset, oldScale, appliedScale, point);
    ds.scale = appliedScale;
    ds.offset[0] = nextOffset[0];
    ds.offset[1] = nextOffset[1];
    canvas.setDirty(true, true);
  }, { capture: true, passive: false });
}

/* 音频波形峰值缓存：文件名 -> {peaks, duration}，避免每次渲染重复解码 */
const _waveCache = {};
async function loadWavePeaks(name, n = 520) {
  if (_waveCache[name]) return _waveCache[name];
  const buf = await (await api.fetchApi("/view?filename=" + encodeURIComponent(name) + "&type=input")).arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  const ab = await actx.decodeAudioData(buf.slice(0));
  const ch = ab.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / n));
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    const off = i * step;
    for (let j = 0; j < step; j += 16) {
      const v = Math.abs(ch[off + j] || 0);
      if (v > m) m = v;
    }
    peaks[i] = m;
  }
  try { actx.close(); } catch (e) { /* 忽略 */ }
  const out = { peaks, duration: ab.duration };
  _waveCache[name] = out;
  return out;
}

const PANEL_CSS = `
.h3s { display:flex; flex-direction:column; gap:8px; width:100%; height:100%; padding:8px;
  box-sizing:border-box; font-size:12px; color:#ddd; background:#14171c; overflow:hidden;
  container-type:inline-size; container-name:h3studio; }
.h3s * { box-sizing:border-box; }
.h3s-bar { display:flex; gap:7px; align-items:center; flex-wrap:wrap; flex:none; padding:7px;
  border:1px solid #303640; border-radius:9px; background:#1b1f27; }
.h3s-toolbar-group { display:flex; gap:5px; align-items:center; flex-wrap:wrap; min-width:0; }
.h3s-toolbar-group + .h3s-toolbar-group { padding-left:7px; border-left:1px solid #343a45; }
.h3s-toolbar-info { margin-left:auto; justify-content:flex-end; color:#aeb8c6; }
.h3s-api-config { flex:none; border:1px solid #31465b; border-radius:9px; background:#17212b; overflow:hidden; }
.h3s-api-head { display:flex; align-items:center; gap:8px; padding:6px 9px; cursor:pointer; color:#d9ecff; }
.h3s-api-head .h3s-api-state { margin-left:auto; color:#8fb7d9; font-size:10px; }
.h3s-api-body { display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:7px 9px;
  border-top:1px solid #2a4054; }
.h3s-api-body input, .h3s-api-body select { min-height:25px; max-width:100%; }
.h3s-api-body > input { flex:1 1 240px !important; width:auto !important; min-width:160px !important; }
.h3s-api-body > select { flex:0 1 210px; min-width:135px; }
.h3s-second-config { flex:none; border:1px solid #345b58; border-radius:9px; background:#132321;
  color:#d7f4ef; overflow:hidden; }
.h3s-second-head { display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer; color:#d7f4ef; }
.h3s-second-summary { display:flex; align-items:center; gap:7px; margin-left:auto; color:#8fbdb5; font-size:11px; }
.h3s-second-badge { display:inline-flex; align-items:center; min-height:23px; padding:2px 10px;
  border:1px solid #416b66; border-radius:999px; color:#b8d8d3; background:#10201e; white-space:nowrap; }
.h3s-second-badge.enabled { border-color:#3ebf91; color:#77edbd; }
.h3s-second-badge.disabled { border-color:#5b716e; color:#9aafac; }
.h3s-second-sample { display:flex; flex-direction:column; gap:12px; padding:12px;
  border-top:1px solid #315653; }
.h3s-second-sample[hidden] { display:none; }
.h3s-second-sample[data-tone="error"] { border-color:#a74b4b; box-shadow:0 0 0 1px rgba(255,128,128,.16); }
.h3s-second-grid { display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:12px 14px; align-items:start; }
.h3s-second-field { display:flex; flex-direction:column; gap:5px; grid-column:span 3; min-width:0; }
.h3s-second-field.wide { grid-column:span 6; }
.h3s-second-field.full { grid-column:1 / -1; }
.h3s-second-field > label { color:#a7cbc5; }
.h3s-second-field-note { color:#8fb0aa; font-size:10px; line-height:1.4; }
.h3s-second-grid input, .h3s-second-grid select, .h3s-second-grid textarea,
.h3s-second-row input, .h3s-second-row select {
  width:100%; min-width:0; min-height:28px; border:1px solid #416b66; border-radius:6px;
  background:#0c1817; color:#e4faf6; padding:3px 7px; }
.h3s-second-grid input[readonly], .h3s-second-row input[readonly] {
  background:#101a19; color:#8fb0aa; cursor:default; }
.h3s-second-grid textarea { min-height:78px; resize:vertical; }
.h3s-second-resolution { grid-column:span 6; align-self:end; min-height:47px; padding:11px 14px;
  border:1px solid #63cabb; border-left:4px solid #72dfce; border-radius:6px;
  background:#163834; color:#d8f5ef; font-size:12px; line-height:1.55; }
.h3s-second-switches { display:flex; align-items:center; gap:10px 22px; flex-wrap:wrap;
  grid-column:1 / -1; min-height:38px; padding:7px 10px; border:1px solid #315653;
  border-radius:7px; background:#10201e; }
.h3s-second-switch { display:inline-flex; align-items:center; gap:7px; color:#d7f4ef;
  cursor:pointer; white-space:nowrap; }
.h3s-second-switch input { width:16px; min-height:16px; margin:0; accent-color:#39b99c; cursor:pointer; }
.h3s-second-setup { border:0; border-top:1px solid #315653; border-bottom:1px solid #315653;
  background:#0e1b1a; }
.h3s-second-setup > summary { display:flex; align-items:center; gap:8px; min-height:45px; padding:8px 2px;
  color:#d8f5ef; font-weight:700; cursor:pointer; list-style:none; }
.h3s-second-setup > summary::-webkit-details-marker { display:none; }
.h3s-second-setup > summary::before { content:"›"; color:#71d8c7; font-size:18px; transition:transform .15s ease; }
.h3s-second-setup[open] > summary::before { transform:rotate(90deg); }
.h3s-second-setup-summary-state { margin-left:auto; color:#e4bc65; font-size:11px; font-weight:500; }
.h3s-second-setup-summary-state.error { color:#ff9a92; }
.h3s-second-setup-body { display:flex; flex-direction:column; gap:8px; padding:0 8px 10px; }
.h3s-second-setup-grid { display:grid; grid-template-columns:150px minmax(180px,1fr) minmax(220px,1.4fr);
  gap:7px 9px; align-items:center; }
.h3s-second-setup-grid label { color:#a7cbc5; }
.h3s-second-setup-grid select { width:100%; min-width:0; min-height:28px; border:1px solid #416b66;
  border-radius:6px; background:#0c1817; color:#e4faf6; padding:3px 7px; }
.h3s-second-setup-stage { color:#8fbdb5; line-height:1.45; overflow-wrap:anywhere; }
.h3s-second-setup-stage.error { color:#ff9a92; font-weight:600; }
.h3s-second-local-picker { display:flex; flex-wrap:wrap; gap:7px; align-items:center;
  padding:7px 8px; border:1px solid #3d5f5b; border-radius:6px; background:#102522; }
.h3s-second-local-picker[hidden] { display:none; }
.h3s-second-local-picker input[type=file] { display:none; }
.h3s-second-local-picker-state { flex:1 1 240px; color:#9fc9c2; overflow-wrap:anywhere; }
.h3s-second-local-picker-state.error { color:#ff9a92; font-weight:600; }
.h3s-second-local-note { color:#ffd08a; line-height:1.45; }
.h3s-second-segments { display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto; }
.h3s-second-row { display:grid; grid-template-columns:60px minmax(110px,.8fr) minmax(140px,1fr) repeat(3,minmax(68px,.5fr)) minmax(90px,.6fr) minmax(145px,.9fr);
  gap:6px; align-items:center; padding:6px; border:1px solid #2f514e; border-radius:7px; background:#0e1b1a; }
.h3s-second-mode { display:grid; gap:5px; }
.h3s-second-size { display:grid; grid-template-columns:minmax(110px,.8fr) repeat(2,minmax(76px,.6fr)); gap:5px; min-width:250px; }
.h3s-second-size .h3s-second-mp { grid-column:2 / -1; }
.h3s-second-setup-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.h3s-second-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.h3s-second-save-hint { color:#8fb0aa; font-size:10px; }
.h3s-second-state { color:#a8d6ce; line-height:1.5; overflow-wrap:anywhere; }
.h3s-second-state.error { color:#ff9a92; font-weight:600; }
.h3s-second-progress { height:8px; min-width:220px; flex:1; overflow:hidden; border:1px solid #37645f;
  border-radius:999px; background:#091210; }
.h3s-second-progress > div { height:100%; width:0; background:linear-gradient(90deg,#2f9a87,#75dac8); }
.h3s-second-progress.busy > div { width:42%; animation:h3s-second-progress 1.1s ease-in-out infinite alternate; }
.h3s-second-progress.runtime > div { animation:none; transition:width .18s ease; }
@keyframes h3s-second-progress { from { transform:translateX(-95%); } to { transform:translateX(235%); } }
.h3s-tabs .h3s-btn { min-width:70px; }
.h3s-btn { cursor:pointer; border:1px solid #555; border-radius:7px; padding:4px 10px;
  background:#2a2a30; color:#ddd; font-size:12px; }
.h3s-btn:hover { filter:brightness(1.3); }
.h3s-btn.primary { background:#185FA5; border-color:#185FA5; color:#fff; }
.h3s-btn.run-error { background:#7b2929; border-color:#d76565; color:#fff; }
.h3s-btn:disabled { opacity:0.5; cursor:not-allowed; }
.h3s-bulk-switch { display:inline-flex; align-items:center; gap:5px; min-height:26px; padding:3px 8px;
  border:1px solid #555; border-radius:7px; background:#232932; color:#dbe9f6; cursor:pointer; white-space:nowrap; }
.h3s-bulk-switch:hover, .h3s-bulk-switch:focus-within { border-color:#378ADD; }
.h3s-bulk-switch input { width:15px; height:15px; margin:0; accent-color:#378ADD; cursor:pointer; }
.h3s-resize-handle { display:flex; align-items:center; justify-content:center; gap:8px; height:14px; flex:none;
  cursor:nwse-resize; color:#8ab4f8; font-size:11px; user-select:none; margin-top:2px; opacity:.82; }
.h3s-resize-handle::before, .h3s-resize-handle::after { content:""; width:42px; max-width:18%;
  height:1px; background:#46515f; }
.h3s-resize-handle.vertical { cursor:ns-resize; }
.h3s-run-state { max-width:520px; color:#8fcaff; font-size:10px; line-height:1.35; overflow-wrap:anywhere; }
.h3s-run-state[data-tone="error"] { color:#ff8f87; font-weight:600; }
.h3s-run-state[data-tone="success"] { color:#8ee6a0; }
.h3s-merge-state { max-width:300px; color:#8ee6a0; font-size:10px; line-height:1.35; overflow-wrap:anywhere; }
.h3s-merge-state[data-tone="busy"] { color:#8fcaff; }
.h3s-merge-state[data-tone="error"] { color:#ff8080; }
.h3s-status { font-size:11px; line-height:1.35; opacity:0.9; margin-left:0;
  min-width:0; max-width:720px; overflow:hidden; text-overflow:ellipsis;
  white-space:normal; overflow-wrap:anywhere; display:-webkit-box;
  -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.h3s-prompt-assist { position:relative; display:flex; flex-direction:column; flex:none; min-width:0; min-height:0;
  overflow:hidden; margin-top:4px; border:1px solid #303b47; border-radius:8px; background:#181d24; }
.h3s-prompt-assist-hint { color:#8ea6bd; font-size:10px; line-height:1.45; }
.h3s-prompt-category-bar { display:flex; align-items:center; gap:5px; width:100%; min-width:0; padding:6px;
  overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; }
.h3s-prompt-category-label { flex:none; color:#8198aa; font-size:10px; white-space:nowrap; padding:0 2px; }
.h3s-prompt-category { flex:0 0 auto; cursor:pointer; min-width:54px; border:1px solid #3b4b59;
  border-radius:6px; padding:5px 10px; background:#202832; color:#cfdae3; font-size:10px; line-height:1.35; }
.h3s-prompt-category:hover, .h3s-prompt-category:focus { outline:0; border-color:#5b9bca; background:#263746; color:#fff; }
.h3s-prompt-category.active { border-color:#58a9e3; background:#185f91; color:#fff; box-shadow:0 0 0 1px rgba(88,169,227,.18) inset; }
.h3s-prompt-category-spacer { flex:1 0 10px; }
.h3s-prompt-refine { flex:0 0 auto; white-space:nowrap; }
.h3s-prompt-selection-state { flex:0 0 auto; max-width:130px; overflow:hidden; text-overflow:ellipsis;
  color:#8298aa; font-size:9px; white-space:nowrap; }
.h3s-prompt-actions { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.h3s-prompt-actions .h3s-btn.primary { font-weight:600; }
.h3s-guide { display:none; flex-direction:column; gap:7px; padding:8px;
  border:1px solid #35658a; border-radius:9px; background:#142331; color:#d9ecff; }
.h3s-guide.show { display:flex; }
.h3s-guide-head { display:flex; align-items:center; gap:8px; }
.h3s-guide-progress { color:#7fc3ff; font-size:10px; white-space:nowrap; }
.h3s-guide-title { flex:1; min-width:0; font-size:12px; font-weight:650; }
.h3s-guide-template { display:flex; flex-direction:column; gap:5px; padding:7px;
  border:1px solid #31516a; border-radius:7px; background:#101d28; }
.h3s-guide-template-label { color:#bfe1ff; font-size:11px; font-weight:650; }
.h3s-guide-template-row { display:flex; gap:6px; align-items:stretch; flex-wrap:wrap; }
.h3s-guide-template-row select { flex:1 1 250px; min-width:0; min-height:30px; border:1px solid #47657d;
  border-radius:6px; background:#0d171f; color:#e5eef8; font-size:11px; padding:4px 7px; }
.h3s-guide-template-row .h3s-btn { flex:0 0 auto; }
.h3s-guide-template-description { color:#91a9bf; font-size:10px; line-height:1.5;
  min-height:0; white-space:normal; overflow-wrap:anywhere; }
.h3s-guide-mode-row { display:flex; gap:6px; flex-wrap:wrap; }
.h3s-guide-mode-row .h3s-btn.active { background:#185f91; border-color:#4db1ff; color:#fff; }
.h3s-guide-mode-help { color:#91a9bf; font-size:10px; line-height:1.45; padding:2px 1px; }
.h3s-one-line { display:flex; flex-direction:column; gap:7px; padding:8px; border:1px solid #31516a;
  border-radius:8px; background:#101d28; }
.h3s-one-line-label { color:#d8efff; font-size:12px; font-weight:650; }
.h3s-one-line-input { width:100%; min-height:66px; resize:vertical; border:1px solid #4a7595;
  border-radius:8px; background:#0b151d; color:#f2f8fd; padding:8px 10px; font-size:13px; line-height:1.55; }
.h3s-one-line-input:focus { outline:1px solid #48aaf0; border-color:#48aaf0; }
.h3s-one-line-state { color:#92b4cc; font-size:10px; line-height:1.45; }
.h3s-one-line-section { display:flex; flex-direction:column; gap:5px; padding:7px; border:1px solid #2d4b61;
  border-radius:7px; background:#0d1922; }
.h3s-one-line-section[hidden] { display:none; }
.h3s-one-line-title { color:#bfe1ff; font-size:10px; font-weight:650; }
.h3s-one-line-choices, .h3s-one-line-tags { display:flex; flex-wrap:wrap; gap:5px; }
.h3s-one-line-choice, .h3s-one-line-tag { cursor:pointer; border:1px solid #3f6682; border-radius:999px;
  background:#173047; color:#c9e7fb; padding:4px 8px; font-size:10px; line-height:1.4; text-align:left; }
.h3s-one-line-choice:hover { border-color:#65bfff; background:#1e4969; color:#fff; }
.h3s-one-line-choice.active { border-color:#79caff; background:#185f91; color:#fff; }
.h3s-one-line-tag { cursor:default; background:#16394c; border-color:#347ba4; }
.h3s-one-line-tag button { cursor:pointer; margin-left:5px; padding:0; border:0; background:transparent; color:#a9dfff; }
.h3s-one-line-details { border:1px solid #2d4b61; border-radius:7px; background:#0d1922; }
.h3s-one-line-details summary { cursor:pointer; padding:7px; color:#bfe1ff; font-size:10px; }
.h3s-one-line-detail-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:6px; padding:0 7px 7px; }
.h3s-one-line-detail { display:flex; flex-direction:column; gap:4px; color:#9fc3df; font-size:9px; }
.h3s-one-line-detail textarea { width:100%; min-height:48px; resize:vertical; border:1px solid #405e74;
  border-radius:6px; background:#0a141b; color:#e7f2fb; padding:5px 7px; font-size:10px; line-height:1.45; }
.h3s-one-line-shot-list { display:flex; flex-direction:column; gap:5px; max-height:230px; overflow:auto; }
.h3s-one-line-shot { display:grid; grid-template-columns:86px minmax(0,1fr); gap:7px; padding:6px;
  border:1px solid #31516a; border-radius:6px; background:#122536; color:#cce9ff; font-size:9px; line-height:1.45; }
.h3s-one-line-shot-time { color:#6fc6ff; font-family:Consolas,monospace; }
.h3s-one-line-dialogue { grid-column:1/-1; display:flex; flex-direction:column; gap:6px; padding:7px;
  border:1px solid #35566e; border-radius:7px; background:#10202c; }
.h3s-one-line-dialogue-segment { display:flex; flex-direction:column; gap:5px; padding:6px;
  border:1px solid #2f4b60; border-radius:6px; background:#0b1720; }
.h3s-one-line-dialogue-row { display:grid; grid-template-columns:68px 68px minmax(86px,.6fr) minmax(160px,1.6fr) auto;
  gap:5px; align-items:center; }
.h3s-one-line-dialogue-row input, .h3s-one-line-dialogue-row select { width:100%; min-width:0; border:1px solid #405e74;
  border-radius:5px; background:#09131a; color:#e7f2fb; padding:4px 5px; font-size:9px; }
.h3s-one-line-dialogue-row button { padding:3px 6px; }
.h3s-one-line-dialogue-status { color:#91a9bf; font-size:9px; line-height:1.45; }
.h3s-one-line-dialogue-status.error { color:#ffaaa2; }
.h3s-one-line-dialogue-status.warn { color:#ffd27a; }
.h3s-one-line-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.h3s-one-line-actions .spacer { flex:1; }
.h3s-guide-ai-panel { display:none; flex-direction:column; gap:7px; padding:9px;
  border:1px solid #35658a; border-radius:8px; background:#101f2b; }
.h3s-guide-ai-panel.show { display:flex; }
.h3s-guide-ai-summary { color:#c8e7ff; font-size:10px; line-height:1.55; white-space:pre-wrap; }
.h3s-guide-ai-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.h3s-guide-overview { display:none; flex-direction:column; gap:7px; max-height:min(62vh,640px);
  overflow:auto; padding:7px; border:1px solid #304f68; border-radius:8px; background:#0f1b25; }
.h3s-guide-overview.show { display:flex; }
.h3s-guide-overview-card { display:flex; flex-direction:column; gap:5px; padding:7px;
  border:1px solid #365a75; border-radius:7px; background:#142535; }
.h3s-guide-overview-card.done { border-color:#3184bd; background:#153048; }
.h3s-guide-overview-card.pending { border-color:#6b5a35; background:#292419; }
.h3s-guide-overview-head { display:flex; gap:8px; align-items:center; color:#cce9ff; font-size:10px; }
.h3s-guide-overview-time { flex:none; color:#6fc6ff; font-family:Consolas,monospace; }
.h3s-guide-overview-title { flex:1; font-weight:650; }
.h3s-guide-overview-input { width:100%; min-height:34px; resize:vertical; border:1px solid #4a6b83;
  border-radius:6px; background:#0c151d; color:#e7f2fb; padding:5px 7px; font-size:10px; line-height:1.45; }
.h3s-guide-overview-choices { display:flex; gap:4px; flex-wrap:wrap; }
.h3s-guide-overview-choices button { cursor:pointer; border:1px solid #3f6682; border-radius:999px;
  background:#173047; color:#c9e7fb; padding:3px 7px; font-size:9px; line-height:1.35; }
.h3s-guide-overview-choices button:hover { border-color:#65bfff; background:#1e4969; color:#fff; }
.h3s-guide-overview-choices button.active { border-color:#79caff; background:#185f91; color:#fff; }
.h3s-guide-note { color:#91a9bf; font-size:10px; line-height:1.45; }
.h3s-guide-choices { display:flex; gap:5px; flex-wrap:wrap; max-height:128px; overflow:auto; }
.h3s-guide-choice { cursor:pointer; border:1px solid #45617a; border-radius:999px; padding:3px 8px;
  background:#1d2c39; color:#d6e8f8; font-size:10px; line-height:1.45; }
.h3s-guide-choice:hover { border-color:#5aa7e8; background:#203b51; color:#fff; }
.h3s-guide-choice.active { border-color:#4db1ff; background:#185f91; color:#fff; }
.h3s-guide-input { width:100%; min-height:34px; resize:vertical; border:1px solid #4a6074;
  border-radius:7px; background:#0f171f; color:#e5eef8; font-size:11px; line-height:1.45; padding:6px 8px; }
.h3s-guide-input.long { min-height:150px; font-family:Consolas,"Microsoft YaHei UI",sans-serif; line-height:1.6; }
.h3s-guide-segment-form { display:none; grid-template-columns:minmax(118px,.34fr) minmax(220px,1fr);
  gap:8px 10px; max-height:min(58vh,560px); overflow:auto; padding:7px; border:1px solid #30485c;
  border-radius:7px; background:#101b24; }
.h3s-guide-segment-form.show { display:grid; }
.h3s-guide-segment-form label { align-self:start; padding-top:6px; color:#9fc3df; font-size:10px; line-height:1.35; }
.h3s-guide-segment-form label small { display:block; margin-top:3px; color:#6988a2; font-size:9px; font-weight:400; }
.h3s-guide-segment-control { min-width:0; display:flex; flex-direction:column; gap:4px; }
.h3s-guide-segment-form textarea { width:100%; min-height:46px; resize:vertical; border:1px solid #40566a;
  border-radius:6px; background:#0c141b; color:#e6eef6; font-size:10px; line-height:1.45; padding:5px 7px; }
.h3s-guide-field-choices { display:flex; gap:4px; flex-wrap:wrap; max-height:54px; overflow:auto; padding:1px 0; }
.h3s-guide-field-choice { cursor:pointer; max-width:230px; border:1px solid #38536a; border-radius:6px;
  background:#162635; color:#bcd6ea; font-size:9px; line-height:1.35; padding:3px 6px;
  white-space:normal; text-align:left; overflow-wrap:anywhere; }
.h3s-guide-field-choice:hover { border-color:#5aa7e8; background:#203b51; color:#fff; }
.h3s-guide-field-choice.active { border-color:#4db1ff; background:#174d72; color:#fff; }
.h3s-guide-nav { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.h3s-guide-nav .spacer { flex:1; }
.h3s-guide-preview { margin:0; max-height:220px; overflow:auto; white-space:pre-wrap;
  overflow-wrap:anywhere; border:1px solid #344b60; border-radius:7px; background:#0d151c;
  color:#d7e5f2; font:10px/1.5 ui-monospace,Consolas,monospace; padding:7px; }
.h3s-prompt-menu { display:none; position:relative; width:100%; min-width:0; max-width:none;
  margin-top:0; padding:3px 1px 1px; border:0; border-radius:0; background:transparent; }
.h3s-prompt-menu.show { display:block; }
.h3s-prompt-context-head { display:flex; align-items:center; justify-content:space-between; gap:8px;
  margin:0 1px 6px; padding:2px 4px 6px; border-bottom:1px solid #29475d; color:#b9ddf5;
  font-size:10px; line-height:1.45; }
.h3s-prompt-context-head small { color:#7f9db4; font-size:9px; font-weight:400; }
.h3s-prompt-context-copy { display:flex; flex-direction:column; gap:1px; min-width:0; }
.h3s-prompt-context-copy > span { color:#cce9ff; font-weight:650; }
.h3s-prompt-context-close { flex:none; cursor:pointer; border:1px solid #36536a; border-radius:5px;
  padding:3px 7px; background:#182632; color:#aac5d8; font-size:9px; }
.h3s-prompt-context-close:hover { border-color:#5b9bca; color:#fff; }
.h3s-ta.h3s-inline-guide-owner { border-color:#3f627d; }
.h3s-prompt-choices { display:flex; flex-direction:column; gap:4px; min-width:0; max-height:150px; overflow:auto; }
.h3s-prompt-choices.h3s-prompt-choices-compact { flex-direction:row; flex-wrap:nowrap; align-items:stretch; max-height:92px;
  overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; }
.h3s-prompt-choice { cursor:pointer; width:auto; max-width:100%; border:1px solid #36536a; border-radius:6px; padding:5px 8px;
  background:#152330; color:#e3e9ef; font-size:10px; line-height:1.4; text-align:left;
  white-space:normal; overflow-wrap:anywhere; }
.h3s-prompt-choices-compact .h3s-prompt-choice { flex:1 1 180px; }
.h3s-prompt-choice:hover, .h3s-prompt-choice:focus { outline:0; border-color:#5b9bca; background:#1d3446; color:#fff; }
.h3s-prompt-choice small { display:block; margin-top:2px; color:#96a2ae; font-size:9px; line-height:1.4; }
.h3s-inline-guide-head { display:flex; align-items:center; gap:7px; padding:3px 5px 6px; border-bottom:1px solid #303945; }
.h3s-inline-guide-progress { flex:none; color:#74c6ff; font:10px/1.3 Consolas,"Microsoft YaHei UI",sans-serif; }
.h3s-inline-guide-title { min-width:0; flex:1; color:#eef7ff; font-size:11px; font-weight:700; }
.h3s-inline-guide-purpose { margin:5px 5px 6px; color:#aebdca; font-size:10px; line-height:1.55; }
.h3s-inline-guide-prompt { margin:0 5px 5px; color:#d4e7f5; font-size:10px; line-height:1.45; }
.h3s-inline-guide-options-strip { display:flex; gap:6px; min-width:0; padding:1px 1px 5px;
  overflow-x:auto; overflow-y:hidden; scroll-snap-type:x proximity; scrollbar-width:thin; }
.h3s-inline-guide-option { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start; gap:8px;
  flex:0 0 clamp(245px,48%,390px); min-width:0; padding:6px 7px; border:1px solid #2b3d4c;
  border-radius:6px; background:#151d24; scroll-snap-align:start; }
.h3s-inline-guide-option:hover { background:#232c35; }
.h3s-inline-guide-option.selected { border-color:#4f86ab; background:#173047; }
.h3s-inline-guide-option-text { min-width:0; max-height:3.05em; overflow:hidden; color:#e5ebf0; font-size:10px;
  line-height:1.5; white-space:normal; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }
.h3s-inline-guide-select { cursor:pointer; border:1px solid #4f7592; border-radius:5px; padding:3px 7px;
  background:#173850; color:#dff2ff; font-size:10px; white-space:nowrap; }
.h3s-inline-guide-select:hover, .h3s-inline-guide-confirm:hover { border-color:#79caff; background:#20577e; color:#fff; }
.h3s-inline-guide-actions { display:flex; gap:5px; flex-wrap:wrap; align-items:center; padding:6px 5px 2px; border-top:1px solid #303945; }
.h3s-inline-guide-confirm { cursor:pointer; border:1px solid #4f86ab; border-radius:5px; padding:5px 9px;
  background:#185f91; color:#fff; font-size:10px; }
.h3s-inline-guide-secondary { cursor:pointer; border:1px solid #485764; border-radius:5px; padding:5px 8px;
  background:#20262d; color:#c7d0d8; font-size:10px; }
.h3s-inline-guide-summary { margin:2px 5px 5px; padding:6px; max-height:150px; overflow:auto; border-radius:5px;
  background:#10151a; color:#aebdca; font-size:9px; line-height:1.55; white-space:pre-wrap; }
@container h3studio (max-width:720px) {
  .h3s-prompt-category-bar { gap:4px; padding:4px; }
  .h3s-prompt-category { min-width:48px; padding:5px 8px; font-size:9px; }
}
.h3s-prompt-custom { display:none; gap:6px; align-items:center; }
.h3s-prompt-custom.show { display:flex; }
.h3s-prompt-custom input { flex:1; min-width:150px; border:1px solid #4a6074; border-radius:6px;
  background:#10171e; color:#e5eef8; font-size:11px; padding:5px 7px; }
.h3s-ai-feedback { display:none; padding:5px 8px; border:1px solid #5a4b2f; border-radius:7px;
  background:#211d17; color:#dfc38e; font-size:10px; line-height:1.5; }
.h3s-ai-feedback.error { border-color:#74413e; background:#281a1a; color:#ffb0a8; }
.h3s-ai-feedback summary { cursor:pointer; color:inherit; }
.h3s-ai-feedback pre { margin:6px 0 0; max-height:120px; overflow:auto; white-space:pre-wrap;
  overflow-wrap:anywhere; font:inherit; color:#cbd5e1; }
.h3s-total { font-size:11px; color:#9fd0ff; opacity:0.9; }
.h3s-timeline-panel { flex:none; display:flex; flex-direction:column; gap:5px; min-height:86px;
  padding:7px; border:1px solid #303640; border-radius:9px; background:#181c23; }
.h3s-timeline-head { display:flex; align-items:center; justify-content:space-between; gap:8px;
  color:#dfe8f5; font-size:11px; }
.h3s-timeline-note { color:#778496; font-size:10px; font-weight:400; }
.h3s-tl { display:flex; flex-wrap:wrap; gap:6px; overflow-y:auto; overflow-x:hidden;
  align-content:flex-start; padding:4px; flex:1; min-width:0; position:relative; max-height:150px; }
.h3s-slot { flex:none; width:96px; height:64px; border:2px solid #444; border-radius:8px;
  cursor:pointer; background:#000; position:relative; overflow:hidden; }
.h3s-slot.sel { border-color:#378ADD; }
.h3s-slot.segment-disabled { border-color:#8a6335; }
.h3s-slot.sel.segment-disabled { border-color:#378ADD; outline:1px dashed #d99a43; }
.h3s-slot.second-sample { box-shadow:inset 0 0 0 1px rgba(94,224,198,.7); }
.h3s-slot.boxsel { outline:2px dashed #ffd166; box-shadow:0 0 0 2px rgba(255,209,102,0.22); }
.h3s-slot.sel.boxsel { border-color:#378ADD; outline:2px dashed #ffd166; }
.h3s-marquee { position:absolute; border:1px dashed #ffd166; background:rgba(255,209,102,0.12);
  pointer-events:none; z-index:5; }
.h3s-slot.done { border-color:#0F6E56; }
.h3s-slot.sel.done { border-color:#378ADD; outline:2px solid #0F6E56; }
.h3s-slot img { width:100%; height:100%; object-fit:cover; display:block; }
.h3s-slot .lab { position:absolute; left:4px; top:2px; font-size:11px; color:#fff;
  text-shadow:0 1px 2px #000; pointer-events:none; white-space:nowrap; }
.h3s-slot-name-input { position:absolute; left:4px; top:3px; right:4px; z-index:4; min-width:0;
  box-sizing:border-box; border:1px solid #54b7ff; border-radius:4px; background:#101820; color:#fff;
  font-size:11px; padding:2px 4px; outline:none; }
.h3s-slot .dur { position:absolute; left:4px; bottom:2px; font-size:10px; color:#9fd0ff;
  text-shadow:0 1px 2px #000; pointer-events:none; }
.h3s-slot-enable { position:absolute; right:3px; bottom:2px; z-index:4; display:flex; align-items:center;
  gap:2px; padding:1px 3px; border:1px solid rgba(135,151,169,.7); border-radius:4px;
  background:rgba(13,18,24,.88); color:#b9c8d8; font-size:9px; line-height:1.25; cursor:pointer; }
.h3s-slot-enable input { width:12px; height:12px; margin:0; accent-color:#378ADD; cursor:pointer; }
.h3s-slot.segment-disabled .h3s-slot-enable { border-color:#b57b35; color:#f0ad4e; }
.h3s-slot-tail { position:absolute; left:3px; top:21px; z-index:4; display:flex; align-items:center;
  gap:2px; padding:1px 3px; border:1px solid rgba(92,160,146,.78); border-radius:4px;
  background:rgba(10,31,28,.9); color:#bfe4dc; font-size:8px; line-height:1.2; cursor:pointer; }
.h3s-slot-tail input { width:11px; height:11px; margin:0; accent-color:#39b99c; cursor:pointer; }
.h3s-slot-tail.unavailable { opacity:.45; cursor:not-allowed; }
.h3s-slot .second { position:absolute; right:4px; top:3px; z-index:3; padding:1px 4px;
  border:1px solid #5ee0c6; border-radius:4px; background:rgba(12,72,64,.9); color:#bffcf0;
  font-size:9px; line-height:1.25; font-weight:700; font-family:inherit; text-shadow:0 1px 2px #000;
  pointer-events:auto; cursor:pointer; }
.h3s-slot .second:hover { filter:brightness(1.25); }
.h3s-slot .second.disabled { border-color:#66717c; background:rgba(40,47,55,.92); color:#aab4bf;
  text-shadow:none; }
.h3s-slot-reroll { position:absolute; right:3px; top:22px; z-index:4; display:flex; align-items:center;
  justify-content:center; min-width:0; min-height:0; height:auto; padding:0 2px;
  border:1px solid rgba(84,183,255,.82); border-radius:3px; background:rgba(16,43,66,.92);
  color:#d8efff; font:400 8px/1 inherit; appearance:none; cursor:pointer;
  transform:scale(.72); transform-origin:top right; }
.h3s-slot-reroll:hover { filter:brightness(1.25); }
.h3s-slot-reroll:disabled { opacity:.45; cursor:not-allowed; filter:none; }
.h3s-slot .rz { position:absolute; right:0; top:0; width:8px; height:100%;
  cursor:ew-resize; background:transparent; z-index:2; }
.h3s-slot .rz:hover, .h3s-slot.dragging .rz { background:rgba(55,138,221,0.45); }
.h3s-slot.dragging { border-color:#378ADD; }
.h3s-slot .dur.pickable { pointer-events:auto; cursor:pointer; padding:1px 4px; margin-left:-4px;
  border-radius:4px; }
.h3s-slot .dur.pickable:hover { background:rgba(55,138,221,0.4); color:#fff; }
.h3s-timeline-drop { flex:none; display:flex; align-items:center; justify-content:center; width:8px; height:64px;
  border:0; background:transparent; color:transparent; cursor:copy; position:relative; transition:width .12s; }
.h3s-timeline-drop::before { content:""; width:2px; height:42px; border-radius:2px; background:transparent;
  transition:background .12s,box-shadow .12s; }
.h3s-timeline-drop:hover, .h3s-timeline-drop.drop { width:12px; background:transparent; }
.h3s-timeline-drop:hover::before, .h3s-timeline-drop.drop::before { background:#54b7ff;
  box-shadow:0 0 0 2px rgba(84,183,255,.18); }
.h3s-insert-video { flex:none; width:96px; height:64px; border:2px solid #8d61d1; border-radius:8px;
  background:#09090d; position:relative; overflow:hidden; cursor:grab; }
.h3s-insert-video video { width:100%; height:100%; object-fit:cover; display:block; pointer-events:none; }
.h3s-insert-video .lab { position:absolute; left:4px; top:2px; right:20px; overflow:hidden; text-overflow:ellipsis;
  color:#fff; font-size:10px; white-space:nowrap; text-shadow:0 1px 2px #000; pointer-events:none; }
.h3s-insert-video .dur { position:absolute; left:4px; bottom:2px; color:#d8bdff; font-size:10px;
  text-shadow:0 1px 2px #000; pointer-events:none; }
.h3s-insert-video .delete { position:absolute; right:2px; top:2px; z-index:2; width:17px; height:17px;
  padding:0; border:1px solid #7c4343; border-radius:4px; background:#301818; color:#ffb0a8; cursor:pointer; }
.h3s-insert-video.dragging { opacity:.55; border-style:dashed; }
.h3s-slot.timeline-video-drop, .h3s-insert-video.timeline-video-drop { border-color:#54b7ff;
  box-shadow:0 0 0 2px rgba(84,183,255,0.28); }
.h3s-durpick { position:fixed; z-index:9999; background:#1b1f24; border:1px solid #3a3f46;
  border-radius:7px; padding:5px; display:grid; grid-template-columns:repeat(5,auto); gap:3px;
  box-shadow:0 4px 16px rgba(0,0,0,0.55); }
.h3s-durpick button { font-size:11px; padding:2px 6px; background:#23282f; color:#cde;
  border:1px solid #3a3f46; border-radius:4px; cursor:pointer; }
.h3s-durpick button:hover { background:#378ADD; color:#fff; }
.h3s-durpick button.cur { background:#0F6E56; color:#fff; border-color:#0F6E56; }
.h3s-durspec { flex:1; min-width:220px; border-radius:7px; border:1px solid #555;
  background:#101014; color:#ddd; font-size:12px; padding:5px 8px; }
.h3s-editor { display:flex; flex-direction:column; gap:6px; flex:1; min-height:120px;
  overflow:auto; resize:none; padding-bottom:2px; }
.h3s-editor.h3s-editor-create { display:grid; grid-template-columns:minmax(0,1.62fr) minmax(285px,0.88fr);
  gap:8px; overflow:hidden; min-height:0; }
.h3s-create-col { display:flex; flex-direction:column; gap:8px; min-width:0; min-height:0;
  overflow:auto; padding:1px 3px 8px 1px; scrollbar-gutter:stable; }
.h3s-create-side { padding-left:5px; border-left:1px solid #2b313b; }
.h3s-card { display:flex; flex-direction:column; gap:6px; flex:none; min-width:0; padding:9px;
  border:1px solid #303744; border-radius:9px; background:#1b2028; box-shadow:0 1px 0 rgba(255,255,255,0.02) inset; }
.h3s-card-title { display:flex; align-items:center; gap:7px; min-height:20px; color:#edf4ff;
  font-size:12px; font-weight:650; }
.h3s-card-title::before { content:""; width:3px; height:14px; flex:none; border-radius:3px; background:#378ADD; }
.h3s-card-global .h3s-card-title::before { background:#f0a33a; }
.h3s-card-segment .h3s-card-title::before { background:#8b5cf6; }
.h3s-card-refs .h3s-card-title::before { background:#33b5cc; }
.h3s-card-voice .h3s-card-title::before, .h3s-card-audio .h3s-card-title::before { background:#38b77a; }
.h3s-card-preview { flex:none; min-height:300px; overflow:auto; }
.h3s-card-preview .h3s-pv { min-height:250px !important; }
.h3s-card .h3s-ta { border-color:#3a4350; background:#11151b; }
.h3s-card .h3s-row { min-width:0; }
.h3s-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.h3s-ta { width:100%; flex:none; height:110px; min-height:60px; resize:both;
  border-radius:7px; border:1px solid #555; white-space:pre-wrap; overflow-wrap:break-word;
  background:#101014; color:#ddd; font-size:12px; padding:6px; }
.h3s-seed { width:130px; border-radius:7px; border:1px solid #555; background:#101014; color:#ddd;
  font-size:12px; padding:3px 6px; }
.h3s-segment-name { width:180px; max-width:100%; border-radius:7px; border:1px solid #555;
  background:#101014; color:#ddd; font-size:12px; padding:3px 6px; }
.h3s-seedmode { width:82px; border-radius:7px; border:1px solid #555; background:#101014; color:#ddd;
  font-size:11px; padding:3px 4px; }
.h3s-durinput { width:70px; border-radius:7px; border:1px solid #555; background:#101014; color:#ddd;
  font-size:12px; padding:3px 6px; }
.h3s-refs { display:flex; gap:4px; flex-wrap:wrap; align-items:center;
  resize:none; overflow:hidden; height:64px; min-height:48px; max-width:100%;
  border:1px solid #333; border-radius:6px; padding:4px; }
.h3s-ref { position:relative; width:48px; height:48px; border-radius:6px; overflow:hidden; border:1px solid #666; }
.h3s-ref img { width:100%; height:100%; object-fit:cover; }
.h3s-ref .x { position:absolute; top:0; right:0; background:rgba(0,0,0,0.7); color:#fff; border:none;
  cursor:pointer; font-size:10px; padding:1px 4px; }
/* 参考图缩略图随 refs 容器高度等比放大——拉高框=看清细节 */
.h3s-pic { position:relative; height:100%; width:auto; aspect-ratio:1/1; border-radius:6px; overflow:hidden;
  border:1px solid #666; cursor:pointer; flex:none; }
.h3s-pic:hover { border-color:#378ADD; }
.h3s-pic img { width:100%; height:100%; object-fit:cover; }
.h3s-pic .num { position:absolute; left:0; top:0; background:rgba(24,95,165,0.9); color:#fff;
  font-size:10px; padding:1px 5px; border-bottom-right-radius:6px; }
.h3s-pic .tag { position:absolute; left:0; bottom:0; right:0; background:rgba(0,0,0,0.55); color:#eee;
  font-size:9px; text-align:center; }
.h3s-pic .x { position:absolute; top:0; right:0; background:rgba(0,0,0,0.7); color:#fff; border:none;
  cursor:pointer; font-size:10px; padding:1px 4px; z-index:2; }
.h3s-role-card { display:flex; flex-direction:column; gap:3px; align-items:stretch; flex:none; height:100%; }
.h3s-role-card .h3s-pic { height:auto; flex:1; min-height:40px; }
.h3s-asset-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
.h3s-asset-group { min-width:0; border:1px solid #344351; border-radius:7px; background:#151b22; padding:5px; }
.h3s-asset-group.asset-drop { border-color:#35d07f; background:#14261c; box-shadow:0 0 0 1px rgba(53,208,127,.25) inset; }
.h3s-asset-group.tail { grid-column:1 / -1; }
.h3s-asset-group-head { display:flex; align-items:center; gap:6px; margin-bottom:5px; color:#bcd2e6; font-size:10px; }
.h3s-asset-group-head .count { opacity:.65; }
.h3s-segment-asset-map { display:flex; align-items:center; gap:5px; flex-wrap:wrap; margin-top:5px; padding:6px;
  border:1px solid #2f4658; border-radius:7px; background:#101820; color:#b9cadd; font-size:10px; }
.h3s-segment-asset-map-label { color:#8fb7d9; font-weight:600; }
.h3s-keyframes { display:flex; flex-wrap:wrap; gap:7px; width:100%; min-width:0; margin-top:2px; }
.h3s-keyframe-slot { display:flex; align-items:center; gap:6px; flex:1 1 260px; min-width:0;
  padding:6px; border:1px solid #344351; border-radius:7px; background:#151b22; }
.h3s-keyframe-slot > select { min-width:0; max-width:150px; }
.h3s-keyframe-preview { width:58px; height:40px; flex:none; object-fit:contain; cursor:zoom-in;
  border:1px solid #465463; border-radius:5px; background:#090b0e; }
.h3s-keyframe-empty { display:flex; align-items:center; justify-content:center; width:58px; height:40px;
  flex:none; border:1px dashed #465463; border-radius:5px; color:#788594; font-size:9px; }
.h3s-segment-asset-map-item { display:inline-flex; align-items:center; gap:4px; min-width:0; padding:2px 5px;
  border:1px solid #344b5e; border-radius:999px; background:#17232d; }
.h3s-segment-asset-map-item.tail { color:#d8bdff; border-color:#654a88; background:#211a2b; }
.h3s-segment-asset-map-target { color:#dbe8f5; font-family:Consolas,monospace; white-space:nowrap; }
.h3s-asset-add-menu { position:relative; z-index:5; }
.h3s-asset-add-menu summary, .h3s-asset-add-button { display:flex; align-items:center; justify-content:center; width:20px; height:20px;
  box-sizing:border-box; border:1px solid #4a5662; border-radius:5px; background:#202731; color:#dbe8f5;
  cursor:pointer; font-size:16px; line-height:1; list-style:none; user-select:none; }
.h3s-asset-add-menu summary:hover, .h3s-asset-add-button:hover { border-color:#378ADD; background:#263444; }
.h3s-asset-add-menu summary::-webkit-details-marker { display:none; }
.h3s-asset-add-menu-panel { position:absolute; left:0; top:24px; display:flex; flex-direction:column; gap:4px;
  min-width:92px; padding:5px; border:1px solid #4a5662; border-radius:6px; background:#111820;
  box-shadow:0 6px 18px rgba(0,0,0,.45); z-index:20; }
.h3s-asset-add-menu-panel .h3s-btn { width:100%; min-width:82px; white-space:nowrap; }
.h3s-asset-items { display:flex; align-items:stretch; gap:5px; min-height:132px; overflow-x:auto; overflow-y:hidden; padding:3px; }
.h3s-asset-items .h3s-role-card { width:92px; height:126px; }
.h3s-asset-items .h3s-btn { min-width:78px; align-self:center; }
.h3s-card-global-assets .h3s-pic[draggable="true"] { cursor:grab; }
.h3s-card-global-assets .h3s-role-card.dragging { opacity:.45; }
.h3s-card-global-assets .h3s-asset-items { min-height:158px; }
.h3s-card-global-assets .h3s-asset-items .h3s-role-card { min-height:152px; height:auto; }
.h3s-global-ref-toggle { display:flex; align-items:center; justify-content:center; min-height:18px;
  color:#b9d7c5; font-size:10px; white-space:nowrap; cursor:pointer; }
.h3s-role-name { flex:none; height:22px; min-width:64px; border:1px solid #4a5662; border-radius:5px;
  background:#10151b; color:#cfe8ff; font-size:10px; padding:2px 5px; text-align:center; }
.h3s-role-name:focus { border-color:#378ADD; outline:none; }
.h3s-asset-type { flex:none; height:22px; min-width:64px; border:1px solid #4a5662; border-radius:5px;
  background:#10151b; color:#c6d8ed; font-size:10px; padding:1px 3px; }
.h3s-check-report { white-space:pre-wrap; max-height:180px; overflow:auto; padding:7px 9px;
  border:1px solid #3b4655; border-radius:7px; background:#11151b; color:#cbd5e1; font-size:10px; line-height:1.55; }
.h3s-role-static { flex:none; height:22px; color:#9aa6b2; font-size:9px; line-height:22px;
  text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.h3s-track { display:flex; gap:6px; align-items:flex-start; flex:none; }
.h3s-timeline-actions { flex:none; width:44px; min-height:72px; display:flex; flex-direction:column;
  justify-content:center; align-items:stretch; gap:5px; }
.h3s-timeline-actions.create { width:74px; }
.h3s-track .atag { flex:none; width:auto; text-align:center; font-size:10px; color:#9fd8c3; opacity:0.75; }
.h3s-reroll-all { padding:4px 3px; font-size:9px; line-height:1.25; white-space:normal; }
/* 视频界面加载对话框（v2.4）：虚线拖放区 */
.h3s-vdz { flex:1; min-height:240px; border:2px dashed #3a5a7a; border-radius:10px;
  display:flex; align-items:center; justify-content:center; text-align:center;
  color:#9fd0ff; font-size:13px; line-height:2; cursor:pointer; background:#14181e; padding:20px; }
.h3s-vdz:hover { border-color:#4a9eff; background:#16202a; }
.h3s-vdz.drop { border-color:#35d07f; background:#14261c; }
.h3s-slrow { display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:3px 6px;
  border:1px dashed #2f567a; border-radius:6px; background:#16222e; }
.h3s-audio-warn { color:#ffd166; font-size:11px; }
.h3s-trim { display:flex; flex-direction:column; gap:3px; }
.h3s-wave { width:100%; max-width:520px; height:46px; background:#0d1411; border:1px solid #2a4a3e;
  border-radius:6px; cursor:ew-resize; touch-action:none; display:block; }
.h3s-pvbox { resize: none; overflow: hidden; width: 100%; height: 270px;
  min-width: 240px; min-height: 135px; max-width: 100%;
  border: 1px solid #333; border-radius: 6px; background: #000; }
.h3s-pvbox video { width: 100%; height: 100%; display: block; object-fit: contain; }
.h3s-pv-toolbar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.h3s-pv-grid { display:flex; flex-direction:column; gap:8px; overflow-x:hidden; overflow-y:visible;
  padding:2px 1px 5px; min-height:210px; }
.h3s-pv-slot { width:100%; min-width:0; display:flex; flex-direction:column; gap:4px; border:1px solid #344351;
  border-radius:7px; padding:5px; background:#11161d; }
.h3s-pv-slot-head { display:flex; align-items:center; justify-content:space-between; gap:6px; min-height:24px; }
.h3s-video-name { flex:1 1 260px; min-width:160px; height:27px; border:1px solid #46596b;
  border-radius:6px; background:#0d141b; color:#e2edf7; padding:3px 7px; font-size:11px; }
.h3s-video-name:focus { outline:1px solid #378ADD; border-color:#378ADD; }
.h3s-pv-slot .h3s-pvbox { height:230px; min-width:0; min-height:160px; }
.h3s-pv-empty { min-height:210px; display:flex; align-items:center; justify-content:center; text-align:center;
  border:1px dashed #3d4d5d; border-radius:6px; color:#9dafc0; font-size:10px; padding:12px; }
.h3s-upscale { display:grid; grid-template-columns:minmax(280px,.9fr) minmax(320px,1.1fr); gap:10px;
  min-height:0; height:100%; overflow:auto; padding:2px; }
.h3s-upscale-col { display:flex; flex-direction:column; gap:8px; min-width:0; }
.h3s-upscale-card { display:flex; flex-direction:column; gap:8px; min-width:0; padding:9px;
  border:1px solid #34485d; border-radius:9px; background:#121922; }
.h3s-upscale-card-title { display:flex; align-items:center; justify-content:space-between; gap:8px;
  color:#dcecff; font-weight:650; }
.h3s-upscale-drop { min-height:190px; display:flex; align-items:center; justify-content:center;
  text-align:center; border:2px dashed #426486; border-radius:9px; background:#0d141b;
  color:#a8d7ff; line-height:1.8; cursor:pointer; padding:16px; }
.h3s-upscale-drop.drop { border-color:#35d07f; background:#10241a; color:#b8f6d1; }
.h3s-upscale-video { width:100%; min-height:220px; max-height:520px; background:#000; border-radius:7px; }
.h3s-upscale-settings { display:grid; grid-template-columns:110px minmax(0,1fr); gap:7px 8px; align-items:center; }
.h3s-upscale-settings label { color:#a9bbcd; }
.h3s-upscale-settings input, .h3s-upscale-settings select { width:100%; min-width:0; min-height:28px;
  border:1px solid #46596b; border-radius:6px; background:#0d141b; color:#e2edf7; padding:3px 7px; }
.h3s-upscale-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
.h3s-upscale-state { color:#a9c5dc; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
.h3s-upscale-state.error { color:#ff9a92; font-weight:600; }
.h3s-upscale-install { display:grid; grid-template-columns:minmax(180px,1fr) auto auto auto auto; gap:6px; align-items:center;
  padding-top:7px; border-top:1px solid #2d3d4d; }
.h3s-upscale-install select { min-width:0; min-height:28px; border:1px solid #46596b; border-radius:6px;
  background:#0d141b; color:#e2edf7; padding:3px 7px; }
.h3s-upscale-install .danger { border-color:#7b4650; color:#ffc0c8; }
.h3s-upscale-progress { display:flex; flex-direction:column; gap:4px; flex:1 1 260px; min-width:220px; }
.h3s-upscale-progress-head { display:flex; justify-content:space-between; gap:8px; color:#a9c5dc; }
.h3s-upscale-progress-track { height:9px; overflow:hidden; border:1px solid #36516d; border-radius:999px; background:#0a1118; }
.h3s-upscale-progress-fill { width:0; height:100%; background:linear-gradient(90deg,#287ed0,#53c2ff);
  transition:width .15s linear; }
.h3s-upscale-model-status { min-height:28px; display:flex; align-items:center; gap:8px; padding:6px 8px;
  border:1px solid #34485d; border-radius:6px; color:#b8d8f4; background:#0d141b; overflow-wrap:anywhere; }
.h3s-upscale-model-status.busy::before { content:""; width:14px; height:14px; flex:none; border:2px solid #355b7d;
  border-top-color:#75c7ff; border-radius:50%; animation:h3s-upscale-spin .8s linear infinite; }
@keyframes h3s-upscale-spin { to { transform:rotate(360deg); } }
.h3s-upscale-compare { display:flex; flex-direction:column; gap:8px; min-width:0; }
.h3s-upscale-compare-stage { position:relative; width:100%; max-height:72vh; overflow:hidden;
  border:1px solid #52687d; border-radius:8px; background:#000; touch-action:none; cursor:ew-resize; }
.h3s-upscale-compare-stage::before { content:""; display:block; padding-top:var(--h3-upscale-ratio, 56.25%); }
.h3s-upscale-compare-video, .h3s-upscale-compare-after { position:absolute; inset:0; width:100%; height:100%; }
.h3s-upscale-compare-video { display:block; object-fit:contain; background:#000; }
.h3s-upscale-compare-after { overflow:hidden; pointer-events:none; }
.h3s-upscale-compare-divider { position:absolute; top:0; bottom:0; width:2px; transform:translateX(-1px);
  background:#f4f8ff; box-shadow:0 0 0 1px rgba(0,0,0,.55), 0 0 14px rgba(83,194,255,.85); pointer-events:none; }
.h3s-upscale-compare-handle { position:absolute; top:50%; left:50%; width:34px; height:34px;
  transform:translate(-50%,-50%); display:flex; align-items:center; justify-content:center; border:2px solid #fff;
  border-radius:50%; color:#fff; background:rgba(18,30,42,.8); font-size:16px; }
.h3s-upscale-compare-label { position:absolute; top:10px; z-index:3; padding:4px 8px; border-radius:5px;
  color:#fff; background:rgba(7,12,18,.72); pointer-events:none; }
.h3s-upscale-compare-label.before { left:10px; }
.h3s-upscale-compare-label.after { right:10px; }
.h3s-upscale-compare-controls { display:grid; grid-template-columns:auto minmax(180px,1fr) auto; gap:8px; align-items:center; }
.h3s-upscale-compare-controls input[type="range"] { width:100%; }
.h3s-upscale-compare-media { grid-column:1 / -1; }
.h3s-asset-mention { position:fixed; z-index:100000; width:min(360px, calc(100vw - 24px)); max-height:300px;
  overflow:auto; border:1px solid #4d6680; border-radius:8px; background:#111820; box-shadow:0 12px 32px rgba(0,0,0,.45); padding:5px; }
.h3s-asset-mention-item { width:100%; display:grid; grid-template-columns:42px 52px minmax(0,1fr) auto;
  align-items:center; gap:7px; border:0; border-radius:6px; padding:5px; color:#d9e8f5; background:transparent; text-align:left; cursor:pointer; }
.h3s-asset-mention-item.active, .h3s-asset-mention-item:hover { background:#20344a; }
.h3s-asset-mention-item img { width:42px; height:42px; object-fit:cover; border-radius:5px; background:#080b0f; }
.h3s-asset-mention-id { color:#75bfff; font-weight:700; border-radius:4px; padding:2px 4px; }
.h3s-asset-mention-type { color:#9bb0c4; font-size:10px; }
.h3s-asset-mention-audio { width:42px; height:42px; display:flex; align-items:center; justify-content:center;
  border-radius:5px; background:#16241f; color:#72e6a6; font-size:22px; }
.h3s-asset-viewer { position:fixed; inset:0; z-index:100001; display:flex; align-items:center; justify-content:center;
  padding:24px; background:rgba(3,6,10,.86); }
.h3s-asset-viewer-panel { max-width:94vw; max-height:94vh; display:flex; flex-direction:column; gap:7px;
  border:1px solid #52687d; border-radius:10px; padding:8px; background:#0d1218; box-shadow:0 18px 56px rgba(0,0,0,.65); }
.h3s-asset-viewer-head { display:flex; align-items:center; justify-content:space-between; gap:12px; color:#dbeaff; font-size:12px; }
.h3s-asset-viewer img { display:block; max-width:90vw; max-height:84vh; object-fit:contain; background:#05070a; }
.h3s-merged-viewer-panel { width:min(94vw, 1280px); }
.h3s-merged-viewer video { display:block; width:100%; max-height:82vh; background:#000; border-radius:6px; }
.h3s-audio-assets { grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:stretch; gap:7px; }
.h3s-audio-asset-card { min-width:220px; display:grid; grid-template-columns:auto minmax(90px,1fr) auto auto auto;
  align-items:center; gap:6px; border:1px solid #3b5368; border-radius:7px; padding:6px; background:#111820; }
.h3s-audio-asset-card .h3s-role-name { width:100%; min-width:90px; }
.h3s-audio-asset-card .h3s-asset-type { min-width:88px; }
.h3s-mention-editor { position:relative; width:100%; height:110px; min-width:240px; min-height:60px;
  flex:none; overflow:hidden; border-radius:7px; background:#101014; }
.h3s-mention-layer { position:absolute; inset:0; z-index:1; overflow:hidden; pointer-events:none;
  white-space:pre-wrap; overflow-wrap:break-word; word-break:break-word; padding:6px;
  border:1px solid transparent; color:#ddd; background:#101014; font-family:inherit;
  font-size:12px; line-height:normal; }
.h3s-mention-input { position:absolute; inset:0; z-index:2; width:100% !important; height:100% !important;
  margin:0; resize:none !important; overflow:auto; background:transparent !important; color:transparent !important;
  -webkit-text-fill-color:transparent; caret-color:#f4f7fb; font-family:inherit; line-height:normal; }
.h3s-mention-token { color:var(--h3-mention-color,#65c7ff); background:var(--h3-mention-bg,rgba(41,130,190,.18)); border-radius:3px; }
.h3s-script-slots { display:flex; flex-direction:column; gap:5px; margin:5px 0 8px; padding:6px;
  border:1px solid #3b4d5f; border-radius:7px; background:#121922; }
.h3s-script-slot { display:grid; grid-template-columns:58px minmax(100px,1fr) auto auto; gap:7px; align-items:center;
  border-bottom:1px solid rgba(92,116,139,.25); padding:4px 2px; }
.h3s-script-slot:last-child { border-bottom:0; }
.h3s-prog { height:5px; border-radius:3px; background:#333; overflow:hidden; }
.h3s-prog > div { height:100%; width:0%; background:#378ADD; transition:width 0.3s; }
.h3s-hint { font-size:10px; opacity:0.6; }
.h3s-pichint { font-size:10px; color:#8fd0a0; opacity:0.9; }
@container h3studio (max-width:860px) {
  .h3s-editor.h3s-editor-create { display:flex; flex-direction:column; overflow:auto; }
  .h3s-create-col { flex:none; overflow:visible; padding:0 2px 4px 0; }
  .h3s-create-side { padding-left:0; border-left:none; }
  .h3s-card-preview { min-height:280px; }
  .h3s-toolbar-info { width:100%; margin-left:0; justify-content:flex-start; }
  .h3s-toolbar-group + .h3s-toolbar-group { padding-left:0; border-left:none; }
  .h3s-asset-groups { grid-template-columns:1fr; }
  .h3s-asset-group.tail { grid-column:auto; }
  .h3s-api-body > input, .h3s-api-body > select { flex:1 1 220px; }
  .h3s-second-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .h3s-second-field, .h3s-second-field.wide, .h3s-second-resolution { grid-column:1 / -1; }
  .h3s-second-setup-grid { grid-template-columns:100px minmax(0,1fr); }
  .h3s-second-setup-stage { grid-column:2; }
  .h3s-second-row { grid-template-columns:80px minmax(120px,1fr); }
  .h3s-second-size { grid-template-columns:repeat(2,minmax(0,1fr)); min-width:0; }
  .h3s-second-size select, .h3s-second-size .h3s-second-mp { grid-column:1 / -1; }
  .h3s-upscale { grid-template-columns:1fr; }
  .h3s-upscale-install { grid-template-columns:1fr 1fr; }
  .h3s-upscale-install select { grid-column:1 / -1; }
  .h3s-upscale-compare-controls { grid-template-columns:auto minmax(120px,1fr); }
  .h3s-upscale-compare-time { grid-column:1 / -1; }
}
`;

/* v2.13.15：段卡片统一小方块（换行网格排列 + 鼠标框选删除），不再按时长拉伸宽度；
   SLOT_W/H 为固定卡片尺寸，DRAG_PX_PER_SEC 为右缘拖拽调时长的灵敏度 */
const SLOT_W = 96;
const SLOT_H = 64;
const DRAG_PX_PER_SEC = 12;

const DEFAULT_PROMPT_FIRST =
  "A 10-second opening clip of a comic-drama episode. <Picture 1>, <Picture 2> and <Picture 3> define the characters' appearance, outfits and the scene - keep them perfectly consistent.\n\nEvery shot is framed in MEDIUM SHOT or MEDIUM CLOSE-UP (waist-up). The camera NEVER pulls back to a wide or long shot.\n\n[0s-3s] ...\n[3s-7s] ...\n[7s-10s] ...\n\nAudio: ambient sound + character voices + soft BGM. No subtitles on screen.\nConstraints: keep the exact appearance from the reference images. Medium-shot framing only, no new characters, no scene changes, no text overlays.";
const DEFAULT_PROMPT_NEXT =
  "A 10-second continuation clip. <Picture 1>, <Picture 2> and <Picture 3> define the characters and scene. <Picture 4> is the FINAL FRAME of the previous clip: continue seamlessly from that exact moment - same characters, same positions, same lighting, matching motion, no jump-cut feeling.\n\nEvery shot is framed in MEDIUM SHOT or MEDIUM CLOSE-UP (waist-up). The camera NEVER pulls back to a wide or long shot.\n\n[0s-3s] ...\n[3s-7s] ...\n[7s-10s] ...\n\nAudio: ambient sound + character voices + soft BGM. No subtitles on screen.\nConstraints: keep the exact appearance from the reference images. Medium-shot framing only, no new characters, no scene changes, no text overlays.";

function defaultSegs() {
  return [{
    prompt: "",
    seed: Math.floor(Math.random() * 1e15),
    refs: [],
    video_refs: [],
    video_ref_modes: {},
    video_audio_reference: false,
    duration: 10,
    inherit_shared: true,
    use_tail: false,
    first_frame_mode: "none",
    first_frame: "",
    last_frame: "",
    enabled: true,
    force: false,
  }];
}

/* 文本界面默认段（v2.11）：纯提示词生成，无参考图/视频/音频 */
function defaultTextSegs() {
  return [{
    prompt: "",
    seed: Math.floor(Math.random() * 1e15),
    refs: [],
    duration: 10,
    inherit_shared: true,
    use_tail: true,
    first_frame_mode: "previous_tail",
    first_frame: "",
    last_frame: "",
    enabled: true,
    force: false,
  }];
}

function normalizeCreateTimelineVideos(value, segmentCount) {
  const maxGap = Math.max(0, Number(segmentCount) || 0);
  const seen = new Set();
  const clips = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const name = String(raw && raw.name || "").trim();
    if (!/^_h3_timeline_[0-9A-Za-z_.-]+\.(?:mp4|webm|mov|mkv|avi)$/i.test(name) || seen.has(name)) continue;
    seen.add(name);
    clips.push({
      name,
      label: String(raw && raw.label || name).trim() || name,
      duration: Math.max(0.001, Number(raw && raw.duration) || 0.001),
      gap: Math.max(0, Math.min(maxGap, Math.round(Number(raw && raw.gap) || 0))),
    });
  }
  return clips;
}

function normalizeCreateSegmentName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 40);
}

function createSegmentLabel(segment, index) {
  const name = normalizeCreateSegmentName(segment && segment.display_name);
  return name ? `段${index + 1} · ${name}` : `段${index + 1}`;
}

function buildCreateTimelineMergeSequence(segments, videos, segmentIndexes = null) {
  const items = Array.isArray(segments) ? segments : [];
  const clips = normalizeCreateTimelineVideos(videos, items.length);
  const selected = Array.isArray(segmentIndexes) ? new Set(segmentIndexes.map(Number)) : null;
  const sequence = [];
  for (let gap = 0; gap <= items.length; gap++) {
    for (const clip of clips.filter((item) => item.gap === gap)) {
      sequence.push({ kind: "timeline_video", name: clip.name });
    }
    if (gap < items.length && (selected ? selected.has(gap + 1) : items[gap].enabled !== false)) {
      sequence.push({ kind: "segment", segment: gap + 1 });
    }
  }
  return sequence;
}

function filterAvailableMergeSegmentIndexes(segmentIndexes, projectStatus) {
  const candidates = [...new Set((Array.isArray(segmentIndexes) ? segmentIndexes : [])
    .map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 999))]
    .sort((a, b) => a - b);
  const statuses = projectStatus && projectStatus.segments;
  if (!statuses || typeof statuses !== "object") return candidates;
  return candidates.filter((index) => !!(statuses[String(index)] && statuses[String(index)].video));
}

function shiftCreateTimelineVideosAfterSegmentRemoval(videos, removedSegment, segmentCount) {
  const removed = Math.max(1, Number(removedSegment) || 1);
  return normalizeCreateTimelineVideos(videos, segmentCount + 1).map((clip) => ({
    ...clip,
    gap: clip.gap >= removed ? Math.max(0, clip.gap - 1) : clip.gap,
  })).map((clip) => ({ ...clip, gap: Math.min(Math.max(0, segmentCount), clip.gap) }));
}

function moveCreateTimelineVideo(videos, clipName, gap, segmentCount, beforeName = "") {
  const clips = normalizeCreateTimelineVideos(videos, segmentCount);
  if (clipName === beforeName) return clips;
  const sourceIndex = clips.findIndex((clip) => clip.name === clipName);
  if (sourceIndex < 0) return clips;
  const [clip] = clips.splice(sourceIndex, 1);
  clip.gap = Math.max(0, Math.min(Math.max(0, Number(segmentCount) || 0), Math.round(Number(gap) || 0)));

  let targetIndex = beforeName
    ? clips.findIndex((item) => item.name === beforeName && item.gap === clip.gap)
    : -1;
  if (targetIndex < 0) {
    targetIndex = clips.length;
    for (let index = clips.length - 1; index >= 0; index--) {
      if (clips[index].gap !== clip.gap) continue;
      targetIndex = index + 1;
      break;
    }
  }
  clips.splice(targetIndex, 0, clip);
  return clips;
}

function moveCreateTimelineSegment(segments, videos, sourceSegment, beforeItem = { kind: "end" }) {
  const items = Array.isArray(segments) ? segments : [];
  const clips = normalizeCreateTimelineVideos(videos, items.length);
  const source = Math.round(Number(sourceSegment) || 0);
  const original = {
    segments: items.slice(),
    videos: clips,
    order: items.map((_segment, index) => index + 1),
  };
  if (source < 1 || source > items.length) return original;
  if (beforeItem && beforeItem.kind === "segment"
      && Math.round(Number(beforeItem.segment) || 0) === source) return original;

  const timeline = [];
  for (let gap = 0; gap <= items.length; gap++) {
    for (const clip of clips.filter((item) => item.gap === gap)) {
      timeline.push({ kind: "timeline_video", name: clip.name, clip });
    }
    if (gap < items.length) {
      timeline.push({ kind: "segment", oldSegment: gap + 1, segment: items[gap] });
    }
  }
  const sourceIndex = timeline.findIndex(
    (item) => item.kind === "segment" && item.oldSegment === source);
  if (sourceIndex < 0) return original;
  const [moved] = timeline.splice(sourceIndex, 1);

  let targetIndex = timeline.length;
  if (beforeItem && beforeItem.kind === "segment") {
    const targetSegment = Math.round(Number(beforeItem.segment) || 0);
    targetIndex = timeline.findIndex(
      (item) => item.kind === "segment" && item.oldSegment === targetSegment);
  } else if (beforeItem && beforeItem.kind === "timeline_video") {
    const targetName = String(beforeItem.name || "");
    targetIndex = timeline.findIndex(
      (item) => item.kind === "timeline_video" && item.name === targetName);
  }
  if (targetIndex < 0) return original;
  timeline.splice(targetIndex, 0, moved);

  const reorderedSegments = [];
  const reorderedVideos = [];
  const order = [];
  let gap = 0;
  for (const item of timeline) {
    if (item.kind === "segment") {
      reorderedSegments.push(item.segment);
      order.push(item.oldSegment);
      gap += 1;
    } else {
      reorderedVideos.push({ ...item.clip, gap });
    }
  }
  return { segments: reorderedSegments, videos: reorderedVideos, order };
}

/* v2.16：角色参考图只需命名一次。角色名按文件名自动生成，并以文件路径为键保存到工作流属性；
   同一张图被复制到多个段时会共用一个角色名，修改一次即可全局生效。 */
function roleNameFromFilename(value) {
  let name = String(value || "").replace(/\\/g, "/").split("/").pop() || "角色";
  try { name = decodeURIComponent(name); } catch (e) { /* 非 URI 文件名 */ }
  name = name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  name = name.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return name || "角色";
}

const H3_MENTION_COLORS = Object.freeze([
  "#65C7FF", "#C9A0FF", "#72E6A6", "#FFB86B",
  "#FF8FCB", "#66E0E5", "#E8D66D", "#FF938A",
]);

function h3MentionColor(assetId) {
  const value = String(assetId || "").trim().toUpperCase();
  const match = value.match(/^([CPSGA])(\d+)$/);
  if (!match) return H3_MENTION_COLORS[0];
  const offsets = { C: 198, A: 276, S: 142, G: 48, P: 24 };
  const number = Math.max(1, Number(match[2]) || 1);
  const hue = (offsets[match[1]] + (number - 1) * 137.508) % 360;
  const lightness = 69 + (number % 3) * 3;
  return `hsl(${hue.toFixed(1)} 78% ${lightness}%)`;
}

function h3MentionBackground(assetId) {
  const color = h3MentionColor(assetId);
  return color.startsWith("hsl(") ? color.replace(/\)$/, " / 0.18)") : color + "26";
}

function applyH3MentionColor(element, assetId, background = true) {
  const color = h3MentionColor(assetId);
  element.style.color = color;
  if (background) element.style.backgroundColor = h3MentionBackground(assetId);
  return element;
}

function ensureCreateAudioAssets(node, segments = []) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  const hasAudioLibrary = Array.isArray(node.properties.h3_create_audio_assets);
  const rawAssets = hasAudioLibrary ? node.properties.h3_create_audio_assets.slice() : [];
  if (!hasAudioLibrary) {
    const migrated = new Set();
    for (const segment of segments || []) {
      if (segment && segment.audio_src === "ref" && segment.audio && !migrated.has(segment.audio)) {
        migrated.add(segment.audio);
        rawAssets.push({ file: segment.audio, label: segment.audio_label || segment.audio,
          name: roleNameFromFilename(segment.audio_label || segment.audio), usage: "copy" });
      }
      for (const file of (Array.isArray(segment && segment.voice_refs) ? segment.voice_refs : [])) {
        if (!file || migrated.has(file)) continue;
        migrated.add(file);
        const label = segment.voice_labels && segment.voice_labels[file] || file;
        rawAssets.push({ file, label, name: roleNameFromFilename(label), usage: "timbre" });
      }
    }
  }
  let maxId = 0;
  for (const raw of rawAssets) {
    const match = String(raw && raw.asset_id || "").trim().match(/^A(\d+)$/i);
    if (match) maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  const usedIds = new Set();
  const usedFiles = new Set();
  const normalized = [];
  for (const raw of rawAssets) {
    const file = String(raw && raw.file || "").trim();
    if (!file || usedFiles.has(file)) continue;
    let assetId = String(raw && raw.asset_id || "").trim().toUpperCase();
    if (!/^A\d+$/.test(assetId) || usedIds.has(assetId)) {
      do { maxId += 1; assetId = "A" + maxId; } while (usedIds.has(assetId));
    }
    usedIds.add(assetId);
    usedFiles.add(file);
    const label = String(raw && raw.label || raw && raw.name || file).trim() || file;
    normalized.push({
      asset_id: assetId,
      name: String(raw && raw.name || roleNameFromFilename(label)).trim() || roleNameFromFilename(label),
      file,
      label,
      usage: raw && raw.usage === "copy" ? "copy" : "timbre",
    });
  }
  node.properties.h3_create_audio_assets = normalized;
  return normalized;
}

function nextCreateAudioAssetId(assets) {
  let maxId = 0;
  for (const asset of assets || []) {
    const match = String(asset && asset.asset_id || "").match(/^A(\d+)$/i);
    if (match) maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  return "A" + (maxId + 1);
}

function collectCreateAudioAssetLibrary(node, segments = []) {
  return ensureCreateAudioAssets(node, segments).map((asset) => ({
    ...asset,
    kind: "audio",
    type: "audio",
    aliases: [],
  }));
}

function createAudioAssetBindingNumber(segment, asset) {
  if (!segment || !asset) return 0;
  if (asset.usage === "copy") {
    return segment.audio_src === "ref" && segment.audio === asset.file ? 1 : 0;
  }
  const voices = Array.isArray(segment.voice_refs) ? segment.voice_refs : [];
  const index = voices.indexOf(asset.file);
  if (index < 0) return 0;
  return (segment.audio_src === "ref" && segment.audio ? 1 : 0) + index + 1;
}

function bindCreateAudioAssetToSegment(segment, asset, replaceExisting = false) {
  if (!segment || !asset || !asset.file) return 0;
  const usage = asset.usage === "copy" ? "copy" : "timbre";
  let voices = Array.isArray(segment.voice_refs) ? segment.voice_refs.filter(Boolean) : [];
  if (!segment.voice_labels || typeof segment.voice_labels !== "object") segment.voice_labels = {};
  if (usage === "copy") {
    voices = voices.filter((file) => file !== asset.file);
    if (voices.length > 2) {
      if (!replaceExisting) return 0;
      voices = voices.slice(0, 2);
    }
    segment.audio = asset.file;
    segment.audio_label = asset.name || asset.label || asset.file;
    segment.audio_src = "ref";
    segment.audio_mode = "ref";
    segment.audio_ref_mode = "copy";
    segment.audio_ref_ambient = false;
    segment.voice_refs = voices;
    const keptVoices = new Set(voices);
    Object.keys(segment.voice_labels).forEach((file) => {
      if (!keptVoices.has(file)) delete segment.voice_labels[file];
    });
    if (segment.voice_modes && typeof segment.voice_modes === "object") {
      Object.keys(segment.voice_modes).forEach((file) => {
        if (!keptVoices.has(file)) delete segment.voice_modes[file];
      });
    }
    return 1;
  }
  if (segment.audio_src === "ref" && segment.audio === asset.file) {
    segment.audio = null;
    segment.audio_label = null;
    segment.audio_src = "model";
  }
  const mainCount = segment.audio_src === "ref" && segment.audio ? 1 : 0;
  const existing = voices.indexOf(asset.file);
  if (existing >= 0) return mainCount + existing + 1;
  const capacity = 3 - mainCount;
  if (voices.length >= capacity) {
    if (!replaceExisting) return 0;
    voices = voices.slice(0, Math.max(0, capacity - 1));
  }
  voices.push(asset.file);
  segment.voice_refs = voices;
  segment.voice_labels[asset.file] = asset.name || asset.label || asset.file;
  return mainCount + voices.length;
}

function removeCreateAudioAssetFromSegment(segment, file) {
  if (!segment || !file) return;
  if (segment.audio === file) {
    segment.audio = null;
    segment.audio_label = null;
    if (segment.audio_src === "ref") {
      segment.audio_src = "model";
      delete segment.audio_mode;
      delete segment.audio_ref_mode;
      delete segment.audio_ref_ambient;
    }
  }
  segment.voice_refs = (Array.isArray(segment.voice_refs) ? segment.voice_refs : [])
    .filter((name) => name !== file);
  if (segment.voice_labels && typeof segment.voice_labels === "object") delete segment.voice_labels[file];
  if (segment.voice_modes && typeof segment.voice_modes === "object") delete segment.voice_modes[file];
}

function bindCreateAudioMentions(segment, assets) {
  const text = String(segment && segment.prompt || "");
  const pattern = /[@＠](A\d+)(?:（([^）\r\n]+)）|\(([^)\r\n]+)\))?/gi;
  const mentions = [...text.matchAll(pattern)];
  if (!mentions.length) return { bound: 0, missing: 0, overflow: 0 };
  const byId = new Map((assets || []).map((asset) => [String(asset.asset_id || "").toLowerCase(), asset]));
  const referenced = [];
  const seen = new Set();
  const missing = new Set();
  for (const mention of mentions) {
    const id = mention[1].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const asset = byId.get(id.toLowerCase());
    if (asset) referenced.push(asset);
    else missing.add(id);
  }
  const overflow = new Set();
  if (referenced.length) {
    const copyAssets = referenced.filter((asset) => asset.usage === "copy");
    const copyAsset = copyAssets[0] || null;
    copyAssets.slice(1).forEach((asset) => overflow.add(asset.asset_id));
    if (copyAsset) bindCreateAudioAssetToSegment(segment, copyAsset, true);
    const timbreAssets = referenced.filter((asset) => asset.usage !== "copy");
    const timbreFiles = new Set(timbreAssets.map((asset) => asset.file));
    if (!copyAsset && segment.audio_src === "ref" && timbreFiles.has(segment.audio)) {
      segment.audio = null;
      segment.audio_label = null;
      segment.audio_src = "model";
    }
    const mainCount = segment.audio_src === "ref" && segment.audio ? 1 : 0;
    const capacity = 3 - mainCount;
    const explicitVoices = timbreAssets.slice(0, capacity);
    timbreAssets.slice(capacity).forEach((asset) => overflow.add(asset.asset_id));
    const explicitFiles = new Set(explicitVoices.map((asset) => asset.file));
    const oldVoices = Array.isArray(segment.voice_refs) ? segment.voice_refs : [];
    const preserved = oldVoices.filter((file) => file && !timbreFiles.has(file)
      && (!copyAsset || file !== copyAsset.file) && !explicitFiles.has(file));
    segment.voice_refs = [...explicitVoices.map((asset) => asset.file), ...preserved]
      .slice(0, capacity);
    if (!segment.voice_labels || typeof segment.voice_labels !== "object") segment.voice_labels = {};
    explicitVoices.forEach((asset) => {
      segment.voice_labels[asset.file] = asset.name || asset.label || asset.file;
    });
    const keptVoices = new Set(segment.voice_refs);
    Object.keys(segment.voice_labels).forEach((file) => {
      if (!keptVoices.has(file)) delete segment.voice_labels[file];
    });
    if (segment.voice_modes && typeof segment.voice_modes === "object") {
      Object.keys(segment.voice_modes).forEach((file) => {
        if (!keptVoices.has(file)) delete segment.voice_modes[file];
      });
    }
  }
  segment.prompt = text.replace(pattern, (match, assetId, cnName, enName) => {
    const asset = byId.get(String(assetId || "").toLowerCase());
    const displayName = String(cnName || enName || asset && asset.name || assetId).trim();
    const number = asset && !overflow.has(asset.asset_id)
      ? createAudioAssetBindingNumber(segment, asset) : 0;
    return number ? `${displayName} <Audio ${number}>` : displayName;
  });
  const bound = referenced.filter((asset) => !overflow.has(asset.asset_id)
    && createAudioAssetBindingNumber(segment, asset) > 0).length;
  return { bound, missing: missing.size, overflow: overflow.size };
}

function removeCreateNarratorVoiceDeclaration(segment) {
  if (!segment) return;
  const lines = String(segment.prompt || "").split(/\r?\n/)
    .filter((line) => !/^旁白使用 <Audio \d+> 的参考音色，声音来自画外；画面人物不因旁白张嘴。$/.test(line.trim()));
  segment.prompt = lines.join("\n").trim();
}

function bindCreateNarratorVoiceToSegment(segment, asset) {
  if (!segment || !asset) return 0;
  const number = bindCreateAudioAssetToSegment(segment, { ...asset, usage: "timbre" });
  if (!number) return 0;
  removeCreateNarratorVoiceDeclaration(segment);
  const line = `旁白使用 <Audio ${number}> 的参考音色，声音来自画外；画面人物不因旁白张嘴。`;
  segment.prompt = String(segment.prompt || "").trimEnd();
  segment.prompt = segment.prompt ? segment.prompt + "\n" + line : line;
  return number;
}

function replaceCreateAudioAssetFileInSegments(segments, oldFile, asset) {
  if (!oldFile || !asset || !asset.file || oldFile === asset.file) return;
  for (const segment of segments || []) {
    if (!segment || typeof segment !== "object") continue;
    if (segment.audio === oldFile) {
      segment.audio = asset.file;
      segment.audio_label = asset.name || asset.label || asset.file;
    }
    segment.voice_refs = [...new Set((segment.voice_refs || [])
      .map((file) => file === oldFile ? asset.file : file).filter(Boolean))];
    if (segment.voice_labels && segment.voice_labels[oldFile]) {
      delete segment.voice_labels[oldFile];
      segment.voice_labels[asset.file] = asset.name || asset.label || asset.file;
    }
    if (segment.voice_modes && segment.voice_modes[oldFile]) {
      const mode = segment.voice_modes[oldFile];
      delete segment.voice_modes[oldFile];
      segment.voice_modes[asset.file] = mode;
    }
  }
}

function ensureRoleNameMap(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  const current = node.properties.h3_ref_role_names;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    node.properties.h3_ref_role_names = {};
  }
  return node.properties.h3_ref_role_names;
}

function ensureAssetMetaMap(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  const current = node.properties.h3_ref_asset_meta;
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    node.properties.h3_ref_asset_meta = {};
  }
  return node.properties.h3_ref_asset_meta;
}

function nextStableAssetId(node, type) {
  const normalized = normalizeAssetType(type);
  const prefix = H3_ASSET_TYPES[normalized].prefix;
  let max = 0;
  for (const meta of Object.values(ensureAssetMetaMap(node))) {
    const match = String(meta && meta.asset_id || "").match(new RegExp("^" + prefix + "(\\d+)$", "i"));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return prefix + (max + 1);
}

function getRefAssetMeta(node, file, originalName = "", preferredType = "character") {
  const map = ensureAssetMetaMap(node);
  const legacy = ensureRoleNameMap(node);
  let meta = map[file];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};
  meta.name = String(meta.name || legacy[file] || roleNameFromFilename(originalName || file)).trim()
    || roleNameFromFilename(originalName || file);
  meta.type = normalizeAssetType(meta.type || preferredType);
  meta.aliases = Array.isArray(meta.aliases) ? meta.aliases.map((value) => String(value || "").trim()).filter(Boolean)
    : String(meta.aliases || "").split(/[，,;；\n]/).map((value) => value.trim()).filter(Boolean);
  meta.filename = String(meta.filename || originalName || file || "").replace(/\\/g, "/").split("/").pop();
  const expectedPrefix = H3_ASSET_TYPES[meta.type].prefix;
  if (!new RegExp("^" + expectedPrefix + "\\d+$", "i").test(String(meta.asset_id || ""))) {
    meta.asset_id = nextStableAssetId(node, meta.type);
  }
  map[file] = meta;
  legacy[file] = meta.name; // 旧工作流/旧版本仍能读取角色名。
  return meta;
}

function rewriteCreateAssetMentions(value, remap) {
  if (typeof value !== "string" || !remap.size) return value;
  return value.replace(/@([CSPG]\d+)\b/gi, (match, assetId) => {
    const replacement = remap.get(assetId.toUpperCase());
    return replacement ? "@" + replacement : match;
  });
}

function migrateCreateAssetLibraryIds(node, libraryFiles = [], segments = []) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  if (node.properties.h3_create_asset_ids_by_type_v1 === "1") return false;

  const counters = { character: 0, scene: 0, prop: 0, general: 0 };
  const entries = [];
  const oldIdCounts = new Map();
  for (const file of libraryFiles) {
    const meta = getRefAssetMeta(node, file);
    const type = normalizeAssetType(meta.type);
    const oldId = String(meta.asset_id || "").toUpperCase();
    entries.push({ file, meta, type, oldId });
    if (oldId) oldIdCounts.set(oldId, (oldIdCounts.get(oldId) || 0) + 1);
  }

  const remap = new Map();
  let changed = false;
  for (const entry of entries) {
    const nextId = H3_ASSET_TYPES[entry.type].prefix + (++counters[entry.type]);
    if (entry.oldId === nextId) continue;
    entry.meta.asset_id = nextId;
    changed = true;
    if (entry.oldId && oldIdCounts.get(entry.oldId) === 1) remap.set(entry.oldId, nextId);
  }

  if (changed && remap.size) {
    const slotIds = new Set((Array.isArray(node.properties.h3_create_asset_slots)
      ? node.properties.h3_create_asset_slots : [])
      .map((slot) => String(slot && slot.asset_id || "").toUpperCase()).filter(Boolean));
    for (const assetId of slotIds) remap.delete(assetId);
    for (const segment of segments || []) {
      if (segment) segment.prompt = rewriteCreateAssetMentions(segment.prompt, remap);
    }
    for (const key of ["h3_create_script", "h3_create_global_prompt", "h3_create_auto_global_value"]) {
      node.properties[key] = rewriteCreateAssetMentions(node.properties[key], remap);
    }
  }

  node.properties.h3_create_asset_ids_by_type_v1 = "1";
  return changed;
}

function assignCreateAssetId(node, libraryFiles, file, type, originalName = "") {
  const normalized = normalizeAssetType(type);
  const prefix = H3_ASSET_TYPES[normalized].prefix;
  let max = 0;
  for (const currentFile of libraryFiles || []) {
    if (!currentFile || currentFile === file) continue;
    const current = getRefAssetMeta(node, currentFile);
    if (normalizeAssetType(current.type) !== normalized) continue;
    const match = String(current.asset_id || "").match(new RegExp("^" + prefix + "(\\d+)$", "i"));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  const meta = getRefAssetMeta(node, file, originalName, normalized);
  meta.type = normalized;
  meta.asset_id = prefix + (max + 1);
  return meta;
}

function getRefRoleName(node, file, originalName = "") {
  return getRefAssetMeta(node, file, originalName).name;
}

function collectAssetLibrary(node, segments) {
  const seen = new Set();
  const out = [];
  for (const seg of segments || []) {
    for (const file of (Array.isArray(seg.refs) ? seg.refs : [])) {
      if (!file || seen.has(file)) continue;
      seen.add(file);
      const meta = getRefAssetMeta(node, file);
      out.push({ file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
        aliases: meta.aliases.slice(), filename: meta.filename });
    }
  }
  return out;
}

function ensureCreateGlobalRefs(node, segments = []) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  if (!Array.isArray(node.properties.h3_create_global_refs)) {
    /* 旧工作流没有独立全局库：只迁移创作分段已经真实使用过的图片，不读取文本/视频页面。 */
    node.properties.h3_create_global_refs = collectAssetLibrary(node, segments)
      .map((asset) => asset.file).filter(Boolean);
  }
  const seen = new Set();
  node.properties.h3_create_global_refs = node.properties.h3_create_global_refs
    .filter((file) => typeof file === "string" && file && !seen.has(file) && seen.add(file));
  return node.properties.h3_create_global_refs;
}

function ensureCreateGlobalAssetRefs(node, libraryFiles = []) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  if (!Array.isArray(node.properties.h3_create_global_asset_refs)) {
    node.properties.h3_create_global_asset_refs = [];
  }
  const allowed = new Set(libraryFiles);
  const seen = new Set();
  node.properties.h3_create_global_asset_refs = node.properties.h3_create_global_asset_refs
    .filter((file) => typeof file === "string" && allowed.has(file) && !seen.has(file) && seen.add(file));
  return node.properties.h3_create_global_asset_refs;
}

function ensureCreateAssetSlots(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  if (!Array.isArray(node.properties.h3_create_asset_slots)) node.properties.h3_create_asset_slots = [];
  node.properties.h3_create_asset_slots = node.properties.h3_create_asset_slots.map((raw, index) => {
    const type = normalizeAssetType(raw && raw.type);
    const prefix = H3_ASSET_TYPES[type].prefix;
    const assetId = String(raw && raw.asset_id || "").trim();
    return {
      asset_id: new RegExp("^" + prefix + "\\d+$", "i").test(assetId) ? assetId.toUpperCase() : prefix + (index + 1),
      name: String(raw && raw.name || "未命名资产").trim() || "未命名资产",
      type,
      description: String(raw && raw.description || "").trim(),
      aliases: Array.isArray(raw && raw.aliases) ? raw.aliases.map((value) => String(value || "").trim()).filter(Boolean) : [],
      file: String(raw && raw.file || "").trim(),
    };
  });
  return node.properties.h3_create_asset_slots;
}

function replaceCreateAssetSlots(node, definitions = [], library = []) {
  const previous = ensureCreateAssetSlots(node);
  const previousByKey = new Map(previous.map((slot) => [slot.type + ":" + slot.asset_id.toLowerCase(), slot]));
  const next = [];
  for (const raw of definitions || []) {
    const type = normalizeAssetType(raw && raw.type);
    const assetId = String(raw && raw.asset_id || "").trim().toUpperCase();
    const name = String(raw && raw.name || "").trim();
    if (!name) continue;
    const key = type + ":" + assetId.toLowerCase();
    const old = previousByKey.get(key);
    const matched = (library || []).find((asset) => asset.type === type
      && (String(asset.asset_id || "").toLowerCase() === assetId.toLowerCase()
        || String(asset.name || "").trim().toLowerCase() === name.toLowerCase()));
    next.push({
      asset_id: assetId || H3_ASSET_TYPES[type].prefix + (next.length + 1),
      name,
      type,
      description: String(raw && raw.description || "").trim(),
      aliases: Array.isArray(raw && raw.aliases) ? raw.aliases.slice() : [],
      file: matched && matched.file || old && old.file || "",
    });
  }
  node.properties.h3_create_asset_slots = next;
  return next;
}

function mergeCreateAssetSlots(node, definitions = [], library = []) {
  const merged = ensureCreateAssetSlots(node).map((slot) => ({ ...slot }));
  const imported = [];
  for (const raw of definitions || []) {
    const type = normalizeAssetType(raw && raw.type);
    const prefix = H3_ASSET_TYPES[type].prefix;
    let assetId = String(raw && raw.asset_id || "").trim().toUpperCase();
    const name = String(raw && raw.name || "").trim();
    if (!name) continue;
    if (!new RegExp("^" + prefix + "\\d+$", "i").test(assetId)) {
      const used = merged.map((slot) => String(slot.asset_id || "").match(new RegExp("^" + prefix + "(\\d+)$", "i")))
        .filter(Boolean).map((match) => Number(match[1]) || 0);
      assetId = prefix + (Math.max(0, ...used) + 1);
    }
    const index = merged.findIndex((slot) => slot.type === type
      && String(slot.asset_id || "").toLowerCase() === assetId.toLowerCase());
    const old = index >= 0 ? merged[index] : null;
    const matched = (library || []).find((asset) => asset.type === type
      && (String(asset.asset_id || "").toLowerCase() === assetId.toLowerCase()
        || String(asset.name || "").trim().toLowerCase() === name.toLowerCase()));
    const slot = {
      asset_id: assetId,
      name,
      type,
      description: String(raw && raw.description || "").trim(),
      aliases: Array.isArray(raw && raw.aliases) ? raw.aliases.slice() : [],
      file: matched && matched.file || old && old.file || "",
    };
    if (index >= 0) merged[index] = slot;
    else merged.push(slot);
    imported.push(slot);
  }
  node.properties.h3_create_asset_slots = merged;
  return imported;
}

function uniqueAssetFiles(files) {
  const seen = new Set();
  return (files || []).filter((file) => typeof file === "string" && file && !seen.has(file) && seen.add(file));
}

function segmentManualAssetFiles(segment) {
  const refs = Array.isArray(segment && segment.refs) ? segment.refs : [];
  const manual = Array.isArray(segment && segment.manual_refs) ? segment.manual_refs : refs;
  const legacyAuto = Array.isArray(segment && segment.auto_refs) ? segment.auto_refs : [];
  return uniqueAssetFiles([...manual, ...legacyAuto]);
}

function segmentParsedAssetFiles(segment) {
  return uniqueAssetFiles(Array.isArray(segment && segment.parsed_refs) ? segment.parsed_refs : []);
}

function uniqueCreateSegmentAssetFiles(node, files) {
  return uniqueH3SegmentAssets(uniqueAssetFiles(files).map((file) => {
    const meta = getRefAssetMeta(node, file);
    return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
      aliases: meta.aliases, filename: meta.filename };
  })).map((asset) => asset.file);
}

function syncCreateSegmentAssetRefs(node, segments, globalAssetRefs) {
  let changed = false;
  for (const segment of segments || []) {
    const manual = segmentManualAssetFiles(segment);
    const parsed = segmentParsedAssetFiles(segment);
    const refs = uniqueCreateSegmentAssetFiles(node, [...globalAssetRefs, ...manual, ...parsed]);
    if (JSON.stringify(segment.refs || []) !== JSON.stringify(refs)
      || JSON.stringify(segment.manual_refs || []) !== JSON.stringify(manual)
      || JSON.stringify(segment.parsed_refs || []) !== JSON.stringify(parsed)
      || (segment.auto_refs || []).length) changed = true;
    segment.manual_refs = manual;
    segment.parsed_refs = parsed;
    segment.auto_refs = [];
    segment.refs = refs;
  }
  return changed;
}

function collectCreateGlobalAssetLibrary(node, segments = []) {
  const files = ensureCreateGlobalRefs(node, segments);
  return files.map((file) => {
    const meta = getRefAssetMeta(node, file);
    return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
      aliases: meta.aliases.slice(), filename: meta.filename,
      voice_asset_id: String(meta.voice_asset_id || "").trim().toUpperCase() };
  });
}

function collectRoleLibrary(node, segments) {
  return collectAssetLibrary(node, segments).filter((asset) => asset.type === "character");
}

function stripGeneratedAssetBinding(prompt) {
  const lines = String(prompt || "").split(/\r?\n/);
  const kept = [];
  const pictureByAssetId = new Map();
  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*Reference asset bindings \(project IDs stay stable; Subject\/Picture numbers follow this segment's image order\):\s*$/i.test(lines[index])) {
      kept.push(lines[index]);
      continue;
    }
    index += 1;
    for (; index < lines.length; index++) {
      const line = lines[index];
      const subject = line.match(/^\s*<Subject\s+\d+>[\s\S]*?\b([CPSG]\d+)\b[\s\S]*?<Picture\s+(\d+)>[\s\S]*$/i);
      if (subject) {
        pictureByAssetId.set(subject[1].toUpperCase(), Number(subject[2]));
        continue;
      }
      if (/^\s*Reference identity contract:/i.test(line) || !line.trim()) continue;
      kept.push(line);
      break;
    }
  }
  return { text: kept.join("\n").trim(), pictureByAssetId };
}

function resolveCreateMentionAsset(assets, assetId, displayName) {
  const stableId = String(assetId || "").trim().toUpperCase();
  const exact = (assets || []).find((asset) => String(asset && asset.asset_id || "").trim().toUpperCase() === stableId);
  const name = String(displayName || "").trim()
    .replace(/^[（(]\s*/, "").replace(/\s*[）)]$/, "").trim().toLowerCase();
  if (!name) return exact || null;
  const matches = (assets || []).filter((asset) => [asset && asset.name, ...(Array.isArray(asset && asset.aliases) ? asset.aliases : [])]
    .some((value) => String(value || "").trim().toLowerCase() === name));
  if (matches.length === 1) return matches[0];
  return exact || null;
}

function analyzeCreateSegmentPromptAssets(prompt, assets) {
  const source = String(prompt || "");
  const orderedAssets = [];
  const unresolved = [];
  const corrections = [];
  const seenFiles = new Set();
  const seenUnresolved = new Set();
  const seenCorrections = new Set();
  const addReference = (assetId, displayName) => {
    const stableId = String(assetId || "").trim().toUpperCase();
    const name = String(displayName || "").trim();
    const asset = resolveCreateMentionAsset(assets, stableId, name);
    if (!asset || !asset.file) {
      const token = stableId + (name ? `（${name}）` : "");
      if (token && !seenUnresolved.has(token)) {
        seenUnresolved.add(token);
        unresolved.push(token);
      }
      return;
    }
    const resolvedId = String(asset.asset_id || "").trim().toUpperCase();
    if (stableId && resolvedId && stableId !== resolvedId) {
      const correction = stableId + (name ? `（${name}）` : "") + `→${resolvedId}`;
      if (!seenCorrections.has(correction)) {
        seenCorrections.add(correction);
        corrections.push(correction);
      }
    }
    if (seenFiles.has(asset.file)) return;
    seenFiles.add(asset.file);
    orderedAssets.push(asset);
  };

  const bindings = [...source.matchAll(
    /^\s*<Subject\s+\d+>[^\r\n]*?\b([CPSG]\d+)\b(?:\s+["“]([^"”]+)["”])?[^\r\n]*?<Picture\s+(\d+)>/gim,
  )].map((match) => ({
    assetId: match[1], displayName: match[2] || "", picture: Number(match[3]), index: match.index,
  })).sort((left, right) => left.picture - right.picture || left.index - right.index);
  bindings.forEach((binding) => addReference(binding.assetId, binding.displayName));

  for (const match of source.matchAll(/[@＠]([CPSG]\d+)(?:（([^）]+)）|\(([^)]+)\))?/gi)) {
    addReference(match[1], match[2] || match[3] || "");
  }
  return { assets: orderedAssets, unresolved, corrections };
}

const H3_OFFICIAL_PROMPT_FIELDS = [
  "subject_definitions", "summary", "retention_analysis", "detailed_description",
  "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music",
  "director_import_manifest",
];

function splitOfficialPromptFields(prompt) {
  const text = String(prompt || "").trim();
  const fieldRe = new RegExp("(?:^|\\n)[ \\t]*(" + H3_OFFICIAL_PROMPT_FIELDS.join("|")
    + ")[ \\t]*[:：][ \\t]*", "gi");
  const marks = [];
  let match;
  while ((match = fieldRe.exec(text))) {
    marks.push({ name: match[1].toLowerCase(), start: match.index + (match[0][0] === "\n" ? 1 : 0), end: fieldRe.lastIndex });
  }
  if (!marks.length) return null;
  const fields = {};
  for (let index = 0; index < marks.length; index++) {
    const end = index + 1 < marks.length ? marks[index + 1].start : text.length;
    if (fields[marks[index].name] == null) fields[marks[index].name] = text.slice(marks[index].end, end).trim();
  }
  return { prefix: text.slice(0, marks[0].start).trim(), fields };
}

function normalizeReferenceClosures(prompt) {
  return String(prompt || "").replace(/(<(?:Picture|Subject)\s+\d+>)>+/gi, "$1");
}

function isCompleteOfficialRef2vaPrompt(prompt) {
  const parsed = splitOfficialPromptFields(prompt);
  return !!parsed && ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "overall_soundscape", "non_diegetic_music"].every((name) => parsed.fields[name] != null);
}

function renderOfficialRef2vaFields(fields) {
  const order = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "overall_soundscape", "non_diegetic_music"];
  const parts = order.map((name) => `${name}:\n${String(fields[name] || "").trim()}`);
  if (String(fields.director_import_manifest || "").trim()) {
    parts.push("director_import_manifest:\n" + String(fields.director_import_manifest).trim());
  }
  return parts.join("\n\n").trim();
}

function bindOfficialRef2vaPromptToAssets(prompt, assets, hasTailPicture) {
  const hasVisualReference = !!hasTailPicture || !!(assets || []).length;
  let parsed = splitOfficialPromptFields(normalizeReferenceClosures(prompt));
  if (!parsed) {
    if (!hasVisualReference) return null;
    parsed = { prefix: "", fields: { detailed_description: String(prompt || "").trim() } };
  }
  const fields = parsed.fields;
  const isRef2va = fields.subject_definitions != null || fields.retention_analysis != null
    || fields.detailed_description != null;
  if (!isRef2va && !hasVisualReference) return null;

  const subjectLines = [];
  const retentionLines = [];
  if (hasTailPicture) {
    subjectLines.push("<Subject 1> is the exact final frame inherited from the previous segment, defined by <Picture 1>.");
    retentionLines.push("<Picture 1>: reference - preserve the opening composition, identity, pose, camera geometry and motion direction before continuing forward.");
  }
  const typeNames = { character: "character", scene: "scene", prop: "prop", generic: "visual reference" };
  const pictureByAssetId = new Map();
  for (let index = 0; index < (assets || []).length; index++) {
    const asset = assets[index];
    const picture = index + 1 + (hasTailPicture ? 1 : 0);
    const assetId = String(asset.asset_id || "").toUpperCase();
    const name = String(asset.name || assetId || `Picture ${picture}`).trim();
    pictureByAssetId.set(assetId, picture);
    subjectLines.push(`<Subject ${picture}> is the ${typeNames[asset.type] || "visual reference"} ${assetId} "${name}" defined by <Picture ${picture}>.`);
    const retention = asset.type === "scene"
      ? "scene layout, architecture, lighting and spatial direction"
      : asset.type === "prop" ? "shape, material, color and identifying details"
        : "identity, face, body proportions, fixed clothing and identifying accessories";
    retentionLines.push(`<Picture ${picture}>: reference - preserve <Subject ${picture}>'s ${retention}.`);
  }
  const preservedSubjects = String(fields.subject_definitions || "").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !/<Subject\s+\d+>|<Picture\s+\d+>/i.test(line));
  const preservedRetention = String(fields.retention_analysis || "").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !/<Picture\s+\d+>/i.test(line));

  let detailed = [parsed.prefix, fields.detailed_description || fields.integrated_multimodal_description || ""]
    .filter(Boolean).join("\n").trim();
  detailed = detailed.replace(/([@＠])([CPSG]\d+)((?:（[^）]*）|\([^)]*\))?)(?:\s*(?:<Subject\s+\d+>|<Picture\s+\d+>))*/gi,
    (match, at, assetId, label) => {
      const asset = resolveCreateMentionAsset(assets, assetId, label);
      const resolvedId = String(asset && asset.asset_id || assetId || "").toUpperCase();
      const picture = pictureByAssetId.get(resolvedId);
      const resolvedLabel = label || (asset && asset.name ? `（${asset.name}）` : "");
      return picture ? `${at}${resolvedId}${resolvedLabel} <Subject ${picture}>` : `${at}${assetId}${label || ""}`;
    });
  const maxPicture = (assets || []).length + (hasTailPicture ? 1 : 0);
  detailed = detailed.replace(/<Picture\s+(\d+)>/gi, (match, value) => {
    const picture = Number(value);
    return picture >= 1 && picture <= maxPicture ? `<Subject ${picture}>` : "";
  });
  detailed = detailed.replace(/<Subject\s+(\d+)>/gi, (match, value) => {
    const subject = Number(value);
    return subject >= 1 && subject <= maxPicture ? `<Subject ${subject}>` : "";
  }).trim();

  return normalizeReferenceClosures(renderOfficialRef2vaFields({
    subject_definitions: [...subjectLines, ...preservedSubjects].join("\n"),
    summary: fields.summary || "Generate the requested segment while preserving the supplied reference relationships.",
    retention_analysis: [...retentionLines, ...preservedRetention].join("\n"),
    detailed_description: detailed,
    overall_soundscape: fields.overall_soundscape || "Natural ambient sound and physical action sounds matching the described shots.",
    non_diegetic_music: fields.non_diegetic_music || "N/A",
    director_import_manifest: fields.director_import_manifest || "",
  }));
}

function bindOrdinaryPromptToAssets(prompt, assets, hasTailPicture) {
  const stripped = stripGeneratedAssetBinding(prompt);
  const official = bindOfficialRef2vaPromptToAssets(stripped.text, assets, hasTailPicture);
  if (official) return official;
  const currentPictureByAssetId = new Map((assets || []).map((asset, index) => [
    String(asset.asset_id || "").toUpperCase(), index + 1 + (hasTailPicture ? 1 : 0),
  ]));
  let text = stripped.text;
  text = text.replace(/([@＠])([CPSG]\d+)((?:（[^）]*）|\([^)]*\))?)(?:\s*<Picture\s+\d+>)?/gi,
    (match, at, assetId, label) => {
      const picture = currentPictureByAssetId.get(String(assetId || "").toUpperCase());
      return picture ? `${at}${assetId}${label || ""} <Picture ${picture}>` : match;
    });
  for (const [assetId, oldPicture] of stripped.pictureByAssetId) {
    const currentPicture = currentPictureByAssetId.get(assetId);
    if (!currentPicture || oldPicture === currentPicture) continue;
    text = text.replace(new RegExp(`<Picture\\s+${oldPicture}>`, "gi"), `__H3_PICTURE_${assetId}__`);
  }
  for (const [assetId, picture] of currentPictureByAssetId) {
    text = text.replaceAll(`__H3_PICTURE_${assetId}__`, `<Picture ${picture}>`);
  }
  const maxPicture = (assets || []).length + (hasTailPicture ? 1 : 0);
  text = text.replace(/<Picture\s+(\d+)>/gi, (match, number) => {
    const picture = Number(number);
    return picture >= 1 && picture <= maxPicture ? `<Picture ${picture}>` : "";
  }).trim();
  if (!assets.length) return text;
  const bindings = formatAssetBinding(assets, hasTailPicture);
  return bindings ? bindings + "\n\n" + text : text;
}

function bindCreatePromptDirectToAssets(prompt, assets, hasTailPicture) {
  const normalizedPrompt = normalizeReferenceClosures(prompt);
  if (isCompleteOfficialRef2vaPrompt(normalizedPrompt)) {
    return bindOfficialRef2vaPromptToAssets(normalizedPrompt, assets, hasTailPicture) || normalizedPrompt;
  }

  const stripped = stripGeneratedAssetBinding(normalizedPrompt);
  const pictureByAssetId = new Map((assets || []).map((asset, index) => [
    String(asset.asset_id || "").toUpperCase(), index + 1 + (hasTailPicture ? 1 : 0),
  ]));
  let text = stripped.text;
  const picturePlaceholders = [];
  for (const [assetId, oldPicture] of stripped.pictureByAssetId) {
    const picture = pictureByAssetId.get(assetId);
    if (!picture || oldPicture === picture) continue;
    const placeholder = `__H3_CREATE_DIRECT_PICTURE_${picturePlaceholders.length}__`;
    text = text.replace(new RegExp(`<Picture\\s+${oldPicture}>`, "gi"), placeholder);
    picturePlaceholders.push([placeholder, picture]);
  }
  for (const [placeholder, picture] of picturePlaceholders) {
    text = text.replaceAll(placeholder, `<Picture ${picture}>`);
  }

  text = text.replace(/([@＠])([CPSG]\d+)((?:（[^）]*）|\([^)]*\))?)(?:\s*(?:<Subject\s+\d+>|<Picture\s+\d+>))*/gi,
    (match, at, assetId, label) => {
      const asset = resolveCreateMentionAsset(assets, assetId, label);
      const resolvedId = String(asset && asset.asset_id || assetId || "").toUpperCase();
      const picture = pictureByAssetId.get(resolvedId);
      const resolvedLabel = label || (asset && asset.name ? `（${asset.name}）` : "");
      return picture ? `${at}${resolvedId}${resolvedLabel} <Picture ${picture}>` : `${at}${assetId}${label || ""}`;
    });
  text = text.replace(/<Subject\s+(\d+)>/gi, "<Picture $1>");
  const maxPicture = (assets || []).length + (hasTailPicture ? 1 : 0);
  text = text.replace(/<Picture\s+(\d+)>/gi, (match, number) => {
    const picture = Number(number);
    return picture >= 1 && picture <= maxPicture ? `<Picture ${picture}>` : "";
  });
  return normalizeReferenceClosures(text).trim();
}

/* MiniMax H3 官方带字段模板：Base（三字段）与 Ref2VA（六字段）。
   字段结构必须完整保留；超过单次生成上限时，只切分镜头正文并为每段重建完整模板。 */
function parseStructuredOfficialScript(text) {
  let t = String(text || "").replace(/^\uFEFF/, "");
  t = t.replace(/^[ \t]*\x60{3}(?:text|txt|markdown)?[ \t]*$/gim, "").trim();

  const fieldRe = /(?:^|\n)[ \t]*(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music|director_import_manifest)[ \t]*[:：][ \t]*/gi;
  const fieldMarks = [];
  let fm;
  while ((fm = fieldRe.exec(t))) {
    fieldMarks.push({
      name: fm[1].toLowerCase(),
      start: fm.index + (fm[0].charAt(0) === "\n" ? 1 : 0),
      end: fieldRe.lastIndex,
    });
  }
  if (!fieldMarks.length) return null;

  const fields = {};
  for (let i = 0; i < fieldMarks.length; i++) {
    const mark = fieldMarks[i];
    const end = i + 1 < fieldMarks.length ? fieldMarks[i + 1].start : t.length;
    if (fields[mark.name] == null) fields[mark.name] = t.slice(mark.end, end).trim();
  }

  const isRef = fields.detailed_description != null
    || fields.subject_definitions != null
    || fields.retention_analysis != null;
  const isBase = !isRef && fields.integrated_multimodal_description != null;
  if (!isRef && !isBase) return null;

  const warnings = [];
  const addWarning = (msg) => { if (msg && !warnings.includes(msg)) warnings.push(msg); };
  const required = isRef
    ? ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"]
    : ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  for (const name of required) {
    if (!(fields[name] || "").trim()) addWarning("缺少或留空字段 " + name);
  }
  const requiredPositions = required.map((name) => fieldMarks.findIndex((mark) => mark.name === name));
  if (requiredPositions.every((position) => position >= 0)
      && requiredPositions.some((position, index) => index > 0 && position <= requiredPositions[index - 1])) {
    addWarning("H3 官方字段顺序不正确");
  }
  if (/\{\{[^{}\n]{1,80}\}\}|【[^】]*(?:填写|插入|替换|待定|占位|TODO|整片风格|画风|配色|质感|场景|角色|动作|运镜|镜头|机位|光线|文案|台词|旁白|环境音|音效|配乐)[^】]*】|<\s*(?:INSERT|填写|插入|替换|待定|占位|TODO|Picture\s+(?:TODO|PLACEHOLDER|待定|待填写|填写))[^>]*>|\b(?:TODO|PLACEHOLDER)\b/i.test(t)) {
    addWarning("仍有未替换的模板占位符");
  }

  const manifest = (fields.director_import_manifest || "").trim();
  if (manifest && fieldMarks[fieldMarks.length - 1].name !== "director_import_manifest") {
    addWarning("director_import_manifest 必须位于所有 H3 官方字段之后");
  }
  const declaredDurationMatch = manifest.match(/(?:source_total_duration_seconds|target_total_duration_seconds|源总时长秒|目标总时长秒)\s*[:：=]\s*(\d+(?:\.\d+)?)/i);
  const declaredTotalDuration = declaredDurationMatch ? (Number(declaredDurationMatch[1]) || 0) : 0;
  if (manifest && !(declaredTotalDuration > 0)) addWarning("director_import_manifest 缺少有效的 source_total_duration_seconds");
  const explicitSegmentPolicy = /segment_duration_policy\s*[:：=]\s*preserve_explicit\b/i.test(manifest);
  const explicitBoundariesMatch = manifest.match(/source_scene_boundaries_seconds\s*[:：=]\s*([^\r\n]+)/i);
  const requestedSegmentCountMatch = manifest.match(/requested_segment_count\s*[:：=]\s*(\d+)/i);
  const requestedSegmentDurationMatch = manifest.match(/requested_segment_duration_seconds\s*[:：=]\s*(\d+(?:\.\d+)?)/i);
  const tailPolicyMatch = manifest.match(/segment_tail_policy\s*[:：=]\s*([^\r\n]+)/i);
  const tailReasonsMatch = manifest.match(/segment_tail_reasons\s*[:：=]\s*([^\r\n]+)/i);
  const normalizeManifestTailPolicy = (value) => {
    const clean = String(value || "").trim().toLowerCase();
    if (/^(?:on|true|yes|开启|勾选|是)$/.test(clean)) return "on";
    if (/^(?:off|false|no|关闭|不勾选|不勾|否)$/.test(clean)) return "off";
    if (/^(?:review|check|待确认|需确认|需要确认)$/.test(clean)) return "review";
    return "";
  };
  let explicitTailPolicy = [];
  let explicitTailReasons = [];
  if (tailPolicyMatch) {
    explicitTailPolicy = tailPolicyMatch[1].split(/[\s,，、;；]+/)
      .filter(Boolean).map(normalizeManifestTailPolicy);
    if (explicitTailPolicy.some((value) => !value)) {
      explicitTailPolicy = [];
      addWarning("segment_tail_policy 包含无效值，已忽略尾帧计划");
    }
  }
  if (tailReasonsMatch) explicitTailReasons = tailReasonsMatch[1].split("|").map((value) => value.trim());
  let explicitSegmentBoundaries = [];
  let explicitSegmentContractError = "";
  if (explicitSegmentPolicy) {
    if (!explicitBoundariesMatch) {
      explicitSegmentContractError = "缺少 source_scene_boundaries_seconds";
    } else {
      explicitSegmentBoundaries = explicitBoundariesMatch[1].split(/[\s,，、;；|]+/)
        .filter(Boolean).map(Number);
      if (explicitSegmentBoundaries.length < 2 || explicitSegmentBoundaries.some((value) => !Number.isFinite(value))) {
        explicitSegmentContractError = "source_scene_boundaries_seconds 必须是至少两个有限数字";
      } else if (explicitSegmentBoundaries.some((value, index) => index > 0 && value <= explicitSegmentBoundaries[index - 1])) {
        explicitSegmentContractError = "source_scene_boundaries_seconds 必须严格递增";
      }
    }
    const requestedCount = requestedSegmentCountMatch ? Number(requestedSegmentCountMatch[1]) : 0;
    if (!explicitSegmentContractError && requestedCount > 0
        && requestedCount !== explicitSegmentBoundaries.length - 1) {
      explicitSegmentContractError = `requested_segment_count=${requestedCount} 与边界数量不一致`;
    }
    const requestedDuration = requestedSegmentDurationMatch ? Number(requestedSegmentDurationMatch[1]) : 0;
    if (!explicitSegmentContractError && requestedDuration > 0
        && explicitSegmentBoundaries.some((value, index) => index > 0
          && Math.abs(value - explicitSegmentBoundaries[index - 1] - requestedDuration) > 0.051)) {
      explicitSegmentContractError = `场次边界不符合每段 ${requestedDuration} 秒`;
    }
    if (!explicitSegmentContractError && explicitTailPolicy.length
        && explicitTailPolicy.length !== explicitSegmentBoundaries.length - 1) {
      explicitSegmentContractError = `segment_tail_policy 有 ${explicitTailPolicy.length} 项，与 ${explicitSegmentBoundaries.length - 1} 个生成段不一致`;
    }
    if (!explicitSegmentContractError && explicitTailPolicy.length && explicitTailPolicy[0] !== "off") {
      explicitTailPolicy[0] = "off";
      addWarning("生成段1没有上一段尾帧，已强制关闭尾帧续接");
    }
  } else if (explicitTailPolicy.length) {
    explicitTailPolicy = [];
    explicitTailReasons = [];
    addWarning("segment_tail_policy 缺少显式生成段边界，已忽略尾帧计划");
  }

  const mainName = isRef ? "detailed_description" : "integrated_multimodal_description";
  const description = (fields[mainName] || "").trim();
  const mainMark = fieldMarks.find((x) => x.name === mainName);
  const instruction = isBase && mainMark ? t.slice(0, mainMark.start).trim() : "";

  let mode = isRef ? "Ref2VA" : "T2VA";
  if (isBase && /Picture\s*2[\s\S]{0,240}aligns\s+with\s+the\s+\d+(?:\.\d+)?\s*-\s*second\s+mark/i.test(instruction)) {
    mode = "FL2VA";
  } else if (isBase && /at\s+0(?:\.0+)?\s+seconds?\s+into\s+the\s+target\s+video[\s\S]{0,160}fully\s+referenced/i.test(instruction)) {
    mode = "I2VA";
  } else if (isBase && /aligns\s+with\s+the\s+\d+(?:\.\d+)?\s*-\s*second\s+mark/i.test(instruction)) {
    mode = "L2VA";
  }

  let alignmentDuration = 0;
  for (const am of instruction.matchAll(/aligns\s+with\s+the\s+(\d+(?:\.\d+)?)\s*-\s*second\s+mark/gi)) {
    alignmentDuration = Math.max(alignmentDuration, parseFloat(am[1]));
  }

  const shotRe = /\[Shot\s+(\d+)\s*\]/gi;
  const shotMarks = [];
  let sm;
  while ((sm = shotRe.exec(description))) {
    shotMarks.push({ num: parseInt(sm[1], 10), idx: sm.index, end: shotRe.lastIndex });
  }
  const descriptionLead = shotMarks.length ? description.slice(0, shotMarks[0].idx).trim() : description;
  const shots = [];
  for (let i = 0; i < shotMarks.length; i++) {
    const mark = shotMarks[i];
    const end = i + 1 < shotMarks.length ? shotMarks[i + 1].idx : description.length;
    let body = description.slice(mark.end, end).trim();
    const prefix = parseOfficialShotPrefix(body);
    if (prefix.hadRange) addWarning("已把 Shot " + mark.num + " 的重复起止范围规范化为单一 At 时间轴");
    if (prefix.hadAt && i === 0) addWarning("已移除 Shot 1 多余的 At 时间标记");
    if (prefix.hadAt && prefix.hadRange && Number.isFinite(prefix.rangeStart)
        && Number.isFinite(prefix.start) && Math.abs(prefix.rangeStart - prefix.start) > 0.01) {
      addWarning("Shot " + mark.num + " 的 At 时间与重复范围起点不一致，已优先采用 At 时间");
    }
    shots.push({ num: mark.num, start: prefix.start, rangeEnd: prefix.rangeEnd, body: prefix.body, dur: 0 });
  }

  if (shots.length) {
    if (shots[0].start == null) shots[0].start = 0;
    let sequential = shots[0].num === 1;
    for (let i = 1; i < shots.length; i++) {
      if (shots[i].num !== shots[i - 1].num + 1) sequential = false;
    }
    if (!sequential) addWarning("Shot 编号不是从 1 开始连续递增");

    let timelineValid = Number.isFinite(shots[0].start);
    for (let i = 1; i < shots.length; i++) {
      if (!Number.isFinite(shots[i].start)) {
        timelineValid = false;
        addWarning("Shot " + shots[i].num + " 缺少 At 时间标记");
      } else if (Number.isFinite(shots[i - 1].start) && shots[i].start <= shots[i - 1].start) {
        timelineValid = false;
        addWarning("Shot 时间没有严格递增");
      }
    }

    let lastGap = 0;
    for (let i = 0; i + 1 < shots.length; i++) {
      if (Number.isFinite(shots[i].start) && Number.isFinite(shots[i + 1].start) && shots[i + 1].start > shots[i].start) {
        shots[i].dur = shots[i + 1].start - shots[i].start;
        lastGap = shots[i].dur;
      }
    }
    const finalShot = shots[shots.length - 1];
    if (timelineValid && declaredTotalDuration > finalShot.start) {
      shots[shots.length - 1].dur = declaredTotalDuration - shots[shots.length - 1].start;
    } else if (timelineValid && declaredTotalDuration > 0) {
      addWarning("导演台源总时长不晚于最后一个 Shot 起点");
      shots[shots.length - 1].dur = lastGap;
    } else if (timelineValid && alignmentDuration > shots[shots.length - 1].start) {
      shots[shots.length - 1].dur = alignmentDuration - shots[shots.length - 1].start;
    } else if (timelineValid && alignmentDuration > 0) {
      addWarning("图片对齐终点不晚于最后一个 Shot 起点");
      shots[shots.length - 1].dur = lastGap;
    } else if (timelineValid && Number.isFinite(finalShot.rangeEnd) && finalShot.rangeEnd > finalShot.start) {
      finalShot.dur = finalShot.rangeEnd - finalShot.start;
    } else if (timelineValid) {
      shots[shots.length - 1].dur = lastGap;
    }
  } else if (description) {
    addWarning("未找到 [Shot N]，已按一个完整段导入");
  }

  if (isRef) {
    const definedSubjects = new Set();
    for (const m of (fields.subject_definitions || "").matchAll(/<Subject\s+(\d+)>/gi)) definedSubjects.add(m[1]);
    for (const m of description.matchAll(/<Subject\s+(\d+)>/gi)) {
      if (!definedSubjects.has(m[1])) addWarning("<Subject " + m[1] + "> 在 subject_definitions 中未定义");
    }
  }

  const buildLocalizedSoundscape = (bucket) => {
    const sounds = [];
    const seen = new Set();
    const add = (value) => {
      const clean = String(value || "").replace(/\s+/g, " ").trim();
      const key = clean.toLowerCase();
      if (clean && !seen.has(key)) { seen.add(key); sounds.push(clean); }
    };
    for (const shot of bucket || []) {
      const body = String(shot && shot.body || "");
      const explicit = /(?:具体声音(?:为|包括)?|声音(?:为|包括)?|soundscape(?: includes?|:)|sounds?(?: include| includes|:)|audio(?: includes?|:))\s*([^。！？\n]+[。！？]?)/gi;
      let match;
      while ((match = explicit.exec(body))) add(match[1]);
    }
    const guard = "Audio scope is limited to the ambience, physical action sounds, and nonverbal vocal "
      + "sounds explicitly named in this segment's Shots; sounds, characters, actions, and locations "
      + "from other segments are outside this segment.";
    return sounds.length ? guard + " " + sounds.join(" ") : guard;
  };

  const buildPrompt = (body, soundscapeOverride = null) => {
    const parts = [];
    if (isBase) {
      if (instruction) parts.push(instruction);
      parts.push("integrated_multimodal_description:\n" + body.trim());
    } else {
      if ((fields.subject_definitions || "").trim()) parts.push("subject_definitions:\n" + fields.subject_definitions.trim());
      if ((fields.summary || "").trim()) parts.push("summary:\n" + fields.summary.trim());
      if ((fields.retention_analysis || "").trim()) parts.push("retention_analysis:\n" + fields.retention_analysis.trim());
      parts.push("detailed_description:\n" + body.trim());
    }
    const soundscape = soundscapeOverride == null
      ? (fields.overall_soundscape || "").trim()
      : String(soundscapeOverride || "").trim();
    if (soundscape) parts.push("overall_soundscape:\n" + soundscape);
    if ((fields.non_diegetic_music || "").trim()) parts.push("non_diegetic_music:\n" + fields.non_diegetic_music.trim());
    return parts.join("\n\n");
  };

  const fmtTs = (sec) => {
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const hh = Math.floor(totalMs / 3600000);
    const afterHours = totalMs - hh * 3600000;
    const mm = Math.floor(afterHours / 60000);
    const rem = afterHours - mm * 60000;
    const ss = Math.floor(rem / 1000);
    const ms = rem - ss * 1000;
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":"
      + String(ss).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  };
  const recon = (bucket, bucketStart) => {
    const timeline = bucket.map((shot, i) => {
      const rel = Number.isFinite(shot.start) ? shot.start - bucketStart : null;
      const head = "[Shot " + (i + 1) + "]";
      if (i === 0 || rel == null || rel < 0.05) return head + " " + shot.body;
      return head + " At " + fmtTs(rel) + ", " + shot.body;
    }).join("\n");
    return [descriptionLead, timeline].filter(Boolean).join("\n");
  };

  let globalStyle = "";

  const MAXGEN = 362 / 24;
  let total = 0;
  const timelineValid = shots.length
    && shots.every((shot) => Number.isFinite(shot.start))
    && shots[shots.length - 1].dur > 0;
  if (timelineValid) {
    total = shots[shots.length - 1].start + shots[shots.length - 1].dur - shots[0].start;
  }

  const blockedExplicitSegments = (message) => {
    const blocked = [];
    blocked.importBlocked = true;
    blocked.importError = "显式生成段契约无效：" + message;
    blocked.official = true;
    blocked.officialFormat = isRef ? "ref2va" : "base";
    blocked.officialMode = mode;
    blocked.officialLabel = isRef ? "官方 Ref2VA" : "官方 " + mode;
    blocked.sourceDuration = declaredTotalDuration > 0 ? declaredTotalDuration : total;
    blocked.sourceDurationAuthoritative = true;
    blocked.sourceFormat = isRef ? "official-ref2va" : "official-base";
    blocked.directorManifest = manifest;
    blocked.globalExtra = "";
    blocked.globalStyle = "";
    blocked.warnings = [...warnings, blocked.importError];
    return blocked;
  };

  let explicitShotBuckets = null;
  if (explicitSegmentPolicy) {
    if (explicitSegmentContractError) return blockedExplicitSegments(explicitSegmentContractError);
    if (!timelineValid) return blockedExplicitSegments("官方 Shot 时间轴无效，无法执行场次边界");
    const tolerance = 0.051;
    const timelineStart = shots[0].start;
    const timelineEnd = timelineStart + total;
    if (Math.abs(explicitSegmentBoundaries[0] - timelineStart) > tolerance) {
      return blockedExplicitSegments(`首个边界必须是 ${timelineStart.toFixed(3)} 秒`);
    }
    if (Math.abs(explicitSegmentBoundaries.at(-1) - timelineEnd) > tolerance) {
      return blockedExplicitSegments(`最后边界 ${explicitSegmentBoundaries.at(-1)} 秒与源总时长 ${timelineEnd.toFixed(3)} 秒不一致`);
    }
    if (declaredTotalDuration > 0 && Math.abs(explicitSegmentBoundaries.at(-1) - declaredTotalDuration) > tolerance) {
      return blockedExplicitSegments(`最后边界 ${explicitSegmentBoundaries.at(-1)} 秒与 manifest 总时长 ${declaredTotalDuration.toFixed(3)} 秒不一致`);
    }
    if (explicitSegmentBoundaries.some((value, index) => index > 0
        && value - explicitSegmentBoundaries[index - 1] > MAXGEN + tolerance)) {
      return blockedExplicitSegments(`单段不能超过 H3 原生上限 ${MAXGEN.toFixed(3)} 秒`);
    }
    explicitShotBuckets = [];
    let startIndex = 0;
    for (let boundaryIndex = 1; boundaryIndex < explicitSegmentBoundaries.length; boundaryIndex++) {
      const segmentStart = explicitSegmentBoundaries[boundaryIndex - 1];
      const segmentEnd = explicitSegmentBoundaries[boundaryIndex];
      let endIndex = shots.length;
      if (boundaryIndex < explicitSegmentBoundaries.length - 1) {
        endIndex = shots.findIndex((shot, shotIndex) => shotIndex >= startIndex
          && Math.abs(shot.start - segmentEnd) <= tolerance);
        if (endIndex < 0) {
          return blockedExplicitSegments(`${segmentEnd.toFixed(3)} 秒不是现有 Shot 起点；官方分镜必须在该场次边界开始新 Shot`);
        }
      }
      const bucket = shots.slice(startIndex, endIndex);
      if (!bucket.length) return blockedExplicitSegments(`${segmentStart.toFixed(3)}–${segmentEnd.toFixed(3)} 秒没有 Shot`);
      explicitShotBuckets.push({ shots: bucket, start: segmentStart, end: segmentEnd });
      startIndex = endIndex;
    }
  }

  /* 只在已有 Shot 边界处切段。原先的贪心算法在 30 秒、9 个微镜头这类
     时间轴中可能留下一个 2～3 秒的尾段；这里用动态规划优先消除少于 5 秒的
     段，其次才减少段数和提升均衡度。没有合法解时仍回退到旧贪心行为，绝不
     悄悄截断或拆开用户写好的一个 Shot。 */
  const greedyShotBuckets = () => {
    const buckets = [];
    let current = [];
    let currentStart = 0;
    for (const shot of shots) {
      const end = shot.start + shot.dur;
      if (current.length && end - currentStart > MAXGEN) {
        buckets.push(current);
        current = [];
      }
      if (!current.length) currentStart = shot.start;
      current.push(shot);
      if (shot.dur > MAXGEN) addWarning("存在单个 Shot 超过 15 秒，导入后需要手动拆镜。");
    }
    if (current.length) buckets.push(current);
    return buckets;
  };
  const selectBalancedShotBuckets = (preferredMinDuration = 5) => {
    const count = shots.length;
    const bestAt = new Array(count + 1).fill(null);
    bestAt[0] = { shortCount: 0, segmentCount: 0, minDuration: Infinity, sumSquares: 0, buckets: [] };
    const better = (candidate, current) => {
      if (!current) return true;
      if (candidate.shortCount !== current.shortCount) return candidate.shortCount < current.shortCount;
      if (candidate.segmentCount !== current.segmentCount) return candidate.segmentCount < current.segmentCount;
      if (Math.abs(candidate.minDuration - current.minDuration) > 0.001) return candidate.minDuration > current.minDuration;
      if (Math.abs(candidate.sumSquares - current.sumSquares) > 0.001) return candidate.sumSquares < current.sumSquares;
      return false;
    };
    for (let endIndex = 1; endIndex <= count; endIndex++) {
      for (let startIndex = 0; startIndex < endIndex; startIndex++) {
        const previous = bestAt[startIndex];
        if (!previous) continue;
        const bucketStart = shots[startIndex].start;
        const bucketEnd = shots[endIndex - 1].start + shots[endIndex - 1].dur;
        const duration = bucketEnd - bucketStart;
        if (!(duration > 0) || duration > MAXGEN + 0.001) continue;
        const renderedDuration = clampDur(duration);
        const candidate = {
          shortCount: previous.shortCount + (renderedDuration < preferredMinDuration - 0.01 ? 1 : 0),
          segmentCount: previous.segmentCount + 1,
          minDuration: Math.min(previous.minDuration, duration),
          sumSquares: previous.sumSquares + duration * duration,
          buckets: previous.buckets.concat([shots.slice(startIndex, endIndex)]),
        };
        if (better(candidate, bestAt[endIndex])) bestAt[endIndex] = candidate;
      }
    }
    return bestAt[count];
  };

  const segs = [];
  if (explicitShotBuckets) {
    for (let index = 0; index < explicitShotBuckets.length; index++) {
      const entry = explicitShotBuckets[index];
      const tailPlan = explicitTailPolicy[index] || "";
      segs.push({
        duration: clampDur(entry.end - entry.start),
        prompt: buildPrompt(recon(entry.shots, entry.start),
          explicitShotBuckets.length > 1 ? buildLocalizedSoundscape(entry.shots) : null),
        sourceStart: entry.start,
        sourceEnd: entry.end,
        sourceDurationRaw: entry.end - entry.start,
        plannedUseTail: tailPlan ? tailPlan === "on" : null,
        tailPlan,
        tailReason: explicitTailReasons[index] || "",
      });
    }
    addWarning(`已按显式场次边界保留 ${explicitShotBuckets.length} 个生成段。`);
  } else if (!shots.length || !(total > 0)) {
    segs.push({ duration: 0, prompt: buildPrompt(description) });
  } else if (total <= MAXGEN + 0.001) {
    segs.push({ duration: clampDur(total), prompt: buildPrompt(recon(shots, shots[0].start)) });
  } else {
    if (instruction) addWarning("关键帧对齐模板超过 15 秒，拆段后请检查各段 Picture 对齐时间");
    const greedyBuckets = greedyShotBuckets();
    const balanced = selectBalancedShotBuckets(5);
    const shortCount = (items) => items.reduce((count, bucket) => {
      const bucketStart = bucket[0].start;
      const bucketEnd = bucket[bucket.length - 1].start + bucket[bucket.length - 1].dur;
      return count + (clampDur(bucketEnd - bucketStart) < 5 - 0.01 ? 1 : 0);
    }, 0);
    const greedyShortCount = shortCount(greedyBuckets);
    const balancedShortCount = balanced && balanced.buckets ? shortCount(balanced.buckets) : Infinity;
    /* 只在确实消除短段时采用新切点；正常官方时间轴保持原有段边界、缓存与尾帧续接数量。 */
    /* 不因优化而增加模型任务数：只有在不增加段数且确实减少短段时才换切点。 */
    const buckets = balanced && balanced.buckets && balanced.buckets.length
      && balanced.segmentCount <= greedyBuckets.length
      && balancedShortCount < greedyShortCount
      ? balanced.buckets : greedyBuckets;
    if (buckets !== greedyBuckets) {
      addWarning("已按镜头边界重新平衡生成段，避免留下少于 5 秒的短尾段。");
    }
    for (const bucket of buckets) {
      const bucketStart = bucket[0].start;
      const bucketEnd = bucket[bucket.length - 1].start + bucket[bucket.length - 1].dur;
      segs.push({
        duration: clampDur(bucketEnd - bucketStart),
        prompt: buildPrompt(recon(bucket, bucketStart), buildLocalizedSoundscape(bucket)),
      });
    }
    addWarning("长时间轴已按生成段局部化 overall_soundscape，防止后段场景、动作和声音提前泄漏");
  }

  globalStyle = segs.length > 1 && isBase ? deriveSafeGlobalPrompt(segs) : "";
  segs.globalExtra = "";
  segs.globalStyle = globalStyle;
  segs.official = true;
  segs.officialFormat = isRef ? "ref2va" : "base";
  segs.officialMode = mode;
  segs.officialLabel = isRef ? "官方 Ref2VA" : "官方 " + mode;
  segs.sourceDuration = declaredTotalDuration > 0 ? declaredTotalDuration : total;
  segs.sourceDurationAuthoritative = true;
  segs.sourceFormat = isRef ? "official-ref2va" : "official-base";
  segs.directorManifest = manifest;
  const durationContract = evaluateDurationConservation(segs.sourceDuration, segs);
  if (!durationContract.ok) addWarning(`源时长 ${fmtSec(durationContract.sourceDuration)} 秒与导入时长 ${fmtSec(durationContract.importedDuration)} 秒不守恒`);
  segs.warnings = warnings;
  return segs;
}

/* 对于 AI 偶发漏掉 Base 首字段的可恢复情况，只做确定性的“补标签”：
   必须已经有完整音频字段和带精确源时长的导演台清单，绝不编造镜头、声音或时长。
   其余“看起来像官方模板”的不完整文本只在用户主动解析导入时报告真实格式错误。 */
function normalizeRecoverableBaseEnvelope(text) {
  let source = String(text || "").replace(/^\uFEFF/, "");
  source = source.replace(/^[ \t]*\x60{3}(?:text|txt|markdown)?[ \t]*$/gim, "").trim();
  const knownFields = [
    "subject_definitions", "summary", "retention_analysis", "detailed_description",
    "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music",
    "director_import_manifest",
  ];
  const fieldRe = new RegExp(`(?:^|\\n)[ \\t]*(${knownFields.join("|")})[ \\t]*[:：][ \\t]*`, "gi");
  const fieldMarks = [];
  let match;
  while ((match = fieldRe.exec(source))) {
    fieldMarks.push({
      name: match[1].toLowerCase(),
      start: match.index + (match[0].charAt(0) === "\n" ? 1 : 0),
      end: fieldRe.lastIndex,
    });
  }
  const names = fieldMarks.map((mark) => mark.name);
  const countOf = (name) => names.filter((candidate) => candidate === name).length;
  const fieldBody = (index) => source.slice(fieldMarks[index].end,
    index + 1 < fieldMarks.length ? fieldMarks[index + 1].start : source.length).trim();
  const bodyFor = (name) => {
    const index = names.indexOf(name);
    return index >= 0 && countOf(name) === 1 ? fieldBody(index) : "";
  };
  const hasOneNonEmpty = (name) => {
    const index = names.indexOf(name);
    return index >= 0 && countOf(name) === 1 && !!fieldBody(index);
  };
  const baseRequired = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  const refRequired = ["subject_definitions", "summary", "retention_analysis", "detailed_description",
    "overall_soundscape", "non_diegetic_music"];
  const refSignals = refRequired.slice(0, 4).some((name) => countOf(name) > 0);
  const baseHead = countOf("integrated_multimodal_description") > 0;
  const hasOfficialSignal = fieldMarks.length > 0;
  const inRequiredOrder = (required) => {
    const positions = required.map((name) => names.indexOf(name));
    return positions.every((position) => position >= 0)
      && positions.every((position, index) => index === 0 || position > positions[index - 1]);
  };
  const manifestIndex = names.indexOf("director_import_manifest");
  const manifestIsLast = manifestIndex < 0 || manifestIndex === names.length - 1;
  const isCompleteBase = !refSignals && baseRequired.every(hasOneNonEmpty)
    && inRequiredOrder(baseRequired) && manifestIsLast;
  const isCompleteRef = !baseHead && refRequired.every(hasOneNonEmpty)
    && inRequiredOrder(refRequired) && manifestIsLast;
  const durationMatch = source.match(/(?:source_total_duration_seconds|target_total_duration_seconds|源总时长秒|目标总时长秒)\s*[:：=]\s*(\d+(?:\.\d+)?)/i);
  const sourceDuration = durationMatch ? Number(durationMatch[1]) || 0 : 0;
  const validateShotRegion = (value) => {
    const shotRegion = String(value || "").trim();
    const shotRe = /\[Shot\s+(\d+)\s*\]/gi;
    const shotMarks = [];
    let shotMatch;
    while ((shotMatch = shotRe.exec(shotRegion))) {
      shotMarks.push({ num: Number(shotMatch[1]), idx: shotMatch.index, end: shotRe.lastIndex });
    }
    let valid = shotMarks.length > 0 && shotRegion.startsWith("[Shot 1]");
    let previousStart = -1;
    for (let index = 0; valid && index < shotMarks.length; index++) {
      const mark = shotMarks[index];
      const bodyEnd = index + 1 < shotMarks.length ? shotMarks[index + 1].idx : shotRegion.length;
      const prefix = parseOfficialShotPrefix(shotRegion.slice(mark.end, bodyEnd).trim());
      if (mark.num !== index + 1 || (index === 0 ? prefix.hadAt : !prefix.hadAt)
          || (index > 0 && (!Number.isFinite(prefix.start) || prefix.start <= previousStart))) {
        valid = false;
        break;
      }
      previousStart = index === 0 ? 0 : prefix.start;
    }
    return { valid, previousStart, shotCount: shotMarks.length };
  };
  const fieldStart = fieldMarks.length ? fieldMarks[0].start : source.length;
  const headerlessTimeline = validateShotRegion(source.slice(0, fieldStart));

  /* 最严格的可恢复分支：无 Base 首字段、无 Ref 字段，且其余三个字段、顺序、时长和时间轴均完整。 */
  const headerlessBase = !baseHead && !refSignals
    && names.length === 3
    && names.join("|") === "overall_soundscape|non_diegetic_music|director_import_manifest"
    && ["overall_soundscape", "non_diegetic_music", "director_import_manifest"].every(hasOneNonEmpty)
    && headerlessTimeline.valid && sourceDuration > headerlessTimeline.previousStart + 0.001;
  if (headerlessBase) {
    return {
      text: "integrated_multimodal_description:\n" + source,
      repaired: true,
      repairKind: "base_header",
      repairedFields: ["integrated_multimodal_description"],
      importBlocked: false,
      importError: "",
    };
  }

  /* AI 常见可恢复错误：镜头正文和时间轴完整，只漏了一个或两个声音字段。
     声音字段只能补安全契约，绝不编造剧情、镜头或时长；Ref2VA 主体字段、重复字段、
     普通 Director 分段文本和无法识别的 Shot 时间轴仍继续阻断。 */
  const integratedBody = bodyFor("integrated_multimodal_description");
  const integratedTimeline = validateShotRegion(integratedBody);
  const duplicateKnownField = names.some((name) => countOf(name) > 1);
  const missingSoundFields = ["overall_soundscape", "non_diegetic_music"]
    .filter((name) => !hasOneNonEmpty(name));
  const recoverableMissingBaseSounds = !refSignals && countOf("integrated_multimodal_description") === 1
    && !!integratedBody && integratedTimeline.valid && !duplicateKnownField && manifestIsLast
    && missingSoundFields.length > 0
    && missingSoundFields.every((name) => name === "overall_soundscape" || name === "non_diegetic_music");
  if (recoverableMissingBaseSounds) {
    const hasExactDialogue = /<d>\s*\[[^\]]+\][\s\S]*?<\/d>/i.test(integratedBody);
    const soundscape = bodyFor("overall_soundscape") || (hasExactDialogue
      ? "全片仅保留各 Shot 中可见环境、材质、脚步、接触、受力、按钮和场景动作同步音效；仅允许对应 Shot 中已经写明的 <d> 精确台词，除此之外不新增对白、旁白、歌词、广播、耳语、咕哝或伪语言。"
      : "全片仅保留各 Shot 中可见环境、材质、脚步、接触、受力、按钮和场景动作同步音效；未明确提供的对白、旁白、歌词、广播、耳语、咕哝和伪语言均不生成。角色不做说话口型。");
    const music = bodyFor("non_diegetic_music") || "N/A";
    const manifest = bodyFor("director_import_manifest");
    const rebuilt = [
      "integrated_multimodal_description:\n" + integratedBody,
      "overall_soundscape:\n" + soundscape,
      "non_diegetic_music:\n" + music,
      manifest ? "director_import_manifest:\n" + manifest : "",
    ].filter(Boolean).join("\n\n");
    return {
      text: rebuilt,
      repaired: true,
      repairKind: "base_sound_fields",
      repairedFields: missingSoundFields,
      importBlocked: false,
      importError: "",
    };
  }

  if (!hasOfficialSignal || isCompleteBase || isCompleteRef) {
    return { text: source, repaired: false, importBlocked: false, importError: "" };
  }

  const required = refSignals ? refRequired : baseRequired;
  const missing = required.filter((name) => !hasOneNonEmpty(name));
  if (!manifestIsLast) missing.push("director_import_manifest 必须位于最后");
  const type = refSignals ? "Ref2VA 六字段" : "Base 三字段";
  return {
    text: source,
    repaired: false,
    importBlocked: true,
    importError: "检测到不完整的 H3 官方 " + type + "："
      + (missing.length ? "缺少或留空 " + missing.join("、") + "。" : "字段顺序或重复字段不正确。")
      + "为避免把不完整模板误导入，已阻止导入；请重新生成完整官方分镜。",
  };
}

/* v2.13.5：官方 integrated_multimodal_description 格式直导（整段连写、[Shot N] 在行中，
   逐行解析器认不出来，所以独立整串解析，优先于逐行解析）。
   识别特征：含 "integrated_multimodal_description:" 标签；或 ≥2 个 [Shot N] 标记且带绝对 At 时间。
   规则：
   - 按 [Shot N] 切镜；"At HH:MM:SS.mmm" 是该镜绝对起点，本镜时长 = 下一镜起点 - 本镜起点
   - 自动清理 Shot 1 时间范围、At + 重复起止范围，并统一重建为单一官方时间轴
   - overall_soundscape / non_diegetic_music 不丢：拼成 Soundscape:/Music: 挂返回值 .globalExtra，
     由调用方并入全局提示词框（这两个是整片级描述，属于全局不属于某一镜）
   - 全局提示词只从所有生成段提取安全共享身份/风格/限制，首段场景和构图永不自动全局化
   返回段数组（附 .globalExtra/.globalStyle/.official），不是官方格式返回 null。 */
function parseOfficialScript(text) {
  const envelope = normalizeRecoverableBaseEnvelope(text);
  if (envelope.importBlocked) {
    const blocked = [];
    blocked.importBlocked = true;
    blocked.importError = envelope.importError;
    blocked.fatalIssues = [{ code: "official_incomplete_template", message: envelope.importError }];
    blocked.warnings = [envelope.importError];
    blocked.officialLabel = "不完整 H3 官方模板";
    return blocked;
  }
  const structured = parseStructuredOfficialScript(envelope.text);
  if (structured) {
    if (envelope.repaired) {
      structured.normalizedSource = envelope.text;
      structured.normalizedFromRecoveredBase = true;
      structured.normalizedFromHeaderlessBase = envelope.repairKind === "base_header";
      structured.repairKind = envelope.repairKind || "";
      structured.repairedFields = Array.isArray(envelope.repairedFields)
        ? [...envelope.repairedFields] : [];
      const repairInfo = envelope.repairKind === "base_sound_fields"
        ? `已在本地安全补齐 ${String(envelope.repairedFields || []).replace(/,/g, "、")}；镜头正文、时间轴和已有字段保持不变。`
        : "已自动补齐 integrated_multimodal_description:；其余 Shot、声音与源时长清单保持不变。";
      structured.infos = [...new Set([
        repairInfo,
        ...(structured.infos || []),
      ])];
    }
    return structured;
  }

  const t = envelope.text;
  const shotRe = /\[Shot\s+(\d+)\s*\]/gi;
  const marks = [];
  let m;
  while ((m = shotRe.exec(t))) marks.push({ idx: m.index, end: m.index + m[0].length });
  const hasLabel = /integrated_multimodal_description\s*[:：]/i.test(t);
  if (!hasLabel && !(marks.length >= 2 && /At\s+\d{1,3}:\d{2}/.test(t))) return null;
  if (!marks.length) return null;

  /* 两个整片级声音字段（可能缺省、顺序任意）：正文 = 字段标签后 → 下一个字段标签前 */
  const sndM = t.match(/overall_soundscape\s*[:：]/i);
  const musM = t.match(/non_diegetic_music\s*[:：]/i);
  const fieldText = (mm, other) => {
    if (!mm) return "";
    let e = t.length;
    if (other && other.index > mm.index) e = other.index;
    return t.slice(mm.index + mm[0].length, e).trim();
  };
  const sndTxt = fieldText(sndM, musM);
  const musTxt = fieldText(musM, sndM);

  /* 镜头区右边界：声音字段开始前（防止末镜把 soundscape 正文吃进来） */
  let regionEnd = t.length;
  for (const mm of [sndM, musM]) if (mm && mm.index > marks[0].idx) regionEnd = Math.min(regionEnd, mm.index);

  const shots = [];
  const warnings = [];
  for (let i = 0; i < marks.length; i++) {
    const to = (i + 1 < marks.length) ? marks[i + 1].idx : regionEnd;
    let body = t.slice(marks[i].end, to).trim();
    const prefix = parseOfficialShotPrefix(body);
    let start = prefix.start;
    body = prefix.body;
    if (prefix.hadRange) warnings.push("已把 Shot " + (i + 1) + " 的重复起止范围规范化为单一 At 时间轴");
    if (prefix.hadAt && i === 0) warnings.push("已移除 Shot 1 多余的 At 时间标记");
    if (body) body = body.charAt(0).toUpperCase() + body.slice(1);
    shots.push({ start, rangeEnd: prefix.rangeEnd, body });
  }
  if (!shots.length) return null;
  if (shots[0].start == null) shots[0].start = 0;

  /* 每镜时长 = 下一镜起点 - 本镜起点；末镜/缺时间戳沿用上一镜。先算出每镜 start/dur。 */
  let lastRaw = 0;
  for (let i = 0; i < shots.length; i++) {
    let d = 0;
    if (shots[i].start != null) {
      for (let j = i + 1; j < shots.length; j++) {
        if (shots[j].start != null) { d = shots[j].start - shots[i].start; break; }
      }
    }
    if (!(d > 0) && Number.isFinite(shots[i].rangeEnd) && Number.isFinite(shots[i].start)
        && shots[i].rangeEnd > shots[i].start) d = shots[i].rangeEnd - shots[i].start;
    if (!(d > 0)) d = lastRaw;
    if (d > 0) lastRaw = d;
    shots[i].dur = d > 0 ? d : 0;
  }
  const total = shots.length ? shots[shots.length - 1].start + shots[shots.length - 1].dur : 0;

  /* v2.13.8：H3 单次可原生生成 ≤15s，官方格式内部就用 [Shot N] At mm:ss 排子镜头时间轴——
     所以 ≤15s 的片子不再按 Shot 拆成多段（多次生成易断连），而是合并成「一段=一次生成」，
     段提示词保留 [Shot N] At 结构让 H3 自己卡内部节奏；>15s 才按贪心把连续 Shot 装进 ≤15s 生成桶，
     桶内 Shot 重新相对桶起点计时（每次生成都从 0s 起）。 */
  const MAXGEN = 362 / 24;   // 15.083s，H3 单次原生上限（VAE 对齐最高档）
  const fmtTs = (sec) => {
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const hh = Math.floor(totalMs / 3600000);
    const afterHours = totalMs - hh * 3600000;
    const mm = Math.floor(afterHours / 60000);
    const rem = afterHours - mm * 60000;
    const ss = Math.floor(rem / 1000);
    const ms = rem - ss * 1000;
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":"
      + String(ss).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  };
  const recon = (bucket, bStart) => bucket.map((sh, k) => {
    const rel = sh.start - bStart;
    return (k === 0 && rel < 0.05)
      ? "[Shot " + (k + 1) + "] " + sh.body
      : "[Shot " + (k + 1) + "] At " + fmtTs(rel) + ", " + sh.body;
  }).join(" ");

  /* 单段（≤15s 一次生成）：把音效/配乐也并进段提示词，让这一段成为完整自包含的官方提示词，
     不依赖全局框开关；多段（>15s）才交给全局框共享。 */
  const sndSuffix = (sndTxt ? "\n\noverall_soundscape: " + sndTxt : "") + (musTxt ? "\n\nnon_diegetic_music: " + musTxt : "");
  const segs = [];
  if (total > 0 && total <= MAXGEN + 0.001) {
    segs.push({ duration: clampDur(total), prompt: recon(shots, shots[0].start) + sndSuffix });
  } else if (total > 0) {
    const buckets = [];
    let cur = [], curStart = 0;
    for (const sh of shots) {
      const end = sh.start + sh.dur;
      if (cur.length && (end - curStart) > MAXGEN) { buckets.push(cur); cur = []; }
      if (!cur.length) curStart = sh.start;
      cur.push(sh);
    }
    if (cur.length) buckets.push(cur);
    for (const b of buckets) {
      const bStart = b[0].start, bEnd = b[b.length - 1].start + b[b.length - 1].dur;
      segs.push({ duration: clampDur(bEnd - bStart), prompt: recon(b, bStart) });
    }
  }
  if (!segs.length && shots.length) segs.push({ duration: 0, prompt: recon(shots, shots[0].start) + sndSuffix });

  const single = segs.length <= 1;
  const gp = [];
  if (sndTxt) gp.push("Soundscape: " + sndTxt);
  if (musTxt) gp.push("Music: " + musTxt);
  /* 单段（≤15s 一次生成）：风格句 + 音效/配乐都已并入段提示词（完整自包含官方文本），全局框不再重复；
     多段（>15s 分桶）：风格 + 音效/配乐放全局框，各生成桶通过全局注入共享（桶2+ 段内没有）。 */
  segs.globalExtra = single ? "" : gp.join("\n\n");
  segs.globalStyle = single ? "" : deriveSafeGlobalPrompt(segs);
  /* 未带完整字段的旧 Shot 时间线可继续作为普通文本使用，但绝不能冒充官方 Base。 */
  segs.official = false;
  segs.officialFormat = "";
  segs.officialMode = "";
  segs.officialLabel = "旧版 Shot 时间线（非官方模板）";
  segs.sourceDuration = total;
  segs.templateError = "";
  segs.warnings = [...new Set(warnings)];
  return segs;
}

/* v2.13.9：无时间标记的长文案 → 按"朗读时长"智能分段（每段 8~15 秒，标准语速 4.5 字/秒，
   与台词时长建议同套估算：CJK 1 字 = 1 单位，拉丁词 = 2.5 单位）。
   断点优先级：段落换行 > 句末标点（。！？；…!.?）> 从句标点（，、：）——优先断在完整
   情节/镜头边界，绝不在句中硬断（仅对无标点超长句按字数兜底硬切）。
   返回 [{duration, prompt}]，duration 已吸附 VAE 档位。 */
function autoSplitByDuration(text, minDur = 8, maxDur = 15, target = 12) {
  const RATE = 4.5;   // 标准语速（字/秒）
  const durOf = (t) => {
    const cjk = (t.match(/[一-鿿　-〿＀-￦]/g) || []).length;
    const latin = (t.replace(/[一-鿿　-〿＀-￦]/g, " ").match(/[A-Za-z0-9]+/g) || []).length;
    return (cjk + latin * 2.5) / RATE + 0.2;   // 句末换气 0.2s
  };
  // 1) 切单元：{text, para}，para=true 表示它前面是段落边界
  const units = [];
  const hardSplit = (sentence, para) => {
    const clauses = sentence.match(/[^，、：,;:]+[，、：,;:]?/g) || [sentence];
    let buf = "", first = para;
    for (const c of clauses) {
      if (buf && durOf(buf + c) > maxDur) { units.push({ text: buf, para: first }); buf = c; first = false; }
      else buf += c;
    }
    while (buf && durOf(buf) > maxDur) {   // 无标点长句兜底：按字数硬切
      const n = Math.max(1, Math.floor((maxDur - 0.2) * RATE));
      units.push({ text: buf.slice(0, n), para: first }); first = false;
      buf = buf.slice(n);
    }
    if (buf.trim()) units.push({ text: buf, para: first });
  };
  for (const para of String(text).split(/\r?\n+/)) {
    const p = para.trim();
    if (!p) continue;
    // 句末标点：中文全角 。！？；… + 英文 .!?（英文句点需后跟空格/行尾，避免误切小数点）
    const sents = p.match(/[^。！？；…!?]*?(?:[。！？；…!?]+|\.(?=\s|$)|$)/g) || [p];
    let first = true;
    for (const s of sents) {
      if (!s.trim()) continue;
      if (durOf(s) > maxDur) hardSplit(s, first);
      else units.push({ text: s, para: first });
      first = false;
    }
  }
  // 2) 贪心打包：满 minDur 后，到 target / 再加会超 maxDur / 遇段落边界 → 断。
  //    硬顶 maxDur+1.2s 宽容值：即使未满 minDur，超过硬顶也断（防极端溢出被 clamp 吞掉文案时长）
  const segs = [];
  let cur = [], curDur = 0;
  const flush = () => {
    if (!cur.length) return;
    segs.push({ duration: clampDur(Math.min(15, Math.max(1.6, curDur))), prompt: cur.join("").trim() });
    cur = []; curDur = 0;
  };
  for (const u of units) {
    const d = durOf(u.text);
    const would = curDur + d;
    if (cur.length && ((curDur >= minDur && (would > maxDur || curDur >= target || u.para)) || would > maxDur + 1.2)) flush();
    cur.push(u.text); curDur += d;
  }
  flush();
  return segs.filter((s) => s.prompt);
}

function blockedStructuredMarkdown(message, warnings = []) {
  const blocked = [];
  blocked.importBlocked = true;
  blocked.importError = message;
  blocked.official = false;
  blocked.officialFormat = "";
  blocked.officialMode = "";
  blocked.officialLabel = "结构化 Markdown 剧本";
  blocked.sourceFormat = "structured-markdown-screenplay";
  blocked.globalExtra = "";
  blocked.globalStyle = "";
  blocked.warnings = warnings;
  return blocked;
}

function parseMarkdownClock(value) {
  const parts = String(value || "").trim().split(":").map(Number);
  if (parts.length !== 2 && parts.length !== 3) return null;
  const seconds = parts.pop();
  const minutes = parts.pop();
  const hours = parts.length ? parts.pop() : 0;
  if (![hours, minutes, seconds].every(Number.isFinite)
      || hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

/* Markdown 制作档案只把“正式剧本”章节作为权威剧情；镜头制作表、资产锚点、
   配音和声音设计都是辅助资料，绝不能再次进入普通长文拆分器。 */
function parseStructuredMarkdownScript(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/);
  const formalStartRe = /^\s{0,3}#{1,3}\s*正式剧本(?:\s*[:：].*)?\s*$/i;
  const productionTableRe = /^\s{0,3}#{1,3}\s*(?:\d+\s*)?镜头制作表(?:\s*.*)?$/i;
  const nextLevelTwoRe = /^\s{0,3}##(?!#)\s+\S/;
  const sceneCueRe = /^\s{0,3}###(?!#)\s*(场景[^\r\n]*)$/i;
  const shotCueRe = /^\s{0,3}#{1,6}\s*(?:第\s*)?(?:镜头|镜|shot|scene)\s*(\d+)\s*(.*)$/i;
  const formalStart = lines.findIndex((line) => formalStartRe.test(line));
  const anyMarkdownShot = lines.some((line) => shotCueRe.test(line));
  if (formalStart < 0 && !anyMarkdownShot) return null;

  let scopeStart = 0;
  let scopeEnd = lines.length;
  if (formalStart >= 0) {
    scopeStart = formalStart + 1;
    /* 优先采用正式剧本后的下一个二级章节；没有后续章节时安全读取到 EOF。
       万愿灯会自然停在“## 18 镜头制作表”，简版 Markdown 也不会被误拒。 */
    const relativeEnd = lines.slice(scopeStart).findIndex((line) => nextLevelTwoRe.test(line));
    if (relativeEnd >= 0) scopeEnd = scopeStart + relativeEnd;
  } else {
    const firstShot = lines.findIndex((line) => shotCueRe.test(line));
    const relativeEnd = lines.slice(Math.max(0, firstShot + 1)).findIndex((line) => productionTableRe.test(line));
    if (relativeEnd >= 0) scopeEnd = firstShot + 1 + relativeEnd;
  }

  const clockToken = String.raw`(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?`;
  const rangeRe = new RegExp(String.raw`(?:正片(?:时间)?\s*)?(${clockToken})\s*[-—–~～至到]\s*(${clockToken})`, "i");
  const marks = [];
  const errors = [];
  let currentScene = "";
  for (let index = scopeStart; index < scopeEnd; index++) {
    const sceneCue = lines[index].match(sceneCueRe);
    if (sceneCue) {
      currentScene = String(sceneCue[1] || "").replace(/^[\s　:：]+|[\s　:：]+$/g, "").trim();
      continue;
    }
    const cue = lines[index].match(shotCueRe);
    if (!cue) continue;
    const tail = String(cue[2] || "");
    const range = tail.match(rangeRe);
    if (!range) {
      errors.push(`第 ${index + 1} 行“镜头 ${cue[1]}”缺少 MM:SS—MM:SS 时间区间`);
      continue;
    }
    const start = parseMarkdownClock(range[1]);
    const end = parseMarkdownClock(range[2]);
    if (!(start >= 0) || !(end > start)) {
      errors.push(`第 ${index + 1} 行“镜头 ${cue[1]}”时间区间无效：${range[1]}—${range[2]}`);
      continue;
    }
    const title = (tail.slice(0, range.index) + " " + tail.slice((range.index || 0) + range[0].length))
      .replace(/\b正片(?:时间)?\b/gi, " ").replace(/^[\s　:：—–-]+|[\s　:：—–-]+$/g, "").trim();
    marks.push({ number: Number(cue[1]), start, end, title, scene: currentScene, line: index });
  }
  if (errors.length) return blockedStructuredMarkdown("结构化 Markdown 镜头解析失败：" + errors.slice(0, 4).join("；"));
  if (!marks.length) {
    return blockedStructuredMarkdown("检测到结构化 Markdown 剧本线索，但正式剧本章节中没有可解析的带时间镜头。");
  }

  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    const previous = marks[index - 1];
    if (!previous && mark.number !== 1) {
      errors.push(`正式剧本必须从镜头 1 开始，当前首镜头为 ${mark.number}`);
    }
    if (previous && mark.number !== previous.number + 1) {
      errors.push(`镜头编号不连续：镜头 ${previous.number} 后应为镜头 ${previous.number + 1}，当前为镜头 ${mark.number}`);
    }
    if (previous && Math.abs(mark.start - previous.end) > 0.051) {
      errors.push(`镜头 ${previous.number} 结束于 ${previous.end.toFixed(3)} 秒，但镜头 ${mark.number} 从 ${mark.start.toFixed(3)} 秒开始`);
    }
  }
  if (errors.length) return blockedStructuredMarkdown("结构化 Markdown 时间轴不连续：" + errors.slice(0, 4).join("；"));

  const segments = [];
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    const nextShotLine = index + 1 < marks.length ? marks[index + 1].line : scopeEnd;
    let bodyEnd = nextShotLine;
    for (let lineIndex = mark.line + 1; lineIndex < nextShotLine; lineIndex++) {
      if (sceneCueRe.test(lines[lineIndex])) { bodyEnd = lineIndex; break; }
    }
    const body = lines.slice(mark.line + 1, bodyEnd).join("\n")
      .replace(/(?:\r?\n)?\s*---\s*$/g, "").trim();
    const scenePrefix = mark.scene
      ? "场景：" + mark.scene.replace(/^场景(?:[一二三四五六七八九十百\d]+)?\s*[:：]?\s*/i, "") : "";
    const prompt = [scenePrefix, mark.title, body].filter(Boolean).join("\n").trim();
    if (!prompt) errors.push(`镜头 ${mark.number} 没有正文`);
    segments.push({
      duration: clampDur(mark.end - mark.start),
      prompt,
      sourceStart: mark.start,
      sourceEnd: mark.end,
      sourceDurationRaw: mark.end - mark.start,
      sourceShotNumber: mark.number,
    });
  }
  if (errors.length) return blockedStructuredMarkdown("结构化 Markdown 镜头解析失败：" + errors.join("；"));
  const firstStart = marks[0].start;
  const finalEnd = marks[marks.length - 1].end;
  segments.sourceDuration = finalEnd - firstStart;
  segments.sourceDurationAuthoritative = true;
  segments.globalExtra = "";
  segments.globalStyle = "";
  segments.official = false;
  segments.officialFormat = "";
  segments.officialMode = "";
  segments.officialLabel = "结构化 Markdown 剧本";
  segments.sourceFormat = "structured-markdown-screenplay";
  segments.structuredMarkdown = true;
  const aspectSource = formalStart >= 0
    ? [...lines.slice(0, formalStart), ...lines.slice(scopeStart, scopeEnd)].join("\n")
    : lines.slice(0, scopeEnd).join("\n");
  const aspectContract = detectAspectRatioContract(aspectSource);
  if (!aspectContract.ambiguous && aspectContract.orientation) {
    segments.sourceAspectContract = aspectContract.targetRatio > 0
      ? (aspectContract.orientation === "portrait" ? "9:16" : "16:9")
      : aspectContract.orientation;
  }
  segments.warnings = firstStart > 0.001
    ? [`正式剧本从 ${firstStart.toFixed(3)} 秒开始；导入时长按首尾连续区间计算`] : [];
  return segments;
}

function stripProjectWideTimingDirectives(prompt, segmentDuration) {
  const text = String(prompt || "");
  const totalDurationRe = /(?:目标|计划|要求|成片|视频|全片|故事|剧本)?\s*(?:总)?时长\s*[:：为是]?\s*(\d+(?:\.\d+)?)\s*秒/i;
  const declared = text.match(totalDurationRe);
  if (!declared || Number(declared[1]) <= Number(segmentDuration || 0) + 0.75) return text.trim();
  const lines = text.split(/\r?\n/);
  const output = [];
  let inContract = false;
  for (const line of lines) {
    if (totalDurationRe.test(line)) {
      const remainder = line.replace(totalDurationRe, "").replace(/^[\s　,，;；:：—–-]+/, "").trim();
      if (remainder) output.push(remainder);
      continue;
    }
    if (/^\s*(?:[-*]\s*)?硬时间与风格约束\s*[:：]?\s*$/i.test(line)) { inContract = true; continue; }
    if (inContract && /^\s*(?:[-*]\s*)?(?:\d+(?:\.\d+)?\s*(?:秒|s)?|(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\s*[-—–~～至到]/i.test(line)) continue;
    if (inContract && !line.trim()) continue;
    inContract = false;
    output.push(line);
  }
  return output.join("\n").trim();
}

function finalizeOrdinarySegments(segments) {
  const cleaned = [];
  for (const segment of segments || []) {
    const prompt = stripProjectWideTimingDirectives(segment.prompt, segment.duration);
    if (prompt) cleaned.push({ ...segment, prompt });
  }
  return cleaned;
}

/* ---- 分镜脚本解析（v2.11 文本界面）----
   把"带时间标记的文本"拆成段：每识别到一个行首时间标记就开新段，
   时长=标记里的时间（区间取差值），提示词=标记后的正文（可跨行）。
   支持三类写法（官方 Shot 格式优先，余下两类混用时以「段N」类标记优先切分）：
   0. 官方格式：integrated_multimodal_description: [Shot 1] … [Shot 2] At 00:00:03.000, …（整段连写）
   A. 段标记：段1（6秒）：… / 第2段 8s / 镜头3：…（无时间则看正文里的时间轴标签）
   B. 区间标记：[0s-6.6s] … / 0:00-0:06 … / 0至6秒：… / 6.6秒 | …
   C. 整篇无标记（v2.13.9）：按朗读时长自动分段，每段 8~15 秒，断在句/段边界 */
/* AI 故事输出的“场次”是一个 Director 生成段内部的剧情节拍，不等于多个生成任务。
   有明确目标总时长和连续场次时间时，优先按场次边界装入不超过 H3 原生上限的生成桶；
   场次内部绝不再次拆分，也绝不退回按字符数估算时长。 */
function parseTimedSceneScript(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  const totalMatch = source.match(/(?:^|\n)\s*目标总时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*秒\s*(?:\n|$)/i);
  if (!totalMatch) return null;
  const total = Number(totalMatch[1]);
  if (!(total > 0)) return null;
  const lines = source.split(/\r?\n/);
  const sceneHeaderRe = /^\s*(?:场次\s*(\d+)|场次编号\s*[:：]\s*(\d+))\s*$/i;
  const rangeRe = /^\s*场次起止时间\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒)?\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)\s*秒\s*$/i;
  const scenes = [];
  const preamble = [];
  let current = null;
  for (const line of lines) {
    const header = line.match(sceneHeaderRe);
    if (header) {
      if (current) scenes.push(current);
      current = { number: Number(header[1] || header[2]), lines: [line], start: NaN, end: NaN };
      continue;
    }
    if (!current) { preamble.push(line); continue; }
    current.lines.push(line);
    const range = line.match(rangeRe);
    if (range) {
      current.start = Number(range[1]);
      current.end = Number(range[2]);
    }
  }
  if (current) scenes.push(current);
  if (!scenes.length) return null;
  const blocked = (message) => {
    const result = [];
    result.importBlocked = true;
    result.importError = "场次剧本时间轴无效：" + message;
    result.sourceDuration = total;
    result.sourceDurationAuthoritative = true;
    result.sourceFormat = "timed-scene-script";
    result.official = false;
    result.officialLabel = "中文场次剧本（非官方模板）";
    result.warnings = [result.importError];
    return result;
  };
  const tolerance = 0.051;
  if (scenes.some((scene) => !(Number.isFinite(scene.start) && Number.isFinite(scene.end) && scene.end > scene.start))) {
    return blocked("每个场次都必须有有效的“场次起止时间：A–B秒”");
  }
  if (Math.abs(scenes[0].start) > tolerance) return blocked("第一个场次必须从 0.000 秒开始");
  for (let index = 1; index < scenes.length; index++) {
    if (Math.abs(scenes[index].start - scenes[index - 1].end) > tolerance) {
      return blocked(`场次${scenes[index - 1].number}与场次${scenes[index].number}之间存在断档或重叠`);
    }
  }
  if (Math.abs(scenes.at(-1).end - total) > tolerance) {
    return blocked(`最后场次结束于 ${scenes.at(-1).end.toFixed(3)} 秒，与目标 ${total.toFixed(3)} 秒不一致`);
  }
  const maxGeneration = 362 / 24;
  if (scenes.some((scene) => scene.end - scene.start > maxGeneration + tolerance)) {
    return blocked("单个场次超过 H3 单次原生上限；请在真实剧情边界上重新划分场次，不能拆场次内部动作");
  }
  const buckets = [];
  let bucket = [];
  let bucketStart = 0;
  for (const scene of scenes) {
    if (bucket.length && scene.end - bucketStart > maxGeneration + tolerance) {
      buckets.push(bucket);
      bucket = [];
    }
    if (!bucket.length) bucketStart = scene.start;
    bucket.push(scene);
  }
  if (bucket.length) buckets.push(bucket);
  const sharedPreamble = preamble.join("\n").trim();
  const segments = buckets.map((items) => {
    const start = items[0].start;
    const end = items.at(-1).end;
    if (buckets.length === 1) return { duration: clampDur(total), prompt: source };
    const localScenes = items.map((scene) => scene.lines.map((line) => {
      const range = line.match(rangeRe);
      if (!range) return line;
      return `场次起止时间：${(scene.start - start).toFixed(3)}–${(scene.end - start).toFixed(3)}秒（全片绝对 ${scene.start.toFixed(3)}–${scene.end.toFixed(3)}秒）`;
    }).join("\n")).join("\n\n");
    const context = sharedPreamble.replace(totalMatch[0].trim(), `全片目标总时长：${total}秒`);
    return {
      duration: clampDur(end - start),
      prompt: `[Director生成段：全片绝对 ${start.toFixed(3)}–${end.toFixed(3)}秒；本段内部从0秒开始]\n${context}\n\n${localScenes}`.trim(),
    };
  });
  segments.sourceDuration = total;
  segments.sourceDurationAuthoritative = true;
  segments.sourceFormat = "timed-scene-script";
  segments.official = false;
  segments.officialFormat = "";
  segments.officialLabel = "中文场次剧本（非官方模板）";
  segments.globalStyle = deriveSafeGlobalPrompt(segments);
  segments.globalExtra = "";
  segments.warnings = [];
  return segments;
}

/* “分镜1: \"0s-2s: ...\"”是普通中文分镜稿，不是官方 H3 模板，但时间码是
   权威信息。按完整分镜边界装入 H3 原生时长桶，不能再按文字长度估时。 */
function parseInlineChineseStoryboard(text) {
  const source = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!source) return null;
  const lines = source.split(/\r?\n/);
  const markerRe = /^\s*(?:分镜\s*(\d+)|第\s*(\d+)\s*分镜|镜头\s*(\d+)|第\s*(\d+)\s*镜头)\s*[:：]?\s*(.*)$/i;
  const rangeRe = /^\s*(["“‘]?)\s*[\[（(]?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:[-–—~～]|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[\]）)]?\s*[:：]\s*(.*)$/i;
  const markers = lines.map((line) => line.match(markerRe)).filter(Boolean);
  if (!markers.some((marker) => rangeRe.test(marker[5] || ""))) return null;

  const blocked = (message) => {
    const result = [];
    result.importBlocked = true;
    result.importError = "中文内联分镜时间轴无效：" + message;
    result.sourceDurationAuthoritative = true;
    result.sourceFormat = "timed-inline-storyboard";
    result.official = false;
    result.officialFormat = "";
    result.officialMode = "";
    result.officialLabel = "中文内联分镜时间轴（非官方模板）";
    result.globalExtra = "";
    result.globalStyle = "";
    result.warnings = [result.importError];
    return result;
  };
  const closingQuote = { '"': '"', "“": "”", "‘": "’" };
  const shots = [];
  const errors = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    let body = current.lines.join("\n").trim();
    const closing = closingQuote[current.openingQuote];
    if (closing && body.endsWith(closing)) body = body.slice(0, -closing.length).trimEnd();
    current.body = body;
    delete current.lines;
    delete current.openingQuote;
    shots.push(current);
    current = null;
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const marker = lines[lineIndex].match(markerRe);
    if (marker) {
      flush();
      const number = Number(marker[1] || marker[2] || marker[3] || marker[4]);
      const range = String(marker[5] || "").match(rangeRe);
      if (!range) {
        errors.push(`第 ${lineIndex + 1} 行“分镜${number}”缺少 0s-2s 形式的绝对时间区间`);
        continue;
      }
      current = {
        number,
        start: Number(range[2]),
        end: Number(range[3]),
        openingQuote: range[1],
        lines: [range[4] || ""],
      };
    } else if (current) {
      current.lines.push(lines[lineIndex]);
    }
  }
  flush();
  if (errors.length) return blocked(errors.slice(0, 4).join("；"));
  if (!shots.length) return null;

  const tolerance = 0.051;
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const previous = shots[index - 1];
    if (!(Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.end > shot.start)) {
      errors.push(`分镜${shot.number}的时间区间无效`);
    }
    if (!previous && shot.number !== 1) errors.push(`分镜必须从 1 开始，当前首段为分镜${shot.number}`);
    if (previous && shot.number !== previous.number + 1) {
      errors.push(`分镜编号不连续：分镜${previous.number}后应为分镜${previous.number + 1}`);
    }
    if (previous && Math.abs(shot.start - previous.end) > tolerance) {
      errors.push(`分镜${previous.number}结束于${previous.end.toFixed(3)}秒，但分镜${shot.number}从${shot.start.toFixed(3)}秒开始`);
    }
    if (!shot.body) errors.push(`分镜${shot.number}没有正文`);
  }
  if (errors.length) return blocked(errors.slice(0, 4).join("；"));

  const maxGeneration = 362 / 24;
  if (shots.some((shot) => shot.end - shot.start > maxGeneration + tolerance)) {
    return blocked("单个分镜超过 H3 单次原生上限；请在真实分镜边界上重新划分，不能拆分镜内部动作");
  }
  const buckets = [];
  let bucket = [];
  for (const shot of shots) {
    if (bucket.length && shot.end - bucket[0].start > maxGeneration + tolerance) {
      buckets.push(bucket);
      bucket = [];
    }
    bucket.push(shot);
  }
  if (bucket.length) buckets.push(bucket);

  const firstStart = shots[0].start;
  const finalEnd = shots.at(-1).end;
  const segments = buckets.map((items) => {
    const start = items[0].start;
    const end = items.at(-1).end;
    const body = items.map((shot) => (
      `分镜${shot.number}（全片绝对 ${shot.start.toFixed(3)}–${shot.end.toFixed(3)}秒；`
      + `本段 ${(shot.start - start).toFixed(3)}–${(shot.end - start).toFixed(3)}秒）：${shot.body}`
    )).join("\n\n");
    return {
      duration: clampDur(end - start),
      prompt: `[Director生成段：全片绝对 ${start.toFixed(3)}–${end.toFixed(3)}秒；本段内部从0秒开始]\n${body}`,
      sourceStart: start,
      sourceEnd: end,
      sourceDurationRaw: end - start,
    };
  });
  segments.sourceDuration = finalEnd - firstStart;
  segments.sourceDurationAuthoritative = true;
  segments.sourceFormat = "timed-inline-storyboard";
  segments.official = false;
  segments.officialFormat = "";
  segments.officialMode = "";
  segments.officialLabel = "中文内联分镜时间轴（非官方模板）";
  segments.globalStyle = deriveSafeGlobalPrompt(segments);
  segments.globalExtra = "";
  segments.warnings = firstStart > tolerance
    ? [`分镜时间轴从 ${firstStart.toFixed(3)} 秒开始；导入时长按首尾连续区间计算`] : [];
  return segments;
}

function parseCreateScript(text) {
  const structuredJson = parseH3StructuredJson(text);
  if (structuredJson && structuredJson.length) {
    for (const segment of structuredJson) {
      const rawDuration = Number(segment.duration) || 10;
      segment.duration = clampDur(Math.min(15, Math.max(1.6, rawDuration)));
    }
    return structuredJson;
  }
  return parseScript(text);
}

function parseScript(text) {
  const off = parseOfficialScript(text);   // v2.13.5：官方 Shot 格式优先
  if (off) return off;
  const markdown = parseStructuredMarkdownScript(text);
  if (markdown) return markdown;
  const archive = parseH3Archive(text);
  if (archive.recognized && archive.segments.length) {
    const archiveSegments = buildH3ArchiveImportSegments(archive);
    for (const segment of archiveSegments) {
      const rawDuration = Number(segment.duration) || 10;
      segment.duration = clampDur(Math.min(15, Math.max(1.6, rawDuration)));
    }
    return archiveSegments;
  }
  const timedScenes = parseTimedSceneScript(text);
  if (timedScenes) return timedScenes;
  const inlineStoryboard = parseInlineChineseStoryboard(text);
  if (inlineStoryboard) return inlineStoryboard;
  const lines = String(text || "").split(/\r?\n/);
  const namedRe = /^\s*(?:【\s*)?(?:第\s*\d+\s*(?:段|镜|镜头)|(?:段|镜头|shot|scene)\s*\d+)/i;
  const hasNamed = lines.some((l) => namedRe.test(l));

  // 从一行行首提取时间区间/时长，返回 {dur, rest} 或 null
  const timeHdr = (L) => {
    let m;
    // [0s-6.6s] / 0s-6.6s / 0秒-6.6秒
    if ((m = L.match(/^\s*\[?\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[-–~—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]?\s*[:：]?\s*/i)))
      return { dur: parseFloat(m[2]) - parseFloat(m[1]), rest: L.slice(m[0].length) };
    // 0:00-0:06
    if ((m = L.match(/^\s*\[?\s*(\d{1,2}):(\d{2})\s*[-–~—]\s*(\d{1,2}):(\d{2})\s*\]?\s*[:：]?\s*/)))
      return { dur: (parseInt(m[3], 10) * 60 + parseInt(m[4], 10)) - (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)), rest: L.slice(m[0].length) };
    // 0至6秒：/ 0到6秒
    if ((m = L.match(/^\s*(\d+(?:\.\d+)?)\s*(?:至|到)\s*(\d+(?:\.\d+)?)\s*秒?\s*[:：，,]?\s*/)))
      return { dur: parseFloat(m[2]) - parseFloat(m[1]), rest: L.slice(m[0].length) };
    // 6.6秒 | …（时长直写，必须带 |｜:： 分隔符，避免误吃正文里的秒数）
    if ((m = L.match(/^\s*(?:时长\s*)?(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[|｜:：]\s*/i)))
      return { dur: parseFloat(m[1]), rest: L.slice(m[0].length) };
    return null;
  };
  // 段标记行（可带时长）：段1（6秒）：… / 第2段 8s … / 镜头3：…
  const namedHdr = (L) => {
    const m = L.match(/^\s*(?:【\s*)?(?:第\s*(\d+)\s*(?:段|镜|镜头)|(?:段|镜头|shot|scene)\s*(\d+))\s*(?:】)?\s*[（(\[：:]?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|秒))?\s*[）)\]]?\s*[:：]?\s*/i);
    if (!m) return null;
    return { dur: m[3] ? parseFloat(m[3]) : null, rest: L.slice(m[0].length) };
  };

  const segs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    cur.prompt = cur.prompt.replace(/^\s+|\s+$/g, "");
    if (cur.prompt) segs.push(cur);
    cur = null;
  };
  for (const raw of lines) {
    const L = raw.replace(/\s+$/, "");
    if (!L.trim()) { if (cur) cur.prompt += "\n"; continue; }
    let h = null;
    if (hasNamed) {
      h = namedHdr(L);                      // 有段标记的脚本：只有段标记切分
    } else {
      h = timeHdr(L);                       // 无段标记：每个时间区间行就是一段
    }
    if (h) {
      flush();
      cur = { duration: h.dur, prompt: h.rest || "" };
    } else if (cur) {
      cur.prompt += (cur.prompt ? "\n" : "") + L;
    }
    // 第一个标记之前的散行（标题/说明）忽略
  }
  flush();

  /* 段标记没写时长：看正文里的时间轴标签（[0s-3s]/0至3秒/mm:ss）取最大结束秒 */
  const bodyEnd = (p) => {
    let end = 0;
    for (const m of p.matchAll(/\[?\s*(\d+(?:\.\d+)?)\s*s\s*[-–~—]\s*(\d+(?:\.\d+)?)\s*s\s*\]?/gi))
      end = Math.max(end, parseFloat(m[2]));
    for (const m of p.matchAll(/(\d+(?:\.\d+)?)\s*(?:至|到)\s*(\d+(?:\.\d+)?)\s*秒/g))
      end = Math.max(end, parseFloat(m[2]));
    for (const m of p.matchAll(/(\d{1,2}):(\d{2})\s*[-–~—]\s*(\d{1,2}):(\d{2})/g))
      end = Math.max(end, parseInt(m[3], 10) * 60 + parseInt(m[4], 10));
    return end;
  };
  for (const s of segs) {
    let d = (s.duration != null && s.duration > 0) ? s.duration : bodyEnd(s.prompt);
    if (!(d > 0)) d = 10;                       // 实在没写时间：默认 10 秒
    s.duration = clampDur(Math.min(15, Math.max(1.6, d)));
    delete s.dur;
  }

  /* 整篇没有任何标记（v2.13.9）：按朗读时长自动分段（每段 8~15s，断在句/段边界），
     替代旧的整篇单段导入——3 分钟小说直接粘贴即可自动拆段 */
  if (!segs.length && String(text || "").trim()) {
    return finalizeOrdinarySegments(autoSplitByDuration(String(text).trim()));
  }
  return finalizeOrdinarySegments(segs);
}

function rejectDurationInflation(parsed) {
  if (parsed && parsed.importBlocked) {
    return "拒绝导入：" + (parsed.importError || "H3 官方模板不完整。") + "";
  }
  const contract = evaluateDurationConservation(parsed && parsed.sourceDuration, parsed || []);
  if (!contract.ok) {
    return `拒绝导入：源时间轴 ${fmtSec(contract.sourceDuration)} 秒，解析后变成 ${fmtSec(contract.importedDuration)} 秒（${(contract.ratio * 100).toFixed(1)}%），超过整数秒归一化允许偏差。`;
  }
  const structuralError = (parsed && parsed.warnings || []).find((warning) =>
    /缺少或留空字段|官方字段顺序不正确|director_import_manifest 必须|缺少 At 时间标记|Shot 时间没有严格递增|缺少有效的 source_total_duration_seconds/.test(warning));
  return structuralError ? "拒绝导入：" + structuralError + "。请先修正 H3 官方模板。" : "";
}

function formatParsedDuration(parsed) {
  const contract = evaluateDurationConservation(parsed && parsed.sourceDuration, parsed || []);
  return contract.hasContract
    ? `源 ${fmtSec(contract.sourceDuration)}s → 导入 ${fmtSec(contract.importedDuration)}s`
    : `估算导入 ${fmtSec(contract.importedDuration)}s`;
}

function formatTailPlanSummary(segments) {
  const planned = (segments || []).map((segment) => ({
    plan: segment && (segment.tailPlan || segment.tail_plan) || "",
  })).filter((segment) => segment.plan);
  if (!planned.length) return "";
  const on = planned.filter((segment) => segment.plan === "on").length;
  const off = planned.filter((segment) => segment.plan === "off").length;
  const review = planned.filter((segment) => segment.plan === "review").length;
  return `；尾帧计划：开启 ${on}、关闭 ${off}` + (review ? `、待确认 ${review}` : "");
}

let h3SourceContractSequence = 0;

function newSourceContractId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return "h3src-" + globalThis.crypto.randomUUID();
    }
  } catch (_) { /* 旧版浏览器使用下面的本地后备 ID。 */ }
  h3SourceContractSequence += 1;
  return "h3src-" + Date.now().toString(36) + "-"
    + h3SourceContractSequence.toString(36) + "-"
    + Math.random().toString(36).slice(2, 12);
}

function clearSourceContractMetadata(segment) {
  if (!segment || typeof segment !== "object") return segment;
  for (const key of [
    "source_total_duration", "source_total_duration_seconds",
    "source_duration_authoritative", "source_total_duration_authoritative", "duration_authoritative",
    "source_duration_kind", "source_duration_basis", "duration_basis",
    "source_format", "source_format_id", "source_duration_policy", "duration_policy",
    "source_contract_id", "source_aspect_contract", "source_aspect", "source_aspect_ratio",
    "source_orientation", "source_contract",
  ]) delete segment[key];
  return segment;
}

function prepareParsedSourceContract(parsed) {
  if (!parsed) return null;
  const authoritative = parsed.sourceDurationAuthoritative === true;
  const total = Number(parsed.sourceDuration) || 0;
  const format = String(parsed.sourceFormat || "").trim();
  const detectedAspect = detectAspectRatioContract([
    String(parsed.globalStyle || ""),
    ...(Array.isArray(parsed) ? parsed.map((part) => String(part && part.prompt || "")) : []),
  ].join("\n"));
  const aspect = String(parsed.sourceAspectContract
    || (!detectedAspect.ambiguous && detectedAspect.orientation
      ? (detectedAspect.targetRatio > 0
        ? (detectedAspect.orientation === "portrait" ? "9:16" : "16:9")
        : detectedAspect.orientation)
      : "")).trim();
  if (!(authoritative && total > 0 && format)) return null;
  return {
    id: newSourceContractId(),
    total,
    format,
    aspect,
    policy: "preserve",
  };
}

/* 数组自定义属性不会进入 segments_json，因此权威源契约必须复制到每个可执行段。
   同一次导入先创建一个共享 contract.id；不同导入即使格式和总时长相同也不会互相串组。
   普通文本覆盖旧段时会先清除旧契约，避免从 {...source} 继承已经失效的官方时长。 */
function applyParsedSourceContract(segment, contract, parsedSegment = null) {
  if (!segment) return segment;
  clearSourceContractMetadata(segment);
  if (!contract) return segment;
  segment.source_total_duration_seconds = contract.total;
  segment.source_duration_authoritative = true;
  segment.source_format = contract.format;
  segment.source_duration_policy = contract.policy || "preserve";
  segment.source_contract_id = contract.id;
  if (contract.aspect) segment.source_aspect_contract = contract.aspect;
  segment.source_contract = {
    contract_id: contract.id,
    total_duration_seconds: contract.total,
    duration_authoritative: true,
    format: contract.format,
    duration_policy: contract.policy || "preserve",
    ...(contract.aspect ? { aspect: contract.aspect } : {}),
  };
  const sourceStart = parsedSegment && parsedSegment.sourceStart;
  const sourceEnd = parsedSegment && parsedSegment.sourceEnd;
  if (sourceStart != null && sourceEnd != null
      && Number.isFinite(Number(sourceStart)) && Number.isFinite(Number(sourceEnd))
      && Number(sourceEnd) > Number(sourceStart)) {
    segment.source_contract.segment_start_seconds = Number(sourceStart);
    segment.source_contract.segment_end_seconds = Number(sourceEnd);
    segment.source_contract.segment_duration_seconds = Number(sourceEnd) - Number(sourceStart);
  }
  return segment;
}

/* width/height 被 ResolutionSelector 等上游节点连接后，本节点隐藏 widget.value 可能仍是旧默认值。
   能读到同一上游的 aspect_ratio 时用它做前端预检；读不到时返回未知，让后端按实际宽高二次门禁。 */
function resolveLinkedAspectPreview(node, graph) {
  const inputs = Array.isArray(node && node.inputs) ? node.inputs : [];
  const widthInput = inputs.find((input) => input && input.name === "width");
  const heightInput = inputs.find((input) => input && input.name === "height");
  const widthLinkId = widthInput && widthInput.link;
  const heightLinkId = heightInput && heightInput.link;
  if (widthLinkId == null && heightLinkId == null) return { linked: false, width: 0, height: 0, contract: "" };
  const links = graph && graph.links || {};
  const widthLink = widthLinkId == null ? null : links[widthLinkId];
  const heightLink = heightLinkId == null ? null : links[heightLinkId];
  const originId = (link) => link && (link.origin_id != null ? link.origin_id : link[1]);
  const widthOrigin = originId(widthLink);
  const heightOrigin = originId(heightLink);
  if (widthOrigin == null || heightOrigin == null || widthOrigin !== heightOrigin
      || !graph || typeof graph.getNodeById !== "function") {
    return { linked: true, width: 0, height: 0, contract: "" };
  }
  const origin = graph.getNodeById(widthOrigin);
  const widget = origin && Array.isArray(origin.widgets) && origin.widgets.find((candidate) =>
    /^(?:aspect[_ ]?ratio|宽高比)$/i.test(String(candidate && candidate.name || "")));
  const widgetValue = String(widget && widget.value || "");
  const aspect = detectAspectRatioContract(widgetValue);
  if (aspect.ambiguous || !aspect.orientation) return { linked: true, width: 0, height: 0, contract: "" };
  const numericRatio = widgetValue.match(/(\d+(?:\.\d+)?)\s*[:：x×]\s*(\d+(?:\.\d+)?)/i);
  if (numericRatio && Number(numericRatio[1]) > 0 && Number(numericRatio[2]) > 0) {
    return {
      linked: true,
      width: Math.round(Number(numericRatio[1]) * 100),
      height: Math.round(Number(numericRatio[2]) * 100),
      contract: `${numericRatio[1]}:${numericRatio[2]}`,
    };
  }
  const exact = aspect.targetRatio > 0;
  const portrait = aspect.orientation === "portrait";
  return {
    linked: true,
    width: portrait ? 900 : 1600,
    height: portrait ? 1600 : 900,
    contract: exact ? (portrait ? "9:16" : "16:9") : aspect.orientation,
  };
}

/* 解析脚本时只抽出真正跨段共享的风格、角色身份和通用限制。
   首段场景、构图和动作绝不能自动进入全局框，否则换场/换风格时会把后段拉回旧画面。 */
function extractGlobalPrompt(segs) {
  return deriveSafeGlobalPrompt(segs);
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* 区域下方小拖动柄：保留上下调高和左右调宽，完整说明放在悬停提示中。 */
function attachBottomBar(el, minW = 80, minH = 40, onResize = null, options = {}) {
  const horizontal = options.horizontal !== false;
  const bar = document.createElement("div");
  bar.className = "h3s-resize-handle" + (horizontal ? "" : " vertical");
  bar.textContent = "⠿";
  bar.title = options.label || (horizontal
    ? "按住拖动：上下调高、左右调宽"
    : "按住拖动：调整高度");
  el.parentNode.insertBefore(bar, el.nextSibling);
  bar.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX, y0 = ev.clientY;
    const w0 = el.clientWidth, h0 = el.clientHeight;
    const sc = canvasScale();
    el.style.flex = "none";  // 脱离 flex 布局约束，允许自由尺寸
    const onMove = (e2) => {
      if (horizontal) el.style.width = Math.max(minW, w0 + (e2.clientX - x0) / sc) + "px";
      el.style.height = Math.max(minH, h0 + (e2.clientY - y0) / sc) + "px";
      if (onResize) onResize();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (onResize) onResize();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  bar.addEventListener("click", (ev) => ev.stopPropagation());
}

function createAssetMentionEditor(textarea) {
  const wrap = mk("div", "h3s-mention-editor");
  const layer = mk("div", "h3s-mention-layer");
  textarea.classList.add("h3s-mention-input");
  const render = () => {
    const text = textarea.value || "";
    const pattern = /[@＠]([CPSGA]\d+)(?:（[^）\r\n]{0,80}）|\([^)\r\n]{0,80}\))?/gi;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > offset) fragment.appendChild(document.createTextNode(text.slice(offset, match.index)));
      const token = mk("span", "h3s-mention-token", match[0]);
      const color = h3MentionColor(match[1]);
      token.style.setProperty("--h3-mention-color", color);
      token.style.setProperty("--h3-mention-bg", h3MentionBackground(match[1]));
      fragment.appendChild(token);
      offset = match.index + match[0].length;
    }
    if (offset < text.length) fragment.appendChild(document.createTextNode(text.slice(offset)));
    if (!text || text.endsWith("\n")) fragment.appendChild(document.createTextNode("\u200b"));
    layer.replaceChildren(fragment);
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  };
  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", () => {
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  });
  textarea.__h3RefreshMentions = render;
  wrap.append(layer, textarea);
  render();
  return wrap;
}

/* 用户侧段时长统一保存为 2~15 的整数秒；H3 合法帧数只在后端执行边界换算。 */
function clampDur(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  return Math.max(2, Math.min(15, Math.round(number)));
}

function normalizeSegmentDurations(list) {
  if (!Array.isArray(list)) return;
  for (const segment of list) {
    if (segment && typeof segment === "object") segment.duration = clampDur(segment.duration ?? 10);
  }
}

function normalizeSegmentKeyframes(list) {
  if (!Array.isArray(list)) return;
  for (const segment of list) {
    if (!segment || typeof segment !== "object") continue;
    const customFirst = typeof segment.first_frame === "string" ? segment.first_frame.trim() : "";
    const targetLast = typeof segment.last_frame === "string" ? segment.last_frame.trim() : "";
    let mode = ["none", "previous_tail", "custom"].includes(segment.first_frame_mode)
      ? segment.first_frame_mode : (segment.use_tail !== false ? "previous_tail" : "none");
    if (mode === "custom" && !customFirst) mode = segment.use_tail !== false ? "previous_tail" : "none";
    if (mode !== "custom") mode = segment.use_tail !== false ? "previous_tail" : "none";
    segment.first_frame_mode = mode;
    segment.first_frame = customFirst;
    segment.last_frame = targetLast;
    segment.use_tail = mode === "previous_tail";
  }
}

function normalizeSegmentSecondSamples(list) {
  if (!Array.isArray(list)) return;
  for (const segment of list) {
    normalizeH3SegmentSecondSample(segment);
  }
}

function setSegmentPreviousTail(segment, enabled) {
  segment.use_tail = !!enabled;
  segment.first_frame_mode = enabled ? "previous_tail" : "none";
}

function fmtSec(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/* AI 段提示词按实际素材选择官方格式：无参考素材用 Base 三字段；有 Picture/Audio
   参考时用 Ref2VA 六字段。资产数量和编号来自当前段实际发送顺序。 */
function buildAiSys(ctx) {
  const hasReferences = ctx.pics > 0 || ctx.hasAudio;
  const envelope = hasReferences
    ? "输出必须严格按以下六个字段和顺序，不能重复字段：\n"
      + "subject_definitions: 逐一声明 <Subject N> 与现有 <Picture N>/<Audio N> 的关系\n"
      + "summary: 当前段一句话摘要\n"
      + "retention_analysis: 逐一说明每个参考素材保留什么，不得写不存在的编号\n"
      + "detailed_description: [Shot 1] ... [Shot 2] At 00:00:03.000, ...\n"
      + "overall_soundscape: ...\n"
      + "non_diegetic_music: N/A\n\n"
    : "输出必须严格按以下三个字段和顺序：\n"
      + "integrated_multimodal_description: [Shot 1] ... [Shot 2] At 00:00:03.000, ...\n"
      + "overall_soundscape: ...\n"
      + "non_diegetic_music: N/A\n\n";
  return "你是 MiniMax H3 官方格式的单段视听提示词撰写助手。只输出可直接送入 H3 的提示词，不要解释、标题或 Markdown。\n"
    + envelope
    + "规则：\n"
    + "1. 视觉叙述、镜头、环境与动作使用英文；用户原始台词保持原语言，写成 <d>[Chinese] 原台词</d>，不能翻译或改写。\n"
    + "2. 第一镜只写 [Shot 1]，不能写时间；后续切镜写严格递增的绝对时间 [Shot N] At HH:MM:SS.mmm，总时长正好 " + ctx.dur + " 秒。单个核心运镜不超过 5–6 秒。\n"
    + "3. 同一说话人跨镜保持 (S1)/(S2)；旁白必须写 says in an off-screen voiceover，并明确画面角色嘴唇保持闭合。跨切镜持续台词用 <scenetrans>，结尾截断用 <cutoff>。\n"
    + "4. overall_soundscape 只写环境音、物理动作音和非语言人声；不要重复对白、歌唱或配乐。\n"
    + "5. 默认不生成分段 BGM，non_diegetic_music 固定写 N/A；只有用户明确要求背景配乐时才写具体乐器、速度和动态。\n"
    + "6. 最后一个 Shot 正文结尾写 Final frame: ...，描述可供下一段续接的清晰动作/构图锚点。不要增加规定之外的字段。\n"
    + "7. 人物、场景、道具、空间方位、光源和动作都写具体；禁止“同上/如前/位置不变”、代词串角色、字幕和水印。\n"
    + (ctx.pics > 0
      ? "8. 本段共有 " + ctx.pics + " 张参考图（" + ctx.picDesc + "）。subject_definitions、retention_analysis 和镜头正文必须使用当前 Picture 编号；人物身份、场景布局和道具外观必须服从参考图，不得保留旧 Subject/Picture 或伪造新编号。\n"
      : "8. 本段没有参考图，不得输出 <Picture N>。\n")
    + "9. " + (ctx.tail
      ? buildContinuationDirective() + " Picture 1 is the inherited final frame; the first shot must continue from it before any new transition.\n"
      : "本段不是尾帧续接段，直接从新场景状态开始。\n")
    + "10. " + ctx.voices + "\n"
    + (ctx.hasAudio
      ? "11. 本段有参考配音：不得自行编造台词；说话段让 (S1) exactly follow <Audio 1>，嘴部清晰并与音频同步，停顿段禁止写 speaks/says。\n"
      : "");
}

function buildStoryToScriptSys(assetContext = "（参考资产库为空）", outputLanguage = "") {
  const languageRule = outputLanguage === "zh-CN"
    ? "只输出简体中文剧本；场次、动作、镜头、环境、声音和配乐描述全部使用简体中文，只有 @资产编号、数字和规定的格式标记保持原样。不要翻译成英文。"
    : "";
  return "你是中文短剧剧本改编专家。把用户的小说、故事梗概或素材改写为一集可拍摄剧本；画幅方向服从用户和工作流，不得擅自固定为竖屏或横屏。"
    + languageRule
    + "只输出剧本，不解释思考过程，不输出 Markdown 标题或代码围栏。剧情必须因果闭环；把心理描写转成可见动作、微表情、光影和空间变化。"
    + "首行必须且只能写“目标总时长：X秒”。用户给出时长时必须原样保持；没有给出时长时才按情节合理估算。"
    + "用户输入中的“画幅、类型、风格、节奏、对白、运镜、重点、镜头结构、转场、声音、配乐、连续性、画面文字、限制”是用户主动选择的创作条件，必须在首行后的“创作要求：”中逐项原样保留并落实到场次，禁止擅自换风格、换画幅、增加对白、使用互斥运镜或忽略禁止项。"
    + "用户选择“无对白无旁白”时，所有场次都不得出现“角色名：台词”、旁白、画外音、内心独白、解说或任何可听语言；只允许△动作描述、真实环境音和非语言同步音效。"
    + "参考提示词案例只用于学习画面组织、动作连续、声音同步和约束写法，不得复制案例中的人物、地点、品牌、对白、UI文案或剧情；不得把案例的【正向】【反向】等中间标题原样输出。"
    + "若用户明确写出前X秒、后X秒、A到B秒、从第X秒开始、白天转夜晚、3D转2D/像素、真人转动画等时间约束，必须在首行之后输出“硬时间与风格约束：”清单，使用“0.000–15.000秒：3D”这种精确范围逐条保留；不得把15秒边界拖到18秒或20秒。"
    + "严格使用以下场次结构：场次编号、场次起止时间：A.000–B.000秒、场景与时间、出场人物、△场景动作、角色名：台词。所有场次从0秒连续覆盖到X秒，前一场结束必须等于后一场开始，最后一场结束必须严格等于X。"
    + "用户写“快速”时必须压缩为较短场次，不得让快速选择装备等动作占据大半成片。每场写清空间布局、主光源、人物方位和动作因果。"
    + "每个场次通常持续3–6秒；30秒成片通常控制在约6–8个主要场次。禁止把微表情、按钮闪烁、单步移动分别拆成亚秒级场次。"
    + "如果原文只写“复杂剧情/复杂运镜/精彩动作”，不要把它扩写成大量镜头；只补足一条最小因果链：明确目标→一个具体障碍→角色使用已有动作或道具解决→明确结果。"
    + "用户草稿没有写出具体装备、人物、地点或剧情结果时，不要替用户裁定哪一种才正确；保留用户的概括表达，只负责把已经写出的信息组织为可拍摄顺序。"
    + "原生2D像素风只使用固定侧视/俯视、横纵卷轴、视差背景、Sprite帧动画、画面缩放和屏幕震动；禁止环绕旋转、侧后方高速空间跟拍、立体透视旋转、PBR、体积光、真实毛发和写实景深。"
    + "不得擅自新增原故事和参考资产中没有的人物、物种、武器、盔甲、敌人、地点、支线、字幕、UI文字、Logo或片尾字卡。原文没有对白且用户没有主动选择对白/旁白时，不得凭空写对白；只有用户明确选择“角色对白为主、旁白为主”等要求时，才可补写最少且推动剧情的内容。"
    + "角色、服装、常驻道具和动作方向必须连续；若发生渲染风格转换，只改变表现形式，角色身份、服装主色、道具轮廓、姿态和运动方向必须保持。台词内不要使用括号或方括号。"
    + "用户未明确要求3D、PBR、真人或写实时，不得主动加入这些渲染方式；只写画面媒介与外观严格服从对应参考资产，不要声称看过图片像素。"
    + "\n\n下面是导演台本地参考资产目录，格式为 @编号（完整名称）。先阅读资产类型和完整名称，再改写剧本。只在剧情确实需要时使用资产；一旦使用，每个相关场次的“场景与时间”“出场人物”或△动作中必须逐字保留 @编号（完整名称），禁止删除编号、简称、代词替代、改名、重编号或凭空新增资产。"
    + "\n" + assetContext;
}

function buildNovelAnalysisSys(assetContext = "（参考资产库为空）", targetDuration = 0) {
  const duration = Number(targetDuration) || 0;
  return "你是中文漫剧小说分析师。把用户提供的小说正文分析成一集可拍摄剧本和可执行的 H3 生成段计划；只输出结果，不解释思考过程，不输出 Markdown 标题或代码围栏。"
    + `目标总时长固定为 ${duration} 秒，首行必须且只能写“目标总时长：${duration}秒”，不得自行增减。`
    + "保留原文人物、地点、道具、对白和因果关系；把心理描写转换为可见动作、表情、光影和空间变化，不得新增原文没有的人物、武器、地点、支线、字幕、Logo或结局。"
    + "先输出“人物分析：”和“场景分析：”，使用简短列表记录完整名称与连续性特征；随后按“场次编号、场次起止时间：A.000–B.000秒、场景与时间、出场人物、△场景动作、角色名：原文台词”输出剧本。所有场次必须从0秒连续覆盖到目标总时长。"
    + "最后必须输出“生成段计划：”和“生成段总数：N”，每段严格使用四行：生成段N、生成段起止时间：A.000–B.000秒、尾帧续接：开启/关闭/待确认、尾帧原因：简短原因。"
    + "每个生成段通常5–15秒，绝不能超过15秒；边界必须落在场次或主要动作的自然切点，并确保后续官方分镜能在每个边界开始一个新 Shot。禁止按每句话机械切段，也不要留下少于3秒的孤立尾段。"
    + "第1段必须写“尾帧续接：关闭”，原因写“首段没有上一段尾帧”。同一人物、同一场景和连续动作通常开启；换地点、时间跳跃、进入或退出回忆、独立新场景、硬风格变化通常关闭；确实无法判断时写待确认。"
    + "对白必须保持原文，不得为了填满时长虚构对白；正常语速按不超过4字/秒安排。镜头数量只在动作结构中合理体现，不要把眨眼、抬手、灯光闪烁分别拆成亚秒镜头。"
    + "\n\n下面是导演台本地参考资产目录。只在小说确实使用对应人物、场景或道具时引用，必须逐字保持完整名称；不要输出文件名、路径或稳定ID。"
    + "\n" + assetContext;
}

function buildOfficialStoryboardSys(assetContext = "（参考资产库为空）", outputLanguage = "en") {
  const chineseOutput = outputLanguage === "zh-CN";
  return "你是短剧分镜导演和 MiniMax H3 官方提示词工程师。把输入剧本转换为完整的官方 H3 Base 长时间轴，再附加导演台导入清单。只输出结果，不解释。\n"
    + "输出的第一个非空字符必须是 integrated_multimodal_description:；绝不能先写标题、解释、Markdown 或 [Shot 1]。输出顺序和字段必须严格如下，官方三个字段必须先完整出现，director_import_manifest 必须最后出现：\n"
    + "integrated_multimodal_description:\n[Shot 1] ...\n[Shot 2] At 00:00:05.000, ...\n\n"
    + "overall_soundscape:\n...\n\nnon_diegetic_music:\nN/A\n\ndirector_import_manifest:\nformat_version: 2\nsource_total_duration_seconds: X\nduration_policy: preserve\n"
    + "从输入剧本首行读取“目标总时长：X秒”；如果输入明确写了时长，绝对不能更改。所有 Shot 使用贯穿全片的绝对 HH:MM:SS.mmm 时间戳，不能每15秒重新从0开始。"
    + (chineseOutput
      ? "字段名 integrated_multimodal_description、overall_soundscape、non_diegetic_music、director_import_manifest 以及 [Shot N]、At HH:MM:SS.mmm 必须保持规定的英文格式标记，供导演台解析；除此之外，视觉、动作、镜头、环境、声音和配乐说明全部使用简体中文，不得翻译成英文。对白、歌词和画面中真实可见的文字保持用户原语言与原标点，不得翻译或改写。"
      : "官方三个字段中的视觉、动作、镜头、环境和声音说明使用英文；对白、歌词和画面中真实可见的文字保持用户原语言与原标点，不得翻译或改写。")
    + "若输入剧本带有“创作要求：”，其中画幅、类型、风格、节奏、对白、运镜、内容重点、镜头结构、转场、声音、配乐、连续性、画面文字和限制必须落实到官方三个字段及对应 Shot；不得在转换时遗漏、反转或自行新增互斥要求。"
    + "输入要求无对白无旁白时，禁止输出任何 <d> 标签、says/asks/shouts/voiceover/narration 或可听语言，只保留动作、环境声和非语言音效。"
    + "参考案例只用于学习镜头语法和约束方法，不得复制案例人物、地点、品牌、对白、UI文案或具体剧情，也不得输出【正向】【反向】【整体要求补充】等非官方中间标题。"
    + "[Shot 1] 不写 At；后续每个 Shot 必须写严格递增的绝对 At 时间。最后一个 Shot 的结束点必须正好等于 X 秒，清单中的 source_total_duration_seconds 也必须等于 X。\n"
    + "每个Shot通常2–6秒；特殊快切也不得低于1.5秒。每15秒只能安排约3–5个主要Shot，最多6个；30秒通常约6–10个Shot。一个Shot只承担一个主要动作，不得把眨眼、按钮闪烁、装备飞入、起步和落地分别拆成亚秒镜头。导演台会在导入时把连续Shot自动装入不超过约15秒的生成段。总时长超过15秒时，请优先把Shot边界安排在可组成约5–15秒生成段的位置；在不影响剧情的前提下，不要留下少于5秒的最后孤立尾段。不要为了满足单次15秒限制删除情节，也不要给每句话额外增加默认时长。\n"
    + "在 Shot 1 开头只写全片真正共享的角色身份、外貌、常驻服装、固定道具和通用限制。若后续存在3D→2D/像素、真人→动画等变化，不得写“全片共享电影级3D风格”，也不得把第一场场景、构图、运镜或光照变成全片规则。后续镜头仍使用角色、场景、道具的完整名称，禁止代词、简称、同上、如前、位置不变。\n"
    + "硬时间契约优先级最高：输入剧本的“硬时间与风格约束”必须逐条保留。若边界为15.000秒，则 At 00:00:15.000 对应 Shot 的第一帧必须已经是目标风格，不允许先继续旧风格几秒再在18秒或20秒转换；边界必须正好落在一个 Shot 起点。"
    + (chineseOutput
      ? "跨约15秒生成段发生硬风格转换时，优先在上一段最后一个 Shot 内完成转换，并用“最终帧：”写清已经是目标风格或中性全屏白光/像素网格；不得输出 Final frame 英文标签。下一段第一 Shot 严格承接该最终帧。若上一段最后帧仍是旧风格，不得假装硬尾帧可以同时满足下一段第一帧立即换风格。\n"
      : "跨约15秒生成段发生硬风格转换时，优先在上一段最后一个 Shot 内完成转换，并写清 Final frame 已经是目标风格或中性全屏白光/像素网格；下一段第一 Shot 严格承接该最终帧。若上一段最后帧仍是旧风格，不得假装硬尾帧可以同时满足下一段第一帧立即换风格。\n")
    + "2D像素风必须作用于整个画面的角色、道具、建筑、地面、背景、光影、烟雾和特效；不得只把UI、月亮、眼睛、火花、文字或贴图像素化，同时保留3D角色、真实毛发、PBR材质、体积光或2.5D模型。目标像素阶段每个 Shot 都要明确写“完整原生2D像素风持续保持”。\n"
    + "原生2D像素阶段的运镜只能使用固定侧视/俯视、横向或纵向卷轴、视差背景、Sprite帧动画、画面整体缩放、像素闪白和屏幕震动；禁止环绕角色旋转、360度运镜、低机位空间跟拍、立体通道透视旋转、PBR、体积光、真实毛发和写实景深。\n"
    + "输入剧本对装备、人物、地点或剧情结果只作概括时，按原文组织镜头，不要把缺少具体名称当成错误，也不要替用户新增未写明的装备、人物、敌人、地点或支线。\n"
    + (chineseOutput
      ? "每个 Shot 使用自然、明确的简体中文动作句，写清景别、构图、主体、环境、动作、光源、空间坐标、情绪变化、道具交互和同步具体声音；单个核心运镜不超过5–6秒。运镜写明运动类型、幅度和速度，不要把运镜标签堆在句尾。切镜必须引入新的主体、空间、状态、视角或时间信息；仅改变距离或小角度时优先连续运镜。"
      : "每个 Shot 写清景别、构图、主体、环境、动作、光源、空间坐标、情绪变化、道具交互和同步具体声音；单个核心运镜不超过5–6秒。运镜用自然英文动作句表达；需要强调时写明运动类型、幅度和速度，不要把运镜标签堆在句尾。切镜必须引入新的主体、空间、状态、视角或时间信息；仅改变距离或小角度时优先连续运镜。")
    + "闭世界规则：不得新增源剧本或资产表中没有的人物、物种、武器、盔甲、敌人、地点、支线、屏幕文字、字幕、Logo或“未完待续”等片尾字卡。台词原文完整保留并使用 <d>[Chinese]台词</d>；没有原始台词时不得虚构对白、旁白或任何 <d> 标签。慢速≤2.5字/秒、正常≤4字/秒、快速≤5.5字/秒，总字数不能超过对应时间。\n"
    + (chineseOutput
      ? "overall_soundscape 使用1–3句简体中文连续段落，归纳全片环境声、物理动作声和非语言人声，不重复对白、歌唱或配乐；时间点明确的具体声音仍写入对应 Shot。默认 non_diegetic_music: N/A；用户明确选择配乐时，必须用1–3句简体中文描述乐器、速度、节奏和动态变化；用户选择无背景音乐时必须保持N/A。不要留下任何占位符。"
      : "overall_soundscape 使用1–3句英文连续段落，归纳全片环境声、物理动作声和非语言人声，不重复对白、歌唱或配乐；时间点明确的具体声音仍写入对应 Shot。默认 non_diegetic_music: N/A；用户明确选择配乐时，必须用1–3句英文描述乐器、速度、节奏和动态变化；用户选择无背景音乐时必须保持N/A。不要留下任何占位符。")
    + "director_import_manifest 只保存导演台元数据，不得混进官方三个字段；若系统消息末尾附有本次硬时间/风格契约，必须原样遵守。原剧本明确写出‘每段N秒’、‘共N段’或“生成段计划”时，每个生成段边界必须开始一个新 Shot，任何 Shot 都不得跨越该边界。生成段计划中的尾帧开启/关闭/待确认及原因必须保留给导演台，插件还会在本地确定性写入并校验这些字段，不得擅自改动其时间或顺序。"
    + "用户未明确要求3D、PBR、真人或写实时，不得主动加入这些渲染方式；只写视觉媒介与外观严格服从对应参考资产。\n"
    + "\n\n下面是导演台本地参考资产目录，格式为 @编号（完整名称）。生成每个 Shot 前先按资产类型核对角色、场景和道具；每个 Shot 使用到某项资产时必须逐字重复 @编号（完整名称），不能删除编号、简称、改名、重编号或用代词顶替。不要自行输出 <Picture N>，Picture 编号由导演台解析导入时按本段尾帧和资产顺序确定；也不要输出本地文件名或文件路径。"
    + "\n" + assetContext;
}

function buildCreateStoryToScriptSys(assetContext = "（参考资产库为空）") {
  return buildStoryToScriptSys(assetContext)
    + "\n\n创作页面脚本框中的用户提示词是本次AI剧情的唯一剧情事实来源。自动分析只决定组织方式，不得替换人物、地点、事件、台词或结局，也不得脱离用户提示词另写故事。"
    + "创作页面电影化编剧规则：同时维护外部任务线、信息推理线、情绪关系线，任何事件都必须由前一个可见原因触发。"
    + "通用因果骨架是目标出现→第一个障碍→角色行动并付出成本→得到线索或局部成功→线索与原判断矛盾→角色验证、选择或误判→真相或威胁揭示→新问题成为下一段钩子。"
    + "15秒节拍：0–4秒建立主体和异常，4–8秒角色采取一个动作，8–12秒动作得到意外结果，12–15秒完成反应、决定或钩子。"
    + "60秒按钩子与目标、尝试与代价、矛盾线索或局部反转、决定与揭示四段推进；180秒按15–45秒一个功能段推进，每45–60秒必须改变目标、风险或认知。"
    + "每场写清进入状态、本场唯一变化和离开状态；对白只保留会改变关系、信息或决定的内容，单句通常控制在2–4秒，能用画面表达的内容不要旁白解释。"
    + "不得擅自改变已绑定角色资产的脸、发型、年龄、体型、帽子、固定服装或标志性配饰；“落魄、疲惫、危险”等剧情状态只能先用表情、姿态、动作、光线和环境表现。只有用户原始提示词明确要求可见换装、伪装、受伤或年龄变化时，才可写出连续发生的外观变化过程。"
    + "自动识别输入最接近的类型并选择一种主要因果结构；类型不明确时使用目标→障碍→行动→结果→新问题的通用结构。";
}

function buildCreateOfficialStoryboardSys(assetContext = "（参考资产库为空）") {
  return buildOfficialStoryboardSys(assetContext, "zh-CN")
    + "\n\n创作页面电影化分镜规则：默认每15秒安排3–4个 Shot；只有快速动作蒙太奇才允许5个，服从性下降时减为2–3个，禁止用增加镜头数量掩盖动作不具体。"
    + "每个 Shot 按摄影与构图→主体→一个主要动作→环境与前中后景→风格、灯光和声音的顺序写；第一句先写真实相机位置、高度、景别或焦段。"
    + "相邻 Shot 至少改变四项：相机侧面、相机高度、景别、焦段、主体位置、前中后景关系、运动方式、遮挡关系。Shot 2以后使用真实 HARD CUT，推拉摇移只属于 Shot 内运动。"
    + "每个 Shot 只有一个主要动作、一个信息变化和一个清晰结束状态；镜头运动只选一个主要路径，优先写希望看到的稳定正向结果，负面限制只保留已经验证的失败模式。"
    + "参考资产只锁定身份、服装、道具、建筑、材质和空间关系，不锁定参考图机位、裁切、姿势或构图。对白、SFX和环境声分层书写，只有可见说话者产生口型。"
    + "不得擅自改变已绑定角色资产的脸、发型、年龄、体型、帽子、固定服装或标志性配饰；不得用剧情形容词自行把整洁角色改成破衣、胡茬、秃发、异龄或另一套服装。只有用户原始提示词明确要求可见换装、伪装、受伤或年龄变化时，才可写出连续发生的变化过程。"
    + "自动判断每个 Shot 的空间、动作、信息或情绪任务，再选择最少数量的有效镜头；不得为凑数量重复机位。";
}

function parseStorySceneRanges(value) {
  const ranges = [];
  for (const match of String(value || "").matchAll(/场次起止时间\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒)?\s*(?:-|—|–|~|～|至|到)\s*(\d+(?:\.\d+)?)\s*秒/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) ranges.push({ start, end });
  }
  return ranges;
}

function normalizeNovelTailPolicy(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/^(?:关闭|不勾选|不勾|否|off|false|no)$/.test(text)) return "off";
  if (/^(?:开启|勾选|是|on|true|yes)$/.test(text)) return "on";
  if (/^(?:待确认|需确认|需要确认|review|check)$/.test(text)) return "review";
  return "";
}

function parseNovelGenerationPlan(value) {
  const items = [];
  let current = null;
  const flush = () => {
    if (current) items.push(current);
    current = null;
  };
  for (const rawLine of String(value || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = line.match(/^(?:第\s*)?生成段\s*(\d+)\s*[:：]?/i);
    if (header) {
      flush();
      current = { index: Number(header[1]), start: NaN, end: NaN, tail: "", reason: "" };
    }
    if (!current) continue;
    const range = line.match(/(?:生成段起止时间\s*[:：]\s*)?(\d+(?:\.\d+)?)\s*(?:秒)?\s*(?:-|—|–|~|～|至|到)\s*(\d+(?:\.\d+)?)\s*秒/i);
    if (range) {
      current.start = Number(range[1]);
      current.end = Number(range[2]);
    }
    const tail = line.match(/尾帧(?:续接)?\s*[:：=]\s*(不勾选|待确认|需要确认|需确认|开启|关闭|勾选|是|否|on|off|review|true|false|yes|no)/i);
    if (tail) current.tail = normalizeNovelTailPolicy(tail[1]);
    const reason = line.match(/尾帧原因\s*[:：=]\s*(.+)$/i);
    if (reason) current.reason = reason[1].trim();
  }
  flush();
  return items;
}

function extractExplicitStorySegmentContract(value, sourceDuration = 0) {
  const text = String(value || "");
  const generationPlan = parseNovelGenerationPlan(text);
  const perSegmentMatch = text.match(/每\s*(?:一|个)?\s*(?:生成)?\s*段(?:视频|片段)?(?:的)?(?:时长)?\s*(?:为|是|[:：=])?\s*(\d+(?:\.\d+)?)\s*秒/i);
  const requestedCountMatch = text.match(/生成段总数\s*[:：=]\s*(\d+)/i)
    || text.match(/(?:共|总共|分成|分为|拆成|拆分为|生成)\s*(\d+)\s*(?:个)?\s*(?:生成)?\s*段/i)
    || text.match(/(\d+)\s*(?:个)?\s*(?:生成)?段(?=\s*(?:[,，；;、]|每段|\d+(?:\.\d+)?\s*秒|$))/im);
  if (!perSegmentMatch && !requestedCountMatch && !generationPlan.length) return null;

  const tolerance = 0.051;
  const maxGeneration = 362 / 24;
  const requestedDuration = perSegmentMatch ? Number(perSegmentMatch[1]) : 0;
  let requestedCount = requestedCountMatch ? Number(requestedCountMatch[1]) : 0;
  if (generationPlan.length) {
    const invalidIndex = generationPlan.findIndex((item, index) => item.index !== index + 1);
    if (invalidIndex >= 0) return { error: `生成段编号必须从1连续递增，第${invalidIndex + 1}项编号无效` };
    const incompleteIndex = generationPlan.findIndex((item) => !(Number.isFinite(item.start)
      && Number.isFinite(item.end) && item.end > item.start));
    if (incompleteIndex >= 0) return { error: `生成段${incompleteIndex + 1}缺少有效的起止时间` };
    const missingTailIndex = generationPlan.findIndex((item) => !item.tail);
    if (missingTailIndex >= 0) return { error: `生成段${missingTailIndex + 1}缺少尾帧续接：开启/关闭/待确认` };
    if (generationPlan[0].tail !== "off") return { error: "生成段1必须关闭上一段尾帧" };
  }
  const ranges = generationPlan.length
    ? generationPlan.map((item) => ({ start: item.start, end: item.end }))
    : parseStorySceneRanges(text);
  if (generationPlan.length) requestedCount = requestedCount || generationPlan.length;
  const total = Number(sourceDuration) > 0 ? Number(sourceDuration)
    : ranges.length ? ranges.at(-1).end : 0;
  if (!(total > 0)) return { error: "写了明确分段要求，但没有可确认的目标总时长" };
  if (requestedDuration > maxGeneration + tolerance) {
    return { error: `每段 ${requestedDuration} 秒超过 H3 原生上限 ${maxGeneration.toFixed(3)} 秒` };
  }

  let normalizedRanges = ranges;
  if (!normalizedRanges.length) {
    if (requestedDuration > 0) {
      const derivedCount = total / requestedDuration;
      if (Math.abs(derivedCount - Math.round(derivedCount)) > tolerance) {
        return { error: `总时长 ${total} 秒不能完整分成每段 ${requestedDuration} 秒` };
      }
      requestedCount = requestedCount || Math.round(derivedCount);
    }
    if (!(requestedCount > 0)) return { error: "无法从分段要求确定生成段数量" };
    const duration = requestedDuration > 0 ? requestedDuration : total / requestedCount;
    if (duration > maxGeneration + tolerance) {
      return { error: `每段 ${duration.toFixed(3)} 秒超过 H3 原生上限 ${maxGeneration.toFixed(3)} 秒` };
    }
    normalizedRanges = Array.from({ length: requestedCount }, (_, index) => ({
      start: index * duration,
      end: (index + 1) * duration,
    }));
  }

  if (Math.abs(normalizedRanges[0].start) > tolerance) return { error: "明确分段必须从 0 秒开始" };
  for (let index = 0; index < normalizedRanges.length; index++) {
    const range = normalizedRanges[index];
    if (!(Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)) {
      return { error: `第 ${index + 1} 个场次时间无效` };
    }
    if (index > 0 && Math.abs(range.start - normalizedRanges[index - 1].end) > tolerance) {
      return { error: `第 ${index}、${index + 1} 个场次之间存在断档或重叠` };
    }
    const duration = range.end - range.start;
    if (duration > maxGeneration + tolerance) {
      return { error: `第 ${index + 1} 段 ${duration.toFixed(3)} 秒超过 H3 原生上限 ${maxGeneration.toFixed(3)} 秒` };
    }
    if (requestedDuration > 0 && Math.abs(duration - requestedDuration) > tolerance) {
      return { error: `第 ${index + 1} 段是 ${duration.toFixed(3)} 秒，不符合每段 ${requestedDuration} 秒` };
    }
  }
  if (Math.abs(normalizedRanges.at(-1).end - total) > tolerance) {
    return { error: `最后场次结束于 ${normalizedRanges.at(-1).end.toFixed(3)} 秒，与目标 ${total.toFixed(3)} 秒不一致` };
  }
  if (requestedCount > 0 && requestedCount !== normalizedRanges.length) {
    return { error: `要求 ${requestedCount} 段，但剧本包含 ${normalizedRanges.length} 个明确场次` };
  }

  const boundaries = [normalizedRanges[0].start, ...normalizedRanges.map((range) => range.end)];
  const durations = normalizedRanges.map((range) => range.end - range.start);
  const uniformDuration = durations.every((duration) => Math.abs(duration - durations[0]) <= tolerance)
    ? durations[0] : 0;
  return {
    count: normalizedRanges.length,
    duration: uniformDuration,
    boundaries,
    tailPolicy: generationPlan.length ? generationPlan.map((item) => item.tail) : [],
    tailReasons: generationPlan.length ? generationPlan.map((item) => item.reason || "") : [],
  };
}

function formatOfficialStoryboardSegmentPrompt(contract) {
  if (!contract || contract.error || !Array.isArray(contract.boundaries) || contract.boundaries.length < 2) return "";
  const formatClock = (value) => {
    const totalMs = Math.max(0, Math.round(Number(value) * 1000));
    const hh = Math.floor(totalMs / 3600000);
    const mm = Math.floor((totalMs % 3600000) / 60000);
    const ss = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  };
  const formatSeconds = (value) => Number(value).toFixed(3);
  const boundaries = contract.boundaries.map(formatSeconds);
  const requiredShotStarts = contract.boundaries.slice(1, -1).map((value) => `At ${formatClock(value)}`);
  return [
    `本次本地已确定 ${contract.count} 个生成段，绝对边界为：${boundaries.join(", ")} 秒。`,
    requiredShotStarts.length
      ? `以下内部边界必须各自恰好对应一个 Shot 起点：${requiredShotStarts.join(", ")}。`
      : "本次没有内部生成段边界。",
    "如果场次边界与生成段边界重合，必须合并为同一个 Shot 起点；同一 At 时间禁止创建两个 Shot。",
    "[Shot 1] 视为 00:00:00.000 且不写 At；后续 Shot 必须在整片绝对时间轴上严格递增，禁止回退、重复或在新生成段重新从 00:00:00.000 计时。",
    "最后一个边界是全片结束时间，不要在该结束时间再创建新 Shot。输出前逐个比较相邻 Shot 的 At，确认当前时间始终大于前一个时间。",
  ].join("\n");
}

/* 已经带 [Shot N] 的输入有时只是按诗句或场景划分的粗时间轴，而不是可直接
   生成的 H3 镜头。把真实粗边界和待补区间明确交给 AI，避免它原样照抄一个
   20 多秒 Shot，最后在 <=15.083 秒的生成段归一化中丢失剧情时长。 */
function formatCoarseOfficialShotExpansionPrompt(value) {
  const text = String(value || "");
  const marks = [...text.matchAll(/\[Shot\s+(\d+)\s*\]/gi)];
  if (marks.length < 2) return "";
  const starts = [];
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    const end = index + 1 < marks.length ? marks[index + 1].index : text.length;
    const prefix = parseOfficialShotPrefix(text.slice((mark.index || 0) + mark[0].length, end).trim());
    const start = index === 0 ? 0 : prefix.start;
    if (!Number.isFinite(start) || (index > 0 && start <= starts[index - 1])) return "";
    starts.push(start);
  }
  const explicitDuration = Number(extractH3TimelineStyleContract(text).sourceDuration) || 0;
  const lastGap = starts.at(-1) - starts.at(-2);
  const total = explicitDuration > starts.at(-1) ? explicitDuration : starts.at(-1) + lastGap;
  if (!(total > starts.at(-1))) return "";
  const boundaries = [...starts, total];
  const longRanges = boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1],
  })).filter((range) => range.end - range.start > 6.001);
  if (!longRanges.length) return "";
  const fmt = (number) => Number(number).toFixed(3);
  return [
    "输入中的 [Shot N] 是粗场景边界，不是允许原样照抄的最终 H3 镜头。必须保留其叙事顺序和原始边界，同时在每个超长区间内部增加新的 Shot。",
    `本地识别的粗场景起点为 ${starts.map(fmt).join(", ")} 秒；${explicitDuration > 0 ? "输入明确" : "按最后一个相邻镜头间隔推断"}的全片结束时间为 ${fmt(total)} 秒。director_import_manifest.source_total_duration_seconds 必须写 ${fmt(total)}。`,
    `必须细分的区间：${longRanges.map((range) => `${fmt(range.start)}–${fmt(range.end)}秒`).join("；")}。这些区间内要新增足够的绝对 At 镜头起点，不能只保留原来的 ${starts.length} 个粗 Shot。`,
    "输出前逐项计算相邻 Shot 的时间差以及最后一个 Shot 到全片结束的时长；每个差值必须大于0且不超过6秒，任何一个超过6秒都必须继续细分。新增镜头只能拆解原场景已有动作、环境、情绪和画外音，不得改写原台词或新增剧情。",
  ].join("\n");
}

function inspectOfficialStoryboardShotTimeline(value) {
  const text = String(value || "");
  const main = text.match(/integrated_multimodal_description\s*[:：]([\s\S]*?)(?=\n\s*overall_soundscape\s*[:：]|$)/i);
  const body = main ? main[1] : "";
  const marks = [...body.matchAll(/\[Shot\s+(\d+)\s*\]/gi)];
  let previous = { number: 1, start: 0 };
  for (let index = 1; index < marks.length; index++) {
    const mark = marks[index];
    const end = index + 1 < marks.length ? marks[index + 1].index : body.length;
    const prefix = parseOfficialShotPrefix(body.slice((mark.index || 0) + mark[0].length, end).trim());
    if (!Number.isFinite(prefix.start)) continue;
    const current = { number: Number(mark[1]), start: prefix.start };
    if (current.start <= previous.start) {
      const currentTime = current.start.toFixed(3);
      const previousTime = previous.start.toFixed(3);
      if (Math.abs(current.start - previous.start) <= 0.001) {
        return `Shot ${current.number} 的 At ${currentTime} 秒与 Shot ${previous.number} 的 ${previousTime} 秒重复；同一边界只能保留一个 Shot 起点`;
      }
      const resetHint = current.start <= (362 / 24) + 0.001 && previous.start >= (362 / 24) - 0.001
        ? "，疑似在新生成段把绝对时间重新从 0 开始"
        : "";
      return `Shot ${current.number} 的 At ${currentTime} 秒小于 Shot ${previous.number} 的 ${previousTime} 秒，时间发生回退${resetHint}`;
    }
    previous = current;
  }
  return "";
}

function injectExplicitStorySegmentManifest(value, contract) {
  if (!contract || !Array.isArray(contract.boundaries) || contract.boundaries.length < 2) {
    return String(value || "").trim();
  }
  let text = String(value || "").trim();
  if (!/(?:^|\n)\s*director_import_manifest\s*[:：]/i.test(text)) return text;
  text = text.replace(/^\s*(?:requested_segment_count|requested_segment_duration_seconds|source_scene_boundaries_seconds|segment_duration_policy|segment_tail_policy|segment_tail_reasons)\s*[:：].*$(?:\r?\n)?/gim, "").trim();
  const formatNumber = (value) => String(Number(Number(value).toFixed(3)));
  const cleanReason = (value) => String(value || "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  const lines = [
    `requested_segment_count: ${contract.count}`,
    contract.duration > 0 ? `requested_segment_duration_seconds: ${formatNumber(contract.duration)}` : "",
    `source_scene_boundaries_seconds: ${contract.boundaries.map(formatNumber).join(",")}`,
    "segment_duration_policy: preserve_explicit",
    Array.isArray(contract.tailPolicy) && contract.tailPolicy.length
      ? `segment_tail_policy: ${contract.tailPolicy.join(",")}` : "",
    Array.isArray(contract.tailReasons) && contract.tailReasons.length
      ? `segment_tail_reasons: ${contract.tailReasons.map(cleanReason).join("|")}` : "",
  ].filter(Boolean);
  return text + "\n" + lines.join("\n");
}

function h3HasScriptDialogueLine(value) {
  return String(value || "").split(/\r?\n/).some(isH3StoryDialogueLine);
}

function h3DialoguePolicy(value) {
  const text = String(value || "");
  const selected = text.match(/(?:对白|台词|旁白)\s*[:：]\s*([^；;\n]+)/i);
  if (selected) {
    if (/(?:无|不要|禁止|不需要|仅环境声|系统提示音代替)/i.test(selected[1])) return "forbid";
    return "allow";
  }
  /* 用户也可能在自然语言剧本里直接写“无对白无旁白”，而不是填写“对白：无”。
     仅把明确否定对白/台词的表达视为禁止；单独写“无旁白”不等于禁止角色对白。 */
  if (/(?:无对白|无台词|不要(?:任何)?对白|不要(?:任何)?台词|禁止(?:任何)?对白|禁止(?:任何)?台词|不需要(?:任何)?对白|不需要(?:任何)?台词|仅环境声(?:和动作音效)?)/i.test(text)) {
    return "forbid";
  }
  if (/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/i.test(text)) return "present";
  return h3HasScriptDialogueLine(text) ? "present" : "unspecified";
}

function h3ContainsDialogue(value, official = false) {
  const text = String(value || "");
  if (/<d>\s*\[[^\]]+\][\s\S]*?<\/d>/i.test(text)) return true;
  if (official) return false;
  return h3HasScriptDialogueLine(text);
}

function prepareNovelAnalysisOutput(value, originalInput = "", targetDuration = 0) {
  const content = String(value || "").replace(/^\uFEFF/, "").trim()
    .replace(/^```(?:text|txt|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!content) return { ok: false, error: "API没有返回小说分析内容。" };
  const expectedDuration = Number(targetDuration) || 0;
  const durationMatch = content.match(/^\s*目标总时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*秒/i);
  const outputDuration = durationMatch ? Number(durationMatch[1]) : 0;
  if (!(outputDuration > 0)) return { ok: false, error: "小说分析缺少首行“目标总时长：X秒”，原文未改动。" };
  if (expectedDuration > 0 && Math.abs(outputDuration - expectedDuration) > 0.051) {
    return { ok: false, error: `API把目标总时长从 ${expectedDuration} 秒改成了 ${outputDuration} 秒，原文未改动。` };
  }
  if (!/(?:^|\n)\s*人物分析\s*[:：]/i.test(content)
      || !/(?:^|\n)\s*场景分析\s*[:：]/i.test(content)) {
    return { ok: false, error: "小说分析缺少人物分析或场景分析，原文未改动。" };
  }
  const plan = parseNovelGenerationPlan(content);
  if (!plan.length) return { ok: false, error: "小说分析没有生成可识别的“生成段计划”，原文未改动。" };
  const missingReasonIndex = plan.findIndex((item) => !item.reason);
  if (missingReasonIndex >= 0) {
    return { ok: false, error: `生成段${missingReasonIndex + 1}缺少尾帧原因，原文未改动。` };
  }
  const contract = extractExplicitStorySegmentContract(content, outputDuration);
  if (!contract || contract.error) {
    return { ok: false, error: "小说分析的生成段计划无效：" + String(contract && contract.error || "无法确定生成段边界") + "，原文未改动。" };
  }
  const reviewCount = contract.tailPolicy.filter((value) => value === "review").length;
  const onCount = contract.tailPolicy.filter((value) => value === "on").length;
  const offCount = contract.tailPolicy.filter((value) => value === "off").length;
  return {
    ok: true,
    content,
    note: `；已规划 ${contract.count} 个生成段，尾帧开启 ${onCount}、关闭 ${offCount}`
      + (reviewCount ? `、待确认 ${reviewCount}` : ""),
  };
}

/* 故事改编也必须先通过程序锁，避免 AI 在第一步就丢失用户给出的总时长或
   “前15秒/后15秒”风格边界，导致后面的官方分镜只能在错误剧本上继续扩写。 */
function prepareStoryScriptOutput(value, originalInput = "") {
  let content = String(value || "").replace(/^\uFEFF/, "").trim()
    .replace(/^```(?:text|txt|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!content) return { ok: false, error: "API没有返回可写入的内容。" };
  /* 故事→剧本不再做装备名称、剧情具体度、镜头密度、对白策略或时间风格评分。
     只保留用户明确选择“无对白无旁白”时的确定性清理；未明确对白策略时绝不默认禁止，
     也不审核、重写或拒绝用户自己的 AI 文案。 */
  if (h3DialoguePolicy(originalInput) === "forbid") {
    const cleaned = stripForbiddenH3StoryDialogue(content);
    content = cleaned.text.trim();
    if (!content) return { ok: false, error: "AI已返回内容，但执行用户明确的无对白规则后为空；原文未改动" };
    return { ok: true, content, note: cleaned.removed ? `；已本地删除 ${cleaned.removed} 处违背无对白规则的内容` : "" };
  }
  return { ok: true, content, note: "" };
}

/* API 的“剧本→H3官方分镜”输出不能直接覆盖用户原剧本。只有通过完整
   Base + 导演台精确时长清单 + 原剧本硬时间/风格契约的本地校验后才写回。 */
function prepareOfficialStoryboardOutput(value, originalInput = "") {
  const sourceContract = extractH3TimelineStyleContract(originalInput);
  const explicitSegmentContract = extractExplicitStorySegmentContract(originalInput, sourceContract.sourceDuration);
  const fail = (error, issues = []) => ({
    ok: false,
    error,
    repairPrompt: buildH3TimelineRepairInstruction(sourceContract, issues.length ? issues : [
      { severity: "error", code: "official_format", message: error },
    ], { mode: "official" }),
  });
  if (explicitSegmentContract && explicitSegmentContract.error) {
    return fail("原剧本的明确分段要求无效：" + explicitSegmentContract.error + "；原剧本已保留。");
  }
  const envelope = normalizeRecoverableBaseEnvelope(value);
  if (envelope.importBlocked) return fail(envelope.importError);
  let candidateText = envelope.text;
  let removedForbiddenDialogue = 0;
  /* “无对白”只在用户原剧本明确选择时生效。清理发生在正式解析之前，随后仍要
     重新经过 Base 三字段、绝对时间、manifest 与时长守恒校验，避免局部删除破坏
     官方结构；未明确选择无对白时不审核、删除或改写 AI 文案。 */
  if (h3DialoguePolicy(originalInput) === "forbid") {
    const cleaned = stripForbiddenH3OfficialDialogue(candidateText);
    candidateText = String(cleaned.text || "").trim();
    removedForbiddenDialogue = Math.max(0, Number(cleaned.removed || 0));
    if (!candidateText) {
      return fail("AI已返回内容，但执行用户明确的无对白规则后为空；原剧本已保留。");
    }
  }
  if (!/^\s*integrated_multimodal_description\s*[:：]/i.test(candidateText)) {
    return fail("AI 返回内容在 integrated_multimodal_description: 之前仍有标题、解释或其它前言；为防止前言进入 H3 提示词，原剧本已保留。");
  }
  const parsed = parseOfficialScript(candidateText);
  if (!parsed || parsed.importBlocked || !parsed.length || !parsed.official || parsed.officialFormat !== "base") {
    return fail("AI 返回内容不是完整的 H3 官方 Base 三字段模板；原剧本已保留。");
  }
  const canonical = String(parsed.normalizedSource || candidateText || "").trim();
  const required = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  const positions = required.map((name) => canonical.search(new RegExp(`(?:^|\\n)\\s*${name}\\s*[:：]`, "i")));
  if (positions.some((position) => position < 0) || positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    return fail("AI 返回的 H3 Base 三字段缺失或顺序不正确；原剧本已保留。");
  }
  const manifestIndex = canonical.search(/(?:^|\n)\s*director_import_manifest\s*[:：]/i);
  const durationMatch = canonical.match(/(?:source_total_duration_seconds|target_total_duration_seconds|源总时长秒|目标总时长秒)\s*[:：=]\s*(\d+(?:\.\d+)?)/i);
  if (manifestIndex < 0 || !durationMatch || !(Number(durationMatch[1]) > 0)) {
    return fail("AI 返回的 H3 官方分镜缺少有效 director_import_manifest.source_total_duration_seconds；原剧本已保留。");
  }
  const declaredDuration = Number(durationMatch[1]);
  if (sourceContract.sourceDuration > 0 && Math.abs(declaredDuration - sourceContract.sourceDuration) > 0.05) {
    return fail(`原剧本要求 ${sourceContract.sourceDuration.toFixed(3)} 秒，但 AI manifest 写成了 ${declaredDuration.toFixed(3)} 秒。`);
  }
  const structuralWarning = (parsed.warnings || []).find((warning) => /缺少或留空字段|官方字段顺序不正确|director_import_manifest 必须|缺少有效的 source_total_duration_seconds|缺少 At 时间标记|Shot 时间没有严格递增|源时长.*不守恒/.test(warning));
  if (structuralWarning) {
    const timelineDetail = /Shot 时间没有严格递增/.test(structuralWarning)
      ? inspectOfficialStoryboardShotTimeline(candidateText) : "";
    return fail("AI 返回的官方分镜未通过校验：" + (timelineDetail || structuralWarning) + "；原剧本已保留。");
  }
  const contract = evaluateDurationConservation(parsed.sourceDuration, parsed);
  if (!contract.ok) {
    return fail(`AI 返回的源时长 ${fmtSec(contract.sourceDuration)} 秒与导入时长 ${fmtSec(contract.importedDuration)} 秒不守恒；原剧本已保留。`);
  }
  /* 官方分镜只保留三字段、绝对 Shot 时间、manifest 和时长守恒等技术门禁。
     不再评价剧情内容、装备名称、镜头质量或对白策略。 */
  let content = injectH3TimelineStyleContractManifest(canonical, sourceContract);
  content = injectExplicitStorySegmentManifest(content, explicitSegmentContract);
  if (explicitSegmentContract) {
    const explicitParsed = parseOfficialScript(content);
    if (!explicitParsed || explicitParsed.importBlocked || explicitParsed.length !== explicitSegmentContract.count) {
      return fail((explicitParsed && explicitParsed.importError)
        ? explicitParsed.importError + "；原剧本已保留。"
        : `AI 官方分镜没有保留原剧本要求的 ${explicitSegmentContract.count} 个生成段；原剧本已保留。`);
    }
  }
  const validationNote = ((envelope.repaired || parsed.normalizedFromRecoveredBase)
    ? (envelope.repairKind === "base_sound_fields"
      ? "（已在本地补齐 Base 声音字段，并通过官方格式与时长解析）"
      : "（已自动补齐 Base 首字段，并通过官方格式与时长解析）")
    : "（已通过官方 Base 三字段、绝对时间与时长解析）");
  const dialogueNote = removedForbiddenDialogue
    ? `；已本地删除 ${removedForbiddenDialogue} 处违背无对白规则的内容`
    : "";
  const segmentNote = explicitSegmentContract
    ? `；已保留 ${explicitSegmentContract.count} 个明确生成段`
    : "";
  const tailNote = explicitSegmentContract && explicitSegmentContract.tailPolicy.length
    ? `；已写入 ${explicitSegmentContract.tailPolicy.length} 段尾帧计划`
    : "";
  return {
    ok: true,
    content,
    note: validationNote + dialogueNote + segmentNote + tailNote,
  };
}

/* 视频界面的 AI 系统提示词（v2.9）：四段式视频参考提示词，先看视频关键帧+照片再写 */
function buildVideoAiSys(ctx) {
  const audioReference = !!(ctx && ctx.videoAudioReference);
  const videoCount = Math.max(1, Math.min(3, Number(ctx && ctx.videoCount) || 1));
  const assignments = String(ctx && ctx.videoAssignments || "<Video 1>：综合参考");
  const sourcePolicy = audioReference
    ? "严格按逐路用途分配参考，并且只在用户明确开启后参考相应视频原音轨中清楚可辨的节奏或台词"
    : "严格按逐路用途分配参考；只参考画面，不复制、不分析、不引用任何参考视频原音轨";
  const examplePolicy = audioReference
    ? "已开启视频音轨参考时，只使用清楚可辨的节奏或台词，不得新增未听清的台词或伪语言。"
    : "所有 <Video N> 都只参考画面，不复制或参考原视频音轨。";
  return "你是 H3 导演台「视频参考」模式的提示词撰写助手。用户会给你：参考视频的关键帧（以图片形式，按时间顺序）、参考照片、一句创意或草稿。你输出一段可直接使用的【视频参考提示词】。\n"
    + "硬性规则：\n"
    + "1. 只输出提示词正文：不要解释、前言、标题、markdown 代码块。\n"
    + "2. 用中文撰写；<Video 1>～<Video " + videoCount + ">、<Picture N> 标签保留原样。\n"
    + "3. 严格使用四段式结构（参考机智罗教程实测有效的写法）：\n"
    + "【素材关系分配】声明" + sourcePolicy + "。本次逐路分配为：" + assignments + "。只能从每路视频提取它被指定的维度，不得让一条视频覆盖另一条的职责；然后逐个写明人物强制替换映射：原视频中的<角色描述> 替换为 <Picture N>（外貌穿着照参考照片），结尾加“100% 替换每一个，不允许保留原人物特征”。\n"
    + "【画面美学与质感】风格/光线/材质/氛围（参考照片是写实就写照片级写实，是动画就写对应渲染风格）。\n"
    + "【详细时间线调度】按“X 至 Y 秒”分段，总时长必须正好 " + ctx.dur + " 秒，3~4 段为宜；每段必须先写出关键帧中的具体可见动作，再按用途回挂对应 <Video N>。只写标签不描述可见内容不合格，禁止编造关键帧里没有的动作。\n"
    + "【限制】全程一镜到底，禁止切镜头/画面闪烁/转场，禁止任何文字、字幕与 UI 元素。\n"
    + "4. 参考照片共 " + ctx.pics + " 张：人物外貌/穿着/场景必须严格依据照片描述，禁止凭空编造；只在句子里用 <Picture N> 引用。\n"
    + "5. 时间线分段时间点要贴着参考动作/运镜/节奏视频各自关键帧展示的变化来切。\n"
    + "6. 四个【】小标题必须原样出现在输出里，每段独占一块——这是硬性格式，不许写成流水段落。\n"
    + "【格式范例】（仅为格式示范，内容必须换成本次视频关键帧和照片里的真实内容）：\n"
    + "【素材关系分配】\n逐条写明 <Video N> 只负责参考动作、运镜、节奏或综合中的哪一种；" + examplePolicy + "\n人物角色强制替换：参考视频中的<角色A> 100% 替换为 <Picture 1>（<外貌穿着>），不允许保留原人物的任何外貌特征。\n"
    + "【画面美学与质感】\n<风格/光线/场景氛围/材质>。\n"
    + "【详细时间线调度】\n0 至 2.5 秒：<景别>，<角色> <具体动作，照动作参考写>，摄影机按运镜参考移动。\n2.5 至 5 秒：<角色动作>，停顿和加速按节奏参考执行。\n5 至 <末秒> 秒：<镜头收尾>，分别回扣使用过的 <Video N>。\n"
    + "【限制】\n全程一镜到底，绝对禁止切镜头、画面闪烁或任何形式的转场，画面禁止出现任何文字、字幕与 UI 元素。\n";
}

function apiTestStatusText(result, fallbackModel) {
  const model = result.model || fallbackModel || "当前模型";
  const reasoningModel = /(?:deepseek-(?:reasoner|r1)|\/deepseek-r1|reasoning)/i.test(model);
  if (reasoningModel) {
    const imageNote = result.vision_capability === "unsupported" ? "且不支持参考图；" : "；";
    return "文字连接成功（" + model + "）" + imageNote
      + "推理模型生成长剧本时可能只返回思考过程，建议改选普通 Chat/Instruct 模型";
  }
  if (result.vision_capability === "unsupported") {
    return "文字连接成功（" + model + "）；该模型不支持参考图，将自动使用纯文本模式";
  }
  if (result.vision_capability === "supported") {
    return "文字连接成功（" + model + "）；按模型名称判断应支持参考图，首次带图生成时实际验证";
  }
  return "文字连接成功（" + model + "）；视觉能力将在正式生成时自动检测";
}

function showAiGenerationResult(element, result, baseText) {
  const omitted = Math.max(0, Number(result.images_omitted || 0));
  const seen = Math.max(0, Number(result.images_seen || 0));
  if (omitted > 0) {
    element.style.color = "#e8bd68";
    element.textContent = baseText + "（纯文本模式：" + omitted + " 张参考图/关键帧未发送）";
  } else if (seen > 0) {
    element.style.color = "";
    element.textContent = baseText + "（AI 已查看 " + seen + " 张参考图/关键帧）";
  } else {
    element.style.color = "";
    element.textContent = baseText;
  }
}

function buildStudio(node) {
  if (typeof node.__h3Cleanup === "function") node.__h3Cleanup();
  const jsonWidget = node.widgets.find((w) => w.name === "segments_json");
  const vJsonWidget = node.widgets.find((w) => w.name === "vsegments_json");
  const tJsonWidget = node.widgets.find((w) => w.name === "tsegments_json");
  const modeWidget = node.widgets.find((w) => w.name === "ui_mode");
  const globalPromptWidget = node.widgets.find((w) => w.name === "global_prompt");
  const summaryWidget = node.widgets.find((w) => w.name === "汇总输出");
  const tailModeWidget = node.widgets.find((w) => w.name === "续接方式");
  const unloadWidget = node.widgets.find((w) => w.name === "每段后卸载模型");
  const projectWidget = node.widgets.find((w) => w.name === "project_id");
  const textSharedRefsWidget = node.widgets.find((w) => w.name === "text_shared_refs_json");
  if (!jsonWidget) {
    const warn = mk("div", "h3s", "segments_json widget 未找到，导演台初始化失败");
    return warn;
  }
  jsonWidget.hidden = true;
  jsonWidget.computeSize = () => [0, -4];
  if (vJsonWidget) { vJsonWidget.hidden = true; vJsonWidget.computeSize = () => [0, -4]; }
  if (tJsonWidget) { tJsonWidget.hidden = true; tJsonWidget.computeSize = () => [0, -4]; }
  if (modeWidget) { modeWidget.hidden = true; modeWidget.computeSize = () => [0, -4]; }
  if (globalPromptWidget) { globalPromptWidget.hidden = true; globalPromptWidget.computeSize = () => [0, -4]; }
  if (tailModeWidget) { tailModeWidget.hidden = true; tailModeWidget.computeSize = () => [0, -4]; }
  if (unloadWidget) {
    // 仅为旧工作流保持输入槽位稳定；8GB 优化功能已删除，旧值也强制关闭。
    unloadWidget.value = false;
    unloadWidget.hidden = true;
    unloadWidget.computeSize = () => [0, -4];
  }
  if (projectWidget) { projectWidget.hidden = true; projectWidget.computeSize = () => [0, -4]; }
  if (textSharedRefsWidget) { textSharedRefsWidget.hidden = true; textSharedRefsWidget.computeSize = () => [0, -4]; }

  // 兼容旧工作流仍保留该 required widget，但不再向用户显示。
  // 导演台始终用省内存预览返回，完整音画通过分段 MP4 自动合并，不把整片帧张量驻留内存。
  const summaryChoices = ["仅预览帧(推荐)"];
  if (summaryWidget) {
    summaryWidget.hidden = true;
    summaryWidget.computeSize = () => [0, -4];
  }
  const normalizeSummaryWidget = () => {
    if (!summaryWidget) return;
    summaryWidget.value = summaryChoices[0];
    if (summaryWidget.options && Array.isArray(summaryWidget.options.values)) {
      summaryWidget.options.values = summaryChoices.slice();
    }
  };
  normalizeSummaryWidget();

  if (!node.properties) node.properties = {};
  const claimProjectId = (requestedId) => {
    let id = String(requestedId || "").trim();
    if (!id) id = newProjectId();
    id = id.replace(/[^0-9A-Za-z_-]+/g, "_").slice(0, 80).replace(/^_+|_+$/g, "") || newProjectId();
    const previous = node.__h3ClaimedProjectId;
    if (previous && previous !== id && activeProjectIds.get(previous) === node) activeProjectIds.delete(previous);
    while (activeProjectIds.has(id) && activeProjectIds.get(id) !== node) id = newProjectId();
    activeProjectIds.set(id, node);
    node.__h3ClaimedProjectId = id;
    node.properties.h3_project_id = id;
    if (projectWidget) projectWidget.value = id;
    return id;
  };
  const ensureProjectId = () => claimProjectId(
    node.properties.h3_project_id || (projectWidget && projectWidget.value) || "");
  const loadSharedRefsWidget = () => {
    let parsed = null;
    if (textSharedRefsWidget) {
      try {
        const value = JSON.parse(textSharedRefsWidget.value || "[]");
        if (Array.isArray(value)) parsed = value.filter((x) => typeof x === "string" && x);
      } catch (e) { /* 损坏数据由后端运行时给出明确提示 */ }
    }
    if (!Array.isArray(node.properties.h3_text_refs)) node.properties.h3_text_refs = parsed || [];
    else if (parsed && parsed.length && node.properties.h3_text_refs.length === 0) node.properties.h3_text_refs = parsed;
  };
  ensureProjectId();
  loadSharedRefsWidget();

  /* 三界面数据完全独立（v2.3 视频 / v2.11 文本）：创作读 segments_json，
     视频读 vsegments_json，文本读 tsegments_json；segs 指向当前活动数据集，
     切页签=换数据集。ui_mode widget 同步给后端，后端按它选数据集、
     并用独立输出文件名（漫剧v_/漫剧t_），三页产出互不覆盖。 */
  let createSegs = defaultSegs();
  let videoSegs = defaultSegs().slice(0, 1);  // 视频界面=单视频工作区（v2.5.6）
  let textSegs = defaultTextSegs();           // 文本界面=纯提示词工作区（v2.11）
  let createTimelineVideos = [];
  let segs = createSegs;
  let sel = 0;
  let createProjectStore = null;
  let createProjectsReady = false;
  let applyingCreateProject = false;
  let syncSecondSamplePanel = () => {};
  let syncWorkspaceVisibility = () => {};
  const normalizeStudioMode = (value) => ["create", "video", "text"].includes(value) ? value : "create";
  const normalizeStudioTab = (value) => ["create", "video", "text", "upscale"].includes(value)
    ? value : "create";
  const curMode = () => normalizeStudioMode(node.properties.h3_mode);
  if (!node.properties.h3_active_tab) node.properties.h3_active_tab = curMode();
  const curTab = () => normalizeStudioTab(node.properties.h3_active_tab);
  const modeGlobalPromptKey = (mode) => mode === "text"
    ? "h3_text_global_prompt"
    : mode === "video" ? "h3_video_global_prompt" : "h3_create_global_prompt";
  const modeAutoGlobalKey = (mode) => mode === "text"
    ? "h3_text_auto_global_value" : "h3_create_auto_global_value";
  const modeGlobalPrompt = (mode = curMode()) => String(node.properties[modeGlobalPromptKey(mode)] || "");
  const setModeGlobalPrompt = (mode, value) => {
    const normalized = String(value || "");
    node.properties[modeGlobalPromptKey(mode)] = normalized;
    if (globalPromptWidget && mode === curMode()) globalPromptWidget.value = normalized;
  };
  const captureCurrentGlobalPrompt = () => {
    if (globalPromptWidget) setModeGlobalPrompt(curMode(), globalPromptWidget.value || "");
  };
  const syncGlobalPromptWidget = (mode = curMode()) => {
    if (globalPromptWidget) globalPromptWidget.value = modeGlobalPrompt(mode);
  };
  const migrateModeGlobalPrompts = () => {
    if (node.properties.h3_mode_globals_v1 === "1") return;
    const legacy = String(globalPromptWidget && globalPromptWidget.value || "");
    const owner = curMode() === "text" ? "text" : "create";
    if (!node.properties[modeGlobalPromptKey(owner)] && legacy) {
      node.properties[modeGlobalPromptKey(owner)] = legacy;
    }
    // 视频界面从未提供过全局提示词输入框；旧值必然来自创作或文本界面，不能迁入视频模式。
    node.properties.h3_video_global_prompt = "";
    const legacyAuto = String(node.properties.h3_text_auto_global_value || "");
    if (owner === "create" && legacyAuto && !node.properties.h3_create_auto_global_value) {
      node.properties.h3_create_auto_global_value = legacyAuto;
      node.properties.h3_text_auto_global_value = "";
    }
    node.properties.h3_mode_globals_v1 = "1";
  };
  const _modeQ = () => new URLSearchParams({ mode: curMode(), project_id: ensureProjectId() }).toString();
  let upscaleSettings = normalizeH3UpscaleSettings(node.properties.h3_upscale_settings);
  let upscaleSource = node.properties.h3_upscale_source
    && typeof node.properties.h3_upscale_source === "object"
    ? { ...node.properties.h3_upscale_source } : null;
  let upscaleResult = node.properties.h3_upscale_result
    && typeof node.properties.h3_upscale_result === "object"
    ? { ...node.properties.h3_upscale_result } : null;
  let upscalePromptId = "";
  const upscaleEarlyEvents = new Map();
  let upscaleRunning = false;
  let upscaleModelBusy = false;
  let upscaleModelOperation = "";
  let upscaleModelMessage = "";
  let upscaleModelsCache = null;
  let upscaleModelsRequest = null;
  let cleanupUpscaleComparison = null;
  let upscaleProgress = 0;
  let upscaleProgressText = "等待开始";
  let upscaleRunMessage = "选择视频和模式后开始处理；原视频不会被覆盖。";
  let secondSampleExpanded = node.properties.h3_second_sample_panel_open === true;
  const secondSampleScope = "checked";
  node.properties.h3_second_sample_scope = secondSampleScope;
  let secondSampleEditMode = node.properties.h3_second_sample_edit_mode === "separate"
    ? "separate" : "uniform";
  let secondSampleModelBusy = false;
  let secondSampleModelMessage = "";
  let secondSampleStatusCache = null;
  let secondSampleStatusRequest = null;
  let secondSampleStatusPollTimer = null;
  let secondSampleRuntimeActive = false;
  let secondSampleRuntimePromptId = "";
  let secondSampleRuntimeMode = "";
  let secondSampleRuntimeProjectId = "";
  let secondSampleRuntimeSegments = new Set();
  let secondSampleRuntimeLastStage = null;
  const secondSampleRuntimeEarlyEvents = new Map();
  let secondSampleSetupSelection = normalizeH3SecondSampleSetupSelection(
    node.properties.h3_second_sample_setup_selection);
  let secondSampleSetupStatus = normalizeH3SecondSampleSetupStatus(null);
  let secondSampleSelectedUpscalerModel = "";
  let secondSampleDefault = normalizeH3SecondSample(node.properties.h3_second_sample_default);
  const persistSecondSampleDefault = (value) => {
    secondSampleDefault = normalizeH3SecondSample(value);
    if (secondSampleDefault.mode === "off") delete node.properties.h3_second_sample_default;
    else node.properties.h3_second_sample_default = { ...secondSampleDefault };
  };
  const applySecondSampleDefault = (segment) =>
    applyH3SecondSampleDefault(segment, secondSampleDefault);
  persistSecondSampleDefault(secondSampleDefault);
  const persistUpscaleState = () => {
    node.properties.h3_upscale_settings = { ...upscaleSettings };
    node.properties.h3_upscale_source = upscaleSource ? { ...upscaleSource } : null;
    node.properties.h3_upscale_result = upscaleResult ? { ...upscaleResult } : null;
  };
  const migrateTextRefs = () => {
    if (!Array.isArray(node.properties.h3_text_refs)) node.properties.h3_text_refs = [];
    const refLists = textSegs.map((seg) => Array.isArray(seg.refs) ? seg.refs.slice() : []);
    let shared = node.properties.h3_text_refs.slice();

    // 旧工作流只在每段 refs 里保存共享图：抽取所有段共同的前缀。
    if (!shared.length && refLists.length && refLists.every((refs) => refs.length)) {
      shared = refLists[0].slice();
      for (const refs of refLists.slice(1)) {
        let n = 0;
        while (n < shared.length && n < refs.length && shared[n] === refs[n]) n++;
        shared.length = n;
        if (!shared.length) break;
      }
      if (shared.length) node.properties.h3_text_refs = shared.slice();
    }

    // v2.13 及更早版本会在每次保存时再次把共享图拼到每段前面；循环剥离所有重复前缀。
    if (shared.length) {
      for (const seg of textSegs) {
        let refs = Array.isArray(seg.refs) ? seg.refs.slice() : [];
        const hasPrefix = () => shared.every((name, i) => refs[i] === name);
        while (refs.length >= shared.length && hasPrefix()) refs = refs.slice(shared.length);
        seg.refs = refs;
      }
    }
  };
  const clearRemovedLowVramMetadata = () => {
    const lists = [createSegs, videoSegs, textSegs];
    lists.forEach((items) => items.forEach((seg) => {
      if (!seg || typeof seg !== "object") return;
      delete seg.h3_chunk_ffn;
      delete seg._low_vram;
    }));
    delete node.properties.h3_chunk_ffn_enabled;
    if (unloadWidget) unloadWidget.value = false;
  };
  const defaultCreateSegments = () => defaultSegs().map((segment) => {
    applySecondSampleDefault(segment);
    return segment;
  });
  const emptyCreateProjectState = () => ({
    segments: defaultCreateSegments(),
    script: "",
    script_dirty: false,
    global_prompt: "",
    auto_global_value: "",
    timeline_videos: [],
    global_refs: [],
    global_asset_refs: [],
    asset_slots: [],
    audio_assets: [],
    narrator_voice_asset_id: "",
    novel_duration: "",
  });
  const captureCreateProjectState = () => ({
    segments: createSegs,
    script: String(node.properties.h3_create_script || ""),
    script_dirty: !!node.properties.h3_create_script_dirty,
    global_prompt: modeGlobalPrompt("create"),
    auto_global_value: String(node.properties.h3_create_auto_global_value || ""),
    timeline_videos: createTimelineVideos,
    global_refs: Array.isArray(node.properties.h3_create_global_refs) ? node.properties.h3_create_global_refs : [],
    global_asset_refs: Array.isArray(node.properties.h3_create_global_asset_refs)
      ? node.properties.h3_create_global_asset_refs : [],
    asset_slots: Array.isArray(node.properties.h3_create_asset_slots) ? node.properties.h3_create_asset_slots : [],
    audio_assets: Array.isArray(node.properties.h3_create_audio_assets) ? node.properties.h3_create_audio_assets : [],
    narrator_voice_asset_id: String(node.properties.h3_create_narrator_voice_asset_id || ""),
    novel_duration: node.properties.h3_create_novel_duration || "",
  });
  const persistCreateProjectStore = () => {
    node.properties.h3_create_projects_v1 = createProjectStore;
    node.properties.h3_create_active_project_id = createProjectStore
      ? String(node.properties.h3_create_active_project_id || "") : "";
  };
  const captureActiveCreateProject = () => {
    if (!createProjectsReady || applyingCreateProject || !createProjectStore) return;
    const activeId = String(node.properties.h3_create_active_project_id || "");
    if (!getH3Project(createProjectStore, activeId)) return;
    saveH3Project(createProjectStore, activeId, captureCreateProjectState(), sel);
    persistCreateProjectStore();
  };
  const applyCreateProjectState = (project) => {
    if (!project) return false;
    const state = project.state && typeof project.state === "object" ? project.state : emptyCreateProjectState();
    createSegs = Array.isArray(state.segments) && state.segments.length
      ? cloneH3ProjectValue(state.segments) : defaultCreateSegments();
    normalizeSegmentDurations(createSegs);
    normalizeSegmentKeyframes(createSegs);
    normalizeSegmentSecondSamples(createSegs);
    createTimelineVideos = normalizeCreateTimelineVideos(state.timeline_videos, createSegs.length);
    node.properties.h3_create_script = String(state.script || "");
    node.properties.h3_create_script_dirty = !!state.script_dirty;
    node.properties.h3_create_global_prompt = String(state.global_prompt || "");
    node.properties.h3_create_auto_global_value = String(state.auto_global_value || "");
    node.properties.h3_create_timeline_videos = createTimelineVideos;
    node.properties.h3_create_global_refs = cloneH3ProjectValue(state.global_refs || []);
    node.properties.h3_create_global_asset_refs = cloneH3ProjectValue(state.global_asset_refs || []);
    node.properties.h3_create_asset_slots = cloneH3ProjectValue(state.asset_slots || []);
    node.properties.h3_create_audio_assets = cloneH3ProjectValue(state.audio_assets || []);
    node.properties.h3_create_narrator_voice_asset_id = String(state.narrator_voice_asset_id || "");
    node.properties.h3_create_novel_duration = state.novel_duration || "";
    sel = Math.max(0, Math.min(Math.round(Number(project.selected_segment) || 0), createSegs.length - 1));
    if (curMode() === "create") {
      segs = createSegs;
      syncGlobalPromptWidget("create");
    }
    return true;
  };
  const initializeCreateProjects = () => {
    createProjectsReady = false;
    applyingCreateProject = true;
    try {
      const legacyId = ensureProjectId();
      const normalized = createH3ProjectStore(
        node.properties.h3_create_projects_v1,
        node.properties.h3_create_active_project_id,
        legacyId,
        captureCreateProjectState(),
        newProjectId,
      );
      createProjectStore = normalized.store;
      let project = getH3Project(createProjectStore, normalized.activeId) || createProjectStore.projects[0];
      const claimedId = claimProjectId(project.id);
      if (claimedId !== project.id) project.id = claimedId;
      node.properties.h3_create_active_project_id = project.id;
      applyCreateProjectState(project);
      persistCreateProjectStore();
    } finally {
      applyingCreateProject = false;
      createProjectsReady = true;
    }
  };
  const refreshCreatePromptAssetBindings = () => {
    let changed = false;
    createSegs.forEach((segment, index) => {
      if (segment && segment.asset_only_prompt_import) return;
      const prompt = String(segment && segment.prompt || "");
      if (!/Reference asset bindings \(project IDs stay stable;/i.test(prompt)
          && !/[@＠][CPSG]\d+/i.test(prompt)
          && !/^\s*subject_definitions\s*[:：]/im.test(prompt)) return;
      const assets = (segment.refs || []).map((file) => {
        const meta = getRefAssetMeta(node, file);
        return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
          aliases: meta.aliases, filename: meta.filename };
      });
      const nextPrompt = bindOrdinaryPromptToAssets(
        prompt, assets, index > 0 && segment.use_tail !== false);
      if (nextPrompt !== prompt) {
        segment.prompt = nextPrompt;
        changed = true;
      }
    });
    return changed;
  };
  const secondSampleAspectForExecution = (segment) => {
    const segmentWidth = Number(segment && segment.width);
    const segmentHeight = Number(segment && segment.height);
    if (segmentWidth >= 256 && segmentHeight >= 256) {
      return { width: segmentWidth, height: segmentHeight };
    }
    const linked = resolveLinkedAspectPreview(node, node.graph || app.graph);
    const widthWidget = node.widgets.find((widget) => widget.name === "width");
    const heightWidget = node.widgets.find((widget) => widget.name === "height");
    return {
      width: Number(linked.width) || Number(widthWidget?.value) || 832,
      height: Number(linked.height) || Number(heightWidget?.value) || 480,
    };
  };
  const segmentForExecution = (segment) => {
    const { second_sample_restore: _secondSampleRestore, ...executionSegment } = segment;
    const config = normalizeH3SecondSample(segment.second_sample, segment);
    if (config.mode === "off") {
      delete executionSegment.second_sample;
      return executionSegment;
    }
    const aspect = secondSampleAspectForExecution(segment);
    executionSegment.second_sample = h3SecondSampleExecutionConfig(
      config, aspect.width, aspect.height);
    return executionSegment;
  };
  const createSegmentsForExecution = () => createSegs.map((segment, index) => {
    if (!segment || typeof segment !== "object") return segment;
    const executionSegment = segmentForExecution(segment);
    if (!segment.asset_only_prompt_import) return executionSegment;
    const assets = (executionSegment.refs || []).map((file) => {
      const meta = getRefAssetMeta(node, file);
      return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
        aliases: meta.aliases, filename: meta.filename };
    });
    return {
      ...executionSegment,
      prompt: bindCreatePromptDirectToAssets(
        executionSegment.prompt, assets, index > 0 && executionSegment.use_tail !== false),
    };
  });
  const segmentsForExecution = (list) => list.map((segment) => {
    if (!segment || typeof segment !== "object") return segment;
    return segmentForExecution(segment);
  });
  const save = () => {
    captureCurrentGlobalPrompt();
    persistUpscaleState();
    normalizeSummaryWidget();
    ensureProjectId();
    normalizeSegmentDurations(createSegs);
    normalizeSegmentDurations(videoSegs);
    normalizeSegmentDurations(textSegs);
    normalizeSegmentKeyframes(createSegs);
    normalizeSegmentKeyframes(videoSegs);
    normalizeSegmentKeyframes(textSegs);
    normalizeSegmentSecondSamples(createSegs);
    normalizeSegmentSecondSamples(videoSegs);
    normalizeSegmentSecondSamples(textSegs);
    refreshCreatePromptAssetBindings();
    captureActiveCreateProject();
    createTimelineVideos = normalizeCreateTimelineVideos(createTimelineVideos, createSegs.length);
    node.properties.h3_create_timeline_videos = createTimelineVideos;
    jsonWidget.value = JSON.stringify(createSegmentsForExecution());
    if (vJsonWidget) vJsonWidget.value = JSON.stringify(segmentsForExecution(videoSegs));
    if (tJsonWidget) tJsonWidget.value = JSON.stringify(segmentsForExecution(textSegs));
    if (textSharedRefsWidget) textSharedRefsWidget.value = JSON.stringify(node.properties.h3_text_refs || []);
    if (modeWidget) modeWidget.value = curMode();
  };
  let deferredSaveTimer = null;
  const scheduleSave = () => {
    if (deferredSaveTimer) clearTimeout(deferredSaveTimer);
    deferredSaveTimer = setTimeout(() => {
      deferredSaveTimer = null;
      save();
    }, 180);
  };
  const flushScheduledSave = () => {
    if (!deferredSaveTimer) return;
    clearTimeout(deferredSaveTimer);
    deferredSaveTimer = null;
    save();
  };
  let scriptDirtySaveTimer = null;
  const scriptSegmentsForMode = (mode) => mode === "text" ? textSegs : createSegs;
  const markScriptDirty = (mode) => {
    const key = mode === "text" ? "h3_text_script_dirty" : "h3_create_script_dirty";
    node.properties[key] = true;
    if (scriptDirtySaveTimer) clearTimeout(scriptDirtySaveTimer);
    scriptDirtySaveTimer = setTimeout(() => {
      scriptDirtySaveTimer = null;
      save();
    }, 180);
  };
  const clearScriptDirty = (mode) => {
    const key = mode === "text" ? "h3_text_script_dirty" : "h3_create_script_dirty";
    node.properties[key] = false;
    scriptSegmentsForMode(mode).forEach((segment) => { if (segment) delete segment.script_dirty; });
  };
  const prepareCurrentTimelineForRun = () => {
    const mode = curMode();
    if (mode === "video") return "";
    const dirtyKey = mode === "text" ? "h3_text_script_dirty" : "h3_create_script_dirty";
    const segments = scriptSegmentsForMode(mode);
    const hasLegacyDirtyFlag = segments.some((segment) => Boolean(segment && segment.script_dirty));
    if (!node.properties[dirtyKey] && !hasLegacyDirtyFlag) return "";
    segments.forEach((segment) => { if (segment) delete segment.script_dirty; });
    return "脚本框有未导入修改；本次按当前时间轴运行";
  };

  const createGlobalAssetLibrary = () => collectCreateGlobalAssetLibrary(node, createSegs);
  const createMentionAssetLibrary = () => [
    ...createGlobalAssetLibrary().map((asset) => ({ ...asset, kind: "image" })),
    ...collectCreateAudioAssetLibrary(node, createSegs),
  ];
  const createNarratorVoiceAsset = () => collectCreateAudioAssetLibrary(node, createSegs)
    .find((asset) => asset.asset_id
      === String(node.properties.h3_create_narrator_voice_asset_id || "").toUpperCase()) || null;

  const uploadedAssetCatalog = (assetSegments, extraFiles = []) => {
    const uploaded = assetSegments === createSegs
      ? createGlobalAssetLibrary() : collectAssetLibrary(node, assetSegments || []);
    const seen = new Set(uploaded.map((asset) => asset.file));
    for (const file of extraFiles || []) {
      if (!file || seen.has(file)) continue;
      seen.add(file);
      const meta = getRefAssetMeta(node, file);
      uploaded.push({ file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
        aliases: meta.aliases.slice(), filename: meta.filename });
    }
    return uploaded;
  };
  // 整篇剧本 AI 只读取“创作”参考资产库和旧文本共享参考图；视频参考页的临时图片
  // 不属于剧本资产目录，避免把动作参考素材误当成角色或场景写进剧本。
  const allUploadedAssets = () => uploadedAssetCatalog(createSegs);
  const currentAssetPromptContext = () => formatAssetPromptContext(allUploadedAssets());

  /* 有框选时只精修框选范围；没有框选时精修当前输入框全文。前后文字作为只读
     上下文发送，回写时通过 replaceH3SelectedRange 保证作用域外逐字符不变；
     不自动二次调用，避免一个润色动作消耗两次额度。 */
  const refineSelectedH3TextWithAI = async (textarea, feedback = null) => {
    const fullText = String(textarea && textarea.value || "");
    if (!fullText.trim()) {
      const message = "当前输入框是空的，请先输入剧情、分镜或提示词。";
      status.textContent = message;
      if (feedback) feedback.error("没有可精修内容", message);
      textarea && textarea.focus();
      return false;
    }
    const selectionStart = Number(textarea && textarea.selectionStart);
    const selectionEnd = Number(textarea && textarea.selectionEnd);
    const hasSelection = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)
      && selectionEnd > selectionStart;
    const start = hasSelection ? selectionStart : 0;
    const end = hasSelection ? selectionEnd : fullText.length;
    const selected = fullText.slice(start, end);
    if (selected.length > 6000) {
      const message = hasSelection
        ? `当前框选了 ${selected.length} 个字符；单次精修最多6000个字符，请缩小范围。`
        : `当前输入框有 ${selected.length} 个字符；全文精修最多6000个字符，请框选其中一部分再试。`;
      status.textContent = message;
      if (feedback) feedback.error("精修范围过长", message);
      return false;
    }
    if (feedback) feedback.working(
      hasSelection ? `正在只精修框选的 ${selected.length} 个字符` : `正在精修当前输入框全文（${selected.length} 个字符）`,
      hasSelection ? "未框选的文字不会改动；本次只调用一次 API。" : "本次只调用一次 API，不影响其它页面或分段。",
    );
    status.style.color = "";
    status.textContent = hasSelection ? "正在精修框选内容…" : "正在精修当前输入框全文…";
    const before = fullText.slice(Math.max(0, start - 800), start);
    const after = fullText.slice(end, Math.min(fullText.length, end + 800));
    const system = "你是 MiniMax H3 视频提示词的精修器。只重写用户指定的当前范围，不扩写范围外内容，不解释，不输出Markdown或代码围栏。"
      + "保留原片段的事实、否定词、数字、时长、角色名、资产名、风格与画幅；把抽象词补成少量可见、可执行的动作、空间、光线或声音细节。"
      + "不得新增人物、物种、地点、道具、对白、旁白、字幕、Logo或剧情支线。若框选的是‘字段名：字段值；’，保留字段名和末尾分号；若只框选字段值，则只返回字段值。"
      + "输出必须能原样替换指定范围，不能复述上下文，不能输出多个方案。";
    const response = await api.fetchApi("/h3director/ai_prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: `只读前文：\n${before}\n\n<<<需要替换的当前范围>>>\n${selected}\n<<<当前范围结束>>>\n\n只读后文：\n${after}` },
        ],
        images: [],
        max_tokens: Math.min(2500, Math.max(500, selected.length * 3)),
        temperature: 0.35,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.content) throw new Error(result.error || ("HTTP " + response.status));
    let replacement = String(result.content || "").trim()
      .replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (h3DialoguePolicy(fullText) === "forbid") {
      const cleaned = stripForbiddenH3StoryDialogue(replacement).text.trim();
      if (!cleaned && replacement) {
        throw new Error("AI已返回内容，但本地对白清理后为空，原文未改动");
      }
      replacement = cleaned;
    }
    if (!replacement) throw new Error("AI没有返回可写入的局部内容，原文未改动");
    const trailing = selected.match(/[；;。！？!?]\s*$/);
    if (trailing && !/[；;。！？!?]\s*$/.test(replacement)) replacement += trailing[0].trim();
    const changed = replaceH3SelectedRange(fullText, start, end, replacement);
    textarea.value = changed.text;
    textarea.focus();
    textarea.setSelectionRange(changed.start, changed.end);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent = hasSelection
      ? `已只替换框选内容（${selected.length} → ${replacement.length} 字符）；其它文字未改动`
      : `已精修当前输入框全文（${selected.length} → ${replacement.length} 字符）；其它页面和分段未改动`;
    if (feedback) feedback.clear();
    return true;
  };

  /* 主输入框保持完整宽度；七个创作分类恢复为输入框下方的横排工具栏。
     建议与当前文本语义和所选分类相邻显示；空文本不占空间，不弹对话框，不自动确认。 */
  const buildOfficialPromptAssistant = (textarea) => {
    const root = mk("div", "h3s-prompt-assist");
    const actionRow = mk("div", "h3s-prompt-actions");
    const guideOpenButton = mk("button", "h3s-btn primary", "🧭 逐项搭建提示词");
    guideOpenButton.type = "button";
    guideOpenButton.title = "在同一个主分镜输入框中逐项确认主题、镜头、动作、声音和连续性；全程本地生成，不调用AI";
    const refineSelectionButton = mk("button", "h3s-btn h3s-prompt-refine", "✨ AI精修选中");
    refineSelectionButton.type = "button";
    refineSelectionButton.title = "先在上方输入框框选一段文字；只把框选内容交给AI，未框选文字不会改动";
    const selectionHint = mk("span", "h3s-prompt-selection-state", "先框选一段文字");
    actionRow.append(guideOpenButton, refineSelectionButton, selectionHint);

    const categoryBar = mk("div", "h3s-prompt-category-bar");
    categoryBar.setAttribute("role", "toolbar");
    categoryBar.setAttribute("aria-label", "草稿创作分类");
    categoryBar.appendChild(mk("span", "h3s-prompt-category-label", "补充："));
    const categorySpecs = Object.freeze([
      { key: "story", label: "剧情" },
      { key: "character", label: "人物" },
      { key: "scene", label: "场景" },
      { key: "shot", label: "镜头" },
      { key: "action", label: "动作" },
      { key: "sound", label: "声音" },
      { key: "ending", label: "结尾" },
    ]);
    const categoryButtons = new Map();
    for (const item of categorySpecs) {
      const button = mk("button", "h3s-prompt-category", item.label);
      button.type = "button";
      button.dataset.key = item.key;
      button.setAttribute("aria-pressed", "false");
      button.title = item.key === "shot"
        ? "切换到镜头语言页面；只决定摄影机怎样运动"
        : `切换到${item.label}创作页面`;
      categoryButtons.set(item.key, button);
      categoryBar.appendChild(button);
    }
    categoryBar.appendChild(mk("span", "h3s-prompt-category-spacer", ""));
    categoryBar.append(refineSelectionButton, selectionHint);

    const guide = mk("div", "h3s-guide");
    const guideHead = mk("div", "h3s-guide-head");
    const guideProgress = mk("span", "h3s-guide-progress", "");
    const guideTitle = mk("span", "h3s-guide-title", "一句话创作");
    const guideClose = mk("button", "h3s-btn", "关闭");
    guideClose.type = "button";
    guideClose.style.padding = "2px 7px";
    guideHead.append(guideProgress, guideTitle, guideClose);
    const oneLine = mk("div", "h3s-one-line");
    const oneLineLabel = mk("div", "h3s-one-line-label", "说说你想做什么");
    const oneLineInput = mk("textarea", "h3s-one-line-input");
    oneLineInput.placeholder = "例如：我想做一个苹果广告 / 死人来电 / 末班电车里的手绘发光涂鸦";
    const oneLineState = mk("div", "h3s-one-line-state", "输入一句话后，导演台只显示当前需要决定的具体候选；不会调用AI，也不会自动确认。 ");
    const oneLineType = mk("div", "h3s-one-line-section");
    const oneLineTypeTitle = mk("div", "h3s-one-line-title", "内容类型 · 识别不对时点一下修正");
    const oneLineTypeChoices = mk("div", "h3s-one-line-choices");
    oneLineType.append(oneLineTypeTitle, oneLineTypeChoices);
    const oneLinePackages = mk("div", "h3s-one-line-section");
    const oneLinePackagesTitle = mk("div", "h3s-one-line-title", "具体创作方案 · 选择一条即可自动补齐");
    const oneLinePackageChoices = mk("div", "h3s-one-line-choices");
    oneLinePackages.append(oneLinePackagesTitle, oneLinePackageChoices);
    const oneLineDecisions = mk("div", "h3s-one-line-section");
    const oneLineDecisionsTitle = mk("div", "h3s-one-line-title", "关键选择 · 不需要逐页点下一步");
    const oneLineDecisionChoices = mk("div", "h3s-one-line-choices");
    oneLineDecisions.append(oneLineDecisionsTitle, oneLineDecisionChoices);
    const oneLineTags = mk("div", "h3s-one-line-section");
    const oneLineTagsTitle = mk("div", "h3s-one-line-title", "已确定内容");
    const oneLineTagList = mk("div", "h3s-one-line-tags");
    oneLineTags.append(oneLineTagsTitle, oneLineTagList);
    const oneLineDetails = mk("details", "h3s-one-line-details");
    const oneLineDetailsSummary = mk("summary", null, "查看/修改自动填写的人物、场景、道具和其它具体内容");
    const oneLineDetailGrid = mk("div", "h3s-one-line-detail-grid");
    oneLineDetails.append(oneLineDetailsSummary, oneLineDetailGrid);
    const oneLineShots = mk("div", "h3s-one-line-section");
    const oneLineShotsTitle = mk("div", "h3s-one-line-title", "实时镜头预览 · 几秒拍什么");
    const oneLineShotList = mk("div", "h3s-one-line-shot-list");
    oneLineShots.append(oneLineShotsTitle, oneLineShotList);
    const oneLineActions = mk("div", "h3s-one-line-actions");
    const oneLineUndo = mk("button", "h3s-btn", "撤销上次选择");
    const oneLineReset = mk("button", "h3s-btn", "清空重新开始");
    const oneLineSpacer = mk("span", "spacer", "");
    const oneLineGenerate = mk("button", "h3s-btn primary", "生成官方Base并导入");
    const oneLineAppend = mk("button", "h3s-btn", "追加到输入框末尾");
    [oneLineUndo, oneLineReset, oneLineGenerate, oneLineAppend].forEach((button) => { button.type = "button"; });
    oneLineActions.append(oneLineUndo, oneLineReset, oneLineSpacer, oneLineGenerate, oneLineAppend);
    oneLine.append(oneLineLabel, oneLineInput, oneLineState, oneLineType, oneLinePackages,
      oneLineDecisions, oneLineTags, oneLineDetails, oneLineShots, oneLineActions);
    const guideTemplate = mk("div", "h3s-guide-template");
    const guideTemplateLabel = mk("div", "h3s-guide-template-label", "可视化创作模板（独立于下方格式骨架）");
    const guideTemplateRow = mk("div", "h3s-guide-template-row");
    const guideTemplateSelect = mk("select");
    const guideTemplatePlaceholder = document.createElement("option");
    guideTemplatePlaceholder.value = "";
    guideTemplatePlaceholder.textContent = "选择创作模板与专属镜头语言（不会调用AI）";
    guideTemplateSelect.appendChild(guideTemplatePlaceholder);
    const guideTemplateGroups = new Map();
    for (const item of H3_GUIDED_TEMPLATES) {
      let group = guideTemplateGroups.get(item.group);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = item.group;
        guideTemplateGroups.set(item.group, group);
        guideTemplateSelect.appendChild(group);
      }
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      group.appendChild(option);
    }
    const guideTemplateDescription = mk("div", "h3s-guide-template-description",
      "选择后只显示当前模板真正需要的步骤、主题联动候选和专属镜头语言；镜头选择会真实改变绝对时间、景别、机位、动作与运镜。");
    guideTemplateRow.append(guideTemplateSelect);
    guideTemplate.append(guideTemplateLabel, guideTemplateRow, guideTemplateDescription);
    const guideNote = mk("div", "h3s-guide-note", "输入主题后会展开全部专属步骤和镜头秒数；每项都能点选候选或直接修改。 ");
    const guideOverview = mk("div", "h3s-guide-overview");
    const guideChoices = mk("div", "h3s-guide-choices");
    const guideInput = mk("textarea", "h3s-guide-input");
    const guideSegmentForm = mk("div", "h3s-guide-segment-form");
    const guideSegmentInputs = new Map();
    const guideSegmentChoiceLists = new Map();
    for (const field of H3_GUIDED_SEGMENT_FIELDS) {
      const label = mk("label", null, field.label);
      label.appendChild(mk("small", null, "快捷参考可多选"));
      const control = mk("div", "h3s-guide-segment-control");
      const input = mk("textarea");
      input.placeholder = field.placeholder;
      input.dataset.key = field.key;
      const quickChoices = mk("div", "h3s-guide-field-choices");
      guideSegmentInputs.set(field.key, input);
      guideSegmentChoiceLists.set(field.key, quickChoices);
      control.append(input, quickChoices);
      guideSegmentForm.append(label, control);
    }
    const guidePreview = mk("pre", "h3s-guide-preview", "");
    guidePreview.style.display = "none";
    const guideNav = mk("div", "h3s-guide-nav");
    const guideBack = mk("button", "h3s-btn", "上一步");
    const guideSkip = mk("button", "h3s-btn", "跳过");
    const guideNext = mk("button", "h3s-btn primary", "下一步");
    const guideReplace = mk("button", "h3s-btn primary", "写入并解析导入");
    const guideAppend = mk("button", "h3s-btn", "追加到输入框末尾");
    const guideSpacer = mk("span", "spacer", "");
    [guideBack, guideSkip, guideNext, guideReplace, guideAppend].forEach((button) => { button.type = "button"; });
    guideReplace.style.display = "none";
    guideAppend.style.display = "none";
    guideNav.append(guideBack, guideSkip, guideSpacer, guideNext, guideReplace, guideAppend);
    guide.append(guideHead, oneLine, guideTemplate, guideNote, guideOverview, guideChoices, guideInput, guideSegmentForm, guidePreview, guideNav);
    /* 旧版多模板/逐步“下一步”流程保留为源码兼容层但不再进入默认界面。30套模板
       继续在后台决定规则；用户只操作上方一句话和动态候选。 */
    guideTemplate.style.display = "none";
    guideNote.style.display = "none";
    guideOverview.style.display = "none";
    guideChoices.style.display = "none";
    guideInput.style.display = "none";
    guideSegmentForm.style.display = "none";
    guidePreview.style.display = "none";
    guideNav.style.display = "none";
    /* guide/oneLine 保留为后台状态机和旧工作流草稿兼容层，但不再挂进可见 DOM。 */
    const menu = mk("div", "h3s-prompt-menu");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "主输入框内联创作引导");
    menu.dataset.h3InlineSuggestions = "1";
    menu.__h3Owner = textarea;
    for (const old of document.querySelectorAll('.h3s-prompt-menu[data-h3-inline-suggestions="1"]')) {
      if (!old.__h3Owner || !old.__h3Owner.isConnected) old.remove();
    }
    const assistHeader = mk("div", "h3s-prompt-context-head");
    const choices = mk("div", "h3s-prompt-choices");
    menu.append(assistHeader, choices);
    /* 分类栏始终横排；建议在同一区域原位展开，隐藏时不占高度，也不会挂到 document.body。 */
    root.append(categoryBar, menu);

    let activeTrigger = null;
    let activeManualCategory = "";
    const updateCategoryButtons = () => {
      for (const [key, button] of categoryButtons) {
        const active = key === activeManualCategory;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      }
    };
    const hideMenu = () => {
      activeTrigger = null;
      menu.classList.remove("show");
      textarea.classList.remove("h3s-inline-guide-owner");
      updateCategoryButtons();
    };
    const compactPromptAssistValue = (value, max = 420) => {
      const text = String(value || "").trim().replace(/\s*\n+\s*/g, "；");
      return text.length > max ? text.slice(0, max).replace(/[，,；;、\s]+$/g, "") + "…" : text;
    };
    const promptAssistContexts = () => {
      const textareaBeforeCaret = String(textarea.value || "")
        .slice(0, typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length)
        .replace(/(?:【\s*)?(?:核心创意|画面过程描述|整体要求补充|相机节奏|环境音|环境声音|禁止项)(?:\s*】)?\s*[:：]?\s*$/i, "")
        .trim();
      const topic = String(guideValues.creative_topic || oneLineInput.value || textareaBeforeCaret || "").trim();
      const intent = detectH3GuidedIntent(topic);
      const templateId = String(guideTemplateSelect.value || intent.primary.templateId || "narrative_short");
      const output = [];
      const add = (fields, segments, label = "当前方案") => {
        const key = `${fields.creative_package_id || label}:${fields.content || fields.story_premise || fields.product_name || fields.live_space || ""}`;
        if (!output.some((item) => item.key === key)) output.push({ key, label, fields, segments });
      };
      if (String(guideValues.creative_package_id || "") && String(guideValues.template_id || "") === templateId) {
        const applied = applyH3GuidedTemplate(templateId, guideValues);
        add(applied.fields, applied.segments, guideValues.creative_package_label || "当前方案");
      }
      const packages = getH3GuidedCreativePackages(templateId, { creative_topic: topic }, topic);
      for (const item of packages.slice(0, 3)) {
        let fields = applyH3GuidedCreativePackage(templateId, {
          creative_topic: topic,
          duration: guideValues.duration || "15秒",
          aspect: guideValues.aspect || "",
          template_id: templateId,
        }, item).fields;
        const applied = applyH3GuidedTemplate(templateId, fields);
        add(applied.fields, applied.segments, item.label);
      }
      return output.slice(0, 3);
    };
    const promptAssistOption = (key, context) => {
      const fields = context.fields || {};
      return compactPromptAssistValue(buildH3PromptAssistSection(key, fields, context.segments), 2400);
    };
    const dynamicCategoryOptions = (key) => {
      const output = [];
      const add = (label, summary = "") => {
        const clean = compactPromptAssistValue(label, 520);
        if (clean && !output.some((item) => item.label === clean)) output.push({ label: clean, summary });
      };
      for (const context of promptAssistContexts()) {
        const fields = context.fields || {};
        const segments = context.segments || [];
        if (key === "story") {
          add(fields.content || fields.story_premise || fields.narrative_spine,
            "明确目标、障碍、因果动作与可见结果；每个新镜头都推进新信息。 ");
          for (const segment of segments.slice(0, 3)) add(segment.objective || segment.action,
            "作为当前时间段的推进职责，不重复上一镜已经完成的动作。 ");
        } else if (key === "character") {
          add(fields.characters, "锁定角色数量、身份与命名，避免跨镜头新增或替换人物。 ");
          add(fields.appearance || fields.character_lock,
            "锁定脸型、服装主色、轮廓和签名道具，保证跨镜头连续。 ");
        } else if (key === "scene") {
          add(fields.scene || fields.live_space || fields.landmark_lock,
            "决定地点、时间与固定地标，后续镜头沿同一空间轴线推进。 ");
          add(fields.scene_layout || fields.opening_layout || fields.route_layout,
            "明确左中右、前中后景和运动方向，防止位置跳变。 ");
        } else if (key === "shot") {
          add(fields.shot_language || fields.camera,
            "决定镜头语言；主体动作先发生，摄影机随后响应并在结果出现后制动。 ");
          for (const segment of segments.slice(0, 4)) add(segment.camera,
            "该镜头只服务当前动作和新信息，不用空运镜拖时长。 ");
        } else if (key === "action") {
          for (const segment of segments.slice(0, 4)) add(segment.action,
            "写清接近、接触、受力或状态变化，以及动作完成后的结果。 ");
          add(fields.product_action || fields.transform_chain || fields.climax_action,
            "同一主体连续完成动作，不复原、不新增复制品、不重演上一镜。 ");
        } else if (key === "sound") {
          add(fields.sound || fields.audio_policy,
            "环境底噪持续；脚步、接触、按钮、撞击等声音只在可见动作发生时同步出现。 ");
          for (const segment of segments.slice(0, 4)) add(segment.sound,
            "声音与当前画面动作一一对应，不提前播放后续事件。 ");
        } else if (key === "ending") {
          add(segments.at(-1)?.end_state || fields.product_result || fields.space_finale || fields.payoff_action,
            "锁定最后可见结果、主体状态和空间关系，最后一秒稳定且不新增支线。 ");
        }
      }
      return output.slice(0, 6);
    };
    const availableOptions = (key) => {
      const spec = H3_PROMPT_ASSIST_CATALOG[key];
      if (!spec) return [];
      if (["story", "character", "scene", "shot", "action", "sound", "ending"].includes(key)) {
        const dynamic = dynamicCategoryOptions(key);
        const fallback = key === "shot" ? H3_CAMERA_MOVEMENT_OPTIONS : (spec.options || []);
        return [...dynamic, ...fallback].filter((item, index, list) => {
          const value = typeof item === "string" ? item : item.label;
          return list.findIndex((candidate) => (typeof candidate === "string" ? candidate : candidate.label) === value) === index;
        }).slice(0, 6);
      }
      if (key === "camera") return H3_CAMERA_MOVEMENT_OPTIONS;
      if (["core_idea", "visual_process", "overall_requirements", "camera_rhythm", "environment_sound"].includes(key)
          || ["camera", "sound", "constraint"].includes(key)) {
        const dynamic = promptAssistContexts().map((context) => promptAssistOption(key, context)).filter(Boolean);
        if (dynamic.length) return [...new Set([...dynamic, ...(spec.options || [])])].slice(0, 6);
      }
      if (key === "camera" && /(?:完整原生)?2D像素|像素风/i.test(textarea.value)) {
        return ["固定侧视镜头", "固定俯视镜头", "横向卷轴跟随", "纵向卷轴跟随", "画面整体缩放与屏幕震动"];
      }
      return spec.options;
    };
    const showInlineAssist = () => {
      menu.classList.add("show");
      textarea.classList.add("h3s-inline-guide-owner");
    };
    let guideIndex = 0;
    let guideValues = {};
    let guideSegments = [];
    let guideBaseValues = {};
    let guideBaseSegments = [];
    const guideTemplateDrafts = new Map();
    let lastGuideTemplateId = "";
    let appliedGuideTemplateId = "";
    let oneLineIntent = null;
    let oneLineTemplateManuallyChosen = false;
    let oneLineInputTimer = 0;
    let oneLineComposing = false;
    const oneLineHistory = [];
    let inlineGuideSession = null;
    let inlineGuideRenderTimer = 0;
    const cloneInlineFields = (value) => JSON.parse(JSON.stringify(value || {}));
    const inlineGuidePlan = () => inlineGuideSession
      ? buildH3InlineGuidePlan(inlineGuideSession.templateId, inlineGuideSession.fields,
        { topic: inlineGuideSession.topic })
      : { steps: [] };
    const inlineGuideCurrentStep = () => {
      const plan = inlineGuidePlan();
      return plan.steps.find((step) => !inlineGuideSession.confirmedKeys.has(step.key)) || null;
    };
    const inlineGuideStepNumber = (step, plan = inlineGuidePlan()) => Math.max(0,
      plan.steps.findIndex((item) => item.key === step?.key));
    const compactInlineDraftValue = (value, max = 170) => {
      const clean = String(value || "").trim().replace(/\s*\n+\s*/g, "；");
      return clean.length > max ? clean.slice(0, max).replace(/[，,；;、\s]+$/g, "") + "…" : clean;
    };
    const inlineGuideDraftMarker = (step) => `\n【当前填写】\n${step.label}：\n`;
    const readInlineGuideDraft = (step) => {
      if (!step) return "";
      const source = String(textarea.value || "");
      const marker = inlineGuideDraftMarker(step);
      const index = source.lastIndexOf(marker);
      if (index < 0) return String(inlineGuideSession?.draftValue || "").trim();
      return source.slice(index + marker.length).trim();
    };
    const writeInlineGuideDraft = (step, value = "") => {
      if (!inlineGuideSession || !step) return;
      inlineGuideSession.draftValue = String(value || "").trim();
      const plan = inlineGuidePlan();
      const completed = [];
      for (let index = 0; index < plan.steps.length; index++) {
        const item = plan.steps[index];
        if (!inlineGuideSession.confirmedKeys.has(item.key)) continue;
        const confirmedValue = compactInlineDraftValue(inlineGuideSession.fields[item.key]);
        if (confirmedValue) completed.push(`${item.label}：${confirmedValue}`);
      }
      const lines = [
        "【创作搭建草稿】",
        `主题：${inlineGuideSession.topic}`,
      ];
      if (completed.length) lines.push("", "已确定：", ...completed);
      lines.push("", "【当前填写】", `${step.label}：`, inlineGuideSession.draftValue);
      textarea.value = lines.join("\n");
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const showInlineGuideMenu = () => {
      if (!inlineGuideSession) return false;
      activeTrigger = { key: "inline_guide" };
      choices.replaceChildren();
      choices.classList.remove("h3s-prompt-choices-compact");
      const plan = inlineGuidePlan();
      const step = inlineGuideCurrentStep();
      if (!step) {
        const head = mk("div", "h3s-inline-guide-head");
        head.append(mk("span", "h3s-inline-guide-progress", `${plan.steps.length}/${plan.steps.length}`),
          mk("span", "h3s-inline-guide-title", "搭建完成 · 生成前确认"));
        choices.append(head,
          mk("div", "h3s-inline-guide-purpose", "你已经逐项确定了影响画面的内容。可以修改任意一项；只有最终确认后才会编译完整官方 Base。"));
        const summary = mk("div", "h3s-inline-guide-summary");
        for (let index = 0; index < plan.steps.length; index++) {
          const item = plan.steps[index];
          const row = mk("div", "h3s-inline-guide-option");
          row.appendChild(mk("div", "h3s-inline-guide-option-text",
            `${index + 1}. ${item.label}：${compactInlineDraftValue(inlineGuideSession.fields[item.key], 220)}`));
          const edit = mk("button", "h3s-inline-guide-select", "修改");
          edit.type = "button";
          edit.addEventListener("pointerdown", (event) => event.preventDefault());
          edit.addEventListener("click", () => reviseInlineGuideStep(item.key));
          row.appendChild(edit);
          summary.appendChild(row);
        }
        choices.appendChild(summary);
        const actions = mk("div", "h3s-inline-guide-actions");
        const generate = mk("button", "h3s-inline-guide-confirm", "确认并生成官方Base");
        generate.type = "button";
        const revise = mk("button", "h3s-inline-guide-secondary", "修改上一项");
        revise.type = "button";
        generate.addEventListener("pointerdown", (event) => event.preventDefault());
        revise.addEventListener("pointerdown", (event) => event.preventDefault());
        generate.addEventListener("click", () => compileInlineGuide());
        revise.addEventListener("click", () => revisePreviousInlineGuideStep());
        actions.append(generate, revise);
        choices.appendChild(actions);
        showInlineAssist();
        return true;
      }
      const currentIndex = inlineGuideStepNumber(step, plan);
      const head = mk("div", "h3s-inline-guide-head");
      head.append(mk("span", "h3s-inline-guide-progress", `第${currentIndex + 1}/${plan.steps.length}步`),
        mk("span", "h3s-inline-guide-title", step.title));
      choices.append(head, mk("div", "h3s-inline-guide-purpose", `作用：${step.purpose}`),
        mk("div", "h3s-inline-guide-prompt", step.prompt));
      const selectedParts = String(inlineGuideSession.draftValue || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
      let liveStepOptions = step.options;
      if (step.key === "product_name" && isValidH3ProductNameCandidate(inlineGuideSession.draftValue)) {
        const livePlan = buildH3InlineGuidePlan(inlineGuideSession.templateId, {
          ...inlineGuideSession.fields, product_name: inlineGuideSession.draftValue,
        }, { topic: inlineGuideSession.draftValue });
        liveStepOptions = livePlan.steps.find((item) => item.key === step.key)?.options || liveStepOptions;
      }
      const optionValues = [inlineGuideSession.draftValue, ...liveStepOptions]
        .map((item) => String(item || "").trim()).filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .filter((item) => step.key !== "product_name" || isValidH3ProductNameCandidate(item));
      const optionStrip = mk("div", "h3s-inline-guide-options-strip");
      for (const value of optionValues) {
        const row = mk("div", "h3s-inline-guide-option");
        row.classList.toggle("selected", selectedParts.includes(value));
        row.appendChild(mk("div", "h3s-inline-guide-option-text", value));
        const select = mk("button", "h3s-inline-guide-select", "选择");
        select.type = "button";
        select.addEventListener("pointerdown", (event) => event.preventDefault());
        select.addEventListener("click", () => {
          let next = value;
          if (step.multiple) {
            const parts = [...selectedParts];
            const index = parts.indexOf(value);
            if (index >= 0) parts.splice(index, 1); else parts.push(value);
            next = parts.join("\n");
          }
          writeInlineGuideDraft(step, next);
          showInlineGuideMenu();
          status.style.color = "";
          status.textContent = `已把“${step.label}”作为可编辑草稿写入主输入框；修改满意后再点确认，不会自动进入下一步`;
        });
        row.appendChild(select);
        optionStrip.appendChild(row);
      }
      choices.appendChild(optionStrip);
      const actions = mk("div", "h3s-inline-guide-actions");
      const confirm = mk("button", "h3s-inline-guide-confirm", "确认这一项并继续");
      confirm.type = "button";
      confirm.addEventListener("pointerdown", (event) => event.preventDefault());
      confirm.addEventListener("click", () => confirmInlineGuideStep());
      actions.appendChild(confirm);
      if (inlineGuideSession.confirmedOrder.length) {
        const revise = mk("button", "h3s-inline-guide-secondary", "修改上一项");
        revise.type = "button";
        revise.addEventListener("pointerdown", (event) => event.preventDefault());
        revise.addEventListener("click", () => revisePreviousInlineGuideStep());
        actions.appendChild(revise);
      }
      const cancel = mk("button", "h3s-inline-guide-secondary", "保留草稿并关闭引导");
      cancel.type = "button";
      cancel.addEventListener("pointerdown", (event) => event.preventDefault());
      cancel.addEventListener("click", () => {
        inlineGuideSession = null;
        hideMenu();
        status.textContent = "已保留当前搭建草稿；重新输入一个短主题可再次开始逐步引导";
      });
      actions.appendChild(cancel);
      choices.appendChild(actions);
      showInlineAssist();
      return true;
    };
    const startInlineGuide = (option, topic) => {
      const template = H3_GUIDED_TEMPLATES.find((item) => item.id === option.templateId);
      if (!template) return;
      const cleanTopic = normalizeH3CreativeTopic(topic) || String(topic || "").trim();
      const seed = {
        creative_topic: cleanTopic, template_id: template.id,
        duration: template.forceDuration || template.defaults.duration || "15秒",
        aspect: template.forceAspect || template.defaults.aspect || "横屏16:9",
      };
      const applied = applyH3GuidedTemplate(template.id, seed);
      guideTemplateSelect.value = template.id;
      guideValues = applied.fields;
      guideSegments = applied.segments;
      appliedGuideTemplateId = template.id;
      lastGuideTemplateId = template.id;
      oneLineInput.value = cleanTopic;
      inlineGuideSession = {
        topic: cleanTopic, templateId: template.id, fields: cloneInlineFields(applied.fields),
        segments: cloneInlineFields(applied.segments), confirmedKeys: new Set(),
        confirmedOrder: [], draftValue: "",
      };
      const step = inlineGuideCurrentStep();
      writeInlineGuideDraft(step, "");
      showInlineGuideMenu();
      status.style.color = "";
      status.textContent = `已识别为“${template.name}”；请从第1步开始逐项搭建，最后确认前不会生成完整提示词`;
    };
    const confirmInlineGuideStep = () => {
      if (!inlineGuideSession) return;
      const step = inlineGuideCurrentStep();
      if (!step) return;
      let value = readInlineGuideDraft(step);
      if (step.key === "duration" && value) {
        const seconds = value.match(/\d+(?:\.\d+)?/);
        if (seconds) value = `${seconds[0]}秒`;
      }
      if (!value) {
        status.style.color = "#ffb0a8";
        status.textContent = `请先选择或填写“${step.label}”；当前步骤没有自动确认`;
        textarea.focus();
        return;
      }
      if (step.key === "dialogue_script" && value) {
        const checked = validateH3GuidedDialogueScript(value, {
          mode: inlineGuideSession.fields.dialogue,
          language: inlineGuideSession.fields.dialogue_language,
          duration: inlineGuideSession.fields.duration || "15秒", segmentSeconds: 15,
        });
        if (!checked.ok) {
          status.style.color = "#ffb0a8";
          status.textContent = checked.errors[0] || "精确台词格式不正确；请直接在当前步骤修改";
          return;
        }
        value = checked.normalized;
      }
      inlineGuideSession.fields[step.key] = value;
      inlineGuideSession.confirmedKeys.add(step.key);
      inlineGuideSession.confirmedOrder.push(step.key);
      const applied = applyH3GuidedTemplate(inlineGuideSession.templateId, {
        ...inlineGuideSession.fields, template_id: inlineGuideSession.templateId,
      });
      inlineGuideSession.fields = cloneInlineFields(applied.fields);
      inlineGuideSession.segments = cloneInlineFields(applied.segments);
      guideValues = cloneInlineFields(applied.fields);
      guideSegments = cloneInlineFields(applied.segments);
      inlineGuideSession.draftValue = "";
      const next = inlineGuideCurrentStep();
      if (next) writeInlineGuideDraft(next, "");
      else {
        const plan = inlineGuidePlan();
        const summary = plan.steps.map((item, index) =>
          `${index + 1}. ${item.label}：${compactInlineDraftValue(inlineGuideSession.fields[item.key], 240)}`).join("\n");
        textarea.value = `【创作搭建完成，等待最终确认】\n主题：${inlineGuideSession.topic}\n类型：${plan.templateName}\n\n${summary}`;
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      showInlineGuideMenu();
      status.style.color = "";
      status.textContent = next
        ? `“${step.label}”已确认；现在进入“${next.label}”，请继续选择或手动修改`
        : "所有步骤已完成；请检查摘要，只有点击“确认并生成官方Base”才会生成完整提示词";
    };
    const reviseInlineGuideStep = (requestedKey) => {
      if (!inlineGuideSession || !inlineGuideSession.confirmedOrder.length) return;
      const plan = inlineGuidePlan();
      const key = String(requestedKey || inlineGuideSession.confirmedOrder.at(-1) || "");
      const selectedIndex = plan.steps.findIndex((item) => item.key === key);
      if (selectedIndex < 0) return;
      const invalidated = new Set(plan.steps.slice(selectedIndex).map((item) => item.key));
      for (const invalidKey of invalidated) inlineGuideSession.confirmedKeys.delete(invalidKey);
      inlineGuideSession.confirmedOrder = inlineGuideSession.confirmedOrder.filter((item) => !invalidated.has(item));
      const step = plan.steps.find((item) => item.key === key) || inlineGuideCurrentStep();
      writeInlineGuideDraft(step, inlineGuideSession.fields[key] || "");
      showInlineGuideMenu();
      status.style.color = "";
      status.textContent = `正在修改“${step.label}”；由于后续候选可能受它影响，这一项之后的内容会重新逐步确认`;
    };
    const revisePreviousInlineGuideStep = () => reviseInlineGuideStep();
    const compileInlineGuide = () => {
      if (!inlineGuideSession) return;
      if (inlineGuideCurrentStep()) {
        status.style.color = "#ffb0a8";
        status.textContent = "仍有步骤没有确认，尚未生成官方Base";
        showInlineGuideMenu();
        return;
      }
      const concrete = validateH3GuidedConcreteFields(inlineGuideSession.templateId, inlineGuideSession.fields);
      if (!concrete.ok) {
        const issue = concrete.issues[0];
        const plan = inlineGuidePlan();
        if (plan.steps.some((item) => item.key === issue.key)) {
          inlineGuideSession.confirmedKeys.delete(issue.key);
          inlineGuideSession.confirmedOrder = inlineGuideSession.confirmedOrder.filter((key) => key !== issue.key);
          const step = plan.steps.find((item) => item.key === issue.key);
          writeInlineGuideDraft(step, inlineGuideSession.fields[issue.key] || "");
          showInlineGuideMenu();
        }
        status.style.color = "#ffb0a8";
        status.textContent = issue.message;
        return;
      }
      if (isH3GuidedSpeechMode(inlineGuideSession.fields.dialogue)) {
        const checked = validateH3GuidedDialogueScript(inlineGuideSession.fields.dialogue_script, {
          mode: inlineGuideSession.fields.dialogue,
          language: inlineGuideSession.fields.dialogue_language,
          duration: inlineGuideSession.fields.duration || "15秒", segmentSeconds: 15,
        });
        if (!checked.ok) {
          status.style.color = "#ffb0a8";
          status.textContent = checked.errors[0] || "精确台词仍未通过检查";
          return;
        }
        inlineGuideSession.fields.dialogue_script = checked.normalized;
      }
      const applied = applyH3GuidedTemplate(inlineGuideSession.templateId, {
        ...inlineGuideSession.fields, template_id: inlineGuideSession.templateId,
      });
      const generated = buildH3GuidedDirectorScript(applied.fields, applied.segments);
      textarea.value = generated;
      textarea.focus();
      textarea.setSelectionRange(generated.length, generated.length);
      inlineGuideSession = null;
      hideMenu();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      status.style.color = "";
      status.textContent = "已按你逐步确认的内容生成官方Base；请检查后再选择导入方式";
    };
    const selectedGuidedTemplate = () => H3_GUIDED_TEMPLATES.find((item) => item.id === guideTemplateSelect.value) || null;
    const cloneOneLineState = () => ({
      input: oneLineInput.value,
      templateId: guideTemplateSelect.value,
      manual: oneLineTemplateManuallyChosen,
      fields: JSON.parse(JSON.stringify(guideValues || {})),
      segments: JSON.parse(JSON.stringify(guideSegments || [])),
    });
    const pushOneLineHistory = () => {
      oneLineHistory.push(cloneOneLineState());
      if (oneLineHistory.length > 30) oneLineHistory.shift();
    };
    const restoreOneLineState = (state) => {
      if (!state) return;
      oneLineInput.value = state.input || "";
      guideTemplateSelect.value = state.templateId || "";
      oneLineTemplateManuallyChosen = Boolean(state.manual);
      guideValues = JSON.parse(JSON.stringify(state.fields || {}));
      guideSegments = JSON.parse(JSON.stringify(state.segments || []));
      lastGuideTemplateId = guideTemplateSelect.value;
      appliedGuideTemplateId = guideTemplateSelect.value;
      oneLineIntent = detectH3GuidedIntent(oneLineInput.value);
    };
    const oneLineTemplateLabel = (templateId) => H3_GUIDED_TEMPLATES.find((item) => item.id === templateId)?.name || templateId;
    const selectOneLineTemplate = (templateId, { manual = false, keepFields = false } = {}) => {
      const selected = H3_GUIDED_TEMPLATES.find((item) => item.id === String(templateId || ""));
      if (!selected) return false;
      const previousDuration = String(guideValues.duration || "").trim();
      const previousAspect = String(guideValues.aspect || "").trim();
      const topic = String(oneLineInput.value || "").trim();
      const seed = keepFields ? { ...guideValues } : {
        creative_topic: topic,
        duration: previousDuration || selected.forceDuration || selected.defaults.duration || "15秒",
        aspect: previousAspect || selected.forceAspect || selected.defaults.aspect || "横屏16:9",
      };
      guideTemplateSelect.value = selected.id;
      seed.template_id = selected.id;
      seed.creative_topic = topic;
      const applied = applyH3GuidedTemplate(selected.id, seed);
      guideValues = applied.fields;
      guideSegments = applied.segments;
      lastGuideTemplateId = selected.id;
      appliedGuideTemplateId = selected.id;
      oneLineTemplateManuallyChosen = manual;
      return true;
    };
    const h3OneLineFieldLabel = (key) => {
      const step = H3_GUIDED_PROMPT_STEPS.find((item) => item.key === key);
      return step && (step.label || step.title) || {
        content: "具体故事", scene_layout: "固定布局", live_space: "实拍地点", contact_method: "真实接触",
        drawn_entity: "手绘主体", transform_chain: "变形链", chase_route: "追逐路线", filmer_reaction: "拍摄者反应",
        space_finale: "空间结尾", product_name: "产品", product_action: "核心操作", product_result: "可见结果",
      }[key] || key;
    };
    const oneLineDetailKeys = () => {
      const selected = selectedGuidedTemplate();
      const ui = selected && getH3GuidedVisibleTemplateUi(selected.id, guideValues);
      const keys = [...(ui && ui.steps || [])];
      for (const key of ["content", "characters", "appearance", "scene", "scene_layout", "props",
        "live_space", "contact_method", "drawn_entity", "center_color", "transform_chain", "chase_route",
        "filmer_reaction", "space_finale", "product_name", "product_material", "product_action", "product_result",
        "dialogue_script"]) {
        if (Object.hasOwn(guideValues, key) && !keys.includes(key)) keys.push(key);
      }
      return keys.filter((key) => !["duration", "shot_language", "dialogue", "text_mode", "aspect"].includes(key));
    };
    const oneLineShotSummary = () => {
      const summary = [];
      for (const segment of guideSegments || []) {
        for (const line of String(segment && segment.internal_shots || "").split(/\n+/)) {
          const match = line.match(/全片(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒[^：]*：镜头职责=([^；]+).*?动作=([^；]+).*?本镜新增信息\/结果=([^；]+)[；。]/);
          if (match) summary.push({ start: Number(match[1]), end: Number(match[2]), title: match[3], value: `${match[4]}；结果：${match[5]}` });
        }
      }
      return summary;
    };
    const oneLineAppendDialogue = (suggestion, segmentIndex) => {
      const plan = planH3GuidedSegments(guideValues.duration || "15秒");
      const segment = plan.segments[Math.max(0, Math.min(plan.segments.length - 1, segmentIndex))];
      if (!segment || !suggestion) return;
      const existing = String(guideValues.dialogue_script || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const sameSegmentCount = existing.filter((line) => {
        const start = Number((line.match(/^(\d+(?:\.\d+)?)/) || [])[1]);
        return Number.isFinite(start) && start >= segment.start && start < segment.end;
      }).length;
      const start = Math.min(segment.end - 2.1, segment.start + 0.8 + sameSegmentCount * 3.1);
      const end = Math.min(segment.end - 0.2, start + 2.2);
      const line = `${start.toFixed(3)}–${end.toFixed(3)}秒｜${suggestion.speaker}｜${suggestion.text}`;
      guideValues.dialogue_script = [...existing, line].join("\n");
      const applied = applyH3GuidedTemplate(guideTemplateSelect.value, guideValues);
      guideValues = applied.fields;
      guideSegments = applied.segments;
    };
    const oneLineDecisionGroups = () => {
      const selected = selectedGuidedTemplate();
      if (!selected) return [];
      const groups = [];
      const durations = selected.forceDuration ? [selected.forceDuration]
        : (selected.durationOptions.length ? selected.durationOptions : ["15秒", "30秒", "60秒"]);
      groups.push({ key: "duration", label: "时长", values: durations });
      if (!selected.forceAspect) groups.push({ key: "aspect", label: "画幅", values: ["横屏16:9", "竖屏9:16"] });
      groups.push({ key: "shot_language", label: "镜头感觉", values: selected.directing.shots.options });
      if (/(?:^|_)product_ad(?:_|$)/.test(selected.id)) {
        groups.push({ key: "text_mode", label: "画面文字", values: ["无文字", "唯一中文文案", "唯一英文文案"] });
      }
      const ui = getH3GuidedTemplateUi(selected.id);
      if (ui && ui.steps.includes("dialogue")) {
        groups.push({ key: "dialogue", label: "声音/对白", values: [
          H3_GUIDED_DIALOGUE_MODES[0], H3_GUIDED_DIALOGUE_MODES[2], H3_GUIDED_DIALOGUE_MODES[3], H3_GUIDED_DIALOGUE_MODES[4],
        ] });
      }
      return groups;
    };
    const serializeOneLineDialogueRows = () => {
      const lines = [];
      for (const row of oneLineDetailGrid.querySelectorAll(".h3s-one-line-dialogue-row")) {
        const start = Number(row.querySelector('[data-part="start"]')?.value);
        const end = Number(row.querySelector('[data-part="end"]')?.value);
        const speaker = String(row.querySelector('[data-part="speaker"]')?.value || "").trim();
        const text = String(row.querySelector('[data-part="text"]')?.value || "").trim();
        if (Number.isFinite(start) && Number.isFinite(end) && speaker && text) {
          lines.push(`${start.toFixed(3)}–${end.toFixed(3)}秒｜${speaker}｜${text}`);
        }
      }
      guideValues.dialogue_script = lines.join("\n");
      const applied = applyH3GuidedTemplate(guideTemplateSelect.value, guideValues);
      guideValues = applied.fields;
      guideSegments = applied.segments;
    };
    const addOneLineDialogueRow = (container, entry, speakers, segment) => {
      const row = mk("div", "h3s-one-line-dialogue-row");
      const start = mk("input"); start.type = "number"; start.step = "0.1"; start.dataset.part = "start";
      const end = mk("input"); end.type = "number"; end.step = "0.1"; end.dataset.part = "end";
      const speaker = mk("select"); speaker.dataset.part = "speaker";
      for (const name of speakers) {
        const option = document.createElement("option"); option.value = name; option.textContent = name; speaker.appendChild(option);
      }
      const textInput = mk("input"); textInput.dataset.part = "text"; textInput.placeholder = "准确台词原文";
      const remove = mk("button", "h3s-btn", "删除"); remove.type = "button";
      const defaultStart = segment.start + 0.8;
      start.value = Number(entry?.start ?? defaultStart).toFixed(1);
      end.value = Number(entry?.end ?? Math.min(segment.end - 0.2, defaultStart + 2.2)).toFixed(1);
      speaker.value = entry?.speaker || speakers[0] || "旁白";
      textInput.value = entry?.text || "";
      const update = () => { serializeOneLineDialogueRows(); renderOneLineCreator({ preserveScroll: true }); };
      [start, end, speaker, textInput].forEach((input) => input.addEventListener("change", update));
      textInput.addEventListener("blur", update);
      remove.addEventListener("click", () => { pushOneLineHistory(); row.remove(); serializeOneLineDialogueRows(); renderOneLineCreator({ preserveScroll: true }); });
      row.append(start, end, speaker, textInput, remove);
      container.appendChild(row);
    };
    const renderOneLineDialogue = () => {
      if (!isH3GuidedSpeechMode(guideValues.dialogue)) return;
      const mode = String(guideValues.dialogue || "");
      const allowCharacters = /角色对白/.test(mode);
      const allowNarration = /旁白/.test(mode);
      const names = String(guideValues.characters || guideValues.player1 || "").split(/[、,，；;\n]+/)
        .map((item) => item.split(/[：:]/)[0].trim()).filter((item) => item && item.length <= 10 && !/只有|主角|人物|角色/.test(item));
      const speakers = [...(allowCharacters ? names : []), ...(allowNarration ? ["旁白"] : [])]
        .filter((item, index, list) => item && list.indexOf(item) === index);
      if (!speakers.length && allowCharacters) speakers.push("主角A");
      const validation = validateH3GuidedDialogueScript(guideValues.dialogue_script || "", {
        mode: guideValues.dialogue, language: guideValues.dialogue_language || H3_GUIDED_DIALOGUE_LANGUAGES[0],
        duration: guideValues.duration || "15秒", segmentSeconds: 15,
      });
      const editableEntries = parseH3GuidedDialogueEntries(guideValues.dialogue_script || "");
      const dialogue = mk("div", "h3s-one-line-dialogue");
      dialogue.appendChild(mk("div", "h3s-one-line-title", "多句对白 · 按每15秒Director生成段分组，点击添加不会覆盖已有台词"));
      const plan = planH3GuidedSegments(guideValues.duration || "15秒");
      for (const segment of plan.segments) {
        const box = mk("div", "h3s-one-line-dialogue-segment");
        box.appendChild(mk("div", "h3s-one-line-title", `第${segment.index + 1}生成段 · ${segment.start.toFixed(0)}–${segment.end.toFixed(0)}秒`));
        const entries = editableEntries.filter((entry, entryIndex) =>
          (Number.isFinite(entry.start) && entry.start >= segment.start - 0.001 && entry.start < segment.end - 0.001)
          || (!Number.isFinite(entry.start) && segment.index === 0 && entryIndex >= 0));
        for (const entry of entries) addOneLineDialogueRow(box, entry, speakers, segment);
        const addRow = mk("button", "h3s-btn", "+ 添加一句"); addRow.type = "button";
        addRow.addEventListener("click", () => {
          pushOneLineHistory();
          const currentEntries = parseH3GuidedDialogueEntries(guideValues.dialogue_script || "");
          const count = currentEntries.filter((entry) => entry.start >= segment.start && entry.start < segment.end).length;
          const start = Math.min(segment.end - 2.2, segment.start + 0.8 + count * 3.0);
          const end = Math.min(segment.end - 0.2, start + 2.2);
          const line = `${start.toFixed(3)}–${end.toFixed(3)}秒｜${speakers[0] || "旁白"}｜请填写准确台词`;
          guideValues.dialogue_script = [guideValues.dialogue_script, line].filter(Boolean).join("\n");
          renderOneLineCreator({ preserveScroll: true });
        });
        box.appendChild(addRow);
        const suggestions = getH3GuidedDialogueSuggestions(guideTemplateSelect.value, guideValues, segment.index)
          .filter((item) => (allowNarration || item.speaker !== "旁白") && (allowCharacters || item.speaker === "旁白"));
        if (suggestions.length) {
          const suggestionChoices = mk("div", "h3s-one-line-choices");
          for (const suggestion of suggestions) {
            const button = mk("button", "h3s-one-line-choice", `${suggestion.speaker}：${suggestion.text}`); button.type = "button";
            button.addEventListener("click", () => { pushOneLineHistory(); oneLineAppendDialogue(suggestion, segment.index); renderOneLineCreator({ preserveScroll: true }); });
            suggestionChoices.appendChild(button);
          }
          box.appendChild(suggestionChoices);
        }
        dialogue.appendChild(box);
      }
      const statusEl = mk("div", `h3s-one-line-dialogue-status${validation.errors.length ? " error" : (validation.warnings.length ? " warn" : "")}`,
        validation.errors[0] || validation.warnings[0] || (validation.entries.length ? `已填写${validation.entries.length}句；时间、重叠和跨15秒边界检查通过。` : "尚未填写台词。"));
      dialogue.appendChild(statusEl);
      oneLineDetailGrid.appendChild(dialogue);
    };
    const renderOneLineCreator = ({ preserveScroll = false } = {}) => {
      const scroll = preserveScroll ? guide.scrollTop : 0;
      const topic = String(oneLineInput.value || "").trim();
      oneLineIntent = detectH3GuidedIntent(topic);
      if (!guideTemplateSelect.value || !oneLineTemplateManuallyChosen) {
        const nextId = oneLineIntent.primary.templateId;
        if (nextId && guideTemplateSelect.value !== nextId) selectOneLineTemplate(nextId, { manual: false, keepFields: false });
      }
      const selected = selectedGuidedTemplate();
      if (selected) {
        guideValues.creative_topic = topic;
        if (/product_ad/.test(selected.id) && !String(guideValues.product_name || "").trim()) {
          guideValues.product_name = inferH3ProductNameFromTopic(oneLineIntent.topic);
        }
        const applied = applyH3GuidedTemplate(selected.id, guideValues);
        guideValues = applied.fields;
        guideSegments = applied.segments;
      }
      oneLineState.textContent = topic
        ? `已识别：${selected?.name || oneLineIntent.primary.label}。请选择一条具体方案；候选只更新，不会自动采用。`
        : "输入一句话后，导演台只显示当前需要决定的具体候选；不会调用AI，也不会自动确认。";
      oneLineTypeChoices.replaceChildren();
      for (const candidate of oneLineIntent.candidates) {
        const button = mk("button", "h3s-one-line-choice", oneLineTemplateLabel(candidate.templateId)); button.type = "button";
        button.classList.toggle("active", candidate.templateId === guideTemplateSelect.value);
        button.addEventListener("click", () => { pushOneLineHistory(); selectOneLineTemplate(candidate.templateId, { manual: true }); renderOneLineCreator(); });
        oneLineTypeChoices.appendChild(button);
      }
      oneLinePackages.hidden = !topic || !selected;
      oneLinePackageChoices.replaceChildren();
      const packages = selected ? getH3GuidedCreativePackages(selected.id, guideValues, topic) : [];
      for (const item of packages) {
        const button = mk("button", "h3s-one-line-choice", item.label); button.type = "button";
        button.title = item.summary;
        button.classList.toggle("active", String(guideValues.creative_package_id || "") === item.id);
        button.addEventListener("click", () => {
          pushOneLineHistory();
          const result = applyH3GuidedCreativePackage(selected.id, { ...guideValues, creative_topic: topic }, item);
          guideValues = result.fields;
          const applied = applyH3GuidedTemplate(selected.id, guideValues);
          guideValues = applied.fields; guideSegments = applied.segments;
          renderOneLineCreator({ preserveScroll: true });
        });
        oneLinePackageChoices.appendChild(button);
      }
      oneLineDecisionChoices.replaceChildren();
      for (const group of oneLineDecisionGroups()) {
        const wrap = mk("div", "h3s-one-line-section");
        wrap.appendChild(mk("div", "h3s-one-line-title", group.label));
        const buttons = mk("div", "h3s-one-line-choices");
        for (const value of group.values) {
          const button = mk("button", "h3s-one-line-choice", value); button.type = "button";
          button.classList.toggle("active", String(guideValues[group.key] || "") === String(value));
          button.addEventListener("click", () => {
            pushOneLineHistory();
            guideValues[group.key] = value;
            if (group.key === "shot_language") guideValues.shot_language_user_selected = true;
            if (group.key === "dialogue" && !isH3GuidedSpeechMode(value)) guideValues.dialogue_script = "";
            const applied = applyH3GuidedTemplate(selected.id, guideValues);
            guideValues = applied.fields; guideSegments = applied.segments;
            renderOneLineCreator({ preserveScroll: true });
          });
          buttons.appendChild(button);
        }
        wrap.appendChild(buttons); oneLineDecisionChoices.appendChild(wrap);
      }
      oneLineTagList.replaceChildren();
      const tags = [
        ["类型", selected?.name], ["方案", guideValues.creative_package_label], ["时长", guideValues.duration],
        ["画幅", guideValues.aspect], ["镜头", guideValues.shot_language], ["对白", guideValues.dialogue],
        ["文字", guideValues.text_mode],
      ].filter((item) => String(item[1] || "").trim());
      for (const [label, value] of tags) oneLineTagList.appendChild(mk("span", "h3s-one-line-tag", `${label}：${value}`));
      oneLineDetailGrid.replaceChildren();
      for (const key of oneLineDetailKeys()) {
        const field = mk("label", "h3s-one-line-detail");
        field.appendChild(mk("span", null, h3OneLineFieldLabel(key)));
        const input = mk("textarea"); input.value = String(guideValues[key] || ""); input.dataset.key = key;
        input.placeholder = "此项由具体方案自动填写；需要时可以修改";
        let composing = false;
        input.addEventListener("compositionstart", () => { composing = true; });
        input.addEventListener("compositionend", () => { composing = false; });
        input.addEventListener("blur", () => {
          if (composing) return;
          pushOneLineHistory();
          guideValues[key] = input.value.trim();
          const auto = { ...(guideValues.guided_creative_auto_values || {}) }; delete auto[key];
          guideValues.guided_creative_auto_values = auto;
          const applied = applyH3GuidedTemplate(selected.id, guideValues);
          guideValues = applied.fields; guideSegments = applied.segments;
          renderOneLineCreator({ preserveScroll: true });
        });
        field.appendChild(input); oneLineDetailGrid.appendChild(field);
      }
      renderOneLineDialogue();
      oneLineShotList.replaceChildren();
      for (const shot of oneLineShotSummary()) {
        const row = mk("div", "h3s-one-line-shot");
        row.append(mk("span", "h3s-one-line-shot-time", `${shot.start.toFixed(3)}–${shot.end.toFixed(3)}秒`),
          mk("span", null, `${shot.title}：${shot.value}`));
        oneLineShotList.appendChild(row);
      }
      oneLineShots.hidden = !oneLineShotList.children.length;
      oneLineDecisions.hidden = !selected;
      oneLineTags.hidden = !tags.length;
      oneLineDetails.hidden = !selected;
      oneLineUndo.disabled = !oneLineHistory.length;
      if (preserveScroll) guide.scrollTop = scroll;
    };
    const guideRouteStages = (templateId, profileKey, routeValue) => getH3GuidedRouteStages(
      templateId, profileKey, routeValue, guideValues);
    const templateParameterLabels = (selected) => {
      if (!selected) return [];
      const ui = getH3GuidedTemplateUi(selected.id);
      const definitions = new Map(H3_GUIDED_PROMPT_STEPS.map((step) => [step.key, step]));
      return (ui && ui.steps || []).map((key) => {
        if (key === "content") return selected.lead && selected.lead.label;
        if (key === "story_route") return selected.directing && selected.directing.story && selected.directing.story.label;
        if (key === "shot_language") return selected.directing && selected.directing.shots && selected.directing.shots.label;
        const override = ui && ui.fields && ui.fields[key];
        const base = definitions.get(key);
        return override && (override.label || override.title) || base && (base.label || base.title) || key;
      }).filter((value, index, list) => value && list.indexOf(value) === index);
    };
    const updateGuideTemplateDescription = () => {
      const selected = selectedGuidedTemplate();
      const params = templateParameterLabels(selected);
      guideTemplateDescription.textContent = selected
        ? `已选择“${selected.name}”：共 ${params.length} 项专属填写内容；镜头秒数、动作、构图、光线和声音自动规划。${selected.sourceSkill ? ` 官方技能：${selected.sourceSkill}。` : ""}`
        : "选择模板后自动应用并展开完整流程；不会带入其它模板的字段。";
    };
    const extractGuidedValue = (step, source) => {
      if (step.key === "dialogue_script") {
        const lines = [];
        for (const match of String(source || "").matchAll(/(?:^|\n)\s*-\s*((?:\d+(?:\.\d+)?)\s*[–—-]\s*(?:\d+(?:\.\d+)?)\s*秒)\s*[｜|]\s*([^｜|\r\n]+)\s*[｜|]\s*(?:[^｜|\r\n]+\s*[｜|]\s*)?<d>\s*\[[^\]]+\]\s*([\s\S]*?)<\/d>/gi)) {
          const line = `${String(match[1] || "").replace(/\s+/g, "")}｜${String(match[2] || "").trim()}｜${String(match[3] || "").trim()}`;
          if (!lines.includes(line)) lines.push(line);
        }
        return lines.join("\n");
      }
      const labels = step.key === "content" ? [step.label, "全片主题"]
        : (step.key === "dialogue" ? [step.label, "对白"] : [step.label]);
      const label = labels.map((value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      if (["dialogue", "dialogue_language", "voice_direction"].includes(step.key)) {
        const lineMatch = String(source || "").match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*[:：]\\s*([^\\n]+)`, "i"));
        return lineMatch ? String(lineMatch[1] || "").trim().replace(/[。\s]+$/g, "") : "";
      }
      const match = String(source || "").match(new RegExp(`(?:^|[；;\\n])\\s*(?:${label})\\s*[:：]\\s*([^；;\\n]+)`, "i"));
      return match ? String(match[1] || "").trim() : "";
    };
    const guidePlan = () => planH3GuidedSegments(guideValues.duration || "15秒");
    const guideSegmentOptions = (fieldKey) => {
      const dynamic = [];
      const scene = String(guideValues.scene || "").trim();
      const layout = String(guideValues.scene_layout || "").trim();
      const characters = String(guideValues.characters || "").split(/[、,，\n]+/).map((item) => item.trim()).filter(Boolean);
      const props = String(guideValues.props || "").trim();
      const content = String(guideValues.content || "").trim();
      if (fieldKey === "scene_time" && scene) dynamic.push(`${scene}，沿用固定布局、地标和光源方向`);
      if (fieldKey === "positions" && characters.length >= 2) {
        dynamic.push(`${characters[0]}位于画面左侧，${characters[1]}位于画面右侧，两者朝向和间距保持不变`);
      } else if (fieldKey === "positions" && characters.length === 1) {
        dynamic.push(`${characters[0]}位于画面中心，朝向当前目标，跨镜头保持屏幕位置`);
      }
      if (fieldKey === "objective" && content) dynamic.push(`推进“${content.slice(0, 70)}”中的一个明确动作并得到可见结果`);
      if (fieldKey === "action" && props && !/^(?:无|没有)/.test(props)) {
        dynamic.push(`${characters.join("和") || "角色"}观察${props}→伸手接触→完成操作→${props}产生可见作用→确认结果`);
      }
      if (fieldKey === "framing" && layout) dynamic.push(`按照固定布局构图：${layout.slice(0, 90)}`);
      if (fieldKey === "camera" && guideValues.camera) dynamic.push(String(guideValues.camera));
      if (fieldKey === "sound" && guideValues.sound) dynamic.push(String(guideValues.sound));
      if (fieldKey === "end_state" && props && !/^(?:无|没有)/.test(props)) {
        dynamic.push(`最后帧清楚保留${props}的归属、位置和当前状态，供下一段直接继承`);
      }
      return [...dynamic, ...(H3_GUIDED_SEGMENT_QUICK_OPTIONS[fieldKey] || [])]
        .map((value) => String(value || "").trim()).filter((value, index, list) => value && list.indexOf(value) === index);
    };
    const syncGuideSegmentChoiceState = (fieldKey) => {
      const input = guideSegmentInputs.get(fieldKey);
      const choices = guideSegmentChoiceLists.get(fieldKey);
      const current = String(input && input.value || "");
      if (!choices) return;
      for (const button of choices.querySelectorAll("button[data-value]")) {
        button.classList.toggle("active", current.includes(button.dataset.value || ""));
      }
    };
    const renderGuideSegmentChoices = () => {
      for (const field of H3_GUIDED_SEGMENT_FIELDS) {
        const input = guideSegmentInputs.get(field.key);
        const choices = guideSegmentChoiceLists.get(field.key);
        if (!input || !choices) continue;
        choices.replaceChildren();
        for (const value of guideSegmentOptions(field.key)) {
          const button = mk("button", "h3s-guide-field-choice", value);
          button.type = "button";
          button.dataset.value = value;
          button.title = "点击追加到本项；可连续选择多条，也可在输入框中自行修改";
          button.addEventListener("click", () => {
            input.value = appendH3GuidedQuickOption(input.value, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
          });
          choices.appendChild(button);
        }
        syncGuideSegmentChoiceState(field.key);
      }
    };
    for (const field of H3_GUIDED_SEGMENT_FIELDS) {
      const input = guideSegmentInputs.get(field.key);
      if (input) input.addEventListener("input", () => syncGuideSegmentChoiceState(field.key));
    }
    const guideSteps = () => {
      /* 模板下拉框切换后自动应用；每套模板只返回自己的精简字段。 */
      const templateId = String(guideTemplateSelect.value || guideValues.template_id || "");
      const activeTemplate = H3_GUIDED_TEMPLATES.find((item) => item.id === templateId) || null;
      const templateUi = getH3GuidedVisibleTemplateUi(templateId, guideValues);
      const dialogueMode = String(guideValues.dialogue || activeTemplate?.defaults?.dialogue || "");
      const definitions = new Map(H3_GUIDED_PROMPT_STEPS.map((step) => [step.key, step]));
      const requestedKeys = templateUi && templateUi.steps || [];
      const base = requestedKeys
        .map((key) => {
          const step = definitions.get(key);
          if (!step) return null;
          const override = templateUi && templateUi.fields && templateUi.fields[key];
          return override ? { ...step, ...override, key } : step;
        })
        .filter((step) => step && (!step.spokenOnly || isH3GuidedSpeechMode(dialogueMode)))
        .filter((step) => step && (step.key !== "ad_copy_text"
          || !/(?:无文字|无文案)/.test(String(guideValues.text_mode || ""))))
        .flatMap((step) => {
          if (step.key === "content" && activeTemplate && activeTemplate.lead) {
            return [{ ...step, ...activeTemplate.lead, key: "content", required: true, kind: "field", templateLead: true }];
          }
          if (step.templateProfile && activeTemplate && activeTemplate.directing) {
            const profile = activeTemplate.directing[step.templateProfile];
            if (profile) {
              const routeValue = String(guideValues[step.key] || profile.defaultValue || "").trim();
              const routeStep = { ...step, ...profile, key: step.key, kind: "field", templateDirecting: true,
                profileKey: step.templateProfile };
              /* 故事路线拆成内容职责逐项填写；镜头路线继续作为自动配镜规则，
                 避免把一次填写膨胀成几十个摄影术语页面。 */
              const stages = step.templateProfile === "story" && routeValue
                ? guideRouteStages(templateId, step.templateProfile, routeValue).map((stage) => ({
                ...stage,
                kind: "route_stage",
                templateId,
                routeKey: step.key,
                profileKey: step.templateProfile,
                routeValue,
                section: `${profile.label}逐项引导`,
                })) : [];
              return [routeStep, ...stages];
            }
          }
          return [{ ...step, kind: "field" }];
        });
      return base;
    };
    const guideStepOptions = (step, activeTemplate) => {
      if (!step) return [];
      let options = step.catalog ? availableOptions(step.catalog) : (step.options || []);
      if (step.templateLead && activeTemplate) {
        options = getH3GuidedTopicSuggestions(activeTemplate.id, guideValues, guideValues.content || "");
      } else if (activeTemplate && step.kind === "field") {
        options = getH3GuidedFieldSuggestions(activeTemplate.id, step.key, guideValues, options);
      }
      if (step.key === "duration" && activeTemplate && activeTemplate.forceDuration) return [activeTemplate.forceDuration];
      if (step.key === "duration" && activeTemplate && activeTemplate.durationOptions.length) return activeTemplate.durationOptions;
      if (step.key === "aspect" && activeTemplate && activeTemplate.forceAspect) return [activeTemplate.forceAspect];
      return options;
    };
    let guideOverviewRenderTimer = 0;
    const collectRequiredGuideGaps = () => guideSteps()
      .filter((step) => step && step.kind === "field")
      .filter((step) => {
        if (step.key === "ad_copy_text" && /(?:无文字|无文案)/.test(String(guideValues.text_mode || ""))) return false;
        const speechRequired = step.requiredWhenSpeech && isH3GuidedSpeechMode(guideValues.dialogue);
        return (step.required || speechRequired) && !String(guideValues[step.key] || "").trim();
      });
    const commitGuideOverviewField = (step, rawValue, { rerender = true } = {}) => {
      let next = String(rawValue || "").trim();
      const activeTemplate = selectedGuidedTemplate();
      if (step.key === "duration" && activeTemplate?.forceDuration) next = activeTemplate.forceDuration;
      if (step.key === "duration" && next) {
        const seconds = next.match(/\d+(?:\.\d+)?/);
        next = seconds ? `${seconds[0]}秒` : next;
      }
      guideValues[step.key] = next;
      if (step.key === "product_category") delete guideValues.product_category_auto;
      refreshAppliedGuideTemplate();
      if (rerender) renderGuideOverview();
    };
    const scheduleGuideOverviewRefresh = (step, input) => {
      if (guideOverviewRenderTimer) window.clearTimeout(guideOverviewRenderTimer);
      guideOverviewRenderTimer = window.setTimeout(() => {
        const overviewScroll = guideOverview.scrollTop;
        const selectionStart = Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
        const selectionEnd = Number.isFinite(input.selectionEnd) ? input.selectionEnd : selectionStart;
        commitGuideOverviewField(step, input.value, { rerender: true });
        guideOverview.scrollTop = overviewScroll;
        const replacement = Array.from(guideOverview.querySelectorAll("textarea[data-guide-key]"))
          .find((item) => item.dataset.guideKey === step.key);
        if (replacement) {
          replacement.focus({ preventScroll: true });
          replacement.setSelectionRange(Math.min(selectionStart, replacement.value.length),
            Math.min(selectionEnd, replacement.value.length));
        }
      }, 180);
    };
    const renderGuideOverview = () => {
      const activeTemplate = selectedGuidedTemplate();
      const steps = guideSteps().filter((step) => step && step.kind === "field");
      const overviewScroll = guideOverview.scrollTop;
      guideOverview.replaceChildren();
      const total = guidePlan().total;
      const previewSegments = activeTemplate ? applyH3GuidedTemplate(activeTemplate.id, guideValues).segments : guideSegments;
      const shotSummary = [];
      for (const segment of previewSegments || []) {
        for (const line of String(segment && segment.internal_shots || "").split(/\n+/)) {
          const match = line.match(/全片(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒[^：]*：镜头职责=([^；]+).*?动作=([^；]+).*?本镜新增信息\/结果=([^；]+)[；。]/);
          if (match) shotSummary.push({ start: Number(match[1]), end: Number(match[2]), title: match[3], value: `${match[4]}；结果：${match[5]}` });
        }
      }
      if (shotSummary.length) {
        const heading = mk("div", "h3s-guide-template-label", `实时镜头蓝图 · 共 ${total} 秒`);
        guideOverview.appendChild(heading);
        for (const shot of shotSummary) {
          const card = mk("div", "h3s-guide-overview-card done");
          const head = mk("div", "h3s-guide-overview-head");
          head.append(mk("span", "h3s-guide-overview-time", `${shot.start.toFixed(3)}–${shot.end.toFixed(3)}秒`),
            mk("span", "h3s-guide-overview-title", shot.title));
          card.append(head, mk("div", "h3s-guide-note", shot.value));
          guideOverview.appendChild(card);
        }
        guideOverview.appendChild(mk("div", "h3s-guide-template-label", "蓝色创作项 · 可直接输入或点击候选"));
      }
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const value = String(guideValues[step.key] || step.defaultValue || "").trim();
        const required = Boolean(step.required || (step.requiredWhenSpeech && isH3GuidedSpeechMode(guideValues.dialogue)));
        const card = mk("div", "h3s-guide-overview-card" + (value ? " done" : (required ? " pending" : "")));
        const head = mk("div", "h3s-guide-overview-head");
        const progress = mk("span", "h3s-guide-overview-time", `${index + 1}/${steps.length}`);
        const title = mk("span", "h3s-guide-overview-title", step.title || step.label || step.key);
        head.append(progress, title);
        const input = mk("textarea", "h3s-guide-overview-input");
        input.dataset.guideKey = step.key;
        input.value = value;
        input.placeholder = step.placeholder || "点选候选，或直接输入自己的内容";
        let composing = false;
        input.addEventListener("compositionstart", () => {
          composing = true;
          if (guideOverviewRenderTimer) window.clearTimeout(guideOverviewRenderTimer);
          guideOverviewRenderTimer = 0;
        });
        input.addEventListener("compositionend", () => {
          composing = false;
          scheduleGuideOverviewRefresh(step, input);
        });
        input.addEventListener("input", (event) => {
          if (composing || event.isComposing) return;
          scheduleGuideOverviewRefresh(step, input);
        });
        input.addEventListener("blur", () => {
          if (composing) return;
          if (guideOverviewRenderTimer) window.clearTimeout(guideOverviewRenderTimer);
          guideOverviewRenderTimer = 0;
          commitGuideOverviewField(step, input.value, { rerender: true });
        });
        const choices = mk("div", "h3s-guide-overview-choices");
        for (const option of guideStepOptions(step, activeTemplate).slice(0, 8)) {
          const button = mk("button", null, option);
          button.type = "button";
          button.classList.toggle("active", value === option || (step.multiple && value.split(/\n+/).includes(option)));
          button.addEventListener("click", () => {
            if (step.multiple) {
              let parts = value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
              if (step.key === "source_assets" && /无参考素材·纯文生视频/.test(option)) {
                parts = [option];
              } else {
                if (step.key === "source_assets") parts = parts.filter((item) => !/无参考素材·纯文生视频/.test(item));
                const selectedIndex = parts.indexOf(option);
                if (selectedIndex >= 0) parts.splice(selectedIndex, 1); else parts.push(option);
              }
              input.value = parts.join("\n");
            } else {
              input.value = option;
            }
            commitGuideOverviewField(step, input.value, { rerender: true });
          });
          choices.appendChild(button);
        }
        card.append(head, input, choices);
        guideOverview.appendChild(card);
      }
      guideOverview.scrollTop = overviewScroll;
    };
    const setGuideChoiceState = () => {
      const step = guideSteps()[guideIndex];
      const current = String(guideInput.value || "");
      const selectedLines = current.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      for (const button of guideChoices.querySelectorAll("button[data-value]")) {
        const value = button.dataset.value || "";
        const active = step && step.multiple
          ? selectedLines.includes(value)
          : current.trim() === value;
        button.classList.toggle("active", active);
      }
    };
    const renderGuide = () => {
      const steps = guideSteps();
      const previewMode = guideIndex >= steps.length;
      const step = previewMode ? null : steps[guideIndex];
      const activeTemplate = selectedGuidedTemplate();
      const segmentMode = !!step && step.kind === "segment";
      const overviewMode = Boolean(selectedGuidedTemplate());
      guide.classList.add("show");
      menu.classList.remove("show");
      guideOverview.classList.toggle("show", overviewMode && !previewMode);
      guidePreview.style.display = previewMode ? "block" : "none";
      guideInput.style.display = previewMode || segmentMode || overviewMode ? "none" : "block";
      guideInput.classList.toggle("long", Boolean(step && step.longInput));
      guideSegmentForm.classList.toggle("show", segmentMode);
      guideChoices.style.display = previewMode || segmentMode || overviewMode ? "none" : "flex";
      guideNext.style.display = previewMode || overviewMode ? "none" : "inline-block";
      guideSkip.style.display = previewMode || overviewMode ? "none" : "inline-block";
      guideReplace.style.display = previewMode ? "inline-block" : "none";
      guideAppend.style.display = previewMode ? "inline-block" : "none";
      guideBack.style.display = overviewMode ? "none" : "inline-block";
      guideBack.disabled = guideIndex <= 0;
      if (previewMode) {
        const plan = guidePlan();
        guideProgress.textContent = "完成预览";
        guideTitle.textContent = `本地生成 ${plan.count} 段，共 ${plan.total} 秒`;
        guideNote.textContent = "这是严格的 H3 官方 Base 三字段和绝对 Shot 时间轴；点“写入并解析导入”会按时长自动拆成不超过15秒的生成段。";
        guidePreview.textContent = buildH3GuidedDirectorScript(guideValues, guideSegments);
        return;
      }
      if (overviewMode) {
        guideProgress.textContent = `${steps.length}项`;
        guideTitle.textContent = `${activeTemplate?.name || "当前模板"} · 全流程`;
        guideNote.textContent = "所有蓝色项目一次展开：从上到下填写，候选会随主题联动；每套模板都有自己的镜头语言，选择后上方镜头蓝图会立即改变绝对时间、景别、机位和运镜。完成后点“生成官方Base并导入”。";
        guideReplace.textContent = "生成官方Base并导入";
        guideReplace.style.display = "inline-block";
        guideAppend.style.display = "inline-block";
        renderGuideOverview();
        return;
      }
      guideProgress.textContent = `${guideIndex + 1}/${steps.length}`;
      guideTitle.textContent = step.section ? `【${step.section}】${step.title}` : step.title;
      if (step.kind === "route_stage") {
        guideProgress.textContent = `${guideIndex + 1}/${steps.length} · 当前职责 ${step.index + 1}/${step.count}`;
      }
      guideNote.textContent = step.kind === "segment"
        ? "每一项下方都有可多选的快捷参考；点击会追加到输入框且不会覆盖模板内容，不够时可继续手写。后续段会继承全局角色、场景、道具和连续性条件。"
        : (step.kind === "route_stage" && activeTemplate
          ? `${step.question} 可直接点击一个候选；只有候选不够时才在下方补充。保存后会自动进入下一职责，并写入“${activeTemplate.name}”自己的镜头时间表。`
        : (step.templateDirecting && activeTemplate
          ? (step.profileKey === "story"
            ? `这是“${activeTemplate.name}”专属的${step.label}。先选蓝色路线，点“下一步”后会把路线拆成 ${String(step.defaultValue || "").split("→").length} 个实际职责，逐项给你可点击选择。`
            : `这是“${activeTemplate.name}”专属的镜头路线。选择后会自动匹配前面已经填写的每个故事职责，不再额外要求你逐镜填写摄影术语。`)
        : (step.templateLead && activeTemplate
          ? `这是“${activeTemplate.name}”自己的主题入口。可先写一个关键词，例如“苹果”；输入后下方会立即出现相关候选，不必把完整提示词全打出来。`
        : (step.key === "duration" && activeTemplate && activeTemplate.forceDuration
          ? `该官方技能成片时长固定为 ${activeTemplate.forceDuration}。`
          : (step.key === "duration" && activeTemplate && activeTemplate.durationOptions.length
            ? `该技能推荐时长：${activeTemplate.durationOptions.join("、")}；${activeTemplate.strictDurationOptions ? "只能选择这些官方时长档。" : "也可以填写自定义总时长。"}`
            : (step.key === "aspect" && activeTemplate && activeTemplate.forceAspect
              ? `该官方技能画幅固定为 ${activeTemplate.forceAspect}。`
              : (step.required ? "此项必须填写；可点选预设，也可以在下方自己输入。" : "此项可以跳过；可点选一个或多个预设，也可以自己输入。 ")))))));
      if (step.key === "dialogue") {
        guideNote.textContent = "默认选择纯环境声和动作音效最稳；只有确实需要说话时才选择精确对白/旁白，下一步会要求填写语言、全片绝对时间、说话人和逐字原文。";
      } else if (step.key === "source_assets") {
        guideNote.textContent = "纯文生视频请选择第一项“无参考素材·纯文生视频”，然后点下一步；不要虚构已经上传的图片。只有真实上传、核验或授权了素材时，才选择其它选项。";
      } else if (step.key === "dialogue_language") {
        guideNote.textContent = "普通话会写成官方 <d>[Chinese]准确原文</d>，英文会写成 <d>[English]accurate text</d>；一条视频不要混用语言标签。";
      } else if (step.key === "dialogue_script") {
        guideNote.textContent = "这里就是输入对话内容的位置。每句单独一行，使用全片绝对时间；台词不能跨越15秒生成段边界，插件会检查格式、重叠和语速。示例：0.000–2.000秒｜熊猫｜我一定要拿到那个红苹果。";
      } else if (step.key === "voice_direction") {
        guideNote.textContent = "只描述语气、语速和清晰度，不要在这里重复台词；动作音效和BGM会在人声下压低，避免盖住对白。";
      }
      guideChoices.replaceChildren();
      if (segmentMode) {
        const stored = guideSegments[step.segment.index];
        const values = stored && typeof stored === "object" && !Array.isArray(stored)
          ? stored : { action: String(stored || "") };
        for (const field of H3_GUIDED_SEGMENT_FIELDS) {
          const input = guideSegmentInputs.get(field.key);
          if (!input) continue;
          let value = String(values[field.key] || "");
          if (!value && field.key === "scene_time" && guideValues.scene) value = guideValues.scene;
          if (!value && field.key === "start_state") value = step.segment.index > 0
            ? "严格承接上一段最后帧的角色位置、朝向、动作进度、道具状态、光线方向和摄影机方位"
            : "从场景固定布局和角色初始位置开始";
          if (!value && field.key === "end_state") value = step.segment.index < guidePlan().count - 1
            ? "停在动作可自然继续的清晰姿态，保留角色位置、朝向、动作进度、道具状态、光线方向和摄影机方位"
            : "核心动作完成，画面构图稳定、信息明确、无花屏";
          input.value = value;
        }
        renderGuideSegmentChoices();
        const actionInput = guideSegmentInputs.get("action");
        if (actionInput) actionInput.focus();
        return;
      }
      const options = guideStepOptions(step, activeTemplate);
      for (const value of options) {
        const button = mk("button", "h3s-guide-choice", value);
        button.type = "button";
        button.dataset.value = value;
        button.addEventListener("click", () => {
          if (step.multiple) {
            /* 多选每项独占一行。不能再用顿号拆分，因为候选文本自身经常包含顿号。 */
            let parts = String(guideInput.value || "").split(/\n+/).map((item) => item.trim()).filter(Boolean);
            if (step.key === "source_assets") {
              const noReference = /无参考素材·纯文生视频/.test(value);
              if (noReference) {
                /* “无素材”和“已上传”必须互斥；无素材是确定状态，重复点击也只保留一行。 */
                guideInput.value = value;
              } else {
                parts = parts.filter((item) => !/无参考素材·纯文生视频/.test(item));
                const index = parts.indexOf(value);
                if (index >= 0) parts.splice(index, 1); else parts.push(value);
                guideInput.value = parts.join("\n");
              }
            } else {
              const index = parts.indexOf(value);
              if (index >= 0) parts.splice(index, 1); else parts.push(value);
              guideInput.value = parts.join("\n");
            }
          } else {
            guideInput.value = value;
          }
          setGuideChoiceState();
          guideInput.focus();
        });
        guideChoices.appendChild(button);
      }
      const value = step.kind === "route_stage"
        ? getH3GuidedRouteAnswer(guideValues, step.templateId, step.profileKey, step.routeValue, step.index)
        : String(guideValues[step.key] || step.defaultValue || "");
      guideInput.value = value;
      guideInput.placeholder = step.placeholder
        || (step.catalog && H3_PROMPT_ASSIST_CATALOG[step.catalog] && H3_PROMPT_ASSIST_CATALOG[step.catalog].placeholder)
        || "输入自己的要求";
      setGuideChoiceState();
      if (step.templateLead) {
        guideInput.oninput = () => {
          const liveOptions = getH3GuidedTopicSuggestions(activeTemplate && activeTemplate.id, guideValues, guideInput.value);
          guideChoices.replaceChildren();
          for (const suggestion of liveOptions) {
            const button = mk("button", "h3s-guide-choice", suggestion);
            button.type = "button";
            button.dataset.value = suggestion;
            button.addEventListener("click", () => {
              guideInput.value = suggestion;
              setGuideChoiceState();
              guideInput.focus();
            });
            guideChoices.appendChild(button);
          }
          setGuideChoiceState();
        };
      } else {
        guideInput.oninput = null;
      }
      guideInput.focus();
    };
    const collectGuideSegmentForm = (skip = false) => {
      const details = {};
      for (const field of H3_GUIDED_SEGMENT_FIELDS) {
        const input = guideSegmentInputs.get(field.key);
        details[field.key] = skip ? "" : String(input && input.value || "").trim();
      }
      return details;
    };
    const refreshAppliedGuideTemplate = () => {
      const templateId = String(guideValues.template_id || "");
      if (!templateId) return;
      const refreshed = applyH3GuidedTemplate(templateId, guideValues);
      guideValues = refreshed.fields;
      guideSegments = refreshed.segments;
    };
    const saveGuideCurrent = ({ skip = false } = {}) => {
      const steps = guideSteps();
      if (guideIndex >= steps.length) return true;
      const step = steps[guideIndex];
      if (step.kind === "segment") {
        guideSegments[step.segment.index] = collectGuideSegmentForm(skip);
        guideNote.style.color = "";
        return true;
      }
      let value = skip ? "" : String(guideInput.value || "").trim();
      let guideWarning = "";
      if (step.key === "duration" && value) {
        const seconds = value.match(/\d+(?:\.\d+)?/);
        value = seconds ? seconds[0] + "秒" : value;
        const selected = selectedGuidedTemplate();
        if (selected && selected.forceDuration) value = selected.forceDuration;
        else if (selected && selected.strictDurationOptions && !selected.durationOptions.includes(value)) {
          guideNote.textContent = `该官方技能只允许 ${selected.durationOptions.join("、")}；请选择其中一个时长。`;
          guideNote.style.color = "#ffaaa2";
          guideInput.focus();
          return false;
        }
      }
      if (step.key === "aspect") {
        const selected = selectedGuidedTemplate();
        if (selected && selected.forceAspect) value = selected.forceAspect;
      }
      const speechRequired = step.requiredWhenSpeech && isH3GuidedSpeechMode(guideValues.dialogue);
      if ((step.required || speechRequired) && !value) {
        guideNote.textContent = `“${step.label || step.title}”必须填写后才能继续。`;
        guideNote.style.color = "#ffaaa2";
        guideInput.focus();
        return false;
      }
      if (step.kind === "route_stage") {
        guideValues = setH3GuidedRouteAnswer(
          guideValues, step.templateId, step.profileKey, step.routeValue, step.index, value);
        /* 产品广告路线最后的“文案”职责就是最终广告文案。直接同步给生成器，
           不再在后面让用户把同一句话填写第二次。 */
        if (value && step.profileKey === "story" && /文案|口号|CTA|行动号召/.test(String(step.label || ""))
            && /product_ad/.test(String(step.templateId || ""))) {
          guideValues.ad_copy = value;
        }
        refreshAppliedGuideTemplate();
        guideNote.textContent = value
          ? `已完成“${step.label}”；下一步将继续引导同一路线的下一项。`
          : `已跳过“${step.label}”；后续会使用当前模板的安全默认动作。`;
        guideNote.style.color = value ? "#9ed6ff" : "#ffd27a";
        return true;
      }
      if (step.key === "dialogue_script" && value) {
        const checked = validateH3GuidedDialogueScript(value, {
          mode: guideValues.dialogue,
          language: guideValues.dialogue_language,
          duration: guideValues.duration || "15秒",
          segmentSeconds: 15,
        });
        if (!checked.ok) {
          guideNote.textContent = checked.errors[0] || "精确台词格式不正确。";
          guideNote.style.color = "#ffaaa2";
          guideInput.focus();
          return false;
        }
        value = checked.normalized;
        if (checked.warnings.length) guideWarning = checked.warnings.join("；");
      }
      guideNote.textContent = guideWarning || guideNote.textContent;
      guideNote.style.color = guideWarning ? "#ffd27a" : "";
      guideValues[step.key] = value;
      if (step.key === "product_category") delete guideValues.product_category_auto;
      refreshAppliedGuideTemplate();
      return true;
    };
    const preserveGuideCurrentWithoutBlocking = () => {
      const steps = guideSteps();
      if (guideIndex >= steps.length) return;
      const step = steps[guideIndex];
      if (step.kind === "segment") {
        guideSegments[step.segment.index] = collectGuideSegmentForm(false);
        return;
      }
      let value = String(guideInput.value || "").trim();
      if (step.key === "duration" && value) {
        const seconds = value.match(/\d+(?:\.\d+)?/);
        value = seconds ? seconds[0] + "秒" : value;
      }
      if (step.kind === "route_stage") {
        guideValues = setH3GuidedRouteAnswer(
          guideValues, step.templateId, step.profileKey, step.routeValue, step.index, value);
        if (value && step.profileKey === "story" && /文案|口号|CTA|行动号召/.test(String(step.label || ""))
            && /product_ad/.test(String(step.templateId || ""))) {
          guideValues.ad_copy = value;
        }
        refreshAppliedGuideTemplate();
      } else if (value) {
        guideValues[step.key] = value;
        if (step.key === "product_category") delete guideValues.product_category_auto;
        refreshAppliedGuideTemplate();
      }
    };
    const cloneGuideSegments = (segments) => Array.isArray(segments)
      ? segments.map((segment) => (segment && typeof segment === "object" && !Array.isArray(segment)
        ? { ...segment } : segment))
      : [];
    const saveGuideTemplateDraft = (templateId) => {
      const id = String(templateId || "");
      if (!id) {
        guideBaseValues = { ...guideValues };
        guideBaseSegments = cloneGuideSegments(guideSegments);
        return;
      }
      guideTemplateDrafts.set(id, {
        fields: { ...guideValues },
        segments: cloneGuideSegments(guideSegments),
      });
    };
    const loadGuideTemplateDraft = (templateId) => {
      const id = String(templateId || "");
      if (!id) {
        guideValues = { ...guideBaseValues };
        guideSegments = cloneGuideSegments(guideBaseSegments);
        return;
      }
      const draft = createH3GuidedTemplatePreviewDraft(id, guideBaseValues, guideTemplateDrafts.get(id));
      guideValues = draft.fields;
      guideSegments = draft.segments;
    };
    const switchGuideTemplatePreview = (templateId, { preserve = true } = {}) => {
      const nextTemplateId = String(templateId || "");
      const previousTemplateId = String(lastGuideTemplateId || "");
      if (preserve) {
        const visibleTemplateId = guideTemplateSelect.value;
        guideTemplateSelect.value = previousTemplateId;
        preserveGuideCurrentWithoutBlocking();
        saveGuideTemplateDraft(previousTemplateId);
        guideTemplateSelect.value = visibleTemplateId;
      }
      loadGuideTemplateDraft(nextTemplateId);
      lastGuideTemplateId = nextTemplateId;
    };
    const ensureGuideEquipmentNames = () => true;
    const openGuide = () => {
      const source = String(textarea.value || "");
      const detectedOfficial3d = /官方技能来源\s*[:：]\s*3d-animation-short-generator/i.test(source);
      const detectedLegacy3d = detectedOfficial3d && (/(?:平面赛璐璐|抽象动态图形)/i.test(source)
        || /(?:代表性动作|异常反馈)/.test(source)
        || /道具\/装备\s*[:：][^\n]*(?:钥匙|地图)/.test(source));
      if (detectedOfficial3d) guideTemplateSelect.value = "animation_3d_short_official";
      if (!guideTemplateSelect.value) {
        if (/(?:广告|产品|商品|品牌|apple|苹果|手机|耳机|音箱)/i.test(source)) {
          guideTemplateSelect.value = "minimalist_product_ad_official";
        } else if (/(?:双人|合作游戏|PLAYER\s*1|PLAYER\s*2)/i.test(source)) {
          guideTemplateSelect.value = "coop_game_intro_official";
        } else if (/(?:纸雕|立体书|科普|知识讲解)/i.test(source)) {
          guideTemplateSelect.value = "papercraft_explainer_official";
        } else if (/(?:纸拼贴|拼贴讲解)/i.test(source)) {
          guideTemplateSelect.value = "paper_collage_explainer_official";
        } else if (/(?:MV|歌词|主音轨|音乐视频)/i.test(source)) {
          guideTemplateSelect.value = "music_video_subtitle_official";
        } else if (/(?:手绘发光|实拍.*手绘|涂鸦融合)/i.test(source)) {
          guideTemplateSelect.value = "handdrawn_live_official";
        }
      }
      guideValues = {};
      for (const step of H3_GUIDED_PROMPT_STEPS) {
        const extracted = extractGuidedValue(step, source);
        /* 模板专属字段不能在未选择该模板时写入默认值。典型例子是双人游戏
           ui_copy；旧逻辑会把 Continue 菜单串进角色PV等完全无关模板。 */
        guideValues[step.key] = extracted || (step.onlyTemplates ? "" : (step.defaultValue || ""));
      }
      if (!extractGuidedValue(H3_GUIDED_PROMPT_STEPS.find((step) => step.key === "duration"), source)) {
        let total = 0;
        for (const match of source.matchAll(/(?:^|\n)\s*段\d+\s*[（(]\s*(\d+(?:\.\d+)?)\s*秒\s*[）)]/gi)) {
          total += Number(match[1]) || 0;
        }
        if (!(total > 0)) {
          for (const match of source.matchAll(/时间范围\s*[:：]\s*\d+(?:\.\d+)?\s*[–—-]\s*(\d+(?:\.\d+)?)\s*秒/gi)) {
            total = Math.max(total, Number(match[1]) || 0);
          }
        }
        if (total > 0) guideValues.duration = `${total}秒`;
      }
      if (!guideValues.content && source.trim() && !/(?:^|\n)\s*段\d+/i.test(source)) {
        guideValues.content = source.trim().length <= 1200 ? source.trim() : "";
      }
      if (guideTemplateSelect.value === "minimalist_product_ad_official" && source.trim()
          && !String(guideValues.product_name || "").trim()) {
        guideValues.product_name = inferH3ProductNameFromTopic(source);
      }
      guideSegments = [];
      const segmentOutputLabels = {
        scene_time: "本段场景与时间", start_state: "开场承接", positions: "角色位置与朝向",
        objective: "本段目标", obstacle: "障碍与变化", action: "具体动作链",
        internal_shots: "内部镜头调度",
        framing: "景别与构图", camera: "镜头运动", lighting: "光线与色彩",
        sound: "同步声音", end_state: "最后帧",
      };
      for (const segment of planH3GuidedSegments(guideValues.duration || "15秒").segments) {
        const block = source.match(new RegExp(`(?:^|\\n)\\s*段${segment.index + 1}[^\\n]*[\\s\\S]*?(?=\\n\\s*段${segment.index + 2}[^\\n]*|$)`, "i"));
        const details = {};
        for (const field of H3_GUIDED_SEGMENT_FIELDS) {
          if (field.key === "internal_shots") {
            const shotBlock = block && block[0].match(/内部镜头调度(?:（[^）]*）)?\s*[:：]\s*\n([\s\S]*?)(?=\n(?:全片主题|全片锁定|本段场景与时间|开场承接|角色位置与朝向|本段目标|障碍与变化|本段内容|具体动作链|景别与构图|镜头运动|光线与色彩|同步声音|本段执行|最后帧)\s*[:：]|$)/i);
            details[field.key] = shotBlock ? String(shotBlock[1] || "").trim() : "";
            continue;
          }
          const label = segmentOutputLabels[field.key];
          const match = block && label
            ? block[0].match(new RegExp(`${label}\\s*[:：]\\s*([^\\n]+)`, "i")) : null;
          details[field.key] = match ? String(match[1] || "")
            .replace(/；每一步必须[\s\S]*$/i, "").replace(/[。；;\s]+$/g, "").trim() : "";
        }
        if (!details.action) {
          const content = block && block[0].match(/本段内容\s*[:：]\s*([^\n]+)/i);
          details.action = content ? String(content[1] || "").replace(/[。；;\s]+$/g, "").trim() : "";
        }
        guideSegments[segment.index] = details;
      }
      guideBaseValues = { ...guideValues };
      guideBaseSegments = cloneGuideSegments(guideSegments);
      guideTemplateDrafts.clear();
      appliedGuideTemplateId = "";
      lastGuideTemplateId = String(guideTemplateSelect.value || "");
      if (lastGuideTemplateId) {
        loadGuideTemplateDraft(lastGuideTemplateId);
        const applied = applyH3GuidedTemplate(lastGuideTemplateId, guideValues);
        guideValues = applied.fields;
        guideSegments = applied.segments;
        appliedGuideTemplateId = lastGuideTemplateId;
      }
      updateGuideTemplateDescription();
      guideIndex = 0;
      hideMenu();
      const ordinarySource = source.trim() && !/(?:integrated_multimodal_description|subject_definitions|\[Shot\s+\d+\]|段\d+\s*[（(])/i.test(source);
      oneLineInput.value = ordinarySource ? source.trim().slice(0, 600) : String(guideValues.creative_topic || guideValues.product_name
        || guideValues.story_premise || guideValues.content || guideValues.knowledge_topic || guideValues.brand_name || "").trim();
      oneLineTemplateManuallyChosen = Boolean(lastGuideTemplateId && !ordinarySource);
      oneLineHistory.length = 0;
      guide.classList.add("show");
      renderOneLineCreator();
      status.textContent = detectedLegacy3d
        ? "检测到旧版3D填写稿：已转入一句话创作并保留可识别内容；未调用AI"
        : "一句话创作已打开；输入后点击具体候选即可，不调用AI、不消耗API额度";
    };
    const writeGuideResult = (append) => {
      if (!String(guideValues.creative_package_id || "").trim()) {
        oneLinePackages.hidden = false;
        oneLinePackages.scrollIntoView({ block: "center", behavior: "smooth" });
        oneLineState.style.color = "#ffaaa2";
        oneLineState.textContent = "请先点击一条具体创作方案；候选只供选择，不会自动确认。";
        status.style.color = "#ffb0a8";
        status.textContent = "尚未选择具体创作方案，未生成官方Base";
        return;
      }
      const concrete = validateH3GuidedConcreteFields(guideTemplateSelect.value, guideValues);
      if (!concrete.ok) {
        const issue = concrete.issues[0];
        oneLineDetails.open = true;
        const target = Array.from(oneLineDetailGrid.querySelectorAll("textarea[data-key]"))
          .find((input) => input.dataset.key === issue.key);
        if (target) { target.scrollIntoView({ block: "center", behavior: "smooth" }); target.focus(); }
        oneLineState.style.color = "#ffaaa2";
        oneLineState.textContent = issue.message;
        status.style.color = "#ffb0a8";
        status.textContent = "具体内容仍有抽象占位，尚未生成官方Base";
        return;
      }
      const missing = collectRequiredGuideGaps();
      if (missing.length) {
        const first = missing[0];
        oneLineDetails.open = true;
        const target = Array.from(oneLineDetailGrid.querySelectorAll("textarea[data-key]"))
          .find((input) => input.dataset.key === first.key);
        if (target) { target.scrollIntoView({ block: "center", behavior: "smooth" }); target.focus(); }
        oneLineState.style.color = "#ffaaa2";
        oneLineState.textContent = `还缺少“${first.label || first.title || first.key}”；请在自动填写内容中确认或修改。`;
        status.style.color = "#ffb0a8";
        status.textContent = "具体方案仍有缺项，尚未生成官方Base";
        return;
      }
      if (!ensureGuideEquipmentNames()) return;
      if (isH3GuidedSpeechMode(guideValues.dialogue)) {
        const checked = validateH3GuidedDialogueScript(guideValues.dialogue_script, {
          mode: guideValues.dialogue, language: guideValues.dialogue_language,
          duration: guideValues.duration || "15秒", segmentSeconds: 15,
        });
        if (!checked.ok) {
          oneLineDetails.open = true;
          oneLineState.style.color = "#ffaaa2";
          oneLineState.textContent = checked.errors[0] || "精确台词仍未通过检查。";
          status.style.color = "#ffb0a8";
          status.textContent = "台词时间、说话人或语速仍有问题，尚未生成官方Base";
          return;
        }
        guideValues.dialogue_script = checked.normalized;
      }
      const generated = buildH3GuidedDirectorScript(guideValues, guideSegments);
      if (!generated) return;
      textarea.value = append && textarea.value.trim()
        ? textarea.value.replace(/\s*$/, "") + "\n\n" + generated : generated;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      guide.classList.remove("show");
      const plan = guidePlan();
      if (!append && typeof textarea.__h3ParseGuidedResult === "function") {
        status.textContent = `已在本地生成 ${plan.count} 段 / ${plan.total} 秒提示词，正在自动解析到时间轴…`;
        textarea.__h3ParseGuidedResult();
      } else {
        status.textContent = `已在本地生成 ${plan.count} 段 / ${plan.total} 秒提示词；追加模式不会自动覆盖时间轴，请确认后选择导入方式`;
      }
    };
    const applyGuideTemplateById = (templateId) => {
      const selected = H3_GUIDED_TEMPLATES.find((item) => item.id === String(templateId || ""));
      if (!selected) {
        guideTemplateDescription.textContent = "没有找到对应的完整模板。";
        return false;
      }
      if (!guide.classList.contains("show")) openGuide();
      if (lastGuideTemplateId !== selected.id) {
        guideTemplateSelect.value = selected.id;
        switchGuideTemplatePreview(selected.id, { preserve: true });
      } else {
        preserveGuideCurrentWithoutBlocking();
      }
      guideTemplateSelect.value = selected.id;
      lastGuideTemplateId = selected.id;
      const applied = applyH3GuidedTemplate(selected.id, guideValues);
      guideValues = applied.fields;
      guideSegments = applied.segments;
      appliedGuideTemplateId = selected.id;
      saveGuideTemplateDraft(selected.id);
      guideIndex = 0;
      renderGuide();
      guideTemplateSelect.value = selected.id;
      updateGuideTemplateDescription();
      guideNote.textContent = `已切换为“${selected.name}”专属参数；当前蓝色输入框、候选项和后续阶段均属于这套模板。`;
      guideNote.style.color = "#9ed6ff";
      status.style.color = "";
      status.textContent = `已应用“${selected.name}”独立模板；只显示这套模板相关步骤，分段镜头与连续性将自动生成`;
      return true;
    };
    guideTemplateSelect.addEventListener("change", () => {
      const nextTemplateId = guideTemplateSelect.value;
      try {
        if (nextTemplateId) applyGuideTemplateById(nextTemplateId);
        else {
          switchGuideTemplatePreview("", { preserve: true });
          guideIndex = 0;
          updateGuideTemplateDescription();
          renderGuide();
        }
      } catch (error) {
        guideTemplateDescription.textContent = `切换模板失败：${String(error && error.message || error)}`;
        guideNote.textContent = "模板没有写入，请保留当前内容并查看浏览器控制台错误。";
        guideNote.style.color = "#ffaaa2";
        status.style.color = "#ffb0a8";
        status.textContent = "切换模板失败；原输入内容已保留";
        console.error("[H3导演台] 切换模板失败", error);
      }
    });
    guideOpenButton.addEventListener("click", openGuide);
    guideClose.addEventListener("click", () => guide.classList.remove("show"));
    oneLineInput.addEventListener("compositionstart", () => {
      oneLineComposing = true;
      if (oneLineInputTimer) window.clearTimeout(oneLineInputTimer);
      oneLineInputTimer = 0;
    });
    oneLineInput.addEventListener("compositionend", () => {
      oneLineComposing = false;
      if (oneLineInputTimer) window.clearTimeout(oneLineInputTimer);
      oneLineInputTimer = window.setTimeout(() => {
        oneLineTemplateManuallyChosen = false;
        renderOneLineCreator();
      }, 450);
    });
    oneLineInput.addEventListener("input", (event) => {
      if (oneLineComposing || event.isComposing) return;
      if (oneLineInputTimer) window.clearTimeout(oneLineInputTimer);
      oneLineInputTimer = window.setTimeout(() => {
        oneLineTemplateManuallyChosen = false;
        renderOneLineCreator();
      }, 500);
    });
    oneLineInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    });
    oneLineUndo.addEventListener("click", () => {
      const state = oneLineHistory.pop();
      if (!state) return;
      restoreOneLineState(state);
      renderOneLineCreator({ preserveScroll: true });
    });
    oneLineReset.addEventListener("click", () => {
      pushOneLineHistory();
      oneLineInput.value = "";
      guideValues = {};
      guideSegments = [];
      guideTemplateSelect.value = "";
      lastGuideTemplateId = "";
      appliedGuideTemplateId = "";
      oneLineTemplateManuallyChosen = false;
      renderOneLineCreator();
      oneLineInput.focus();
    });
    oneLineGenerate.addEventListener("click", () => writeGuideResult(false));
    oneLineAppend.addEventListener("click", () => writeGuideResult(true));
    guideBack.addEventListener("click", () => {
      if (guideIndex > 0) {
        const steps = guideSteps();
        if (guideIndex < steps.length) {
          const step = steps[guideIndex];
          if (step.kind === "segment") {
            guideSegments[step.segment.index] = collectGuideSegmentForm(false);
          } else {
            let value = String(guideInput.value || "").trim();
            if (step.key === "duration" && value) {
              const seconds = value.match(/\d+(?:\.\d+)?/);
              value = seconds ? seconds[0] + "秒" : value;
            }
            if (step.kind === "route_stage") {
              guideValues = setH3GuidedRouteAnswer(
                guideValues, step.templateId, step.profileKey, step.routeValue, step.index, value);
            } else {
              guideValues[step.key] = value;
            }
            refreshAppliedGuideTemplate();
          }
        }
        guideIndex--;
        renderGuide();
      }
    });
    guideSkip.addEventListener("click", () => {
      if (!saveGuideCurrent({ skip: true })) return;
      guideIndex++;
      renderGuide();
    });
    guideNext.addEventListener("click", () => {
      if (!saveGuideCurrent()) return;
      const nextIndex = guideIndex + 1;
      if (nextIndex >= guideSteps().length && !ensureGuideEquipmentNames()) return;
      guideIndex++;
      renderGuide();
    });
    guideReplace.addEventListener("click", () => writeGuideResult(false));
    guideAppend.addEventListener("click", () => writeGuideResult(true));
    const normalizeCustom = (key, value) => {
      let text = String(value || "").trim();
      if (key === "duration") {
        const seconds = text.match(/\d+(?:\.\d+)?/);
        if (seconds) text = seconds[0] + "秒";
      }
      return text;
    };
    const inlineTopicOptions = (trigger) => {
      const topic = normalizeH3CreativeTopic(trigger && trigger.topic || "");
      if (!topic) return [];
      const gameFirst = /(?:游戏|入场|关卡|像素|装备|技能|菜单|UI)/i.test(topic);
      const items = [
        { label: "继续补剧情", insert: "\n剧情：", summary: "写清发生什么、为什么发生和最后产生什么结果；随后会出现剧情走向候选。" },
        { label: "继续补人物", insert: "\n人物：", summary: "写主角是谁、外观识别点和人物关系；随后会出现人物候选。" },
        { label: "继续补场景", insert: "\n场景：", summary: "写地点、空间布局和人物初始位置；随后会出现场景候选。" },
        { label: "继续补镜头", insert: "\n镜头：", summary: "不需要会专业术语；随后只显示摄影机怎样移动，不混入景别或画面职责。" },
        { label: "继续补动作", insert: "\n动作：", summary: "写接近、接触、状态变化和结果；随后会出现动作链候选。" },
        { label: "继续补声音", insert: "\n声音：", summary: "写环境底噪、动作同步声和是否需要配乐。" },
        { label: "继续补结尾", insert: "\n结尾：", summary: "写最后画面停在哪里，以及是否需要为下一段保留续接状态。" },
      ];
      if (gameFirst) items.splice(1, 0,
        { label: "继续补游戏界面", insert: "\n游戏界面：", summary: "写菜单、角色卡、装备栏、确认动作以及怎样进入实际游戏。" },
        { label: "继续补装备", insert: "\n装备：", summary: "写选择什么、怎样选中，以及后续是否实际使用。" });
      return items;
    };
    const writeSelection = (rawValue) => {
      if (!activeTrigger) return;
      if (activeTrigger.key === "creative_topic" && rawValue && typeof rawValue === "object") {
        const insert = String(rawValue.insert || "").replace(/^\n/, textarea.value.endsWith("\n") ? "" : "\n");
        if (!insert) return;
        const caret = typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length;
        textarea.value = textarea.value.slice(0, caret) + insert + textarea.value.slice(caret);
        const nextCaret = caret + insert.length;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
        hideMenu();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      const chosen = normalizeCustom(activeTrigger.key,
        rawValue && typeof rawValue === "object" ? (rawValue.value || rawValue.insert || rawValue.label) : rawValue);
      if (!chosen) return;
      if (guideTemplateSelect.value && Object.hasOwn(guideValues, activeTrigger.key)) {
        guideValues[activeTrigger.key] = chosen;
        const applied = applyH3GuidedTemplate(guideTemplateSelect.value, guideValues);
        guideValues = applied.fields;
        guideSegments = applied.segments;
      }
      const scrollTop = textarea.scrollTop;
      let result;
      if (activeTrigger.manualCategory) {
        const caret = Math.max(0, Math.min(textarea.value.length,
          typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length));
        const before = textarea.value.slice(0, caret);
        const prefix = !before || /\n$/.test(before) ? "" : "\n";
        const suffix = /[；;。！？!?]$/.test(chosen) ? "" : "；";
        const replacement = `${prefix}${activeTrigger.label}：${chosen}${suffix}`;
        result = {
          text: before + replacement + textarea.value.slice(caret),
          caret: caret + replacement.length,
        };
      } else {
        result = applyH3PromptAssistSelection(textarea.value, activeTrigger, chosen);
      }
      textarea.value = result.text;
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
      textarea.scrollTop = scrollTop;
      hideMenu();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const showMenu = (trigger, settings = {}) => {
      const spec = trigger && H3_PROMPT_ASSIST_CATALOG[trigger.key];
      if (!trigger || (trigger.key !== "creative_topic" && !spec)) { hideMenu(); return; }
      if (!String(textarea.value || "").trim() && settings.manual) {
        activeManualCategory = trigger.key;
        hideMenu();
        status.style.color = "";
        status.textContent = "先在右侧输入创作意图；有内容后，这个页面才会显示按语义生成的建议";
        return;
      }
      activeTrigger = trigger;
      activeManualCategory = settings.manual ? trigger.key : "";
      choices.replaceChildren();
      const headerCopy = mk("span", "h3s-prompt-context-copy");
      headerCopy.append(
        mk("span", null, trigger.key === "creative_topic"
          ? "继续搭建你的草稿"
          : settings.manual ? `${trigger.label}参考` : `正在写：${trigger.label}`),
        mk("small", null, trigger.key === "shot"
          ? "主体先行动，摄影机随后响应 · 可点击、编辑或忽略"
          : "建议说明它对画面、时间和结果的作用 · 可点击、编辑或忽略"),
      );
      const closeButton = mk("button", "h3s-prompt-context-close", "收起");
      closeButton.type = "button";
      closeButton.addEventListener("click", hideMenu);
      assistHeader.replaceChildren(headerCopy, closeButton);
      const options = trigger.key === "creative_topic" ? inlineTopicOptions(trigger) : availableOptions(trigger.key);
      for (const option of options) {
        const value = typeof option === "string" ? option : option.label;
        const button = mk("button", "h3s-prompt-choice", value);
        button.type = "button";
        button.setAttribute("role", "option");
        button.title = trigger.key === "creative_topic"
          ? "只在光标处插入下一个草稿栏目；不会选择模板或生成完整提示词"
          : "只写入当前光标位置；不会覆盖其它文字或自动进入下一步";
        if (option && typeof option === "object" && option.summary) button.appendChild(mk("small", null, option.summary));
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => writeSelection(option));
        choices.appendChild(button);
      }
      if (!choices.children.length) { hideMenu(); return; }
      choices.classList.add("h3s-prompt-choices-compact");
      showInlineAssist();
      updateCategoryButtons();
    };
    const openCategoryPage = (key) => {
      const button = categoryButtons.get(key);
      if (!button) return;
      const caret = Math.max(0, Math.min(textarea.value.length,
        typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length));
      showMenu({ key, label: button.textContent, keyword: button.textContent,
        start: caret, end: caret, manualCategory: true }, { manual: true });
    };
    for (const [key, button] of categoryButtons) {
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        openCategoryPage(key);
      });
    }
    let mainTextareaComposing = false;
    textarea.addEventListener("compositionstart", () => {
      mainTextareaComposing = true;
      hideMenu();
    });
    textarea.addEventListener("compositionend", () => {
      mainTextareaComposing = false;
      if (inlineGuideSession) window.setTimeout(showInlineGuideMenu, 80);
      else if (String(textarea.value || "").trim()) window.setTimeout(() => openCategoryPage(activeManualCategory || "story"), 120);
      else hideMenu();
    });
    textarea.addEventListener("input", (event) => {
      if (mainTextareaComposing || event.isComposing) return;
      if (inlineGuideSession) {
        const step = inlineGuideCurrentStep();
        if (step) inlineGuideSession.draftValue = readInlineGuideDraft(step);
        if (inlineGuideRenderTimer) window.clearTimeout(inlineGuideRenderTimer);
        inlineGuideRenderTimer = window.setTimeout(showInlineGuideMenu, 120);
      } else if (String(textarea.value || "").trim()) {
        if (inlineGuideRenderTimer) window.clearTimeout(inlineGuideRenderTimer);
        inlineGuideRenderTimer = window.setTimeout(() => openCategoryPage(activeManualCategory || "story"), 180);
      } else hideMenu();
    });
    textarea.addEventListener("click", () => {
      if (inlineGuideSession) window.setTimeout(showInlineGuideMenu, 0);
      else if (String(textarea.value || "").trim()) window.setTimeout(() => openCategoryPage(activeManualCategory || "story"), 0);
      else hideMenu();
    });
    textarea.addEventListener("keyup", (event) => {
      if (event.key === "Escape" || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) hideMenu();
    });
    textarea.addEventListener("scroll", () => {
      if (!inlineGuideSession) hideMenu();
    });
    textarea.addEventListener("blur", () => window.setTimeout(() => {
      if (!root.contains(document.activeElement)) hideMenu();
    }, 0));

    /* AI技术状态只写顶部状态栏，不再在输入框下方生成黄/红色“审核/自动修正”提示框。 */
    const feedback = { clear() {}, working() {}, error() {} };
    const updateSelectionHint = () => {
      const valueLength = String(textarea.value || "").length;
      const rawStart = Number(textarea.selectionStart);
      const rawEnd = Number(textarea.selectionEnd);
      const length = valueLength > 0 && Number.isFinite(rawStart) && Number.isFinite(rawEnd)
        ? Math.max(0, Math.min(valueLength, rawEnd) - Math.min(valueLength, rawStart)) : 0;
      selectionHint.textContent = length ? `已框选 ${length} 字` : "先框选一段文字";
      refineSelectionButton.classList.toggle("primary", length > 0);
      refineSelectionButton.disabled = length <= 0;
    };
    textarea.addEventListener("select", updateSelectionHint);
    textarea.addEventListener("mouseup", updateSelectionHint);
    textarea.addEventListener("keyup", updateSelectionHint);
    textarea.addEventListener("input", updateSelectionHint);
    refineSelectionButton.addEventListener("pointerdown", (event) => event.preventDefault());
    refineSelectionButton.addEventListener("click", async () => {
      refineSelectionButton.disabled = true;
      try {
        await refineSelectedH3TextWithAI(textarea, feedback);
      } catch (error) {
        status.style.color = "#ffb0a8";
        status.textContent = "框选内容精修失败：" + error.message;
        feedback.error("框选内容没有改动", error.message);
      } finally {
        refineSelectionButton.disabled = false;
        updateSelectionHint();
      }
    });
    updateSelectionHint();
    const mount = (input, resizeBar) => {
      const parent = input && input.parentNode;
      if (!parent) return;
      if (resizeBar && resizeBar.parentNode === parent) {
        parent.insertBefore(root, resizeBar.nextSibling);
      } else {
        parent.insertBefore(root, input.nextSibling);
      }
    };
    return { element: root, mount, feedback, hideMenu, openGuide, applyGuideTemplate: applyGuideTemplateById };
  };

  /* AI只调用一次。非空故事/剧本直接写回；官方分镜只执行不可缺少的格式和
     时长技术验证，不做内容评分，不再自动发起第二次修正请求。 */
  const rewriteScriptWithAI = async (textarea, systemPrompt, label, outputValidator = null, options = {}) => {
    const feedback = options && options.feedback;
    const input = textarea.value.trim();
    if (!input) { status.textContent = "脚本框是空的，先粘贴故事、小说或剧本"; textarea.focus(); return false; }
    const sourceContract = extractH3TimelineStyleContract(input);
    const contractPrompt = formatH3TimelineStyleContract(sourceContract);
    const explicitSegmentContract = options && options.includeExplicitSegmentContract
      ? extractExplicitStorySegmentContract(input, sourceContract.sourceDuration) : null;
    if (explicitSegmentContract && explicitSegmentContract.error) {
      status.style.color = "#ffb0a8";
      status.textContent = label + "未请求 API：原剧本的明确分段要求无效：" + explicitSegmentContract.error;
      return false;
    }
    const segmentPrompt = formatOfficialStoryboardSegmentPrompt(explicitSegmentContract);
    const coarseShotPrompt = options && options.expandCoarseOfficialShots
      ? formatCoarseOfficialShotExpansionPrompt(input) : "";
    const referenceGuidance = buildH3ReferencePromptGuidance(input);
    const effectiveSystemPrompt = [systemPrompt, contractPrompt, segmentPrompt, coarseShotPrompt, referenceGuidance]
      .filter((item) => String(item || "").trim()).join("\n\n");
    const requestAiText = async (messages, temperature) => {
      const response = await api.fetchApi("/h3director/ai_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, images: [], max_tokens: 8000, temperature }),
      });
      const result = await response.json();
      if (!response.ok || !result.content) throw new Error(result.error || ("HTTP " + response.status));
      return String(result.content || "");
    };
    if (feedback) feedback.clear();
    status.style.color = "";
    status.textContent = label + "处理中…";
    const baseMessages = [
      { role: "system", content: effectiveSystemPrompt },
      { role: "user", content: input },
    ];
    const output = await requestAiText(baseMessages, 0.45);
    const recoveredOutput = options && Array.isArray(options.assetCatalog)
      ? restoreH3AssetMentions(output, options.assetCatalog,
        { official: options.assetOutputType === "official" })
      : output;
    const checked = outputValidator
      ? outputValidator(recoveredOutput, input, { sourceContract })
      : { ok: true, content: recoveredOutput, note: "" };
    if (!checked || !checked.ok) {
      if (options && options.keepRejectedOutput && String(recoveredOutput || "").trim()) {
        textarea.value = String(recoveredOutput || "").trim();
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        if (typeof textarea.__h3RefreshMentions === "function") textarea.__h3RefreshMentions();
        status.style.color = "#ffb84d";
        status.textContent = label + "已返回，但暂未通过解析校验："
          + String(checked && checked.error || "官方格式无法解析")
          + "；结果已保留在脚本框，不会自动导入。修改后请手动选择导入方式";
        return false;
      }
      status.style.color = "#ffb0a8";
      status.textContent = label + "未写入：" + String(checked && checked.error || "API返回为空或官方格式无法解析");
      return false;
    }
    textarea.value = checked.content;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof textarea.__h3RefreshMentions === "function") textarea.__h3RefreshMentions();
    status.style.color = "";
    if (feedback) feedback.clear();
    const validationNote = String(checked && checked.note || "").trim();
    status.textContent = label + "完成" + validationNote + "，请点“解析并替换全部段”或选择其他导入方式";
    if (options && options.completionHint) {
      status.textContent = label + "完成" + validationNote + String(options.completionHint);
    }
    return true;
  };

  /* 将“只补了官方 Base 首字段”的安全规范化回写到脚本框。这样后续复检、
     保存和再次导入始终使用同一份完整模板，而不是把修复仅留在临时解析结果里。 */
  const applyNormalizedScriptText = (textarea, propertyName, parsed) => {
    const normalized = String(parsed && parsed.normalizedSource || "").trim();
    if (!normalized || normalized === String(textarea && textarea.value || "").trim()) return "";
    textarea.value = normalized;
    if (typeof textarea.__h3RefreshMentions === "function") textarea.__h3RefreshMentions();
    if (!node.properties) node.properties = {};
    node.properties[propertyName] = normalized;
    const info = Array.isArray(parsed && parsed.infos) ? parsed.infos[0] : "";
    return info ? "；✓ " + info : "；✓ 已自动规范化 H3 Base 模板";
  };

  const reloadFromWidget = () => {
    normalizeSummaryWidget();
    createProjectsReady = false;
    try {
      const parsed = JSON.parse(jsonWidget.value || "[]");
      if (Array.isArray(parsed) && parsed.length) createSegs = parsed;
    } catch (e) { /* 保持默认 */ }
    createTimelineVideos = normalizeCreateTimelineVideos(node.properties.h3_create_timeline_videos, createSegs.length);
    const createLibraryFiles = ensureCreateGlobalRefs(node, createSegs);
    migrateCreateAssetLibraryIds(node, createLibraryFiles, createSegs);
    if (vJsonWidget) {
      try {
        const vparsed = JSON.parse(vJsonWidget.value || "[]");
        if (Array.isArray(vparsed) && vparsed.length) videoSegs = vparsed;
      } catch (e) { /* 保持默认 */ }
    }
    if (tJsonWidget) {
      try {
        const tparsed = JSON.parse(tJsonWidget.value || "[]");
        if (Array.isArray(tparsed) && tparsed.length) {
          textSegs = tparsed;
          loadSharedRefsWidget();
          migrateTextRefs();
        }
      } catch (e) { /* 保持默认 */ }
    }
    normalizeSegmentKeyframes(createSegs);
    normalizeSegmentKeyframes(videoSegs);
    normalizeSegmentKeyframes(textSegs);
    normalizeSegmentSecondSamples(createSegs);
    normalizeSegmentSecondSamples(videoSegs);
    normalizeSegmentSecondSamples(textSegs);
    migrateModeGlobalPrompts();
    initializeCreateProjects();
    segs = curMode() === "video" ? videoSegs : curMode() === "text" ? textSegs : createSegs;
    sel = Math.max(0, Math.min(sel, segs.length - 1));
    syncGlobalPromptWidget();
    clearRemovedLowVramMetadata();
    save();
    /* onConfigure 会先恢复 node.properties，再调用本函数。页签与正文必须在同一次
       恢复中使用同一模式，否则会出现“创作页高亮、正文却是文本页”的假串页。 */
    syncTabs();
    syncWorkspaceVisibility();
    renderTimeline();
    renderEditor();
  };
  try {
    const parsed = JSON.parse(jsonWidget.value || "[]");
    if (Array.isArray(parsed) && parsed.length) createSegs = parsed;
  } catch (e) { /* 保持默认 */ }
  createTimelineVideos = normalizeCreateTimelineVideos(node.properties.h3_create_timeline_videos, createSegs.length);
  const createLibraryFiles = ensureCreateGlobalRefs(node, createSegs);
  migrateCreateAssetLibraryIds(node, createLibraryFiles, createSegs);
  if (vJsonWidget) {
    try {
      const vparsed = JSON.parse(vJsonWidget.value || "[]");
      if (Array.isArray(vparsed) && vparsed.length) videoSegs = vparsed;
    } catch (e) { /* 保持默认 */ }
  }
  if (tJsonWidget) {
    try {
      const tparsed = JSON.parse(tJsonWidget.value || "[]");
      if (Array.isArray(tparsed) && tparsed.length) {
        textSegs = tparsed;
        migrateTextRefs();
      }
    } catch (e) { /* 保持默认 */ }
  }
  normalizeSegmentKeyframes(createSegs);
  normalizeSegmentKeyframes(videoSegs);
  normalizeSegmentKeyframes(textSegs);
  normalizeSegmentSecondSamples(createSegs);
  normalizeSegmentSecondSamples(videoSegs);
  normalizeSegmentSecondSamples(textSegs);
  migrateModeGlobalPrompts();
  initializeCreateProjects();
  segs = curMode() === "video" ? videoSegs : curMode() === "text" ? textSegs : createSegs;
  syncGlobalPromptWidget();
  clearRemovedLowVramMetadata();
  save();

  /* v2.13.15：鼠标框选选中的段集合（拖框高亮，配合「删选中」按钮批量删除） */
  const boxSel = new Set();
  const clearBoxSel = () => { boxSel.clear(); };
  let busy = false;
  let reorderingCreateSegments = false;
  let durInput = null;
  let picHintEl = null;
  const editorObservers = new Set();
  const disconnectEditorObservers = () => {
    for (const observer of editorObservers) observer.disconnect();
    editorObservers.clear();
  };
  const observeEditorSize = (element, callback) => {
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(callback);
    observer.observe(element);
    editorObservers.add(observer);
  };

  const segDur = (s) => clampDur(Number(s.duration ?? 10));

  /* 三个页面都允许手动使用 H3 原生可生成的完整整数时长范围。单段不能伪装成
     超过 362 帧（约 15 秒）；更长内容通过增加段数完成。 */
  const manualBounds = () => [2, 15];
  const clampManual = (v) => {
    if (isNaN(v)) v = 10;
    const bd = manualBounds();
    return Math.min(bd[1], Math.max(bd[0], Math.round(v)));
  };

  /* 音频上传共用逻辑（「+音频」按钮 / 拖放到 AUDIO 轨道块 都走这里）。
     目标段还没选音频来源时自动切到「自定义替换」。 */
  async function uploadAudioToSeg(file, idx) {
    const fd = new FormData();
    fd.append("audio", file, file.name);
    const resp = await api.fetchApi("/h3director/upload_audio", { method: "POST", body: fd });
    const r = await resp.json();
    if (!(r.ok && r.name)) throw new Error(r.error || ("HTTP " + resp.status));
    const seg = segs[idx];
    seg.audio = r.name;
    seg.audio_label = r.label || r.name;  // 原始文件名（界面显示用）
    if (!seg.audio_src || seg.audio_src === "model") { seg.audio_src = "replace"; seg.audio_mode = "replace"; }
    save();
  }

  const box = mk("div", "h3s");
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  box.appendChild(style);
  attachH3CanvasWheelZoom(box);

  /* 整面板缩放条（固定在面板顶部，永远可见）：拖着它放大/缩小整个导演台节点 */
  const nodeBar = document.createElement("div");
  nodeBar.style.cssText = "display:flex;align-items:center;justify-content:center;height:16px;flex:none;"
    + "cursor:ns-resize;background:#1c3145;border:1px solid #2f567a;border-radius:5px;"
    + "color:#9fc8ff;font-size:10px;user-select:none;letter-spacing:1px;";
  nodeBar.textContent = "≡ 按住拖动：放大 / 缩小整个导演台面板";
  box.appendChild(nodeBar);
  nodeBar.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX, y0 = ev.clientY;
    const w0 = node.size[0], h0 = node.size[1];
    const sc = canvasScale();
    const onMove = (e2) => {
      node.setSize([
        Math.max(760, w0 + (e2.clientX - x0) / sc),
        Math.max(500, h0 + (e2.clientY - y0) / sc),
      ]);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  nodeBar.addEventListener("click", (ev) => ev.stopPropagation());

  /* 顶栏（运行按钮已按用户要求移除：直接在 ComfyUI 队列里跑节点即可） */
  const bar = mk("div", "h3s-bar");
  /* 界面页签（v2.1 视频 / v2.11 文本）：创作=完整编辑器 / 视频=参考视频驱动 / 文本=纯提示词。
     存 node.properties（随工作流保存），不走 segments_json（后端按数组解析）。 */
  const btnTabC = mk("button", "h3s-btn", "创作界面");
  const btnTabV = mk("button", "h3s-btn", "视频界面");
  const btnTabT = mk("button", "h3s-btn", "文本界面");
  const btnTabU = mk("button", "h3s-btn", "视频超分");
  btnTabC.title = "提示词 + 照片 + 配音/音色的创作模式";
  btnTabV.title = "参考视频驱动：上方视频（动作/运镜）+ 下方照片（外观），白模→成片、照片人物替换视频人物";
  btnTabT.title = "纯提示词生成：可上传共用参考图保持角色一致；粘贴带时间的分镜脚本一键解析成段";
  btnTabU.title = "独立后处理：拖入已有视频，使用 Lanczos 或 UPSCALE_MODEL 放大；不改变 H3 采样";
  const syncTabs = () => {
    const tab = curTab();
    const m = curMode();
    btnTabC.classList.toggle("primary", tab === "create");
    btnTabV.classList.toggle("primary", tab === "video");
    btnTabT.classList.toggle("primary", tab === "text");
    btnTabU.classList.toggle("primary", tab === "upscale");
    /* 创作、视频、文本各自操作当前页面的独立段数组；独立超分页没有分段。 */
    const isUpscale = tab === "upscale";
    const disp = isUpscale ? "none" : "";
    for (const control of [allSelectionToggle, allTailToggle]) control.style.display = disp;
    syncAllSelectionToggle();
    btnDeepRelease.style.display = !isUpscale && m === "video" ? "" : "none";
    btnAdd.style.display = isUpscale ? "none" : "";
    btnDel.style.display = isUpscale ? "none" : "";
    for (const button of [btnRun, btnMerge, btnViewMerge, btnSendMergeUpscale]) {
      button.style.display = isUpscale ? "none" : "";
    }
    runState.style.display = isUpscale ? "none" : "";
    syncSecondSamplePanel();
  };
  /* 切页签 = 换数据集 + 重渲轨道和编辑区（v2.3 前只 renderEditor，轨道残留另一
     界面的样式——"创作界面却显示波形"的泄漏 bug 根因） */
  const switchMode = (m) => {
    const tab = normalizeStudioTab(m);
    if (tab === "upscale") {
      flushScheduledSave();
      captureCurrentGlobalPrompt();
      node.properties.h3_active_tab = "upscale";
      persistUpscaleState();
      syncTabs();
      syncWorkspaceVisibility();
      renderEditor();
      return;
    }
    m = normalizeStudioMode(tab);
    if (m === "text" && !tJsonWidget) {
      status.textContent = "文本界面需要新版后端：请完全重启 ComfyUI 再 Ctrl+F5";
      status.style.color = "#ff8080";
      return;
    }
    flushScheduledSave();
    captureCurrentGlobalPrompt();
    node.properties.h3_mode = m;
    node.properties.h3_active_tab = m;
    syncGlobalPromptWidget(m);
    segs = m === "video" ? videoSegs : m === "text" ? textSegs : createSegs;
    sel = 0;
    btnViewMerge.disabled = true;
    btnSendMergeUpscale.disabled = true;
    mergedName = "";
    setMergeState("");
    clearBoxSel();
    syncTabs();
    syncWorkspaceVisibility();
    save();
    renderTimeline();
    renderEditor();
  };
  btnTabC.addEventListener("click", () => switchMode("create"));
  btnTabV.addEventListener("click", () => switchMode("video"));
  btnTabT.addEventListener("click", () => switchMode("text"));
  btnTabU.addEventListener("click", () => switchMode("upscale"));
  const btnAdd = mk("button", "h3s-btn", "+段");
  const btnDel = mk("button", "h3s-btn", "-段");
  const allSelectionToggle = mk("label", "h3s-bulk-switch");
  const allSelectionInput = document.createElement("input");
  allSelectionInput.type = "checkbox";
  allSelectionInput.setAttribute("role", "switch");
  allSelectionInput.setAttribute("aria-label", "启用当前页面全部段");
  const allSelectionText = mk("span", null, "全部启用");
  allSelectionToggle.append(allSelectionInput, allSelectionText);
  let secondAllSelectionToggle = null;
  let secondAllSelectionInput = null;
  const allTailToggle = mk("label", "h3s-bulk-switch");
  const allTailInput = document.createElement("input");
  allTailInput.type = "checkbox";
  allTailInput.setAttribute("role", "switch");
  allTailInput.setAttribute("aria-label", "当前页面第2段以后全部续接上段尾帧");
  allTailToggle.append(allTailInput, mk("span", null, "全部尾帧"));
  const syncAllSelectionToggle = () => {
    const selected = segs.filter((segment) => segment.enabled !== false).length;
    allSelectionInput.checked = segs.length > 0 && selected === segs.length;
    allSelectionInput.indeterminate = selected > 0 && selected < segs.length;
    allSelectionToggle.title = `当前页面已启用 ${selected}/${segs.length} 段；勾选为全部启用，取消为全部停用`;
    if (secondAllSelectionInput) {
      const secondEnabled = segs.filter((segment) => normalizeH3SecondSample(
        segment && segment.second_sample, segment).mode !== "off").length;
      secondAllSelectionInput.checked = segs.length > 0 && secondEnabled === segs.length;
      secondAllSelectionInput.indeterminate = secondEnabled > 0 && secondEnabled < segs.length;
      secondAllSelectionToggle.title = `当前页面已有 ${secondEnabled}/${segs.length} 段启用二采；勾选为全部二采，取消为全部关闭二采并保留各段参数`;
    }
    const tailSegments = segs.slice(1);
    const tailed = tailSegments.filter((segment) => segment.use_tail !== false).length;
    allTailInput.checked = tailSegments.length > 0 && tailed === tailSegments.length;
    allTailInput.indeterminate = tailed > 0 && tailed < tailSegments.length;
    allTailInput.disabled = tailSegments.length === 0;
    allTailToggle.title = tailSegments.length
      ? `当前页面第2段以后已有 ${tailed}/${tailSegments.length} 段续接上段尾帧；第1段始终忽略`
      : "当前页面只有1段，没有可续接的上段尾帧";
  };
  const setAllCurrentSegmentsEnabled = (enabled) => {
    segs.forEach((segment) => { segment.enabled = enabled; });
    save(); renderTimeline(); renderEditor(); syncSecondSamplePanel();
    status.style.color = "";
    status.textContent = enabled
      ? `已勾选当前页面全部 ${segs.length} 段`
      : "已取消当前页面全部勾选（运行将跳过所有段）";
  };
  const totalLab = mk("span", "h3s-total", "");
  const status = mk("span", "h3s-status", "就绪");
  /* 前端版本号常显：用户截图可直接确认 JS 是否最新，终止"缓存旧版"猜谜 */
  const verLab = mk("span", "h3s-hint", "v" + H3S_VERSION);
  /* 面板内运行只提交导演台及其上游，避免连带执行下游完整帧汇总/另存节点。 */
  const btnDeepRelease = mk("button", "h3s-btn", "🧹 段后深度释放");
  btnDeepRelease.title = "只在当前生成段完成并安全保存后卸载驻留模型、清理内存和显存；不会中断正在采样的段。下一段需要重新加载模型，启动可能稍慢，但有助于长时间多段生成保持稳定。";
  btnDeepRelease.addEventListener("click", async () => {
    if (btnDeepRelease.disabled) return;
    btnDeepRelease.disabled = true;
    status.style.color = "";
    status.textContent = busy
      ? "正在安排：当前段保存后深度释放…"
      : "正在安排：下一生成段保存后深度释放…";
    try {
      const response = await api.fetchApi("/h3director/deep_release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: ensureProjectId() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
      status.style.color = "#8ee6a0";
      status.textContent = busy
        ? "已安排：当前段安全保存后深度释放；下一段重新加载可能稍慢"
        : "已安排：下次生成首段安全保存后深度释放";
    } catch (error) {
      status.style.color = "#ff8080";
      status.textContent = "深度释放请求失败：" + error.message;
    } finally {
      btnDeepRelease.disabled = false;
    }
  });
  const btnRun = mk("button", "h3s-btn primary", "▶ 运行");
  btnRun.title = "启用二采时运行当前页面已选择段；未启用二采时保持当前页面原有运行范围";
  btnRun.addEventListener("click", () => run(true));
  const runState = mk("span", "h3s-run-state");
  runState.hidden = true;
  const setRunState = (text, tone = "") => {
    runState.textContent = text;
    runState.hidden = !text;
    runState.dataset.tone = tone;
  };
  const secondSampleHead = mk("div", "h3s-second-head");
  const secondSampleChevron = mk("span", null, "▸");
  const secondSampleSummary = mk("span", "h3s-second-summary");
  const secondSampleEnabledBadge = mk("span", "h3s-second-badge disabled", "未启用");
  const secondSampleScopeBadge = mk("span", "h3s-second-badge", "未选择");
  const secondSampleSizeBadge = mk("span", "h3s-second-badge", "尺寸待确认");
  secondSampleSummary.append(secondSampleEnabledBadge, secondSampleScopeBadge, secondSampleSizeBadge);
  secondSampleHead.title = "设置当前页面已选择段的两阶段 latent 采样；关闭时仍可普通重抽";
  secondSampleHead.append(secondSampleChevron, mk("b", null, "二采设置"), secondSampleSummary);
  secondSampleHead.addEventListener("click", () => {
    secondSampleExpanded = !secondSampleExpanded;
    node.properties.h3_second_sample_panel_open = secondSampleExpanded;
    syncSecondSamplePanel();
  });
  const btnMerge = mk("button", "h3s-btn", "合并成片");
  btnMerge.title = "按当前所有启用分段的最新文件重新合并；例如重抽段4后得到 1-2-3-新4-5";
  const btnViewMerge = mk("button", "h3s-btn", "查看成片");
  btnViewMerge.title = "在导演台内播放当前界面的最新合并成片";
  btnViewMerge.disabled = true;
  const btnSendMergeUpscale = mk("button", "h3s-btn", "成片送去超分");
  btnSendMergeUpscale.title = "把当前界面最新合并成片送到独立视频超分页；原成片不会被覆盖";
  btnSendMergeUpscale.disabled = true;
  const mergeState = mk("span", "h3s-merge-state");
  mergeState.hidden = true;
  const setMergeState = (text, tone = "") => {
    mergeState.textContent = text;
    mergeState.hidden = !text;
    mergeState.dataset.tone = tone;
  };
  let mergedMtime = 0;
  let mergedName = "";
  const projectStatusCache = new Map();
  const projectStatusInflight = new Map();
  const fetchProjectStatus = ({ force = false } = {}) => {
    const key = _modeQ();
    const cached = projectStatusCache.get(key);
    if (!force && cached && Date.now() - cached.at < 750) return Promise.resolve(cached.data);
    if (projectStatusInflight.has(key)) return projectStatusInflight.get(key);
    const request = api.fetchApi("/h3director/status?" + key)
      .then((response) => response.json())
      .then((data) => {
        projectStatusCache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => projectStatusInflight.delete(key));
    projectStatusInflight.set(key, request);
    return request;
  };
  const invalidateProjectStatus = () => projectStatusCache.delete(_modeQ());
  const createProjectControls = new Set();
  const createProjectOperationBusy = () => (
    busy || btnMerge.disabled || applyingCreateProject || reorderingCreateSegments);
  const syncCreateProjectControls = () => {
    for (const control of createProjectControls) {
      control.disabled = createProjectOperationBusy() || control.__h3ProjectAvailable === false;
    }
  };
  const registerCreateProjectControl = (control, available = true) => {
    control.__h3ProjectAvailable = available;
    createProjectControls.add(control);
    control.disabled = createProjectOperationBusy() || !available;
    return control;
  };
  const backupActiveCreateProject = () => {
    if (!createProjectStore) return false;
    captureCurrentGlobalPrompt();
    const activeId = String(node.properties.h3_create_active_project_id || "");
    if (!getH3Project(createProjectStore, activeId)) return false;
    backupH3Project(createProjectStore, activeId, captureCreateProjectState(), sel);
    persistCreateProjectStore();
    return true;
  };
  const switchCreateProject = (projectId, completionText = "已载入成片") => {
    if (createProjectOperationBusy()) {
      status.style.color = "#e8bd68";
      status.textContent = "等待当前生成或合并任务完成后即可切换成片";
      return false;
    }
    flushScheduledSave();
    save();
    const target = getH3Project(createProjectStore, projectId);
    if (!target) {
      status.style.color = "#ff8080";
      status.textContent = "成片不存在或项目数据已损坏";
      return false;
    }
    if (target.id === node.properties.h3_create_active_project_id) {
      status.style.color = "";
      status.textContent = completionText;
      return true;
    }
    const previousStore = cloneH3ProjectValue(createProjectStore);
    const previousId = String(node.properties.h3_create_active_project_id || "");
    applyingCreateProject = true;
    syncCreateProjectControls();
    try {
      const claimedId = claimProjectId(target.id);
      if (claimedId !== target.id) target.id = claimedId;
      node.properties.h3_create_active_project_id = target.id;
      applyCreateProjectState(target);
      persistCreateProjectStore();
      jsonWidget.value = JSON.stringify(createSegs);
      node.properties.h3_create_timeline_videos = createTimelineVideos;
      projectStatusCache.clear();
      projectStatusInflight.clear();
      clearBoxSel();
      btnViewMerge.disabled = true;
      setMergeState("");
      save();
    } catch (error) {
      createProjectStore = previousStore;
      const previous = getH3Project(createProjectStore, previousId) || createProjectStore.projects[0];
      node.properties.h3_create_active_project_id = previous.id;
      claimProjectId(previous.id);
      applyCreateProjectState(previous);
      persistCreateProjectStore();
      save();
      status.style.color = "#ff8080";
      status.textContent = "载入成片失败：" + error.message;
      return false;
    } finally {
      applyingCreateProject = false;
      syncCreateProjectControls();
    }
    renderTimeline();
    renderEditor();
    status.style.color = "";
    status.textContent = completionText;
    return true;
  };
  const restoreActiveCreateProjectBackup = () => {
    if (createProjectOperationBusy()) return false;
    const activeId = String(node.properties.h3_create_active_project_id || "");
    const restored = restoreH3ProjectBackup(createProjectStore, activeId);
    if (!restored.restored) return false;
    const project = getH3Project(createProjectStore, activeId);
    applyingCreateProject = true;
    try {
      applyCreateProjectState(project);
      persistCreateProjectStore();
      save();
    } finally {
      applyingCreateProject = false;
    }
    renderTimeline();
    renderEditor();
    status.style.color = "";
    status.textContent = "已恢复最近一次清空前的成片状态";
    return true;
  };
  const previewCountKey = (mode = curMode()) => "h3_preview_compare_count_" + normalizeStudioMode(mode);
  const previewCount = (mode = curMode()) => Math.max(1, Math.min(4,
    Math.round(Number(node.properties[previewCountKey(mode)]) || 1)));
  const setPreviewCount = (value, mode = curMode()) => {
    node.properties[previewCountKey(mode)] = Math.max(1, Math.min(4, Math.round(Number(value) || 1)));
    save();
  };
  const attachPreviewCardResize = (card, mode) => {
    const key = "h3_preview_panel_height_" + normalizeStudioMode(mode);
    const savedHeight = Number(node.properties[key]);
    card.style.flex = "none";
    card.style.overflow = "auto";
    if (Number.isFinite(savedHeight) && savedHeight >= 300) {
      card.style.height = Math.min(3000, savedHeight) + "px";
    }
    attachBottomBar(card, 240, 300, () => {
      node.properties[key] = Math.round(card.offsetHeight);
      scheduleSave();
    }, {
      horizontal: false,
      label: "≡ 按住拖动：调整视频区域高度",
    });
  };
  const openAssetImagePreview = (src, label) => {
    document.querySelectorAll(".h3s-asset-viewer").forEach((element) => element.remove());
    const overlay = mk("div", "h3s-asset-viewer");
    overlay.tabIndex = -1;
    const panel = mk("div", "h3s-asset-viewer-panel");
    const head = mk("div", "h3s-asset-viewer-head");
    const close = mk("button", "h3s-btn", "关闭");
    const dismiss = () => overlay.remove();
    close.addEventListener("click", dismiss);
    head.append(mk("span", null, label || "资产预览"), close);
    const image = document.createElement("img");
    image.src = src;
    image.alt = label || "资产预览";
    image.addEventListener("click", (event) => event.stopPropagation());
    panel.addEventListener("click", (event) => event.stopPropagation());
    panel.append(head, image);
    overlay.appendChild(panel);
    overlay.addEventListener("click", dismiss);
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dismiss();
    });
    document.body.appendChild(overlay);
    overlay.focus();
  };
  const uploadSegmentKeyframe = async (file) => {
    const data = new FormData();
    data.append("image", file, file.name);
    data.append("overwrite", "true");
    const response = await api.fetchApi("/upload/image", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok || !result || !result.name) {
      throw new Error(result && result.error || ("HTTP " + response.status));
    }
    return (result.subfolder ? result.subfolder + "/" : "") + result.name;
  };
  const pickSegmentKeyframe = (segment, kind) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      try {
        if (!input.files || !input.files[0]) return;
        status.style.color = "";
        status.textContent = kind === "first" ? "正在上传起始关键帧…" : "正在上传目标尾帧…";
        const savedName = await uploadSegmentKeyframe(input.files[0]);
        if (kind === "first") {
          segment.first_frame = savedName;
          segment.first_frame_mode = "custom";
          segment.use_tail = false;
        } else {
          segment.last_frame = savedName;
        }
        save();
        renderEditor();
        status.textContent = kind === "first"
          ? "已设置自定义起始关键帧（FL2VA 硬首帧）"
          : "已设置目标尾帧（FL2VA 硬尾帧）";
      } catch (error) {
        status.style.color = "#ff8080";
        status.textContent = "关键帧上传失败：" + error.message;
      } finally {
        input.remove();
      }
    });
    input.click();
  };
  const renderSegmentKeyframes = (segment, segmentIndex) => {
    normalizeSegmentKeyframes([segment]);
    const wrap = mk("div", "h3s-keyframes");
    wrap.dataset.h3Keyframes = "true";

    const firstSlot = mk("div", "h3s-keyframe-slot");
    firstSlot.appendChild(mk("b", null, "起始关键帧"));
    const firstMode = document.createElement("select");
    firstMode.innerHTML = '<option value="none">无</option>'
      + '<option value="previous_tail">继承上一段尾帧</option>'
      + '<option value="custom">上传图片</option>';
    firstMode.value = segment.first_frame_mode;
    firstMode.options[1].disabled = segmentIndex === 0;
    firstMode.title = "无=纯文字/普通参考生成；继承上一段尾帧=保留现有续接功能；上传图片=H3 官方 FL2VA 硬首帧";
    firstMode.addEventListener("change", () => {
      if (firstMode.value === "custom" && !segment.first_frame) {
        firstMode.value = segment.first_frame_mode;
        pickSegmentKeyframe(segment, "first");
        return;
      }
      if (firstMode.value === "custom") {
        segment.first_frame_mode = "custom";
        segment.use_tail = false;
      } else {
        setSegmentPreviousTail(segment, firstMode.value === "previous_tail");
      }
      save();
      renderEditor();
    });
    firstSlot.appendChild(firstMode);
    let firstPreview = null;
    let firstLabel = "未设置";
    if (segment.first_frame_mode === "custom" && segment.first_frame) {
      firstPreview = api.apiURL("/view?filename=" + encodeURIComponent(segment.first_frame)
        + "&type=input&t=" + Date.now());
      firstLabel = "自定义首帧";
    } else if (segment.first_frame_mode === "previous_tail" && segmentIndex > 0) {
      firstPreview = api.apiURL("/h3director/tail?seg=" + segmentIndex + "&" + _modeQ() + "&t=" + Date.now());
      firstLabel = "上一段尾帧";
    }
    if (firstPreview) {
      const image = document.createElement("img");
      image.className = "h3s-keyframe-preview";
      image.src = firstPreview;
      image.alt = firstLabel;
      image.title = firstLabel + "（点击放大）";
      image.addEventListener("click", () => openAssetImagePreview(firstPreview, firstLabel));
      firstSlot.appendChild(image);
    } else {
      firstSlot.appendChild(mk("span", "h3s-keyframe-empty", "无"));
    }
    const firstUpload = mk("button", "h3s-btn", segment.first_frame ? "更换" : "上传");
    firstUpload.title = "上传图片作为本段 H3 官方硬首帧";
    firstUpload.addEventListener("click", () => pickSegmentKeyframe(segment, "first"));
    firstSlot.appendChild(firstUpload);
    if (segment.first_frame) {
      const clear = mk("button", "h3s-btn", "删除");
      clear.title = "删除自定义首帧设置；不会删除 input 目录中的原图片";
      clear.addEventListener("click", () => {
        segment.first_frame = "";
        if (segment.first_frame_mode === "custom") setSegmentPreviousTail(segment, false);
        save();
        renderEditor();
      });
      firstSlot.appendChild(clear);
    }

    const lastSlot = mk("div", "h3s-keyframe-slot");
    lastSlot.appendChild(mk("b", null, "目标尾帧"));
    if (segment.last_frame) {
      const src = api.apiURL("/view?filename=" + encodeURIComponent(segment.last_frame)
        + "&type=input&t=" + Date.now());
      const image = document.createElement("img");
      image.className = "h3s-keyframe-preview";
      image.src = src;
      image.alt = "目标尾帧";
      image.title = "目标尾帧（点击放大）";
      image.addEventListener("click", () => openAssetImagePreview(src, "目标尾帧"));
      lastSlot.appendChild(image);
    } else {
      lastSlot.appendChild(mk("span", "h3s-keyframe-empty", "无"));
    }
    const lastUpload = mk("button", "h3s-btn", segment.last_frame ? "更换" : "上传");
    lastUpload.title = "上传图片作为本段 H3 官方目标尾帧";
    lastUpload.addEventListener("click", () => pickSegmentKeyframe(segment, "last"));
    lastSlot.appendChild(lastUpload);
    if (segment.last_frame) {
      const clear = mk("button", "h3s-btn", "删除");
      clear.title = "删除目标尾帧设置；不会删除 input 目录中的原图片";
      clear.addEventListener("click", () => {
        segment.last_frame = "";
        save();
        renderEditor();
      });
      lastSlot.appendChild(clear);
    }
    lastSlot.appendChild(mk("span", "h3s-hint", "仅 FL2VA 硬关键帧；不占用 Picture 编号"));
    wrap.append(firstSlot, lastSlot);
    return wrap;
  };
  const openMergedVideoPreview = (src, label) => {
    document.querySelectorAll(".h3s-merged-viewer").forEach((element) => element.remove());
    const overlay = mk("div", "h3s-asset-viewer h3s-merged-viewer");
    overlay.tabIndex = -1;
    const panel = mk("div", "h3s-asset-viewer-panel h3s-merged-viewer-panel");
    const head = mk("div", "h3s-asset-viewer-head");
    const actions = mk("div", "h3s-row");
    const external = mk("button", "h3s-btn", "新窗口打开");
    const close = mk("button", "h3s-btn", "关闭");
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.preload = "metadata";
    video.src = src;
    const dismiss = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      overlay.remove();
    };
    external.addEventListener("click", () => window.open(src, "_blank"));
    close.addEventListener("click", dismiss);
    actions.append(external, close);
    head.append(mk("span", null, label || "合并成片"), actions);
    video.addEventListener("click", (event) => event.stopPropagation());
    panel.addEventListener("click", (event) => event.stopPropagation());
    panel.append(head, video);
    overlay.appendChild(panel);
    overlay.addEventListener("click", dismiss);
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dismiss();
    });
    document.body.appendChild(overlay);
    overlay.focus();
    video.play().catch(() => {});
  };
  const sendOutputVideoToUpscale = ({ filename, label, preview }) => {
    const sourceFile = h3OutputVideoSource(ensureProjectId(), filename);
    if (!sourceFile) {
      status.style.color = "#ff8080";
      status.textContent = "无法识别这个视频的本地文件，请先生成或刷新视频列表";
      return false;
    }
    upscaleSource = {
      source_file: sourceFile,
      label: String(label || filename),
      preview: String(preview || ""),
    };
    closeUpscaleComparison();
    if (secondSampleStatusPollTimer) clearTimeout(secondSampleStatusPollTimer);
    secondSampleStatusPollTimer = null;
    upscaleResult = null;
    persistUpscaleState();
    switchMode("upscale");
    return true;
  };
  btnSendMergeUpscale.addEventListener("click", () => {
    if (!mergedName) return;
    sendOutputVideoToUpscale({
      filename: mergedName,
      label: mergedPreviewLabel(),
      preview: "/h3director/merged?" + _modeQ() + "&t=" + (mergedMtime || Date.now()),
    });
  });
  let playingAssetAudio = null;
  let playingAssetAudioButton = null;
  const stopAssetAudioPreview = () => {
    if (playingAssetAudio) {
      playingAssetAudio.onended = null;
      playingAssetAudio.onerror = null;
      playingAssetAudio.pause();
      playingAssetAudio.currentTime = 0;
    }
    if (playingAssetAudioButton && playingAssetAudioButton.isConnected) {
      playingAssetAudioButton.textContent = "▶ 试听";
    }
    playingAssetAudio = null;
    playingAssetAudioButton = null;
  };
  const toggleAssetAudioPreview = async (asset, button) => {
    if (playingAssetAudio && playingAssetAudio.dataset.file === asset.file && !playingAssetAudio.paused) {
      stopAssetAudioPreview();
      return;
    }
    stopAssetAudioPreview();
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = api.apiURL("/view?filename=" + encodeURIComponent(asset.file) + "&type=input");
    audio.dataset.file = asset.file;
    playingAssetAudio = audio;
    playingAssetAudioButton = button;
    button.textContent = "⏸ 暂停";
    audio.onended = stopAssetAudioPreview;
    audio.onerror = () => {
      if (playingAssetAudio !== audio) return;
      stopAssetAudioPreview();
      status.textContent = `无法试听 ${asset.asset_id} ${asset.name}，请检查音频文件是否仍在 input 目录`;
    };
    try {
      await audio.play();
    } catch (error) {
      if (playingAssetAudio !== audio) return;
      stopAssetAudioPreview();
      status.textContent = `无法试听 ${asset.asset_id} ${asset.name}：${error.message}`;
    }
  };
  const renderSegmentVideoCompare = async (wrap, segmentNumber, minHeight = 200) => {
    const mode = curMode();
    const count = previewCount(mode);
    let info = null;
    try {
      const projectStatus = await fetchProjectStatus();
      info = projectStatus.segments && projectStatus.segments[String(segmentNumber)];
    } catch (error) { /* 状态路由不可用时保留空窗口 */ }
    if (!wrap.isConnected || curMode() !== mode || sel + 1 !== segmentNumber) return;

    const toolbar = mk("div", "h3s-pv-toolbar");
    toolbar.appendChild(mk("b", null, `段${segmentNumber} 版本对比`));
    const minus = mk("button", "h3s-btn", "−");
    minus.title = "减少一个视频对比窗口";
    minus.disabled = count <= 1;
    minus.addEventListener("click", () => { setPreviewCount(count - 1, mode); renderEditor(); });
    const countLabel = mk("span", "h3s-hint", count + " 个窗口");
    const plus = mk("button", "h3s-btn", "＋");
    plus.title = "增加一个视频对比窗口（最多 4 个）";
    plus.disabled = count >= 4;
    plus.addEventListener("click", () => { setPreviewCount(count + 1, mode); renderEditor(); });
    const refresh = mk("button", "h3s-btn", "刷新版本");
    refresh.title = "生成完成后刷新历史版本列表";
    refresh.addEventListener("click", () => { invalidateProjectStatus(); renderEditor(); });
    toolbar.append(minus, countLabel, plus, refresh,
      mk("span", "h3s-hint", "点时间线段卡里的“重抽”后旧视频不会覆盖；生成完成后点“刷新版本”即可纵向对比"));
    wrap.appendChild(toolbar);

    let versions = info && Array.isArray(info.videos) ? info.videos.slice() : [];
    if (info && info.video && !versions.some((item) => item.active)) {
      versions.push({
        version: 0,
        mtime: info.mtime || Date.now(),
        active: true,
        name: info.video_name || "",
        label: info.video_label || info.video_name || "",
      });
    }
    versions.sort((a, b) => Number(b.version || 0) - Number(a.version || 0)
      || Number(b.mtime || 0) - Number(a.mtime || 0));
    const unversionedActive = versions.findIndex((item) => item.active && Number(item.version || 0) === 0);
    if (unversionedActive > 0) versions.unshift(versions.splice(unversionedActive, 1)[0]);
    const grid = mk("div", "h3s-pv-grid");
    grid.style.setProperty("--h3-preview-count", String(count));
    for (let index = 0; index < count; index++) {
      const versionInfo = versions[index];
      const slot = mk("div", "h3s-pv-slot");
      if (!versionInfo) {
        slot.appendChild(mk("div", "h3s-pv-slot-head", `对比窗口 ${index + 1}`));
        slot.appendChild(mk("div", "h3s-pv-empty", index === 0
          ? `段${segmentNumber} 尚未生成视频` : "点击时间线段卡里的“重抽”后，新视频会保存在这个窗口中"));
        grid.appendChild(slot);
        continue;
      }
      const version = Number(versionInfo.version || 0);
      const sampleLabel = /^(?:一次采样|二次采样)\.mp4$/u.test(String(versionInfo.label || ""))
        ? ` · ${String(versionInfo.label).replace(/\.mp4$/iu, "")}` : "";
      const label = (version > 0 ? `版本 ${version}` : "当前文件") + sampleLabel;
      const deleteLabel = version > 0 ? `版本${version}` : "当前文件";
      const head = mk("div", "h3s-pv-slot-head");
      head.appendChild(mk("span", null, label + (versionInfo.active ? " · 当前" : " · 历史")));
      const query = "/h3director/video?seg=" + segmentNumber + "&" + _modeQ()
        + (version > 0 ? "&version=" + version : "") + "&t=" + (versionInfo.mtime || Date.now());
      const src = api.apiURL(query);
      const zoom = mk("button", "h3s-btn", "放大");
      zoom.title = "新窗口打开这个版本";
      let zoomWindow = null;
      zoom.addEventListener("click", () => { zoomWindow = window.open(src, "_blank"); });
      const sendUpscale = mk("button", "h3s-btn", "送去超分");
      sendUpscale.title = "把这个视频带到独立视频超分页；原文件不会被覆盖";
      sendUpscale.addEventListener("click", () => sendOutputVideoToUpscale({
        filename: versionInfo.name,
        label: versionInfo.label || versionInfo.name || `段${segmentNumber}视频`,
        preview: query,
      }));
      const renameControls = [];
      if (mode === "create" || mode === "video" || mode === "text") {
        const renameName = document.createElement("input");
        renameName.className = "h3s-video-name";
        renameName.type = "text";
        renameName.maxLength = 124;
        renameName.value = versionInfo.label || versionInfo.name || "";
        renameName.placeholder = "输入视频文件名";
        renameName.title = "修改当前项目中的本地 MP4 文件名；内部段号和版本号会自动保留";
        renameName.addEventListener("pointerdown", (event) => event.stopPropagation());
        renameName.addEventListener("click", (event) => event.stopPropagation());
        const saveName = mk("button", "h3s-btn", "保存");
        saveName.title = "保存新的本地视频文件名";
        saveName.addEventListener("click", async () => {
          const requestedName = renameName.value.trim();
          if (!requestedName) {
            status.style.color = "#ff8080";
            status.textContent = "请输入视频文件名";
            renameName.focus();
            return;
          }
          saveName.disabled = true;
          saveName.textContent = "保存中…";
          if (zoomWindow && !zoomWindow.closed) zoomWindow.close();
          video.pause();
          video.removeAttribute("src");
          video.load();
          await new Promise((resolve) => setTimeout(resolve, 0));
          try {
            const response = await api.fetchApi("/h3director/rename_segment_video", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode,
                project_id: ensureProjectId(),
                segment: segmentNumber,
                version,
                active: version === 0,
                name: requestedName,
              }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
            invalidateProjectStatus();
            renderEditor();
            status.style.color = "#8ee6a0";
            status.textContent = `段${segmentNumber}版本${result.version}已保存为 ${result.label}`;
          } catch (error) {
            video.src = src;
            video.load();
            saveName.disabled = false;
            saveName.textContent = "保存";
            status.style.color = "#ff8080";
            status.textContent = "修改视频文件名失败：" + error.message;
          }
        });
        renameName.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            saveName.click();
          }
        });
        const openFolder = mk("button", "h3s-btn", "📁");
        openFolder.title = "在 Windows 文件资源管理器中选中这个视频";
        openFolder.addEventListener("click", async () => {
          openFolder.disabled = true;
          try {
            const response = await api.fetchApi("/h3director/open_segment_video_folder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode,
                project_id: ensureProjectId(),
                segment: segmentNumber,
                version,
                active: version === 0,
              }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
            status.style.color = "";
            status.textContent = "已在文件资源管理器中定位这个视频";
          } catch (error) {
            status.style.color = "#ff8080";
            status.textContent = "打开视频文件夹失败：" + error.message;
          } finally {
            openFolder.disabled = false;
          }
        });
        renameControls.push(renameName, saveName, openFolder);
      }
      const remove = mk("button", "h3s-btn", "删除");
      remove.title = "删除这个本地视频版本和对应尾帧，不影响提示词、资产或其它版本";
      let deleteArmed = false;
      let deleteTimer = null;
      const disarmDelete = () => {
        deleteArmed = false;
        remove.textContent = "删除";
        remove.style.background = "";
        remove.style.borderColor = "";
      };
      remove.addEventListener("click", async () => {
        if (!deleteArmed) {
          deleteArmed = true;
          remove.textContent = "再点确认删除";
          remove.style.background = "#8a2f2f";
          remove.style.borderColor = "#c05555";
          clearTimeout(deleteTimer);
          deleteTimer = setTimeout(disarmDelete, 5000);
          status.style.color = "";
          status.textContent = `再次点击将删除段${segmentNumber}${deleteLabel}及对应尾帧`;
          return;
        }
        clearTimeout(deleteTimer);
        remove.disabled = true;
        remove.textContent = "正在删除…";
        if (zoomWindow && !zoomWindow.closed) zoomWindow.close();
        video.pause();
        video.removeAttribute("src");
        video.load();
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
          const response = await api.fetchApi("/h3director/delete_segment_video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode,
              project_id: ensureProjectId(),
              segment: segmentNumber,
              version,
              active: version === 0,
            }),
          });
          const result = await response.json();
          if (!response.ok || !result.ok) {
            if (result.deleted) {
              invalidateProjectStatus();
              renderEditor();
              status.style.color = "#ffb36b";
              status.textContent = result.error || "视频已删除，但当前版本状态更新失败，请刷新后检查";
              return;
            }
            throw new Error(result.error || ("HTTP " + response.status));
          }
          invalidateProjectStatus();
          renderEditor();
          status.style.color = result.warning ? "#ffb36b" : "#8ee6a0";
          status.textContent = `已删除段${segmentNumber}${deleteLabel}`
            + (result.was_active
              ? (result.active_version == null
                ? "；该段已无视频，需要重新生成"
                : `；当前版本已回退到版本${result.active_version}`)
              : "；当前版本不变")
            + (result.warning ? "；" + result.warning : "");
        } catch (error) {
          video.src = src;
          video.load();
          disarmDelete();
          remove.disabled = false;
          status.style.color = "#ff8080";
          status.textContent = "删除视频失败：" + error.message;
        }
      });
      head.append(...renameControls, zoom, sendUpscale, remove);
      slot.appendChild(head);
      const box = mk("div", "h3s-pvbox");
      box.style.minHeight = minHeight + "px";
      const video = document.createElement("video");
      video.src = src;
      video.controls = true;
      video.preload = "metadata";
      box.appendChild(video);
      slot.appendChild(box);
      grid.appendChild(slot);
    }
    wrap.appendChild(grid);
    if (versions.length > count) {
      wrap.appendChild(mk("div", "h3s-hint", `还有 ${versions.length - count} 个历史版本；点击“＋”可多显示一个窗口`));
    }
  };

  let assetMentionPopup = null;
  const closeAssetMentionPopup = () => {
    if (assetMentionPopup) assetMentionPopup.remove();
    assetMentionPopup = null;
  };
  const findAssetMention = (textarea) => {
    const caret = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
    const before = textarea.value.slice(0, caret);
    const match = before.match(/([@＠])([A-Za-z0-9_\-\u3400-\u9fff]{0,24})$/);
    if (!match) return null;
    return { start: caret - match[1].length - match[2].length, end: caret, query: match[2] };
  };
  const replaceAssetMention = (textarea, mention, replacement) => {
    textarea.value = textarea.value.slice(0, mention.start) + replacement + textarea.value.slice(mention.end);
    const caret = mention.start + replacement.length;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = caret;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const assetMentionTypeLabel = (asset) => asset && asset.kind === "audio"
    ? (asset.usage === "copy" ? "参考音频 · 配音驱动" : "参考音频 · 音色")
    : H3_ASSET_TYPES[normalizeAssetType(asset && asset.type)].label;
  const wireAssetMentionPicker = (textarea, getAssets, onSelect) => {
    let composing = false;
    let selected = 0;
    let visibleAssets = [];
    const choose = (index) => {
      const mention = findAssetMention(textarea);
      const asset = visibleAssets[index];
      if (!mention || !asset) return;
      closeAssetMentionPopup();
      onSelect(asset, mention, (replacement) => replaceAssetMention(textarea, mention, replacement));
    };
    const render = () => {
      if (composing) return;
      const mention = findAssetMention(textarea);
      if (!mention) { closeAssetMentionPopup(); return; }
      const query = mention.query.trim().toLowerCase();
      visibleAssets = (getAssets() || []).filter((asset) => {
        const typeLabel = assetMentionTypeLabel(asset);
        const haystack = [asset.asset_id, asset.name, typeLabel, ...(asset.aliases || [])]
          .join(" ").toLowerCase();
        return !query || haystack.includes(query);
      }).slice(0, 12);
      if (!visibleAssets.length) { closeAssetMentionPopup(); return; }
      selected = Math.min(selected, visibleAssets.length - 1);
      closeAssetMentionPopup();
      const popup = mk("div", "h3s-asset-mention");
      assetMentionPopup = popup;
      const rect = textarea.getBoundingClientRect();
      popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 368)) + "px";
      popup.style.top = Math.min(rect.bottom + 4, window.innerHeight - 310) + "px";
      visibleAssets.forEach((asset, index) => {
        const button = mk("button", "h3s-asset-mention-item" + (index === selected ? " active" : ""));
        button.type = "button";
        let preview;
        if (asset.kind === "audio") {
          preview = mk("span", "h3s-asset-mention-audio", "♪");
        } else {
          preview = document.createElement("img");
          preview.src = api.apiURL("/view?filename=" + encodeURIComponent(asset.file) + "&type=input");
          preview.onerror = () => { preview.style.visibility = "hidden"; };
        }
        const id = applyH3MentionColor(mk("span", "h3s-asset-mention-id", asset.asset_id || "?"), asset.asset_id);
        button.append(preview, id,
          mk("span", null, asset.name || "未命名"),
          mk("span", "h3s-asset-mention-type", assetMentionTypeLabel(asset)));
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => choose(index));
        popup.appendChild(button);
      });
      document.body.appendChild(popup);
    };
    textarea.addEventListener("compositionstart", () => { composing = true; closeAssetMentionPopup(); });
    textarea.addEventListener("compositionend", () => { composing = false; render(); });
    textarea.addEventListener("input", render);
    textarea.addEventListener("click", render);
    textarea.addEventListener("keydown", (event) => {
      if (event.isComposing || composing || !assetMentionPopup) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + visibleAssets.length) % visibleAssets.length;
        render();
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault(); event.stopPropagation(); choose(selected);
      } else if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeAssetMentionPopup();
      }
    });
    textarea.addEventListener("blur", () => setTimeout(() => {
      if (document.activeElement !== textarea) closeAssetMentionPopup();
    }, 0));
  };
  const mergedUrl = () => api.apiURL("/h3director/merged?" + _modeQ() + "&t=" + (mergedMtime || Date.now()));
  const mergedPreviewLabel = () => ({ create: "创作界面", video: "视频界面", text: "文本界面" }[curMode()] || "导演台") + " · 合并成片";
  btnViewMerge.addEventListener("click", () => openMergedVideoPreview(mergedUrl(), mergedPreviewLabel()));
  const activeMergeIndexes = () => segs
    .map((segment, index) => segment.enabled !== false ? index + 1 : null)
    .filter(Number.isInteger);
  const mergeCurrentSegments = async ({ automatic = false, completionText = "", segmentIndexes = null } = {}) => {
    const requestedIndexes = [...new Set((Array.isArray(segmentIndexes) ? segmentIndexes : activeMergeIndexes())
      .map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= segs.length))]
      .sort((a, b) => a - b);
    btnMerge.disabled = true;
    syncCreateProjectControls();
    btnMerge.textContent = "合并中…";
    setMergeState("正在检查可用视频…", "busy");
    try {
      let indexes = requestedIndexes;
      try {
        const projectStatus = await fetchProjectStatus({ force: true });
        indexes = filterAvailableMergeSegmentIndexes(requestedIndexes, projectStatus);
      } catch (error) { /* 状态接口不可用时由合并接口返回准确错误 */ }
      const skipped = requestedIndexes.filter((index) => !indexes.includes(index));
      const sequence = curMode() === "create"
        ? buildCreateTimelineMergeSequence(createSegs, createTimelineVideos, indexes)
        : null;
      if (!indexes.length && !(sequence && sequence.length)) {
        throw new Error("没有可合并的视频；请先生成当前段，或在创作时间线插入视频");
      }
      const orderText = sequence && sequence.length
        ? sequence.map((item) => item.kind === "segment" ? `段${item.segment}` : "插入视频").join("→")
        : indexes.map((index) => `段${index}`).join("→");
      setMergeState("正在合并：" + orderText, "busy");
      status.style.color = "";
      status.textContent = automatic
        ? (completionText + "，正在自动重新合并…")
        : ("正在按时间线重新合并：" + orderText + "…");
      const resp = await api.fetchApi("/h3director/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: curMode(),
          project_id: ensureProjectId(),
          segments: indexes,
          sequence,
        }),
      });
      const result = await resp.json();
      if (!resp.ok || !result.ok) throw new Error(result.error || ("HTTP " + resp.status));
      mergedMtime = result.mtime || Date.now();
      mergedName = result.name || "";
      invalidateProjectStatus();
      btnViewMerge.disabled = false;
      btnSendMergeUpscale.disabled = !mergedName;
      status.style.color = "#8ee6a0";
      const mergedOrder = Array.isArray(result.order) && result.order.length
        ? result.order.join("→") : result.segments.join("→");
      const skippedText = skipped.length ? "；已跳过未生成段" + skipped.join("、") : "";
      status.textContent = automatic
        ? (completionText + "，已自动合并：" + mergedOrder + skippedText)
        : ("合并完成：" + mergedOrder + skippedText + "（生成段使用当前最新版本）");
      setMergeState("合并完成，可查看成片", "success");
      if (!automatic) openMergedVideoPreview(mergedUrl(), mergedPreviewLabel());
      return result;
    } catch (error) {
      status.style.color = "#ff8080";
      status.textContent = automatic
        ? (completionText + "，但自动合并失败：" + error.message)
        : ("合并失败：" + error.message);
      setMergeState("合并失败：" + error.message, "error");
      return null;
    } finally {
      btnMerge.disabled = false;
      syncCreateProjectControls();
      btnMerge.textContent = "合并成片";
    }
  };
  btnMerge.addEventListener("click", async () => {
    if (busy || btnMerge.disabled) return;
    await mergeCurrentSegments();
  });
  const tabGroup = mk("div", "h3s-toolbar-group h3s-tabs");
  tabGroup.append(btnTabC, btnTabV, btnTabT, btnTabU);
  const runGroup = mk("div", "h3s-toolbar-group");
  runGroup.append(btnRun, runState, btnMerge, btnViewMerge, btnSendMergeUpscale,
    btnDeepRelease, mergeState);
  const segmentGroup = mk("div", "h3s-toolbar-group");
  segmentGroup.append(btnAdd, btnDel, allSelectionToggle, allTailToggle);
  const infoGroup = mk("div", "h3s-toolbar-group h3s-toolbar-info");
  infoGroup.append(totalLab, verLab, status);
  bar.append(tabGroup, runGroup, segmentGroup, infoGroup);
  syncTabs();
  box.appendChild(bar);

  const secondSamplePanel = mk("section", "h3s-second-sample");
  secondSamplePanel.hidden = true;
  const secondGrid = mk("div", "h3s-second-grid");
  secondAllSelectionToggle = mk("label", "h3s-second-switch");
  secondAllSelectionInput = document.createElement("input");
  secondAllSelectionInput.type = "checkbox";
  secondAllSelectionInput.setAttribute("aria-label", "启用或关闭当前页面全部段二采");
  secondAllSelectionToggle.append(secondAllSelectionInput, mk("span", null, "全部二采"));
  const secondEditInput = document.createElement("input");
  secondEditInput.type = "checkbox";
  secondEditInput.checked = secondSampleEditMode !== "separate";
  secondEditInput.title = "勾选：多段统一设置；取消：多段分别设置";
  const secondModeSelect = document.createElement("select");
  for (const item of H3_SECOND_SAMPLE_MODES) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    secondModeSelect.appendChild(option);
  }
  const secondSamplingLayoutSelect = document.createElement("select");
  for (const item of H3_SECOND_SAMPLE_LAYOUTS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    secondSamplingLayoutSelect.appendChild(option);
  }
  secondSamplingLayoutSelect.title = "分块可降低二采峰值显存；整幅一次需要更多显存，不代表一定能运行或画质一定更高";
  const secondFirstMegapixelsInput = document.createElement("input");
  secondFirstMegapixelsInput.type = "number"; secondFirstMegapixelsInput.min = "0.1";
  secondFirstMegapixelsInput.max = "4"; secondFirstMegapixelsInput.step = "0.05";
  secondFirstMegapixelsInput.title = "一采按目标画幅换算并对齐到32；0.4MP约等于864×480";
  const secondSizeModeSelect = document.createElement("select");
  for (const item of H3_SECOND_SAMPLE_SIZE_MODES) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    secondSizeModeSelect.appendChild(option);
  }
  const secondTargetMegapixelsInput = document.createElement("input");
  secondTargetMegapixelsInput.type = "number"; secondTargetMegapixelsInput.min = "0.1";
  secondTargetMegapixelsInput.step = "0.05";
  secondTargetMegapixelsInput.setAttribute("aria-label", "二采像素目标（MP）");
  secondTargetMegapixelsInput.title = "直接输入二采最终像素目标；编辑后自动切换为按百万像素，宽高按当前段画幅对齐到32";
  const secondTargetWidthInput = document.createElement("input");
  secondTargetWidthInput.type = "number"; secondTargetWidthInput.min = "256";
  secondTargetWidthInput.step = "32";
  secondTargetWidthInput.setAttribute("aria-label", "二采最终宽度");
  secondTargetWidthInput.title = "直接输入最终宽度；编辑后自动切换为手动分辨率，保存时对齐到32";
  const secondTargetHeightInput = document.createElement("input");
  secondTargetHeightInput.type = "number"; secondTargetHeightInput.min = "256";
  secondTargetHeightInput.step = "32";
  secondTargetHeightInput.setAttribute("aria-label", "二采最终高度");
  secondTargetHeightInput.title = "直接输入最终高度；编辑后自动切换为手动分辨率，保存时对齐到32";
  const secondStepsInput = document.createElement("input");
  secondStepsInput.type = "number"; secondStepsInput.min = "1"; secondStepsInput.max = "30";
  secondStepsInput.step = "1";
  const secondDenoiseInput = document.createElement("input");
  secondDenoiseInput.type = "number"; secondDenoiseInput.min = "0.01";
  secondDenoiseInput.max = "0.95"; secondDenoiseInput.step = "0.01";
  const secondComparisonInput = document.createElement("input");
  secondComparisonInput.type = "checkbox";
  secondComparisonInput.title = "同一次任务保存一次采样历史版和二次采样当前版，便于直接对比";
  const secondRepairPrompt = document.createElement("textarea");
  secondRepairPrompt.rows = 3;
  secondRepairPrompt.maxLength = 4000;
  secondRepairPrompt.placeholder = H3_SECOND_SAMPLE_DEFAULT_REPAIR_PROMPT;
  const secondResolution = mk("div", "h3s-second-resolution", "最终输出：尺寸待确认");
  const secondField = (label, control, className = "", note = "") => {
    const field = mk("div", "h3s-second-field" + (className ? " " + className : ""));
    field.append(mk("label", null, label), control);
    if (note) field.appendChild(mk("span", "h3s-second-field-note", note));
    return field;
  };
  const secondSwitch = (label, control) => {
    const field = mk("label", "h3s-second-switch");
    field.append(control, mk("span", null, label));
    return field;
  };
  const secondEditField = secondSwitch("多段统一设置", secondEditInput);
  const secondSwitches = mk("div", "h3s-second-switches");
  secondSwitches.append(
    secondAllSelectionToggle,
    secondEditField,
    secondSwitch("保存一采/二采对比", secondComparisonInput),
  );
  secondGrid.append(
    secondSwitches,
    secondField("输出尺寸设置", secondSizeModeSelect, "wide"),
    secondField("一采目标（MP）", secondFirstMegapixelsInput),
    secondField("二采目标（MP）", secondTargetMegapixelsInput),
    secondResolution,
    secondField("最终宽度", secondTargetWidthInput),
    secondField("最终高度", secondTargetHeightInput),
    secondField("修复模式", secondModeSelect, "wide"),
    secondField("二采采样方式", secondSamplingLayoutSelect, "wide",
      "分块是同一次二采内的空间切分；整幅一次需要更多显存"),
    secondField("二采步数", secondStepsInput),
    secondField("降噪强度", secondDenoiseInput),
    secondField("修复要求", secondRepairPrompt, "full"),
  );
  const secondRows = mk("div", "h3s-second-segments");
  const secondSetup = mk("details", "h3s-second-setup");
  const secondSetupEnvironmentSelect = document.createElement("select");
  for (const item of H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    secondSetupEnvironmentSelect.appendChild(option);
  }
  secondSetupEnvironmentSelect.value = secondSampleSetupSelection.environment_source;
  secondSetupEnvironmentSelect.setAttribute("aria-label", "二采环境来源");
  const secondSetupWeightSourceSelect = document.createElement("select");
  for (const item of H3_SECOND_SAMPLE_WEIGHT_SOURCES) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    secondSetupWeightSourceSelect.appendChild(option);
  }
  secondSetupWeightSourceSelect.value = secondSampleSetupSelection.weight_source;
  secondSetupWeightSourceSelect.setAttribute("aria-label", "权重下载线路");
  const secondSetupWeightSelect = document.createElement("select");
  secondSetupWeightSelect.setAttribute("aria-label", "3D权重");
  secondSetupWeightSelect.disabled = true;
  const secondSetupWeightPlaceholder = document.createElement("option");
  secondSetupWeightPlaceholder.value = "";
  secondSetupWeightPlaceholder.textContent = "后端未返回可核验3D权重";
  secondSetupWeightSelect.appendChild(secondSetupWeightPlaceholder);
  const secondSetupEnvironmentState = mk("span", "h3s-second-setup-stage", "环境来源：正在读取可用性……");
  const secondSetupWeightState = mk("span", "h3s-second-setup-stage", "权重来源：正在读取真实 catalog……");
  const secondSetupLocalNote = mk("div", "h3s-second-local-note",
    "环境包只包含二采节点、兼容3D节点和离线Python依赖，不包含3D权重；权重由导演台按下方所选在线线路另行下载并校验。");
  secondSetupLocalNote.hidden = secondSampleSetupSelection.environment_source !== "local";
  let secondSampleLocalPackage = null;
  const secondSetupLocalPicker = mk("div", "h3s-second-local-picker");
  secondSetupLocalPicker.hidden = secondSampleSetupSelection.environment_source !== "local";
  const secondSetupLocalZipInput = document.createElement("input");
  secondSetupLocalZipInput.type = "file";
  secondSetupLocalZipInput.accept = ".zip,application/zip";
  secondSetupLocalZipInput.setAttribute("aria-label", "选择环境包 ZIP");
  const secondSetupLocalZipButton = mk("button", "h3s-btn", "选择环境包 ZIP");
  secondSetupLocalZipButton.type = "button";
  const secondSetupLocalState = mk(
    "span", "h3s-second-local-picker-state", "尚未选择环境包 ZIP");
  secondSetupLocalPicker.append(
    secondSetupLocalZipInput, secondSetupLocalZipButton, secondSetupLocalState);
  const secondSetupGrid = mk("div", "h3s-second-setup-grid");
  const secondSetupWeightSourceLabel = mk("label", null, "权重下载线路");
  const secondSetupWeightLabel = mk("label", null, "3D权重");
  const secondSetupWeightNote = mk(
    "span", "h3s-second-setup-stage",
    "只展示后端返回且具有固定来源、版本、许可证、大小和SHA-256合同的权重。");
  secondSetupGrid.append(
    mk("label", null, "二采环境来源"), secondSetupEnvironmentSelect, secondSetupEnvironmentState,
    secondSetupWeightSourceLabel, secondSetupWeightSourceSelect, secondSetupWeightState,
    secondSetupWeightLabel, secondSetupWeightSelect, secondSetupWeightNote,
  );
  const secondActions = mk("div", "h3s-second-actions");
  const secondSave = mk("button", "h3s-btn primary", "保存二采设置");
  const secondSetupButton = mk("button", "h3s-btn primary", "开始一键配齐");
  secondSetupButton.title = "本地环境包只安装节点和缺失依赖；3D权重按明确选择的在线线路下载；不下载H3主模型、不自动重启";
  const secondSetupSummary = mk("summary");
  const secondSetupSummaryState = mk("span", "h3s-second-setup-summary-state", "正在检查环境…");
  secondSetupSummary.append(mk("span", null, "环境与3D权重"), secondSetupSummaryState);
  const secondSetupBody = mk("div", "h3s-second-setup-body");
  const secondSetupActions = mk("div", "h3s-second-setup-actions");
  secondSetupActions.append(secondSetupButton,
    mk("span", "h3s-hint", "只按当前明确选择配齐；不下载H3主模型、不自动重启。"));
  secondSetupBody.append(secondSetupGrid, secondSetupLocalNote, secondSetupLocalPicker, secondSetupActions);
  secondSetup.append(secondSetupSummary, secondSetupBody);
  const secondProgress = mk("div", "h3s-second-progress");
  secondProgress.appendChild(mk("div"));
  const secondState = mk("div", "h3s-second-state", "正在检查环境状态……");
  secondActions.append(secondSave,
    mk("span", "h3s-second-save-hint", "保存后作为后续新段默认"), secondState, secondProgress);
  secondSamplePanel.append(
    secondGrid,
    secondRows,
    secondSetup,
    secondActions,
    mk("div", "h3s-hint",
      "一采按像素目标生成动作与构图，latent升到二采实际宽高后再用独立修复条件二采。按MP时每段继承自己的横竖画幅；修复不是MP4插值超分。"),
  );
  const applySecondSampleRuntimeStage = (payload) => {
    const view = h3SecondSampleRuntimePresentation(payload);
    if (!view) return null;
    secondSampleRuntimeLastStage = view.stage;
    secondProgress.classList.remove("busy");
    secondProgress.classList.add("runtime");
    if (secondProgress.firstElementChild) {
      secondProgress.firstElementChild.style.width = `${view.progress}%`;
    }
    secondState.classList.toggle("error", view.tone === "error");
    secondState.textContent = view.message;
    setRunState(view.message, view.tone);
    return view;
  };
  const beginSecondSampleRuntime = (indexes) => {
    secondSampleRuntimeActive = true;
    secondSampleRuntimePromptId = "";
    secondSampleRuntimeMode = curMode();
    secondSampleRuntimeProjectId = ensureProjectId();
    secondSampleRuntimeSegments = new Set(indexes.map((index) => index + 1));
    secondSampleRuntimeLastStage = null;
    secondSampleRuntimeEarlyEvents.clear();
    secondProgress.classList.remove("busy");
    secondProgress.classList.add("runtime");
    if (secondProgress.firstElementChild) secondProgress.firstElementChild.style.width = "0%";
    secondState.classList.remove("error");
    secondState.textContent = "等待二采阶段状态…";
  };
  const bindSecondSampleRuntimePrompt = (queued) => {
    secondSampleRuntimePromptId = String(queued && queued.prompt_id || "");
    const early = secondSampleRuntimeEarlyEvents.get(secondSampleRuntimePromptId) || [];
    secondSampleRuntimeEarlyEvents.clear();
    for (const stage of early) applySecondSampleRuntimeStage(stage);
    return secondSampleRuntimePromptId;
  };
  const finishSecondSampleRuntime = () => {
    secondSampleRuntimeActive = false;
    secondSampleRuntimePromptId = "";
    secondSampleRuntimeMode = "";
    secondSampleRuntimeProjectId = "";
    secondSampleRuntimeSegments.clear();
    secondSampleRuntimeEarlyEvents.clear();
  };
  const readSecondSampleRuntimeDiagnostics = async (indexes, promptId) => {
    try {
      const query = new URLSearchParams({
        mode: secondSampleRuntimeMode,
        project_id: secondSampleRuntimeProjectId,
      }).toString();
      const response = await api.fetchApi("/h3director/status?" + query);
      const projectStatus = await response.json();
      if (!response.ok) return null;
      const candidates = [];
      for (const index of indexes) {
        const segment = projectStatus && projectStatus.segments
          && projectStatus.segments[String(index + 1)];
        const diagnostics = segment && segment.second_sample_diagnostics;
        const stage = normalizeH3SecondSampleRuntimeStage(
          diagnostics && diagnostics.terminal_event);
        if (!stage || stage.prompt_id !== promptId || stage.display_node !== String(node.id)
            || stage.project_id !== secondSampleRuntimeProjectId
            || stage.segment_index !== index + 1) continue;
        candidates.push(stage);
      }
      return candidates.find((stage) => stage.failure) || candidates.at(-1) || null;
    } catch (error) {
      return null;
    }
  };

  const persistSecondSetupSelection = () => {
    node.properties.h3_second_sample_setup_selection = { ...secondSampleSetupSelection };
    secondSetupLocalNote.hidden = secondSampleSetupSelection.environment_source !== "local";
    secondSetupLocalPicker.hidden = secondSampleSetupSelection.environment_source !== "local";
    save();
  };
  const secondSetupStageText = (label, entry, stageId) => {
    if (!entry) return `${label}不可用：缺少来源证据`;
    const stage = secondSampleSetupStatus.setup_stages[stageId];
    if (stage?.status === "failed") {
      return `${label}失败：${stage.error || "请重试"}`;
    }
    if (stage?.status === "running") {
      const progress = secondSampleStatusCache.progress || {};
      return `${label}：正在处理 ${Number(progress.current) || 0}/${Number(progress.total) || 0}`
        + (progress.item ? `：${progress.item}` : "");
    }
    if (stage?.status === "completed") return `${label}已完成`;
    if (entry.available && entry.requires_package) {
      return `${label}可选择：${entry.reason || "请选择本地环境包"}`;
    }
    return entry.available ? `${label}可用` : `${label}不可用：${entry.reason}`;
  };
  const syncSecondSetupSelection = () => {
    const environmentView = h3SecondSampleAvailableEnvironmentSelection(
      secondSampleSetupStatus, secondSampleSetupSelection.environment_source);
    secondSetupEnvironmentSelect.replaceChildren();
    if (environmentView.sources.length) {
      if (environmentView.environment_source !== secondSampleSetupSelection.environment_source) {
        secondSampleSetupSelection = normalizeH3SecondSampleSetupSelection({
          ...secondSampleSetupSelection,
          environment_source: environmentView.environment_source,
        });
        persistSecondSetupSelection();
      }
      for (const entry of environmentView.sources) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.label;
        secondSetupEnvironmentSelect.appendChild(option);
      }
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "正在读取可用环境来源";
      option.disabled = true;
      secondSetupEnvironmentSelect.appendChild(option);
    }
    for (const option of secondSetupWeightSourceSelect.options) {
      const entry = secondSampleSetupStatus.weight_sources.find((item) => item.id === option.value);
      option.textContent = H3_SECOND_SAMPLE_WEIGHT_SOURCES.find(
        (item) => item.id === option.value)?.label || option.value;
      if (!entry?.available) option.textContent += "（不可用）";
    }
    secondSetupEnvironmentSelect.value = secondSampleSetupSelection.environment_source;
    secondSetupWeightSourceSelect.value = secondSampleSetupSelection.weight_source;
    const localSelected = secondSampleSetupSelection.environment_source === "local";
    secondSetupLocalNote.hidden = !localSelected;
    secondSetupLocalPicker.hidden = !localSelected;
    const environmentEntry = secondSampleSetupStatus.environment_sources.find(
      (item) => item.id === secondSampleSetupSelection.environment_source);
    const weightSourceEntry = secondSampleSetupStatus.weight_sources.find(
      (item) => item.id === secondSampleSetupSelection.weight_source);
    const environmentStage = secondSampleSetupStatus.setup_stages.environment;
    const weightStage = secondSampleSetupStatus.setup_stages.weight;
    secondSetupEnvironmentState.textContent = secondSetupStageText(
      "环境来源", environmentEntry, "environment");
    secondSetupEnvironmentState.classList.toggle("error", !environmentEntry?.available
      || environmentStage.status === "failed");
    secondSetupWeightSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择明确的3D权重";
    secondSetupWeightSelect.appendChild(placeholder);
    for (const filename of secondSampleSetupStatus.installed) {
      const catalogWeight = secondSampleSetupStatus.weights.find(
        (weight) => weight.filename === filename);
      const option = document.createElement("option");
      option.value = `installed:${filename}`;
      option.textContent = `已安装本地权重：${filename}`;
      option.dataset.kind = "installed";
      option.dataset.model = filename;
      option.dataset.weightId = catalogWeight?.id || "";
      secondSetupWeightSelect.appendChild(option);
    }
    for (const weight of secondSampleSetupStatus.weights) {
      const source = weight.sources.find(
        (entry) => entry.id === secondSampleSetupSelection.weight_source && entry.available);
      if (!source) continue;
      const option = document.createElement("option");
      option.value = `catalog:${weight.id}`;
      option.textContent = `${weight.name} · ${weight.precision} · ${(weight.size / 1048576).toFixed(1)} MiB`;
      option.title = `许可证：${weight.license}\nSHA-256：${weight.sha256}`;
      option.dataset.kind = "catalog";
      option.dataset.weightId = weight.id;
      option.dataset.model = weight.filename;
      secondSetupWeightSelect.appendChild(option);
    }
    const installedModelSelected = secondSampleSetupStatus.installed.includes(
      secondSampleSelectedUpscalerModel);
    const desiredValue = installedModelSelected
      ? `installed:${secondSampleSelectedUpscalerModel}`
      : secondSampleSetupSelection.weight_id
        ? `catalog:${secondSampleSetupSelection.weight_id}` : "";
    if ([...secondSetupWeightSelect.options].some((option) => option.value === desiredValue)) {
      secondSetupWeightSelect.value = desiredValue;
    }
    const selected = secondSetupWeightSelect.options[secondSetupWeightSelect.selectedIndex];
    const installedSelected = selected?.dataset.kind === "installed" && !!selected.dataset.weightId;
    const catalogSelected = selected?.dataset.kind === "catalog";
    if (installedSelected) {
      secondSetupWeightState.classList.remove("error");
      secondSetupWeightState.textContent = `已安装本地权重：${selected.dataset.model}；本次只需安装所选环境包。`;
    } else if (!secondSampleSetupStatus.weights.length) {
      secondSetupWeightState.classList.add("error");
      secondSetupWeightState.textContent = secondSampleSetupStatus.installed.length
        ? "尚无已核验权重来源；已发现本地权重，请明确选择后再继续。"
        : "尚无已核验权重来源；国内和官方在线权重均不可用。";
    } else {
      const selectedWeight = catalogSelected ? secondSampleSetupStatus.weights.find(
        (weight) => weight.id === selected.dataset.weightId) : null;
      secondSetupWeightState.textContent = selectedWeight
        ? `已核验权重：${selectedWeight.name} · ${selectedWeight.precision}`
          + ` · ${(selectedWeight.size / 1048576).toFixed(1)} MiB · ${selectedWeight.license}`
          + ` · SHA-256 ${selectedWeight.sha256.slice(0, 12)}…；${secondSetupStageText("权重来源", weightSourceEntry, "weight")}`
        : "请选择一个后端返回的已核验权重。";
      secondSetupWeightState.classList.toggle("error", !catalogSelected
        || !weightSourceEntry?.available || weightStage.status === "failed");
    }
    secondSetupWeightSelect.disabled = secondSampleModelBusy
      || secondSetupWeightSelect.options.length <= 1;
    const localContractReady = !!secondSampleSetupStatus.local_package_contract;
    const localPackageReady = !localSelected || !!secondSampleLocalPackage && localContractReady;
    if (localSelected && !localContractReady) {
      secondSetupLocalState.textContent = "当前后端没有可核验的本地环境包合同，请更新并重启导演台。";
      secondSetupLocalState.classList.add("error");
    } else if (localSelected && !secondSampleLocalPackage) {
      secondSetupLocalState.textContent = "尚未选择环境包 ZIP。";
      secondSetupLocalState.classList.add("error");
    }
    return {
      can_setup: !!environmentEntry?.available && localPackageReady
        && (installedSelected || catalogSelected && !!weightSourceEntry?.available),
      environment_available: !!environmentEntry?.available,
      installed_selected: installedSelected,
      catalog_selected: catalogSelected,
      local_package_selected: localSelected && !!secondSampleLocalPackage,
    };
  };
  const syncSecondSetupAvailability = () => {
    const availability = syncSecondSetupSelection();
    const view = h3SecondSampleSetupPresentation(secondSampleStatusCache);
    const localSelected = secondSampleSetupSelection.environment_source === "local";
    secondSetupButton.textContent = localSelected
      ? availability.local_package_selected ? "安装环境并配齐权重" : "请先选择环境包 ZIP"
      : availability.installed_selected
      ? secondSampleStatusCache?.ready === true ? "环境已配齐" : "本地权重无需下载"
      : availability.local_package_selected ? "从本地包配齐" : view.button_text;
    secondSetupButton.disabled = secondSampleModelBusy
      || !localSelected && availability.installed_selected
      || !localSelected && view.button_disabled
      || view.busy || !availability.can_setup;
    secondSetupSummaryState.textContent = view.busy ? "正在配齐…"
      : view.state === "ready" ? "环境与权重已配齐"
        : !availability.environment_available ? "环境不可用"
          : localSelected ? availability.local_package_selected
            ? availability.catalog_selected || availability.installed_selected
              ? "环境包已选择 · 权重已选择" : "环境包已选择 · 尚未选择权重"
            : "请选择环境包 ZIP"
          : availability.installed_selected ? "环境可用 · 已选本地权重"
            : availability.catalog_selected ? "环境可用 · 已选权重"
              : "环境可用 · 尚未选择权重";
    secondSetupSummaryState.classList.toggle("error",
      view.state === "failed" || !availability.environment_available);
    return availability;
  };
  secondSetupEnvironmentSelect.addEventListener("change", () => {
    secondSampleSetupSelection = normalizeH3SecondSampleSetupSelection({
      ...secondSampleSetupSelection, environment_source: secondSetupEnvironmentSelect.value,
    });
    persistSecondSetupSelection();
    syncSecondSetupAvailability();
  });
  secondSetupLocalZipButton.addEventListener("click", () => secondSetupLocalZipInput.click());
  secondSetupLocalZipInput.addEventListener("change", () => {
    const file = secondSetupLocalZipInput.files?.[0];
    secondSampleLocalPackage = file ? { file, label: file.name } : null;
    secondSetupLocalState.textContent = file
      ? `已选择环境包：${file.name}；开始后会校验固定 manifest、大小和 SHA-256。`
      : "尚未选择环境包 ZIP";
    secondSetupLocalState.classList.toggle("error", !file);
    syncSecondSetupAvailability();
  });
  secondSetupWeightSourceSelect.addEventListener("change", () => {
    const catalogSelection = !!secondSampleSetupSelection.weight_id;
    if (catalogSelection) secondSampleSelectedUpscalerModel = "";
    secondSampleSetupSelection = normalizeH3SecondSampleSetupSelection({
      ...secondSampleSetupSelection, weight_source: secondSetupWeightSourceSelect.value,
      weight_id: "",
    });
    persistSecondSetupSelection();
    syncSecondSetupAvailability();
  });
  secondSetupWeightSelect.addEventListener("change", () => {
    const option = secondSetupWeightSelect.options[secondSetupWeightSelect.selectedIndex];
    secondSampleSelectedUpscalerModel = option?.dataset.model || "";
    secondSampleSetupSelection = normalizeH3SecondSampleSetupSelection({
      ...secondSampleSetupSelection,
      weight_id: option?.dataset.weightId || "",
    });
    persistSecondSetupSelection();
    syncSecondSetupAvailability();
  });
  syncSecondSetupAvailability();
  const selectedSecondSetupModel = () => {
    const option = secondSetupWeightSelect.options[secondSetupWeightSelect.selectedIndex];
    return h3SecondSampleUpscalerModelName(option?.dataset.model);
  };

  const secondTargets = () => h3SecondSampleTargets(segs, sel, secondSampleScope);
  const normalizeSecondTargetDimension = (value, fallback) => {
    const number = Number(value);
    const resolved = Number.isFinite(number) ? number : Number(fallback);
    return Math.max(256, Math.round(resolved / 32) * 32);
  };
  const secondDimensionValue = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : Number(fallback);
  };
  const secondSourceDimensions = (index) => {
    const segment = segs[index] || {};
    const widthWidget = node.widgets.find((widget) => widget.name === "width");
    const heightWidget = node.widgets.find((widget) => widget.name === "height");
    const segmentOverride = Number(segment.width) >= 256 && Number(segment.height) >= 256;
    const linked = segmentOverride ? null : resolveLinkedAspectPreview(node, node.graph || app.graph);
    return {
      width: segmentOverride ? Number(segment.width)
        : Number(linked && linked.width) || Number(widthWidget?.value) || 832,
      height: segmentOverride ? Number(segment.height)
        : Number(linked && linked.height) || Number(heightWidget?.value) || 480,
      linked: !!(linked && linked.linked),
      aspect_known: !linked || !linked.linked || !!(linked.width && linked.height),
    };
  };
  const secondSizeFields = (sizeMode, targetMegapixels, width, height) => sizeMode === "dimensions"
    ? {
        target_size_mode: "dimensions",
        final_width: secondDimensionValue(width, 832),
        final_height: secondDimensionValue(height, 480),
      }
    : {
        target_size_mode: "megapixels",
        target_megapixels: Number(targetMegapixels) > 0
          ? Number(targetMegapixels) : H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS,
      };
  const setSecondSizeInputAccess = (sizeMode, enabled, megapixels, width, height) => {
    const access = h3SecondSampleSizeInputState(sizeMode, enabled);
    for (const input of [megapixels, width, height]) input.disabled = access.disabled;
    megapixels.readOnly = access.megapixels_read_only;
    width.readOnly = access.dimensions_read_only;
    height.readOnly = access.dimensions_read_only;
    megapixels.setAttribute("aria-readonly", String(megapixels.readOnly));
    width.setAttribute("aria-readonly", String(width.readOnly));
    height.setAttribute("aria-readonly", String(height.readOnly));
  };
  const secondConfigFromInputs = (overrides = {}) => normalizeH3SecondSample({
    strategy: "latent_repair", preset_version: 4,
    upscaler_model: selectedSecondSetupModel(),
    mode: overrides.mode ?? secondModeSelect.value,
    first_megapixels: overrides.firstMegapixels ?? secondFirstMegapixelsInput.value,
    steps: overrides.steps ?? secondStepsInput.value,
    denoise: overrides.denoise ?? secondDenoiseInput.value,
    repair_prompt: overrides.repairPrompt ?? secondRepairPrompt.value,
    sampling_layout: overrides.samplingLayout ?? secondSamplingLayoutSelect.value,
    freeze_audio: true,
    save_comparison: overrides.comparison ?? secondComparisonInput.checked,
    ...secondSizeFields(
      overrides.sizeMode ?? secondSizeModeSelect.value,
      overrides.targetMegapixels ?? secondTargetMegapixelsInput.value,
      overrides.width ?? secondTargetWidthInput.value,
      overrides.height ?? secondTargetHeightInput.value),
  });
  const secondDisplayConfig = (raw) => {
    const config = normalizeH3SecondSample(raw);
    return config.mode === "off" ? normalizeH3SecondSample({ mode: "standard" }) : config;
  };
  const secondSizeStatus = (index, config) => {
    const source = secondSourceDimensions(index);
    return { ...h3SecondSampleSizeStatus(config, source.width, source.height), source };
  };
  const secondResolutionText = (index, config) => {
    const status = secondSizeStatus(index, config);
    if (!status.final || !status.first) return "最终输出：尺寸待确认";
    const sourceText = config.target_size_mode === "megapixels" && status.source.linked
      ? (status.source.aspect_known ? " · 继承上游画幅" : " · 上游画幅未知，运行时复核") : "";
    return `最终输出 ${status.final.width} × ${status.final.height} · ${status.final.megapixels.toFixed(3)} MP`
      + `；首采 ${status.first.width}×${status.first.height}（${status.first.megapixels.toFixed(3)}MP）`
      + sourceText + (status.error ? `；${status.error}` : status.warning ? `；${status.warning}` : "");
  };
  const secondTargetValidationError = (index, config) => {
    const modelError = h3SecondSampleUpscalerModelError(config);
    if (modelError) return `段${index + 1}：${modelError}`;
    const status = secondSizeStatus(index, config);
    return status.error ? `段${index + 1}：${status.error}` : "";
  };
  const setSecondSizeInputs = (config, index, preserve = false) => {
    if (!preserve) {
      secondSizeModeSelect.value = config.target_size_mode;
      if (config.target_size_mode === "megapixels") {
        secondTargetMegapixelsInput.value = String(config.target_megapixels);
      } else {
        secondTargetWidthInput.value = String(config.final_width);
        secondTargetHeightInput.value = String(config.final_height);
      }
    }
    const liveConfig = preserve ? secondConfigFromInputs() : config;
    const source = secondSourceDimensions(index);
    const final = h3SecondSampleFinalSize(liveConfig, source.width, source.height);
    if (liveConfig.target_size_mode === "megapixels") {
      secondTargetWidthInput.value = String(final.width);
      secondTargetHeightInput.value = String(final.height);
    } else {
      secondTargetMegapixelsInput.value = String(final.megapixels.toFixed(3));
    }
    setSecondSizeInputAccess(liveConfig.target_size_mode, liveConfig.mode !== "off",
      secondTargetMegapixelsInput, secondTargetWidthInput, secondTargetHeightInput);
    secondSizeModeSelect.disabled = liveConfig.mode === "off";
  };
  const setSecondUniformInputs = (raw, preserveSizeInputs = false) => {
    const config = normalizeH3SecondSample(raw);
    secondModeSelect.value = config.mode;
    const display = secondDisplayConfig(config);
    secondFirstMegapixelsInput.value = String(display.first_megapixels || 0.4);
    secondStepsInput.value = String(display.steps || 7);
    secondDenoiseInput.value = String(display.denoise || 0.22);
    secondRepairPrompt.value = display.repair_prompt || H3_SECOND_SAMPLE_DEFAULT_REPAIR_PROMPT;
    secondSamplingLayoutSelect.value = display.sampling_layout;
    secondComparisonInput.checked = display.save_comparison === true;
    const index = secondTargets()[0] ?? sel;
    setSecondSizeInputs(display, index, preserveSizeInputs);
    const custom = config.mode === "custom";
    secondStepsInput.disabled = !custom;
    secondDenoiseInput.disabled = !custom;
    const disabled = config.mode === "off";
    secondFirstMegapixelsInput.disabled = disabled;
    secondSizeModeSelect.disabled = disabled;
    setSecondSizeInputAccess(display.target_size_mode, !disabled,
      secondTargetMegapixelsInput, secondTargetWidthInput, secondTargetHeightInput);
    secondRepairPrompt.disabled = disabled;
    secondSamplingLayoutSelect.disabled = disabled;
    secondComparisonInput.disabled = disabled;
    secondResolution.textContent = secondResolutionText(index, display);
  };
  const createSecondRow = (index) => {
    const config = normalizeH3SecondSample(
      segs[index] && segs[index].second_sample, segs[index]);
    const initial = secondDisplayConfig(config);
    const row = mk("div", "h3s-second-row");
    row.dataset.index = String(index);
    row.appendChild(mk("b", null, `段${index + 1}`));
    const modeControl = mk("div", "h3s-second-mode");
    const mode = document.createElement("select");
    for (const item of H3_SECOND_SAMPLE_MODES) {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.label; mode.appendChild(option);
    }
    mode.value = config.mode;
    const samplingLayout = document.createElement("select");
    for (const item of H3_SECOND_SAMPLE_LAYOUTS) {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.label; samplingLayout.appendChild(option);
    }
    samplingLayout.value = initial.sampling_layout;
    samplingLayout.title = "分块可降低二采峰值显存；整幅一次需要更多显存";
    modeControl.append(mode, samplingLayout);
    const firstMegapixels = document.createElement("input");
    firstMegapixels.type = "number"; firstMegapixels.min = "0.1";
    firstMegapixels.max = "4"; firstMegapixels.step = "0.05";
    firstMegapixels.value = String(initial.first_megapixels || 0.4);
    const sizeControl = mk("div", "h3s-second-size");
    const sizeMode = document.createElement("select");
    for (const item of H3_SECOND_SAMPLE_SIZE_MODES) {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = item.label; sizeMode.appendChild(option);
    }
    sizeMode.value = initial.target_size_mode;
    const targetMegapixels = document.createElement("input");
    targetMegapixels.type = "number"; targetMegapixels.min = "0.1";
    targetMegapixels.step = "0.05"; targetMegapixels.className = "h3s-second-mp";
    targetMegapixels.setAttribute("aria-label", `段${index + 1}二采像素目标（MP）`);
    targetMegapixels.title = "直接输入该段二采像素目标；编辑后自动切换为按百万像素";
    const finalWidth = document.createElement("input");
    finalWidth.type = "number"; finalWidth.min = "256"; finalWidth.step = "32";
    finalWidth.setAttribute("aria-label", `段${index + 1}二采最终宽度`);
    finalWidth.title = "直接输入该段二采最终宽度；编辑后自动切换为手动分辨率";
    const finalHeight = document.createElement("input");
    finalHeight.type = "number"; finalHeight.min = "256"; finalHeight.step = "32";
    finalHeight.setAttribute("aria-label", `段${index + 1}二采最终高度`);
    finalHeight.title = "直接输入该段二采最终高度；编辑后自动切换为手动分辨率";
    targetMegapixels.value = String(initial.target_megapixels
      || H3_SECOND_SAMPLE_DEFAULT_TARGET_MEGAPIXELS);
    finalWidth.value = String(initial.final_width || 832);
    finalHeight.value = String(initial.final_height || 480);
    sizeControl.append(sizeMode, targetMegapixels, finalWidth, finalHeight);
    const stepsInput = document.createElement("input");
    stepsInput.type = "number"; stepsInput.min = "1"; stepsInput.max = "30"; stepsInput.step = "1";
    stepsInput.value = String(initial.steps || 7);
    const denoise = document.createElement("input");
    denoise.type = "number"; denoise.min = "0.01"; denoise.max = "0.95"; denoise.step = "0.01";
    denoise.value = String(initial.denoise || 0.22);
    const comparison = document.createElement("input");
    comparison.type = "checkbox";
    comparison.checked = initial.save_comparison === true;
    comparison.title = "保存一次采样历史版";
    const resolution = mk("span", "h3s-hint");
    const currentConfig = () => normalizeH3SecondSample({
      strategy: "latent_repair", preset_version: 4,
      upscaler_model: selectedSecondSetupModel(),
      mode: mode.value,
      first_megapixels: firstMegapixels.value,
      steps: stepsInput.value, denoise: denoise.value,
      repair_prompt: secondRepairPrompt.value,
      sampling_layout: samplingLayout.value,
      freeze_audio: true,
      save_comparison: comparison.checked,
      ...secondSizeFields(
        sizeMode.value, targetMegapixels.value, finalWidth.value, finalHeight.value),
    });
    const sync = () => {
      const value = currentConfig();
      const display = secondDisplayConfig(value);
      firstMegapixels.value = String(display.first_megapixels || 0.4);
      stepsInput.value = String(display.steps || 7);
      denoise.value = String(display.denoise || 0.22);
      const final = h3SecondSampleFinalSize(
        display, secondSourceDimensions(index).width, secondSourceDimensions(index).height);
      const byMegapixels = display.target_size_mode === "megapixels";
      if (byMegapixels) {
        targetMegapixels.value = String(display.target_megapixels);
        finalWidth.value = String(final.width);
        finalHeight.value = String(final.height);
      } else {
        targetMegapixels.value = String(final.megapixels.toFixed(3));
        finalWidth.value = String(display.final_width);
        finalHeight.value = String(display.final_height);
      }
      const custom = value.mode === "custom";
      stepsInput.disabled = !custom; denoise.disabled = !custom;
      const disabled = value.mode === "off";
      firstMegapixels.disabled = disabled;
      samplingLayout.disabled = disabled;
      sizeMode.disabled = disabled;
      setSecondSizeInputAccess(display.target_size_mode, !disabled,
        targetMegapixels, finalWidth, finalHeight);
      comparison.disabled = disabled;
      resolution.textContent = secondResolutionText(index, display);
    };
    mode.addEventListener("change", sync);
    samplingLayout.addEventListener("change", sync);
    firstMegapixels.addEventListener("change", sync);
    const switchSizeMode = (nextMode = sizeMode.value) => {
      const transition = h3SecondSampleSizeModeTransition(
        nextMode, finalWidth.value, finalHeight.value, targetMegapixels.value);
      sizeMode.value = transition.target_size_mode;
      if (transition.target_size_mode === "megapixels") {
        targetMegapixels.value = String(transition.target_megapixels);
      } else {
        finalWidth.value = String(transition.final_width);
        finalHeight.value = String(transition.final_height);
      }
      sync();
    };
    sizeMode.addEventListener("change", () => switchSizeMode());
    const activateMegapixelsMode = () => {
      if (mode.value === "off" || sizeMode.value === "megapixels") return;
      switchSizeMode("megapixels");
    };
    targetMegapixels.addEventListener("pointerdown", activateMegapixelsMode);
    targetMegapixels.addEventListener("keydown", (event) => {
      if (event.key.length === 1 || ["Backspace", "Delete", "ArrowUp", "ArrowDown"].includes(event.key)) {
        activateMegapixelsMode();
      }
    });
    targetMegapixels.addEventListener("paste", activateMegapixelsMode);
    targetMegapixels.addEventListener("input", () => {
      activateMegapixelsMode();
      if (Number(targetMegapixels.value) > 0) sync();
    });
    targetMegapixels.addEventListener("change", sync);
    const activateDimensionsMode = () => {
      if (mode.value === "off" || sizeMode.value === "dimensions") return;
      switchSizeMode("dimensions");
    };
    for (const input of [finalWidth, finalHeight]) {
      input.addEventListener("pointerdown", activateDimensionsMode);
      input.addEventListener("keydown", (event) => {
        if (event.key.length === 1 || ["Backspace", "Delete", "ArrowUp", "ArrowDown"].includes(event.key)) {
          activateDimensionsMode();
        }
      });
      input.addEventListener("paste", activateDimensionsMode);
      input.addEventListener("input", activateDimensionsMode);
    }
    finalWidth.addEventListener("change", () => {
      finalWidth.value = String(normalizeSecondTargetDimension(finalWidth.value, 832));
      sync();
    });
    finalHeight.addEventListener("change", () => {
      finalHeight.value = String(normalizeSecondTargetDimension(finalHeight.value, 480));
      sync();
    });
    comparison.addEventListener("change", sync);
    row._h3SecondControls = {
      mode, samplingLayout, firstMegapixels, sizeMode, targetMegapixels, finalWidth, finalHeight,
      stepsInput, denoise, comparison, currentConfig,
    };
    row._h3SecondSync = sync;
    row.append(modeControl, firstMegapixels, sizeControl, stepsInput, denoise, comparison, resolution);
    sync();
    return row;
  };
  const renderSecondRows = () => {
    secondRows.replaceChildren();
    const targets = secondTargets();
    const multiple = targets.length > 1;
    secondEditField.hidden = !multiple;
    const separate = multiple && secondSampleEditMode === "separate";
    secondRows.hidden = !separate;
    secondModeSelect.disabled = separate;
    if (separate) {
      for (const index of targets) secondRows.appendChild(createSecondRow(index));
    }
  };
  const setSecondModelBusy = (active, message) => {
    secondSampleModelBusy = active;
    secondSampleModelMessage = message || secondSampleModelMessage;
    secondProgress.classList.remove("runtime");
    if (secondProgress.firstElementChild) secondProgress.firstElementChild.style.width = "";
    secondProgress.classList.toggle("busy", active);
    secondSave.disabled = active || !secondTargets().length;
    secondSetupButton.disabled = active;
    secondSetupEnvironmentSelect.disabled = active;
    secondSetupWeightSourceSelect.disabled = active;
    secondSetupWeightSelect.disabled = active || secondSetupWeightSelect.options.length <= 1;
    secondState.textContent = secondSampleModelMessage;
  };
  const scheduleSecondSetupPoll = () => {
    if (secondSampleStatusPollTimer || secondSampleStatusCache?.state !== "running") return;
    secondSampleStatusPollTimer = setTimeout(async () => {
      secondSampleStatusPollTimer = null;
      try { await loadSecondSampleStatus(true); }
      catch (error) {
        secondSampleModelMessage = "环境状态读取失败：" + error.message;
        secondState.textContent = secondSampleModelMessage;
      }
      scheduleSecondSetupPoll();
    }, 800);
  };
  const applySecondStatus = (payload) => {
    secondSampleStatusCache = payload;
    secondSampleSetupStatus = normalizeH3SecondSampleSetupStatus(payload);
    const installedPackageWeight = h3SecondSampleUpscalerModelName(payload?.upscaler_model);
    if (installedPackageWeight) secondSampleSelectedUpscalerModel = installedPackageWeight;
    if (secondSampleSetupStatus.selection.weight_id) {
      secondSampleSetupSelection = secondSampleSetupStatus.selection;
      node.properties.h3_second_sample_setup_selection = { ...secondSampleSetupSelection };
    }
    const view = h3SecondSampleSetupPresentation(payload);
    secondState.classList.toggle("error", view.state === "failed");
    secondSetupButton.textContent = view.button_text;
    secondSetupButton.disabled = view.button_disabled;
    secondSampleModelMessage = view.message;
    secondState.textContent = secondSampleModelMessage;
    secondProgress.classList.remove("runtime");
    if (secondProgress.firstElementChild) secondProgress.firstElementChild.style.width = "";
    secondProgress.classList.toggle("busy", view.busy);
    syncSecondSetupAvailability();
    if (view.state === "running") scheduleSecondSetupPoll();
    return payload;
  };
  const loadSecondSampleStatus = async (force = false) => {
    if (!force && secondSampleStatusCache) return applySecondStatus(secondSampleStatusCache);
    if (secondSampleStatusRequest) return secondSampleStatusRequest;
    secondSampleStatusRequest = (async () => {
      const response = await api.fetchApi("/h3director/setup_status");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || ("HTTP " + response.status));
      }
      return applySecondStatus(payload);
    })();
    try { return await secondSampleStatusRequest; }
    finally { secondSampleStatusRequest = null; }
  };
  const ensureSecondSampleReady = async (targetIndexes) => {
    const configs = targetIndexes.map((index) => normalizeH3SecondSample(
      segs[index] && segs[index].second_sample, segs[index])).filter((config) => config.mode !== "off");
    if (!configs.length) return;
    for (let offset = 0; offset < configs.length; offset++) {
      const error = secondTargetValidationError(targetIndexes[offset], configs[offset]);
      if (error) throw new Error(error);
    }
    const payload = await loadSecondSampleStatus(true);
    if (payload.ready === true) return;
    const manual = h3SecondSampleManualRequirements(payload);
    throw new Error(manual.length
      ? `二采环境未就绪；请手动安装：${manual.join("；")}`
      : "二采环境未就绪；请展开二采设置并点“一键配齐”");
  };
  const refreshSecondPanelInputs = () => {
    const targets = secondTargets();
    syncAllSelectionToggle();
    secondSave.disabled = secondSampleModelBusy || !targets.length;
    const configIndex = targets[0] ?? sel;
    const current = normalizeH3SecondSample(
      segs[configIndex] && segs[configIndex].second_sample, segs[configIndex]);
    secondSampleSelectedUpscalerModel = current.upscaler_model || "";
    setSecondUniformInputs(current);
    renderSecondRows();
    syncSecondSetupAvailability();
    const enabledCount = targets.filter((index) => normalizeH3SecondSample(
      segs[index] && segs[index].second_sample, segs[index]).mode !== "off").length;
    secondSampleEnabledBadge.textContent = enabledCount === targets.length && targets.length
      ? "已启用" : enabledCount ? `${enabledCount}/${targets.length} 启用` : "未启用";
    secondSampleEnabledBadge.classList.toggle("enabled", enabledCount > 0);
    secondSampleEnabledBadge.classList.toggle("disabled", enabledCount === 0);
    secondSampleScopeBadge.textContent = !targets.length
      ? "未选择" : targets.length === segs.length ? `全部${targets.length}段` : `已选${targets.length}段`;
    const output = secondSizeStatus(targets[0] ?? sel, secondDisplayConfig(current)).final;
    secondSampleSizeBadge.textContent = output ? `${output.width} × ${output.height}` : "尺寸待确认";
    secondSampleSummary.title = h3SecondSampleSummary(segs, targets, secondSampleScope);
    secondSampleChevron.textContent = secondSampleExpanded ? "▾" : "▸";
  };
  syncSecondSamplePanel = () => {
    const visible = curTab() !== "upscale" && secondSampleExpanded;
    secondSamplePanel.hidden = !visible;
    refreshSecondPanelInputs();
    if (!secondSampleStatusCache && !secondSampleStatusRequest && !secondSampleModelBusy) {
      loadSecondSampleStatus().catch((error) => {
        secondSampleModelMessage = "环境状态读取失败：" + error.message;
        secondState.textContent = secondSampleModelMessage;
      });
    }
  };
  secondAllSelectionInput.addEventListener("change", () => {
    if (busy || createProjectOperationBusy()) {
      syncAllSelectionToggle();
      status.style.color = "#ffb36b";
      status.textContent = "当前任务进行中，完成后再切换全部二采。";
      return;
    }
    const enabled = secondAllSelectionInput.checked;
    const fallback = secondSampleDefault.mode === "off"
      ? secondConfigFromInputs({ mode: "standard" }) : secondSampleDefault;
    const count = setH3SegmentsSecondSampleEnabled(segs, enabled, fallback);
    if (enabled && secondSampleDefault.mode === "off") persistSecondSampleDefault(fallback);
    save(); renderTimeline(); renderEditor(); refreshSecondPanelInputs();
    status.style.color = "";
    status.textContent = enabled
      ? `当前页面全部 ${count} 段已启用二采；各段原参数优先恢复`
      : `当前页面全部 ${segs.length} 段已关闭二采；各段参数已保留`;
  });
  secondEditInput.addEventListener("change", () => {
    secondSampleEditMode = secondEditInput.checked ? "uniform" : "separate";
    node.properties.h3_second_sample_edit_mode = secondSampleEditMode;
    renderSecondRows(); save();
  });
  const refreshSecondUniformFromInputs = () => {
    setSecondUniformInputs(secondConfigFromInputs(), true);
    for (const row of secondRows.querySelectorAll(".h3s-second-row")) row._h3SecondSync?.();
  };
  for (const control of [secondModeSelect, secondSamplingLayoutSelect, secondFirstMegapixelsInput]) {
    control.addEventListener("change", refreshSecondUniformFromInputs);
  }
  const switchSecondUniformSizeMode = (nextMode = secondSizeModeSelect.value) => {
    const transition = h3SecondSampleSizeModeTransition(nextMode,
      secondTargetWidthInput.value, secondTargetHeightInput.value,
      secondTargetMegapixelsInput.value);
    secondSizeModeSelect.value = transition.target_size_mode;
    if (transition.target_size_mode === "megapixels") {
      secondTargetMegapixelsInput.value = String(transition.target_megapixels);
    } else {
      secondTargetWidthInput.value = String(transition.final_width);
      secondTargetHeightInput.value = String(transition.final_height);
    }
    refreshSecondUniformFromInputs();
  };
  secondSizeModeSelect.addEventListener("change", () => switchSecondUniformSizeMode());
  const activateSecondUniformMegapixelsMode = () => {
    if (secondModeSelect.value === "off" || secondSizeModeSelect.value === "megapixels") return;
    switchSecondUniformSizeMode("megapixels");
  };
  secondTargetMegapixelsInput.addEventListener("pointerdown", activateSecondUniformMegapixelsMode);
  secondTargetMegapixelsInput.addEventListener("keydown", (event) => {
    if (event.key.length === 1 || ["Backspace", "Delete", "ArrowUp", "ArrowDown"].includes(event.key)) {
      activateSecondUniformMegapixelsMode();
    }
  });
  secondTargetMegapixelsInput.addEventListener("paste", activateSecondUniformMegapixelsMode);
  secondTargetMegapixelsInput.addEventListener("input", () => {
    activateSecondUniformMegapixelsMode();
    if (Number(secondTargetMegapixelsInput.value) > 0) refreshSecondUniformFromInputs();
  });
  secondTargetMegapixelsInput.addEventListener("change", refreshSecondUniformFromInputs);
  const activateSecondUniformDimensionsMode = () => {
    if (secondModeSelect.value === "off" || secondSizeModeSelect.value === "dimensions") return;
    switchSecondUniformSizeMode("dimensions");
  };
  for (const input of [secondTargetWidthInput, secondTargetHeightInput]) {
    input.addEventListener("pointerdown", activateSecondUniformDimensionsMode);
    input.addEventListener("keydown", (event) => {
      if (event.key.length === 1 || ["Backspace", "Delete", "ArrowUp", "ArrowDown"].includes(event.key)) {
        activateSecondUniformDimensionsMode();
      }
    });
    input.addEventListener("paste", activateSecondUniformDimensionsMode);
    input.addEventListener("input", activateSecondUniformDimensionsMode);
  }
  secondTargetWidthInput.addEventListener("change", () => {
    secondTargetWidthInput.value = String(normalizeSecondTargetDimension(
      secondTargetWidthInput.value, 832));
    refreshSecondUniformFromInputs();
  });
  secondTargetHeightInput.addEventListener("change", () => {
    secondTargetHeightInput.value = String(normalizeSecondTargetDimension(
      secondTargetHeightInput.value, 480));
    refreshSecondUniformFromInputs();
  });
  secondSave.addEventListener("click", () => {
    const targets = secondTargets();
    if (!targets.length) {
      secondState.textContent = "当前页面没有已选择段；请先选择至少一段。";
      return;
    }
    const pending = [];
    if (secondSampleEditMode === "separate" && targets.length > 1) {
      for (const row of secondRows.querySelectorAll(".h3s-second-row")) {
        const index = Number(row.dataset.index);
        pending.push({ index, config: row._h3SecondControls.currentConfig() });
      }
    } else {
      const config = secondConfigFromInputs();
      for (const index of targets) pending.push({ index, config });
    }
    const warnings = [];
    for (const item of pending) {
      const targetError = secondTargetValidationError(item.index, item.config);
      if (targetError) {
        secondState.classList.add("error");
        secondState.textContent = targetError;
        return;
      }
      const size = secondSizeStatus(item.index, item.config);
      if (size.warning) warnings.push(`段${item.index + 1}：${size.warning}`);
      const longRunWarning = h3SecondSampleLongRunWarning(
        item.config, size.source.width, size.source.height, segDur(segs[item.index]));
      if (longRunWarning) warnings.push(`段${item.index + 1}：${longRunWarning}`);
    }
    secondState.classList.remove("error");
    for (const item of pending) {
      setH3SegmentSecondSample(segs[item.index], item.config);
    }
    const defaultItem = pending.find((item) => item.index === sel) || pending[0];
    persistSecondSampleDefault(defaultItem.config);
    secondSampleExpanded = false;
    node.properties.h3_second_sample_panel_open = false;
    save();
    syncSecondSamplePanel();
    renderTimeline();
    status.style.color = warnings.length ? "#ffb36b" : "";
    const savedSummary = h3SecondSampleSummary(segs, targets, secondSampleScope);
    status.textContent = `二采设置已保存：${savedSummary}`
      + (warnings.length ? `；${warnings.join("；")}` : "");
    if (secondSampleStatusCache && secondSampleStatusCache.ready !== true) {
      setRunState("二采已标记，但尚不能运行：展开二采设置查看需补齐或手动安装的项目", "error");
      btnRun.classList.add("run-error");
    } else {
      setRunState(`二采已保存：${savedSummary}`, "success");
      btnRun.classList.remove("run-error");
    }
  });
  secondSetupButton.addEventListener("click", async () => {
    if (secondSampleModelBusy) return;
    const availability = syncSecondSetupSelection();
    const selectedOption = secondSetupWeightSelect.options[secondSetupWeightSelect.selectedIndex];
    const localEnvironment = secondSampleSetupSelection.environment_source === "local";
    if (!localEnvironment && availability.installed_selected) {
      secondState.classList.remove("error");
      secondState.textContent = "已安装本地权重无需调用一键配齐；保存二采设置后会把文件名写入当前段。";
      return;
    }
    if (!availability.can_setup || !localEnvironment
        && (selectedOption?.dataset.kind !== "catalog" || !secondSampleSetupSelection.weight_id)) {
      secondState.classList.add("error");
      secondState.textContent = localEnvironment
        ? "无法开始一键配齐：请选择匹配的环境包 ZIP，并明确选择3D权重或已安装固定权重。"
        : "无法开始一键配齐：请选择同一次状态响应中可用的环境来源、权重线路和已核验在线权重。";
      return;
    }
    const environmentLabel = H3_SECOND_SAMPLE_ENVIRONMENT_SOURCES.find(
      (item) => item.id === secondSampleSetupSelection.environment_source)?.label;
    const weightSourceLabel = H3_SECOND_SAMPLE_WEIGHT_SOURCES.find(
      (item) => item.id === secondSampleSetupSelection.weight_source)?.label;
    const selectedUpscalerModel = selectedSecondSetupModel();
    const confirmation = localEnvironment
      ? `环境包：${secondSampleLocalPackage?.label || "未选择"}\n先离线校验并安装二采节点、兼容3D节点和缺失Python依赖；环境包不含权重。\n权重：通过${weightSourceLabel}下载并校验 ${selectedUpscalerModel}\n不会下载H3主模型、静默换线路或自动重启；完成后需要手动重启 ComfyUI。是否开始？`
      : `环境来源：${environmentLabel}\n权重：通过${weightSourceLabel}下载并校验 ${selectedUpscalerModel}\n不会下载H3主模型、静默换线路或自动重启。是否开始？`;
    if (!window.confirm(confirmation)) return;
    setSecondModelBusy(true, localEnvironment
      ? "正在安装环境并配齐在线权重…" : "正在配齐：环境 0/1；权重 0/1");
    secondSetupEnvironmentState.textContent = "环境来源：等待后端进度……";
    secondSetupWeightState.textContent = localEnvironment
      ? "权重：等待后端按所选在线线路下载/校验……" : "权重：等待后端下载/校验进度……";
    try {
      let request;
      if (localEnvironment) {
        const form = new FormData();
        form.append("environment_source", "local");
        form.append("weight_source", secondSampleSetupSelection.weight_source);
        form.append("weight_id", secondSampleSetupSelection.weight_id);
        form.append("local_package", secondSampleLocalPackage.file,
          secondSampleLocalPackage.file.name);
        request = { method: "POST", body: form };
      } else {
        request = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          environment_source: secondSampleSetupSelection.environment_source,
          weight_source: secondSampleSetupSelection.weight_source,
          weight_id: secondSampleSetupSelection.weight_id,
          }),
        };
      }
      const response = await api.fetchApi("/h3director/setup", request);
      const payload = await response.json();
      const concurrent = response.status === 409 && payload?.state === "running";
      if ((!response.ok && !concurrent) || (payload?.ok === false && !concurrent)) {
        applySecondStatus(payload);
        return;
      }
      applySecondStatus(payload);
    } catch (error) {
      applySecondStatus({
        ...(secondSampleStatusCache || {}), state: "failed", ready: false, error: error.message,
        manual_requirements: h3SecondSampleManualRequirements(secondSampleStatusCache),
      });
    } finally {
      setSecondModelBusy(false, secondSampleModelMessage);
      if (secondSampleStatusCache) applySecondStatus(secondSampleStatusCache);
    }
  });
  syncSecondSamplePanel();

  const secondSampleCard = mk("section", "h3s-second-config");
  secondSampleCard.append(secondSampleHead, secondSamplePanel);
  box.appendChild(secondSampleCard);

  /* 三个工作台共用一套 API 连接配置。当前前台只保留连接测试，以及创作页在
     本地名称/别名无法确定时的资产匹配；Key 仍只保存在后端本机配置。 */
  const apiCard = mk("section", "h3s-api-config");
  const apiHead = mk("div", "h3s-api-head");
  const apiChevron = mk("span", null, "▾");
  const apiState = mk("span", "h3s-api-state", "正在读取 API 配置…");
  apiHead.append(apiChevron, mk("b", null, "API 设置"),
    mk("span", "h3s-hint", "创作页资产不确定匹配与连接测试使用；本地名称匹配无需 API"), apiState);
  const apiBody = mk("div", "h3s-api-body");
  let apiExpanded = node.properties.h3_api_panel_open !== false;
  const syncApiExpanded = () => {
    apiBody.style.display = apiExpanded ? "flex" : "none";
    apiChevron.textContent = apiExpanded ? "▾" : "▸";
  };
  apiHead.addEventListener("click", () => {
    apiExpanded = !apiExpanded;
    node.properties.h3_api_panel_open = apiExpanded;
    syncApiExpanded();
  });

  let savedApiBase = "";
  const apiHost = (value) => {
    try { return new URL(String(value || "").trim()).host.toLowerCase(); }
    catch (e) { return ""; }
  };
  const apiPreset = document.createElement("select");
  Object.entries(H3_API_PRESETS).forEach(([value, preset]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = preset.label;
    apiPreset.appendChild(option);
  });
  apiPreset.title = "选择服务商后自动填写 API Base；不同服务商的 Key 不能混用";
  const apiBase = document.createElement("input");
  apiBase.type = "text";
  apiBase.placeholder = "https://api.openai.com/v1";
  apiBase.title = "OpenAI-compatible API Base URL；可填写 /chat/completions 或 /responses 完整地址";
  apiBase.style.cssText = "min-width:245px;flex:1;";
  const modelPreset = document.createElement("select");
  modelPreset.title = "常用模型快捷选择；列表没有时选自定义模型";
  const apiModel = document.createElement("input");
  apiModel.type = "text";
  apiModel.placeholder = "模型 ID";
  apiModel.title = "填写服务商支持的真实模型 ID";
  apiModel.style.cssText = "min-width:150px;width:190px;";
  const apiKey = document.createElement("input");
  apiKey.type = "password";
  apiKey.autocomplete = "new-password";
  apiKey.placeholder = "输入 API Key";
  apiKey.title = "Key 只保存到 ComfyUI 后端本机配置，不写入工作流或浏览器存储";
  apiKey.style.cssText = "min-width:170px;width:215px;";
  const btnSaveApi = mk("button", "h3s-btn", "保存设置");
  const btnTestApi = mk("button", "h3s-btn", "测试连接");

  const fillModelPresets = (providerKey, selectedModel, useDefault = false) => {
    const models = (H3_API_PRESETS[providerKey] || H3_API_PRESETS.custom).models;
    modelPreset.innerHTML = "";
    models.forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modelPreset.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "__custom__";
    customOption.textContent = "自定义模型…";
    modelPreset.appendChild(customOption);
    if (useDefault && models.length) {
      apiModel.value = models[0][0];
      modelPreset.value = models[0][0];
      return;
    }
    modelPreset.value = models.some(([value]) => value === selectedModel) ? selectedModel : "__custom__";
  };
  const useCustomApiFields = () => {
    if (apiPreset.value === "custom") return;
    apiPreset.value = "custom";
    fillModelPresets("custom", apiModel.value.trim(), false);
  };
  const setApiError = (message) => {
    apiState.style.color = "#ff8080";
    apiState.textContent = message;
  };
  const showProviderSwitchWarning = () => {
    const oldHost = apiHost(savedApiBase);
    const newHost = apiHost(apiBase.value);
    if (oldHost && newHost && oldHost !== newHost && !apiKey.value.trim()) {
      apiState.style.color = "#f2c94c";
      apiState.textContent = "已切换服务商，请输入该服务商自己的新 Key";
      return true;
    }
    return false;
  };
  apiPreset.addEventListener("change", () => {
    const preset = H3_API_PRESETS[apiPreset.value] || H3_API_PRESETS.custom;
    if (preset.base) apiBase.value = preset.base;
    fillModelPresets(apiPreset.value, apiModel.value.trim(), apiPreset.value !== "custom");
    showProviderSwitchWarning();
  });
  modelPreset.addEventListener("change", () => {
    if (modelPreset.value !== "__custom__") apiModel.value = modelPreset.value;
    else { apiModel.focus(); apiModel.select(); }
  });
  apiBase.addEventListener("input", () => {
    useCustomApiFields();
    apiState.style.color = "";
    apiState.textContent = "API Base 已手动修改；不会自动识别服务商，请核对模型和 Key";
  });
  apiBase.addEventListener("change", () => {
    showProviderSwitchWarning();
  });
  apiModel.addEventListener("input", () => {
    const models = (H3_API_PRESETS[apiPreset.value] || H3_API_PRESETS.custom).models;
    const value = apiModel.value.trim();
    modelPreset.value = models.some(([model]) => model === value) ? value : "__custom__";
  });
  apiKey.addEventListener("input", () => {
    const raw = apiKey.value.trim();
    if (!raw) { showProviderSwitchWarning(); return; }
    apiState.style.color = "";
    apiState.textContent = "已输入新 Key；不会自动识别或修改接口，请保存设置或测试连接";
  });
  const loadApiConfig = async () => {
    const resp = await api.fetchApi("/h3director/api_config");
    const cfg = await resp.json();
    if (!resp.ok) throw new Error(cfg.error || ("HTTP " + resp.status));
    savedApiBase = cfg.base_url || "";
    apiBase.value = cfg.base_url || "";
    apiModel.value = cfg.model || "";
    apiPreset.value = "custom";
    fillModelPresets("custom", apiModel.value.trim(), false);
    apiKey.value = "";
    apiKey.placeholder = cfg.has_key ? "已保存，留空不修改" : "输入 API Key";
    apiState.style.color = cfg.configured ? "#8ee6a0" : "#f2c94c";
    apiState.textContent = cfg.configured
      ? "已配置 · " + (cfg.model || "未填写模型")
      : "尚未配置；本地名称匹配仍可用，不确定资产不会调用 API";
    if (cfg.configured && node.properties.h3_api_panel_open == null) {
      apiExpanded = false;
      syncApiExpanded();
    }
    return cfg;
  };
  const saveApiConfig = async (showSuccess = true) => {
    const oldHost = apiHost(savedApiBase);
    const newHost = apiHost(apiBase.value);
    if (oldHost && newHost && oldHost !== newHost && !apiKey.value.trim()) {
      throw new Error("切换了 API 服务商，必须输入该服务商自己的新 API Key");
    }
    const resp = await api.fetchApi("/h3director/api_config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: apiBase.value.trim(),
        model: apiModel.value.trim(),
        api_key: apiKey.value.trim(),
      }),
    });
    const cfg = await resp.json();
    if (!resp.ok || !cfg.ok) throw new Error(cfg.error || ("HTTP " + resp.status));
    savedApiBase = cfg.base_url || apiBase.value.trim();
    apiKey.value = "";
    apiKey.placeholder = cfg.has_key ? "已保存，留空不修改" : "输入 API Key";
    apiState.style.color = "#8ee6a0";
    if (showSuccess) apiState.textContent = "API 设置已保存 · " + (cfg.model || apiModel.value.trim());
    return cfg;
  };
  btnSaveApi.addEventListener("click", async (event) => {
    event.stopPropagation();
    btnSaveApi.disabled = true;
    apiState.style.color = "";
    apiState.textContent = "正在保存 API 设置…";
    try { await saveApiConfig(true); }
    catch (error) { setApiError("保存失败：" + error.message); }
    btnSaveApi.disabled = false;
  });
  btnTestApi.addEventListener("click", async (event) => {
    event.stopPropagation();
    btnTestApi.disabled = true;
    apiState.style.color = "";
    apiState.textContent = "正在测试 API 连接…";
    try {
      await saveApiConfig(false);
      const resp = await api.fetchApi("/h3director/api_test", { method: "POST" });
      const result = await resp.json();
      if (!resp.ok || !result.ok) {
        if (result.connected) {
          apiState.style.color = "#e8bd68";
          apiState.textContent = "API已连接，但本次响应没有可用的最终文本：" + (result.error || "请检查模型输出设置");
          return;
        }
        throw new Error(result.error || ("HTTP " + resp.status));
      }
      apiState.style.color = result.vision_capability === "unsupported" ? "#e8bd68" : "#8ee6a0";
      apiState.textContent = apiTestStatusText(result, apiModel.value.trim());
    } catch (error) { setApiError("连接失败：" + error.message); }
    btnTestApi.disabled = false;
  });
  apiBody.append(
    mk("span", "h3s-hint", "API 预设"), apiPreset,
    mk("span", "h3s-hint", "API Base"), apiBase,
    mk("span", "h3s-hint", "模型选择"), modelPreset,
    mk("span", "h3s-hint", "模型 ID"), apiModel,
    mk("span", "h3s-hint", "API Key"), apiKey,
    btnSaveApi, btnTestApi,
    mk("span", "h3s-hint", "Key 仅保存在本机 ComfyUI user 目录；参考资产上下文只发送类型与名称，不发送本地路径"),
    mk("span", "h3s-hint", "插件不会根据 Key 或 API Base 自动识别服务商；请手动选择 API 预设，或填写自定义地址和模型"),
    mk("span", "h3s-hint", "智谱选型：纯文本剧本用 GLM-5.2；需要读取参考图用 GLM-5V Turbo；免费测试可用 GLM-4.7 Flash / GLM-4.6V Flash"),
  );
  apiCard.append(apiHead, apiBody);
  syncApiExpanded();
  box.appendChild(apiCard);
  loadApiConfig().catch((error) => setApiError("API 配置查询失败：" + error.message + "（请重启 ComfyUI）"));

  /* 进度条 */
  const prog = mk("div", "h3s-prog");
  const progIn = document.createElement("div");
  prog.appendChild(progIn);
  box.appendChild(prog);

  /* 时间轴：方案 A 保持在双栏工作区上方，任何模式都能先选段、再编辑。 */
  const timelinePanel = mk("section", "h3s-timeline-panel");
  const timelineHead = mk("div", "h3s-timeline-head");
  const timelineNote = mk("span", "h3s-timeline-note", "点击切换当前段 · 拖右边缘改时长 · 空白处拖框可批量选择");
  timelineHead.append(
    mk("b", null, "镜头时间轴"),
    timelineNote
  );
  timelinePanel.appendChild(timelineHead);
  const tl = mk("div", "h3s-tl");
  const trackV = mk("div", "h3s-track");
  const timelineActions = mk("div", "h3s-timeline-actions");
  timelineActions.appendChild(mk("span", "atag", "镜头"));
  const btnRerollAll = mk("button", "h3s-btn h3s-reroll-all", "全段重抽");
  btnRerollAll.type = "button";
  btnRerollAll.title = "给当前页面所有已启用段分别换新种子并重新生成；停用段和旧视频保留，完成后自动重新合并";
  btnRerollAll.addEventListener("click", () => {
    if (busy) return;
    const indexes = segs.map((segment, index) => segment.enabled !== false ? index : -1)
      .filter((index) => index >= 0);
    if (!indexes.length) {
      status.style.color = "#ffb36b";
      status.textContent = "没有已启用段，请先在镜头卡上勾选至少一段";
      return;
    }
    void run(true, indexes, "all");
  });
  timelineActions.appendChild(btnRerollAll);
  trackV.appendChild(timelineActions);
  trackV.appendChild(tl);
  timelinePanel.appendChild(trackV);

  box.appendChild(timelinePanel);

  /* v2.13.15：鼠标在段时间轴空白处按住左键拖出矩形框，框住的段卡片高亮（配合「删选中」）。
     用 Pointer Capture：监听都挂在 tl 上，节点删除时 tl 移除、监听自动清理，无 window 泄漏。
     点在段卡片/时长标签/拖拽柄上不启动框选（保留单选、点选时长、拖时长）。 */
  let mDown = false, mMoved = false, mStart = null, marquee = null;
  /* PointerEvent 的 clientX/Y 是屏幕 CSS 像素；tl 内绝对定位使用的是节点布局坐标。
     ComfyUI 画布缩放后两者不再是 1:1，必须用元素实际屏幕尺寸 / 布局尺寸分别换算 X/Y。
     不能只使用全局 canvasScale：浏览器缩放、非等比变换和滚动条都会造成细微差异。 */
  const timelinePointerPoint = (ev) => {
    const rect = tl.getBoundingClientRect();
    const fallback = Math.max(0.0001, canvasScale());
    const rawScaleX = tl.offsetWidth > 0 ? rect.width / tl.offsetWidth : fallback;
    const rawScaleY = tl.offsetHeight > 0 ? rect.height / tl.offsetHeight : fallback;
    const scaleX = Number.isFinite(rawScaleX) && rawScaleX > 0.0001 ? rawScaleX : fallback;
    const scaleY = Number.isFinite(rawScaleY) && rawScaleY > 0.0001 ? rawScaleY : fallback;
    return {
      x: (ev.clientX - rect.left) / scaleX + tl.scrollLeft,
      y: (ev.clientY - rect.top) / scaleY + tl.scrollTop,
    };
  };
  tl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (ev.target.closest(".h3s-slot, .h3s-durpick, .h3s-timeline-drop, .h3s-insert-video")) return;
    const point = timelinePointerPoint(ev);
    mDown = true; mMoved = false;
    mStart = { x: point.x, y: point.y, screenX: ev.clientX, screenY: ev.clientY };
    try { tl.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  tl.addEventListener("pointermove", (ev) => {
    if (!mDown || !mStart) return;
    if (!mMoved && Math.hypot(ev.clientX - mStart.screenX, ev.clientY - mStart.screenY) < 5) return;
    if (!mMoved) { mMoved = true; marquee = mk("div", "h3s-marquee"); tl.appendChild(marquee); }
    const point = timelinePointerPoint(ev);
    marquee.style.left = Math.min(mStart.x, point.x) + "px";
    marquee.style.top = Math.min(mStart.y, point.y) + "px";
    marquee.style.width = Math.abs(point.x - mStart.x) + "px";
    marquee.style.height = Math.abs(point.y - mStart.y) + "px";
    /* 以黄色框实际渲染到屏幕上的范围做命中判断，保证视觉框和选中结果永远一致。 */
    const selectRect = marquee.getBoundingClientRect();
    boxSel.clear();
    Array.from(tl.querySelectorAll(".h3s-slot")).forEach((el) => {
      const r = el.getBoundingClientRect();
      const hit = !(r.right < selectRect.left || r.left > selectRect.right
        || r.bottom < selectRect.top || r.top > selectRect.bottom);
      const idx = Number(el.dataset.idx);
      if (hit) { boxSel.add(idx); el.classList.add("boxsel"); }
      else el.classList.remove("boxsel");
    });
  });
  const endMarquee = (ev) => {
    if (!mDown) return;
    mDown = false;
    try { tl.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (marquee) { marquee.remove(); marquee = null; }
    if (mMoved) { renderTimeline(); }
    mMoved = false; mStart = null;
  };
  tl.addEventListener("pointerup", endMarquee);
  tl.addEventListener("pointercancel", endMarquee);

  /* 编辑区：保持 flex:1 自动填充节点剩余空间——节点（面板）放大时它跟着放大，
     不需要也不允许横条锁死它的尺寸 */
  const editor = mk("div", "h3s-editor");
  box.appendChild(editor);
  syncWorkspaceVisibility = () => {
    const isUpscale = curTab() === "upscale";
    secondSampleCard.style.display = isUpscale ? "none" : "";
    apiCard.style.display = isUpscale ? "none" : "";
    prog.style.display = isUpscale ? "none" : "";
    timelinePanel.style.display = isUpscale ? "none" : "";
  };
  syncWorkspaceVisibility();

  async function queueThis() {
    flushScheduledSave();
    const graphPrompt = await app.graphToPrompt();
    const output = graphPrompt?.output || {};
    const keep = new Set();
    const stack = [String(node.id)];
    while (stack.length) {
      const id = stack.pop();
      if (keep.has(id) || !output[id]) continue;
      keep.add(id);
      for (const v of Object.values(output[id].inputs)) {
        if (Array.isArray(v)) stack.push(String(v[0]));
      }
    }
    const sub = {};
    for (const id of keep) sub[id] = output[id];
    /* ComfyUI 的标准 queuePrompt 负载同时包含 output 与 workflow。
       Easy-Use 的全局种子扩展会包装 queuePrompt，并在 workflow 上写入
       seed_widgets；只传 output 会让它在真正入队前直接抛错。保留完整
       workflow 既兼容原生 ComfyUI，也兼容 Easy-Use、rgthree 等队列包装。 */
    const workflow = graphPrompt?.workflow || app.graph?.serialize?.() || {};
    return api.queuePrompt(0, { output: sub, workflow });
  }

  async function ensureQueuedPromptSucceeded(queued) {
    const promptId = String(queued && queued.prompt_id || "");
    if (!promptId) throw new Error("ComfyUI 没有返回二采任务 ID，无法确认二采是否成功");
    const response = await api.fetchApi("/history/" + encodeURIComponent(promptId));
    const history = await response.json();
    if (!response.ok) throw new Error("无法读取二采任务结果（HTTP " + response.status + "）");
    const entry = history && history[promptId];
    if (!entry || !entry.status) throw new Error("二采任务结束，但 ComfyUI 历史中没有结果");
    if (entry.status.status_str === "success" && entry.status.completed !== false) return;
    const messages = Array.isArray(entry.status.messages) ? entry.status.messages : [];
    const failure = messages.slice().reverse().find((item) => Array.isArray(item)
      && (item[0] === "execution_error" || item[0] === "execution_interrupted"));
    const detail = failure && failure[1] || {};
    const message = detail.exception_message || (failure && failure[0] === "execution_interrupted"
      ? "任务已取消" : "后端执行失败");
    throw new Error("二采未完成：" + message);
  }

  async function waitIdle() {
    await new Promise((r) => setTimeout(r, 500));
    let fails = 0;
    for (;;) {
      try {
        const q = await api.getQueue();
        fails = 0;
        const running = (q.queue_running || q.Running || []).length;
        const pending = (q.queue_pending || q.Pending || []).length;
        if (running + pending === 0) return;
      } catch (e) {
        /* getQueue 偶发失败（网络/重启中）容忍，连续 5 次失败才放弃，防止 busy 永久锁死 */
        if (++fails >= 5) throw new Error("队列状态查询连续失败（ComfyUI 是否在运行？）");
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  async function run(all, requestedIndexes = null, rerollKind = "") {
    if (busy) return;
    /* 用户点击运行后直接提交当前启用分段。Picture、占位符、素材匹配、台词速度和
       内容质量不再由前端预审阻止；真实后端/模型失败仍按运行结果显示。 */
    busy = true;
    syncCreateProjectControls();
    let enabledSnapshot = [];
    let mergeIndexes = [];
    let runIndexes = [];
    let secondSampleEnabled = false;
    let queuedPromptId = "";
    const explicitRunIndexes = Array.isArray(requestedIndexes)
      ? [...new Set(requestedIndexes.map(Number))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < segs.length)
      : null;
    const configuredSecondTargets = secondTargets();
    const secondSampleEnabledForScope = configuredSecondTargets.some((index) =>
      normalizeH3SecondSample(segs[index] && segs[index].second_sample, segs[index]).mode !== "off");
    const scopedRun = explicitRunIndexes !== null || curMode() === "create" || secondSampleEnabledForScope;
    try {
      setRunState(secondSampleEnabledForScope
        ? "正在检查二采设置与运行范围…" : "正在提交运行任务…", "busy");
      btnRun.classList.remove("run-error");
      secondSamplePanel.dataset.tone = "";
      secondState.classList.remove("error");
      const scriptNotice = prepareCurrentTimelineForRun();
      enabledSnapshot = segs.map((segment) => segment.enabled !== false);
      mergeIndexes = enabledSnapshot
        .map((enabled, index) => enabled ? index + 1 : null)
        .filter(Number.isInteger);
      runIndexes = explicitRunIndexes !== null ? explicitRunIndexes : scopedRun ? configuredSecondTargets : (all
        ? enabledSnapshot.map((enabled, index) => enabled ? index : -1).filter((index) => index >= 0)
        : [sel]);
      if (!runIndexes.length) throw new Error("当前页面没有已选择段，请先选择至少一段");
      for (const index of runIndexes) {
        if (!mergeIndexes.includes(index + 1)) mergeIndexes.push(index + 1);
      }
      mergeIndexes.sort((a, b) => a - b);
      secondSampleEnabled = runIndexes.some((index) =>
        normalizeH3SecondSample(segs[index] && segs[index].second_sample, segs[index]).mode !== "off");
      if (secondSampleEnabled) await ensureSecondSampleReady(runIndexes);
      const longRunWarnings = secondSampleEnabled ? runIndexes.map((index) => {
        const config = normalizeH3SecondSample(
          segs[index] && segs[index].second_sample, segs[index]);
        if (config.mode === "off") return "";
        const size = secondSizeStatus(index, config);
        const warning = h3SecondSampleLongRunWarning(
          config, size.source.width, size.source.height, segDur(segs[index]));
        return warning ? `段${index + 1}：${warning}` : "";
      }).filter(Boolean) : [];
      if (!all && !mergeIndexes.includes(sel + 1)) {
        mergeIndexes.push(sel + 1);
        mergeIndexes.sort((a, b) => a - b);
      }
      if (scopedRun || !all) {
        /* 单段抽卡必须把其它段临时停用。否则段4尾帧变化会让段5缓存失效，
           用户只想换4却会连带重生5，无法得到 1-2-3-新4-旧5。 */
        for (let i = 0; i < segs.length; i++) {
          const selectedForRun = runIndexes.includes(i);
          segs[i].enabled = selectedForRun;
          segs[i].force = selectedForRun;
          if (selectedForRun) segs[i].seed = Math.floor(Math.random() * 1e15);
        }
      } else {
        for (const s of segs) s.force = false;
      }
      save();
      status.style.color = "";
      const runningText = scopedRun
        ? (runIndexes.length === 1 ? `段${runIndexes[0] + 1} 运行中…` : `${runIndexes.length}个已勾选段运行中…`)
        : all ? "全部运行中…" : `段${sel + 1} 运行中…`;
      const runningNotice = [scriptNotice, longRunWarnings.join("；"), runningText]
        .filter(Boolean).join("；");
      status.textContent = runningNotice;
      setRunState(longRunWarnings.length
        ? `${runningText}；${longRunWarnings.join("；")}` : runningText, "busy");
      if (secondSampleEnabled) beginSecondSampleRuntime(runIndexes);
      const queued = await queueThis();
      if (secondSampleEnabled) queuedPromptId = bindSecondSampleRuntimePrompt(queued);
      await waitIdle();
      if (secondSampleEnabled) await ensureQueuedPromptSucceeded(queued);
      const completionText = rerollKind === "all"
        ? `全部${runIndexes.length}个已启用段重抽完成`
        : rerollKind === "single"
          ? `段${runIndexes[0] + 1} 已重抽；其它段保持原片`
          : scopedRun ? (runIndexes.length === 1
          ? `段${runIndexes[0] + 1} 已生成；其它段保持原片`
          : `${runIndexes.length}个已勾选段生成完成；其它段保持原片`)
            : all ? "全部生成完成" : `段${sel + 1} 已重抽；其它段保持原片`;
      await mergeCurrentSegments({ automatic: true, completionText, segmentIndexes: mergeIndexes });
      setRunState(completionText, "success");
    } catch (e) {
      /* 任何失败必须可见 + busy 必须复位——否则按钮静默"不管用"（曾经的锁死 bug） */
      let runtimeView = secondSampleRuntimeLastStage && secondSampleRuntimeLastStage.failure
        ? h3SecondSampleRuntimePresentation(secondSampleRuntimeLastStage) : null;
      if (secondSampleEnabled && queuedPromptId && !runtimeView) {
        const diagnostics = await readSecondSampleRuntimeDiagnostics(runIndexes, queuedPromptId);
        if (diagnostics && diagnostics.failure) {
          runtimeView = applySecondSampleRuntimeStage(diagnostics);
        }
      }
      const message = runtimeView && runtimeView.stage.failure
        ? runtimeView.message : (e && e.message ? e.message : String(e));
      status.style.color = "#ff8080";
      status.textContent = runtimeView && runtimeView.stage.failure ? message : "出错: " + message;
      setRunState(runtimeView && runtimeView.stage.failure ? message : "未运行：" + message, "error");
      btnRun.classList.add("run-error");
      if (secondSampleEnabled || /二采/.test(message)) {
        secondSampleExpanded = true;
        node.properties.h3_second_sample_panel_open = true;
        syncSecondSamplePanel();
        secondSampleModelMessage = message;
        secondState.textContent = message;
        secondState.classList.add("error");
        secondSamplePanel.dataset.tone = "error";
      }
      console.error("[H3导演台] 运行失败:", e);
    } finally {
      for (let i = 0; i < segs.length; i++) {
        segs[i].force = false;
        if ((scopedRun || !all) && i < enabledSnapshot.length) segs[i].enabled = enabledSnapshot[i];
      }
      try { save(); } catch (e2) { console.error("[H3导演台] save 失败:", e2); }
      finishSecondSampleRuntime();
      busy = false;
      syncCreateProjectControls();
      renderTimeline();
      renderEditor();
    }
  }

  /* 顶栏运行按钮已移除（v1.14.4）：run/queueThis 保留供未来恢复 */
  btnAdd.addEventListener("click", () => {
    /* 视频/文本界面新建段：时长取节点「时长秒」（段级覆盖的唯一默认值来源，v2.7） */
    const _durW = node.widgets.find((w) => w.name === "时长秒");
    const _defDur = clampDur((curMode() !== "create" && _durW) ? _durW.value : 10);
    const segment = {
      prompt: "",
      seed: Math.floor(Math.random() * 1e15),
      refs: [],
      video_refs: [],
      video_ref_modes: {},
      duration: _defDur,
      inherit_shared: true,
      use_tail: true,
      enabled: true,
      force: false,
    };
    applySecondSampleDefault(segment);
    segs.push(segment);
    save(); renderTimeline(); renderEditor();
  });
  btnDel.addEventListener("click", () => {
    if (segs.length <= 1) return;
    const removed = segs.length;
    segs.pop();
    if (curMode() === "create") {
      createTimelineVideos = shiftCreateTimelineVideosAfterSegmentRemoval(
        createTimelineVideos, removed, createSegs.length);
    }
    if (sel >= segs.length) sel = segs.length - 1;
    clearBoxSel();
    save(); renderTimeline(); renderEditor();
  });
  /* 删段（v2.10.16）：删除当前选中的段（-段 只能删末尾段） */
  const btnDelSel = mk("button", "h3s-btn", "删段");
  btnDelSel.title = "删除当前选中的段（至少保留 1 段）";
  btnDelSel.addEventListener("click", () => {
    if (segs.length <= 1) { status.textContent = "至少保留 1 段"; return; }
    const removed = sel + 1;
    segs.splice(sel, 1);
    if (curMode() === "create") {
      createTimelineVideos = shiftCreateTimelineVideosAfterSegmentRemoval(
        createTimelineVideos, removed, createSegs.length);
    }
    if (sel >= segs.length) sel = segs.length - 1;
    clearBoxSel();
    save(); renderTimeline(); renderEditor();
    status.textContent = "已删除段" + removed;
  });
  segmentGroup.insertBefore(btnDelSel, allSelectionToggle);
  /* v2.13.15：删除鼠标框选选中的段（框选只负责高亮选中，点本按钮才删；两段式确认，至少留 1 段） */
  const btnDelBox = mk("button", "h3s-btn", "删选中");
  btnDelBox.title = "删除鼠标框选选中的段（至少保留 1 段）";
  let delBoxArmed = false;
  const disarmDelBox = () => { delBoxArmed = false; btnDelBox.textContent = "删选中"; btnDelBox.style.background = ""; btnDelBox.style.borderColor = ""; };
  btnDelBox.addEventListener("click", () => {
    if (boxSel.size === 0) { status.textContent = "先在段时间轴空白处按住左键拖框选要删的段"; return; }
    if (segs.length - boxSel.size < 1) { status.textContent = "至少保留 1 段"; disarmDelBox(); return; }
    if (!delBoxArmed) {
      delBoxArmed = true;
      btnDelBox.textContent = "再点确认删除 " + boxSel.size + " 段";
      btnDelBox.style.background = "#8a2f2f";
      btnDelBox.style.borderColor = "#c05555";
      return;
    }
    disarmDelBox();
    const removed = Array.from(boxSel).map((i) => i + 1).sort((a, b) => a - b);
    const keep = segs.filter((_, i) => !boxSel.has(i));
    segs.length = 0;
    segs.push(...keep);
    if (curMode() === "create") {
      let remaining = createSegs.length + removed.length;
      for (const segmentNumber of removed.slice().sort((a, b) => b - a)) {
        remaining -= 1;
        createTimelineVideos = shiftCreateTimelineVideosAfterSegmentRemoval(
          createTimelineVideos, segmentNumber, remaining);
      }
    }
    sel = Math.min(sel, segs.length - 1);
    clearBoxSel();
    save(); renderTimeline(); renderEditor();
    status.textContent = "已删除段 " + removed.join(",") + "（共 " + removed.length + " 段）";
  });
  segmentGroup.insertBefore(btnDelBox, allSelectionToggle);
  /* 清空分段（v2.11.1 修订）：一键删除当前界面时间轴上的全部分段块，重置为 1 个空白段。
     用户明确：不删已生成的成片文件，只清分段配置（初版"清空成片"理解错了需求，后端
     clear_outputs 路由保留但 UI 不再调用）。
     两段式确认（第一次点变红"再点确认"），不用 confirm()（内嵌浏览器静默拦截）。 */
  const btnClearOut = mk("button", "h3s-btn", "清空分段");
  btnClearOut.title = "删除当前界面的全部分段，重置为 1 个空白段（不删除已生成的视频文件）";
  let clearArmed = false;
  const disarmClear = () => {
    clearArmed = false;
    btnClearOut.textContent = "清空分段";
    btnClearOut.style.background = "";
    btnClearOut.style.borderColor = "";
  };
  btnClearOut.addEventListener("click", () => {
    if (!clearArmed) {
      clearArmed = true;
      btnClearOut.textContent = "再点确认删除当前界面全部 " + segs.length + " 段";
      btnClearOut.style.background = "#8a2f2f";
      btnClearOut.style.borderColor = "#c05555";
      return;
    }
    disarmClear();
    if (curMode() === "create") backupActiveCreateProject();
    /* 原地重置为 1 个该界面的默认段（segs 是指向数据集的引用，不能重新赋值） */
    const fresh = curMode() === "text"
      ? defaultTextSegs()[0]
      : JSON.parse(JSON.stringify(defaultSegs()[0]));
    segs.length = 0;
    segs.push(fresh);
    if (curMode() === "create") createTimelineVideos = [];
    sel = 0;
    clearBoxSel();
    save(); renderTimeline(); renderEditor();
    status.textContent = "已清空分段，重置为 1 个空白段（成片文件保留在 output 目录，未被删除）";
  });
  segmentGroup.insertBefore(btnClearOut, allSelectionToggle);
  allSelectionInput.addEventListener("change", () => setAllCurrentSegmentsEnabled(allSelectionInput.checked));
  allTailInput.addEventListener("change", () => {
    for (let index = 1; index < segs.length; index += 1) {
      setSegmentPreviousTail(segs[index], allTailInput.checked);
    }
    save(); renderTimeline(); renderEditor();
    status.textContent = allTailInput.checked
      ? "当前页面第2段以后已全部续接上段尾帧"
      : "当前页面第2段以后已全部取消续接尾帧";
  });

  const timelineClipsAtGap = (gap) => curMode() === "create"
    ? createTimelineVideos.filter((clip) => clip.gap === gap) : [];
  const timelineVideoUrl = (clip) => api.apiURL("/h3director/timeline_video?" + new URLSearchParams({
    project_id: ensureProjectId(),
    name: clip.name,
    t: Date.now(),
  }).toString());
  let timelineVideoPickerGap = 0;
  const timelineVideoPicker = document.createElement("input");
  timelineVideoPicker.type = "file";
  timelineVideoPicker.accept = ".mp4,.webm,.mov,.mkv,.avi,video/*";
  timelineVideoPicker.multiple = true;
  timelineVideoPicker.style.display = "none";
  box.appendChild(timelineVideoPicker);
  const uploadCreateTimelineVideos = async (files, gap) => {
    let added = 0;
    const errors = [];
    for (const file of files || []) {
      if (!/\.(?:mp4|webm|mov|mkv|avi)$/i.test(file.name || "")) {
        errors.push("不支持 " + (file.name || "该文件"));
        continue;
      }
      const data = new FormData();
      data.append("project_id", ensureProjectId());
      data.append("video", file, file.name);
      try {
        const response = await api.fetchApi("/h3director/upload_timeline_video", { method: "POST", body: data });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
        createTimelineVideos.push({
          name: result.name,
          label: result.label || file.name,
          duration: Number(result.duration) || 0.001,
          gap,
        });
        added += 1;
      } catch (error) {
        errors.push((file.name || "视频") + "：" + error.message);
      }
    }
    createTimelineVideos = normalizeCreateTimelineVideos(createTimelineVideos, createSegs.length);
    save();
    renderTimeline();
    status.style.color = errors.length ? "#ffb0a8" : "";
    status.textContent = added
      ? `已在时间线插入 ${added} 个视频` + (errors.length ? "；" + errors.join("；") : "")
      : (errors.join("；") || "没有可插入的视频");
  };
  timelineVideoPicker.addEventListener("change", async () => {
    const files = Array.from(timelineVideoPicker.files || []);
    timelineVideoPicker.value = "";
    if (!files.length) return;
    status.style.color = "";
    status.textContent = "正在把视频复制到当前导演台项目…";
    await uploadCreateTimelineVideos(files, timelineVideoPickerGap);
  });
  const deleteCreateTimelineVideo = async (clip) => {
    const response = await api.fetchApi("/h3director/delete_timeline_video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: ensureProjectId(), name: clip.name }),
    });
    const result = await response.json();
    if (!response.ok && response.status !== 404) throw new Error(result.error || ("HTTP " + response.status));
    createTimelineVideos = createTimelineVideos.filter((item) => item.name !== clip.name);
    save();
    renderTimeline();
    status.style.color = "";
    status.textContent = "已删除时间线插入视频（原始文件不受影响）";
  };

  function updateTotal() {
    const on = segs.filter((s) => s.enabled).length;
    const inserted = curMode() === "create"
      ? createTimelineVideos.reduce((sum, clip) => sum + Number(clip.duration || 0), 0) : 0;
    const total = segs.reduce((a, s) => a + segDur(s), 0) + inserted;
    const clipText = curMode() === "create" && createTimelineVideos.length
      ? ` · 插入视频 ${createTimelineVideos.length}` : "";
    totalLab.textContent = `共 ${segs.length} 段 · 启用 ${on}${clipText} · 总 ${fmtSec(total)}s`;
  }

  function updateTimelineLabels() {
    updateTotal();
    let acc = 0;
    for (let gap = 0; gap <= segs.length; gap++) {
      for (const clip of timelineClipsAtGap(gap)) {
        const start = acc;
        acc += Number(clip.duration) || 0;
        const card = Array.from(tl.querySelectorAll(".h3s-insert-video"))
          .find((element) => element.dataset.clipName === clip.name);
        if (card) {
          const label = card.querySelector(".lab");
          const duration = card.querySelector(".dur");
          if (label) label.textContent = clip.label;
          if (duration) duration.textContent = `${fmtSec(start)}-${fmtSec(acc)}s · ${fmtSec(clip.duration)}s`;
        }
      }
      if (gap >= segs.length) continue;
      const segment = segs[gap];
      const duration = segDur(segment);
      const start = acc;
      acc += duration;
      const slot = tl.querySelector(`.h3s-slot[data-idx="${gap}"]`);
      if (!slot) continue;
      const label = slot.querySelector(".lab");
      const durationLabel = slot.querySelector(".dur");
      if (label) label.textContent = `${createSegmentLabel(segment, gap)} · ${fmtSec(start)}-${fmtSec(acc)}s`;
      if (durationLabel) durationLabel.textContent = `${fmtSec(duration)}s`;
    }
  }

  const moveTimelineVideo = (clipName, gap, beforeName = "") => {
    createTimelineVideos = moveCreateTimelineVideo(
      createTimelineVideos, clipName, gap, createSegs.length, beforeName);
    save();
    renderTimeline();
    status.style.color = "";
    status.textContent = "已移动插入视频的位置；最终合成将按当前时间线顺序执行";
  };
  const wireTimelineVideoMoveTarget = (element, gap, beforeName = "") => {
    element.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer && event.dataTransfer.types || [])
        .includes("application/x-h3-timeline-video")) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      element.classList.add("timeline-video-drop");
    });
    element.addEventListener("dragleave", () => element.classList.remove("timeline-video-drop"));
    element.addEventListener("drop", (event) => {
      const clipName = event.dataTransfer.getData("application/x-h3-timeline-video");
      if (!clipName) return;
      event.preventDefault(); event.stopPropagation();
      element.classList.remove("timeline-video-drop");
      moveTimelineVideo(clipName, gap, beforeName);
    });
  };
  const moveTimelineSegment = async (sourceSegment, beforeItem) => {
    if (curMode() !== "create") return;
    if (createProjectOperationBusy()) {
      status.style.color = "#e8bd68";
      status.textContent = "等待当前生成、合并或成片切换完成后即可移动段";
      return;
    }
    flushScheduledSave();
    save();
    const planned = moveCreateTimelineSegment(
      createSegs, createTimelineVideos, sourceSegment, beforeItem);
    const currentOrder = createSegs.map((_segment, index) => index + 1);
    const orderChanged = planned.order.some((value, index) => value !== currentOrder[index]);
    const videosChanged = JSON.stringify(planned.videos) !== JSON.stringify(createTimelineVideos);
    if (!orderChanged && !videosChanged) return;

    const selectedSegment = sel + 1;
    reorderingCreateSegments = true;
    syncCreateProjectControls();
    status.style.color = "";
    status.textContent = "正在调整创作时间线顺序…";
    try {
      if (orderChanged) {
        for (const video of box.querySelectorAll("video")) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
        const response = await api.fetchApi("/h3director/reorder_segments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: ensureProjectId(), order: planned.order }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
      }
      createSegs = planned.segments;
      segs = createSegs;
      createTimelineVideos = planned.videos;
      sel = Math.max(0, planned.order.indexOf(selectedSegment));
      clearBoxSel();
      projectStatusCache.clear();
      projectStatusInflight.clear();
      save();
      status.style.color = "#8ee6a0";
      status.textContent = "已调整段顺序；提示词、参考、音色、尾帧、历史视频和最终合并关系已随段移动";
    } catch (error) {
      status.style.color = "#ff8080";
      status.textContent = "移动段失败：" + error.message;
    } finally {
      reorderingCreateSegments = false;
      syncCreateProjectControls();
      renderTimeline(true);
      renderEditor();
    }
  };
  const wireTimelineSegmentMoveTarget = (element, beforeItem) => {
    element.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer && event.dataTransfer.types || [])
        .includes("application/x-h3-timeline-segment")) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      element.classList.add("timeline-video-drop");
    });
    element.addEventListener("dragleave", () => element.classList.remove("timeline-video-drop"));
    element.addEventListener("drop", (event) => {
      const sourceSegment = Number(
        event.dataTransfer.getData("application/x-h3-timeline-segment"));
      if (!Number.isInteger(sourceSegment) || sourceSegment < 1) return;
      event.preventDefault(); event.stopPropagation();
      element.classList.remove("timeline-video-drop");
      void moveTimelineSegment(sourceSegment, beforeItem);
    });
  };

  function renderTimeline(forceStatus = false) {
    tl.innerHTML = "";
    syncAllSelectionToggle();
    createTimelineVideos = normalizeCreateTimelineVideos(createTimelineVideos, createSegs.length);
    updateTotal();
    trackV.style.display = "";
    timelineNote.textContent = curMode() === "create"
      ? "段卡内勾选启用与尾帧 · 点重抽只跑当段 · 点击二采标记开关当段二采 · 双击段卡改名 · 拖动段卡换位 · 拖右边缘改时长 · 点击卡片间空隙添加视频"
      : "段卡内勾选启用与尾帧 · 点重抽只跑当段 · 点击切换当前段 · 拖右边缘改时长 · 空白处拖框可批量选择";
    const createTimeline = curMode() === "create";
    timelineActions.classList.toggle("create", createTimeline);
    btnRerollAll.style.display = "";
    btnRerollAll.disabled = busy || !segs.some((segment) => segment.enabled !== false);

    const appendTimelineClip = (clip) => {
      const card = mk("div", "h3s-insert-video");
      card.dataset.clipName = clip.name;
      card.draggable = true;
      card.title = "外部插入视频：可拖到另一个卡片间空隙重新定位";
      const preview = document.createElement("video");
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = "metadata";
      preview.src = timelineVideoUrl(clip);
      preview.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(preview.duration) && preview.duration > 0.2) preview.currentTime = Math.min(0.2, preview.duration / 4);
      }, { once: true });
      const label = mk("span", "lab", clip.label);
      const duration = mk("span", "dur", `${fmtSec(clip.duration)}s`);
      const remove = mk("button", "delete", "×");
      remove.title = "从导演台项目删除这个插入视频（原始文件不受影响）";
      remove.addEventListener("click", async (event) => {
        event.preventDefault(); event.stopPropagation();
        remove.disabled = true;
        preview.pause();
        preview.removeAttribute("src");
        preview.load();
        try { await deleteCreateTimelineVideo(clip); }
        catch (error) {
          remove.disabled = false;
          preview.src = timelineVideoUrl(clip);
          status.style.color = "#ff8080";
          status.textContent = "删除插入视频失败：" + error.message;
        }
      });
      card.addEventListener("dragstart", (event) => {
        card.classList.add("dragging");
        event.dataTransfer.setData("application/x-h3-timeline-video", clip.name);
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      wireTimelineVideoMoveTarget(card, clip.gap, clip.name);
      wireTimelineSegmentMoveTarget(card, { kind: "timeline_video", name: clip.name });
      card.append(preview, label, duration, remove);
      tl.appendChild(card);
    };
    const appendTimelineDrop = (gap) => {
      if (curMode() !== "create") return;
      const drop = mk("div", "h3s-timeline-drop");
      drop.title = "点击卡片间空隙选择本地视频；拖入文件或段/视频卡时显示插入线";
      drop.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        timelineVideoPickerGap = gap;
        timelineVideoPicker.value = "";
        timelineVideoPicker.click();
      });
      drop.addEventListener("dragover", (event) => {
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types || []).includes("Files") ? "copy" : "move";
        drop.classList.add("drop");
      });
      drop.addEventListener("dragleave", () => drop.classList.remove("drop"));
      drop.addEventListener("drop", async (event) => {
        event.preventDefault(); event.stopPropagation();
        drop.classList.remove("drop");
        const clipName = event.dataTransfer.getData("application/x-h3-timeline-video");
        if (clipName) {
          moveTimelineVideo(clipName, gap);
          return;
        }
        const sourceSegment = Number(
          event.dataTransfer.getData("application/x-h3-timeline-segment"));
        if (Number.isInteger(sourceSegment) && sourceSegment >= 1) {
          void moveTimelineSegment(sourceSegment,
            gap < createSegs.length ? { kind: "segment", segment: gap + 1 } : { kind: "end" });
          return;
        }
        const files = Array.from(event.dataTransfer.files || []);
        if (!files.length) return;
        status.style.color = "";
        status.textContent = "正在把视频复制到当前导演台项目…";
        await uploadCreateTimelineVideos(files, gap);
      });
      tl.appendChild(drop);
    };

    for (let gap = 0; gap <= segs.length; gap++) {
      for (const clip of timelineClipsAtGap(gap)) appendTimelineClip(clip);
      appendTimelineDrop(gap);
      if (gap >= segs.length) continue;
      const s = segs[gap];
      const i = gap;
      const dur = segDur(s);
      const secondSample = normalizeH3SecondSample(s.second_sample, s);
      const secondSampleEnabled = secondSample.mode !== "off";
      const secondSampleRestore = normalizeH3SecondSample(s.second_sample_restore, s);
      const secondSampleToggleVisible = secondSampleEnabled || secondSampleRestore.mode !== "off";
      const slot = mk("div", "h3s-slot" + (i === sel ? " sel" : "")
        + (boxSel.has(i) ? " boxsel" : "") + (secondSampleEnabled ? " second-sample" : ""));
      slot.classList.toggle("segment-disabled", s.enabled === false);
      slot.dataset.idx = i;
      slot.style.width = SLOT_W + "px";
      slot.draggable = curMode() === "create";
      slot.title = curMode() === "create" ? "拖动整段调整创作时间线顺序；双击修改段名称" : "";
      wireTimelineVideoMoveTarget(slot, gap);
      wireTimelineSegmentMoveTarget(slot, { kind: "segment", segment: i + 1 });
      slot.addEventListener("dragstart", (event) => {
        if (curMode() !== "create" || createProjectOperationBusy()) {
          event.preventDefault();
          return;
        }
        slot.classList.add("dragging");
        event.dataTransfer.setData("application/x-h3-timeline-segment", String(i + 1));
        event.dataTransfer.effectAllowed = "move";
      });
      slot.addEventListener("dragend", () => slot.classList.remove("dragging"));
      const img = document.createElement("img");
      img.loading = "lazy";
      img.hidden = true;
      img.onerror = () => { img.style.display = "none"; };
      slot.appendChild(img);
      slot.appendChild(mk("span", "lab", createSegmentLabel(s, i)));
      const enabledToggle = mk("label", "h3s-slot-enable");
      enabledToggle.title = `启用或停用段${i + 1}；停用只会让运行跳过本段，不删除提示词、设置或历史成片`;
      const enabledCheckbox = document.createElement("input");
      enabledCheckbox.type = "checkbox";
      enabledCheckbox.checked = s.enabled !== false;
      enabledCheckbox.setAttribute("aria-label", `启用段${i + 1}`);
      const enabledText = mk("span", null, enabledCheckbox.checked ? "启用" : "停用");
      enabledToggle.append(enabledCheckbox, enabledText);
      enabledToggle.addEventListener("pointerdown", (event) => event.stopPropagation());
      enabledToggle.addEventListener("click", (event) => event.stopPropagation());
      enabledToggle.addEventListener("dblclick", (event) => event.stopPropagation());
      enabledToggle.addEventListener("dragstart", (event) => event.preventDefault());
      enabledCheckbox.addEventListener("change", () => {
        s.enabled = enabledCheckbox.checked;
        save();
        renderTimeline();
        renderEditor();
        syncSecondSamplePanel();
        status.style.color = "";
        status.textContent = `段${i + 1}已${s.enabled ? "启用" : "停用"}；内容、设置和历史成片均保留`;
      });
      slot.appendChild(enabledToggle);
      const tailToggle = mk("label", "h3s-slot-tail" + (i === 0 ? " unavailable" : ""));
      const tailCheckbox = document.createElement("input");
      tailCheckbox.type = "checkbox";
      tailCheckbox.checked = i > 0 && s.use_tail !== false;
      tailCheckbox.disabled = i === 0;
      tailCheckbox.setAttribute("aria-label", `段${i + 1}续接上段尾帧`);
      tailToggle.title = i === 0
        ? "段1没有上一段尾帧"
        : curMode() === "create"
          ? `把段${i}真实尾帧作为段${i + 1}的 Ref2VA 软参考`
          : `把段${i}真实尾帧作为段${i + 1}的 FL2VA 硬首帧`;
      tailToggle.append(tailCheckbox, mk("span", null, "尾帧"));
      for (const eventName of ["pointerdown", "click", "dblclick"]) {
        tailToggle.addEventListener(eventName, (event) => event.stopPropagation());
      }
      tailToggle.addEventListener("dragstart", (event) => event.preventDefault());
      tailCheckbox.addEventListener("change", () => {
        setSegmentPreviousTail(s, tailCheckbox.checked);
        s.tail_plan = "manual";
        s.tail_reason = "用户在时间线段卡手动设置";
        save(); renderTimeline(); renderEditor();
        status.style.color = "";
        status.textContent = tailCheckbox.checked
          ? `段${i + 1}已续接段${i}尾帧`
          : `段${i + 1}已取消续接上段尾帧`;
      });
      slot.appendChild(tailToggle);
      if (secondSampleToggleVisible) {
        const secondBadge = mk("button", "second" + (secondSampleEnabled ? "" : " disabled"), "二采");
        secondBadge.type = "button";
        secondBadge.setAttribute("aria-pressed", secondSampleEnabled ? "true" : "false");
        secondBadge.title = secondSampleEnabled
          ? `高分辨率修复已开启：一采约${secondSample.first_megapixels}MP · ${secondSample.steps}步 · denoise ${secondSample.denoise}${secondSample.save_comparison ? " · 保存一采对比" : ""}；点击只关闭段${i + 1}`
          : `二采已关闭；点击恢复段${i + 1}上一次的${secondSampleRestore.mode}设置`;
        secondBadge.addEventListener("pointerdown", (event) => event.stopPropagation());
        secondBadge.addEventListener("dragstart", (event) => event.preventDefault());
        secondBadge.addEventListener("dblclick", (event) => {
          event.preventDefault(); event.stopPropagation();
        });
        secondBadge.addEventListener("click", (event) => {
          event.preventDefault(); event.stopPropagation();
          if (busy || createProjectOperationBusy()) {
            status.style.color = "#ffb36b";
            status.textContent = "当前任务进行中，完成后再切换二采。";
            return;
          }
          const enabled = toggleH3SegmentSecondSample(s);
          save();
          renderTimeline();
          refreshSecondPanelInputs();
          status.style.color = "";
          status.textContent = enabled
            ? `段${i + 1}二采已恢复：${normalizeH3SecondSample(s.second_sample).mode}`
            : `段${i + 1}二采已关闭；点击灰色“二采”可恢复`;
        });
        slot.appendChild(secondBadge);
      }
      const reroll = mk("button", "h3s-slot-reroll", "重抽");
      reroll.type = "button";
      reroll.disabled = busy || s.enabled === false;
      reroll.title = s.enabled === false
        ? `段${i + 1}已停用，请先勾选启用再重抽`
        : `只给段${i + 1}换新种子并重新生成；其它段和旧视频保留，完成后自动重新合并`;
      reroll.addEventListener("pointerdown", (event) => event.stopPropagation());
      reroll.addEventListener("dblclick", (event) => {
        event.preventDefault(); event.stopPropagation();
      });
      reroll.addEventListener("dragstart", (event) => event.preventDefault());
      reroll.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        if (busy || s.enabled === false) return;
        sel = i;
        void run(false, [i], "single");
      });
      slot.appendChild(reroll);
      /* 时长标签可点选——三个页面共用 H3 原生 2~15 秒整数选择器。
         slot 是 overflow:hidden，弹层必须挂 body 用 fixed 定位；点外部自动关闭 */
      const durLab = mk("span", "dur pickable", `${fmtSec(dur)}s`);
      durLab.title = "点选本段时长（H3 原生范围 2~15 秒；三个页面一致）";
      durLab.addEventListener("click", (ev) => {
        ev.stopPropagation();
        document.querySelectorAll(".h3s-durpick").forEach((e) => e.remove());
        const pick = mk("div", "h3s-durpick");
        const _bd = manualBounds();
        for (let sec = _bd[0]; sec <= _bd[1]; sec++) {
          const b = mk("button", sec === dur ? "cur" : null, sec + "s");
          b.addEventListener("click", (e2) => {
            e2.stopPropagation();
            s.duration = sec;
            pick.remove();
            save(); updateTimelineLabels(); renderEditor();
          });
          pick.appendChild(b);
        }
        document.body.appendChild(pick);
        pick.style.left = Math.max(8, Math.min(ev.clientX - 10, window.innerWidth - pick.offsetWidth - 12)) + "px";
        pick.style.top = Math.max(8, Math.min(ev.clientY + 8, window.innerHeight - pick.offsetHeight - 12)) + "px";
        const close = (e3) => {
          if (!pick.contains(e3.target)) { pick.remove(); document.removeEventListener("pointerdown", close, true); }
        };
        document.addEventListener("pointerdown", close, true);
      });
      slot.appendChild(durLab);
      slot.addEventListener("click", () => {
        clearBoxSel();
        sel = i;
        Array.from(tl.querySelectorAll(".h3s-slot")).forEach((child) => {
          child.classList.toggle("sel", Number(child.dataset.idx) === sel);
          child.classList.remove("boxsel");
        });
        renderEditor();
      });
      slot.addEventListener("dblclick", (event) => {
        if (curMode() !== "create" || event.target.closest(".rz, .dur, .second, .h3s-slot-enable, .h3s-slot-tail, .h3s-slot-reroll")) return;
        event.preventDefault();
        event.stopPropagation();
        if (slot.querySelector(".h3s-slot-name-input")) return;

        const label = slot.querySelector(".lab");
        const nameInput = mk("input", "h3s-slot-name-input");
        nameInput.type = "text";
        nameInput.maxLength = 40;
        nameInput.value = normalizeCreateSegmentName(s.display_name);
        nameInput.placeholder = "段名称";
        const restoreDraggable = slot.draggable;
        let closed = false;
        const finish = (commit) => {
          if (closed) return;
          closed = true;
          if (commit) {
            s.display_name = normalizeCreateSegmentName(nameInput.value);
            if (!s.display_name) delete s.display_name;
            save();
            updateTimelineLabels();
          }
          nameInput.remove();
          if (label) label.hidden = false;
          slot.draggable = restoreDraggable;
          if (commit && i === sel) renderEditor();
        };

        slot.draggable = false;
        if (label) label.hidden = true;
        nameInput.addEventListener("pointerdown", (inputEvent) => inputEvent.stopPropagation());
        nameInput.addEventListener("click", (inputEvent) => inputEvent.stopPropagation());
        nameInput.addEventListener("dblclick", (inputEvent) => inputEvent.stopPropagation());
        nameInput.addEventListener("dragstart", (inputEvent) => inputEvent.preventDefault());
        nameInput.addEventListener("keydown", (inputEvent) => {
          inputEvent.stopPropagation();
          if (inputEvent.key === "Enter") {
            inputEvent.preventDefault();
            finish(true);
          } else if (inputEvent.key === "Escape") {
            inputEvent.preventDefault();
            finish(false);
          }
        });
        nameInput.addEventListener("blur", () => finish(true));
        slot.appendChild(nameInput);
        nameInput.focus();
        nameInput.select();
      });

      /* 右缘拖拽柄：拖动调整本段时长 */
      const rz = mk("div", "rz");
      rz.title = "拖拽调整时长";
      rz.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const startX = ev.clientX;
        const startDur = segDur(s);
        const sc = canvasScale();
        slot.classList.add("dragging");
        const onMove = (e2) => {
          const d = (e2.clientX - startX) / sc / DRAG_PX_PER_SEC;
          s.duration = clampManual(startDur + d);
          updateTimelineLabels();
          if (durInput && i === sel) durInput.value = String(s.duration);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          updateTimelineLabels();
          save();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      rz.addEventListener("click", (ev) => ev.stopPropagation());
      slot.appendChild(rz);

      tl.appendChild(slot);
    }
    updateTimelineLabels();
    markDone(forceStatus);
  }

  async function markDone(force = false) {
    const requestedKey = _modeQ();
    try {
      const st = await fetchProjectStatus({ force });
      if (requestedKey !== _modeQ()) return;
      /* 前后端版本自诊断：后端是旧进程（未重启）或无版本字段时红字提醒 */
      if (st.version !== H3S_VERSION) {
        status.textContent = "⚠ 后端代码过旧（" + (st.version || "无版本号") + " ≠ 前端 " + H3S_VERSION + "），请完全重启 ComfyUI 再 Ctrl+F5";
        status.style.color = "#ff8080";
      } else if (status.style.color) {
        status.style.color = "";
      }
      segs.forEach((s, i) => {
        const slot = tl.querySelector(`.h3s-slot[data-idx="${i}"]`);
        if (!slot) return;
        const info = st.segments[String(i + 1)];
        slot.classList.toggle("done", !!(info && info.video));
        const img = slot.querySelector("img");
        if (img && info && info.tail) {
          const stamp = info.tail_mtime || info.mtime || 1;
          const src = api.apiURL("/h3director/tail?seg=" + (i + 1) + "&" + requestedKey + "&t=" + stamp);
          if (img.dataset.src !== src) {
            img.dataset.src = src;
            img.src = src;
          }
          img.hidden = false;
          img.style.display = "";
        } else if (img) {
          img.hidden = true;
          img.removeAttribute("src");
          delete img.dataset.src;
        }
      });
      if (st.merged && st.merged.exists) {
        mergedMtime = st.merged.mtime || Date.now();
        mergedName = st.merged.name || "";
        btnViewMerge.disabled = false;
        btnSendMergeUpscale.disabled = !mergedName;
      } else {
        mergedName = "";
        btnViewMerge.disabled = true;
        btnSendMergeUpscale.disabled = true;
      }
    } catch (e) { /* 状态接口不可用时忽略 */ }
  }

  /* 根据当前开关计算 Picture 编号引用提示 */
  function picHintText(s, idx) {
    let n = 1;
    const parts = [];
    if (s.use_tail !== false && idx > 0) {
      parts.push(`Picture ${n}=上段尾帧`);
      n += 1;
    }
    parts.push(`Picture ${n}+=本段参考图`);
    return parts.join(", ") + "。可直接输入提示词；输入 @ 或点下方 @ 选择资产，插件会保留资产编号并插入 <Picture N>/<Audio N>。";
  }

  /* ================= 视频界面（v2.1 独立整版）=================
     布局参考 WhatDreamsCost：上方参考视频大缩略图（点击即播放预览），
     下方参考照片（外观），底部成片预览。动作/运镜/节奏跟 <Video N>，
     外观跟 <Picture N>（后端自动追加官方 reference 声明）。 */
  /* ================= 视频界面（v2.4 重做第一步：加载视频）=================
     参考 WhatDreamsCost Load Video：拖视频进来（或点选）即加载并播放预览。
     与创作界面数据完全独立（vsegments_json），产出文件名也独立（漫剧v_）。 */
  /* ================= 视频界面（v2.5 WDC 布局）=================
     自上而下：①视频和图片 ②音频（波形）③参考视频 ④播放键 ⑤底部提示词。
     数据独立（vsegments_json）：图片→refs（<Picture N>），视频→video_refs（<Video 1~3>），
     音频→audio+audio_src=ref（参考音频驱动，口型原生同步）。 */
  function renderVideoEditor(s) {
    if (!Array.isArray(s.refs)) s.refs = [];
    if (!Array.isArray(s.video_refs)) s.video_refs = [];
    if (!s.video_labels) s.video_labels = {};
    if (!s.video_ref_modes || typeof s.video_ref_modes !== "object" || Array.isArray(s.video_ref_modes)) {
      s.video_ref_modes = {};
    }

    /* 底部提示词（先建后挂，各区块的 P/V 标点击插入） */
    const vta = document.createElement("textarea");
    vta.className = "h3s-ta";
    vta.value = s.prompt || "";
    vta.placeholder = "提示词：描述外观 / 风格 / 剧情（动作和运镜会跟随参考视频）。点区块上的 P / V 标可插入 <Picture N> / <Video N>";
    vta.addEventListener("input", () => { s.prompt = vta.value; scheduleSave(); });
    wireAssetMentionPicker(vta, () => {
      const seen = new Set();
      return [...createGlobalAssetLibrary(), ...uploadedAssetCatalog(videoSegs)].filter((asset) => {
        if (!asset.file || seen.has(asset.file)) return false;
        seen.add(asset.file);
        return true;
      });
    }, (asset, mention, replace) => {
      if (!s.refs.includes(asset.file)) {
        s.refs.push(asset.file);
      }
      const number = s.refs.indexOf(asset.file) + 1 + (s.use_tail !== false && sel > 0 ? 1 : 0);
      replace(`${asset.name} <Picture ${number}>`);
      s.prompt = vta.value;
      save();
      status.textContent = `已把 ${asset.asset_id} ${asset.name} 加入当前视频段，并插入 <Picture ${number}>`;
    });
    const insertV = (tag) => {
      const st = vta.selectionStart != null ? vta.selectionStart : vta.value.length;
      vta.value = vta.value.slice(0, st) + tag + vta.value.slice(st);
      s.prompt = vta.value; save();
      vta.focus();
      vta.selectionStart = vta.selectionEnd = st + tag.length;
    };

    /* 三个上传器 */
    const upImage = async (f) => {
      const fd = new FormData();
      fd.append("image", f, f.name);
      fd.append("overwrite", "true");
      const r = await (await api.fetchApi("/upload/image", { method: "POST", body: fd })).json();
      s.refs.push((r.subfolder ? r.subfolder + "/" : "") + r.name);
    };
    const upAudio = async (f) => {
      const fd = new FormData();
      fd.append("audio", f, f.name);
      const r = await (await api.fetchApi("/h3director/upload_audio", { method: "POST", body: fd })).json();
      if (!(r.ok && r.name)) throw new Error(r.error || "上传失败");
      s.audio = r.name;
      s.audio_label = r.label || f.name;
      s.audio_src = "ref";  // 视频界面的音频=参考音频驱动（对口型）
    };
    const upVideo = async (f, replaceIndex = null) => {
      if (replaceIndex == null && s.video_refs.length >= 3) {
        status.textContent = "每段最多添加 3 个参考视频，其余文件未导入";
        return false;
      }
      const fd = new FormData();
      fd.append("video", f, f.name);
      const r = await (await api.fetchApi("/h3director/upload_video", { method: "POST", body: fd })).json();
      if (!(r.ok && r.name)) throw new Error(r.error || "上传失败");
      if (replaceIndex == null) {
        s.video_refs.push(r.name);
        s.video_ref_modes[r.name] = "comprehensive";
      } else {
        const oldName = s.video_refs[replaceIndex];
        const oldMode = s.video_ref_modes[oldName] || "comprehensive";
        s.video_refs[replaceIndex] = r.name;
        s.video_ref_modes[r.name] = oldMode;
        if (!s.video_refs.includes(oldName)) delete s.video_ref_modes[oldName];
      }
      s.video_labels[r.name] = r.label || f.name;
    };
    /* 拖放/点选 通用接线 */
    const wireDrop = (zone, acceptRe, handler) => {
      zone.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.stopPropagation(); zone.classList.add("drop"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
      zone.addEventListener("drop", async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        zone.classList.remove("drop");
        const files = ev.dataTransfer && ev.dataTransfer.files;
        if (!files || !files.length) return;
        status.textContent = "正在加载…";
        try {
          for (const f of files) {
            if (!acceptRe.test(f.name)) { status.textContent = "不支持的文件: " + f.name; continue; }
            await handler(f);
          }
          save(); renderEditor();
          status.textContent = "加载完成";
        } catch (e) { status.textContent = "加载失败: " + e.message; }
      });
    };
    const pickFiles = (accept, multiple, handler) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = accept;
      if (multiple) inp.multiple = true;
      inp.addEventListener("change", async () => {
        if (!inp.files.length) return;
        status.textContent = "正在加载…";
        try {
          for (const f of inp.files) await handler(f);
          save(); renderEditor();
          status.textContent = "加载完成";
        } catch (e) { status.textContent = "加载失败: " + e.message; }
      });
      inp.click();
    };

    /* ======== ⓪ 段信息行（启用/停用统一在时间线段卡操作）======== */
    const row0 = mk("div", "h3s-row");
    row0.appendChild(mk("b", null, `段 ${sel + 1}`));
    row0.appendChild(mk("span", "h3s-hint", "启用/停用请在上方时间线段卡勾选"));
    row0.appendChild(mk("span", "h3s-hint", "时长（秒）："));
    const durW = node.widgets.find((w) => w.name === "时长秒");  // 节点默认值（新建段用）
    const din = mk("input", "h3s-durinput");
    din.type = "number";
    din.step = "1";
    din.min = "2";
    din.max = "15";
    din.value = String(segDur(s));
    din.title = "本段时长（整数秒；每段独立；也可在时间轴上拖段块右缘调整）。H3 原生范围 " + manualBounds()[0] + "~" + manualBounds()[1] + "s，三个页面一致";
    din.addEventListener("change", () => {
      s.duration = clampManual(Number(din.value) || segDur(s));
      din.value = String(s.duration);
      save(); renderTimeline();
    });
    /* 显式 − / ＋ 步进按钮（v2.10.17）：内嵌浏览器里数字框的原生上下箭头
       会被面板层挡住点不中，用户实测"箭头调不了" */
    const stepDur = (d) => {
      s.duration = clampManual((Number(din.value) || segDur(s)) + d);
      din.value = String(s.duration);
      save(); renderTimeline();
    };
    const btnMinus = mk("button", "h3s-btn", "\u2212");
    const btnPlus = mk("button", "h3s-btn", "\uff0b");
    btnMinus.title = btnPlus.title = "\u6bcf\u6b21 1 \u79d2";
    btnMinus.addEventListener("click", () => stepDur(-1));
    btnPlus.addEventListener("click", () => stepDur(1));
    row0.appendChild(din);
    row0.appendChild(btnMinus);
    row0.appendChild(btnPlus);
    /* 段级分辨率（v2.8）：每段视频尺寸不同；留空=跟随节点宽高；"按视频"自动匹配参考视频 */
    row0.appendChild(mk("span", "h3s-hint", "分辨率"));
    const snap32 = (v) => Math.max(256, Math.min(1920, Math.round(v / 32) * 32));
    const wIn = mk("input", "h3s-durinput");
    const hIn = mk("input", "h3s-durinput");
    for (const pair of [[wIn, "width", "宽"], [hIn, "height", "高"]]) {
      const inp = pair[0], key = pair[1];
      inp.type = "number";
      inp.step = "32";
      inp.min = "256";
      inp.max = "1920";
      inp.value = s[key] ? String(s[key]) : "";
      inp.placeholder = pair[2];
      inp.title = "留空=跟随节点宽高；改动自动取整到 32 的倍数";
      inp.addEventListener("change", () => {
        if (inp.value === "") { delete s[key]; }
        else { s[key] = snap32(Number(inp.value) || 0); inp.value = String(s[key]); }
        save();
      });
    }
    const btnFit = mk("button", "h3s-btn", "按视频");
    btnFit.title = "自动读取参考视频的尺寸并取整到 32 的倍数（竖屏视频必点）";
    btnFit.addEventListener("click", () => {
      const cur = (s.video_refs || [])[0];
      if (!cur) { status.textContent = "先在下方加载参考视频"; return; }
      const tv = document.createElement("video");
      tv.preload = "metadata";
      tv.src = api.apiURL("/view?filename=" + encodeURIComponent(cur) + "&type=input");
      tv.addEventListener("loadedmetadata", () => {
        s.width = snap32(tv.videoWidth);
        s.height = snap32(tv.videoHeight);
        wIn.value = String(s.width);
        hIn.value = String(s.height);
        save();
        status.textContent = "分辨率已匹配参考视频：" + tv.videoWidth + "x" + tv.videoHeight + " → " + s.width + "x" + s.height;
      });
      tv.addEventListener("error", () => { status.textContent = "读取视频尺寸失败"; });
    });
    row0.appendChild(wIn);
    row0.appendChild(mk("span", "h3s-hint", "×"));
    row0.appendChild(hIn);
    row0.appendChild(btnFit);
    /* 种子（v2.9.2）：-1=每次随机；🎲 固定一个随机种子复刻同款 */
    row0.appendChild(mk("span", "h3s-hint", "种子"));
    const seedModeSel = mk("select", "h3s-seedmode");
    [["current", "当段随机"], ["all_diff", "全段各自随机"], ["all_same", "全段统一随机"]].forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt[0];
      o.textContent = opt[1];
      seedModeSel.appendChild(o);
    });
    seedModeSel.value = node.properties.h3_seed_mode || "current";
    seedModeSel.title = "🎲 随机范围：当段=只随机当前段；全段各自=每段一个不同新种子；全段统一=所有段用同一个新种子";
    seedModeSel.addEventListener("change", () => {
      node.properties.h3_seed_mode = seedModeSel.value;
      save();
    });
    const seedIn = mk("input", "h3s-seed");
    seedIn.type = "number";
    seedIn.value = String(s.seed != null ? s.seed : -1);
    seedIn.placeholder = "-1=随机";
    seedIn.title = "-1=每次随机；填固定值=复刻同款结果";
    seedIn.addEventListener("change", () => {
      s.seed = Number(seedIn.value);
      save();
    });
    const btnDice = mk("button", "h3s-btn", "🎲");
    btnDice.title = "按左侧选择的范围随机种子";
    btnDice.addEventListener("click", () => {
      const mode = node.properties.h3_seed_mode || "current";
      if (mode === "all_diff") {
        segs.forEach((seg) => { seg.seed = Math.floor(Math.random() * 1e15); });
        seedIn.value = String(s.seed);
        status.textContent = "全部 " + segs.length + " 段已各自随机新种子";
      } else if (mode === "all_same") {
        const newSeed = Math.floor(Math.random() * 1e15);
        segs.forEach((seg) => { seg.seed = newSeed; });
        seedIn.value = String(s.seed);
        status.textContent = "全部 " + segs.length + " 段已统一为种子: " + newSeed;
      } else {
        s.seed = Math.floor(Math.random() * 1e15);
        seedIn.value = String(s.seed);
        status.textContent = "新种子: " + s.seed;
      }
      save();
    });
    row0.appendChild(seedModeSel);
    row0.appendChild(seedIn);
    row0.appendChild(btnDice);
    row0.appendChild(mk("span", "h3s-hint", "每段=上方照片+下方参考视频，建议时长 ≤ 参考视频时长"));
    editor.appendChild(row0);
    /* ======== ① 视频和图片 ======== */
    editor.appendChild(mk("div", "h3s-hint", "视频和图片（拖入或点选；图片=外观参考，视频自动归入下方参考视频区）："));
    const z1 = mk("div", "h3s-vdz");
    z1.style.minHeight = "110px";
    z1.style.flex = "none";
    const z1body = mk("div", "h3s-refs");
    z1body.style.cssText = "border:none;background:transparent;flex-wrap:wrap;justify-content:center;height:auto;min-height:64px;";
    s.refs.forEach((name, k) => {
      const num = k + 1 + (s.use_tail !== false && sel > 0 ? 1 : 0);
      const box = mk("div", "h3s-pic");
      box.style.cssText = "position:relative;width:72px;height:72px;flex:none;";
      box.title = `<Picture ${num}>（点击插入提示词）`;
      const img = document.createElement("img");
      img.src = api.apiURL("/view?filename=" + encodeURIComponent(name) + "&type=input");
      img.onerror = () => { img.style.display = "none"; };
      const badge = mk("span", "num", `P${num}`);
      badge.addEventListener("click", (ev) => { ev.stopPropagation(); insertV(`<Picture ${num}>`); });
      box.addEventListener("click", () => insertV(`<Picture ${num}>`));
      const x = mk("button", "x", "✕");
      x.title = "移除";
      x.addEventListener("click", (ev) => { ev.stopPropagation(); s.refs.splice(k, 1); save(); renderEditor(); });
      box.append(img, badge, x);
      z1body.appendChild(box);
    });
    const z1add = mk("button", "h3s-btn", s.refs.length ? "+ 继续添加" : "+ 选择视频 / 图片");
    z1add.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pickFiles("image/*,video/*", true, async (f) => {
        if (/\.(mp4|webm|mov|mkv|avi)$/i.test(f.name)) { await upVideo(f); }
        else { await upImage(f); }
      });
    });
    z1body.appendChild(z1add);
    z1.appendChild(z1body);
    if (!s.refs.length) {
      z1.appendChild(mk("div", "h3s-hint", "或把文件拖到这里"));
    }
    wireDrop(z1, /\.(png|jpe?g|webp|bmp|mp4|webm|mov|mkv|avi)$/i, async (f) => {
      if (/\.(mp4|webm|mov|mkv|avi)$/i.test(f.name)) { await upVideo(f); }
      else { await upImage(f); }
    });
    editor.appendChild(z1);

    /* ======== ③ 参考视频：H3 后端原生支持 3 路，前端按顺序映射为 <Video 1~3> ======== */
    editor.appendChild(mk("div", "h3s-hint", "参考视频（每段 1～3 个；可分别参考动作、运镜、节奏或综合；拖动卡片排序）："));
    let mainPlayer = null;
    const usageOptions = [
      ["action", "参考动作"], ["camera", "参考运镜"],
      ["rhythm", "参考节奏"], ["comprehensive", "综合参考"],
    ];
    const videoList = mk("div", "h3s-video-ref-list");
    videoList.style.cssText = "display:flex;flex-direction:column;gap:8px;min-width:0;";
    s.video_refs.forEach((name, index) => {
      const card = mk("div", "h3s-video-ref-card");
      card.draggable = true;
      card.dataset.videoIndex = String(index);
      card.style.cssText = "display:grid;grid-template-columns:minmax(180px,264px) minmax(220px,1fr);"
        + "gap:8px;padding:8px;border:1px solid #3a5a7a;border-radius:8px;background:#101822;min-width:0;";
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", String(index));
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        const source = Number(event.dataTransfer.getData("text/plain"));
        if (!Number.isInteger(source) || source < 0 || source >= s.video_refs.length || source === index) return;
        const [moved] = s.video_refs.splice(source, 1);
        s.video_refs.splice(index, 0, moved);
        save(); renderEditor();
        status.textContent = "参考视频顺序已更新，<Video N> 编号按新顺序生效";
      });

      const preview = mk("div", null);
      preview.style.cssText = "position:relative;width:100%;height:148px;overflow:hidden;background:#000;border-radius:6px;";
      const video = document.createElement("video");
      video.src = api.apiURL("/view?filename=" + encodeURIComponent(name) + "&type=input");
      video.preload = "metadata";
      video.playsInline = true;
      video.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;cursor:pointer;";
      video.title = "点击播放/暂停；本卡可拖动排序";
      video.addEventListener("click", () => {
        mainPlayer = video;
        if (video.paused) video.play(); else video.pause();
      });
      const badge = mk("span", "num", `V${index + 1}`);
      badge.style.cssText = "position:absolute;left:5px;top:5px;background:rgba(24,95,165,.94);color:#fff;"
        + "font-size:11px;padding:2px 6px;border-radius:4px;cursor:pointer;";
      badge.title = `<Video ${index + 1}> 点击插入提示词`;
      badge.addEventListener("click", (event) => { event.stopPropagation(); insertV(`<Video ${index + 1}>`); });
      preview.append(video, badge);

      const controls = mk("div", null);
      controls.style.cssText = "display:flex;flex-direction:column;gap:7px;min-width:0;";
      const nameRow = mk("div", "h3s-row");
      const label = s.video_labels[name] || name;
      const nameText = mk("span", "h3s-hint", label);
      nameText.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
      nameRow.appendChild(nameText);
      const usage = document.createElement("select");
      for (const [value, text] of usageOptions) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        usage.appendChild(option);
      }
      usage.value = s.video_ref_modes[name] || "comprehensive";
      usage.title = "只把这个视频用于所选维度；人物外观、服装、场景和画风仍由图片和提示词决定";
      usage.addEventListener("change", () => {
        s.video_ref_modes[name] = usage.value;
        save();
        status.textContent = `<Video ${index + 1}> 已设为“${usage.options[usage.selectedIndex].text}”`;
      });
      const replace = mk("button", "h3s-btn", "更换");
      replace.addEventListener("click", () => pickFiles("video/*", false, (file) => upVideo(file, index)));
      const remove = mk("button", "h3s-btn", "删除");
      remove.addEventListener("click", () => {
        s.video_refs.splice(index, 1);
        if (!s.video_refs.includes(name)) delete s.video_ref_modes[name];
        save(); renderEditor();
      });
      nameRow.append(usage, replace, remove);
      controls.append(nameRow, mk("div", "h3s-hint", "拖动整张卡片可改变 Video 编号；生成时按所选用途分别送入 H3。"));
      card.append(preview, controls);
      videoList.appendChild(card);
      if (!mainPlayer) mainPlayer = video;
    });
    editor.appendChild(videoList);

    if (s.video_refs.length < 3) {
      const z3 = mk("div", "h3s-vdz");
      z3.style.cssText = "min-height:72px;flex:none;";
      const add = mk("button", "h3s-btn", s.video_refs.length ? "+ 添加参考视频" : "+ 选择参考视频");
      add.addEventListener("click", (event) => { event.stopPropagation(); pickFiles("video/*", true, upVideo); });
      z3.append(add, mk("div", "h3s-hint", `还可添加 ${3 - s.video_refs.length} 个；也可拖入视频`));
      wireDrop(z3, /\.(mp4|webm|mov|mkv|avi)$/i, upVideo);
      editor.appendChild(z3);
    }

    if (s.video_refs.length) {
      const sharedControls = mk("div", "h3s-row");
      sharedControls.appendChild(mk("span", "h3s-hint", "全部参考视频共用：加载帧率"));
      const fpsIn = mk("input", "h3s-durinput");
      fpsIn.type = "number";
      fpsIn.min = "1";
      fpsIn.max = "24";
      fpsIn.step = "1";
      fpsIn.value = String(s.video_fps || 24);
      fpsIn.addEventListener("change", () => {
        s.video_fps = Math.max(1, Math.min(24, Math.round(Number(fpsIn.value) || 24)));
        fpsIn.value = String(s.video_fps);
        save();
      });
      sharedControls.append(fpsIn, mk("span", "h3s-hint", "起始秒"));
      const skipIn = mk("input", "h3s-durinput");
      skipIn.type = "number";
      skipIn.min = "0";
      skipIn.max = "60";
      skipIn.step = "0.5";
      skipIn.value = String(s.video_skip || 0);
      skipIn.addEventListener("change", () => {
        s.video_skip = Math.max(0, Number(skipIn.value) || 0);
        skipIn.value = String(s.video_skip);
        save();
      });
      sharedControls.append(skipIn, mk("span", "h3s-hint", "音轨"));
      const audioRefSel = document.createElement("select");
      audioRefSel.innerHTML = '<option value="visual">不发送音轨（推荐）</option>'
        + '<option value="audio">同时参考各视频音轨</option>';
      audioRefSel.value = s.video_audio_reference === true ? "audio" : "visual";
      audioRefSel.addEventListener("change", () => {
        s.video_audio_reference = audioRefSel.value === "audio";
        save();
      });
      sharedControls.appendChild(audioRefSel);
      editor.appendChild(sharedControls);
    }

    /* ======== ④ 播放键（控制参考视频小块）======== */
    const ctl = mk("div", "h3s-row");
    ctl.style.cssText = "justify-content:center;gap:10px;";
    const bPlay = mk("button", "h3s-btn primary", "▶ 播放");
    const bPause = mk("button", "h3s-btn", "⏸ 暂停");
    const bStop = mk("button", "h3s-btn", "⏹ 回开头");
    for (const b of [bPlay, bPause, bStop]) b.style.minWidth = "86px";
    bPlay.addEventListener("click", () => { if (mainPlayer) mainPlayer.play(); });
    bPause.addEventListener("click", () => { if (mainPlayer) mainPlayer.pause(); });
    bStop.addEventListener("click", () => { if (mainPlayer) { mainPlayer.pause(); mainPlayer.currentTime = 0; } });
    ctl.append(bPlay, bPause, bStop);
    if (!s.video_refs.length) {
      bPlay.disabled = bPause.disabled = bStop.disabled = true;
      ctl.appendChild(mk("span", "h3s-hint", "（加载参考视频后可播放预览）"));
    }
    editor.appendChild(ctl);

    /* ======== ⑤ 底部提示词（含四段式模板，v2.6）======== */
    const tplRow = mk("div", "h3s-row");
    tplRow.appendChild(mk("span", "h3s-hint", "提示词："));
    /* 模板下拉（v2.7）：教程四段式（人物替换）/ 通用简版（动作运镜） */
    const tplSel = document.createElement("select");
    tplSel.innerHTML = '<option value="">插入模板…</option>'
      + '<option value="replace">人物替换·四段式（教程版）</option>'
      + '<option value="motion">通用动作/运镜（简版）</option>'
      + '<option value="story">图片叙事·单主体版（教程）</option>'
      + '<option value="voice">音色对白·双人版（教程）</option>';
    tplSel.title = "选择模板插入提示词框：教程版=四段式人物替换（4 人映射），简版=通用动作/运镜";
    tplSel.addEventListener("change", () => {
      let tpl = null;
      const videoAudioPolicy = s.video_audio_reference === true
        ? "视频的节奏卡点可以参考 <Video 1> 的原音轨，但只允许原音轨中清楚可辨的声音，不新增耳语、咕哝或伪语言。"
        : "只参考 <Video 1> 的可见动作、构图、运镜和节奏，不复制或参考原视频音轨。";
      const videoRhythmPolicy = s.video_audio_reference === true
        ? "<Video 1> 原音轨中清楚可辨的节奏"
        : "<Video 1> 画面中可见的动作节奏";
      if (tplSel.value === "replace") {
        tpl = "\u3010\u7d20\u6750\u5173\u7cfb\u5206\u914d\u3011\n"
        + "\u5168\u5c40\u7684\u955c\u5934\u8fd0\u52a8\u8f68\u8ff9\u3001\u4eba\u7269\u7684\u51fa\u573a\u65f6\u673a\u3001\u80a2\u4f53\u52a8\u4f5c\u4ee5\u53ca\u753b\u9762\u6784\u56fe\uff0c\u8bf7\u5b8c\u5168 1:1 \u590d\u5236\u53c2\u8003\u89c6\u9891 <Video 1>\u3002" + videoAudioPolicy + "\n"
        + "\u4eba\u7269\u89d2\u8272\u5f3a\u5236\u66ff\u6362\uff1a\u539f\u89c6\u9891\u4e2d\u7684<\u4eba\u7269A> \u66ff\u6362\u4e3a <Picture 1>\uff08<\u5916\u8c8c\u7a7f\u7740>\uff09\uff1b\u539f\u89c6\u9891\u4e2d\u7684<\u4eba\u7269B> \u66ff\u6362\u4e3a <Picture 2>\uff08<\u5916\u8c8c\u7a7f\u7740>\uff09\uff1b\u539f\u89c6\u9891\u4e2d\u7684<\u4eba\u7269C> \u66ff\u6362\u4e3a <Picture 3>\uff08<\u5916\u8c8c\u7a7f\u7740>\uff09\uff1b\u539f\u89c6\u9891\u4e2d\u7684<\u4eba\u7269D> \u66ff\u6362\u4e3a <Picture 4>\uff08<\u5916\u8c8c\u7a7f\u7740>\uff09\u3002100% \u66ff\u6362\u6bcf\u4e00\u4e2a\uff0c\u4e0d\u5141\u8bb8\u4fdd\u7559\u539f\u4eba\u7269\u7684\u4efb\u4f55\u5916\u8c8c\u7279\u5f81\u3002\n"
        + "\u3010\u753b\u9762\u7f8e\u5b66\u4e0e\u8d28\u611f\u3011\n"
        + "\u80f6\u7247\u8d28\u611f\uff1a35mm \u80f6\u7247\u9897\u7c92\uff0cKodak Vision2 500T \u7f8e\u5b66\u3002\u91c7\u7528\u660e\u4eae\u7684\u53e4\u5178\u51b7\u767d\u8c03\u5149\u6e90\uff0c\u4fdd\u7559\u6781\u7b80\u4e3b\u4e49\u7a7a\u95f4\u4e0e\u6c7d\u8f66\u91d1\u5c5e\u6f06\u9762\u7684\u9ad8\u7ea7\u8d28\u611f\u3002\u5c06\u5404\u53c2\u8003\u56fe\u7684\u4e8c\u6b21\u5143\u7279\u5f81\u5b8c\u7f8e\u8f6c\u5316\u4e3a\u5177\u6709\u7535\u5f71\u7ea7\u771f\u5b9e\u5149\u5f71\u7684 3D \u903c\u771f\u4eba\u7269\uff0c\u670d\u88c5\u6750\u8d28\u5347\u7ea7\u4e3a\u5177\u6709\u771f\u5b9e\u8936\u76b1\u7684\u5e03\u6599\uff0c\u4e0e\u573a\u666f\u5b8c\u7f8e\u878d\u5408\u3002\n"
        + "\u3010\u8be6\u7ec6\u65f6\u95f4\u7ebf\u8c03\u5ea6\u3011\n"
        + "0 \u81f3 2 \u79d2\uff1a\n\u4e2d\u8fd1\u666f\u955c\u5934\uff0c\u753b\u9762\u4e2d\u592e\u5c55\u793a\u51fa <Picture 1> \u7684\u4e0a\u534a\u8eab\uff0c\u4ed6\u51b7\u6f20\u5730\u671b\u7740\u955c\u5934\uff0c\u8868\u60c5\u6781\u5176\u4e13\u6ce8\uff0c\u59ff\u6001\u5b8c\u5168\u590d\u523b <Video 1> \u5f00\u5934\u4eba\u7269\u7684\u52a8\u4f5c\u3002\n\n"
        + "2 \u81f3 5 \u79d2\uff1a\n<Picture 2> \u4ece\u955c\u5934\u53f3\u4fa7\u6781\u8fd1\u5904\u8d70\u5165\u753b\u9762\uff0c\u5176\u8eab\u4f53\u79fb\u52a8\u81ea\u7136\u5f62\u6210\u865a\u5316\u7684\u524d\u666f\u906e\u6321\u8f6c\u573a\u3002\u7126\u70b9\u987a\u52bf\u8f6c\u79fb\u81f3 <Picture 2> \u7684\u9762\u90e8\uff0c\u4ed6\u7f13\u7f13\u8f6c\u5934\uff0c\u773c\u795e\u9510\u5229\u5730\u76f4\u89c6\u955c\u5934\uff0c\u5634\u89d2\u52fe\u8d77\u4e00\u4e1d\u81ea\u4fe1\u5fae\u7b11\uff0c\u8d70\u4f4d\u4e0e\u539f\u89c6\u9891 <Video 1> \u4e2d\u7684\u4eba\u7269\u5b8c\u5168\u4e00\u81f4\u3002\n\n"
        + "5 \u81f3 8 \u79d2\uff1a\n\u955c\u5934\u5f00\u59cb\u5e73\u6ed1\u5411\u540e\u62c9\u8fdc\u5e76\u5411\u5de6\u4fa7\u5448\u5f27\u5f62\u79fb\u52a8\u3002\u968f\u7740\u89c6\u91ce\u9000\u540e\uff0c<Picture 2> \u59cb\u7ec8\u4fdd\u6301\u4e0e\u955c\u5934\u5bf9\u89c6\uff0c\u5e76\u987a\u52bf\u5c06\u53cc\u81c2\u4ea4\u53c9\u62b1\u4e8e\u80f8\u524d\u3002\u6b64\u65f6\u80cc\u666f\u4e2d\u7684\u8f66\u8f86\u8fdb\u5165\u753b\u9762\uff0c\u65c1\u8fb9\u7ad9\u7740\u540c\u6837\u53cc\u81c2\u4ea4\u53c9\u7684 <Picture 3>\u3002\n\n"
        + "8 \u81f3 10 \u79d2\uff1a\n\u955c\u5934\u7ee7\u7eed\u6d41\u7545\u540e\u9000\u5e76\u5411\u5de6\u5e73\u79fb\uff0c\u6700\u7ec8\u5b9a\u683c\u4e3a\u4e00\u4e2a\u7a33\u5b9a\u7684\u5e7f\u89d2\u5168\u666f\u955c\u5934\u3002\u5de6\u4fa7\u7684 <Picture 4> \u9760\u5728\u8f66\u65c1\u6446\u51fa\u9020\u578b\uff0c\u53f3\u4fa7\u7684 <Picture 1> \u7ad9\u5728\u6700\u521d\u7684\u4f4d\u7f6e\u8f6c\u8eab\u770b\u7740\u955c\u5934\uff1b\u4e2d\u95f4\u662f\u6c14\u573a\u5168\u5f00\u7684 <Picture 2>\uff1b<Picture 3> \u7a33\u56fa\u5730\u7ad9\u5728\u4e2d\u5fc3\u4eba\u7269\u7684\u4fa7\u540e\u65b9\u3002\u6240\u6709\u4eba\u56f4\u7ed5\u573a\u666f\u5f62\u6210\u4e00\u4e2a\u6781\u5177\u529b\u91cf\u611f\u7684\u7fa4\u50cf\u5b9a\u683c\uff0c\u52a8\u4f5c\u4e0e\u4f4d\u7f6e\u4e25\u683c\u5bf9\u9f50 <Video 1> \u7684\u7ec8\u5c40\u753b\u9762\u3002\n\n"
        + "\u3010\u9650\u5236\u3011\n"
        + "全程保持极其流畅的一镜到底拍摄，人物走位与摄影机后退轨迹必须配合" + videoRhythmPolicy + "，绝对禁止中途切镜头、画面闪烁或任何形式的后期转场，画面禁止出现任何文字、字幕与 UI 元素。";
      } else if (tplSel.value === "motion") {
        const d = String(segDur(s));
        const d1 = String(Math.max(1, Math.round(segDur(s) / 2)));
        tpl = "\u3010\u7d20\u6750\u5173\u7cfb\u5206\u914d\u3011\u5168\u5c40\u52a8\u4f5c\u3001\u59ff\u6001\u3001\u8fd0\u955c\u4e0e\u8282\u594f\u5b8c\u5168\u590d\u523b\u53c2\u8003\u89c6\u9891 <Video 1>\uff1b<Video 1> \u4e2d\u7684\u89d2\u8272/\u4e3b\u4f53 100% \u66ff\u6362\u4e3a <Picture 1>\uff08\u5916\u8c8c\u7a7f\u7740\u4e0e\u753b\u9762\u4e25\u683c\u6309\u53c2\u8003\u56fe\uff09\u3002\n"
          + "\u3010\u753b\u9762\u7f8e\u5b66\u4e0e\u8d28\u611f\u3011<\u98ce\u683c/\u5149\u7ebf/\u573a\u666f\u6c1b\u56f4/\u6750\u8d28>\u3002\n"
          + "\u3010\u8be6\u7ec6\u65f6\u95f4\u7ebf\u8c03\u5ea6\u30110 \u81f3 " + d1 + " \u79d2\uff1a<\u52a8\u4f5c/\u59ff\u6001 1\uff0c\u7167\u53c2\u8003\u89c6\u9891\u5199>\uff1b" + d1 + " \u81f3 " + d + " \u79d2\uff1a<\u52a8\u4f5c/\u59ff\u6001 2>\uff0c\u7ed3\u5c3e\u4e0e <Video 1> \u7684\u7ec8\u5c40\u753b\u9762\u4e00\u81f4\u3002\n"
          + "\u3010\u9650\u5236\u3011\u5168\u7a0b\u4e00\u955c\u5230\u5e95\uff0c\u4eba\u7269\u59ff\u6001\u4e0e <Video 1> \u9010\u5e27\u5bf9\u9f50\uff0c\u7981\u6b62\u4efb\u4f55\u8f6c\u573a\u3001\u753b\u9762\u95ea\u70c1\u3001\u5b57\u5e55\u4e0e\u5c4f\u5e55\u6587\u5b57\u3002";
      }
      else if (tplSel.value === "story") {
        tpl = "画面背景环境与光影基调完全采用 <Picture 2> 中的<场景/环境>。画面的视觉中心是 <Picture 1> 中的<主体>，他正站在<位置>，手中<动作>着 <Picture 3> 所示的<道具>。镜头<运镜方式，如：环绕角色进行 360 度运镜>，展示<主体><情绪或动作>。全程一镜到底，照片级写实，禁止文字与字幕。";
      } else if (tplSel.value === "voice") {
        tpl = "生成一段 <时长> 秒、原生带声的短片。\n"
          + "人物与画面：在<场景>中，摄影机采用固定中近景双人同框镜头。画面中央明确展示出人物A <Picture 1> 与人物B <Picture 2> 正在面对面交谈。\n"
          + "动作与声音设计：影片起势，人物A <Picture 1> 看着对方，<微表情/动作>。人物A的嗓音严格参考 <Audio 1> 的音色，说：「<台词A>」；紧接着，人物B <Picture 2> <反应动作>。人物B的对白严格参考 <Audio 2> 的音色，反问：「<台词B>」；最后保留 0.5 秒人物A <收尾表情> 的余波。\n"
          + "剪辑与视觉：镜头全程保持单机位连续跟随，不发生硬切。背景适度虚化，将视觉焦点与情绪张力集中在两人的面部表情与眼神交锋上。除两人的对白外，环境保持绝对静音。";
      }
      tplSel.value = "";
      if (!tpl) return;
      vta.value = tpl;
      s.prompt = tpl;
      save();
      vta.focus();
      status.textContent = "\u6a21\u677f\u5df2\u63d2\u5165\uff0c\u628a <...> \u5360\u4f4d\u6362\u6210\u4f60\u7684\u5185\u5bb9\uff08\u79d2\u6570\u6309\u53c2\u8003\u89c6\u9891\u957f\u5ea6\u8c03\u6574\uff09";
    });
    tplRow.appendChild(tplSel);
    /* 清空提示词（v2.10.6） */
    const btnClear = mk("button", "h3s-btn", "清空");
    btnClear.title = "清空当前提示词";
    btnClear.addEventListener("click", () => {
      vta.value = "";
      s.prompt = "";
      save();
      vta.focus();
      status.textContent = "提示词已清空";
    });
    const btnVideoRefine = mk("button", "h3s-btn", "AI精修");
    btnVideoRefine.title = "只精修视频页面当前段；AI 可读取当前参考图和参考视频关键帧，不修改创作或文本页面";
    btnVideoRefine.addEventListener("click", async () => {
      const draft = vta.value.trim();
      if (!draft) { status.textContent = "视频页面当前提示词为空，请先输入内容"; vta.focus(); return; }
      btnVideoRefine.disabled = true;
      status.style.color = "";
      status.textContent = "正在精修视频页面当前段…";
      try {
        const pictureDescriptions = (s.refs || []).map((name, index) => {
          const meta = getRefAssetMeta(node, name);
          return `Picture ${index + 1}=${meta.name}/${H3_ASSET_TYPES[meta.type].label}`;
        });
        const videoUsageLabels = {
          action: "参考动作", camera: "参考运镜", rhythm: "参考节奏", comprehensive: "综合参考",
        };
        const videoAssignments = (s.video_refs || []).map((name, index) =>
          `<Video ${index + 1}>：${videoUsageLabels[s.video_ref_modes[name]] || "综合参考"}`);
        const response = await api.fetchApi("/h3director/ai_prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              { role: "system", content: buildVideoAiSys({
                dur: String(segDur(s)),
                pics: (s.refs || []).length,
                videoCount: (s.video_refs || []).length,
                videoAssignments: videoAssignments.join("；"),
                videoAudioReference: s.video_audio_reference === true,
              }) },
              { role: "user", content: draft
                + (videoAssignments.length ? "\n\n参考视频逐路用途：\n" + videoAssignments.join("\n") : "")
                + (pictureDescriptions.length
                  ? "\n\n参考图片名称与类型：\n" + pictureDescriptions.join("\n") : "") },
            ],
            images: (s.refs || []).slice(0, 5),
            videos: (s.video_refs || []).slice(0, 3),
            audio: s.audio && s.audio_src === "ref" ? s.audio : null,
            max_tokens: 1800,
            temperature: 0.45,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.content) throw new Error(result.error || ("HTTP " + response.status));
        vta.value = String(result.content || "").trim();
        vta.dispatchEvent(new Event("input", { bubbles: true }));
        save();
        const videoNote = result.video_frames_seen > 0
          ? `；AI 已读取 ${result.video_count || 1} 个视频、${result.video_frames_seen} 张关键帧`
          : ((s.video_refs || []).length ? "；当前模型未读取视频关键帧，已按逐路用途文字和参考图精修" : "");
        status.textContent = "视频页面当前段 AI精修完成" + videoNote;
      } catch (error) {
        status.style.color = "#ff8080";
        status.textContent = "视频页面 AI精修失败：" + error.message;
      } finally { btnVideoRefine.disabled = false; }
    });
    tplRow.append(btnClear, btnVideoRefine);
    editor.appendChild(tplRow);
    vta.style.cssText += "flex:none;width:100%;height:84px;";
    editor.appendChild(vta);

    /* ======== ⑥ 成片预览（v2.8，与创作界面同款：可拖大 + 放大查看）======== */
    const pvWrap = mk("div", "h3s-pv");
    pvWrap.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:240px;gap:4px;";
    editor.appendChild(pvWrap);
    void renderSegmentVideoCompare(pvWrap, sel + 1, 200);

    /* 方案 A：视频界面统一为左右工作台。
       左侧放段设置和提示词；右侧放参考素材及成片预览。 */
    {
      const children = Array.from(editor.children);
      const promptIndex = children.indexOf(tplRow);
      const mediaNodes = children.slice(2, promptIndex);
      const makeCard = (title, cls, nodes) => {
        const el = mk("section", "h3s-card" + (cls ? " " + cls : ""));
        el.appendChild(mk("div", "h3s-card-title", title));
        el.append(...nodes);
        return el;
      };
      const main = mk("div", "h3s-create-col h3s-create-main");
      const side = mk("div", "h3s-create-col h3s-create-side");
      main.append(
        makeCard("当前视频段设置", "h3s-card-segment", [row0]),
        makeCard("当前段提示词", "h3s-card-global", [tplRow, vta]),
      );
      const previewCard = makeCard("视频预览", "h3s-card-preview", [pvWrap]);
      side.append(
        makeCard("参考图片与参考视频", "h3s-card-refs", mediaNodes),
        previewCard,
      );
      attachPreviewCardResize(previewCard, "video");
      editor.classList.add("h3s-editor-create");
      editor.replaceChildren(main, side);
    }
  }

  /* ================= 文本界面（v2.11 独立整版；v2.12 支持共用参考图）=================
     纯提示词生成：可上传共用参考图（所有段一致）；无参考视频/配音/音色，全部交给 H3 按提示词原生生成。
     顶部脚本文本框：粘贴带时间标记的分镜文本后，明确选择替换、当前段或追加导入，
     按标记设每段时长、把对应正文写进每段提示词。数据独立（tsegments_json），
     产出文件名独立（漫剧t_/tailt_）。 */
  function renderTextEditor(s) {
    /* ======== ⓪ 分镜脚本导入区（页面级：文本存 node.properties 随工作流保存）======== */
    editor.appendChild(mk("div", "h3s-hint", "创意与分镜草稿"));
    const scriptTa = mk("textarea", "h3s-ta");
    scriptTa.style.cssText += "flex:none;height:120px;";
    scriptTa.placeholder = "输入一句创意；需要补充某一部分时，可在新行写“剧情：”“人物：”“场景：”“镜头：”“动作：”“声音：”或“结尾：”。候选只插入光标处，可继续修改。";
    scriptTa.value = node.properties.h3_text_script || "";
    scriptTa.addEventListener("input", () => {
      node.properties.h3_text_script = scriptTa.value;  // 随工作流保存，不走 segments
      markScriptDirty("text");
    });
    editor.appendChild(scriptTa);
    attachBottomBar(scriptTa, 240, 60);

    const scRow = mk("div", "h3s-row");
    const btnParse = mk("button", "h3s-btn primary", "解析并替换全部段");
    btnParse.title = "识别旧分段脚本或 MiniMax H3 官方 Base / Ref2VA 模板，自动设置时长并导入（替换当前全部段）";
    /* 覆盖确认用两段式按钮（第一次点变红"再点确认"），不用 confirm()——
       ComfyUI 内嵌浏览器静默拦截 confirm/alert，点了"没反应"（审查清单硬性规则） */
    let parseArmed = false;
    const disarmParse = () => {
      parseArmed = false;
      btnParse.textContent = "解析并替换全部段";
      btnParse.style.background = "";
      btnParse.style.borderColor = "";
    };
    const parseFullTextScript = async ({ force = false, destination = "replace" } = {}) => {
      const destinationMode = destination === "current" || destination === "append"
        ? destination : "replace";
      const txt = scriptTa.value;
      if (!txt.trim()) { status.textContent = "脚本框是空的，先粘贴分镜文本"; return false; }
      const parsed = parseScript(txt);
      const durationError = rejectDurationInflation(parsed);
      if (durationError) { disarmParse(); status.textContent = durationError; return false; }
      applyNormalizedScriptText(scriptTa, "h3_text_script", parsed);
      if (!parsed.length) { status.textContent = "没有识别到任何内容"; return false; }
      const hasContent = textSegs.some((x) => (x.prompt || "").trim());
      if (destinationMode === "replace" && hasContent && !force && !parseArmed) {
        parseArmed = true;
        btnParse.textContent = "确认替换当前 " + textSegs.length + " 段";
        btnParse.style.background = "#8a2f2f";
        btnParse.style.borderColor = "#c05555";
        const parsedType = parsed.officialLabel ? "（" + parsed.officialLabel + "）" : "";
        const parsedWarn = (parsed.warnings || []).length ? "；⚠ " + parsed.warnings.slice(0, 2).join("；") : "";
        status.textContent = "解析出 " + parsed.length + " 段" + parsedType + "；" + formatParsedDuration(parsed)
          + formatTailPlanSummary(parsed) + "；确认覆盖请再点一次红色按钮" + parsedWarn;
        return false;
      }
      disarmParse();
      const _durW = node.widgets.find((w) => w.name === "时长秒");
      const _defDur = _durW ? (Number(_durW.value) || 10) : 10;
      const sourceContract = prepareParsedSourceContract(parsed);
      const appendReplacesBlank = destinationMode === "append" && textSegs.length === 1
        && !(textSegs[0].prompt || "").trim() && !(textSegs[0].refs || []).length;
      const importStart = destinationMode === "current"
        ? Math.max(0, Math.min(sel, textSegs.length - 1))
        : destinationMode === "append" && !appendReplacesBlank ? textSegs.length : 0;
      const importedSegments = [];
      parsed.forEach((p, i) => {
        const imported = {
          prompt: p.prompt,
          seed: Math.floor(Math.random() * 1e15),
          refs: [],
          duration: clampDur(p.duration > 0 ? p.duration : _defDur),
          inherit_shared: true,
          use_tail: importStart + i > 0 && (p.plannedUseTail == null ? true : !!p.plannedUseTail),
          enabled: true,
          force: false,
        };
        if (p.tailPlan) {
          imported.tail_plan = p.tailPlan;
          imported.tail_reason = p.tailReason || "";
        }
        importedSegments.push(applyParsedSourceContract(imported, sourceContract, p));
      });
      if (destinationMode === "current") {
        const previous = textSegs[importStart];
        if (previous && importedSegments[0]) {
          for (const key of ["seed", "refs", "inherit_shared", "enabled", "force",
            "second_sample", "second_sample_restore", "width", "height", "fps"]) {
            if (Object.prototype.hasOwnProperty.call(previous, key)) importedSegments[0][key] = previous[key];
          }
        }
        textSegs.splice(importStart, 1, ...importedSegments);
      } else if (destinationMode === "append" && !appendReplacesBlank) {
        textSegs.push(...importedSegments);
      } else {
        /* 原地替换数组内容（segs 是指向 textSegs 的引用，重新赋值会断链） */
        textSegs.splice(0, textSegs.length, ...importedSegments);
      }
      /* 自动全局只保留跨段共享身份/安全风格/通用限制；首段场景、构图、动作不进入全局。
         如果现有内容是导演台上次自动生成的，会用新安全结果替换（包括主动清空旧错误全局）；
         用户手填全局仍不覆盖；运行时直接使用用户当前保存的内容。 */
      let autoGlobalNote = "";
      if (gpCb.checked) {
        const gExisting = modeGlobalPrompt("text").trim();
        const offStyle = parsed.globalStyle || "";
        const offExtra = parsed.globalExtra || "";
        const lastAuto = String(node.properties.h3_text_auto_global_value || "").trim();
        const replacingPreviousAuto = !!lastAuto && gExisting === lastAuto;
        const canUpgradeAuto = !!gExisting && !!offStyle
          && ((lastAuto && gExisting === lastAuto)
            || (gExisting.length >= 24 && gExisting.length < offStyle.length
              && offStyle.toLowerCase().includes(gExisting.toLowerCase())));
        const setGlobal = (v) => { setModeGlobalPrompt("text", v); gpTaT.value = v; };
        if (parsed.officialFormat === "ref2va" && !offStyle && !offExtra) {
          if (gExisting && lastAuto && gExisting === lastAuto) {
            setGlobal("");
            node.properties.h3_text_auto_global_value = "";
            autoGlobalNote = "；Ref2VA 六字段已逐段保留，已清除上一份自动全局提示词";
          } else {
            autoGlobalNote = gExisting
              ? "（Ref2VA 每段已自包含；全局框为手填内容，未覆盖）"
              : "；Ref2VA 六字段已逐段完整保留，无需重复全局提示词";
          }
        } else if (!gExisting || canUpgradeAuto || replacingPreviousAuto) {
          /* v2.13.8：官方单段（≤15s）已自包含（风格+音效都在段提示词里），offStyle/offExtra 为空，
             此时不能再走 extractGlobalPrompt 兜底（它会把整段提示词误塞进全局框）——官方格式跳过兜底 */
          const joined = [offStyle, offExtra].filter(Boolean).join("\n\n");
          const g = joined || (parsed.official ? "" : extractGlobalPrompt(parsed));
          if (g || replacingPreviousAuto) {
            setGlobal(g);
            node.properties.h3_text_auto_global_value = g;
            autoGlobalNote = g
              ? (canUpgradeAuto || replacingPreviousAuto
                ? "；已更新自动全局提示词（只保留跨段共享身份/风格/限制）"
                : "；已自动提取安全共享提示词到全局框")
              : "；检测到换场/换风格，已清除上一份自动全局提示词";
          }
        } else if (offExtra && !/soundscape\s*[:：]/i.test(gExisting)) {
          const appended = gExisting + "\n\n" + offExtra;
          setGlobal(appended);
          if (lastAuto && gExisting === lastAuto) node.properties.h3_text_auto_global_value = appended;
          autoGlobalNote = "；已把音效/配乐字段追加到全局框";
        } else {
          autoGlobalNote = "（全局框已有内容，未覆盖）";
        }
      }
      sel = importStart;
      clearBoxSel();
      clearScriptDirty("text");
      save(); renderTimeline(); renderEditor();
      const parsedType = parsed.officialLabel ? "（" + parsed.officialLabel + "）" : "";
      const parsedWarn = (parsed.warnings || []).length ? "；⚠ " + parsed.warnings.slice(0, 2).join("；") : "";
      const importResult = destinationMode === "current"
        ? `已从段${importStart + 1}开始导入 ${importedSegments.length} 段，其他原有段保持不变`
        : destinationMode === "append"
          ? `已向末尾追加 ${importedSegments.length} 段${appendReplacesBlank ? "（原空白占位段已替换）" : ""}`
          : `已解析并替换为 ${textSegs.length} 段`;
      status.textContent = importResult + parsedType + "，"
        + formatParsedDuration(parsed) + formatTailPlanSummary(textSegs)
        + "（可逐段修改，也可直接运行）" + autoGlobalNote + parsedWarn;
      return true;
    };
    btnParse.addEventListener("click", () => { void parseFullTextScript(); });
    scriptTa.__h3ParseGuidedResult = () => { void parseFullTextScript({ force: true }); };
    const btnParseCurrent = mk("button", "h3s-btn", "导入到当前段");
    btnParseCurrent.title = "用脚本解析结果替换当前段；多段结果从当前位置顺次插入，其他段保持不变";
    btnParseCurrent.addEventListener("click", () => {
      void parseFullTextScript({ destination: "current" });
    });
    const btnParseAppend = mk("button", "h3s-btn", "追加到末尾");
    btnParseAppend.title = "解析脚本并追加到现有时间线末尾，不修改已有段";
    btnParseAppend.addEventListener("click", () => {
      void parseFullTextScript({ destination: "append" });
    });
    const btnLoad = mk("button", "h3s-btn", "📂 载入文本");
    btnLoad.title = "从本地 .txt 文件载入脚本框；不会自动解析或修改现有分段";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".txt,text/plain";
    fileInput.style.display = "none";
    btnLoad.addEventListener("click", () => { fileInput.click(); });
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const txt = await file.text();
        scriptTa.value = txt;
        scriptTa.dispatchEvent(new Event("input", { bubbles: true }));
        disarmParse();
        status.textContent = "已载入 " + file.name
          + " 到脚本框，当前分段未修改；检查内容后请选择替换全部、导入到当前段或追加到末尾。";
      } catch (err) {
        status.textContent = "载入失败：" + err.message;
      }
      fileInput.value = "";
    });
    /* 这里是“格式骨架”，只把可直接编辑的官方 Base 示例插入脚本框；它与上方
       主分镜逐项搭建器彻底分离，不再从下拉框跳转创作流程。 */
    const libSel = document.createElement("select");
    libSel.title = "只插入可编辑的官方Base格式骨架；逐项创作请直接在上方主分镜输入框输入短主题";
    {
      const skeletons = H3_TEXT_TEMPLATES.filter((t) => t.script);
      const groups = [];
      for (const t of skeletons) if (!groups.includes(t.group)) groups.push(t.group);
      libSel.innerHTML = '<option value="">📄 格式骨架…</option>'
        + groups.map((g) => '<optgroup label="' + g + '">'
          + skeletons.filter((t) => t.group === g)
              .map((t) => '<option value="' + t.id + '">' + t.name + "</option>").join("")
          + "</optgroup>").join("");
    }
    libSel.addEventListener("change", () => {
      const t = H3_TEXT_TEMPLATES.find((x) => x.id === libSel.value);
      libSel.value = "";
      if (!t) return;
      scriptTa.value = t.script;
      node.properties.h3_text_script = t.script;
      let note = "格式骨架「" + t.name + "」已填入脚本框，【】占位换成你的内容后请选择导入方式；需要逐项主题引导和镜头选择，请清空后直接在主分镜输入框输入短主题";
      if (t.global) {
        const gExisting = modeGlobalPrompt("text").trim();
        if (!gExisting) {
          setModeGlobalPrompt("text", t.global);
          gpTaT.value = t.global;
          note += "；风格签名已填入全局框";
        } else {
          note += "（全局框已有内容，风格签名未填入）";
        }
      }
      status.textContent = note;
    });
    const btnClearScript = mk("button", "h3s-btn", "清空脚本");
    btnClearScript.addEventListener("click", () => {
      scriptTa.value = "";
      node.properties.h3_text_script = "";
    });
    const btnStoryToScriptT = mk("button", "h3s-btn", "AI剧情");
    btnStoryToScriptT.title = "把当前故事或素材整理为可拍摄剧本；只写回文本页面脚本框，不自动解析、不自动运行";
    const btnScriptToShotsT = mk("button", "h3s-btn", "AI分镜");
    btnScriptToShotsT.title = "把当前剧本转换为 MiniMax H3 官方 Base 长时间轴；只写回文本页面脚本框";
    const btnRefineScriptT = mk("button", "h3s-btn", "AI精修");
    btnRefineScriptT.title = "有框选时只精修框选内容；没有框选时精修文本页面整个脚本框";
    const runTextScriptAi = async (button, action, label) => {
      button.disabled = true;
      try { await action(); }
      catch (error) {
        status.style.color = "#ff8080";
        status.textContent = label + "失败：" + error.message;
      } finally { button.disabled = false; }
    };
    btnStoryToScriptT.addEventListener("click", () => runTextScriptAi(
      btnStoryToScriptT,
      () => rewriteScriptWithAI(scriptTa, buildStoryToScriptSys(currentAssetPromptContext(), "zh-CN"),
        "AI剧情", prepareStoryScriptOutput, { assetCatalog: allUploadedAssets() }),
      "AI剧情",
    ));
    btnScriptToShotsT.addEventListener("click", () => runTextScriptAi(
      btnScriptToShotsT,
      () => rewriteScriptWithAI(scriptTa, buildOfficialStoryboardSys(currentAssetPromptContext(), "zh-CN"),
        "AI分镜", prepareOfficialStoryboardOutput, {
          includeExplicitSegmentContract: true,
          assetCatalog: allUploadedAssets(),
          assetOutputType: "official",
          expandCoarseOfficialShots: true,
          keepRejectedOutput: true,
        }),
      "AI分镜",
    ));
    btnRefineScriptT.addEventListener("pointerdown", (event) => event.preventDefault());
    btnRefineScriptT.addEventListener("click", () => runTextScriptAi(
      btnRefineScriptT, () => refineSelectedH3TextWithAI(scriptTa), "AI精修"));
    scRow.append(btnLoad, btnParse, btnParseCurrent, btnParseAppend, libSel,
      btnStoryToScriptT, btnScriptToShotsT, btnRefineScriptT,
      btnClearScript,
      mk("span", "h3s-hint", "AI 结果只写回当前页面脚本框；确认后再选择替换、当前段或追加导入。"));
    editor.appendChild(scRow);

    /* 全局提示词（v2.12）：注入到每一段开头，保持风格/角色/场景一致性 */
    const gpRowT = mk("div", "h3s-row");
    gpRowT.style.flexDirection = "column";
    gpRowT.style.alignItems = "stretch";
    const gpHeadT = mk("div", "h3s-row");
    gpHeadT.style.cssText += "justify-content:space-between;align-items:center;";
    gpHeadT.appendChild(mk("div", "h3s-hint", "全局提示词（注入到每一段开头）："));
    /* 一键全部清空——分镜脚本 + 全局提示词 + 全部分段，回到空白状态录新剧本。
       两段式红按钮，不用 confirm。 */
    const btnGpClearT = mk("button", "h3s-btn", "全部清空");
    btnGpClearT.title = "清空分镜脚本 + 全局提示词 + 全部分段，重置为 1 个空白段（成片文件保留）";
    let gpClearArmedT = false;
    const disarmGpClearT = () => {
      gpClearArmedT = false;
      btnGpClearT.textContent = "全部清空";
      btnGpClearT.style.background = "";
      btnGpClearT.style.borderColor = "";
    };
    btnGpClearT.addEventListener("click", () => {
      const hasAnything = !!scriptTa.value.trim() || !!gpTaT.value.trim()
        || textSegs.length > 1 || textSegs.some((x) => (x.prompt || "").trim());
      if (!hasAnything) { disarmGpClearT(); status.textContent = "脚本 / 全局提示词 / 分段都已是空的"; return; }
      if (!gpClearArmedT) {
        gpClearArmedT = true;
        btnGpClearT.textContent = "再点确认全部清空";
        btnGpClearT.style.background = "#8a2f2f";
        btnGpClearT.style.borderColor = "#c05555";
        status.textContent = "将清空：分镜脚本 + 全局提示词 + 全部 " + textSegs.length + " 段，再点一次红色按钮确认";
        return;
      }
      disarmGpClearT();
      scriptTa.value = "";
      node.properties.h3_text_script = "";
      setModeGlobalPrompt("text", "");
      node.properties.h3_text_auto_global_value = "";
      /* 原地重置分段为 1 个空白段（textSegs 是引用，重新赋值会断链） */
      textSegs.length = 0;
      textSegs.push(defaultTextSegs()[0]);
      sel = 0;
      save(); renderTimeline(); renderEditor();
      status.textContent = "已全部清空：脚本 + 全局提示词 + 分段（成片文件保留在 output 目录）";
    });
    gpHeadT.appendChild(btnGpClearT);
    gpRowT.appendChild(gpHeadT);
    const gpChk = mk("label", "h3s-chk");
    gpChk.style.cssText = "display:flex;align-items:center;gap:5px;font-size:11px;color:#9aa4b2;margin:2px 0 4px;";
    const gpCb = document.createElement("input");
    gpCb.type = "checkbox";
    gpCb.checked = node.properties.h3_text_auto_global !== "0";   // 默认勾选
    gpCb.addEventListener("change", () => { node.properties.h3_text_auto_global = gpCb.checked ? "1" : "0"; });
    gpChk.appendChild(gpCb);
    gpChk.appendChild(mk("span", null, "解析时自动提取安全共享内容到全局框（角色身份/真正共享风格/No subtitles；不含分段场景）"));
    gpRowT.appendChild(gpChk);
    const gpTaT = mk("textarea", "h3s-ta");
    gpTaT.style.cssText += "flex:none;height:50px;";
    gpTaT.placeholder = "只写所有段真正共享的角色身份、外貌、固定道具、统一风格和通用限制；分段场景/运镜留在各段。";
    gpTaT.value = modeGlobalPrompt("text");
    gpTaT.addEventListener("input", () => {
      setModeGlobalPrompt("text", gpTaT.value);
      node.properties.h3_text_auto_global_value = "";
      scheduleSave();
    });
    gpRowT.appendChild(gpTaT);
    editor.appendChild(gpRowT);

    /* 仅作左右工作台分组边界；段级种子、启用和尾帧仍保存在数据中，
       可在上方时间线段卡及当前页面批量勾选框中调整。 */
    const segmentStartMarker = mk("span", "h3s-segment-start");
    segmentStartMarker.hidden = true;
    editor.appendChild(segmentStartMarker);
    editor.appendChild(renderSegmentKeyframes(s, sel));

    /* ======== ② 本段提示词 ======== */
    const prRow = mk("div", "h3s-row");
    prRow.appendChild(mk("span", "h3s-hint", "提示词（纯文本生成；可直接编辑官方 Base 三字段或普通中文提示词）："));
    const btnClearP = mk("button", "h3s-btn", "清空");
    btnClearP.title = "清空本段提示词";
    const btnTextAI = mk("button", "h3s-btn", "✨ 优化当前段");
    btnTextAI.title = "使用顶部共用 API 设置，只生成或改写当前文本段提示词";
    const btnTextRefineCurrent = mk("button", "h3s-btn", "AI精修当前段");
    btnTextRefineCurrent.title = "有框选时只精修框选内容；没有框选时精修当前文本段全文";
    btnTextRefineCurrent.addEventListener("pointerdown", (event) => event.preventDefault());
    btnTextRefineCurrent.addEventListener("click", async () => {
      btnTextRefineCurrent.disabled = true;
      try { await refineSelectedH3TextWithAI(pta); }
      catch (error) {
        status.style.color = "#ff8080";
        status.textContent = "当前段精修失败：" + error.message;
      } finally { btnTextRefineCurrent.disabled = false; }
    });
    prRow.append(btnClearP, btnTextRefineCurrent);
    editor.appendChild(prRow);
    const pta = mk("textarea", "h3s-ta");
    pta.value = s.prompt || "";
    pta.placeholder = "本段提示词：推荐使用官方 Base 三字段；[Shot 1] 不写时间，后续写 [Shot N] At 00:00:03.000，台词使用 <d>[Chinese]…</d>。";
    pta.addEventListener("input", () => { s.prompt = pta.value; scheduleSave(); });
    btnClearP.addEventListener("click", () => {
      pta.value = ""; s.prompt = ""; save(); pta.focus();
      status.textContent = "段" + (sel + 1) + " 提示词已清空";
    });
    editor.appendChild(pta);
    attachBottomBar(pta, 240, 60);

    /* 文本界面 AI：和创作界面共用同一份后端 API 配置，但只发送当前段草稿、
       全局提示词和可选的上段尾帧；生成结果直接写回当前文本段。 */
    let textAiPanel = null;
    btnTextAI.addEventListener("click", async () => {
      if (textAiPanel) { textAiPanel.remove(); textAiPanel = null; return; }
      textAiPanel = mk("div", "h3s-slrow");
      textAiPanel.style.flexWrap = "wrap";
      const openedPanel = textAiPanel;
      const modeSel = document.createElement("select");
      modeSel.innerHTML = '<option value="smart">智能生成</option>'
        + '<option value="compose">编写模式</option>';
      modeSel.value = localStorage.getItem("h3_text_ai_mode") || "smart";
      modeSel.title = "智能生成：允许 AI 完善创意；编写模式：严格按当前草稿转换，不增删情节";
      modeSel.addEventListener("change", () => localStorage.setItem("h3_text_ai_mode", modeSel.value));
      const apiInfo = mk("span", "h3s-hint", "正在读取 API 配置…");
      const btnTextTest = mk("button", "h3s-btn", "测试连接");
      const btnTextGenerate = mk("button", "h3s-btn primary", "生成到本段");
      const setTextAiError = (message) => {
        apiInfo.textContent = message;
        apiInfo.style.color = "#ff8080";
      };
      const loadTextApiInfo = async () => {
        const resp = await api.fetchApi("/h3director/api_config");
        const cfg = await resp.json();
        if (!resp.ok) throw new Error(cfg.error || ("HTTP " + resp.status));
        let host = cfg.base_url || "";
        try { host = new URL(host).host; } catch (e) { /* 保留原地址 */ }
        apiInfo.style.color = "";
        apiInfo.textContent = cfg.configured
          ? "已配置：" + cfg.model + (host ? " · " + host : "")
          : "尚未配置 API，请先在顶部“AI / API 共用设置”中保存设置";
        return cfg;
      };
      btnTextTest.addEventListener("click", async () => {
        btnTextTest.disabled = true;
        apiInfo.textContent = "正在测试 API 连接…";
        try {
          const resp = await api.fetchApi("/h3director/api_test", { method: "POST" });
          const result = await resp.json();
          if (!resp.ok || !result.ok) throw new Error(result.error || ("HTTP " + resp.status));
          apiInfo.style.color = result.vision_capability === "unsupported" ? "#e8bd68" : "";
          apiInfo.textContent = apiTestStatusText(result, "当前模型");
        } catch (error) {
          setTextAiError("连接失败：" + error.message);
        }
        btnTextTest.disabled = false;
      });
      btnTextGenerate.addEventListener("click", async () => {
        const draft = pta.value.trim();
        if (!draft) {
          setTextAiError("先在“本段提示词”框写一句创意或大白话分镜，再点生成");
          pta.focus();
          return;
        }
        btnTextGenerate.disabled = true;
        apiInfo.style.color = "";
        apiInfo.textContent = "AI 正在生成当前文本段提示词…";
        try {
          const hasTail = s.use_tail !== false && sel > 0;
          const globalText = gpTaT.value.trim();
          const ctx = {
            dur: String(segDur(s)),
            pics: hasTail ? 1 : 0,
            picDesc: hasTail ? "Picture 1=上段尾帧" : "无",
            tail: hasTail,
            voices: "文本界面没有使用音色或配音槽。",
            hasAudio: false,
          };
          const requestText = (modeSel.value === "compose"
            ? "请严格按照下面的大白话分镜转换成合格提示词，不增删情节：\n"
            : "请根据下面的创意/草稿写一段提示词：\n")
            + draft
            + (globalText ? "\n\n全片共享要求（必须遵守）：\n" + globalText : "");
          const resp = await api.fetchApi("/h3director/ai_prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "system", content: buildAiSys(ctx) },
                { role: "user", content: requestText },
              ],
              images: [],
              tail_seg: hasTail ? sel : null,
              mode: "text",
              project_id: ensureProjectId(),
              max_tokens: 1600,
              temperature: 0.7,
            }),
          });
          const result = await resp.json();
          if (!resp.ok || !result.content) throw new Error(result.error || ("HTTP " + resp.status));
          pta.value = result.content;
          s.prompt = result.content;
          save();
          showAiGenerationResult(apiInfo, result, "已生成并填入当前文本段");
        } catch (error) {
          setTextAiError("生成失败：" + error.message);
        }
        btnTextGenerate.disabled = false;
      });
      textAiPanel.append(
        mk("span", "h3s-hint", "文本段 AI："),
        mk("span", "h3s-hint", "生成方式"), modeSel,
        btnTextTest, btnTextGenerate, apiInfo,
        mk("span", "h3s-hint", "API 地址、模型和 Key 在顶部统一管理；这里只处理当前选中的文本段"),
      );
      const resizeBar = pta.nextElementSibling;
      const promptParent = pta.parentElement || editor;
      promptParent.insertBefore(textAiPanel, resizeBar ? resizeBar.nextSibling : pta.nextSibling);
      try { await loadTextApiInfo(); } catch (error) { setTextAiError("API 配置查询失败：" + error.message); }
      if (textAiPanel !== openedPanel) return;
    });

    /* ======== ③ 本段成片预览（与其他界面同款）======== */
    const pvWrap = mk("div", "h3s-pv");
    pvWrap.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:240px;gap:4px;";
    editor.appendChild(pvWrap);
    void renderSegmentVideoCompare(pvWrap, sel + 1, 200);

    /* 方案 A：文本界面统一为左右工作台。
       左侧写脚本、全局规则和当前段；右侧专门验收成片。 */
    {
      const children = Array.from(editor.children);
      const segmentIndex = children.indexOf(segmentStartMarker);
      const previewIndex = children.indexOf(pvWrap);
      const scriptNodes = children.slice(0, segmentIndex);
      const segmentNodes = children.slice(segmentIndex, previewIndex);
      const makeCard = (title, cls, nodes) => {
        const el = mk("section", "h3s-card" + (cls ? " " + cls : ""));
        if (title) el.appendChild(mk("div", "h3s-card-title", title));
        el.append(...nodes);
        return el;
      };
      const main = mk("div", "h3s-create-col h3s-create-main");
      const side = mk("div", "h3s-create-col h3s-create-side");
      main.append(
        makeCard("分镜脚本与全局提示词", "h3s-card-script", scriptNodes),
        makeCard("", "h3s-card-segment", segmentNodes),
      );
      const previewCard = makeCard("视频预览", "h3s-card-preview", [pvWrap]);
      side.append(previewCard);
      attachPreviewCardResize(previewCard, "text");
      editor.classList.add("h3s-editor-create");
      editor.replaceChildren(main, side);
    }
  }

  const upscalePreviewUrl = (source) => {
    const value = String(source && source.preview || "");
    return value ? api.apiURL(value) : "";
  };
  const upscaleResultUrl = (result, cacheStamp) => {
    const route = h3UpscaleResultVideoRoute(result, cacheStamp);
    return route ? api.apiURL(route) : "";
  };
  const closeUpscaleComparison = () => {
    const cleanup = cleanupUpscaleComparison;
    cleanupUpscaleComparison = null;
    if (cleanup) cleanup();
  };
  const mountUpscaleComparison = (container, resultUrl) => {
    const sourceUrl = upscalePreviewUrl(upscaleSource);
    if (!container || !sourceUrl || !resultUrl) return false;
    closeUpscaleComparison();

    const comparison = mk("div", "h3s-upscale-compare");
    const stage = mk("div", "h3s-upscale-compare-stage");
    stage.tabIndex = 0;
    stage.setAttribute("role", "slider");
    stage.setAttribute("aria-label", "超分前后画面对比分割线");
    stage.setAttribute("aria-valuemin", "0");
    stage.setAttribute("aria-valuemax", "100");
    const sourceVideo = document.createElement("video");
    sourceVideo.className = "h3s-upscale-compare-video";
    sourceVideo.preload = "metadata";
    sourceVideo.playsInline = true;
    sourceVideo.src = sourceUrl;
    const after = mk("div", "h3s-upscale-compare-after");
    const resultVideo = document.createElement("video");
    resultVideo.className = "h3s-upscale-compare-video";
    resultVideo.preload = "metadata";
    resultVideo.playsInline = true;
    resultVideo.muted = true;
    resultVideo.setAttribute("muted", "");
    resultVideo.src = resultUrl;
    after.appendChild(resultVideo);
    const divider = mk("div", "h3s-upscale-compare-divider");
    divider.appendChild(mk("span", "h3s-upscale-compare-handle", "↔"));
    stage.append(
      sourceVideo,
      after,
      divider,
      mk("span", "h3s-upscale-compare-label before", "原视频"),
      mk("span", "h3s-upscale-compare-label after", "超分后"),
    );
    const sourceWidth = Number(upscaleResult && upscaleResult.source_width) || 16;
    const sourceHeight = Number(upscaleResult && upscaleResult.source_height) || 9;
    stage.style.setProperty("--h3-upscale-ratio", `${Math.min(200, Math.max(20, sourceHeight / sourceWidth * 100))}%`);

    let splitPercent = 50;
    const setSplit = (value) => {
      splitPercent = Math.min(100, Math.max(0, Number(value) || 0));
      after.style.clipPath = `inset(0 ${100 - splitPercent}% 0 0)`;
      divider.style.left = `${splitPercent}%`;
      stage.setAttribute("aria-valuenow", String(Math.round(splitPercent)));
    };
    setSplit(splitPercent);
    let dragging = false;
    const updateSplitFromPointer = (event) => {
      const rect = stage.getBoundingClientRect();
      setSplit(h3UpscaleComparePercent(event.clientX, rect.left, rect.width));
    };
    stage.addEventListener("pointerdown", (event) => {
      dragging = true;
      stage.setPointerCapture(event.pointerId);
      updateSplitFromPointer(event);
      event.preventDefault();
    });
    stage.addEventListener("pointermove", (event) => {
      if (dragging) updateSplitFromPointer(event);
    });
    const stopDragging = (event) => {
      dragging = false;
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    stage.addEventListener("pointerup", stopDragging);
    stage.addEventListener("pointercancel", stopDragging);
    stage.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        setSplit(splitPercent + (event.key === "ArrowLeft" ? -2 : 2));
        event.preventDefault();
      }
    });

    const controls = mk("div", "h3s-upscale-compare-controls");
    const play = mk("button", "h3s-btn", "播放");
    play.disabled = true;
    const timeline = document.createElement("input");
    timeline.type = "range";
    timeline.min = "0";
    timeline.max = "0";
    timeline.step = "0.01";
    timeline.value = "0";
    const time = mk("span", "h3s-upscale-state h3s-upscale-compare-time", "00:00 / 00:00");
    const mediaState = mk("span", "h3s-upscale-state h3s-upscale-compare-media", "正在读取原视频和超分视频…");
    const mediaReady = { source: false, result: false };
    const mediaErrors = { source: "", result: "" };
    const formatTime = (seconds) => {
      const safe = Math.max(0, Number(seconds) || 0);
      const minutes = Math.floor(safe / 60);
      const remainder = Math.floor(safe % 60);
      return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    };
    const syncResultTime = () => {
      if (mediaReady.result && Number.isFinite(sourceVideo.currentTime)
          && Math.abs((Number(resultVideo.currentTime) || 0) - sourceVideo.currentTime) > 0.08) {
        const resultDuration = Number(resultVideo.duration) || sourceVideo.currentTime;
        resultVideo.currentTime = Math.min(sourceVideo.currentTime, resultDuration);
      }
    };
    const refreshTime = () => {
      const duration = Number(sourceVideo.duration) || 0;
      timeline.max = String(duration);
      timeline.value = String(Math.min(duration, Number(sourceVideo.currentTime) || 0));
      time.textContent = `${formatTime(sourceVideo.currentTime)} / ${formatTime(duration)}`;
      syncResultTime();
    };
    const refreshMediaState = () => {
      const errors = [mediaErrors.source, mediaErrors.result].filter(Boolean);
      mediaState.classList.toggle("error", errors.length > 0);
      if (errors.length) {
        mediaState.textContent = errors.join(" ");
        play.disabled = true;
        return;
      }
      if (!mediaReady.source || !mediaReady.result) {
        mediaState.textContent = `正在读取${mediaReady.source ? "超分视频" : mediaReady.result ? "原视频" : "原视频和超分视频"}…`;
        play.disabled = true;
        return;
      }
      const sourceDuration = Number(sourceVideo.duration) || 0;
      const resultDuration = Number(resultVideo.duration) || 0;
      const durationDifference = Math.abs(sourceDuration - resultDuration);
      mediaState.textContent = durationDifference > Math.max(0.25, sourceDuration * 0.01)
        ? `两段视频已加载，但时长不一致（${formatTime(sourceDuration)} / ${formatTime(resultDuration)}）；请检查超分编码结果。`
        : "原视频和超分视频均已加载。";
      mediaState.classList.toggle("error", durationDifference > Math.max(0.25, sourceDuration * 0.01));
      play.disabled = false;
    };
    const markLoaded = (key, video, label) => {
      const duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        mediaErrors[key] = `${label}没有可读取的时长；请检查媒体文件完整性。`;
        mediaReady[key] = false;
      } else {
        mediaErrors[key] = "";
        mediaReady[key] = true;
      }
      refreshMediaState();
    };
    sourceVideo.addEventListener("loadedmetadata", () => {
      markLoaded("source", sourceVideo, "原视频");
      refreshTime();
    });
    resultVideo.addEventListener("loadedmetadata", () => {
      markLoaded("result", resultVideo, "超分视频");
      syncResultTime();
    });
    sourceVideo.addEventListener("error", () => {
      mediaReady.source = false;
      mediaErrors.source = h3UpscaleMediaErrorMessage("原视频", sourceVideo.error);
      refreshMediaState();
    });
    resultVideo.addEventListener("error", () => {
      mediaReady.result = false;
      mediaErrors.result = h3UpscaleMediaErrorMessage("超分视频", resultVideo.error);
      refreshMediaState();
    });
    sourceVideo.addEventListener("timeupdate", refreshTime);
    sourceVideo.addEventListener("seeking", syncResultTime);
    sourceVideo.addEventListener("play", () => {
      syncResultTime();
      play.textContent = "暂停";
      resultVideo.play().catch(() => {});
    });
    sourceVideo.addEventListener("pause", () => {
      play.textContent = "播放";
      resultVideo.pause();
      syncResultTime();
    });
    sourceVideo.addEventListener("ended", () => resultVideo.pause());
    play.addEventListener("click", () => {
      if (sourceVideo.paused) sourceVideo.play().catch(() => {});
      else sourceVideo.pause();
    });
    timeline.addEventListener("input", () => {
      sourceVideo.currentTime = Number(timeline.value) || 0;
      if (mediaReady.result) resultVideo.currentTime = Math.min(
        sourceVideo.currentTime, Number(resultVideo.duration) || sourceVideo.currentTime);
      refreshTime();
    });
    controls.append(play, timeline, time, mediaState);

    comparison.append(stage, controls);
    container.appendChild(comparison);
    const cleanup = () => {
      sourceVideo.pause();
      resultVideo.pause();
      sourceVideo.removeAttribute("src");
      resultVideo.removeAttribute("src");
      sourceVideo.load();
      resultVideo.load();
      comparison.remove();
      if (cleanupUpscaleComparison === cleanup) cleanupUpscaleComparison = null;
    };
    cleanupUpscaleComparison = cleanup;
    return true;
  };
  const availableUpscaleModels = (refresh = false) => {
    if (!refresh && Array.isArray(upscaleModelsCache)) return Promise.resolve([...upscaleModelsCache]);
    if (upscaleModelsRequest) {
      if (!refresh) return upscaleModelsRequest;
      return upscaleModelsRequest.catch(() => []).then(() => availableUpscaleModels(true));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    upscaleModelsRequest = api.fetchApi("/h3director/list_upscale_models", { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok || !Array.isArray(payload.models)) {
          throw new Error(payload.error || ("HTTP " + response.status));
        }
        upscaleModelsCache = payload.models.filter((value) => typeof value === "string" && value);
        return [...upscaleModelsCache];
      })
      .catch((error) => {
        if (error && error.name === "AbortError") throw new Error("读取超分模型列表超时，请重启 ComfyUI 后重试");
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        upscaleModelsRequest = null;
      });
    return upscaleModelsRequest;
  };
  const installUpscaleModelFile = async (file) => {
    if (!file || !/\.(?:pth|pt|safetensors)$/i.test(file.name || "")) {
      throw new Error("请选择 .pth、.pt 或 .safetensors 超分模型文件");
    }
    const data = new FormData();
    data.append("model", file, file.name);
    const response = await api.fetchApi("/h3director/install_upscale_model", {
      method: "POST", body: data,
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.model_name) {
      throw new Error(result.error || ("HTTP " + response.status));
    }
    upscaleSettings.mode = "AI模型超分";
    upscaleSettings.model_name = result.model_name;
    await availableUpscaleModels(true);
    upscaleModelMessage = `已安装并显示：${result.model_name}`;
    persistUpscaleState();
  };
  const downloadUpscaleCatalogModel = async (catalogId) => {
    const selected = H3_UPSCALE_MODEL_CATALOG.find((item) => item.id === catalogId);
    if (!selected) throw new Error("请选择要安装的超分模型");
    const response = await api.fetchApi("/h3director/download_upscale_model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalog_id: selected.id }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.model_name) {
      throw new Error(result.error || ("HTTP " + response.status));
    }
    upscaleSettings.mode = "AI模型超分";
    upscaleSettings.model_name = result.model_name;
    await availableUpscaleModels(true);
    upscaleModelMessage = `下载、校验并安装完成：${result.model_name}`;
    persistUpscaleState();
  };
  const deleteUpscaleModel = async (modelName) => {
    const response = await api.fetchApi("/h3director/delete_upscale_model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_name: modelName }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP " + response.status));
    if (upscaleSettings.model_name === modelName) upscaleSettings.model_name = "";
    await availableUpscaleModels(true);
    upscaleModelMessage = `已删除：${result.model_name || modelName}；其他模型未受影响。`;
    persistUpscaleState();
  };
  const uploadUpscaleVideo = async (file) => {
    if (!file || !/^video\//i.test(file.type || "")
        && !/\.(?:mp4|webm|mov|mkv|avi)$/i.test(file.name || "")) {
      throw new Error("请选择 MP4、WebM、MOV、MKV 或 AVI 视频");
    }
    const data = new FormData();
    data.append("video", file, file.name);
    const response = await api.fetchApi("/h3director/upload_video", { method: "POST", body: data });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.name) {
      throw new Error(result.error || ("HTTP " + response.status));
    }
    const sourceFile = h3InputVideoSource(result.name);
    if (!sourceFile) throw new Error("上传后的视频名称不合法");
    upscaleSource = {
      source_file: sourceFile,
      label: result.label || file.name,
      preview: "/view?" + new URLSearchParams({ filename: result.name, type: "input" }).toString(),
    };
    closeUpscaleComparison();
    upscaleResult = null;
    upscaleRunMessage = "视频已加载；设置参数后点击“开始超分”。";
    persistUpscaleState();
    renderEditor();
  };

  function renderUpscaleEditor() {
    editor.classList.add("h3s-editor-create");
    const root = mk("div", "h3s-upscale");
    const left = mk("div", "h3s-upscale-col");
    const right = mk("div", "h3s-upscale-col");
    editor.appendChild(root);
    root.append(left, right);

    const sourceCard = mk("section", "h3s-upscale-card");
    sourceCard.appendChild(mk("div", "h3s-upscale-card-title", "原视频"));
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "video/*,.mp4,.webm,.mov,.mkv,.avi";
    picker.hidden = true;
    const drop = mk("div", "h3s-upscale-drop",
      upscaleSource ? "点击更换视频，或把新视频拖到这里" : "点击选择视频\n或把 MP4 / WebM / MOV / MKV / AVI 拖到这里");
    const choose = () => { if (!upscaleRunning) picker.click(); };
    drop.addEventListener("click", choose);
    drop.addEventListener("dragover", (event) => {
      event.preventDefault(); event.stopPropagation(); drop.classList.add("drop");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drop"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault(); event.stopPropagation(); drop.classList.remove("drop");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file || upscaleRunning) return;
      upscaleRunMessage = "正在复制视频到 ComfyUI input…";
      renderEditor();
      uploadUpscaleVideo(file).catch((error) => {
        upscaleRunMessage = "加载视频失败：" + error.message;
        renderEditor();
      });
    });
    picker.addEventListener("change", () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      upscaleRunMessage = "正在复制视频到 ComfyUI input…";
      renderEditor();
      uploadUpscaleVideo(file).catch((error) => {
        upscaleRunMessage = "加载视频失败：" + error.message;
        renderEditor();
      });
    });
    sourceCard.append(drop, picker);
    if (upscaleSource) {
      const sourceLabel = mk("div", "h3s-upscale-state", upscaleSource.label || "已加载视频");
      const sourceVideo = document.createElement("video");
      sourceVideo.className = "h3s-upscale-video";
      sourceVideo.controls = true;
      sourceVideo.preload = "metadata";
      sourceVideo.src = upscalePreviewUrl(upscaleSource);
      sourceCard.append(sourceLabel, sourceVideo);
    }
    left.appendChild(sourceCard);

    const settingsCard = mk("section", "h3s-upscale-card");
    settingsCard.appendChild(mk("div", "h3s-upscale-card-title", "超分设置"));
    const settingsGrid = mk("div", "h3s-upscale-settings");
    const modeSelect = document.createElement("select");
    for (const value of ["AI模型超分", "Lanczos普通放大"]) {
      const option = document.createElement("option"); option.value = value; option.textContent = value;
      modeSelect.appendChild(option);
    }
    modeSelect.value = upscaleSettings.mode;
    const modelSelect = document.createElement("select");
    modelSelect.innerHTML = '<option value="">正在读取模型…</option>';
    const modelPicker = document.createElement("input");
    modelPicker.type = "file";
    modelPicker.accept = ".pth,.pt,.safetensors";
    modelPicker.hidden = true;
    const scaleInput = document.createElement("input");
    scaleInput.type = "number"; scaleInput.min = "1"; scaleInput.max = "4"; scaleInput.step = "0.5";
    scaleInput.value = String(upscaleSettings.output_scale);
    const batchInput = document.createElement("input");
    batchInput.type = "number"; batchInput.min = "1"; batchInput.max = "32"; batchInput.step = "1";
    batchInput.value = String(upscaleSettings.frame_batch_size);
    const filenameInput = document.createElement("input");
    filenameInput.type = "text"; filenameInput.maxLength = 160;
    filenameInput.value = upscaleSettings.filename_prefix;
    const syncSettings = () => {
      upscaleSettings = normalizeH3UpscaleSettings({
        mode: modeSelect.value,
        model_name: modelSelect.dataset.loaded === "1" ? modelSelect.value : upscaleSettings.model_name,
        output_scale: scaleInput.value,
        frame_batch_size: batchInput.value,
        filename_prefix: filenameInput.value,
      });
      modelSelect.disabled = upscaleRunning || upscaleModelBusy || upscaleSettings.mode !== "AI模型超分";
      persistUpscaleState();
    };
    modeSelect.addEventListener("change", () => { syncSettings(); renderEditor(); });
    modelSelect.addEventListener("change", syncSettings);
    scaleInput.addEventListener("change", syncSettings);
    batchInput.addEventListener("change", syncSettings);
    filenameInput.addEventListener("change", syncSettings);
    settingsGrid.append(
      mk("label", null, "处理方式"), modeSelect,
      mk("label", null, "超分模型"), modelSelect,
      mk("label", null, "输出倍率"), scaleInput,
      mk("label", null, "每批帧数"), batchInput,
      mk("label", null, "输出文件名"), filenameInput,
    );
    settingsCard.appendChild(settingsGrid);
    const modelHint = mk("div", "h3s-upscale-state",
      upscaleSettings.mode === "AI模型超分"
        ? "AI模式复用 ComfyUI 官方 UPSCALE_MODEL；2×输出更适合成片。每批帧数只控制显存峰值，不改变视频帧率和时长；长成片仍会占用较多系统内存，建议优先逐段处理。"
        : "Lanczos 无需模型，只改变尺寸，不会生成新的真实细节；长成片仍会占用较多系统内存，建议优先逐段处理。");
    settingsCard.appendChild(modelHint);
    const installRow = mk("div", "h3s-upscale-install");
    const catalogSelect = document.createElement("select");
    for (const item of H3_UPSCALE_MODEL_CATALOG) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      catalogSelect.appendChild(option);
    }
    catalogSelect.disabled = upscaleRunning || upscaleModelBusy;
    const installDomestic = mk("button", "h3s-btn",
      upscaleModelOperation === "download" ? "下载中…" : "一键国内安装");
    installDomestic.title = "仅在点击后从固定魔搭仓库下载；完成后校验文件大小和 SHA-256，不覆盖同名模型";
    installDomestic.disabled = upscaleRunning || upscaleModelBusy;
    installDomestic.addEventListener("click", async () => {
      if (upscaleRunning || upscaleModelBusy) return;
      const selected = H3_UPSCALE_MODEL_CATALOG.find((item) => item.id === catalogSelect.value)
        || H3_UPSCALE_MODEL_CATALOG[0];
      if (!selected) return;
      upscaleModelBusy = true;
      upscaleModelOperation = "download";
      upscaleModelMessage = `正在下载 ${selected.filename}；下载完成后会自动校验并显示在超分模型列表中…`;
      renderEditor();
      try {
        await downloadUpscaleCatalogModel(selected.id);
      } catch (error) {
        upscaleModelMessage = "下载或安装失败：" + error.message;
      } finally {
        upscaleModelBusy = false;
        upscaleModelOperation = "";
        if (!cleaned && curTab() === "upscale") renderEditor();
      }
    });
    const installLocal = mk("button", "h3s-btn", "安装本地模型");
    installLocal.title = "选择已经下载的 .pth/.pt/.safetensors，安装到当前 ComfyUI 配置的 upscale_models 目录";
    installLocal.disabled = upscaleRunning || upscaleModelBusy;
    installLocal.addEventListener("click", () => {
      if (!upscaleRunning && !upscaleModelBusy) modelPicker.click();
    });
    modelPicker.addEventListener("change", async () => {
      const file = modelPicker.files && modelPicker.files[0];
      if (!file) return;
      upscaleModelBusy = true;
      upscaleModelOperation = "local";
      upscaleModelMessage = `正在安装本地模型 ${file.name}…`;
      renderEditor();
      try {
        await installUpscaleModelFile(file);
      } catch (error) {
        upscaleModelMessage = "本地模型安装失败：" + error.message;
      } finally {
        upscaleModelBusy = false;
        upscaleModelOperation = "";
        if (!cleaned && curTab() === "upscale") renderEditor();
      }
    });
    const refreshModels = mk("button", "h3s-btn", "刷新列表");
    refreshModels.title = "重新读取 ComfyUI 的 UPSCALE_MODEL 列表";
    refreshModels.disabled = upscaleRunning || upscaleModelBusy;
    refreshModels.addEventListener("click", async () => {
      if (upscaleRunning || upscaleModelBusy) return;
      upscaleModelBusy = true;
      upscaleModelOperation = "refresh";
      upscaleModelMessage = "正在刷新超分模型列表…";
      renderEditor();
      try {
        const models = await availableUpscaleModels(true);
        upscaleModelMessage = models.length
          ? `刷新完成，共检测到 ${models.length} 个超分模型。`
          : "刷新完成，当前没有检测到 UPSCALE_MODEL。";
      } catch (error) {
        upscaleModelMessage = "刷新失败：" + error.message;
      } finally {
        upscaleModelBusy = false;
        upscaleModelOperation = "";
        if (!cleaned && curTab() === "upscale") renderEditor();
      }
    });
    const deleteModel = mk("button", "h3s-btn danger", "删除模型");
    deleteModel.title = "只删除当前下拉框选中的本地超分模型文件";
    deleteModel.disabled = true;
    deleteModel.addEventListener("click", async () => {
      const modelName = modelSelect.dataset.loaded === "1" ? String(modelSelect.value || "") : "";
      if (!modelName || upscaleRunning || upscaleModelBusy) return;
      if (!window.confirm(`确定删除超分模型“${modelName}”吗？\n此操作只删除这个本地模型文件，不能撤销。`)) return;
      upscaleModelBusy = true;
      upscaleModelOperation = "delete";
      upscaleModelMessage = `正在删除 ${modelName}…`;
      renderEditor();
      try {
        await deleteUpscaleModel(modelName);
      } catch (error) {
        upscaleModelMessage = "删除模型失败：" + error.message;
      } finally {
        upscaleModelBusy = false;
        upscaleModelOperation = "";
        if (!cleaned && curTab() === "upscale") renderEditor();
      }
    });
    installRow.append(catalogSelect, installDomestic, installLocal, refreshModels, deleteModel, modelPicker);
    const modelStatus = mk("div", "h3s-upscale-model-status" + (upscaleModelBusy ? " busy" : ""),
      upscaleModelMessage || "模型操作状态会显示在这里。安装完成后模型会自动出现在上方“超分模型”列表。" );
    settingsCard.append(
      installRow,
      modelStatus,
      mk("div", "h3s-upscale-state",
        "选择模型类型后点“一键国内安装”，插件只在这次点击后从固定魔搭仓库下载，校验大小与 SHA-256 后安装到当前 ComfyUI 配置的 upscale_models 目录；不会后台下载或覆盖同名文件。也可用“安装本地模型”导入已有文件。“删除模型”只删除当前选中项并会再次确认。"),
    );
    availableUpscaleModels().then((models) => {
      if (!modelSelect.isConnected) return;
      modelSelect.innerHTML = "";
      modelSelect.dataset.loaded = "1";
      if (!models.length) {
        const option = document.createElement("option"); option.value = "";
        option.textContent = "未检测到 UPSCALE_MODEL"; modelSelect.appendChild(option);
      } else {
        for (const value of models) {
          const option = document.createElement("option"); option.value = value; option.textContent = value;
          modelSelect.appendChild(option);
        }
        modelSelect.value = models.includes(upscaleSettings.model_name)
          ? upscaleSettings.model_name : models[0];
        upscaleSettings.model_name = modelSelect.value;
      }
      syncSettings();
      deleteModel.disabled = upscaleRunning || upscaleModelBusy || !modelSelect.value;
    }).catch((error) => {
      if (!modelSelect.isConnected) return;
      modelSelect.innerHTML = '<option value="">模型列表读取失败</option>';
      modelSelect.dataset.loaded = "1";
      modelHint.textContent = "超分模型列表读取失败：" + error.message;
      if (!upscaleModelMessage) modelStatus.textContent = "模型列表读取失败：" + error.message;
      syncSettings();
      deleteModel.disabled = true;
    });
    modelSelect.addEventListener("change", () => {
      deleteModel.disabled = upscaleRunning || upscaleModelBusy || !modelSelect.value;
    });
    const actions = mk("div", "h3s-upscale-actions");
    const runUpscale = mk("button", "h3s-btn primary", upscaleRunning ? "超分处理中…" : "开始超分");
    runUpscale.disabled = upscaleRunning || upscaleModelBusy || !upscaleSource;
    runUpscale.addEventListener("click", async () => {
      syncSettings();
      try {
        const output = buildH3VideoUpscalePrompt(upscaleSource && upscaleSource.source_file, upscaleSettings);
        upscaleRunning = true;
        upscaleEarlyEvents.clear();
        upscaleProgress = 0;
        upscaleProgressText = "正在等待 ComfyUI 执行";
        upscaleResult = null;
        upscaleRunMessage = "已提交超分任务；可在 ComfyUI 队列查看进度。";
        persistUpscaleState();
        renderEditor();
        const queued = await api.queuePrompt(0, {
          output,
          workflow: app.graph && typeof app.graph.serialize === "function" ? app.graph.serialize() : {},
        });
        const promptId = String(queued && queued.prompt_id || "");
        if (!promptId) throw new Error("ComfyUI 没有返回超分任务 ID");
        if (upscaleRunning) {
          upscalePromptId = promptId;
          const early = upscaleEarlyEvents.get(promptId);
          upscaleEarlyEvents.clear();
          if (early && early.type === "failure") {
            failUpscale(early.detail);
          } else if (early && early.type === "executed") {
            const result = h3UpscaleResultFromExecuted(early.detail);
            if (result) finishUpscale(result);
            else void recoverUpscaleFromHistory(promptId, true);
          } else {
            void recoverUpscaleFromHistory(promptId, !!early);
          }
        }
      } catch (error) {
        upscaleRunning = false;
        upscaleEarlyEvents.clear();
        upscaleProgress = 0;
        upscaleProgressText = "未开始";
        upscalePromptId = "";
        upscaleRunMessage = "超分任务未开始：" + error.message;
        renderEditor();
      }
    });
    const progress = mk("div", "h3s-upscale-progress");
    const progressHead = mk("div", "h3s-upscale-progress-head");
    progressHead.append(
      mk("span", "h3s-upscale-progress-label", upscaleProgressText),
      mk("span", "h3s-upscale-progress-percent", `${Math.round(upscaleProgress)}%`),
    );
    const progressTrack = mk("div", "h3s-upscale-progress-track");
    const progressFill = mk("div", "h3s-upscale-progress-fill");
    progressFill.style.width = `${Math.min(100, Math.max(0, upscaleProgress))}%`;
    progressTrack.appendChild(progressFill);
    progress.append(progressHead, progressTrack, mk("span", "h3s-upscale-state", upscaleRunMessage));
    actions.append(runUpscale, progress);
    settingsCard.appendChild(actions);
    left.appendChild(settingsCard);

    const resultCard = mk("section", "h3s-upscale-card");
    resultCard.appendChild(mk("div", "h3s-upscale-card-title", "超分结果"));
    if (upscaleResult) {
      const resultUrl = upscaleResultUrl(upscaleResult, Date.now());
      const comparisonHost = mk("div", "h3s-upscale-compare-host");
      if (!mountUpscaleComparison(comparisonHost, resultUrl)) {
        const resultVideo = document.createElement("video");
        resultVideo.className = "h3s-upscale-video";
        resultVideo.controls = true;
        resultVideo.preload = "metadata";
        if (resultUrl) resultVideo.src = resultUrl;
        const resultMediaState = mk("div", "h3s-upscale-state",
          resultUrl ? "正在读取超分视频…" : "超分结果路径不合法，无法打开视频。");
        resultMediaState.classList.toggle("error", !resultUrl);
        resultVideo.addEventListener("loadedmetadata", () => {
          resultMediaState.textContent = Number(resultVideo.duration) > 0
            ? "超分视频已加载。" : "超分视频没有可读取的时长；请检查媒体文件完整性。";
        });
        resultVideo.addEventListener("error", () => {
          resultMediaState.classList.add("error");
          resultMediaState.textContent = h3UpscaleMediaErrorMessage("超分视频", resultVideo.error);
        });
        comparisonHost.append(resultVideo, resultMediaState);
      }
      const resultActions = mk("div", "h3s-upscale-actions");
      const external = mk("button", "h3s-btn", "新窗口查看");
      external.disabled = !resultUrl;
      external.addEventListener("click", () => { if (resultUrl) window.open(resultUrl, "_blank"); });
      resultActions.append(external, mk("span", "h3s-upscale-state",
        (upscaleResult.subfolder ? upscaleResult.subfolder + "/" : "") + upscaleResult.filename));
      const dimensions = upscaleResult.source_width && upscaleResult.source_height
        && upscaleResult.output_width && upscaleResult.output_height
        ? `${upscaleResult.source_width}×${upscaleResult.source_height} → ${upscaleResult.output_width}×${upscaleResult.output_height}`
        : "输出尺寸以生成文件为准";
      const qualityNote = upscaleResult.mode === "Lanczos普通放大"
        ? `${dimensions}。本次是 Lanczos 普通插值，只增加像素尺寸，不会生成新的面部、纹理或真实细节；肉眼看起来接近原片属于正常结果。`
        : `${dimensions}。本次使用 AI 模型超分，新增细节和锐度取决于所选 UPSCALE_MODEL；请并排对比人物脸部、发丝、建筑边缘和纹理。`;
      resultCard.append(
        mk("div", "h3s-upscale-state", "在画面内左右拖动分割线对比；播放、暂停和时间跳转会保持同步，只播放原视频声音。"),
        comparisonHost,
        mk("div", "h3s-upscale-state", qualityNote),
        resultActions,
      );
    } else {
      resultCard.appendChild(mk("div", "h3s-upscale-drop",
        upscaleRunning ? "正在处理视频…\n完成后会在这里显示新文件" : "尚未生成超分结果\n原视频会始终保留"));
    }
    right.appendChild(resultCard);
  }

  function renderEditor() {
    stopAssetAudioPreview();
    disconnectEditorObservers();
    closeAssetMentionPopup();
    closeUpscaleComparison();
    createProjectControls.clear();
    editor.innerHTML = "";
    editor.className = "h3s-editor";
    durInput = null;
    picHintEl = null;
    const _m = curMode();
    syncSecondSamplePanel();
    if (curTab() === "upscale") {
      editor.dataset.h3Mode = "upscale";
      renderUpscaleEditor();
      return;
    }
    const expectedSegs = _m === "video" ? videoSegs : _m === "text" ? textSegs : createSegs;
    if (segs !== expectedSegs) segs = expectedSegs;
    if (_m === "create" && refreshCreatePromptAssetBindings()) scheduleSave();
    sel = Math.max(0, Math.min(sel, segs.length - 1));
    editor.dataset.h3Mode = _m;
    const s = segs[sel];
    if (!s) return;
    /* 面板级界面切换（v2.1 视频 / v2.11 文本）：创作=完整编辑器；视频=参考视频整版；文本=纯提示词整版 */
    if (_m === "video") { renderVideoEditor(s); return; }
    if (_m === "text") { renderTextEditor(s); return; }

    /* 方案 A：创作界面使用左右工作台。左边处理剧本、全局规则和当前段提示词；
       右边集中角色、声音和预览。只改变 DOM 排列，不改变任何工作流字段或序列化格式。 */
    editor.classList.add("h3s-editor-create");
    const createMain = mk("div", "h3s-create-col h3s-create-main");
    const createSide = mk("div", "h3s-create-col h3s-create-side");
    editor.append(createMain, createSide);
    const card = (title, cls = "") => {
      const el = mk("section", "h3s-card" + (cls ? " " + cls : ""));
      el.appendChild(mk("div", "h3s-card-title", title));
      return el;
    };

    let gpTa = null;
    const makeImportedCreateSeg = (parsedSeg, source, position, sharedOnly = false,
      plannedUseTail = null, sourceContract = null) => {
      const out = source && !sharedOnly ? { ...source } : {
        seed: Math.floor(Math.random() * 1e15),
        refs: [],
        duration: 10,
        inherit_shared: true,
        use_tail: position > 0,
        enabled: true,
        force: false,
        fps: source && source.fps || 24,
      };
      if (source) {
        out.refs = Array.isArray(source.refs) ? source.refs.slice() : [];
        out.manual_refs = segmentManualAssetFiles(source);
        out.parsed_refs = [];
        out.auto_refs = [];
        out.voice_refs = Array.isArray(source.voice_refs) ? source.voice_refs.slice() : [];
        out.voice_labels = source.voice_labels ? { ...source.voice_labels } : {};
      }
      out.duration = clampDur(parsedSeg.duration > 0 ? parsedSeg.duration : 10);
      out.inherit_shared = true;
      setSegmentPreviousTail(out, position > 0 && (plannedUseTail == null ? true : !!plannedUseTail));
      if (parsedSeg.tailPlan) {
        out.tail_plan = parsedSeg.tailPlan;
        out.tail_reason = parsedSeg.tailReason || "";
      } else {
        delete out.tail_plan;
        delete out.tail_reason;
      }
      out.parsed_asset_ids = Array.isArray(parsedSeg.assetIds) ? parsedSeg.assetIds.slice() : [];
      out.enabled = true;
      out.force = false;
      if (!Array.isArray(out.refs)) out.refs = [];
      if (!Array.isArray(out.manual_refs)) out.manual_refs = out.refs.slice();
      if (!Array.isArray(out.parsed_refs)) out.parsed_refs = [];
      out.auto_refs = [];
      delete out.asset_confirmation_missing_types;
      delete out.asset_confirmation_required;
      delete out.asset_only_prompt_import;
      const boundAssets = out.refs.map((file) => {
        const meta = getRefAssetMeta(node, file);
        return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
          aliases: meta.aliases, filename: meta.filename };
      });
      out.prompt = bindOrdinaryPromptToAssets(parsedSeg.prompt, boundAssets, out.use_tail);
      if (!source) applySecondSampleDefault(out);
      return applyParsedSourceContract(out, sourceContract, parsedSeg);
    };

    const applyCreateParsedGlobal = (parsed) => {
      const gExisting = modeGlobalPrompt("create").trim();
      const offStyle = parsed.globalStyle || "";
      const offExtra = parsed.globalExtra || "";
      const lastAuto = String(node.properties.h3_create_auto_global_value || "").trim();
      const replacingPreviousAuto = !!lastAuto && gExisting === lastAuto;
      const canUpgradeAuto = !!gExisting && !!offStyle
        && ((lastAuto && gExisting === lastAuto)
          || (gExisting.length >= 24 && gExisting.length < offStyle.length
            && offStyle.toLowerCase().includes(gExisting.toLowerCase())));
      const setGlobal = (value) => {
        setModeGlobalPrompt("create", value);
        if (gpTa) gpTa.value = value;
      };
      if (parsed.officialFormat === "ref2va" && !offStyle && !offExtra) {
        if (gExisting && lastAuto && gExisting === lastAuto) {
          setGlobal("");
          node.properties.h3_create_auto_global_value = "";
          return "；Ref2VA 六字段已逐段保留，已清除上一份自动全局提示词";
        }
        return gExisting
          ? "（Ref2VA 每段已自包含；全局框为手填内容，未覆盖）"
          : "；Ref2VA 六字段已逐段完整保留，无需重复全局提示词";
      }
      if (!gExisting || canUpgradeAuto || replacingPreviousAuto) {
        const joined = [offStyle, offExtra].filter(Boolean).join("\n\n");
        const value = joined || (parsed.official ? "" : extractGlobalPrompt(parsed));
        if (value || replacingPreviousAuto) {
          setGlobal(value);
          node.properties.h3_create_auto_global_value = value;
          return value
            ? (canUpgradeAuto || replacingPreviousAuto
              ? "；已更新自动全局提示词（只保留跨段共享身份/风格/限制）"
              : "；已自动提取安全共享提示词到全局框")
            : "；检测到换场/换风格，已清除上一份自动全局提示词";
        }
      } else if (offExtra && !/soundscape\s*[:：]/i.test(gExisting)) {
        const value = gExisting + "\n\n" + offExtra;
        setGlobal(value);
        if (lastAuto && gExisting === lastAuto) node.properties.h3_create_auto_global_value = value;
        return "；已把音效/配乐字段追加到全局框";
      }
      return gExisting ? "（全局框已有手填内容，未覆盖）" : "";
    };

    const activeCreateProjectId = String(node.properties.h3_create_active_project_id || "");
    const activeCreateProject = getH3Project(createProjectStore, activeCreateProjectId)
      || (createProjectStore && createProjectStore.projects[0]);
    const projectCard = card("成片", "h3s-card-projects");
    createMain.appendChild(projectCard);
    const projectPicker = registerCreateProjectControl(document.createElement("select"));
    projectPicker.style.cssText = "min-width:220px;flex:1;";
    const formatProjectTime = (value) => {
      const date = new Date(Number(value) || Date.now());
      const two = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
    };
    for (const project of (createProjectStore && createProjectStore.projects) || []) {
      const option = document.createElement("option");
      option.value = project.id;
      const segmentCount = project.state && Array.isArray(project.state.segments) ? project.state.segments.length : 0;
      option.textContent = `${project.name}｜${segmentCount}段｜${formatProjectTime(project.updated_at)}`;
      projectPicker.appendChild(option);
    }
    projectPicker.value = activeCreateProject ? activeCreateProject.id : "";
    projectPicker.addEventListener("change", () => {
      if (!switchCreateProject(projectPicker.value)) projectPicker.value = activeCreateProjectId;
    });
    const projectName = mk("input", "h3s-role-name");
    projectName.value = activeCreateProject ? activeCreateProject.name : "";
    projectName.placeholder = "成片名称";
    projectName.style.cssText = "min-width:150px;flex:1;";
    const projectTop = mk("div", "h3s-row");
    projectTop.append(projectPicker, projectName);
    projectCard.appendChild(projectTop);
    const projectInfo = mk("div", "h3s-hint", activeCreateProject
      ? `当前 ${activeCreateProject.state.segments.length} 段｜最近保存 ${formatProjectTime(activeCreateProject.updated_at)}`
      : "当前成片数据不可用");
    projectCard.appendChild(projectInfo);
    if (activeCreateProject) {
      const requestedProjectId = activeCreateProject.id;
      fetchProjectStatus().then((data) => {
        if (!projectInfo.isConnected || node.properties.h3_create_active_project_id !== requestedProjectId) return;
        const generated = Object.values(data && data.segments || {}).filter((item) => item && item.video).length;
        projectInfo.textContent += `｜已生成 ${generated} 段`;
      }).catch(() => { /* 媒体状态不可用不影响项目保存和切换 */ });
    }
    const projectActions = mk("div", "h3s-row");
    const btnProjectSave = registerCreateProjectControl(mk("button", "h3s-btn primary", "保存当前"));
    btnProjectSave.addEventListener("click", () => {
      save();
      renderEditor();
      status.style.color = "";
      status.textContent = "当前成片已保存";
    });
    const btnProjectNew = registerCreateProjectControl(mk("button", "h3s-btn", "新建"));
    btnProjectNew.addEventListener("click", () => {
      save();
      const added = addH3Project(createProjectStore, "", emptyCreateProjectState(), newProjectId);
      persistCreateProjectStore();
      switchCreateProject(added.project.id, "已新建空白成片，可随时切回原成片");
    });
    const btnProjectCopy = registerCreateProjectControl(mk("button", "h3s-btn", "复制"), !!activeCreateProject);
    btnProjectCopy.addEventListener("click", () => {
      save();
      const copied = duplicateH3Project(createProjectStore, activeCreateProjectId, newProjectId);
      if (!copied.project) return;
      persistCreateProjectStore();
      switchCreateProject(copied.project.id,
        "已复制可编辑状态；外部插入视频属于原成片目录，需要重新导入");
    });
    const btnProjectRename = registerCreateProjectControl(mk("button", "h3s-btn", "重命名"), !!activeCreateProject);
    btnProjectRename.addEventListener("click", () => {
      save();
      renameH3Project(createProjectStore, activeCreateProjectId, projectName.value);
      persistCreateProjectStore();
      renderEditor();
      status.style.color = "";
      status.textContent = "成片已重命名；project_id 和已有媒体目录不变";
    });
    const btnProjectDelete = registerCreateProjectControl(mk("button", "h3s-btn", "删除"),
      !!activeCreateProject && createProjectStore.projects.length > 1);
    let projectDeleteArmed = false;
    btnProjectDelete.addEventListener("click", () => {
      if (!projectDeleteArmed) {
        projectDeleteArmed = true;
        btnProjectDelete.textContent = "再点确认删除";
        btnProjectDelete.style.background = "#8a2f2f";
        btnProjectDelete.style.borderColor = "#c05555";
        status.textContent = "只删除成片项目记录，不删除磁盘视频、尾帧、图片或音频；再点一次确认";
        return;
      }
      save();
      const beforeDelete = cloneH3ProjectValue(createProjectStore);
      const deleted = deleteH3Project(createProjectStore, activeCreateProjectId,
        emptyCreateProjectState(), newProjectId);
      if (!deleted.deleted) {
        status.textContent = "至少保留一个成片；可使用“全部清空”重置当前成片";
        return;
      }
      persistCreateProjectStore();
      if (!switchCreateProject(deleted.activeId, "成片记录已删除；磁盘媒体文件未删除")) {
        createProjectStore = beforeDelete;
        node.properties.h3_create_active_project_id = activeCreateProjectId;
        const restoredProject = getH3Project(createProjectStore, activeCreateProjectId);
        applyingCreateProject = true;
        try {
          claimProjectId(activeCreateProjectId);
          applyCreateProjectState(restoredProject);
          persistCreateProjectStore();
          save();
        } finally {
          applyingCreateProject = false;
        }
        renderTimeline();
        renderEditor();
      }
    });
    const btnProjectRestore = registerCreateProjectControl(
      mk("button", "h3s-btn", "恢复清空前状态"), !!(activeCreateProject && activeCreateProject.clear_backup));
    btnProjectRestore.title = "恢复当前成片最近一次“清空分段”或“全部清空”之前的状态";
    btnProjectRestore.addEventListener("click", () => restoreActiveCreateProjectBackup());
    projectActions.append(btnProjectSave, btnProjectNew, btnProjectCopy, btnProjectRename,
      btnProjectDelete, btnProjectRestore);
    projectCard.appendChild(projectActions);

    /* 创作界面脚本导入：复用文本界面的 Base / Ref2VA / 普通文本解析器。
       同序的手动参考、配音和音色保留；资产库图片只由用户拖入具体分段。 */
    const scriptCard = card("分镜脚本", "h3s-card-script");
    createMain.appendChild(scriptCard);
    scriptCard.appendChild(mk("div", "h3s-hint", "创意与分镜草稿"));
    const createScriptTa = mk("textarea", "h3s-ta");
    createScriptTa.placeholder = "输入创意、分镜、中文档案或结构化 JSON；输入 @ 可选择资产。需要补充时可写“剧情：”“人物：”“场景：”“镜头：”“动作：”“声音：”或“结尾：”。";
    createScriptTa.value = node.properties.h3_create_script || "";
    createScriptTa.addEventListener("input", () => {
      node.properties.h3_create_script = createScriptTa.value;
      markScriptDirty("create");
    });
    wireAssetMentionPicker(createScriptTa, createMentionAssetLibrary, (asset, mention, replace) => {
      replace(`@${asset.asset_id}（${asset.name}）`);
      node.properties.h3_create_script = createScriptTa.value;
      markScriptDirty("create");
      status.textContent = `已插入剧本资产标记 @${asset.asset_id}（${asset.name}）；解析时只分配给明确引用它的分镜`;
    });
    const mentionEditor = createAssetMentionEditor(createScriptTa);
    scriptCard.appendChild(mentionEditor);
    attachBottomBar(mentionEditor, 240, 60);

    const createImportRow = mk("div", "h3s-row");
    const btnCreateParse = mk("button", "h3s-btn primary", "分析导入全部段");
    btnCreateParse.title = "识别结构化 JSON、中文档案、普通剧本或 MiniMax H3 官方 Base / Ref2VA 模板，自动设置时长并替换创作界面全部分段；同序的手动参考、配音和音色保留";
    let createStoryAiActive = false;
    let createParseArmed = false;
    const disarmCreateParse = () => {
      createParseArmed = false;
      btnCreateParse.textContent = "分析导入全部段";
      btnCreateParse.style.background = "";
      btnCreateParse.style.borderColor = "";
    };
    const parseFullCreateScript = async ({ force = false, destination = "all" } = {}) => {
      if (createStoryAiActive) {
        status.textContent = "AI剧情只写入上方分镜脚本，不会自动解析；完成后请手动点击“分析导入全部段”";
        return false;
      }
      const text = createScriptTa.value;
      if (!text.trim()) { status.textContent = "脚本框是空的，先粘贴或载入官方模板"; return false; }
      const parsed = parseCreateScript(text);
      const durationError = rejectDurationInflation(parsed);
      if (durationError) { disarmCreateParse(); status.textContent = durationError; return false; }
      applyNormalizedScriptText(createScriptTa, "h3_create_script", parsed);
      if (!parsed.length) { status.textContent = "没有识别到任何内容"; return false; }
      const currentOnly = destination === "current";
      const parsedIndex = parsed.length === 1 ? 0 : sel;
      if (currentOnly && !parsed[parsedIndex]) {
        status.textContent = `脚本只解析出 ${parsed.length} 段，没有与当前段${sel + 1}对应的内容`;
        return false;
      }
      const parsedForImport = currentOnly ? [parsed[parsedIndex]] : [...parsed];
      const targetIndexes = currentOnly ? [sel] : parsedForImport.map((_segment, index) => index);
      const hasContent = createSegs.some((seg) => (seg.prompt || "").trim());
      if (!currentOnly && hasContent && !force && !createParseArmed) {
        createParseArmed = true;
        btnCreateParse.textContent = "确认替换当前 " + createSegs.length + " 段";
        btnCreateParse.style.background = "#8a2f2f";
        btnCreateParse.style.borderColor = "#c05555";
        const parsedType = parsed.officialLabel ? "（" + parsed.officialLabel + "）" : "";
        status.textContent = "解析出 " + parsed.length + " 段" + parsedType + "；" + formatParsedDuration(parsed)
          + formatTailPlanSummary(parsed)
          + "；再点一次红色按钮确认；同序手动参考、配音和音色会保留，结构化资产会生成槽位并按明确名称或 @编号匹配";
        return false;
      }
      disarmCreateParse();
      const previous = createSegs.slice();
      const hadMedia = targetIndexes.map((index) => previous[index]).filter(Boolean).some((seg) =>
        (Array.isArray(seg.refs) && seg.refs.length) || seg.audio
        || (Array.isArray(seg.voice_refs) && seg.voice_refs.length));
      const sourceContract = prepareParsedSourceContract(parsed);
      const assetLibraryBeforeImport = createGlobalAssetLibrary();
      const extractedSlots = currentOnly
        ? mergeCreateAssetSlots(node, parsed.assetDefinitions || [], assetLibraryBeforeImport)
        : replaceCreateAssetSlots(node, parsed.assetDefinitions || [], assetLibraryBeforeImport);
      const importedSegments = parsedForImport.map((parsedSeg, index) => {
        const targetIndex = targetIndexes[index];
        const imported = makeImportedCreateSeg(
          parsedSeg, previous[targetIndex] || null, targetIndex, false,
          parsedSeg.plannedUseTail, sourceContract);
        return imported;
      });
      if (currentOnly) createSegs.splice(sel, 1, importedSegments[0]);
      else createSegs.splice(0, createSegs.length, ...importedSegments);
      const globalAssetRefs = ensureCreateGlobalAssetRefs(node, ensureCreateGlobalRefs(node, createSegs));
      const assetLibrary = createGlobalAssetLibrary();
      const slotByToken = new Map();
      for (const slot of extractedSlots) {
        const matched = assetLibrary.find((asset) => asset.file === slot.file
          || (asset.type === slot.type && String(asset.name || "").trim().toLowerCase() === slot.name.toLowerCase()));
        if (matched) slot.file = matched.file;
        slotByToken.set(slot.asset_id.toLowerCase(), matched || slot);
        slotByToken.set(slot.name.toLowerCase(), matched || slot);
      }
      const assignmentInputs = parsedForImport.map((parsedSeg) => {
        const explicitTokens = Array.isArray(parsedSeg.assetIds) ? parsedSeg.assetIds : [];
        const resolvedHints = explicitTokens.map((token) => {
          const matched = slotByToken.get(String(token || "").toLowerCase());
          return matched ? `${matched.asset_id || ""} ${matched.name || ""}` : String(token || "");
        });
        const explicitMentions = String(parsedSeg.prompt || "").match(/[@＠][CPSG]\d+/gi) || [];
        const prompt = parsed.structured
          ? [parsedSeg.prompt, ...resolvedHints].join(" ")
          : [...explicitMentions, ...resolvedHints].join(" ");
        return { prompt };
      });
      const plannedAssets = planH3LocalAssetAssignments(assignmentInputs, assetLibrary);
      const audioAssetLibrary = collectCreateAudioAssetLibrary(node, createSegs);
      const narratorVoiceAsset = audioAssetLibrary.find((asset) => asset.asset_id
        === String(node.properties.h3_create_narrator_voice_asset_id || "").toUpperCase());
      let audioAssignedCount = 0;
      let characterAudioAssignedCount = 0;
      let audioMissingCount = 0;
      let audioOverflowCount = 0;
      targetIndexes.forEach((segmentIndex, planIndex) => {
        const segment = createSegs[segmentIndex];
        const selectedAssets = plannedAssets[planIndex] || [];
        const explicitAudioIds = [...String(segment.prompt || "").matchAll(/[@＠](A\d+)/gi)]
          .map((match) => match[1].toUpperCase());
        const explicitCharacterIds = [...String(segment.prompt || "").matchAll(/[@＠](C\d+)(?:（([^）]+)）)?/gi)]
          .map((match) => {
            const asset = resolveCreateMentionAsset(selectedAssets, match[1], match[2]);
            return String(asset && asset.asset_id || match[1]).toUpperCase();
          });
        segment.parsed_refs = selectedAssets.map((asset) => asset.file).filter(Boolean);
        segment.prompt = String(segment.prompt || "").replace(
          /[@＠]([CPSG]\d+)(?:（([^）]+)）)?/gi,
          (match, assetId, displayName) => {
            const asset = resolveCreateMentionAsset(selectedAssets, assetId, displayName);
            const resolvedId = String(asset && asset.asset_id || assetId).toUpperCase();
            const name = String(displayName || asset && asset.name || assetId).trim();
            return `@${resolvedId}（${name}）`;
          });
        const audioResult = bindCreateAudioMentions(segment, audioAssetLibrary);
        audioAssignedCount += audioResult.bound;
        audioMissingCount += audioResult.missing;
        audioOverflowCount += audioResult.overflow;
        if (narratorVoiceAsset && explicitAudioIds.includes(narratorVoiceAsset.asset_id)) {
          bindCreateNarratorVoiceToSegment(segment, narratorVoiceAsset);
        }
        const linkedVoiceLines = [];
        for (const characterId of [...new Set(explicitCharacterIds)]) {
          const character = selectedAssets.find((asset) => asset.type === "character"
            && String(asset.asset_id || "").toUpperCase() === characterId);
          if (!character || !character.voice_asset_id) continue;
          const linkedAudio = audioAssetLibrary.find((asset) => asset.asset_id === character.voice_asset_id);
          if (!linkedAudio) continue;
          const voiceAsset = { ...linkedAudio, usage: "timbre" };
          const existingNumber = createAudioAssetBindingNumber(segment, voiceAsset);
          const audioNumber = bindCreateAudioAssetToSegment(segment, voiceAsset);
          if (!audioNumber) {
            audioOverflowCount += 1;
            continue;
          }
          if (!existingNumber) characterAudioAssignedCount += 1;
          if (!String(segment.prompt || "").includes(`<Audio ${audioNumber}>`)) {
            linkedVoiceLines.push(`${character.name}的参考音色使用 <Audio ${audioNumber}>。`);
          }
        }
        if (linkedVoiceLines.length) {
          segment.prompt = String(segment.prompt || "").trimEnd() + "\n" + linkedVoiceLines.join("\n");
        }
      });
      syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
      targetIndexes.forEach((index) => {
        const segment = createSegs[index];
        const boundAssets = segment.refs.map((file) => {
          const meta = getRefAssetMeta(node, file);
          return { file, name: meta.name, type: meta.type, asset_id: meta.asset_id,
            aliases: meta.aliases, filename: meta.filename };
        });
        segment.prompt = bindOrdinaryPromptToAssets(segment.prompt, boundAssets, segment.use_tail !== false);
      });
      segs = createSegs;
      if (!currentOnly) sel = 0;
      clearBoxSel();
      const globalNote = currentOnly ? "" : applyCreateParsedGlobal(parsed);
      clearScriptDirty("create");
      scheduleSave();
      renderTimeline();
      renderEditor();
      const parsedType = parsed.officialLabel ? "（" + parsed.officialLabel + "）" : "";
      const mediaNote = hadMedia ? "；原有同序手动参考、配音和音色已保留" : "";
      const assignedCount = targetIndexes.reduce(
        (sum, index) => sum + segmentParsedAssetFiles(createSegs[index]).length, 0);
      const unboundCount = extractedSlots.filter((slot) => !slot.file).length;
      const assetNote = extractedSlots.length
        ? `；已建立 ${extractedSlots.length} 个剧本资产槽，自动匹配 ${assignedCount} 个段级引用`
          + (unboundCount ? `，其中 ${unboundCount} 个等待绑定图片` : "")
        : assignedCount ? `；已按明确 @编号匹配 ${assignedCount} 个段级引用` : "";
      const audioNote = audioAssignedCount ? `；已按明确 @A编号绑定 ${audioAssignedCount} 个参考音频` : "";
      const characterAudioNote = characterAudioAssignedCount
        ? `；已随 @人物加入 ${characterAudioAssignedCount} 个绑定音色` : "";
      const audioWarn = audioMissingCount || audioOverflowCount
        ? `；⚠ ${audioMissingCount ? audioMissingCount + " 个 @A编号未在资产库找到" : ""}`
          + (audioMissingCount && audioOverflowCount ? "，" : "")
          + (audioOverflowCount ? audioOverflowCount + " 个参考音频超过单段 3 路上限" : "")
        : "";
      const parsedWarn = (parsed.warnings || []).length ? "；⚠ " + parsed.warnings.slice(0, 2).join("；") : "";
      const importResult = currentOnly
        ? `已导入脚本对应的第${parsedIndex + 1}段到当前段${sel + 1}；前后其他段未修改`
        : `创作界面已解析 ${createSegs.length} 段`;
      status.textContent = importResult + parsedType
        + "，" + formatParsedDuration(parsedForImport) + formatTailPlanSummary(parsedForImport)
        + mediaNote + assetNote + audioNote + characterAudioNote + "；未匹配资产仍可从资产库拖入需要的分段"
        + globalNote + audioWarn + parsedWarn;
      return true;
    };
    btnCreateParse.addEventListener("click", () => { void parseFullCreateScript(); });
    createScriptTa.__h3ParseGuidedResult = () => { void parseFullCreateScript({ force: true }); };
    const btnCreateParseCurrent = mk("button", "h3s-btn", "导入当段");
    btnCreateParseCurrent.title = "多段脚本只取与当前卡序号对应的一段；单段脚本直接导入当前段，前后其他段保持不变";
    btnCreateParseCurrent.addEventListener("click", () => {
      void parseFullCreateScript({ destination: "current" });
    });

    const btnCreateLoad = mk("button", "h3s-btn", "📂 载入文本");
    btnCreateLoad.title = "从本地 .txt / .json 文件载入脚本框；不会自动解析或修改现有分段";
    const createFileInput = document.createElement("input");
    createFileInput.type = "file";
    createFileInput.accept = ".txt,.json,text/plain,application/json";
    createFileInput.style.display = "none";
    btnCreateLoad.addEventListener("click", () => { createFileInput.click(); });
    createFileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        createScriptTa.value = text;
        createScriptTa.dispatchEvent(new Event("input", { bubbles: true }));
        createScriptTa.__h3RefreshMentions();
        disarmCreateParse();
        status.textContent = "创作页面已载入 " + file.name
          + " 到脚本框，当前分段未修改；检查内容后选择“分析导入全部段”或“导入当段”。";
      } catch (err) {
        status.textContent = "载入失败：" + err.message;
      }
      createFileInput.value = "";
    });
    const btnCreateStory = mk("button", "h3s-btn", "AI剧情");
    btnCreateStory.title = "使用自动电影化规则把当前故事整理为可拍摄剧本；结果只写回上方分镜脚本";
    const btnCreateShots = mk("button", "h3s-btn", "AI分镜");
    btnCreateShots.title = "使用自动电影化规则把当前剧本转换为 MiniMax H3 官方 Base 长时间轴；结果只写回上方分镜脚本";
    const btnCreateRefine = mk("button", "h3s-btn", "AI精修");
    btnCreateRefine.title = "有框选时只精修框选内容；没有框选时精修上方整个分镜脚本；不修改当前段提示词";
    const runCreateScriptAi = async (button, action, label) => {
      button.disabled = true;
      try { await action(); }
      catch (error) {
        status.style.color = "#ff8080";
        status.textContent = label + "失败：" + error.message;
      } finally { button.disabled = false; }
    };
    const runCreateStoryAi = async () => {
      const sourcePrompt = createScriptTa.value.trim();
      if (!sourcePrompt) {
        status.style.color = "#ffb0a8";
        status.textContent = "请先在“分镜脚本”输入你的剧情提示词，再点击AI剧情";
        createScriptTa.focus();
        return false;
      }
      createStoryAiActive = true;
      try {
        return await rewriteScriptWithAI(createScriptTa,
          buildCreateStoryToScriptSys(currentAssetPromptContext()),
          "AI剧情", prepareStoryScriptOutput, {
            assetCatalog: allUploadedAssets(),
            completionHint: "，结果只写入上方分镜脚本；确认后请点击“分析导入全部段”",
          });
      } finally {
        createStoryAiActive = false;
      }
    };
    btnCreateStory.addEventListener("click", () => runCreateScriptAi(
      btnCreateStory, runCreateStoryAi, "AI剧情"));
    btnCreateShots.addEventListener("click", () => runCreateScriptAi(
      btnCreateShots,
      () => rewriteScriptWithAI(createScriptTa,
        buildCreateOfficialStoryboardSys(currentAssetPromptContext()),
        "AI分镜", prepareOfficialStoryboardOutput, {
          includeExplicitSegmentContract: true,
          assetCatalog: allUploadedAssets(),
          assetOutputType: "official",
        }),
      "AI分镜"));
    btnCreateRefine.addEventListener("pointerdown", (event) => event.preventDefault());
    btnCreateRefine.addEventListener("click", () => runCreateScriptAi(
      btnCreateRefine, () => refineSelectedH3TextWithAI(createScriptTa), "AI精修"));
    createImportRow.append(btnCreateParse, btnCreateParseCurrent, btnCreateLoad,
      btnCreateStory, btnCreateShots, btnCreateRefine,
      mk("span", "h3s-hint", "三个 AI 功能只写回上方分镜脚本；确认后点击“分析导入全部段”才更新时间线。当前段提示词仍可独立输入和修改"));
    scriptCard.appendChild(createImportRow);

    /* 全局提示词（v2.12）：注入到每一段开头，保持风格/角色/场景一致性 */
    const globalCard = card("全局提示词", "h3s-card-global");
    createMain.appendChild(globalCard);
    const gpRow = mk("div", "h3s-row");
    gpRow.style.flexDirection = "column";
    gpRow.style.alignItems = "stretch";
    const gpHead = mk("div", "h3s-row");
    gpHead.style.cssText += "justify-content:space-between;align-items:center;";
    gpHead.appendChild(mk("div", "h3s-hint", "全局提示词（注入到每一段开头）："));
    /* 创作界面一键全部清空：脚本、全局提示词、全部分段及段级素材一起重置。
       已生成成片仍保留在 output 目录；两段式红按钮，不用 confirm。 */
    const btnGpClear = mk("button", "h3s-btn", "全部清空");
    btnGpClear.title = "清空官方脚本 + 全局提示词 + 全部分段及段级素材，重置为 1 个空白段（成片文件保留）";
    let gpClearArmed = false;
    const disarmGpClear = () => {
      gpClearArmed = false;
      btnGpClear.textContent = "全部清空";
      btnGpClear.style.background = "";
      btnGpClear.style.borderColor = "";
    };
    btnGpClear.addEventListener("click", () => {
      const hasAnything = !!createScriptTa.value.trim() || !!gpTa.value.trim()
        || createSegs.length > 1 || createSegs.some((seg) => (seg.prompt || "").trim()
          || (Array.isArray(seg.refs) && seg.refs.length) || seg.audio
          || (Array.isArray(seg.voice_refs) && seg.voice_refs.length))
        || createTimelineVideos.length;
      if (!hasAnything) { disarmGpClear(); status.textContent = "脚本 / 全局提示词 / 分段素材都已是空的"; return; }
      if (!gpClearArmed) {
        gpClearArmed = true;
        btnGpClear.textContent = "再点确认全部清空";
        btnGpClear.style.background = "#8a2f2f";
        btnGpClear.style.borderColor = "#c05555";
        status.textContent = "将清空：官方脚本 + 全局提示词 + 全部 " + createSegs.length
          + " 段及段级参考图/音频，再点一次红色按钮确认";
        return;
      }
      disarmGpClear();
      backupActiveCreateProject();
      createScriptTa.value = "";
      createScriptTa.__h3RefreshMentions();
      node.properties.h3_create_script = "";
      node.properties.h3_create_asset_slots = [];
      gpTa.value = "";
      setModeGlobalPrompt("create", "");
      node.properties.h3_create_auto_global_value = "";
      const fresh = JSON.parse(JSON.stringify(defaultSegs()[0]));
      applySecondSampleDefault(fresh);
      fresh.prompt = "";
      fresh.seed = Math.floor(Math.random() * 1e15);
      fresh.refs = [];
      createSegs.length = 0;
      createSegs.push(fresh);
      createTimelineVideos = [];
      node.properties.h3_create_timeline_videos = [];
      segs = createSegs;
      sel = 0;
      clearBoxSel();
      save(); renderTimeline(); renderEditor();
      status.textContent = "已全部清空：官方脚本 + 全局提示词 + 分段及段级素材（成片文件保留在 output 目录）";
    });
    gpHead.appendChild(btnGpClear);
    gpRow.appendChild(gpHead);
    gpTa = mk("textarea", "h3s-ta");
    gpTa.style.cssText += "flex:none;height:60px;";
    gpTa.placeholder = "只写所有段真正共享的角色身份、外貌、固定道具、统一风格和通用限制；分段场景/运镜留在各段。";
    gpTa.value = modeGlobalPrompt("create");
    gpTa.addEventListener("input", () => {
      setModeGlobalPrompt("create", gpTa.value);
      node.properties.h3_create_auto_global_value = "";
      save();
    });
    gpRow.appendChild(gpTa);
    globalCard.appendChild(gpRow);

    const segmentCard = card("当前段提示词", "h3s-card-segment");
    createMain.appendChild(segmentCard);
    const row = mk("div", "h3s-row");
    row.appendChild(mk("b", null, `段 ${sel + 1}`));
    const segmentName = mk("input", "h3s-segment-name");
    segmentName.type = "text";
    segmentName.maxLength = 40;
    segmentName.value = normalizeCreateSegmentName(s.display_name);
    segmentName.placeholder = "段名称（仅前端显示）";
    segmentName.title = "只用于前端识别；不会修改后端段号或视频文件名";
    segmentName.addEventListener("input", () => {
      s.display_name = normalizeCreateSegmentName(segmentName.value);
      scheduleSave();
      updateTimelineLabels();
    });
    const commitSegmentName = () => {
      const name = normalizeCreateSegmentName(segmentName.value);
      segmentName.value = name;
      if (name) s.display_name = name;
      else delete s.display_name;
      save();
      updateTimelineLabels();
    };
    segmentName.addEventListener("blur", commitSegmentName);
    segmentName.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      commitSegmentName();
      segmentName.blur();
    });
    row.appendChild(segmentName);
    row.appendChild(mk("span", "h3s-hint", "启用/停用请在上方时间线段卡勾选"));

    /* 创作界面同样不再显示手动时长输入；时长只由解析后的剧本时间轴决定。 */

    // 「继承共享参考图」开关已从 UI 移除（v2 工作流无共享图接口，开关恒无效）。
    // 数据字段 s.inherit_shared 保留：若日后左侧接了 ref_image_*，共享图会自动带入，无需开关。

    if (s.tail_plan === "review") {
      const badge = mk("span", "h3s-hint", "⚠ 尾帧待确认");
      badge.style.color = "#e8bd68";
      badge.title = s.tail_reason || "小说分析无法确定是否应续接上一段尾帧；当前为安全起见未勾选，请人工确认。";
      row.appendChild(badge);
    }
    const createTailBoundary = sel > 0 && s.use_tail !== false
      ? detectTailRenderBoundary(createSegs[sel - 1] && createSegs[sel - 1].prompt, s.prompt) : null;
    if (createTailBoundary) {
      const badge = mk("span", "h3s-hint", "⚠ 跨风格软参考");
      badge.style.color = "#e8bd68";
      badge.title = "上一段末镜与本段首镜属于不同渲染风格。Ref2VA 只软参考上一段的身份、构图和运动，不强制保留旧渲染风格。";
      row.appendChild(badge);
    }

    if (sel >= 1) {
      const btnCont = mk("button", "h3s-btn", "从视频续接");
      btnCont.title = "上传任意视频，自动检查最后24帧；末帧花屏、黑白坏帧或异常噪点时会回退 N-1、N-2…作为本段续接起点";
      btnCont.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "video/mp4,video/*";
        inp.style.display = "none";
        // detached input 的 click() 在部分浏览器/内核不弹文件对话框，必须先挂到 DOM
        document.body.appendChild(inp);
        inp.addEventListener("change", async () => {
          try {
            if (!inp.files[0]) return;
            status.textContent = `正在为段${sel + 1} 提取续接帧…`;
            const fd = new FormData();
            fd.append("target_seg", String(sel + 1));
            fd.append("mode", curMode());
            fd.append("project_id", ensureProjectId());
            fd.append("video", inp.files[0], inp.files[0].name);
            const resp = await api.fetchApi("/h3director/extract_tail", { method: "POST", body: fd });
            const r = await resp.json();
            if (r.ok) {
              const fallback = Number(r.fallback_frames || 0);
              status.textContent = fallback > 0
                ? `段${sel + 1} 续接帧已就绪：末帧异常，自动回退 ${fallback} 帧（采用第${r.selected_frame}/${r.total_frames}帧）`
                : `段${sel + 1} 续接帧已就绪：末帧质量正常`;
            } else {
              status.textContent = `失败: ${r.error || ("HTTP " + resp.status)}`;
            }
            renderTimeline();
            renderEditor();  // 刷新缩略图区，让新尾帧立刻可见
          } catch (e) {
            status.textContent = "续接帧提取出错: " + e.message;
          } finally {
            inp.remove();
          }
        });
        inp.click();
      });
      row.appendChild(btnCont);
    }
    segmentCard.appendChild(row);
    picHintEl = mk("div", "h3s-pichint", picHintText(s, sel));
    segmentCard.appendChild(picHintEl);

    const ta = mk("textarea", "h3s-ta");
    ta.value = s.prompt;
    ta.addEventListener("input", () => { s.prompt = ta.value; scheduleSave(); });
    wireAssetMentionPicker(ta, createMentionAssetLibrary, (asset, mention, replace) => {
      if (asset.kind === "audio") {
        const linkedNarrator = String(node.properties.h3_create_narrator_voice_asset_id || "")
          === asset.asset_id;
        const number = bindCreateAudioAssetToSegment(s, asset);
        if (!number) {
          status.textContent = "当前段已达到 3 路参考音频上限，请先移除一个音色或配音";
          return;
        }
        replace(`@${asset.asset_id}（${asset.name}） <Audio ${number}>`);
        s.prompt = ta.value;
        if (linkedNarrator) bindCreateNarratorVoiceToSegment(s, asset);
        save();
        renderEditor();
        status.textContent = linkedNarrator
          ? `已把旁白音色 ${asset.asset_id} 加入当前段，并声明为画外旁白 <Audio ${number}>`
          : `已把 ${asset.asset_id} ${asset.name} 加入当前段，并插入 <Audio ${number}>`;
        return;
      }
      if (!s.refs.includes(asset.file)) {
        const manual = segmentManualAssetFiles(s);
        s.manual_refs = uniqueAssetFiles([...manual, asset.file]);
        syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
      }
      const number = s.refs.indexOf(asset.file) + 1 + (s.use_tail !== false && sel > 0 ? 1 : 0);
      let replacement = `@${asset.asset_id}（${asset.name}） <Picture ${number}>`;
      let audioNote = "";
      if (asset.type === "character" && asset.voice_asset_id) {
        const linkedAudio = collectCreateAudioAssetLibrary(node, createSegs)
          .find((item) => item.asset_id === asset.voice_asset_id);
        if (linkedAudio) {
          const audioNumber = bindCreateAudioAssetToSegment(s, { ...linkedAudio, usage: "timbre" });
          if (audioNumber) {
            replacement += `，@${linkedAudio.asset_id}（${linkedAudio.name}） <Audio ${audioNumber}>`;
            audioNote = `，并加入人物音色 ${linkedAudio.asset_id} <Audio ${audioNumber}>`;
          } else {
            audioNote = "；人物图片已加入，但音色因达到 3 路上限未加入";
          }
        }
      }
      replace(replacement);
      s.prompt = ta.value;
      save();
      status.textContent = `已把 ${asset.asset_id} ${asset.name} 加入当前段，并插入 <Picture ${number}>${audioNote}`;
    });
    const segmentMentionEditor = createAssetMentionEditor(ta);
    segmentCard.appendChild(segmentMentionEditor);
    attachBottomBar(segmentMentionEditor, 240, 60);

    const segmentAssetMap = mk("div", "h3s-segment-asset-map");
    segmentAssetMap.appendChild(mk("span", "h3s-segment-asset-map-label", "本段资产映射"));
    let mappedPicture = 1;
    if (s.use_tail !== false && sel > 0) {
      segmentAssetMap.appendChild(mk("span", "h3s-segment-asset-map-item tail", "上一段尾帧 → <Picture 1>"));
      mappedPicture = 2;
    }
    for (const file of s.refs || []) {
      const meta = getRefAssetMeta(node, file);
      const item = mk("span", "h3s-segment-asset-map-item");
      item.append(
        applyH3MentionColor(mk("span", "h3s-asset-mention-id", `@${meta.asset_id}（${meta.name}）`), meta.asset_id),
        mk("span", "h3s-segment-asset-map-target", `→ <Picture ${mappedPicture}>`),
      );
      segmentAssetMap.appendChild(item);
      mappedPicture += 1;
    }
    if (mappedPicture === 1) segmentAssetMap.appendChild(mk("span", "h3s-hint", "无图片参考"));
    segmentCard.appendChild(segmentAssetMap);

    /* 时间段跳转导航：扫描提示词里的 [xs-ys] 标签渲染成小按钮，
       点击把光标/选中区直接定位到该段——长提示词里快速找到"那段在哪里" */
    const navRow = mk("div", "h3s-row");
    const rebuildNav = () => {
      navRow.innerHTML = "";
      const tags = [...ta.value.matchAll(/\[\d+(?:\.\d+)?s\s*-\s*\d+(?:\.\d+)?s\]/g)];
      if (!tags.length) return;
      navRow.appendChild(mk("span", "h3s-hint", "跳转:"));
      for (const m of tags) {
        const b = mk("button", "h3s-btn", m[0]);
        b.style.padding = "1px 6px";
        b.style.fontSize = "10px";
        b.title = "光标定位到提示词中的 " + m[0] + " 段";
        b.addEventListener("click", () => {
          ta.focus();
          ta.setSelectionRange(m.index, m.index + m[0].length);
        });
        navRow.appendChild(b);
      }
    };
    ta.addEventListener("input", rebuildNav);
    rebuildNav();

    /* 提示词编辑工具条：全选 / 复制 / 粘贴 / 删除（有选中操作选中，无选中操作全文） */
    const editRow = mk("div", "h3s-row");
    const commitTa = () => {
      s.prompt = ta.value;
      ta.__h3RefreshMentions?.();
      save();
      rebuildNav();
    };
    const selRange = () => {
      const a = ta.selectionStart ?? 0, b = ta.selectionEnd ?? 0;
      return a !== b ? [a, b] : null;
    };
    const btnSelAllT = mk("button", "h3s-btn", "全选");
    btnSelAllT.title = "选中提示词全部内容";
    btnSelAllT.addEventListener("click", () => { ta.focus(); ta.select(); });

    const btnCopyT = mk("button", "h3s-btn", "复制");
    btnCopyT.title = "复制选中内容（无选中则复制全部）";
    btnCopyT.addEventListener("click", async () => {
      const r = selRange();
      const txt = r ? ta.value.slice(r[0], r[1]) : ta.value;
      if (!txt) { status.textContent = "提示词为空，没有可复制的内容"; return; }
      try {
        await navigator.clipboard.writeText(txt);
        status.textContent = r ? "已复制选中内容" : "已复制全部提示词";
      } catch (e) {
        status.textContent = "复制失败: " + e.message;
      }
    });

    const btnPasteT = mk("button", "h3s-btn", "粘贴");
    btnPasteT.title = "在光标处粘贴（有选中则替换选中内容）";
    btnPasteT.addEventListener("click", async () => {
      try {
        const txt = await navigator.clipboard.readText();
        if (!txt) { status.textContent = "剪贴板为空"; return; }
        const r = selRange() || [ta.selectionStart ?? ta.value.length, ta.selectionEnd ?? ta.value.length];
        ta.value = ta.value.slice(0, r[0]) + txt + ta.value.slice(r[1]);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = r[0] + txt.length;
        commitTa();
        status.textContent = "已粘贴";
      } catch (e) {
        status.textContent = "粘贴失败（浏览器可能拦截了剪贴板读取）: " + e.message;
      }
    });

    const btnDelT = mk("button", "h3s-btn", "删除");
    btnDelT.title = "删除选中内容（无选中则清空全部提示词，需再点一次红色按钮确认）";
    /* 不用 confirm()（内嵌浏览器静默拦截，点了没反应）——两段式红按钮确认 */
    let delArmed = false;
    const disarmDel = () => {
      delArmed = false;
      btnDelT.textContent = "删除";
      btnDelT.style.background = "";
      btnDelT.style.borderColor = "";
    };
    btnDelT.addEventListener("click", () => {
      const r = selRange();
      if (r) {
        disarmDel();
        ta.value = ta.value.slice(0, r[0]) + ta.value.slice(r[1]);
        ta.selectionStart = ta.selectionEnd = r[0];
        status.textContent = "已删除选中内容";
      } else {
        if (!ta.value) { status.textContent = "提示词已是空的"; return; }
        if (!delArmed) {
          delArmed = true;
          btnDelT.textContent = "再点确认清空";
          btnDelT.style.background = "#8a2f2f";
          btnDelT.style.borderColor = "#c05555";
          status.textContent = "没有选中内容，再点一次红色按钮清空本段全部提示词";
          return;
        }
        disarmDel();
        ta.value = "";
        status.textContent = "已清空本段提示词";
      }
      ta.focus();
      commitTa();
    });

    const btnAssetMention = mk("button", "h3s-btn", "@");
    btnAssetMention.title = "在当前光标处选择资产；也可以直接在提示词中输入 @";
    btnAssetMention.addEventListener("pointerdown", (event) => event.preventDefault());
    btnAssetMention.addEventListener("click", () => {
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? start;
      ta.setRangeText("@", start, end, "end");
      ta.focus();
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });

    /* ✨ AI 提示词：只调用用户主动配置的 OpenAI-compatible API。
       API Key 仅保存到 ComfyUI 后端本机配置，不写入工作流、node.properties 或 localStorage。 */
    const btnAI = mk("button", "h3s-btn", "✨ 优化当前段");
    btnAI.title = "只通过顶部已配置的远程 API 优化当前段；不修改整篇剧本和其它分段";
    let aiPanel = null;
    btnAI.addEventListener("click", async () => {
      if (aiPanel) { aiPanel.remove(); aiPanel = null; return; }
      aiPanel = mk("div", "h3s-slrow");
      aiPanel.style.flexWrap = "wrap";
      const quickMode = document.createElement("select");
      quickMode.innerHTML = '<option value="smart">智能生成</option>'
        + '<option value="compose">编写模式</option>';
      quickMode.value = localStorage.getItem("h3_ai_mode") || "smart";
      quickMode.title = "智能生成：AI 完善创意；编写模式：严格按当前草稿转换，不增删情节";
      quickMode.addEventListener("change", () => localStorage.setItem("h3_ai_mode", quickMode.value));
      const quickStat = mk("span", "h3s-hint", "正在读取顶部 API 设置…");
      const quickGo = mk("button", "h3s-btn primary", "开始优化");
      quickGo.addEventListener("click", async () => {
        const draft = ta.value.trim();
        if (!draft) {
          quickStat.style.color = "#ff8080";
          quickStat.textContent = "提示词框是空的，先写一句创意或大白话分镜";
          ta.focus();
          return;
        }
        quickGo.disabled = true;
        quickStat.style.color = "";
        quickStat.textContent = "AI 正在优化当前段…";
        try {
          const picFiles = [];
          const picDescriptions = [];
          if (s.use_tail !== false && sel > 0) {
            picFiles.push("video/tail_seg" + sel + "_00001_.png");
            picDescriptions.push("Picture 1=上一段尾帧");
          }
          (s.refs || []).forEach((name) => {
            if (!name) return;
            picFiles.push(name);
            const meta = getRefAssetMeta(node, name);
            picDescriptions.push("Picture " + picFiles.length + "=" + meta.asset_id + "/" + meta.name
              + "/" + H3_ASSET_TYPES[meta.type].label);
          });
          const voiceDesc = [];
          const narratorAsset = createNarratorVoiceAsset();
          (s.voice_refs || []).forEach((name, k) => {
            voiceDesc.push("<Audio " + (k + 1) + "> 是音色参考音频 " + name
              + (narratorAsset && narratorAsset.file === name
                ? "，只用于画外旁白；画面人物不得因此张嘴"
                : "，用于给角色配新台词"));
          });
          const ctx = {
            dur: String(segDur(s)),
            pics: picFiles.length,
            picDesc: picDescriptions.length ? picDescriptions.join(", ") : "无",
            tail: s.use_tail !== false && sel > 0,
            voices: voiceDesc.length ? voiceDesc.join("；") + "。" : "没有使用音色/配音槽。",
            hasAudio: !!(s.audio && s.audio_src && s.audio_src !== "model"),
          };
          const userPrompt = (quickMode.value === "compose"
            ? "请严格按照下面的大白话分镜转换成合格提示词，不增删情节：\n"
            : "请根据下面的创意/草稿写一段提示词：\n") + draft;
          const response = await api.fetchApi("/h3director/ai_prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "system", content: buildAiSys(ctx) },
                { role: "user", content: userPrompt },
              ],
              images: picFiles.filter((file) => !file.startsWith("video/")),
              tail_seg: (s.use_tail !== false && sel > 0) ? sel : null,
              mode: curMode(),
              project_id: ensureProjectId(),
              audio: (s.audio && s.audio_src && s.audio_src !== "model") ? s.audio : null,
              max_tokens: 1200,
              temperature: 0.7,
            }),
          });
          const result = await response.json();
          if (!response.ok || !result.content) throw new Error(result.error || ("HTTP " + response.status));
          ta.value = result.content;
          commitTa();
          showAiGenerationResult(quickStat, result, "当前段已优化并写回提示词框");
        } catch (error) {
          quickStat.style.color = "#ff8080";
          quickStat.textContent = "优化失败：" + error.message;
        }
        quickGo.disabled = false;
      });
      aiPanel.append(
        mk("span", "h3s-hint", "当前段 AI："),
        mk("span", "h3s-hint", "生成方式"), quickMode,
        quickGo, quickStat,
        mk("span", "h3s-hint", "API 地址、模型和 Key 在顶部统一管理；这里只修改当前段"),
      );
      editRow.parentNode.insertBefore(aiPanel, editRow.nextSibling);
      try {
        const configResponse = await api.fetchApi("/h3director/api_config");
        const config = await configResponse.json();
        if (!configResponse.ok) throw new Error(config.error || ("HTTP " + configResponse.status));
        quickStat.style.color = config.configured ? "#8ee6a0" : "#f2c94c";
        quickStat.textContent = config.configured
          ? "已使用顶部配置：" + (config.model || "当前模型")
          : "尚未配置 API，请先打开顶部“AI / API 共用设置”";
      } catch (error) {
        quickStat.style.color = "#ff8080";
        quickStat.textContent = "API 配置查询失败：" + error.message;
      }
      return;

      const openedPanel = aiPanel;
      const aiStat = mk("span", "h3s-hint", "正在读取顶部 API 设置…");
      let savedApiBase = "";
      const apiHost = (value) => {
        try { return new URL(String(value || "").trim()).host.toLowerCase(); }
        catch (e) { return ""; }
      };
      const apiPresets = {
        codexcn: {
          label: "CodexCN / Responses", base: "https://api2.codexcn.com/v1",
          models: [
            ["gpt-5.6-sol", "GPT-5.6 Sol（质量/编程）"],
            ["gpt-5.6-terra", "GPT-5.6 Terra（均衡）"],
            ["gpt-5.6-luna", "GPT-5.6 Luna（快速/省额度）"],
          ],
        },
        openai: {
          label: "OpenAI 官方", base: "https://api.openai.com/v1",
          models: [
            ["gpt-5", "GPT-5（图文/质量）"],
            ["gpt-5-mini", "GPT-5 mini（图文/省流量）"],
            ["gpt-4.1", "GPT-4.1（图文）"],
            ["gpt-4.1-mini", "GPT-4.1 mini（图文/省流量）"],
          ],
        },
        deepseek: {
          label: "DeepSeek 官方", base: "https://api.deepseek.com/v1",
          models: [
            ["deepseek-chat", "DeepSeek Chat（文本）"],
            ["deepseek-reasoner", "DeepSeek Reasoner（文本/推理）"],
          ],
        },
        openrouter: {
          label: "OpenRouter", base: "https://openrouter.ai/api/v1",
          models: [
            ["openai/gpt-5", "OpenRouter · GPT-5（图文）"],
            ["openai/gpt-5-mini", "OpenRouter · GPT-5 mini（图文）"],
            ["anthropic/claude-sonnet-4", "OpenRouter · Claude Sonnet 4（图文）"],
            ["google/gemini-2.5-pro", "OpenRouter · Gemini 2.5 Pro（图文）"],
          ],
        },
        siliconflow: {
          label: "硅基流动", base: "https://api.siliconflow.cn/v1",
          models: [
            ["Qwen/Qwen2.5-VL-72B-Instruct", "Qwen2.5-VL-72B（图文）"],
            ["deepseek-ai/DeepSeek-V3", "DeepSeek V3（文本）"],
            ["deepseek-ai/DeepSeek-R1", "DeepSeek R1（文本/推理）"],
          ],
        },
        dashscope: {
          label: "阿里云百炼", base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          models: [
            ["qwen-vl-max", "Qwen VL Max（图文）"],
            ["qwen-plus", "Qwen Plus（文本）"],
            ["qwen-max", "Qwen Max（文本）"],
          ],
        },
        custom: { label: "自定义 / 中转站", base: "", models: [] },
      };
      const apiPreset = document.createElement("select");
      Object.entries(apiPresets).forEach(([value, preset]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = preset.label;
        apiPreset.appendChild(option);
      });
      apiPreset.title = "选择服务商后自动填写 API Base；在 codexcn 购买的 Key 必须选择 CodexCN，不能发往 OpenAI 官方地址";
      const apiBase = document.createElement("input");
      apiBase.type = "text";
      apiBase.placeholder = "https://api.openai.com/v1";
      apiBase.title = "OpenAI-compatible API Base URL；可填写 /chat/completions 或 /responses 完整地址；CodexCN 会自动使用 Responses 协议";
      apiBase.style.cssText = "min-width:260px;flex:1;";
      const apiModel = document.createElement("input");
      apiModel.type = "text";
      apiModel.placeholder = "模型名，例如 gpt-5";
      apiModel.title = "填写服务商支持的模型 ID";
      apiModel.style.cssText = "min-width:150px;width:180px;";
      const modelPreset = document.createElement("select");
      modelPreset.title = "常用模型快捷选择；列表没有时选自定义模型并手动填写模型 ID";
      const fillModelPresets = (providerKey, selectedModel, useDefault = false) => {
        const models = (apiPresets[providerKey] || apiPresets.custom).models;
        modelPreset.innerHTML = "";
        models.forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          modelPreset.appendChild(option);
        });
        const customOption = document.createElement("option");
        customOption.value = "__custom__";
        customOption.textContent = "自定义模型…";
        modelPreset.appendChild(customOption);
        if (useDefault && models.length) {
          apiModel.value = models[0][0];
          modelPreset.value = models[0][0];
          return;
        }
        modelPreset.value = models.some(([value]) => value === selectedModel) ? selectedModel : "__custom__";
      };
      const syncPresetFromFields = () => {
        const normalized = apiBase.value.trim().replace(/\/+$/, "");
        const providerKey = Object.entries(apiPresets).find(([, preset]) => preset.base
          && preset.base.replace(/\/+$/, "") === normalized)?.[0] || "custom";
        apiPreset.value = providerKey;
        fillModelPresets(providerKey, apiModel.value.trim(), false);
      };
      apiPreset.addEventListener("change", () => {
        const preset = apiPresets[apiPreset.value] || apiPresets.custom;
        if (preset.base) apiBase.value = preset.base;
        fillModelPresets(apiPreset.value, apiModel.value.trim(), apiPreset.value !== "custom");
        showProviderSwitchWarning();
      });
      modelPreset.addEventListener("change", () => {
        if (modelPreset.value !== "__custom__") apiModel.value = modelPreset.value;
        else { apiModel.focus(); apiModel.select(); }
      });
      apiBase.addEventListener("change", () => {
        syncPresetFromFields();
        showProviderSwitchWarning();
      });
      apiModel.addEventListener("input", () => {
        const models = (apiPresets[apiPreset.value] || apiPresets.custom).models;
        const value = apiModel.value.trim();
        modelPreset.value = models.some(([model]) => model === value) ? value : "__custom__";
      });
      const apiKey = document.createElement("input");
      apiKey.type = "password";
      apiKey.autocomplete = "new-password";
      apiKey.placeholder = "输入 API Key";
      apiKey.title = "Key 只保存到 ComfyUI 后端本机配置；同一服务商留空表示不修改，切换服务商时必须输入该服务商的新 Key";
      apiKey.style.cssText = "min-width:170px;width:210px;";
      function showProviderSwitchWarning() {
        const oldHost = apiHost(savedApiBase);
        const newHost = apiHost(apiBase.value);
        if (oldHost && newHost && oldHost !== newHost && !apiKey.value.trim()) {
          aiStat.style.color = "#f2c94c";
          aiStat.textContent = "已切换 API 服务商，请输入该服务商自己的新 Key；不同服务商的 Key 不能通用";
          return true;
        }
        return false;
      }
      apiKey.addEventListener("input", () => {
        if (apiKey.value.trim()) {
          aiStat.style.color = "";
          aiStat.textContent = "已输入新 Key，可保存或测试连接";
        } else {
          showProviderSwitchWarning();
        }
      });
      const btnSaveApi = mk("button", "h3s-btn", "保存设置");
      btnSaveApi.title = "把 Base URL、模型名和 Key 保存到 ComfyUI user 目录";
      const btnTestApi = mk("button", "h3s-btn", "测试连接");
      btnTestApi.title = "保存当前设置并发送一次最短的连接测试";
      const btnGo = mk("button", "h3s-btn primary", "开始优化");
      btnGo.title = "使用顶部共用 API 设置生成/优化当前段提示词";
      /* 生成模式（v1.15+）：智能生成=AI 自由创作；编写模式=用户在文本框写大白话分镜
         （如"2秒男人在花园闲逛，突然说：太阳好大"），AI 严格按描述的事件/时间点/台词
         转换成合规格式，不增删情节 */
      const selMode = document.createElement("select");
      selMode.innerHTML = '<option value="smart">智能生成</option>'
        + '<option value="compose">编写模式</option>';
      selMode.value = localStorage.getItem("h3_ai_mode") || "smart";
      selMode.title = "智能生成：AI 按创意自由撰写\n编写模式：你先在文本框写大白话分镜（事件+时间点+台词），AI 严格照你的描述转成合格提示词，不增删情节";
      selMode.addEventListener("change", () => localStorage.setItem("h3_ai_mode", selMode.value));

      const showApiError = (message) => {
        aiStat.textContent = message;
        aiStat.style.color = "#ff8080";
      };
      const loadApiConfig = async () => {
        try {
          const resp = await api.fetchApi("/h3director/api_config");
          const cfg = await resp.json();
          if (!resp.ok) throw new Error(cfg.error || ("HTTP " + resp.status));
          savedApiBase = cfg.base_url || "";
          apiBase.value = cfg.base_url || "";
          apiModel.value = cfg.model || "";
          syncPresetFromFields();
          apiKey.value = "";
          apiKey.placeholder = cfg.has_key ? "已保存，留空不修改" : "输入 API Key";
          aiStat.style.color = "";
          aiStat.textContent = cfg.configured ? "API 已配置" : "请填写并保存 API 设置";
          return cfg;
        } catch (e) {
          showApiError("API 配置查询失败：" + e.message + "（请重启 ComfyUI）");
          return null;
        }
      };
      const saveApiConfig = async (showSuccess = true) => {
        const oldHost = apiHost(savedApiBase);
        const newHost = apiHost(apiBase.value);
        if (oldHost && newHost && oldHost !== newHost && !apiKey.value.trim()) {
          throw new Error("你切换了 API 服务商，必须输入该服务商自己的新 API Key；不同服务商的 Key 不能通用。");
        }
        const resp = await api.fetchApi("/h3director/api_config", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base_url: apiBase.value.trim(),
            model: apiModel.value.trim(),
            api_key: apiKey.value.trim(),
          }),
        });
        const cfg = await resp.json();
        if (!resp.ok || !cfg.ok) throw new Error(cfg.error || ("HTTP " + resp.status));
        savedApiBase = cfg.base_url || apiBase.value.trim();
        apiKey.value = "";
        apiKey.placeholder = cfg.has_key ? "已保存，留空不修改" : "输入 API Key";
        aiStat.style.color = "";
        if (showSuccess) aiStat.textContent = "API 设置已保存";
        return cfg;
      };
      await loadApiConfig();
      if (aiPanel !== openedPanel) return;

      btnSaveApi.addEventListener("click", async () => {
        btnSaveApi.disabled = true;
        try {
          aiStat.textContent = "正在保存 API 设置…";
          await saveApiConfig(true);
        } catch (e) { showApiError("保存失败：" + e.message); }
        btnSaveApi.disabled = false;
      });
      btnTestApi.addEventListener("click", async () => {
        btnTestApi.disabled = true;
        try {
          aiStat.textContent = "正在测试 API 连接…";
          await saveApiConfig(false);
          const resp = await api.fetchApi("/h3director/api_test", { method: "POST" });
          const r = await resp.json();
          if (!resp.ok || !r.ok) throw new Error(r.error || ("HTTP " + resp.status));
          aiStat.style.color = r.vision_capability === "unsupported" ? "#e8bd68" : "";
          aiStat.textContent = apiTestStatusText(r, apiModel.value.trim());
        } catch (e) { showApiError("连接失败：" + e.message); }
        btnTestApi.disabled = false;
      });
      btnGo.addEventListener("click", async () => {
        const draft = ta.value.trim();
        if (!draft) { aiStat.textContent = "提示词框是空的，先写点创意或大白话分镜"; return; }
        btnGo.disabled = true;
        aiStat.textContent = "AI 正在写提示词…";
        try {
          const picFiles = [];
          const picDescriptions = [];
          if (s.use_tail !== false && sel > 0) {
            picFiles.push("video/tail_seg" + sel + "_00001_.png");
            picDescriptions.push("Picture 1=上一段尾帧");
          }
          (s.refs || []).forEach((name) => {
            if (!name) return;
            picFiles.push(name);
            const meta = getRefAssetMeta(node, name);
            picDescriptions.push("Picture " + picFiles.length + "=" + meta.asset_id + "/" + meta.name
              + "/" + H3_ASSET_TYPES[meta.type].label);
          });
          const voiceDesc = [];
          const narratorAsset = createNarratorVoiceAsset();
          (s.voice_refs || []).forEach((name, k) => {
            voiceDesc.push("<Audio " + (k + 1) + "> 是音色参考音频 " + name
              + (narratorAsset && narratorAsset.file === name
                ? "，只用于画外旁白；画面人物不得因此张嘴"
                : "，用于给角色配新台词"));
          });
          const ctx = {
            dur: String(segDur(s)),
            pics: picFiles.length,
            picDesc: picDescriptions.length ? picDescriptions.join(", ") : "无",
            tail: s.use_tail !== false && sel > 0,
            voices: voiceDesc.length ? voiceDesc.join("；") + "。" : "没有使用音色/配音槽。",
            hasAudio: !!(s.audio && s.audio_src && s.audio_src !== "model"),
          };
          const userPrompt = (selMode.value === "compose" ? "请严格按照下面的大白话分镜转换成合格提示词，不增删情节：\n" : "请根据下面的创意/草稿写一段提示词：\n") + draft;
          const messages = [
            { role: "system", content: buildAiSys(ctx) },
            { role: "user", content: userPrompt },
          ];
          const r = await (await api.fetchApi("/h3director/ai_prompt", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages,
              images: picFiles.filter((f) => !f.startsWith("video/")),
              tail_seg: (s.use_tail !== false && sel > 0) ? sel : null,
              mode: curMode(),
              project_id: ensureProjectId(),
              audio: (s.audio && s.audio_src && s.audio_src !== "model") ? s.audio : null,
              max_tokens: 1200,
              temperature: 0.7,
            }),
          })).json();
          if (r.content) {
            ta.value = r.content;
            commitTa();
            showAiGenerationResult(aiStat, r, "已生成，已填入提示词框");
          } else {
            aiStat.textContent = "生成失败: " + (r.error || "无输出"); aiStat.style.color = "#ff8080";
          }
        } catch (e) { aiStat.textContent = "出错: " + e.message; aiStat.style.color = "#ff8080"; }
        btnGo.disabled = false;
      });
      aiPanel.append(
        mk("span", "h3s-hint", "当前段 AI："),
        mk("span", "h3s-hint", "生成方式"), selMode,
        btnGo, aiStat,
        mk("span", "h3s-hint", "API 地址、模型和 Key 在顶部“AI / API 共用设置”中管理；这里只修改当前段"),
      );
      editRow.parentNode.insertBefore(aiPanel, editRow.nextSibling);
    });

    const btnCreateRefineCurrent = mk("button", "h3s-btn", "AI精修当前段");
    btnCreateRefineCurrent.title = "有框选时只精修框选内容；没有框选时精修创作页面当前段全文";
    btnCreateRefineCurrent.addEventListener("pointerdown", (event) => event.preventDefault());
    btnCreateRefineCurrent.addEventListener("click", async () => {
      btnCreateRefineCurrent.disabled = true;
      try { await refineSelectedH3TextWithAI(ta); }
      catch (error) {
        status.style.color = "#ff8080";
        status.textContent = "当前段精修失败：" + error.message;
      } finally { btnCreateRefineCurrent.disabled = false; }
    });
    const btnAnalyzeCurrentAssets = mk("button", "h3s-btn", "分析导入资产");
    btnAnalyzeCurrentAssets.title = "只读取当前段提示词里的 @资产和 Subject/Picture 资产声明，把资产库中匹配的图片导入当前段；不修改提示词、不拆段";
    btnAnalyzeCurrentAssets.addEventListener("pointerdown", (event) => event.preventDefault());
    btnAnalyzeCurrentAssets.addEventListener("click", () => {
      const originalPrompt = ta.value;
      const analysis = analyzeCreateSegmentPromptAssets(originalPrompt, createGlobalAssetLibrary());
      s.parsed_refs = analysis.assets.map((asset) => asset.file);
      syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
      s.asset_only_prompt_import = true;
      s.prompt = originalPrompt;
      save();
      renderEditor();
      const missing = analysis.unresolved.length
        ? `；资产库未找到 ${analysis.unresolved.slice(0, 4).join("、")}`
          + (analysis.unresolved.length > 4 ? ` 等 ${analysis.unresolved.length} 项` : "")
        : "";
      const correction = analysis.corrections.length
        ? `；编号冲突 ${analysis.corrections.join("、")}，执行时按真实资产绑定`
        : "";
      status.style.color = analysis.assets.length ? "" : "#e8bd68";
      status.textContent = analysis.assets.length
        ? `已从当前段提示词导入 ${analysis.assets.length} 个图片资产；可见提示词未修改，执行时仅按当前实际参考顺序重新绑定 Picture 编号${correction}${missing}`
        : `当前段提示词没有匹配到资产库图片；可见提示词未修改，执行时仅按当前实际参考顺序重新绑定 Picture 编号${correction}${missing}`;
    });
    editRow.append(btnSelAllT, btnCopyT, btnPasteT, btnDelT, btnAssetMention,
      btnAnalyzeCurrentAssets, btnCreateRefineCurrent);
    segmentCard.appendChild(editRow);
    segmentCard.appendChild(navRow);

    /* 创作页独立资产库：未勾选的素材只留在库中；勾选全局参考或拖入当前段后才进入 s.refs。 */
    const globalFiles = ensureCreateGlobalRefs(node, createSegs);
    const globalAssetRefs = ensureCreateGlobalAssetRefs(node, globalFiles);
    const audioAssets = ensureCreateAudioAssets(node, createSegs);
    const narratorVoiceAsset = () => audioAssets.find((asset) => asset.asset_id
      === String(node.properties.h3_create_narrator_voice_asset_id || "").toUpperCase()) || null;
    if (node.properties.h3_create_narrator_voice_asset_id && !narratorVoiceAsset()) {
      node.properties.h3_create_narrator_voice_asset_id = "";
    }
    if (syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs)) scheduleSave();
    const refRoleMap = ensureRoleNameMap(node);
    s.refs.forEach((file) => getRefAssetMeta(node, file));
    const attachSavedCardResize = (element, widthKey, heightKey, minW, minH) => {
      const savedW = Number(node.properties[widthKey]);
      const savedH = Number(node.properties[heightKey]);
      element.style.minWidth = "0";
      element.style.maxWidth = "100%";
      if (Number.isFinite(savedW) && savedW > 0) {
        element.style.width = Math.min(4096, Math.max(minW, savedW)) + "px";
      }
      if (Number.isFinite(savedH) && savedH > 0) {
        element.style.height = Math.min(3000, Math.max(minH, savedH)) + "px";
      }
      element.style.overflow = "auto";
      attachBottomBar(element, minW, minH, () => {
        node.properties[widthKey] = Math.round(element.offsetWidth);
        node.properties[heightKey] = Math.round(element.offsetHeight);
        scheduleSave();
      });
    };
    const globalAssetsCard = card("资产库", "h3s-card-refs h3s-card-global-assets");
    createSide.appendChild(globalAssetsCard);
    const globalHead = mk("div", "h3s-row");
    globalHead.appendChild(mk("span", "h3s-hint",
      "保存全剧可复用的角色、场景、道具、通用图片和参考音频。图片可勾选全局参考；其它资产按需加入分段或在输入框用 @ 选择。"));
    globalAssetsCard.appendChild(globalHead);
    const scriptSlots = ensureCreateAssetSlots(node);
    let clearAssetsArmed = false;
    const clearAssets = mk("button", "h3s-btn", "清空资产库");
    clearAssets.title = "清空创作界面的图片、参考音频、资产槽及其分段引用；不删除磁盘文件";
    clearAssets.addEventListener("click", () => {
      if (!clearAssetsArmed) {
        clearAssetsArmed = true;
        clearAssets.textContent = "再点确认清空";
        clearAssets.style.background = "#8a2f2f";
        status.textContent = "再次点击将清空创作界面资产库和对应分段引用；磁盘文件不会删除";
        setTimeout(() => {
          clearAssetsArmed = false;
          clearAssets.textContent = "清空资产库";
          clearAssets.style.background = "";
        }, 5000);
        return;
      }
      const imageFiles = new Set(globalFiles);
      const audioFiles = new Set(audioAssets.map((asset) => asset.file));
      globalFiles.length = 0;
      globalAssetRefs.length = 0;
      audioAssets.length = 0;
      node.properties.h3_create_narrator_voice_asset_id = "";
      scriptSlots.length = 0;
      Object.values(ensureAssetMetaMap(node)).forEach((meta) => {
        if (meta && meta.voice_asset_id) meta.voice_asset_id = "";
      });
      for (const segment of createSegs) {
        removeCreateNarratorVoiceDeclaration(segment);
        segment.refs = (segment.refs || []).filter((file) => !imageFiles.has(file));
        segment.manual_refs = (segment.manual_refs || []).filter((file) => !imageFiles.has(file));
        segment.parsed_refs = (segment.parsed_refs || []).filter((file) => !imageFiles.has(file));
        segment.auto_refs = (segment.auto_refs || []).filter((file) => !imageFiles.has(file));
        audioFiles.forEach((file) => removeCreateAudioAssetFromSegment(segment, file));
      }
      clearAssetsArmed = false;
      save();
      renderEditor();
      status.textContent = "创作界面资产库已清空；磁盘文件未删除";
    });
    globalHead.appendChild(clearAssets);
    if (scriptSlots.length) {
      const slotsPanel = mk("div", "h3s-script-slots");
      slotsPanel.appendChild(mk("b", null, "剧本自动提取资产槽"));
      slotsPanel.appendChild(mk("div", "h3s-hint",
        "结构化 JSON 或中文档案中的角色、场景、道具会先建立空槽；绑定图片后，明确引用该编号或完整名称的分镜会自动获得参考图。"));
      const bindSlotToSegments = (slot, file) => {
        slot.file = file;
        const id = slot.asset_id.toLowerCase();
        const name = slot.name.toLowerCase();
        for (const segment of createSegs) {
          const explicit = (segment.parsed_asset_ids || []).some((value) => {
            const token = String(value || "").toLowerCase();
            return token === id || token === name;
          });
          const prompt = String(segment.prompt || "").toLowerCase();
          if (!explicit && !prompt.includes("@" + id) && !prompt.includes(name)) continue;
          segment.parsed_refs = uniqueAssetFiles([...segmentParsedAssetFiles(segment), file]);
        }
        syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
      };
      for (const slot of scriptSlots) {
        const bound = slot.file && globalFiles.includes(slot.file)
          ? globalFiles.find((file) => file === slot.file) : null;
        const row = mk("div", "h3s-script-slot");
        row.appendChild(applyH3MentionColor(mk("span", "h3s-asset-mention-id", slot.asset_id), slot.asset_id));
        const name = mk("span", null, slot.name);
        name.title = slot.description || slot.name;
        row.appendChild(name);
        row.appendChild(mk("span", "h3s-hint", bound
          ? "已绑定 " + getRefAssetMeta(node, bound).asset_id
          : "等待图片"));
        const bind = mk("button", "h3s-btn", bound ? "更换" : "绑定图片");
        bind.addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
              const data = new FormData();
              data.append("image", file, file.name);
              data.append("overwrite", "true");
              const response = await api.fetchApi("/upload/image", { method: "POST", body: data });
              const result = await response.json();
              if (!response.ok || !result || !result.name) throw new Error(result && result.error || ("HTTP " + response.status));
              const savedName = (result.subfolder ? result.subfolder + "/" : "") + result.name;
              if (!globalFiles.includes(savedName)) globalFiles.push(savedName);
              const meta = assignCreateAssetId(node, globalFiles, savedName, slot.type, file.name);
              meta.name = slot.name;
              meta.aliases = slot.aliases.slice();
              meta.filename = String(file.name || meta.filename || "");
              bindSlotToSegments(slot, savedName);
              save(); renderEditor();
              status.textContent = `已把 ${slot.asset_id} ${slot.name} 绑定到资产库，并更新明确引用它的分镜`;
            } catch (error) {
              status.textContent = "资产槽绑定失败：" + error.message;
            }
          });
          input.click();
        });
        row.appendChild(bind);
        slotsPanel.appendChild(row);
      }
      globalAssetsCard.appendChild(slotsPanel);
    }
    const globalGroups = mk("div", "h3s-asset-groups");
    const globalItemsByType = new Map();
    const globalHeadsByType = new Map();
    for (const type of ["character", "scene", "prop", "general"]) {
      const section = mk("section", "h3s-asset-group");
      const items = mk("div", "h3s-asset-items");
      const count = globalFiles.filter((file) => getRefAssetMeta(node, file).type === type).length;
      const head = mk("div", "h3s-asset-group-head");
      head.append(mk("b", null, H3_ASSET_TYPES[type].label), mk("span", "count", `(${count})`));
      section.append(head, items);
      globalGroups.appendChild(section);
      globalItemsByType.set(type, items);
      globalHeadsByType.set(type, head);
    }
    const narratorSection = mk("section", "h3s-asset-group tail h3s-narrator-assets");
    const narratorItems = mk("div", "h3s-audio-assets");
    const narratorHead = mk("div", "h3s-asset-group-head");
    const narratorVoiceButton = mk("button", "h3s-btn",
      narratorVoiceAsset() ? `${narratorVoiceAsset().asset_id} 旁白音色` : "+ 旁白音色");
    narratorVoiceButton.title = narratorVoiceAsset()
      ? "更换本成片的旁白参考音色；已有分段引用会同步到新文件"
      : "上传本成片的旁白参考音色；设置后可加入需要旁白的分段";
    narratorHead.append(mk("b", null, "旁白音色"),
      mk("span", "count", narratorVoiceAsset() ? "(1/1)" : "(0/1)"), narratorVoiceButton);
    narratorSection.append(narratorHead, narratorItems);
    const audioSection = mk("section", "h3s-asset-group tail");
    const audioItems = mk("div", "h3s-audio-assets");
    const audioHead = mk("div", "h3s-asset-group-head");
    const narratorAssetId = String(node.properties.h3_create_narrator_voice_asset_id || "");
    const regularAudioCount = audioAssets.filter((asset) => asset.asset_id !== narratorAssetId).length;
    audioHead.append(mk("b", null, "参考音频 / 人物音色"), mk("span", "count", `(${regularAudioCount})`));
    audioSection.append(audioHead, audioItems);
    globalGroups.append(narratorSection, audioSection);
    narratorVoiceButton.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac";
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        narratorVoiceButton.disabled = true;
        try {
          const data = new FormData();
          data.append("audio", file, file.name);
          const response = await api.fetchApi("/h3director/upload_audio", { method: "POST", body: data });
          const result = await response.json();
          if (!response.ok || !result.ok || !result.name) {
            throw new Error(result.error || ("HTTP " + response.status));
          }
          let target = narratorVoiceAsset();
          const oldFile = target && target.file;
          if (!target) {
            target = { asset_id: nextCreateAudioAssetId(audioAssets) };
            audioAssets.push(target);
          }
          target.name = "旁白音色";
          target.file = result.name;
          target.label = result.label || file.name;
          target.usage = "timbre";
          node.properties.h3_create_narrator_voice_asset_id = target.asset_id;
          replaceCreateAudioAssetFileInSegments(createSegs, oldFile, target);
          save(); renderEditor();
          status.textContent = `已设置旁白音色 ${target.asset_id}；在音频卡点“+ 当前段”即可使用`;
        } catch (error) {
          status.textContent = "旁白音色上传失败：" + error.message;
          narratorVoiceButton.disabled = false;
        }
      });
      input.click();
    });
    let draggedLibraryFile = null;
    const clearLibraryDrag = () => {
      draggedLibraryFile = null;
      globalAssetsCard.querySelectorAll(".h3s-role-card.dragging").forEach((card) => card.classList.remove("dragging"));
      createSide.querySelectorAll(".h3s-asset-group.asset-drop").forEach((group) => group.classList.remove("asset-drop"));
    };
    const addGlobalAssetToCurrent = (file) => {
      if (globalAssetRefs.includes(file)) {
        status.textContent = "“" + getRefAssetMeta(node, file).name + "”已勾选全局参考，所有分段都会使用";
        return false;
      }
      const manual = segmentManualAssetFiles(s);
      const parsed = segmentParsedAssetFiles(s);
      if (manual.includes(file)) {
        status.textContent = "“" + getRefAssetMeta(node, file).name + "”已在当前段参考中";
        return false;
      }
      s.manual_refs = [...manual, file];
      syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
      const meta = getRefAssetMeta(node, file);
      let audioNote = "";
      if (meta.type === "character" && meta.voice_asset_id) {
        const linkedAudio = audioAssets.find((asset) => asset.asset_id === meta.voice_asset_id);
        if (linkedAudio) {
          const audioNumber = bindCreateAudioAssetToSegment(s, { ...linkedAudio, usage: "timbre" });
          audioNote = audioNumber
            ? `，并加入人物音色 ${linkedAudio.asset_id} <Audio ${audioNumber}>`
            : "；人物图片已加入，但音色因达到 3 路上限未加入";
        }
      }
      save();
      status.textContent = "已把 “" + meta.name + "” 加入当前段实际参考" + audioNote;
      renderEditor();
      return true;
    };
    globalFiles.forEach((file) => {
      const meta = getRefAssetMeta(node, file);
      const item = mk("div", "h3s-role-card");
      const picture = mk("div", "h3s-pic");
      const img = document.createElement("img");
      const imageSrc = api.apiURL("/view?filename=" + encodeURIComponent(file) + "&type=input");
      img.src = imageSrc;
      img.onerror = () => { img.style.display = "none"; };
      picture.append(img, applyH3MentionColor(mk("span", "num", meta.asset_id), meta.asset_id),
        mk("span", "tag", H3_ASSET_TYPES[meta.type].label));
      picture.draggable = true;
      picture.title = "点击放大查看；按住拖到下方当前段的角色、场景、道具或通用参考区";
      picture.addEventListener("click", () => openAssetImagePreview(
        imageSrc, `${meta.asset_id} ${meta.name} · ${H3_ASSET_TYPES[meta.type].label}`));
      picture.addEventListener("dragstart", (event) => {
        draggedLibraryFile = file;
        item.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-h3-asset", file);
          event.dataTransfer.setData("text/plain", file);
        }
        event.stopPropagation();
      });
      picture.addEventListener("dragend", clearLibraryDrag);
      const remove = mk("button", "x", "✕");
      remove.title = "从资产库移除；同时清理创作页面各段对这张图的引用，不删除磁盘图片";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const at = globalFiles.indexOf(file);
        if (at >= 0) globalFiles.splice(at, 1);
        const globalAt = globalAssetRefs.indexOf(file);
        if (globalAt >= 0) globalAssetRefs.splice(globalAt, 1);
        createSegs.forEach((segment) => {
          segment.refs = (segment.refs || []).filter((name) => name !== file);
          segment.manual_refs = (segment.manual_refs || []).filter((name) => name !== file);
          segment.parsed_refs = (segment.parsed_refs || []).filter((name) => name !== file);
          segment.auto_refs = (segment.auto_refs || []).filter((name) => name !== file);
        });
        ensureCreateAssetSlots(node).forEach((slot) => {
          if (slot.file === file) slot.file = "";
        });
        /* 只移除创作页全局库和创作分段引用。节点级旧元数据继续保留，避免同一图片
           仍被文本/视频页或旧工作流使用时，改名、别名和类型被跨页面清掉。 */
        syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
        save(); renderEditor();
        status.textContent = "已从资产库移除 “" + meta.name + "”；磁盘图片未删除";
      });
      picture.appendChild(remove);
      item.appendChild(picture);
      const nameInput = mk("input", "h3s-role-name");
      nameInput.value = meta.name;
      nameInput.placeholder = "资产名";
      nameInput.title = "默认取图片文件名，仅用于资产库中识别这张图片";
      nameInput.addEventListener("change", () => {
        meta.name = nameInput.value.trim() || roleNameFromFilename(meta.filename || file);
        refRoleMap[file] = meta.name;
        save();
      });
      item.appendChild(nameInput);
      const typeSelect = document.createElement("select");
      typeSelect.className = "h3s-asset-type";
      typeSelect.innerHTML = '<option value="character">角色</option><option value="scene">场景</option>'
        + '<option value="prop">道具</option><option value="general">通用参考</option>';
      typeSelect.value = meta.type;
      typeSelect.addEventListener("change", () => {
        assignCreateAssetId(node, globalFiles, file, typeSelect.value);
        syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
        save(); renderEditor();
      });
      item.appendChild(typeSelect);
      if (meta.type === "character") {
        const linkedAudio = audioAssets.find((asset) => asset.asset_id === String(meta.voice_asset_id || "").toUpperCase());
        if (linkedAudio) linkedAudio.usage = "timbre";
        const voice = mk("button", "h3s-btn", linkedAudio ? `${linkedAudio.asset_id} 人物音色` : "+ 人物音色");
        voice.title = linkedAudio
          ? "更换该人物的参考音色；@这个人物时会随人物图片一起加入对应分段"
          : "上传人物参考音色；以后 @这个人物时图片和音色会一起加入对应分段";
        voice.addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac";
          input.addEventListener("change", async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
              const data = new FormData();
              data.append("audio", file, file.name);
              const response = await api.fetchApi("/h3director/upload_audio", { method: "POST", body: data });
              const result = await response.json();
              if (!response.ok || !result.ok || !result.name) {
                throw new Error(result.error || ("HTTP " + response.status));
              }
              let target = linkedAudio || audioAssets.find((asset) => asset.file === result.name);
              const oldFile = target && target.file;
              if (!target) {
                target = { asset_id: nextCreateAudioAssetId(audioAssets) };
                audioAssets.push(target);
              }
              target.name = meta.name + "音色";
              target.file = result.name;
              target.label = result.label || file.name;
              target.usage = "timbre";
              meta.voice_asset_id = target.asset_id;
              replaceCreateAudioAssetFileInSegments(createSegs, oldFile, target);
              save(); renderEditor();
              status.textContent = `已为 ${meta.asset_id} ${meta.name} 绑定人物音色 ${target.asset_id}`;
            } catch (error) {
              status.textContent = "人物音色上传失败：" + error.message;
            }
          });
          input.click();
        });
        item.appendChild(voice);
      }
      const globalToggle = mk("label", "h3s-global-ref-toggle");
      const globalCheck = document.createElement("input");
      globalCheck.type = "checkbox";
      globalCheck.checked = globalAssetRefs.includes(file);
      globalCheck.addEventListener("change", () => {
        if (globalCheck.checked) {
          const candidate = uniqueAssetFiles([...globalAssetRefs, file]);
          globalAssetRefs.splice(0, globalAssetRefs.length, ...candidate);
        } else {
          const at = globalAssetRefs.indexOf(file);
          if (at >= 0) globalAssetRefs.splice(at, 1);
        }
        syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
        save(); renderEditor();
        status.textContent = globalCheck.checked
          ? "已把 “" + meta.name + "”设为全局参考，所有创作分段都会使用"
          : "已取消 “" + meta.name + "”的全局参考；只保留手动拖入过的分段";
      });
      globalToggle.append(globalCheck, document.createTextNode(" 全局参考"));
      item.appendChild(globalToggle);
      const globallyUsed = globalAssetRefs.includes(file);
      const manuallyUsed = segmentManualAssetFiles(s).includes(file);
      const use = mk("button", "h3s-btn", globallyUsed ? "全局已用" : (manuallyUsed ? "当前段已用" : "+ 当前段"));
      use.disabled = globallyUsed || manuallyUsed;
      use.addEventListener("click", () => addGlobalAssetToCurrent(file));
      item.appendChild(use);
      globalItemsByType.get(meta.type).appendChild(item);
    });
    audioAssets.forEach((asset) => {
      const linkedNarrator = String(node.properties.h3_create_narrator_voice_asset_id || "") === asset.asset_id;
      const linkedCharacter = globalFiles.some((file) => {
        const meta = getRefAssetMeta(node, file);
        return meta.type === "character" && meta.voice_asset_id === asset.asset_id;
      });
      const item = mk("div", "h3s-audio-asset-card");
      const badge = applyH3MentionColor(
        mk("span", "h3s-asset-mention-id", asset.asset_id + " ♪"), asset.asset_id);
      badge.title = asset.label || asset.file;
      item.appendChild(badge);
      const nameInput = mk("input", "h3s-role-name");
      nameInput.value = asset.name;
      nameInput.placeholder = "音频资产名";
      nameInput.addEventListener("change", () => {
        asset.name = nameInput.value.trim() || roleNameFromFilename(asset.label || asset.file);
        for (const segment of createSegs) {
          if (segment.audio === asset.file) segment.audio_label = asset.name;
          if (Array.isArray(segment.voice_refs) && segment.voice_refs.includes(asset.file)) {
            if (!segment.voice_labels || typeof segment.voice_labels !== "object") segment.voice_labels = {};
            segment.voice_labels[asset.file] = asset.name;
          }
        }
        save();
      });
      item.appendChild(nameInput);
      if (linkedCharacter || linkedNarrator) asset.usage = "timbre";
      if (linkedNarrator) {
        item.appendChild(mk("span", "h3s-hint", "画外旁白 · 只参考音色"));
      } else {
        const usage = document.createElement("select");
        usage.className = "h3s-asset-type";
        usage.innerHTML = '<option value="timbre">音色参考</option><option value="copy">配音驱动</option>';
        usage.value = asset.usage;
        usage.title = "音色参考：只学习声音；配音驱动：作为本段主配音并按原音轨对口型";
        usage.disabled = linkedCharacter;
        if (linkedCharacter) usage.title = "已绑定人物，固定作为人物音色参考；解除人物绑定后才能改为配音驱动";
        usage.addEventListener("change", () => {
          asset.usage = usage.value === "copy" ? "copy" : "timbre";
          save(); renderEditor();
          status.textContent = `${asset.asset_id} 用途已改为${asset.usage === "copy" ? "配音驱动" : "音色参考"}；重新加入分段时生效`;
        });
        item.appendChild(usage);
      }
      const listen = mk("button", "h3s-btn", "▶ 试听");
      listen.title = `试听 ${asset.asset_id} ${asset.name} 的本地音频`;
      listen.addEventListener("click", () => { void toggleAssetAudioPreview(asset, listen); });
      item.appendChild(listen);
      const number = createAudioAssetBindingNumber(s, asset);
      const use = mk("button", "h3s-btn", number ? `Audio ${number} 已用` : "+ 当前段");
      use.disabled = number > 0;
      use.addEventListener("click", () => {
        const audioNumber = linkedNarrator
          ? bindCreateNarratorVoiceToSegment(s, asset)
          : bindCreateAudioAssetToSegment(s, asset);
        if (!audioNumber) {
          status.textContent = "当前段已达到 3 路参考音频上限，请先移除一个音色或配音";
          return;
        }
        save(); renderEditor();
        status.textContent = `已把 ${asset.asset_id} ${asset.name} 加入当前段 <Audio ${audioNumber}>`;
      });
      item.appendChild(use);
      if (number) {
        const detach = mk("button", "h3s-btn", "移出本段");
        detach.addEventListener("click", () => {
          removeCreateAudioAssetFromSegment(s, asset.file);
          if (linkedNarrator) removeCreateNarratorVoiceDeclaration(s);
          save(); renderEditor();
          status.textContent = `已从当前段移除 ${asset.asset_id} ${asset.name}`;
        });
        item.appendChild(detach);
      } else {
        const remove = mk("button", "h3s-btn", "删除");
        remove.title = "从资产库和创作分段移除；不删除磁盘音频";
        remove.addEventListener("click", () => {
          const index = audioAssets.indexOf(asset);
          if (index >= 0) audioAssets.splice(index, 1);
          createSegs.forEach((segment) => removeCreateAudioAssetFromSegment(segment, asset.file));
          if (linkedNarrator) {
            node.properties.h3_create_narrator_voice_asset_id = "";
            createSegs.forEach((segment) => removeCreateNarratorVoiceDeclaration(segment));
          }
          Object.values(ensureAssetMetaMap(node)).forEach((meta) => {
            if (meta && meta.voice_asset_id === asset.asset_id) meta.voice_asset_id = "";
          });
          save(); renderEditor();
          status.textContent = `已从资产库移除 ${asset.asset_id} ${asset.name}；磁盘音频未删除`;
        });
        item.appendChild(remove);
      }
      (linkedNarrator ? narratorItems : audioItems).appendChild(item);
    });
    const makeGlobalUploadButton = (type, directory = false) => {
      const label = H3_ASSET_TYPES[type].label;
      const add = mk("button", "h3s-btn", directory ? "选择文件夹" : "多选图片");
      add.title = directory
        ? `选择包含${label}图片的文件夹；子文件夹中的图片也会导入当前分类`
        : `支持单选、Ctrl/Shift 和鼠标框选多张${label}图片`;
      add.addEventListener("click", () => {
        const menu = add.closest("details");
        if (menu) menu.open = false;
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/*"; input.multiple = true;
        if (directory) {
          input.webkitdirectory = true;
          input.setAttribute("webkitdirectory", "");
        }
        input.addEventListener("change", async () => {
          const selectedCount = input.files && input.files.length || 0;
          const files = Array.from(input.files || []).filter((file) =>
            String(file.type || "").startsWith("image/")
            || /\.(?:png|jpe?g|jfif|pjp|pjpeg|webp|gif|bmp|tiff?|apng|avif)$/i.test(file.name));
          if (!files.length) {
            status.textContent = directory ? "所选文件夹中没有可导入的图片" : "没有选择图片";
            return;
          }
          let ok = 0;
          for (let index = 0; index < files.length; index++) {
            const file = files[index];
            status.textContent = `正在导入${label}图片 ${index + 1}/${files.length}…`;
            try {
              const data = new FormData();
              const uploadName = directory && file.webkitRelativePath
                ? file.webkitRelativePath.replace(/[\\/]+/g, "__")
                : file.name;
              data.append("image", file, uploadName); data.append("overwrite", "true");
              const result = await (await api.fetchApi("/upload/image", { method: "POST", body: data })).json();
              if (!result || !result.name) throw new Error(result && result.error || "上传接口没有返回文件名");
              const savedName = (result.subfolder ? result.subfolder + "/" : "") + result.name;
              if (!globalFiles.includes(savedName)) globalFiles.push(savedName);
              const meta = assignCreateAssetId(node, globalFiles, savedName, type, file.name);
              meta.filename = String(file.name || meta.filename || "");
              ok += 1;
            } catch (error) { console.error("[H3导演台] 全局资产上传失败:", file.name, error); }
          }
          save(); renderEditor();
          status.textContent = "已加入资产库 " + ok + "/" + files.length + " 张" + label + "图片"
            + (selectedCount > files.length ? "；已跳过 " + (selectedCount - files.length) + " 个非图片文件" : "")
            + "；名称默认取文件名";
        });
        input.click();
      });
      return add;
    };
    const makeGlobalUploadMenu = (type) => {
      const label = H3_ASSET_TYPES[type].label;
      const menu = mk("details", "h3s-asset-add-menu");
      const toggle = mk("summary", null, "+");
      toggle.title = `添加${label}资产`;
      toggle.setAttribute("aria-label", `添加${label}资产`);
      const panel = mk("div", "h3s-asset-add-menu-panel");
      panel.append(makeGlobalUploadButton(type), makeGlobalUploadButton(type, true));
      menu.append(toggle, panel);
      return menu;
    };
    for (const type of ["character", "scene", "prop", "general"]) {
      globalHeadsByType.get(type).appendChild(makeGlobalUploadMenu(type));
    }
    globalAssetsCard.appendChild(globalGroups);
    attachSavedCardResize(
      globalAssetsCard,
      "h3_create_asset_library_width", "h3_create_asset_library_height",
      280, 260,
    );

    /* 统一编号的当前段实际参考：尾帧 → 本段图。 */
    const insertTag = (num) => {
      const tag = `<Picture ${num}>`;
      const st = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      ta.value = ta.value.slice(0, st) + tag + ta.value.slice(st);
      s.prompt = ta.value;
      save();
      ta.focus();
      ta.selectionStart = ta.selectionEnd = st + tag.length;
    };

    const refsCard = card("当前段实际参考", "h3s-card-refs h3s-card-current-refs");
    createSide.appendChild(refsCard);
    const refRow = mk("div", "h3s-row");
    refRow.appendChild(mk("span", "h3s-hint",
      "这里是当前段真正发送给模型的图片，顺序就是 Picture 编号。已勾选全局参考的资产自动出现；其它资产从上方拖入。"));
    refsCard.appendChild(refRow);
    const refs = mk("div", "h3s-asset-groups");
    const refsByType = new Map();
    const refHeadsByType = new Map();
    const addAssetGroup = (type, label, isTail = false) => {
      const group = mk("section", "h3s-asset-group" + (isTail ? " tail" : ""));
      const items = mk("div", "h3s-asset-items");
      const count = isTail ? 1 : s.refs.filter((file) => getRefAssetMeta(node, file).type === type).length;
      const head = mk("div", "h3s-asset-group-head");
      head.append(mk("b", null, label), mk("span", "count", `(${count})`));
      group.append(head, items);
      refs.appendChild(group);
      if (!isTail) {
        items.title = "从资产库拖入" + label;
        items.addEventListener("dragover", (event) => {
          if (!draggedLibraryFile) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
          group.classList.add("asset-drop");
        });
        items.addEventListener("dragleave", (event) => {
          if (!group.contains(event.relatedTarget)) group.classList.remove("asset-drop");
        });
        items.addEventListener("drop", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const file = draggedLibraryFile
            || (event.dataTransfer && event.dataTransfer.getData("application/x-h3-asset"));
          clearLibraryDrag();
          if (!file || !globalFiles.includes(file)) return;
          const actualType = getRefAssetMeta(node, file).type;
          if (addGlobalAssetToCurrent(file) && actualType !== type) {
            status.textContent = "资产类型是“" + H3_ASSET_TYPES[actualType].label
              + "”，已加入当前段对应分类";
          }
        });
        refsByType.set(type, items);
        refHeadsByType.set(type, head);
      }
      return items;
    };
    let tailRefs = null;
    if (s.use_tail !== false && sel > 0) tailRefs = addAssetGroup("tail", "续接尾帧", true);
    const assetGroupLabels = {
      character: "角色参考图", scene: "场景参考图", prop: "道具参考图", general: "通用参考图",
    };
    for (const type of ["character", "scene", "prop", "general"]) {
      addAssetGroup(type, assetGroupLabels[type]);
    }

    const pics = [];
    if (s.use_tail !== false && sel > 0) {
      pics.push({ src: api.apiURL("/h3director/tail?seg=" + sel + "&" + _modeQ() + "&t=" + Date.now()), tag: "尾帧", type: "tail" });
    }
    s.refs.forEach((name, k) => {
      const assetMeta = getRefAssetMeta(node, name);
      const isGlobal = globalAssetRefs.includes(name);
      pics.push({
        src: api.apiURL("/view?filename=" + encodeURIComponent(name) + "&type=input"),
        tag: (isGlobal ? "全局 " : "") + H3_ASSET_TYPES[assetMeta.type].label + " " + assetMeta.asset_id,
        refIdx: k,
        file: name,
        assetMeta,
        type: assetMeta.type,
        isGlobal,
      });
    });

    /* 当前段手动参考可拖动换序；全局参考固定在前，保证所有分段 Picture 顺序一致。 */
    let dragRefFile = null;
    pics.forEach((p, i) => {
      const num = i + 1;
      const card = mk("div", "h3s-role-card");
      const box = mk("div", "h3s-pic");
      box.title = `Picture ${num}（点击卡片插入提示词；点击图片放大查看）`;
      const img = document.createElement("img");
      img.src = p.src;
      img.onerror = () => { img.style.display = "none"; };
      const previewLabel = p.refIdx != null
        ? `Picture ${num} · ${p.assetMeta.asset_id} ${p.assetMeta.name}`
        : `Picture ${num} · 上段尾帧`;
      img.title = previewLabel + "（点击放大查看）";
      img.addEventListener("click", (event) => {
        event.stopPropagation();
        openAssetImagePreview(p.src, previewLabel);
      });
      const badge = mk("span", "num", `P${num}`);
      const tagEl = mk("span", "tag", p.tag);
      box.append(img, badge, tagEl);
      box.addEventListener("click", () => insertTag(num));
      if (p.refIdx != null && !p.isGlobal) {
        box.draggable = true;
        box.style.cursor = "grab";
        box.title = `Picture ${num}（点击卡片插入提示词；点击图片放大查看；按住拖到别的图上可换顺序）`;
        box.addEventListener("dragstart", (ev) => {
          dragRefFile = p.file;
          box.style.opacity = "0.45";
          ev.stopPropagation();
        });
        box.addEventListener("dragend", () => {
          dragRefFile = null;
          box.style.opacity = "";
          refs.querySelectorAll(".h3s-pic").forEach((x) => { x.style.outline = ""; });
        });
        box.addEventListener("dragover", (ev) => {
          if (!dragRefFile || dragRefFile === p.file) return;
          ev.preventDefault();  // 允许放置
          ev.stopPropagation();
          box.style.outline = "2px solid #4a9eff";
        });
        box.addEventListener("dragleave", () => { box.style.outline = ""; });
        box.addEventListener("drop", (ev) => {
          if (!dragRefFile || dragRefFile === p.file) return;
          ev.preventDefault();
          ev.stopPropagation();
          const manual = segmentManualAssetFiles(s);
          const from = manual.indexOf(dragRefFile);
          const to = manual.indexOf(p.file);
          if (from < 0 || to < 0) return;
          const moved = manual.splice(from, 1)[0];
          manual.splice(to, 0, moved);
          s.manual_refs = manual;
          syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
          save();
          renderEditor();
          status.textContent = "参考图顺序已调整（Picture 编号已重排，请检查提示词里的 @图N）";
        });
        const x = mk("button", "x", "✕");
        x.title = "移除该参考图";
        x.addEventListener("click", (ev) => {
          ev.stopPropagation();
          s.manual_refs = segmentManualAssetFiles(s).filter((file) => file !== p.file);
          s.parsed_refs = segmentParsedAssetFiles(s).filter((file) => file !== p.file);
          syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
          save();
          renderEditor();
        });
        box.appendChild(x);
      }
      card.appendChild(box);
      if (p.refIdx != null) {
        card.appendChild(mk("div", "h3s-role-static", p.assetMeta.name));
      } else {
        card.appendChild(mk("div", "h3s-role-static", "上段尾帧"));
      }
      const destination = p.refIdx == null ? tailRefs : refsByType.get(p.assetMeta.type);
      if (destination) destination.appendChild(card);
    });

    const makeAssetAddButton = (type) => {
      const label = H3_ASSET_TYPES[type].label;
      const add = mk("button", "h3s-asset-add-button", "+");
      add.title = "上传到创作页资产库并手动加入当前段；同一文件不会复制成两个资产";
      add.setAttribute("aria-label", `添加${label}参考图`);
      add.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.multiple = true;
        inp.addEventListener("change", async () => {
          if (!inp.files.length) return;
          status.textContent = "正在上传 " + inp.files.length + " 张" + label + "参考图…";
          let ok = 0;
          for (const f of inp.files) {
            try {
              const fd = new FormData();
              fd.append("image", f, f.name);
              fd.append("overwrite", "true");
              const r = await (await api.fetchApi("/upload/image", { method: "POST", body: fd })).json();
              if (!r || !r.name) throw new Error(r && r.error || "上传接口没有返回文件名");
              const savedName = (r.subfolder ? r.subfolder + "/" : "") + r.name;
              if (!globalFiles.includes(savedName)) globalFiles.push(savedName);
              const meta = assignCreateAssetId(node, globalFiles, savedName, type, f.name);
              meta.filename = String(f.name || meta.filename || "");
              const manual = segmentManualAssetFiles(s);
              if (!globalAssetRefs.includes(savedName) && !manual.includes(savedName)) {
                s.manual_refs = [...manual, savedName];
              }
              ok++;
            } catch (e) { console.error("[H3导演台] 参考图上传失败:", f.name, e); }
          }
          syncCreateSegmentAssetRefs(node, createSegs, globalAssetRefs);
          save();
          renderEditor();
          status.textContent = "已处理 " + ok + "/" + inp.files.length + " 张" + label + "参考图"
            + "；名称默认取文件名";
        });
        inp.click();
      });
      return add;
    };
    for (const type of ["character", "scene", "prop", "general"]) {
      refHeadsByType.get(type).appendChild(makeAssetAddButton(type));
    }
    refsCard.appendChild(refs);
    attachSavedCardResize(
      refsCard,
      "h3_create_current_refs_width", "h3_create_current_refs_height",
      280, 240,
    );

    /* v1.8.1：「环境音垫」下拉已按用户要求移除——用户要的是 H3 原生生成（纯提示词驱动），
       不要后期垫层。后端 amb_audio 参数保留兼容（旧配置不影响），UI 不再提供入口。 */

    // ---- 本段音频：模型音频 / 参考驱动(对口型) 二选一（v1.7.3 起下架替换/混合） ----
    // 状态主字段是 s.audio_src（独立存储，不依赖是否已上传文件），
    // 否则选了"自定义"但没传文件时，renderEditor 重建会把选择弹回"模型音频"（选不中的 bug）。
    if (!s.audio_src) {
      s.audio_src = s.audio ? (s.audio_mode === "mix" ? "mix" : "replace") : "model";
    }
    const audioCard = card("本段音频", "h3s-card-audio");
    createSide.appendChild(audioCard);
    const audioRow = mk("div", "h3s-row");
    audioRow.appendChild(mk("span", "h3s-hint", "本段音频："));
    const asrc = document.createElement("select");
    /* 替换/混合是 ffmpeg 事后贴轨、口型必然错位，已下架。
       旧工作流里已存 replace/mix 的段：动态补一个"旧版"选项保证能显示、能切走，后端逻辑不变。 */
    asrc.innerHTML = '<option value="model">模型音频（H3 生成）</option>'
                   + '<option value="ref">参考音频驱动（对口型，配音推荐）</option>';
    if (s.audio_src === "replace" || s.audio_src === "mix") {
      const legacy = document.createElement("option");
      legacy.value = s.audio_src;
      legacy.textContent = s.audio_src === "mix" ? "混合（旧版，不对口型）" : "自定义替换（旧版，不对口型）";
      asrc.appendChild(legacy);
    }
    asrc.value = s.audio_src;
    asrc.title = "模型音频：直接用 H3 生成的声音（无需上传）\n参考音频驱动：上传配音喂给 H3 当生成条件，模型听着它说台词，口型原生同步（配音首选）";
    asrc.addEventListener("change", () => {
      s.audio_src = asrc.value;
      if (asrc.value === "model") {
        s.audio = null;
      } else {
        s.audio_mode = asrc.value;
        if (!s.audio) status.textContent = "请点「+音频」上传本段配音文件";
      }
      s.prompt = ta.value; save(); renderTimeline(); renderEditor();
    });
    audioRow.appendChild(asrc);
    if (s.audio_src === "ref") {
      /* 参考音频的两种官方关系（MiniMax R2V 提示词指南）：
         fully_copy=音轨 1:1 复用（口型同步）；reference=只学音色（台词按提示词重新生成） */
      const rmode = document.createElement("select");
      rmode.innerHTML = '<option value="copy">复刻音轨（1:1 对口型）</option>'
                      + '<option value="timbre">仅音色参考（模型重新演绎）</option>';
      rmode.value = s.audio_ref_mode || "copy";
      rmode.title = "复刻音轨：模型把你的配音 1:1 用作成片音轨，画面口型对齐它（配音台词首选）\n仅音色参考：模型只学音色和语气，台词按提示词重新生成（声音克隆）";
      rmode.addEventListener("change", () => {
        s.audio_ref_mode = rmode.value;
        s.prompt = ta.value; save(); renderTimeline(); renderEditor();
      });
      audioRow.appendChild(rmode);
      /* v1.12：按用户要求恢复 v1.7.3 简洁形态——只保留单人对口型（复刻/仅音色），
         「双人对口型」按钮已移除。 */
    }

    if (s.audio_src !== "model") {
      if (s.audio) {
        audioRow.appendChild(mk("span", "h3s-hint", "♪ " + (s.audio_label || s.audio)));
        const ax = mk("button", "h3s-btn", "×");
        ax.title = "移除音频文件（自动切回模型音频）";
        ax.addEventListener("click", () => {
          s.audio = null; s.audio_label = null; s.audio_src = "model";
          s.prompt = ta.value; save(); renderTimeline(); renderEditor();
        });
        audioRow.appendChild(ax);

        /* 音量只在替换/混合模式有意义（ref 模式音轨由模型生成，音量不适用） */
        if (s.audio_src !== "ref") {
          audioRow.appendChild(mk("span", "h3s-hint", "音量"));
          const vol = document.createElement("input");
          vol.type = "number"; vol.min = "0.1"; vol.max = "2"; vol.step = "0.1";
          vol.value = s.audio_vol || 1.0;
          vol.style.width = "52px";
          vol.title = "自定义音频音量 0.1~2.0";
          vol.addEventListener("change", () => {
            s.audio_vol = parseFloat(vol.value) || 1.0; s.prompt = ta.value; save();
          });
          audioRow.appendChild(vol);
        }
      } else {
        audioRow.appendChild(mk("span", "h3s-hint", "（未上传，请点 +音频）"));
      }
      const aadd = mk("button", "h3s-btn", "+音频");
      aadd.title = "上传 wav/mp3/m4a 等音频作为本段配音";
      aadd.addEventListener("click", () => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac";
        inp.style.display = "none";
        document.body.appendChild(inp);  // detached input 的 click() 在部分内核不弹窗
        inp.addEventListener("change", async () => {
          try {
            if (!inp.files[0]) return;
            status.textContent = "正在上传音频…";
            await uploadAudioToSeg(inp.files[0], sel);
            s.prompt = ta.value; save();
            status.textContent = "音频已上传";
            renderTimeline(); renderEditor();
          } catch (e) {
            status.textContent = "音频上传出错: " + e.message;
          } finally {
            inp.remove();
          }
        });
        inp.click();
      });
      audioRow.appendChild(aadd);

      /* 音频库（参考 WhatDreamsCost 的文件夹扫描）：input 目录已有音频下拉直接选用 */
      const alib = document.createElement("select");
      alib.style.maxWidth = "150px";
      alib.innerHTML = '<option value="">音频库…</option>';
      alib.title = "从 input 目录已有音频中直接选用（含以往上传的，无需重复上传）";
      alib.addEventListener("change", () => {
        if (!alib.value) return;
        s.audio = alib.value;
        s.prompt = ta.value; save();
        status.textContent = "段" + (sel + 1) + " 已选用音频库文件";
        renderTimeline(); renderEditor();
      });
      audioRow.appendChild(alib);
      api.fetchApi("/h3director/list_audio").then((r) => r.json()).then((d) => {
        for (const f of (d.files || [])) {
          const o = document.createElement("option");
          o.value = f.name;
          o.textContent = f.name;
          alib.appendChild(o);
        }
      }).catch(() => { /* 旧后端无此路由时下拉仅占位，重启 ComfyUI 后可用 */ });
    }
    audioCard.appendChild(audioRow);

    /* ---- 音频可视化裁剪：波形 + 左右拖柄选区间 + 保留/删除模式 + 起始偏移 ---- */
    if (s.audio) {
      const trimBox = mk("div", "h3s-trim");
      const tmodeRow = mk("div", "h3s-row");
      tmodeRow.appendChild(mk("span", "h3s-hint", "裁剪模式："));
      const tmode = document.createElement("select");
      tmode.innerHTML = '<option value="keep">保留选中区</option><option value="cut">删除选中区（中间挖掉）</option>';
      tmode.value = s.audio_trim_mode || "keep";
      tmode.title = "保留：只用选中的这段；删除：把选中的挖掉，首尾接起来";
      tmode.addEventListener("change", () => {
        s.audio_trim_mode = tmode.value;
        s.prompt = ta.value; save(); renderEditor();
      });
      tmodeRow.appendChild(tmode);
      trimBox.appendChild(tmodeRow);
      const cv = document.createElement("canvas");
      cv.className = "h3s-wave";
      cv.width = 520; cv.height = 46;
      trimBox.appendChild(cv);
      const trimInfo = mk("div", "h3s-hint", "波形加载中…");
      trimBox.appendChild(trimInfo);
      const trimWarn = mk("div", "h3s-audio-warn", "");
      trimWarn.style.display = "none";
      trimBox.appendChild(trimWarn);
      audioCard.appendChild(trimBox);

      loadWavePeaks(s.audio).then((wv) => {
        if (!wv || !wv.duration) { trimInfo.textContent = "波形加载失败（不影响生成）"; return; }
        const dur = wv.duration, W = cv.width, H = cv.height;
        let t0 = Math.min(Math.max(0, s.audio_trim_start || 0), dur);
        let t1 = (s.audio_trim_end > 0 && s.audio_trim_end <= dur) ? s.audio_trim_end : dur;
        if (t1 - t0 < 0.1) { t0 = 0; t1 = dur; }
        const x0 = () => t0 / dur * W, x1 = () => t1 / dur * W;
        const draw = () => {
          const g = cv.getContext("2d");
          g.clearRect(0, 0, W, H);
          const n = wv.peaks.length, bw = W / n;
          const isCut = s.audio_trim_mode === "cut";
          for (let i = 0; i < n; i++) {
            const h = Math.max(1, wv.peaks[i] * (H - 6));
            const x = i * bw;
            const inSel = x >= x0() && x <= x1();
            /* keep：选区绿/两侧暗绿；cut：选区红（要删的）/两侧绿（保留的） */
            g.fillStyle = inSel ? (isCut ? "#e05555" : "#39d98a") : (isCut ? "#39d98a" : "#2a4a3e");
            g.fillRect(x, (H - h) / 2, Math.max(1, bw - 0.5), h);
          }
          if (!isCut) {
            g.fillStyle = "rgba(0,0,0,0.55)";
            g.fillRect(0, 0, x0(), H);
            g.fillRect(x1(), 0, W - x1(), H);
          }
          g.fillStyle = "#ffd166";
          g.fillRect(x0() - 2, 0, 4, H);
          g.fillRect(x1() - 2, 0, 4, H);
        };
        const commit = () => {
          const isCut = s.audio_trim_mode === "cut";
          trimInfo.textContent = (isCut ? "删除 " : "裁剪 ") + t0.toFixed(1) + "s ~ " + t1.toFixed(1) +
            "s（全长 " + dur.toFixed(1) + "s" + (isCut ? "，保留首尾" : "，选中 " + (t1 - t0).toFixed(1) + "s") + "）";
          /* 音长警示：有效音频（含起始偏移）盖不住段长 → 尾部无声；超出 → 被截断 */
          const need = segDur(s) - (s.audio_offset || 0);
          const usable = isCut ? dur - (t1 - t0) : t1 - t0;
          if (usable < need - 0.3) {
            trimWarn.textContent = "⚠ 有效音频 " + usable.toFixed(1) + "s 盖不住段长 " + need.toFixed(1) + "s，尾部约 " + (need - usable).toFixed(1) + "s 将无声";
            trimWarn.style.display = "";
          } else if (usable > need + 0.3) {
            trimWarn.textContent = "⚠ 有效音频 " + usable.toFixed(1) + "s 超出段长 " + need.toFixed(1) + "s，超出部分将被截断";
            trimWarn.style.display = "";
          } else {
            trimWarn.style.display = "none";
          }
        };
        let dragSide = null;
        const evT = (ev) => {
          const r = cv.getBoundingClientRect();
          return Math.min(Math.max(((ev.clientX - r.left) * (W / r.width)) / W * dur, 0), dur);
        };
        cv.addEventListener("pointerdown", (ev) => {
          const r = cv.getBoundingClientRect();
          const x = (ev.clientX - r.left) * (W / r.width);
          dragSide = Math.abs(x - x0()) <= Math.abs(x - x1()) ? "l" : "r";
          cv.setPointerCapture(ev.pointerId);
          ev.preventDefault();
        });
        cv.addEventListener("pointermove", (ev) => {
          if (!dragSide) return;
          const t = evT(ev);
          if (dragSide === "l") t0 = Math.min(t, t1 - 0.1); else t1 = Math.max(t, t0 + 0.1);
          draw(); commit();
        });
        cv.addEventListener("pointerup", () => {
          if (!dragSide) return;
          dragSide = null;
          /* 贴边的裁剪值归 0（=不裁剪），让后端逻辑最简 */
          s.audio_trim_start = t0 <= 0.05 ? 0 : Math.round(t0 * 100) / 100;
          s.audio_trim_end = t1 >= dur - 0.05 ? 0 : Math.round(t1 * 100) / 100;
          s.prompt = ta.value; save();
        });
        draw(); commit();
      }).catch(() => { trimInfo.textContent = "波形加载失败（不影响生成）"; });

      const offRow = mk("div", "h3s-row");
      offRow.appendChild(mk("span", "h3s-hint", "起始偏移（配音从段内第 X 秒开始）："));
      const off = document.createElement("input");
      off.type = "number"; off.min = "0"; off.max = "60"; off.step = "0.1";
      off.value = s.audio_offset || 0;
      off.style.width = "56px";
      off.title = "0 = 段开头就播；超出段时长的部分自动截断";
      off.addEventListener("change", () => {
        s.audio_offset = Math.max(0, parseFloat(off.value) || 0);
        s.prompt = ta.value; save();
      });
      offRow.appendChild(off);
      audioCard.appendChild(offRow);
    }

    // ---- 本段成片预览：点击段落即可查看已生成视频（带声音），方便定位想重跑的段 ----
    const previewCard = card("视频预览", "h3s-card-preview");
    createMain.appendChild(previewCard);
    attachPreviewCardResize(previewCard, "create");
    const pvWrap = mk("div", "h3s-pv");
    /* pvWrap 作为编辑区的弹性填充层：display:flex 后 pvBox 的 flex:1 才生效 */
    pvWrap.style.cssText = "flex:1;display:flex;flex-direction:column;min-height:260px;gap:4px;";
    previewCard.appendChild(pvWrap);
    void renderSegmentVideoCompare(pvWrap, sel + 1, 220);
  }

  const updateUpscaleProgressDisplay = () => {
    const percent = Math.min(100, Math.max(0, Number(upscaleProgress) || 0));
    const fill = editor.querySelector(".h3s-upscale-progress-fill");
    const label = editor.querySelector(".h3s-upscale-progress-label");
    const value = editor.querySelector(".h3s-upscale-progress-percent");
    if (fill) fill.style.width = `${percent}%`;
    if (label) label.textContent = upscaleProgressText;
    if (value) value.textContent = `${Math.round(percent)}%`;
  };
  const onProgress = (e) => {
    const d = e.detail;
    if (d && d.max) progIn.style.width = Math.round((d.value / d.max) * 100) + "%";
    if (!upscaleRunning || !d || String(d.node || "") !== "h3_upscale_output"
        || Number(d.max) !== 10000) return;
    const promptId = String(d.prompt_id || "");
    if (!upscalePromptId || !promptId || promptId !== upscalePromptId) return;
    upscaleProgress = Math.min(100, Math.max(upscaleProgress, Number(d.value) / Number(d.max) * 100));
    upscaleProgressText = upscaleProgress >= 100
      ? "超分完成"
      : upscaleProgress >= 93 ? "正在编码并保存视频" : "正在逐帧超分";
    updateUpscaleProgressDisplay();
  };
  const finishUpscale = (result) => {
    upscaleResult = result;
    upscaleRunning = false;
    upscaleEarlyEvents.clear();
    upscalePromptId = "";
    upscaleProgress = 100;
    upscaleProgressText = "超分完成";
    upscaleRunMessage = upscaleResult
      ? "超分完成；新视频已保存，原视频未覆盖。"
      : "超分任务已完成，但没有返回可预览的视频，请在任务详情检查输出。";
    persistUpscaleState();
    if (curTab() === "upscale") renderEditor();
  };
  const recoverUpscaleFromHistory = async (promptId, reportFailure) => {
    try {
      const result = await readH3UpscaleHistory(
        api.fetchApi.bind(api), promptId, reportFailure ? 10 : 3, 100);
      if (!upscaleRunning || promptId !== upscalePromptId) return;
      finishUpscale(result);
    } catch (error) {
      if (!reportFailure || !upscaleRunning || promptId !== upscalePromptId) return;
      finishUpscale(null);
      upscaleRunMessage = "超分任务已完成，但读取结果失败：" + error.message;
      if (curTab() === "upscale") renderEditor();
    }
  };
  const onExecuted = (event) => {
    progIn.style.width = "100%";
    markDone(true);
    const detail = event && event.detail || {};
    if (!upscaleRunning || String(detail.node || "") !== "h3_upscale_output") return;
    const promptId = String(detail.prompt_id || "");
    if (!promptId) return;
    if (!upscalePromptId) {
      upscaleEarlyEvents.set(promptId, { type: "executed", detail });
      return;
    }
    if (promptId !== upscalePromptId) return;
    const result = h3UpscaleResultFromExecuted(detail);
    if (result) finishUpscale(result);
    else void recoverUpscaleFromHistory(promptId, true);
  };
  const onUpscaleQueueSuccess = async (event) => {
    if (!upscaleRunning) return;
    const detail = event && event.detail || {};
    const promptId = String(detail.prompt_id || "");
    if (!promptId) return;
    if (!upscalePromptId) {
      upscaleEarlyEvents.set(promptId, { type: "success", detail });
      return;
    }
    if (promptId !== upscalePromptId) return;
    await recoverUpscaleFromHistory(promptId, true);
  };
  const failUpscale = (detail) => {
    upscaleRunning = false;
    upscaleEarlyEvents.clear();
    upscalePromptId = "";
    upscaleProgressText = "超分失败或已取消";
    const message = detail.exception_message || detail.error || detail.message || "任务失败或已取消";
    upscaleRunMessage = "超分未完成：" + message;
    if (curTab() === "upscale") renderEditor();
  };
  const onUpscaleFailure = (event) => {
    if (!upscaleRunning) return;
    const detail = event && event.detail || {};
    const promptId = String(detail.prompt_id || "");
    if (!promptId) return;
    if (!upscalePromptId) {
      upscaleEarlyEvents.set(promptId, { type: "failure", detail });
      return;
    }
    if (promptId !== upscalePromptId) return;
    failUpscale(detail);
  };
  const onSecondSampleStage = (event) => {
    if (!secondSampleRuntimeActive) return;
    const stage = normalizeH3SecondSampleRuntimeStage(event && event.detail);
    if (!stage || stage.display_node !== String(node.id)
        || stage.project_id !== secondSampleRuntimeProjectId
        || !secondSampleRuntimeSegments.has(stage.segment_index)) return;
    if (!secondSampleRuntimePromptId) {
      const early = secondSampleRuntimeEarlyEvents.get(stage.prompt_id) || [];
      early.push(stage);
      if (early.length > 24) early.shift();
      secondSampleRuntimeEarlyEvents.set(stage.prompt_id, early);
      return;
    }
    if (stage.prompt_id !== secondSampleRuntimePromptId) return;
    applySecondSampleRuntimeStage(stage);
  };
  api.addEventListener("progress", onProgress);
  api.addEventListener("executed", onExecuted);
  api.addEventListener("execution_success", onUpscaleQueueSuccess);
  api.addEventListener("execution_error", onUpscaleFailure);
  api.addEventListener("execution_interrupted", onUpscaleFailure);
  api.addEventListener("h3director_second_sample_stage", onSecondSampleStage);

  let cleaned = false;
  node.__h3Cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stopAssetAudioPreview();
    closeAssetMentionPopup();
    closeUpscaleComparison();
    api.removeEventListener("progress", onProgress);
    api.removeEventListener("executed", onExecuted);
    api.removeEventListener("execution_success", onUpscaleQueueSuccess);
    api.removeEventListener("execution_error", onUpscaleFailure);
    api.removeEventListener("execution_interrupted", onUpscaleFailure);
    upscaleRunning = false;
    upscaleModelBusy = false;
    upscalePromptId = "";
    upscaleEarlyEvents.clear();
    api.removeEventListener("h3director_second_sample_stage", onSecondSampleStage);
    finishSecondSampleRuntime();
    flushScheduledSave();
    if (scriptDirtySaveTimer) clearTimeout(scriptDirtySaveTimer);
    disconnectEditorObservers();
    if (node.__h3ClaimedProjectId && activeProjectIds.get(node.__h3ClaimedProjectId) === node) {
      activeProjectIds.delete(node.__h3ClaimedProjectId);
    }
    node.__h3ClaimedProjectId = null;
    node.__h3Reload = null;
  };

  renderTimeline();
  renderEditor();
  /* 新建节点默认给方案 A 足够的双栏空间；旧工作流若保存了较窄尺寸，会由响应式规则自动显示单栏。 */
  node.setSize([Math.max(node.size[0], 1040), Math.max(node.size[1], 840)]);
  node.__h3Reload = reloadFromWidget;
  return box;
}

const H3_INTERNAL_WIDGET_NAMES = new Set([
  "segments_json", "vsegments_json", "tsegments_json", "ui_mode", "global_prompt",
  "续接方式", "每段后卸载模型", "汇总输出", "project_id", "text_shared_refs_json",
]);

function removeObsoleteH3InputSlots(node) {
  if (!Array.isArray(node && node.inputs) || typeof node.removeInput !== "function") return false;
  let changed = false;
  for (let index = node.inputs.length - 1; index >= 0; index--) {
    const name = String(node.inputs[index] && node.inputs[index].name || "");
    if (name !== "fl2va_model" && !/^ref_image_\d+$/.test(name)) continue;
    node.removeInput(index);
    changed = true;
  }
  return changed;
}

function hideH3InternalWidgets(node) {
  for (const widget of (node && node.widgets) || []) {
    if (!H3_INTERNAL_WIDGET_NAMES.has(widget && widget.name)) continue;
    widget.hidden = true;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.options.hideInPanel = true;
    widget.computeSize = () => [0, -4];
    if (widget.element && widget.element.style) widget.element.style.display = "none";
  }
}

/* 新旧 ComfyUI 都可能在不同阶段创建节点。beforeRegisterNodeDef 是主路径，
   nodeCreated 是加载顺序异常/旧工作流恢复时的补挂路径；两者共用同一个幂等函数。
   这样即使专用面板构建失败，内部 JSON 控件也不会再整块裸露。 */
function attachH3StudioNode(node) {
  if (!node) return;
  removeObsoleteH3InputSlots(node);
  if (node.__h3StudioAttached) {
    if (typeof node.__h3SyncDirectorWidgetSize === "function") node.__h3SyncDirectorWidgetSize();
    return;
  }
  hideH3InternalWidgets(node);
  if (typeof node.addDOMWidget !== "function") return;
  node.__h3StudioAttached = true;
  const container = document.createElement("div");
  container.style.cssText = "width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;";
  const directorWidget = node.addDOMWidget("director_ui", "h3studio", container, {
    serialize: false,
    hideOnZoom: false,
    canvasOnly: true,
    hideInPanel: true,
    getMinHeight: () => 300,
  });
  const syncDirectorWidgetSize = () => {
    const width = Math.max(760, Number(node.size?.[0]) || 760);
    directorWidget.width = width;
    container.style.width = "100%";
    container.style.maxWidth = "100%";
    container.style.minWidth = "0";
    node.graph?.setDirtyCanvas?.(true, true);
  };
  node.__h3SyncDirectorWidgetSize = syncDirectorWidgetSize;
  let directorLayoutObserver = null;
  const previousRemoved = node.onRemoved;
  node.onRemoved = function () {
    if (typeof this.__h3Cleanup === "function") this.__h3Cleanup();
    if (directorLayoutObserver) directorLayoutObserver.disconnect();
    directorLayoutObserver = null;
    this.__h3Cleanup = null;
    this.__h3SyncDirectorWidgetSize = null;
    this.__h3StudioAttached = false;
    if (previousRemoved) previousRemoved.apply(this, arguments);
  };
  const previousResize = node.onResize;
  node.onResize = function () {
    if (previousResize) previousResize.apply(this, arguments);
    const width = Math.max(760, this.size[0]);
    const height = Math.max(500, this.size[1]);
    if (width !== this.size[0] || height !== this.size[1]) this.setSize([width, height]);
    syncDirectorWidgetSize();
  };
  try {
    container.appendChild(buildStudio(node));
  } catch (error) {
    node.__h3StudioAttached = false;
    const message = document.createElement("div");
    message.style.cssText = "padding:12px;color:#ffb0a8;white-space:pre-wrap;";
    message.textContent = "H3 Director 界面加载失败，请 Ctrl+F5 强制刷新；内部数据仍安全保留。\n" + error.message;
    container.appendChild(message);
    console.error("[H3 Director] studio mount failed", error);
  }
  syncDirectorWidgetSize();
  const canvasElement = app.canvas?.canvas || app.canvasEl;
  if (typeof ResizeObserver === "function" && canvasElement) {
    directorLayoutObserver = new ResizeObserver(syncDirectorWidgetSize);
    directorLayoutObserver.observe(canvasElement);
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      syncDirectorWidgetSize();
      requestAnimationFrame(syncDirectorWidgetSize);
    });
  }
}

function isH3StudioNode(node) {
  if (!node) return false;
  if (node.comfyClass === "H3DirectorStudio" || node.type === "H3DirectorStudio"
      || node.constructor?.comfyClass === "H3DirectorStudio") return true;
  const widgetNames = new Set(((node.widgets || []).map((widget) => widget && widget.name)).filter(Boolean));
  return widgetNames.has("segments_json") && widgetNames.has("vsegments_json")
    && widgetNames.has("tsegments_json") && widgetNames.has("ui_mode");
}

function attachExistingH3StudioNodes() {
  for (const node of (app.graph && app.graph._nodes) || []) {
    if (isH3StudioNode(node)) attachH3StudioNode(node);
  }
}

app.registerExtension({
  name: "H3Director.Studio",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "H3DirectorStudio") return;
    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = orig ? orig.apply(this, arguments) : undefined;
      attachH3StudioNode(this);
      return result;
    };
    const origCfg = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (data) {
      const result = origCfg ? origCfg.apply(this, arguments) : undefined;
      hideH3InternalWidgets(this);
      if (!this.__h3StudioAttached) attachH3StudioNode(this);
      if (this.__h3Reload) this.__h3Reload();
      if (this.__h3SyncDirectorWidgetSize) this.__h3SyncDirectorWidgetSize();
      return result;
    };
  },
  nodeCreated(node) {
    if (isH3StudioNode(node)) attachH3StudioNode(node);
  },
  loadedGraphNode(node) {
    if (!isH3StudioNode(node)) return;
    attachH3StudioNode(node);
    if (node.__h3Reload) node.__h3Reload();
  },
  afterConfigureGraph() {
    attachExistingH3StudioNodes();
  },
  setup() {
    attachExistingH3StudioNodes();
  },
});
