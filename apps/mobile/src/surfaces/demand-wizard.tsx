// DemandWizard — R58 发布需求向导（选 Moment → 选人 → 规格确认 → 成功）。
//
// 对齐 R58 原型：顶 tabs、搜索+生成、筛选、当前需求、专业协助入口、
// 选人（浏览+筛选+跳过）、规格、价格说明、成功页。发布走
// marketplace.publish（成功即进市场）；选人仅浏览意向（发布恒为
// 公开市场）；草稿存本机。一期备注随机会落库（见 demand-moments）。
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MarketplaceClient } from "../marketplace-client";
import type { MarketOpportunity } from "../market-fixtures";
import type { SupplierCandidate, SupplyClient } from "../supply-client";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { color } from "../theme";
import {
  buildDemandPublishInput,
  DEFAULT_PEOPLE_FILTERS,
  defaultSpecsFor,
  DURATION_OPTIONS,
  filterSuppliers,
  HEADCOUNT_OPTIONS,
  MOMENT_ACTION_ID,
  MOMENT_TEMPLATES,
  momentDistanceLabel,
  momentMetaLine,
  momentStartPrice,
  normalizeDuration,
  normalizeHeadcount,
  normalizeTimeSlot,
  PRO_LOGOS,
  PRO_SERVICES,
  PRO_TABS,
  TIME_SLOT_OPTIONS,
  type DemandSpecs,
  type MomentTemplate,
  type PeopleSheetFilters,
  type ProDomain,
  type ProService
} from "../demand-moments";
import { resolveAssetSource } from "../media/asset-sources";
import { MapCanvas } from "../components/map-canvas";
import { SCENE_ACTIONS } from "../components/scene-activity-discovery";
import { Image } from "expo-image";
import { CircularAvatarImage } from "../components/circular-avatar-image";
// 头像进主页的 photo→URI 解析跟 business-home/商家侧同一条（resolveCreatorPhoto）。
import { resolveCreatorPhoto } from "./merchant-creator-recommendations";
// 候选行上的读数一律走共享格式化，不在这里另写一份 —— CREATOR-LIST-CARD-001 /
// CREATOR-AVATAR-001 立的口径：同一份 SupplierCandidate 在多个面里各写一份，
// 就会出现「同一个人两个价」「同一个人两个分」，用户只能猜哪个是错的。
// 尤其是报价：本文件原来手写 `Math.round(referencePrice / 1000)}K`，对 1_200_000
// 会印出「1200K VND」，而共享实现印「1.2tr VND」（越南盾百万位要写 tr）。
import { creatorRatingLabel, formatServiceVolume, labelLanguage } from "../creator-capability-labels";
import { formatReferencePrice } from "../creator-pricing";
import { localApiBaseUrl } from "../native-clients";
// 卡面右下角的距离（用户选「接真实距离」）：真实定位 + 真实场景目录。
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { loadSceneSpots, type SceneSpot } from "../activity-create-form";
import type { SceneOrigin } from "../scene-shop-directory";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyIcon } from "../components/proxy-icon";
// SCENE-CARD-REUSE-001（2026-10-06，用户「还是没有引用 home-场景list 代码」）：
// 选场景步不再自己拼列表（SceneCoverCard 版也删了），直接挂 home 场景卡片点进去
// 的那份场景 list 本体 SceneShopDirectory —— 数据加载 / 距离排序 / 筛选 / 单店
// 详情全部是它自己的，向导只通过 onPick 把选中的场景带回来。
import { SceneShopDirectory } from "../components/scene-shop-directory";

// DEMAND-SCENE-FIRST-001（2026-10-06）：「scene」这一步是为了把「选人」从默认路径上
// 挪走而存在的。
//
// 用户原话：「不能一来就是人 list，只有专业模式才能是人 list，娱乐跟场景相关的
// 优先选场景」「选人是要低调点 不要做成第一排」。
//
// 结构上原来的 `Step` 只有 moment → people → specs，选人**必然独占一整屏**，所以
// 「低调」在旧结构里做不到 —— 它是被 Step 的形状逼出来的，不是样式问题。现在：
//   娱乐/场景类  moment → **scene（真实门店）** → specs
//   专业        moment → people（人 list，专业就是靠人变现）
//   运动        moment → specs（绑人，不进场景 list；目录里本来也没有球馆/绿道）
// 「直接约」在 specs 底部是一行小字入口，不是一步。
type Step = "moment" | "people" | "specs" | "done";

/**
 * 接单方式。用户 2026-10-06 定名：**等接单** / **直接约**。
 *
 * 两个硬约束：
 *  1. **不要写那个代称**（用户 2026-10-06 点名：不要代它，也不要说「等它接单」）。
 *     调性依据同 `market-fixtures.ts` 的「R4 决定：移除体验上架（真人货架）以不
 *     拉低接单方身价」—— 所以本文件全文不出现那个词，门禁按字面扫。
 *  2. **不要把「抢」字上界面**。机制上是先到先得，但「抢」字把接单方写成抢食的人，
 *     与上面那条决定直接打架。契约/内部沟通可以用 `open`/`direct`，界面只用
 *     「等接单 / 直接约」。
 *
 * ⚠️ 2026-10-07 更正（DEMAND-TARGET-KEEP-001）：上面「两种模式发布行为完全一样」那句
 * **已经过期**。它当时的理由写在下面 —— 「定向邀请要改 PublishMarketOpportunityInput
 * 契约，那是另一个决定，不在本次范围」。**那个契约字段已经存在了**：
 * `PublishMarketOpportunityInput.targetUserId`（OPP-TARGETED-001，注释原话「选人 →
 * 向 TA 发出邀约；带上后 server 把机会快照为 targetAccountId 非空，List 只对目标人和
 * owner 可见，Apply 只收目标人」），而且 market.tsx 的发布表单**一直在发**它
 * （`...(targetAgent ? { targetUserId: targetAgent.agentId } : {})`）。
 * 于是本向导是唯一一处把选择丢在半路的地方：收了 selectedPerson、界面上写着
 * 「意向人选：X」，wire 上却不带 —— 用户 2026-10-07「不能丢弃搭子选择」。
 * 现在：`direct` + 选了人 → 带 targetUserId（定向邀约）；其余 → 不带（公开发布，
 * wire 形状与改动前逐字节相同）。`open` 仍是默认，文案口径「等接单 / 直接约」不变。
 */
type FulfillMode = "open" | "direct";

// R58 原型单行 quick-filter：全部 / 1:1 / 3–4 人 / 晚间 / 周末 / 主题玩法。
const QUICK_FILTERS = [
  { id: "all", label: "全部" },
  { id: "one", label: "1:1" },
  { id: "small", label: "3–4 人" },
  { id: "evening", label: "晚间" },
  { id: "weekend", label: "周末" },
  { id: "theme", label: "主题玩法" }
] as const;
type QuickFilterId = typeof QUICK_FILTERS[number]["id"];

// 2026-10-06 用户：「其它改 就改成热门 娱乐 专业就可以 …… 先3个够了 以后跑起来再说吧」。
// rail 从五档收成三档：**热门（全部）/ 娱乐（所有非 pro 的 Moment）/ 专业（城市协助服务）**。
// 上一轮我保留五档的理由是「照原型的 3 项会丢见面/出行/主题三档 + 5 个模板」——
// 用户明确要 3 档，所以改用「娱乐吃下所有消费类 Moment」的收法，**一个模板都没丢**：
// 喝咖啡/吃饭/拍照/City Walk/看展 全归娱乐，只是不再细分。
// 数据层的 `MomentTemplate.category`（meet/fun/outdoor/theme）**语义不动** —— 它是 Moment
// 家族，还被「主题玩法」那条 quick-filter 用着；rail 的分档比它粗，见下面 moments 的过滤。
// （下面「加运动」那轮给这个 union 补了 `"sport"`：不是改旧值，是加一个新值。）
//
// 2026-10-06 同轮追加：「说错 加运动」。上一版这里写着「没做 —— 本仓没有运动类 Moment
// 模板，加一档只会得到一个点开空白的分类」；用户要加，所以**模板和档位一起加**：
// demand-moments.ts 补了打球 / 骑行两条（category: "sport"，图标复用 sport.svg /
// cycling.svg），rail 才有第四档可点。档位与模板必须同进同出 —— 只加档位就是空标签。
// 「基本够了」按 2 条算，不铺满运动家族（跑步/网球/瑜伽…）。
const CATEGORIES = [
  { id: "all", label: "热门" },
  { id: "fun", label: "娱乐" },
  { id: "sport", label: "运动" },
  { id: "pro", label: "专业" }
] as const;
type CategoryId = typeof CATEGORIES[number]["id"];

const TIME_FILTERS = ["全部", "晚间", "下午", "周末"];
// DEMAND-DURATION-001：时长三颗 chips（「2 小时 / 半天 / 全天」）已删，换成 1–8 小时
// 滚轮（DURATION_OPTIONS）。模板的 defaultDuration 只当默认值的来源。
// DEMAND-PREFS-REMOVE-001：场景偏好行已删（用户「在这个页面没什么用」），连同它的
// 选项常量一起清掉 —— 默认偏好照旧随发布走（见 demand-moments 的 defaultSpecsFor）。
const PEOPLE_FILTERS = ["推荐", "附近", "现在可用", "已认证"] as const;

const DRAFT_KEY = "proxy.demandWizard.draft.v1";

type DraftState = { templateId: string; specs: DemandSpecs };

// DEMAND-DIRECT-LIST-001（2026-10-07，用户「直接约没有接真人接单list啊」）：
// 候选行原来只在「选人」步里内联写了一遍。规格页的「直接约」现在要画**同一批人**，
// 所以抽成一个组件两处共用 —— 否则就是 CREATOR-AVATAR-001 警告过的
// 「同一份 SupplierCandidate 在两个面里画法不一样」。
//
// ⚠️ 行上的读数**不照抄原型**。原型那张人卡写的是「★ 4.9 · 128 单 · 1.2km ·
// 200K/小时 起」，而 SupplierCandidate 里**没有**星级、也**没有**距离：它有的是
// rating.total（服务端 matching.Score 的 0..100 分）、真实 completedOrders
// （Postgres 订单表）和真实 referencePrice。照抄那几个数就是
// CREATOR-LIST-CARD-001 第 2 条禁的那件事 —— 让编造的东西看起来像真实读数。
// 所以这里印的是「评级 · N 分」「服务 N 单」；没成交记录一律印「新人」不编分。
function PersonRow({ person, active, onOpenProfile, onSelect }: {
  person: SupplierCandidate;
  active: boolean;
  onOpenProfile?: ((person: SupplierCandidate, avatarUri?: string) => void) | undefined;
  onSelect: () => void;
}): React.JSX.Element {
  const photo = person.photos.length > 0
    ? resolveAssetSource(
        person.photos[0]!.startsWith("/") ? { kind: "serverPath", path: person.photos[0]! } : { kind: "remote", url: person.photos[0]! },
        { baseUrl: localApiBaseUrl }
      )
    : undefined;
  const ratingLine = creatorRatingLabel(person.rating);
  return (
    <View style={[styles.personCard, active && styles.momentCardOn]}>
      {/* 点位分工（2026-10-06 用户口径，场景侧同款）：头像 = 看主页，
          卡片其余部分 = 选择。主页由调用方接（app-shell 的
          OtherProfileSurface），回调没给就不可点。 */}
      {typeof photo === "object" ? (
        <Pressable accessibilityLabel={`看${person.name}主页`} disabled={!onOpenProfile} onPress={() => onOpenProfile?.(person, resolveCreatorPhoto(person.photos[0]))}>
          <CircularAvatarImage accessibilityLabel={`${person.name}头像`} size={44} source={photo} />
        </Pressable>
      ) : (
        onOpenProfile
          ? <Pressable accessibilityLabel={`看${person.name}主页`} onPress={() => onOpenProfile?.(person)}>
              <View style={styles.personAvatar}><Text selectable style={styles.personAvatarText}>{person.name.trim().charAt(0) || "?"}</Text></View>
            </Pressable>
          : <View style={styles.personAvatar}><Text selectable style={styles.personAvatarText}>{person.name.trim().charAt(0) || "?"}</Text></View>
      )}
      <View style={styles.personCopy}>
        <View style={styles.personNameRow}>
          <Text selectable style={styles.personName}>{person.name}</Text>
          {person.eligibility.capabilitiesOk ? <Text selectable style={styles.certBadge}>已认证</Text> : null}
        </View>
        {/* 语言印全称（labelLanguage）：中国用户不认 ZH/VI 这类缩写。 */}
        <Text selectable style={styles.personMeta}>
          {person.languages.length > 0 ? person.languages.map(labelLanguage).join(" · ") : person.serviceType}
          {" · "}{person.availability ? "有档期" : "档期待确认"}
        </Text>
        <Text selectable style={styles.personMeta}>
          {formatReferencePrice(person.referencePrice, person.currency)}
          {ratingLine !== "" ? ` · ${ratingLine}` : ""}
          {` · ${formatServiceVolume(person.rating?.completedOrders)}`}
        </Text>
      </View>
      <Pressable accessibilityLabel={`选择${person.name}`} onPress={onSelect} style={[styles.selectBtn, active && styles.selectBtnOn]}>
        <Text selectable style={[styles.selectText, active && styles.selectTextOn]}>{active ? "已选择" : "选择 TA"}</Text>
      </Pressable>
    </View>
  );
}

