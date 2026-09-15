import { describe, expect, it } from "vitest";
import {
  activitiesAtScene,
  activitySignupLabel,
  canSignUp,
  isSceneActivity,
  sceneActivityFeed,
  sceneActivityFeedText,
  type SceneActivity
} from "./scene-activities";

function activity(overrides: Partial<SceneActivity> = {}): SceneActivity {
  return {
    activityId: "a1",
    title: "周六拍照搭子",
    time: "周六 15:00–17:00",
    people: "0 / 2 人",
    joined: 0,
    capacity: 2,
    realitySceneId: "threebeans",
    ...overrides
  };
}

describe("SCENE-EVENT-SIGNUP-001 场景活动列表", () => {
  it("只留下属于这个场景的活动，没有 realitySceneId 的一律不算", () => {
    const list = [
      activity({ activityId: "a1", realitySceneId: "threebeans" }),
      activity({ activityId: "a2", realitySceneId: "hoankiem" }),
      activity({ activityId: "a3", realitySceneId: undefined })
    ];
    const at = activitiesAtScene(list, "threebeans");
    expect(at.map((item) => item.activityId)).toEqual(["a1"]);
    // 空 sceneId 不该"放宽"成返回全部 —— 那会把别的场景的活动错显示过来。
    expect(activitiesAtScene(list, "")).toEqual([]);
  });

  it("名额判定只看数字，不看 people 字符串", () => {
    // people 写着 "0 / 2 人" 但 joined 已经是 2 —— 报名必须被拒，
    // 否则就是拿展示串当事实（SCENE-ACTIVITY-LINK-001 咬过的那类）。
    expect(canSignUp(activity({ joined: 2, capacity: 2, people: "0 / 2 人" }))).toBe(false);
    expect(canSignUp(activity({ joined: 1, capacity: 2 }))).toBe(true);
    // 不设名额的活动随时可报
    expect(canSignUp(activity({ joined: 99, capacity: 0 }))).toBe(true);
  });

  it("契约里 capacity 缺失 = 不设名额，不是名额为 0", () => {
    const noCapacity = activity({ joined: 3, capacity: undefined });
    expect(canSignUp(noCapacity)).toBe(true);
    expect(activitySignupLabel(noCapacity)).toBe("不限名额");
    expect(isSceneActivity(noCapacity)).toBe(true);
  });

  it("不设名额时不编一个人数出来", () => {
    expect(activitySignupLabel(activity({ joined: 3, capacity: 0, people: "" }))).toBe("不限名额");
    expect(activitySignupLabel(activity({ joined: 2, capacity: 2 }))).toBe("名额已满（2 / 2）");
    expect(activitySignupLabel(activity({ joined: 1, capacity: 4 }))).toBe("1 / 4 人 · 可报名");
  });

  it("有内容就是 READY，不被 ERROR/EMPTY 覆盖", () => {
    const items = [activity()];
    expect(sceneActivityFeed(items, "ERROR").state).toBe("READY");
    expect(sceneActivityFeed(items, "EMPTY").state).toBe("READY");
    expect(sceneActivityFeed([], "ERROR").state).toBe("ERROR");
    expect(sceneActivityFeed([], "EMPTY").state).toBe("EMPTY");
  });

  it("「正在取」「没有活动」「取不到」「没登录」四种状态各不相同", () => {
    const texts = {
      loading: sceneActivityFeedText({ state: "LOADING", items: [] }),
      empty: sceneActivityFeedText({ state: "EMPTY", items: [] }),
      error: sceneActivityFeedText({ state: "ERROR", items: [] }),
      signedOut: sceneActivityFeedText({ state: "SIGNED_OUT", items: [] })
    };
    const values = Object.values(texts);
    expect(new Set(values).size).toBe(values.length);
    values.forEach((text) => expect(text.length).toBeGreaterThan(0));

    // 取不到绝不能被说成"还没有活动" —— 用户会以为这里真没活动。
    expect(texts.error).toContain("取不到");
    expect(texts.empty).toContain("还没有");
    // 没登录是"没权限"，不是"没数据"。
    expect(texts.signedOut).toContain("登录");
    // READY 不该再叠一句状态文案在列表上面。
    expect(sceneActivityFeedText({ state: "READY", items: [activity()] })).toBe("");
  });

  it("isSceneActivity 挡掉缺字段的记录", () => {
    expect(isSceneActivity(activity())).toBe(true);
    expect(isSceneActivity({ ...activity(), activityId: "" })).toBe(false);
    expect(isSceneActivity({ ...activity(), joined: "0" })).toBe(false);
    expect(isSceneActivity({ ...activity(), capacity: Number.NaN })).toBe(false);
    expect(isSceneActivity(null)).toBe(false);
    expect(isSceneActivity("a1")).toBe(false);
  });
});
