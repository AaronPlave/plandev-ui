import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ReadValue from './ReadValue.svelte';

afterEach(cleanup);

const text = (el: Element | null) => el?.textContent ?? '';

describe('ReadValue unit wrapping', () => {
  it('keeps short text and its unit together as one unbreakable chunk, copied with a real space', () => {
    const { getByTestId } = render(ReadValue, { unit: 'px', value: 'wide' });
    expect(text(getByTestId('read-value'))).toBe('wide px');
    expect(text(getByTestId('read-value-tail'))).toBe('wide px');
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

  it('without a unit nothing is bound together; empty values show muted None without a unit', () => {
    const plain = render(ReadValue, { value: 'a_long_value_with_underscores' });
    expect(plain.container.querySelector('[data-testid="read-value-tail"]')).toBeNull();
    plain.unmount();
    const empty = render(ReadValue, { unit: 'm', value: '' });
    expect(text(empty.getByTestId('read-value'))).toBe('None');
    expect(empty.container.querySelector('[data-testid="read-value-tail"]')).toBeNull();
  });
});

describe('ReadValue numeric literals', () => {
  const cases: [string, string, string | undefined][] = [
    ['short number with unit', '2.5', 'm'],
    ['long high-precision decimal with unit', '3.14159265358979323846264338327950288419716939937510', 's'],
    ['negative number with unit', '-0.000000000123456789', 'm/s'],
    ['negative integer', '-42', 'kg'],
    ['scientific notation with unit', '6.02214076e+23', 'mol'],
    ['scientific notation, negative exponent', '-1.602176634E-19', 'C'],
    ['long integer', '12345678901234567890123', 'ticks'],
    ['number without a unit', '3.14159265358979323846264338327950288419716939937510', undefined],
  ];

  it.each(cases)('%s: exact text, no break opportunities inside the number, unit stays with it', (_n, value, unit) => {
    const { container, getByTestId } = render(ReadValue, { unit, value });
    const number = getByTestId('read-value-number');
    // Selection/copy sees exactly the literal (plus a real space and the unit), nothing inserted.
    expect(text(getByTestId('read-value'))).toBe(unit ? `${value} ${unit}` : value);
    expect(text(number)).toBe(value);
    // Not broken anywhere: no <wbr>, no separate tail chunk, the digits are one uninterrupted text node.
    expect(container.querySelector('wbr')).toBeNull();
    expect(container.querySelector('[data-testid="read-value-tail"]')).toBeNull();
    expect(number.firstChild?.nodeValue).toBe(value);
    // The unit follows the number as its own element after a real (breakable) space, so it can move if it must.
    const unitEl = container.querySelector('.unit');
    expect(unitEl?.textContent ?? null).toBe(unit ?? null);
    if (unitEl) {
      expect(number.nextSibling?.nodeValue).toBe(' ');
      expect(number.nextSibling?.nextSibling).toBe(unitEl);
    }
  });

  it('formats before deciding: a formatted numeric string is still treated as a number', () => {
    const { getByTestId } = render(ReadValue, { format: (v: number) => v.toFixed(3), unit: 'm', value: 2 });
    expect(text(getByTestId('read-value-number'))).toBe('2.000');
    expect(text(getByTestId('read-value'))).toBe('2.000 m');
  });

  it.each(['2024-001T00:00:00.123456', '00:00:00.123456789012', '1.2.3', 'v1.0', '12abc', '1,234.5', '0x1F'])(
    'does not treat %s as a plain number (it wraps like text)',
    value => {
      const { container } = render(ReadValue, { unit: 's', value });
      expect(container.querySelector('[data-testid="read-value-number"]')).toBeNull();
    },
  );

  it('never cuts a long number-like tail (times, durations) even though it is not a plain number', () => {
    const value = '2024-001T12:34:56.123456789012';
    const { getByTestId } = render(ReadValue, { unit: 's', value });
    expect(text(getByTestId('read-value'))).toBe(`${value} s`);
    // The digits after the final break opportunity stay whole inside the unit-bound tail.
    expect(text(getByTestId('read-value-tail'))).toBe('12:34:56.123456789012 s');
  });
});
