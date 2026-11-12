import { get } from 'svelte/store';
import { describe, expect, test, vi } from 'vitest';
import type { ExternalEvent } from '../types/external-event';
import type { PlanSource } from '../types/importedSource';
import type { PlanDataset, ResourceType, SimulationDataset, Span } from '../types/simulation';
import type { SourceBrowserNode, TimelineSourceRegistry } from '../types/timelineSource';
import {
  createExternalDatasetSources,
  createExternalEventsSource,
  createImportedSources,
  createPlanSimulationSource,
  EXTERNAL_EVENTS_SOURCE_ID,
  filterSourceBrowserNodes,
  findLegacyResourceType,
  findResourceType,
  getExternalDatasetSourceId,
  getLayerResourceRequestKey,
  getResourceRequestKey,
  PLAN_SOURCE_ID,
  resolveActivityLayerSourceId,
  resolveResourceLayerSource,
  selectLegacyExternalProfile,
} from './timelineSources';
import { createTimelineResourceLayer, createRow, rebindResourceLayer } from './timeline';

const soc: ResourceType = { name: '/battery/soc', schema: { type: 'real' } };

function planDataset(datasetId: number, simulationDatasetId: number | null, names: string[]): PlanDataset {
  return {
    dataset: {
      profiles: names.map((name, i) => ({
        dataset_id: datasetId,
        duration: '24:00:00',
        id: datasetId * 100 + i,
        name,
        profile_segments: [],
        type: { schema: { type: 'real' }, type: 'real' },
      })),
    },
    dataset_id: datasetId,
    offset_from_plan_start: '00:00:00',
    simulation_dataset_id: simulationDatasetId,
  };
}

const externalEvent = (derivation_group_name: string, source_key: string, event_type_name: string, key: string) =>
  ({ pkey: { derivation_group_name, event_type_name, key, source_key } }) as ExternalEvent;

const staticSubscription = () => ({
  store: { subscribe: (run: (value: unknown) => void) => (run(null), () => {}) },
  unsubscribe: () => {},
});

function planSource(simulationDataset: SimulationDataset | null, spans: Span[] = []) {
  return createPlanSimulationSource({
    activityTypes: [],
    activityTypesLoading: false,
    modelResourceTypes: [soc, { name: '/mode', schema: { type: 'string' } }],
    profileCatalog: [soc],
    profileCatalogLoading: false,
    simulationDataset,
    spans,
    subscribeProfile: vi.fn(staticSubscription) as any,
  });
}

const externalSources = createExternalDatasetSources({
  planDatasets: [planDataset(12, null, ['/battery/soc']), planDataset(11, 7, ['/battery/soc', '/power'])],
  simulationDatasetId: 7,
  subscribeExternal: vi.fn(staticSubscription) as any,
});

const registry: TimelineSourceRegistry = {
  loading: false,
  sources: [planSource({ dataset_id: 40, id: 7 } as SimulationDataset), ...externalSources],
};

