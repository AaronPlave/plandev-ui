<svelte:options immutable={true} />

<script lang="ts">
  import PlusIcon from '@nasa-jpl/stellar/icons/plus.svg?component';
  import SaveIcon from '@nasa-jpl/stellar/icons/save.svg?component';
  import TrashIcon from '@nasa-jpl/stellar/icons/trash.svg?component';
  import { upperFirst } from 'lodash-es';
  import { createEventDispatcher } from 'svelte';
  import { PlanStatusMessages } from '../../enums/planStatusMessages';
  import type {
    DropdownOption,
    DropdownOptionValue,
    DropdownOptions,
    SelectedDropdownOptionValue,
  } from '../../types/dropdown';
  import { getTarget } from '../../utilities/generic';
  import { availability, availabilityOf, type Availability } from '../../utilities/availability';
  import SearchableDropdown from './SearchableDropdown.svelte';

  export let canSaveOver: boolean = false;
  export let disabled: boolean = false;

  export let hasCreatePermission: boolean = true;
  export let hasUpdatePermission: ((option: DropdownOption) => boolean) | boolean = true;
  export let hasDeletePermission: ((option: DropdownOption) => boolean) | boolean = true;
  export let error: string | undefined = undefined;
  export let options: DropdownOptions = [];
  export let optionLabel: string = 'Option';
  export let placeholder: string = '';
  export let planReadOnly: boolean = false;
  export let selectedOptionValue: SelectedDropdownOptionValue | undefined = undefined;
  export let showPlaceholderOption: boolean = true;
  export let searchPlaceholder: string = `Search ${upperFirst(optionLabel)}s`;
  export let selectTooltip: string = `Set ${upperFirst(optionLabel)}`;
  export let selectTooltipPlacement: string = 'top';

  const dispatch = createEventDispatcher<{
    deleteOption: DropdownOptionValue;
    saveNewOption: string;
    saveOption: DropdownOption;
    selectOption: SelectedDropdownOptionValue;
  }>();

  let deletePermission: boolean = true;
  let isOptionNameChanged: boolean = false;
  let isOptionNameDuped: boolean = false;
  let optionName: string = '';
  let requireUniqueDisplayNames: boolean = true;
  let searchableDropdown: SearchableDropdown;
  let selectedOption: DropdownOption | undefined;
  let updatePermission: boolean = true;

  $: if (typeof hasDeletePermission === 'function') {
    if (selectedOption) {
      if (typeof hasDeletePermission === 'function') {
        deletePermission = hasDeletePermission(selectedOption);
      }
    }
  } else {
    deletePermission = hasDeletePermission;
  }
  $: if (typeof hasUpdatePermission === 'function') {
    if (selectedOption) {
      if (typeof hasUpdatePermission === 'function') {
        updatePermission = hasUpdatePermission(selectedOption);
      }
    }
  } else {
    updatePermission = hasUpdatePermission;
  }
  $: isOptionNameChanged = !!optionName && optionName !== selectedOption?.display;
  $: isOptionNameDuped = !isOptionNameChanged
    ? false
    : options.reduce((previousValue: boolean, dropdownOption: DropdownOption) => {
        return previousValue || dropdownOption.display === optionName;
      }, false);
  $: selectedOption = options.find(option => option.value === selectedOptionValue);

  $: saveNewAvailability = ((): Availability => {
    const denied = availabilityOf(
      hasCreatePermission,
      planReadOnly
        ? PlanStatusMessages.READ_ONLY
        : `You do not have permission to save a new ${upperFirst(optionLabel).toLowerCase()}`,
    );
    if (!denied.available) {
      return denied;
    }
    const valid = !!optionName && isOptionNameChanged && !isOptionNameDuped;
    return availabilityOf(valid, getSaveNewTooltip(optionName));
  })();
  $: saveAvailability = ((): Availability => {
    const denied = availabilityOf(
      updatePermission,
      planReadOnly
        ? PlanStatusMessages.READ_ONLY
        : `You do not have permission to save this ${upperFirst(optionLabel).toLowerCase()}`,
    );
    if (!denied.available) {
      return denied;
    }
    if (!selectedOption) {
      return availabilityOf(false, `Select a ${optionLabel.toLowerCase()} to save changes to`);
    }
    if (isOptionNameDuped) {
      return availabilityOf(false, `You must enter a unique ${optionLabel.toLowerCase()} name`);
    }
    return availabilityOf(isOptionNameChanged || canSaveOver, 'Change the name or the parameters to save');
  })();
  $: deleteAvailability = ((): Availability => {
    const denied = availabilityOf(
      deletePermission,
      planReadOnly
        ? PlanStatusMessages.READ_ONLY
        : `You do not have permission to delete this ${upperFirst(optionLabel).toLowerCase()}`,
    );
    if (!denied.available) {
      return denied;
    }
    if (!selectedOption) {
      return availabilityOf(false, `Select a ${optionLabel.toLowerCase()} to delete`);
    }
    return availabilityOf(!isOptionNameChanged, `Save or revert the name change before deleting`);
  })();

  function getSaveNewTooltip(inputText: string) {
    if (requireUniqueDisplayNames) {
      if (!inputText || !isOptionNameChanged) {
        return `Enter a unique name for the new ${optionLabel.toLowerCase()}`;
      }

      if (isOptionNameDuped) {
        return `You must enter a unique ${optionLabel.toLowerCase()} name`;
      }
    } else if (!inputText) {
      return `Enter a name for the new ${optionLabel.toLowerCase()}`;
    }

    return `Save as new ${optionLabel.toLowerCase()}`;
  }

  function getSaveTooltip(inputText: string) {
    if (requireUniqueDisplayNames && isOptionNameDuped && inputText !== selectedOption?.display) {
      return `You must enter a unique ${optionLabel.toLowerCase()} name`;
    }

    return 'Save changes';
  }

  function onDeleteOption() {
    if (selectedOption) {
      dispatch('deleteOption', selectedOption.value);
      searchableDropdown.hideMenu();
    }
  }

  function onOpenMenu() {
    optionName = selectedOption?.display ?? '';
  }

  function onSaveNewOption() {
    if (optionName && isOptionNameChanged && !isOptionNameDuped) {
      dispatch('saveNewOption', optionName);
      searchableDropdown.hideMenu();
    }
  }

  function onSaveOption() {
    if (optionName && selectedOption && !isOptionNameDuped) {
      dispatch('saveOption', {
        display: optionName,
        value: selectedOption.value,
      } as DropdownOption);
      searchableDropdown.hideMenu();
    }
  }

  function onUpdateOptionName(event: Event) {
    const { value } = getTarget(event);
    optionName = `${value}`;
  }

  function onSelectOption(event: CustomEvent<SelectedDropdownOptionValue[]>) {
    dispatch('selectOption', event.detail[0] ?? null);
  }
