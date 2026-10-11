package api

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/experience/runtime"
	"github.com/proxy-app/proxy-api/internal/opsmetrics"
	"github.com/proxy-app/proxy-api/internal/tagging"
)

// OPS-CONSOLE-PAGES-001（2026-10-07）：把运营后台里**打不开**的那几页建起来。
//
// 起因：控制台有 9 个端点是 `notConnected(...)` 桩，返回 {dataSource, missing, spec}，
// 而其中 4 个页面的 JSX 直接读 `data.engine.*` / `d.safety` / `data.gates` / `d.intent_funnel`
// —— 桩根本不发这些字段，所以**这四页一打开就 TypeError 崩掉**。运营后台里它们是死的。
//
// 处理方式不是「给桩补上假字段让它不崩」（那是最省事也最坏的做法：页面会显示一排
// 看起来正常的零）。而是逐页问「这一页想说的事，库里有没有真数据」：
//
//   决策引擎   → 有。spec §11 的 Decision Eligibility 状态机在 decision.user_event_states 里。
//   信任与风险 → 有证据与处置事实，但**没有**风险分（也不给风险分）。
//   澄清门     → 有产出（demand.task_drafts），没有策略。
//   意图编排   → 有引力状态与候选批次，没有编排动作日志。
//
// 每一页的响应里都写清「给了什么、没给什么、为什么」。没给的那一半继续是 NOT_CONNECTED
// 措辞，但换成**具体的**缺什么（哪张表没有写入方、哪个键对不上），不再是笼统的模块名。

// ---------------------------------------------------------------- 决策引擎（§11）

// eligibilityFreshnessHours 超过这个小时数就提醒「状态是陈的」。
// 24h 是因为引力 worker 每小时重算一次（见 internal/gravity），一天没算就是 worker 停了。
const eligibilityFreshnessHours = 24

func (s *Server) operatorDecisionEngine(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("决策引擎（没有配数据库）", personalizationSpec+" §11 §16 §20")(w, r)
		return
	}
	now := time.Now().UTC()
	e, err := s.OpsMetrics.DecisionEligibility(r.Context(), now)
	if err != nil {
		log.Printf("operator decision-engine: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "decision_eligibility_query_failed"})
		return
	}

	notes := []string{
		"下半部分是 spec §11 的 Decision Eligibility 状态机：引力 worker 把每个人判到哪一档、证据够不够。",
	}
	// DECISION-ENGINE-001：干预决策引擎的调用面。调用量 / 延迟 / 拦截分布只从 decision.evaluations
	// 读；读不出来就给 null 并说明，不给 0（0 会被读成「引擎没被调用」）。
	var runtimeStats any
	if s.DecisionStats != nil {
		st, err := s.DecisionStats.Stats(r.Context(), now)
		if err != nil {
			log.Printf("operator decision-engine runtime: %v", err)
			notes = append(notes, "引擎调用留痕（decision.evaluations）读取失败 —— 调用量这一块不给数。")
		} else {
			runtimeStats = st
			if st.Calls == 0 {
				notes = append(notes, "近 30 天引擎没有被调用过：今天唯一的调用方是引导推送 worker（每小时一轮），没有候选人时不会调用 —— 0 是「查过了没有」。")
			}
		}
	} else {
		notes = append(notes, "决策引擎没有接库 —— 调用量这一块不给数。")
	}
	if e.ActiveOrchestrate > 0 {
		// §12/§13 不自动进入主动编排（gravity 包里有 TestNeverAutoActiveOrchestrate 钉着）。
		// 非零不是「业务变好了」，是引擎越权了 —— 必须说，不能当普通计数。
		notes = append(notes, fmt.Sprintf("出现了 %d 个 ACTIVE_ORCHESTRATE —— §12/§13 不会自动进入主动编排，这个值应当永远是 0；非零说明引擎越权了。", e.ActiveOrchestrate))
	}
	if len(e.ModelVersions) > 1 {
		notes = append(notes, fmt.Sprintf("表里同时存在 %d 个 model_version（%v）—— 运营看到的状态不是一个口径，老行没被清。", len(e.ModelVersions), e.ModelVersions))
	}
	switch {
	case e.LastComputedAt == nil:
		notes = append(notes, "一次都没重算过：引力 worker 还没跑过，这一页现在是空的而不是「全是 0」。")
	case now.Sub(*e.LastComputedAt) > eligibilityFreshnessHours*time.Hour:
		notes = append(notes, fmt.Sprintf("状态是 %s 算的（%.0f 小时前）—— 引力 worker 每小时重算一次，这么旧说明它停了。",
			e.LastComputedAt.Format(time.RFC3339), now.Sub(*e.LastComputedAt).Hours()))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"runtime":    runtimeStats,
		"states":     e.States,
		"eventTypes": e.EventTypes,
		"totals": map[string]any{
			"people":            e.TotalPeople,
			"activeOrchestrate": e.ActiveOrchestrate,
			"modelVersions":     e.ModelVersions,
			"lastComputedAt":    e.LastComputedAt,
			"firstComputedAt":   e.FirstComputedAt,
		},
		"notes": notes,
	})
}

