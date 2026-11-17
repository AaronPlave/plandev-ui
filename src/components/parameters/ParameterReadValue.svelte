<svelte:options immutable={true} />

<script lang="ts">
  import type { FormParameter } from '../../types/parameter';
  import type { ValueSchemaVariant } from '../../types/schema';
  import { convertUsToDurationString } from '../../utilities/time';
  import ReadValue from '../form/ReadValue.svelte';

  /**
   * The read-only presentation of a scalar parameter value, chosen by schema type. This is the single place that knows
   * how to show each type without an editor, so the type-specific editors don't each need a read-only branch.
   */
  export let formParameter: FormParameter;

  /** Secrets always render the same fixed-length mask: neither the value nor its length is shown. */
  const SECRET_MASK = '••••••••';

  $: unit = (formParameter.schema as { metadata?: { unit?: { value?: string } } }).metadata?.unit?.value;
  $: text = display(formParameter);

  function display({ schema, value }: FormParameter): unknown {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    switch (schema.type) {
      case 'secret':
        return SECRET_MASK;
      case 'boolean':
        return String(value);
      case 'duration':
        return typeof value === 'number' ? convertUsToDurationString(value, false) : String(value);
      case 'options-single':
      case 'options-multiple': {
        const options = (schema as { options?: { display: string; value: unknown }[] }).options ?? [];
        const show = (v: unknown) => options.find(option => option.value === v)?.display ?? String(v);
        return Array.isArray(value) ? value.map(show).join(', ') : show(value);
      }
      case 'variant': {
        const variants = (schema as ValueSchemaVariant).variants ?? [];
        return variants.find(variant => variant.key === value)?.label ?? String(value);
      }
      default:
        return String(value);
    }
  }
</script>

<ReadValue value={text} {unit} />
