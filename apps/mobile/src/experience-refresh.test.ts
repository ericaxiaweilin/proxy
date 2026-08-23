import { describe, expect, it } from "vitest";
import type { ExperienceManifest } from "@proxy/contracts";
import { keepManifestRevision } from "./experience-refresh";

function manifest(context: ExperienceManifest["context"], revision: string): ExperienceManifest {
  return {
    schemaVersion: "1.0",
    context,
    revision,
    me: { sections: [] }
  };
}

describe("keepManifestRevision", () => {
  it("keeps object identity when a background poll returns the same revision", () => {
    const current = manifest("BUSINESS", "r21");
    expect(keepManifestRevision(current, manifest("BUSINESS", "r21"))).toBe(current);
  });

  it("accepts a changed revision or context", () => {
    const current = manifest("BUSINESS", "r21");
    const revisionChanged = manifest("BUSINESS", "r22");
    const contextChanged = manifest("REQUESTER", "r21");

    expect(keepManifestRevision(current, revisionChanged)).toBe(revisionChanged);
    expect(keepManifestRevision(current, contextChanged)).toBe(contextChanged);
  });
});
