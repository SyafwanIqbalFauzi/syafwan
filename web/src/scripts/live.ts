// "No page reload" for the CMS. Pages are drawn by the server; after a change (or a filter / tab click) the
// browser fetches the same page again in the background and swaps the part that changed, so scroll position,
// open dialogs and the sidebar stay as they are. If anything goes wrong it falls back to a normal reload, so
// it is never worse than before.
//
// What a page script uses:
//   refresh()                     fetch the current address again and swap the content (after a change)
//   navigate(url)                 same, for another query string of this page (pushes history)
//   delegate(type, selector, fn)  one listener on the document that keeps working after a swap
//   mountLive(init)               runs init(root) now and again after every swap (for things that must be
//                                 set up on the elements, e.g. a chart or a date picker); the function
//                                 init returns is called before the content is swapped out
//
// What is swapped: the children of `#main > .container` except <dialog> elements (an open dialog stays open),
// the elements marked data-live-slot (sidebar badges) and the title. Links and GET forms inside the page that
// point at the same path with another query string are taken over automatically; mark one data-no-live to
// opt out, and `body[data-live="off"]` turns the whole thing off (the chat page).
import { focusSelector, formUrl, isPlainClick, liveTarget, sameView } from '../lib/live-nav';

type Mount = (root: HTMLElement) => void | (() => void);

const mounts = new Map<Mount, (() => void) | void>();
let controller: AbortController | null = null;
let shown = location.href;

const pageRoot = () => document.querySelector<HTMLElement>('#main > .container');
const enabled = () => document.body.dataset.live !== 'off' && pageRoot() !== null;
const inPage = (el: Element) => Boolean(document.getElementById('main')?.contains(el)) && !el.closest('dialog');

export function mountLive(init: Mount): void {
  mounts.set(init, init(pageRoot() ?? document.body));
}

export function delegate<E extends Element = HTMLElement>(type: string, selector: string, handler: (el: E, event: Event) => void): void {
  document.addEventListener(type, (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest<E>(selector);
    if (el) handler(el, event);
  });
}

/** Tell live.ts the address was changed on purpose with history.replaceState (tabs, hidden people). */
export function settled(): void {
  shown = location.href;
}

/** Fetch the current page again and swap what changed. Resolves false when it had to fall back to a full load. */
export function refresh(): Promise<boolean> {
  return load(new URL(location.href), false);
}

/** Show another query string of this page without a reload. */
export function navigate(url: URL): Promise<boolean> {
  return load(url, true);
}

async function load(url: URL, push: boolean): Promise<boolean> {
  const fallback = () => (push ? location.assign(url) : location.reload());
  if (!enabled()) {
    fallback();
    return false;
  }
  controller?.abort();
  const mine = (controller = new AbortController());
  const main = document.getElementById('main');
  main?.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: mine.signal, headers: { Accept: 'text/html' } });
    if (mine.signal.aborted) return true; // a newer load took over
    // Signed out (redirect to the sign-in page) or moved: let the browser go there.
    if (new URL(res.url).pathname !== url.pathname) {
      location.assign(res.url);
      return false;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (mine.signal.aborted) return true;
    if (push) history.pushState(null, '', url.pathname + url.search + url.hash);
    if (!swap(doc)) throw new Error('unexpected page shape');
    shown = location.href;
    return true;
  } catch {
    if (mine.signal.aborted) return true;
    fallback();
    return false;
  } finally {
    if (controller === mine) {
      controller = null;
      main?.removeAttribute('aria-busy');
    }
  }
}

const RUNNABLE_SCRIPT = 'script:not([type="application/json"])';

function swap(doc: Document): boolean {
  const root = pageRoot();
  const next = doc.querySelector<HTMLElement>('#main > .container');
  if (!root || !next) return false;

  for (const cleanup of mounts.values()) cleanup?.();

  const active = document.activeElement;
  const hadFocus = active instanceof HTMLElement && root.contains(active) && !active.closest('dialog') ? active : null;
  const wanted = hadFocus
    ? focusSelector(
        hadFocus.tagName,
        hadFocus.id,
        [...hadFocus.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value] as [string, string]),
      )
    : null;

  if (doc.title) document.title = doc.title;

  // The container keeps its identity; its data- attributes and class follow the new page (e.g. data-year).
  for (const attr of [...root.attributes]) if (!next.hasAttribute(attr.name)) root.removeAttribute(attr.name);
  for (const attr of [...next.attributes]) if (root.getAttribute(attr.name) !== attr.value) root.setAttribute(attr.name, attr.value);

  next.querySelectorAll(RUNNABLE_SCRIPT).forEach((s) => s.remove());
  for (const child of [...root.children]) if (child.tagName !== 'DIALOG') child.remove();
  const anchor = root.querySelector(':scope > dialog');
  for (const child of [...next.children]) {
    if (child.tagName === 'DIALOG') continue; // the open one stays; it is the same dialog
    const node = document.importNode(child, true);
    if (anchor) root.insertBefore(node, anchor);
    else root.append(node);
  }

  // Sidebar badges and similar: replaced in place by key.
  document.querySelectorAll<HTMLElement>('[data-live-slot]').forEach((slot) => {
    const fresh = [...doc.querySelectorAll<HTMLElement>('[data-live-slot]')].find((s) => s.dataset.liveSlot === slot.dataset.liveSlot);
    if (fresh && fresh.innerHTML !== slot.innerHTML) slot.innerHTML = fresh.innerHTML;
  });

  for (const init of [...mounts.keys()]) mounts.set(init, init(root));

  if (wanted && (!hadFocus || !hadFocus.isConnected)) root.querySelector<HTMLElement>(wanted)?.focus({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('live:swap'));
  return true;
}

// ---- links, GET forms and the back button -------------------------------------------------------------

document.addEventListener('click', (event) => {
  if (!enabled() || !isPlainClick(event)) return;
  const target = event.target;
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link || !inPage(link) || link.target || link.hasAttribute('download') || link.hasAttribute('data-no-live')) return;
  const url = liveTarget(link.href, location.href);
  if (!url) return;
  event.preventDefault();
  void navigate(url);
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (event.defaultPrevented || !enabled() || !(form instanceof HTMLFormElement) || !inPage(form) || form.hasAttribute('data-no-live')) return;
  // Only forms that say method="get" out loud (the filter bars). A form without it is handled by its own script,
  // and a document-level listener cannot know whether that script has already called preventDefault().
  if (form.getAttribute('method')?.toLowerCase() !== 'get') return;
  const url = liveTarget(formUrl(form.getAttribute('action'), new FormData(form), location.href).href, location.href);
  if (!url) return;
  event.preventDefault();
  void navigate(url);
});

window.addEventListener('popstate', () => {
  if (!enabled() || sameView(location.href, shown)) return;
  void load(new URL(location.href), false);
});
