<svelte:options immutable={true} />

<script lang="ts">
  import { debounce } from 'lodash-es';
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';
  import ParameterInputBox from './ParameterInputBox.svelte';

  // Editor only: label, provenance, details and validation message belong to ParameterRow.
  export let errorId: string = '';
  export let formParameter: FormParameter;

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  let debouncedOnChange = debounce(onChange, 350, {
    leading: true,
    trailing: true,
  });

  function onChange() {
    dispatch('change', formParameter);
  }
</script>

<ParameterInputBox unit={formParameter.schema?.metadata?.unit?.value}>
  <input
    bind:value={formParameter.value}
    class="st-input w-full"
    class:error={formParameter.errors !== null}
    type="number"
    aria-label={formParameter.name}
    aria-invalid={formParameter.errors !== null ? true : undefined}
    aria-describedby={formParameter.errors !== null ? errorId : undefined}
    on:change={debouncedOnChange}
  />
</ParameterInputBox>
