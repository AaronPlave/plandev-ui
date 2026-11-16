<svelte:options immutable={true} />

<!--
  One source of the analysis in the Sources tree. Click its name to inspect it, double-click (or the caret) to open it;
  open, it lists what can be added to the timeline. An authored sequence lists the sequence itself first, one click
  from its inspector. A plan lists its directives and a Simulations group: its simulations in the analysis, each a
  source of its own nested here for navigation, and the others to browse and add. Uncommon actions are in its menu.
-->
<script lang="ts" context="module">
  import type { SourceBrowserNode } from '../../types/timelineSource';

  export type SourceStatus = { text: string; tone: 'error' | 'muted' | 'warning' };

  /** What the tree knows about each source, by binding id. */
  export type SourceEntry = {
    /** A file in a SeqDev workspace, to open there. */
    file?: { href: string };
    label: string;
    /** The source's own page in PlanDev (its plan, or the plan of its simulation). */
    openHref?: string;
    openLabel?: string;
    /** The sequence the source holds, one click from its inspector. */
    sequence?: { name: string; steps: number };
    status: SourceStatus | null;
    unavailableReason?: string;
  };

  /** What the tree shows of one source: all it has, or, while searching, the paths to what matched. */
  export type SourceTreeResult = {
    /** While searching: groups opened to reveal matches. */
    groupsOpen: Set<string>;
    labelMatch: boolean;
    nodes: SourceBrowserNode[];
    /** While searching: open because something inside matched. */
    open: boolean;
    sequenceMatch: boolean;
    /** While searching: whether anything of it (or of a simulation under it) matched. */
    visible: boolean;
  };
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
  import type { SourceBrowserAction } from '../../types/timelineSource';
  import SourceBrowserTree from '../sources/SourceBrowserTree.svelte';

  export let binding: AnalysisSourceBinding;
  export let depth: number = 0;
  export let entries: Record<string, SourceEntry> = {};
  export let expanded: Record<string, boolean> = {};
  /** What to show of each source, by binding id. */
  export let results: Record<string, SourceTreeResult> = {};
  export let searching: boolean = false;
  /** A plan's simulations: each with the binding that reads it, when the analysis has one. */
  export let simulations: { binding?: AnalysisSourceBinding; dataset: AnalysisPlanSimulationDataset }[] = [];
  /** Shown under a plan: the plan is said by where it is. */
  export let nested: boolean = false;
  export let readOnly: boolean = false;
  export let rows: Row[] = [];

  const dispatch = createEventDispatcher<{
    add: { action: SourceBrowserAction; layer?: Layer; row?: Row };
    addSimulation: number;
    browseSimulations: void;
    dragstart: { action: SourceBrowserAction; event: DragEvent };
    remove: string;
    toggle: { id: string; open: boolean };
  }>();

  /** Unattached simulations listed when browsing; the Add Source dialog lists them all. */
  const BROWSE_LIMIT = 8;

  $: entry = entries[binding.id];
  $: label =
    nested && binding.kind === 'simulation'
      ? `Simulation ${binding.simulationDatasetId}`
      : (entry?.label ?? binding.id);
  $: result = results[binding.id];
  $: attached = simulations.filter(s => s.binding);
  $: unattached = simulations.filter(s => !s.binding);
  $: attachedShown = searching ? attached.filter(s => s.binding && results[s.binding.id]?.visible) : attached;
  $: key = searching ? `search:${binding.id}` : binding.id;
  $: open = expanded[key] ?? (searching ? !!result?.open : false);
  $: simulationsKey = `${searching ? 'search:' : ''}${binding.id}/simulations`;
  $: simulationsOpen = expanded[simulationsKey] ?? (searching ? attachedShown.length > 0 : true);
  $: browseOpen = !searching && !!expanded[`${binding.id}/browse`];
  $: selected = $analysisInspector.kind === 'source' && $analysisInspector.sourceId === binding.id;
  $: sequenceSelected = $analysisInspector.kind === 'sequence' && $analysisInspector.sourceId === binding.id;
  $: icon = binding.kind === 'plan' ? CalendarRange : binding.kind === 'simulation' ? Play : Database;
  $: showSequence = entry?.sequence && (!searching || result?.labelMatch || result?.sequenceMatch);

  function toggle(id: string, isOpen: boolean) {
    dispatch('toggle', { id, open: isOpen });
  }
