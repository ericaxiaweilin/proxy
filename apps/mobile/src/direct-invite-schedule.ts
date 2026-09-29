// DIRECT-INVITE-SCHEDULE-001: 现实场景页发 DIRECT_INVITE 邀约时，开始时间以前
// 是前端写死的"当前时刻 + 24 小时"，用户完全没法选。这里给一个不依赖第三方
// 日期选择库的最小实现——按天的横滑 chip（今天/明天/周X · M月D日）+ 固定的
// 时段 chip（每两小时一档），组合成真实的 startsAt。后端 CreateScene 本来就
// 接受任意合法 ISO 时间字符串，不需要改后端。

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type DayOption = { offset: number; iso: string; label: string };

export function dayOptions(now: Date, count = 7): DayOption[] {
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const label = i === 0 ? "今天" : i === 1 ? "明天" : `${WEEKDAYS[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日`;
    out.push({ offset: i, iso, label });
  }
  return out;
}

export type TimeSlot = { hour: number; minute: number; label: string };

// 固定档位而不是自由输入：这条链下单后对方要能立刻看懂"何时"，固定档位
// 比任意分钟数更符合"见面时间"这种场景的真实颗粒度。
const SLOT_HOURS = [9, 11, 13, 15, 17, 19, 21] as const;

export function timeSlotOptions(): TimeSlot[] {
  return SLOT_HOURS.map((hour) => ({ hour, minute: 0, label: `${pad2(hour)}:00` }));
}

export function combineDayAndTime(dayIso: string, slot: TimeSlot): string {
  const parts = dayIso.split("-").map(Number);
  const year = parts[0]!, month = parts[1]!, day = parts[2]!;
  return new Date(year, month - 1, day, slot.hour, slot.minute, 0, 0).toISOString();
}

export function scheduleRecapLabel(iso: string): string {
  const date = new Date(iso);
  return `${WEEKDAYS[date.getDay()]} · ${date.getMonth() + 1}月${date.getDate()}日 · ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
