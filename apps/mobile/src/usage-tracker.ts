import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { LocalNetClient } from "./localnet-client";
import { endAppSession, endScreenView, screenIdOf } from "./post-impression";

// TAG-PIPELINE：用户在每个页面停留多久 + 每次前台会话多久。
// 采集闸（用户显式同意、fail-closed）在 endScreenView / endAppSession 里；没同意就一个请求都不发。
// 切后台 = 结算当前页面和当前会话；回前台重新计时（后台那段不算）。

export function useUsageTracker(localNet: Pick<LocalNetClient, "recordScreenView" | "recordAppSession">, page: string): void {
  const screen = screenIdOf(page);
  const screenRef = useRef({ id: screen, startedAt: Date.now() });
  const sessionStart = useRef(Date.now());
  const active = useRef(AppState.currentState === "active");

  // 页面切换：结算上一页，开始新一页。
  useEffect(() => {
    const prev = screenRef.current;
    if (prev.id !== screen) {
      if (active.current) void endScreenView(localNet, prev.id, prev.startedAt);
      screenRef.current = { id: screen, startedAt: Date.now() };
    }
  }, [screen, localNet]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (active.current) {
          void endScreenView(localNet, screenRef.current.id, screenRef.current.startedAt);
          void endAppSession(localNet, sessionStart.current);
        }
        active.current = false;
        return;
      }
      if (!active.current) {
        active.current = true;
        const now = Date.now();
        screenRef.current = { id: screenRef.current.id, startedAt: now };
        sessionStart.current = now;
      }
    });
    return () => sub.remove();
  }, [localNet]);
}
