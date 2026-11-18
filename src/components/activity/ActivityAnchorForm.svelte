<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ActivityDirective, ActivityDirectiveId, ActivityDirectivesMap } from '../../types/activity';
  import type { DropdownOptions, SelectedDropdownOptionValue } from '../../types/dropdown';
  import { getTarget } from '../../utilities/generic';
  import { convertDurationStringToInterval, convertUsToDurationString, getIntervalInMs } from '../../utilities/time';
  import Collapse from '../Collapse.svelte';
  import PropertyField from '../form/PropertyField.svelte';
  import ReadValue from '../form/ReadValue.svelte';
  import Highlight from '../ui/Highlight.svelte';
  import SearchableDropdown from '../ui/SearchableDropdown.svelte';

  export let activityDirective: ActivityDirective;
  export let activityDirectivesMap: ActivityDirectivesMap = {};
  export let anchorId: ActivityDirectiveId | null = null;
  export let disabled: boolean = false;
  export let hasUpdatePermission: boolean = false;
  export let highlightKeysMap: Record<string, boolean> = {};
  export let isAnchoredToStart: boolean = true;
  export let startOffset: string | null = null;
  export let planReadOnly: boolean = false;

  const dispatch = createEventDispatcher<{
    updateAnchor: number | null;
    updateAnchorEdge: boolean;
    updateStartOffset: string;
  }>();
  const anchorTextDelimiter = ' - ';

  let anchorableActivityDirectives: ActivityDirective[] = [];
  let anchoredActivity: ActivityDirective | null = null;
  let previousActivityDirectiveId: ActivityDirectiveId;
  let isRelativeOffset: boolean = false;
  let startOffsetString: string = '';
  let startOffsetError: string | null = null;
  let searchableOptions: DropdownOptions = [];

  $: anchoredActivity = anchorId !== null ? activityDirectivesMap[anchorId] : null;
  $: anchorableActivityDirectives = Object.values(activityDirectivesMap).filter(
    directive => directive.id !== activityDirective.id,
  );
  $: searchableOptions = anchorableActivityDirectives.map((anchorableActivity: ActivityDirective) => ({
    display: formatActivityDirectiveAnchorText(anchorableActivity),
    value: anchorableActivity.id,
  }));
  $: startOffsetError = validateStartOffset(startOffsetString, activityDirective);
  // Editing the anchor is one decision (the caller's permission, the plan not being read-only, and the activity being
  // editable at all). When it's false every anchor property is shown as plain information.
  $: canEdit = !disabled && hasUpdatePermission && !planReadOnly;
  $: anchorText = anchoredActivity ? formatActivityDirectiveAnchorText(anchoredActivity) : 'To Plan';

  $: if (startOffset) {
    const offsetString = convertUsToDurationString(getIntervalInMs(startOffset) * 1000, true);
    // remove `y` if 0 to keep the string shorter
    startOffsetString = offsetString.replace(/0y\s?/, '');
  }

  // only set this when the viewed activity is changed
  $: if (activityDirective.id !== previousActivityDirectiveId) {
    previousActivityDirectiveId = activityDirective.id;
    isRelativeOffset = anchorId !== null || (anchorId === null && !isAnchoredToStart) || !!startOffsetError;
  }

  function formatActivityDirectiveAnchorText(activityDirective: ActivityDirective) {
    return `${activityDirective.id}${anchorTextDelimiter}${activityDirective.name}`;
  }

  function validateStartOffset(offsetString: string, activityDirective: ActivityDirective) {
    let validationError = activityDirective.anchor_validations?.reason_invalid
      ? activityDirective.anchor_validations.reason_invalid
      : null;

    try {
      convertDurationStringToInterval(`${offsetString}`);
    } catch (error) {
      validationError = (error as Error).message;
    }

    return validationError;
  }

  function getAnchorActivityDirective(inputString: SelectedDropdownOptionValue): ActivityDirective | null {
    if (inputString !== null && !Number.isNaN(inputString)) {
      return activityDirectivesMap[inputString as number];
    }

    return null;
  }

  function updateAnchor(activityDirective: ActivityDirective | null) {
    anchoredActivity = activityDirective;
    if (anchoredActivity === null) {
      dispatch('updateAnchor', null);
    } else {
      dispatch('updateAnchor', anchoredActivity.id);
    }
  }

  function updateAnchorEdge(isStart: boolean) {
    isAnchoredToStart = isStart;
    dispatch('updateAnchorEdge', isStart);
  }

  function updateStartOffset(offset: string) {
    dispatch('updateStartOffset', offset);
  }

  function onSelectAnchor(event: CustomEvent<SelectedDropdownOptionValue[]>) {
    const { detail: anchorInputString } = event;
    const activityToAnchorTo = getAnchorActivityDirective(anchorInputString[0]);
    updateAnchor(activityToAnchorTo);
  }

  function onAnchorToStart() {
    if (canEdit) {
      updateAnchorEdge(true);
    }
  }

  function onAnchorToEnd() {
    if (canEdit) {
      updateAnchorEdge(false);
    }
  }

  function onUpdateStartOffset(event: Event) {
    const { value } = getTarget(event);

    startOffsetError = activityDirective.anchor_validations?.reason_invalid
      ? activityDirective.anchor_validations.reason_invalid
      : null;

    try {
      updateStartOffset(convertDurationStringToInterval(`${value}`));
    } catch (error) {
      startOffsetError = (error as Error).message;
    }
  }
