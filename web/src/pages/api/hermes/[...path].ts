// Backend-for-frontend for the Hermes API server. The middleware has already
// verified the session; this route only forwards allowlisted calls (see
// src/lib/hermes-routes.ts) and adds the bearer key, which the browser never sees.
import type { APIRoute } from 'astro';
import { audit } from '../../../lib/auth';
import { callHermes, forwardedQuery, isConfigured, MAX_BODY_BYTES, resolveHermesRoute } from '../../../lib/hermes';
import { renderMarkdown } from '../../../lib/markdown';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Adds a sanitized `html` field to every assistant message found in a messages response. */
function withRenderedMarkdown(data: unknown): unknown {
  const list = Array.isArray(data) ? data : (data as any)?.messages ?? (data as any)?.data;
  if (!Array.isArray(list)) return data;
  for (const message of list) {
    if (message?.role === 'assistant' && typeof message.content === 'string') message.html = renderMarkdown(message.content);
  }
  return data;
}

async function readBody(request: Request): Promise<{ text?: string; error?: Response }> {
  if (request.method === 'GET' || request.method === 'DELETE') return {};
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return { error: json(413, { error: 'Request too large' }) };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: json(413, { error: 'Request too large' }) };
  return { text: text || '{}' };
}

const handler: APIRoute = async ({ request, params, url, locals }) => {
  const path = (params.path ?? '').replace(/\/+$/, '');

  // Local helper: render markdown to sanitized HTML (used when a streamed reply finishes).
  if (path === 'render' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text : '';
    if (text.length > 200_000) return json(413, { error: 'Request too large' });
    return json(200, { html: renderMarkdown(text) });
  }

  const route = resolveHermesRoute(request.method, path);
  if (!route) return json(404, { error: 'Unknown endpoint' });
  if (!isConfigured()) return json(503, { error: 'Hermes is not configured' });

  const { text, error } = await readBody(request);
  if (error) return error;

  if (request.method !== 'GET') {
    audit('request', { user: locals.hermesUser?.email, method: request.method, path });
  }

  let upstream: Response;
  try {
    upstream = await callHermes(route.target + forwardedQuery(url.searchParams), {
      method: request.method,
      body: text,
      signal: request.signal,
      stream: route.stream,
    });
  } catch {
    return json(502, { error: 'Hermes is unreachable' });
  }

  if (route.stream && upstream.ok && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        // Tell proxies not to buffer, so tokens appear as they are produced.
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const payload = await upstream.text();
  const type = upstream.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    return json(upstream.ok ? 502 : upstream.status, { error: upstream.ok ? 'Unexpected response from Hermes' : 'Hermes request failed' });
  }
  if (route.render && upstream.ok) {
    try {
      return json(upstream.status, withRenderedMarkdown(JSON.parse(payload)));
    } catch {
      return json(502, { error: 'Unexpected response from Hermes' });
    }
  }
  return new Response(payload, { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
