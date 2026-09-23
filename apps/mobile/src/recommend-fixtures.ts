// R15.34: 推荐人 mock 数据 (本地 hard-coded 列表) —
// 没有 server 端点，先用 fixture。生产环境接 /v1/agents/feed
// 或类似端点时，删这个文件 + 换 data hook。
//
// HOME-RAIL-ACCOUNT-001：这里是「展示侧」的 fixture，但**每一个人都对应一个真实
// 存在的服务端账号**（账号 id 由 u_<key> 解析，写真走账号的媒体资产）。造 mock
// 人物可以，造没有账号的人不行 —— 后者在列表里顶着「真人」徽标却加不了好友。
// 服务端事实源：apps/api-go/internal/mockidentity 的 HomeRailPeople。
// 加人/删人必须两边一起改，否则 Go 侧的 TestHomeRailFixturePeopleAllHaveServerAccounts 会红。
//
// 结构：
//   - RecommendTag: 单个推荐人的"标签"（语言 / 共同好友 / 状态）
//   - RecommendPerson: 一个推荐人 (id / name / initials / 距离 / 标签)
//   - SCENE_RECOMMEND: 每个 SceneToolId 对应一份推荐人列表 + 标题/副标
//   - SCENE_FILTER_CHIPS: 每个 SceneToolId 对应的可选筛选 chip
//
// 命名：越南 + 中文混合，跟 Proxy 实际 demo 用户的语言分布一致。
// 距离单位 m，随机 200m - 2km 区间（跟 5km 默认 radius 匹配）。

export interface RecommendTag {
  text: string;
  // "lang" = 语言（橙色），"social" = 共同好友（蓝），"status" = 状态（绿/灰）
  kind: "lang" | "social" | "status";
}

export interface RecommendPerson {
  id: string;
  name: string;
  initials: string;
  /** 账号写真资产的服务端 thumb 地址（HOME-RAIL-ACCOUNT-001：rail 上每个人都有账号）。 */
  photoUri?: string;
  // 距离，单位米。PERSON-DISTANCE-ZERO-001：服务端真人**没有坐标**，
  // 以前一律填 0 —— 0 会在详情页渲染成「0 m」（等于断言对方就在你脚下），
  // 还会让每个人无条件通过「附近 <1000m」筛选。没有坐标就必须是 undefined，
  // 让展示侧说「距离未知」、筛选侧把它排除在「附近」之外。
  distanceM?: number;
  // 一句话描述
  bio: string;
  // 卡片右下 tag
  tags: RecommendTag[];
  // 是否在线
  online: boolean;
  // 共同好友数（0 不显示）
  mutualFriends: number;
  /** Recommendation read-model fields; move to the server person feed with the rest of this preview fixture. */
  rating?: number;
  completedActivities?: number;
  availabilityText?: string;
  positiveRate?: number;
  reviewSummary?: string;
  languages?: string[];
  capabilities?: string[];
  themes?: string[];
  sceneNames?: string[];
  publicActivityHistory?: Array<{ id: string; title: string; scene: string; dateLabel: string; rating: number }>;
}

import { localApiBaseUrl } from "./native-clients";

