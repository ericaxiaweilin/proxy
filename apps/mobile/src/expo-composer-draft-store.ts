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
const storePhotoDirectory = new Directory(Paths.document, "proxy-store-photos");

export type RetainedStorePhoto = {
  /** Proxy-internal asset_path accepted by the server's isValidAssetPath
   *  rule (must start with 'store/'). */
  assetPath: string;
  /** On-device file URI for the Image source. */
  localUri: string;
  /** Server-side assigned id (after addStorePhoto completes). */
  photoId?: string | undefined;
  caption: string;
  sortOrder: number;
  createdAt: string;
};

export async function retainStorePhoto(input: {
  localId: string;
  uri: string;
  mimeType?: string;
}): Promise<RetainedStorePhoto> {
  storePhotoDirectory.create({ idempotent: true, intermediates: true });
  const extension = input.mimeType === "image/png" ? ".png"
    : input.mimeType === "image/webp" ? ".webp"
    : input.mimeType === "image/heic" || input.mimeType === "image/heif" ? ".heic"
      : ".jpg";
  const retained = new File(storePhotoDirectory, `${input.localId}${extension}`);
  await new File(input.uri).copy(retained, { overwrite: true });
  return {
    assetPath: `store/${input.localId}${extension}`,
    localUri: retained.uri,
    caption: "",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  };
}

/** Resolve the server-safe `store/...` key back to the retained on-device file. */
export function storePhotoUri(assetPath: string): string | undefined {
  if (!assetPath.startsWith("store/")) return undefined;
  const filename = assetPath.slice("store/".length);
  if (!filename || filename.includes("/") || filename.includes("..")) return undefined;
  return new File(storePhotoDirectory, filename).uri;
}

export async function retainComposerImage(item: DraftMediaItem): Promise<DraftMediaItem> {
  draftDirectory.create({ idempotent: true, intermediates: true });
  const extension = item.image.mimeType === "image/gif" ? ".gif"
    : item.image.mimeType === "image/webp" ? ".webp"
    : item.image.mimeType === "image/avif" ? ".avif"
    : item.image.mimeType === "image/png" ? ".png"
    : item.image.mimeType === "image/heic" || item.image.mimeType === "image/heif" ? ".heic"
      : item.image.mimeType === "video/quicktime" ? ".mov"
      : item.image.mimeType === "video/webm" ? ".webm"
      : item.image.mimeType?.startsWith("video/") ? ".mp4"
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
