/**
 * Narrow postMessage protocol between a plan's IFrame panel and the application embedded in it.
 *
 * PlanDev → embedded app: the plan context (plan, revision, simulation dataset, time cursor, selection).
 * Embedded app → PlanDev: requests to move the time cursor or select an activity, and a "ready" ping.
 *
 * Only identifiers and times cross the bridge: no credentials, tokens, or simulation results. The
 * embedded app fetches its own data with its own credentials.
 */

export const EMBED_PROTOCOL = 'plandev.embed.v1';

export type EmbedContext = {
  planId: number | null;
  planRevision: number | null;
  selectedActivityDirectiveId: number | null;
  /** span_id within simulationDatasetId. */
  selectedSpanId: number | null;
  /** simulation_dataset.id currently shown in the plan, or null when there is none. */
  simulationDatasetId: number | null;
  /** Time cursor, absolute unix ms, or null when no cursor is set. */
  timeMs: number | null;
};

export type EmbedRequest =
  | { type: 'ready' }
  | { timeMs: number; type: 'setTime' }
  | { directiveId: number | null; spanId: number | null; type: 'select' };

export function contextMessage(context: EmbedContext) {
  return { protocol: EMBED_PROTOCOL, type: 'context', ...context };
}

/** Origin of an iframe src, or null if it is not an absolute http(s) URL (nothing is posted then). */
export function originOf(src: string | undefined | null): string | null {
  try {
    const url = new URL(src ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const idOrNull = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);

/** Validates an incoming message; anything malformed or from another protocol is null. */
export function parseEmbedRequest(data: unknown): EmbedRequest | null {
  if (!data || typeof data !== 'object' || (data as { protocol?: unknown }).protocol !== EMBED_PROTOCOL) {
    return null;
  }
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'setTime':
      return typeof m.timeMs === 'number' && Number.isFinite(m.timeMs) ? { timeMs: m.timeMs, type: 'setTime' } : null;
    case 'select':
      return { directiveId: idOrNull(m.directiveId), spanId: idOrNull(m.spanId), type: 'select' };
    default:
      return null;
  }
}
