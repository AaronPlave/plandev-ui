import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachAvailability, availabilityOf, TOUCH_REASON_DURATION_MS } from './availability';

function makeButton() {
  const button = document.createElement('button');
  button.textContent = 'Do it';
  document.body.appendChild(button);
  return button;
}

describe('availability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('availabilityOf maps a boolean + reason', () => {
    expect(availabilityOf(true, 'nope')).toEqual({ available: true });
    expect(availabilityOf(false, 'nope')).toEqual({ available: false, reason: 'nope' });
  });

  it('leaves an available control untouched', () => {
    const button = makeButton();
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    attachAvailability(button, { available: true });

    button.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('marks an unavailable control aria-disabled, keeps it focusable, and describes the reason', () => {
    const button = makeButton();
    attachAvailability(button, { available: false, reason: 'No permission' });

    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.hasAttribute('tabindex')).toBe(false);
    const description = document.getElementById(button.getAttribute('aria-describedby') as string);
    expect(description?.textContent).toBe('No permission');

    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it('blocks click activation before the control’s own handlers, without touching mousedown or focus', () => {
    const button = makeButton();
    const onClick = vi.fn();
    const onMouseDown = vi.fn();
    button.addEventListener('click', onClick);
    button.addEventListener('mousedown', onMouseDown);
    const parentClick = vi.fn();
    document.body.addEventListener('click', parentClick);
    attachAvailability(button, { available: false, reason: 'No permission' });

    button.focus();
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.click();

    expect(onClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    // mousedown is not intercepted (text selection etc. must keep working) and focus is not removed
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });

  it('blocks Enter and Space keyboard activation but lets Tab through', () => {
    const button = makeButton();
    const onKeyDown = vi.fn();
    button.addEventListener('keydown', onKeyDown);
    attachAvailability(button, { available: false, reason: 'No permission' });

    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    const tab = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    button.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(onKeyDown).toHaveBeenCalledTimes(1); // only Tab reached the control's handler
  });

  it('reacts to availability changing during a session (no stale reason)', () => {
    const button = makeButton();
    const onClick = vi.fn();
    button.addEventListener('click', onClick);
    const handle = attachAvailability(button, { available: false, reason: 'First reason' });
    const firstId = button.getAttribute('aria-describedby') as string;

    handle.update({ available: false, reason: 'Second reason' });
    expect(document.getElementById(button.getAttribute('aria-describedby') as string)?.textContent).toBe(
      'Second reason',
    );
    expect(document.querySelectorAll('[id^="availability-reason-"]').length).toBe(1);
    expect(document.getElementById(firstId)?.textContent).toBe('Second reason');

    handle.update({ available: true });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(document.querySelectorAll('[id^="availability-reason-"]').length).toBe(0);
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    handle.update({ available: false, reason: 'Back again' });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('preserves an existing aria-describedby and restores it', () => {
    const button = makeButton();
    button.setAttribute('aria-describedby', 'other');
    const handle = attachAvailability(button, { available: false, reason: 'No' });
    expect(button.getAttribute('aria-describedby')?.split(' ')[0]).toBe('other');
    expect(button.getAttribute('aria-describedby')?.split(' ').length).toBe(2);
    handle.update({ available: true });
    expect(button.getAttribute('aria-describedby')).toBe('other');
  });

  it('uses the label as the accessible name of an icon-only control and cleans up on destroy', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    const handle = attachAvailability(button, { available: true, label: 'Change plan time range' });
    expect(button.getAttribute('aria-label')).toBe('Change plan time range');

    handle.update({ available: false, label: 'Change plan time range', reason: 'View only' });
    handle.destroy();
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(document.querySelectorAll('[id^="availability-reason-"]').length).toBe(0);
  });

  it('keeps its label in sync as it changes, but never overwrites a name the caller provided', () => {
    const icon = document.createElement('button');
    document.body.appendChild(icon);
    const handle = attachAvailability(icon, { available: true, label: 'Save' });
    handle.update({ available: true, label: 'Save changes' });
    expect(icon.getAttribute('aria-label')).toBe('Save changes');
    handle.destroy();
    expect(icon.hasAttribute('aria-label')).toBe(false);

    const named = document.createElement('button');
    named.setAttribute('aria-label', 'Delete preset');
    document.body.appendChild(named);
    const namedHandle = attachAvailability(named, { available: false, label: 'Some tooltip', reason: 'No' });
    namedHandle.update({ available: false, label: 'Other tooltip', reason: 'No' });
    expect(named.getAttribute('aria-label')).toBe('Delete preset');
    namedHandle.destroy();
    expect(named.getAttribute('aria-label')).toBe('Delete preset');
  });

  it('shows the reason on activation attempts (touch) and hides it again', () => {
    const button = makeButton();
    attachAvailability(button, { available: false, reason: 'No permission' });
    button.click();
    expect(document.querySelector('[data-tippy-root]')).not.toBeNull();
    vi.advanceTimersByTime(TOUCH_REASON_DURATION_MS + 400);
    expect(document.querySelector('[data-tippy-root] [data-state="visible"]')).toBeNull();
  });
});
