// Navigation of the private areas (/agent and /finance): the pages of each area, the search behind the
// Ctrl+K palette, and "last page visited per area" so switching area returns to where you were.
// Pure functions; storage is injected, so it is unit-tested without a browser.

export type Section = 'overview' | 'agents' | 'skills' | 'chat' | 'sessions' | 'usage' | 'finance' | 'transactions' | 'budgets' | 'categories' | 'accounts' | 'updates' | 'feedback' | 'design';
export type Area = 'agent' | 'finance' | 'accounts' | 'persib';

export interface NavItem {
  section: Section;
  href: string;
  label: string;
  area: Area;
  group: string;
}

export interface NavGroup {
  label: string;
  items: Omit<NavItem, 'area' | 'group'>[];
}

export const AREAS: Record<Area, { label: string; home: string; groups: NavGroup[] }> = {
  agent: {
    label: 'Agents',
    home: '/agent',
    groups: [
      {
        label: 'Workspace',
        items: [
          { section: 'overview', href: '/agent', label: 'Overview' },
          { section: 'chat', href: '/agent/chat', label: 'Chat' },
        ],
      },
      {
        label: 'Automation',
        items: [
          { section: 'agents', href: '/agent/agents', label: 'Agents' },
          { section: 'skills', href: '/agent/skills', label: 'Skills' },
        ],
      },
      {
        label: 'History',
        items: [
          { section: 'sessions', href: '/agent/sessions', label: 'Sessions' },
          { section: 'usage', href: '/agent/usage', label: 'Usage' },
        ],
      },
      {
        label: 'System',
        items: [{ section: 'design', href: '/agent/design', label: 'Design' }],
      },
    ],
  },
  finance: {
    label: 'Finance',
    home: '/finance',
    groups: [
      {
        label: 'Money',
        items: [
          { section: 'finance', href: '/finance', label: 'Dashboard' },
          { section: 'transactions', href: '/finance/transactions', label: 'Transactions' },
          { section: 'budgets', href: '/finance/budgets', label: 'Budgets' },
          { section: 'categories', href: '/finance/categories', label: 'Categories' },
        ],
      },
    ],
  },
  accounts: {
    label: 'Accounts',
    home: '/accounts',
    groups: [
      {
        label: 'Connections',
        items: [{ section: 'accounts', href: '/accounts', label: 'Accounts' }],
      },
    ],
  },
  persib: {
    label: 'Persib',
    home: '/sejarahpersib',
    groups: [
      {
        label: 'Agents at work',
        items: [{ section: 'updates', href: '/sejarahpersib', label: 'Updates' }],
      },
      {
        label: 'Visitors',
        items: [{ section: 'feedback', href: '/sejarahpersib/feedback', label: 'Feedback' }],
      },
    ],
  },
};

export const AREA_ORDER: Area[] = ['agent', 'finance', 'accounts', 'persib'];

export function allItems(): NavItem[] {
  return AREA_ORDER.flatMap((area) =>
    AREAS[area].groups.flatMap((group) => group.items.map((item) => ({ ...item, area, group: group.label }))),
  );
}

export function areaOf(pathname: string): Area | null {
  if (pathname === '/finance' || pathname.startsWith('/finance/')) return 'finance';
  if (pathname === '/accounts' || pathname.startsWith('/accounts/')) return 'accounts';
  if (pathname === '/sejarahpersib' || pathname.startsWith('/sejarahpersib/')) return 'persib';
  if (pathname === '/agent' || pathname.startsWith('/agent/')) return 'agent';
  return null;
}

/** Pages matching what was typed. Label matches rank first (start of the label, then start of a word, then anywhere), then group / area names. */
export function searchItems(items: NavItem[], query: string): NavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored: { item: NavItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const label = item.label.toLowerCase();
    const areaName = AREAS[item.area].label.toLowerCase();
    let score = 0;
    if (label.startsWith(q)) score = 4;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 3;
    else if (label.includes(q)) score = 2;
    else if (`${areaName} ${item.group.toLowerCase()}`.includes(q)) score = 1;
    if (score) scored.push({ item, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item);
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const LAST_PAGE_KEY = 'nav.lastPage';

function readPages(store: KeyValueStore): Partial<Record<Area, string>> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(LAST_PAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<Record<Area, string>>) : {};
  } catch {
    return {};
  }
}

/** Remember the page just opened as the last one of its area (only known pages are stored). */
export function rememberPage(store: KeyValueStore, pathname: string): void {
  const area = areaOf(pathname);
  if (!area || !allItems().some((i) => i.area === area && i.href === pathname)) return;
  try {
    store.setItem(LAST_PAGE_KEY, JSON.stringify({ ...readPages(store), [area]: pathname }));
  } catch {
    /* private mode / quota: switching area just opens its first page */
  }
}

/** Where switching to `area` should go: the last page seen there, else its home. */
export function pageFor(store: KeyValueStore, area: Area): string {
  const saved = readPages(store)[area];
  return typeof saved === 'string' && allItems().some((i) => i.area === area && i.href === saved) ? saved : AREAS[area].home;
}
