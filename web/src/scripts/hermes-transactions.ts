// The transaction list: add / edit in a dialog, delete with a confirmation. Every change goes to
// /api/finance/transactions*, which checks everything again; the page then reloads.
import { askConfirm } from './dialog';
import { flash, toast } from './toast';
import { parseTransactionFields } from '../lib/transaction-input';

const root = document.querySelector<HTMLElement>('[data-transactions]');
const dialog = document.querySelector<HTMLDialogElement>('#trx-dialog');
const form = document.querySelector<HTMLFormElement>('[data-trx-form]');
const errorEl = document.querySelector<HTMLElement>('[data-trx-error]');
const banner = document.querySelector<HTMLElement>('[data-trx-banner]');
const today = root?.dataset.today ?? new Date().toISOString().slice(0, 10);

let editingId: number | null = null;

const say = (text: string, error = false) => {
  if (!banner) return;
  banner.hidden = !text;
  banner.textContent = text;
  banner.classList.toggle('error', error);
};

const field = (name: string) => form!.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
const money = (value: string | number) => new Intl.NumberFormat('id-ID').format(Number(value));

async function call(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = '/agent/login';
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

type Line = { id: number; tanggal: string; jenis: string; kategori: string; deskripsi: string; nominal: string; member: string };

function openDialog(line?: Line) {
  if (!dialog || !form) return;
  editingId = line?.id ?? null;
  dialog.querySelector('#trx-dialog-title')!.textContent = line ? 'Edit transaction' : 'Add a transaction';
  field('tanggal').value = line?.tanggal ?? today;
  field('jenis').value = line?.jenis ?? 'pengeluaran';
  field('kategori').value = line?.kategori ?? '';
  field('deskripsi').value = line?.deskripsi ?? '';
  field('nominal').value = line ? money(line.nominal) : '';
  field('member').value = line?.member ?? '';
  if (errorEl) errorEl.textContent = '';
  const save = form.querySelector<HTMLButtonElement>('[data-save]');
  if (save) save.disabled = false;
  dialog.showModal();
  field(line ? 'nominal' : 'deskripsi').focus();
}

// Picking a category sets the type to match it (the type can still be changed afterwards).
form?.querySelector<HTMLSelectElement>('select[name="kategori"]')?.addEventListener('change', (event) => {
  const option = (event.target as HTMLSelectElement).selectedOptions[0];
  if (option?.dataset.jenis) field('jenis').value = option.dataset.jenis;
});

document.querySelector('[data-trx-add]')?.addEventListener('click', () => openDialog());
dialog?.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form || !errorEl) return;
  const parsed = parseTransactionFields(Object.fromEntries(new FormData(form)), today);
  if (!parsed.ok) {
    errorEl.textContent = parsed.error;
    return;
  }
  const save = form.querySelector<HTMLButtonElement>('[data-save]')!;
  save.disabled = true;
  errorEl.textContent = '';
  try {
    if (editingId === null) await call('POST', '/api/finance/transactions', parsed.value);
    else await call('PATCH', `/api/finance/transactions/${editingId}`, parsed.value);
    const what = parsed.value.deskripsi ? `“${parsed.value.deskripsi}” (${money(parsed.value.nominal)})` : money(parsed.value.nominal);
    flash(`Transaction ${editingId === null ? 'added' : 'updated'}: ${what}`);
    dialog?.close();
    location.reload();
  } catch (e) {
    errorEl.textContent = (e as Error).message;
    toast((e as Error).message, 'error');
    save.disabled = false;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-trx-edit]').forEach((button) =>
  button.addEventListener('click', () => {
    const d = button.dataset;
    openDialog({ id: Number(d.id), tanggal: d.tanggal ?? today, jenis: d.jenis ?? 'pengeluaran', kategori: d.kategori ?? '', deskripsi: d.deskripsi ?? '', nominal: d.nominal ?? '0', member: d.member ?? '' });
  }),
);

document.querySelectorAll<HTMLButtonElement>('[data-trx-delete]').forEach((button) =>
  button.addEventListener('click', async () => {
    const sure = await askConfirm({
      title: 'Delete this transaction?',
      message: `${button.dataset.label ?? 'This transaction'} stops counting in the totals and charts. The record is kept in the database, so an administrator can still restore it.`,
      confirm: 'Delete',
      danger: true,
    });
    if (!sure) return;
    button.disabled = true;
    try {
      await call('DELETE', `/api/finance/transactions/${button.dataset.id}`);
      flash(`Transaction deleted: ${button.dataset.label ?? ''}`.trim());
      location.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      say((e as Error).message, true);
      button.disabled = false;
    }
  }),
);
