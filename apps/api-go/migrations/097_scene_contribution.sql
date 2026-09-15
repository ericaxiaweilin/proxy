-- SCENE-CONTRIB-001: 用户可以提交新场景，但要经过**社区确认**才进目录。
--
-- 目录里现有的 11 条，坐标和地址都是 OSM/Nominatim 查过的（Scene.Source='OSM'）。
-- 用户提交的一条都没有查过 —— 把两种数据混在一起还长得一模一样，就是重犯
-- 刚删掉的那个错（用没来源的数据冒充有来源的）。所以：
--   · 每条场景都带 source，客户端必须把「社区提交 · 未经核实」标出来；
--   · 用户提交的场景**默认不进目录**，要 ≥2 个**除提交者以外**的人确认
--     「这地方真的存在」才上架（realityscene.ProposalConfirmationsNeeded）；
--   · 提交者不能确认自己的提交 —— 自己给自己背书等于没有确认。
--
-- 为什么是"社区确认"而不是"管理员审核"：本仓现在没有任何运营后台，做一个
-- 没人看的审核队列就是新的半截接线。确认数是可以真算出来的，审核状态不是。
CREATE TABLE IF NOT EXISTS reality.scene_proposals (
  id           TEXT PRIMARY KEY,
  proposed_by  TEXT NOT NULL,
  name         TEXT NOT NULL,
  area         TEXT NOT NULL,
  type         TEXT NOT NULL,
  address      TEXT NOT NULL DEFAULT '',
  latitude     DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  description  TEXT NOT NULL DEFAULT '',
  -- 提交者不知道营业时间就留默认的"以现场公告为准"，不替他编。
  best         TEXT NOT NULL DEFAULT '以现场公告为准',
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);

-- 一个用户对同一条提案只能确认一次（主键）；提交者的确认在**服务层**拒掉，
-- 不写进这张表 —— 写进来再靠查询过滤，早晚会有人忘记过滤。
CREATE TABLE IF NOT EXISTS reality.scene_proposal_confirmations (
  proposal_id TEXT NOT NULL REFERENCES reality.scene_proposals(id) ON DELETE CASCADE,
  actor_id    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, actor_id)
);

CREATE INDEX IF NOT EXISTS reality_scene_proposals_status_idx
  ON reality.scene_proposals (status, created_at DESC);

COMMENT ON TABLE reality.scene_proposals IS
  'Community-submitted scenes. Unverified: coordinates are user-supplied, never geocoded. Never mix with OSM-verified rows without surfacing the source.';
