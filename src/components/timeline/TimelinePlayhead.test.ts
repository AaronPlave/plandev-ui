import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { scaleTime } from 'd3-scale';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
import { initializeView, view } from '../../stores/views';
import { createAnalysisDefinition } from '../../utilities/analysis';
import TimelinePlayhead from './TimelinePlayhead.svelte';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
// The test DOM has no PointerEvent, which the context menu dispatches to close other menus.
vi.stubGlobal('PointerEvent', MouseEvent);
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() })),
);

const range = { end: 2_000_000, start: 1_000_000 };

function renderPlayhead(readOnly: boolean) {
  initializeView({
    created_at: '',
    definition: createAnalysisDefinition().view,
    id: -1,
    name: 'v',
    owner: 'test',
    updated_at: '',
  });
  timeCursorMs.set(1_500_000);
  return render(TimelinePlayhead, {
    drawWidth: 1000,
    maxTimeRange: range,
    readOnly,
    viewTimeRange: range,
    xScaleView: scaleTime().domain([range.start, range.end]).range([0, 1000]),
  });
}

describe('TimelinePlayhead cursor menu', () => {
  afterEach(() => {
    cleanup();
    timeCursorMs.set(null);
    timeCursorCompareMs.set(null);
    view.set(null);
  });

  it('offers to pin the cursor as a vertical guide where the view can be edited', async () => {
    const { findByText, getByTestId } = renderPlayhead(false);
    await fireEvent.contextMenu(getByTestId('time-cursor-a'));
    expect(await findByText('Pin as Vertical Guide')).toBeDefined();
  });

  it('keeps moving and comparing the cursor, but offers no change to the view, when it is read-only', async () => {
    const { findByText, getByTestId, queryByText } = renderPlayhead(true);
    await fireEvent.contextMenu(getByTestId('time-cursor-a'));
    expect(await findByText('Compare With Another Time')).toBeDefined();
    expect(await findByText('Clear Time Cursor')).toBeDefined();
    await waitFor(() => expect(queryByText('Pin as Vertical Guide')).toBeNull());
  });
});
