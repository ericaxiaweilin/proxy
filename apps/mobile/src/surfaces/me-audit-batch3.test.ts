import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 审计第五-九轮 P0 小项合集（纯移动端，无后端变更）。
// 注释先剥掉再断言，只认代码。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const meCode = stripComments(readFileSync(fileURLToPath(new URL("./me.tsx", import.meta.url)), "utf8"));
const shellCode = stripComments(readFileSync(fileURLToPath(new URL("../shell/app-shell.tsx", import.meta.url)), "utf8"));
const nativeCode = stripComments(readFileSync(fileURLToPath(new URL("../native-app.tsx", import.meta.url)), "utf8"));
const ordersCode = stripComments(readFileSync(fileURLToPath(new URL("./me-orders.tsx", import.meta.url)), "utf8"));

describe("AUDIT-BATCH3-001 share link belongs to the signed-in user", () => {
  it("builds the link from the viewer handle instead of a hardcoded tester", () => {
    // SHARE-LINK-001：之前全仓每个用户分享出去的都是 pxy.app/huyen/social。
    expect(meCode).not.toContain("pxy.app/huyen/social");
    expect(meCode).toContain("pxy.app/${shareHandle}/social");
  });
});

describe("AUDIT-BATCH3-002 favorites show no invented records", () => {
  it("renders an honest empty instead of the same two fixed entries", () => {
    // FAVORITES-REAL-001：Luna Spa / Linh Tran 所有用户看都一样。
    // 列表 UI 接好之前只放空态（读 ID 的端点有，但没有批量解标题的接口，
    // N+1 逐条查是错的）。
    expect(ordersCode).not.toContain("Luna Spa");
    expect(ordersCode).not.toContain("Linh Tran");
    expect(ordersCode).toContain("还没有收藏列表");
  });
});

describe("AUDIT-BATCH3-003 legal kill switch is visible in the shell", () => {
  it("mounts the banner and polls the public status endpoint", () => {
    // LEGAL-BANNER-001：组件和 client 齐全但从没挂载。开机拉一次，
    // 每次回前台刷新；拉失败静默，下次再试。
    expect(nativeCode).toContain("new LegalStatusClient(");
    expect(shellCode).toContain("<LegalStatusBanner");
    expect(shellCode).toContain("legalStatus.getStatus()");
    expect(shellCode).toContain('AppState.addEventListener("change"');
  });
});

describe("AUDIT-BATCH3-004 analytics page stops contradicting itself", () => {
  it("labels the funnel as sample data until the real pipeline exists", () => {
    // ANALYTICS-HONEST-001：数字是示例，副标题却写“只看真实下一步”。
    // PROFILE-VISIT-001: "主页访问"接了 ListProfileViewStats 之后不再是纯
    // 示例——副标题换成了区分"这一步真实/其余仍是示例"的措辞，不是笼统的
    // "示例数据"，断言跟着改。
    expect(meCode).toContain("主页访问是真实数据；往后每一步和下方渠道来源仍是示例");
    expect(meCode).not.toContain("只看真实下一步，不追虚荣指标");
  });
});

describe("AUDIT-BATCH3-005 follower faces are gone until real avatars exist", () => {
  it("keeps the true count without invented preview faces", () => {
    // FOLLOWER-FACES-001：M/A/L 三张脸不管谁关注都一样。最近关注者列表
    // 接口还没有（只有计数），先拿掉装饰只留真数字。
    expect(meCode).not.toContain("styles.personalFaces");
    // STAT-ROW-FOLLOW-001（2026-09-25）：头部统计行按原型改成「关注 / 粉丝」，
    // 措辞从「位关注者」换成「粉丝」。这条守的仍是**真数字还在**（且都走 dash()，
    // 未知画 — 不回填 0），不是那个词本身 —— 所以断言换成新的数字形状，不换意图。
    expect(meCode).toContain("{dash(personalFollowCounts?.following)}</Text> 关注");
    expect(meCode).toContain("{dash(personalFollowCounts?.followers)}</Text> 粉丝");
  });

  it("the header stats row is 关注 / 粉丝, not a views window", () => {
    // STAT-ROW-FOLLOW-001（2026-09-25，用户对照原型明确）：本人主页头部的统计行
    // 就是「关注 / 粉丝」两个数字。以前是「次浏览 · 最近 30 天」+「位关注者」——
    // 浏览数不该在头部占一格，更不该把「最近 30 天」这种窗口话术摆在主页上
    // （它仍在顶栏「分析」弹层里）。
    // 直接切出那个 View 再判，不用裸子串 —— 文件里的注释也会提到这些词，
    // 裸 not.toContain 会被自己的注释打红。
    const statRow = meCode.match(/<View style=\{styles\.personalStatRow\}>[\s\S]*?<\/View>/)?.[0] ?? "";
    expect(statRow, "personalStatRow 应该还在渲染").not.toBe("");
    expect(statRow).toContain("关注");
    expect(statRow).toContain("粉丝");
    expect(statRow).not.toContain("次浏览");
    expect(statRow).not.toContain("最近");
  });
});

