import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { labelInvitationStatus } from "./creator-capability-labels";
import { activityQrPayload, parseScannedQr, scannedCaption } from "./profile-qr";

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

  // CONTENT-TASK-001（2026-10-04）：这一页换成内容任务页（surfaces/merchant-content.tsx）。
  // 数据源仍是本店发出的邀约 —— 服务端 ListMerchantContentTasks 按商家读邀约、把 UGC 的
  // 组装成任务（稿件 / 审核 / 发布链接），页面不再自己拉一份邀约。详细断言在 content-task.test.ts。
  it("页上每一行都来自服务端（内容任务 = 本店发出的 UGC 邀约），不是页面里写死的样例", () => {
    const content = strip(read("./surfaces/merchant-content.tsx"));
    expect(me).toContain("<MerchantContentSurface");
    expect(content).toContain("supply.listMerchantContentTasks({ merchantId })");
    expect(content).not.toMatch(/const\s+\w+\s*:\s*ContentTaskView\[\]\s*=\s*\[/);
  });

  it("没有任务时是诚实空态 + 一个真去向，不摆假行", () => {
    const content = strip(read("./surfaces/merchant-content.tsx"));
    expect(content).toContain('"还没有内容合作"');
    expect(content).toContain('accessibilityLabel="去 Creator 人才库挑人"');
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
    // 报名名单 / 提醒报名 / 编辑活动都不许是 Pressable —— 它们还没有服务端命令。
    // （MERCHANT-ACTIVITY-OPS-002 起这些键接上真命令时，本条与下面的 not.toContain
    //   要一起改成正向断言，不能靠删断言变绿。）
    expect(me).not.toContain("UnavailableActionTile icon=\"group\" title=\"报名名单\" enabled");
  });

  it("商家端不拿 CancelActivity 当成「取消活动」", () => {
    // CancelActivity 是报名者取消自己的报名（participation.go）。商家取消整场
    // 活动是另一条命令（MERPCHANT-ACTIVITY-OPS-001），不能复用这个名字 ——
    // 同名不同聚合体，日志里根本分不开。
    expect(me).not.toContain("cancelActivity(");
  });

  it("推广复制的是真实活动信息，不拼一条打不开的链接", () => {
    // App 只注册 proxy:// 一个 scheme（app.json），没有 universal-link 域名。
    // 所以二维码走扁平载荷 PROXY-ACTIVITY:<编号>，不许出现硬拼的 https 链接 ——
    // 那是一条点不开的东西。
    expect(me).not.toContain("https://proxy.app/activity");
    expect(me).toContain("Clipboard.setStringAsync(activityShareText(act))");
    expect(me).toContain("Share.share({ message: activityShareText(act) })");
    expect(me).toContain("ProxyQrCode value={activityQrPayload(act.code) ?? \"\"}");
    // 没有编号就不给码：载荷收编号，不收 URL，也不收标题。
    expect(me).toContain("这场活动还没有编号，生成不了二维码。");
    // 推送两项还没接通 —— 在说明里说清，不摆成能点的行。
    expect(me).toContain("推送给合作 Creator、推送给同城粉丝还没接通");
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
describe("MERCHANT-ACTIVITY-DETAIL-001 活动二维码载荷", () => {
  it("扫码器认 PROXY-ACTIVITY:<编号>，且只认服务端分配的编号", () => {
    expect(parseScannedQr("PROXY-ACTIVITY:1000000000123")).toEqual({ kind: "activity", code: "1000000000123", name: "" });
    // 老编号形态（PX-A-yymmdd-####）仍要认 —— 发出去的码还在别人相册里。
    expect(parseScannedQr("PROXY-ACTIVITY:PX-A-260904-0007")).toEqual({ kind: "activity", code: "PX-A-260904-0007", name: "" });
    // 载荷里绝不放标题 / 店名：扫到什么就照什么跳等于替钓鱼码开门。
    expect(parseScannedQr("PROXY-ACTIVITY:抹茶之夜")).toBeNull();
    expect(parseScannedQr("PROXY-ACTIVITY:1000000000123; DROP TABLE")).toBeNull();
    // 扫码页要有独立分支 —— 漏掉会掉进 person 路径拿活动编号去查人。
    const crm = read("./surfaces/friend-crm.tsx");
    expect(crm).toContain('parsed.kind === "activity"');
  });

  it("码下方展示的是编号（App 回查得到的那串），不是标题", () => {
    expect(scannedCaption({ kind: "activity", code: "1000000000123", name: "" })).toBe("1000000000123");
  });

  it("没有编号就不生成码", () => {
    expect(activityQrPayload("1000000000123")).toBe("PROXY-ACTIVITY:1000000000123");
    expect(activityQrPayload(undefined)).toBeNull();
    expect(activityQrPayload("")).toBeNull();
  });
});
