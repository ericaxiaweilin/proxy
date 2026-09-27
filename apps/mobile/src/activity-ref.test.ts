import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_REF_RELATION,
  AUTO_CLASSIFIED_RELATION,
  ENTITY_REF_RELATION,
  contextRefHaystack,
  contextRefLabels,
  isActivityEntityRef,
  isEntityRef,
  labelContextRefs,
  referencedActivityId
} from "./activity-ref.js";

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// ACTIVITY-REF-001 — 「帖文引用了一个活动」。
//
// 病根：`ACTIVITY` 这一个 contextType 同时装着两种东西 —— 服务端分类器贴的
// **标签**（contextId 是人话），和客户端发的**实体引用**（contextId 是
// activityId）。读端分不出来，所以历史上只能把 contextId 当文字用。
//
// 修法是给实体引用加标记 relationType=REFERS_TO，判定走**白名单**。
// 下面的用例把两件事钉住：① 实体引用能被认出来；② 老的行不会被误认。

describe("isActivityEntityRef (白名单：只有显式 REFERS_TO 才算实体引用)", () => {
  it("认得出客户端发的活动引用", () => {
    expect(isActivityEntityRef({ contextType: "ACTIVITY", contextId: "act_westlake", relationType: ACTIVITY_REF_RELATION })).toBe(true);
  });

  it("服务端分类器贴的标签不是实体引用", () => {
    // classification.go classifyPostFallback 的产出：人话 + AUTO_CLASSIFIED
    expect(isActivityEntityRef({ contextType: "ACTIVITY", contextId: "活动", relationType: AUTO_CLASSIFIED_RELATION })).toBe(false);
  });

  it("没有标记的老行不是实体引用（否则会去解析一个人话当 id）", () => {
    // service.go 里 10 处老 seed 就长这样：ACTIVITY + 人话 + 空 relationType。
    // 按黑名单（"不是 AUTO_CLASSIFIED 就算引用"）判定会把它们当 activityId
    // 解析 → 解析不到 → chip 消失。这是回归，不是修复。
    for (const legacy of ["用户活动", "周六新店开业", "找咖啡店", "街头摄影", "晨跑", "夜景拍", "游船拼桌", "海跑", "拼饭", "手工课"]) {
      expect(isActivityEntityRef({ contextType: "ACTIVITY", contextId: legacy })).toBe(false);
      expect(isActivityEntityRef({ contextType: "ACTIVITY", contextId: legacy, relationType: "" })).toBe(false);
    }
  });

  it("别的 contextType 即使带了同名标记也不算活动引用", () => {
    expect(isActivityEntityRef({ contextType: "REALITY_SCENE", contextId: "westlake", relationType: ACTIVITY_REF_RELATION })).toBe(false);
    expect(isActivityEntityRef({ contextType: "QUOTE_POST", contextId: "post_1", relationType: ACTIVITY_REF_RELATION })).toBe(false);
  });

  it("标记值本身不能等于 AUTO_CLASSIFIED", () => {
    // 服务端 mergeClassificationRefs（classification.go:93）会把
    // relationType == AUTO_CLASSIFIED 的 ref 当分类标签丢掉重算。标记一旦取成
    // 这个值，用户发的活动引用会在服务端被静默抹掉 —— 客户端以为发成功了。
    expect(ACTIVITY_REF_RELATION).not.toBe(AUTO_CLASSIFIED_RELATION);
    expect(AUTO_CLASSIFIED_RELATION).toBe("AUTO_CLASSIFIED");
  });
});

describe("referencedActivityId", () => {
  it("取出引用指向的活动 id", () => {
    expect(referencedActivityId({ contextRefs: [
      { contextType: "ACTIVITY", contextId: "act_westlake", relationType: ACTIVITY_REF_RELATION },
      { contextType: "ACTIVITY", contextId: "活动", relationType: AUTO_CLASSIFIED_RELATION }
    ] })).toBe("act_westlake");
  });

  it("没有引用时是 undefined —— 不是空串，也不是随便挑一个标签当 id", () => {
    expect(referencedActivityId({ contextRefs: [] })).toBeUndefined();
    expect(referencedActivityId({ contextRefs: [
      { contextType: "ACTIVITY", contextId: "晨跑" },
      { contextType: "VENUE", contextId: "老街小吃" }
    ] })).toBeUndefined();
  });
});

