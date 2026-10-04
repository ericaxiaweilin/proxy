import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { color } from "../theme";
import { scheduleRecapLabel, type DayOption, type TimeSlot } from "../direct-invite-schedule";

// matchDaySlot：把一版 terms 的 startAt 反查回 picker 的 day/slot ——
// 还价表单预填用（时间没改就维持上版）。查不到（超 7 天/格式坏）回明天 13:00。
export function matchDaySlot(days: DayOption[], slots: TimeSlot[], isoStart: string | undefined): { day: number; slot: TimeSlot } {
  const fallback = { day: 1, slot: slots[2] ?? slots[0]! };
  if (!isoStart) return fallback;
  const d = new Date(isoStart);
  if (Number.isNaN(d.getTime())) return fallback;
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const found = days.find((day) => day.iso === iso);
  let best = fallback.slot;
  let bestDiff = Number.MAX_SAFE_INTEGER;
  for (const slot of slots) {
    const diff = Math.abs(slot.hour - d.getHours());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  return { day: found ? found.offset : 1, slot: best };
}

// MERCHANT-CREATOR-INVITE-001：邀约时间选择器 —— 直接复用 DIRECT-INVITE-SCHEDULE-001
// 的那一套（按天横滑 chip + 固定时段 chip），不自己发明第二套日期 UI。
// 商家邀约表单、商家还价表单、creator 还价表单三处共用，选出来的东西长一个样。
// durations 是时长档（小时），调用方定（邀约场景一般 2–12 小时）。
export function InviteSchedulePicker({ days, slots, durations, dayOffset, slot, durationH, onDay, onSlot, onDuration, startAtIso }: {
  days: DayOption[];
  slots: TimeSlot[];
  durations: number[];
  dayOffset: number;
  slot: TimeSlot;
  durationH: number;
  onDay: (offset: number) => void;
  onSlot: (slot: TimeSlot) => void;
  onDuration: (hours: number) => void;
  startAtIso: string;
}): React.JSX.Element {
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {days.map((day) => (
          <Pressable key={day.offset} onPress={() => onDay(day.offset)} style={[styles.chip, dayOffset === day.offset && styles.chipOn]} accessibilityLabel={`合作日期${day.label}`}>
            <Text selectable style={[styles.chipText, dayOffset === day.offset && styles.chipTextOn]}>{day.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {slots.map((item) => (
          <Pressable key={item.label} onPress={() => onSlot(item)} style={[styles.chip, slot.label === item.label && styles.chipOn]} accessibilityLabel={`开始时间${item.label}`}>
            <Text selectable style={[styles.chipText, slot.label === item.label && styles.chipTextOn]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.durationRow}>
        {durations.map((hours) => (
          <Pressable key={hours} onPress={() => onDuration(hours)} style={[styles.chip, durationH === hours && styles.chipOn]} accessibilityLabel={`时长${hours}小时`}>
            <Text selectable style={[styles.chipText, durationH === hours && styles.chipTextOn]}>{`${hours}小时`}</Text>
          </Pressable>
        ))}
      </View>
      <Text selectable style={styles.recap}>{`${scheduleRecapLabel(startAtIso)} · ${durationH}小时`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  chip: { backgroundColor: color.surface, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink },
  chipText: { color: color.ink, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: color.white },
  durationRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  recap: { color: color.ink, fontSize: 13, fontWeight: "800", marginTop: 6 },
});
