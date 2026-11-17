import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceBrowserNode } from '../../types/timelineSource';
import SourceBrowserTree from './SourceBrowserTree.svelte';

const nodes: SourceBrowserNode[] = [
  {
    children: [
      {
        action: { item: { name: 'Bite' } as never, sourceId: 's1', typeName: 'activity' },
        badge: '14',
        id: 's1/activity/Bite',
        kind: 'item',
        label: 'Bite',
      },
    ],
    id: 's1/activities',
    kind: 'group',
    label: 'Activity directives',
  },
];

describe('SourceBrowserTree', () => {
  afterEach(cleanup);

  it('selects any row by a click and opens a group only by its caret (or a double-click)', async () => {
    const select = vi.fn();
    const toggle = vi.fn();
    const { component } = render(SourceBrowserTree, {
      expanded: { 's1/activities': true },
      nodes,
      selectable: true,
      selectedId: 's1/activity/Bite',
    });
    component.$on('select', ({ detail }) => select(detail.id));
    component.$on('toggle', ({ detail }) => toggle(detail.id));

    await fireEvent.click(screen.getByText('Activity directives'));
    expect(select).toHaveBeenCalledWith('s1/activities');
    expect(toggle).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByLabelText('Close Activity directives'));
    expect(toggle).toHaveBeenCalledWith('s1/activities');
    await fireEvent.click(screen.getByText('Bite'));
    expect(select).toHaveBeenLastCalledWith('s1/activity/Bite');
    // The selected row says so.
    const item = screen.getByText('Bite').closest('[role="treeitem"]');
    expect(item?.getAttribute('aria-selected')).toBe('true');
    // No Add button is reserved beside the badge until the row is hovered or focused.
    expect(screen.queryByLabelText('Add Bite to timeline')).toBeNull();
  });

  it('opens a group on click where rows are not selectable (the Plan page)', async () => {
    const toggle = vi.fn();
    const { component } = render(SourceBrowserTree, { nodes });
    component.$on('toggle', ({ detail }) => toggle(detail.id));
    await fireEvent.click(screen.getByText('Activity directives'));
    expect(toggle).toHaveBeenCalledWith('s1/activities');
  });
});
