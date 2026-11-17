import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PropertyField from './PropertyField.svelte';
import PropertyFieldHarness from './PropertyFieldHarness.svelte';

describe('PropertyField', () => {
  afterEach(cleanup);

  it('renders an intrinsically informational value as plain text', () => {
    const { container, getByText } = render(PropertyField, { props: { label: 'Plan ID', value: 12 } });
    expect(getByText('Plan ID')).toBeTruthy();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-testid="read-value"]')?.textContent).toBe('12');
    expect(container.querySelector('.property-field')?.classList.contains('read-only')).toBe(true);
  });

  it('shows muted "None" for empty values (null, undefined, empty string) but not for 0 or false', () => {
    for (const value of [null, undefined, '']) {
      const { container, unmount } = render(PropertyField, { props: { label: 'Tags', value } });
      const read = container.querySelector('[data-testid="read-value"]');
      expect(read?.textContent).toBe('None');
      expect(read?.classList.contains('empty')).toBe(true);
      unmount();
    }
    for (const value of [0, false]) {
      const { container, unmount } = render(PropertyField, { props: { label: 'x', value } });
      expect(container.querySelector('[data-testid="read-value"]')?.textContent).toBe(String(value));
      unmount();
    }
  });

  it('applies an optional formatter to read values only', () => {
    const { container } = render(PropertyField, {
      props: { format: (v: number) => `${v} items`, label: 'Items', value: 2 },
    });
    expect(container.querySelector('[data-testid="read-value"]')?.textContent).toBe('2 items');
  });

  it('keeps long values complete and copyable: soft break opportunities, no truncation, no extra characters', () => {
    const path = '/europa/sequences/2026-001/flyby-E12/banana_bite_morning_v12.seq.json';
    const { container } = render(PropertyField, { props: { label: 'File', value: path } });
    const read = container.querySelector('[data-testid="read-value"]') as HTMLElement;
    expect(read.textContent).toBe(path);
    expect(read.querySelectorAll('wbr').length).toBeGreaterThan(3);
  });

  it('reserves the trailing action column only when an action is provided', () => {
    const { container, rerender } = render(PropertyField, { props: { label: 'Plan ID', value: 1 } });
    expect(container.querySelector('.property-action')).toBeNull();
    expect(container.querySelector('.property-field')?.classList.contains('has-action')).toBe(false);
    rerender({ label: 'Plan ID', value: 1 });
  });

  it('shows the editor when editable and the read view when not (one call site, no caller conditional)', async () => {
    const { component, container } = render(PropertyFieldHarness, { props: { editable: true } });
    expect(container.querySelector('input')).not.toBeNull();
    expect(container.querySelector('.property-field')?.classList.contains('read-only')).toBe(false);

    await component.$set({ editable: false });
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-testid="read-value"]')?.textContent).toBe('Saved name');

    await component.$set({ editable: true });
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('keeps Field validation/binding working when the editor appears after mount (permission gained)', async () => {
    const onChange = vi.fn();
    const { component, container } = render(PropertyFieldHarness, { props: { editable: false, onChange } });
    expect(container.querySelector('input')).toBeNull();

    await component.$set({ editable: true });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Saved name');

    await fireEvent.input(input, { target: { value: 'Renamed' } });
    await fireEvent.change(input, { target: { value: 'Renamed' } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('Renamed'));
  });

  it('does not lose an edited draft when the editor is hidden and shown again', async () => {
    const { component, container } = render(PropertyFieldHarness, { props: { editable: true } });
    const input = container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Draft in progress' } });

    await component.$set({ editable: false });
    // The read view shows the saved value, never the unsaved draft…
    expect(container.querySelector('[data-testid="read-value"]')?.textContent).toBe('Saved name');
    await component.$set({ editable: true });
    // …and the draft is still there when editing is possible again.
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('Draft in progress');
  });

  it('associates the label with the editor only when editable', async () => {
    const { component, container } = render(PropertyFieldHarness, { props: { editable: true } });
    expect(container.querySelector('label[for="name"]')).not.toBeNull();
    await component.$set({ editable: false });
    expect(container.querySelector('label')).toBeNull();
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-labelledby')).toBeTruthy();
  });
});
