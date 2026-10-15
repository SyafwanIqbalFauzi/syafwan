// Server-side client for the Hermes API server. Only the BFF route calls this; the
// bearer key stays on the server.
import { HERMES_API_KEY, HERMES_API_URL } from 'astro:env/server';
import { resolveHermesRoute, type HermesRoute } from './hermes-routes';

export { resolveHermesRoute };
export type { HermesRoute };

export const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
// Query parameters that may be forwarded (list/pagination only).
const FORWARDED_QUERY = ['limit', 'offset', 'source', 'include_children', 'include_compacted', 'inline_images'];

export const isConfigured = (): boolean => Boolean(HERMES_API_KEY);

export function forwardedQuery(search: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const key of FORWARDED_QUERY) {
    const value = search.get(key);
    if (value !== null && value.length <= 32) out.set(key, value);
  }
  const text = out.toString();
  return text ? `?${text}` : '';
}

/** Calls Hermes. Streaming responses keep their body open; the caller owns the abort signal. */
export function callHermes(target: string, init: { method: string; body?: string; signal: AbortSignal; stream: boolean }): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${HERMES_API_KEY}`, Accept: init.stream ? 'text/event-stream' : 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${HERMES_API_URL}${target}`, {
    method: init.method,
    headers,
    body: init.body,
    // Streams run as long as the agent works; plain calls get a hard timeout.
    signal: init.stream ? init.signal : AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  });
}
