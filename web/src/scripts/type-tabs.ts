// Switches the type tabs: shows or hides every [data-type-item] by its type, keeps the choice in
// the address (?type=...), supports the arrow keys, and shows [data-type-empty] when nothing is left.
import { hrefForTab, parseTypeTab, showsUnder, type TypeTab } from '../lib/type-tabs';
import { mountLive, settled } from './live';

// The tabs are drawn again whenever the page content is swapped, so they are set up each time.
mountLive((root) => {
  const bar = root.querySelector<HTMLElement>('[data-type-tabs]');
  if (!bar) return;
  const tabs = [...bar.querySelectorAll<HTMLButtonElement>('[data-tab]')];

  const select = (tab: TypeTab, focus = false) => {
    for (const button of tabs) {
      const on = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    }
    let visible = 0;
    document.querySelectorAll<HTMLElement>('[data-type-item]').forEach((item) => {
      const show = showsUnder(tab, item.dataset.typeItem ?? '');
      item.hidden = !show;
      if (show) visible++;
    });
    const empty = document.querySelector<HTMLElement>('[data-type-empty]');
    if (empty) {
      empty.hidden = visible > 0 || tab === 'all';
      const name = tabs.find((b) => b.dataset.tab === tab)?.firstChild?.textContent?.trim().toLowerCase() ?? '';
      if (!empty.hidden) empty.textContent = (empty.dataset.template ?? 'Nothing under {type}.').replace('{type}', name);
    }
    document.dispatchEvent(new CustomEvent('type-tab', { detail: tab }));
    history.replaceState(null, '', hrefForTab(location.search, tab) + location.hash);
    settled();
  };

  tabs.forEach((button, i) => {
    button.addEventListener('click', () => select(parseTypeTab(button.dataset.tab)));
    button.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        select(parseTypeTab(tabs[event.key === 'Home' ? 0 : tabs.length - 1].dataset.tab), true);
      } else if (step) {
        event.preventDefault();
        select(parseTypeTab(tabs[(i + step + tabs.length) % tabs.length].dataset.tab), true);
      }
    });
  });

  // The server already drew the tab from the address; only the empty message needs the first pass.
  const current = tabs.find((b) => b.getAttribute('aria-selected') === 'true');
  select(parseTypeTab(current?.dataset.tab));
});
