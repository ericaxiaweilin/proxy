// ActivityWizard — ACTIVITY-CREATE-FORM-001 十块渐进式创建表单。
//
// 原型 deepseek_html_20260928_34cc3e 全量移植（分类→名称→人数→日期→时间→
// 时长→地点→报名→费用→说明 + 进度条 + 场景列表/地图双选 + 成功页），
// 发布走 activities.publish（与旧向导同通道），规格映射沿用
// activity-moments.buildActivityPublishInput。
//
// 道具接口：全页地图显隐经 onMapPickOpenChange 上报壳级状态（market 只透传一行）。
//
// 相对原型的四处偏离（诚实/数据原因）：
// 1. 发布门禁多卡 placeId：无 sceneId 的活动在场景页不可见，放行等于造
//    不可见数据（Three Beans 教训）；
// 2. 成功页不写推送到达类承诺（推送行为未知），用市场同款"已进入市场"文案；
// 3. 人数双滑杆用 PanResponder 自绘双拇指实现（RN 无 range input；
//    钳制、标签、刻度、pills 与原型同口径）；
// 4. 地图不自绘：全页直接复用 home 的 RealitySceneMapSurface，选中回调
//    以可选 props 注入（不改首页行为）；目录 id 同源，选中即落定。
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { useI18n, type MessageKey } from "../i18n";
import { color } from "../theme";
import { buildActivityPublishInput } from "../activity-moments";
import { localApiBaseUrl, sessionAuthClient } from "../native-clients";
import { getCurrentFix } from "../device-location";
import { expoLocationApi } from "../device-location-native";
import { sceneDistanceMeters, shopCardDistance, type SceneOrigin } from "../scene-shop-directory";
import { ProxyBackGlyph } from "../components/proxy-foundation";
import { ProxyIcon } from "../components/proxy-icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RealitySceneMapSurface } from "./reality-scene-map";
import {
  CREATE_CATEGORIES,
  FORM_PROGRESS_TOTAL,
  PEOPLE_MAX,
  PEOPLE_MIN,
  addDaysISO,
  canPublishForm,
  capacityOfRange,
  composeActivityTime,
  dayOfMonthISO,
  decodeDraft,
  defaultCreateForm,
  encodeDraft,
  formProgress,
  isTimeAvailable,
  loadSceneSpots,
  nextAvailableTime,
  peopleRangeLabel,
  todayLocalISO,
  venueTypeForCategory,
  venueTypeForSpotType,
  type CreateCategoryId,
  type CreateDuration,
  type CreateFeeId,
  type CreateFormState,
  type CreateSignupId,
  type SceneSpot,
} from "../activity-create-form";

const DRAFT_KEY = "proxy.activityCreate.v1";
const DAYS_AHEAD = 14;

const CAT_COPY: Record<CreateCategoryId, { name: MessageKey; example: MessageKey }> = {
  cafe: { name: "catCafe", example: "createExCafe" },
  food: { name: "catFood", example: "createExFood" },
  drink: { name: "catDrink", example: "createExDrink" },
  sport: { name: "catSport", example: "createExSport" },
  walk: { name: "catWalk", example: "createExWalk" },
  art: { name: "catArt", example: "createExArt" },
  photo: { name: "catPhoto", example: "createExPhoto" },
  music: { name: "catMusic", example: "createExMusic" },
};

const WEEKDAY_LOCALE: Record<string, string> = { zh: "zh-CN", vi: "vi", en: "en", lo: "lo", ko: "ko", ja: "ja" };

const PEOPLE_PRESETS: ReadonlyArray<{ min: number; max: number }> = [
  { min: 2, max: 4 },
  { min: 4, max: 6 },
  { min: 6, max: 10 },
  { min: 10, max: 20 },
  { min: 20, max: 50 },
];

const DURATIONS: ReadonlyArray<{ value: CreateDuration; label: MessageKey }> = [
  { value: 60, label: "dur1h" },
  { value: 120, label: "dur2h" },
  { value: 240, label: "dur4h" },
  { value: "all", label: "durAllDay" },
];

const SIGNUPS: ReadonlyArray<{ value: CreateSignupId; label: MessageKey }> = [
  { value: "OPEN", label: "signupOpen" },
  { value: "REVIEW", label: "signupReview" },
  { value: "INVITE_ONLY", label: "signupInvite" },
];

const FEES: ReadonlyArray<{ value: CreateFeeId; label: MessageKey }> = [
  { value: "FREE", label: "feeFree" },
  { value: "AA", label: "feeAA" },
  { value: "CUSTOM", label: "feeCustom" },
];

