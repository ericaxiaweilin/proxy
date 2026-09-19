package mockidentity

import "testing"

// CREATOR-HANA-NAM-001: Hana / Nam 从 stock 占位转正为真人账户 ——
// facet 键、账号 id、写真资产 id 三件必须齐且互不相同，否则关注/会话落到
// 幽灵 id（头像 404、动态扫不到帖子，见 recommend-fixtures 的注释）。
func TestHanaNamKeysResolveDistinctIdentity(t *testing.T) {
	seenAccounts, seenAssets := map[string]string{}, map[string]string{}
	for _, key := range CreatorFacetKeys {
		account := AccountIDForFacetKey(key)
		asset := AvatarAssetIDForFacetKey(key)
		if account == "" || asset == "" {
			t.Fatalf("facet key %q resolves to empty identity", key)
		}
		if owner, dup := seenAccounts[account]; dup {
			t.Fatalf("account %q shared by %s and %s", account, owner, key)
		}
		if owner, dup := seenAssets[asset]; dup {
			t.Fatalf("portrait asset %q shared by %s and %s: one face, one account", asset, owner, key)
		}
		seenAccounts[account], seenAssets[asset] = key, key
	}
	for _, key := range []string{"hana", "nam"} {
		found := false
		for _, k := range CreatorFacetKeys {
			if k == key {
				found = true
			}
		}
		if !found {
			t.Fatalf("facet key %q missing: home shows stock instead of the real face", key)
		}
		if got := AvatarPathForFacetKey(key); got != "/v1/media/thumb/ma_creator_"+key+"_portrait_v1" {
			t.Fatalf("unexpected avatar path for %q: %q", key, got)
		}
	}
}
