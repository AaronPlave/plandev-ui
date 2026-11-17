<svelte:options immutable={true} />

<script lang="ts">
  import { browser } from '$app/environment';
  import { createEventDispatcher } from 'svelte';
  import type { ParameterType, ValueSource } from '../../types/parameter';
  import { isMacOs } from '../../utilities/browser';
  import { isMetaOrCtrlPressed } from '../../utilities/keyboardEvents';
  import { tooltip } from '../../utilities/tooltip';

  /**
   * Provenance *indicator* (not a button): none = model default, ◆ = preset, ● = override.
   * ⌘/Ctrl-click on an override resets it (kept for compatibility); the discoverable reset is in the details view.
   */
  export let canReset: boolean = false;
  export let source: ValueSource;
  export let parameterType: ParameterType = 'activity';

  const dispatch = createEventDispatcher<{
    reset: void;
  }>();

  $: presetText = parameterType === 'activity' ? 'Activity Preset' : 'Simulation Template';
  $: isOverride = source === 'user on model' || source === 'user on preset';
  $: label = isOverride ? 'Override' : source === 'preset' ? `${presetText} value` : '';
  $: shortcut = browser && isOverride && canReset ? `${isMacOs() ? '⌘' : 'Ctrl'}-click to reset` : '';

  function onClick(event: MouseEvent) {
    if (isOverride && canReset && isMetaOrCtrlPressed(event)) {
      dispatch('reset');
    }
  }
</script>

<!-- Rows at the model default show nothing: provenance is only called out when it differs. -->
{#if label}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <span
    class="provenance"
    class:override={isOverride}
    class:preset={source === 'preset'}
    data-source={isOverride ? 'override' : 'preset'}
    role="img"
    aria-label={label}
    use:tooltip={{ content: shortcut ? `${label} · ${shortcut}` : label, placement: 'top' }}
    on:click={onClick}
  >
    {isOverride ? '●' : '◆'}
  </span>
{/if}

<style>
  .provenance {
    cursor: default;
    font-size: 10px;
    line-height: 12px;
    text-align: center;
    width: 12px;
  }

  .override {
    color: #e0701a;
  }

  .preset {
    color: var(--st-primary-60);
  }
</style>
