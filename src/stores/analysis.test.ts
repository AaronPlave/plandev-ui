import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, AnalysisDefinition } from '../types/analysis';
import type { User } from '../types/app';
import type { Row } from '../types/timeline';
import { createAnalysisDefinition } from '../utilities/analysis';
import { resolveResourceLayerSource } from '../utilities/timelineSources';

const effects = vi.hoisted(() => ({
  getAnalysisSimulationDatasets: vi.fn(),
  getAnalysisSourceRevisions: vi.fn(),
  getSpans: vi.fn(),
  updateAnalysis: vi.fn(),
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('./subscribable', () => ({ gqlSubscribable: () => ({ loading: { subscribe: () => () => {} } }) }));

const {
  addAnalysisSource,
  analysisSourceBindings,
  analysisTimelineSources,
  autosaveAnalysis,
  closeAnalysis,
  openAnalysis,
  removeAnalysisSource,
  selectedAnalysisActivity,
} = await import('./analysis');
const { viewTimeRange } = await import('./plan');
const { view } = await import('./views');

const user = {
  activeRole: 'user',
  id: 'test',
  permissibleQueries: { update_analysis: true },
  token: 't',
} as unknown as User;

const revision = {
  activity_types: [{ category: 'DSN', count: 2, first_start: null, last_end: null, type: 'DSN_Pass' }],
  coverage_end: '2034-09-03T00:00:00Z',
  coverage_start: '2030-04-27T00:00:00Z',
  id: 18,
  resources: [
    {
      category: 'Power',
      coverage_end: null,
      coverage_start: null,
      interpolation: 'linear',
      key: 'BatteryStateOfCharge',
      numeric: true,
      sample_count: 1,
      schema: { type: 'real' },
      units: '%',
    },
  ],
  source: { id: 1, name: 'TOL', source_type: 'xml_tol' },
  status: 'success',
};
const simulation = {
  dataset: { profiles: [{ name: '/fruit', type: { schema: { type: 'real' } } }] },
  dataset_id: 6,
  id: 1,
  simulation: { plan: { id: 3, name: 'Tour Plan A' } },
  simulation_end_time: '2031-01-08T00:00:00Z',
  simulation_start_time: '2031-01-01T00:00:00Z',
  status: 'success',
};

function savedAnalysis(definition: AnalysisDefinition): Analysis {
  return { created_at: '', definition, id: 4, name: 'Tour Comparison', owner: 'test', updated_at: '' };
}

/** A definition with a TOL resource row and a row showing both sources' activities. */
function definitionWithRows(): AnalysisDefinition {
  const definition = createAnalysisDefinition();
  const rows = [
    {
      id: 1,
      layers: [
        { chartType: 'line', filter: { resource: 'BatteryStateOfCharge' }, id: 1, sourceId: 'source-1', yAxisId: 1 },
      ],
      yAxes: [{ id: 1 }],
    },
    {
      id: 2,
      layers: [
        {
          chartType: 'activity',
          filter: { activity: { static_types: ['DSN_Pass'] } },
          id: 2,
          sourceId: 'source-1',
          yAxisId: null,
        },
        {
          chartType: 'activity',
          filter: { activity: { static_types: ['BiteBanana'] } },
          id: 3,
          sourceId: 'source-2',
          yAxisId: null,
        },
      ],
      yAxes: [],
    },
  ].map(row => ({ horizontalGuides: [], name: `row ${row.id}`, ...row }) as unknown as Row);
  definition.view.plan.timelines[0].rows = rows;
  definition.sources = [
    { id: 'source-1', kind: 'imported', revisionId: 18 },
    { id: 'source-2', kind: 'simulation', simulationDatasetId: 1 },
  ];
  return definition;
}

describe('analysis store', () => {
  beforeEach(() => {
    effects.getAnalysisSourceRevisions.mockImplementation(async (ids: number[]) =>
      ids.includes(18) ? [revision] : [],
    );
    effects.getAnalysisSimulationDatasets.mockImplementation(async (ids: number[]) =>
      ids.includes(1) ? [simulation] : [],
    );
    effects.getSpans.mockResolvedValue([]);
    effects.updateAnalysis.mockResolvedValue('2026-10-02T00:00:00Z');
  });
  afterEach(() => {
    closeAnalysis();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("restores a saved analysis: its source bindings and rows, opening on its sources' time range", async () => {
    await openAnalysis(savedAnalysis(definitionWithRows()), user);
    expect(get(analysisSourceBindings).map(binding => binding.id)).toEqual(['source-1', 'source-2']);
    expect(get(view)?.definition.plan.timelines[0].rows.map(row => row.layers.map(layer => layer.sourceId))).toEqual([
      ['source-1'],
      ['source-1', 'source-2'],
    ]);
    expect(get(viewTimeRange)).toEqual({
      end: Date.parse(simulation.simulation_end_time),
      start: Date.parse(simulation.simulation_start_time),
    });
    // Every saved layer finds its source again, by the id it stored.
    const registry = get(analysisTimelineSources);
    expect(registry.sources.map(source => source.id)).toEqual(['source-1', 'source-2']);
    expect(resolveResourceLayerSource({ sourceId: 'source-1' }, registry)).toMatchObject({ kind: 'source' });
    expect(registry.sources[1].intervals?.subscribe).toBeTypeOf('function');
    expect(effects.getAnalysisSimulationDatasets).toHaveBeenCalledWith([1], user);
  });

  it('saves added sources and view state, and a reopened analysis gets them back', async () => {
    vi.useFakeTimers();
    await openAnalysis(savedAnalysis(createAnalysisDefinition()), user);
    const stop = autosaveAnalysis(user);
    await addAnalysisSource({ kind: 'simulation', simulationDatasetId: 1 }, user);
    await addAnalysisSource({ kind: 'imported', revisionId: 18 }, user);
    await addAnalysisSource({ kind: 'imported', revisionId: 18 }, user); // already there: not added twice
    await vi.advanceTimersByTimeAsync(1500);
    expect(effects.updateAnalysis).toHaveBeenCalled();
    const [, { definition }] = effects.updateAnalysis.mock.calls.at(-1)!;
    expect(definition.sources).toEqual([
      { id: 'source-1', kind: 'simulation', simulationDatasetId: 1 },
      { id: 'source-2', kind: 'imported', revisionId: 18 },
    ]);
    expect(definition.view.plan.timelines).toHaveLength(1);
    stop();

    closeAnalysis();
    await openAnalysis(savedAnalysis(definition), user);
    expect(get(analysisSourceBindings)).toEqual(definition.sources);
  });

  it("doesn't save for someone who can't update the analysis", async () => {
    vi.useFakeTimers();
    await openAnalysis({ ...savedAnalysis(createAnalysisDefinition()), owner: 'someone-else' }, user);
    const stop = autosaveAnalysis(user);
    await addAnalysisSource({ kind: 'simulation', simulationDatasetId: 1 }, user);
    await vi.advanceTimersByTimeAsync(1500);
    expect(effects.updateAnalysis).not.toHaveBeenCalled();
    stop();
  });

  it('removing a source removes the rows only it filled and keeps the rest of a shared row', async () => {
    await openAnalysis(savedAnalysis(definitionWithRows()), user);
    selectedAnalysisActivity.set({ activityId: 5, sourceId: 'source-1' });
    await removeAnalysisSource('source-1', user);
    const rows = get(view)?.definition.plan.timelines[0].rows ?? [];
    expect(rows.map(row => row.id)).toEqual([2]);
    expect(rows[0].layers.map(layer => layer.sourceId)).toEqual(['source-2']);
    expect(get(analysisSourceBindings).map(binding => binding.id)).toEqual(['source-2']);
    expect(get(selectedAnalysisActivity)).toBeNull();
  });
});
