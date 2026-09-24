-- KYC-BIRTH-DATE-001（2026-09-24，用户：「出生如果采集肯定也是日期」）：出生年份 → 出生日期。
-- 年份按年算年龄有最大 1 年误差（今年生日还没到、但年份差够 18 的会被误放行）；日期精确到日，
-- 服务端按精确年龄卡 18–90。已提交的老行 birth_year 保留（只读兼容），birth_date 为空，不重验。
-- 性别：正常 KYC 不采；越南 CCCD 第 4 位自带世纪 + 性别，运营看证件照片时自然知道；系统里没有任何逻辑
-- 消费性别，所以不采集也不派生。后端 gender 列保留兼容（允许空，不参与任何判断）。
ALTER TABLE supply.provider_applications
    ADD COLUMN IF NOT EXISTS birth_date TEXT NOT NULL DEFAULT '';
