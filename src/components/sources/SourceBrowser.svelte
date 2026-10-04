<svelte:options immutable={true} />

<!--
  The Sources tab: data available to this plan's analysis, grouped by where it comes from. Adding an item
  creates a layer bound to that item's source through the same path as the Plan catalog lists.
-->
<script lang="ts">
  import UploadIcon from '@nasa-jpl/stellar/icons/upload.svg?component';
  import { getTimelineSourcesContext } from '../../stores/timelineSources';
  import { view, viewAddFilterToRow } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { Layer, Row, TimelineItemMetadata } from '../../types/timeline';
  import type {
    SourceBrowserAction,
    SourceBrowserNode,
    TimelineSource,
    TimelineSourceRegistry,
  } from '../../types/timelineSource';
  import { filterSourceBrowserNodes, getSource } from '../../utilities/timelineSources';
  import { tooltip } from '../../utilities/tooltip';
  import ExternalDatasetUpload from '../ExternalDatasetUpload.svelte';
  import SourceBrowserTree from './SourceBrowserTree.svelte';

  const timelineSources = getTimelineSourcesContext();

  /** The groups shown, in order, with what each says when empty; the Plan page's unless a page gives its own. */
  export let groups: string[] = ['Plan', 'External Datasets', 'External Events', 'Imported Sources'];
  export let emptyGroupMessages: Record<string, string> = {
    'External Datasets': 'No external datasets are attached to this plan',
    'External Events': 'No derivation groups are linked to this plan',
    'Imported Sources': 'No imported sources are attached to this plan',
  };
  export let readOnly: boolean = false;
  export let showUpload: boolean = true;
  export let user: User | null;

  let expanded: Record<string, boolean> = {};
  let filterText: string = '';
  let isUploadVisible: boolean = false;

  $: rows = $view?.definition.plan.timelines[0]?.rows ?? [];
  $: nodes = filterSourceBrowserNodes(getBrowserNodes($timelineSources, groups), filterText);

  function getBrowserNodes(registry: TimelineSourceRegistry, groupOrder: string[]): SourceBrowserNode[] {
    return groupOrder.map(group => {
      const sources = registry.sources.filter(source => source.group === group);
      // A group holding a single source of the same name shows that source's contents directly.
      const flattened = sources.length === 1 && sources[0].label === group;
      const children: SourceBrowserNode[] = flattened
        ? sources[0].browserNodes
        : sources.map(source => ({
            children: source.browserNodes,
            emptyMessage: source.resources ? 'No resources' : 'No data',
            id: `source:${source.id}`,
            kind: 'source',
            label: source.label,
            tooltip: source.description,
          }));
      return {
        badge: flattened || group === 'Plan' ? sources[0]?.description : `${sources.length}`,
        children,
        // Each group reports its own loading state, so an empty group is never shown as empty while it loads.
        emptyMessage:
          registry.loading || sources.some(isSourceLoading)
            ? 'Loading…'
            : (emptyGroupMessages[group] ?? 'Nothing available'),
        id: `group:${group}`,
        kind: 'group',
        label: group,
        tooltip:
          flattened || group === 'Plan' ? undefined : `${sources.length} source${sources.length === 1 ? '' : 's'}`,
      };
    });
  }

  function isSourceLoading(source: TimelineSource): boolean {
    return !!(source.events?.loading || source.intervals?.loading || source.resources?.loading);
  }

  function getMetadata(action: SourceBrowserAction): TimelineItemMetadata {
    return {
      ...(action.externalSources ? { externalSources: action.externalSources } : {}),
      sourceId: action.sourceId,
      sourceLabel: action.sourceId ? getSource($timelineSources, action.sourceId)?.label : undefined,
    };
  }

  function onAdd({
    detail: { action, layer, row },
  }: CustomEvent<{ action: SourceBrowserAction; layer?: Layer; row?: Row }>) {
    viewAddFilterToRow([action.item], action.typeName, getMetadata(action), row?.id, layer);
  }

  function onDragStart({ detail: { action, event } }: CustomEvent<{ action: SourceBrowserAction; event: DragEvent }>) {
    if (event.dataTransfer) {
      const payload = { items: [action.item], metadata: getMetadata(action), type: action.typeName };
      event.dataTransfer.setData('text/plain', JSON.stringify(payload));
      event.dataTransfer.dropEffect = 'link';
      event.dataTransfer.effectAllowed = 'link';
    }
  }

  function onToggle({ detail: { id, open } }: CustomEvent<{ id: string; open: boolean }>) {
    expanded = { ...expanded, [id]: !open };
  }
</script>

<div class="source-browser">
  <div class="source-browser-filters">
    <input
      bind:value={filterText}
      class="st-input"
      name="search"
      autocomplete="off"
      placeholder="Filter sources"
      aria-label="Filter sources"
    />
    {#if showUpload}
      <button
        class="st-button secondary"
        aria-label="Upload External Dataset"
        on:click={() => (isUploadVisible = !isUploadVisible)}
        use:tooltip={{ content: 'Upload External Dataset' }}
      >
        <UploadIcon />
      </button>
    {/if}
  </div>
  {#if isUploadVisible}
    <ExternalDatasetUpload {user} on:close={() => (isUploadVisible = false)} />
  {/if}
  <div class="source-browser-tree" role="tree" aria-label="Sources">
    <SourceBrowserTree
      {expanded}
      forceExpanded={!!filterText.trim()}
      {nodes}
      {readOnly}
      {rows}
      on:add={onAdd}
      on:dragstart={onDragStart}
      on:toggle={onToggle}
    />
  </div>
</div>

<style>
  .source-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .source-browser-filters {
    align-items: center;
    display: flex;
    gap: 8px;
    padding: 8px;
  }

  .source-browser-filters .st-input {
    flex: 1;
  }

  .source-browser-tree {
    flex: 1;
    overflow: auto;
    padding-bottom: 8px;
  }
</style>
