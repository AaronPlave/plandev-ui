<svelte:options immutable={true} />

<script lang="ts">
  import { Popover } from '@nasa-jpl/stellar-svelte';
  import { Info } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';
  import { setClipboardContent } from '../../utilities/clipboard';
  import { isMacOs } from '../../utilities/browser';
  import { formatParameterValue, redactSecrets } from '../../utilities/parameters';
  import AvailabilityButton from '../ui/AvailabilityButton.svelte';

  /**
   * Details for one parameter: what it is, what it means, what it is now, where it came from, what can be done.
   * Opens on click/tap/Enter of the information button (or Alt+Enter from the row); closes on Esc or outside click and
   * returns focus to the button. It stays open while text is selected in it. Placement flips/clamps to the viewport.
   */
  export let capabilities: ParameterCapabilities;
  export let formParameter: FormParameter;
  export let parameterType: ParameterType = 'activity';
  /** Full dotted path of a nested parameter (e.g. `location.position.x`). */
  export let path: string = '';
  /**
   * Whether the button is a Tab stop. Off by default: a list of N parameters would otherwise cost N extra Tab stops.
   * Keyboard users open details with Alt+Enter from the value (read-only lists: Enter on the active row); the button
   * stays in the accessibility tree and clickable.
   */
  export let tabbable: boolean = false;

  const dispatch = createEventDispatcher<{ reset: FormParameter }>();

  let open: boolean = false;

  $: ({ schema, valueSource: source } = formParameter);
  $: unit = (schema as { metadata?: { unit?: { value?: string } } }).metadata?.unit?.value;
  $: description = (schema as { metadata?: { description?: { value?: string } } }).metadata?.description?.value;
  $: isSecret = schema.type === 'secret';
  $: isStructured = schema.type === 'struct' || schema.type === 'series';
  $: isOverride = source === 'user on model' || source === 'user on preset';
  $: presetName = parameterType === 'activity' ? 'preset' : 'template';
  $: hasPreset = formParameter.presetValue !== undefined;
  $: hasDefault = formParameter.defaultValue !== undefined;
  $: resetTarget = source === 'user on preset' && hasPreset ? presetName : 'default';
  $: shortcut = `${isMacOs() ? '⌘' : 'Ctrl'}-click the ● mark in the row`;
  $: typeLine = [typeLabel(schema.type), unit ? `unit: ${unit}` : null, formParameter.required ? 'required' : null]
    .filter(Boolean)
    .join(' · ');
  $: serialised =
    isStructured && formParameter.value != null
      ? JSON.stringify(redactSecrets(formParameter.value, schema as never), null, 2)
      : null;

  const sourceLabels: Record<string, string> = {
    mission: 'model',
    none: '',
    preset: 'preset',
    'user on model': 'Override',
    'user on preset': 'Override',
  };

  function typeLabel(type: string): string {
    return type === 'options-single' || type === 'options-multiple' ? 'option' : type;
  }

  function show(value: unknown): string {
    if (isSecret) {
      return 'Hidden';
    }
    if (value === null || value === undefined || value === '') {
      return 'None';
    }
    try {
      return formatParameterValue(value, schema as never) || String(value);
    } catch {
      return String(value);
    }
  }

  function onReset() {
    dispatch('reset', formParameter);
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="parameter-details-trigger"
    aria-label="Details for {formParameter.name}"
    data-parameter-info
    aria-keyshortcuts="Alt+Enter"
    tabindex={tabbable ? 0 : -1}
  >
    <Info size={14} />
  </Popover.Trigger>
  <Popover.Content
    align="end"
    avoidCollisions
    class="parameter-details max-h-[min(420px,80vh)] w-[min(280px,calc(100vw-16px))] overflow-y-auto p-3 text-xs"
    collisionPadding={8}
    fitViewport
    side="bottom"
    sideOffset={4}
    data-testid="parameter-details"
  >
    <div class="flex flex-col gap-2">
      <div>
        <div class="text-sm font-semibold" data-testid="parameter-details-name">{formParameter.name}</div>
        <div class="text-muted-foreground">{typeLine}</div>
        {#if path && path !== formParameter.name}
          <div class="select-text break-all font-mono text-muted-foreground" data-testid="parameter-details-path">
            {path}
          </div>
        {/if}
      </div>

      {#if description}
        <p class="m-0 select-text whitespace-pre-wrap">{description}</p>
      {/if}

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="parameter-details-values">
        {#if !isStructured}
          <dt class="text-muted-foreground">Current</dt>
          <dd class="m-0 select-text break-words">
            {show(formParameter.value)}
            {#if sourceLabels[source]}<span class="text-muted-foreground">{sourceLabels[source]}</span>{/if}
          </dd>
        {/if}
        {#if hasPreset && !isStructured}
          <dt class="text-muted-foreground">{presetName === 'preset' ? 'Preset' : 'Template'}</dt>
          <dd class="m-0 select-text break-words">{show(formParameter.presetValue)}</dd>
        {/if}
        {#if hasDefault && !isStructured}
          <dt class="text-muted-foreground">Default</dt>
          <dd class="m-0 select-text break-words">{show(formParameter.defaultValue)}</dd>
        {/if}
      </dl>

      {#if serialised}
        <div>
          <pre
            class="m-0 max-h-40 select-text overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono"
            data-testid="parameter-details-json">{serialised}</pre>
          <AvailabilityButton
            class="mt-1"
            label="Copy as JSON"
            size="sm"
            variant="outline"
            on:click={() => setClipboardContent(serialised)}>Copy as JSON</AvailabilityButton
          >
        </div>
      {/if}

      {#if isOverride}
        <div class="flex flex-col gap-1" data-testid="parameter-details-reset">
          <div>
            <AvailabilityButton
              availability={capabilities.reset}
              label="Reset to {resetTarget}"
              size="sm"
              tooltip={false}
              variant="outline"
              on:click={onReset}>Reset to {resetTarget}</AvailabilityButton
            >
          </div>
          {#if !capabilities.reset.available && capabilities.reset.reason}
            <div class="text-muted-foreground">Reset unavailable: {capabilities.reset.reason}</div>
          {:else}
            <div class="text-muted-foreground">Shortcut: {shortcut}.</div>
          {/if}
        </div>
      {/if}

      {#if isSecret}
        <div class="text-muted-foreground">The value is never shown here.</div>
      {/if}
    </div>
  </Popover.Content>
</Popover.Root>

<style>
  :global(.parameter-details-trigger) {
    align-items: center;
    border-radius: 4px;
    color: hsl(var(--muted-foreground));
    display: inline-flex;
    height: 20px;
    justify-content: center;
    width: 20px;
  }

  :global(.parameter-details-trigger:hover) {
    background: hsl(var(--accent));
    color: hsl(var(--foreground));
  }

  :global(.parameter-details-trigger:focus-visible) {
    outline: 2px solid hsl(var(--ring));
  }
</style>
