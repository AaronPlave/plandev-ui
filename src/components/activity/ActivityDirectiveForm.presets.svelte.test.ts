import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityDirective } from '../../types/activity';
import ActivityDirectiveForm from './ActivityDirectiveForm.svelte';

vi.mock('$env/dynamic/public', () => import.meta.env);
vi.mock('./ActivityPresetInput.svelte', async () => {
  const { default: Stub } = await import('./__mocks__/ActivityPresetInputStub.svelte');
  return { default: Stub };
});

const mocks = vi.hoisted(() => ({
  applyPresetToActivity: vi.fn(),
  canAssign: vi.fn(),
  canCreate: vi.fn(),
  canUpdate: vi.fn(),
  createActivityPreset: vi.fn(),
  deleteActivityPreset: vi.fn(),
  readOnly: { value: false },
  removePresetFromActivityDirective: vi.fn(),
  showFailureToast: vi.fn(),
  updateActivityPreset: vi.fn(),
  validateActivityArguments: vi.fn(),
}));

vi.mock('../../utilities/effects', () => ({
  default: {
    applyPresetToActivity: mocks.applyPresetToActivity,
    createActivityPreset: mocks.createActivityPreset,
    deleteActivityPreset: mocks.deleteActivityPreset,
    removePresetFromActivityDirective: mocks.removePresetFromActivityDirective,
    updateActivityPreset: mocks.updateActivityPreset,
    validateActivityArguments: mocks.validateActivityArguments,
  },
}));
vi.mock('../../utilities/toast', () => ({ showFailureToast: mocks.showFailureToast, showSuccessToast: vi.fn() }));
vi.mock('../../utilities/permissions', () => ({
  featurePermissions: {
    activityDirective: { canUpdate: mocks.canUpdate },
    activityPresets: { canAssign: mocks.canAssign, canCreate: mocks.canCreate },
  },
}));
vi.mock('../../stores/plan', async importOriginal => {
  const { readable } = await import('svelte/store');
  const plan = readable({ id: 1, model: { id: 1, name: 'm' } });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    plan,
    planReadOnly: { subscribe: (run: (v: boolean) => void) => readable(mocks.readOnly.value).subscribe(run) },
  };
});

const directive = {
  anchor_id: null,
  anchored_to_start: true,
  applied_preset: null,
  arguments: {},
  created_at: '2022-08-03T18:21:51',
  created_by: 'admin',
  id: 5,
  last_modified_arguments_at: '2022-08-03T21:53:22',
  last_modified_at: '2022-08-03T21:53:22',
  metadata: {},
  name: 'bake',
  plan_id: 1,
  source_scheduling_goal_id: null,
  source_scheduling_goal_invocation_id: null,
  start_offset: '00:00:00',
  start_time_ms: 0,
  tags: [],
  type: 'bake',
} as unknown as ActivityDirective;

const created = { arguments: {}, associated_activity_type: 'bake', id: 7, model_id: 1, name: 'Fresh', owner: 'a' };

function renderForm(props: Record<string, unknown> = {}) {
  return render(ActivityDirectiveForm, {
    activityDirective: directive,
    modelId: 1,
    planStartTimeYmd: '2022-001T00:00:00',
    user: { id: 'a' } as never,
    ...props,
  });
}

const saveNew = (result: ReturnType<typeof renderForm>) => fireEvent.click(result.getByTestId('stub-save-new'));

beforeEach(() => {
  // jsdom has no canvas; SearchableDropdown measures option widths with one.
  HTMLCanvasElement.prototype.getContext = (() => ({ font: '', measureText: () => ({ width: 0 }) })) as never;
  mocks.readOnly.value = false;
  for (const fn of Object.values(mocks)) {
    if (typeof fn === 'function' && 'mockReset' in fn) {
      fn.mockReset();
    }
  }
  mocks.canAssign.mockReturnValue(true);
  mocks.canCreate.mockReturnValue(true);
  mocks.canUpdate.mockReturnValue(true);
  mocks.createActivityPreset.mockResolvedValue(created);
  mocks.validateActivityArguments.mockResolvedValue({});
});
afterEach(cleanup);

