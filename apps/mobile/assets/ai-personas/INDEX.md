# Platform AI Persona 头像资产

5 个 PLATFORM_AI 角色 (ai_001-ai_005) 的统一风格 SVG 头像。R17.x
新增。

## 约束

- **不是真人**：每个 SVG 顶部 `<title>` + `<desc>` 标 "AI-generated
  avatar. Not a real person. PLATFORM_AI persona. Clearly labeled as
  AI."
- **明确 AI 标识**：每张图右上角有 "AI 虚拟" 白色 pill badge。
- **不进入接单候选池**：这些是 PLATFORM_AI 主体，不属于真人候选
  (PRD LC-07 / R16.x AI-ACTOR-002 tripwire 维护)。
- **不接订单 / 收款 / 替用户确认**：见 R16.x aiboundary policy。

## 5 个角色

| 文件 | personaId | 角色 | 主题色 |
|------|-----------|------|--------|
| ai_001.svg | ai_001 | 平台 AI 周末企划 | 紫 (☕) |
| ai_002.svg | ai_002 | 平台 AI 拍照季 | 粉 (📸) |
| ai_003.svg | ai_003 | 平台 AI 拍照搭子 | 绿 (🤝) |
| ai_004.svg | ai_004 | 平台 AI 餐厅尝鲜 | 橙 (🍽️) |
| ai_005.svg | ai_005 | 平台 AI 饭局推荐 | 金 (🍜) |

## 接入方式

`Activity.AIPersonaPhoto` 字段（string，URL 或相对 assets 路径）。
mobile 端用 `<Image>` 显示；fallback 到 emoji avatar。
