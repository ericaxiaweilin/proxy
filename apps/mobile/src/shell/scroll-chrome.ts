/**
 * SCROLL-CHROME-001 — shared "hide the shell chrome while scrolling" controller.
 *
 * Six surfaces (messages, feed, me, market, requester-home, business-home) each
 * carried their own copy of this rule: up-scroll hides the chrome, down-scroll or
 * back-to-top shows it, with an accumulator and -18/+28 thresholds.
 *
 * The copies also carried the same feedback loop:
 *
 *   1. user scrolls down -> accumulator reaches +28 -> chrome hides
 *   2. hiding chrome unmounts the shell Header (app-shell) and shrinks several
 *      surfaces' bottom padding, so both the scrollable's *frame* height and its
 *      *content* height change
 *   3. the current contentOffset is now past the end, so RN clamps it
 *   4. the clamp emits a scroll event whose delta is NEGATIVE
 *   5. the accumulator reaches -18 -> chrome shows again -> back to step 2
 *
 * That is an infinite oscillation. On the messages list it shows up as "scrolling
 * to the bottom snaps back to the middle", plus the header logo blinking on and
 * off — the header is unmounted and remounted on every lap.
 *
 * Tuning the thresholds only changes the frequency, so the fix is to stop reading
 * the *consequences of our own layout change* as user intent: once we change chrome
 * visibility, scroll events are ignored until the layout has settled.
 *
 * Surfaces keep their own extras (sticky headers, pagination) by using the y and
 * action this hook returns.
 */
import { useCallback, useEffect, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** At or above this offset the list is treated as "back at the top". */
export const CHROME_SHOW_AT_TOP_Y = 48;
/** Accumulated downward travel that shows the chrome. */
export const CHROME_SHOW_ACCUMULATED = -18;
/** Accumulated upward travel that hides the chrome. */
export const CHROME_HIDE_ACCUMULATED = 28;
/**
 * How long to ignore scroll events after changing chrome visibility. The clamp
 * arrives with the next layout pass, and RN can batch it with the following
 * scroll tick, so a single frame is not always enough.
 */
export const CHROME_SETTLE_MS = 150;

export type ChromeScrollAction = "none" | "show" | "hide";

export type ChromeScrollResult = {
  /** Clamped content offset of this event. */
  y: number;
  /** What this event did to the chrome, if anything. */
  action: ChromeScrollAction;
  /** True when this event was a layout echo and carries no user intent. */
  suppressed: boolean;
};

export type ChromeScrollState = {
  lastY: number;
  accumulated: number;
  visible: boolean;
  suppressUntil: number;
};

export function createChromeScrollState(): ChromeScrollState {
  return { lastY: 0, accumulated: 0, visible: true, suppressUntil: 0 };
}

export type ChromeScrollInputs = {
  state: ChromeScrollState;
  event: NativeSyntheticEvent<NativeScrollEvent>;
  /** Injected clock (ms). The hook passes Date.now(); tests pass a fixed value. */
  now: number;
  onChange?: ((visible: boolean) => void) | undefined;
  canHide?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => boolean) | undefined;
};

/**
 * Pure decision step, separated from the hook so the feedback loop can be
 * replayed in a unit test with an injected clock — the oscillation only
 * reproduces if you can advance time past the settle window, which a real
 * timer-based test cannot do reliably.
 *
 * Mutates `state` in place (same as the hook did) and returns the event's
 * verdict so surfaces can still run their own side effects.
 */
export function applyChromeScroll(inputs: ChromeScrollInputs): ChromeScrollResult {
  const { state, event, now, onChange, canHide } = inputs;
  const y = Math.max(0, event.nativeEvent.contentOffset.y);

  if (now < state.suppressUntil) {
    state.lastY = y;
    return { y, action: "none", suppressed: true };
  }

  const delta = y - state.lastY;
  state.lastY = y;

  const apply = (visible: boolean): ChromeScrollAction => {
    state.visible = visible;
    state.accumulated = 0;
    // Arm the guard BEFORE notifying: the notification is what changes the
    // layout that produces the echo we need to ignore.
    state.suppressUntil = now + CHROME_SETTLE_MS;
    onChange?.(visible);
    return visible ? "show" : "hide";
  };

  if (y <= CHROME_SHOW_AT_TOP_Y) {
    state.accumulated = 0;
    return { y, action: state.visible ? "none" : apply(true), suppressed: false };
  }

  if (Math.abs(delta) < 1) {
    return { y, action: "none", suppressed: false };
  }

  const previousDirection = Math.sign(state.accumulated);
  const nextDirection = Math.sign(delta);
  state.accumulated = previousDirection !== 0 && previousDirection !== nextDirection
    ? delta
    : state.accumulated + delta;

  if (state.accumulated <= CHROME_SHOW_ACCUMULATED) {
    return { y, action: state.visible ? "none" : apply(true), suppressed: false };
  }
  if (state.accumulated >= CHROME_HIDE_ACCUMULATED) {
    if (canHide && !canHide(event)) {
      state.accumulated = 0;
      return { y, action: "none", suppressed: false };
    }
    return { y, action: state.visible ? apply(false) : "none", suppressed: false };
  }
  return { y, action: "none", suppressed: false };
}

export type ScrollChromeOptions = {
  /**
   * Optional veto on hiding, evaluated with the event that triggered the hide.
   * Market uses it to keep the chrome visible near the end of the list (the
   * Safari "keep the toolbar at the bottom" behaviour).
   */
  canHide?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => boolean) | undefined;
};

export function useScrollChrome(
  onChromeVisibilityChange?: ((visible: boolean) => void) | undefined,
  options?: ScrollChromeOptions
): (event: NativeSyntheticEvent<NativeScrollEvent>) => ChromeScrollResult {
  const stateRef = useRef<ChromeScrollState>(createChromeScrollState());
  const changeRef = useRef(onChromeVisibilityChange);
  changeRef.current = onChromeVisibilityChange;
  const canHideRef = useRef(options?.canHide);
  canHideRef.current = options?.canHide;

  // Leaving a surface must not strand the shell with its chrome hidden.
  useEffect(
    () => () => {
      changeRef.current?.(true);
    },
    []
  );

  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>): ChromeScrollResult =>
    applyChromeScroll({
      state: stateRef.current,
      event,
      now: Date.now(),
      onChange: changeRef.current,
      canHide: canHideRef.current
    }), []);
}
