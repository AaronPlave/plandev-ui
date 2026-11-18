import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormParameter } from '../../types/parameter';
import { parameterCapabilities } from '../../utilities/parameters';
import Parameters from './Parameters.svelte';

vi.mock('$env/dynamic/public', () => ({ env: {} })); // https://github.com/sveltejs/kit/issues/8180

const { copied } = vi.hoisted(() => ({ copied: [] as unknown[] }));
vi.mock('../../utilities/clipboard', () => ({
  getClipboardContent: vi.fn(),
  setClipboardContent: (content: unknown) => copied.push(content),
}));

const secret = 'hunter2-super-secret';

function params(): FormParameter[] {
  return [
    {
      errors: null,
      name: 'biteSize',
      order: 0,
      required: true,
      schema: { metadata: { unit: { value: 'm' } }, type: 'real' },
      value: 2,
      valueSource: 'user on model',
    },
    {
      errors: null,
      name: 'biteSchedule',
      order: 1,
      schema: { items: { type: 'duration' }, type: 'series' },
      value: [300000000, 600000000],
      valueSource: 'mission',
    },
    {
      errors: null,
      name: 'location',
      order: 2,
      schema: {
        items: { frame: { type: 'string' }, position: { items: { x: { type: 'real' } }, type: 'struct' } },
        type: 'struct',
      },
      value: { frame: 'MOON', position: { x: 1.2 } },
      valueSource: 'mission',
    },
    {
      errors: null,
      name: 'uplinkToken',
      order: 3,
      schema: { type: 'secret' },
      value: secret,
      valueSource: 'mission',
    },
    {
      errors: ['Must be greater than 0'],
      name: 'broken',
      order: 4,
      schema: { type: 'int' },
      value: -1,
      valueSource: 'mission',
    },
    {
      errors: null,
      name: 'flag',
      order: 5,
      schema: { type: 'boolean' },
      value: true,
      valueSource: 'preset',
    },
  ];
}

// Struct/series rows are loaded lazily (they recurse into each other), so wait for them to appear.
const ready = (container: HTMLElement, ...names: string[]) =>
  vi.waitFor(() => {
    for (const name of names) {
      expect(container.querySelector(`[data-parameter-name="${name}"]`)).not.toBeNull();
    }
  });

const readOnly = parameterCapabilities(false, 'You do not have permission to update this activity');