</script>

{#if !searching || result?.visible}
  <div
    class="tree-row source"
    class:selected
    style:--depth={depth}
    role="treeitem"
    aria-selected={selected}
    aria-expanded={open}
  >
    <button
      class="caret-slot"
      tabindex={-1}
      aria-label="{open ? 'Close' : 'Open'} {label}"
      on:click={() => toggle(key, open)}
    >
      {#if open}<CaretDownIcon />{:else}<CaretRightIcon />{/if}
    </button>
    <svelte:component this={icon} size={13} class="icon" />
    <button
      class="name"
      data-tree-focus
      aria-expanded={open}
      title="{label}{entry?.unavailableReason ? ` · ${entry.unavailableReason}` : ''}"
      on:click={() => inspect({ kind: 'source', sourceId: binding.id })}
      on:dblclick={() => toggle(key, open)}
      on:keydown={event => {
        if ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open)) {
          event.preventDefault();
          toggle(key, open);
        }
      }}>{label}</button
    >
    {#if entry?.status}
      <span class="status" data-tone={entry.status.tone} title={entry.status.text}>{entry.status.text}</span>
    {/if}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild let:builder>
        <Button builders={[builder]} variant="ghost" size="icon-sm" class="menu" aria-label="Actions for {label}">
          <Ellipsis size={13} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="text-xs">
        {#if entry?.openHref}
          <DropdownMenu.Item class="text-xs" href={entry.openHref}>{entry.openLabel ?? 'Open'}</DropdownMenu.Item>
        {/if}
        {#if entry?.file}
          <DropdownMenu.Item class="text-xs" href={entry.file.href}>Open in SeqDev</DropdownMenu.Item>
        {/if}
        {#if !readOnly}
          <DropdownMenu.Item class="text-xs" on:click={() => inspect({ kind: 'source', sourceId: binding.id })}
            >Rename in this analysis…</DropdownMenu.Item
          >
          <DropdownMenu.Separator />
          <DropdownMenu.Item class="text-xs text-red-700" on:click={() => dispatch('remove', binding.id)}
            >Remove from analysis…</DropdownMenu.Item
          >
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>

  {#if open}
    {#if showSequence && entry?.sequence}
      <button
        class="tree-row sequence"
        class:selected={sequenceSelected}
        style:--depth={depth + 1}
        data-tree-focus
        title="Inspect the sequence: its steps in order, their timing and arguments"
        on:click={() => inspect({ kind: 'sequence', sourceId: binding.id })}
      >
        <span class="caret-slot" />
        <ListOrdered size={13} class="icon" />
        <span class="label">{entry.sequence.name}</span>
        <span class="badge">{entry.sequence.steps} step{entry.sequence.steps === 1 ? '' : 's'}</span>
      </button>
    {/if}
    <SourceBrowserTree
      depth={depth + 1}
      {expanded}
      nodes={result?.nodes ?? []}
      openDepth={0}
      {readOnly}
      {rows}
      searchOpen={searching ? (result?.groupsOpen ?? null) : null}
      on:add
      on:dragstart
      on:toggle
    />
    {#if !result?.nodes.length && !showSequence && entry?.unavailableReason}
      <div class="tree-row empty" style:--depth={depth + 1}><span class="caret-slot" />{entry.unavailableReason}</div>
    {/if}
    {#if binding.kind === 'plan' && (attachedShown.length || (!searching && simulations.length))}
      <div class="tree-row group" style:--depth={depth + 1}>
        <button
          class="toggle"
          data-tree-focus
          aria-expanded={simulationsOpen}
          on:click={() => toggle(simulationsKey, simulationsOpen)}
        >
          <span class="caret-slot"
            >{#if simulationsOpen}<CaretDownIcon />{:else}<CaretRightIcon />{/if}</span
          >
          <Play size={13} class="icon" />
          <span class="label">Simulations</span>
          <span class="badge" title="{attached.length} in this analysis of {simulations.length}"
            >{attached.length}/{simulations.length}</span
          >
        </button>
      </div>
      {#if simulationsOpen}
        {#each attachedShown as simulation (simulation.dataset.id)}
          {#if simulation.binding}
            <svelte:self
              binding={simulation.binding}
              depth={depth + 2}
              {entries}
              {expanded}
              nested
              {readOnly}
              {rows}
              {results}
              {searching}
              on:add
              on:addSimulation
              on:browseSimulations
              on:dragstart
              on:remove
              on:toggle
            />
          {/if}
        {/each}
        {#if !searching && unattached.length}
          <button
            class="tree-row more"
            style:--depth={depth + 2}
            data-tree-focus
            aria-expanded={browseOpen}
            on:click={() => toggle(`${binding.id}/browse`, browseOpen)}
          >
            <span class="caret-slot"
              >{#if browseOpen}<CaretDownIcon />{:else}<CaretRightIcon />{/if}</span
            >
            <span class="label">Browse other simulations ({unattached.length})</span>
          </button>
          {#if browseOpen}
            {#each unattached.slice(0, BROWSE_LIMIT) as { dataset } (dataset.id)}
              <div class="tree-row" style:--depth={depth + 3}>
                <span class="caret-slot" />
                <Play size={13} class="icon" />
                <span class="label text-muted-foreground">Simulation {dataset.id}</span>
                {#if dataset.status !== 'success'}
                  <span class="status" data-tone={dataset.status === 'failed' ? 'error' : 'muted'}
                    >{dataset.status}</span
                  >
                {:else if !readOnly}
                  <Button
                    size="xs"
                    variant="outline"
                    class="h-5 px-2"
                    on:click={() => dispatch('addSimulation', dataset.id)}>Add</Button
                  >
                {/if}
              </div>
            {/each}
            {#if unattached.length > BROWSE_LIMIT}
              <button class="tree-row more" style:--depth={depth + 3} on:click={() => dispatch('browseSimulations')}>
                <span class="caret-slot" />All {unattached.length} simulations…
              </button>
            {/if}
          {/if}
        {/if}
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .tree-row {
    align-items: center;
    display: flex;
    font-size: 12px;
    gap: 4px;
    min-height: 24px;
    padding-left: calc(4px + var(--depth, 0) * 14px);
    padding-right: 4px;
    width: 100%;
  }

  .tree-row:hover {
    background: var(--st-gray-15);
  }

  .tree-row.selected {
    background: var(--st-utility-blue-10, #e0ecfb);
    box-shadow: inset 2px 0 0 var(--st-utility-blue);
  }

  .source {
    min-height: 26px;
  }

  .caret-slot {
    align-items: center;
    background: none;
    border: 0;
    cursor: pointer;
    display: flex;
    flex: none;
    justify-content: center;
    padding: 0;
    width: 14px;
  }

  .tree-row :global(.icon) {
    color: var(--st-gray-60);
    flex: none;
  }

  .name,
  .toggle {
    background: none;
    border: 0;
    color: var(--st-gray-100);
    cursor: pointer;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    font-weight: 500;
  }

  .toggle {
    align-items: center;
    color: var(--st-gray-80);
    display: flex;
    font-weight: 500;
    gap: 4px;
  }

  .sequence,
  .more {
    background: none;
    border: 0;
    cursor: pointer;
    text-align: left;
  }

  .sequence .label {
    font-weight: 500;
  }

  .more {
    color: var(--st-utility-blue);
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    flex: none;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--st-gray-60);
    font-style: italic;
  }

  .source :global(.menu) {
    height: 20px;
    opacity: 0;
    width: 20px;
  }

  .source:hover :global(.menu),
  .source:focus-within :global(.menu),
  .source :global(.menu[data-state='open']) {
    opacity: 1;
  }
</style>
