import { describe, expect, test } from 'vitest';
import type { ValueSchema } from '../types/schema';
import type { Profile, ProfileSegment, Resource, ResourceValue } from '../types/simulation';
import {
  formatResourceNumber,
  formatResourceValue,
  getResourceSparkline,
  getResourceValueAtTime,
  getResourceWindowStats,
  sampleProfiles,
} from './resources';

const START = '2024-01-01T00:00:00';
const startMs = new Date(START).getTime();

type DiscreteSeg = { is_gap?: boolean; start_offset: string; value: any };
type RealSeg = { initial: number; is_gap?: boolean; rate: number; start_offset: string };

function makeSegment(start_offset: string, dynamics: any, is_gap = false): ProfileSegment {
  return { dataset_id: 1, dynamics, is_gap, profile_id: 1, start_offset };
}

function discreteProfile(duration: string, segments: DiscreteSeg[]): Profile {
  return {
    dataset_id: 1,
    duration,
    id: 1,
    name: 'r',
    profile_segments: segments.map(s => makeSegment(s.start_offset, s.value, s.is_gap)),
    type: { schema: { type: 'string' } as any, type: 'discrete' },
  };
}

function realProfile(duration: string, segments: RealSeg[]): Profile {
  return {
    dataset_id: 1,
    duration,
    id: 1,
    name: 'r',
    profile_segments: segments.map(s => makeSegment(s.start_offset, { initial: s.initial, rate: s.rate }, s.is_gap)),
    type: { schema: { type: 'real' } as any, type: 'real' },
  };
}

