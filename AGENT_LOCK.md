# AGENT_LOCK — kake-map-meetup

- owner: opencode (map pipeline), 2026-09-16
- branch: feat/map-meetup-share
- starting commit: d9879026cb8ec8363fc443d7c14f83e315f4bb28
- task: MEETUP-SHARE-001 —— 双人共享地址 + 地图导航纯逻辑管线。
  seg1 纯 TS 模块 + 单测；seg2 LOCATION 收发接线（client helper + 会话卡片 +
  收件箱预览）；seg3 会话 composer“📍 位置”入口；seg4 入口改复用成熟
  LocationPickerSheet（地图/3KM/复制/导航/历史收藏全现成），删自写确认页。
  打卡/足迹不硬塞进会话：订单打卡在 order-execution、现场声明在场景面，
  各有归属。不碰基线敏感文件，不改门禁脚本，不碰他人认领文件。
- owned files (only):
  - apps/mobile/src/meetup-share.ts (new, seg1/seg4)
  - apps/mobile/src/meetup-share.test.ts (new)
  - apps/mobile/src/scene-checkin.ts (new, seg5: 100m 门禁纯逻辑)
  - apps/mobile/src/scene-checkin.test.ts (new, seg5)
  - apps/mobile/src/conversation-location.test.ts (new, seg2)
  - apps/mobile/src/conversation-client.ts (seg2: sendLocationMessage only)
  - apps/mobile/src/surfaces/conversation.tsx (seg2-4: LOCATION 接线 + 复用选点 sheet)
  - apps/mobile/src/surfaces/messages.tsx (seg2: inbox LOCATION preview line only)
  - apps/mobile/src/surfaces/reality-scene-map.tsx (seg5 ONLY: 打卡门禁 + 按钮区
    persistCheckIn/自动打卡/509-519 行；geo-honest 的推荐/容量/marker hunk 未碰）
  - docs/design/BASELINE_CHANGELOG.md + CURRENT_BASELINE.json（seg5: Rev221 登记，
    ⚠️ 变基时 commander 重排，集成本已 Rev220）
  - AGENT_LOCK.md (this file)
- avoided: market.tsx / reality-scene-map.tsx (geo-honest),
  geo/precision.go + supply/service.go (geo-precision),
  app-shell.tsx / me.tsx / merchant-me-*.tsx (baseline-sensitive),
  scripts/check-regression-contracts.sh (commander-owned gate)
- expires: handoff to commander (merge by commander only)
