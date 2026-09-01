-- R15.18 P1 follow-up B: 事件保留期 (retention).
-- 访客 (anon_*) 事件 30 天自动清, 用户事件 90 天.
-- 不跑后台 cron, 本轮只给函数, 由运维 / future P1 follow-up
-- 调度 (P2 v1.5 留接口不接 scheduler).

CREATE OR REPLACE FUNCTION localnet.purge_old_events(p_anon_days INT, p_user_days INT) RETURNS TABLE(deleted_anon BIGINT, deleted_user BIGINT) AS $$
DECLARE
  v_anon BIGINT;
  v_user BIGINT;
BEGIN
  DELETE FROM localnet.interaction_events
    WHERE actor_id LIKE 'anon_%'
      AND created_at < NOW() - (p_anon_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_anon = ROW_COUNT;
  DELETE FROM localnet.interaction_events
    WHERE actor_id NOT LIKE 'anon_%'
      AND created_at < NOW() - (p_user_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_user = ROW_COUNT;
  RETURN QUERY SELECT v_anon, v_user;
END;
$$ LANGUAGE plpgsql;
