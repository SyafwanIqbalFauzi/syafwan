// Saves one Autoplay Blocker report into Directus with the create-only token. The token can add rows to
// `autoplay_reports` and nothing else (see cms/autoplay-reports-setup.mjs); it never reaches the browser.
import { DIRECTUS_INTERNAL_URL, DIRECTUS_REPORT_TOKEN } from 'astro:env/server';
import type { ReportInput } from './report-input.ts';

export const reportsAvailable = (): boolean => Boolean(DIRECTUS_REPORT_TOKEN);

export async function saveReport(report: ReportInput): Promise<boolean> {
  if (!DIRECTUS_REPORT_TOKEN) return false;
  try {
    const res = await fetch(`${DIRECTUS_INTERNAL_URL}/items/autoplay_reports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DIRECTUS_REPORT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, status: 'new' }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
