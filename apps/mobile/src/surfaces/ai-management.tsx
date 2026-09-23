import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Svg, SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AiEngineClient, type AiEngineSettings, type AiPermission, type SecureSessionStoreLike } from "../ai-engine-client";
import type { TransportRequest, TransportResponse } from "../auth-client";
import { formatRelativeTime } from "../composer-body";
import {
  AI_CAMERA_ICONS,
  AI_CAMERA_MOVES,
  AI_MANAGE_ICONS,
  AI_POSES,
  AI_POSE_ICONS,
  AI_SCENES,
  AI_VENDORS,
  type AiScene,
  type AiVendor,
} from "./ai-management-data";

// AI-MANAGE-003（2026-09-23，用户：「我新增了一个 ai 管理模块 原型给了 干的一坨屎 logo 也不对
// 功能也不对」）：按原型 deepseek_html_20260923_83b40b (1).html 整页重做。
//
// 结构、文案、配色、尺寸逐项照原型：页头（返回 / 节点 logo / 标题 / 红色暂停钮）→ 副标题
// 「AI 正在替你工作」→ 深色状态卡 → 「管理项」三张卡 → 版本行；三个底部 sheet：
//   对话管理（风格 / 节奏 / 权限）、图片管理（模型 / 生成场景 / 人物姿态 / 提示词 / 参数）、
//   动态管理（发帖节奏 / 内容偏好 / 发布权限）。目录数据见 ai-management-data.ts。
//
// 跟原型不同、而且是故意的：
//   - 所有选择**真的落服务端**（GetAiEngineSettings / UpdateAiEngineSettings），暂停也是；
//     点下去界面先变，写失败再撤回并提示 —— 不用等服务端回来才变状态。
//   - Token 只显示真实用量，不画原型里的「/ 200K」上限（服务端没有配额，画了就是编的）。
//   - 字号低于 11 的地方抬到 11（design-system-r3 下限）。
//   - 「形象绑定」按真实的形象照片数说话，没绑定就说没绑定，点进去是 AI 分身页。

type AuthChannel = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

type SheetKind = "chat" | "image" | "post" | undefined;
type ChatTab = "style" | "rhythm" | "perm";
type ImageTab = "model" | "scene" | "pose" | "prompt" | "param";
type VendorSort = "quality" | "price" | "popular";

const TONES: ReadonlyArray<{ id: AiEngineSettings["chatTone"]; name: string }> = [
  { id: "cool", name: "高冷" },
  { id: "warm", name: "偏温柔" },
  { id: "softer", name: "很温柔" },
  { id: "lively", name: "活泼" },
  { id: "pro", name: "专业" },
];
const LENGTHS: ReadonlyArray<{ id: AiEngineSettings["chatReplyLength"]; name: string }> = [
  { id: "xshort", name: "极短" },
  { id: "short", name: "短句" },
  { id: "medium", name: "中等" },
  { id: "long", name: "长段" },
];
const EMOJIS: ReadonlyArray<{ id: AiEngineSettings["chatEmoji"]; name: string }> = [
  { id: "never", name: "从不用" },
  { id: "sometimes", name: "偶尔" },
  { id: "often", name: "常用" },
  { id: "every", name: "每句都带" },
];
const RHYTHMS: ReadonlyArray<{ id: AiEngineSettings["chatRhythm"]; icon: string; name: string; desc: string }> = [
  { id: "instant", icon: "⚡", name: "秒回", desc: "收到消息立刻回" },
  { id: "human_3_5", icon: "⏱️", name: "延迟 3-5 秒", desc: "像真人一样稍等片刻再回" },
  { id: "human_10_30", icon: "🐢", name: "延迟 10-30 秒", desc: "不急着回，节奏更自然" },
  { id: "random", icon: "🎲", name: "随机", desc: "时快时慢，更像真人" },
];
const CHAT_PERMISSIONS: ReadonlyArray<{ id: AiPermission; icon: string; name: string; desc: string }> = [
  { id: "off", icon: "🔴", name: "关闭", desc: "不替你回消息" },
  { id: "confirm", icon: "🟡", name: "每次确认", desc: "AI 起草，你点「发」才发" },
  { id: "auto", icon: "🟢", name: "全自动", desc: "AI 直接替你回" },
];
const POST_PACES: ReadonlyArray<{ id: AiEngineSettings["postPace"]; icon: string; name: string; desc: string }> = [
  { id: "daily", icon: "🔥", name: "每天 1 条", desc: "保持活跃" },
  { id: "every_3_days", icon: "⚖️", name: "每 3 天 1 条", desc: "自然节奏，推荐" },
  { id: "weekly", icon: "🐢", name: "每周 1 条", desc: "低频但精致" },
];
const POST_TOPICS = ["胶片", "咖啡", "City Walk", "看展", "美食"] as const;
const POST_PERMISSIONS: ReadonlyArray<{ id: AiPermission; icon: string; name: string }> = [
  { id: "off", icon: "🔴", name: "关闭" },
  { id: "confirm", icon: "🟡", name: "每次确认" },
  { id: "auto", icon: "🟢", name: "全自动" },
];
const ASPECTS: ReadonlyArray<{ id: AiEngineSettings["imageAspect"]; name: string }> = [
  { id: "3:4", name: "3:4 人像" },
  { id: "1:1", name: "1:1 方形" },
  { id: "16:9", name: "16:9 宽幅" },
];
const QUALITIES: ReadonlyArray<{ id: AiEngineSettings["imageQuality"]; name: string }> = [
  { id: "1024", name: "标准 1024px" },
  { id: "1536", name: "高清 1536px" },
  { id: "2048", name: "超清 2048px" },
];

type Badge = { text: string; kind: "running" | "confirm" | "off" };
function permissionBadge(permission: AiPermission): Badge {
  if (permission === "off") return { text: "关闭", kind: "off" };
  if (permission === "confirm") return { text: "每次确认", kind: "confirm" };
  return { text: "运行中", kind: "running" };
}

