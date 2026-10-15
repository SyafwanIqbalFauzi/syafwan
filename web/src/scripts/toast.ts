// Small pop-up messages ("Budget line added") in the corner of the page. `toast` shows one now;
// `flash` remembers one for the page that loads next (most changes end with a reload) and
// `showFlash` (called once per page by the layout) shows it. Look: ".toast" in styles/hermes.css.
import { saveFlash, takeFlash, type FlashKind } from '../lib/flash';

export type ToastKind = FlashKind;

interface ToastOptions {
  title?: string;
  /** Makes the whole message a link */
  href?: string;
  /** Milliseconds; errors stay longer */
  duration?: number;
}

const TITLES: Record<ToastKind, string> = { success: 'Done', error: 'That did not work', info: 'Note' };

function container(): HTMLElement {
  let box = document.querySelector<HTMLElement>('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    document.body.append(box);
  }
  return box;
}

export function toast(message: string, kind: ToastKind = 'success', options: ToastOptions = {}): void {
  const item = document.createElement(options.href ? 'a' : 'div');
  item.className = `toast toast-${kind}`;
  item.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  if (item instanceof HTMLAnchorElement && options.href) item.href = options.href;
  const title = document.createElement('strong');
  title.textContent = options.title ?? TITLES[kind];
  const text = document.createElement('span');
  text.textContent = message;
  item.append(title, text);

  const close = () => {
    item.classList.add('leaving');
    setTimeout(() => item.remove(), 200);
  };
  const timer = setTimeout(close, options.duration ?? (kind === 'error' ? 8000 : 4000));
  item.addEventListener('click', (event) => {
    if (!options.href) {
      event.preventDefault();
      clearTimeout(timer);
      close();
    }
  });
  container().append(item);
}

/** Show `message` on the next page that loads (use right before `location.reload()` or a redirect). */
export function flash(message: string, kind: ToastKind = 'success'): void {
  try {
    saveFlash(sessionStorage, message, kind);
  } catch {
    /* sessionStorage blocked: no message, the page still works */
  }
}

export function showFlash(): void {
  try {
    const pending = takeFlash(sessionStorage);
    if (pending) toast(pending.message, pending.kind);
  } catch {
    /* ignore */
  }
}
