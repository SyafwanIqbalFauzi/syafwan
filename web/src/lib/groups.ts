// Agent groups on /agent/agents. The VPS sync gives every job a first group; after that the
// group is edited on the website and the sync leaves it alone.

export const UNGROUPED = 'Ungrouped';
const PREFERRED_ORDER = ['Sejarah Persib', 'Keuangan', 'Hermes & sistem'];
export const MAX_GROUP_LENGTH = 40;

/** Trims, collapses spaces, and rejects empty, over-long or control-character input. */
export function normalizeGroup(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.replace(/\s+/g, ' ').trim();
  if (!value || value.length > MAX_GROUP_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(value)) return null;
  return value;
}

/** Known groups first (in the order above), then the rest alphabetically, "Ungrouped" last. */
export function orderGroups(names: Iterable<string>): string[] {
  const unique = [...new Set(names)];
  const rank = (name: string) => (name === UNGROUPED ? 2000 : PREFERRED_ORDER.includes(name) ? PREFERRED_ORDER.indexOf(name) : 1000);
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
