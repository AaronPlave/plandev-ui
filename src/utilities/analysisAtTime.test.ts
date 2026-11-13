import { describe, expect, it, vi } from 'vitest';
import type { AnalysisSimulationDataset, AnalysisSourceBinding, AnalysisSourceRevision } from '../types/analysis';
import type { Resource } from '../types/simulation';
import type { Layer, Timeline } from '../types/timeline';
import type { TimelineSource } from '../types/timelineSource';
import {
  getAnalysisResourceRows,
  getCurrentSnapshot,
  getImportedValueAt,
  getInspectedResources,
  getInstantQuery,
  getResourceCatalog,
  getResourceOptions,
  getSimulatedReading,
  getSimulatedValueAt,
  readImportedResources,
  resolveResource,
  type InspectedResource,
} from './analysisAtTime';
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

describe('watched resources', () => {
  const layer = (id: number, resource: string, sourceId: string): Layer => ({
    chartType: 'line',
    filter: { resource },
    id,
    name: resource,
    sourceId,
    yAxisId: null,
  });
  const timeline = {
    rows: [{ id: 1, layers: [layer(1, 'a', 's1')], name: 'Row 1' }],
  } as unknown as Timeline;

  it('adds watched resources that no row plots, after the plotted ones, with no layer or row', () => {
    const inspected = getInspectedResources(timeline, [{ name: 'b', sourceId: 's1' }]);
    expect(
      inspected.map(({ name, onTimeline, rowId, sourceId, watched }) => [sourceId, name, onTimeline, watched, rowId]),
    ).toEqual([
      ['s1', 'a', true, false, 1],
      ['s1', 'b', false, true, undefined],
    ]);
  });

  it('lists a resource that is both plotted and watched once', () => {
    const inspected = getInspectedResources(timeline, [
      { name: 'a', sourceId: 's1' },
      { name: 'a', sourceId: 's1' },
    ]);
    expect(inspected).toHaveLength(1);
    expect(inspected[0]).toMatchObject({ name: 'a', onTimeline: true, rowId: 1, watched: true });
  });

  it('keeps one name in two sources as two resources', () => {
    const inspected = getInspectedResources(timeline, [
      { name: 'a', sourceId: 's2' },
      { name: 'a', sourceId: 's3' },
    ]);
    expect(inspected.map(({ name, onTimeline, sourceId }) => [sourceId, name, onTimeline])).toEqual([
      ['s1', 'a', true],
      ['s2', 'a', false],
      ['s3', 'a', false],
    ]);
  });
});

describe('the resource catalog', () => {
  const source = (id: string, label: string, names: string[], unavailableReason?: string) =>
    ({
      id,
      label,
      resources: {
        catalog: names.map(name => ({ name, schema: { type: 'real' } })),
        unavailableReason,
      },
    }) as unknown as TimelineSource;
  const planSource = { id: 'p', kind: 'plan', label: 'Plan' } as unknown as TimelineSource;

  it('offers each source its own resources and tells the same name in two sources apart', () => {
    const catalog = getResourceCatalog([
      source('source-1', 'cruise014', ['/hga/az']),
      source('source-2', 'cruise015', ['/hga/az', '/hga/el']),
    ]);
    expect(catalog.map(({ key }) => key)).toEqual(['source-1::/hga/az', 'source-2::/hga/az', 'source-2::/hga/el']);
    expect(getResourceOptions(catalog)).toEqual([
      { display: '/hga/az · cruise014', value: 'source-1::/hga/az' },
      { display: '/hga/az · cruise015', value: 'source-2::/hga/az' },
      { display: '/hga/el · cruise015', value: 'source-2::/hga/el' },
    ]);
  });

  it('names no source while only one has resources', () => {
    expect(getResourceOptions(getResourceCatalog([planSource, source('source-1', 'cruise014', ['/a'])]))).toEqual([
      { display: '/a', value: 'source-1::/a' },
    ]);
  });

  it('leaves out sources with no data, and plans, which have no resources', () => {
    expect(
      getResourceCatalog([
        planSource,
        source('source-1', 'x', ['/a'], 'The import failed'),
        source('source-2', 'y', []),
      ]),
    ).toEqual([]);
  });

  it('lists many resources without trouble', () => {
    const names = Array.from({ length: 20_000 }, (_, i) => `/r/${i}`);
    expect(getResourceOptions(getResourceCatalog([source('s', 'big', names)]))).toHaveLength(20_000);
  });
});

