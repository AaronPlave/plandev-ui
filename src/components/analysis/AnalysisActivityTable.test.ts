import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisActivityRow, AnalysisSourceBinding } from '../../types/analysis';
import type { Span } from '../../types/simulation';
import { getActivityDrawingId, importedActivityToSpan, simulationSpanToActivity } from '../../utilities/analysis';
import AnalysisActivityTable from './AnalysisActivityTable.svelte';

const effects = vi.hoisted(() => ({ getAnalysisActivities: vi.fn(), getAnalysisActivityCount: vi.fn() }));
vi.mock('../../utilities/effects', () => ({ default: effects }));
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() })),
);

const bindings: AnalysisSourceBinding[] = [
  { id: 'source-1', kind: 'imported', revisionId: 18 },
  { id: 'source-2', kind: 'simulation', simulationDatasetId: 1 },
];
// The same activity id in two sources.
const rows: AnalysisActivityRow[] = [
  {
    activity_id: 4,
    category: 'DSN',
    end_time: '2031-01-01T05:00:00Z',
    name: 'DSS-54 pass',
    source_kind: 'revision',
    source_ref: 18,
    start_time: '2031-01-01T00:00:00Z',
    type: 'DSN_Pass',
  },
  {
    activity_id: 4,
    category: null,
    end_time: '2031-01-01T07:00:00Z',
    name: 'Breakfast bite 1',
    source_kind: 'simulation',
    source_ref: 1,
    start_time: '2031-01-01T07:00:00Z',
    type: 'BiteBanana',
  },
];

function renderTable(props: Record<string, unknown> = {}) {
  return render(AnalysisActivityTable, {
    bindings,
    sourceLabels: { 'source-1': 'TOL r18', 'source-2': 'Tour Plan A · Sim 1' },
    typeOptions: ['BiteBanana', 'DSN_Pass'],
    user: null,
    ...props,
  });
}

describe('AnalysisActivityTable', () => {
  beforeEach(() => {
    effects.getAnalysisActivities.mockImplementation(async (_where, _order, offset: number) => (offset ? [] : rows));
    effects.getAnalysisActivityCount.mockResolvedValue(2);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows each activity with its source, paged from the database', async () => {
    const { container, getByText } = renderTable();
    await waitFor(() => expect(container.querySelectorAll('.ag-center-cols-container .ag-row')).toHaveLength(2));
    const cells = [...container.querySelectorAll('.ag-center-cols-container [col-id="source"]')].map(
      c => c.textContent,
    );
    expect(cells.sort()).toEqual(['TOL r18', 'Tour Plan A · Sim 1']);
    expect(getByText('2 activities')).toBeDefined();
    const [where, orderBy, offset] = effects.getAnalysisActivities.mock.calls[0];
    expect(where._and[0]._or).toHaveLength(2);
    expect(orderBy[0]).toEqual({ start_time: 'asc' });
    expect(offset).toBe(0);
  });

  it('filters by source in the query', async () => {
    const { getByLabelText } = renderTable();
    await waitFor(() => expect(effects.getAnalysisActivities).toHaveBeenCalled());
    await fireEvent.change(getByLabelText('Source'), { target: { value: 'source-2' } });
    await waitFor(() =>
      expect(effects.getAnalysisActivities.mock.calls.at(-1)?.[0]._and[0]).toEqual({
        _or: [{ source_kind: { _eq: 'simulation' }, source_ref: { _eq: 1 } }],
      }),
    );
  });

  it('a row picked in the table is the activity the timeline draws under the same selection', async () => {
    const { component, container } = renderTable();
    const select = vi.fn();
    component.$on('select', event => select(event.detail));
    await waitFor(() => expect(container.querySelectorAll('.ag-center-cols-container .ag-row')).toHaveLength(2));
    const simulated = container.querySelector('.ag-center-cols-container .ag-row[row-index="1"]') as HTMLElement;
    await fireEvent.click(simulated);
    await waitFor(() =>
      expect(select).toHaveBeenCalledWith({
        endMs: Date.parse(rows[1].end_time ?? ''),
        ref: { activityId: 4, sourceId: 'source-2' },
        startMs: Date.parse(rows[1].start_time),
      }),
    );
    // The timeline highlights by drawing id: the selected ref must be that span's, not activity 4 of the TOL.
    const drawn = simulationSpanToActivity('source-2', {
      attributes: { arguments: {}, computedAttributes: {} },
      parent_id: null,
      span_id: 4,
    } as unknown as Span);
    const otherSource = importedActivityToSpan('source-1', {
      ...rows[0],
      end_time: rows[0].end_time ?? '',
      id: 4,
      parameters: {},
    });
    expect(getActivityDrawingId(select.mock.calls[0][0].ref)).toBe(drawn.span_id);
    expect(getActivityDrawingId(select.mock.calls[0][0].ref)).not.toBe(otherSource.span_id);
  });

  it('an activity selected on the timeline is highlighted and scrolled to in the table', async () => {
    const { component, container } = renderTable();
    await waitFor(() => expect(container.querySelectorAll('.ag-center-cols-container .ag-row')).toHaveLength(2));
    effects.getAnalysisActivities.mockResolvedValueOnce([rows[1]]);
    effects.getAnalysisActivityCount.mockResolvedValueOnce(1);
    await component.$set({ selected: { activityId: 4, sourceId: 'source-2' } });
    await waitFor(() =>
      expect(container.querySelectorAll('.ag-center-cols-container .ag-row.analysis-activity-selected')).toHaveLength(
        1,
      ),
    );
    expect(
      container.querySelector('.ag-center-cols-container .ag-row.analysis-activity-selected')?.textContent,
    ).toContain('Breakfast bite 1');
    // Its index is found by counting what precedes it under the table's filters and order.
    await waitFor(() =>
      expect(effects.getAnalysisActivityCount).toHaveBeenCalledWith(
        {
          _and: [
            expect.anything(),
            expect.objectContaining({ _or: expect.arrayContaining([{ start_time: { _lt: rows[1].start_time } }]) }),
          ],
        },
        null,
      ),
    );
  });
});
