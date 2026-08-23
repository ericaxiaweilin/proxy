// Me Surface：账户与 Active Context 切换（R15.12.7：One Account，
// Active Context = REQUESTER | BUSINESS，切换只改 Product State；
// 找人、接机会、开放能力、发活动都是行为，不是另一种身份）。
// R15.12.7 Market Map Parity Freeze：Market 路由行保持 dispatcher surface
// "TASKS" 契约（server 只知道 TASKS），shell 映射到市场 Tab。
// 视觉基线：Proxy_P0_Prototype_R15_12_7_Market_Map_Parity_Freeze.html
// （renderRequesterMe / renderBusinessMe / contextline），
// 切换 Sheet 由 App Shell 共享渲染（ContextSwitcherSheet）。
import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ExperienceAction, ExperienceMenuSection, RegisteredExperienceRoute } from "@proxy/contracts";
import { ProxyIcon, ProxySymbolIcon } from "../components/proxy-icon";
import { MerchantMeR21 } from "./merchant-me-r21";
import { color, Gradient, shadows } from "../theme";
import type { ActiveContext } from "../uiplan/types";

const OTTER_LOGO = require("../../assets/otter-logo.png");

type MeSubPage = { title: string; desc: string; icon: string; route: string } | undefined;
type AvailabilityState = "AVAILABLE" | "BUSY" | "PAUSED" | "HIDDEN";
type EnterpriseOpsStage = "READY" | "DRAFT_READY" | "CONFIRMED" | "PUBLISHED";

interface MenuRow {
  icon: string;
  label: string;
  desc: string;
  grad?: boolean;
  action?: ExperienceAction;
  route?: string;
}

interface MenuSection {
  id?: string;
  title: string;
  hint: string;
  rows: MenuRow[];
}

interface PersonaConfig {
  pageTitle: string;
  avatarText: string;
  avatarGrad: boolean;
  name: string;
  desc: string;
  identityActionLabel: string;
  identityActionSwitch: boolean;
  sections: MenuSection[];
  contextLineLabel: string;
  contextLineAction: string;
  settingsRow?: MenuRow;
  profileCard?: { route: string; status: string; social: string[] };
  alert?: { icon: string; title: string; desc: string; route: string; tag: string };
}

// 基线 renderRequesterMe（R15.12.7 最终，4960 包裹 4801）：ProfileCard +
// 个人主页 + 关系 + 我的市场 + 账户 + contextline。
const REQUESTER_ME: PersonaConfig = {
  pageTitle: "我的",
  avatarText: "H",
  avatarGrad: false,
  name: "Huyen",
  desc: "河内 ✓ 已验证 · 准时 98%",
  identityActionLabel: "切换身份",
  identityActionSwitch: true,
  profileCard: {
    route: "personalhub",
    status: "● 可接单",
    social: ["TT", "Z", "IG", "in"]
  },
  contextLineLabel: "当前身份 · 用户",
  contextLineAction: "切换为商家",
  sections: [
    {
      id: "personal_profile",
      title: "个人主页",
      hint: "你掌控展示方式",
      rows: [
        { icon: "profile-ring", label: "主页与二维码", desc: "Proxy 名片、社媒、公开资料与展示顺序", grad: true, route: "personalhub" },
        { icon: "arrow-up-right", label: "社媒与联系", desc: "TikTok、Zalo、Instagram 与可见范围", route: "socialidentity" },
        { icon: "route", label: "访问与转化", desc: "渠道 → 主页 → 聊天 → 订单", route: "socialanalytics" }
      ]
    },
    {
      id: "relationships",
      title: "关系",
      hint: "真人网络",
      rows: [
        { icon: "target", label: "好友与关系", desc: "好友、请求、二维码与关系发现", grad: true, route: "messages" },
        { icon: "plus", label: "添加好友", desc: "二维码、邀请、通讯录与社媒", route: "addfriend" }
      ]
    },
    {
      id: "my_market",
      title: "我的市场",
      hint: "个人资产",
      rows: [
        { icon: "diamond", label: "我的订单", desc: "我发布的 / 我参与的已成交订单", action: { type: "OPEN_SURFACE", surface: "TASKS", params: { view: "NEED" } } },
        { icon: "clock", label: "能力与可用时间", desc: "能力、主题、区域与空闲时间", route: "available" },
        { icon: "ring", label: "我的活动", desc: "已参加 / 我发起的活动", action: { type: "OPEN_SURFACE", surface: "TASKS", params: { view: "ACTIVITY", filter: "MINE" } } },
        { icon: "star", label: "关注与收藏", desc: "人、商家、动态与活动", route: "postfeed" }
      ]
    },
    {
      id: "account",
      title: "账户",
      hint: "安全与结算",
      rows: [
        { icon: "coin", label: "钱包与结算", desc: "付款、收入、退款与记录", route: "wallet" },
        { icon: "gear", label: "设置与隐私", desc: "推荐、通知、权限与隐私", route: "appbehavior" },
        { icon: "store-lines", label: "我的企业 / 店铺", desc: "有经营权限时进入 Business Workspace", route: "bdash" }
      ]
    }
  ]
};

// R3 商家一级模块 registry：只展示模块名 + 一行真实状态；二级页面沿用已有业务路由。
const BUSINESS_ME: PersonaConfig = {
  pageTitle: "我的企业",
  avatarText: "B",
  avatarGrad: false,
  name: "Bonsaidon",
  desc: "Business Principal · 当前你有经营权限",
  identityActionLabel: "主体",
  identityActionSwitch: false,
  contextLineLabel: "当前使用 · Bonsaidon",
  contextLineAction: "切换身份",
  settingsRow: { icon: "P", label: "Proxy 中心", desc: "应用状态、主体权限与业务工作区", route: "bdash" },
  sections: [
    {
      title: "商家 · 我的",
      hint: "业务资产",
      rows: [
        { icon: "◎", label: "Creator 经营", desc: "24 人 · 5 核心", grad: true, route: "trustedteam" },
        { icon: "券", label: "券", desc: "4 张进行中 · 1 张今天到期", route: "vouchers" },
        { icon: "↗", label: "活动导流", desc: "3 个档期 · 缺 4 位小美", route: "merchantcampaign" },
        { icon: "▤", label: "线上店铺", desc: "8,426 关注 · 今日 1,284 访问", grad: true, route: "merchantstorefront" },
        { icon: "₫", label: "销售中心", desc: "今日 12.6M · 新客 18", route: "outcomehistory" },
        { icon: "✦", label: "经营", desc: "3 待办 · 5 草稿", route: "enterpriseops" }
      ]
    }
  ]
};

const PERSONA: Record<ActiveContext, PersonaConfig> = {
  REQUESTER: REQUESTER_ME,
  BUSINESS: BUSINESS_ME
};

function toManagedMenuSections(sections: ExperienceMenuSection[]): MenuSection[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    hint: section.hint ?? "",
    rows: section.items.map((item) => ({
      icon: item.icon,
      label: item.label,
      desc: item.description,
      action: item.action,
      ...(item.accent !== undefined ? { grad: item.accent } : {})
    }))
  }));
}

