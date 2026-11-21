import { get } from 'svelte/store';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ViewGrid } from '../types/view';
import { generateDefaultView, getGridReveal } from '../utilities/view';
import { view, viewRevealPanel, viewTogglePanel } from './views';

// required for tests which transitively import `$env/dynamic/public` - unavailable in the vitest environment
vi.mock('$env/dynamic/public', () => ({ env: {} }));

// A user layout like MoonFall's "operations" view: a 3D panel on the right, form on the left, middle bottom hidden.
const userGrid: ViewGrid = {
  columnSizes: '0.9fr 3px 2fr 3px 3.1fr',
  leftComponentBottom: 'SimulationPanel',
  leftComponentTop: 'ActivityFormPanel',
  leftHidden: false,
  leftRowSizes: '2fr 3px 1fr',
  leftSplit: true,
  middleComponentBottom: 'ActivitySpansTablePanel',
  middleRowSizes: '1fr',
  middleSplit: false,
  rightComponentBottom: 'SchedulingGoalsPanel',
  rightComponentTop: 'CosmolabePanel',
  rightHidden: false,
  rightRowSizes: '5fr 3px 1fr',
  rightSplit: true,
};

function setGrid(grid: ViewGrid) {
  const v = generateDefaultView();
  v.definition.plan.grid = grid;
  view.set(v);
}
const grid = () => get(view)?.definition.plan.grid as ViewGrid;

describe('getGridReveal', () => {
  test('no-op when the component is already visible anywhere', () => {
    expect(getGridReveal(userGrid, { rightComponentTop: 'ActivityFormPanel' })).toBe('none');
  });
  test('never displaces a user panel in a visible slot', () => {
    expect(getGridReveal(userGrid, { rightComponentTop: 'PlanMetadataPanel' })).toBe('none');
    expect(getGridReveal(userGrid, { rightComponentTop: 'TimeCursorPanel' })).toBe('none');
  });
  test('swaps a selection-detail panel in place', () => {
    expect(
      getGridReveal({ ...userGrid, rightComponentTop: 'ActivityFormPanel' }, { rightComponentTop: 'TimeCursorPanel' }),
    ).toBe('swap');
  });
  test('shows a hidden slot', () => {
    expect(getGridReveal({ ...userGrid, rightHidden: true }, { rightComponentTop: 'PlanMetadataPanel' })).toBe('show');
    expect(getGridReveal(userGrid, { middleComponentBottom: 'ActivityDirectivesTablePanel' })).toBe('show');
  });
});

describe('viewRevealPanel', () => {
  beforeEach(() => setGrid(userGrid));

  test('selection side effects leave a user layout untouched', () => {
    viewRevealPanel({ rightComponentTop: 'PlanMetadataPanel' }, 'right'); // simulation dataset selected
    viewRevealPanel({ rightComponentTop: 'TimeCursorPanel' }, 'right'); // time cursor double-click
    viewRevealPanel({ rightComponentTop: 'ActivityFormPanel' }, 'right'); // activity double-click
    expect(grid()).toEqual(userGrid);
  });

  test('swaps a detail panel without collapsing the split', () => {
    setGrid({ ...userGrid, leftComponentTop: 'SimulationPanel', rightComponentTop: 'ActivityFormPanel' });
    viewRevealPanel({ rightComponentTop: 'TimeCursorPanel' }, 'right');
    expect(grid().rightComponentTop).toBe('TimeCursorPanel');
    expect(grid().rightSplit).toBe(true);
    expect(grid().rightComponentBottom).toBe('SchedulingGoalsPanel');
  });

  test('opens a hidden column', () => {
    setGrid({ ...userGrid, rightHidden: true });
    viewRevealPanel({ rightComponentTop: 'PlanMetadataPanel' }, 'right');
    expect(grid().rightHidden).toBe(false);
    expect(grid().rightComponentTop).toBe('PlanMetadataPanel');
  });

  test('explicit navigation still replaces the panel', () => {
    viewTogglePanel({ state: true, type: 'right', update: { rightComponentTop: 'TimeCursorPanel' } });
    expect(grid().rightComponentTop).toBe('TimeCursorPanel');
  });
});
