package realityscene

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

func envelope(commandType string, payload map[string]any) command.Envelope {
	return command.Envelope{CommandID: "c1", CommandType: commandType, Actor: command.Actor{Type: "USER", ID: "u1"}, Principal: command.Principal{Type: "INDIVIDUAL", ID: "p1"}, Target: command.Target{Type: "RealityScene", ID: "westlake"}, Payload: payload}
}

func TestR27DynamicSceneSwitchesWholeContext(t *testing.T) {
	s := New()
	morning, found, err := s.GetDetail(t.Context(), "threebeans", "morning", time.Date(2026, 9, 6, 8, 0, 0, 0, time.UTC))
	if err != nil || !found {
		t.Fatalf("morning detail found=%v err=%v", found, err)
	}
	sunlight, found, err := s.GetDetail(t.Context(), "threebeans", "sunlight", time.Date(2026, 9, 6, 15, 0, 0, 0, time.UTC))
	if err != nil || !found {
		t.Fatalf("sunlight detail found=%v err=%v", found, err)
	}
	if len(morning.Variants) != 4 || morning.SelectedVariant == sunlight.SelectedVariant {
		t.Fatalf("variant switch failed: morning=%#v sunlight=%#v", morning, sunlight)
	}
	if morning.Humans[0].Role == sunlight.Humans[0].Role || morning.Menu[0].ID == "" || sunlight.LiveState.State != "AVAILABLE_NOW" {
		t.Fatalf("scene context did not switch together: morning=%#v sunlight=%#v", morning, sunlight)
	}
	for _, human := range sunlight.Humans {
		if human.IsAI {
			t.Fatalf("AI account leaked into human recommendation: %#v", human)
		}
	}
	if sunlight.Actions[0].State != "REQUIRES_HUMAN_ACCEPTANCE" || sunlight.Actions[1].MoneyMeaning == sunlight.Actions[2].MoneyMeaning {
		t.Fatalf("action boundaries unclear: %#v", sunlight.Actions)
	}
}

