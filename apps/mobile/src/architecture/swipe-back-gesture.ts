export const SWIPE_BACK_EDGE_PX = 28;

/** 只有从左边缘起步、明确向右且横向占优时，子页返回才取得 responder。 */
export function shouldStartSwipeBack(input: { startX: number; dx: number; dy: number }): boolean {
  return input.startX <= SWIPE_BACK_EDGE_PX && input.dx > 12 && Math.abs(input.dx) > Math.abs(input.dy) * 1.2;
}
