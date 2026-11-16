<svelte:options immutable={true} />

<!--
  The analysis's sources, each once, as one tree: click a source to inspect it, open it (caret or double-click) to add
  its resources and activities to the timeline, and find the rest in its menu. A simulation of a plan that is also a
  source sits in that plan's Simulations group, with the plan's other simulations to browse and add. What needs
  attention (a failed import, a deleted revision, a newer one) is said on the source's row. Sources start closed;
  searching opens the paths to what matched, and clearing the search returns to what was open before.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { ChevronsDownUp, ChevronsUpDown, Plus } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    addAnalysisSource,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSourceRecovery,
    analysisSourceRevisions,
    removeAnalysisSource,
  } from '../../stores/analysis';
  import { view } from '../../stores/views';
  import type {
    AnalysisPlan,
    AnalysisPlanSimulationDataset,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
    SourceRecovery,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { Layer, Row } from '../../types/timeline';
  import type { SourceBrowserAction, SourceBrowserNode, TimelineSourceRegistry } from '../../types/timelineSource';
  import { getNewerRevision } from '../../utilities/analysis';
  import { getAuthoredMission, getAuthoredSections, getWorkspaceFileSnapshot } from '../../utilities/analysisSequence';
  import { getWorkspacesUrl } from '../../utilities/routes';
  import { collapseSingleChildGroups, searchSourceBrowserNodes } from '../../utilities/timelineSources';
  import { addSourceItem, dragSourceItem } from '../sources/sourceBrowserActions';
  import AnalysisSourceNode, {
    type SourceEntry,
    type SourceStatus,
    type SourceTreeResult,
  } from './AnalysisSourceNode.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let registry: TimelineSourceRegistry;
  export let readOnly: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ addSource: 'imported' | 'plans' }>();

  let expanded: Record<string, boolean> = {};
  let filterText: string = '';
  let tree: HTMLDivElement;

  $: rows = $view?.definition.plan.timelines[0]?.rows ?? [];
  const plansLoading = analysisPlans.loading;
  $: entries = getEntries(
    bindings,
    registry,
    $analysisPlans ?? [],
    $plansLoading,
    $analysisSimulationDatasets,
    $analysisSourceRevisions,
    $analysisSourceRecovery,
  );
  // Each bound plan's simulations, newest first, with the binding that reads each one.
  $: planSimulations = Object.fromEntries(
    bindings.flatMap(binding => {
      if (binding.kind !== 'plan') {
        return [];
      }
      const plan = ($analysisPlans ?? []).find(({ id }) => id === binding.planId);
      const datasets: AnalysisPlanSimulationDataset[] = (plan?.simulations ?? [])
        .flatMap(simulation => simulation.simulation_datasets)
        .sort((a, b) => b.id - a.id);
      return [
        [
          binding.id,
          datasets.map(dataset => ({
            binding: bindings.find(b => b.kind === 'simulation' && b.simulationDatasetId === dataset.id),
            dataset,
          })),
        ],
      ];
    }),
  );
  // A simulation shown under its plan is not shown again at the top.
  $: nested = new Set(
    Object.values(planSimulations).flatMap(simulations => simulations.flatMap(s => (s.binding ? [s.binding.id] : []))),
  );
  $: topLevel = bindings.filter(binding => !nested.has(binding.id));
  // A source's contents, once per change of the registry: a group of a single group shows its contents directly.
  $: contents = Object.fromEntries(
    registry.sources.map(source => [source.id, collapseSingleChildGroups(source.browserNodes)]),
  );
  $: searching = !!filterText.trim();
  $: results = getResults(bindings, contents, entries, planSimulations, filterText);
  $: clearSearchToggles(filterText);

  function getEntries(
    all: AnalysisSourceBinding[],
    sources: TimelineSourceRegistry,
    plans: AnalysisPlan[],
    plansLoading: boolean,
    datasets: AnalysisSimulationDataset[],
    revisions: AnalysisSourceRevision[],
    recoveries: Record<number, SourceRecovery | null>,
  ): Record<string, SourceEntry> {
    const getStatus = (binding: AnalysisSourceBinding): SourceStatus | null => {
      if (binding.kind === 'plan') {
        return plans.some(({ id }) => id === binding.planId) || plansLoading
          ? { text: 'Live', tone: 'muted' }
          : { text: 'Plan deleted', tone: 'error' };
      }
      if (binding.kind === 'simulation') {
        const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
        return dataset && dataset.status !== 'success'
          ? { text: dataset.status, tone: dataset.status === 'failed' ? 'error' : 'muted' }
          : null;
      }
      const revision = revisions.find(({ id }) => id === binding.revisionId);
      if (!revision) {
        const recovery = binding.sourceId === undefined ? undefined : recoveries[binding.sourceId];
        return recovery === undefined
          ? null
          : { text: recovery === null ? 'Source deleted' : 'Revision deleted', tone: 'error' };
      }
      if (revision.status === 'failed') {
        return { text: 'Import failed', tone: 'error' };
      }
      if (revision.status !== 'success') {
        return { text: 'Importing…', tone: 'muted' };
      }
      const newer = getNewerRevision(revision);
      return newer && !all.some(b => b.kind === 'imported' && b.revisionId === newer.id)
        ? { text: 'Newer revision', tone: 'warning' }
        : null;
    };
    return Object.fromEntries(
      all.map(binding => {
        const source = sources.sources.find(({ id }) => id === binding.id);
        const entry: SourceEntry = {
          label: source?.label ?? binding.id,
          status: getStatus(binding),
          unavailableReason: source?.resources?.unavailableReason,
        };
        if (binding.kind === 'plan') {
          entry.openHref = `${base}/plans/${binding.planId}`;
          entry.openLabel = 'Open Plan';
        } else if (binding.kind === 'simulation') {
          const planId = datasets.find(({ id }) => id === binding.simulationDatasetId)?.simulation?.plan?.id;
          if (planId !== undefined) {
            entry.openHref = `${base}/plans/${planId}?simulationDatasetId=${binding.simulationDatasetId}`;
            entry.openLabel = 'Open Simulation in its Plan';
          }
        } else {
          const revision = revisions.find(({ id }) => id === binding.revisionId);
          const mission = getAuthoredMission(revision);
          const file = getWorkspaceFileSnapshot(revision);
          if (mission) {
            entry.sequence = {
              name: mission.sequenceId || 'Sequence',
              steps: getAuthoredSections(mission).reduce((n, section) => n + section.entries.length, 0),
            };
          }
          if (file) {
            entry.file = { href: getWorkspacesUrl(base, file.workspaceId, file.path) };
          }
        }
        return [binding.id, entry];
      }),
    );
  }

  function getResults(
    all: AnalysisSourceBinding[],
    sourceContents: Record<string, SourceBrowserNode[]>,
    sourceEntries: Record<string, SourceEntry>,
    simulations: typeof planSimulations,
    text: string,
  ): Record<string, SourceTreeResult> {
    const needle = text.trim().toLowerCase();
    const results: Record<string, SourceTreeResult> = {};
    // Simulations first: a plan is shown when one of its simulations matched.
    const ordered = [...all].sort((a, b) => Number(a.kind === 'plan') - Number(b.kind === 'plan'));
    ordered.forEach(binding => {
      const nodes = sourceContents[binding.id] ?? [];
      const entry = sourceEntries[binding.id];
      if (!needle) {
        results[binding.id] = {
          groupsOpen: new Set(),
          labelMatch: true,
          nodes,
          open: false,
          sequenceMatch: false,
          visible: true,
        };
        return;
      }
      const found = searchSourceBrowserNodes(nodes, needle, 200);
      const labelMatch = !!entry?.label.toLowerCase().includes(needle);
      const sequenceMatch = !!entry?.sequence?.name.toLowerCase().includes(needle);
      const simulationMatch = (simulations[binding.id] ?? []).some(s => s.binding && results[s.binding.id]?.visible);
      results[binding.id] = {
        groupsOpen: found.open,
        labelMatch,
        nodes: found.nodes.length || !labelMatch ? found.nodes : nodes,
        open: found.nodes.length > 0 || sequenceMatch || simulationMatch,
        sequenceMatch,
        visible: labelMatch || sequenceMatch || simulationMatch || found.nodes.length > 0,
      };
    });
    return results;
  }

  // Toggles made while searching are the search's own: clearing it brings back what was open before.
  function clearSearchToggles(_text: string) {
    expanded = Object.fromEntries(Object.entries(expanded).filter(([id]) => !id.startsWith('search:')));
  }

  /** Opens every source and its first level (a plan's simulations included), but not the catalogs within. */
  function expandAll() {
    const next: Record<string, boolean> = { ...expanded };
    bindings.forEach(binding => {
      next[binding.id] = true;
      next[`${binding.id}/simulations`] = true;
    });
    expanded = next;
  }

  function collapseAll() {
    expanded = Object.fromEntries(Object.entries(expanded).filter(([id]) => id.startsWith('search:')));
    bindings.forEach(binding => (expanded[`${searching ? 'search:' : ''}${binding.id}`] = false));
  }

  function onAdd({
    detail: { action, layer, row },
  }: CustomEvent<{ action: SourceBrowserAction; layer?: Layer; row?: Row }>) {
    addSourceItem(registry, action, row, layer);
  }

  function onDragStart({ detail: { action, event } }: CustomEvent<{ action: SourceBrowserAction; event: DragEvent }>) {
    dragSourceItem(registry, action, event);
  }

  function onToggle({ detail: { id, open } }: CustomEvent<{ id: string; open: boolean }>) {
    expanded = { ...expanded, [id]: !open };
  }

  /** Up and down move between rows; right and left open and close the focused row. */
  function onKeydown(event: KeyboardEvent) {
    const focusable = [...tree.querySelectorAll<HTMLElement>('[data-tree-focus]')];
    const current = focusable.findIndex(element => element.contains(document.activeElement));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        focusable[Math.max(0, Math.min(focusable.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
    } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && current >= 0) {
      const element = focusable[current];
      const isOpen = element.getAttribute('aria-expanded') === 'true';
      if (
        element.hasAttribute('aria-expanded') &&
        isOpen !== (event.key === 'ArrowRight') &&
        !element.classList.contains('name')
      ) {
        event.preventDefault();
        element.click();
      }
    }
  }
</script>

<div class="analysis-sources">
  <div class="header">
    <span class="title">Sources</span>
    <Button
      size="sm"
      variant="outline"
      class="gap-1"
      disabled={readOnly}
      on:click={() => dispatch('addSource', 'imported')}><Plus size={14} />Add Source</Button
    >
  </div>
  {#if bindings.length}
    <div class="filter">
      <input
        bind:value={filterText}
        class="st-input w-full"
        autocomplete="off"
        placeholder="Search sources, resources, activities"
        aria-label="Search sources"
        type="search"
      />
      <Button size="icon-sm" variant="ghost" aria-label="Expand all" title="Expand all" on:click={expandAll}
        ><ChevronsUpDown size={14} /></Button
      >
      <Button size="icon-sm" variant="ghost" aria-label="Collapse all" title="Collapse all" on:click={collapseAll}
        ><ChevronsDownUp size={14} /></Button
      >
    </div>
  {/if}
  <div class="tree" role="tree" tabindex="-1" aria-label="Analysis sources" bind:this={tree} on:keydown={onKeydown}>
    {#each topLevel as binding (binding.id)}
      <AnalysisSourceNode
        {binding}
        {entries}
        {expanded}
        {readOnly}
        {results}
        {rows}
        {searching}
        simulations={planSimulations[binding.id] ?? []}
        on:add={onAdd}
        on:addSimulation={({ detail }) => addAnalysisSource({ kind: 'simulation', simulationDatasetId: detail }, user)}
        on:browseSimulations={() => dispatch('addSource', 'plans')}
        on:dragstart={onDragStart}
        on:remove={({ detail }) => removeAnalysisSource(detail, user)}
        on:toggle={onToggle}
      />
    {:else}
      <div class="empty">
        No sources yet.
        <button class="link" disabled={readOnly} on:click={() => dispatch('addSource', 'imported')}>Add one</button>
      </div>
    {/each}
    {#if searching && !Object.values(results).some(result => result.visible)}
      <div class="empty">Nothing matches "{filterText.trim()}".</div>
    {/if}
  </div>
</div>

<style>
  .analysis-sources {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    height: 100%;
    overflow: hidden;
  }

  .header {
    align-items: center;
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    justify-content: space-between;
    min-height: 36px;
    padding: 4px 8px;
  }

  .title {
    font-size: 13px;
    font-weight: 500;
  }

  .filter {
    align-items: center;
    display: flex;
    gap: 2px;
    padding: 6px 4px 4px 8px;
  }

  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding-bottom: 8px;
  }

  .empty {
    color: var(--st-gray-60);
    padding: 8px;
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    padding: 0;
  }
</style>
