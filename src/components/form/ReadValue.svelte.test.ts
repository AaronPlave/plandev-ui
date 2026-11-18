import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ReadValue from './ReadValue.svelte';

afterEach(cleanup);

const text = (el: Element | null) => el?.textContent ?? '';

describe('ReadValue unit wrapping', () => {
  it('keeps short values and their unit together as one unbreakable chunk, copied with a real space', () => {
    const { getByTestId } = render(ReadValue, { unit: 'm', value: 2.5 });
    expect(text(getByTestId('read-value'))).toBe('2.5 m');
    expect(text(getByTestId('read-value-tail'))).toBe('2.5 m');
  });

  it('lets a long value wrap: only its final portion is bound to the unit', () => {
    const value = '/very/long/path/to/some/file/in/a/mission/directory/data.csv';
    const { getByTestId } = render(ReadValue, { unit: 'kB', value });
    const tail = getByTestId('read-value-tail');
    // Full text is intact for selection/copy.
    expect(text(getByTestId('read-value'))).toBe(`${value} kB`);
    // The unbreakable part is a small tail, not the whole string.
    expect(text(tail).length).toBeLessThan(value.length / 2);
    expect(text(tail)).toMatch(/kB$/);
    expect(text(tail)).toBe('csv kB');
    // Earlier segments are outside the nowrap chunk and offer break opportunities.
    expect(getByTestId('read-value').querySelectorAll('wbr').length).toBeGreaterThan(3);
  });

  it('keeps full numeric precision and splits an unbroken long token so it can wrap', () => {
    const value = '3.14159265358979323846264338327950288419716939937510';
    const { getByTestId } = render(ReadValue, { unit: 's', value });
    expect(text(getByTestId('read-value'))).toBe(`${value} s`);
    expect(text(getByTestId('read-value-tail')).length).toBeLessThanOrEqual(4 + 2);
  });

  it('without a unit nothing is bound together; empty values show muted None without a unit', () => {
    const plain = render(ReadValue, { value: 'a_long_value_with_underscores' });
    expect(plain.container.querySelector('[data-testid="read-value-tail"]')).toBeNull();
    plain.unmount();
    const empty = render(ReadValue, { unit: 'm', value: '' });
    expect(text(empty.getByTestId('read-value'))).toBe('None');
    expect(empty.container.querySelector('[data-testid="read-value-tail"]')).toBeNull();
  });
});
