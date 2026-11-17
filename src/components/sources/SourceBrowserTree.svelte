<svelte:options immutable={true} />

<!--
  Renders SourceBrowserNodes. It knows nothing about the domain objects behind them: adapters in
  utilities/timelineSources.ts decide the structure, and an item's `action` says what adding it does.

  Rendering is bounded: a list shows its first PAGE entries with a "Show more" row, and an item's add-to-row menu is
  only mounted while the pointer or focus is on it, so a catalog of thousands costs a page of plain rows.
-->
<script lang="ts" context="module">
  const PAGE = 100;
</script>

<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import CaretDownIcon from '@nasa-jpl/stellar/icons/caret_down.svg?component';
  import CaretRightIcon from '@nasa-jpl/stellar/icons/caret_right.svg?component';
  import { Plus, Trash2 } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { ChartType, Layer, Row } from '../../types/timeline';
  import type { SourceBrowserAction, SourceBrowserNode } from '../../types/timelineSource';
  import { getSourceNodeIcon } from './sourceBrowserIcons';
  import LayerPicker from '../LayerPicker.svelte';

  export let depth: number = 0;
  export let expanded: Record<string, boolean> = {};
  /** Depth down to which groups start open when the person hasn't opened or closed them. */
  export let openDepth: number = 2;
  /** While searching: the groups opened to reveal matches. Toggles while searching are kept apart (`search:<id>`). */
  export let searchOpen: Set<string> | null = null;
  /** The top-level group these nodes are in (set by the tree itself as it nests). */
  export let group: string = '';
  export let nodes: SourceBrowserNode[] = [];
  /** Items can be browsed but not added to rows. */
  export let readOnly: boolean = false;
  export let rows: Row[] = [];
  /**
   * Rows are selected by a click (to inspect them), opened by their caret (or a double-click), and added by drag or
   * Add. Without it (the Plan page) a group's click opens it.
   */
  export let selectable: boolean = false;
  /** The selected node's id: ids are source-qualified, so the same name in two sources is two nodes. */
  export let selectedId: string | null = null;

  const dispatch = createEventDispatcher<{
    add: { action: SourceBrowserAction; layer?: Layer; row?: Row };
    dragstart: { action: SourceBrowserAction; event: DragEvent };
    remove: { id: string; label: string };
    select: SourceBrowserNode;
    toggle: { id: string; open: boolean };
  }>();

  let shown: number = PAGE;
  /** The item whose add-to-row menu is mounted (hovered, focused, or open). */
  let active: string | null = null;
  let pickerOpen: boolean = false;

  $: visible = nodes.slice(0, shown);

  function toggleKey(id: string): string {
    return searchOpen ? `search:${id}` : id;
  }

  function isExpanded(
    node: SourceBrowserNode,
    expanded: Record<string, boolean>,
    searchOpen: Set<string> | null,
  ): boolean {
    return searchOpen
      ? (expanded[`search:${node.id}`] ?? searchOpen.has(node.id))
      : (expanded[node.id] ?? depth < openDepth);
  }

  function activate(id: string) {
    if (!pickerOpen) {
      active = id;
    }
  }

  function onItemDragStart(action: SourceBrowserAction) {
    return (event: DragEvent) => dispatch('dragstart', { action, event });
  }

  function formatBadge(badge: string): string {
    return /^\d+$/.test(badge) ? Number(badge).toLocaleString() : badge;
  }

  function chartTypeFor(action: SourceBrowserAction): ChartType {
    return action.typeName === 'resource' ? 'line' : action.typeName;
  }
</script>

