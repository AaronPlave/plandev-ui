/**
 * Narrow postMessage protocol between a plan's IFrame panel and the application embedded in it.
 *
 * PlanDev → embedded app: the plan context (plan, revision, simulation dataset, time cursor, selection).
 * Embedded app → PlanDev: requests to move the time cursor, select an activity, open another plan
 * (in the current view), show a simulation, expand or restore its own panel, and a "ready" ping.
 *
 * Only identifiers and times cross the bridge: no credentials, tokens, or simulation results. The
 * embedded app fetches its own data with its own credentials.
 */

export const EMBED_PROTOCOL = 'plandev.embed.v1';

export type EmbedContext = {
  /** Whether PlanDev shows the app's panel expanded over the plan workspace. */
  expanded: boolean;
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
  /** endMs: also frame [timeMs, endMs] on the timeline (e.g. a constraint violation window). */
  | { endMs?: number; timeMs: number; type: 'setTime' }
  | { directiveId: number | null; spanId: number | null; type: 'select' }
  | { planId: number; type: 'openPlan' }
  | { simulationDatasetId: number; type: 'showSimulation' }
  /** Ask PlanDev to expand the app's own panel over the workspace, or to restore the grid. PlanDev decides. */
  | { type: 'expandPanel' }
  | { type: 'restorePanel' };

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
    case 'expandPanel':
    case 'restorePanel':
      return { type: m.type };
    case 'setTime':
      if (typeof m.timeMs !== 'number' || !Number.isFinite(m.timeMs)) {
        return null;
      }
      return typeof m.endMs === 'number' && Number.isFinite(m.endMs) && m.endMs >= m.timeMs
        ? { endMs: m.endMs, timeMs: m.timeMs, type: 'setTime' }
        : { timeMs: m.timeMs, type: 'setTime' };
    case 'select':
      return { directiveId: idOrNull(m.directiveId), spanId: idOrNull(m.spanId), type: 'select' };
    case 'openPlan':
      return Number.isInteger(m.planId) && (m.planId as number) >= 0
        ? { planId: m.planId as number, type: 'openPlan' }
        : null;
    case 'showSimulation':
      return Number.isInteger(m.simulationDatasetId) && (m.simulationDatasetId as number) >= 0
        ? { simulationDatasetId: m.simulationDatasetId as number, type: 'showSimulation' }
        : null;
    default:
      return null;
  }
}
