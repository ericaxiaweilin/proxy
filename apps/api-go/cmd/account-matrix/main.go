// Command account-matrix runs the account-plane live checks: baseline session
// creation, 12-way concurrency, idempotent replay, four malformed bodies, a 4MB
// body, and the command-version gate. ACCOUNT-MATRIX-001.
//
// "Stricter than a real user": nobody clicks twelve times at once, posts a 4MB
// body, or sends an empty envelope — and those are exactly the attack surface, so
// every one of them is tried here and must be refused with a structured 4xx, not a
// 5xx or a timeout.
//
// Read-only: it creates anonymous sessions (reversible, expiring) and writes no
// business data.
//
// usage: PROXY_API_BASE=http://127.0.0.1:4100 go -C apps/api-go run ./cmd/account-matrix
//
// Why this moved out of scripts/account-matrix.mjs: it used to live in /tmp and be
// invoked as `node /tmp/account-matrix.mjs | tail -n 10`. /tmp got cleaned, the
// child died with MODULE_NOT_FOUND, and the pipe's exit code was tail's — the
// script printed "51 cases passed" and exited 0 while six cases never ran. Both
// halves of that lesson stay in the code: the tool lives in the repo, and the
// status code comes from the response, never from a guess about the body.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	userAgent    = "account-matrix/1.0"
	commandPath  = "/v1/commands/CreateAnonymousSession"
	concurrency  = 12
	bigBodyBytes = 4 * 1024 * 1024
)

type matrix struct {
	base     string
	client   *http.Client
	failures int
}

func (m *matrix) ok(message string) {
	fmt.Printf("  OK  : %s\n", message)
}

func (m *matrix) fail(message string) {
	fmt.Printf("  FAIL: %s\n", message)
	m.failures++
}

// sessionResponse is the part of the wire shape this matrix asserts on: the access
// token proving a session was created, and the structured error code proving a
// rejection was deliberate.
type sessionResponse struct {
	Auth struct {
		AccessToken string `json:"accessToken"`
	} `json:"auth"`
	Error struct {
		ErrorCode string `json:"errorCode"`
	} `json:"error"`
}

func (m *matrix) decode(body []byte) *sessionResponse {
	var decoded sessionResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil
	}
	return &decoded
}

func stamp() string {
	return fmt.Sprintf("%d%03d", time.Now().UnixMilli(), rand.IntN(1000))
}

// envelope mirrors the payload shape the working e2e script sends
// (scripts/benefit-eligibility-e2e.sh). An empty payload is refused with
// INVALID_COMMAND_ENVELOPE, which is the validation layer being right and the test
// being wrong — asserting against a guessed envelope tests the guess, not the
// product.
func envelope(id string, overrides map[string]any) map[string]any {
	t := stamp()
	body := map[string]any{
		"commandType":    "CreateAnonymousSession",
		"commandVersion": 1,
		"commandId":      "acct-matrix-" + id + "-" + t,
		"idempotencyKey": "acct-matrix-idem-" + id + "-" + t,
		"actor":          map[string]any{"type": "USER", "id": "ignored"},
		"principal":      map[string]any{"type": "INDIVIDUAL", "id": "ignored"},
		"target":         map[string]any{"type": "Session", "id": "ignored"},
		"authContext":    map[string]any{"clientIp": "127.0.0.1", "userAgent": userAgent},
		"purpose":        "e2e_account_matrix",
		"correlationId":  "acct-matrix-corr-" + id + "-" + t,
		"causationId":    "",
		"requestedAt":    time.Now().UTC().Format("2006-01-02T15:04:05Z"),
		"payload": map[string]any{
			"deviceId":         "acct-matrix-" + id + "-" + t,
			"platform":         "IOS",
			"deviceCredential": strings.Repeat("a", 64),
			"dateOfBirth":      "2000-01-01",
			"legalDocVersion":  "1.1",
			"consents":         map[string]any{"terms": true, "privacy": true},
		},
	}
	for key, value := range overrides {
		body[key] = value
	}
	return body
}

func (m *matrix) get(path string, timeout time.Duration) (int, error) {
	client := &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{Proxy: nil},
	}
	response, err := client.Get(m.base + path)
	if err != nil {
		return -1, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, nil
}

// post returns the status code and the raw body. A request that never completed is
// reported as a failure by the caller, not swallowed.
func (m *matrix) post(body any) (int, []byte, error) {
	var payload []byte
	switch value := body.(type) {
	case string:
		payload = []byte(value)
	case map[string]any:
		encoded, err := json.Marshal(value)
		if err != nil {
			return -1, nil, err
		}
		payload = encoded
	default:
		return -1, nil, fmt.Errorf("unsupported body type %T", body)
	}

	request, err := http.NewRequest(http.MethodPost, m.base+commandPath, bytes.NewReader(payload))
	if err != nil {
		return -1, nil, err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("user-agent", userAgent)

	response, err := m.client.Do(request)
	if err != nil {
		return -1, nil, err
	}
	defer response.Body.Close()
	read, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return response.StatusCode, nil, err
	}
	return response.StatusCode, read, nil
}

