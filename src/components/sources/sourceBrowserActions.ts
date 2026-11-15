import { viewAddFilterToRow } from '../../stores/views';
import type { Layer, Row, TimelineItemMetadata } from '../../types/timeline';
import type { SourceBrowserAction, TimelineSourceRegistry } from '../../types/timelineSource';
import { getSource } from '../../utilities/timelineSources';

/* What adding a Sources browser item to the timeline does, wherever the browser is shown. */

function getMetadata(registry: TimelineSourceRegistry, action: SourceBrowserAction): TimelineItemMetadata {
  return {
    ...(action.externalSources ? { externalSources: action.externalSources } : {}),
    sourceId: action.sourceId,
    sourceLabel: action.sourceId ? getSource(registry, action.sourceId)?.label : undefined,
  };
}

/** Adds the item to `row` (or a new row), on `layer` when given. */
export function addSourceItem(registry: TimelineSourceRegistry, action: SourceBrowserAction, row?: Row, layer?: Layer) {
  viewAddFilterToRow([action.item], action.typeName, getMetadata(registry, action), row?.id, layer);
}

/** Puts the item on a drag, for a drop on the timeline. */
export function dragSourceItem(registry: TimelineSourceRegistry, action: SourceBrowserAction, event: DragEvent) {
  if (event.dataTransfer) {
    const payload = { items: [action.item], metadata: getMetadata(registry, action), type: action.typeName };
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.dropEffect = 'link';
    event.dataTransfer.effectAllowed = 'link';
  }
}
