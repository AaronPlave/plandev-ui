import type { AnalysisSimulationDataset, AnalysisSourceBinding, AnalysisSourceRevision } from '../types/analysis';
import type { Layer, Row, Timeline } from '../types/timeline';
import type { TimelineSourceId } from '../types/timelineSource';
import { getSourceIdentity } from './analysis';
import { isActivityLayer, removeRowFromTimelineHierarchy } from './timeline';

/*
 * Applying one Analysis's presentation to another Analysis's data. The presentation is the timeline: rows, sections,
 * layers, axes, styles and value guides. Each source its layers read is a role; the person maps every role to a
 * source of the target Analysis, and nothing is mapped for them unless it is the very same data. The target's
 * sources are never added to or changed. Opening an Analysis is a different thing: that shows the data it was saved
 * with.
 *
 * What does not travel: the original Analysis's notes (they are findings about its data) and, unless asked for, its
 * time guides (they mark times in its data).
 */

/** What one source offers, as far as a presentation can be checked against it. Null: not known, so not checked. */
export type SourceCatalog = {
  activityTypes: Set<string> | null;
  resources: Map<string, { type: string; unit: string | null }> | null;
};

export function getSourceCatalog(
  binding: AnalysisSourceBinding,
  revisions: AnalysisSourceRevision[],
  datasets: AnalysisSimulationDataset[],
  simulationTypes: Record<number, { name: string }[]> = {},
): SourceCatalog {
  if (binding.kind === 'imported') {
    const revision = revisions.find(({ id }) => id === binding.revisionId);
    return revision
      ? {
          activityTypes: new Set(revision.activity_types.map(({ type }) => type)),
          resources: new Map(
            revision.resources.map(({ key, schema, units }) => [key, { type: schema.type, unit: units || null }]),
          ),
        }
      : { activityTypes: null, resources: null };
  }
  if (binding.kind === 'simulation') {
    const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
    const types = simulationTypes[binding.simulationDatasetId];
    return {
      activityTypes: types ? new Set(types.map(({ name }) => name)) : null,
      resources: dataset?.dataset
        ? new Map(
            dataset.dataset.profiles.map(({ name, type }) => [
              name,
              { type: type.schema.type, unit: type.schema.metadata?.unit?.value ?? null },
            ]),
          )
        : null,
    };
  }
  // A plan's directives can be of any type of its model, and it has no resources.
  return { activityTypes: null, resources: new Map() };
}

/** A source the presentation's layers read, to be mapped to a source of the target. */
export type PresentationRole = {
  activityLayers: number;
  binding: AnalysisSourceBinding | null;
  resourceLayers: number;
  sourceId: TimelineSourceId;
};

/** Every source the timeline's layers read, in first-use order. A layer naming a source the Analysis no longer has is still a role. */
export function getPresentationRoles(timeline: Timeline, bindings: AnalysisSourceBinding[]): PresentationRole[] {
  const roles = new Map<TimelineSourceId, PresentationRole>();
  timeline.rows.forEach(row =>
    row.layers.forEach(layer => {
      const sourceId = layer.sourceId ?? '';
      const role = roles.get(sourceId) ?? {
        activityLayers: 0,
        binding: bindings.find(({ id }) => id === sourceId) ?? null,
        resourceLayers: 0,
        sourceId,
      };
      role[isActivityLayer(layer) ? 'activityLayers' : 'resourceLayers']++;
      roles.set(sourceId, role);
    }),
  );
  return [...roles.values()];
}

export type RoleMapping = Record<TimelineSourceId, TimelineSourceId | null>;

/** Preselects a target only for a role that reads the very same data; every other role is left for the person. */
export function getInitialRoleMapping(roles: PresentationRole[], targets: AnalysisSourceBinding[]): RoleMapping {
  return Object.fromEntries(
    roles.map(role => {
      const identity = role.binding && getSourceIdentity(role.binding);
      const same = targets.filter(target => getSourceIdentity(target) === identity);
      return [role.sourceId, same.length === 1 ? same[0].id : null];
    }),
  );
}

/** A resource the target does not have under the presentation's name, and what the person chose to read instead. */
export function getResourceRenameKey(roleId: TimelineSourceId, name: string): string {
  return `${roleId}::${name}`;
}

export type PresentationIssue = {
  /** 'omitted': the layer is left out. 'warning': it is kept, and this is what to check. */
  effect: 'omitted' | 'warning';
  layer: string;
  /** Set when a resource of that name is missing from the target: it can be mapped by hand. */
  missingResource?: { name: string; roleId: TimelineSourceId; type: string | null };
  reason: string;
  row: string;
  rowId: number;
};

