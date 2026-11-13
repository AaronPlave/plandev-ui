<svelte:options immutable={true} />

<!--
  The Analysis's time cursor inspector: the Plan's TimeCursorPanel (cursor A, comparison cursor B, resource rows with
  A / B / Δ), fed from the analysis's sources instead of a plan's stores. This component only reads the data.

  Resources: the ones the timeline's rows plot, each read at the cursor from its own source and labelled for what the
  value is (recorded sample, held, interpolated, computed, unavailable). Imported resources are read with one exact,
  one-instant query per revision, never from the display data the rows hold (thinned to the screen), which only draws
  the row's sparkline.

  Activities: those of each source that overlap the cursor, asked of the database (never loaded whole): the first few
  per source and how many there are in all.

  Nothing is read while a cursor is being dragged: the queries run once it has settled.
-->
<script lang="ts">
  import { debounce } from 'lodash-es';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { analysisMaxTimeRange, analysisSimulationDatasets, analysisSourceRevisions } from '../../stores/analysis';
  import { timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { getTimelineResourceState, timelineResources } from '../../stores/timelineResourceStatus';
  import { view } from '../../stores/views';
  import type {
    AnalysisActivityRef,
    AnalysisActivityRow,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { ValueSchema } from '../../types/schema';
  import type { TimeRange } from '../../types/timeline';
  import type { SourceQueryResult } from '../../utilities/importedResource';
  import {
    MAX_INSPECTED_RESOURCES,
    getImportedValueAt,
    getInspectedResources,
    getInstantQuery,
    getSimulatedValueAt,
    type AnalysisCursorData,
    type AtTimeValue,
    type InspectedResource,
  } from '../../utilities/analysisAtTime';
  import {
    getAnalysisActivityOrderBy,
    getAnalysisActivityRowRef,
    getAnalysisActivityWhere,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import TimeCursorPanel from '../timeline/TimeCursorPanel.svelte';
  import { formatDate } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
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

  type ResourceReading = {
    reading: AtTimeValue;
    resource: InspectedResource;
    schema: ValueSchema;
    /** Where the timeline holds its display data (for the sparkline), if anywhere. */
    status: { datasetId: number; kind: 'importedRevision' | 'sim' } | null;
  };
  type ActivityListing = { rows: AnalysisActivityRow[]; sourceId: string; total: number };
  /** Everything read at one instant. */
  type Snapshot = { listings: ActivityListing[]; readings: ResourceReading[]; time: number };

  /** What the time cursor (A) and, in comparison, the second cursor (B) were read as; they lag the cursors while those move. */
  let a: Snapshot | null = null;
  let b: Snapshot | null = null;
  let error: string = '';
  let loading: boolean = false;
  let request = 0;

  $: timeline = $view?.definition.plan.timelines[0];
  $: inspected = getInspectedResources(timeline);
  // The rows change often (heights, selection); only the set of resources, the sources and the time matter.
  $: inspectedKey = inspected.map(({ name, sourceId }) => `${sourceId}::${name}`).join('|');
  $: bindingsKey = bindings.map(binding => JSON.stringify(binding)).join('|');
  $: dataKey = `${$analysisSourceRevisions.length}:${$analysisSimulationDatasets.length}`;
  $: schedule($timeCursorMs, $timeCursorCompareMs, inspectedKey, bindingsKey, dataKey);
  $: cursorData = getCursorData(
    a,
    b,
    inspected.length,
    $timelineResources,
    sourceLabels,
    $plugins.time.primary.format,
    $analysisMaxTimeRange,
    loading,
    error,
  );

  const run = debounce(read, SETTLE_MS);

  function schedule(time: number | null, compareTime: number | null, ..._keys: string[]) {
    if (time === null) {
      run.cancel();
      request++;
      a = null;
      b = null;
      loading = false;
      error = '';
      return;
    }
    loading = true;
    run(time, compareTime);
  }

  onDestroy(() => {
    run.cancel();
    request++;
  });

  /** A schema with the resource's units, where the cursor panel reads them from. */
  function withUnit(schema: ValueSchema, units: string | null): ValueSchema {
    return units ? { ...schema, metadata: { ...schema.metadata, unit: { value: units } } } : schema;
  }

  function formatTime(ms: number, format: (date: Date) => string | null): string {
    return formatDate(new Date(ms), format);
  }

  /** What the cursor panel shows: the resources read, with their display data for the sparkline, and the activities. */
  function getCursorData(
    first: Snapshot | null,
    second: Snapshot | null,
    inspectedCount: number,
    _timelineResources: unknown,
    labels: Record<string, string>,
    timeFormat: (date: Date) => string | null,
    bounds: TimeRange,
    isLoading: boolean,
    errorMessage: string,
  ): AnalysisCursorData {
    if (!first) {
      // No cursor yet, or its first read is still on its way.
      return {
        activities: [],
        bounds,
        error: errorMessage,
        formatTime: ms => formatTime(ms, timeFormat),
        loading: isLoading,
        omittedResources: 0,
        onSelectActivity: select,
        resources: [],
      };
    }
    const secondReadings = new Map(
      (second?.readings ?? []).map(entry => [`${entry.resource.sourceId}::${entry.resource.name}`, entry]),
    );
    return {
      activities: [first, second]
        .filter((snapshot): snapshot is Snapshot => !!snapshot)
        .map(snapshot => ({
          cursor: second ? (snapshot === first ? 'A' : 'B') : null,
          sources: snapshot.listings.map(listing => ({
            label: labels[listing.sourceId] ?? listing.sourceId,
            note:
              bindings.find(({ id }) => id === listing.sourceId)?.kind === 'plan'
                ? "A plan's directives have no end: only those starting at this instant are listed."
                : undefined,
            rows: listing.rows,
            sourceId: listing.sourceId,
            total: listing.total,
          })),
          time: snapshot.time,
        })),
      bounds,
      error: errorMessage,
      formatTime: ms => formatTime(ms, timeFormat),
      loading: isLoading,
      omittedResources: Math.max(0, inspectedCount - MAX_INSPECTED_RESOURCES),
      onSelectActivity: select,
      resources: first.readings.map(entry => {
        const key = `${entry.resource.sourceId}::${entry.resource.name}`;
        const state = entry.status
          ? getTimelineResourceState(entry.status.datasetId, entry.resource.name, entry.status.kind)
          : undefined;
        return {
          display: state?.resource ?? { name: entry.resource.name, schema: entry.schema, values: [] },
          key,
          name: entry.resource.name,
          readingA: entry.reading,
          readingB: secondReadings.get(key)?.reading ?? null,
          schema: entry.schema,
          sourceLabel: labels[entry.resource.sourceId] ?? entry.resource.sourceId,
        };
      }),
    };
  }

  function unavailable(resource: InspectedResource, note: string): ResourceReading {
    return { reading: { basis: 'unavailable', note, value: null }, resource, schema: { type: 'string' }, status: null };
  }

  async function readResources(
    time: number,
    specs: InspectedResource[],
    revisions: AnalysisSourceRevision[],
    datasets: AnalysisSimulationDataset[],
  ): Promise<ResourceReading[]> {
    const bySource = new Map<string, InspectedResource[]>();
    specs.forEach(spec => bySource.set(spec.sourceId, [...(bySource.get(spec.sourceId) ?? []), spec]));
    const out = new Map<InspectedResource, ResourceReading>();
    await Promise.all(
      [...bySource.entries()].map(async ([sourceId, members]) => {
        const binding = bindings.find(({ id }) => id === sourceId);
        if (!binding) {
          members.forEach(member => out.set(member, unavailable(member, 'Not a source of this analysis')));
        } else if (binding.kind === 'imported') {
          const revision = revisions.find(({ id }) => id === binding.revisionId);
          if (!revision || revision.status !== 'success') {
            members.forEach(member => out.set(member, unavailable(member, 'The source has no data to read')));
            return;
          }
          const definitions = new Map(revision.resources.map(resource => [resource.key, resource]));
          const known = members.filter(member => definitions.has(member.name));
          members
            .filter(member => !definitions.has(member.name))
            .forEach(member => out.set(member, unavailable(member, 'Not a resource of this source')));
          for (let i = 0; i < known.length; i += RESOURCES_PER_REQUEST) {
            const slice = known.slice(i, i + RESOURCES_PER_REQUEST);
            try {
              const response = await effects.querySourceResources(
                { revisionId: revision.id },
                slice.map(({ name }) => name),
                getInstantQuery(time),
                user,
              );
              const byName = new Map<string, SourceQueryResult>(response.results.map(r => [r.resource, r]));
              slice.forEach(member => {
                const definition = definitions.get(member.name)!;
                const result = byName.get(member.name);
                out.set(member, {
                  reading: result
                    ? getImportedValueAt(time, result, {
                        coverageEnd: Date.parse(definition.coverage_end ?? revision.coverage_end ?? ''),
                        interpolation: definition.interpolation,
                        numeric: definition.numeric,
                      })
                    : { basis: 'unavailable', note: 'The source returned nothing for it', value: null },
                  resource: member,
                  schema: withUnit(definition.schema, definition.units),
                  status: { datasetId: revision.id, kind: 'importedRevision' },
                });
              });
            } catch (e) {
              slice.forEach(member => out.set(member, unavailable(member, (e as Error).message || 'The read failed')));
            }
          }
        } else if (binding.kind === 'simulation') {
          const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
          members.forEach(member => {
            const state = dataset ? getTimelineResourceState(dataset.dataset_id, member.name, 'sim') : undefined;
            out.set(
              member,
              state?.resource
                ? {
                    reading: getSimulatedValueAt(state.resource.values, time),
                    resource: member,
                    schema: state.resource.schema,
                    status: dataset ? { datasetId: dataset.dataset_id, kind: 'sim' } : null,
                  }
                : unavailable(member, state?.error || 'Not loaded: the timeline has not read this resource yet'),
            );
          });
        } else {
          members.forEach(member => out.set(member, unavailable(member, 'A plan has no resources')));
        }
      }),
    );
    return specs.map(spec => out.get(spec)!);
  }

  async function readActivities(time: number): Promise<ActivityListing[]> {
    const instant = { end: time, start: time };
    return Promise.all(
      bindings.map(async binding => {
        const where = getAnalysisActivityWhere(bindings, {
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

  async function readAt(time: number): Promise<Snapshot> {
    const [readings, listings] = await Promise.all([
      readResources(
        time,
        inspected.slice(0, MAX_INSPECTED_RESOURCES),
        $analysisSourceRevisions,
        $analysisSimulationDatasets,
      ),
      readActivities(time),
    ]);
    return { listings, readings, time };
  }

  async function read(time: number, compareTime: number | null) {
    const id = ++request;
    loading = true;
    try {
      const [nextA, nextB] = await Promise.all([readAt(time), compareTime === null ? null : readAt(compareTime)]);
      if (id === request) {
        a = nextA;
        b = nextB;
        error = '';
      }
    } catch (e) {
      if (id === request) {
        error = (e as Error).message || 'The read failed';
      }
    }
    if (id === request) {
      loading = false;
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
