// DemandWizard — R58 发布需求向导（选 Moment → 选人 → 规格确认 → 成功）。
//
// 对齐 R58 原型：顶 tabs、搜索+生成、筛选、当前需求、专业协助入口、
// 选人（浏览+筛选+跳过）、规格、价格说明、成功页。发布走
// marketplace.publish（成功即进市场）；选人仅浏览意向（发布恒为
// 公开市场）；草稿存本机。一期备注随机会落库（见 demand-moments）。
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { MarketplaceClient } from "../marketplace-client";
import type { MarketOpportunity } from "../market-fixtures";
import type { SupplierCandidate, SupplyClient } from "../supply-client";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { color } from "../theme";
import {
  buildDemandPublishInput,
  DEFAULT_PEOPLE_FILTERS,
  defaultSpecsFor,
  filterSuppliers,
  MOMENT_ACTION_ID,
  MOMENT_TEMPLATES,
  momentDistanceLabel,
  momentMetaLine,
  momentStartPrice,
  PRO_LOGOS,
  PRO_SERVICES,
  PRO_TABS,
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
import { localApiBaseUrl } from "../native-clients";
// 卡面右下角的距离（用户选「接真实距离」）：真实定位 + 真实场景目录。
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { loadSceneSpots, type SceneSpot } from "../activity-create-form";
import type { SceneOrigin } from "../scene-shop-directory";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyIcon } from "../components/proxy-icon";

type Step = "moment" | "people" | "specs" | "done";

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
const DURATIONS = ["2 小时", "半天", "全天"];
const PREF_OPTIONS = ["公共场所见面", "中文", "附近"];
const PEOPLE_FILTERS = ["推荐", "附近", "现在可用", "已认证"] as const;

const DRAFT_KEY = "proxy.demandWizard.draft.v1";

type DraftState = { templateId: string; specs: DemandSpecs };

