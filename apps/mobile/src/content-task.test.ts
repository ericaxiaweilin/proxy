import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canApprove,
  contentErrorText,
  formatDuration,
  formatTaskTime,
  parseContentTask,
  publicationUrlOk,
  publishProgress,
  taskTitle,
  tasksForTab,
  type ContentTaskView,
} from "./content-task";

// CONTENT-TASK-001：商家「生产内容」+ creator「我的内容任务」。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const page = strip(readFileSync(here("./surfaces/merchant-content.tsx"), "utf8"));
const creator = strip(readFileSync(here("./components/creator-content-tasks.tsx"), "utf8"));
const me = strip(readFileSync(here("./surfaces/merchant-me-r21-replacement.tsx"), "utf8"));
const orders = strip(readFileSync(here("./surfaces/me-orders.tsx"), "utf8"));

const task = (over: Partial<ContentTaskView>): ContentTaskView => parseContentTask({ id: "ct_1", stage: "SHOOTING", platforms: [], publications: [], ...over })!;

describe("CONTENT-TASK-001 纯函数", () => {
  it("tab：全部不含已结束；已发布含「已通过待发布」", () => {
    const list = [task({ id: "a", stage: "AWAITING" }), task({ id: "c", stage: "CLOSED" }), task({ id: "p", stage: "PUBLISHED" }), task({ id: "ok", stage: "APPROVED" })];
    expect(tasksForTab(list, "ALL").map((t) => t.id)).toEqual(["a", "p", "ok"]);
    expect(tasksForTab(list, "PUBLISHED").map((t) => t.id)).toEqual(["p", "ok"]);
    expect(tasksForTab(list, "AWAITING").map((t) => t.id)).toEqual(["a"]);
  });
  it("解析：未知阶段归为已结束，不当成进行中", () => {
    expect(task({ stage: "WHATEVER" as never }).stage).toBe("CLOSED");
    expect(parseContentTask({})).toBeUndefined();
  });
  it("标题空用邀约留言，再空写明未命名", () => {
    expect(taskTitle({ title: "", brief: "周末探店" })).toBe("周末探店");
    expect(taskTitle({ title: "", brief: "" })).toBe("未命名内容任务");
  });
  it("通过按钮：三项人工勾全且文案没有联系方式", () => {
    expect(canApprove({ storeClear: true, matchesReality: true, noCompetitor: true }, false)).toBe(true);
    expect(canApprove({ storeClear: true, matchesReality: true, noCompetitor: true }, true)).toBe(false);
    expect(canApprove({ storeClear: true, matchesReality: false, noCompetitor: true }, false)).toBe(false);
  });
  it("发布链接只认平台自己的 https 域名（和服务端同一规则）", () => {
    expect(publicationUrlOk("tiktok", "https://www.tiktok.com/@a/video/1")).toBe(true);
    expect(publicationUrlOk("tiktok", "https://vt.tiktok.com/xyz")).toBe(true);
    expect(publicationUrlOk("tiktok", "http://www.tiktok.com/@a")).toBe(false);
    expect(publicationUrlOk("tiktok", "https://evil.com/tiktok.com")).toBe(false);
    expect(publicationUrlOk("tiktok", "https://nottiktok.com/x")).toBe(false);
    expect(publicationUrlOk("facebook", "https://fb.watch/abc")).toBe(true);
  });
  it("发布进度、时长、时间、报错", () => {
    expect(publishProgress({ platforms: ["tiktok", "instagram"], publications: [{ platform: "tiktok", url: "u", publishedAt: "" }] })).toEqual({ done: 1, planned: 2 });
    expect(formatDuration(42)).toBe("0:42");
    expect(formatDuration(0)).toBe("");
    expect(formatTaskTime("")).toBe("");
    expect(formatTaskTime("0001-01-01T00:00:00Z")).toBe("");
    expect(contentErrorText("rejected CONTENT_HAS_CONTACT")).toContain("站外联系方式");
  });
});

describe("CONTENT-TASK-001 商家页照原型、不编数据", () => {
  it("数据只从内容任务命令来，操作都是真命令", () => {
    expect(page).toContain("supply.listMerchantContentTasks({ merchantId })");
    expect(page).toContain("supply.reviewContentDraft(");
    expect(page).toContain("supply.nudgeContentTask(");
    expect(page).toContain("supply.cancelInvitation({ merchantId, invitationId: t.invitationId })");
    expect(page).toContain("supply.createContentTask(");
  });
  it("没有平台播放 / 点赞 / 热评 / 报表导出这些拿不到的数", () => {
    expect(page).not.toMatch(/总播放|热评|导出分平台报表|52\.4w|19\.6w|¥/);
    expect(page).toContain("Proxy 还没接各平台的数据接口");
    expect(page).toContain("按达人统计，不是单条视频");
  });
  it("审核：站外联系方式是自动项，其余三项人工勾", () => {
    expect(page).toContain("t.draftHasContact");
    expect(page).toContain('label="门店画面是否清晰"');
    expect(page).toContain('label="是否与实物相符"');
    expect(page).toContain('label="是否有竞品露出"');
    expect(page).toContain("打回要写原因");
  });
  it("我的 → 生产内容挂的是这一页，不再自己拉一份邀约", () => {
    expect(me).toContain("<MerchantContentSurface");
    expect(me).not.toContain("contentInvites");
  });
});

describe("CONTENT-TASK-001 creator 侧", () => {
  it("我的订单里挂「我的内容任务」：交稿 / 贴链接走真命令", () => {
    expect(orders).toContain("<CreatorContentTasks supply={supply} mediaClient={mediaClient}");
    expect(creator).toContain("supply.listMyContentTasks()");
    expect(creator).toContain("supply.submitContentDraft(");
    expect(creator).toContain("supply.addContentPublication(");
    expect(creator).toContain("publicationUrlOk(platform, url)");
  });
});

// 实机发现：弹层包在可点的 Pressable 里、ScrollView 不收缩 ⇒ 长表单底部按钮被裁掉、滑不动。
describe("CONTENT-TASK-001 弹层能滑到底", () => {
  it("生产内容 / 专属码两页的弹层：背景和弹层是兄弟节点，ScrollView 可收缩", () => {
    const promo = readFileSync(here("./surfaces/merchant-promo.tsx"), "utf8");
    for (const src of [page, strip(promo)]) {
      expect(src).toContain("style={s.sheetScroll}");
      expect(src).toContain("sheetScroll: { flexShrink: 1 }");
      expect(src).not.toContain("<Pressable style={s.sheet} onPress={() => undefined}>");
    }
  });
});

