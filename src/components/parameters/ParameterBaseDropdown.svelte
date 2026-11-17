<svelte:options immutable={true} />

<script lang="ts">
  import ChevronDownIcon from '@nasa-jpl/stellar/icons/chevron_down.svg?component';
  import { createEventDispatcher } from 'svelte';
  import type { DropdownOptions, SelectedDropdownOptionValue } from '../../types/dropdown';
  import type { FormParameter } from '../../types/parameter.js';
  import { isParameterWithOptions } from '../../utilities/parameters';
  import SearchableDropdown from '../ui/SearchableDropdown.svelte';

  export let allowMultiple: boolean = false;
  export let formParameter: FormParameter;
  export let placeholderText: string | undefined = undefined;
  export let selectedOptionLabel: string = '';

  let dropdownOptions: DropdownOptions = [];
  let selectedDropdownOptions: SelectedDropdownOptionValue[] = [];
  let placeholder: string;
  let searchPlaceholder: string;

  const dispatch = createEventDispatcher<{
    change: FormParameter;
    reset: FormParameter;
  }>();

  $: if (isParameterWithOptions(formParameter.schema)) {
    dropdownOptions = formParameter.schema.options.map(option => ({ display: option.display, value: option.value }));
    placeholder =
      placeholderText ??
      (allowMultiple ? `Select list of ${formParameter.schema.label}s` : `Select ${formParameter.schema.label}`);
    searchPlaceholder = `Filter ${formParameter.schema.label}s`;
    selectedDropdownOptions = updateSelectedValueFromOptions(formParameter.value);
  }

  function updateSelectedValueFromOptions(value: any): SelectedDropdownOptionValue[] {
    if (value !== null) {
      if (allowMultiple && Array.isArray(value)) {
        const options: string[] = [];
        value.forEach(v => {
          const found = dropdownOptions.find(o => o.display === v);
          options.push(found === undefined ? v.toString() : found.value.toString());
        });
        return options;
      } else {
        const option = dropdownOptions.find(o => o.display === value);
        return option === undefined ? [value] : [option.value.toString()];
      }
    }
    return [];
  }

  function onChange(event: CustomEvent<SelectedDropdownOptionValue[]>) {
    selectedDropdownOptions = event.detail;
    dispatch(`change`, {
      ...formParameter,
      value: allowMultiple ? selectedDropdownOptions : selectedDropdownOptions[0],
    });
  }
</script>

<div class="flex min-w-0 items-center gap-1">
  <div class="min-w-0 flex-1">
    <SearchableDropdown
      bind:selectedOptionValues={selectedDropdownOptions}
      {allowMultiple}
      showPlaceholderOption={false}
      options={dropdownOptions}
      {placeholder}
      {searchPlaceholder}
      {selectedOptionLabel}
      on:change={onChange}
    >
      <ChevronDownIcon slot="icon" />
    </SearchableDropdown>
  </div>
  <slot name="trailing" />
</div>