describe('source identity', () => {
  test('each plan_dataset is its own source, even when profile names collide', () => {
    expect(externalSources.map(source => source.id)).toEqual(['external-dataset:11', 'external-dataset:12']);
    expect(externalSources.map(source => source.resources?.catalog.map(type => type.name))).toEqual([
      ['/battery/soc', '/power'],
      ['/battery/soc'],
    ]);
    expect(externalSources[0].description).toContain('Tied to the selected simulation (7)');
    expect(externalSources[1].description).toContain('Plan-level');
  });

  test('resource request keys never alias across sources or with the legacy namespace', () => {
    const keys = [
      getResourceRequestKey(undefined, '/battery/soc'),
      getResourceRequestKey(PLAN_SOURCE_ID, '/battery/soc'),
      getResourceRequestKey(getExternalDatasetSourceId(11), '/battery/soc'),
      getResourceRequestKey(getExternalDatasetSourceId(12), '/battery/soc'),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(getLayerResourceRequestKey({ filter: {} })).toBeNull();
  });

  test('the data revision is separate from the stable source id', () => {
    const simulated7 = planSource({ dataset_id: 40, id: 7 } as SimulationDataset);
    const simulated8 = planSource({ dataset_id: 41, id: 8 } as SimulationDataset);
    expect(simulated7.id).toBe(simulated8.id);
    expect(simulated7.resources?.revisionKey).not.toBe(simulated8.resources?.revisionKey);
  });
});

describe('layer source resolution', () => {
  test('legacy resource layers keep the merged lookup; activity layers default to the Plan', () => {
    expect(resolveResourceLayerSource({}, registry)).toEqual({ kind: 'legacy' });
    expect(resolveActivityLayerSourceId({})).toBe(PLAN_SOURCE_ID);
  });

  test('a bound layer resolves to its own source', () => {
    const resolution = resolveResourceLayerSource({ sourceId: 'external-dataset:12' }, registry);
    expect(resolution.kind === 'source' && resolution.source.id).toBe('external-dataset:12');
  });

  test('a missing source is unavailable, never rebound, and only while the registry is settled', () => {
    expect(resolveResourceLayerSource({ sourceId: 'external-dataset:99' }, registry)).toEqual({
      kind: 'unavailable',
      message: 'Source "external-dataset:99" is not available in this plan',
    });
    expect(resolveResourceLayerSource({ sourceId: 'external-dataset:99' }, { ...registry, loading: true })).toEqual({
      kind: 'loading',
    });
  });

  test('without simulation results the Plan source serves an explanatory error instead of data', () => {
    const source = planSource(null);
    // Layers can be bound to model resources before the plan is simulated.
    expect(source.resources?.catalog.map(type => type.name)).toEqual(['/battery/soc', '/mode']);
    const subscription = source.resources?.subscribe('/battery/soc', {
      plan: { start_time: '2029-001T00:00:00' } as any,
      simulationDataset: null,
      user: null,
    });
    expect(subscription && get(subscription.store)).toEqual({
      error: 'The plan has no simulation results',
      loading: false,
      resource: null,
    });
  });
});

describe('source browser adapters', () => {
  test('the Plan source lists simulated resources and the activity types present in spans', () => {
    const spans = [{ type: 'OBSERVE' }, { type: 'SLEW' }, { type: 'OBSERVE' }] as Span[];
    const [resources, activities] = planSource({ dataset_id: 40, id: 7 } as SimulationDataset, spans).browserNodes;
    expect(resources.children?.map(node => [node.label, node.action?.sourceId, node.action?.typeName])).toEqual([
      ['/battery/soc', PLAN_SOURCE_ID, 'resource'],
    ]);
    expect(activities.children?.map(node => [node.label, node.badge, node.action?.typeName])).toEqual([
      ['OBSERVE', '2', 'activity'],
      ['SLEW', '1', 'activity'],
    ]);
  });

  test('an imported revision with activities offers them by category and type, and serves them once it is ready', () => {
    const subscribeActivities = vi.fn(() => ({
      store: { subscribe: () => () => {} },
      unsubscribe: () => {},
    }));
    const planSource = (status: string) =>
      ({
        id: 5,
        label: null,
        source_revision: {
          activity_types: [
            { category: 'DSN', count: 38, parameters: {}, type: 'ALLOCATION' },
            { category: 'DSN', count: 700, parameters: {}, type: 'STATION_VIEW' },
          ],
          coverage_end: null,
          coverage_start: null,
          id: 110,
          progress: {},
          resources: [],
          source: { id: 1, name: 'cruise015', source_type: 'pef_json' },
          status,
        },
      }) as unknown as PlanSource;
    const [source] = createImportedSources({
      planSources: [planSource('success')],
      subscribeActivities,
      subscribeImported: vi.fn(),
    });
    const [activities] = source.browserNodes;
    expect(activities.label).toEqual('Activities (738)');
    expect(activities.children?.[0].children?.map(node => [node.label, node.badge, node.action?.sourceId])).toEqual([
      ['ALLOCATION', '38', 'imported:5'],
      ['STATION_VIEW', '700', 'imported:5'],
    ]);
    source.intervals?.subscribe?.({ types: ['ALLOCATION'] }, { plan: null, simulationDataset: null, user: null });
    expect(subscribeActivities).toHaveBeenCalledOnce();

    const [pending] = createImportedSources({
      planSources: [planSource('pending')],
      subscribeActivities,
      subscribeImported: vi.fn(),
    });
    pending.intervals?.subscribe?.({ types: null }, { plan: null, simulationDataset: null, user: null });
    expect(subscribeActivities).toHaveBeenCalledOnce();
  });

  test('external events keep derivation group > source > event type, and each leaf carries its source scope', () => {
    const event = externalEvent;
    const source = createExternalEventsSource({
      acknowledged: { 'DG B': { last_acknowledged_at: '' } },
      derivationGroups: [
        { derived_event_total: 2, name: 'DG A', owner: 'a', source_type_name: 'DSN', sources: ['a.json', 'b.json'] },
        { derived_event_total: 1, name: 'DG B', owner: 'a', source_type_name: 'Ephemeris', sources: ['c.json'] },
      ],
      eventTypes: [{ attribute_schema: {}, name: 'Pass' }],
      events: [
        event('DG A', 'a.json', 'Pass', '1'),
        event('DG A', 'a.json', 'Pass', '2'),
        event('DG B', 'c.json', 'Eclipse', '1'),
      ],
      loading: false,
      planDerivationGroupLinks: [
        { acknowledged: true, derivation_group_name: 'DG B', last_acknowledged_at: '', plan_id: 1 },
        { acknowledged: true, derivation_group_name: 'DG A', last_acknowledged_at: '', plan_id: 1 },
      ],
      visibility: { 'DG A': false },
    });
    expect(source.id).toBe(EXTERNAL_EVENTS_SOURCE_ID);
    expect(source.resources).toBeUndefined();
    expect(source.intervals).toBeUndefined();
    expect(source.events?.catalog.map(type => type.name)).toEqual(['Eclipse', 'Pass']);
    const shape = (nodes: SourceBrowserNode[]): unknown =>
      nodes.map(node =>
        node.children ? [node.label, node.tags ?? [], shape(node.children)] : [node.label, node.badge],
      );
    expect(shape(source.browserNodes)).toEqual([
      [
        'DG A',
        ['DSN', 'hidden'],
        [
          ['a.json', [], [['Pass', '2']]],
          ['b.json', [], []],
        ],
      ],
      ['DG B', ['Ephemeris', 'updated'], [['c.json', [], [['Eclipse', '1']]]]],
    ]);
    const pass = source.browserNodes[0].children?.[0].children?.[0];
    expect(pass?.action).toEqual({
      externalSources: [{ derivation_group_name: 'DG A', source_key: 'a.json' }],
      item: { attribute_schema: {}, name: 'Pass' },
      sourceId: null,
      typeName: 'externalEvent',
    });
  });

  test('filtering keeps matching items with their ancestors', () => {
    const filtered = filterSourceBrowserNodes(registry.sources[0].browserNodes, 'soc');
    expect(filtered.map(node => [node.label, node.children?.map(child => child.label)])).toEqual([
      ['Resources (1)', ['/battery/soc']],
    ]);
  });
});

describe('legacy resource resolution', () => {
  // A dataset with one real profile of the given unit, tied to a simulation dataset or plan-level (null).
  const dataset = (datasetId: number, simulationDatasetId: number | null, name: string, unit: string): PlanDataset => ({
    dataset: {
      profiles: [
        {
          dataset_id: datasetId,
          duration: '24:00:00',
          id: datasetId * 100,
          name,
          profile_segments: [],
          type: { schema: { metadata: { unit: { value: unit } }, type: 'real' }, type: 'real' },
        } as PlanDataset['dataset']['profiles'][number],
      ],
    },
    dataset_id: datasetId,
    offset_from_plan_start: '00:00:00',
    simulation_dataset_id: simulationDatasetId,
  });
  const unitOf = (type: ResourceType | null) => type?.schema.metadata?.unit?.value;
  const legacyContext = (
    planDatasets: PlanDataset[],
    simulationDatasetId: number | null,
    modelResourceTypes = [soc],
  ) => {
    const sources = createExternalDatasetSources({
      planDatasets,
      simulationDatasetId: simulationDatasetId ?? -1,
      subscribeExternal: vi.fn(staticSubscription) as any,
    });
    return {
      modelResourceTypes,
      planDatasets,
      registry: { loading: false, sources: [planSource({ dataset_id: 40, id: 10 } as SimulationDataset), ...sources] },
      simulationDatasetId,
    };
  };
  // Dataset 50 (plan-level, W) comes first in both planDatasets and the registry; Dataset 51 (kW) is tied to sim 10.
  const datasets = [dataset(50, null, '/power', 'W'), dataset(51, 10, '/power', 'kW')];

  test('the selected-simulation dataset wins over registry order, for data and declaration alike', () => {
    const context = legacyContext(datasets, 10);
    expect(context.registry.sources.map(source => source.id).slice(1)).toEqual([
      'external-dataset:50',
      'external-dataset:51',
    ]);
    expect(unitOf(findResourceType(context.registry, undefined, '/power'))).toBe('W'); // registry order: not used
    expect(selectLegacyExternalProfile(datasets, 10, '/power')?.datasetId).toBe(51);
    expect(unitOf(findLegacyResourceType(context, '/power'))).toBe('kW');
  });

  test('a model resource still reads the Plan simulation, even when datasets have the same name', () => {
    const power = { name: '/power', schema: { metadata: { unit: { value: 'mW' } }, type: 'real' } } as ResourceType;
    const context = legacyContext(datasets, 10, [power]);
    expect(unitOf(findLegacyResourceType(context, '/power'))).toBe('mW');
  });

  test('without a selected-simulation match the first plan-level row wins, then the first row in order', () => {
    const planLevel = [dataset(51, 99, '/foo', 'B'), dataset(50, null, '/foo', 'A'), dataset(52, null, '/foo', 'C')];
    expect(selectLegacyExternalProfile(planLevel, 10, '/foo')?.datasetId).toBe(50);
    expect(unitOf(findLegacyResourceType(legacyContext(planLevel, 10), '/foo'))).toBe('A');
    // Array order, not dataset id, decides the final fallback.
    const tiedElsewhere = [dataset(52, 98, '/foo', 'C'), dataset(50, 97, '/foo', 'A')];
    expect(selectLegacyExternalProfile(tiedElsewhere, 10, '/foo')?.datasetId).toBe(52);
    expect(selectLegacyExternalProfile(tiedElsewhere, null, '/foo')?.datasetId).toBe(52);
    expect(findLegacyResourceType(legacyContext(tiedElsewhere, 10), '/missing')).toBeNull();
  });

  test('binding a legacy kW layer to the W dataset drops its 500 kW guide and resets the axis', () => {
    const context = legacyContext(datasets, 10);
    const timelines = [{ id: 0, marginLeft: 0, marginRight: 0, rows: [], verticalGuides: [] }] as any;
    const displayed = findLegacyResourceType(context, '/power');
    const { layer, yAxis } = createTimelineResourceLayer(timelines, displayed as ResourceType);
    const row = createRow(timelines, {
      horizontalGuides: [{ id: 0, label: { text: '500' }, y: 500, yAxisId: yAxis.id }],
      layers: [layer!],
      yAxes: [{ ...yAxis, domainFitMode: 'manual', scaleDomain: [0, 1000] }],
    });
    const target = findResourceType(context.registry, 'external-dataset:50', '/power');
    const result = rebindResourceLayer(timelines, row, layer!, {
      previousResourceType: displayed,
      resourceName: '/power',
      resourceType: target,
      sourceId: 'external-dataset:50',
      sourceLabel: 'Dataset 50',
    });
    expect(result.horizontalGuides).toEqual([]);
    expect(result.yAxes[0]).toMatchObject({
      domainFitMode: 'fitTimeWindow',
      label: { text: '/power (W) · Dataset 50' },
    });
    expect(result.yAxes[0].scaleDomain).toBeUndefined();

    // What the old registry-order lookup would have inferred: W -> W, which would have kept the guide.
    const wrong = rebindResourceLayer(timelines, row, layer!, {
      previousResourceType: findResourceType(context.registry, undefined, '/power'),
      resourceName: '/power',
      resourceType: target,
      sourceId: 'external-dataset:50',
      sourceLabel: 'Dataset 50',
    });
    expect(wrong.horizontalGuides).toHaveLength(1);
  });
});
