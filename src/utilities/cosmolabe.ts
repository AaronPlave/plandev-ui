/**
 * PlanDev side of the Cosmolabe 3D panel: which mission scene a plan's model has, PlanDev simulated
 * activities as Cosmolabe host activities, and proposals (a location and/or a time window) coming back
 * from the 3D view. Everything mission-specific lives in the mission's adapter, served with its catalog
 * (plandev-examples/integrations/cosmolabe), not here.
 *
 * Authority: a proposal is only an input. It is staged into a mission scheduling goal, and the goal
 * (the mission model's own geometry and kernels) decides whether it can be planned.
 */
import type { MissionActivitySpec } from '@cosmolabe/viewer';
import type { Span } from '../types/simulation';

export type CosmolabeMissionIndex = {
  missions: Record<string, { adapter: string; catalog: string; label: string; models: string[] }>;
  version: 1;
};

export type CosmolabeMission = { adapterUrl: string; catalogUrl: string; key: string; label: string };

/** A location and/or window proposed from the 3D view. Coordinates are planetocentric, east-positive, degrees. */
export type CosmolabeProposal = {
  body: string;
  frame: string;
  id: string;
  latDeg: number;
  lonDeg: number;
  name: string;
  source: {
    app: 'cosmolabe';
    /** How the location and window were chosen. */
    location: 'probe';
    planId: number;
    simulationDatasetId: number | null;
    window: 'viewer-time' | 'event-result' | null;
    windowDetail?: string;
  };
  window: { end: string; start: string } | null;
};

/** The mission adapter module (missions/<key>/adapter.js); see plandev-examples/integrations/cosmolabe. */
export type CosmolabeAdapter = {
  body: string;
  targets: {
    body: string;
    conventions: string;
    /** The targets' coordinate convention, for drawing them in the scene. */
    coordinates: Record<string, unknown>;
    goal: string;
    check(p: CosmolabeProposal): string[];
    directiveName(id: string): string;
    read(
      args: unknown,
    ): { id: string; latDeg: number; lonDeg: number; name: string; window: { end: string; start: string } | null }[];
    remove(args: unknown, id: string): Record<string, unknown>;
    stage(args: unknown, p: CosmolabeProposal): Record<string, unknown>;
    targetOf(directiveName: string | null | undefined): string | null;
  };
  vehicle: string;
};

/** The mission whose index entry lists `modelName`, or null (the panel then says the plan has no 3D scene). */
export function resolveMission(index: CosmolabeMissionIndex, indexUrl: string, modelName: string | undefined) {
  const entry = Object.entries(index.missions ?? {}).find(([, m]) => modelName && m.models.includes(modelName));
  if (!entry) {
    return null;
  }
  const [key, m] = entry;
  return {
    adapterUrl: new URL(m.adapter, indexUrl).href,
    catalogUrl: new URL(m.catalog, indexUrl).href,
    key,
    label: m.label,
  } satisfies CosmolabeMission;
}

const ACTIVITY_PREFIX = 'plandev:';

/** Host activity id for a simulated span: unique per plan and simulation dataset (span ids are per dataset). */
export function activityId(planId: number, datasetId: number, spanId: number) {
  return `${ACTIVITY_PREFIX}plan/${planId}/dataset/${datasetId}/span/${spanId}`;
}

/** The span an activity id names, or null for an id that is not one of this plan/dataset's spans. */
export function spanIdOf(id: string | null | undefined, planId: number, datasetId: number): number | null {
  const prefix = activityId(planId, datasetId, 0).slice(0, -1);
  if (!id?.startsWith(prefix)) {
    return null;
  }
  const spanId = Number(id.slice(prefix.length));
  return Number.isInteger(spanId) ? spanId : null;
}

/** PlanDev simulated spans as Cosmolabe host activities, shown against the mission's vehicle and body. */
export function spansToActivities(
  spans: Span[],
  ctx: { body: string; datasetId: number; planId: number; planName: string; vehicle: string },
): MissionActivitySpec[] {
  return spans
    .filter(span => Number.isFinite(span.startMs) && Number.isFinite(span.endMs) && span.endMs >= span.startMs)
    .map(span => {
      const instant = span.endMs === span.startMs;
      return {
        body: ctx.body,
        end: new Date(span.endMs).toISOString(),
        id: activityId(ctx.planId, ctx.datasetId, span.span_id),
        kind: 'other',
        mission: ctx.planName,
        name: span.type,
        provenance: {
          authority: 'estimated',
          limitations: 'PlanDev simulation result for this plan revision: planned, not observed operations.',
          source: `plandev:plan/${ctx.planId}/simulation_dataset/${ctx.datasetId}`,
          timing: 'exact',
          version: String(ctx.datasetId),
        },
        start: new Date(span.startMs).toISOString(),
        temporality: instant ? 'instant' : 'interval',
        timeSystem: 'UTC',
        vehicle: ctx.vehicle,
        version: 1,
      } as MissionActivitySpec;
    });
}

/**
 * Planetocentric latitude and east longitude (degrees, [-180, 180)) of a body-fixed position. A picked surface
 * point may report geodetic latitude (terrain datum); the mission goals take planetocentric.
 */
export function planetocentric([x, y, z]: readonly [number, number, number]) {
  const latDeg = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return { latDeg, lonDeg: lon >= 180 ? lon - 360 : lon };
}
