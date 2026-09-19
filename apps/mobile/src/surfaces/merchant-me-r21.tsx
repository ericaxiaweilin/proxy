// R18.x: merchant-me-r21.tsx is a thin compatibility shim.
//
// The previous 1250-line hardcoded mock (Linh / Bao / Khoa
// creator tuples, fake '12.6tr VND' sales numbers, 'Bonsaidon' identity,
// '48 张相册' counter, non-clickable 'manageCard' Views) is replaced
// by MerchantMeR21Replacement. This file exists only so the legacy import
// path keeps resolving, and to give future agents a single grep target when
// they look for the legacy R21 mock — they can read this comment and follow
// the redirect.
//
// All real data is fetched from:
//   * BusinessClient  (accounts, stores, photos, lines, members, spend)
//   * SupplyClient    (creator recommendations via MerchantCreatorRecommendations)
//   * ActivityClient  (open activities)
//
// 历史坑（别再犯）：这里曾经放一个
//   const _tripwireMarker = "MerchantCreatorRecommendations";
// 来喂 MERCHANT-CREATOR-001 的 grep —— 于是把真链路（replacement 的渲染 +
// merchant-creator-recommendations.tsx 的 supply.querySuppliers）整段删掉，
// 那条钉照样绿。钉已改为钉真链路，这里不再需要任何"让 grep 满意"的字符串。
// 注释里出现组件名只是文档，不是接线。

export { MerchantMeR21Replacement as MerchantMeR21 } from "./merchant-me-r21-replacement";
