package mockidentity

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// HOME-RAIL-ACCOUNT-001：首页「真人推荐」rail 上出现的每一个人都必须有服务端账号。
//
// rail 的数据源是客户端 fixture（apps/mobile/src/recommend-fixtures.ts 的
// SCENE_RECOMMEND），服务端的账号目录是本包的 HomeRailPeople。两份表在两个语言、
// 两个仓库目录里，谁都可以单方面加一个人 —— 加完编译过、门禁绿，运行起来那个人
// 点 + 只会得到「还没有账号，暂时加不了好友」，卡片上却写着「真人」。
//
// 所以这条测试直接读客户端 fixture 逐条比对：fixture 里有的，HomeRailPeople 必须
// 有；HomeRailPeople 里有的，fixture 里也必须还有（删人不删账号同样是漂移）。
func TestHomeRailFixturePeopleAllHaveServerAccounts(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "mobile", "src", "recommend-fixtures.ts")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read client fixture %s: %v", fixturePath, err)
	}

	// 只认人物定义里的 `id: "u_<key>"`。筛选 chip（id: "online"）等不是 u_ 前缀，
	// 不会被误收。
	idPattern := regexp.MustCompile(`id: "(u_[a-z_]+)"`)
	fixtureKeys := map[string]bool{}
	for _, m := range idPattern.FindAllStringSubmatch(string(raw), -1) {
		fixtureKeys[m[1][len("u_"):]] = true
	}
	if len(fixtureKeys) == 0 {
		t.Fatal("no u_ fixture ids parsed from recommend-fixtures.ts: the parser is broken, not the fixture")
	}

	seeded := map[string]bool{}
	for _, p := range HomeRailPeople {
		seeded[p.Key] = true
	}

	var missing, stale []string
	for key := range fixtureKeys {
		if !seeded[key] {
			missing = append(missing, key)
		}
	}
	for key := range seeded {
		if !fixtureKeys[key] {
			stale = append(stale, key)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)

	if len(missing) > 0 {
		t.Errorf("rail 上有 %d 个人在服务端没有账号（点 + 只会得到「还没有账号」）: %v\n"+
			"在 mockidentity.HomeRailPeople 里补上他们（名字/简介取卡片上那一句）。", len(missing), missing)
	}
	if len(stale) > 0 {
		t.Errorf("HomeRailPeople 里有 %d 个键已经不在 rail 上了（幽灵账号）: %v\n"+
			"从 rail 上删掉的人，也要从这份表里删掉。", len(stale), stale)
	}
}

// 每个人解析出来的账号 id / 写真资产 id / 存储文件名必须与 facet 键一致，
// 且互不相同 —— 同一个人任何页面同一张脸，不同的人不共用账号。
func TestHomeRailIdentitiesAreDistinct(t *testing.T) {
	seenAccount := map[string]string{}
	seenAsset := map[string]string{}
	for _, key := range HomeRailFacetKeys() {
		account := AccountIDForFacetKey(key)
		asset := AvatarAssetIDForFacetKey(key)
		storage := PortraitStorageKeyForFacetKey(key)
		if account == "" || asset == "" || storage == "" {
			t.Fatalf("facet key %q resolves to empty identity", key)
		}
		if owner, dup := seenAccount[account]; dup {
			t.Fatalf("account %q shared by %s and %s", account, owner, key)
		}
		if owner, dup := seenAsset[asset]; dup {
			t.Fatalf("portrait asset %q shared by %s and %s: one face, one account", asset, owner, key)
		}
		seenAccount[account], seenAsset[asset] = key, key
	}
}

// 作者头像那第三条镜像（apps/mobile/src/media/author-avatar.ts 的
// MOCK_CREATOR_FACET_KEYS）也必须与 AllFacetKeys() 一致。
//
// 这个集合漏一个人的症状不是报错，而是 AVATAR-OTHER-HUMAN-002 那个老毛病：
// 同一个人在首页有脸、在动态里是黑底首字。三份表分散在两个语言里，谁都能
// 单方面加人，所以在这里钉死。
func TestAuthorAvatarMirrorMatchesAllFacetKeys(t *testing.T) {
	avatarPath := filepath.Join("..", "..", "..", "mobile", "src", "media", "author-avatar.ts")
	raw, err := os.ReadFile(avatarPath)
	if err != nil {
		t.Fatalf("read client avatar mirror %s: %v", avatarPath, err)
	}
	text := string(raw)

	start := strings.Index(text, "MOCK_CREATOR_FACET_KEYS = new Set([")
	if start < 0 {
		t.Fatal("MOCK_CREATOR_FACET_KEYS set not found in author-avatar.ts: the parser is broken, not the file")
	}
	rest := text[start:]
	end := strings.Index(rest, "])")
	if end < 0 {
		t.Fatal("MOCK_CREATOR_FACET_KEYS set is not terminated with ]): the parser is broken")
	}

	mirror := map[string]bool{}
	for _, m := range regexp.MustCompile(`"([a-z_]+)"`).FindAllStringSubmatch(rest[:end], -1) {
		mirror[m[1]] = true
	}
	if len(mirror) == 0 {
		t.Fatal("no facet keys parsed from MOCK_CREATOR_FACET_KEYS: the parser is broken, not the file")
	}

	var missing, stale []string
	for _, key := range AllFacetKeys() {
		if !mirror[key] {
			missing = append(missing, key)
		}
	}
	for key := range mirror {
		found := false
		for _, k := range AllFacetKeys() {
			if k == key {
				found = true
				break
			}
		}
		if !found {
			stale = append(stale, key)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)

	if len(missing) > 0 {
		t.Errorf("author-avatar.ts 的 MOCK_CREATOR_FACET_KEYS 少 %d 个键: %v\n"+
			"漏掉的人在动态里会是黑底首字（首页却有脸）。", len(missing), missing)
	}
	if len(stale) > 0 {
		t.Errorf("author-avatar.ts 的 MOCK_CREATOR_FACET_KEYS 多了 %d 个键: %v\n"+
			"这些键在 mockidentity 里已经不存在了。", len(stale), stale)
	}
}
