// Adds one transaction by hand. Written with the signed-in user's own Directus token; the browser only
// sends the editable fields, everything else (time, source) is set here.
import type { APIRoute } from 'astro';
import { audit } from '../../../../lib/auth';
import { createItem, readItem, type FinanceCategory, type FinanceMember, type FinanceTransaction } from '../../../../lib/directus-user';
import { todayWib } from '../../../../lib/finance';
import { parseTransactionFields, waktuFor } from '../../../../lib/transaction-input';

export const prerender = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const today = todayWib();
  const fields = parseTransactionFields(await request.json().catch(() => null), today);
  if (!fields.ok) return json(400, { error: fields.error });

  const token = locals.hermesToken!;
  try {
    const category = await readItem<FinanceCategory>(token, 'finance_categories', { 'filter[id][_eq]': fields.value.kategori });
    if (!category) return json(400, { error: 'That category does not exist' });
    if (!category.aktif) return json(400, { error: 'That category is turned off. Turn it on in Categories first.' });
    if (fields.value.member && !(await readItem<FinanceMember>(token, 'finance_members', { 'filter[id][_eq]': fields.value.member }))) return json(400, { error: 'Unknown person' });
    const created = await createItem<FinanceTransaction>(token, 'finance_transactions', {
      ...fields.value,
      waktu: waktuFor(fields.value.tanggal, today),
      sumber: 'web',
    });
    audit('transaction_add', { user: locals.hermesUser?.email, id: created.id, ...fields.value });
    return json(201, { id: created.id });
  } catch {
    return json(502, { error: 'Could not save the transaction' });
  }
};