// ---------------------------------------------------------------- 信任与风险（§9）

func (s *Server) operatorTrust(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("信任与风险（没有配数据库）", personalizationSpec+" §9 §10")(w, r)
		return
	}
	t, err := s.OpsMetrics.TrustEvidence(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator trust: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "trust_query_failed"})
		return
	}

	notes := []string{
		// 这一页原来显示的是 risk_scores: [{segment, score}] —— 逐人群的 0–1 风险分。
		// 那个数今天算不出来，编一个比没有坏得多：它会让人以为有风险模型在跑。
		"没有风险分：仓里没有任何风险模型，摆一个 score 会让人以为系统在评估风险。给的是能被数的证据与处置事实。",
		"spec §10 的负反馈熔断（negative-breaker）没有实现 —— 这一页没有熔断状态，只有负向信号的计数。",
	}
	// 本机实测最有信息量的一条：有举报、零处置。零处置不是「举报都处理完了」。
	if t.ReportsAll > 0 && t.DispositionsAll == 0 {
		notes = append(notes, fmt.Sprintf("有 %d 条举报，处置记录是 %d —— 不是「举报都处理完了」，是处置链路没接（moderation.dispositions 没有写入方）。", t.ReportsAll, t.DispositionsAll))
	}
	if t.SafetyIncidentsAll == 0 && t.SafetyBlocksAll == 0 {
		notes = append(notes, "安全事件与封禁两张表都是 0 行 —— 是「没有事故」还是「没有写入方」分不清，所以只给数，不下结论。")
	}
	if t.RealNameMissing > 0 {
		notes = append(notes, fmt.Sprintf("%d 个服务者一条实名核验记录都没有（不是过期，是从来没验过）。", t.RealNameMissing))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": t.WindowDays,
		"evidence": map[string]any{
			"agents":             t.Agents,
			"realNameVerified":   t.RealNameVerified,
			"realNameExpired":    t.RealNameExpired,
			"realNameMissing":    t.RealNameMissing,
			"capabilityVerified": t.CapabilityVerified,
		},
		"signals": map[string]any{
			"reports30d":      t.Reports30d,
			"reportsAll":      t.ReportsAll,
			"mutedAuthors30d": t.MutedAuthors30d,
			"mutedAuthorsAll": t.MutedAuthorsAll,
			"postReportsAll":  t.PostReportsAll,
		},
		"disposition": map[string]any{
			"dispositions30d":    t.Dispositions30d,
			"dispositionsAll":    t.DispositionsAll,
			"appealsAll":         t.AppealsAll,
			"safetyIncidentsAll": t.SafetyIncidentsAll,
			"safetyBlocksAll":    t.SafetyBlocksAll,
		},
		"notes": notes,
	})
}

