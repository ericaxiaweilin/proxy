import { describe, expect, it } from "vitest";
import {
  SCENE_TOOLS,
  SceneAnchorTypeSchema,
  SceneToolIdSchema,
  ParticipationStructureSchema,
  CostStructureSchema,
  BenefitKindSchema,
  type SceneToolId,
} from "./scene";

/**
 * Scene domain contracts are an architecture-stable surface. Renaming
 * or removing an enum member is a wire-format break; adding a member
 * is safe only if every consumer treats unknown values defensively.
 * These tests pin the canonical id set and the per-tool label/intent
 * so a refactor that accidentally drops a tool is caught at unit-test
 * time, not at integration smoke.
 */
describe("scene contract", () => {
  it("SceneToolId is the closed P0 set", () => {
    const ids: SceneToolId[] = ["ACTIVITY", "COFFEE_MEAL", "COMPANION", "CREATOR", "PHOTO", "TRIP"].sort() as SceneToolId[];
    const actual = SCENE_TOOLS.map((t) => t.id).sort();
    expect(actual).toEqual(ids);
  });

  it("every SCENE_TOOLS entry has a non-empty label and intent prompt", () => {
    for (const t of SCENE_TOOLS) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.intentPrompt.length).toBeGreaterThan(0);
    }
  });

  it("SceneToolIdSchema accepts the known ids", () => {
    for (const t of SCENE_TOOLS) {
      expect(SceneToolIdSchema.safeParse(t.id).success).toBe(true);
    }
  });

  it("SceneToolIdSchema rejects unknown ids", () => {
    expect(SceneToolIdSchema.safeParse("MASSAGE").success).toBe(false);
    expect(SceneToolIdSchema.safeParse("").success).toBe(false);
  });

  it("SceneAnchorTypeSchema accepts the six anchor kinds", () => {
    for (const v of ["MERCHANT", "VENUE", "ACTIVITY", "ROUTE", "TRIP", "RESERVATION"] as const) {
      expect(SceneAnchorTypeSchema.safeParse(v).success).toBe(true);
    }
    expect(SceneAnchorTypeSchema.safeParse("UNKNOWN").success).toBe(false);
  });

  it("Participation / Cost / Benefit enums are non-empty and reject unknown values", () => {
    for (const v of ParticipationStructureSchema.options) {
      expect(v.length).toBeGreaterThan(0);
    }
    for (const v of CostStructureSchema.options) {
      expect(v.length).toBeGreaterThan(0);
    }
    for (const v of BenefitKindSchema.options) {
      expect(v.length).toBeGreaterThan(0);
    }
    expect(ParticipationStructureSchema.safeParse("OPEN").success).toBe(false);
    expect(CostStructureSchema.safeParse("FREE_FOR_ALL").success).toBe(false);
    expect(BenefitKindSchema.safeParse("CASH").success).toBe(false);
  });
});
