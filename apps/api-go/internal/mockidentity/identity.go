// Package mockidentity 是 mock 人物身份的**唯一事实源**（IDENTITY-ID-001）。
//
// 背景（实测）：同一个显示名 "Linh" 曾在 4 个地方各自硬编码 ——
//
//	cmd/api/main.go（发布订单候选，randomuser 外链）
//	internal/realityscene/service.go（场景真人，unsplash 外链）
//	internal/facet/service.go（朋友/关系）
//	internal/citycompanion/ internal/localnet/（城市协助作者名）
//
// 于是同一个人在首页和发布订单各显示一张头像，且无法判断是否同一个人。
//
// 规矩（用户要求）：
//   - 身份 = 系统生成的账号 id（不可变、唯一、与显示名解耦）；
//   - 显示名可编辑、可重复（由注册邮箱派生初值），改名字不影响身份；
//   - 头像来自该账号的媒体资产（identity.profiles.avatar_path = assets/<id>）；
//   - 任何 surface 都经本包按 facet 键取身份，**不得**各自硬编码姓名/头像。
package mockidentity

// CreatorFacetKeys 是 mock Creator 的固定 facet 键（种子与各 surface 共用）。
var CreatorFacetKeys = []string{"linh", "mai", "an", "thao", "yen", "minh"}

// AccountIDForFacetKey 返回 facet 键对应的系统账号 id。
func AccountIDForFacetKey(key string) string {
	return "user_mockcreator_" + key
}

// AvatarAssetIDForFacetKey 返回该账号头像所在的媒体资产 id。
func AvatarAssetIDForFacetKey(key string) string {
	return "ma_creator_" + key + "_portrait_v1"
}

// AvatarPathForFacetKey 返回可直接渲染的服务端头像路径。
// 客户端约定：以 "/" 开头的 photos/头像项按服务端路径处理（拼 API base URL）。
func AvatarPathForFacetKey(key string) string {
	return "/v1/media/thumb/" + AvatarAssetIDForFacetKey(key)
}
