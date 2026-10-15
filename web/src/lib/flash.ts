// A message that has to survive a page change: "Budget line added" is decided before the page
// reloads, and shown after. Kept in sessionStorage for a short while, read once. Pure (the storage
// is passed in), so it is unit tested.

export type FlashKind = 'success' | 'error' | 'info';

export interface Flash {
  message: string;
  kind: FlashKind;
  at: number;
}

export interface FlashStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FLASH_KEY = 'agent.flash';
/** A message older than this is dropped (the person closed the tab and came back much later). */
export const FLASH_MAX_AGE_MS = 30_000;
const MAX_LENGTH = 300;

const KINDS: FlashKind[] = ['success', 'error', 'info'];

export function saveFlash(store: FlashStore, message: string, kind: FlashKind = 'success', now = Date.now()): void {
  try {
    const flash: Flash = { message: message.slice(0, MAX_LENGTH), kind, at: now };
    store.setItem(FLASH_KEY, JSON.stringify(flash));
  } catch {
    /* storage unavailable: the page still reloads, there is just no message */
  }
}

/** The pending message, if any and still fresh. It is removed from the store either way. */
export function takeFlash(store: FlashStore, now = Date.now()): Flash | null {
  try {
    const raw = store.getItem(FLASH_KEY);
    if (raw === null) return null;
    store.removeItem(FLASH_KEY);
    const value = JSON.parse(raw) as Partial<Flash>;
    if (typeof value.message !== 'string' || !value.message || !KINDS.includes(value.kind as FlashKind) || typeof value.at !== 'number') return null;
    if (now - value.at > FLASH_MAX_AGE_MS || value.at - now > 5_000) return null;
    return { message: value.message.slice(0, MAX_LENGTH), kind: value.kind as FlashKind, at: value.at };
  } catch {
    return null;
  }
}