describe('sampleProfiles', () => {
  test('Calculate the correct y-value for real profile segment rate of change', () => {
    const profiles: Profile[] = [
      {
        dataset_id: 1,
        duration: '384:00:00',
        id: 1,
        name: '/simple_data/b/volume',
        profile_segments: [
          {
            dataset_id: 1,
            dynamics: { initial: 0, rate: 0 },
            is_gap: false,
            profile_id: 1,
            start_offset: '00:00:00',
          },
          {
            dataset_id: 1,
            dynamics: { initial: 0, rate: 5 },
            is_gap: false,
            profile_id: 1,
            start_offset: '2 days 19:40:54.345',
          },
          {
            dataset_id: 1,
            dynamics: { initial: 566834.75, rate: 0 },
            is_gap: false,
            profile_id: 1,
            start_offset: '4 days 03:10:21.295',
          },
        ],
        type: {
          schema: {
            items: { initial: { type: 'real' }, rate: { type: 'real' } },
            type: 'struct',
          },
          type: 'real',
        },
      },
      {
        dataset_id: 1,
        duration: '384:00:00',
        id: 2,
        name: '/simple_data/activities_executed',
        profile_segments: [
          {
            dataset_id: 1,
            dynamics: 0,
            is_gap: false,
            profile_id: 2,
            start_offset: '00:00:00',
          },
          {
            dataset_id: 1,
            dynamics: 2,
            is_gap: false,
            profile_id: 2,
            start_offset: '2 days 19:40:54.345',
          },
          {
            dataset_id: 1,
            dynamics: 4,
            is_gap: false,
            profile_id: 2,
            start_offset: '4 days 03:10:21.295',
          },
        ],
        type: {
          schema: { type: 'int' },
          type: 'discrete',
        },
      },
    ];

    const resources: Resource[] = sampleProfiles(profiles, '2022-09-01T00:00:00+00:00');

    const expectedResources: Resource[] = [
      {
        name: '/simple_data/b/volume',
        schema: {
          items: { initial: { type: 'real' }, rate: { type: 'real' } },
          type: 'struct',
        },
        values: [
          { is_gap: false, x: 1661990400000, y: 0 },
          { is_gap: false, x: 1662234054345, y: 0 },
          { is_gap: false, x: 1662234054345, y: 0 },
          { is_gap: false, x: 1662347421295, y: 566834.75 },
          { is_gap: false, x: 1662347421295, y: 566834.75 },
          { is_gap: false, x: 1663372800000, y: 566834.75 },
        ],
      },
      {
        name: '/simple_data/activities_executed',
        schema: { type: 'int' },
        values: [
          { is_gap: false, x: 1661990400000, y: 0 },
          { is_gap: false, x: 1662234054345, y: 0 },
          { is_gap: false, x: 1662234054345, y: 2 },
          { is_gap: false, x: 1662347421295, y: 2 },
          { is_gap: false, x: 1662347421295, y: 4 },
          { is_gap: false, x: 1663372800000, y: 4 },
        ],
      },
    ];

    expect(resources).toEqual(expectedResources);
  });

  test('returns [] when profiles is null', () => {
    expect(sampleProfiles(null, START)).toEqual([]);
  });

  test('returns [] when startTimeYmd is null', () => {
    expect(sampleProfiles([discreteProfile('00:01:00', [])], null)).toEqual([]);
  });

  test('returns one resource with empty values for a profile with no segments', () => {
    const result = sampleProfiles([discreteProfile('00:01:00', [])], START);
    expect(result).toHaveLength(1);
    expect(result[0].name).toEqual('r');
    expect(result[0].values).toEqual([]);
  });

  describe('discrete profile', () => {
    test('produces two values per segment using the next segment start as second x', () => {
      const profile = discreteProfile('00:01:00', [
        { start_offset: '00:00:00', value: 'A' },
        { start_offset: '00:00:30', value: 'B' },
      ]);
      const [resource] = sampleProfiles([profile], START);
      expect(resource.values).toEqual([
        { is_gap: false, x: startMs + 0, y: 'A' },
        { is_gap: false, x: startMs + 30000, y: 'A' },
        { is_gap: false, x: startMs + 30000, y: 'B' },
        { is_gap: false, x: startMs + 60000, y: 'B' },
      ]);
    });

    test('uses durationMs for the closing x of the last segment', () => {
      const profile = discreteProfile('00:02:00', [{ start_offset: '00:00:30', value: 'A' }]);
      const [resource] = sampleProfiles([profile], START);
      expect(resource.values).toEqual([
        { is_gap: false, x: startMs + 30000, y: 'A' },
        { is_gap: false, x: startMs + 120000, y: 'A' },
      ]);
    });

    test('propagates is_gap to both values produced by a gap segment', () => {
      const profile = discreteProfile('00:01:00', [{ is_gap: true, start_offset: '00:00:00', value: 'X' }]);
      const [resource] = sampleProfiles([profile], START);
      expect(resource.values.every(v => v.is_gap === true)).toBe(true);
    });
  });

  describe('real profile', () => {
    test('uses dynamics.initial as the segment-start y value', () => {
      const profile = realProfile('00:01:00', [{ initial: 50, rate: 0, start_offset: '00:00:00' }]);
      const [resource] = sampleProfiles([profile], START);
      expect(resource.values[0]).toEqual({ is_gap: false, x: startMs, y: 50 });
    });

    test('connects consecutive segments at the same x with their respective y values', () => {
      const profile = realProfile('00:02:00', [
        { initial: 0, rate: 0, start_offset: '00:00:00' },
        { initial: 10, rate: 0, start_offset: '00:01:00' },
      ]);
      const [resource] = sampleProfiles([profile], START);
      expect(resource.values[1].x).toEqual(resource.values[2].x);
      expect(resource.values[1].y).toEqual(0);
      expect(resource.values[2].y).toEqual(10);
    });
  });

  describe('sort invariants', () => {
    test('values are sorted ASC by x when duration >= max segment start_offset', () => {
      const profile = discreteProfile('00:05:00', [
        { start_offset: '00:00:00', value: 'A' },
        { start_offset: '00:01:00', value: 'B' },
        { start_offset: '00:02:00', value: 'C' },
        { start_offset: '00:03:00', value: 'D' },
      ]);
      const [resource] = sampleProfiles([profile], START);
      const xs = resource.values.map(v => v.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
    });

    // Pin: if duration < last segment offset, the closing value lands before
    // its own open x and decimation breaks. profile.ts guards this via
    // pickEffectiveDuration; this test catches a "be lenient" regression.
    test('garbage-in: values are NOT sorted when duration < last segment start_offset', () => {
      const profile = discreteProfile('00:00:00', [
        { start_offset: '00:00:00', value: 'A' },
        { start_offset: '00:01:00', value: 'B' },
      ]);
      const [resource] = sampleProfiles([profile], START);
      const xs = resource.values.map(v => v.x);
      const sorted = [...xs].sort((a, b) => a - b);
      expect(xs).not.toEqual(sorted);
    });

    test('produces only finite x and y for well-formed real-typed input', () => {
      const profile = realProfile('00:10:00', [
        { initial: 0, rate: 1, start_offset: '00:00:00' },
        { initial: 5, rate: -1, start_offset: '00:05:00' },
      ]);
      const [resource] = sampleProfiles([profile], START);
      for (const v of resource.values) {
        expect(Number.isFinite(v.x)).toBe(true);
        expect(typeof v.y === 'number' && Number.isFinite(v.y)).toBe(true);
      }
    });
  });

  test('offsetInterval shifts every x by the offset', () => {
    const profile = discreteProfile('00:01:00', [{ start_offset: '00:00:00', value: 'A' }]);
    const [resource] = sampleProfiles([profile], START, '00:00:10');
    expect(resource.values).toEqual([
      { is_gap: false, x: startMs + 10000, y: 'A' },
      { is_gap: false, x: startMs + 70000, y: 'A' },
    ]);
  });

  test('handles multiple profiles independently', () => {
    const a = discreteProfile('00:01:00', [{ start_offset: '00:00:00', value: 'A' }]);
    a.name = 'a';
    const b = discreteProfile('00:01:00', [{ start_offset: '00:00:00', value: 'B' }]);
    b.name = 'b';
    const result = sampleProfiles([a, b], START);
    expect(result).toHaveLength(2);
    expect(result[0].name).toEqual('a');
    expect(result[1].name).toEqual('b');
  });
});

function resource(schema: ValueSchema, values: ResourceValue[]): Resource {
  return { name: 'r', schema, values };
}

const realSchema: ValueSchema = { type: 'real' };
const stringSchema: ValueSchema = { type: 'string' };
const booleanSchema: ValueSchema = { type: 'boolean' };

describe('getResourceValueAtTime', () => {
  test('interpolates linearly between the bracketing values', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 10 },
      { is_gap: false, x: 100, y: 20 },
    ]);
    expect(getResourceValueAtTime(r, 25, true)).toEqual({ isGap: false, value: 12.5 });
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: 15 });
  });

  test('snaps to the nearer neighbor when not interpolating, with the halfway point going right', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 10 },
      { is_gap: false, x: 100, y: 20 },
    ]);
    expect(getResourceValueAtTime(r, 49, false)).toEqual({ isGap: false, value: 10 });
    expect(getResourceValueAtTime(r, 50, false)).toEqual({ isGap: false, value: 20 });
    expect(getResourceValueAtTime(r, 51, false)).toEqual({ isGap: false, value: 20 });
  });

  test('steps rather than ramps for discrete schemas, even when interpolating', () => {
    // sampleProfiles emits two points per discrete segment, so a value holds across the segment.
    const r = resource(stringSchema, [
      { is_gap: false, x: 0, y: 'A' },
      { is_gap: false, x: 100, y: 'A' },
      { is_gap: false, x: 100, y: 'B' },
      { is_gap: false, x: 200, y: 'B' },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: 'A' });
    expect(getResourceValueAtTime(r, 150, true)).toEqual({ isGap: false, value: 'B' });
  });

  test('lands on the new value exactly at a segment boundary', () => {
    const r = resource(stringSchema, [
      { is_gap: false, x: 0, y: 'A' },
      { is_gap: false, x: 100, y: 'A' },
      { is_gap: false, x: 100, y: 'B' },
      { is_gap: false, x: 200, y: 'B' },
    ]);
    // Two values share x=100; the left neighbor must be the later of them, so the step has taken
    // effect. This is also what keeps the interpolation denominator from being zero.
    expect(getResourceValueAtTime(r, 100, true)).toEqual({ isGap: false, value: 'B' });
    expect(getResourceValueAtTime(r, 100, false)).toEqual({ isGap: false, value: 'B' });
  });

  test('never averages a boolean across a segment boundary', () => {
    const r = resource(booleanSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 1 },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: 0 });
  });

  test('reports a gap instead of a value when either neighbor is a gap', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 10 },
      { is_gap: true, x: 100, y: null },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: true, value: null });
  });

  test('treats a null y as no value even when is_gap is unset', () => {
    const r = resource(realSchema, [
      { x: 0, y: 10 },
      { x: 100, y: null },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: null });
  });

  test('falls back to the single adjacent value outside the sampled extent', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 100, y: 10 },
      { is_gap: false, x: 200, y: 20 },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: 10 });
    expect(getResourceValueAtTime(r, 300, true)).toEqual({ isGap: false, value: 20 });
  });

  test('handles a single-value and an empty resource', () => {
    expect(getResourceValueAtTime(resource(realSchema, [{ is_gap: false, x: 100, y: 7 }]), 50, true)).toEqual({
      isGap: false,
      value: 7,
    });
    expect(getResourceValueAtTime(resource(realSchema, []), 50, true)).toEqual({ isGap: false, value: null });
  });

  test('resolves values from a profile sampled by sampleProfiles', () => {
    // A real profile ramping at 10 units/second for a minute.
    const profile = realProfile('00:01:00', [{ initial: 0, rate: 10, start_offset: '00:00:00' }]);
    const [sampled] = sampleProfiles([profile], START);
    expect(getResourceValueAtTime(sampled, startMs + 30_000, true)).toEqual({ isGap: false, value: 300 });
    expect(getResourceValueAtTime(sampled, startMs + 60_000, true)).toEqual({ isGap: false, value: 600 });
  });
});

