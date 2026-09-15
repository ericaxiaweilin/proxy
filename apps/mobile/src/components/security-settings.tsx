// Lotus RFC §8 — 设置页「安全」区块 (如实的安全说明 + 真开关)
// 包含：加密与访问控制说明、防截图提醒、多身份入口、消息保留时间、设备管理 (2 设备踢旧)
// COMP-E2EE-001：此处原卡片标题写的是 E2EE（即端到端那种加密）+「军用级
// AES-256」+「已开启 · 始终保护」，三项都与实现不符。
// 平台没有 E2EE（端到端）加密的实现，服务端能读到明文；TLS 是传输层加密、
// KMS 是静态加密，两者都不算端到端。向用户挂一把兑现不了的锁是虚假安全声明，
// 会放大法律与人身安全风险，已改为如实表述。
// 门禁 COMP-E2EE-002 钉着：apps/mobile/src 里不允许再出现该能力的中文名。
// 管理类按钮暂无后端与管理页面可接：只留信息卡，不渲染死按钮
// （之前点按直接回“我的”，哪儿也没去）。

import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { ProxySwitch } from "./proxy-foundation";
import type { SessionWire } from "../session-client";

// DEVICE-LIST-001: 设备管理卡片读真会话列表。
//
// 只取最小能力面（list + revoke），不 import SessionClient 类本身 ——
// 卡片不拥有传输细节，调用方给什么它用什么；测试也可以直接塞假实现。
export type SessionListClient = {
  listMySessions(): Promise<SessionWire[]>;
  revokeSession(sessionId: string): Promise<void>;
};

function platformLabel(platform: string, current: boolean): string {
  // 本机行不猜：手里这台是 iPhone 还是 iPad，标准库 Platform.isPad 说了算。
  if (current) {
    if (Platform.OS === "ios") return Platform.isPad === true ? "iPad" : "iPhone";
    if (Platform.OS === "android") return "安卓手机";
    return "本机";
  }
  // 非本机行服务端只存了 OS 家族（IOS/ANDROID），显示家族不猜机型 ——
  // 之前的 "iPhone / iPad" 是把不知道的事说成了二选一。
  if (platform === "IOS") return "iOS 设备";
  if (platform === "ANDROID") return "安卓设备";
  if (platform === "WEB") return "网页端";
  // 空字符串 = 会话还在、设备行没了（保留期清理/历史行）。说「未知」，
  // 不丢行 —— 丢行会让用户以为只登了一台。
  if (!platform) return "未知设备";
  return platform;
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "在线";
  if (status === "REVOKED") return "已踢出";
  return "已失效";
}

export function SecuritySettings({
  retentionDays,
  onRetentionChange,
  screenshotWarnEnabled,
  onToggleScreenshotWarn,
  sessionClient,
}: {
  retentionDays: 7 | 30 | 90 | 365;
  onRetentionChange: (v: 7 | 30 | 90 | 365) => void;
  screenshotWarnEnabled: boolean;
  onToggleScreenshotWarn: (v: boolean) => void;
  // 缺省 = 没接线：卡片如实说登录后可看，不画假列表。
  sessionClient?: SessionListClient | undefined;
}): React.JSX.Element {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔒 加密与访问控制</Text>
        <Text style={styles.cardDesc}>消息在传输中使用 TLS 加密，在服务器上使用 AES-256 静态加密。</Text>
        <Text style={styles.cardDesc}>Proxy 不提供 E2EE（端到端）加密：为履行法律义务、处理举报与安全审计，Proxy 可能依法访问通信内容。</Text>
        <Text style={styles.badge}>已开启</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>🛡️ 防截图提醒</Text>
          <ProxySwitch accessibilityLabel="防截图提醒" onChange={onToggleScreenshotWarn} value={screenshotWarnEnabled} />
        </View>
        <Text style={styles.cardDesc}>您发送的图片和位置，对方截图时您将立即收到通知。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>👤 多身份模式</Text>
        <Text style={styles.cardDesc}>工作号 / 私人号 / 备用号（7天后自动销毁）隔离会话与未读。身份切换在消息页左上角。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>⏱️ 消息保留时间</Text>
        <View style={styles.chips}>
          {([7, 30, 90, 365] as const).map((v) => (
            <Pressable key={v} onPress={() => onRetentionChange(v)} style={[styles.chip, retentionDays === v && styles.chipActive]}>
              <Text style={[styles.chipText, retentionDays === v && styles.chipTextActive]}>{v}天</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.cardDesc}>到期自动清理（场景/订单/优惠券消息不受影响）。</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>📱 设备管理</Text>
        <Text style={styles.cardDesc}>最多 2 台设备同时在线，新登录自动踢出最旧设备。</Text>
        <DeviceList client={sessionClient} />
      </View>
    </View>
  );
}

type DeviceLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; sessions: SessionWire[] };

