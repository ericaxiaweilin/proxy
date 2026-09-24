-- 108_media_ai_provenance.sql — 把 AI 生成溯源真正落库（LC-06 / LC-07）
--
-- 背景（P0）：R16.7-P1-K (LC-06) 与 R16.7-P1-I (LC-07) 的判定逻辑早就在
-- internal/media/service.go 里写好了 —— MarkMediaReady 会在
--   aiGenerationSource == "UNKNOWN"                  → AI_LABEL_MISSING
--   aiGenerationSource == "AI_PERSONA" 且无活体同意   → AI_LIKENESS_CONSENT_MISSING
-- 两处 fail-closed 拒绝发布。MediaAsset 结构体也一直带着
-- AIGenerationSource / AIGenerated / PersonaID / SubjectID / LikenessConsentID。
--
-- 但 media.media_assets 表里从来没有这 5 列，platform/postgres/media.go 的
-- INSERT / SELECT / UPDATE 也从来没提过它们。于是：
--   * 写入时这些字段被静默丢掉；
--   * 读取时永远是 Go 零值 —— aiGenerationSource == ""，
--     而闸门比的是字面量 "UNKNOWN"，"" 比不过，直接放行。
-- 结论：LC-06 / LC-07 在生产上是死代码。越南 AI 法 134/2025/QH15 第 12 条
-- 要求的「AI 生成内容必须可标注、无法标注则不得发布」，实际上没有任何一行
-- 数据在支撑。这个洞之前没被发现，是因为 media/lc06_lc07_test.go 用的是
-- MemoryRepository（整个结构体存 map，字段当然不会丢），而 g3 里的
-- scripts/lc06-ai-media-e2e.sh 在第 1 步就挂了、根本走不到闸门。
--
-- 本迁移补上列。真正把洞焊死的是同批的
-- internal/platform/postgres/media_ai_provenance_test.go（往返测试）与
-- scripts/check-regression-contracts.sh 里的 LC-06 / LC-07 钉 ——
-- 光加列不改 repository，等于什么都没修。
--
-- 存量行的标注口径（这是一个有代价的选择，写在这里备查）：
--   ai_generation_source 默认 'USER_UPLOADED'，不是 'UNKNOWN'。
--   理由：迁移之前，任何没有显式声明 aiGenerationSource 的资产，
--   service.go 的 normalizeAIGenerationSource("") 就已经算成
--   'USER_UPLOADED' 了 —— 这个值在 Go 里算对了、只是没落库。
--   用 'USER_UPLOADED' 回填 = 还原系统本来会写下的值；
--   用 'UNKNOWN' 回填反而是新加一个「生产者没声明」的断言，
--   而对这些行来说这句话是假的（它们声明了，只是没存下来）。
--   代价：如果某行其实是 AI 生成的、但生成于本列存在之前，它会读到
--   USER_UPLOADED，事后无法自动识别。可证明的 AI 行只有平台自己的
--   5 张写真种子，下面按 id 显式改正。
--   注意这个口径只影响存量行：新建资产一律由 createAsset 显式赋值，
--   闸门对「新资产」的强度没有变化。

ALTER TABLE media.media_assets
    ADD COLUMN IF NOT EXISTS ai_generation_source TEXT NOT NULL DEFAULT 'USER_UPLOADED',
    ADD COLUMN IF NOT EXISTS ai_generated         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS persona_id           TEXT,
    ADD COLUMN IF NOT EXISTS subject_id           TEXT,
    ADD COLUMN IF NOT EXISTS likeness_consent_id  TEXT;

-- 取值集合必须与 internal/media/service.go 的 normalizeAIGenerationSource 一致。
-- 'UNKNOWN' 在集合里是有意的：它是「生产者没声明」这个状态本身，闸门靠它拒绝发布。
ALTER TABLE media.media_assets
    DROP CONSTRAINT IF EXISTS media_assets_ai_generation_source_check;
