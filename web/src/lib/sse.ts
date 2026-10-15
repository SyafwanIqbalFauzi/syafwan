// Incremental Server-Sent Events parser. Feed it text chunks as they arrive;
// it returns the complete events seen so far and keeps the unfinished tail.
export interface SseEvent {
  event: string;
  data: string;
}

export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = parseFrame(frame);
      if (parsed) events.push(parsed);
    }
    return events;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    // Lines starting with ":" are comments (Hermes sends ": keepalive").
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}
