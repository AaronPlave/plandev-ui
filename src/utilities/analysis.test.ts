import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisSimulationDataset, AnalysisSourceBinding, AnalysisSourceRevision } from '../types/analysis';
import type { Span } from '../types/simulation';
import type { Row, Timeline } from '../types/timeline';
import type { TimelineActivitySubscription, TimelineResourceSubscription } from '../types/timelineSource';
import {
  createAnalysisSources,
  createStaticActivitySubscription,
  getAnalysisSourceNames,
  getNewerRevision,
  getRevisionVersionLabel,
  planDirectiveToSpan,
  getActivityDrawingId,
  getActivityRefFromDrawingId,
  getActivityRefFromSpan,
  getAnalysisActivitiesBeforeWhere,
  getAnalysisActivityRowRef,
  getAnalysisActivityWhere,
  getAnalysisTimeRanges,
  getNextAnalysisSourceId,
  importedActivityToSpan,
  removeSourceFromTimelines,
  simulationSpanToActivity,
  getAvailableAdapters,
  getRevisionUsage,
  splitSourceRevisions,
  type AnalysisSourcesInput,
} from './analysis';
import { generateDiscreteTreeUtil } from './timeline';
import { createStaticResourceSubscription, resolveResourceLayerSource } from './timelineSources';

const imported: AnalysisSourceBinding = { id: 'source-1', kind: 'imported', revisionId: 18 };
const planA: AnalysisSourceBinding = { id: 'source-2', kind: 'simulation', simulationDatasetId: 1 };
const planB: AnalysisSourceBinding = { id: 'source-3', kind: 'simulation', simulationDatasetId: 2 };

const revision: AnalysisSourceRevision = {
  activity_types: [
    {
      category: 'DSN',
      count: 3117,
      first_start: '2030-04-28T00:00:00Z',
      last_end: '2034-09-01T00:00:00Z',
      parameters: {},
      type: 'DSN_Pass',
    },
    {
      category: 'GNC',
      count: 10,
      first_start: '2024-10-06T00:00:00Z',
      last_end: '2034-01-01T00:00:00Z',
      parameters: {},
      type: 'Turn',
    },
  ],
  adapter: 'xml_tol',
  adapter_version: '1',
  content_hash: null,
  coverage_end: '2034-09-03T00:00:00Z',
  coverage_start: '2030-04-27T00:00:00Z',
  error: null,
  finished_at: null,
  id: 18,
  metadata: {},
  original_file: null,
  requested_at: '2026-10-03T12:00:00Z',
  resources: [
    {
      category: 'Power',
      coverage_end: null,
      coverage_start: null,
      interpolation: 'linear',
      key: 'BatteryStateOfCharge',
      numeric: true,
      sample_count: 10,
      schema: { type: 'real' },
      units: '%',
    },
  ],
  source: { id: 1, latest: [], name: 'mission tour TOL', source_type: 'xml_tol' },
  status: 'success',
};

function dataset(id: number, planName: string): AnalysisSimulationDataset {
  return {
    dataset: { profiles: [{ name: '/fruit', type: { schema: { type: 'real' } } }] },
    dataset_id: id + 5,
    id,
    simulation: { plan: { id: id + 2, mission_model: null, name: planName } },
    simulation_end_time: '2031-01-08T00:00:00Z',
    simulation_start_time: '2031-01-01T00:00:00Z',
    status: 'success',
  };
}

function span(id: number, type: string, parent: number | null = null, directiveId?: number): Span {
  return {
    attributes: { arguments: { biteSize: 1 }, computedAttributes: {}, ...(directiveId ? { directiveId } : {}) },
    dataset_id: 6,
    duration: '01:00:00',
    durationMs: 3600000,
    endMs: 3600000,
    parent_id: parent,
    span_id: id,
    startMs: 0,
    start_offset: '00:00:00',
    type,
  };
}

