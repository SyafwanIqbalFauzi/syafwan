// Changes or removes one transaction. "Remove" is a soft delete (dihapus_pada), exactly as the
// finance data model asks: the row stays in the database, it just stops counting.
import type { APIRoute } from 'astro';
import { audit } from '../../../../../lib/auth';
import { parseId } from '../../../../../lib/budget-input';
import { readItem, updateItem, type FinanceCategory, type FinanceMember, type FinanceTransaction } from '../../../../../lib/directus-user';
import { todayWib } from '../../../../../lib/finance';
import { parseTransactionFields, waktuFor } from '../../../../../lib/transaction-input';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const summary = (t: FinanceTransaction) => ({ date: t.tanggal, jenis: t.jenis, kategori: t.kategori, amount: Number(t.nominal), description: t.deskripsi });

async function current(token: string, id: number) {
  const row = await readItem<FinanceTransaction>(token, 'finance_transactions', { 'filter[id][_eq]': id, 'filter[dihapus_pada][_null]': 'true' });
  return row;
}

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown transaction' });
  const today = todayWib();
  const fields = parseTransactionFields(await request.json().catch(() => null), today);
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const before = await current(token, id);
    if (!before) return json(404, { error: 'Unknown transaction' });
    if (!(await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': fields.value.kategori }))) return json(400, { error: 'That category does not exist' });
    if (fields.value.member && !(await readItem<FinanceMember>(token, 'finance_members', { 'filter[id][_eq]': fields.value.member }))) return json(400, { error: 'Unknown person' });
    const change: Record<string, unknown> = { ...fields.value };
    if (fields.value.tanggal !== before.tanggal) change.waktu = waktuFor(fields.value.tanggal, today);
    await updateItem(token, 'finance_transactions', id, change);
    audit('transaction_edit', { user: locals.hermesUser?.email, id, before: summary(before), after: fields.value });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not save the transaction' });
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const id = parseId(params.id);
  if (!id) return json(404, { error: 'Unknown transaction' });
  const token = locals.hermesToken!;
  try {
    const before = await current(token, id);
    if (!before) return json(404, { error: 'Unknown transaction' });
    await updateItem(token, 'finance_transactions', id, { dihapus_pada: new Date().toISOString() });
    audit('transaction_delete', { user: locals.hermesUser?.email, id, ...summary(before) });
    return json(200, { id });
  } catch {
    return json(502, { error: 'Could not delete the transaction' });
  }
};
