import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, AnalysisDefinition } from '../types/analysis';
import type { User } from '../types/app';
import type { Row } from '../types/timeline';
import { createAnalysisDefinition, createSourceActivityRow } from '../utilities/analysis';
import { generateDefaultView } from '../utilities/view';
import { resolveResourceLayerSource } from '../utilities/timelineSources';

const effects = vi.hoisted(() => ({
  createAnalysis: vi.fn(),
  getAnalysisPlans: vi.fn(async () => []),
  getAnalysisSimulationDatasets: vi.fn(),
  getAnalysisSourceRecovery: vi.fn(async () => ({})),
  getAnalysisSourceRevisions: vi.fn(),
  getAnalysisSourceUsage: vi.fn(),
  getOrCreateSourceByOrigin: vi.fn(),
  getSourceRevisionStatus: vi.fn(),
  getSpans: vi.fn(),
  importSourceRevision: vi.fn(),
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
  analysisWatchedResources,
  analysisSourceRecovery,
  analyzeWorkspaceSequence,
  analysisTimelineSources,
  analysis,
  analysisAnnotations,
  analysisSaveStatus,
  autosaveAnalysis,
  closeAnalysis,
  flushAnalysisSave,
  openAnalysis,
  rebindAnalysisSource,
  removeAnalysisSource,
  renameAnalysis,
  selectedAnalysisActivity,
  showAnalysisActivityType,
  showAnalysisSequence,
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

  it("never saves a view that is not the analysis's own into it (another page's, or a default view)", async () => {
    vi.useFakeTimers();
    await openAnalysis(savedAnalysis(definitionWithRows()), user);
    const stop = autosaveAnalysis(user);
    view.set({ ...generateDefaultView(), created_at: 'another page' });
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
  describe('watched resources', () => {
    const watched = [
      { name: 'BatteryStateOfCharge', sourceId: 'source-1' },
      { name: '/fruit', sourceId: 'source-2' },
    ];

    it('are not part of what the analysis saves', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      analysisWatchedResources.set(watched);
      const stop = autosaveAnalysis(user);
      vi.useFakeTimers();
      analysisSourceBindings.update(bindings => bindings.slice());
      await vi.advanceTimersByTimeAsync(1500);
      expect(effects.updateAnalysis).toHaveBeenCalled();
      expect(JSON.stringify(effects.updateAnalysis.mock.calls)).not.toContain('/fruit');
      stop();
    });

    it('go with a removed source and only with it', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      analysisWatchedResources.set(watched);
      await removeAnalysisSource('source-2', user);
      expect(get(analysisWatchedResources)).toEqual([watched[0]]);
    });

    it('are dropped, not redirected, when their source is pointed at other data', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      analysisWatchedResources.set(watched);
      await rebindAnalysisSource(
        'source-1',
        { kind: 'imported', revisionId: 18, sourceId: 1, sourceName: 'TOL' },
        user,
      );
      expect(get(analysisWatchedResources)).toEqual([watched[1]]);
    });

    it('start empty on each analysis', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      analysisWatchedResources.set(watched);
      closeAnalysis();
      expect(get(analysisWatchedResources)).toEqual([]);
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      expect(get(analysisWatchedResources)).toEqual([]);
    });
  });

  describe('showing an activity type on the timeline', () => {
    const layers = () => (get(view)?.definition.plan.timelines[0].rows ?? []).flatMap(row => row.layers);

    it("adds a layer of that source's type, bound to that source, with no other filter", async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      const before = layers().length;
      const { added, row } = showAnalysisActivityType('source-1', 'ALLOCATION');
      expect(added).toBe(true);
      expect(layers()).toHaveLength(before + 1);
      const layer = row?.layers[0];
      expect(layer).toMatchObject({ chartType: 'activity', sourceId: 'source-1' });
      expect(layer?.filter.activity?.static_types).toEqual(['ALLOCATION']);
      expect(layer?.filter.activity?.other_filters ?? []).toEqual([]);
      expect(layer?.filter.activity?.dynamic_type_filters ?? []).toEqual([]);
    });

    it('does not add another row for what is already drawn, and selects the row that draws it', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      const before = layers().length;
      const { added, row } = showAnalysisActivityType('source-1', 'DSN_Pass');
      expect(added).toBe(false);
      expect(row?.id).toBe(2);
      expect(layers()).toHaveLength(before);
      showAnalysisActivityType('source-1', 'ALLOCATION');
      showAnalysisActivityType('source-1', 'ALLOCATION');
      expect(layers()).toHaveLength(before + 1);
    });

    it('treats the same type of another source as another thing to show', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      const before = layers().length;
      expect(showAnalysisActivityType('source-2', 'DSN_Pass').added).toBe(true);
      expect(layers()).toHaveLength(before + 1);
    });
  });

  describe('showing a sequence on the timeline', () => {
    it('adds one grouped, by-parent row of its kinds, and reuses it after', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      const row = showAnalysisSequence('source-1', ['SEQUENCE', 'COMMAND', 'SEQUENCE'])!;
      expect(row.discreteOptions).toMatchObject({
        activityOptions: { groupBy: 'name', hierarchyMode: 'parent' },
        displayMode: 'grouped',
      });
      expect(row.layers[0]).toMatchObject({
        filter: { activity: { static_types: ['COMMAND', 'SEQUENCE'] } },
        sourceId: 'source-1',
      });
      const rows = () => get(view)!.definition.plan.timelines[0].rows;
      const count = rows().length;
      expect(showAnalysisSequence('source-1', ['COMMAND'])?.id).toBe(row.id); // already shown that way
      expect(rows()).toHaveLength(count);
      expect(showAnalysisSequence('source-2', ['SEQUENCE'])?.id).not.toBe(row.id); // another source's: its own row
    });

    it('focuses a row on one sequence by its key, apart from the row of all sequences, and refocuses it', async () => {
      await openAnalysis(savedAnalysis(definitionWithRows()), user);
      const all = showAnalysisSequence('source-1', ['SEQUENCE', 'COMMAND'])!;
      const focused = showAnalysisSequence('source-1', ['SEQUENCE', 'COMMAND'], { key: 'seq:a', name: 'a' })!;
      expect(focused.id).not.toBe(all.id);
      expect(focused.name).toContain('Sequence a');
      expect(focused.layers[0]).toMatchObject({ filter: { activity: { within: ['seq:a'] } } });
      expect(showAnalysisSequence('source-1', ['COMMAND'], { key: 'seq:a', name: 'a' })?.id).toBe(focused.id);
      // Focusing another sequence points the focus row at it: one focus row, not one per sequence.
      expect(showAnalysisSequence('source-1', ['SEQUENCE', 'COMMAND'], { key: 'seq:b', name: 'b' })?.id).toBe(
        focused.id,
      );
      const refocused = get(view)?.definition.plan.timelines[0].rows.find(({ id }) => id === focused.id);
      expect(refocused?.layers[0]).toMatchObject({ filter: { activity: { within: ['seq:b'] } } });
      expect(refocused?.name).toContain('Sequence b');
      expect(showAnalysisSequence('source-1', ['COMMAND'])?.id).toBe(all.id);
    });
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

describe('analysis saves', () => {
  /** updateAnalysis calls that finish only when the test says so. */
  function controlledSaves() {
    const calls: { resolve: (value: string | 'conflict' | null) => void; update: any; updatedAt: string }[] = [];
    effects.updateAnalysis.mockImplementation(
      (current: Analysis, update: unknown) =>
        new Promise(resolve => calls.push({ resolve, update, updatedAt: current.updated_at })),
    );
    return calls;
  }
  const note = (text: string) => ({ id: 1, text }) as never;

  beforeEach(async () => {
    vi.useFakeTimers();
    effects.getAnalysisSourceRevisions.mockResolvedValue([]);
    effects.getAnalysisSimulationDatasets.mockResolvedValue([]);
    await openAnalysis({ ...savedAnalysis(createAnalysisDefinition()), updated_at: 'r0' }, user);
  });
  afterEach(async () => {
    closeAnalysis();
    await vi.runAllTimersAsync();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('sends one save at a time; changes made meanwhile go next, on the revision the last one returned', async () => {
    const calls = controlledSaves();
    const stop = autosaveAnalysis(user);
    analysisAnnotations.set([note('a')]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls).toHaveLength(1);
    expect(get(analysisSaveStatus)).toBe('saving');

    // Typing on while the first save is slow.
    analysisAnnotations.set([note('ab')]);
    analysisAnnotations.set([note('abc')]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls).toHaveLength(1); // not a second concurrent write on r0
    expect(get(analysisSaveStatus)).toBe('unsaved');

    calls[0].resolve('r1');
    await vi.advanceTimersByTimeAsync(0);
    // Not Saved: 'abc' is not persisted yet.
    expect(get(analysisSaveStatus)).toBe('saving');
    expect(calls).toHaveLength(2);
    expect(calls[1].updatedAt).toBe('r1');
    expect(calls[1].update.definition.annotations).toEqual([note('abc')]);

    calls[1].resolve('r2');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(analysisSaveStatus)).toBe('saved');
    expect(get(analysis)?.updated_at).toBe('r2');
    stop();
  });

  it('serializes a rename with the autosave', async () => {
    const calls = controlledSaves();
    const stop = autosaveAnalysis(user);
    analysisAnnotations.set([note('a')]);
    await vi.advanceTimersByTimeAsync(1100);
    const renamed = renameAnalysis('Renamed', user);
    expect(calls).toHaveLength(1);
    calls[0].resolve('r1');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[1]).toMatchObject({ update: { name: 'Renamed' }, updatedAt: 'r1' });
    calls[1].resolve('r2');
    await renamed;
    expect(get(analysis)).toMatchObject({ name: 'Renamed', updated_at: 'r2' });
    stop();
  });

  it("still sends a pending save on leaving, and a late reply doesn't touch the next analysis", async () => {
    const calls = controlledSaves();
    const stop = autosaveAnalysis(user);
    analysisAnnotations.set([note('left behind')]);
    stop();
    closeAnalysis(); // before the debounce: must not be dropped
    expect(calls).toHaveLength(1);
    expect(calls[0].update.definition.annotations).toEqual([note('left behind')]);

    await openAnalysis({ ...savedAnalysis(createAnalysisDefinition()), id: 9, updated_at: 'other' }, user);
    calls[0].resolve('r1');
    await vi.advanceTimersByTimeAsync(0);
    expect(get(analysis)).toMatchObject({ id: 9, updated_at: 'other' });
    expect(get(analysisSaveStatus)).toBe('saved');
  });

  it('stops on a real conflict and keeps a failed save for a retry', async () => {
    const calls = controlledSaves();
    const stop = autosaveAnalysis(user);
    analysisAnnotations.set([note('a')]);
    await vi.advanceTimersByTimeAsync(1100);
    calls[0].resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(get(analysisSaveStatus)).toBe('error');

    const retried = flushAnalysisSave();
    expect(calls[1].update.definition.annotations).toEqual([note('a')]);
    expect(calls[1].updatedAt).toBe('r0');
    calls[1].resolve('conflict');
    await retried;
    expect(get(analysisSaveStatus)).toBe('conflict');

    analysisAnnotations.set([note('ab')]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(calls).toHaveLength(2); // nothing is written over someone else's change
    expect(get(analysisSaveStatus)).toBe('conflict');
    stop();
  });
});

describe('analyzing a SeqDev workspace sequence', () => {
  const file = {
    input: '{"id":"s","metadata":{},"steps":[]}',
    path: 'seqs/s.seq.json',
    workspaceId: 2,
    workspaceName: 'ws',
  };
  const sha256 = async (text: string) =>
    `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  const readText = (blob: Blob) =>
    new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
  const imported = () => effects.importSourceRevision.mock.calls[0] as unknown as [File, unknown, string, unknown, any];

  beforeEach(() => {
    effects.getAnalysisSourceUsage.mockResolvedValue([]);
    effects.createAnalysis.mockResolvedValue(31);
    effects.getOrCreateSourceByOrigin.mockResolvedValue({
      id: 9,
      name: 'ws/seqs/s.seq.json',
      owner: 'test',
      revisions: [],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports a snapshot as a revision of the user's source for the workspace id and path, then analyzes it", async () => {
    effects.importSourceRevision.mockResolvedValue({ owner: 'test', revisionId: 50, sourceId: 9 });
    effects.getSourceRevisionStatus
      .mockResolvedValueOnce({ activityCount: 0, id: 50, status: 'pending' })
      .mockResolvedValueOnce({ activityCount: 3, id: 50, status: 'success' });
    expect(await analyzeWorkspaceSequence(file, user, async () => {})).toBe(31);
    // Found by origin (the workspace's id, never its name, which repeats), among the user's own sources.
    expect(effects.getOrCreateSourceByOrigin).toHaveBeenCalledWith(
      'workspace:2:seqs/s.seq.json',
      'ws/seqs/s.seq.json',
      'seq_json',
      user,
    );
    const [uploaded, target, adapter, , metadata] = imported();
    expect(uploaded.name).toBe('s.seq.json');
    expect(await readText(uploaded)).toBe(file.input);
    expect(target).toEqual({ owner: 'test', sourceId: 9 });
    expect(adapter).toBe('seq_json');
    expect(metadata).toEqual({
      workspaceFile: {
        inputHash: await sha256(file.input),
        path: 'seqs/s.seq.json',
        workspaceId: 2,
        workspaceName: 'ws',
      },
    });
    const [, definition] = effects.createAnalysis.mock.calls[0] as unknown as [
      string,
      { sources: unknown[]; view: { plan: { timelines: { items: unknown[]; rows: { id: number }[] }[] } } },
    ];
    // Its activities row is in the timeline's order, so it is drawn.
    const [timeline] = definition.view.plan.timelines;
    expect(timeline.items).toEqual([{ id: timeline.rows[0].id, type: 'row' }]);
    expect(definition.sources).toEqual([
      { id: 'source-1', kind: 'imported', revisionId: 50, sourceId: 9, sourceName: 'ws/seqs/s.seq.json' },
    ]);
  });

  it('reuses the revision of the same bytes from the same input, and snapshots anything else as a new one', async () => {
    const workspaceFile = { inputHash: await sha256(file.input), path: file.path, workspaceId: 2, workspaceName: 'ws' };
    const revisions = [
      {
        activityCount: 0,
        content_hash: await sha256(file.input),
        id: 44,
        metadata: { workspaceFile },
        status: 'success',
      },
    ];
    effects.getOrCreateSourceByOrigin.mockResolvedValue({
      id: 9,
      name: 'ws/seqs/s.seq.json',
      owner: 'test',
      revisions,
    });
    await analyzeWorkspaceSequence(file, user, async () => {});
    expect(effects.importSourceRevision).not.toHaveBeenCalled();
    expect(
      (effects.createAnalysis.mock.calls[0] as unknown as [string, { sources: { revisionId: number }[] }])[1].sources[0]
        .revisionId,
    ).toBe(44);

    effects.importSourceRevision.mockResolvedValue({ owner: 'test', revisionId: 45, sourceId: 9 });
    effects.getSourceRevisionStatus.mockResolvedValue({ activityCount: 0, id: 45, status: 'success' });
    await analyzeWorkspaceSequence({ ...file, input: `${file.input} ` }, user, async () => {});
    expect(imported()[1]).toEqual({ owner: 'test', sourceId: 9 });
  });

  it('converts exactly the saved input with the adaptation, and keeps how it was converted', async () => {
    effects.importSourceRevision.mockResolvedValue({ owner: 'test', revisionId: 52, sourceId: 9 });
    effects.getSourceRevisionStatus.mockResolvedValue({ activityCount: 0, id: 52, status: 'success' });
    const output = '{"id":"s2","steps":[]}';
    const run = vi.fn(async () => output);
    const conversion = { adaptationId: 7, commandDictionaryId: 1, language: 'SeqN', run };
    await analyzeWorkspaceSequence(
      { ...file, conversion, input: '@ID "s2"', path: 's2.seqN.txt' },
      user,
      async () => {},
    );
    expect(run).toHaveBeenCalledWith('@ID "s2"');
    const [uploaded, , , , metadata] = imported();
    expect(await readText(uploaded)).toBe(output);
    expect(uploaded.name).toBe('s2.seq.json');
    expect(metadata.workspaceFile).toEqual({
      conversion: { adaptationId: 7, commandDictionaryId: 1, from: 'SeqN' },
      inputHash: await sha256('@ID "s2"'),
      path: 's2.seqN.txt',
      workspaceId: 2,
      workspaceName: 'ws',
    });

    // The same output by another adaptation is another snapshot: what made it differs.
    vi.clearAllMocks();
    effects.getAnalysisSourceUsage.mockResolvedValue([]);
    effects.createAnalysis.mockResolvedValue(31);
    effects.importSourceRevision.mockResolvedValue({ owner: 'test', revisionId: 53, sourceId: 9 });
    effects.getSourceRevisionStatus.mockResolvedValue({ activityCount: 0, id: 53, status: 'success' });
    effects.getOrCreateSourceByOrigin.mockResolvedValue({
      id: 9,
      name: 'ws/s2.seqN.txt',
      owner: 'test',
      revisions: [{ activityCount: 0, content_hash: await sha256(output), id: 52, metadata, status: 'success' }],
    });
    await analyzeWorkspaceSequence(
      { ...file, conversion: { ...conversion, adaptationId: 8 }, input: '@ID "s2"', path: 's2.seqN.txt' },
      user,
      async () => {},
    );
    expect(effects.importSourceRevision).toHaveBeenCalled();
  });

  it('imports nothing when the conversion fails or is not a sequence', async () => {
    const failing = {
      adaptationId: null,
      commandDictionaryId: null,
      language: 'SeqN',
      run: async () => {
        throw new Error('bad token');
      },
    };
    expect(await analyzeWorkspaceSequence({ ...file, conversion: failing }, user, async () => {})).toBeNull();
    const garbage = { ...failing, run: async () => '// Error in adaptation' };
    expect(await analyzeWorkspaceSequence({ ...file, conversion: garbage }, user, async () => {})).toBeNull();
    const nothing = { ...failing, run: async () => undefined };
    expect(await analyzeWorkspaceSequence({ ...file, conversion: nothing }, user, async () => {})).toBeNull();
    expect(effects.getOrCreateSourceByOrigin).not.toHaveBeenCalled();
    expect(effects.importSourceRevision).not.toHaveBeenCalled();
  });

  it('opens nothing when the file is not readable as seqJSON', async () => {
    effects.importSourceRevision.mockResolvedValue({ owner: 'test', revisionId: 51, sourceId: 9 });
    effects.getSourceRevisionStatus.mockResolvedValue({ activityCount: 0, id: 51, status: 'failed' });
    expect(await analyzeWorkspaceSequence(file, user, async () => {})).toBeNull();
    expect(effects.createAnalysis).not.toHaveBeenCalled();
  });

  it('opens nothing when the source can be neither found nor created', async () => {
    effects.getOrCreateSourceByOrigin.mockResolvedValue(null);
    expect(await analyzeWorkspaceSequence(file, user, async () => {})).toBeNull();
    expect(effects.importSourceRevision).not.toHaveBeenCalled();
  });
});
