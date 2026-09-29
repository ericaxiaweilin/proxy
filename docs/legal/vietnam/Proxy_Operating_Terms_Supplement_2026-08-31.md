# Proxy 运营条款 补全清单（基于 2026-08-31 法律草案）

状态：草案（非律师审核意见）。正式上线前必须完成以下 9 项。

| 项目 | 当前状态 | 缺失内容 | 负责方 | 依赖文档 |
|------|----------|----------|--------|----------|
| 1. 越南法人信息 | 空白 | 法人全称、注册地址、税号、代表人 | 法务 | docs/legal/vietnam/proxy_terms/ |
| 2. 法律分类 | 空白 | 社交网络 / 在线通信 / 电信服务分类判断（决定监管主体） | 法务+产品 | PRD Chapter38 |
| 3. 电子商务登记/通知 | 空白 | 平台角色判断（实际功能→法律角色）；登记/通知责任 | 法务 | PRD Chapter35 |
| 4. DPIA | 空白 | 数据保护影响评估（越南 PDP 91/2025 Art.32） | 数据保护官（DPO）待定 | docs/compliance/R16.7 |
| 5. 跨境数据影响评估 | 空白 | 数据流出越南的第三方处理方清单+评估 | 数据保护官 | docs/compliance/ |
| 6. DPO / 数据保护部门 | 空白 | 数据保护官任命、部门职责、联系渠道 | 人力+法务 | AGENTS.md 数据规则 |
| 7. 真实数据流和第三方处理方清单 | 空白 | 所有子处理方（支付、云、AI 模型提供方）的合同+数据处理协议（DPA） | 工程+法务 | apps/api-go/contracts/ |
| 8. 越南语正式法律版本 | 空白 | 所有条款、隐私政策、社区规范的正式越南语翻译（经执业律师审阅） | 法务+翻译 | docs/legal/vietnam/*.txt |
| 9. 越南执业律师最终审阅 | 空白 | 全套条款+隐私+社区规范的律师签字确认 | 外部律师 | — |

规则引用：
- 数据不直接删除，状态变化（CANCELLED/可见性），审计保留（AGENTS.md 数据规则）
- 隐私请求：30 天宽限期，30 天后永久删除（法律要求保存记录除外）
  ⚠️ 待法务确认（2026-09-27）：Nghị định 356/2025/NĐ-CP Art. 5(4) 要求删除请求在 **20 天内**
  完成（涉及处理方或第三方时 30 天）。本仓「30 天宽限期 + 之后才擦除」是否落在该期限内，
  需律师判断 —— 宽限期本身是 PDP Art. 32 的撤回权，可能与「完成期限」叠加计算。
- 系统日志：至少 12 个月可检索
  ⚠️ 2026-09-27 修正引用：**12 个月这个数字不在 Luật An ninh mạng 116/2025/QH15 里。**
  该法 Art. 25(2)(b) 只写「lưu nhật ký hệ thống … trong thời gian theo quy định của pháp luật」
  （留存系统日志，期限由法律规定），把期限留给下位法。12 个月应引 Nghị định 333/2026/NĐ-CP
  或具体实施细则，**不要挂在法律条文上**。
- 删除请求处理：一般 24 小时；国家安全紧急：6 小时

---
参考：Grab / Shopee Food 越南线上外卖业务运营数据要求（对标 Decree 248/2026 + PDP 91/2025）

## A. 平台运营数据（Grab/Shopee 对标要求 → Proxy 应同步采集/保存）

| 数据类别 | 越南法律依据 | 参考平台实践 | Proxy 当前状态 | 补齐要求 |
|----------|---------------|---------------|----------------|----------|
| 商家/卖家验证记录（营业执照、食品安全证书、税号） | Decree 248/2026 §11（平台登记+卖家验证） | Grab: 每家餐厅上传 business_license + food_safety_certificate + tax_code；Shopee Food: shop_registration_doc + F&B_license | 无（PRD Chapter16 有 merchant 但无证照字段） | 新增 merchant_verification_docs 表：business_license, food_safety_cert, tax_code, verified_at, verified_by |
| 交易数据保存（订单、支付、退款、争议） | PDP 91/2025 Art.32；**Luật TMĐT 122/2025/QH15 Art. 17(2)(i) / 18(2)(c) / 16(2)(b)：已订立合同数据自订立起至少 3 年可访问**；Decree 248 §23（交易记录至少保存 12 个月） | Grab: 订单+支付+退款记录保存 5 年；Shopee: order_history 保留至账户关闭+5 年 | 无明确保留策略（仅 cachedPosts 模块级缓存，无持久化审计表） | 新增 transaction_audit 表：order_id, payment_ref, refund_ref, dispute_ref, created_at, retention_until；**retention_until 按 3 年算，不是 12 个月** —— 法令（12 个月）压不低法律（3 年）的下限，合同数据适用 3 年；audit_event 表记录每笔操作 |
| 投诉与违法内容治理（用户举报、平台处置、通知记录） | Decree 328/2026 §4（假新闻/虚假信息处置：一般 24h，紧急 6h） | Grab: complaint 表含 reported_content_id, report_type, action_taken, response_time_hours；Shopee: moderation_log 含 content_id, violation_category, action, responded_at | 无（postMenuPostId 仅 UI 状态，无持久化治理记录） | 新增 content_governance 表：content_id（post/activity/order 统一 ID），report_type，action（hide/remove/warn/suspend），responded_at（≤ 24h 一般，≤ 6h 紧急），legal_basis（引用条款编号） |
| 数据流出越南的第三方处理方（支付网关、AI 模型、云服务） | PDP 91/2025 Art.32 + 跨境数据影响评估要求 | Grab: 公开 subprocessor_list（支付=BankPartner，地图=Google，AI 推荐=内部模型无出境）；Shopee: DPA 签署每家子处理方 | 无（apps/api-go 无 subprocessor 注册表） | 新增 subprocessor_registry：name, service_category（payment/cloud/ai/maps），country，dpa_version，contract_start, audit_date |
| 用户同意记录（Terms + Privacy + 功能级同意） | PDP 91/2025 Art.31（处理个人数据须明示同意）+ R16.7-P0-C 要求 | Grab 注册流程：强制勾选 Terms + Privacy + 位置权限（可选但独立）；每次功能变更重新确认 | native-app.tsx 无同意 checkbox；login-client.ts 无 consents 字段 | 完成 R16.7-P0-A/B/C：注册强制同意 + DOB 校验 + legal_consent_records 落库（已在合规计划中） |
| 系统日志（账号、登录、IP、源端口、发布处理） | Nghị định 333/2026/NĐ-CP（Luật An ninh mạng 116/2025/QH15 的实施细则；该法 Art. 25(2)(b) 只定「留存系统日志」义务，期限留给下位法）+ Proxy_Legal_Update_Notes §3 | Grab: security_log 保留 18 个月（含 IP、设备指纹、操作类型、内容 ID）；Shopee: audit_log 保留 24 个月 | 无持久化安全日志表（仅 console.log + Metro 日志，无结构化存储） | 新增 security_audit_log：user_id / anonymous_session_id，event_type（login/logout/post/create/delete/report），ip, source_port, device_fingerprint, content_id, timestamp，retention_months = 12（⚠️ 期限待法务对 333/2026 复核） |

## B. 数据保留与删除（对标 Grab/Shopee 删除流程 → 确认 Proxy 方案正确）

| 阶段 | Grab 实践 | Shopee 实践 | Proxy 当前方案（已修复） | 是否符合 |
|------|-----------|-------------|----------------------------|----------|
| 提交删除请求 | 用户在 App 提交 → 30 天宽限期（可撤回） | 同上（30 天） | client.requestDelete() 提交 → 30 天宽限（status: received → in_progress → completed） | 符合 |
| 立即隐藏（状态变化） | 删除请求提交后，用户内容（帖子、评论、订单历史）立即对外不可见（visibility = hidden），但 DB 数据保留（审计+法律要求） | 同上：内容标记 is_deleted = true，查询时过滤，不直接 DELETE 行 | 代码已修：post 数据不直接删除（AGENTS.md 数据规则：状态变化，不删 DB 数据） | 符合 |
| 30 天后永久删除 | 30 天后，自动执行 hard_delete（DB 行删除，审计表保留 user_id + deleted_at + content_ids 引用，不保留内容本身） | 30 天后执行 permanent_erase，审计保留 erase_log | 代码已实现：worker 每小时跑 `Service.SweepPrivacyDeletions`（24h 转 in_progress，30d 擦除 + 写 erased_at）。擦除范围 = identity 聚合（登录标识 / 资料 / 显示身份 / 偏好 / 会员关系 / 归属地 / 设备 / 会话与令牌 / 登录挑战），账号行匿名化为 status=ERASED（`business.accounts.owner_user_id` 是 ON DELETE RESTRICT，交易台账要引用它）。未覆盖：帖子 / 媒体等跨聚合内容仍以 user_id 引用保留 → **已补上（2026-09-21）**：worker 的同一个 sweep 里，跨聚合显示身份也一起擦 —— `localnet.posts` / `socialspace.statuses` / `marketplace.opportunities` / `business.member_directory` 的显示名快照清空（权威 id 保留），头像媒体资产降级为 `visibility_class=OWNER_ONLY`（`/v1/media/play/<id>` 要求 PUBLIC，故该 URL 从此 404），推送设备令牌删除。**刻意保留**：内容行本身（去归属不删除 —— 别人的回复 / 收藏 / 转发引用它们，且本次请求是擦除个人数据而非撤回内容）、交易 / 税务 / KYC / 同意记录。**已知缺口**：头像的对象存储字节未清除（本版本没有对象删除路径），只做到了不可经 API 下发 —— 见 `identity.CrossAggregateErasureBoundary` 里的 LIMITATION 段，该字符串会写进审计流水 | 已实现（identity 聚合 + 跨聚合显示身份） |
| 审计保留（法律要求保存记录） | 交易/税务/安全记录保留 ≥ 5 年（越南电商法） | 同上 | 规则已记录（security_audit_log 保留 12 个月为最低，税务记录需单独 ≥ 5 年表） | 安全日志已规划，税务日志需单独设计 |

## C. 电子商务平台角色判断（参考 Grab/Shopee 平台登记要求 → Proxy 适用判断）

根据 Decree 248/2026/ND-CP §3（电子商务平台登记责任）：
- 平台角色判断标准：是否提供交易撮合（订单创建、支付处理、商家入驻）、是否控制交易数据、是否向用户收取服务费/佣金。
- Grab / Shopee Food：提供订单撮合 + 支付处理 + 商家入驻审核 → 明确为“电子商务平台”，已完成平台登记（e-commerce_platform_registration_number 公开）。
- Proxy 当前功能（PRD v1.4）：提供活动（activity）、订单（order）、商家页面（business）、支付（第三方支付接口）、优惠券（voucher）→ 实际功能已触发平台登记责任（LC-28）。
- 缺失：无 platform_registration_number 字段；无 e-commerce_platform_notice UI 提示；business-client.ts 无平台登记状态校验。
- 补齐要求：新增 platform_registration 字段（proxy-app 配置或 DB 表 platform_registration），在 business-client 注册流程中强制校验；在 terms 中增加“平台登记声明”条款。

<!-- 2026-09-27：这里原本是上面「规则引用」四行的**逐字重复**（同一个 59 行文件里
     出现了两次），已删除。保留一份，避免两份开始各自漂移。 -->
