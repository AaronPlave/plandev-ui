import { readable } from 'svelte/store';
import type { TimelineResourceState } from '../stores/timelineResourceStatus';
import type { ActivityType } from '../types/activity';
import type { ExternalEvent, ExternalEventType } from '../types/external-event';
import type { DerivationGroup, PlanDerivationGroup } from '../types/external-source';
import type { PlanSource, SourceResource } from '../types/importedSource';
import type { PlanDataset, Profile, ResourceType, SimulationDataset, Span } from '../types/simulation';
import type { Layer, Timeline } from '../types/timeline';
import type {
  SourceBrowserNode,
  TimelineActivitySubscription,
  TimelineResourceSubscription,
  TimelineResourceSubscriptionContext,
  TimelineSource,
  TimelineSourceId,
  TimelineSourceRegistry,
} from '../types/timelineSource';

/* Source ids. These are what view layers persist, so they must stay stable across data revisions. */

export const PLAN_SOURCE_ID: TimelineSourceId = 'plan';
export const EXTERNAL_EVENTS_SOURCE_ID: TimelineSourceId = 'external-events';
const EXTERNAL_DATASET_SOURCE_PREFIX = 'external-dataset:';
const IMPORTED_SOURCE_PREFIX = 'imported:';

/** A plan_dataset is identified by (plan, dataset); within one plan's registry the dataset id is enough. */
export function getExternalDatasetSourceId(datasetId: number): TimelineSourceId {
  return `${EXTERNAL_DATASET_SOURCE_PREFIX}${datasetId}`;
}

/**
 * An imported source as one plan uses it. The id is the plan_source binding, never the revision's storage, so
 * a saved view keeps working however the revision's data is stored.
 */
export function getImportedSourceId(planSourceId: number): TimelineSourceId {
  return `${IMPORTED_SOURCE_PREFIX}${planSourceId}`;
}

/**
 * What a layer bound to a source the registry doesn't have says. A removed plan source is told apart from other
 * missing ones, because a layer outlives its removal (and a saved view can still name it): nothing replaces it, and
 * adding the source to the plan again is a new binding, not this one.
 */
export function getSourceUnavailableMessage(sourceId: TimelineSourceId): string {
  return sourceId.startsWith(IMPORTED_SOURCE_PREFIX)
    ? `Imported source ${sourceId} is no longer in this plan, so this layer has nothing to show`
    : `Source "${sourceId}" is not available in this plan`;
}

/** Row names (with a count when a row has several) of the layers in `timelines` that read `sourceId`. */
export function getLayersUsingSource(timelines: Timeline[], sourceId: TimelineSourceId): string[] {
  return timelines.flatMap(timeline =>
    timeline.rows.flatMap(row => {
      const count = row.layers.filter(layer => layer.sourceId === sourceId).length;
      return count ? [`"${row.name || `Row ${row.id}`}"${count > 1 ? ` (${count} layers)` : ''}`] : [];
    }),
  );
}

/** The external profile a legacy (unbound) resource name resolves to, and the plan_dataset row it comes from. */
export type LegacyExternalProfileCandidate = {
  datasetId: number;
  offsetFromPlanStart: string;
  profile: Profile;
};

/**
 * Picks which plan_dataset row provides the external profile `name`. This is the one definition of the legacy
 * merged-namespace precedence, used both to load the data (createExternalResourceSubscription) and to know what
 * a legacy layer is displaying (findLegacyResourceType):
 * 1. the row tied to the selected simulation dataset;
 * 2. otherwise the first plan-level row (no simulation dataset);
 * 3. otherwise the first row with the name, in `planDatasets` order.
 * With `datasetId`, only that plan_dataset row is considered.
 */
export function selectLegacyExternalProfile(
  planDatasets: PlanDataset[],
  simulationDatasetId: number | null,
  name: string,
  datasetId?: number,
): LegacyExternalProfileCandidate | null {
  let planLevel: LegacyExternalProfileCandidate | null = null;
  let fallback: LegacyExternalProfileCandidate | null = null;
  for (const planDataset of planDatasets) {
    if (datasetId !== undefined && planDataset.dataset_id !== datasetId) {
      continue;
    }
    const profile = planDataset.dataset.profiles.find(p => p.name === name);
    if (!profile) {
      continue;
    }
    const candidate = {
      datasetId: planDataset.dataset_id,
      offsetFromPlanStart: planDataset.offset_from_plan_start,
      profile,
    };
    if (simulationDatasetId !== null && planDataset.simulation_dataset_id === simulationDatasetId) {
      return candidate;
    }
    if (planDataset.simulation_dataset_id === null && planLevel === null) {
      planLevel = candidate;
    }
    if (fallback === null) {
      fallback = candidate;
    }
  }
  return planLevel ?? fallback;
}

