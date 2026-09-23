package supply

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
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
// 本文件定义契约：读侧判定（SellerRealNameVerified）、写侧形态
// （SellerRealNameVerification）与取证约定（HashIDNumber）。存储见
// migrations/084_seller_real_name.sql 与
// internal/platform/postgres/seller_identity.go（读）、
// internal/platform/postgres/supply.go（写）。

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

// ---------- 写侧：实名核验的受控写入口 ----------
//
// 上面那段回答的是「这个 agent 有没有一条 VERIFIED 且未过期的记录」；本段
// 回答的是「那条记录是谁、按什么方式写进来的」。
//
// 在 AttestSellerRealName 落地之前，全仓没有任何代码会 INSERT 这张表
// （`INSERT INTO supply.seller_real_name_verifications` 零命中），于是
// 「已核验」这个状态只能由手写 SQL 产生：谁核的（verified_by）可以填任意
// 字符串、有效期（expires_at）可以留空而读侧把空当成「永不过期」、
// 证件号哈希可以是任意字面量。核验记录如果谁都能造、造完还不用复查，
// 它就不是合规证据 —— 它只是看起来像证据。

// SellerRealNameVerification 是一条实名核验记录
// （supply.seller_real_name_verifications）。
//
// 存的是「核验结论 + 取证方式」，不是证件原件：证件号只以 IDNumberHash
// 落库，明文只存在于这一次命令的入参里 —— 不写库，也不进事件载荷。
type SellerRealNameVerification struct {
	ID            string
	AgentID       string
	UserAccountID string
	LegalName     string
	IDType        string
	IDNumberHash  string
	TaxCode       string
	Status        string
	Method        string
	// VerifiedBy 必须是发起核验的运营 principal id（084 的「具名运营人员」）。
	// 空字符串不是「匿名核验」，而是没有核验 —— 见 ErrSellerRealNameAttestorRequired。
	VerifiedBy string
	VerifiedAt time.Time
	// ExpiresAt 为 nil = 无有效期。写 VERIFIED 时不允许为 nil：084 的
	// 「过期 ≠ 已核验」只有在有效期真实存在时才成立，而读侧把 NULL 当成
	// 永不过期，于是「必须重新核」这条承诺会被一个空值整个吃掉。
	ExpiresAt *time.Time
	CreatedAt time.Time
	UpdatedAt time.Time
}

const (
	// SellerRealNameMethodOperatorAttestation：由具名运营人员人工核过
	// （084 的三种取证方式之一）。
	SellerRealNameMethodOperatorAttestation = "OPERATOR_ATTESTATION"

	SellerRealNameStatusVerified = "VERIFIED"
	SellerRealNameStatusRejected = "REJECTED"

	SellerRealNameDecisionApprove = "APPROVE"
	SellerRealNameDecisionReject  = "REJECT"
)

// SellerRealNameAttestationValidityMonths 是一次人工核验的有效期。
//
// 法条（越南电商法 122/2025 + NĐ 248/2026）要求卖家「可识别 + 绑定税务
// 身份」，但没有规定复查周期；084 的注释只承诺「到点即失效，必须重新核」。
// 所以这里的 12 个月是平台自定的复查节奏（与 VerifyCapability 的 1 年一致），
// **不是法定数字** —— 改它请连这条注释一起改，别让它读起来像法条要求。
const SellerRealNameAttestationValidityMonths = 12

// sellerRealNameIDTypes 与 084 的 CHECK (id_type IN (...)) 严格一致。
var sellerRealNameIDTypes = []string{"CCCD", "VNEID", "PASSPORT"}

// SellerRealNameIDTypes 返回支持的证件类型（副本 —— 调用方改不动词汇表）。
func SellerRealNameIDTypes() []string {
	out := make([]string, len(sellerRealNameIDTypes))
	copy(out, sellerRealNameIDTypes)
	return out
}

// ValidSellerRealNameIDType 判定证件类型是否在 084 允许的三种之内。
func ValidSellerRealNameIDType(idType string) bool {
	for _, candidate := range sellerRealNameIDTypes {
		if candidate == idType {
			return true
		}
	}
	return false
}

// HashIDNumber 把证件号变成入库形态。
//
// 明文证件号绝不落库（PDP 法 91/2025 + NĐ 356/2025）。这里与 identity 的
// token 哈希同一约定：sha256 的十六进制小写、无盐 —— 无盐是因为同一证件号
// 必须能重复比对上（有盐就无法判定两条记录是不是同一个人）。
func HashIDNumber(raw string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(digest[:])
}

var (
	// ErrSellerRealNameAttestationIncomplete：缺少 agent / 法定姓名 / 证件类型 / 证件号。
	ErrSellerRealNameAttestationIncomplete = errors.New("seller real-name attestation requires an agent, legal name, id type and id number")

	// ErrSellerRealNameIDTypeUnsupported：证件类型不在 084 的 CHECK 之内。
	ErrSellerRealNameIDTypeUnsupported = errors.New("seller real-name attestation uses an unsupported id type")

	// ErrSellerRealNameAttestorRequired：没有具名运营人员。核验记录没有
	// 归属人，就等于没人核过 —— 不能拿「匿名核验」冒充「已核验」。
	ErrSellerRealNameAttestorRequired = errors.New("seller real-name attestation requires a named operator")

	// ErrSellerRealNameExpiryRequired：VERIFIED 记录没有有效期。读侧把
	// NULL 当永不过期，所以这一条空值会让「必须重新核」整条承诺失效。
	ErrSellerRealNameExpiryRequired = errors.New("a VERIFIED seller real-name record requires an expiry")
)

// SellerRealNameAttestationComplete 判定一条记录是否具备「可入库」的最低要件。
//
// 写侧与内存实现共用它，这样 DB 的 CHECK（118）与内存实现在同一条规则上，
// 不会出现「内存绿、生产红」的反向版本（内存放行、生产拒绝）。
func SellerRealNameAttestationComplete(v SellerRealNameVerification) error {
	if strings.TrimSpace(v.AgentID) == "" || strings.TrimSpace(v.LegalName) == "" ||
		strings.TrimSpace(v.IDType) == "" || strings.TrimSpace(v.IDNumberHash) == "" {
		return ErrSellerRealNameAttestationIncomplete
	}
	if !ValidSellerRealNameIDType(v.IDType) {
		return ErrSellerRealNameIDTypeUnsupported
	}
	if strings.TrimSpace(v.VerifiedBy) == "" {
		return ErrSellerRealNameAttestorRequired
	}
	if v.Status == SellerRealNameStatusVerified && v.ExpiresAt == nil {
		return ErrSellerRealNameExpiryRequired
	}
	return nil
}
