/**
 * PlanDev side of the Cosmolabe 3D panel: which mission scene a plan's model has, PlanDev simulated
 * activities as Cosmolabe host activities, and proposals (a location and/or a time window) coming back
 * from the 3D view. Everything mission-specific lives in the mission's adapter, served with its catalog
 * (plandev-examples/integrations/cosmolabe), not here.
 *
 * Authority: a proposal is only an input. It is staged into a mission scheduling goal, and the goal
 * (the mission model's own geometry and kernels) decides whether it can be planned.
 */
import type {
  AttitudeConvention,
  HostDataAdapter,
  HostObservationSpec,
  MissionActivitySpec,
  MissionStateSource,
  PositionConvention,
} from '@cosmolabe/viewer';
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

/**
 * Vehicles whose state comes from the simulation rather than from kernels: which resource holds each vehicle's
 * state, its conventions, and how one profile value reads as a sample.
 */
export type CosmolabeMissionState = {
  attitude: Omit<AttitudeConvention, 'maxSampleSpacing'>;
  position: Omit<PositionConvention, 'maxSampleSpacing'>;
  resource(vehicle: string): string;
  sample(value: unknown): { position: number[]; quaternion: number[]; velocity: number[] };
  vehicles: string[];
};

/**
 * Instruments whose activity is a simulation resource: per vehicle, the scene's Sensor body and the resource, and
 * how one resource value reads as a state. The viewer draws a sensor's FOV while it is acquiring (or inspected).
 */
export type CosmolabeSensors = {
  resource(vehicle: string): string;
  sensor(vehicle: string): string;
  state(value: unknown): 'acquiring' | 'off' | 'standby';
};

/**
 * A goal whose destination is a surface point: which goal and which of its arguments take the point, in what
 * coordinates. A point picked in the 3D view fills them (after the operator asks); scheduling decides.
 */
export type CosmolabeDestination = {
  /** Goal argument names for planetocentric latitude and east longitude, degrees. */
  arguments: { latitude: string; longitude: string };
  body: string;
  conventions: string;
  /** The goal's coordinate convention, for drawing the destination in the scene. */
  coordinates: Record<string, unknown>;
  /** The body-fixed frame the goal's coordinates are in; a point in another frame is refused. */
  frame: string;
  goal: string;
  label: string;
};