// IDENTITY-ID-001: 头像必须来自「该人的账号资产」，不能再按列表下标轮转原型图。
// 此前 5 张 unsplash 原型肖像按 index+offset 分配，与身份无关，于是同一个人
// （如 Linh）在首页与发布订单会显示成两张不同的图。
//
// HOME-RAIL-ACCOUNT-001（2026-09-23，用户报 P0）：这张表原来只有 7 个人，其余
// 21 个人「没有账号」—— 点 + 只会得到「还没有账号，暂时加不了好友」，而卡片上
// 顶着「真人」徽标。现在 rail 上 28 个人**全部**在服务端有账号（服务端事实源：
// apps/api-go/internal/mockidentity 的 HomeRailPeople，由 seedPostgresHomeRail
// 建号 + 建写真资产）。所以这张表就是全部 28 个键，没有例外。
//
// 进了这张表就等于宣称：服务端有账号、有写真资产，且 seedPostgresHomeRail
// 里同时存在。HOME-RAIL-ACCOUNT-001 双向钉住这条（Go 侧读本文件逐条比对）。
const ACCOUNT_AVATAR_ASSET: Record<string, string> = {
  // PHOTO
  u_linh: "ma_creator_linh_portrait_v1",
  u_minh: "ma_creator_minh_portrait_v1",
  // hana / nam（2026-09-19）：F组单人正脸转正，u_ fixture 进体系。
  u_hana: "ma_creator_hana_portrait_v1",
  u_nam: "ma_creator_nam_portrait_v1",
  u_vy: "ma_creator_vy_portrait_v1",
  u_quynh_anh: "ma_creator_quynh_anh_portrait_v1",
  u_duy_khang: "ma_creator_duy_khang_portrait_v1",
  // COMPANION
  u_thao_nhi: "ma_creator_thao_nhi_portrait_v1",
  u_huy: "ma_creator_huy_portrait_v1",
  u_mai: "ma_creator_mai_portrait_v1",
  u_an: "ma_creator_an_portrait_v1",
  u_khoa: "ma_creator_khoa_portrait_v1",
  // COFFEE_MEAL
  u_trang: "ma_creator_trang_portrait_v1",
  u_tu: "ma_creator_tu_portrait_v1",
  u_nhi: "ma_creator_nhi_portrait_v1",
  // ACTIVITY
  u_long: "ma_creator_long_portrait_v1",
  u_phuong: "ma_creator_phuong_portrait_v1",
  u_kien: "ma_creator_kien_portrait_v1",
  // TRIP
  u_my: "ma_creator_my_portrait_v1",
  u_duc: "ma_creator_duc_portrait_v1",
  u_ly: "ma_creator_ly_portrait_v1",
  // CREATOR
  u_phuong_thanh: "ma_creator_phuong_thanh_portrait_v1",
  u_hong_anh: "ma_creator_hong_anh_portrait_v1",
  u_son: "ma_creator_son_portrait_v1",
  // TRANSLATE
  u_thu_trang: "ma_creator_thu_trang_portrait_v1",
  u_hai: "ma_creator_hai_portrait_v1",
  u_ngoc: "ma_creator_ngoc_portrait_v1",
  // MEDICAL
  u_lan: "ma_creator_lan_portrait_v1",
};

// fixture id（u_linh）→ 服务端真账号（user_mockcreator_linh）。
// 首页推荐是本地 fixture，id 是 u_ 前缀；服务端 mock 人物的账号是
// user_mockcreator_ 前缀（见 mockidentity.AccountIDForFacetKey）。拿 fixture id
// 直接建会话/开主页/查资料会落到一个不存在的幽灵 id 上 —— 头像 404 空白、
// 关注落到空账号、动态 backfill 扫不到帖子。
export function resolveHomePersonAccountId(id: string): string {
  if (!id.startsWith("u_")) return id;
  const key = id.slice("u_".length);
  if (!key || ACCOUNT_AVATAR_ASSET[id] === undefined) return id;
  return `user_mockcreator_${key}`;
}

