import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PLACEHOLDER-001: 占位按钮/字段必须走真实逻辑，不能只弹演示 toast。
// friend-crm / messages / tasks / ProfileTabs / me-wallet 曾有 20+ 个
// 死按钮与编造字段。v2 方向：mock 数据全部保留作测试替身，但每个按钮
// 都必须走通——有后端调后端（Share/BlockFriend/接受忽略/点赞），无后端
// 走本地演示状态机（添加变已发送、请求可接受/忽略、拉黑即时移除）。
// 本文件是源码级 tripwire：假字符串回来了就红；真接线关键字丢了也红。
const crm = readFileSync(fileURLToPath(new URL("./friend-crm.tsx", import.meta.url)), "utf8");
const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");
const tasks = readFileSync(fileURLToPath(new URL("./tasks.tsx", import.meta.url)), "utf8");
const tabs = readFileSync(fileURLToPath(new URL("./ProfileTabs.tsx", import.meta.url)), "utf8");
const me = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
const meSub = readFileSync(fileURLToPath(new URL("./me-sub-pages.ts", import.meta.url)), "utf8");

describe("PLACEHOLDER-001 friend-crm keeps mocks but wires every action", () => {
  it("drops only the invented self identity and dead stubs", () => {
    // PX-827491/Huyen Nguyen 是冒充本人的假身份，必须彻底消失；
    // 通讯录/社媒/搜索 mock 是测试替身，保留但必须可操作（见下）。
    for (const dead of ["PX-827491", "Huyen Nguyen", "fakeQr", "原型查看", "主页已打开"]) {
      expect(crm).not.toContain(dead);
    }
    for (const mock of ["CONTACT_MATCHES", "SOCIAL_MATCHES", "SEARCH_RESULTS", "模拟识别"]) {
      expect(crm).toContain(mock);
    }
  });

  it("never toasts a send that did not happen", () => {
    for (const lie of ['showToast("好友请求已发送")', 'showToast("咖啡券已发送', 'showToast("体验邀约已发送")', "已拉黑（演示）", "已移除好友（演示）"]) {
      expect(crm).not.toContain(lie);
    }
  });

  it("runs add/invite through a real local state machine", () => {
    // 添加→已发送（setSentIds 真实翻转并禁用按钮），扫码模拟→预填并跳搜索。
    expect(crm).toContain("setSentIds");
    expect(crm).toContain("已发送");
    expect(crm).toContain('setProxySearch("PX-937201")');
    expect(crm).toContain("Share.share");
    expect(crm).toContain("登录后显示你的邀请名片");
  });

  it("accepts/ignores/blocks with immediate effect in both modes", () => {
    expect(crm).toContain("acceptDemoRequest");
    expect(crm).toContain("ignoreDemoRequest");
    expect(crm).toContain("removeDemoFriend");
    expect(crm).toContain("acceptFriendRequest");
    expect(crm).toContain("blockFriend");
    expect(crm).toContain("requestErrorMessage");
  });

  it("renders the server friend list next to the demo list, no nested pressables", () => {
    expect(crm).toContain("serverMode");
    expect(crm).toContain("visible.length");
    expect(crm).toContain("本地好友");
    expect(crm).toContain("服务端好友");
    expect(crm).toContain("friendMain");
    expect(crm).toContain("好友列表加载失败");
  });

  it("passes the viewer identity from Me instead of inventing one", () => {
    expect(me).toContain("viewer={{ name: profileDraft.name");
    expect(me).toContain("onOpenVouchers={onOpenVouchers}");
  });
});

describe("PLACEHOLDER-001 messages/tasks/ProfileTabs dead buttons", () => {
  it("messages person view keeps only working actions", () => {
    for (const dead of ["资料", "更多", "folderAdd", "ellipsis", "添加文件夹"]) {
      expect(messages).not.toContain(dead);
    }
    expect(messages).toContain("分享联系人");
  });

  it("tasks drops group-chat/match stubs, shares for real", () => {
    expect(tasks).not.toContain("进入活动群聊");
    expect(tasks).not.toContain("查看参与者匹配");
    expect(tasks).toContain("找人一起参加");
    expect(tasks).toContain("Share.share");
  });

  it("profile post actions are wired, more opens share", () => {
    expect(tabs).toContain("onLikePost");
    expect(tabs).toContain("sharePost");
    expect(tabs).toContain('accessibilityLabel="分享帖子"');
  });
});

describe("PLACEHOLDER-001 wallet/income shows unknown instead of invented money", () => {
  it("has no hardcoded balances", () => {
    for (const fake of ["860,000", "1,200,000", "2,450,000"]) {
      expect(me).not.toContain(fake);
      expect(meSub).not.toContain(fake);
    }
    expect(meSub).not.toContain('"44%"');
  });

  it("routes wallet records to the real orders surface", () => {
    expect(me).toContain('openSubPage("myorders")');
    expect(me).toContain("账本接口未接入前不编造余额");
  });

  it("wires profile like to engagement with a visible failure", () => {
    expect(me).toContain("onLikePost={engagement");
    expect(me).toContain("点赞没有提交成功");
  });
});