export function ActivityWizard({ activities, scenes, onBack, onPublished, onMapPickOpenChange }: {
  activities: ActivityClient;
  scenes: Activity[];
  onBack: () => void;
  onPublished: (activity: Activity) => void;
  onViewActivities: () => void;
  onOpenDemand: () => void;
  onReloadScenes: () => void;
  onMapPickOpenChange?: ((open: boolean) => void) | undefined;
}): React.JSX.Element {
  const { t, lang } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const today = useMemo(() => todayLocalISO(), []);
  const [form, setForm] = useState<CreateFormState>(() => defaultCreateForm(today));
  const [spots, setSpots] = useState<SceneSpot[]>([]);
  const [spotsState, setSpotsState] = useState<"loading" | "ready" | "failed">("loading");
  const [origin, setOrigin] = useState<SceneOrigin | undefined>(undefined);
  const [sheet, setSheet] = useState<"list" | "map" | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [listFilter, setListFilter] = useState<string>("all");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [draftMsg, setDraftMsg] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<Activity | undefined>(undefined);
  const [resultMeta, setResultMeta] = useState("");
  const restoredRef = useRef(false);

  // 目录 + 草稿恢复 + 定位（各管各，失败互不挡）。
  useEffect(() => {
    let cancelled = false;
    void loadSceneSpots(fetch, localApiBaseUrl)
      .then((list) => { if (!cancelled) { setSpots(list); setSpotsState("ready"); } })
      .catch(() => { if (!cancelled) setSpotsState("failed"); });
    void SecureStore.getItemAsync(DRAFT_KEY)
      .then((raw) => {
        if (cancelled || restoredRef.current) return;
        restoredRef.current = true;
        const draft = decodeDraft(raw ?? undefined, todayLocalISO());
        if (draft) {
          setForm(draft);
          setDraftMsg(t("draftRestored"));
        }
      })
      .catch(() => undefined);
    void getCurrentFix(expoLocationApi).then((fix) => {
      if (!cancelled && fix) setOrigin({ latitude: fix.latitude, longitude: fix.longitude });
    });
    return () => { cancelled = true; };
  }, [t]);

  // 全页地图期间藏底栏（底栏只有一级模块有）：打开上报 true，关闭/卸载上报 false。
  // 未接线时保持原样。注意不能走 onChromeVisibilityChange —— market 滚动显隐的
  // “回顶部就显示”规则会把全页态翻回来，必须走壳级状态（跟 hotScenesOpen 同模式）。
  useEffect(() => {
    if (sheet !== "map") return undefined;
    onMapPickOpenChange?.(true);
    return () => { onMapPickOpenChange?.(false); };
  }, [sheet, onMapPickOpenChange]);

  function patch(next: Partial<CreateFormState>): void {
    setError(undefined);
    setDraftMsg(undefined);
    setForm((prev) => ({ ...prev, ...next }));
  }

  const selectedSpot = form.placeId !== undefined ? spots.find((s) => s.id === form.placeId) : undefined;
  const placeValid = selectedSpot !== undefined;
  const progress = formProgress({ ...form, placeId: form.placeName.trim() !== "" ? (form.placeId ?? "text") : undefined });
  const progressPct = Math.round((progress / FORM_PROGRESS_TOTAL) * 100);

  const cat = form.cat !== undefined ? CREATE_CATEGORIES.find((c) => c.id === form.cat) : undefined;
  const nameHint = cat ? t("createNameHint", { name: t(CAT_COPY[cat.id].name) }) : "";
  const namePlaceholder = cat ? `${t("createExamplePrefix")}${t(CAT_COPY[cat.id].example)}` : t("namePlaceholderDefault");

  // 日期 chips（今天/明天 + 系统星期名，无编造）。
  const dateChips = useMemo(() => {
    const locale = WEEKDAY_LOCALE[lang] ?? "zh-CN";
    return Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const iso = addDaysISO(today, i);
      const dt = new Date(`${iso}T12:00:00`);
      const weekday = dt.getDay();
      const label = i === 0 ? t("todayLabel") : i === 1 ? t("tomorrowLabel") : dt.toLocaleDateString(locale, { weekday: "long" });
      return { iso, label, day: dayOfMonthISO(iso), weekend: weekday === 0 || weekday === 6 };
    });
  }, [today, lang, t]);

  function pickDate(iso: string): void {
    let { hour, minute } = form;
    if (!isTimeAvailable(iso, hour, minute)) {
      const next = nextAvailableTime(iso);
      if (next) { hour = next.hour; minute = next.minute; }
    }
    patch({ dateISO: iso, hour, minute });
  }

  const timeChips = useMemo(() => {
    const out: Array<{ hour: number; minute: 0 | 30; label: string; available: boolean }> = [];
    for (let h = 8; h <= 22; h++) {
      for (const m of [0, 30] as const) {
        if (h === 22 && m === 30) continue;
        const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        out.push({ hour: h, minute: m, label, available: isTimeAvailable(form.dateISO, h, m) });
      }
    }
    return out;
  }, [form.dateISO]);

  const dayLabel = useMemo(() => {
    const found = dateChips.find((c) => c.iso === form.dateISO);
    return found ? found.label : form.dateISO;
  }, [dateChips, form.dateISO]);

  const peopleLabel = peopleRangeLabel(form.peopleMin, form.peopleMax);
  // 原型 peopleValue 大字口径："4 – 6" / "20 – 50+"（空格 + 上沿 50+）。
  const peopleDisplay = form.peopleMax >= PEOPLE_MAX
    ? `${form.peopleMin} – ${PEOPLE_MAX}+`
    : `${form.peopleMin} – ${form.peopleMax}`;

  // 双滑杆位置（原型 minPct/maxPct 同口径）。RN 无 range input，用 PanResponder
  // 自绘双拇指；手势中 form 变化即重建 responder，保证钳制边界读到最新值。
  const peopleMinPct = (form.peopleMin - PEOPLE_MIN) / (PEOPLE_MAX - PEOPLE_MIN);
  const peopleMaxPct = (form.peopleMax - PEOPLE_MIN) / (PEOPLE_MAX - PEOPLE_MIN);
  const [peopleTrackW, setPeopleTrackW] = useState(0);
  const peopleDrag = useRef<{ which: "min" | "max"; start: number; other: number } | null>(null);
  // 最近一次手势方向：terminationRequest 只有 event 没有 gestureState，靠它判断纵/横。
  const peopleDragDir = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  // 辅助技术微调（滑杆的键盘等价操作），钳制与拖动同口径。
  function nudgePeople(which: "min" | "max", delta: number): void {
    setError(undefined);
    setDraftMsg(undefined);
    if (which === "min") {
      const v = Math.max(Math.min(form.peopleMin + delta, form.peopleMax - 1), PEOPLE_MIN);
      setForm((prev) => ({ ...prev, peopleMin: v }));
    } else {
      const v = Math.min(Math.max(form.peopleMax + delta, form.peopleMin + 1), PEOPLE_MAX);
      setForm((prev) => ({ ...prev, peopleMax: v }));
    }
  }

  // 整条导轨可拖：落点离哪只拇指近就拖哪只（HTML 点击导轨跳最近拇指同语义），
  // 之后跟手走 dx。只认横向主导，纵向留给表单滚动；接管后不让外层 pager 抢走。
  const railResponder = useMemo(() => PanResponder.create({
    // 落指即接管：必须抢在外层 pager 原生滚动之前成为 responder，
    // 否则 pager 一旦滚起来就再也要不回来（observedScroll）。
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    // 方向感知的让位：纵向为主就交给表单滚动，横向自己留着（pager 要横向时拒绝）。
    onPanResponderTerminationRequest: () => {
      const d = peopleDragDir.current;
      return Math.abs(d.dy) > Math.abs(d.dx);
    },
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (e) => {
      peopleDragDir.current = { dx: 0, dy: 0 };
      if (peopleTrackW <= 0) return;
      setError(undefined);
      setDraftMsg(undefined);
      const unit = peopleTrackW / (PEOPLE_MAX - PEOPLE_MIN);
      const at = Math.round(PEOPLE_MIN + (e.nativeEvent.locationX ?? 0) / unit);
      const which = Math.abs(at - form.peopleMin) <= Math.abs(at - form.peopleMax) ? "min" : "max";
      if (which === "min") {
        // 原型 updateSlider：min 拇指最多顶到 max - 1。
        const v = Math.max(Math.min(at, form.peopleMax - 1), PEOPLE_MIN);
        peopleDrag.current = { which, start: v, other: form.peopleMax };
        setForm((prev) => ({ ...prev, peopleMin: v }));
      } else {
        // 原型 updateSlider：max 拇指最少到 min + 1。
        const v = Math.min(Math.max(at, form.peopleMin + 1), PEOPLE_MAX);
        peopleDrag.current = { which, start: v, other: form.peopleMin };
        setForm((prev) => ({ ...prev, peopleMax: v }));
      }
    },
    onPanResponderMove: (_, gesture) => {
      const drag = peopleDrag.current;
      if (!drag || peopleTrackW <= 0) return;
      peopleDragDir.current = { dx: gesture.dx, dy: gesture.dy };
      setError(undefined);
      setDraftMsg(undefined);
      const unit = peopleTrackW / (PEOPLE_MAX - PEOPLE_MIN);
      if (drag.which === "min") {
        const v = Math.max(Math.min(Math.round(drag.start + gesture.dx / unit), drag.other - 1), PEOPLE_MIN);
        setForm((prev) => ({ ...prev, peopleMin: v }));
      } else {
        const v = Math.min(Math.max(Math.round(drag.start + gesture.dx / unit), drag.other + 1), PEOPLE_MAX);
        setForm((prev) => ({ ...prev, peopleMax: v }));
      }
    },
    onPanResponderRelease: () => { peopleDrag.current = null; peopleDragDir.current = { dx: 0, dy: 0 }; },
    onPanResponderTerminate: () => { peopleDrag.current = null; peopleDragDir.current = { dx: 0, dy: 0 }; },
  }), [form.peopleMin, form.peopleMax, peopleTrackW]);

  // 地点筛选（搜索 + category 封闭三态，不过滤 active —— 目录是什么就列什么）。
  const spotFilterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of spots) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return counts;
  }, [spots]);
  const spotFilters = useMemo(() => {
    const base = [{ id: "all", label: t("filterAllType"), count: spots.length }];
    for (const [id, label] of [["商家", t("sceneCatMerchant")], ["景点", t("sceneCatSpot")], ["其他", t("sceneCatOther")]] as const) {
      base.push({ id, label, count: spotFilterCounts.get(id) ?? 0 });
    }
    return base;
  }, [spots, spotFilterCounts, t]);
  const filteredSpots = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return spots.filter((s) => {
      if (listFilter !== "all" && s.category !== listFilter) return false;
      if (q !== "" && !`${s.name} ${s.area} ${s.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [spots, listFilter, listQuery]);
  function pickSpot(spot: SceneSpot): void {
    patch({ placeId: spot.id, placeName: spot.name });
    setSheet(null);
  }

  function spotDistance(spot: SceneSpot): string {
    if (!origin) return "";
    return shopCardDistance(sceneDistanceMeters(origin, spot));
  }

  async function saveDraft(): Promise<void> {
    try {
      await SecureStore.setItemAsync(DRAFT_KEY, encodeDraft(form));
      setDraftMsg(t("draftSaved"));
    } catch {
      setError(t("postFailed"));
    }
  }

  async function publish(): Promise<void> {
    if (publishing) return;
    if (form.cat === undefined || form.name.trim() === "") {
      setError(t("needCatName"));
      return;
    }
    if (!placeValid || selectedSpot === undefined) {
      setError(t("needPlaceScene"));
      return;
    }
    const capacity = capacityOfRange(form.peopleMax);
    if (capacity < PEOPLE_MIN || capacity > PEOPLE_MAX) {
      setError(t("capacityRangeError"));
      return;
    }
    setPublishing(true);
    setError(undefined);
    try {
      const matched = scenes.find((a) => a.realitySceneId === selectedSpot.id);
      const venueType = (matched && matched.venueType !== "" ? matched.venueType : undefined)
        ?? venueTypeForSpotType(selectedSpot.type)
        ?? venueTypeForCategory(form.cat);
      const time = composeActivityTime(dayLabel, form.hour, form.minute, form.duration, t("allDayTime"), t("nextDayLabel"));
      const feeLabel = form.fee === "FREE" ? t("feeFree") : form.fee === "AA" ? t("feeAA") : t("feeCustom");
      const input = buildActivityPublishInput(
        {
          id: `create-${form.cat}`,
          emoji: cat?.emoji ?? "📅",
          title: form.name.trim(),
          meta: "",
          defaultTime: time,
          venueName: selectedSpot.name,
          venueIcon: cat?.emoji ?? "📅",
          venueType,
          defaultTheme: "",
          desc: form.note.trim(),
        },
        {
          capacity,
          time,
          venueName: selectedSpot.name,
          theme: "",
          signup: form.signup,
          fee: form.fee,
          customFee: form.customFee,
          notes: form.note,
        },
        selectedSpot.id,
      );
      const created = await activities.publish(input);
      await SecureStore.deleteItemAsync(DRAFT_KEY).catch(() => undefined);
      setResult(created);
      setResultMeta(`${dayLabel} ${form.hour.toString().padStart(2, "0")}:${form.minute.toString().padStart(2, "0")} · ${peopleLabel} ${t("peopleUnit")} · ${feeLabel}`);
      onPublished(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("postFailed"));
    } finally {
      setPublishing(false);
    }
  }

  // 地图选地点：全页直接复用 home 的 RealitySceneMapSurface（同目录 id，
  // 图钉确认键由 onPickScene 注入，不自绘半页地图）。包一层撑满的容器 ——
  // 嵌在 market ScrollView 里 flex:1 撑不开，用“屏高 − 顶部安全区”正好顶满
  //（多了会滚，少了留空边；选地点时 market 三处 content padding 已清零）。
  const mapPageMinHeight = Math.max(0, windowHeight - insets.top);
  if (sheet === "map") {
    return (
      <View style={[styles.mapPage, { minHeight: mapPageMinHeight }]}>
      <RealitySceneMapSurface
        apiBaseUrl={localApiBaseUrl}
        authClient={sessionAuthClient}
        flatMap
        {...(origin !== undefined ? { initialOrigin: origin } : {})}
        pickSceneLabel={t("confirmMapPick")}
        onBack={() => setSheet(null)}
        onPickScene={(sceneId) => {
          const spot = spots.find((s) => s.id === sceneId);
          // 同一目录一般不会 miss；万一版本错位回列表从目录选，不造不可见数据。
          if (spot) pickSpot(spot);
          else setSheet("list");
        }}
      />
      </View>
    );
  }

  if (result) {
    return (
      <View style={styles.success}>
        <View style={styles.successIcon}><Text selectable style={styles.successCheck}>✓</Text></View>
        <Text selectable style={styles.successTitle}>{t("publishedTitle")}</Text>
        <Text selectable style={styles.successSub}>{t("publishedSub")}</Text>
        <View style={styles.successCard}>
          <Text selectable style={styles.successEmoji}>{cat?.emoji ?? "📅"}</Text>
          <View style={styles.successBody}>
            <Text selectable style={styles.successName} numberOfLines={1}>{result.title}</Text>
            <Text selectable style={styles.successMeta} numberOfLines={1}>{resultMeta}</Text>
          </View>
        </View>
        <View style={styles.successBtns}>
          <Pressable accessibilityLabel={t("continueEditing")} onPress={() => setResult(undefined)} style={[styles.successBtn, styles.successGhost]}>
            <Text selectable style={styles.successBtnGhostText}>{t("continueEditing")}</Text>
          </Pressable>
          <Pressable accessibilityLabel={t("backHome")} onPress={onBack} style={[styles.successBtn, styles.successPrimary]}>
            <Text selectable style={styles.successBtnPrimaryText}>{t("backHome")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const nameActive = form.cat !== undefined;
  const restActive = nameActive && form.name.trim().length > 0;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <Pressable accessibilityLabel={t("backShort")} onPress={onBack} style={styles.backBtn}>
          <ProxyBackGlyph />
        </Pressable>
        <Text selectable style={styles.title}>{t("createNavTitle")}</Text>
        <Pressable accessibilityLabel={t("draftSave")} onPress={() => void saveDraft()} style={styles.draftBtn}>
          <Text selectable style={styles.draftText}>{t("draftSave")}</Text>
        </Pressable>
      </View>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>
      <Text selectable style={styles.heroSub}>{t("createSub")}</Text>

      {/* 1. 分类 */}
      <View style={[styles.block, styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createCat")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <View style={styles.catGrid}>
          {CREATE_CATEGORIES.map((c) => (
            <Pressable
              key={c.id}
              accessibilityLabel={t(CAT_COPY[c.id].name)}
              onPress={() => patch({ cat: c.id, name: "", placeId: form.placeId, placeName: form.placeName })}
              style={[styles.cat, form.cat === c.id && styles.catOn]}
            >
              <Text selectable style={styles.catEmoji}>{c.emoji}</Text>
              <Text selectable style={[styles.catName, form.cat === c.id && styles.catNameOn]}>{t(CAT_COPY[c.id].name)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 2. 名称 */}
      <View style={[styles.block, nameActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createName")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
          {nameHint !== "" ? <Text selectable style={styles.blockHint}>{nameHint}</Text> : null}
        </View>
        <TextInput
          accessibilityLabel={t("createName")}
          editable={nameActive}
          maxLength={24}
          onChangeText={(v) => patch({ name: v })}
          placeholder={namePlaceholder}
          placeholderTextColor={color.muted}
          style={styles.nameInput}
          value={form.name}
        />
        {cat !== undefined ? (
          <View style={styles.suggestRow}>
            {(() => {
              const label = t(CAT_COPY[cat.id].example);
              const value = label.replace(/^\S+[：:]\s*/, "");
              const on = form.name === value;
              return (
                <Pressable key={cat.id} onPress={() => patch({ name: value })} style={[styles.suggest, on && styles.suggestOn]}>
                  <Text selectable style={[styles.suggestText, on && styles.suggestTextOn]}>{label}</Text>
                </Pressable>
              );
            })()}
          </View>
        ) : null}
      </View>

      {/* 3. 人数 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createPeople")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
          <Text selectable style={styles.blockHint}>{t("tuneHint")}</Text>
        </View>
        <View style={styles.peopleDisplay}>
          <Text selectable style={styles.peopleValue}>{peopleDisplay}</Text>
          <Text selectable style={styles.peopleUnit}>{t("peopleUnit")}</Text>
        </View>
        {/* 原型双滑杆：导轨 + 填充 + 双拇指 + 刻度；下方 pills 快选与原型同值。 */}
        <View style={styles.sliderWrap}>
          <View style={styles.sliderInner} onLayout={(e) => setPeopleTrackW(e.nativeEvent.layout.width)} {...railResponder.panHandlers}>
            <View style={styles.sliderTrack} />
            <View style={[styles.sliderFill, { left: `${peopleMinPct * 100}%`, width: `${(peopleMaxPct - peopleMinPct) * 100}%` }]} />
            <View
              accessible
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              accessibilityLabel={t("peopleMin")}
              accessibilityRole="adjustable"
              accessibilityValue={{ max: PEOPLE_MAX, min: PEOPLE_MIN, now: form.peopleMin }}
              hitSlop={{ bottom: 12, left: 12, right: 12, top: 12 }}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "increment") nudgePeople("min", 1);
                else if (e.nativeEvent.actionName === "decrement") nudgePeople("min", -1);
              }}
              style={[styles.sliderThumb, { left: `${peopleMinPct * 100}%` }]}
            />
            <View
              accessible
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              accessibilityLabel={t("peopleMax")}
              accessibilityRole="adjustable"
              accessibilityValue={{ max: PEOPLE_MAX, min: PEOPLE_MIN, now: form.peopleMax }}
              hitSlop={{ bottom: 12, left: 12, right: 12, top: 12 }}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === "increment") nudgePeople("max", 1);
                else if (e.nativeEvent.actionName === "decrement") nudgePeople("max", -1);
              }}
              style={[styles.sliderThumb, { left: `${peopleMaxPct * 100}%` }]}
            />
          </View>
        </View>
        <View style={styles.sliderScale}>
          {["2", "10", "20", "30", "40", "50+"].map((mark) => (
            <Text key={mark} selectable style={styles.scaleText}>{mark}</Text>
          ))}
        </View>
        <View style={styles.pills}>
          {PEOPLE_PRESETS.map((p) => {
            const on = form.peopleMin === p.min && form.peopleMax === p.max;
            return (
              <Pressable key={`${p.min}-${p.max}`} onPress={() => patch({ peopleMin: p.min, peopleMax: p.max })} style={[styles.pill, on && styles.pillOn]}>
                <Text selectable style={[styles.pillText, on && styles.pillTextOn]}>{p.max >= PEOPLE_MAX ? `${p.min}+` : peopleRangeLabel(p.min, p.max)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 4. 日期 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createDate")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <ScrollView horizontal contentContainerStyle={styles.chipRail} showsHorizontalScrollIndicator={false}>
          {dateChips.map((d) => (
            <Pressable key={d.iso} onPress={() => pickDate(d.iso)} style={[styles.dateChip, form.dateISO === d.iso && styles.chipOn]}>
              <Text selectable style={[styles.dateWeek, form.dateISO === d.iso && styles.chipTextOn]}>{d.label}</Text>
              <Text selectable style={[styles.dateDay, form.dateISO === d.iso && styles.chipTextOn]}>{d.day}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* 5. 时间 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createTime")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <ScrollView horizontal contentContainerStyle={styles.chipRail} showsHorizontalScrollIndicator={false}>
          {timeChips.map((chip) => {
            const on = form.hour === chip.hour && form.minute === chip.minute;
            return (
              <Pressable
                key={chip.label}
                accessibilityLabel={chip.label}
                disabled={!chip.available}
                onPress={() => patch({ hour: chip.hour, minute: chip.minute })}
                style={[styles.timeChip, on && styles.chipOn, !chip.available && styles.chipDisabled]}
              >
                <Text selectable style={[styles.timeText, on && styles.chipTextOn]}>{chip.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 6. 时长 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createDuration")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <View style={styles.pills}>
          {DURATIONS.map((d) => (
            <Pressable key={String(d.value)} onPress={() => patch({ duration: d.value })} style={[styles.pill, form.duration === d.value && styles.pillOn]}>
              <Text selectable style={[styles.pillText, form.duration === d.value && styles.pillTextOn]}>{t(d.label)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 7. 地点 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createPlace")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <View style={styles.placeRow}>
          <TextInput
            accessibilityLabel={t("createPlace")}
            onChangeText={(v) => patch({ placeName: v, placeId: undefined })}
            onFocus={() => setSheet("list")}
            placeholder={t("placePlaceholder")}
            placeholderTextColor={color.muted}
            style={styles.placeInput}
            value={form.placeName}
          />
          <Pressable accessibilityLabel={t("mapPickTitle")} onPress={() => setSheet("map")} style={styles.mapBtn}>
            {/* MAP-FOOTPRINT-LOGO-001：跟首页场景地图入口同款原型「折叠地图」logo，
                裸图标不套矩形框（48 栅格原画显小一圈，取 32）。 */}
            <ProxyIcon color={color.ink} name="mapFold" size={32} />
          </Pressable>
        </View>
        {selectedSpot !== undefined ? (
          <View style={styles.pickedCard}>
            <Text selectable style={styles.pickedBadge}>{t("scenePickedBadge")}</Text>
            <View style={styles.pickedBody}>
              <Text selectable style={styles.pickedName} numberOfLines={1}>{selectedSpot.name}</Text>
              <Text selectable style={styles.pickedMeta} numberOfLines={1}>
                {[selectedSpot.type, selectedSpot.area, spotDistance(selectedSpot)].filter((x) => x !== "").join(" · ")}
              </Text>
            </View>
            <Pressable accessibilityLabel={t("changeScene")} onPress={() => setSheet("list")} style={styles.pickedChange}>
              <Text selectable style={styles.pickedChangeText}>{t("changeScene")}</Text>
            </Pressable>
          </View>
        ) : null}
        <Text selectable style={styles.hintRow}>{t("searchOrMap")}</Text>
      </View>

      {/* 8. 报名方式 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createSignup")}</Text>
        </View>
        <View style={styles.pills}>
          {SIGNUPS.map((s) => (
            <Pressable key={s.value} onPress={() => patch({ signup: s.value })} style={[styles.pill, form.signup === s.value && styles.pillOn]}>
              <Text selectable style={[styles.pillText, form.signup === s.value && styles.pillTextOn]}>{t(s.label)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 9. 费用 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createFee")}</Text>
        </View>
        <View style={styles.pills}>
          {FEES.map((f) => (
            <Pressable key={f.value} onPress={() => patch({ fee: f.value })} style={[styles.pill, form.fee === f.value && styles.pillOn]}>
              <Text selectable style={[styles.pillText, form.fee === f.value && styles.pillTextOn]}>{t(f.label)}</Text>
            </Pressable>
          ))}
        </View>
        {form.fee === "CUSTOM" ? (
          <TextInput
            accessibilityLabel={t("feeCustom")}
            onChangeText={(v) => patch({ customFee: v })}
            placeholder={t("customFeePlaceholder")}
            placeholderTextColor={color.muted}
            style={styles.textInput}
            value={form.customFee}
          />
        ) : null}
      </View>

      {/* 10. 说明 */}
      <View style={[styles.block, restActive && styles.blockActive]}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createNote")}</Text>
          <Text selectable style={styles.blockHint}>{t("optionalHint")}</Text>
        </View>
        <TextInput
          accessibilityLabel={t("createNote")}
          multiline
          numberOfLines={3}
          onChangeText={(v) => patch({ note: v })}
          placeholder={t("notePlaceholder")}
          placeholderTextColor={color.muted}
          style={styles.textArea}
          value={form.note}
        />
      </View>

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      {draftMsg && !error ? <Text selectable style={styles.draftMsg}>{draftMsg}</Text> : null}
      <Pressable
        accessibilityLabel={t("publishCta")}
        disabled={publishing || !canPublishForm(form) || !placeValid}
        onPress={() => void publish()}
        style={[styles.cta, (publishing || !canPublishForm(form) || !placeValid) && styles.ctaDisabled]}
      >
        <Text selectable style={styles.ctaText}>{publishing ? t("posting") : t("publishCta")}</Text>
      </Pressable>

      {/* 场景列表 sheet */}
      <Modal transparent animationType="fade" visible={sheet === "list"} onRequestClose={() => setSheet(null)}>
        <Pressable onPress={() => setSheet(null)} style={styles.sheetBackdrop}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetGrab} />
            <Text selectable style={styles.sheetTitle}>{t("pickSceneTitle")}</Text>
            <TextInput
              accessibilityLabel={t("searchScenePlaceholder")}
              onChangeText={setListQuery}
              placeholder={t("searchScenePlaceholder")}
              placeholderTextColor={color.muted}
              style={styles.sheetSearch}
              value={listQuery}
            />
            <ScrollView horizontal contentContainerStyle={styles.filterRow} showsHorizontalScrollIndicator={false}>
              {spotFilters.map((f) => (
                <Pressable key={f.id} onPress={() => setListFilter(f.id)} style={[styles.filterChip, listFilter === f.id && styles.filterChipOn]}>
                  <Text selectable style={[styles.filterText, listFilter === f.id && styles.filterTextOn]}>
                    {f.label} · {f.count}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
              {filteredSpots.length === 0 ? (
                <Text selectable style={styles.sheetEmpty}>{t("noSceneFound")}{"\n"}{t("noSceneFoundSub")}</Text>
              ) : (
                filteredSpots.map((s) => {
                  const dist = spotDistance(s);
                  const on = form.placeId === s.id;
                  return (
                    <Pressable key={s.id} onPress={() => pickSpot(s)} style={[styles.spotRow, on && styles.spotRowOn]}>
                      {s.imageUrl !== "" ? (
                        <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: s.imageUrl }} style={styles.spotImg} transition={0} />
                      ) : (
                        <View style={[styles.spotImg, styles.spotFallback]}>
                          <Text selectable style={styles.spotInitial}>{s.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={styles.spotBody}>
                        <Text selectable style={styles.spotName} numberOfLines={1}>{s.name}</Text>
                        <Text selectable style={styles.spotMeta} numberOfLines={1}>
                          {[s.type, s.area, dist].filter((x) => x !== "").join(" · ")}
                        </Text>
                      </View>
                      <View style={[styles.spotCheck, on && styles.spotCheckOn]}>
                        {on ? <Text selectable style={styles.spotCheckText}>✓</Text> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 40, paddingTop: 8 },
  head: { alignItems: "center", flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8 },
  backBtn: { alignItems: "center", height: 38, justifyContent: "center", width: 38 },
  title: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "800", textAlign: "center" },
  draftBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  draftText: { color: color.muted, fontSize: 13, fontWeight: "800" },
  progressBar: { backgroundColor: color.offWhite, borderRadius: 2, height: 3, marginHorizontal: 20, marginVertical: 12, overflow: "hidden" },
  progressFill: { backgroundColor: color.ink, borderRadius: 2, height: "100%" },
  // ACTIVITY-TYPE-001（2026-09-28）：全表按 R3 字体 Token 对齐 —— Number XL 28/900、
  // Body 14/500、Meta 12/500、Caption 11/600、Button 14/800；数字加 tabular-nums。
  // 两个例外：name/place 输入框用 16px（iOS 小于 16 自动 zoom）；sheetTitle 20/800
  // 跟仓里现有 sheet 同口径。
  heroSub: { color: color.muted, fontSize: 12, fontWeight: "500", marginBottom: 8, marginTop: 6, paddingHorizontal: 20 },
  block: { marginBottom: 24, opacity: 0.32, paddingHorizontal: 20 },
  blockActive: { opacity: 1 },
  blockLabel: { alignItems: "baseline", flexDirection: "row", gap: 6, marginBottom: 12 },
  blockName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  blockReq: { color: "#E85C7A", fontSize: 14, fontWeight: "800" },
  blockHint: { color: color.muted, fontSize: 11, fontWeight: "600", marginLeft: "auto" },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cat: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1.5, gap: 6, paddingBottom: 11, paddingTop: 13, width: "23%" },
  catOn: { backgroundColor: color.ink, borderColor: color.ink },
  catEmoji: { fontSize: 23 },
  catName: { color: color.ink, fontSize: 11, fontWeight: "600" },
  catNameOn: { color: color.white },
  nameInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1.5, color: color.ink, fontSize: 16, fontWeight: "800", height: 58, paddingHorizontal: 18 },
  suggestRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  suggest: { backgroundColor: color.white, borderColor: color.line, borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 13, paddingVertical: 8 },
  suggestOn: { backgroundColor: color.ink, borderColor: color.ink },
  suggestText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  suggestTextOn: { color: color.white },
  peopleDisplay: { alignItems: "baseline", flexDirection: "row", gap: 8, marginBottom: 12 },
  peopleValue: { color: color.ink, fontSize: 28, fontVariant: ["tabular-nums"], fontWeight: "900", letterSpacing: -0.5 },
  peopleUnit: { color: color.muted, fontSize: 12, fontWeight: "500" },
  sliderWrap: { marginBottom: 4, marginTop: 8, paddingHorizontal: 14 },
  sliderInner: { height: 44, justifyContent: "center" },
  sliderTrack: { backgroundColor: color.offWhite, borderRadius: 3, height: 6 },
  sliderFill: { backgroundColor: color.ink, borderRadius: 3, height: 6, marginTop: -3, position: "absolute", top: "50%" },
  sliderThumb: { backgroundColor: color.white, borderColor: color.ink, borderRadius: 14, borderWidth: 2, height: 28, marginLeft: -14, marginTop: -14, position: "absolute", top: "50%", width: 28 },
  sliderScale: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16, paddingHorizontal: 14 },
  scaleText: { color: color.muted, fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { backgroundColor: color.white, borderColor: color.line, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 9 },
  pillOn: { backgroundColor: color.ink, borderColor: color.ink },
  pillText: { color: color.ink, fontSize: 14, fontWeight: "800" },
  pillTextOn: { color: color.white },
  chipRail: { gap: 8, paddingRight: 20 },
  dateChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 15, borderWidth: 1.5, gap: 3, paddingBottom: 9, paddingTop: 11, width: 58 },
  dateWeek: { color: color.muted, fontSize: 11, fontWeight: "600" },
  dateDay: { color: color.ink, fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "900" },
  dateWeekend: {},
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipTextOn: { color: color.white },
  timeChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 13, borderWidth: 1.5, minWidth: 66, paddingHorizontal: 14, paddingVertical: 11 },
  timeText: { color: color.ink, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "800", textAlign: "center" },
  chipDisabled: { opacity: 0.28 },
  placeRow: { flexDirection: "row", gap: 8 },
  // 输入框 16px：iOS 小于 16 聚焦自动 zoom，这里是功能性例外（R3 无 16 token）。
  placeInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1.5, color: color.ink, flex: 1, fontSize: 16, fontWeight: "800", height: 56, paddingHorizontal: 16 },
  mapBtn: { alignItems: "center", height: 56, justifyContent: "center", width: 48 },
  mapPage: { flex: 1 },
  pickedCard: { alignItems: "center", borderColor: "#2E9B58", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 12, marginTop: 12, padding: 12 },
  pickedBadge: { backgroundColor: "#E8F4EA", borderRadius: 4, color: "#1E6E3E", fontSize: 9.5, fontWeight: "900", paddingHorizontal: 7, paddingVertical: 2 },
  pickedBody: { flex: 1 },
  pickedName: { color: color.ink, fontSize: 14, fontWeight: "800" },
  pickedMeta: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 3 },
  pickedChange: { backgroundColor: color.offWhite, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  pickedChangeText: { color: color.ink, fontSize: 11, fontWeight: "600" },
  hintRow: { color: color.muted, fontSize: 11, fontWeight: "600", marginTop: 10 },
  textInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, color: color.ink, fontSize: 14, fontWeight: "500", marginTop: 10, paddingHorizontal: 16, paddingVertical: 13 },
  textArea: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1.5, color: color.ink, fontSize: 14, fontWeight: "500", lineHeight: 20, minHeight: 70, paddingHorizontal: 16, paddingVertical: 13, textAlignVertical: "top" },
  error: { color: "#E85C7A", fontSize: 12, fontWeight: "500", marginBottom: 8, paddingHorizontal: 20, textAlign: "center" },
  draftMsg: { color: color.muted, fontSize: 12, fontWeight: "500", marginBottom: 8, paddingHorizontal: 20, textAlign: "center" },
  cta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, justifyContent: "center", marginHorizontal: 20, minHeight: 54, paddingVertical: 15 },
  ctaDisabled: { backgroundColor: "#D6D2C8" },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "800" },
  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.32)", bottom: 0, justifyContent: "flex-end", left: 0, position: "absolute", right: 0, top: 0, zIndex: 50 },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, bottom: 0, left: 0, maxHeight: "85%", padding: 18, paddingBottom: 32, position: "absolute", right: 0 },
  sheetGrab: { alignSelf: "center", backgroundColor: "#DDD", borderRadius: 4, height: 4, marginBottom: 14, width: 42 },
  sheetTitle: { color: color.ink, fontSize: 20, fontWeight: "800", marginBottom: 12 },
  sheetSearch: { backgroundColor: color.offWhite, borderRadius: 12, color: color.ink, fontSize: 14, fontWeight: "500", height: 44, marginBottom: 10, paddingHorizontal: 14 },
  filterRow: { gap: 6, marginBottom: 10, paddingRight: 8 },
  filterChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  filterChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  // 筛选 chips 跟仓里现有 chip 同口径（13/600）。
  filterText: { color: color.muted, fontSize: 13, fontWeight: "600" },
  filterTextOn: { color: color.white },
  sheetList: { maxHeight: 320 },
  sheetEmpty: { color: color.muted, fontSize: 13, fontWeight: "700", lineHeight: 20, paddingVertical: 32, textAlign: "center" },
  spotRow: { alignItems: "center", borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 8, padding: 12 },
  spotRowOn: { backgroundColor: color.offWhite, borderColor: color.ink },
  spotImg: { borderRadius: 12, height: 52, width: 52 },
  spotFallback: { alignItems: "center", backgroundColor: color.offWhite, justifyContent: "center" },
  spotInitial: { color: color.muted, fontSize: 20, fontWeight: "900" },
  spotBody: { flex: 1 },
  spotName: { color: color.ink, fontSize: 14, fontWeight: "900" },
  spotMeta: { color: color.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  spotCheck: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 11, borderWidth: 1.5, height: 22, justifyContent: "center", width: 22 },
  spotCheckOn: { backgroundColor: color.ink, borderColor: color.ink },
  spotCheckText: { color: color.white, fontSize: 11, fontWeight: "900" },
  success: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  successIcon: { alignItems: "center", backgroundColor: "#E8F4EA", borderRadius: 44, height: 88, justifyContent: "center", marginBottom: 24, width: 88 },
  successCheck: { color: "#2E9B58", fontSize: 44, fontWeight: "900" },
  successTitle: { color: color.ink, fontSize: 24, fontWeight: "900", marginBottom: 10 },
  successSub: { color: color.muted, fontSize: 13.5, fontWeight: "700", lineHeight: 20, marginBottom: 8, textAlign: "center" },
  successCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 24, padding: 14, width: "100%" },
  successEmoji: { fontSize: 22 },
  successBody: { flex: 1 },
  successName: { color: color.ink, fontSize: 14, fontWeight: "900", marginBottom: 3 },
  successMeta: { color: color.muted, fontSize: 11.5, fontWeight: "700" },
  successBtns: { flexDirection: "row", gap: 10, marginTop: 24, width: "100%" },
  successBtn: { alignItems: "center", borderRadius: 14, flex: 1, justifyContent: "center", minHeight: 52 },
  successGhost: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1.5 },
  successBtnGhostText: { color: color.ink, fontSize: 14.5, fontWeight: "900" },
  successPrimary: { backgroundColor: color.ink },
  successBtnPrimaryText: { color: color.white, fontSize: 14.5, fontWeight: "900" },
});
