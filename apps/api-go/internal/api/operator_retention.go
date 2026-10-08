package api

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// OPS-RETENTION-001（2026-10-05）：留存与复购这一页从桩换成真读模型。
//
//	GET /v1/operator/retention
//
// 这一页最有价值的不是那几个数，而是**它拒绝给的那两个数**：
//   · 同期群留存：库里窗口内的下单人，如果有人在窗口之前也下过单，才谈得上「留存」。
//     实测这个数是 0 —— 全部下单人都是这 30 天里第一次下单的，没有前期人群可比。
//     这时候摆一个「100% 留存」不是疏忽，是编数据。
//   · 回访百分比：前一个 14 天窗口只有个位数活跃的人，算出来的百分比全是噪声，
//     所以读模型里根本没有 returnedRate 这个字段，这里只把人数摆出来。
//
// 口径（复购 = 同一需求方窗口内 ≥2 张单，不是金额复购）写在 opsmetrics.Retention 上，
// 界面照抄，不各算一遍。

func (s *Server) operatorRetention(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("留存与复购（没有配数据库）", personalizationSpec+" §17")(w, r)
		return
	}
	ret, err := s.OpsMetrics.Retention(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator retention: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "retention_query_failed"})
		return
	}
	// OPS-DATA-ENV-001：这台库连的是哪一套数据，只有部署知道。没声明成 production 就不出比率。
	//
	// 但这里刻意不把整页拒掉。两件事要分开：
	//   · 计数（「窗口内 291 张单、150 张连账号都没有」）是对行的陈述，在哪个库上都成立；
	//   · 比率（「93.8% 的人会回来」）是对业务的推断，在没有业务成色声明的库上没有来源。
	// 上一版走的是整页 NOT_CONNECTED，结果把**每一个**引用这一页的地方一起抹掉了 —— 平台总览
	// 那个复购格子连带整页内容都不显示。只让比率变成 null，界面就只在那一格显示「不给数」，
	// 别处照常，而这一页最要紧的那段说明（库里装的是什么）仍然看得见。
	ratesPublished := businessRatesPublished()
	stats := fmt.Sprintf("近 %d 天 %d 张单（请求方能追溯到账号的 %d 张、追溯不到的 %d 张）、下单人 %d 个（其中能追溯到账号的 %d 个）",
		ret.WindowDays, ret.Orders, ret.OrdersAttributable, ret.OrdersUnattributed, ret.Requesters, ret.RealRequesters)
	notes := []string{
		fmt.Sprintf("复购口径：同一个需求方在近 %d 天里下过 ≥2 张单；这不是金额复购 —— 支付没接，金额没有事实来源。", ret.WindowDays),
		// 这一条只能说它说得出的那部分：对不上账号的行一定不是业务（没人能拥有它），
		// 但对得上账号**不等于**是真人 —— 这个库里的 e2e 脚本走真 API、建真账号、下真单。
		// 上一版把它写成「真实下单人」，于是 48 个脚本账号变成了 48 个客户，复购率 93.8%。
		fmt.Sprintf("可归因性：窗口内 %d 张单里，请求方在 identity.user_accounts 里查不到的有 %d 张 —— 那些行确定不是生意，"+
			"没有账号就不可能有人下过单（订单永不硬删，测试连的就是这个库，所以它们一直留着）。分母用的是能追溯到账号的 %d 个下单人，"+
			"不是全量 %d 个 id。注意这一步只排除「连账号都没有」，排不掉脚本建的账号：业务成色要看 %s=%s。",
			ret.Orders, ret.OrdersUnattributed, ret.RealRequesters, ret.Requesters, DataEnvVar, dataEnvOrUnset()),
		fmt.Sprintf("回头找她：同一个（需求方 × 服务者）在近 %d 天里 ≥2 张单，共 %d 组。跟「%d 个重复下单的人」是两个数，几乎相等就说明复购基本发生在同一个人身上。",
			ret.WindowDays, ret.SamePairRepeatGroups, ret.RepeatRequests),
	}
	if ret.Completed < ret.Orders {
		// 「有 N 张单」很容易被读成「有 N 单生意」。状态机分布摆出来，别让它往生意上靠。
		// 这里不能直接把 map 塞进 %v —— 那会印成 map[CANCELLED:12 COMPLETED:12 ...]，
		// 是调试输出，不是给人读的说明。
		var pending []string
		for _, state := range []string{"OFFERED", "CONFIRMED", "EXECUTING"} {
			if n := ret.Lifecycle[state]; n > 0 {
				pending = append(pending, fmt.Sprintf("%s %d", state, n))
			}
		}
		notes = append(notes, fmt.Sprintf(
			"近 %d 天 %d 张单里，走完履约（COMPLETED）的是 %d 张，取消 %d 张，其余停在 %s —— 订单数不等于成交数。",
			ret.WindowDays, ret.Orders, ret.Completed, ret.Cancelled, strings.Join(pending, " / ")))
	}
	if ret.PriorWindowRequesters == 0 {
		notes = append(notes, fmt.Sprintf(
			"同期群留存这一页没有，不是漏了：窗口内 %d 个下单人里，在窗口之前下过单的是 %d 个 —— 没有前期人群就没有可比的两期，硬算出来的留存率是假的。",
			ret.Requesters, ret.PriorWindowRequesters))
	} else {
		notes = append(notes, fmt.Sprintf(
			"窗口内 %d 个下单人里有 %d 个在窗口之前也下过单 —— 这两期可以对照，但本读模型仍只报原始人数，不替界面发明一个留存率算法。",
			ret.Requesters, ret.PriorWindowRequesters))
	}
	// 每句话都得在自己的数据条件下成立：分母大的时候再说「样本太小」就成了假话。
	if ret.ActivePrev14d < 10 {
		notes = append(notes, fmt.Sprintf(
			"回访只给人数不给百分比：近 14 天活跃 %d 人、前一个 14 天活跃 %d 人、两期都活跃 %d 人 —— 分母这么小的时候任何百分比都是噪声。",
			ret.ActiveLast14d, ret.ActivePrev14d, ret.ReturnedUsers))
	} else {
		notes = append(notes, fmt.Sprintf(
			"回访人数：近 %d 天活跃 %d 人、前一个 14 天活跃 %d 人、两期都活跃 %d 人。比率不在读模型里随手相除 —— 留存率该由定义的队列算，不是拿两个数一除就叫留存。",
			ret.WindowDays/2, ret.ActiveLast14d, ret.ActivePrev14d, ret.ReturnedUsers))
	}

	// 比率是唯一被关掉的东西，而且关掉它要说得出理由、说得出这一轮查到的是哪些行。
	if !ratesPublished {
		ret.RepeatRequesterRate = nil
		notes = append([]string{businessRateRefusal(stats)}, notes...)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource":     OperatorLiveSource,
		"dataEnv":        operatorDataEnv(),
		"ratesPublished": ratesPublished,
		"windowDays":     ret.WindowDays,
		"retention":      ret,
		"notes":          notes,
	})
}
