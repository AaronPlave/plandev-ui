<svelte:options immutable={true} />

<script lang="ts">
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';
  import { isWithRevision } from '../../utilities/actions';
  import ActionFileParameter from './ActionFileParameter.svelte';
  import ParameterBaseBoolean from './ParameterBaseBoolean.svelte';
  import ParameterBaseDropdown from './ParameterBaseDropdown.svelte';
  import ParameterBaseDuration from './ParameterBaseDuration.svelte';
  import ParameterBaseNumber from './ParameterBaseNumber.svelte';
  import ParameterBasePath from './ParameterBasePath.svelte';
  import ParameterBaseString from './ParameterBaseString.svelte';
  import ParameterBaseVariant from './ParameterBaseVariant.svelte';
  import ParameterReadValue from './ParameterReadValue.svelte';
  import ParameterRow from './ParameterRow.svelte';

  /**
   * The parameter-type dispatch boundary for scalar parameters. This is the only place that decides between the
   * type-specific *editor* and the shared type-aware *read view*, so the editors themselves have no read-only branch.
   * Row layout, provenance, details and validation are the shared `ParameterRow`.
   */
  export let capabilities: ParameterCapabilities;
  export let formParameter: FormParameter;
  export let hideDetails: boolean = false;
  export let hideRightAdornments: boolean = false;
  export let indent: number = 0;
  export let level: number = 0;
  export let parameterType: ParameterType = 'activity';
  export let path: string = '';

  const errorId = `parameter-error-${Math.random().toString(36).slice(2, 9)}`;

  $: type = formParameter.schema.type;
</script>

{#if (type === 'options-single' || type === 'options-multiple') && isWithRevision(formParameter.schema)}
  <ActionFileParameter
    {capabilities}
    {formParameter}
    {hideDetails}
    {hideRightAdornments}
    {indent}
    {level}
    {parameterType}
    path={path || formParameter.name}
    on:change
    on:reset
  />
{:else}
  <ParameterRow
    {capabilities}
    {errorId}
    {formParameter}
    {hideDetails}
    {hideRightAdornments}
    {indent}
    {level}
    {parameterType}
    path={path || formParameter.name}
    on:reset
  >
    {#if !capabilities.edit}
      <ParameterReadValue {formParameter} />
    {:else if type === 'boolean'}
      <ParameterBaseBoolean {errorId} {formParameter} on:change />
    {:else if type === 'duration'}
      <ParameterBaseDuration {errorId} {formParameter} on:change />
    {:else if type === 'int' || type === 'real'}
      <ParameterBaseNumber {errorId} {formParameter} on:change />
    {:else if type === 'path'}
      <ParameterBasePath {errorId} {formParameter} on:change />
    {:else if type === 'string'}
      <ParameterBaseString {errorId} {formParameter} on:change />
    {:else if type === 'secret'}
      <ParameterBaseString {errorId} {formParameter} type="password" on:change />
    {:else if type === 'variant'}
      <ParameterBaseVariant {errorId} {formParameter} on:change />
    {:else if type === 'options-single'}
      <ParameterBaseDropdown {formParameter} on:change />
    {:else if type === 'options-multiple'}
      <ParameterBaseDropdown allowMultiple={true} {formParameter} on:change />
    {:else}
      <ParameterReadValue {formParameter} />
    {/if}
  </ParameterRow>
{/if}
