// Client for the sejarahpersib.com Directus (a different instance from the one behind syafwan.com).
// Uses a dedicated token that can read `feedback` (and the name of the related player) and change only
// the review / reply fields. Pages call it only after the middleware has verified an Administrator.
import { PERSIB_DIRECTUS_TOKEN, PERSIB_DIRECTUS_URL } from 'astro:env/server';
import { FEEDBACK_FIELDS, type FeedbackRow } from './feedback.ts';

export class PersibDirectusError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const persibConfigured = (): boolean => Boolean(PERSIB_DIRECTUS_TOKEN);

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  if (!PERSIB_DIRECTUS_TOKEN) throw new PersibDirectusError('The sejarahpersib.com Directus is not configured', 503);
  const res = await fetch(`${PERSIB_DIRECTUS_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${PERSIB_DIRECTUS_TOKEN}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new PersibDirectusError(`Directus ${res.status} on ${path.split('?')[0]}`, res.status);
  return res.json();
}

export async function listFeedback(): Promise<FeedbackRow[]> {
  const query = new URLSearchParams({ fields: FEEDBACK_FIELDS, sort: '-date_created', limit: '1000' });
  const body = await call(`/items/feedback?${query}`);
  return body.data as FeedbackRow[];
}

export async function getFeedback(id: number): Promise<FeedbackRow | null> {
  const query = new URLSearchParams({ fields: FEEDBACK_FIELDS });
  try {
    return (await call(`/items/feedback/${id}?${query}`)).data as FeedbackRow;
  } catch (error) {
    if (error instanceof PersibDirectusError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

export type FeedbackPatch = Partial<Pick<FeedbackRow, 'ditinjau_pada' | 'dibalas_pada' | 'balasan_dari' | 'balasan_subjek' | 'balasan_isi'>>;

export async function patchFeedback(id: number, data: FeedbackPatch): Promise<void> {
  await call(`/items/feedback/${id}`, { method: 'PATCH', body: data });
}