func TestUserSceneStateRoundTrip(t *testing.T) {
	s := New()
	written := s.HandleContext(t.Context(), envelope("SetRealitySceneSaved", map[string]any{"sceneId": "westlake", "enabled": true}))
	if written.Outcome != "ACCEPTED" {
		t.Fatalf("write=%#v", written)
	}
	listed := s.HandleContext(t.Context(), envelope("ListMyRealitySceneState", map[string]any{}))
	var payload struct {
		States []UserState `json:"states"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.States) != 1 || !payload.States[0].Saved || payload.States[0].SceneID != "westlake" {
		t.Fatalf("states=%#v", payload.States)
	}
}

func TestPublicFootprintCannotBeWrittenByClient(t *testing.T) {
	s := New()
	result := s.HandleContext(t.Context(), envelope("SetPublicRealitySceneFootprint", map[string]any{"sceneId": "westlake", "enabled": true}))
	if result.Outcome != "REJECTED" {
		t.Fatalf("public footprint write must be rejected: %#v", result)
	}
}

func TestScenePipelineRanksNearbyAndRecordsVisitTime(t *testing.T) {
	s := New()
	nearby, err := s.ListNearbyScenes(t.Context(), 21.0454, 105.8361, 5, 8)
	if err != nil || len(nearby) == 0 {
		t.Fatalf("nearby=%#v err=%v", nearby, err)
	}
	if nearby[0].DistanceMeters < 0 || nearby[0].RecommendationScore == 0 {
		t.Fatalf("ranking metadata missing: %#v", nearby[0])
	}
	result := s.HandleContext(t.Context(), envelope("SetPrivateRealitySceneVisited", map[string]any{"sceneId": "trucbach", "enabled": true}))
	if result.Outcome != "ACCEPTED" {
		t.Fatalf("visit failed: %#v", result)
	}
	listed := s.HandleContext(t.Context(), envelope("ListMyRealitySceneState", map[string]any{}))
	var payload struct {
		States []UserState `json:"states"`
	}
	if err := json.Unmarshal([]byte(listed.OperationRef), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.States) != 1 || payload.States[0].VisitedAt == nil {
		t.Fatalf("visit timeline missing: %#v", payload.States)
	}
}

// SCENE-ADDRESS-001: 场景目录必须有门牌地址，且 Bắc Ninh 必须有场景。
//
// 两件事一起钉：
//  1. address 是**独立字段**，不是 area 的别名。以前只有 area（"Cầu Giấy" 这种
//     区名），地图 marker 拼的是 `区 · 类型`，用户问"这家店在哪条街"答不上来。
//     区名不是地址，拿它冒充就是假数据。
//  2. 目录里原本**只有河内**。Bắc Ninh 的用户打开场景地图（nearby）一个场景
//     都搜不到 —— 现在补上 threebeans_bn。
func TestSceneCatalogCarriesStreetAddressDistinctFromArea(t *testing.T) {
	s := New()
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	if len(scenes) == 0 {
		t.Fatal("scene catalog is empty")
	}
	byID := map[string]Scene{}
	for _, sc := range scenes {
		byID[sc.ID] = sc
	}
	for _, id := range []string{"threebeans", "threebeans_bn"} {
		sc, ok := byID[id]
		if !ok {
			t.Fatalf("scene %q missing from catalog", id)
		}
		if sc.Address == "" {
			t.Fatalf("scene %q has no street address — the map can only show a district name", id)
		}
		// 地址不许就是区名：那等于没加这个字段。
		if sc.Address == sc.Area {
			t.Fatalf("scene %q address %q is just the area name — that is not an address", id, sc.Address)
		}
	}
}

func TestSceneCatalogIncludesBacNinhVenue(t *testing.T) {
	s := New()
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	var bn *Scene
	for i := range scenes {
		if scenes[i].ID == "threebeans_bn" {
			bn = &scenes[i]
			break
		}
	}
	if bn == nil {
		t.Fatal("no Bắc Ninh scene: a Bắc Ninh user opening the scene map sees an empty catalog")
	}
	if bn.Area != "Bắc Ninh" {
		t.Fatalf("expected area=Bắc Ninh, got %q", bn.Area)
	}
	// 坐标必须真的在 Bắc Ninh（约 21.19N 106.08E），不是河内（约 21.03N 105.85E）。
	// 差了 ~30 km：放在河内会让"Bắc Ninh 的场景"在地图上显示在河内。
	if bn.Latitude < 21.1 || bn.Latitude > 21.3 || bn.Longitude < 106.0 || bn.Longitude > 106.2 {
		t.Fatalf("Bắc Ninh scene is not in Bắc Ninh: lat=%v lng=%v", bn.Latitude, bn.Longitude)
	}
	if bn.Address == "" {
		t.Fatal("Bắc Ninh scene has no street address")
	}
}

// 地址必须真的出在接口 JSON 里 —— 光有 Go 字段没用，客户端读的是 JSON。
func TestSceneAddressIsSerialized(t *testing.T) {
	s := New()
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	body, err := json.Marshal(map[string]any{"scenes": scenes})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Scenes []map[string]any `json:"scenes"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	found := false
	for _, sc := range decoded.Scenes {
		if sc["id"] == "threebeans_bn" {
			found = true
			address, _ := sc["address"].(string)
			if address == "" {
				t.Fatal("address missing from serialized scene JSON — the client can never render it")
			}
		}
	}
	if !found {
		t.Fatal("threebeans_bn missing from serialized scenes")
	}
}

// SCENE-SEED-DRIFT-001: 场景目录有**两个**真相来源，而且会静默漂移。
//
//	· launchScenes()（internal/realityscene/service.go）—— 没配 DATABASE_URL 时
//	  内存仓库走这个；
//	· migrations/*.sql 里 reality.scenes 的 seed —— 配了数据库走这个。
//
// 同一个产品、两套数据：一边加了店、另一边没加，本地和线上看到的就是两个不同的
// 场景目录，而且**没有任何东西会报错**。这正是"死数据"的来源 —— 数据不是被
// 改坏的，是被忘记同步的。所以这里钉住：
//  1. 两边的**在售 id 集合**必须一致（迁移里 status='HIDDEN' 的不算在售）；
//  2. 两边都有的场景，**坐标和地址必须一字不差**（核心数据不许漂移）。
func TestSceneSeedMatchesMigrationSeed(t *testing.T) {
	files, err := filepath.Glob("../../migrations/*.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	sort.Strings(files) // 后写的迁移覆盖先写的（"最后写入者为准"）
	seeded, hidden := loadSceneSeedFromMigrations(t, files)
	if len(seeded) == 0 {
		t.Fatal("no reality.scenes seed found in migrations — the drift check itself is blind")
	}
	if len(hidden) == 0 {
		// 隐藏集合是空的，说明解析没生效 —— 这个检查会静默变成"全量比对"，
		// 一旦真有人隐藏了场景就会假红。宁可现在就红。
		t.Fatal("no status='HIDDEN' statement parsed from migrations — the hidden-row filter is blind")
	}
	active := map[string]struct{}{}
	for id := range seeded {
		if !hidden[id] {
			active[id] = struct{}{}
		}
	}
	goScenes := map[string]Scene{}
	for _, sc := range launchScenes() {
		goScenes[sc.ID] = sc
	}
	var onlyInSQL, onlyInGo []string
	for id := range active {
		if _, ok := goScenes[id]; !ok {
			onlyInSQL = append(onlyInSQL, id)
		}
	}
	for id := range goScenes {
		if _, ok := active[id]; !ok {
			onlyInGo = append(onlyInGo, id)
		}
	}
	sort.Strings(onlyInSQL)
	sort.Strings(onlyInGo)
	if len(onlyInSQL) > 0 || len(onlyInGo) > 0 {
		t.Fatalf("scene seed drifted: only in migrations=%v only in launchScenes=%v", onlyInSQL, onlyInGo)
	}
	// 核心字段：坐标与地址。这两个错了，地图就把场景画在别的地方。
	//
	// 坐标按**数值**比，不按字符串比：SQL 里写 21.0360490、Go 里写 21.036049
	// 是同一个数，字符串比会假红。
	for id, sc := range goScenes {
		row := seeded[id]
		if got := row["address"]; got != sc.Address {
			t.Fatalf("scene %q address drifted: migrations=%q launchScenes=%q", id, got, sc.Address)
		}
		for _, c := range []struct {
			field string
			want  float64
		}{{"latitude", sc.Latitude}, {"longitude", sc.Longitude}} {
			got, err := strconv.ParseFloat(row[c.field], 64)
			if err != nil {
				t.Fatalf("scene %q %s is not a number in migrations: %q", id, c.field, row[c.field])
			}
			if got != c.want {
				t.Fatalf("scene %q %s drifted: migrations=%v launchScenes=%v", id, c.field, got, c.want)
			}
		}
	}
}

// loadSceneSeedFromMigrations 解析迁移文件里 reality.scenes 的最终状态。
// 只读 INSERT 的元组和 UPDATE ... WHERE id='x' 的赋值，按文件顺序"最后写入者为准"。
func loadSceneSeedFromMigrations(t *testing.T, files []string) (seeded map[string]map[string]string, hidden map[string]bool) {
	t.Helper()
	insertRe := regexp.MustCompile(`(?s)INSERT INTO reality\.scenes\s*\(([^)]*)\)\s*VALUES(.*?)(?:ON CONFLICT|;)`)
	// 所有 `.*?` 都必须用 `[^;]*?`：一条 UPDATE 不会跨分号，否则
	// `WHERE id IN (...)` 的隐藏语句会一路吃到下一条 `WHERE id='x'`，
	// 把 status='HIDDEN' 记到错误的场景上。
	updateRe := regexp.MustCompile(`(?s)UPDATE reality\.scenes SET([^;]*?)WHERE id='([^']+)'`)
	hiddenRe := regexp.MustCompile(`(?s)UPDATE reality\.scenes SET[^;]*?status='HIDDEN'[^;]*?WHERE id IN \(([^)]*)\)`)
	hiddenOneRe := regexp.MustCompile(`(?s)UPDATE reality\.scenes SET[^;]*?status='HIDDEN'[^;]*?WHERE id='([^']+)'`)
	quotedRe := regexp.MustCompile(`'([^']*)'`)
	assignRe := regexp.MustCompile(`(\w+)\s*=\s*('(?:[^']|'')*'|[^,]+)`)

	seeded, hidden = map[string]map[string]string{}, map[string]bool{}
	row := func(id string) map[string]string {
		if seeded[id] == nil {
			seeded[id] = map[string]string{}
		}
		return seeded[id]
	}
	for _, path := range files {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		text := string(body)
		for _, m := range insertRe.FindAllStringSubmatch(text, -1) {
			cols := []string{}
			for _, c := range strings.Split(m[1], ",") {
				cols = append(cols, strings.TrimSpace(c))
			}
			for _, tuple := range splitSQLTuples(m[2]) {
				if len(tuple) == 0 {
					continue
				}
				id := unquoteSQL(tuple[0])
				if id == "" {
					continue
				}
				target := row(id)
				for i, col := range cols {
					if i < len(tuple) {
						target[col] = unquoteSQL(tuple[i])
					}
				}
			}
		}
		for _, m := range updateRe.FindAllStringSubmatch(text, -1) {
			id := m[2]
			target := row(id)
			for _, a := range assignRe.FindAllStringSubmatch(m[1], -1) {
				target[a[1]] = unquoteSQL(strings.TrimSpace(a[2]))
			}
			// assignRe 会把 `status='HIDDEN', updated_at=now()` 里的 now() 也吃进来，
			// 这里不 care —— 下面单独判 hidden。
		}
		for _, m := range hiddenRe.FindAllStringSubmatch(text, -1) {
			for _, q := range quotedRe.FindAllStringSubmatch(m[1], -1) {
				hidden[q[1]] = true
			}
		}
		for _, m := range hiddenOneRe.FindAllStringSubmatch(text, -1) {
			hidden[m[1]] = true
		}
	}
	return seeded, hidden
}

// splitSQLTuples 按顶层括号切分 `(a,'b,c',1),(d,'e',2)` 这样的元组列表，
// 引号里的逗号和括号不算分隔。
func splitSQLTuples(body string) [][]string {
	out := [][]string{}
	var cur []string
	var field strings.Builder
	depth, inQuote, inTuple := 0, false, false
	for i := 0; i < len(body); i++ {
		c := body[i]
		if inQuote {
			if c == '\'' {
				if i+1 < len(body) && body[i+1] == '\'' {
					field.WriteByte('\'')
					i++
					continue
				}
				inQuote = false
				continue
			}
			field.WriteByte(c)
			continue
		}
		switch c {
		case '\'':
			inQuote = true
		case '(':
			depth++
			if depth == 1 {
				inTuple, cur = true, nil
				field.Reset()
				continue
			}
			field.WriteByte(c)
		case ')':
			depth--
			if depth == 0 {
				cur = append(cur, strings.TrimSpace(field.String()))
				out, inTuple = append(out, cur), false
				field.Reset()
				continue
			}
			field.WriteByte(c)
		case ',':
			if depth == 1 {
				cur = append(cur, strings.TrimSpace(field.String()))
				field.Reset()
				continue
			}
			field.WriteByte(c)
		default:
			if inTuple {
				field.WriteByte(c)
			}
		}
	}
	return out
}

func unquoteSQL(v string) string {
	if len(v) >= 2 && strings.HasPrefix(v, "'") && strings.HasSuffix(v, "'") {
		return strings.ReplaceAll(v[1:len(v)-1], "''", "'")
	}
	return v
}

// 核心数据必须准确：坐标要落在它声称的那个城市里。
// 河内约 21.03N 105.85E，Bắc Ninh 约 21.19N 106.08E —— 差 ~30 km。
// 标着"Bắc Ninh"却落在河内，地图上就会把 Bắc Ninh 的店画在河内。
func TestSceneCoordinatesMatchTheirArea(t *testing.T) {
	bounds := map[string][4]float64{
		"Ba Đình":   {21.02, 21.06, 105.82, 105.86},
		"Hoàn Kiếm": {21.01, 21.05, 105.83, 105.87},
		"Tây Hồ":    {21.04, 21.10, 105.79, 105.85},
		"Đống Đa":   {20.99, 21.03, 105.81, 105.85},
		"Long Biên": {21.02, 21.08, 105.86, 105.92},
		"Cầu Giấy":  {21.01, 21.06, 105.77, 105.82},
		"Bắc Ninh":  {21.10, 21.30, 106.00, 106.20},
		// SCENE-NO-FABRICATED-001 新增的两条真实公共景点：
		// Văn Miếu（文庙坊）在老城西南，Hồng Hà（红河坊）跨红河两岸。
		"Văn Miếu": {21.02, 21.04, 105.82, 105.85},
		"Hồng Hà":  {21.03, 21.06, 105.84, 105.88},
	}
	for _, sc := range launchScenes() {
		b, ok := bounds[sc.Area]
		if !ok {
			// 没建界的区不猜，跳过而不是放宽 —— 但至少钉住这是**已知的**漏网：
			// 新增场景如果带了一个没建界的 area，这里会静默跳过，等于没测。
			t.Fatalf("scene %q has area=%q with no coordinate bounds — add bounds for it instead of skipping the check", sc.ID, sc.Area)
		}
		if sc.Latitude < b[0] || sc.Latitude > b[1] || sc.Longitude < b[2] || sc.Longitude > b[3] {
			t.Fatalf("scene %q claims area=%q but sits at %v,%v (outside %v)", sc.ID, sc.Area, sc.Latitude, sc.Longitude, b)
		}
	}
}

// SCENE-REAL-COUNTS-001: 场景上的计数必须是**真算出来的**，不是写死的常数。
//
// posts / creators / activities / invites 这四个是 069 迁移里写死的整数，全仓
// 根本没有 post↔scene 的关联 —— 它们不显示、却拿去算"推荐度"，等于用编的
// 数字给用户排序。现在 saved / visited / planned 三个计数由
// reality.user_scene_states 聚合而来：没人动过就是 0，有人收藏就 +1。
func TestSceneCountsAreDerivedFromUserStates(t *testing.T) {
	s := New()
	ctx := t.Context()
	apply := func(actor, commandType, sceneID string) {
		t.Helper()
		e := envelope(commandType, map[string]any{"sceneId": sceneID, "enabled": true})
		e.Actor.ID = actor
		e.Principal.ID = actor
		if r := s.HandleContext(ctx, e); r.Outcome != "ACCEPTED" {
			t.Fatalf("%s by %s: expected ACCEPTED, got %q err=%+v", commandType, actor, r.Outcome, r.Error)
		}
	}
	apply("u1", "SetRealitySceneSaved", "hoankiem")
	apply("u2", "SetRealitySceneSaved", "hoankiem")
	apply("u3", "SetRealitySceneSaved", "hoankiem")
	apply("u1", "SetPrivateRealitySceneVisited", "hoankiem")
	apply("u4", "SetRealityScenePlanned", "hoankiem")

	scenes, err := s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	var hk, untouched *Scene
	for i := range scenes {
		switch scenes[i].ID {
		case "hoankiem":
			hk = &scenes[i]
		case "manzi":
			untouched = &scenes[i]
		}
	}
	if hk == nil {
		t.Fatal("hoankiem missing")
	}
	if hk.SavedCount != 3 || hk.VisitedCount != 1 || hk.PlannedCount != 1 {
		t.Fatalf("counts not derived from user states: saved=%d visited=%d planned=%d", hk.SavedCount, hk.VisitedCount, hk.PlannedCount)
	}
	// 没人碰过的场景必须是 0 —— 不是写死的 312 / 118。
	if untouched == nil || untouched.SavedCount != 0 || untouched.VisitedCount != 0 || untouched.PlannedCount != 0 {
		t.Fatalf("untouched scene must count 0, got %+v", untouched)
	}
}

// 计数必须真的出在 JSON 里，否则客户端永远读不到（Scene 有自定义
// MarshalJSON，结构体上加字段不会自动进 JSON —— 这个坑踩过一次）。
func TestSceneRealCountsAreSerialized(t *testing.T) {
	s := New()
	e := envelope("SetRealitySceneSaved", map[string]any{"sceneId": "trucbach", "enabled": true})
	if r := s.HandleContext(t.Context(), e); r.Outcome != "ACCEPTED" {
		t.Fatalf("seed save failed: %q err=%+v", r.Outcome, r.Error)
	}
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	body, err := json.Marshal(map[string]any{"scenes": scenes})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Scenes []map[string]any `json:"scenes"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, sc := range decoded.Scenes {
		if sc["id"] != "trucbach" {
			continue
		}
		for _, key := range []string{"savedCount", "visitedCount", "plannedCount"} {
			if _, ok := sc[key]; !ok {
				t.Fatalf("%s missing from serialized scene JSON — the client can never render it", key)
			}
		}
		if got, _ := sc["savedCount"].(float64); got != 1 {
			t.Fatalf("expected savedCount=1 in JSON, got %v", got)
		}
		return
	}
	t.Fatal("trucbach missing from serialized scenes")
}

// SCENE-NO-FABRICATED-001: 场景上不许再有**编出来的数字**。
//
// quality / posts / creators / activities / invites 是 069 迁移里手写死的整数：
// 全仓没有 post↔scene 的关联（posts 从哪来？），没有任何"质量"评分的来源
// （quality 85 和 96 差在哪？）。它们大部分连 UI 都不显示，却拿去算
// recommendation_score —— 等于用编的数字决定用户先看到谁。已删除，并且钉住
// 不许回来。
func TestSceneHasNoFabricatedNumbers(t *testing.T) {
	// 1) 结构体上不许再有这几个字段。
	typ := reflect.TypeOf(Scene{})
	for _, name := range []string{"Quality", "Posts", "Creators", "Activities", "Invites"} {
		if _, ok := typ.FieldByName(name); ok {
			t.Fatalf("Scene.%s is back — it never had a real data source, only a hand-written constant in the migration", name)
		}
	}
	// 2) 接口 JSON 里也不许再有。Scene 有自定义 MarshalJSON，结构体上删了字段
	//    不代表 JSON 里没了 key —— 两边都要钉（这个坑踩过一次）。
	s := New()
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	body, err := json.Marshal(map[string]any{"scenes": scenes})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Scenes []map[string]any `json:"scenes"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.Scenes) == 0 {
		t.Fatal("no scenes serialized — the pin below would pass vacuously")
	}
	for _, key := range []string{"quality", "posts", "creators", "activities", "invites"} {
		if v, ok := decoded.Scenes[0][key]; ok {
			t.Fatalf("%q is back in scene JSON (value=%v): it is a fabricated constant with no source", key, v)
		}
	}
	// 反向钉：真实字段都还在，别删过头。
	for _, key := range []string{"id", "name", "area", "type", "latitude", "longitude", "best", "active", "description", "savedCount", "visitedCount", "plannedCount"} {
		if _, ok := decoded.Scenes[0][key]; !ok {
			t.Fatalf("%q disappeared from scene JSON — the client reads this key", key)
		}
	}
}

// SCENE-CHECKIN-001: 「我在这里」是一个**会自己过期**的现场声明。
//
// 三件事一起钉，少一件这个数字就会变成新的假数据：
//  1. hereCount 是真聚合出来的 —— 两个人声明就是 2，不是写死的"热度"；
//  2. **会过期** —— 人走了数字自己掉下来，不需要用户记得取消
//     （一个永不消失的"我在这里"是假信号，会让场景永远显示有人）；
//  3. 本人在不在现场要能查回来 —— 否则重开 app 按钮的选中态就是错的。
func TestCheckInIsTimeBoxedAndCountedForReal(t *testing.T) {
	s := New()
	ctx := t.Context()
	// ListScenes 内部用真时钟算 CheckinTTL——钉死一个过去时刻，跑到
	// now+90min 之后就全过期变红。用当前时间，过期语义照样由
	// now.Add(CheckinTTL+time.Minute) 那一段钉。
	now := time.Now()
	// 直接走 repo：这个测试钉的是**计数语义**（聚合 / 过期 / 取消），
	// 命令有没有接上由 TestCheckInIsReachableThroughCommand 单独钉 —— 两件事
	// 混在一个测试里，红的时候分不清是哪边坏了。
	declare := func(actor, sceneID string) {
		t.Helper()
		if err := s.repo.CheckInScene(ctx, actor, sceneID, nil, now); err != nil {
			t.Fatalf("CheckInScene: %v", err)
		}
	}
	declare("u1", "hoankiem")
	declare("u2", "hoankiem")
	scenes, err := s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	var hk, untouched *Scene
	for i := range scenes {
		switch scenes[i].ID {
		case "hoankiem":
			hk = &scenes[i]
		case "manzi":
			untouched = &scenes[i]
		}
	}
	if hk == nil || hk.HereCount != 2 {
		t.Fatalf("hereCount must be a real aggregate of live check-ins, got %+v", hk)
	}
	if untouched == nil || untouched.HereCount != 0 {
		t.Fatalf("a scene nobody declared must count 0, got %+v", untouched)
	}
	// 过期后必须自己掉到 0 —— 这是"会自己变化"的关键。
	expired, err := s.repo.ListScenePresence(ctx, now.Add(CheckinTTL+time.Minute))
	if err != nil {
		t.Fatalf("ListScenePresence: %v", err)
	}
	if expired["hoankiem"] != 0 {
		t.Fatalf("check-in outlived its TTL: hereCount=%d after %v", expired["hoankiem"], CheckinTTL)
	}
	// 取消：enabled=false 立刻不算数，不用等过期。
	if err := s.repo.CancelCheckIn(ctx, "u1", "hoankiem"); err != nil {
		t.Fatalf("CancelCheckIn: %v", err)
	}
	live, err := s.repo.ListScenePresence(ctx, now)
	if err != nil {
		t.Fatalf("ListScenePresence: %v", err)
	}
	if live["hoankiem"] != 1 {
		t.Fatalf("cancel must take effect immediately, got hereCount=%d", live["hoankiem"])
	}
	// 本人查得回来 —— 重开 app 时按钮选中态靠它。
	mine, err := s.repo.ListMyCheckIns(ctx, "u2", now)
	if err != nil {
		t.Fatalf("ListMyCheckIns: %v", err)
	}
	if len(mine) != 1 || mine[0] != "hoankiem" {
		t.Fatalf("ListMyCheckIns should return hoankiem for u2, got %v", mine)
	}
}

// 「我在这里」必须真的能**通过命令**打到，不是只在 repo 里存在。
// 本仓被"建好了但没人调用"咬过很多次 —— 命令没接上 = 功能不存在。
func TestCheckInIsReachableThroughCommand(t *testing.T) {
	s := New()
	ctx := t.Context()
	if !s.Supports("SetRealitySceneCheckIn") {
		t.Fatal("SetRealitySceneCheckIn is not in Supports() — dispatch will never route it here")
	}
	e := envelope("SetRealitySceneCheckIn", map[string]any{"sceneId": "hoankiem", "enabled": true, "distanceMeters": float64(120)})
	if r := s.HandleContext(ctx, e); r.Outcome != "ACCEPTED" {
		t.Fatalf("check-in rejected: %q err=%+v", r.Outcome, r.Error)
	}
	scenes, err := s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	for _, sc := range scenes {
		if sc.ID == "hoankiem" {
			if sc.HereCount != 1 {
				t.Fatalf("command accepted but hereCount=%d — the command is half-wired", sc.HereCount)
			}
			return
		}
	}
	t.Fatal("hoankiem missing")
}

// hereCount 必须真的出在 JSON 里，而且**不许**带出任何"谁在现场"的信息。
func TestCheckInCountIsSerializedWithoutIdentity(t *testing.T) {
	s := New()
	ctx := t.Context()
	e := envelope("SetRealitySceneCheckIn", map[string]any{"sceneId": "trucbach", "enabled": true, "distanceMeters": float64(80)})
	e.Actor.ID, e.Principal.ID = "u_secret", "u_secret"
	if r := s.HandleContext(ctx, e); r.Outcome != "ACCEPTED" {
		t.Fatalf("check-in rejected: %q err=%+v", r.Outcome, r.Error)
	}
	scenes, err := s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	body, err := json.Marshal(map[string]any{"scenes": scenes})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(body), "u_secret") {
		t.Fatal("actor id leaked into the scene payload — presence must be aggregate-only")
	}
	var decoded struct {
		Scenes []map[string]any `json:"scenes"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, sc := range decoded.Scenes {
		if sc["id"] != "trucbach" {
			continue
		}
		if got, _ := sc["hereCount"].(float64); got != 1 {
			t.Fatalf("expected hereCount=1 in JSON, got %v", got)
		}
		return
	}
	t.Fatal("trucbach missing from serialized scenes")
}

// SCENE-CONTRIB-001: 用户提交的新场景要**经过别人确认**才进目录。
//
// 三件事，少一件这套就会变成新的假数据入口：
//  1. 提交进来是 PENDING，**不进目录**；
//  2. 提交者**不能确认自己的**提案 —— 自己给自己背书等于没有确认；
//  3. 确认数够了自己上架，但必须带着 Source=COMMUNITY —— 它的坐标是用户随手
//     点的，跟查过 OSM 的那 11 条不是一种东西。不标来源就是冒充。
func TestCommunityProposalNeedsOtherPeoplesConfirmation(t *testing.T) {
	s := New()
	ctx := t.Context()
	propose := func(actor string) command.Result {
		t.Helper()
		e := envelope("ProposeRealityScene", map[string]any{
			"name": "Cà phê Bệt", "area": "Hoàn Kiếm", "type": "咖啡 · 户外",
			"latitude": float64(21.0290), "longitude": float64(105.8530), "description": "湖边草地上的露天咖啡摊。",
		})
		e.Actor.ID, e.Principal.ID = actor, actor
		return s.HandleContext(ctx, e)
	}
	if r := propose("u1"); r.Outcome != "ACCEPTED" {
		t.Fatalf("propose rejected: %q err=%+v", r.Outcome, r.Error)
	}
	var proposalID string
	{
		var payload struct {
			ProposalID string `json:"proposalId"`
			Status     string `json:"status"`
		}
		if err := json.Unmarshal([]byte(propose("u1").OperationRef), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.ProposalID == "" {
			t.Fatal("no proposalId returned")
		}
		proposalID = payload.ProposalID
	}
	// 1. 还没确认 → 不在目录里。
	scenes, err := s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	for _, sc := range scenes {
		if sc.ID == proposalID {
			t.Fatal("an unconfirmed proposal is already in the scene catalog")
		}
	}
	// 2. 提交者不能确认自己的。
	e := envelope("ConfirmRealitySceneProposal", map[string]any{"proposalId": proposalID})
	e.Actor.ID, e.Principal.ID = "u1", "u1"
	if r := s.HandleContext(ctx, e); r.Outcome != "REJECTED" {
		t.Fatalf("self-confirmation must be rejected, got %q", r.Outcome)
	}
	// 3. 只来一个确认还不够（需要 2 个）。
	confirm := func(actor string) command.Result {
		t.Helper()
		ce := envelope("ConfirmRealitySceneProposal", map[string]any{"proposalId": proposalID})
		ce.Actor.ID, ce.Principal.ID = actor, actor
		return s.HandleContext(ctx, ce)
	}
	if r := confirm("u2"); r.Outcome != "ACCEPTED" {
		t.Fatalf("confirm by another user rejected: %q err=%+v", r.Outcome, r.Error)
	}
	scenes, err = s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	if containsScene(scenes, proposalID) {
		t.Fatal("one confirmation is not enough — it needs 2")
	}
	// 4. 第二个确认 → 上架，而且必须带 COMMUNTIY 来源。
	if r := confirm("u3"); r.Outcome != "ACCEPTED" {
		t.Fatalf("second confirm rejected: %q err=%+v", r.Outcome, r.Error)
	}
	scenes, err = s.ListScenes(ctx)
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	var added *Scene
	for i := range scenes {
		if scenes[i].ID == proposalID {
			added = &scenes[i]
		}
	}
	if added == nil {
		t.Fatal("proposal with enough confirmations did not enter the catalog")
	}
	if added.Source != SourceCommunity {
		t.Fatalf("community scene must be tagged Source=COMMUNITY, got %q — otherwise it poses as OSM-verified", added.Source)
	}
	// 目录里原有的那 11 条必须还是 OSM —— 不许被这条冲掉来源。
	for _, sc := range scenes {
		if sc.Source != SourceOSM && sc.Source != SourceCommunity {
			t.Fatalf("scene %q has source %q — every scene must declare where its data came from", sc.ID, sc.Source)
		}
	}
}

// 来源必须真的进 JSON，客户端靠它区分"查过的"和"别人填的"。
func TestSceneSourceIsSerialized(t *testing.T) {
	s := New()
	scenes, err := s.ListScenes(t.Context())
	if err != nil {
		t.Fatalf("ListScenes: %v", err)
	}
	body, err := json.Marshal(map[string]any{"scenes": scenes})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded struct {
		Scenes []map[string]any `json:"scenes"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.Scenes) == 0 {
		t.Fatal("no scenes serialized")
	}
	for _, sc := range decoded.Scenes {
		source, _ := sc["source"].(string)
		if source != "OSM" && source != "COMMUNITY" {
			t.Fatalf("scene %v has no usable source in JSON: %q", sc["id"], source)
		}
	}
}

