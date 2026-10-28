// Where a reply stands: 'sending', 'sent' (saved on the row), 'failed' (with the reason) or 'idle'. Reading it
// also settles a send whose background watcher was lost (for instance by a deploy), so the card never stays
// on "Sending" forever. The page polls this while a card is sending.
import type { APIRoute } from 'astro';
import { sendStateOf } from '../../../../../lib/feedback.ts';
import { reconcileSend } from '../../../../../lib/feedback-reply';
import { getFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async ({ params, locals }) => {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown feedback' });
  try {
    const found = await getFeedback(Number(params.id));
    if (!found) return json(404, { error: 'Unknown feedback' });
    const row = await reconcileSend(found, locals.hermesUser?.email);
    const state = sendStateOf(row);
    if (state === 'failed') return json(200, { state: 'failed', error: row.balasan_error ?? 'Sending failed' });
    if (state === 'sending') return json(200, { state: 'sending' });
    return json(200, { state: row.dibalas_pada ? 'sent' : 'idle', repliedAt: row.dibalas_pada, to: row.email });
  } catch {
    return json(502, { error: 'Could not read that feedback' });
  }
};
