package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

// OPS-NORTH-STAR-001（2026-10-07）：North Star 落地页（GET /v1/operator/north-star）。
//
// 这一页的四个格子（有效意图 / 成功撮合 / 完成履约 / 负反馈率）以前是 Overview.tsx 里
// 写死的常量，永远「未接入」—— 而那正好是默认落地页。现在接真读模型（opsmetrics.NorthStar），
// 但每个格子都带三样东西：**这个数是什么口径**、**哪一半没给**、**为什么**。
//
// 为什么要把「没给的那一半」也返回：这四个格子的名字都很响，运营看到「成功撮合 5」会
// 默认它就是生意上的撮合成功。而它其实是「引擎跑出了 5 批候选」。把口径写在同一个响应里，
// 数字和它的边界不会分开传播 —— 页面拆掉了，话还在。
//
// 三个 dataSource：
//
//	LIVE    —— 整格都来自真查询；
//	PARTIAL —— 有真数，但这一格**想表达的完整含义**缺一半（今天只有「成功撮合」是这样：
//	           找到供给是真的，成交归因不是）；
//	NOT_CONNECTED —— 一个数都不给（这一页今天没有这种格子；没有数据库时整页走这个）。
const (
	OperatorPartialSource = "PARTIAL"

	// negativeRateMinExposures 是算负反馈率的最小曝光数。低于它只给计数不给率：
	// 分母太小的时候任何百分比都是噪声，而「0.0%」看起来像「一切正常」，
	// 那比不给更坏。门槛写在这里，是因为它是这一页的措辞依据。
	negativeRateMinExposures = 100
)

// northStarTile 是一个格子。value 为 nil = 这一格不给数（口径或来源不成立），
// 此时 notes 必须说清为什么 —— 空着的格子必须是有原因的。
type northStarTile struct {
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	Value      *float64 `json:"value"`
	Unit       string   `json:"unit"`
	DataSource string   `json:"dataSource"`
	Definition string   `json:"definition"`
	Meta       string   `json:"meta"`
	Notes      []string `json:"notes"`
}

func floatPtr(v float64) *float64 { return &v }

// counts 拼「标签 + 数 · 标签 + 数」这种 meta 行。
func counts(labelA string, a int64, labelB string, b int64) string {
	return fmt.Sprintf("%s %d · %s %d", labelA, a, labelB, b)
}

func (s *Server) operatorNorthStar(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("North Star 四个格子（没有配数据库）", personalizationSpec+" §10 §16 §17")(w, r)
		return
	}
	ns, err := s.OpsMetrics.NorthStar(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator north-star: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "north_star_query_failed"})
		return
	}

	tiles := []northStarTile{
		// ① 有效意图（spec §17 的 intent_created）。
		intentTile(ns),
		// ② 成功撮合（§17 的 match_accept）—— PARTIAL：找到供给是真的，成交归因不是。
		matchTile(ns),
		// ③ 完成履约（§17 的 fulfillment）—— 单量真，金额没有来源。
		fulfillmentTile(ns),
		// ④ 负反馈率（§10）—— 率真，熔断没实现。
		negativeTile(ns),
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": ns.WindowDays,
		"tiles":      tiles,
	})
}

// intentTile：全量口径 —— demand.task_drafts 没有 created_at，按 updated_at 切窗口会被
// 读成「近 30 天新增意图」，那是另一个指标，所以这一格明说「全量」。
func intentTile(ns opsmetrics.NorthStar) northStarTile {
	t := northStarTile{
		Key:        "intent",
		Label:      "有效意图",
		Value:      floatPtr(float64(ns.Intent.Drafts)),
		Unit:       "条草案",
		DataSource: OperatorLiveSource,
		Definition: "澄清门产出的需求草案数（全量口径 —— demand.task_drafts 没有 created_at，给不了 30 天窗口）",
		Meta:       counts("已 COMMITTED", ns.Intent.DraftsCommitted, "canonical task", ns.Intent.CanonicalTasks),
	}
	// 草案发布（PublishTask）会同时写 demand.tasks 并把草案置 COMMITTED —— 两处应当对得上。
	// 对不上就是有草案没走发布链路。本地库实测 45 条 COMMITTED / 0 条 task：那 45 条是
	// 直接写库的 fixture，不是「漏斗正常收窄」，所以这条 note 必须出现，不能让运营
	// 看着「45 条意图、0 个任务」自己去猜是转化差还是链路断。
	if ns.Intent.DraftsCommitted != ns.Intent.CanonicalTasks {
		t.Notes = append(t.Notes, "已 COMMITTED 的草案数与 demand.tasks 的行数不一致 —— PublishTask 会同时写这两处，对不上说明有草案没经过发布链路（不是「漏斗收窄」）。")
	}
	if ns.Intent.Drafts > 0 && ns.Intent.DraftsOpen == ns.Intent.Drafts {
		t.Notes = append(t.Notes, "全部草案都停在未提交状态：澄清门还没有产出过一条走完流程的需求。")
	}
	t.Notes = append(t.Notes, "spec §16 的 intent-service 本身（澄清策略、澄清轮次）没有实现 —— 这里数的是澄清门的产出，不是它的过程。")
	return t
}