describe('formatResourceValue', () => {
  test('appends the unit from schema metadata', () => {
    expect(formatResourceValue(12.5, { metadata: { unit: { value: 'W' } }, type: 'real' })).toEqual('12.5 (W)');
  });

  test('omits the parenthetical when no unit is declared', () => {
    expect(formatResourceValue(12.5, realSchema)).toEqual('12.5');
  });

  test('converts a duration from microseconds', () => {
    expect(formatResourceValue(90_000_000, { type: 'duration' })).toEqual('1m 30s');
  });

  test('leaves a non-positive duration as a plain number', () => {
    expect(formatResourceValue(0, { type: 'duration' })).toEqual('0');
  });

  test('renders strings and null', () => {
    expect(formatResourceValue('IDLE', stringSchema)).toEqual('IDLE');
    expect(formatResourceValue(null, realSchema)).toEqual('');
  });

  test('serializes a composite value rather than rendering [object Object]', () => {
    const structSchema: ValueSchema = { items: { id: { type: 'int' } }, type: 'struct' };
    const value = { id: 7 } as unknown as number;
    expect(formatResourceValue(value, structSchema)).toEqual('{"id":7}');
  });
});

describe('getResourceValueAtTime schema handling', () => {
  test('steps a composite struct instead of averaging it into NaN', () => {
    const structSchema: ValueSchema = { items: { id: { type: 'int' } }, type: 'struct' };
    const r = resource(structSchema, [
      { is_gap: false, x: 0, y: { id: 1 } as unknown as number },
      { is_gap: false, x: 100, y: { id: 2 } as unknown as number },
    ]);
    expect(getResourceValueAtTime(r, 50, true)).toEqual({ isGap: false, value: { id: 1 } });
  });

  test('still interpolates a real-valued {initial, rate} struct', () => {
    const rateSchema: ValueSchema = {
      items: { initial: { type: 'real' }, rate: { type: 'real' } },
      type: 'struct',
    };
    const r = resource(rateSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 100 },
    ]);
    expect(getResourceValueAtTime(r, 25, true)).toEqual({ isGap: false, value: 25 });
  });
});

