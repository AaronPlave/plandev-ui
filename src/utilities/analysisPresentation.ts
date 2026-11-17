import type {
  AnalysisPlan,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
} from '../types/analysis';
import type { ResourceType } from '../types/simulation';
import type { Layer, Row, Timeline } from '../types/timeline';
import type { TimelineSourceId } from '../types/timelineSource';
import { getSourceIdentity } from './analysis';
import { getHorizontalGuides, removeValueAnnotations, setHorizontalGuides } from './annotations';
import { isActivityLayer, rebindResourceLayer, removeRowFromTimelineHierarchy } from './timeline';

/*
 * Applying one Analysis's presentation to another Analysis's data. The presentation is the timeline: rows, sections,
 * layers, axes, styles and value guides. Each source its layers read is a role, mapped to a source of the target
 * Analysis: the very same data is mapped for the person, and another revision of the same logical source is
 * suggested (and said to be another revision); anything else they choose. The target's sources are never added to
 * or changed. Opening an Analysis is a different thing: that shows the data it was saved with.
 *
 * What does not travel: the original Analysis's findings (annotations not marked part of its layout). Which
 * annotations come and which of the target's stay is decided when the timeline is replaced (mergeAnnotationsForLayout).
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
  plan?: AnalysisPlan,
  eventTypes: string[] = [],
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
  // A plan: its model's types and its external events' types; its external datasets' profiles. Not known when the plan
  // isn't (not checked).
  if (!plan) {
    return { activityTypes: null, resources: new Map() };
  }
  return {
    activityTypes: new Set([...(plan.mission_model?.activity_types ?? []).map(({ name }) => name), ...eventTypes]),
    resources: new Map(
      (plan.external_datasets ?? []).flatMap(({ dataset }) =>
        (dataset?.profiles ?? []).map(({ name, type }) => [
          name,
          { type: type.schema.type, unit: type.schema.metadata?.unit?.value ?? null },
        ]),
      ),
    ),
  };
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

/** How a target relates to a role's source: the very same data, another revision of the same source, or neither. */
export function getRoleMatch(
  role: Pick<PresentationRole, 'binding'>,
  target: AnalysisSourceBinding,
): 'other' | 'revision' | 'same' {
  const { binding } = role;
  if (!binding) {
    return 'other';
  }
  if (getSourceIdentity(binding) === getSourceIdentity(target)) {
    return 'same';
  }
  return binding.kind === 'imported' &&
    target.kind === 'imported' &&
    binding.sourceId !== undefined &&
    binding.sourceId === target.sourceId
    ? 'revision'
    : 'other';
}

/**
 * Preselects a target for a role only when exactly one target reads the very same data or, failing that, exactly one
 * reads another revision of the same source (a suggestion the person sees as such). Everything else is theirs to pick.
 */
export function getInitialRoleMapping(roles: PresentationRole[], targets: AnalysisSourceBinding[]): RoleMapping {
  return Object.fromEntries(
    roles.map(role => {
      for (const match of ['same', 'revision'] as const) {
        const found = targets.filter(target => getRoleMatch(role, target) === match);
        if (found.length === 1) {
          return [role.sourceId, found[0].id];
        }
        if (found.length > 1) {
          break;
        }
      }
      return [role.sourceId, null];
    }),
  );
}

/** A catalog entry as the declaration the timeline's rebinding rules read. */
function asResourceType(name: string, entry: { type: string; unit: string | null }): ResourceType {
  return {
    name,
    schema: { metadata: entry.unit ? { unit: { value: entry.unit } } : {}, type: entry.type } as ResourceType['schema'],
  };
}

/** A resource the target does not have under the presentation's name, and what the person chose to read instead. */
export function getResourceRenameKey(roleId: TimelineSourceId, name: string): string {
  return `${roleId}::${name}`;
}

export type PresentationIssue = {
  /**
   * 'omitted': the layer is left out. 'warning': it is kept, and this is what to check. 'unverified': kept, but what
   * the source offers could not be read, so whether it shows anything is not known.
   */
  effect: 'omitted' | 'unverified' | 'warning';
  layer: string;
  /** Set when a resource of that name is missing from the target: it can be mapped by hand. */
  /** A layer focused on records (by their keys) the target doesn't have: the person remaps or clears the focus. */
  missingFocus?: { key: string; name: string; targetId: TimelineSourceId; within: string[] };
  missingResource?: { name: string; roleId: TimelineSourceId; type: string | null };
  reason: string;
  row: string;
  rowId: number;
};

