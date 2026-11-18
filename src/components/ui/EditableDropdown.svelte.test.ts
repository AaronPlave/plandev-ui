import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { DropdownOptions } from '../../types/dropdown';
import EditableDropdown from './EditableDropdown.svelte';

// Unavailable actions stay focusable and explained (aria-disabled + aria-describedby) rather than natively disabled.
function expectUnavailable(button: HTMLElement, reason: RegExp) {
  expect(button.getAttribute('aria-disabled')).toBe('true');
  const description = button.getAttribute('aria-describedby');
  expect(description && document.getElementById(description)?.textContent).toMatch(reason);
}

function expectAvailable(button: HTMLElement) {
  expect(button.getAttribute('aria-disabled')).toBeNull();
}

describe('Editable Dropdown component', () => {
  const options: DropdownOptions = [
    {
      display: 'Preset Test 3',
      value: 1,
    },
    {
      display: 'Preset Test 2',
      value: 2,
    },
    {
      display: 'Preset Test 10',
      value: 10,
    },
    {
      display: 'Preset Test 12',
      value: 12,
    },
  ];

  afterEach(() => {
    cleanup();
  });

  it('Save new option button should be disabled when no name is provided', async () => {
    const { getByText, getByRole } = render(EditableDropdown, {
      optionLabel: 'preset',
      options,
      placeholder: 'None',
    });

    await fireEvent.click(getByText('None'));
    expectUnavailable(getByRole('button', { name: 'Save as new preset' }), /unique/i);
  });

  it('Save new option button should be disabled when a non-unique name is provided', async () => {
    const { getByText, getByRole, getByPlaceholderText } = render(EditableDropdown, {
      optionLabel: 'preset',
      options,
      placeholder: 'None',
    });

    await fireEvent.click(getByText('None'));
    await fireEvent.input(getByPlaceholderText('Enter preset name'), { target: { value: 'Preset Test 3' } });
    expectUnavailable(getByRole('button', { name: 'Save as new preset' }), /unique/i);
  });

  it('Save new option button should be clickable ', async () => {
    const { getByText, getByRole, getByPlaceholderText } = render(EditableDropdown, {
      optionLabel: 'preset',
      options,
      placeholder: 'None',
    });

    await fireEvent.click(getByText('None'));
    await fireEvent.input(getByPlaceholderText('Enter preset name'), { target: { value: 'Preset Test 1' } });
    expectAvailable(getByRole('button', { name: 'Save as new preset' }));
  });

  it('permission and state are separate reasons, each explained, and an unavailable save never dispatches', async () => {
    const saved: string[] = [];
    const { component, getByText, getByRole, getByPlaceholderText } = render(EditableDropdown, {
      hasCreatePermission: false,
      optionLabel: 'preset',
      options,
      placeholder: 'None',
      planReadOnly: false,
    });
    component.$on('saveNewOption', (e: CustomEvent<string>) => saved.push(e.detail));

    await fireEvent.click(getByText('None'));
    await fireEvent.input(getByPlaceholderText('Enter preset name'), { target: { value: 'Brand new' } });
    const create = getByRole('button', { name: 'Save as new preset' });
    expectUnavailable(create, /permission to save a new preset/i);
    await fireEvent.click(create);
    expect(saved).toEqual([]);

    // Nothing selected: saving over / deleting are unavailable for a state reason, not a permission one.
    expectUnavailable(getByRole('button', { name: 'Save preset changes' }), /select a preset/i);
    expectUnavailable(getByRole('button', { name: 'Delete preset' }), /select a preset/i);
  });
});
