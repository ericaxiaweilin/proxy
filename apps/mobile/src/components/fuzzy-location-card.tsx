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
import { getLanguage, translate, useI18n, type Language, type MessageKey } from "../i18n";
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
function coarseGridNote(lang: Language): string {
  return translate(lang, "fuzzyCoarseNote");
}

export function FuzzyLocationCard({
  client,
  skipInitialFetch,
}: {
  client: LocationConsentClient;
  skipInitialFetch?: boolean;
}): React.JSX.Element {
  // I18N-SAFETY-002：错误存**原因**、渲染时再翻译（HOME-I18N-001 的形状）。
  const { lang, t } = useI18n();
  const [consent, setConsent] = useState<LocationConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCause | null>(null);

  useEffect(() => {
    if (skipInitialFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await client.getStatus(KIND);
        if (!cancelled) setConsent(next);
      } catch (e) {
        if (!cancelled) setError(errorCauseFor(e));
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
      setError(errorCauseFor(e));
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
      setError(errorCauseFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text selectable style={styles.title}>{t("fuzzyTitle")}</Text>
      {/* 这里刻意**不**照抄原型的「盲盒匹配时共享给匹配对象」——
          本仓库没有盲盒匹配这个功能（全仓 blindbox/盲盒 零命中），
          而且目前也**没有**任何「把区域展示给匹配对象」的消费方。
          写出来就是一句没有实现支撑的承诺。
          这项同意当下真正的作用只有一条，就在下面写清。 */}
      <Text selectable style={styles.desc}>
        {t("fuzzyDescSafety", { note: coarseGridNote(lang) })}
      </Text>
      <Text selectable style={styles.desc}>
        {t("fuzzyDescWhenOff")}
      </Text>
      <Text selectable style={styles.desc}>
        {t("fuzzyDescSeparate")}
      </Text>

      <View style={styles.row}>
        <View style={styles.stateBox}>
          <Text selectable style={styles.stateLabel}>
            {active ? t("consentOn") : consent?.status === "REVOKED" ? t("consentOff") : t("consentNotOn")}
          </Text>
          {active && consent ? (
            <Text selectable style={styles.stateHint}>
              {formatRemaining(consent.remainingSeconds, lang)}
            </Text>
          ) : (
            <Text selectable style={styles.stateHint}>{t("fuzzyOffHint")}</Text>
          )}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: active, disabled: busy }}
          accessibilityLabel={t("fuzzySwitchA11y")}
          disabled={busy}
          onPress={() => void (active ? handleRevoke() : handleGrant(ALLOWED_DURATION_SECONDS[1]!))}
          style={[styles.switch, active ? styles.switchOn : null, busy ? styles.switchBusy : null]}
        >
          <View style={[styles.switchDot, active ? styles.switchDotOn : null]} />
        </Pressable>
      </View>

      {error ? (
        <Text selectable style={styles.error}>
          {errorText(error)} {t("consentStaleSuffix")}
        </Text>
      ) : null}
    </View>
  );
}

type ErrorCause =
  | { kind: "key"; key: MessageKey }
  | { kind: "raw"; raw: string };

function errorCauseFor(e: unknown): ErrorCause {
  if (e instanceof LocationConsentError) {
    if (e.httpStatus === 401) return { kind: "key", key: "consentSessionExpired" };
    if (e.httpStatus === 400) return { kind: "key", key: "consentRejected" };
    return { kind: "raw", raw: e.message };
  }
  if (e instanceof Error) return { kind: "raw", raw: e.message };
  return { kind: "key", key: "consentGenericError" };
}

function errorText(cause: ErrorCause): string {
  return cause.kind === "raw" ? cause.raw : translate(getLanguage(), cause.key);
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
