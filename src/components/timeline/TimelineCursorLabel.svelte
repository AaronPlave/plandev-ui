<script lang="ts">
  import { afterUpdate } from 'svelte';

  export let label = '';
  export let maxWidth = 0;
  export let flippable = false;
  export let maxWidthFlipped = 0;

  let flipped = false;
  let labelElement: HTMLDivElement;

  $: labelMaxWidth = flipped ? maxWidthFlipped : maxWidth;

  afterUpdate(() => {
    if (!flippable || !labelElement) {
      if (flipped) {
        flipped = false;
      }
      return;
    }

    // `scrollWidth` reports the label's natural (unclipped) content width even when it is
    // ellipsized via `max-width` + `overflow: hidden`, so it is independent of the current
    // flip state and the comparison below is stable.
    const overflowsRight = labelElement.scrollWidth > maxWidth;
    const nextFlipped = overflowsRight && maxWidthFlipped > maxWidth;
    if (nextFlipped !== flipped) {
      flipped = nextFlipped;
    }
  });
</script>

<div class="timeline-cursor-label" class:flipped style="max-width: {labelMaxWidth}px;" bind:this={labelElement}>
  {label}
</div>

<style>
  .timeline-cursor-label {
    background-color: var(--st-gray-15);
    border-radius: 16px;
    box-shadow: 0 0.5px 1px rgba(0, 0, 0, 0.25);
    font-size: 12px;
    font-variant: tabular-nums;
    left: 10px;
    line-height: 16px;
    overflow: hidden;
    padding: 0 5px;
    pointer-events: all;
    position: absolute;
    text-overflow: ellipsis;
    top: -11px;
    white-space: nowrap;
    z-index: 0;
  }

  .timeline-cursor-label.flipped {
    left: auto;
    right: 10px;
    text-align: right;
  }
</style>
