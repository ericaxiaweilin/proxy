import { Directory, File, Paths } from "expo-file-system";
import type { DraftMediaItem } from "./composer-media";

export type ComposerDraftSnapshot = {
  version: 1;
  body: string;
  media: DraftMediaItem[];
  visibility: "PUBLIC" | "FOLLOWERS";
  includeCity: boolean;
  quoteTargetId: string | null;
  publishIdempotencyKey?: string | undefined;
  updatedAt: string;
};

const draftDirectory = new Directory(Paths.document, "proxy-composer-draft");
const snapshotFile = new File(draftDirectory, "draft-v1.json");

export async function retainComposerImage(item: DraftMediaItem): Promise<DraftMediaItem> {
  draftDirectory.create({ idempotent: true, intermediates: true });
  const extension = item.image.mimeType === "image/png" ? ".png"
    : item.image.mimeType === "image/heic" || item.image.mimeType === "image/heif" ? ".heic"
      : ".jpg";
  const retained = new File(draftDirectory, `${item.localId}${extension}`);
  await new File(item.image.uri).copy(retained, { overwrite: true });
  return { ...item, image: { ...item.image, uri: retained.uri } };
}

export async function readComposerDraft(): Promise<ComposerDraftSnapshot | undefined> {
  if (!snapshotFile.exists) return undefined;
  try {
    const value = await snapshotFile.json() as unknown;
    if (!value || typeof value !== "object") return undefined;
    const snapshot = value as Partial<ComposerDraftSnapshot>;
    if (snapshot.version !== 1 || typeof snapshot.body !== "string" || !Array.isArray(snapshot.media)) return undefined;
    if (snapshot.visibility !== "PUBLIC" && snapshot.visibility !== "FOLLOWERS") return undefined;
    return snapshot as ComposerDraftSnapshot;
  } catch {
    return undefined;
  }
}

export function writeComposerDraft(snapshot: ComposerDraftSnapshot): void {
  draftDirectory.create({ idempotent: true, intermediates: true });
  snapshotFile.write(JSON.stringify(snapshot));
}

export function clearComposerDraft(): void {
  if (draftDirectory.exists) draftDirectory.delete();
}
