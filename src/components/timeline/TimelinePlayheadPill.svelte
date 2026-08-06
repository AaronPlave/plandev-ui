<svelte:options immutable={true} />

<script lang="ts">
  import { tooltip } from '../../utilities/tooltip';

  /** 'A' | 'B' | '' — omitted when there is only one cursor, since there is nothing to distinguish. */
  export let badge: string = '';
  export let dragging: boolean = false;
  export let filled: boolean = false;
  export let label: string = '';
  /** Secondary text shown after the time, e.g. the signed offset from cursor A. */
  export let secondary: string = '';
  export let title: string = '';
  export let ariaLabel: string;
  export let ariaValueMax: number;
  export let ariaValueMin: number;
  export let ariaValueNow: number;
  export let ariaValueText: string;
  export let testId: string = '';
</script>

<!--
  A pill rather than a bare triangle: it carries its own readout, gives the drag a target big enough
  to grab without hunting, and — because it is clamped to stay fully on screen by its parent — never
  needs a separate off-screen affordance.
-->
<div
  aria-label={ariaLabel}
  aria-orientation="horizontal"
  aria-valuemax={ariaValueMax}
  aria-valuemin={ariaValueMin}
  aria-valuenow={ariaValueNow}
  aria-valuetext={ariaValueText}
  class="playhead-pill"
  class:dragging
  class:filled
  data-testid={testId}
  role="slider"
  tabindex="0"
  use:tooltip={{ content: title, placement: 'top' }}
  on:contextmenu
  on:dblclick
  on:keydown
  on:mousedown
>
  <svg class="playhead-grip" width="7" height="13" viewBox="0 0 7 13" aria-hidden="true">
    {#each [0, 4, 8] as y}
      <circle cx="2" cy={y + 2} r="1" />
      <circle cx="5" cy={y + 2} r="1" />
    {/each}
  </svg>
  {#if badge}
    <span class="playhead-badge">{badge}</span>
  {/if}
  <span class="playhead-time">{label}</span>
  {#if secondary}
    <span class="playhead-secondary">{secondary}</span>
  {/if}
</div>

<style>
  .playhead-pill {
    align-items: center;
    background: #ffffff;
    border: 1.5px solid #2563eb;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
    color: #2563eb;
    cursor: grab;
    display: flex;
    gap: 5px;
    height: 22px;
    padding: 0 8px 0 6px;
    pointer-events: all;
    white-space: nowrap;
  }

  .playhead-pill.filled {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
  }

  .playhead-pill.dragging {
    box-shadow: 0 2px 9px rgb(37 99 235 / 45%);
    cursor: grabbing;
  }

  .playhead-pill:focus-visible {
    outline: 2px solid #2563eb;
    outline-offset: 2px;
  }

  .playhead-grip {
    fill: currentColor;
    flex-shrink: 0;
    opacity: 0.75;
  }

  .playhead-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    opacity: 0.85;
  }

  .playhead-time {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .playhead-secondary {
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    opacity: 0.7;
  }
</style>
