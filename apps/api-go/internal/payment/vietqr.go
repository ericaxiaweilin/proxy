package payment

import (
	"context"
	"fmt"
	"time"
)

// VietQRProvider — 越南银行 App 扫码统一方案（NAPAS VietQR）
// MVP 沙盒：生成 VietQR 字符串（模拟），回调由 ConfirmPaymentIntent 驱动，不自建资金通道
type VietQRProvider struct {
	clock func() time.Time
}

func NewVietQRProvider() *VietQRProvider { return &VietQRProvider{clock: time.Now} }

type VietQRRequest struct {
	OrderID     string
	AmountMinor int64
	Currency    string
	ProviderRef string
}

type VietQRResponse struct {
	ProviderRef string
	QRString    string // 供 App 展示，银行 App 扫码
	ExpiresAt   time.Time
}

func (p *VietQRProvider) CreateQR(ctx context.Context, req VietQRRequest) (VietQRResponse, error) {
	// VietQR 格式简化：VQR|<order>|<amount>|<currency>|<ref>
	// 真实对接时替换为 NAPAS 官方 SDK / 银行聚合网关
	ref := req.ProviderRef
	if ref == "" {
		ref = "vietqr_" + req.OrderID + "_" + fmt.Sprint(time.Now().UnixNano())
	}
	qr := fmt.Sprintf("VQR|%s|%d|%s|%s", req.OrderID, req.AmountMinor, req.Currency, ref)
	return VietQRResponse{
		ProviderRef: ref,
		QRString:    qr,
		ExpiresAt:   p.clock().Add(15 * time.Minute),
	}, nil
}

func (p *VietQRProvider) Refund(ctx context.Context, paymentIntentID string, amountMinor int64) (string, error) {
	return "refund_" + paymentIntentID, nil
}
