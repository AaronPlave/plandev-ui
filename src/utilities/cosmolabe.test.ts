import { describe, expect, it, test } from 'vitest';
import type { Span } from '../types/simulation';
import {
  activityId,
  destinationOf,
  destinationProblems,
  findPasses,
  formatLatLon,
  fitToPlan,
  groundKm,
  planetocentric,
  resolveMission,
  selectionAction,
  sensorIntervals,
  simulatedStateSource,
  spanIdOf,
  spansToActivities,
  stateSamples,
  targetOutcome,
  windowProblems,
  withDestination,
} from './cosmolabe';

const span = (span_id: number, startMs: number, endMs: number, type = 'Periapsis') =>
  ({ attributes: { arguments: {}, computedAttributes: {} }, endMs, span_id, startMs, type }) as unknown as Span;

describe('cosmolabe', () => {
  test('resolves a mission by model name, with URLs relative to the index', () => {
    const index = {
      missions: { mro: { adapter: 'mro/adapter.js', catalog: 'mro/catalog.json', label: 'MRO', models: ['orbiter'] } },
      version: 1 as const,
    };
    expect(resolveMission(index, 'http://host:8890/missions/index.json', 'orbiter')).toEqual({
      adapterUrl: 'http://host:8890/missions/mro/adapter.js',
      catalogUrl: 'http://host:8890/missions/mro/catalog.json',
      key: 'mro',
      label: 'MRO',
    });
    expect(resolveMission(index, 'http://host/i.json', 'rover')).toBeNull();
    expect(resolveMission(index, 'http://host/i.json', undefined)).toBeNull();
  });

  test('activity ids name one span of one plan and dataset, and nothing else', () => {
    const id = activityId(86, 217, 1109);
    expect(spanIdOf(id, 86, 217)).toBe(1109);
    // Span ids are per dataset: the same span id in another dataset or plan is not this activity.
    expect(spanIdOf(id, 86, 219)).toBeNull();
    expect(spanIdOf(id, 8, 217)).toBeNull();
    expect(spanIdOf(activityId(86, 21, 7), 86, 2)).toBeNull();
    // Scene activities from a catalog are never PlanDev selections.
    expect(spanIdOf('curiosity:dingo-crossing', 86, 217)).toBeNull();
    expect(spanIdOf(null, 86, 217)).toBeNull();
  });

  test('spans become host activities: instants, intervals, provenance', () => {
    const t = Date.UTC(2024, 0, 2, 9, 27, 15);
    const [instant, interval, ...rest] = spansToActivities(
      [span(1, t, t), span(2, t, t + 300_000, 'TakeRadarObservation'), span(3, t, t - 1), span(4, NaN, NaN)],
      { body: 'Mars', datasetId: 217, planId: 86, planName: 'Plan', vehicle: 'MRO' },
    );
    expect(rest).toEqual([]);
    expect(instant).toMatchObject({
      id: 'plandev:plan/86/dataset/217/span/1',
      start: '2024-01-02T09:27:15.000Z',
      temporality: 'instant',
      timeSystem: 'UTC',
      vehicle: 'MRO',
    });
    expect(interval).toMatchObject({
      end: '2024-01-02T09:32:15.000Z',
      name: 'TakeRadarObservation',
      temporality: 'interval',
    });
    expect(interval.provenance.source).toBe('plandev:plan/86/simulation_dataset/217');
  });

  test('planetocentric latitude and east longitude from a body-fixed position', () => {
    const r = 3396.19;
    const p = planetocentric([0, -r * Math.cos(Math.PI / 6), r * Math.sin(Math.PI / 6)]);
    expect(p.latDeg).toBeCloseTo(30, 9);
    expect(p.lonDeg).toBeCloseTo(-90, 9);
    // On an oblate body a geodetic latitude reads higher than the planetocentric one the goals take.
    const geodetic = (18.742 * Math.PI) / 180;
    const [a, b] = [3396.19, 3376.2];
    const n = a / Math.sqrt(1 - (1 - (b * b) / (a * a)) * Math.sin(geodetic) ** 2);
    const xyz = [n * Math.cos(geodetic), 0, n * ((b * b) / (a * a)) * Math.sin(geodetic)] as const;
    expect(planetocentric(xyz).latDeg).toBeLessThan(18.742);
    expect(planetocentric(xyz).latDeg).toBeCloseTo(18.537, 2);
    expect(planetocentric([-1, -1e-12, 0]).lonDeg).toBeCloseTo(-180, 9);
  });

  test('UTC ↔ ET through the Cosmolabe package conversion, leap seconds included', async () => {
    const { etFromCalendarString, etToDate } = await import('@cosmolabe/viewer');
    // 2024-01-02T00:00:00Z = 757425669.184 s TDB past J2000 (ΔAT 37 s + 32.184 s)
    expect(etFromCalendarString('2024-01-02T00:00:00.000Z')).toBeCloseTo(757425669.184, 3);
    const ms = Date.UTC(2024, 0, 2, 8, 52, 29, 999);
    expect(etToDate(etFromCalendarString(new Date(ms).toISOString())).getTime()).toBe(ms);
  });

  test('selection: plan + dataset + span identity, clearing, no echo, scene selections left alone', () => {
    const a = activityId(86, 217, 5);
    // The same span id in another dataset or another plan is a different activity: the viewer must reselect.
    expect(selectionAction(activityId(86, 219, 5), a)).toEqual({ id: activityId(86, 219, 5), kind: 'select' });
    expect(selectionAction(activityId(87, 217, 5), a)).toEqual({ id: activityId(87, 217, 5), kind: 'select' });
    // Already selected (e.g. the viewer's own selection coming back through PlanDev): nothing, so no echo loop.
    expect(selectionAction(a, a)).toBeNull();
    // Clearing PlanDev's selection clears the PlanDev activity in the viewer…
    expect(selectionAction(null, a)).toEqual({ kind: 'clear' });
    expect(selectionAction(null, null)).toBeNull();
    expect(selectionAction(null, undefined)).toBeNull();
    // …but never a scene activity from the catalog, which PlanDev did not select.
    expect(selectionAction(null, 'curiosity:dingo-crossing')).toBeNull();
    // Viewer-originated selection maps back only to this plan and dataset.
    expect(spanIdOf(activityId(86, 217, 5), 86, 219)).toBeNull();
  });

  test('windows: inside the plan, non-empty, finite; fitting is explicit', () => {
    const plan = { endMs: 1000, startMs: 0 };
    expect(windowProblems({ endMs: 900, startMs: 100 }, plan)).toEqual([]);
    expect(windowProblems({ endMs: 900, startMs: -100 }, plan)).toEqual(['The window starts before the plan.']);
    expect(windowProblems({ endMs: 1100, startMs: 100 }, plan)).toEqual(['The window ends after the plan.']);
    expect(windowProblems({ endMs: 1100, startMs: -1 }, plan)).toHaveLength(2);
    expect(windowProblems({ endMs: 100, startMs: 100 }, plan)).toEqual(['The window is empty or reversed.']);
    expect(windowProblems({ endMs: 50, startMs: 100 }, plan)).toEqual(['The window is empty or reversed.']);
    expect(windowProblems({ endMs: 3000, startMs: 2000 }, plan)).toEqual(['The window is entirely outside the plan.']);
    expect(windowProblems({ endMs: NaN, startMs: 100 }, plan)).toEqual(['The window is not a valid time range.']);
    expect(fitToPlan({ endMs: 1100, startMs: -100 }, plan)).toEqual(plan);
    expect(fitToPlan({ endMs: 3000, startMs: 2000 }, plan)).toBeNull();
  });

  test('pass search: sampled local minima of the sub-point distance, coverage gaps not invented', async () => {
    const R = 3389.5;
    const periodMs = 2 * 3600_000;
    // A polar orbit over longitude 0 at 300 km altitude: the sub-point crosses the equator going north at t = 0.
    const orbit = (ms: number) => {
      const u = (2 * Math.PI * ms) / periodMs;
      return [(R + 300) * Math.cos(u), 0, (R + 300) * Math.sin(u)] as const;
    };
    const target = { latDeg: 30, lonDeg: 0.5 };
    const day = { endMs: 24 * 3600_000, startMs: 0 };
    const all = await findPasses(orbit, target, R, day);
    expect(all.missing).toBe(0);
    // The closest sub-point is (30°, 0°): half a degree of longitude away.
    expect(all.passes[0].km).toBeCloseTo(groundKm(target, [Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6)], R), 1);
    expect(all.passes[0].km).toBeLessThan(30);
    // Refined to a second: the true minimum is at latitude 30°, a twelfth of the orbit after each ascending node.
    expect((all.passes[0].ms % periodMs) / 1000).toBeCloseTo(periodMs / 12 / 1000, -1);
    // No position: no candidate (never a fabricated one), and the gap is reported.
    const none = await findPasses(() => null, target, R, day);
    expect(none.passes).toEqual([]);
    expect(none.missing).toBe(none.samples);
    // A minimum beside a gap is not reported as a pass.
    const gappy = await findPasses(ms => (ms % periodMs < periodMs / 6 ? null : orbit(ms)), target, R, day);
    expect(gappy.passes.every(p => p.km > 1000)).toBe(true);
  });

  test('outcome: staged vs evaluated, from the specification revision; a failed run is not every target’s rejection', () => {
    const run = (status: string, rev: number, message = '') => ({
      analysis_id: 9,
      reason: message ? { message } : null,
      specification_revision: rev,
      status,
    });
    const at = (hasObservation: boolean, request: ReturnType<typeof run> | null, specRevision = 4) =>
      targetOutcome('cosmo-1', { hasObservation, request, specRevision }).state;
    expect(at(false, null)).toBe('staged');
    expect(at(false, run('success', 2))).toBe('staged');
    // An observation exists, but the inputs were edited after the run that planned it.
    expect(at(true, run('success', 2))).toBe('changed');
    expect(at(true, run('success', 4))).toBe('planned');
    expect(at(false, run('success', 4))).toBe('not-planned');
    expect(at(true, run('pending', 4))).toBe('running');
    const rejected = targetOutcome('cosmo-1', {
      hasObservation: true,
      request: run('failed', 4, 'target cosmo-1 not scheduled: closest … is 8431 km; limit 100 km'),
      specRevision: 4,
    });
    expect(rejected.state).toBe('rejected');
    expect(rejected.text).toMatch(/^Rejected in run #9: not scheduled: closest/);
    expect(rejected.text).toMatch(/existing observation is unchanged/);
    // Another target's rejection, or a run error, is not this target's.
    expect(at(false, run('failed', 4, 'target cosmo-10 not scheduled: …'))).toBe('run-failed');
    expect(at(false, run('failed', 4, 'scheduler worker crashed'))).toBe('run-failed');
    expect(at(false, run('failed', 4, 'target cosmo-1: search window … is empty or outside the plan'))).toBe(
      'rejected',
    );
    expect(at(false, null, null as unknown as number)).toBe('unknown');
  });
});