function DeviceList({ client }: { client: SessionListClient | undefined }): React.JSX.Element {
  const [state, setState] = useState<DeviceLoadState>({ kind: "idle" });
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);
  // 历史登录（已踢出/已失效）默认只露 5 行，剩下的折起来 —— 全摊开时
  // 真正要管的两格在线槽位会被埋没。折叠只藏展示，不丢数据。
  const [expanded, setExpanded] = useState(false);

  const reload = useCallback(async () => {
    if (!client) return;
    setState({ kind: "loading" });
    setExpanded(false);
    try {
      const sessions = await client.listMySessions();
      setState({ kind: "ready", sessions });
    } catch {
      // 失败就是失败，不留空列表 —— 空列表看起来像「只有本机在线」。
      setState({ kind: "failed", message: "设备列表没拉到 —— 可能是网络或登录态的问题，不是你没有设备。" });
    }
  }, [client]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 踢掉的是别人的会话，不是自己的：本机行不渲染这个按钮（见下），
  // 踢自己等于登出，不叫设备管理。服务端同样按 actor 鉴权，ID 被改过也踢不掉别人的。
  async function kick(id: string): Promise<void> {
    if (!client || revokingId) return;
    setRevokingId(id);
    setRevokeError(undefined);
    try {
      await client.revokeSession(id);
      const sessions = await client.listMySessions();
      setState({ kind: "ready", sessions });
    } catch {
      setRevokeError("踢出失败 —— 对方可能已经下线或网络有问题，稍后重试。");
    } finally {
      setRevokingId(undefined);
    }
  }

  if (!client) {
    return <Text style={styles.cardDesc}>登录后可查看已登录设备。</Text>;
  }
  if (state.kind === "loading" || state.kind === "idle") {
    return <Text style={styles.cardDesc}>正在读取设备列表…</Text>;
  }
  if (state.kind === "failed") {
    return (
      <View style={styles.deviceBox}>
        <Text style={styles.deviceError}>{state.message}</Text>
        <Pressable onPress={() => void reload()} accessibilityLabel="重新拉取设备列表" style={styles.retryBtn}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }
  if (state.sessions.length === 0) {
    return (
      <View style={styles.deviceBox}>
        <Text style={styles.cardDesc}>暂无已登录设备记录。</Text>
        <Pressable onPress={() => void reload()} accessibilityLabel="重新拉取设备列表" style={styles.retryBtn}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }
  // 本机 → 在线 → 历史（新的在前）。折叠后露出的 5 行永远是当下
  // 要管的：本机和在线槽位排前面，踢出记录沉底。
  const ordered = [...state.sessions].sort((a, b) => {
    const rank = (s: SessionWire): number => (s.current ? 0 : s.status === "ACTIVE" ? 1 : 2);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return b.issuedAt.localeCompare(a.issuedAt);
  });
  const visible = expanded ? ordered : ordered.slice(0, 5);
  return (
    <View style={styles.deviceBox}>
      {visible.map((session) => (
        <View key={session.id} style={styles.deviceRow}>
          <View style={styles.deviceInfo}>
            <Text style={styles.deviceName}>
              {platformLabel(session.platform, session.current)}
              {session.current ? <Text style={styles.deviceCurrent}> · 本机</Text> : null}
            </Text>
            <Text style={styles.deviceMeta}>
              {statusLabel(session.status)} · {session.issuedAt.slice(0, 10)} 登录
            </Text>
          </View>
          {!session.current && session.status === "ACTIVE" ? (
            <Pressable
              disabled={revokingId === session.id}
              onPress={() => void kick(session.id)}
              accessibilityLabel={`踢出${platformLabel(session.platform, session.current)}`}
              style={styles.kickBtn}
            >
              <Text style={styles.kickText}>{revokingId === session.id ? "踢出中…" : "踢出"}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {revokeError ? <Text style={styles.deviceError}>{revokeError}</Text> : null}
      {ordered.length > 5 ? (
        <Pressable onPress={() => setExpanded((v) => !v)} accessibilityLabel={expanded ? "收起历史登录" : `展开全部${ordered.length}条登录记录`} style={styles.retryBtn}>
          <Text style={styles.retryText}>{expanded ? "‹ 收起" : `展开全部 ${ordered.length} 条 ›`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
  card: { backgroundColor: color.white, borderColor: color.line, borderRadius: 16, borderWidth: 1, padding: 14 },
  cardTitle: { color: color.ink, fontSize: 13, fontWeight: "800" },
  cardDesc: { color: color.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  badge: { alignSelf: "flex-start", backgroundColor: "#E8F5E9", borderRadius: 999, color: "#2E7D32", fontSize: 11, fontWeight: "800", marginTop: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  chips: { flexDirection: "row", gap: 8, marginTop: 10 },
  chip: { backgroundColor: "#F4F1F6", borderColor: color.line, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: "#EEE3FF", borderColor: color.proxyPurple },
  chipText: { color: color.muted, fontSize: 11, fontWeight: "700" },
  chipTextActive: { color: "#5822A4" },
  deviceBox: { gap: 8, marginTop: 10 },
  deviceRow: { alignItems: "center", backgroundColor: "#F7F4FA", borderRadius: 12, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  deviceInfo: { flex: 1 },
  deviceName: { color: color.ink, fontSize: 12, fontWeight: "800" },
  deviceCurrent: { color: "#2E7D32" },
  deviceMeta: { color: color.muted, fontSize: 11, marginTop: 2 },
  deviceError: { color: "#B3261E", fontSize: 11, lineHeight: 15 },
  retryBtn: { alignSelf: "flex-start", backgroundColor: "#EEE3FF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: "#5822A4", fontSize: 11, fontWeight: "800" },
  kickBtn: { borderColor: "#E5B8B8", borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  kickText: { color: "#B3261E", fontSize: 11, fontWeight: "800" },
});
