// AI-MANAGE-003（2026-09-23）：AI 管理页的目录数据，**逐项取自**用户原型
// deepseek_html_20260923_83b40b (1).html 的 SCENES / POSES / CAMERA_MOVES / VENDORS /
// POSE_ICONS / CAMERA_ICONS（用 node 直接执行原型脚本导出，不是手抄）。
// 价格、厂商、模型名都是原型给的展示信息；实际扣费以各厂商官方计费为准（页面上有同样提示）。
// 这里只存「偏好 id」，出图由平台路由，客户端不直绑 provider。

// AI-MANAGE-005（2026-09-23，用户：「图片生成场景 目前的 logo 有点难看 场景有点少 这是做的场景资产样板
// 你也同步更新代替目前 6 个 增加场景 代替 logo」）：场景从原型的 6 个扩到用户样片的 12 个，
// 每个场景用样片照片做封面（media/asset-sources.ts 的 getAiScenePhoto），不再是 emoji + 渐变。
// 暖调咖啡厅 / 高级餐厅 / 文青甜品店 / 自然光 Brunch 沿用原型的文案与姿态；其余 8 个按样片新写。
export type AiScene = { id: string; name: string; desc: string; elements: ReadonlyArray<string>; prompt: string };
export const AI_SCENES: ReadonlyArray<AiScene> = [
  { id: "cafe", name: "暖调咖啡厅", desc: "暖黄灯光 · 木质桌面", elements: ["暖黄灯光", "木质桌面", "咖啡蒸汽", "浅景深", "胶片质感", "午后光线"], prompt: "专业美食摄影，一位{年龄}的{性别}坐在靠窗的木质桌边，手中握着一杯{咖啡种类}。暖黄色午后阳光透过玻璃窗斜射在桌面，形成柔和的光影对比。咖啡杯上方有淡淡的蒸汽。背景虚化的咖啡馆环境，浅景深。35mm胶片质感，温暖的色调，柯达Portra 400色彩，生活感。构图：3:4人像，半身，人物位于右侧三分线，左下方留白放置咖啡杯" },
  { id: "fine_dining", name: "高级餐厅", desc: "柔和环境光 · 精致摆盘", elements: ["柔和环境光", "精致摆盘", "浅景深", "高级质感", "暖色调", "干净背景"], prompt: "高端餐饮商业摄影，{人物}正在品尝{菜品}。柔和的暖色环境光从侧上方投射，在餐具上形成细腻的高光。精致的骨瓷餐具与摆盘，干净的背景虚化。浅景深，焦点集中在菜品与人物手部。高端杂志摄影风格，色调温暖但不失高级感。构图：3:4，菜品位于前景虚化，人物位于中景" },
  { id: "beach", name: "海边度假", desc: "碧海蓝天 · 阳光沙滩", elements: ["碧海蓝天", "白沙滩", "椰树", "强烈日光", "清透肤色", "度假感"], prompt: "海边度假人像摄影，{人物}站在白色沙滩上，身后是碧蓝的海水和远处的岛屿，椰树叶在画面上方垂下。正午日光明亮，天空通透湛蓝，皮肤清透自然。轻松愉悦的度假氛围。构图：3:4，半身，人物位于画面中央偏左，右侧留出海面" },
  { id: "garden", name: "花园漫步", desc: "繁花绿植 · 柔和自然光", elements: ["繁花", "绿植", "草帽", "柔和散射光", "清新", "浅景深"], prompt: "{人物}戴着草帽站在开满花的花园里，粉色花朵与绿叶在前景虚化。柔和的散射自然光，画面清新明亮，皮肤通透。闭眼微笑感受阳光，惬意放松。构图：3:4，半身，人物位于右侧三分线，左侧前景花朵虚化" },
  { id: "brunch", name: "自然光 Brunch", desc: "大窗户 · 明亮自然光", elements: ["明亮自然光", "大窗户", "色彩鲜艳", "健康生活", "清新", "通透"], prompt: "{人物}在洒满晨光的餐厅享用Brunch，桌上是色彩鲜艳的{食物}。大窗户自然光从侧面照射，形成明亮的通透感。健康生活方式风格，清新的色调，食物色彩鲜艳诱人。构图：3:4，俯拍或45度角，食物与人物同时入镜，窗外绿植作为背景点缀" },
  { id: "rooftop_city", name: "城市天台", desc: "城市天际线 · 黄昏霓虹", elements: ["城市天际线", "黄昏天空", "霓虹灯光", "鸡尾酒", "烛光", "冷暖对比"], prompt: "城市天台酒吧人像，{人物}坐在天台栏杆边托腮微笑，手边是一杯{饮品}和烛光。身后是紫粉色黄昏天空与亮起灯光的城市天际线。冷暖色调对比，电影感光影，浅景深。构图：3:4，人物位于画面左侧，右侧留出城市夜景" },
  { id: "dessert", name: "文青甜品店", desc: "奶油白 · 自然日光", elements: ["明亮奶油白", "自然日光", "清新色调", "ins风", "大窗户", "浅木色"], prompt: "{人物}在明亮的甜品店中，面前摆着{甜品}。奶油白与浅木色的空间，大窗户透进柔和的自然光。清新温柔的色调，明亮的日光摄影风格，Instagram风格。生活感十足。构图：3:4，甜品位于前景，人物位于中景，背景有绿植点缀" },
  { id: "night_lounge", name: "夜色露台", desc: "灯笼烛光 · 海边夜景", elements: ["暖色灯笼", "烛光", "远处灯火", "热带氛围", "鸡尾酒", "暗调"], prompt: "夜晚露台人像，{人物}坐在露台桌边托腮微笑，桌上一盏烛灯和一杯{鸡尾酒}。头顶挂着暖色灯笼，远处是海边城市的点点灯火。暗调环境，暖光映在脸上，氛围浪漫。构图：3:4，人物位于画面中央偏右，前景烛灯虚化" },
  { id: "old_street", name: "老街灯笼", desc: "古巷灯笼 · 傍晚暖光", elements: ["红灯笼", "古街巷", "三角梅", "傍晚蓝调", "暖黄灯光", "怀旧"], prompt: "古镇老街人像，{人物}走在挂满红灯笼的古巷里回头微笑，墙边开着三角梅。傍晚蓝调天空与暖黄灯笼光形成冷暖对比，怀旧氛围。构图：3:4，人物位于画面左侧，右侧留出延伸的街巷与灯笼" },
  { id: "bookstore_cafe", name: "书店咖啡", desc: "书墙暖灯 · 安静阅读", elements: ["整面书墙", "暖色台灯", "咖啡", "毛衣", "安静", "文艺"], prompt: "书店咖啡馆人像，{人物}坐在木桌前托腮微笑，手边一摞书和一杯{咖啡}。身后是整面书墙，暖色台灯光线柔和，画面安静文艺。浅景深，书墙虚化。构图：3:4，半身，人物位于画面中央，前景书本" },
  { id: "riverside_sunset", name: "江边日落", desc: "落日余晖 · 江景天际线", elements: ["落日", "金色逆光", "江面倒影", "城市剪影", "暖橙色调", "温柔"], prompt: "江边日落人像，{人物}倚在江边栏杆旁回头微笑。落日在江面上拉出金色倒影，远处是城市剪影。金色逆光勾勒发丝，暖橙色调，温柔浪漫。构图：3:4，人物位于画面左侧，右侧留出落日与江面" },
  { id: "resort_pool", name: "度假泳池", desc: "无边泳池 · 黄昏棕榈", elements: ["无边泳池", "棕榈树", "黄昏天空", "水面反光", "远山", "度假感"], prompt: "度假酒店无边泳池人像，{人物}在泳池边缘托腮微笑，身后是黄昏天空、远山与棕榈树。水面反射柔和的暮光，度假氛围慵懒放松。构图：3:4，人物位于画面中央偏左，右侧留出泳池与远景" }
];