describe('reading imported resources', () => {
  const definition = (key: string) =>
    ({ coverage_end: null, interpolation: 'constant', key, numeric: true, schema: { type: 'real' } }) as never;
  const revision = (id: number) => ({ coverage_end: '1970-01-01T00:16:40Z', id }) as AnalysisSourceRevision;
  const spec = (sourceId: string, name: string): InspectedResource => ({
    name,
    onTimeline: false,
    sourceId,
    watched: true,
  });
  /** One sample before the instant: a step resource holds it. */
  const answer = (resource: string, value: number) =>
    ({
      ...result({ before: { t: [ms(10)], v: [value] } }),
      resource,
    }) as SourceQueryResult;

  it('asks each revision once, for its own resources, and answers each source with its own value', async () => {
    const query = vi.fn(async (revisionId: number, names: string[]) =>
      names.map(name => answer(name, revisionId === 1 ? 1 : 2)),
    );
    const readings = await readImportedResources(
      ms(20),
      [
        { definition: definition('/x'), revision: revision(1), spec: spec('source-1', '/x') },
        { definition: definition('/y'), revision: revision(1), spec: spec('source-1', '/y') },
        { definition: definition('/x'), revision: revision(2), spec: spec('source-2', '/x') },
      ],
      query,
    );
    expect(query.mock.calls).toEqual([
      [1, ['/x', '/y']],
      [2, ['/x']],
    ]);
    expect(readings.get('source-1::/x')).toMatchObject({ basis: 'held', value: 1 });
    expect(readings.get('source-2::/x')).toMatchObject({ basis: 'held', value: 2 });
  });

  it('batches by the request limit', async () => {
    const query = vi.fn(async (_id: number, names: string[]) => names.map(name => answer(name, 0)));
    const items = ['/a', '/b', '/c'].map(name => ({
      definition: definition(name),
      revision: revision(1),
      spec: spec('source-1', name),
    }));
    await readImportedResources(ms(20), items, query, 2);
    expect(query.mock.calls.map(([, names]) => names)).toEqual([['/a', '/b'], ['/c']]);
  });

  it('makes only the resources of a failed request unavailable, with its reason', async () => {
    const readings = await readImportedResources(
      ms(20),
      [
        { definition: definition('/x'), revision: revision(1), spec: spec('source-1', '/x') },
        { definition: definition('/x'), revision: revision(2), spec: spec('source-2', '/x') },
      ],
      async (revisionId, names) => {
        if (revisionId === 1) {
          throw new Error('gateway down');
        }
        return names.map(name => answer(name, 2));
      },
    );
    expect(readings.get('source-1::/x')).toMatchObject({ basis: 'unavailable', note: 'gateway down' });
    expect(readings.get('source-2::/x')).toMatchObject({ basis: 'held', value: 2 });
  });

  it('says so when the source returns nothing for a resource it was asked for', async () => {
    const readings = await readImportedResources(
      ms(20),
      [{ definition: definition('/x'), revision: revision(1), spec: spec('source-1', '/x') }],
      async () => [],
    );
    expect(readings.get('source-1::/x')?.basis).toBe('unavailable');
  });
});

describe('resolving a resource to its source', () => {
  const revisions = [
    { id: 1, resources: [{ key: '/x' }], status: 'success' },
    { id: 2, resources: [{ key: '/x' }], status: 'pending' },
  ] as unknown as AnalysisSourceRevision[];
  const datasets = [
    { dataset_id: 6, id: 1, status: 'success' },
    { dataset_id: 7, id: 2, status: 'incomplete' },
  ] as unknown as AnalysisSimulationDataset[];
  const bindings: AnalysisSourceBinding[] = [
    { id: 'source-1', kind: 'imported', revisionId: 1 },
    { id: 'source-2', kind: 'imported', revisionId: 2 },
    { id: 'source-3', kind: 'simulation', simulationDatasetId: 1 },
    { id: 'source-4', kind: 'simulation', simulationDatasetId: 2 },
    { id: 'source-5', kind: 'plan', planId: 3 },
  ];
  const resolve = (sourceId: string, name = '/x') => resolveResource({ name, sourceId }, bindings, revisions, datasets);

  it('reads an imported resource from the revision its own source binds', () => {
    expect(resolve('source-1')).toMatchObject({ kind: 'imported', revision: { id: 1 } });
  });

  it('never reads another source for one that is gone, has no data, or lacks the resource', () => {
    expect(resolve('source-9')).toEqual({ kind: 'unavailable', note: 'Not a source of this analysis' });
    expect(resolve('source-2')).toMatchObject({ kind: 'unavailable', note: 'The source has no data to read' });
    expect(resolve('source-1', '/nope')).toMatchObject({ kind: 'unavailable', note: 'Not a resource of this source' });
  });

  it('reads a simulation resource only from a finished simulation, and gives a plan none', () => {
    expect(resolve('source-3')).toMatchObject({ kind: 'simulation' });
    expect(resolve('source-4')).toMatchObject({ kind: 'unavailable', note: 'The simulation is incomplete' });
    expect(resolve('source-5')).toMatchObject({ kind: 'unavailable', note: 'A plan has no resources' });
  });
});

