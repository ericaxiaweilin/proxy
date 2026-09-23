import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Svg, Circle, Line } from "react-native-svg";
import { AiEngineClient, type AiEngineSettings, type AiPermission, type SecureSessionStoreLike } from "../ai-engine-client";
import type { TransportResponse, TransportRequest } from "../auth-client";
import { formatRelativeTime } from "../composer-body";
import { ProxyIcon } from "../components/proxy-icon";
import { color } from "../theme";

// AIManagementSurface — 「我的 → 账户 → AI 管理」全量落地（AI-MANAGE-002）。
// 原型：deepseek_html_20260923_83b40b。
//
// 与 Rev248 诚实切片的差别：暂停 / Token / 三个设置 sheet 都接真服务端
// （Get/UpdateAiEngineSettings + 当月 token usage）。数从服务端来，不编
// 120K/200K 上限；没有自动发帖 worker，动态卡 badge 只反映权限设置本身
// （auto 显示「全自动」不虚报「运行中」）。

type AuthChannel = {
  request(path: string, init: { method: TransportRequest["method"]; body?: unknown }): Promise<TransportResponse>;
};

export function AILogo({ active }: { active: boolean }): React.JSX.Element {
  return (
    <View style={styles.logo} accessibilityLabel={active ? "AI 分身已激活" : "AI 分身未激活"}>
      <Svg width={20} height={20} viewBox="0 0 24 24">
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
      <View style={[styles.logoDot, active ? styles.logoDotOn : styles.logoDotOff]} />
    </View>
  );
}

const SCENES: ReadonlyArray<{ id: string; name: string }> = [
  { id: "cafe", name: "暖调咖啡厅" },
  { id: "restaurant", name: "高级餐厅" },
  { id: "dessert", name: "文青甜品店" },
  { id: "izakaya", name: "深夜居酒屋" },
  { id: "brunch", name: "自然光 Brunch" },
  { id: "night", name: "城市夜景" },
];

const POSES: Readonly<Record<string, ReadonlyArray<{ id: string; name: string }>>> = {
  cafe: [
    { id: "hand_face", name: "手托脸" },
    { id: "look_away", name: "侧脸望远处" },
    { id: "coffee_hold", name: "手托咖啡" },
    { id: "lean_forward", name: "前倾靠桌" },
    { id: "cross_arm", name: "X交叉" },
    { id: "laugh", name: "低头笑" },
  ],
  restaurant: [
    { id: "cheers", name: "举杯" },
    { id: "taste", name: "品尝" },
    { id: "lean_back", name: "靠椅背" },
    { id: "table_hand", name: "手搭桌沿" },
    { id: "look_menu", name: "看菜单" },
    { id: "napkin", name: "整理餐巾" },
  ],
  dessert: [
    { id: "bite", name: "咬甜品" },
    { id: "hold_plate", name: "端盘展示" },
    { id: "point", name: "手指甜品" },
    { id: "window", name: "窗边侧坐" },
    { id: "straw", name: "咬吸管" },
    { id: "selfie", name: "举手机自拍" },
  ],
  izakaya: [
    { id: "side_face", name: "侧脸对灯笼" },
    { id: "raise_cup", name: "举杯畅饮" },
    { id: "elbow_bar", name: "手肘撑吧台" },
    { id: "look_down", name: "低头看杯" },
    { id: "back_view", name: "回头" },
    { id: "laugh_close", name: "大笑特写" },
  ],
  brunch: [
    { id: "fork_food", name: "叉食物" },
    { id: "pour", name: "倒饮品" },
    { id: "sun_face", name: "迎光闭眼" },
    { id: "cross_leg", name: "翘腿侧坐" },
    { id: "hands_up", name: "双手举食物" },
    { id: "walk_in", name: "走进画面" },
  ],
  night: [
    { id: "neon_side", name: "霓虹侧脸" },
    { id: "look_up", name: "抬头看灯" },
    { id: "walk_street", name: "街头行走" },
    { id: "back_neon", name: "背对霓虹" },
    { id: "sit_step", name: "坐台阶" },
    { id: "umbrella", name: "撑伞" },
  ],
};

const CAMERA_MOVES: ReadonlyArray<{ id: string; name: string; desc: string }> = [
  { id: "static", name: "静态抓拍", desc: "固定机位，自然状态" },
  { id: "push", name: "慢推近", desc: "镜头缓缓推近，聚焦细节" },
  { id: "pull", name: "慢拉远", desc: "镜头缓缓拉远，交代环境" },
  { id: "pan", name: "横摇", desc: "左右平移，扫过场景" },
  { id: "track", name: "跟随运镜", desc: "跟随人物移动" },
  { id: "crane", name: "升降镜头", desc: "上下移动，展现空间" },
];