// ---------------------------------------------------------------- 澄清门（§16）

func (s *Server) operatorClarificationGate(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("澄清门（没有配数据库）", personalizationSpec+" §16")(w, r)
		return
	}
	f, err := s.OpsMetrics.ClarificationFunnel(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator clarification-gate: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "clarification_query_failed"})
		return
	}

	notes := []string{
		// 澄清门的**策略**（追问什么、PASS / CLARIFY / BLOCK 怎么判）确实没实现。
		"澄清门的判定策略（追问什么、什么时候 PASS / CLARIFY / BLOCK）没有实现 —— 这一页数的是它的**产出**（需求草案），不是它的过程。",
		"全量口径：demand.task_drafts 没有 created_at（只有 updated_at），给不了 30 天窗口。",
	}
	if f.DraftsCommitted != f.CanonicalTasks {
		notes = append(notes, fmt.Sprintf("已 COMMITTED 的草案 %d 条，demand.tasks 只有 %d 行 —— PublishTask 会同时写这两处，对不上说明有草案没经过发布链路。", f.DraftsCommitted, f.CanonicalTasks))
	}
	// 断链要作为**数**出现：谁把键接上了，这两个数会动；谁只是改了措辞，它们不动。
	if f.Drafts > 0 && f.DraftsWithBatch == 0 {
		notes = append(notes, "没有任何一条草案的 id 出现在 supply.candidate_batches.need_id 里 —— 「澄清 → 撮合」这条链在键这一层没接上，不是转化差。")
	}
	if f.Drafts > 0 && f.DraftsWithOrder == 0 {
		notes = append(notes, "没有任何一条草案的 id 出现在 fulfillment.orders.need_id 里 —— 「澄清 → 成交」这条链在键这一层没接上。")
	}
	if f.Needs > 0 {
		notes = append(notes, fmt.Sprintf("另有 %d 条 citycompanion.needs —— 需求不只从澄清门进来，别拿草案数当需求总数。", f.Needs))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": f.WindowDays,
		"funnel": map[string]any{
			"drafts":          f.Drafts,
			"draftsOpen":      f.DraftsOpen,
			"draftsCommitted": f.DraftsCommitted,
			"canonicalTasks":  f.CanonicalTasks,
			"draftsWithBatch": f.DraftsWithBatch,
			"draftsWithOrder": f.DraftsWithOrder,
			"needs":           f.Needs,
		},
		"notes": notes,
	})
}

// ---------------------------------------------------------------- 意图编排（§6 §7 §16）
//
// 这一页不新写 SQL：引力状态走 DecisionEligibility、候选批次走 NorthStar 里已经对真库
// 验过的那一半。复用而不是再写一份，是因为「撮合批次」只有一个正确口径，写两份必漂。
func (s *Server) operatorIntentOrchestration(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("意图编排（没有配数据库）", personalizationSpec+" §6 §7 §16")(w, r)
		return
	}
	now := time.Now().UTC()
	e, err := s.OpsMetrics.DecisionEligibility(r.Context(), now)
	if err != nil {
		log.Printf("operator intent-orchestration (gravity): %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "decision_eligibility_query_failed"})
		return
	}
	ns, err := s.OpsMetrics.NorthStar(r.Context(), now)
	if err != nil {
		log.Printf("operator intent-orchestration (north star): %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "north_star_query_failed"})
		return
	}

	notes := []string{
		"这一页只有**两层**是真的：引力状态（decision.user_event_states）和候选批次（supply.candidate_batches）。",
		"spec §16.3 的编排动作（干预 / 抑制 / 排期）没有任何落库 —— 所以没有「干预了多少次」「抑制了多少人」这类数。",
		"spec §13 的干预预算、§14 的点火模型都没实现 —— 编排今天只有一个召回排序的结果，没有调度层。",
	}
	if e.ActiveOrchestrate > 0 {
		notes = append(notes, fmt.Sprintf("ACTIVE_ORCHESTRATE 有 %d 个 —— §12/§13 不自动进入主动编排，这个值应当永远是 0。", e.ActiveOrchestrate))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": ns.WindowDays,
		"gravity": map[string]any{
			"states":            e.States,
			"eventTypes":        e.EventTypes,
			"activeOrchestrate": e.ActiveOrchestrate,
			"totalPeople":       e.TotalPeople,
			"lastComputedAt":    e.LastComputedAt,
		},
		"retrieval": map[string]any{
			"batches":           ns.Matching.Batches,
			"batchesWithSupply": ns.Matching.BatchesWithSupply,
			"shortageBatches":   ns.Matching.ShortageBatches,
		},
		"exposures": ns.Negative.Exposures,
		"notes":     notes,
	})
}

