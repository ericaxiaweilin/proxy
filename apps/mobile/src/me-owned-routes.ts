const ME_OWNED_ROUTES = {
  "我的订单": "myorders",
  "我的活动": "myactivities",
  "收藏": "favorites",
  "能力与可用时间": "available"
} as const;

export function meOwnedRouteForLabel(label: string): string | undefined {
  return ME_OWNED_ROUTES[label as keyof typeof ME_OWNED_ROUTES];
}
