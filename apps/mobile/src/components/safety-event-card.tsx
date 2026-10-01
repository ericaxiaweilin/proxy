// SAFETY-NET-001：安全事件卡片（一键求助 / 见面签到 + 事件记录）。
//
// ── 这张卡片最重要的一句话 ──────────────────────────────────────────
//
// **平台不会自动通知任何人。**
//
// 本仓库没有向任意用户推送 / 发短信 / 发邮件的通道：
// notification.LogPushProvider 只 log.Printf，SMS/SMTP 只服务登录验证码。
// 所以服务端 eventBody.deliveredToContacts 恒为 false，而这句免责声明
// 必须出现在界面上 —— 不写清楚，用户会以为紧急联系人已经收到通知了，
// 于是不去自己打那个电话。这是这个功能最坏的失败模式。
//
// 真话只有两句，卡片分别说：
//   · 我们真的做了什么 —— handOffLabel()：记了一条、开了拨号盘、转交了短信
//   · 我们没有做什么 —— deliveryDisclaimer()
//
// ── 为什么位置是「可选注入」而不是这里直接调 expo ────────────────────
//
// 位置来源由调用方（me.tsx）通过 getFix 传进来。这样这个组件不依赖
// expo-location，vitest 里能完整驱动；也避免卡片自己去开 GPS ——
// 拿不到就发 undefined，服务端照记事件、丢坐标，客户端不编坐标。
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import {
  type EmergencyClient,
  type EmergencyEvent,
  EmergencyError,
  VN_EMERGENCY_NUMBERS,
  coarseLocationLabel,
  deliveryDisclaimer,
  handOffLabel,
} from "../emergency-client";

export type SafetyFixSource = () => Promise<{ latitude: number; longitude: number } | undefined>;

export function SafetyEventCard({
  client,
  getFix,
  skipInitialFetch,
}: {
  client: EmergencyClient;
  getFix?: SafetyFixSource;
  skipInitialFetch?: boolean;
}): React.JSX.Element {
  const [events, setEvents] = useState<EmergencyEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const page = await client.listEvents(10);
      setEvents(page.events);
    } catch (e) {
      setError(messageFor(e));
    }
  }, [client]);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await client.listEvents(10);
        if (!cancelled) setEvents(page.events);
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, skipInitialFetch]);

  // record 记录事件本身。坐标拿不到就不发坐标 —— 不发和发一个编出来的
  // 点，在安全功能里是完全不同的两件事。
  const record = async (
    kind: "SOS" | "MEETUP_CHECKIN",
    extra: { dialerOpened?: boolean; dialedNumber?: string } = {},
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let fix: { latitude: number; longitude: number } | undefined;
      if (getFix) {
        try {
          fix = await getFix();
        } catch {
          fix = undefined;
        }
      }
      const event = await client.recordEvent({
        kind,
        ...(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {}),
        ...extra,
      });
      setNotice(
        event.locationRecorded
          ? "已记录这条事件，并记录了粗化后的位置。"
          : "已记录这条事件。位置没有记录 —— 需要先开启位置授权。",
      );
      await reload();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const dial = async (number: string) => {
    // 先记录「打开了拨号盘」，再真的去开。顺序反过来的话，用户从拨号盘
    // 回来时事件还没记上，记录里就少了一次求助。
    await record("SOS", { dialerOpened: true, dialedNumber: number });
    try {
      await Linking.openURL(`tel:${number}`);
    } catch {
      setError(`打不开拨号盘，请手动拨打 ${number}。`);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text selectable style={styles.title}>安全事件</Text>
      <Text selectable style={styles.desc}>
        一键求助只做两件事：把这一刻记下来，并帮你打开拨号盘。见面签到记录一次「我到了」。
      </Text>
      {/* 免责声明放在按钮**上面**：用户按下之前就该看到，而不是事后。 */}
      <Text selectable style={styles.disclaimer}>{deliveryDisclaimer()}</Text>

      <View style={styles.dialRow}>
        {VN_EMERGENCY_NUMBERS.map((row) => (
          <Pressable
            key={row.number}
            accessibilityLabel={`拨打 ${row.number}（${row.label}）`}
            disabled={busy}
            onPress={() => void dial(row.number)}
            style={[styles.dialBtn, busy ? styles.btnDisabled : null]}
          >
            <Text selectable style={styles.dialNumber}>{row.number}</Text>
            <Text selectable style={styles.dialLabel}>{row.label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        disabled={busy}
        onPress={() => void record("MEETUP_CHECKIN")}
        style={[styles.secondaryBtn, busy ? styles.btnDisabled : null]}
      >
        <Text selectable style={styles.secondaryBtnText}>记录一次见面签到</Text>
      </Pressable>

      {notice ? <Text selectable style={styles.notice}>{notice}</Text> : null}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}

      <Text selectable style={styles.logTitle}>最近记录</Text>
      {events.length === 0 ? (
        <Text selectable style={styles.empty}>还没有记录。</Text>
      ) : (
        events.map((event) => (
          <View key={event.eventId} style={styles.eventRow}>
            <Text selectable style={styles.eventKind}>
              {event.kind === "SOS" ? "求助" : "见面签到"} · {shortTime(event.occurredAt)}
            </Text>
            <Text selectable style={styles.eventLine}>{handOffLabel(event)}</Text>
            <Text selectable style={styles.eventLine}>{coarseLocationLabel(event)}</Text>
            {event.note ? <Text selectable style={styles.eventLine}>{event.note}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}

function shortTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "时间未知";
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function messageFor(e: unknown): string {
  if (e instanceof EmergencyError) {
    switch (e.code) {
      case "INVALID_EMERGENCY_LOCATION":
        return "位置数据不完整，这条没有记录。";
      case "INVALID_EMERGENCY_EVENT":
        return "这条记录没被接受，请重试。";
      case "AUTH_REQUIRED":
        return "登录已过期，请重新登录。";
      default:
        return `记录失败（${e.code}）。`;
    }
  }
  if (e instanceof Error) return e.message;
  return "出错了，请稍后重试。";
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  title: { color: color.ink, fontSize: 16, fontWeight: "700" },
  desc: { color: color.muted, fontSize: 12.5, lineHeight: 19, marginTop: 8 },
  disclaimer: {
    color: color.warnBannerText,
    backgroundColor: color.warnBannerBg,
    borderColor: color.warnBannerBorder,
    borderWidth: 1,
    borderRadius: 10,
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 10,
    padding: 10,
  },
  dialRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  dialBtn: {
    flex: 1,
    backgroundColor: color.ink,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  dialNumber: { color: color.white, fontSize: 16, fontWeight: "700" },
  dialLabel: { color: color.darkCardText, fontSize: 11, marginTop: 2 },
  btnDisabled: { opacity: 0.5 },
  secondaryBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: color.ink, fontSize: 14.5 },
  notice: { color: color.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  error: { color: color.error, fontSize: 12, lineHeight: 18, marginTop: 10 },
  logTitle: { color: color.ink, fontSize: 14, fontWeight: "600", marginTop: 18 },
  empty: { color: color.muted, fontSize: 12.5, marginTop: 8 },
  eventRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  eventKind: { color: color.ink, fontSize: 13.5, fontWeight: "600" },
  eventLine: { color: color.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
});
