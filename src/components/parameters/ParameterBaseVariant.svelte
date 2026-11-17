<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';
  import type { ValueSchemaVariant } from '../../types/schema';

  export let errorId: string = '';
  export let formParameter: FormParameter;

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  $: variants = (formParameter.schema as ValueSchemaVariant).variants;
</script>

<select
  aria-label={formParameter.name}
  aria-invalid={formParameter.errors !== null ? true : undefined}
  aria-describedby={formParameter.errors !== null ? errorId : undefined}
  bind:value={formParameter.value}
  class="st-select w-full"
  class:error={formParameter.errors !== null}
  on:change={() => dispatch('change', formParameter)}
>
  {#each variants as variant}
    <option value={variant.key}>
      {variant.label}
    </option>
  {/each}
</select>
