<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';
  import type { ValueSchemaStruct } from '../../types/schema';
  import { compare } from '../../utilities/generic';
  import { isRecParameter } from '../../utilities/parameters';
  import ParameterBase from './ParameterBase.svelte';
  import ParameterRec from './ParameterRec.svelte';
  import ParameterRow from './ParameterRow.svelte';

  export let capabilities: ParameterCapabilities;
  export let expanded: boolean = false;
  export let formParameter: FormParameter<ValueSchemaStruct>;
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

  /** Indentation added per nesting level: 12px, then 6px once nesting is deep (level 3+). */
  $: step = level >= 3 ? 6 : 12;
  $: subFormParameters = getSubFormParameters(formParameter);
  $: summary = `{ ${subFormParameters.map(({ name }) => name).join(', ')} }`;
  $: readOnly = !capabilities.edit;

  function getSubFormParameters(formParameter: FormParameter<ValueSchemaStruct>): FormParameter[] {
    const { schema, value = [] } = formParameter;
    const { items: keys, metadata } = schema;
    const order = metadata?.item_order;
    const structKeys = Object.keys(keys).sort();

    const structOrderMap = new Map<string, number>();
    order?.forEach((structKey, index) => {
      structOrderMap.set(structKey, index);
    });

    const subFormParameters = structKeys.map((key, index) => {
      let subFormParameter: FormParameter = {
        defaultValue: formParameter.defaultValue != null ? formParameter.defaultValue[key] : undefined,
        errors: null,
        key,
        name: key,
        order: structOrderMap.get(key) ?? index,
        presetValue: formParameter.presetValue != null ? formParameter.presetValue[key] : undefined,
        schema: schema.items[key],
        value: value !== null ? value[key] : null,
        valueSource: formParameter.valueSource,
      };
      return subFormParameter;
    });

    subFormParameters.sort((a, b) => compare(a.order, b.order));

    return subFormParameters;
  }

  function onChange(event: CustomEvent<FormParameter>) {
    const { detail: subFormParameter } = event;
    const value = {
      ...formParameter.value,
      [subFormParameter.key as keyof FormParameter]: subFormParameter.value,
    };
    dispatch('change', { ...formParameter, value });
  }

  function onResetStruct() {
    dispatch('reset', formParameter);
  }
</script>

<div class="parameter-rec-struct" class:top-level={level === 0} class:read-only={readOnly}>
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
    {summary}
    on:reset={onResetStruct}
    on:toggle={event => (expanded = event.detail)}
  />
  {#if expanded}
    <div
      class="children"
      role={readOnly ? 'group' : undefined}
      style="margin-left: {step - 1}px; --indent-step: {step}px"
    >
      {#each subFormParameters as subFormParameter (subFormParameter.name)}
        {#if isRecParameter(subFormParameter)}
          <ParameterRec
            {capabilities}
            {hideDetails}
            {hideRightAdornments}
            formParameter={subFormParameter}
            indent={indent + step}
            level={level + 1}
            {parameterType}
            path="{path}.{subFormParameter.name}"
            on:change={onChange}
            on:reset={onResetStruct}
          />
        {:else}
          <ParameterBase
            {capabilities}
            {hideDetails}
            {hideRightAdornments}
            formParameter={subFormParameter}
            indent={indent + step}
            level={level + 1}
            {parameterType}
            path="{path}.{subFormParameter.name}"
            on:change={onChange}
            on:reset={onResetStruct}
          />
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Editable top-level groups get a little air; view-only groups are separated by their hairlines. */
  .parameter-rec-struct.top-level:not(.read-only) {
    margin: 6px 0;
  }

  /* One vertical guide per level; the 1px border is part of the indent step so values stay in one column. */
  .children {
    border-left: 1px solid hsl(var(--border));
  }
</style>
