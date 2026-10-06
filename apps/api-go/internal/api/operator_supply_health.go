package api

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

// OPS-SUPPLY-HEALTH-001（2026-10-05）：供给健康度这一页从桩换成真读模型。
//
//	GET /v1/operator/supply-health
//
// 这一页的价值一半在数、一半在**拒绝算的那个数**：
//   · 不给供需比 —— 需求侧今天只有 54 张草稿、0 个正式任务。107 个供给除以一个 0
//     得到的任何数字都是噪声，所以把两侧的真实体量分开摆，比不比让人自己看得见。
//   · 实名核验按 agent_id 数（那 13 行里 user_account_id 全是 NULL）。按 user_account_id
//     数会得到 0，看起来像「供给方一个都没核验」，其实是列名猜错 —— 这种零比没有数更坏。
//   · 「有单的服务者」只对得上 agent_profiles 里真有的那些：fulfillment.orders.agent_id
//     历史上混写过（一部分行装的是 user_account id），不对齐就会数出比供给总数还大的数。

func (s *Server) operatorSupplyHealth(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("供给健康度（没有配数据库）", personalizationSpec+" §5 Market Graph")(w, r)
		return
	}
	sup, err := s.OpsMetrics.SupplyHealth(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator supply health: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "supply_query_failed"})
		return
	}
	notes := []string{
		fmt.Sprintf("实名核验按 agent_id 数：通过 %d、已过期 %d。这张表的 user_account_id 整列是空的 —— "+
			"按那一列数会数出 0，那不是「没人核验」，是列名错。", sup.RealNameVerified, sup.RealNameExpired),
		fmt.Sprintf("「配过时间窗」%d 人，现在还有未过期窗的只有 %d 人 —— 两个数差得远，合成一个就会骗人。",
			sup.AgentsWithAvailability, sup.AgentsWithOpenWindow),
	}
	if sup.DemandTasks == 0 {
		notes = append(notes, fmt.Sprintf(
			"这一页没有供需比，不是漏了：需求侧现在是 %d 张草稿、%d 个正式任务、%d 个同城需求 —— "+
				"分母接近 0 的时候，任何比值都是噪声。", sup.DemandTaskDrafts, sup.DemandTasks, sup.CityCompanionNeeds))
	} else {
		notes = append(notes, fmt.Sprintf(
			"需求侧有 %d 个正式任务（草稿 %d、同城需求 %d），但本读模型仍然不替界面算供需比 —— "+
				"比值要先定义清楚按什么品类、什么城市分，混在一起除没有意义。",
			sup.DemandTasks, sup.DemandTaskDrafts, sup.CityCompanionNeeds))
	}
	if sup.Agents > 0 && sup.OrdersWindow > 0 && sup.AgentsWithOrders == 0 {
		notes = append(notes, fmt.Sprintf(
			"窗口内 %d 张单，能对回 agent_profiles 的服务者是 0 —— 订单那个 agent_id 字段历史上装的多半不是档案 id，"+
				"所以这里宁可报 0 也不报一个对不上的大数。", sup.OrdersWindow))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": sup.WindowDays,
		"supply":     sup,
		"notes":      notes,
		"missingNotes": []string{
			"按品类 / 城市的供给缺口没给：那要先有稳定的品类口径，现在 agent_profiles 里没有。",
			"激活漏斗（注册→建档→配时间窗→被下单）只摆各步的原始人数，不摆转化率 —— 各步的口径不是同一批人。",
		},
	})
}