</script>

<SearchableDropdown
  bind:this={searchableDropdown}
  {disabled}
  {error}
  {options}
  {placeholder}
  {planReadOnly}
  {searchPlaceholder}
  selectedOptionValues={selectedOptionValue !== undefined ? [selectedOptionValue] : []}
  name={selectTooltip}
  {selectTooltip}
  {selectTooltipPlacement}
  {showPlaceholderOption}
  on:openMenu={onOpenMenu}
  on:change={onSelectOption}
>
  <svelte:fragment slot="dropdown-header">
    <div class="dropdown-header">
      <input
        class="st-input w-full"
        placeholder={`Enter ${optionLabel.toLowerCase()} name`}
        aria-label={`Enter ${optionLabel.toLowerCase()} name`}
        value={optionName}
        on:input={onUpdateOptionName}
      />
      <!-- Each action is available or not for its own reason: a permission, or the current state of the name/selection.
           The reason is always discoverable (tooltip + aria-describedby); none of these are natively disabled. -->
      <button
        use:availability={{ ...saveNewAvailability, label: getSaveNewTooltip(optionName), placement: 'top' }}
        class="icon st-button"
        aria-label={`Save as new ${optionLabel.toLowerCase()}`}
        on:click|stopPropagation={onSaveNewOption}
      >
        <PlusIcon />
      </button>
      <button
        use:availability={{ ...saveAvailability, label: getSaveTooltip(optionName), placement: 'top' }}
        class="icon st-button"
        aria-label={`Save ${optionLabel.toLowerCase()} changes`}
        on:click|stopPropagation={onSaveOption}
      >
        <SaveIcon />
      </button>
      <button
        use:availability={{ ...deleteAvailability, label: `Delete ${optionLabel.toLowerCase()}`, placement: 'top' }}
        class="icon st-button"
        aria-label={`Delete ${optionLabel.toLowerCase()}`}
        on:click|stopPropagation={onDeleteOption}
      >
        <TrashIcon />
      </button>
    </div>
  </svelte:fragment>
</SearchableDropdown>

<style>
  .dropdown-header {
    display: flex;
    flex: 1;
  }
</style>
