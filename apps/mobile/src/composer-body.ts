// composer-body.ts — ComposerV2Screen 的正文序列化逻辑
//
// 历史背景：GIF / 投票 / 24h 这些 UI-only 装饰项早期无对应后端字段，
// 发布时拼到 body 文本前缀（🎬 / 📊 / ⏱）。
// R15.24 起共享契约已定义 ephemeralUntil / poll 字段（@proxy/contracts），
// 但服务端尚未持久化这两个字段。发送时同时带 schema 字段与 body 文本；当前
// 服务器依靠 body fallback 保留语义，待服务端落地后再以 schema 为准。本文件保留正文序列化与反向解析
// 两个函数以保持草稿恢复（重启后能从 body 文本回填 UI 状态）。

import type { FeedPost } from "@proxy/contracts";
import type { AnyLocation } from "./components/location-picker-sheet";

export type PollStateForBody = {
  open: boolean;
  options: string[];
  durationLabel: string;
};

export type ComposerBodyInput = {
  body: string;
  gifWord: string | null;
  poll: PollStateForBody;
  place: AnyLocation | null;
  topic: string | null;
  isGhost24h: boolean;
  quoteTarget: FeedPost | undefined;
};

const POLL_GLYPHS = ["①", "②", "③", "④"];

/**
 * 轻量相对时间格式化（不引 dayjs）。用于引用选择 sheet / 引用卡等。
 * 可注入 `now` 以便单测。
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "刚刚";
  const diffMs = now - t;
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return "较早";
}

/**
 * 估计最终拼装后的 body 长度（包含装饰前缀 + quote 行）。
 * 用于在 UI 上提前预警 body 总长，避免发布后超出后端限额。
 */
export function estimateAssembledBodyLength(input: {
  body: string;
  gifWord: string | null;
  poll: PollStateForBody;
  place: { area: string } | null;
  topic: string | null;
  isGhost24h: boolean;
  quoteTarget: FeedPost | undefined;
}): number {
  // 只关心 area 与 quoteTarget 的长度；这里伪造最小化 place 与 quoteTarget 以满足类型
  const minimalPlace = input.place
    ? ({ id: "x", city: "x", area: input.place.area, kind: "PRESET" } as AnyLocation)
    : null;
  return assembleComposerBody({
    body: input.body,
    gifWord: input.gifWord,
    poll: input.poll,
    place: minimalPlace,
    topic: input.topic,
    isGhost24h: input.isGhost24h,
    quoteTarget: input.quoteTarget
  }).length;
}

/**
 * 在光标位置插入一段文本。如果 left 不以空格/换行结尾且 body 非空，则补一个空格。
 * 返回 { body, caret }：新 body 和建议设置的新光标位置。
 *
 * 使用样例：@提及插入、GIF 词、长文追加。
 */
export function insertAtCaret(
  body: string,
  caret: { start: number; end: number },
  insert: string
): { body: string; caret: number } {
  const safeStart = Math.max(0, Math.min(caret.start, body.length));
  const safeEnd = Math.max(0, Math.min(caret.end, body.length));
  const before = body.slice(0, safeStart);
  const after = body.slice(safeEnd);
  const needsSpaceBefore = insert.length > 0
    && before.length > 0
    && !before.endsWith(" ")
    && !before.endsWith("\n")
    && !insert.startsWith(" ");
  const prefix = needsSpaceBefore ? " " : "";
  const next = before + prefix + insert + after;
  const newCaret = safeStart + prefix.length + insert.length;
  return { body: next, caret: newCaret };
}

/**
 * 长文追加：把 extra 接到 body 后面，超出 maxTotal 时截断。
 * 返回 { body: string, truncated: boolean }。
 * body 或 extra 为空时返回原 body / truncated=false。
 */
export function appendLongText(body: string, extra: string, maxTotal: number): { body: string; truncated: boolean } {
  const trimmedExtra = extra.trim();
  if (!trimmedExtra) return { body, truncated: false };
  const prefix = body.trim() ? "\n\n" : "";
  const room = maxTotal - body.length - prefix.length;
  if (room <= 0) return { body, truncated: true };
  if (trimmedExtra.length <= room) {
    return { body: body + prefix + trimmedExtra, truncated: false };
  }
  return { body: body + prefix + trimmedExtra.slice(0, room), truncated: true };
}

/**
 * 解析投票时长标签为毫秒数。
 * 支持 "1 天" / "2 天" / "1 小时" / "30 分钟"。无法识别时回退 1 天。
 */
export function parsePollDurationMs(label: string): number {
  const trimmed = label.trim();
  const m = trimmed.match(/^(\d+)\s*(天|小时|分钟)$/);
  if (!m) return 24 * 3600 * 1000;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 24 * 3600 * 1000;
  const unit = m[2];
  if (unit === "天") return n * 24 * 3600 * 1000;
  if (unit === "小时") return n * 3600 * 1000;
  return n * 60 * 1000;
}

/**
 * 将投票时长 label 转为自然语言描述。
 * 例："1 天" → "1 天后截止"，"30 分钟" → "30 分钟后截止"。
 * 仅用于 UI 提示，不参与后端逻辑。
 */
export function describePollDuration(label: string): string {
  const ms = parsePollDurationMs(label);
  if (ms <= 0 || !Number.isFinite(ms)) return "1 天后截止";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} 分钟后截止`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} 小时后截止`;
  const days = Math.round(ms / (24 * 3_600_000));
  return `${days} 天后截止`;
}
const GHOST24H_PREFIX = "⏱ [24h 临时动态]";
const GIF_PREFIX = "🎬 GIF: ";
const POLL_PREFIX = "📊 投票 · ";
const TOPIC_PREFIX = "# ";

