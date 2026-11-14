<svelte:options immutable={true} />

<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/stores';
  import { debounce } from 'lodash-es';
  import { Button, DropdownMenu, Resizable } from '@nasa-jpl/stellar-svelte';
  import {
    ChevronUp,
    Crosshair,
    Ellipsis,
    Link,
    LayoutTemplate,
    PanelBottom,
    PanelLeft,
    PanelRight,
    Pencil,
    Presentation,
    StickyNote,
    TextSearch,
  } from 'lucide-svelte';
  import type { PaneAPI } from 'paneforge';
  import { onDestroy } from 'svelte';
  import AnalysisActivityDetails from '../../../components/analysis/AnalysisActivityDetails.svelte';
  import AnalysisActivityTable from '../../../components/analysis/AnalysisActivityTable.svelte';
  import AnalysisAddSourceDialog from '../../../components/analysis/AnalysisAddSourceDialog.svelte';
  import AnalysisApplyPresentationDialog from '../../../components/analysis/AnalysisApplyPresentationDialog.svelte';
  import AnalysisAtTimePanel from '../../../components/analysis/AnalysisAtTimePanel.svelte';
  import AnalysisLoadViewDialog from '../../../components/analysis/AnalysisLoadViewDialog.svelte';
  import AnalysisNotesPanel from '../../../components/analysis/AnalysisNotesPanel.svelte';
  import AnalysisSourcesPanel from '../../../components/analysis/AnalysisSourcesPanel.svelte';
  import AnalysisTimelinePanel from '../../../components/analysis/AnalysisTimelinePanel.svelte';
  import Nav from '../../../components/app/Nav.svelte';
  import PageTitle from '../../../components/app/PageTitle.svelte';
  import TimelineEditorPanel from '../../../components/timeline/form/TimelineEditorPanel.svelte';
  import Tab from '../../../components/ui/Tabs/Tab.svelte';
  import TabPanel from '../../../components/ui/Tabs/TabPanel.svelte';
  import Tabs from '../../../components/ui/Tabs/Tabs.svelte';
  import {
    addAnalysisSource,
    analysis,
    analysisMaxTimeRange,
    analysisPlans,
    analysisSaveStatus,
    analysisSimulationDatasets,
    analysisSourceBindings,
    analysisSourceRevisions,
    analysisTimelineSources,
    autosaveAnalysis,
    closeAnalysis,
    getAnalysisLinkParams,
    openAnalysis,
    parseAnalysisOpenContext,
    type AnalysisOpenContext,
    renameAnalysis,
    selectedAnalysisActivity,
    showAnalysisActivityType,
  } from '../../../stores/analysis';
  import { timeCursorMs, viewTimeRange } from '../../../stores/plan';
  import { setTimelineSourcesContext } from '../../../stores/timelineSources';
  import { getUserStore } from '../../../stores/user';
  import { featurePermissions } from '../../../utilities/permissions';
  import { showFailureToast, showSuccessToast } from '../../../utilities/toast';
  import type { PageData } from './$types';

  export let data: PageData;

  type InspectorTab = 'details' | 'editor' | 'notes' | 'time';

  const user = getUserStore();
  // The timeline, its editor and the Sources browser on this page read the analysis's sources, not a plan's.
  setTimelineSourcesContext(analysisTimelineSources);

  const SOURCES_DEFAULT_SIZE = 20;
  const INSPECTOR_DEFAULT_SIZE = 22;
  const TABLE_DEFAULT_SIZE = 38;
  const PANE_MIN_SIZE = 12;

  // The three collapsible panes stay mounted while collapsed (a pane only shrinks to nothing), so a collapsed Sources
  // panel keeps its search and expansion, the table its filters and selection, and the inspector its tab.
  let sourcesPane: PaneAPI;
  let inspectorPane: PaneAPI;
  let tablePane: PaneAPI;
  let sourcesOpen: boolean = true;
  let inspectorOpen: boolean = true;
  let tableOpen: boolean = true;
  let inspectorTabs: Tabs;
  let inspectorTab: InspectorTab = 'details';
  let timelinePanel: AnalysisTimelinePanel;
  let stopAutosave: (() => void) | null = null;
  let addSourceOpen: boolean = false;
  let addSourceTab: 'imported' | 'plans' | 'import' = 'imported';
  let loadViewOpen: boolean = false;
  let applyPresentationOpen: boolean = false;

  /*
   * Where this person last looked in each analysis, kept in their browser only: reopening it returns there, and it
   * never changes what anyone else opens. A shared link's own range wins over it.
   */
  const lastVisitKey = (id: number) => `analysis-last-visit:${id}`;
  function readLastVisit(id: number): AnalysisOpenContext {
    try {
      return parseAnalysisOpenContext(new URLSearchParams(localStorage.getItem(lastVisitKey(id)) ?? ''));
    } catch {
      return {};
    }
  }
  const rememberVisit = debounce((id: number, ..._changedWith: unknown[]) => {
    try {
      const params = getAnalysisLinkParams();
      params.delete('activity');
      localStorage.setItem(lastVisitKey(id), params.toString());
    } catch {
      // Storage unavailable: reopening starts on the sources' range, as before.
    }
  }, 1000);

  async function copyLink() {
    const url = new URL(`${base}/analyses/${$analysis?.id}`, location.origin);
    url.search = getAnalysisLinkParams().toString();
    try {
      await navigator.clipboard.writeText(url.toString());
      showSuccessToast('Copied a link to this time range, cursor and selected activity');
    } catch {
      showFailureToast('Could Not Copy The Link');
    }
  }

  function openAddSource(tab: typeof addSourceTab = 'imported') {
    addSourceTab = tab;
    addSourceOpen = true;
  }

  function togglePane(pane: PaneAPI | undefined) {
    if (!pane) {
      return;
    }
    if (pane.isCollapsed()) {
      pane.expand();
    } else {
      pane.collapse();
    }
  }

  /** Paneforge reopens a pane that has no remembered size at its minimum: give it its default instead. */
  function ensureDefaultSize(pane: PaneAPI | undefined, defaultSize: number) {
    if (pane && pane.getSize() <= PANE_MIN_SIZE) {
      pane.resize(defaultSize);
    }
  }

  function onSelectTab({ detail }: CustomEvent<{ id: unknown }>) {
    inspectorTab = detail.id as InspectorTab;
  }

  /** Shows the inspector on a tab: only for something the user asked for, never as a side effect of selecting. */
  function openInspector(tab: InspectorTab) {
    if (tab === 'editor' && readOnly) {
      return;
    }
    inspectorPane?.expand();
    inspectorTabs?.selectTab(tab);
  }

  $: if (data.initialAnalysis && data.initialAnalysis.id !== $analysis?.id) {
    stopAutosave?.();
    const fromLink = parseAnalysisOpenContext($page.url.searchParams);
    const context = fromLink.range ? fromLink : { ...readLastVisit(data.initialAnalysis.id), ...fromLink };
    openAnalysis(data.initialAnalysis, $user, context).then(() => {
      stopAutosave = autosaveAnalysis($user);
      if (context.noteId !== undefined) {
        openInspector('notes');
      } else if (context.activity) {
        openInspector('details');
      }
    });
  }
  $: if ($analysis) {
    rememberVisit($analysis.id, $viewTimeRange, $timeCursorMs);
  }
  $: readOnly = !$analysis || $user === null || !featurePermissions.analysis.canUpdate($user, $analysis);
  // Said wherever an edit is not offered, so a disabled control is not a mystery.
  $: readOnlyReason = $analysis
    ? `Read only: only ${$analysis.owner === $user?.id ? 'you' : $analysis.owner}, the owner, or an admin can change this analysis (its rows, notes and sources).`
    : '';
  $: sourceLabels = Object.fromEntries($analysisTimelineSources.sources.map(source => [source.id, source.label]));
  $: typeOptions = [
    ...new Set($analysisTimelineSources.sources.flatMap(source => source.intervals?.present.map(t => t.name) ?? [])),
  ].sort();
  // Each source's own types: "Show on timeline" needs a type the selected source actually has.
  $: sourceTypes = Object.fromEntries(
    $analysisTimelineSources.sources.map(source => [source.id, source.intervals?.present.map(t => t.name) ?? []]),
  );

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
          <span title={readOnlyReason}>Read only</span>
        {:else if $analysisSaveStatus === 'conflict'}
          Changed elsewhere, not saving.
          <button class="st-button secondary" on:click={() => location.reload()}>Reload</button>
        {:else}
          {saveStatusLabels[$analysisSaveStatus]}
        {/if}
      </span>
      <div class="flex items-center gap-0.5" role="group" aria-label="Show or hide panels">
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/15 hover:text-white {sourcesOpen ? 'bg-white/20' : ''}"
          aria-label="Sources panel"
          aria-pressed={sourcesOpen}
          title={sourcesOpen ? 'Hide Sources' : 'Show Sources'}
          on:click={() => togglePane(sourcesPane)}
        >
          <PanelLeft size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/15 hover:text-white {tableOpen ? 'bg-white/20' : ''}"
          aria-label="Activity table"
          aria-pressed={tableOpen}
          title={tableOpen ? 'Hide the activity table' : 'Show the activity table'}
          on:click={() => togglePane(tablePane)}
        >
          <PanelBottom size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-white hover:bg-white/15 hover:text-white {inspectorOpen ? 'bg-white/20' : ''}"
          aria-label="Inspector panel"
          aria-pressed={inspectorOpen}
          title={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
          on:click={() => togglePane(inspectorPane)}
        >
          <PanelRight size={16} />
        </Button>
      </div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild let:builder>
          <Button
            builders={[builder]}
            variant="ghost"
            size="icon"
            class="text-white hover:bg-white/15 hover:text-white"
            aria-label="Analysis actions"
          >
            <Ellipsis size={16} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item
            class="flex cursor-pointer items-center gap-2 text-[13px]"
            disabled={readOnly}
            on:click={() => (loadViewOpen = true)}
          >
            <LayoutTemplate size={14} />
            Load timeline from a view…
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="flex cursor-pointer items-center gap-2 text-[13px]"
            disabled={readOnly}
            on:click={() => (applyPresentationOpen = true)}
          >
            <Presentation size={14} />
            Use another analysis's layout…
          </DropdownMenu.Item>
          <DropdownMenu.Item class="flex cursor-pointer items-center gap-2 text-[13px]" on:click={copyLink}>
            <Link size={14} />
            Copy link to this view
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </svelte:fragment>
  </Nav>

  <div class="analysis-body">
    <Resizable.PaneGroup direction="horizontal" autoSaveId="analysis-columns">
      <Resizable.Pane
        defaultSize={SOURCES_DEFAULT_SIZE}
        minSize={PANE_MIN_SIZE}
        collapsible
        collapsedSize={0}
        onResize={size => (sourcesOpen = size > 0)}
        onExpand={() => ensureDefaultSize(sourcesPane, SOURCES_DEFAULT_SIZE)}
        bind:pane={sourcesPane}
      >
        <AnalysisSourcesPanel
          bindings={$analysisSourceBindings}
          registry={$analysisTimelineSources}
          {readOnly}
          user={$user}
          on:addSource={() => openAddSource()}
        />
      </Resizable.Pane>
      <Resizable.Handle />
      <Resizable.Pane defaultSize={58} minSize={30}>
        <div class="center">
          <div class="center-panes">
            <Resizable.PaneGroup direction="vertical" autoSaveId="analysis-center">
              <Resizable.Pane defaultSize={62} minSize={20}>
                <AnalysisTimelinePanel
                  bind:this={timelinePanel}
                  {readOnly}
                  user={$user}
                  on:addSource={({ detail }) => openAddSource(detail)}
                  on:editRow={() => openInspector('editor')}
                  on:loadView={() => (loadViewOpen = true)}
                  on:inspect={() => openInspector('details')}
                  on:openAtTime={() => openInspector('time')}
                  on:openNotes={() => openInspector('notes')}
                />
              </Resizable.Pane>
              <Resizable.Handle />
              <Resizable.Pane
                defaultSize={TABLE_DEFAULT_SIZE}
                minSize={10}
                collapsible
                collapsedSize={0}
                onResize={size => (tableOpen = size > 0)}
                onExpand={() => ensureDefaultSize(tablePane, TABLE_DEFAULT_SIZE)}
                bind:pane={tablePane}
              >
                <AnalysisActivityTable
                  bindings={$analysisSourceBindings}
                  selected={$selectedAnalysisActivity}
                  {readOnly}
                  {sourceLabels}
                  {sourceTypes}
                  {typeOptions}
                  user={$user}
                  viewTimeRange={$viewTimeRange}
                  refreshKey={($analysisPlans ?? []).map(plan => `${plan.id}:${plan.revision}`).join()}
                  on:select={({ detail: { endMs, ref, startMs } }) => {
                    $selectedAnalysisActivity = ref;
                    // The editor says nothing about an activity; the other tabs stay where the user left them.
                    if (inspectorOpen && inspectorTab === 'editor') {
                      inspectorTabs?.selectTab('details');
                    }
                    timelinePanel?.reveal(startMs, endMs);
                  }}
                  on:showOnTimeline={({ detail }) => showAnalysisActivityType(detail.sourceId, detail.type)}
                  on:zoom={({ detail }) => timelinePanel?.zoomTo(detail.startMs, detail.endMs)}
                />
              </Resizable.Pane>
            </Resizable.PaneGroup>
          </div>
          {#if !tableOpen}
            <button class="table-bar" aria-label="Show the activity table" on:click={() => togglePane(tablePane)}>
              <ChevronUp size={14} />
              <span class="st-typography-medium">Activities</span>
            </button>
          {/if}
        </div>
      </Resizable.Pane>
      <Resizable.Handle />
      <Resizable.Pane
        defaultSize={INSPECTOR_DEFAULT_SIZE}
        minSize={PANE_MIN_SIZE}
        collapsible
        collapsedSize={0}
        onResize={size => (inspectorOpen = size > 0)}
        onExpand={() => ensureDefaultSize(inspectorPane, INSPECTOR_DEFAULT_SIZE)}
        bind:pane={inspectorPane}
      >
        <Tabs bind:this={inspectorTabs} class="analysis-inspector" on:select-tab={onSelectTab}>
          <svelte:fragment slot="tab-list">
            <Tab class="flex items-center gap-1.5 text-xs" tabId="details"><TextSearch size={14} />Activity</Tab>
            <Tab class="flex items-center gap-1.5 text-xs" tabId="time"><Crosshair size={14} />At Time</Tab>
            <Tab class="flex items-center gap-1.5 text-xs" tabId="notes"><StickyNote size={14} />Notes</Tab>
            <Tab class="flex items-center gap-1.5 text-xs" tabId="editor" disabled={readOnly}
              ><Pencil size={14} />Timeline Editor</Tab
            >
          </svelte:fragment>
          <TabPanel panelId="details">
            <AnalysisActivityDetails
              bindings={$analysisSourceBindings}
              datasets={$analysisSimulationDatasets}
              {readOnly}
              revisions={$analysisSourceRevisions}
              selected={$selectedAnalysisActivity}
              {sourceLabels}
              user={$user}
              on:inspectAt={() => {
                openInspector('time');
                timelinePanel?.reveal($timeCursorMs ?? 0, $timeCursorMs ?? 0);
              }}
              on:select={({ detail: { endMs, ref, startMs } }) => {
                $selectedAnalysisActivity = ref;
                timelinePanel?.reveal(startMs, endMs);
              }}
              on:zoom={({ detail }) => timelinePanel?.zoomTo(detail.startMs, detail.endMs)}
            />
          </TabPanel>
          <TabPanel panelId="time">
            <AnalysisAtTimePanel
              bindings={$analysisSourceBindings}
              {readOnly}
              {sourceLabels}
              user={$user}
              on:reveal={({ detail }) => timelinePanel?.reveal(detail, detail)}
              on:selectActivity={({ detail: { endMs, ref, startMs } }) => {
                $selectedAnalysisActivity = ref;
                timelinePanel?.reveal(startMs, endMs);
              }}
            />
          </TabPanel>
          <TabPanel panelId="notes">
            <AnalysisNotesPanel
              bindings={$analysisSourceBindings}
              {readOnly}
              {readOnlyReason}
              {sourceLabels}
              user={$user}
              on:goTo={({ detail: { endMs, ref, startMs } }) => {
                if (ref) {
                  $selectedAnalysisActivity = ref;
                }
                timelinePanel?.zoomTo(startMs, endMs);
              }}
            />
          </TabPanel>
          <TabPanel panelId="editor" disabled={readOnly}>
            <TimelineEditorPanel gridSection="RightTop" showHeader={false} timeBounds={$analysisMaxTimeRange} />
          </TabPanel>
        </Tabs>
      </Resizable.Pane>
    </Resizable.PaneGroup>
  </div>
</div>

<AnalysisAddSourceDialog
  bind:open={addSourceOpen}
  bind:tab={addSourceTab}
  bindings={$analysisSourceBindings}
  user={$user}
  on:add={({ detail }) => addAnalysisSource(detail, $user)}
/>

{#if !readOnly}
  <AnalysisLoadViewDialog bind:open={loadViewOpen} {sourceLabels} user={$user} />
  <AnalysisApplyPresentationDialog bind:open={applyPresentationOpen} {sourceLabels} user={$user} />
{/if}

<style>
  /*
   * The panels in these tabs scroll their own body, which needs a height to scroll within: the tab panel is the
   * pane's height (the Tabs' own auto row would grow to the content instead, and the pane would only clip it).
   */
  :global(div.analysis-inspector.tabs) {
    grid-template-rows: min-content minmax(0, 1fr);
  }

  :global(.analysis-inspector .tab-panels) {
    min-height: 0;
  }

  :global(.analysis-inspector .tab-panel) {
    display: grid;
    min-height: 0;
  }

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

  .center {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .center-panes {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .center-panes > :global([data-pane-group]) {
    height: 100%;
    position: absolute;
    width: 100%;
  }

  /* What is left of the activity table once collapsed: a way back that is always in view. */
  .table-bar {
    align-items: center;
    background: var(--st-gray-10);
    border: 0;
    border-top: 1px solid var(--st-gray-20);
    color: var(--st-gray-80);
    cursor: pointer;
    display: flex;
    flex: none;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    text-align: left;
    width: 100%;
  }

  .table-bar:hover {
    background: var(--st-gray-15);
  }
</style>
