// Adds one category. Written with the signed-in user's own Directus token; the browser only
// sends name, type, keywords and the active flag. A new category goes to the bottom of its group.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { nextSort, parseCategoryFields } from '../../../../lib/category-input';
import { sameName } from '../../../../lib/budget-input';
import { createItem, readItems, type FinanceCategory } from '../../../../lib/directus-user';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const fields = parseCategoryFields(await request.json().catch(() => null));
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const { data: all } = await readItems<FinanceCategory>(token, 'finance_categories', { limit: -1 });
    if (all.some((c) => sameName(c.nama, fields.value.nama))) return json(409, { error: `A category called “${fields.value.nama}” already exists` });
    const sort = nextSort(all.filter((c) => c.jenis === fields.value.jenis).map((c) => c.sort));
    const created = await createItem<FinanceCategory>(token, 'finance_categories', { ...fields.value, sort });
    audit('category_add', { user: locals.hermesUser?.email, id: created.id, name: fields.value.nama, jenis: fields.value.jenis });
    return json(201, { id: created.id });
  } catch {
    return json(502, { error: 'Could not save the category' });
  }
};
