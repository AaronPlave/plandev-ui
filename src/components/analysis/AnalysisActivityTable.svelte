<svelte:options immutable={true} />

<!--
  Every activity of the analysis's sources, in start order. Rows are filtered, sorted and paged by the database
  (merlin.analysis_activity) and rendered by AG Grid's infinite row model, so only the rows on screen exist.
-->
<script lang="ts">
  import { createGrid, type ColDef, type GridApi, type IDatasource, type RowClassParams } from 'ag-grid-community';
  import { debounce } from 'lodash-es';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { plugins } from '../../stores/plugins';
  import type { AnalysisActivityRef, AnalysisActivityRow, AnalysisSourceBinding } from '../../types/analysis';
  import type { User } from '../../types/app';
  import {
    analysisActivityRefsEqual,
    getAnalysisActivitiesBeforeWhere,
    getAnalysisActivityOrderBy,
    getAnalysisActivityRowRef,
    getAnalysisActivityWhere,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { convertUsToDurationString, formatDate } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let sourceLabels: Record<string, string> = {};
  export let typeOptions: string[] = [];
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    select: { endMs: number; ref: AnalysisActivityRef; startMs: number };
  }>();

  const PAGE_SIZE = 200;

  let gridDiv: HTMLDivElement;
  let gridApi: GridApi<AnalysisActivityRow> | null = null;
  let textInput: string = '';
  let text: string = '';
  let sourceId: string = '';
  let typeInput: string = '';
  let direction: 'asc' | 'desc' = 'asc';
  let total: number | null = null;
  let version = 0;
  /** The selection this table just made itself, until it arrives back as `selected`: it needs no scrolling to. */
  let clicked: AnalysisActivityRef | null = null;

  const setText = debounce((value: string) => (text = value), 300);
  $: setText(textInput);
  // A type filter applies once it names a type; anything else typed matches every type.
  $: type = typeOptions.includes(typeInput) ? typeInput : '';
  $: where = getAnalysisActivityWhere(bindings, {
    sourceIds: sourceId ? [sourceId] : null,
    text,
    types: type ? [type] : null,
  });
  $: if (gridApi) {
    gridApi.setGridOption('datasource', createDatasource(where));
  }
  $: selectedKey = selected ? `${selected.sourceId}::${selected.activityId}` : null;
  $: redrawSelection(gridApi, selectedKey);
  $: onSelected(gridApi, selected, where);

  function onSelected(
    api: GridApi<AnalysisActivityRow> | null,
    ref: AnalysisActivityRef | null,
    currentWhere: Record<string, unknown>,
  ) {
    // One-shot: whatever selection arrives next, a later one of the same activity (from the timeline) is revealed.
    const fromThisTable = analysisActivityRefsEqual(ref, clicked);
    clicked = null;
    if (api && ref && !fromThisTable) {
      reveal(ref, currentWhere);
    }
  }

  function redrawSelection(api: GridApi<AnalysisActivityRow> | null, _key: string | null) {
    api?.redrawRows();
  }

  function getRef(row: AnalysisActivityRow): AnalysisActivityRef | null {
    return getAnalysisActivityRowRef(bindings, row);
  }

  function createDatasource(currentWhere: Record<string, unknown>): IDatasource {
    const id = ++version;
    total = null;
    return {
      getRows: async params => {
        direction = params.sortModel[0]?.sort === 'desc' ? 'desc' : 'asc';
        const limit = params.endRow - params.startRow;
        try {
          const [rows, count] = await Promise.all([
            effects.getAnalysisActivities(
              currentWhere,
              getAnalysisActivityOrderBy(direction),
              params.startRow,
              limit,
              user,
            ),
            params.startRow === 0 ? effects.getAnalysisActivityCount(currentWhere, user) : Promise.resolve(null),
          ]);
          if (id !== version) {
            params.failCallback();
            return;
          }
          if (count !== null) {
            total = count;
          }
          params.successCallback(rows, total ?? (rows.length < limit ? params.startRow + rows.length : -1));
        } catch {
          params.failCallback();
        }
      },
    };
  }

  /** Scrolls to an activity selected elsewhere (the timeline), if the table's filters include it. */
  async function reveal(ref: AnalysisActivityRef, currentWhere: Record<string, unknown>) {
    const binding = bindings.find(b => b.id === ref.sourceId);
    if (!binding) {
      return;
    }
    const identity =
      binding.kind === 'imported'
        ? { source_kind: { _eq: 'revision' }, source_ref: { _eq: binding.revisionId } }
        : { source_kind: { _eq: 'simulation' }, source_ref: { _eq: binding.simulationDatasetId } };
    const [row] = await effects.getAnalysisActivities(
      { _and: [currentWhere, identity, { activity_id: { _eq: ref.activityId } }] },
      getAnalysisActivityOrderBy(direction),
      0,
      1,
      user,
    );
    if (!row || !analysisActivityRefsEqual(selected, ref)) {
      return;
    }
    const index = await effects.getAnalysisActivityCount(
      { _and: [currentWhere, getAnalysisActivitiesBeforeWhere(row, direction)] },
      user,
    );
    if (analysisActivityRefsEqual(selected, ref)) {
      gridApi?.ensureIndexVisible(index, 'middle');
    }
  }

  const columnDefs: ColDef<AnalysisActivityRow>[] = [
    {
      field: 'start_time',
      headerName: 'Start',
      sort: 'asc',
      sortable: true,
      valueFormatter: ({ value }) => (value ? formatDate(new Date(value), $plugins.time.primary.format) : ''),
      width: 190,
    },
    {
      colId: 'duration',
      headerName: 'Duration',
      sortable: false,
      valueGetter: ({ data }) =>
        data ? convertUsToDurationString((Date.parse(data.end_time) - Date.parse(data.start_time)) * 1000) || '0s' : '',
      width: 110,
    },
    {
      colId: 'source',
      headerName: 'Source',
      sortable: false,
      valueGetter: ({ data }) => {
        const ref = data ? getRef(data) : null;
        return ref ? (sourceLabels[ref.sourceId] ?? ref.sourceId) : '';
      },
      width: 200,
    },
    { field: 'type', headerName: 'Type', sortable: false, width: 220 },
    { field: 'name', flex: 1, headerName: 'Name', minWidth: 160, sortable: false },
    { field: 'category', headerName: 'Subsystem', sortable: false, width: 120 },
  ];

  onMount(() => {
    gridApi = createGrid<AnalysisActivityRow>(gridDiv, {
      cacheBlockSize: PAGE_SIZE,
      columnDefs,
      getRowId: ({ data }) => `${data.source_kind}:${data.source_ref}:${data.activity_id}`,
      headerHeight: 28,
      maxBlocksInCache: 50,
      onRowClicked: ({ data }) => {
        const ref = data ? getRef(data) : null;
        if (data && ref) {
          clicked = ref;
          dispatch('select', { endMs: Date.parse(data.end_time), ref, startMs: Date.parse(data.start_time) });
        }
      },
      rowClassRules: {
        'analysis-activity-selected': (params: RowClassParams<AnalysisActivityRow>) => {
          const ref = params.data ? getRef(params.data) : null;
          return !!ref && `${ref.sourceId}::${ref.activityId}` === selectedKey;
        },
      },
      rowHeight: 26,
      rowModelType: 'infinite',
    });
  });

  onDestroy(() => {
    setText.cancel();
    gridApi?.destroy();
  });
