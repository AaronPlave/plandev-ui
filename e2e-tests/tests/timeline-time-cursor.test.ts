import test, { expect } from '@playwright/test';
import { PanelNames } from '../fixtures/Plan.js';
import { setupTest, teardownTest, type FullSetupResult } from '../utilities/api.js';

/**
 * Covers the draggable timeline time cursor and the inspector panel that reports the state of the
 * plan at the cursor time:
 *  - Clicking the strip above the timeline rows places the cursor, exposed as an ARIA slider.
 *  - The slider is keyboard operable, and notably Up/Down are NOT bound so the page keeps
 *    scrolling normally while the handle holds focus.
 *  - The inspector panel opens from the grid menu and reflects the cursor time.
 *  - The copy-link button captures the cursor, and loading that URL restores it.
 */

let setup: FullSetupResult;

const cursor = () => setup.plan.timeCursor;
const cursorValue = async (): Promise<number> => Number(await cursor().getAttribute('aria-valuenow'));

test.beforeAll(async ({ browser }) => {
  setup = await setupTest(browser);
  await setup.plan.goto();
});

test.afterAll(async () => {
  await teardownTest(setup);
});

test.describe.serial('Timeline Time Cursor', () => {
  test('no cursor exists until one is placed', async () => {
    await setup.plan.waitForTimelineLoading();
    await expect(cursor()).not.toBeVisible();
  });

  test('pressing the playhead lane places the cursor without adding a guide', async () => {
    // The playhead owns a dedicated lane, so placing a cursor can never be mistaken for the hover
    // cursor's add-guide click. The lane is aria-hidden (a ruler, not a control — the placed pill is
    // the accessible control), so it is reached by test id.
    const lane = setup.plan.timelinePlayheadLane;
    await expect(lane).toBeVisible();

    const guidesBefore = await setup.page.getByRole('button', { name: 'Timeline Cursor' }).count();
    const box = await lane.boundingBox();
    expect(box).not.toBeNull();
    await lane.click({ position: { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 } });

    await expect(cursor()).toBeVisible();
    // A placed cursor must expose its time to assistive tech, not just draw a line.
    await expect(cursor()).toHaveAttribute('aria-valuetext', /\d{4}-\d{3}T/);
    // Placing a cursor must not also drop a vertical guide — that was the collision being avoided.
    expect(await setup.page.getByRole('button', { name: 'Timeline Cursor' }).count()).toEqual(guidesBefore);
  });

  test('the cursor stays within the plan bounds', async () => {
    const min = Number(await cursor().getAttribute('aria-valuemin'));
    const max = Number(await cursor().getAttribute('aria-valuemax'));
    const value = await cursorValue();

    expect(max).toBeGreaterThan(min);
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThanOrEqual(max);
  });

  test('arrow keys nudge the cursor while it has focus', async () => {
    await cursor().focus();
    const before = await cursorValue();

    await setup.page.keyboard.press('ArrowRight');
    expect(await cursorValue()).toBeGreaterThan(before);

    const afterRight = await cursorValue();
    await setup.page.keyboard.press('ArrowLeft');
    expect(await cursorValue()).toBeLessThan(afterRight);
  });

  test('Home and End jump to the plan bounds', async () => {
    await cursor().focus();

    await setup.page.keyboard.press('Home');
    expect(await cursorValue()).toEqual(Number(await cursor().getAttribute('aria-valuemin')));

    await setup.page.keyboard.press('End');
    expect(await cursorValue()).toEqual(Number(await cursor().getAttribute('aria-valuemax')));
  });

  test('ArrowDown does not move the cursor, so page scrolling is unaffected', async () => {
    await cursor().focus();
    await setup.page.keyboard.press('Home');
    const before = await cursorValue();

    await setup.page.keyboard.press('ArrowDown');
    expect(await cursorValue()).toEqual(before);

    await setup.page.keyboard.press('ArrowUp');
    expect(await cursorValue()).toEqual(before);
  });

  test('the inspector panel reports the cursor time', async () => {
    await setup.plan.showPanel(PanelNames.TIME_CURSOR, true);

    const panel = setup.plan.panelTimeCursor;
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No time cursor set.')).not.toBeVisible();

    // Every section renders even when empty, so the panel always answers "what is true at T".
    await expect(panel.getByText('Resources')).toBeVisible();
    await expect(panel.getByText('Activities in Progress')).toBeVisible();
    await expect(panel.getByText('External Events')).toBeVisible();
    await expect(panel.getByText('Constraint Violations')).toBeVisible();
  });

  test('the copy-link URL captures the cursor and restores it on load', async () => {
    await cursor().focus();
    await setup.page.keyboard.press('Home');
    const expected = await cursorValue();

    await setup.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setup.plan.timelineViewCopyLinkButton.click();

    const copied = await setup.page.evaluate(() => navigator.clipboard.readText());

    const cursorTime = new URL(copied).searchParams.get('cursorTime');
    expect(cursorTime).not.toBeNull();
    expect(new Date(cursorTime as string).getTime()).toEqual(expected);

    await setup.page.goto(copied);
    await setup.plan.waitForTimelineLoading();
    await expect(cursor()).toBeVisible();
    expect(await cursorValue()).toEqual(expected);
  });

  test('comparison mode adds a second cursor and A/B/delta columns', async () => {
    await setup.plan.showPanel(PanelNames.TIME_CURSOR, true);
    await setup.page.getByRole('button', { name: 'Compare with…' }).click();

    const compare = setup.plan.timeCursorCompare;
    await expect(compare).toBeVisible();
    // B must sit somewhere other than A, otherwise there is nothing to compare.
    expect(Number(await compare.getAttribute('aria-valuenow'))).not.toEqual(await cursorValue());

    // The value columns switch to A / B / delta, and can be swapped for window statistics.
    await expect(setup.plan.panelTimeCursor.getByText('Δ', { exact: true })).toBeVisible();
    await setup.page.getByRole('button', { name: 'Min / Avg / Max' }).click();
    await expect(setup.plan.panelTimeCursor.getByText('Avg', { exact: true })).toBeVisible();
  });

  test('the comparison cursor is independently keyboard operable', async () => {
    const compare = setup.plan.timeCursorCompare;
    await compare.focus();
    const before = Number(await compare.getAttribute('aria-valuenow'));
    const cursorABefore = await cursorValue();

    await setup.page.keyboard.press('ArrowRight');

    expect(Number(await compare.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    // Moving B must not drag A along with it.
    expect(await cursorValue()).toEqual(cursorABefore);
  });

  test('exiting comparison mode removes the second cursor only', async () => {
    await setup.page.getByRole('button', { name: 'Exit comparison' }).click();
    await expect(setup.plan.timeCursorCompare).not.toBeVisible();
    await expect(cursor()).toBeVisible();
  });

  test('the cursor can be cleared from the panel', async () => {
    await setup.page.getByRole('button', { name: 'Clear Time Cursor' }).click();
    await expect(cursor()).not.toBeVisible();
    await expect(setup.plan.panelTimeCursor.getByText('No time cursor set.')).toBeVisible();
  });
});
