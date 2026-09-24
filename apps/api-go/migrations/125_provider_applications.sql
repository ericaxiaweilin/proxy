-- PROVIDER-APPLY-001（2026-09-24，用户：「可以考虑做小美的申请了 把数据做全」→ 选定「申请 + 运营审核」）。
-- 小美（服务者）身份以前没有入口：supply.agent_profiles 只能靠种子 / 手工 SQL 开。
-- 现在：本人提交申请（实名、自证女性、真实照片、可服务区域 / 语言 / 能力、自我介绍）→ 运营控制台审核
-- → 通过才开 supply.agent_profiles（ACTIVE）并声明能力（declared，不是 verified —— 审核不等于能力核验）。
CREATE TABLE IF NOT EXISTS supply.provider_applications (
    application_id TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    -- 实名只给运营看，不出现在任何用户侧读模型里。
    real_name TEXT NOT NULL DEFAULT '',
    gender_attested BOOLEAN NOT NULL DEFAULT FALSE,
    city TEXT NOT NULL DEFAULT '',
    service_areas JSONB NOT NULL DEFAULT '[]'::jsonb,
    languages JSONB NOT NULL DEFAULT '[]'::jsonb,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    intro TEXT NOT NULL DEFAULT '',
    photo_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
    reject_reason TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT NOT NULL DEFAULT '',
    reviewed_at TIMESTAMPTZ,
    agent_id TEXT NOT NULL DEFAULT '',
    -- APP = 本人在 App 里提交；BACKFILL = 本迁移补录的存量服务者（申请入口出现前就已经是 ACTIVE）。
    source TEXT NOT NULL DEFAULT 'APP' CHECK (source IN ('APP', 'BACKFILL')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 一个人同时最多一份进行中 / 已通过的申请；被拒或撤回后可以重新提交。
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_applications_open
    ON supply.provider_applications (user_account_id)
    WHERE status IN ('SUBMITTED', 'APPROVED');

CREATE INDEX IF NOT EXISTS idx_provider_applications_status
    ON supply.provider_applications (status, created_at DESC);

-- 存量补录：已经 ACTIVE、且绑定了真实账号的服务者，记一条 APPROVED（source=BACKFILL）。
-- 不编造她们没填过的东西：实名留空、gender_attested=false（从没自证过），照片 / 语言 / 区域照抄现有资料。
INSERT INTO supply.provider_applications (
    application_id, user_account_id, display_name, service_areas, languages, capabilities, intro,
    status, reviewed_by, reviewed_at, agent_id, source, created_at, updated_at)
SELECT
    'papp_backfill_' || a.agent_id,
    a.user_account_id,
    a.name,
    COALESCE(a.service_areas, '[]'::jsonb),
    COALESCE(a.languages, '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(c.capability ORDER BY c.capability) FROM supply.capabilities c
              WHERE c.agent_id = a.agent_id AND c.declared), '[]'::jsonb),
    COALESCE(a.bio, ''),
    'APPROVED', 'system:backfill', a.created_at, a.agent_id, 'BACKFILL', a.created_at, now()
FROM supply.agent_profiles a
WHERE a.status = 'ACTIVE'
  AND COALESCE(a.user_account_id, '') <> ''
  AND NOT EXISTS (
      SELECT 1 FROM supply.provider_applications p
      WHERE p.user_account_id = a.user_account_id AND p.status IN ('SUBMITTED', 'APPROVED'))
ON CONFLICT (application_id) DO NOTHING;
