// Changes or removes one budget line. The year of a line is fixed: copy it to another year instead.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { parseBudgetFields, parseId, sameName } from '../../../../lib/budget-input';
import { deleteItem, readItem, readItems, updateItem, type FinanceBudget, type FinanceCategory } from '../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown budget line' });
  const fields = parseBudgetFields(await request.json().catch(() => null));
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const current = await readItem<FinanceBudget>(token, 'finance_budgets', { 'filter[id][_eq]': id });
    if (!current) return json(404, { error: 'Unknown budget line' });
    const category = await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': fields.value.kategori });
    if (!category) return json(400, { error: 'That category does not exist' });
    if (!category.aktif && category.id !== current.kategori) return json(400, { error: 'That category is turned off. Turn it on in Categories first.' });
    const sameYear = await readItems<FinanceBudget>(token, 'finance_budgets', { 'filter[tahun][_eq]': current.tahun, 'filter[kategori][_eq]': category.id, limit: -1 });
    if (sameYear.data.some((b) => b.id !== id && sameName(b.nama_pos, fields.value.nama_pos))) return json(409, { error: `${category.nama} already has a line called “${fields.value.nama_pos}” in ${current.tahun}` });
    await updateItem(token, 'finance_budgets', id, { ...fields.value });
    audit('budget_edit', { user: locals.hermesUser?.email, id, year: current.tahun, before: { kategori: current.kategori, name: current.nama_pos, amount: Number(current.jumlah) }, after: fields.value });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not save the budget line' });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown budget line' });
  const token = locals.hermesToken!;
  try {
    const current = await readItem<FinanceBudget>(token, 'finance_budgets', { 'filter[id][_eq]': id });
    if (!current) return json(404, { error: 'Unknown budget line' });
    await deleteItem(token, 'finance_budgets', id);
    audit('budget_delete', { user: locals.hermesUser?.email, id, year: current.tahun, kategori: current.kategori, name: current.nama_pos, amount: Number(current.jumlah) });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not delete the budget line' });
  }
};
