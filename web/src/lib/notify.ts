// Alerts for the chat: a short sound plus a message when Hermes needs an answer or has finished.
// The decision logic is pure (tested); the browser parts at the bottom only run in a page.

export type AlertKind = 'approval' | 'done' | 'failed';

export interface AlertText {
  kind: AlertKind;
  title: string;
  body: string;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const NOTIFY_PREF_KEY = 'agent.notify';
export const NOTIFIED_KEY = 'agent.notified';

const snippet = (text: string, max = 90) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** What to tell the person for a run status (or run event name), or null when nothing needs saying. */
export function alertFor(state: string, message = ''): AlertText | null {
  const about = message ? `“${snippet(message)}”` : 'Your message';
  switch (state) {
    case 'waiting_for_approval':
    case 'approval.request':
      return { kind: 'approval', title: 'Hermes needs your OK', body: `${about} — waiting for you to allow or deny an action.` };
    case 'completed':
    case 'run.completed':
      return { kind: 'done', title: 'Hermes is done', body: `${about} — the answer is ready.` };
    case 'failed':
    case 'run.failed':
      return { kind: 'failed', title: 'Hermes hit a problem', body: `${about} — it could not finish.` };
    default:
      return null; // running, cancelled, interrupted: nothing to announce
  }
}

/** True the first time a (run, kind) pair is seen, so two pages or two polls never alert twice. */
export function firstTime(store: KeyValueStore, runId: string, kind: AlertKind): boolean {
  const key = `${runId}:${kind}`;
  try {
    const seen: unknown = JSON.parse(store.getItem(NOTIFIED_KEY) ?? '[]');
    if (!Array.isArray(seen)) throw new Error('bad');
    if (seen.includes(key)) return false;
    store.setItem(NOTIFIED_KEY, JSON.stringify([...seen.slice(-19), key]));
  } catch {
    try {
      store.setItem(NOTIFIED_KEY, JSON.stringify([key]));
    } catch {
      /* storage unavailable: better to alert twice than never */
    }
  }
  return true;
}

export const alertsEnabled = (store: Pick<KeyValueStore, 'getItem'>): boolean => {
  try {
    return store.getItem(NOTIFY_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
};

// ---- browser side -----------------------------------------------------------------------------

let audio: AudioContext | null = null;

function beep(kind: AlertKind) {
  try {
    const ctx = (audio ??= new AudioContext());
    void ctx.resume();
    // approval = two rising notes (needs you), done = one soft note, failed = one low note
    const notes = kind === 'approval' ? [660, 880] : kind === 'done' ? [740] : [330];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {
    /* no audio available or not allowed yet */
  }
}

function toast(text: AlertText) {
  const box = document.createElement('a');
  box.className = 'toast';
  box.href = '/agent/chat';
  box.setAttribute('role', 'status');
  const strong = document.createElement('strong');
  strong.textContent = text.title;
  const span = document.createElement('span');
  span.textContent = text.body;
  box.append(strong, span);
  document.body.append(box);
  setTimeout(() => box.remove(), 9000);
}

/** Sound + message. The operating-system popup is used when the tab is in the background. */
export function alertUser(text: AlertText, opts: { onChatPage: boolean }) {
  if (!alertsEnabled(localStorage)) return;
  beep(text.kind);
  const watching = document.visibilityState === 'visible' && document.hasFocus();
  if (!(watching && opts.onChatPage)) toast(text);
  if (!watching && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const popup = new Notification(text.title, { body: text.body, tag: `hermes-${text.kind}` });
      popup.onclick = () => {
        window.focus();
        location.href = '/agent/chat';
      };
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }
}

/** Turn alerts on or off. Turning on asks the browser for permission (must come from a click). */
export async function setAlerts(on: boolean): Promise<'on' | 'on-no-popup' | 'off'> {
  try {
    localStorage.setItem(NOTIFY_PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (!on) return 'off';
  beep('done'); // also unlocks audio for this page
  if (typeof Notification === 'undefined') return 'on-no-popup';
  if (Notification.permission === 'default') await Notification.requestPermission().catch(() => 'denied');
  return Notification.permission === 'granted' ? 'on' : 'on-no-popup';
}
