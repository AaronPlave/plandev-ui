<svelte:options immutable={true} />

<!--
  The Analysis's time cursor inspector: the Plan's TimeCursorPanel (cursor A, comparison cursor B, resource rows with
  A / B / Δ), fed from the analysis's sources instead of a plan's stores. This component only reads the data.

  Resources: the ones the timeline's rows plot and the ones watched here (any resource of a bound source, with no row
  needed), each read at the cursor from its own source (a resource is its source plus its name) and labelled for what
  the value is (recorded sample, held, interpolated, computed, unavailable). Imported resources are read with one exact,
  one-instant query per revision, never from the display data the rows hold (thinned to the screen), which only draws
  the row's sparkline. Simulation resources are read off the profile the timeline's registry holds, which a watched one
  subscribes to itself; they appear as soon as it has loaded.

  Activities: those of each source that overlap the cursor, asked of the database (never loaded whole): the first few
  per source and how many there are in all.

  Nothing is read while a cursor is being dragged: the queries run once it has settled. What was read is only ever shown
  for the instant and the sources it was read for: while a new read is on its way the rows say so.
-->
<script lang="ts">
  import { debounce } from 'lodash-es';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import {
    analysisMaxTimeRange,
    analysisSimulationDatasets,
    analysisSourceRevisions,
    analysisTimelineSources,
    analysisWatchedResources,
  } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { getTimelineResourceState, timelineResources } from '../../stores/timelineResourceStatus';
  import { view, viewAddFilterToRow } from '../../stores/views';
  import type {
    AnalysisActivityRef,
    AnalysisActivityRow,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { Row, TimeRange } from '../../types/timeline';
  import type { TimelineResourceSubscription, TimelineSourceRegistry } from '../../types/timelineSource';
  import {
    MAX_INSPECTED_RESOURCES,
    getAnalysisResourceRows,
    getCurrentSnapshot,
    getInspectedResources,
    getInstantQuery,
    getResourceCatalog,
    getResourceKey,
    getResourceOptions,
    getUnavailableResourceSources,
    readImportedResources,
    resolveResource,
    type AnalysisCursorData,
    type AtTimeSnapshot,
    type AtTimeValue,
    type InspectedResource,
    type ResourceCatalogEntry,
  } from '../../utilities/analysisAtTime';
  import {
    getAnalysisActivityOrderBy,
    getAnalysisActivityRowRef,
    getAnalysisActivityWhere,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { getSource } from '../../utilities/timelineSources';
  import { formatDate } from '../../utilities/time';
  import TimeCursorPanel from '../timeline/TimeCursorPanel.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  /** The analysis can't be edited: resources can still be watched, but not added to the timeline. */
  export let readOnly: boolean = false;
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    reveal: number;
    selectActivity: { endMs: number; ref: AnalysisActivityRef; startMs: number };
  }>();

  /** Activities listed per source; the rest are counted. */
  const ACTIVITIES_PER_SOURCE = 20;
  /** Resources per request: the gateway accepts up to 200. */
  const RESOURCES_PER_REQUEST = 100;
  /** How long the pinned time must be still before anything is read. */
  const SETTLE_MS = 250;

  type ActivityListing = { rows: AnalysisActivityRow[]; sourceId: string; total: number };
  /** Everything read at one instant: the imported resources (by key) and the activities. */
  type Snapshot = { error: string; listings: ActivityListing[]; readings: Map<string, AtTimeValue> };
  /** What a read was asked, captured when it was scheduled. */
  type ReadConfig = {
    bindings: AnalysisSourceBinding[];
    datasets: AnalysisSimulationDataset[];
    key: string;
    revisions: AnalysisSourceRevision[];
    specs: InspectedResource[];
  };

  /** What the time cursor (A) and, in comparison, the second cursor (B) were read as; they lag the cursors while those move. */
  let a: AtTimeSnapshot<Snapshot> | null = null;
  let b: AtTimeSnapshot<Snapshot> | null = null;
  let error: string = '';
  let request = 0;
  /** The simulation profiles being held for the resources inspected, by dataset and name. */
  const simulationSubscriptions = new Map<string, TimelineResourceSubscription>();

  $: timeline = $view?.definition.plan.timelines[0];
  $: inspected = getInspectedResources(timeline, $analysisWatchedResources);
  $: readable = inspected.slice(0, MAX_INSPECTED_RESOURCES);
  // The rows change often (heights, selection); only the set of resources, the sources and the time matter.
  $: inspectedKey = readable.map(({ name, sourceId }) => getResourceKey(sourceId, name)).join('|');
  $: bindingsKey = bindings.map(binding => JSON.stringify(binding)).join('|');
  $: dataKey = [
    ...$analysisSourceRevisions.map(({ id, status }) => `r${id}:${status}`),
    ...$analysisSimulationDatasets.map(({ id, status }) => `s${id}:${status}`),
  ].join('|');
  $: configKey = [inspectedKey, bindingsKey, dataKey].join('#');
  $: schedule($timeCursorMs, $timeCursorCompareMs, configKey);
  $: syncSimulationSubscriptions(
    readable,
    bindings,
    $analysisSourceRevisions,
    $analysisSimulationDatasets,
    $analysisTimelineSources,
    user,
  );

  // Only what was read for these instants and these sources counts: anything else is old.
  $: currentA = getCurrentSnapshot(a, $timeCursorMs, configKey);
  $: currentB = getCurrentSnapshot(b, $timeCursorCompareMs, configKey);
  $: pending = $timeCursorMs !== null && !error && (!currentA || ($timeCursorCompareMs !== null && !currentB));

  $: catalog = getResourceCatalog($analysisTimelineSources.sources);
  $: resourceOptions = getResourceOptions(catalog);
  // Everything the panel shows is passed in: a value read inside the function would not be tracked.
  $: cursorData = getCursorData({
    bindings,
    bounds: $analysisMaxTimeRange,
    catalog,
    compareMs: $timeCursorCompareMs,
    cursorMs: $timeCursorMs,
    datasets: $analysisSimulationDatasets,
    error,
    first: currentA,
    inspectedCount: inspected.length,
    labels: sourceLabels,
    pending,
    readOnly,
    registry: $analysisTimelineSources,
    // The registry changes as profiles load: the simulation readings follow it.
    registryChanged: $timelineResources,
    resourceOptions,
    revisions: $analysisSourceRevisions,
    rows: timeline?.rows ?? [],
    second: currentB,
    specs: readable,
    timeFormat: $plugins.time.primary.format,
    watched: $analysisWatchedResources,
  });

  const run = debounce(read, SETTLE_MS);

  function schedule(time: number | null, compareTime: number | null, key: string) {
    // Whatever was being read is for something else now.
    request++;
    error = '';
    if (time === null) {
      run.cancel();
      a = null;
      b = null;
      return;
    }
    run(time, compareTime, {
      bindings,
      datasets: $analysisSimulationDatasets,
      key,
      revisions: $analysisSourceRevisions,
      specs: readable,
    });
  }

  onDestroy(() => {
    run.cancel();
    request++;
    simulationSubscriptions.forEach(subscription => subscription.unsubscribe());
    simulationSubscriptions.clear();
  });

  /**
   * Holds a profile subscription for each simulation resource inspected (the timeline's registry shares them with the
   * rows that plot the same one), and lets go of the others. The registry changing is what updates the readings.
   */
  function syncSimulationSubscriptions(
    specs: InspectedResource[],
    currentBindings: AnalysisSourceBinding[],
    revisions: AnalysisSourceRevision[],
    datasets: AnalysisSimulationDataset[],
    registry: TimelineSourceRegistry,
    currentUser: User | null,
  ) {
    const wanted = new Map<string, InspectedResource>();
    specs.forEach(spec => {
      const target = resolveResource(spec, currentBindings, revisions, datasets);
      if (target.kind === 'simulation') {
        wanted.set(`${target.dataset.dataset_id}::${spec.name}`, spec);
      }
    });
    [...simulationSubscriptions.entries()].forEach(([key, subscription]) => {
      if (!wanted.has(key)) {
        subscription.unsubscribe();
        simulationSubscriptions.delete(key);
      }
    });
    wanted.forEach((spec, key) => {
      const resources = getSource(registry, spec.sourceId)?.resources;
      if (resources && !simulationSubscriptions.has(key)) {
        simulationSubscriptions.set(
          key,
          resources.subscribe(spec.name, { plan: null, simulationDataset: null, user: currentUser }),
        );
      }
    });
  }

  function formatTime(ms: number, format: (date: Date) => string | null): string {
    return formatDate(new Date(ms), format);
  }

  function watchedChanged(keys: string[], entries: ResourceCatalogEntry[]) {
    const known = new Map(entries.map(entry => [entry.key, { name: entry.item.name, sourceId: entry.sourceId }]));
    const watched = new Map(
      $analysisWatchedResources.map(resource => [getResourceKey(resource.sourceId, resource.name), resource]),
    );
    // A resource already watched stays, whether or not its source can be listed now.
    $analysisWatchedResources = keys.flatMap(key => {
      const resource = watched.get(key) ?? known.get(key);
      return resource ? [resource] : [];
    });
  }

  function unwatch(key: string) {
    $analysisWatchedResources = $analysisWatchedResources.filter(
      resource => getResourceKey(resource.sourceId, resource.name) !== key,
    );
  }

  /** The resource's layer, in the row the user picked (or a new one), as the Sources browser adds one. */
  function showOnTimeline(key: string, entries: ResourceCatalogEntry[], row?: Row) {
    const entry = entries.find(candidate => candidate.key === key);
    if (entry) {
      viewAddFilterToRow(
        [entry.item],
        'resource',
        { sourceId: entry.sourceId, sourceLabel: entry.sourceLabel },
        row?.id,
      );
    }
  }

  /** What the cursor panel shows: the resources read, with their display data for the sparkline, and the activities. */
  function getCursorData(input: {
    bindings: AnalysisSourceBinding[];
    bounds: TimeRange;
    catalog: ResourceCatalogEntry[];
    compareMs: number | null;
    cursorMs: number | null;
    datasets: AnalysisSimulationDataset[];
    error: string;
    first: Snapshot | null;
    inspectedCount: number;
    labels: Record<string, string>;
    pending: boolean;
    readOnly: boolean;
    registry: TimelineSourceRegistry;
    registryChanged: unknown;
    resourceOptions: AnalysisCursorData['resourceOptions'];
    revisions: AnalysisSourceRevision[];
    rows: Row[];
    second: Snapshot | null;
    specs: InspectedResource[];
    timeFormat: (date: Date) => string | null;
    watched: { name: string; sourceId: string }[];
  }): AnalysisCursorData {
    const { catalog: entries, compareMs, cursorMs, first, labels, second, timeFormat } = input;
    const groups = [
      { cursor: second ? ('A' as const) : null, snapshot: first, time: cursorMs },
      { cursor: 'B' as const, snapshot: second, time: compareMs },
    ];
    return {
      activities: groups.flatMap(({ cursor, snapshot, time }) =>
        snapshot && time !== null
          ? [
              {
                cursor,
                sources: snapshot.listings.map(listing => ({
                  label: labels[listing.sourceId] ?? listing.sourceId,
                  note:
                    input.bindings.find(({ id }) => id === listing.sourceId)?.kind === 'plan'
                      ? "A plan's directives have no end: only those starting at this instant are listed."
                      : undefined,
                  rows: listing.rows,
                  sourceId: listing.sourceId,
                  total: listing.total,
                })),
                time,
              },
            ]
          : [],
      ),
      bounds: input.bounds,
      error: input.error || first?.error || second?.error || '',
      formatTime: ms => formatTime(ms, timeFormat),
      loading: input.pending,
      omittedResources: Math.max(0, input.inspectedCount - MAX_INSPECTED_RESOURCES),
      onSelectActivity: select,
      onShowOnTimeline: input.readOnly ? null : (key, row) => showOnTimeline(key, entries, row),
      onUnwatch: unwatch,
      onWatchedChange: keys => watchedChanged(keys, entries),
      resourceOptions: input.resourceOptions,
      resources: getAnalysisResourceRows({
        bindings: input.bindings,
        compareMs,
        cursorMs,
        datasets: input.datasets,
        error: input.error,
        getState: getTimelineResourceState,
        labels,
        pending: input.pending,
        readingsA: first?.readings ?? null,
        readingsB: second?.readings ?? null,
        revisions: input.revisions,
        specs: input.specs,
      }),
      resourcesLoading: input.registry.loading,
      rows: input.rows,
      unavailableSources: getUnavailableResourceSources(input.registry.sources),
      watchedKeys: input.watched.map(resource => getResourceKey(resource.sourceId, resource.name)),
    };
  }

  async function readActivities(time: number, sourceBindings: AnalysisSourceBinding[]): Promise<ActivityListing[]> {
    const instant = { end: time, start: time };
    return Promise.all(
      sourceBindings.map(async binding => {
        const where = getAnalysisActivityWhere(sourceBindings, {
          sourceIds: [binding.id],
          text: '',
          timeRange: instant,
          types: null,
        });
        const [rows, total] = await Promise.all([
          effects.getAnalysisActivities(where, getAnalysisActivityOrderBy('desc'), 0, ACTIVITIES_PER_SOURCE, user),
          effects.getAnalysisActivityCount(where, user),
        ]);
        return { rows, sourceId: binding.id, total };
      }),
    );
  }

  async function readAt(time: number, config: ReadConfig): Promise<Snapshot> {
    const items = config.specs.flatMap(spec => {
      const target = resolveResource(spec, config.bindings, config.revisions, config.datasets);
      return target.kind === 'imported' ? [{ definition: target.definition, revision: target.revision, spec }] : [];
    });
    // The resources and the activities are read apart: one failing leaves the other readable.
    const [readings, listings] = await Promise.all([
      readImportedResources(
        time,
        items,
        async (revisionId, names) =>
          (await effects.querySourceResources({ revisionId }, names, getInstantQuery(time), user)).results,
        RESOURCES_PER_REQUEST,
      ),
      readActivities(time, config.bindings).then(
        value => ({ error: '', value }),
        (e: Error) => ({ error: e.message || 'The activities could not be read', value: [] }),
      ),
    ]);
    return { error: listings.error, listings: listings.value, readings };
  }

  async function read(time: number, compareTime: number | null, config: ReadConfig) {
    const id = ++request;
    try {
      const [nextA, nextB] = await Promise.all([
        readAt(time, config),
        compareTime === null ? null : readAt(compareTime, config),
      ]);
      // Superseded while it was being read: the cursors or the sources are not what this answers.
      if (id === request) {
        a = { configKey: config.key, time, value: nextA };
        b = nextB && compareTime !== null ? { configKey: config.key, time: compareTime, value: nextB } : null;
      }
    } catch (e) {
      if (id === request) {
        a = null;
        b = null;
        error = (e as Error).message || 'The read failed';
      }
    }
  }

  function select(row: AnalysisActivityRow) {
    const ref = getAnalysisActivityRowRef(bindings, row);
    if (ref) {
      const startMs = Date.parse(row.start_time);
      dispatch('selectActivity', { endMs: row.end_time ? Date.parse(row.end_time) : startMs, ref, startMs });
    }
  }
</script>

<TimeCursorPanel gridSection="RightTop" analysis={cursorData} {user} />
