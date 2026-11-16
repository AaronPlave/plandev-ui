import type { Annotation, HorizontalGuide, Row, Timeline, VerticalGuide } from '../types/timeline';

/*
 * Annotations (types/timeline.ts) are what a timeline stores. The timeline still draws time and value marks with its
 * guide renderers: VerticalGuide and HorizontalGuide are how an annotation is drawn, made here from annotations and
 * turned back into them when a guide is moved or edited in place. Nothing stores a guide.
 */

export const ANNOTATION_COLOR = '#d97706';

/** The next id for an annotation of any of `timelines` (ids are unique per timeline; one counter keeps it simple). */
export function getNextAnnotationId(timelines: Pick<Timeline, 'annotations'>[]): number {
  return Math.max(-1, ...timelines.flatMap(timeline => (timeline.annotations ?? []).map(({ id }) => id))) + 1;
}

/** The time and time-range annotations, drawn across the rows. */
export function getVerticalGuides(timeline: Pick<Timeline, 'annotations'> | null | undefined): VerticalGuide[] {
  return (timeline?.annotations ?? []).flatMap(annotation => {
    const { anchor } = annotation;
    return anchor.kind === 'time'
      ? [
          {
            ...(annotation.description ? { description: annotation.description } : {}),
            id: annotation.id,
            label: { ...annotation.labelStyle, color: annotation.color, text: annotation.label },
            timestamp: anchor.start,
            ...(anchor.end ? { timestamp2: anchor.end } : {}),
          },
        ]
      : [];
  });
}

/** One row's value and value-range annotations, drawn on its axes. */
export function getHorizontalGuides(
  timeline: Pick<Timeline, 'annotations'> | null | undefined,
  rowId: number,
): HorizontalGuide[] {
  return (timeline?.annotations ?? []).flatMap(annotation => {
    const { anchor } = annotation;
    return anchor.kind === 'value' && anchor.rowId === rowId
      ? [
          {
            ...(annotation.description ? { description: annotation.description } : {}),
            id: annotation.id,
            label: { ...annotation.labelStyle, color: annotation.color, text: annotation.label },
            y: anchor.y,
            ...(anchor.y2 !== undefined ? { y2: anchor.y2 } : {}),
            yAxisId: anchor.yAxisId,
          },
        ]
      : [];
  });
}

/** Each row's value annotations as guides, by row id. */
export function getHorizontalGuidesByRow(timeline: Timeline | null | undefined): Record<number, HorizontalGuide[]> {
  return Object.fromEntries((timeline?.rows ?? []).map(row => [row.id, getHorizontalGuides(timeline, row.id)]));
}

function fromGuideLabel(
  previous: Annotation | undefined,
  { color, text, ...style }: VerticalGuide['label'],
): Pick<Annotation, 'color' | 'label' | 'labelStyle'> {
  return {
    ...(color ? { color } : previous?.color ? { color: previous.color } : {}),
    label: text,
    ...(Object.keys(style).length ? { labelStyle: style } : {}),
  };
}

/**
 * `annotations` with its time annotations made to be `guides` (as the timeline's guide controls edit them): a guide's
 * annotation keeps everything a guide doesn't carry (who made it, whether it is reusable); a new guide is a new time
 * annotation; a time annotation whose guide is gone is removed. Other annotations are untouched.
 */
export function setVerticalGuides(annotations: Annotation[], guides: VerticalGuide[]): Annotation[] {
  const byId = new Map(annotations.map(annotation => [annotation.id, annotation]));
  const kept = new Set(guides.map(({ id }) => id));
  const updated = guides.map((guide): Annotation => {
    const previous = byId.get(guide.id);
    const { description: _, ...rest } = previous ?? ({} as Partial<Annotation>);
    return {
      ...rest,
      ...fromGuideLabel(previous, guide.label),
      anchor: { kind: 'time', start: guide.timestamp, ...(guide.timestamp2 ? { end: guide.timestamp2 } : {}) },
      ...(guide.description !== undefined
        ? guide.description
          ? { description: guide.description }
          : {}
        : previous?.description
          ? { description: previous.description }
          : {}),
      id: guide.id,
    };
  });
  const updatedById = new Map(updated.map(annotation => [annotation.id, annotation]));
  const result = annotations.flatMap(annotation =>
    annotation.anchor.kind === 'time'
      ? kept.has(annotation.id)
        ? [updatedById.get(annotation.id) as Annotation]
        : []
      : [annotation],
  );
  return [...result, ...updated.filter(({ id }) => !byId.has(id))];
}

