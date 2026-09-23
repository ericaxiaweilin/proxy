import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// recommend-fixtures 经 native-clients 拖进 react-native，测试环境里解析不了；
// 仓库既有做法（见 person-distance-zero.test.ts）是把 base url 直接 mock 掉。
vi.mock("./native-clients", () => ({ localApiBaseUrl: "http://127.0.0.1:1" }));

import { SCENE_RECOMMEND, resolveHomePersonAccountId } from "./recommend-fixtures";

const source = readFileSync(fileURLToPath(new URL("./surfaces/requester-home.tsx", import.meta.url)), "utf8");

// HOME-FRIEND-ID-001（2026-09-22）：首页真人卡用的是本地 fixture id（u_linh），
// 服务端账号是 user_mockcreator_linh，而关系链状态表是按服务端账号 id 建的。
// 两边不对齐时有两个症状，而且都不报错：
//   ① 点 + 把 fixture id 当 targetUserId 发出去 → 申请落在不存在的账号上，
//      没有真人能收到同意入口（库里实测攒了 12 条无人可同意的 PENDING）；
//   ② 对方同意后卡片仍显示「+ 添加」，因为按 u_linh 查不到状态。
// 这条测试钉住「发送前解析、状态按解析后的 id 查」。
//
// HOME-RAIL-ACCOUNT-001（2026-09-23）：上一版的解法是「没账号的人不发申请」——
// 那只把错误变成了一句更礼貌的错误。用户报 P0 后改成：rail 上每一个人都必须
// 有服务端账号，所以这里逐个断言 28 个人全能解析（见下面的 it）。
describe("HOME-FRIEND-ID-001 home rail sends the account id, not the fixture id", () => {
  it("maps home fixture ids to the server account id", () => {
    expect(resolveHomePersonAccountId("u_linh")).toBe("user_mockcreator_linh");
    expect(resolveHomePersonAccountId("u_hana")).toBe("user_mockcreator_hana");
  });

  it("maps every rail person to their server account (HOME-RAIL-ACCOUNT-001)", () => {
    // u_vy / u_quynh_anh 曾经没有服务端账号：点 + 只会得到「还没有账号，暂时加不了
    // 好友」，而卡片上顶着「真人」徽标。rail 上 28 个人现在全部有账号 —— 这里逐个
    // 断言「解析后的 id 不再以 u_ 开头」，也就是 relationshipKeyFor 不会再返回
    // undefined。少一个人就会红。
    const railIds = new Set<string>();
    for (const feed of Object.values(SCENE_RECOMMEND)) {
      for (const person of feed.people) railIds.add(person.id);
    }
    expect(railIds.size).toBe(28);
    const accountless = [...railIds].filter((id) => resolveHomePersonAccountId(id) === id);
    expect(accountless).toEqual([]);
    expect(resolveHomePersonAccountId("u_vy")).toBe("user_mockcreator_vy");
    expect(resolveHomePersonAccountId("u_quynh_anh")).toBe("user_mockcreator_quynh_anh");
    // 已经是账号 id 的（含 AI 账号）原样返回，不能二次前缀。
    expect(resolveHomePersonAccountId("user_mockcreator_mai")).toBe("user_mockcreator_mai");
    expect(resolveHomePersonAccountId("ai_account_001")).toBe("ai_account_001");
  });

  it("resolves the target before it reaches the relationship API", () => {
    expect(source).toContain('import { resolveHomePersonAccountId } from "../recommend-fixtures";');
    expect(source).toContain("const key = relationshipKeyFor(id);");
    expect(source).toContain("await relationship.sendFriendRequest(key)");
    expect(source).toContain("await relationship.acceptFriendRequest(key)");
    // 反向臂：不许再把原始 id 直接发出去（旧写法）。
    expect(source).not.toContain("await relationship.sendFriendRequest(id)");
    expect(source).not.toContain("await relationship.acceptFriendRequest(id)");
  });

  it("refuses to send when the fixture person has no server account", () => {
    // 无账号的人以前会发出一条幽灵申请；现在早退并给出人话提示。
    expect(source).toContain('setRelationshipMsg(t("noAccountYet", { name }));');
  });

  it("reads relationship state through the resolved key on the home rail and the scene preview", () => {
    // 状态表按账号 id 建（listMyFriendships → next.set(item.userId, …)），
    // 所以两处 fixture 入口都必须走 relationshipStateFor / relationshipBusyFor。
    expect(source).toContain('disabled={relationshipBusyFor(p.id) || relationshipStateFor(p.id) === "OUTGOING"');
    expect(source).toContain('relationshipLabel(p.id, p.name)');
    expect(source).not.toContain("relationshipStates.get(p.id)");
    expect(source).not.toContain("relationshipBusyId === p.id");
    expect(source).not.toContain("relationshipStates.get(humanScenePreview.person.id)");
    expect(source).not.toContain("relationshipBusyId === humanScenePreview.person.id");
  });
});
