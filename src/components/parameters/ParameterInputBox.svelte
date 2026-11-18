<svelte:options immutable={true} />

<script lang="ts">
  import ParameterUnits from './ParameterUnits.svelte';

  /** Wraps an editor so the unit sits inside the input's right edge. */
  export let unit: string | undefined = undefined;

  $: unitWidth = unit ? `${Math.min(unit.length, 6) + 1}ch` : '0px';
</script>

<div class="input-box" style="--unit-width: {unitWidth}" class:has-unit={!!unit}>
  <slot />
  {#if unit}
    <div class="unit"><ParameterUnits {unit} /></div>
  {/if}
</div>

<style>
  .input-box {
    align-items: center;
    display: flex;
    position: relative;
    width: 100%;
  }

  .input-box.has-unit :global(.st-input) {
    padding-right: calc(var(--unit-width) + 12px);
  }

  .unit {
    position: absolute;
    right: 8px;
  }
</style>
