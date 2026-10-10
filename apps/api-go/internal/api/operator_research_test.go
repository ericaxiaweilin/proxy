package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/research"
)

// OPS-RESEARCH-001：实验 / 影子流量页的四个端点。
//
// 这一层证明的是**门与状态码**：没会话 401、普通用户 403、写口只认 POST（405）、
// 非法输入 400 而不是静默成功、冲突 409 而不是 500。阶段机与乐观锁的语义由
// internal/research 的单元测试证明，列名与 jsonb 由 internal/platform/postgres 的
// 集成测试对真库证明 —— 这里用 Memory，不假装证明了 SQL。

func consolePost(server *Server, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/operator/"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

var researchWritePaths = []string{"research/experiments", "research/experiments/stage", "research/shadow"}

func TestResearchWriteEndpointsAreOperatorOnlyAndPostOnly(t *testing.T) {
	server := operatorConsoleServer()
	for _, path := range researchWritePaths {
		if rec := consolePost(server, path, "", `{}`); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a session must be 401, got %d", path, rec.Code)
		}
		if rec := consolePost(server, path, "user_token", `{}`); rec.Code != http.StatusForbidden {
			t.Fatalf("%s for an ordinary user must be 403, got %d", path, rec.Code)
		}
		// 写口只认 POST：GET 打过来必须 405，绝不能变成一次「读」。
		if rec := consoleGet(server, path, "ops_token"); rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("GET %s must be 405, got %d", path, rec.Code)
		}
	}
}

