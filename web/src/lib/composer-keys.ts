// Enter in the chat box: sends on a desktop (precise pointer), adds a new line on a phone/tablet
// (coarse pointer) and whenever Shift is held or an IME is composing.
export interface EnterKey {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

export function enterSends(e: EnterKey, coarsePointer: boolean): boolean {
  if (e.key !== 'Enter') return false;
  if (coarsePointer) return false;
  if (e.shiftKey || e.altKey || e.isComposing) return false;
  return true;
}
