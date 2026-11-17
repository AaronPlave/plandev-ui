import type { Action, ActionReturn } from 'svelte/action';
import type { Instance, Placement } from 'tippy.js';
import tippy from 'tippy.js';

/**
 * Whether an action (a button, menu item, toolbar control, ...) can currently be used, and if not, why.
 *
 * Availability is *derived from* PlanDev's existing permission logic (`featurePermissions`, `planReadOnly`, ...);
 * it is not a permission system of its own. It only describes how a control should present itself.
 * Mutation handlers and the server remain authoritative.
 */
export type Availability = {
  available: boolean;
  reason?: string;
};

export const AVAILABLE: Availability = { available: true };

/** Convenience for the common `hasPermission ? available : unavailable(reason)` pattern. */
export function availabilityOf(isAvailable: boolean, reason: string): Availability {
  return isAvailable ? AVAILABLE : { available: false, reason };
}

export type AvailabilityParams = Availability & {
  /** Tooltip shown when the action is available (e.g. "Change plan time range"). Also used as the accessible name when none exists. */
  label?: string;
  placement?: Placement;
  /**
   * Whether to show the tooltip. Turn off where the reason is already visible next to the control (it is still
   * exposed to assistive technology through `aria-describedby`).
   */
  tooltip?: boolean;
};

/** How long (ms) a touch-triggered explanation stays visible. */
export const TOUCH_REASON_DURATION_MS = 3000;

let nextId = 0;

/**
 * Applies availability semantics to a single control.
 *
 * Unavailable:
 *  - `aria-disabled="true"` (the control stays focusable and in the tab/arrow order so the restriction is discoverable)
 *  - the reason is attached with `aria-describedby` (an off-screen description node) and shown in one tooltip on
 *    hover/focus, and on tap (touch has no hover)
 *  - activation is blocked: `click` and Enter/Space `keydown` are cancelled at the control, before its own handlers.
 *
 * It deliberately does NOT cancel `mousedown`/`mouseup`/`pointerdown`, move focus away, change `tabindex`, or touch
 * `readonly`, so text selection and keyboard navigation keep working.
 *
 * Available: nothing but the (optional) `label` tooltip.
 *
 * The control's own tooltip is owned by this action: do not also add `use:tooltip` to the same element.
 */
export const availability: Action<HTMLElement, AvailabilityParams> = (node, params) => {
  const handle = attachAvailability(node, params);
  return {
    destroy: handle.destroy,
    update: handle.update,
  };
};

export type AvailabilityHandle = {
  destroy: () => void;
  update: (params: AvailabilityParams) => void;
};

export function attachAvailability(node: HTMLElement, initial?: AvailabilityParams): AvailabilityHandle {
  let params: AvailabilityParams = initial ?? AVAILABLE;
  let tip: Instance | null = null;
  let describedBy: HTMLElement | null = null;
  let touchTimer: ReturnType<typeof setTimeout> | null = null;
  const originalDescribedBy = node.getAttribute('aria-describedby');
  const hadTitle = node.hasAttribute('title');

  const guard = (event: Event) => {
    if (params.available) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.type === 'click') {
      // Touch (and mouse) users get the explanation on activation; hover/focus handle the rest.
      showReason();
    }
  };

  const guardKey = (event: KeyboardEvent) => {
    if (!params.available && (event.key === 'Enter' || event.key === ' ')) {
      guard(event);
      if (event.key === 'Enter') {
        showReason();
      }
    }
  };

  function showReason() {
    if (!tip || !params.reason) {
      return;
    }
    tip.show();
    if (touchTimer) {
      clearTimeout(touchTimer);
    }
    touchTimer = setTimeout(() => tip?.hide(), TOUCH_REASON_DURATION_MS);
  }

  function apply() {
    const { available, label, placement = 'top', reason } = params;
    const content = available ? (label ?? '') : (reason ?? label ?? '');

    if (hadTitle) {
      node.removeAttribute('title');
    }

    if (params.tooltip === false) {
      tip?.destroy();
      tip = null;
    } else if (!tip) {
      tip = tippy(node, {
        // The description is exposed through aria-describedby below (always present, not only while the tip is
        // open), so tippy must not add a second, conflicting association.
        aria: { content: null, expanded: false },
        delay: [500, 50],
        maxWidth: 'none',
        placement,
        touch: ['hold', 500],
        trigger: 'mouseenter focus',
      });
    }
    if (tip) {
      tip.setProps({ placement });
      tip.setContent(content);
      if (content) {
        tip.enable();
      } else {
        tip.disable();
      }
    }

    if (available) {
      node.removeAttribute('aria-disabled');
      node.removeAttribute('data-unavailable');
      removeDescription();
      if (label && !node.getAttribute('aria-label') && !node.textContent?.trim()) {
        node.setAttribute('aria-label', label);
      }
    } else {
      node.setAttribute('aria-disabled', 'true');
      node.setAttribute('data-unavailable', 'true');
      setDescription(reason ?? '');
      tip?.hide();
      if (label && !node.getAttribute('aria-label') && !node.textContent?.trim()) {
        node.setAttribute('aria-label', label);
      }
    }
  }

  function setDescription(text: string) {
    if (!text) {
      removeDescription();
      return;
    }
    if (!describedBy) {
      describedBy = document.createElement('span');
      describedBy.id = `availability-reason-${++nextId}`;
      // Visually hidden, but available to assistive technology. Lives outside any component tree so it can't
      // interfere with Svelte's DOM management of the control's parent.
      Object.assign(describedBy.style, {
        clip: 'rect(0 0 0 0)',
        height: '1px',
        overflow: 'hidden',
        position: 'absolute',
        whiteSpace: 'nowrap',
        width: '1px',
      });
      document.body.appendChild(describedBy);
    }
    describedBy.textContent = text;
    node.setAttribute(
      'aria-describedby',
      [originalDescribedBy, describedBy.id].filter((id): id is string => !!id).join(' '),
    );
  }

  function removeDescription() {
    describedBy?.remove();
    describedBy = null;
    if (originalDescribedBy) {
      node.setAttribute('aria-describedby', originalDescribedBy);
    } else {
      node.removeAttribute('aria-describedby');
    }
  }

  // Capture phase on the control itself: runs before the control's own (and its ancestors') handlers.
  node.addEventListener('click', guard, true);
  node.addEventListener('keydown', guardKey, true);
  apply();

  return {
    destroy() {
      node.removeEventListener('click', guard, true);
      node.removeEventListener('keydown', guardKey, true);
      if (touchTimer) {
        clearTimeout(touchTimer);
      }
      tip?.destroy();
      tip = null;
      removeDescription();
      node.removeAttribute('aria-disabled');
      node.removeAttribute('data-unavailable');
    },
    update(next: AvailabilityParams) {
      params = next ?? AVAILABLE;
      apply();
    },
  };
}

/**
 * Adapter for components that only accept actions through bits-ui `builders` (Stellar's `Button`).
 * bits-ui does not re-run an action when a builder changes, so the handle's `update` must be called as the
 * availability changes (see `AvailabilityButton.svelte`).
 */
export function createAvailabilityBuilder() {
  let handle: AvailabilityHandle | null = null;
  let latest: AvailabilityParams = AVAILABLE;
  return {
    builder: {
      action: (node: HTMLElement): ActionReturn => {
        handle = attachAvailability(node, latest);
        return {
          destroy: () => {
            handle?.destroy();
            handle = null;
          },
        };
      },
    },
    update(params: AvailabilityParams) {
      latest = params;
      handle?.update(params);
    },
  };
}
