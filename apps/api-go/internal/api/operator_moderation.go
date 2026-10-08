package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/moderation"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-MODERATION-001（2026-10-08）：举报处置的运营入口。
//
// moderation 域早就有完整的写与读（举报队列 ListReportQueue、处置 RecordReportDisposition、
// 申诉复核 RecordAppealDecision），COMP-REPORT-005 的注释自己承认过「举报只进不出」。
// 但运营控制台里没有任何一页接这条链：队列只能靠发命令信封去读，等于没人用得上。
// 这里补两个端点，**不绕过**命令边界——仍然走 Moderation.HandleContext，所以所有
// 校验（处置人必须署名、已处置必须写结论、判定不成立必须写理由、举报必须真实存在）
// 与「处置结果通知举报人」的事件都原样生效。
//
// 注意这里只负责**记录**处置：OutcomeContentRemoved / AccountSuspended 记下来的是
// 「决定了什么」，本端点不执行下架或封号 —— 执行动作另有各自的域，响应里 enforcement
// 明确写 RECORD_ONLY，页面也据此显示，不让「已处置」看起来像「已生效」。

func newModerationCommandID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "op-mod-" + hex.EncodeToString(b)
}

func (s *Server) moderationEnvelope(r *http.Request, commandType string, payload map[string]any) (command.Envelope, bool) {
	actorID, principalID := s.operatorIdentity(r)
	if actorID == "" {
		return command.Envelope{}, false
	}
	id := newModerationCommandID()
	return command.Envelope{
		CommandID:      id,
		CommandType:    commandType,
		CommandVersion: 1,
		Actor:          command.Actor{Type: "USER", ID: actorID},
		Principal:      command.Principal{Type: "OPERATOR", ID: principalID},
		IdempotencyKey: id,
		AuthContext:    map[string]any{"operator": true},
		Purpose:        "MODERATION",
		CorrelationID:  id,
		RequestedAt:    time.Now().UTC().Format(time.RFC3339),
		Payload:        payload,
	}, true
}

// operatorModerationQueue: GET /v1/operator/moderation?includeClosed=1&limit=100
func (s *Server) operatorModerationQueue(w http.ResponseWriter, r *http.Request) {
	if s.Moderation == nil {
		notConnected("举报处置（没有配数据库）", "COMP-REPORT-005")(w, r)
		return
	}
	payload := map[string]any{"includeClosed": r.URL.Query().Get("includeClosed") == "1"}
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 {
		payload["limit"] = n
	}
	envelope, ok := s.moderationEnvelope(r, "ListReportQueue", payload)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	result := s.Moderation.HandleContext(r.Context(), envelope)
	if result.Error != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": result.Error.ErrorCode})
		return
	}
	s.auditWrite(r, "MODERATION_QUEUE_VIEW", string(ScopeModeration), operatoraudit.Entry{TargetKind: "ReportQueue", TargetID: "-", Outcome: operatoraudit.OutcomeOK})
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":  OperatorLiveSource,
		"reportQueue": result.Body["reportQueue"],
		"actions":     moderation.DispositionActions(),
		"outcomes":    moderation.DispositionOutcomes(),
		// 处置只记录；下架/封号由各自的域执行。页面必须把这句话摆出来。
		"enforcement": "RECORD_ONLY",
	})
}

