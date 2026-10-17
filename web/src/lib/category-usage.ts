// How much each category is used. Soft-deleted transactions count too: the row still points at
// the category, and the database would silently blank that link if the category were removed.
import { readItems } from './directus-user';
import type { Usage } from './category-input.ts';

type Grouped = { kategori: number | null; count: { id: string | number } };

async function countBy(token: string, collection: 'finance_transactions' | 'finance_budgets'): Promise<Map<number, number>> {
  const { data } = await readItems<Grouped>(token, collection, { 'aggregate[count]': 'id', 'groupBy[]': 'kategori', limit: -1 });
  const out = new Map<number, number>();
  for (const row of data) if (row.kategori !== null) out.set(row.kategori, Number(row.count.id) || 0);
  return out;
}

/** Usage of every category at once (for the list page). */
export async function usageByCategory(token: string): Promise<Map<number, Usage>> {
  const [trx, bud] = await Promise.all([countBy(token, 'finance_transactions'), countBy(token, 'finance_budgets')]);
  const out = new Map<number, Usage>();
  for (const id of new Set([...trx.keys(), ...bud.keys()])) out.set(id, { transactions: trx.get(id) ?? 0, budgets: bud.get(id) ?? 0 });
  return out;
}

/** Usage of one category (for the API, right before it changes or removes it). */
export async function usageOf(token: string, id: number): Promise<Usage> {
  const [t, b] = await Promise.all([
    readItems(token, 'finance_transactions', { 'filter[kategori][_eq]': id, limit: 1 }),
    readItems(token, 'finance_budgets', { 'filter[kategori][_eq]': id, limit: 1 }),
  ]);
  return { transactions: t.total ?? 0, budgets: b.total ?? 0 };
}
