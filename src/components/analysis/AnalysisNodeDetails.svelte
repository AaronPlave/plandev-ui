<svelte:options immutable={true} />

<!--
  A row of a source's contents picked in the Sources tree, in a few lines: what it is, which source it is of, how much
  it holds, and the same Add to timeline the tree offers. A group lists what is in it (one click to inspect each); it
  never loads the records themselves.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { Plus } from 'lucide-svelte';
  import { analysisActivityTableFilter, analysisTimelineSources, inspect } from '../../stores/analysis';
  import { view } from '../../stores/views';
  import type { ResourceType } from '../../types/simulation';
  import type { ChartType } from '../../types/timeline';
  import type { SourceBrowserNode, TimelineSource } from '../../types/timelineSource';
  import LayerPicker from '../LayerPicker.svelte';
  import { addSourceItem } from '../sources/sourceBrowserActions';

  export let nodeId: string;
  export let readOnly: boolean = false;
  export let sourceId: string;

  /** Children listed; a catalog of thousands is for the tree's search. */
  const LIST_LIMIT = 50;

  $: source = $analysisTimelineSources.sources.find(({ id }) => id === sourceId);
  $: node = source ? findNode(source.browserNodes, nodeId) : null;
  $: action = node?.action;
  $: rows = $view?.definition.plan.timelines[0]?.rows ?? [];
  $: resource = action?.typeName === 'resource' ? (action.item as ResourceType) : null;
  $: unit = resource?.schema.metadata?.unit?.value;
  $: children = node?.children ?? [];
  $: kindLabel = describe(node, source);

  function findNode(nodes: SourceBrowserNode[], id: string): SourceBrowserNode | null {
    for (const each of nodes) {
      if (each.id === id) {
        return each;
      }
      const found = each.children ? findNode(each.children, id) : null;
      if (found) {
        return found;
      }
    }
    return null;
  }

  function describe(of: SourceBrowserNode | null, from: TimelineSource | undefined): string {
    switch (of?.action?.typeName) {
      case 'resource':
        return 'Resource';
      case 'activity':
        // A plan's external events are records of its source, listed under its External events group.
        return of?.id.includes('/events/')
          ? 'External event type'
          : from?.kind === 'simulation'
            ? 'Simulated activity type'
            : 'Activity type';
      case 'externalEvent':
        return 'External event type';
    }
    return 'Group';
  }

  function formatBadge(badge: string): string {
    return /^\d+$/.test(badge) ? Number(badge).toLocaleString() : badge;
  }

  function chartTypeFor(typeName: string): ChartType {
    return typeName === 'resource' ? 'line' : (typeName as ChartType);
  }
</script>

{#if !node || !source}
  <p class="empty">This is no longer in the analysis's sources.</p>
{:else}
  <div class="node">
    <header>
      <div class="kind">{kindLabel}</div>
      <h3 title={node.label}>{node.label}</h3>
    </header>
    <dl>
      <dt>Source</dt>
      <dd>
        <button class="link" on:click={() => inspect({ kind: 'source', sourceId })}>{source.label}</button>
      </dd>
      {#if resource}
        <dt>Value type</dt>
        <dd>{resource.schema.type}</dd>
        {#if unit}
          <dt>Units</dt>
          <dd>{unit}</dd>
        {/if}
      {/if}
      {#if node.badge}
        <dt>{action ? 'Records' : 'Contents'}</dt>
        <dd>{formatBadge(node.badge)}</dd>
      {/if}
      {#each node.tags ?? [] as tag}
        <dt>Tag</dt>
        <dd>{tag}</dd>
      {/each}
    </dl>
    {#if node.tooltip}
      <p class="note">{node.tooltip}</p>
    {/if}

    {#if action}
      <div class="actions">
        {#if !readOnly}
          <LayerPicker
            label="Add to timeline"
            layerItem={action.item}
            sourceId={action.sourceId ?? undefined}
            {rows}
            chartType={chartTypeFor(action.typeName)}
            on:select={({ detail: { layer, row } }) => addSourceItem($analysisTimelineSources, action, row, layer)}
            let:builders
          >
            <Button {builders} size="xs" variant="outline" class="gap-1"><Plus size={12} />Add to timeline…</Button>
          </LayerPicker>
        {/if}
        {#if action.typeName === 'activity'}
          <Button
            size="xs"
            variant="ghost"
            title="List these records in the activity table"
            on:click={() => ($analysisActivityTableFilter = { sourceId, type: action.item.name })}>Show in table</Button
          >
        {/if}
      </div>
    {:else if children.length}
      <ul class="children">
        {#each children.slice(0, LIST_LIMIT) as child (child.id)}
          <li>
            <button class="child" on:click={() => inspect({ kind: 'node', nodeId: child.id, sourceId })}>
              <span class="label">{child.label}</span>
              {#if child.badge}<span class="badge">{formatBadge(child.badge)}</span>{/if}
            </button>
          </li>
        {/each}
        {#if children.length > LIST_LIMIT}
          <li class="note">and {(children.length - LIST_LIMIT).toLocaleString()} more: search the Sources tree.</li>
        {/if}
      </ul>
    {:else if node.emptyMessage}
      <p class="note">{node.emptyMessage}</p>
    {/if}
  </div>
{/if}

<style>
  .node {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
    padding: 8px;
  }

  .kind {
    color: var(--st-gray-60);
    font-size: 11px;
  }

  h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
    overflow-wrap: anywhere;
  }

  dl {
    display: grid;
    font-size: 12px;
    gap: 2px 8px;
    grid-template-columns: max-content minmax(0, 1fr);
    margin: 0;
  }

  dt {
    color: var(--st-gray-60);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }

  .note,
  .empty {
    color: var(--st-gray-60);
    font-size: 12px;
    margin: 0;
  }

  .empty {
    padding: 8px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .children {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .child {
    align-items: center;
    background: none;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    display: flex;
    font-size: 12px;
    gap: 6px;
    padding: 2px 4px;
    text-align: left;
    width: 100%;
  }

  .child:hover {
    background: var(--st-gray-15);
  }

  .child .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    color: var(--st-gray-60);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
