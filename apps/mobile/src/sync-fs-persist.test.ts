import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// SYNC-FS-001: File.json() returns a Promise on Expo 57 — every synchronous
// consumer got a Promise object back: Array.isArray(Promise) is always
// false, so five local-persistence read paths silently fell back to
// defaults (swipe-deleted conversations resurrected, feed prefs / custom
// channels / creator drafts never restored). The fix awaits json() and
// routes parsing through local-snapshot.ts (pure, unit-tested) or the
// stores' own parse helpers. This test pins the invocation forms: any
// read helper regressing to an un-awaited .json() call must fail loudly.

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const messages = source("./surfaces/messages.tsx");
const creator = source("./surfaces/creator-application.tsx");
const prefsStore = source("./expo-feed-prefs-store.ts");
const feedsStore = source("./expo-custom-feed-store.ts");
const snapshot = source("./local-snapshot.ts");

function block(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  if (start === -1) throw new Error("guard anchor missing: " + from);
  const end = src.indexOf(to, start);
  return src.slice(start, end === -1 ? undefined : end);
}

describe("SYNC-FS-001 local persistence reads must await File.json()", () => {
  it("messages.tsx: hidden chats read via await + parse layer (folders removed)", () => {
    // MSG-GROUPS-TAB-001: 自建文件夹已摘，readFoldersAsync 跟着消失 ——
    // 隐藏会话是唯一剩下的本机落盘读入口，不断言已删除的东西。
    const hidden = block(messages, "export async function readHiddenChatIdsAsync", "export function MessagesSurface");
    expect(hidden).toContain("await hiddenChatsFile.json()");
    expect(hidden).toContain("parseHiddenChatIds");
  });

  it("creator-application.tsx: creator draft read via await + parse layer", () => {
    const fn = block(creator, "export async function readCreatorSnapshotAsync", "export function CreatorInvitationCard");
    expect(fn).toContain("await creatorFile.json()");
    expect(fn).toContain("parseCreatorSnapshot");
  });

  it("prefs and custom-feed stores read via await + own parse helpers", () => {
    const prefs = block(prefsStore, "export async function readFeedPrefsAsync", "export function writeFeedPrefs");
    expect(prefs).toContain("await snapshotFile.json()");
    expect(prefs).toContain("parseFeedPrefsSnapshot");
    const feeds = block(feedsStore, "export async function readCustomFeedsAsync", "export function writeCustomFeeds");
    expect(feeds).toContain("await snapshotFile.json()");
    expect(feeds).toContain("parseCustomFeedsSnapshot");
  });

  it("parse layer exists and is unit-tested (Promise input is rejected safely)", () => {
    // The pure parse layer is the single place malformed/promise input
    // collapses to safe defaults; local-snapshot.test.ts pins its behavior.
    expect(snapshot).toContain("export function parseHiddenChatIds");
    expect(snapshot).toContain("export function parseCreatorSnapshot");
  });

  it("store mocks model the real async File.json() (no fake-sync mocks)", () => {
    // pitfall 41: a sync json() mock makes the suite green while the real
    // device still breaks. Mocks must stay async like the real API.
    const prefsMock = source("./expo-feed-prefs-store.test.ts");
    expect(prefsMock).toContain("async json(): Promise<unknown>");
    const feedsMock = source("./expo-custom-feed-store.test.ts");
    expect(feedsMock).toContain("async json(): Promise<unknown>");
  });
});
