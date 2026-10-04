// MERCHANT-HOME-OWN-ACTIVITIES-001（2026-10-04，用户：「home 看的是自己的活动，而不是别人的活动」——
// 咖啡店商家首页「高价值场景」里出现了岚庭餐厅的「新菜尝鲜晚餐」）。
//
// 以前取的是全平台活动列表的前两条。现在只认本店的：活动挂的现实场景 = 本账号某家门店认领的场景
// （STORE-SCENE-LINK-001），或活动场地名 = 门店名。已取消的不算。有封面的排前面（首页是门面），
// 其余新的在前（服务端按创建时间正序给）。
type ActivityLike = {
  activityId: string;
  venueName: string;
  realitySceneId?: string | undefined;
  coverMediaAssetId?: string | undefined;
  coverImageUrl?: string | undefined;
  status?: string | undefined;
};

export function ownMerchantActivities<A extends ActivityLike>(
  activities: readonly A[],
  stores: ReadonlyArray<{ name: string; realitySceneId?: string | undefined }>,
): A[] {
  const sceneIds = new Set(stores.map((s) => (s.realitySceneId ?? "").trim()).filter(Boolean));
  const names = new Set(stores.map((s) => s.name.trim()).filter(Boolean));
  const own = activities.filter((a) =>
    a.status !== "CANCELLED" && ((a.realitySceneId && sceneIds.has(a.realitySceneId)) || names.has(a.venueName.trim())));
  const newestFirst = [...own].reverse();
  const hasCover = (a: A): boolean => Boolean(a.coverMediaAssetId || a.coverImageUrl);
  return [...newestFirst.filter(hasCover), ...newestFirst.filter((a) => !hasCover(a))];
}

// 商家端「本店活动」唯一的取数入口：首页「高价值场景 / 正在进行」、我的「活动导流 / 场景运营」都走这里，
// 不各自再拼一条管线（以前首页读全平台前两条、活动导流读「我本人发过的」、场景运营写死 threebeans，
// 三处对不上）。stores = 当前商家账号的门店（MERCHANT-ACTIVE-ACCOUNT-001）。
export async function loadOwnMerchantActivities<A extends ActivityLike>(
  activities: { listActivities: () => Promise<A[]> },
  stores: ReadonlyArray<{ name: string; realitySceneId?: string | undefined }>,
): Promise<A[]> {
  if (stores.length === 0) return [];
  return ownMerchantActivities(await activities.listActivities(), stores);
}

// 当前账号门店认领的现实场景（场景运营页读它，不再写死某一家）。没认领 = undefined。
export function primaryStoreScene(stores: ReadonlyArray<{ name: string; realitySceneId?: string | undefined }>): { sceneId: string; storeName: string } | undefined {
  const linked = stores.find((s) => (s.realitySceneId ?? "").trim());
  return linked ? { sceneId: (linked.realitySceneId ?? "").trim(), storeName: linked.name } : undefined;
}
