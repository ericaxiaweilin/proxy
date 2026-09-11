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
  MOMENT_TEMPLATES,
  type DemandSpecs,
  type MomentTemplate,
  type PeopleSheetFilters
} from "../demand-moments";
import { resolveAssetSource } from "../media/asset-sources";
import { CircularAvatarImage } from "../components/circular-avatar-image";
import { localApiBaseUrl } from "../native-clients";

type Step = "moment" | "people" | "specs" | "done";

const RATIO_FILTERS = ["全部", "1:1", "≤ 3:1", "≤ 4:1"];
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
  const [template, setTemplate] = useState<MomentTemplate | undefined>(undefined);
  const [specs, setSpecs] = useState<DemandSpecs>(() => defaultSpecsFor(MOMENT_TEMPLATES[0]!));
  const [query, setQuery] = useState("");
  const [ratioFilter, setRatioFilter] = useState("全部");
  const [timeFilter, setTimeFilter] = useState("全部");
  const [peopleFilters, setPeopleFilters] = useState<string[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetFilters, setSheetFilters] = useState<PeopleSheetFilters>(DEFAULT_PEOPLE_FILTERS);
  const [people, setPeople] = useState<SupplierCandidate[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SupplierCandidate>();
  const [publishing, setPublishing] = useState(false);
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
    if (ratioFilter !== "全部" && !item.ratios.includes(ratioFilter)) return false;
    if (timeFilter !== "全部" && !item.timeTags.includes(timeFilter)) return false;
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
      defaultPrice: ""
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
          <Text style={styles.sectionTitle}>想约什么？左边找方向，右边直接选一个 Moment。</Text>
          <Text style={styles.sectionSub}>Moment · 人与场景优先</Text>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput onChangeText={setQuery} placeholder="搜 Moment…" placeholderTextColor="#A9A2B0" style={styles.searchInput} value={query} />
            </View>
            <Pressable accessibilityLabel="按输入生成需求" disabled={query.trim() === ""} onPress={createCustom} style={[styles.generateBtn, query.trim() === "" && styles.disabled]}>
              <Text style={styles.generateText}>生成</Text>
            </Pressable>
          </View>
          <View style={styles.filterRow}>
            {RATIO_FILTERS.map((ratio) => (
              <Pressable key={ratio} onPress={() => setRatioFilter(ratio)} style={[styles.filterChip, ratioFilter === ratio && styles.filterChipOn]}>
                <Text style={[styles.filterText, ratioFilter === ratio && styles.filterTextOn]}>{ratio}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.filterRow}>
            {TIME_FILTERS.map((time) => (
              <Pressable key={time} onPress={() => setTimeFilter(time)} style={[styles.filterChip, timeFilter === time && styles.filterChipOn]}>
                <Text style={[styles.filterText, timeFilter === time && styles.filterTextOn]}>{time}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionSub}>高频 Moment</Text>
          {moments.map((item) => {
            const active = template?.id === item.id;
            return (
              <Pressable key={item.id} accessibilityLabel={`选择${item.title}`} onPress={() => pickTemplate(item)} style={[styles.momentCard, active && styles.momentCardOn]}>
                <View style={styles.momentEmoji}><Text style={styles.momentEmojiText}>{item.emoji}</Text></View>
                <View style={styles.momentCopy}>
                  <Text style={styles.momentTitle}>{item.title}</Text>
                  <Text style={styles.momentDesc}>{item.venueLabel}</Text>
                  <Text style={styles.momentMeta}>{item.defaultRatio} · {item.defaultTime || "时间自定"} · 参考 {item.priceRef}</Text>
                </View>
              </Pressable>
            );
          })}
          {moments.length === 0 ? <Text style={styles.empty}>没有匹配的 Moment，换个条件或点生成。</Text> : null}
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>当前需求</Text>
            <Text style={styles.currentValue}>{template ? `${template.title} · ${specs.ratio || template.defaultRatio}` : "先选一个"}</Text>
          </View>
          <Pressable disabled={!template} onPress={() => setStep("people")} style={[styles.primaryBtn, !template && styles.disabled]}>
            <Text style={styles.primaryBtnText}>下一步 · 选人 / 服务 / 价格</Text>
          </Pressable>
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

          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabelNoGap}>预计服务价</Text>
            <Text style={styles.dynamicBadge}>动态</Text>
          </View>
          <TextInput keyboardType="numbers-and-punctuation" onChangeText={(price) => setSpecs((prev) => ({ ...prev, price }))} placeholder={template?.defaultPrice} placeholderTextColor={color.muted} style={styles.input} value={specs.price} />
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
            <SummaryRow label="价格" value={`${specs.price} · 可协商`} last={!showNotes && !showPerson} />
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
  sectionTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  sectionSub: { color: color.muted, fontSize: 12, marginBottom: 10, marginTop: 4 },
  searchRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 8 },
  searchBox: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 12, borderWidth: 1, flexDirection: "row", flex: 1, gap: 6, paddingHorizontal: 12 },
  searchIcon: { color: color.muted, fontSize: 15 },
  searchInput: { color: color.ink, flex: 1, fontSize: 14, paddingVertical: 10 },
  generateBtn: { alignItems: "center", backgroundColor: color.ink, borderRadius: 12, justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10 },
  generateText: { color: color.white, fontSize: 13, fontWeight: "800" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  filterChip: { backgroundColor: color.surface, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  filterText: { color: color.muted, fontSize: 12, fontWeight: "700" },
  filterTextOn: { color: color.white },
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
  momentCardOn: { borderColor: color.violet, borderWidth: 2 },
  momentEmoji: { alignItems: "center", backgroundColor: color.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  momentEmojiText: { color: color.ink, fontSize: 20, fontWeight: "800" },
  momentCopy: { flex: 1 },
  momentTitle: { color: color.ink, fontSize: 16, fontWeight: "800" },
  momentDesc: { color: color.muted, fontSize: 12, marginTop: 2 },
  momentMeta: { color: color.violet, fontSize: 11, fontWeight: "700", marginTop: 4 },
  empty: { color: color.muted, fontSize: 12, marginVertical: 12, textAlign: "center" },
  currentCard: { backgroundColor: color.surface, borderRadius: 14, marginTop: 4, padding: 12 },
  currentLabel: { color: color.muted, fontSize: 11, fontWeight: "700" },
  currentValue: { color: color.ink, fontSize: 14, fontWeight: "800", marginTop: 2 },
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
