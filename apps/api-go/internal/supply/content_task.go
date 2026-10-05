// CONTENT-TASK-001（2026-10-04，用户：商家侧 我的 → Creator 经营 → 生产内容，原型
// docs/design/references/Proxy_Content_Tasks_20261004_b3a766.html）。
//
// 内容任务 = 一张 purpose=UGC 的合作邀约（接单 / 拒绝 / 还价 / 撤回全走邀约，见
// collab_invitation.go）+ 任务说明 + 稿件 → 审核 → 各平台发布链接。不另起一条邀约管线。
//
// 原型里有、但这里**故意不做**的（没有真数据来源，不编）：
//   - 各平台播放 / 点赞 / 评论 / 热评：没接 TikTok / IG / FB 的开放接口，拿不到；
//   - 「通过本视频到店 / 核销」按视频归因：专属码是按（商家, creator）发的，只能按人统计，
//     列表里给的是这位 creator 的专属码战绩，标明口径；
//   - 「自有平台自动同步」：还没有把审核通过的稿件自动发到 Proxy 动态的流程。
package supply

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
	"github.com/proxy-app/proxy-api/internal/event"
)

const (
	ContentBriefed   = "BRIEFED"   // 已接单，待交稿
	ContentSubmitted = "SUBMITTED" // 已交稿，待商家审核
	ContentRejected  = "REJECTED"  // 打回重拍（可再交）
	ContentApproved  = "APPROVED"  // 审核通过，可去各平台发布
)

// 列表阶段（给 tab 用，由邀约状态 + 任务状态推出来，不落库）。
const (
	StageAwaiting  = "AWAITING"  // 待接单（邀约 PENDING / COUNTERED）
	StageShooting  = "SHOOTING"  // 拍摄中（已接单，没交稿或被打回）
	StageInReview  = "IN_REVIEW" // 待审核
	StageApproved  = "APPROVED"  // 已通过，还没贴发布链接
	StagePublished = "PUBLISHED" // 至少一个平台已发布
	StageClosed    = "CLOSED"    // 邀约被拒 / 撤回 / 过期
)

var ErrContentTaskNotFound = errors.New("content task not found")

// 内容发布平台（封闭集合）。和 creator 关联社媒同一批平台（zalo 是聊天工具，不算内容平台），
// 加 YouTube。每个平台只认自己的域名，发布链接不接受任意外部地址（钓鱼入口）。
var contentPlatformHosts = map[string][]string{
	"tiktok":    {"tiktok.com"},
	"instagram": {"instagram.com"},
	"facebook":  {"facebook.com", "fb.watch"},
	"youtube":   {"youtube.com", "youtu.be"},
}

var validContentTypes = map[string]bool{"VIDEO": true, "PHOTO_POST": true}

const (
	maxContentTitle     = 60
	maxContentBrief     = 300
	maxContentCaption   = 1000
	maxContentMedia     = 9
	maxReviewNote       = 200
	contentNudgeCooling = 24 * time.Hour
)

type ContentDraft struct {
	MediaAssetIDs []string  `json:"mediaAssetIds"`
	Caption       string    `json:"caption"`
	DurationSec   int       `json:"durationSec,omitempty"`
	SubmittedAt   time.Time `json:"submittedAt"`
	// 交过几次稿（打回重拍后再交 +1）。
	Round int `json:"round"`
}

// ContentChecks：审核要点。NoContact 是服务端扫文案自动判的；其余三项只有人能看出来，
// 由商家勾（原型里画成「✓ 通过」的自动结果，我们没有识图，不假装自动）。
type ContentChecks struct {
	StoreClear     bool `json:"storeClear"`     // 门店画面清晰
	MatchesReality bool `json:"matchesReality"` // 与实物相符
	NoCompetitor   bool `json:"noCompetitor"`   // 无竞品露出
	NoContact      bool `json:"noContact"`      // 文案无站外联系方式（自动）
}

type ContentReview struct {
	Decision   string        `json:"decision"` // APPROVE | REJECT
	Note       string        `json:"note,omitempty"`
	Checks     ContentChecks `json:"checks"`
	ReviewedAt time.Time     `json:"reviewedAt"`
}

