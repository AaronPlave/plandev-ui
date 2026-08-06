<script lang="ts">
  import MarkerIcon from '@nasa-jpl/stellar/icons/marker.svg?component';
  import AddMarkerIcon from '@nasa-jpl/stellar/icons/marker_add.svg?component';
  import RemoveMarkerIcon from '@nasa-jpl/stellar/icons/marker_remove.svg?component';
  import TimelineCursorLabel from './TimelineCursorLabel.svelte';

  export let x = 0;
  export let maxWidth = 0;
  export let label = '';
  export let activeCursor = false;
  export let color = '';
  export let flippable = false;
  export let maxWidthFlipped = 0;

  let hovered = false;
</script>

<div class="timeline-cursor" style="transform: translateX({x}px)">
  <div class="timeline-cursor-line" style="background: {color}" />
  <button
    class="timeline-cursor-icon"
    aria-label="Timeline Cursor"
    style="color: {color}"
    on:click
    on:mouseenter={() => (hovered = true)}
    on:mouseleave={() => (hovered = false)}
  >
    {#if activeCursor}
      <AddMarkerIcon />
    {:else if hovered}
      <RemoveMarkerIcon />
    {:else}
      <MarkerIcon />
    {/if}
  </button>
  <TimelineCursorLabel {label} {maxWidth} {flippable} {maxWidthFlipped} />
</div>

<style>
  .timeline-cursor {
    height: 100%;
    left: 0;
    opacity: 1;
    position: absolute;
    top: -10px;
    transform: translateX(0);
  }

  .timeline-cursor-icon {
    background-color: transparent;
    border: none;
    color: var(--st-gray-60);
    cursor: pointer;
    display: block;
    height: 16px;
    left: 0;
    left: -7.5px;
    margin: 0;
    padding: 0;
    pointer-events: all;
    position: absolute;
    top: -9px;
    width: 15px;
  }

  .timeline-cursor-line {
    background-color: var(--st-gray-50);
    display: block;
    height: 100%;
    left: -0.5px;
    position: absolute;
    top: 0;
    width: 1px;
  }

  /* The label now lives in TimelineCursorLabel, so reaching it from this ancestor needs :global. */
  .timeline-cursor:hover :global(.timeline-cursor-label) {
    max-width: 100vw !important;
    z-index: 4;
  }
</style>
