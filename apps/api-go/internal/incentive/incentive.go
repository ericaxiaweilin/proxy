// Package incentive 是激励管线：用户做成某件事（首次发帖 / 首次发需求 / 首次参加活动）→ 按运营配的规则发奖励。
//
// 硬边界（用户 2026-10-08）：奖励只能是「券」或「成长值」，不能是现金——现金违规。
//   - 类型层面就没有现金：RewardKind 只有 BENEFIT_CLAIM / GROWTH_POINTS，库里 CHECK 也挡；
//   - 券不在这里造：BENEFIT_CLAIM 是替用户领一份已有的福利活动（benefit.Campaign），预算 / 名额 / 资格
//     都由福利活动自己的容量池和资格引擎管；这里只负责「谁在什么时候该领」和「不重复发」；
//   - 成长值只记账（点数），不是钱、不能提现；
//   - 规则默认不生效（active=false），运营显式打开才发；发放对 (规则, 用户) 幂等。
package incentive

import (
	"context"
	"errors"
	"strings"
	"time"
)

const (
	TriggerFirstPost     = "FIRST_POST"
	TriggerFirstDemand   = "FIRST_DEMAND"
	TriggerFirstActivity = "FIRST_ACTIVITY"

	RewardBenefitClaim = "BENEFIT_CLAIM"
	RewardGrowthPoints = "GROWTH_POINTS"

	StatusGranted = "GRANTED"
	StatusFailed  = "FAILED"
)

func Triggers() []string    { return []string{TriggerFirstPost, TriggerFirstDemand, TriggerFirstActivity} }
func RewardKinds() []string { return []string{RewardBenefitClaim, RewardGrowthPoints} }

const MaxPoints = 1000

