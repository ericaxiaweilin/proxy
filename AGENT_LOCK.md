# AGENT_LOCK — kake-map-meetup

- owner: opencode (map pipeline), 2026-09-16
- branch: feat/map-meetup-share
- starting commit: d9879026cb8ec8363fc443d7c14f83e315f4bb28
- task: MEETUP-SHARE-001 —— 双人共享地址 + 地图导航纯逻辑管线。
  seg1 纯 TS 模块 + 单测；seg2 LOCATION 收发接线（client helper + 会话卡片 +
  收件箱预览）；seg3 会话 composer“📍 位置”入口（GPS 真值 + 确认 sheet +
  乐观发送 + 失败撤回）。不碰基线敏感文件，不改门禁脚本。
- owned files (only):
  - apps/mobile/src/meetup-share.ts (new)
  - apps/mobile/src/meetup-share.test.ts (new)
  - apps/mobile/src/conversation-location.test.ts (new, segment 2)
  - apps/mobile/src/conversation-client.ts (segment 2: sendLocationMessage only)
  - apps/mobile/src/surfaces/conversation.tsx (segment 2: LOCATION hydrate/card/preview only)
  - apps/mobile/src/surfaces/messages.tsx (segment 2: inbox LOCATION preview line only)
  - AGENT_LOCK.md (this file)
- avoided: market.tsx / reality-scene-map.tsx (geo-honest),
  geo/precision.go + supply/service.go (geo-precision),
  app-shell.tsx / me.tsx / merchant-me-*.tsx (baseline-sensitive),
  scripts/check-regression-contracts.sh (commander-owned gate)
- expires: handoff to commander (merge by commander only)