// ---------------------------------------------------------------- 标签中心（§3）
//
// 这一页的名字叫「标签中心」，但**标签体系不存在**：全库只有一个名字带 tag 的列
// （supply.agent_services.vertical_tags），没有 tag / topic / category 表，
// activity.interests 是「谁对哪个活动感兴趣」的**事件表**（1 行），不是词典。
//
// 所以不给「标签热度榜」「兴趣画像」「标签关系」—— 那些要有一个标签体系才成立。
// 给的是**已落库的标签词典盘点**：7 个轴，每个轴多少词、覆盖多少主体、词表受不受控。
// 这是建 tag-service 时要接管的全部东西，也是运营今天唯一能据以判断「哪条轴能先用」的事实。

// tagTopLimit 标签云最多给多少个词。词典盘点不是排行榜，截断点要说出来（页面会显示）。
const tagTopLimit = 40

func (s *Server) operatorTags(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("标签中心（没有配数据库）", personalizationSpec+" §3")(w, r)
		return
	}
	v, err := s.OpsMetrics.TagVocabulary(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator tags: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "tag_vocabulary_query_failed"})
		return
	}

	// TAG-SYSTEM-001：标签层（用户标签）。有存储就给真实覆盖；没有就明说没接。
	var userTags any
	notes := []string{}
	if src, ok := s.TagStore.(tagging.StatsSource); ok && s.TagStore != nil {
		stats, err := src.Stats(r.Context(), time.Now().UTC())
		if err != nil {
			log.Printf("operator tags (user tags): %v", err)
			notes = append(notes, "用户标签层的统计这次没读出来（库错误），下面只有词典盘点。")
		} else {
			userTags = stats
			if stats.LastComputedAt == nil {
				notes = append(notes, "用户标签层已建好，但还没有任何标签：worker 每小时按事件重算；没有同意过的用户不会有标签，这是设计，不是故障。")
			}
		}
	} else {
		notes = append(notes, "用户标签层没有接入（没有配数据库）。")
	}
	notes = append(notes,
		"下面「词典盘点」是供给侧 / 内容侧已落库的词，不是用户标签：它回答「哪些轴可以先当标签用、哪些得先治理」。",
		"用户标签只来自两类事实：用户主动做的事（感兴趣 / 报名），和用户同意后产生的浏览 / 粗粒度位置事件；撤回同意后下一轮重算就清掉。",
	)
	if len(v.CaseCollisions) > 0 {
		notes = append(notes, fmt.Sprintf("语种大小写没归一：%s —— 同一个语种在库里算两个词（原始 %d 个 / 归一后 %d 个）。合并前别拿语种数做筛选。",
			strings.Join(v.CaseCollisions, "、"), v.LanguageRawTerms, v.LanguageNormTerms))
	}
	if v.Posts > 0 && v.ContextPosts > 0 {
		notes = append(notes, fmt.Sprintf("只有 %d/%d 条帖子带语境标签（%.1f%%）—— context_refs 绝大多数是空数组，内容侧的覆盖率还很低。",
			v.ContextPosts, v.Posts, float64(v.ContextPosts)/float64(v.Posts)*100))
	}
	if v.ContextIdTerms > 0 {
		notes = append(notes, fmt.Sprintf("context_id 有 %d 个不同的值且是自由文本（既有「日常」也有带地址的店名）—— 它不是词典，不能直接当标签用；受控的是 context_type 那一层。", v.ContextIdTerms))
	}
	if v.InterestRows < 10 {
		notes = append(notes, fmt.Sprintf("activity.interests 只有 %d 行 —— 那是「谁对哪个活动感兴趣」的事件表，不是兴趣词典；需求侧兴趣画像今天没有数据源。", v.InterestRows))
	}

	// 页面要 kpis + top_tags 两个形状（Tags.tsx 读这两个字段）。
	kpis := map[string]int64{
		"服务者":       v.Agents,
		"内容":        v.Posts,
		"轴上词数合计":    termCount(v.Terms),
		"受控轴":       countAxes(v.Axes, "controlled"),
		"自由文本轴":     countAxes(v.Axes, "free_text"),
		"未归一轴":      countAxes(v.Axes, "dirty"),
		"带语境标签的帖子":  v.ContextPosts,
		"兴趣事件":      v.InterestRows,
		"语种(原始/归一)": v.LanguageRawTerms,
	}
	top := v.Terms
	if len(top) > tagTopLimit {
		top = top[:tagTopLimit]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"kpis":       kpis,
		"top_tags":   top,
		"axes":       v.Axes,
		"userTags":   userTags,
		"totals": map[string]any{
			"agents":            v.Agents,
			"posts":             v.Posts,
			"terms":             len(v.Terms),
			"termsShown":        len(top),
			"languageRawTerms":  v.LanguageRawTerms,
			"languageNormTerms": v.LanguageNormTerms,
			"caseCollisions":    v.CaseCollisions,
			"contextPosts":      v.ContextPosts,
			"contextIdTerms":    v.ContextIdTerms,
			"interestRows":      v.InterestRows,
		},
		"notes": notes,
	})
}