func matchTile(ns opsmetrics.NorthStar) northStarTile {
	t := northStarTile{
		Key:        "match",
		Label:      "成功撮合",
		Value:      floatPtr(float64(ns.Matching.Batches)),
		Unit:       "批候选",
		DataSource: OperatorPartialSource,
		Definition: "撮合引擎跑过的候选批次（近 30 天）—— 这是「找到了供给」，不是「撮合成功」",
		Meta:       counts("找到供给", ns.Matching.BatchesWithSupply, "供不应求", ns.Matching.ShortageBatches),
	}
	t.Notes = append(t.Notes,
		"「撮合成功」= 结果归因没有来源：outcome.* 五张表从建表起没有任何写入方，且 supply.candidate_batches.need_id 与 fulfillment.orders.need_id 不是同一套键（回连命中 0）—— 在这里算转化率得到的是断链的 0，不是生意上的 0，所以不给。")
	if ns.Matching.Batches > 0 && ns.Matching.BatchesWithSupply == 0 {
		t.Notes = append(t.Notes, "窗口内每一批候选都是空的：这不是「撮合失败率高」，是那一刻供给池里没有合格候选。")
	}
	return t
}

func fulfillmentTile(ns opsmetrics.NorthStar) northStarTile {
	f := ns.Fulfillment
	t := northStarTile{
		Key:        "fulfillment",
		Label:      "完成履约",
		Value:      floatPtr(float64(f.Completed)),
		Unit:       "单",
		DataSource: OperatorLiveSource,
		Definition: "近 30 天走到 COMPLETED 的订单（fulfillment.orders.lifecycle）",
		Meta: fmt.Sprintf("窗口内 %d 单：OFFERED %d / CONFIRMED %d / EXECUTING %d / COMPLETED %d / CANCELLED %d",
			f.Orders, f.Offered, f.Confirmed, f.Executing, f.Completed, f.Cancelled),
	}
	t.Notes = append(t.Notes, "成交额（GMV）没有事实来源：支付未接入，payment.* 全是 0 行 —— 所以这一格只给单量，不给金额。")
	if f.Orders == 0 {
		t.Notes = append(t.Notes, "窗口内一张订单都没有：0 是「查过了没有」，不是「没测」。")
	} else if f.Completed == 0 {
		t.Notes = append(t.Notes, fmt.Sprintf("窗口内 %d 张订单一张都没走到 COMPLETED —— 履约卡在 CONFIRMED（%d 单）这一档。", f.Orders, f.Confirmed))
	}
	return t
}

func negativeTile(ns opsmetrics.NorthStar) northStarTile {
	n := ns.Negative
	t := northStarTile{
		Key:        "negative",
		Label:      "负反馈率",
		DataSource: OperatorLiveSource,
		Definition: "强负反馈（举报 + 屏蔽作者）÷ 曝光（近 30 天，与行为信号同一口径）",
		Meta: fmt.Sprintf("%d 次强负向 / %d 次曝光 · 弱负向（减少推荐）%d 次",
			n.StrongNegative, n.Exposures, n.WeakNegative),
	}
	// 率只在分母够大时给。分母为 0 时不算（0/0），分母太小也不给 —— 「0.0%」会被读成
	// 「一切正常」，而事实是「样本不够，看不出来」。计数照给，所以这一格不是空的。
	if n.Exposures >= negativeRateMinExposures {
		t.Value = floatPtr(float64(n.StrongNegative) / float64(n.Exposures) * 100)
		t.Unit = "%"
	} else {
		t.Notes = append(t.Notes, fmt.Sprintf("曝光只有 %d 次，不到算率门槛（%d）—— 给一个百分比就是给噪声，所以只给计数。", n.Exposures, negativeRateMinExposures))
	}
	t.Notes = append(t.Notes, "spec §10 的熔断策略（cooldown 24h/7d/30d、merchant 永久禁触达）没有实现 —— 这一格只给率，不给熔断状态。")
	return t
}