// 原型时代存下的旧场景 id → 现在的场景（服务端 imageScene 里可能还是旧值）。
export const AI_SCENE_ALIASES: Readonly<Record<string, string>> = { restaurant: "fine_dining", izakaya: "night_lounge", night: "rooftop_city" };

export type AiPose = { id: string; name: string; hint: string };
export const AI_POSES: Readonly<Record<string, ReadonlyArray<AiPose>>> = {
  "cafe": [
    { id: "hand_face", name: "手托脸", hint: "头微低，手轻托脸颊" },
    { id: "look_away", name: "侧脸望远处", hint: "身体侧转，眼神看窗外" },
    { id: "coffee_hold", name: "手托咖啡", hint: "低角度拍，手举咖啡杯" },
    { id: "lean_forward", name: "前倾靠桌", hint: "身体微前倾，肘部撑桌" },
    { id: "cross_arm", name: "X交叉", hint: "脚尖10点钟，眼神2点钟" },
    { id: "laugh", name: "低头笑", hint: "自然笑，不看镜头" }
  ],
  "fine_dining": [
    { id: "cheers", name: "举杯", hint: "举杯看向镜头或侧方" },
    { id: "taste", name: "品尝", hint: "叉子送嘴边，眼神看食物" },
    { id: "lean_back", name: "靠椅背", hint: "放松靠椅，侧脸微仰" },
    { id: "table_hand", name: "手搭桌沿", hint: "双手交叠放桌边" },
    { id: "look_menu", name: "看菜单", hint: "低头看菜单，抓拍" },
    { id: "napkin", name: "整理餐巾", hint: "手部动作特写" }
  ],
  "beach": [
    { id: "sun_face", name: "挥手遮阳", hint: "单手举到额前，眨眼笑" },
    { id: "walk_in", name: "沙滩漫步", hint: "沿海岸线走，抓拍动态" },
    { id: "look_away", name: "眺望海面", hint: "侧身看向远处海平线" },
    { id: "laugh", name: "迎风大笑", hint: "头发被风吹起，自然笑" },
    { id: "back_view", name: "回眸", hint: "背对大海回头看镜头" },
    { id: "selfie", name: "举手机自拍", hint: "对着海景自拍" }
  ],
  "garden": [
    { id: "sun_face", name: "迎光闭眼", hint: "仰头闭眼感受阳光" },
    { id: "hand_face", name: "手扶帽檐", hint: "单手扶草帽，微笑" },
    { id: "look_away", name: "侧脸赏花", hint: "侧身看向花丛" },
    { id: "walk_street", name: "花间漫步", hint: "沿花径行走抓拍" },
    { id: "back_view", name: "回眸", hint: "背对花丛回头" },
    { id: "laugh", name: "低头笑", hint: "自然笑，不看镜头" }
  ],
  "brunch": [
    { id: "fork_food", name: "叉食物", hint: "叉子叉食物举镜头前" },
    { id: "pour", name: "倒饮品", hint: "手倒饮品，抓拍动作" },
    { id: "sun_face", name: "迎光闭眼", hint: "面向窗户，闭眼微笑" },
    { id: "cross_leg", name: "翘腿侧坐", hint: "翘腿侧坐，自然放松" },
    { id: "hands_up", name: "双手举食物", hint: "双手举起食物展示" },
    { id: "walk_in", name: "走进画面", hint: "从画面外走入，抓拍" }
  ],
  "rooftop_city": [
    { id: "hand_face", name: "托腮微笑", hint: "手托脸，看向镜头" },
    { id: "raise_cup", name: "举杯", hint: "举杯对着镜头" },
    { id: "look_away", name: "眺望城市", hint: "侧身看向天际线" },
    { id: "neon_side", name: "霓虹侧脸", hint: "城市灯光打侧脸" },
    { id: "back_view", name: "回头", hint: "背对城市回头" },
    { id: "cross_leg", name: "翘腿侧坐", hint: "放松侧坐栏杆边" }
  ],
  "dessert": [
    { id: "bite", name: "咬甜品", hint: "叉子叉甜品送嘴边" },
    { id: "hold_plate", name: "端盘展示", hint: "双手端盘，正视镜头" },
    { id: "point", name: "手指甜品", hint: "指向甜品，表情惊喜" },
    { id: "window", name: "窗边侧坐", hint: "侧坐窗边，光线打脸" },
    { id: "straw", name: "咬吸管", hint: "自然咬吸管看镜头" },
    { id: "selfie", name: "举手机自拍", hint: "举手机拍镜子或甜品" }
  ],
  "night_lounge": [
    { id: "hand_face", name: "托腮", hint: "手托脸，眼神看镜头" },
    { id: "side_face", name: "侧脸对灯笼", hint: "灯笼光映侧脸" },
    { id: "raise_cup", name: "举杯", hint: "举杯对着镜头" },
    { id: "straw", name: "咬吸管", hint: "自然咬吸管看镜头" },
    { id: "look_down", name: "低头看杯", hint: "低头看酒杯，抓拍" },
    { id: "laugh_close", name: "大笑特写", hint: "大笑侧脸特写" }
  ],
  "old_street": [
    { id: "back_view", name: "回眸", hint: "边走边回头微笑" },
    { id: "walk_street", name: "街巷漫步", hint: "沿老街行走抓拍" },
    { id: "look_up", name: "抬头看灯笼", hint: "仰头看头顶灯笼" },
    { id: "side_face", name: "灯笼侧脸", hint: "灯笼光映侧脸" },
    { id: "point", name: "指向灯笼", hint: "指向街边灯笼，表情惊喜" },
    { id: "sit_step", name: "坐台阶", hint: "坐在门前台阶上" }
  ],
  "bookstore_cafe": [
    { id: "hand_face", name: "手托脸", hint: "头微侧，手轻托脸颊" },
    { id: "look_menu", name: "低头看书", hint: "低头翻书，抓拍" },
    { id: "coffee_hold", name: "手托咖啡", hint: "双手捧咖啡杯" },
    { id: "laugh", name: "低头笑", hint: "自然笑，不看镜头" },
    { id: "window", name: "窗边侧坐", hint: "侧坐窗边，光线打脸" },
    { id: "lean_forward", name: "前倾靠桌", hint: "身体微前倾，肘部撑桌" }
  ],
  "riverside_sunset": [
    { id: "back_view", name: "回眸", hint: "背对落日回头" },
    { id: "sun_face", name: "迎光", hint: "面向夕阳，闭眼微笑" },
    { id: "look_away", name: "望向江面", hint: "侧身看向江面" },
    { id: "elbow_bar", name: "倚栏杆", hint: "手肘搭栏杆侧身" },
    { id: "hand_face", name: "手托脸", hint: "手托脸，看向镜头" },
    { id: "walk_street", name: "江边漫步", hint: "沿江边行走抓拍" }
  ],
  "resort_pool": [
    { id: "hand_face", name: "托腮", hint: "趴在池边托腮" },
    { id: "lean_forward", name: "趴池边", hint: "双臂搭池边，身体前倾" },
    { id: "look_away", name: "眺望远方", hint: "侧身看向远山" },
    { id: "laugh", name: "低头笑", hint: "自然笑，不看镜头" },
    { id: "back_view", name: "回眸", hint: "背对镜头回头" },
    { id: "sun_face", name: "迎光闭眼", hint: "面向暮光，闭眼微笑" }
  ]
};

