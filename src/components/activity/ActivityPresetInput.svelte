<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { planReadOnly } from '../../stores/plan';
  import { gqlSubscribable } from '../../stores/subscribable';
  import type { ActivityDirective, ActivityPreset } from '../../types/activity';
  import type { User } from '../../types/app';
  import type {
    DropdownOption,
    DropdownOptionValue,
    DropdownOptions,
    SelectedDropdownOptionValue,
  } from '../../types/dropdown';
  import type { Model } from '../../types/model';
  import type { Plan } from '../../types/plan';
  import type { GqlSubscribable } from '../../types/subscribable';
  import gql from '../../utilities/gql';
  import { featurePermissions } from '../../utilities/permissions';
  import PropertyField from '../form/PropertyField.svelte';
  import EditableDropdown from '../ui/EditableDropdown.svelte';
  import Highlight from '../ui/Highlight.svelte';

  export let activityDirective: ActivityDirective | null | undefined;
  /** The activity itself is not editable here (e.g. previewing a revision): presets are shown, never changed. */
  export let disabled: boolean = false;
  export let hasChanges: boolean = false;
  export let highlightKeysMap: Record<string, boolean> = {};
  export let modelId: number;
  export let plan: Plan | null;
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    applyPreset: ActivityPreset | null;
    deletePreset: ActivityPreset;
    saveNewPreset: { name: string };
    savePreset: { name: string };
  }>();

  let activityPresets: GqlSubscribable<ActivityPreset[]> = gqlSubscribable<ActivityPreset[]>(
    gql.SUB_ACTIVITY_PRESETS,
    { activityTypeName: activityDirective?.type, modelId },
    [],
  );
  let hasAssignPermission: boolean = false;
  let hasCreatePermission: boolean = false;
  let hasDeletePermission: boolean = false;
  let hasUpdatePermission: boolean = false;
  let options: DropdownOptions = [];

  $: if (activityDirective != null) {
    activityPresets.setVariables({ activityTypeName: activityDirective.type, modelId });
  }
  $: if (plan !== null && plan.model) {
    options = $activityPresets.map((activityPreset: ActivityPreset) => ({
      display: activityPreset.name,
      hasSelectPermission: featurePermissions.activityPresets.canAssign(
        user,
        plan,
        plan.model as Model,
        activityPreset,
      ),
      selectUnavailableReason: 'You do not have permission to apply this preset to the activity',
      value: activityPreset.id,
    }));

    hasAssignPermission = featurePermissions.activityPresets.canUnassign(user, plan) && !$planReadOnly;
    hasCreatePermission = featurePermissions.activityPresets.canCreate(user, plan) && !$planReadOnly;

    const selectedPreset = $activityPresets.find(
      activityPreset => activityPreset.id === activityDirective?.applied_preset?.preset_id,
    );
    hasDeletePermission =
      selectedPreset !== undefined &&
      featurePermissions.activityPresets.canDelete(user, plan, selectedPreset) &&
      !$planReadOnly;
    hasUpdatePermission =
      selectedPreset !== undefined &&
      featurePermissions.activityPresets.canUpdate(user, plan, selectedPreset) &&
      !$planReadOnly;
  }
  $: selectedPresetName =
    $activityPresets.find(activityPreset => activityPreset.id === activityDirective?.applied_preset?.preset_id)?.name ??
    null;
  // The preset control is shown as an editor whenever the user can do anything with presets here. Applying a preset to
  // this activity and creating/updating/deleting a (model-scoped) preset are separate permissions, so it's the union.
  // Otherwise the applied preset is shown as plain information.
  $: presetEditable =
    !disabled &&
    !$planReadOnly &&
    (hasAssignPermission ||
      hasCreatePermission ||
      hasUpdatePermission ||
      hasDeletePermission ||
      options.some(option => option.hasSelectPermission));

  function onDeletePreset(event: CustomEvent<DropdownOptionValue>) {
    const { detail: activityPresetId } = event;
    const deletedActivityPreset = $activityPresets.find(activityPreset => activityPreset.id === activityPresetId);

    if (deletedActivityPreset) {
      dispatch('deletePreset', deletedActivityPreset);
    }
  }

  function onSaveNewPreset(event: CustomEvent<string>) {
    const { detail: presetName } = event;
    dispatch('saveNewPreset', { name: presetName });
  }

  function onSavePreset(event: CustomEvent<DropdownOption>) {
    const { detail: preset } = event;
    dispatch('savePreset', { name: preset.display });
  }

  function onSelectPreset(event: CustomEvent<SelectedDropdownOptionValue>) {
    const { detail: activityPresetId } = event;
    const selectedActivityPreset = $activityPresets.find(activityPreset => activityPreset.id === activityPresetId);

    dispatch('applyPreset', selectedActivityPreset ?? null);
  }
</script>

<Highlight highlight={highlightKeysMap.activity_preset}>
  <!-- The hairline always closes this row so it separates from the parameter list that follows. The row sits directly
       above the parameters, so it uses the same label column and gap to keep the values aligned. -->
  <div class="preset-row">
    <PropertyField
      divider
      editable={presetEditable}
      label="Preset"
      name="preset"
      title="Choose activity preset"
      value={selectedPresetName}
    >
      <div class="activity-preset-input-container">
        <EditableDropdown
          canSaveOver={hasChanges}
          {hasCreatePermission}
          {hasDeletePermission}
          {hasUpdatePermission}
          {options}
          optionLabel="preset"
          placeholder="None"
          planReadOnly={$planReadOnly}
          selectedOptionValue={activityDirective?.applied_preset?.preset_id}
          showPlaceholderOption={hasAssignPermission}
          on:deleteOption={onDeletePreset}
          on:saveNewOption={onSaveNewPreset}
          on:saveOption={onSavePreset}
          on:selectOption={onSelectPreset}
        />
      </div>
    </PropertyField>
  </div>
</Highlight>

<style>
  .preset-row {
    --property-column-gap: 4px;
    --property-label-width: min(100px, 36cqw);
    container-type: inline-size;
  }

  @container (min-width: 340px) {
    .preset-row :global(.property-field) {
      --property-label-width: min(116px, 36cqw);
    }
  }

  .activity-preset-input-container {
    --aerie-menu-item-template-columns: 1fr;
    align-items: center;
    display: grid;
  }
</style>
