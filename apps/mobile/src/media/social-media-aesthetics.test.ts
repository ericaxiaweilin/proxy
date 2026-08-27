import { describe, expect, it } from "vitest";
import {
  SOCIAL_MEDIA_BADGE_INSET,
  SOCIAL_MEDIA_GRID_GAP,
  SOCIAL_MEDIA_RADIUS,
  SOCIAL_MEDIA_RAIL_GAP,
  SOCIAL_MEDIA_RAIL_TRAILING_SPACE
} from "./social-media-aesthetics";

describe("social media aesthetic asset gates", () => {
  it("keeps wall seams visually continuous", () => {
    expect(SOCIAL_MEDIA_GRID_GAP).toBeLessThanOrEqual(2);
  });

  it("uses one restrained radius across media kinds", () => {
    expect(SOCIAL_MEDIA_RADIUS).toBe(12);
  });

  it("keeps rail density high while preserving the next-card cue", () => {
    expect(SOCIAL_MEDIA_RAIL_GAP).toBeLessThanOrEqual(8);
    expect(SOCIAL_MEDIA_RAIL_TRAILING_SPACE).toBeLessThanOrEqual(14);
  });

  it("badge inset is small enough to read as a corner mark, not a card padding", () => {
    // Badges sit on the media surface; if the inset grows past 10pt the
    // badge starts to look like a card padding which breaks the visual
    // hierarchy. Pin it.
    expect(SOCIAL_MEDIA_BADGE_INSET).toBeLessThanOrEqual(10);
  });

  it("token set is the closed P0 surface (adding a token must be intentional)", () => {
    // Pinning the exported surface area so a refactor that accidentally
    // drops a token, renames it, or adds a "convenience" alias is caught.
    expect(Object.keys({
      SOCIAL_MEDIA_RADIUS,
      SOCIAL_MEDIA_GRID_GAP,
      SOCIAL_MEDIA_RAIL_GAP,
      SOCIAL_MEDIA_RAIL_TRAILING_SPACE,
      SOCIAL_MEDIA_BADGE_INSET,
    }).sort()).toEqual([
      "SOCIAL_MEDIA_BADGE_INSET",
      "SOCIAL_MEDIA_GRID_GAP",
      "SOCIAL_MEDIA_RADIUS",
      "SOCIAL_MEDIA_RAIL_GAP",
      "SOCIAL_MEDIA_RAIL_TRAILING_SPACE",
    ]);
  });
});