export type AiCameraMove = { id: string; name: string; desc: string };
export const AI_CAMERA_MOVES: ReadonlyArray<AiCameraMove> = [
  { id: "static", name: "静态抓拍", desc: "固定机位，自然状态" },
  { id: "push", name: "慢推近", desc: "镜头缓缓推近，聚焦细节" },
  { id: "pull", name: "慢拉远", desc: "镜头缓缓拉远，交代环境" },
  { id: "pan", name: "横摇", desc: "左右平移，扫过场景" },
  { id: "track", name: "跟随运镜", desc: "跟随人物移动" },
  { id: "crane", name: "升降镜头", desc: "上下移动，展现空间" }
];

export type AiVendorModel = { name: string; price: string; tag?: string; subscription?: boolean };
export type AiVendor = { id: string; name: string; desc: string; logoXml: string; logoBg: string; recommend?: boolean; pinned?: boolean; quality: number; priceScore: number; popular: number; models: ReadonlyArray<AiVendorModel> };
export const AI_VENDORS: ReadonlyArray<AiVendor> = [
  { id: "platform_default", name: "平台默认", desc: "系统自动选择最优厂商", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"#fff\"><path d=\"M12 2l2.4 7.2H22l-6 4.8 2.4 7.2L12 16.8 5.6 21.2 8 14 2 9.2h7.6z\"/></svg>", logoBg: "#1a1a1a", recommend: true, pinned: true, quality: 0, priceScore: 0, popular: 0, models: [] },
  { id: "google", name: "Google", desc: "细节丰富 · 文字渲染强", logoXml: "<svg viewBox=\"0 0 24 24\"><defs><linearGradient id=\"geminiGrad\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"100%\"><stop offset=\"0%\" stop-color=\"#4285f4\"/><stop offset=\"50%\" stop-color=\"#9b72cb\"/><stop offset=\"100%\" stop-color=\"#d96570\"/></linearGradient></defs><path fill=\"url(#geminiGrad)\" d=\"M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z\"/></svg>", logoBg: "#ffffff", quality: 9.6, priceScore: 0.02, popular: 9.2, models: [{ name: "Imagen 4", price: "$0.02-0.06/张", tag: "NEW" }, { name: "Imagen 4 Fast", price: "$0.02/张" }, { name: "Imagen 3", price: "$0.03-0.12/张" }] },
  { id: "openai", name: "OpenAI", desc: "通用性强 · 指令跟随好", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"#fff\"><path d=\"M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-5.87 3.39a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97v6.14a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 14.48A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86-5.84-3.39 2.02-1.17a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.67zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.77 2.77a.79.79 0 0 0-.39.68zm1.1-2.36 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5z\"/></svg>", logoBg: "#10a37f", quality: 9.3, priceScore: 0.011, popular: 10, models: [{ name: "GPT-Image-1", price: "$0.04-0.17/张", tag: "NEW" }, { name: "GPT-Image-1.5", price: "$0.011-0.25/张" }, { name: "DALL·E 3", price: "$0.04-0.12/张" }] },
  { id: "midjourney", name: "Midjourney", desc: "艺术感强 · 氛围大片", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 20c1.5 0 2.5-1.6 4-1.6s2.5 1.6 4 1.6 2.5-1.6 4-1.6 2.5 1.6 4 1.6 2.5-1.6 4-1.6\"/><path d=\"M4.5 17.5 L9 4.5 L13.5 17.5\"/><path d=\"M11 17.5 L15.5 8 L20.5 17.5\"/></svg>", logoBg: "#000000", quality: 9.4, priceScore: 0.1, popular: 9.5, models: [{ name: "MJ v7", price: "$10-120/月", tag: "NEW", subscription: true }, { name: "MJ v6.1", price: "$10-120/月", subscription: true }, { name: "Niji 6", price: "$10-120/月", subscription: true }] },
  { id: "bfl", name: "Black Forest Labs", desc: "速度快 · 真实感好", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z\"/><path d=\"M3 7 L12 12 L21 7\"/><path d=\"M12 12 L12 22\"/></svg>", logoBg: "#ff6b35", quality: 9.2, priceScore: 0.00258, popular: 8.5, models: [{ name: "FLUX.2 Pro", price: "$0.03-0.045/张" }, { name: "FLUX.2 Max", price: "$0.07/张起" }, { name: "FLUX.1 Schnell", price: "$0.00258/张" }] },
  { id: "anthropic", name: "Anthropic", desc: "提示词优化辅助", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"#fff\"><path d=\"M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z\"/></svg>", logoBg: "#d4a574", quality: 8, priceScore: 0.08, popular: 7, models: [{ name: "Claude 4 Opus", price: "按量计费" }, { name: "Claude 4 Sonnet", price: "按量计费" }, { name: "Claude 3.5 Sonnet", price: "按量计费" }] },
  { id: "sensenova", name: "商汤 SenseNova", desc: "亚洲人像更自然", logoXml: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M15.5 9c-.6-1-1.9-1.7-3.5-1.7-2.2 0-4 1.1-4 2.5s1.8 2 4 2.5 4 1.1 4 2.5-1.8 2.5-4 2.5c-1.6 0-2.9-.7-3.5-1.7\"/></svg>", logoBg: "#e91e63", quality: 8.5, priceScore: 0.05, popular: 7.5, models: [{ name: "SenseNova 5.5", price: "按量计费", tag: "NEW" }, { name: "日日新 5.0", price: "按量计费" }, { name: "SenseMirage", price: "按量计费" }] }
];

