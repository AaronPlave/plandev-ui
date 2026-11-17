<svelte:options immutable={true} />

<!--
  Views: use a saved View on this analysis's data, or save the current View. A View is the presentation (rows, sections,
  layers, axes, styles, and the time and value marks deliberately saved with it). It can come from a View saved in an
  analysis, a Plan's view, or another analysis's current View. When every source it was saved with is here, using it
  is one step; otherwise choose which of this analysis's data each of its sources shows (the same data, or another
  revision of the same source, is filled in and said to be what it is). Problems are summed up in a line and listed
  only on request. Using a View never changes this analysis's sources or its own annotations, and can be undone.

  A Plan's view is handed to the Plan-view loader (`planView`), which maps the Plan's own layers instead.
-->
<script lang="ts">
  import { Button, Dialog, Input } from '@nasa-jpl/stellar-svelte';
  import { ChevronDown, ChevronRight } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    analyses,
    analysis,
    analysisPlanExternalEvents,
    analysisPlans,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourceBindings,
    analysisSourceRevisions,
    readAnalysisPresentation,
    readViewPresentation,
    replaceAnalysisTimeline,
    saveAnalysisLayoutAsView,
    type AnalysisPresentation,
  } from '../../stores/analysis';
  import { plugins } from '../../stores/plugins';
  import { initialViewsLoading, view, views } from '../../stores/views';
  import type { SourceActivityLink } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { DataGridColumnDef, RowId } from '../../types/data-grid';
  import {
    applyPresentation,
    getFocusedLayers,
    getFocusKey,
    getInitialRoleMapping,
    getPresentationRoles,
    getResourceRenameKey,
    getRoleMatch,
    getSourceCatalog,
    describeViewContents,
    type PresentationIssue,
    type RoleMapping,
  } from '../../utilities/analysisPresentation';
  import { canBeReusable, describeAnchor, getAnnotationTimes } from '../../utilities/analysisAnnotations';
  import effects from '../../utilities/effects';
  import { formatDate } from '../../utilities/time';
  import { showSuccessToast } from '../../utilities/toast';
  import DataGrid from '../ui/DataGrid/DataGrid.svelte';

  /** 'save': open on saving the current View. */
  export let mode: 'save' | 'use' = 'use';
  export let open: boolean = false;
  /** Names of this analysis's sources, by binding id. */
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{ planView: number }>();

  type Choice = {
    contents: string;
    id: number;
    kind: 'analysis' | 'layout' | 'view';
    name: string;
    owner: string | null;
    updated_at: string;
  };

  /** Where a View was saved: that decides how its layers find their data (a Plan's view reads a plan's). */
  const KIND_LABELS: Record<Choice['kind'], string> = {
    analysis: 'Another analysis',
    layout: 'Analysis',
    view: 'Plan',
  };

  const columnDefs: DataGridColumnDef<Choice>[] = [
    {
      field: 'name',
      filter: 'text',
      headerName: 'Name',
      resizable: true,
      sortable: true,
      tooltipField: 'name',
      width: 260,
    },
    {
      field: 'contents',
      headerName: 'Shows',
      resizable: true,
      tooltipField: 'contents',
    },
    {
      field: 'kind',
      headerName: 'Saved in',
      resizable: true,
      sortable: true,
      valueFormatter: ({ value }: { value: Choice['kind'] }) => KIND_LABELS[value],
      width: 110,
    },
    { field: 'owner', filter: 'text', headerName: 'Owner', resizable: true, sortable: true, width: 110 },
    {
      field: 'updated_at',
      headerName: 'Last Edited',
      resizable: true,
      sort: 'desc',
      sortable: true,
      valueFormatter: ({ value }: { value: string | null }) => (value ? value.slice(0, 10) : ''),
      width: 110,
    },
  ];

  let filter: string = '';
  /** What each View shows (by grid row id), read when the picker opens. */
  let contents: Record<string, string> | null = null;
  let annotationsOpen: boolean = false;
  /** By getFocusKey: whether the target has a focused layer's records, and the records of that name it has. */
  let focusChecks: Record<string, boolean> = {};
  let focusCandidates: Record<string, SourceActivityLink[]> = {};
  let focusChoices: Record<string, string> = {};
  let bringAnnotations: boolean = true;
  /** The annotations to save with the layout, by id; null until the save form opens. */
  let layoutAnnotations: Set<number> | null = null;
  let loaded: AnalysisPresentation | null = null;
  let loading: boolean = false;
  let mapping: RoleMapping = {};
  let resourceRenames: Record<string, string> = {};
  let saveName: string = '';
  let saving: boolean | null = null;
  let selectedId: RowId | null = null;
  let showDetails: boolean = false;
  /** Set when a View is chosen: used at once if nothing needs deciding. */
  let pendingImmediate: boolean = false;

  $: if (!open) {
    reset();
  } else if (mode === 'save' && saving === null && !loaded) {
    saving = false;
  }
  $: if (open && contents === null) {
    loadContents();
  }

  async function loadContents() {
    contents = {};
    const summaries = await effects.getViewSummaries(user);
    contents = Object.fromEntries([
      ...summaries.views.map(({ id, rows, sources }) => [`view:${id}`, describeViewContents(rows, sources)]),
      ...summaries.analyses.map(({ id, rows }) => [`analysis:${id}`, describeViewContents(rows, null)]),
    ]);
  }
  $: targets = $analysisSourceBindings;
  $: targetCatalogs = Object.fromEntries(
    targets.map(binding => [
      binding.id,
      getSourceCatalog(
        binding,
        $analysisSourceRevisions,
        $analysisSimulationDatasets,
        $analysisSimulationTypeCounts,
        binding.kind === 'plan' ? ($analysisPlans ?? []).find(({ id }) => id === binding.planId) : undefined,
        binding.kind === 'plan'
          ? [...new Set(($analysisPlanExternalEvents[binding.planId] ?? []).map(event => event.event_type_name))]
          : [],
      ),
    ]),
  );
  $: current = $view?.definition.plan.timelines[0];
  $: roles = loaded ? getPresentationRoles(loaded.timeline, loaded.bindings) : [];
  $: result =
    loaded && current
      ? applyPresentation(loaded.timeline, current, loaded.catalogs, targetCatalogs, sourceLabels, {
          focusChecks,
          focusChoices,
          mapping,
          resourceRenames,
        })
      : null;
  $: replaceable = uniqueMissing(result?.issues ?? []);
  $: missingFocuses = [
    ...new Map(
      (result?.issues ?? []).flatMap(({ missingFocus }) => (missingFocus ? [[missingFocus.key, missingFocus]] : [])),
    ).values(),
  ];
  $: checkFocuses(loaded, mapping);

  /**
   * Reads, for each focused layer, whether its target has the records it focused on (by their keys), and which of the
   * target's records have the same name, to offer (never to pick).
   */
  async function checkFocuses(from: AnalysisPresentation | null, roles: RoleMapping) {
    if (!from) {
      return;
    }
    for (const { name, roleId, within } of getFocusedLayers(from.timeline)) {
      const targetId = roles[roleId];
      const target = targets.find(({ id }) => id === targetId);
      if (!targetId || !target) {
        continue;
      }
      const key = getFocusKey(targetId, within);
      if (focusChecks[key] !== undefined) {
        continue;
      }
      if (target.kind !== 'imported') {
        // Only an imported source's records have keys: a focus can't be in a plan or a simulation.
        focusChecks = { ...focusChecks, [key]: false };
        continue;
      }
      const [found, named] = await Promise.all([
        effects.getSourceActivityLinks(target.revisionId, { keys: within }, within.length, user),
        effects.getSourceActivityLinks(target.revisionId, { names: [name] }, 20, user),
      ]);
      focusCandidates = { ...focusCandidates, [key]: named };
      focusChecks = { ...focusChecks, [key]: found.length === within.length };
    }
  }
  $: rowStatuses = loaded && result ? getRowStatuses(loaded, result.issues) : [];
  $: counts = {
    attention: rowStatuses.filter(row => row.status === 'attention').length,
    ready: rowStatuses.filter(row => row.status === 'ready').length,
    unavailable: rowStatuses.filter(row => row.status === 'unavailable').length,
  };
  $: choices = [
    ...$views.map(
      ({ analysis_layout, id, name, owner, updated_at }): Choice => ({
        contents: contents?.[`view:${id}`] ?? '',
        id,
        kind: analysis_layout ? 'layout' : 'view',
        name,
        owner,
        updated_at,
      }),
    ),
    ...($analyses ?? [])
      .filter(({ id }) => id !== $analysis?.id)
      .map(
        ({ id, name, owner, updated_at }): Choice => ({
          contents: contents?.[`analysis:${id}`] ?? '',
          id,
          kind: 'analysis',
          name,
          owner,
          updated_at,
        }),
      ),
  ];
  // What the View brings: the time and value marks saved with it, never another analysis's findings.
  $: reusableCount = loaded?.timeline.annotations.filter(({ reusable }) => reusable).length ?? 0;
  $: currentRows = current?.rows.length ?? 0;
  // Marks that can be saved with a View (a time, a range, a value): none is included unless chosen, except those that
  // came with the View in use (they are its own).
  $: markChoices = (current?.annotations ?? []).filter(canBeReusable);
  $: if (saving !== null && layoutAnnotations === null) {
    layoutAnnotations = new Set(markChoices.filter(({ reusable }) => reusable).map(({ id }) => id));
  }
  // Nothing to decide: every source it was saved with is here, as the same data, and every row is ready.
  // (A focused row's records are checked asynchronously: such a View always shows its step.)
  $: immediate =
    !!loaded &&
    !!result &&
    roles.every(role => {
      const target = targets.find(({ id }) => id === mapping[role.sourceId]);
      return !!target && getRoleMatch(role, target) === 'same';
    }) &&
    result.issues.length === 0 &&
    getFocusedLayers(loaded.timeline).length === 0;
  $: if (pendingImmediate && result) {
    pendingImmediate = false;
    if (immediate) {
      apply();
    }
  }

  type RowStatus = { id: number; name: string; notes: string[]; status: 'attention' | 'ready' | 'unavailable' };

  /** Each row of the layout: ready, shown with something to look at, or not shown at all. */
  function getRowStatuses(from: AnalysisPresentation, issues: PresentationIssue[]): RowStatus[] {
    return from.timeline.rows
      .filter(row => row.layers.length)
      .map(row => {
        const own = issues.filter(issue => issue.rowId === row.id);
        const left = own.filter(issue => issue.effect === 'omitted').length;
        return {
          id: row.id,
          name: row.name,
          notes: [
            ...new Set(own.map(issue => (row.layers.length > 1 ? `${issue.layer}: ${issue.reason}` : issue.reason))),
          ],
          status: left === row.layers.length ? 'unavailable' : own.length ? 'attention' : 'ready',
        };
      });
  }

  /** The grid's row id: views and analyses share numbers, so the kind is part of it. */
  function getChoiceId(choice: Choice): RowId {
    return `${choice.kind === 'analysis' ? 'analysis' : 'view'}:${choice.id}`;
  }

  function reset() {
    filter = '';
    bringAnnotations = true;
    focusCandidates = {};
    focusChecks = {};
    focusChoices = {};
    loaded = null;
    loading = false;
    mapping = {};
    resourceRenames = {};
    saveName = '';
    saving = null;
    layoutAnnotations = null;
    annotationsOpen = false;
    pendingImmediate = false;
    selectedId = null;
    showDetails = false;
    contents = null;
  }

  /** Resources the person can replace: missing ones, and ones of another type, each once. */
  function uniqueMissing(issues: PresentationIssue[]) {
    const seen = new Map<string, NonNullable<PresentationIssue['missingResource']>>();
    issues.forEach(({ missingResource }) => {
      if (missingResource) {
        seen.set(getResourceRenameKey(missingResource.roleId, missingResource.name), missingResource);
      }
    });
    return [...seen.entries()].map(([key, resource]) => ({ key, ...resource }));
  }

  /** Resources of the mapped target that could stand in for a missing one: the same value type only. */
  function renameOptions(roleId: string, type: string | null): string[] {
    const target = mapping[roleId];
    const resources = target ? targetCatalogs[target]?.resources : null;
    return resources
      ? [...resources.entries()]
          .filter(([, r]) => type === null || r.type === type)
          .map(([name]) => name)
          .sort()
      : [];
  }

  /** What the chosen source is to the layout's: said, so another revision is never silently taken as the same data. */
  function matchNote(roleId: string): string {
    const targetId = mapping[roleId];
    const role = roles.find(({ sourceId }) => sourceId === roleId);
    const target = targets.find(({ id }) => id === targetId);
    if (!role || !target) {
      return 'not shown';
    }
    const match = getRoleMatch(role, target);
    if (match === 'same') {
      return 'same data';
    }
    if (match === 'revision' && role.binding?.kind === 'imported' && target.kind === 'imported') {
      return `another revision (${target.revisionId > role.binding.revisionId ? 'newer' : 'older'})`;
    }
    return 'your choice';
  }

  async function choose(id: RowId | null) {
    if (id === null || loading) {
      return;
    }
    const [kind, number] = `${id}`.split(':');
    loading = true;
    const read =
      kind === 'view'
        ? await readViewPresentation(Number(number), user)
        : await readAnalysisPresentation(Number(number), user);
    loading = false;
    if (read === 'plan-view') {
      open = false;
      dispatch('planView', Number(number));
    } else if (read) {
      loaded = read;
      mapping = getInitialRoleMapping(getPresentationRoles(read.timeline, read.bindings), targets);
      resourceRenames = {};
      pendingImmediate = true;
    }
  }

  function formatAnnotationTime(startMs: number, endMs?: number): string {
    const format = (ms: number) => formatDate(new Date(ms), $plugins.time.primary.format);
    return endMs !== undefined && endMs !== startMs ? `${format(startMs)} – ${format(endMs)}` : format(startMs);
  }

  async function save() {
    saving = true;
    const id = await saveAnalysisLayoutAsView(saveName.trim(), user, layoutAnnotations ?? new Set());
    saving = null;
    if (id !== null) {
      open = false;
    }
  }

  function apply() {
    if (
      loaded &&
      result &&
      replaceAnalysisTimeline(result.timeline, user, loaded.name, { bringAnnotations, dataless: result.total === 0 })
    ) {
      const left = result.total - result.kept;
      showSuccessToast(`Using View "${loaded.name}"${left ? `; ${left} layer${left === 1 ? '' : 's'} left out` : ''}`);
      open = false;
      // Also when used at once from a reactive statement, where the `!open` reset has already run this tick.
      reset();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[88vh] max-w-[920px] flex-col gap-3">
    {#if saving !== null}
      <Dialog.Header>
        <Dialog.Title>Save View</Dialog.Title>
        <Dialog.Description>Save the current timeline arrangement to reuse in other analyses.</Dialog.Description>
      </Dialog.Header>
      <div class="flex flex-col gap-1 text-xs">
        <label for="save-view-name">Name</label>
        <Input
          id="save-view-name"
          placeholder="e.g. DSN contact review"
          aria-label="View name"
          sizeVariant="xs"
          bind:value={saveName}
          on:keydown={event => event.key === 'Enter' && saveName.trim() && save()}
        />
      </div>
      {#if markChoices.length && layoutAnnotations}
        {@const chosen = layoutAnnotations}
        <div class="text-xs">
          <button
            class="flex items-center gap-1 text-muted-foreground"
            aria-expanded={annotationsOpen}
            on:click={() => (annotationsOpen = !annotationsOpen)}
          >
            {#if annotationsOpen}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
            Include annotations…{chosen.size ? ` (${chosen.size} included)` : ''}
          </button>
          {#if annotationsOpen}
            <fieldset class="mt-1 flex max-h-[220px] flex-col gap-1 overflow-auto pl-4">
              <legend class="mb-1 text-muted-foreground">
                Time and value marks that make sense over other data (limits, reference times). Findings and notes on
                records stay with this analysis.
              </legend>
              {#each markChoices as item (item.id)}
                {@const times = getAnnotationTimes(item)}
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={chosen.has(item.id)}
                    on:change={event => {
                      const next = new Set(chosen);
                      if (event.currentTarget.checked) {
                        next.add(item.id);
                      } else {
                        next.delete(item.id);
                      }
                      layoutAnnotations = next;
                    }}
                  />
                  <span class="min-w-0 truncate">
                    {#if item.label}<span class="font-medium">{item.label}</span> ·{/if}
                    <span class="text-muted-foreground"
                      >{describeAnchor(item)}{times.startMs !== undefined
                        ? ` · ${formatAnnotationTime(times.startMs, times.endMs)}`
                        : ''}</span
                    >
                  </span>
                </label>
              {/each}
            </fieldset>
          {/if}
        </div>
      {/if}
      <Dialog.Footer>
        {#if mode === 'use'}
          <Button variant="outline" on:click={() => (saving = null)}>Back</Button>
        {:else}
          <Button variant="outline" on:click={() => (open = false)}>Cancel</Button>
        {/if}
        <Button disabled={!saveName.trim() || saving} on:click={save}>{saving ? 'Saving…' : 'Save View'}</Button>
      </Dialog.Footer>
    {:else if !loaded}
      <Dialog.Header>
        <Dialog.Title>Use a View</Dialog.Title>
        <Dialog.Description>
          Show this analysis's data with a saved View. It replaces the current View (you can undo it); the analysis's
          sources and its own annotations stay.
        </Dialog.Description>
      </Dialog.Header>
      <Input bind:value={filter} placeholder="Filter Views" aria-label="Filter Views" sizeVariant="xs" />
      <!-- Enter on the grid does what Next does (Space or a click selects a row). -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="h-[300px]" on:keydown={event => event.key === 'Enter' && choose(selectedId)}>
        <DataGrid
          bind:currentSelectedRowId={selectedId}
          {columnDefs}
          filterExpression={filter}
          loading={$initialViewsLoading}
          getRowId={getChoiceId}
          rowData={choices}
          rowSelection="single"
          noRowsOverlayText="No saved Views"
          on:rowDoubleClicked={({ detail: { data } }) => choose(getChoiceId(data))}
        />
      </div>
      <Dialog.Footer class="sm:justify-between">
        <Button variant="ghost" disabled={!currentRows} on:click={() => (saving = false)}>Save Current View…</Button>
        <div class="flex gap-2">
          <Button variant="outline" on:click={() => (open = false)}>Cancel</Button>
          <Button disabled={selectedId === null || loading} on:click={() => choose(selectedId)}>
            {loading ? 'Reading…' : 'Use View'}
          </Button>
        </div>
      </Dialog.Footer>
    {:else if result}
      <Dialog.Header>
        <Dialog.Title>Use View “{loaded.name}”</Dialog.Title>
        <Dialog.Description>Choose which data to show in this View. The saved View is not changed.</Dialog.Description>
      </Dialog.Header>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto text-xs">
        <section aria-label="Data to show">
          {#each roles as role (role.sourceId)}
            {@const note = matchNote(role.sourceId)}
            <label class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-0.5">
              <span class="truncate" title={loaded.names[role.sourceId]}>
                {loaded.names[role.sourceId] ?? 'A source no longer available'}
              </span>
              <span class="text-muted-foreground">→</span>
              <span class="flex min-w-0 flex-col">
                <select
                  class="st-select w-full"
                  value={mapping[role.sourceId] ?? ''}
                  on:change={event => (mapping = { ...mapping, [role.sourceId]: event.currentTarget.value || null })}
                >
                  <option value="">Don't show</option>
                  {#each targets as target (target.id)}
                    <option value={target.id}>{sourceLabels[target.id] ?? target.id}</option>
                  {/each}
                </select>
                <span class:text-amber-700={note.startsWith('another')} class="text-muted-foreground">{note}</span>
              </span>
            </label>
          {/each}
        </section>

        <section aria-label="What will show" class="rounded border p-2">
          <div class="flex items-center gap-2">
            <span class="font-medium">
              {counts.ready} row{counts.ready === 1 ? '' : 's'} ready{' '}{#if counts.attention}
                <span class="text-amber-700">
                  · {counts.attention} need{counts.attention === 1 ? 's' : ''} attention</span
                >
              {/if}{#if counts.unavailable}
                <span class="text-muted-foreground"> · {counts.unavailable} unavailable</span>
              {/if}
            </span>
            <span class="grow" />
            {#if counts.attention || counts.unavailable}
              <button class="text-[var(--st-utility-blue)]" on:click={() => (showDetails = !showDetails)}>
                {showDetails ? 'Hide' : 'Show'} details
              </button>
            {/if}
          </div>
          {#if showDetails}
            <ul class="mt-1 flex flex-col">
              {#each rowStatuses.filter(row => row.status !== 'ready') as row (row.id)}
                <li class="border-t py-1">
                  <span class:text-muted-foreground={row.status === 'unavailable'} class="font-medium">{row.name}</span>
                  <span class="text-muted-foreground">{row.status === 'unavailable' ? ' · not shown' : ''}</span>
                  {#each row.notes as note}
                    <div class="text-muted-foreground">{note}</div>
                  {/each}
                </li>
              {/each}
            </ul>
          {/if}
          {#each missingFocuses as missing (missing.key)}
            <label class="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <span class="truncate" title="The record this row focused on isn't in {sourceLabels[missing.targetId]}"
                >{missing.name} isn't in {sourceLabels[missing.targetId] ?? 'the source'}</span
              >
              <span class="text-muted-foreground">→</span>
              <select
                class="st-select w-full"
                value={focusChoices[missing.key] ?? 'omit'}
                on:change={event => {
                  const { [missing.key]: _, ...rest } = focusChoices;
                  focusChoices =
                    event.currentTarget.value === 'omit' ? rest : { ...rest, [missing.key]: event.currentTarget.value };
                }}
              >
                <option value="omit">Leave the row out</option>
                <option value="">Clear the focus (show every record of its types)</option>
                {#each focusCandidates[missing.key] ?? [] as candidate (candidate.id)}
                  <option value={candidate.source_key}
                    >Focus on {candidate.name} ({candidate.start_time.slice(0, 16).replace('T', ' ')})</option
                  >
                {/each}
              </select>
            </label>
          {/each}
          {#each replaceable as missing (missing.key)}
            {@const options = renameOptions(missing.roleId, missing.type)}
            {#if options.length}
              <label class="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <span class="truncate" title={missing.name}>{missing.name} isn't available</span>
                <span class="text-muted-foreground">→</span>
                <select
                  class="st-select w-full"
                  value={resourceRenames[missing.key] ?? ''}
                  on:change={event => {
                    const { [missing.key]: _, ...rest } = resourceRenames;
                    resourceRenames = event.currentTarget.value
                      ? { ...rest, [missing.key]: event.currentTarget.value }
                      : rest;
                  }}
                >
                  <option value="">Leave it out</option>
                  {#each options as name}
                    <option value={name}>Use {name}</option>
                  {/each}
                </select>
              </label>
            {/if}
          {/each}
        </section>

        {#if reusableCount}
          <label class="flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" bind:checked={bringAnnotations} />
            Include its {reusableCount} saved mark{reusableCount === 1 ? '' : 's'} (limits, reference times)
          </label>
        {/if}
      </div>
      <div class="text-xs text-muted-foreground" role="note">
        {#if currentRows}
          Replaces this analysis's {currentRows} row{currentRows === 1 ? '' : 's'}; you can undo it.
        {/if}
        This analysis keeps its sources and its own annotations; marks that came with the current View are replaced.{loaded.kind ===
        'analysis'
          ? ` The findings of "${loaded.name}" stay there.`
          : ''}
      </div>
      <Dialog.Footer>
        <Button variant="outline" on:click={() => (loaded = null)}>Back</Button>
        <!-- A layout with no data layers (rows, sections, guides only) is used as it is. -->
        <Button disabled={result.total > 0 && result.kept === 0} on:click={apply}>
          {currentRows ? `Replace Current View (${result.timeline.rows.length} rows)` : 'Use View'}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
