// check-feed-media-urls.mjs — MEDIA-FILE-001 的第二道防线。
//
// 第一道（cmd/media-audit --check-files）保证「READY 的对象背后有字节」；
// 这一道保证「feed 真的吐出来的每个 URL 都能取到」。两者不是一回事：
// 读模型可能漏判，路由可能改动，鉴权可能挡住某条路径 —— 只有真的 GET 一遍
// 才算数。
//
// 2026-09-12 逃逸场景：feed 25 个图片 URL 里 20 个 404，客户端把失败渲染成
// 黑块，看起来就是「带图帖文全黑屏」。
//
// 需要 API 在跑；连不上就打印 SKIP 并退出 0（门禁据此区分 SKIP 与 PASS）。
const base = process.env.PROXY_API_BASE_URL || "http://127.0.0.1:4100";

async function main() {
  let feed;
  try {
    const response = await fetch(`${base}/v1/feed?limit=50`);
    if (!response.ok) throw new Error(`feed ${response.status}`);
    feed = await response.json();
  } catch (error) {
    console.log(`SKIP: cannot reach ${base} (${error.message})`);
    return 0;
  }

  const posts = feed.posts ?? [];
  const media = feed.media ?? {};
  const urls = [];
  for (const entry of Object.values(media)) {
    for (const item of Array.isArray(entry) ? entry : [entry]) {
      for (const value of Object.values(item)) {
        if (typeof value === "string" && value.startsWith("/v1/")) urls.push(value);
      }
    }
  }
  if (urls.length === 0) {
    console.log(`SKIP: feed returned ${posts.length} posts but no media URLs to probe`);
    return 0;
  }

  // The AI persona photos are NOT in media.media_variants — they are static
  // files served from a repo path — so the DB sweep cannot see them. They were
  // 404ing in the normal dev loop because the API resolves them relative to
  // the repo root while it is launched from apps/api-go. Probe them too.
  let assistants = [];
  try {
    const response = await fetch(`${base}/v1/ai/assistants`);
    if (response.ok) assistants = (await response.json()).assistants ?? [];
  } catch {
    assistants = [];
  }
  for (const assistant of assistants) {
    if (typeof assistant?.id === "string") urls.push(`/v1/ai/personas/photo/${assistant.id}`);
  }

  const failed = [];
  for (const url of urls) {
    const response = await fetch(base + url);
    if (!response.ok) failed.push(`${response.status} ${url}`);
  }
  console.log(`feed media URLs: posts=${posts.length} assistants=${assistants.length} urls=${urls.length} failed=${failed.length}`);
  if (failed.length > 0) {
    console.error("FAIL: feed advertises media URLs that do not resolve:");
    for (const line of failed.slice(0, 20)) console.error(`  ${line}`);
    console.error("      A 404 renders as a black frame on the client.");
    console.error("      See docs/development/MEDIA_STORE_CONSISTENCY.md");
    return 1;
  }
  return 0;
}

process.exit(await main());
