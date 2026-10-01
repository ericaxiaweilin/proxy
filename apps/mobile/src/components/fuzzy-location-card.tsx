// SAFETY-NET-001：模糊位置共享卡片（FUZZY_REGION 同意）。
//
// 和 PreciseLocationCard 是**两张独立的同意**，不是一个开关的两档：
// NĐ 356/2025 Art. 6.3 禁止捆绑同意 —— 把「大致区域」和「精确坐标」做成
// 一个开关，用户点一次就同时同意了更细的那一种，那是默认同意。
// 服务端也是两行（location_consents 的 kind 列 + 部分唯一索引），
// 撤销一个不碰另一个。
//
// 这一档刻意不接 GPS：它只用设备已有的粗位置（device-location 的缓存 fix），
// 拿不到就不发 —— 不为了点亮一个开关去编坐标。
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import {
  ALLOWED_DURATION_SECONDS,
  type LocationConsent,
  type LocationConsentClient,
  LocationConsentError,
  formatRemaining,
  isActiveConsent,
} from "../location-consent-client";

const KIND = "FUZZY_REGION" as const;

// 粗化网格。服务端 emergency/location 的 Coarsen 用的是 0.01° 网格：
// 在河内纬度上边长约 1.1 公里（经度按 cos(lat) 收窄）。
// 这里说的是**网格量级**，不是精度承诺 —— 界面上不许把它写成「精确到 X 米」。
const COARSE_GRID_NOTE = "坐标会被粗化到约 1 公里的网格后再使用";

export function FuzzyLocationCard({
  client,
  skipInitialFetch,
}: {
  client: LocationConsentClient;
  skipInitialFetch?: boolean;
}): React.JSX.Element {
  const [consent, setConsent] = useState<LocationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await client.getStatus(KIND);
        if (!cancelled) setConsent(next);
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, skipInitialFetch]);

  const active = isActiveConsent(consent);

  const handleGrant = async (durationSeconds: number) => {
    setBusy(true);
    setError(null);
    try {
      setConsent(await client.grant(durationSeconds, KIND));
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.revoke(KIND);
      // 重新读一遍，而不是本地把状态翻过去：让界面显示的是服务端**实际**
      // 记着的那一行，不是我们以为的那一行。
      setConsent(await client.getStatus(KIND));
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text selectable style={styles.title}>模糊位置共享（粗化区域）</Text>
      {/* 这里刻意**不**照抄原型的「盲盒匹配时共享给匹配对象」——
          本仓库没有盲盒匹配这个功能（全仓 blindbox/盲盒 零命中），
          而且目前也**没有**任何「把区域展示给匹配对象」的消费方。
          写出来就是一句没有实现支撑的承诺。
          这项同意当下真正的作用只有一条，就在下面写清。 */}
      <Text selectable style={styles.desc}>
        开启后，安全事件（一键求助 / 见面签到）才能记录你所在的大致区域。{COARSE_GRID_NOTE}。
      </Text>
      <Text selectable style={styles.desc}>
        未开启时事件照样记录，但坐标会被丢弃，记录里会写明「当时没有生效的位置授权」。
      </Text>
      <Text selectable style={styles.desc}>
        这是与「精确位置」分开的一项授权：关掉它不影响你已经单独给过的精确位置授权，反过来也一样。
      </Text>

      <View style={styles.row}>
        <View style={styles.stateBox}>
          <Text selectable style={styles.stateLabel}>
            {active ? "已开启" : consent?.status === "REVOKED" ? "已关闭" : "未开启"}
          </Text>
          {active && consent ? (
            <Text selectable style={styles.stateHint}>
              {formatRemaining(consent.remainingSeconds, "zh")}
            </Text>
          ) : (
            <Text selectable style={styles.stateHint}>默认关闭，需要你主动开启</Text>
          )}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: active, disabled: busy }}
          accessibilityLabel="模糊位置共享开关"
          disabled={busy}
          onPress={() => void (active ? handleRevoke() : handleGrant(ALLOWED_DURATION_SECONDS[1]!))}
          style={[styles.switch, active ? styles.switchOn : null, busy ? styles.switchBusy : null]}
        >
          <View style={[styles.switchDot, active ? styles.switchDotOn : null]} />
        </Pressable>
      </View>

      {error ? (
        <Text selectable style={styles.error}>
          {error} —— 开关没有生效，服务端仍按上一次的授权状态处理。
        </Text>
      ) : null}
    </View>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof LocationConsentError) {
    if (e.httpStatus === 401) return "登录已过期，请重新登录";
    if (e.httpStatus === 400) return "请求不被接受，请稍后重试";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "出错了，请稍后重试";
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
  },
  stateBox: { flex: 1, paddingRight: 12 },
  stateLabel: { color: color.ink, fontSize: 14, fontWeight: "600" },
  stateHint: { color: color.muted, fontSize: 12, marginTop: 3 },
  switch: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.line,
    padding: 2,
    justifyContent: "center",
  },
  switchOn: { backgroundColor: color.violet },
  switchBusy: { opacity: 0.5 },
  switchDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.white,
  },
  switchDotOn: { alignSelf: "flex-end" },
  error: { color: color.error, fontSize: 12, lineHeight: 18, marginTop: 10 },
});
