-- Social Media Pipeline v2: Dominant Color 落库
-- 目的：消除"白/灰边"——客户端 contain 模式下用此色当 frame 背景，替代写死深紫黑。
-- worker v1 派生后调 extractDominantColor 写入。
-- 失败填 #0E0A14 兜底（与 FRAME_BACKGROUND_HEX 一致），不阻塞 READY。
-- 见 docs/media-pipeline/dominant_color.md (待补)

ALTER TABLE media.media_assets
    ADD COLUMN IF NOT EXISTS dominant_color_hex TEXT;

COMMENT ON COLUMN media.media_assets.dominant_color_hex IS
  '主色 #RRGGBB。worker v1 派生后填，contain 模式下客户端用此色当 frame 背景。失败填 #0E0A14 兜底。';