type ContentPublication struct {
	Platform    string    `json:"platform"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
}

type ContentTask struct {
	ID           string               `json:"id"`
	InvitationID string               `json:"invitationId"`
	MerchantID   string               `json:"merchantId"`
	AgentID      string               `json:"agentId"`
	Title        string               `json:"title"`
	Brief        string               `json:"brief"`
	ContentType  string               `json:"contentType"`
	Platforms    []string             `json:"platforms"`
	State        string               `json:"state"`
	Draft        *ContentDraft        `json:"draft,omitempty"`
	Review       *ContentReview       `json:"review,omitempty"`
	Publications []ContentPublication `json:"publications"`
	NudgedAt     time.Time            `json:"nudgedAt,omitempty"`
	CreatedAt    time.Time            `json:"createdAt"`
	UpdatedAt    time.Time            `json:"updatedAt"`
}

// ContentTaskView：列表行 = 任务 + 邀约现状 + creator 名片 + 这位 creator 在本店的专属码战绩。
type ContentTaskView struct {
	ContentTask
	Stage            string `json:"stage"`
	InvitationStatus string `json:"invitationStatus"`
	PriceMinVND      int64  `json:"priceMinVnd"`
	PriceMaxVND      int64  `json:"priceMaxVnd"`
	// 门店名（creator 侧要知道是哪家店的任务；读门店资料，读不到为空）。
	MerchantName  string `json:"merchantName,omitempty"`
	CreatorName   string `json:"creatorName"`
	CreatorHandle string `json:"creatorHandle,omitempty"`
	CreatorPhoto  string `json:"creatorPhoto,omitempty"`
	CanNudge      bool   `json:"canNudge"`
	// 稿件文案里有没有站外联系方式（服务端扫的，审核页直接显示「自动检查」结果）。
	DraftHasContact bool            `json:"draftHasContact"`
	PromoCode       string          `json:"promoCode,omitempty"`
	PromoStats      *PairPromoStats `json:"promoStats,omitempty"`
}

type ContentTaskCounts struct {
	Total     int `json:"total"`
	Awaiting  int `json:"awaiting"`
	Shooting  int `json:"shooting"`
	InReview  int `json:"inReview"`
	Published int `json:"published"` // 含「已通过待发布」
}

func contentStage(t ContentTask, inv CollabInvitation, now time.Time) string {
	switch {
	case inv.Status == InvitationPending || inv.Status == InvitationCountered:
		if inv.expired(now) {
			return StageClosed
		}
		return StageAwaiting
	case inv.Status != InvitationAccepted:
		return StageClosed
	}
	switch t.State {
	case ContentSubmitted:
		return StageInReview
	case ContentApproved:
		if len(t.Publications) > 0 {
			return StagePublished
		}
		return StageApproved
	default:
		return StageShooting
	}
}

// 站外联系方式：电话号码、常见私聊工具、外链。creator 在文案里 @ 自己 / 店铺不算。
var contactPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?:\+?84|0)[\s.\-]?\d{2,3}[\s.\-]?\d{3}[\s.\-]?\d{3,4}`),
	regexp.MustCompile(`\d{9,}`),
	regexp.MustCompile(`(?i)\b(zalo|whatsapp|telegram|wechat|line\s*id|viber)\b`),
	regexp.MustCompile(`微信|vx[:：]|加v|私信我`),
	regexp.MustCompile(`(?i)https?://|www\.`),
}

func captionHasContact(caption string) bool {
	for _, re := range contactPatterns {
		if re.MatchString(caption) {
			return true
		}
	}
	return false
}

