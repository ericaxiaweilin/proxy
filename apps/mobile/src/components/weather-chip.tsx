import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { localApiBaseUrl } from "../native-clients";
import { color } from "../theme";
import { adviceMessage, displayWeather, fetchWeather, weatherLine, type WeatherReport } from "../weather";

// WEATHER-001：读不到就返回 undefined，调用方什么都不画。
function useWeather(lat: number | undefined, lng: number | undefined, at?: Date, hours?: number): WeatherReport | undefined {
  const [report, setReport] = useState<WeatherReport>();
  const atKey = at ? at.getTime() : 0;
  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setReport(undefined);
      return;
    }
    let cancelled = false;
    const query: { lat: number; lng: number; at?: Date; hours?: number } = { lat, lng };
    if (at) query.at = at;
    if (hours) query.hours = hours;
    void fetchWeather(fetch, localApiBaseUrl, query).then((r) => { if (!cancelled) setReport(r); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, atKey, hours]);
  return report;
}

/** 城市名旁的天气：「北宁 · 晴 28°」。没有定位 / 读不到就不画。 */
export function WeatherChip({ city, lat, lng }: { city: string; lat: number | undefined; lng: number | undefined }): React.JSX.Element | null {
  const report = useWeather(lat, lng);
  if (!report) return null;
  return <Text selectable style={styles.chip} testID="weather-chip">{weatherLine(city, report.now)}</Text>;
}

/**
 * 首页地址旁的天气：图标 + 字（☀️ 晴 / 🌧️ 小雨 / ⛈️ 暴雨 / 🌀 台风），依据用户位置 + 公共气象数据。
 * 没有位置 / 读不到 / 不在这四种里就什么都不画。
 */
export function WeatherBadge({ lat, lng }: { lat: number | undefined; lng: number | undefined }): React.JSX.Element | null {
  const report = useWeather(lat, lng);
  const shown = report ? displayWeather(report.now.condition) : undefined;
  if (!report || !shown) return null;
  return (
    <View accessibilityLabel={`天气 ${shown.label}`} style={styles.badge} testID="weather-badge">
      <Text style={styles.badgeIcon}>{shown.icon}</Text>
      <Text style={styles.badgeText}>{shown.label} {Math.round(report.now.tempC)}°</Text>
    </View>
  );
}

/** 发布时的天气提醒：雨提醒、暴雨建议改期（能直接设的时间可点）。 */
export function WeatherAdviceBanner({ lat, lng, at, hours, onPickSlot, onPickAt }: {
  lat: number | undefined; lng: number | undefined; at: Date; hours: number;
  /** 只有「时刻」可选（没有日期）的表单：只有能直接设的建议可点。 */
  onPickSlot?: (slot: string) => void;
  /** 日期 + 时刻都可选的表单：所有建议都可点。 */
  onPickAt?: (when: Date) => void;
}): React.JSX.Element | null {
  const report = useWeather(lat, lng, at, hours);
  const msg = adviceMessage(report?.advice, at, new Date());
  if (!msg) return null;
  return (
    <View style={[styles.banner, msg.tone === "warn" ? styles.bannerWarn : null]} testID="weather-advice">
      <Text selectable style={styles.bannerText}>{msg.text}</Text>
      {/* 数据来源署名（挪威气象局 CC BY 4.0 要求）。 */}
      {report?.attribution ? <Text selectable style={styles.attribution}>{report.attribution}</Text> : null}
      {msg.options.some((o) => (onPickAt ? true : o.slot)) ? (
        <View style={styles.options}>
          {msg.options.filter((o) => (onPickAt ? true : o.slot)).map((o) => (
            <Pressable accessibilityLabel={`改到 ${o.label}`} key={o.label} onPress={() => { if (onPickAt) onPickAt(new Date(o.iso)); else if (o.slot) onPickSlot?.(o.slot); }} style={styles.option}>
              <Text style={styles.optionText}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, flexDirection: "row", gap: 4, paddingHorizontal: 9, paddingVertical: 5 },
  badgeIcon: { fontSize: 15 },
  badgeText: { color: color.ink, fontSize: 12, fontVariant: ["tabular-nums"], fontWeight: "700" },
  chip: { color: color.muted, fontSize: 12, lineHeight: 17 },
  banner: { backgroundColor: color.warnBannerBg, borderColor: color.warnBannerBorder, borderRadius: 10, borderWidth: 1, gap: 8, marginHorizontal: 16, marginVertical: 8, padding: 10 },
  bannerWarn: { borderColor: "#BD3434" },
  attribution: { color: color.muted, fontSize: 11 },
  bannerText: { color: color.warnBannerText, fontSize: 13, lineHeight: 18 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { backgroundColor: color.white, borderColor: color.line, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  optionText: { color: color.ink, fontSize: 13, fontWeight: "700" }
});
