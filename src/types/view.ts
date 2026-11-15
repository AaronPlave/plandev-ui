import type { ColDef, ColumnState } from 'ag-grid-community';
import type { UserId } from './app';
import type { AnalysisSourceTarget } from './analysis';
import type { Timeline } from './timeline';

export type AutoSizeColumns = 'fit' | 'fill' | 'off';

export type ViewTable = {
  autoSizeColumns?: AutoSizeColumns;
  columnDefs: ColDef[];
  columnStates: ColumnState[];
};

export type ViewSaveEvent = Partial<View>;
export type ViewToggleType = 'left' | 'left-split' | 'bottom' | 'right' | 'right-split';
export type ViewToggleEvent = {
  state: boolean;
  type: ViewToggleType;
  update?: Partial<ViewGrid>;
};

export type ViewIFrame = {
  id: number;
  src: string;
  title: string;
};

export type ViewInsertInput = {
  definition: ViewDefinition;
  name: string;
};
export type ViewUpdateInput = ViewInsertInput;

export type ViewGridComponent =
  | 'ActivityDirectivesTablePanel'
  | 'ActivityFormPanel'
  | 'ActivitySpansTablePanel'
  | 'TimelineItemsPanel'
  | 'ConstraintsPanel'
  | 'ExpansionPanel'
  | 'ExternalSourcesPanel'
  | 'ExternalEventFormPanel'
  | 'ExternalEventsTablePanel'
  | 'IFramePanel'
  | 'PlanMetadataPanel'
  | 'SchedulingConditionsPanel'
  | 'SchedulingGoalsPanel'
  | 'SimulationPanel'
  | 'SimulationEventsPanel'
  | 'TimeCursorPanel'
  | 'TimelineEditorPanel';

export type ViewGridSection = 'LeftBottom' | 'LeftTop' | 'MiddleBottom' | 'RightBottom' | 'RightTop';

export type ViewGridColumns = {
  col1?: string;
  col2?: string;
  col3?: string;
};

export type ViewGridRows = {
  row1?: string;
  row2?: string;
};

export type ViewGrid = {
  columnSizes: string;
  leftComponentBottom: ViewGridComponent;
  leftComponentTop: ViewGridComponent;
  leftHidden: boolean;
  leftRowSizes: string;
  leftSplit: boolean;
  middleComponentBottom: ViewGridComponent;
  middleRowSizes: string;
  middleSplit: boolean;
  rightComponentBottom: ViewGridComponent;
  rightComponentTop: ViewGridComponent;
  rightHidden: boolean;
  rightRowSizes: string;
  rightSplit: boolean;
};

/**
 * What a layout saved from an Analysis says about each data its layers name (by that data's identity, e.g.
 * "revision:217"): its role in the layout (the alias it had), what it was, and the resources the layers read with
 * their type and unit. So the role stays understandable, and its rows checkable, after that data is gone.
 */
export type AnalysisLayoutSource = {
  binding: AnalysisSourceTarget & { label?: string };
  /** What the data was when the layout was saved, e.g. "cruise015, revision 217". */
  name: string;
  resources: Record<string, { type: string; unit: string | null }>;
};

export type AnalysisLayout = { sources: Record<string, AnalysisLayoutSource> };

export type ViewDefinition = {
  /** Present on a layout saved from an Analysis (see saveAnalysisLayoutAsView); what says it is one. */
  analysisLayout?: AnalysisLayout;
  plan: {
    activityDirectivesTable: ViewTable;
    activitySpansTable: ViewTable;
    grid: ViewGrid;
    iFrames: ViewIFrame[];
    simulationEventsTable: ViewTable;
    timelines: Timeline[];
  };
  version: number;
};

export type View = {
  created_at: string;
  definition: ViewDefinition;
  id: number;
  name: string;
  owner: UserId;
  updated_at: string;
};

export type ViewSlim = Omit<View, 'definition'> & {
  /** Saved from an Analysis: its layers name the data they read, so it is used from an Analysis, not on a Plan. */
  analysis_layout?: boolean;
};
