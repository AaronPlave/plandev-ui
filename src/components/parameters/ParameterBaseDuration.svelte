<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';
  import { convertDurationStringToUs, convertUsToDurationString } from '../../utilities/time';

  export let errorId: string = '';
  export let formParameter: FormParameter;

  let durationStringFormatError: string | null = null;

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  $: durationString = convertUsToDurationString(formParameter.value, true);

  function onChange() {
    try {
      dispatch('change', { ...formParameter, value: convertDurationStringToUs(durationString) });
      durationStringFormatError = null;
    } catch (error) {
      durationStringFormatError = (error as Error).message;
    }
  }
</script>

<input
  bind:value={durationString}
  class="st-input w-full"
  aria-label={formParameter.name}
  class:error={formParameter.errors !== null || durationStringFormatError !== null}
  aria-invalid={formParameter.errors !== null || durationStringFormatError !== null ? true : undefined}
  aria-describedby={formParameter.errors !== null ? errorId : undefined}
  type="text"
  on:change={onChange}
/>
{#if durationStringFormatError}
  <div class="duration-format-error" role="alert">{durationStringFormatError}</div>
{/if}

<style>
  .duration-format-error {
    color: var(--st-red);
    font-size: 12px;
    line-height: 16px;
  }
</style>
