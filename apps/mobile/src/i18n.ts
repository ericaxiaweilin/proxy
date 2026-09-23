// HOME-I18N-001（2026-09-22，用户要求「语言要支持选择」）：照原型
// deepseek_html_20260922_1c2e2c.html 的 LANGS / I18N / 选择语言 sheet。
//
// 为什么要有这个文件：原型的页头有一个「中」按钮 + 选择语言面板，而本仓
// 之前**没有任何语言切换的 UI** —— preferences.ts 里躺着 saveLanguage /
// LANG_LABEL，但**一个调用方都没有**（定义了没人用）。所以那个按钮当时
// 做出来就是死按钮。这里把地基补上，按钮才有意义。
//
// 两条设计约束：
//
// 1. **这个模块是纯的** —— 不 import expo-secure-store。持久化由调用方走
//    preferences.ts。这样测试可以直接 import 它，不需要 mock native。
//
// 2. **键必须齐**。Messages 是个 interface（不是 Record<string,string>），
//    所以少一种语言的一个键就 **typecheck 失败**。语言表最怕的就是"某个
//    语言悄悄回退到中文"—— 那种洞只有把缺失变成编译错误才拦得住。
//
// 文案来源：跟原型共有的键（title / chipOnline / chipChinese / chipChatRoom /
// kmUnit / ridePrefix / selectLanguage / cancel / online / rideTimes）
// **直接取原型的 I18N 原文** —— 那是设计给的文案，不是我编的。
// 仓库自己才有的字符串（标注 self）是工程补译，需要设计过一眼。

import { useSyncExternalStore } from "react";

export type Language = "zh" | "vi" | "en" | "lo" | "ko" | "ja";

export interface LanguageOption {
  code: Language;
  flag: string;
  // 自称（原型 name）：列表里给用户看的那一列
  name: string;
  // 英文名（原型 native）：给不认识该文字的人认
  english: string;
  // 顶栏按钮上的短标（原型 short）
  short: string;
}

// 顺序跟原型 LANGS 一致，默认项排第一。
export const LANGUAGES: ReadonlyArray<LanguageOption> = [
  { code: "zh", flag: "🇨🇳", name: "中文", english: "Chinese", short: "中" },
  { code: "vi", flag: "🇻🇳", name: "Tiếng Việt", english: "Vietnamese", short: "VI" },
  { code: "en", flag: "🇬🇧", name: "English", english: "English", short: "EN" },
  { code: "lo", flag: "🇱🇦", name: "ລາວ", english: "Lao", short: "LO" },
  { code: "ko", flag: "🇰🇷", name: "한국어", english: "Korean", short: "KO" },
  { code: "ja", flag: "🇯🇵", name: "日本語", english: "Japanese", short: "JA" }
];

export const DEFAULT_LANGUAGE: Language = "zh";

export function isLanguage(value: string): value is Language {
  return LANGUAGES.some((option) => option.code === value);
}

export function languageOption(code: Language): LanguageOption {
  return LANGUAGES.find((option) => option.code === code) ?? LANGUAGES[0]!;
}

// {name} / {km} / {n} / {label} 是占位符，由 t() 的第二参替换。
export interface Messages {
  title: string;
  humanBadge: string;
  chipOnline: string;
  chipChinese: string;
  chipChatRoom: string;
  kmUnit: string;
  ridePrefix: string;
  more: string;
  back: string;
  search: string;
  closeSearch: string;
  searchPeople: string;
  searchPlaceholder: string;
  clearSearch: string;
  emptyFiltered: string;
  distanceUnknown: string;
  offline: string;
  distanceChipA11y: string;
  distanceTierA11y: string;
  selectedSuffix: string;
  filterChipA11y: string;
  createRoomA11y: string;
  roomsCreateTitle: string;
  roomsCreateDesc: string;
  roomsOngoing: string;
  roomsEmpty: string;
  roomsLoadFailed: string;
  roomsLoading: string;
  roomsLoginFirst: string;
  roomEnter: string;
  roomMembers: string;
  roomOpenA11y: string;
  languageChipA11y: string;
  language: string;
  selectLanguage: string;
  cancel: string;
  retry: string;
  retryServerSearch: string;
  serverSearchFailed: string;
  serverPeopleTitle: string;
  thisIsYou: string;
  addFriend: string;
  alreadyFriend: string;
  requestSent: string;
  home: string;
  messageAction: string;
  publishDemand: string;
  humanProfile: string;
  viewProfile: string;
  combo: string;
  sceneIdeas: string;
  continueSection: string;
  nearbyScenes: string;
  inviteMoment: string;
  noActivity: string;
  privateHidden: string;
  noPublicPosts: string;
  whatSheCanDo: string;
  reputation: string;
  publicActivity: string;
  relatedTheme: string;
  currentTheme: string;
  currentAction: string;
  canGoTogether: string;
  currentScene: string;
  suitableScenes: string;
  nearbyNowVisible: string;
  map: string;
  itemsCount: string;
  draftProgress: string;
  publishedWaiting: string;
  relationshipLoadFailed: string;
  loginToAddFriend: string;
  noAccountYet: string;
  becameFriends: string;
  friendRequestSent: string;
  cannotAddSelf: string;
  friendActionFailed: string;
  friendLabelFriend: string;
  friendLabelOutgoing: string;
  friendLabelIncoming: string;
  friendLabelAdd: string;
  adding: string;
  addingShort: string;
  added: string;
  acceptAdd: string;
  addAction: string;
  foundPeople: string;
  foundPeopleSub: string;
  notFoundQuery: string;
  notFoundQuerySub: string;
  serverSearchFailedTitle: string;
  serverSearchFailedSub: string;
  joinAlready: string;
  joinFull: string;
  joinGone: string;
  sessionExpired: string;
  joinFailed: string;
  loginToJoin: string;
  networkError: string;
  pickActivityFirst: string;
  joinedWithCount: string;
  modePhoto: string;
  modeCompanion: string;
  modeMeal: string;
  modeActivity: string;
  modeTrip: string;
  modeCreator: string;
  modeTranslate: string;
  modeMedical: string;
  actionCoffeeMeal: string;
  actionActivityTogether: string;
  actionTrip: string;
  actionCreator: string;
  aiRecommend: string;
  aiRecommendSub: string;
  aiGenerated: string;
  viewProfileA11y: string;
  messageToA11y: string;
  withPerson: string;
  gridSub: string;
  changeAllHint: string;
  changeAllLabel: string;
  chainHint: string;
  makeImage: string;
  makeImageA11y: string;
  joinInProgress: string;
  joinCta: string;
  joinCtaA11y: string;
  publishDemandA11y: string;
  choosePerson: string;
  chooseTime: string;
  chooseActivity: string;
  choosePlace: string;
  chooseA11y: string;
  currentChoice: string;
  chooseSlot: string;
  tilePersonSub: string;
  tileTime: string;
  tilePlace: string;
  oneDay: string;
  postedToFeed: string;
  loginToPost: string;
  postFailed: string;
  postToFeed: string;
  posting: string;
  inviteShared: string;
  shareFailed: string;
  shareInvite: string;
  sharing: string;
  shareInviteCta: string;
  backHome: string;
  backShort: string;
  nearbyRecommend: string;
  activityCount: string;
  viewPublicHistory: string;
  availabilityUnknown: string;
  historyCount: string;
  relatedToRecommend: string;
  viewFullScene: string;
  viewSceneFallback: string;
  sceneSuggestions: string;
  nearbySceneFallback: string;
  viewSceneA11y: string;
  sceneTagFallback: string;
  languageFromProfile: string;
  reviewSummaryEmpty: string;
  trustLine: string;
  sceneReason: string;
  actionTable: string;
  actionInvite: string;
  viewHumanProfileA11y: string;
  icebreakerTitle: string;
  closeIcebreaker: string;
  close: string;
  sendLineA11y: string;
  icebreakerLine1: string;
  icebreakerLine2: string;
  greetLine1: string;
  greetLine2: string;
  greetLine3: string;
  greetLine4: string;
  greetLine5: string;
  greetLine6: string;
  greetLine7: string;
  greetLine8: string;
  greetA11y: string;
  invited: string;
  greetFailed: string;
  greetLoginFirst: string;
  greetNoAccount: string;
  recombo: string;
  recomboSub: string;
  swapPerson: string;
  swapScene: string;
  swapTime: string;
  swapActivity: string;
  othersUnchanged: string;
  clarifyTimeQuestion: string;
  afternoon: string;
  evening: string;
  needTimeCondition: string;
  needTimeConditionSub: string;
  timeToTonight: string;
  activityToWalk: string;
  coffeeCombo: string;
  coffeeComboSub: string;
  searchingServer: string;
  searchingServerSub: string;
  imageNeedsChat: string;
  notFoundQuerySub2: string;
}

