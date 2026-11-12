import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, AnalysisDefinition } from '../types/analysis';
import type { User } from '../types/app';
import type { Row } from '../types/timeline';
import { createAnalysisDefinition, createSourceActivityRow } from '../utilities/analysis';
import { resolveResourceLayerSource } from '../utilities/timelineSources';

const effects = vi.hoisted(() => ({
  getAnalysisPlans: vi.fn(async () => []),
  getAnalysisSimulationDatasets: vi.fn(),
  getAnalysisSourceRecovery: vi.fn(async () => ({})),
  getAnalysisSourceRevisions: vi.fn(),
  getSpans: vi.fn(),
  updateAnalysis: vi.fn(),
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('./subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});

const {
  addAnalysisSource,
  analysisSourceBindings,
  analysisSourceRecovery,
  analysisTimelineSources,
  autosaveAnalysis,
  closeAnalysis,
  openAnalysis,
  rebindAnalysisSource,
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
  metadata: {},
  requested_at: '2026-10-03T12:00:00Z',
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
  source: { id: 1, latest: [], name: 'TOL', source_type: 'xml_tol' },
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

  it("opens a one-source analysis on the revision's coverage, with its activity row", async () => {
    const definition = createAnalysisDefinition();
    definition.sources = [{ id: 'source-1', kind: 'imported', revisionId: 18, sourceId: 1, sourceName: 'TOL' }];
    const [timeline] = definition.view.plan.timelines;
    timeline.rows = [createSourceActivityRow(definition.view.plan.timelines, 'source-1', 'Activities')];
    await openAnalysis(savedAnalysis(definition), user);
    expect(get(viewTimeRange)).toEqual({
      end: Date.parse(revision.coverage_end),
      start: Date.parse(revision.coverage_start),
    });
    const registry = get(analysisTimelineSources);
    expect(registry.sources.map(source => source.id)).toEqual(['source-1']);
    expect(get(view)?.definition.plan.timelines[0].rows[0].layers[0].sourceId).toBe('source-1');
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
      // Added with only its revision: the source it belongs to is recorded once the revision is read.
      { id: 'source-2', kind: 'imported', revisionId: 18, sourceId: 1, sourceName: 'TOL' },
    ]);
    expect(definition.view.plan.timelines).toHaveLength(1);
    expect(JSON.stringify(definition)).not.toContain('planRevision'); // a plan source is live: no revision is kept
    stop();

    closeAnalysis();
    await openAnalysis(savedAnalysis(definition), user);
    expect(get(analysisSourceBindings)).toEqual(definition.sources);
  });

  it('offers recovery for a revision that is really gone, not for one that could not be read', async () => {
    const definition = createAnalysisDefinition();
    definition.sources = [{ id: 'source-1', kind: 'imported', revisionId: 99, sourceId: 5, sourceName: 'TOL' }];
    const left = { id: 5, name: 'TOL', revisions: [{ id: 18, metadata: {}, requested_at: '', status: 'success' }] };

    // Read succeeded and the revision isn't there: deleted, and what is left of its source is offered.
    effects.getAnalysisSourceRecovery.mockResolvedValueOnce({ 5: left } as never);
    await openAnalysis(savedAnalysis(definition), user);
    expect(effects.getAnalysisSourceRecovery).toHaveBeenCalledWith([5], user);
    expect(get(analysisSourceRecovery)).toEqual({ 5: left });
    closeAnalysis();
    effects.getAnalysisSourceRecovery.mockClear();

    // Read failed: nothing is known, so no recovery is offered.
    effects.getAnalysisSourceRevisions.mockResolvedValueOnce(null);
    await openAnalysis(savedAnalysis(definition), user);
    expect(effects.getAnalysisSourceRecovery).toHaveBeenCalledWith([], user); // none to look up
    expect(get(analysisSourceRecovery)).toEqual({});
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
  describe('source identity', () => {
    const legacy = (): AnalysisDefinition => {
      const definition = definitionWithRows();
      definition.sources = [
        { id: 'source-1', kind: 'imported', label: 'Ops', revisionId: 18 },
        { id: 'source-2', kind: 'simulation', simulationDatasetId: 1 },
      ];
      return definition;
    };

    it('loads an analysis saved with only a revision id, and records its source', async () => {
      await openAnalysis(savedAnalysis(legacy()), user);
      expect(get(analysisSourceBindings)[0]).toEqual({
        id: 'source-1',
        kind: 'imported',
        label: 'Ops',
        revisionId: 18,
        sourceId: 1,
        sourceName: 'TOL',
      });
      expect(effects.getAnalysisSourceRecovery).toHaveBeenCalledWith([], user);
    });

    it('names a deleted revision by its source and rebinds to another one, keeping the id, alias and rows', async () => {
      const definition = legacy();
      definition.sources[0] = {
        id: 'source-1',
        kind: 'imported',
        label: 'Ops',
        revisionId: 99,
        sourceId: 1,
        sourceName: 'TOL',
      };
      effects.getAnalysisSourceRecovery.mockResolvedValue({
        1: {
          id: 1,
          name: 'TOL (renamed)',
          revisions: [{ id: 18, metadata: null, requested_at: '2026-10-03T12:00:00Z', status: 'success' }],
        },
      });
      await openAnalysis(savedAnalysis(definition), user);
      expect(effects.getAnalysisSourceRecovery).toHaveBeenCalledWith([1], user);
      expect(get(analysisSourceRecovery)[1]?.name).toBe('TOL (renamed)');
      const [unavailable] = get(analysisTimelineSources).sources;
      expect(unavailable.label).toBe('Ops');
      expect(unavailable.resources?.unavailableReason).toBe('This revision was deleted');
      // Not switched on its own.
      expect(get(analysisSourceBindings)[0]).toMatchObject({ revisionId: 99 });

      await rebindAnalysisSource(
        'source-1',
        { kind: 'imported', revisionId: 18, sourceId: 1, sourceName: 'TOL' },
        user,
      );
      expect(get(analysisSourceBindings)[0]).toEqual({
        id: 'source-1',
        kind: 'imported',
        label: 'Ops',
        revisionId: 18,
        sourceId: 1,
        sourceName: 'TOL',
      });
      // Its rows are still bound to it.
      expect(get(view)?.definition.plan.timelines[0].rows[0].layers[0].sourceId).toBe('source-1');
    });

    it('says the source was deleted when the whole source is gone, using the name it was bound with', async () => {
      const definition = legacy();
      definition.sources[0] = {
        id: 'source-1',
        kind: 'imported',
        revisionId: 99,
        sourceId: 7,
        sourceName: 'Demo tour',
      };
      effects.getAnalysisSourceRecovery.mockResolvedValue({ 7: null });
      await openAnalysis(savedAnalysis(definition), user);
      const [gone] = get(analysisTimelineSources).sources;
      expect(gone.label).toBe('Demo tour · Source deleted');
      expect(gone.resources?.unavailableReason).toBe('The source was deleted');
    });
  });
});
