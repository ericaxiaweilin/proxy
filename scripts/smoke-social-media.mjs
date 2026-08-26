import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = process.env.PROXY_API_BASE_URL || "http://127.0.0.1:4100";
let sequence = 0;
const id = (prefix) => `smoke_${prefix}_${Date.now().toString(36)}_${++sequence}`;

async function command(type, target, payload, auth) {
  const envelope = {
    commandId: id("command"), commandType: type, commandVersion: 1,
    actor: auth ? { type: "USER", id: auth.userAccountId } : { type: "USER", id: "social_media_smoke" },
    principal: auth?.principal || { type: "INDIVIDUAL", id: "social_media_smoke" },
    target, idempotencyKey: id("idem"), authContext: auth ? { sessionId: auth.sessionId } : {},
    purpose: "social_media_e2e_smoke", correlationId: id("correlation"),
    requestedAt: new Date().toISOString(), payload
  };
  const response = await fetch(`${base}/v1/commands/${type}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.accessToken}` } : {}) },
    body: JSON.stringify(envelope)
  });
  const result = await response.json();
  if (!response.ok || result.outcome === "REJECTED") throw new Error(`${type} ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

const anonymous = await command("CreateAnonymousSession", { type: "Session", id: "new" }, { deviceId: id("device"), platform: "IOS" });
const auth = anonymous.auth;
if (!auth?.accessToken) throw new Error("anonymous auth token missing");
const image = await readFile("apps/api-go/media_store/mobile_media_image_mt7b7xwf_1.jpg");
const storageKey = `${id("image")}.jpg`;
const created = await command("CreateMediaAsset", { type: "MediaAsset", id: "new" }, { mediaType: "IMAGE", originalStorageKey: storageKey, mimeType: "image/jpeg", width: 1170, height: 1560 }, auth);
const mediaOperation = JSON.parse(created.operationRef);
const mediaAssetId = mediaOperation.mediaAssetId;
const upload = await fetch(`${base}${mediaOperation.uploadUrl}`, {
  method: "PUT",
  headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "image/jpeg", "Content-Range": `bytes 0-${image.length - 1}/${image.length}`, "X-Chunk-SHA256": createHash("sha256").update(image).digest("hex") },
  body: image
});
if (!upload.ok) throw new Error(`upload ${upload.status}: ${await upload.text()}`);
await command("CompleteMediaUpload", { type: "MediaAsset", id: mediaAssetId }, { originalStorageKey: storageKey }, auth);
await command("ProcessMediaAsset", { type: "MediaAsset", id: mediaAssetId }, { originalPath: "" }, auth);
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const result = await command("GetMediaAsset", { type: "MediaAsset", id: mediaAssetId }, { mediaAssetId }, auth);
  const operation = JSON.parse(result.operationRef);
  if (operation.asset?.processingStatus === "READY") { ready = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("media did not become READY");
const post = await command("CreatePost", { type: "Post", id: "new" }, { authorType: "USER", authorDisplayName: "你", body: "图文发布端到端验证", mediaRefs: [{ mediaAssetId, sortOrder: 0 }], visibility: "PUBLIC", cityScope: "hn" }, auth);
const postId = post.aggregate?.id;
const feed = await command("ListFeedPosts", { type: "Feed", id: "local" }, {}, auth);
const read = JSON.parse(feed.operationRef);
const restoredPost = read.posts.find((item) => item.postId === postId);
const restoredMedia = read.media[postId];
if (!restoredPost || !Array.isArray(restoredMedia) || restoredMedia.length !== 1) throw new Error(`feed hydration failed for ${postId}`);
const mediaResponse = await fetch(`${base}${restoredMedia[0].feedUrl}`);
if (!mediaResponse.ok || (await mediaResponse.arrayBuffer()).byteLength === 0) throw new Error("feed image file is unavailable");
const expectedLegacyMedia = {
  post_593e70b87d5f34f750113d74: 1,
  post_cf7bb8f092769e4f0a176fe4: 4,
  post_f9b3e97261db7e31a279f24f: 1,
};
for (const [legacyPostId, expectedCount] of Object.entries(expectedLegacyMedia)) {
  const legacyPost = read.posts.find((item) => item.postId === legacyPostId);
  const legacyMedia = read.media[legacyPostId];
  if (!legacyPost || !Array.isArray(legacyMedia) || legacyMedia.length !== expectedCount) {
    throw new Error(`legacy feed hydration failed for ${legacyPostId}: expected ${expectedCount}, got ${legacyMedia?.length ?? 0}`);
  }
  for (const item of legacyMedia) {
    const mediaUrl = item.feedUrl || item.playbackUrl || item.thumbnailUrl;
    if (!mediaUrl) throw new Error(`legacy feed image URL is missing for ${legacyPostId}/${item.mediaAssetId}`);
    const response = await fetch(`${base}${mediaUrl}`);
    if (!response.ok || (await response.arrayBuffer()).byteLength === 0) {
      throw new Error(`legacy feed image is unavailable for ${legacyPostId}/${item.mediaAssetId}`);
    }
  }
}
console.log(JSON.stringify({
  ok: true,
  postId,
  mediaAssetId,
  mediaCount: restoredMedia.length,
  processingStatus: restoredMedia[0].processingStatus,
  moderationStatus: restoredMedia[0].moderationStatus,
  restoredLegacyPosts: Object.keys(expectedLegacyMedia).length,
  restoredLegacyImages: Object.values(expectedLegacyMedia).reduce((sum, count) => sum + count, 0),
}));