const ZH: Messages = {
  title: "真人推荐",
  humanBadge: "真人",
  chipOnline: "在线",
  chipChinese: "中文",
  chipChatRoom: "聊天房",
  kmUnit: "km 内",
  ridePrefix: "约骑行 ",
  more: "更多 〉",
  back: "返回",
  search: "搜索",
  closeSearch: "关闭搜索",
  searchPeople: "搜索真人",
  searchPlaceholder: "搜索名字或简介",
  clearSearch: "清空搜索",
  emptyFiltered: "当前筛选下没有人，放宽条件看看。",
  distanceUnknown: "距离未知",
  offline: "离线",
  distanceChipA11y: "距离 {km}km 内，点击调整半径",
  distanceTierA11y: "{km}km 内",
  selectedSuffix: "，已选",
  filterChipA11y: "筛选 {label}",
  createRoomA11y: "创建聊天房",
  roomsCreateTitle: "开个房，找人一起玩",
  roomsCreateDesc: "选场景 → 选人 → 3 秒搞定",
  roomsOngoing: "正在进行的房间",
  roomsEmpty: "你还没有房间，开一个吧",
  roomsLoadFailed: "房间没读出来，点这里重试",
  roomsLoading: "正在读取房间…",
  roomsLoginFirst: "登录后可以开房和进房",
  roomEnter: "进入",
  roomMembers: "{n} 人",
  roomOpenA11y: "进入房间 {name}",
  languageChipA11y: "界面语言：{name}，点击切换",
  language: "语言",
  selectLanguage: "选择语言",
  cancel: "取消",
  retry: "重试",
  retryServerSearch: "重试全站搜索",
  serverSearchFailed: "全站搜索失败，请稍后重试。",
  serverPeopleTitle: "全站真人 · {n} 位",
  thisIsYou: "这是你",
  addFriend: "+ 加好友",
  alreadyFriend: "已是好友",
  requestSent: "已发送",
  home: "主页",
  messageAction: "发消息",
  publishDemand: "发布需求",
  humanProfile: "真人主页",
  viewProfile: "查看主页",
  combo: "为你组合",
  sceneIdeas: "场景建议",
  continueSection: "继续进行",
  nearbyScenes: "附近场景",
  inviteMoment: "邀约 Moment",
  noActivity: "还没有可展示的活动记录",
  privateHidden: "非公开记录不展示",
  noPublicPosts: "暂无公开记录",
  whatSheCanDo: "她可以做什么",
  reputation: "历史信誉与评价",
  publicActivity: "本人公开的活动记录",
  relatedTheme: "关联主题",
  currentTheme: "当前主题",
  currentAction: "当前动作",
  canGoTogether: "当前可一起去",
  currentScene: "当前 Scene",
  suitableScenes: "适合场景",
  nearbyNowVisible: "附近 · 现在可见",
  map: "地图 〉",
  itemsCount: "{n} 项",
  draftProgress: "草稿 · 已填 {p}%",
  publishedWaiting: "已发布 · 等待匹配",
  relationshipLoadFailed: "好友状态暂时无法加载",
  loginToAddFriend: "登录后可添加好友",
  noAccountYet: "{name} 还没有账号，暂时加不了好友",
  becameFriends: "已成为好友 · {name}",
  friendRequestSent: "好友申请已发送 · {name}",
  cannotAddSelf: "不能添加自己",
  friendActionFailed: "好友操作失败，请稍后重试",
  friendLabelFriend: "已是好友 {name}",
  friendLabelOutgoing: "已申请好友 {name}",
  friendLabelIncoming: "接受 {name} 的好友申请",
  friendLabelAdd: "添加好友 {name}",
  adding: "添加中…",
  addingShort: "添加中",
  added: "✓ 已添加",
  acceptAdd: "接受添加",
  addAction: "+ 添加",
  foundPeople: "找到 {n} 位真人",
  foundPeopleSub: "点主页查看，+ 直接加好友。",
  notFoundQuery: "没有找到“{q}”",
  notFoundQuerySub: "本地推荐和全站都没命中。换个关键词，或去加好友页用 handle 精确找。",
  serverSearchFailedTitle: "全站搜索失败",
  serverSearchFailedSub: "网络可能有问题，点下面的重试，或换个关键词。",
  joinAlready: "你已报过名，不用重复点",
  joinFull: "名额已满，下次早点来",
  joinGone: "该活动不存在或已结束",
  sessionExpired: "登录已过期，请重新登录",
  joinFailed: "报名失败，请稍后重试",
  loginToJoin: "登录后可报名",
  networkError: "网络异常，请检查连接后重试",
  pickActivityFirst: "先选一个活动",
  joinedWithCount: "已报名 · {n} 人参加",
  modePhoto: "拍照",
  modeCompanion: "同行",
  modeMeal: "吃饭",
  modeActivity: "活动",
  modeTrip: "出去玩",
  modeCreator: "创作",
  modeTranslate: "翻译",
  modeMedical: "陪诊",
  actionCoffeeMeal: "咖啡 / 用餐",
  actionActivityTogether: "活动同行",
  actionTrip: "周边出行",
  actionCreator: "内容创作",
  aiRecommend: "AI 推荐",
  aiRecommendSub: "先看她为什么适合当前场景",
  aiGenerated: "AI 生成",
  viewProfileA11y: "查看{name}主页",
  messageToA11y: "发消息给 {name}",
  withPerson: "和{name}",
  gridSub: "选人 · 定时间 · 配活动场景，一键出图或邀约",
  changeAllHint: "同时更换人物、时间、活动和地点",
  changeAllLabel: "整组换一组",
  chainHint: "直接约她：点头像进 Scene 主页聊 · 想等人来：发布需求等小美接单",
  makeImage: "✦ 出图",
  makeImageA11y: "出图",
  joinInProgress: "报名中…",
  joinCta: "报名 →",
  joinCtaA11y: "报名参加活动",
  publishDemandA11y: "发布需求等小美报名",
  choosePerson: "选一起的人",
  chooseTime: "选时间",
  chooseActivity: "选活动",
  choosePlace: "选地点",
  chooseA11y: "选择 {name}",
  currentChoice: "当前选择",
  chooseSlot: "选择时段",
  tilePersonSub: "一起的人 · 点更换",
  tileTime: "时间",
  tilePlace: "地点",
  oneDay: "1 天",
  postedToFeed: "已发布到动态",
  loginToPost: "请先登录后再发布（游客身份不能发动态）。",
  postFailed: "发布失败，请重试。",
  postToFeed: "发布到动态",
  posting: "发布中…",
  inviteShared: "邀请已分享",
  shareFailed: "分享没有调起，请重试。",
  shareInvite: "分享邀约",
  sharing: "分享中…",
  shareInviteCta: "分享邀请 →",
  backHome: "返回Home",
  backShort: "‹ 返回",
  nearbyRecommend: "附近推荐",
  activityCount: "{n} 次活动记录",
  viewPublicHistory: "查看公开历史活动",
  availabilityUnknown: "查看可用时间",
  historyCount: "{n} 次历史活动 ›",
  relatedToRecommend: "与当前推荐的关联",
  viewFullScene: "查看完整场景",
  viewSceneFallback: "查看场景",
  sceneSuggestions: "场景建议",
  nearbySceneFallback: "附近场景",
  viewSceneA11y: "查看{name}",
  sceneTagFallback: "附近都市场景",
  languageFromProfile: "以主页资料为准",
  reviewSummaryEmpty: "暂无公开评价摘要",
  trustLine: "★ {rating} · 好评 {rate}% · {n} 次活动",
  sceneReason: "时间可配、距离较近，动作与主题匹配；场景只是见面建议，是否参加仍由双方确认。",
  actionTable: "拼桌",
  actionInvite: "邀约",
  viewHumanProfileA11y: "查看{name}的真人主页",
  icebreakerTitle: "向 {name} {action}",
  closeIcebreaker: "关闭破冰面板",
  close: "关闭",
  sendLineA11y: "发送：“{line}”",
  icebreakerLine1: "我也在附近，一起拼个桌？",
  icebreakerLine2: "刚好路过，要一起坐坐吗？",
  greetLine1: "嗨～刷到你了，打个招呼 👋",
  greetLine2: "Hi！看你的主页挺有意思的，认识一下？",
  greetLine3: "你好呀，同城的朋友，交个朋友吧～",
  greetLine4: "嗨，对你分享的内容挺好奇的，聊聊？",
  greetLine5: "路过你的主页，留个招呼 😊",
  greetLine6: "Hi～有空的话可以聊聊天",
  greetLine7: "你好，想认识一下新朋友",
  greetLine8: "嗨！今天过得怎么样？",
  greetA11y: "向 {name} 打招呼",
  invited: "已邀约",
  greetFailed: "招呼没发出去，再点一次试试",
  greetLoginFirst: "登录后才能打招呼",
  greetNoAccount: "{name} 还没有账号，暂时发不了招呼",
  recombo: "重新配了一套",
  recomboSub: "根据当前时间和附近可用 Scene 重新组合。",
  swapPerson: "换个人",
  swapScene: "换场景",
  swapTime: "换时间",
  swapActivity: "换活动",
  othersUnchanged: "其他 3 格保持不动。",
  clarifyTimeQuestion: "下午还是晚上？",
  afternoon: "下午",
  evening: "晚上",
  needTimeCondition: "还差一个时间条件",
  needTimeConditionSub: "确认后我直接更新，不会进入聊天页。",
  timeToTonight: "时间改成今晚",
  activityToWalk: "活动改成散步 / City Walk",
  coffeeCombo: "已配好 · Three Beans 更适合聊天",
  coffeeComboSub: "你提到咖啡和轻松聊天，所以优先选择更安静、有窗位的场景。",
  searchingServer: "正在全站找“{q}”…",
  searchingServerSub: "本地推荐没有命中，正在问服务端。",
  imageNeedsChat: "图片需要在 Proxy AI 对话中发送",
  notFoundQuerySub2: "换个关键词继续搜索，或点左侧 AI 标识进入模型对话。",
};