// 头像一律取账号的写真资产（服务端 /v1/media/thumb/<assetId>）。
//
// 这里曾经有一段 stock 占位放宽（2026-09-18 批准，2026-09-23 随本改动废止；
// 钉子在 requester-home-discovery-contract.test.ts 与 scripts/check-regression-contracts.sh）：
// 没有账号的人按 id 哈希落 5 张 unsplash「原型肖像」，理由是「mock 期不许出现
// 灰色空头像」。那段已删除，理由：
//   ① 前提是假的。那 5 张里只有 1 张是人脸，另外 4 张分别是下龙湾风景、
//      咖啡店室内、城市天际线、一盘炒河粉 —— 它们正被当成「真人」的头像渲染
//      （用户截图里 Vy 那个圈就是下龙湾的船）。
//   ② 放宽的适用条件消失了。它存在是因为「有人没账号」；现在 rail 上 28 个人
//      全部有账号有写真，回到「有账号才有头像」不再产生灰头像。
//   ③ 外链头像本身是 IDENTITY-ID-001 要杀的东西：外部依赖 + 同一个人在不同
//      页面可能拿到不同的图。
// 所以：photoUri 只有一个来源 —— 账号的写真资产。拿不到图时卡片回落首字母
// （HOME-AVATAR-FALLBACK-001 的 onError 分支），不再拿风景照冒充人脸。
function withAccountPortraits(people: RecommendPerson[]): RecommendPerson[] {
  return people.map((person) => ({
    ...person,
    photoUri: `${localApiBaseUrl}/v1/media/thumb/${ACCOUNT_AVATAR_ASSET[person.id]}`,
    // RECOMMEND-REPUTATION-FABRICATED-001: 评价类字段一律不再由下标算出来。
    //
    // 这里曾经用 `(index + offset) % n` 给每个人生成星级、好评百分比、
    // 完成次数、一句"用户评价"和一份带日期的历史活动记录，然后在详情页
    // 「历史信誉与评价」卡片里显示成一行信誉数字和一段引号里的话 ——
    // 全是凭空的，却挂在真人姓名下，还附了「非公开记录不展示」的隐私说明。
    //
    // 字段保留在 RecommendPerson 上（可选），等服务端人物 feed 落地后由真
    // 数据填。没有真数据时不填，UI 各自回落到「暂无公开记录」这类如实文案。
    languages: person.tags.some((tag) => tag.text === "会中文") || person.id === "u_linh" ? ["Tiếng Việt", "中文"] : ["Tiếng Việt", "English"],
    capabilities: person.id === "u_linh" ? ["胶片街拍", "City Walk", "奥黛写真"] : [person.bio.split("/")[0]?.trim() || "城市同行", "本地陪伴"],
    themes: person.id === "u_linh" ? ["胶片", "老城区", "日落"] : ["日常", "本地生活"],
    sceneNames: person.id === "u_linh" ? ["河内老城区", "还剑湖", "西湖日落"] : [],
  }));
}

export interface RecommendFeed {
  title: string;
  subtitle: string;
  boundSceneId: string;
  // 卡片右上 tag（场景特化，比如"摄影爱好者" / "会中文"）
  sceneTag: string;
  people: RecommendPerson[];
}

