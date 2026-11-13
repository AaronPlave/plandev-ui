<svelte:options immutable={true} />

<!--
  The inspection cursor: one pinned instant, drawn as a line through every row with a draggable time chip at the top.
  It is not the hover cursor (which follows the mouse) and not a vertical guide (which is saved with the timeline).
  Only the chip takes the pointer, so the line never gets in the way of selecting what lies under it.
-->
<script lang="ts">
  import type { ScaleTime } from 'd3-scale';
  import { X } from 'lucide-svelte';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { plugins } from '../../stores/plugins';
  import type { TimeRange } from '../../types/timeline';
  import { formatDate } from '../../utilities/time';

  export let cursorHeaderHeight: number = 0;
  export let drawWidth: number = 0;
  export let marginLeft: number = 50;
  export let maxTimeRange: TimeRange = { end: 0, start: 0 };
  export let timeMs: number | null = null;
  export let xScaleView: ScaleTime<number, number> | null = null;

  const dispatch = createEventDispatcher<{ change: number; clear: void }>();
  /** The chip is about this wide: past this far from the right edge it sits to the left of the line instead. */
  const CHIP_ROOM_PX = 230;

  let container: HTMLDivElement;
  let dragging: boolean = false;

  $: x = timeMs !== null && xScaleView ? xScaleView(timeMs) : null;
  $: visible = x !== null && x >= 0 && x <= drawWidth;
  $: flipped = x !== null && drawWidth - x < CHIP_ROOM_PX;
  $: label =
    timeMs === null
      ? ''
      : `${formatDate(new Date(timeMs), $plugins.time.primary.format)} ${$plugins.time.primary.label}`;

  function clampTime(ms: number): number {
    return maxTimeRange.end > maxTimeRange.start ? Math.min(Math.max(ms, maxTimeRange.start), maxTimeRange.end) : ms;
  }

  function timeAt(clientX: number): number | null {
    if (!xScaleView || !container) {
      return null;
    }
    return clampTime(xScaleView.invert(clientX - container.getBoundingClientRect().left - marginLeft).getTime());
  }

  function onMove(event: MouseEvent) {
    const next = timeAt(event.clientX);
    if (next !== null) {
      dispatch('change', next);
    }
  }

  function stopDrag() {
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopDrag);
  }

  function startDrag(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
  }

  /** Arrow keys move it by a pixel of the visible window (ten with Shift). */
  function onKeyDown(event: KeyboardEvent) {
    if (timeMs === null || !xScaleView || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
      return;
    }
    event.preventDefault();
    const [start, end] = xScaleView.domain();
    const perPixel = (end.getTime() - start.getTime()) / Math.max(1, drawWidth);
    dispatch(
      'change',
      clampTime(timeMs + (event.key === 'ArrowRight' ? 1 : -1) * perPixel * (event.shiftKey ? 10 : 1)),
    );
  }

  onDestroy(stopDrag);
</script>

<div class="inspect-margin" style="height: {cursorHeaderHeight}px" />
<div bind:this={container} class="inspect-container">
  {#if visible && x !== null}
    <div class="inspect-cursor" style="transform: translateX({x + marginLeft}px)">
      <div class="inspect-line" />
      <div class="inspect-chip" class:dragging class:flipped>
        <button
          class="inspect-grip"
          aria-label="Inspection time cursor: drag, or use the arrow keys, to move it"
          title="Drag to move the inspection time"
          on:mousedown={startDrag}
          on:keydown={onKeyDown}
        >
          {label}
        </button>
        <button
          class="inspect-clear"
          aria-label="Clear the inspection time"
          title="Clear"
          on:click={() => dispatch('clear')}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .inspect-margin {
    position: relative;
  }

  .inspect-container {
    height: 100%;
    pointer-events: none;
    position: absolute;
    width: 100%;
    /* Above guides (6) and the hover cursor (7): it is the one the user is working with. */
    z-index: 8;
  }

  .inspect-cursor {
    height: 100%;
    left: 0;
    position: absolute;
    top: -10px;
  }

  .inspect-line {
    background-color: var(--inspect-color, #d9480f);
    height: 100%;
    left: -1px;
    position: absolute;
    top: 0;
    width: 2px;
  }

  .inspect-chip {
    align-items: center;
    background-color: var(--inspect-color, #d9480f);
    border-radius: 3px;
    box-shadow: 0 0.5px 2px rgba(0, 0, 0, 0.35);
    color: white;
    display: flex;
    font-size: 12px;
    font-variant: tabular-nums;
    left: -1px;
    line-height: 16px;
    pointer-events: all;
    position: absolute;
    top: -11px;
    white-space: nowrap;
  }

  .inspect-chip.flipped {
    flex-direction: row-reverse;
    left: auto;
    right: -1px;
  }

  .inspect-grip,
  .inspect-clear {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: ew-resize;
    padding: 0 5px;
  }

  .inspect-clear {
    align-items: center;
    cursor: pointer;
    display: flex;
    padding: 0 3px;
  }

  .inspect-clear:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .inspect-chip.dragging .inspect-grip {
    cursor: grabbing;
  }
</style>