const VI: Messages = {
  title: "Gợi ý người thật",
  humanBadge: "Người thật",
  chipOnline: "Online",
  chipChinese: "Tiếng Trung",
  chipChatRoom: "Phòng chat",
  kmUnit: "km",
  ridePrefix: "~",
  more: "Thêm 〉",
  back: "Quay lại",
  search: "Tìm kiếm",
  closeSearch: "Đóng tìm kiếm",
  searchPeople: "Tìm người thật",
  searchPlaceholder: "Tìm tên hoặc giới thiệu",
  clearSearch: "Xoá tìm kiếm",
  emptyFiltered: "Không có ai với bộ lọc hiện tại, thử nới điều kiện.",
  distanceUnknown: "Chưa rõ khoảng cách",
  offline: "Offline",
  distanceChipA11y: "Trong {km}km, chạm để đổi bán kính",
  distanceTierA11y: "Trong {km}km",
  selectedSuffix: ", đã chọn",
  filterChipA11y: "Lọc {label}",
  createRoomA11y: "Tạo phòng chat",
  roomsCreateTitle: "Mở phòng, rủ người cùng chơi",
  roomsCreateDesc: "Chọn cảnh → chọn người → xong trong 3 giây",
  roomsOngoing: "Phòng đang diễn ra",
  roomsEmpty: "Bạn chưa có phòng nào, mở một phòng nhé",
  roomsLoadFailed: "Không tải được phòng, chạm để thử lại",
  roomsLoading: "Đang tải phòng…",
  roomsLoginFirst: "Đăng nhập để mở và vào phòng",
  roomEnter: "Vào",
  roomMembers: "{n} người",
  roomOpenA11y: "Vào phòng {name}",
  languageChipA11y: "Ngôn ngữ: {name}, chạm để đổi",
  language: "Ngôn ngữ",
  selectLanguage: "Chọn ngôn ngữ",
  cancel: "Huỷ",
  retry: "Thử lại",
  retryServerSearch: "Thử lại tìm toàn hệ thống",
  serverSearchFailed: "Tìm toàn hệ thống thất bại, thử lại sau.",
  serverPeopleTitle: "Người thật toàn hệ thống · {n}",
  thisIsYou: "Đây là bạn",
  addFriend: "+ Kết bạn",
  alreadyFriend: "Đã là bạn",
  requestSent: "Đã gửi",
  home: "Trang cá nhân",
  messageAction: "Nhắn tin",
  publishDemand: "Đăng nhu cầu",
  humanProfile: "Trang người thật",
  viewProfile: "Xem trang",
  combo: "Tổ hợp cho bạn",
  sceneIdeas: "Gợi ý bối cảnh",
  continueSection: "Tiếp tục",
  nearbyScenes: "Bối cảnh gần đây",
  inviteMoment: "Khoảnh khắc hẹn",
  noActivity: "Chưa có hoạt động để hiển thị",
  privateHidden: "Bản ghi riêng tư không hiển thị",
  noPublicPosts: "Chưa có bản ghi công khai",
  whatSheCanDo: "Cô ấy có thể làm gì",
  reputation: "Uy tín và đánh giá",
  publicActivity: "Hoạt động công khai",
  relatedTheme: "Chủ đề liên quan",
  currentTheme: "Chủ đề hiện tại",
  currentAction: "Hành động hiện tại",
  canGoTogether: "Có thể đi cùng",
  currentScene: "Scene hiện tại",
  suitableScenes: "Bối cảnh phù hợp",
  nearbyNowVisible: "Gần đây · Đang hiển thị",
  map: "Bản đồ 〉",
  itemsCount: "{n} mục",
  draftProgress: "Bản nháp · đã điền {p}%",
  publishedWaiting: "Đã đăng · chờ ghép cặp",
  relationshipLoadFailed: "Tạm thời không tải được trạng thái bạn bè",
  loginToAddFriend: "Đăng nhập để kết bạn",
  noAccountYet: "{name} chưa có tài khoản, tạm thời không kết bạn được",
  becameFriends: "Đã là bạn bè · {name}",
  friendRequestSent: "Đã gửi lời mời kết bạn · {name}",
  cannotAddSelf: "Không thể tự kết bạn với chính mình",
  friendActionFailed: "Thao tác kết bạn thất bại, thử lại sau",
  friendLabelFriend: "Đã là bạn · {name}",
  friendLabelOutgoing: "Đã gửi lời mời tới {name}",
  friendLabelIncoming: "Chấp nhận lời mời của {name}",
  friendLabelAdd: "Kết bạn với {name}",
  adding: "Đang thêm…",
  addingShort: "Đang thêm",
  added: "✓ Đã thêm",
  acceptAdd: "Chấp nhận",
  addAction: "+ Thêm",
  foundPeople: "Tìm thấy {n} người thật",
  foundPeopleSub: "Chạm trang cá nhân để xem, + để kết bạn ngay.",
  notFoundQuery: "Không tìm thấy “{q}”",
  notFoundQuerySub: "Cả gợi ý cục bộ và toàn hệ thống đều không khớp. Đổi từ khóa, hoặc vào trang kết bạn để tìm chính xác bằng handle.",
  serverSearchFailedTitle: "Tìm kiếm toàn hệ thống thất bại",
  serverSearchFailedSub: "Có thể do mạng. Chạm thử lại bên dưới, hoặc đổi từ khóa.",
  joinAlready: "Bạn đã đăng ký rồi, không cần bấm lại",
  joinFull: "Đã đủ chỗ, lần sau đến sớm hơn nhé",
  joinGone: "Hoạt động không tồn tại hoặc đã kết thúc",
  sessionExpired: "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại",
  joinFailed: "Đăng ký thất bại, thử lại sau",
  loginToJoin: "Đăng nhập để đăng ký",
  networkError: "Lỗi mạng, kiểm tra kết nối rồi thử lại",
  pickActivityFirst: "Chọn một hoạt động trước",
  joinedWithCount: "Đã đăng ký · {n} người tham gia",
  modePhoto: "Chụp ảnh",
  modeCompanion: "Đi cùng",
  modeMeal: "Ăn uống",
  modeActivity: "Hoạt động",
  modeTrip: "Đi chơi",
  modeCreator: "Sáng tạo",
  modeTranslate: "Dịch",
  modeMedical: "Đi khám cùng",
  actionCoffeeMeal: "Cà phê / Ăn uống",
  actionActivityTogether: "Đi cùng hoạt động",
  actionTrip: "Đi chơi quanh đây",
  actionCreator: "Sáng tạo nội dung",
  aiRecommend: "AI gợi ý",
  aiRecommendSub: "Xem vì sao cô ấy phù hợp với bối cảnh hiện tại",
  aiGenerated: "Do AI tạo",
  viewProfileA11y: "Xem trang của {name}",
  messageToA11y: "Nhắn tin cho {name}",
  withPerson: "Cùng {name}",
  gridSub: "Chọn người · đặt giờ · ghép bối cảnh, một chạm ra ảnh hoặc lời mời",
  changeAllHint: "Đổi cả người, giờ, hoạt động và địa điểm",
  changeAllLabel: "Đổi cả nhóm",
  chainHint: "Mời trực tiếp: chạm ảnh để vào trang Scene và trò chuyện · Muốn chờ người tới: đăng nhu cầu để Tiểu Mỹ nhận",
  makeImage: "✦ Tạo ảnh",
  makeImageA11y: "Tạo ảnh",
  joinInProgress: "Đang đăng ký…",
  joinCta: "Đăng ký →",
  joinCtaA11y: "Đăng ký tham gia hoạt động",
  publishDemandA11y: "Đăng nhu cầu để Tiểu Mỹ đăng ký",
  choosePerson: "Chọn người đi cùng",
  chooseTime: "Chọn thời gian",
  chooseActivity: "Chọn hoạt động",
  choosePlace: "Chọn địa điểm",
  chooseA11y: "Chọn {name}",
  currentChoice: "Đang chọn",
  chooseSlot: "Chọn khung giờ",
  tilePersonSub: "Người đi cùng · chạm để đổi",
  tileTime: "Thời gian",
  tilePlace: "Địa điểm",
  oneDay: "1 ngày",
  postedToFeed: "Đã đăng lên bảng tin",
  loginToPost: "Vui lòng đăng nhập trước khi đăng (khách không thể đăng bài).",
  postFailed: "Đăng thất bại, vui lòng thử lại.",
  postToFeed: "Đăng lên bảng tin",
  posting: "Đang đăng…",
  inviteShared: "Đã chia sẻ lời mời",
  shareFailed: "Không mở được chia sẻ, vui lòng thử lại.",
  shareInvite: "Chia sẻ lời mời",
  sharing: "Đang chia sẻ…",
  shareInviteCta: "Chia sẻ lời mời →",
  backHome: "Về Trang chủ",
  backShort: "‹ Quay lại",
  nearbyRecommend: "Gợi ý gần đây",
  activityCount: "{n} hoạt động",
  viewPublicHistory: "Xem hoạt động công khai",
  availabilityUnknown: "Xem giờ trống",
  historyCount: "{n} hoạt động trước đây ›",
  relatedToRecommend: "Liên quan đến gợi ý hiện tại",
  viewFullScene: "Xem toàn bộ bối cảnh",
  viewSceneFallback: "Xem bối cảnh",
  sceneSuggestions: "Gợi ý bối cảnh",
  nearbySceneFallback: "Bối cảnh gần đây",
  viewSceneA11y: "Xem {name}",
  sceneTagFallback: "Bối cảnh đô thị gần đây",
  languageFromProfile: "Theo hồ sơ trang cá nhân",
  reviewSummaryEmpty: "Chưa có tóm tắt đánh giá công khai",
  trustLine: "★ {rating} · {rate}% đánh giá tốt · {n} hoạt động",
  sceneReason: "Giờ phù hợp, khoảng cách gần, hành động khớp chủ đề; bối cảnh chỉ là gợi ý gặp mặt, hai bên vẫn tự xác nhận.",
  actionTable: "Ghép bàn",
  actionInvite: "Mời",
  viewHumanProfileA11y: "Xem trang của {name}",
  icebreakerTitle: "{action} với {name}",
  closeIcebreaker: "Đóng bảng bắt chuyện",
  close: "Đóng",
  sendLineA11y: "Gửi: “{line}”",
  icebreakerLine1: "Tôi cũng ở gần đây, ghép bàn không?",
  icebreakerLine2: "Tình cờ đi ngang, ngồi cùng chút không?",
  greetLine1: "Hi~ thấy bạn nên ghé chào một tiếng 👋",
  greetLine2: "Chào bạn! Trang cá nhân của bạn thú vị ghê, làm quen nhé?",
  greetLine3: "Chào bạn cùng thành phố, kết bạn nhé~",
  greetLine4: "Hi, mình tò mò về những gì bạn chia sẻ, trò chuyện chút không?",
  greetLine5: "Ghé qua trang của bạn, để lại lời chào 😊",
  greetLine6: "Hi~ rảnh thì mình nói chuyện nhé",
  greetLine7: "Chào bạn, mình muốn làm quen bạn mới",
  greetLine8: "Hi! Hôm nay của bạn thế nào?",
  greetA11y: "Chào {name}",
  invited: "Đã mời",
  greetFailed: "Chưa gửi được lời chào, thử lại nhé",
  greetLoginFirst: "Đăng nhập để gửi lời chào",
  greetNoAccount: "{name} chưa có tài khoản, tạm thời chưa chào được",
  recombo: "Đã ghép lại một bộ mới",
  recomboSub: "Ghép lại theo giờ hiện tại và các Scene có sẵn gần đây.",
  swapPerson: "Đổi người",
  swapScene: "Đổi bối cảnh",
  swapTime: "Đổi giờ",
  swapActivity: "Đổi hoạt động",
  othersUnchanged: "3 ô còn lại giữ nguyên.",
  clarifyTimeQuestion: "Chiều hay tối?",
  afternoon: "Chiều",
  evening: "Tối",
  needTimeCondition: "Còn thiếu điều kiện về thời gian",
  needTimeConditionSub: "Xác nhận xong tôi cập nhật ngay, không vào trang chat.",
  timeToTonight: "Đổi giờ thành tối nay",
  activityToWalk: "Đổi hoạt động thành đi dạo / City Walk",
  coffeeCombo: "Đã ghép xong · Three Beans hợp để trò chuyện hơn",
  coffeeComboSub: "Bạn nhắc đến cà phê và trò chuyện thoải mái, nên tôi ưu tiên nơi yên tĩnh hơn, có chỗ cạnh cửa sổ.",
  searchingServer: "Đang tìm “{q}” trên toàn hệ thống…",
  searchingServerSub: "Gợi ý cục bộ không khớp, đang hỏi máy chủ.",
  imageNeedsChat: "Ảnh cần được gửi trong cuộc trò chuyện Proxy AI",
  notFoundQuerySub2: "Đổi từ khóa để tìm tiếp, hoặc chạm biểu tượng AI bên trái để vào hội thoại với mô hình.",
};