export function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(total >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(total >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(total);
}

function sceneById(id: string): AiScene {
  return AI_SCENES.find((scene) => scene.id === id) ?? AI_SCENES[0]!;
}

function vendorById(id: string): AiVendor {
  return AI_VENDORS.find((vendor) => vendor.id === id) ?? AI_VENDORS[0]!;
}

// 提示词历史：服务端存的是字符串数组，每条是一个小 JSON（场景 + 文本 + 时间），
// 这样才能像原型那样按场景分开显示历史、切场景时恢复该场景最后保存的版本。
type PromptHistoryEntry = { scene: string; text: string; at: string };
export function decodePromptHistory(raw: ReadonlyArray<string>): PromptHistoryEntry[] {
  return raw.map((item) => {
    try {
      const parsed = JSON.parse(item) as { s?: unknown; t?: unknown; at?: unknown };
      if (parsed && typeof parsed.t === "string") {
        return { scene: typeof parsed.s === "string" ? parsed.s : "", text: parsed.t, at: typeof parsed.at === "string" ? parsed.at : "" };
      }
    } catch {
      // 旧格式（纯文本）：不知道属于哪个场景，所有场景都显示
    }
    return { scene: "", text: item, at: "" };
  });
}
export function encodePromptHistoryEntry(entry: PromptHistoryEntry): string {
  return JSON.stringify({ s: entry.scene, t: entry.text, at: entry.at });
}
function historyTime(at: string): string {
  const date = new Date(at);
  if (!at || Number.isNaN(date.getTime())) return "—";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// 某场景当前生效的提示词：当前场景有自定义就用自定义；否则用该场景最后一次保存的版本；再否则用默认。
export function promptForScene(settings: Pick<AiEngineSettings, "imageScene" | "imagePrompt" | "imagePromptHistory">, sceneId: string): string {
  if (settings.imageScene === sceneId && settings.imagePrompt.trim()) return settings.imagePrompt;
  const latest = decodePromptHistory(settings.imagePromptHistory).find((entry) => entry.scene === sceneId);
  return latest?.text ?? sceneById(sceneId).prompt;
}

// ---------------------------------------------------------------- 小部件

// 原型里的 CSS 渐变（linear-gradient 135deg）。本工程没有链接 expo-linear-gradient 的原生模块
// （见 scene-activity-discovery.tsx 的 SCENE-CARD-SHADE-007），用 react-native-svg 画。
function GradientFill({ id, from, to, radius }: { id: string; from: string; to: string; radius: number }): React.JSX.Element {
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
    </Svg>
  );
}

// 原型 .ai-logo：深色圆角方块 + 五个节点连线 + 右上角在线点。暂停时变灰、点变浅灰。
export function AILogo({ active, size = 34 }: { active: boolean; size?: number }): React.JSX.Element {
  const radius = Math.round(size * 0.32);
  return (
    <View accessibilityLabel={active ? "AI 运行中" : "AI 已暂停"} style={[styles.logo, { width: size, height: size, borderRadius: radius }]}>
      <GradientFill id="aiLogoBg" from={active ? "#1a1a1a" : "#999999"} to={active ? "#2d2d2d" : "#777777"} radius={radius} />
      <Svg width={size * 0.59} height={size * 0.59} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={2} fill="#fff" />
        <Circle cx={6} cy={7} r={1.4} fill="#fff" />
        <Circle cx={18} cy={7} r={1.4} fill="#fff" />
        <Circle cx={6} cy={17} r={1.4} fill="#fff" />
        <Circle cx={18} cy={17} r={1.4} fill="#fff" />
        <Line x1={12} y1={12} x2={6} y2={7} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={18} y2={7} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={6} y2={17} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
        <Line x1={12} y1={12} x2={18} y2={17} stroke="#fff" strokeWidth={1.1} strokeLinecap="round" />
      </Svg>
      <View style={[styles.logoDot, { backgroundColor: active ? "#4caf7d" : "#cccccc" }]} />
    </View>
  );
}

function PauseButton({ paused, disabled, onPress }: { paused: boolean; disabled: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={paused ? "继续" : "暂停"}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.pauseBtn, paused && styles.pauseBtnPaused, pressed && { transform: [{ scale: 0.92 }] }]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24">
        {paused ? (
          <Path d="M7 4v16l13-8z" fill="#3d7a4e" />
        ) : (
          <>
            <Rect x={6} y={4} width={4} height={16} rx={1} fill="#e5484d" />
            <Rect x={14} y={4} width={4} height={16} rx={1} fill="#e5484d" />
          </>
        )}
      </Svg>
    </Pressable>
  );
}