describe('formatResourceNumber', () => {
  test('collapses large magnitudes to a suffix', () => {
    expect(formatResourceNumber(12_480_000_000)).toEqual('12.48G');
    expect(formatResourceNumber(2_500_000)).toEqual('2.50M');
  });

  test('uses thousands separators in the mid range', () => {
    expect(formatResourceNumber(152_436)).toEqual('152,436');
  });

  test('keeps fixed decimals for small values', () => {
    expect(formatResourceNumber(108.08590357490047)).toEqual('108.09');
    expect(formatResourceNumber(108.08590357490047, 0)).toEqual('108');
  });

  test('renders an en dash for missing values', () => {
    expect(formatResourceNumber(null)).toEqual('–');
    expect(formatResourceNumber(NaN)).toEqual('–');
  });

  test('handles negatives on both sides of the suffix threshold', () => {
    expect(formatResourceNumber(-2_500_000)).toEqual('-2.50M');
    expect(formatResourceNumber(-12.5)).toEqual('-12.50');
  });
});

describe('getResourceWindowStats', () => {
  test('time-weights the average rather than averaging samples', () => {
    // 0 held for 900 units, then a ramp to 100 over 100 units. A naive per-sample mean would say
    // ~33; the honest time-weighted answer is dominated by the long flat stretch.
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 900, y: 0 },
      { is_gap: false, x: 900, y: 0 },
      { is_gap: false, x: 1000, y: 100 },
    ]);
    const stats = getResourceWindowStats(r, 0, 1000);
    expect(stats?.avg).toBeCloseTo(5, 6);
    expect(stats?.min).toEqual(0);
    expect(stats?.max).toEqual(100);
    expect(stats?.durationMs).toEqual(1000);
  });

  test('integrates a flat segment exactly', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 10 },
      { is_gap: false, x: 100, y: 10 },
    ]);
    const stats = getResourceWindowStats(r, 0, 100);
    expect(stats?.area).toEqual(1000);
    expect(stats?.avg).toEqual(10);
  });

  test('clips a window that starts and ends mid-segment', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 100 },
    ]);
    const stats = getResourceWindowStats(r, 25, 75);
    expect(stats?.min).toBeCloseTo(25, 6);
    expect(stats?.max).toBeCloseTo(75, 6);
    expect(stats?.avg).toBeCloseTo(50, 6);
    expect(stats?.durationMs).toEqual(50);
  });

  test('reports a degenerate window when both cursors coincide', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 100 },
    ]);
    const stats = getResourceWindowStats(r, 50, 50);
    expect(stats).toEqual({ area: 0, avg: 50, durationMs: 0, max: 50, min: 50, sampleCount: 0 });
  });

  test('is order independent', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 100 },
    ]);
    expect(getResourceWindowStats(r, 75, 25)).toEqual(getResourceWindowStats(r, 25, 75));
  });

  test('skips gap segments', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 10 },
      { is_gap: false, x: 100, y: 10 },
      { is_gap: true, x: 100, y: null },
      { is_gap: true, x: 200, y: null },
    ]);
    const stats = getResourceWindowStats(r, 0, 200);
    expect(stats?.durationMs).toEqual(100);
    expect(stats?.avg).toEqual(10);
  });
});