func validPublicationURL(platform, raw string) bool {
	hosts, ok := contentPlatformHosts[platform]
	if !ok {
		return false
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range hosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

func normalizePlatforms(in []string) ([]string, bool) {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range in {
		p := strings.ToLower(strings.TrimSpace(raw))
		if _, ok := contentPlatformHosts[p]; !ok {
			return nil, false
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, len(out) > 0
}

// ---------------------------------------------------------------- 商家：发任务

type createContentTaskPayload struct {
	AgentID     string   `json:"agentId"`
	Title       string   `json:"title"`
	Brief       string   `json:"brief"`
	ContentType string   `json:"contentType"`
	Platforms   []string `json:"platforms"`
	PriceMinVND int64    `json:"priceMinVnd"`
	PriceMaxVND int64    `json:"priceMaxVnd"`
	Negotiable  bool     `json:"negotiable"`
	StartAt     string   `json:"startAt"`
}

func (s *Service) createContentTask(ctx context.Context, e command.Envelope) command.Result {
	var p createContentTaskPayload
	if !decode(e.Payload, &p) || strings.TrimSpace(p.AgentID) == "" {
		return command.Rejected(e, "INVALID_CONTENT_TASK", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_task", nil)
	}
	title := strings.TrimSpace(p.Title)
	brief := strings.TrimSpace(p.Brief)
	if title == "" || len([]rune(title)) > maxContentTitle || len([]rune(brief)) > maxContentBrief {
		return command.Rejected(e, "INVALID_CONTENT_TASK_TEXT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_task_text", nil)
	}
	contentType := p.ContentType
	if contentType == "" {
		contentType = "VIDEO"
	}
	if !validContentTypes[contentType] {
		return command.Rejected(e, "INVALID_CONTENT_TYPE", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_type", nil)
	}
	platforms, ok := normalizePlatforms(p.Platforms)
	if !ok {
		return command.Rejected(e, "INVALID_CONTENT_PLATFORMS", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_platforms", nil)
	}
	// 邀约留言上限 200 字；任务说明完整存在任务里，邀约只带截断版给 creator 收件箱。
	message := brief
	if r := []rune(message); len(r) > maxInvitationMessage {
		message = string(r[:maxInvitationMessage])
	}
	inv, domainEvents, rejected := s.openInvitation(ctx, e, inviteCreatorPayload{
		AgentID: p.AgentID,
		invitationTerms: invitationTerms{
			PriceMinVND: p.PriceMinVND, PriceMaxVND: p.PriceMaxVND, Negotiable: p.Negotiable,
			Purpose: "UGC", Message: message, StartAt: p.StartAt,
		},
	})
	if rejected != nil {
		return *rejected
	}
	now := s.clock.Now().UTC()
	task := ContentTask{
		ID: newID("ct_"), InvitationID: inv.ID, MerchantID: inv.MerchantID, AgentID: inv.AgentID,
		Title: title, Brief: brief, ContentType: contentType, Platforms: platforms,
		State: ContentBriefed, Publications: []ContentPublication{}, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repository.SaveContentTask(ctx, task); err != nil {
		return command.Rejected(e, "CONTENT_TASK_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_write_failed", nil)
	}
	return acceptedWithPayload(e, "ContentTask", task.ID, 1, "CREATED", map[string]any{"task": task, "invitation": inv}, domainEvents)
}

// ensureContentTasks：通过普通「邀请合作」发出的 UGC 邀约也算内容任务 —— 列表时补一行
// （标题空，客户端显示邀约留言）。这样只有一条邀约管线，不会出现「邀约里有、任务里没有」。
func (s *Service) ensureContentTasks(ctx context.Context, invs []CollabInvitation, tasks []ContentTask) []ContentTask {
	have := map[string]bool{}
	for _, t := range tasks {
		have[t.InvitationID] = true
	}
	for _, inv := range invs {
		if inv.Purpose != "UGC" || have[inv.ID] {
			continue
		}
		t := ContentTask{
			ID: newID("ct_"), InvitationID: inv.ID, MerchantID: inv.MerchantID, AgentID: inv.AgentID,
			Brief: inv.Message, ContentType: "VIDEO", Platforms: []string{}, State: ContentBriefed,
			Publications: []ContentPublication{}, CreatedAt: inv.CreatedAt, UpdatedAt: inv.CreatedAt,
		}
		if err := s.repository.SaveContentTask(ctx, t); err != nil {
			continue
		}
		tasks = append(tasks, t)
		have[inv.ID] = true
	}
	return tasks
}

// ---------------------------------------------------------------- 列表

func (s *Service) listMerchantContentTasks(ctx context.Context, e command.Envelope) command.Result {
	merchantID, rejected := pairPromoMerchantOnly(e)
	if rejected != nil {
		return *rejected
	}
	invs, err := s.repository.ListInvitationsByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	tasks, err := s.repository.ListContentTasksByMerchant(ctx, merchantID)
	if err != nil {
		return command.Rejected(e, "CONTENT_TASK_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_read_failed", nil)
	}
	tasks = s.ensureContentTasks(ctx, invs, tasks)
	views := s.contentViews(ctx, tasks, invs, true)
	counts := ContentTaskCounts{}
	for _, v := range views {
		if v.Stage == StageClosed {
			continue
		}
		counts.Total++
		switch v.Stage {
		case StageAwaiting:
			counts.Awaiting++
		case StageShooting:
			counts.Shooting++
		case StageInReview:
			counts.InReview++
		case StageApproved, StagePublished:
			counts.Published++
		}
	}
	return acceptedWithPayload(e, "ContentTask", merchantID, 1, "LISTED", map[string]any{
		"tasks": views, "counts": counts, "platforms": sortedPlatforms(),
	}, nil)
}

func (s *Service) listMyContentTasks(ctx context.Context, e command.Envelope) command.Result {
	if e.Principal.ID == "" {
		return command.Rejected(e, "AGENT_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.agent_not_owned", nil)
	}
	invs, err := s.repository.ListInvitationsByAgent(ctx, e.Principal.ID)
	if err != nil {
		return command.Rejected(e, "INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed", nil)
	}
	tasks, err := s.repository.ListContentTasksByAgent(ctx, e.Principal.ID)
	if err != nil {
		return command.Rejected(e, "CONTENT_TASK_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_read_failed", nil)
	}
	tasks = s.ensureContentTasks(ctx, invs, tasks)
	views := s.contentViews(ctx, tasks, invs, false)
	// creator 只看已接单之后的（待接单在「收到的合作邀请」里处理，不在这里重复）。
	out := make([]ContentTaskView, 0, len(views))
	for _, v := range views {
		if v.Stage != StageAwaiting && v.Stage != StageClosed {
			out = append(out, v)
		}
	}
	return acceptedWithPayload(e, "ContentTask", e.Principal.ID, 1, "LISTED", map[string]any{"tasks": out, "platforms": sortedPlatforms()}, nil)
}

func sortedPlatforms() []string {
	out := make([]string, 0, len(contentPlatformHosts))
	for p := range contentPlatformHosts {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

func (s *Service) contentViews(ctx context.Context, tasks []ContentTask, invs []CollabInvitation, withPromo bool) []ContentTaskView {
	now := s.clock.Now().UTC()
	invByID := map[string]CollabInvitation{}
	for _, inv := range invs {
		invByID[inv.ID] = inv
	}
	profiles := map[string]AgentProfile{}
	storeNames := map[string]string{}
	promoByAgent := map[string]MerchantCreatorPromo{}
	var stats map[string]PairPromoStats
	if withPromo && len(tasks) > 0 {
		merchantID := tasks[0].MerchantID
		if promos, err := s.repository.ListMerchantCreatorPromosByMerchant(ctx, merchantID); err == nil {
			for _, p := range promos {
				promoByAgent[p.AgentID] = p
			}
			issues, _ := s.repository.ListPromoIssuesByMerchant(ctx, merchantID)
			quotes, _ := s.repository.ListPromoQuotesByMerchant(ctx, merchantID)
			stats, _ = s.pairStats(ctx, promos, issues, quotes)
		}
	}
	out := make([]ContentTaskView, 0, len(tasks))
	for _, t := range tasks {
		inv, ok := invByID[t.InvitationID]
		if !ok {
			continue
		}
		if t.Publications == nil {
			t.Publications = []ContentPublication{}
		}
		if t.Platforms == nil {
			t.Platforms = []string{}
		}
		status := inv.Status
		if inv.expired(now) {
			status = InvitationExpired
		}
		v := ContentTaskView{
			ContentTask: t, Stage: contentStage(t, inv, now), InvitationStatus: status,
			PriceMinVND: inv.PriceMinVND, PriceMaxVND: inv.PriceMaxVND,
		}
		if name, ok := storeNames[t.MerchantID]; ok {
			v.MerchantName = name
		} else {
			v.MerchantName = s.merchantStore(ctx, t.MerchantID).Name
			storeNames[t.MerchantID] = v.MerchantName
		}
		profile, cached := profiles[t.AgentID]
		if !cached {
			profile, _ = s.repository.GetProfile(ctx, t.AgentID)
			profiles[t.AgentID] = profile
		}
		v.CreatorName = profile.Name
		if len(profile.Photos) > 0 {
			v.CreatorPhoto = profile.Photos[0]
		}
		for _, soc := range profile.Socials {
			if soc.Platform == "tiktok" || (v.CreatorHandle == "" && soc.Platform == "instagram") {
				v.CreatorHandle = soc.Handle
			}
		}
		if t.Draft != nil {
			v.DraftHasContact = captionHasContact(t.Draft.Caption)
		}
		v.CanNudge = (v.Stage == StageAwaiting || v.Stage == StageShooting) && (t.NudgedAt.IsZero() || now.Sub(t.NudgedAt) >= contentNudgeCooling)
		if promo, ok := promoByAgent[t.AgentID]; ok {
			v.PromoCode = promo.Code
			st := stats[promo.Code]
			v.PromoStats = &st
		}
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

// contentTaskPublisher：能把任务状态和事件放在同一个事务里落库的仓（Postgres 走 outbox）。
// 「催一下」/ 审核结果要靠事件变成站内通知 —— 只返回在命令结果里、不进 outbox 的事件
// 没有人投递，商家看到「已提醒」而达人什么都收不到。没实现的仓退回只存状态。
type contentTaskPublisher interface {
	UpdateContentTaskAndPublish(ctx context.Context, t ContentTask, domainEvents []event.DomainEvent) error
}

func (s *Service) saveContentTaskWithEvents(ctx context.Context, t ContentTask, domainEvents []event.DomainEvent) error {
	if publisher, ok := s.repository.(contentTaskPublisher); ok && len(domainEvents) > 0 {
		return publisher.UpdateContentTaskAndPublish(ctx, t, domainEvents)
	}
	return s.repository.UpdateContentTask(ctx, t)
}

// ---------------------------------------------------------------- 取任务 + 鉴权

func (s *Service) contentTaskFor(ctx context.Context, e command.Envelope, taskID string, asMerchant bool) (ContentTask, CollabInvitation, *command.Result) {
	fail := func(code, kind, retry, key string) (ContentTask, CollabInvitation, *command.Result) {
		r := command.Rejected(e, code, kind, retry, key, nil)
		return ContentTask{}, CollabInvitation{}, &r
	}
	if strings.TrimSpace(taskID) == "" {
		return fail("INVALID_CONTENT_TASK", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_task")
	}
	t, err := s.repository.GetContentTask(ctx, taskID)
	if errors.Is(err, ErrContentTaskNotFound) {
		return fail("CONTENT_TASK_NOT_FOUND", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_task_not_found")
	}
	if err != nil {
		return fail("CONTENT_TASK_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_read_failed")
	}
	if asMerchant {
		if m := invitationMerchantID(e); m == "" || m != t.MerchantID {
			return fail("CONTENT_TASK_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.content_task_not_owned")
		}
	} else if e.Principal.ID == "" || e.Principal.ID != t.AgentID {
		return fail("CONTENT_TASK_NOT_OWNED", "AUTHORIZATION", "AFTER_USER_ACTION", "supply.content_task_not_owned")
	}
	inv, err := s.repository.GetInvitation(ctx, t.InvitationID)
	if err != nil {
		return fail("INVITATION_READ_FAILED", "INTERNAL", "SAFE_RETRY", "supply.invitation_read_failed")
	}
	return t, inv, nil
}

// ---------------------------------------------------------------- creator：交稿 / 贴发布链接

type submitContentDraftPayload struct {
	TaskID        string   `json:"taskId"`
	MediaAssetIDs []string `json:"mediaAssetIds"`
	Caption       string   `json:"caption"`
	DurationSec   int      `json:"durationSec"`
}

func (s *Service) submitContentDraft(ctx context.Context, e command.Envelope) command.Result {
	var p submitContentDraftPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_CONTENT_DRAFT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_draft", nil)
	}
	t, inv, rejected := s.contentTaskFor(ctx, e, p.TaskID, false)
	if rejected != nil {
		return *rejected
	}
	if inv.Status != InvitationAccepted {
		return command.Rejected(e, "CONTENT_TASK_NOT_ACCEPTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_task_not_accepted", nil)
	}
	if t.State != ContentBriefed && t.State != ContentRejected {
		return command.Rejected(e, "CONTENT_DRAFT_NOT_EXPECTED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_draft_not_expected", nil)
	}
	media := []string{}
	for _, id := range p.MediaAssetIDs {
		if id = strings.TrimSpace(id); id != "" {
			media = append(media, id)
		}
	}
	caption := strings.TrimSpace(p.Caption)
	if len(media) == 0 || len(media) > maxContentMedia || len([]rune(caption)) > maxContentCaption || p.DurationSec < 0 || p.DurationSec > 600 {
		return command.Rejected(e, "INVALID_CONTENT_DRAFT", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_draft", nil)
	}
	now := s.clock.Now().UTC()
	round := 1
	if t.Draft != nil {
		round = t.Draft.Round + 1
	}
	t.Draft = &ContentDraft{MediaAssetIDs: media, Caption: caption, DurationSec: p.DurationSec, SubmittedAt: now, Round: round}
	t.State = ContentSubmitted
	t.UpdatedAt = now
	if err := s.repository.UpdateContentTask(ctx, t); err != nil {
		return command.Rejected(e, "CONTENT_TASK_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_write_failed", nil)
	}
	return acceptedWithPayload(e, "ContentTask", t.ID, round+1, "SUBMITTED", map[string]any{"task": t}, nil)
}

type addContentPublicationPayload struct {
	TaskID   string `json:"taskId"`
	Platform string `json:"platform"`
	URL      string `json:"url"`
}

func (s *Service) addContentPublication(ctx context.Context, e command.Envelope) command.Result {
	var p addContentPublicationPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_CONTENT_PUBLICATION", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_publication", nil)
	}
	t, _, rejected := s.contentTaskFor(ctx, e, p.TaskID, false)
	if rejected != nil {
		return *rejected
	}
	if t.State != ContentApproved {
		return command.Rejected(e, "CONTENT_NOT_APPROVED", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_not_approved", nil)
	}
	platform := strings.ToLower(strings.TrimSpace(p.Platform))
	link := strings.TrimSpace(p.URL)
	if !validPublicationURL(platform, link) {
		return command.Rejected(e, "INVALID_PUBLICATION_URL", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_publication_url", nil)
	}
	now := s.clock.Now().UTC()
	replaced := false
	for i := range t.Publications {
		if t.Publications[i].Platform == platform {
			t.Publications[i] = ContentPublication{Platform: platform, URL: link, PublishedAt: now}
			replaced = true
		}
	}
	if !replaced {
		t.Publications = append(t.Publications, ContentPublication{Platform: platform, URL: link, PublishedAt: now})
	}
	t.UpdatedAt = now
	if err := s.repository.UpdateContentTask(ctx, t); err != nil {
		return command.Rejected(e, "CONTENT_TASK_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_write_failed", nil)
	}
	return acceptedWithPayload(e, "ContentTask", t.ID, 1, "PUBLISHED", map[string]any{"task": t}, nil)
}

// ---------------------------------------------------------------- 商家：审核 / 催一下

type reviewContentDraftPayload struct {
	TaskID   string        `json:"taskId"`
	Decision string        `json:"decision"`
	Note     string        `json:"note"`
	Checks   ContentChecks `json:"checks"`
}

func (s *Service) reviewContentDraft(ctx context.Context, e command.Envelope) command.Result {
	var p reviewContentDraftPayload
	if !decode(e.Payload, &p) || (p.Decision != "APPROVE" && p.Decision != "REJECT") {
		return command.Rejected(e, "INVALID_CONTENT_REVIEW", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_review", nil)
	}
	t, _, rejected := s.contentTaskFor(ctx, e, p.TaskID, true)
	if rejected != nil {
		return *rejected
	}
	if t.State != ContentSubmitted || t.Draft == nil {
		return command.Rejected(e, "CONTENT_NOT_IN_REVIEW", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_not_in_review", nil)
	}
	note := strings.TrimSpace(p.Note)
	if len([]rune(note)) > maxReviewNote {
		return command.Rejected(e, "INVALID_CONTENT_REVIEW", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_review", nil)
	}
	checks := p.Checks
	// 自动项以服务端扫描为准，客户端传什么都不信。
	checks.NoContact = !captionHasContact(t.Draft.Caption)
	if p.Decision == "APPROVE" {
		if !checks.NoContact {
			return command.Rejected(e, "CONTENT_HAS_CONTACT", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_has_contact", nil)
		}
		if !checks.StoreClear || !checks.MatchesReality || !checks.NoCompetitor {
			return command.Rejected(e, "CONTENT_CHECKS_INCOMPLETE", "VALIDATION", "AFTER_USER_ACTION", "supply.content_checks_incomplete", nil)
		}
		t.State = ContentApproved
	} else {
		if note == "" {
			return command.Rejected(e, "CONTENT_REJECT_REASON_REQUIRED", "VALIDATION", "AFTER_USER_ACTION", "supply.content_reject_reason_required", nil)
		}
		t.State = ContentRejected
	}
	now := s.clock.Now().UTC()
	t.Review = &ContentReview{Decision: p.Decision, Note: note, Checks: checks, ReviewedAt: now}
	t.UpdatedAt = now
	domainEvents := []event.DomainEvent{event.New("ContentDraftReviewed", "ContentTask", t.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agentId": t.AgentID, "decision": p.Decision, "title": t.Title,
	})}
	if err := s.saveContentTaskWithEvents(ctx, t, domainEvents); err != nil {
		return command.Rejected(e, "CONTENT_TASK_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_write_failed", nil)
	}
	return acceptedWithPayload(e, "ContentTask", t.ID, 1, t.State, map[string]any{"task": t}, domainEvents)
}

type contentTaskRefPayload struct {
	TaskID string `json:"taskId"`
}

// nudgeContentTask：「催一下」—— 给 creator 发一条站内通知（worker 把事件投进收件箱）。
// 24 小时一次，防商家刷屏。
func (s *Service) nudgeContentTask(ctx context.Context, e command.Envelope) command.Result {
	var p contentTaskRefPayload
	if !decode(e.Payload, &p) {
		return command.Rejected(e, "INVALID_CONTENT_TASK", "VALIDATION", "AFTER_USER_ACTION", "supply.invalid_content_task", nil)
	}
	t, inv, rejected := s.contentTaskFor(ctx, e, p.TaskID, true)
	if rejected != nil {
		return *rejected
	}
	now := s.clock.Now().UTC()
	stage := contentStage(t, inv, now)
	if stage != StageAwaiting && stage != StageShooting {
		return command.Rejected(e, "CONTENT_NUDGE_NOT_APPLICABLE", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_nudge_not_applicable", nil)
	}
	if !t.NudgedAt.IsZero() && now.Sub(t.NudgedAt) < contentNudgeCooling {
		return command.Rejected(e, "CONTENT_NUDGE_TOO_SOON", "BUSINESS_STATE", "AFTER_USER_ACTION", "supply.content_nudge_too_soon", nil)
	}
	t.NudgedAt = now
	domainEvents := []event.DomainEvent{event.New("ContentTaskNudged", "ContentTask", t.ID, 1, e.Principal.ID, e.CorrelationID, e.CommandID, now, map[string]any{
		"agentId": t.AgentID, "stage": stage, "title": t.Title, "invitationId": t.InvitationID,
	})}
	if err := s.saveContentTaskWithEvents(ctx, t, domainEvents); err != nil {
		return command.Rejected(e, "CONTENT_TASK_WRITE_FAILED", "INTERNAL", "SAFE_RETRY", "supply.content_task_write_failed", nil)
	}
	return acceptedWithPayload(e, "ContentTask", t.ID, 1, "NUDGED", map[string]any{"task": t}, domainEvents)
}
