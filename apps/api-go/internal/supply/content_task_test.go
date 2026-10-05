package supply

import (
	"encoding/json"
	"testing"

	"github.com/proxy-app/proxy-api/internal/command"
)

// CONTENT-TASK-001：内容任务 = UGC 邀约 + 稿件 / 审核 / 发布链接。
// 钉住：阶段由邀约 + 任务推出来；交稿只能 creator 本人、接单之后；审核只能本店、
// 自动项（站外联系方式）以服务端扫描为准；打回必须写原因；发布链接只认平台自己的域名；
// 催一下 24 小时一次。

func contentCmd(t *testing.T, s *Service, cmd string, payload map[string]any, principalID, merchantID string) command.Result {
	t.Helper()
	env := envelopeForPrincipal(cmd, payload, "", principalID)
	if merchantID != "" {
		env.AuthContext = map[string]any{"merchantID": merchantID}
	}
	return s.Handle(env)
}

func decodeRef(t *testing.T, r command.Result, into any) {
	t.Helper()
	if err := json.Unmarshal([]byte(r.OperationRef), into); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

type contentListView struct {
	Tasks  []ContentTaskView `json:"tasks"`
	Counts ContentTaskCounts `json:"counts"`
}

func merchantContentList(t *testing.T, s *Service, merchantID string) contentListView {
	t.Helper()
	r := contentCmd(t, s, "ListMerchantContentTasks", map[string]any{}, "", merchantID)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("list: %s %+v", r.Outcome, r.Error)
	}
	var v contentListView
	decodeRef(t, r, &v)
	return v
}

func createTask(t *testing.T, s *Service, agentID, merchantID string) ContentTask {
	t.Helper()
	r := contentCmd(t, s, "CreateContentTask", map[string]any{
		"agentId": agentID, "title": "二层包厢初体验", "brief": "拍出二层包厢的光线",
		"platforms": []string{"tiktok", "instagram"}, "priceMinVnd": 500000, "priceMaxVnd": 900000, "negotiable": true,
	}, "", merchantID)
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("create: %s %+v", r.Outcome, r.Error)
	}
	var v struct {
		Task ContentTask `json:"task"`
	}
	decodeRef(t, r, &v)
	return v.Task
}

func stageOf(t *testing.T, s *Service, merchantID, taskID string) string {
	t.Helper()
	for _, v := range merchantContentList(t, s, merchantID).Tasks {
		if v.ID == taskID {
			return v.Stage
		}
	}
	t.Fatalf("task %s not listed", taskID)
	return ""
}