export function DemandWizard({ marketplace, supply, onBack, onPublished, onViewMarket, onCreateActivity }: {
  marketplace: MarketplaceClient;
  supply?: SupplyClient | undefined;
  onBack: () => void;
  onPublished: (opportunity: MarketOpportunity) => void;
  onViewMarket: () => void;
  onCreateActivity: () => void;
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
  const [publishing, setPublishing] = useState(false);
  const [negotiable, setNegotiable] = useState(false);
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
        setSpecs({ ...defaultSpecsFor(found), ...draft, prefs: Array.isArray(draft.prefs) ? draft.prefs : [] });
        setDraftRestored(true);
      } catch {
        // 坏草稿忽略。
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // 距离角标的两个来源：公开场景目录（免登）+ 设备定位。
  // getCurrentFix 默认**不弹**授权框（DEVICE-LOCATION-003：打开 App 就调，不能每次
  // 冷启动都弹）—— 没授权/超时就返回 undefined，卡面整格不画距离，不编一个。
  useEffect(() => {
    let cancelled = false;
    void loadSceneSpots(fetch, localApiBaseUrl)
      .then((list) => { if (!cancelled) setScenes(list); })
      .catch(() => undefined);
    void getCurrentFix(expoLocationApi).then((fix) => {
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
    setError(undefined);
    setStep("people");
  }

  function pickTemplate(next: MomentTemplate): void {
    setTemplate(next);
    setSpecs(defaultSpecsFor(next));
    setSelectedPerson(undefined);
    setError(undefined);
  }

  // 选人：supply 名单本机过滤；仅浏览意向，发布恒为公开市场。
  useEffect(() => {
    if (step !== "people" || peopleLoaded || !supply) return;
    let cancelled = false;
    void supply.querySuppliers({ marketId: "hn", capability: "ZH", limit: 12 }).then((items) => {
      if (cancelled) return;
      setPeople(items);
      setPeopleLoaded(true);
    }).catch(() => {
      if (!cancelled) setPeopleLoaded(true);
    });
    return () => { cancelled = true; };
  }, [step, peopleLoaded, supply]);

  function togglePeopleFilter(filter: string): void {
    setPeopleFilters((prev) => prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]);
  }

  const sheetActiveCount =
    (sheetFilters.language !== "不限" ? 1 : 0) +
    (sheetFilters.certifiedOnly ? 1 : 0) +
    (sheetFilters.maxBudget > 0 ? 1 : 0) +
    (sheetFilters.day !== "不限" ? 1 : 0);
  const visiblePeople = filterSuppliers(people, peopleFilters, sheetFilters);

  function togglePref(pref: string): void {
    setSpecs((prev) => ({
      ...prev,
      prefs: prev.prefs.includes(pref) ? prev.prefs.filter((item) => item !== pref) : [...prev.prefs, pref]
    }));
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
      const opportunity = await marketplace.publish(buildDemandPublishInput(template, specs));
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
    setError(undefined);
    setResult(undefined);
    setDraftRestored(false);
    setStep("moment");
  }

  function back(): void {
    if (step === "moment") onBack();
    else if (step === "people") setStep("moment");
    else if (step === "specs") setStep("people");
  }

  const showNotes = specs.notes.trim() !== "";
  const showPerson = selectedPerson !== undefined;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="返回" onPress={back} style={styles.backBtn}>
          <ProxyBackGlyph />
        </Pressable>
        <Text selectable style={styles.title}>{step === "done" ? "✓ 需求已发布" : "发布需求"}</Text>
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
            <Text selectable style={styles.currentValue}>{template ? `${template.title}${proService ? ` · ${PRO_SERVICES.find((item) => item.id === proService)?.title ?? ""}` : ""} · ${specs.ratio || template.defaultRatio}` : "先选一个"}</Text>
          </View>
          <Pressable disabled={!template} onPress={() => setStep("people")} style={[styles.primaryBtn, !template && styles.disabled]}>
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
              只改文案，不动行为 —— 点了还是进「选人」那一步。 */}
        </>
      ) : step === "people" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text selectable style={styles.confirmEyebrow}>Moment · {template?.defaultRatio}</Text>
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
            : visiblePeople.map((person) => {
              const active = selectedPerson?.agentId === person.agentId;
              const photo = person.photos.length > 0
                ? resolveAssetSource(
                    person.photos[0]!.startsWith("/") ? { kind: "serverPath", path: person.photos[0]! } : { kind: "remote", url: person.photos[0]! },
                    { baseUrl: localApiBaseUrl }
                  )
                : undefined;
              return (
                <View key={person.agentId} style={[styles.personCard, active && styles.momentCardOn]}>
                  {typeof photo === "object" ? (
                    <CircularAvatarImage accessibilityLabel={`${person.name}头像`} size={44} source={photo} />
                  ) : (
                    <View style={styles.personAvatar}><Text selectable style={styles.personAvatarText}>{person.name.trim().charAt(0) || "?"}</Text></View>
                  )}
                  <View style={styles.personCopy}>
                    <View style={styles.personNameRow}>
                      <Text selectable style={styles.personName}>{person.name}</Text>
                      {person.eligibility.capabilitiesOk ? <Text selectable style={styles.certBadge}>已认证</Text> : null}
                    </View>
                    <Text selectable style={styles.personMeta}>{person.languages.length > 0 ? person.languages.join(" · ") : person.serviceType}</Text>
                    <Text selectable style={styles.personMeta}>
                      {person.availability ? "有档期" : "档期待确认"} · {person.referencePrice > 0 ? `参考 ${Math.round(person.referencePrice / 1000)}K ${person.currency}` : "价格面议"}
                    </Text>
                  </View>
                  <Pressable accessibilityLabel={`选择${person.name}`} onPress={() => setSelectedPerson(active ? undefined : person)} style={[styles.selectBtn, active && styles.selectBtnOn]}>
                    <Text selectable style={[styles.selectText, active && styles.selectTextOn]}>{active ? "已选择" : "选择 TA"}</Text>
                  </Pressable>
                </View>
              );
            })}
          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            <Pressable onPress={() => setStep("moment")} style={styles.secondaryBtn}><Text selectable style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable onPress={() => setStep("specs")} style={styles.primaryBtnFlex}><Text selectable style={styles.primaryBtnText}>选择</Text></Pressable>
          </View>
        </>
      ) : step === "specs" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text selectable style={styles.confirmEyebrow}>Moment · {specs.ratio || template?.defaultRatio}</Text>
              <Text selectable style={styles.confirmTitle}>{template?.title}</Text>
              {selectedPerson ? <Text selectable style={styles.confirmSub}>意向人选：{selectedPerson.name}（发布仍为公开市场）</Text> : null}
              {/* 2026-10-06 合并：专业服务的选择收进了选 Moment 那一步的双栏选择器，
                  规格步不再摆第二遍服务目录（那一格是第三份拷贝）。但「选了哪个服务」
                  得还看得见 —— 这是发布前最后一屏，模板名只到「城市协助」为止。
                  要换服务就点右上「更换」回选 Moment 那一步。 */}
              {proService ? <Text selectable style={styles.confirmSub}>专业服务：{PRO_SERVICES.find((item) => item.id === proService)?.title ?? ""}</Text> : null}
            </View>
            <Pressable onPress={() => setStep("moment")}><Text selectable style={styles.linkText}>更换</Text></Pressable>
          </View>
          <Text selectable style={styles.sectionSub}>Moment 规格 · 默认已帮你填好</Text>
          <View style={styles.specSummary}>
            <Text selectable style={styles.specSummaryText}>
              {specs.prefs.includes("公共场所见面") ? "公共场所见面" : "见面方式自定"} · {specs.duration || "时长自定"} · 现场消费双方自结
            </Text>
          </View>

          <Text selectable style={styles.fieldLabel}>你们几人</Text>
          <View style={styles.chipRow}>
            {(template?.ratios ?? []).map((ratio) => (
              <Pressable key={ratio} onPress={() => setSpecs((prev) => ({ ...prev, ratio }))} style={[styles.chip, specs.ratio === ratio && styles.chipOn]}>
                <Text selectable style={[styles.chipText, specs.ratio === ratio && styles.chipTextOn]}>{ratio}</Text>
              </Pressable>
            ))}
          </View>

          <Text selectable style={styles.fieldLabel}>时间段</Text>
          <TextInput onChangeText={(time) => setSpecs((prev) => ({ ...prev, time }))} placeholder={template?.defaultTime} placeholderTextColor={color.muted} style={styles.input} value={specs.time} />

          <Text selectable style={styles.fieldLabel}>时长</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((duration) => (
              <Pressable key={duration} onPress={() => setSpecs((prev) => ({ ...prev, duration }))} style={[styles.chip, specs.duration === duration && styles.chipOn]}>
                <Text selectable style={[styles.chipText, specs.duration === duration && styles.chipTextOn]}>{duration}</Text>
              </Pressable>
            ))}
          </View>

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

          <Text selectable style={styles.fieldLabel}>场景偏好 · 影响匹配 / 报价</Text>
          <View style={styles.chipRow}>
            {PREF_OPTIONS.map((pref) => (
              <Pressable key={pref} onPress={() => togglePref(pref)} style={[styles.chip, specs.prefs.includes(pref) && styles.chipOn]}>
                <Text selectable style={[styles.chipText, specs.prefs.includes(pref) && styles.chipTextOn]}>{pref}</Text>
              </Pressable>
            ))}
          </View>

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
          <Text selectable style={styles.hint}>ⓘ 价格由场景基础价、时间、人数和额外偏好组成；偏好只用于匹配，不按行为收费。服务参考价；餐饮、咖啡、KTV、门票等现场消费不包含在内。</Text>

          <Text selectable style={styles.fieldLabel}>备注 · 可选</Text>
          <TextInput maxLength={500} multiline onChangeText={(notes) => setSpecs((prev) => ({ ...prev, notes }))} placeholder="补充说明（随订单展示）" placeholderTextColor={color.muted} style={[styles.input, styles.notesInput]} value={specs.notes} />

          {error ? <Text selectable style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            <Pressable onPress={() => setStep("people")} style={styles.secondaryBtn}><Text selectable style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable disabled={publishing || !template} onPress={() => void publish()} style={[styles.primaryBtnFlex, (publishing || !template) && styles.disabled]}>
              <Text selectable style={styles.primaryBtnText}>{publishing ? "发布中…" : "发布到市场"}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text selectable style={styles.doneSub}>你的需求已经进入市场。</Text>
          <View style={styles.summaryCard}>
            <Text selectable style={styles.summaryEyebrow}>Opportunity</Text>
            <Text selectable style={styles.summaryTitle}>{result?.title ?? template?.title}</Text>
            <SummaryRow label="对象" value="公开市场" />
            <SummaryRow label="客户方" value={specs.ratio === "1:1" ? "1 人 · 1:1" : (specs.ratio || (template?.defaultRatio ?? ""))} />
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
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }): React.JSX.Element {  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text selectable style={styles.summaryLabel}>{label}</Text>
      <Text selectable style={styles.summaryValue}>{value}</Text>
    </View>
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
  specSummary: { backgroundColor: color.surface, borderRadius: 12, marginBottom: 4, padding: 10 },
  specSummaryText: { color: color.ink, fontSize: 12, lineHeight: 18 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { color: color.ink, fontSize: 13, fontWeight: "700" },
  chipTextOn: { color: color.white },
  input: { backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, color: color.ink, fontSize: 15, paddingHorizontal: 14, paddingVertical: 10 },
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
  doneRow: { flexDirection: "row", gap: 10, marginTop: 16 }
});