/** Like setVerticalGuides, for one row's value annotations. */
export function setHorizontalGuides(
  annotations: Annotation[],
  row: Pick<Row, 'id' | 'name'>,
  guides: HorizontalGuide[],
): Annotation[] {
  const byId = new Map(annotations.map(annotation => [annotation.id, annotation]));
  const kept = new Set(guides.map(({ id }) => id));
  const updated = guides.map((guide): Annotation => {
    const previous = byId.get(guide.id);
    const units = previous?.anchor.kind === 'value' ? previous.anchor.units : undefined;
    return {
      ...previous,
      ...fromGuideLabel(previous, guide.label),
      anchor: {
        kind: 'value',
        rowId: row.id,
        rowName: row.name,
        ...(units ? { units } : {}),
        y: guide.y,
        ...(guide.y2 !== undefined ? { y2: guide.y2 } : {}),
        yAxisId: guide.yAxisId,
      },
      ...(guide.description ? { description: guide.description } : {}),
      ...(guide.description === undefined && previous?.description ? { description: previous.description } : {}),
      id: guide.id,
    };
  });
  const updatedById = new Map(updated.map(annotation => [annotation.id, annotation]));
  const result = annotations.flatMap(annotation =>
    annotation.anchor.kind === 'value' && annotation.anchor.rowId === row.id
      ? kept.has(annotation.id)
        ? [updatedById.get(annotation.id) as Annotation]
        : []
      : [annotation],
  );
  return [...result, ...updated.filter(({ id }) => !byId.has(id))];
}

/**
 * A timeline saved before annotations, with its guides as annotations: each vertical guide a time annotation (keeping
 * its id), each horizontal guide a value annotation of its row (numbered after them). Their labels, colors, label
 * styles and descriptions are kept; nothing is duplicated or dropped. The guide fields are removed.
 */
export function migrateGuidesToAnnotations<T extends Record<string, unknown>>(timeline: T): T {
  type LegacyGuideLabel = VerticalGuide['label'];
  const legacy = timeline as unknown as {
    annotations?: Annotation[];
    rows?: (Record<string, unknown> & { horizontalGuides?: HorizontalGuide[]; id: number; name: string })[];
    verticalGuides?: VerticalGuide[];
  };
  const toFields = (description: string | undefined, label: LegacyGuideLabel) => {
    const { color, text, ...style } = label ?? { text: '' };
    return {
      ...(color ? { color } : {}),
      ...(description ? { description } : {}),
      label: text ?? '',
      ...(Object.keys(style).length ? { labelStyle: style } : {}),
    };
  };
  const annotations: Annotation[] = [...(legacy.annotations ?? [])];
  (legacy.verticalGuides ?? []).forEach(guide =>
    annotations.push({
      ...toFields(guide.description, guide.label),
      anchor: { kind: 'time', start: guide.timestamp, ...(guide.timestamp2 ? { end: guide.timestamp2 } : {}) },
      id: guide.id,
    }),
  );
  let nextId = getNextAnnotationId([{ annotations }]);
  const rows = (legacy.rows ?? []).map(row => {
    const { horizontalGuides, ...rest } = row;
    (horizontalGuides ?? []).forEach(guide =>
      annotations.push({
        ...toFields(guide.description, guide.label),
        anchor: {
          kind: 'value',
          rowId: row.id,
          rowName: row.name,
          y: guide.y,
          ...(guide.y2 !== undefined ? { y2: guide.y2 } : {}),
          yAxisId: guide.yAxisId,
        },
        id: nextId++,
      }),
    );
    return rest;
  });
  const { verticalGuides: _, ...rest } = timeline as T & { verticalGuides?: unknown };
  return { ...rest, annotations, rows } as unknown as T;
}

/**
 * Value annotations of rows that are no longer on `timeline` say so (`rowId` null), keeping what they marked and the
 * row's name: a row id can be reused by another row, which must never take over another row's marks.
 */
export function detachValueAnnotations(annotations: Annotation[], rowIds: Set<number>): Annotation[] {
  return annotations.map(annotation =>
    annotation.anchor.kind === 'value' && annotation.anchor.rowId !== null && !rowIds.has(annotation.anchor.rowId)
      ? { ...annotation, anchor: { ...annotation.anchor, rowId: null } }
      : annotation,
  );
}

/**
 * Copies of `from`'s value annotations for `to`, a copy of that row whose axes were made in the same order, numbered
 * from `firstId`.
 */
export function copyRowAnnotations(annotations: Annotation[], from: Row, to: Row, firstId: number): Annotation[] {
  let id = firstId;
  return annotations.flatMap(annotation => {
    const { anchor } = annotation;
    const axisIndex = anchor.kind === 'value' ? from.yAxes.findIndex(axis => axis.id === anchor.yAxisId) : -1;
    return anchor.kind === 'value' && anchor.rowId === from.id && to.yAxes[axisIndex]
      ? [
          {
            ...annotation,
            anchor: { ...anchor, rowId: to.id, rowName: to.name, yAxisId: to.yAxes[axisIndex].id },
            id: id++,
          },
        ]
      : [];
  });
}

/**
 * `annotations` without the value annotations of a row (of the given axes only, when `axisIds` is given): what goes
 * with a row or an axis that is removed, as its guides did.
 */
export function removeValueAnnotations(annotations: Annotation[], rowId: number, axisIds?: Set<number>): Annotation[] {
  return annotations.filter(
    ({ anchor }) =>
      anchor.kind !== 'value' || anchor.rowId !== rowId || (axisIds !== undefined && !axisIds.has(anchor.yAxisId)),
  );
}

/** Like removeValueAnnotations, for every row not in `rowIds`. */
export function keepValueAnnotationsOfRows(annotations: Annotation[], rowIds: Set<number>): Annotation[] {
  return annotations.filter(
    ({ anchor }) => anchor.kind !== 'value' || anchor.rowId === null || rowIds.has(anchor.rowId),
  );
}
