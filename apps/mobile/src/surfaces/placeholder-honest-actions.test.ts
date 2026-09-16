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

// 反向注入验证暴露过的一个坑：断言若直接在原文上 indexOf，解释这段历史的注释里
// 往往**也写着同一个字符串** —— 把代码删掉、注释留下，测试照样绿。所以凡是钉
// 「某段代码在不在」，先剥注释再断言，只认代码。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const crmCode = stripComments(crm);
const meCode = stripComments(me);
const profileClientSrc = readFileSync(fileURLToPath(new URL("../profile-client.ts", import.meta.url)), "utf8");
// ADD-FRIEND-FROM-MESSAGES-001: 跨模块入口的接线点在 shell 里 —— 表面文件
// 自己看不出「有没有人接」，所以要把 shell 也读进来。
const appShellCode = stripComments(readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8"));
// SEARCH-COPY-HONEST-001: 这一条要钉的东西**本身就是注释里的说法**，
// 所以用原文（stripComments 会把要钉的那句话一起删掉，断言就永远绿）。
const homeRaw = readFileSync(fileURLToPath(new URL("./requester-home.tsx", import.meta.url)), "utf8");

describe("PLACEHOLDER-001 friend-crm keeps mocks but wires every action", () => {
  it("drops only the invented self identity and dead stubs", () => {
    // PX-827491/Huyen Nguyen 是冒充本人的假身份，必须彻底消失；
    // 通讯录/社媒/搜索 mock 是测试替身，保留但必须可操作（见下）。
    for (const dead of ["PX-827491", "Huyen Nguyen", "fakeQr", "原型查看", "主页已打开"]) {
      expect(crm).not.toContain(dead);
    }
    // 「模拟识别」不在这个列表里了：它本来就是假动作（点一下把写死的演示号填进搜索框），
    // PROFILE-QR-003 已换成 parseScannedQr 真解析，见下面的接线断言。
    //
    // SEARCH_RESULTS 也移出这个列表了：PROFILE-SEARCH-001 把「搜索」换成了真
    // 服务端查询，那两行写死的演示结果已删除。留着它当 fallback 就等于搜谁
    // 都返回同一批编造的人 —— 那不是测试替身，是静默的撒谎。
    for (const mock of ["CONTACT_MATCHES", "SOCIAL_MATCHES"]) {
      expect(crm).toContain(mock);
    }
    expect(crmCode).not.toContain("SEARCH_RESULTS");
  });

  it("never toasts a send that did not happen", () => {
    for (const lie of ['showToast("好友请求已发送")', 'showToast("咖啡券已发送', 'showToast("体验邀约已发送")', "已拉黑（演示）", "已移除好友（演示）"]) {
      expect(crm).not.toContain(lie);
    }
  });

  it("runs add/invite through a real local state machine", () => {
    // 添加→已发送（setSentIds 真实翻转并禁用按钮）；扫码走真解析（PROFILE-QR-003），
    // 不再是「模拟识别」把写死的 PX-937201 填进搜索框假装扫到了人。
    expect(crm).toContain("setSentIds");
    expect(crm).toContain("已发送");
    // 钉**接线**，不钉调用拼写。剪贴板内容 → 共用处理器 → 真解析器 → 落人，
    // 这条链才是要守的；参数名只是实现细节（相机接入后走 handleScannedCode(raw)），
    // 钉死 "(text)" 会让任何合法重构都误报，把好改动挡在门外。
    expect(crm).toContain("await handleScannedCode(text)");
    expect(crm).toMatch(/parseScannedQr\(/);
    // 识别出 handle 之后不再往本机搜索框里塞：那等于拿演示结果假装找到了人
    // （扫谁的码都是同一批 SEARCH_RESULTS）。现在交给 lookupScannedHandle
    // 去服务端按 handle 解析真人，见下面的 HANDLE-LOOKUP-001。
    expect(crm).not.toContain("setProxySearch(scanned.handle)");
    expect(crm).toContain("await lookupScannedHandle(parsed)");
    expect(crm).not.toContain("模拟识别");
    expect(crm).not.toContain('setProxySearch("PX-937201")');
    expect(crm).toContain("Share.share");
    expect(crm).toContain("登录后显示你的邀请名片");
  });

  it("PROFILE-QR-003 scan fails closed with three distinct messages", () => {
    // 读不到剪贴板 / 剪贴板是空的 / 不是 Proxy 码 —— 三件事三句话，
    // 不许合并成一句含糊的「识别失败」，也不许静默吞掉。
    expect(crm).toContain("读取剪贴板失败");
    expect(crm).toContain("剪贴板里没有内容");
    expect(crm).toContain("这不是 Proxy 二维码");
    // 相机不再是「未接入」的诚实说明，而是真接上了：真 CameraView + 权限门。
    // 钉住新契约 —— 权限没给时必须说清楚，不许假装能扫。
    expect(crm).toContain("CameraView");
    expect(crm).toContain("useCameraPermissions");
    expect(crm).toContain("需要相机权限才能扫码");
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
    // MARKET-QUOTE-SHEET-001: 报价不再是详情页里塞一个 customQuote 输入框,
    // 是独立 sheet。pin 改成 sheet 接线 (state + 组件渲染 + 提交回调),
    // 保证这一屏仍然真的能走报价而不是死按钮。
    expect(market).toContain("setQuoteOpen");
    expect(market).toContain("<OpportunityQuoteSheet");
    expect(market).toContain("onSubmit={");
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

  it("HANDLE-UNIQUE-001: a taken handle is actionable, not a retry loop", () => {
    // 服务端因 handle 冲突拒绝时，必须给出「换一个」的文案。如果它落进
    // 通用的「同步失败，请稍后重试」，用户会对着一个永远不会成功的按钮
    // 反复点 —— 拒绝原因明明可行动，却被抹平成一句含糊的失败。
    expect(me).toContain("profile_handle_taken");
    expect(me).toContain("这个 @handle 已经被别人用了");
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
    expect(feed).toContain("CircularAvatarImage");
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

  it("home hides the state-machine surface until real active work exists", () => {
    expect(home).toContain("continueItems.length > 0 ? <View>");
    expect(home).not.toContain("没有进行中的需求");
    expect(home).not.toContain('key: "ph:new"');
    expect(home).not.toContain("重新加载进行中");
  });

  it("keeps activities in the four-grid chooser instead of duplicating a Home list", () => {
    expect(home).not.toContain(">店铺场景活动<");
    expect(home).not.toContain("报名 · 到店 · 复盘");
    expect(home).toContain('chooser === "activity"');
    expect(home).toContain("storeActivities.map");
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
  const me = readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8");
  const feed = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");
  const profileTabs = readFileSync(fileURLToPath(new URL("./ProfileTabs.tsx", import.meta.url)), "utf8");
  const circularAvatar = readFileSync(fileURLToPath(new URL("../components/circular-avatar-image.tsx", import.meta.url)), "utf8");

  it("uses an actual SVG circle clip instead of relying on iOS rounded-view compositing", () => {
    expect(circularAvatar).toContain("<ClipPath");
    expect(circularAvatar).toContain("<Circle");
    expect(circularAvatar).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(styles).toContain("overflow: \"hidden\"");
  });

  it("uses the circle clip on account, feed and profile-post portraits without zoom transforms", () => {
    expect(styles).toContain("profileManageAva: { width: 88, height: 88, borderRadius: 44");
    expect(me).toContain("<CircularAvatarImage");
    expect(feed).toContain("<CircularAvatarImage");
    expect(profileTabs).toContain("<CircularAvatarImage");
    expect(me).not.toContain("transform: [{ scale: 1.1 }]");
  });
});

describe("PLACEHOLDER-009 avatars persist on disk", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");
  const convo = readFileSync(fileURLToPath(new URL("./conversation.tsx", import.meta.url)), "utf8");

  it("renders avatars with memory-disk cache instead of plain RN Image", () => {
    for (const [file, source] of [["messages", messages], ["conversation", convo]] as const) {
      expect(source).toContain('cachePolicy="memory-disk"');
      expect(source).toContain("recyclingKey={`avatar:");
    }
    expect(messages).toContain('import { Image } from "expo-image"');
  });
});

describe("PLACEHOLDER-010 ai add shows pending", () => {
  const profile = readFileSync(fileURLToPath(new URL("./ai-account-profile.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");

  it("reads friendship truth and locks pending as 添加中", () => {
    expect(profile).toContain("listMyFriendships");
    expect(profile).toContain("sendFriendRequest");
    expect(profile).toContain("添加中");
    expect(profile).toContain('disabled={useFriendFlow && (friendState !== "NONE" || friendBusy)}');
    expect(shell).toContain("relationship={relationship}");
  });
});

describe("PLACEHOLDER-011 pending add is gray", () => {
  const profile = readFileSync(fileURLToPath(new URL("./ai-account-profile.tsx", import.meta.url)), "utf8");

  it("renders 添加中 in muted gray, distinct from added violet", () => {
    expect(profile).toContain("pendingText");
    expect(profile).toContain('friendState === "OUTGOING" && styles.pendingText');
  });
});

describe("PLACEHOLDER-012 ai three glass actions", () => {
  const profile = readFileSync(fileURLToPath(new URL("./ai-account-profile.tsx", import.meta.url)), "utf8");
  const feed = readFileSync(fileURLToPath(new URL("./feed.tsx", import.meta.url)), "utf8");
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");

  it("renders three liquid-glass buttons with view-posts wired", () => {
    expect(profile).toContain("GlassContainer");
    expect(profile).toContain('glassEffectStyle="clear" isInteractive');
    expect(profile).toContain("<LiquidGlassAction");
    expect(profile).toContain('height: 44');
    expect(profile).toContain('borderRadius: 14');
    expect(profile).not.toContain("glassStage");
    expect(profile).not.toContain("glowViolet");
    expect(profile).not.toContain("tintColor=");
    expect(profile).toContain("查看个人主页");
    expect(profile).toContain("onViewPosts");
    expect(feed).toContain("initialSearchQuery");
    expect(feed).toContain("onSearchSeedConsumed");
    expect(shell).toContain("feedSearchSeed");
  });
});

describe("PLACEHOLDER-013 swipe to delete dialogs", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");

  it("reveals a two-step delete that hides locally and persists", () => {
    expect(messages).toContain("SwipeableRow");
    expect(messages).toContain("确认删除");
    expect(messages).toContain("hideDialog");
    expect(messages).toContain("proxy-hidden-chats");
    expect(messages).toContain("visibleDialogs");
  });

  it("settles forgivingly: light swipe opens, termination settles too", () => {
    expect(messages).toContain("SWIPE_OPEN_DX");
    expect(messages).toContain("onPanResponderTerminate: () => settle(");
  });
});

describe("PLACEHOLDER-014 messages keeps left swipe, shell keeps right", () => {
  const shell = readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8");

  it("locks forward page jumps on message pages only", () => {
    expect(shell).toContain("isMessagesPage");
    expect(shell).toContain("MSG_CHAT");
    expect(shell).toContain("MSG_FRIENDS");
  });
});

describe("PLACEHOLDER-015 no redundant recent header", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");

  it("lists dialogs latest-first with no 最近 label", () => {
    expect(messages).not.toContain(">最近</Text>");
  });
});

describe("PLACEHOLDER-016 folders are a media browser plus custom folders", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");
  const folders = readFileSync(fileURLToPath(new URL("../components/folder-manager.tsx", import.meta.url)), "utf8");

  it("renders 对话/Convo/文件夹 side by side with media grid and custom folders", () => {
    expect(messages).toContain('setPanel("folders")');
    expect(messages).toContain(">文件夹</Text>");
    expect(messages).toContain("styles.homeTabs");
    expect(messages).toContain("styles.folderRowWrap");
    expect(messages).not.toContain("tabFolderRow");
    expect(messages).toContain("FolderMediaItem");
    expect(messages).toContain("listMessages");
    expect(messages).toContain("mediaSender");
    expect(messages).toContain("mediaGrid");
    expect(messages).toContain("proxy-folders");
    expect(messages).toContain("toggleFolderMember");
    expect(messages).toContain("自建文件夹");
    expect(folders).toContain("onSelect");
    expect(folders).not.toContain("onMove");
  });
});

describe("PLACEHOLDER-017 folder scope without archive talk", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");

  it("shows system filters only on dialogs, no 归档 anywhere", () => {
    expect(messages).toContain('panel === "dialogs"');
    expect(messages).not.toContain("归档");
  });
});

describe("PLACEHOLDER-018 new folder chip in type row", () => {
  const messages = readFileSync(fileURLToPath(new URL("./messages.tsx", import.meta.url)), "utf8");

  it("creates folders inline from the chips row", () => {
    expect(messages).toContain("＋ 新建");
    expect(messages).toContain("submitFolderCreate");
    expect(messages).toContain("folderCreateInput");
  });
});

describe("ADD-FRIEND-ENTRY-001 the add-friend surface is actually reachable", () => {
  it("pushes ADD_FRIEND from the LIST view, not from inside ADD_FRIEND", () => {
    // 逃掉的 bug：整个 ADD_FRIEND 表面（5 种加好友方式 + 好友请求 + 扫码）
    // 不可达。me.tsx 只在 subPage.route === "addfriend" 时渲染它，而全仓库
    // 没有一处 setSubPage 到那个 route；friend-crm 内部也从没调用过
    // setView("ADD_FRIEND") —— view 只在挂载时取 initialView。
    //
    // 断言的不只是「字符串在」，而是「这个 push 发生在 LIST 视图里」：
    // 如果它落在 ADD_FRIEND 自己的分支里，就是自己推自己，等于没接。
    const listHeader = crmCode.indexOf("好友关系");
    const push = crmCode.indexOf('onPress={() => setView("ADD_FRIEND")}');
    expect(listHeader).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(listHeader);
    expect(crmCode).toContain('accessibilityLabel="添加好友"');
  });

  it("keeps the LIST back-path alive", () => {
    // setView("LIST") 这条回退分支本来就是为「从 LIST 进 ADD_FRIEND」写的。
    // 入口缺失时它是死代码 —— 它同时也是入口缺失的证据，别把它一起删了。
    expect(crmCode).toContain('else setView("LIST")');
  });
});

describe("ADD-FRIEND-FROM-MESSAGES-001 Messages reaches add-friend, and the back label tells the truth", () => {
  it("offers the entry from the new-chat sheet, not from the inbox", () => {
    // friend-crm 的返回分支早就写着「当从 Messages 进入时…」，但信息模块里
    // 从来没有这个入口：全仓库 grep addfriend 只有渲染分支和内容条目两处命中。
    // 入口挂在「新聊天」的联系人视图里 —— 那一页的目的就是「找人聊天」，
    // 而收件箱里只有已经聊过的人，找不出新人。
    expect(messages).toContain('accessibilityLabel="添加好友"');
    expect(messages).toContain("onOpenAddFriend");
  });

  it("hands the request to the shell instead of doing nothing", () => {
    // 没有 onOpenAddFriend 时不能静默：点下去什么都不发生，和「没这个人」
    // 长得一模一样。openAddFriend 返回 false，调用点把话写出来。
    expect(messages).toContain("const openAddFriend = (): boolean => {");
    expect(messages).toContain("if (!onOpenAddFriend) return false;");
    expect(messages).toContain('setAddFriendNotice(openAddFriend() ? "" :');
  });

  it("the shell hands the relationship to MessagesSurface and no longer jumps to Me", () => {
    // 用户要求：添加好友（扫码/搜索/邀请）内嵌在消息模块，不再跳去「我的」。
    // shell 必须把 relationship 传给 MessagesSurface（FriendCrmSurface 由
    // MessagesSurface 自渲染）；不得再 setMeOpenSubPage/goToPage("ME")。
    expect(appShellCode).toContain("relationship={relationship}");
    expect(appShellCode).toContain("onOpenAddFriend={() =>");
    expect(appShellCode).not.toContain('setMeOpenSubPage(meSubPage("addfriend"))');
    expect(appShellCode).not.toContain('goToPage("ME")');
  });

  it("the Me surface opens the requested sub-page exactly once", () => {
    // 用「请求 + 消费」而不是「初始值」：MeSurface 切走 tab 会卸载，
    // 消费后 shell 清空请求，下次正常进「我的」不会又弹回添加好友。
    expect(appShellCode).toContain("requestedSubPage={meOpenSubPage}");
    expect(appShellCode).toContain("onRequestedSubPageConsumed={clearMeOpenSubPage}");
    expect(meCode).toContain("if (!requestedSubPage) return;");
    expect(meCode).toContain("setSubPage(requestedSubPage);");
    expect(meCode).toContain("onRequestedSubPageConsumed?.();");
  });

  it("the back label is supplied by the caller, never guessed", () => {
    // 逃掉的 bug：me.tsx 以 initialView="ADD_FRIEND" 进这个表面，于是返回
    // 按钮写着「‹ 返回消息」，而 onBack 其实是回「我的」—— 标签在撒谎。
    // 本组件不知道 onBack 通向哪里，所以标签只能由调用方给。
    expect(crmCode).not.toContain("‹ 返回消息");
    expect(crmCode).toContain('const backText = directEntry ? (addFriendBackLabel ?? "‹ 返回") : "‹ 返回好友";');
    expect(meCode).toContain('addFriendBackLabel="‹ 返回我的"');
  });

  it("one boolean drives both the label and the behaviour", () => {
    // 标签和行为各算各的，就还能再对不上。directEntry 同时决定
    // handleBack 走哪条路、backText 写什么。
    expect(crmCode).toContain('const directEntry = initialView === "ADD_FRIEND";');
    expect(crmCode).toContain("if (directEntry) onBack();");
    expect(crmCode).not.toContain('initialView === "ADD_FRIEND" ? "');
  });
});

describe("DEAD-PROP-001 no declared-but-unread props on the Me / Messages surfaces", () => {
  it("the Me surface does not declare a search callback nobody reads", () => {
    // 这个 prop 在全仓库只出现一次：它自己的类型声明。没有调用方，也没有读者。
    // 空壳 prop 比死按钮更隐蔽 —— 死按钮至少有人点得到。
    expect(meCode).not.toContain("onOpenSearch");
  });

  it("the Messages surface does not declare an initial tab it can never honour", () => {
    // app-shell 一直在传 "CHAT"/"FRIENDS"，组件从来没读。而且这不是「忘了读」：
    // 本页的 panel 模型是 对话/Convo/文件夹，两套词表对不上，补线就得先编一套
    // 映射 —— 那正是「组件替调用方猜」的老毛病。所以删，不补。
    expect(messages).not.toContain("initialTab");
    expect(appShellCode).not.toMatch(/MessagesSurface[^\n]*initialTab/);
  });
});

describe("SEARCH-COPY-HONEST-001 search copy says what the code actually matches", () => {
  it("the Messages search box does not promise message search it cannot do", () => {
    // 那个输入框只匹配 `${name} ${preview}` —— 会话名 + **最近一条**消息，
    // 搜不到历史消息。原来的 placeholder 写「搜索聊天、联系人和消息」，
    // 把「最近一条」说成了「消息」。同一个文件里的联系人页早就写着
    // 「姓名或最近消息」，这里对齐它。
    expect(messages).toContain('placeholder="搜索聊天名称和最近消息"');
    expect(messages).not.toContain("搜索聊天、联系人和消息");
    // 文案和匹配器必须同时改：这条钉住匹配器，谁要真做消息全文搜索，
    // 会先在这里看见「文案也要一起改」。
    expect(messages).toContain("return `${it.name} ${it.preview}`.toLowerCase().includes(kw);");
  });

  it("the Home search does not claim its people group is real site data", () => {
    // 索引里 activities / scenes / times 是真的，people 本地部分来自
    // SCENE_RECOMMEND fixture。原注释写「真实推荐人」「数据全部来自…真实列表，
    // 不造演示数据」—— 对一个 fixture 分组说了假话，会骗到下一个在这上面
    // 继续搭东西的人。
    // HOME-PEOPLE-SEARCH-001 之后人名多了服务端全站兜底，旧注释那句
    // 「仍是 fixture、没有真实…」描述的是修之前的世界，已随修更新为接线说明；
    // 两句假话本身继续禁。
    expect(homeRaw).not.toContain("不造演示数据");
    expect(homeRaw).not.toContain("真实推荐人");
    expect(homeRaw).toContain("HOME-PEOPLE-SEARCH-001");
    expect(homeRaw).toContain("ProfileClient.searchProfiles");
  });
});

describe("CONTACT-SEARCH-COPY-001 the contacts-sheet subtitle matches its search box", () => {
  it("does not promise a username search the sheet cannot do", () => {
    // 「新聊天」那张 sheet 的副标题正压在搜索框上方。CONTACTS 由 visibleDialogs
    // 映射而来（name / preview / time / conversationId），**没有 username**
    // —— 本段自己的注释就写着「不编造 username」。filtered 也只匹配
    // `${c.name}${c.preview}`。副标题原写「联系人 / Username」，等于让用户
    // 在框里输 @handle 却永远搜不到；同一个框的 placeholder 早就写着
    // 「姓名或最近消息」。副标题对齐它。
    // 找没聊过的人不走这条搜索，走下面的「添加好友」入口
    // （ADD-FRIEND-FROM-MESSAGES-001），那是另一条线。
    expect(messages).toContain("联系人 · 姓名或最近消息");
    expect(messages).not.toContain("联系人 / Username");
    // 副标题里的「最近消息」得有匹配器兜着：匹配范围一旦收窄到只剩 name，
    // 副标题就又变回空头承诺。
    expect(messages).toContain("${c.name}${c.preview}");
  });
});

describe("ADD-FRIEND-PHONE-COPY-001 the add-friend list does not advertise phone search", () => {
  it("drops the phone claim from the live list and from the sub-page table", () => {
    // 后端没有按手机号搜索的能力，也没有「允许被手机号搜到」这个授权开关 ——
    // friend-crm 的 SEARCH sheet 自己就写着「手机号暂不可搜」。同一处能力却在
    // 两个地方被说成能搜手机号：
    //  · friend-crm 的「添加方式」列表（用户真会看到的那一份）；
    //  · me-sub-pages 的 addfriend 说明表（sections 没有渲染方 —— 只有
    //    title/desc/icon 经 meSubPage 被用上；一旦接上就会把不存在的能力讲给用户）。
    expect(crm).not.toContain("昵称、Proxy ID 或手机号");
    expect(meSub).not.toContain("昵称、Proxy ID、手机号");
    // 正向：两处都只报昵称与 Proxy ID；sheet 那句诚实说明不许被顺手删掉。
    expect(crm).toContain("昵称或 Proxy ID");
    expect(crm).toContain("手机号暂不可搜");
    // me-sub-pages 那份 addfriend 说明表是**死内容**（sections 没有渲染方），
    // 已随 ME-SUBPAGE-FABRICATED-001 一起删掉。原来那条正向钉
    // `toContain("昵称、Proxy ID")` 钉的正是这份死内容 —— 它绿了两年，但从没
    // 守住任何用户看得见的东西。改成反向钉：整个文件不许再出现手机号能力，
    // 谁把这份表接上渲染、并顺手把手机号写回去，这里会先红。
    expect(meSub).not.toContain("手机号");
  });
});

describe("CONVO-OPEN-001 tapping a Convo opens the branch, not the mainline", () => {
  it("passes the convo id all the way to ConversationSurface", () => {
    // 支线（Convo）是主线 DM 的一个分支：conversation.tsx 用 convId（父母会话）
    // + activeConvo.id 去 listMessages，两者缺一不可。列表里点一条 Convo，以前只交出
    // parentDialogId —— shell 于是按普通 DM 打开，入口写着「打开 Convo」，
    // 点开却是主线，支线内容一条都看不到。
    expect(messages).toContain("onOpenConvo");
    expect(messages).toContain("openConvo(");
    // 少了 convoId 就还是打开主线 —— 这一句是整条接线的要害。钉**整个调用**而不是光钉
    // "s.convo.id"：那个 token 在 key={s.convo.id} 里也有，光钉它会漏判。
    expect(messages).toContain("openConvo(parentName, s.convo.parentDialogId, s.convo.id,");
    // shell 必须真的把它传到 ConversationSurface（它认的 prop 名是 convoId / convoTitle）。
    expect(appShellCode).toContain("onOpenConvo={");
    expect(appShellCode).toContain("{...(messageChat?.convoId ? { convoId: messageChat.convoId } : {})}");
    expect(appShellCode).toContain("{...(messageChat?.convoTitle ? { convoTitle: messageChat.convoTitle } : {})}");
  });

  it("says so when nobody hands it a convo opener", () => {
    // 同 ADD-FRIEND-FROM-MESSAGES-001：没人接的入口不能静默 —— 静默的死按钮
    // 和「这条支线不存在」长得一样。
    expect(messages).toContain("if (!onOpenConvo) return false;");
    expect(messages).toContain("支线入口还没接通");
    expect(messages).toContain("{convoNotice ?");
  });

  it("no longer opens the parent dialog as a plain DM", () => {
    // 旧接线：只带 parentDialogId 调 onOpenConversation —— 那只能打开主线。
    expect(messages).not.toContain("onPress={() => onOpenConversation(parentName, s.convo.parentDialogId)}");
  });
});

describe("PROFILE-POSTS-FAILURE-001 a failed posts load is not an empty profile", () => {
  it("keeps failed distinct from empty", () => {
    // 以前两条路都失败时直接把异常吞掉：profilePosts 留成 []，页面渲染出
    // 「0 条动态」—— 和「你还没发过动态」一模一样。空是答案，失败不是。
    expect(meCode).toContain('setProfilePostsState("failed")');
    expect(meCode).toContain('setProfilePostsState("ready")');
    // 整个文件不许再有「吞掉异常的空 catch」—— 这一类 bug 的入口就在那儿。
    expect(meCode).not.toContain("catch {}");
  });

  it("shows an honest notice with a retry, and unknown instead of zero", () => {
    // 条数在失败时显示 —（同文件 dash() 的口径：未知不是零）。
    expect(meCode).toContain('posts: profilePostsState === "failed" ? undefined : profilePosts.length');
    expect(meCode).toContain("不是你没有动态");
    expect(meCode).toContain("setProfilePostsReload((n) => n + 1)");
    // 重试要真的能重跑 effect：reload 计数必须在依赖里。
    expect(meCode).toContain("profilePostsReload]");
  });
});

describe("ADD-FRIEND-DEAD-BRANCH no duplicate branch shadows the wired one", () => {
  it("has exactly one friendcrm branch, and it is the wired one", () => {
    // me.tsx 曾有两处 route === "friendcrm"：line 848 的 guard，和 `if (subPage)`
    // 块内一份更旧的残骸（少了 relationship / viewer / onOpenVouchers /
    // profileClient）。848 无条件 return，所以残骸永远走不到 —— 但一旦 guard 被
    // 挪走，它就变成活代码，渲染出一个连关系客户端都没接的表面，而且静默降级。
    // 残骸已删除；这条钉防止它（或任何同路由的重复分支）再回来。
    const branches = meCode.match(/route === "friendcrm"/g) ?? [];
    expect(branches.length, "friendcrm 又出现重复渲染分支").toBe(1);
    // 剩下那一处必须是接了线的。
    const start = meCode.indexOf('route === "friendcrm"');
    const tag = meCode.slice(start, meCode.indexOf("/>", start));
    expect(tag).toContain("relationship={relationshipClient}");
    expect(tag).toContain("profileClient={profileClient}");
    expect(tag).toContain("viewer=");
  });
});

describe("HANDLE-LOOKUP-001 a scanned QR resolves to a real person", () => {
  it("asks the server who owns the handle instead of seeding a local search box", () => {
    // 扫到码之后必须真的问服务端「这个 @handle 是谁」。旧行为只把 handle
    // 塞进本机搜索框，而搜索结果全是本机演示数据 —— 扫谁结果都一样。
    expect(crmCode).toContain("profileClient.getProfileByHandle(parsed.handle)");
    expect(crmCode).toContain("await lookupScannedHandle(parsed)");
  });

  it("keeps found / missing / failed / no-client as four different truths", () => {
    // 找到人、服务端说查无此人、请求失败、根本没接线 —— 四件事四种界面。
    // 合并成一句「查询失败」会让用户对着一个不会好的按钮反复点。
    //
    // 这里钉的是那个三元：PROFILE_NOT_FOUND 必须走 "missing" 而不是并进
    // "failed"。少了这个分叉，「查无此人」就会显示成「请重试」。
    expect(crmCode).toContain('setScanLookup(message.includes("profile_not_found") ? "missing" : "failed")');
    expect(crmCode).toContain('setScanLookup("found")');
    expect(crmCode).toContain('setScanLookup("no-client")');
  });

  it("adds the scanned person through the real friendship command", () => {
    expect(crmCode).toContain("relationship.sendFriendRequest(scanMatch.userAccountId)");
  });

  it("every FriendCrmSurface gets the profile client", () => {
    // 只断言 me.tsx「包含 profileClient={profileClient}」不够：文件里只要有任何
    // 一处带着这个 prop，断言就会绿着放行一条断掉的活链路（反向注入时就是这么
    // 骗过去的）。逐个开标签检查，一个都不能漏 —— 残骸分支删掉之后这条才成立。
    const tags = meCode.match(/<FriendCrmSurface[\s\S]*?\/>/g) ?? [];
    expect(tags.length, "一个 FriendCrmSurface 都没找到").toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toContain("profileClient={profileClient}");
    }
  });
});

describe("PROFILE-SEARCH-001 the search box actually searches the site", () => {
  it("calls SearchProfiles instead of rendering a hardcoded list", () => {
    // 逃掉的 bug：「搜索 Proxy」把写死的 SEARCH_RESULTS 显示给每一次查询 ——
    // 搜什么都是同两个人，输入框是装饰。服务端当时也**没有**任何搜索命令：
    // Profile 只能按 userAccountID（自己）或精确 handle 读。
    expect(crmCode).toContain("profileClient.searchProfiles(query)");
    expect(crmCode).toContain("runProxySearch");
    // 反向钉：写死的演示结果不许回来，`proxySearchDone` 这个纯本机开关也不许。
    expect(crmCode).not.toContain("SEARCH_RESULTS");
    expect(crmCode).not.toContain("proxySearchDone");
  });

  it("keeps empty / failed / too-short / no-client as four different truths", () => {
    // 「没找到人」要用户换个词，「搜索失败」要用户重试，「字数不够」要用户多打
    // 几个字，「没登录」要用户去登录 —— 四件事四种文案，合并成一句就是让用户
    // 对着一个永远不会成功的搜索反复点。
    for (const state of ['setSearchState("failed")', 'setSearchState("too-short")', 'setSearchState("no-client")']) {
      expect(crmCode).toContain(state);
    }
    // "empty" 不是字面量：它由那个三元产生，而且正是「空结果不算异常」的写法
    // 本身。断言 setSearchState("empty") 会永远找不到 —— 那个 needle 不存在。
    expect(crmCode).toContain('found.length ? "found" : "empty"');
  });

  it("counts the minimum query length in code points, not bytes or UTF-16 units", () => {
    // 一个汉字是 1 个码点 / 3 个字节。用字节数会把单字查询放过去，然后返回
    // 大半张用户表；Go 侧按 rune 拒绝，两边必须一致。
    expect(crmCode).toContain("[...query].length < 2");
  });

  it("does not offer an add button on your own profile", () => {
    // 服务端会用 FRIEND_SELF_FORBIDDEN 拒绝自己加自己。留一个必然失败的按钮
    // 只会让用户以为是自己点错了。
    expect(crmCode).toContain("isSelfProfile");
    expect(crmCode).toContain("这是你");
  });

  it("the client sends SearchProfiles and reads operationRef, not body", () => {
    expect(profileClientSrc).toContain('"SearchProfiles"');
    expect(profileClientSrc).toContain("searchProfiles");
    // parseCommandResult 会丢掉 body，所以结果只能走 operationRef。服务端如果
    // 只写 Body，搜索会永远看起来「什么都没找到」，而且不报错。
    expect(profileClientSrc).toContain("result.operationRef");
    expect(profileClientSrc).toContain("profile search response malformed");
  });
});

describe("CONVO-LIST-001 my convos are listed, not just creatable", () => {
  // 这条盯的是一个「建好了没人调」的半截接线。ConversationClient.listMyConvos
  // 一直在（服务端 ListMyConvos 也在，客户端单测也在），但 App 里从来没有调用方 ——
  // 于是 conversation.tsx 能把一条消息分叉成支线，分叉完却**永远看不到它**。
  //
  // 同一个页面还有第二个毛病：Convo 页当时列的是 GROUP/SUPPORT 会话，而那些在
  // 「对话」页已经出现过一遍；真正的 Convo 一条都没有 —— 标题和内容对不上。

  it("actually calls listMyConvos from the messages surface", () => {
    expect(messages).toContain("conversationClient.listMyConvos()");
    expect(messages).toContain("ConvoSummary");
  });

  it("keeps loading / empty / failed as three different things", () => {
    // undefined = 还没拉，[] = 真的没有，failed = 拉失败。合成两个，
    // 就必然把「没拉到」画成「一条都没有」—— 用户会以为自己从没开过支线。
    expect(messages).toContain("const [myConvos, setMyConvos] = useState<ConvoSummary[] | undefined>(undefined);");
    expect(messages).toContain("setMyConvos(rows)");
    expect(messages).toContain("setMyConvosFailed(true)");
  });

  it("offers a retry that actually re-runs the fetch", () => {
    expect(messages).toContain("setMyConvosNonce((n) => n + 1)");
    // reload 计数必须在依赖数组里，否则「重试」点下去不会重跑 effect。
    expect(messages).toContain("myConvosNonce]");
    expect(messages).toContain("Convo 加载失败");
  });

  it("stops labelling a list of group conversations as Convo", () => {
    // 旧标题下面列的是 GROUP/SUPPORT 会话 —— 名字和内容对不上。
    expect(messages).not.toContain("关注的 Convo");
    expect(messages).toContain("我的 Convo");
    // 群组那一段保留（「＋文件夹」是它独有的入口），但如实叫它群组对话。
    expect(messages).toContain("群组对话");
  });

  it("shows an unparseable convo timestamp as a dash, never as blank", () => {
    expect(messages).toContain("function convoTimeText");
    expect(messages).toContain('if (!Number.isFinite(ms) || ms <= 0) return "—";');
  });
});
