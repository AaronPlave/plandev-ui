<svelte:options immutable={true} />

<script lang="ts">
  import ReadValue from './ReadValue.svelte';

  /** Visible label of the property. */
  export let label: string;
  /** The value shown when the field is read-only (and by the default read view). */
  export let value: unknown = null;
  /**
   * Whether the property is currently editable. When `true` the default slot (the real editor, usually a Stellar
   * input) is rendered; otherwise a read view is. Callers decide editability (from their existing permission logic);
   * the field only presents it.
   */
  export let editable: boolean = false;
  /** Stable identifier exposed as `data-field` (for tests and automation). */
  export let name: string | undefined = undefined;
  /** `id` of the editor, used to associate the label with it when editable. */
  export let id: string | undefined = undefined;
  export let layout: 'inline' | 'stacked' = 'inline';
  /** Optional formatter for the default read view. */
  export let format: ((value: any) => string) | undefined = undefined;
  /** Text shown (muted) for empty read-only values. */
  export let empty: string = 'None';
  /** Tooltip for the label (e.g. a longer description). */
  export let title: string | undefined = undefined;
  /**
   * Whether a hairline closes the row. By default only read-only rows have one (editable rows are separated by their
   * inputs); pass `true` to force it, e.g. to separate an editable row from a following read-only list.
   */
  export let divider: boolean | undefined = undefined;

  const labelId = `property-label-${Math.random().toString(36).slice(2, 9)}`;

  $: readOnly = !editable;
  $: hasDivider = divider ?? readOnly;
</script>

<!--
  A label/value property row.

  - `<PropertyField label="Plan ID" value={plan.id} />` is intrinsically informational: plain text, no input.
  - Pass `editable` and a child editor to show the editor when allowed and a read view otherwise. The same call site
    covers "editable", "restricted by permission" and "informational"; no `{#if editable}` at the call site.
  - Slot `read`: custom read-only presentation for complex values (tags, collaborators, ...).
  - Slot `action`: a trailing action (e.g. a pencil). The trailing column exists only when this slot is provided.

  The field owns layout and read-only presentation only. Permissions, validation, submission and the editor itself
  belong to the caller.
-->
<div
  class="property-field"
  class:read-only={readOnly}
  class:divider={hasDivider}
  class:stacked={layout === 'stacked'}
  class:has-action={$$slots.action}
  role="group"
  aria-labelledby={labelId}
  data-field={name}
  data-testid="property-field"
>
  {#if editable && id}
    <label class="property-label" for={id} id={labelId} {title}>{label}</label>
  {:else}
    <span class="property-label" id={labelId} {title}>{label}</span>
  {/if}
  <div class="property-value">
    {#if editable && $$slots.default}
      <slot />
    {:else if $$slots.read}
      <slot name="read" />
    {:else}
      <ReadValue {value} {format} {empty} />
    {/if}
  </div>
  {#if $$slots.action}
    <div class="property-action"><slot name="action" /></div>
  {/if}
</div>

<style>
  .property-field {
    align-items: start;
    column-gap: var(--property-column-gap, 8px);
    display: grid;
    grid-template-columns: var(--property-label-width, 100px) minmax(0, 1fr);
    min-height: 28px;
    padding: 2px 0;
    width: 100%;
  }

  .property-field.has-action {
    grid-template-columns: var(--property-label-width, 100px) minmax(0, 1fr) 20px;
  }

  .property-field.stacked {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 4px;
  }

  .property-field.stacked.has-action {
    grid-template-columns: minmax(0, 1fr) 20px;
  }

  .property-field.stacked .property-label {
    grid-column: 1 / -1;
  }

  .property-label {
    align-self: start;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    line-height: 20px;
    overflow-wrap: anywhere;
    padding-top: 2px;
  }

  .property-value {
    align-self: center;
    font-size: 12px;
    line-height: 20px;
    min-width: 0;
  }

  /* Read-only text sits where an input's text would (Stellar inputs have an 8px inset), so nothing shifts when a
     property flips between editable and read-only. */
  .property-field.read-only .property-value {
    padding: 2px 8px;
  }

  .property-field.stacked.read-only .property-value {
    padding-left: 0;
  }

  .property-field.divider {
    border-bottom: 1px solid hsl(var(--border));
  }

  .property-action {
    align-self: center;
    display: flex;
    justify-content: center;
  }
</style>