function input(overrides: Partial<AnalysisSourcesInput> = {}): AnalysisSourcesInput {
  return {
    bindings: [imported, planA, planB],
    loading: false,
    planTypeCounts: {},
    plans: [],
    plansLoading: false,
    revisions: [revision],
    simulationDatasets: [dataset(1, 'Tour Plan A'), dataset(2, 'Tour Plan B')],
    simulationTypeCounts: { 1: [{ count: 14, name: 'BiteBanana' }], 2: [{ count: 9, name: 'BiteBanana' }] },
    subscribeImportedActivities: vi.fn(() => createStaticActivitySubscription('')),
    subscribeImportedResource: vi.fn(() =>
      createStaticResourceSubscription({ error: '', loading: false, resource: null }),
    ) as unknown as AnalysisSourcesInput['subscribeImportedResource'],
    subscribePlanActivities: vi.fn(() => createStaticActivitySubscription('')),
    subscribeSimulationActivities: vi.fn(() => createStaticActivitySubscription('')),
    subscribeSimulationProfile: vi.fn(() =>
      createStaticResourceSubscription({ error: '', loading: false, resource: null }),
    ) as unknown as AnalysisSourcesInput['subscribeSimulationProfile'],
    ...overrides,
  };
}

const context = { plan: null, simulationDataset: null, user: null };

describe('analysis activity identity', () => {
  it('scopes activity ids to their source', () => {
    const a = getActivityDrawingId({ activityId: 5, sourceId: 'source-2' });
    const b = getActivityDrawingId({ activityId: 5, sourceId: 'source-3' });
    expect(a).not.toBe(b);
    expect(getActivityRefFromDrawingId(a)).toEqual({ activityId: 5, sourceId: 'source-2' });
    expect(getActivityRefFromDrawingId(b)).toEqual({ activityId: 5, sourceId: 'source-3' });
    // Drawing ids never collide with the Plan's own span ids.
    expect(a).toBeGreaterThan(2 ** 31);
    expect(getActivityRefFromDrawingId(42)).toBeNull();
  });

  it('keeps the same span id from two simulations apart, with each hierarchy in its own source', () => {
    const fromA = [span(1, 'parent'), span(2, 'child', 1, 7)].map(s => simulationSpanToActivity('source-2', s));
    const fromB = [span(1, 'parent'), span(2, 'child', 1)].map(s => simulationSpanToActivity('source-3', s));
    expect(fromA[0].span_id).not.toBe(fromB[0].span_id);
    expect(fromA[1].parent_id).toBe(fromA[0].span_id);
    expect(fromB[1].parent_id).toBe(fromB[0].span_id);
    expect(getActivityRefFromSpan(fromB[1])).toEqual({ activityId: 2, sourceId: 'source-3' });
    // The directive link would be read as one of the page's directives; the analysis has none.
    expect(fromA[1].attributes.directiveId).toBeUndefined();
    expect(fromA[1].attributes.arguments).toEqual({ biteSize: 1 });
  });

  it('draws an imported activity with its name, times and parameters', () => {
    const activity = importedActivityToSpan('source-1', {
      category: 'DSN',
      end_time: '2031-01-01T05:00:00Z',
      id: 128325,
      name: 'DSS-54 pass',
      parameters: { stationId: 'DSS_54' },
      start_time: '2031-01-01T00:00:00Z',
      type: 'DSN_Pass',
    });
    expect(activity).toMatchObject({
      durationMs: 5 * 3600000,
      name: 'DSS-54 pass',
      sourceActivityId: 128325,
      sourceId: 'source-1',
      type: 'DSN_Pass',
    });
    expect(activity.attributes.arguments).toEqual({ stationId: 'DSS_54' });
    expect(getActivityRefFromDrawingId(activity.span_id)).toEqual({ activityId: 128325, sourceId: 'source-1' });
  });
});

