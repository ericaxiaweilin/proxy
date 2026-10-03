package notification

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// NOTIF-PUSH-001 —— 推送的**取目标**与**分发**。
//
// 修管线（NOTIF-PIPELINE-001）时我说「推送就绪、通道为空」。这个文件补的是通道，
// 但真正缺的其实不是发送代码 —— 是**取目标的口**：`Repository` 只有
// `GetDeviceToken(userAccountID, deviceID)`，而推送这一侧只知道**收件人**，
// 不知道 deviceID。所以哪怕写一个 APNs 客户端，它也无从知道该推给哪台设备。
//
// 这个文件把链路补齐成三步：
//
//	PushDispatcher.Push(item)
//	  → DeviceTokenLister.ListDeviceTokens(item.RecipientID)   ← 收件人 → 设备
//	  → 按 Platform 选 PushSender                              ← IOS / ANDROID
//	  → PushSender.Send(token, message)                        ← 真正出门
//
// 三个边界都是接口，所以整条链路可以在**没有网络、没有凭据**的情况下单测：
// 假 lister + 假 sender 就能钉住「一条通知推给了几台设备、推给了谁、推的是什么」。
// 真实的 APNs/FCM 客户端在 push_apns.go / push_fcm.go。

// PushMessage 是「要出现在用户锁屏上的那一句话」。
//
// 和 InboxItem 分开是有意的：inbox 是**应用内**的记录，推送是**应用外**的通知，
// 两者的字段会分叉（推送要 collapse key 来避免刷屏，inbox 不需要）。
// 硬把 InboxItem 传给发送器会让这两个概念永远绑死。
type PushMessage struct {
	Title    string
	Body     string
	DeepLink string
	// Type 会作为自定义字段带给客户端，用于点击后决定去哪。
	Type string
	// CollapseKey 让同一类通知在锁屏上**替换**而不是堆叠
	// （APNs 的 apns-collapse-id / FCM 的 collapse_key）。
	// 空字符串 = 不折叠。
	CollapseKey string
}

// PushSender 把一条消息送到**一台**设备。实现要自己处理凭据与传输。
type PushSender interface {
	Send(ctx context.Context, token DeviceToken, msg PushMessage) error
}

// DeviceTokenLister 是分发器需要的那一片 Repository。
// 单独抽出来是为了让分发器不依赖整个 Repository（也和 Pipeline 依赖 Producer 同理）。
type DeviceTokenLister interface {
	ListDeviceTokens(ctx context.Context, userAccountID string) ([]DeviceToken, error)
}

// DeviceTokenRetirer 让分发器把 APNs/FCM **明确告知已失效**的令牌退役。
//
// 可选能力：不实现只是每次多付一次注定失败的往返（用户卸载后我们就一直推、
// 一直失败）。实现了链路就自愈 —— 这是把「推送失败」从噪音变成动作的那一步。
type DeviceTokenRetirer interface {
	DeactivateDeviceToken(ctx context.Context, tokenID string) error
}

// PushDispatcher 实现 PushProvider：把一个 InboxItem 展开成「推给这个收件人的
// 每一台 ACTIVE 设备」。
//
// 关键决定：**一台设备失败不影响其它设备**。用户在手机和平板上都装了 App，
// 手机上推失败不该让平板也收不到。所以这里累积错误而不是提前返回，
// 并且返回一个聚合错误让调用方（管线）能记日志。
//
// 但**没有设备**不是错误：绝大多数用户还没注册设备令牌，那只是「没得推」，
// 记一行日志即可 —— 把它当错误会让管线日志被噪音淹没。
type PushDispatcher struct {
	tokens  DeviceTokenLister
	ios     PushSender
	android PushSender
}

func NewPushDispatcher(tokens DeviceTokenLister, ios, android PushSender) *PushDispatcher {
	return &PushDispatcher{tokens: tokens, ios: ios, android: android}
}

func (d *PushDispatcher) Push(ctx context.Context, item InboxItem) error {
	if d == nil || d.tokens == nil {
		return nil
	}
	tokens, err := d.tokens.ListDeviceTokens(ctx, item.RecipientID)
	if err != nil {
		return fmt.Errorf("push: list device tokens for %s: %w", item.RecipientID, err)
	}
	if len(tokens) == 0 {
		// 没得推不是失败。真实世界里这是常态（用户没给通知权限就没有令牌）。
		return nil
	}
	msg := PushMessage{
		Title:    item.Title,
		Body:     item.Body,
		DeepLink: item.DeepLink,
		Type:     item.Type,
		// 同一类 + 同一个收件人折叠：用户连收 5 条 OfferCreated 时锁屏上
		// 应该是 1 条最新的，不是 5 条。
		CollapseKey: collapseKeyFor(item),
	}
	var failures []string
	sent := 0
	retired := 0
	for _, token := range tokens {
		sender := d.senderFor(token.Platform)
		if sender == nil {
			failures = append(failures, fmt.Sprintf("%s/%s: no sender for platform", token.ID, token.Platform))
			continue
		}
		if err := sender.Send(ctx, token, msg); err != nil {
			// 失效令牌**退役**，不要留着重试：用户卸载后我们会永远为它推、
			// 永远失败，日志里堆满噪音而没人知道该做什么。
			if errors.Is(err, ErrDeviceTokenUnregistered) && d.retire(ctx, token.ID) {
				retired++
			}
			failures = append(failures, fmt.Sprintf("%s/%s: %v", token.ID, token.Platform, err))
			continue
		}
		sent++
	}
	if len(failures) > 0 {
		// 全失败才算错误；部分成功也返回错误，但把成功数写进消息里 ——
		// 「3 台里推成 2 台」和「一台都没推成」需要能被区分。
		note := ""
		if retired > 0 {
			note = fmt.Sprintf(" (%d unregistered token(s) retired)", retired)
		}
		return fmt.Errorf("push: %d/%d delivered for %s%s: %s", sent, len(tokens), item.RecipientID, note, strings.Join(failures, "; "))
	}
	return nil
}