describe("labelContextRefs (chip 行只画标签)", () => {
  const post = {
    contextRefs: [
      { contextType: "REALITY_SCENE", contextId: "bonsaidon", relationType: "FEATURED_AT" },
      { contextType: "ACTIVITY", contextId: "act_westlake", relationType: ACTIVITY_REF_RELATION },
      { contextType: "ACTIVITY", contextId: "街头摄影" },
      { contextType: "QUOTE_POST", contextId: "post_seed_linh_01" }
    ]
  };

  it("活动实体引用不进 chip 行（否则会印出一行裸 activityId）", () => {
    expect(labelContextRefs(post).map((ref) => ref.contextId)).not.toContain("act_westlake");
  });

  it("QUOTE_POST 照旧不进 chip 行（它有引用卡片）", () => {
    expect(labelContextRefs(post).map((ref) => ref.contextType)).not.toContain("QUOTE_POST");
  });

  it("REALITY_SCENE 照旧留在 chip 行（它本来就是可点的场景 chip）", () => {
    expect(labelContextRefs(post).map((ref) => ref.contextId)).toContain("bonsaidon");
  });

  it("老 seed 的人话 ACTIVITY 行照旧留在 chip 行 —— 不回归", () => {
    expect(labelContextRefs(post).map((ref) => ref.contextId)).toContain("街头摄影");
  });
});

describe("contextRefLabels / contextRefHaystack (搜索词堆里不能出现 id)", () => {
  const post = {
    contextRefs: [
      { contextType: "ACTIVITY", contextId: "act_westlake", relationType: ACTIVITY_REF_RELATION },
      { contextType: "ACTIVITY", contextId: "街头摄影", relationType: AUTO_CLASSIFIED_RELATION }
    ]
  };

  it("activityId 不进词堆", () => {
    expect(contextRefLabels(post)).toEqual(["街头摄影"]);
    expect(contextRefHaystack(post)).toBe("街头摄影");
    expect(contextRefHaystack(post)).not.toContain("act_westlake");
  });

  it("标签仍然进词堆 —— 话题/静音判定照旧能命中", () => {
    // feed.tsx 的 photo 频道谓词就是靠 contextId.includes("摄影") 判定的。
    expect(contextRefLabels(post).some((label) => label.includes("摄影"))).toBe(true);
  });

  it("id 里含关键词也不会误判成话题", () => {
    // 「带 ai 的 id 把帖文判成创业话题」这类事故的守门用例。
    const tricky = { contextRefs: [{ contextType: "ACTIVITY", contextId: "act_ai_photography", relationType: ACTIVITY_REF_RELATION }] };
    expect(contextRefHaystack(tricky)).toBe("");
  });
});

describe("ACTIVITY-REF-001 read sites (源码级：读端必须走词表)", () => {
  const feed = source("./surfaces/feed.tsx");

  it("feed.tsx 不再直接拿 contextId 拼搜索词堆", () => {
    expect(feed).not.toContain("post.contextRefs.map((entry) => entry.contextId)");
    expect(feed).toContain("contextRefLabels(post)");
    expect(feed).toContain("contextRefHaystack(post)");
  });

  it("feed.tsx 的 chip 行走 labelContextRefs，不再只排 QUOTE_POST", () => {
    expect(feed).toContain("const chips = labelContextRefs(post);");
    expect(feed).not.toContain('post.contextRefs.filter((entry) => entry.contextType !== "QUOTE_POST")');
  });

  it("feed.tsx 画活动引用卡片，且解析不到时不画 id", () => {
    expect(feed).toContain("referencedActivityId(post)");
    expect(feed).toContain("activityRefCard");
    // 解析不到的分支必须说「不可用」，不能退回印 id。
    expect(feed).toContain("引用的活动已不可用");
    expect(feed).toContain("activityRefMissing");
  });

  it("feed.tsx 用活动读模型建解析表（仓库里没有 GetActivity）", () => {
    expect(feed).toContain("activityClient.listActivities()");
    expect(feed).toContain("activityById");
  });

  it("ProfileTabs.tsx 的 chip 行同样走词表，且不再把人话标签当场景 id 传出去", () => {
    const profileTabs = source("./surfaces/ProfileTabs.tsx");
    expect(profileTabs).toContain("const contextChips = labelContextRefs(props.post);");
    expect(profileTabs).not.toContain("props.post.contextRefs.map((entry) => (");
    expect(profileTabs).toContain('disabled={entry.contextType !== "REALITY_SCENE" || !props.onOpenScene}');
  });
});

