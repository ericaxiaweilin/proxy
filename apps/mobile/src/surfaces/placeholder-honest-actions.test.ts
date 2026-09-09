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
const composer = readFileSync(fileURLToPath(new URL("./ComposerV2Screen.tsx", import.meta.url)), "utf8");
const storefront = readFileSync(fileURLToPath(new URL("./merchant-storefront.tsx", import.meta.url)), "utf8");

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

describe("PLACEHOLDER-001 composer thread is real local state, not a toast", () => {
  it("adds/edits/removes entries and serializes them into the published body", () => {
    expect(composer).not.toContain("原型功能");
    expect(composer).toContain("threadEntries");
    expect(composer).toContain("setThreadEntries");
    expect(composer).toContain("MAX_THREAD_ENTRIES");
    expect(composer).toContain("threadedBody");
    expect(composer).toContain("threadInput");
  });
});

describe("PLACEHOLDER-001 storefront public page shares, analytics without caliber stays unknown", () => {
  it("wires the public-homepage affordance to a real share", () => {
    expect(storefront).toContain("proxy.app/store/");
    expect(storefront).toContain('accessibilityLabel="分享公开主页链接"');
  });

  it("has no invented funnel numbers", () => {
    for (const fake of ["18.6k", "612 · 聊天", "338 · 聊天", "300,000"]) {
      expect(meSub).not.toContain(fake);
    }
    expect(meSub).toContain("口径未接入前不编数");
  });
});

describe("PLACEHOLDER-002 every chain runs to completion", () => {
  const market = readFileSync(fileURLToPath(new URL("./market.tsx", import.meta.url)), "utf8");
  const scene = readFileSync(fileURLToPath(new URL("./reality-scene-map.tsx", import.meta.url)), "utf8");
  const activityDetail = readFileSync(fileURLToPath(new URL("./activity-detail.tsx", import.meta.url)), "utf8");
  const home = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");
  const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");
  const feed = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");
  const assistant = readFileSync(fileURLToPath(new URL("./home-assistant.tsx", import.meta.url)), "utf8");
  const fulfillment = readFileSync(fileURLToPath(new URL("./fulfillment-workspace.tsx", import.meta.url)), "utf8");
  const benefitClaim = readFileSync(fileURLToPath(new URL("./BenefitClaimScreen.tsx", import.meta.url)), "utf8");
  const creator = readFileSync(fileURLToPath(new URL("./creator-application.tsx", import.meta.url)), "utf8");
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");
  const security = readFileSync(fileURLToPath(new URL("../components/security-settings.tsx", import.meta.url)), "utf8");

  it("market search/quote/pins consume input and open real detail", () => {
    expect(market).toContain("setQuery");
    expect(market).toContain("customQuote");
    expect(market).toContain("请先填写自定义报价金额");
    expect(market).toContain("活动暂无位置坐标");
    expect(market).not.toContain("as unknown as Activity");
  });

  it("scene tristate and activity join confirm instead of dropping", () => {
    expect(scene).toContain("triStateMsg");
    expect(scene).toContain("同步失败，已恢复");
    expect(activityDetail).toContain("报名成功");
  });

  it("moment share handles shared/dismissed/error", () => {
    expect(home).toContain("momentBusy");
    expect(home).toContain("邀请已分享");
    expect(home).toContain("分享没有调起");
  });

  it("conversation retracts failed bubbles and forwards for real", () => {
    expect(convo).toContain("m.id !== userMsg.id");
    expect(convo).toContain("forwardMessage");
    expect(convo).toContain("已转发");
    expect(convo).not.toContain("从这条消息创建 Convo");
    expect(convo).not.toContain("选择转发对象");
  });

  it("composer permissions serialize and feed consumes prefs/channels", () => {
    const composerBody = readFileSync(fileURLToPath(new URL("../composer-body.ts", import.meta.url)), "utf8");
    expect(composerBody).toContain("回复权限");
    expect(composerBody).toContain("引用权限");
    expect(composer).toContain("replyPerm,");
    expect(feed).toContain("customFeedTokens");
    expect(feed).toContain("readFeedPrefs");
    expect(feed).toContain("feedWeightFor");
    expect(feed).toContain("setSearchOpen(true)");
  });

  it("assistant pills navigate and start failure retries", () => {
    expect(assistant).toContain("onOpenMarket(a.tab)");
    expect(assistant).toContain("重试连接");
  });

  it("me surfaces report failures and search/assets/status work", () => {
    expect(me).toContain("profileSaveError");
    expect(me).toContain("invitationError");
    expect(me).toContain("socialOpenError");
    expect(me).toContain("runProfileSearch");
    expect(me).toContain("addEnterpriseAsset");
    expect(me).not.toContain("onManageIdentities");
    expect(security).not.toContain("管理身份");
    expect(security).not.toContain("查看我的设备");
  });

  it("fulfillment/benefit/creator/messages chains complete", () => {
    expect(fulfillment).toContain("selectedCandidate");
    expect(benefitClaim).toContain("myClaims");
    expect(benefitClaim).toContain("重新加载");
    expect(creator).toContain("invitation-v1.json");
    expect(creator).toContain("合作说明");
    expect(messages).toContain("openContacts");
    expect(messages).toContain("新聊天");
    expect(messages).not.toContain("toLowerCase()}.ng");
  });
});

