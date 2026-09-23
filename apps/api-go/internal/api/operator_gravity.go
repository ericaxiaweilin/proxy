package api

import (
	"log"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/gravity"
)

// GRAVITY-001：运营控制台「意图与撮合」页的真实数据 —— 引力状态（spec §6-§7 / §11 / §21）。
//
//	GET  /v1/operator/gravity            每类事件 × 决策状态的人数 / 平均 P60，以及每类事件 P60 最高的前 20 人
//	POST /v1/operator/gravity/recompute  立即重算（worker 每小时也会算；开发环境没跑 worker 时用这个）
//
// 逐人数据只给运营（operatorConsole：会话 + 白名单 + ANALYTICS scope）。

var gravityEventTypes = []string{gravity.EventChatActive, gravity.EventBrowseActive, gravity.EventSceneVisit}

func (s *Server) operatorGravity(w http.ResponseWriter, r *http.Request) {
	if s.Gravity == nil {
		notConnected("引力状态（没有配数据库）", personalizationSpec+" §6 §7")(w, r)
		return
	}
	summary, err := s.Gravity.Summary(r.Context())
	if err != nil {
		log.Printf("operator gravity summary: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gravity_query_failed"})
		return
	}
	top := map[string][]gravity.State{}
	for _, eventType := range gravityEventTypes {
		rows, err := s.Gravity.Top(r.Context(), eventType, 20)
		if err != nil {
			log.Printf("operator gravity top: %v", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gravity_query_failed"})
			return
		}
		top[eventType] = rows
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":   OperatorLiveSource,
		"modelVersion": gravity.ModelVersion,
		"summary":      summary,
		"top":          top,
		"notes": []string{
			"只算数据里真有的 G1 周期事件：聊天活跃（真人自己发的消息，AI 代回复不算）、浏览活跃、场景到访",
			"ACTIVE_ORCHESTRATE 不会自动出现：还缺 §12 获得感/愤怒感防护墙和 §13 干预预算",
			"BLOCKED 不会出现：还缺 §10 负反馈熔断",
		},
	})
}

func (s *Server) operatorGravityRecompute(w http.ResponseWriter, r *http.Request) {
	if s.Gravity == nil {
		notConnected("引力状态（没有配数据库）", personalizationSpec+" §6 §7")(w, r)
		return
	}
	n, err := gravity.Recompute(r.Context(), s.Gravity, time.Now().UTC())
	if err != nil {
		log.Printf("operator gravity recompute: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gravity_recompute_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "states": n})
}