describe("ACTIVITY-REF-001 write side (源码级：写入端必须带标记)", () => {
  const publish = source("./composer-publish.ts");

  it("composer-publish 用共享常量写标记，不写字面量", () => {
    expect(publish).toContain("relationType: ACTIVITY_REF_RELATION");
    expect(publish).not.toContain('relationType: "REFERS_TO"');
  });

  it("草稿里带 activityId 才会产出引用", () => {
    expect(publish).toContain("if (draft.activityId) contextRefs.push(");
  });

  it("发帖器有「关联活动」入口，且没有 activityClient 时入口不出现", () => {
    const composer = source("./surfaces/ComposerV2Screen.tsx");
    expect(composer).toContain("openActivityPicker");
    expect(composer).toContain('label="关联活动"');
    expect(composer).toContain("activityId: activity?.id ?? null");
    // 半截接线的守门：没有 client 就不给入口。
    expect(composer).toContain("{activityClient ? (");
  });

  it("活动列表取不到和没有活动是两种提示", () => {
    const composer = source("./surfaces/ComposerV2Screen.tsx");
    expect(composer).toContain("活动列表取不到");
    expect(composer).toContain("当前没有可关联的活动");
  });
});

describe("isEntityRef (标记跟具体实体无关)", () => {
  it("活动是实体引用，别的实体将来也能用同一个标记", () => {
    expect(isEntityRef({ contextType: "ACTIVITY", contextId: "act_1", relationType: ENTITY_REF_RELATION })).toBe(true);
    expect(isEntityRef({ contextType: "OPPORTUNITY", contextId: "opp_1", relationType: ENTITY_REF_RELATION })).toBe(true);
  });

  it("REALITY_SCENE 用的是 FEATURED_AT，不是实体引用的标记（它照旧是 chip）", () => {
    expect(isEntityRef({ contextType: "REALITY_SCENE", contextId: "westlake", relationType: "FEATURED_AT" })).toBe(false);
  });

  it("活动标记就是实体引用标记的别名，不是各写一份", () => {
    expect(ACTIVITY_REF_RELATION).toBe(ENTITY_REF_RELATION);
  });
});

describe("feed-content.ts 的机会引用不再是反的（ACTIVITY-REF-001 附带修正）", () => {
  const feedContent = source("./feed-content.ts");

  it("contextId 放机会 id，不再放标题；id 也不再塞进 relationType", () => {
    expect(feedContent).toContain("contextType: \"OPPORTUNITY\", contextId: opportunity.id");
    expect(feedContent).not.toContain("contextId: opportunity.title, relationType: opportunity.id");
  });

  it("文件里写明了它是生产死代码，接线时要配卡片", () => {
    // 这条钉的是「诚实」本身：一个生产里没人调的文件，改完必须说清楚改了什么、
    // 没改到什么。否则下一个人会以为接上它就完事了。
    expect(feedContent).toContain("死代码");
    expect(feedContent).toContain("机会卡片");
  });
});

describe("ACTIVITY-REF-001 服务端两侧的词表必须对得上", () => {
  it("服务端确实会把 AUTO_CLASSIFIED 的 ref 丢掉重算（标记不能取这个值）", () => {
    // 这条钉的是「为什么 REFERS_TO 不能省、也不能等于 AUTO_CLASSIFIED」这个
    // 判断依据本身。服务端哪天不再按 relationType 过滤，这条会变红，提醒重看。
    const classification = readFileSync(
      fileURLToPath(new URL("../../api-go/internal/localnet/classification.go", import.meta.url)),
      "utf8"
    );
    expect(classification).toContain('ref.RelationType == "AUTO_CLASSIFIED"');
    expect(classification).toContain('ref.RelationType = "AUTO_CLASSIFIED"');
  });
});
