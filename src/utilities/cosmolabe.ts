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
    location: 'probe' | 'staged-target';
    planId: number;
    simulationDatasetId: number | null;
    window: 'viewer-time' | 'event-result' | 'pass-search' | null;
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
    /** Sphere radius for exploratory ground-track distances; the same one the mission goal uses. */
    meanRadiusKm: number;
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

// ── Selection ─────────────────────────────────────────────────────────────────────────────

/**
 * What the viewer must do so that its host-activity selection matches PlanDev's: `want` is the activity id of
 * PlanDev's selection (plan + dataset + span, see `activityId`), `viewerSelected` the viewer's selected activity.
 * A cleared PlanDev selection clears only a PlanDev activity in the viewer; other scene selections are the operator's.
 */
export function selectionAction(
  want: string | null,
  viewerSelected: string | null | undefined,
): { id: string; kind: 'select' } | { kind: 'clear' } | null {
  if (want === (viewerSelected ?? null)) {
    return null;
  }
  if (want !== null) {
    return { id: want, kind: 'select' };
  }
  return viewerSelected?.startsWith(ACTIVITY_PREFIX) ? { kind: 'clear' } : null;
}

// ── Proposed windows ──────────────────────────────────────────────────────────────────────

export type Interval = { endMs: number; startMs: number };

/** Why a window cannot be staged against a plan; empty when it can. The goal repeats these checks. */
export function windowProblems(w: Interval, plan: Interval): string[] {
  if (!Number.isFinite(w.startMs) || !Number.isFinite(w.endMs)) {
    return ['The window is not a valid time range.'];
  }
  if (w.endMs <= w.startMs) {
    return ['The window is empty or reversed.'];
  }
  if (w.endMs <= plan.startMs || w.startMs >= plan.endMs) {
    return ['The window is entirely outside the plan.'];
  }
  return [
    ...(w.startMs < plan.startMs ? ['The window starts before the plan.'] : []),
    ...(w.endMs > plan.endMs ? ['The window ends after the plan.'] : []),
  ];
}

/** The part of `w` inside the plan, or null when nothing of it is. */
export function fitToPlan(w: Interval, plan: Interval): Interval | null {
  const fitted = { endMs: Math.min(w.endMs, plan.endMs), startMs: Math.max(w.startMs, plan.startMs) };
  return fitted.endMs > fitted.startMs ? fitted : null;
}

// ── Exploratory pass search ───────────────────────────────────────────────────────────────

export type Pass = { km: number; ms: number };
export type PassSearch = {
  /** Local minima found in the interval, before `keep`. */
  minima: number;
  missing: number;
  /** Up to `keep` closest local minima, closest first. */
  passes: Pass[];
  samples: number;
  stepMs: number;
};

/** Great-circle distance on a sphere of `radiusKm` between a lat/lon and the sub-point of a body-fixed position. */
export function groundKm(
  target: { latDeg: number; lonDeg: number },
  position: readonly [number, number, number],
  radiusKm: number,
) {
  const lat = (target.latDeg * Math.PI) / 180;
  const lon = (target.lonDeg * Math.PI) / 180;
  const t = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const dot = (t[0] * position[0] + t[1] * position[1] + t[2] * position[2]) / Math.hypot(...position);
  return radiusKm * Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Sampled local closest approaches of a vehicle's sub-point to a surface location, from `positionAt` (body-fixed
 * km, or null where the scene has no position). Coarse samples every `stepMs`; each local minimum is re-sampled
 * every second within one step of it. Exploratory: sampled, spherical, geometric positions. The mission goal
 * repeats its own search authoritatively. Minima at the interval's edges or beside a coverage gap are not reported.
 */
export async function findPasses(
  positionAt: (ms: number) => readonly [number, number, number] | null,
  target: { latDeg: number; lonDeg: number },
  radiusKm: number,
  { endMs, startMs }: Interval,
  { keep = 5, maxSamples = 20_000, stepMs = 30_000 } = {},
): Promise<PassSearch> {
  stepMs = Math.max(stepMs, Math.ceil((endMs - startMs) / maxSamples / 1000) * 1000);
  const at = (ms: number) => {
    const p = positionAt(ms);
    return p ? groundKm(target, p, radiusKm) : null;
  };
  const coarse: (number | null)[] = [];
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    coarse.push(at(ms));
    if (coarse.length % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve)); // keep the page responsive
    }
  }
  const minima: Pass[] = [];
  for (let i = 1; i < coarse.length - 1; i++) {
    const [a, b, c] = [coarse[i - 1], coarse[i], coarse[i + 1]];
    if (a !== null && b !== null && c !== null && b < a && b <= c) {
      let best = { km: b, ms: startMs + i * stepMs };
      const from = best.ms - stepMs;
      for (let ms = from; ms <= from + 2 * stepMs; ms += 1000) {
        const km = at(ms);
        if (km !== null && km < best.km) {
          best = { km, ms };
        }
      }
      minima.push(best);
    }
  }
  return {
    minima: minima.length,
    missing: coarse.filter(d => d === null).length,
    passes: minima.sort((x, y) => x.km - y.km).slice(0, keep),
    samples: coarse.length,
    stepMs,
  };
}

// ── What PlanDev decided ──────────────────────────────────────────────────────────────────

export type TargetOutcome = {
  state: 'staged' | 'changed' | 'running' | 'planned' | 'not-planned' | 'rejected' | 'run-failed' | 'unknown';
  text: string;
};

/**
 * A staged target's standing, from data PlanDev already keeps: whether the latest scheduling request evaluated the
 * current scheduling specification revision (any goal edit bumps it), its status and reason, and whether an
 * observation from this goal invocation exists for the target (`hasObservation`, by the goal's directive name).
 * PlanDev keeps no per-target snapshot of a run's inputs, so an observation planned before the latest edit is never
 * reported as the outcome of the current inputs, and a failed run counts as this target's rejection only when its
 * reason names the target.
 */
export function targetOutcome(
  id: string,
  ctx: {
    hasObservation: boolean;
    request: {
      analysis_id: number;
      canceled?: boolean;
      reason: unknown;
      specification_revision: number;
      status: string;
    } | null;
    specRevision: number | null | undefined;
  },
): TargetOutcome {
  const { hasObservation, request, specRevision } = ctx;
  if (specRevision === null || specRevision === undefined) {
    return { state: 'unknown', text: 'Outcome unknown: the scheduling specification is not loaded.' };
  }
  if (!request || request.specification_revision !== specRevision) {
    return hasObservation
      ? {
          state: 'changed',
          text: 'Changed since last run: the existing observation came from earlier inputs; these are not evaluated yet.',
        }
      : { state: 'staged', text: 'Staged: not evaluated yet.' };
  }
  const run = `run #${request.analysis_id}`;
  if (request.status === 'pending' || request.status === 'incomplete') {
    return { state: 'running', text: `Evaluating in ${run}…` };
  }
  if (request.status === 'success' && !request.canceled) {
    return hasObservation
      ? { state: 'planned', text: `Planned in ${run}` }
      : { state: 'not-planned', text: `Not planned in ${run}: no observation was created.` };
  }
  const reason = String(
    (request.reason as { message?: string } | null)?.message ?? (request.canceled ? 'canceled' : ''),
  );
  const kept = hasObservation ? ' The existing observation is unchanged.' : '';
  const named = new RegExp(`target ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s:])[:\\s]*`);
  if (named.test(reason)) {
    return { state: 'rejected', text: `Rejected in ${run}: ${reason.replace(named, '')}${kept}` };
  }
  return { state: 'run-failed', text: `${run} failed, not because of this target: ${reason}${kept}` };
}
