# Platform AI Persona 头像资产

5 个 PLATFORM_AI 角色 (ai_001-ai_005) 已接入此前生成的真人风格 PNG
形象；旧 SVG 只作为设计留档，不再是前端默认头像。

## 约束

- **不是真人**：PNG 是平台生成的虚拟形象；推荐卡、主页和聊天头部都必须
  独立显示“AI / AI 虚拟账户”，不能依赖图片本身表达身份。
- **静态映射**：`src/ai-persona-presentation.ts` 用 personaId 静态 require，
  确保 Expo 原生包会携带资产而不是依赖运行时文件 URL。
- **不进入接单候选池**：这些是 PLATFORM_AI 主体，不属于真人候选
  (PRD LC-07 / R16.x AI-ACTOR-002 tripwire 维护)。
- **不接订单 / 收款 / 替用户确认**：见 R16.x aiboundary policy。

## 5 个角色

| 文件 | personaId | 角色 | 主题色 |
|------|-----------|------|--------|
| photos/ai_001.png | ai_001 | 晴晴 · 元气陪伴 | 奶油白 |
| photos/ai_002.png | ai_002 | 安安 · 温柔倾听 | 紫色 |
| photos/ai_003.png | ai_003 | 米娅 · 时尚创作 | 洋红 |
| photos/ai_004.png | ai_004 | 林夏 · 文艺共鸣 | 珊瑚橙 |
| photos/ai_005.png | ai_005 | 七喜 · 幽默脑洞 | 青绿色 |

## 接入方式

账户 API 返回 `avatarPath` 供其他客户端识别；mobile 使用 personaId 到打包
资源的静态映射。这五个账户只参与社交、聊天和 AI 标识的 UGC；平台业务
助手、活动、订单和地点推荐是独立能力，不得引用这些人格作为执行主体。
