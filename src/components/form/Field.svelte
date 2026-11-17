<svelte:options immutable={true} />

<script lang="ts">
  import { afterUpdate, createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { FieldStore } from '../../types/form';
  import { getTarget } from '../../utilities/generic';
  import FieldError from './FieldError.svelte';

  export let field: FieldStore<any>;

  const dispatch = createEventDispatcher<{
    change: { valid: boolean };
  }>();

  let container: HTMLFieldSetElement | null = null;
  let input: HTMLInputElement | null = null;
  let label: HTMLLabelElement | null = null;
  let select: HTMLSelectElement | null = null;

  $: if (container && field && input) {
    if (input.value !== $field.value) {
      input.value = $field.value;
    }

    if ($field.invalid) {
      input.classList.add('border-red-500', 'bg-red-500', 'bg-opacity-10', 'text-red-500');
    } else {
      input.classList.remove('border-red-500', 'bg-red-500', 'bg-opacity-10', 'text-red-500');
    }
  }

  $: if (container && field && label) {
    if ($field.invalid) {
      label.classList.add('text-red-500');
    } else {
      label.classList.remove('text-red-500');
    }
  }

  $: if (container && field && select) {
    if (select.value !== $field.value) {
      select.value = $field.value;
    }

    if ($field.invalid) {
      select.classList.add('border-red-500', 'bg-red-500', 'bg-opacity-10', 'text-red-500');
    } else {
      select.classList.remove('border-red-500', 'bg-red-500', 'bg-opacity-10', 'text-red-500');
    }
  }

  let observer: MutationObserver | null = null;

  // The editor may mount/unmount after the Field does (e.g. a `PropertyField` that swaps between an input and a read
  // view as editability changes), so the elements are re-discovered whenever the container's subtree changes.
  // Events are handled by delegation on the container rather than by listeners on a single input.
  function refresh() {
    if (!container) {
      return;
    }
    const newInput = container.querySelector('input');
    const newLabel = container.querySelector('label');
    const newSelect = container.querySelector('select');

    if (newInput !== input) {
      input = newInput;
      if (input && field) {
        input.value = $field.value;
      }
    }
    if (newSelect !== select) {
      select = newSelect;
      if (select && field) {
        select.value = $field.value;
      }
    }
    if (newLabel !== label) {
      label = newLabel;
    }
  }

  onMount(() => {
    refresh();
    if (container) {
      observer = new MutationObserver(refresh);
      observer.observe(container, { childList: true, subtree: true });
    }
  });

  // Slot content changes re-run this synchronously; the observer covers changes made inside nested components.
  afterUpdate(refresh);

  onDestroy(() => {
    observer?.disconnect();
  });

  function isFieldControl(event: Event) {
    const target = event.target as Element | null;
    return !!target && (target === input || target === select);
  }

  function onInput(event: Event) {
    const { value } = getTarget(event);
    $field.value = value;
  }

  async function onChange(event: Event) {
    const { value } = getTarget(event);
    $field.value = value;
    const valid = await field.validateAndSet(value);
    dispatch('change', { valid });
  }
</script>

<fieldset
  bind:this={container}
  on:input={e => isFieldControl(e) && onInput(e)}
  on:change={e => isFieldControl(e) && onChange(e)}
>
  <slot name="label" />
  <slot>No input element provided!</slot>
  <FieldError {field} />
</fieldset>
