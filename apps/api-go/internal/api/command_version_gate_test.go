package api

import "testing"

// COMMAND-VERSION-001：命令版本必须有上界。
//
// 逃逸经过：validateEnvelope 原本只拒 `CommandVersion <= 0`（当成"缺字段"），
// 上界完全没有。客户端发 `commandVersion: 9999` 会被**当 v1 处理**并正常执行 ——
// 服务回 200，客户端以为自己的新语义生效了，实际服务端按老规则处理了。
// openapi 那边写的是 `commandVersion: { type: integer, minimum: 1 }`，也只有下界，
// 等于契约本身没表达"只支持 v1"。两边一起补。
func TestUnsupportedCommandVersionIsRejected(t *testing.T) {
	base := envelopeWithTargetID("post_1")

	// 支持的版本必须照常通过 —— 版本闸门不能变成"什么都不让过"。
	if got := validateEnvelope(base, "ListPostsByIds"); got != nil {
		t.Fatalf("v%d 必须通过校验，实际: %+v", SupportedCommandVersion, got.Error)
	}

	// 上界之外一律拒，且要给客户端**能据以行动**的错误：它得知道是"你太新了"，
	// 而不是"你发错了字段"，因为正确反应是升级客户端而不是改请求。
	for _, v := range []int{2, 3, 9999} {
		env := base
		env.CommandVersion = v
		got := validateEnvelope(env, "ListPostsByIds")
		if got == nil {
			t.Fatalf("commandVersion=%d 必须被拒：它不是契约的一部分，当 v1 跑就是静默误读", v)
		}
		if got.Error.ErrorCode != "UNSUPPORTED_COMMAND_VERSION" {
			t.Fatalf("commandVersion=%d 的错误码应是 UNSUPPORTED_COMMAND_VERSION（客户端据此升级），实际 %q", v, got.Error.ErrorCode)
		}
		// 重试没有意义 —— 服务端不会因为重发而变得更新。
		if got.Error.Retryability != "NO" {
			t.Fatalf("commandVersion=%d 不该可重试（retryability=NO），实际 %q", v, got.Error.Retryability)
		}
		// safeDetails 必须带上双方版本，否则客户端不知道该降到哪一版。
		if got.Error.SafeDetails["supportedVersion"] != SupportedCommandVersion {
			t.Fatalf("commandVersion=%d 的 safeDetails 必须说明支持的版本，实际 %+v", v, got.Error.SafeDetails)
		}
		if got.Error.SafeDetails["receivedVersion"] != v {
			t.Fatalf("commandVersion=%d 的 safeDetails 必须回显收到的版本，实际 %+v", v, got.Error.SafeDetails)
		}
	}

	// <= 0 仍然走"缺字段"那条老路（INVALID_COMMAND_ENVELOPE + field=commandVersion），
	// 不该被版本闸门改写 —— 0 和 9999 的排查方向不同：前者是发错，后者是太新。
	for _, v := range []int{0, -1} {
		env := base
		env.CommandVersion = v
		got := validateEnvelope(env, "ListPostsByIds")
		if got == nil {
			t.Fatalf("commandVersion=%d 必须被拒", v)
		}
		if got.Error.ErrorCode != "INVALID_COMMAND_ENVELOPE" {
			t.Fatalf("commandVersion=%d 应报 INVALID_COMMAND_ENVELOPE（缺字段），实际 %q", v, got.Error.ErrorCode)
		}
		if got.Error.SafeDetails["field"] != "commandVersion" {
			t.Fatalf("commandVersion=%d 的 safeDetails.field 应为 commandVersion，实际 %+v", v, got.Error.SafeDetails)
		}
	}
}
