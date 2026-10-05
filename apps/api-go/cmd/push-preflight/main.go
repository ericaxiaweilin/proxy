// push-preflight 回答一个问题：**APNs 证书配好之后，推送到底能不能通。**
//
// 为什么需要这个命令：推送这件事横跨四段，任何一段没做对，最后的现象都是
// 「手机没收到」—— 而现象完全不指向原因：
//
//	证书/凭据 → 服务端环境变量 → APNs 可达性 → 手机上的令牌 → 二进制里的原生模块
//
// 没有证书的时候，这四段都没法验证，于是每次都是「装上证书 → 跑一次 → 没收到 →
// 猜是哪一段」。这个命令把能离线验证的那几段一次验完，缺什么直接印出该执行什么。
//
// 它**不发送任何推送**，只是用真实的构造函数把凭据读一遍、解析一遍。所以它不需要
// 网络、不需要 APNs 账号，也不会打扰任何真机。
//
// 退出码：至少一条通道可用 → 0；一条都不可用 → 1（可以被 CI 当成门禁用）。
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/proxy-app/proxy-api/internal/notification"
)

func main() {
	cfg := notification.PushConfigFromEnv(os.Getenv)

	fmt.Println("push-preflight —— 设备推送凭据体检")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println("服务端：", cfg.Describe())
	fmt.Println()

	usable := 0

	// ── APNs ────────────────────────────────────────────────────────────────
	//
	// 逐项列出，因为「配了一半」是最常见的失败：设了 key path 但没给 team id，
	// 启动日志只会印一句 apns=INCOMPLETE，看不出少了哪一项。
	switch {
	case cfg.APNsConfigured():
		if sender, err := notification.NewAPNsSenderFromConfig(cfg); err != nil {
			fmt.Printf("APNs  ✗ 变量齐全，但凭据不可用：%v\n", err)
		} else if sender == nil {
			fmt.Println("APNs  ✗ 构造函数返回了空发送器")
		} else {
			gateway := "production"
			if cfg.APNsSandbox {
				gateway = "sandbox"
			}
			fmt.Printf("APNs  ✓ 可用（%s 网关，topic=%s）\n", gateway, cfg.APNsTopic)
			usable++
		}
	default:
		fmt.Println("APNs  ✗ 未配齐")
	}

	for _, item := range []struct {
		name  string
		value string
		how   string
	}{
		{"APNS_KEY_PATH", cfg.APNsKeyPath, "Apple 后台 → Keys → 下载 .p8，放到只有 worker 能读的地方"},
		{"APNS_KEY_ID", cfg.APNsKeyID, "同一页面的 Key ID（10 位）"},
		{"APNS_TEAM_ID", cfg.APNsTeamID, "Membership → Team ID（10 位）"},
		{"APNS_TOPIC", cfg.APNsTopic, "App 的 bundle id，必须和证书里的 topic 完全一致"},
	} {
		if item.value == "" {
			fmt.Printf("        缺 %-14s → %s\n", item.name, item.how)
		}
	}

	// sandbox 这条值得单独提醒：dev 构建的令牌和 production 是两套，令牌对不上时
	// APNs 会回 BadDeviceToken，而症状看起来和「证书没配好」一模一样。
	if cfg.APNsConfigured() && !cfg.APNsSandbox {
		fmt.Println("        提醒：dev/测试构建必须 APNS_SANDBOX=1，否则令牌对不上（症状同样是没收到推送）")
	}
	fmt.Println()

	// ── FCM ─────────────────────────────────────────────────────────────────
	switch {
	case cfg.FCMConfigured():
		if sender, err := notification.NewFCMSenderFromConfig(cfg); err != nil {
			fmt.Printf("FCM   ✗ service account 文件不可用：%v\n", err)
		} else if sender == nil {
			fmt.Println("FCM   ✗ 构造函数返回了空发送器")
		} else {
			fmt.Printf("FCM   ✓ 可用（%s）\n", cfg.FCMServiceAccountPath)
			usable++
		}
	default:
		fmt.Println("FCM   ✗ 未配（只有 Android 需要；纯 iOS 项目可以一直不管）")
	}
	fmt.Println()

	// ── 最后一段：这一段在**手机**上，本命令验不了 ───────────────────────────
	//
	// 写在这里是因为它是整条链上唯一一个「配好了也照样收不到」的环节：
	// 服务端一旦有令牌就会尝试投递，而令牌要靠客户端那几行代码注册上来。
	// Apple Developer 账号 + 证书都齐了，但 EXPO_PUBLIC_PUSH 没设成 1，
	// device_tokens 表就永远是空的 —— 服务端一切正常，什么都推不出去。
	fmt.Println("最后一段（本命令验不了，必须在手机构建里做）：")
	fmt.Println("  1. EXPO_PUBLIC_PUSH=1 —— 不设就是 NOTIF-PUSH-NATIVE-GUARD-001 说的")
	fmt.Println("     「二进制没重建就不 import」，令牌永远不上报。")
	fmt.Println("  2. 重建带推送能力的二进制（光设环境变量不重建 = 原生模块不在包里）")
	fmt.Println("  3. 确认 device_tokens 真的多了行：")
	fmt.Println("     psql -c \"SELECT platform, status, count(*) FROM notification.device_tokens GROUP BY 1,2\"")
	fmt.Println("     0 行 = 客户端那一跳没通，问题不在证书。")
	fmt.Println()

	if usable == 0 {
		fmt.Println("结论：没有一条通道可用 —— 现在推送不会离机发送。")
		fmt.Println("      站内收件箱照常工作（durable），不受影响。")
		os.Exit(1)
	}
	fmt.Printf("结论：%d 条通道可用。下一步按上面的最后一段把客户端接上。\n", usable)
}
