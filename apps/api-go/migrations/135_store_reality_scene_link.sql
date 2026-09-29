-- STORE-SCENE-LINK-001: 商家域（business.stores）和场景域（reality.scenes）
-- 之前没有任何互相认识的键——商家上传的店铺相册（business.store_photos）
-- 进不了场景详情的照片墙，即使这家店明明就是那个场景（比如 Three Beans）。
-- 这里只加一条可选的认领关系，不猜、不批量回填：现有店铺全部保持未关联，
-- 由店主自己认领（LinkStoreToRealityScene 命令）。

ALTER TABLE business.stores ADD COLUMN IF NOT EXISTS reality_scene_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_stores_reality_scene ON business.stores (reality_scene_id) WHERE reality_scene_id <> '';

-- Three Beans · Cầu Giấy（store_demo_tb1）是这个仓库里唯一真的传过菜单和
-- 店铺相册的商家演示账号，本来就是给 "threebeans" 这个现实场景准备的
-- （见 internal/realityscene/service.go 种子数据注释）。这条 UPDATE 记录
-- 的是已经成立的事实，不是编一个新关系。
UPDATE business.stores SET reality_scene_id = 'threebeans' WHERE id = 'store_demo_tb1';
