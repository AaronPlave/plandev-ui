<svelte:options immutable={true} />

<!--
  One source of the analysis in the Sources tree: its name (click to inspect it), what needs saying about it (live,
  a newer revision, a failed import, a deleted revision), the uncommon actions in a menu, and, open, its contents to
  add to the timeline. A plan also lists its simulations: those in the analysis open like any source, the others can
  be added from here.
-->
<script lang="ts" context="module">
  export type SourceStatus = { text: string; tone: 'error' | 'muted' | 'warning' };
</script>

<script lang="ts">
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import CaretDownIcon from '@nasa-jpl/stellar/icons/caret_down.svg?component';
  import CaretRightIcon from '@nasa-jpl/stellar/icons/caret_right.svg?component';
  import { CalendarRange, Database, Ellipsis, ListOrdered, Play } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import { analysisInspector, inspect } from '../../stores/analysis';
  import type { AnalysisPlanSimulationDataset, AnalysisSourceBinding } from '../../types/analysis';
  import type { Layer, Row } from '../../types/timeline';
  import type { SourceBrowserAction, TimelineSource } from '../../types/timelineSource';
  import { filterSourceBrowserNodes } from '../../utilities/timelineSources';
  import SourceBrowserTree from '../sources/SourceBrowserTree.svelte';

  export let binding: AnalysisSourceBinding;
  export let depth: number = 0;
  export let expanded: Record<string, boolean> = {};
  export let filterText: string = '';
  /** A plan's simulations: each with the binding that reads it, when the analysis has one. */
  export let simulations: { binding?: AnalysisSourceBinding; dataset: AnalysisPlanSimulationDataset }[] = [];
  /** Sources by binding id, for nested simulations. */
  export let sources: Record<string, TimelineSource | undefined> = {};
  export let statuses: Record<string, SourceStatus | null> = {};
  export let labels: Record<string, string> = {};
  /** Steps of each authored sequence, by binding id. */
  export let sequenceSteps: Record<string, number> = {};
  export let readOnly: boolean = false;
  export let rows: Row[] = [];

  const dispatch = createEventDispatcher<{
    add: { action: SourceBrowserAction; layer?: Layer; row?: Row };
    addSimulation: number;
    dragstart: { action: SourceBrowserAction; event: DragEvent };
    remove: string;
    rename: string;
    toggle: { id: string; open: boolean };
  }>();

  /** Unattached simulations shown at once; the Add Source dialog lists them all. */
  const SIMULATION_LIMIT = 3;

  $: source = sources[binding.id];
  $: label = labels[binding.id] ?? binding.id;
  $: status = statuses[binding.id];
  $: filtering = !!filterText.trim();
  $: nodes = filterSourceBrowserNodes(source?.browserNodes ?? [], filterText);
  $: steps = sequenceSteps[binding.id];
  $: attached = simulations.filter(s => s.binding);
  $: unattached = simulations.filter(s => !s.binding);
  $: matches = !filtering || label.toLowerCase().includes(filterText.trim().toLowerCase());
  $: open = filtering ? nodes.length > 0 || attached.length > 0 : (expanded[binding.id] ?? depth === 0);
  $: selected =
    ($analysisInspector.kind === 'source' || $analysisInspector.kind === 'sequence') &&
    $analysisInspector.sourceId === binding.id;
  $: icon = binding.kind === 'plan' ? CalendarRange : binding.kind === 'simulation' ? Play : Database;
  $: indent = 4 + depth * 12;
</script>

