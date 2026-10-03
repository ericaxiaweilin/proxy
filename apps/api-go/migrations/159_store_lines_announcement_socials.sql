-- 159_store_lines_announcement_socials.sql
-- STORE-EDIT-V2-001（2026-10-03，用户给原型 deepseek_html_20261003_4c9dc5
-- 「编辑店铺资料 - 增强版」）
--
-- 原型新增两个后端没有的东西：
--   1. 店铺公告（announcement）：100 字内的促销/通知（原型占位
--      "本周五下午茶买一送一！"）。和简介（description）不是一个字段 ——
--      简介是"这家店是什么"，公告是"这周有什么事"，混在一起以后就分不开了。
--   2. 店铺社媒（socials）：Zalo / Facebook / TikTok 主页链接。
--      注意和 CREATOR-SOCIAL-001 的 creator 社媒区分：那是**人**的 username
--      （只存名不存 URL）；这是**店**的官方主页 URL（店自己填自己的官网链接，
--      钓鱼面小得多，但仍只收 https，见 Go 校验）。
--
-- socials 存 JSONB：{"zalo": "https://...", "facebook": "...", "tiktok": "..."}，
-- 空键不存（{} 就是都没填）。固定三个键，不开放自定义平台 —— 店铺社媒不是
-- 收藏夹，加一个平台要客户端图标 + 展示，三处一起改（和 creator 社媒同规矩）。
ALTER TABLE business.store_lines
  ADD COLUMN IF NOT EXISTS announcement TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS socials JSONB NOT NULL DEFAULT '{}';
