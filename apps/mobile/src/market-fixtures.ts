// Market fixtures — R15.12.7 → R4 (2026-08-24).
// R4 决定：移除“体验上架”（小美真人货架）以不拉低小美身价。
// 市场仅保留 机会 / 活动 双 Tab：机会由客户发布、小美单向报名；活动是公共线。
// EXPERIENCE 保留为 deprecated 别名（历史路由兼容），新 UI 不再展示，统一归一到 OPPORTUNITY。
// 坐标仍用于 MAP 的粗粒度区域定位，精确地址仅授权后披露。

export type MarketTab = "EXPERIENCE" | "OPPORTUNITY" | "ACTIVITY";

export interface MarketExperience {
  id: string;
  title: string;
  category: string;
  meta: string;
  scope: string;
  deliverable: string;
  place: string;
  duration: string;
  price: string;
  moneyFlow?: "EARN";
  priceLabel?: string;
  next: string;
  hosts: string[];
  photo: string;
  coord: [number, number];
}

// R16.x: wire 上 MarketOpportunitySchema 强制 MoneyFlow 4 选 1 +
// PriceLabel 必填。mobile 端本地 MarketOpportunity 必须把这两个
// 字段补齐，否则 zod parse 在 client SDK 处会失败。
export type MarketOpportunityMoneyFlow = "EARN" | "PAY" | "FREE" | "TBD";

export interface MarketHost {
  id: string;
  name: string;
  photo: string;
  topic: string;
  sub: string;
  fulfill: string;
  done: number;
}

export type OpportunityLens = "NOW" | "NEARBY" | "BOOKED" | "REMOTE";

export interface MarketOpportunity {
  id: string;
  title: string;
  shortTitle: string;
  theme: string;
  date: string;
  time: string;
  location: string;
  price: string;
  moneyFlow: MarketOpportunityMoneyFlow;
  priceLabel: string;
  owner: string;
  ownerType: "BUSINESS" | "PERSON";
  match: string;
  responses: number;
  posted: string;
  skills: string;
  verified: boolean;
  lens: OpportunityLens[];
  travel: number | null;
  signal: string;
  signalClass: string;
  countdown: string;
  coord?: [number, number];
  ownedByViewer?: boolean;
  appliedByViewer?: boolean;
  viewerApplicationId?: string;
  viewerApplicationStatus?: "SUBMITTED" | "SELECTED" | "NOT_SELECTED" | "CONFIRMED";
  viewerOrderRef?: string;
  // R15.x (P1 market 附近): server (apps/api-go/internal/marketplace/
  // service.go) 在 ListMarketOpportunities 返回 lat/lng/travelSource.
  // 客户端不传 userLat/userLng 时, lat/lng 走 seeded, travelSource=
  // "seeded"; 传了就走 haversine 路径, travelSource="user_distance".
  lat?: number;
  lng?: number;
  travelSource?: "seeded" | "user_distance" | "unknown";
}

export const MARKET_EXPERIENCES: MarketExperience[] = [
  {
    id: "westlake_portrait",
    title: "西湖人像摄影散步",
    category: "摄影体验",
    meta: "90 分钟 · 西湖公开路线",
    scope: "边走边拍，包含路线组织与人像拍摄；完成后交付 20 张精选照片。",
    deliverable: "20 张精选照片",
    place: "西湖 · 公开场景",
    duration: "90 分钟",
    price: "680,000₫ 起",
    next: "周六 15:00",
    hosts: ["linh", "mai"],
    photo: "https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=900&q=80",
    coord: [29, 32]
  },
  {
    id: "cafe_photo",
    title: "河内 Cafe 拍照体验",
    category: "Cafe · 摄影",
    meta: "2 小时 · 西湖 / 巴亭",
    scope: "选择 1–2 家公开 Cafe，包含路线建议、点位建议与生活方式照片拍摄。",
    deliverable: "15 张精选照片 + 路线建议",
    place: "平台公开 Cafe",
    duration: "2 小时",
    price: "590,000₫ 起",
    next: "今天 18:30",
    hosts: ["mai", "anh"],
    photo: "https://images.unsplash.com/photo-1511081692775-05d0f180a065?auto=format&fit=crop&w=900&q=80",
    coord: [23, 52]
  },
  {
    id: "hanoi_language_walk",
    title: "中文城市体验",
    category: "语言 · 城市",
    meta: "2.5 小时 · 老城区",
    scope: "围绕公开城市路线进行中文 / 越南语交流，包含本地路线介绍与 1 次 Cafe 停留。",
    deliverable: "城市路线 + 语言交流",
    place: "老城区公开路线",
    duration: "2.5 小时",
    price: "780,000₫ 起",
    next: "周日 14:00",
    hosts: ["linh", "thao"],
    photo: "https://images.unsplash.com/photo-1509030450996-dd1a26dda07a?auto=format&fit=crop&w=900&q=80",
    coord: [65, 38]
  },
  {
    id: "oldquarter_food",
    title: "老城区本地美食路线",
    category: "美食体验",
    meta: "2 小时 · 还剑",
    scope: "3 个公开餐饮点位的步行路线与本地菜单介绍；餐费按页面规则另计。",
    deliverable: "3 个点位 + 菜单说明",
    place: "还剑 · 公开餐饮场景",
    duration: "2 小时",
    price: "690,000₫ 起",
    next: "周六 18:00",
    hosts: ["anh", "mai"],
    photo: "https://images.unsplash.com/photo-1559314809-0d155014e29e?auto=format&fit=crop&w=900&q=80",
    coord: [59, 48]
  }
];