func TestContentTaskLifecycle(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_an", "An", []string{"VI"}, "hn", 900000)
	task := createTask(t, s, "agent_an", "m1")
	if got := stageOf(t, s, "m1", task.ID); got != StageAwaiting {
		t.Fatalf("new task stage = %s, want AWAITING", got)
	}
	// 没接单不能交稿。
	draft := map[string]any{"taskId": task.ID, "mediaAssetIds": []string{"ma_1"}, "caption": "二层好安静", "durationSec": 42}
	if r := contentCmd(t, s, "SubmitContentDraft", draft, "agent_an", ""); r.Outcome == "ACCEPTED" {
		t.Fatal("draft before accepting must be rejected")
	}
	if outcome, _ := respondAs(t, s, map[string]any{"invitationId": task.InvitationID, "decision": "ACCEPTED"}, "agent_an", ""); outcome != "ACCEPTED" {
		t.Fatalf("accept: %s", outcome)
	}
	if got := stageOf(t, s, "m1", task.ID); got != StageShooting {
		t.Fatalf("after accept stage = %s, want SHOOTING", got)
	}
	// 别人不能替她交稿。
	if r := contentCmd(t, s, "SubmitContentDraft", draft, "agent_other", ""); r.Outcome == "ACCEPTED" {
		t.Fatal("other principal must not submit")
	}
	if r := contentCmd(t, s, "SubmitContentDraft", draft, "agent_an", ""); r.Outcome != "ACCEPTED" {
		t.Fatalf("submit: %s %+v", r.Outcome, r.Error)
	}
	if got := stageOf(t, s, "m1", task.ID); got != StageInReview {
		t.Fatalf("after submit stage = %s, want IN_REVIEW", got)
	}
	// 别家店不能审；打回必须写原因。
	reject := map[string]any{"taskId": task.ID, "decision": "REJECT"}
	if r := contentCmd(t, s, "ReviewContentDraft", reject, "", "m_other"); r.Outcome == "ACCEPTED" {
		t.Fatal("other merchant must not review")
	}
	if r := contentCmd(t, s, "ReviewContentDraft", reject, "", "m1"); r.Outcome == "ACCEPTED" {
		t.Fatal("reject without note must fail")
	}
	reject["note"] = "门店招牌没拍到"
	if r := contentCmd(t, s, "ReviewContentDraft", reject, "", "m1"); r.Outcome != "ACCEPTED" {
		t.Fatalf("reject: %s %+v", r.Outcome, r.Error)
	}
	if got := stageOf(t, s, "m1", task.ID); got != StageShooting {
		t.Fatalf("after reject stage = %s, want SHOOTING (重拍)", got)
	}
	// 重交 → 通过（三项人工勾选缺一不可）。
	if r := contentCmd(t, s, "SubmitContentDraft", draft, "agent_an", ""); r.Outcome != "ACCEPTED" {
		t.Fatalf("resubmit: %s", r.Outcome)
	}
	approve := map[string]any{"taskId": task.ID, "decision": "APPROVE", "checks": map[string]any{"storeClear": true, "matchesReality": true}}
	if r := contentCmd(t, s, "ReviewContentDraft", approve, "", "m1"); r.Outcome == "ACCEPTED" {
		t.Fatal("approve with incomplete checks must fail")
	}
	approve["checks"] = map[string]any{"storeClear": true, "matchesReality": true, "noCompetitor": true, "noContact": false}
	r := contentCmd(t, s, "ReviewContentDraft", approve, "", "m1")
	if r.Outcome != "ACCEPTED" {
		t.Fatalf("approve: %s %+v", r.Outcome, r.Error)
	}
	var reviewed struct {
		Task ContentTask `json:"task"`
	}
	decodeRef(t, r, &reviewed)
	if !reviewed.Task.Review.Checks.NoContact || reviewed.Task.Draft.Round != 2 {
		t.Fatalf("server must compute noContact itself and count rounds: %+v %+v", reviewed.Task.Review, reviewed.Task.Draft)
	}
	if got := stageOf(t, s, "m1", task.ID); got != StageApproved {
		t.Fatalf("after approve stage = %s, want APPROVED", got)
	}
	// 发布链接只认平台域名。
	bad := map[string]any{"taskId": task.ID, "platform": "tiktok", "url": "https://evil.example/tiktok.com/v/1"}
	if r := contentCmd(t, s, "AddContentPublication", bad, "agent_an", ""); r.Outcome == "ACCEPTED" {
		t.Fatal("foreign host must be rejected")
	}
	good := map[string]any{"taskId": task.ID, "platform": "tiktok", "url": "https://www.tiktok.com/@an_hanoi/video/1"}
	if r := contentCmd(t, s, "AddContentPublication", good, "agent_an", ""); r.Outcome != "ACCEPTED" {
		t.Fatalf("publish: %s %+v", r.Outcome, r.Error)
	}
	list := merchantContentList(t, s, "m1")
	if list.Tasks[0].Stage != StagePublished || list.Counts.Published != 1 || len(list.Tasks[0].Publications) != 1 {
		t.Fatalf("published view wrong: %+v counts %+v", list.Tasks[0].Stage, list.Counts)
	}
	if list.Tasks[0].CreatorName != "An" {
		t.Fatalf("creator name = %q", list.Tasks[0].CreatorName)
	}
}

func TestContentReviewBlocksOffPlatformContact(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_c", "C", []string{"VI"}, "hn", 900000)
	task := createTask(t, s, "agent_c", "m1")
	respondAs(t, s, map[string]any{"invitationId": task.InvitationID, "decision": "ACCEPTED"}, "agent_c", "")
	contentCmd(t, s, "SubmitContentDraft", map[string]any{"taskId": task.ID, "mediaAssetIds": []string{"ma_1"}, "caption": "订位加 zalo 0912 345 678"}, "agent_c", "")
	r := contentCmd(t, s, "ReviewContentDraft", map[string]any{"taskId": task.ID, "decision": "APPROVE",
		"checks": map[string]any{"storeClear": true, "matchesReality": true, "noCompetitor": true, "noContact": true}}, "", "m1")
	if r.Outcome == "ACCEPTED" || r.Error == nil || r.Error.ErrorCode != "CONTENT_HAS_CONTACT" {
		t.Fatalf("caption with contact must block approval (client claim ignored): %s %+v", r.Outcome, r.Error)
	}
}