export type LegacyResourceContext = {
  /** The mission model's resource types: a name among them is read from the Plan's simulation. */
  modelResourceTypes: ResourceType[];
  planDatasets: PlanDataset[];
  registry: TimelineSourceRegistry | null | undefined;
  /** The selected simulation dataset's id (what plan_dataset.simulation_dataset_id references), if any. */
  simulationDatasetId: number | null;
};

/**
 * The declaration of the resource a legacy (unbound) layer is displaying, resolved exactly as the legacy loader
 * in Row resolves its data: a model resource name reads the Plan's simulation, anything else the external profile
 * chosen by selectLegacyExternalProfile. Registry order plays no part, so rebinding decisions (scale, guides,
 * chart type) are based on what is actually on screen.
 */
export function findLegacyResourceType(context: LegacyResourceContext, name: string | undefined): ResourceType | null {
  if (!name) {
    return null;
  }
  const modelResourceType = context.modelResourceTypes.find(type => type.name === name);
  if (modelResourceType) {
    return findResourceType(context.registry, PLAN_SOURCE_ID, name) ?? modelResourceType;
  }
  const candidate = selectLegacyExternalProfile(context.planDatasets, context.simulationDatasetId, name);
  return candidate ? { name, schema: candidate.profile.type.schema } : null;
}

/**
 * The declaration of a resource as a layer bound to `sourceId` would read it. Without `sourceId` it returns the
 * first source in registry order that provides the name; that is a catalog lookup, not what a legacy layer
 * displays (use findLegacyResourceType for that).
 */
export function findResourceType(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
  name: string | undefined,
): ResourceType | null {
  if (!registry || !name) {
    return null;
  }
  const sources = sourceId ? [getSource(registry, sourceId)] : registry.sources;
  for (const source of sources) {
    const resourceType = source?.resources?.catalog.find(type => type.name === name);
    if (resourceType) {
      return resourceType;
    }
  }
  return null;
}

export function getSource(
  registry: TimelineSourceRegistry | null | undefined,
  sourceId: TimelineSourceId | null | undefined,
): TimelineSource | null {
  if (!registry || !sourceId) {
    return null;
  }
  return registry.sources.find(source => source.id === sourceId) ?? null;
}

/* Layer binding. */

/**
 * Activity layers without a source predate sources and always meant the Plan (its directives and simulated
 * spans), so they resolve to the Plan source.
 */
export function resolveActivityLayerSourceId(layer: Pick<Layer, 'sourceId'>): TimelineSourceId {
  return layer.sourceId ?? PLAN_SOURCE_ID;
}

/**
 * Identity of one resource request in a row. A resource layer without a source keeps the legacy meaning:
 * the name looked up in the model's simulation profiles, then in the attached external datasets. That
 * merged namespace gets its own key so it never aliases a source-bound layer with the same name.
 */
export function getResourceRequestKey(sourceId: TimelineSourceId | null | undefined, name: string): string {
  return `${sourceId ?? ''}::${name}`;
}

export function getLayerResourceRequestKey(layer: Pick<Layer, 'filter' | 'sourceId'>): string | null {
  return layer.filter.resource ? getResourceRequestKey(layer.sourceId, layer.filter.resource) : null;
}

export type ResourceLayerSourceResolution =
  | { kind: 'legacy' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'source'; source: TimelineSource };

/**
 * Resolves the source of a resource layer. A layer bound to a source that is not (or no longer) available
 * resolves to `unavailable`; it never falls back to another source with the same resource name.
 */
export function resolveResourceLayerSource(
  layer: Pick<Layer, 'sourceId'>,
  registry: TimelineSourceRegistry | null,
): ResourceLayerSourceResolution {
  if (!layer.sourceId) {
    return { kind: 'legacy' };
  }
  const source = getSource(registry, layer.sourceId);
  if (source?.resources) {
    return { kind: 'source', source };
  }
  if (!source && (!registry || registry.loading)) {
    return { kind: 'loading' };
  }
  return {
    kind: 'unavailable',
    message: source ? `Source "${source.label}" has no resources` : getSourceUnavailableMessage(layer.sourceId),
  };
}

