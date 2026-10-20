// Saves the order after a drag and drop. The browser sends the ids of one group (income,
// spending or savings) top to bottom; every id must exist and share one type.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { parseOrder, sortValues } from '../../../../lib/category-input';
import { readItems, updateItem, type FinanceCategory } from '../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const order = parseOrder(await request.json().catch(() => null));
  if (!order.ok) return json(400, { error: order.error });

  const token = locals.hermesToken!;
  try {
    const { data: all } = await readItems<FinanceCategory>(token, 'finance_categories', { limit: -1 });
    const picked = order.value.map((id) => all.find((c) => c.id === id));
    if (picked.some((c) => !c)) return json(400, { error: 'One of the categories no longer exists. Reload the page.' });
    if (new Set(picked.map((c) => c!.jenis)).size !== 1) return json(400, { error: 'Only categories of the same type can be ordered together' });
    await Promise.all(sortValues(order.value).map((row) => updateItem(token, 'finance_categories', row.id, { sort: row.sort })));
    audit('category_reorder', { user: locals.hermesUser?.email, jenis: picked[0]!.jenis, ids: order.value });
    return json(200, { ok: true });
  } catch {
    return json(502, { error: 'Could not save the order' });
  }
};
