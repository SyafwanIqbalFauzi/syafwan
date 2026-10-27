// Starts the Hermes run that drafts a reply to one feedback. The browser then watches the run through
// GET /api/agent/runs/<id> and reads the draft from its `output`. Nothing is sent or saved here.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { suggestPrompt } from '../../../../../lib/feedback.ts';
import { hermesRequest } from '../../../../../lib/hermes';
import { getFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ params, locals }) => {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown feedback' });
  const id = Number(params.id);
  try {
    const row = await getFeedback(id);
    if (!row) return json(404, { error: 'Unknown feedback' });
    const prompt = suggestPrompt({ id, nama: row.nama, kategori: row.kategori, pesan: row.pesan.slice(0, 4000), pemain: row.pemain?.nama_lengkap });
    const result = await hermesRequest('POST', '/v1/runs', { input: prompt, session_id: `feedback-suggest-${id}-${Date.now()}` });
    const runId = result.json?.run_id;
    if (!result.ok || typeof runId !== 'string') return json(502, { error: 'Hermes did not accept the request' });
    audit('feedback_suggest', { user: locals.hermesUser?.email, id, run: runId });
    return json(202, { run_id: runId });
  } catch {
    return json(502, { error: 'Could not read that feedback' });
  }
};