export type PresentationOptions = {
  /** Bring the original's time guides. They mark times in the original's data. */
  includeTimeGuides: boolean;
  mapping: RoleMapping;
  /** By getResourceRenameKey: the target resource to read where the name is missing. */
  resourceRenames: Record<string, string>;
};

export type PresentationResult = {
  issues: PresentationIssue[];
  kept: number;
  timeline: Timeline;
  total: number;
};

/**
 * `source` (an Analysis's timeline) as a timeline for the `current` one's Analysis. `sourceCatalogs` and
 * `targetCatalogs` are by binding id, of the original and of the target.
 */
export function applyPresentation(
  source: Timeline,
  current: Timeline,
  sourceCatalogs: Record<TimelineSourceId, SourceCatalog>,
  targetCatalogs: Record<TimelineSourceId, SourceCatalog>,
  targetLabels: Record<TimelineSourceId, string>,
  { includeTimeGuides, mapping, resourceRenames }: PresentationOptions,
): PresentationResult {
  const timeline = structuredClone(source);
  const issues: PresentationIssue[] = [];
  let kept = 0;
  let total = 0;

  const translate = (layer: Layer, row: Row): Layer | null => {
    const roleId = layer.sourceId ?? '';
    const issue = (effect: PresentationIssue['effect'], reason: string, extra: Partial<PresentationIssue> = {}) =>
      issues.push({ effect, layer: layer.name, reason, row: row.name, rowId: row.id, ...extra });
    const targetId = mapping[roleId];
    const target = targetId ? targetCatalogs[targetId] : undefined;
    if (!targetId || !target) {
      issue('omitted', 'Nothing chosen for its source above');
      return null;
    }
    const label = targetLabels[targetId] ?? targetId;
    if (isActivityLayer(layer)) {
      const types = layer.filter.activity?.static_types ?? [];
      const absent = target.activityTypes ? types.filter(type => !target.activityTypes?.has(type)) : [];
      if (absent.length) {
        issue(
          'warning',
          `${label} has no ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ` and ${absent.length - 3} more types` : ''}: the layer will show ${absent.length === types.length ? 'nothing' : 'only the others'}`,
        );
      }
      return { ...layer, sourceId: targetId };
    }
    const original = layer.filter.resource ?? '';
    const was = sourceCatalogs[roleId]?.resources?.get(original) ?? null;
    const name = target.resources && !target.resources.has(original)
      ? resourceRenames[getResourceRenameKey(roleId, original)]
      : original;
    const now = name ? target.resources?.get(name) : undefined;
    if (target.resources && !now) {
      issue('omitted', `${label} has no resource named ${original}`, {
        missingResource: { name: original, roleId, type: was?.type ?? null },
      });
      return null;
    }
    if (was && now && was.type !== now.type) {
      issue('omitted', `${name} is ${now.type} in ${label}; this layer drew ${was.type} values`);
      return null;
    }
    if (name !== original) {
      issue('warning', `Reads ${name} in place of ${original}, as chosen`);
    }
    if (was && now && (was.unit ?? '') !== (now.unit ?? '')) {
      issue(
        'warning',
        `${name} is in ${now.unit || 'no unit'} in ${label}, not ${was.unit || 'no unit'}: values are not converted, so check the axis range and value guides`,
      );
    }
    return { ...layer, filter: { ...layer.filter, resource: name }, sourceId: targetId };
  };

  timeline.rows = timeline.rows.flatMap(row => {
    const layers = row.layers.flatMap(layer => {
      total++;
      const translated = translate(layer, row);
      kept += translated ? 1 : 0;
      return translated ? [translated] : [];
    });
    if (row.layers.length && !layers.length) {
      Object.assign(timeline, removeRowFromTimelineHierarchy(timeline, row.id));
      return [];
    }
    // An axis only omitted layers used goes with them, with its value guides.
    const usedAxes = new Set(layers.map(layer => layer.yAxisId));
    const keepAxis = (id: number) => usedAxes.has(id) || !row.layers.some(layer => layer.yAxisId === id);
    return [
      {
        ...row,
        horizontalGuides: row.horizontalGuides.filter(guide => keepAxis(guide.yAxisId)),
        layers,
        yAxes: row.yAxes.filter(axis => keepAxis(axis.id)),
      },
    ];
  });
  if (!includeTimeGuides) {
    timeline.verticalGuides = [];
  }
  timeline.id = current.id;
  return { issues, kept, timeline, total };
}
