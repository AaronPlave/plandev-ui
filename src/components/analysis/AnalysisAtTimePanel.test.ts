import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, AnalysisSourceBinding } from '../../types/analysis';
import type { User } from '../../types/app';
import type { Resource, Span } from '../../types/simulation';
import type { Layer, Row } from '../../types/timeline';
import { createAnalysisDefinition } from '../../utilities/analysis';
import { toMicros, type SourceQueryResult } from '../../utilities/importedResource';

const effects = vi.hoisted(() => ({
  getAnalysisActivities: vi.fn(async () => []),
  getAnalysisActivityCount: vi.fn(async () => 0),
  getAnalysisPlans: vi.fn(async () => []),
  getAnalysisSimulationDatasets: vi.fn(),
  getAnalysisSourceRecovery: vi.fn(async () => ({})),
  getAnalysisSourceRevisions: vi.fn(),
  getSpans: vi.fn(async () => []),
  querySourceResources: vi.fn(),
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../../utilities/effects', () => ({ default: effects }));
vi.mock('../../stores/subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});
// A simulation profile that loads when the test says so: it holds the registry entry, as the real one does.
vi.mock('../../stores/profile', async () => {
  const registry = await import('../../stores/timelineResourceStatus');
  return {
    createProfileSubscription: (datasetId: number, name: string) => {
      registry.acquireTimelineResource(datasetId, name, 'sim');
      registry.setTimelineResourceState(datasetId, name, 'sim', { error: '', loading: true, resource: null });
      return {
        store: { subscribe: () => () => {} },
        unsubscribe: () => registry.releaseTimelineResource(datasetId, name, 'sim'),
      };
    },
  };
});
// The dropdown measures its options on a canvas, which the test DOM does not have.
HTMLCanvasElement.prototype.getContext = () => null;
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() })),
);

const { analysisSourceBindings, analysisWatchedResources, closeAnalysis, openAnalysis } = await import(
  '../../stores/analysis'
);
const { timeCursorCompareMs, timeCursorMs } = await import('../../stores/plan');
const { spans } = await import('../../stores/simulation');
const { setTimelineResourceState } = await import('../../stores/timelineResourceStatus');
const { view } = await import('../../stores/views');
const { default: AnalysisAtTimePanel } = await import('./AnalysisAtTimePanel.svelte');

const user = { activeRole: 'user', id: 'test', permissibleQueries: {}, token: 't' } as unknown as User;

const T1 = Date.parse('2026-05-27T14:04:04Z');
const T2 = T1 + 60_000;
const T3 = T1 + 120_000;

/** Two revisions of the same product, each with `/hga/az`, and a simulation with `/fruit`. */
const revision = (id: number, name: string) => ({
  activity_types: [],
  coverage_end: '2026-06-01T00:00:00Z',
  coverage_start: '2026-05-01T00:00:00Z',
  id,
  metadata: {},
  requested_at: '2026-05-01T00:00:00Z',
  resources: [
    {
      category: null,
      coverage_end: null,
      coverage_start: null,
      interpolation: 'constant',
      key: '/hga/az',
      numeric: true,
      sample_count: 2,
      schema: { type: 'real' },
      units: 'deg',
    },
  ],
  source: { id, latest: [], name, source_type: 'pef' },
  status: 'success',
});
const simulation = {
  dataset: { profiles: [{ name: '/fruit', type: { schema: { type: 'real' } } }] },
  dataset_id: 6,
  id: 1,
  simulation: { plan: { id: 3, name: 'Tour Plan A' } },
  simulation_end_time: '2026-06-01T00:00:00Z',
  simulation_start_time: '2026-05-01T00:00:00Z',
  status: 'success',
};
const sources: AnalysisSourceBinding[] = [
  { id: 'source-1', kind: 'imported', label: 'cruise014', revisionId: 18 },
  { id: 'source-2', kind: 'imported', label: 'cruise015', revisionId: 19 },
  { id: 'source-3', kind: 'simulation', label: 'Sim 1', simulationDatasetId: 1 },
];

function savedAnalysis(rows: Row[] = []): Analysis {
  const definition = createAnalysisDefinition();
  definition.view.plan.timelines[0].rows = rows;
  definition.sources = sources;
  return { created_at: '', definition, id: 4, name: 'DSN', owner: 'test', updated_at: '' };
}

const plotted = (sourceId: string): Row =>
  ({
    horizontalGuides: [],
    id: 1,
    layers: [{ chartType: 'line', filter: { resource: '/hga/az' }, id: 1, sourceId, yAxisId: null } as Layer],
    name: 'HGA',
    yAxes: [],
  }) as unknown as Row;