describe('createAnalysisSources', () => {
  it('tells two revisions of one source imported the same day apart by time', () => {
    const later = { ...revision, id: 19, requested_at: '2026-10-03T15:30:00Z' };
    const sources = createAnalysisSources(
      input({
        bindings: [imported, { id: 'source-2', kind: 'imported', revisionId: 19 }],
        revisions: [revision, later],
      }),
    );
    expect(sources.map(({ label }) => label)).toEqual([
      'mission tour TOL · Oct 3, 2026, 12:00 UTC',
      'mission tour TOL · Oct 3, 2026, 15:30 UTC',
    ]);
  });

  it('makes an imported revision a source of resources and activities', () => {
    const sources = createAnalysisSources(input());
    const source = sources[0];
    expect(source).toMatchObject({
      group: 'Imported Sources',
      id: 'source-1',
      kind: 'imported',
      // Named for people: the source and when its revision was imported, never the database id.
      label: 'mission tour TOL · Oct 3, 2026',
    });
    expect(source.resources?.catalog.map(type => type.name)).toEqual(['BatteryStateOfCharge']);
    expect(source.intervals?.present).toEqual([
      { count: 3117, name: 'DSN_Pass' },
      { count: 10, name: 'Turn' },
    ]);
    // Browsing groups activity types by the source's own category.
    const activities = source.browserNodes.find(node => node.id === 'source-1/activities');
    expect(activities?.children?.map(node => node.label)).toEqual(['DSN', 'GNC']);
    expect(activities?.children?.[0].children?.[0].action).toMatchObject({
      sourceId: 'source-1',
      typeName: 'activity',
    });
  });

  it('subscribes to an imported revision’s activities and resources with the request', () => {
    const subscribeImportedActivities = vi.fn((): TimelineActivitySubscription => createStaticActivitySubscription(''));
    const subscribeImportedResource = vi.fn(
      (): TimelineResourceSubscription =>
        createStaticResourceSubscription({ error: '', loading: false, resource: null }),
    );
    const [source] = createAnalysisSources(input({ subscribeImportedActivities, subscribeImportedResource }));
    source.intervals?.subscribe?.({ types: ['DSN_Pass'] }, context);
    expect(subscribeImportedActivities).toHaveBeenCalledWith(imported, revision, { types: ['DSN_Pass'] }, context);
    source.resources?.subscribe('BatteryStateOfCharge', context);
    expect(subscribeImportedResource).toHaveBeenCalledWith(imported, revision, revision.resources[0], context);
  });

  it('makes any plan’s simulation dataset a read-only source, with no plan on the page', () => {
    const subscribeSimulationProfile = vi.fn(
      (): TimelineResourceSubscription =>
        createStaticResourceSubscription({ error: '', loading: false, resource: null }),
    );
    const subscribeSimulationActivities = vi.fn(
      (): TimelineActivitySubscription => createStaticActivitySubscription(''),
    );
    const sources = createAnalysisSources(input({ subscribeSimulationActivities, subscribeSimulationProfile }));
    expect(sources.map(source => source.label)).toEqual([
      'mission tour TOL · Oct 3, 2026',
      'Tour Plan A · Simulation 1',
      'Tour Plan B · Simulation 2',
    ]);
    const planBSource = sources[2];
    expect(planBSource).toMatchObject({ group: 'Simulations', kind: 'simulation' });
    expect(planBSource.intervals?.hasDirectives).toBe(false);
    expect(planBSource.intervals?.present).toEqual([{ count: 9, name: 'BiteBanana' }]);
    planBSource.resources?.subscribe('/fruit', context);
    expect(subscribeSimulationProfile).toHaveBeenCalledWith(planB, dataset(2, 'Tour Plan B'), '/fruit', context);
    planBSource.intervals?.subscribe?.({ types: null }, context);
    expect(subscribeSimulationActivities).toHaveBeenCalledWith(planB, dataset(2, 'Tour Plan B'), context);
  });

  it('reports a source whose revision is gone as unavailable, and never serves another', () => {
    const subscribeImportedActivities = vi.fn((): TimelineActivitySubscription => createStaticActivitySubscription(''));
    const [source] = createAnalysisSources(input({ revisions: [], subscribeImportedActivities }));
    expect(source.resources?.unavailableReason).toBe('The revision no longer exists');
    const subscription = source.intervals?.subscribe?.({ types: null }, context);
    expect(subscribeImportedActivities).not.toHaveBeenCalled();
    expect(get(subscription!.store).error).toBe('The revision no longer exists');
    // A layer bound to it resolves to the source (which explains itself), not to a same-named resource elsewhere.
    const registry = { loading: false, sources: createAnalysisSources(input({ revisions: [] })) };
    expect(resolveResourceLayerSource({ sourceId: 'source-1' }, registry)).toMatchObject({ kind: 'source' });
  });
});

