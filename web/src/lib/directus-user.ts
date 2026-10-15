// Reads the private agent_runs / agent_jobs collections with the signed-in user's own
// Directus token. Neither collection is readable by the Public policy, so this only works
// for an Administrator session that the middleware has already verified.
import { DIRECTUS_INTERNAL_URL } from 'astro:env/server';

export interface AgentJob {
  id: number;
  job_id: string;
  name: string | null;
  kind: 'agent' | 'script' | null;
  skills: string[] | null;
  model: string | null;
  schedule_display: string | null;
  agent_group: string | null;
  state: string | null;
  enabled: boolean | null;
  deliver_labels: string[] | null;
  last_status: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  synced_at: string | null;
}

export interface AgentRun {
  id: number;
  execution_id: string;
  job_id: string;
  job_name: string | null;
  kind: 'agent' | 'script' | null;
  skills: string[] | null;
  model: string | null;
  status: 'completed' | 'failed' | 'unknown' | null;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  delivery: { targets?: string[]; outcome?: string | null } | null;
  summary: string | null;
  response_md: string | null;
  error: string | null;
}

export interface AgentSkill {
  id: number;
  name: string;
  category: string | null;
  source: 'builtin' | 'local' | 'hub' | 'removed' | null;
  description: string | null;
  version: string | null;
  enabled: boolean | null;
  files: number | null;
  body_hash: string | null;
  editable: boolean | null;
  essential: boolean | null;
  content_md: string | null;
  synced_at: string | null;
}

export interface SkillChange {
  id: number;
  skill: string;
  action: 'set_enabled' | 'set_content';
  status: 'pending' | 'applied' | 'failed' | 'rejected';
  requested_by: string | null;
  requested_at: string | null;
  applied_at: string | null;
  result: string | null;
}

export interface ClaudeUsageRow {
  id: number;
  window: string;
  percent: number | null;
  severity: string | null;
  resets_at: string | null;
  checked_at: string | null;
}

export type ReadableCollection =
  | 'agent_runs'
  | 'agent_jobs'
  | 'agent_skills'
  | 'skill_changes'
  | 'claude_usage'
  | 'finance_transactions'
  | 'finance_categories'
  | 'finance_budgets'
  | 'finance_members';

export interface FinanceTransaction {
  id: number;
  tanggal: string;
  jenis: 'pemasukan' | 'pengeluaran';
  kategori: number | null;
  deskripsi: string | null;
  nominal: string | number;
  member: number | null;
  sumber: string | null;
  waktu?: string | null;
  dihapus_pada?: string | null;
}

export interface FinanceCategory {
  id: number;
  nama: string;
  jenis: 'pemasukan' | 'pengeluaran';
  aktif: boolean;
  sort: number | null;
}

export interface FinanceBudget {
  id: number;
  tahun: number;
  kategori: number;
  nama_pos: string;
  jumlah: string | number;
}

export interface FinanceMember {
  id: number;
  nama_lengkap: string;
  nama_panggilan: string;
}

export class DirectusReadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** `params` are Directus query params, e.g. `{ 'filter[job_id][_eq]': 'abc', sort: '-started_at' }`. */
export async function readItems<T>(token: string, collection: ReadableCollection, params: Record<string, string | number>): Promise<{ data: T[]; total: number | null }> {
  const query = new URLSearchParams({ meta: 'filter_count', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${DIRECTUS_INTERNAL_URL}/items/${collection}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new DirectusReadError(`Directus ${res.status} reading ${collection}`, res.status);
  const body = (await res.json()) as { data: T[]; meta?: { filter_count?: number } };
  return { data: body.data, total: body.meta?.filter_count ?? null };
}

export async function readItem<T>(token: string, collection: ReadableCollection, params: Record<string, string | number>): Promise<T | null> {
  const { data } = await readItems<T>(token, collection, { ...params, limit: 1 });
  return data[0] ?? null;
}

/** PATCH one item with the signed-in user's token (e.g. the agent group). */
export async function updateItem(token: string, collection: 'agent_jobs' | 'finance_budgets' | 'finance_transactions', id: number, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${DIRECTUS_INTERNAL_URL}/items/${collection}/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new DirectusReadError(`Directus ${res.status} updating ${collection}`, res.status);
}

/** Create one item with the signed-in user's token (skill change requests). */
export async function createItem<T>(token: string, collection: 'skill_changes' | 'finance_budgets' | 'finance_transactions', data: Record<string, unknown> | Record<string, unknown>[]): Promise<T> {
  const res = await fetch(`${DIRECTUS_INTERNAL_URL}/items/${collection}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new DirectusReadError(`Directus ${res.status} creating ${collection}`, res.status);
  return ((await res.json()) as { data: T }).data;
}

/** Delete one item with the signed-in user's token (a budget line). */
export async function deleteItem(token: string, collection: 'finance_budgets', id: number): Promise<void> {
  const res = await fetch(`${DIRECTUS_INTERNAL_URL}/items/${collection}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new DirectusReadError(`Directus ${res.status} deleting ${collection}`, res.status);
}