// Host 来自 R158_PEOPLE；'an' 是原型体验卡里出现的别名，映射到 R158_PEOPLE 的 'anh'。
export const MARKET_HOSTS: MarketHost[] = [
  { id: "linh", name: "Linh", photo: "https://randomuser.me/api/portraits/women/44.jpg", topic: "陪同", sub: "中文 · 河内", fulfill: "99%", done: 42 },
  { id: "mai", name: "Mai", photo: "https://randomuser.me/api/portraits/women/32.jpg", topic: "摄影", sub: "英 / 越 · 河内", fulfill: "95%", done: 18 },
  { id: "thao", name: "Thao", photo: "https://randomuser.me/api/portraits/women/65.jpg", topic: "口译", sub: "中 / 越 · 河内 / 北宁", fulfill: "98%", done: 49 },
  { id: "anh", name: "Anh", photo: "https://randomuser.me/api/portraits/women/68.jpg", topic: "接待", sub: "英 / 越 · 河内", fulfill: "99%", done: 58 }
];

export function marketHost(id: string): MarketHost {
  const alias = id === "an" ? "anh" : id;
  return MARKET_HOSTS.find((host) => host.id === alias) ?? MARKET_HOSTS[0]!;
}

export function marketExperience(id: string): MarketExperience {
  return MARKET_EXPERIENCES.find((experience) => experience.id === id) ?? MARKET_EXPERIENCES[0]!;
}

