import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityDirective, ActivityDirectivesMap } from '../../types/activity';
import ActivityAnchorForm from './ActivityAnchorForm.svelte';

describe('Activity Anchor Form component', () => {
  const activityDirectivesMap: ActivityDirectivesMap = {
    12: {
      anchor_id: null,
      anchored_to_start: true,
      applied_preset: null,
      arguments: {},
      created_at: '2022-08-03T18:21:51',
      created_by: 'admin',
      id: 12,
      last_modified_arguments_at: '2022-08-03T21:53:22',
      last_modified_at: '2022-08-03T21:53:22',
      metadata: {},
      name: 'parent 1',
      plan_id: 12,
      source_scheduling_goal_id: null,
      source_scheduling_goal_invocation_id: null,
      start_offset: '00:00:00.00',
      start_time_ms: 1715731443696,
      tags: [],
      type: 'parent',
    },
    13: {
      anchor_id: 12,
      anchored_to_start: true,
      applied_preset: null,
      arguments: {},
      created_at: '2022-08-03T18:21:51',
      created_by: 'admin',
      id: 13,
      last_modified_arguments_at: '2022-08-03T21:53:22',
      last_modified_at: '2022-08-03T21:53:22',
      metadata: {},
      name: 'child 1',
      plan_id: 12,
      source_scheduling_goal_id: null,
      source_scheduling_goal_invocation_id: null,
      start_offset: '00:10:00.00',
      start_time_ms: 1715731443696,
      tags: [],
      type: 'parent',
    },
    14: {
      anchor_id: 12,
      anchored_to_start: true,
      applied_preset: null,
      arguments: {},
      created_at: '2022-08-03T18:21:51',
      created_by: 'admin',
      id: 14,
      last_modified_arguments_at: '2022-08-03T21:53:22',
      last_modified_at: '2022-08-03T21:53:22',
      metadata: {},
      name: 'child 2',
      plan_id: 12,
      source_scheduling_goal_id: null,
      source_scheduling_goal_invocation_id: null,
      start_offset: '11:00:00.00',
      start_time_ms: 1715731443696,
      tags: [],
      type: 'parent',
    },
    15: {
      anchor_id: 13,
      anchored_to_start: true,
      applied_preset: null,
      arguments: {},
      created_at: '2022-08-03T18:21:51',
      created_by: 'admin',
      id: 15,
      last_modified_arguments_at: '2022-08-03T21:53:22',
      last_modified_at: '2022-08-03T21:53:22',
      metadata: {},
      name: 'child 3',
      plan_id: 12,
      source_scheduling_goal_id: null,
      source_scheduling_goal_invocation_id: null,
      start_offset: '09:00:00.00',
      start_time_ms: 1715731443696,
      tags: [],
      type: 'parent',
    },
  };

  afterEach(() => {
    cleanup();
  });

  it('Should not render the form if no anchor is initially present', () => {
    const activityDirective: ActivityDirective = activityDirectivesMap[12];

    const { getAllByRole } = render(ActivityAnchorForm, {
      activityDirective,
      activityDirectivesMap,
      anchorId: activityDirective.anchor_id,
      isAnchoredToStart: activityDirective.anchored_to_start,
      startOffset: activityDirective.start_offset,
    });
    expect(getAllByRole('group')[0].getElementsByClassName('content')[0].getAttribute('aria-hidden')).toEqual('true');
  });

  it('Should render the form when an anchor is initially present', () => {
    const activityDirective: ActivityDirective = activityDirectivesMap[13];

    const { getAllByRole } = render(ActivityAnchorForm, {
      activityDirective,
      activityDirectivesMap,
      anchorId: activityDirective.anchor_id,
      isAnchoredToStart: activityDirective.anchored_to_start,
      startOffset: activityDirective.start_offset,
    });

    expect(getAllByRole('group')[0].getElementsByClassName('content')[0].getAttribute('aria-hidden')).toEqual('false');
  });

  describe('editable vs read-only', () => {
    const props = () => {
      const activityDirective: ActivityDirective = activityDirectivesMap[13];
      return {
        activityDirective,
        activityDirectivesMap,
        anchorId: activityDirective.anchor_id,
        isAnchoredToStart: activityDirective.anchored_to_start,
        startOffset: activityDirective.start_offset,
      };
    };
    const value = (container: HTMLElement, name: string) =>
      container.querySelector(`[data-field="${name}"] [data-testid="read-value"]`)?.textContent?.trim();

    it('shows the anchor, edge and offset as plain information (no inputs) when the user cannot edit', () => {
      const { container } = render(ActivityAnchorForm, { ...props(), hasUpdatePermission: false });
      expect(value(container, 'anchor-id')).toBe('12 - parent 1');
      expect(value(container, 'anchored-to-start')).toBe('Start');
      expect(value(container, 'start-offset')).toContain('10m');
      expect(container.querySelector('input, [role="combobox"], .anchor-boundary')).toBeNull();
    });

    it('is also read-only when the plan is read-only or the activity is not editable (disabled)', () => {
      const readOnlyPlan = render(ActivityAnchorForm, { ...props(), hasUpdatePermission: true, planReadOnly: true });
      expect(readOnlyPlan.container.querySelector('input, [role="combobox"]')).toBeNull();
      readOnlyPlan.unmount();
      const disabled = render(ActivityAnchorForm, { ...props(), disabled: true, hasUpdatePermission: true });
      expect(disabled.container.querySelector('input, [role="combobox"]')).toBeNull();
    });

    it('offers the editors, and dispatches an edge change, when the user can edit', async () => {
      const edges: boolean[] = [];
      const { component, container, getByRole } = render(ActivityAnchorForm, { ...props(), hasUpdatePermission: true });
      component.$on('updateAnchorEdge', (e: CustomEvent<boolean>) => edges.push(e.detail));
      expect(container.querySelector('[role="combobox"]')).not.toBeNull();
      expect(container.querySelector('input[name="start-offset"]')).not.toBeNull();
      await fireEvent.click(getByRole('button', { name: 'End' }));
      expect(edges).toEqual([false]);
    });
  });
});