export function DemandWizard({ marketplace, supply, onBack, onPublished, onViewMarket, onCreateActivity, onOpenPersonProfile }: {
  marketplace: MarketplaceClient;
  supply?: SupplyClient | undefined;
  onBack: () => void;
  onPublished: (opportunity: MarketOpportunity) => void;
  onViewMarket: () => void;
  onCreateActivity: () => void;
  // 2026-10-06 用户：「任何场景 人物 点击头像 可以看详情页」。有回调时选人步的
  // 头像可点开主页（app-shell 接 OtherProfileSurface，business-home 的 creator
  // 头像走的就是同一条）；不传则头像不可点，选择行为不变。
  onOpenPersonProfile?: ((person: SupplierCandidate, avatarUri?: string) => void) | undefined;
}): React.JSX.Element {
  const [step, setStep] = useState<Step>("moment");
  // UI-ORDER-LOGO-001: Moment 图标复用场景动作既有 logo（不是另做一套）
  const actionIconFor = (momentId: string): number | undefined => SCENE_ACTIONS.find((item) => item.id === MOMENT_ACTION_ID[momentId])?.icon as number | undefined;
  // 「专业」四行服务的 logo。2026-10-06 用户连着两轮问「专业服务为什么没有 logo」/
  // 「还是没找回专业的 logo 啊」—— 这四行一直只画单字 mark（文/签/法/商），
  // 而 Moment 那几行走 actionIconFor() 拿到场景动作 SVG，同一格里一边有图一边只有字。
  // 资产来源（scene → 场景动作既有 SVG；icon → ProxyIcon 矢量字形；都没配才回落 mark）
  // 与逐条依据写在 demand-moments.ts 的 PRO_LOGOS，这里只负责画。
  const proLogoNode = (service: ProService): React.JSX.Element => {
    const logo = PRO_LOGOS[service.id];
    if (logo !== undefined && "scene" in logo) {
      const art = SCENE_ACTIONS.find((item) => item.id === logo.scene)?.icon as number | undefined;
      if (art !== undefined) return <Image contentFit="contain" source={art} style={styles.momentIcon} />;
    }
    if (logo !== undefined && "icon" in logo) return <ProxyIcon color={color.ink} name={logo.icon} size={24} />;
    return <Text selectable style={styles.momentEmojiText}>{service.mark}</Text>;
  };
  // R58 城市协助 · Professional：当前选中的服务（现场翻译 / 签证协助 / 法律咨询 / 商务协助）
  const [proService, setProService] = useState<string | undefined>(undefined);
  // 「专业」分类下的子标签（原型 sub-tabs：全部 / 翻译 / 签证 / 法律 / 商务）。
  const [proTab, setProTab] = useState<"all" | ProDomain>("all");
  // 服务卡默认折叠：不占用 Moment 列表与底部「选择」之间的空间，避免误触/遮挡
  // 只记录选择：再点同一张卡＝取消选择（并把模板一并清掉，避免留下「城市协助但没选服务」的悬空态）
  const selectProService = (service: ProService): void => {
    const pro = MOMENT_TEMPLATES.find((item) => item.id === "pro");
    if (!pro) return;
    if (proService === service.id) {
      setProService(undefined);
      setTemplate((current) => (current?.id === "pro" ? undefined : current));
      setError(undefined);
      return;
    }
    setProService(service.id);
    setSpecs({ ...defaultSpecsFor(pro), price: service.price === "面议" ? "" : service.price });
    setTemplate(pro);
  };
  const [template, setTemplate] = useState<MomentTemplate | undefined>(undefined);
  const [specs, setSpecs] = useState<DemandSpecs>(() => defaultSpecsFor(MOMENT_TEMPLATES[0]!));
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilterId>("all");
  const [category, setCategory] = useState<CategoryId>("all");
  const [peopleFilters, setPeopleFilters] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFilters, setSheetFilters] = useState<PeopleSheetFilters>(DEFAULT_PEOPLE_FILTERS);
  const [people, setPeople] = useState<SupplierCandidate[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SupplierCandidate>();
  // 接单方式（等接单 / 直接约）：非专业模板默认「等接单」；专业**没有默认** ——
  // 用户 2026-10-06 原话「专业模式…依靠专业能力变现的 没有默认」，所以 pro 进
  // specs 前必须显式选一个，没选就不放行发布（见 specs 步的 publish 禁用）。
  // peopleReturn：people 步现在有两个入口（专业从 moment 进、直接约从 specs 进），
  // 「上一步」回到入口那一屏，不能写死。
  const [mode, setMode] = useState<FulfillMode>();
  const [peopleReturn, setPeopleReturn] = useState<Step>("specs");
  const [publishing, setPublishing] = useState(false);
  const [negotiable, setNegotiable] = useState(false);
  // DEMAND-HEADCOUNT-003：下拉菜单的开关（常态只露触发器那一行）。
  const [headcountOpen, setHeadcountOpen] = useState(false);
  // DEMAND-TIMESLOT-001：同上，时间段下拉的开关。
  const [timeOpen, setTimeOpen] = useState(false);
  // DEMAND-DURATION-001：同上，时长滚轮的开关。
  const [durationOpen, setDurationOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<MarketOpportunity>();
  const [draftRestored, setDraftRestored] = useState(false);
  // 卡面右下角的距离（用户选「接真实距离」）：真实场景目录 + 真实定位。
  // 两者各管各、失败互不挡 —— 与 activity-wizard 同一套。
  const [scenes, setScenes] = useState<readonly SceneSpot[]>([]);
  const [origin, setOrigin] = useState<SceneOrigin>();

  // 草稿：本机存取上次的模板+规格，进页恢复，发布成功清除。
  useEffect(() => {
    let cancelled = false;
    void nativeSecureStorageDriver.getItem(DRAFT_KEY).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const parsed = JSON.parse(raw) as Partial<DraftState>;
        const found = MOMENT_TEMPLATES.find((item) => item.id === parsed.templateId);
        if (!found || !parsed.specs || typeof parsed.specs !== "object") return;
        const draft = parsed.specs as Partial<DemandSpecs>;
        if (cancelled) return;
        setTemplate(found);
        // 草稿只存模板+规格，接单方式不存：恢复时按同一套默认（非专业等接单，
        // 专业无默认）重新给，跟点选模板走的是同一条规则。
        // DEMAND-HEADCOUNT-002：老草稿的自由文本人数收敛到 1–6（默认 1 人）。
        // DEMAND-TIMESLOT-001：老草稿的时间（「今晚 19:00」「下午」…）收敛到档位上。
        // DEMAND-DURATION-001：老草稿的时长（「半天」「全天」…）收敛到 1–8 小时。
        setMode(found.id === "pro" ? undefined : "open");
        setSpecs({ ...defaultSpecsFor(found), ...draft, prefs: Array.isArray(draft.prefs) ? draft.prefs : [], ratio: normalizeHeadcount(draft.ratio), time: normalizeTimeSlot(draft.time), duration: normalizeDuration(draft.duration) });
        setDraftRestored(true);
      } catch {
        // 坏草稿忽略。
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // 距离角标的两个来源：公开场景目录（免登）+ 设备定位。
  //
  // 2026-10-06 用户：「缺少距离字段」—— 截图里五张卡的底行只剩时长，一格距离都没有。
  // 根因不是算错，是**这一屏从来没问过定位**：getCurrentFix 的 requestPermission
  // 默认 false，本屏又没传 —— 没授权时它第一行就 return undefined，于是 origin 恒为
  // undefined，momentDistanceLabel 对每条模板都返回空串。新装、或者没逛过首页/热门
  // 的用户，永远看不到距离（模拟器的 TCC 里连一条 kTCCServiceLocation 都没有）。
  //
  // DEVICE-LOCATION-003 管的是**开屏**那一次（app-shell 挂载时定一次位，不能每次冷
  // 启动都弹），不是「任何一屏都不许问」。同一份定位的兄弟屏早就这么做了：
  // hot-scenes / scene-shop-directory 都是挂载时 requestPermission: true。这一屏也是
  // 用户主动点进来的（点「发布需求」），弹窗由用户动作触发，不违反那条口径。
  //
  // 拿到什么用什么：没授权/超时仍旧返回 undefined，卡面照旧不画距离，不编一个。
  useEffect(() => {
    let cancelled = false;
    void loadSceneSpots(fetch, localApiBaseUrl)
      .then((list) => { if (!cancelled) setScenes(list); })
      .catch(() => undefined);
    void getCurrentFix(expoLocationApi, { requestPermission: true }).then((fix) => {
      if (!cancelled && fix) setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
    });
    return () => { cancelled = true; };
  }, []);

  // 每条模板的距离只跟「场景目录 / 定位」有关 —— 别每帧重算一遍归属词子串匹配。
  const momentDistances = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const item of MOMENT_TEMPLATES) labels[item.id] = momentDistanceLabel(scenes, item.id, origin);
    return labels;
  }, [scenes, origin]);

  async function saveDraft(): Promise<void> {
    if (!template) {
      setError("先选一个 Moment 才能存草稿。");
      return;
    }
    try {
      await nativeSecureStorageDriver.setItem(DRAFT_KEY, JSON.stringify({ templateId: template.id, specs }));
      setError(undefined);
      setDraftRestored(true);
    } catch {
      setError("草稿保存失败，请重试。");
    }
  }

  const moments = MOMENT_TEMPLATES.filter((item) => {
    // 2026-10-06 合并：pro 不再当一张 Moment 卡出现在列表里（原来它挂在「主题」下，
    // 于是城市协助同时以三种样子出现：主题里的一张卡 + 双栏外的一张入口卡 +
    // 一格子卡 + 规格步再来一遍）。现在它是 rail 上的「专业」分类，只在那一格出现。
    // 数据层不动：pro 模板仍是发布载体 —— ORDER-SCENARIO-001 按
    // `template.id === "pro"` 把场景标成 assistance（订单流程据此走全流程）。
    if (item.id === "pro") return false;
    const q = query.trim().toLowerCase();
    if (q !== "" && !`${item.title}${item.venue}${item.theme}`.toLowerCase().includes(q)) return false;
    // rail 四档：热门（全部非 pro）/ 娱乐 / 运动 / 专业。
    // 娱乐与运动**互斥**，热门 = 娱乐 ∪ 运动（专业另算）。把运动从娱乐里摘出去是
    // **零可见变化**：运动模板是这一版新加的，此前娱乐 = 所有非 pro，与
    // 「所有非 pro 且非运动」在旧数据上完全一致 —— 没有哪条老模板被搬走。
    // rail 这一维只认 `MomentTemplate.category` 的「运动」一个值；meet/outdoor/theme
    // 仍然不参与分档（「主题玩法」那条 quick-filter 还在按 category === "theme" 筛）。
    if (category === "sport" && item.category !== "sport") return false;
    if (category === "fun" && item.category === "sport") return false;
    if (category === "pro") return false;
    if (quickFilter === "one" && !item.ratios.includes("1:1")) return false;
    if (quickFilter === "small" && !(item.ratios.includes("≤ 3:1") || item.ratios.includes("≤ 4:1"))) return false;
    if (quickFilter === "evening" && !item.timeTags.includes("晚间")) return false;
    if (quickFilter === "weekend" && !item.timeTags.includes("周末")) return false;
    if (quickFilter === "theme" && item.category !== "theme") return false;
    return true;
  });

  // 「专业」分类的条目：与 Moment 共用同一套行样式（catalogItem），所以两边看起来是
  // **同一个选择器**，而不是两张表 —— 这就是这次要的「合并成一个」。
  // 子标签 + 搜索同时生效（AND）；Moment 那排 quick-filter 不适用（服务没有
  // ratios / timeTags 这些字段），进「专业」时整排藏起来，见下面的渲染。
  const proQuery = query.trim().toLowerCase();
  const proVisible = PRO_SERVICES.filter((service) => {
    if (proTab !== "all" && service.cat !== proTab) return false;
    if (proQuery === "") return true;
    return `${service.title}${service.sub}${service.tags.join("")}`.toLowerCase().includes(proQuery);
  });

  function createCustom(): void {
    const name = query.trim();
    if (name === "") return;
    const custom: MomentTemplate = {
      id: `custom-${Date.now().toString(36)}`,
      // 自定义需求归类不了：用户手打的字，既不知道发生在哪个固定场所，也没有对应的
      // 接单者。按**绑人**处理 ⇒ 底行只有时间。不猜一个场景 —— 猜错就是把用户送到
      // 一个他没说的地方（`MOMENT_ACTION_ID` 里也没有 `custom-*` 这条链路）。
      // 行为与加 binding 之前完全一致：那会儿也是拿不到距离、只画时间。
      binding: "person",
      emoji: "＋",
      title: name.slice(0, 20),
      venue: "",
      venueLabel: "自定义需求",
      ratios: ["1:1", "≤ 3:1", "≤ 4:1"],
      defaultRatio: "1:1",
      defaultTime: "",
      defaultDuration: "2 小时",
      theme: "自定义",
      timeTags: [],
      skills: "中文",
      priceRef: "面议",
      defaultPrice: "",
      category: "theme" as const,
      tags: ["自定义"]
    };
    setTemplate(custom);
    setSpecs(defaultSpecsFor(custom));
    setMode("open");
    setError(undefined);
    // 自定义需求按绑人处理（见上面 binding 注释），选场景无从谈起；默认路径也
    // 不该经过人 list —— 「直接约」在规格底部随时可进，这里先走等接单。
    setStep("specs");
  }

  function pickTemplate(next: MomentTemplate): void {
    setTemplate(next);
    setSpecs(defaultSpecsFor(next));
    setSelectedPerson(undefined);
    // 非专业默认「等接单」；专业没有默认（用户口径），进 specs 前必须显式选。
    setMode(next.id === "pro" ? undefined : "open");
    setError(undefined);
  }

  // 选人：supply 名单本机过滤；仅浏览意向，发布恒为公开市场。
  //
  // DEMAND-DIRECT-LIST-001（2026-10-07）：规格页选「直接约」时**也要**这份名单 ——
  // 那一段现在直接把真人候选 list 画出来（用户「直接约没有接真人接单list啊」），
  // 所以加载条件不能只认 step === "people"，否则规格页那一列永远是空的。
  // 两个入口共用同一次请求（peopleLoaded 是闸，只拉一次）。
  useEffect(() => {
    const wantsPeople = step === "people" || (step === "specs" && mode === "direct");
    if (!wantsPeople || peopleLoaded || !supply) return;
    let cancelled = false;
    void supply.querySuppliers({ marketId: "hn", capability: "ZH", limit: 12 }).then((items) => {
      if (cancelled) return;
      setPeople(items);
      setPeopleLoaded(true);
    }).catch(() => {
      if (!cancelled) setPeopleLoaded(true);
    });
    return () => { cancelled = true; };
  }, [step, mode, peopleLoaded, supply]);

  function togglePeopleFilter(filter: string): void {
    setPeopleFilters((prev) => prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]);
  }

  const sheetActiveCount =
    (sheetFilters.language !== "不限" ? 1 : 0) +
    (sheetFilters.certifiedOnly ? 1 : 0) +
    (sheetFilters.maxBudget > 0 ? 1 : 0) +
    (sheetFilters.day !== "不限" ? 1 : 0);
  const visiblePeople = filterSuppliers(people, peopleFilters, sheetFilters);

  const isPro = template?.id === "pro";
  // 只有绑场景的模板走场景 list（SceneShopDirectory 自己有诚实空态，目录里没货
  // 它自己会说，不需要调用方预判候选数）；绑人（运动/自定义）和 pro 不进。
  const sceneBinding = template?.binding === "scene";

  // DEMAND-SCENE-GATE-001（2026-10-07，用户：「在发布需求 有场景绑定的 比如咖啡 饭店
  // 绑定一个场景选择后 再弹出下面的选项」）：绑场景的模板**先选场景**，选完才出现
  // 下面几段（选搭子 / 时间与人数 / 价格 / 备注）。未选 = 只留第 1 段 + 一句提示。
  // 判据用 place 非空（不是 lat/lng）：目录里有没真坐标的场景，(0,0) 守卫不写 lat/lng，
  // 但「他选过」这件事必须算数 —— 否则选了却打不开下面，人以为坏了。
  // 绑人 / 协助模板不受影响（没有这一段可等）。
  const sceneReady = !sceneBinding || specs.place.trim() !== "";

  // DEMAND-SCENE-PICKED-COLOR-001：选中的场景 id —— 交给场景 list 画选中态
  //（列表卡 violet 边框 / 地图 marker 换色）。清除已选、换模板都复位。
  const [pickedSceneId, setPickedSceneId] = useState<string | undefined>(undefined);
  useEffect(() => { setPickedSceneId(undefined); }, [template?.id]);

  // moment 步的出口。分流规则（2026-10-06 用户口径）：
  //   专业 → 人 list（专业靠人变现，这是唯一允许直接进 people 的路径）；
  //   绑场景 → 场景 list（home 场景 list 本体，**默认路径里没有选人这一步**）；
  //   绑人 → 直接进规格，「直接约」留在规格底部。
  function advanceFromMoment(): void {
    if (!template) return;
    if (isPro) {
      setPeopleReturn("moment");
      setStep("people");
      return;
    }
    // SCENE-STEP-ONEPAGE-001（2026-10-06，用户「选择场景还是跳页 没有和原型一样
    // 一页」）：不再有独立的「选场景」步 —— 场景 list 作为**规格页里的一个段落**
    // （地点栏上方），绑场景的模板也直接进规格，点卡片在同一页填地点。
    // DEMAND-HEADCOUNT-003：下拉菜单不带到下一屏（上次没选就走的，回来是收起的）。
    setHeadcountOpen(false);
    // DEMAND-TIMESLOT-001：同上。
    setTimeOpen(false);
    // DEMAND-DURATION-001：同上。
    setDurationOpen(false);
    setStep("specs");
  }

  async function publish(): Promise<void> {
    if (publishing || !template) return;
    if (specs.price.trim() === "") {
      setError("请填写预计服务价（可按参考价填，可协商）。");
      return;
    }
    setPublishing(true);
    setError(undefined);
    try {
      const opportunity = await marketplace.publish(
        // DEMAND-TARGET-KEEP-001：搭子选择跟着需求走（定向邀约）。targetAgent 为空
        // 时第三个参数是 undefined，wire 形状与改动前一致。
        buildDemandPublishInput(template, specs, targetAgent?.agentId)
      );
      setResult(opportunity);
      onPublished(opportunity);
      await nativeSecureStorageDriver.deleteItem(DRAFT_KEY).catch(() => undefined);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败，请重试。");
    } finally {
      setPublishing(false);
    }
  }

  function restart(): void {
    setTemplate(undefined);
    setSpecs(defaultSpecsFor(MOMENT_TEMPLATES[0]!));
    setSelectedPerson(undefined);
    setHeadcountOpen(false);
    setTimeOpen(false);
    setDurationOpen(false);
    setError(undefined);
    setResult(undefined);
    setDraftRestored(false);
    setStep("moment");
  }

  function back(): void {
    if (step === "moment") onBack();
    else if (step === "people") setStep(peopleReturn);
    // specs 的上一步恒回选 Moment（场景 list 已并入本页，没有中间步）。
    else if (step === "specs") setStep("moment");
  }

  const showNotes = specs.notes.trim() !== "";
  const showPerson = selectedPerson !== undefined;

  // DEMAND-TARGET-KEEP-001：定向只在**当前**是「直接约」时成立。点回「等接单」就是
  // 公开发布 —— 判据取 mode（用户最后选的接单方式），不是「曾经选过人」：
  // 选完人再点「等接单」，选的人还在 selectedPerson 里，但意图已经变回公开。
  const targetAgent = mode === "direct" ? selectedPerson : undefined;

  // DEMAND-SPECS-SKELETON-001：规格步按确认下单原型套编号分段（1 选场景 / 2 时间与
  // 人数 / 3 价格 / 4 备注）。四段恒渲染（第 1 段里场景 list 才按绑定出没），
  // 编号写死 1–4，不用计数。

  // 底部汇总条（一行当前选择 + 价格），原型 bottom 区的同款位置。
  const placeLabel = specs.place.trim() === "" ? template?.venue ?? "" : specs.place.trim();
  const priceLabel = specs.price.trim() === "" ? "待定" : (negotiable ? `${specs.price.trim()} · 可协商` : specs.price.trim());
  const bottomSummary = `${placeLabel} · ${normalizeTimeSlot(specs.time)} · ${normalizeDuration(specs.duration)} · ${normalizeHeadcount(specs.ratio)} 人`;

  return (
    <View style={styles.page}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.pageScroll}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="返回" onPress={back} style={styles.backBtn}>
          <ProxyBackGlyph />
        </Pressable>
        {/* DEMAND-TARGET-KEEP-001：定向邀约不是「需求已发布」—— 它只对一个人可见，
            标题照 market.tsx 的说法分开（「邀约已发出」/「需求已发布」）。 */}
        <Text selectable style={styles.title}>{step === "done" ? (targetAgent ? "✓ 邀约已发出" : "✓ 需求已发布") : "发布需求"}</Text>
        {step === "done" ? <View style={styles.headSpacer} /> : (
          <Pressable accessibilityLabel="存草稿" onPress={() => void saveDraft()} style={styles.draftBtn}>
            <Text selectable style={styles.draftText}>草稿</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.tabs}>
        <View style={[styles.tab, styles.tabActive]}><Text selectable style={[styles.tabText, styles.tabTextActive]}>发布需求</Text></View>
        <Pressable accessibilityLabel="去创建活动" onPress={onCreateActivity} style={styles.tab}>
          <Text selectable style={styles.tabText}>创建活动</Text>
        </Pressable>
      </View>
      {draftRestored && step !== "done" ? <Text selectable style={styles.restoredHint}>已恢复上次草稿。</Text> : null}

      {step === "moment" ? (
        <>
          <View style={styles.hero}>
            <Text selectable style={styles.heroTitle}>想约什么？</Text>
            <Text selectable style={styles.heroSub}>左边找方向，右边直接选一个 Moment。</Text>
            <View style={styles.momentBadge}><Text selectable style={styles.momentBadgeText}>Moment · 人与场景优先</Text></View>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Text selectable style={styles.searchIcon}>⌕</Text>
              <TextInput onChangeText={setQuery} placeholder="例如：4个人，周六下午一起打球" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={query} />
            </View>
            <Pressable accessibilityLabel="按输入生成需求" disabled={query.trim() === ""} onPress={createCustom} style={[styles.generateBtn, query.trim() === "" && styles.disabled]}>
              <Text selectable style={styles.generateText}>生成</Text>
            </Pressable>
          </View>
          {/* R58 单行 quick-filter。全部 / 1:1 / 3–4 人 / 晚间 / 周末 / 主题玩法都是
              **Moment 的属性**（ratios / timeTags / category），服务条目没有这些字段 ——
              进「专业」时整排藏起来，不摆一排按下去没反应的控件。搜索框不藏：
              它在「专业」下筛的是服务条目（见 proVisible）。 */}
          {category === "pro" ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilterRow}>
              {QUICK_FILTERS.map((filter) => (
                <Pressable key={filter.id} onPress={() => setQuickFilter(filter.id)} style={[styles.filterChip, quickFilter === filter.id && styles.filterChipOn]}>
                  <Text selectable style={[styles.filterText, quickFilter === filter.id && styles.filterTextOn]}>{filter.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {/* R58 双栏：左分类 rail + 右 Moment 卡片列表 */}
          <View style={styles.deliveryLayout}>
            <View style={styles.categoryRail}>
              {CATEGORIES.map((cat) => (
                <Pressable key={cat.id} onPress={() => setCategory(cat.id)} style={[styles.categoryBtn, category === cat.id && styles.categoryBtnOn]}>
                  <Text selectable style={[styles.categoryBtnText, category === cat.id && styles.categoryBtnTextOn]}>{cat.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.catalogPane}>
              <View style={styles.catalogHead}>
                <Text selectable style={styles.catalogTitle}>{CATEGORIES.find((cat) => cat.id === category)?.label ?? "热门"}</Text>
                <Text selectable style={styles.catalogHint}>{category === "pro" ? "城市协助 · Professional" : "高频 Moment"}</Text>
              </View>
              {category === "pro" ? (<>
                {/* 2026-10-06 合并：城市协助原来在双栏**之外** —— 一张「城市协助 ·
                    Professional」入口卡 + 一格子卡（professionalEntry + proGrid），
                    规格步还再摆一遍。现在整格搬进这个选择器：与 Moment 同一个 rail、
                    同一套行样式、同一个高亮（momentCardOn），选中的服务照旧喂给
                    selectProService（它负责把 pro 模板一起设上，并把「面议」的价留空）。 */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.proTabRow}>
                  {PRO_TABS.map((tab) => (
                    <Pressable key={tab.k} onPress={() => setProTab(tab.k)} style={[styles.filterChip, proTab === tab.k && styles.filterChipOn]}>
                      <Text selectable style={[styles.filterText, proTab === tab.k && styles.filterTextOn]}>{tab.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {proVisible.map((service) => {
                  const active = proService === service.id;
                  return (
                    <Pressable key={service.id} accessibilityLabel={`选择${service.title}`} onPress={() => selectProService(service)} style={[styles.catalogItem, active && styles.momentCardOn]}>
                      <View style={styles.momentEmoji}>{proLogoNode(service)}</View>
                      <View style={styles.momentCopy}>
                        <Text selectable style={styles.momentTitle}>{service.title}</Text>
                        <Text selectable style={styles.momentDesc}>{service.sub}</Text>
                        <View style={styles.catalogTags}>
                          {service.tags.map((tag) => <View key={tag} style={styles.catalogTag}><Text selectable style={styles.catalogTagText}>{tag}</Text></View>)}
                        </View>
                      </View>
                      <View style={styles.catalogSide}>
                        <Text selectable style={styles.catalogSideRatio}>{service.price}</Text>
                        <Text selectable style={styles.catalogSideTime}>{service.range}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {proVisible.length === 0 ? <Text selectable style={styles.empty}>没有匹配的专业服务，换个子标签或清空搜索。</Text> : null}
              </>) : null}
              {moments.map((item) => {
                const active = template?.id === item.id;
                const icon = actionIconFor(item.id);
                const startPrice = momentStartPrice(item);
                // 真实距离（你的定位 → 这类 Moment 最近的真实场景）。拿不到就是空串，
                // 底行只剩时长 —— 见 demand-moments 的 momentDistanceLabel。
                const distance = momentDistances[item.id] ?? "";
                return (
                  <Pressable key={item.id} accessibilityLabel={`选择${item.title}`} onPress={() => pickTemplate(item)} style={[styles.catalogItem, active && styles.momentCardOn]}>
                    <View style={styles.momentEmoji}>
                      {icon !== undefined
                        ? <Image contentFit="contain" source={icon} style={styles.momentIcon} />
                        : <Text selectable style={styles.momentEmojiText}>{item.emoji}</Text>}
                    </View>
                    {/* 2026-10-06 用户：「我给你的原型基本要对齐啊 …… 有距离 有大概接单时间
                        移除1:1 因为概念理解复杂 变成起步价格」—— 行结构按原型卡片重排。
                        原型是 item-top（名字 | 价格）/ item-desc / item-bottom（tags | meta）：
                        价格贴在**标题那一行**的右端，不在侧栏。此前是「左列 标题/描述/标签 +
                        右列 1:1 / 今晚 19:00」的两栏侧栏 —— 价格没落对行，1:1 又要先懂概念。
                        1:1 撤掉，换起步价（见 demand-moments 的 momentStartPrice）；
                        底行是「距离 · 大概时长」：距离是**真实**的（用户选「接真实距离」，
                        定位 → 最近的真实场景），时长取模板的 defaultDuration。 */}
                    <View style={styles.momentCopy}>
                      <View style={styles.momentTop}>
                        <Text selectable style={styles.momentTitle}>{item.title}</Text>
                        <View style={styles.momentPrice}>
                          <Text selectable style={styles.momentPriceNum}>{startPrice.amount}</Text>
                          {startPrice.unit === "" ? null : <Text selectable style={styles.momentPriceUnit}>{startPrice.unit}</Text>}
                        </View>
                      </View>
                      <Text selectable style={styles.momentDesc}>{item.venueLabel}</Text>
                      <View style={styles.momentBottom}>
                        <View style={styles.catalogTags}>
                          {item.tags.map((tag) => <View key={tag} style={styles.catalogTag}><Text selectable style={styles.catalogTagText}>{tag}</Text></View>)}
                        </View>
                        <Text selectable style={styles.momentMeta}>{momentMetaLine(distance, item)}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
              {/* 「专业」下 moments 恒为空（pro 已被排除、其余模板 category 对不上），
                  这条空态只在 Moment 分类里说话，否则会和上面那条服务的空态打架。 */}
              {moments.length === 0 && category !== "pro" ? <Text selectable style={styles.empty}>没有匹配的 Moment，换个条件或点生成。</Text> : null}
            </View>
          </View>
          <View style={styles.currentCard}>
            <Text selectable style={styles.currentLabel}>当前需求</Text>
            <Text selectable style={styles.currentValue}>{template ? `${template.title}${proService ? ` · ${PRO_SERVICES.find((item) => item.id === proService)?.title ?? ""}` : ""}` : "先选一个"}</Text>
          </View>
          <Pressable disabled={!template} onPress={advanceFromMoment} style={[styles.primaryBtn, !template && styles.disabled]}>
            <Text selectable style={styles.primaryBtnText}>选择</Text>
          </Pressable>
          {/* 2026-10-06 合并：这里原本是「城市协助 · Professional」入口卡 + 一格子卡
              （professionalEntry + proGrid），现在整格搬进上面的双栏选择器 ——
              rail 上的「专业」分类，与 Moment 同一套行样式。城市协助不再挂在
              选择器外面；这一屏的底部也就只剩这一个出口。
              2026-10-06 文案（用户「选择代替 下一步xxxx … 大家知道选择」）：按钮从
              「下一步 · 选人 / 服务 / 价格」收成一个「选择」。那个后缀是在替用户复述
              他刚做完的动作（选人 / 服务 / 价格本来就在下面那一屏），没信息量；
              「上一步 / 选择」这组词自己就把方向说完了。
              同日 DEMAND-SCENE-FIRST-001：行为改了 —— 不再一律进「选人」，按
              advanceFromMoment 分流（专业进选人，其余直接进规格 —— 场景 list
              已并入规格页，见 SCENE-STEP-ONEPAGE-001）。 */}
        </>
      ) : step === "people" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text selectable style={styles.confirmEyebrow}>Moment</Text>
              <Text selectable style={styles.confirmTitle}>{template?.title}</Text>
            </View>
            <Pressable onPress={() => setStep("moment")}><Text selectable style={styles.linkText}>更换</Text></Pressable>
          </View>
          <View style={styles.filterHeadRow}>
            <Text selectable style={styles.sectionTitle}>匹配条件</Text>
            <Pressable accessibilityLabel="打开筛选" onPress={() => setSheetOpen((open) => !open)} style={styles.sheetToggle}>
              <Text selectable style={styles.sheetToggleText}>筛选{sheetActiveCount > 0 ? ` · ${sheetActiveCount}` : ""}</Text>
            </Pressable>
          </View>
          <View style={styles.filterRow}>
            {PEOPLE_FILTERS.map((filter) => (
              <Pressable key={filter} onPress={() => togglePeopleFilter(filter)} style={[styles.filterChip, peopleFilters.includes(filter) && styles.filterChipOn]}>
                <Text selectable style={[styles.filterText, peopleFilters.includes(filter) && styles.filterTextOn]}>{filter}</Text>
              </Pressable>
            ))}
          </View>
          {sheetOpen ? (
            <View style={styles.sheet}>
              <Text selectable style={styles.sheetLabel}>可用时间</Text>
              <View style={styles.filterRow}>
                {["不限", "今晚", "明天", "周末"].map((day) => (
                  <Pressable key={day} onPress={() => setSheetFilters((prev) => ({ ...prev, day }))} style={[styles.filterChip, sheetFilters.day === day && styles.filterChipOn]}>
                    <Text selectable style={[styles.filterText, sheetFilters.day === day && styles.filterTextOn]}>{day}</Text>
                  </Pressable>
                ))}
              </View>
              <Text selectable style={styles.sheetLabel}>语言</Text>
              <View style={styles.filterRow}>
                {["不限", "中文", "English", "越南语"].map((language) => (
                  <Pressable key={language} onPress={() => setSheetFilters((prev) => ({ ...prev, language }))} style={[styles.filterChip, sheetFilters.language === language && styles.filterChipOn]}>
                    <Text selectable style={[styles.filterText, sheetFilters.language === language && styles.filterTextOn]}>{language}</Text>
                  </Pressable>
                ))}
              </View>
              <Text selectable style={styles.sheetLabel}>认证</Text>
              <View style={styles.filterRow}>
                {[false, true].map((only) => (
                  <Pressable key={only ? "cert" : "all"} onPress={() => setSheetFilters((prev) => ({ ...prev, certifiedOnly: only }))} style={[styles.filterChip, sheetFilters.certifiedOnly === only && styles.filterChipOn]}>
                    <Text selectable style={[styles.filterText, sheetFilters.certifiedOnly === only && styles.filterTextOn]}>{only ? "已认证" : "不限"}</Text>
                  </Pressable>
                ))}
              </View>
              <Text selectable style={styles.sheetLabel}>预算</Text>
              <View style={styles.filterRow}>
                {[{ label: "不限", value: 0 }, { label: "≤ 200K", value: 200000 }, { label: "≤ 300K", value: 300000 }, { label: "≤ 500K", value: 500000 }].map((budget) => (
                  <Pressable key={budget.label} onPress={() => setSheetFilters((prev) => ({ ...prev, maxBudget: budget.value }))} style={[styles.filterChip, sheetFilters.maxBudget === budget.value && styles.filterChipOn]}>
                    <Text selectable style={[styles.filterText, sheetFilters.maxBudget === budget.value && styles.filterTextOn]}>{budget.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.sheetActions}>
                <Pressable onPress={() => setSheetFilters(DEFAULT_PEOPLE_FILTERS)} style={styles.sheetReset}>
                  <Text selectable style={styles.sheetResetText}>重置</Text>
                </Pressable>
                <Pressable onPress={() => setSheetOpen(false)} style={styles.sheetApply}>
                  <Text selectable style={styles.sheetApplyText}>应用筛选</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <Text selectable style={styles.sectionSub}>选人 · 可选，不选默认发布到市场</Text>
          {!supply ? <Text selectable style={styles.empty}>供给目录不可用，直接发布到市场。</Text>
            : !peopleLoaded ? <Text selectable style={styles.empty}>正在匹配…</Text>
            : visiblePeople.length === 0 ? <Text selectable style={styles.empty}>当前筛选没有匹配的人，放宽条件或直接发布到市场。</Text>
            : visiblePeople.map((person) => (
              <PersonRow
                key={person.agentId}
                active={selectedPerson?.agentId === person.agentId}
                onOpenProfile={onOpenPersonProfile}
                onSelect={() => { const active = selectedPerson?.agentId === person.agentId; setSelectedPerson(active ? undefined : person); setMode(active ? "open" : "direct"); }}
                person={person}
              />
            ))}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            {/* 上一步回**入口**：专业从选 Moment 进来就回 moment，「直接约」从规格
                进来就回规格 —— peopleReturn 记着从哪进来的，不写死。 */}
            <Pressable onPress={() => setStep(peopleReturn)} style={styles.secondaryBtn}><Text selectable style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable onPress={() => setStep("specs")} style={styles.primaryBtnFlex}><Text selectable style={styles.primaryBtnText}>选择</Text></Pressable>
          </View>
        </>
      ) : step === "specs" ? (
        <>
          {/* DEMAND-SPECS-GUTTER-001（2026-10-07，用户：「x稍微太靠右边缘了 调整下」）：
              规格页整页通栏（content 的 paddingHorizontal 是 0，2026-10-06 用户
              「这个页面2边不要留白」—— 那条说的是**选 Moment 那一屏**的双栏卡片，
              但 content 是三步共用的，规格步跟着一起贴了边）。实测截图：段头标题
              在 x=0，右侧 hint（「默认已填好」/「可协商」/「可选」）被屏幕边裁掉，
              选完场景后的 X 字形也顶在 x=0；而下面的场景卡由 SceneShopDirectory
              自带 16 内边距 —— 同一页两条竖线。
              这里给规格步自己套一层 16 的页边距（不碰共用的 content，选 Moment
              那屏的通栏原样保留），段头 / 场景卡 / 字段 / 卡片全部落在同一条 16 上。
              数值取 16 不取原型的 20：本页底部条 specsBottomBar 和场景卡本来都是 16，
              跟随仓内既有栅格，不新造一条。 */}
          <View style={styles.specsGutter}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text selectable style={styles.confirmEyebrow}>Moment</Text>
              <Text selectable style={styles.confirmTitle}>{template?.title}</Text>
              {/* DEMAND-TARGET-KEEP-001：这句以前恒写「（发布仍为公开市场）」—— 而
                  wire 上根本不带搭子，那句话是在替一个「选择被丢掉」的实现背书。
                  现在两态分开说：定向就是定向（只对 TA 可见、等 TA 确认），
                  公开就是公开。文案口径照 market.tsx 的「邀约已发出 / 等待确认」。 */}
              {selectedPerson ? (
                <Text selectable style={styles.confirmSub}>
                  {targetAgent
                    ? `定向邀约：${selectedPerson.name}（只对 TA 可见，等 TA 确认）`
                    : `意向人选：${selectedPerson.name}（发布仍为公开市场）`}
                </Text>
              ) : null}
              {/* 2026-10-06 合并：专业服务的选择收进了选 Moment 那一步的双栏选择器，
                  规格步不再摆第二遍服务目录（那一格是第三份拷贝）。但「选了哪个服务」
                  得还看得见 —— 这是发布前最后一屏，模板名只到「城市协助」为止。
                  要换服务就点右上「更换」回选 Moment 那一步。 */}
              {proService ? <Text selectable style={styles.confirmSub}>专业服务：{PRO_SERVICES.find((item) => item.id === proService)?.title ?? ""}</Text> : null}
            </View>
            <Pressable onPress={() => setStep("moment")}><Text selectable style={styles.linkText}>更换</Text></Pressable>
          </View>
          {/* SCENE-STEP-ONEPAGE-001（2026-10-06，用户：「选择场景还是跳页 没有和
              原型一样 一页」）：场景 list 不是一步，是**规格页里的一个段落** ——
              还是 home 那份 SceneShopDirectory 本体（embedded 模式：无 Modal/
              顶栏/竖滚，数据/排序/详情是它自己的代码），点卡片**在本页**把名字+
              坐标填进下面的地点栏（(0,0) 守卫：无真坐标不写 lat/lng，不让地图钉
              到海上），人不离开、页不跳转。不想选就不管这一段 = 自动分配（地点
              留空发到市场，接单方确认；搭子类绑人模板目录里本来没有场地，
              sceneBinding 为假时这一段整个不渲染，同一条一页口径）。
              点头像看单店详情（AVATAR-DETAIL-001，同页内切换）。 */}
          {/* DEMAND-SPECS-SKELETON-001：第 1 段 · 选场景。顶上的规格摘要盒撤了 ——
              当前选择收到底部汇总条（原型 bottom 区），一页只讲一遍。
              段内标题「先挑个地方」由段头 hint 接了，不再另起一行。 */}
          <SpecsSection
            hint={sceneBinding
              ? (specs.place.trim() !== ""
                ? (
                  // DEMAND-NOISE-TRIM-001：选完场景，这一格换成「清除」动作 ——
                  // 原来下面单占一行「已选：XXX · 清除」，跟上面那张已经变色的
                  // 选中卡说的是同一件事（名字重复一遍 = 废话）。
                  // DEMAND-NOISE-TRIM-002（2026-10-07，用户：「可以用X号代替啊 能用
                  // logo 尽量别用文字」）：这个动作是**通用语义**（取消选择），有现成
                  // 字形就用字形 —— 复用 ProxyIcon 的 close（两根斜杠组成的 ×，跟各处
                  // 关闭按钮同一个），文案退到 accessibilityLabel 供读屏。hitSlop 补
                  // 触控面积（16px 字形比原 13px 文字还小，不加会难点）。
                  <Pressable accessibilityLabel="清除已选地点" hitSlop={8} onPress={() => { setSpecs((prev) => ({ ...prev, place: "", lat: undefined, lng: undefined })); setPickedSceneId(undefined); }} style={styles.specHintAction}>
                    <ProxyIcon color={color.violet} name="close" size={16} />
                  </Pressable>
                )
                : "不想选就自动分配")
              : "填个碰头地点"}
            no={1}
            title={sceneBinding ? "选场景" : "地点"}
          >
          {sceneBinding ? (
            <View style={styles.sceneSection}>
              <SceneShopDirectory
                embedded
                actionId={(template && MOMENT_ACTION_ID[template.id]) || ""}
                label={template?.title ?? ""}
                unit="家"
                apiBaseUrl={localApiBaseUrl}
                onClose={() => setStep("moment")}
                onPick={(scene) => {
                  const hasCoords = Number.isFinite(scene.latitude) && Number.isFinite(scene.longitude) && !(scene.latitude === 0 && scene.longitude === 0);
                  setSpecs((prev) => ({ ...prev, place: scene.name, ...(hasCoords ? { lat: scene.latitude, lng: scene.longitude } : {}) }));
                  // DEMAND-SCENE-PICKED-COLOR-001：记住选的是哪一家，卡片立刻变色。
                  setPickedSceneId(scene.id);
                }}
                pickedId={pickedSceneId}
              />
              {/* DEMAND-SCENE-MAP-001：有列表，地点手填框撤掉（用户：「list 下面放
                  一个地点没意义」）。DEMAND-NOISE-TRIM-001：连「已选：XXX」那行也撤
                  —— 选中的卡在上面已经变色（DEMAND-SCENE-PICKED-COLOR-001），
                  「清除」搬到段头 hint 槽，不再重复一遍名字。
                  无列表模板（绑人 / 协助）照旧手填 + 手动地图，见下面。 */}
            </View>
          ) : null}

          {sceneBinding ? null : (
          <>
          <Text selectable style={styles.fieldLabel}>地点</Text>
          <TextInput onChangeText={(place) => setSpecs((prev) => ({ ...prev, place }))} placeholder={template?.venue} placeholderTextColor={color.muted} style={styles.input} value={specs.place} />
          {/* OPP-REAL-COORDS-001: 地图选点（可选，不卡发布）。点/拖即记真坐标，
              发布带 lat/lng、订单上图；不动则纯文字地点、无钉。 */}
          <View style={styles.mapWrapper}>
            <MapCanvas
              cityHint=""
              initialPin={{ x: 5, y: 5 }}
              radiusMeters={1000}
              {...(specs.lat !== undefined && specs.lng !== undefined
                ? { initialCoordinate: { lat: specs.lat, lng: specs.lng } }
                : {})}
              onChange={(_grid, coordinate) => {
                if (coordinate && Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lng)) {
                  setSpecs((prev) => ({ ...prev, lat: coordinate.lat, lng: coordinate.lng }));
                }
              }}
              testID="demand-place-map"
            />
          </View>
          </>
          )}
          </SpecsSection>

          {/* DEMAND-SCENE-GATE-001：选完场景（sceneReady）才放下面几段。没选时只留
              一句诚实提示 —— 底部「发布到市场」一直在，不想选就直接发（自动分配）。 */}
          {sceneReady ? (
          <>
          {/* DEMAND-SPECS-ORDER-001（2026-10-07，用户：「这几个参数不要放在顶部」）：
              人数 / 时间 / 时长三块从摘要下面搬到地点 + 地图之后 —— 先定地方，
              再定人时时长。三块相对顺序不动（你们几人 → 约定见面时间 → 时长）。 */}
          {/* DEMAND-SUBSECTION-002（2026-10-07，用户：「这个怎么找人 要对齐原型 搭子
              而不是怎么找人 放在时间与人数上面」）：接单方式那一行原来压在整屏最后
              （备注之后），现在按原型提到 ① 选场景 之后、时间与人数之前，成为第 2 段。
              标题取原型 ② 的原话「选搭子」（跟 ① 的「选场景」同构）；段号顺移一位
              （时间与人数 3 / 价格 4 / 备注 5）。 */}
          {/* DEMAND-SUBSECTION-003（2026-10-07，用户看了原型的渲染图：「你实现的没有
              对齐原型 这样看起来很不起眼 其实这是重要选择 对齐原型」）：原来是一颗
              「等接单」chip + 一条「或 直接约 ›」小字链接 —— 原型 ② 是一枚**等权分段
              控件**（灰轨道 + 白色药丸，选中项带 mint「更快」角标）压一张**说明卡**
              （44 圆图标 + 名称 + 角标 + 一行描述，accent 实线边 + accent-soft 底）。
              照原型补上。
              控件语义不变，两段就是**等接单 / 直接约**（用户 2026-10-06 定名，
              DEMAND-SCENE-FIRST-001 按字面扫；原型那两个词是「系统分配 / 自己挑」，
              没换 —— 换名字要先推翻他自己那条命名决定）。点「直接约」**把下面那列
              真人候选 list 打开**（DEMAND-DIRECT-LIST-001：原来这里只摆了一张入口卡，
              用户「直接约没有接真人接单list啊」—— 原型那一段本来就是 .person-list）。
              段头 hint 保持动态（专业那句是**发布闸**的说明 —— 没选不放行，不能丢）。 */}
          <SpecsSection
            hint={
              // 段头 hint 要跟着**当前选择**走：专业那句是**发布闸**的说明（没选不放行，
              // 不能丢）；直接约选了之后还写「默认等接单 · 谁有空谁响应」是自相矛盾 ——
              // 用户正看着一列真人，hint 却在说「默认等接单」。
              isPro && mode === undefined
                ? "专业服务先选一种 · 没有默认"
                : mode === "direct"
                  ? "自己挑一个 · 选中即定向邀约"
                  : "默认等接单 · 谁有空谁响应"
            }
            no={2}
            title="选搭子"
          >
          <View style={styles.modeToggle}>
            <Pressable accessibilityLabel="等接单" onPress={() => setMode("open")} style={[styles.modeToggleBtn, mode === "open" && styles.modeToggleBtnOn]}>
              <Text selectable style={[styles.modeToggleText, mode === "open" && styles.modeToggleTextOn]}>等接单</Text>
              {/* 原型 `.mt-btn .small` 那颗「更快」角标。 */}
              <Text selectable style={styles.modeToggleBadge}>更快</Text>
            </Pressable>
            <Pressable accessibilityLabel="直接约" onPress={() => setMode("direct")} style={[styles.modeToggleBtn, mode === "direct" && styles.modeToggleBtnOn]}>
              <Text selectable style={[styles.modeToggleText, mode === "direct" && styles.modeToggleTextOn]}>直接约</Text>
            </Pressable>
          </View>
          {mode === "direct" ? (
            <>
              {/* DEMAND-DIRECT-LIST-001（2026-10-07，用户「直接约没有接真人接单list啊」）：
                  原型 ② 的「自己挑」那一段**不是一张说明卡**，是 `.person-list` 本体 ——
                  accent 说明卡只属于「系统分配」那一支（原型的 #autoMode）。我上一版
                  把卡当入口、真人 list 留在「选人」步里，于是这一段看起来完全没有
                  「接单的人」。现在把同一批候选人直接画在这里：数据是
                  supply.querySuppliers 的真实返回（不是 fixture），行是 PersonRow
                  （和选人步同一份实现，避免 CREATOR-AVATAR-001 那类「两个面两个画法」），
                  选中即定向邀约（buildDemandPublishInput 带 targetUserId）。 */}
              {!supply ? <Text selectable style={styles.empty}>供给目录不可用，直接发布到市场。</Text>
                : !peopleLoaded ? <Text selectable style={styles.empty}>正在匹配…</Text>
                : visiblePeople.length === 0 ? <Text selectable style={styles.empty}>附近暂时没有可接单的人，放宽条件或直接发布到市场。</Text>
                : (
                  <>
                    <Text selectable style={styles.sectionSub}>{`附近可接单的人 · ${visiblePeople.length} 人`}</Text>
                    {visiblePeople.map((person) => (
                      <PersonRow
                        key={person.agentId}
                        active={selectedPerson?.agentId === person.agentId}
                        onOpenProfile={onOpenPersonProfile}
                        onSelect={() => {
                          const active = selectedPerson?.agentId === person.agentId;
                          // 在这一段取消选择时**保持「直接约」**：用户是在分段控件上
                          // 显式选的，取消某一个人不该把整段收起来。选人步那一支才回等接单。
                          setSelectedPerson(active ? undefined : person);
                          if (!active) setMode("direct");
                        }}
                        person={person}
                      />
                    ))}
                  </>
                )}
              {/* 名单本身带不动筛选（语言/时间/认证/预算），那个还在「选人」步里，
                  这里只留一个入口 —— 不把整套筛选 UI 复制一份。 */}
              <Pressable accessibilityLabel="按条件筛选搭子" onPress={() => { setPeopleReturn("specs"); setStep("people"); }} style={styles.filterHeadRow}>
                <Text selectable style={styles.sectionSub}>筛选</Text>
                <Text selectable style={styles.sheetToggleText}>全部条件 ›</Text>
              </Pressable>
            </>
          ) : mode === "open" ? (
            <View style={styles.autoCard}>
              <View style={styles.autoIcon}>
                <ProxyIcon color={color.white} name="sparkle" size={20} />
              </View>
              <View style={styles.autoBody}>
                <View style={styles.autoNameRow}>
                  <Text selectable style={styles.autoName}>系统推荐</Text>
                  <Text selectable style={styles.autoBadge}>推荐</Text>
                </View>
                <Text selectable style={styles.autoDesc}>按评分、距离、擅长匹配最适合的搭子。通常 5–15 分钟响应。</Text>
              </View>
            </View>
          ) : null}
          </SpecsSection>

          {/* DEMAND-SPECS-SKELETON-001：第 3 段 · 时间与人数。 */}
          <SpecsSection hint="默认已填好" no={3} title="时间与人数">
          {/* DEMAND-INFO-CARD-001（2026-10-07，用户：「人数 时间xx也按照原型做紧凑模式」）：
              原型 deepseek_html_20261007_d726c2 的 ③ 是**一张** `.info-card` 里三行
              `.info-row`（左 label 占满 + 右「值 + ▾」，行间 1px 细线）。改之前是三个
              各自带边框的小框、每个上面还各挂一行 fieldLabel —— 纵向占了三倍。这里照
              原型收成一张卡：三个 testID、三个弹层（下拉菜单 / 两个 WheelSheet）一个
              都不动，只换容器与行形态。
              下拉菜单留在**卡内、紧跟它那一行**：下拉贴着触发器是本来的语言
              （DEMAND-HEADCOUNT-003），别为了卡形把它挪到卡外。 */}
          <View style={styles.infoCard}>
          {/* DEMAND-HEADCOUNT-003（2026-10-07，用户：「搞成下拉选择框的 … 不要做成
              让客户增大摩擦力的视觉」）：六颗常驻 chips 太重，换成贴着触发按钮的
              下拉（SCENE-PICKER-FILTER-ANCHORED-004 同款语言：触发器 + caret，
              选项行 + ✓，选即收）。常态只占一行，默认 1 人。模板数据里的
              ratios/defaultRatio 保留（快筛还用），只是不渲染。 */}
          <Pressable accessibilityLabel="选择人数" onPress={() => setHeadcountOpen((open) => !open)} style={styles.infoRow} testID="demand-headcount">
            <Text selectable style={styles.infoLabel}>你们几人</Text>
            <View style={styles.infoValue}>
              <Text selectable style={styles.infoValueText}>{`${normalizeHeadcount(specs.ratio)} 人`}</Text>
              <Text selectable style={styles.infoArrow}>{headcountOpen ? "▴" : "▾"}</Text>
            </View>
          </Pressable>
          {headcountOpen ? (
            <View style={styles.headcountMenu}>
              {HEADCOUNT_OPTIONS.map((count, index) => (
                <Pressable key={count} accessibilityLabel={`选择${count}人`} onPress={() => { setSpecs((prev) => ({ ...prev, ratio: count })); setHeadcountOpen(false); }} style={[styles.headcountOption, index === HEADCOUNT_OPTIONS.length - 1 && styles.headcountOptionLast]}>
                  <Text selectable style={styles.headcountOptionText}>{`${count} 人`}</Text>
                  {specs.ratio === count ? <Text selectable style={styles.headcountCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* DEMAND-TIMESLOT-002（2026-10-07，用户给原型 deepseek_html_20261007：
              「时间用滚轮的」）：下拉列表换成 iOS 滚轮 + 底部弹层（取消 / 开始时间
              / 确定，中间高亮条，点选 + 滚选，松手吸附）。档位还是 TIME_SLOT_OPTIONS
              （06:00–22:00 半小时一档），行只写 HH:MM —— 早上/晚上这类词跟「今晚」
              一样不上界面。渐隐遮罩没做：仓里没有渐变包，高亮条 + 吸附已够认出滚轮。 */}
          {/* DEMAND-TIMESLOT-003（2026-10-07，用户：「时间段改为约定见面时间」）：
              字段名从「时间段」改成「约定见面时间」—— 用户填的是**碰头那一刻**，
              不是一段可漂移的区间（滚轮选的也确实是单个 HH:MM）。值口径不变：
              TIME_SLOT_OPTIONS（06:00–22:00 半小时一档），行只写 HH:MM。 */}
          <Pressable accessibilityLabel="选择约定见面时间" onPress={() => setTimeOpen(true)} style={[styles.infoRow, styles.infoRowDivider]} testID="demand-timeslot">
            <Text selectable style={styles.infoLabel}>约定见面时间</Text>
            <View style={styles.infoValue}>
              <Text selectable style={styles.infoValueText}>{normalizeTimeSlot(specs.time)}</Text>
              <Text selectable style={styles.infoArrow}>▾</Text>
            </View>
          </Pressable>
          {timeOpen ? (
            <WheelSheet
              closeLabel="关闭时间选择"
              onCancel={() => setTimeOpen(false)}
              onConfirm={(slot) => { setSpecs((prev) => ({ ...prev, time: slot })); setTimeOpen(false); }}
              options={TIME_SLOT_OPTIONS}
              title="约定见面时间"
              value={normalizeTimeSlot(specs.time)}
            />
          ) : null}

          {/* DEMAND-DURATION-001（2026-10-07，用户：「时长也用滚轮 1H-8H就可以」）：
              三颗 chips 换成跟时间段同一个滚轮弹层（标题「时长」，1–8 小时）。
              常态只占一行小框，默认 2 小时。 */}
          <Pressable accessibilityLabel="选择时长" onPress={() => setDurationOpen(true)} style={[styles.infoRow, styles.infoRowDivider]} testID="demand-duration">
            <Text selectable style={styles.infoLabel}>时长</Text>
            <View style={styles.infoValue}>
              <Text selectable style={styles.infoValueText}>{normalizeDuration(specs.duration)}</Text>
              <Text selectable style={styles.infoArrow}>▾</Text>
            </View>
          </Pressable>
          {durationOpen ? (
            <WheelSheet
              closeLabel="关闭时长选择"
              onCancel={() => setDurationOpen(false)}
              onConfirm={(slot) => { setSpecs((prev) => ({ ...prev, duration: slot })); setDurationOpen(false); }}
              options={DURATION_OPTIONS}
              title="时长"
              value={normalizeDuration(specs.duration)}
            />
          ) : null}
          </View>
          </SpecsSection>

          {/* DEMAND-SPECS-SKELETON-001：第 3 段 · 价格。 */}
          <SpecsSection hint="可协商" no={4} title="价格">
          {/* 2026-10-06 合并：这里原本是城市协助服务目录的**第三份拷贝** ——
              按模板展开的 proGrid，外加选中服务那行 note。服务选择已经收进
              选 Moment 那一步的双栏选择器（rail 上的「专业」），规格步不再摆
              第二遍目录；「选了哪个服务」由上面 confirmCard 里那行交代。 */}
          <View style={styles.fieldLabelRow}>
            <Text selectable style={styles.fieldLabelNoGap}>预计服务价</Text>
            <Text selectable style={styles.dynamicBadge}>动态</Text>
          </View>
          <View style={styles.priceMain}>
            <TextInput keyboardType="numbers-and-punctuation" onChangeText={(price) => setSpecs((prev) => ({ ...prev, price }))} placeholder={template?.defaultPrice} placeholderTextColor={color.muted} style={[styles.input, styles.priceInput]} value={specs.price} />
            <Pressable accessibilityLabel={negotiable ? "取消可协商" : "标记可协商"} onPress={() => setNegotiable((current) => !current)} style={[styles.negoBtn, negotiable && styles.negoBtnOn]}>
              <Text selectable style={[styles.negoBtnText, negotiable && styles.negoBtnTextOn]}>{negotiable ? "✓ 可协商" : "可协商"}</Text>
            </Pressable>
          </View>
          <Text selectable style={styles.hint}>参考 {template?.priceRef} · 可协商；现场消费不包含在内。</Text>
          {/* DEMAND-PREFS-REMOVE-001：偏好行删了，这句里的「额外偏好 / 偏好只用于匹配」
              跟着拿掉 —— 用户已经没处设偏好，别留一句没由来的话。 */}
          <Text selectable style={styles.hint}>ⓘ 价格由场景基础价、时间、人数组成。服务参考价；餐饮、咖啡、KTV、门票等现场消费不包含在内。</Text>
          </SpecsSection>

          {/* DEMAND-SPECS-SKELETON-001：第 5 段 · 备注。 */}
          <SpecsSection hint="可选" no={5} title="备注">
          <TextInput maxLength={500} multiline onChangeText={(notes) => setSpecs((prev) => ({ ...prev, notes }))} placeholder="补充说明（随订单展示）" placeholderTextColor={color.muted} style={[styles.input, styles.notesInput]} value={specs.notes} />
          </SpecsSection>

          </>
          ) : (
            <Text selectable style={styles.empty}>先选一家 · 不选就自动分配。</Text>
          )}
          </View>

          {/* DEMAND-SPECS-SKELETON-001：报错 + 上一步/发布搬进底部固定条（原型 bottom
              区）—— 长页不用拉到底才看得到。 */}
        </>
      ) : (
        <>
          <Text selectable style={styles.doneSub}>{targetAgent ? `已经向 ${targetAgent.name} 发出需求，等待 TA 确认。` : "你的需求已经进入市场。"}</Text>
          <View style={styles.summaryCard}>
            <Text selectable style={styles.summaryEyebrow}>Opportunity</Text>
            <Text selectable style={styles.summaryTitle}>{result?.title ?? template?.title}</Text>
            {/* DEMAND-TARGET-KEEP-001：对象这行要跟真实发布口径一致。定向邀约写
                「公开市场」会让用户以为谁都看得到 —— 契约里它只对 TA 和 owner 可见。 */}
            <SummaryRow label="对象" value={targetAgent ? `定向 · ${targetAgent.name}` : "公开市场"} />
            {/* DEMAND-HEADCOUNT-002：展示 1–6 人的选择（默认 1 人）。 */}
            <SummaryRow label="人数" value={`${normalizeHeadcount(specs.ratio)} 人`} />
            <SummaryRow label="标准" value={`${specs.time} · ${specs.duration}`} />
            <SummaryRow label="价格" value={negotiable ? `${specs.price} · 可协商` : specs.price} last={!showNotes && !showPerson} />
            {showNotes ? <SummaryRow label="备注" value={specs.notes.trim()} last={!showPerson} /> : null}
            {showPerson ? <SummaryRow label="意向人选" value={selectedPerson.name} last /> : null}
          </View>
          <View style={styles.doneRow}>
            <Pressable onPress={restart} style={styles.secondaryBtn}><Text selectable style={styles.secondaryBtnText}>再发一个</Text></Pressable>
            <Pressable onPress={onViewMarket} style={styles.primaryBtnFlex}><Text selectable style={styles.primaryBtnText}>查看市场</Text></Pressable>
          </View>
        </>
      )}
    </ScrollView>
    {step === "specs" ? (
      <View style={styles.specsBottomBar}>
        <View style={styles.specsBottomSummary}>
          <Text selectable numberOfLines={1} style={styles.specsBottomSummaryText}>{bottomSummary}</Text>
          <Text selectable style={styles.specsBottomPrice}>{priceLabel}</Text>
        </View>
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
        <View style={styles.doneRow}>
          <Pressable onPress={back} style={styles.secondaryBtn}><Text selectable style={styles.secondaryBtnText}>上一步</Text></Pressable>
          <Pressable disabled={publishing || !template || (isPro && mode === undefined)} onPress={() => void publish()} style={[styles.primaryBtnFlex, (publishing || !template || (isPro && mode === undefined)) && styles.disabled]}>
            {/* DEMAND-TARGET-KEEP-001：按钮文案跟真实发布口径走 —— 选了人就是邀约，
                没选人才是发布。market.tsx:1684 早就是这个形状，这里跟上。 */}
            <Text selectable style={styles.primaryBtnText}>{publishing ? "发布中…" : targetAgent ? `向 ${targetAgent.name} 发出邀约` : "发布到市场"}</Text>
          </Pressable>
        </View>
      </View>
    ) : null}
    </View>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }): React.JSX.Element {  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text selectable style={styles.summaryLabel}>{label}</Text>
      <Text selectable style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

// DEMAND-SPECS-SKELETON-001 编号分段（原型 section 骨架：数字徽 + 标题 + 右侧 hint，
// 段间细线）。徽用 ink —— 本页去粉，不把原型的粉色带进来。
function SpecsSection({ no, title, hint, children }: {
  no: number;
  title: string;
  // DEMAND-NOISE-TRIM-001：hint 收 ReactNode —— 选完场景后这一格放「清除」动作
  //（原来单独占一整行「已选：X · 清除」，跟上面那张选中卡重复）。
  hint?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.specSection}>
      <View style={styles.specSectionHead}>
        <View style={styles.specSectionTitleRow}>
          <View style={styles.specStepBadge}><Text selectable style={styles.specStepBadgeText}>{no}</Text></View>
          <Text selectable style={styles.specSectionTitle}>{title}</Text>
        </View>
        {hint === undefined || hint === "" ? null : typeof hint === "string" ? (
          <Text selectable style={styles.specSectionHint}>{hint}</Text>
        ) : (
          // DEMAND-SPECS-GUTTER-001：hint 槽现在也会放**动作**（选完场景那个 X 字形），
          // 不能再无脑裹一层 <Text> —— Pressable 塞在 Text 里是行内流，命中区跟着
          // 字形走（16px），既难点、位置也由文本基线决定。是节点就直接渲染，
          // 由调用方自己给盒子。
          hint
        )}
      </View>
      {children}
    </View>
  );
}

// DEMAND-TIMESLOT-002 滚轮弹层；DEMAND-DURATION-001 起由时间段独享改为两人共用
// （标题 + 选项数组由调用方给）。原型结构照搬：遮罩 + 底部 sheet + 把手 +
// 取消/标题/确定 + 滚轮（上下留白让首尾能滚到中间，松手吸附，点选直达）。
// temp 是弹层里的临时值 —— 取消不写回，确定才写（跟原型一致）。
const TIME_WHEEL_ITEM_H = 44;
const TIME_WHEEL_H = 220;

function WheelSheet({ title, options, value, closeLabel, onCancel, onConfirm }: {
  title: string;
  options: readonly string[];
  value: string;
  /** 遮罩的无障碍标签（时间/时长各叫各的，免得读屏分不清）。 */
  closeLabel: string;
  onCancel: () => void;
  onConfirm: (slot: string) => void;
}): React.JSX.Element {
  const [temp, setTemp] = useState(value);
  const scrollRef = useRef<ScrollView>(null);

  // 打开即定位到当前值。挂载后下一帧再滚 —— 首帧还没量好，直接滚会被吞掉。
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, options.indexOf(value)) * TIME_WHEEL_ITEM_H, animated: false });
    }, 30);
    return () => clearTimeout(timer);
  }, [options, value]);

  function settle(offsetY: number): void {
    const slot = options[Math.min(Math.max(Math.round(offsetY / TIME_WHEEL_ITEM_H), 0), options.length - 1)];
    if (slot !== undefined) setTemp(slot);
  }

  function pick(slot: string): void {
    setTemp(slot);
    scrollRef.current?.scrollTo({ y: Math.max(0, options.indexOf(slot)) * TIME_WHEEL_ITEM_H, animated: true });
  }

  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible>
      <Pressable accessibilityLabel={closeLabel} onPress={onCancel} style={styles.timeSheetMask} />
      <View style={styles.timeSheet}>
        <View style={styles.timeSheetHandle} />
        <View style={styles.timeSheetHead}>
          <Pressable accessibilityLabel="取消" onPress={onCancel} style={styles.timeSheetCancel}>
            <Text selectable style={styles.timeSheetCancelText}>取消</Text>
          </Pressable>
          <Text selectable style={styles.timeSheetTitle}>{title}</Text>
          <Pressable accessibilityLabel="确定" onPress={() => onConfirm(temp)} style={styles.timeSheetConfirm}>
            <Text selectable style={styles.timeSheetConfirmText}>确定</Text>
          </Pressable>
        </View>
        <View style={styles.timeWheelWrap}>
          <View pointerEvents="none" style={styles.timeWheelHighlight} />
          <ScrollView
            contentContainerStyle={{ paddingVertical: (TIME_WHEEL_H - TIME_WHEEL_ITEM_H) / 2 }}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.y)}
            onScrollEndDrag={(event) => { if ((event.nativeEvent.velocity?.y ?? 0) === 0) settle(event.nativeEvent.contentOffset.y); }}
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            snapToAlignment="center"
            snapToInterval={TIME_WHEEL_ITEM_H}
            style={styles.timeWheelScroll}
          >
            {options.map((slot) => (
              <Pressable key={slot} accessibilityLabel={`选择${slot}`} onPress={() => pick(slot)} style={styles.timeWheelItem}>
                <Text selectable style={[styles.timeWheelItemText, temp === slot && styles.timeWheelItemTextOn]}>{slot}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // 2026-10-06 用户：「这个页面2边不要留白」—— 页边距清零，整页通栏。
  // 这个包裹层同时套着 head / tabs / hero / 搜索行 / quick-filter / 双栏
  // deliveryLayout，所以清零是**整页**生效（标题、输入框、分段按钮一起贴边），
  // 不只是那张双栏卡片。要只让双栏通栏就改这里成 16、给 deliveryLayout 加
  // marginHorizontal: -16（一行的事，但那不是这次要的）。
  // 与 market.tsx 的 contentFlat（订单/地图 tab 通栏）同一个做法。
  content: { paddingBottom: 32, paddingHorizontal: 0, paddingTop: 8 },
  head: { alignItems: "center", flexDirection: "row", marginBottom: 8 },
  backBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  title: { color: color.ink, flex: 1, fontSize: 20, fontWeight: "900", textAlign: "center" },
  draftBtn: { alignItems: "center", height: 38, justifyContent: "center", paddingHorizontal: 6 },
  draftText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  headSpacer: { width: 38 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 10 },
  tab: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 10 },
  tabActive: { backgroundColor: color.ink, borderColor: color.ink },
  tabText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  tabTextActive: { color: color.white },
  restoredHint: { color: color.violet, fontSize: 11, marginBottom: 8 },
  // R58 hero：标题 + 副标题 + Moment badge。
  hero: { paddingBottom: 4, paddingTop: 2 },
  heroTitle: { color: color.ink, fontSize: 24, fontWeight: "900" },
  heroSub: { color: color.muted, fontSize: 13, marginTop: 3 },
  momentBadge: { alignSelf: "flex-start", backgroundColor: "#F3EEE7", borderRadius: 999, marginTop: 7, paddingHorizontal: 10, paddingVertical: 4 },
  momentBadgeText: { color: "#6E6458", fontSize: 11, fontWeight: "800" },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 10, marginTop: 10 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 19, borderWidth: 1, flexDirection: "row", flex: 1, gap: 6, height: 50, paddingHorizontal: 13 },
  searchIcon: { color: color.muted, fontSize: 15 },
  searchInput: { color: color.ink, flex: 1, fontSize: 14, paddingVertical: 10 },
  generateBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 14, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 12 },
  generateText: { color: color.white, fontSize: 13, fontWeight: "800" },
  quickFilterRow: { flexDirection: "row", gap: 6, paddingVertical: 2 },
  filterChip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  filterText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  filterTextOn: { color: color.white },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  // R58 双栏 delivery-layout：左分类 rail + 右卡片列表。
  // 2026-10-06 用户：「不要保留r角 这不是图片」—— 这一格是内容容器（左 rail + 右列表），
  // 不是图片，圆角 22 是照图片框那套给的，撤掉。上一轮把 content 的横向 padding 清零后，
  // 这张卡片左右已经贴到屏幕边，22 的圆角在屏幕边缘被切掉，看着就像一张被裁过的图 ——
  // 这句就是冲它来的。
  // 同页的 mapWrapper 不动：它的圆角 22 由 MAP-CONTAINER-PARITY-001 钉着，是
  // Home / Market / 发布器三处地图容器的统一语言，不是本地口味（map-container-parity.test.ts:148）。
  // overflow 保留：它挡的是 categoryRail 的整格底色外溢，不是给圆角用的，所以圆角撤了它不用动。
  deliveryLayout: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1, flexDirection: "row", marginTop: 14, minHeight: 320, overflow: "hidden" },
  categoryRail: { backgroundColor: "#F4F1EC", borderRightColor: color.line, borderRightWidth: 1, width: 66 },
  categoryBtn: { alignItems: "center", justifyContent: "center", minHeight: 56, paddingHorizontal: 4 },
  categoryBtnOn: { backgroundColor: color.white },
  categoryBtnText: { color: "#8A837B", fontSize: 12, fontWeight: "700", textAlign: "center" },
  categoryBtnTextOn: { color: color.ink, fontWeight: "900" },
  catalogPane: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },
  catalogHead: { flexDirection: "row", alignItems: "baseline", gap: 7, marginBottom: 2 },
  catalogTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  catalogHint: { color: color.muted, fontSize: 11 },
  // 「专业」分类的子标签行（原型 sub-tabs）。pane 比整屏窄，所以横向可滚。
  // 与 Moment 的 quickFilterRow 分开命名：那一排筛的是 Moment 属性，语义不同。
  proTabRow: { flexDirection: "row", gap: 6, paddingBottom: 6, paddingTop: 6 },
  catalogItem: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 11, paddingVertical: 11 },
  catalogTags: { flexDirection: "row", gap: 5, marginTop: 4, flexWrap: "wrap" },
  catalogTag: { backgroundColor: "#F5F2EE", borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
  catalogTagText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  catalogSide: { alignItems: "flex-end", gap: 3 },
  catalogSideRatio: { color: color.ink, fontSize: 13, fontWeight: "900" },
  catalogSideTime: { color: color.muted, fontSize: 11 },
  momentEmoji: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  momentIcon: { height: 26, tintColor: color.ink, width: 26 },
  // 2026-10-06 合并：这里原本有两组专业服务样式 ——
  // `proCard*`（双栏外那格 2 列服务卡）与 `professionalEntry / proIcon* / proCopy /
  // proTitle / proDesc / proLink`（那张「城市协助 · Professional」入口卡）。
  // 城市协助整格搬进双栏选择器后两组都没人用了 —— 本仓对死代码有前科，一并删净。
  // 服务行现在直接复用 Moment 那套（catalogItem / momentEmoji / momentTitle / …），
  // 这正是「合并成一个选择器」该有的样子：两边长得一样，因为是同一套样式。
  momentEmojiText: { color: color.ink, fontSize: 20, fontWeight: "800" },
  momentCopy: { flex: 1 },
  momentTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  momentDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  // 原型 item-top / item-price：名字在左、价格贴右端同一行。
  // 价格用 ink（不是原型的 accent 粉）：用户上一轮刚要求这一屏去掉粉色
  // （「这个选择……也不需要粉色」），卡面就先保持单色，别再插一块粉进来。
  momentTop: { alignItems: "flex-start", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  momentPrice: { alignItems: "flex-end", flexShrink: 0 },
  momentPriceNum: { color: color.ink, fontSize: 15, fontWeight: "900" },
  // 11pt 是底线（design-system-r3 的「读的文字不许小于 11pt」）—— 原型这里写 10.5，
  // 但那是封面角标那类装饰的白名单口径；「起步价」是**读的**文字，不往白名单里塞。
  momentPriceUnit: { color: color.muted, fontSize: 11, marginTop: 2 },
  // 原型 item-bottom / item-meta：tags 在左，meta 靠 marginLeft:auto 推到右端。
  // alignItems 用 flex-end 而不是 center：catalogTags 自带 marginTop 4（专业行在用），
  // center 会把它顶下去 2px，flex-end 则两个都贴底，看着才齐。
  momentBottom: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  momentMeta: { color: color.muted, fontSize: 11, marginLeft: "auto" },
  momentCardOn: { borderColor: color.violet, borderWidth: 2 },
  empty: { color: color.muted, fontSize: 12, marginVertical: 12, textAlign: "center" },
  currentCard: { backgroundColor: color.surface, borderRadius: 14, marginTop: 12, padding: 12 },
  currentLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  currentValue: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 2 },
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 12, marginBottom: 10, marginTop: 4 },
  // SCENE-STEP-ONEPAGE-001：规格页里的场景 list 段落（不是一步）。
  sceneSection: { marginBottom: 12 },
  // DEMAND-SCENE-MAP-001：列表/地图里选中后的已选行（清掉重选）。
  // DEMAND-NOISE-TRIM-001：「已选：XXX · 清除」整行撤了（选中卡自己会变色，
  // 「清除」搬进段头 hint 槽）—— 原来那四条样式（pickedRow/pickedText/
  // pickedClear/pickedClearText）引用归零，一并删掉，不留死样式。
  filterHeadRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sheetToggle: { paddingHorizontal: 6, paddingVertical: 4 },
  sheetToggleText: { color: color.violet, fontSize: 12, fontWeight: "800" },
  sheet: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, marginBottom: 8, padding: 12 },
  sheetLabel: { color: color.ink, fontSize: 12, fontWeight: "800", marginBottom: 6, marginTop: 8 },
  sheetActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  sheetReset: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 10 },
  sheetResetText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  sheetApply: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, flex: 1, paddingVertical: 10 },
  sheetApplyText: { color: color.white, fontSize: 13, fontWeight: "800" },
  momentCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 10, padding: 14 },
  personCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 8, padding: 12 },
  personAvatar: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  personAvatarText: { color: color.ink, fontSize: 17, fontWeight: "800" },
  personCopy: { flex: 1 },
  personNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  personName: { color: color.ink, fontSize: 15, fontWeight: "800" },
  certBadge: { backgroundColor: "#E9F9EF", borderRadius: 8, color: "#1C7A3D", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  personMeta: { color: color.muted, fontSize: 11, marginTop: 2 },
  selectBtn: { borderColor: color.violet, borderRadius: 999, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 7 },
  selectBtnOn: { backgroundColor: color.violet, borderColor: color.violet },
  selectText: { color: color.violet, fontSize: 12, fontWeight: "800" },
  selectTextOn: { color: color.white },
  confirmCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, flexDirection: "row", marginBottom: 6, padding: 14 },
  confirmCopy: { flex: 1 },
  confirmEyebrow: { color: color.violet, fontSize: 11, fontWeight: "800" },
  confirmTitle: { color: color.ink, fontSize: 19, fontWeight: "900", marginTop: 2 },
  confirmSub: { color: color.muted, fontSize: 11, marginTop: 2 },
  linkText: { color: color.violet, fontSize: 13, fontWeight: "700" },
  fieldLabel: { color: color.ink, fontSize: 13, fontWeight: "800", marginBottom: 6, marginTop: 14 },
  fieldLabelRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 6, marginTop: 14 },
  fieldLabelNoGap: { color: color.ink, fontSize: 13, fontWeight: "800" },
  dynamicBadge: { backgroundColor: color.surface, borderRadius: 8, color: color.violet, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  // DEMAND-SPECS-SKELETON-001：编号分段 + 底部汇总条。顶上的 specSummary 盒撤了
  // （当前选择收到底部条，一页只讲一遍），这俩样式没人用了，一并删净。
  // 分段：段间细线 + 数字徽（ink，去粉）+ 标题 + 右侧 hint。
  page: { flex: 1 },
  pageScroll: { flex: 1 },
  specSection: { borderBottomColor: color.line, borderBottomWidth: 1, paddingBottom: 16 },
  // DEMAND-SPECS-GUTTER-001：规格步自己的 16 页边距。**不能**加在共用的 content 上
  // （选 Moment 那屏要通栏，用户 2026-10-06 点名过），所以只在规格步的渲染处套一层。
  specsGutter: { paddingHorizontal: 16 },
  specSectionHead: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 14 },
  specSectionTitleRow: { alignItems: "center", flexDirection: "row" },
  specStepBadge: { alignItems: "center", backgroundColor: color.ink, borderRadius: 999, height: 20, justifyContent: "center", marginRight: 8, width: 20 },
  specStepBadgeText: { color: color.white, fontSize: 11, fontWeight: "800" },
  specSectionTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  specSectionHint: { color: color.muted, fontSize: 11 },
  // DEMAND-SPECS-GUTTER-001：段头 hint 槽里的**动作**盒子（选完场景那个 X 字形）。
  // 16px 字形直接贴边既难点也看着顶到屏幕上（用户：「x稍微太靠右边缘了」）——
  // 给一个 28×28 的命中盒把字形居中，右缘就落在页边距 + 6 上（原型 .x-btn 是
  // 24×24 里放 12px svg，同一个思路）。alignSelf 是给段头那行用的：
  // specSectionHead 是 baseline 对齐，动作盒不参与文本基线，自己居中。
  specHintAction: { alignItems: "center", alignSelf: "center", height: 28, justifyContent: "center", width: 28 },
  specsBottomBar: { backgroundColor: color.white, borderTopColor: color.line, borderTopWidth: 1, paddingBottom: 16, paddingHorizontal: 16, paddingTop: 10 },
  specsBottomSummary: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  specsBottomSummaryText: { color: color.muted, flex: 1, fontSize: 12, fontWeight: "500" },
  specsBottomPrice: { color: color.ink, fontSize: 15, fontWeight: "900", marginLeft: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 15, paddingHorizontal: 14, paddingVertical: 10 },
  // DEMAND-INFO-CARD-001（2026-10-07，用户：「人数 时间xx也按照原型做紧凑模式」）：
  // 原型 ③ 的 `.info-card` / `.info-row` / `.info-label` / `.info-value` / `.arrow`。
  // 一张卡 + 三行，行间 1px 细线（RN 没有 `+` 兄弟选择器，第 2、3 行各自带上边线）。
  // 行内左侧 label 占满（flex:1），右侧值 + caret 贴右。
  // ⚠️ 原型的 `.arrow` 是 10px —— 这里用 11：design-system-r3.test.ts 的下限是 11。
  infoCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  infoRow: { alignItems: "center", flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  infoRowDivider: { borderTopColor: color.line, borderTopWidth: 1 },
  infoLabel: { color: color.ink, flex: 1, fontSize: 13.5, fontWeight: "600" },
  infoValue: { alignItems: "center", flexDirection: "row", gap: 6 },
  infoValueText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  infoArrow: { color: color.muted, fontSize: 11, fontWeight: "800" },
  // DEMAND-HEADCOUNT-003：下拉菜单。开在卡内、紧跟它那一行 —— 所以**不要**外框/
  // 圆角/外边距，只留白底：选项行自带的下边线把它和下面的行接成同一张卡。
  // 选项行 + ✓ 沿用 filterDropdownOption 那套语言，不另起一套。
  headcountMenu: { backgroundColor: color.white },
  // DEMAND-TIMESLOT-002：滚轮弹层样式（原型同款结构）。确定按钮用 ink ——
  // 本页去粉（见 primaryBtn 注释），不把原型的粉色带进来。
  timeSheetMask: { backgroundColor: "rgba(0,0,0,0.35)", flex: 1 },
  timeSheet: { backgroundColor: color.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, bottom: 0, left: 0, paddingBottom: 24, position: "absolute", right: 0 },
  timeSheetHandle: { alignSelf: "center", backgroundColor: "#D0CEC8", borderRadius: 2, height: 4, marginTop: 10, width: 40 },
  timeSheetHead: { alignItems: "center", flexDirection: "row", paddingHorizontal: 8, paddingVertical: 8 },
  timeSheetCancel: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  timeSheetCancelText: { color: color.muted, fontSize: 13, fontWeight: "600" },
  timeSheetTitle: { color: color.ink, flex: 1, fontSize: 15, fontWeight: "800", textAlign: "center" },
  timeSheetConfirm: { backgroundColor: color.ink, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  timeSheetConfirmText: { color: color.white, fontSize: 13, fontWeight: "600" },
  timeWheelWrap: { height: 220, overflow: "hidden", position: "relative" },
  timeWheelHighlight: { backgroundColor: color.surface, borderRadius: 10, height: 44, left: 20, position: "absolute", right: 20, top: 88 },
  timeWheelScroll: { flex: 1 },
  timeWheelItem: { alignItems: "center", height: 44, justifyContent: "center" },
  timeWheelItemText: { color: color.muted, fontSize: 17, fontWeight: "500" },
  timeWheelItemTextOn: { color: color.ink, fontSize: 19, fontWeight: "800" },
  headcountOption: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  headcountOptionLast: { borderBottomWidth: 0 },
  headcountOptionText: { color: color.ink, fontSize: 14, fontWeight: "700" },
  headcountCheck: { color: color.ink, fontSize: 14, fontWeight: "900" },
  priceMain: { alignItems: "center", flexDirection: "row", gap: 8 },
  priceInput: { flex: 1 },
  negoBtn: { alignItems: "center", borderColor: color.line, borderRadius: 12, borderWidth: 1, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10 },
  negoBtnOn: { backgroundColor: color.ink, borderColor: color.ink },
  negoBtnText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  negoBtnTextOn: { color: color.white },
  notesInput: { minHeight: 64, textAlignVertical: "top" },
  // OPP-REAL-COORDS-001: 地点选图框，跟 Market 内联卡同规格（高 330/圆角 22）。
  mapWrapper: { borderColor: color.line, borderRadius: 22, borderWidth: 1, height: 330, marginTop: 8, overflow: "hidden", width: "100%" },
  hint: { color: color.muted, fontSize: 11, marginTop: 6 },
  error: { color: color.error, fontSize: 12, marginTop: 12, textAlign: "center" },
  // 2026-10-06 用户（截图指着这一步的「选择」）：「这个选择不需要做那么宽 也不需要粉色」。
  // 原来照 R58 原型：原型 .next-btn 是 `width:100%` + 粉色渐变（#EC1E5E→#D81B60）。
  // 现在收成**贴右边的小药丸**：宽度跟着字走（paddingHorizontal，不再撑满），
  // 底色用 color.ink —— 就是这一页「生成」「应用筛选」用的那个主色，不是粉色。
  // 只改这一处：primaryBtn 只有第一步用（第二/三步那排是 primaryBtnFlex，跟「上一步」同排）。
  primaryBtn: { alignItems: "center", alignSelf: "flex-end", backgroundColor: color.ink, borderRadius: 14, justifyContent: "center", marginRight: 16, marginTop: 14, paddingHorizontal: 32, paddingVertical: 13 },
  primaryBtnFlex: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 14, flex: 1, minHeight: 50, justifyContent: "center" },
  primaryBtnText: { color: color.white, fontSize: 15, fontWeight: "900" },
  secondaryBtn: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 50, justifyContent: "center" },
  secondaryBtnText: { color: color.ink, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.5 },
  doneSub: { color: color.muted, fontSize: 13, marginBottom: 12 },
  summaryCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1, padding: 14 },
  summaryEyebrow: { color: color.violet, fontSize: 11, fontWeight: "800" },
  summaryTitle: { color: color.ink, fontSize: 19, fontWeight: "900", marginTop: 2 },
  summaryRow: { borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryLabel: { color: color.muted, fontSize: 13 },
  summaryValue: { color: color.ink, fontSize: 13, fontWeight: "700" },
  doneRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  // SCENE-CARD-REUSE-001：选场景步的手搓卡片样式已整体删除（sceneRow/sceneAvatar
  // 等 8 条），场景列表直接挂 SceneShopDirectory（home 场景 list 本体），
  // 这里不再有任何自己的场景卡/行样式。
  // DEMAND-SUBSECTION-003：原型 ② 的 `.mode-toggle` / `.auto-card`。
  // 轨道用 color.surface（原型 #f2f2f5），**选中项是白药丸 + ink 字**（原型
  // `.mt-btn.active`）。注意本页另一处分段控件（scene-shop-directory 的
  // pickViewToggle，列表/地图）是 ink 实心 —— 这里照原型走白药丸：那处是「视图切换」，
  // 这处是「二选一的模式」，原型的语义就是选中项浮起来。
  modeToggle: { backgroundColor: color.surface, borderRadius: 11, flexDirection: "row", padding: 3 },
  modeToggleBtn: { alignItems: "center", borderRadius: 8, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", paddingVertical: 9 },
  modeToggleBtnOn: { backgroundColor: color.white },
  modeToggleText: { color: color.muted, fontSize: 12.5, fontWeight: "600" },
  modeToggleTextOn: { color: color.ink, fontWeight: "700" },
  // 原型 `.mt-btn .small` 那颗「更快」角标：10pt / mint。这里 11 —— design-system-r3
  // 的下限是 11，不为 1pt 去动装饰白名单（形状对齐兄弟 certBadge）。
  modeToggleBadge: { backgroundColor: "#E4F8F5", borderRadius: 8, color: color.mint, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  // 原型 `.auto-card.active`：accent 实线边 + accent-soft 底。本页的 accent 就是
  // primaryBtnFlex 那颗 color.magenta（原型的 --accent #EC1E5E 同一族），
  // 底色借已有的 attentionBg（= 原型的 rgba(236,30,94,.06) 那层淡粉）。
  autoCard: { alignItems: "center", backgroundColor: color.attentionBg, borderColor: color.magenta, borderRadius: 12, borderWidth: 1.5, flexDirection: "row", gap: 12, marginTop: 10, padding: 16 },
  autoIcon: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  autoBody: { flex: 1, minWidth: 0 },
  autoNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  autoName: { color: color.ink, fontSize: 14, fontWeight: "700" },
  autoBadge: { backgroundColor: color.magenta, borderRadius: 8, color: color.white, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  autoDesc: { color: color.muted, fontSize: 11.5, lineHeight: 16, marginTop: 4 }
});