func TestResearchCreateRejectsBadInputAndConflicts(t *testing.T) {
	server := operatorConsoleServer()

	for _, tc := range []struct{ name, body string }{
		{"malformed json", `{`},
		{"missing experiment_id", `{"name":"x"}`},
		{"missing name", `{"experiment_id":"e1"}`},
		{"traffic_pct over 100", `{"experiment_id":"e1","name":"x","traffic_pct":150}`},
		{"negative traffic_pct", `{"experiment_id":"e1","name":"x","traffic_pct":-1}`},
	} {
		if rec := consolePost(server, "research/experiments", "ops_token", tc.body); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s must be 400, got %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}

	rec := consolePost(server, "research/experiments", "ops_token", `{"experiment_id":"e1","name":"新实验","surface":"home"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string `json:"dataSource"`
		Experiment struct {
			ExperimentID string `json:"experiment_id"`
			Stage        string `json:"stage"`
			Version      int    `json:"version"`
		} `json:"experiment"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DataSource != "LIVE" || body.Experiment.Stage != "DRAFT" || body.Experiment.Version != 1 {
		t.Fatalf("a new experiment must come back LIVE/DRAFT/v1, got %+v", body)
	}

	// 同一个 id 再建：409（不是 500 —— 这是调用方能修的错误）。
	if rec := consolePost(server, "research/experiments", "ops_token", `{"experiment_id":"e1","name":"新实验"}`); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate experiment_id must be 409, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestResearchStageEndpointGuardsThePipeline(t *testing.T) {
	server := operatorConsoleServer()
	if rec := consolePost(server, "research/experiments", "ops_token", `{"experiment_id":"e1","name":"x"}`); rec.Code != http.StatusOK {
		t.Fatalf("seed create: %d %s", rec.Code, rec.Body.String())
	}

	for _, tc := range []struct {
		name string
		body string
		want int
	}{
		{"跨级 DRAFT->SHADOW", `{"experiment_id":"e1","to":"SHADOW"}`, http.StatusBadRequest},
		{"回退 DRAFT 自身", `{"experiment_id":"e1","to":"DRAFT"}`, http.StatusBadRequest},
		{"不认识的阶段", `{"experiment_id":"e1","to":"BOGUS"}`, http.StatusBadRequest},
		{"不存在的实验", `{"experiment_id":"nope","to":"LAB"}`, http.StatusNotFound},
	} {
		if rec := consolePost(server, "research/experiments/stage", "ops_token", tc.body); rec.Code != tc.want {
			t.Fatalf("%s: want %d got %d %s", tc.name, tc.want, rec.Code, rec.Body.String())
		}
	}

	rec := consolePost(server, "research/experiments/stage", "ops_token", `{"experiment_id":"e1","to":"LAB"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("DRAFT -> LAB: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Experiment struct {
			Stage   string `json:"stage"`
			Version int    `json:"version"`
		} `json:"experiment"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Experiment.Stage != "LAB" || body.Experiment.Version != 2 {
		t.Fatalf("after LAB want LAB/v2, got %+v", body.Experiment)
	}
}

// conflictRepo：GetExperiment 给一份「读到之后别人又改过」的旧状态 ——
// 用来证明 handler 把 ErrVersionConflict 翻成 409（而不是 500 或 400）。
// 真乐观锁由 internal/platform/postgres 的集成测试对真库钉。
type conflictRepo struct{ research.Repo }

func (conflictRepo) GetExperiment(context.Context, string) (research.Experiment, error) {
	return research.Experiment{ExperimentID: "e1", Stage: research.StageLab, Version: 1}, nil
}

func (conflictRepo) UpdateStage(context.Context, string, research.Stage, int) (research.Experiment, error) {
	return research.Experiment{}, research.ErrVersionConflict
}

func TestResearchStageConflictIs409Not500(t *testing.T) {
	server := operatorConsoleServer()
	server.Research = research.NewService(conflictRepo{})
	rec := consolePost(server, "research/experiments/stage", "ops_token", `{"experiment_id":"e1","to":"SHADOW"}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("a lost update must be 409, got %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "modified_by_someone_else") {
		t.Fatalf("409 must say what happened, got %s", rec.Body.String())
	}
}

func TestResearchShadowValidatesSnapshotAndStage(t *testing.T) {
	server := operatorConsoleServer()
	server.Research.Evaluate = func(map[string]any) (map[string]any, string) {
		return map[string]any{"kind": "PROACTIVE_NUDGE"}, ""
	}
	if rec := consolePost(server, "research/experiments", "ops_token", `{"experiment_id":"e1","name":"x"}`); rec.Code != http.StatusOK {
		t.Fatalf("seed create: %d %s", rec.Code, rec.Body.String())
	}

	good := `{"experiment_id":"e1","snapshot":{"context_snapshot_id":"s1","weather":"heavy_rain","mobility_friction":0.2,"delivery_capacity":0.9,"commute_eta":40}}`
	// DRAFT 阶段：影子评估必须被拒 —— 影子只存在于 SHADOW 阶段。
	if rec := consolePost(server, "research/shadow", "ops_token", good); rec.Code != http.StatusBadRequest {
		t.Fatalf("shadow eval outside SHADOW must be 400, got %d %s", rec.Code, rec.Body.String())
	}

	// 输入校验与 /v1/decisions/evaluate 同一份口径：weather 是受控词表，区间也要卡。
	for _, tc := range []struct{ name, body string }{
		{"weather 不在词表里", `{"experiment_id":"e1","snapshot":{"context_snapshot_id":"s1","weather":"sunny"}}`},
		{"缺 context_snapshot_id", `{"experiment_id":"e1","snapshot":{"weather":"clear"}}`},
		{"mobility_friction 越界", `{"experiment_id":"e1","snapshot":{"context_snapshot_id":"s1","weather":"clear","mobility_friction":1.5}}`},
		{"delivery_capacity 越界", `{"experiment_id":"e1","snapshot":{"context_snapshot_id":"s1","weather":"clear","delivery_capacity":-0.1}}`},
		{"commute_eta 越界", `{"experiment_id":"e1","snapshot":{"context_snapshot_id":"s1","weather":"clear","commute_eta":481}}`},
		{"缺 experiment_id", `{"snapshot":{"context_snapshot_id":"s1","weather":"clear"}}`},
	} {
		if rec := consolePost(server, "research/shadow", "ops_token", tc.body); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s must be 400, got %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}

	// 推到 SHADOW 后，同样的快照必须真的跑出判定并落库。
	if rec := consolePost(server, "research/experiments/stage", "ops_token", `{"experiment_id":"e1","to":"LAB"}`); rec.Code != http.StatusOK {
		t.Fatalf("to LAB: %d", rec.Code)
	}
	if rec := consolePost(server, "research/experiments/stage", "ops_token", `{"experiment_id":"e1","to":"SHADOW"}`); rec.Code != http.StatusOK {
		t.Fatalf("to SHADOW: %d", rec.Code)
	}
	rec := consolePost(server, "research/shadow", "ops_token", good)
	if rec.Code != http.StatusOK {
		t.Fatalf("shadow eval in SHADOW: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource string `json:"dataSource"`
		Evaluation struct {
			EvaluationID string         `json:"evaluation_id"`
			Intent       map[string]any `json:"intent"`
		} `json:"evaluation"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DataSource != "LIVE" || body.Evaluation.EvaluationID == "" || body.Evaluation.Intent["kind"] != "PROACTIVE_NUDGE" {
		t.Fatalf("shadow eval must carry the kernel's verdict: %+v", body)
	}
}

func TestResearchInventoryIsLiveAndSaysWhatIsNotBuilt(t *testing.T) {
	server := operatorConsoleServer()
	if rec := consolePost(server, "research/experiments", "ops_token", `{"experiment_id":"e1","name":"x"}`); rec.Code != http.StatusOK {
		t.Fatalf("seed create: %d %s", rec.Code, rec.Body.String())
	}
	rec := consoleGet(server, "research", "ops_token")
	if rec.Code != http.StatusOK {
		t.Fatalf("inventory: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		DataSource  string         `json:"dataSource"`
		StageCounts map[string]int `json:"stage_counts"`
		Experiments []any          `json:"experiments"`
		Notes       []string       `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.DataSource != "LIVE" {
		t.Fatalf("research inventory must be LIVE now, got %q", body.DataSource)
	}
	// 五个阶段都要在计数里（哪怕是 0）—— 少一个阶段，运营会以为那个阶段不存在。
	for _, st := range []string{"DRAFT", "LAB", "SHADOW", "PROD", "ENDED"} {
		if _, ok := body.StageCounts[st]; !ok {
			t.Fatalf("stage_counts must carry %s even when zero: %v", st, body.StageCounts)
		}
	}
	if body.StageCounts["DRAFT"] != 1 || len(body.Experiments) != 1 {
		t.Fatalf("inventory must reflect what we just created: %+v", body)
	}
	// notes 必须把「哪些没做」讲出来，否则 SHADOW 会被读成「已经在验证」。
	joined := strings.Join(body.Notes, "\n")
	if !strings.Contains(joined, "影子") {
		t.Fatalf("notes must explain what shadow traffic does and does not do: %v", body.Notes)
	}
}