func containsScene(scenes []Scene, id string) bool {
	for _, sc := range scenes {
		if sc.ID == id {
			return true
		}
	}
	return false
}

// 推荐度只能由**真实信号**决定：用户自己的行为计数 + 距离。
// 老公式 `quality*0.55 + log1p(posts+2*creators+4*activities+2*invites)*8 - 距离`
// 里，一个从没人去过的场景只要 seed 里 posts=312 就能排在有人收藏的场景前面。
func TestRecommendationScoreUsesOnlyRealSignals(t *testing.T) {
	base := Scene{ID: "base", DistanceMeters: 1000}
	nearer := Scene{ID: "nearer", DistanceMeters: 500}
	engaged := Scene{ID: "engaged", DistanceMeters: 1000, SavedCount: 3}
	visited := Scene{ID: "visited", DistanceMeters: 1000, VisitedCount: 2}
	if !(recommendationScore(nearer) > recommendationScore(base)) {
		t.Fatalf("distance must win when nothing else differs: nearer=%v base=%v", recommendationScore(nearer), recommendationScore(base))
	}
	if !(recommendationScore(engaged) > recommendationScore(base)) {
		t.Fatalf("real saves must outrank an untouched scene at the same distance: engaged=%v base=%v", recommendationScore(engaged), recommendationScore(base))
	}
	if !(recommendationScore(visited) > recommendationScore(base)) {
		t.Fatalf("real visits must outrank an untouched scene at the same distance: visited=%v base=%v", recommendationScore(visited), recommendationScore(base))
	}
	// 没人碰过的场景，分差只来自距离 —— 不存在"天生高分"。
	if recommendationScore(base) != -2.5 {
		t.Fatalf("untouched scene score must be distance-only, got %v", recommendationScore(base))
	}
}
