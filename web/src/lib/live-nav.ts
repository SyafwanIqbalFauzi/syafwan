// Pure rules for "no page reload" in the CMS (see scripts/live.ts, which does the DOM work).
// A link click or a GET form may be answered by swapping the page content instead of loading a new
// page, but only when the target is the very same page (same path) with another query string.

/** The URL to fetch for a link or form that points at `href`, or null when the browser should do its normal thing. */
export function liveTarget(href: string, current: string): URL | null {
  let target: URL;
  let here: URL;
  try {
    here = new URL(current);
    target = new URL(href, here);
  } catch {
    return null;
  }
  if (target.origin !== here.origin) return null;
  if (target.pathname !== here.pathname) return null;
  // Same query and a #hash: an in-page jump (skip link, anchor). The browser handles those.
  if (target.search === here.search && target.hash) return null;
  return target;
}

/** The address a GET form sends to: `action` (or the current path) plus the filled-in fields. Empty values are left out. */
export function formUrl(action: string | null, entries: Iterable<[string, FormDataEntryValue]>, current: string): URL {
  const url = new URL(action || current, current);
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (typeof value !== 'string' || value === '') continue;
    params.append(name, value);
  }
  url.search = params.toString();
  url.hash = '';
  return url;
}

interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** A plain left click: not a new-tab / download / selection gesture, and nobody else has handled it. */
export function isPlainClick(event: ClickLike): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Two addresses show the same view when path and query match (the #hash does not matter). */
export function sameView(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

/** A CSS selector that finds `el` again in a fresh copy of the page (by id, else by its first data- attribute). */
export function focusSelector(tag: string, id: string, dataAttrs: [string, string][]): string | null {
  const esc = (v: string) => v.replace(/["\\]/g, '\\$&');
  if (id) return `#${id.replace(/[^\w-]/g, '\\$&')}`;
  const first = dataAttrs[0];
  if (!first) return null;
  return `${tag.toLowerCase()}[${first[0]}="${esc(first[1])}"]`;
}