const EN: Messages = {
  title: "Real People",
  humanBadge: "Real",
  chipOnline: "Online",
  chipChinese: "Chinese",
  chipChatRoom: "Chat Room",
  kmUnit: "km",
  ridePrefix: "~",
  more: "More 〉",
  back: "Back",
  search: "Search",
  closeSearch: "Close search",
  searchPeople: "Search real people",
  searchPlaceholder: "Search name or bio",
  clearSearch: "Clear search",
  emptyFiltered: "No one matches the current filters — try loosening them.",
  distanceUnknown: "Distance unknown",
  offline: "Offline",
  distanceChipA11y: "Within {km}km, tap to change radius",
  distanceTierA11y: "Within {km}km",
  selectedSuffix: ", selected",
  filterChipA11y: "Filter {label}",
  createRoomA11y: "Create chat room",
  roomsCreateTitle: "Open a room, find people to hang out",
  roomsCreateDesc: "Pick a scene → pick people → done in 3s",
  roomsOngoing: "Ongoing rooms",
  roomsEmpty: "No rooms yet — open one",
  roomsLoadFailed: "Couldn't load rooms — tap to retry",
  roomsLoading: "Loading rooms…",
  roomsLoginFirst: "Log in to open and enter rooms",
  roomEnter: "Enter",
  roomMembers: "{n} people",
  roomOpenA11y: "Enter room {name}",
  languageChipA11y: "Language: {name}, tap to change",
  language: "Language",
  selectLanguage: "Select Language",
  cancel: "Cancel",
  retry: "Retry",
  retryServerSearch: "Retry site-wide search",
  serverSearchFailed: "Site-wide search failed, try again later.",
  serverPeopleTitle: "Real people site-wide · {n}",
  thisIsYou: "This is you",
  addFriend: "+ Add friend",
  alreadyFriend: "Already friends",
  requestSent: "Sent",
  home: "Profile",
  messageAction: "Message",
  publishDemand: "Post a request",
  humanProfile: "Real profile",
  viewProfile: "View profile",
  combo: "Picked for you",
  sceneIdeas: "Scene ideas",
  continueSection: "Continue",
  nearbyScenes: "Nearby scenes",
  inviteMoment: "Invite moment",
  noActivity: "No activity to show yet",
  privateHidden: "Private records are not shown",
  noPublicPosts: "No public records yet",
  whatSheCanDo: "What she can do",
  reputation: "Reputation and reviews",
  publicActivity: "Public activity",
  relatedTheme: "Related theme",
  currentTheme: "Current theme",
  currentAction: "Current action",
  canGoTogether: "Can go together",
  currentScene: "Current Scene",
  suitableScenes: "Suitable scenes",
  nearbyNowVisible: "Nearby · Visible now",
  map: "Map 〉",
  itemsCount: "{n} items",
  draftProgress: "Draft · {p}% filled",
  publishedWaiting: "Published · waiting to match",
  relationshipLoadFailed: "Couldn't load friend status",
  loginToAddFriend: "Sign in to add friends",
  noAccountYet: "{name} has no account yet, so you can't add them",
  becameFriends: "Now friends · {name}",
  friendRequestSent: "Friend request sent · {name}",
  cannotAddSelf: "You can't add yourself",
  friendActionFailed: "Friend action failed, try again later",
  friendLabelFriend: "Friends with {name}",
  friendLabelOutgoing: "Requested {name}",
  friendLabelIncoming: "Accept {name}'s friend request",
  friendLabelAdd: "Add {name} as friend",
  adding: "Adding…",
  addingShort: "Adding",
  added: "✓ Added",
  acceptAdd: "Accept",
  addAction: "+ Add",
  foundPeople: "Found {n} real people",
  foundPeopleSub: "Tap a profile to view, + to add as a friend.",
  notFoundQuery: "No results for “{q}”",
  notFoundQuerySub: "Neither local picks nor the global search matched. Try another keyword, or use the add-friends page to search by handle.",
  serverSearchFailedTitle: "Global search failed",
  serverSearchFailedSub: "The network may be down. Tap retry below, or try another keyword.",
  joinAlready: "You already joined — no need to tap again",
  joinFull: "It's full — come earlier next time",
  joinGone: "This activity no longer exists or has ended",
  sessionExpired: "Your session expired — please sign in again",
  joinFailed: "Sign-up failed, try again later",
  loginToJoin: "Sign in to join",
  networkError: "Network error — check your connection and retry",
  pickActivityFirst: "Pick an activity first",
  joinedWithCount: "Joined · {n} attending",
  modePhoto: "Photo",
  modeCompanion: "Companion",
  modeMeal: "Dining",
  modeActivity: "Activity",
  modeTrip: "Outing",
  modeCreator: "Create",
  modeTranslate: "Translate",
  modeMedical: "Clinic escort",
  actionCoffeeMeal: "Coffee / Meal",
  actionActivityTogether: "Activity together",
  actionTrip: "Nearby trip",
  actionCreator: "Content creation",
  aiRecommend: "AI picks",
  aiRecommendSub: "See why she fits the current scene",
  aiGenerated: "AI generated",
  viewProfileA11y: "View {name}'s profile",
  messageToA11y: "Message {name}",
  withPerson: "With {name}",
  gridSub: "Pick a person · set a time · match a scene, then generate an image or invite in one tap",
  changeAllHint: "Change the person, time, activity and place together",
  changeAllLabel: "Shuffle all",
  chainHint: "Invite directly: tap the avatar to chat on her Scene page · Or wait: post a request and let 小美 take it",
  makeImage: "✦ Make image",
  makeImageA11y: "Make image",
  joinInProgress: "Joining…",
  joinCta: "Join →",
  joinCtaA11y: "Join the activity",
  publishDemandA11y: "Post a request and let 小美 sign up",
  choosePerson: "Choose who to go with",
  chooseTime: "Choose a time",
  chooseActivity: "Choose an activity",
  choosePlace: "Choose a place",
  chooseA11y: "Choose {name}",
  currentChoice: "Selected",
  chooseSlot: "Choose a slot",
  tilePersonSub: "Companion · tap to change",
  tileTime: "Time",
  tilePlace: "Place",
  oneDay: "1 day",
  postedToFeed: "Posted to feed",
  loginToPost: "Please sign in before posting (guests can't post).",
  postFailed: "Post failed, please try again.",
  postToFeed: "Post to feed",
  posting: "Posting…",
  inviteShared: "Invite shared",
  shareFailed: "Couldn't open sharing, please try again.",
  shareInvite: "Share invite",
  sharing: "Sharing…",
  shareInviteCta: "Share invite →",
  backHome: "Back to Home",
  backShort: "‹ Back",
  nearbyRecommend: "Nearby picks",
  activityCount: "{n} activities",
  viewPublicHistory: "View public history",
  availabilityUnknown: "View available times",
  historyCount: "{n} past activities ›",
  relatedToRecommend: "How it relates to this pick",
  viewFullScene: "View the full scene",
  viewSceneFallback: "View scene",
  sceneSuggestions: "Scene ideas",
  nearbySceneFallback: "Nearby scene",
  viewSceneA11y: "View {name}",
  sceneTagFallback: "Nearby urban scene",
  languageFromProfile: "See the profile for details",
  reviewSummaryEmpty: "No public review summary yet",
  trustLine: "★ {rating} · {rate}% positive · {n} activities",
  sceneReason: "Times line up and the distance is short, and the activity matches the theme; a scene is only a suggestion — both sides still confirm.",
  actionTable: "Share a table",
  actionInvite: "Invite",
  viewHumanProfileA11y: "View {name}'s profile",
  icebreakerTitle: "{action} with {name}",
  closeIcebreaker: "Close the icebreaker panel",
  close: "Close",
  sendLineA11y: "Send: “{line}”",
  icebreakerLine1: "I'm nearby too — share a table?",
  icebreakerLine2: "Just passing by — want to sit together?",
  greetLine1: "Hi~ came across you, just saying hello 👋",
  greetLine2: "Hi! Your profile looks interesting — want to connect?",
  greetLine3: "Hey, fellow local! Let's be friends~",
  greetLine4: "Hi, curious about what you share — up for a chat?",
  greetLine5: "Passing by your profile, leaving a hello 😊",
  greetLine6: "Hi~ happy to chat whenever you're free",
  greetLine7: "Hello, I'd love to meet new friends",
  greetLine8: "Hi! How's your day going?",
  greetA11y: "Say hi to {name}",
  invited: "Invited",
  greetFailed: "Couldn't send your hi — tap to try again",
  greetLoginFirst: "Log in to say hi",
  greetNoAccount: "{name} has no account yet, so a hi can't be sent",
  recombo: "Put together a new set",
  recomboSub: "Recombined from the current time and the Scenes available nearby.",
  swapPerson: "Swapped the person",
  swapScene: "Swapped the scene",
  swapTime: "Swapped the time",
  swapActivity: "Swapped the activity",
  othersUnchanged: "The other 3 stay as they are.",
  clarifyTimeQuestion: "Afternoon or evening?",
  afternoon: "Afternoon",
  evening: "Evening",
  needTimeCondition: "One more thing: the time",
  needTimeConditionSub: "Once you confirm I'll update it right away — no chat page.",
  timeToTonight: "Time changed to tonight",
  activityToWalk: "Activity changed to a walk / City Walk",
  coffeeCombo: "All set · Three Beans is better for talking",
  coffeeComboSub: "You mentioned coffee and easy conversation, so I favoured a quieter spot with window seats.",
  searchingServer: "Searching everywhere for “{q}”…",
  searchingServerSub: "Local picks missed — asking the server.",
  imageNeedsChat: "Images need to be sent in the Proxy AI chat",
  notFoundQuerySub2: "Try another keyword, or tap the AI mark on the left to open a model chat.",
};

