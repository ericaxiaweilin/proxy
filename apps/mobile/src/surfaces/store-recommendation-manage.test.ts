import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { StoreRecommendation } from "../storeonboarding-client";
import {
  REC_CITIES,
  REC_CITY_FILTERS,
  REC_STATUS_TEXT,
  REC_STORE_TYPES,
  REC_TIP,
  REC_UNCOLLECTED_NOTE,
  countRecs,
  filterRecs,
  highlight,
  recAccent,
  recAddressLine,
  recCityIsPreset,
  recDay,
  recHasPin,
  recInitial,
  recMapsUrl,
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
//      签约完成」、撤回推荐、对接人电话/照片。画出来用户看不出来，但他会照着
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
  it("searches exactly the fields the record can actually store", () => {
    const row = rec({
      storeName: "静心茶馆",
      city: "河内",
      category: "茶室",
      address: "12 Trần Duy Hưng, Cầu Giấy"
    });
    const text = recSearchText(row);
    expect(text).toContain("静心茶馆");
    expect(text).toContain("河内");
    expect(text).toContain("茶室");
    // 地址从 STORE-REC-ADDRESS-001 起进了搜索：运营常常记得门牌、记不住店名，
    // 搜不到就会以为「没人推荐过这家店」。
    expect(text).toContain("trần duy hưng");
    // 推荐理由不参与搜索：占位符没承诺搜它，多搜一样会让人以为「搜不到 =
    // 没推荐过」。设计稿的占位符还写了「对接人」，而推荐记录里
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

  it("does not collect the contact / photo fields the record still cannot store", () => {
    // 地址原本也在这条清单里。STORE-REC-ADDRESS-001（迁移 130）之后服务端真的
    // 存它了，所以清单只剩还没地方放的两项 —— 这是**产品承诺变了**，不是守卫
    // 松了：「地址确实接上了」由下面 STORE-REC-ADDRESS-001 那一组钉住。
    for (const field of ["对接人", "照片"]) {
      expect(manageCode).not.toContain(field);
      expect(listCode).not.toContain(field);
    }
    // 但要说清楚为什么不收 —— 静默少两个字段，用户只会以为是自己没找到。
    expect(REC_UNCOLLECTED_NOTE).toContain("推荐记录里没有这两个字段");
    // 说了不收的东西不能同时又出现在表单里。地址就是这么从这句话里消失的：
    // 界面一边收、一边说不收，是最容易让人不再相信提示的那种不一致。
    expect(REC_UNCOLLECTED_NOTE).not.toContain("门牌");
  });

  it("offers the store types as free-text fillers, not as an enum the server lacks", () => {
    expect(REC_STORE_TYPES.length).toBe(6);
    // category 在服务端是自由文本，所以快捷项只是往同一个输入框里填词。
    expect(manageCode).toContain("REC_STORE_TYPES.map(");
  });
});

// STORE-REC-CITY-001：城市用预设，不用自由文本。
//
// 服务端按城市筛是**精确字符串相等**（`storeonboarding/service.go`），所以
// 「河内」和「河内市」在运营队列里是两个城市 —— 手打出来的错别字不报错，
// 只会让筛选结果静默变空（"看起来没人推荐过"）。这条钉住「城市来自一套预设」，
// 并且那套预设必须**就是全 App 的 canonical 城市集合**，不是本文件自己编的名字。
describe("STORE-REC-CITY-001 城市是预设，不是自由文本", () => {
  const queueCode = stripComments(readFileSync(here("./store-recommendation-queue.tsx"), "utf8"));
  // 跨包读契约源码而不是 import：`@proxy/contracts` 的 dist/index.d.ts 是旧的
  // （JS 里 re-export 了 city-key，d.ts 里没有）⇒ import 会报 TS2305。
  const cityKeySrc = readFileSync(here("../../../../packages/contracts/src/city-key.ts"), "utf8");

  it("预设就是全 App 的 canonical 城市集合，不另立一份词汇", () => {
    // canonical 只有 3 个 key（hanoi / hcmc / danang）。想加第 4 个城市 = 先改契约。
    expect(REC_CITIES.length).toBe(3);
    for (const city of REC_CITIES) {
      // 每个预设城市都必须是契约里认得的别名，否则它就是本地自己编的名字。
      expect(cityKeySrc).toContain(`"${city}":`);
    }
  });

  it("表单先给预设按钮，并且不再提示「例如：河内」那种手打写法", () => {
    expect(manageCode).toContain("REC_CITIES.map(");
    expect(manageCode).not.toContain('placeholder="例如：河内"');
  });

  it("队列的城市筛选也是预设，「全部」= 服务端的不过滤语义", () => {
    expect(queueCode).toContain("REC_CITY_FILTERS.map(");
    expect(queueCode).not.toContain('placeholder="不填 = 全部城市"');
    expect(REC_CITY_FILTERS[0]?.id).toBe("");
    expect(REC_CITY_FILTERS.map((option) => option.id)).toEqual(["", ...REC_CITIES]);
  });

  it("预设外的城市仍可提交，但认得出来它不是预设", () => {
    expect(recCityIsPreset("河内")).toBe(true);
    expect(recCityIsPreset("  胡志明市  ")).toBe(true);
    expect(recCityIsPreset("北宁")).toBe(false);
    // 同一座城市的英文写法在服务端是**另一个城市** —— 这正是要预设的原因。
    expect(recCityIsPreset("Hanoi")).toBe(false);
  });
});

// STORE-REC-ADDRESS-001：推荐记录带上位置（门牌地址 + 地图落点）。
//
// 用户的原话是「推荐管理城市要用预设的+地址地图」。城市那半是
// STORE-REC-CITY-001；这一半是地址 —— 服务端加了三列（迁移 130），
// 表单收地址并能在 iOS 上地图选点，运营队列和详情能看见、能打开地图。
//
// 两个最容易写错、而且写错了不会崩的地方：
//   ① **坐标必须成对**才算「有落点」。只有一半的坐标画不出点，界面却会摆一个
//      「在地图上打开」的按钮，点下去落到几内亚湾（0,0 是那里的真实坐标）。
//   ② **地址与落点各自独立可选**。Android 上地图给不出坐标（MapCanvas 在那边
//      只渲染一张静态卡片），手打地址是那条路上唯一能用的入口 ——
//      所以不能把它做成「只能选点」。
describe("STORE-REC-ADDRESS-001 地址与地图落点", () => {
  const queueCode = stripComments(readFileSync(here("./store-recommendation-queue.tsx"), "utf8"));
  const sheetCode = stripComments(
    readFileSync(here("../components/store-address-sheet.tsx"), "utf8")
  );

  it("只有成对的坐标才算有落点", () => {
    expect(recHasPin(rec({ latitude: 21.01, longitude: 105.79 }))).toBe(true);
    // 半个坐标画不出点 —— 拿它当「有落点」会渲染一个点了没用的按钮。
    expect(recHasPin(rec({ latitude: 21.01 }))).toBe(false);
    expect(recHasPin(rec({ longitude: 105.79 }))).toBe(false);
    expect(recHasPin(rec())).toBe(false);
    // (0,0) 是几内亚湾上的一个真实坐标，不是「没填」的哨兵值。
    expect(recHasPin(rec({ latitude: 0, longitude: 0 }))).toBe(true);
  });

  it("地址行优先门牌，只有落点时退回坐标，两者都没有才空", () => {
    expect(recAddressLine(rec({ address: "  12 Trần Duy Hưng  " }))).toBe("12 Trần Duy Hưng");
    // 只有点没地址：坐标就是我们知道的最具体的东西，显示「—」等于把已有信息藏起来。
    expect(recAddressLine(rec({ latitude: 21.01, longitude: 105.79 }))).toBe("21.01, 105.79");
    expect(recAddressLine(rec())).toBe("");
  });

  it("没有落点就没有地图链接 —— 拿城市名猜一个坐标是编", () => {
    expect(recMapsUrl(rec({ latitude: 21.01, longitude: 105.79 }))).toBe(
      "https://maps.google.com/?q=21.01,105.79"
    );
    expect(recMapsUrl(rec({ address: "12 Trần Duy Hưng" }))).toBeUndefined();
    expect(recMapsUrl(rec({ latitude: 21.01 }))).toBeUndefined();
  });

  it("表单收地址，而且地址能直接手打（Android 上没有地图）", () => {
    expect(manageCode).toContain("address: value");
    expect(manageCode).toContain("在地图上选点");
    // 地图选点是一个真的 sheet，不是点了没反应的按钮。
    expect(manageCode).toContain("<StoreAddressSheet");
    expect(manageCode).toContain("setMapOpen(true)");
    // 提交时只有真的落了点才发坐标（半个坐标服务端会拒，(0,0) 是真实坐标）。
    expect(manageCode).toContain("...(pin ? { latitude: pin.lat, longitude: pin.lng } : {})");
  });

  it("地图 sheet 复用全 App 的地图，不另画一套", () => {
    expect(sheetCode).toContain("<MapCanvas");
    // 地图给不出坐标时（Android）确认键必须是禁用的 ——
    // 摆一个点了没反应的键，比没有键更糟。
    expect(sheetCode).toContain("disabled={!coord}");
    // 落点没有「覆盖半径」这回事：传了 radiusMeters 会画出一个假的覆盖圈。
    expect(sheetCode).not.toContain("radiusMeters");
  });

  it("运营队列能看见地址、能打开地图", () => {
    expect(queueCode).toContain("recAddressLine(row)");
    expect(queueCode).toContain("recHasPin(row)");
    expect(queueCode).toContain("在地图上打开");
  });

  it("详情页也带地址与地图入口", () => {
    expect(manageCode).toContain("recAddressLine(detail)");
    expect(manageCode).toContain("recMapsUrl(detail)");
  });

  it("重新推荐同一家店时位置跟着走，不用再点一次地图", () => {
    expect(manageCode).toContain('address: detail.address ?? ""');
    expect(manageCode).toContain("? { lat: detail.latitude, lng: detail.longitude }");
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
