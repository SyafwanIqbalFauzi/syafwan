// Height of the chat message box: it grows with what is typed (so a long message needs no scrolling),
// and the person can also pull it taller by hand. Pure, so it can be tested.

export const COMPOSER_MIN = 56; // px, about two lines
export const COMPOSER_KEY = 'chat.composerHeight';
const STEP = 24; // px per arrow key press on the handle

/** Largest height allowed: part of the visible area, so the conversation above never disappears. */
export const composerMax = (viewportHeight: number): number => Math.max(COMPOSER_MIN, Math.floor(viewportHeight * 0.55));

/** Keep a hand-set height inside what is allowed; anything that is not a number means "not set" (0). */
export function clampManual(value: unknown, viewportHeight: number): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= COMPOSER_MIN) return 0;
  return Math.min(Math.round(n), composerMax(viewportHeight));
}

/**
 * The height to give the box: whatever fits the text (`contentHeight`, its scrollHeight), but never less
 * than the hand-set height, never less than the minimum and never more than the maximum.
 */
export function composerHeight(contentHeight: number, manual: number, viewportHeight: number): number {
  const max = composerMax(viewportHeight);
  const wanted = Math.max(COMPOSER_MIN, manual, Number.isFinite(contentHeight) ? contentHeight : 0);
  return Math.min(Math.ceil(wanted), max);
}

/** Next hand-set height after an arrow key on the handle (up = taller). Null for other keys. */
export function heightAfterKey(key: string, current: number, viewportHeight: number): number | null {
  if (key === 'ArrowUp') return clampManual(current + STEP, viewportHeight);
  if (key === 'ArrowDown') return clampManual(current - STEP, viewportHeight);
  if (key === 'Home' || key === 'Escape') return 0;
  return null;
}
