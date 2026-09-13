package aipersona

import (
	"context"
	"errors"
	"strings"
	"time"
)

// COMP-AI-MINOR-001 — AI 伴侣不对未成年人开放。
//
// 越南 AI 法 134/2025/QH15（2026-03-01 生效）要求对未成年人等高风险受影响
// 群体采取保护措施。AI 伴侣 / 数字分身（USER_TWIN、平台 AI 角色）是陪伴型
// 系统：未成年人可以全天候和一个永远不会拒绝它、且带有真人 likeness 的对象
// 建立情感依赖 —— 这正是各国 AI 监管里点名要保护的场景。
//
// 前提条件由 COMP-AGE-001 提供：注册时的出生日期现在会落进
// identity.user_age_assertions。在那之前，服务端根本没有年龄信号，
// 「保护未成年人」在技术上无从做起。
//
// 本文件只定义契约与判定；年龄的读取由 identity 侧提供
// （internal/platform/postgres/identity.go 的 AgeAt）。

// AgeLookup 报告某账号在指定时刻的周岁年龄。
// 返回 0 并 nil 错误 = 查不到年龄证据（调用方必须按「未成年」处理）。
type AgeLookup interface {
	AgeAt(ctx context.Context, userAccountID string, at time.Time) (int, error)
}

// MinimumCompanionAge 是使用 AI 伴侣 / 数字分身的年龄下限。
const MinimumCompanionAge = 18

var (
	// ErrAgeLookupUnavailable：没有接年龄查询。fail-closed —— 「查不到」
	// 不能变成「成年」。
	ErrAgeLookupUnavailable = errors.New("age lookup is unavailable")

	// ErrNoAgeEvidence：账号没有任何年龄断言。这是 fail-closed 的核心：
	// 没证据就当未成年，而不是当成年。
	ErrNoAgeEvidence = errors.New("no age evidence on file for this account")

	// ErrMinorForbidden：确认未成年。
	ErrMinorForbidden = errors.New("AI companions are not available to minors")

	// ErrOwnerRequired：没有账号 id 就无从判断。
	ErrOwnerRequired = errors.New("an owner account id is required")
)

// CompanionAllowedFor 判定某账号是否可以使用 AI 伴侣 / 创建数字分身。
//
// fail-closed 的三个方向：
//   - 没接查询     → 拒绝（ErrAgeLookupUnavailable）
//   - 没有年龄证据 → 拒绝（ErrNoAgeEvidence）
//   - 查询报错     → 拒绝（错误原样上抛）
//
// 只有「明确查到年龄且 ≥ 18」才放行。代价是：历史账号（注册在
// COMP-AGE-001 之前、没有年龄断言）需要补一条断言才能用这个功能；
// 这个代价是我们主动选的 —— 反过来放行等于对未成年人没有保护。
func CompanionAllowedFor(ctx context.Context, lookup AgeLookup, userAccountID string, now time.Time) (bool, error) {
	if strings.TrimSpace(userAccountID) == "" {
		return false, ErrOwnerRequired
	}
	if lookup == nil {
		return false, ErrAgeLookupUnavailable
	}
	age, err := lookup.AgeAt(ctx, userAccountID, now)
	if err != nil {
		return false, err
	}
	if age <= 0 {
		return false, ErrNoAgeEvidence
	}
	if age < MinimumCompanionAge {
		return false, ErrMinorForbidden
	}
	return true, nil
}