describe('a plan as an analysis source', () => {
  const plan = {
    duration: '168:00:00',
    id: 3,
    mission_model: null,
    model_id: 1,
    name: 'Tour Plan A',
    revision: 7,
    start_time: '2031-01-01T00:00:00+00:00',
  };
  const current: AnalysisSourceBinding = { id: 'source-4', kind: 'plan', planId: 3 };

  it('reads the plan’s current directives, live, with no invented duration', () => {
    const span = planDirectiveToSpan('source-4', {
      anchor_id: null,
      anchored_to_start: true,
      approximate_start_time: '2031-01-01T05:00:00+00:00',
      arguments: { peelDirection: 'fromStem' },
      id: 12,
      metadata: {},
      name: '',
      start_offset: '05:00:00',
      type: 'PeelBanana',
    });
    expect(span).toMatchObject({ durationMs: 0, endUnknown: true, name: 'PeelBanana', sourceActivityId: 12 });
    expect(span.endMs).toBe(span.startMs);

    const subscribePlanActivities = vi.fn((): TimelineActivitySubscription => createStaticActivitySubscription(''));
    const [source] = createAnalysisSources(
      input({
        bindings: [current],
        planTypeCounts: { 3: [{ count: 2, name: 'PeelBanana' }] },
        plans: [plan],
        subscribePlanActivities,
      }),
    );
    expect(source).toMatchObject({ group: 'Plans', kind: 'plan', label: 'Tour Plan A · Current' });
    expect(source.resources).toBeUndefined();
    source.intervals?.subscribe?.({ types: null }, context);
    expect(subscribePlanActivities).toHaveBeenCalledWith(current, plan, context);
  });

  it('is told apart from the same plan’s simulations, in the table query too', () => {
    expect(getAnalysisSourceNames(current, { plan }).version).toBe('Current activities');
    expect(getAnalysisSourceNames(planA, { dataset: dataset(1, 'Tour Plan A') }).label).toBe(
      'Tour Plan A · Simulation 1',
    );
    expect(getAnalysisActivityWhere([current], { sourceIds: null, text: '', types: null })._and).toEqual([
      { _or: [{ source_kind: { _eq: 'plan' }, source_ref: { _eq: 3 } }] },
    ]);
    expect(getAnalysisActivityRowRef([current], { activity_id: 12, source_kind: 'plan', source_ref: 3 })).toEqual({
      activityId: 12,
      sourceId: 'source-4',
    });
  });

  it('opens on the plan’s bounds when there is no simulation', () => {
    expect(getAnalysisTimeRanges([], [], [plan])?.initial).toEqual({
      end: Date.parse('2031-01-08T00:00:00Z'),
      start: Date.parse('2031-01-01T00:00:00Z'),
    });
  });
});

