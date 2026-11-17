<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';

  export let errorId: string = '';
  export let formParameter: FormParameter;

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  function onChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      const file = input.files.item(0);
      if (file !== null) {
        formParameter.file = file;
        formParameter.value = file.name;
        dispatch('change', formParameter);
      }
    }
  }
</script>

<div class="file-input">
  <!-- The chosen file's name is displayed (selectable), the native file input chooses a new one. -->
  <input
    value={formParameter.value ?? ''}
    class="st-input w-full"
    class:error={formParameter.errors !== null}
    aria-label={formParameter.name}
    aria-invalid={formParameter.errors !== null ? true : undefined}
    aria-describedby={formParameter.errors !== null ? errorId : undefined}
    readonly
    type="text"
  />
  <input type="file" aria-label="Choose file for {formParameter.name}" on:change={onChange} />
</div>

<style>
  .file-input {
    display: grid;
    gap: 5px;
  }
</style>
