// DemandWizard — R58 发布需求向导（选 Moment → 选人 → 规格确认 → 成功）。
//
// 对齐 R58 原型：顶 tabs、搜索+生成、筛选、当前需求、专业协助入口、
// 选人（浏览+筛选+跳过）、规格、价格说明、成功页。发布走
// marketplace.publish（成功即进市场）；选人仅浏览意向（发布恒为
// 公开市场）；草稿存本机。一期备注随机会落库（见 demand-moments）。
import { useEffect, useState } from "react";
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
  PRO_SERVICES,
  type DemandSpecs,
  type MomentTemplate,
  type PeopleSheetFilters,
  type ProService
} from "../demand-moments";
import { resolveAssetSource } from "../media/asset-sources";
import { SCENE_ACTIONS } from "../components/scene-activity-discovery";
import { Image } from "expo-image";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { localApiBaseUrl } from "../native-clients";

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

// R58 原型左侧分类 rail：热门 / 见面 / 娱乐 / 出行 / 主题。
const CATEGORIES = [
  { id: "all", label: "热门" },
  { id: "meet", label: "见面" },
  { id: "fun", label: "娱乐" },
  { id: "outdoor", label: "出行" },
  { id: "theme", label: "主题" }
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
  const proIcon = actionIconFor("pro");
  // R58 城市协助 · Professional：当前选中的服务（现场翻译 / 签证协助 / 法律咨询 / 商务协助）
  const [proService, setProService] = useState<string | undefined>(undefined);
  // 服务卡默认折叠：不占用 Moment 列表与「下一步」之间的空间，避免误触/遮挡
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
    const q = query.trim().toLowerCase();
    if (q !== "" && !`${item.title}${item.venue}${item.theme}`.toLowerCase().includes(q)) return false;
    if (category !== "all" && item.category !== category) return false;
    if (quickFilter === "one" && !item.ratios.includes("1:1")) return false;
    if (quickFilter === "small" && !(item.ratios.includes("≤ 3:1") || item.ratios.includes("≤ 4:1"))) return false;
    if (quickFilter === "evening" && !item.timeTags.includes("晚间")) return false;
    if (quickFilter === "weekend" && !item.timeTags.includes("周末")) return false;
    if (quickFilter === "theme" && item.category !== "theme") return false;
    return true;
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
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{step === "done" ? "✓ 需求已发布" : "发布需求"}</Text>
        {step === "done" ? <View style={styles.headSpacer} /> : (
          <Pressable accessibilityLabel="存草稿" onPress={() => void saveDraft()} style={styles.draftBtn}>
            <Text style={styles.draftText}>草稿</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.tabs}>
        <View style={[styles.tab, styles.tabActive]}><Text style={[styles.tabText, styles.tabTextActive]}>发布需求</Text></View>
        <Pressable accessibilityLabel="去创建活动" onPress={onCreateActivity} style={styles.tab}>
          <Text style={styles.tabText}>创建活动</Text>
        </Pressable>
      </View>
      {draftRestored && step !== "done" ? <Text style={styles.restoredHint}>已恢复上次草稿。</Text> : null}

      {step === "moment" ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle}>想约什么？</Text>
            <Text style={styles.heroSub}>左边找方向，右边直接选一个 Moment。</Text>
            <View style={styles.momentBadge}><Text style={styles.momentBadgeText}>Moment · 人与场景优先</Text></View>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput onChangeText={setQuery} placeholder="例如：4个人，周六晚上唱歌" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={query} />
            </View>
            <Pressable accessibilityLabel="按输入生成需求" disabled={query.trim() === ""} onPress={createCustom} style={[styles.generateBtn, query.trim() === "" && styles.disabled]}>
              <Text style={styles.generateText}>生成</Text>
            </Pressable>
          </View>
          {/* R58 单行 quick-filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilterRow}>
            {QUICK_FILTERS.map((filter) => (
              <Pressable key={filter.id} onPress={() => setQuickFilter(filter.id)} style={[styles.filterChip, quickFilter === filter.id && styles.filterChipOn]}>
                <Text style={[styles.filterText, quickFilter === filter.id && styles.filterTextOn]}>{filter.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {/* R58 双栏：左分类 rail + 右 Moment 卡片列表 */}
          <View style={styles.deliveryLayout}>
            <View style={styles.categoryRail}>
              {CATEGORIES.map((cat) => (
                <Pressable key={cat.id} onPress={() => setCategory(cat.id)} style={[styles.categoryBtn, category === cat.id && styles.categoryBtnOn]}>
                  <Text style={[styles.categoryBtnText, category === cat.id && styles.categoryBtnTextOn]}>{cat.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.catalogPane}>
              <View style={styles.catalogHead}>
                <Text style={styles.catalogTitle}>{CATEGORIES.find((cat) => cat.id === category)?.label ?? "热门"}</Text>
                <Text style={styles.catalogHint}>高频 Moment</Text>
              </View>
              {moments.map((item) => {
                const active = template?.id === item.id;
                const icon = actionIconFor(item.id);
                return (
                  <Pressable key={item.id} accessibilityLabel={`选择${item.title}`} onPress={() => pickTemplate(item)} style={[styles.catalogItem, active && styles.momentCardOn]}>
                    <View style={styles.momentEmoji}>
                      {icon !== undefined
                        ? <Image contentFit="contain" source={icon} style={styles.momentIcon} />
                        : <Text style={styles.momentEmojiText}>{item.emoji}</Text>}
                    </View>
                    <View style={styles.momentCopy}>
                      <Text style={styles.momentTitle}>{item.title}</Text>
                      <Text style={styles.momentDesc}>{item.venueLabel}</Text>
                      <View style={styles.catalogTags}>
                        {item.tags.map((tag) => <View key={tag} style={styles.catalogTag}><Text style={styles.catalogTagText}>{tag}</Text></View>)}
                      </View>
                    </View>
                    <View style={styles.catalogSide}>
                      <Text style={styles.catalogSideRatio}>{item.defaultRatio}</Text>
                      <Text style={styles.catalogSideTime}>{item.defaultTime || "时间自定"}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {moments.length === 0 ? <Text style={styles.empty}>没有匹配的 Moment，换个条件或点生成。</Text> : null}
            </View>
          </View>
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>当前需求</Text>
            <Text style={styles.currentValue}>{template ? `${template.title}${proService ? ` · ${PRO_SERVICES.find((item) => item.id === proService)?.title ?? ""}` : ""} · ${specs.ratio || template.defaultRatio}` : "先选一个"}</Text>
          </View>
          <Pressable disabled={!template} onPress={() => setStep("people")} style={[styles.primaryBtn, !template && styles.disabled]}>
            <Text style={styles.primaryBtnText}>下一步 · 选人 / 服务 / 价格</Text>
          </Pressable>
          {/* R58 城市协助 · Professional：服务目录默认展开（原型 pro-card 四类：
              现场翻译 / 签证协助 / 法律咨询 / 商务协助）。放在主 CTA 之下——
              既不遮「下一步」，也不用再点一次才看到 item（此前只在「规格」步
              按模板才出现，导致点了「城市协助」看不到任何条目）。 */}
          <View style={styles.professionalEntry}>
            <View style={styles.proIcon}>
              {proIcon !== undefined
                ? <Image contentFit="contain" source={proIcon} style={styles.proIconArt} />
                : <Text style={styles.proIconText}>证</Text>}
            </View>
            <View style={styles.proCopy}>
              <Text style={styles.proTitle}>城市协助 · Professional</Text>
              <Text style={styles.proDesc}>翻译 / 签证 / 法律 / 商务 · 专业认证优先</Text>
            </View>
            <Text style={styles.proLink}>专业认证 ›</Text>
          </View>
          <View style={styles.proGrid}>
            {PRO_SERVICES.map((service) => {
              const active = proService === service.id;
              return (
                <Pressable
                  accessibilityLabel={`选择${service.title}`}
                  key={service.id}
                  onPress={() => selectProService(service)}
                  style={[styles.proCard, active && styles.proCardOn]}
                >
                  <View style={styles.proCardHead}>
                    <Text style={styles.proCardTitle}>{service.title}</Text>
                    <View style={[styles.proCardCert, active && styles.proCardCertOn]}>
                      <Text style={[styles.proCardCertText, active && styles.proCardCertTextOn]}>{service.cert}</Text>
                    </View>
                  </View>
                  <Text style={styles.proCardSub}>{service.sub}</Text>
                  <View style={styles.proCardFoot}>
                    <Text style={styles.proCardPrice}>{service.price}</Text>
                    <Text style={styles.proCardRange}>{service.range}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : step === "people" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmEyebrow}>Moment · {template?.defaultRatio}</Text>
              <Text style={styles.confirmTitle}>{template?.title}</Text>
            </View>
            <Pressable onPress={() => setStep("moment")}><Text style={styles.linkText}>更换</Text></Pressable>
          </View>
          <View style={styles.filterHeadRow}>
            <Text style={styles.sectionTitle}>匹配条件</Text>
            <Pressable accessibilityLabel="打开筛选" onPress={() => setSheetOpen((open) => !open)} style={styles.sheetToggle}>
              <Text style={styles.sheetToggleText}>筛选{sheetActiveCount > 0 ? ` · ${sheetActiveCount}` : ""}</Text>
            </Pressable>
          </View>
          <View style={styles.filterRow}>
            {PEOPLE_FILTERS.map((filter) => (
              <Pressable key={filter} onPress={() => togglePeopleFilter(filter)} style={[styles.filterChip, peopleFilters.includes(filter) && styles.filterChipOn]}>
                <Text style={[styles.filterText, peopleFilters.includes(filter) && styles.filterTextOn]}>{filter}</Text>
              </Pressable>
            ))}
          </View>
          {sheetOpen ? (
            <View style={styles.sheet}>
              <Text style={styles.sheetLabel}>可用时间</Text>
              <View style={styles.filterRow}>
                {["不限", "今晚", "明天", "周末"].map((day) => (
                  <Pressable key={day} onPress={() => setSheetFilters((prev) => ({ ...prev, day }))} style={[styles.filterChip, sheetFilters.day === day && styles.filterChipOn]}>
                    <Text style={[styles.filterText, sheetFilters.day === day && styles.filterTextOn]}>{day}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sheetLabel}>语言</Text>
              <View style={styles.filterRow}>
                {["不限", "中文", "English", "越南语"].map((language) => (
                  <Pressable key={language} onPress={() => setSheetFilters((prev) => ({ ...prev, language }))} style={[styles.filterChip, sheetFilters.language === language && styles.filterChipOn]}>
                    <Text style={[styles.filterText, sheetFilters.language === language && styles.filterTextOn]}>{language}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sheetLabel}>认证</Text>
              <View style={styles.filterRow}>
                {[false, true].map((only) => (
                  <Pressable key={only ? "cert" : "all"} onPress={() => setSheetFilters((prev) => ({ ...prev, certifiedOnly: only }))} style={[styles.filterChip, sheetFilters.certifiedOnly === only && styles.filterChipOn]}>
                    <Text style={[styles.filterText, sheetFilters.certifiedOnly === only && styles.filterTextOn]}>{only ? "已认证" : "不限"}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sheetLabel}>预算</Text>
              <View style={styles.filterRow}>
                {[{ label: "不限", value: 0 }, { label: "≤ 200K", value: 200000 }, { label: "≤ 300K", value: 300000 }, { label: "≤ 500K", value: 500000 }].map((budget) => (
                  <Pressable key={budget.label} onPress={() => setSheetFilters((prev) => ({ ...prev, maxBudget: budget.value }))} style={[styles.filterChip, sheetFilters.maxBudget === budget.value && styles.filterChipOn]}>
                    <Text style={[styles.filterText, sheetFilters.maxBudget === budget.value && styles.filterTextOn]}>{budget.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.sheetActions}>
                <Pressable onPress={() => setSheetFilters(DEFAULT_PEOPLE_FILTERS)} style={styles.sheetReset}>
                  <Text style={styles.sheetResetText}>重置</Text>
                </Pressable>
                <Pressable onPress={() => setSheetOpen(false)} style={styles.sheetApply}>
                  <Text style={styles.sheetApplyText}>应用筛选</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <Text style={styles.sectionSub}>选人 · 可选，不选默认发布到市场</Text>
          {!supply ? <Text style={styles.empty}>供给目录不可用，直接发布到市场。</Text>
            : !peopleLoaded ? <Text style={styles.empty}>正在匹配…</Text>
            : visiblePeople.length === 0 ? <Text style={styles.empty}>当前筛选没有匹配的人，放宽条件或直接发布到市场。</Text>
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
                    <View style={styles.personAvatar}><Text style={styles.personAvatarText}>{person.name.trim().charAt(0) || "?"}</Text></View>
                  )}
                  <View style={styles.personCopy}>
                    <View style={styles.personNameRow}>
                      <Text style={styles.personName}>{person.name}</Text>
                      {person.eligibility.capabilitiesOk ? <Text style={styles.certBadge}>已认证</Text> : null}
                    </View>
                    <Text style={styles.personMeta}>{person.languages.length > 0 ? person.languages.join(" · ") : person.serviceType}</Text>
                    <Text style={styles.personMeta}>
                      {person.availability ? "有档期" : "档期待确认"} · {person.referencePrice > 0 ? `参考 ${Math.round(person.referencePrice / 1000)}K ${person.currency}` : "价格面议"}
                    </Text>
                  </View>
                  <Pressable accessibilityLabel={`选择${person.name}`} onPress={() => setSelectedPerson(active ? undefined : person)} style={[styles.selectBtn, active && styles.selectBtnOn]}>
                    <Text style={[styles.selectText, active && styles.selectTextOn]}>{active ? "已选择" : "选择 TA"}</Text>
                  </Pressable>
                </View>
              );
            })}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            <Pressable onPress={() => setStep("moment")} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable onPress={() => setStep("specs")} style={styles.primaryBtnFlex}><Text style={styles.primaryBtnText}>下一步 · 规格</Text></Pressable>
          </View>
        </>
      ) : step === "specs" ? (
        <>
          <View style={styles.confirmCard}>
            <View style={styles.confirmCopy}>
              <Text style={styles.confirmEyebrow}>Moment · {specs.ratio || template?.defaultRatio}</Text>
              <Text style={styles.confirmTitle}>{template?.title}</Text>
              {selectedPerson ? <Text style={styles.confirmSub}>意向人选：{selectedPerson.name}（发布仍为公开市场）</Text> : null}
            </View>
            <Pressable onPress={() => setStep("moment")}><Text style={styles.linkText}>更换</Text></Pressable>
          </View>
          <Text style={styles.sectionSub}>Moment 规格 · 默认已帮你填好</Text>
          <View style={styles.specSummary}>
            <Text style={styles.specSummaryText}>
              {specs.prefs.includes("公共场所见面") ? "公共场所见面" : "见面方式自定"} · {specs.duration || "时长自定"} · 现场消费双方自结
            </Text>
          </View>

          <Text style={styles.fieldLabel}>你们几人</Text>
          <View style={styles.chipRow}>
            {(template?.ratios ?? []).map((ratio) => (
              <Pressable key={ratio} onPress={() => setSpecs((prev) => ({ ...prev, ratio }))} style={[styles.chip, specs.ratio === ratio && styles.chipOn]}>
                <Text style={[styles.chipText, specs.ratio === ratio && styles.chipTextOn]}>{ratio}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>时间段</Text>
          <TextInput onChangeText={(time) => setSpecs((prev) => ({ ...prev, time }))} placeholder={template?.defaultTime} placeholderTextColor={color.muted} style={styles.input} value={specs.time} />

          <Text style={styles.fieldLabel}>时长</Text>
          <View style={styles.chipRow}>
            {DURATIONS.map((duration) => (
              <Pressable key={duration} onPress={() => setSpecs((prev) => ({ ...prev, duration }))} style={[styles.chip, specs.duration === duration && styles.chipOn]}>
                <Text style={[styles.chipText, specs.duration === duration && styles.chipTextOn]}>{duration}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>地点</Text>
          <TextInput onChangeText={(place) => setSpecs((prev) => ({ ...prev, place }))} placeholder={template?.venue} placeholderTextColor={color.muted} style={styles.input} value={specs.place} />

          <Text style={styles.fieldLabel}>场景偏好 · 影响匹配 / 报价</Text>
          <View style={styles.chipRow}>
            {PREF_OPTIONS.map((pref) => (
              <Pressable key={pref} onPress={() => togglePref(pref)} style={[styles.chip, specs.prefs.includes(pref) && styles.chipOn]}>
                <Text style={[styles.chipText, specs.prefs.includes(pref) && styles.chipTextOn]}>{pref}</Text>
              </Pressable>
            ))}
          </View>

          {template?.id === "pro" ? (
            <>
              {/* R58 城市协助服务目录（原型 pro-card 四类：现场翻译 / 签证协助 /
                  法律咨询 / 商务协助）。放在「规格」步按模板展开，不再挤在
                  选 Moment 那一步挡「下一步」。 */}
              <Text style={styles.fieldLabel}>专业服务 · 城市协助</Text>
              <View style={styles.proGrid}>
                {PRO_SERVICES.map((service) => {
                  const active = proService === service.id;
                  return (
                    <Pressable
                      accessibilityLabel={`选择${service.title}`}
                      key={service.id}
                      onPress={() => selectProService(service)}
                      style={[styles.proCard, active && styles.proCardOn]}
                    >
                      <View style={styles.proCardHead}>
                        <Text style={styles.proCardTitle}>{service.title}</Text>
                        <View style={[styles.proCardCert, active && styles.proCardCertOn]}>
                          <Text style={[styles.proCardCertText, active && styles.proCardCertTextOn]}>{service.cert}</Text>
                        </View>
                      </View>
                      <Text style={styles.proCardSub}>{service.sub}</Text>
                      <View style={styles.proCardFoot}>
                        <Text style={styles.proCardPrice}>{service.price}</Text>
                        <Text style={styles.proCardRange}>{service.range}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {proService ? <Text style={styles.hint}>{PRO_SERVICES.find((item) => item.id === proService)?.note ?? ""}</Text> : null}
            </>
          ) : null}

          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabelNoGap}>预计服务价</Text>
            <Text style={styles.dynamicBadge}>动态</Text>
          </View>
          <View style={styles.priceMain}>
            <TextInput keyboardType="numbers-and-punctuation" onChangeText={(price) => setSpecs((prev) => ({ ...prev, price }))} placeholder={template?.defaultPrice} placeholderTextColor={color.muted} style={[styles.input, styles.priceInput]} value={specs.price} />
            <Pressable accessibilityLabel={negotiable ? "取消可协商" : "标记可协商"} onPress={() => setNegotiable((current) => !current)} style={[styles.negoBtn, negotiable && styles.negoBtnOn]}>
              <Text style={[styles.negoBtnText, negotiable && styles.negoBtnTextOn]}>{negotiable ? "✓ 可协商" : "可协商"}</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>参考 {template?.priceRef} · 可协商；现场消费不包含在内。</Text>
          <Text style={styles.hint}>ⓘ 价格由场景基础价、时间、人数和额外偏好组成；偏好只用于匹配，不按行为收费。服务参考价；餐饮、咖啡、KTV、门票等现场消费不包含在内。</Text>

          <Text style={styles.fieldLabel}>备注 · 可选</Text>
          <TextInput maxLength={500} multiline onChangeText={(notes) => setSpecs((prev) => ({ ...prev, notes }))} placeholder="补充说明（随订单展示）" placeholderTextColor={color.muted} style={[styles.input, styles.notesInput]} value={specs.notes} />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.doneRow}>
            <Pressable onPress={() => setStep("people")} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>上一步</Text></Pressable>
            <Pressable disabled={publishing || !template} onPress={() => void publish()} style={[styles.primaryBtnFlex, (publishing || !template) && styles.disabled]}>
              <Text style={styles.primaryBtnText}>{publishing ? "发布中…" : "发布到市场"}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.doneSub}>你的需求已经进入市场。</Text>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryEyebrow}>Opportunity</Text>
            <Text style={styles.summaryTitle}>{result?.title ?? template?.title}</Text>
            <SummaryRow label="对象" value="公开市场" />
            <SummaryRow label="客户方" value={specs.ratio === "1:1" ? "1 人 · 1:1" : (specs.ratio || (template?.defaultRatio ?? ""))} />
            <SummaryRow label="标准" value={`${specs.time} · ${specs.duration}`} />
            <SummaryRow label="价格" value={negotiable ? `${specs.price} · 可协商` : specs.price} last={!showNotes && !showPerson} />
            {showNotes ? <SummaryRow label="备注" value={specs.notes.trim()} last={!showPerson} /> : null}
            {showPerson ? <SummaryRow label="意向人选" value={selectedPerson.name} last /> : null}
          </View>
          <View style={styles.doneRow}>
            <Pressable onPress={restart} style={styles.secondaryBtn}><Text style={styles.secondaryBtnText}>再发一个</Text></Pressable>
            <Pressable onPress={onViewMarket} style={styles.primaryBtnFlex}><Text style={styles.primaryBtnText}>查看市场</Text></Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }): React.JSX.Element {  return (
    <View style={[styles.summaryRow, last && styles.summaryRowLast]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32, paddingHorizontal: 16, paddingTop: 8 },
  head: { alignItems: "center", flexDirection: "row", marginBottom: 8 },
  backBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  backText: { color: color.ink, fontSize: 24, fontWeight: "800", lineHeight: 28 },
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
  deliveryLayout: { backgroundColor: color.white, borderColor: color.line, borderRadius: 22, borderWidth: 1, flexDirection: "row", marginTop: 14, minHeight: 320, overflow: "hidden" },
  categoryRail: { backgroundColor: "#F4F1EC", borderRightColor: color.line, borderRightWidth: 1, width: 66 },
  categoryBtn: { alignItems: "center", justifyContent: "center", minHeight: 56, paddingHorizontal: 4 },
  categoryBtnOn: { backgroundColor: color.white },
  categoryBtnText: { color: "#8A837B", fontSize: 12, fontWeight: "700", textAlign: "center" },
  categoryBtnTextOn: { color: color.ink, fontWeight: "900" },
  catalogPane: { flex: 1, paddingHorizontal: 12, paddingTop: 10 },
  catalogHead: { flexDirection: "row", alignItems: "baseline", gap: 7, marginBottom: 2 },
  catalogTitle: { color: color.ink, fontSize: 15, fontWeight: "900" },
  catalogHint: { color: color.muted, fontSize: 11 },
  catalogItem: { alignItems: "center", borderBottomColor: color.line, borderBottomWidth: 1, flexDirection: "row", gap: 11, paddingVertical: 11 },
  catalogTags: { flexDirection: "row", gap: 5, marginTop: 4, flexWrap: "wrap" },
  catalogTag: { backgroundColor: "#F5F2EE", borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
  catalogTagText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  catalogSide: { alignItems: "flex-end", gap: 3 },
  catalogSideRatio: { color: color.ink, fontSize: 13, fontWeight: "900" },
  catalogSideTime: { color: color.muted, fontSize: 11 },
  momentEmoji: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  momentIcon: { height: 26, tintColor: color.ink, width: 26 },
  // R58 城市协助 · Professional 服务卡（对齐原型 pro-card）
  proIconArt: { height: 22, tintColor: color.ink, width: 22 },
  proGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  proCard: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: 5, padding: 12 },
  proCardOn: { borderColor: color.ink, borderWidth: 2 },
  proCardHead: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "space-between" },
  proCardTitle: { color: color.ink, fontSize: 14, fontWeight: "800" },
  proCardCert: { backgroundColor: color.surface, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  proCardCertOn: { backgroundColor: color.ink },
  proCardCertText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  proCardCertTextOn: { color: color.white },
  proCardSub: { color: color.muted, fontSize: 11 },
  proCardFoot: { alignItems: "baseline", flexDirection: "row", gap: 6 },
  proCardPrice: { color: color.ink, fontSize: 15, fontWeight: "900" },
  proCardRange: { color: color.muted, fontSize: 11 },
  momentEmojiText: { color: color.ink, fontSize: 20, fontWeight: "800" },
  momentCopy: { flex: 1 },
  momentTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  momentDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  momentCardOn: { borderColor: color.violet, borderWidth: 2 },
  empty: { color: color.muted, fontSize: 12, marginVertical: 12, textAlign: "center" },
  // R58 城市协助 · Professional 次入口。
  professionalEntry: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 9, marginTop: 11, padding: 11 },
  proIcon: { alignItems: "center", backgroundColor: "#F3EEE7", borderRadius: 10, height: 35, justifyContent: "center", width: 35 },
  proIconText: { color: "#8A6D2F", fontSize: 17, fontWeight: "900" },
  proCopy: { flex: 1 },
  proTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  proDesc: { color: color.muted, fontSize: 11, marginTop: 2 },
  proLink: { color: color.violet, fontSize: 12, fontWeight: "800" },
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
  hint: { color: color.muted, fontSize: 11, marginTop: 6 },
  error: { color: color.error, fontSize: 12, marginTop: 12, textAlign: "center" },
  primaryBtn: { alignItems: "center", backgroundColor: color.magenta, borderRadius: 14, marginTop: 18, minHeight: 50, justifyContent: "center" },
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
