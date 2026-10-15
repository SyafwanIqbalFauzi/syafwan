// Shapes the Claude plan usage rows (Directus `claude_usage`, filled from the VPS) for display.
// Pure so it can be tested; the component only paints what this returns.

export interface UsageRow {
  window: string;
  percent: number | null;
  severity: string | null;
  resets_at: string | null;
  checked_at: string | null;
}

export type Level = 'normal' | 'warning' | 'critical';

export interface UsageWindow {
  key: string;
  label: string;
  percent: number;
  level: Level;
  /** "in 2 h 13 min", or "now" once the window has rolled over */
  resetsIn: string | null;
  resetsAt: string | null;
  /** The reset time has passed, so the number belongs to the previous window */
  rolledOver: boolean;
}

export interface UsageView {
  windows: UsageWindow[];
  checkedAt: string | null;
  /** The VPS has not refreshed the numbers recently */
  stale: boolean;
}

const LABELS: Record<string, string> = {
  session: '5-hour window',
  weekly: 'Weekly · all models',
  weekly_opus: 'Weekly · Opus',
  weekly_sonnet: 'Weekly · Sonnet',
};
const ORDER = Object.keys(LABELS);

/** Older than this and the numbers are shown as possibly out of date (the sync runs every 5 minutes). */
export const STALE_AFTER_MS = 20 * 60_000;

export function levelFor(percent: number): Level {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'normal';
}

export function resetsIn(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours} h ${minutes % 60} min`;
  return `in ${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function usageView(rows: UsageRow[] | null | undefined, now = Date.now()): UsageView | null {
  const usable = (rows ?? []).filter((r) => typeof r.percent === 'number' && Number.isFinite(r.percent));
  if (!usable.length) return null;
  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
  const windows = usable
    .sort((a, b) => rank(a.window) - rank(b.window) || a.window.localeCompare(b.window))
    .map((r): UsageWindow => {
      const percent = Math.max(0, Math.min(100, r.percent as number));
      const reset = r.resets_at ? Date.parse(r.resets_at) : NaN;
      return {
        key: r.window,
        label: LABELS[r.window] ?? r.window.replace(/_/g, ' '),
        percent,
        level: levelFor(percent),
        resetsIn: resetsIn(r.resets_at, now),
        resetsAt: r.resets_at,
        rolledOver: !Number.isNaN(reset) && reset <= now,
      };
    });
  const checked = usable.map((r) => r.checked_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const age = checked ? now - Date.parse(checked) : Infinity;
  return { windows, checkedAt: checked, stale: !(age <= STALE_AFTER_MS) };
}