func main() {
	base := os.Getenv("PROXY_API_BASE")
	if base == "" {
		base = "http://127.0.0.1:4100"
	}
	m := &matrix{
		base: base,
		// Proxy: nil is the Go form of the curl `--noproxy '*'` the Node script
		// passed: a developer machine's corporate proxy must never sit between the
		// gate and the API on localhost.
		client: &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{Proxy: nil}},
	}

	fmt.Println("=== account matrix · 6 例（并发 / 限流 / 畸形）===")
	fmt.Printf("  api: %s\n", base)

	// 0. The API must be reachable, or every case below is meaningless.
	code, err := m.get("/health/live", 5*time.Second)
	if err != nil || code != http.StatusOK {
		m.fail(fmt.Sprintf("API 不在 %s（health=%d）—— 下面 6 例全部无意义，先起 API", base, code))
		fmt.Println("\n=== account matrix: 0 例有效（API 不可达）===")
		os.Exit(1)
	}
	m.ok("API 活着")

	// 1. Baseline: one ordinary anonymous session must succeed with a token.
	code, body, err := m.post(envelope("baseline", nil))
	token := ""
	if decoded := m.decode(body); decoded != nil {
		token = decoded.Auth.AccessToken
	}
	switch {
	case err != nil:
		m.fail("基线匿名会话请求没有完成：" + err.Error())
	case code >= 200 && code < 300 && token != "":
		m.ok(fmt.Sprintf("基线匿名会话成功（%d，拿到 token）", code))
	default:
		m.fail(fmt.Sprintf("基线匿名会话失败（%d）：%s", code, preview(body, 160)))
	}

	// 2. Concurrency: 12 sessions at once must all succeed and all be distinct —
	// session crosstalk only shows its face here.
	results := make([]struct {
		code  int
		token string
		err   error
	}, concurrency)
	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, raw, requestErr := m.post(envelope(fmt.Sprintf("conc%d", i), nil))
			token := ""
			if decoded := m.decode(raw); decoded != nil {
				token = decoded.Auth.AccessToken
			}
			results[i] = struct {
				code  int
				token string
				err   error
			}{code: status, token: token, err: requestErr}
		}(i)
	}
	wg.Wait()

	codes := make([]int, 0, concurrency)
	seen := map[string]bool{}
	unique, succeeded := 0, 0
	for _, result := range results {
		codes = append(codes, result.code)
		if result.code >= 200 && result.code < 300 {
			succeeded++
		}
		if result.token != "" && !seen[result.token] {
			seen[result.token] = true
			unique++
		}
	}
	switch {
	case succeeded == concurrency && unique == concurrency:
		m.ok(fmt.Sprintf("并发 %d 次全部成功且 token 各不相同（%d/%d）", concurrency, unique, concurrency))
	case succeeded < concurrency:
		m.fail(fmt.Sprintf("并发 %d 次只成功 %d 次：%v", concurrency, succeeded, codes))
	default:
		m.fail(fmt.Sprintf("并发 %d 次 token 出现复用（唯一 %d/%d）—— 会话串扰", concurrency, unique, concurrency))
	}

	// 3. Idempotent replay: the same key twice must converge, never fork.
	key := "acct-matrix-replay-" + stamp()
	replay := envelope("replay", map[string]any{"idempotencyKey": key})
	firstCode, firstBody, firstErr := m.post(replay)
	secondCode, secondBody, secondErr := m.post(replay)
	firstToken, secondToken := tokenOf(m, firstBody), tokenOf(m, secondBody)
	switch {
	case firstErr != nil || secondErr != nil:
		m.fail(fmt.Sprintf("幂等重放没有完成（%v / %v）", firstErr, secondErr))
	case firstCode == 409 || secondCode == 409:
		m.ok(fmt.Sprintf("重放被拒或收敛（%d/%d）", firstCode, secondCode))
	case firstToken != "" && firstToken == secondToken:
		m.ok(fmt.Sprintf("重放收敛到同一会话（token 相同，%d/%d）", firstCode, secondCode))
	default:
		m.fail(fmt.Sprintf("同幂等键两次得到不同结果（%d/%d，token %s/%s）—— 幂等失效",
			firstCode, secondCode, presence(firstToken), presence(secondToken)))
	}

	// 4. Malformed bodies: structured 4xx, never 5xx and never 200.
	for _, malformed := range []struct{ name, raw string }{
		{"非法 JSON", "{not json"},
		{"空 body", ""},
		{"JSON 数组而非对象", "[]"},
		{"缺 commandType", `{"commandVersion":1,"payload":{}}`},
	} {
		status, raw, requestErr := m.post(malformed.raw)
		switch {
		case requestErr != nil:
			m.fail(fmt.Sprintf("%s 请求没有完成：%v", malformed.name, requestErr))
		case status >= 400 && status < 500:
			m.ok(fmt.Sprintf("%s → %d（4xx 拒绝）", malformed.name, status))
		case status == 200:
			m.fail(fmt.Sprintf("%s 竟然返回 200：%s —— 畸形输入被放行", malformed.name, preview(raw, 120)))
		default:
			m.fail(fmt.Sprintf("%s → %d，应当是 4xx（5xx 说明解析层没有兜住）", malformed.name, status))
		}
	}

	// 5. A 4MB body must be refused, and the service must still be standing after
	// it. The Node version hit the OS exec argument limit sending it as a CLI
	// argument (E2BIG) and would have blamed the product for a testbed problem;
	// here the body goes over the socket like any client would send it.
	big := envelope("big", nil)
	big["payload"] = map[string]any{"blob": strings.Repeat("x", bigBodyBytes)}
	status, _, requestErr := m.post(big)
	switch {
	case requestErr != nil:
		m.fail("4MB body 请求没有完成：" + requestErr.Error())
	case status >= 400 && status < 500:
		m.ok(fmt.Sprintf("4MB body → %d（4xx 拒绝）", status))
	default:
		m.fail(fmt.Sprintf("4MB body → %d，应当被拒（200 意味着 4MB 全进了内存）", status))
	}
	afterCode, _, afterErr := m.post(envelope("after-big", nil))
	switch {
	case afterErr != nil:
		m.fail("超大 body 之后服务不可用（请求没有完成：" + afterErr.Error() + "）")
	case afterCode >= 200 && afterCode < 300:
		m.ok("超大 body 之后服务仍可用")
	default:
		m.fail(fmt.Sprintf("超大 body 之后服务不可用（%d）—— 4MB 请求打挂了会话创建", afterCode))
	}

	// 6. Version gate. The first version of this case asserted "any unknown
	// commandVersion is refused", which the openapi contract disproved: it declared
	// only `minimum: 1`, so 9999 ran as v1 — a silent misread, not additive
	// evolution. The contract now declares `enum: [1]` and the server enforces
	// SupportedCommandVersion, so both halves are asserted here: <= 0 and a version
	// above the declared enum must be refused, the high ones with the error code a
	// client can act on.
	for _, version := range []int{0, -1} {
		vCode, _, vErr := m.post(envelope(fmt.Sprintf("ver%d", version), map[string]any{"commandVersion": version}))
		switch {
		case vErr != nil:
			m.fail(fmt.Sprintf("commandVersion=%d 请求没有完成：%v", version, vErr))
		case vCode >= 400 && vCode < 500:
			m.ok(fmt.Sprintf("commandVersion=%d → %d（4xx 拒绝，这是真正的闸门）", version, vCode))
		default:
			m.fail(fmt.Sprintf("commandVersion=%d → %d，应当被拒（missingEnvelopeField 拒 <= 0）", version, vCode))
		}
	}

	missingVersion := envelope("nover", nil)
	delete(missingVersion, "commandVersion")
	missingCode, _, missingErr := m.post(missingVersion)
	switch {
	case missingErr != nil:
		m.fail("缺 commandVersion 请求没有完成：" + missingErr.Error())
	case missingCode >= 400 && missingCode < 500:
		m.ok(fmt.Sprintf("缺 commandVersion → %d（4xx 拒绝）", missingCode))
	default:
		m.fail(fmt.Sprintf("缺 commandVersion → %d，应当被拒", missingCode))
	}

	for _, version := range []int{2, 9999} {
		highCode, highBody, highErr := m.post(envelope(fmt.Sprintf("hiver%d", version), map[string]any{"commandVersion": version}))
		switch {
		case highErr != nil:
			m.fail(fmt.Sprintf("commandVersion=%d 请求没有完成：%v", version, highErr))
		case highCode >= 400 && highCode < 500:
			code := ""
			if decoded := m.decode(highBody); decoded != nil {
				code = decoded.Error.ErrorCode
			}
			if code == "UNSUPPORTED_COMMAND_VERSION" {
				m.ok(fmt.Sprintf("commandVersion=%d → %d UNSUPPORTED_COMMAND_VERSION（客户端据此升级）", version, highCode))
			} else {
				m.fail(fmt.Sprintf("commandVersion=%d 被拒但错误码是 %s，应为 UNSUPPORTED_COMMAND_VERSION", version, code))
			}
		default:
			m.fail(fmt.Sprintf("commandVersion=%d → %d：当 v1 执行就是静默误读（v2 的 payload 语义会被按老规则处理）", version, highCode))
		}
	}

	fmt.Println("")
	if m.failures > 0 {
		fmt.Printf("=== account matrix: %d 例失败 ===\n", m.failures)
		os.Exit(1)
	}
	fmt.Println("=== account matrix: ALL PASS ===")
}

func tokenOf(m *matrix, body []byte) string {
	if decoded := m.decode(body); decoded != nil {
		return decoded.Auth.AccessToken
	}
	return ""
}

func presence(token string) string {
	if token == "" {
		return "无"
	}
	return "有"
}

func preview(body []byte, limit int) string {
	text := strings.ReplaceAll(string(body), "\n", " ")
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}
