// 原型子页面内容映射 — 每个路由对应原型中的页面标题、描述和关键内容。
import type { MeSubPage } from "./me-types";

export const SUB_PAGE_CONTENT: Record<string, { title: string; desc?: string; icon: string; sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }> = {
  // ORDER-PERMISSION-001：接单权限（AI 分身门页的「去申请」用 openSubPage 跳过来，必须在这里登记）。
  providerapply: {
    title: "KYC认证",
    icon: "spark",
  },
  myscenes: {
    title: "我的场景",
    icon: "◎",
  },
  wallet: {
    title: "钱包与结算",
    icon: "₫"
  },
  myorders: {
    title: "我的订单",
    icon: "◇"
  },
  myactivities: {
    title: "我的活动",
    icon: "○"
  },
  favorites: {
    title: "收藏",
    icon: "☆",
  },
  facet: {
    title: "FACET · 对象化内容运营",
    icon: "✨",
  },
  participate: {
    title: "参与运营 · 网络贡献",
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
    icon: "⚙",
  },
  // SETTINGS-BLOCKLIST-001：黑名单有专属渲染分支（me.tsx 的 subPage.route ===
  // "blocklist"），所以这里只登记路由，不登记 sections ——
  // 登记了 sections 反而会走通用兜底那条路（SUBPAGE-GENERIC-FABRICATED-001
  // 钉的就是这个：每一行都要么有专属分支，要么诚实空态）。
  blocklist: {
    title: "黑名单",
    icon: "blockCircle",
  },
  // SETTINGS-HUB-001（2026-10-01）：设置页从「一屏内容」改成入口页之后，
  // 原来那一屏内容（安全设置 / 应用行为检查 / 隐私与数据 / 浏览统计 / 隐私请求）
  // 原样搬到这个路由下，一个字都没丢 —— 只是多了一层入口。
  settingssecurity: {
    title: "账号与安全",
    icon: "gear",
  },
  // SAFETY-NET-001：位置与隐私。模糊位置共享 + 紧急联系人 + 安全事件记录，
  // 三块都接在真服务端命令上（location kind / emergency 域）。
  locationprivacy: {
    title: "位置与隐私",
    icon: "⌖",
  },
  repeatincome: {
    title: "我的收入",
    desc: "收入口径未接入前不编造数字。",
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
    icon: "↻"
  },
  agentcontentanalytics: {
    title: "内容与带单数据",
    desc: "口径未接入前不编数。",
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
    icon: "✓"
  },
  workprefs: {
    title: "工作偏好",
    icon: "☷"
  },
  weekly: {
    title: "本周可用时间",
    icon: "◷"
  },
  available: {
    title: "能力与可用时间",
    icon: "◷"
  },
  agentcopilot: {
    title: "智能工作助手",
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
    icon: "◎"
  },
  enterpriseops: {
    title: "企业运营助手",
    icon: "✦"
  },
  merchantactivity: {
    title: "活动与门店导流",
    icon: "☕"
  },
  members: {
    title: "成员与权限",
    icon: "◉",
  },
  trustedteam: {
    title: "常用执行者",
    icon: "✓"
  },
  outcomehistory: {
    title: "商家结果历史",
    icon: "↗",
  },
  billing: {
    title: "支出与账单",
    icon: "₫",
  },
  bdash: {
    title: "我的店铺",
    // 第三段原来是「推荐管理」——STORE-HUB-003（2026-09-25 产品决定）之后
    // 「我的店铺」里没有它了，这句 desc 一直留着旧承诺。STORE-TILES-002 改名时
    // 顺手把它删掉：这一屏只放**已经处理完的店**，描述不该再列一个不在这里的东西。
    icon: "▣"
  },
  // STORE-HUB-001：bdash 换成店铺 hub 后，原来的企业 / 店铺资料（门店名片
  // 二维码等）搬到这里，hub 里留入口。无 sections（专属分支渲染）。
  bdashprofile: {
    title: "店铺资料",
    icon: "▣"
  },
  // STORE-TILES-001 / STORE-REC-MANAGE-001：「企业 / 店铺」按产品稿整合成 2 个
  // 入口磁贴后，这一页承接原来那 3 条推荐入口（推荐商铺进体系 / 我推荐的店 /
  // 推荐评估队列）。现在它本身就是一个完整界面（页签 + 列表 + 详情 + 表单，
  // 见 ./store-recommendation-manage），这里只放页面的身份文案。
  // 页签文案在 me.tsx 的 STORE_REC_MANAGE_TABS —— 它归产品承诺，跟这一页的
  // title/desc 一样属于「文案」而不是「行为」。
  storerecmanage: {
    title: "店铺推荐",
    icon: "star"
  },
  multislot: {
    title: "多人任务",
    icon: "◎"
  },
  todayboard: {
    title: "今日执行",
    icon: "✓"
  },
  personalmanage: {
    title: "个人管理",
    icon: "profile-ring",
  },
  personalhub: {
    title: "个人主页",
    icon: "○",
  },
  personalqr: {
    title: "我的二维码",
    icon: "▦",
  },
  socialidentity: {
    title: "社媒与联系",
    icon: "↗",
  },
  socialprivacy: {
    title: "可见范围",
    icon: "◌",
  },
  socialanalytics: {
    title: "访问与转化",
    desc: "归因口径未接入前不编数。",
    icon: "⌁",
  },
  addfriend: {
    title: "添加好友",
    icon: "＋",
  },
  friendcrm: {
    title: "好友与关系",
    icon: "◎"
  },
  friendrequests: {
    title: "好友请求",
    icon: "♡",
  },
  notifications: {
    title: "通知中心",
    icon: "♢",
  },
  merchantcampaign: {
    title: "活动与门店导流",
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
  // 2026-10-09：`desc` 已改为可选，而 tsconfig 开了 `exactOptionalPropertyTypes`
  // —— 可选属性**不许显式赋 undefined**（写成 `desc: content.desc` 直接编译不过）。
  // 所以缺席就是真的不写这个键，而不是补一个空串（空串会读成「有描述，但内容是空」，
  // 而真相是「没有描述」）。
  return {
    title: content.title,
    icon: content.icon,
    route,
    ...(content.desc !== undefined ? { desc: content.desc } : {})
  };
}