</script>

<div class="analysis-activity-table">
  <div class="filters">
    <input
      bind:value={textInput}
      class="st-input"
      aria-label="Filter activities by name or type"
      placeholder="Filter by name or type"
    />
    <select bind:value={sourceId} class="st-select" aria-label="Source">
      <option value="">All sources</option>
      {#each bindings as binding (binding.id)}
        <option value={binding.id}>{sourceLabels[binding.id] ?? binding.id}</option>
      {/each}
    </select>
    <input
      bind:value={typeInput}
      class="st-input"
      list="analysis-activity-types"
      aria-label="Type"
      placeholder="All types"
    />
    <datalist id="analysis-activity-types">
      {#each typeOptions as option}
        <option value={option} />
      {/each}
    </datalist>
    <span class="count st-typography-label" aria-live="polite">
      {total === null ? 'Loading…' : `${total.toLocaleString()} activit${total === 1 ? 'y' : 'ies'}`}
    </span>
  </div>
  <div bind:this={gridDiv} class="ag-theme-stellar activity-grid" role="grid" aria-label="Activities" />
</div>

<style>
  .analysis-activity-table {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .filters {
    align-items: center;
    display: flex;
    gap: 8px;
    padding: 6px 8px;
  }

  .filters .st-input:first-child {
    flex: 1;
  }

  .count {
    color: var(--st-gray-60);
    white-space: nowrap;
  }

  .activity-grid {
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  :global(.analysis-activity-table .ag-row.analysis-activity-selected) {
    background-color: var(--st-utility-blue-10, rgba(47, 128, 237, 0.16));
  }
</style>
