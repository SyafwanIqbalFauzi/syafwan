// The budget page: add / edit a line in a dialog, delete with a confirmation, copy last year's lines.
// Every change goes to /api/finance/budgets*, which checks everything again; the page content is then fetched again (no reload).
import { showCurrentCategory } from './category-options';
import { askConfirm } from './dialog';
import { delegate, refresh } from './live';
import { toast } from './toast';
import { parseBudgetFields } from '../lib/budget-input';

const dialog = document.querySelector<HTMLDialogElement>('#budget-dialog');
const form = document.querySelector<HTMLFormElement>('[data-budget-form]');
const errorEl = document.querySelector<HTMLElement>('[data-budget-error]');
// The page content is swapped after every change (and when the year changes): read these when needed.
const yearNow = () => Number(document.querySelector<HTMLElement>('[data-budgets]')?.dataset.year);

let editingId: number | null = null;

const say = (text: string, error = false) => {
  const banner = document.querySelector<HTMLElement>('[data-budget-banner]');
  if (!banner) return;
  banner.hidden = !text;
  banner.textContent = text;
  banner.classList.toggle('error', error);
};

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

function openDialog(line?: { id: number; kategori: string; name: string; amount: string }) {
  if (!dialog || !form) return;
  editingId = line?.id ?? null;
  dialog.querySelector('#budget-dialog-title')!.textContent = line ? 'Edit line' : 'Add a line';
  showCurrentCategory(form.elements.namedItem('kategori') as HTMLSelectElement, line?.kategori ?? '');
  (form.elements.namedItem('kategori') as HTMLSelectElement).value = line?.kategori ?? '';
  (form.elements.namedItem('nama_pos') as HTMLInputElement).value = line?.name ?? '';
  (form.elements.namedItem('jumlah') as HTMLInputElement).value = line ? new Intl.NumberFormat('id-ID').format(Number(line.amount)) : '';
  if (errorEl) errorEl.textContent = '';
  dialog.showModal();
  (form.elements.namedItem(line ? 'jumlah' : 'kategori') as HTMLElement).focus();
}

delegate('click', '[data-add]', () => openDialog());
dialog?.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form || !errorEl) return;
  const fields = Object.fromEntries(new FormData(form));
  const parsed = parseBudgetFields(fields);
  if (!parsed.ok) {
    errorEl.textContent = parsed.error;
    return;
  }
  const save = form.querySelector<HTMLButtonElement>('[data-save]')!;
  save.disabled = true;
  errorEl.textContent = '';
  try {
    if (editingId === null) await call('POST', '/api/finance/budgets', { tahun: yearNow(), ...parsed.value });
    else await call('PATCH', `/api/finance/budgets/${editingId}`, parsed.value);
    toast(`Budget line “${parsed.value.nama_pos}” ${editingId === null ? 'added' : 'updated'}`);
    dialog?.close();
    await refresh();
  } catch (e) {
    errorEl.textContent = (e as Error).message;
    toast((e as Error).message, 'error');
    save.disabled = false;
  }
});

delegate<HTMLButtonElement>('click', '[data-edit]', (button) => openDialog({ id: Number(button.dataset.id), kategori: button.dataset.kategori ?? '', name: button.dataset.name ?? '', amount: button.dataset.amount ?? '0' }));

delegate<HTMLButtonElement>('click', '[data-delete]', async (button) => {
    const name = button.dataset.name ?? 'this line';
    const sure = await askConfirm({ title: 'Delete this line?', message: `“${name}” is removed from the ${yearNow()} budget. Past transactions are not affected.`, confirm: 'Delete', danger: true });
    if (!sure) return;
    button.disabled = true;
    try {
      await call('DELETE', `/api/finance/budgets/${button.dataset.id}`);
      toast(`Budget line “${name}” deleted`);
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
      say((e as Error).message, true);
      button.disabled = false;
    }
});

delegate<HTMLButtonElement>('click', '[data-copy]', async (button) => {
  const year = yearNow();
  const sure = await askConfirm({ title: `Copy from ${year - 1}?`, message: `Lines that ${year} does not have yet are added with the same amounts. Existing lines are left alone.`, confirm: 'Copy' });
  if (!sure) return;
  button.disabled = true;
  try {
    const result = await call('POST', '/api/finance/budgets/copy', { from: year - 1, to: year });
    if (result.created) {
      toast(`Copied ${result.created} budget line${result.created === 1 ? '' : 's'} from ${year - 1}`);
      await refresh();
    } else {
      toast('Nothing to copy: every line already exists.', 'info');
      button.disabled = false;
    }
  } catch (e) {
    toast((e as Error).message, 'error');
    say((e as Error).message, true);
    button.disabled = false;
  }
});