describe("PLACEHOLDER-003 no dead props or viewers", () => {
  const market = readFileSync(fileURLToPath(new URL("./market.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");
  const other = readFileSync(fileURLToPath(new URL("./other-profile.tsx", import.meta.url)), "utf8");

  it("MarketSurface has no unused activity opener", () => {
    expect(market).not.toContain("onOpenActivity");
    expect(shell).not.toContain("onOpenActivity={() => undefined}");
  });

  it("other profile opens photos and likes for real", () => {
    expect(other).not.toContain("onOpenMedia={() => undefined}");
    expect(other).toContain("MediaViewer");
    expect(other).toContain("onLikePost");
    expect(other).toContain("reactToPost");
  });
});

describe("PLACEHOLDER-004 moment publishes to feed", () => {
  const home = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");

  it("wires publish-to-feed through the real post pipeline", () => {
    expect(home).toContain("buildCreatePostPayload");
    expect(home).toContain("localNet.createPost");
    expect(home).toContain("发布到动态");
    expect(home).toContain("已发布到动态");
    expect(home).toContain("请先登录后再发布");
    expect(shell).toContain("localNet={localNet}");
  });
});

describe("PLACEHOLDER-005 own avatar in feed, moment lands on feed", () => {
  const feed = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");
  const home = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");

  it("resolves own avatar from the same store as profile management", () => {
    expect(feed).toContain("viewerAvatarUri");
    expect(feed).toContain("createProfileStore");
    expect(feed).toContain("postAvatarImage");
    expect(feed).toContain("isOwnPost");
    expect(shell).toContain("viewerAccountId");
  });

  it("jumps to feed after a successful moment publish", () => {
    expect(home).toContain("onOpenFeed?.()");
  });
});

describe("PLACEHOLDER-006 checklist walk gaps", () => {
  const home = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");
  const orders = readFileSync(fileURLToPath(new URL("./me-orders.tsx", import.meta.url)), "utf8");

  it("home continue failure retries instead of promising pull-to-refresh", () => {
    expect(home).toContain("homeReloadNonce");
    expect(home).toContain("重新加载进行中");
    expect(home).not.toContain("下拉或稍后重试");
  });

  it("activity rows do not nest pressables", () => {
    expect(orders).toContain("查看明细");
    expect(orders).not.toMatch(/<Pressable[^>]*>\s*<Text[^>]*>查看明细[\s\S]{0,2000}<Pressable/);
  });

  it("AI rail bleeds to the edges exactly like the human rail", () => {
    expect(home).toContain("aiRail: { marginBottom: 10, marginHorizontal: -16 }");
    expect(home).toContain("aiRailContent: { gap: 12, paddingHorizontal: 16 }");
  });
});

describe("PLACEHOLDER-007 rail tracks finger 1:1", () => {
  const rail = readFileSync(fileURLToPath(new URL("../components/horizontal-swipe-rail.tsx", import.meta.url)), "utf8");

  it("uses the grant-time snapshot as the only scroll base", () => {
    expect(rail).toContain("railGrantXRef");
    expect(rail).toContain("railGrantXRef.current - gs.dx");
    expect(rail).not.toContain("railScrollXRef.current - gs.dx");
  });
});

describe("PLACEHOLDER-008 avatars are circles", () => {
  const styles = readFileSync(fileURLToPath(new URL("./me-styles.ts", import.meta.url)), "utf8");

  it("hub and identity avatars use half-size radii plus clipping", () => {
    expect(styles).toContain("profileAvatarImg: { width: 46, height: 46, borderRadius: 23 }");
    expect(styles).toContain("identityAvatarImg: { width: 40, height: 40, borderRadius: 20 }");
    expect(styles).toContain("overflow: \"hidden\"");
  });

  it("manage avatar matches home size as a circle", () => {
    expect(styles).toContain("profileManageAva: { width: 88, height: 88, borderRadius: 44");
    expect(styles).toContain("profileManageAvaImg: { width: 88, height: 88, borderRadius: 44 }");
  });
});
