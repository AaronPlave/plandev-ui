<svelte:options immutable={true} />

<script lang="ts">
  import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';
  import ParameterDetails from './ParameterDetails.svelte';
  import ParameterName from './ParameterName.svelte';
  import ValueSourceBadge from './ValueSourceBadge.svelte';

  /**
   * The one row layout shared by every parameter (scalar editors, read-only values, struct and series headers):
   *
   *   [ label (wraps) | value | provenance 12px | details 20px ]
   *
   * Nesting is expressed as `indent` taken out of the label column, so values stay in one column at every depth and a
   * read-only hairline starts at the row's indent (where the nesting guide is). The value cell holds either the
   * type-specific editor or the read-only presentation, chosen by the caller (ParameterBase).
   */
  export let capabilities: ParameterCapabilities;
  export let errorId: string = '';
  export let expandable: boolean = false;
  export let expanded: boolean = false;
  export let formParameter: FormParameter;
  export let hideDetails: boolean = false;
  export let hideRightAdornments: boolean = false;
  /** Pixels of nesting before this row (indent is subtracted from the label column). */
  export let indent: number = 0;
  export let level: number = 0;
  export let parameterType: ParameterType = 'activity';
  export let path: string = '';
  /** Muted text shown in the value cell for collapsed groups ("2 items", "{ frame, position }"). */
  export let summary: string = '';

  const dispatch = createEventDispatcher<{
    reset: FormParameter;
    toggle: boolean;
  }>();

  const rowId = `parameter-row-${Math.random().toString(36).slice(2, 9)}`;

  $: readOnly = !capabilities.edit;
  $: errors = formParameter.errors ?? [];
  $: canReset = capabilities.reset.available;

  function toggle() {
    expanded = !expanded;
    dispatch('toggle', expanded);
  }
</script>

<!--
  In a read-only list the whole `Parameters` container is the single tab stop (arrow keys move between rows), so rows
  are tree items; editable rows contain real controls and are plain rows.
-->
<div
  id={rowId}
  class="parameter-row"
  class:read-only={readOnly}
  class:group-row={expandable}
  data-parameter-row
  data-parameter-name={formParameter.name}
  data-testid="parameter-row"
  role={readOnly ? 'treeitem' : undefined}
  aria-level={readOnly ? level + 1 : undefined}
  aria-expanded={readOnly && expandable ? expanded : undefined}
  aria-selected={readOnly ? false : undefined}
  style="--indent: {indent}px"
>
  <div class="cell label">
    {#if expandable}
      <button
        type="button"
        class="toggle"
        aria-expanded={expanded}
        aria-label="{formParameter.name}, {expanded ? 'collapse' : 'expand'}"
        tabindex={readOnly ? -1 : 0}
        on:click={toggle}
      >
        {#if expanded}<ChevronDown size={12} />{:else}<ChevronRight size={12} />{/if}
        <ParameterName {formParameter} />
      </button>
    {:else}
      <ParameterName {formParameter} />
    {/if}
  </div>

  <div class="cell value">
    <slot />
    {#if summary && !expanded}
      <span class="summary" data-testid="parameter-summary">{summary}</span>
    {/if}
    {#if errors.length}
      <div class="error-message" id={errorId} role="alert" data-testid="parameter-error">
        <TriangleAlert size={12} aria-hidden="true" />
        <span>{errors.join(' ')}</span>
      </div>
    {/if}
  </div>

  <div class="cell provenance">
    {#if !hideRightAdornments}
      <ValueSourceBadge
        {canReset}
        {parameterType}
        source={formParameter.valueSource}
        on:reset={() => dispatch('reset', formParameter)}
      />
    {/if}
  </div>

  <div class="cell details">
    {#if !hideDetails}
      <ParameterDetails
        {capabilities}
        {formParameter}
        {parameterType}
        {path}
        on:reset={() => dispatch('reset', formParameter)}
      />
    {/if}
  </div>
</div>

<style>
  .parameter-row {
    --label-width: var(--parameter-label-width, 100px);
    align-items: start;
    column-gap: 4px;
    display: grid;
    font-size: 12px;
    grid-template-columns: max(48px, calc(var(--label-width) - var(--indent))) minmax(0, 1fr) 12px 20px;
    min-height: 28px;
    padding: 4px 0;
  }

  /* View-only: a hairline under every row, starting at the row's indent so it meets the nesting guide. */
  .parameter-row.read-only {
    border-bottom: 1px solid hsl(var(--border));
  }

  .cell {
    min-width: 0;
  }

  .label {
    align-self: start;
    line-height: 20px;
    padding-top: 2px;
  }

  .value {
    align-self: center;
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 20px;
  }

  /* Text sits where an input's text would (8px inset) so nothing moves when permissions change. */
  .parameter-row.read-only .value {
    padding: 2px 8px;
  }

  .provenance,
  .details {
    align-items: center;
    align-self: center;
    display: flex;
    justify-content: center;
  }

  .toggle {
    align-items: flex-start;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    display: flex;
    gap: 2px;
    margin-left: -2px;
    padding: 0;
    text-align: left;
    width: 100%;
  }

  .toggle :global(svg) {
    flex-shrink: 0;
    margin-top: 4px;
  }

  .summary {
    color: hsl(var(--muted-foreground));
    overflow-wrap: break-word;
  }

  .parameter-row:not(.read-only) .summary {
    padding-left: 8px;
  }

  .error-message {
    align-items: flex-start;
    color: var(--st-red);
    display: flex;
    gap: 4px;
    line-height: 16px;
  }

  .error-message :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
  }
</style>