describe('what is shown for an instant', () => {
  it('is only a reading taken for that instant and those sources', () => {
    const snapshot = { configKey: 'k', time: 100, value: 'v' };
    expect(getCurrentSnapshot(snapshot, 100, 'k')).toBe('v');
    expect(getCurrentSnapshot(snapshot, 101, 'k')).toBeNull();
    expect(getCurrentSnapshot(snapshot, 100, 'other')).toBeNull();
    expect(getCurrentSnapshot(snapshot, null, 'k')).toBeNull();
    expect(getCurrentSnapshot(null, 100, 'k')).toBeNull();
  });
});

describe('getAnalysisResourceRows', () => {
  const bindings: AnalysisSourceBinding[] = [
    { id: 'source-1', kind: 'imported', revisionId: 1 },
    { id: 'source-2', kind: 'simulation', simulationDatasetId: 1 },
  ];
  const revisions = [
    {
      id: 1,
      resources: [{ interpolation: 'linear', key: '/x', numeric: true, schema: { type: 'real' }, units: 'deg' }],
      status: 'success',
    },
  ] as unknown as AnalysisSourceRevision[];
  const datasets = [
    {
      dataset: { profiles: [{ name: '/x', type: { schema: { type: 'real' } } }] },
      dataset_id: 6,
      id: 1,
      status: 'success',
    },
  ] as unknown as AnalysisSimulationDataset[];
  const specs: InspectedResource[] = [
    { name: '/x', onTimeline: false, sourceId: 'source-1', watched: true },
    { name: '/x', onTimeline: false, sourceId: 'source-2', watched: true },
  ];
  const profile = (value: number): Resource => ({
    name: '/x',
    schema: { type: 'real' },
    values: [
      { is_gap: false, is_hold: true, x: 0, y: value },
      { is_gap: false, is_hold: true, x: ms(100), y: value },
    ],
  });
  const base = {
    bindings,
    compareMs: null,
    cursorMs: ms(10),
    datasets,
    error: '',
    getState: () => undefined,
    labels: { 'source-1': 'cruise015', 'source-2': 'Sim 1' },
    pending: false,
    readingsA: null,
    readingsB: null,
    revisions,
    specs,
  };

  it('says "reading" for an imported resource until its reading is in, never a value of another instant', () => {
    const rows = getAnalysisResourceRows({ ...base, pending: true });
    expect(rows[0].readingA.basis).toBe('loading');
    expect(rows[0].readingA.value).toBeNull();
    // The reading in is only the one passed: none passed is none shown.
    const read = getAnalysisResourceRows({
      ...base,
      readingsA: new Map([['source-1::/x', { basis: 'sample', value: 5 }]]),
    });
    expect(read[0].readingA).toMatchObject({ basis: 'sample', value: 5 });
    expect(read[0].sourceLabel).toBe('cruise015');
    expect(read[0].schema.metadata?.unit?.value).toBe('deg');
  });

  it('shows why a read failed, and not a value', () => {
    const [row] = getAnalysisResourceRows({ ...base, error: 'gateway down' });
    expect(row.readingA).toMatchObject({ basis: 'unavailable', note: 'gateway down' });
  });

  it('reads a simulation resource from the profile as soon as it is loaded, and says it is computed', () => {
    const loading = { error: '', loading: true, resource: null };
    const before = getAnalysisResourceRows({ ...base, getState: () => loading });
    expect(before[1].readingA.basis).toBe('loading');
    const after = getAnalysisResourceRows({
      ...base,
      getState: (datasetId, name, kind) =>
        datasetId === 6 && name === '/x' && kind === 'sim'
          ? { error: '', loading: false, resource: profile(42) }
          : undefined,
    });
    expect(after[1].readingA).toMatchObject({ basis: 'computed', value: 42 });
  });

  it('reads the simulation at B too, and leaves B empty when not comparing', () => {
    const getState = () => ({ error: '', loading: false, resource: profile(1) });
    expect(getAnalysisResourceRows({ ...base, getState })[1].readingB).toBeNull();
    const rows = getAnalysisResourceRows({ ...base, compareMs: ms(200), getState });
    expect(rows[1].readingB?.basis).toBe('unavailable');
    expect(getSimulatedReading({ error: 'nope', loading: false, resource: null }, 0).reading.note).toBe('nope');
  });

  it('marks a resource whose source was removed unavailable, and reads nothing for it', () => {
    const [row] = getAnalysisResourceRows({ ...base, bindings: [], specs: [specs[0]] });
    expect(row.readingA).toMatchObject({ basis: 'unavailable', note: 'Not a source of this analysis' });
  });

  it('gives no rows without a cursor', () => {
    expect(getAnalysisResourceRows({ ...base, cursorMs: null })).toEqual([]);
  });
});