/** The mission adapter module (missions/<key>/adapter.js); see plandev-examples/integrations/cosmolabe. */
export type CosmolabeAdapter = {
  body: string;
  destination?: CosmolabeDestination;
  missionState?: CosmolabeMissionState;
  sensors?: CosmolabeSensors;
  /** Absent: the mission takes no proposals from the 3D view. */
  targets?: {
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
  /** The vehicle a simulated activity belongs to; `vehicle` when absent or null. */
  vehicleOf?(span: Span): string | null;
  /**
   * What the mission evaluated for a selected activity (e.g. survey image footprints and the target they were asked
   * to cover), as read-only Cosmolabe observations, with what to show when the operator picks one in the scene.
   */
  observations?: {
    body: string;
    legend?: { color: string; text: string }[];
    /**
     * `ctx.parentOf` / `ctx.childrenOf`: the simulation's span hierarchy, so a child span (e.g. one exposure of a
     * survey) can return its parent's observation focused on its own footprint.
     */
    of(
      span: Span,
      ctx: { datasetId: number; planId: number; childrenOf(span: Span): Span[]; parentOf(span: Span): Span | null },
    ): CosmolabeObservation[];
  };
};

/** One mission-evaluated observation for the scene, with the details shown when its parts are picked. */
export type CosmolabeObservation = {
  /** The footprint the selected span is (when the selection is one exposure). */
  focus?: number | null;
  /** Per footprint, the simulated span of that exposure (a child activity), when there is one. */
  footprintSpans?: (number | null)[];
  /** Per footprint (same order as the spec's polygons): a title, its exposure time (ISO UTC), and rows to show. */
  footprints: { rows: [string, string][]; time: string; title: string }[];
  /** The requested region (survey target), when the spec has one. */
  region?: { note?: string; rows: [string, string][]; title: string } | null;
  spec: HostObservationSpec;
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
  ctx: {
    body: string;
    datasetId: number;
    planId: number;
    planName: string;
    vehicle: string;
    vehicleOf?: (span: Span) => string | null;
  },
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
        vehicle: ctx.vehicleOf?.(span) ?? ctx.vehicle,
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

// ── Simulated vehicle state ──────────────────────────────────────────────────────────────

/**
 * One discrete profile segment: the value holds from `startMs` until the next segment (or the simulation end). A
 * `null` value is a gap in the profile (PlanDev's `is_gap`, or no value): the vehicle has no state there.
 */
export type StateSegment = { startMs: number; value: unknown };

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Position and attitude samples for one vehicle from its simulated state profile. Each segment gives a sample at
 * its start; a segment held longer than `holdS` (a vehicle parked between flights) is also sampled every `holdStepS`
 * and 1 ms before the next segment, so the hold is drawn as a hold and the change happens at the next segment.
 *
 * Gaps stay gaps: a gap segment, or a value that does not read as finite numbers, gives no samples, and
 * `maxSpacingS` (the longest spacing between samples this function intends to be interpolated) is what the source
 * declares, so the scene shows no state across a gap rather than inventing motion through it.
 * ponytail: a gap shorter than `holdStepS` is still bridged (one interpolation limit per channel); a coverage list
 * with holes in the MissionState API would close that.
 */
export function stateSamples(
  segments: StateSegment[],
  endMs: number,
  ms: CosmolabeMissionState,
  { holdS = 2, holdStepS = 10 }: { holdS?: number; holdStepS?: number } = {},
) {
  const position: { position: number[]; t: string; velocity: number[] }[] = [];
  const attitude: { quaternion: number[]; t: string }[] = [];
  let gaps = 0;
  segments.forEach((seg, i) => {
    const s = seg.value == null ? null : ms.sample(seg.value);
    const ok =
      s &&
      [...s.position, ...s.velocity, ...s.quaternion].every(Number.isFinite) &&
      s.position.length === 3 &&
      s.quaternion.length === 4;
    if (!s || !ok) {
      gaps++;
      return;
    }
    const next = segments[i + 1]?.startMs ?? endMs;
    const times = [seg.startMs];
    if (next - seg.startMs > holdS * 1000) {
      for (let t = seg.startMs + holdStepS * 1000; t < next - 1; t += holdStepS * 1000) {
        times.push(t);
      }
      times.push(next - 1);
    }
    for (const t of times) {
      position.push({ position: s.position, t: iso(t), velocity: s.velocity });
      attitude.push({ quaternion: s.quaternion, t: iso(t) });
    }
  });
  return { attitude, gaps, maxSpacingS: Math.max(holdS, holdStepS), position };
}

/**
 * A MissionStateSource holding one vehicle's samples from one simulation dataset, classified as planned. Every
 * request is answered with all of them for the simulation's span; neighbouring samples are interpolated only within
 * `maxSpacingS`, so a gap in the profile is a gap in the scene.
 */
export function simulatedStateSource(
  id: string,
  samples: ReturnType<typeof stateSamples>,
  ms: CosmolabeMissionState,
  span: { datasetId: number; endMs: number; planId: number; startMs: number },
  adapter: HostDataAdapter,
): MissionStateSource {
  // Interpolate only between samples `stateSamples` meant to be neighbours: never across a gap.
  const spacing = samples.maxSpacingS + 0.001;
  const window = { end: iso(span.endMs), start: iso(span.startMs) };
  const provenance = (kind: 'trajectory' | 'attitude') => ({
    classification: 'planned' as const,
    id: `plandev:plan/${span.planId}/simulation_dataset/${span.datasetId}/${id}/${kind}`,
    kind,
    source: `PlanDev simulation dataset ${span.datasetId} (plan ${span.planId}), resource ${ms.resource(id)}`,
    version: String(span.datasetId),
  });
  return {
    attitude: { ...ms.attitude, maxSampleSpacing: spacing },
    coverage: { attitude: window, position: window },
    id,
    maxSamples: Math.max(10_000, samples.position.length + 10),
    position: { ...ms.position, maxSampleSpacing: spacing },
    async request(channel) {
      return channel === 'position'
        ? adapter.supply({ samples: samples.position, window }, provenance('trajectory'))
        : adapter.supply({ samples: samples.attitude, window }, provenance('attitude'));
    },
  };
}

/**
 * A discrete resource profile (segments: start and value, null for a gap) as sensor state intervals up to `endMs`.
 * A gap is no interval: the viewer then reports the sensor's state as unknown, never as acquiring.
 */
export function sensorIntervals(
  segments: { startMs: number; value: unknown }[],
  endMs: number,
  state: CosmolabeSensors['state'],
): { end: string; start: string; state: 'acquiring' | 'off' | 'standby' }[] {
  return segments.flatMap((seg, i) => {
    const next = segments[i + 1]?.startMs ?? endMs;
    return seg.value === null || seg.value === undefined || !(next > seg.startMs)
      ? []
      : [{ end: iso(next), start: iso(seg.startMs), state: state(seg.value) }];
  });
}

/** Planetocentric latitude / east longitude as the operator copies them: "lat, lon" to 5 decimals (≈0.3 m on the Moon). */
export function formatLatLon(p: { latDeg: number; lonDeg: number }): string {
  return `${p.latDeg.toFixed(5)}, ${p.lonDeg.toFixed(5)}`;
}

/**
 * Why a picked point cannot be a destination: another body, or a body-fixed frame other than the goal's (the
 * viewer's probe reports its frame; coordinates in a different one would silently mean another place).
 */
export function destinationProblems(
  d: CosmolabeDestination,
  p: { body: string; frame: string; latDeg: number; lonDeg: number },
): string[] {
  const out: string[] = [];
  if (p.body !== d.body) {
    out.push(`The ${d.label.toLowerCase()} must be on ${d.body}, not ${p.body}.`);
  }
  if (p.frame !== d.frame) {
    out.push(`The point is in ${p.frame}; ${d.goal} takes ${d.frame} coordinates.`);
  }
  if (!(Math.abs(p.latDeg) <= 90) || !(Math.abs(p.lonDeg) <= 180)) {
    out.push('Latitude/longitude out of range.');
  }
  return out;
}

/** The goal's arguments with the destination replaced; every other argument kept. */
export function withDestination(
  d: CosmolabeDestination,
  args: unknown,
  p: { latDeg: number; lonDeg: number },
): Record<string, unknown> {
  return {
    ...((args as Record<string, unknown>) ?? {}),
    [d.arguments.latitude]: +p.latDeg.toFixed(6),
    [d.arguments.longitude]: +p.lonDeg.toFixed(6),
  };
}

/** The destination currently in the goal's arguments, or null. */
export function destinationOf(d: CosmolabeDestination, args: unknown): { latDeg: number; lonDeg: number } | null {
  const a = (args as Record<string, unknown>) ?? {};
  const latDeg = Number(a[d.arguments.latitude]),
    lonDeg = Number(a[d.arguments.longitude]);
  return a[d.arguments.latitude] != null && Number.isFinite(latDeg) && Number.isFinite(lonDeg)
    ? { latDeg, lonDeg }
    : null;
}
