<svelte:options immutable={true} />

<!--
  Notes on the timeline: a lane of flags under the time axis, each at its note's time (a bar across an interval), with
  a line, or a shaded interval, down through the rows. Only a flag takes the pointer; the rows stay clickable under the
  marks. The flag shows the start of the note's text, the whole text on hover, and opens the note on click.
-->
<script lang="ts" context="module">
  export type TimelineNote = { color: string; endMs?: number; id: number; startMs: number; text: string };
  export const NOTES_LANE_HEIGHT = 18;
</script>

<script lang="ts">
  import type { ScaleTime } from 'd3-scale';
  import { createEventDispatcher } from 'svelte';
  import { hexToRgba } from '../../utilities/color';

  export let drawWidth: number = 0;
  /** How far down through the rows the marks reach. */
  export let height: number = 0;
  export let marginLeft: number = 0;
  export let notes: TimelineNote[] = [];
  export let selectedId: number | null = null;
  export let xScaleView: ScaleTime<number, number> | null = null;

  const dispatch = createEventDispatcher<{ selectNote: number }>();

  $: placed = xScaleView ? place(notes, xScaleView, drawWidth) : [];

  function place(notes: TimelineNote[], x: ScaleTime<number, number>, width: number) {
    return notes
      .map(note => {
        const start = x(note.startMs);
        const end = note.endMs === undefined ? start : x(note.endMs);
        return { end, note, start };
      })
      .filter(({ end, start }) => end >= 0 && start <= width)
      .map(({ end, note, start }) => {
        const left = Math.max(0, start);
        return { band: end > start, left, note, offscreenStart: start < 0, width: Math.min(width, end) - left };
      });
  }

  function summary(text: string): string {
    return text.split('\n')[0] || 'Untitled note';
  }
</script>

<div class="notes-lane" style:height="{NOTES_LANE_HEIGHT}px" aria-label="Notes">
  {#each placed as { band, left, note, offscreenStart, width } (note.id)}
    {#if band}
      <div
        class="mark band"
        style:left="{marginLeft + left}px"
        style:width="{width}px"
        style:height="{height}px"
        style:background-color={hexToRgba(note.color, 0.08)}
        style:border-color={note.color}
        class:open-start={offscreenStart}
      />
    {:else}
      <div class="mark line" style:left="{marginLeft + left}px" style:height="{height}px" style:background={note.color} />
    {/if}
    <button
      class="flag"
      class:selected={selectedId === note.id}
      style:left="{marginLeft + left}px"
      style:max-width="{Math.max(band ? width : 0, 160)}px"
      style:border-color={note.color}
      style:--note-color={note.color}
      title={note.text || 'Untitled note'}
      on:click={() => dispatch('selectNote', note.id)}
    >
      {summary(note.text)}
    </button>
  {/each}
</div>

<style>
  .notes-lane {
    border-bottom: 1px solid var(--st-gray-20, #ebecf0);
    overflow: visible;
    position: relative;
    width: 100%;
  }

  .mark {
    pointer-events: none;
    position: absolute;
    top: 0;
    z-index: 6;
  }

  .line {
    opacity: 0.8;
    width: 1px;
  }

  .band {
    border-left: 1px solid;
    border-right: 1px solid;
  }

  .band.open-start {
    border-left-style: dashed;
  }

  .flag {
    background: white;
    border: 1px solid;
    border-left: 3px solid var(--note-color);
    border-radius: 0 3px 3px 0;
    cursor: pointer;
    font-size: 10px;
    height: 15px;
    line-height: 13px;
    overflow: hidden;
    padding: 0 4px;
    position: absolute;
    text-overflow: ellipsis;
    top: 1px;
    white-space: nowrap;
    z-index: 7;
  }

  .flag:hover,
  .flag.selected {
    max-width: 400px !important;
    z-index: 8;
  }

  .flag.selected {
    box-shadow: 0 0 0 1px var(--note-color);
  }
</style>
