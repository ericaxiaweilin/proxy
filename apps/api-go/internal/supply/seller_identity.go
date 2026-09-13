package supply

import (
	"context"
	"errors"
	"strings"
)

// COMP-SELLER-001 — 供给侧实名：能收钱的人必须可识别。
//
// 越南电商法 122/2025 与其实施条例 NĐ 248/2026（2026-07-01 生效）禁止匿名销售：
// 在本平台上卖出服务的人必须是可识别、且绑定税务身份（MST）的主体。此前
// supply 侧只有「经营身份」（agent_id + 显示名 + 能力验证），完全没有实名证据，
// 于是产品形态就是法条要禁的那种：匿名个人卖时间。
//
// 能力验证（CapabilityVerification）不能替代实名：它回答的是「这个人会不会
// 中文」，实名回答的是「这个人是谁」。两个问题都必须有答案。
//
// 本文件只定义契约与判定函数；存储见
// migrations/084_seller_real_name.sql 与
// internal/platform/postgres/seller_identity.go。

// SellerIdentityLookup 回答「这个 agent 背后的自然人/主体是否已实名且未过期」。
type SellerIdentityLookup interface {
	RealNameVerified(ctx context.Context, agentID string) (bool, error)
}

var (
	// ErrSellerIdentityLookupUnavailable：没有接实名查询。fail-closed ——
	// 「查不到」必须等于「未核验」，绝不能等于「已核验」。
	ErrSellerIdentityLookupUnavailable = errors.New("seller real-name verification is unavailable")

	// ErrSellerIdentityAgentRequired：没有 agent id 就无从判断。
	ErrSellerIdentityAgentRequired = errors.New("seller real-name check requires an agent id")
)

// SellerRealNameVerified 判定某个 agent 是否已实名。
//
// 它 fail closed：lookup 为 nil、agentID 为空、查询报错，一律返回「未核验」。
// 代价是「宁可少放一个卖家进候选集」，收益是平台不会在法律上处于
// 「明知卖家匿名仍然撮合并收款」的位置。
func SellerRealNameVerified(ctx context.Context, lookup SellerIdentityLookup, agentID string) (bool, error) {
	if strings.TrimSpace(agentID) == "" {
		return false, ErrSellerIdentityAgentRequired
	}
	if lookup == nil {
		return false, ErrSellerIdentityLookupUnavailable
	}
	verified, err := lookup.RealNameVerified(ctx, agentID)
	if err != nil {
		return false, err
	}
	return verified, nil
}