func termCount(terms []opsmetrics.TagTerm) int64 { return int64(len(terms)) }

func countAxes(axes []opsmetrics.TagAxis, vocabulary string) int64 {
	var n int64
	for _, a := range axes {
		if a.Vocabulary == vocabulary {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------- 数据治理（§9.1 §9.4）

// dataQualityMaxSkewSeconds：client_time 与服务端 created_at 差超过这个数就算时钟偏差。
// 5 分钟 —— 移动端 NTP 漂移通常远小于这个数；超过它的更像手工造的种子或坏设备。
const dataQualityMaxSkewSeconds = 300

func (s *Server) operatorDataQuality(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("数据治理（没有配数据库）", personalizationSpec+" §9.1 §9.4")(w, r)
		return
	}
	q, err := s.OpsMetrics.DataQuality(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator quality: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "data_quality_query_failed"})
		return
	}

	notes := []string{
		"这一页是曝光谱系的体检报告：每个谱系列的非空率、谁在产生事件。谱系断在哪，治理就从哪开始。",
		"没有谱系图、没有数据修复操作 —— 谱系图要 request_id 先接上才画得出来；这一页只报告，不动数据。",
	}
	// 按 field 找全量口径的覆盖，挑出最有信息量的三条讲成话。
	byField := map[string]opsmetrics.FieldCoverage{}
	for _, f := range q.Lineage {
		if f.Window == "all" {
			byField[f.Field] = f
		}
	}
	if f, ok := byField["recommendation_request_id"]; ok && f.Total > 0 && f.Filled == 0 {
		notes = append(notes, fmt.Sprintf("recommendation_request_id 的非空率是 0（%d 条事件）—— 没有任何一条曝光能追回「哪次推荐请求把它排出来」。§9.4 的污染风险、§17 的归因全部卡在这一列。", f.Total))
	}
	if f, ok := byField["candidate_source"]; ok && f.Total > 0 && f.Coverage < 0.05 {
		notes = append(notes, fmt.Sprintf("candidate_source 只有 %.1f%% 写了通道（unknown 不算值）—— 连「这条候选从哪来」都没记。", f.Coverage*100))
	}
	serverShare := int64(0)
	for _, d := range q.EventSource {
		if d.Value == "server" {
			serverShare = d.Count
		}
	}
	if q.EventsAll > 0 && serverShare > q.EventsAll/2 {
		notes = append(notes, fmt.Sprintf("%d/%d 条事件是 server 生成的 —— 真实客户端遥测基本没在流。样本量不治理，行为指标都是自说自话。", serverShare, q.EventsAll))
	}
	if q.DuplicateEventIds > 0 {
		notes = append(notes, fmt.Sprintf("有 %d 条重复 event_id —— 上游在重发，去重口径要先定。", q.DuplicateEventIds))
	}
	if q.SkewOver5Min > 0 {
		notes = append(notes, fmt.Sprintf("%d 条事件 client_time 与服务端差超过 5 分钟（最大 %.0f 秒）—— 按客户端时间切窗口会串天。", q.SkewOver5Min, q.MaxSkewSeconds))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": q.WindowDays,
		"events": map[string]any{
			"window":              q.EventsWindow,
			"all":                 q.EventsAll,
			"skewSecondsOver5Min": q.SkewOver5Min,
			"maxSkewSeconds":      q.MaxSkewSeconds,
			"duplicateEventIds":   q.DuplicateEventIds,
		},
		"lineage":          q.Lineage,
		"candidate_source": q.CandidateSource,
		"event_source":     q.EventSource,
		"event_types":      q.EventTypes,
		"notes":            notes,
	})
}

