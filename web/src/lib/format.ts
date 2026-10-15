// Small display helpers shared by the /agent pages. Clock times are shown in WIB (Asia/Jakarta)
// and always say so ("15 Oct 11:00 WIB"), so no page needs a separate timezone note.

const TZ = 'Asia/Jakarta';

const dateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dateOnly = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** `2026-10-15T04:00:00Z` -> "15 Oct 11:00 WIB". Accepts ISO strings or epoch seconds. */
export function formatWhen(value: string | number | null | undefined): string {
  const date = toDate(value);
  return date ? `${dateTime.format(date).replace(',', '')} WIB` : '—';
}

/** Calendar day in WIB, `YYYY-MM-DD`. */
export function dayKey(value: string | number | null | undefined): string | null {
  const date = toDate(value);
  return date ? dateOnly.format(date) : null;
}

export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 min ago", "in 2 h", "2 d ago". */
export function relative(value: string | number | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return '—';
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs < 60_000 ? ['s', 1000] : abs < 3_600_000 ? ['min', 60_000] : abs < 86_400_000 ? ['h', 3_600_000] : ['d', 86_400_000];
  const n = Math.max(1, Math.round(abs / (unit[1] as number)));
  return diff < 0 ? `${n} ${unit[0]} ago` : `in ${n} ${unit[0]}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 1) return '<1 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** 21714 -> "21.7k", 5_841_816 -> "5.84M". */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function usd(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

export type Tone = 'ok' | 'wait' | 'fail' | 'idle';

/** Maps run/job status words to the tag colour: black = fine, amber = waiting, orange = failed. */
export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'ok':
    case 'completed':
    case 'scheduled':
    case 'connected':
    case 'running':
      return 'ok';
    case 'paused':
    case 'queued':
    case 'unknown':
    case 'delivery_failed':
      return 'wait';
    case 'failed':
    case 'error':
      return 'fail';
    default:
      return 'idle';
  }
}

/** Model ids to a short readable name. */
export function modelLabel(model: string | null | undefined): string {
  if (!model || model === 'default') return 'default';
  return model.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, '-$1.$2');
}
