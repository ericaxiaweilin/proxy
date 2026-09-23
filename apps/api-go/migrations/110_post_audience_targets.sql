-- 110_post_audience_targets.sql
-- AI-TWIN-POST-AUDIENCE-001 — per-post viewer allowlist for TARGETED visibility.
--
-- 背景：AI 分身「帖文编排」原型（用户 2026-09-21 提供，deepseek_html_
-- 20260921_663482.html「小美 · AI 分身（受众调度版）」）要求分身能把一条
-- 帖子只投给指定的几位好友，而不是公开或对全部关注者可见。
-- localnet.posts.visibility 目前只有 PUBLIC / FOLLOWERS / AGENT_ONLY 三档，
-- 都表达不了"只给这几个人看"——尤其 FOLLOWERS：关注图目前没实现，读侧
-- fail-closed 当 self-only 处理（见 internal/localnet/service.go 的
-- "Follow-graph authorization is not implemented yet" 注释），复用它会让
-- 语义混在一起。这里加第四档 TARGETED，配一张显式白名单表。
--
-- 只加表，不加列级 CHECK：visibility 列本身历来没有 DB 侧 CHECK 约束（纯
-- 应用层校验，见 001_r14_schema.sql），这次不新引入，维持现状一致。
--
-- 读侧强制不在这次迁移里生效——SQL 查询与内存仓两条路径的过滤改动是
-- 同一批 commit 的 Go 代码改动，缺一个都会出现「一条路径挡住了、另一条
-- 没挡」的后门，读代码改动时的注释能找到这条迁移。

CREATE TABLE IF NOT EXISTS localnet.post_audience_targets (
    post_id           TEXT NOT NULL REFERENCES localnet.posts(id),
    target_account_id TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, target_account_id)
);

-- 反向查询用：「这个人被哪些 TARGETED 帖子点过名」——帖文编排的
-- 「AI 重编」在选受众时需要知道一个人最近被投放过什么，避免重复。
CREATE INDEX IF NOT EXISTS idx_post_audience_targets_target
    ON localnet.post_audience_targets (target_account_id);

COMMENT ON TABLE localnet.post_audience_targets IS
  'TARGETED 帖子的显式可见者白名单。作者本人隐式可见，不需要在这张表里出现。见 AI-TWIN-POST-AUDIENCE-001。';
