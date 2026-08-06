import { derived, get, writable, type Readable } from 'svelte/store';
import type { Resource } from '../types/simulation';

// Per-(datasetId, name) loading/error registry for any resource on the
// timeline. Two writers — `createProfileSubscription` (sim profiles) and
// `createExternalResourceSubscription` (external datasets) — share the same
// keyspace; the global indicator reads the derived aggregates. `kind`
// travels with each entry so the indicator can label errors with the right
// source ("Profile" vs "External profile") instead of mixing them.

// 'external' entries are keyed on the simulation_dataset id the legacy name lookup is scoped to;
// 'externalDataset' entries (source-bound layers) on the merlin.dataset id of one plan_dataset.
// 'imported' entries (imported source layers) on the plan_source id; 'importedRevision' entries (an Analysis,
// which reads revisions directly) on the source_revision id.
export type TimelineResourceKind = 'sim' | 'external' | 'externalDataset' | 'imported' | 'importedRevision';

export type TimelineResourceState = {
  error: string;
  loading: boolean;
  resource: Resource | null;
};

export type TimelineResourceError = {
  datasetId: number;
  error: string;
  kind: TimelineResourceKind;
  name: string;
};

export type TimelineResourceEntry = {
  kind: TimelineResourceKind;
  resource: Resource;
};

// datasetId/name are carried on the entry (not parsed back out of the key)
// so the key format stays an internal detail and the id space we keyed on
// (dataset_id for sim, simulation_dataset id for external) is preserved
// verbatim for error reporting.
type StoredState = TimelineResourceState & { datasetId: number; kind: TimelineResourceKind; name: string };

const resourceStates = writable<Map<string, StoredState>>(new Map());

// Refcount per key. Two Row.svelte instances showing the same
// (datasetId, name) each create their own factory writing to this key.
// Without refcounting, the first to dispose clears the entry while the
// other factory is still live — and for a settled-error state (e.g.
// external "Resource not found"), nothing would trigger a re-emit, so the
// indicator would silently under-report. Acquire/release scopes the entry
// to the union of writers' lifetimes.
const refCounts = new Map<string, number>();

export const timelineResourcesLoading: Readable<boolean> = derived(resourceStates, $resourceStates => {
  for (const s of $resourceStates.values()) {
    if (s.loading) {
      return true;
    }
  }
  return false;
});

// Every resource the timeline currently holds sampled values for, keyed by name. Covers both sim
// and external profiles, since both subscription factories write here. Consumers that need
// values-at-a-time (e.g. the time cursor inspector) read this instead of fetching again.
//
// Note that `setTimelineResourceState` rebuilds the Map on every emit, and during a live simulation
// every subscription emits ~1 Hz — so this derivation is deliberately kept to a filter, and
// consumers should guard any per-resource computation on the values they actually care about.
export const timelineResources: Readable<Map<string, TimelineResourceEntry>> = derived(
  resourceStates,
  $resourceStates => {
    const resources = new Map<string, TimelineResourceEntry>();
    for (const state of $resourceStates.values()) {
      if (state.resource) {
        resources.set(state.name, { kind: state.kind, resource: state.resource });
      }
    }
    return resources;
  },
);

export const timelineResourcesErroring: Readable<TimelineResourceError[]> = derived(resourceStates, $resourceStates => {
  const errors: TimelineResourceError[] = [];
  for (const s of $resourceStates.values()) {
    if (s.error) {
      errors.push({
        datasetId: s.datasetId,
        error: s.error,
        kind: s.kind,
        name: s.name,
      });
    }
  }
  return errors;
});

// `kind` is part of the key. The two writers key on different id spaces (profiles on
// merlin.dataset.id, external resources on simulation_dataset.id), so (id, name) alone can collide,
// e.g. simulation_dataset 12's external "/battery/soc" and dataset 12's profile "/battery/soc".
function registryKey(datasetId: number, name: string, kind: TimelineResourceKind): string {
  return `${kind}:${datasetId}:${name}`;
}

export function acquireTimelineResource(datasetId: number, name: string, kind: TimelineResourceKind): void {
  const key = registryKey(datasetId, name, kind);
  refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
}

/** The state of one resource as the timeline holds it now, or undefined when no row has asked for it. */
export function getTimelineResourceState(
  datasetId: number,
  name: string,
  kind: TimelineResourceKind,
): TimelineResourceState | undefined {
  return get(resourceStates).get(registryKey(datasetId, name, kind));
}

export function setTimelineResourceState(
  datasetId: number,
  name: string,
  kind: TimelineResourceKind,
  state: TimelineResourceState,
): void {
  const key = registryKey(datasetId, name, kind);
  resourceStates.update(m => new Map(m).set(key, { ...state, datasetId, kind, name }));
}

export function releaseTimelineResource(datasetId: number, name: string, kind: TimelineResourceKind): void {
  const key = registryKey(datasetId, name, kind);
  const next = (refCounts.get(key) ?? 1) - 1;
  if (next <= 0) {
    refCounts.delete(key);
    resourceStates.update(m => {
      if (!m.has(key)) {
        return m;
      }
      const after = new Map(m);
      after.delete(key);
      return after;
    });
  } else {
    refCounts.set(key, next);
  }
}
