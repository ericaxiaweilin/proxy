package matching

import "testing"

// MATCH-RANK-001：撮合排序只看履约质量 / 需求方评价 / 经验 / 响应 / 预算适配；新人有先验，不是 0 也不是满分。

func p(v float64) *float64 { return &v }

func TestReliableWellRatedProviderOutranksCheaperUnreliableOne(t *testing.T) {
	signals := map[string]Signals{
		"agent_reliable": {Completed: 12, OnTime: 11, Rated: 8, SatisfactionSum: 7.5, WouldReuse: 6},
		"agent_flaky":    {Completed: 3, Cancelled: 5, OnTime: 1, Rated: 3, SatisfactionSum: 0.5},
	}
	ranked := Rank([]string{"agent_flaky", "agent_reliable"}, map[string]int64{"agent_flaky": 800000, "agent_reliable": 1300000}, signals, 1500000)
	if ranked[0].AgentID != "agent_reliable" {
		t.Fatalf("reliability and satisfaction outweigh a lower price: %+v", ranked)
	}
}

func TestNewProviderGetsAPriorNotZeroNorPerfect(t *testing.T) {
	fresh := Score(Signals{}, 1000000, 0)
	veteran := Score(Signals{Completed: 30, OnTime: 30, Rated: 20, SatisfactionSum: 20, WouldReuse: 20}, 1000000, 0)
	broken := Score(Signals{Completed: 1, Cancelled: 9, Rated: 5}, 1000000, 0)
	if !(broken.Total < fresh.Total && fresh.Total < veteran.Total) {
		t.Fatalf("new providers sit between proven-bad and proven-good: broken=%v fresh=%v veteran=%v", broken.Total, fresh.Total, veteran.Total)
	}
	if fresh.HasTrackRecord || fresh.FulfillmentRate != 0 || fresh.SatisfactionRate != 0 {
		t.Fatalf("no record must be shown as no record, not as a made-up rate: %+v", fresh)
	}
}

func TestResponsivenessOnlyBreaksNearTies(t *testing.T) {
	base := Signals{Completed: 5, OnTime: 5, Rated: 3, SatisfactionSum: 3, WouldReuse: 2}
	online, offline := base, base
	online.ChatP60, offline.ChatP60 = p(0.9), p(0.05)
	ranked := Rank([]string{"offline", "online"}, map[string]int64{"offline": 1, "online": 1}, map[string]Signals{"online": online, "offline": offline}, 0)
	if ranked[0].AgentID != "online" {
		t.Fatalf("with equal records, the one likely to reply soon goes first: %+v", ranked)
	}
	// 但响应不能压过履约：一个马上在线但老取消的人，排不过一个稳定但暂时不在线的人。
	flakyOnline := Signals{Completed: 2, Cancelled: 6, ChatP60: p(1)}
	ranked = Rank([]string{"flaky_online", "steady_offline"}, nil, map[string]Signals{"flaky_online": flakyOnline, "steady_offline": offline}, 0)
	if ranked[0].AgentID != "steady_offline" {
		t.Fatalf("responsiveness must not outweigh reliability: %+v", ranked)
	}
}
