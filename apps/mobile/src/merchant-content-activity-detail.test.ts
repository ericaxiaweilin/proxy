import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { labelInvitationStatus } from "./creator-capability-labels";

// MERCHANT-CREATOR-CONTENT-001 / MERCHANT-ACTIVITY-DETAIL-001（2026-10-04）
//
// 商家侧「我的 → Creator 经营」那张「生产内容」经营目标卡，以前是张点不进去的死
// View（`go` 三元兜底 undefined），旁边注释写着「生产内容以后再说」。同一天接原型
// deepseek_html_20261004_e74898（活动详情）时把两页一起做了。
//
// 这次要钉住的是三件以前反复出过问题的事：
//
//   1. **读数必须是活动契约里已有的字段。** 原型活动详情最抢眼的是三个数
//      （感兴趣 / 已报名 / 评论）+ 报名进度 + 活动权益。它们对应 ActivitySchema
//      的 interested / joined / qaCount / capacity / benefit —— 全是服务端给的。
//      钉死这几个字段名，是为了以后有人「页上没数」时去页里写个 0 或写个假数。
//
//   2. **没有服务端能力的键不许做成可点的。** 原型六个键（报名名单 / 提醒报名 /
//      编辑活动 / 推广活动 / 上传封面 / 取消活动），今天只有推广活动是真链路。
//      CancelActivity 是个容易看错的坑：它是**报名者**取消自己的报名
//      （participation.go TransitionParticipation → PartCancelled），
//      不是商家取消整场活动。商家取消整场活动服务端没有。
//
//   3. **评论分析不许拿假数字画出来。** 情感占比 / 高频问题 / 关键词云在原型上
//      最吸睛，但全仓 0 行后端。只能是诚实空态 —— 不许出现百分比数字。
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const read = (p: string): string => readFileSync(here(p), "utf8");
// 剥注释再断言：下面这些反向断言要禁的词，正上方注释里就写着（仓里的老坑）。
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const meRaw = read("./surfaces/merchant-me-r21-replacement.tsx");
const me = strip(meRaw);

describe("MERCHANT-CREATOR-CONTENT-001 生产内容", () => {
  it("目标卡接上真实去向，这一页也存在", () => {
    expect(me).toContain('title === \'生产内容\' ? (): void => setPage("content")');
    expect(me).toContain('if (page === "content")');
    expect(me).toContain('"content"');
  });

  it("页上每一行都来自服务端邀约，不是页面里写死的样例", () => {
    // 数据源是真实命令 ListCollabInvitations（role=sent），不是本地常量数组。
    expect(me).toContain("supply.listSentInvitations({ merchantId: activeAccount.id })");
    // 同一个人只留最新一单 —— 否则一个人被数成好几条内容合作。
    expect(me).toContain("latestPerAgent");
    // 展示走共享格式化（和人才库 / 经营详情同一个人同一条串）。
    expect(me).toContain("formatPriceRange(inv.priceMinVnd, inv.priceMaxVnd, inv.currency)");
    expect(me).toContain("formatInviteDateTime(inv.startAt, inv.durationH)");
    expect(me).toContain("labelInvitationPurpose(inv.purpose)");
    expect(me).toContain("labelInvitationStatus(inv.status)");
  });

  it("没有邀约时是诚实空态 + 一个真去向，不摆假行", () => {
    expect(me).toContain('title="还没有内容合作"');
    // 空态之外还给一条真链路（去人才库挑人），不是死胡同。
    expect(me).toContain('accessibilityLabel="去 Creator 人才库挑人"');
  });

  it("邀约状态标签走共享映射，封闭集跟服务端对齐", () => {
    expect(labelInvitationStatus("PENDING")).toBe("待回复");
    expect(labelInvitationStatus("COUNTERED")).toBe("待我回应");
    expect(labelInvitationStatus("ACCEPTED")).toBe("已接受");
    // 未知状态返回空串（标签不渲染），不拿「进行中」顶替。
    expect(labelInvitationStatus("SOMETHING_NEW")).toBe("");
    expect(labelInvitationStatus(undefined)).toBe("");
  });
});

