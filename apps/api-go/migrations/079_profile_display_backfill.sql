-- PROFILE-READ-001: 存量 "你" 展示名回填 (只改展示字段, 不动归属).
--
-- 发布器曾把 viewer 相对标签 "你" 写进展示名字段 (动态 / 状态 /
-- 个人机会), 导致所有用户看到的作者都是 "你". 发布时服务端解析
-- (localnet / socialspace / marketplace) 已上线, 此迁移把存量脏数据
-- 清成空串: 读端按 author id 判定归属、无名按中性兜底展示.
-- 权威归属列 (author_id / owner_id) 不动; 幂等, 可重放.

UPDATE localnet.posts
SET author_display_name = ''
WHERE author_display_name = '你';

UPDATE socialspace.statuses
SET author_display_name = ''
WHERE author_display_name = '你';

UPDATE marketplace.opportunities
SET payload = jsonb_set(payload, '{owner}', '""')
WHERE payload ->> 'owner' = '你';
