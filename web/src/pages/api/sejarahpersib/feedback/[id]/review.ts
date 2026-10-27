// Marks one feedback as reviewed (POST) or puts it back to "to review" (DELETE) on /sejarahpersib/feedback.
// Only `ditinjau_pada` is written; a replied feedback keeps its reply.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { getFeedback, patchFeedback } from '../../../../../lib/persib-directus';

export const prerender = false;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function setReviewed(params: Record<string, string | undefined>, locals: App.Locals, value: string | null) {
  if (!params.id || !/^\d{1,9}$/.test(params.id)) return json(404, { error: 'Unknown feedback' });
  const id = Number(params.id);
  try {
    const row = await getFeedback(id);
    if (!row) return json(404, { error: 'Unknown feedback' });
    if (!value && row.dibalas_pada) return json(409, { error: 'This feedback has a reply, so it stays reviewed.' });
    await patchFeedback(id, { ditinjau_pada: value });
    audit(value ? 'feedback_reviewed' : 'feedback_unreviewed', { user: locals.hermesUser?.email, id });
    return json(200, { id, reviewedAt: value });
  } catch {
    return json(502, { error: 'Could not save that' });
  }
}

export const POST: APIRoute = ({ params, locals }) => setReviewed(params, locals, new Date().toISOString());
export const DELETE: APIRoute = ({ params, locals }) => setReviewed(params, locals, null);
