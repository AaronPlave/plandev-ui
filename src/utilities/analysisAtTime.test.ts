import { describe, expect, it } from 'vitest';
import type { Layer, Timeline } from '../types/timeline';
import { getImportedValueAt, getInspectedResources, getInstantQuery, getSimulatedValueAt } from './analysisAtTime';
import { GAP, NULL, VALUE, type SourceQueryResult, type SourceSeries } from './importedResource';

const ms = (n: number) => n * 1000;

function result(parts: { after?: SourceSeries | null; before?: SourceSeries | null; series?: SourceSeries }) {
  return {
    after: parts.after ?? null,
    approximate: false,
    before: parts.before ?? null,
    bucketWidth: null,
    next: null,
    representation: 'raw',
    resource: 'r',
    series: parts.series ?? { t: [] },
  } as SourceQueryResult;
}

const linear = { coverageEnd: 1000, interpolation: 'linear' as const, numeric: true };
const step = { coverageEnd: 1000, interpolation: 'constant' as const, numeric: true };

describe('getImportedValueAt', () => {
  it('reports a sample at exactly the instant as a sample', () => {
    const value = getImportedValueAt(100, result({ series: { k: [VALUE], t: [ms(100)], v: [7] } }), linear);
    expect(value).toMatchObject({ basis: 'sample', sampleMs: 100, value: 7 });
  });

  it('interpolates a linear resource between two samples and says so', () => {
    const value = getImportedValueAt(
      150,
      result({ after: { k: [VALUE], t: [ms(200)], v: [20] }, before: { k: [VALUE], t: [ms(100)], v: [10] } }),
      linear,
    );
    expect(value).toMatchObject({ basis: 'interpolated', nextMs: 200, sampleMs: 100, value: 15 });
  });

  it('holds a step resource at its last sample, and says it is held', () => {
    const value = getImportedValueAt(
      150,
      result({ after: { t: [ms(200)], v: [20] }, before: { t: [ms(100)], v: [10] } }),
      step,
    );
    expect(value).toMatchObject({ basis: 'held', nextMs: 200, sampleMs: 100, value: 10 });
  });

  it('holds a text resource, which is never interpolated', () => {
    const value = getImportedValueAt(
      150,
      result({ after: { s: ['B'], t: [ms(200)] }, before: { s: ['A'], t: [ms(100)] } }),
      { ...linear, numeric: false },
    );
    expect(value).toMatchObject({ basis: 'held', value: 'A' });
  });

  it('holds a step resource past its last sample only until the end of the data', () => {
    const before = { t: [ms(100)], v: [10] };
    expect(getImportedValueAt(500, result({ before }), step)).toMatchObject({ basis: 'held', value: 10 });
    expect(getImportedValueAt(2000, result({ before }), step)).toMatchObject({ basis: 'unavailable' });
  });

  it('does not extend a line past its last sample or before its first', () => {
    expect(getImportedValueAt(150, result({ before: { t: [ms(100)], v: [1] } }), linear).basis).toBe('unavailable');
    expect(getImportedValueAt(50, result({ after: { t: [ms(100)], v: [1] } }), linear).basis).toBe('unavailable');
  });

  it('does not draw a line across a sample with no value', () => {
    const value = getImportedValueAt(
      150,
      result({ after: { k: [NULL], t: [ms(200)], v: [null] }, before: { k: [VALUE], t: [ms(100)], v: [10] } }),
      linear,
    );
    expect(value.basis).toBe('unavailable');
  });

  it('reports a gap as a gap, never as the previous value', () => {
    const value = getImportedValueAt(
      150,
      result({ after: { t: [ms(200)], v: [20] }, before: { k: [GAP], t: [ms(100)], v: [null] } }),
      step,
    );
    expect(value).toMatchObject({ basis: 'gap', value: null });
  });

  it('flags a response that is not complete raw data', () => {
    const value = getImportedValueAt(
      100,
      { ...result({ series: { t: [ms(100)], v: [7] } }), approximate: true },
      linear,
    );
    expect(value).toMatchObject({ approximate: true, basis: 'sample' });
  });

  it('passes a failed query on as unavailable, with its reason', () => {
    expect(getImportedValueAt(100, { ...result({}), error: 'boom' }, linear)).toMatchObject({
      basis: 'unavailable',
      note: 'boom',
    });
  });
});

describe('getSimulatedValueAt', () => {
  const values = [
    { x: 0, y: 0 },
    { x: 100, y: 10 },
    { is_hold: true, x: 200, y: 10 },
    { x: 200, y: 5 },
    { x: 300, y: 5 },
  ];

  it('computes along a segment, and never calls it a sample', () => {
    expect(getSimulatedValueAt(values, 50)).toMatchObject({ basis: 'computed', value: 5 });
  });

  it('computes at a point the profile has', () => {
    expect(getSimulatedValueAt(values, 100)).toMatchObject({ basis: 'computed', value: 10 });
  });

  it('takes the value in effect where two begin at the same time', () => {
    expect(getSimulatedValueAt(values, 200)).toMatchObject({ value: 5 });
  });

  it('holds a discrete value across its segment', () => {
    expect(
      getSimulatedValueAt(
        [
          { x: 0, y: 'ON' },
          { is_hold: true, x: 100, y: 'ON' },
          { x: 100, y: 'OFF' },
          { x: 200, y: 'OFF' },
        ],
        50,
      ),
    ).toMatchObject({
      value: 'ON',
    });
  });

  it('says nothing outside the profile', () => {
    expect(getSimulatedValueAt(values, -1).basis).toBe('unavailable');
    expect(getSimulatedValueAt(values, 301).basis).toBe('unavailable');
    expect(getSimulatedValueAt([], 0).basis).toBe('unavailable');
  });
});

describe('getInspectedResources', () => {
  const layer = (
    id: number,
    chartType: Layer['chartType'],
    resource: string | undefined,
    sourceId?: string,
  ): Layer => ({
    chartType,
    filter: resource ? { resource } : {},
    id,
    name: resource ?? 'activities',
    sourceId,
    yAxisId: null,
  });
  const timeline = {
    rows: [
      { id: 1, layers: [layer(1, 'line', 'a', 's1'), layer(2, 'activity', undefined, 's1')], name: 'Row 1' },
      {
        id: 2,
        layers: [layer(3, 'line', 'a', 's1'), layer(4, 'x-range', 'b', 's2'), layer(5, 'line', 'c')],
        name: 'Row 2',
      },
    ],
  } as unknown as Timeline;

  it('lists each resource of each source once, in row order, and no activity or sourceless layer', () => {
    expect(getInspectedResources(timeline).map(({ name, rowName, sourceId }) => [sourceId, name, rowName])).toEqual([
      ['s1', 'a', 'Row 1'],
      ['s2', 'b', 'Row 2'],
    ]);
  });
});

describe('getInstantQuery', () => {
  it('asks for exactly the one instant, with its neighbours', () => {
    expect(getInstantQuery(1.5)).toEqual({ end: 1501, fidelity: 'exact', pointBudget: 2, start: 1500 });
  });
});
