// Auto-scroll rule for the chat log: follow new content only while the reader is already at the bottom.
// Someone reading older messages must not be pulled down when a new one arrives.

/** Pixels from the bottom that still count as "at the bottom" (covers rounding and a short last line). */
export const BOTTOM_SLACK = 80;

export function isNearBottom(m: { scrollHeight: number; scrollTop: number; clientHeight: number }, slack = BOTTOM_SLACK): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= slack;
}

/** Scroll when forced (the person just sent or opened a chat) or when they are following the end. */
export function shouldAutoScroll(following: boolean, force: boolean): boolean {
  return force || following;
}

export function jumpLabel(unseen: boolean): string {
  return unseen ? 'New messages' : 'Latest';
}
