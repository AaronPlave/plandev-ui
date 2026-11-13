<svelte:options immutable={true} />

<script lang="ts">
  import {
    attachClosestEdge,
    extractClosestEdge,
    type Edge,
  } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
  import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
  import {
    draggable,
    dropTargetForElements,
    monitorForElements,
  } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
  import { DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import ArrowLeftIcon from '@nasa-jpl/stellar/icons/arrow_left.svg?component';
  import CaretDownIcon from '@nasa-jpl/stellar/icons/caret_down.svg?component';
  import CaretRightIcon from '@nasa-jpl/stellar/icons/caret_right.svg?component';
  import CloseIcon from '@nasa-jpl/stellar/icons/close.svg?component';
  import DuplicateIcon from '@nasa-jpl/stellar/icons/duplicate.svg?component';
  import PenIcon from '@nasa-jpl/stellar/icons/pen.svg?component';
  import RemoveAllIcon from '@nasa-jpl/stellar/icons/remove_all.svg?component';
  import { Ellipsis, FolderPlus, FolderX, GripVertical, ListPlus } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import {
    ViewDefaultDiscreteOptions,
    ViewDefaultSectionColor,
    ViewSectionColorPresets,
  } from '../../../constants/view';
  import { ViewConstants } from '../../../enums/view';
  import { planDatasets, viewTimeRange } from '../../../stores/plan';
  import { resourceTypes, simulationDataset, yAxesWithScaleDomainsCache } from '../../../stores/simulation';
  import { getTimelineSourcesContext } from '../../../stores/timelineSources';
  import {
    selectedRowId,
    selectedSectionId,
    selectedTimelineId,
    view,
    viewAddSection,
    viewAddTimelineRow,
    viewDeleteSection,
    viewReorderTimelineItems,
    viewSetSelectedRow,
    viewSetSelectedSection,
    viewSetSelectedTimeline,
    viewUpdateRow,
    viewUpdateRowProperties,
    viewUpdateSection,
    viewUpdateTimeline,
  } from '../../../stores/views';
  import type {
    ActivityLayer,
    ActivityOptions,
    Axis,
    ChartType,
    DiscreteOptions,
    ExternalEventLayer,
    ExternalEventOptions,
    HorizontalGuide,
    Layer,
    LineLayer,
    Row,
    Timeline,
    TimeRange,
    TimelineItemRef,
    TimelineSection,
    VerticalGuide,
    XRangeLayer,
  } from '../../../types/timeline';
  import type { ViewGridSection } from '../../../types/view';
  import effects from '../../../utilities/effects';
  import { getTarget } from '../../../utilities/generic';
  import { getDoyTime } from '../../../utilities/time';
  import {
    applyTimelineItemDrop,
    DEFAULT_MARKER_STYLE,
    createHorizontalGuide,
    createTimelineActivityLayer,
    createTimelineExternalEventLayer,
    createTimelineLineLayer,
    createTimelineXRangeLayer,
    createVerticalGuide,
    createYAxis,
    getContrastingTextColor,
    getNextLayerID,
    getRenderableTimelineItems,
    isActivityLayer,
    isExternalEventLayer,
    isLineLayer,
    isXRangeLayer,
    rebindResourceLayer,
    toTimelineDropEdge,
  } from '../../../utilities/timeline';
  import {
    findLegacyResourceType,
    findResourceType,
    getSource,
    PLAN_SOURCE_ID,
  } from '../../../utilities/timelineSources';
  import { createTimelineDragActions, type TimelineDragData } from '../../../utilities/timelineDragDrop';
  import { tooltip } from '../../../utilities/tooltip';
  import ColorPresetsPicker from '../../form/ColorPresetsPicker.svelte';
  import Input from '../../form/Input.svelte';
  import GridMenu from '../../menus/GridMenu.svelte';
  import ParameterUnits from '../../parameters/ParameterUnits.svelte';
  import CssGrid from '../../ui/CssGrid.svelte';
  import InfoTip from '../../ui/InfoTip.svelte';
  import Panel from '../../ui/Panel.svelte';
  import EditorSection from './TimelineEditor/EditorSection.svelte';
  import TimelineEditorGuideRow from './TimelineEditorGuideRow.svelte';
  import TimelineEditorOptionButtons from './TimelineEditorOptionButtons.svelte';
  import TimelineLayerEditor from './TimelineEditor/TimelineLayerEditor.svelte';
  import TimelineEditorYAxisSettings from './TimelineEditorYAxisSettings.svelte';

  const timelineSources = getTimelineSourcesContext();

  export let gridSection: ViewGridSection;
  /** False under a tab that already names it. */
  export let showHeader: boolean = true;
  /** The time guides may be placed in; the Plan's when not given. */
  export let timeBounds: TimeRange | null = null;

  /** Shared by the directive and zero-duration marker controls, which offer the same shapes. */
  const MARKER_STYLE_OPTIONS: { id: string; label: string }[] = [
    { id: 'line', label: 'Line' },
    { id: 'dot', label: 'Dot' },
    { id: 'diamond', label: 'Diamond' },
  ];

  let horizontalGuides: HorizontalGuide[] = [];
  let editorDiv: HTMLDivElement;
  let editorWidth: number;
  let layers: Layer[] = [];
  let activityLayers: ActivityLayer[] = [];
  let resourceLayers: (LineLayer | XRangeLayer)[] = [];
  let externalEventLayers: ExternalEventLayer[] = [];
  let timelines: Timeline[] = [];
  let rowHasNonActivityChartLayer: boolean = false;
  let items: TimelineItemRef[] = [];
  let rows: Row[] = [];
  let sections: TimelineSection[] = [];
  let selectedTimeline: Timeline | undefined;
  let selectedRow: Row | undefined;
  let selectedSection: TimelineSection | undefined;
  let verticalGuides: VerticalGuide[] = [];
  let rowHasActivityLayer: boolean | ActivityLayer = false;
  let rowHasExternalEventLayer: boolean | ExternalEventLayer = false;
  let yAxes: Axis[] = [];

  let monitorCleanup: (() => void) | null = null;

  $: selectedTimeline = $view?.definition.plan.timelines.find(t => t.id === $selectedTimelineId);
  // Never render straight from timeline.items: a stale ref collides with a reused id and throws
  // out of the keyed each below. The drop helper takes the healed order too, so a drop writes
  // it back.
  $: items = selectedTimeline ? getRenderableTimelineItems(selectedTimeline) : [];
  $: hierarchy = { items, sections };
  $: rows = selectedTimeline?.rows || [];
  $: sections = selectedTimeline?.sections || [];
  $: rowsById = new Map(rows.map(row => [row.id, row]));
  $: sectionsById = new Map(sections.map(section => [section.id, section]));

  $: timelines = $view?.definition.plan.timelines || [];
  $: verticalGuides = selectedTimeline?.verticalGuides || [];
  $: selectedRow = rows.find(row => row.id === $selectedRowId);
  $: selectedSection = sections.find(section => section.id === $selectedSectionId);
  $: horizontalGuides = selectedRow?.horizontalGuides || [];
  $: yAxes = selectedRow?.yAxes || [];
  $: layers = selectedRow?.layers || [];
  $: if (layers) {
    activityLayers = [];
    resourceLayers = [];
    externalEventLayers = [];
    layers.forEach(l => {
      if (isActivityLayer(l)) {
        activityLayers.push(l);
      } else if (isLineLayer(l) || isXRangeLayer(l)) {
        resourceLayers.push(l);
      } else if (isExternalEventLayer(l)) {
        externalEventLayers.push(l);
      }
    });
  }
  $: rowHasActivityLayer = !!selectedRow?.layers.find(isActivityLayer) || false;
  $: rowHasExternalEventLayer = selectedRow?.layers.find(isExternalEventLayer) || false;
  $: rowHasNonActivityChartLayer =
    !!selectedRow?.layers.find(layer => isLineLayer(layer) || isXRangeLayer(layer)) || false;
  $: if ((rowHasActivityLayer || rowHasExternalEventLayer) && selectedRow && !selectedRow.discreteOptions) {
    viewUpdateRow('discreteOptions', ViewDefaultDiscreteOptions);
  }
  $: discreteOptions = selectedRow?.discreteOptions || { ...ViewDefaultDiscreteOptions };

  function updateRowEvent(event: Event) {
    const { name, value } = getTarget(event);
    viewUpdateRow(name, value);
  }

  function updateRowMinHeight(event: Event) {
    const { name, value } = getTarget(event);
    if (typeof value === 'number' && !isNaN(value)) {
      if (value >= ViewConstants.MIN_ROW_HEIGHT) {
        viewUpdateRow(name, value);
      }
    }
  }

  function updateTimelineEvent(event: Event) {
    const { name, value } = getTarget(event);
    viewUpdateTimeline(name, value);
  }

  function updateTimelineMarginLeft(event: Event) {
    const { name, value } = getTarget(event);
    if (typeof value === 'number' && !isNaN(value)) {
      if (value >= ViewConstants.MIN_MARGIN_LEFT) {
        viewUpdateRow(name, value);
        viewUpdateTimeline(name, value);
      }
    }
  }

  function updateYAxisTickCount(event: Event, yAxis: Axis) {
    const { value: v } = getTarget(event);
    const numberValue = v as number;
    const value = isNaN(numberValue) ? null : numberValue;

    const newRowYAxes = yAxes.map(axis => {
      if (axis.id === yAxis.id) {
        axis.tickCount = value;
      }
      return axis;
    });
    viewUpdateRow('yAxes', newRowYAxes);
  }

  function handleNewYAxisClick() {
    const yAxis = createYAxis(timelines);
    yAxes = [...yAxes, yAxis];
    viewUpdateRow('yAxes', yAxes);
  }

  function handleRemoveAllYAxesClick() {
    effects.deleteTimelineYAxes();
  }

  function handleDeleteYAxisClick(yAxis: Axis) {
    const filteredYAxes = yAxes.filter(axis => axis.id !== yAxis.id);
    viewUpdateRow('yAxes', filteredYAxes);
  }

  // TODO move to a util?
  function createTimelineLayer(chartType: Layer['chartType']): Layer {
    switch (chartType) {
      // New resource layers read the Plan's simulation until another source is chosen
      case 'line':
        return createTimelineLineLayer(timelines, yAxes, { sourceId: PLAN_SOURCE_ID });
      case 'x-range':
        return createTimelineXRangeLayer(timelines, yAxes, { sourceId: PLAN_SOURCE_ID });
      case 'externalEvent':
        return createTimelineExternalEventLayer(timelines);
      default:
        return createTimelineActivityLayer(timelines);
    }
  }

  function handleNewLayerClick(chartType: Layer['chartType']) {
    let layer = createTimelineLayer(chartType);

    // Assign yAxisId to existing value or new axis
    if (chartType === 'line' || chartType === 'x-range') {
      if (yAxes.length > 0) {
        layer.yAxisId = yAxes[0].id;
      } else {
        handleNewYAxisClick();
        layer.yAxisId = yAxes[0].id;
      }
    }

    layers = [...layers, layer];
    viewUpdateRow('layers', layers);
  }

  function handleRemoveAllLayersClick(chartType: 'activity' | 'resource' | 'externalEvent') {
    effects.deleteTimelineLayers(layers, chartType);
  }

  function handleDeleteLayerClick(layer: Layer) {
    const filteredLayers = layers.filter(l => l.id !== layer.id);
    viewUpdateRow('layers', filteredLayers);
  }

  function handleDuplicateLayer(layer: Layer) {
    const duplicatedLayer = { ...structuredClone(layer), id: getNextLayerID(timelines) };
    viewUpdateRow('layers', [...layers, duplicatedLayer]);
  }

  /**
   * Discrete option writers, split from their event adapters so the segmented controls and the
   * remaining dropdowns share one path to the view rather than each reimplementing the merge.
   */
  function applyDiscreteOption(name: keyof DiscreteOptions, value: unknown) {
    viewUpdateRow('discreteOptions', { ...discreteOptions, [name]: value });
  }

  function applyActivityOption(name: keyof ActivityOptions, value: unknown) {
    viewUpdateRow('discreteOptions', {
      ...discreteOptions,
      activityOptions: { ...discreteOptions.activityOptions, [name]: value },
    });
  }

  function applyExternalEventOption(name: keyof ExternalEventOptions, value: unknown) {
    viewUpdateRow('discreteOptions', {
      ...discreteOptions,
      externalEventOptions: { ...discreteOptions.externalEventOptions, [name]: value },
    });
  }

  function handleActivityOptionSelectChange(event: Event, name: keyof ActivityOptions) {
    const { value } = getTarget(event);
    applyActivityOption(name, value);
  }

  function addTimelineRow() {
    viewAddTimelineRow();
  }

  function addSection() {
    viewAddSection();
  }

  function updateSectionEvent(event: Event) {
    const { name, value } = getTarget(event);
    viewUpdateSection(name as keyof TimelineSection, value);
  }

  function removeAllTimelineRows() {
    if (!selectedTimeline) {
      return;
    }
    effects.deleteTimelineRows($selectedTimelineId);
  }

  function removeAllSections() {
    effects.deleteTimelineSections($selectedTimelineId);
  }

  function handleDrop(
    sourceData: TimelineDragData,
    targetItemId: number,
    targetItemType: TimelineDragData['itemType'],
    targetSectionId: number | null,
    edge: Edge | null,
  ) {
    if (!selectedTimeline) {
      return;
    }

    const next = applyTimelineItemDrop(hierarchy, {
      edge: toTimelineDropEdge(edge),
      source: sourceData,
      target: { itemId: targetItemId, itemType: targetItemType, sectionId: targetSectionId },
    });

    if (next === null) {
      return;
    }

    viewReorderTimelineItems(next.items, $selectedTimelineId, next.sections);
  }

  /**
   * A press starts a drag only on an item's inert surface: its name, its grip, its blank space.
   * The whole item is the draggable, so without this a press inside one of the inputs or buttons
   * it contains dragged the item instead of doing what the control is for.
   */
  function isDragSurface(element: Element | null): boolean {
    return !!element && !element.closest('a, button, input, select, textarea, [contenteditable="true"]');
  }

  // Shared with the timeline itself, which presents the same hierarchy and so needs the same four
  // actions. Only the drag surfaces differ between the two.
  const {
    clearDragFeedback,
    destroyAll,
    makeDraggable,
    makeDropTarget,
    makeEmptySectionDropTarget,
    makeSectionDropTarget,
    removeDropIndicator,
    toAction,
    updateDropIndicator,
  } = createTimelineDragActions({ isDragSurface, onDrop: handleDrop });

  onMount(() => {
    monitorCleanup = monitorForElements({
      onDragStart: () => clearDragFeedback(editorDiv),
      onDrop: () => clearDragFeedback(editorDiv),
    });
  });

  onDestroy(() => {
    destroyAll();
    if (monitorCleanup) {
      monitorCleanup();
      monitorCleanup = null;
    }
  });

  function makeYAxisDraggable(node: HTMLElement, initialParams: { axisId: number }) {
    let params = initialParams;

    const cleanup = combine(
      draggable({
        canDrag: ({ input }) => isDragSurface(document.elementFromPoint(input.clientX, input.clientY)),
        element: node,
        getInitialData: () => ({ axisId: params.axisId, itemType: 'yAxis' }),
        onDragStart: () => node.classList.add('dragging'),
        onDrop: () => node.classList.remove('dragging'),
      }),
      dropTargetForElements({
        canDrop: ({ source }) => source.data.itemType === 'yAxis' && source.data.axisId !== params.axisId,
        element: node,
        getData: ({ element, input }) =>
          attachClosestEdge({ axisId: params.axisId }, { allowedEdges: ['top', 'bottom'], element, input }),
        onDrag: ({ self }) => updateDropIndicator(node, extractClosestEdge(self.data)),
        onDragLeave: () => removeDropIndicator(node),
        onDrop: ({ self, source }) => {
          removeDropIndicator(node);
          reorderYAxis(source.data.axisId as number, params.axisId, extractClosestEdge(self.data));
        },
      }),
    );

    return toAction<{ axisId: number }>(cleanup, next => (params = next));
  }

  function reorderYAxis(sourceId: number, targetId: number, edge: string | null) {
    const from = yAxes.findIndex(axis => axis.id === sourceId);
    const targetIndex = yAxes.findIndex(axis => axis.id === targetId);
    if (from < 0 || targetIndex < 0) {
      return;
    }

    const remaining = yAxes.filter(axis => axis.id !== sourceId);
    const insertAt = remaining.findIndex(axis => axis.id === targetId) + (edge === 'bottom' ? 1 : 0);
    const reordered = [...remaining.slice(0, insertAt), yAxes[from], ...remaining.slice(insertAt)];

    yAxes = reordered;
    viewUpdateRow('yAxes', reordered);
  }

  function handleDeleteVerticalGuideClick(verticalGuide: VerticalGuide) {
    const filteredVerticalGuides = verticalGuides.filter(guide => guide.id !== verticalGuide.id);
    viewUpdateTimeline('verticalGuides', filteredVerticalGuides, $selectedTimelineId);
  }

  function handleDeleteHorizontalGuideClick(horizontalGuide: HorizontalGuide) {
    const filteredHorizontalGuides = horizontalGuides.filter(guide => guide.id !== horizontalGuide.id);
    viewUpdateRow('horizontalGuides', filteredHorizontalGuides);
  }

  /**
   * Guide row fields that live inside the guide's nested `label` rather than on the guide itself, keyed
   * by the name the row emits. Flattened at the row so it emits one shape of event for every field it
   * owns, instead of the caller having to know which fields are nested.
   */
  const LABEL_FIELDS: Record<string, string> = {
    labelColor: 'color',
    labelText: 'text',
  };

  /**
   * One field change from a guide row. `null` is only ever the band's second bound being cleared, which
   * is how a band is turned back into a line -- the writers below remove the field rather than store it.
   */
  type GuideRowChange = { name: string; value: string | number | null };

  /**
   * Applies one field change from a guide row. A null for the band's second bound removes the field
   * rather than storing it, which is the only way to turn a band back into a line.
   */
  function onHorizontalGuideInput(event: CustomEvent<GuideRowChange>, horizontalGuide: HorizontalGuide) {
    applyHorizontalGuideChange(event.detail.name, event.detail.value, horizontalGuide);
  }

  function applyHorizontalGuideChange(name: string, value: GuideRowChange['value'], horizontalGuide: HorizontalGuide) {
    const newHorizontalGuides = horizontalGuides.map(guide => {
      if (guide.id !== horizontalGuide.id) {
        return guide;
      }
      if (name === 'y2' && value === null) {
        const { y2: _removed, ...rest } = guide;
        return rest;
      }
      const labelField = LABEL_FIELDS[name];
      if (labelField) {
        return { ...guide, label: { ...guide.label, [labelField]: value } };
      }
      return { ...guide, [name]: value };
    });
    viewUpdateRow('horizontalGuides', newHorizontalGuides);
  }

  function onVerticalGuideInput(event: CustomEvent<GuideRowChange>, verticalGuide: VerticalGuide) {
    applyVerticalGuideChange(event.detail.name, event.detail.value, verticalGuide);
  }

  function applyVerticalGuideChange(name: string, value: GuideRowChange['value'], verticalGuide: VerticalGuide) {
    const newVerticalGuides = verticalGuides.map(guide => {
      if (guide.id !== verticalGuide.id) {
        return guide;
      }
      if (name === 'timestamp2' && !value) {
        const { timestamp2: _removed, ...rest } = guide;
        return rest;
      }
      const labelField = LABEL_FIELDS[name];
      if (labelField) {
        return { ...guide, label: { ...guide.label, [labelField]: value } };
      }
      return { ...guide, [name]: value };
    });
    viewUpdateTimeline('verticalGuides', newVerticalGuides, $selectedTimelineId);
  }

  function handleUpdateLayerProperty(property: string, value: string | number | boolean | object | null, layer: Layer) {
    const newLayers = layers.map(l => {
      if (layer.id === l.id) {
        return {
          ...layer,
          [property]: value,
        };
      }
      return l;
    });
    viewUpdateRow('layers', newLayers);
  }

  // Rebinding a layer to another source and updating its filter must be one update: two dispatches would each
  // start from the same stale layer and the second would undo the first.
  function handleUpdateLayerSource(sourceId: string | null, filter: Layer['filter'], layer: Layer) {
    const newLayers = layers.map(l => {
      if (layer.id === l.id) {
        const { sourceId: _previous, ...rest } = layer; // eslint-disable-line @typescript-eslint/no-unused-vars
        return sourceId ? { ...rest, filter, sourceId } : { ...rest, filter };
      }
      return l;
    });
    viewUpdateRow('layers', newLayers);
  }

  // A resource layer's presentation (chart type, axis label, unit, scale) follows the declaration of what it reads,
  // so changing its source or resource re-derives it. Layers, axes and guides change together in one update.
  function handleRebindResourceLayer(sourceId: string | null, resourceName: string, layer: Layer) {
    const registry = $timelineSources;
    // A bound layer reads its own source; an unbound (legacy) layer reads whatever the legacy loader picks, which
    // is not registry order (e.g. a dataset tied to the selected simulation beats a plan-level one).
    const legacy = {
      modelResourceTypes: $resourceTypes,
      planDatasets: $planDatasets,
      registry,
      simulationDatasetId: $simulationDataset?.id ?? null,
    };
    const declarationOf = (id: string | null | undefined, name: string | undefined) =>
      id ? findResourceType(registry, id, name) : findLegacyResourceType(legacy, name);
    const rebound = rebindResourceLayer(timelines, { horizontalGuides, layers, yAxes }, layer, {
      previousResourceType: declarationOf(layer.sourceId, layer.filter.resource),
      resourceName,
      resourceType: declarationOf(sourceId, resourceName),
      sourceId: sourceId ?? undefined,
      sourceLabel: getSource(registry, sourceId)?.label,
    });
    viewUpdateRowProperties(rebound);
  }

  function handleUpdateResourceLayerFilter(resourceName: string, layer: Layer) {
    if (layer.sourceId) {
      handleRebindResourceLayer(layer.sourceId, resourceName, layer);
    } else {
      // Legacy (unbound) layers keep their existing behavior
      handleUpdateLayerProperty('filter', { resource: resourceName }, layer);
    }
  }

  function handleUpdateResourceLayerChartType(value: ChartType, layer: Layer) {
    const newLayers = layers.map(l => {
      if (layer.id === l.id) {
        if (isXRangeLayer(l) && value === 'line') {
          return createTimelineLineLayer(timelines, yAxes, {
            filter: l.filter,
            id: l.id,
            name: l.name,
            ...(l.sourceId ? { sourceId: l.sourceId } : {}),
          });
        } else if (isLineLayer(l) && value === 'x-range') {
          return createTimelineXRangeLayer(timelines, yAxes, {
            filter: l.filter,
            id: l.id,
            name: l.name,
            ...(l.sourceId ? { sourceId: l.sourceId } : {}),
          });
        }
      }
      return l;
    });

    viewUpdateRow('layers', newLayers);
  }

  function handleUpdateLayerColor(value: string, layer: Layer) {
    const newLayers = layers.map(l => {
      if (layer.id === l.id) {
        if (isActivityLayer(l)) {
          return { ...l, activityColor: value };
        } else if (isExternalEventLayer(l)) {
          return { ...l, externalEventColor: value };
        } else if (isLineLayer(l)) {
          return { ...l, lineColor: value };
        } else if (isXRangeLayer(l)) {
          return { ...l, colorScheme: value };
        }
      }
      return l;
    });
    viewUpdateRow('layers', newLayers);
  }

  function handleNewHorizontalGuideClick() {
    if (!selectedRow) {
      return;
    }
    const yAxesWithScaleDomains = $yAxesWithScaleDomainsCache[selectedRow.id];
    const newHorizontalGuide = createHorizontalGuide(timelines, yAxesWithScaleDomains);
    viewUpdateRow('horizontalGuides', [...horizontalGuides, newHorizontalGuide]);
  }

  function handleRemoveAllHorizontalGuidesClick() {
    effects.deleteTimelineHorizontalGuides();
  }

  function handleNewVerticalGuideClick() {
    if (typeof $selectedTimelineId !== 'number' || !$viewTimeRange) {
      return;
    }

    // Place the cursor in the middle of the timeline
    const centerTime = $viewTimeRange.start + ($viewTimeRange.end - $viewTimeRange.start) / 2;
    const centerDateDoy = getDoyTime(new Date(centerTime));

    const newVerticalGuide = createVerticalGuide(timelines, centerDateDoy);
    viewUpdateTimeline('verticalGuides', [...verticalGuides, newVerticalGuide], $selectedTimelineId);
  }

  function handleRemoveAllVerticalGuidesClick() {
    effects.deleteTimelineVerticalGuides($selectedTimelineId);
  }
</script>

<Panel padBody={false} {showHeader}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="Timeline Editor" />
  </svelte:fragment>

  <div
    slot="body"
    bind:this={editorDiv}
    bind:clientWidth={editorWidth}
    class="timeline-editor"
    class:compact={editorWidth < 360}
  >
    {#if selectedSection}
      <!-- Section editing -->
      <button
        on:click={() => {
          viewSetSelectedSection(null);
        }}
        class="st-button tertiary section-back-button"
      >
        <ArrowLeftIcon />
        Back to Timeline {$selectedTimelineId}
      </button>
      <div class="timeline-select-container">
        <select
          class="st-select w-full"
          data-type="number"
          name="sections"
          value={$selectedSectionId}
          on:change={event => {
            const { valueAsNumber: id } = getTarget(event);
            viewSetSelectedSection(id);
          }}
        >
          {#each sections as section (section.id)}
            <option value={section.id}>
              {section.name}
            </option>
          {/each}
        </select>
      </div>
      <!-- No Collapsed field: it is direct-manipulation state, with a chevron on the band and
           another in the list, and toggling it from a form dirties the view. -->
      <EditorSection item="Detail">
        <!-- Color leads, as it does on the band. Trailing the name stranded the swatch at the far
             right edge of a wide panel, away from everything else in the form. -->
        <CssGrid columns="auto 1fr" gap="8px" class="editor-section-grid">
          <Input>
            <label for="color">Color</label>
            <ColorPresetsPicker
              value={selectedSection.color ?? ViewDefaultSectionColor}
              presetColors={ViewSectionColorPresets}
              on:input={({ detail }) => viewUpdateSection('color', detail.value)}
            />
          </Input>
          <Input>
            <label for="section-name">Section Name</label>
            <input
              class="st-input w-full"
              id="section-name"
              name="name"
              autocomplete="off"
              type="string"
              value={selectedSection.name}
              on:input|stopPropagation={updateSectionEvent}
            />
          </Input>
        </CssGrid>
      </EditorSection>
      <!-- No heading: a legend reading "Section" over a button reading "Delete Section" said the
           same word twice. -->
      <EditorSection>
        <button
          class="st-button secondary w-full"
          on:click={() => {
            if (selectedSection) {
              viewDeleteSection(selectedSection.id, true);
            }
          }}
        >
          Delete Section (Keep Rows)
        </button>
      </EditorSection>
    {:else if !selectedRow}
      <!-- Select Timeline. -->
      <div class="timeline-select-container">
        <select
          class="st-select w-full"
          data-type="number"
          name="timelines"
          value={$selectedTimelineId}
          on:change={event => {
            const { valueAsNumber: id } = getTarget(event);
            viewSetSelectedTimeline(id);
          }}
        >
          {#each $view?.definition.plan.timelines ?? [] as timeline}
            <option value={timeline.id}>
              Timeline {timeline.id}
            </option>
          {/each}
        </select>
      </div>

      <!-- Timeline editing -->
      {#if !selectedTimeline}
        <fieldset class="editor-section">No timeline selected</fieldset>
      {:else}
        <EditorSection item="Margin">
          <CssGrid columns="1fr 1fr" gap="8px" class="editor-section-grid">
            <form on:submit={event => event.preventDefault()}>
              <Input>
                <label for="marginLeft">Margin Left</label>
                <input
                  min={ViewConstants.MIN_MARGIN_LEFT}
                  class="st-input w-full"
                  name="marginLeft"
                  id="marginLeft"
                  type="number"
                  value={selectedTimeline.marginLeft}
                  on:input|stopPropagation={updateTimelineMarginLeft}
                />
              </Input>
            </form>
            <Input>
              <label for="marginRight">Margin Right</label>
              <input
                min={0}
                class="st-input w-full"
                name="marginRight"
                id="marginRight"
                type="number"
                value={selectedTimeline.marginRight}
                on:input|stopPropagation={updateTimelineEvent}
              />
            </Input>
          </CssGrid>
        </EditorSection>

        <EditorSection
          creatable
          item="Vertical Guide"
          itemCount={verticalGuides.length}
          on:create={handleNewVerticalGuideClick}
          on:removeAll={handleRemoveAllVerticalGuidesClick}
        >
          {#if verticalGuides.length}
            <div class="guides timeline-elements">
              {#each verticalGuides as verticalGuide (verticalGuide.id)}
                <TimelineEditorGuideRow
                  guide={verticalGuide}
                  {timeBounds}
                  on:input={event => onVerticalGuideInput(event, verticalGuide)}
                  on:delete={() => handleDeleteVerticalGuideClick(verticalGuide)}
                />
              {/each}
            </div>
          {/if}
        </EditorSection>

        <fieldset class="editor-section editor-section-draggable rows-editor" aria-label="rows-editor">
          <div class="editor-section-header rows-editor-header flex flex-row justify-between">
            <div class="st-typography-medium flex items-center">Rows</div>
            <!-- Only the two additive actions stay inline. The bulk deletes are rare and
                 destructive, so they live behind the overflow menu rather than one click away. -->
            <div class="flex gap-2">
              <button
                aria-label="New Row"
                on:click|stopPropagation={addTimelineRow}
                use:tooltip={{ content: 'New Row', placement: 'top' }}
                class="st-button icon"
              >
                <ListPlus size={16} />
              </button>
              <button
                aria-label="New Section"
                on:click|stopPropagation={addSection}
                use:tooltip={{ content: 'New Section', placement: 'top' }}
                class="st-button icon"
              >
                <FolderPlus size={16} />
              </button>
              {#if rows.length > 0 || sections.length > 0}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild let:builder>
                    <button
                      aria-label="More Row Actions"
                      use:builder.action
                      {...builder}
                      use:tooltip={{ content: 'More Actions', placement: 'top' }}
                      class="st-button icon"
                    >
                      <Ellipsis size={16} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    {#if rows.length > 0}
                      <DropdownMenu.Item size="sm" class="flex gap-2" on:click={removeAllTimelineRows}>
                        <RemoveAllIcon />
                        Delete All Rows
                      </DropdownMenu.Item>
                    {/if}
                    {#if sections.length > 0}
                      <DropdownMenu.Item size="sm" class="flex gap-2" on:click={removeAllSections}>
                        <FolderX size={16} />
                        Delete All Sections
                      </DropdownMenu.Item>
                    {/if}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </div>
          </div>

          {#if items.length > 0}
            <div class="timeline-hierarchy timeline-elements" role="list">
              {#each items as item (`${item.type}-${item.id}`)}
                {#if item.type === 'section'}
                  {@const section = sectionsById.get(item.id)}
                  {#if section}
                    <!-- The section's color drives both the flush-left rail and the tint behind
                         the whole block, so a colored section reads as one band. -->
                    <div
                      class="timeline-section-container"
                      role="listitem"
                      style:--section-accent-color={section.color || ViewDefaultSectionColor}
                      style:--section-foreground={getContrastingTextColor(section.color || ViewDefaultSectionColor)}
                    >
                      <div
                        class="st-typography-body timeline-section timeline-element"
                        use:makeDraggable={{ itemId: section.id, itemType: 'section', sectionId: null }}
                        use:makeSectionDropTarget={{ sectionId: section.id }}
                      >
                        <span class="drag-icon">
                          <GripVertical size={16} />
                        </span>
                        <button
                          aria-expanded={!section.collapsed}
                          aria-label={section.collapsed ? 'Expand Section' : 'Collapse Section'}
                          use:tooltip={{
                            content: section.collapsed ? 'Expand Section' : 'Collapse Section',
                            placement: 'top',
                          }}
                          class="st-button icon section-chevron"
                          on:click|stopPropagation={() => {
                            viewUpdateSection('collapsed', !section.collapsed, section.id, $selectedTimelineId);
                          }}
                        >
                          {#if section.collapsed}
                            <CaretRightIcon />
                          {:else}
                            <CaretDownIcon />
                          {/if}
                        </button>
                        <span class="timeline-section-name">
                          {section.name}
                        </span>
                        {#if section.collapsed && section.rowIds.length > 0}
                          <span class="section-hidden-count st-typography-body">
                            {section.rowIds.length} hidden
                          </span>
                        {/if}
                        <div class="timeline-section-buttons item-actions">
                          <button
                            aria-label="Add Row to Section"
                            use:tooltip={{ content: 'Add Row to Section', placement: 'top' }}
                            class="st-button icon"
                            on:click|stopPropagation={() => {
                              viewAddTimelineRow($selectedTimelineId, false, section.id);
                            }}
                          >
                            <ListPlus size={16} />
                          </button>
                          <button
                            aria-label="Edit Section"
                            use:tooltip={{ content: 'Edit Section', placement: 'top' }}
                            class="st-button icon"
                            on:click={() => {
                              viewSetSelectedSection(section.id);
                            }}
                          >
                            <PenIcon />
                          </button>
                          <button
                            aria-label="Duplicate Section"
                            use:tooltip={{ content: 'Duplicate Section', placement: 'top' }}
                            class="st-button icon"
                            on:click|stopPropagation={() => {
                              if (selectedTimeline) {
                                effects.duplicateTimelineSection(section, selectedTimeline, timelines);
                              }
                            }}
                          >
                            <DuplicateIcon />
                          </button>
                          <button
                            aria-label="Delete Section"
                            use:tooltip={{ content: 'Delete Section', placement: 'top' }}
                            class="st-button icon"
                            on:click|stopPropagation={() => {
                              viewDeleteSection(section.id, true);
                            }}
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      </div>
                      <!-- Collapsed state is shared with the timeline: folding here folds there. -->
                      {#if !section.collapsed}
                        <div class="section-rows timeline-elements" role="list">
                          <!-- An empty section rendered as nothing, which read as broken rather
                               than empty, and left nothing to drop the first row onto. -->
                          {#if section.rowIds.length === 0}
                            <div
                              class="section-empty st-typography-body"
                              use:makeEmptySectionDropTarget={{ sectionId: section.id }}
                            >
                              Drag a row here
                            </div>
                          {/if}
                          {#each section.rowIds as rowId (`section-${section.id}-row-${rowId}`)}
                            {@const row = rowsById.get(rowId)}
                            {#if row}
                              <div
                                class="st-typography-body timeline-row timeline-element timeline-row-in-section"
                                role="listitem"
                                use:makeDraggable={{ itemId: row.id, itemType: 'row', sectionId: section.id }}
                                use:makeDropTarget={{ itemId: row.id, itemType: 'row', sectionId: section.id }}
                              >
                                <span class="drag-icon">
                                  <GripVertical size={16} />
                                </span>
                                <span class="chevron-spacer" />
                                <span class="timeline-row-name">
                                  {row.name}
                                </span>
                                <div class="timeline-row-buttons item-actions">
                                  <button
                                    use:tooltip={{ content: 'Edit Row', placement: 'top' }}
                                    class="st-button icon"
                                    on:click={() => {
                                      viewSetSelectedRow(row.id);
                                    }}
                                  >
                                    <PenIcon />
                                  </button>
                                  <button
                                    use:tooltip={{ content: 'Duplicate Row', placement: 'top' }}
                                    class="st-button icon"
                                    on:click={() => {
                                      if (selectedTimeline) {
                                        effects.duplicateTimelineRow(row, selectedTimeline, timelines);
                                      }
                                    }}
                                  >
                                    <DuplicateIcon />
                                  </button>
                                  <button
                                    use:tooltip={{ content: 'Delete Row', placement: 'top' }}
                                    class="st-button icon"
                                    on:click|stopPropagation={() => {
                                      effects.deleteTimelineRow(row, rows, $selectedTimelineId);
                                    }}
                                  >
                                    <CloseIcon />
                                  </button>
                                </div>
                              </div>
                            {/if}
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                {:else}
                  <!-- Root-level row -->
                  {@const row = rowsById.get(item.id)}
                  {#if row}
                    <div
                      class="st-typography-body timeline-row timeline-element"
                      role="listitem"
                      use:makeDraggable={{ itemId: row.id, itemType: 'row', sectionId: null }}
                      use:makeDropTarget={{ itemId: row.id, itemType: 'row', sectionId: null }}
                    >
                      <span class="drag-icon">
                        <GripVertical size={16} />
                      </span>
                      <span class="chevron-spacer" />
                      <span class="timeline-row-name">
                        {row.name}
                      </span>
                      <div class="timeline-row-buttons item-actions">
                        <button
                          use:tooltip={{ content: 'Edit Row', placement: 'top' }}
                          class="st-button icon"
                          on:click={() => {
                            viewSetSelectedRow(row.id);
                          }}
                        >
                          <PenIcon />
                        </button>
                        <button
                          use:tooltip={{ content: 'Duplicate Row', placement: 'top' }}
                          class="st-button icon"
                          on:click={() => {
                            if (selectedTimeline) {
                              effects.duplicateTimelineRow(row, selectedTimeline, timelines);
                            }
                          }}
                        >
                          <DuplicateIcon />
                        </button>
                        <button
                          use:tooltip={{ content: 'Delete Row', placement: 'top' }}
                          class="st-button icon"
                          on:click|stopPropagation={() => {
                            effects.deleteTimelineRow(row, rows, $selectedTimelineId);
                          }}
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    </div>
                  {/if}
                {/if}
              {/each}
            </div>
          {:else}
            <div class="empty-state st-typography-body">No rows or sections</div>
          {/if}
        </fieldset>
      {/if}
    {:else}
      <!-- Row editing -->
      <button
        on:click={() => {
          viewSetSelectedRow(null);
        }}
        class="st-button tertiary section-back-button"
      >
        <ArrowLeftIcon />
        Back to Timeline {$selectedTimelineId}
      </button>
      <div class="timeline-select-container">
        <select
          class="st-select w-full"
          data-type="number"
          name="rows"
          value={$selectedRowId}
          on:change={event => {
            const { valueAsNumber: id } = getTarget(event);
            viewSetSelectedRow(id);
          }}
        >
          {#each rows as row (row.id)}
            <option value={row.id}>
              {row.name}
            </option>
          {/each}
        </select>
      </div>
      <EditorSection item="Detail">
        <div style="display: grid">
          <Input>
            <label for="name">Row Name</label>
            <input
              class="st-input w-full"
              name="name"
              autocomplete="off"
              type="string"
              value={selectedRow.name}
              on:input|stopPropagation={updateRowEvent}
            />
          </Input>
        </div>
        <CssGrid columns="1fr 1fr" gap="8px" class="editor-section-grid">
          <form on:submit={event => event.preventDefault()}>
            <Input>
              <label for="marginLeft">Row Height</label>
              <input
                min={ViewConstants.MIN_ROW_HEIGHT}
                disabled={selectedRow.autoAdjustHeight}
                class="st-input w-full"
                name="height"
                type="number"
                value={selectedRow.height}
                on:input|stopPropagation={updateRowMinHeight}
              />
            </Input>
          </form>
          <Input>
            <label for="marginLeft">Resize Mode</label>
            <select
              class="st-select w-full"
              data-type="bool"
              name="autoAdjustHeight"
              value={selectedRow.autoAdjustHeight}
              on:change={event => {
                const { value } = getTarget(event);
                viewUpdateRow('autoAdjustHeight', value === 'true');
              }}
            >
              <option value={false}>Manual</option>
              <option value={true}>Auto</option>
            </select>
          </Input>
        </CssGrid>
      </EditorSection>

      {#if rowHasNonActivityChartLayer}
        <EditorSection
          creatable
          item="Horizontal Guide"
          itemCount={horizontalGuides.length}
          on:create={handleNewHorizontalGuideClick}
          on:removeAll={handleRemoveAllHorizontalGuidesClick}
        >
          {#if horizontalGuides.length}
            <div class="guides timeline-elements">
              {#each horizontalGuides as horizontalGuide (horizontalGuide.id)}
                <TimelineEditorGuideRow
                  guide={horizontalGuide}
                  yAxes={$yAxesWithScaleDomainsCache[selectedRow?.id ?? -1] ?? yAxes}
                  on:input={event => onHorizontalGuideInput(event, horizontalGuide)}
                  on:delete={() => handleDeleteHorizontalGuideClick(horizontalGuide)}
                />
              {/each}
            </div>
          {/if}
        </EditorSection>
      {/if}
      {#if rowHasActivityLayer || rowHasExternalEventLayer}
        <EditorSection
          item="Layer Option"
          on:create={handleNewHorizontalGuideClick}
          on:removeAll={handleRemoveAllHorizontalGuidesClick}
        >
          <form on:submit={event => event.preventDefault()} style="flex: 1">
            <Input layout="inline" class="editor-input">
              <label for="text">Height</label>
              <input
                min={12}
                autocomplete="off"
                class="st-input w-full"
                name="text"
                type="number"
                value={discreteOptions.height}
                on:input={event => {
                  const { value } = getTarget(event);
                  if (typeof value === 'number' && !isNaN(value)) {
                    if (value >= 12) {
                      viewUpdateRow('discreteOptions', { ...discreteOptions, height: value });
                    }
                  }
                }}
              />
              <ParameterUnits unit="px" slot="right" />
            </Input>
          </form>
          <Input layout="inline" class="editor-input">
            <div class="flex min-w-0 items-center gap-1">
              <label for="display-mode">Display</label>
              <InfoTip
                content="Grouped puts activities into collapsible rows by type. Compact packs them into as few rows as will fit."
              />
            </div>
            <TimelineEditorOptionButtons
              ariaLabel="Display"
              id="display-mode"
              options={[
                { id: 'grouped', label: 'Grouped' },
                { id: 'compact', label: 'Compact' },
              ]}
              selectedId={discreteOptions.displayMode}
              on:change={({ detail }) => applyDiscreteOption('displayMode', detail.id)}
            />
          </Input>
          <Input layout="inline" class="editor-input">
            <div class="flex min-w-0 items-center gap-1">
              <label for="label-visibility">Labels</label>
              <InfoTip
                content="On always draws item labels. Off never does. Auto draws only the labels that do not overlap the next item."
              />
            </div>
            <TimelineEditorOptionButtons
              ariaLabel="Labels"
              id="label-visibility"
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'on', label: 'On' },
                { id: 'off', label: 'Off' },
              ]}
              selectedId={discreteOptions.labelVisibility}
              on:change={({ detail }) => applyDiscreteOption('labelVisibility', detail.id)}
            />
          </Input>
          {#if rowHasActivityLayer}
            <Input layout="inline" class="editor-input">
              <div class="flex min-w-0 items-center gap-1">
                <label for="directive-marker">Directive</label>
                <InfoTip
                  content="Shape every activity directive is drawn with. Directives mark a start time and have no duration of their own."
                />
              </div>
              <TimelineEditorOptionButtons
                ariaLabel="Directive Marker"
                id="directive-marker"
                options={MARKER_STYLE_OPTIONS}
                selectedId={discreteOptions.directiveMarker ?? DEFAULT_MARKER_STYLE}
                on:change={({ detail }) => applyDiscreteOption('directiveMarker', detail.id)}
              />
            </Input>
          {/if}
          <Input layout="inline" class="editor-input">
            <div class="flex min-w-0 items-center gap-1">
              <label for="zero-duration-marker">Instant</label>
              <InfoTip
                content="Shape for spans and external events whose duration is zero. Anything with a duration keeps its bar."
              />
            </div>
            <TimelineEditorOptionButtons
              ariaLabel="Instant Marker"
              id="zero-duration-marker"
              options={MARKER_STYLE_OPTIONS}
              selectedId={discreteOptions.zeroDurationMarker ?? DEFAULT_MARKER_STYLE}
              on:change={({ detail }) => applyDiscreteOption('zeroDurationMarker', detail.id)}
            />
          </Input>
          {#if rowHasActivityLayer}
            <div class="editor-section-header activity-options">
              <div class="st-typography-label">Activity Options</div>
            </div>
            <Input layout="inline" class="editor-input">
              <div class="flex min-w-0 items-center gap-1">
                <label for="activity-composition">Show</label>
                <InfoTip
                  content="Directives shows only what is planned. Simulated shows only what simulation produced. The third draws the simulated span with its directive marked on it."
                />
              </div>
              <select
                class="st-select w-full"
                id="activity-composition"
                name="composition"
                value={discreteOptions?.activityOptions?.composition}
                on:change={event => handleActivityOptionSelectChange(event, 'composition')}
              >
                <option value="directives">Directives</option>
                <option value="spans">Simulated</option>
                <option value="both">Directives + Simulated</option>
              </select>
            </Input>
          {/if}
          {#if rowHasActivityLayer && discreteOptions.displayMode === 'grouped'}
            <Input layout="inline" class="editor-input">
              <div class="flex min-w-0 items-center gap-1">
                <label for="hierarchy-mode">Hierarchy</label>
                <InfoTip
                  content="By Directive groups starting from each directive. Flat groups directives and spans together regardless of how deeply nested they are."
                />
              </div>
              <TimelineEditorOptionButtons
                ariaLabel="Hierarchy"
                id="hierarchy-mode"
                options={[
                  { id: 'flat', label: 'Flat' },
                  { id: 'directive', label: 'By Directive' },
                ]}
                selectedId={discreteOptions?.activityOptions?.hierarchyMode}
                on:change={({ detail }) => applyActivityOption('hierarchyMode', detail.id)}
              />
            </Input>
          {/if}
          {#if rowHasExternalEventLayer && discreteOptions.displayMode === 'grouped'}
            <div class="editor-section-header external-event-options">
              <div class="st-typography-label">External Event Options</div>
            </div>
            <Input layout="inline" class="editor-input">
              <div class="flex min-w-0 items-center gap-1">
                <label for="group-by">Group By</label>
                <InfoTip
                  content="Groups external events into rows either by the source file they came from, or by their event type."
                />
              </div>
              <TimelineEditorOptionButtons
                ariaLabel="Group By"
                id="group-by"
                options={[
                  { id: 'source_key', label: 'By Source' },
                  { id: 'event_type_name', label: 'By Event Type' },
                ]}
                selectedId={discreteOptions?.externalEventOptions?.groupBy}
                on:change={({ detail }) => applyExternalEventOption('groupBy', detail.id)}
              />
            </Input>
          {/if}
        </EditorSection>
      {/if}
      <!-- TODO perhaps separate out each section into a mini editor? -->

      {#if yAxes.length > 0 || rowHasNonActivityChartLayer}
        <EditorSection
          isDragContainer
          creatable
          item="Y Axis"
          itemPlural="Y Axes"
          itemCount={yAxes.length}
          on:create={handleNewYAxisClick}
          on:removeAll={handleRemoveAllYAxesClick}
        >
          {#if yAxes.length}
            <div class="editor-section-labeled-grid-container">
              <CssGrid columns="1fr 56px 24px 24px" gap="8px" class="editor-section-grid-labels" padding="0px 16px">
                <div>Name</div>
                <div>Ticks</div>
              </CssGrid>
              <div class="timeline-rows timeline-elements" role="list">
                {#each yAxes as yAxis (yAxis.id)}
                  <div
                    class="timeline-y-axis timeline-element"
                    role="listitem"
                    use:makeYAxisDraggable={{ axisId: yAxis.id }}
                  >
                    <CssGrid columns="1fr 56px 24px 24px" gap="8px" class="editor-section-grid">
                      <span class="drag-icon">
                        <GripVertical size={16} />
                      </span>
                      <div class="w-full">
                        <Input layout="stacked" class="editor-input">
                          <label for="text">Y Axis</label>
                          <input
                            autocomplete="off"
                            class="st-input w-full"
                            name="text"
                            type="string"
                            value={yAxis.label.text}
                            on:input={event => {
                              const { value } = getTarget(event);
                              const newRowYAxes = yAxes.map(axis => {
                                if (axis.id === yAxis.id) {
                                  axis.label.text = value?.toString() ?? '';
                                }
                                return axis;
                              });
                              viewUpdateRow('yAxes', newRowYAxes);
                            }}
                          />
                        </Input>
                      </div>
                      <Input layout="stacked" class="editor-input">
                        <label for="tickCount">Ticks</label>
                        <input
                          class="st-input w-full"
                          name="tickCount"
                          type="number"
                          min="0"
                          value={yAxis.tickCount}
                          on:input={event => updateYAxisTickCount(event, yAxis)}
                        />
                      </Input>
                      <TimelineEditorYAxisSettings {yAxis} {yAxes} on:delete={() => handleDeleteYAxisClick(yAxis)} />
                      <button
                        on:click={() => handleDeleteYAxisClick(yAxis)}
                        use:tooltip={{ content: 'Delete Y Axis', placement: 'top' }}
                        class="st-button icon"
                      >
                        <CloseIcon />
                      </button>
                    </CssGrid>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div />
          {/if}
        </EditorSection>
      {/if}
      <EditorSection
        creatable
        item="Activity Layer"
        itemCount={activityLayers.length}
        on:create={() => handleNewLayerClick('activity')}
        on:removeAll={() => handleRemoveAllLayersClick('activity')}
      >
        {#if activityLayers.length}
          <div class="timeline-layers timeline-elements">
            {#each activityLayers as layer (layer.id)}
              <TimelineLayerEditor
                {yAxes}
                {layer}
                on:updateLayer={({ detail: { property, value } }) => handleUpdateLayerProperty(property, value, layer)}
                on:colorChange={({ detail: { color } }) => handleUpdateLayerColor(color, layer)}
                on:remove={() => handleDeleteLayerClick(layer)}
                on:duplicate={() => handleDuplicateLayer(layer)}
                on:filterChange={({ detail: { filter } }) =>
                  handleUpdateLayerProperty('filter', { activity: filter }, layer)}
                on:sourceChange={({ detail: { sourceId } }) => handleUpdateLayerSource(sourceId, layer.filter, layer)}
              />
            {/each}
          </div>
        {/if}
      </EditorSection>
      <EditorSection
        creatable
        item="Resource Layer"
        itemCount={resourceLayers.length}
        on:create={() => handleNewLayerClick('line')}
        on:removeAll={() => handleRemoveAllLayersClick('resource')}
      >
        {#if resourceLayers.length}
          <!-- TODO bug when dragging something into a different draggable area -->
          <div class="timeline-layers timeline-elements">
            {#each resourceLayers as layer (layer.id)}
              <TimelineLayerEditor
                {layer}
                {yAxes}
                on:updateLayer={({ detail: { property, value } }) => handleUpdateLayerProperty(property, value, layer)}
                on:updateChartType={({ detail: chartType }) => handleUpdateResourceLayerChartType(chartType, layer)}
                on:colorChange={({ detail: { color } }) => handleUpdateLayerColor(color, layer)}
                on:remove={() => handleDeleteLayerClick(layer)}
                on:duplicate={() => handleDuplicateLayer(layer)}
                on:filterChange={({ detail: { filter } }) =>
                  handleUpdateResourceLayerFilter(typeof filter === 'string' ? filter : '', layer)}
                on:sourceChange={({ detail: { filter, sourceId } }) =>
                  handleRebindResourceLayer(sourceId, filter ?? '', layer)}
              />
              <!-- <TimelineEditorLayerSection
                on:handleUpdateResourceLayerChartType={event => handleUpdateResourceLayerChartType(event.detail.value, layer)}
                on:handleUpdateLayerFilter={event => handleUpdateLayerFilter(event.detail.values, layer)}
                on:handleUpdateLayerProperty={event =>
                  handleUpdateLayerProperty(event.detail.name, event.detail.value, layer)}
                on:handleUpdateLayerColorScheme={event => handleUpdateLayerColorScheme(event.detail.value, layer)}
                on:handleDeleteLayerClick={() => handleDeleteLayerClick(layer)}
                {layer}
                {yAxes}
              /> -->
            {/each}
          </div>
        {/if}
      </EditorSection>
      <EditorSection
        creatable
        item="Event Layer"
        itemCount={externalEventLayers.length}
        on:create={() => handleNewLayerClick('externalEvent')}
        on:removeAll={() => handleRemoveAllLayersClick('externalEvent')}
      >
        {#if externalEventLayers.length}
          <div class="timeline-layers timeline-elements">
            {#each externalEventLayers as layer (layer.id)}
              <TimelineLayerEditor
                {layer}
                on:updateLayer={({ detail: { property, value } }) => handleUpdateLayerProperty(property, value, layer)}
                on:rename={({ detail: { name } }) => handleUpdateLayerProperty('name', name, layer)}
                on:colorChange={({ detail: { color } }) => handleUpdateLayerColor(color, layer)}
                on:remove={() => handleDeleteLayerClick(layer)}
                on:duplicate={() => handleDuplicateLayer(layer)}
                on:filterChange={({ detail: { filter } }) =>
                  handleUpdateLayerProperty('filter', { externalEvent: filter }, layer)}
              />
            {/each}
          </div>
        {/if}
      </EditorSection>
    {/if}
  </div>
</Panel>

<style>
  .activity-options {
    border-top: 1px solid var(--st-gray-20);
    padding-top: 16px;
  }

  .external-event-options {
    border-top: 1px solid var(--st-gray-20);
    padding-top: 16px;
  }

  .timeline-editor {
    display: flex;
    flex-direction: column;
  }

  /* The global fieldset reset applies px-4, and the override that cancels it is scoped to
     EditorSection - so this hand-rolled fieldset floated 16px inset. Rows and sections run edge to
     edge instead, letting a section's tint and rail reach the panel border. The header keeps the
     padding so its label stays aligned with the other section titles. */
  .rows-editor {
    padding-left: 0;
    padding-right: 0;
  }

  .rows-editor-header {
    padding: 0 16px;
  }

  .rows-editor-header .st-button {
    color: var(--st-gray-50);
  }

  .timeline-select-container {
    border-bottom: 1px solid var(--st-gray-20);
    padding: 16px 8px;
  }

  .timeline-row .st-button.icon,
  .timeline-y-axis .st-button.icon,
  :global(.timeline-editor-layer-settings.st-button.icon),
  :global(.timeline-editor-axis-settings.st-button.icon) {
    color: var(--st-gray-50);
  }

  .editor-section-labeled-grid-container {
    display: grid;
    gap: 8px;
  }

  .editor-section-labeled-grid-container {
    gap: 4px;
  }

  .timeline-elements {
    display: block;
    outline: none !important;
    overflow-x: hidden;
    overflow-y: auto;
    padding-bottom: 16px;
  }

  :global(.editor-section-grid form) {
    display: grid;
  }

  :global(.editor-section-grid) {
    align-items: center;
    flex: 1;
    position: relative;
    width: 100%;
  }

  :global(.editor-section-grid-labels > *) {
    min-width: 40px;
  }

  /* Rows and sections share one left-to-right order: rail gutter, drag handle, chevron lane,
     name. The handle and chevron stay in flow rather than sitting over the padding, so nothing
     overlaps the flush-left rail.

     height alone did not hold: as flex items of the column .timeline-hierarchy, a hovered row
     collapsed to its 24px content height. flex-shrink stops the list compressing rows, and
     min-height pins the used height. */
  .timeline-row {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    height: 32px;
    min-height: 32px;
    overflow: hidden;
    padding: 0 16px 0 8px;
    position: relative;
  }

  /* Default handle treatment, shared with the y-axis list: hidden until hover and absolutely
     positioned so it does not take a cell in that list's grid. */
  .drag-icon {
    color: var(--st-gray-50);
    display: none;
    margin-left: -16px;
    margin-top: 0px;
    position: absolute;
  }

  /* The rows/sections list opts into persistent handles, in flow as each row's first item, so the
     color rail stays flush left with nothing over it. Scoped so the y-axis grid keeps the overlay. */
  .timeline-hierarchy .drag-icon {
    align-items: center;
    color: var(--st-gray-30);
    display: flex;
    flex-shrink: 0;
    margin-left: 0;
    position: static;
  }

  .timeline-hierarchy .timeline-element:hover .drag-icon {
    color: var(--st-gray-50);
  }

  /* The grab/grabbing pair the timeline uses on its row and section headers, on the same two
     surfaces: the handle and the name. */
  .timeline-hierarchy .drag-icon,
  .timeline-row-name,
  .timeline-section-name {
    cursor: grab;
  }

  .timeline-hierarchy .drag-icon:active,
  .timeline-row-name:active,
  .timeline-section-name:active,
  :global(.timeline-hierarchy .dragging) .drag-icon,
  :global(.timeline-hierarchy .dragging) .timeline-row-name,
  :global(.timeline-hierarchy .dragging) .timeline-section-name {
    cursor: grabbing;
  }

  /* Root-level rows reserve the section chevron's width so every name lands on one left edge. */
  .chevron-spacer {
    flex-shrink: 0;
    width: 16px;
  }

  /* Root-level hover fill. Rows inside a section override this with a wash of the section
     color further down. :focus-within is included so a keyboard user tabbing to a row's
     actions still gets an opaque backing behind them. */
  .timeline-row:hover,
  .timeline-row:active,
  .timeline-row:focus-within,
  .timeline-section:hover,
  .timeline-section:active,
  .timeline-section:focus-within {
    background: var(--st-gray-10);
  }

  .timeline-row-name,
  .timeline-section-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-row-buttons {
    display: flex;
  }

  /* Same left structure as .timeline-row so the two align. */
  .timeline-section {
    align-items: center;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    height: 32px;
    min-height: 32px;
    overflow: hidden;
    padding: 0 16px 0 5px;
    position: relative;
  }

  .timeline-section .section-chevron {
    color: var(--st-gray-70);
    flex-shrink: 0;
    height: 24px;
    padding: 0;
    width: 16px;
  }

  .timeline-section-name {
    font-weight: 500;
  }

  .section-hidden-count {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
  }

  .timeline-section-buttons {
    display: flex;
  }

  /* The rail is flush to the panel edge and everything else, handles included, starts after its
     3px gutter, so nothing is drawn on top of the color. The hairlines keep stacked sections
     reading as distinct blocks rather than one tinted run. */
  .timeline-section-container {
    border-bottom: 1px solid var(--st-gray-20);
    border-top: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    padding-left: 3px;
    position: relative;
  }

  /* Adjacent sections share a single hairline instead of stacking two. */
  .timeline-section-container + .timeline-section-container {
    border-top: none;
  }

  /* The band is the section color at full strength, and everything on it takes the
     contrast-picked foreground rather than a fixed grey, so it stays legible at any color. */
  .timeline-section-container .timeline-section {
    background-color: var(--section-accent-color);
    color: var(--section-foreground);
  }

  .timeline-section-container .timeline-section:hover,
  .timeline-section-container .timeline-section:active,
  .timeline-section-container .timeline-section:focus-within {
    background-color: color-mix(in srgb, var(--section-accent-color) 88%, black);
  }

  /* The handle has its own color further down (.timeline-hierarchy .drag-icon), out-specified
     here. Chevron and action buttons are handled on .timeline-section .st-button.icon below. */
  .timeline-section-container .timeline-section .drag-icon,
  .timeline-section-container .timeline-section:hover .drag-icon,
  .timeline-section-container .timeline-section .section-hidden-count {
    color: var(--section-foreground);
  }

  /* The default grey button hover reads as a hole punched in a saturated band. A wash of the
     band's own foreground works on light and dark bands alike. */
  .timeline-section-container .timeline-section :global(.st-button.icon:hover) {
    background: color-mix(in srgb, var(--section-foreground) 18%, transparent);
  }

  /* Rows keep a light wash of the same color. At a 10% mix the lightness barely moves across
     hues, so row names - and, on the timeline, plotted data - stay readable without normalizing. */
  .timeline-section-container {
    background-color: color-mix(in srgb, var(--section-accent-color) 10%, white);
  }

  .timeline-section-container .timeline-row:hover,
  .timeline-section-container .timeline-row:active,
  .timeline-section-container .timeline-row:focus-within {
    background-color: color-mix(in srgb, var(--section-accent-color) 18%, white);
  }

  /* One unbroken rail from the section header down past its last row, so the whole group reads
     as a single band. */
  .timeline-section-container::before {
    background-color: var(--section-accent-color, var(--st-gray-30));
    bottom: 0;
    content: '';
    left: 0;
    position: absolute;
    top: 0;
    width: 3px;
  }

  .section-empty {
    border: 1px dashed color-mix(in srgb, var(--section-accent-color) 45%, var(--st-gray-40));
    border-radius: 4px;
    color: var(--st-gray-50);
    margin: 4px 16px 4px 17px;
    padding: 6px 8px;
    text-align: center;
  }

  /* The dashed outline resolves into a solid one, in the drop lines' blue. Anchored on
     .section-rows: the timeline renders its own .section-empty, and an unanchored :global rule
     reached into it. */
  .section-rows :global(.section-empty.section-accepting-row) {
    background-color: color-mix(in srgb, var(--st-utility-blue) 8%, white);
    border-color: var(--st-utility-blue);
    border-style: solid;
    color: var(--st-utility-blue);
  }

  /* .section-rows also carries .timeline-elements, whose 16px padding-bottom is meant for the
     outer list and left a dead gap under every section. */
  .section-rows {
    min-height: 0;
    padding-bottom: 0;
    padding-left: 0;
  }

  /* Nested rows share the section's left padding so their handles line up with the section's own.
     The nesting indent moves onto the name, by widening the chevron lane; indenting the whole row
     would stair-step the handles. */
  .timeline-row-in-section {
    padding-left: 5px;
  }

  .timeline-row-in-section .chevron-spacer {
    width: 28px;
  }

  .timeline-hierarchy {
    display: flex;
    flex-direction: column;
    padding-top: 8px;
  }

  .empty-state {
    color: var(--st-gray-50);
    padding: 16px;
    text-align: center;
  }

  /* The band's controls take its contrast foreground. Set on this selector rather than
     out-specified from elsewhere: Svelte does not scope the contents of :global(), so a
     :global(.st-button.icon) rule scores lower and loses to this one. */
  .timeline-section .st-button.icon {
    color: var(--section-foreground);
  }

  .timeline-element:hover .drag-icon,
  :global(.timeline-element.dragging) .drag-icon {
    display: flex;
  }

  /* Per-item actions stay hidden until the item is hovered, so a long list reads as names and
     structure rather than a grid of icons. They stay in the DOM and in the tab order, with
     :focus-within revealing them on the way through.

     Out of flow, so they never take width from the title: a name keeps the whole row and only
     ellipses when it genuinely outruns it. `background: inherit` picks up whichever fill the row
     is using, so the icons sit on an opaque strip rather than on top of the text. */
  .item-actions {
    align-items: center;
    background: inherit;
    bottom: 0;
    display: flex;
    opacity: 0;
    padding-left: 8px;
    position: absolute;
    right: 16px;
    top: 0;
    transition: opacity 100ms ease-in-out;
  }

  .timeline-element:hover .item-actions,
  .timeline-element:focus-within .item-actions,
  :global(.timeline-element.dragging) .item-actions {
    opacity: 1;
  }

  /* Same reveal, no fade, for anyone who prefers reduced motion. */
  @media (prefers-reduced-motion: reduce) {
    .item-actions {
      transition: none;
    }
  }

  .timeline-layers {
    display: flex;
    flex-direction: column;
  }

  /* position: relative anchors the drop line below. */
  .timeline-y-axis {
    padding: 4px 16px;
    position: relative;
  }

  .timeline-y-axis .drag-icon {
    cursor: grab;
  }

  .timeline-y-axis .drag-icon:active,
  :global(.timeline-y-axis.dragging) .drag-icon {
    cursor: grabbing;
  }

  /* No gap: each guide row draws its own separator, so spacing between them would break the list into
     floating cards rather than reading as one list. Negative margins escape EditorSection's 16px so a
     row spans the panel edge to edge -- 32px that the date fields inside it need far more than the
     margin does. */
  .guides {
    display: flex;
    flex-direction: column;
    margin: 0 -16px;
  }

  .timeline-y-axis {
    align-items: flex-end;
    display: flex;
  }

  :global(.input.input-stacked.editor-input) {
    display: grid;
    min-width: 40px;
    width: auto;
  }

  :global(.input.input-stacked.editor-input label) {
    display: none;
  }

  /* Wide enough for the longest label in this panel ("Margin Right"). At the previous 60px, five
     existing labels were already ellipsized -- Margin Right, Margin Left, Resize Mode, Row Height and
     Hierarchy -- so this is the column being too narrow rather than any one label being too long. */
  :global(.input.input-inline.editor-input) {
    grid-template-columns: 84px auto;
    padding: 0;
  }

  .section-back-button {
    border-radius: 0;
    flex-shrink: 0;
    gap: 8px;
    height: 32px;
    justify-content: flex-start;
  }

  .radio-button-icon {
    display: flex;
    gap: 4px;
  }

  .compact .timeline-editor-responsive-label {
    display: none;
  }

  /* :global throughout: these classes are added by the drag actions, not the markup. */
  :global(.timeline-row.dragging),
  :global(.timeline-section.dragging),
  :global(.timeline-y-axis.dragging) {
    opacity: 0.5;
  }

  /* A line between items rather than an inset shadow inside one. The shadow read as a border
     on the row itself, which stacked with the section's own outline and rail. */
  :global(.timeline-row.drop-indicator-top)::after,
  :global(.timeline-row.drop-indicator-bottom)::after,
  :global(.timeline-section.drop-indicator-top)::after,
  :global(.timeline-section.drop-indicator-bottom)::after,
  :global(.timeline-y-axis.drop-indicator-top)::after,
  :global(.timeline-y-axis.drop-indicator-bottom)::after {
    background: var(--st-utility-blue);
    content: '';
    height: 2px;
    left: 0;
    pointer-events: none;
    position: absolute;
    right: 0;
    z-index: 10;
  }

  /* Centred on the item's edge, not inset within it, so "after this one" and "before the next" -
     the same slot, reached from either side of the seam - draw one line in one place. */
  :global(.timeline-row.drop-indicator-top)::after,
  :global(.timeline-section.drop-indicator-top)::after,
  :global(.timeline-y-axis.drop-indicator-top)::after {
    top: 0;
    transform: translateY(-50%);
  }

  :global(.timeline-row.drop-indicator-bottom)::after,
  :global(.timeline-section.drop-indicator-bottom)::after,
  :global(.timeline-y-axis.drop-indicator-bottom)::after {
    top: 100%;
    transform: translateY(-50%);
  }

  /* The y-axis list has no top padding to hang a centred line in, and its first slot has no seam
     to share anyway, so that line sits fully inside. The rows list is padded and needs no
     exception. */
  .timeline-rows > :global(:first-child.drop-indicator-top)::after {
    transform: none;
  }

  /* Reordering is communicated by the line alone. The fill is reserved for the one drop that
     actually nests - a row landing inside a section. The band keeps its own color and is
     lightened rather than replaced by grey, which read as the section losing its color mid-drag
     and fought with the contrast foreground painted on its text and icons. */
  :global(.timeline-section.section-accepting-row) {
    background-image: linear-gradient(rgb(255 255 255 / 24%), rgb(255 255 255 / 24%));
    box-shadow: inset 0 0 0 2px var(--st-utility-blue);
  }
</style>
