import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// PLACEHOLDER-001: 占位按钮/字段必须走真实逻辑，不能只弹演示 toast。
// friend-crm / messages / tasks / ProfileTabs / me-wallet 曾有 20+ 个
// 死按钮与编造字段（假扫码结果、假身份、假匹配人、假金额、假发送）。
// 本文件是源码级 tripwire：假字符串回来了就红；真接线关键字丢了也红。
const crm = readFileSync(fileURLToPath(new URL("./friend-crm.tsx", import.meta.url)), "utf8");
const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");
const tasks = readFileSync(fileURLToPath(new URL("./tasks.tsx", import.meta.url)), "utf8");
const tabs = readFileSync(fileURLToPath(new URL("./ProfileTabs.tsx", import.meta.url)), "utf8");
const me = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
const meSub = readFileSync(fileURLToPath(new URL("./me-sub-pages.ts", import.meta.url)), "utf8");

describe("PLACEHOLDER-001 friend-crm has no fake identity/match/send", () => {
  it("drops fake scan results, fake invite identity and fake matches", () => {
    // PX-937201 仅留在离线演示联系人常量里（CRM_FRIENDS），不再作为
    // 扫码识别结果或可发送对象出现；PX-827491（假冒本人身份）必须彻底消失。
    for (const dead of ["模拟识别", "PX-827491", "Huyen Nguyen", "fakeQr", "CONTACT_MATCHES", "SOCIAL_MATCHES", "sentIds", "原型查看", "主页已打开"]) {
      expect(crm).not.toContain(dead);
    }
  });

  it("never toasts a send that did not happen", () => {
    for (const lie of ['showToast("好友请求已发送")', 'showToast("咖啡券已发送', 'showToast("体验邀约已发送")', "已拉黑（演示）", "已移除好友（演示）"]) {
      expect(crm).not.toContain(lie);
    }
  });

  it("wires invite/voucher/block to real surfaces and explains the rest", () => {
    expect(crm).toContain("Share.share");
    expect(crm).toContain("登录后显示你的邀请名片");
    expect(crm).toContain("requestErrorMessage");
    expect(crm).toContain("blockFriend");
    expect(crm).toContain("拉黑只对服务端好友生效");
    expect(crm).toContain("仅本机");
  });

  it("renders the server friend list instead of only demo data", () => {
    expect(crm).toContain("serverMode");
    expect(crm).toContain("visible.length");
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