describe('getResourceSparkline', () => {
  test('builds a path normalized to the resource range', () => {
    const r = resource(realSchema, [
      { is_gap: false, x: 0, y: 0 },
      { is_gap: false, x: 100, y: 10 },
    ]);
    const spark = getResourceSparkline(r, 0, 100, 40, 20);
    expect(spark?.min).toEqual(0);
    expect(spark?.max).toEqual(10);
    // Starts at the left edge on the baseline and ends at the right edge on the top.
    expect(spark?.d).toEqual('M0.0 18.5 L40.0 1.5');
  });

  test('decimates to at most the requested point count', () => {
    const values = Array.from({ length: 500 }, (_, i) => ({ is_gap: false, x: i, y: i }));
    const spark = getResourceSparkline(resource(realSchema, values), 0, 499, 40, 20, 10);
    expect((spark?.d.match(/[ML]/g) ?? []).length).toBeLessThanOrEqual(11);
  });

  test('returns null when there is nothing to draw', () => {
    expect(getResourceSparkline(resource(realSchema, []), 0, 100, 40, 20)).toBeNull();
    expect(
      getResourceSparkline(resource(realSchema, [{ is_gap: false, x: 0, y: 1 }]), 0, 100, 40, 20),
    ).toBeNull();
  });
});