ALTER TABLE media.media_assets
    ADD CONSTRAINT media_assets_ai_generation_source_check
    CHECK (ai_generation_source IN ('USER_UPLOADED', 'AI_PERSONA', 'MODEL_API', 'UNKNOWN'));

-- ai_generated 是 ai_generation_source 的便捷视图，两者不许互相矛盾。
-- USER_UPLOADED 之外的来源都是「AI 参与了」。
ALTER TABLE media.media_assets
    DROP CONSTRAINT IF EXISTS media_assets_ai_generated_consistent_check;
ALTER TABLE media.media_assets
    ADD CONSTRAINT media_assets_ai_generated_consistent_check
    CHECK (ai_generated = (ai_generation_source <> 'USER_UPLOADED'));

-- 注意：persona_id / likeness_consent_id 故意不加外键。
-- ai.ai_personas / ai.likeness_consents 是独立部署的 schema（见 066 的注释），
-- 而平台自己的 5 张小美写真种子引用的 persona（ai_001..ai_005）在 ai_personas
-- 里并不存在 —— 加外键会让本迁移直接失败，也会把媒体写入耦合到 AI schema 的
-- 可用性上。LC-07 的同意校验走的是应用层（MarkMediaReady 里 HasLiveConsent），
-- 不是靠外键兜的。这里只建索引，供「按分身查资产」用。

CREATE INDEX IF NOT EXISTS idx_media_assets_persona
    ON media.media_assets (persona_id)
    WHERE persona_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_ai_generated
    ON media.media_assets (ai_generation_source)
    WHERE ai_generation_source <> 'USER_UPLOADED';

-- 存量修正：平台自己的 5 张小美写真是 AI_PERSONA 资产，必须按 AI 标注。
-- 定义在 internal/media/service.go 的 xiaomeiPersonaPhotos；subject_id 留空
-- （这些是 CREATIVE 方向的平台角色，不指向真人 likeness，因此 LC-07 不拦）。
UPDATE media.media_assets
   SET ai_generation_source = 'AI_PERSONA',
       ai_generated         = true,
       persona_id           = CASE media_asset_id
                                  WHEN 'seed_media_xiaomei_001' THEN 'ai_001'
                                  WHEN 'seed_media_xiaomei_002' THEN 'ai_002'
                                  WHEN 'seed_media_xiaomei_003' THEN 'ai_003'
                                  WHEN 'seed_media_xiaomei_004' THEN 'ai_004'
                                  WHEN 'seed_media_xiaomei_005' THEN 'ai_005'
                              END
 WHERE media_asset_id IN ('seed_media_xiaomei_001', 'seed_media_xiaomei_002',
                          'seed_media_xiaomei_003', 'seed_media_xiaomei_004',
                          'seed_media_xiaomei_005')
   AND ai_generation_source = 'USER_UPLOADED';

COMMENT ON COLUMN media.media_assets.ai_generation_source IS
  'AI 生成溯源，单一事实来源（LC-06）。闭集：USER_UPLOADED | AI_PERSONA | MODEL_API | UNKNOWN。UNKNOWN = 生产者未声明，MarkMediaReady 会 fail-closed 拒绝发布。越南 AI 法 134/2025/QH15 第 12 条。';
COMMENT ON COLUMN media.media_assets.ai_generated IS
  'ai_generation_source 的便捷视图：非 USER_UPLOADED 即为 true。两者由 CHECK 约束保证一致，不允许互相矛盾。';
COMMENT ON COLUMN media.media_assets.persona_id IS
  'AI_PERSONA 资产的来源分身 id（LC-07）。不加外键：ai schema 独立部署，且平台种子资产引用的 persona 可能尚未创建。';
COMMENT ON COLUMN media.media_assets.subject_id IS
  'likeness 指向的真人账号 id（LC-07）。PersonaType=USER_TWIN 时用它查活体同意；CREATIVE 分身留空。';
COMMENT ON COLUMN media.media_assets.likeness_consent_id IS
  'MarkMediaReady 通过 LC-07 同意校验后盖的章，供监管回溯「这份资产是在哪份同意下发布的」。非 AI / CREATIVE 资产为空。';
