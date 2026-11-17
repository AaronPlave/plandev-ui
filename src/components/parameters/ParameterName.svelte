<svelte:options immutable={true} />

<script lang="ts">
  import type { FormParameter } from '../../types/parameter';
  import { camelCaseSegments } from '../../utilities/softBreaks';
  import { tooltip } from '../../utilities/tooltip';

  export let formParameter: FormParameter;

  let tooltipContent: string;

  $: tooltipContent = formParameter.required ? `${formParameter.name} (required)` : formParameter.name;
  $: segments = camelCaseSegments(formParameter?.name ?? '');
</script>

<div class="form-parameter-name st-typography-body">
  <div
    class="name"
    class:error={formParameter.errors !== null}
    use:tooltip={{ content: tooltipContent, placement: 'top' }}
  >
    {#each segments as segment, i}{segment}{#if i < segments.length - 1}<wbr />{/if}{/each}
    {#if formParameter.required}
      <span class="required">*</span>
    {/if}
  </div>
</div>

<style>
  .form-parameter-name {
    display: flex;
    min-width: 0;
  }

  /* Names wrap (camelCase boundaries first) instead of truncating: values stay inline in their own column. */
  .name {
    color: hsl(var(--muted-foreground));
    cursor: default;
    font-style: normal;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .name.error {
    color: var(--st-red);
  }

  .required {
    color: var(--st-red);
  }
</style>