describe('Parameters: editable vs read-only presentation', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('editable: type-specific editors, no tree semantics, no hairlines, ⓘ is a normal Tab stop after its value', async () => {
    const { container, getAllByRole, getByTestId } = render(Parameters, { formParameters: params() });
    await ready(container, 'biteSchedule', 'location');

    expect(getByTestId('parameters').getAttribute('role')).toBeNull();
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelectorAll('.parameter-row.read-only').length).toBe(0);
    for (const info of Array.from(container.querySelectorAll('[data-parameter-info]'))) {
      expect(info.getAttribute('tabindex')).toBe('0');
      expect(info.getAttribute('aria-keyshortcuts')).toBe('Alt+Enter');
      expect(info.getAttribute('aria-label')).toMatch(/^Details for /);
      expect(info.tagName).toBe('BUTTON');
    }
    // Discoverable by Tab: within a row the details button comes after the value control in document order.
    const row = container.querySelector('[data-parameter-name="biteSize"]') as HTMLElement;
    const input = row.querySelector('input') as HTMLElement;
    const info = row.querySelector('[data-parameter-info]') as HTMLElement;
    expect(input.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getAllByRole('button', { name: /Add value|Remove value/ }).length).toBe(2);
  });

  it('read-only: the same parameters render as plain text with a hairline per row and no editors', async () => {
    const { container, getByTestId } = render(Parameters, {
      capabilities: readOnly,
      expanded: true,
      formParameters: params(),
    });
    await ready(container, 'biteSchedule', 'location', 'frame', 'position');

    expect(getByTestId('parameters').getAttribute('role')).toBe('tree');
    expect(container.querySelectorAll('input, select, textarea').length).toBe(0);
    const rows = container.querySelectorAll('.parameter-row');
    expect(rows.length).toBeGreaterThan(5);
    for (const row of Array.from(rows)) {
      expect(row.classList.contains('read-only')).toBe(true);
    }
    const value = (name: string) =>
      container.querySelector(`[data-parameter-name="${name}"] .value`)?.textContent?.replace(/\s+/g, ' ').trim();
    expect(value('biteSize')).toBe('2 m');
    expect(value('flag')).toBe('true');
    expect(value('frame')).toBe('MOON');
  });

  it('read-only: no add/remove buttons, but the series stays expandable', async () => {
    const { container, getByRole, queryByRole } = render(Parameters, {
      capabilities: readOnly,
      formParameters: params(),
    });
    await ready(container, 'biteSchedule');
    expect(queryByRole('button', { name: /Add value|Remove value/ })).toBeNull();

    expect(container.querySelector('[data-parameter-name="[0]"]')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'biteSchedule, expand' }));
    expect(container.querySelector('[data-parameter-name="[0]"] .value')?.textContent?.trim()).toBe('5m');
    expect(container.querySelector('[data-parameter-name="biteSchedule"]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('secrets: fixed-length mask in read-only mode, and the value is nowhere in the DOM', () => {
    const { container } = render(Parameters, { capabilities: readOnly, formParameters: params() });
    expect(container.querySelector('[data-parameter-name="uplinkToken"] .value')?.textContent?.trim()).toBe('••••••••');
    expect(container.innerHTML).not.toContain(secret);
    expect(document.body.innerHTML).not.toContain(secret);
  });

  it('secrets: editable stays a plain password input (no reveal control) and still edits and validates', async () => {
    const formParameters = params();
    const { container, queryByRole } = render(Parameters, { formParameters });
    const input = container.querySelector('[data-parameter-name="uplinkToken"] input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(queryByRole('button', { name: /Show|Hide/ })).toBeNull();
    await fireEvent.input(input, { target: { value: 'new-token' } });
    await fireEvent.change(input);
    expect(input.type).toBe('password');
    expect(formParameters[3].value).toBe('new-token');
  });

  it('shows validation errors under the control in both modes (aria wiring in editable mode)', () => {
    const editable = render(Parameters, { formParameters: params() });
    const error = editable.container.querySelector(
      '[data-parameter-name="broken"] [data-testid="parameter-error"]',
    ) as HTMLElement;
    expect(error.textContent).toContain('Must be greater than 0');
    const input = editable.container.querySelector('[data-parameter-name="broken"] input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    editable.unmount();

    const view = render(Parameters, { capabilities: readOnly, formParameters: params() });
    expect(
      view.container.querySelector('[data-parameter-name="broken"] [data-testid="parameter-error"]')?.textContent,
    ).toContain('Must be greater than 0');
  });

  it('nesting: every level indents by 12px (6px from level 3) and values stay in one column', async () => {
    const { container, getByRole } = render(Parameters, {
      capabilities: readOnly,
      expanded: true,
      formParameters: params(),
    });
    await ready(container, 'location', 'frame', 'position');
    await fireEvent.click(getByRole('button', { name: 'position, expand' }));
    await ready(container, 'x');
    const indent = (name: string) =>
      (container.querySelector(`[data-parameter-name="${name}"]`) as HTMLElement).style.getPropertyValue('--indent');
    expect(indent('location')).toBe('0px');
    expect(indent('frame')).toBe('12px');
    expect(indent('position')).toBe('12px');
    expect(indent('x')).toBe('24px');
  });

  it('sibling rows at the same level share an indent (no ++level drift)', async () => {
    const items: FormParameter[] = [
      {
        errors: null,
        name: 'group',
        order: 0,
        schema: { items: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }, type: 'struct' },
        value: { a: '1', b: '2', c: '3' },
        valueSource: 'mission',
      },
    ];
    const { container } = render(Parameters, { capabilities: readOnly, expanded: true, formParameters: items });
    await ready(container, 'a', 'b', 'c');
    for (const name of ['a', 'b', 'c']) {
      expect(
        (container.querySelector(`[data-parameter-name="${name}"]`) as HTMLElement).style.getPropertyValue('--indent'),
      ).toBe('12px');
    }
  });

  it('provenance: override ● and preset ◆ are indicators, model default shows nothing', () => {
    const { container } = render(Parameters, { formParameters: params() });
    expect(
      container.querySelector('[data-parameter-name="biteSize"] [data-source="override"]')?.textContent?.trim(),
    ).toBe('●');
    expect(container.querySelector('[data-parameter-name="flag"] [data-source="preset"]')?.textContent?.trim()).toBe(
      '◆',
    );
    expect(container.querySelector('[data-parameter-name="biteSchedule"] [data-source]')).toBeNull();
  });
});

