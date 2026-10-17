// What to show for the conversations that are being answered: a marker per conversation in the chat
// list and one summary next to "Chat" in the sidebar. Pure, so it is unit tested.

export type RunState = 'busy' | 'wait' | 'done';

export const FINISHED_STATUSES = ['completed', 'failed', 'cancelled', 'interrupted'];

/** Server run status -> what the person sees: working, needs you (approval), or done (finished, not opened yet). */
export function stateOf(status: string | null | undefined): RunState {
  if (status === 'waiting_for_approval') return 'wait';
  if (status && FINISHED_STATUSES.includes(status)) return 'done';
  return 'busy';
}

export interface Summary {
  text: string;
  state: RunState;
}

/** One label for all conversations: the most urgent state wins (needs you > working > done). */
export function summarize(states: RunState[]): Summary | null {
  const count = (s: RunState) => states.filter((x) => x === s).length;
  const wait = count('wait');
  const busy = count('busy');
  const done = count('done');
  if (wait) return { state: 'wait', text: wait > 1 ? `${wait} need you` : 'needs you' };
  if (busy) return { state: 'busy', text: busy > 1 ? `${busy} working` : 'working' };
  if (done) return { state: 'done', text: done > 1 ? `${done} done` : 'done' };
  return null;
}

/** Text for the small marker in the chat list. */
export const markerText = (state: RunState): string => (state === 'wait' ? 'needs you' : state === 'busy' ? 'working' : 'done');
