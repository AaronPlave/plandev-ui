import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AvailabilityButtonHarness from './AvailabilityButtonHarness.svelte';

afterEach(cleanup);

describe('AvailabilityButton (Stellar Button + bits-ui builder)', () => {
  it('behaves like a normal button while available', async () => {
    const onClick = vi.fn();
    const { getByRole } = render(AvailabilityButtonHarness, { onClick });
    const button = getByRole('button', { name: 'Go' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is aria-disabled, explained, focusable and inert while unavailable (click and keyboard)', async () => {
    const onClick = vi.fn();
    const { getByRole } = render(AvailabilityButtonHarness, {
      availability: { available: false, reason: 'View only' },
      onClick,
    });
    const button = getByRole('button', { name: 'Go' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('View only');
    button.focus();
    expect(document.activeElement).toBe(button);
    await fireEvent.click(button);
    await fireEvent.keyDown(button, { key: 'Enter' });
    await fireEvent.keyDown(button, { key: ' ' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('follows availability changes (builder update path), and leaves no stale description behind', async () => {
    const onClick = vi.fn();
    const { component, getByRole, unmount } = render(AvailabilityButtonHarness, {
      availability: { available: false, reason: 'View only' },
      onClick,
    });
    const button = getByRole('button', { name: 'Go' });
    await component.$set({ availability: { available: true } });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    await component.$set({ availability: { available: false, reason: 'Locked' } });
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Locked');
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.querySelectorAll('[id^="availability-reason-"]').length).toBe(0);
  });
});