describe('simulated vehicle state', () => {
  const ms = {
    attitude: {
      bodyFrame: 'B',
      direction: 'reference-to-body',
      quaternionOrder: 'scalar-first',
      referenceFrame: 'F',
      timeScale: 'UTC',
    },
    position: { center: 'Moon', frame: 'F', positionUnits: 'km', timeScale: 'UTC', velocityUnits: 'km/s' },
    resource: (v: string) => `${v}.state`,
    sample: (v: unknown) => {
      const x = v as { q: number[]; r: number[]; v: number[] };
      return { position: x.r, quaternion: x.q, velocity: x.v };
    },
    vehicles: ['D'],
  } as const;
  const t0 = Date.parse('2028-12-15T10:00:00Z');
  const landed = { q: [1, 0, 0, 0], r: [0, 0, -1737], v: [0, 0, 0] };
  const flying = (k: number) => ({ q: [0, 1, 0, 0], r: [k, 0, -1737], v: [1, 0, 0] });

  test('holds a parked state until the next segment and samples a flight at its segments', () => {
    const segs = [
      { startMs: t0, value: landed },
      { startMs: t0 + 30_000, value: flying(0) },
      { startMs: t0 + 31_000, value: flying(1) },
      { startMs: t0 + 32_000, value: landed },
    ];
    const s = stateSamples(segs, t0 + 52_000, ms as never);
    expect(s.position.map(p => p.t)).toEqual([
      '2028-12-15T10:00:00.000Z',
      '2028-12-15T10:00:10.000Z', // a hold is sampled every 10 s…
      '2028-12-15T10:00:20.000Z',
      '2028-12-15T10:00:29.999Z', // …and held to 1 ms before lift-off
      '2028-12-15T10:00:30.000Z',
      '2028-12-15T10:00:31.000Z',
      '2028-12-15T10:00:32.000Z',
      '2028-12-15T10:00:42.000Z',
      '2028-12-15T10:00:51.999Z',
    ]);
    expect(s.attitude[3].quaternion).toEqual([1, 0, 0, 0]);
    expect(s.attitude[4].quaternion).toEqual([0, 1, 0, 0]);
    expect(s.maxSpacingS).toBe(10);
    expect(s.gaps).toBe(0);
  });

  test('a gap in the profile stays a gap: no samples in it, and no interpolation across it', () => {
    const segs = [
      { startMs: t0, value: flying(0) },
      { startMs: t0 + 1_000, value: null }, // PlanDev is_gap
      { startMs: t0 + 60_000, value: { q: [1, 0, 0, 0], r: [NaN, 0, 0], v: [0, 0, 0] } }, // unreadable
      { startMs: t0 + 61_000, value: flying(5) },
    ];
    const s = stateSamples(segs, t0 + 62_000, ms as never);
    expect(s.gaps).toBe(2);
    expect(s.position.map(p => p.t)).toEqual(['2028-12-15T10:00:00.000Z', '2028-12-15T10:01:01.000Z']);
    // The 61 s between them is far beyond the interpolation limit the source declares.
    const src = simulatedStateSource(
      'D',
      s,
      ms as never,
      { datasetId: 7, endMs: t0 + 62_000, planId: 3, startMs: t0 },
      {} as never,
    );
    expect(src.position?.maxSampleSpacing).toBeLessThan(61);
    expect(src.attitude?.maxSampleSpacing).toBeLessThan(61);
  });

  test('answers every request with all samples, planned, complete for the simulation', async () => {
    const samples = stateSamples([{ startMs: t0, value: landed }], t0 + 60_000, ms as never);
    const host = { supply: (value: unknown, provenance: unknown) => ({ provenance, value }) };
    const src = simulatedStateSource(
      'D',
      samples,
      ms as never,
      { datasetId: 7, endMs: t0 + 60_000, planId: 3, startMs: t0 },
      host as never,
    );
    expect(src.coverage?.position).toEqual({ end: '2028-12-15T10:01:00.000Z', start: '2028-12-15T10:00:00.000Z' });
    expect(src.position?.maxSampleSpacing).toBeCloseTo(10, 2);
    const b = (await src.request!(
      'position',
      { end: 0, start: 0 } as never,
      new AbortController().signal,
    )) as unknown as {
      provenance: { classification: string; version: string };
      value: { samples: unknown[] };
    };
    expect(b.provenance.classification).toBe('planned');
    expect(b.provenance.version).toBe('7');
    expect(b.value.samples).toHaveLength(7); // a 60 s park, sampled every 10 s and at its end
  });
});