</script>

<Collapse
  className="anchor-collapse"
  bind:defaultExpanded={isRelativeOffset}
  title="Anchor"
  tooltipContent="Is Relative To Another Activity Directive"
>
  <div class="anchor-form">
    <Highlight highlight={highlightKeysMap.anchor_id}>
      <PropertyField
        editable={canEdit}
        label="Relative to"
        name="anchor-id"
        title="Activity to anchor to"
        value={anchorText}
      >
        <SearchableDropdown
          options={searchableOptions}
          placeholder="To Plan"
          searchPlaceholder="Search Directives"
          selectTooltip="Set Anchor"
          name="Set Anchor"
          selectedOptionValues={typeof anchorId === 'number' ? [anchorId] : []}
          on:change={onSelectAnchor}
        />
      </PropertyField>
    </Highlight>
    <Highlight highlight={highlightKeysMap.anchored_to_start}>
      <PropertyField
        editable={canEdit}
        label="Anchor"
        name="anchored-to-start"
        title="Where to anchor to activity directive"
        value={isAnchoredToStart ? 'Start' : 'End'}
      >
        <div class="anchor-boundaries" role="group" aria-label="Anchor edge">
          <button
            type="button"
            class:st-button={isAnchoredToStart}
            class="secondary anchor-boundary"
            class:selected={isAnchoredToStart}
            aria-pressed={isAnchoredToStart}
            on:click={onAnchorToStart}
          >
            Start
          </button>
          <button
            type="button"
            class:st-button={!isAnchoredToStart}
            class="secondary anchor-boundary"
            class:selected={!isAnchoredToStart}
            aria-pressed={!isAnchoredToStart}
            on:click={onAnchorToEnd}
          >
            End
          </button>
        </div>
      </PropertyField>
    </Highlight>
    <Highlight highlight={highlightKeysMap.start_offset}>
      <PropertyField
        editable={canEdit}
        label="Offset"
        name="start-offset"
        title="The offset duration for the anchor"
        value={startOffsetString}
      >
        <input
          class="st-input w-full"
          class:error={!!startOffsetError}
          aria-invalid={startOffsetError ? true : undefined}
          aria-label="Offset"
          name="start-offset"
          bind:value={startOffsetString}
          on:change={onUpdateStartOffset}
        />
        <svelte:fragment slot="read">
          <ReadValue value={startOffsetString} />
          {#if startOffsetError}
            <div class="text-red-500" data-testid="anchor-offset-error">{startOffsetError}</div>
          {/if}
        </svelte:fragment>
      </PropertyField>
      {#if canEdit && startOffsetError}
        <div class="px-2 pb-1 text-xs text-red-500" data-testid="anchor-offset-error">{startOffsetError}</div>
      {/if}
    </Highlight>
  </div>
</Collapse>

<style>
  :global(.anchor-collapse) {
    margin-left: 0;
  }
  .anchor-boundaries {
    background: var(--st-input-background-color);
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .anchor-boundaries .anchor-boundary {
    align-items: center;
    cursor: pointer;
    display: grid;
    height: var(--st-grid-unit3x);
    text-align: center;
  }

  /* The selected edge is a Stellar `.st-button`; the other one is a bare button that should look like plain text. */
  .anchor-boundaries .anchor-boundary:not(.selected) {
    background: transparent;
    border: 0;
    font: inherit;
  }

  .anchor-boundaries .anchor-boundary:hover {
    color: var(--st-black);
  }

  .anchor-boundaries .anchor-boundary.selected:hover {
    background-color: var(--st-white);
    color: inherit;
    cursor: default;
  }

  :global(.anchor-collapse.collapse-root .content) {
    margin-left: 1rem;
  }
</style>
