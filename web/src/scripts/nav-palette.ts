// Ctrl+K (Cmd+K on a Mac) or the Search button: a box to jump to any page of /agent and /finance.
// Built on the native <dialog>, like the other dialogs (focus trap, Escape and backdrop from the browser).
// Look: see ".palette" in styles/cms/palette.css.
import { allItems, AREAS, searchItems, type NavItem } from '../lib/nav';

let dialog: HTMLDialogElement | null = null;

function build(): HTMLDialogElement {
  const el = document.createElement('dialog');
  el.className = 'palette';
  el.setAttribute('aria-label', 'Go to a page');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'palette-input';
  input.placeholder = 'Go to a page…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'palette-list');

  const list = document.createElement('ul');
  list.id = 'palette-list';
  list.className = 'palette-list';
  list.setAttribute('role', 'listbox');

  const hint = document.createElement('p');
  hint.className = 'palette-hint';
  hint.textContent = '↑ ↓ to choose · Enter to open · Esc to close';

  el.append(input, list, hint);

  const here = location.pathname;
  let shown: NavItem[] = [];
  let active = 0;

  const paint = () => {
    list.replaceChildren();
    if (shown.length === 0) {
      const none = document.createElement('li');
      none.className = 'palette-none';
      none.textContent = 'No page matches.';
      list.append(none);
      input.removeAttribute('aria-activedescendant');
      return;
    }
    shown.forEach((item, i) => {
      const li = document.createElement('li');
      li.id = `palette-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      if (i === active) li.className = 'active';
      const link = document.createElement('a');
      link.href = item.href;
      link.tabIndex = -1;
      const label = document.createElement('span');
      label.textContent = item.label;
      const where = document.createElement('span');
      where.className = 'palette-where';
      where.textContent = `${AREAS[item.area].label} · ${item.group}${item.href === here ? ' · you are here' : ''}`;
      link.append(label, where);
      li.append(link);
      list.append(li);
    });
    input.setAttribute('aria-activedescendant', `palette-${active}`);
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const refresh = () => {
    shown = searchItems(allItems(), input.value);
    active = 0;
    paint();
  };

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      paint();
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      location.href = shown[active].href;
    }
  });
  list.addEventListener('mousemove', (e) => {
    const li = (e.target as HTMLElement).closest('li[role=option]');
    const index = li ? Number(li.id.replace('palette-', '')) : -1;
    if (index >= 0 && index !== active) {
      active = index;
      list.querySelectorAll('li').forEach((node, i) => {
        node.classList.toggle('active', i === active);
        node.setAttribute('aria-selected', String(i === active));
      });
      input.setAttribute('aria-activedescendant', `palette-${active}`);
    }
  });
  // Clicking the dimmed area outside closes it.
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  el.addEventListener('close', () => {
    input.value = '';
  });

  document.body.append(el);
  return el;
}

export function openPalette() {
  dialog ??= build();
  if (!dialog.open) dialog.showModal();
  const input = dialog.querySelector<HTMLInputElement>('.palette-input');
  input?.dispatchEvent(new Event('input')); // fill the list
  input?.focus();
}

export function initPalette() {
  document.querySelectorAll('[data-palette-open]').forEach((btn) => btn.addEventListener('click', openPalette));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog?.open) dialog.close();
      else openPalette();
    }
  });
}