const LO: Messages = {
  title: "ຄົນແທ້ແນະນຳ",
  humanBadge: "ຄົນແທ້",
  chipOnline: "ອອນລາຍ",
  chipChinese: "ພາສາຈີນ",
  chipChatRoom: "ຫ້ອງແຊັດ",
  kmUnit: "ກມ",
  ridePrefix: "~",
  more: "ເພີ່ມເຕີມ 〉",
  back: "ກັບຄືນ",
  search: "ຄົ້ນຫາ",
  closeSearch: "ປິດການຄົ້ນຫາ",
  searchPeople: "ຄົ້ນຫາຄົນແທ້",
  searchPlaceholder: "ຄົ້ນຫາຊື່ ຫຼື ແນະນຳ",
  clearSearch: "ລຶບການຄົ້ນຫາ",
  emptyFiltered: "ບໍ່ມີໃຜຕາມຕົວກອງ, ລອງຜ່ອນເງື່ອນໄຂ.",
  distanceUnknown: "ບໍ່ຮູ້ໄລຍະທາງ",
  offline: "ອອບລາຍ",
  distanceChipA11y: "ພາຍໃນ {km}km, ແຕະເພື່ອປ່ຽນລັດສະໝີ",
  distanceTierA11y: "ພາຍໃນ {km}km",
  selectedSuffix: ", ເລືອກແລ້ວ",
  filterChipA11y: "ກອງ {label}",
  createRoomA11y: "ສ້າງຫ້ອງແຊັດ",
  roomsCreateTitle: "ເປີດຫ້ອງ ຊວນຄົນມາຫຼິ້ນນຳກັນ",
  roomsCreateDesc: "ເລືອກສາກ → ເລືອກຄົນ → 3 ວິນາທີກໍແລ້ວ",
  roomsOngoing: "ຫ້ອງທີ່ກຳລັງດຳເນີນ",
  roomsEmpty: "ທ່ານຍັງບໍ່ມີຫ້ອງ, ເປີດຫ້ອງໃໝ່ເລີຍ",
  roomsLoadFailed: "ໂຫຼດຫ້ອງບໍ່ໄດ້, ແຕະເພື່ອລອງໃໝ່",
  roomsLoading: "ກຳລັງໂຫຼດຫ້ອງ…",
  roomsLoginFirst: "ເຂົ້າສູ່ລະບົບເພື່ອເປີດ ແລະ ເຂົ້າຫ້ອງ",
  roomEnter: "ເຂົ້າ",
  roomMembers: "{n} ຄົນ",
  roomOpenA11y: "ເຂົ້າຫ້ອງ {name}",
  languageChipA11y: "ພາສາ: {name}, ແຕະເພື່ອປ່ຽນ",
  language: "ພາສາ",
  selectLanguage: "ເລືອກພາສາ",
  cancel: "ຍົກເລິກ",
  retry: "ລອງໃໝ່",
  retryServerSearch: "ລອງຄົ້ນຫາທັງໝົດອີກຄັ້ງ",
  serverSearchFailed: "ຄົ້ນຫາທັງໝົດລົ້ມເຫຼວ, ລອງໃໝ່ພາຍຫຼັງ.",
  serverPeopleTitle: "ຄົນແທ້ທັງໝົດ · {n}",
  thisIsYou: "ນີ້ແມ່ນເຈົ້າ",
  addFriend: "+ ເພີ່ມໝູ່",
  alreadyFriend: "ເປັນໝູ່ແລ້ວ",
  requestSent: "ສົ່ງແລ້ວ",
  home: "ໜ້າໂປຣໄຟລ໌",
  messageAction: "ສົ່ງຂໍ້ຄວາມ",
  publishDemand: "ລົງປະກາດຄວາມຕ້ອງການ",
  humanProfile: "ໜ້າຄົນແທ້",
  viewProfile: "ເບິ່ງໜ້າໂປຣໄຟລ໌",
  combo: "ຈັດຊຸດໃຫ້ເຈົ້າ",
  sceneIdeas: "ແນະນຳສະຖານທີ່",
  continueSection: "ສືບຕໍ່",
  nearbyScenes: "ສະຖານທີ່ໃກ້ຄຽງ",
  inviteMoment: "ຊ່ວງເວລາເຊີນ",
  noActivity: "ຍັງບໍ່ມີກິດຈະກຳໃຫ້ສະແດງ",
  privateHidden: "ບັນທຶກສ່ວນຕົວບໍ່ສະແດງ",
  noPublicPosts: "ຍັງບໍ່ມີບັນທຶກສາທາລະນະ",
  whatSheCanDo: "ລາວເຮັດຫຍັງໄດ້ແດ່",
  reputation: "ຊື່ສຽງແລະການປະເມີນ",
  publicActivity: "ກິດຈະກຳສາທາລະນະ",
  relatedTheme: "ຫົວຂໍ້ທີ່ກ່ຽວຂ້ອງ",
  currentTheme: "ຫົວຂໍ້ປັດຈຸບັນ",
  currentAction: "ການກະທຳປັດຈຸບັນ",
  canGoTogether: "ໄປນຳກັນໄດ້",
  currentScene: "Scene ປັດຈຸບັນ",
  suitableScenes: "ສະຖານທີ່ເໝາະສົມ",
  nearbyNowVisible: "ໃກ້ຄຽງ · ເຫັນໄດ້ຕອນນີ້",
  map: "ແຜນທີ່ 〉",
  itemsCount: "{n} ລາຍການ",
  draftProgress: "ຮ່າງ · ຕື່ມແລ້ວ {p}%",
  publishedWaiting: "ເຜີຍແຜ່ແລ້ວ · ລໍຖ້າຈັບຄູ່",
  relationshipLoadFailed: "ຍັງໂຫລດສະຖານະໝູ່ບໍ່ໄດ້",
  loginToAddFriend: "ເຂົ້າສູ່ລະບົບເພື່ອເພີ່ມໝູ່",
  noAccountYet: "{name} ຍັງບໍ່ມີບັນຊີ ເພີ່ມໝູ່ບໍ່ໄດ້",
  becameFriends: "ເປັນໝູ່ແລ້ວ · {name}",
  friendRequestSent: "ສົ່ງຄຳຂໍເປັນໝູ່ແລ້ວ · {name}",
  cannotAddSelf: "ເພີ່ມໂຕເອງບໍ່ໄດ້",
  friendActionFailed: "ດຳເນີນການໝູ່ລົ້ມເຫຼວ ລອງໃໝ່ພາຍຫຼັງ",
  friendLabelFriend: "ເປັນໝູ່ກັບ {name}",
  friendLabelOutgoing: "ຂໍເປັນໝູ່ກັບ {name} ແລ້ວ",
  friendLabelIncoming: "ຮັບຄຳຂໍເປັນໝູ່ຈາກ {name}",
  friendLabelAdd: "ເພີ່ມ {name} ເປັນໝູ່",
  adding: "ກຳລັງເພີ່ມ…",
  addingShort: "ກຳລັງເພີ່ມ",
  added: "✓ ເພີ່ມແລ້ວ",
  acceptAdd: "ຮັບ",
  addAction: "+ ເພີ່ມ",
  foundPeople: "ພົບ {n} ຄົນແທ້",
  foundPeopleSub: "ແຕະໜ້າໂປຣໄຟລ໌ເພື່ອເບິ່ງ + ເພື່ອເພີ່ມໝູ່",
  notFoundQuery: "ບໍ່ພົບ “{q}”",
  notFoundQuerySub: "ທັງການແນະນຳທ້ອງຖິ່ນ ແລະ ທັງໝົດບໍ່ພົບ. ລອງຄຳອື່ນ ຫຼື ໄປໜ້າເພີ່ມໝູ່ເພື່ອຄົ້ນຫາດ້ວຍ handle",
  serverSearchFailedTitle: "ຄົ້ນຫາທັງໝົດລົ້ມເຫຼວ",
  serverSearchFailedSub: "ເຄືອຂ່າຍອາດມີບັນຫາ ແຕະລອງໃໝ່ຂ້າງລຸ່ມ ຫຼື ລອງຄຳອື່ນ",
  joinAlready: "ທ່ານລົງທະບຽນແລ້ວ ບໍ່ຕ້ອງແຕະອີກ",
  joinFull: "ເຕັມແລ້ວ ຄັ້ງໜ້າມາໄວກວ່າ",
  joinGone: "ກິດຈະກຳບໍ່ມີ ຫຼື ສິ້ນສຸດແລ້ວ",
  sessionExpired: "ເຊສຊັນໝົດອາຍຸ ກະລຸນາເຂົ້າສູ່ລະບົບອີກຄັ້ງ",
  joinFailed: "ລົງທະບຽນລົ້ມເຫຼວ ລອງໃໝ່ພາຍຫຼັງ",
  loginToJoin: "ເຂົ້າສູ່ລະບົບເພື່ອລົງທະບຽນ",
  networkError: "ເຄືອຂ່າຍຜິດພາດ ກວດການເຊື່ອມຕໍ່ແລ້ວລອງໃໝ່",
  pickActivityFirst: "ເລືອກກິດຈະກຳກ່ອນ",
  joinedWithCount: "ລົງທະບຽນແລ້ວ · {n} ຄົນເຂົ້າຮ່ວມ",
  modePhoto: "ຖ່າຍຮູບ",
  modeCompanion: "ໄປນຳ",
  modeMeal: "ກິນເຂົ້າ",
  modeActivity: "ກິດຈະກຳ",
  modeTrip: "ອອກໄປທ່ຽວ",
  modeCreator: "ສ້າງສັນ",
  modeTranslate: "ແປ",
  modeMedical: "ໄປໂຮງໝໍນຳ",
  actionCoffeeMeal: "ກາເຟ / ອາຫານ",
  actionActivityTogether: "ໄປກິດຈະກຳນຳກັນ",
  actionTrip: "ທ່ຽວອ້ອມຂ້າງ",
  actionCreator: "ສ້າງເນື້ອຫາ",
  aiRecommend: "AI ແນະນຳ",
  aiRecommendSub: "ເບິ່ງວ່າເປັນຫຍັງນາງຈຶ່ງເໝາະກັບສະຖານະການນີ້",
  aiGenerated: "AI ສ້າງ",
  viewProfileA11y: "ເບິ່ງໜ້າ {name}",
  messageToA11y: "ສົ່ງຂໍ້ຄວາມຫາ {name}",
  withPerson: "ກັບ {name}",
  gridSub: "ເລືອກຄົນ · ຕັ້ງເວລາ · ຈັບຄູ່ສະຖານະການ ແລ້ວສ້າງຮູບ ຫຼື ເຊີນໃນແຕະດຽວ",
  changeAllHint: "ປ່ຽນຄົນ ເວລາ ກິດຈະກຳ ແລະ ສະຖານທີ່ພ້ອມກັນ",
  changeAllLabel: "ປ່ຽນທັງໝົດ",
  chainHint: "ເຊີນໂດຍກົງ: ແຕະຮູບເພື່ອເຂົ້າໜ້າ Scene ແລ້ວລົມ · ຫຼື ລໍຖ້າ: ລົງປະກາດຄວາມຕ້ອງການໃຫ້ 小美 ຮັບ",
  makeImage: "✦ ສ້າງຮູບ",
  makeImageA11y: "ສ້າງຮູບ",
  joinInProgress: "ກຳລັງລົງທະບຽນ…",
  joinCta: "ລົງທະບຽນ →",
  joinCtaA11y: "ລົງທະບຽນເຂົ້າຮ່ວມກິດຈະກຳ",
  publishDemandA11y: "ລົງປະກາດຄວາມຕ້ອງການໃຫ້ 小美 ລົງທະບຽນ",
  choosePerson: "ເລືອກຄົນໄປນຳ",
  chooseTime: "ເລືອກເວລາ",
  chooseActivity: "ເລືອກກິດຈະກຳ",
  choosePlace: "ເລືອກສະຖານທີ່",
  chooseA11y: "ເລືອກ {name}",
  currentChoice: "ເລືອກແລ້ວ",
  chooseSlot: "ເລືອກຊ່ວງເວລາ",
  tilePersonSub: "ຄົນໄປນຳ · ແຕະເພື່ອປ່ຽນ",
  tileTime: "ເວລາ",
  tilePlace: "ສະຖານທີ່",
  oneDay: "1 ວັນ",
  postedToFeed: "ເຜີຍແຜ່ລົງຟີດແລ້ວ",
  loginToPost: "ກະລຸນາເຂົ້າສູ່ລະບົບກ່ອນເຜີຍແຜ່ (ແຂກເຜີຍແຜ່ບໍ່ໄດ້).",
  postFailed: "ເຜີຍແຜ່ລົ້ມເຫຼວ ກະລຸນາລອງໃໝ່",
  postToFeed: "ເຜີຍແຜ່ລົງຟີດ",
  posting: "ກຳລັງເຜີຍແຜ່…",
  inviteShared: "ແບ່ງປັນຄຳເຊີນແລ້ວ",
  shareFailed: "ເປີດການແບ່ງປັນບໍ່ໄດ້ ກະລຸນາລອງໃໝ່",
  shareInvite: "ແບ່ງປັນຄຳເຊີນ",
  sharing: "ກຳລັງແບ່ງປັນ…",
  shareInviteCta: "ແບ່ງປັນຄຳເຊີນ →",
  backHome: "ກັບໄປໜ້າຫຼັກ",
  backShort: "‹ ກັບ",
  nearbyRecommend: "ແນະນຳໃກ້ໆ",
  activityCount: "{n} ກິດຈະກຳ",
  viewPublicHistory: "ເບິ່ງປະຫວັດສາທາລະນະ",
  availabilityUnknown: "ເບິ່ງເວລາວ່າງ",
  historyCount: "{n} ກິດຈະກຳຜ່ານມາ ›",
  relatedToRecommend: "ກ່ຽວຂ້ອງກັບການແນະນຳນີ້",
  viewFullScene: "ເບິ່ງສະຖານະການທັງໝົດ",
  viewSceneFallback: "ເບິ່ງສະຖານະການ",
  sceneSuggestions: "ຄຳແນະນຳສະຖານະການ",
  nearbySceneFallback: "ສະຖານະການໃກ້ໆ",
  viewSceneA11y: "ເບິ່ງ {name}",
  sceneTagFallback: "ສະຖານະການເມືອງໃກ້ໆ",
  languageFromProfile: "ເບິ່ງຕາມໂປຣໄຟລ໌",
  reviewSummaryEmpty: "ຍັງບໍ່ມີສະຫຼຸບຄຳຕິຊົມ",
  trustLine: "★ {rating} · {rate}% ຄຳຕິຊົມດີ · {n} ກິດຈະກຳ",
  sceneReason: "ເວລາເໝາະ ໄກ້ກັນ ແລະ ກິດຈະກຳກົງກັບຫົວຂໍ້; ສະຖານະການເປັນພຽງຄຳແນະນຳ ທັງສອງຝ່າຍຢືນຢັນເອງ",
  actionTable: "ນັ່ງໂຕະນຳກັນ",
  actionInvite: "ເຊີນ",
  viewHumanProfileA11y: "ເບິ່ງໜ້າ {name}",
  icebreakerTitle: "{action} ກັບ {name}",
  closeIcebreaker: "ປິດແຜງເລີ່ມບົດສົນທະນາ",
  close: "ປິດ",
  sendLineA11y: "ສົ່ງ: “{line}”",
  icebreakerLine1: "ຂ້ອຍກໍຢູ່ໃກ້ໆ ນັ່ງໂຕະນຳກັນບໍ?",
  icebreakerLine2: "ບັງເອີນຜ່ານມາ ນັ່ງນຳກັນບໍ?",
  greetLine1: "ສະບາຍດີ~ ເຫັນເຈົ້າເລີຍມາທັກທາຍ 👋",
  greetLine2: "ສະບາຍດີ! ໜ້າໂປຣໄຟລ໌ຂອງເຈົ້າໜ້າສົນໃຈຫຼາຍ, ຮູ້ຈັກກັນບໍ່?",
  greetLine3: "ສະບາຍດີ ຄົນເມືອງດຽວກັນ, ເປັນໝູ່ກັນເດີ~",
  greetLine4: "ສະບາຍດີ, ສົນໃຈສິ່ງທີ່ເຈົ້າແບ່ງປັນ, ລົມກັນບໍ່?",
  greetLine5: "ຜ່ານມາເຫັນໜ້າຂອງເຈົ້າ, ຂໍທັກທາຍແດ່ 😊",
  greetLine6: "ສະບາຍດີ~ ຫວ່າງເມື່ອໃດລົມກັນໄດ້ເດີ",
  greetLine7: "ສະບາຍດີ, ຢາກຮູ້ຈັກໝູ່ໃໝ່",
  greetLine8: "ສະບາຍດີ! ມື້ນີ້ເປັນແນວໃດແດ່?",
  greetA11y: "ທັກທາຍ {name}",
  invited: "ເຊີນແລ້ວ",
  greetFailed: "ສົ່ງຄຳທັກທາຍບໍ່ໄດ້, ລອງໃໝ່ອີກຄັ້ງ",
  greetLoginFirst: "ເຂົ້າສູ່ລະບົບເພື່ອທັກທາຍ",
  greetNoAccount: "{name} ຍັງບໍ່ມີບັນຊີ, ຍັງທັກທາຍບໍ່ໄດ້",
  recombo: "ຈັບຄູ່ຊຸດໃໝ່ແລ້ວ",
  recomboSub: "ຈັບຄູ່ໃໝ່ຕາມເວລາປັດຈຸບັນ ແລະ Scene ທີ່ມີໃກ້ໆ",
  swapPerson: "ປ່ຽນຄົນ",
  swapScene: "ປ່ຽນສະຖານະການ",
  swapTime: "ປ່ຽນເວລາ",
  swapActivity: "ປ່ຽນກິດຈະກຳ",
  othersUnchanged: "3 ຊ່ອງອື່ນຄົງເດີມ",
  clarifyTimeQuestion: "ບ່າຍ ຫຼື ແລງ?",
  afternoon: "ບ່າຍ",
  evening: "ແລງ",
  needTimeCondition: "ຍັງຂາດເງື່ອນໄຂເວລາ",
  needTimeConditionSub: "ຢືນຢັນແລ້ວຂ້ອຍຈະອັບເດດເລີຍ ບໍ່ເຂົ້າໜ້າແຊັດ",
  timeToTonight: "ປ່ຽນເວລາເປັນຄືນນີ້",
  activityToWalk: "ປ່ຽນກິດຈະກຳເປັນຍ່າງຫຼິ້ນ / City Walk",
  coffeeCombo: "ຈັບຄູ່ແລ້ວ · Three Beans ເໝາະກັບການລົມກວ່າ",
  coffeeComboSub: "ທ່ານເວົ້າເຖິງກາເຟ ແລະ ການລົມສະບາຍໆ ຈຶ່ງເລືອກບ່ອນງຽບ ທີ່ມີໂຕະຂ້າງປ່ອງຕ່າງ",
  searchingServer: "ກຳລັງຄົ້ນຫາ “{q}” ທັງໝົດ…",
  searchingServerSub: "ການແນະນຳທ້ອງຖິ່ນບໍ່ພົບ ກຳລັງຖາມເຊີບເວີ",
  imageNeedsChat: "ຮູບຕ້ອງສົ່ງໃນການສົນທະນາ Proxy AI",
  notFoundQuerySub2: "ລອງຄຳອື່ນເພື່ອຄົ້ນຫາຕໍ່ ຫຼື ແຕະໄອຄອນ AI ທາງຊ້າຍເພື່ອເຂົ້າສົນທະນາກັບໂມເດລ",
};