func TestContentNudgeOncePerDayAndOnlyWhileWaiting(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_n", "N", []string{"VI"}, "hn", 900000)
	task := createTask(t, s, "agent_n", "m1")
	nudge := map[string]any{"taskId": task.ID}
	if r := contentCmd(t, s, "NudgeContentTask", nudge, "", "m1"); r.Outcome != "ACCEPTED" {
		t.Fatalf("nudge: %s %+v", r.Outcome, r.Error)
	}
	r := contentCmd(t, s, "NudgeContentTask", nudge, "", "m1")
	if r.Outcome == "ACCEPTED" || r.Error.ErrorCode != "CONTENT_NUDGE_TOO_SOON" {
		t.Fatalf("second nudge must be throttled: %s %+v", r.Outcome, r.Error)
	}
	if v := merchantContentList(t, s, "m1").Tasks[0]; v.CanNudge {
		t.Fatal("canNudge must be false inside the cooling window")
	}
}

// 普通「邀请合作」选了 UGC 目的，也会出现在内容任务里（同一条邀约管线，不另起）。
func TestPlainUGCInvitationShowsUpAsContentTask(t *testing.T) {
	s := New()
	setupAgent(t, s, "agent_p", "P", []string{"VI"}, "hn", 900000)
	inviteAs(t, s, invitePayload("agent_p"), "m1")
	list := merchantContentList(t, s, "m1")
	if len(list.Tasks) != 1 || list.Tasks[0].Brief != "周末探店合作" || list.Counts.Awaiting != 1 {
		t.Fatalf("UGC invitation should surface as a task: %+v", list)
	}
	// 再列一次不重复补。
	if again := merchantContentList(t, s, "m1"); len(again.Tasks) != 1 {
		t.Fatalf("ensure must be idempotent, got %d", len(again.Tasks))
	}
	// creator 侧只看已接单的；待接单在「收到的合作邀请」处理。
	r := contentCmd(t, s, "ListMyContentTasks", map[string]any{}, "agent_p", "")
	var mine contentListView
	decodeRef(t, r, &mine)
	if len(mine.Tasks) != 0 {
		t.Fatalf("creator list should hide awaiting tasks, got %d", len(mine.Tasks))
	}
}

func TestCaptionContactScan(t *testing.T) {
	for _, c := range []string{"加我 zalo", "call 0912.345.678", "微信 abc", "看 https://x.y", "+84 912 345 678"} {
		if !captionHasContact(c) {
			t.Errorf("should flag %q", c)
		}
	}
	for _, c := range []string{"二层包厢 30 秒看懂菜单 @threebeans", "周末夜宵地图，第 5 站", "Cà phê 45k"} {
		if captionHasContact(c) {
			t.Errorf("should not flag %q", c)
		}
	}
}

// 催一下 / 审核结果的事件必须真的落进仓（Postgres 是 outbox）—— 只放在命令结果里没人投递，
// 商家看到「已提醒」而达人什么都收不到。
func TestContentNudgeAndReviewEventsArePersisted(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgent(t, s, "agent_e", "E", []string{"VI"}, "hn", 900000)
	task := createTask(t, s, "agent_e", "m1")
	if r := contentCmd(t, s, "NudgeContentTask", map[string]any{"taskId": task.ID}, "", "m1"); r.Outcome != "ACCEPTED" {
		t.Fatalf("nudge: %+v", r.Error)
	}
	respondAs(t, s, map[string]any{"invitationId": task.InvitationID, "decision": "ACCEPTED"}, "agent_e", "")
	contentCmd(t, s, "SubmitContentDraft", map[string]any{"taskId": task.ID, "mediaAssetIds": []string{"ma_1"}, "caption": "ok"}, "agent_e", "")
	contentCmd(t, s, "ReviewContentDraft", map[string]any{"taskId": task.ID, "decision": "REJECT", "note": "重拍门头"}, "", "m1")
	got := map[string]string{}
	repo.mu.Lock()
	for _, ev := range repo.events {
		if agent, _ := ev.Payload["agentId"].(string); ev.EventType == "ContentTaskNudged" || ev.EventType == "ContentDraftReviewed" {
			got[ev.EventType] = agent
		}
	}
	repo.mu.Unlock()
	if got["ContentTaskNudged"] != "agent_e" || got["ContentDraftReviewed"] != "agent_e" {
		t.Fatalf("events not persisted to the creator: %+v", got)
	}
}

