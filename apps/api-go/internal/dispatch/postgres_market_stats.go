package dispatch

import (
	"context"
	"time"
)

// MARKET-FAST-001：市场发单看板的读模型（只有 kind='MARKET' 的 run，不含需求档位的 TASK 单）。
//
// 派单工作台看的是「现在卡在哪」（逐条 run + 流水）；这一页看的是「快速发单到底行不行」：
// 平台代选出去的单有多少成得了、等人报名等多久、代选的人 5 分钟内接不接、没人报名时主动
// 邀请附近的人有没有用。
//
// 一个原则跟 Stats 一样，也跟这个仓库里所有读模型一样：**算不出来就是 null，绝不是 0**。
// 分母是 0 的时候返回 JSON null，界面显示「—」；把「没有可成单的样本」显示成「确认率 0%」
// 是编数据 —— 它会让运营以为快速发单一单都没成，而真相是这段时间根本没单跑完。
// 比率一律是 0..1 的分数（0.42），百分比由界面乘 100，口径写在 MarketStats 的字段注释里。

// MarketStats 是窗口内 kind='MARKET' 的派单表现。字段与口径一一对应，界面照抄，不各算一遍。
type MarketStats struct {
	// Runs 四个状态各有多少条 run（窗口内建的）。
	Running   int `json:"running"`
	Assigned  int `json:"assigned"`
	Exhausted int `json:"exhausted"`
	Cancelled int `json:"cancelled"`
	// WaitingForApplicants：还在 RUNNING 且 waiting = true —— 平台已经把可选的人都试过了，
	// 现在纯粹在等人报名。这是「市场单没人接」最直接的那个信号。
	WaitingForApplicants int `json:"waitingForApplicants"`
	// ConfirmRate = assigned / (assigned + exhausted + cancelled)：跑到终态的单里成得了多少。
	// 分母为 0（窗口内没有一条单走到终态）时是 nil。
	ConfirmRate *float64 `json:"confirmRate"`
	// MedianMinutesToAssign：窗口内每条 run 的「第一条 ACCEPTED 流水时刻 - 建单时刻」的中位数（分钟）。
	// 没有一条被接过就是 nil（不是 0：0 分钟是假的，而且会被读成「接得飞快」）。
	MedianMinutesToAssign *float64 `json:"medianMinutesToAssign"`
	// Selections = 代选出去的次数（OFFER_SENT 流水条数，一张单被顺延多次就多次）；
	// Expired = 其中 5 分钟内没被确认而顺延的次数（EXPIRED）。
	Selections int `json:"selections"`
	Expired    int `json:"expired"`
	// ExpiryRate = expired / selections。Selections = 0 时是 nil。
	// 分母是次数不是单数：一个被顺延三次的单在分母里算三次 —— 这正是「代选效率」问的是次数。
	ExpiryRate *float64 `json:"expiryRate"`
	// Invitations = 主动邀请的轮数（INVITED 流水条数）；InvitedPeople = 这些轮次里被邀到的人次之和
	// （同一个人可能被多张单邀到，重复计；「同一个人不邀第二次」是单条 run 内的保证）。
	Invitations   int `json:"invitations"`
	InvitedPeople int `json:"invitedPeople"`
	// InviteSkipped：邀请不了的原因 → 次数（INVITE_SKIPPED 流水按 detail.reason 分组）。
	// 空 map 序列化成 {} 而不是 null：契约说的是「原因 → 次数」，没有原因就是空集合。
	InviteSkipped map[string]int `json:"inviteSkipped"`
	// InvitedThenApplied：被邀到的人里，后来真的报名了这份需求的人数（按去重后的（需求，被邀人）对算）。
	// 一个人被多张单邀到、其中一张报了名，算一对。这一条是「主动邀请到底有没有用」的唯一事实来源。
	InvitedThenApplied *int `json:"invitedThenApplied"`
	// InvitedThenAppliedRate = invitedThenApplied / invitedPeople（分数）。InvitedPeople = 0 时是 nil。
	InvitedThenAppliedRate *float64 `json:"invitedThenAppliedRate"`
	// OwnerTookOver：发单方自己动手选了人、平台停手的次数（OWNER_TOOK_OVER）。
	// 它越高说明平台代选越不顶用，或者发单方根本不放心让平台选。
	OwnerTookOver int       `json:"ownerTookOver"`
	Since         time.Time `json:"since"`
}

func ratio(num, den int) *float64 {
	if den <= 0 {
		return nil
	}
	v := float64(num) / float64(den)
	return &v
}