{#each visible as node (node.id)}
  {@const nodeGroup = depth === 0 ? node.label : group}
  {@const NodeIcon = getSourceNodeIcon(node, nodeGroup, depth)}
  {#if node.kind === 'item' && node.action}
    {@const action = node.action}
    <div
      class="tree-row item"
      class:selectable
      class:selected={selectable && selectedId === node.id}
      style:--depth={depth}
      draggable={!readOnly}
      role="treeitem"
      tabindex="0"
      aria-selected={selectable && selectedId === node.id}
      data-node-id={node.id}
      data-tree-focus
      title={node.tooltip || (readOnly ? undefined : `${node.label}: drag to the timeline, or use Add`)}
      on:click={() => selectable && dispatch('select', node)}
      on:keydown={event => {
        if (selectable && event.key === 'Enter' && event.target === event.currentTarget) {
          dispatch('select', node);
        }
      }}
      on:dragstart={onItemDragStart(action)}
      on:mouseenter={() => activate(node.id)}
      on:focusin={() => activate(node.id)}
    >
      <span class="caret-slot" />
      {#if NodeIcon}<NodeIcon size={13} class="icon" />{/if}
      <span class="label">{node.label}</span>
      {#each node.tags ?? [] as tag}
        <span class="tag">{tag}</span>
      {/each}
      {#if node.badge}
        <span class="badge">{formatBadge(node.badge)}</span>
      {/if}
      {#if !readOnly && active === node.id}
        <!-- Over the row's end on hover or focus, so nothing is reserved beside the badges otherwise. -->
        <span class="actions" role="presentation" on:click|stopPropagation on:keydown|stopPropagation>
          <LayerPicker
            label="Add to timeline"
            layerItem={action.item}
            sourceId={action.sourceId ?? undefined}
            {rows}
            chartType={chartTypeFor(action)}
            on:select={({ detail: { layer, row } }) => dispatch('add', { action, layer, row })}
            on:visibilityChange={({ detail }) => (pickerOpen = detail)}
            let:builders
          >
            <Button
              {builders}
              variant="ghost"
              size="icon-sm"
              class="add"
              title="Add to timeline…"
              aria-label={`Add ${node.label} to timeline`}
            >
              <Plus size={13} />
            </Button>
          </LayerPicker>
        </span>
      {/if}
    </div>
  {:else}
    {@const open = isExpanded(node, expanded, searchOpen)}
    {@const isSelected = selectable && selectedId === node.id}
    <div
      class="tree-row group"
      class:source={node.kind === 'source'}
      class:selected={isSelected}
      style:--depth={depth}
      title={node.tooltip}
      role={selectable ? 'treeitem' : undefined}
      aria-selected={selectable ? isSelected : undefined}
      aria-expanded={selectable ? open : undefined}
    >
      {#if selectable}
        <button
          class="caret-slot caret"
          tabindex={-1}
          aria-label="{open ? 'Close' : 'Open'} {node.label}"
          on:click={() => dispatch('toggle', { id: toggleKey(node.id), open })}
          >{#if open}<CaretDownIcon />{:else}<CaretRightIcon />{/if}</button
        >
      {/if}
      <button
        class="toggle"
        aria-expanded={selectable ? undefined : open}
        data-node-id={node.id}
        data-tree-focus
        on:click={() => (selectable ? dispatch('select', node) : dispatch('toggle', { id: toggleKey(node.id), open }))}
        on:dblclick={() => selectable && dispatch('toggle', { id: toggleKey(node.id), open })}
        on:keydown={event => {
          if (selectable && ((event.key === 'ArrowRight' && !open) || (event.key === 'ArrowLeft' && open))) {
            event.preventDefault();
            dispatch('toggle', { id: toggleKey(node.id), open });
          }
        }}
      >
        {#if !selectable}
          <span class="caret-slot"
            >{#if open}<CaretDownIcon />{:else}<CaretRightIcon />{/if}</span
          >
        {/if}
        {#if NodeIcon}<NodeIcon size={13} class="icon" />{/if}
        <span class="label">{node.label}</span>
        {#each node.tags ?? [] as tag}
          <span class="tag">{tag}</span>
        {/each}
        {#if node.badge}
          <span class="badge">{formatBadge(node.badge)}</span>
        {/if}
      </button>
      {#if node.removable && !readOnly}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${node.label} from plan`}
          on:click={() => dispatch('remove', { id: node.id, label: node.label })}
        >
          <Trash2 size={13} />
        </Button>
      {/if}
    </div>
    {#if open}
      {#if node.children?.length}
        <svelte:self
          depth={depth + 1}
          {expanded}
          group={nodeGroup}
          nodes={node.children}
          {openDepth}
          {readOnly}
          {rows}
          {searchOpen}
          {selectable}
          {selectedId}
          on:add
          on:dragstart
          on:remove
          on:select
          on:toggle
        />
      {:else if node.emptyMessage}
        <div class="tree-row empty" style:--depth={depth + 1}><span class="caret-slot" />{node.emptyMessage}</div>
      {/if}
    {/if}
  {/if}
{/each}
{#if nodes.length > shown}
  <button class="tree-row more" style:--depth={depth} on:click={() => (shown += PAGE)}>
    <span class="caret-slot" />Show {Math.min(PAGE, nodes.length - shown)} more of {(
      nodes.length - shown
    ).toLocaleString()}…
  </button>
{/if}

<style>
  /* One indentation for every row of a Sources tree: a caret slot, an icon, the label, then counts and actions. */
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

  .caret-slot {
    align-items: center;
    display: flex;
    flex: none;
    justify-content: center;
    width: 14px;
  }

  .toggle {
    align-items: center;
    background: none;
    border: 0;
    color: var(--st-gray-80);
    cursor: pointer;
    display: flex;
    flex: 1;
    gap: 4px;
    min-width: 0;
    padding: 0;
    text-align: left;
  }

  .group .toggle {
    font-weight: 500;
  }

  .group.source .toggle {
    color: var(--st-gray-100);
  }

  .tree-row {
    position: relative;
  }

  .tree-row.selected {
    background: var(--st-utility-blue-10, #e0ecfb);
    box-shadow: inset 2px 0 0 var(--st-utility-blue);
  }

  .caret {
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0;
  }

  .item {
    cursor: grab;
  }

  .item.selectable {
    cursor: pointer;
  }

  /* Shown over the row's end while hovered or focused (or its menu is open); the row keeps its layout. */
  .actions {
    align-items: center;
    background: linear-gradient(to right, transparent, var(--st-gray-15) 8px);
    bottom: 0;
    display: none;
    padding-left: 10px;
    position: absolute;
    right: 0;
    top: 0;
  }

  .selected .actions {
    background: linear-gradient(to right, transparent, var(--st-utility-blue-10, #e0ecfb) 8px);
  }

  .item:hover .actions,
  .item:focus-within .actions,
  .actions:has([data-state='open']) {
    display: flex;
  }

  .actions :global(.add) {
    height: 20px;
    width: 20px;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-row :global(.icon) {
    color: var(--st-gray-60);
    flex: none;
  }

  .tag {
    background: var(--st-gray-15);
    border-radius: 3px;
    color: var(--st-gray-70);
    flex: none;
    font-size: 10px;
    padding: 0 4px;
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

  .more {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    text-align: left;
  }
</style>