describe('sensor activity from a simulation resource', () => {
  const on = (v: unknown) => (v ? 'acquiring' : 'off') as 'acquiring' | 'off';
  it('turns a discrete profile into state intervals, a gap into no interval', () => {
    const t0 = Date.parse('2028-12-15T11:00:00Z');
    const out = sensorIntervals(
      [
        { startMs: t0, value: false },
        { startMs: t0 + 37_000, value: true },
        { startMs: t0 + 75_000, value: null },
        { startMs: t0 + 80_000, value: false },
      ],
      t0 + 100_000,
      on,
    );
    expect(out).toEqual([
      { end: '2028-12-15T11:00:37.000Z', start: '2028-12-15T11:00:00.000Z', state: 'off' },
      { end: '2028-12-15T11:01:15.000Z', start: '2028-12-15T11:00:37.000Z', state: 'acquiring' },
      { end: '2028-12-15T11:01:40.000Z', start: '2028-12-15T11:01:20.000Z', state: 'off' },
    ]);
  });
});

describe('surface point as a goal destination', () => {
  const d = {
    arguments: { latitude: 'latitude', longitude: 'longitude' },
    body: 'Moon',
    conventions: 'MOON_ME_DE421 planetocentric',
    coordinates: {},
    frame: 'MOON_ME_DE421',
    goal: 'PlanHop',
    label: 'Hop destination',
  };
  it('keeps planetocentric coordinates (not geodetic) from the body-fixed point', () => {
    // A point at planetocentric -89.62°, -30° on a 1736 km radius: z / hypot(x, y) gives the latitude directly.
    const lat = (-89.62 * Math.PI) / 180,
      lon = (-30 * Math.PI) / 180,
      r = 1736.2;
    const p = planetocentric([r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)]);
    expect(p.latDeg).toBeCloseTo(-89.62, 9);
    expect(p.lonDeg).toBeCloseTo(-30, 9);
    expect(formatLatLon(p)).toBe('-89.62000, -30.00000');
  });
  it('fills only the destination arguments and reads them back', () => {
    const args = { drone: 'Polaris-A', latitude: -89.7, longitude: 0, surveyFrames: 20 };
    const next = withDestination(d, args, { latDeg: -89.623456789, lonDeg: -30.1234567 });
    expect(next).toEqual({ drone: 'Polaris-A', latitude: -89.623457, longitude: -30.123457, surveyFrames: 20 });
    expect(destinationOf(d, next)).toEqual({ latDeg: -89.623457, lonDeg: -30.123457 });
    expect(destinationOf(d, {})).toBeNull();
  });
  it('refuses a point on another body or in another body-fixed frame', () => {
    expect(destinationProblems(d, { body: 'Moon', frame: 'MOON_ME_DE421', latDeg: -89.6, lonDeg: -30 })).toEqual([]);
    expect(destinationProblems(d, { body: 'Moon', frame: 'IAU_MOON', latDeg: -89.6, lonDeg: -30 })[0]).toMatch(
      /IAU_MOON/,
    );
    expect(destinationProblems(d, { body: 'Earth', frame: 'IAU_EARTH', latDeg: 0, lonDeg: 0 }).length).toBe(2);
  });
});
