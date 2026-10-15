// What Hermes is doing right now during a chat turn, derived from the events of the stream
// (run.started, assistant.delta, tool.started, approval.request, …). Pure, so it can be tested;
// the chat script only paints the result.

export type Phase = 'thinking' | 'writing' | 'tool' | 'approval' | 'stopping';

export interface Activity {
  phase: Phase;
  /** tool.started: the tool being used. */
  tool?: string;
  /** tool.started: a short preview of its arguments (a command, a file name, …). */
  detail?: string;
}

export const STALL_AFTER_S = 30;

const clip = (text: unknown, max: number): string | undefined => {
  if (typeof text !== 'string') return undefined;
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat ? (flat.length > max ? `${flat.slice(0, max - 1)}…` : flat) : undefined;
};

/** The activity after `event`. Unknown events leave it as it was. */
export function nextActivity(current: Activity, event: string, data: Record<string, any> = {}): Activity {
  // Once stopping, only the end of the run changes anything (handled by the caller removing the indicator).
  if (current.phase === 'stopping') return current;
  switch (event) {
    case 'run.started':
    case 'message.started':
      return { phase: 'thinking' };
    case 'assistant.delta':
    case 'message.delta': // the Runs API names it this way
      return current.phase === 'writing' ? current : { phase: 'writing' };
    case 'tool.started':
      return { phase: 'tool', tool: clip(data.tool ?? data.tool_name, 40) ?? 'a tool', detail: clip(data.preview, 90) };
    case 'tool.completed':
    case 'tool.failed':
      return { phase: 'thinking' };
    case 'approval.request':
      return { phase: 'approval' };
    case 'approval.answered':
    case 'approval.responded': // Runs API: the answer was recorded
      return { phase: 'thinking' };
    case 'stop.requested':
      return { phase: 'stopping' };
    case 'tool.progress':
    case 'reasoning.available':
      // Hermes reports its reasoning as progress on a pseudo tool; it still counts as thinking.
      return current.phase === 'tool' || current.phase === 'approval' ? current : { phase: 'thinking' };
    default:
      return current;
  }
}

/** One short line for the indicator. `idleSeconds` = time since the last event. */
export function describeActivity(activity: Activity, idleSeconds = 0): string {
  let text: string;
  switch (activity.phase) {
    case 'writing':
      text = 'Hermes is writing…';
      break;
    case 'tool':
      text = `Using ${activity.tool ?? 'a tool'}${activity.detail ? `: ${activity.detail}` : ''}`;
      break;
    case 'approval':
      return 'Waiting for your approval';
    case 'stopping':
      return 'Stopping…';
    default:
      text = 'Hermes is thinking…';
  }
  return idleSeconds >= STALL_AFTER_S ? `${text}  still working, nothing new for ${Math.floor(idleSeconds)} s` : text;
}

/** Animated dots while Hermes is busy; none while it is waiting for the person. */
export const isWaitingForPerson = (activity: Activity): boolean => activity.phase === 'approval';
