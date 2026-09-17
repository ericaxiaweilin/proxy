// Package: conversation — Message.Protection sub-aggregate.
//
// WHAT THIS IS
//
//	Per-message anti-leak controls. Per-conversation toggles were rejected
//	because a sender may need to protect one sensitive attachment while
//	keeping the rest of the thread readable.
//
// COMPLIANCE (COMP-CHAT-001): these knobs are a privacy feature, not an
// evidence feature. On a conversation that carries money between users
// they are disabled server-side and a client cannot switch them back on.
// A marketplace on which both sides can make a paid meeting untraceable
// reads as a brokering channel rather than a services platform.
//
// THE FOUR KNOBS
//  1. Forwardable:    if false, server refuses forward attempts with
//     PROTECTION_VIOLATION
//  2. ScreenshotWarn: if true, server records ScreenshotDetected events
//     and emits a SECURITY_ALERT to the sender
//  3. ViewLimit + ViewCount: ephemeral — server returns
//     VIEW_LIMIT_EXCEEDED after N reads by the recipient
//  4. TTLDuration + ExpiresAt: server returns MESSAGE_EXPIRED after the
//     wall-clock cutoff
//
// DEFAULTS (RFC §3.3)
//
//	Per-message defaults are computed by DefaultProtectionFor. The values
//	are deliberately conservative for DM, permissive for GROUP.
//
// NOT IN THIS FILE
//   - The TTL sweeper (worker, separate concern)
//   - Object-store purging (media pipeline owns this)
//   - Screenshot detection on device (RN-side, see apps/mobile)
package conversation

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// MessageProtection is the per-message anti-leak envelope. See RFC §3.2.
type MessageProtection struct {
	// Forwardable: false means server refuses re-send / forward commands.
	Forwardable bool `json:"forwardable"`

	// Copyable: false means the client should disable text selection.
	// Server cannot enforce; the field exists so the client can render
	// the right UI.
	Copyable bool `json:"copyable"`

	// ScreenshotProtected: iOS hint only. The RN side uses this to
	// overlay a privacy mask on the media viewer. Server side is
	// advisory; Android can use FLAG_SECURE for hard blocking but that
	// is device-side, not enforced by the API.
	ScreenshotProtected bool `json:"screenshotProtected"`

	// ScreenshotWarn: if true, when the recipient's device fires a
	// ScreenshotDetected event, the server publishes SECURITY_ALERT
	// back to the sender. This is the "对方截图了我立刻知道" behavior
	// from the RFC.
	ScreenshotWarn bool `json:"screenshotWarn"`

	// ViewLimit: 0 means unlimited. When > 0, the recipient's Nth read
	// flips the message to expired on the server. Sender's view always
	// succeeds.
	ViewLimit int `json:"viewLimit,omitempty"`

	// ViewCount: monotonically incremented each time a non-sender
	// participant reads the message. Persisted alongside the message.
	ViewCount int `json:"viewCount"`

	// TTLDuration: convenience field. The server canonicalizes it into
	// ExpiresAt. Not returned to clients.
	TTLDuration time.Duration `json:"-"`

	// ExpiresAt: wall-clock cutoff. The server returns MESSAGE_EXPIRED
	// for any read after this point.
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`

	// COMP-E2EE-001: EndToEndEncrypted 此前恒为 true，注释里写的原因是
	// 「transport TLS + at-rest KMS」。那不是端到端加密 —— TLS 是传输层
	// 加密，KMS 是服务端静态加密，两种情况下服务端都能读到明文。
	//
	// 对外宣称 E2EE 而实际做不到，是虚假安全声明：用户会以为连平台都看
	// 不到内容，从而说出他不会说的话。而且付费会话按 COMP-CHAT-001 必须
	// 保留可审计记录，本来就与真正的 E2EE 互斥。
	//
	// 所以这个字段恒为 false：要么真的实现 E2EE（那时付费会话要先解决
	// 可审计性），要么就别挂那把锁。发送路径会再次强制置 false，
	// 调用方改不回去（见 WithoutUnbackedClaims）。
	EndToEndEncrypted bool `json:"endToEndEncrypted"`
}

// WithoutUnbackedClaims 去掉平台兑现不了的声明。
//
// 目前只有一条：端到端加密。默认与发送路径都会过这一道，客户端传上来的
// protectionOverride 也不能把它改回 true —— 安全声明必须由服务端说了算，
// 不能由调用方自称。
func (p MessageProtection) WithoutUnbackedClaims() MessageProtection {
	p.EndToEndEncrypted = false
	return p
}

// ClaimsEndToEndEncryption 是给门禁与审计用的显式的「有没有在宣称 E2EE」。
// 平台当前没有端到端加密实现，因此恒为 false。
func (p MessageProtection) ClaimsEndToEndEncryption() bool { return p.EndToEndEncrypted }

// MarshalJSON 在序列化边界把端到端加密声明钉成 false。
//
// 为什么要在这一层再钉一次：库里已经存着的旧消息，protection JSON 里带着
// endToEndEncrypted: true。改默认值只影响新消息，旧消息仍会被读出来发给
// 客户端。安全声明是给用户看的，只要有一条出口还在宣称，就等于没改。
// 这里兜底后，不论数据多旧、调用方怎么构造，响应里都不会再出现那把锁。
func (p MessageProtection) MarshalJSON() ([]byte, error) {
	// shadow 不带 MarshalJSON 方法，避免无限递归。
	type shadow MessageProtection
	out := shadow(p)
	out.EndToEndEncrypted = false
	return json.Marshal(out)
}

// IsExpiredAt reports whether the message is past its expiration.
func (p MessageProtection) IsExpiredAt(now time.Time) bool {
	if p.ExpiresAt == nil {
		return false
	}
	return !now.Before(*p.ExpiresAt)
}

// ViewLimitExceeded reports whether the view count has reached the limit.
func (p MessageProtection) ViewLimitExceeded() bool {
	return p.ViewLimit > 0 && p.ViewCount >= p.ViewLimit
}

// DefaultProtectionFor returns the per-type defaults from RFC §3.3.
// The caller (SendMessage command) layers the user's overrides on top.
//
//	TEXT (DM)        : no forward, screenshot warn, unlimited views, 30d TTL
//	IMAGE (DM)       : no forward, screenshot warn, 3 views, 30d TTL
//	VIDEO (DM)       : no forward, screenshot warn, 1 view, 30d TTL
//	LOCATION (DM)    : no forward, screenshot warn, 1 view, 1h TTL
//	TEXT (GROUP)     : forwardable, no screenshot warn, unlimited views, 30d TTL
//	IMAGE (GROUP)    : forwardable, screenshot warn, unlimited views, 30d TTL
//
// SYSTEM_CONTEXT and STRUCTURED_SUGGESTION are server-generated, so their
// protection is a no-op (forwardable, no warn, no view limit, no TTL).
func DefaultProtectionFor(messageType, conversationType string) MessageProtection {
	now := time.Now().UTC()
	in30d := now.Add(30 * 24 * time.Hour)
	in1h := now.Add(time.Hour)
	switch messageType {
	case "TEXT":
		if conversationType == "GROUP" {
			return MessageProtection{
				Forwardable:       true,
				Copyable:          true,
				ScreenshotWarn:    false,
				ExpiresAt:         &in30d,
				EndToEndEncrypted: false,
			}
		}
		return MessageProtection{
			Forwardable:       false,
			Copyable:          false,
			ScreenshotWarn:    true,
			ExpiresAt:         &in30d,
			EndToEndEncrypted: false,
		}
	case "IMAGE":
		if conversationType == "GROUP" {
			return MessageProtection{
				Forwardable:       true,
				Copyable:          false,
				ScreenshotWarn:    true,
				ExpiresAt:         &in30d,
				EndToEndEncrypted: false,
			}
		}
		return MessageProtection{
			Forwardable:         false,
			Copyable:            false,
			ScreenshotProtected: true,
			ScreenshotWarn:      true,
			ViewLimit:           3,
			ExpiresAt:           &in30d,
			EndToEndEncrypted: false,
		}
	case "VIDEO", "AUDIO":
		// RFC defines VIDEO for DM. Group video uses IMAGE protection.
		return MessageProtection{
			Forwardable:         false,
			Copyable:            false,
			ScreenshotProtected: true,
			ScreenshotWarn:      true,
			ViewLimit:           1,
			ExpiresAt:           &in30d,
			EndToEndEncrypted: false,
		}
	case "LOCATION":
		return MessageProtection{
			Forwardable:         false,
			Copyable:            false,
			ScreenshotProtected: true,
			ScreenshotWarn:      true,
			ViewLimit:           1,
			ExpiresAt:           &in1h,
			EndToEndEncrypted: false,
		}
	case "CONTACT":
		// CONTACT-CARD-001：名片和位置正好相反 —— 位置的默认值是「看一次、一小时后
		// 消失」，因为坐标是此刻的隐私；**名片的意义就是被转出去**（把 B 推荐给 C
		// 是这个功能的全部）。照抄 LOCATION 会让它自相矛盾：能发、不能转、一小时
		// 后变成一张空白卡。
		//
		// 所以：可转发、可复制、无查看次数上限、不警告截图（名片就是要给人看的），
		// 30 天过期与其它消息一致。DM 与 GROUP 同规则 —— 名片在两种会话里都是
		// 「拿去用」而不是「只能你看」。
		return MessageProtection{
			Forwardable:       true,
			Copyable:          true,
			ScreenshotWarn:    false,
			ExpiresAt:         &in30d,
			EndToEndEncrypted: false,
		}
	case "SYSTEM_CONTEXT", "STRUCTURED_SUGGESTION":
		// Server-generated. Always forwardable, never expires.
		return MessageProtection{
			Forwardable:       true,
			Copyable:          true,
			ScreenshotWarn:    false,
			EndToEndEncrypted: false,
		}
	}
	// Unknown — fail closed: no forward, warn, 30d.
	return MessageProtection{
		Forwardable:       false,
		ScreenshotWarn:    true,
		ExpiresAt:         &in30d,
		EndToEndEncrypted: false,
	}
}

// ProtectionOverride is the user-controlled layer. The caller (SendMessage
// command) merges this on top of DefaultProtectionFor.
//
// Validation rules (enforced by Apply):
//   - ViewLimit must be in [0, 100] (0 = unlimited)
//   - TTLDuration must be in [0, 365 days]
//   - If ForwardableOverride is non-nil, the boolean applies (no
//     validation — user is explicit)
type ProtectionOverride struct {
	Forwardable *bool          `json:"forwardable,omitempty"`
	Copyable    *bool          `json:"copyable,omitempty"`
	Warn        *bool          `json:"warn,omitempty"`
	ViewLimit   *int           `json:"viewLimit,omitempty"`
	TTL         *time.Duration `json:"ttlSeconds,omitempty"` // seconds for JSON
}

// AsDuration is a helper to read TTL as time.Duration.
func (o ProtectionOverride) TTLAsDuration() time.Duration {
	if o.TTL == nil {
		return 0
	}
	return *o.TTL
}

var (
	ErrProtectionViewLimitOutOfRange = errors.New("view limit out of range [0,100]")
	ErrProtectionTTLOutOfRange       = errors.New("ttl out of range [0,365d]")
)

// Apply layers the override on top of the base protection. It mutates
// and returns a copy. Validation errors are returned, never panic.
//
// `now` must be supplied by the caller so test code can use a
// deterministic clock. In production this is s.clock.Now().UTC().
func Apply(base MessageProtection, override ProtectionOverride, now time.Time) (MessageProtection, error) {
	out := base
	if override.Forwardable != nil {
		out.Forwardable = *override.Forwardable
	}
	if override.Copyable != nil {
		out.Copyable = *override.Copyable
	}
	if override.Warn != nil {
		out.ScreenshotWarn = *override.Warn
	}
	if override.ViewLimit != nil {
		v := *override.ViewLimit
		if v < 0 || v > 100 {
			return MessageProtection{}, ErrProtectionViewLimitOutOfRange
		}
		out.ViewLimit = v
	}
	if override.TTL != nil {
		d := *override.TTL
		if d < 0 || d > 365*24*time.Hour {
			return MessageProtection{}, ErrProtectionTTLOutOfRange
		}
		exp := now.Add(d)
		out.ExpiresAt = &exp
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// COMP-CHAT-001 — transaction-linked conversations must stay auditable.
//
// A marketplace where both parties can make a paid meet-up untraceable
// (burn-after-read, view caps, screenshot blocking) is the fact pattern used
// to argue the platform knowingly facilitated brokering. The anti-leak knobs
// stay for social conversations; they are switched off and locked off
// wherever money changes hands between users.
// ---------------------------------------------------------------------------

// TransactionLinkedOrigins are conversation origins that carry a commercial
// transaction between two users. These threads are business evidence.
var TransactionLinkedOrigins = map[string]bool{
	"TASK":     true,
	"SERVICE":  true,
	"ACTIVITY": true,
	"NEED":     true,
	"OFFER":    true,
	"ORDER":    true,
}

// IsTransactionLinkedOrigin reports whether the origin carries money.
func IsTransactionLinkedOrigin(originType string) bool {
	return TransactionLinkedOrigins[strings.ToUpper(strings.TrimSpace(originType))]
}

// ErrEphemeralNotAllowed is returned when a caller tries to make a
// transaction-linked message disappear.
var ErrEphemeralNotAllowed = errors.New("ephemeral messaging is disabled on transaction-linked conversations")

// TransactionLinkedProtection is the auditable envelope: nothing expires,
// nothing is view-capped, forwarding and screenshots stay available.
func TransactionLinkedProtection() MessageProtection {
	return MessageProtection{
		Forwardable:         true,
		Copyable:            true,
		ScreenshotProtected: false,
		ScreenshotWarn:      false,
		ViewLimit:           0,
		ExpiresAt:           nil,
		EndToEndEncrypted:   false,
	}
}

// EphemeralityPolicy decides which anti-leak knobs a caller may move.
type EphemeralityPolicy struct {
	AllowViewLimit bool
	AllowTTL       bool
	AllowAntiLeak  bool
}

// PolicyForOrigin returns the ephemerality policy for a conversation origin.
// Transaction-linked origins get an all-false policy: locked down.
func PolicyForOrigin(originType string) EphemeralityPolicy {
	if IsTransactionLinkedOrigin(originType) {
		return EphemeralityPolicy{}
	}
	return EphemeralityPolicy{AllowViewLimit: true, AllowTTL: true, AllowAntiLeak: true}
}

// ApplyWithPolicy layers the override on top of base, refusing any override
// the policy does not allow. Plain Apply stays for social conversations.
func ApplyWithPolicy(base MessageProtection, override ProtectionOverride, now time.Time, policy EphemeralityPolicy) (MessageProtection, error) {
	out := base
	if override.Forwardable != nil {
		if !policy.AllowAntiLeak {
			return MessageProtection{}, ErrEphemeralNotAllowed
		}
		out.Forwardable = *override.Forwardable
	}
	if override.Copyable != nil {
		if !policy.AllowAntiLeak {
			return MessageProtection{}, ErrEphemeralNotAllowed
		}
		out.Copyable = *override.Copyable
	}
	if override.Warn != nil {
		if !policy.AllowAntiLeak {
			return MessageProtection{}, ErrEphemeralNotAllowed
		}
		out.ScreenshotWarn = *override.Warn
	}
	if override.ViewLimit != nil {
		if !policy.AllowViewLimit {
			return MessageProtection{}, ErrEphemeralNotAllowed
		}
		v := *override.ViewLimit
		if v < 0 || v > 100 {
			return MessageProtection{}, ErrProtectionViewLimitOutOfRange
		}
		out.ViewLimit = v
	}
	if override.TTL != nil {
		if !policy.AllowTTL {
			return MessageProtection{}, ErrEphemeralNotAllowed
		}
		d := *override.TTL
		if d < 0 || d > 365*24*time.Hour {
			return MessageProtection{}, ErrProtectionTTLOutOfRange
		}
		exp := now.Add(d)
		out.ExpiresAt = &exp
	}
	return out, nil
}
