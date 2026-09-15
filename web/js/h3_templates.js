/* H3 导演台 · 文本界面模板库（v2.13.8，全部官方格式）
   来源：MiniMax 官方 10 个 SKILL 模板（h3-prompt-writing 规范 + 9 个风格技能，纸拼贴中英合并）。
   全部改用官方 integrated_multimodal_description 格式：内部用 [Shot N] At mm:ss 排子镜头时间轴，
   每条总时长 ≤15s —— 因为 H3 单次能原生生成 15s，一条官方提示词 = 一次生成整段，
   不再拆成多段分别生成（多次生成段间易断连）。解析导入时 ≤15s 自动合并为「一段=一次生成」。
   【】是占位符，换成你的内容后点「解析导入」。风格句写在 Shot 1 开头（自包含），
   音效/配乐写在 overall_soundscape / non_diegetic_music，单段时会一并并入段提示词。 */

export const H3_TEXT_TEMPLATES = [
  {
    id: "official3",
    group: "官方规范",
    name: "H3 官方时间线（Shot 绝对时间戳）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] 【整片风格定调：画风/配色/质感，写一句话、写够长】, the opening frame: 【场景、角色、动作、运镜，首镜默认 0s 起】. [Shot 2] At 00:03.000, 【画面发展：动作继续或硬切新构图，写清主体/环境/镜头运动】. [Shot 3] At 00:06.000, 【高潮或转折画面】. [Shot 4] At 00:09.000, 【收尾画面：定格/拉远/片名留白】.
overall_soundscape: 【全片环境音：氛围底噪 + 各关键音效点】.
non_diegetic_music: 【配乐方向：曲风/节奏/情绪曲线/哪里静默哪里起来】.`,
  },
  {
    id: "product-ad",
    guidedTemplateId: "minimalist_product_ad_official",
    group: "MiniMax官方技能",
    name: "极简产品广告（官方Skill · 5/10/15s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Premium minimalist product film, Apple-keynote style, clean studio background, soft diffused lighting, generous negative space, single full-frame continuous flow with no grids or split screens, product identity locked to the anchor photos. A hero product shot opens: the product from <Picture 1> floating and slowly rotating 45 degrees, a soft light sweeping across its surface material. Single-line copy "【First half】" fades in, no other on-screen text. [Shot 2] At 00:03.000, a macro push into the surface texture and edge chamfer as a light streak passes; the first half of the copy holds while the second half "【second half】" continues on the same line, the first half shifting slightly to make room. [Shot 3] At 00:06.000, the product in a use scenario interacting with a hand or environment, shallow depth of field, one core selling-point action, no text, ambience and music carry the beat. [Shot 4] At 00:09.000, a function-proof causal chain — user action leads to a concrete result with a matching geometric transition, single-line copy "【Proof line】" fades in. [Shot 5] At 00:12.000, the product holds frozen with LOGO negative space at center, the music cuts to silence leaving only a pluck decay, single-line copy "【Tagline】". Final frame: product lockup, clean frame.
overall_soundscape: quiet studio room tone, a soft pluck and airy noise floor, a subtle whoosh on each transition.
non_diegetic_music: ~100BPM tech pulse, pluck and airy noise floor, kick + sub-bass + sine sweep, wooden percussion; an instant cut to silence within 0.5s at the ending, only pluck decay remains.`,
  },
  {
    id: "anim3d",
    guidedTemplateId: "animation_3d_short_official",
    group: "MiniMax官方技能",
    name: "3D 动画短片（官方Skill · 15–180s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Stylized 3D animated short film, consistent characters and scenes across every shot, squash-and-stretch cartoon acting, cinematic lighting, warm emotionally readable color, no subtitles or text on screen. Character lock: 【角色外貌/服装/配色锚点】. Scene lock: 【固定地标 + 光位基线】. Hook establishing shot: 【scene】, the character 【开场姿态/表情】, fixed landmarks 【地标A 右侧1/3、地标B 底部居中】, camera 【运镜】. [Shot 2] At 00:03.750, the same fixed landmarks restated, the character continues into 【核心动作第一拍】, each shot's ending state handing off to the next so the action stays continuous. [Shot 3] At 00:07.500, the climax beat — 【情绪或动作最高点】, landmarks restated again, camera pushes in. [Shot 4] At 00:11.250, the resolution beat plus a small warm or cute detail to close, 【余韵画面】. Final frame: 【动作进行中的收尾画面】.
overall_soundscape: 【空间环境底噪 + 动作音效 + 可爱小细节音】.
non_diegetic_music: 【轻快温暖的配乐，随动作起伏，收尾留白】.`,
  },
  {
    id: "papercraft",
    guidedTemplateId: "papercraft_explainer_official",
    group: "MiniMax官方技能",
    name: "纸艺定格科普（官方Skill · 15/30/60s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Handmade papercraft stop-motion animation, miniature paper theater sets, multi-layer cardstock cut-outs with visible paper thickness, matte tactile paper texture with fibers and torn edges, real physical shadows between layers, 2.5D parallax, macro-photography feel, restrained paper-physics motion with no smooth CG morphing. Hook: 【核心问题或反常识现象】, a paper puppet 【角色】 does 【小动作】, a paper 【标签/箭头】 slides in, slow push-in with parallax. [Shot 2] At 00:03.750, explanation — 【原理第一层】, a layered paper mechanism 【拉片/转盘/滑轨】 unfolds to reveal 【机制】, real shadows between layers, segmented move-hold-rebound stop-motion beats. [Shot 3] At 00:07.500, example — 【具体案例或文化连接】, the puppet demonstrates 【例子动作】, background paper mechanisms animate in sync, foreground occlusion creates parallax. [Shot 4] At 00:11.250, memory line — 【一句话总结的画面化】, all paper layers settle into 【最终构图】, pieces tap into place and hold. Final frame: the complete paper sculpture composition held still.
overall_soundscape: paper rustles, taps, slides and settling thumps.
non_diegetic_music: 【极简或留白，突出纸张触感音】.`,
  },
  {
    id: "collage",
    guidedTemplateId: "paper_collage_explainer_official",
    group: "MiniMax官方技能",
    name: "纸拼贴讲解（官方Skill · 每节点约4s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Premium editorial halftone paper collage, flat bold color field, black-and-white halftone photographic cut-outs, selective colored cardstock accents, warm cream keylines, soft paper shadows, hand-torn edges, tactile stop-motion assembly only with no camera moves or morphing, no readable text or logos. Starting from a clean 【主色】 paper field, visual metaphor: 【一句话含义→画面】, the base structure paper group slides in and presses flat, then the main metaphor object pops in with a light bounce, then 2-3 secondary pieces settle one by one and lock into the final composition. [Shot 2] At 00:03.750, from a 【同系主色】 field, second metaphor: 【第二个含义→画面】, pieces assemble background-first then subject, each settling and locking. [Shot 3] At 00:07.500, third metaphor: 【第三个含义→画面】, the assembly sequence repeats with tactile pops and presses. [Shot 4] At 00:11.250, closing metaphor: 【总结含义→画面】, the final paper group assembles and locks, holding the finished composition. Final frame: completed composition held.
overall_soundscape: synchronized tactile collage SFX only — paper slide, pop-in, press-flat tap, light rustle, tiny snap; no BGM, no voiceover.
non_diegetic_music: none by default (SFX-only).`,
  },
  {
    id: "brand",
    guidedTemplateId: "brand_promo_official",
    group: "MiniMax官方技能",
    name: "品牌宣传片（官方Skill · 15/30s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Premium brand promo film for 【品牌/产品】, audience 【受众】, palette 【2-5 个有意义的色彩状态】, controlled intensity with one primary action per beat and readable silhouettes and logo safe space, no fake HUDs or decorative text walls. Brand hook: 【最强视觉钩子画面，色彩状态 1，入场转场】. [Shot 2] At 00:02.500, scene setup — 【用户意图/使用场景，真实素材感，主色状态】. [Shot 3] At 00:05.000, product mechanism — 【核心功能动作：用户动作→产品响应】, single-line copy "【单行卖点】" stays readable. [Shot 4] At 00:07.500, capability — 【第二卖点，匹配几何转场衔接】. [Shot 5] At 00:10.000, output and proof — 【成果展示，可验证画面，高能峰值】, then a quiet braking moment 【用户收益画面】. [Shot 6] At 00:12.500, LOGO plus call-to-action — LOGO centered in safe space, single-line CTA "【slogan】", closing transition. Final frame: LOGO lockup.
overall_soundscape: 【匹配节拍的环境音与 UI 音效，高能点加强，制动点留白】.
non_diegetic_music: 【品牌配乐，2-3 个高能峰值，高潮后静默一拍再收束】.`,
  },
  {
    id: "mv",
    guidedTemplateId: "music_video_subtitle_official",
    group: "MiniMax官方技能",
    name: "音乐美学MV（官方Skill · 10s起）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Stylized music video, 【曲风视觉化，如 Trap=街头霓虹夜景/Dark-pop=冷调雾蓝】, performer lock 【表演者外形/服装/发型】, typography as a dynamic graphic subject in 3D space that never covers eyes or mouth, on-screen text matching the performed lyric word by word, one main text event per shot, visuals hitting hard on the beat. Vocal Line: "【歌词 1】", typography "【贴字内容】" enters from 【前景/中景/背景】 on the 【鼓点】, performer 【动作/表情】, camera 【运镜】. [Shot 2] At 00:03.750, Vocal Line: "【歌词 2】", typography "【贴字 2】" 【空间位置+动效，逐字对齐歌词】, action responding to hi-hat and snare, transition out 【Bass-hit 硬切/同向甩镜】. [Shot 3] At 00:07.500, Vocal Line: "【歌词 3】", one main text event, 808 bass hit pressing or stretching the frame, camera 【运镜】. [Shot 4] At 00:11.250, Vocal Line: "【歌词 4】", closing typography, 【收尾动作】, camera pulling back or freezing. Final frame: 【定格画面】.
overall_soundscape: 【表演现场氛围 + 节拍强化的音效】.
non_diegetic_music: the song itself; hi-hat roll = micro-jitter, snare = scale-up/hard-cut, 808 = low-frequency screen pressure.`,
  },
  {
    id: "coop",
    guidedTemplateId: "coop_game_intro_official",
    group: "MiniMax官方技能",
    name: "双人游戏开场（主菜单 UI · 15s）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Console game main menu UI, high-quality game promo poster, UI deeply fused with characters, modern commercial game UI design, clean composition, 【主色】 dominant with 【强调色】 accents, max 5 colors, high contrast. On a solid 【色】 background two characters enter and settle in stylized poses — Character A on the left 【五官/表情/穿搭】 sitting cross-legged leaning back looking up at camera, Character B on the right 【五官/表情/穿搭】 sitting cross-legged leaning slightly forward facing camera — no UI yet, caution tape pulling across the bottom. [Shot 2] At 00:05.000, the menu UI assembles block by block: player info cards pop in at top-left (PLAYER 【名1】/【名2】 READY lighting up), the vertical menu buttons slide in on the right (Continue / Start New Game / Settings / Exit Game), icons light up in a row, the characters micro-moving with blinks and breathing. [Shot 3] At 00:10.000, the Continue button pulses oversized as the visual focus, a cursor hovers and clicks Continue, white light blooming from the button as the camera pushes into it. Final frame: Continue pressed, white light flooding the frame.
overall_soundscape: electronic UI assembly blips, a confirm chime on the Continue click.
non_diegetic_music: 【游戏菜单风格配乐，集结感到点击高潮】.`,
  },
  {
    id: "handdrawn",
    guidedTemplateId: "handdrawn_live_official",
    group: "MiniMax官方技能",
    name: "手绘实拍融合（15s 一镜到底）",
    global: "",
    script:
`integrated_multimodal_description: [Shot 1] Handheld phone footage fused with flat hand-drawn glowing animation, one continuous take in a single real space 【实拍空间】, the drawn entity like crayon or chalk strokes with a soft glow and frame-by-frame redraw feel, cute nostalgic gentle tone, no 3DCG or neon. A hand-drawn glowing little entity is born from a fingertip or object surface, making clear contact with a real hand 【缠住手指/落在掌心】. [Shot 2] At 00:03.000, it transforms for the first time, keeping traces of its previous lines, and flees, the hand grabbing at it, the camera lagging half a beat behind. [Shot 3] At 00:06.000, second and third transformations 【生物/记号/小物件】, the chase route passing through 【空间内两个点位】, the filmer reacting 【开门/接住/被恶作剧】. [Shot 4] At 00:09.000, more transformations with cute beats — a little stumble, a shy gesture, one dot falling behind. [Shot 5] At 00:12.000, a space-level transformation, lines spreading across the wall/window/ceiling into a giant 【花/星空/丝带】, an emotional afterglow plus a cute gag to close. Final frame: the space-level transformation complete, a hand reaching toward the light in frame.
overall_soundscape: 【空间底噪 + 手绘沙沙声 + 脚步声 + 轻笑】.
non_diegetic_music: 【轻快怀旧配乐，随追逐起伏，收尾温暖】.`,
  },
  {
    id: "anime-motion-graphics",
    guidedTemplateId: "anime_motion_graphics",
    group: "风格模板",
    name: "赛璐璐几何动作预告（限定色动态图形）",
    global: "",
    script: "",
  },
  {
    id: "urban-hero-chase",
    guidedTemplateId: "urban_hero_chase",
    group: "风格模板",
    name: "城市英雄动作预告（重力受力连续）",
    global: "",
    script: "",
  },
];
