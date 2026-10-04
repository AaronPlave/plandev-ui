<svelte:options immutable={true} />

<script lang="ts">
  import { base } from '$app/paths';
  import { Resizable } from '@nasa-jpl/stellar-svelte';
  import { onDestroy } from 'svelte';
  import AnalysisActivityDetails from '../../../components/analysis/AnalysisActivityDetails.svelte';
  import AnalysisActivityTable from '../../../components/analysis/AnalysisActivityTable.svelte';
  import AnalysisSourcesPanel from '../../../components/analysis/AnalysisSourcesPanel.svelte';
  import AnalysisTimelinePanel from '../../../components/analysis/AnalysisTimelinePanel.svelte';
  import Nav from '../../../components/app/Nav.svelte';
  import PageTitle from '../../../components/app/PageTitle.svelte';
  import TimelineEditorPanel from '../../../components/timeline/form/TimelineEditorPanel.svelte';
  import {
    analysis,
    analysisMaxTimeRange,
    analysisSaveStatus,
    analysisSimulationDatasets,
    analysisSourceBindings,
    analysisSourceRevisions,
    analysisTimelineSources,
    autosaveAnalysis,
    closeAnalysis,
    openAnalysis,
    renameAnalysis,
    selectedAnalysisActivity,
  } from '../../../stores/analysis';
  import { setTimelineSourcesContext } from '../../../stores/timelineSources';
  import { getUserStore } from '../../../stores/user';
  import { selectedRow } from '../../../stores/views';
  import { featurePermissions } from '../../../utilities/permissions';
  import type { PageData } from './$types';

  export let data: PageData;

  const user = getUserStore();
  // The timeline, its editor and the Sources browser on this page read the analysis's sources, not a plan's.
  setTimelineSourcesContext(analysisTimelineSources);

  let rightTab: 'details' | 'editor' = 'details';
  let timelinePanel: AnalysisTimelinePanel;
  let stopAutosave: (() => void) | null = null;

  $: if (data.initialAnalysis && data.initialAnalysis.id !== $analysis?.id) {
    stopAutosave?.();
    openAnalysis(data.initialAnalysis, $user).then(() => (stopAutosave = autosaveAnalysis($user)));
  }
  $: readOnly = !$analysis || $user === null || !featurePermissions.analysis.canUpdate($user, $analysis);
  $: sourceLabels = Object.fromEntries($analysisTimelineSources.sources.map(source => [source.id, source.label]));
  $: typeOptions = [
    ...new Set($analysisTimelineSources.sources.flatMap(source => source.intervals?.present.map(t => t.name) ?? [])),
  ].sort();
  // Adding a row from the Sources browser selects it: show it in the editor.
  $: selectedRowId = $selectedRow?.id;
  $: if (selectedRowId !== undefined && !readOnly) {
    rightTab = 'editor';
  }

  onDestroy(() => {
    stopAutosave?.();
    closeAnalysis();
  });

  const saveStatusLabels = {
    conflict: '',
    error: 'Save failed',
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved changes',
  };
</script>

<PageTitle subTitle={$analysis?.name} title="Analyses" />

<div class="analysis-page">
  <Nav>
    <div class="title" slot="title">
      <a class="st-typography-label crumb" href="{base}/analyses">Analyses</a>
      <span class="crumb">/</span>
      <input
        class="st-input name"
        aria-label="Analysis name"
        value={$analysis?.name ?? ''}
        disabled={readOnly}
        on:change={event => renameAnalysis(event.currentTarget.value.trim(), $user)}
      />
    </div>
    <svelte:fragment slot="right">
      <span class="st-typography-label save-status" aria-live="polite">
        {#if readOnly}
          Read only
        {:else if $analysisSaveStatus === 'conflict'}
          Changed elsewhere, not saving.
          <button class="st-button secondary" on:click={() => location.reload()}>Reload</button>
        {:else}
          {saveStatusLabels[$analysisSaveStatus]}
        {/if}
      </span>
    </svelte:fragment>
  </Nav>

  <div class="analysis-body">
    <Resizable.PaneGroup direction="horizontal" autoSaveId="analysis-columns">
      <Resizable.Pane defaultSize={20} minSize={12}>
        <AnalysisSourcesPanel
          bindings={$analysisSourceBindings}
          registry={$analysisTimelineSources}
          {readOnly}
          user={$user}
        />
      </Resizable.Pane>
      <Resizable.Handle />
      <Resizable.Pane defaultSize={58} minSize={30}>
        <Resizable.PaneGroup direction="vertical" autoSaveId="analysis-center">
          <Resizable.Pane defaultSize={62} minSize={20}>
            <AnalysisTimelinePanel
              bind:this={timelinePanel}
              {readOnly}
              user={$user}
              on:editRow={() => (rightTab = 'editor')}
              on:inspect={() => (rightTab = 'details')}
            />
          </Resizable.Pane>
          <Resizable.Handle />
          <Resizable.Pane defaultSize={38} minSize={10}>
            <AnalysisActivityTable
              bindings={$analysisSourceBindings}
              selected={$selectedAnalysisActivity}
              {sourceLabels}
              {typeOptions}
              user={$user}
              on:select={({ detail: { endMs, ref, startMs } }) => {
                $selectedAnalysisActivity = ref;
                rightTab = 'details';
                timelinePanel?.reveal(startMs, endMs);
              }}
            />
          </Resizable.Pane>
        </Resizable.PaneGroup>
      </Resizable.Pane>
      <Resizable.Handle />
      <Resizable.Pane defaultSize={22} minSize={12}>
        <div class="right">
          <div class="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={rightTab === 'details'}
              class:active={rightTab === 'details'}
              on:click={() => (rightTab = 'details')}>Activity</button
            >
            {#if !readOnly}
              <button
                role="tab"
                aria-selected={rightTab === 'editor'}
                class:active={rightTab === 'editor'}
                on:click={() => (rightTab = 'editor')}>Timeline Editor</button
              >
            {/if}
          </div>
          <div class="tab-body">
            {#if rightTab === 'details' || readOnly}
              <AnalysisActivityDetails
                bindings={$analysisSourceBindings}
                datasets={$analysisSimulationDatasets}
                revisions={$analysisSourceRevisions}
                selected={$selectedAnalysisActivity}
                {sourceLabels}
                user={$user}
              />
            {:else}
              <TimelineEditorPanel gridSection="RightTop" timeBounds={$analysisMaxTimeRange} />
            {/if}
          </div>
        </div>
      </Resizable.Pane>
    </Resizable.PaneGroup>
  </div>
</div>

<style>
  .analysis-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .analysis-body {
    flex: 1;
    min-height: 0;
  }

  .title {
    align-items: center;
    display: flex;
    gap: 6px;
  }

  .crumb {
    color: var(--st-gray-30);
  }

  .name {
    background: transparent;
    border-color: transparent;
    color: white;
    min-width: 280px;
  }

  .name:hover,
  .name:focus {
    border-color: var(--st-gray-50);
  }

  .save-status {
    color: var(--st-gray-30);
    padding-right: 8px;
  }

  .right {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tabs {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
  }

  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-size: 12px;
    padding: 6px 10px;
  }

  .tabs button.active {
    border-bottom-color: var(--st-utility-blue);
  }

  .tab-body {
    display: grid;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
