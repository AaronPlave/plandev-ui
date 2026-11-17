<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';

  export let errorId: string = '';
  export let formParameter: FormParameter;

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  let checkboxRef: HTMLInputElement;

  $: if (checkboxRef) {
    checkboxRef.indeterminate = formParameter.value == null || formParameter.value === '';
  }
</script>

<label class="boolean-editor">
  <input
    bind:this={checkboxRef}
    bind:checked={formParameter.value}
    aria-label={formParameter.name}
    aria-invalid={formParameter.errors !== null ? true : undefined}
    aria-describedby={formParameter.errors !== null ? errorId : undefined}
    type="checkbox"
    on:change={() => dispatch('change', formParameter)}
  />
  <span>{formParameter.value == null || formParameter.value === '' ? '' : String(!!formParameter.value)}</span>
</label>

<style>
  .boolean-editor {
    align-items: center;
    display: flex;
    gap: 6px;
    min-height: 24px;
  }

  input {
    margin: 0;
  }
</style>
