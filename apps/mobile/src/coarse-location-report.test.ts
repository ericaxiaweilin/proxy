import { describe, expect, it, vi } from "vitest";
import { COARSE_LOCATION_MIN_INTERVAL_MS, reportCoarseLocationIfDue, type CoarseLocationReportDeps } from "./coarse-location-report";

// 粗略位置上报的四条规则。全部 fail-closed，而且「没同意 ⇒ 连定位都不取」
// 是其中最要紧的一条：没拿到同意就先发起定位请求，本身就越过了同意，
// 而那种失败在真机上完全看不出来（App 照样能用，只是后台多了一次定位）。
//
// 时间全部走注入的固定时钟，不碰 Date.now —— 否则「30 分钟」这个断言会
// 变成墙钟的函数，跑得慢一点就翻红。

type Harness = {
  deps: CoarseLocationReportDeps;
  sent: Array<{ lat: number; lng: number }>;
  marked: number[];
  getFix: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  advance: (ms: number) => void;
};

function harness(overrides: Partial<CoarseLocationReportDeps> & { clock?: number } = {}): Harness {
  const { clock = 1_000_000, getFix: getFixOverride, ...rest } = overrides;
  let now = clock;
  let last: number | undefined;
  const sent: Array<{ lat: number; lng: number }> = [];
  const marked: number[] = [];
  const getFix = vi.fn(getFixOverride ?? (async () => ({ lat: 21.0285, lng: 105.8042 })));
  const send = vi.fn(async (lat: number, lng: number) => { sent.push({ lat, lng }); });
  return {
    deps: {
      now: () => now,
      lastSentAt: () => last,
      markSent: (at) => { marked.push(at); last = at; },
      captureEnabled: async () => true,
      locationConsentActive: async () => true,
      getFix,
      send,
      ...rest
    },
    sent,
    marked,
    getFix,
    send,
    advance: (ms: number) => { now += ms; }
  };
}

describe("粗略位置上报：节流", () => {
  it("30 分钟内只发一次；到点才发第二次", async () => {
    const h = harness();
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toHaveLength(1);
    // 差 1ms 都不算到期 —— 半开区间，边界不给通融。
    h.advance(COARSE_LOCATION_MIN_INTERVAL_MS - 1);
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toHaveLength(1);
    expect(h.getFix).toHaveBeenCalledTimes(1);
    h.advance(1);
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toHaveLength(2);
  });

  it("时钟倒流不放行（节流只收紧不放松），而且 markSent 记的是本次取的时刻", async () => {
    const h = harness();
    await reportCoarseLocationIfDue(h.deps);
    expect(h.marked).toEqual([1_000_000]);
    h.advance(-10 * 60 * 1000);
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toHaveLength(1);
  });

  it("从没发过时（lastSentAt = undefined）不因缺字段而跳过", async () => {
    const h = harness();
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toHaveLength(1);
    expect(h.marked).toHaveLength(1);
  });
});

describe("粗略位置上报：两道同意", () => {
  it("行为采集同意 = false ⇒ 不取定位也不发", async () => {
    const h = harness({ captureEnabled: async () => false });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.getFix).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.marked).toHaveLength(0);
  });

  it("行为采集同意读失败 ⇒ fail-closed（不取定位也不发）", async () => {
    const h = harness({ captureEnabled: async () => { throw new Error("storage unavailable"); } });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.getFix).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("实时位置同意 = false ⇒ 不取定位也不发", async () => {
    const h = harness({ locationConsentActive: async () => false });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.getFix).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("实时位置同意读失败 ⇒ fail-closed（不取定位也不发）", async () => {
    const h = harness({ locationConsentActive: async () => { throw new Error("consent endpoint 500"); } });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.getFix).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("同意不成立时不记「已发」——否则用户后来开了同意还要等 30 分钟", async () => {
    const h = harness({ captureEnabled: async () => false });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.marked).toHaveLength(0);
  });
});

describe("粗略位置上报：取不到定位就不发", () => {
  it("getFix 返回 undefined ⇒ 不发、不记已发", async () => {
    const h = harness({ getFix: async () => undefined });
    await reportCoarseLocationIfDue(h.deps);
    expect(h.getFix).toHaveBeenCalledTimes(1);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.marked).toHaveLength(0);
  });

  it("getFix 抛错 ⇒ 当成没取到，不发也不抛", async () => {
    const h = harness({ getFix: async () => { throw new Error("GPS timeout"); } });
    await expect(reportCoarseLocationIfDue(h.deps)).resolves.toBeUndefined();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.marked).toHaveLength(0);
  });
});

describe("粗略位置上报：发送与坐标的处置", () => {
  it("两道同意都成立且拿到定位 ⇒ 发一次，记一次已发，坐标原样传给 send", async () => {
    const h = harness();
    await reportCoarseLocationIfDue(h.deps);
    expect(h.sent).toEqual([{ lat: 21.0285, lng: 105.8042 }]);
    expect(h.marked).toEqual([1_000_000]);
  });

  it("发送失败 ⇒ 不抛，且不记已发（下次到期还能重试，不静默吞掉整条管道）", async () => {
    const h = harness({ send: async () => { throw new Error("net down"); } });
    await expect(reportCoarseLocationIfDue(h.deps)).resolves.toBeUndefined();
    expect(h.marked).toHaveLength(0);
  });

  // 坐标是敏感个人数据：除了交给 send，不许出现在任何别的地方。
  it("坐标不进日志、不进持久化：唯一出口是 send 的两个入参", async () => {
    const logs: unknown[][] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args); })
    );
    const stored: unknown[] = [];
    let last: number | undefined;
    try {
      await reportCoarseLocationIfDue({
        now: () => 1_000_000,
        // lastSentAt / markSent 持久化的就是这一个时刻戳，没有别的可存。
        lastSentAt: () => last,
        markSent: (at) => { last = at; stored.push(at); },
        captureEnabled: async () => true,
        locationConsentActive: async () => true,
        getFix: async () => ({ lat: 21.0285, lng: 105.8042 }),
        send: async () => undefined
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(logs).toEqual([]);
    expect(stored).toEqual([1_000_000]);
    expect(JSON.stringify(stored)).not.toContain("21.0285");
    expect(JSON.stringify(stored)).not.toContain("105.8042");
  });
});