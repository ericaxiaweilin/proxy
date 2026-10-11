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
// 3. 人数：四档快选（2–5 / 6–10 / 11–30 / 31–80，不再有会和横滑切页抢手势的滑杆）；原先的双滑杆用 PanResponder 自绘双拇指实现（RN 无 range input；
//    钳制、标签、刻度、pills 与原型同口径）；
// 4. 地图不自绘：全页直接复用 home 的 RealitySceneMapSurface，选中回调
//    以可选 props 注入（不改首页行为）；目录 id 同源，选中即落定。
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";
import type { ActivityClient } from "../activity-client";
import type { Activity } from "@proxy/contracts";
import { useI18n, type MessageKey } from "../i18n";
import { color } from "../theme";
import { buildActivityPublishInput } from "../activity-moments";
import * as ImagePicker from "expo-image-picker";
import { MediaClient } from "../media-client";
import { activityCoverUri, mediaThumbUrl } from "../media-thumb-url";
import { localApiBaseUrl, nativeSecureSessionStore, sessionAuthClient } from "../native-clients";
import { getCurrentFix } from "../device-location";
import { WeatherAdviceBanner } from "../components/weather-chip";
import { expoLocationApi } from "../device-location-native";
import { sceneDistanceMeters, shopCardDistance, type SceneOrigin } from "../scene-shop-directory";
import { ProxyBackGlyph, ProxyLoading } from "../components/proxy-foundation";
import { ProxyIcon } from "../components/proxy-icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RealitySceneMapSurface } from "./reality-scene-map";
import {
  CREATE_CATEGORIES,
  FORM_PROGRESS_TOTAL,
  PEOPLE_MAX,
  PEOPLE_MIN,
  PEOPLE_RANGES,
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
  photo: { name: "catPhoto", example: "createExPhoto" },
  makeup: { name: "catMakeup", example: "createExMakeup" },
  familyPhoto: { name: "catFamilyPhoto", example: "createExFamilyPhoto" },
  shopping: { name: "catShopping", example: "createExShopping" },
  art: { name: "catArt", example: "createExArt" },
  movie: { name: "catMovie", example: "createExMovie" },
  music: { name: "catMusic", example: "createExMusic" },
  esports: { name: "catEsports", example: "createExEsports" },
  walk: { name: "catWalk", example: "createExWalk" },
  sport: { name: "catSport", example: "createExSport" },
};

// ACTIVITY-CAT-ICONS-001（2026-10-11，用户「那 logo 就用现在的吧」）：分类图标用已经设计好的
// 场景活动图标（assets/scene-activity/actions，首页场景活动入口同一套），不用 emoji、不另画。
// 化妆 / 亲子拍照 / 电竞三张是同一规格（64 画布、#151515 线条、#F0A11C 点缀）补的。
const CAT_ICON: Record<CreateCategoryId, number> = {
  cafe: require("../../assets/scene-activity/actions/coffee.svg"),
  food: require("../../assets/scene-activity/actions/dining.svg"),
  photo: require("../../assets/scene-activity/actions/photo.svg"),
  makeup: require("../../assets/scene-activity/actions/makeup.svg"),
  familyPhoto: require("../../assets/scene-activity/actions/family-photo.svg"),
  shopping: require("../../assets/scene-activity/actions/shopping.svg"),
  art: require("../../assets/scene-activity/actions/exhibition.svg"),
  movie: require("../../assets/scene-activity/actions/movie.svg"),
  music: require("../../assets/scene-activity/actions/music.svg"),
  esports: require("../../assets/scene-activity/actions/esports.svg"),
  walk: require("../../assets/scene-activity/actions/city-walk.svg"),
  sport: require("../../assets/scene-activity/actions/sport.svg"),
};

const WEEKDAY_LOCALE: Record<string, string> = { zh: "zh-CN", vi: "vi", en: "en", lo: "lo", ko: "ko", ja: "ja" };

