/**
 * Platform states from Hermes /health/detailed.
 *
 * The gateway keeps one entry per chat platform in its status file. An entry written by a gateway process that no
 * longer runs stays there with state "connected" (Discord, switched off on 27 Oct 2026, kept saying so). The health
 * answer includes the current gateway `pid` and each entry's `writer_pid`: an entry from another process is stale.
 */

export interface PlatformEntry {
  state?: string | null;
  writer_pid?: number | null;
}

/** Each platform as [name, state]; a "connected" entry written by a process other than the running gateway is "not running". */
export function platformStates(
  platforms: Record<string, PlatformEntry | null | undefined> | null | undefined,
  gatewayPid: number | null | undefined,
): [string, string][] {
  return Object.entries(platforms ?? {}).map(([name, entry]) => {
    const state = entry?.state ?? 'unknown';
    const stale =
      typeof gatewayPid === 'number' && typeof entry?.writer_pid === 'number' && entry.writer_pid !== gatewayPid;
    return [name, stale && state === 'connected' ? 'not running' : state];
  });
}