// OFFER-ACCEPT-001（P0，用户「我的-我的订单 没有任何订单记录」2026-09-29）：
// 订单只在 agent 接 Offer 时生成。发 Offer（market 选人工作台）一直在，
// 但 App 里没有任何地方能**接** Offer —— acceptSlotOffer / listAgentOffers
// 零调用方 ⇒ 订单永远不生成 ⇒ 我的订单永远空。现在「我的订单」顶部补了
// 收到的合作邀请面板。这两条针守住：加载与接单动作缺一不可。
describe("OFFER-ACCEPT-001 我的订单能收到并接受合作邀请", () => {
  it("loads pending offers and can accept them into orders", () => {
    // 正向：listAgentOffers 的加载 + acceptSlotOffer 的动作都必须在。
    expect(ordersCode).toContain("client.listAgentOffers()");
    expect(ordersCode).toContain("client.acceptSlotOffer(");
    // 正向：只把还活着的 OFFERED 摆出来（EXPIRED 摆出来也接不了）。
    expect(ordersCode).toContain('offer.status === "OFFERED"');
  });
  it("accept failure lands in a visible notice, not a silent catch", () => {
    // 正向：接单失败要有可见文案（过期 / 已处理 / 不是你的 / 重试）。
    expect(ordersCode).toContain("OFFER_EXPIRED");
    expect(ordersCode).toContain("OFFER_NOT_AVAILABLE");
    expect(ordersCode).toContain("接单没有成功");
  });
});

// HOME-MYORDERS-JOINS-001（用户「我的订单还是空白」2026-09-29）：For You 下单
// 走 JoinActivity 活动报名，不落履约订单（join is join）—— 但下单成功页发了编号，
// 我的订单页却看不到，用户预期是断的。修法：把 ListMyActivities.joined 接进
// 我的订单页，独立「活动报名」区块，编号标「活动编号」跟履约订单分开。
describe("HOME-MYORDERS-JOINS-001 我的订单必须显示活动报名记录", () => {
  it("loads joined activities from the same source as 我的活动", () => {
    // 正向：报名数据来自 ListMyActivities 的 joined（不是编的，也不是履约订单）。
    expect(ordersCode).toContain("activityClient.listMyActivities()");
    // MY-ORDERS-DETAIL-001 / FOR-YOU-SLOT-001：同一份响应里带每笔报名自己的订单信息，
    // 一张票一项（同一场活动约了不同的小美是不同的单）。
    expect(ordersCode).toContain("setJoinedEntries(joinEntries(payload.joined, payload.joinOrders));");
  });
  it("renders the 报名 section with the real per-order number, never the shared activity code as one", () => {
    // MY-ORDERS-DETAIL-001：ORDER-NO-001 之后每笔报名有自己的订单编号 —— 订单编号
    // 只取 joinOrders 里这一单的 orderNo；活动编号（整场共用）单独一行标明，
    // 两者不互相顶替。老报名没有订单编号时如实说，不拿活动编号冒充。
    expect(ordersCode).toContain(">活动报名</Text>");
    expect(ordersCode).toContain("{order.orderNo}</Text>");
    expect(ordersCode).toContain("活动编号：{item.code}");
    expect(ordersCode).not.toContain("活动编号：{item.code || item.activityId}");
    expect(ordersCode).toContain("订单编号暂未取到");
    expect(ordersCode).toContain("activityOrderFields(item, order)");
    // ORDER-RECIPE-001：点一笔报名先开它的票（下单快照，跟成功页同一个组件），
    // 票里再给「查看活动详情」走活动现在的样子。
    expect(ordersCode).toContain("onPress={() => setTicketKey(key)}");
    expect(ordersCode).toContain("<ActivityOrderTicket");
    expect(ordersCode).toContain("orderSnapshotFor(ticketActivity, order)");
    expect(ordersCode).toContain("setActivityDetailId(ticketActivity.activityId)");
    expect(ordersCode).toContain("onBack={() => { setActivityDetailId(undefined); reload(); }}");
  });
  it("says so when the joins feed fails instead of pretending it is empty", () => {
    // 反向：读失败要有可见提示（「取不出来」≠「确实没有」），不挡订单主列表。
    expect(ordersCode).toContain("活动报名记录没读出来");
  });
});
