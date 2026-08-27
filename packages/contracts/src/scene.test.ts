import { describe, expect, it } from "vitest";
import {
  SCENE_TOOLS,
  SceneAnchorTypeSchema,
  SceneToolIdSchema,
  ParticipationStructureSchema,
  CostStructureSchema,
  BenefitKindSchema,
  MemorySchema,
  RecordOutcomePayloadSchema,
  SceneCommandTypeSchema,
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

// ── R15.13 P2: SceneCommandType stability (architectural surface) ──────
//
// The SceneCommandType union is the wire contract between the mobile
// client, the api-go dispatcher, and the OpenAPI spec generator. Adding
// a value is safe; removing or renaming a value breaks mobile builds
// and the api-go server. Pin the canonical set so a refactor that drops
// "ListMyMemories" or "GetMemory" fails the unit test instead of
// silently producing a notImplemented response at runtime.

describe("scene command type stability (R15.13 P2)", () => {
  it("SceneCommandType is the closed R15.13 P0+P1+P2 set", () => {
    const expected = [
      "CreateScene",
      "UpdateScene",
      "PublishScene",
      "CreateInvitation",
      "RespondInvitation",
      "RecordAttendance",
      "RecordOutcome",
      "ListMyScenes",
      "ListMyInvitations",
      "ListMyMemories",
      "GetMemory",
    ].sort();
    const actual = [...SceneCommandTypeSchema.options].sort();
    expect(actual).toEqual(expected);
  });

  it("MemorySchema accepts the api-go Go-side payload shape", () => {
    const ok = MemorySchema.safeParse({
      memoryId: "mem_001",
      sceneId: "scene_001",
      sceneType: "ROOFTOP_PHOTO",
      actualSpend: 50000,
      plannedBudget: 60000,
      currency: "VND",
      durationMin: 90,
      rating: 0.78,
      notes: "great spot",
      createdAt: "2026-08-27T10:00:00.000Z",
      role: "HOST",
    });
    expect(ok.success).toBe(true);
  });

  it("MemorySchema rejects negative actualSpend", () => {
    const bad = MemorySchema.safeParse({
      memoryId: "mem_001",
      sceneId: "scene_001",
      actualSpend: -1,
      createdAt: "2026-08-27T10:00:00.000Z",
    });
    expect(bad.success).toBe(false);
  });

  it("RecordOutcomePayload requires guestId + non-negative actualSpend", () => {
    const noGuest = RecordOutcomePayloadSchema.safeParse({ actualSpend: 100 });
    expect(noGuest.success).toBe(false);
    const negSpend = RecordOutcomePayloadSchema.safeParse({ guestId: "g", actualSpend: -1 });
    expect(negSpend.success).toBe(false);
    const ok = RecordOutcomePayloadSchema.safeParse({ guestId: "g", actualSpend: 0 });
    expect(ok.success).toBe(true);
  });
});