describe('source identity', () => {
  it('names a revision by its product date, else by when it was imported', () => {
    expect(
      getRevisionVersionLabel({ ...revision, metadata: { product: { generatedAt: '2026-10-01T08:00:00Z' } } }),
    ).toBe('Oct 1, 2026 product');
    expect(getRevisionVersionLabel(revision)).toBe('Imported Oct 3, 2026, 12:00 UTC');
  });

  it('prefers the analysis’s alias, and keeps the source’s own name beside it', () => {
    expect(getAnalysisSourceNames({ ...imported, label: 'Actual Tour' }, { revision })).toEqual({
      label: 'Actual Tour',
      name: 'mission tour TOL',
      version: 'Imported Oct 3, 2026, 12:00 UTC',
    });
  });

  it('offers a newer successful revision of the same source, and nothing when the bound one is newest', () => {
    const newer = { id: 22, metadata: {}, requested_at: '2026-10-04T09:00:00Z', status: 'success' as const };
    expect(getNewerRevision({ ...revision, source: { ...revision.source, latest: [newer] } })).toBe(newer);
    expect(
      getNewerRevision({ ...revision, source: { ...revision.source, latest: [{ ...newer, id: 18 }] } }),
    ).toBeNull();
  });
  it('lists the analyses using each revision, once each', () => {
    const tour = { id: 1, name: 'Tour', owner: 'a', sources: [imported, { ...imported, id: 'source-2' }, planA] };
    const empty = { id: 2, name: 'Empty', owner: 'a', sources: null };
    expect(getRevisionUsage([tour, empty])).toEqual({ 18: [tour] });
  });

  it('offers only adapters a running worker reported recently', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    const live = { id: 'xml_tol', last_seen_at: '2026-10-04T11:59:30Z' };
    const gone = { id: 'old_format', last_seen_at: '2026-10-01T09:00:00Z' };
    expect(getAvailableAdapters([live, gone], now)).toEqual([live]);
  });

  it('picks the latest successful revision as usable, keeping newer attempts and older revisions apart', () => {
    const [r31, r30, r29, r28] = [
      { id: 31, status: 'failed' },
      { id: 30, status: 'importing' },
      { id: 29, status: 'success' },
      { id: 28, status: 'success' },
    ];
    expect(splitSourceRevisions([r31, r30, r29, r28])).toEqual({ older: [r28], pending: [r31, r30], usable: r29 });
    expect(splitSourceRevisions([r31])).toEqual({ older: [], pending: [r31], usable: null });
  });
});

describe('analysis activity table query', () => {
  const bindings = [imported, planA, planB];

  it('reads the analysis’s sources, narrowed by source, type and text', () => {
    expect(getAnalysisActivityWhere(bindings, { sourceIds: null, text: '', types: null })).toEqual({
      _and: [
        {
          _or: [
            { source_kind: { _eq: 'revision' }, source_ref: { _eq: 18 } },
            { source_kind: { _eq: 'simulation' }, source_ref: { _eq: 1 } },
            { source_kind: { _eq: 'simulation' }, source_ref: { _eq: 2 } },
          ],
        },
      ],
    });
    expect(
      getAnalysisActivityWhere(bindings, { sourceIds: ['source-3'], text: ' 50%_bite ', types: ['BiteBanana'] }),
    ).toEqual({
      _and: [
        { _or: [{ source_kind: { _eq: 'simulation' }, source_ref: { _eq: 2 } }] },
        { type: { _in: ['BiteBanana'] } },
        { _or: [{ name: { _ilike: '%50\\%\\_bite%' } }, { type: { _ilike: '%50\\%\\_bite%' } }] },
      ],
    });
  });

  it('scopes to a time range: overlapping activities, and directives (no end) starting in it', () => {
    const where = getAnalysisActivityWhere([imported], {
      sourceIds: null,
      text: '',
      timeRange: { end: Date.parse('2030-01-02T00:00:00Z'), start: Date.parse('2030-01-01T00:00:00Z') },
      types: null,
    });
    expect((where._and as unknown[])[1]).toEqual({
      _or: [
        { end_time: { _gte: '2030-01-01T00:00:00.000Z' }, start_time: { _lte: '2030-01-02T00:00:00.000Z' } },
        {
          end_time: { _is_null: true },
          start_time: { _gte: '2030-01-01T00:00:00.000Z', _lte: '2030-01-02T00:00:00.000Z' },
        },
      ],
    });
  });

  it('matches nothing, not everything, when no source is included', () => {
    expect(getAnalysisActivityWhere([], { sourceIds: null, text: '', types: null })).toEqual({
      _and: [{ activity_id: { _is_null: true } }],
    });
  });

  it('maps a table row back to the source it came from', () => {
    expect(getAnalysisActivityRowRef(bindings, { activity_id: 4, source_kind: 'simulation', source_ref: 2 })).toEqual({
      activityId: 4,
      sourceId: 'source-3',
    });
    expect(getAnalysisActivityRowRef(bindings, { activity_id: 4, source_kind: 'revision', source_ref: 2 })).toBeNull();
  });

  it('counts the rows before an activity in the table’s order, to find its index', () => {
    const row = {
      activity_id: 7,
      source_kind: 'simulation' as const,
      source_ref: 1,
      start_time: '2031-01-01T07:00:00Z',
    };
    const where = getAnalysisActivitiesBeforeWhere(row, 'asc');
    expect(where._or).toHaveLength(4);
    expect(where._or).toContainEqual({ start_time: { _lt: '2031-01-01T07:00:00Z' } });
    expect(getAnalysisActivitiesBeforeWhere(row, 'desc')._or).toContainEqual({
      start_time: { _gt: '2031-01-01T07:00:00Z' },
    });
  });
});