// MarketStats 一次只发一组查询（每组一条，全部参数化），不拼字符串。
// 每个数只来自 dispatch.runs / dispatch.steps / marketplace.applications；没有估算、没有缓存。
func (p *Postgres) MarketStats(ctx context.Context, since time.Time) (MarketStats, error) {
	s := MarketStats{Since: since, InviteSkipped: map[string]int{}}

	// ① run 侧：状态分布 + 等人报名 + 中位成单时长。
	// 中位数只取每条 run 的第一条 ACCEPTED（同一张单被接两次是不该发生的事，取第一条，
	// 第二次会把这张单的时长缩成 0 —— 和上面「中位数不是 0」是同一条理由）。
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE r.status = 'RUNNING'), COUNT(*) FILTER (WHERE r.status = 'ASSIGNED'),
			COUNT(*) FILTER (WHERE r.status = 'EXHAUSTED'), COUNT(*) FILTER (WHERE r.status = 'CANCELLED'),
			COUNT(*) FILTER (WHERE r.status = 'RUNNING' AND r.waiting),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.at - r.created_at)) / 60)
				FILTER (WHERE a.at IS NOT NULL)
		FROM dispatch.runs r
		LEFT JOIN LATERAL (SELECT at FROM dispatch.steps st WHERE st.run_id = r.id AND st.kind = 'ACCEPTED' ORDER BY id LIMIT 1) a ON true
		WHERE r.kind = $2 AND r.created_at >= $1`, since, KindMarket).
		Scan(&s.Running, &s.Assigned, &s.Exhausted, &s.Cancelled, &s.WaitingForApplicants, &s.MedianMinutesToAssign); err != nil {
		return s, err
	}
	s.ConfirmRate = ratio(s.Assigned, s.Assigned+s.Exhausted+s.Cancelled)

	// ② 流水侧（这批 run 的）：代选次数 / 超时次数 / 邀请轮数 / 被邀人次 / 发单方自己选人。
	// detail->'invitees' 可能不是数组（一行脏数据不该让整页报错），所以走 jsonb_array_length
	// 的 COALESCE：不是数组时 jsonb_array_length 返回 NULL，被 COALESCE 记成 0。
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE st.kind = 'OFFER_SENT'),
			COUNT(*) FILTER (WHERE st.kind = 'EXPIRED'),
			COUNT(*) FILTER (WHERE st.kind = 'INVITED'),
			COALESCE(SUM(jsonb_array_length(st.detail->'invitees')) FILTER (WHERE st.kind = 'INVITED'), 0),
			COUNT(*) FILTER (WHERE st.kind = 'OWNER_TOOK_OVER')
		FROM dispatch.steps st
		JOIN dispatch.runs r ON r.id = st.run_id
		WHERE r.kind = $2 AND r.created_at >= $1`, since, KindMarket).
		Scan(&s.Selections, &s.Expired, &s.Invitations, &s.InvitedPeople, &s.OwnerTookOver); err != nil {
		return s, err
	}
	s.ExpiryRate = ratio(s.Expired, s.Selections)

	// ③ 邀请失败的原因分布：运营要区分「这张单没坐标」和「附近真没人」，两者的处置完全不同。
	rows, err := p.pool.Query(ctx, `
		SELECT COALESCE(st.detail->>'reason', ''), COUNT(*)
		FROM dispatch.steps st
		JOIN dispatch.runs r ON r.id = st.run_id
		WHERE r.kind = $2 AND r.created_at >= $1 AND st.kind = 'INVITE_SKIPPED'
		GROUP BY 1`, since, KindMarket)
	if err != nil {
		return s, err
	}
	for rows.Next() {
		var reason string
		var n int
		if err := rows.Scan(&reason, &n); err != nil {
			rows.Close()
			return s, err
		}
		s.InviteSkipped[reason] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return s, err
	}

	// ④ 被邀的人后来有没有真的报名：展开每条 run 的 invited（JSONB 数组），按（需求，被邀人）去重，
	// 再问 marketplace.applications 里有没有这一对（opportunity_id = run.task_id）。
	// 用 applicant_id 列而不是 payload->>'applicantId'：这一列就是写那一行时的 applicant_id，
	// 并且被 UNIQUE(opportunity_id, applicant_id) 守着 —— payload 是它的副本，拿副本当连接键
	// 只会多一次 JSON 解析，还会漏掉没有 applicantId 字段的历史行。
	// 没人被邀过 → nil（不是 0：0 会被读成「邀了 0 人里 0 人报名」）。
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM (
			SELECT DISTINCT r.task_id, inv.person
			FROM dispatch.runs r
			CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(r.invited, '[]'::jsonb)) AS inv(person)
			WHERE r.kind = $2 AND r.created_at >= $1
		) invited
		WHERE EXISTS (
			SELECT 1 FROM marketplace.applications a
			WHERE a.opportunity_id = invited.task_id AND a.applicant_id = invited.person
		)`, since, KindMarket).Scan(&s.InvitedThenApplied); err != nil {
		return s, err
	}
	if s.InvitedPeople == 0 {
		s.InvitedThenApplied = nil
	}
	if s.InvitedThenApplied == nil {
		s.InvitedThenAppliedRate = nil
	} else {
		s.InvitedThenAppliedRate = ratio(*s.InvitedThenApplied, s.InvitedPeople)
	}
	return s, nil
}