// 姿态 / 运镜线稿图标（stroke="currentColor"，用 SvgXml 的 color 着色）。
export const AI_POSE_ICONS: Readonly<Record<string, string>> = {
  "hand_face": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3\"/><path d=\"M8 14c0-1.5 1-3 2.5-3.5\"/><path d=\"M16 21v-4c0-2-1.5-3.5-4-3.5\"/><path d=\"M10 19l-2 2\"/><path d=\"M14 19l2 2\"/><circle cx=\"14\" cy=\"7\" r=\"0.5\" fill=\"currentColor\"/><circle cx=\"10\" cy=\"7\" r=\"0.5\" fill=\"currentColor\"/></svg>",
  "look_away": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M5 21v-2c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 8h6\"/><path d=\"M17 5l3 3-3 3\"/><circle cx=\"14\" cy=\"8\" r=\"0.5\" fill=\"currentColor\"/></svg>",
  "coffee_hold": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><rect x=\"13\" y=\"10\" width=\"6\" height=\"7\" rx=\"1.5\"/><path d=\"M19 12h1.5a1.5 1.5 0 0 1 0 3H19\"/><path d=\"M15 8V6\"/><path d=\"M17 8V6\"/></svg>",
  "lean_forward": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M7 21l2-7\"/><path d=\"M13 21l-2-7\"/><path d=\"M9 14h5\"/><path d=\"M14 14l3-2\"/><path d=\"M9 12c-1-2-2-3-4-3\"/></svg>",
  "cross_arm": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 21v-5\"/><path d=\"M16 21v-5\"/><path d=\"M8 16l4-3 4 3\"/><path d=\"M12 13v-3\"/></svg>",
  "laugh": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"9\" r=\"3.5\"/><path d=\"M8 19c0-2 1.5-4 4-4s4 2 4 4\"/><path d=\"M10 9c0 1.5 1 2.5 2 2.5s2-1 2-2.5\"/><path d=\"M9.5 7.5h.01\"/><path d=\"M14.5 7.5h.01\"/><path d=\"M10 12c.5 1 1.5 1.5 2 1.5s1.5-.5 2-1.5\"/></svg>",
  "cheers": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 8l4-2\"/><path d=\"M14 14l4 2\"/><path d=\"M18 6v4\"/><path d=\"M20 8h-4\"/></svg>",
  "taste": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 12l4-3\"/><path d=\"M18 9l2-1\"/><circle cx=\"20\" cy=\"8\" r=\"1.5\"/></svg>",
  "lean_back": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 21l2-6\"/><path d=\"M14 21l-2-6\"/><path d=\"M8 15h4\"/><path d=\"M12 15l4-3\"/><path d=\"M16 12l2 2\"/></svg>",
  "table_hand": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 17h6\"/><path d=\"M14 17c0-1 1-2 2-2h2c1 0 2 1 2 2\"/></svg>",
  "look_menu": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><rect x=\"14\" y=\"9\" width=\"6\" height=\"9\" rx=\"1\"/><path d=\"M16 12h2\"/><path d=\"M16 14h2\"/></svg>",
  "napkin": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 16l4 3\"/><path d=\"M18 16l-4 3\"/><path d=\"M16 19v2\"/></svg>",
  "bite": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 12l5-4\"/><circle cx=\"19\" cy=\"7\" r=\"2\"/></svg>",
  "hold_plate": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 20v-3c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5v3\"/><circle cx=\"12\" cy=\"16\" r=\"4\"/><path d=\"M8 16h8\"/></svg>",
  "point": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 12l5 2\"/><path d=\"M19 14l1 1\"/><circle cx=\"20\" cy=\"15\" r=\"1\"/></svg>",
  "window": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><rect x=\"14\" y=\"5\" width=\"6\" height=\"10\" rx=\"1\"/><path d=\"M17 5v10\"/><path d=\"M14 10h6\"/></svg>",
  "straw": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 10l3 8\"/><rect x=\"14\" y=\"16\" width=\"6\" height=\"4\" rx=\"1\"/></svg>",
  "selfie": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><rect x=\"14\" y=\"8\" width=\"5\" height=\"8\" rx=\"1.5\"/><circle cx=\"16.5\" cy=\"12\" r=\"1.5\"/></svg>",
  "side_face": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M5 21v-2c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 6c0 2 1 4 3 4s3-2 3-4\"/><path d=\"M17 10v4\"/><circle cx=\"14\" cy=\"8\" r=\"0.5\" fill=\"currentColor\"/></svg>",
  "raise_cup": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M13 10l3-5\"/><rect x=\"15\" y=\"3\" width=\"4\" height=\"5\" rx=\"1\"/><path d=\"M15 5h4\"/></svg>",
  "elbow_bar": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 21l2-7\"/><path d=\"M14 21l-2-7\"/><path d=\"M8 14h6\"/><path d=\"M14 14l4-2\"/><path d=\"M16 12l2 2\"/></svg>",
  "look_down": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 12l3 5\"/><rect x=\"14\" y=\"17\" width=\"5\" height=\"4\" rx=\"1\"/><path d=\"M16.5 19h.01\"/></svg>",
  "back_view": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 20v-3c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5v3\"/><path d=\"M5 9l3-3\"/><path d=\"M5 9h4\"/></svg>",
  "laugh_close": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"9\" r=\"4\"/><path d=\"M8 20c0-2 1.5-4 4-4s4 2 4 4\"/><path d=\"M10 9c0 1.5 1 3 2 3s2-1.5 2-3\"/><path d=\"M10.5 7.5h.01\"/><path d=\"M13.5 7.5h.01\"/></svg>",
  "fork_food": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 12l4-3\"/><path d=\"M18 9v4\"/><path d=\"M16 9h4\"/></svg>",
  "pour": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 10l4 4\"/><path d=\"M18 14l2 2\"/><path d=\"M14 16l4-4\"/></svg>",
  "sun_face": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><circle cx=\"17\" cy=\"8\" r=\"3\"/><path d=\"M17 3v2\"/><path d=\"M17 11v2\"/><path d=\"M14 8h-2\"/><path d=\"M22 8h-2\"/><path d=\"M15 6l-1-1\"/><path d=\"M19 10l1 1\"/><path d=\"M15 10l-1 1\"/><path d=\"M19 6l1-1\"/></svg>",
  "cross_leg": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 21l3-6\"/><path d=\"M14 21l-3-6\"/><path d=\"M8 15h5\"/><path d=\"M13 15l4-3\"/><path d=\"M14 12h4\"/></svg>",
  "hands_up": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 20v-3c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5v3\"/><path d=\"M5 8l4 4\"/><path d=\"M19 8l-4 4\"/><circle cx=\"5\" cy=\"6\" r=\"1.5\"/><circle cx=\"19\" cy=\"6\" r=\"1.5\"/></svg>",
  "walk_in": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 21l2-6\"/><path d=\"M16 21l-2-6\"/><path d=\"M10 15h4\"/><path d=\"M8 12l4-3 4 3\"/><path d=\"M4 18l3-2\"/><path d=\"M20 18l-3-2\"/></svg>",
  "neon_side": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M5 21v-2c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 5h6\"/><path d=\"M14 8h4\"/><path d=\"M14 11h5\"/><circle cx=\"14\" cy=\"8\" r=\"0.5\" fill=\"currentColor\"/></svg>",
  "look_up": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"8\" r=\"3\"/><path d=\"M6 21v-2c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 5l3 3\"/><path d=\"M14 8l2 1\"/><path d=\"M17 3v3\"/><path d=\"M20 3h-3\"/></svg>",
  "walk_street": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 21l2-6\"/><path d=\"M16 21l-2-6\"/><path d=\"M10 15h4\"/><path d=\"M8 12l4-3 4 3\"/><path d=\"M4 20h16\"/></svg>",
  "back_neon": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"7\" r=\"2.5\"/><path d=\"M8 20v-3c0-2 1.5-3.5 4-3.5s4 1.5 4 3.5v3\"/><path d=\"M5 8l3 3\"/><path d=\"M5 11h3\"/><path d=\"M19 8l-3 3\"/><path d=\"M19 11h-3\"/></svg>",
  "sit_step": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"6\" r=\"2.5\"/><path d=\"M6 21l2-7\"/><path d=\"M14 21l-2-7\"/><path d=\"M8 14h5\"/><path d=\"M13 14l3 3\"/><path d=\"M16 17l2-2\"/></svg>",
  "umbrella": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"10\" cy=\"7\" r=\"2.5\"/><path d=\"M6 20v-3c0-2 1.5-3.5 4-3.5\"/><path d=\"M14 8l2-6\"/><path d=\"M12 3h8\"/><path d=\"M16 3v3\"/></svg>"
};