describe("MERCHANT-ACTIVITY-DETAIL-001 活动详情", () => {
  it("三个读数与报名进度读的是活动契约字段，不是页面里现编的数", () => {
    // 契约侧字段名钉住（ActivitySchema）。
    const contracts = read("../../../packages/contracts/src/index.ts");
    for (const field of ["interested", "qaCount", "shares", "benefit", "capacity", "consumptionTerm"]) {
      expect(contracts, `ActivitySchema 少了 ${field}`).toContain(`${field}:`);
    }
    // 页面侧读的是同一批字段。
    expect(me).toContain("String(act.interested)");
    expect(me).toContain("String(act.joined)");
    expect(me).toContain("String(act.qaCount)");
    expect(me).toContain("Math.round((act.joined / capacity) * 100)");
    // 没容量就不画进度条，也不编一个「还差 0 人满员」。
    expect(me).toContain("capacity > 0 ? (");
    expect(me).toContain("gap > 0 ?");
  });

  it("封面没上传时是诚实占位，不拿别的图冒充这张活动的实拍", () => {
    expect(me).toContain("activityCoverUri(act, localApiBaseUrl)");
    expect(me).toContain("活动照片待上传");
  });

  it("没有服务端能力的键画成按不了的那一种，并明说按不了", () => {
    // 原型的报名名单 / 提醒报名 / 编辑活动：形状在，按不了。
    expect(me).toContain("function UnavailableActionTile(");
    expect(me).toContain("accessibilityState={{ disabled: true }}");
    expect(me).toContain("暂不可用");
    // 唯一真链路：推广活动可点，并且真的能打开面板。
    expect(me).toContain('setActivitySheet("share")');
    // 报名名单 / 提醒报名 / 编辑活动都不许是 Pressable。
    expect(me).not.toContain("onPress={() => setActivitySheet(\"roster\")}");
  });

  it("商家端不拿 CancelActivity 当成「取消活动」", () => {
    // CancelActivity 是报名者取消自己的报名（participation.go）。商家取消整场
    // 活动服务端没有 —— 所以这一页不许出现一个调 CancelActivity 的取消键。
    expect(me).not.toContain("cancelActivity(");
    expect(me).not.toContain("取消活动");
  });

  it("推广复制的是真实活动信息，不拼一条打不开的链接", () => {
    // App 只注册 proxy:// 一个 scheme（app.json），没有 universal-link 域名，
    // 扫码器只认人 / 店 / 专属码（profile-qr.ts ScannedQr）。所以不许出现
    // 硬拼的活动 URL —— 那是一条点不开的链接。
    expect(me).not.toContain("https://proxy.app/activity");
    expect(me).toContain("Clipboard.setStringAsync(activityShareText(act))");
    expect(me).toContain("Share.share({ message: activityShareText(act) })");
    // 推送给 Creator / 同城粉丝 / 二维码没有通道 —— 在说明里说清，不摆成能点的行。
    expect(me).toContain("推送给合作 Creator、推送给同城粉丝、活动二维码这三项还没接通");
  });

  it("评论分析是诚实空态，不画百分比", () => {
    expect(me).toContain('title="评论分析还没接入"');
    // 空态里那个数必须是服务端给的 qaCount，不是写死的条数。
    expect(me).toContain("${act.qaCount} 条评论");
    // 原型那三条情感占比（62% / 28% / 10%）是编的。这三个数连同情感条 / 关键词云
    // 的结构都不许出现在这一页 —— 那就是有人把假数据画回来了。
    for (const fake of ["62%", "28%", "10%", "sentiment", "keywordCloud", "topicItem"]) {
      expect(me, `假数据 ${fake} 又被画回来了`).not.toContain(fake);
    }
  });
});