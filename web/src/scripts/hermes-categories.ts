// The categories page: add / edit in a dialog, delete (only unused ones, checked again by the
// server), and drag-and-drop ordering with the mouse, a finger or the arrow keys on the handle.
import { askConfirm } from './dialog';
import { flash, toast } from './toast';
import { moveId, parseCategoryFields } from '../lib/category-input';

const dialog = document.querySelector<HTMLDialogElement>('#category-dialog');
const form = document.querySelector<HTMLFormElement>('[data-category-form]');
const errorEl = document.querySelector<HTMLElement>('[data-category-error]');
const lockedNote = document.querySelector<HTMLElement>('[data-jenis-locked]');
const banner = document.querySelector<HTMLElement>('[data-category-banner]');

let editingId: number | null = null;

const say = (text: string, error = false) => {
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

// ---- add / edit ------------------------------------------------------------------------------

const field = (name: string) => form!.elements.namedItem(name) as HTMLInputElement & HTMLSelectElement;

function openDialog(line?: { id: number; name: string; jenis: string; aktif: boolean; keywords: string; used: boolean }) {
  if (!dialog || !form) return;
  editingId = line?.id ?? null;
  dialog.querySelector('#category-dialog-title')!.textContent = line ? 'Edit category' : 'Add a category';
  field('nama').value = line?.name ?? '';
  field('jenis').value = line?.jenis ?? 'pengeluaran';
  field('jenis').disabled = !!line?.used;
  field('kata_kunci').value = line?.keywords ?? '';
  field('aktif').checked = line?.aktif ?? true;
  if (lockedNote) lockedNote.hidden = !line?.used;
  if (errorEl) errorEl.textContent = '';
  dialog.showModal();
  field('nama').focus();
}

document.querySelector('[data-add]')?.addEventListener('click', () => openDialog());
dialog?.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close());

document.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) =>
  button.addEventListener('click', () =>
    openDialog({
      id: Number(button.dataset.id),
      name: button.dataset.name ?? '',
      jenis: button.dataset.jenis ?? 'pengeluaran',
      aktif: button.dataset.aktif !== 'false',
      keywords: button.dataset.keywords ?? '',
      used: button.dataset.used === 'true',
    }),
  ),
);

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form || !errorEl) return;
  // A disabled select is left out of FormData, so read the type from the control itself.
  const fields = { nama: field('nama').value, jenis: field('jenis').value, kata_kunci: field('kata_kunci').value, aktif: field('aktif').checked };
  const parsed = parseCategoryFields(fields);
  if (!parsed.ok) {
    errorEl.textContent = parsed.error;
    return;
  }
  const save = form.querySelector<HTMLButtonElement>('[data-save]')!;
  save.disabled = true;
  errorEl.textContent = '';
  try {
    if (editingId === null) await call('POST', '/api/finance/categories', parsed.value);
    else await call('PATCH', `/api/finance/categories/${editingId}`, parsed.value);
    flash(`Category “${parsed.value.nama}” ${editingId === null ? 'added' : 'updated'}`);
    dialog?.close();
    location.reload();
  } catch (e) {
    errorEl.textContent = (e as Error).message;
    toast((e as Error).message, 'error');
    save.disabled = false;
  }
});

// ---- delete ----------------------------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((button) =>
  button.addEventListener('click', async () => {
    const name = button.dataset.name ?? 'this category';
    const sure = await askConfirm({ title: 'Delete this category?', message: `“${name}” is not used by any transaction or budget line, so it is removed for good.`, confirm: 'Delete', danger: true });
    if (!sure) return;
    button.disabled = true;
    try {
      await call('DELETE', `/api/finance/categories/${button.dataset.id}`);
      flash(`Category “${name}” deleted`);
      location.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      say((e as Error).message, true);
      button.disabled = false;
    }
  }),
);

// ---- drag and drop ---------------------------------------------------------------------------

const rowsOf = (group: HTMLElement) => [...group.querySelectorAll<HTMLElement>(':scope > [data-row]')];
const idsOf = (group: HTMLElement) => rowsOf(group).map((r) => Number(r.dataset.id));

let saving: Promise<void> = Promise.resolve();

/** Saves one group's order. Saves run one after another so a quick second move cannot overtake the first. */
function saveOrder(group: HTMLElement, before: number[]) {
  const ids = idsOf(group);
  if (ids.join() === before.join()) return;
  saving = saving.then(async () => {
    try {
      await call('POST', '/api/finance/categories/reorder', { ids });
      toast('Order saved', 'success', { duration: 1500 });
      say('');
    } catch (e) {
      // Put the rows back where they were, so the page never shows an order that is not saved.
      const byId = new Map(rowsOf(group).map((r) => [Number(r.dataset.id), r]));
      before.forEach((id) => group.appendChild(byId.get(id)!));
      toast((e as Error).message, 'error');
      say((e as Error).message, true);
    }
  });
}

document.querySelectorAll<HTMLElement>('[data-group]').forEach((group) => {
  group.querySelectorAll<HTMLButtonElement>('[data-handle]').forEach((handle) => {
    const row = handle.closest<HTMLElement>('[data-row]')!;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const before = idsOf(group);
      let target: HTMLElement | null = null;
      let after = false;
      handle.setPointerCapture(event.pointerId);
      row.classList.add('dragging');

      const clear = () => group.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));

      const move = (e: PointerEvent) => {
        clear();
        const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-row]');
        if (!over || over === row || over.parentElement !== group) {
          target = null;
          return;
        }
        const box = over.getBoundingClientRect();
        after = e.clientY > box.top + box.height / 2;
        target = over;
        over.classList.add(after ? 'drop-after' : 'drop-before');
      };

      const done = (e: PointerEvent) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', done);
        handle.removeEventListener('pointercancel', done);
        handle.releasePointerCapture(e.pointerId);
        clear();
        row.classList.remove('dragging');
        if (e.type === 'pointerup' && target) {
          const rows = rowsOf(group);
          const toIndex = rows.indexOf(target) + (after ? 1 : 0) - (rows.indexOf(row) < rows.indexOf(target) ? 1 : 0);
          const next = moveId(before, Number(row.dataset.id), toIndex);
          const byId = new Map(rows.map((r) => [Number(r.dataset.id), r]));
          next.forEach((id) => group.appendChild(byId.get(id)!));
          saveOrder(group, before);
        }
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', done);
      handle.addEventListener('pointercancel', done);
    });

    // Keyboard: focus the handle, then the arrow keys move the row (Home / End jump to the ends).
    handle.addEventListener('keydown', (event) => {
      const keys: Record<string, (i: number, n: number) => number> = { ArrowUp: (i) => i - 1, ArrowDown: (i) => i + 1, Home: () => 0, End: (_i, n) => n - 1 };
      const pick = keys[event.key];
      if (!pick) return;
      event.preventDefault();
      const before = idsOf(group);
      const id = Number(row.dataset.id);
      const next = moveId(before, id, pick(before.indexOf(id), before.length));
      if (next.join() === before.join()) return;
      const byId = new Map(rowsOf(group).map((r) => [Number(r.dataset.id), r]));
      next.forEach((x) => group.appendChild(byId.get(x)!));
      handle.focus();
      saveOrder(group, before);
    });
  });
});