function Chip({ label, selected, onPress, static: isStatic }: { label: string; selected: boolean; onPress?: () => void; static?: boolean }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole={isStatic ? "text" : "button"}
      accessibilityState={{ selected }}
      disabled={isStatic}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function OptionItem({ icon, name, desc, selected, onPress }: { icon: string; name: string; desc?: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected && styles.optionSelected]}>
      <Text style={styles.optionIcon}>{icon}</Text>
      <View style={styles.optionInfo}>
        <Text style={styles.optionName}>{name}</Text>
        {desc ? <Text style={styles.optionDesc}>{desc}</Text> : null}
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>{selected ? <Text style={styles.checkMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

function GroupTitle({ title, hint, first }: { title: string; hint?: string; first?: boolean }): React.JSX.Element {
  return (
    <Text style={[styles.groupTitle, !first && styles.groupTitleGap]}>
      {title}
      {hint ? <Text style={styles.groupHint}>{`  · ${hint}`}</Text> : null}
    </Text>
  );
}

function SheetTabs<T extends string>({ tabs, value, onChange }: { tabs: ReadonlyArray<{ id: T; name: string }>; value: T; onChange: (id: T) => void }): React.JSX.Element {
  return (
    <View style={styles.tabsWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tabs.map((tab) => {
          const active = tab.id === value;
          return (
            <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(tab.id)} style={styles.tab}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.name}</Text>
              {active ? <View style={styles.tabBar} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Sheet({ visible, title, subtitle, onClose, toast, children }: { visible: boolean; title: string; subtitle: string; onClose: () => void; toast: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  const safeArea = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.overlay} />
        <View style={[styles.sheet, { paddingBottom: 20 + safeArea.bottom }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.sheetSub}>{subtitle}</Text>
          </View>
          {children}
        </View>
        {/* sheet 是 Modal，盖在页面上面 —— 提示要跟着画在 Modal 里，不然「已保存」看不见。 */}
        {toast}
      </View>
    </Modal>
  );
}

function useToast(): { toast: React.JSX.Element | null; show: (message: string) => void } {
  const [message, setMessage] = useState<string>();
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setMessage(undefined));
    }, 1600);
  }, [opacity]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const toast = message ? (
    <Animated.View pointerEvents="none" style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText}>{message}</Text>
    </Animated.View>
  ) : null;
  return { toast, show };
}

// ---------------------------------------------------------------- 主页面

export function AIManagementSurface({
  onBack,
  viewerAccountId,
  authClient,
  secureSessionStore,
  imageCount,
  videoCount,
  lastPostAt,
  onOpenImageIdentity,
}: {
  onBack: () => void;
  viewerAccountId: string | undefined;
  authClient: AuthChannel;
  secureSessionStore: SecureSessionStoreLike;
  imageCount: number;
  videoCount: number;
  lastPostAt?: string | undefined;
  // 「形象绑定」点进去 = AI 分身（授权照片）页。
  onOpenImageIdentity?: () => void;
}): React.JSX.Element {
  const safeArea = useSafeAreaInsets();
  const engineClient = useMemo(() => new AiEngineClient({ authClient, secureSessionStore }), [authClient, secureSessionStore]);
  const [settings, setSettings] = useState<AiEngineSettings>();
  const settingsRef = useRef<AiEngineSettings | undefined>(undefined);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [sheet, setSheet] = useState<SheetKind>();
  const [chatTab, setChatTab] = useState<ChatTab>("style");
  const [imageTab, setImageTab] = useState<ImageTab>("model");
  const { toast, show: showToast } = useToast();

  const load = useCallback(() => {
    if (!viewerAccountId) {
      setSettings(undefined);
      setLoadError("登录后才能管理你的 AI");
      return () => undefined;
    }
    let cancelled = false;
    void engineClient.read().then((snap) => {
      if (cancelled) return;
      settingsRef.current = snap.settings;
      setSettings(snap.settings);
      setTokenTotal(snap.usage.promptTokens + snap.usage.outputTokens);
      setLoadError(undefined);
    }).catch((err: unknown) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "AI 设置没读出来");
    });
    return () => { cancelled = true; };
  }, [engineClient, viewerAccountId]);
  useEffect(() => load(), [load]);

  // 点下去界面立刻变；写失败撤回到写之前的值并提示（HOME-MORE-GREET-002 同一条原则：
  // 状态不等服务端回来）。client 自己串行化写，连点不会互相覆盖。
  const patch = useCallback((next: Partial<AiEngineSettings>, okMessage?: string) => {
    const before = settingsRef.current;
    if (!before) return;
    const optimistic = { ...before, ...next };
    settingsRef.current = optimistic;
    setSettings(optimistic);
    if (okMessage) showToast(okMessage);
    engineClient.write(next).catch(() => {
      const reverted = { ...(settingsRef.current ?? before) };
      for (const key of Object.keys(next) as Array<keyof AiEngineSettings>) {
        (reverted as Record<string, unknown>)[key] = before[key];
      }
      settingsRef.current = reverted;
      setSettings(reverted);
      showToast("没保存成功，已恢复");
    });
  }, [engineClient, showToast]);

  const paused = settings?.paused ?? false;
  const ready = settings !== undefined;
  const togglePause = (): void => {
    if (!settings) return;
    patch({ paused: !paused }, paused ? "AI 已恢复" : "已暂停所有 AI 操作");
  };

  // 徽标只说真的在跑的东西：对话代回复是真在跑的（全自动 = 运行中）；出图任务和自动发帖
  // 还没接上这些设置，原型的「运行中」画上去就是假的 —— 如实写「未接出图」/「全自动」。
  const chatBadge: Badge = settings ? permissionBadge(settings.chatPermission) : { text: "…", kind: "off" };
  const postBadge: Badge = settings
    ? settings.postPermission === "auto" ? { text: "全自动", kind: "confirm" } : permissionBadge(settings.postPermission)
    : { text: "…", kind: "off" };
  const imageBadge: Badge = { text: "未接出图", kind: "off" };
  const scene = sceneById(settings?.imageScene ?? "cafe");
  const vendor = vendorById(settings?.imageVendorPref ?? "platform_default");
  const chatActivity = settings
    ? `${TONES.find((t) => t.id === settings.chatTone)?.name ?? ""} · ${LENGTHS.find((l) => l.id === settings.chatReplyLength)?.name ?? ""} · ${RHYTHMS.find((r) => r.id === settings.chatRhythm)?.name ?? ""}`
    : loadError ?? "读取中…";
  const imageActivity = `${scene.name} · ${settings?.imageModelPref || vendor.name}`;
  const postActivity = lastPostAt ? `上次发帖：${formatRelativeTime(lastPostAt)}` : "还没有发过动态";

  const statusLabel = !ready ? (loadError ? "AI 设置没读出来" : "读取中…") : paused ? "AI 已暂停" : "AI 运行中";
  const statusTime = !ready ? "" : paused ? "点击右上角继续" : "刚刚更新";

  return (
    // 顶部安全区由「我的」子页容器负责（SwipeBackShell 里已经让开了状态栏），这里再加会空出一截。
    <View style={styles.root}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="返回" hitSlop={12} onPress={onBack} style={styles.navBack}>
          <Text style={styles.navBackText}>←</Text>
        </Pressable>
        <AILogo active={ready && !paused} />
        <Text style={styles.navTitle}>AI 管理</Text>
        <PauseButton paused={paused} disabled={!ready} onPress={togglePause} />
      </View>
      <View style={styles.subtitle}>
        <View style={[styles.subtitleDot, (paused || !ready) && styles.dotOff]} />
        <Text style={[styles.subtitleText, paused && styles.subtitleTextPaused]}>{!ready ? (loadError ?? "读取中…") : paused ? "AI 已暂停" : "AI 正在替你工作"}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: 30 + safeArea.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.statusCard}>
          <GradientFill id="aiStatusBg" from={paused ? "#666666" : "#1a1a1a"} to={paused ? "#888888" : "#2d2d2d"} radius={20} />
          {!paused ? (
            <Svg pointerEvents="none" style={styles.statusGlow} width={140} height={140}>
              <Defs>
                <RadialGradient id="aiStatusGlow" cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="rgb(91,124,255)" stopOpacity={0.35} />
                  <Stop offset="0.7" stopColor="rgb(91,124,255)" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={70} cy={70} r={70} fill="url(#aiStatusGlow)" />
            </Svg>
          ) : null}
          <View style={styles.statusHead}>
            <View style={[styles.statusDot, (paused || !ready) && styles.dotOff]} />
            <Text style={styles.statusLabel}>{statusLabel}</Text>
            <Text style={styles.statusTime}>{statusTime}</Text>
          </View>
          <View style={styles.statusNums}>
            <View style={styles.statusNum}>
              <Text style={styles.snVal}>{ready ? formatTokens(tokenTotal) : "—"}</Text>
              <Text style={styles.snLabel}>本月 Token</Text>
            </View>
            <View style={styles.statusNum}>
              <Text style={styles.snVal}>{imageCount}</Text>
              <Text style={styles.snLabel}>图片总数</Text>
            </View>
            <View style={styles.statusNum}>
              <Text style={styles.snVal}>{videoCount}</Text>
              <Text style={styles.snLabel}>视频总数</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>管理项</Text>
        <View style={styles.manageList}>
          <ManageCard iconXml={AI_MANAGE_ICONS.chat} name="对话管理" badge={chatBadge} activity={chatActivity} paused={paused} disabled={!ready} onPress={() => { setChatTab("style"); setSheet("chat"); }} />
          <ManageCard iconXml={AI_MANAGE_ICONS.image} name="图片管理" badge={imageBadge} activity={imageActivity} paused={paused} disabled={!ready} onPress={() => { setImageTab("model"); setSheet("image"); }} />
          <ManageCard iconXml={AI_MANAGE_ICONS.post} name="动态管理" badge={postBadge} activity={postActivity} paused={paused} disabled={!ready} onPress={() => setSheet("post")} />
        </View>
        {loadError && ready === false ? (
          <Pressable accessibilityRole="button" onPress={() => { setLoadError(undefined); load(); }} style={styles.retry}>
            <Text style={styles.retryText}>重新读取</Text>
          </Pressable>
        ) : null}
        <Text style={styles.version}>AI Engine v2.4 · 平台托管</Text>
      </ScrollView>

      {settings ? (
        <>
          <ChatSheet toast={toast} visible={sheet === "chat"} tab={chatTab} onTab={setChatTab} settings={settings} patch={patch} onClose={() => setSheet(undefined)} />
          <ImageSheet toast={toast} visible={sheet === "image"} tab={imageTab} onTab={setImageTab} settings={settings} patch={patch} showToast={showToast} imageCount={imageCount} onOpenImageIdentity={onOpenImageIdentity ? () => { setSheet(undefined); onOpenImageIdentity(); } : undefined} onClose={() => setSheet(undefined)} />
          <PostSheet toast={toast} visible={sheet === "post"} settings={settings} patch={patch} onClose={() => setSheet(undefined)} />
        </>
      ) : null}
      {sheet ? null : toast}
    </View>
  );
}

