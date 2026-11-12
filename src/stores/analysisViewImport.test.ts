import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../types/analysis';
import type { User } from '../types/app';
import type { View } from '../types/view';
import { createAnalysisDefinition, createSourceActivityRow } from '../utilities/analysis';
import { importViewTimeline } from '../utilities/analysisViewImport';
import { createRow, createTimelineActivityLayer, createTimelineLineLayer, createYAxis } from '../utilities/timeline';

const effects = vi.hoisted(() => ({
  getAnalysisPlans: vi.fn(async () => []),
  getAnalysisSimulationDatasets: vi.fn(async () => []),
  getAnalysisSourceRecovery: vi.fn(async () => ({})),
  getAnalysisSourceRevisions: vi.fn(async () => []),
  getPlanSourcesForImport: vi.fn(),
  getView: vi.fn(),
  updateAnalysis: vi.fn(),
  updateView: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ showFailureToast: vi.fn(), showSuccessToast: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('../utilities/toast', () => toasts);
vi.mock('./subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});

const {
  analysisSourceBindings,
  autosaveAnalysis,
  closeAnalysis,
  openAnalysis,
  readViewForTimelineImport,
  replaceAnalysisTimeline,
} = await import('./analysis');
const { view } = await import('./views');

const owner = {
  activeRole: 'user',
  id: 'test',
  permissibleQueries: { update_analysis: true },
  token: 't',
} as unknown as User;

/** An analysis with a plan and a simulation, and a row of the plan's activities. */
function savedAnalysis(owned = true): Analysis {
  const definition = createAnalysisDefinition();
  definition.sources = [
    { id: 'source-1', kind: 'plan', label: 'Tour plan', planId: 1 },
    { id: 'source-2', kind: 'simulation', simulationDatasetId: 3 },
  ];
  const [timeline] = definition.view.plan.timelines;
  timeline.rows = [createSourceActivityRow(definition.view.plan.timelines, 'source-1', 'Existing row')];
  timeline.items = [{ id: timeline.rows[0].id, type: 'row' }];
  return {
    created_at: '',
    definition,
    id: 4,
    name: 'Tour analysis',
    owner: owned ? 'test' : 'someone-else',
    updated_at: '',
  };
}

/** A saved Plan view: an activity row and a resource row, both on the Plan, with the page's own panel layout. */
function planView(): View {
  const defaults = createAnalysisDefinition().view;
  const timelines = defaults.plan.timelines;
  const axis = createYAxis(timelines, { label: { text: 'Charge' } });
  const activityRow = createRow(timelines, {
    id: 10,
    layers: [createTimelineActivityLayer(timelines, { id: 100 })],
    name: 'Plan activities',
  });
  const resourceRow = createRow(timelines, {
    id: 11,
    layers: [createTimelineLineLayer(timelines, [axis], { id: 101, name: 'SOC', sourceId: 'plan' })],
    name: 'Battery',
    yAxes: [axis],
  });
  const timeline = {
    ...timelines[0],
    id: 8,
    items: [
      { id: 10, type: 'row' as const },
      { id: 11, type: 'row' as const },
    ],
    rows: [activityRow, resourceRow],
  };
  return {
    created_at: '',
    definition: { ...defaults, plan: { ...defaults.plan, timelines: [timeline] } },
    id: 12,
    name: 'Ops view',
    owner: 'someone-else',
    updated_at: '',
  };
}

describe('loading a saved view into an open analysis', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    effects.getView.mockResolvedValue(planView());
    effects.getPlanSourcesForImport.mockResolvedValue([]);
  });
  afterEach(() => {
    closeAnalysis();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function loadIntoOpenAnalysis(analysis: Analysis) {
    await openAnalysis(analysis, owner);
    const stop = autosaveAnalysis(owner);
    const read = await readViewForTimelineImport(12, owner);
    const current = get(view)!.definition.plan.timelines[0];
    const bindings = get(analysisSourceBindings);
    const { timeline } = importViewTimeline(read!.timelines[0], current.id, bindings, read!.planSources, {
      activitySourceId: 'source-1',
      resourceSourceId: 'source-2',
    });
    return { bindings, read: read!, stop, timeline };
  }

  it('replaces the timeline only, leaves the sources and the analysis alone, and saves it through autosave', async () => {
    const analysis = savedAnalysis();
    const { bindings, stop, timeline } = await loadIntoOpenAnalysis(analysis);
    effects.updateAnalysis.mockResolvedValue('2030-01-01T00:00:00Z');

    expect(replaceAnalysisTimeline(timeline, owner)).toBe(true);
    const rows = get(view)!.definition.plan.timelines[0].rows;
    expect(rows.map(row => row.name)).toEqual(['Plan activities', 'Battery']);
    expect(rows.map(row => row.layers[0].sourceId)).toEqual(['source-1', 'source-2']);
    expect(get(analysisSourceBindings)).toEqual(bindings); // no source added, removed or rebound

    await vi.advanceTimersByTimeAsync(1500);
    expect(effects.updateAnalysis).toHaveBeenCalledTimes(1);
    const [saved, change] = effects.updateAnalysis.mock.calls[0] as unknown as [
      Analysis,
      { definition: Analysis['definition']; name?: string },
    ];
    expect(saved.id).toBe(4);
    expect(change.name).toBeUndefined();
    expect(change.definition.sources).toEqual(analysis.definition.sources);
    // Only the timeline came from the Plan view: nothing of its panel layout did.
    expect(change.definition.view.plan.grid).toEqual(analysis.definition.view.plan.grid);
    expect(change.definition.view.plan.timelines[0].rows.map(row => row.name)).toEqual(['Plan activities', 'Battery']);
    stop();

    // Save and reload: the reopened analysis has the loaded timeline and the same sources.
    closeAnalysis();
    await openAnalysis({ ...analysis, definition: change.definition }, owner);
    expect(get(view)!.definition.plan.timelines[0].rows.map(row => row.name)).toEqual(['Plan activities', 'Battery']);
    expect(get(analysisSourceBindings)).toEqual(analysis.definition.sources);
  });

  it('loads into an analysis that has no rows yet', async () => {
    const empty = savedAnalysis();
    empty.definition.view.plan.timelines[0].rows = [];
    empty.definition.view.plan.timelines[0].items = [];
    const { timeline } = await loadIntoOpenAnalysis(empty);
    expect(replaceAnalysisTimeline(timeline, owner)).toBe(true);
    expect(get(view)!.definition.plan.timelines[0].rows).toHaveLength(2);
  });

  it('does nothing for someone who cannot edit the analysis', async () => {
    const { timeline } = await loadIntoOpenAnalysis(savedAnalysis(false));
    const before = get(view);
    expect(replaceAnalysisTimeline(timeline, owner)).toBe(false);
    expect(get(view)).toBe(before);
    expect(get(view)!.definition.plan.timelines[0].rows.map(row => row.name)).toEqual(['Existing row']);
  });

  it('reads the view without writing to it, and reports a view that cannot be read', async () => {
    await openAnalysis(savedAnalysis(), owner);
    const old = planView();
    old.definition = { ...old.definition, version: 0 } as View['definition']; // an old version, to be migrated in memory
    effects.getView.mockResolvedValueOnce(old);
    const read = await readViewForTimelineImport(12, owner);
    expect(read?.name).toBe('Ops view');
    expect(effects.getView).toHaveBeenCalledWith(expect.anything(), owner, false); // not the migrating-and-saving read
    expect(effects.updateView).not.toHaveBeenCalled();

    // getView hands back a default view for an id it can't find; that is not the view asked for.
    effects.getView.mockResolvedValueOnce({ ...planView(), id: -1, name: 'Default' });
    expect(await readViewForTimelineImport(99, owner)).toBeNull();
    expect(toasts.showFailureToast).toHaveBeenCalledWith('The View Could Not Be Read');
    effects.getView.mockResolvedValueOnce(null);
    expect(await readViewForTimelineImport(99, owner)).toBeNull();

    effects.getPlanSourcesForImport.mockResolvedValueOnce(null);
    expect(await readViewForTimelineImport(12, owner)).toBeNull();
  });
});
