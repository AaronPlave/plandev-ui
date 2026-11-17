<svelte:options immutable={true} />

<script lang="ts">
  import { softBreakSegments } from '../../utilities/softBreaks';

  /** The raw value. `null`, `undefined` and `''` are "empty". */
  export let value: unknown = null;
  /** Optional formatter for the display string. Not applied to empty values. */
  export let format: ((value: any) => string) | undefined = undefined;
  /** Text shown (muted) for empty values. */
  export let empty: string = 'None';
  /** Optional unit that stays attached to the value. */
  export let unit: string | undefined = undefined;

  let isEmpty: boolean;
  let text: string;
  let segments: string[];

  $: isEmpty = value === null || value === undefined || value === '';
  $: text = isEmpty ? empty : format ? format(value) : String(value);
  $: segments = softBreakSegments(text);
</script>

<!--
  Read-only presentation of a value: full-contrast, selectable, wrapping (never truncated). This is plain text,
  not a disabled input, so selection and copy work natively and nothing moves when permissions change.
-->
<span class="read-value" class:empty={isEmpty} class:with-unit={!!unit && !isEmpty} data-testid="read-value"
  >{#if unit && !isEmpty}<span class="nowrap">{text}{' '}<span class="unit">{unit}</span></span
    >{:else}{#each segments as segment, i}{segment}{#if i < segments.length - 1}<wbr />{/if}{/each}{/if}</span
>

<style>
  .read-value {
    color: hsl(var(--foreground));
    min-width: 0;
    overflow-wrap: break-word;
    user-select: text;
    white-space: pre-wrap;
  }

  .read-value.empty {
    color: hsl(var(--muted-foreground));
  }

  .nowrap {
    white-space: nowrap;
  }

  .unit {
    color: hsl(var(--muted-foreground));
  }
</style>
