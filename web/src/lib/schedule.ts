// Turns Hermes schedule strings into short English text. Cron expressions on the VPS are
// evaluated in UTC; the owner reads WIB (UTC+7, no DST), so both are shown.

const WIB_OFFSET = 7;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Intervals longer than a year are how Hermes stores "effectively never repeat". */
const NEVER_MINUTES = 365 * 24 * 60;

function parseList(field: string, min: number, max: number): number[] | null {
  const out: number[] = [];
  for (const part of field.split(',')) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < min || n > max) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

function everyMinutes(minutes: number): string {
  if (minutes >= NEVER_MINUTES) return 'on demand (no repeat)';
  if (minutes % 1440 === 0) return minutes === 1440 ? 'every day' : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'every hour' : `every ${minutes / 60} hours`;
  return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
}

/** `schedule` is the display string Hermes keeps, e.g. "every 30m" or "0 1,7 * * *". */
export function humanizeSchedule(schedule: string | null | undefined): string {
  const raw = (schedule ?? '').trim();
  if (!raw) return 'not scheduled';

  const interval = raw.match(/^every (\d+)\s*(m|min|minutes?|h|hours?|d|days?)$/i);
  if (interval) {
    const n = Number(interval[1]);
    const unit = interval[2][0].toLowerCase();
    return everyMinutes(unit === 'm' ? n : unit === 'h' ? n * 60 : n * 1440);
  }

  const fields = raw.split(/\s+/);
  if (fields.length !== 5) return raw;
  const [min, hour, dom, mon, dow] = fields;

  const step = min.match(/^\*\/(\d+)$/);
  if (step && hour === '*' && dom === '*' && mon === '*' && dow === '*') return everyMinutes(Number(step[1]));

  if (dom !== '*' || mon !== '*') return raw; // yearly/monthly: show the expression as is
  const minutes = parseList(min, 0, 59);
  if (!minutes || minutes.length !== 1) return raw;

  if (hour === '*') {
    if (dow !== '*') return raw;
    return minutes[0] === 0 ? 'every hour, on the hour' : `every hour at minute ${minutes[0]}`;
  }

  const hours = parseList(hour, 0, 23);
  const days = dow === '*' ? null : parseList(dow.replace(/7/g, '0'), 0, 6);
  if (!hours || (dow !== '*' && !days)) return raw;

  // Convert every UTC time to WIB; crossing midnight moves the weekday too.
  const times = hours
    .map((h) => {
      const shifted = h + WIB_OFFSET;
      return { clock: `${pad(shifted % 24)}:${pad(minutes[0])}`, dayShift: shifted >= 24 ? 1 : 0 };
    })
    .sort((a, b) => a.dayShift - b.dayShift || a.clock.localeCompare(b.clock));

  if (!days) return `every day at ${times.map((t) => t.clock).sort().join(', ')} WIB`;

  const parts = new Map<string, string[]>();
  for (const t of times) {
    const label = [...new Set(days.map((d) => DAYS[(d + t.dayShift) % 7]))].join(', ');
    parts.set(label, [...(parts.get(label) ?? []), t.clock]);
  }
  return [...parts].map(([label, clocks]) => `every ${label} at ${clocks.join(', ')} WIB`).join('; ');
}
