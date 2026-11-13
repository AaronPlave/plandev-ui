import {
  CalendarClock,
  CalendarRange,
  ChartColumn,
  ChartGantt,
  ChartLine,
  Database,
  Play,
  type Icon,
} from 'lucide-svelte';
import type { ComponentType } from 'svelte';
import type { SourceBrowserNode } from '../../types/timelineSource';

type IconComponent = ComponentType<Icon>;

/** The icon of a top-level group of the Sources browser (and of the sources inside it), by the group's name. */
function getGroupIcon(group: string): IconComponent {
  switch (group) {
    case 'Plan':
    case 'Plans':
      return CalendarRange;
    case 'Simulations':
      return Play;
    case 'External Events':
      return CalendarClock;
    default:
      // Imported sources, external datasets: data that came from somewhere else.
      return Database;
  }
}

/**
 * The icon that says what a Sources browser node is, read from what it already carries, so the tree needs nothing
 * from the source adapters: a source or group by the top-level group it is in, an activity type, a resource
 * (continuous when its values are real numbers, discrete otherwise), or a section of one source's resources or
 * activity types. Null where an icon would only add noise.
 */
export function getSourceNodeIcon(node: SourceBrowserNode, group: string, depth: number): IconComponent | null {
  if (node.kind === 'item') {
    switch (node.action?.typeName) {
      case 'activity':
        return ChartGantt;
      case 'externalEvent':
        return CalendarClock;
      case 'resource':
        return node.tags?.includes('real') ? ChartLine : ChartColumn;
      default:
        return null;
    }
  }
  if (depth === 0 || node.kind === 'source') {
    return getGroupIcon(group);
  }
  if (node.id.includes('/resource')) {
    return ChartLine;
  }
  if (node.id.includes('/activit')) {
    return ChartGantt;
  }
  return null;
}
