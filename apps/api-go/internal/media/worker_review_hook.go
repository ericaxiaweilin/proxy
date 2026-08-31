package media

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/proxy-app/proxy-api/internal/command"
)

// AutoReviewHook — R15.17 遗留 5 轮的 AI 审核骨架
// 轮询 QUARANTINED 资产，调 stub classifier，自动产生 ReviewMediaAsset 决策
// 写入 media_review_decisions + asset 状态机。
//
// 设计约束：
//   - 默认关闭：需 PROXY_MEDIA_AUTO_REVIEW=1 显式开启（避免与人工审核/其他 composition pipeline 冲突）
//   - classifier 为可替换接口：当前 StubHeuristicClassifier 只做几何启发式，未来替换为 NSFW / 政治 / 暴力模型
//   - 失败重试不阻塞主链：单资产失败仅 log，下一轮再试
//   - operator_id 固定为 system_auto，audit 可追溯且不占 operator 白名单

type Classifier interface {
	Classify(asset MediaAsset) (reason string, confidence float64)
}

type StubHeuristicClassifier struct{}

func (StubHeuristicClassifier) Classify(asset MediaAsset) (string, float64) {
	// 纯几何示意：极小图（< 10k 像素）视为技术质量不足但不判内容；中大图全部 APPROVE
	// 真实黄/政/暴力样本绝不在 fixture 中构造，见 R15.16 遗留说明
	if asset.MediaType == "IMAGE" && asset.Width > 0 && asset.Height > 0 && asset.Width*asset.Height < 10000 {
		return "APPROVE", 0.55
	}
	// 演示：若 LastError 含测试标记则触发对应 REJECT（仅 e2e fixture 用，不落真实数据）
	if strings.Contains(strings.ToLower(asset.LastError), "test_nudity") {
		return "REJECT_NUDITY", 0.92
	}
	if strings.Contains(strings.ToLower(asset.LastError), "test_politics") {
		return "REJECT_POLITICS", 0.91
	}
	if strings.Contains(strings.ToLower(asset.LastError), "test_violence") {
		return "REJECT_VIOLENCE", 0.93
	}
	return "APPROVE", 0.88
}

func autoReviewEnabled() bool {
	v := strings.TrimSpace(os.Getenv("PROXY_MEDIA_AUTO_REVIEW"))
	return v == "1" || strings.EqualFold(v, "true")
}

// RunAutoReviewOnce 扫描一次 QUARANTINED 资产并自动审核，返回处理数
func (s *Service) RunAutoReviewOnce(ctx context.Context, classifier Classifier) (int, error) {
	if !autoReviewEnabled() {
		return 0, nil
	}
	if classifier == nil {
		classifier = StubHeuristicClassifier{}
	}
	assets, err := s.repository.Snapshot(ctx)
	if err != nil {
		return 0, err
	}
	handled := 0
	for _, asset := range assets {
		if asset.ModerationStatus != "QUARANTINED" {
			continue
		}
		reason, _ := classifier.Classify(asset)
		if _, ok := reviewReasonToStatus[reason]; !ok {
			continue
		}
		// 构造内部 envelope，绕过 OperatorGate（worker 为系统身份）
		env := command.Envelope{
			CommandID:      "auto_" + asset.MediaAssetID + "_" + time.Now().Format("150405.000"),
			CommandType:    "ReviewMediaAsset",
			CommandVersion: 1,
			Actor:          command.Actor{Type: "SYSTEM", ID: "system_auto"},
			Principal:      command.Principal{Type: "SYSTEM", ID: "system_auto"},
			Target:         command.Target{Type: "MediaAsset", ID: asset.MediaAssetID},
			IdempotencyKey: "auto_review_" + asset.MediaAssetID,
			Purpose:        "auto_review",
			CorrelationID:  "auto_review_" + asset.MediaAssetID,
			RequestedAt:    time.Now().UTC().Format(time.RFC3339),
			AuthContext:    map[string]any{"auto": true},
			Payload:        map[string]any{"reason": reason, "note": "auto:heuristic"},
		}
		result := s.HandleContext(ctx, env)
		if result.Outcome == "ACCEPTED" {
			handled++
			log.Printf("auto_review: %s %s → %s", asset.MediaAssetID, asset.ModerationStatus, reason)
		} else if result.Error != nil {
			log.Printf("auto_review skip %s: %s", asset.MediaAssetID, result.Error.ErrorCode)
		}
		// 限速：每批最多 20，避免突发打爆 DB
		if handled >= 20 {
			break
		}
	}
	return handled, nil
}
