package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/incentive"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
)

// OPS-INCENTIVE-001：激励规则。奖励只能是券（替用户领一份已有福利活动）或成长值，没有现金。
//
//	GET  /v1/operator/incentives                    规则 + 每条规则发了多少
//	POST /v1/operator/incentives                    新建 / 修改**未生效**的规则（默认不生效）
//	POST /v1/operator/incentives/active {id, active}  打开 / 关闭
//
// 要 PAYMENTS 权限（它动的是预算）并留审计。生效中的规则不许改内容：先关再改。
func (s *Server) operatorIncentives(w http.ResponseWriter, r *http.Request) {
	if s.IncentiveStore == nil {
		notConnected("激励规则（没有配数据库）", "INCENTIVE-001")(w, r)
		return
	}
	rules, err := s.IncentiveStore.ListRules(r.Context())
	if err == nil {
		var stats []incentive.RuleStat
		if stats, err = s.IncentiveStore.Stats(r.Context()); err == nil {
			byRule := map[string]incentive.RuleStat{}
			for _, st := range stats {
				byRule[st.RuleID] = st
			}
			views := make([]map[string]any, 0, len(rules))
			for _, rule := range rules {
				st := byRule[rule.ID]
				views = append(views, map[string]any{"rule": rule, "granted": st.Granted, "failed": st.Failed, "pointsGranted": st.Points})
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"dataSource": OperatorLiveSource, "rules": views,
				"triggers": incentive.Triggers(), "rewardKinds": incentive.RewardKinds(), "maxPoints": incentive.MaxPoints,
				"notes": []string{
					"奖励只有两种：券（替用户领一份已有的福利活动，咖啡券就是 FREE_DRINK / VOUCHER 福利）和成长值。没有现金——现金违规。",
					"券的预算和名额由福利活动自己的容量池管：名额用完时这条规则暂停发放，补上名额后会继续发给还没拿到的人。",
					"规则默认不生效；只发给规则创建之后才达成的人，不追溯老用户；账号要满足最小账号年龄且资料完善。",
					"生效中的规则不能改内容：先关闭，改完再打开。",
				},
			})
			return
		}
	}
	log.Printf("operator incentives: %v", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "incentives_query_failed"})
}

func (s *Server) operatorIncentiveUpsert(w http.ResponseWriter, r *http.Request) {
	if s.IncentiveStore == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "incentive_not_configured"})
		return
	}
	var body incentive.Rule
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "json_body_required"})
		return
	}
	operator, _ := s.operatorIdentity(r)
	now := time.Now().UTC()
	body.CreatedBy, body.CreatedAt, body.UpdatedAt, body.Active = operator, now, now, false
	if strings.TrimSpace(body.ID) == "" {
		body.ID = "inc_" + now.Format("20060102150405.000000000")
	}
	if body.MinAccountAgeHours == 0 {
		body.MinAccountAgeHours = 24
	}
	entry := operatoraudit.Entry{TargetKind: "IncentiveRule", TargetID: body.ID, Detail: map[string]any{"trigger": body.Trigger, "rewardKind": body.RewardKind}}
	if err := incentive.Validate(body); err != nil {
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = err.Error()
		s.auditWrite(r, "INCENTIVE_RULE_SAVE", string(ScopePayments), entry)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	if err := s.IncentiveStore.UpsertRule(r.Context(), body); err != nil {
		log.Printf("operator incentive upsert: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "incentive_save_failed"})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	s.auditWrite(r, "INCENTIVE_RULE_SAVE", string(ScopePayments), entry)
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "id": body.ID})
}

func (s *Server) operatorIncentiveActive(w http.ResponseWriter, r *http.Request) {
	if s.IncentiveStore == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "incentive_not_configured"})
		return
	}
	var body struct {
		ID     string `json:"id"`
		Active bool   `json:"active"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || strings.TrimSpace(body.ID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_required"})
		return
	}
	ok, err := s.IncentiveStore.SetActive(r.Context(), body.ID, body.Active, time.Now().UTC())
	entry := operatoraudit.Entry{TargetKind: "IncentiveRule", TargetID: body.ID, Detail: map[string]any{"active": body.Active}}
	switch {
	case err != nil:
		log.Printf("operator incentive active: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "incentive_toggle_failed"})
	case !ok:
		entry.Outcome = operatoraudit.OutcomeDenied
		s.auditWrite(r, "INCENTIVE_RULE_TOGGLE", string(ScopePayments), entry)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "rule_not_found"})
	default:
		entry.Outcome = operatoraudit.OutcomeOK
		s.auditWrite(r, "INCENTIVE_RULE_TOGGLE", string(ScopePayments), entry)
		writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "ok": true})
	}
}
