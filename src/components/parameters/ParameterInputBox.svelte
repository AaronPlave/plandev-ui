<svelte:options immutable={true} />

<script lang="ts">
  import ParameterUnits from './ParameterUnits.svelte';

  /** Wraps an editor so the unit (and optional trailing control) sits inside the input's right edge. */
  export let unit: string | undefined = undefined;
  export let trailing: boolean = false;

  $: unitWidth = unit ? `${Math.min(unit.length, 6) + 1}ch` : '0px';
</script>

<div class="input-box" style="--unit-width: {unitWidth}" class:has-unit={!!unit} class:has-trailing={trailing}>
  <slot />
  {#if unit}
    <div class="unit"><ParameterUnits {unit} /></div>
  {/if}
  {#if trailing}
    <div class="trailing"><slot name="trailing" /></div>
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

  .input-box.has-trailing :global(.st-input) {
    padding-right: 28px;
  }

  .input-box.has-unit.has-trailing :global(.st-input) {
    padding-right: calc(var(--unit-width) + 32px);
  }

  .unit {
    position: absolute;
    right: 8px;
  }

  .has-trailing .unit {
    right: 28px;
  }

  .trailing {
    align-items: center;
    display: flex;
    position: absolute;
    right: 4px;
  }
</style>
