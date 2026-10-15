// Adds one budget line (a monthly amount for a category, in a year). Written with the signed-in
// user's own Directus token; the browser only sends category, name and amount.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { parseBudgetFields, parseYear, sameName } from '../../../../../lib/budget-input';
import { createItem, readItem, readItems, type FinanceBudget, type FinanceCategory } from '../../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const year = parseYear(body?.tahun);
  if (!year) return json(400, { error: 'Choose a year between 2000 and 2100' });
  const fields = parseBudgetFields(body);
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const category = await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': fields.value.kategori });
    if (!category) return json(400, { error: 'That category does not exist' });
    const sameYear = await readItems<FinanceBudget>(token, 'finance_budgets', { 'filter[tahun][_eq]': year, 'filter[kategori][_eq]': category.id, limit: -1 });
    if (sameYear.data.some((b) => sameName(b.nama_pos, fields.value.nama_pos))) return json(409, { error: `${category.nama} already has a line called “${fields.value.nama_pos}” in ${year}` });
    const created = await createItem<FinanceBudget>(token, 'finance_budgets', { tahun: year, ...fields.value });
    audit('budget_add', { user: locals.hermesUser?.email, id: created.id, year, kategori: category.id, name: fields.value.nama_pos, amount: fields.value.jumlah });
    return json(201, { id: created.id });
  } catch {
    return json(502, { error: 'Could not save the budget line' });
  }
};
