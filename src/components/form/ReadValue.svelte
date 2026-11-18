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

  /** A plain numeric literal: sign, digits, optional fraction, optional exponent. */
  const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  /** Digits and their punctuation (times, durations, decimals): never split, even when long. */
  const NUMBER_LIKE = /^[\d.:+\-eE]+$/;

  let isEmpty: boolean;
  let isNumber: boolean;
  let text: string;
  let head: string[];
  let tail: string;
  let hasTail: boolean;

  $: isEmpty = value === null || value === undefined || value === '';
  $: text = isEmpty ? empty : format ? format(value) : String(value);
  $: isNumber = !isEmpty && NUMERIC.test(text.trim());
  $: hasTail = !!unit && !isEmpty && !isNumber;
  $: ({ head, tail } = split(softBreakSegments(text), hasTail));

  /**
   * Everything wraps normally except, when there is a unit, the final portion of the value, which is kept together with
   * the unit so the unit is never orphaned on a line of its own. The rest of a long value is free to wrap.
   * A numeric literal is different: it is never broken (precision and legibility). The unit follows it on the same
   * line when there is room and moves to the next line when there isn't; if the number alone is wider than the column
   * it scrolls horizontally in place, ending in an ellipsis so the cut is visible. The full text stays in the DOM, so
   * selection and copy always yield the complete number.
   */
  function split(segments: string[], keepTail: boolean): { head: string[]; tail: string } {
    if (!keepTail) {
      return { head: segments, tail: '' };
    }
    const last = segments[segments.length - 1] ?? '';
    const before = segments.slice(0, -1);
    // Only prose-like tokens are split to keep the unit company; a number-like one is never cut.
    if (last.length > TAIL_MAX && !NUMBER_LIKE.test(last)) {
      return { head: [...before, last.slice(0, -TAIL_SPLIT)], tail: last.slice(-TAIL_SPLIT) };
    }
    return { head: before, tail: last };
  }
</script>

<!--
  Read-only presentation of a value: full-contrast, selectable, wrapping (never truncated). This is plain text,
  not a disabled input, so selection and copy work natively and nothing moves when permissions change.
-->
<span class="read-value" class:empty={isEmpty} data-testid="read-value"
  >{#if isNumber}<span class="number" data-testid="read-value-number">{text}</span>{#if unit}{' '}<span class="unit"
        >{unit}</span
      >{/if}{:else}{#each head as segment, i}{segment}{#if i < head.length - 1 || hasTail}<wbr
        />{/if}{/each}{#if hasTail}<span class="nowrap" data-testid="read-value-tail"
        >{tail}{' '}<span class="unit">{unit}</span></span
      >{/if}{/if}</span
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

  /* Never broken: if it is wider than the column it scrolls in place (ellipsis marks the cut) instead of wrapping. */
  .number {
    display: inline-block;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: thin;
    text-overflow: ellipsis;
    vertical-align: top;
    white-space: nowrap;
  }

  .unit {
    color: hsl(var(--muted-foreground));
  }
</style>