describe('Parameters: read-only keyboard navigation', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  async function key(el: HTMLElement, k: string) {
    await fireEvent.keyDown(el, { key: k });
  }

  it('is a single tab stop; arrows move the active row; left/right collapse/expand; Enter opens details', async () => {
    const { container, getByTestId, findByTestId } = render(Parameters, {
      capabilities: readOnly,
      formParameters: params(),
    });
    await ready(container, 'biteSchedule', 'location');
    const tree = getByTestId('parameters');
    expect(tree.getAttribute('tabindex')).toBe('0');
    for (const info of Array.from(container.querySelectorAll('[data-parameter-info]'))) {
      expect(info.getAttribute('tabindex')).toBe('-1');
    }
    // The shortcut is announced with the list, not left to be discovered.
    const hint = container.querySelector(`#${tree.getAttribute('aria-describedby')}`);
    expect(hint?.textContent).toMatch(/arrow keys.*Enter to show\s+details/s);
    const active = () => container.querySelector('[data-active]')?.getAttribute('data-parameter-name');

    await fireEvent.focus(tree);
    expect(active()).toBe('biteSize');
    expect(tree.getAttribute('aria-activedescendant')).toBe(container.querySelector('[data-active]')?.id);
    await key(tree, 'ArrowDown');
    expect(active()).toBe('biteSchedule');
    await key(tree, 'ArrowRight');
    await ready(container, '[0]');
    await key(tree, 'ArrowRight'); // already expanded: moves into the first child
    expect(active()).toBe('[0]');
    await key(tree, 'ArrowLeft'); // leaf: back to the parent
    expect(active()).toBe('biteSchedule');
    await key(tree, 'ArrowLeft'); // collapse
    expect(container.querySelector('[data-parameter-name="[0]"]')).toBeNull();
    await key(tree, 'End');
    expect(active()).toBe('flag');
    await key(tree, 'Home');
    expect(active()).toBe('biteSize');

    await key(tree, 'Enter');
    const details = await findByTestId('parameter-details');
    expect(details.textContent).toContain('biteSize');
  });

  it('does not cancel pointer events or text selection (no mousedown/click interception)', async () => {
    const { container } = render(Parameters, { capabilities: readOnly, formParameters: params() });
    const value = container.querySelector('[data-parameter-name="biteSize"] .value') as HTMLElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    value.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    value.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe('Parameters: editable keyboard', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('Alt+Enter on a value opens its details', async () => {
    const { container, findByTestId } = render(Parameters, { formParameters: params() });
    const input = container.querySelector('[data-parameter-name="biteSize"] input') as HTMLInputElement;
    await fireEvent.keyDown(input, { altKey: true, key: 'Enter' });
    const details = await findByTestId('parameter-details');
    expect(details.textContent).toContain('biteSize');
  });
});

describe('Parameter details', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  const withPreset = (): FormParameter[] => [
    {
      defaultValue: 1,
      errors: null,
      name: 'biteSize',
      order: 0,
      presetValue: 1.5,
      schema: { metadata: { description: { value: 'Distance of the bite.' }, unit: { value: 'm' } }, type: 'real' },
      value: 2,
      valueSource: 'user on preset',
    },
  ];

  it('shows type, units, description and current/preset/default; Reset is explained and inert when unavailable', async () => {
    const { findByTestId, getByRole } = render(Parameters, { capabilities: readOnly, formParameters: withPreset() });
    await fireEvent.click(getByRole('button', { name: 'Details for biteSize' }));
    const details = await findByTestId('parameter-details');
    const text = details.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('real');
    expect(text).toContain('unit: m');
    expect(text).toContain('Distance of the bite.');
    expect(text).toMatch(/Current\s*2\s*Override/);
    expect(text).toMatch(/Preset\s*1\.5/);
    expect(text).toMatch(/Default\s*1/);
    const reset = details.querySelector('button[aria-disabled="true"]') as HTMLButtonElement;
    expect(reset.textContent).toContain('Reset to preset');
    expect(text).toContain('Reset unavailable: You do not have permission to update this activity');
  });

  it('Reset dispatches reset when available', async () => {
    const resets: FormParameter[] = [];
    const { component, findByTestId, getByRole } = render(Parameters, { formParameters: withPreset() });
    component.$on('reset', (e: CustomEvent<FormParameter>) => resets.push(e.detail));
    await fireEvent.click(getByRole('button', { name: 'Details for biteSize' }));
    const details = await findByTestId('parameter-details');
    await fireEvent.click(details.querySelector('[data-testid="parameter-details-reset"] button') as HTMLElement);
    expect(resets.length).toBe(1);
    expect(resets[0].name).toBe('biteSize');
  });

  it('never shows a secret value in details', async () => {
    const { findByTestId, getByRole } = render(Parameters, {
      capabilities: readOnly,
      formParameters: [
        {
          errors: null,
          name: 'uplinkToken',
          order: 0,
          schema: { type: 'secret' },
          value: secret,
          valueSource: 'mission',
        },
      ],
    });
    await fireEvent.click(getByRole('button', { name: 'Details for uplinkToken' }));
    const details = await findByTestId('parameter-details');
    expect(details.textContent).not.toContain(secret);
    expect(details.textContent).toContain('Hidden');
  });

  it('structs offer the serialised value (Copy as JSON)', async () => {
    const { container, findByTestId, getByRole } = render(Parameters, {
      capabilities: readOnly,
      formParameters: [
        {
          errors: null,
          name: 'location',
          order: 0,
          schema: { items: { frame: { type: 'string' } }, type: 'struct' },
          value: { frame: 'MOON' },
          valueSource: 'mission',
        },
      ],
    });
    await ready(container, 'location');
    await fireEvent.click(getByRole('button', { name: 'Details for location' }));
    const details = await findByTestId('parameter-details');
    expect(details.querySelector('[data-testid="parameter-details-json"]')?.textContent).toContain('"frame": "MOON"');
    expect(details.textContent).toContain('Copy as JSON');
  });

  describe.each([
    ['view-only', readOnly],
    ['editable', undefined],
  ])('nested secrets in details and Copy as JSON (%s)', (_label, capabilities) => {
    const nested = (): FormParameter[] => [
      {
        errors: null,
        name: 'connections',
        order: 0,
        schema: {
          items: {
            items: {
              host: { type: 'string' },
              ports: { items: { type: 'secret' }, type: 'series' },
              token: { type: 'secret' },
            },
            type: 'struct',
          },
          type: 'series',
        },
        value: [
          { host: 'a.example.org', ports: [`${secret}-p1`], token: `${secret}-1` },
          { host: 'b.example.org', ports: [], token: `${secret}-2` },
        ],
        valueSource: 'mission',
      },
    ];

    it('shows and copies only the sanitized representation', async () => {
      copied.length = 0;
      const { container, findByTestId, getByRole } = render(Parameters, {
        ...(capabilities ? { capabilities } : {}),
        formParameters: nested(),
      });
      await ready(container, 'connections');
      await fireEvent.click(getByRole('button', { name: 'Details for connections' }));
      const details = await findByTestId('parameter-details');
      const json = details.querySelector('[data-testid="parameter-details-json"]') as HTMLElement;
      expect(json.textContent).toContain('a.example.org');
      expect(json.textContent).toContain('••••••••');
      expect(json.textContent).not.toContain(secret);

      await fireEvent.click(getByRole('button', { name: 'Copy as JSON' }));
      expect(copied.length).toBe(1);
      expect(String(copied[0])).toContain('b.example.org');
      expect(String(copied[0])).not.toContain(secret);
      expect(JSON.parse(String(copied[0]))[0].token).toBe('••••••••');

      expect(document.body.innerHTML).not.toContain(secret);
    });

    it('hides values the schema does not describe, in both the details and the copied JSON', async () => {
      copied.length = 0;
      const incomplete: FormParameter[] = [
        {
          errors: null,
          name: 'link',
          order: 0,
          schema: { items: { host: { type: 'string' }, token: { type: 'secret' } }, type: 'struct' },
          value: {
            extra: `${secret}-extra`,
            host: 'c.example.org',
            nested: { deeper: [`${secret}-deep`] },
            token: `${secret}-token`,
          },
          valueSource: 'mission',
        },
      ];
      const { container, findByTestId, getByRole } = render(Parameters, {
        ...(capabilities ? { capabilities } : {}),
        formParameters: incomplete,
      });
      await ready(container, 'link');
      await fireEvent.click(getByRole('button', { name: 'Details for link' }));
      const details = await findByTestId('parameter-details');
      const json = details.querySelector('[data-testid="parameter-details-json"]') as HTMLElement;
      expect(json.textContent).toContain('c.example.org');
      expect(json.textContent).toContain('[hidden: not in schema]');
      expect(json.textContent).not.toContain(secret);

      await fireEvent.click(getByRole('button', { name: 'Copy as JSON' }));
      expect(JSON.parse(String(copied[0]))).toEqual({
        extra: '[hidden: not in schema]',
        host: 'c.example.org',
        nested: '[hidden: not in schema]',
        token: '••••••••',
      });
      expect(String(copied[0])).not.toContain(secret);
      // The stored value is untouched.
      expect((incomplete[0].value as Record<string, unknown>).extra).toBe(`${secret}-extra`);
      expect(document.body.innerHTML).not.toContain(secret);
    });
  });
});
