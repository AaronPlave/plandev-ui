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

  /** A final segment up to this long stays whole and bound to the unit; a longer one is split so it can still wrap. */
  const TAIL_MAX = 12;
  /** How many trailing characters of a longer final segment stay bound to the unit. */
  const TAIL_SPLIT = 4;

  let isEmpty: boolean;
  let text: string;
  let head: string[];
  let tail: string;
  let hasTail: boolean;

  $: isEmpty = value === null || value === undefined || value === '';
  $: text = isEmpty ? empty : format ? format(value) : String(value);
  $: hasTail = !!unit && !isEmpty;
  $: ({ head, tail } = split(softBreakSegments(text), hasTail));

  /**
   * Everything wraps normally except, when there is a unit, the final portion of the value, which is kept together with
   * the unit so the unit is never orphaned on a line of its own. The rest of a long value is free to wrap.
   */
  function split(segments: string[], keepTail: boolean): { head: string[]; tail: string } {
    if (!keepTail) {
      return { head: segments, tail: '' };
    }
    const last = segments[segments.length - 1] ?? '';
    const before = segments.slice(0, -1);
    if (last.length > TAIL_MAX) {
      return { head: [...before, last.slice(0, -TAIL_SPLIT)], tail: last.slice(-TAIL_SPLIT) };
    }
    return { head: before, tail: last };
  }
</script>

<!--
  Read-only presentation of a value: full-contrast, selectable, wrapping (never truncated). This is plain text,
  not a disabled input, so selection and copy work natively and nothing moves when permissions change.
-->
<span class="read-value" class:empty={isEmpty} class:with-unit={hasTail} data-testid="read-value"
  >{#each head as segment, i}{segment}{#if i < head.length - 1 || hasTail}<wbr />{/if}{/each}{#if hasTail}<span
      class="nowrap"
      data-testid="read-value-tail">{tail}{' '}<span class="unit">{unit}</span></span
    >{/if}</span
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
