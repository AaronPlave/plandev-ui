<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';
  import ParameterInputBox from './ParameterInputBox.svelte';

  export let errorId: string = '';
  export let formParameter: FormParameter;
  export let type: 'text' | 'password' = 'text';

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  function handleChange(): void {
    dispatch('change', formParameter);
  }
</script>

<ParameterInputBox unit={formParameter.schema?.metadata?.unit?.value}>
  <!-- Type can only be text or password so it's safe to overwrite the type and don't coerce the value. -->
  <input
    bind:value={formParameter.value}
    class="st-input w-full"
    class:error={formParameter.errors !== null}
    aria-label={formParameter.name}
    aria-invalid={formParameter.errors !== null ? true : undefined}
    aria-describedby={formParameter.errors !== null ? errorId : undefined}
    autocomplete="off"
    {...{ type }}
    on:change={handleChange}
  />
</ParameterInputBox>
