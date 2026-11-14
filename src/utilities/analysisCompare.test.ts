import { describe, expect, test } from 'vitest';
import { compareActivities, describeComparison, formatDelta, type ComparedActivity } from './analysisCompare';

const predicted: ComparedActivity = {
  endMs: Date.parse('2026-05-27T18:10:00Z'),
  key: 'ALO_1$1ALLOCATION',
  name: 'ALLOCATION',
  parameters: { ANT: '34', PASS: '0147' },
  sourceIdentity: 'imported:110',
  startMs: Date.parse('2026-05-27T14:10:00Z'),
  type: 'ALLOCATION',
};

describe('compareActivities', () => {
  test('a late start with the same end: start later, duration shorter by the same amount', () => {
    const observed = { ...predicted, key: 'ASRUN_0147', sourceIdentity: 'imported:300', startMs: predicted.startMs + 450_000 };
    const result = compareActivities(predicted, observed);
    expect(result.startDeltaMs).toBe(450_000);
    expect(result.endDeltaMs).toBe(0);
    expect(result.durationDeltaMs).toBe(-450_000);
    expect(result.interval).toEqual({ kind: 'overlap', ms: 4 * 36e5 - 450_000 });
    expect(result.sameSource).toBe(false);
    expect(result.parameters.every(parameter => parameter.status === 'same')).toBe(true);
    expect(result.notes).toEqual([]);
  });

  test('conflicting and one-sided parameters are reported as such', () => {
    const observed = { ...predicted, parameters: { ANT: '36', SC_ID: '159' } };
    expect(compareActivities(predicted, observed).parameters.map(({ name, status }) => [name, status])).toEqual([
      ['ANT', 'differs'],
      ['PASS', 'onlyA'],
      ['SC_ID', 'onlyB'],
    ]);
  });

  test('records that do not overlap and share nothing say so', () => {
    const other = { ...predicted, endMs: predicted.endMs! + 864e5, parameters: {}, startMs: predicted.startMs + 864e5 };
    const result = compareActivities(predicted, other);
    expect(result.interval).toEqual({ kind: 'gap', ms: 20 * 36e5 });
    expect(result.notes).toHaveLength(3); // same record identity, no overlap, no shared parameter
  });

  test('a record with no end compares starts only', () => {
    const result = compareActivities(predicted, { ...predicted, endMs: null, key: 'directive 4' });
    expect(result.endDeltaMs).toBeNull();
    expect(result.durationDeltaMs).toBeNull();
    expect(result.notes[0]).toMatch(/no end/);
  });
});

test('formatDelta', () => {
  expect(formatDelta(450_000)).toBe('+7m 30s');
  expect(formatDelta(-25 * 60_000)).toBe('−25m');
  expect(formatDelta(0)).toBe('0s');
  expect(formatDelta(1500)).toBe('+1s 500ms');
});

test('describeComparison states the computed differences', () => {
  const a = { ...predicted, sourceLabel: 'PEF' };
  const b = { ...predicted, key: 'ASRUN', parameters: { ANT: '36', PASS: '0147' }, sourceLabel: 'As-run', startMs: predicted.startMs + 450_000 };
  const text = describeComparison(a, b, compareActivities(a, b));
  expect(text).toContain('start +7m 30s, end 0s, duration −7m 30s');
  expect(text).toContain('Same in both: PASS.');
  expect(text).toContain('Different: ANT ("34" vs "36").');
});