// MERCHANT-CREATOR-NOTIFY-001：内容任务的两个事件（催一下 / 审核结果）也要用
// **可投递**的收件人。
//
// 这两条以前拿 payload 里的 agentId 当收件人，而 agentId 不是任何会话的 principal
// （本地库：121 个 creator，0 个的 agent_id 是 user account；sessions 里
// principal_id LIKE 'agent_%' 为 0 行）。所以「商家提醒了你」「稿件被打回」这两条
// 通知从来没有人读得到，而任务状态照样推进、没有任何报错。
func TestContentTaskNotificationsUseADeliverableRecipient(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgentAs(t, s, "agent_ct", "user_ct")
	task := createTask(t, s, "agent_ct", "m_ct")
	// 顺序有讲究：催一下只在「等 creator 回应」或「在拍」时适用（CONTENT_NUDGE_
	// NOT_APPLICABLE），所以先在 PENDING 阶段催，再接受 → 投稿 → 审核。
	if r := contentCmd(t, s, "NudgeContentTask", map[string]any{"taskId": task.ID}, "", "m_ct"); r.Outcome != "ACCEPTED" {
		t.Fatalf("nudge: %s %+v", r.Outcome, r.Error)
	}
	respondAs(t, s, map[string]any{"invitationId": task.InvitationID, "decision": "ACCEPTED"}, "agent_ct", "")
	contentCmd(t, s, "SubmitContentDraft", map[string]any{"taskId": task.ID, "mediaAssetIds": []string{"ma_1"}, "caption": "二层包厢的光线"}, "agent_ct", "")
	if r := contentCmd(t, s, "ReviewContentDraft", map[string]any{
		"taskId": task.ID, "decision": "APPROVE",
		"checks": map[string]any{"storeClear": true, "matchesReality": true, "noCompetitor": true, "noContact": true},
	}, "", "m_ct"); r.Outcome != "ACCEPTED" {
		t.Fatalf("review: %s %+v", r.Outcome, r.Error)
	}

	for _, eventType := range []string{"ContentTaskNudged", "ContentDraftReviewed"} {
		got := notifiedRecipients(repo, eventType)
		if len(got) != 1 || got[0] != "user_ct" {
			t.Fatalf("%s recipient = %v, want [user_ct]（user account，不是 agent id）", eventType, got)
		}
	}
}

// profile 上没有 user account ⇒ **不发事件**（而不是发一条没人收得到的），
// 而任务状态机照常推进 —— 通知的可推导性不该阻塞业务动作。
func TestContentTaskWithoutDeliverableRecipientStillAdvances(t *testing.T) {
	repo := NewMemoryRepository()
	s := NewWithRepository(repo)
	setupAgentAs(t, s, "agent_ct_nouid", "") // actor 为空 ⇒ profile 上没有 user account
	task := createTask(t, s, "agent_ct_nouid", "m_ct2")

	if r := contentCmd(t, s, "NudgeContentTask", map[string]any{"taskId": task.ID}, "", "m_ct2"); r.Outcome != "ACCEPTED" {
		t.Fatalf("the nudge must still succeed, got %s (%+v)", r.Outcome, r.Error)
	}
	if got := notifiedRecipients(repo, "ContentTaskNudged"); len(got) != 0 {
		t.Fatalf("nobody may be notified when the recipient is unresolvable, got %v", got)
	}
	if stage := stageOf(t, s, "m_ct2", task.ID); stage == "" {
		t.Fatal("the task must still be in a real state")
	}
}
