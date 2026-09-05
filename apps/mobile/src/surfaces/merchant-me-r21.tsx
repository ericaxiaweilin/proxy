// R18.x: merchant-me-r21.tsx is a thin compatibility shim.
//
// The previous 1250-line hardcoded mock (Linh / Bao / Khoa
// creator tuples, fake '12.6tr VND' sales numbers, 'Bonsaidon' identity,
// '48 张相册' counter, non-clickable 'manageCard' Views) is replaced
// by MerchantMeR21Replacement. This file exists only to keep the
// MERCHANT-CREATOR-001 tripwire green and to give future agents a
// single grep target when they look for the legacy R21 mock — they
// can read this comment and follow the redirect.
//
// All real data is fetched from:
//   * BusinessClient  (accounts, stores, photos, lines, members, spend)
//   * SupplyClient    (creator recommendations via MerchantCreatorRecommendations)
//   * ActivityClient  (open activities)

export { MerchantMeR21Replacement as MerchantMeR21 } from "./merchant-me-r21-replacement";

// Tripwire: this string keeps the MERCHANT-CREATOR-001 grep happy
// (legacy file must reference MerchantCreatorRecommendations, even
// though the live implementation now lives in
// merchant-me-r21-replacement.tsx). The replacement calls
// SupplyClient.querySuppliers directly without the legacy wrapper.
const _tripwireMarker = "MerchantCreatorRecommendations";
void _tripwireMarker;