export const AI_CAMERA_ICONS: Readonly<Record<string, string>> = {
  "static": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M9 3h6\"/><path d=\"M9 3l-2 3\"/><path d=\"M15 3l2 3\"/></svg>",
  "push": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"3\"/><path d=\"M18 12h4\"/><path d=\"M20 9l3 3-3 3\"/><path d=\"M4 3v2\"/><path d=\"M4 3h2\"/></svg>",
  "pull": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"8\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\"/><circle cx=\"14\" cy=\"12\" r=\"3\"/><path d=\"M6 12H2\"/><path d=\"M4 9l-3 3 3 3\"/><path d=\"M20 3v2\"/><path d=\"M20 3h-2\"/></svg>",
  "pan": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"5\" y=\"7\" width=\"14\" height=\"10\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M2 12h3\"/><path d=\"M19 12h3\"/><path d=\"M2 9l-1 3 1 3\"/><path d=\"M22 9l1 3-1 3\"/></svg>",
  "track": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"6\" y=\"7\" width=\"12\" height=\"10\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M3 12h2\"/><path d=\"M19 12h2\"/><path d=\"M2 10l1 2-1 2\"/><path d=\"M22 10l-1 2 1 2\"/></svg>",
  "crane": "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"6\" y=\"6\" width=\"12\" height=\"10\" rx=\"2\"/><circle cx=\"12\" cy=\"11\" r=\"3\"/><path d=\"M12 16v4\"/><path d=\"M9 20h6\"/><path d=\"M4 2l2 2\"/><path d=\"M4 2v2\"/><path d=\"M20 2l-2 2\"/><path d=\"M20 2v2\"/></svg>"
};

