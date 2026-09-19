-- seed_threebeans_bn.sql
-- 真实商户建档：Three Beans · Bắc Ninh（109 Lý Chiêu Hoàng）。
--
-- 店址 2026-09-18 真机实测（店内上报定位逆编码命中该独栋），见 migration 102。
-- 本文件只建身份骨架（主体/店铺/店主/资料空行），让商家端流程能跑起来；
-- 菜单、设施属性、照片一律不编 —— 等店主（测试期为 weilinxia511）在商家端
-- 自己录，或运营核实后补。幂等：可重复执行。
BEGIN;

INSERT INTO business.accounts (id, owner_user_id, name, status, created_at)
VALUES ('biz_threebeans_bn', 'user_5fbe354a954f14391d5a056ce97f3e15', 'Three Beans · Bắc Ninh', 'ACTIVE', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO business.stores (id, business_id, name, address, status, created_at)
VALUES ('store_threebeans_bn', 'biz_threebeans_bn', 'Three Beans · Bắc Ninh', '109 Lý Chiêu Hoàng, Suối Hoa, TP Bắc Ninh', 'ACTIVE', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO business.memberships (business_id, user_id, role, status, created_at)
VALUES ('biz_threebeans_bn', 'user_5fbe354a954f14391d5a056ce97f3e15', 'OWNER', 'ACTIVE', now())
ON CONFLICT (business_id, user_id) DO NOTHING;

INSERT INTO business.member_directory (business_id, user_id, display_name, role, status, joined_at)
VALUES ('biz_threebeans_bn', 'user_5fbe354a954f14391d5a056ce97f3e15', 'weilinxia511', 'OWNER', 'ACTIVE', now())
ON CONFLICT (business_id, user_id) DO NOTHING;

-- 设施与营业时间是 commander 拍板的测试期合理值（2026-09-18），非实测：
-- wifi A / 室外吸烟 / 26°以下按 24 / 插座充足 / 适中 / 混合座。电话邮箱 logo
-- 照片菜单一律空着 —— 联系方式和价格编出来会坑到真人，等店主自己录。
INSERT INTO business.store_lines (store_id, business_id, logo_asset_path, description, hours_json, contact_phone, contact_email, updated_by, updated_at, wifi, smoking, ac_temp_c, power, quiet, seating)
VALUES ('store_threebeans_bn', 'biz_threebeans_bn', '', 'Bắc Ninh 市中心咖啡店 · 早班咖啡、下午办公', '{"mon":"07:00-22:00","tue":"07:00-22:00","wed":"07:00-22:00","thu":"07:00-22:00","fri":"07:00-22:00","sat":"07:00-22:00","sun":"07:00-22:00"}', '', '', 'user_5fbe354a954f14391d5a056ce97f3e15', now(), 'A', 'OUTDOOR', 24, 'FULL', 'MODERATE', 'MIXED')
ON CONFLICT (store_id) DO NOTHING;

COMMIT;
