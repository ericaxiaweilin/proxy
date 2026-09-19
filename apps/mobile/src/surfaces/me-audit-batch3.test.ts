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
    expect(meCode).toContain("位关注者");
  });
});
