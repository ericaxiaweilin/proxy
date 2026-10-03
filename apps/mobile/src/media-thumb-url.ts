// ACTIVITY-COVER-001（2026-10-01，用户「做活动 商家活动吧 活动图片资产」）
//
// 媒体资产的展示 URL 只有**一个**拼法：`{base}/v1/media/thumb/{mediaAssetId}`。
// 这个拼法在本仓已经出现过三份（scene-shop-directory 的场景照片墙、
// merchant-storefront 的门店相册、以及活动封面要加的这一份），每份各写各的
// 后果是：媒体路由改一次要改三个地方，而漏掉的那个只会表现为"某个面图不出来了"。
//
// 收成一处。两边都只是委托，行为不变。

/** 空 id / 空 baseUrl 都返回 undefined —— 调用方据此走"没有图"的如实占位。 */
export function mediaThumbUrl(mediaAssetId: string | undefined, baseUrl: string | undefined): string | undefined {
  const id = (mediaAssetId ?? "").trim();
  if (!id) return undefined;
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  if (!base) return undefined;
  return `${base}/v1/media/thumb/${encodeURIComponent(id)}`;
}

/**
 * 活动封面图。
 *
 * 顺序是刻意的：先看**媒体资产 id**（ACTIVITY-COVER-001 新加的、真正有生产者的
 * 那个），再看 R17.x 遗留的 coverImageUrl（那个字段至今没有任何写入者，留着只为
 * 不破坏既有 wire 形状）。两者都空 = 商家没传图，调用方必须显示占位，
 * 不许拿场景图冒充"这张活动的封面"。
 */
export function activityCoverUri(
  activity: { coverMediaAssetId?: string | undefined; coverImageUrl?: string | undefined },
  baseUrl: string | undefined
): string | undefined {
  return mediaThumbUrl(activity.coverMediaAssetId, baseUrl) ?? (activity.coverImageUrl?.trim() || undefined);
}