// 四档参与人数（见 activity-create-form 的 PEOPLE_RANGES）。
const PEOPLE_PRESETS = PEOPLE_RANGES;

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
  // ACTIVITY-COVER-001（2026-10-01，用户「做活动 商家活动吧 活动图片资产」）：
  // 封面图走**媒体管线**上传，拿到 mediaAssetId 再随发布命令带上去 —— 与门店
  // 相册、场景照片墙同一套（R36.x PHOTO-001：只有 READY+PUBLIC 的资产才能
  // 远端展示，否则别人设备永远看不到）。
  //
  // 为什么发 id 不发 URL：服务端存 URL 就等于接受"客户端指定渲染哪张图"，
  // 那是任意外部地址。存资产 id，URL 由客户端用共享 helper 拼。
  const wizardMedia = useMemo(() => new MediaClient({
    authClient: sessionAuthClient,
    secureSessionStore: nativeSecureSessionStore,
    baseUrl: localApiBaseUrl,
  }), []);
  const [coverAssetId, setCoverAssetId] = useState<string | undefined>(undefined);
  const [coverBusy, setCoverBusy] = useState(false);
  // ACTIVITY-COVER-001：预览用共享 helper 拼的 thumb URL，和发布后别处看到的
  // 是同一套解析，不在这里另写一份。
  const coverUri = mediaThumbUrl(coverAssetId, localApiBaseUrl);
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
  //
  // ACTIVITY-DRAFT-RESTORE-001（2026-10-11，用户：「存草稿功能似乎没有用」）：这段 effect 以前依赖
  // [t]，而 useI18n() 每次渲染都返回新的 t 函数 —— 于是**每次渲染都重跑**：目录加载成功
  // → setSpots（新数组）→ 渲染 → 重跑 → 再请求目录……无限循环；更要命的是每次重跑都把上一轮
  // 还没读完的草稿读取置为 cancelled。本机 API 响应很快，钥匙串读取比目录请求慢时，草稿读取
  // 永远被取消、永远恢复不出来 —— 保存是写进去了，下次进来读不回来。
  // 只在挂载时跑一次；t 只用来取「已恢复草稿」那句文案，挂载时的语言就够了。
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // 大字显示当前档："2 – 5" / "31 – 80"。
  const peopleDisplay = `${form.peopleMin} – ${form.peopleMax}`;

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

  /** ACTIVITY-COVER-001：选一张图 → 走媒体管线上传 → 只留 mediaAssetId。 */
  async function pickCover(): Promise<void> {
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("需要照片权限才能给活动配封面。");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        allowsMultipleSelection: false,
        selectionLimit: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const uploaded = await wizardMedia.uploadImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        ...(asset.fileName ? { fileName: asset.fileName } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
      });
      setCoverAssetId(uploaded.mediaAssetId);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面上传失败，请重试。");
    } finally {
      setCoverBusy(false);
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
      // ACTIVITY-COVER-001：封面资产 id 随发布一起走（没有就不带这个键）。
      // WEATHER-001：带上结构化开始时间 / 时长，服务端据此在见面前一天提醒天气。整天活动按 8 小时算。
      const startsAt = new Date(`${form.dateISO}T${String(form.hour).padStart(2, "0")}:${String(form.minute).padStart(2, "0")}:00`);
      const structured = {
        ...input,
        ...(Number.isNaN(startsAt.getTime()) ? {} : { startsAt: startsAt.toISOString(), durationMinutes: form.duration === "all" ? 480 : form.duration }),
      };
      const created = await activities.publish(coverAssetId ? { ...structured, coverMediaAssetId: coverAssetId } : structured);
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
        <View style={styles.successIcon}><ProxyIcon color={color.factConfirmedFg} name="check" size={40} /></View>
        <Text selectable style={styles.successTitle}>{t("publishedTitle")}</Text>
        <Text selectable style={styles.successSub}>{t("publishedSub")}</Text>
        <View style={styles.successCard}>
          <View style={styles.successCatIcon}>{cat ? <Image contentFit="contain" source={CAT_ICON[cat.id]} style={styles.successCatImg} transition={0} /> : null}</View>
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
      {draftMsg && !error ? <Text selectable style={styles.draftMsg}>{draftMsg}</Text> : null}

      {/* 1. 分类 */}
      <View style={styles.block}>
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
              <Image contentFit="contain" source={CAT_ICON[c.id]} style={styles.catIcon} transition={0} />
              <Text selectable style={[styles.catName, form.cat === c.id && styles.catNameOn]}>{t(CAT_COPY[c.id].name)}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 2. 名称 */}
      <View style={styles.block}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createName")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
          {nameHint !== "" ? <Text selectable style={styles.blockHint}>{nameHint}</Text> : null}
        </View>
        <TextInput
          accessibilityLabel={t("createName")}
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
      <View style={styles.block}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>{t("createPeople")}</Text>
          <Text selectable style={styles.blockReq}>*</Text>
        </View>
        <View style={styles.peopleDisplay}>
          <Text selectable style={styles.peopleValue}>{peopleDisplay}</Text>
          <Text selectable style={styles.peopleUnit}>{t("peopleUnit")}</Text>
        </View>
        <View style={styles.pills}>
          {PEOPLE_PRESETS.map((p) => {
            const on = form.peopleMin === p.min && form.peopleMax === p.max;
            return (
              <Pressable key={`${p.min}-${p.max}`} onPress={() => patch({ peopleMin: p.min, peopleMax: p.max })} style={[styles.pill, on && styles.pillOn]}>
                <Text selectable style={[styles.pillText, on && styles.pillTextOn]}>{peopleRangeLabel(p.min, p.max)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 4. 日期 */}
      <View style={styles.block}>
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
      <View style={styles.block}>
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

      {/* WEATHER-001：选了场地后，那个日期 + 时间 + 时长的天气；雨提醒，暴雨建议改期（点一下改日期和时间）。 */}
      {selectedSpot !== undefined && form.duration !== "all" ? (
        <WeatherAdviceBanner
          at={new Date(`${form.dateISO}T${String(form.hour).padStart(2, "0")}:${String(form.minute).padStart(2, "0")}:00`)}
          hours={form.duration / 60}
          lat={selectedSpot.latitude}
          lng={selectedSpot.longitude}
          onPickAt={(when) => patch({
            dateISO: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`,
            hour: when.getHours(),
            minute: when.getMinutes() >= 30 ? 30 : 0,
          })}
        />
      ) : null}

      {/* 6. 时长 */}
      <View style={styles.block}>
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
      <View style={styles.block}>
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
      <View style={styles.block}>
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
      <View style={styles.block}>
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
      <View style={styles.block}>
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

      {/* ACTIVITY-COVER-001：封面选择器。有图就显示缩略图 + 换一张 / 移除，
          没有就显示"加封面"。空着也能发布 —— 封面是可选的，不该拦住活动本身。 */}
      <View style={styles.block}>
        <View style={styles.blockLabel}>
          <Text selectable style={styles.blockName}>活动封面</Text>
          <Text selectable style={styles.blockHint}>{t("optionalHint")}</Text>
        </View>
        <View style={styles.coverBox}>
          {coverUri ? (
            <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: coverUri }} style={styles.coverPreview} transition={0} />
          ) : (
            <Pressable accessibilityLabel="选择封面" disabled={coverBusy} onPress={() => void pickCover()} style={styles.coverEmpty}>
              <ProxyIcon color={color.muted} name="camera" size={24} />
            </Pressable>
          )}
          <View style={styles.coverRow}>
            <Pressable accessibilityLabel="更换封面" disabled={coverBusy} onPress={() => void pickCover()} style={styles.pill}>
              <Text selectable style={styles.pillText}>{coverBusy ? "上传中…" : coverUri ? "换一张" : "选择图片"}</Text>
            </Pressable>
            {coverUri ? <Pressable accessibilityLabel="移除封面" disabled={coverBusy} onPress={() => setCoverAssetId(undefined)} style={styles.pill}>
              <Text selectable style={styles.coverRemoveText}>移除</Text>
            </Pressable> : null}
          </View>
        </View>
      </View>

      {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityLabel={t("publishCta")}
        disabled={publishing || !canPublishForm(form) || !placeValid}
        onPress={() => void publish()}
        style={[styles.cta, (publishing || !canPublishForm(form) || !placeValid) && styles.ctaDisabled]}
      >
        <Text selectable style={[styles.ctaText, (publishing || !canPublishForm(form) || !placeValid) && styles.ctaTextDisabled]}>{publishing ? t("posting") : t("publishCta")}</Text>
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
              {/* UI-SCENE-LOAD-001：spotsState 以前只写不读 —— loadSceneSpots 失败时
                  spots 停在 []，这里渲染「没有找到场景」，与「目录确实为空」同屏同文案；
                  而发布门禁（!placeValid || selectedSpot === undefined）会把用户永远
                  卡在「需要选一个场景」，**没有任何重试入口**。失败与空是两回事，必须分开。 */}
              {spotsState === "failed" ? (
                <View style={styles.sheetEmptyWrap}>
                  <Text selectable style={styles.sheetEmpty}>{t("sceneCatalogFailed")}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t("retry")} onPress={() => {
                    setSpotsState("loading");
                    void loadSceneSpots(fetch, localApiBaseUrl)
                      .then((list) => { setSpots(list); setSpotsState("ready"); })
                      .catch(() => setSpotsState("failed"));
                  }} style={styles.sheetRetry}>
                    <Text selectable style={styles.sheetRetryText}>{t("retry")}</Text>
                  </Pressable>
                </View>
              ) : filteredSpots.length === 0 && spotsState === "ready" ? (
                <Text selectable style={styles.sheetEmpty}>{t("noSceneFound")}{"\n"}{t("noSceneFoundSub")}</Text>
              ) : filteredSpots.length === 0 ? (
                <ProxyLoading tone="muted" />
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
                        {on ? <ProxyIcon color={color.white} name="check" size={12} /> : null}
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

// ACTIVITY-CREATE-UI-R3-001（2026-10-11，用户「优化下创建活动的UI logo 排版 字体」）：全表按 R3 收口。
//   字号：Section 17/800（页标题）· Card Title 15/800（区块名）· Object/Button 14/800（选项、按钮）·
//         Body 14/500 · Meta 12/500 · Caption 11/600；Number XL 28/900、Number L 20/900，数字 tabular-nums。
//         例外：可输入的文本框 16px（iOS 小于 16 聚焦自动放大）。
//   排版：左右 16、区块间 20、1px Line 边框、小卡 / 输入 16 圆角、pill 999、无阴影。
//   颜色：只用 theme token；必填星号 = magenta，「已选场景」用 fact-confirmed 状态色。
//   以前未填分类 / 名称时下面九块整块 opacity 0.32 —— 看起来像坏了、而且照样能点；现在全部常亮，
//   必填由 canPublishForm / publish() 拦。
const H = 16;
const styles = StyleSheet.create({
  content: { paddingBottom: 40, paddingTop: 8 },
  head: { alignItems: "center", flexDirection: "row", paddingHorizontal: 8, paddingVertical: 4 },
  backBtn: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  title: { color: color.ink, flex: 1, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, lineHeight: 24, textAlign: "center" },
  draftBtn: { alignItems: "center", height: 44, justifyContent: "center", paddingHorizontal: 8 },
  draftText: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  progressBar: { backgroundColor: color.line, borderRadius: 999, height: 3, marginHorizontal: H, marginTop: 8, overflow: "hidden" },
  progressFill: { backgroundColor: color.ink, borderRadius: 999, height: "100%" },
  heroSub: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginBottom: 20, marginTop: 10, paddingHorizontal: H },
  draftMsg: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginBottom: 12, marginTop: -12, paddingHorizontal: H },
  block: { marginBottom: 20, paddingHorizontal: H },
  blockLabel: { alignItems: "baseline", flexDirection: "row", gap: 4, marginBottom: 10 },
  blockName: { color: color.ink, fontSize: 15, fontWeight: "800", letterSpacing: -0.15, lineHeight: 21 },
  blockReq: { color: color.magenta, fontSize: 15, fontWeight: "800", lineHeight: 21 },
  blockHint: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15, marginLeft: "auto" },
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cat: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 6, height: 80, justifyContent: "center", width: "23%" },
  // 选中：浅底 + 深色描边（图标是深色线条，填黑会看不见）。
  catOn: { backgroundColor: color.surface, borderColor: color.ink, borderWidth: 1.5 },
  catIcon: { height: 32, width: 32 },
  catName: { color: color.ink, fontSize: 12, fontWeight: "600", lineHeight: 15 },
  catNameOn: { color: color.ink, fontWeight: "800" },
  nameInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, color: color.ink, fontSize: 16, fontWeight: "700", height: 52, paddingHorizontal: 16 },
  suggestRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  suggest: { backgroundColor: color.surface, borderColor: color.surface, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  suggestOn: { backgroundColor: color.ink, borderColor: color.ink },
  suggestText: { color: color.ink, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  suggestTextOn: { color: color.white },
  peopleDisplay: { alignItems: "baseline", flexDirection: "row", gap: 6, marginBottom: 10 },
  peopleValue: { color: color.ink, fontSize: 28, fontVariant: ["tabular-nums"], fontWeight: "900", letterSpacing: -0.55, lineHeight: 32 },
  peopleUnit: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 16 },
  pillOn: { backgroundColor: color.ink, borderColor: color.ink },
  pillText: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  pillTextOn: { color: color.white },
  chipRail: { gap: 8, paddingRight: H },
  dateChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, gap: 2, height: 64, justifyContent: "center", width: 56 },
  dateWeek: { color: color.muted, fontSize: 11, fontWeight: "600", lineHeight: 15 },
  dateDay: { color: color.ink, fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "900", letterSpacing: -0.3, lineHeight: 24 },
  dateWeekend: {},
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipTextOn: { color: color.white },
  timeChip: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 40, minWidth: 68, paddingHorizontal: 14 },
  timeText: { color: color.ink, fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "800", lineHeight: 18, textAlign: "center" },
  chipDisabled: { opacity: 0.35 },
  placeRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  placeInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, color: color.ink, flex: 1, fontSize: 16, fontWeight: "700", height: 52, paddingHorizontal: 16 },
  mapBtn: { alignItems: "center", height: 52, justifyContent: "center", width: 44 },
  mapPage: { flex: 1 },
  pickedCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginTop: 10, padding: 12 },
  pickedBadge: { backgroundColor: color.factConfirmedBg, borderRadius: 999, color: color.factConfirmedFg, fontSize: 11, fontWeight: "600", lineHeight: 15, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 2 },
  pickedBody: { flex: 1, minWidth: 0 },
  pickedName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  pickedMeta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: 2 },
  pickedChange: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  pickedChangeText: { color: color.ink, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  hintRow: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: 8 },
  textInput: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, color: color.ink, fontSize: 16, fontWeight: "500", marginTop: 10, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12 },
  textArea: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, color: color.ink, fontSize: 16, fontWeight: "500", lineHeight: 22, minHeight: 88, paddingHorizontal: 16, paddingVertical: 12, textAlignVertical: "top" },
  coverBox: { alignItems: "center", flexDirection: "row", gap: 12 },
  coverPreview: { backgroundColor: color.surface, borderRadius: 16, height: 72, width: 72 },
  coverEmpty: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderStyle: "dashed", borderWidth: 1, height: 72, justifyContent: "center", width: 72 },
  coverRow: { flexDirection: "row", gap: 8 },
  coverRemoveText: { color: color.muted, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  error: { color: color.magenta, fontSize: 12, fontWeight: "500", lineHeight: 17, marginBottom: 10, paddingHorizontal: H, textAlign: "center" },
  cta: { alignItems: "center", backgroundColor: color.ink, borderRadius: 16, justifyContent: "center", marginHorizontal: H, marginTop: 4, minHeight: 52 },
  ctaDisabled: { backgroundColor: color.line },
  ctaText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  ctaTextDisabled: { color: color.muted },
  sheetBackdrop: { backgroundColor: "rgba(23,19,31,0.32)", bottom: 0, justifyContent: "flex-end", left: 0, position: "absolute", right: 0, top: 0, zIndex: 50 },
  sheet: { backgroundColor: color.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, bottom: 0, left: 0, maxHeight: "85%", padding: H, paddingBottom: 32, position: "absolute", right: 0 },
  sheetGrab: { alignSelf: "center", backgroundColor: color.line, borderRadius: 999, height: 4, marginBottom: 14, width: 40 },
  sheetTitle: { color: color.ink, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, lineHeight: 24, marginBottom: 12 },
  sheetSearch: { backgroundColor: color.surface, borderRadius: 16, color: color.ink, fontSize: 16, fontWeight: "500", height: 44, marginBottom: 10, paddingHorizontal: 14 },
  filterRow: { gap: 8, marginBottom: 10, paddingRight: 8 },
  filterChip: { backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  filterChipOn: { backgroundColor: color.ink, borderColor: color.ink },
  filterText: { color: color.muted, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  filterTextOn: { color: color.white },
  sheetList: { maxHeight: 320 },
  sheetEmpty: { color: color.muted, fontSize: 14, fontWeight: "500", lineHeight: 20, paddingVertical: 32, textAlign: "center" },
  // UI-SCENE-LOAD-001：读取失败与「没有场景」分开，失败态必须给重试入口。
  sheetEmptyWrap: { alignItems: "center", gap: 12, paddingVertical: 32 },
  sheetRetry: { backgroundColor: color.ink, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  sheetRetryText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  spotRow: { alignItems: "center", borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginBottom: 8, padding: 10 },
  spotRowOn: { backgroundColor: color.offWhite, borderColor: color.ink },
  spotImg: { borderRadius: 12, height: 72, width: 72 },
  spotFallback: { alignItems: "center", backgroundColor: color.surface, justifyContent: "center" },
  spotInitial: { color: color.muted, fontSize: 20, fontWeight: "900", lineHeight: 24 },
  spotBody: { flex: 1, minWidth: 0 },
  spotName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20 },
  spotMeta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17, marginTop: 2 },
  spotCheck: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 999, borderWidth: 1, height: 22, justifyContent: "center", width: 22 },
  spotCheckOn: { backgroundColor: color.ink, borderColor: color.ink },
  success: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  successIcon: { alignItems: "center", backgroundColor: color.factConfirmedBg, borderRadius: 999, height: 80, justifyContent: "center", marginBottom: 20, width: 80 },
  successTitle: { color: color.ink, fontSize: 24, fontWeight: "900", letterSpacing: -0.7, lineHeight: 30, marginBottom: 8 },
  successSub: { color: color.muted, fontSize: 14, fontWeight: "500", lineHeight: 20, marginBottom: 8, textAlign: "center" },
  successCard: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, marginTop: 20, padding: 14, width: "100%" },
  successCatIcon: { alignItems: "center", backgroundColor: color.surface, borderRadius: 14, height: 44, justifyContent: "center", width: 44 },
  successCatImg: { height: 30, width: 30 },
  successBody: { flex: 1, minWidth: 0 },
  successName: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 20, marginBottom: 2 },
  successMeta: { color: color.muted, fontSize: 12, fontWeight: "500", lineHeight: 17 },
  successBtns: { flexDirection: "row", gap: 10, marginTop: 20, width: "100%" },
  successBtn: { alignItems: "center", borderRadius: 16, flex: 1, justifyContent: "center", minHeight: 52 },
  successGhost: { backgroundColor: color.white, borderColor: color.line, borderWidth: 1 },
  successBtnGhostText: { color: color.ink, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  successPrimary: { backgroundColor: color.ink },
  successBtnPrimaryText: { color: color.white, fontSize: 14, fontWeight: "800", lineHeight: 18 },
});