// retire 尽力退役一个失效令牌；失败只影响下次是否还会重试，不该让推送本身报错。
func (d *PushDispatcher) retire(ctx context.Context, tokenID string) bool {
	retirer, ok := d.tokens.(DeviceTokenRetirer)
	if !ok || tokenID == "" {
		return false
	}
	return retirer.DeactivateDeviceToken(ctx, tokenID) == nil
}

func (d *PushDispatcher) senderFor(platform string) PushSender {
	switch strings.ToUpper(strings.TrimSpace(platform)) {
	case "IOS":
		return d.ios
	case "ANDROID":
		return d.android
	default:
		// 未知平台**不猜**：猜 IOS 会把 Android 令牌发给 APNs，换来一个
		// 看不懂的 400。宁可记一条「没有这个平台的发送器」。
		return nil
	}
}

// collapseKeyFor 让「同一个收件人的同一类通知」在锁屏上折叠成一条。
//
// 带上收件人是必须的：不加的话，A 的「订单已成立」会把 B 的顶掉
// —— collapse id 是**设备侧**的语义，但我们无法预知一台设备登录过谁。
func collapseKeyFor(item InboxItem) string {
	if item.Type == "" {
		return ""
	}
	return item.Type + ":" + item.RecipientID
}

// PushConfig 是推送通道的部署配置（全部来自环境变量，见 PushProviderFromEnv）。
type PushConfig struct {
	// APNs
	APNsKeyPath string // .p8 私钥文件路径
	APNsKeyID   string // Apple 后台的 Key ID
	APNsTeamID  string // Team ID（JWT 的 iss）
	APNsTopic   string // 通常是 bundle id
	APNsSandbox bool   // 真机 dev 构建走 sandbox 网关
	// FCM
	FCMServiceAccountPath string // service account JSON
}

// Configured 报告这份配置里是否至少有一条真通道。
func (c PushConfig) Configured() bool {
	return c.APNsConfigured() || c.FCMConfigured()
}

func (c PushConfig) APNsConfigured() bool {
	return c.APNsKeyPath != "" && c.APNsKeyID != "" && c.APNsTeamID != "" && c.APNsTopic != ""
}

func (c PushConfig) FCMConfigured() bool {
	return c.FCMServiceAccountPath != ""
}

// Describe 是给启动日志用的一句话。**必须能区分「没配凭据」和「配了但只有一半」**
// —— 后者是配错了，静默降级成日志推送会让人以为推送已经上线。
func (c PushConfig) Describe() string {
	var parts []string
	if c.APNsConfigured() {
		gateway := "production"
		if c.APNsSandbox {
			gateway = "sandbox"
		}
		parts = append(parts, "apns("+gateway+",topic="+c.APNsTopic+")")
	} else if c.APNsKeyPath != "" || c.APNsKeyID != "" || c.APNsTeamID != "" {
		parts = append(parts, "apns=INCOMPLETE(missing keyId/teamId/keyPath/topic)")
	}
	if c.FCMConfigured() {
		parts = append(parts, "fcm("+c.FCMServiceAccountPath+")")
	}
	if len(parts) == 0 {
		return "no push credentials configured (inbox stays durable; nothing is delivered off-device)"
	}
	return "device push enabled: " + strings.Join(parts, " + ")
}

// PushConfigFromEnv 只读环境变量，**不碰文件系统**。
//
// 读私钥文件放在构造发送器的时候（NewAPNsSenderFromConfig），这样
// 「配置缺失」和「配置指向一个读不了的文件」是两种不同的错误，而不是一个
// 笼统的启动失败。
func PushConfigFromEnv(getenv func(string) string) PushConfig {
	if getenv == nil {
		return PushConfig{}
	}
	return PushConfig{
		APNsKeyPath:           strings.TrimSpace(getenv("APNS_KEY_PATH")),
		APNsKeyID:             strings.TrimSpace(getenv("APNS_KEY_ID")),
		APNsTeamID:            strings.TrimSpace(getenv("APNS_TEAM_ID")),
		APNsTopic:             strings.TrimSpace(getenv("APNS_TOPIC")),
		APNsSandbox:           isTruthy(getenv("APNS_SANDBOX")),
		FCMServiceAccountPath: strings.TrimSpace(getenv("FCM_SERVICE_ACCOUNT_PATH")),
	}
}

func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
