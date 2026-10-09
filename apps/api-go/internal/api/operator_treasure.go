package api

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/benefit"
	"github.com/proxy-app/proxy-api/internal/operatoraudit"
	"github.com/proxy-app/proxy-api/internal/treasure"
)

// TREASURE-002：寻宝奖品（运营）。一个奖品 = 一个咖啡店场景上的一批券（福利活动 + 福利 + 容量池一次建齐）。
//
//	GET  /v1/operator/treasure/prizes        奖品列表（含已发出多少）
//	POST /v1/operator/treasure/prizes        {sceneId, label, quota, retailValueVnd, validDays} 新建并立即生效
//	POST /v1/operator/treasure/prizes/end    {id} 结束（不再放进新箱子；已领出的券不受影响）
//
// 动的是预算（券是有成本的），要 PAYMENTS 权限并留审计。每个场景同时只有一个生效奖品。
func (s *Server) operatorTreasurePrizes(w http.ResponseWriter, r *http.Request) {
	if s.Treasure == nil {
		notConnected("寻宝奖品（没有配数据库）", "TREASURE-002")(w, r)
		return
	}
	prizes, err := s.Treasure.ListPrizes(r.Context())
	if err != nil {
		log.Printf("operator treasure prizes: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "prizes_query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "prizes": prizes,
		"notes": []string{"开箱抽中的概率 = 箱子里的券位 / 剩余开箱名额；同行加成（下单小美）在这家店的奖品还有余量时必出券"}})
}

func (s *Server) operatorTreasurePrizeCreate(w http.ResponseWriter, r *http.Request) {
	if s.Treasure == nil || s.Benefit == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "treasure_not_configured"})
		return
	}
	var body struct {
		SceneID        string `json:"sceneId"`
		Label          string `json:"label"`
		Quota          int    `json:"quota"`
		RetailValueVND int64  `json:"retailValueVnd"`
		ValidDays      int    `json:"validDays"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body) != nil || strings.TrimSpace(body.SceneID) == "" || strings.TrimSpace(body.Label) == "" || body.Quota <= 0 || body.Quota > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sceneId_label_quota_required"})
		return
	}
	operator, _ := s.operatorIdentity(r)
	entry := operatoraudit.Entry{TargetKind: "TreasurePrize", TargetID: body.SceneID, Detail: map[string]any{"label": body.Label, "quota": body.Quota}}
	campaignID, benefitID, err := s.Benefit.ProvisionCoupon(r.Context(), benefit.CouponSpec{
		OwnerType: "proxy", OwnerID: "treasure", SceneID: body.SceneID, Label: body.Label, Kind: benefit.FreeDrink,
		RetailValueMinor: body.RetailValueVND, Quota: body.Quota, ValidDays: body.ValidDays,
	})
	if err != nil {
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = err.Error()
		s.auditWrite(r, "TREASURE_PRIZE_CREATE", string(ScopePayments), entry)
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
		return
	}
	id, err := s.Treasure.CreatePrize(r.Context(), body.SceneID, campaignID, benefitID, strings.TrimSpace(body.Label), body.Quota, operator, time.Now())
	if err != nil {
		code, status := "prize_save_failed", http.StatusInternalServerError
		if errors.Is(err, treasure.ErrPrizeExists) {
			code, status = "这个场景已经有一个生效的奖品，先结束它", http.StatusConflict
		} else {
			log.Printf("operator treasure prize create: %v", err)
		}
		entry.Outcome = operatoraudit.OutcomeDenied
		entry.Detail["error"] = code
		s.auditWrite(r, "TREASURE_PRIZE_CREATE", string(ScopePayments), entry)
		writeJSON(w, status, map[string]string{"error": code})
		return
	}
	entry.Outcome = operatoraudit.OutcomeOK
	entry.Detail["campaignId"] = campaignID
	s.auditWrite(r, "TREASURE_PRIZE_CREATE", string(ScopePayments), entry)
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "id": id, "campaignId": campaignID, "benefitId": benefitID})
}

func (s *Server) operatorTreasurePrizeEnd(w http.ResponseWriter, r *http.Request) {
	if s.Treasure == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "treasure_not_configured"})
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<10)).Decode(&body) != nil || strings.TrimSpace(body.ID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id_required"})
		return
	}
	ok, err := s.Treasure.EndPrize(r.Context(), body.ID)
	entry := operatoraudit.Entry{TargetKind: "TreasurePrize", TargetID: body.ID, Outcome: operatoraudit.OutcomeOK}
	if err != nil || !ok {
		entry.Outcome = operatoraudit.OutcomeDenied
	}
	s.auditWrite(r, "TREASURE_PRIZE_END", string(ScopePayments), entry)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "prize_end_failed"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found_or_ended"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "id": body.ID})
}