// operatorModerationDisposition: POST /v1/operator/moderation/disposition
func (s *Server) operatorModerationDisposition(w http.ResponseWriter, r *http.Request) {
	if s.Moderation == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "moderation_not_configured"})
		return
	}
	var body struct {
		ReportID string `json:"reportId"`
		Action   string `json:"action"`
		Outcome  string `json:"outcome"`
		Note     string `json:"note"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body) != nil || strings.TrimSpace(body.ReportID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "report_and_action_required"})
		return
	}
	envelope, ok := s.moderationEnvelope(r, "RecordReportDisposition", map[string]any{
		"reportId": body.ReportID, "action": body.Action, "outcome": body.Outcome, "note": body.Note,
	})
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	result := s.Moderation.HandleContext(r.Context(), envelope)
	entry := operatoraudit.Entry{TargetKind: "Report", TargetID: body.ReportID, Detail: map[string]any{"action": body.Action, "outcome": body.Outcome}}
	if result.Error != nil {
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = result.Error.ErrorCode
		s.auditWrite(r, "REPORT_DISPOSITION", string(ScopeModeration), entry)
		status := http.StatusUnprocessableEntity
		if result.Error.ErrorCode == "DISPOSITION_FAILED" {
			status = http.StatusInternalServerError
		}
		writeJSON(w, status, map[string]any{"error": result.Error.ErrorCode})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	s.auditWrite(r, "REPORT_DISPOSITION", string(ScopeModeration), entry)
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource, "dispositionId": result.Aggregate.ID, "state": result.Aggregate.State, "enforcement": "RECORD_ONLY",
	})
}

// OPS-APPEALS-001：申诉复核。
//
//	GET  /v1/operator/appeals?includeClosed=1&limit=100
//	POST /v1/operator/appeals/decision  {appealId, decision: UPHELD|REJECTED, note}
//
// 复核走 RecordAppealDecision 命令（驳回必须写理由、复核人必须署名、申诉必须真实存在），
// 与举报处置一样只记录、不执行：「申诉成立」只是推翻原处置的**决定**，恢复账号 / 撤销下架另有各自的域。
func (s *Server) operatorAppealQueue(w http.ResponseWriter, r *http.Request) {
	if s.Moderation == nil {
		notConnected("申诉复核（没有配数据库）", "COMP-REPORT-004")(w, r)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	queue, err := s.Moderation.AppealQueue(r.Context(), r.URL.Query().Get("includeClosed") == "1", limit)
	if err != nil {
		log.Printf("operator appeals: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "appeal_queue_failed"})
		return
	}
	s.auditWrite(r, "APPEAL_QUEUE_VIEW", string(ScopeModeration), operatoraudit.Entry{TargetKind: "AppealQueue", TargetID: "-", Outcome: operatoraudit.OutcomeOK})
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":  OperatorLiveSource,
		"appealQueue": queue,
		"decisions":   moderation.AppealDecisions(),
		"enforcement": "RECORD_ONLY",
	})
}

func (s *Server) operatorAppealDecision(w http.ResponseWriter, r *http.Request) {
	if s.Moderation == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "moderation_not_configured"})
		return
	}
	var body struct {
		AppealID string `json:"appealId"`
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body) != nil || strings.TrimSpace(body.AppealID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "appeal_and_decision_required"})
		return
	}
	envelope, ok := s.moderationEnvelope(r, "RecordAppealDecision", map[string]any{"appealId": body.AppealID, "decision": body.Decision, "note": body.Note})
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
		return
	}
	result := s.Moderation.HandleContext(r.Context(), envelope)
	entry := operatoraudit.Entry{TargetKind: "Appeal", TargetID: body.AppealID, Detail: map[string]any{"decision": body.Decision}}
	if result.Error != nil {
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = result.Error.ErrorCode
		s.auditWrite(r, "APPEAL_DECISION", string(ScopeModeration), entry)
		status := http.StatusUnprocessableEntity
		if result.Error.ErrorCode == "APPEAL_DECISION_FAILED" {
			status = http.StatusInternalServerError
		}
		writeJSON(w, status, map[string]any{"error": result.Error.ErrorCode})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	s.auditWrite(r, "APPEAL_DECISION", string(ScopeModeration), entry)
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "decisionId": result.Aggregate.ID, "state": result.Aggregate.State, "enforcement": "RECORD_ONLY"})
}

// OPS-AUTHORITY-001：有权机关请求。
//
//	GET  /v1/operator/authority-requests?includeClosed=1
//	POST /v1/operator/authority-requests          受理一条请求（四项核验缺一不收，时限由请求种类决定）
//	POST /v1/operator/authority-requests/response 记录对它的响应（FULFILLED / PARTIALLY_FULFILLED / REFUSED / NO_DATA_FOUND）
//
// 都走 Moderation 命令边界（核验、时限、署名都在域里），要 AUTHORITY 权限并留审计。
func (s *Server) operatorAuthorityQueue(w http.ResponseWriter, r *http.Request) {
	if s.Moderation == nil {
		notConnected("有权机关请求（没有配数据库）", "COMP-AUTHORITY-001")(w, r)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	queue, err := s.Moderation.AuthorityQueue(r.Context(), r.URL.Query().Get("includeClosed") == "1", limit)
	if err != nil {
		log.Printf("operator authority queue: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "authority_queue_failed"})
		return
	}
	s.auditWrite(r, "AUTHORITY_QUEUE_VIEW", string(ScopeAuthority), operatoraudit.Entry{TargetKind: "AuthorityQueue", TargetID: "-", Outcome: operatoraudit.OutcomeOK})
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":     OperatorLiveSource,
		"authorityQueue": queue,
		"kinds":          moderation.AuthorityRequestKinds(),
		"outcomes":       moderation.AuthorityOutcomes(),
	})
}

func (s *Server) operatorAuthorityCommand(commandType, auditAction, idField string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Moderation == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "moderation_not_configured"})
			return
		}
		var payload map[string]any
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&payload) != nil || payload == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "json_body_required"})
			return
		}
		envelope, ok := s.moderationEnvelope(r, commandType, payload)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "access_token_required"})
			return
		}
		result := s.Moderation.HandleContext(r.Context(), envelope)
		target, _ := payload[idField].(string)
		if target == "" {
			target, _ = payload["requestRef"].(string)
		}
		entry := operatoraudit.Entry{TargetKind: "AuthorityRequest", TargetID: target, Detail: map[string]any{"command": commandType}}
		if result.Error != nil {
			entry.Outcome = operatoraudit.OutcomeDenied
			entry.Detail["error"] = result.Error.ErrorCode
			s.auditWrite(r, auditAction, string(ScopeAuthority), entry)
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": result.Error.ErrorCode})
			return
		}
		entry.Outcome = operatoraudit.OutcomeOK
		s.auditWrite(r, auditAction, string(ScopeAuthority), entry)
		writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "id": result.Aggregate.ID, "state": result.Aggregate.State})
	}
}