const KO: Messages = {
  title: "실사용자 추천",
  humanBadge: "실사용자",
  chipOnline: "온라인",
  chipChinese: "중국어",
  chipChatRoom: "채팅방",
  kmUnit: "km 이내",
  ridePrefix: "약 ",
  more: "더보기 〉",
  back: "뒤로",
  search: "검색",
  closeSearch: "검색 닫기",
  searchPeople: "실사용자 검색",
  searchPlaceholder: "이름 또는 소개 검색",
  clearSearch: "검색 지우기",
  emptyFiltered: "현재 조건에 맞는 사람이 없습니다. 조건을 완화해 보세요.",
  distanceUnknown: "거리 미상",
  offline: "오프라인",
  distanceChipA11y: "{km}km 이내, 탭하여 반경 변경",
  distanceTierA11y: "{km}km 이내",
  selectedSuffix: ", 선택됨",
  filterChipA11y: "필터 {label}",
  createRoomA11y: "채팅방 만들기",
  roomsCreateTitle: "방을 열고 함께할 사람 찾기",
  roomsCreateDesc: "장면 선택 → 사람 선택 → 3초면 끝",
  roomsOngoing: "진행 중인 방",
  roomsEmpty: "아직 방이 없어요. 하나 열어 보세요",
  roomsLoadFailed: "방을 불러오지 못했어요. 눌러서 다시 시도",
  roomsLoading: "방 불러오는 중…",
  roomsLoginFirst: "로그인하면 방을 열고 들어갈 수 있어요",
  roomEnter: "입장",
  roomMembers: "{n}명",
  roomOpenA11y: "{name} 방 입장",
  languageChipA11y: "언어: {name}, 눌러서 변경",
  language: "언어",
  selectLanguage: "언어 선택",
  cancel: "취소",
  retry: "다시 시도",
  retryServerSearch: "전체 검색 다시 시도",
  serverSearchFailed: "전체 검색에 실패했습니다. 나중에 다시 시도하세요.",
  serverPeopleTitle: "전체 실사용자 · {n}명",
  thisIsYou: "본인입니다",
  addFriend: "+ 친구 추가",
  alreadyFriend: "이미 친구",
  requestSent: "보냄",
  home: "프로필",
  messageAction: "메시지",
  publishDemand: "요청 올리기",
  humanProfile: "실사용자 프로필",
  viewProfile: "프로필 보기",
  combo: "맞춤 조합",
  sceneIdeas: "장면 제안",
  continueSection: "계속하기",
  nearbyScenes: "주변 장면",
  inviteMoment: "초대 모먼트",
  noActivity: "아직 표시할 활동이 없습니다",
  privateHidden: "비공개 기록은 표시되지 않습니다",
  noPublicPosts: "공개 기록이 없습니다",
  whatSheCanDo: "무엇을 할 수 있나요",
  reputation: "평판과 평가",
  publicActivity: "공개 활동",
  relatedTheme: "관련 주제",
  currentTheme: "현재 주제",
  currentAction: "현재 활동",
  canGoTogether: "함께 갈 수 있음",
  currentScene: "현재 Scene",
  suitableScenes: "어울리는 장면",
  nearbyNowVisible: "주변 · 지금 표시됨",
  map: "지도 〉",
  itemsCount: "{n}개",
  draftProgress: "초안 · {p}% 작성",
  publishedWaiting: "게시됨 · 매칭 대기",
  relationshipLoadFailed: "친구 상태를 불러오지 못했습니다",
  loginToAddFriend: "로그인 후 친구를 추가할 수 있어요",
  noAccountYet: "{name}님은 아직 계정이 없어 친구로 추가할 수 없어요",
  becameFriends: "친구가 되었어요 · {name}",
  friendRequestSent: "친구 요청을 보냈어요 · {name}",
  cannotAddSelf: "자기 자신은 추가할 수 없어요",
  friendActionFailed: "친구 작업에 실패했어요. 나중에 다시 시도하세요",
  friendLabelFriend: "{name}님과 친구",
  friendLabelOutgoing: "{name}님에게 요청함",
  friendLabelIncoming: "{name}님의 친구 요청 수락",
  friendLabelAdd: "{name}님을 친구로 추가",
  adding: "추가 중…",
  addingShort: "추가 중",
  added: "✓ 추가됨",
  acceptAdd: "수락",
  addAction: "+ 추가",
  foundPeople: "{n}명의 실사용자를 찾았어요",
  foundPeopleSub: "프로필을 눌러 보고 + 로 바로 친구 추가하세요.",
  notFoundQuery: "“{q}” 결과가 없어요",
  notFoundQuerySub: "로컬 추천과 전체 검색 모두 결과가 없어요. 다른 키워드를 쓰거나 친구 추가 페이지에서 handle로 정확히 찾아보세요.",
  serverSearchFailedTitle: "전체 검색 실패",
  serverSearchFailedSub: "네트워크 문제일 수 있어요. 아래 재시도를 누르거나 다른 키워드를 써보세요.",
  joinAlready: "이미 신청했어요. 다시 누를 필요 없어요",
  joinFull: "정원이 찼어요. 다음엔 일찍 오세요",
  joinGone: "이 활동은 없거나 이미 끝났어요",
  sessionExpired: "로그인이 만료됐어요. 다시 로그인해 주세요",
  joinFailed: "신청에 실패했어요. 나중에 다시 시도하세요",
  loginToJoin: "로그인 후 신청할 수 있어요",
  networkError: "네트워크 오류예요. 연결을 확인하고 다시 시도하세요",
  pickActivityFirst: "먼저 활동을 선택하세요",
  joinedWithCount: "신청 완료 · {n}명 참가",
  modePhoto: "사진",
  modeCompanion: "동행",
  modeMeal: "식사",
  modeActivity: "활동",
  modeTrip: "나들이",
  modeCreator: "창작",
  modeTranslate: "번역",
  modeMedical: "병원 동행",
  actionCoffeeMeal: "커피 / 식사",
  actionActivityTogether: "활동 동행",
  actionTrip: "근교 나들이",
  actionCreator: "콘텐츠 창작",
  aiRecommend: "AI 추천",
  aiRecommendSub: "그녀가 지금 상황에 왜 맞는지 보세요",
  aiGenerated: "AI 생성",
  viewProfileA11y: "{name}님의 프로필 보기",
  messageToA11y: "{name}님에게 메시지 보내기",
  withPerson: "{name}님과",
  gridSub: "사람 · 시간 · 장면을 고르고 한 번에 이미지를 만들거나 초대하세요",
  changeAllHint: "사람, 시간, 활동, 장소를 한꺼번에 바꿔요",
  changeAllLabel: "전체 바꾸기",
  chainHint: "바로 초대하기: 아바타를 눌러 Scene 페이지에서 대화 · 기다리려면: 요청을 올려 小美가 수락하게 하세요",
  makeImage: "✦ 이미지 생성",
  makeImageA11y: "이미지 생성",
  joinInProgress: "신청 중…",
  joinCta: "신청 →",
  joinCtaA11y: "활동 참가 신청",
  publishDemandA11y: "요청을 올려 小美가 신청하게 하세요",
  choosePerson: "함께 갈 사람 선택",
  chooseTime: "시간 선택",
  chooseActivity: "활동 선택",
  choosePlace: "장소 선택",
  chooseA11y: "{name} 선택",
  currentChoice: "선택됨",
  chooseSlot: "시간대 선택",
  tilePersonSub: "함께 갈 사람 · 눌러 변경",
  tileTime: "시간",
  tilePlace: "장소",
  oneDay: "1일",
  postedToFeed: "피드에 게시했어요",
  loginToPost: "게시하려면 먼저 로그인해 주세요 (게스트는 게시할 수 없어요).",
  postFailed: "게시에 실패했어요. 다시 시도해 주세요.",
  postToFeed: "피드에 게시",
  posting: "게시 중…",
  inviteShared: "초대를 공유했어요",
  shareFailed: "공유를 열지 못했어요. 다시 시도해 주세요.",
  shareInvite: "초대 공유",
  sharing: "공유 중…",
  shareInviteCta: "초대 공유 →",
  backHome: "홈으로 돌아가기",
  backShort: "‹ 뒤로",
  nearbyRecommend: "근처 추천",
  activityCount: "활동 {n}회",
  viewPublicHistory: "공개 활동 보기",
  availabilityUnknown: "가능한 시간 보기",
  historyCount: "지난 활동 {n}회 ›",
  relatedToRecommend: "현재 추천과의 연관",
  viewFullScene: "전체 장면 보기",
  viewSceneFallback: "장면 보기",
  sceneSuggestions: "장면 제안",
  nearbySceneFallback: "근처 장면",
  viewSceneA11y: "{name} 보기",
  sceneTagFallback: "근처 도심 장면",
  languageFromProfile: "프로필 정보 기준",
  reviewSummaryEmpty: "공개 리뷰 요약이 아직 없어요",
  trustLine: "★ {rating} · 긍정 {rate}% · 활동 {n}회",
  sceneReason: "시간이 맞고 거리도 가까우며 활동이 주제와 어울려요. 장면은 만남 제안일 뿐, 참여 여부는 양쪽이 확인합니다.",
  actionTable: "같이 앉기",
  actionInvite: "초대",
  viewHumanProfileA11y: "{name}님의 프로필 보기",
  icebreakerTitle: "{name}님에게 {action}",
  closeIcebreaker: "대화 시작 패널 닫기",
  close: "닫기",
  sendLineA11y: "보내기: “{line}”",
  icebreakerLine1: "저도 근처예요. 같이 앉을까요?",
  icebreakerLine2: "지나가던 길이에요. 같이 앉을래요?",
  greetLine1: "안녕하세요~ 보여서 인사드려요 👋",
  greetLine2: "안녕하세요! 프로필이 흥미로워요, 알고 지낼래요?",
  greetLine3: "같은 동네 친구, 친하게 지내요~",
  greetLine4: "안녕하세요, 올리신 게 궁금해요. 얘기 나눌래요?",
  greetLine5: "프로필 지나가다 인사 남겨요 😊",
  greetLine6: "안녕~ 시간 될 때 얘기해요",
  greetLine7: "안녕하세요, 새 친구를 사귀고 싶어요",
  greetLine8: "안녕하세요! 오늘 하루 어때요?",
  greetA11y: "{name}에게 인사하기",
  invited: "초대함",
  greetFailed: "인사를 보내지 못했어요. 다시 눌러 주세요",
  greetLoginFirst: "로그인하면 인사할 수 있어요",
  greetNoAccount: "{name}님은 아직 계정이 없어 인사를 보낼 수 없어요",
  recombo: "새로 조합했어요",
  recomboSub: "현재 시간과 근처에서 가능한 Scene을 기준으로 다시 조합했어요.",
  swapPerson: "사람을 바꿨어요",
  swapScene: "장면을 바꿨어요",
  swapTime: "시간을 바꿨어요",
  swapActivity: "활동을 바꿨어요",
  othersUnchanged: "나머지 3칸은 그대로예요.",
  clarifyTimeQuestion: "오후일까요, 저녁일까요?",
  afternoon: "오후",
  evening: "저녁",
  needTimeCondition: "시간 조건이 하나 더 필요해요",
  needTimeConditionSub: "확인하면 바로 반영할게요. 채팅 페이지로는 가지 않아요.",
  timeToTonight: "시간을 오늘 저녁으로 바꿨어요",
  activityToWalk: "활동을 산책 / City Walk로 바꿨어요",
  coffeeCombo: "조합 완료 · Three Beans가 대화에 더 좋아요",
  coffeeComboSub: "커피와 편안한 대화를 언급하셔서 더 조용하고 창가 자리가 있는 곳을 우선했어요.",
  searchingServer: "전체에서 “{q}” 를 찾는 중…",
  searchingServerSub: "로컬 추천에 없어서 서버에 물어보는 중이에요.",
  imageNeedsChat: "이미지는 Proxy AI 대화에서 보내야 해요",
  notFoundQuerySub2: "다른 키워드로 계속 검색하거나, 왼쪽 AI 표시를 눌러 모델 대화로 들어가세요.",
};

