// Chat titles: one line, at most 120 characters, no control characters or markup.
export const MAX_TITLE = 120;

export function normalizeTitle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > MAX_TITLE || /[\u0000-\u001f\u007f<>]/.test(value)) return null;
  return value;
}

/** A first message makes a fine default title: its first line, cut to a readable length. */
export function titleFromMessage(message: string): string {
  const firstLine = message.split('\n').find((l) => l.trim()) ?? message;
  const flat = firstLine.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat || 'New chat';
}