/** What the source says at an instant: one earlier sample, held. */
const held = (resource: string, value: number): SourceQueryResult =>
  ({
    after: null,
    approximate: false,
    before: { t: [toMicros(T1 - 5000)], v: [value] },
    bucketWidth: null,
    next: null,
    representation: 'raw',
    resource,
    series: { t: [] },
  }) as unknown as SourceQueryResult;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, reject, resolve };
};

const labels = { 'source-1': 'cruise014', 'source-2': 'cruise015', 'source-3': 'Sim 1' };
const profile = (value: number): Resource => ({
  name: '/fruit',
  schema: { type: 'real' },
  values: [
    { is_gap: false, is_hold: true, x: 0, y: value },
    { is_gap: false, is_hold: true, x: Date.parse('2026-06-01T00:00:00Z'), y: value },
  ],
});

async function open(rows: Row[] = []) {
  await openAnalysis(savedAnalysis(rows), user);
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(AnalysisAtTimePanel, { bindings: get(analysisSourceBindings), sourceLabels: labels, user, ...props });
}

describe('AnalysisAtTimePanel', () => {
  beforeEach(() => {
    effects.getAnalysisSourceRevisions.mockImplementation(async (ids: number[]) =>
      [revision(18, 'cruise014'), revision(19, 'cruise015')].filter(({ id }) => ids.includes(id)),
    );
    effects.getAnalysisSimulationDatasets.mockImplementation(async (ids: number[]) =>
      ids.includes(1) ? [simulation] : [],
    );
    effects.querySourceResources.mockImplementation(async (target: { revisionId: number }, names: string[]) => ({
      results: names.map(name => held(name, target.revisionId === 18 ? 111 : 222)),
    }));
  });
  afterEach(() => {
    cleanup();
    closeAnalysis();
    spans.set(null);
    vi.clearAllMocks();
    // Not just its calls: an answer a test queued and never asked for must not reach the next test.
    effects.querySourceResources.mockReset();
  });

  describe('watched resources', () => {
    it('reads a watched imported resource that no timeline row plots, from its own source, exactly', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-2' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('222'));
      expect(container.textContent).toContain('cruise015 · Held');
      expect(effects.querySourceResources).toHaveBeenCalledTimes(1);
      const [target, names, query] = effects.querySourceResources.mock.calls[0];
      expect(target).toEqual({ revisionId: 19 });
      expect(names).toEqual(['/hga/az']);
      expect(query).toMatchObject({ fidelity: 'exact', start: toMicros(T1) });
    });

    it('keeps one name in two sources as two rows, each with its own source’s value', async () => {
      await open();
      analysisWatchedResources.set([
        { name: '/hga/az', sourceId: 'source-1' },
        { name: '/hga/az', sourceId: 'source-2' },
      ]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('222'));
      expect(container.textContent).toContain('111');
      expect(container.textContent).toContain('cruise014 · Held');
      expect(container.textContent).toContain('cruise015 · Held');
      expect(effects.querySourceResources.mock.calls.map(([target]) => target.revisionId).sort()).toEqual([18, 19]);
    });

    it('lists a resource that is plotted and watched once, and asks for it once', async () => {
      await open([plotted('source-1')]);
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));
      expect(container.querySelectorAll('.row')).toHaveLength(1);
      expect(effects.querySourceResources.mock.calls[0][1]).toEqual(['/hga/az']);
    });

    it('stops watching without touching the timeline’s layer', async () => {
      await open([plotted('source-1')]);
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container, getByText } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));
      await fireEvent.click(container.querySelector('.row-head')!);
      await fireEvent.click(getByText('Stop watching'));
      expect(get(analysisWatchedResources)).toEqual([]);
      expect(get(view)?.definition.plan.timelines[0].rows[0].layers).toHaveLength(1);
      // Still read: the row plots it.
      expect(container.querySelectorAll('.row')).toHaveLength(1);
    });

    it('reads nothing for a watched resource whose source was removed, and says so', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-9' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Unavailable'));
      expect(effects.querySourceResources).not.toHaveBeenCalled();
    });

    it('reads A and B, each from the source at its own instant', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      effects.querySourceResources.mockImplementation(async (_target, names: string[], query: { start: number }) => ({
        results: names.map(name => held(name, query.start === toMicros(T1) ? 111 : 333)),
      }));
      timeCursorMs.set(T1);
      timeCursorCompareMs.set(T2);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('333'));
      expect(container.textContent).toContain('111');
      expect(container.textContent).toContain('+222');
    });
  });

  describe('time inspection', () => {
    it('never shows a reading of another instant: it says it is reading until the new one is in', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));

      const next = deferred<{ results: SourceQueryResult[] }>();
      effects.querySourceResources.mockReturnValueOnce(next.promise);
      timeCursorMs.set(T2);
      await waitFor(() => expect(container.textContent).not.toContain('111'));
      expect(container.textContent).toContain('Reading…');
      // Even once the query is on its way, the old value stays out.
      await waitFor(() => expect(effects.querySourceResources).toHaveBeenCalledTimes(2));
      expect(container.textContent).not.toContain('111');

      next.resolve({ results: [held('/hga/az', 333)] });
      await waitFor(() => expect(container.textContent).toContain('333'));
    });

    it('ignores the answer to a superseded request', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));

      const slow = deferred<{ results: SourceQueryResult[] }>();
      effects.querySourceResources.mockReturnValueOnce(slow.promise);
      timeCursorMs.set(T2);
      await waitFor(() => expect(effects.querySourceResources).toHaveBeenCalledTimes(2));
      // The cursor moves again before the first answer arrives.
      effects.querySourceResources.mockResolvedValueOnce({ results: [held('/hga/az', 444)] });
      timeCursorMs.set(T3);
      await waitFor(() => expect(container.textContent).toContain('444'));
      slow.resolve({ results: [held('/hga/az', 333)] });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(container.textContent).toContain('444');
      expect(container.textContent).not.toContain('333');
    });

    it('shows a failed read as unavailable, never the previous value', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));

      effects.querySourceResources.mockRejectedValueOnce(new Error('gateway down'));
      timeCursorMs.set(T2);
      await waitFor(() => expect(container.textContent).toContain('Unavailable'));
      expect(container.textContent).not.toContain('111');
    });

    it('invalidates a reading when the sources change under it', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container, component } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));

      // The same source id now binds another revision: what was read of the old one is not shown for the new.
      const next = deferred<{ results: SourceQueryResult[] }>();
      effects.querySourceResources.mockReturnValueOnce(next.promise);
      await component.$set({
        bindings: get(analysisSourceBindings).map(binding =>
          binding.id === 'source-1' ? { ...binding, revisionId: 19 } : binding,
        ),
      });
      await waitFor(() => expect(container.textContent).not.toContain('111'));
    });

    it('shows a simulation resource as soon as its profile has loaded, without moving the cursor', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/fruit', sourceId: 'source-3' }]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Sim 1 · Reading…'));
      setTimelineResourceState(6, '/fruit', 'sim', { error: '', loading: false, resource: profile(42) });
      await waitFor(() => expect(container.textContent).toContain('Sim 1 · Computed'));
      expect(container.textContent).toContain('42');
      // Nothing was asked of the source for it.
      expect(effects.querySourceResources).not.toHaveBeenCalled();
    });

    it('does not read the imported resources again when a simulation profile changes', async () => {
      await open();
      analysisWatchedResources.set([
        { name: '/hga/az', sourceId: 'source-1' },
        { name: '/fruit', sourceId: 'source-3' },
      ]);
      timeCursorMs.set(T1);
      const { container } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));
      const calls = effects.querySourceResources.mock.calls.length;
      setTimelineResourceState(6, '/fruit', 'sim', { error: '', loading: false, resource: profile(42) });
      await waitFor(() => expect(container.textContent).toContain('42'));
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(effects.querySourceResources).toHaveBeenCalledTimes(calls);
    });

    it('does not show the Plan’s spans, external events or constraints', async () => {
      await open();
      spans.set([
        {
          durationMs: 10 * 60_000,
          endMs: T1 + 5 * 60_000,
          span_id: 99,
          startMs: T1 - 5 * 60_000,
          type: 'PlanOnlySpan',
        },
      ] as unknown as Span[]);
      timeCursorMs.set(T1);
      const { container, queryByText } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('Activities in Progress'));
      expect(queryByText('PlanOnlySpan')).toBeNull();
      expect(container.textContent).not.toContain('External Events');
      expect(container.textContent).not.toContain('Constraint Violations');
      expect(container.textContent).not.toContain('Interpolate values');
    });
  });

  describe('read-only', () => {
    it('can watch and compare, but cannot put a watched resource on the timeline', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      timeCursorCompareMs.set(T2);
      const { container, getByText, queryByText } = renderPanel({ readOnly: true });
      await waitFor(() => expect(container.textContent).toContain('111'));
      await fireEvent.click(container.querySelector('.row-head')!);
      expect(getByText('Stop watching')).toBeDefined();
      expect(queryByText('Show on timeline…')).toBeNull();
    });

    it('offers to put a watched resource on the timeline when it can be edited', async () => {
      await open();
      analysisWatchedResources.set([{ name: '/hga/az', sourceId: 'source-1' }]);
      timeCursorMs.set(T1);
      const { container, getByText } = renderPanel();
      await waitFor(() => expect(container.textContent).toContain('111'));
      await fireEvent.click(container.querySelector('.row-head')!);
      expect(getByText('Show on timeline…')).toBeDefined();
    });
  });
});