export function getSourceLabel(registry: TimelineSourceRegistry | null, sourceId: TimelineSourceId | null | undefined) {
  if (!sourceId) {
    return null;
  }
  return getSource(registry, sourceId)?.label ?? sourceId;
}

/** A subscription whose state never changes, for sources that cannot serve a request. */
export function createStaticResourceSubscription(state: TimelineResourceState): TimelineResourceSubscription {
  return { store: readable(state), unsubscribe: () => {} };
}

/* Source adapters. Each turns one existing domain object into a TimelineSource. */

type ResourceSubscriber = (name: string, context: TimelineResourceSubscriptionContext) => TimelineResourceSubscription;

export type PlanSimulationSourceInput = {
  activityTypes: ActivityType[];
  activityTypesLoading: boolean;
  /** Resources the mission model declares: the Plan can provide them once simulated. */
  modelResourceTypes: ResourceType[];
  /** Profiles present in the selected simulation dataset. */
  profileCatalog: ResourceType[];
  profileCatalogLoading: boolean;
  simulationDataset: SimulationDataset | null;
  spans: Span[] | null;
  subscribeProfile: (
    datasetId: number,
    name: string,
    startYmd: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

export function createPlanSimulationSource(input: PlanSimulationSourceInput): TimelineSource {
  const { activityTypes, profileCatalog, simulationDataset, spans } = input;
  const counts = new Map<string, number>();
  (spans ?? []).forEach(span => counts.set(span.type, (counts.get(span.type) ?? 0) + 1));
  const present = [...counts.entries()]
    .map(([name, count]) => ({ count, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const catalog = [...profileCatalog].sort((a, b) => a.name.localeCompare(b.name));
  // What layers can bind to: the simulated profiles plus the model's declared resources (so a Plan layer can be
  // set up before simulating); a simulated profile's declaration wins over the model's.
  const simulatedNames = new Set(catalog.map(type => type.name));
  const bindableCatalog = [...catalog, ...input.modelResourceTypes.filter(type => !simulatedNames.has(type.name))].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const unavailableReason = simulationDataset ? undefined : 'The plan has no simulation results';

  // Serve the simulation dataset this source was built from, so the data always matches `revisionKey`.
  const subscribe: ResourceSubscriber = (name, context) => {
    if (!simulationDataset) {
      return createStaticResourceSubscription({ error: unavailableReason ?? '', loading: false, resource: null });
    }
    // Simulation profiles are fetched by merlin.dataset id, with offsets from the simulation start.
    return input.subscribeProfile(
      simulationDataset.dataset_id,
      name,
      simulationDataset.simulation_start_time ?? context.plan?.start_time ?? '',
      context,
    );
  };

  const activityTypesByName = new Map(activityTypes.map(type => [type.name, type]));
  return {
    browserNodes: [
      {
        children: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId: PLAN_SOURCE_ID, typeName: 'resource' },
          id: `${PLAN_SOURCE_ID}/resource/${resourceType.name}`,
          kind: 'item',
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        emptyMessage: unavailableReason ?? (input.profileCatalogLoading ? 'Loading…' : 'No simulated resources'),
        id: `${PLAN_SOURCE_ID}/resources`,
        kind: 'group',
        label: `Resources (${catalog.length})`,
      },
      {
        children: present.map(({ count, name }) => ({
          action: {
            item: activityTypesByName.get(name) ?? toIntervalType(name),
            sourceId: PLAN_SOURCE_ID,
            typeName: 'activity',
          },
          badge: `${count}`,
          id: `${PLAN_SOURCE_ID}/activity/${name}`,
          kind: 'item',
          label: name,
          tooltip: activityTypesByName.has(name) ? undefined : 'Not a type in the current mission model',
        })),
        emptyMessage: unavailableReason ?? 'No simulated activities',
        id: `${PLAN_SOURCE_ID}/activities`,
        kind: 'group',
        label: `Simulated Activities (${present.length})`,
      },
    ],
    description: simulationDataset ? `Simulation dataset ${simulationDataset.id}` : 'Not simulated',
    group: 'Plan',
    id: PLAN_SOURCE_ID,
    intervals: {
      catalog: activityTypes,
      hasDirectives: true,
      loading: input.activityTypesLoading,
      present,
    },
    kind: 'plan',
    label: 'Simulation',
    resources: {
      catalog: bindableCatalog,
      loading: input.profileCatalogLoading,
      revisionKey: simulationDataset ? `simulation-dataset:${simulationDataset.id}` : null,
      subscribe,
      unavailableReason,
    },
  };
}

/**
 * An activity type of a source with no type declarations: its name, and the parameters its instances were seen
 * with (by JSON value type), so filters can offer them. Arrays and objects are left out, as filters skip them.
 */
export function toIntervalType(name: string, parameterTypes: Record<string, string> = {}): ActivityType {
  const schemaTypes: Record<string, 'boolean' | 'real' | 'string'> = {
    boolean: 'boolean',
    number: 'real',
    string: 'string',
  };
  const parameters: ActivityType['parameters'] = {};
  Object.entries(parameterTypes).forEach(([parameterName, valueType], order) => {
    if (schemaTypes[valueType]) {
      parameters[parameterName] = { order, schema: { type: schemaTypes[valueType] } };
    }
  });
  return { computed_attributes_value_schema: { items: {}, type: 'struct' }, name, parameters, required_parameters: [] };
}

export type ExternalDatasetSourcesInput = {
  planDatasets: PlanDataset[];
  simulationDatasetId: number;
  subscribeExternal: (
    datasetId: number,
    name: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

/**
 * One source per plan_dataset row. plan_dataset has no name of its own, so the label comes from the dataset id
 * and its association (tied to a simulation or plan-level). Datasets tied to a different simulation than the
 * selected one are still real, addressable data, so they are listed too; the legacy merged namespace hides them.
 */
export function createExternalDatasetSources(input: ExternalDatasetSourcesInput): TimelineSource[] {
  const { planDatasets, simulationDatasetId } = input;
  return [...planDatasets]
    .sort((a, b) => a.dataset_id - b.dataset_id)
    .map(planDataset => {
      const sourceId = getExternalDatasetSourceId(planDataset.dataset_id);
      const catalog: ResourceType[] = planDataset.dataset.profiles
        .map(profile => ({ name: profile.name, schema: profile.type.schema }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const simId = planDataset.simulation_dataset_id;
      const association =
        simId === null
          ? 'Plan-level'
          : simId === simulationDatasetId
            ? `Tied to the selected simulation (${simId})`
            : `Tied to simulation ${simId}`;
      return {
        browserNodes: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId, typeName: 'resource' as const },
          id: `${sourceId}/resource/${resourceType.name}`,
          kind: 'item' as const,
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        description: `${association} · offset ${planDataset.offset_from_plan_start}`,
        group: 'External Datasets',
        id: sourceId,
        kind: 'externalDataset' as const,
        label: `Dataset ${planDataset.dataset_id}`,
        resources: {
          catalog,
          loading: false,
          revisionKey: `dataset:${planDataset.dataset_id}`,
          subscribe: (name: string, context: TimelineResourceSubscriptionContext) =>
            input.subscribeExternal(planDataset.dataset_id, name, context),
        },
      };
    });
}

export function groupBrowserNodes<T>(
  sourceId: TimelineSourceId,
  kind: string,
  items: T[],
  getCategory: (item: T) => string | null,
  toNode: (item: T) => SourceBrowserNode,
  summarize: (members: T[]) => Pick<SourceBrowserNode, 'badge' | 'tooltip'>,
): SourceBrowserNode[] {
  const byCategory = new Map<string, T[]>();
  items.forEach(item => {
    const category = getCategory(item) ?? 'Uncategorized';
    const members = byCategory.get(category) ?? [];
    members.push(item);
    byCategory.set(category, members);
  });
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, members]) => ({
      ...summarize(members),
      children: members.map(toNode),
      id: `${sourceId}/${kind}/category/${category}`,
      kind: 'group',
      label: category,
    }));
}

export function activityItemNode(sourceId: TimelineSourceId, name: string, count: number): SourceBrowserNode {
  return {
    action: { item: toIntervalType(name), sourceId, typeName: 'activity' },
    badge: `${count}`,
    id: `${sourceId}/activity/${name}`,
    kind: 'item',
    label: name,
    tooltip: countLabel(count, 'activity', 'activities'),
  };
}

export function countLabel(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What a group of activity types shows: its activities, with how many types they are of. */
export function summarizeActivityTypes(types: { count: number }[]): Pick<SourceBrowserNode, 'badge' | 'tooltip'> {
  const activities = types.reduce((total, type) => total + type.count, 0);
  return {
    badge: `${activities}`,
    tooltip: `${countLabel(types.length, 'type', 'types')} · ${countLabel(activities, 'activity', 'activities')}`,
  };
}

export type ImportedSourcesInput = {
  planSources: PlanSource[];
  /** The revision's activities, of the requested types (all when null). */
  subscribeActivities: (
    planSource: PlanSource,
    request: { types: string[] | null },
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  subscribeImported: (
    planSource: PlanSource,
    resource: SourceResource,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

/**
 * One source per imported revision the plan uses (plan_source). Resources are grouped by the source's own
 * category (a TOL's subsystem). The catalog is browseable as soon as ingest starts; data once it is published.
 */
export function createImportedSources(input: ImportedSourcesInput): TimelineSource[] {
  return input.planSources.map(planSource => {
    const sourceId = getImportedSourceId(planSource.id);
    const revision = planSource.source_revision;
    const resources = new Map(revision.resources.map(resource => [resource.key, resource]));
    const catalog: ResourceType[] = revision.resources.map(resource => ({
      name: resource.key,
      schema: resource.schema,
    }));
    const byCategory = new Map<string, SourceResource[]>();
    revision.resources.forEach(resource => {
      const category = resource.category ?? 'Uncategorized';
      byCategory.set(category, [...(byCategory.get(category) ?? []), resource]);
    });
    const ready = revision.status === 'success';
    const unavailableReason = ready
      ? undefined
      : revision.status === 'failed'
        ? 'The import failed'
        : 'The source is still being imported';
    const activityTypes = revision.activity_types;
    const activityCount = activityTypes.reduce((total, type) => total + type.count, 0);
    return {
      browserNodes: [
        ...[...byCategory.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, members]) => ({
            badge: `${members.length}`,
            children: members.map(resource => ({
              action: {
                item: { name: resource.key, schema: resource.schema },
                sourceId,
                typeName: 'resource' as const,
              },
              id: `${sourceId}/resource/${resource.key}`,
              kind: 'item' as const,
              label: resource.key,
              tags: [resource.schema.type],
              tooltip: [resource.units, resource.sample_count !== null ? `${resource.sample_count} samples` : null]
                .filter(Boolean)
                .join(' · '),
            })),
            id: `${sourceId}/category/${category}`,
            kind: 'group' as const,
            label: category,
          })),
        ...(activityTypes.length
          ? [
              {
                children: groupBrowserNodes(
                  sourceId,
                  'activity',
                  activityTypes,
                  type => type.category,
                  type => activityItemNode(sourceId, type.type, type.count),
                  summarizeActivityTypes,
                ),
                id: `${sourceId}/activities`,
                kind: 'group' as const,
                label: `Activities (${activityCount.toLocaleString()})`,
                tooltip: summarizeActivityTypes(activityTypes).tooltip,
              },
            ]
          : []),
      ],
      description: ready
        ? `Revision ${revision.id} · ${revision.coverage_start ?? '?'} – ${revision.coverage_end ?? '?'}`
        : `Revision ${revision.id} · ${revision.status}`,
      group: 'Imported Sources',
      id: sourceId,
      ...(activityTypes.length
        ? {
            intervals: {
              catalog: activityTypes.map(type => toIntervalType(type.type, type.parameters)),
              hasDirectives: false,
              loading: false,
              present: activityTypes.map(type => ({ count: type.count, name: type.type })),
              revisionKey: ready ? `source-revision:${revision.id}` : null,
              subscribe: (request: { types: string[] | null }, context: TimelineResourceSubscriptionContext) =>
                ready
                  ? input.subscribeActivities(planSource, request, context)
                  : {
                      store: readable({ error: unavailableReason ?? '', loading: false, spans: [] }),
                      unsubscribe: () => {},
                    },
            },
          }
        : {}),
      kind: 'imported' as const,
      label: planSource.label ?? revision.source.name,
      resources: {
        catalog,
        loading: false,
        revisionKey: ready ? `source-revision:${revision.id}` : null,
        subscribe: (name: string, context: TimelineResourceSubscriptionContext) => {
          const resource = resources.get(name);
          if (!ready || !resource) {
            return createStaticResourceSubscription({
              error: unavailableReason ?? `Resource not found in ${revision.source.name}`,
              loading: false,
              resource: null,
            });
          }
          return input.subscribeImported(planSource, resource, context);
        },
        unavailableReason,
      },
    };
  });
}

export type ExternalEventsSourceInput = {
  acknowledged: Record<string, { last_acknowledged_at: string }>;
  derivationGroups: DerivationGroup[];
  eventTypes: ExternalEventType[];
  events: ExternalEvent[];
  loading: boolean;
  planDerivationGroupLinks: PlanDerivationGroup[];
  visibility: Record<string, boolean>;
};

/**
 * The plan's external events, organized the way the External Events domain is: derivation groups linked to the
 * plan, their external sources, and the event types those sources contribute within the plan bounds. Adding an
 * event type creates an ordinary external-event layer restricted to that type and that external source
 * (`ExternalEventLayerFilter.external_sources`); events keep their own identity (derivation group, source key,
 * type, key), so nothing here is flattened into profiles or intervals.
 */
export function createExternalEventsSource(input: ExternalEventsSourceInput): TimelineSource {
  const eventTypesByName = new Map(input.eventTypes.map(type => [type.name, type]));
  const derivationGroupsByName = new Map(input.derivationGroups.map(group => [group.name, group]));
  // derivation group -> source key -> event type -> count
  const counts = new Map<string, Map<string, Map<string, number>>>();
  input.events.forEach(({ pkey }) => {
    const bySource = counts.get(pkey.derivation_group_name) ?? new Map<string, Map<string, number>>();
    const byType = bySource.get(pkey.source_key) ?? new Map<string, number>();
    byType.set(pkey.event_type_name, (byType.get(pkey.event_type_name) ?? 0) + 1);
    bySource.set(pkey.source_key, byType);
    counts.set(pkey.derivation_group_name, bySource);
  });

  const presentTypes = new Set(input.events.map(event => event.pkey.event_type_name));
  const linkedGroupNames = [...new Set(input.planDerivationGroupLinks.map(link => link.derivation_group_name))].sort();
  const browserNodes: SourceBrowserNode[] = linkedGroupNames.map(groupName => {
    const group = derivationGroupsByName.get(groupName);
    const bySource = counts.get(groupName) ?? new Map<string, Map<string, number>>();
    const sourceKeys = [...new Set([...(group?.sources ?? []), ...bySource.keys()])].sort();
    const hidden = input.visibility[groupName] === false;
    const tags = [
      group?.source_type_name ?? '',
      hidden ? 'hidden' : '',
      input.acknowledged[groupName] ? 'updated' : '',
    ].filter(Boolean);
    return {
      children: sourceKeys.map(sourceKey => {
        const byType = bySource.get(sourceKey) ?? new Map<string, number>();
        return {
          children: [...byType.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([typeName, count]) => ({
              // The layer keeps the scope this node shows: this type, from this source key in this group.
              action: {
                externalSources: [{ derivation_group_name: groupName, source_key: sourceKey }],
                item: eventTypesByName.get(typeName) ?? { attribute_schema: {}, name: typeName },
                sourceId: null,
                typeName: 'externalEvent' as const,
              },
              badge: `${count}`,
              id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}/${sourceKey}/${typeName}`,
              kind: 'item' as const,
              label: typeName,
              tooltip: `${typeName} events from ${sourceKey} (${groupName})`,
            })),
          emptyMessage: input.loading ? 'Loading…' : 'No events within the plan bounds',
          id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}/${sourceKey}`,
          kind: 'group' as const,
          label: sourceKey,
          tooltip: 'External source',
        };
      }),
      emptyMessage: 'No external sources',
      id: `${EXTERNAL_EVENTS_SOURCE_ID}/${groupName}`,
      kind: 'group',
      label: groupName,
      tags,
      tooltip: hidden
        ? 'Derivation group (hidden on the timeline for this plan)'
        : `Derivation group${group ? ` of source type ${group.source_type_name}` : ''}`,
    };
  });

  return {
    browserNodes,
    description: `${linkedGroupNames.length} linked derivation group${linkedGroupNames.length === 1 ? '' : 's'}`,
    events: {
      catalog: [...presentTypes].sort().map(name => eventTypesByName.get(name) ?? { attribute_schema: {}, name }),
      loading: input.loading,
    },
    group: 'External Events',
    id: EXTERNAL_EVENTS_SOURCE_ID,
    kind: 'externalEvents',
    label: 'External Events',
  };
}

/* Browser helpers. */

/** Keeps items whose label matches, with their ancestors; a matching group keeps its whole subtree. */
export function filterSourceBrowserNodes(nodes: SourceBrowserNode[], text: string): SourceBrowserNode[] {
  const needle = text.trim().toLowerCase();
  if (!needle) {
    return nodes;
  }
  const result: SourceBrowserNode[] = [];
  nodes.forEach(node => {
    if (node.label.toLowerCase().includes(needle)) {
      result.push(node);
      return;
    }
    const children = filterSourceBrowserNodes(node.children ?? [], needle);
    if (children.length) {
      result.push({ ...node, children });
    }
  });
  return result;
}
