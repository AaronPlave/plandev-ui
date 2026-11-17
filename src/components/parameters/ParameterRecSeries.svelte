<svelte:options immutable={true} />

<script lang="ts">
  import { Minus, Plus } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';
  import type { ValueSchemaSeries } from '../../types/schema';
  import { getArgument, getValueSchemaDefaultValue } from '../../utilities/parameters';
  import AvailabilityButton from '../ui/AvailabilityButton.svelte';
  import ParameterBase from './ParameterBase.svelte';
  import ParameterRec from './ParameterRec.svelte';
  import ParameterRow from './ParameterRow.svelte';

  export let capabilities: ParameterCapabilities;
  export let expanded: boolean = false;
  export let formParameter: FormParameter<ValueSchemaSeries>;
  export let hideDetails: boolean = false;
  export let hideRightAdornments: boolean = false;
  export let indent: number = 0;
  export let level: number = 0;
  export let parameterType: ParameterType = 'activity';
  export let path: string = '';

  const dispatch = createEventDispatcher<{
    change: FormParameter;
    reset: FormParameter;
  }>();

  $: step = level >= 3 ? 6 : 12;
  $: subFormParameters = getSubFormParameters(formParameter);
  $: readOnly = !capabilities.edit;

  function getSubFormParameters(formParameter: FormParameter<ValueSchemaSeries>): FormParameter[] {
    const subFormParameters = [];
    const { schema } = formParameter;
    const value = formParameter.value ?? [];

    for (let i = 0; i < value.length; ++i) {
      const subFormParameter: FormParameter = {
        errors: null,
        index: i,
        name: `[${i}]`,
        order: i,
        schema: schema.items,
        value: getArgument(value[i], schema.items).value,
        valueSource: formParameter.valueSource,
      };
      subFormParameters.push(subFormParameter);
    }

    return subFormParameters;
  }

  function onChange(event: CustomEvent<FormParameter>) {
    const { detail: subFormParameter } = event;
    const value = [...formParameter.value];
    if (subFormParameter.index !== undefined) {
      value[subFormParameter.index] = subFormParameter.value;
    }
    dispatch('change', { ...formParameter, value });
  }

  function onResetSeries() {
    dispatch('reset', formParameter);
  }

  function valueAdd() {
    const { schema } = formParameter;
    const newValue = getValueSchemaDefaultValue(schema.items);
    const value = [...(formParameter?.value ?? []), newValue];
    dispatch('change', { ...formParameter, value });
  }

  function valueRemove() {
    const value = [...formParameter.value];
    value.pop();
    dispatch('change', { ...formParameter, value });
  }
</script>

<div class="parameter-rec-series" class:top-level={level === 0} class:read-only={readOnly}>
  <ParameterRow
    {capabilities}
    {expanded}
    expandable
    {formParameter}
    {hideDetails}
    {hideRightAdornments}
    {indent}
    {level}
    {parameterType}
    {path}
    on:reset={onResetSeries}
    on:toggle={event => (expanded = event.detail)}
  >
    <div class="series-summary">
      <span class="count" data-testid="parameter-summary"
        >{subFormParameters.length} {subFormParameters.length === 1 ? 'item' : 'items'}</span
      >
      {#if capabilities.edit}
        <!-- Adding/removing items is independent of expanding/collapsing and of inspecting. -->
        <AvailabilityButton
          availability={subFormParameters.length === 0
            ? { available: false, reason: 'There are no values to remove' }
            : capabilities.structure}
          label="Remove value"
          size="icon-sm"
          variant="outline"
          on:click={valueRemove}
        >
          <Minus size={12} />
        </AvailabilityButton>
        <AvailabilityButton
          availability={capabilities.structure}
          label="Add value"
          size="icon-sm"
          variant="outline"
          on:click={valueAdd}
        >
          <Plus size={12} />
        </AvailabilityButton>
      {/if}
    </div>
  </ParameterRow>
  {#if expanded}
    <div
      class="children"
      role={readOnly ? 'group' : undefined}
      style="margin-left: {step - 1}px; --indent-step: {step}px"
    >
      {#each subFormParameters as subFormParameter (subFormParameter.name)}
        {#if subFormParameter.schema.type === 'series' || subFormParameter.schema.type === 'struct'}
          <ParameterRec
            {capabilities}
            {hideDetails}
            hideRightAdornments
            expanded
            formParameter={subFormParameter}
            indent={indent + step}
            level={level + 1}
            {parameterType}
            path="{path}{subFormParameter.name}"
            on:change={onChange}
            on:reset={onResetSeries}
          />
        {:else}
          <ParameterBase
            {capabilities}
            {hideDetails}
            hideRightAdornments
            formParameter={subFormParameter}
            indent={indent + step}
            level={level + 1}
            {parameterType}
            path="{path}{subFormParameter.name}"
            on:change={onChange}
            on:reset={onResetSeries}
          />
        {/if}
      {:else}
        <div class="empty">This series has no values</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .parameter-rec-series.top-level:not(.read-only) {
    margin: 6px 0;
  }

  .children {
    border-left: 1px solid hsl(var(--border));
  }

  .series-summary {
    align-items: center;
    display: flex;
    gap: 4px;
  }

  .count {
    color: hsl(var(--muted-foreground));
    flex: 1 1 auto;
    min-width: 0;
    padding-left: 8px;
    white-space: nowrap;
  }

  .series-summary :global(button) {
    flex: none;
  }

  .parameter-rec-series.read-only .count {
    padding-left: 0;
  }

  .empty {
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    padding: 4px 8px;
  }
</style>