const PHOTO_PEOPLE: RecommendPerson[] = [
  {
    id: "u_linh",
    name: "Linh",
    initials: "LN",
    distanceM: 240,
    bio: "胶片 / 街拍 / 河内老城",
    tags: [{ text: "摄影爱好者", kind: "status" }],
    online: true,
    mutualFriends: 3
  },
  {
    id: "u_minh",
    name: "Minh",
    initials: "MN",
    distanceM: 380,
    bio: "Sony A7C / 慢门人像",
    tags: [{ text: "摄影爱好者", kind: "status" }, { text: "附近", kind: "social" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_hana",
    name: "Hana",
    initials: "HA",
    distanceM: 520,
    bio: "日系清新 / 自然光",
    tags: [{ text: "摄影爱好者", kind: "status" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 1
  },
  {
    id: "u_nam",
    name: "Nam",
    initials: "NM",
    distanceM: 680,
    bio: "Sony / 夜景 / 城市爬楼",
    tags: [{ text: "摄影爱好者", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: false,
    mutualFriends: 2
  },
  {
    id: "u_vy",
    name: "Vy",
    initials: "VY",
    distanceM: 1100,
    bio: "胶片冲洗 / 暗房",
    tags: [{ text: "摄影爱好者", kind: "status" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_quynh_anh",
    name: "Quỳnh Anh",
    initials: "QA",
    distanceM: 1300,
    bio: "Canon R6 / 婚礼跟拍",
    tags: [{ text: "摄影爱好者", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 4
  },
  {
    id: "u_duy_khang",
    name: "Duy Khang",
    initials: "DK",
    distanceM: 1600,
    bio: "Fuji X100V / 旅行",
    tags: [{ text: "摄影爱好者", kind: "status" }, { text: "最近活跃", kind: "social" }],
    online: false,
    mutualFriends: 1
  }
];

const COMPANION_PEOPLE: RecommendPerson[] = [
  {
    id: "u_thao_nhi",
    name: "Thảo Nhi",
    initials: "TN",
    distanceM: 320,
    bio: "西湖 / 还剑湖 散步搭子",
    tags: [{ text: "同行中", kind: "status" }],
    online: true,
    mutualFriends: 2
  },
  {
    id: "u_huy",
    name: "Huy",
    initials: "HY",
    distanceM: 540,
    bio: "咖啡闲聊 / 读书会",
    tags: [{ text: "同行中", kind: "status" }, { text: "附近", kind: "social" }],
    online: true,
    mutualFriends: 1
  },
  {
    id: "u_mai",
    name: "Mai",
    initials: "MA",
    distanceM: 720,
    bio: "奥黛骑行老城",
    tags: [{ text: "同行中", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 3
  },
  {
    id: "u_an",
    name: "An",
    initials: "AN",
    distanceM: 950,
    bio: "陪看展 / 美术馆",
    tags: [{ text: "同行中", kind: "status" }],
    online: false,
    mutualFriends: 0
  },
  {
    id: "u_khoa",
    name: "Khoa",
    initials: "KH",
    distanceM: 1200,
    bio: "夜骑 / 跑步搭子",
    tags: [{ text: "同行中", kind: "status" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 1
  }
];

const COFFEE_MEAL_PEOPLE: RecommendPerson[] = [
  {
    id: "u_trang",
    name: "Trang",
    initials: "TG",
    distanceM: 280,
    bio: "Cà phê sữa đá / 河内老店",
    tags: [{ text: "附近", kind: "social" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 2
  },
  {
    id: "u_tu",
    name: "Tú",
    initials: "TU",
    distanceM: 410,
    bio: "Pho 24 / Bun Cha 探店",
    tags: [{ text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_nhi",
    name: "Nhi",
    initials: "NH",
    distanceM: 640,
    bio: "Banh Mi + Egg Coffee",
    tags: [{ text: "附近", kind: "social" }],
    online: true,
    mutualFriends: 1
  }
];

const ACTIVITY_PEOPLE: RecommendPerson[] = [
  {
    id: "u_long",
    name: "Long",
    initials: "LG",
    distanceM: 480,
    bio: "本周市集 / 周末读书会",
    tags: [{ text: "活动搭子", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 2
  },
  {
    id: "u_phuong",
    name: "Phương",
    initials: "PH",
    distanceM: 880,
    bio: "Live House / 独立乐队",
    tags: [{ text: "活动搭子", kind: "status" }],
    online: false,
    mutualFriends: 0
  },
  {
    id: "u_kien",
    name: "Kiên",
    initials: "KN",
    distanceM: 1050,
    bio: "展览 / 当代艺术",
    tags: [{ text: "活动搭子", kind: "status" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 1
  }
];

const TRIP_PEOPLE: RecommendPerson[] = [
  {
    id: "u_my",
    name: "My",
    initials: "MY",
    distanceM: 350,
    bio: "下龙湾一日游搭子",
    tags: [{ text: "旅行搭子", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 2
  },
  {
    id: "u_duc",
    name: "Đức",
    initials: "DC",
    distanceM: 720,
    bio: "沙坝 / 番西邦徒步",
    tags: [{ text: "旅行搭子", kind: "status" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_ly",
    name: "Lý",
    initials: "LY",
    distanceM: 920,
    bio: "宁平 / 三谷游船",
    tags: [{ text: "旅行搭子", kind: "status" }, { text: "附近", kind: "social" }],
    online: true,
    mutualFriends: 1
  }
];

const CREATOR_PEOPLE: RecommendPerson[] = [
  {
    id: "u_phuong_thanh",
    name: "Phương Thanh",
    initials: "PT",
    distanceM: 410,
    bio: "独立音乐 / 录音棚",
    tags: [{ text: "创作搭子", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 1
  },
  {
    id: "u_hong_anh",
    name: "Hồng Anh",
    initials: "HA",
    distanceM: 680,
    bio: "短视频脚本 / 拍摄",
    tags: [{ text: "创作搭子", kind: "status" }],
    online: false,
    mutualFriends: 0
  },
  {
    id: "u_son",
    name: "Sơn",
    initials: "SN",
    distanceM: 890,
    bio: "插画 / 写稿",
    tags: [{ text: "创作搭子", kind: "status" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 2
  }
];

// R15.34: 翻译 (TRANSLATE) 是 HTML prototype 没有但用户列出的
// 新场景 — 单独一个 feed。
const TRANSLATE_PEOPLE: RecommendPerson[] = [
  {
    id: "u_thu_trang",
    name: "Thu Trang",
    initials: "TT",
    distanceM: 290,
    bio: "中越 / 英越 翻译 · 菜单/合同",
    tags: [{ text: "会中文", kind: "lang" }, { text: "最近活跃", kind: "social" }],
    online: true,
    mutualFriends: 1
  },
  {
    id: "u_hai",
    name: "Hải",
    initials: "HA",
    distanceM: 520,
    bio: "医院陪同 / 药店代购",
    tags: [{ text: "会中文", kind: "lang" }, { text: "陪诊", kind: "status" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_ngoc",
    name: "Ngọc",
    initials: "NG",
    distanceM: 740,
    bio: "英越同传 · 商务",
    tags: [{ text: "会中文", kind: "lang" }],
    online: false,
    mutualFriends: 0
  }
];

// R15.34: 陪诊 (MEDICAL) — 用户列出的"比如 奥黛骑行 翻译 陪诊"
// 之一。医院陪同 / 药店代购。
const MEDICAL_PEOPLE: RecommendPerson[] = [
  {
    id: "u_hai",
    name: "Hải",
    initials: "HA",
    distanceM: 520,
    bio: "医院陪同 · 药店代购",
    tags: [{ text: "陪诊", kind: "status" }, { text: "会中文", kind: "lang" }],
    online: true,
    mutualFriends: 0
  },
  {
    id: "u_lan",
    name: "Lan",
    initials: "LA",
    distanceM: 880,
    bio: "Bach Mai / K 医院陪同",
    tags: [{ text: "陪诊", kind: "status" }],
    online: true,
    mutualFriends: 1
  }
];

// R15.34: 奥黛骑行 (AO_DAI_RIDE) — 越南特色场景。奥黛 +
// 自行车 + 老城 / 西湖。We don't add this as a SceneToolId (避免
// 改 contracts)，而是作为 COMPANION mode 下的 sub-tag。
// 这里直接给 COMPANION 的某些人加 "奥黛骑行" tag 即可。

// 6 个 scene tool + 2 个不在 SCENE_TOOLS 里但用户列出的额外场景。
// "PHOTO/COMPANION/COFFEE_MEAL/ACTIVITY/TRIP/CREATOR" 走 SCENE_TOOLS,
// "TRANSLATE/MEDICAL" 是 COMPANION 之外的旁路。
export const SCENE_RECOMMEND: Record<string, RecommendFeed> = {
  PHOTO: {
    title: "身边的摄影好搭子",
    subtitle: "根据你的位置和偏好，为你推荐合适的人", boundSceneId: "phunghung",
    sceneTag: "摄影爱好者",
    people: withAccountPortraits(PHOTO_PEOPLE)
  },
  COMPANION: {
    title: "适合一起出发的人",
    subtitle: "优先推荐兴趣和时间更匹配的人", boundSceneId: "banana",
    sceneTag: "同行中",
    people: withAccountPortraits(COMPANION_PEOPLE)
  },
  COFFEE_MEAL: {
    title: "附近吃饭 / 咖啡搭子",
    subtitle: "探店和闲聊的人都在这", boundSceneId: "threebeans",
    sceneTag: "附近吃饭",
    people: withAccountPortraits(COFFEE_MEAL_PEOPLE)
  },
  ACTIVITY: {
    title: "本周活动搭子",
    subtitle: "市集 / Live House / 展览", boundSceneId: "complex01",
    sceneTag: "活动搭子",
    people: withAccountPortraits(ACTIVITY_PEOPLE)
  },
  TRIP: {
    title: "周边一日游",
    subtitle: "下龙湾 / 沙坝 / 宁平", boundSceneId: "banana",
    sceneTag: "旅行搭子",
    people: withAccountPortraits(TRIP_PEOPLE)
  },
  CREATOR: {
    title: "创作搭子",
    subtitle: "写稿 / 拍摄 / 录音 / 插画", boundSceneId: "manzi",
    sceneTag: "创作搭子",
    people: withAccountPortraits(CREATOR_PEOPLE)
  },
  TRANSLATE: {
    title: "翻译和语言帮手",
    subtitle: "中越 / 英越 / 菜单 / 合同 / 医院", boundSceneId: "phunghung",
    sceneTag: "会中文",
    people: withAccountPortraits(TRANSLATE_PEOPLE)
  },
  MEDICAL: {
    title: "陪诊帮手",
    subtitle: "医院陪同 / 药店代购 / 翻译", boundSceneId: "trucbach",
    sceneTag: "陪诊",
    people: withAccountPortraits(MEDICAL_PEOPLE)
  }
};

// R15.34: 场景模式顺序。
// - 先 6 个 SCENE_TOOLS（用户在 app 里点）
// - 再 2 个非 SCENE_TOOLS 旁路（翻译 / 陪诊），用 modeToggle 的
//   "more" 链接或直接走 "更多场景" sheet 触发
export const RECOMMEND_MODE_ORDER: ReadonlyArray<string> = [
  "PHOTO",
  "COMPANION",
  "COFFEE_MEAL",
  "ACTIVITY",
  "TRIP",
  "CREATOR",
  "TRANSLATE",
  "MEDICAL"
];

// R15.34: 单行路由 — 每个 mode 默认显示 sub-scenario 标题，
// 但 stories 横滑的第一项是 "全部"，后续是子场景。
// Phase 1 暂时只显示"全部"，后面接真实 sub-scenario。
export interface RecommendFilter {
  id: string;
  label: string;
}

// ROOM-CREATE-001（2026-09-22，用户反馈）："最近活跃"和"在线"是同一件事的两种
// 说法——在线是即时真值，"最近活跃"顶多是"最近在线过"，谁真的最近活跃该由
// 后端算好直接推，不该在筛选栏里假装是用户能自己选的独立维度。去掉这个 chip。
//
// HOME-MORE-DIST-001（2026-09-22，照 deepseek_html_20260922_1c2e2c.html）：距离也
// 移出这个列表 —— 它不再是"开关型 chip"里的一员，而是原型的 distance-chip
//（📍 10km 内 ▾ + 滑杆，见 requester-home.tsx）。两者不是一回事：chip 是
// 加/减一个条件，距离是**设置**（恒生效、没有 off 态）。所以这里只剩两个
// 真正的开关。
export const RECOMMEND_FILTER_CHIPS: ReadonlyArray<RecommendFilter> = [
  { id: "online", label: "在线" },
  { id: "lang_zh", label: "中文" }
];

// 继续进行 fixture — 之前 HTML prototype 的大 thumb 卡片用
export interface ContinueItem {
  key: string;
  title: string;
  subtitle: string;
  // "draft" | "task" | "memory" — 决定 thumb 颜色 / 角标
  kind: "draft" | "task" | "memory";
  // 缩略图占位 — 颜色 + 文字（没有真图）
  thumbLabel: string;
  thumbColor: string;
}

export const CONTINUE_FIXTURES: ReadonlyArray<ContinueItem> = [
  {
    key: "west_lake_photo",
    title: "West Lake photography · 昨天",
    subtitle: "与 Duy Khang 的拍照需求",
    kind: "memory",
    thumbLabel: "WL",
    thumbColor: "#9DA9AF"
  },
  {
    key: "coffee_with_minh",
    title: "Coffee chat with Minh",
    subtitle: "草稿 · 已填 65%",
    kind: "draft",
    thumbLabel: "CF",
    thumbColor: "#FFD6AA"
  },
  {
    key: "translator_thu_trang",
    title: "明日医院 · 陪诊 Thu Trang",
    subtitle: "已发布 · 等待匹配",
    kind: "task",
    thumbLabel: "MD",
    thumbColor: "#B7C9D2"
  }
];