type Rule struct {
	ID                 string    `json:"id"`
	Label              string    `json:"label"`
	Trigger            string    `json:"trigger"`
	RewardKind         string    `json:"rewardKind"`
	CampaignID         string    `json:"campaignId,omitempty"`
	BenefitID          string    `json:"benefitId,omitempty"`
	Points             int       `json:"points,omitempty"`
	MinAccountAgeHours int       `json:"minAccountAgeHours"`
	Active             bool      `json:"active"`
	CreatedBy          string    `json:"createdBy"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Grant struct {
	ID         string    `json:"id"`
	RuleID     string    `json:"ruleId"`
	UserID     string    `json:"userId,omitempty"`
	RewardKind string    `json:"rewardKind"`
	ClaimID    string    `json:"claimId,omitempty"`
	Points     int       `json:"points,omitempty"`
	Status     string    `json:"status"`
	Error      string    `json:"error,omitempty"`
	GrantedAt  time.Time `json:"grantedAt"`
}

var (
	ErrLabelNeeded   = errors.New("incentive: label required")
	ErrBadTrigger    = errors.New("incentive: unknown trigger")
	ErrBadReward     = errors.New("incentive: reward must be a benefit claim (voucher) or growth points — never cash")
	ErrBenefitNeeded = errors.New("incentive: a benefit reward needs campaignId and benefitId")
	ErrBadPoints     = errors.New("incentive: points must be 1..1000")
	ErrActorNeeded   = errors.New("incentive: the operator must be identified")
)

// Validate 检查一条规则。奖励类型只认两种；现金一类的名字（CASH / MONEY / WALLET …）一律走 ErrBadReward。
func Validate(r Rule) error {
	switch {
	case strings.TrimSpace(r.Label) == "":
		return ErrLabelNeeded
	case !contains(Triggers(), r.Trigger):
		return ErrBadTrigger
	case !contains(RewardKinds(), r.RewardKind):
		return ErrBadReward
	case strings.TrimSpace(r.CreatedBy) == "":
		return ErrActorNeeded
	}
	if r.RewardKind == RewardBenefitClaim {
		if strings.TrimSpace(r.CampaignID) == "" || strings.TrimSpace(r.BenefitID) == "" || r.Points != 0 {
			return ErrBenefitNeeded
		}
	} else if r.Points < 1 || r.Points > MaxPoints || r.CampaignID != "" || r.BenefitID != "" {
		return ErrBadPoints
	}
	if r.MinAccountAgeHours < 0 {
		return ErrBadPoints
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- 存储与发放

type Store interface {
	ListRules(ctx context.Context) ([]Rule, error)
	UpsertRule(ctx context.Context, r Rule) error
	SetActive(ctx context.Context, id string, active bool, now time.Time) (bool, error)
	// Candidates：满足触发条件、账号正常且够老、资料完善、还没有这条规则的发放记录的人。
	Candidates(ctx context.Context, r Rule, now time.Time, limit int) ([]string, error)
	// RecordGrant 写一行发放记录；(rule,user) 已存在返回 inserted=false（幂等）。
	RecordGrant(ctx context.Context, g Grant) (bool, error)
	GrantsOf(ctx context.Context, userID string) ([]Grant, error)
	Stats(ctx context.Context) ([]RuleStat, error)
}

type RuleStat struct {
	RuleID  string `json:"ruleId"`
	Granted int    `json:"granted"`
	Failed  int    `json:"failed"`
	Points  int    `json:"pointsGranted"`
}

// ClaimOutcome 区分「这次领不到但以后可能行（名额用完 / 活动没开）」和「这个人就是领不了（资格不符）」。
type ClaimOutcome int

const (
	ClaimOK        ClaimOutcome = iota
	ClaimTransient              // 不写记录，下一轮再试
	ClaimFinal                  // 写 FAILED，不再重试
)

// Claimer 替用户领一份福利（组合根接 benefit.Service.HandleClaimBenefit）。
type Claimer interface {
	Claim(ctx context.Context, userID, campaignID, benefitID string) (claimID string, outcome ClaimOutcome, reason string, err error)
}

// Notifier 告诉用户「你有一份新福利 / 成长值」。失败不影响发放（记录已写）。
type Notifier interface {
	Granted(ctx context.Context, userID, ruleID, label string, points int) error
}

type Restricted func(ctx context.Context, userID string) bool

// RunGrants 跑一轮发放，返回本轮实际发出的条数。每条规则每轮最多 perRule 人。
func RunGrants(ctx context.Context, st Store, claimer Claimer, notify Notifier, restricted Restricted, now time.Time, perRule int, newID func() string) (int, error) {
	rules, err := st.ListRules(ctx)
	if err != nil {
		return 0, err
	}
	total := 0
	for _, r := range rules {
		if !r.Active {
			continue
		}
		ids, err := st.Candidates(ctx, r, now, perRule)
		if err != nil {
			return total, err
		}
		for _, id := range ids {
			if restricted != nil && restricted(ctx, id) {
				continue
			}
			g := Grant{ID: newID(), RuleID: r.ID, UserID: id, RewardKind: r.RewardKind, GrantedAt: now.UTC(), Status: StatusGranted}
			switch r.RewardKind {
			case RewardGrowthPoints:
				g.Points = r.Points
			case RewardBenefitClaim:
				claimID, outcome, reason, err := claimer.Claim(ctx, id, r.CampaignID, r.BenefitID)
				if err != nil || outcome == ClaimTransient {
					continue // 名额用完 / 活动没开 / 读不出来：下一轮再试，不写记录
				}
				if outcome == ClaimFinal {
					g.Status, g.Error = StatusFailed, reason
				} else {
					g.ClaimID = claimID
				}
			}
			inserted, err := st.RecordGrant(ctx, g)
			if err != nil {
				return total, err
			}
			if inserted && g.Status == StatusGranted {
				total++
				if notify != nil {
					_ = notify.Granted(ctx, id, r.ID, r.Label, g.Points)
				}
			}
		}
	}
	return total, nil
}
