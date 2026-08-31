// composer-body.test.ts — 验证 ComposerV2Screen 的 body 序列化逻辑
// (v2 引入的 GIF/投票/24h/引用/地点/话题均为 UI-only；发布时拼到 body 前缀)

import { describe, expect, it } from "vitest";
import type { FeedPost } from "@proxy/contracts";
import type { AnyLocation } from "./components/location-picker-sheet";
import { assembleComposerBody, parseComposerBody, parsePollDurationMs, formatRelativeTime, describePollDuration, appendLongText, estimateAssembledBodyLength, insertAtCaret, shouldSerializePoll } from "./composer-body";

const quotePost: FeedPost = {
  postId: "p1",
  authorType: "USER",
  authorId: "u1",
  authorDisplayName: "Linh",
  body: "周日下午去西湖拍照。",
  mediaRefs: [],
  status: "READY",
  contextRefs: [],
  createdAt: "2024-01-01T00:00:00Z"
};

const hanoiLocation: AnyLocation = {
  id: "hn-swordlake",
  city: "河内",
  area: "还剑湖附近",
  kind: "PRESET"
};

describe("assembleComposerBody", () => {
  it("纯 body", () => {
    expect(assembleComposerBody({
      body: "hello",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    })).toBe("hello");
  });

  it("24h 切换在最前", () => {
    const out = assembleComposerBody({
      body: "今早阳光很好",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: true,
      quoteTarget: undefined
    });
    expect(out.startsWith("⏱ [24h 临时动态]")).toBe(true);
    expect(out.endsWith("今早阳光很好")).toBe(true);
  });

  it("GIF 拼接", () => {
    const out = assembleComposerBody({
      body: "看完演出",
      gifWord: "WOW",
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toContain("🎬 GIF: WOW");
    expect(out).toContain("看完演出");
  });

  it("投票：4 项 + 序号 + duration", () => {
    const out = assembleComposerBody({
      body: "想看哪种口味？",
      gifWord: null,
      poll: { open: true, options: ["甜", "辣", "酸", "苦"], durationLabel: "2 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toContain("📊 投票 · 2 天");
    expect(out).toContain("① 甜");
    expect(out).toContain("② 辣");
    expect(out).toContain("③ 酸");
    expect(out).toContain("④ 苦");
  });

  it("空选项占位 —", () => {
    const out = assembleComposerBody({
      body: "",
      gifWord: null,
      poll: { open: true, options: ["A", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toContain("① A");
    expect(out).toContain("② —");
  });

  it("地点 → 📍 区域名", () => {
    const out = assembleComposerBody({
      body: "",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: hanoiLocation,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toContain("📍 还剑湖附近");
  });

  it("话题原文嵌入", () => {
    const out = assembleComposerBody({
      body: "",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: "# 河内周末",
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toContain("# 河内周末");
  });

  it("引用超长截断到 88 字 + …", () => {
    const long = "a".repeat(100);
    const out = assembleComposerBody({
      body: "我的回复",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: { ...quotePost, body: long }
    });
    expect(out).toContain(`↩ 引用 Linh: ${"a".repeat(88)}…`);
    expect(out).toContain("我的回复");
  });

  it("组合：24h + GIF + 引用 + body（按顺序）", () => {
    const out = assembleComposerBody({
      body: "我同意",
      gifWord: "OK",
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: true,
      quoteTarget: quotePost
    });
    // 顺序: 24h > gif > place > topic > quote > body
    expect(out).toMatch(/^⏱.*\n\n🎬.*\n\n↩.*\n\n我同意$/);
  });

  it("空 body + 所有装饰为 null：返回空字符串", () => {
    const out = assembleComposerBody({
      body: "",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    });
    expect(out).toBe("");
  });
});

// —— 反向解析 ——

describe("parseComposerBody", () => {
  it("纯 body 反向", () => {
    expect(parseComposerBody("hello")).toEqual({
      cleanBody: "hello",
      isGhost24h: false,
      gifWord: null,
      poll: null,
      topic: null
    });
  });

  it("空字符串反向后全空", () => {
    expect(parseComposerBody("")).toEqual({
      cleanBody: "",
      isGhost24h: false,
      gifWord: null,
      poll: null,
      topic: null
    });
  });

  it("24h 拆出，body 保留", () => {
    const out = parseComposerBody("⏱ [24h 临时动态]\n\n今早阳光很好");
    expect(out.isGhost24h).toBe(true);
    expect(out.cleanBody).toBe("今早阳光很好");
  });

  it("GIF 拆出", () => {
    const out = parseComposerBody("🎬 GIF: WOW\n\n刚看完演出");
    expect(out.gifWord).toBe("WOW");
    expect(out.cleanBody).toBe("刚看完演出");
  });

  it("投票拆出 + options 占位 — 转空", () => {
    const out = parseComposerBody("📊 投票 · 2 天\n  ① 甜\n  ② —\n  ③ 辣\n\n想吃什么");
    expect(out.poll).toEqual({
      open: true,
      options: ["甜", "", "辣"],
      durationLabel: "2 天"
    });
    expect(out.cleanBody).toBe("想吃什么");
  });

  it("话题拆出", () => {
    const out = parseComposerBody("# 河内周末\n\n下午拍照");
    expect(out.topic).toBe("# 河内周末");
    expect(out.cleanBody).toBe("下午拍照");
  });

  it("组合：24h + GIF + 投票 + 话题 + body", () => {
    const body = "⏱ [24h 临时动态]\n\n🎬 GIF: OK\n\n📊 投票 · 1 天\n  ① A\n  ② B\n\n📍 还剑湖附近\n\n# 河内周末\n\n↩ 引用 Linh: 周日下午去西湖拍照。\n\n我的回复";
    const out = parseComposerBody(body);
    expect(out.isGhost24h).toBe(true);
    expect(out.gifWord).toBe("OK");
    expect(out.poll?.options).toEqual(["A", "B"]);
    expect(out.poll?.durationLabel).toBe("1 天");
    expect(out.topic).toBe("# 河内周末");
    // 引用 + 地点 不被解析（靠外部状态），cleanBody 里剩余它们
    expect(out.cleanBody).toContain("📍 还剑湖附近");
    expect(out.cleanBody).toContain("↩ 引用 Linh");
    expect(out.cleanBody).toContain("我的回复");
  });

  it("占位 — 不写入 options（视为空输入）", () => {
    const out = parseComposerBody("📊 投票 · 1 天\n  ① —\n  ② —\n\nbody");
    expect(out.poll?.options).toEqual(["", ""]);
  });

  it("未知前缀不解析，原样保留到 cleanBody", () => {
    const out = parseComposerBody("🎵 歌曲: X\n\nmy body");
    expect(out.gifWord).toBeNull();
    expect(out.cleanBody).toBe("🎵 歌曲: X\n\nmy body");
  });

  it("roundtrip: assemble → parse 不丢失装饰", () => {
    const original = {
      body: "今天下午",
      gifWord: "LOL" as string | null,
      poll: { open: true, options: ["甜", "辣"], durationLabel: "3 天" } as { open: boolean; options: string[]; durationLabel: string },
      place: null as null,
      topic: "# 咖啡店" as string | null,
      isGhost24h: true,
      quoteTarget: undefined as FeedPost | undefined
    };
    const text = assembleComposerBody(original);
    const parsed = parseComposerBody(text);
    expect(parsed.isGhost24h).toBe(true);
    expect(parsed.gifWord).toBe("LOL");
    expect(parsed.poll?.options).toEqual(["甜", "辣"]);
    expect(parsed.poll?.durationLabel).toBe("3 天");
    expect(parsed.topic).toBe("# 咖啡店");
    expect(parsed.cleanBody).toBe("今天下午");
  });
});

// —— 投票时长解析 ——

describe("parsePollDurationMs", () => {
  it("天", () => {
    expect(parsePollDurationMs("1 天")).toBe(24 * 3600 * 1000);
    expect(parsePollDurationMs("2 天")).toBe(48 * 3600 * 1000);
    expect(parsePollDurationMs("7 天")).toBe(168 * 3600 * 1000);
  });
  it("小时", () => {
    expect(parsePollDurationMs("1 小时")).toBe(3600 * 1000);
    expect(parsePollDurationMs("12 小时")).toBe(12 * 3600 * 1000);
  });
  it("分钟", () => {
    expect(parsePollDurationMs("30 分钟")).toBe(30 * 60 * 1000);
  });
  it("非法输入回退 1 天", () => {
    expect(parsePollDurationMs("forever")).toBe(24 * 3600 * 1000);
    expect(parsePollDurationMs("")).toBe(24 * 3600 * 1000);
    expect(parsePollDurationMs("0 天")).toBe(24 * 3600 * 1000);
    expect(parsePollDurationMs("-1 天")).toBe(24 * 3600 * 1000);
  });
  it("容错空格", () => {
    expect(parsePollDurationMs("1天")).toBe(24 * 3600 * 1000);
    expect(parsePollDurationMs("  2  天  ")).toBe(48 * 3600 * 1000);
  });
});

// —— 相对时间格式化 ——

describe("formatRelativeTime", () => {
  const NOW = new Date("2026-01-15T12:00:00Z").getTime();
  const iso = (deltaMs: number) => new Date(NOW - deltaMs).toISOString();

  it("< 1 分钟 → 刚刚", () => {
    expect(formatRelativeTime(iso(0), NOW)).toBe("刚刚");
    expect(formatRelativeTime(iso(30_000), NOW)).toBe("刚刚");
    expect(formatRelativeTime(iso(59_999), NOW)).toBe("刚刚");
  });

  it("分钟级", () => {
    expect(formatRelativeTime(iso(60_000), NOW)).toBe("1 分钟前");
    expect(formatRelativeTime(iso(59 * 60_000), NOW)).toBe("59 分钟前");
  });

  it("小时级", () => {
    expect(formatRelativeTime(iso(60 * 60_000), NOW)).toBe("1 小时前");
    expect(formatRelativeTime(iso(23 * 60 * 60_000), NOW)).toBe("23 小时前");
  });

  it("天级", () => {
    expect(formatRelativeTime(iso(24 * 60 * 60_000), NOW)).toBe("1 天前");
    expect(formatRelativeTime(iso(29 * 24 * 60 * 60_000), NOW)).toBe("29 天前");
  });

  it(">= 30 天 → 较早", () => {
    expect(formatRelativeTime(iso(30 * 24 * 60 * 60_000), NOW)).toBe("较早");
    expect(formatRelativeTime(iso(365 * 24 * 60 * 60_000), NOW)).toBe("较早");
  });

  it("非法输入 → 刚刚", () => {
    expect(formatRelativeTime("", NOW)).toBe("刚刚");
    expect(formatRelativeTime("not-a-date", NOW)).toBe("刚刚");
  });
});

// —— 投票时长描述 ——

describe("describePollDuration", () => {
  it("天级 → N 天后截止", () => {
    expect(describePollDuration("1 天")).toBe("1 天后截止");
    expect(describePollDuration("3 天")).toBe("3 天后截止");
    expect(describePollDuration("7 天")).toBe("7 天后截止");
  });
  it("小时级 → N 小时后截止", () => {
    expect(describePollDuration("1 小时")).toBe("1 小时后截止");
    expect(describePollDuration("2 小时")).toBe("2 小时后截止");
    expect(describePollDuration("23 小时")).toBe("23 小时后截止");
  });
  it("分钟级 → N 分钟后截止", () => {
    expect(describePollDuration("30 分钟")).toBe("30 分钟后截止");
    expect(describePollDuration("45 分钟")).toBe("45 分钟后截止");
  });
  it("非法输入 → 默认 1 天后截止", () => {
    expect(describePollDuration("nonsense")).toBe("1 天后截止");
    expect(describePollDuration("")).toBe("1 天后截止");
  });
});

// —— 长文追加 ——

describe("appendLongText", () => {
  it("空 body + 非空 extra → 直接拼接，无前缀换行", () => {
    const r = appendLongText("", "段落", 100);
    expect(r.body).toBe("段落");
    expect(r.truncated).toBe(false);
  });

  it("非空 body + extra → 双换行分隔", () => {
    const r = appendLongText("上段", "下段", 100);
    expect(r.body).toBe("上段\n\n下段");
    expect(r.truncated).toBe(false);
  });

  it("extra 全部填入 room → 原样拼接", () => {
    const r = appendLongText("ab", "c", 5);
    // body=2, prefix=2, room=3, extra=1, 1 <= 3 → 不截
    expect(r.body).toBe("ab\n\nc");
    expect(r.truncated).toBe(false);
  });

  it("超出 maxTotal → 截断，truncated=true", () => {
    const r = appendLongText("上段", "很多很多很多", 8);
    // body=2, prefix=2, room=4, extra=6 → 截到 4 个中文
    expect(r.body.length).toBe(8);
    expect(r.truncated).toBe(true);
    expect(r.body).toBe("上段\n\n很多很多");
  });

  it("room <= 0 → 不拼接，truncated=true, body 不变", () => {
    const r = appendLongText("撑满", "x", 2);
    expect(r.body).toBe("撑满");
    expect(r.truncated).toBe(true);
  });

  it("extra 为空 → 不变", () => {
    expect(appendLongText("原", "", 100)).toEqual({ body: "原", truncated: false });
    expect(appendLongText("原", "   ", 100)).toEqual({ body: "原", truncated: false });
  });

  it("trim 后拼接（保留首尾内容、去除额外空白）", () => {
    const r = appendLongText("上文", "  这是一段  ", 100);
    expect(r.body).toBe("上文\n\n这是一段");
    expect(r.truncated).toBe(false);
  });
});

// —— 光标位置插入 ——

describe("insertAtCaret", () => {
  it("空 body → 插入位置 0 → caret = ins.length", () => {
    const r = insertAtCaret("", { start: 0, end: 0 }, "@Linh ");
    expect(r.body).toBe("@Linh ");
    expect(r.caret).toBe(6);
  });

  it("body 末尾插入 → 补一个空格", () => {
    const r = insertAtCaret("hello", { start: 5, end: 5 }, "@Linh ");
    expect(r.body).toBe("hello @Linh ");
    expect(r.caret).toBe(12);
  });

  it("body 中间插入（左右有文字）→ 自动补一个空格在左边", () => {
    const r = insertAtCaret("前面后面", { start: 2, end: 2 }, "@Linh ");
    expect(r.body).toBe("前面 @Linh 后面");
    expect(r.caret).toBe(9);
  });

  it("左边已有空格 → 不重复加", () => {
    const r = insertAtCaret("前面 后面", { start: 3, end: 3 }, "@Linh ");
    expect(r.body).toBe("前面 @Linh 后面");
    expect(r.caret).toBe(9);
  });

  it("左边是换行 → 不加空格", () => {
    const r = insertAtCaret("前面\n后面", { start: 3, end: 3 }, "@Linh ");
    expect(r.body).toBe("前面\n@Linh 后面");
    expect(r.caret).toBe(9);
  });

  it("选中范围插入 → 用 start 作为基准", () => {
    const r = insertAtCaret("hello world", { start: 6, end: 11 }, "@Linh ");
    expect(r.body).toBe("hello @Linh ");
    expect(r.caret).toBe(12);
  });

  it("insert 以空格开头 → 不补前缀空格", () => {
    const r = insertAtCaret("hello", { start: 5, end: 5 }, " world");
    expect(r.body).toBe("hello world");
    expect(r.caret).toBe(11);
  });

  it("超出 caret 越界 → 截到 body.length（光标在末尾，补空格）", () => {
    const r = insertAtCaret("abc", { start: 100, end: 100 }, "x");
    expect(r.body).toBe("abc x");
    expect(r.caret).toBe(5);
  });
});

// —— 投票能否序列化 ——

describe("shouldSerializePoll", () => {
  const pollOpen = (options: string[]): { open: true; options: string[]; durationLabel: string } => ({
    open: true,
    options,
    durationLabel: "1 天"
  });
  const pollClosed: { open: false; options: string[]; durationLabel: string } = {
    open: false,
    options: ["", ""],
    durationLabel: "1 天"
  };

  it("open=false → false", () => {
    expect(shouldSerializePoll(pollClosed)).toBe(false);
  });
  it("open=true + 全空 → false（避免发空投票）", () => {
    expect(shouldSerializePoll(pollOpen(["", ""]))).toBe(false);
    expect(shouldSerializePoll(pollOpen(["   ", ""]))).toBe(false);
  });
  it("open=true + 任一非空 → true", () => {
    expect(shouldSerializePoll(pollOpen(["A", ""]))).toBe(true);
    expect(shouldSerializePoll(pollOpen(["", "B"]))).toBe(true);
    expect(shouldSerializePoll(pollOpen(["A", "B"]))).toBe(true);
  });
});

// —— 估计拼装后长度 ——

describe("estimateAssembledBodyLength", () => {
  it("纯 body → 等于 body.length", () => {
    expect(estimateAssembledBodyLength({
      body: "12345",
      gifWord: null,
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: false,
      quoteTarget: undefined
    })).toBe(5);
  });

  it("24h + gif + body → 包含所有前缀", () => {
    const len = estimateAssembledBodyLength({
      body: "正文",
      gifWord: "OK",
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: true,
      quoteTarget: undefined
    });
    expect(len).toBeGreaterThan(2);
    expect(len).toBe(assembleComposerBody({
      body: "正文",
      gifWord: "OK",
      poll: { open: false, options: ["", ""], durationLabel: "1 天" },
      place: null,
      topic: null,
      isGhost24h: true,
      quoteTarget: undefined
    }).length);
  });

  it("vote open + quote + body → 包含投票行与引用行", () => {
    const len = estimateAssembledBodyLength({
      body: "我的评论",
      gifWord: null,
      poll: { open: true, options: ["A", "B"], durationLabel: "1 天" },
      place: { area: "还剑湖" },
      topic: "# 河内周末",
      isGhost24h: false,
      quoteTarget: {
        postId: "p1",
        authorType: "USER",
        authorId: "u1",
        authorDisplayName: "Linh",
        body: "原帖",
        mediaRefs: [],
        status: "READY",
        contextRefs: [],
        createdAt: new Date().toISOString()
      }
    });
    expect(len).toBeGreaterThan(50);
  });
});
