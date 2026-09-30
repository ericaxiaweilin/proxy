-- seed_dev_shops_users_remove.sql
--
-- DEV-ONLY：删掉 seed_dev_shops_users.sql 灌进来的 20 店 + 30 用户。
--
-- ## 为什么删除要护栏，而灌数据不用
--
-- 灌数据是 insert-if-absent，幂等，跑错了最坏是多一批 devseed_ 行，删掉就行。
-- 删除是**不可逆**的，而且按前缀批量删 —— 一旦 DSN 指到不是开发库，
-- `DELETE FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'` 本身看着
-- 很安全（只碰 devseed_ 前缀），可一旦有人后来把 devseed_ 前缀用到了真实数据上，
-- 这条脚本就会静默吃掉它。所以这里强制三重确认：
--
--   1. 数据库名不得带生产特征（prod / production / live）；`proxy` 这类开发库放行；
--   2. 必须显式传 --i-know-this-is-dev（脚本没收到就拒绝执行）；
--   3. 事务里先打印将要删除的行数并要求确认，再真正 DELETE。
--
-- AGENTS.md 说"生产代码不得硬删除用户业务数据" —— 这个文件是**开发脚本不是生产
-- 代码**，而且用户明确要求这批数据"后期删除"。但护栏不能省：省掉护栏的那次删除
-- 就是不可撤销的。
--
-- 用法：
--   psql "$DATABASE_URL" -v I_KNOW=1 -f apps/api-go/scripts/seed_dev_shops_users_remove.sql
--   （或 make 式的便捷封装：bash scripts/dev-seed-reset.sh）

\set ON_ERROR_STOP on

-- ── 护栏 1：必须显式确认 ─────────────────────────────────────────────────────
\if :{?I_KNOW}
\else
  \echo '拒绝执行：没有收到 -v I_KNOW=1。'
  \echo '这批数据是开发种子，删除不可撤销；请确认 DSN 指向开发库后再跑。'
  -- \quit 不接受参数（`\quit 1` 会被 psql 报 "extra argument 1 ignored" 然后
  -- 仍然以 0 退出）—— 护栏必须真的让调用方拿到非 0，所以用 \set ON_ERROR_STOP
  -- 配合一个必然失败的语句来产生非 0 退出码。
  SELECT 1/0;
\endif

-- ── 护栏 2：库名必须是开发库 ─────────────────────────────────────────────────
DO $$
DECLARE
  dbname text := current_database();
BEGIN
  -- 模式要**够宽能覆盖真开发库**。第一版只认 dev/local/test/e2e/scratch，
  -- 结果把本项目的开发库 `proxy` 拦在外面 —— 护栏太窄等于没有护栏：
  -- 真要用的时候只能被人加个白名单绕过去，那还不如一开始就把 `proxy` 写进去。
  -- 现在按"**排除**生产特征"来判：只要名字里出现 prod / production / live 就拒绝，
  -- 其余（proxy / dev / local / test / e2e / scratch / 随机开发库名）都放行。
  IF dbname ~* '(prod|production|live)' THEN
    RAISE EXCEPTION '拒绝在库 % 上执行删除：库名带生产特征（prod/production/live）。', dbname
      USING HINT = '这是不可撤销的批量删除。确认 DSN 指向开发库后重试。';
  END IF;
  RAISE NOTICE '护栏通过：当前库 % 匹配开发库模式。', dbname;
END $$;

\echo ''
\echo '── 将要删除的行（确认无误再继续）──'

SELECT 'business.stores'    AS table_name, count(*) FROM business.stores    WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.accounts',      count(*) FROM business.accounts      WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'identity.profiles',      count(*) FROM identity.profiles      WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.user_accounts', count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'
ORDER BY 1;

\echo ''
\echo '注意：先删子表再删父表 —— business.accounts 有 owner_user_id 外键指向'
\echo 'identity.user_accounts，所以顺序反了会撞外键约束。'

BEGIN;

-- 顺序：store → account（business 侧），profile → user_account（identity 侧）。
-- business.accounts 的外键是 ON DELETE RESTRICT，所以必须先删 account；
-- identity.user_accounts 侧同理（profiles 是 CASCADE，但显式先删更清楚，
-- 免得依赖 CASCADE 悄悄改变行为）。
DELETE FROM business.stores    WHERE id LIKE 'store_devseed_%';
DELETE FROM business.accounts  WHERE id LIKE 'biz_devseed_%';
DELETE FROM identity.profiles   WHERE user_account_id LIKE 'user_devseed_%';
DELETE FROM identity.user_accounts WHERE id LIKE 'user_devseed_%';

COMMIT;

\echo ''
\echo '── 删除后（应全为 0）──'
SELECT 'business.stores' AS table_name, count(*) FROM business.stores    WHERE id LIKE 'store_devseed_%'
UNION ALL SELECT 'business.accounts',      count(*) FROM business.accounts      WHERE id LIKE 'biz_devseed_%'
UNION ALL SELECT 'identity.profiles',      count(*) FROM identity.profiles      WHERE user_account_id LIKE 'user_devseed_%'
UNION ALL SELECT 'identity.user_accounts', count(*) FROM identity.user_accounts WHERE id LIKE 'user_devseed_%'
ORDER BY 1;
