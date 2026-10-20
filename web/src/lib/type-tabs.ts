// The "All / Income / Spending / Savings" tabs on the Budgets and Categories pages. The pure part
// lives here so it can be unit tested; the page script (scripts/type-tabs.ts) only moves the DOM.
// The chosen tab is kept in the address as ?type=... (the same values the Transactions filter uses).

export const TYPE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pemasukan', label: 'Income' },
  { key: 'pengeluaran', label: 'Spending' },
  { key: 'tabungan', label: 'Savings' },
] as const;

export type TypeTab = (typeof TYPE_TABS)[number]['key'];

/** The tab named by `?type=`; anything unknown (or missing) means "All". */
export function parseTypeTab(value: unknown): TypeTab {
  return TYPE_TABS.find((t) => t.key === value)?.key ?? 'all';
}

/** Does an item of this type show under the chosen tab? */
export const showsUnder = (tab: TypeTab, jenis: string): boolean => tab === 'all' || tab === jenis;

/** How many items each tab holds: `all` is the total, the others count their own type. */
export function tabCounts(jenisList: string[]): Record<TypeTab, number> {
  const counts: Record<TypeTab, number> = { all: jenisList.length, pemasukan: 0, pengeluaran: 0, tabungan: 0 };
  for (const jenis of jenisList) if (jenis === 'pemasukan' || jenis === 'pengeluaran' || jenis === 'tabungan') counts[jenis]++;
  return counts;
}

/** The address for a tab: `all` drops the parameter so the plain page URL stays clean. */
export function hrefForTab(search: string, tab: TypeTab): string {
  const params = new URLSearchParams(search);
  if (tab === 'all') params.delete('type');
  else params.set('type', tab);
  const text = params.toString();
  return text ? `?${text}` : '?';
}
