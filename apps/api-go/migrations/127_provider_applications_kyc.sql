-- ORDER-PERMISSION-KYC-001（2026-09-24，原型 deepseek_html_20260924_33987c「接单中心 · KYC + 履约管线」）：
-- 接单权限申请改成 3 步 KYC：基础信息（实名 / 出生年份 / 性别可选 / 手机号）→ 证件（正反面 + 手持证件自拍，
-- 运营人工比对；用户选定，不用 Face ID 冒充真人比对）+ 无犯罪声明 + 数据使用同意 → 履约条款（紧急联系人 +
-- config/provider-terms/terms.json 的条款，记录版本）。性别只是可选自述，不参与任何判断。
-- 证件 / 自拍是 OWNER_ONLY 媒体，只有运营控制台能看（/v1/operator/provider-applications/media/…）。
ALTER TABLE supply.provider_applications
    ADD COLUMN IF NOT EXISTS birth_year INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'FEMALE', 'MALE', 'OTHER')),
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS id_type TEXT NOT NULL DEFAULT '' CHECK (id_type IN ('', 'CCCD', 'PASSPORT')),
    ADD COLUMN IF NOT EXISTS id_front_asset TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS id_back_asset TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS selfie_asset TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS no_crime_declared BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS data_consent BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS emergency_contact TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS terms_version TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS terms_accepted JSONB NOT NULL DEFAULT '[]'::jsonb;
