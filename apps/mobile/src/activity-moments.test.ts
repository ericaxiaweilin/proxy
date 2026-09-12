import { describe, expect, it } from "vitest";
import {
  ACTIVITY_TEMPLATES,
  buildActivityPublishInput,
  defaultActivitySpecs
} from "./activity-moments";

describe("R58 activity wizard mapping", () => {
  it("ships six activity templates", () => {
    expect(ACTIVITY_TEMPLATES.map((template) => template.id)).toEqual(
      ["sunset-ride", "film-walk", "coffee-party", "exhibition", "citywalk-local", "ktv"]
    );
  });

  it("maps specs to a publishable input with fee rules", () => {
    const template = ACTIVITY_TEMPLATES[0]!;
    const free = buildActivityPublishInput(template, { ...defaultActivitySpecs(template), fee: "FREE" }, "scene_westlake");
    expect(free.consumptionTerm).toBe("HOST_COVERS");
    expect(free.signupMode).toBe("OPEN");
    expect(free.theme).toBe("日落");
    expect(free.realitySceneId).toBe("scene_westlake");
    const aa = buildActivityPublishInput(template, { ...defaultActivitySpecs(template), fee: "AA" }, "scene_westlake");
    expect(aa.consumptionTerm).toBe("SPLIT");
    const custom = buildActivityPublishInput(
      template,
      { ...defaultActivitySpecs(template), fee: "CUSTOM", customFee: "300K", notes: "带相机" },
      "scene_westlake"
    );
    expect(custom.consumptionTerm).toBe("SPLIT");
    expect(custom.desc).toContain("带相机");
    expect(custom.desc).toContain("费用安排：300K");
  });

  it("drops empty theme instead of sending blank", () => {
    const template = ACTIVITY_TEMPLATES[2]!;
    const input = buildActivityPublishInput(template, { ...defaultActivitySpecs(template), theme: "无主题" }, "scene_x");
    expect(input.theme).toBeUndefined();
  });
});