export const MARKET_OPPORTUNITIES: MarketOpportunity[] = [
  {
    id: "biz_negotiation",
    title: "商务谈判陪同 · 中英越沟通",
    shortTitle: "谈判",
    theme: "商务谈判",
    date: "今天",
    time: "14:00–18:00",
    location: "河内 · Hoàn Kiếm",
    price: "1,200,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Nova Trading",
    ownerType: "BUSINESS",
    match: "94%",
    responses: 6,
    posted: "12 分钟前",
    skills: "中文 · 英语 · 商务沟通",
    verified: true,
    lens: ["NOW", "NEARBY"],
    travel: 18,
    signal: "急需",
    signalClass: "hot",
    countdown: "42m",
    coord: [61, 37]
  },
  {
    id: "event_photo",
    title: "品牌活动摄影 / 短视频",
    shortTitle: "摄影",
    theme: "摄影",
    date: "周六",
    time: "15:00–20:00",
    location: "河内 · 西湖",
    price: "1,500,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Bonsaidon",
    ownerType: "BUSINESS",
    match: "91%",
    responses: 9,
    posted: "25 分钟前",
    skills: "摄影 · 基础剪辑 · 活动经验",
    verified: true,
    lens: ["BOOKED", "NEARBY"],
    travel: 24,
    signal: "热门",
    signalClass: "",
    countdown: "3天",
    coord: [28, 31]
  },
  {
    id: "supplier_visit",
    title: "供应商拜访 · 中文陪同",
    shortTitle: "陪同",
    theme: "商务陪同",
    date: "明天",
    time: "09:00–15:00",
    location: "北宁 · Yên Phong",
    price: "1,100,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Acme VN",
    ownerType: "BUSINESS",
    match: "89%",
    responses: 3,
    posted: "42 分钟前",
    skills: "中文 · 制造业 · 会议记录",
    verified: true,
    lens: ["BOOKED"],
    travel: 52,
    signal: "新发布",
    signalClass: "",
    countdown: "明天",
    coord: [78, 18]
  },
  {
    id: "city_companion",
    title: "河内半日城市同行 / 拍照",
    shortTitle: "同行",
    theme: "城市同行",
    date: "周日",
    time: "13:30–18:00",
    location: "河内 · 西湖 → 老城区",
    price: "950,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Chen",
    ownerType: "PERSON",
    match: "87%",
    responses: 11,
    posted: "1 小时前",
    skills: "中文 · 路线 · 轻摄影",
    verified: true,
    lens: ["BOOKED", "NEARBY"],
    travel: 20,
    signal: "高响应",
    signalClass: "",
    countdown: "周日",
    coord: [39, 58]
  },
  {
    id: "restaurant_interpreter",
    title: "商务晚餐 · 中文口译",
    shortTitle: "口译",
    theme: "口译",
    date: "周五",
    time: "18:30–21:00",
    location: "河内 · 西湖",
    price: "800,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Lanting Restaurant",
    ownerType: "BUSINESS",
    match: "84%",
    responses: 7,
    posted: "2 小时前",
    skills: "中文 · 餐饮 · 商务礼仪",
    verified: true,
    lens: ["NOW", "NEARBY"],
    travel: 22,
    signal: "急需",
    signalClass: "hot",
    countdown: "1h12m",
    coord: [23, 49]
  },
  {
    id: "store_check",
    title: "门店体验检查 · 结果记录",
    shortTitle: "巡店",
    theme: "门店体验",
    date: "明天",
    time: "16:00–18:00",
    location: "河内 · Cầu Giấy",
    price: "650,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Retail Ops",
    ownerType: "BUSINESS",
    match: "82%",
    responses: 4,
    posted: "2 小时前",
    skills: "观察 · 拍照 · 结构化反馈",
    verified: true,
    lens: ["NEARBY", "BOOKED"],
    travel: 17,
    signal: "新发布",
    signalClass: "",
    countdown: "明天",
    coord: [58, 75]
  },
  {
    id: "reception_now",
    title: "临时接待补位",
    shortTitle: "接待",
    theme: "接待",
    date: "今天",
    time: "17:30–20:30",
    location: "河内 · 还剑",
    price: "850,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Mellow House",
    ownerType: "BUSINESS",
    match: "92%",
    responses: 2,
    posted: "8 分钟前",
    skills: "英语 · 接待 · 现场",
    verified: true,
    lens: ["NOW", "NEARBY"],
    travel: 14,
    signal: "急需",
    signalClass: "hot",
    countdown: "58m",
    coord: [28, 31]
  },
  {
    id: "remote_translate",
    title: "远程资料翻译",
    shortTitle: "翻译",
    theme: "翻译",
    date: "今天",
    time: "20:00 前",
    location: "远程",
    price: "700,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Atlas Studio",
    ownerType: "BUSINESS",
    match: "93%",
    responses: 4,
    posted: "18 分钟前",
    skills: "中文 · 英语 · 文档",
    verified: true,
    lens: ["REMOTE"],
    travel: null,
    signal: "远程",
    signalClass: "now",
    countdown: "今晚"
  },
  {
    id: "remote_assistant",
    title: "线上会议助理",
    shortTitle: "助理",
    theme: "助理",
    date: "明天",
    time: "09:00–12:00",
    location: "远程",
    price: "900,000₫",
    moneyFlow: "EARN" as const,
    priceLabel: "完成后你可获得",
    owner: "Mori Labs",
    ownerType: "BUSINESS",
    match: "90%",
    responses: 5,
    posted: "31 分钟前",
    skills: "英语 · 会议记录 · 跟进",
    verified: true,
    lens: ["REMOTE"],
    travel: null,
    signal: "新发布",
    signalClass: "",
    countdown: "明天"
  }
];

export const OPPORTUNITY_LENS_LABEL: Record<OpportunityLens, string> = {
  NOW: "现在",
  NEARBY: "附近",
  BOOKED: "预约",
  REMOTE: "远程"
};
