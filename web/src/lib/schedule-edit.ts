// Edit-form side of agent schedules. The form speaks WIB (UTC+7) and friendly modes; Hermes
// stores either "every Nm" or a 5-field cron expression evaluated in UTC. Everything here is
// pure so it can be shared by the browser form (live preview) and the server route (validation).

const WIB_OFFSET = 7;

export type ScheduleMode = 'interval' | 'hourly' | 'daily' | 'weekly' | 'custom';

export interface ScheduleForm {
  mode: ScheduleMode;
  /** interval: every N minutes (1–1440) */
  minutes?: number;
  /** hourly: minute of the hour (0–59) */
  minute?: number;
  /** daily / weekly: "HH:MM" in WIB */
  time?: string;
  /** weekly: 0 = Sunday … 6 = Saturday, as seen in WIB */
  weekday?: number;
  /** custom: a cron expression (UTC) or "every Nm" */
  raw?: string;
}

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week
];

function validCronField(field: string, [min, max]: [number, number]): boolean {
  return field.split(',').every((part) => {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return false;
    if (m[2] !== undefined && Number(m[2]) < 1) return false;
    if (m[1] === '*') return true;
    const [lo, hi] = m[1].split('-').map(Number);
    return lo >= min && lo <= max && (hi === undefined || (hi >= lo && hi <= max));
  });
}

/** True for "every Nm" (N ≥ 1) or a 5-field cron expression with in-range values. */
export function validateSchedule(raw: string): boolean {
  const text = raw.trim();
  if (/^every \d{1,7}m$/.test(text)) return Number(text.match(/\d+/)![0]) >= 1;
  const fields = text.split(/\s+/);
  return fields.length === 5 && fields.every((f, i) => validCronField(f, FIELD_RANGES[i]));
}

export function parseTime(time: string | undefined): { h: number; m: number } | null {
  const match = (time ?? '').match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? { h: Number(match[1]), m: Number(match[2]) } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The string to send to Hermes, or null when the form values are not valid. */
export function buildSchedule(form: ScheduleForm): string | null {
  switch (form.mode) {
    case 'interval': {
      const n = Number(form.minutes);
      return Number.isInteger(n) && n >= 1 && n <= 1440 ? `every ${n}m` : null;
    }
    case 'hourly': {
      const m = Number(form.minute);
      return Number.isInteger(m) && m >= 0 && m <= 59 ? `${m} * * * *` : null;
    }
    case 'daily': {
      const t = parseTime(form.time);
      return t ? `${t.m} ${(t.h - WIB_OFFSET + 24) % 24} * * *` : null;
    }
    case 'weekly': {
      const t = parseTime(form.time);
      const day = Number(form.weekday);
      if (!t || !Number.isInteger(day) || day < 0 || day > 6) return null;
      // A WIB time before 07:00 is still the previous calendar day in UTC.
      const utcDay = (day + (t.h < WIB_OFFSET ? -1 : 0) + 7) % 7;
      return `${t.m} ${(t.h - WIB_OFFSET + 24) % 24} * * ${utcDay}`;
    }
    case 'custom': {
      const raw = (form.raw ?? '').trim();
      return validateSchedule(raw) ? raw : null;
    }
  }
}

const single = (field: string, min: number, max: number): number | null => (/^\d+$/.test(field) && Number(field) >= min && Number(field) <= max ? Number(field) : null);

/** Best-effort inverse of buildSchedule, to prefill the form from what Hermes stores. */
export function parseScheduleForm(display: string | null | undefined): ScheduleForm {
  const raw = (display ?? '').trim();
  const every = raw.match(/^every (\d+)m$/);
  if (every && Number(every[1]) >= 1 && Number(every[1]) <= 1440) return { mode: 'interval', minutes: Number(every[1]) };
  if (every) return { mode: 'custom', raw };

  const f = raw.split(/\s+/);
  if (f.length !== 5) return { mode: 'custom', raw };
  const [min, hour, dom, mon, dow] = f;

  const step = min.match(/^\*\/(\d+)$/);
  if (step && hour === '*' && dom === '*' && mon === '*' && dow === '*' && Number(step[1]) >= 1 && Number(step[1]) <= 1440) {
    return { mode: 'interval', minutes: Number(step[1]) };
  }
  if (dom !== '*' || mon !== '*') return { mode: 'custom', raw };

  const m = single(min, 0, 59);
  if (m === null) return { mode: 'custom', raw };
  if (hour === '*' && dow === '*') return { mode: 'hourly', minute: m };

  const h = single(hour, 0, 23);
  if (h === null) return { mode: 'custom', raw };
  const wibRaw = h + WIB_OFFSET;
  const time = `${pad(wibRaw % 24)}:${pad(m)}`;
  if (dow === '*') return { mode: 'daily', time };
  const d = single(dow.replace(/^7$/, '0'), 0, 6);
  if (d === null) return { mode: 'custom', raw };
  return { mode: 'weekly', time, weekday: (d + (wibRaw >= 24 ? 1 : 0)) % 7 };
}

/** Job names: 1–80 characters, single line, no markup. */
export const MAX_NAME_LENGTH = 80;
export function normalizeJobName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (!value || value.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f<>]/.test(value)) return null;
  return value;
}
