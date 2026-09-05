// 原型子页面内容映射 — 每个路由对应原型中的页面标题、描述和关键内容。
export const SUB_PAGE_CONTENT: Record<string, { title: string; desc: string; icon: string; sections?: Array<{ title: string; rows: Array<{ label: string; value: string }> }> }> = {
  myscenes: {
    title: "我的场景",
    desc: "R15.13 Scene Value Exchange · 我发起的 Scene 与收到的邀请。预算进场景，不买人。",
    icon: "◎",
    sections: [
      { title: "进行中", rows: [{ label: "West Lake Photo Afternoon", value: "INVITING · 2/4 确认 · 饮品 included" }, { label: "周末西湖聚餐", value: "DRAFT · 需补锚点" }]},
      { title: "收到的邀请", rows: [{ label: "Rooftop Sunset", value: "David 邀请 · 交通支持100K · 待回应" }]},
      { title: "历史", rows: [{ label: "已完成 3 · 到场 2", value: "满意度 4.6 · 复访 1" }]},
    ]
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
    sections: []
  },
  facet: {
    title: "FACET · 对象化内容运营",
    desc: "同一份真实素材，针对不同对象重新组织呈现方式。",
    icon: "✨",
    sections: []
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
  personalmanage: {
    title: "个人总管理",
    desc: "基本信息、二维码、状态管理。个人主页走 Threads R2 对外展示。",
    icon: "profile-ring",
    sections: [
      { title: "段 1 基本信息", rows: [
        { label: "头像", value: "点换头像" },
        { label: "名字", value: "点编辑资料修改" },
        { label: "handle", value: "点编辑资料修改" },
        { label: "城市", value: "点编辑资料修改" }
      ]},
      { title: "段 2 二维码", rows: [
        { label: "主页链接分享", value: "二维码图形升级中，先分享链接" },
        { label: "可见范围", value: "TikTok / Zalo / Instagram 按设置展示" }
      ]},
      // 与 AVAILABILITY_OPTIONS（me-types.ts 唯一源）逐字对齐，之前这里是
      // 繁忙/暂离旧文案且缺隐身。
      { title: "段 3 状态管理", rows: [
        { label: "可接单", value: "进入人物发现与合适机会分发" },
        { label: "忙碌", value: "保留主页，降低即时机会" },
        { label: "暂不接单", value: "暂停机会分发" },
        { label: "隐身", value: "从公开人物发现中隐藏" }
      ]}
    ]
  },
  personalhub: {
    title: "个人主页",
    desc: "把个人状态、Proxy 信誉、外部社媒和二维码放进一个用户可控的个人中枢。",
    icon: "○",
    sections: [
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
  friendcrm: {
    title: "好友与关系",
    desc: "关系图 · 轻 CRM · 标签、备注、来源与互动记录。",
    icon: "◎"
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
