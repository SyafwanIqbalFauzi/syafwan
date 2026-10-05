// Minimal read-only Directus client used on the server. Responses are cached in
// memory for a short time so a page view doesn't always hit the CMS; when Directus
// is unreachable we keep serving the last good response.
import { DIRECTUS_INTERNAL_URL, DIRECTUS_TOKEN } from 'astro:env/server';

const TTL_MS = 60_000;
const cache = new Map<string, { expires: number; value: unknown }>();

export class DirectusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function directus<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  try {
    const res = await fetch(`${DIRECTUS_INTERNAL_URL}${path}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
    });
    if (!res.ok) throw new DirectusError(`Directus ${res.status} for ${path}`, res.status);
    const { data } = (await res.json()) as { data: T };
    cache.set(path, { expires: Date.now() + TTL_MS, value: data });
    return data;
  } catch (error) {
    if (hit) return hit.value as T;
    throw error;
  }
}

/** Builds `?fields=...&filter...` query strings without hand-escaping. */
export function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `?${search.toString()}`;
}