/**
 * 投票是否应该被序列化到 body 或 schema。
 * 要求至少 1 个非空选项（避免用户误开又忘了输入）。
 */
export function shouldSerializePoll(poll: PollStateForBody): boolean {
  if (!poll.open) return false;
  return poll.options.some((o) => o.trim().length > 0);
}

function pollBlock(poll: PollStateForBody): string | undefined {
  if (!shouldSerializePoll(poll)) return undefined;
  const opts = poll.options
    .map((o, i) => `  ${POLL_GLYPHS[i] ?? i + 1} ${o || "—"}`)
    .join("\n");
  return `${POLL_PREFIX}${poll.durationLabel}\n${opts}`;
}

function quoteBlock(quote: FeedPost | undefined): string | undefined {
  if (!quote) return undefined;
  const author = quote.authorDisplayName ?? "某人";
  const body = quote.body ?? "";
  const ellipsis = body.length > 88 ? "…" : "";
  return `↩ 引用 ${author}: ${body.slice(0, 88)}${ellipsis}`;
}

/**
 * 把可视装饰项 (gif / poll / place / topic / 24h / quote) 拼到 body 文本前缀。
 * 顺序按"越靠前越醒目"：24h > gif > poll > place > topic > quote > body
 */
export function assembleComposerBody(input: ComposerBodyInput): string {
  const segments: string[] = [];
  if (input.isGhost24h) segments.push(GHOST24H_PREFIX);
  if (input.gifWord) segments.push(`${GIF_PREFIX}${input.gifWord}`);
  const poll = pollBlock(input.poll);
  if (poll) segments.push(poll);
  if (input.place) segments.push(`📍 ${input.place.area}`);
  if (input.topic) segments.push(input.topic);
  const quote = quoteBlock(input.quoteTarget);
  if (quote) segments.push(quote);
  segments.push(input.body.trim());
  return segments.filter(Boolean).join("\n\n");
}

// ── 反向解析 ──
//
// 从已发布的 body 里拆出可视装饰项，重新填充 UI 状态。
// 引用 (quote) 走 ComposerDraftSnapshot.quoteTargetId，不在 body 里；
// 地点 (place) 需要 AnyLocation 对象重建，也不靠 body 文本。
// 这里只解析：24h / GIF / 投票 / 话题。

export type ParsedComposerBody = {
  cleanBody: string;
  isGhost24h: boolean;
  gifWord: string | null;
  poll: PollStateForBody | null;
  topic: string | null;
};

const POLL_LINE_PREFIX = /^[\s]*[①②③④\d][\s]*(.*)$/;

function parsePollBlock(block: string): PollStateForBody | null {
  // 格式: "📊 投票 · 1 天\n  ① opt\n  ② opt..."
  const lines = block.split("\n");
  const head = lines[0] ?? "";
  if (!head.startsWith(POLL_PREFIX)) return null;
  const duration = head.slice(POLL_PREFIX.length).trim() || "1 天";
  const options: string[] = [];
  for (const line of lines.slice(1)) {
    const m = line.match(POLL_LINE_PREFIX);
    if (!m) continue;
    const opt = (m[1] ?? "").trim();
    // 占位 "—" 视为空字符串（UI 状态用 ""，序列化时再转回 "—"）
    options.push(opt === "—" ? "" : opt);
  }
  if (options.length === 0) return null;
  return { open: true, options, durationLabel: duration };
}

function parseTopic(segments: string[]): { topic: string | null; rest: string[] } {
  // 话题是一段 "# xxx"，不含 \n。多个 "#" 时只取第一段。
  const kept: string[] = [];
  let topic: string | null = null;
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (topic === null && trimmed.startsWith(TOPIC_PREFIX) && !trimmed.includes("\n")) {
      topic = trimmed;
      continue;
    }
    kept.push(seg);
  }
  return { topic, rest: kept };
}

export function parseComposerBody(input: string): ParsedComposerBody {
  let text = input;
  let isGhost24h = false;

  // 24h：必须是首段（位置敏感）
  if (text.startsWith(GHOST24H_PREFIX)) {
    isGhost24h = true;
    text = text.slice(GHOST24H_PREFIX.length).replace(/^\n+/, "");
  }

  // 按 \n\n 拆段，顺序扫描匹配 GIF / 投票
  const segments = text.split(/\n\n+/);
  const kept: string[] = [];
  let gifWord: string | null = null;
  let poll: PollStateForBody | null = null;

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (gifWord === null && trimmed.startsWith(GIF_PREFIX) && !trimmed.includes("\n")) {
      const word = trimmed.slice(GIF_PREFIX.length).trim();
      if (word) {
        gifWord = word;
        continue;
      }
    }
    if (poll === null && trimmed.startsWith(POLL_PREFIX)) {
      const parsed = parsePollBlock(trimmed);
      if (parsed) {
        poll = parsed;
        continue;
      }
    }
    kept.push(seg);
  }

  // 话题放最后扫描，避免被前面的规则误吃
  const topicResult = parseTopic(kept);

  return {
    cleanBody: topicResult.rest.join("\n\n").trim(),
    isGhost24h,
    gifWord,
    poll,
    topic: topicResult.topic
  };
}
