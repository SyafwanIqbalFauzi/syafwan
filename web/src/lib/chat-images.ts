// Images in the chat: what the browser may send with a message and what it may show from history.
// Pure functions, shared by the API route (validation) and the page (display), unit-tested.

export const MAX_IMAGES = 4;
/** Per image, as the data URL string that is sent (about 2.6 MB of picture after base64). */
export const MAX_IMAGE_DATA_URL_CHARS = 3_500_000;
/** All images of one message together; Hermes accepts 10 MB per request. */
export const MAX_TOTAL_DATA_URL_CHARS = 8_000_000;

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ImageCheck = { ok: true; images: string[] } | { ok: false; error: string };

/** Validate the `images` field of a message: a short list of base64 image data URLs. */
export function parseImages(value: unknown): ImageCheck {
  if (value === undefined || value === null) return { ok: true, images: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'Invalid images' };
  if (value.length > MAX_IMAGES) return { ok: false, error: `At most ${MAX_IMAGES} images per message` };
  let total = 0;
  for (const item of value) {
    if (typeof item !== 'string' || !DATA_URL.test(item)) return { ok: false, error: 'Only PNG, JPEG, WebP or GIF images are supported' };
    if (item.length > MAX_IMAGE_DATA_URL_CHARS) return { ok: false, error: 'An image is too large (limit about 2.5 MB each)' };
    total += item.length;
  }
  if (total > MAX_TOTAL_DATA_URL_CHARS) return { ok: false, error: 'The images are too large together' };
  return { ok: true, images: value as string[] };
}

/** The `input` for a Hermes run: plain text when there are no images, else one user message with text + image parts. */
export function buildRunInput(text: string, images: string[]): string | Array<{ role: 'user'; content: Array<Record<string, unknown>> }> {
  if (images.length === 0) return text;
  const content: Array<Record<string, unknown>> = [];
  if (text.trim()) content.push({ type: 'text', text });
  for (const url of images) content.push({ type: 'image_url', image_url: { url } });
  return [{ role: 'user', content }];
}

/**
 * Image sources found in a stored message, safe to put in <img src>. Only data:image/ and https:
 * URLs pass; anything else (javascript:, http:, other data: types) is dropped.
 */
export function imageSourcesOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as { type?: unknown; image_url?: unknown };
    if (p.type !== 'image_url' && p.type !== 'input_image') continue;
    const ref = p.image_url;
    const url = typeof ref === 'string' ? ref : typeof (ref as { url?: unknown })?.url === 'string' ? (ref as { url: string }).url : '';
    if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || /^https:\/\//i.test(url)) out.push(url);
  }
  return out;
}

/** Text of a stored message (string, or the text parts of a list). */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' || p?.type === 'input_text' ? (p.text ?? '') : '')).join('');
}

/** Scale (width, height) down so the longer side is at most `max`; never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
