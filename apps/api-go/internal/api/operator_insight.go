package api

import (
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/proxy-app/proxy-api/internal/insight"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// OPS-INSIGHT-001（2026-10-08）：「了解用户、辅助小美撮合」两页的读模型。
//
//	GET /v1/operator/demand-gap?days=30        需求画像与供需缺口
//	GET /v1/operator/insights?axis=&withAxis=&withValue=   基于标签的分群洞察
//
// 两条规矩写在响应里（notes），页面照着显示：
//   - 不给供需比，两侧体量并排；
//   - 分群数字少于 5 人一律抑制（insight.MinCell）——少于几个人的分群等于在指认个人。

func (s *Server) operatorDemandGap(w http.ResponseWriter, r *http.Request) {
	if s.Insight == nil {
		notConnected("需求画像与供需缺口（没有配数据库）", personalizationSpec+" §5")(w, r)
		return
	}
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	gap, err := s.Insight.DemandGap(r.Context(), time.Now().UTC(), days)
	if err != nil {
		log.Printf("operator demand gap: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "demand_gap_query_failed"})
		return
	}
	notes := []string{
		"只统计公开发出的单；点名邀约的私单（本窗口 " + strconv.Itoa(gap.Directed) + " 张）不算「没人接」，单独不计入。",
		"这一页不给供需比：需求和供给分别按「片区」并排给出，比值要先定义按什么品类分，混在一起除没有意义。",
		"片区是 0.1° 网格（约 11km），不是行政区；供给只数有坐标且不是草稿的接单资料。",
	}
	if gap.NoLocation > 0 {
		notes = append(notes, strconv.Itoa(gap.NoLocation)+" 张单发出时没带坐标，进不了「哪一片缺人」——这里数出来，不悄悄丢掉。")
	}
	if gap.Funnel.Published == 0 {
		notes = append(notes, "窗口内没有公开发出的单：下面全是空，不是故障。")
	}
	writeJSON(w, http.StatusOK, map[string]any{"dataSource": OperatorLiveSource, "demand": gap, "notes": notes})
}

func (s *Server) operatorInsights(w http.ResponseWriter, r *http.Request) {
	if s.Insight == nil {
		notConnected("用户洞察（没有配数据库）", personalizationSpec+" §3")(w, r)
		return
	}
	q := r.URL.Query()
	axis, withAxis, withValue := q.Get("axis"), q.Get("withAxis"), q.Get("withValue")
	for _, a := range []string{axis, withAxis} {
		if a == "" {
			continue
		}
		if _, ok := tagging.LookupAxis(a); !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_tag_axis"})
			return
		}
	}
	if (withAxis == "") != (withValue == "") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "with_axis_and_value_go_together"})
		return
	}
	seg, err := s.Insight.Segments(r.Context(), time.Now().UTC(), axis, withAxis, withValue)
	if err != nil {
		log.Printf("operator insights: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "insights_query_failed"})
		return
	}
	axes := make([]map[string]string, 0, len(tagging.Axes()))
	for _, a := range tagging.Axes() {
		axes = append(axes, map[string]string{"axis": a.Axis, "label": a.Label, "polarity": a.Polarity})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"segments":   seg,
		"axes":       axes,
		"minCell":    insight.MinCell,
		"notes": []string{
			"任何少于 " + strconv.Itoa(insight.MinCell) + " 人的格子不显示人数（只说被抑制）：少于几个人的分群等于在指认个人。",
			"覆盖的分母是近 30 天有过行为或下过单的人，不含从没动过的账号；没有标签的人多半是还没同意浏览、也还没做过主动行为。",
		},
	})
}
