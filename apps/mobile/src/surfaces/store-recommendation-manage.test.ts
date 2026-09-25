import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StoreRecommendation } from "../storeonboarding-client";
import {
  REC_STATUS_TEXT,
  REC_STORE_TYPES,
  REC_TIP,
  REC_UNCOLLECTED_NOTE,
  countRecs,
  filterRecs,
  highlight,
  recAccent,
  recDay,
  recInitial,
  recMoment,
  recNextStep,
  recSearchText,
  recStages,
  recStatus
} from "./store-recommendation-manage-model";

// STORE-REC-MANAGE-001：把设计稿（deepseek_html_20260925_38b4e5.html）做进
// 「推荐管理」。这个文件钉两件事：
//
//   ① **读模型算得对** —— 状态归类、计数、搜索、进度阶段。这些错了不会崩，
//      只会静默给用户一个错误结论（「已采纳」当成「已签约」、搜索漏字段、
//      进度画到一段不存在的阶段）。
//   ② **设计稿里系统没有的东西不许画** —— 奖励金额、4 段进度里的「线下洽谈 /
//      签约完成」、撤回推荐、地址/对接人/照片。画出来用户看不出来，但他会照着
//      它做决定。这条只能靠对源码做文本钉（surfaces/*.tsx 不能被 vitest import）。

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// 剥注释再断言：本仓库的注释里刻意复述了被钉的串（解释为什么这么写），
// 不剥的话「把代码删掉」测试照样绿 —— 那就是注释替代码把关的假守卫。
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const manageCode = stripComments(readFileSync(here("./store-recommendation-manage.tsx"), "utf8"));
const listCode = stripComments(readFileSync(here("./my-store-recommendations.tsx"), "utf8"));
const modelCode = stripComments(
  readFileSync(here("./store-recommendation-manage-model.ts"), "utf8")
);

function rec(over: Partial<StoreRecommendation> = {}): StoreRecommendation {
  return {
    recommendationId: "r1",
    storeName: "Lotus Spa · 还剑湖店",
    city: "河内",
    category: "SPA",
    reason: "环境安静，位置靠湖",
    recommendedByAccountId: "acc_1",
    origin: "USER",
    createdAt: "2026-10-08T02:00:00Z",
    ...over
  };
}

describe("推荐状态：服务端只有 ACCEPT / REJECT，没有「已签约」", () => {
  it("maps the two decisions and the absent one onto three statuses", () => {
    expect(recStatus(rec({ decision: "ACCEPT" }))).toBe("ACCEPTED");
    expect(recStatus(rec({ decision: "REJECT" }))).toBe("REJECTED");
    // 服务端用 omitempty：没评估时 decision 根本不出现。
    expect(recStatus(rec())).toBe("PENDING");
  });

  it("never claims more than the system knows", () => {
    // 「已签约」是设计稿的说法。服务端只记「批准接入」，签约是另一件事，
    // 而且没有任何字段能证明它发生过。
    expect(Object.values(REC_STATUS_TEXT).join(" ")).not.toContain("签约");
    expect(modelCode).not.toContain("已签约");
    expect(manageCode).not.toContain("已签约");
    expect(listCode).not.toContain("已签约");
  });

  it("counts the three buckets, and the buckets add up to the total", () => {
    const rows = [
      rec({ recommendationId: "a" }),
      rec({ recommendationId: "b", decision: "ACCEPT" }),
      rec({ recommendationId: "c", decision: "ACCEPT" }),
      rec({ recommendationId: "d", decision: "REJECT" })
    ];
    const counts = countRecs(rows);
    expect(counts).toEqual({ total: 4, pending: 1, accepted: 2, rejected: 1 });
    expect(counts.pending + counts.accepted + counts.rejected).toBe(counts.total);
    expect(countRecs([])).toEqual({ total: 0, pending: 0, accepted: 0, rejected: 0 });
  });
});