// ---------------------------------------------------------------- 归因链（§17 §18）
//
// 不给逐单明细表（attribution: [{order_id, decision_id, ...}]）—— 链在键这层没接上，
// 明细表今天造不出来。给的是三段键审计，每段一个数（见 opsmetrics/attributionaudit.go）。
func (s *Server) operatorAttributionAudit(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("决策 → 曝光 → 结果 归因链（没有配数据库）", personalizationSpec+" §17 §18")(w, r)
		return
	}
	a, err := s.OpsMetrics.AttributionAudit(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator fulfillment-attribution: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "attribution_audit_query_failed"})
		return
	}

	notes := []string{
		"这一页不给逐单归因明细 —— decision→曝光→撮合→成交的链在键这一层没接上，明细表今天造不出来。",
		"给的是三段键审计：每段一个数。谁把键接上了，对应的数就会动；改措辞它们不会动。",
	}
	if a.EventsAll > 0 && a.EventsAttributable == 0 {
		notes = append(notes, "段一断：没有任何一条曝光带 recommendation_request_id —— 曝光追不回推荐请求，这一段接不上，后面全免谈。")
	}
	if a.BatchesWithNeedId > 0 && a.OrdersWithNeedId > 0 && a.KeysJoined == 0 {
		notes = append(notes, fmt.Sprintf("段二断：撮合批次有 %d 个 need_id、订单有 %d 个 need_id，交集是 0 —— 两边不是同一套键。", a.BatchesWithNeedId, a.OrdersWithNeedId))
	}
	if a.OutcomeRows == 0 {
		notes = append(notes, "段三断：outcome.* 五张表从建表起没有任何写入方 —— 结果没有事实来源。")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"windowDays": a.WindowDays,
		"segments": map[string]any{
			"decisionToExposure": map[string]any{
				"events":       a.EventsAll,
				"attributable": a.EventsAttributable,
			},
			"matchingToOrder": map[string]any{
				"batches":         a.BatchesAll,
				"batchesWithNeed": a.BatchesWithNeedId,
				"orders":          a.OrdersAll,
				"ordersWithNeed":  a.OrdersWithNeedId,
				"joinedKeys":      a.KeysJoined,
			},
			"outcome": map[string]any{
				"rows": a.OutcomeRows,
			},
		},
		"notes": notes,
	})
}