const JA: Messages = {
  title: "リアルな人をおすすめ",
  humanBadge: "実在の人",
  chipOnline: "オンライン",
  chipChinese: "中国語",
  chipChatRoom: "チャットルーム",
  kmUnit: "km 以内",
  ridePrefix: "約 ",
  more: "もっと 〉",
  back: "戻る",
  search: "検索",
  closeSearch: "検索を閉じる",
  searchPeople: "実在の人を検索",
  searchPlaceholder: "名前か自己紹介を検索",
  clearSearch: "検索をクリア",
  emptyFiltered: "現在の条件に合う人がいません。条件を緩めてみてください。",
  distanceUnknown: "距離不明",
  offline: "オフライン",
  distanceChipA11y: "{km}km 以内、タップして範囲を変更",
  distanceTierA11y: "{km}km 以内",
  selectedSuffix: "、選択中",
  filterChipA11y: "フィルター {label}",
  createRoomA11y: "チャットルームを作成",
  roomsCreateTitle: "ルームを作って仲間を探そう",
  roomsCreateDesc: "シーンを選ぶ → 人を選ぶ → 3秒で完了",
  roomsOngoing: "進行中のルーム",
  roomsEmpty: "まだルームがありません。作ってみましょう",
  roomsLoadFailed: "ルームを読み込めませんでした。タップして再試行",
  roomsLoading: "ルームを読み込み中…",
  roomsLoginFirst: "ログインするとルームを作成・入室できます",
  roomEnter: "入室",
  roomMembers: "{n}名",
  roomOpenA11y: "{name} に入室",
  languageChipA11y: "言語：{name}、タップで切替",
  language: "言語",
  selectLanguage: "言語を選択",
  cancel: "キャンセル",
  retry: "再試行",
  retryServerSearch: "全体検索を再試行",
  serverSearchFailed: "全体検索に失敗しました。後でもう一度お試しください。",
  serverPeopleTitle: "全体の実在の人 · {n}人",
  thisIsYou: "これはあなたです",
  addFriend: "+ 友だち追加",
  alreadyFriend: "すでに友だち",
  requestSent: "送信済み",
  home: "プロフィール",
  messageAction: "メッセージ",
  publishDemand: "リクエストを投稿",
  humanProfile: "実在の人のプロフィール",
  viewProfile: "プロフィールを見る",
  combo: "あなた向けの組み合わせ",
  sceneIdeas: "シーンの提案",
  continueSection: "続きから",
  nearbyScenes: "近くのシーン",
  inviteMoment: "お誘いの瞬間",
  noActivity: "表示できる活動はまだありません",
  privateHidden: "非公開の記録は表示されません",
  noPublicPosts: "公開記録はありません",
  whatSheCanDo: "できること",
  reputation: "評判と評価",
  publicActivity: "公開された活動記録",
  relatedTheme: "関連テーマ",
  currentTheme: "現在のテーマ",
  currentAction: "現在のアクション",
  canGoTogether: "一緒に行けます",
  currentScene: "現在の Scene",
  suitableScenes: "合うシーン",
  nearbyNowVisible: "近く · 現在表示中",
  map: "地図 〉",
  itemsCount: "{n}件",
  draftProgress: "下書き · {p}% 入力済み",
  publishedWaiting: "公開済み · マッチ待ち",
  relationshipLoadFailed: "友だちの状態を読み込めません",
  loginToAddFriend: "ログインすると友だちを追加できます",
  noAccountYet: "{name} はまだアカウントがないため追加できません",
  becameFriends: "友だちになりました · {name}",
  friendRequestSent: "友だち申請を送信しました · {name}",
  cannotAddSelf: "自分自身は追加できません",
  friendActionFailed: "友だち操作に失敗しました。後でもう一度お試しください",
  friendLabelFriend: "{name} と友だち",
  friendLabelOutgoing: "{name} に申請済み",
  friendLabelIncoming: "{name} の友だち申請を承認",
  friendLabelAdd: "{name} を友だちに追加",
  adding: "追加中…",
  addingShort: "追加中",
  added: "✓ 追加済み",
  acceptAdd: "承認",
  addAction: "+ 追加",
  foundPeople: "実在のユーザーを {n} 人見つけました",
  foundPeopleSub: "プロフィールをタップして表示、+ で友だち追加。",
  notFoundQuery: "“{q}” は見つかりません",
  notFoundQuerySub: "ローカル推薦も全体検索もヒットしませんでした。別のキーワードにするか、友だち追加ページで handle から正確に探してください。",
  serverSearchFailedTitle: "全体検索に失敗しました",
  serverSearchFailedSub: "ネットワークの問題かもしれません。下の再試行を押すか、別のキーワードをお試しください。",
  joinAlready: "すでに申し込み済みです。もう一度押す必要はありません",
  joinFull: "定員に達しました。次はお早めに",
  joinGone: "この活動は存在しないか終了しました",
  sessionExpired: "ログインの有効期限が切れました。もう一度ログインしてください",
  joinFailed: "申し込みに失敗しました。後でもう一度お試しください",
  loginToJoin: "ログインすると申し込めます",
  networkError: "ネットワークエラーです。接続を確認して再試行してください",
  pickActivityFirst: "先に活動を選んでください",
  joinedWithCount: "申し込み済み · {n} 人参加",
  modePhoto: "撮影",
  modeCompanion: "一緒に行く",
  modeMeal: "食事",
  modeActivity: "アクティビティ",
  modeTrip: "お出かけ",
  modeCreator: "創作",
  modeTranslate: "翻訳",
  modeMedical: "通院付き添い",
  actionCoffeeMeal: "カフェ / 食事",
  actionActivityTogether: "アクティビティ同行",
  actionTrip: "近場のお出かけ",
  actionCreator: "コンテンツ制作",
  aiRecommend: "AI おすすめ",
  aiRecommendSub: "彼女が今のシーンに合う理由を見る",
  aiGenerated: "AI による生成",
  viewProfileA11y: "{name} のプロフィールを見る",
  messageToA11y: "{name} にメッセージを送る",
  withPerson: "{name} と",
  gridSub: "相手 · 時間 · シーンを選んで、ワンタップで画像生成かお誘い",
  changeAllHint: "相手・時間・活動・場所をまとめて変更",
  changeAllLabel: "まとめて変更",
  chainHint: "直接誘う：アバターをタップして Scene ページでチャット · 待つなら：リクエストを投稿して 小美 に受けてもらう",
  makeImage: "✦ 画像生成",
  makeImageA11y: "画像生成",
  joinInProgress: "申し込み中…",
  joinCta: "申し込む →",
  joinCtaA11y: "活動に申し込む",
  publishDemandA11y: "リクエストを投稿して 小美 に申し込んでもらう",
  choosePerson: "一緒に行く人を選ぶ",
  chooseTime: "時間を選ぶ",
  chooseActivity: "活動を選ぶ",
  choosePlace: "場所を選ぶ",
  chooseA11y: "{name} を選ぶ",
  currentChoice: "選択中",
  chooseSlot: "時間帯を選ぶ",
  tilePersonSub: "一緒に行く人 · タップで変更",
  tileTime: "時間",
  tilePlace: "場所",
  oneDay: "1 日",
  postedToFeed: "フィードに投稿しました",
  loginToPost: "投稿する前にログインしてください（ゲストは投稿できません）。",
  postFailed: "投稿に失敗しました。もう一度お試しください。",
  postToFeed: "フィードに投稿",
  posting: "投稿中…",
  inviteShared: "招待を共有しました",
  shareFailed: "共有を開けませんでした。もう一度お試しください。",
  shareInvite: "招待を共有",
  sharing: "共有中…",
  shareInviteCta: "招待を共有 →",
  backHome: "ホームに戻る",
  backShort: "‹ 戻る",
  nearbyRecommend: "近くのおすすめ",
  activityCount: "活動記録 {n} 件",
  viewPublicHistory: "公開履歴を見る",
  availabilityUnknown: "空き時間を見る",
  historyCount: "過去の活動 {n} 件 ›",
  relatedToRecommend: "今回のおすすめとの関連",
  viewFullScene: "シーン全体を見る",
  viewSceneFallback: "シーンを見る",
  sceneSuggestions: "シーンの提案",
  nearbySceneFallback: "近くのシーン",
  viewSceneA11y: "{name} を見る",
  sceneTagFallback: "近くの都市シーン",
  languageFromProfile: "プロフィールの情報によります",
  reviewSummaryEmpty: "公開レビューの要約はまだありません",
  trustLine: "★ {rating} · 好評価 {rate}% · 活動 {n} 件",
  sceneReason: "時間が合い、距離も近く、活動もテーマに合います。シーンはあくまで提案で、参加するかは双方が確認します。",
  actionTable: "相席",
  actionInvite: "お誘い",
  viewHumanProfileA11y: "{name} のプロフィールを見る",
  icebreakerTitle: "{name} に {action}",
  closeIcebreaker: "アイスブレイクを閉じる",
  close: "閉じる",
  sendLineA11y: "送信：“{line}”",
  icebreakerLine1: "私も近くにいます。相席しませんか？",
  icebreakerLine2: "たまたま通りかかりました。一緒にどうですか？",
  greetLine1: "こんにちは〜見かけたのでご挨拶です 👋",
  greetLine2: "こんにちは！プロフィールが面白そう、仲良くなりませんか？",
  greetLine3: "同じ街の方ですね、よろしくお願いします〜",
  greetLine4: "こんにちは、シェアしている内容が気になります。少し話しませんか？",
  greetLine5: "プロフィールを通りかかったので挨拶を残します 😊",
  greetLine6: "こんにちは〜暇なときにお話ししましょう",
  greetLine7: "こんにちは、新しい友達を作りたいです",
  greetLine8: "こんにちは！今日はどんな一日ですか？",
  greetA11y: "{name} に挨拶",
  invited: "招待済み",
  greetFailed: "挨拶を送れませんでした。もう一度タップしてください",
  greetLoginFirst: "ログインすると挨拶できます",
  greetNoAccount: "{name} さんはまだアカウントがないため挨拶できません",
  recombo: "新しい組み合わせを作りました",
  recomboSub: "現在の時間と近くで使える Scene で組み直しました。",
  swapPerson: "相手を変えました",
  swapScene: "シーンを変えました",
  swapTime: "時間を変えました",
  swapActivity: "活動を変えました",
  othersUnchanged: "残り3つはそのままです。",
  clarifyTimeQuestion: "午後ですか、夜ですか？",
  afternoon: "午後",
  evening: "夜",
  needTimeCondition: "あと時間の条件が1つ必要です",
  needTimeConditionSub: "確認後すぐに更新します。チャット画面には移動しません。",
  timeToTonight: "時間を今夜に変えました",
  activityToWalk: "活動を散歩 / City Walk に変えました",
  coffeeCombo: "組み合わせ完了 · Three Beans の方が会話に向いています",
  coffeeComboSub: "コーヒーと気軽な会話というご希望から、より静かで窓際の席がある場所を優先しました。",
  searchingServer: "全体から “{q}” を検索中…",
  searchingServerSub: "ローカル推薦にヒットせず、サーバーに問い合わせています。",
  imageNeedsChat: "画像は Proxy AI の会話で送信してください",
  notFoundQuerySub2: "別のキーワードで検索を続けるか、左の AI マークをタップしてモデル会話に入ってください。",
};