describe("搜索与筛选", () => {
  it("searches exactly the three fields the placeholder promises", () => {
    const row = rec({ storeName: "静心茶馆", city: "河内", category: "茶室" });
    const text = recSearchText(row);
    expect(text).toContain("静心茶馆");
    expect(text).toContain("河内");
    expect(text).toContain("茶室");
    // 推荐理由不参与搜索：占位符写的是「店名、城市、品类」，多搜一样会让人
    // 以为「搜不到 = 没推荐过」。设计稿的占位符还写了「对接人」，而推荐记录里
    // 没有这个字段 —— 那正是这个断言要挡住的东西。
    expect(text).not.toContain("环境安静");
    expect(text).not.toContain("acc_1");
  });

  it("filters by status before matching the query", () => {
    const rows = [
      rec({ recommendationId: "a", storeName: "静心茶馆" }),
      rec({ recommendationId: "b", storeName: "静心茶馆", decision: "REJECT" })
    ];
    expect(filterRecs(rows, "ALL", "").map((r) => r.recommendationId)).toEqual(["a", "b"]);
    expect(filterRecs(rows, "PENDING", "").map((r) => r.recommendationId)).toEqual(["a"]);
    expect(filterRecs(rows, "REJECTED", "").map((r) => r.recommendationId)).toEqual(["b"]);
    expect(filterRecs(rows, "ACCEPTED", "")).toEqual([]);
    expect(filterRecs(rows, "ALL", "静心").map((r) => r.recommendationId)).toEqual(["a", "b"]);
    // 大小写不敏感（店名里常有拉丁字母）。
    expect(filterRecs([rec({ storeName: "Blue Note 酒吧" })], "ALL", "blue note")).toHaveLength(1);
  });
});

describe("搜索高亮不能切错字", () => {
  it("reassembles the original string exactly", () => {
    for (const query of ["", "spa", "还剑湖", "LOTUS", "不存在"]) {
      const text = "Lotus Spa · 还剑湖店";
      expect(highlight(text, query).map((s) => s.text).join("")).toBe(text);
    }
  });

  it("marks only the hits, case-insensitively", () => {
    const segments = highlight("Lotus Spa · 还剑湖店", "spa");
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(["Spa"]);
    expect(highlight("静心茶馆", "茶馆").filter((s) => s.hit).map((s) => s.text)).toEqual(["茶馆"]);
    expect(highlight("静心茶馆", "咖啡").every((s) => !s.hit)).toBe(true);
    expect(highlight("", "x")).toEqual([]);
  });
});

describe("进度只有 3 段：设计稿那 4 段里有两段系统不知道", () => {
  it("derives the stages from the two timestamps the server actually has", () => {
    const pending = recStages(rec());
    expect(pending.map((s) => s.label)).toEqual(["提交推荐", "平台评估", "店铺接入"]);
    expect(pending.map((s) => s.state)).toEqual(["done", "active", "todo"]);
    expect(pending[0]?.at).toBe("2026-10-08T02:00:00Z");

    const accepted = recStages(rec({ decision: "ACCEPT", decidedAt: "2026-10-09T02:00:00Z" }));
    expect(accepted.map((s) => s.state)).toEqual(["done", "done", "active"]);
    expect(accepted[1]?.at).toBe("2026-10-09T02:00:00Z");
    // 采纳 ≠ 店铺已存在。第三段必须是「待办」，不能画成完成。
    expect(accepted[2]?.desc).toContain("不会自己出现");

    const rejected = recStages(rec({ decision: "REJECT", decisionReason: "位置偏" }));
    expect(rejected.map((s) => s.state)).toEqual(["done", "fail", "todo"]);
    expect(rejected[1]?.desc).toContain("位置偏");
    // 运营没留理由时说「没留理由」，不编一个。
    expect(recStages(rec({ decision: "REJECT" }))[1]?.desc).toContain("没有留理由");
  });

  it("does not render the two stages the system has no data for", () => {
    for (const stage of ["线下洽谈", "签约完成"]) {
      expect(modelCode).not.toContain(stage);
      expect(manageCode).not.toContain(stage);
      expect(listCode).not.toContain(stage);
    }
  });
});

