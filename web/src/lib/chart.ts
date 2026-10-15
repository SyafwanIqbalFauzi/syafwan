// Small helpers for the hand-drawn SVG charts (no chart library: the pages stay light and
// render entirely on the server).

/** Round up to 1, 2, 5 or 10 times a power of ten, so axis ticks land on friendly numbers. */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * exponent;
}

export interface Axis {
  min: number;
  max: number;
  ticks: number[];
}

/** Friendly tick spacing: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / exponent;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * exponent;
}

/** An axis that always includes zero, with evenly spaced ticks on friendly numbers. */
export function niceAxis(lowest: number, highest: number, steps = 4): Axis {
  const low = Math.min(0, lowest);
  const high = Math.max(0, highest);
  if (high === 0 && low === 0) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const step = niceStep((high - low) / steps);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min, max, ticks };
}

/** Show every n-th label so a crowded axis stays readable. */
export function labelStep(count: number, maxLabels = 8): number {
  return Math.max(1, Math.ceil(count / maxLabels));
}

/** `M x y L x y ...` for a polyline. */
export function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** One shade per person, the same everywhere: blues for income, greys for spending. The first person is the strongest. */
const SHADES = { income: ['var(--te-blue)', '#5ba6d4', '#a8cfe8'], expense: ['var(--te-black)', '#757575', '#bdbdbd'] };
export function personShade(kind: 'income' | 'expense', index: number): string {
  const list = SHADES[kind];
  return list[Math.min(Math.max(0, index), list.length - 1)];
}

const HEX = { income: ['#0071bb', '#5ba6d4', '#a8cfe8'], expense: ['#000000', '#757575', '#bdbdbd'] };

/** The same shades as personShade, as plain colours for the canvas charts. */
export function personHex(kind: 'income' | 'expense', index: number): string {
  const list = HEX[kind];
  return list[Math.min(Math.max(0, index), list.length - 1)];
}

/** `#rrggbb` + alpha 0..1 -> `rgba(...)` */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