export type PresentationOptions = {
  /**
   * What a focused layer's records are in each target, by getFocusKey: whether they are there, read from the target
   * (absent: not checked yet). A focus is never matched by name or type alone.
   */
  focusChecks?: Record<string, boolean>;
  /** By getFocusKey: for a focus the target lacks, the person's choice: another record's key, or '' to clear it. */
  focusChoices?: Record<string, string>;
  /** Which target source each of the original's sources (roles) becomes. */
  mapping: RoleMapping;
  /** By getResourceRenameKey: the target resource to read where the name is missing. */
  resourceRenames: Record<string, string>;
};

/** The key of a focused layer's records in a target source, for focusChecks and focusChoices. */
export function getFocusKey(targetId: TimelineSourceId, within: string[]): string {
  return `${targetId}::${[...within].sort().join('|')}`;
}

/** The focused layers of a timeline (their records' keys, by the source they read), to check in each target. */
export function getFocusedLayers(timeline: Timeline): { name: string; roleId: TimelineSourceId; within: string[] }[] {
  return timeline.rows.flatMap(row =>
    row.layers.flatMap(layer =>
      isActivityLayer(layer) && layer.filter.activity?.within?.length
        ? [{ name: layer.name, roleId: layer.sourceId ?? '', within: layer.filter.activity.within }]
        : [],
    ),
  );
}

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
  { focusChecks = {}, focusChoices = {}, mapping, resourceRenames }: PresentationOptions,
): PresentationResult {
  const timeline = structuredClone(source);
  const issues: PresentationIssue[] = [];
  let kept = 0;
  let total = 0;

  type Translated = { layer: Layer; rebind?: { next: ResourceType; previous: ResourceType | null } };
  const translate = (layer: Layer, row: Row): Translated | null => {
    const roleId = layer.sourceId ?? '';
    const issue = (effect: PresentationIssue['effect'], reason: string, extra: Partial<PresentationIssue> = {}) =>
      issues.push({ effect, layer: layer.name, reason, row: row.name, rowId: row.id, ...extra });
    const targetId = mapping[roleId];
    const target = targetId ? targetCatalogs[targetId] : undefined;
    if (!targetId || !target) {
      issue('omitted', 'Its source is not shown');
      return null;
    }
    const label = targetLabels[targetId] ?? targetId;
    if (isActivityLayer(layer)) {
      const types = layer.filter.activity?.static_types ?? [];
      if (!target.activityTypes) {
        issue('unverified', `${label}'s activity types could not be read: not checked`);
        return { layer: { ...layer, sourceId: targetId } };
      }
      const absent = types.filter(type => !target.activityTypes?.has(type));
      const list = `${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ` and ${absent.length - 3} more` : ''}`;
      // A layer every type of which is absent would draw nothing: kept, it would look applied and show nothing.
      if (types.length && absent.length === types.length) {
        issue('omitted', `${label} has no ${list}`);
        return null;
      }
      if (absent.length) {
        issue('warning', `${label} has no ${list}: shows the other types only`);
      }
      // A focus names records by their keys in the original: kept only if the target has them, else what the person
      // chose (another record, or no focus). Never matched by name: two sequences of one name are not the same one.
      const within = layer.filter.activity?.within;
      if (within?.length) {
        const key = getFocusKey(targetId, within);
        const choice = focusChoices[key];
        const focusOf = (next: string[] | undefined): Layer => {
          const { within: _, ...activity } = layer.filter.activity ?? {};
          return {
            ...layer,
            filter: { ...layer.filter, activity: next ? { ...activity, within: next } : activity },
            sourceId: targetId,
          };
        };
        if (focusChecks[key] === undefined) {
          issue('unverified', `Its focus on ${layer.name} is being checked in ${label}`);
        } else if (!focusChecks[key] && choice === undefined) {
          issue('omitted', `${label} has no ${layer.name} (the record it focused on)`, {
            missingFocus: { key, name: layer.name, targetId, within },
          });
          return null;
        } else if (!focusChecks[key] && choice === '') {
          issue('warning', `Focus on ${layer.name} cleared: shows every record of its types`);
          return { layer: focusOf(undefined) };
        } else if (!focusChecks[key] && choice) {
          issue('warning', `Focus moved from ${layer.name} to the chosen record`);
          return { layer: focusOf([choice]) };
        }
      }
      return { layer: { ...layer, sourceId: targetId } };
    }
    const original = layer.filter.resource ?? '';
    if (!target.resources) {
      issue('unverified', `${label}'s resources could not be read: not checked`);
      return { layer: { ...layer, sourceId: targetId } };
    }
    const was = sourceCatalogs[roleId]?.resources?.get(original) ?? null;
    // A chosen replacement wins: it is also how a resource of the wrong type is replaced.
    const name =
      resourceRenames[getResourceRenameKey(roleId, original)] ??
      (target.resources.has(original) ? original : undefined);
    const now = name ? target.resources.get(name) : undefined;
    if (!name || !now) {
      issue('omitted', `${label} has no ${original}`, {
        missingResource: { name: original, roleId, type: was?.type ?? null },
      });
      return null;
    }
    if (was && was.type !== now.type) {
      issue(
        'omitted',
        `${name} is ${now.type} in ${label}, not ${was.type}: pick a ${was.type} resource or leave it out`,
        {
          missingResource: { name: original, roleId, type: was.type },
        },
      );
      return null;
    }
    if (name !== original) {
      issue('warning', `Reads ${name} in place of ${original}, as chosen`);
    }
    const unitChanged = !!was && (was.unit ?? '') !== (now.unit ?? '');
    if (unitChanged) {
      issue(
        'warning',
        `${name} is in ${now.unit || 'no unit'} in ${label}, not ${was?.unit || 'no unit'}: its axis is rescaled and its value guides dropped, not converted`,
      );
    }
    const translated = { ...layer, filter: { ...layer.filter, resource: name }, sourceId: targetId };
    return name !== original || unitChanged
      ? {
          layer: translated,
          rebind: { next: asResourceType(name, now), previous: was ? asResourceType(original, was) : null },
        }
      : { layer: translated };
  };

  timeline.rows = timeline.rows.flatMap(row => {
    const translated = row.layers.flatMap(layer => {
      total++;
      const result = translate(layer, row);
      kept += result ? 1 : 0;
      return result ? [result] : [];
    });
    if (row.layers.length && !translated.length) {
      Object.assign(timeline, removeRowFromTimelineHierarchy(timeline, row.id));
      timeline.annotations = removeValueAnnotations(timeline.annotations, row.id);
      return [];
    }
    // An axis only omitted layers used goes with them, with its value annotations.
    const usedAxes = new Set(translated.map(({ layer }) => layer.yAxisId));
    const keepAxis = (id: number) => usedAxes.has(id) || !row.layers.some(layer => layer.yAxisId === id);
    timeline.annotations = removeValueAnnotations(
      timeline.annotations,
      row.id,
      new Set(row.yAxes.filter(axis => !keepAxis(axis.id)).map(axis => axis.id)),
    );
    let next: Row = {
      ...row,
      layers: translated.map(({ layer }) => layer),
      yAxes: row.yAxes.filter(axis => keepAxis(axis.id)),
    };
    // Another resource, or the same one in another unit: the timeline's own rebinding rules refresh the axis and drop
    // value guides that no longer measure the same thing (500 W is not 500 kW).
    translated.forEach(({ layer, rebind }) => {
      if (rebind) {
        const targetId = layer.sourceId ?? '';
        const { horizontalGuides, ...rebound } = rebindResourceLayer(
          [timeline],
          { ...next, horizontalGuides: getHorizontalGuides(timeline, row.id) },
          layer,
          {
            previousResourceType: rebind.previous,
            resourceName: rebind.next.name,
            resourceType: rebind.next,
            sourceId: targetId,
            sourceLabel: targetLabels[targetId],
          },
        );
        next = { ...next, ...rebound };
        timeline.annotations = setHorizontalGuides(timeline.annotations, next, horizontalGuides);
      }
    });
    return [next];
  });
  // Which annotations come, and which of the target's stay, is decided when it replaces the target's timeline
  // (mergeAnnotationsForLayout): the target's findings stay, and the original's reusable annotations come.
  timeline.id = current.id;
  return { issues, kept, timeline, total };
}

/**
 * What a saved view shows, in a line for the Views picker: its rows, the kinds of data its layers draw, and the sources
 * it was saved with (an analysis's view names them; a Plan's view reads its plan).
 */
export function describeViewContents(
  rows: Pick<Row, 'layers'>[] | null,
  sources: Record<string, { name?: string }> | null,
): string {
  const kinds = new Set<string>();
  (rows ?? []).forEach(row =>
    row.layers.forEach(layer => {
      if (layer.chartType === 'line' || layer.chartType === 'x-range') {
        kinds.add('resources');
      } else if (layer.chartType === 'externalEvent') {
        kinds.add('external events');
      } else if (layer.chartType === 'activity') {
        kinds.add('activities');
      }
    }),
  );
  const count = rows?.length ?? 0;
  const names = Object.values(sources ?? {}).map(({ name }) => name ?? 'a source');
  return [
    `${count} row${count === 1 ? '' : 's'}`,
    ['activities', 'resources', 'external events'].filter(kind => kinds.has(kind)).join(', '),
    names.length
      ? `from ${names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
