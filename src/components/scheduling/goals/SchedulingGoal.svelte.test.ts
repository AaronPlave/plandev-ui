import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchedulingGoalMetadata, SchedulingGoalPlanSpecification } from '../../../types/scheduling';
import SchedulingGoal from './SchedulingGoal.svelte';

vi.mock('$env/dynamic/public', () => import.meta.env); // https://github.com/sveltejs/kit/issues/8180

const parameter_schema = {
  items: { latitude: { type: 'real' }, longitude: { type: 'real' } },
  type: 'struct',
};
const goal = {
  id: 1,
  name: 'PlanHop',
  versions: [{ analyses: [], parameter_schema, revision: 1, type: 'JAR' }],
} as unknown as SchedulingGoalMetadata;
const spec = (args: Record<string, number>) =>
  ({
    arguments: args,
    enabled: true,
    goal_id: 1,
    goal_invocation_id: 7,
    goal_metadata: null,
    goal_revision: 1,
    priority: 0,
    simulate_after: false,
    specification_id: 3,
  }) as unknown as SchedulingGoalPlanSpecification;

describe('SchedulingGoal arguments', () => {
  afterEach(() => cleanup());

  it('keeps an in-progress edit when the spec refreshes after another field was saved', async () => {
    const { component, getByLabelText } = render(SchedulingGoal, {
      goal,
      goalPlanSpec: spec({ latitude: -89.7, longitude: 0 }),
      hasEditPermission: true,
      hasReadPermission: true,
      modelId: 1,
    });
    const longitude = getByLabelText('longitude') as HTMLInputElement;
    await fireEvent.input(longitude, { target: { value: '5' } }); // typing, not yet committed (no change event)

    // The latitude edit was saved and the spec refreshes.
    await component.$set({ goalPlanSpec: spec({ latitude: -89.6, longitude: 0 }) });

    expect((getByLabelText('latitude') as HTMLInputElement).value).toBe('-89.6');
    expect(longitude.value).toBe('5');
  });
});
