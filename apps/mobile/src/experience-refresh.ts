import type { ExperienceManifest } from "@proxy/contracts";

export function keepManifestRevision(
  current: ExperienceManifest | undefined,
  incoming: ExperienceManifest
): ExperienceManifest {
  return current?.context === incoming.context && current.revision === incoming.revision
    ? current
    : incoming;
}
