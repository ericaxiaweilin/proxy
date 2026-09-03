# Deprecated / Forbidden Logic Manifest — Master PRD v1.0 Canonical Freeze
> 来源：Master PRD §29 + Gap Audit DEPRECATION-01；CI 会校验生产不可达

| 旧逻辑 | 处理 | 现状校验 |
|--------|------|----------|
| Market “体验 Experience” 一级对象 | DEPRECATED；迁移到 Activity/Opportunity | `experience-client` 仅别名，禁止新建 ExperienceInventory |
| Agent 作为用户侧可见身份 | DEPRECATED；用 Creator/Host/Provider capability | 代码中 `Agent` 字样需重命名检查 |
| 把 Creator 本人作为带价库存 | FORBIDDEN | Market 不展示人物货架 |
| Profile 内二维码主入口 | REMOVED；仅 Add Friend/Relationship Tools | `personalhub` 无 QR，`personalmanage` QR 仅管理页 |
| Profile 首屏大 Available/Scene/准时率 Hero | REMOVED；Threads-like | 已收敛 |
| 首页 For You 推荐区 | FORBIDDEN by IA | Home 无瀑布 |
| AI Native 假手机号/假 KYC | FORBIDDEN |  |
| AI Twin 多矩阵公开账号 | FORBIDDEN R1 |  |
| AI 自动接受现实邀约/付款/评价 | FORBIDDEN |  |
| AI/Mock 到店、订单、评论制造社会证明 | FORBIDDEN |  |
| 付费吃饭/喝酒/私人陪伴/亲密陪伴服务 | FORBIDDEN；公开多人活动走 Activity Policy |  |