describe('Selected Activity: Save as new preset', () => {
  it('creates the preset and applies it when both are permitted', async () => {
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.applyPresetToActivity).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).toHaveBeenCalledTimes(1);
    expect(mocks.createActivityPreset.mock.calls[0].slice(1, 4)).toEqual(['bake', 'Fresh', 1]);
    expect(mocks.applyPresetToActivity.mock.calls[0][0]).toBe(created);
    expect(mocks.applyPresetToActivity.mock.calls[0][1]).toBe(5);
    expect(mocks.showFailureToast).not.toHaveBeenCalled();
  });

  it('creates the preset but does not touch the activity when applying is denied, and says so', async () => {
    mocks.canAssign.mockReturnValue(false);
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.showFailureToast).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).toHaveBeenCalledTimes(1);
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
    expect(mocks.showFailureToast.mock.calls[0][0]).toMatch(/Fresh.*created but not applied/);
  });

  it('does not apply when the user cannot modify this activity, even if apply_preset is allowed', async () => {
    mocks.canUpdate.mockReturnValue(false);
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.showFailureToast).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).toHaveBeenCalledTimes(1);
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
  });

  it('calls no mutation at all when creating is denied', async () => {
    mocks.canCreate.mockReturnValue(false);
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.showFailureToast).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).not.toHaveBeenCalled();
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
    expect(mocks.showFailureToast.mock.calls[0][0]).toMatch(/Not Created/);
  });

  it('reports the apply failure from the apply step and does not roll back or retry the created preset', async () => {
    // effects.applyPresetToActivity reports its own failure (toast) and resolves; creation is not repeated.
    mocks.applyPresetToActivity.mockResolvedValue(undefined);
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.applyPresetToActivity).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).toHaveBeenCalledTimes(1);
    expect(mocks.deleteActivityPreset).not.toHaveBeenCalled();
    // No second, misleading "not applied" message: the apply step was attempted and owns its own report.
    expect(mocks.showFailureToast).not.toHaveBeenCalled();
  });

  it('does not attempt to apply when creation fails', async () => {
    mocks.createActivityPreset.mockResolvedValue(null);
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.createActivityPreset).toHaveBeenCalledTimes(1));
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
    // createActivityPreset reports its own failure; no extra "not applied" message on top of it.
    expect(mocks.showFailureToast).not.toHaveBeenCalled();
  });

  it('calls no mutation in a read-only plan', async () => {
    mocks.readOnly.value = true;
    await saveNew(renderForm());
    await waitFor(() => expect(mocks.showFailureToast).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).not.toHaveBeenCalled();
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
  });

  it('calls no mutation when previewing a revision (activity not editable)', async () => {
    await saveNew(renderForm({ editable: false }));
    await waitFor(() => expect(mocks.showFailureToast).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).not.toHaveBeenCalled();
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
  });
});

describe('Selected Activity: other preset workflows are unchanged', () => {
  it('apply forwards the chosen preset', async () => {
    const result = renderForm();
    await fireEvent.click(result.getByTestId('stub-apply'));
    await waitFor(() => expect(mocks.applyPresetToActivity).toHaveBeenCalledTimes(1));
    expect(mocks.applyPresetToActivity.mock.calls[0][0]).toEqual({ id: 9, name: 'Other' });
    expect(mocks.createActivityPreset).not.toHaveBeenCalled();
  });

  it('delete forwards the preset and does not create or apply', async () => {
    const result = renderForm();
    await fireEvent.click(result.getByTestId('stub-delete'));
    await waitFor(() => expect(mocks.deleteActivityPreset).toHaveBeenCalledTimes(1));
    expect(mocks.createActivityPreset).not.toHaveBeenCalled();
    expect(mocks.applyPresetToActivity).not.toHaveBeenCalled();
  });
});
