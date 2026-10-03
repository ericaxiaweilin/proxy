// 原型子页面内容映射 — 每个路由对应原型中的页面标题、描述和关键内容。
import type { MeSubPage } from "./me-types";

export const SUB_PAGE_CONTENT: Record<string, { title: string; desc: string; icon: string; sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }> = {
  // ORDER-PERMISSION-001：接单权限（AI 分身门页的「去申请」用 openSubPage 跳过来，必须在这里登记）。
  providerapply: {
    title: "KYC认证",
    desc: "实名 + 证件 + 履约条款 · 通过后开放接单和 AI 分身",
    icon: "spark",
  },
  myscenes: {
    title: "我的场景",
    desc: "R15.13 Scene Value Exchange · 我发起的 Scene 与收到的邀请。预算进场景，不买人。",
    icon: "◎",
  },
  wallet: {
    title: "钱包与结算",
    desc: "钱包是'我的'内页，只展示 Proxy 真正经手或需要记录的资金状态。",
    icon: "₫"
  },
  myorders: {
    title: "我的订单",
    desc: "我发布、参与和已经完成的订单。",
    icon: "◇"
  },
  myactivities: {
    title: "我的活动",
    desc: "我参加、感兴趣和发起的活动。",
    icon: "○"
  },
  favorites: {
    title: "收藏",
    desc: "很轻的个人备忘夹。以后还想找到，就放这里。",
    icon: "☆",
  },
  facet: {
    title: "FACET · 对象化内容运营",
    desc: "同一份真实素材，针对不同对象重新组织呈现方式。",
    icon: "✨",
  },
  participate: {
    title: "参与运营 · 网络贡献",
    desc: "推荐靠谱司机 / Agent、好商家或真实新用户。Proxy 自动做归因、审核、进度跟踪和奖励结算。",
    icon: "✦",
    sections: [
      { title: "参与资格", rows: [
        { label: "身份与账号", value: "—" },
        { label: "风控", value: "无自我邀请 / 批量设备 / 历史滥用信号" },
        { label: "权限边界", value: "推荐与引荐不等于合同签署、资格验证或平台审批" }
      ]}
    ]
  },
  networkcontribution: {
    title: "我的网络贡献",
    desc: "用户看到的是自己的真实增长贡献、审核状态和收益。",
    icon: "↗",
    sections: [
      { title: "累计网络贡献收入", rows: [
        { label: "已到账", value: "—" },
        { label: "待价值事件解锁", value: "—" }
      ]},
      { title: "按场景看转化", rows: [
        { label: "司机 / Agent 拉新", value: "邀请 0 · 注册 0" },
        { label: "商家推荐", value: "合作推进中" },
        { label: "新用户拉新", value: "邀请 0 · 注册 0" }
      ]}
    ]
  },
  appbehavior: {
    title: "设置",
    desc: "账号与安全、位置与隐私、条款与语言。每一项都通往一个真的能打开的地方。",
    icon: "⚙",
  },
  // SETTINGS-BLOCKLIST-001：黑名单有专属渲染分支（me.tsx 的 subPage.route ===
  // "blocklist"），所以这里只登记路由，不登记 sections ——
  // 登记了 sections 反而会走通用兜底那条路（SUBPAGE-GENERIC-FABRICATED-001
  // 钉的就是这个：每一行都要么有专属分支，要么诚实空态）。
  blocklist: {
    title: "黑名单",
    desc: "本机名单，可解封。",
    icon: "blockCircle",
  },
  // SETTINGS-HUB-001（2026-10-01）：设置页从「一屏内容」改成入口页之后，
  // 原来那一屏内容（安全设置 / 应用行为检查 / 隐私与数据 / 浏览统计 / 隐私请求）
  // 原样搬到这个路由下，一个字都没丢 —— 只是多了一层入口。
  settingssecurity: {
    title: "账号与安全",
    desc: "登录设备与会话、数据下载与删除、动态浏览统计。",
    icon: "gear",
  },
  // SAFETY-NET-001：位置与隐私。模糊位置共享 + 紧急联系人 + 安全事件记录，
  // 三块都接在真服务端命令上（location kind / emergency 域）。
  locationprivacy: {
    title: "位置与隐私",
    desc: "模糊位置共享、紧急联系人与安全事件记录。位置属于敏感个人数据，每一项都要你单独开启。",
    icon: "⌖",
  },
  repeatincome: {
    title: "我的收入",
    desc: "30 天收入、复购收入与预计机会。收入口径未接入前不编造数字。",
    icon: "₫",
    sections: [
      { title: "收入概览", rows: [
        { label: "30 天收入", value: "—" },
        { label: "复购收入占比", value: "—" },
        { label: "可提现", value: "—" }
      ]}
    ]
  },
  agentcrm: {
    title: "客户与复购",
    desc: "管理合作过的客户和下一次机会。",
    icon: "↻"
  },
  agentcontentanalytics: {
    title: "内容与带单数据",
    desc: "被看见只是第一步。看清楚哪些照片、动态和服务展示真的帮你找到好客户。口径未接入前不编数。",
    icon: "↗",
    sections: [
      { title: "数据概览", rows: [
        { label: "人物 / 内容展示", value: "—" },
        { label: "主页打开", value: "—" },
        { label: "合格聊天", value: "—" }
      ]},
      { title: "转化漏斗", rows: [
        { label: "Discovery", value: "—" },
        { label: "Profile", value: "—" },
        { label: "Chat", value: "—" },
        { label: "Need", value: "—" },
        { label: "Order", value: "—" },
        { label: "Repeat", value: "—" }
      ]}
    ]
  },
  boost: {
    title: "推广中心",
    desc: "为自己的合格公开服务购买更多曝光。",
    icon: "✦",
    sections: [
      { title: "当前状态", rows: [
        { label: "推广状态", value: "—" },
        { label: "每日预算", value: "—" }
      ]}
    ]
  },
  passport: {
    title: "能力档案",
    desc: "身份、语言、角色、履约与验证。",
    icon: "✓"
  },
  workprefs: {
    title: "工作偏好",
    desc: "角色、区域、时间、最低报酬与距离。",
    icon: "☷"
  },
  weekly: {
    title: "本周可用时间",
    desc: "提前挂未来供给。",
    icon: "◷"
  },
  available: {
    title: "能力与可用时间",
    desc: "能力类型由 Proxy 定义，你维护实例；30 天日历由每周规律 + 按日例外决定。",
    icon: "◷"
  },
  agentcopilot: {
    title: "智能工作助手",
    desc: "路线、翻译、回复、范围整理与内容辅助。",
    icon: "✦",
    sections: [
      { title: "当前可以帮你", rows: [
        { label: "翻译客户消息", value: "" },
        { label: "整理服务范围", value: "" },
        { label: "生成路线草稿", value: "" },
        { label: "回复草稿", value: "" },
        { label: "内容草稿", value: "" }
      ]},
      { title: "明确边界", rows: [
        { label: "模型不会修改", value: "订单金额、结算、奖励、资格或历史 Outcome" }
      ]}
    ]
  },
  merchantstorefront: {
    title: "线上店铺",
    desc: "线上店铺是企业业务对象 / Published Surface。把店门、菜单、产品照片交给企业运营助手。",
    icon: "◎"
  },
  enterpriseops: {
    title: "企业运营助手",
    desc: "统一 Enterprise Ops Skill。不是 Chatbot，而是企业经营意图 → 分析 → 计划 → 可执行 Command。",
    icon: "✦"
  },
  merchantactivity: {
    title: "活动与门店导流",
    desc: "本地活动、权益与真实到店。",
    icon: "☕"
  },
  members: {
    title: "成员与权限",
    desc: "多人可以在同一个企业主体下分工操作。",
    icon: "◉",
  },
  trustedteam: {
    title: "常用执行者",
    desc: "来自真实合作的可靠供给池。",
    icon: "✓"
  },
  outcomehistory: {
    title: "商家结果历史",
    desc: "看同一家门店多次真人检查后到底有没有变好。",
    icon: "↗",
  },
  billing: {
    title: "支出与账单",
    desc: "企业支出归企业主体，账单权限与运营权限分离。",
    icon: "₫",
  },
  bdash: {
    title: "我的店铺",
    desc: "合作店铺 · 接单数据 · 推荐管理。",
    icon: "▣"
  },
  // STORE-HUB-001：bdash 换成店铺 hub 后，原来的企业 / 店铺资料（门店名片
  // 二维码等）搬到这里，hub 里留入口。无 sections（专属分支渲染）。
  bdashprofile: {
    title: "店铺资料",
    desc: "门店名片 · 二维码 · 主体信息。",
    icon: "▣"
  },
  // STORE-TILES-001 / STORE-REC-MANAGE-001：「企业 / 店铺」按产品稿整合成 2 个
  // 入口磁贴后，这一页承接原来那 3 条推荐入口（推荐商铺进体系 / 我推荐的店 /
  // 推荐评估队列）。现在它本身就是一个完整界面（页签 + 列表 + 详情 + 表单，
  // 见 ./store-recommendation-manage），这里只放页面的身份文案。
  // 页签文案在 me.tsx 的 STORE_REC_MANAGE_TABS —— 它归产品承诺，跟这一页的
  // title/desc 一样属于「文案」而不是「行为」。
  storerecmanage: {
    title: "推荐管理",
    desc: "把好的场地 / 商家推荐进体系；你推荐的那条走到哪一步、运营评估出什么结论，都在这里看。",
    icon: "star"
  },
  multislot: {
    title: "多人任务",
    desc: "一项业务需求可以拆成多个真人角色；每个名额独立匹配、取消、支付和评价。",
    icon: "◎"
  },
  todayboard: {
    title: "今日执行",
    desc: "商家先看名额是否补齐、执行者是否到场、异常是否需要处理。",
    icon: "✓"
  },
  personalmanage: {
    title: "个人管理",
    desc: "基本信息、二维码、状态管理。个人主页走 Threads R2 对外展示。",
    icon: "profile-ring",
  },
  personalhub: {
    title: "个人主页",
    desc: "把个人状态、Proxy 信誉、外部社媒和二维码放进一个用户可控的个人中枢。",
    icon: "○",
  },
  personalqr: {
    title: "我的二维码",
    desc: "Proxy QR 是个人中枢入口，不等于把所有外部联系方式公开。",
    icon: "▦",
  },
  socialidentity: {
    title: "社媒与联系",
    desc: "外部账号是个人资产；Proxy 负责验证关联关系与安全，不把社媒粉丝直接当成平台信誉。",
    icon: "↗",
  },
  socialprivacy: {
    title: "可见范围",
    desc: "发现、聊天和合作是不同信任阶段；外部联系方式不应该因为公开主页而自动泄露。",
    icon: "◌",
  },
  socialanalytics: {
    title: "访问与转化",
    desc: "让用户知道外部社媒是否真正带来合作；平台使用同一归因链做分发学习，但不卖原始联系人数据。归因口径未接入前不编数。",
    icon: "⌁",
  },
  addfriend: {
    title: "添加好友",
    desc: "关系入口统一，但不同来源只产生 Relationship Signal；不会未经确认直接建立 Proxy 好友。",
    icon: "＋",
  },
  friendcrm: {
    title: "好友与关系",
    desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录。",
    icon: "◎"
  },
  friendrequests: {
    title: "好友请求",
    desc: "好友是双向确认关系；关注、通讯录匹配和社媒关系都不能自动升级为好友。",
    icon: "♡",
  },
  notifications: {
    title: "通知中心",
    desc: "系统事件与真人聊天分开，避免订单、时间、安全和好友请求淹没 Conversation。",
    icon: "♢",
  },
  merchantcampaign: {
    title: "活动与门店导流",
    desc: "商家 Growth Center：从经营目标出发，把活动、Offer、Feed 分发、到店和复购串成一个闭环。",
    icon: "↗",  }
};

/**
 * 由路由构造 Me 子页描述。
 *
 * ADD-FRIEND-FROM-MESSAGES-001: me.tsx 里原本有三处一模一样的
 * `{ title: content.title, desc: content.desc, icon: content.icon, route }`
 * 拼装。跨模块入口（信息 → 添加好友）也要用同一份文案，所以收成一个函数：
 * 两个入口共用一条路由的标题/描述，不会各自维护一份而漂移。
 * 路由不存在时返回 undefined —— 调用方必须自己决定「没有这一页」怎么办，
 * 不能拿到一个 title 为空串的子页。
 */
export function meSubPage(route: string): MeSubPage {
  const content = SUB_PAGE_CONTENT[route];
  if (!content) return undefined;
  return { title: content.title, desc: content.desc, icon: content.icon, route };
}
