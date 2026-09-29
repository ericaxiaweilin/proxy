-- KYC-PHONE-ONLY-001（2026-09-27，用户：「证件正面 反面 手持自拍的移除在kyc里 越南合规这个隐私数据
-- 困难 kyc我们就验证电话号码真实性就好了 签承诺声明不变」）：接单权限 KYC 第 2 步从"CCCD 正反面 +
-- 手持证件自拍，运营人工比对"（127_provider_applications_kyc.sql）改成"真的发短信验证码、真的校验"。
-- 越南法律下留存身份证件图像 / 生物特征比对属高风险个人数据；运营人工"像不像"从来也不是可审计的验证。
--
-- 清理顺序：先删掉这几个证件资产在 media.media_assets 里的元数据行（旧申请如果真的留过证件照，那些行
-- 不应该继续存在），再删列。已知缺口（跟头像媒体字节那条同一类，见
-- docs/legal/vietnam/Proxy_Operating_Terms_Supplement_2026-08-31.md）：这里删的是数据库元数据行，
-- 磁盘上的原始文件字节本仓目前没有一条通用的删除管线，不在这次改动范围内。
DELETE FROM media.media_assets
WHERE media_asset_id IN (
    SELECT id_front_asset FROM supply.provider_applications WHERE id_front_asset <> ''
    UNION
    SELECT id_back_asset FROM supply.provider_applications WHERE id_back_asset <> ''
    UNION
    SELECT selfie_asset FROM supply.provider_applications WHERE selfie_asset <> ''
);

ALTER TABLE supply.provider_applications
    DROP COLUMN IF EXISTS id_type,
    DROP COLUMN IF EXISTS id_front_asset,
    DROP COLUMN IF EXISTS id_back_asset,
    DROP COLUMN IF EXISTS selfie_asset,
    DROP COLUMN IF EXISTS photos_attested;

-- KYC-PHONE-ONLY-001: 一次"验证这个手机号是不是真的"的真实 OTP 挑战记录。跟 identity 包
-- 登录用的 login_challenges 是同一种形状（provider_ref / status / attempts / expires_at），
-- 但故意不复用那张表——登录验证的是"这是已登记的登录凭据"，这里验证的是"这个还没登记过
-- 的手机号现在真的能收到码"，不要求先有一条 login_identities 行。
CREATE TABLE IF NOT EXISTS supply.provider_phone_challenges (
    id              TEXT PRIMARY KEY,
    user_account_id TEXT NOT NULL,
    phone           TEXT NOT NULL,
    provider_ref    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'LOCKED')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    verified_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS provider_phone_challenges_user_idx ON supply.provider_phone_challenges (user_account_id);