function ServiceRow({ row, onPress }: { row: MenuRow; onPress?: () => void }): React.JSX.Element {
  const icon = row.icon === "P" ? (
    <Image accessibilityLabel="Proxy" resizeMode="contain" source={OTTER_LOGO} style={styles.serviceLogo} />
  ) : row.icon === "voucher" ? (
    <ProxyIcon color={row.grad ? color.white : color.ink} name="cup" size={26} />
  ) : (
    <ProxySymbolIcon color={row.grad ? color.white : color.ink} size={26} symbol={row.icon} />
  );
  return (
    <Pressable onPress={onPress} style={styles.serviceRow}>
      {row.grad ? (
        <Gradient from={color.magenta} to={color.violet} style={styles.serviceIcon}>
          {icon}
        </Gradient>
      ) : (
        <View style={[styles.serviceIcon, row.icon === "P" && styles.serviceLogoBox]}>
          {icon}
        </View>
      )}
      <View style={styles.serviceCopy}>
        <Text style={styles.serviceLabel}>{row.label}</Text>
        <Text style={styles.serviceDesc}>{row.desc}</Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

// R15.12.18 礼品券入口使用原型中的咖啡券杯子；这只是权益入口图标，
// 不替换应用 Logo，也不改动礼品券页面的任何卡面。
function VoucherMenuGlyph({ color: tint }: { color: string }): React.JSX.Element {
  return <ProxyIcon color={tint} name="cup" size={26} />;
}

const AVAILABILITY_OPTIONS: ReadonlyArray<{ id: AvailabilityState; title: string; desc: string }> = [
  { id: "AVAILABLE", title: "可接单", desc: "进入人物发现与合适机会分发" },
  { id: "BUSY", title: "忙碌", desc: "保留主页，降低即时机会" },
  { id: "PAUSED", title: "暂不接单", desc: "暂停机会分发" },
  { id: "HIDDEN", title: "隐身", desc: "从公开人物发现中隐藏" }
];

function availabilityLabel(value: AvailabilityState): string {
  return AVAILABILITY_OPTIONS.find((option) => option.id === value)?.title ?? "可接单";
}

// 原型 personalhub 的“个人状态”是市场可见性控制，而非身份切换。
// 选择写入当前 P0 会话；未来由 availability domain 持久化并审计。
function AvailabilitySheet({
  current,
  open,
  onClose,
  onSelect
}: {
  current: AvailabilityState;
  open: boolean;
  onClose: () => void;
  onSelect: (next: AvailabilityState) => void;
}): React.JSX.Element {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
      <Pressable onPress={onClose} style={styles.availabilityOverlay}>
        <Pressable onPress={() => undefined} style={styles.availabilitySheet}>
          <Text style={styles.availabilityTitle}>个人状态</Text>
          <Text style={styles.availabilitySub}>这是市场状态，不是身份切换。</Text>
          {AVAILABILITY_OPTIONS.map((option) => {
            const active = option.id === current;
            return (
              <Pressable
                key={option.id}
                onPress={() => { onSelect(option.id); onClose(); }}
                style={[styles.availabilityOption, active && styles.availabilityOptionActive]}
              >
                <View style={[styles.availabilityMark, active && styles.availabilityMarkActive]}>
                  <ProxyIcon color={active ? color.white : color.ink} name={option.id === "AVAILABLE" ? "target" : "circle"} size={22} />
                </View>
                <View style={styles.availabilityCopy}>
                  <Text style={styles.availabilityOptionTitle}>{option.title}</Text>
                  <Text style={styles.availabilityOptionDesc}>{option.desc}</Text>
                </View>
                <Text style={styles.availabilityAction}>{active ? "当前" : "设置"}</Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function memorySourceLabel(source: string): string {
  switch (source) {
    case "EXPLICIT": return "用户设置";
    case "EXPLICIT_ACCEPT": return "用户确认";
    case "INFERRED": return "系统推断";
    case "SUGGESTED": return "系统建议";
    default: return source;
  }
}

// 原型 rootChrome 的范围说明只属于“我的”根页，不能出现在设置等详情页。
function MeLocationContext(): React.JSX.Element {
  return (
    <View style={styles.meLocationRow}>
      <View style={styles.meLocationPin}>
        <ProxyIcon color={color.ink} name="crosshair" size={17} />
      </View>
      <View style={styles.meLocationCopy}>
        <Text style={styles.meLocationCity}>河内 · 还剑湖附近</Text>
        <Text numberOfLines={1} style={styles.meLocationSub}>
          你正在看的本地范围 · 仅城市 / 区域
        </Text>
      </View>
      <Text style={styles.meLocationSwitch}>切换⌄</Text>
    </View>
  );
}

// 原型子页面内容映射 — 每个路由对应原型中的页面标题、描述和关键内容。
const SUB_PAGE_CONTENT: Record<string, { title: string; desc: string; icon: string; sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }> = {
  wallet: {
    title: "钱包与结算",
    desc: "钱包是'我的'内页，只展示 Proxy 真正经手或需要记录的资金状态。",
    icon: "₫"
  },
  postfeed: {
    title: "关注与收藏",
    desc: "关注的人、商家和保存的动态。",
    icon: "☆"
  },
  requestermemory: {
    title: "Proxy 记住了什么？",
    desc: "只保留能让下一次更省事的偏好。你可以随时改掉，也可以不接受任何建议。",
    icon: "◎"
  },
  participate: {
    title: "参与运营 · 网络贡献",
    desc: "推荐靠谱司机 / Agent、好商家或真实新用户。Proxy 自动做归因、审核、进度跟踪和奖励结算。",
    icon: "✦",
    sections: [
      { title: "参与资格", rows: [
        { label: "身份与账号", value: "Identity verified · Principal ACTIVE" },
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
    title: "应用行为检查",
    desc: "应用端需要覆盖安全区域、键盘、返回、冷启动、后台恢复、推送、离线重试、深链和通知疲劳。",
    icon: "⚙",
    sections: [
      { title: "检查项", rows: [
        { label: "安全区域", value: "底部操作不能被系统手势区域遮挡" },
        { label: "键盘", value: "输入需求时保留草稿" },
        { label: "返回", value: "系统返回操作不能导致重复提交" },
        { label: "冷启动", value: "恢复本地草稿和上次安全页面" },
        { label: "后台恢复", value: "重新获取进度、付款和邀请状态" },
        { label: "离线重试", value: "离线期间保留待确认操作" },
        { label: "通知疲劳", value: "安全、付款和必须处理的事项可即时通知" }
      ]}
    ]
  },
  // Agent 子页面
  repeatincome: {
    title: "我的收入",
    desc: "30 天收入、复购收入与预计机会。",
    icon: "₫",
    sections: [
      { title: "收入概览", rows: [
        { label: "30 天收入", value: "2,450,000₫" },
        { label: "复购收入占比", value: "44%" },
        { label: "可提现", value: "860,000₫" }
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
    desc: "被看见只是第一步。看清楚哪些照片、动态和服务展示真的帮你找到好客户。",
    icon: "↗",
    sections: [
      { title: "数据概览", rows: [
        { label: "人物 / 内容展示", value: "18.6k" },
        { label: "主页打开", value: "1,284" },
        { label: "合格聊天", value: "47" }
      ]},
      { title: "转化漏斗", rows: [
        { label: "Discovery", value: "18.6k" },
        { label: "Profile", value: "1,284" },
        { label: "Chat", value: "47" },
        { label: "Need", value: "11" },
        { label: "Order", value: "7" },
        { label: "Repeat", value: "3" }
      ]}
    ]
  },
  boost: {
    title: "推广中心",
    desc: "为自己的合格公开服务购买更多曝光。",
    icon: "✦",
    sections: [
      { title: "当前状态", rows: [
        { label: "推广状态", value: "未开启" },
        { label: "每日预算", value: "300,000₫" }
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
    title: "我现在有空",
    desc: "开放当前真实可用时间。",
    icon: "●"
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
  // Business 子页面
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
    sections: [
      { title: "成员", rows: [
        { label: "Nguyen A", value: "所有者 · 企业管理 / 需求 / 成员 / 账单" },
        { label: "Lan", value: "运营 · 履约 / 到场 / 完成" },
        { label: "Minh", value: "账单 · 资金保护 / 退款 / 声明" }
      ]},
      { title: "规则", rows: [
        { label: "记录归企业", value: "成员离开不会删除企业需求、付款与履约历史" }
      ]}
    ]
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
    sections: [
      { title: "比较范围", rows: [
        { label: "检查类型", value: "餐厅体验检查 · 同一门店 · 可比较的检查模板" }
      ]},
      { title: "趋势", rows: [
        { label: "检查 #001", value: "72%" },
        { label: "检查 #003", value: "85%" },
        { label: "检查 #004", value: "91%" }
      ]},
      { title: "发现", rows: [
        { label: "重复出现的问题", value: "高峰接待 · 英文菜单 · 排队等待" },
        { label: "已验证的改善", value: "英文菜单可用 · 高峰接待到位" }
      ]}
    ]
  },
  billing: {
    title: "支出与账单",
    desc: "企业支出归企业主体，账单权限与运营权限分离。",
    icon: "₫",
    sections: [
      { title: "本周", rows: [
        { label: "总支出", value: "8,450,000₫" }
      ]},
      { title: "明细", rows: [
        { label: "周六开业", value: "资金已保护 · 5 个名额" },
        { label: "名额分配", value: "按各名额独立记录" },
        { label: "退款", value: "1 笔部分退款 · 已完成" }
      ]}
    ]
  },
  bdash: {
    title: "企业 / 店铺资料",
    desc: "店铺、Venue、主体与线上节点。",
    icon: "▣"
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
  // R15.12.7 最终 Me：个人主页（R15.9 Personal Social OS）+ 关系（R15.10 Messaging）。
  personalhub: {
    title: "个人主页",
    desc: "把个人状态、Proxy 信誉、外部社媒和二维码放进一个用户可控的个人中枢。",
    icon: "○",
    sections: [
      { title: "Profile", rows: [
        { label: "Huyen", value: "河内 · 已验证 · 个人主页公开" },
        { label: "准时", value: "98%" },
        { label: "已履约", value: "42" },
        { label: "复购", value: "7" }
      ]},
      { title: "Proxy Personal QR", rows: [
        { label: "二维码", value: "一个二维码承接你的 Proxy 主页，再由你决定 TikTok、Zalo、Instagram 等是否展示" }
      ]},
      { title: "对外展示 · 你决定", rows: [
        { label: "社媒与联系方式", value: "TikTok 公开 · Zalo 合作后 · Instagram 公开" },
        { label: "可见范围", value: "陌生浏览、聊天后、订单成立后分层开放" },
        { label: "访问与转化", value: "知道哪个渠道真的带来聊天、机会与订单" }
      ]}
    ]
  },
  personalqr: {
    title: "我的二维码",
    desc: "Proxy QR 是个人中枢入口，不等于把所有外部联系方式公开。",
    icon: "▦",
    sections: [
      { title: "扫码后看到", rows: [
        { label: "Proxy 主页", value: "始终 · 姓名、城市、公开能力、Proxy 信誉" },
        { label: "TikTok / Instagram", value: "公开 · 当前设为公开" },
        { label: "Zalo", value: "合作后 · 订单成立后才开放" }
      ]}
    ]
  },
  socialidentity: {
    title: "社媒与联系",
    desc: "外部账号是个人资产；Proxy 负责验证关联关系与安全，不把社媒粉丝直接当成平台信誉。",
    icon: "↗",
    sections: [
      { title: "外部身份链接", rows: [
        { label: "TikTok", value: "@huyen.life · 已关联 · 公开" },
        { label: "Zalo", value: "Huyen Nguyen · 已关联 · 合作后" },
        { label: "Instagram", value: "@huyen.frames · 已关联 · 公开" },
        { label: "LinkedIn", value: "尚未关联" }
      ]},
      { title: "联系方式 · 逐级开放", rows: [
        { label: "Zalo / 电话", value: "默认合作后开放，可随时收紧" }
      ]}
    ]
  },
  socialprivacy: {
    title: "可见范围",
    desc: "发现、聊天和合作是不同信任阶段；外部联系方式不应该因为公开主页而自动泄露。",
    icon: "◌",
    sections: [
      { title: "信任阶梯", rows: [
        { label: "陌生浏览", value: "最小公开 · 主页、已验证状态、公开社媒" },
        { label: "开始聊天", value: "可选 · 仍优先使用 Proxy Chat" },
        { label: "订单成立", value: "合作后 · 可开放 Zalo / 电话用于现实履约" },
        { label: "订单结束", value: "可恢复 · 临时联系权限自动关闭" }
      ]},
      { title: "当前规则 · 可编辑", rows: [
        { label: "TikTok", value: "公开" },
        { label: "Zalo", value: "合作后" },
        { label: "手机号", value: "合作后 · 订单结束可关闭" }
      ]}
    ]
  },
  socialanalytics: {
    title: "访问与转化",
    desc: "让用户知道外部社媒是否真正带来合作；平台使用同一归因链做分发学习，但不卖原始联系人数据。",
    icon: "⌁",
    sections: [
      { title: "过去 30 天漏斗", rows: [
        { label: "主页访问", value: "1,284" },
        { label: "合格聊天", value: "47" },
        { label: "机会", value: "18" },
        { label: "订单", value: "9" },
        { label: "复购", value: "4" }
      ]},
      { title: "来源", rows: [
        { label: "Proxy 市场", value: "访问 612 · 聊天 26 · 订单 5" },
        { label: "TikTok", value: "访问 338 · 聊天 11 · 订单 2" },
        { label: "Zalo QR", value: "访问 214 · 聊天 8 · 订单 2" },
        { label: "Instagram", value: "访问 120 · 聊天 2 · 订单 0" }
      ]}
    ]
  },
  messages: {
    title: "消息 · Unified Inbox",
    desc: "人与人的聊天、好友关系和系统通知各有明确边界。",
    icon: "✉",
    sections: [
      { title: "好友请求", rows: [
        { label: "Eric", value: "河内 · 2 个共同好友 · Proxy QR" },
        { label: "Trang", value: "北宁 · 通讯录匹配" }
      ]},
      { title: "聊天", rows: [
        { label: "Linh · 人物", value: "摄影 · 河内 · 周六下午有时间，可以聊一下。" },
        { label: "Bonsaidon · 订单", value: "谈判 · 今天 18:00 · 已接单 · 距开始 01:21" },
        { label: "Mai · 好友", value: "Mai · 城市同行 · TikTok 已关联" },
        { label: "西湖摄影散步 · 活动", value: "周六 15:30 · 8 / 12 已参加" }
      ]},
      { title: "好友", rows: [
        { label: "Mai", value: "河内 · 摄影 / 城市同行 · 共同好友 2" },
        { label: "An", value: "河内 · 本地生活 · 合作过 1 次" },
        { label: "Luna", value: "河内 · 活动 / 摄影 · 最近认识" },
        { label: "Khoa", value: "河内 · 活动执行 · 共同活动 3" }
      ]}
    ]
  },
  addfriend: {
    title: "添加好友",
    desc: "关系入口统一，但不同来源只产生 Relationship Signal；不会未经确认直接建立 Proxy 好友。",
    icon: "＋",
    sections: [
      { title: "添加方式", rows: [
        { label: "扫二维码", value: "扫描 Proxy Personal QR" },
        { label: "邀请好友", value: "链接或二维码邀请" },
        { label: "通讯录", value: "授权后只做匹配" },
        { label: "社媒好友", value: "Facebook / TikTok / IG / Zalo" },
        { label: "搜索 Proxy", value: "昵称、Proxy ID、手机号" }
      ]}
    ]
  },
  friendrequests: {
    title: "好友请求",
    desc: "好友是双向确认关系；关注、通讯录匹配和社媒关系都不能自动升级为好友。",
    icon: "♡",
    sections: [
      { title: "待处理", rows: [
        { label: "Eric", value: "河内 · 2 个共同好友 · 来自 Proxy QR" },
        { label: "Trang", value: "北宁 · 通讯录匹配" }
      ]}
    ]
  },
  notifications: {
    title: "通知中心",
    desc: "系统事件与真人聊天分开，避免订单、时间、安全和好友请求淹没 Conversation。",
    icon: "♢",
    sections: [
      { title: "最近", rows: [
        { label: "订单还有 30 分钟开始", value: "谈判 · 西湖 · 18:00 · 17:30" },
        { label: "Eric 想加你为好友", value: "来自 Proxy QR · 2 个共同好友 · 17:12" },
        { label: "活动有新消息", value: "西湖摄影散步 · 新增 2 位参加者 · 16:40" },
        { label: "TikTok 账号归属已确认", value: "@huyen.life · 公开范围仍由你决定 · 昨天" }
      ]}
    ]
  },
  // Business：AI 经营诊断 + 活动与门店导流（R15.12.7 最终，3133 / 3149）。
  businessdiagnostic: {
    title: "经营诊断",
    desc: "模型根据经营目标和实时 Read Model，组合今天最值得处理的信息。",
    icon: "✦",
    sections: [
      { title: "Bonsaidon · 今天 · 经营健康度", rows: [
        { label: "到店", value: "248" },
        { label: "成交额", value: "6.2M" },
        { label: "新客户", value: "172" },
        { label: "复购客户", value: "38" }
      ]},
      { title: "需要关注", rows: [
        { label: "14:00–17:00 时段利用率", value: "低于近 4 周平均 · 37%" }
      ]},
      { title: "表现较好", rows: [
        { label: "本周新客户增长", value: "+22% · 可继续放大当前活动来源" }
      ]},
      { title: "建议动作 · 模型提议 · 人确认", rows: [
        { label: "创建下午低峰活动", value: "30 份限时权益 · 14:00–17:00 · 只向相关 Intent 用户分发" },
        { label: "补 1 位活动执行者", value: "从真实合作网络优先邀请，若不足再开放合格供给" }
      ]}
    ]
  },
  merchantcampaign: {
    title: "活动与门店导流",
    desc: "商家 Growth Center：从经营目标出发，把活动、Offer、Feed 分发、到店和复购串成一个闭环。",
    icon: "↗",
    sections: [
      { title: "当前目标 · AI 草稿 · 可编辑", rows: [
        { label: "填补工作日下午低峰", value: "新增到店 · 14:00–17:00 · 预算 5M₫" }
      ]},
      { title: "漏斗", rows: [
        { label: "触达 / 查看 / 领取 / 到店 / 复购", value: "8.2k / 1.1k / 412 / 248 / 38" }
      ]},
      { title: "人群与传播 · Search / Intent 优先", rows: [
        { label: "优先人群", value: "3km 内 · 最近 14 天搜索 / 浏览海鲜、聚餐、下午活动" },
        { label: "传播上限", value: "初始 1,500 人 · 达到 Qualified Visit 后分阶段扩大" }
      ]},
      { title: "Offer · Server Truth", rows: [
        { label: "工作日下午双人权益", value: "399k → 329k · 每日 30 份 · 14:00–17:00 · 到店核销" }
      ]}
    ]
  }
};

// 原型 r159FakeQR 的 React Native 复刻：15×15 网格，三种定位角 + 数据点。
function fakeQrCells(): boolean[] {
  const cells: boolean[] = [];
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const finder = (x < 5 && y < 5) || (x > 9 && y < 5) || (x < 5 && y > 9);
      const borderFinder = finder && (x % 10 === 0 || x % 10 === 4 || y % 10 === 0 || y % 10 === 4);
      const inner = finder && x % 10 > 1 && x % 10 < 4 && y % 10 > 1 && y % 10 < 4;
      const data = (x * 7 + y * 11 + x * y) % 5 === 0 || (x * 3 + y * 2) % 7 === 0;
      cells.push(borderFinder || inner || (!finder && data));
    }
  }
  return cells;
}

const FAKE_QR_PAD = 6;
const FAKE_QR_GAP = 1;
const FAKE_QR_BORDER = 1;

function FakeQr({ size = 104 }: { size?: number }): React.JSX.Element {
  const cells = fakeQrCells();
  const cell = (size - FAKE_QR_BORDER * 2 - FAKE_QR_PAD * 2 - FAKE_QR_GAP * 14) / 15;
  return (
    <View
      style={[
        styles.fakeQr,
        {
          gap: FAKE_QR_GAP,
          height: size,
          padding: FAKE_QR_PAD,
          width: size
        }
      ]}
    >
      {cells.map((on, i) => (
        <View
          key={i}
          style={[
            styles.fakeQrCell,
            { height: cell, width: cell },
            on && styles.fakeQrCellOn
          ]}
        />
      ))}
    </View>
  );
}

// 原型 .r159QRWrap：左侧二维码 + 右侧说明 / 按钮。
function QrCard({
  title,
  desc,
  actionLabel,
  onAction,
  alignCenter = false
}: {
  title: string;
  desc: string;
  actionLabel: string;
  onAction?: () => void;
  alignCenter?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.qrCard, alignCenter && styles.qrCardCenter]}>
      <FakeQr />
      <View style={[styles.qrCardText, alignCenter && styles.qrCardTextCenter]}>
        <Text style={styles.qrCardTitle}>{title}</Text>
        <Text style={styles.qrCardDesc}>{desc}</Text>
        <Pressable onPress={onAction} style={styles.qrCardBtn}>
          <Text style={styles.qrCardBtnText}>{actionLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// 原型 .r159SimpleRow：图标 + 标题 / 副标题 + ›。
function SocialRow({
  icon,
  label,
  desc,
  onPress
}: {
  icon: string;
  label: string;
  desc: string;
  onPress?: () => void;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.socialRow}>
      <View style={styles.socialRowIcon}>
        <Text style={styles.socialRowIconText}>{icon}</Text>
      </View>
      <View style={styles.socialRowCopy}>
        <Text style={styles.socialRowLabel}>{label}</Text>
        <Text style={styles.socialRowDesc}>{desc}</Text>
      </View>
      <Text style={styles.socialRowChev}>›</Text>
    </Pressable>
  );
}

export function MeSurface({
  context,
  experienceSections,
  experienceMode,
  onOpenSwitcher,
  onOpenFeed,
  onOpenVouchers,
  onExperienceAction,
  onSignOut
}: {
  context: ActiveContext;
  experienceSections?: ExperienceMenuSection[];
  experienceMode?: "MERGE" | "REPLACE";
  onOpenSwitcher: () => void;
  onOpenFeed: () => void;
  onOpenVouchers: () => void;
  onExperienceAction: (action: ExperienceAction) => void;
  onSignOut: () => void;
}): React.JSX.Element {
  const [subPage, setSubPage] = useState<MeSubPage>();
  const [availability, setAvailability] = useState<AvailabilityState>("AVAILABLE");
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [enterpriseOpsStage, setEnterpriseOpsStage] = useState<EnterpriseOpsStage>("READY");
  const [enterpriseOpsAssets, setEnterpriseOpsAssets] = useState(3);

  // R21 是商家“我的”的独立产品页面，不与旧的个人菜单卡片语法混用。
  // 必须在所有 hooks 之后再分支，避免身份切换时破坏 hook 顺序。
  if (context === "BUSINESS") {
    return <MerchantMeR21 onOpenSwitcher={onOpenSwitcher} onSignOut={onSignOut} />;
  }

  const persona = PERSONA[context];

  const managedSections =
    context === "REQUESTER" && experienceSections
      ? toManagedMenuSections(experienceSections)
      : [];

  const effectiveSections = experienceMode === "REPLACE" && managedSections.length > 0
    ? managedSections
    : managedSections.length > 0
      ? persona.sections.map((pSection) => {
          const managed = managedSections.find((m) => m.id === pSection.id);
          if (!managed) return pSection;
          // 合并：后端 managed 行 + persona 中不在 managed 里的行（如钱包、关注）
          const managedLabels = new Set(managed.rows.map((r) => r.label));
          const extraRows = pSection.rows.filter((r) => !managedLabels.has(r.label));
          return { ...pSection, rows: [...managed.rows, ...extraRows] };
        })
      : persona.sections;

  function openRegisteredRoute(route: RegisteredExperienceRoute): void {
    if (route === "postfeed") {
      onOpenFeed();
      return;
    }
    if (route === "vouchers") {
      onOpenVouchers();
      return;
    }
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
  }

  function pressRow(row: MenuRow): void {
    // “关注与收藏”在原型中进入主动态，不是“我的”里的伪子页面。
    if (row.route === "postfeed") {
      onOpenFeed();
      return;
    }
    if (row.route === "vouchers") {
      onOpenVouchers();
      return;
    }
    if (row.action) {
      if (row.action.type === "OPEN_REGISTERED_ROUTE") {
        openRegisteredRoute(row.action.route);
        return;
      }
      onExperienceAction(row.action);
      return;
    }
    if (row.route) {
      const content = SUB_PAGE_CONTENT[row.route];
      setSubPage({
        title: content?.title ?? row.label,
        desc: content?.desc ?? row.desc,
        icon: content?.icon ?? row.icon,
        route: row.route
      });
    }
  }

  function openSubPage(route: string): void {
    const content = SUB_PAGE_CONTENT[route];
    if (!content) return;
    setSubPage({ title: content.title, desc: content.desc, icon: content.icon, route });
  }

  // 子页面渲染
  if (subPage) {
    const content = SUB_PAGE_CONTENT[subPage.route];

    // 原型 screens.appbehavior：不是设置表格，而是一组应用可靠性检查卡片。
    if (subPage.route === "appbehavior") {
      const checks = [
        ["安全区域", "底部操作不能被系统手势区域遮挡。"],
        ["键盘", "输入需求时保留草稿；键盘出现后仍能滚动并看到继续按钮。"],
        ["返回", "系统返回操作不能导致重复提交。"],
        ["冷启动", "恢复本地草稿和上次安全页面；未确认操作不能显示成功。"],
        ["后台恢复", "重新获取进度、付款和邀请状态；旧数据明确标记可能过期。"],
        ["深链", "推送可以直接打开对应任务页面，但必须先校验权限。"],
        ["离线重试", "离线期间保留待确认操作；恢复后用户明确重试并避免重复执行。"],
        ["通知疲劳", "安全、付款和必须处理的事项可即时通知；普通状态变化合并提醒。"]
      ];

      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.appBehaviorTitle}>应用行为检查</Text>
            {checks.map(([title, desc], index) => (
              <View key={title} style={[styles.appBehaviorCard, index === checks.length - 1 && styles.appBehaviorCardDark]}>
                <Text style={[styles.appBehaviorCardTitle, index === checks.length - 1 && styles.appBehaviorCardTitleDark]}>{title}</Text>
                <Text style={[styles.appBehaviorCardDesc, index === checks.length - 1 && styles.appBehaviorCardDescDark]}>{desc}</Text>
              </View>
            ))}
            <View style={styles.appBehaviorActions}>
              <Pressable style={[styles.appBehaviorAction, styles.appBehaviorActionPrimary]}>
                <Text style={styles.appBehaviorActionPrimaryText}>模拟后台恢复</Text>
              </Pressable>
              <Pressable style={styles.appBehaviorAction}>
                <Text style={styles.appBehaviorActionText}>模拟深链</Text>
              </Pressable>
              <Pressable style={[styles.appBehaviorAction, styles.appBehaviorActionDanger]}>
                <Text style={styles.appBehaviorActionDangerText}>模拟离线</Text>
              </Pressable>
              <Pressable style={styles.appBehaviorAction}>
                <Text style={styles.appBehaviorActionText}>重置原型</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.appBehaviorReturn}>
              <Text style={styles.appBehaviorReturnText}>返回我的</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // R15.9 Personal Social OS：三个入口各有自己的信息结构，不能落到通用子页。
    if (subPage.route === "socialidentity") {
      const channels = [
        ["TT", "TikTok", "@huyen.life", "公开", true],
        ["Z", "Zalo", "Huyen Nguyen", "合作后", true],
        ["IG", "Instagram", "@huyen.frames", "公开", true],
        ["in", "LinkedIn", "未关联", "关联", false]
      ] as const;
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>社媒与联系</Text>
            <Text style={styles.detailSub}>关联、二维码和公开范围都由你控制。</Text>
            {channels.map(([mark, name, account, visibility, linked]) => (
              <View key={name} style={styles.channelCard}>
                <View style={[styles.channelMark, linked && styles.channelMarkLinked]}>
                  <Text style={styles.channelMarkText}>{mark}</Text>
                </View>
                <View style={styles.channelCopy}>
                  <Text style={styles.channelName}>{name}</Text>
                  <Text style={styles.channelAccount}>{account}</Text>
                </View>
                <View style={[styles.channelStatus, linked ? styles.channelStatusOn : styles.channelStatusOff]}>
                  <Text style={[styles.channelStatusText, linked ? styles.channelStatusTextOn : styles.channelStatusTextOff]}>{visibility}</Text>
                </View>
              </View>
            ))}
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>联系方式</Text>
              <Text style={styles.detailSectionHint}>逐级开放</Text>
            </View>
            <Pressable onPress={() => openSubPage("socialprivacy")} style={styles.socialDetailRow}>
              <View style={styles.socialDetailIcon}><Text style={styles.socialDetailIconText}>☎</Text></View>
              <View style={styles.socialDetailCopy}>
                <Text style={styles.socialDetailLabel}>Zalo / 电话</Text>
                <Text style={styles.socialDetailDesc}>默认合作后开放，可随时收紧</Text>
              </View>
              <Text style={styles.socialDetailChev}>›</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialprivacy") {
      const levels = [
        ["1", "陌生浏览", "Proxy 主页、已验证状态、公开社媒", "最小公开"],
        ["2", "开始聊天", "仍优先使用 Proxy Chat；可开放指定社媒", "可选"],
        ["3", "订单成立", "可开放 Zalo / 电话用于现实履约", "合作后"],
        ["4", "订单结束", "临时联系权限可自动关闭", "可恢复"]
      ];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>可见范围</Text>
            <View style={styles.visibilityLadder}>
              {levels.map(([step, title, desc, tag]) => (
                <View key={step} style={styles.visibilityStep}>
                  <View style={styles.visibilityIndex}><Text style={styles.visibilityIndexText}>{step}</Text></View>
                  <View style={styles.visibilityCopy}>
                    <Text style={styles.visibilityTitle}>{title}</Text>
                    <Text style={styles.visibilityDesc}>{desc}</Text>
                  </View>
                  <Text style={styles.visibilityTag}>{tag}</Text>
                </View>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>当前规则</Text>
              <Text style={styles.detailSectionHint}>可编辑</Text>
            </View>
            {[["TT", "TikTok", "公开"], ["Z", "Zalo", "合作后"], ["☎", "手机号", "合作后 · 订单结束可关闭"]].map(([mark, title, desc]) => (
              <View key={title} style={styles.socialDetailRow}>
                <View style={styles.socialDetailIcon}><Text style={styles.socialDetailIconText}>{mark}</Text></View>
                <View style={styles.socialDetailCopy}>
                  <Text style={styles.socialDetailLabel}>{title}</Text>
                  <Text style={styles.socialDetailDesc}>{desc}</Text>
                </View>
                <Text style={styles.socialDetailChev}>›</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "socialanalytics") {
      const funnel = [["主页访问", "100%", "1,284"], ["合格聊天", "54%", "47"], ["机会", "34%", "18"], ["订单", "22%", "9"], ["复购", "11%", "4"]] as const;
      const sources = [["Proxy 市场", "612", "26", "5"], ["TikTok", "338", "11", "2"], ["Zalo QR", "214", "8", "2"], ["Instagram", "120", "2", "0"]];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>访问与转化</Text>
            <Text style={styles.detailSub}>过去 30 天 · 只看真实下一步，不追虚荣指标。</Text>
            <View style={styles.funnelCard}>
              {funnel.map(([label, width, value]) => (
                <View key={label} style={styles.funnelRow}>
                  <Text style={styles.funnelLabel}>{label}</Text>
                  <View style={styles.funnelTrack}><Gradient from="#9D74E8" to="#6F36BE" style={[styles.funnelBar, { width }]} /></View>
                  <Text style={styles.funnelValue}>{value}</Text>
                </View>
              ))}
            </View>
            <View style={styles.sourceTable}>
              <View style={[styles.sourceRow, styles.sourceHead]}><Text style={styles.sourceHeadText}>来源</Text><Text style={styles.sourceHeadText}>访问</Text><Text style={styles.sourceHeadText}>聊天</Text><Text style={styles.sourceHeadText}>订单</Text></View>
              {sources.map(([source, visit, chat, order]) => (
                <View key={source} style={styles.sourceRow}><Text style={styles.sourceName}>{source}</Text><Text style={styles.sourceValue}>{visit}</Text><Text style={styles.sourceValue}>{chat}</Text><Text style={styles.sourceValue}>{order}</Text></View>
              ))}
            </View>
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>平台信誉仍来自 Proxy</Text>
              <Text style={styles.infoNoteText}>外部粉丝、点赞和播放量只帮助发现；准时、履约、Outcome 与复购才决定长期市场信誉。</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "addfriend") {
      const methods = [["▦", "扫二维码", "扫描 Proxy Personal QR"], ["↗", "邀请好友", "链接或二维码邀请"], ["☎", "通讯录", "授权后只做匹配"], ["◎", "社媒好友", "Facebook / TikTok / IG / Zalo"], ["⌕", "搜索 Proxy", "昵称、Proxy ID、手机号"]];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.friendPageHead}><View><Text style={styles.detailTitle}>添加好友</Text><Text style={styles.detailSub}>找到现实里认识的人</Text></View></View>
            <View style={styles.friendMethodGrid}>
              {methods.map(([icon, title, desc]) => (
                <View key={title} style={styles.friendMethod}><Text style={styles.friendMethodIcon}>{icon}</Text><Text style={styles.friendMethodTitle}>{title}</Text><Text style={styles.friendMethodDesc}>{desc}</Text></View>
              ))}
            </View>
            <View style={styles.infoNote}><Text style={styles.infoNoteTitle}>关系不会自动导入</Text><Text style={styles.infoNoteText}>通讯录或外部社媒只产生“可能认识”的信号；真正成为 Proxy 好友仍需要双方确认。</Text></View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "available") {
      const rows = [["角色", "接待 · 口译"], ["区域", "西湖 · 巴亭"], ["时间偏好", "18:00–22:00"], ["结算", "平台支付 · 现场现金"], ["最低报酬", "500k"], ["最远距离", "8 公里"]];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.detailTitle}>我现在有空</Text>
            <Text style={styles.detailSub}>这次真实可用时间会继承长期工作偏好作为默认值。</Text>
            {rows.map(([title, desc]) => <View key={title} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{title}</Text><Text style={styles.prototypeCardDesc}>{desc}</Text></View>)}
            <Pressable style={styles.primaryCta}><Text style={styles.primaryCtaText}>开始挂空闲</Text></Pressable>
            <Pressable style={styles.lightCta}><Text style={styles.lightCtaText}>编辑长期工作偏好</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "messages") {
      const threads = [
        ["L", "Linh", "人物", "周六下午有时间，可以聊一下。", "18:42", "2"],
        ["B", "Bonsaidon", "订单", "地点改到西湖这边，可以吗？", "17:18", "1"],
        ["M", "Mai", "好友", "好的，到时候联系你。", "昨天", ""],
        ["○", "西湖摄影散步", "活动", "Luna：我也会带相机过去。", "昨天", "5"]
      ];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.messagesHead}>
              <View><Text style={styles.detailTitle}>消息</Text><Text style={styles.detailSub}>聊天与真实关系</Text></View>
              <View style={styles.messagesHeadActions}><View style={styles.messageIconButton}><Text style={styles.messageIconText}>♢</Text><View style={styles.messageNoticeDot} /></View><Pressable onPress={() => openSubPage("addfriend")} style={styles.messageIconButton}><Text style={styles.messageIconText}>＋</Text></Pressable></View>
            </View>
            <View style={styles.messageTabs}><View style={styles.messageTabActive}><Text style={styles.messageTabActiveText}>聊天</Text></View><View style={styles.messageTab}><Text style={styles.messageTabText}>好友</Text></View></View>
            <Pressable onPress={() => openSubPage("addfriend")} style={styles.messageThread}>
              <View style={[styles.messageAvatar, styles.messageAvatarSoft]}><Text style={styles.messageAvatarText}>＋</Text></View>
              <View style={styles.messageThreadCopy}><Text style={styles.messageThreadName}>好友请求</Text><Text style={styles.messageThreadPreview}>2 个待处理</Text></View><Text style={styles.messageChev}>›</Text>
            </Pressable>
            {threads.map(([initial, name, contextLabel, preview, time, unread]) => (
              <View key={name} style={styles.messageThread}>
                <View style={[styles.messageAvatar, name === "Bonsaidon" && styles.messageAvatarDark]}><Text style={styles.messageAvatarText}>{initial}</Text></View>
                <View style={styles.messageThreadCopy}><View style={styles.messageThreadTop}><Text style={styles.messageThreadName}>{name}</Text><Text style={styles.messageContext}>{contextLabel}</Text></View><Text numberOfLines={1} style={styles.messageThreadPreview}>{preview}</Text></View>
                <View style={styles.messageThreadMeta}><Text style={styles.messageTime}>{time}</Text>{unread ? <View style={styles.messageUnread}><Text style={styles.messageUnreadText}>{unread}</Text></View> : null}</View>
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    // 偏好与记忆页面（原型 requestermemory）
    if (subPage.route === "requestermemory") {
      const confirmedMemories = [
        { key: "city", label: "常用城市", value: "河内 · 还剑湖附近", source: "EXPLICIT" },
        { key: "strategy", label: "匹配策略", value: "优先本地同行 + 英语验证", source: "EXPLICIT_ACCEPT" },
        { key: "budget", label: "预算偏好", value: "500k–1.2M ₫ / 半天", source: "INFERRED" }
      ];
      const suggestedMemories = [
        { key: "style", label: "出行风格", value: "轻松拍照路线 · 少景点多咖啡", source: "SUGGESTED" },
        { key: "language", label: "语言偏好", value: "中文为主 · 可英文", source: "SUGGESTED" }
      ];

      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>{subPage.title}</Text>
            <Text style={styles.subPageDesc}>{subPage.desc}</Text>

            <View style={styles.memorySection}>
              <View style={styles.memorySectionHead}>
                <Text style={styles.memorySectionTitle}>已记住</Text>
                <Text style={styles.memorySectionCount}>{confirmedMemories.length} 项</Text>
              </View>
              {confirmedMemories.map((m) => (
                <View key={m.key} style={styles.memoryCard}>
                  <View style={styles.memoryCardBody}>
                    <View style={styles.memoryCardLeft}>
                      <Text style={styles.memoryLabel}>{m.label}</Text>
                      <Text style={styles.memoryValue}>{m.value}</Text>
                      <Text style={styles.memorySource}>{memorySourceLabel(m.source)} · 点按可修改</Text>
                    </View>
                    <View style={styles.memoryCardRight}>
                      <View style={styles.memoryStatusConfirmed}>
                        <Text style={styles.memoryStatusText}>已记住</Text>
                      </View>
                      <Text style={styles.memoryChev}>›</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.memorySection}>
              <View style={styles.memorySectionHead}>
                <Text style={styles.memorySectionTitle}>建议你确认</Text>
                <Text style={styles.memorySectionCount}>{suggestedMemories.length} 项 · 不会自动生效</Text>
              </View>
              {suggestedMemories.map((m) => (
                <View key={m.key} style={styles.memoryCard}>
                  <View style={styles.memoryCardBody}>
                    <View style={styles.memoryCardLeft}>
                      <Text style={styles.memoryLabel}>{m.label}</Text>
                      <Text style={styles.memoryValue}>{m.value}</Text>
                      <Text style={styles.memorySource}>{memorySourceLabel(m.source)} · 点按可修改</Text>
                    </View>
                    <View style={styles.memoryCardRight}>
                      <View style={styles.memoryStatusSuggested}>
                        <Text style={styles.memoryStatusTextSuggested}>建议确认</Text>
                      </View>
                      <Text style={styles.memoryChev}>›</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.memoryDarkCard}>
              <Text style={styles.memoryDarkTitle}>已确认的复查重点</Text>
              <Text style={styles.memoryDarkBody}>英文菜单 · 高峰接待 · 排队等待。你可以随时删除这条记忆。</Text>
            </View>

            <Pressable style={styles.memoryBtnLight}>
              <Text style={styles.memoryBtnLightText}>查看这次结果变化</Text>
            </Pressable>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.memoryBtnLight}>
              <Text style={styles.memoryBtnLightText}>返回</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // 钱包页面（原型 wallet）
    if (subPage.route === "wallet") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>钱包与结算</Text>
            <Text style={styles.subPageDesc}>只展示 Proxy 真正经手或需要记录的资金状态。</Text>

            {/* 可用余额 — 深色卡片 */}
            <View style={styles.walletDarkCard}>
              <Text style={styles.walletDarkLabel}>可用余额</Text>
              <Text style={styles.walletDarkAmount}>860,000₫</Text>
              <Text style={styles.walletDarkHint}>平台账本展示值</Text>
            </View>

            {/* 待结算收入 */}
            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>待结算收入</Text>
              <Text style={styles.walletCardValue}>1,200,000₫</Text>
              <Text style={styles.walletCardHint}>来自平台支付订单</Text>
            </View>

            {/* 直接结算说明 */}
            <View style={styles.walletCard}>
              <Text style={styles.walletCardLabel}>直接结算记录</Text>
              <Text style={styles.walletCardHint}>个人时间 / 技能服务可由双方直接结算；这里只保留合作确认与双方状态。</Text>
            </View>

            {/* 现场结算记录 */}
            <Pressable style={styles.walletAction}>
              <Text style={styles.walletActionIcon}>₫</Text>
              <View style={styles.walletActionBody}>
                <Text style={styles.walletActionLabel}>现场结算记录</Text>
                <Text style={styles.walletActionDesc}>查看双方确认状态</Text>
              </View>
              <Text style={styles.walletActionArrow}>›</Text>
            </Pressable>

            {/* 退款记录 */}
            <Pressable style={styles.walletBtnLight}>
              <Text style={styles.walletBtnLightText}>退款记录</Text>
            </Pressable>
          </ScrollView>
        </View>
      );
    }

    // 原型 .r159Hero + .r159TrustStrip + .r159QRWrap：个人主页 / 个人二维码 / 商家店铺。
    if (subPage.route === "personalhub") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>个人主页</Text>

            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <Gradient from="#241246" to="#7A2CFF" style={styles.heroAvatar}>
                  <Text style={styles.heroAvatarText}>H</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>Huyen</Text>
                  <Text style={styles.heroMeta}>河内 · 已验证 · 个人主页公开</Text>
                </View>
                <Pressable accessibilityLabel="设置个人状态" onPress={() => setAvailabilityOpen(true)} style={styles.heroStatus}>
                  <Text style={styles.heroStatusText}>● {availabilityLabel(availability)}</Text>
                </Pressable>
              </View>
              <View style={styles.trustStrip}>
                {[["98%", "准时"], ["42", "已履约"], ["7", "复购"]].map(([v, l]) => (
                  <View key={l} style={styles.trustStripItem}>
                    <Text style={styles.trustStripValue}>{v}</Text>
                    <Text style={styles.trustStripLabel}>{l}</Text>
                  </View>
                ))}
              </View>
            </View>

            <QrCard
              title="Proxy Personal QR"
              desc="一个二维码承接你的 Proxy 主页，再由你决定 TikTok、Zalo、Instagram 等是否展示。"
              actionLabel="打开二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <Text style={styles.customSectionTitle}>对外展示</Text>
            <Text style={styles.customSectionHint}>你决定</Text>
            <SocialRow
              icon="↗"
              label="社媒与联系方式"
              desc="TikTok 公开 · Zalo 合作后 · Instagram 公开"
              onPress={() => openSubPage("socialidentity")}
            />
            <SocialRow
              icon="◌"
              label="可见范围"
              desc="陌生浏览、聊天后、订单成立后分层开放"
              onPress={() => openSubPage("socialprivacy")}
            />
            <SocialRow
              icon="⌁"
              label="访问与转化"
              desc="知道哪个渠道真的带来聊天、机会与订单"
              onPress={() => openSubPage("socialanalytics")}
            />
          </ScrollView>
          <AvailabilitySheet current={availability} onClose={() => setAvailabilityOpen(false)} onSelect={setAvailability} open={availabilityOpen} />
        </View>
      );
    }

    if (subPage.route === "personalqr") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>我的二维码</Text>

            <QrCard
              title="Huyen · Proxy"
              desc="扫码先进入 Proxy 主页。TikTok / Zalo 是否展示，继续遵循你的可见范围。"
              actionLabel="分享二维码"
              alignCenter
            />

            <Text style={styles.customSectionTitle}>扫码后看到</Text>
            <Text style={styles.customSectionHint}>预览</Text>
            <View style={styles.privacyLadder}>
              {[
                ["1", "Proxy 主页", "姓名、城市、公开能力、Proxy 信誉", "始终"],
                ["2", "TikTok / Instagram", "当前设为公开", "公开"],
                ["3", "Zalo", "订单成立后才开放", "合作后"]
              ].map(([i, t, d, v]) => (
                <View key={i} style={styles.privacyStep}>
                  <View style={styles.privacyStepIndex}>
                    <Text style={styles.privacyStepIndexText}>{i}</Text>
                  </View>
                  <View style={styles.privacyStepCopy}>
                    <Text style={styles.privacyStepTitle}>{t}</Text>
                    <Text style={styles.privacyStepDesc}>{d}</Text>
                  </View>
                  <View style={styles.privacyStepTag}>
                    <Text style={styles.privacyStepTagText}>{v}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      );
    }

    // R15 商家原型 enterpriseops：Skill 先处理现实资料和 Draft，
    // Merchant / Catalog / Storefront 真源只在明确确认后才发布。
    if (subPage.route === "enterpriseops") {
      const draftReady = enterpriseOpsStage !== "READY";
      const confirmed = enterpriseOpsStage === "CONFIRMED" || enterpriseOpsStage === "PUBLISHED";
      const published = enterpriseOpsStage === "PUBLISHED";
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.enterpriseHero}>
              <Text style={styles.enterpriseSkillId}>enterprise_ops</Text>
              <Text style={styles.enterpriseHeroTitle}>企业运营助手</Text>
              <Text style={styles.enterpriseHeroText}>上传现实资料，或直接说“建店、整理商品、做内容、复盘经营”。系统只生成 Draft，业务真源始终要由商家确认。</Text>
            </View>
            <View style={styles.enterpriseRuntime}>
              <Text style={styles.enterpriseRuntimeTitle}>Unified Model Runtime</Text>
              <Text style={styles.enterpriseRuntimeText}>Skill 只声明理解、抽取与写作能力；底层模型由模型底座分发，业务端不绑定具体模型。</Text>
            </View>
            <View style={styles.enterpriseQuickGrid}>
              {[
                ["把店铺数字化", "照片 / 菜单 / 产品 / 品牌资料 → Store Draft"],
                ["整理商品与菜单", "Catalog Draft / 分类 / 描述 / 素材"],
                ["做内容与推广草稿", "Post / Benefit / Campaign Draft"],
                ["复盘门店经营", "基于订单、结果与客流数据给建议"]
              ].map(([title, desc]) => (
                <Pressable key={title} accessibilityLabel={title} onPress={() => setEnterpriseOpsStage("DRAFT_READY")} style={styles.enterpriseQuick}>
                  <Text style={styles.enterpriseQuickTitle}>{title}</Text>
                  <Text style={styles.enterpriseQuickDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle}>给 Proxy 看现实资料</Text>
              <Text style={styles.detailSectionHint}>{enterpriseOpsAssets} 个 Source Assets</Text>
            </View>
            <View style={styles.enterpriseAssetTray}>
              {["店门", "菜单", "品牌资料"].slice(0, enterpriseOpsAssets).map((asset) => (
                <View key={asset} style={styles.enterpriseAsset}>
                  <Text style={styles.enterpriseAssetThumb}>▧</Text>
                  <Text style={styles.enterpriseAssetText}>{asset}</Text>
                </View>
              ))}
            </View>
            <View style={styles.enterpriseAssetActions}>
              <Pressable onPress={() => setEnterpriseOpsAssets((count) => count + 1)} style={styles.lightCta}><Text style={styles.lightCtaText}>拍店铺 / 产品</Text></Pressable>
              <Pressable onPress={() => setEnterpriseOpsAssets((count) => count + 1)} style={styles.lightCta}><Text style={styles.lightCtaText}>上传文件</Text></Pressable>
            </View>
            {draftReady ? (
              <View style={styles.enterpriseDraft}>
                <Text style={styles.enterpriseDraftTitle}>Store Digitization Draft</Text>
                {[["Bonsaidon", "海鲜自助 · 河内 · 11:00–22:00", "结构 ✓"], ["工作日下午双人权益", "329,000₫ · 来源：菜单与活动资料", "96%"], ["双人晚餐预约套餐", "599,000₫ · 来源：菜单照片", "需确认"]].map(([name, meta, state]) => (
                  <View key={name} style={styles.enterpriseDraftRow}>
                    <View style={styles.enterpriseDraftCopy}><Text style={styles.enterpriseDraftName}>{name}</Text><Text style={styles.enterpriseDraftMeta}>{meta}</Text></View>
                    <Text style={styles.enterpriseDraftState}>{state}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {draftReady && !confirmed ? <Pressable onPress={() => setEnterpriseOpsStage("CONFIRMED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>确认这个 Draft</Text></Pressable> : null}
            {confirmed && !published ? <Pressable onPress={() => setEnterpriseOpsStage("PUBLISHED")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>发布线上店铺</Text></Pressable> : null}
            {published ? <Pressable onPress={() => openSubPage("merchantstorefront")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看已发布店铺</Text></Pressable> : null}
            <View style={styles.infoNote}><Text style={styles.infoNoteTitle}>Skill Boundary</Text><Text style={styles.infoNoteText}>Source Asset → Model Output → Draft Artifact → Merchant Confirmation → Authorized Domain Command。模型不直接成为 Merchant、Catalog 或 Order 真源。</Text></View>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "trustedteam") {
      // R15.12.22 Friend Relationship Advanced：合作执行网络是企业的
      // Relationship Edge，不是旧版的普通信息卡列表。
      const executors = [
        { initial: "A", name: "An · 活动接待", meta: "河内 · 最近合作 8 天前", rating: "4.9", stats: [["18 次", "完成合作"], ["94%", "按时率"], ["可用", "本周六"]] },
        { initial: "M", name: "Minh · 中越口译", meta: "北宁 / 河内 · 最近合作 12 天前", rating: "4.8", stats: [["12 次", "完成合作"], ["97%", "按时率"], ["可用", "周末"]] }
      ];
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>合作执行网络</Text>
            <Text style={styles.detailSub}>Bonsaidon · 真实合作过 27 人 · 本周 11 人可用</Text>
            {executors.map((executor) => (
              <View key={executor.initial} style={styles.trustedExecutorCard}>
                <View style={styles.trustedExecutorTop}>
                  <Gradient from={color.magenta} to={color.violet} style={styles.trustedExecutorAvatar}><Text style={styles.trustedExecutorAvatarText}>{executor.initial}</Text></Gradient>
                  <View style={styles.trustedExecutorCopy}>
                    <Text style={styles.trustedExecutorName}>{executor.name}</Text>
                    <Text style={styles.trustedExecutorMeta}>{executor.meta}</Text>
                  </View>
                  <Text style={styles.trustedExecutorRating}>{executor.rating}</Text>
                </View>
                <View style={styles.trustedExecutorStats}>
                  {executor.stats.map(([value, label]) => (
                    <View key={label} style={styles.trustedExecutorStat}>
                      <Text style={styles.trustedExecutorStatValue}>{value}</Text>
                      <Text style={styles.trustedExecutorStatLabel}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <View style={styles.trustedSuggestion}>
              <View style={styles.trustedSuggestionHead}><Text style={styles.trustedSuggestionTitle}>智能辅助 建议组合</Text><Text style={styles.trustedSuggestionHint}>不自动下单</Text></View>
              <View style={styles.trustedSuggestionBody}>
                <Text style={styles.trustedSuggestionBodyTitle}>周六新店活动 · 推荐 4 人</Text>
                <Text style={styles.trustedSuggestionBodyText}>优先复用 3 位历史合作 + 1 位探索型新执行者</Text>
              </View>
            </View>
            <Pressable accessibilityLabel="再次邀请团队" onPress={() => openSubPage("multislot")} style={styles.trustedInviteTouchable}>
              <Gradient from={color.magenta} to={color.violet} style={styles.trustedInvite}><Text style={styles.trustedInviteText}>再次邀请团队</Text></Gradient>
            </Pressable>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "multislot") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>门店开业</Text>
            {[["接待 · G-01", "已分配 · An"], ["接待 · G-02", "已分配 · Minh"], ["接待 · G-03", "待分配 · 独立名额"], ["口译 · I-01", "已分配"], ["内容人员 · C-01", "待分配"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <View style={[styles.infoNote, styles.enterpriseProgressNote]}><Text style={styles.infoNoteTitle}>整体进度</Text><Text style={styles.infoNoteText}>4 / 5 名额 · 80%</Text></View>
            <Pressable onPress={() => openSubPage("todayboard")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>打开今日执行</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "todayboard") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <Text style={styles.detailTitle}>今日执行</Text>
            <View style={styles.enterpriseMetrics}>{[["5", "名额"], ["3", "已到场"], ["1", "有风险"]].map(([value, label]) => <View key={label} style={styles.enterpriseMetric}><Text style={styles.enterpriseMetricValue}>{value}</Text><Text style={styles.enterpriseMetricLabel}>{label}</Text></View>)}</View>
            {[["G-01 · An", "已到场 · 17:46"], ["G-02 · Minh", "前往中 · 预计 8 分钟"], ["G-03", "待补位 · 需要替补"]].map(([name, detail]) => <View key={name} style={styles.prototypeCard}><Text style={styles.prototypeCardTitle}>{name}</Text><Text style={styles.prototypeCardDesc}>{detail}</Text></View>)}
            <Pressable onPress={() => openSubPage("multislot")} style={styles.primaryCta}><Text style={styles.primaryCtaText}>查看名额与补位</Text></Pressable>
            <Pressable onPress={() => openSubPage("members")} style={styles.lightCta}><Text style={styles.lightCtaText}>成员与权限</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "merchantstorefront") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>线上店铺</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>Bonsaidon</Text>
                  <Text style={styles.heroMeta}>海鲜自助 · 河内 · 3 个经营节点</Text>
                </View>
              </View>
              <View style={styles.storeStats}>
                {[["12", "在售 Offer"], ["148", "今日订单"], ["4.8", "门店评分"]].map(([v, l]) => (
                  <View key={l} style={styles.storeStatItem}>
                    <Text style={styles.storeStatValue}>{v}</Text>
                    <Text style={styles.storeStatLabel}>{l}</Text>
                  </View>
                ))}
              </View>
            </View>

            <QrCard
              title="Bonsaidon · Proxy 店铺"
              desc="扫码直接进入门店主页，看到在售 Offer 与真实到店核销。"
              actionLabel="打开店铺二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <Text style={styles.customSectionTitle}>经营入口</Text>
            <Text style={styles.customSectionHint}>Storefront</Text>
            <View style={styles.bizGrid}>
              {[
                ["▤", "商品 / 服务", "套餐、预约、权益与库存"],
                ["↗", "活动 Offer", "低峰、拉新与限时权益", "merchantcampaign"],
                ["◇", "订单", "待确认、履约、退款、完成"],
                ["◎", "客户", "新客、复购与来源"]
              ].map(([icon, label, desc, route]) => (
                <Pressable
                  key={label}
                  onPress={route ? () => openSubPage(route) : undefined}
                  style={styles.bizTile}
                >
                  <View style={styles.bizTileIcon}>
                    <Text style={styles.bizTileIconText}>{icon}</Text>
                  </View>
                  <Text style={styles.bizTileLabel}>{label}</Text>
                  <Text style={styles.bizTileDesc}>{desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.customSectionTitle}>今天的 Offer</Text>
            <Text style={styles.customSectionHint}>Server Truth</Text>
            <View style={styles.offerCard}>
              <Text style={styles.offerTitle}>海鲜自助 · 工作日下午场</Text>
              <Text style={styles.offerMeta}>14:00–17:00 · 399k → 329k · 余 24 份</Text>
            </View>
            <View style={styles.offerCard}>
              <Text style={styles.offerTitle}>双人晚餐 · 预约套餐</Text>
              <Text style={styles.offerMeta}>18:00–21:00 · 2 人 · 余 11 组</Text>
            </View>
          </ScrollView>
        </View>
      );
    }

    // R15.12.22：经营诊断不是旧版“标题 + 通用信息卡”。它是由 Server
    // UI Recipe 生成的诊断总览；动作只能作为提议，仍要由商家明确确认。
    if (subPage.route === "businessdiagnostic") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}><Text style={styles.subPageBackText}>‹ 返回</Text></Pressable>
            <View style={styles.diagnosticTitleRow}>
              <Text style={styles.detailTitle}>经营诊断</Text>
              <View style={styles.diagnosticTag}><Text style={styles.diagnosticTagText}>✦ 动态视图</Text></View>
            </View>
            <View style={styles.diagnosticHero}>
              <View style={styles.diagnosticHeroTop}>
                <View><Text style={styles.diagnosticHeroTitle}>Bonsaidon · 今天</Text><Text style={styles.diagnosticHeroText}>模型根据经营目标和实时 Read Model，组合今天最值得处理的信息。</Text></View>
                <View><Text style={styles.diagnosticScore}>78</Text><Text style={styles.diagnosticScoreLabel}>经营健康度 / 100</Text></View>
              </View>
              <View style={styles.diagnosticMetrics}>{[["248", "到店"], ["6.2M", "成交额"], ["172", "新客户"], ["38", "复购客户"]].map(([value, label]) => <View key={label} style={styles.diagnosticMetric}><Text style={styles.diagnosticMetricValue}>{value}</Text><Text style={styles.diagnosticMetricLabel}>{label}</Text></View>)}</View>
            </View>
            <View style={styles.diagnosticInsightGrid}>
              <View style={styles.diagnosticInsight}><Text style={styles.diagnosticInsightKicker}>需要关注</Text><Text style={styles.diagnosticInsightValue}>37%</Text><Text style={styles.diagnosticInsightText}>14:00–17:00 时段利用率低于近 4 周平均。</Text></View>
              <View style={styles.diagnosticInsight}><Text style={styles.diagnosticInsightKicker}>表现较好</Text><Text style={styles.diagnosticInsightValue}>+22%</Text><Text style={styles.diagnosticInsightText}>本周新客户增长明显，可继续放大当前活动来源。</Text></View>
            </View>
            <View style={styles.diagnosticActions}>
              <View style={styles.diagnosticActionsHead}><Text style={styles.diagnosticActionsTitle}>建议动作</Text><Text style={styles.diagnosticActionsHint}>模型提议 · 人确认</Text></View>
              <View style={styles.diagnosticActionItem}><Text style={styles.diagnosticActionTitle}>创建下午低峰活动</Text><Text style={styles.diagnosticActionText}>30 份限时权益 · 14:00–17:00 · 只向相关 Intent 用户分发</Text></View>
              <View style={styles.diagnosticActionItem}><Text style={styles.diagnosticActionTitle}>补 1 位活动执行者</Text><Text style={styles.diagnosticActionText}>从真实合作网络优先邀请，若不足再开放合格供给</Text></View>
              <View style={styles.diagnosticActionButtons}>
                <Pressable onPress={() => openSubPage("merchantcampaign")} style={styles.diagnosticCreate}><Text style={styles.diagnosticCreateText}>创建活动</Text></Pressable>
                <Pressable onPress={() => openSubPage("trustedteam")} style={styles.diagnosticFind}><Text style={styles.diagnosticFindText}>找执行者</Text></Pressable>
              </View>
            </View>
            <View style={styles.diagnosticRecipe}><Text style={styles.diagnosticRecipeTitle}>可复用 UI Recipe</Text><Text style={styles.diagnosticRecipeText}>BUSINESS_DIAG@monthly_DIAGNOSTIC · 结构复用；本次指标、异常、建议动作重新 Hydrate。模型不能把自己推断的数字写成经营真相。</Text></View>
            <Pressable accessibilityLabel="返回我的企业" onPress={() => setSubPage(undefined)} style={styles.trustedReturn}><Text style={styles.trustedReturnText}>返回我的企业</Text></Pressable>
          </ScrollView>
        </View>
      );
    }

    if (subPage.route === "bdash") {
      return (
        <View style={styles.root}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
              <Text style={styles.subPageBackText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.subPageTitle}>企业 / 店铺资料</Text>

            <View style={styles.storeTop}>
              <View style={styles.storeTopRow}>
                <Gradient from={color.magenta} to={color.violet} style={styles.storeAvatar}>
                  <Text style={styles.storeAvatarText}>B</Text>
                </Gradient>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroName}>Bonsaidon</Text>
                  <Text style={styles.heroMeta}>海鲜自助 · 河内 · 主体已验证</Text>
                </View>
              </View>
            </View>

            <QrCard
              title="商家身份二维码"
              desc="顾客扫码核验商家主体与真实到店记录，扫码先看到门店主页与信誉。"
              actionLabel="打开商家二维码"
              onAction={() => openSubPage("personalqr")}
            />

            <View style={styles.subSection}>
              <Text style={styles.subSectionTitle}>企业主体</Text>
              {[
                ["主体名称", "Bonsaidon · 海鲜自助"],
                ["经营城市", "河内"],
                ["经营节点", "3 个"],
                ["身份验证", "已认证 · Proxy 商家身份"]
              ].map(([label, value]) => (
                <View key={label} style={styles.subRow}>
                  <Text style={styles.subRowLabel}>{label}</Text>
                  <Text style={styles.subRowValue}>{value}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.customSectionTitle}>二维码与展示</Text>
            <Text style={styles.customSectionHint}>Proxy 商家身份</Text>
            <SocialRow
              icon="◈"
              label="门店主页"
              desc="顾客扫码先看到这家店的公开信息与信誉"
              onPress={() => openSubPage("merchantstorefront")}
            />
            <SocialRow
              icon="⌁"
              label="访问与转化"
              desc="知道二维码带来多少到店与核销"
              onPress={() => openSubPage("socialanalytics")}
            />
          </ScrollView>
        </View>
      );
    }

    // 兜底路由仍遵循原型的“标题 + 独立卡片”页面语法；不再使用错误的巨大图标和表格容器。
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={() => setSubPage(undefined)} style={styles.subPageBack}>
            <Text style={styles.subPageBackText}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.detailTitle}>{subPage.title}</Text>
          <Text style={styles.detailSub}>{subPage.desc}</Text>

          {content?.sections?.map((section, sIdx) => (
            <View key={sIdx} style={styles.fallbackSection}>
              <View style={styles.detailSectionHead}>
                <Text style={styles.detailSectionTitle}>{section.title}</Text>
              </View>
              {section.rows.map((row, rIdx) => (
                <View key={rIdx} style={styles.prototypeCard}>
                  <Text style={styles.prototypeCardTitle}>{row.label}</Text>
                  {row.value ? <Text style={styles.prototypeCardDesc}>{row.value}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          {!content?.sections ? (
            <View style={styles.infoNote}>
              <Text style={styles.infoNoteTitle}>正在准备这个工作区</Text>
              <Text style={styles.infoNoteText}>它会沿用此页面的真实业务对象和权限边界，不再以通用占位页替代。</Text>
            </View>
          ) : null}
          <Pressable onPress={() => setSubPage(undefined)} style={styles.lightCta}>
            <Text style={styles.lightCtaText}>返回我的</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <MeLocationContext />
        <View style={styles.pageTitleRow}>
          <Text style={styles.pageTitle}>{persona.pageTitle}</Text>
        </View>

        {persona.profileCard ? (
          <Pressable onPress={() => openSubPage(persona.profileCard!.route)} style={styles.profileCard}>
            <View style={styles.profileTop}>
              <Gradient from="#241246" to="#7A2CFF" style={styles.profileAvatar}>
                <Text style={styles.profileAvatarText}>{persona.avatarText}</Text>
              </Gradient>
              <View style={styles.profileCopy}>
                <Text style={styles.profileName}>{persona.name}</Text>
                <View style={styles.profileMeta}>
                  <Text style={styles.profileMetaText}>河内</Text>
                  <View style={styles.profileVerifyDot}>
                    <Text style={styles.profileVerifyText}>✓</Text>
                  </View>
                  <Text style={styles.profileMetaText}>已验证 · 准时 98%</Text>
                </View>
              </View>
              <View style={styles.profileStatus}>
                <Text style={styles.profileStatusText}>● {availabilityLabel(availability)}</Text>
              </View>
            </View>
            <View style={styles.profileSocial}>
              {persona.profileCard.social.map((s) => (
                <View key={s} style={[styles.profileSocialBadge, s === "TT" && styles.profileSocialBadgeOn]}>
                  <Text style={styles.profileSocialBadgeText}>{s}</Text>
                </View>
              ))}
              <Text style={styles.profileSocialMore}>社媒与二维码 ›</Text>
            </View>
          </Pressable>
        ) : (
          <View style={styles.identityCard}>
            {persona.avatarGrad ? (
              <Gradient from={color.magenta} to={color.violet} style={styles.identityAvatar}>
                <Text style={styles.identityAvatarText}>{persona.avatarText}</Text>
              </Gradient>
            ) : (
              <View style={[styles.identityAvatar, styles.identityAvatarSolid]}>
                <Text style={styles.identityAvatarText}>{persona.avatarText}</Text>
              </View>
            )}
            <View style={styles.identityCopy}>
              <Text style={styles.identityName}>{persona.name}</Text>
              <Text style={styles.identityDesc}>{persona.desc}</Text>
            </View>
            <Pressable
              onPress={() => persona.identityActionSwitch && onOpenSwitcher()}
              style={styles.identityButton}
            >
              <Text style={styles.identityButtonText}>{persona.identityActionLabel}</Text>
            </Pressable>
          </View>
        )}

        {context === "REQUESTER" ? (
          <Pressable accessibilityLabel="礼品券，3 张可用，去使用" onPress={onOpenVouchers} style={styles.voucherPin}>
            <View style={styles.voucherPinMark}><VoucherMenuGlyph color={color.ink} /></View>
            <View style={styles.voucherPinCopy}>
              <Text style={styles.voucherPinTitle}>礼品券</Text>
              <Text style={styles.voucherPinDesc}>咖啡券、体验券与活动券</Text>
            </View>
            <View style={styles.voucherPinRight}>
              <Text style={styles.voucherPinCount}>3 张可用</Text>
              <Text style={styles.voucherPinAction}>去使用 ›</Text>
            </View>
          </Pressable>
        ) : null}

        {persona.alert ? (
          <Pressable onPress={() => persona.alert && openSubPage(persona.alert.route)} style={styles.bizAlert}>
            <View style={styles.bizAlertMark}>
              <Text style={styles.bizAlertMarkText}>{persona.alert.icon}</Text>
            </View>
            <View style={styles.bizAlertCopy}>
              <Text style={styles.bizAlertTitle}>{persona.alert.title}</Text>
              <Text style={styles.bizAlertDesc}>{persona.alert.desc}</Text>
            </View>
            <Text style={styles.bizAlertTag}>{persona.alert.tag}</Text>
          </Pressable>
        ) : null}

        {effectiveSections.map((section) => (
          <View key={section.id ?? section.title} style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionHint}>{section.hint}</Text>
            </View>
            {section.rows.map((row) => (
              <ServiceRow key={row.label} onPress={() => pressRow(row)} row={row} />
            ))}
          </View>
        ))}

        <View style={styles.contextLine}>
          <Text style={styles.contextLineText}>{persona.contextLineLabel}</Text>
          <Pressable onPress={onOpenSwitcher}>
            <Text style={styles.contextLineAction}>{persona.contextLineAction} ›</Text>
          </Pressable>
        </View>

        {persona.settingsRow ? (
          <ServiceRow onPress={() => persona.settingsRow && pressRow(persona.settingsRow)} row={persona.settingsRow} />
        ) : null}

        <Pressable onPress={onSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: color.offWhite, flex: 1 },
  content: { paddingBottom: 18, paddingHorizontal: 15, paddingTop: 11 },
  meLocationRow: { alignItems: "center", flexDirection: "row", gap: 8, paddingBottom: 8, paddingHorizontal: 1, paddingTop: 3 },
  meLocationPin: { alignItems: "center", backgroundColor: "#F4EDF8", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  meLocationCopy: { flex: 1 },
  meLocationCity: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  meLocationSub: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  meLocationSwitch: { color: "#6D6175", fontSize: 11, fontWeight: "800" },
  pageTitleRow: { flexDirection: "row", alignItems: "center" },
  pageTitle: { color: color.ink, fontSize: 28, fontWeight: "900", lineHeight: 34, marginBottom: 4, marginTop: 8 },

  // 基线 .r159ProfileCard：可点按 → personalhub；含状态徽章与社媒 mini。
  profileCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 20,
    borderWidth: 1,
    marginVertical: 8,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 16
  },
  profileTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  profileAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  profileAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  profileCopy: { flex: 1 },
  profileName: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  profileMeta: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 3 },
  profileMetaText: { color: color.muted, fontSize: 12, lineHeight: 17 },
  profileVerifyDot: { alignItems: "center", backgroundColor: "#EFE8FF", borderRadius: 6, height: 12, justifyContent: "center", width: 12 },
  profileVerifyText: { color: "#6B35B6", fontSize: 11, fontWeight: "900", includeFontPadding: false, lineHeight: 15 },
  profileStatus: {
    backgroundColor: "#F1FFD7",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 7
  },
  profileStatusText: { color: "#465C00", fontSize: 11, fontWeight: "900" },
  profileSocial: {
    alignItems: "center",
    borderTopColor: "#F1EDF3",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 11,
    paddingTop: 9
  },
  profileSocialBadge: {
    alignItems: "center",
    backgroundColor: "#FBFAFC",
    borderColor: "#EBE6EE",
    borderRadius: 9,
    borderWidth: 1,
    height: 25,
    justifyContent: "center",
    minWidth: 25,
    paddingHorizontal: 6
  },
  profileSocialBadgeOn: { backgroundColor: "#FAF7FF", borderColor: "#D8C8F0" },
  profileSocialBadgeText: { color: "#564D5B", fontSize: 11, fontWeight: "900" },
  profileSocialMore: { color: "#8B8291", fontSize: 11, marginLeft: 6 },

  // 基线 .bizalert：今天有 3 件事值得处理 → businessdiagnostic。
  bizAlert: {
    alignItems: "center",
    backgroundColor: color.ink,
    borderRadius: 17,
    flexDirection: "row",
    gap: 10,
    marginBottom: 4,
    marginTop: 8,
    padding: 13
  },
  bizAlertMark: {
    alignItems: "center",
    backgroundColor: "rgba(212,255,61,0.16)",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  bizAlertMarkText: { color: color.lime, fontSize: 17 },
  bizAlertCopy: { flex: 1 },
  bizAlertTitle: { color: color.white, fontSize: 11, fontWeight: "800" },
  bizAlertDesc: { color: "rgba(255,255,255,0.6)", fontSize: 11, lineHeight: 15, marginTop: 3 },
  bizAlertTag: { color: "#CBBFE0", fontSize: 11, fontWeight: "700" },

  // 基线 .r157IdentityCard：bg white border ln radius 17 padding 11。
  identityCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginVertical: 8,
    padding: 11
  },
  identityAvatar: {
    alignItems: "center",
    borderRadius: 13,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  identityAvatarSolid: { backgroundColor: "#17131F" },
  identityAvatarText: { color: color.white, fontSize: 16, fontWeight: "900" },
  identityCopy: { flex: 1 },
  identityName: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  identityDesc: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  identityButton: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  identityButtonText: { color: color.ink, fontSize: 14, fontWeight: "800" },

  section: { marginTop: 10 },
  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
    paddingHorizontal: 1
  },
  sectionTitle: { color: color.ink, fontSize: 17, fontWeight: "800", lineHeight: 24 },
  sectionHint: { color: color.muted, fontSize: 11, lineHeight: 15 },

  // R14.10 compact .card.service：radius 14 / padding 10 / icon 36。
  serviceRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.035)",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    marginBottom: 6,
    minHeight: 72,
    padding: 12
  },
  serviceIcon: {
    alignItems: "center",
    backgroundColor: color.lime,
    borderRadius: 14,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  serviceLogoBox: { backgroundColor: "#08090A" },
  serviceLogo: { borderRadius: 9, height: 36, width: 36 },
  voucherMenuGlyph: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  voucherCup: { borderRadius: 4, borderWidth: 2.4, height: 14, left: 8, position: "absolute", top: 16, width: 17 },
  voucherCupHandle: { borderRadius: 7, borderWidth: 2.4, height: 9, left: 23, position: "absolute", top: 20, width: 8 },
  voucherSteam: { borderRadius: 4, height: 9, position: "absolute", top: 6, transform: [{ rotate: "18deg" }], width: 2.4 },
  voucherPin: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, marginBottom: 4, marginTop: -3, padding: 11, ...shadows.card },
  voucherPinMark: { alignItems: "center", backgroundColor: color.lime, borderRadius: 12, height: 40, justifyContent: "center", width: 40 },
  voucherPinCopy: { flex: 1, minWidth: 0 },
  voucherPinTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  voucherPinDesc: { color: color.muted, fontSize: 11, marginTop: 3 },
  voucherPinRight: { alignItems: "flex-end" },
  voucherPinCount: { color: color.ink, fontSize: 11, fontWeight: "800" },
  voucherPinAction: { color: color.muted, fontSize: 11, marginTop: 3 },
  enterpriseHero: { backgroundColor: color.ink, borderRadius: 18, marginTop: 4, padding: 14 },
  enterpriseSkillId: { color: color.lime, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  enterpriseHeroTitle: { color: color.white, fontSize: 19, fontWeight: "700", marginTop: 7 },
  enterpriseHeroText: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 15, marginTop: 5 },
  enterpriseRuntime: { backgroundColor: "#F4EEF7", borderRadius: 14, marginTop: 8, padding: 11 },
  enterpriseRuntimeTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  enterpriseRuntimeText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  enterpriseQuickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  enterpriseQuick: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, minHeight: 84, padding: 10, width: "48.8%", ...shadows.card },
  enterpriseQuickTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  enterpriseQuickDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 5 },
  enterpriseAssetTray: { flexDirection: "row", gap: 7, marginTop: 7 },
  enterpriseAsset: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 61, padding: 7 },
  enterpriseAssetThumb: { color: "#6F37B9", fontSize: 16 },
  enterpriseAssetText: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 4 },
  enterpriseAssetActions: { flexDirection: "row", gap: 7 },
  enterpriseDraft: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginTop: 10, padding: 11, ...shadows.card },
  enterpriseDraftTitle: { color: color.ink, fontSize: 11, fontWeight: "900", marginBottom: 5 },
  enterpriseDraftRow: { alignItems: "center", borderTopColor: color.line, borderTopWidth: 1, flexDirection: "row", gap: 8, paddingVertical: 8 },
  enterpriseDraftCopy: { flex: 1 },
  enterpriseDraftName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  enterpriseDraftMeta: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  enterpriseDraftState: { color: "#536D00", fontSize: 11, fontWeight: "900" },
  enterpriseProgressNote: { backgroundColor: "#F4EEF7" },
  enterpriseMetrics: { flexDirection: "row", gap: 7, marginTop: 9 },
  enterpriseMetric: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, paddingVertical: 12, ...shadows.card },
  enterpriseMetricValue: { color: color.ink, fontSize: 16, fontWeight: "900" },
  enterpriseMetricLabel: { color: color.muted, fontSize: 11, marginTop: 3 },
  serviceCopy: { flex: 1 },
  serviceLabel: { color: color.ink, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  serviceDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  chev: { color: "#A59CAB", fontSize: 24 },

  contextLine: {
    alignItems: "center",
    backgroundColor: "#F4EEF7",
    borderRadius: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 7,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  contextLineText: { color: color.ink, fontSize: 11, fontWeight: "700" },
  contextLineAction: { color: "#574361", fontSize: 11, fontWeight: "900" },

  signOut: { alignItems: "center", marginBottom: 2, marginTop: 13, paddingVertical: 2 },
  signOutText: { color: "#A84A69", fontSize: 11, fontWeight: "800" },

  // 子页面。
  subPageBack: { marginBottom: 10, paddingVertical: 4 },
  subPageBackText: { color: color.magenta, fontSize: 12, fontWeight: "700" },
  subPageIcon: {
    alignItems: "center",
    backgroundColor: color.lime,
    borderRadius: 16,
    height: 56,
    justifyContent: "center",
    marginBottom: 12,
    width: 56
  },
  subPageIconText: { color: color.ink, fontSize: 28 },
  subPageTitle: { color: color.ink, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  subPageDesc: { color: color.muted, fontSize: 12, lineHeight: 18, marginBottom: 16 },
  subPagePlaceholder: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    ...shadows.card
  },
  subPagePlaceholderText: { color: color.muted, fontSize: 11, lineHeight: 17, textAlign: "center" },
  subPagePlaceholderHint: { color: "#A9A2B0", fontSize: 11, lineHeight: 15, marginTop: 8, textAlign: "center" },

  // 原型 screens.appbehavior：卡片堆叠与 2×2 模拟操作，不复用通用设置表格。
  appBehaviorTitle: { color: color.ink, fontSize: 19, fontWeight: "700", marginBottom: 4, marginTop: 8 },
  appBehaviorCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.035)",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 6,
    padding: 10,
    ...shadows.card
  },
  appBehaviorCardDark: { backgroundColor: color.ink, borderColor: color.ink },
  appBehaviorCardTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  appBehaviorCardTitleDark: { color: color.white },
  appBehaviorCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  appBehaviorCardDescDark: { color: "rgba(255,255,255,0.67)" },
  appBehaviorActions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  appBehaviorAction: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "46%",
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  appBehaviorActionPrimary: { backgroundColor: color.ink, borderColor: color.ink },
  appBehaviorActionDanger: { backgroundColor: "#FFF6F8", borderColor: "#F5DDE5" },
  appBehaviorActionText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  appBehaviorActionPrimaryText: { color: color.white, fontSize: 11, fontWeight: "800" },
  appBehaviorActionDangerText: { color: "#A84A69", fontSize: 11, fontWeight: "800" },
  appBehaviorReturn: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 999, marginTop: 10, paddingVertical: 10 },
  appBehaviorReturnText: { color: color.white, fontSize: 11, fontWeight: "800" },

  // R15.9 个人社交入口：渠道、可见范围、归因漏斗均有独立的原型结构。
  detailTitle: { color: color.ink, fontSize: 19, fontWeight: "700", marginTop: 8 },
  detailSub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 8, marginTop: 3 },
  channelCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 10, marginVertical: 4, padding: 11, ...shadows.card },
  channelMark: { alignItems: "center", backgroundColor: "#F5F1F8", borderRadius: 11, height: 36, justifyContent: "center", width: 36 },
  channelMarkLinked: { backgroundColor: "#F1E8FF" },
  channelMarkText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  channelCopy: { flex: 1 },
  channelName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  channelAccount: { color: color.muted, fontSize: 11, marginTop: 2 },
  channelStatus: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  channelStatusOn: { backgroundColor: "#F1FFD7" },
  channelStatusOff: { backgroundColor: "#F4EFF7" },
  channelStatusText: { fontSize: 11, fontWeight: "900" },
  channelStatusTextOn: { color: "#506900" },
  channelStatusTextOff: { color: "#756A7B" },
  detailSectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 11, paddingHorizontal: 1 },
  detailSectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  detailSectionHint: { color: color.muted, fontSize: 11 },
  socialDetailRow: { alignItems: "center", backgroundColor: color.white, borderColor: "rgba(20,18,31,0.04)", borderRadius: 15, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 6, padding: 11 },
  socialDetailIcon: { alignItems: "center", backgroundColor: "#F5F1F8", borderRadius: 10, height: 31, justifyContent: "center", width: 31 },
  socialDetailIconText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  socialDetailCopy: { flex: 1 },
  socialDetailLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  socialDetailDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  socialDetailChev: { color: "#A59EAA", fontSize: 15 },
  visibilityLadder: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, overflow: "hidden", ...shadows.card },
  visibilityStep: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 8, padding: 10 },
  visibilityIndex: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 10, height: 24, justifyContent: "center", width: 24 },
  visibilityIndexText: { color: "#6B35B6", fontSize: 11, fontWeight: "900" },
  visibilityCopy: { flex: 1 },
  visibilityTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  visibilityDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  visibilityTag: { color: "#756A7B", fontSize: 11, fontWeight: "800" },
  funnelCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, marginVertical: 8, padding: 12, ...shadows.card },
  funnelRow: { alignItems: "center", flexDirection: "row", gap: 8, marginVertical: 5 },
  funnelLabel: { color: color.muted, fontSize: 11, width: 58 },
  funnelTrack: { backgroundColor: "#F1EDF3", borderRadius: 999, flex: 1, height: 7, overflow: "hidden" },
  funnelBar: { borderRadius: 999, height: 7 },
  funnelValue: { color: color.ink, fontSize: 11, fontWeight: "800", textAlign: "right", width: 34 },
  sourceTable: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, overflow: "hidden", ...shadows.card },
  sourceRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", paddingHorizontal: 11, paddingVertical: 9 },
  sourceHead: { backgroundColor: color.surface },
  sourceHeadText: { color: color.muted, flex: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  sourceName: { color: color.ink, flex: 1, fontSize: 11, fontWeight: "700" },
  sourceValue: { color: color.ink, flex: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  infoNote: { backgroundColor: "#F4EEF7", borderRadius: 14, marginTop: 9, padding: 11 },
  infoNoteTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  infoNoteText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  friendPageHead: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  closeIcon: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, height: 28, justifyContent: "center", marginTop: 7, width: 28 },
  closeIconText: { color: color.ink, fontSize: 16, lineHeight: 20 },
  friendMethodGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  friendMethod: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, minHeight: 100, padding: 11, width: "48.8%", ...shadows.card },
  friendMethodIcon: { color: "#6F37B9", fontSize: 16, fontWeight: "900" },
  friendMethodTitle: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 10 },
  friendMethodDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  prototypeCard: { backgroundColor: color.white, borderColor: "rgba(20,18,31,0.035)", borderRadius: 14, borderWidth: 1, marginTop: 6, padding: 10, ...shadows.card },
  prototypeCardTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  prototypeCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  trustedExecutorCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 8, padding: 12, ...shadows.card },
  trustedExecutorTop: { alignItems: "center", flexDirection: "row" },
  trustedExecutorAvatar: { alignItems: "center", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  trustedExecutorAvatarText: { color: color.white, fontSize: 19, fontWeight: "900" },
  trustedExecutorCopy: { flex: 1, marginLeft: 9 },
  trustedExecutorName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  trustedExecutorMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  trustedExecutorRating: { color: color.ink, fontSize: 18, fontWeight: "900" },
  trustedExecutorStats: { flexDirection: "row", gap: 6, marginTop: 11 },
  trustedExecutorStat: { backgroundColor: "#F6F1F8", borderRadius: 10, flex: 1, minHeight: 54, paddingHorizontal: 8, paddingTop: 8 },
  trustedExecutorStatValue: { color: color.ink, fontSize: 11, fontWeight: "900" },
  trustedExecutorStatLabel: { color: color.muted, fontSize: 11, marginTop: 5 },
  trustedSuggestion: { backgroundColor: "#FBF9FC", borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 10, padding: 12, ...shadows.card },
  trustedSuggestionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  trustedSuggestionTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  trustedSuggestionHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  trustedSuggestionBody: { backgroundColor: color.white, borderRadius: 12, marginTop: 9, padding: 11 },
  trustedSuggestionBodyTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  trustedSuggestionBodyText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  trustedInviteTouchable: { borderRadius: 14, marginTop: 12, overflow: "hidden" },
  trustedInvite: { alignItems: "center", borderRadius: 14, justifyContent: "center", minHeight: 51 },
  trustedInviteText: { color: color.white, fontSize: 11, fontWeight: "900" },
  trustedReturn: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, justifyContent: "center", marginTop: 8, minHeight: 51 },
  trustedReturnText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  diagnosticTitleRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  diagnosticTag: { backgroundColor: "#F3EAFD", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  diagnosticTagText: { color: "#7039BE", fontSize: 11, fontWeight: "900" },
  diagnosticHero: { backgroundColor: "#211B2D", borderRadius: 20, marginTop: 10, padding: 14 },
  diagnosticHeroTop: { flexDirection: "row", justifyContent: "space-between" },
  diagnosticHeroTitle: { color: color.white, fontSize: 16, fontWeight: "900" },
  diagnosticHeroText: { color: "#D8D1E0", fontSize: 11, lineHeight: 15, marginTop: 5, maxWidth: 260 },
  diagnosticScore: { color: color.white, fontSize: 26, fontWeight: "900", textAlign: "right" },
  diagnosticScoreLabel: { color: "#D8D1E0", fontSize: 11, fontWeight: "700", marginTop: 2, textAlign: "right" },
  diagnosticMetrics: { flexDirection: "row", gap: 6, marginTop: 12 },
  diagnosticMetric: { backgroundColor: "#3A304A", borderRadius: 10, flex: 1, minHeight: 54, padding: 8 },
  diagnosticMetricValue: { color: color.white, fontSize: 12, fontWeight: "900" },
  diagnosticMetricLabel: { color: "#D8D1E0", fontSize: 11, marginTop: 7 },
  diagnosticInsightGrid: { flexDirection: "row", gap: 7, marginTop: 9 },
  diagnosticInsight: { backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1, flex: 1, minHeight: 115, padding: 10, ...shadows.card },
  diagnosticInsightKicker: { color: color.muted, fontSize: 11, fontWeight: "800" },
  diagnosticInsightValue: { color: color.ink, fontSize: 20, fontWeight: "900", marginTop: 7 },
  diagnosticInsightText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 6 },
  diagnosticActions: { backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, marginTop: 10, padding: 11, ...shadows.card },
  diagnosticActionsHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  diagnosticActionsTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticActionsHint: { color: color.muted, fontSize: 11, fontWeight: "700" },
  diagnosticActionItem: { backgroundColor: "#FCFBFD", borderRadius: 12, marginTop: 8, padding: 10 },
  diagnosticActionTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  diagnosticActionText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  diagnosticActionButtons: { flexDirection: "row", gap: 7, marginTop: 10 },
  diagnosticCreate: { alignItems: "center", backgroundColor: color.ink, borderRadius: 10, flex: 1, paddingVertical: 9 },
  diagnosticCreateText: { color: color.white, fontSize: 11, fontWeight: "900" },
  diagnosticFind: { alignItems: "center", backgroundColor: "#F3EEF8", borderRadius: 10, flex: 1, paddingVertical: 9 },
  diagnosticFindText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticRecipe: { borderColor: "#D8CBDD", borderRadius: 16, borderStyle: "dashed", borderWidth: 1, marginTop: 10, padding: 11 },
  diagnosticRecipeTitle: { color: color.ink, fontSize: 11, fontWeight: "900" },
  diagnosticRecipeText: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  primaryCta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, marginTop: 10, paddingVertical: 10 },
  primaryCtaText: { color: color.white, fontSize: 11, fontWeight: "800" },
  lightCta: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, marginTop: 7, paddingVertical: 10 },
  lightCtaText: { color: color.ink, fontSize: 11, fontWeight: "800" },
  fallbackSection: { marginTop: 3 },
  messagesHead: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  messagesHeadActions: { flexDirection: "row", gap: 6, marginTop: 7 },
  messageIconButton: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1, height: 28, justifyContent: "center", position: "relative", width: 28 },
  messageIconText: { color: color.ink, fontSize: 13, fontWeight: "900" },
  messageNoticeDot: { backgroundColor: color.magenta, borderRadius: 4, height: 7, position: "absolute", right: 2, top: 2, width: 7 },
  messageTabs: { backgroundColor: "#F1EDF3", borderRadius: 12, flexDirection: "row", marginTop: 8, padding: 3 },
  messageTab: { alignItems: "center", flex: 1, paddingVertical: 7 },
  messageTabActive: { alignItems: "center", backgroundColor: color.white, borderRadius: 9, flex: 1, paddingVertical: 7 },
  messageTabText: { color: color.muted, fontSize: 11, fontWeight: "800" },
  messageTabActiveText: { color: color.ink, fontSize: 11, fontWeight: "900" },
  messageThread: { alignItems: "center", backgroundColor: color.white, borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 9, paddingVertical: 10 },
  messageAvatar: { alignItems: "center", backgroundColor: "#F1E8FF", borderRadius: 13, height: 38, justifyContent: "center", width: 38 },
  messageAvatarSoft: { backgroundColor: "#F5F1F8" },
  messageAvatarDark: { backgroundColor: color.ink },
  messageAvatarText: { color: color.ink, fontSize: 12, fontWeight: "900" },
  messageThreadCopy: { flex: 1 },
  messageThreadTop: { alignItems: "center", flexDirection: "row", gap: 5 },
  messageThreadName: { color: color.ink, fontSize: 11, fontWeight: "800" },
  messageContext: { backgroundColor: "#F1EDF3", borderRadius: 999, color: "#756A7B", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 2 },
  messageThreadPreview: { color: color.muted, fontSize: 11, marginTop: 3 },
  messageThreadMeta: { alignItems: "flex-end", gap: 4 },
  messageTime: { color: color.muted, fontSize: 11 },
  messageUnread: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 8, height: 16, justifyContent: "center", minWidth: 16, paddingHorizontal: 4 },
  messageUnreadText: { color: color.white, fontSize: 11, fontWeight: "900" },
  messageChev: { color: "#A59EAA", fontSize: 16 },

  // 钱包页面。
  walletDarkCard: {
    backgroundColor: color.ink,
    borderRadius: 16,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: 18
  },
  walletDarkLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600" },
  walletDarkAmount: { color: color.white, fontSize: 24, fontWeight: "900", marginTop: 4 },
  walletDarkHint: { color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 },
  walletCard: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.card
  },
  walletCardLabel: { color: color.ink, fontSize: 11, fontWeight: "700" },
  walletCardValue: { color: color.ink, fontSize: 16, fontWeight: "800", marginTop: 4 },
  walletCardHint: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  walletAction: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.card
  },
  walletActionIcon: { backgroundColor: "#F5F1F7", borderRadius: 10, fontSize: 16, height: 36, textAlign: "center", lineHeight: 36, width: 36 },
  walletActionBody: { flex: 1 },
  walletActionLabel: { color: color.ink, fontSize: 11, fontWeight: "700" },
  walletActionDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  walletActionArrow: { color: color.muted, fontSize: 16 },
  walletBtnLight: {
    alignItems: "center",
    borderColor: color.line,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 4,
    paddingVertical: 11
  },
  walletBtnLightText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  // 子页面结构化内容。
  subSection: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
    ...shadows.card
  },
  subSectionTitle: {
    backgroundColor: color.surface,
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    color: color.muted,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  customSectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700", marginTop: 10 },
  customSectionHint: { color: color.muted, fontSize: 11, marginBottom: 2, marginTop: 1 },
  subRow: {
    borderBottomColor: color.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  subRowLabel: { color: color.ink, fontSize: 11, fontWeight: "600", flex: 1 },
  subRowValue: { color: color.muted, fontSize: 11, flex: 1, textAlign: "right" },

  // 偏好记忆。
  memorySection: { marginTop: 13 },
  memorySectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
    paddingHorizontal: 2
  },
  memorySectionTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  memorySectionCount: { color: color.muted, fontSize: 11 },
  memoryCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginBottom: 6,
    padding: 12,
    ...shadows.card
  },
  memoryCardBody: {
    alignItems: "center",
    flexDirection: "row"
  },
  memoryCardLeft: { flex: 1 },
  memoryLabel: { color: color.ink, fontSize: 11, fontWeight: "800", marginBottom: 4 },
  memoryValue: { color: color.ink, fontSize: 12, lineHeight: 17, fontWeight: "700" },
  memorySource: { color: "#8B8292", fontSize: 11, marginTop: 6, lineHeight: 15 },
  memoryCardRight: { alignItems: "center", flexDirection: "row", gap: 4 },
  memoryStatusConfirmed: {
    backgroundColor: "#EEF8D6",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  memoryStatusText: { color: "#506900", fontSize: 11, fontWeight: "900" },
  memoryStatusSuggested: {
    backgroundColor: "#F1E8FF",
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 4
  },
  memoryStatusTextSuggested: { color: "#6330B2", fontSize: 11, fontWeight: "900" },
  memoryChev: { color: "#B0A8B5", fontSize: 18 },
  memoryDarkCard: {
    backgroundColor: color.ink,
    borderRadius: 16,
    marginBottom: 10,
    padding: 12
  },
  memoryDarkTitle: { color: color.white, fontSize: 11, fontWeight: "700" },
  memoryDarkBody: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 15, marginTop: 4 },
  memoryBtnLight: {
    backgroundColor: color.white,
    borderColor: color.line,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 6,
    paddingVertical: 10,
    alignItems: "center"
  },
  memoryBtnLightText: { color: color.ink, fontSize: 11, fontWeight: "700" },

  // 二维码网格（原型 .r159QR：白底 + #17131F 点）。
  fakeQr: {
    alignContent: "flex-start",
    backgroundColor: color.white,
    borderColor: "#EAE5ED",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    ...shadows.card
  },
  fakeQrCell: { backgroundColor: "transparent", borderRadius: 1 },
  fakeQrCellOn: { backgroundColor: "#17131F" },

  // 二维码卡片（原型 .r159QRWrap）。
  qrCard: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    marginVertical: 8,
    padding: 12,
    ...shadows.card
  },
  qrCardCenter: { flexDirection: "column" },
  qrCardText: { flex: 1 },
  qrCardTextCenter: { alignItems: "center", flex: 1, width: "100%" },
  qrCardTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  qrCardDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginVertical: 4 },
  qrCardBtn: {
    alignSelf: "flex-start",
    backgroundColor: color.ink,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  qrCardBtnText: { color: color.white, fontSize: 11, fontWeight: "900" },

  // 社媒 / 导航行（原型 .r159SimpleRow）。
  socialRow: {
    alignItems: "center",
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    marginVertical: 6,
    padding: 11
  },
  socialRowIcon: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 10,
    height: 31,
    justifyContent: "center",
    width: 31
  },
  socialRowIconText: { color: "#6F37B9", fontSize: 11, fontWeight: "900" },
  socialRowCopy: { flex: 1 },
  socialRowLabel: { color: color.ink, fontSize: 11, fontWeight: "800" },
  socialRowDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  socialRowChev: { color: "#A59EAA", fontSize: 15 },

  // 个人主页 hero（原型 .r159Hero + .r159TrustStrip）。
  heroCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginVertical: 8,
    padding: 13,
    ...shadows.card
  },
  heroTop: { alignItems: "center", flexDirection: "row", gap: 10 },
  heroAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  heroAvatarText: { color: color.white, fontSize: 18, fontWeight: "900" },
  heroCopy: { flex: 1 },
  heroName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  heroMeta: { color: color.muted, fontSize: 11, marginTop: 3 },
  heroStatus: {
    backgroundColor: "#EEF8D6",
    borderColor: "#DFEBC7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  heroStatusText: { color: "#465C00", fontSize: 11, fontWeight: "900" },
  availabilityOverlay: { backgroundColor: "rgba(20,18,31,0.46)", flex: 1, justifyContent: "flex-end", padding: 12 },
  availabilitySheet: { backgroundColor: color.white, borderRadius: 25, padding: 19 },
  availabilityTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  availabilitySub: { color: color.muted, fontSize: 11, lineHeight: 15, marginBottom: 12, marginTop: 4 },
  availabilityOption: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 11 },
  availabilityOptionActive: { backgroundColor: "#FAF8FB", borderColor: color.ink, borderWidth: 1.5 },
  availabilityMark: { alignItems: "center", backgroundColor: "#F2EDF5", borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  availabilityMarkActive: { backgroundColor: color.ink },
  availabilityCopy: { flex: 1 },
  availabilityOptionTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  availabilityOptionDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 3 },
  availabilityAction: { color: "#62586A", fontSize: 11, fontWeight: "900" },
  trustStrip: {
    flexDirection: "row",
    gap: 6,
    marginTop: 11
  },
  trustStripItem: {
    alignItems: "center",
    backgroundColor: "#F8F6FA",
    borderRadius: 11,
    flex: 1,
    paddingVertical: 8
  },
  trustStripValue: { color: color.ink, fontSize: 12, fontWeight: "800" },
  trustStripLabel: { color: color.muted, fontSize: 11, marginTop: 2 },

  // 隐私阶梯（原型 .r159PrivacyLadder）。
  privacyLadder: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 17,
    borderWidth: 1,
    marginVertical: 8,
    padding: 11,
    ...shadows.card
  },
  privacyStep: {
    alignItems: "center",
    borderBottomColor: "#F1EDF3",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9
  },
  privacyStepIndex: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 8,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  privacyStepIndexText: { color: "#6C3CB3", fontSize: 11, fontWeight: "900" },
  privacyStepCopy: { flex: 1 },
  privacyStepTitle: { color: color.ink, fontSize: 11, fontWeight: "700" },
  privacyStepDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  privacyStepTag: {
    backgroundColor: "#F7F4F9",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  privacyStepTagText: { color: "#716879", fontSize: 11, fontWeight: "800" },

  // 商家店铺顶（原型 .storetop）。
  storeTop: {
    backgroundColor: color.ink,
    borderRadius: 17,
    marginVertical: 8,
    padding: 14
  },
  storeTopRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  storeAvatar: {
    alignItems: "center",
    borderRadius: 15,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  storeAvatarText: { color: color.white, fontSize: 20, fontWeight: "900" },
  storeStats: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12
  },
  storeStatItem: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 11,
    flex: 1,
    paddingVertical: 8
  },
  storeStatValue: { color: color.white, fontSize: 12, fontWeight: "800" },
  storeStatLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 },

  // 经营入口网格（原型 .bizgrid8）。
  bizGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 4
  },
  bizTile: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 14,
    borderWidth: 1,
    padding: 11,
    width: "48%"
  },
  bizTileIcon: {
    alignItems: "center",
    backgroundColor: "#F5F1F8",
    borderRadius: 9,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  bizTileIconText: { color: "#6F37B9", fontSize: 12, fontWeight: "900" },
  bizTileLabel: { color: color.ink, fontSize: 11, fontWeight: "800", marginTop: 7 },
  bizTileDesc: { color: color.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },

  // 今天的 Offer 卡片。
  offerCard: {
    backgroundColor: color.white,
    borderColor: "rgba(20,18,31,0.04)",
    borderRadius: 15,
    borderWidth: 1,
    marginVertical: 5,
    padding: 11,
    ...shadows.card
  },
  offerTitle: { color: color.ink, fontSize: 11, fontWeight: "800" },
  offerMeta: { color: color.muted, fontSize: 11, marginTop: 3 }
});
