// Copies the budget lines of one year into another (only the lines the target year does not have yet).
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { parseYear, sameName } from '../../../../../lib/budget-input';
import { createItem, readItems, type FinanceBudget } from '../../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const from = parseYear(body?.from);
  const to = parseYear(body?.to);
  if (!from || !to || from === to) return json(400, { error: 'Choose two different years' });

  const token = locals.hermesToken!;
  try {
    const [source, target] = await Promise.all([
      readItems<FinanceBudget>(token, 'finance_budgets', { 'filter[tahun][_eq]': from, limit: -1 }),
      readItems<FinanceBudget>(token, 'finance_budgets', { 'filter[tahun][_eq]': to, limit: -1 }),
    ]);
    const missing = source.data.filter((s) => !target.data.some((t) => t.kategori === s.kategori && sameName(t.nama_pos, s.nama_pos)));
    if (missing.length) {
      await createItem(token, 'finance_budgets', missing.map((s) => ({ tahun: to, kategori: s.kategori, nama_pos: s.nama_pos, jumlah: Number(s.jumlah) })));
    }
    audit('budget_copy', { user: locals.hermesUser?.email, from, to, created: missing.length, skipped: source.data.length - missing.length });
    return json(200, { created: missing.length, skipped: source.data.length - missing.length });
  } catch {
    return json(502, { error: 'Could not copy the budget lines' });
  }
};
