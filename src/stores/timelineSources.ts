import { getContext, setContext } from 'svelte';
import { derived, type Readable } from 'svelte/store';
import type { PlanSource } from '../types/importedSource';
import type { ResourceType } from '../types/simulation';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import { importedActivityToSpan } from '../utilities/analysis';
import gql from '../utilities/gql';
import {
  createExternalDatasetSources,
  createExternalEventsSource,
  createImportedSources,
  createPlanSimulationSource,
  getImportedSourceId,
} from '../utilities/timelineSources';
import { createLoadedActivitySubscription, getRevisionActivities } from './analysisActivities';
import { externalEventTypes, selectedExternalEvents, selectedExternalEventsRaw } from './external-event';
import {
  derivationGroups,
  derivationGroupsAcknowledged,
  derivationGroupVisibilityMap,
  planDerivationGroupLinks,
} from './external-source';
import { createExternalResourceSubscription } from './externalResource';
import { createImportedResourceSubscription, getSourceQuery } from './importedResource';
import { planDatasets, planId, planModelActivityTypes } from './plan';
import { createProfileSubscription } from './profile';
import { resourceTypes, simulationDataset, simulationDatasetId, spans } from './simulation';
import { gqlSubscribable } from './subscribable';

/** Profiles present in the selected simulation dataset: what the simulation actually produced. */
export const simulationProfileCatalog = gqlSubscribable<ResourceType[]>(
  gql.SUB_SIMULATION_DATASET_PROFILES,
  { simulationDatasetId },
  [],
  (
    simulationDataset: {
      dataset: { profiles: { name: string; type: { schema: ResourceType['schema'] } }[] } | null;
    } | null,
  ): ResourceType[] =>
    (simulationDataset?.dataset?.profiles ?? []).map(({ name, type }) => ({ name, schema: type.schema })),
);

const planSimulationSource = derived(
  [
    planModelActivityTypes,
    planModelActivityTypes.loading,
    resourceTypes,
    simulationProfileCatalog,
    simulationProfileCatalog.loading,
    simulationDataset,
    spans,
  ],
  ([
    $planModelActivityTypes,
    $activityTypesLoading,
    $resourceTypes,
    $simulationProfileCatalog,
    $profileCatalogLoading,
    $simulationDataset,
    $spans,
  ]) =>
    createPlanSimulationSource({
      activityTypes: $planModelActivityTypes,
      activityTypesLoading: $activityTypesLoading,
      modelResourceTypes: $resourceTypes,
      profileCatalog: $simulationDataset ? $simulationProfileCatalog : [],
      profileCatalogLoading: $profileCatalogLoading,
      simulationDataset: $simulationDataset,
      spans: $spans,
      subscribeProfile: (datasetId, name, startYmd, { user }) =>
        createProfileSubscription(datasetId, name, startYmd, user),
    }),
);

const externalDatasetSources = derived([planDatasets, simulationDatasetId], ([$planDatasets, $simulationDatasetId]) =>
  createExternalDatasetSources({
    planDatasets: $planDatasets,
    simulationDatasetId: $simulationDatasetId,
    subscribeExternal: (datasetId, name, { plan, simulationDataset, user }) =>
      createExternalResourceSubscription(simulationDataset?.id ?? -1, name, plan?.start_time ?? '', user, datasetId),
  }),
);

const externalEventsSource = derived(
  [
    selectedExternalEvents,
    selectedExternalEventsRaw.loading,
    planDerivationGroupLinks,
    planDerivationGroupLinks.loading,
    derivationGroups,
    derivationGroups.loading,
    derivationGroupVisibilityMap,
    derivationGroupsAcknowledged,
    externalEventTypes,
  ],
  ([
    $events,
    $eventsLoading,
    $links,
    $linksLoading,
    $derivationGroups,
    $derivationGroupsLoading,
    $visibility,
    $acknowledged,
    $eventTypes,
  ]) =>
    createExternalEventsSource({
      acknowledged: $acknowledged,
      derivationGroups: $derivationGroups,
      eventTypes: $eventTypes,
      events: $events,
      // Events are only requested for linked groups, so their loading state matters only once there are links.
      loading: $linksLoading || $derivationGroupsLoading || ($links.length > 0 && $eventsLoading),
      planDerivationGroupLinks: $links,
      visibility: $visibility,
    }),
);

/** Imported revisions the plan uses, with their resource catalogs. */
export const planSources = gqlSubscribable<PlanSource[]>(gql.SUB_PLAN_SOURCES, { planId }, []);

const importedSources = derived(planSources, $planSources =>
  createImportedSources({
    planSources: $planSources,
    subscribeActivities: (planSource, request, { user }) =>
      createLoadedActivitySubscription(() =>
        getRevisionActivities(
          planSource.source_revision.id,
          request.types,
          activity => importedActivityToSpan(getImportedSourceId(planSource.id), activity),
          user,
        ),
      ),
    subscribeImported: (planSource, resource, { user }) =>
      createImportedResourceSubscription({
        coverage: {
          end: Date.parse(planSource.source_revision.coverage_end ?? ''),
          start: Date.parse(planSource.source_revision.coverage_start ?? ''),
        },
        interpolation: resource.interpolation,
        key: resource.key,
        numeric: resource.numeric,
        query: getSourceQuery({ planSourceId: planSource.id }, user),
        resourceType: { name: resource.key, schema: resource.schema },
        target: { planSourceId: planSource.id },
      }),
  }),
);

/** Every source available to the current Plan page's timeline. */
export const timelineSources: Readable<TimelineSourceRegistry> = derived(
  [
    planSimulationSource,
    externalDatasetSources,
    externalEventsSource,
    importedSources,
    planDatasets.loading,
    planSources.loading,
  ],
  ([
    $planSimulationSource,
    $externalDatasetSources,
    $externalEventsSource,
    $importedSources,
    $planDatasetsLoading,
    $planSourcesLoading,
  ]) => ({
    loading: $planDatasetsLoading || $planSourcesLoading,
    sources: [$planSimulationSource, ...$externalDatasetSources, $externalEventsSource, ...$importedSources],
  }),
);

const TIMELINE_SOURCES_CONTEXT = Symbol('timelineSources');

/**
 * A page that is not a Plan (an Analysis) gives the timeline components beneath it its own sources. Call during
 * component initialization.
 */
export function setTimelineSourcesContext(registry: Readable<TimelineSourceRegistry>) {
  setContext(TIMELINE_SOURCES_CONTEXT, registry);
}

/** The sources of the page this component is on: the Plan page's unless a page provided its own. */
export function getTimelineSourcesContext(): Readable<TimelineSourceRegistry> {
  return getContext<Readable<TimelineSourceRegistry> | undefined>(TIMELINE_SOURCES_CONTEXT) ?? timelineSources;
}
