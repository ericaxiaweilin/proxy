package main

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/proxy-app/proxy-api/internal/aipersona"
	"github.com/proxy-app/proxy-api/internal/facet"
	"github.com/proxy-app/proxy-api/internal/modelstack"
	"github.com/proxy-app/proxy-api/internal/platform/postgres"
	"github.com/proxy-app/proxy-api/internal/relationship"
	"github.com/proxy-app/proxy-api/internal/twininsight"
)

// TWIN-INSIGHT-002 的 cmd 层接线。跟 wire_fulfillment.go 同形：把
// relationship / facet / aipersona 三个域的形状适配成 twininsight 需要的
// 窄接口，让 twininsight 不必 import 任何一方的仓储实现。

// relationshipFriendSource 把 relationship.Service 适配成 FriendSource。
//
// 好友集合的事实源只有一处 —— relationship.friendships。这里不另读表、
// 不缓存、不加"也算好友"的第二条规则（比如"关注过就算"），否则好友列表
// 会在好友页和洞察页给出两个不同的集合。
type relationshipFriendSource struct {
	svc *relationship.Service
}

func (s relationshipFriendSource) ListActiveFriends(ctx context.Context, userID string) ([]twininsight.Friend, error) {
	views, err := s.svc.ListActiveFriends(ctx, userID)
	if err != nil {
		return nil, err
	}
	friends := make([]twininsight.Friend, 0, len(views))
	for _, v := range views {
		friends = append(friends, twininsight.Friend{
			UserID:      v.UserID,
			DisplayName: v.DisplayName,
			Since:       v.Since,
		})
	}
	return friends, nil
}

// facetThresholdSource 把 FacetConfig 适配成阈值快照。
//
// 为什么阈值要走 facet 而不是写死在 twininsight 里：PRD §1 第 3 条要求
// 「阈值不由客户端硬编码 60/40，服务端下发快照，阈值变化不发版」。
// 复用 FacetConfig 的 PriorityHigh/MidBoundary（默认 60/30）而不是新开
// 一套配置，是因为两条线本就是同一条「高分优先处理」的语义 ——
// 另起一套阈值等于同一个分数在 Facet 里算高、在洞察里算中。
func facetThresholdSource(svc *facet.Service) twininsight.ThresholdSource {
	return func(ctx context.Context) (twininsight.Thresholds, error) {
		cfg, err := svc.ListFacetConfig(ctx)
		if err != nil {
			return twininsight.Thresholds{}, err
		}
		return twininsight.Thresholds{
			OperateAt:     cfg.PriorityHighBoundary,
			ObserveAt:     cfg.PriorityMidBoundary,
			ConfigVersion: cfg.Version,
		}, nil
	}
}

// errTwinInsightViewerNotEntitled 是使用权门禁的拒绝原因。Service 层会把它
// 归一成 twininsight.ErrInsightViewerForbidden（HTTP 403 + 可区分 code），
// 这里只负责"放行 / 不放行"这个二值判定，不编面向用户的文案。
var errTwinInsightViewerNotEntitled = errors.New("twininsight: insight viewer is not entitled (no VERIFIED seller identity)")

// newTwinInsightViewerGate 组装洞察工具使用权门禁（TWIN-INSIGHT-ENTITLEMENT-001）。
//
// 发放凭证 = supply.seller_real_name_verifications 的未过期 VERIFIED 行，
// 经 agent_profiles.user_account_id 映射到本人 —— operator 写行即发放，
// 删行/过期即回收，不需要发版也不需要改配置。
//
// pool 为 nil（无库环境）时判定一律失败：门禁保持 fail-closed，
// 无库环境本来就没有创作者可服务，关掉比"谁都能看"对。
func newTwinInsightViewerGate(pool *pgxpool.Pool) twininsight.ViewerGate {
	repo := postgres.NewSellerRealNameRepository(pool)
	return func(ctx context.Context, ownerID string) error {
		ok, err := repo.RealNameVerifiedForAccount(ctx, ownerID)
		if err != nil || !ok {
			return errTwinInsightViewerNotEntitled
		}
		return nil
	}
}

// newTwinInsightService 组装好友洞察读模型。
// 三个依赖都是「不接就 fail-closed」的，这里一个都不缺省：
//   - 好友集：relationship（pool 为 nil 时它自己返回空，不是错误）；
//   - 阈值：facet config（读不到时 twininsight 内部有 DefaultThresholds 兜底，
//     数值与 facet 默认值一致，不会出现两套口径）；
//   - 写入：审计表只在 pool 可用时接 —— 没接则 RecordOperate 一律 503，
//     绝不留"点了按钮但没留痕"的口子；
//   - 门禁：年龄查询只在 pool 可用时接 —— 没接则一律 403/503，
//     与 CreatePersona 同一条 fail-closed 规则（COMP-AI-MINOR-001）。
func newTwinInsightService(pool *pgxpool.Pool, relationshipSvc *relationship.Service, facetSvc *facet.Service, port modelstack.Port) *twininsight.Service {
	var repo twininsight.Repository = twininsight.NewMemoryRepository()
	if pool != nil {
		repo = postgres.NewTwinInsightRepository(pool)
	}
	svc := twininsight.New(repo, relationshipFriendSource{svc: relationshipSvc}, facetThresholdSource(facetSvc))
	svc.SetSummaryGenerator(twininsight.NewModelStackSummarizer(port))
	if pool == nil {
		return svc
	}
	svc.SetActionLog(postgres.NewTwinInsightRepository(pool))
	svc.SetCompanionGate(func(ctx context.Context, ownerID string) error {
		ok, err := aipersona.CompanionAllowedFor(ctx, postgres.NewIdentityRepository(pool), ownerID, time.Now().UTC())
		if err != nil {
			return err
		}
		if !ok {
			return aipersona.ErrMinorForbidden
		}
		return nil
	})
	return svc
}
