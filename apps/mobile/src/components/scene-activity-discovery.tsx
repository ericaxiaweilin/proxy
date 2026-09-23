import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "../theme";
import { Image, type ImageSource } from "expo-image";
import { ProxyIcon } from "./proxy-icon";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { HorizontalSwipeRail } from "./horizontal-swipe-rail";
import { nativeSecureStorageDriver } from "../native-secure-storage";
import { createSceneFavoritesStore } from "../scene-favorites";

export type SceneDiscoveryBrief = {
  id: string;
  name: string;
  area: string;
  type: string;
  imageUrl: string;
};

type Taxon = { id: string; label: string; icon: ImageSource };
type ActionDetail = Taxon & { familyId: string; matchActionId: string };
type SceneAssetCatalog = {
  actions: Record<string, string>;
  scenes: Record<string, string>;
  themes: Record<string, string>;
  moments: Record<string, string>;
};
export type MomentSeed = {
  id: string;
  title: string;
  action: string;
  scene: string;
  themes: readonly string[];
  time: string;
  price: string;
  occasion: string;
};

export const SCENE_ACTIONS: readonly Taxon[] = [
  { id: "coffee", label: "咖啡", icon: require("../../assets/scene-activity/actions/coffee.svg") },
  { id: "dining", label: "用餐", icon: require("../../assets/scene-activity/actions/dining.svg") },
  { id: "city-walk", label: "City Walk", icon: require("../../assets/scene-activity/actions/city-walk.svg") },
  { id: "photo", label: "拍照", icon: require("../../assets/scene-activity/actions/photo.svg") },
  { id: "cycling", label: "骑行", icon: require("../../assets/scene-activity/actions/cycling.svg") },
  { id: "exhibition", label: "看展", icon: require("../../assets/scene-activity/actions/exhibition.svg") },
  { id: "shopping", label: "逛街", icon: require("../../assets/scene-activity/actions/shopping.svg") },
  { id: "movie", label: "观影", icon: require("../../assets/scene-activity/actions/movie.svg") },
  { id: "music", label: "音乐", icon: require("../../assets/scene-activity/actions/music.svg") },
  { id: "explore-store", label: "探店", icon: require("../../assets/scene-activity/actions/explore-store.svg") },
  { id: "travel", label: "出游", icon: require("../../assets/scene-activity/actions/travel.svg") },
  { id: "sport", label: "运动", icon: require("../../assets/scene-activity/actions/sport.svg") },
  { id: "translation", label: "翻译", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "urban-support", label: "城市协助", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
] as const;

const ACTIONS = SCENE_ACTIONS;

// Detail nodes extend a stable top-level taxonomy without making Home wider.
// matchActionId keeps today's Moment projection compatible until ranking moves
// from exact tags to the server taxonomy graph.
const ACTION_DETAILS: readonly ActionDetail[] = [
  { id: "running", label: "跑步", familyId: "sport", matchActionId: "sport", icon: require("../../assets/scene-activity/actions/sport.svg") },
  { id: "sport-cycling", label: "骑行", familyId: "sport", matchActionId: "cycling", icon: require("../../assets/scene-activity/actions/cycling.svg") },
  { id: "badminton", label: "羽毛球", familyId: "sport", matchActionId: "sport", icon: require("../../assets/scene-activity/actions/sport.svg") },
  { id: "tennis", label: "网球", familyId: "sport", matchActionId: "sport", icon: require("../../assets/scene-activity/actions/sport.svg") },
  { id: "yoga", label: "瑜伽 / 普拉提", familyId: "sport", matchActionId: "sport", icon: require("../../assets/scene-activity/actions/sport.svg") },
  { id: "registration-support", label: "挂号协助", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "doctor-translation", label: "问诊翻译", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "examination-companion", label: "检查陪同", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "pharmacy-support", label: "取药协助", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "hospital-stay-companion", label: "住院陪同", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "checkup-companion", label: "体检陪同", familyId: "translation", matchActionId: "translation", icon: require("../../assets/scene-activity/actions/translation.svg") },
  { id: "business-companion", label: "商务陪同", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "administrative-companion", label: "办事陪同", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "housing-viewing", label: "租房看房", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "sim-setup", label: "SIM 办理陪同", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "local-guide", label: "本地向导", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "study-exchange", label: "学习交流", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
  { id: "content-creation", label: "内容拍摄", familyId: "urban-support", matchActionId: "urban-support", icon: require("../../assets/scene-activity/actions/urban-support.svg") },
] as const;

const SCENES: readonly Taxon[] = [
  { id: "cafe", label: "咖啡馆", icon: require("../../assets/scene-activity/scenes/cafe.svg") },
  { id: "lake", label: "湖边", icon: require("../../assets/scene-activity/scenes/lake.svg") },
  { id: "old-town", label: "老城区", icon: require("../../assets/scene-activity/scenes/old-town.svg") },
  { id: "night-market", label: "夜市", icon: require("../../assets/scene-activity/scenes/night-market.svg") },
  { id: "gallery", label: "美术馆", icon: require("../../assets/scene-activity/scenes/gallery.svg") },
  { id: "beach", label: "海边", icon: require("../../assets/scene-activity/scenes/beach.svg") },
  { id: "park", label: "公园", icon: require("../../assets/scene-activity/scenes/park.svg") },
  { id: "mall", label: "商场", icon: require("../../assets/scene-activity/scenes/mall.svg") },
  { id: "restaurant", label: "餐厅", icon: require("../../assets/scene-activity/scenes/restaurant.svg") },
  { id: "event", label: "活动现场", icon: require("../../assets/scene-activity/scenes/event.svg") },
  { id: "hospital", label: "医院", icon: require("../../assets/scene-activity/scenes/hospital.svg") },
] as const;

const THEMES: readonly Taxon[] = [
  { id: "ao-dai", label: "奥黛", icon: require("../../assets/scene-activity/themes/ao-dai.svg") },
  { id: "sunset", label: "日落", icon: require("../../assets/scene-activity/themes/sunset.svg") },
  { id: "film", label: "胶片", icon: require("../../assets/scene-activity/themes/film.svg") },
  { id: "local", label: "本地人", icon: require("../../assets/scene-activity/themes/local.svg") },
  { id: "food", label: "美食", icon: require("../../assets/scene-activity/themes/food.svg") },
  { id: "art", label: "艺术", icon: require("../../assets/scene-activity/themes/art.svg") },
  { id: "nature", label: "自然", icon: require("../../assets/scene-activity/themes/nature.svg") },
  { id: "night", label: "夜晚", icon: require("../../assets/scene-activity/themes/night.svg") },
  { id: "retro", label: "复古", icon: require("../../assets/scene-activity/themes/retro.svg") },
  { id: "vietnam", label: "越南传统", icon: require("../../assets/scene-activity/themes/vietnam.svg") },
  { id: "medical-companion", label: "陪诊", icon: require("../../assets/scene-activity/themes/medical-companion.svg") },
] as const;

// SCENE-PICKER-FILTER-ROWS-001（2026-09-21）：THEMES 之前是一整条 11 个标签
// 摆一排，语义上其实是 3 件不一样的事——穿搭风格、拍摄时段、氛围人群——
// 混在一条横滑里，用户分不清"这些标签是同一种东西"还是"随便凑的"。
//
// SCENE-PICKER-FILTER-LABELS-002（2026-09-21）：第一次尝试只是把"风格/时段
// /氛围"三行的行标题换成"造型/时间/主题"，行的结构（3 行常驻横滑 chips）
// 没变。
//
// SCENE-PICKER-FILTER-SINGLE-ROW-003（2026-09-21，用户二次复盘）：用户要的
// 从来不是"换行标签"——3 行常驻 chips 本身，不管标题多好懂，对大众来说都
// 比参考图那种"一行 3 个按钮，点开才弹出选项"更难懂。这版把三行结构整个
// 拆掉，改成一行三个弹出式按钮：金额 / 时间 / 场合。
// - 时间／金额：这两个维度在别处的真实后端记录（Activity.Price、
//   RealityScene 的时间窗口等）里有字段，但都还没接到这个组件本地的
//   MOMENTS fixture 上。用户明确要求直接照抄参考图效果（一行按钮 + 弹
//   层），并且在被告知"这样会显示占位值、暂时不是真实价格/时间"之后，
//   仍然选择现在就要金额筛选、且要比原有 日落/夜晚 更细的上午/下午/晚
//   上——所以这里的 price/time 是本地 MOMENTS 数据上新增的占位字段，用于
//   把交互形状先做对；等真正的数据管线把 Activity/RealityScene 接进来，
//   要把这两个字段换成真实来源，而不是继续手写。
//
// SCENE-PICKER-OCCASION-006（2026-09-21，用户三次复盘）：第一版"场合"是把
// 造型(奥黛/复古/胶片) + 主题(本地人/美食/艺术/自然/越南传统/陪诊) 这 9 个
// THEMES id 硬并成一个列表——用户明确反馈"选项内容不对"。改成用户指定的
// 方向："按用途/场景氛围"分类：约会/朋友聚会/独自放空/商务社交/家庭出行，
// 描述的是"这次活动是什么性质的场合"，跟风格/主题标签是两回事。跟 price/
// time 一样，这是本地 MOMENTS 数据上新增的占位字段（真实数据管线接入前的
// 交互占位），不是从 THEMES 派生。
type SimpleOption = { id: string; label: string; glyph: string };

const PRICE_OPTIONS: readonly SimpleOption[] = [
  { id: "free", label: "免费", glyph: "🆓" },
  { id: "low", label: "≤50K", glyph: "💵" },
  { id: "mid", label: "≤150K", glyph: "💴" },
  { id: "high", label: "150K+", glyph: "💎" },
];

const TIME_OPTIONS: readonly SimpleOption[] = [
  { id: "morning", label: "上午", glyph: "🌅" },
  { id: "afternoon", label: "下午", glyph: "☀️" },
  { id: "evening", label: "晚上", glyph: "🌆" },
];

const OCCASION_OPTIONS: readonly SimpleOption[] = [
  { id: "date", label: "约会", glyph: "💕" },
  { id: "friends", label: "朋友聚会", glyph: "🎉" },
  { id: "solo", label: "独自放空", glyph: "🧘" },
  { id: "business", label: "商务社交", glyph: "💼" },
  { id: "family", label: "家庭出行", glyph: "👨‍👩‍👧" },
];

type FilterDim = "price" | "time" | "occasion";

function simpleLabel(options: readonly SimpleOption[], id: string | undefined): string {
  if (!id) return "";
  return options.find((option) => option.id === id)?.label ?? "";
}

// SCENE-CARD-SHADE-007（2026-09-21，第二次复盘）：expo-linear-gradient 装上
// 了，但这个 app 有真实的 ios/android 原生工程（Podfile/gradle），不是纯
// Expo Go——`expo install` 只更新了 JS 和 package.json，没有跑原生编译；
// 手机上跑的还是没链接这个原生模块的旧二进制，结果是整张照片被一层解析
// 失败的原生视图糊住，比之前的纯色遮罩还难看。撤回了这个依赖。
//
// SCENE-CARD-SHADE-008（2026-09-21，第三次复盘）：改用多条纯色横条模拟渐
// 变的临时方案有肉眼可见的"斑马条纹"分层——横条数量再多也是离散阶梯，不
// 是真渐变。这个项目里 react-native-svg 已经是长期存在、真正链接进当前原
// 生二进制的依赖（proxy-icon.tsx / circular-avatar-image.tsx 等已经在用），
// 不是刚装、需要重编译才能生效的东西，所以改用 Svg + LinearGradient + Rect
// 画一条真正平滑的矢量渐变，不需要额外原生编译，也不会有条纹。
//
// SCENE-CARD-SHADE-009（2026-09-21，第四次复盘）：条纹没了，但用户反馈
// "下半到底部区域还是太黑"——用户要的是照片本身保持干净、不被大面积压
// 暗，遮罩只是给标题文字兜个底，不是重新给整张图调色。缩小、调淡：卡片
// 上面 62% 完全透明（照片这部分完全不受影响），只有最下面 38% 才开始起
// 一点暗，且封顶到 0.48（原来是 0.82），配合标题文字自己的 textShadow
// 兜底可读性，不再靠底图大面积变黑来保证对比度。

const MOMENTS: readonly MomentSeed[] = [
  { id: "sunset-coffee", title: "日落咖啡", action: "coffee", scene: "lake", themes: ["sunset"], time: "evening", price: "low", occasion: "date" },
  { id: "ao-dai-ride", title: "奥黛骑行", action: "cycling", scene: "old-town", themes: ["ao-dai"], time: "morning", price: "mid", occasion: "friends" },
  { id: "film-city-walk", title: "胶片 City Walk", action: "city-walk", scene: "old-town", themes: ["film"], time: "afternoon", price: "low", occasion: "solo" },
  { id: "night-market-food", title: "夜市探吃", action: "dining", scene: "night-market", themes: ["local", "food"], time: "evening", price: "low", occasion: "friends" },
  { id: "gallery-coffee", title: "看展 + 咖啡", action: "exhibition", scene: "gallery", themes: ["art"], time: "afternoon", price: "mid", occasion: "date" },
  { id: "beach-walk", title: "海边散步", action: "city-walk", scene: "beach", themes: ["sunset", "nature"], time: "evening", price: "free", occasion: "family" },
  { id: "local-store", title: "本地探店", action: "explore-store", scene: "cafe", themes: ["local"], time: "afternoon", price: "low", occasion: "friends" },
  { id: "nature-ride", title: "自然骑行", action: "cycling", scene: "park", themes: ["nature"], time: "morning", price: "free", occasion: "solo" },
  { id: "hospital-translation", title: "医院翻译陪诊", action: "translation", scene: "hospital", themes: ["medical-companion"], time: "morning", price: "high", occasion: "business" },
  { id: "local-city-support", title: "本地城市协助", action: "urban-support", scene: "old-town", themes: ["local"], time: "afternoon", price: "mid", occasion: "business" },
] as const;

/** SCENE-FAVORITE-001：收藏页按 id 回查静态目录。目录里没有的一律 undefined，
    调用方跳过 —— 绝不拿 id 当标题显示，也不用 taxon() 的首项回退糊弄。 */
export function sceneMomentById(id: string): MomentSeed | undefined {
  return MOMENTS.find((moment) => moment.id === id);
}

/** SCENE-FAVORITE-001：收藏卡副标题 —— 静态目录的真实动作/场景标签（跟卡片上显示的一致）。 */
export function sceneMomentLabels(moment: MomentSeed): { actionLabel: string; sceneLabel: string } {
  return { actionLabel: taxon(ACTIONS, moment.action).label, sceneLabel: taxon(SCENES, moment.scene).label };
}

function absoluteNetworkURL(apiBaseUrl: string, value?: string): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  if (!apiBaseUrl) return undefined;
  return `${apiBaseUrl.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

function taxon(items: readonly Taxon[], id: string): Taxon {
  return items.find((item) => item.id === id) ?? items[0]!;
}

function selectedAction(id?: string): Taxon | undefined {
  if (!id) return undefined;
  return [...ACTIONS, ...ACTION_DETAILS].find((item) => item.id === id);
}

function actionMatchId(id?: string): string | undefined {
  if (!id) return undefined;
  return ACTION_DETAILS.find((item) => item.id === id)?.matchActionId ?? id;
}

function actionFamily(id?: string): string | undefined {
  const matched = actionMatchId(id);
  if (matched === "sport" || matched === "cycling") return "sport";
  if (matched === "translation") return "translation";
  if (matched === "urban-support") return "urban-support";
  return undefined;
}

const ACTION_FAMILY_LABELS: Record<string, string> = {
  sport: "城市轻运动",
  translation: "陪诊服务（非医疗）",
  "urban-support": "城市协助细分",
};

function sceneMatches(brief: SceneDiscoveryBrief, sceneId: string): boolean {
  const haystack = `${brief.name} ${brief.area} ${brief.type}`.toLowerCase();
  const words: Record<string, readonly string[]> = {
    cafe: ["咖啡", "cafe", "coffee"], lake: ["湖", "lake", "westlake", "西湖"],
    "old-town": ["老城", "old town", "old quarter"], "night-market": ["夜市", "night market"],
    gallery: ["美术馆", "画廊", "gallery", "museum"], beach: ["海边", "沙滩", "beach", "coast"],
    park: ["公园", "park"], mall: ["商场", "mall"], restaurant: ["餐厅", "restaurant"], event: ["活动", "event"],
    hospital: ["医院", "hospital", "clinic", "诊所"],
  };
  return (words[sceneId] ?? []).some((word) => haystack.includes(word));
}

export function SceneActivityDiscovery({
  scenes,
  apiBaseUrl,
  viewerAccountId,
  onOpenScene,
  onCompose,
}: {
  scenes: readonly SceneDiscoveryBrief[];
  apiBaseUrl: string | undefined;
  /** SCENE-FAVORITE-001：收藏按账号落盘，没有它 hearts 只活在 useState 里。 */
  viewerAccountId?: string | undefined;
  onOpenScene?: (sceneId: string) => void;
  onCompose?: (prompt: string) => void;
}): React.JSX.Element {
  const [actionId, setActionId] = useState<string>();
  const [occasionId, setOccasionId] = useState<string>();
  const [timeId, setTimeId] = useState<string>();
  const [priceId, setPriceId] = useState<string>();
  const [openFilter, setOpenFilter] = useState<FilterDim>();
  const [saved, setSaved] = useState<readonly string[]>([]);
  const [expandedMomentId, setExpandedMomentId] = useState<string>();
  const [detail, setDetail] = useState<MomentSeed>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<SceneAssetCatalog>();
  const safeArea = useSafeAreaInsets();

  // SCENE-FAVORITE-001：hearts 按账号读盘。写失败回滚到写之前（setSaved 的
  // 函数式更新拿不到"之前"，先快照再写）。
  useEffect(() => {
    let cancelled = false;
    if (!viewerAccountId) {
      setSaved([]);
      return;
    }
    void createSceneFavoritesStore(nativeSecureStorageDriver, viewerAccountId)
      .read()
      .then((ids) => { if (!cancelled) setSaved(ids); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [viewerAccountId]);

  function toggleSavedMoment(momentId: string): void {
    setSaved((previous) => {
      const next = previous.includes(momentId)
        ? previous.filter((id) => id !== momentId)
        : [...previous, momentId];
      if (viewerAccountId) {
        const snapshot = previous;
        void createSceneFavoritesStore(nativeSecureStorageDriver, viewerAccountId)
          .write(next)
          .catch(() => setSaved(snapshot));
      }
      return next;
    });
  }

  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    void fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/scene-assets`, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : undefined)
      .then((body) => {
        if (cancelled || !body || typeof body !== "object") return;
        const value = body as Partial<SceneAssetCatalog>;
        setAssets({ actions: value.actions ?? {}, scenes: value.scenes ?? {}, themes: value.themes ?? {}, moments: value.moments ?? {} });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  const networkSource = (group: keyof SceneAssetCatalog, id: string): ImageSource | undefined => {
    const uri = absoluteNetworkURL(apiBaseUrl ?? "", assets?.[group]?.[id]);
    return uri ? { uri } : undefined;
  };

  const matchesRefine = (moment: MomentSeed): boolean =>
    (!occasionId || moment.occasion === occasionId)
    && (!timeId || moment.time === timeId)
    && (!priceId || moment.price === priceId);

  const filtered = useMemo(() => MOMENTS.filter((moment) =>
    (!actionId || moment.action === actionMatchId(actionId))
    && matchesRefine(moment)
  ), [actionId, occasionId, timeId, priceId]);

  const liveSceneFor = (semanticSceneId: string): SceneDiscoveryBrief | undefined =>
    scenes.find((scene) => sceneMatches(scene, semanticSceneId));

  const resetAll = (): void => {
    setActionId(undefined);
    setOccasionId(undefined);
    setTimeId(undefined);
    setPriceId(undefined);
  };

  return (
    <View style={styles.root}>
      <SectionHead label="动作" onAll={() => setPickerOpen(true)} />
      <HorizontalSwipeRail contentContainerStyle={styles.actionRail} preserveChildPresses threshold={3}>
        {ACTIONS.map((action) => {
          const active = action.id === actionMatchId(actionId);
          return <Pressable accessibilityLabel={`动作 ${action.label}`} key={action.id} onPress={() => setActionId(active ? undefined : action.id)} style={styles.actionOption}>
            <View style={[styles.actionGlyph, active && styles.actionGlyphActive]}><Image contentFit="contain" source={action.icon} style={styles.actionIcon} /></View>
            <Text selectable numberOfLines={1} style={styles.actionLabel}>{action.label}</Text>
          </Pressable>;
        })}
      </HorizontalSwipeRail>

      {(actionId || occasionId || timeId || priceId) ? <View style={styles.filterState}><Text selectable style={styles.filterStateText}>{[selectedAction(actionId)?.label ?? "", simpleLabel(PRICE_OPTIONS, priceId), simpleLabel(TIME_OPTIONS, timeId), simpleLabel(OCCASION_OPTIONS, occasionId)].filter(Boolean).join(" × ")}</Text><Pressable onPress={resetAll}><Text selectable style={styles.clear}>重置</Text></Pressable></View> : null}

      {/* SCENE-CARD-STACK-005（2026-09-21，用户带参考图）：原来是 2 列并排
          的小卡片网格（每张 194 高，标题+3 个标签挤在一起）。改成参考图那
          种单列大图卡：整卡背景图、底部深色遮罩上放标题，默认只露 2 个标
          签（动作+场景，最可靠的两个真实维度），其余标签（该 Moment 的
          THEMES + 时间/金额档位）收在"+N"里，点了在卡片内原地展开，不跳
          转、不弹层。收藏心形按钮是已有的真实 saved 状态，只是从小卡片挪
          到大卡片同样的右上角位置，行为没变。参考图里的"🔥 热门"角标没有
          真实的热度/排序数据支撑，这里没有加——留到有真实信号（比如真实
          浏览量/完成量）时再做，不编造一个假热门。 */}
      {filtered.length > 0 ? <View style={styles.sceneList}>{filtered.map((moment) => {
        const live = liveSceneFor(moment.scene);
        const action = taxon(ACTIONS, moment.action);
        const scene = taxon(SCENES, moment.scene);
        const expanded = expandedMomentId === moment.id;
        const extraThemes = moment.themes.map((id) => taxon(THEMES, id));
        const hiddenCount = extraThemes.length + 2;
        return <Pressable accessibilityLabel={`Moment ${moment.title}`} key={moment.id} onPress={() => setDetail(moment)} style={styles.sceneCard}>
          {absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl) || networkSource("moments", moment.id) ? <Image contentFit="cover" source={(absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl) ? { uri: absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl)! } : networkSource("moments", moment.id))!} style={styles.sceneCardPhoto} /> : <View style={[styles.photoPending, styles.sceneCardPhoto]} />}
          <Svg height="100%" pointerEvents="none" style={styles.sceneCardShade} width="100%">
            <Defs>
              <SvgLinearGradient id={`sceneShade-${moment.id}`} x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                <Stop offset="0.62" stopColor="#000000" stopOpacity={0} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.48} />
              </SvgLinearGradient>
            </Defs>
            <Rect fill={`url(#sceneShade-${moment.id})`} height="100%" width="100%" x="0" y="0" />
          </Svg>
          <Pressable accessibilityLabel={saved.includes(moment.id) ? "取消收藏" : "收藏"} hitSlop={8} onPress={() => toggleSavedMoment(moment.id)} style={styles.sceneFavorite}><ProxyIcon color={saved.includes(moment.id) ? color.magenta : color.white} filled={saved.includes(moment.id)} name="heart" size={20} /></Pressable>
          <View style={styles.sceneCardContent}>
            <Text selectable style={styles.sceneCardTitle}>{moment.title}</Text>
            <View style={styles.sceneTagsRow}>
              <Tag icon={action.icon} label={action.label} />
              <Tag icon={scene.icon} label={scene.label} />
              {expanded ? <>
                {extraThemes.map((t) => <Tag icon={t.icon} key={t.id} label={t.label} />)}
                <View style={styles.sceneMetaTag}><Text selectable style={styles.sceneMetaTagText}>🕐 {simpleLabel(TIME_OPTIONS, moment.time)}</Text></View>
                <View style={styles.sceneMetaTag}><Text selectable style={styles.sceneMetaTagText}>💰 {simpleLabel(PRICE_OPTIONS, moment.price)}</Text></View>
              </> : null}
              <Pressable accessibilityLabel={expanded ? "收起标签" : `展开剩余 ${hiddenCount} 个标签`} hitSlop={6} onPress={() => setExpandedMomentId(expanded ? undefined : moment.id)} style={styles.sceneTagMore}>
                <Text selectable style={styles.sceneTagMoreText}>{expanded ? "收起" : `+${hiddenCount}`}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>;
      })}</View> : <View style={styles.empty}><Text selectable style={styles.emptyTitle}>暂时没有完全匹配的 Moment</Text><Text selectable style={styles.emptyText}>减少一个筛选条件，看看更多组合。</Text></View>}

      {/* SCENE-PICKER-WAIMAI-001（2026-09-20）：以前是 动作/场景/主题 三张平铺
          网格竖向堆叠，30+ 个可点目标一次性摆给用户，AND 组合筛选却只过滤
          10 条本地 fixture——大概率筛完是空的，纯负担没收益。改成外卖 App
          常见的"左类目 + 右列表"布局：左边一条动作类目竖排（唯一的主轴，
          点一下就切），右边是该类目下匹配的 Moment 列表（每条卡片自带场景/
          主题标签，不用先在网格里勾选）。
          2026-09-21（用户复盘）：场景（咖啡馆/湖边/老城区…）跟动作（咖啡/
          City Walk…）在这批数据里几乎是绑死的，两个都当独立筛选项摆出来
          是假的"3 个维度"——选了动作基本就等于选了场景，场景那行筛选力约等
          于零。场景整个降级成右侧卡片上的标签（详情页也还有），不再是顶部
          可点筛选。
          SCENE-PICKER-FILTER-SINGLE-ROW-003（2026-09-21，用户二次复盘）：顶
          部细筛最终定型为一行三个弹出式按钮——金额 / 时间 / 场合——而不是
          三行常驻 chips（见上面 THEME_GROUPS 相关注释的完整推演过程）。 */}
      <Modal animationType="slide" onRequestClose={() => setPickerOpen(false)} visible={pickerOpen}>
        <View style={[styles.pickerPage, { paddingTop: safeArea.top }]}>
          <View style={styles.pickerHead}>
            <Pressable accessibilityLabel="返回" hitSlop={8} onPress={() => setPickerOpen(false)} style={styles.pickerBack}>
              <Text selectable style={styles.pickerBackText}>‹ 返回</Text>
            </Pressable>
            <View style={styles.pickerHeadCopy}><Text selectable style={styles.pickerTitle}>动作分类</Text><Text selectable style={styles.pickerHint}>先选一类，再用金额/时间/场合细筛</Text></View>
          </View>

            {openFilter ? <Pressable accessibilityLabel="关闭筛选" onPress={() => setOpenFilter(undefined)} style={styles.filterDropdownScrim} /> : null}
            <View style={styles.filterBarRow}>
              {([
                { dim: "price" as const, glyph: "💰", label: "金额" },
                { dim: "time" as const, glyph: "🕐", label: "时间" },
                { dim: "occasion" as const, glyph: "⭐", label: "场合" },
              ]).map((f, index) => {
                const currentLabel = f.dim === "price" ? simpleLabel(PRICE_OPTIONS, priceId)
                  : f.dim === "time" ? simpleLabel(TIME_OPTIONS, timeId)
                  : simpleLabel(OCCASION_OPTIONS, occasionId);
                const active = Boolean(currentLabel);
                const open = openFilter === f.dim;
                // SCENE-PICKER-FILTER-ANCHORED-004（2026-09-21，用户复盘）：
                // 金额/时间/场合原来各自弹出一个独立的底部 <Modal>，跟外层
                // "动作分类" 页面本身的 <Modal> 叠在一起——两个原生 Modal 同
                // 时可见在这个页面上直接观察到的现象就是"点了金额/时间没反
                // 应"。同时用户也明确要求别学参考图从底部弹层，要"紧贴着选
                // 择按钮弹出一行"。这两个问题一次解决：不再用 <Modal>，改成
                // 普通 View 绝对定位在按钮正下方（同一个页面内的锚定下拉），
                // 外面盖一层可点的透明 scrim 用来点击外部收起。
                return <View key={f.dim} style={styles.filterBarBtnWrap}>
                  <Pressable accessibilityLabel={`筛选 ${f.label}`} onPress={() => setOpenFilter(open ? undefined : f.dim)} style={[styles.filterBarBtn, active && styles.filterBarBtnActive]}>
                    <Text selectable style={styles.filterBarGlyph}>{f.glyph}</Text>
                    <Text selectable numberOfLines={1} style={[styles.filterBarLabel, active && styles.filterBarLabelActive]}>{currentLabel || f.label}</Text>
                    <Text selectable style={[styles.filterBarCaret, active && styles.filterBarCaretActive]}>{open ? "▴" : "▾"}</Text>
                  </Pressable>
                  {open ? <View style={[styles.filterDropdown, index === 2 ? styles.filterDropdownRight : styles.filterDropdownLeft]}>
                    <ScrollView style={styles.filterDropdownList}>
                      {f.dim === "price" ? <>
                        <Pressable accessibilityLabel="金额 不限" onPress={() => { setPriceId(undefined); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>不限</Text>{priceId === undefined ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>
                        {PRICE_OPTIONS.map((opt) => <Pressable accessibilityLabel={`金额 ${opt.label}`} key={opt.id} onPress={() => { setPriceId(opt.id); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>{opt.glyph} {opt.label}</Text>{priceId === opt.id ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>)}
                      </> : null}
                      {f.dim === "time" ? <>
                        <Pressable accessibilityLabel="时间 不限" onPress={() => { setTimeId(undefined); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>不限</Text>{timeId === undefined ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>
                        {TIME_OPTIONS.map((opt) => <Pressable accessibilityLabel={`时间 ${opt.label}`} key={opt.id} onPress={() => { setTimeId(opt.id); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>{opt.glyph} {opt.label}</Text>{timeId === opt.id ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>)}
                      </> : null}
                      {f.dim === "occasion" ? <>
                        <Pressable accessibilityLabel="场合 不限" onPress={() => { setOccasionId(undefined); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>不限</Text>{occasionId === undefined ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>
                        {OCCASION_OPTIONS.map((opt) => <Pressable accessibilityLabel={`场合 ${opt.label}`} key={opt.id} onPress={() => { setOccasionId(opt.id); setOpenFilter(undefined); }} style={styles.filterDropdownOption}>
                          <Text selectable style={styles.filterDropdownOptionText}>{opt.glyph} {opt.label}</Text>{occasionId === opt.id ? <Text selectable style={styles.filterDropdownCheck}>✓</Text> : null}
                        </Pressable>)}
                      </> : null}
                    </ScrollView>
                  </View> : null}
                </View>;
              })}
            </View>

            <View style={styles.waimaiRow}>
              <ScrollView showsVerticalScrollIndicator={false} style={styles.waimaiRail}>
                <Pressable accessibilityLabel="全部动作" onPress={() => setActionId(undefined)} style={[styles.waimaiRailItem, actionId === undefined && styles.waimaiRailItemActive]}>
                  <Text selectable style={[styles.waimaiRailLabel, actionId === undefined && styles.waimaiRailLabelActive]}>全部</Text>
                  <Text selectable style={styles.waimaiRailCount}>{MOMENTS.filter(matchesRefine).length}</Text>
                </Pressable>
                {ACTIONS.map((action) => {
                  const active = actionMatchId(actionId) === action.id;
                  const count = MOMENTS.filter((m) => m.action === action.id && matchesRefine(m)).length;
                  return <Pressable accessibilityLabel={`动作 ${action.label}`} key={action.id} onPress={() => setActionId(active ? undefined : action.id)} style={[styles.waimaiRailItem, active && styles.waimaiRailItemActive]}>
                    <Image contentFit="contain" source={action.icon} style={styles.waimaiRailIcon} />
                    <Text selectable numberOfLines={1} style={[styles.waimaiRailLabel, active && styles.waimaiRailLabelActive]}>{action.label}</Text>
                    {count > 0 ? <Text selectable style={styles.waimaiRailCount}>{count}</Text> : null}
                  </Pressable>;
                })}
              </ScrollView>

              <ScrollView showsVerticalScrollIndicator={false} style={styles.waimaiList}>
                {actionFamily(actionId) ? <View style={styles.detailGroup}>
                  <Text selectable style={styles.detailGroupTitle}>{ACTION_FAMILY_LABELS[actionFamily(actionId)!]}</Text>
                  <View style={styles.detailChipGrid}>{ACTION_DETAILS.filter((detailAction) => detailAction.familyId === actionFamily(actionId)).map((detailAction) => {
                    const active = actionId === detailAction.id;
                    return <Pressable accessibilityLabel={`${ACTION_FAMILY_LABELS[detailAction.familyId]} ${detailAction.label}`} key={detailAction.id} onPress={() => setActionId(active ? detailAction.familyId : detailAction.id)} style={[styles.detailChip, active && styles.detailChipActive]}>
                      <Text selectable style={[styles.detailChipText, active && styles.detailChipTextActive]}>{detailAction.label}</Text>
                    </Pressable>;
                  })}</View>
                  {actionMatchId(actionId) === "translation" ? <Text selectable style={styles.medicalBoundary}>仅提供语言支持、流程协助与非医疗陪同；不提供诊断、治疗、护理或急救服务。</Text> : null}
                  {actionMatchId(actionId) === "urban-support" ? <Text selectable style={styles.medicalBoundary}>仅提供陪同、翻译和流程协助；不代办资质，不提供法律、金融或政府审批承诺。</Text> : null}
                </View> : null}

                {filtered.length > 0 ? filtered.map((moment) => {
                  const live = liveSceneFor(moment.scene);
                  const action = taxon(ACTIONS, moment.action);
                  const scene = taxon(SCENES, moment.scene);
                  const photo = absoluteNetworkURL(apiBaseUrl ?? "", live?.imageUrl) || networkSource("moments", moment.id);
                  return <Pressable accessibilityLabel={`Moment ${moment.title}`} key={moment.id} onPress={() => { setDetail(moment); setPickerOpen(false); }} style={styles.waimaiMomentRow}>
                    {photo ? <Image contentFit="cover" source={photo} style={styles.waimaiMomentPhoto} /> : <View style={[styles.photoPending, styles.waimaiMomentPhoto]} />}
                    <View style={styles.waimaiMomentCopy}>
                      <Text selectable numberOfLines={1} style={styles.waimaiMomentTitle}>{moment.title}</Text>
                      <View style={styles.tagRow}><Tag icon={action.icon} label={action.label} /><Tag icon={scene.icon} label={scene.label} /></View>
                    </View>
                  </Pressable>;
                }) : <View style={styles.empty}><Text selectable style={styles.emptyTitle}>这类还没有完全匹配的 Moment</Text><Text selectable style={styles.emptyText}>减少一个金额/时间/场合筛选，看看更多组合。</Text></View>}
              </ScrollView>
            </View>

          <View style={[styles.pickerActions, { paddingBottom: Math.max(12, safeArea.bottom) }]}><Pressable onPress={resetAll} style={styles.pickerReset}><Text selectable style={styles.pickerResetText}>重置</Text></Pressable><Pressable onPress={() => setPickerOpen(false)} style={styles.pickerDone}><Text selectable style={styles.pickerDoneText}>完成</Text></Pressable></View>
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setDetail(undefined)} transparent visible={detail !== undefined}>
        <Pressable onPress={() => setDetail(undefined)} style={styles.backdrop}>
          {detail ? <View onStartShouldSetResponder={() => true} style={styles.sheet}>
            <View style={styles.grab} />{absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)?.imageUrl) || networkSource("moments", detail.id) ? <Image contentFit="cover" source={(absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)?.imageUrl) ? { uri: absoluteNetworkURL(apiBaseUrl ?? "", liveSceneFor(detail.scene)!.imageUrl)! } : networkSource("moments", detail.id))!} style={styles.detailPhoto} /> : <View style={[styles.photoPending, styles.detailPhoto]} />}
            <Text selectable style={styles.detailTitle}>{detail.title}</Text>
            <View style={styles.detailLayers}><DetailLayer icon={taxon(ACTIONS, detail.action).icon} label="动作" value={taxon(ACTIONS, detail.action).label} /><DetailLayer icon={taxon(SCENES, detail.scene).icon} label="场景" value={taxon(SCENES, detail.scene).label} /><DetailLayer icon={taxon(THEMES, detail.themes[0]!).icon} label="主题" value={detail.themes.map((id) => taxon(THEMES, id).label).join("、")} /></View>
            <View style={styles.detailActions}><Pressable onPress={() => { onCompose?.(`配一个类似的：${detail.title}`); setDetail(undefined); }} style={styles.secondaryButton}><Text selectable style={styles.secondaryText}>配一个类似的</Text></Pressable><Pressable onPress={() => { const target = liveSceneFor(detail.scene); if (target) onOpenScene?.(target.id); setDetail(undefined); }} style={[styles.primaryButton, !liveSceneFor(detail.scene) && styles.disabled]} disabled={!liveSceneFor(detail.scene)}><Text selectable style={styles.primaryText}>{liveSceneFor(detail.scene) ? "查看真实场景" : "场景数据接入中"}</Text></Pressable></View>
          </View> : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function SectionHead({ label, onAll }: { label: string; onAll: () => void }): React.JSX.Element {
  return <View style={styles.sectionHead}><Text selectable style={styles.sectionTitle}>{label}</Text><Pressable accessibilityLabel="查看全部动作场景主题" hitSlop={8} onPress={onAll}><Text selectable style={styles.all}>全部 〉</Text></Pressable></View>;
}

function Tag({ icon, label }: { icon: ImageSource; label: string }): React.JSX.Element {
  return <View style={styles.tag}><Image contentFit="contain" source={icon} style={styles.tagIcon} /><Text selectable numberOfLines={1} style={styles.tagText}>{label}</Text></View>;
}

function DetailLayer({ icon, label, value }: { icon: ImageSource; label: string; value: string }): React.JSX.Element {
  return <View style={styles.detailLayer}><Image contentFit="contain" source={icon} style={styles.detailIcon} /><Text selectable style={styles.detailLabel}>{label}</Text><Text selectable numberOfLines={1} style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { marginHorizontal: -16, paddingHorizontal: 16 },
  sectionHead: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 9, marginTop: 17 },
  sectionTitle: { color: "#151515", fontSize: 17, fontWeight: "900" }, all: { color: "#777169", fontSize: 12, fontWeight: "600" },
  actionRail: { gap: 6, paddingRight: 16 }, actionOption: { alignItems: "center", gap: 4, width: 52 }, actionGlyph: { alignItems: "center", borderColor: "transparent", borderRadius: 14, borderWidth: 1, height: 46, justifyContent: "center", width: 46 }, actionGlyphActive: { backgroundColor: "#FFF6DF", borderColor: "#151515" }, actionIcon: { height: 30, width: 30 }, actionLabel: { color: "#151515", fontSize: 11, fontWeight: "700" },
  photoPending: { backgroundColor: "#DDD7CF", height: "100%", width: "100%" },
  filterState: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 10 }, filterStateText: { color: "#8C867E", flex: 1, fontSize: 11 }, clear: { color: "#151515", fontSize: 11, fontWeight: "900" },
  // SCENE-CARD-STACK-005：单列大图卡，参考 deepseek_html_20260921_c417e3
  // ——整卡背景图 + 底部渐变遮罩承托标题和可展开的标签行。渐变实现见上面
  // SCENE-CARD-SHADE-008 的注释（Svg + LinearGradient，用已经链接进原生
  // 二进制的 react-native-svg，不是斑马条纹近似）。
  sceneList: { gap: 14, marginTop: 13 },
  sceneCard: { backgroundColor: "#DDD7CF", borderRadius: 18, justifyContent: "flex-end", minHeight: 224, overflow: "hidden" },
  sceneCardPhoto: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sceneCardShade: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sceneFavorite: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 17, height: 34, justifyContent: "center", position: "absolute", right: 12, top: 12, width: 34 },
  sceneCardContent: { padding: 15 },
  sceneCardTitle: { color: color.white, fontSize: 19, fontWeight: "900", marginBottom: 9, textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 4 },
  sceneTagsRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 5 },
  sceneMetaTag: { backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 999, height: 25, justifyContent: "center", paddingHorizontal: 8 },
  sceneMetaTagText: { color: "#151515", fontSize: 11, fontWeight: "700" },
  sceneTagMore: { backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, height: 25, justifyContent: "center", paddingHorizontal: 8 },
  sceneTagMoreText: { color: color.white, fontSize: 11, fontWeight: "800" },
  tagRow: { flexDirection: "row", gap: 3 }, tag: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.94)", borderRadius: 999, flexDirection: "row", gap: 2, height: 25, maxWidth: "34%", paddingHorizontal: 4 }, tagIcon: { height: 17, width: 17 }, tagText: { color: "#151515", fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", backgroundColor: color.white, borderColor: "#E8E1D8", borderRadius: 18, borderWidth: 1, marginTop: 13, padding: 22 }, emptyTitle: { color: "#151515", fontSize: 13, fontWeight: "800" }, emptyText: { color: "#8C867E", fontSize: 11, marginTop: 6 },
  // SCENE-PICKER-WAIMAI-001（2026-09-21）：整页，不再是底部弹层——去掉了
  // maxHeight/圆角/拖拽把手，换成"‹ 返回"的整页 header，跟其余全屏 surface
  // 的返回手感一致。
  pickerPage: { backgroundColor: "#F7F4EF", flex: 1, paddingHorizontal: 18 },
  pickerHead: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 8, paddingTop: 14 },
  pickerBack: { paddingVertical: 4 }, pickerBackText: { color: "#151515", fontSize: 16, fontWeight: "800" },
  pickerHeadCopy: { flex: 1 },
  pickerTitle: { color: "#151515", fontSize: 20, fontWeight: "900" }, pickerHint: { color: "#777169", fontSize: 11, fontWeight: "700" },
  // SCENE-PICKER-FILTER-ANCHORED-004：一行三个弹出式按钮（金额/时间/场
  // 合），不是常驻展开的横滑 chips——按钮本身很窄，选中值就直接顶掉按钮上
  // 的默认文案，未选中时不占用额外视觉权重。下拉本身紧贴按钮下方绝对定
  // 位，不用 <Modal>（两个 <Modal> 叠在一起在这个页面上会互相吃掉点击/
  // 渲染，之前"点金额/时间没反应"就是这个），scrim 是普通 Pressable 用来
  // 点外面收起。
  filterBarRow: { flexDirection: "row", gap: 6, marginBottom: 10, marginTop: 2, position: "relative", zIndex: 20, elevation: 20 },
  filterBarBtnWrap: { flex: 1, position: "relative" },
  filterBarBtn: { alignItems: "center", backgroundColor: color.white, borderColor: "#E8E1D8", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 4, justifyContent: "center", paddingVertical: 9 },
  filterBarBtnActive: { backgroundColor: "#151515", borderColor: "#151515" },
  filterBarGlyph: { fontSize: 12 },
  filterBarLabel: { color: "#151515", fontSize: 11, fontWeight: "800" },
  filterBarLabelActive: { color: color.white },
  filterBarCaret: { color: "#8C867E", fontSize: 11 },
  filterBarCaretActive: { color: "rgba(255,255,255,0.7)" },
  filterDropdownScrim: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 },
  filterDropdown: { backgroundColor: color.white, borderColor: "#E8E1D8", borderRadius: 14, borderWidth: 1, elevation: 24, maxWidth: 230, minWidth: 170, position: "absolute", shadowColor: "#000", shadowOffset: { height: 6, width: 0 }, shadowOpacity: 0.12, shadowRadius: 14, top: "115%", zIndex: 30 },
  filterDropdownLeft: { left: 0 },
  filterDropdownRight: { right: 0 },
  filterDropdownList: { maxHeight: 280, paddingVertical: 4 },
  filterDropdownOption: { alignItems: "center", borderRadius: 12, flexDirection: "row", gap: 8, justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 12 },
  filterDropdownOptionText: { color: "#151515", fontSize: 12, fontWeight: "700" },
  filterDropdownCheck: { color: "#151515", fontSize: 13, fontWeight: "900" },
  // 外卖式左类目 + 右列表：唯一主轴（动作）在左边竖排，右边是该类目下匹配
  // 的 Moment 列表，不用先在网格里逐个勾选完才看到结果。
  // flex:1（不再是固定 420）——整页有多少高度就用多少，不用再照着底部
  // 弹层 84% 高度那个约束凑一个固定数字。
  waimaiRow: { flex: 1, flexDirection: "row", gap: 10, marginTop: 6 },
  // SCENE-PICKER-WAIMAI-001 布局坑：垂直 ScrollView 当 flexDirection:"row" 的
  // 子项，只给 style.width 有时不够——量出来实测比 84 宽得多（子项文字内容,
  // 比如英文 "City Walk"，会把宽度撑开）。显式钉住 flexGrow/flexShrink/
  // flexBasis + maxWidth，不给 Yoga 任何"按内容重新算宽度"的空子。
  waimaiRail: { backgroundColor: "#EFEAE1", borderRadius: 16, flexBasis: 84, flexGrow: 0, flexShrink: 0, maxWidth: 84, width: 84 }, waimaiRailItem: { alignItems: "center", gap: 3, paddingVertical: 12, width: "100%" }, waimaiRailItemActive: { backgroundColor: color.white, borderLeftColor: "#151515", borderLeftWidth: 3 }, waimaiRailIcon: { height: 26, width: 26 }, waimaiRailLabel: { color: "#777169", fontSize: 11, fontWeight: "700", textAlign: "center" }, waimaiRailLabelActive: { color: "#151515", fontWeight: "900" }, waimaiRailCount: { color: "#A39C90", fontSize: 11, fontWeight: "700" },
  waimaiList: { flex: 1 }, waimaiMomentRow: { alignItems: "center", backgroundColor: color.white, borderColor: "#E8E1D8", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 9, padding: 8 }, waimaiMomentPhoto: { borderRadius: 12, height: 64, width: 64 }, waimaiMomentCopy: { flex: 1, gap: 6 }, waimaiMomentTitle: { color: "#151515", fontSize: 14, fontWeight: "800" },
  detailGroup: { backgroundColor: color.white, borderRadius: 16, marginBottom: 10, padding: 12 }, detailGroupTitle: { color: "#777169", fontSize: 11, fontWeight: "800", marginBottom: 8 }, detailChipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, detailChip: { borderColor: "#DED7CE", borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, detailChipActive: { backgroundColor: "#151515", borderColor: "#151515" }, detailChipText: { color: "#151515", fontSize: 11, fontWeight: "700" }, detailChipTextActive: { color: color.white }, medicalBoundary: { color: "#8C5B35", fontSize: 11, lineHeight: 16, marginTop: 9 }, pickerActions: { flexDirection: "row", gap: 8, marginTop: 12 }, pickerReset: { alignItems: "center", backgroundColor: color.white, borderColor: "#151515", borderRadius: 17, borderWidth: 1, flex: 0.7, paddingVertical: 13 }, pickerResetText: { color: "#151515", fontSize: 13, fontWeight: "900" }, pickerDone: { alignItems: "center", backgroundColor: "#151515", borderRadius: 17, flex: 1.3, paddingVertical: 13 }, pickerDoneText: { color: color.white, fontSize: 13, fontWeight: "900" },
  backdrop: { backgroundColor: "rgba(0,0,0,0.28)", flex: 1, justifyContent: "flex-end" }, sheet: { backgroundColor: "#F7F4EF", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, paddingBottom: 34 }, grab: { alignSelf: "center", backgroundColor: "#CFC8BF", borderRadius: 3, height: 4, marginBottom: 14, width: 42 }, detailPhoto: { borderRadius: 18, height: 180, width: "100%" }, detailTitle: { color: "#151515", fontSize: 24, fontWeight: "900", marginTop: 15 }, detailLayers: { flexDirection: "row", gap: 8, marginTop: 13 }, detailLayer: { alignItems: "center", backgroundColor: color.white, borderColor: "#E8E1D8", borderRadius: 15, borderWidth: 1, flex: 1, padding: 10 }, detailIcon: { height: 30, width: 30 }, detailLabel: { color: "#8C867E", fontSize: 11, marginTop: 4 }, detailValue: { color: "#151515", fontSize: 11, fontWeight: "800", marginTop: 2 }, detailActions: { flexDirection: "row", gap: 8, marginTop: 16 }, secondaryButton: { alignItems: "center", backgroundColor: color.white, borderColor: "#151515", borderRadius: 18, borderWidth: 1, flex: 1, paddingVertical: 13 }, secondaryText: { color: "#151515", fontSize: 12, fontWeight: "800" }, primaryButton: { alignItems: "center", backgroundColor: "#151515", borderRadius: 18, flex: 1.2, paddingVertical: 13 }, primaryText: { color: color.white, fontSize: 12, fontWeight: "800" }, disabled: { opacity: 0.45 },
});
