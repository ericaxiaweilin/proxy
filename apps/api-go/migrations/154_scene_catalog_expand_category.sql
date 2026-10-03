-- CATALOG-EXPAND-001 补正：给 153 新增的 17 条补 category。
--
-- 为什么单独一条：已应用迁移只许改名不许改内容（153 已经在库里，漂移检测会拦
-- 住任何对它的编辑），所以修正必须向前走。
--
-- reality.scenes.category 是 098 迁移加的列，默认 '其他'。098 的存量回填规则只认
-- 「type 以公共景点开头 → 景点 / 以咖啡开头 → 商家」，而 153 里的
-- 「餐厅 · 米其林 Bib Gourmand」两个前缀都不沾 —— 于是 17 条全部落进 '其他'，
-- 前端的分类筛选里一个商家都看不到。
--
-- 这里写死每个 id 的归属，与 Go 侧 launchScenes() 里的 Category 字段同口径。

UPDATE reality.scenes SET category = v.cat, updated_at = now()
FROM (VALUES
('cafe_giang','商家'),
('cafe_dinh','商家'),
('cafe_phoco','商家'),
('cafe_note','商家'),
('cafe_loadingt','商家'),
('buncha_ta','商家'),
('buncha_huonglien','商家'),
('buncha_chan','商家'),
('pho_batdan','商家'),
('pho_thin','商家'),
('buncha_74hangquat','商家'),
('chua_motcot','景点'),
('lang_hcm','景点'),
('buncha_dungrau','商家'),
('buncha_thuhien','商家'),
('buncha_ketnghia','商家'),
('buncha_mydo','商家')
) AS v(id, cat)
WHERE reality.scenes.id = v.id;