function ManageCard({ iconXml, name, badge, activity, paused, disabled, onPress }: {
  iconXml: string; name: string; badge: Badge; activity: string; paused: boolean; disabled: boolean; onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}，${badge.text}，${activity}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.manageCard, paused && styles.manageCardPaused, pressed && { transform: [{ scale: 0.985 }] }]}
    >
      <View style={styles.manageIcon}>
        {/* AI-MANAGE-004：用户给的图标自带圆角底色，原样画，不再叠渐变底 + emoji。 */}
        <SvgXml xml={iconXml} width={42} height={42} />
      </View>
      <View style={styles.manageInfo}>
        <View style={styles.manageNameRow}>
          <Text style={styles.manageName}>{name}</Text>
          <Text style={[styles.badge, paused ? styles.badgePaused : badge.kind === "running" ? styles.badgeRunning : badge.kind === "confirm" ? styles.badgeConfirm : styles.badgeOff]}>{badge.text}</Text>
        </View>
        <Text numberOfLines={1} style={styles.manageActivity}>{activity}</Text>
      </View>
      <Text style={styles.manageArrow}>›</Text>
    </Pressable>
  );
}

type PatchFn = (next: Partial<AiEngineSettings>, okMessage?: string) => void;

// ---------------------------------------------------------------- 对话管理