export const I18N: Record<Language, Messages> = {
  zh: ZH,
  vi: VI,
  en: EN,
  lo: LO,
  ko: KO,
  ja: JA
};

// 原型 rideTimes 那 7 档，跟着距离档位走。
export const RIDE_TIMES: Record<Language, ReadonlyArray<string>> = {
  zh: ["1 分钟", "4 分钟", "6 分钟", "12 分钟", "24 分钟", "1 小时", "2 小时"],
  vi: ["1 phút", "4 phút", "6 phút", "12 phút", "24 phút", "1 giờ", "2 giờ"],
  en: ["1 min", "4 min", "6 min", "12 min", "24 min", "1 hr", "2 hr"],
  lo: ["1 ນາທີ", "4 ນາທີ", "6 ນາທີ", "12 ນາທີ", "24 ນາທີ", "1 ຊົ່ວໂມງ", "2 ຊົ່ວໂມງ"],
  ko: ["1분", "4분", "6분", "12분", "24분", "1시간", "2시간"],
  ja: ["1分", "4分", "6分", "12分", "24分", "1時間", "2時間"]
};

export type MessageKey = keyof Messages;
export type MessageVars = Record<string, string | number>;

// 占位符替换。缺变量时**留着 {name} 原样**而不是变成 "undefined" ——
// 前者一眼能看出是漏传，后者会伪装成一句正常文案。
export function translate(lang: Language, key: MessageKey, vars?: MessageVars): string {
  const template = (I18N[lang] ?? ZH)[key] ?? ZH[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

// ---- 语言状态：模块级 store，不需要 Provider ----
//
// 为什么不用 Context：Context 要求在树根挂一个 Provider，而树根是
// app-shell.tsx —— 那是基线敏感文件、当时还有别人在改。模块级 store
// 让任何组件直接 useI18n()，不动树根，也不产生 Provider 顺序问题。
//
// 这里**只存状态**，不碰 SecureStore（见文件头约束 1）。持久化由
// language-sheet 调 preferences.saveLanguage 完成。

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener();
}

export interface I18n {
  lang: Language;
  option: LanguageOption;
  t: (key: MessageKey, vars?: MessageVars) => string;
  rideTimes: ReadonlyArray<string>;
  setLanguage: (lang: Language) => void;
}

export function useI18n(): I18n {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  return {
    lang,
    option: languageOption(lang),
    t: (key, vars) => translate(lang, key, vars),
    rideTimes: RIDE_TIMES[lang] ?? RIDE_TIMES.zh,
    setLanguage
  };
}

// HOME-MORE-SHEET-003：破冰开场白。原来写死在 requester-home.tsx 的模块级
// 数组里（中文），那个位置拿不到 t()，语言一切它就不跟着走。挪进来跟
// RIDE_TIMES 一个待遇：每种语言一份，调用点按当前语言取。
//
// 用 translate() 生成而不是手抄两遍，是为了让这两句只有一处事实源 ——
// 抄两遍的话，改了字典忘了改这里，破冰面板会静默留在旧语言。
//
// 顺序有意义：两条是同一个面板上的固定两行，调换顺序用户看到的推荐顺序
// 也跟着变。
export const ICEBREAKER_LINES: Record<Language, ReadonlyArray<string>> = {
  zh: [translate("zh", "icebreakerLine1"), translate("zh", "icebreakerLine2")],
  vi: [translate("vi", "icebreakerLine1"), translate("vi", "icebreakerLine2")],
  en: [translate("en", "icebreakerLine1"), translate("en", "icebreakerLine2")],
  lo: [translate("lo", "icebreakerLine1"), translate("lo", "icebreakerLine2")],
  ko: [translate("ko", "icebreakerLine1"), translate("ko", "icebreakerLine2")],
  ja: [translate("ja", "icebreakerLine1"), translate("ja", "icebreakerLine2")]
};

// HOME-MORE-GREET-001（2026-09-23，用户：「超出了 没见面暂时 就是纯粹的打招呼好奇 就不用
// 弹出了 就是 hi 的行为 点击就发出默认预制的招呼话语 不要只有一个 多写几句」）：
// 「更多」列表里不在同一窗景（> SAME_SCENE_RADIUS_M）的人，按钮是「邀约」= 打招呼：
// 点一下直接从这里随机挑一句发出去，不弹面板。句子只是 hi / 好奇，不约见面 ——
// 约见面是同一窗景里「拼桌」的破冰面板（ICEBREAKER_LINES）的事。
const GREETING_KEYS = ["greetLine1", "greetLine2", "greetLine3", "greetLine4", "greetLine5", "greetLine6", "greetLine7", "greetLine8"] as const;
export const GREETING_LINES: Record<Language, ReadonlyArray<string>> = {
  zh: GREETING_KEYS.map((key) => translate("zh", key)),
  vi: GREETING_KEYS.map((key) => translate("vi", key)),
  en: GREETING_KEYS.map((key) => translate("en", key)),
  lo: GREETING_KEYS.map((key) => translate("lo", key)),
  ko: GREETING_KEYS.map((key) => translate("ko", key)),
  ja: GREETING_KEYS.map((key) => translate("ja", key))
};
