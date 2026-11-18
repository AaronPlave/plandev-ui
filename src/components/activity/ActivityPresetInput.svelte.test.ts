import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityDirective, ActivityPreset } from '../../types/activity';
import ActivityPresetInput from './ActivityPresetInput.svelte';

vi.mock('$env/dynamic/public', () => import.meta.env);
// Render every option (the real virtualizer needs layout, which jsdom doesn't have).
vi.mock('../ui/../RowVirtualizerFixed.svelte', async () => {
  const { default: MockComponent } = await import('../__mocks__/RowVirtualizerFixed.svelte');
  return { default: MockComponent };
});

const perms = vi.hoisted(() => ({
  canAssign: vi.fn(),
  canCreate: vi.fn(),
  canDelete: vi.fn(),
  canUnassign: vi.fn(),
  canUpdate: vi.fn(),
  readOnly: { value: false },
}));

vi.mock('../../stores/plan', async () => {
  const { readable } = await import('svelte/store');
  return {
    planReadOnly: {
      subscribe: (run: (v: boolean) => void) => readable(perms.readOnly.value).subscribe(run),
    },
  };
});
vi.mock('../../utilities/permissions', () => ({
  featurePermissions: { activityPresets: perms },
}));

const presets: ActivityPreset[] = [
  { arguments: {}, associated_activity_type: 'bake', id: 1, model_id: 1, name: 'Quick', owner: 'a' },
  { arguments: {}, associated_activity_type: 'bake', id: 2, model_id: 1, name: 'Slow', owner: 'b' },
];

vi.mock('../../stores/subscribable', async () => {
  const { readable } = await import('svelte/store');
  return {
    gqlSubscribable: () => ({ ...readable(presets), setVariables: () => {} }),
  };
});

const directive = {
  applied_preset: { preset_applied: presets[0], preset_id: 1 },
  id: 5,
  type: 'bake',
} as unknown as ActivityDirective;

const base = () => ({
  activityDirective: directive,
  modelId: 1,
  plan: { id: 1, model: { id: 1 } } as never,
  user: { id: 'a' } as never,
});

beforeEach(() => {
  perms.readOnly.value = false;
  for (const fn of [perms.canAssign, perms.canCreate, perms.canDelete, perms.canUnassign, perms.canUpdate]) {
    fn.mockReset().mockReturnValue(true);
  }
});
afterEach(cleanup);

describe('ActivityPresetInput', () => {
  it('shows the applied preset as plain information (no selector) when the activity is not editable', () => {
    const { container } = render(ActivityPresetInput, { ...base(), disabled: true });
    expect(container.querySelector('[data-field="preset"] [data-testid="read-value"]')?.textContent?.trim()).toBe(
      'Quick',
    );
    expect(container.querySelector('[role="combobox"], .activity-preset-input-container')).toBeNull();
  });

  it('shows the preset as information in a read-only plan, even if every permission would otherwise allow', () => {
    perms.readOnly.value = true;
    const { container } = render(ActivityPresetInput, base());
    expect(container.querySelector('[role="combobox"]')).toBeNull();
    expect(container.querySelector('[data-field="preset"]')?.textContent).toContain('Quick');
  });

  it('shows muted "None" when nothing is applied and the user can do nothing with presets', () => {
    for (const fn of [perms.canAssign, perms.canCreate, perms.canDelete, perms.canUnassign, perms.canUpdate]) {
      fn.mockReturnValue(false);
    }
    const { container } = render(ActivityPresetInput, {
      ...base(),
      activityDirective: { ...directive, applied_preset: null } as unknown as ActivityDirective,
    });
    expect(container.querySelector('[data-field="preset"] [data-testid="read-value"]')?.textContent?.trim()).toBe(
      'None',
    );
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });

  it('keeps the selector when only some preset actions are allowed, and explains the rest per action', async () => {
    // Can create presets, but may not apply, update or delete them (they are separate permissions).
    perms.canAssign.mockReturnValue(false);
    perms.canUnassign.mockReturnValue(false);
    perms.canUpdate.mockReturnValue(false);
    perms.canDelete.mockReturnValue(false);
    const { component, container, findAllByRole, getByRole, getByText } = render(ActivityPresetInput, base());
    const applied: unknown[] = [];
    component.$on('applyPreset', e => applied.push(e.detail));
    const combobox = container.querySelector('[role="combobox"]') as HTMLElement;
    expect(combobox).not.toBeNull();

    await fireEvent.click(getByText('Quick'));
    // Presets exist but can't be applied: each option is unavailable with the reason, and selecting is inert.
    const items = await findAllByRole('menuitem');
    const slow = items.find(item => item.textContent?.includes('Slow')) as HTMLElement;
    expect(slow.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(slow.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(
      /permission to apply this preset/i,
    );

    // Menu items activate on mouseup/Enter: neither may apply an unavailable preset.
    await fireEvent.mouseUp(slow);
    await fireEvent.keyDown(slow, { key: 'Enter' });
    expect(applied).toEqual([]);

    // Create/save/delete reasons stay discoverable and distinct.
    const describe = (name: string) => {
      const button = getByRole('button', { name });
      return {
        reason: document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent,
        unavailable: button.getAttribute('aria-disabled') === 'true',
      };
    };
    expect(describe('Save preset changes')).toEqual({
      reason: expect.stringMatching(/permission to save this preset/i),
      unavailable: true,
    });
    expect(describe('Delete preset')).toEqual({
      reason: expect.stringMatching(/permission to delete this preset/i),
      unavailable: true,
    });
    // Creating is allowed (state decides: no name typed yet), so the reason is about the name, not a permission.
    const create = describe('Save as new preset');
    expect(create.unavailable).toBe(true);
    expect(create.reason).not.toMatch(/permission/i);
  });

  it('clears stale update/delete permission when the applied preset goes away', async () => {
    const { component, container } = render(ActivityPresetInput, base());
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    perms.canAssign.mockReturnValue(false);
    perms.canCreate.mockReturnValue(false);
    perms.canUnassign.mockReturnValue(false);
    await component.$set({ activityDirective: { ...directive, applied_preset: null } });
    // Update/delete (previously true for preset 1) no longer apply to anything, so nothing is left to edit.
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });
});
