-- SCENE-CATEGORY-001: 场景顶类，封闭三态（商家/景点/其他）。
--
-- 之前 type 是自由文本（"咖啡""公园"随便填），词表无界 —— 后期想按分类做
-- 标记颜色、徽标、筛选，全都无从 key。现在顶类独立成列，前端只认这三个；
-- 后端细分（咖啡店/湖/海滩…）继续放在 type 里。
--
-- 存量回填规则（和 realityscene.launchScenes() 里 11 条种子的归类同一口径，
-- 白纸黑字在这里，运行时不再猜）：
--   type 以"公共景点"开头 → 景点；以"咖啡"开头 → 商家；其余 → 其他。
-- 未知的一律进"其他"，不编造（比如"艺术 · 展览"现在就是其他）。
ALTER TABLE reality.scenes ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '其他';
UPDATE reality.scenes SET category = CASE
  WHEN type LIKE '公共景点%' THEN '景点'
  WHEN type LIKE '咖啡%' THEN '商家'
  ELSE '其他'
END WHERE category = '其他';

ALTER TABLE reality.scene_proposals ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '其他';
UPDATE reality.scene_proposals SET category = CASE
  WHEN type LIKE '公共景点%' THEN '景点'
  WHEN type LIKE '咖啡%' THEN '商家'
  ELSE '其他'
END WHERE category = '其他';
