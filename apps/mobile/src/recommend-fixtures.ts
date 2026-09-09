// R15.34: 推荐人 mock 数据 (本地 hard-coded 列表) —
// 没有 server 端点，先用 fixture。生产环境接 /v1/agents/feed
// 或类似端点时，删这个文件 + 换 data hook。
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
  /** R34.5 prototype portrait. Replace with the account avatar URL when the feed is server-backed. */
  photoUri?: string;
  // 距离，单位米
  distanceM: number;
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
}

const R34_HUMAN_PORTRAITS = [
  "https://images.unsplash.com/photo-1616325629936-99a9013c29c6?auto=format&fit=crop&w=320&q=82",
  "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=320&q=82",
  "https://images.unsplash.com/photo-1511081692775-05d0f180a065?auto=format&fit=crop&w=320&q=82",
  "https://images.unsplash.com/photo-1509030450996-dd1a26dda07a?auto=format&fit=crop&w=320&q=82",
  "https://images.unsplash.com/photo-1559314809-0d155014e29e?auto=format&fit=crop&w=320&q=82",
] as const;

function withR34Portraits(people: RecommendPerson[], offset: number): RecommendPerson[] {
  return people.map((person, index) => ({
    ...person,
    photoUri: R34_HUMAN_PORTRAITS[(index + offset) % R34_HUMAN_PORTRAITS.length]!,
    rating: Number((4.9 - ((index + offset) % 3) * 0.1).toFixed(1)),
    completedActivities: 12 + ((index + offset) % 5) * 5,
    availabilityText: person.online ? (index % 2 === 0 ? "今天 18:00 后可用" : "今天可约") : "查看近期可用时间",
    positiveRate: 96 - ((index + offset) % 3),
    reviewSummary: index % 2 === 0 ? "沟通自然，守时，熟悉本地路线" : "响应清楚，场景准备充分",
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
    people: withR34Portraits(PHOTO_PEOPLE, 0)
  },
  COMPANION: {
    title: "适合一起出发的人",
    subtitle: "优先推荐兴趣和时间更匹配的人", boundSceneId: "banana",
    sceneTag: "同行中",
    people: withR34Portraits(COMPANION_PEOPLE, 1)
  },
  COFFEE_MEAL: {
    title: "附近吃饭 / 咖啡搭子",
    subtitle: "探店和闲聊的人都在这", boundSceneId: "threebeans",
    sceneTag: "附近吃饭",
    people: withR34Portraits(COFFEE_MEAL_PEOPLE, 2)
  },
  ACTIVITY: {
    title: "本周活动搭子",
    subtitle: "市集 / Live House / 展览", boundSceneId: "complex01",
    sceneTag: "活动搭子",
    people: withR34Portraits(ACTIVITY_PEOPLE, 3)
  },
  TRIP: {
    title: "周边一日游",
    subtitle: "下龙湾 / 沙坝 / 宁平", boundSceneId: "banana",
    sceneTag: "旅行搭子",
    people: withR34Portraits(TRIP_PEOPLE, 4)
  },
  CREATOR: {
    title: "创作搭子",
    subtitle: "写稿 / 拍摄 / 录音 / 插画", boundSceneId: "manzi",
    sceneTag: "创作搭子",
    people: withR34Portraits(CREATOR_PEOPLE, 0)
  },
  TRANSLATE: {
    title: "翻译和语言帮手",
    subtitle: "中越 / 英越 / 菜单 / 合同 / 医院", boundSceneId: "phunghung",
    sceneTag: "会中文",
    people: withR34Portraits(TRANSLATE_PEOPLE, 1)
  },
  MEDICAL: {
    title: "陪诊帮手",
    subtitle: "医院陪同 / 药店代购 / 翻译", boundSceneId: "trucbach",
    sceneTag: "陪诊",
    people: withR34Portraits(MEDICAL_PEOPLE, 2)
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

export const RECOMMEND_FILTER_CHIPS: ReadonlyArray<RecommendFilter> = [
  { id: "near", label: "附近" },
  { id: "active", label: "最近活跃" },
  { id: "lang_zh", label: "会中文" },
  { id: "online", label: "在线" }
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
