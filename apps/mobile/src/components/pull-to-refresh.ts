import { useCallback, useEffect, useRef, useState } from "react";

// PULL-REFRESH-001（2026-09-23，用户：「目前所有社交产品都是上下滑动进行刷新 我们缺少这个逻辑」）：
// 下拉刷新的两种接法，供 <ScrollView refreshControl={<RefreshControl … />}> 用。
//
// 转圈必须跟着**真实的加载**停 —— 不是固定转 1 秒就收：那样网络慢时圈停了、数据还没来，
// 用户以为已经是最新的。所以：
//   - usePullToRefresh(load)：load 返回的 Promise 结束才停；
//   - useTrackedRefresh()：给「靠 effect 重跑来加载」的页面用 —— 下拉时 bump 一个 nonce 让
//     effect 重跑，effect 里的请求用 track() 包一下，全部结束才停。
// 两种都带兜底超时（REFRESH_TIMEOUT_MS），请求挂死也不会让圈永远转。

const REFRESH_TIMEOUT_MS = 15_000;

export function usePullToRefresh(load: () => Promise<unknown> | unknown): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const running = useRef(false);
  const onRefresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setRefreshing(true);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      running.current = false;
      setRefreshing(false);
    };
    const timer = setTimeout(finish, REFRESH_TIMEOUT_MS);
    Promise.resolve()
      .then(load)
      .catch(() => undefined)
      .finally(() => { clearTimeout(timer); finish(); });
  }, [load]);
  return { refreshing, onRefresh };
}

export function useTrackedRefresh(): {
  refreshing: boolean;
  onRefresh: () => void;
  nonce: number;
  track: <T>(promise: Promise<T>) => Promise<T>;
} {
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const pending = useRef(0);
  const refreshingRef = useRef(false);

  const settle = useCallback(() => {
    if (refreshingRef.current && pending.current === 0) {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  const track = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    pending.current += 1;
    void promise.catch(() => undefined).finally(() => {
      pending.current = Math.max(0, pending.current - 1);
      settle();
    });
    return promise;
  }, [settle]);

  const onRefresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setNonce((value) => value + 1);
  }, []);

  // effect 重跑之后如果一个请求都没发（比如访客、客户端没接），也要停。
  useEffect(() => {
    if (!refreshingRef.current) return;
    const idle = setTimeout(settle, 300);
    const hardStop = setTimeout(() => { refreshingRef.current = false; setRefreshing(false); }, REFRESH_TIMEOUT_MS);
    return () => { clearTimeout(idle); clearTimeout(hardStop); };
  }, [nonce, settle]);

  return { refreshing, onRefresh, nonce, track };
}
