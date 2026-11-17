import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../types/plan';
import { showChangePlanBoundsModal } from '../../utilities/modal';
import PlanTimeBounds from './PlanTimeBounds.svelte';

vi.mock('../../utilities/modal', () => ({
  showChangePlanBoundsModal: vi.fn(),
}));

const plan = {
  duration: '216:00:00',
  end_time_doy: '2024-010T00:00:00',
  id: 1,
  start_time: '2024-01-01T00:00:00+00:00',
} as Plan;

describe('PlanTimeBounds component', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the start, end and duration as plain selectable text, not inputs', () => {
    const { container } = render(PlanTimeBounds, { props: { hasUpdatePermission: true, plan, user: null } });

    expect(container.querySelector('input')).toBeNull();
    const text = (name: string) =>
      container.querySelector(`[data-field="${name}"] [data-testid="read-value"]`)?.textContent;
    expect(text('planStartTime')).toContain('2024-001');
    expect(text('planEndTime')).toContain('2024-010');
    expect(text('planDuration')).toBeTruthy();
  });

  it('opens the change-plan-bounds modal when the edit button is clicked', async () => {
    const { getByRole } = render(PlanTimeBounds, { props: { hasUpdatePermission: true, plan, user: null } });

    await fireEvent.click(getByRole('button', { name: 'Change plan time range' }));

    expect(showChangePlanBoundsModal).toHaveBeenCalledWith(plan, null);
  });

  it('keeps the edit action visible and explained, but inert, when the user cannot edit', async () => {
    const { getByRole } = render(PlanTimeBounds, {
      props: {
        hasUpdatePermission: false,
        permissionError: 'You do not have permission to edit this plan.',
        plan,
        user: null,
      },
    });
    const button = getByRole('button', { name: 'Change plan time range' });

    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.getElementById(button.getAttribute('aria-describedby') as string)?.textContent).toBe(
      'You do not have permission to edit this plan.',
    );

    await fireEvent.click(button);
    expect(showChangePlanBoundsModal).not.toHaveBeenCalled();
  });

  it('re-enables the action when permission is gained during the session', async () => {
    const { component, getByRole } = render(PlanTimeBounds, {
      props: { hasUpdatePermission: false, permissionError: 'No', plan, user: null },
    });
    await component.$set({ hasUpdatePermission: true });
    const button = getByRole('button', { name: 'Change plan time range' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    await fireEvent.click(button);
    expect(showChangePlanBoundsModal).toHaveBeenCalledTimes(1);
  });
});
