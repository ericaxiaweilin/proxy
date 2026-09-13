package conversation

import (
	"encoding/json"
	"strings"
	"testing"
)

// COMP-E2EE-001 — 不许宣称做不到的加密。
//
// EndToEndEncrypted 此前恒为 true，理由写的是「transport TLS + at-rest KMS」。
// 那不是端到端加密：两种情况服务端都能读到明文。对用户挂一把兑现不了的锁
// 是虚假安全声明 —— 他会以为连平台都看不到内容，从而说出他不会说的话。
// 而且付费会话按 COMP-CHAT-001 必须保留可审计记录，本来就与真 E2EE 互斥。
//
// 这组测试钉死三条出口：默认值、发送路径、序列化边界（历史脏数据）。

func TestNoDefaultProtectionClaimsEndToEndEncryption(t *testing.T) {
	types := []string{"TEXT", "IMAGE", "VIDEO", "LOCATION", "SYSTEM_CONTEXT", "STRUCTURED_SUGGESTION"}
	convs := []string{"DM", "GROUP"}
	for _, mt := range types {
		for _, ct := range convs {
			if p := DefaultProtectionFor(mt, ct); p.EndToEndEncrypted {
				t.Fatalf("%s/%s still claims end-to-end encryption", mt, ct)
			}
		}
	}
}

// 交易链路的保护档位同样不许宣称（付费会话本来就必须可审计）。
func TestTransactionLinkedProtectionDoesNotClaimEndToEndEncryption(t *testing.T) {
	if TransactionLinkedProtection().EndToEndEncrypted {
		t.Fatal("paid conversations must not claim end-to-end encryption; they must stay auditable")
	}
}

// 发送路径收口：不论默认值还是调用方给的 protection，一律抹掉。
func TestWithoutUnbackedClaimsStripsEndToEndClaim(t *testing.T) {
	claimed := MessageProtection{EndToEndEncrypted: true, ScreenshotProtected: true}
	if got := claimed.WithoutUnbackedClaims(); got.EndToEndEncrypted {
		t.Fatal("the send path must strip a claim the platform cannot back")
	}
	// 其它字段不受影响 —— 这条只针对 E2EE 声明。
	if !claimed.WithoutUnbackedClaims().ScreenshotProtected {
		t.Fatal("stripping the E2EE claim must not change other protection fields")
	}
}

// 序列化边界兜底：库里存着的旧消息 protection JSON 里带着 true，
// 改默认值管不到它们，但出口必须干净。
func TestMarshalledProtectionNeverClaimsEndToEndEncryption(t *testing.T) {
	stale := MessageProtection{EndToEndEncrypted: true}
	blob, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(blob), `"endToEndEncrypted":true`) {
		t.Fatalf("a stale row still advertises end-to-end encryption on the wire: %s", blob)
	}
	var decoded map[string]any
	if err := json.Unmarshal(blob, &decoded); err != nil {
		t.Fatal(err)
	}
	if v, ok := decoded["endToEndEncrypted"]; !ok || v != false {
		t.Fatalf("endToEndEncrypted must be present and false, got %v", decoded["endToEndEncrypted"])
	}
}

// 去掉恒真的 E2EE 条件后，secure 模式的判定不能变 —— 以前实际生效的一直是
// ScreenshotProtected。这是「改声明不改行为」的护栏。
func TestSecurityModeStillKeyedOnScreenshotProtection(t *testing.T) {
	if mode := protectionToSecurityV1(MessageProtection{ScreenshotProtected: true}).Mode; mode != "secure" {
		t.Fatalf("screenshot-protected messages must still report secure, got %q", mode)
	}
	if mode := protectionToSecurityV1(MessageProtection{ScreenshotProtected: false}).Mode; mode != "normal" {
		t.Fatalf("unprotected messages must still report normal, got %q", mode)
	}
}