// AI-MANAGE-004（2026-09-23，用户：「把这 3 个 logo 换一下 目前的 ai 管理 图片管理 logo 有点难看」）：
// 管理卡图标用用户给的 proxy_management_icons_svg（conversation / image / dynamic-management.svg），
// 原样内嵌（自带圆角底色），不再是 emoji + 渐变底。
export const AI_MANAGE_ICONS: Readonly<Record<"chat" | "image" | "post", string>> = {
  chat: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#E9EEFF\"/>\n  <path d=\"M18 30c0-8 6.5-14 14.5-14S47 22 47 30s-6.5 14-14.5 14c-2.2 0-4.3-.5-6.1-1.4L19 46l2-7.4A13.8 13.8 0 0 1 18 30Z\"\n        fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n  <circle cx=\"27\" cy=\"30\" r=\"2\" fill=\"#111827\"/>\n  <circle cx=\"32.5\" cy=\"30\" r=\"2\" fill=\"#111827\"/>\n  <circle cx=\"38\" cy=\"30\" r=\"2\" fill=\"#111827\"/>\n</svg>",
  image: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#E6F7EF\"/>\n  <rect x=\"16\" y=\"18\" width=\"32\" height=\"28\" rx=\"5\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\"/>\n  <circle cx=\"39\" cy=\"26\" r=\"3\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3\"/>\n  <path d=\"M20 41l9-9 6 6 4-4 7 7\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>\n</svg>",
  post: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#FFF4E3\"/>\n  <path d=\"M20 18h18a4 4 0 0 1 4 4v13\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linecap=\"round\"/>\n  <path d=\"M20 18a4 4 0 0 0-4 4v20a4 4 0 0 0 4 4h17\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linecap=\"round\"/>\n  <path d=\"M23 27h12M23 33h9\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linecap=\"round\"/>\n  <path d=\"M39 43l7.5-7.5 4 4L43 47l-6 1.5 2-5.5Z\" fill=\"none\" stroke=\"#111827\" stroke-width=\"3.2\" stroke-linejoin=\"round\"/>\n</svg>"
};
