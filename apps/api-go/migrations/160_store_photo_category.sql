-- 160_store_photo_category.sql
-- STORE-PHOTO-CAT-001（2026-10-03，用户「分为店铺环境 菜单」）：
--
-- 店铺照片分两类：environment（店铺环境：门脸/内饰/座位）与 menu（菜品）。
-- 以前没有分类，全堆在一起，商家想找"菜单图"得翻环境照。
-- 默认 environment（历史照片没标过类，全算环境 —— 菜品图另有产品照片管，
-- 店照片墙里的默认按环境处理，不编造分类）。
ALTER TABLE business.store_photos
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'environment';

ALTER TABLE business.store_photos
  DROP CONSTRAINT IF EXISTS store_photos_category_ck;
ALTER TABLE business.store_photos
  ADD CONSTRAINT store_photos_category_ck CHECK (category IN ('environment', 'menu'));