// ---------------------------------------------------------------- 引擎 API（§20）
//
// 「API / Runtime」页。原来是 notConnected 桩（理由：/v1/decisions/evaluate 没注册）。
// 现在 evaluate 真注册了（POST，见 decisions_evaluate.go），这一页给三样真东西：
//
//	① 端点清单 —— evaluate 已上线（live:true），experience 三件套也在跑（但输入是固定快照，
//	   这一点写明，不冒充已接 Context Field store）；
//	② 引擎状态机 —— 复用 DecisionEligibility 的真数据（§11 档位 + 人数 + 新鲜度），
//	   不另写一份 SQL：撮合口径写两份必漂；
//	③ runtime 配置 —— 预算 / 节流 / 通道策略（experience/runtime 包的真实常量）。
func (s *Server) operatorEngineAPI(w http.ResponseWriter, r *http.Request) {
	if s.OpsMetrics == nil {
		notConnected("引擎 API（没有配数据库）", personalizationSpec+" §20")(w, r)
		return
	}
	e, err := s.OpsMetrics.DecisionEligibility(r.Context(), time.Now().UTC())
	if err != nil {
		log.Printf("operator engine-api: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "decision_eligibility_query_failed"})
		return
	}
	budget := runtime.DefaultBudget()

	notes := []string{
		"evaluate 已上线：POST /v1/decisions/evaluate（带认证 + 按 actor 限流）。判定内核目前只有 §20 暴雨规则 —— NO_UI_CHANGE 多数时候是「规则没覆盖」。",
		"experience/surface · delta · metrics 在跑，但输入是**固定快照**（ctx_1842 演示），Context Field store 未接 —— 不冒充已接真数据。",
		"spec §20 的其余端点（feedback 回路、exposure 计量）没有实现 —— 这一页只列真实存在的。",
	}
	if e.LastComputedAt != nil && time.Since(*e.LastComputedAt) > eligibilityFreshnessHours*time.Hour {
		notes = append(notes, fmt.Sprintf("引擎状态是 %s 算的 —— 引力 worker 每小时重算，这么旧说明它停了。", e.LastComputedAt.Format(time.RFC3339)))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"dataSource": OperatorLiveSource,
		"endpoints": []map[string]any{
			{"method": "POST", "path": "/v1/decisions/evaluate", "live": true,
				"desc": "引擎判定入口：ContextSnapshot 进，ExperienceIntent 或 NO_UI_CHANGE 出"},
			{"method": "GET", "path": "/v1/experience/surface", "live": true,
				"desc": "Surface 编译（固定快照演示）"},
			{"method": "GET", "path": "/v1/experience/delta", "live": true,
				"desc": "Delta 增量补丁（固定快照演示）"},
			{"method": "GET", "path": "/v1/experience/metrics", "live": true,
				"desc": "编译 / 回退 / 拒绝 计数"},
		},
		"state_lifecycle": map[string]any{
			"states":         e.States,
			"totalPeople":    e.TotalPeople,
			"lastComputedAt": e.LastComputedAt,
			"policyVersion":  "rain_rule_v1",
		},
		"runtime": map[string]any{
			"budget": map[string]any{
				"max_schema_payload_bytes": budget.MaxSchemaPayloadBytes,
				"max_delta_payload_bytes":  budget.MaxDeltaPayloadBytes,
				"max_nodes":                budget.MaxNodes,
				"max_images":               budget.MaxImages,
			},
			"channel_policy": map[string]any{
				"soft_nudge_push_allowed": runtime.IsChannelAllowed("SOFT_NUDGE", "PUSH"),
				"active_push_allowed":     runtime.IsChannelAllowed("ACTIVE", "PUSH"),
			},
		},
		"notes": notes,
	})
}

var _ = opsmetrics.DecisionEligibility{}
