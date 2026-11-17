import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisSourceBinding } from '../../types/analysis';
import type { User } from '../../types/app';
import { createAnalysisDefinition } from '../../utilities/analysis';
import { createRow, createTimelineActivityLayer } from '../../utilities/timeline';

const state = vi.hoisted(() => ({ readViewForTimelineImport: vi.fn(), replaceAnalysisTimeline: vi.fn() }));

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../../utilities/toast', () => ({ showFailureToast: vi.fn(), showSuccessToast: vi.fn() }));
vi.mock('../../stores/analysis', async () => {
  const { writable } = await import('svelte/store');
  return {
    analysisSourceBindings: writable([]),
    readViewForTimelineImport: state.readViewForTimelineImport,
    replaceAnalysisTimeline: state.replaceAnalysisTimeline,
  };
});
vi.mock('../../stores/views', async () => {
  const { writable } = await import('svelte/store');
  return {
    initialViewsLoading: writable(false),
    view: writable(null),
    views: writable([
      { created_at: '', id: 12, name: 'Ops view', owner: 'someone', updated_at: '2030-01-01T00:00:00Z' },
    ]),
  };
});

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() })),
);
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1200 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1200 });

const { default: Dialog } = await import('./AnalysisLoadViewDialog.svelte');
const { analysisSourceBindings } = (await import('../../stores/analysis')) as unknown as {
  analysisSourceBindings: ReturnType<typeof writable<AnalysisSourceBinding[]>>;
};
const { view } = (await import('../../stores/views')) as unknown as { view: ReturnType<typeof writable<unknown>> };

const user = { activeRole: 'user', id: 'me', permissibleQueries: {}, token: 't' } as unknown as User;

function readView() {
  const timelines = [{ ...createAnalysisDefinition().view.plan.timelines[0], id: 8 }];
  timelines[0].rows = [
    createRow(timelines, {
      id: 1,
      layers: [createTimelineActivityLayer(timelines, { id: 1 })],
      name: 'Plan activities',
    }),
    createRow(timelines, {
      id: 2,
      layers: [{ ...createTimelineActivityLayer(timelines, { id: 2 }), sourceId: 'external-events' }],
      name: 'Events',
    }),
  ];
  return { id: 12, name: 'Ops view', planSources: [], timelines };
}

describe('Use a Plan view (from Use a Layout)', () => {
  beforeEach(() => {
    analysisSourceBindings.set([{ id: 'source-1', kind: 'plan', planId: 1 }]);
    state.readViewForTimelineImport.mockResolvedValue(readView());
    state.replaceAnalysisTimeline.mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  let onBack = vi.fn();

  /** Opened by Use a Layout with the Plan view chosen there. */
  async function chooseView() {
    onBack = vi.fn();
    const { component } = render(Dialog, { open: true, sourceLabels: { 'source-1': 'Tour plan' }, user, viewId: 12 });
    component.$on('back', onBack);
    await waitFor(() => expect(screen.getByText(/will be loaded/)).toBeTruthy());
  }

  it('shows what will come across and what is left out, and loads into an analysis with no timeline yet', async () => {
    view.set({ definition: { plan: { timelines: [{ id: 0, rows: [] }] } } });
    await chooseView();
    expect(state.readViewForTimelineImport).toHaveBeenCalledWith(12, user);
    // The external events are the plan's in an Analysis: both layers come across.
    expect(screen.getByText(/2 of 2/)).toBeTruthy();
    // The one plan is preselected for the Plan's activity layers.
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('source-1');
    expect(screen.queryByText(/This replaces the current View/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Use View' }));
    const [timeline] = state.replaceAnalysisTimeline.mock.calls[0];
    expect(timeline.rows.map((row: { name: string }) => row.name)).toEqual(['Plan activities', 'Events']);
    expect(timeline.rows[0].layers[0].sourceId).toBe('source-1');
    expect(timeline.rows[1].layers[0]).toMatchObject({ chartType: 'activity', sourceId: 'source-1' });
  });

  it('says it replaces the current timeline, and nothing else, when the analysis already has rows', async () => {
    view.set({ definition: { plan: { timelines: [{ id: 0, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }] } } });
    await chooseView();
    expect(screen.getByRole('alert').textContent).toMatch(/replaces the current View \(3 rows\); you can undo it/);
    expect(screen.getByRole('alert').textContent).toMatch(
      /sources, annotations,\s+name\s+and sharing stay as they are/,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Replace Current View' }));
    expect(state.replaceAnalysisTimeline).toHaveBeenCalledTimes(1);
  });

  it('keeps the analysis as it was when the person goes back or cancels', async () => {
    view.set({ definition: { plan: { timelines: [{ id: 0, rows: [{ id: 1 }] }] } } });
    await chooseView();
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled(); // back to the layout list: there is no second list here
    expect(state.replaceAnalysisTimeline).not.toHaveBeenCalled();
  });
});