function ChatSheet({ toast, visible, tab, onTab, settings, patch, onClose }: { toast: React.ReactNode; visible: boolean; tab: ChatTab; onTab: (tab: ChatTab) => void; settings: AiEngineSettings; patch: PatchFn; onClose: () => void }): React.JSX.Element {
  return (
    <Sheet toast={toast} visible={visible} title="对话管理" subtitle="AI 怎么替你聊天" onClose={onClose}>
      <SheetTabs tabs={[{ id: "style", name: "风格" }, { id: "rhythm", name: "节奏" }, { id: "perm", name: "权限" }]} value={tab} onChange={onTab} />
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.panel}>
        {tab === "style" ? (
          <>
            <GroupTitle first title="语气" />
            <View style={styles.chipsWrap}>{TONES.map((item) => <Chip key={item.id} label={item.name} selected={settings.chatTone === item.id} onPress={() => patch({ chatTone: item.id })} />)}</View>
            <GroupTitle title="回复长度" />
            <View style={styles.chipsWrap}>{LENGTHS.map((item) => <Chip key={item.id} label={item.name} selected={settings.chatReplyLength === item.id} onPress={() => patch({ chatReplyLength: item.id })} />)}</View>
            <GroupTitle title="emoji" />
            <View style={styles.chipsWrap}>{EMOJIS.map((item) => <Chip key={item.id} label={item.name} selected={settings.chatEmoji === item.id} onPress={() => patch({ chatEmoji: item.id })} />)}</View>
          </>
        ) : tab === "rhythm" ? (
          <View style={styles.optionList}>
            {RHYTHMS.map((item) => <OptionItem key={item.id} icon={item.icon} name={item.name} desc={item.desc} selected={settings.chatRhythm === item.id} onPress={() => patch({ chatRhythm: item.id })} />)}
          </View>
        ) : (
          <View style={styles.optionList}>
            {CHAT_PERMISSIONS.map((item) => <OptionItem key={item.id} icon={item.icon} name={item.name} desc={item.desc} selected={settings.chatPermission === item.id} onPress={() => patch({ chatPermission: item.id }, "已保存")} />)}
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 图片管理

function ImageSheet({ toast, visible, tab, onTab, settings, patch, showToast, imageCount, onOpenImageIdentity, onClose }: {
  toast: React.ReactNode; visible: boolean; tab: ImageTab; onTab: (tab: ImageTab) => void; settings: AiEngineSettings; patch: PatchFn; showToast: (message: string) => void;
  imageCount: number; onOpenImageIdentity?: (() => void) | undefined; onClose: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<VendorSort>("popular");
  const scene = sceneById(settings.imageScene);
  const poses = AI_POSES[scene.id] ?? [];
  const pose = poses.find((item) => item.id === settings.imagePose);
  const camera = AI_CAMERA_MOVES.find((item) => item.id === settings.imageCamera);
  const [promptDraft, setPromptDraft] = useState(() => promptForScene(settings, scene.id));
  useEffect(() => { if (visible) { setQuery(""); setPromptDraft(promptForScene(settings, settings.imageScene)); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = decodePromptHistory(settings.imagePromptHistory).filter((entry) => entry.scene === scene.id || entry.scene === "");

  const vendors = useMemo(() => {
    const pinned = AI_VENDORS.filter((vendor) => vendor.pinned);
    const rest = AI_VENDORS.filter((vendor) => !vendor.pinned).sort((a, b) =>
      sort === "quality" ? b.quality - a.quality : sort === "price" ? a.priceScore - b.priceScore : b.popular - a.popular);
    return [...pinned, ...rest];
  }, [sort]);
  const q = query.trim().toLowerCase();
  const visibleVendors = vendors.filter((vendor) => !q || `${vendor.name} ${vendor.desc} ${vendor.models.map((m) => m.name).join(" ")}`.toLowerCase().includes(q));

  const selectScene = (sceneId: string): void => {
    // 切场景：提示词换成该场景最后保存的版本（没有就默认）；姿态是按场景给的，跟着清空。
    const nextPrompt = decodePromptHistory(settings.imagePromptHistory).find((entry) => entry.scene === sceneId)?.text ?? "";
    patch({ imageScene: sceneId, imagePose: "", imagePrompt: nextPrompt });
    setPromptDraft(nextPrompt || sceneById(sceneId).prompt);
  };

  return (
    <Sheet toast={toast} visible={visible} title="图片管理" subtitle="场景 · 姿态 · 模型 · 提示词" onClose={onClose}>
      <Text style={styles.notWired}>出图任务还没接上这些设置，现在只保存你的偏好。</Text>
      <SheetTabs
        tabs={[{ id: "model", name: "模型" }, { id: "scene", name: "生成场景" }, { id: "pose", name: "人物姿态" }, { id: "prompt", name: "提示词" }, { id: "param", name: "参数" }]}
        value={tab}
        onChange={onTab}
      />
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.panel} keyboardShouldPersistTaps="handled">
        {tab === "model" ? (
          <>
            <View style={styles.search}>
              <Svg width={15} height={15} viewBox="0 0 24 24" opacity={0.4}>
                <Circle cx={11} cy={11} r={7} stroke="#1a1a1a" strokeWidth={2.2} fill="none" />
                <Path d="M21 21l-4.3-4.3" stroke="#1a1a1a" strokeWidth={2.2} strokeLinecap="round" />
              </Svg>
              <TextInput value={query} onChangeText={setQuery} placeholder="搜索厂商或模型..." placeholderTextColor="#aaa" style={styles.searchInput} />
              {query ? (
                <Pressable accessibilityLabel="清除搜索" onPress={() => setQuery("")} style={styles.searchClear}><Text style={styles.searchClearText}>✕</Text></Pressable>
              ) : null}
            </View>
            <View style={styles.sortBar}>
              <Text style={styles.sortLabel}>排序</Text>
              {([["quality", "质量", "↓"], ["price", "价格", "↑"], ["popular", "热门", "↓"]] as const).map(([id, label, arrow]) => (
                <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: sort === id }} onPress={() => setSort(id)} style={[styles.sortChip, sort === id && styles.sortChipActive]}>
                  <Text style={[styles.sortChipText, sort === id && styles.sortChipTextActive]}>{label} <Text style={styles.sortArrow}>{arrow}</Text></Text>
                </Pressable>
              ))}
            </View>
            <GroupTitle title="模型厂商" />
            {visibleVendors.map((item) => {
              const index = vendors.indexOf(item);
              const selectedVendor = settings.imageVendorPref === item.id;
              return (
                <View key={item.id} style={[styles.vendorCard, selectedVendor && styles.vendorCardSelected]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedVendor }}
                    onPress={() => patch({ imageVendorPref: item.id, imageModelPref: item.models[0]?.name ?? "" })}
                    style={styles.vendorHead}
                  >
                    <View style={[styles.vendorLogo, { backgroundColor: item.logoBg }]}>
                      <SvgXml xml={item.logoXml} width={18} height={18} />
                    </View>
                    <View style={styles.vendorInfo}>
                      <View style={styles.vendorNameRow}>
                        <Text style={styles.vendorName}>{item.name}</Text>
                        {item.recommend ? <Text style={styles.recommendBadge}>推荐</Text> : null}
                      </View>
                      <Text style={styles.vendorDesc}>{item.desc}</Text>
                    </View>
                    <View style={[styles.check, selectedVendor && styles.checkOn]}>{selectedVendor ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                  </Pressable>
                  {!item.pinned ? (
                    <Text style={[styles.rank, index === 1 ? styles.rank1 : index === 2 ? styles.rank2 : index === 3 ? styles.rank3 : null]}>#{index}</Text>
                  ) : null}
                  {item.models.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modelRow} contentContainerStyle={styles.modelRowContent}>
                      {item.models.map((model) => {
                        const selectedModel = selectedVendor && settings.imageModelPref === model.name;
                        return (
                          <Pressable
                            key={model.name}
                            accessibilityRole="button"
                            accessibilityState={{ selected: selectedModel }}
                            onPress={() => patch({ imageVendorPref: item.id, imageModelPref: model.name }, `已选「${model.name}」`)}
                            style={[styles.modelChip, selectedModel && styles.modelChipSelected]}
                          >
                            <View style={styles.modelChipNameRow}>
                              <Text numberOfLines={1} style={styles.modelChipName}>{model.name}</Text>
                              {model.tag ? <Text style={styles.modelTag}>{model.tag}</Text> : null}
                            </View>
                            <Text numberOfLines={1} style={[styles.modelPrice, model.subscription && styles.modelPriceSub]}>{model.price}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}
                </View>
              );
            })}
            {visibleVendors.length === 0 ? <Text style={styles.empty}>没有找到匹配的厂商或模型</Text> : null}
            <View style={styles.priceNotice}>
              <Text style={styles.priceNoticeIcon}>💡</Text>
              <Text style={styles.priceNoticeText}>图片生成费用由用户自行承担。价格为单位生成成本，实际扣费以各厂商官方计费为准。</Text>
            </View>
          </>
        ) : tab === "scene" ? (
          <>
            <GroupTitle first title="选择场景" />
            <View style={styles.grid3}>
              {AI_SCENES.map((item) => {
                const selected = item.id === scene.id;
                return (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => selectScene(item.id)} style={[styles.sceneTile, selected && styles.sceneTileSelected]}>
                    <GradientFill id={`scene-${item.id}`} from={item.colors[0]} to={item.colors[1]} radius={12} />
                    {selected ? <View style={styles.sceneCheck}><Text style={styles.sceneCheckText}>✓</Text></View> : null}
                    <Text style={styles.sceneIcon}>{item.icon}</Text>
                    <Text numberOfLines={2} style={[styles.sceneName, isDark(item.colors[0]) && styles.sceneNameDark]}>{item.name}</Text>
                    <Text numberOfLines={2} style={[styles.sceneDesc, isDark(item.colors[0]) && styles.sceneDescDark]}>{item.desc}</Text>
                  </Pressable>
                );
              })}
            </View>
            <GroupTitle title="场景视觉要素" hint={scene.name} />
            <View style={styles.chipsWrap}>{scene.elements.map((element) => <Chip key={element} static label={element} selected />)}</View>
          </>
        ) : tab === "pose" ? (
          <>
            <GroupTitle first title="姿态模板" hint={scene.name} />
            <View style={styles.grid3}>
              {poses.map((item) => {
                const selected = item.id === settings.imagePose;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => patch({ imagePose: selected ? "" : item.id }, selected ? undefined : `已选姿态「${item.name}」`)}
                    style={[styles.poseTile, selected && styles.poseTileSelected]}
                  >
                    <View style={[styles.poseIcon, selected && styles.poseIconSelected]}>
                      <SvgXml xml={AI_POSE_ICONS[item.id] ?? AI_POSE_ICONS.hand_face!} width={26} height={26} color={selected ? "#ffffff" : "#888888"} />
                    </View>
                    <Text style={styles.poseName}>{item.name}</Text>
                    <Text style={[styles.poseHint, selected && styles.poseHintSelected]}>{item.hint}</Text>
                  </Pressable>
                );
              })}
            </View>
            <GroupTitle title="运镜风格" />
            <View style={styles.grid2}>
              {AI_CAMERA_MOVES.map((item) => {
                const selected = item.id === settings.imageCamera;
                return (
                  <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => patch({ imageCamera: item.id }, `已选运镜「${item.name}」`)} style={[styles.cameraCard, selected && styles.cameraCardSelected]}>
                    <View style={[styles.cameraIcon, selected && styles.cameraIconSelected]}>
                      <SvgXml xml={AI_CAMERA_ICONS[item.id]!} width={20} height={20} color={selected ? "#ffffff" : "#888888"} />
                    </View>
                    <View style={styles.cameraInfo}>
                      <Text style={styles.cameraName}>{item.name}</Text>
                      <Text style={[styles.cameraDesc, selected && styles.cameraDescSelected]}>{item.desc}</Text>
                    </View>
                    <View style={[styles.motionBar, (selected || item.id === "static") && styles.motionBarOn]} />
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : tab === "prompt" ? (
          <>
            <GroupTitle first title="当前提示词" hint={scene.name} />
            <View style={styles.promptEditor}>
              <TextInput multiline value={promptDraft} onChangeText={setPromptDraft} placeholder="输入提示词模板..." placeholderTextColor="#aaa" style={styles.promptInput} textAlignVertical="top" />
              <View style={styles.promptActions}>
                <Pressable accessibilityRole="button" onPress={() => { setPromptDraft(scene.prompt); patch({ imagePrompt: "" }, "已重置为默认提示词"); }} style={[styles.promptBtn, styles.promptBtnReset]}>
                  <Text style={styles.promptBtnResetText}>重置默认</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={!promptDraft.trim()}
                  onPress={() => {
                    const entry = encodePromptHistoryEntry({ scene: scene.id, text: promptDraft, at: new Date().toISOString() });
                    patch({ imagePrompt: promptDraft, imagePromptHistory: [entry, ...settings.imagePromptHistory].slice(0, 20) }, "提示词已保存");
                  }}
                  style={[styles.promptBtn, styles.promptBtnSave, !promptDraft.trim() && { opacity: 0.4 }]}
                >
                  <Text style={styles.promptBtnSaveText}>保存并使用</Text>
                </Pressable>
              </View>
              <Text style={styles.promptHint}>💡 用 <Text style={styles.promptCode}>{"{变量}"}</Text> 让 AI 自动填充人物、饮品、菜品等</Text>
            </View>
            <GroupTitle title="历史版本" hint="点击可恢复" />
            {history.length === 0 ? (
              <Text style={styles.historyEmpty}>暂无历史记录</Text>
            ) : (
              <View style={styles.historyList}>
                {history.slice(0, 10).map((entry, index) => (
                  <Pressable key={`${entry.at}-${index}`} accessibilityRole="button" onPress={() => { setPromptDraft(entry.text); patch({ imagePrompt: entry.text }, "已恢复历史版本"); }} style={styles.historyItem}>
                    <Text style={styles.historyTime}>{historyTime(entry.at)}</Text>
                    <Text numberOfLines={2} style={styles.historyText}>{entry.text}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <GroupTitle first title="尺寸比例" hint="默认黄金比例" />
            <View style={styles.chipsWrap}>{ASPECTS.map((item) => <Chip key={item.id} label={item.name} selected={settings.imageAspect === item.id} onPress={() => patch({ imageAspect: item.id })} />)}</View>
            <GroupTitle title="输出精度" />
            <View style={styles.chipsWrap}>{QUALITIES.map((item) => <Chip key={item.id} label={item.name} selected={settings.imageQuality === item.id} onPress={() => patch({ imageQuality: item.id })} />)}</View>
            <GroupTitle title="形象绑定" />
            <View style={styles.optionList}>
              <OptionItem
                icon="👤"
                name={imageCount > 0 ? "已绑定你的形象" : "还没有绑定形象"}
                desc={imageCount > 0 ? "用你的授权照片生成" : "去 AI 分身上传授权照片"}
                selected={imageCount > 0}
                onPress={() => { if (onOpenImageIdentity) onOpenImageIdentity(); else showToast("形象库"); }}
              />
            </View>
            <View style={styles.paramPreview}>
              <Text style={styles.paramItem}>📐 <Text style={styles.paramStrong}>{ASPECTS.find((a) => a.id === settings.imageAspect)?.name ?? "—"}</Text></Text>
              <Text style={styles.paramItem}>🎯 <Text style={styles.paramStrong}>{QUALITIES.find((a) => a.id === settings.imageQuality)?.name ?? "—"}</Text></Text>
              <Text style={styles.paramItem}>🎬 <Text style={styles.paramStrong}>{scene.name}</Text></Text>
              <Text style={styles.paramItem}>🧍 <Text style={styles.paramStrong}>{pose?.name ?? "—"}</Text></Text>
              <Text style={styles.paramItem}>🎥 <Text style={styles.paramStrong}>{camera?.name ?? "—"}</Text></Text>
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

function isDark(hex: string): boolean {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 110;
}

// ---------------------------------------------------------------- 动态管理

function PostSheet({ toast, visible, settings, patch, onClose }: { toast: React.ReactNode; visible: boolean; settings: AiEngineSettings; patch: PatchFn; onClose: () => void }): React.JSX.Element {
  const toggleTopic = (topic: string): void => {
    const has = settings.postTopics.includes(topic);
    patch({ postTopics: has ? settings.postTopics.filter((item) => item !== topic) : [...settings.postTopics, topic] });
  };
  return (
    <Sheet toast={toast} visible={visible} title="动态管理" subtitle="AI 替你发什么" onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.panel}>
        <GroupTitle first title="发帖节奏" />
        <View style={styles.optionList}>
          {POST_PACES.map((item) => <OptionItem key={item.id} icon={item.icon} name={item.name} desc={item.desc} selected={settings.postPace === item.id} onPress={() => patch({ postPace: item.id })} />)}
        </View>
        <GroupTitle title="内容偏好" />
        <View style={styles.chipsWrap}>{POST_TOPICS.map((topic) => <Chip key={topic} label={topic} selected={settings.postTopics.includes(topic)} onPress={() => toggleTopic(topic)} />)}</View>
        <GroupTitle title="发布权限" />
        <View style={styles.optionList}>
          {POST_PERMISSIONS.map((item) => <OptionItem key={item.id} icon={item.icon} name={item.name} selected={settings.postPermission === item.id} onPress={() => patch({ postPermission: item.id }, "已保存")} />)}
        </View>
        <Text style={[styles.notWired, styles.notWiredInline]}>自动发帖任务尚未上线：现在只保存你的偏好，不会替你发帖。</Text>
      </ScrollView>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 样式（照原型 CSS）

const INK = "#1a1a1a";
const styles = StyleSheet.create({
  root: { backgroundColor: "#fafafa", flex: 1 },
  nav: { alignItems: "center", flexDirection: "row", gap: 10, paddingBottom: 8, paddingHorizontal: 20, paddingTop: 16 },
  navBack: { width: 24 },
  navBackText: { color: INK, fontSize: 20 },
  navTitle: { color: INK, flex: 1, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  logo: { alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6 },
  logoDot: { borderColor: "#fafafa", borderRadius: 5, borderWidth: 2, height: 10, position: "absolute", right: -3, top: -3, width: 10 },
  pauseBtn: { alignItems: "center", backgroundColor: "#fdecec", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  pauseBtnPaused: { backgroundColor: "#eef7f0" },
  subtitle: { alignItems: "center", flexDirection: "row", gap: 6, paddingBottom: 16, paddingHorizontal: 20 },
  subtitleDot: { backgroundColor: "#4caf7d", borderRadius: 3, height: 5, width: 5 },
  dotOff: { backgroundColor: "#cccccc" },
  subtitleText: { color: "#888", fontSize: 12.5, fontWeight: "500" },
  subtitleTextPaused: { color: "#bbb" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },
  statusCard: { borderRadius: 20, marginBottom: 24, overflow: "hidden", padding: 18 },
  statusGlow: { position: "absolute", right: -30, top: -50 },
  statusHead: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 14 },
  statusDot: { backgroundColor: "#4caf7d", borderRadius: 3, height: 6, width: 6 },
  statusLabel: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "700" },
  statusTime: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", marginLeft: "auto" },
  statusNums: { flexDirection: "row", gap: 16 },
  statusNum: { flex: 1, minWidth: 0 },
  snVal: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginBottom: 6 },
  snLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "600" },
  sectionTitle: { color: INK, fontSize: 13, fontWeight: "800", letterSpacing: -0.1, marginBottom: 10, paddingLeft: 2 },
  manageList: { gap: 8, marginBottom: 22 },
  manageCard: { alignItems: "center", backgroundColor: "#fff", borderColor: "#f0f0f0", borderRadius: 16, borderWidth: 1.5, flexDirection: "row", gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  manageCardPaused: { opacity: 0.5 },
  manageIcon: { alignItems: "center", borderRadius: 13, height: 42, justifyContent: "center", overflow: "hidden", width: 42 },
  manageInfo: { flex: 1, minWidth: 0 },
  manageNameRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 4 },
  manageName: { color: INK, fontSize: 14.5, fontWeight: "800" },
  badge: { borderRadius: 6, fontSize: 11, fontWeight: "800", letterSpacing: 0.2, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
  badgeRunning: { backgroundColor: "#eef7f0", color: "#3d7a4e" },
  badgeOff: { backgroundColor: "#f5f5f5", color: "#999" },
  badgeConfirm: { backgroundColor: "#fff8e6", color: "#a06a2c" },
  badgePaused: { backgroundColor: "#f0f0f0", color: "#aaa" },
  manageActivity: { color: "#999", fontSize: 11, fontWeight: "500" },
  manageArrow: { color: "#ccc", fontSize: 16 },
  retry: { alignSelf: "center", marginBottom: 12, paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { color: INK, fontSize: 13, fontWeight: "700" },
  version: { color: "#ccc", fontSize: 11, fontWeight: "600", letterSpacing: 0.3, paddingVertical: 8, textAlign: "center" },
  toast: { alignSelf: "center", backgroundColor: "#000", borderRadius: 14, bottom: 100, paddingHorizontal: 22, paddingVertical: 12, position: "absolute" },
  toastText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  overlay: { backgroundColor: "rgba(0,0,0,0.4)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  sheetHandle: { alignSelf: "center", backgroundColor: "#e0e0e0", borderRadius: 2, height: 4, marginBottom: 6, marginTop: 10, width: 36 },
  sheetHeader: { alignItems: "center", borderBottomColor: "#f0f0f0", borderBottomWidth: 1, paddingBottom: 14, paddingHorizontal: 20, paddingTop: 6 },
  sheetTitle: { color: INK, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  sheetSub: { color: "#888", fontSize: 12, fontWeight: "500" },
  sheetScroll: { flexGrow: 0 },
  tabsWrap: { borderBottomColor: "#f0f0f0", borderBottomWidth: 1 },
  tabs: { gap: 6, paddingHorizontal: 20, paddingTop: 14 },
  tab: { paddingBottom: 12, paddingHorizontal: 14, paddingTop: 10 },
  tabText: { color: "#aaa", fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: INK },
  tabBar: { backgroundColor: INK, borderTopLeftRadius: 2, borderTopRightRadius: 2, bottom: -1, height: 2, left: 8, position: "absolute", right: 8 },
  panel: { paddingBottom: 8, paddingHorizontal: 20, paddingTop: 16 },
  groupTitle: { color: "#888", fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  groupTitleGap: { marginTop: 18 },
  groupHint: { color: "#bbb", fontSize: 11, fontWeight: "600", letterSpacing: 0 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "#f5f5f5", borderColor: "transparent", borderRadius: 18, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 9 },
  chipSelected: { backgroundColor: INK, borderColor: INK },
  chipText: { color: "#555", fontSize: 12.5, fontWeight: "700" },
  chipTextSelected: { color: "#fff" },
  optionList: { gap: 6 },
  option: { alignItems: "center", backgroundColor: "#fafafa", borderColor: "transparent", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  optionSelected: { backgroundColor: "#fff", borderColor: INK },
  optionIcon: { fontSize: 20, textAlign: "center", width: 26 },
  optionInfo: { flex: 1, minWidth: 0 },
  optionName: { color: INK, fontSize: 13.5, fontWeight: "700", marginBottom: 2 },
  optionDesc: { color: "#888", fontSize: 11, fontWeight: "500", lineHeight: 15 },
  check: { alignItems: "center", borderColor: "#ddd", borderRadius: 10, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  checkOn: { backgroundColor: INK, borderColor: INK },
  checkMark: { color: "#fff", fontSize: 11, fontWeight: "800" },
  search: { alignItems: "center", backgroundColor: "#f5f5f5", borderRadius: 12, flexDirection: "row", gap: 10, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 11 },
  searchInput: { color: INK, flex: 1, fontSize: 13.5, minWidth: 0, padding: 0 },
  searchClear: { alignItems: "center", backgroundColor: "#ddd", borderRadius: 9, height: 18, justifyContent: "center", width: 18 },
  searchClearText: { color: "#fff", fontSize: 11 },
  sortBar: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 14 },
  sortLabel: { color: "#bbb", fontSize: 11, fontWeight: "700", letterSpacing: 0.3, marginRight: 2 },
  sortChip: { backgroundColor: "#f5f5f5", borderRadius: 15, paddingHorizontal: 13, paddingVertical: 7 },
  sortChipActive: { backgroundColor: INK },
  sortChipText: { color: "#666", fontSize: 12, fontWeight: "700" },
  sortChipTextActive: { color: "#fff" },
  sortArrow: { fontSize: 11 },
  vendorCard: { backgroundColor: "#fff", borderColor: "#f0f0f0", borderRadius: 16, borderWidth: 1.5, marginBottom: 8, padding: 14 },
  vendorCardSelected: { borderColor: INK, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8 },
  vendorHead: { alignItems: "center", flexDirection: "row", gap: 12 },
  vendorLogo: { alignItems: "center", borderRadius: 8, height: 30, justifyContent: "center", overflow: "hidden", width: 30 },
  vendorInfo: { flex: 1, minWidth: 0, paddingRight: 40 },
  vendorNameRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 3 },
  vendorName: { color: INK, fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  vendorDesc: { color: "#999", fontSize: 11, fontWeight: "500" },
  recommendBadge: { backgroundColor: "#eef7f0", borderRadius: 5, color: "#3d7a4e", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 2 },
  rank: { backgroundColor: "#f5f5f5", borderRadius: 5, color: "#999", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2, position: "absolute", right: 44, top: 14 },
  rank1: { backgroundColor: "#ffc800", color: "#7a5b00" },
  rank2: { backgroundColor: "#d8d8d8", color: "#555" },
  rank3: { backgroundColor: "#e5b98c", color: "#6b3a10" },
  modelRow: { borderTopColor: "#f0f0f0", borderTopWidth: 1, marginTop: 12, paddingTop: 12 },
  modelRowContent: { gap: 8 },
  modelChip: { backgroundColor: "#fafafa", borderColor: "transparent", borderRadius: 10, borderWidth: 1.5, maxWidth: 160, minWidth: 118, paddingHorizontal: 12, paddingVertical: 8 },
  modelChipSelected: { backgroundColor: "#fff", borderColor: INK },
  modelChipNameRow: { alignItems: "center", flexDirection: "row", gap: 4, marginBottom: 4 },
  modelChipName: { color: INK, flexShrink: 1, fontSize: 12, fontWeight: "800" },
  modelTag: { backgroundColor: "#fdecec", borderRadius: 4, color: "#e5484d", fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: 5, paddingVertical: 1 },
  modelPrice: { color: "#3d7a4e", fontSize: 11, fontWeight: "800" },
  modelPriceSub: { color: "#3b6fe0" },
  empty: { color: "#bbb", fontSize: 13, fontWeight: "500", paddingVertical: 40, textAlign: "center" },
  priceNotice: { backgroundColor: "#fff8e6", borderRadius: 10, flexDirection: "row", gap: 6, marginTop: 12, paddingHorizontal: 14, paddingVertical: 10 },
  priceNoticeIcon: { fontSize: 13 },
  priceNoticeText: { color: "#a06a2c", flex: 1, fontSize: 11, fontWeight: "600", lineHeight: 16 },
  grid3: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sceneTile: { alignItems: "center", aspectRatio: 1, borderColor: "transparent", borderRadius: 14, borderWidth: 2, gap: 6, justifyContent: "center", overflow: "hidden", padding: 8, width: "31.5%" },
  sceneTileSelected: { borderColor: INK },
  sceneCheck: { alignItems: "center", backgroundColor: INK, borderRadius: 9, height: 18, justifyContent: "center", position: "absolute", right: 6, top: 6, width: 18 },
  sceneCheckText: { color: "#fff", fontSize: 11 },
  sceneIcon: { fontSize: 26 },
  sceneName: { color: INK, fontSize: 11, fontWeight: "800", letterSpacing: -0.2, textAlign: "center" },
  sceneNameDark: { color: "#fff" },
  sceneDesc: { color: "#999", fontSize: 11, fontWeight: "600", textAlign: "center" },
  sceneDescDark: { color: "rgba(255,255,255,0.7)" },
  poseTile: { alignItems: "center", backgroundColor: "#fafafa", borderColor: "transparent", borderRadius: 12, borderWidth: 1.5, gap: 5, paddingHorizontal: 8, paddingVertical: 10, width: "31.5%" },
  poseTileSelected: { backgroundColor: "#fff", borderColor: INK },
  poseIcon: { alignItems: "center", backgroundColor: "#f5f5f5", borderRadius: 10, height: 44, justifyContent: "center", marginBottom: 2, width: 44 },
  poseIconSelected: { backgroundColor: INK },
  poseName: { color: INK, fontSize: 11, fontWeight: "800", textAlign: "center" },
  poseHint: { color: "#aaa", fontSize: 11, fontWeight: "600", textAlign: "center" },
  poseHintSelected: { color: "#666" },
  cameraCard: { alignItems: "center", backgroundColor: "#fafafa", borderColor: "transparent", borderRadius: 14, borderWidth: 1.5, flexDirection: "row", gap: 10, overflow: "hidden", padding: 12, width: "48.5%" },
  cameraCardSelected: { backgroundColor: "#fff", borderColor: INK },
  cameraIcon: { alignItems: "center", backgroundColor: "#f0f0f0", borderRadius: 10, height: 36, justifyContent: "center", width: 36 },
  cameraIconSelected: { backgroundColor: INK },
  cameraInfo: { flex: 1, minWidth: 0 },
  cameraName: { color: INK, fontSize: 12, fontWeight: "800", marginBottom: 2 },
  cameraDesc: { color: "#999", fontSize: 11, fontWeight: "500" },
  cameraDescSelected: { color: "#666" },
  motionBar: { backgroundColor: "#e0e0e0", bottom: 0, height: 3, left: 0, position: "absolute", right: 0 },
  motionBarOn: { backgroundColor: INK },
  promptEditor: { backgroundColor: "#fafafa", borderRadius: 14, padding: 12 },
  promptInput: { backgroundColor: "#fff", borderColor: "#f0f0f0", borderRadius: 10, borderWidth: 1.5, color: INK, fontSize: 12, lineHeight: 20, minHeight: 140, paddingHorizontal: 14, paddingVertical: 12 },
  promptActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  promptBtn: { alignItems: "center", borderRadius: 10, flex: 1, paddingHorizontal: 14, paddingVertical: 10 },
  promptBtnReset: { backgroundColor: "#f0f0f0" },
  promptBtnResetText: { color: "#666", fontSize: 12.5, fontWeight: "700" },
  promptBtnSave: { backgroundColor: INK },
  promptBtnSaveText: { color: "#fff", fontSize: 12.5, fontWeight: "700" },
  promptHint: { color: "#aaa", fontSize: 11, fontWeight: "600", lineHeight: 16, marginTop: 10, textAlign: "center" },
  promptCode: { backgroundColor: "#f0f0f0", color: "#666", fontWeight: "700" },
  historyList: { gap: 6 },
  historyItem: { alignItems: "flex-start", backgroundColor: "#fff", borderColor: "#f0f0f0", borderRadius: 10, borderWidth: 1.5, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  historyTime: { color: "#bbb", fontSize: 11, fontWeight: "700", minWidth: 42, paddingTop: 1 },
  historyText: { color: "#666", flex: 1, fontSize: 11, fontWeight: "500", lineHeight: 16 },
  historyEmpty: { color: "#ccc", fontSize: 12, fontWeight: "500", paddingHorizontal: 20, paddingVertical: 24, textAlign: "center" },
  notWired: { backgroundColor: "#fff8e6", color: "#a06a2c", fontSize: 11, fontWeight: "600", marginHorizontal: 20, marginTop: 12, overflow: "hidden", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  notWiredInline: { marginHorizontal: 0, marginTop: 14 },
  paramPreview: { backgroundColor: "#f3f2ff", borderRadius: 12, flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18, paddingHorizontal: 14, paddingVertical: 12 },
  paramItem: { color: "#5a6a9a", fontSize: 11, fontWeight: "600" },
  paramStrong: { color: INK, fontWeight: "800" },
});
