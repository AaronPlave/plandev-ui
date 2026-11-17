import type { AnalysisSourceBinding } from '../types/analysis';
import type { ActivityLayer, ActivityLayerFilter, ExternalEventLayer, Layer, Timeline } from '../types/timeline';
import type { TimelineSourceId } from '../types/timelineSource';
import { isActivityLayer, isExternalEventLayer, removeRowFromTimelineHierarchy } from './timeline';
import { removeValueAnnotations } from './annotations';
import { EXTERNAL_DATASET_SOURCE_PREFIX, EXTERNAL_EVENTS_SOURCE_ID, PLAN_SOURCE_ID } from './timelineSources';

/*
 * Loading a saved Plan View's timeline into an Analysis. Only the timeline travels. Its layers name sources in the
 * Plan's terms ("the plan", or `imported:<plan_source id>`); the Analysis has its own bindings, so each layer is
 * translated to one of them or left out and reported. Nothing is guessed: a layer is never pointed at a source it did
 * not read, and the Analysis's bindings are never added to or changed to make a layer fit.
 */

/** A plan_source the view's layers name, resolved to the revision it stands for. */
export type ViewImportPlanSource = { id: number; revisionId: number; sourceId: number; sourceName: string };

/** What unbound layers (those of the Plan itself) should read in the Analysis; null leaves them out. */
export type ViewImportChoices = {
  /** For activity layers with no source: a Plan or simulation binding. */
  activitySourceId: TimelineSourceId | null;
  /** For resource layers with no source: a simulation binding. */
  resourceSourceId: TimelineSourceId | null;
};

export type OmittedLayer = { layer: string; reason: string; row: string };

export type ViewImportResult = {
  /** Layers kept, after translation. */
  kept: number;
  /** Layers that could not be translated, with why. */
  omitted: OmittedLayer[];
  /** The view's timeline as an Analysis timeline: no row is left without the layers it had, rows of only omitted layers are gone. */
  timeline: Timeline;
};

/**
 * What the Analysis can offer to unbound layers, and what to preselect. Activities of a Plan layer can come from a
 * plan or a simulation; resources only from a simulation. A choice is preselected only when it is the only sensible
 * one (the single plan, else the single simulation); otherwise the person picks, or the layers are left out.
 */
export function getUnboundLayerOptions(bindings: AnalysisSourceBinding[]): {
  activity: AnalysisSourceBinding[];
  defaults: ViewImportChoices;
  resource: AnalysisSourceBinding[];
} {
  const plans = bindings.filter(binding => binding.kind === 'plan');
  const simulations = bindings.filter(binding => binding.kind === 'simulation');
  const only = (list: AnalysisSourceBinding[]) => (list.length === 1 ? list[0].id : null);
  return {
    activity: [...plans, ...simulations],
    defaults: {
      activitySourceId: only(plans) ?? (plans.length ? null : only(simulations)),
      resourceSourceId: only(simulations),
    },
    resource: simulations,
  };
}

/** The plan_source ids a timeline's layers name. */
export function getImportedPlanSourceIds(timeline: Timeline): number[] {
  const ids = new Set<number>();
  timeline.rows.forEach(row =>
    row.layers.forEach(layer => {
      const id = /^imported:(\d+)$/.exec(layer.sourceId ?? '')?.[1];
      if (id) {
        ids.add(Number(id));
      }
    }),
  );
  return [...ids];
}

/** How many of a timeline's layers read the Plan itself (no source), by kind. */
export function countUnboundLayers(timeline: Timeline): { activity: number; resource: number } {
  const counts = { activity: 0, resource: 0 };
  timeline.rows.forEach(row =>
    row.layers.forEach(layer => {
      if (isUnbound(layer) && !isExternalEventLayer(layer)) {
        counts[isActivityLayer(layer) ? 'activity' : 'resource']++;
      }
    }),
  );
  return counts;
}

/** A Plan layer with no source, or on the Plan's own source (which new Plan layers name explicitly). */
function isUnbound(layer: Layer): boolean {
  return !layer.sourceId || layer.sourceId === PLAN_SOURCE_ID;
}

/**
 * The view's timeline for the Analysis. `planSources` has every plan_source the layers name that could be read;
 * one missing from it no longer exists. `timelineId` is the Analysis timeline's id, which the imported one takes.
 */
