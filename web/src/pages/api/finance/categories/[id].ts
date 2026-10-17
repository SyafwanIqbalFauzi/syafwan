// Changes or removes one category. The type (income / spending) is locked once the category is
// used, and only a category nobody points at can be deleted: otherwise old transactions would
// lose their category. A used category is switched off instead (aktif = false).
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { parseId, sameName } from '../../../../lib/budget-input';
import { isUnused, parseCategoryFields } from '../../../../lib/category-input';
import { usageOf } from '../../../../lib/category-usage';
import { deleteItem, readItem, readItems, updateItem, type FinanceCategory } from '../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown category' });
  const fields = parseCategoryFields(await request.json().catch(() => null));
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const current = await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': id });
    if (!current) return json(404, { error: 'Unknown category' });
    const { data: all } = await readItems<FinanceCategory>(token, 'finance_categories', { limit: -1 });
    if (all.some((c) => c.id !== id && sameName(c.nama, fields.value.nama))) return json(409, { error: `A category called “${fields.value.nama}” already exists` });
    if (fields.value.jenis !== current.jenis) {
      const usage = await usageOf(token, id);
      if (!isUnused(usage)) return json(409, { error: `“${current.nama}” is used by ${usage.transactions} transaction(s) and ${usage.budgets} budget line(s), so its type cannot change. Add a new category instead.` });
    }
    await updateItem(token, 'finance_categories', id, { ...fields.value });
    audit('category_edit', { user: locals.hermesUser?.email, id, before: { name: current.nama, jenis: current.jenis, aktif: current.aktif }, after: { name: fields.value.nama, jenis: fields.value.jenis, aktif: fields.value.aktif } });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not save the category' });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown category' });
  const token = locals.hermesToken!;
  try {
    const current = await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': id });
    if (!current) return json(404, { error: 'Unknown category' });
    const usage = await usageOf(token, id);
    if (!isUnused(usage)) return json(409, { error: `“${current.nama}” is used by ${usage.transactions} transaction(s) and ${usage.budgets} budget line(s). Turn it off instead of deleting it.` });
    await deleteItem(token, 'finance_categories', id);
    audit('category_delete', { user: locals.hermesUser?.email, id, name: current.nama, jenis: current.jenis });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not delete the category' });
  }
};
