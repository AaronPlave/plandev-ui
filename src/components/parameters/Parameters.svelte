<svelte:options immutable={true} />

<script context="module" lang="ts">
  let instances = 0;
</script>

<script lang="ts">
  import type { FormParameter, ParameterCapabilities, ParameterName, ParameterType } from '../../types/parameter';
  import { compare } from '../../utilities/generic';
  import { parameterCapabilities } from '../../utilities/parameters';
  import Highlight from '../ui/Highlight.svelte';
  import ParameterBase from './ParameterBase.svelte';
  import ParameterRec from './ParameterRec.svelte';

  /** What can be done with the parameters. Defaults to fully editable. See `parameterCapabilities()`. */
  export let capabilities: ParameterCapabilities = parameterCapabilities(true);
  export let expanded: boolean = false;
  export let formParameters: FormParameter[] = [];
  export let hideInfo: boolean = false;
  export let hideRightAdornments: boolean = false;
  export let highlightKeysMap: Record<string, boolean> = {};
  export let parameterType: ParameterType = 'activity';
  export let parameterToFlash: ParameterName | null = null;

  const hintId = `parameters-hint-${++instances}`;

  let container: HTMLDivElement;
  let activeRowId: string | null = null;

  $: readOnly = !capabilities.edit;
  $: sortedFormParameters = formParameters.sort((a, b) => compare(a.order, b.order));
  // Leaving the read-only list (or re-rendering it) must not leave a dangling active row.
  $: if (!readOnly) {
    activeRowId = null;
  }

  function getRows(): HTMLElement[] {
    return Array.from(container?.querySelectorAll<HTMLElement>('[data-parameter-row]') ?? []);
  }

  function setActive(row: HTMLElement | null) {
    for (const other of getRows()) {
      if (other === row) {
        other.setAttribute('data-active', '');
      } else {
        other.removeAttribute('data-active');
      }
    }
    activeRowId = row?.id ?? null;
    row?.scrollIntoView?.({ block: 'nearest' });
  }

  function getActiveRow(rows: HTMLElement[]): HTMLElement | null {
    return rows.find(row => row.id === activeRowId) ?? null;
  }

  function openDetails(row: HTMLElement | null) {
    row?.querySelector<HTMLElement>('[data-parameter-info]')?.click();
  }

  function toggleRow(row: HTMLElement) {
    row.querySelector<HTMLElement>('button[aria-expanded]')?.click();
  }

  function onFocus(event: FocusEvent) {
    if (readOnly && event.target === container && !getActiveRow(getRows())) {
      setActive(getRows()[0] ?? null);
    }
  }

  function onClick(event: MouseEvent) {
    if (!readOnly) {
      return;
    }
    // Only tracks the active row. Nothing is cancelled, so native text selection and copy are unaffected.
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-parameter-row]');
    if (row) {
      setActive(row);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;

    if (!readOnly) {
      // Editable: Tab reaches each control and then its details button; Alt+Enter is a shortcut from the value.
      if (event.key === 'Enter' && event.altKey) {
        const row = target.closest<HTMLElement>('[data-parameter-row]');
        if (row) {
          event.preventDefault();
          openDetails(row);
        }
      }
      return;
    }

    // Read-only: the container is one tab stop; up/down move between rows, left/right collapse/expand, Enter opens details.
    const rows = getRows();
    if (!rows.length) {
      return;
    }
    const onContainer = target === container;
    const onRowButton = target.tagName === 'BUTTON' && container.contains(target);
    if (!onContainer && !onRowButton) {
      return;
    }
    const current = getActiveRow(rows) ?? rows[0];
    const index = rows.indexOf(current);
    const level = Number(current.getAttribute('aria-level') ?? 1);
    const expandedState = current.getAttribute('aria-expanded');
    let handled = true;

    switch (event.key) {
      case 'ArrowDown':
        setActive(rows[Math.min(index + 1, rows.length - 1)]);
        break;
      case 'ArrowUp':
        setActive(rows[Math.max(index - 1, 0)]);
        break;
      case 'Home':
        setActive(rows[0]);
        break;
      case 'End':
        setActive(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (expandedState === 'false') {
          toggleRow(current);
        } else if (expandedState === 'true') {
          setActive(rows[index + 1] ?? current);
        }
        break;
      case 'ArrowLeft':
        if (expandedState === 'true') {
          toggleRow(current);
        } else {
          const parent = rows
            .slice(0, index)
            .reverse()
            .find(row => Number(row.getAttribute('aria-level') ?? 1) < level);
          if (parent) {
            setActive(parent);
          }
        }
        break;
      case 'Enter':
        if (onContainer) {
          openDetails(current);
        } else {
          handled = false;
        }
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      if (!onContainer) {
        container.focus();
      }
    }
  }
</script>

<!--
  Keyboard handling is delegated here (one handler, no per-row listeners) and nothing is cancelled: this is a
  navigation aid over real, focusable content, not an interceptor.
-->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
  bind:this={container}
  class="parameters-container"
  role={readOnly ? 'tree' : undefined}
  aria-label={readOnly ? 'Parameters' : undefined}
  aria-activedescendant={readOnly ? activeRowId : undefined}
  aria-describedby={readOnly ? hintId : undefined}
  tabindex={readOnly ? 0 : undefined}
  data-testid="parameters"
  on:click={onClick}
  on:focus={onFocus}
  on:keydown={onKeydown}
>
  {#if readOnly}
    <span id={hintId} class="sr-only">
      Use the up and down arrow keys to move between parameters, left and right to collapse or expand, and Enter to show
      details.
    </span>
  {/if}
  <div class="parameters-inner">
    {#each sortedFormParameters as formParameter (formParameter.name)}
      <Highlight
        highlight={highlightKeysMap[formParameter.name]}
        flash={parameterToFlash === formParameter.name}
        on:didFlash
      >
        <div class="parameter">
          <div class="parameter-row-wrapper">
            {#if formParameter.schema.type === 'series' || formParameter.schema.type === 'struct'}
              <ParameterRec
                {capabilities}
                {expanded}
                {formParameter}
                hideDetails={hideInfo}
                {hideRightAdornments}
                {parameterType}
                path={formParameter.name}
                on:change
                on:reset
              />
            {:else}
              <ParameterBase
                {capabilities}
                {formParameter}
                hideDetails={hideInfo}
                {hideRightAdornments}
                {parameterType}
                path={formParameter.name}
                on:change
                on:reset
              />
            {/if}
          </div>
          <div class="right-action">
            <slot name="right-action" parameter={formParameter} />
          </div>
        </div>
      </Highlight>
    {/each}
  </div>
</div>

<style>
  .parameters-container {
    container-type: inline-size;
    outline: none;
  }

  /* Label column: 116px at 340px and wider, 100px below, never more than ~a third of a very narrow panel. */
  .parameters-inner {
    --parameter-label-width: min(100px, 36cqw);
  }

  @container (min-width: 340px) {
    .parameters-inner {
      --parameter-label-width: min(116px, 36cqw);
    }
  }

  .parameter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .parameter-row-wrapper {
    min-width: 0;
  }

  .right-action {
    align-self: start;
    display: flex;
    padding-top: 2px;
  }

  /* Active row of the read-only list (keyboard position), visible only while the list has focus. */
  .parameters-container:focus-visible :global([data-parameter-row][data-active]) {
    background: hsl(var(--accent));
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }

  /* The active row's details button is what Enter opens, so it reads as the row's action while the list has focus. */
  .parameters-container:focus-visible :global([data-parameter-row][data-active] .parameter-details-trigger) {
    color: hsl(var(--foreground));
  }
</style>
