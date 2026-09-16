# AGENT_LOCK — kake-map-meetup

- owner: opencode (map pipeline), 2026-09-16
- branch: feat/map-meetup-share
- starting commit: d9879026cb8ec8363fc443d7c14f83e315f4bb28
- task: MEETUP-SHARE-001 —— 双人共享地址 + 地图导航纯逻辑管线。
  现状缺口：`ConversationClient.sendMessage` 已支持 `messageType: "LOCATION"`，
  但 `conversation.tsx` / `messages.tsx` 只渲染 IMAGE/VIDEO/AUDIO，
  LOCATION 掉回 raw body；选点页只有单人复制 + Google 打开，没有好友对好友的
  可解析格式、中点、步行耗时、Apple/geo 外链。本任务只建纯 TS 模块 + 单测，
  不碰基线敏感文件，不改门禁脚本。
- owned files (only):
  - apps/mobile/src/meetup-share.ts (new)
  - apps/mobile/src/meetup-share.test.ts (new)
  - AGENT_LOCK.md (this file)
- avoided: market.tsx / reality-scene-map.tsx (geo-honest),
  geo/precision.go + supply/service.go (geo-precision),
  app-shell.tsx / me.tsx / merchant-me-*.tsx (baseline-sensitive),
  scripts/check-regression-contracts.sh (commander-owned gate)
- expires: handoff to commander (merge by commander only)