describe('analysis sources and time', () => {
  it('never reuses a source id', () => {
    expect(getNextAnalysisSourceId([])).toBe('source-1');
    expect(getNextAnalysisSourceId([planB])).toBe('source-4');
  });

  it('opens on the simulations, and zooms out to everything the sources cover', () => {
    const ranges = getAnalysisTimeRanges([revision], [dataset(1, 'A')]);
    expect(ranges?.initial).toEqual({
      end: Date.parse('2031-01-08T00:00:00Z'),
      start: Date.parse('2031-01-01T00:00:00Z'),
    });
    expect(ranges?.max).toEqual({ end: Date.parse('2034-09-03T00:00:00Z'), start: Date.parse('2024-10-06T00:00:00Z') });
    expect(getAnalysisTimeRanges([revision], [])?.initial).toEqual(ranges?.max);
  });

  it('removes a source’s layers, the rows only it filled, and the axes and guides only it used', () => {
    const row = (id: number, layers: Row['layers'], extra: Partial<Row> = {}): Row =>
      ({ horizontalGuides: [], id, layers, name: `row ${id}`, yAxes: [], ...extra }) as unknown as Row;
    const layer = (id: number, sourceId: string, yAxisId: number | null = null) =>
      ({ chartType: 'line', filter: {}, id, sourceId, yAxisId }) as unknown as Row['layers'][number];
    const timelines = [
      {
        id: 0,
        rows: [
          row(1, [layer(1, 'source-2', 1), layer(2, 'source-3', 2)], {
            horizontalGuides: [
              { id: 1, label: { text: '' }, y: 1, yAxisId: 1 },
              { id: 2, label: { text: '' }, y: 1, yAxisId: 2 },
            ],
            yAxes: [{ id: 1 }, { id: 2 }] as Row['yAxes'],
          }),
          row(2, [layer(3, 'source-3')]),
          row(3, [layer(4, 'source-1')]),
          row(4, []),
        ],
      },
    ] as unknown as Timeline[];
    const [{ rows }] = removeSourceFromTimelines(timelines, 'source-3');
    expect(rows.map(r => r.id)).toEqual([1, 3, 4]);
    expect(rows[0].layers.map(l => l.id)).toEqual([1]);
    expect(rows[0].yAxes.map(a => a.id)).toEqual([1]);
    expect(rows[0].horizontalGuides.map(g => g.id)).toEqual([1]);
    expect(rows[1]).toBe(timelines[0].rows[2]);
  });
});

describe('activities of several sources in one row', () => {
  it('keeps a type two sources share in two groups, each labelled with its source', () => {
    const spans = [
      simulationSpanToActivity('source-2', span(1, 'BiteBanana')),
      simulationSpanToActivity('source-3', span(1, 'BiteBanana')),
      simulationSpanToActivity('source-3', span(2, 'GrowBanana')),
    ];
    const maps = { directiveIdToSpanIdMap: {}, spanIdToChildIdsMap: {}, spanIdToDirectiveIdMap: {} };
    const tree = (labels?: Record<string, string>) =>
      generateDiscreteTreeUtil(
        [],
        spans,
        [],
        {},
        'flat',
        'event_type_name',
        false,
        maps,
        {},
        true,
        false,
        { end: 1, start: 0 },
        false,
        true,
        labels,
      );
    expect(tree().map(node => [node.label, node.items?.length])).toEqual([
      ['BiteBanana', 2],
      ['GrowBanana', 1],
    ]);
    expect(tree({ 'source-2': 'Plan A', 'source-3': 'Plan B' }).map(node => [node.label, node.items?.length])).toEqual([
      ['BiteBanana · Plan A', 1],
      ['BiteBanana · Plan B', 1],
      ['GrowBanana · Plan B', 1],
    ]);
  });
});
