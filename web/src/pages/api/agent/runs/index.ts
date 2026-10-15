// Start one chat turn as a Hermes run. The run keeps going on the server without any browser
// attached; the page watches it through GET /api/agent/runs/<id>/events and can re-attach.
// Only `input` and `session_id` are ever sent to Hermes: no instructions, history or model options.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { hermesRequest } from '../../../../lib/hermes';

export const prerender = false;

const MAX_INPUT = 20_000;
const SESSION_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const input = typeof body?.input === 'string' ? body.input : '';
  const sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
  if (!input.trim()) return json(400, { error: 'Write a message first' });
  if (input.length > MAX_INPUT) return json(400, { error: 'That message is too long (limit 20,000 characters)' });
  if (input.includes('\u0000')) return json(400, { error: 'The message contains invalid characters' });
  if (!SESSION_ID.test(sessionId)) return json(400, { error: 'Invalid session' });

  const result = await hermesRequest('POST', '/v1/runs', { input, session_id: sessionId });
  if (!result.ok) {
    const message = result.json?.error?.message ?? result.json?.error ?? 'Hermes did not accept the message';
    return json(result.status === 429 ? 429 : result.status >= 500 ? 502 : 400, { error: String(message).slice(0, 200) });
  }
  const runId = result.json?.run_id;
  if (typeof runId !== 'string') return json(502, { error: 'Unexpected response from Hermes' });
  audit('chat_run', { user: locals.hermesUser?.email, session: sessionId, run: runId, chars: input.length });
  return json(202, { run_id: runId, session_id: sessionId });
};
