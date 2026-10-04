<svelte:options immutable={true} />

<!--
  Renders SourceBrowserNodes. It knows nothing about the domain objects behind them: adapters in
  utilities/timelineSources.ts decide the structure, and an item's `action` says what adding it does.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import CaretDownIcon from '@nasa-jpl/stellar/icons/caret_down.svg?component';
  import CaretRightIcon from '@nasa-jpl/stellar/icons/caret_right.svg?component';
  import { Filter, GripVertical } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { ChartType, Layer, Row } from '../../types/timeline';
  import type { SourceBrowserAction, SourceBrowserNode } from '../../types/timelineSource';
  import { tooltip } from '../../utilities/tooltip';
  import LayerPicker from '../LayerPicker.svelte';

  export let depth: number = 0;
  export let expanded: Record<string, boolean> = {};
  export let forceExpanded: boolean = false;
  export let nodes: SourceBrowserNode[] = [];
  /** Items can be browsed but not added to rows. */
  export let readOnly: boolean = false;
  export let rows: Row[] = [];

  const dispatch = createEventDispatcher<{
    add: { action: SourceBrowserAction; layer?: Layer; row?: Row };
    dragstart: { action: SourceBrowserAction; event: DragEvent };
    toggle: { id: string; open: boolean };
  }>();

  function isExpanded(node: SourceBrowserNode, expanded: Record<string, boolean>, forceExpanded: boolean) {
    // Groups and sources start open down to the first level of their contents
    return forceExpanded || (expanded[node.id] ?? depth < 2);
  }

  function onItemDragStart(action: SourceBrowserAction) {
    return (event: DragEvent) => dispatch('dragstart', { action, event });
  }

  function chartTypeFor(action: SourceBrowserAction): ChartType {
    return action.typeName === 'resource' ? 'line' : action.typeName;
  }
</script>

{#each nodes as node (node.id)}
  {#if node.kind === 'item' && node.action}
    {@const action = node.action}
    <div
      class="source-browser-item st-typography-body"
      style:padding-left={`${8 + depth * 12}px`}
      draggable={!readOnly}
      role="treeitem"
      tabindex="0"
      aria-selected="false"
      data-node-id={node.id}
      on:dragstart={onItemDragStart(action)}
      use:tooltip={{ content: node.tooltip ?? '', disabled: !node.tooltip, placement: 'right' }}
    >
      <span class="label">{node.label}</span>
      {#each node.tags ?? [] as tag}
        <span class="tag st-typography-label">{tag}</span>
      {/each}
      {#if node.badge}
        <span class="badge st-typography-label">{node.badge}</span>
      {/if}
      {#if !readOnly}
        <LayerPicker
          layerItem={action.item}
          sourceId={action.sourceId ?? undefined}
          {rows}
          chartType={chartTypeFor(action)}
          on:select={({ detail: { layer, row } }) => dispatch('add', { action, layer, row })}
          let:builders
        >
          <Button {builders} variant="ghost" size="icon-sm" aria-label={`Add ${node.label} to row`}>
            <Filter size={14} />
          </Button>
        </LayerPicker>
        <span class="drag"><GripVertical size={14} /></span>
      {/if}
    </div>
  {:else}
    {@const open = isExpanded(node, expanded, forceExpanded)}
    <button
      class="source-browser-node st-typography-medium"
      class:source={node.kind === 'source'}
      style:padding-left={`${4 + depth * 12}px`}
      aria-expanded={open}
      data-node-id={node.id}
      on:click={() => dispatch('toggle', { id: node.id, open })}
      use:tooltip={{ content: node.tooltip ?? '', disabled: !node.tooltip, placement: 'right' }}
    >
      {#if open}<CaretDownIcon />{:else}<CaretRightIcon />{/if}
      <span class="label">{node.label}</span>
      {#each node.tags ?? [] as tag}
        <span class="tag st-typography-label">{tag}</span>
      {/each}
      {#if node.badge}
        <span class="badge st-typography-label">{node.badge}</span>
      {/if}
    </button>
    {#if open}
      {#if node.children?.length}
        <svelte:self
          depth={depth + 1}
          {expanded}
          {forceExpanded}
          nodes={node.children}
          {readOnly}
          {rows}
          on:add
          on:dragstart
          on:toggle
        />
      {:else if node.emptyMessage}
        <div class="empty st-typography-label" style:padding-left={`${20 + depth * 12}px`}>{node.emptyMessage}</div>
      {/if}
    {/if}
  {/if}
{/each}

<style>
  .source-browser-node,
  .source-browser-item {
    align-items: center;
    display: flex;
    gap: 4px;
    min-height: 26px;
    padding-right: 8px;
    width: 100%;
  }

  .source-browser-node {
    background: none;
    border: 0;
    color: var(--st-gray-80);
    cursor: pointer;
    text-align: left;
  }

  .source-browser-node:hover,
  .source-browser-item:hover {
    background: var(--st-gray-15);
  }

  .source-browser-node.source {
    color: var(--st-gray-100);
  }

  .source-browser-item {
    cursor: move;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    background: var(--st-gray-15);
    border-radius: 4px;
    color: var(--st-gray-70);
    padding: 0 4px;
  }

  .badge {
    color: var(--st-gray-60);
  }

  .drag {
    align-items: center;
    color: var(--st-gray-50);
    display: flex;
  }

  .empty {
    color: var(--st-gray-60);
    font-style: italic;
    min-height: 22px;
  }
</style>