describe("不画系统里没有的东西", () => {
  it("has no reward amount, because there is no reward model", () => {
    for (const source of [modelCode, manageCode, listCode]) {
      expect(source).not.toContain("成长值");
      expect(source).not.toContain("+800");
      expect(source).not.toContain("独家");
    }
    // 提示语只写今天真会发生的事，并且明说「采纳不等于店铺已存在」。
    expect(REC_TIP).toContain("不等于店铺已存在");
  });

  it("has no withdraw button, because there is no withdraw command", () => {
    expect(manageCode).not.toContain("撤回");
    expect(listCode).not.toContain("撤回");
  });

  it("does not collect address / contact / photos the record cannot store", () => {
    for (const field of ["对接人", "门牌", "照片"]) {
      expect(manageCode).not.toContain(field);
      expect(listCode).not.toContain(field);
    }
    // 但要说清楚为什么不收 —— 静默少三个字段，用户只会以为是自己没找到。
    expect(REC_UNCOLLECTED_NOTE).toContain("推荐记录里没有这几个字段");
  });

  it("offers the store types as free-text fillers, not as an enum the server lacks", () => {
    expect(REC_STORE_TYPES.length).toBe(6);
    // category 在服务端是自由文本，所以快捷项只是往同一个输入框里填词。
    expect(manageCode).toContain("REC_STORE_TYPES.map(");
  });
});

describe("接线：三个入口落到同一屏，命令一个都没换", () => {
  it("keeps the real commands and the real read path", () => {
    for (const call of [
      "listMyRecommendations",
      "recommendStore",
      "suggestRecommendation"
    ]) {
      expect(manageCode).toContain(call);
    }
    // 小美整理是**只读**的：草稿要用户确认后才由 recommendStore 落库。
    expect(manageCode).toContain("suggestRecommendation(note)");
    // 底座没配置时把入口藏掉，而不是弹红字或留一个点了没反应的按钮。
    expect(manageCode).toContain("StoreRecommendationAiUnavailableError");
    expect(manageCode).toContain("setAiAvailable(false)");
  });

  it("renders the list from the parent's rows so the tab badge and the list agree", () => {
    // 取数只有一处（StoreRecommendationManage），列表屏是纯展示组件 ——
    // 两处各拉一次必然出现「徽标 4 条、列表 3 条」。
    expect(manageCode).toContain("<MyStoreRecommendations");
    expect(listCode).not.toContain("listMyRecommendations");
  });

  it("keeps the tabs driven by the caller, so the copy stays where it is pinned", () => {
    expect(manageCode).toContain("tabs.map(");
    expect(manageCode).toContain("setTab(entry.id)");
  });
});

describe("小工具", () => {
  it("formats absolute timestamps, never a drifting 'x 小时前'", () => {
    expect(recDay("2026-10-08T02:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(recMoment("2026-10-08T02:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 解析不了就原样返回，不显示 NaN。
    expect(recDay("not-a-date")).toBe("not-a-date");
  });

  it("gives a store the same colour block every time, and never a fake photo", () => {
    expect(recAccent("静心茶馆")).toBe(recAccent("静心茶馆"));
    expect(["lime", "rose", "sky", "gold"]).toContain(recAccent("静心茶馆"));
    expect(recInitial("Lotus Spa")).toBe("L");
    expect(recInitial("  ")).toBe("店");
  });

  it("tells the recommender what to do next in each state", () => {
    expect(recNextStep(rec({ decision: "ACCEPT" }))).toContain("把店建出来");
    expect(recNextStep(rec({ decision: "REJECT" }))).toContain("重新推荐");
    expect(recNextStep(rec())).toContain("评估");
  });
});