export function importViewTimeline(
  source: Timeline,
  timelineId: number,
  bindings: AnalysisSourceBinding[],
  planSources: ViewImportPlanSource[],
  choices: ViewImportChoices,
): ViewImportResult {
  const timeline = structuredClone(source);
  const omitted: OmittedLayer[] = [];
  const bindingById = new Map(bindings.map(binding => [binding.id, binding]));
  const importedBindings = bindings.flatMap(binding => (binding.kind === 'imported' ? [binding] : []));

  // External events and external datasets are a plan's in an Analysis: the plan the activity layers read, else the only one.
  const plans = bindings.filter(binding => binding.kind === 'plan');
  const eventPlanId =
    choices.activitySourceId && bindingById.get(choices.activitySourceId)?.kind === 'plan'
      ? choices.activitySourceId
      : plans.length === 1
        ? plans[0].id
        : null;
  const noEventPlan = plans.length
    ? "No plan was chosen for the Plan's activity layers, so it is not known which plan's external data they read"
    : 'This Analysis has no plan to read external data from';

  /** The Analysis source a layer reads (and the layer as it reads it there), or why there is none. */
  const translate = (layer: Layer): { reason: string } | { layer?: Layer; sourceId: TimelineSourceId } => {
    if (isExternalEventLayer(layer) || layer.sourceId === EXTERNAL_EVENTS_SOURCE_ID) {
      if (!eventPlanId) {
        return { reason: noEventPlan };
      }
      // A plan's external events are records of its source in an Analysis: an activity layer of the same types.
      const events = layer.filter.externalEvent ?? {};
      const activityFilter = layer.filter.activity ?? {};
      return {
        layer: {
          ...layer,
          activityColor: (layer as ExternalEventLayer).externalEventColor ?? (layer as ActivityLayer).activityColor,
          chartType: 'activity',
          filter: {
            activity: {
              ...activityFilter,
              static_types: events.static_types ?? activityFilter.static_types,
              ...(events.dynamic_type_filters
                ? {
                    // Both fields are 'Type'.
                    dynamic_type_filters:
                      events.dynamic_type_filters as unknown as ActivityLayerFilter['dynamic_type_filters'],
                  }
                : {}),
            },
          },
          sourceId: eventPlanId,
        } as Layer,
        sourceId: eventPlanId,
      };
    }
    if (layer.sourceId?.startsWith(EXTERNAL_DATASET_SOURCE_PREFIX)) {
      // The plan's external datasets are its resources, by profile name.
      return eventPlanId ? { sourceId: eventPlanId } : { reason: noEventPlan };
    }
    if (isUnbound(layer)) {
      const activity = isActivityLayer(layer);
      const chosen = activity ? choices.activitySourceId : choices.resourceSourceId;
      const kinds = activity ? ['plan', 'simulation'] : ['simulation'];
      if (chosen && kinds.includes(bindingById.get(chosen)?.kind ?? '')) {
        return { sourceId: chosen };
      }
      const available = bindings.some(binding => kinds.includes(binding.kind));
      return {
        reason: available
          ? `No source was chosen for the Plan's ${activity ? 'activity' : 'resource'} layers`
          : `This Analysis has no ${activity ? 'plan or simulation' : 'simulation'} to read them from`,
      };
    }
    const planSourceId = /^imported:(\d+)$/.exec(layer.sourceId ?? '')?.[1];
    if (planSourceId) {
      const planSource = planSources.find(({ id }) => id === Number(planSourceId));
      if (!planSource) {
        return { reason: `The imported source it read (${layer.sourceId}) is no longer attached to a plan` };
      }
      const exact = importedBindings.find(binding => binding.revisionId === planSource.revisionId);
      if (exact) {
        return { sourceId: exact.id };
      }
      // The same source at another revision is not this data: say so rather than substitute it.
      return {
        reason: importedBindings.some(binding => binding.sourceId === planSource.sourceId)
          ? `This Analysis has a different revision of "${planSource.sourceName}" than the one this view used`
          : `"${planSource.sourceName}" is not in this Analysis`,
      };
    }
    return { reason: `Source "${layer.sourceId}" is not available in an Analysis` };
  };

  let kept = 0;
  timeline.id = timelineId;
  timeline.rows = timeline.rows.flatMap(row => {
    const layers: Layer[] = [];
    row.layers.forEach(layer => {
      const result = translate(layer);
      if ('sourceId' in result) {
        layers.push({ ...(result.layer ?? layer), sourceId: result.sourceId });
        kept++;
      } else {
        omitted.push({ layer: layer.name, reason: result.reason, row: row.name });
      }
    });
    if (row.layers.length && !layers.length) {
      Object.assign(timeline, removeRowFromTimelineHierarchy(timeline, row.id));
      timeline.annotations = removeValueAnnotations(timeline.annotations, row.id);
      return [];
    }
    // An axis only omitted layers used goes with them, with its value annotations.
    const usedAxes = new Set(layers.map(layer => layer.yAxisId));
    const droppedAxes = new Set(
      row.layers
        .filter(layer => !layers.some(({ id }) => id === layer.id))
        .map(layer => layer.yAxisId)
        .filter((id): id is number => id !== null && !usedAxes.has(id)),
    );
    if (droppedAxes.size) {
      timeline.annotations = removeValueAnnotations(timeline.annotations, row.id, droppedAxes);
    }
    return [
      droppedAxes.size
        ? { ...row, layers, yAxes: row.yAxes.filter(axis => !droppedAxes.has(axis.id)) }
        : { ...row, layers },
    ];
  });
  // A Plan View's marks are its presentation: they come as reusable annotations (see mergeAnnotationsForLayout).
  timeline.annotations = timeline.annotations.map(annotation => ({ ...annotation, reusable: true }));
  return { kept, omitted, timeline };
}

/**
 * An analysis's own timeline with the layers that name a Plan page's plan (no source, or "plan") pointed at the
 * analysis's source for them, where there is exactly one sensible choice (see getUnboundLayerOptions). Layers with no
 * such choice are left as they are: they say their source is missing, and offer to choose one. The timeline itself
 * when nothing changes.
 */
export function rebindUnboundLayers(timeline: Timeline, bindings: AnalysisSourceBinding[]): Timeline {
  const { defaults } = getUnboundLayerOptions(bindings);
  let changed = false;
  const rows = timeline.rows.map(row => {
    const layers = row.layers.map(layer => {
      if (!isUnbound(layer) || isExternalEventLayer(layer)) {
        return layer;
      }
      const sourceId = isActivityLayer(layer) ? defaults.activitySourceId : defaults.resourceSourceId;
      if (!sourceId) {
        return layer;
      }
      changed = true;
      return { ...layer, sourceId };
    });
    return changed ? { ...row, layers } : row;
  });
  return changed ? { ...timeline, rows } : timeline;
}