// 厂商 = 偏好 ID，不是客户端直绑 provider（平台仍自己路由）。
const VENDORS: ReadonlyArray<{ id: string; name: string; desc: string; models: ReadonlyArray<{ id: string; name: string }> }> = [
  { id: "platform_default", name: "平台默认", desc: "系统自动选择最优厂商", models: [] },
  {
    id: "google",
    name: "Google",
    desc: "细节丰富 · 文字渲染强",
    models: [
      { id: "imagen_4", name: "Imagen 4" },
      { id: "imagen_4_fast", name: "Imagen 4 Fast" },
      { id: "imagen_3", name: "Imagen 3" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    desc: "通用性强 · 指令跟随好",
    models: [
      { id: "gpt_image_1", name: "GPT-Image-1" },
      { id: "gpt_image_1_5", name: "GPT-Image-1.5" },
      { id: "dall_e_3", name: "DALL·E 3" },
    ],
  },
  {
    id: "midjourney",
    name: "Midjourney",
    desc: "审美强 · 风格化出图",
    models: [
      { id: "mj_v7", name: "MJ v7" },
      { id: "mj_v6_1", name: "MJ v6.1" },
      { id: "niji_6", name: "Niji 6" },
    ],
  },
  {
    id: "bfl",
    name: "Black Forest Labs",
    desc: "写实细节 · 快速出图",
    models: [
      { id: "flux_2_pro", name: "FLUX.2 Pro" },
      { id: "flux_2_max", name: "FLUX.2 Max" },
      { id: "flux_1_schnell", name: "FLUX.1 Schnell" },
    ],
  },
];

const TOPIC_PRESETS = ["胶片", "咖啡", "City Walk", "看展", "美食"] as const;

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

const RHYTHMS: ReadonlyArray<{ id: AiEngineSettings["chatRhythm"]; name: string; desc: string }> = [
  { id: "instant", name: "秒回", desc: "收到消息立刻回" },
  { id: "human_3_5", name: "延迟 3-5 秒", desc: "像真人一样稍等片刻再回" },
  { id: "human_10_30", name: "延迟 10-30 秒", desc: "不急着回，节奏更自然" },
  { id: "random", name: "随机", desc: "时快时慢，更像真人" },
];

const PERMISSIONS: ReadonlyArray<{ id: AiPermission; name: string; desc: string }> = [
  { id: "off", name: "关闭", desc: "不替你回消息" },
  { id: "confirm", name: "每次确认", desc: "AI 起草，你点「发」才发" },
  { id: "auto", name: "全自动", desc: "AI 直接替你回" },
];

const POST_PACES: ReadonlyArray<{ id: AiEngineSettings["postPace"]; name: string; desc: string; icon: string }> = [
  { id: "daily", name: "每天 1 条", desc: "保持活跃", icon: "🔥" },
  { id: "every_3_days", name: "每 3 天 1 条", desc: "自然节奏，推荐", icon: "⚖️" },
  { id: "weekly", name: "每周 1 条", desc: "低频但精致", icon: "🐢" },
];

function permissionBadge(permission: AiPermission): string {
  if (permission === "off") return "关闭";
  if (permission === "confirm") return "每次确认";
  return "运行中";
}

function postPermissionBadge(permission: AiPermission): string {
  if (permission === "off") return "关闭";
  if (permission === "confirm") return "每次确认";
  // 没有自动发帖 worker：badge 只说设置本身，不虚报「运行中」。
  return "全自动";
}

function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (total >= 1_000) return `${(total / 1_000).toFixed(total >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(total);
}

function vendorLabel(id: string): string {
  return VENDORS.find((vendor) => vendor.id === id)?.name ?? "平台默认";
}

function sceneLabel(id: string): string {
  return SCENES.find((scene) => scene.id === id)?.name ?? "暖调咖啡厅";
}

type SheetKind = "chat" | "image" | "post" | undefined;
type ChatTab = "style" | "rhythm" | "perm";
type ImageTab = "model" | "scene" | "pose" | "prompt" | "param";

export function AIManagementSurface({
  onBack,
  viewerAccountId,
  authClient,
  secureSessionStore,
  imageCount,
  videoCount,
  postCount,
  lastPostAt,
  onOpenImageManage,
  onOpenPostManage,
}: {
  onBack: () => void;
  viewerAccountId: string | undefined;
  authClient: AuthChannel;
  secureSessionStore: SecureSessionStoreLike;
  imageCount: number;
  videoCount: number;
  postCount: number;
  lastPostAt?: string | undefined;
  onOpenImageManage: () => void;
  onOpenPostManage: () => void;
}): React.JSX.Element {
  const engineClient = useMemo(
    () => new AiEngineClient({ authClient, secureSessionStore }),
    [authClient, secureSessionStore],
  );
  const [settings, setSettings] = useState<AiEngineSettings | undefined>(undefined);
  const [tokenTotal, setTokenTotal] = useState(0);
  const [tokenPeriod, setTokenPeriod] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [sheet, setSheet] = useState<SheetKind>(undefined);
  const [chatTab, setChatTab] = useState<ChatTab>("style");
  const [imageTab, setImageTab] = useState<ImageTab>("model");
  const [promptDraft, setPromptDraft] = useState("");

  const load = useCallback(() => {
    if (!viewerAccountId) {
      setSettings(undefined);
      setTokenTotal(0);
      setLoadError(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await engineClient.read();
        if (!cancelled) {
          setSettings(snap.settings);
          setTokenTotal(snap.usage.promptTokens + snap.usage.outputTokens);
          setTokenPeriod(snap.period);
          setPromptDraft(snap.settings.imagePrompt);
          setLoadError(undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "AI 设置没读出来");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engineClient, viewerAccountId]);

  useEffect(() => load(), [load]);

  const patch = useCallback(
    async (next: Partial<AiEngineSettings>) => {
      if (!settings || busy) return;
      setBusy(true);
      setActionError(undefined);
      try {
        const saved = await engineClient.write(next);
        setSettings((current) => ({ ...(current ?? saved), ...saved }));
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "设置没保存成功");
      } finally {
        setBusy(false);
      }
    },
    [busy, engineClient, settings],
  );

  const togglePause = useCallback(() => {
    if (!settings) return;
    void patch({ paused: !settings.paused });
  }, [patch, settings]);

  const paused = settings?.paused ?? false;
  const statusTitle = paused ? "AI 已暂停" : settings ? "AI 运行中" : loadError ? "AI 设置未读出" : "读取中…";
  const statusSub = paused
    ? "点击右上角继续"
    : loadError
      ? loadError
      : settings
        ? "AI 正在替你工作"
        : "登录后读取服务端设置";

  const chatBadge = settings ? (paused ? "已暂停" : permissionBadge(settings.chatPermission)) : "…";
  const imageBadge = settings ? (paused ? "已暂停" : "运行中") : "…";
  const postBadge = settings ? (paused ? "已暂停" : postPermissionBadge(settings.postPermission)) : "…";

  const imageActivity = settings ? `${sceneLabel(settings.imageScene)} · ${vendorLabel(settings.imageVendorPref)}` : "读取中…";
  const postActivity = lastPostAt ? `上次发帖：${formatRelativeTime(lastPostAt)}` : postCount > 0 ? `${postCount} 条动态` : "还没有发过动态";

  return (
    <View style={styles.root}>
      <View style={styles.nav}>
        <Pressable accessibilityLabel="返回" onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <AILogo active={!paused && settings !== undefined} />
        <Text style={styles.title}>AI 管理</Text>
        <Pressable
          accessibilityLabel={paused ? "继续" : "暂停"}
          accessibilityRole="button"
          disabled={busy || !settings}
          onPress={togglePause}
          style={[styles.pauseBtn, paused && styles.pauseBtnPaused]}
        >
          <Text style={styles.pauseIcon}>{paused ? "▶" : "❚❚"}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.statusCard}>
          <View style={styles.statusHead}>
            <View style={[styles.statusDot, !paused && settings && styles.statusDotOn]} />
            <Text style={styles.statusLabel}>{statusTitle}</Text>
            <Text style={styles.statusTime}>{settings ? tokenPeriod : ""}</Text>
          </View>
          <Text style={styles.statusSub}>{statusSub}</Text>
          <View style={styles.nums}>
            <View style={styles.num}>
              <Text style={styles.numVal}>{settings ? formatTokens(tokenTotal) : "—"}</Text>
              <Text style={styles.numLabel}>本月 Token</Text>
            </View>
            <View style={styles.num}>
              <Text style={styles.numVal}>{imageCount}</Text>
              <Text style={styles.numLabel}>图片总数</Text>
            </View>
            <View style={styles.num}>
              <Text style={styles.numVal}>{videoCount}</Text>
              <Text style={styles.numLabel}>视频总数</Text>
            </View>
          </View>
        </View>

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

        <Text style={styles.sectionTitle}>管理项</Text>

        <Pressable
          accessibilityLabel="对话管理"
          disabled={!settings || busy}
          onPress={() => {
            setChatTab("style");
            setSheet("chat");
          }}
          style={[styles.card, paused && styles.cardDim]}
        >
          <View style={[styles.cardIcon, styles.cardIconBlue]}>
            <Text style={styles.cardEmoji}>💬</Text>
          </View>
          <View style={styles.cardText}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName}>对话管理</Text>
              <Text style={[styles.badge, paused ? styles.badgeOff : settings?.chatPermission === "auto" ? styles.badgeRunning : settings?.chatPermission === "off" ? styles.badgeOff : styles.badgeConfirm]}>
                {chatBadge}
              </Text>
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>
              {settings ? `语气 ${TONES.find((tone) => tone.id === settings.chatTone)?.name ?? ""} · ${RHYTHMS.find((r) => r.id === settings.chatRhythm)?.name ?? ""}` : "读取中…"}
            </Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>

        <Pressable
          accessibilityLabel="图片管理"
          disabled={!settings || busy}
          onPress={() => {
            setImageTab("model");
            setSheet("image");
          }}
          style={[styles.card, paused && styles.cardDim]}
        >
          <View style={[styles.cardIcon, styles.cardIconPurple]}>
            <Text style={styles.cardEmoji}>🖼️</Text>
          </View>
          <View style={styles.cardText}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName}>图片管理</Text>
              <Text style={[styles.badge, paused ? styles.badgeOff : styles.badgeRunning]}>{imageBadge}</Text>
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>
              {imageActivity}
            </Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>
        <Pressable accessibilityLabel="打开出图内容管理" onPress={onOpenImageManage} style={styles.linkRow}>
          <Text style={styles.linkText}>管理已生成图片</Text>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>

        <Pressable
          accessibilityLabel="动态管理"
          disabled={!settings || busy}
          onPress={() => setSheet("post")}
          style={[styles.card, paused && styles.cardDim]}
        >
          <View style={[styles.cardIcon, styles.cardIconGreen]}>
            <Text style={styles.cardEmoji}>✍️</Text>
          </View>
          <View style={styles.cardText}>
            <View style={styles.cardNameRow}>
              <Text style={styles.cardName}>动态管理</Text>
              <Text style={[styles.badge, paused ? styles.badgeOff : settings?.postPermission === "auto" ? styles.badgeRunning : settings?.postPermission === "off" ? styles.badgeOff : styles.badgeConfirm]}>
                {postBadge}
              </Text>
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>
              {postActivity}
            </Text>
          </View>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>
        <Pressable accessibilityLabel="打开动态内容管理" onPress={onOpenPostManage} style={styles.linkRow}>
          <Text style={styles.linkText}>管理已发动态</Text>
          <Text style={styles.cardArrow}>›</Text>
        </Pressable>

        <Text style={styles.version}>AI Engine v2.4 · 平台托管</Text>
      </ScrollView>

      <AiChatSheet
        visible={sheet === "chat"}
        busy={busy}
        settings={settings}
        tab={chatTab}
        onTab={setChatTab}
        onClose={() => setSheet(undefined)}
        onPatch={patch}
      />
      <AiImageSheet
        visible={sheet === "image"}
        busy={busy}
        settings={settings}
        tab={imageTab}
        onTab={setImageTab}
        promptDraft={promptDraft}
        onPromptDraft={setPromptDraft}
        onClose={() => setSheet(undefined)}
        onPatch={patch}
        onOpenTwin={onOpenImageManage}
      />
      <AiPostSheet
        visible={sheet === "post"}
        busy={busy}
        settings={settings}
        onClose={() => setSheet(undefined)}
        onPatch={patch}
      />
    </View>
  );
}

function SheetShell({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.backdrop}>
        <View onStartShouldSetResponder={() => true} style={styles.sheet}>
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Text style={styles.sheetSub}>{subtitle}</Text>
          </View>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function ChipRow({
  options,
  value,
  disabled,
  onPick,
  testID,
}: {
  options: ReadonlyArray<{ id: string; name: string }>;
  value: string;
  disabled?: boolean;
  onPick: (id: string) => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.chips} testID={testID}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityLabel={option.name}
            accessibilityState={{ selected: on }}
            disabled={disabled}
            onPress={() => onPick(option.id)}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{option.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionList({
  options,
  value,
  disabled,
  onPick,
}: {
  options: ReadonlyArray<{ id: string; name: string; desc: string; icon?: string }>;
  value: string;
  disabled?: boolean;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.optionList}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityLabel={option.name}
            accessibilityState={{ selected: on }}
            disabled={disabled}
            onPress={() => onPick(option.id)}
            style={[styles.optionItem, on && styles.optionOn]}
          >
            {option.icon ? <Text style={styles.optionIcon}>{option.icon}</Text> : null}
            <View style={styles.optionInfo}>
              <Text style={styles.optionName}>{option.name}</Text>
              <Text style={styles.optionDesc}>{option.desc}</Text>
            </View>
            {on ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function TabBar<T extends string>({
  tabs,
  active,
  onPick,
}: {
  tabs: ReadonlyArray<{ id: T; name: string }>;
  active: T;
  onPick: (id: T) => void;
}): React.JSX.Element {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityLabel={tab.name}
            accessibilityState={{ selected: on }}
            onPress={() => onPick(tab.id)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AiChatSheet({
  visible,
  busy,
  settings,
  tab,
  onTab,
  onClose,
  onPatch,
}: {
  visible: boolean;
  busy: boolean;
  settings: AiEngineSettings | undefined;
  tab: ChatTab;
  onTab: (tab: ChatTab) => void;
  onClose: () => void;
  onPatch: (patch: Partial<AiEngineSettings>) => Promise<void>;
}): React.JSX.Element | null {
  if (!settings) return null;
  return (
    <SheetShell visible={visible} title="对话管理" subtitle="AI 怎么替你聊天" onClose={onClose}>
      <TabBar
        tabs={[
          { id: "style", name: "风格" },
          { id: "rhythm", name: "节奏" },
          { id: "perm", name: "权限" },
        ]}
        active={tab}
        onPick={onTab}
      />
      {tab === "style" ? (
        <View>
          <Text style={styles.groupTitle}>语气</Text>
          <ChipRow
            options={TONES}
            value={settings.chatTone}
            disabled={busy}
            onPick={(id) => void onPatch({ chatTone: id as AiEngineSettings["chatTone"] })}
          />
          <Text style={styles.groupTitle}>回复长度</Text>
          <ChipRow
            options={LENGTHS}
            value={settings.chatReplyLength}
            disabled={busy}
            onPick={(id) => void onPatch({ chatReplyLength: id as AiEngineSettings["chatReplyLength"] })}
          />
          <Text style={styles.groupTitle}>emoji</Text>
          <ChipRow
            options={EMOJIS}
            value={settings.chatEmoji}
            disabled={busy}
            onPick={(id) => void onPatch({ chatEmoji: id as AiEngineSettings["chatEmoji"] })}
          />
        </View>
      ) : null}
      {tab === "rhythm" ? (
        <OptionList
          options={RHYTHMS.map((item) => ({ ...item }))}
          value={settings.chatRhythm}
          disabled={busy}
          onPick={(id) => void onPatch({ chatRhythm: id as AiEngineSettings["chatRhythm"] })}
        />
      ) : null}
      {tab === "perm" ? (
        <OptionList
          options={PERMISSIONS.map((item) => ({ ...item }))}
          value={settings.chatPermission}
          disabled={busy}
          onPick={(id) => void onPatch({ chatPermission: id as AiPermission })}
        />
      ) : null}
    </SheetShell>
  );
}

function AiImageSheet({
  visible,
  busy,
  settings,
  tab,
  onTab,
  promptDraft,
  onPromptDraft,
  onClose,
  onPatch,
  onOpenTwin,
}: {
  visible: boolean;
  busy: boolean;
  settings: AiEngineSettings | undefined;
  tab: ImageTab;
  onTab: (tab: ImageTab) => void;
  promptDraft: string;
  onPromptDraft: (value: string) => void;
  onClose: () => void;
  onPatch: (patch: Partial<AiEngineSettings>) => Promise<void>;
  onOpenTwin: () => void;
}): React.JSX.Element | null {
  if (!settings) return null;
  const poses = POSES[settings.imageScene] ?? POSES.cafe ?? [];
  const vendor = VENDORS.find((item) => item.id === settings.imageVendorPref) ?? VENDORS[0] ?? { id: "platform_default", name: "平台默认", desc: "", models: [] };
  return (
    <SheetShell visible={visible} title="图片管理" subtitle="场景 · 姿态 · 模型 · 提示词" onClose={onClose}>
      <TabBar
        tabs={[
          { id: "model", name: "模型" },
          { id: "scene", name: "生成场景" },
          { id: "pose", name: "人物姿态" },
          { id: "prompt", name: "提示词" },
          { id: "param", name: "参数" },
        ]}
        active={tab}
        onPick={onTab}
      />
      {tab === "model" ? (
        <View>
          <Text style={styles.groupTitle}>模型厂商</Text>
          <OptionList
            options={VENDORS.map((item) => ({ id: item.id, name: item.name, desc: item.desc }))}
            value={settings.imageVendorPref}
            disabled={busy}
            onPick={(id) => void onPatch({ imageVendorPref: id, imageModelPref: "" })}
          />
          {vendor.models.length > 0 ? (
            <>
              <Text style={styles.groupTitle}>{vendor.name} 模型</Text>
              <OptionList
                options={vendor.models.map((model) => ({ id: model.id, name: model.name, desc: "按偏好选择，平台负责路由" }))}
                value={settings.imageModelPref}
                disabled={busy}
                onPick={(id) => void onPatch({ imageModelPref: id })}
              />
            </>
          ) : (
            <Text style={styles.hint}>平台默认会按场景自动选最优模型。</Text>
          )}
          <Text style={styles.hint}>💡 图片生成费用由用户自行承担。选择的是偏好 ID，实际路由由平台托管。</Text>
        </View>
      ) : null}
      {tab === "scene" ? (
        <View>
          <Text style={styles.groupTitle}>选择场景</Text>
          <OptionList
            options={SCENES.map((item) => ({ id: item.id, name: item.name, desc: sceneLabel(item.id) }))}
            value={settings.imageScene}
            disabled={busy}
            onPick={(id) => void onPatch({ imageScene: id, imagePose: "" })}
          />
        </View>
      ) : null}
      {tab === "pose" ? (
        <View>
          <Text style={styles.groupTitle}>姿态模板 · {sceneLabel(settings.imageScene)}</Text>
          <ChipRow
            options={[{ id: "", name: "不指定" }, ...poses]}
            value={settings.imagePose}
            disabled={busy}
            onPick={(id) => void onPatch({ imagePose: id })}
          />
          <Text style={styles.groupTitle}>运镜风格</Text>
          <OptionList
            options={CAMERA_MOVES.map((item) => ({ id: item.id, name: item.name, desc: item.desc }))}
            value={settings.imageCamera}
            disabled={busy}
            onPick={(id) => void onPatch({ imageCamera: id })}
          />
        </View>
      ) : null}
      {tab === "prompt" ? (
        <View>
          <Text style={styles.groupTitle}>当前提示词 · {sceneLabel(settings.imageScene)}</Text>
          <TextInput
            accessibilityLabel="图片提示词"
            editable={!busy}
            multiline
            onChangeText={onPromptDraft}
            placeholder="输入提示词模板..."
            style={styles.promptInput}
            value={promptDraft}
          />
          <View style={styles.promptActions}>
            <Pressable
              accessibilityLabel="重置默认"
              disabled={busy}
              onPress={() => onPromptDraft("")}
              style={[styles.promptBtn, styles.promptBtnGhost]}
            >
              <Text style={styles.promptBtnGhostText}>重置默认</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="保存并使用"
              disabled={busy}
              onPress={() => void onPatch({ imagePrompt: promptDraft.slice(0, 4000) })}
              style={[styles.promptBtn, styles.promptBtnPrimary]}
            >
              <Text style={styles.promptBtnPrimaryText}>保存并使用</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>💡 用 {"{变量}"} 让 AI 自动填充人物、饮品、菜品等</Text>
          <Text style={styles.groupTitle}>历史版本</Text>
          {settings.imagePromptHistory.length === 0 ? (
            <Text style={styles.hint}>暂无历史记录</Text>
          ) : (
            settings.imagePromptHistory.map((item, index) => (
              <Pressable
                key={`${index}-${item.slice(0, 12)}`}
                accessibilityLabel={`恢复历史提示词 ${index + 1}`}
                disabled={busy}
                onPress={() => {
                  onPromptDraft(item);
                  void onPatch({ imagePrompt: item });
                }}
                style={styles.optionItem}
              >
                <Text style={styles.optionDesc} numberOfLines={2}>
                  {item}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
      {tab === "param" ? (
        <View>
          <Text style={styles.groupTitle}>尺寸比例 · 默认黄金比例</Text>
          <ChipRow
            options={[
              { id: "3:4", name: "3:4 人像" },
              { id: "1:1", name: "1:1 方形" },
              { id: "16:9", name: "16:9 宽幅" },
            ]}
            value={settings.imageAspect}
            disabled={busy}
            onPick={(id) => void onPatch({ imageAspect: id as AiEngineSettings["imageAspect"] })}
          />
          <Text style={styles.groupTitle}>输出精度</Text>
          <ChipRow
            options={[
              { id: "1024", name: "标准 1024px" },
              { id: "1536", name: "高清 1536px" },
              { id: "2048", name: "超清 2048px" },
            ]}
            value={settings.imageQuality}
            disabled={busy}
            onPick={(id) => void onPatch({ imageQuality: id as AiEngineSettings["imageQuality"] })}
          />
          <Text style={styles.groupTitle}>形象绑定</Text>
          <Pressable accessibilityLabel="打开形象库" onPress={onOpenTwin} style={styles.optionItem}>
            <Text style={styles.optionIcon}>👤</Text>
            <View style={styles.optionInfo}>
              <Text style={styles.optionName}>已绑定你的形象</Text>
              <Text style={styles.optionDesc}>用你的授权照片生成</Text>
            </View>
            <Text style={styles.check}>✓</Text>
          </Pressable>
        </View>
      ) : null}
    </SheetShell>
  );
}

function AiPostSheet({
  visible,
  busy,
  settings,
  onClose,
  onPatch,
}: {
  visible: boolean;
  busy: boolean;
  settings: AiEngineSettings | undefined;
  onClose: () => void;
  onPatch: (patch: Partial<AiEngineSettings>) => Promise<void>;
}): React.JSX.Element | null {
  const [topicDraft, setTopicDraft] = useState("");
  if (!settings) return null;
  const topics = settings.postTopics;
  const toggleTopic = (topic: string): void => {
    if (topics.includes(topic)) {
      void onPatch({ postTopics: topics.filter((item) => item !== topic) });
      return;
    }
    if (topics.length >= 20) return;
    void onPatch({ postTopics: [...topics, topic] });
  };
  return (
    <SheetShell visible={visible} title="动态管理" subtitle="AI 替你发什么" onClose={onClose}>
      <Text style={styles.groupTitle}>发帖节奏</Text>
      <OptionList
        options={POST_PACES.map((item) => ({ id: item.id, name: item.name, desc: item.desc, icon: item.icon }))}
        value={settings.postPace}
        disabled={busy}
        onPick={(id) => void onPatch({ postPace: id as AiEngineSettings["postPace"] })}
      />
      <Text style={styles.groupTitle}>内容偏好</Text>
      <ChipRow
        options={TOPIC_PRESETS.map((topic) => ({ id: topic, name: topic }))}
        value={topics[0] ?? ""}
        disabled={busy}
        onPick={(id) => toggleTopic(id)}
      />
      <View style={styles.chips}>
        {topics
          .filter((topic) => !(TOPIC_PRESETS as readonly string[]).includes(topic))
          .map((topic) => (
            <Pressable key={topic} accessibilityLabel={`移除偏好 ${topic}`} disabled={busy} onPress={() => toggleTopic(topic)} style={[styles.chip, styles.chipOn]}>
              <Text style={[styles.chipText, styles.chipTextOn]}>{topic} ✕</Text>
            </Pressable>
          ))}
      </View>
      <View style={styles.topicAddRow}>
        <TextInput
          accessibilityLabel="自定义内容偏好"
          editable={!busy}
          onChangeText={setTopicDraft}
          placeholder="自定义偏好"
          style={styles.topicInput}
          value={topicDraft}
        />
        <Pressable
          accessibilityLabel="添加内容偏好"
          disabled={busy || !topicDraft.trim() || topics.length >= 20}
          onPress={() => {
            const next = topicDraft.trim();
            if (!next) return;
            setTopicDraft("");
            if (!topics.includes(next)) void onPatch({ postTopics: [...topics, next.slice(0, 40)] });
          }}
          style={styles.topicAdd}
        >
          <Text style={styles.topicAddText}>添加</Text>
        </Pressable>
      </View>
      <Text style={styles.groupTitle}>发布权限</Text>
      <OptionList
        options={PERMISSIONS.map((item) => ({ ...item }))}
        value={settings.postPermission}
        disabled={busy}
        onPick={(id) => void onPatch({ postPermission: id as AiPermission })}
      />
      <Text style={styles.hint}>自动发帖任务尚未上线：这里只保存偏好，不会假装「运行中」。</Text>
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  nav: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  back: { fontSize: 24, color: "#1a1a1a", width: 24 },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  logoDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fafafa",
  },
  logoDotOn: { backgroundColor: "#4caf7d" },
  logoDotOff: { backgroundColor: "#ccc" },
  title: { flex: 1, fontSize: 18, fontWeight: "800", color: "#1a1a1a" },
  pauseBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  pauseBtnPaused: { backgroundColor: "#4caf7d" },
  pauseIcon: { color: "#fff", fontSize: 13, fontWeight: "800" },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 30 },
  statusCard: { backgroundColor: "#1a1a1a", borderRadius: 20, padding: 18, marginBottom: 16 },
  statusHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#666" },
  statusDotOn: { backgroundColor: "#4caf7d" },
  statusLabel: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  statusTime: { marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: "600" },
  statusSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 14 },
  nums: { flexDirection: "row", gap: 16 },
  num: { flex: 1 },
  numVal: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 6 },
  numLabel: { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: "600" },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: "#1a1a1a", marginBottom: 10, paddingLeft: 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#f0f0f0",
    padding: 14,
    marginBottom: 8,
  },
  cardDim: { opacity: 0.5 },
  cardIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardIconPurple: { backgroundColor: "#f0e8ff" },
  cardIconGreen: { backgroundColor: "#e8f7ee" },
  cardIconBlue: { backgroundColor: "#e8f1ff" },
  cardEmoji: { fontSize: 18 },
  cardText: { flex: 1, minWidth: 0 },
  cardNameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardName: { fontSize: 15, fontWeight: "700", color: "#1a1a1a" },
  cardSub: { fontSize: 12, color: "#888" },
  cardArrow: { fontSize: 18, color: "#bbb" },
  badge: { fontSize: 11, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  badgeRunning: { backgroundColor: "#eef7f0", color: "#3d7a4e" },
  badgeOff: { backgroundColor: "#f5f5f5", color: "#999" },
  badgeConfirm: { backgroundColor: "#fff8e6", color: "#a06a2c" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 8,
  },
  linkText: { fontSize: 12, color: "#666", fontWeight: "600" },
  version: { textAlign: "center", fontSize: 12, color: "#aaa", marginTop: 18, fontWeight: "600" },
  error: { fontSize: 12, color: color.error, marginBottom: 10, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 20,
    maxHeight: "88%",
  },
  grab: { alignSelf: "center", backgroundColor: "#DDD", borderRadius: 4, height: 4, marginTop: 10, width: 42 },
  sheetHeader: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#1a1a1a" },
  sheetSub: { fontSize: 12, color: "#888", marginTop: 4 },
  sheetScroll: { paddingHorizontal: 16 },
  sheetBody: { paddingBottom: 24 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#f5f5f5",
  },
  tabOn: { backgroundColor: "#1a1a1a" },
  tabText: { fontSize: 13, fontWeight: "700", color: "#666" },
  tabTextOn: { color: "#fff" },
  groupTitle: { fontSize: 13, fontWeight: "800", color: "#1a1a1a", marginTop: 14, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#f5f5f5",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  chipOn: { backgroundColor: "#f0e8ff", borderColor: "#7c3aed" },
  chipText: { fontSize: 13, fontWeight: "700", color: "#666" },
  chipTextOn: { color: "#5b21b6" },
  optionList: { gap: 8 },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#fafafa",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  optionOn: { backgroundColor: "#f0f7ff", borderColor: "#7c3aed" },
  optionIcon: { fontSize: 18, width: 24, textAlign: "center" },
  optionInfo: { flex: 1, minWidth: 0 },
  optionName: { fontSize: 14, fontWeight: "700", color: "#1a1a1a" },
  optionDesc: { fontSize: 12, color: "#888", marginTop: 2 },
  check: { fontSize: 16, fontWeight: "800", color: "#7c3aed" },
  hint: { fontSize: 12, color: "#888", marginTop: 10, lineHeight: 18 },
  promptInput: {
    minHeight: 96,
    borderWidth: 1.5,
    borderColor: "#eee",
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    color: "#1a1a1a",
    backgroundColor: "#fafafa",
    textAlignVertical: "top",
  },
  promptActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  promptBtn: { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: 12 },
  promptBtnGhost: { backgroundColor: "#f5f5f5" },
  promptBtnGhostText: { fontSize: 13, fontWeight: "700", color: "#666" },
  promptBtnPrimary: { backgroundColor: "#1a1a1a" },
  promptBtnPrimaryText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  topicAddRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  topicInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#eee",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#1a1a1a",
    backgroundColor: "#fafafa",
  },
  topicAdd: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#1a1a1a" },
  topicAddText: { fontSize: 13, fontWeight: "700", color: "#fff" },
});