{#if matches || nodes.length || attached.length}
  <div class="source-row" class:selected style:padding-left="{indent}px" role="treeitem" aria-selected={selected}>
    <button
      class="caret"
      aria-label="{open ? 'Close' : 'Open'} {label}"
      aria-expanded={open}
      on:click={() => dispatch('toggle', { id: binding.id, open })}
    >
      {#if open}<CaretDownIcon />{:else}<CaretRightIcon />{/if}
    </button>
    <svelte:component this={icon} size={13} class="shrink-0 text-muted-foreground" />
    <button
      class="name"
      title="{label} · show its details"
      on:click={() => inspect({ kind: 'source', sourceId: binding.id })}>{label}</button
    >
    {#if status}
      <span class="status" data-tone={status.tone} title={status.text}>{status.text}</span>
    {/if}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild let:builder>
        <Button builders={[builder]} variant="ghost" size="icon-sm" class="menu" aria-label="Actions for {label}">
          <Ellipsis size={13} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="text-xs">
        <DropdownMenu.Item class="text-xs" on:click={() => inspect({ kind: 'source', sourceId: binding.id })}
          >Details</DropdownMenu.Item
        >
        {#if !readOnly}
          <DropdownMenu.Item class="text-xs" on:click={() => dispatch('rename', binding.id)}
            >Rename in this analysis…</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item class="text-xs text-red-700" on:click={() => dispatch('remove', binding.id)}
            >Remove from analysis</DropdownMenu.Item
          >
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
  {#if source?.resources?.unavailableReason && !status}
    <div class="problem" style:padding-left="{indent + 30}px">{source.resources.unavailableReason}</div>
  {/if}

  {#if open}
    {#if steps !== undefined && matches}
      <button
        class="sequence"
        style:padding-left="{indent + 26}px"
        on:click={() => inspect({ kind: 'sequence', sourceId: binding.id })}
      >
        <ListOrdered size={13} class="shrink-0 text-muted-foreground" />
        <span class="flex-1 truncate">Sequence</span>
        <span class="badge">{steps} step{steps === 1 ? '' : 's'}</span>
      </button>
    {/if}
    <SourceBrowserTree
      depth={depth + 2}
      {expanded}
      forceExpanded={filtering}
      {nodes}
      {readOnly}
      {rows}
      on:add
      on:dragstart
      on:toggle
    />
    {#each attached as simulation (simulation.dataset.id)}
      {#if simulation.binding}
        <svelte:self
          binding={simulation.binding}
          depth={depth + 1}
          {expanded}
          {filterText}
          {labels}
          {readOnly}
          {rows}
          {sequenceSteps}
          {sources}
          {statuses}
          on:add
          on:addSimulation
          on:dragstart
          on:remove
          on:rename
          on:toggle
        />
      {/if}
    {/each}
    {#if !filtering && unattached.length}
      {@const shown = expanded[`${binding.id}/more-simulations`] ? unattached : unattached.slice(0, SIMULATION_LIMIT)}
      {#each shown as { dataset } (dataset.id)}
        <div class="simulation" style:padding-left="{indent + 26}px">
          <Play size={13} class="shrink-0 text-muted-foreground" />
          <span class="flex-1 truncate text-muted-foreground" title="Not in this analysis">Simulation {dataset.id}</span
          >
          {#if dataset.status !== 'success'}
            <span class="status" data-tone={dataset.status === 'failed' ? 'error' : 'muted'}>{dataset.status}</span>
          {:else if !readOnly}
            <Button size="xs" variant="ghost" class="h-5 px-1.5" on:click={() => dispatch('addSimulation', dataset.id)}
              >Add</Button
            >
          {/if}
        </div>
      {/each}
      {#if unattached.length > shown.length}
        <button
          class="more"
          style:padding-left="{indent + 45}px"
          on:click={() => dispatch('toggle', { id: `${binding.id}/more-simulations`, open: false })}
          >{unattached.length - shown.length} older simulation{unattached.length - shown.length === 1
            ? ''
            : 's'}…</button
        >
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .source-row,
  .sequence,
  .simulation {
    align-items: center;
    display: flex;
    gap: 4px;
    min-height: 26px;
    padding-right: 4px;
  }

  .source-row:hover,
  .sequence:hover {
    background: var(--st-gray-15);
  }

  .source-row.selected {
    background: var(--st-gray-15);
  }

  .caret {
    align-items: center;
    background: none;
    border: 0;
    cursor: pointer;
    display: flex;
    padding: 0;
  }

  .name {
    background: none;
    border: 0;
    color: var(--st-gray-100);
    cursor: pointer;
    flex: 1;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sequence,
  .more {
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
    width: 100%;
  }

  .more {
    color: var(--st-utility-blue);
    min-height: 22px;
  }

  .status {
    border-radius: 3px;
    flex: none;
    font-size: 10px;
    padding: 0 4px;
  }

  .status[data-tone='muted'] {
    background: var(--st-gray-15);
    color: var(--st-gray-70);
  }

  .status[data-tone='warning'] {
    background: rgba(217, 119, 6, 0.15);
    color: #92400e;
  }

  .status[data-tone='error'] {
    background: rgba(219, 81, 57, 0.15);
    color: #a8321e;
  }

  .badge {
    color: var(--st-gray-60);
  }

  .problem {
    color: #a8321e;
    font-size: 11px;
    padding-bottom: 2px;
  }

  .source-row :global(.menu) {
    height: 20px;
    opacity: 0.4;
    width: 20px;
  }

  .source-row:hover :global(.menu),
  .source-row :global(.menu[data-state='open']) {
    opacity: 1;
  }
</style>
