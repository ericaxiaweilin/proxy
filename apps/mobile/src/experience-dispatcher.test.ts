import { describe, expect, it } from "vitest";
import { dispatchExperienceAction } from "./experience-dispatcher";

describe("Experience action dispatcher", () => {
  it("dispatches the registered TASKS action", () => {
    const calls: unknown[] = [];

    const handled = dispatchExperienceAction(
      {
        type: "OPEN_SURFACE",
        surface: "TASKS",
        params: {
          view: "ACTIVITY",
          filter: "MINE"
        }
      },
      {
        openSurface: (surface, params) => {
          calls.push({ surface, params });
        }
      }
    );

    expect(handled).toBe(true);
    expect(calls).toEqual([
      {
        surface: "TASKS",
        params: {
          view: "ACTIVITY",
          filter: "MINE"
        }
      }
    ]);
  });

  it("rejects arbitrary remote actions fail-closed", () => {
    let called = false;

    const handled = dispatchExperienceAction(
      {
        type: "RUN_ARBITRARY_CODE",
        javascript: "eval('bad')"
      },
      {
        openSurface: () => {
          called = true;
        }
      }
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });

  it("rejects unregistered surfaces fail-closed", () => {
    let called = false;

    const handled = dispatchExperienceAction(
      {
        type: "OPEN_SURFACE",
        surface: "SECRET_ADMIN",
        params: {}
      },
      {
        openSurface: () => {
          called = true;
        }
      }
    );

    expect(handled).toBe(false);
    expect(called).toBe(false);
  });
});
