// The Fame Checker (fame_checker.c, menus/fameChecker.ts): the rival gives it in Cerulean City after his battle
// (CeruleanCity_EventScript_Rival: `famechecker FAMECHECKER_BILL, 0`, FLAG_GOT_FAME_CHECKER, `giveitem`); it opens
// from the bag's KEY ITEMS (FieldUseFunc_FameChecker → UseFameChecker(CB2_BagMenuFromStartMenu)) and, registered,
// with SELECT on the field (Task_UseFameCheckerFromField → UseFameChecker(CB2_ReturnToField)). The `famechecker`
// macro's specials (SetFlavorTextFlagFromSpecialVars, UpdatePickStateFromSpecialVar8005: state/fameChecker.ts)
// fill gSaveBlock1Ptr->fameChecker, which the save keeps. `t.fameChecker()` is the screen's probe.

import { expect, test } from 'vitest';
import type { TestApi } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

type Probe = NonNullable<ReturnType<TestApi['fameChecker']>>;

/** The screen takes input: Task_TopMenuHandleInput, the fade in over, no info box animation. */
async function waitForTopMenu(game: Game, what: string): Promise<Probe> {
  return game.waitFor((t) => !t.paletteFadeActive() && t.gbaTasks().includes('Task_TopMenuHandleInput') && !t.gbaTasks().includes('Task_FCOpenOrCloseInfoBox') && t.fameChecker(), { what });
}

/** Press `button`, then wait for the screen's task to be `task` with the message box printed and the info box still. */
async function pressAndWait(game: Game, button: 'A' | 'B' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', task: 'Task_TopMenuHandleInput' | 'Task_FlavorTextDisplayHandleInput', what: string): Promise<Probe> {
  await game.press(button);
  await game.eval((t, task) => t.until(() => !t.gbaTasks().includes('Task_FCOpenOrCloseInfoBox') && t.fameChecker()?.task === task && !t.fameChecker()!.printing), task);
  return game.waitFor((t) => t.fameChecker(), { what });
}

/** The bag's list is taking input (registeredItems.test.ts). */
async function waitForBagList(game: Game, what: string) {
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun' && !t.paletteFadeActive() && t.gbaTasks().includes('Task_BagMenu_HandleInput') && !t.gbaTasks().includes('Task_AnimateWin0v'), { what });
}

/** START → BAG → KEY ITEMS → the Fame Checker → USE; resolves once the Fame Checker takes input. */
async function openFromBag(game: Game): Promise<Probe> {
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('BAG') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await waitForBagList(game, 'the bag');
  // The key items pocket, the cursor on the Fame Checker
  const index = await game.eval((t) => {
    const pocket = t.state!.bag.pockets[t.define('POCKET_KEY_ITEMS') - 1];
    return pocket.filter((s) => s.itemId).findIndex((s) => s.itemId === t.define('ITEM_FAME_CHECKER'));
  });
  expect(index).toBeGreaterThanOrEqual(0);
  await game.press('RIGHT');
  await waitForBagList(game, 'the key items pocket');
  await game.pressTimes('DOWN', index);
  await game.press('A');
  await game.waitFor((t) => t.gbaTasks().includes('Task_FieldItemContextMenuHandleInput'), { what: 'the context menu' });
  await game.press('A'); // USE
  return waitForTopMenu(game, 'the Fame Checker');
}

test('the rival gives the Fame Checker in Cerulean; from the bag, OAK and BILL with his first text, "?" for the rest; B back to the bag', async () => {
  // Below the rival's middle trigger (22-24, 6)
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity', x: 23, y: 7, party: [MEWTWO] });
  expect(await game.eval((t) => [t.flag('FLAG_GOT_FAME_CHECKER'), t.itemCount('FAME_CHECKER')])).toEqual([false, 0]);
  // New game (ResetFameChecker): only OAK, in colour
  expect(await game.eval((t) => t.state!.fameChecker.map((p) => p.pickState))).toEqual([2, ...new Array(15).fill(0)]);
  await game.eval((t) => t.walk('up', 1));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the rival beaten', timeout: 180_000 });
  await game.mashUntil((t) => t.flag('FLAG_GOT_FAME_CHECKER') && t.idle(), { what: 'the Fame Checker given', timeout: 180_000 });
  expect(await game.eval((t) => t.itemCount('FAME_CHECKER'))).toBe(1);
  // `famechecker FAMECHECKER_BILL, 0`: his first text, and he's drawn as a silhouette
  expect(await game.eval((t) => t.state!.fameChecker[t.define('FAMECHECKER_BILL')])).toMatchObject({ pickState: 1, flavorTextFlags: 1 });

  let fc = await openFromBag(game);
  expect(fc.list).toEqual(['OAK', 'BILL', 'CANCEL']);
  expect(fc.cursor).toBe(0);
  // OAK: no texts yet, six "?"
  expect(fc.icons.map((i) => i.kind)).toEqual(['?', '?', '?', '?', '?', '?']);

  // BILL: the rival (OBJ_EVENT_GFX_BLUE) told the first text; the rest "?"
  fc = await pressAndWait(game, 'DOWN', 'Task_TopMenuHandleInput', 'BILL');
  expect(fc.cursor).toBe(1);
  expect(fc.icons.map((i) => i.kind)).toEqual(['OBJ_EVENT_GFX_BLUE', '?', '?', '?', '?', '?']);
  // A: the selector on the first icon, its text printed, the others dimmed (OBJ blending)
  fc = await pressAndWait(game, 'A', 'Task_FlavorTextDisplayHandleInput', 'BILL\'s first text');
  expect(fc.selector).toBe(0);
  expect(fc.message).toContain('BILL');
  expect(fc.icons.map((i) => i.dimmed)).toEqual([false, false, false, false, false, false]); // the "?" aren't blended
  // RIGHT: onto a "?", no text
  fc = await pressAndWait(game, 'RIGHT', 'Task_FlavorTextDisplayHandleInput', 'the second icon');
  expect(fc.selector).toBe(1);
  expect(fc.message).toBe('');
  expect(fc.icons[0].dimmed).toBe(true);
  fc = await pressAndWait(game, 'B', 'Task_TopMenuHandleInput', 'back to the list');
  expect(fc.icons[0].dimmed).toBe(false);

  // START on BILL: his pic slides in with the spinning Poké Ball, as a silhouette; no name until he's in colour
  await game.press('START');
  fc = await game.waitFor((t) => t.fameChecker()?.inPickMode && t.fameChecker(), { what: 'pick mode' });
  expect(fc.pic).toMatchObject({ silhouette: true, x2: 0 });
  expect(fc.bg1X).toBe(240 << 8);
  expect(fc.message).toBe('');
  // UP onto OAK in pick mode: his pic in colour and his name
  fc = await pressAndWait(game, 'UP', 'Task_TopMenuHandleInput', 'OAK in pick mode');
  expect(fc.cursor).toBe(0);
  expect(fc.pic).toMatchObject({ silhouette: false });
  expect(fc.message).toBe('PROF. OAK');
  // B leaves pick mode (the pic slides out), B again closes the Fame Checker back to the bag
  await game.press('B');
  fc = await game.waitFor((t) => t.fameChecker()?.task === 'Task_TopMenuHandleInput' && !t.fameChecker()!.inPickMode && t.fameChecker(), { what: 'pick mode left' });
  expect(fc.bg1X).toBe(0);
  await game.press('B');
  await waitForBagList(game, 'back in the bag');
  expect(await game.eval((t) => t.fameChecker())).toBeUndefined();
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'back on the field' });
});

test('Brock after his gym: SELECT opens it from the field, his pic in colour, his texts; the flags survive a save; B back to the field', async () => {
  // Below Brock (6, 5); Liam at (3, 8) can't see (6, 6)
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Gym', x: 6, y: 6, party: [MEWTWO] });
  await game.eval((t) => t.face('up'));
  await game.waitIdle();
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'Brock beaten', timeout: 180_000 });
  await game.mashUntil((t) => t.flag('FLAG_BADGE01_GET') && t.itemCount('TM39') > 0 && t.idle(), { what: 'the TM and the field', timeout: 180_000 });
  // PewterCity_Gym_EventScript_Brock: `famechecker FAMECHECKER_BROCK, FCPICKSTATE_COLORED, UpdatePickStateFromSpecialVar8005`,
  // then after the battle `famechecker FAMECHECKER_BROCK, 1` (which doesn't take him back to a silhouette)
  expect(await game.eval((t) => t.state!.fameChecker[t.define('FAMECHECKER_BROCK')])).toMatchObject({ pickState: 2, flavorTextFlags: 0b10 });

  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_FAME_CHECKER'), 1);
    t.state!.registeredItem = t.define('ITEM_FAME_CHECKER');
  });
  await game.press('SELECT');
  let fc = await waitForTopMenu(game, 'the Fame Checker from the field');
  expect(fc.list).toEqual(['OAK', 'BROCK', 'CANCEL']);
  fc = await pressAndWait(game, 'DOWN', 'Task_TopMenuHandleInput', 'BROCK');
  expect(fc.icons.map((i) => i.kind)).toEqual(['?', 'OBJ_EVENT_GFX_BROCK', '?', '?', '?', '?']);
  // A: the selector starts on the first icon, a "?"; RIGHT onto Brock's own text
  fc = await pressAndWait(game, 'A', 'Task_FlavorTextDisplayHandleInput', 'the icons');
  expect([fc.selector, fc.message]).toEqual([0, '']);
  fc = await pressAndWait(game, 'RIGHT', 'Task_FlavorTextDisplayHandleInput', 'Brock\'s text');
  expect(fc.selector).toBe(1);
  expect(fc.message).not.toBe('');
  fc = await pressAndWait(game, 'B', 'Task_TopMenuHandleInput', 'back to the list');
  // START: his trainer pic in colour, his name
  await game.press('START');
  fc = await game.waitFor((t) => t.fameChecker()?.inPickMode && !t.fameChecker()!.printing && t.fameChecker(), { what: 'pick mode' });
  expect(fc.pic).toMatchObject({ silhouette: false, x2: 0 });
  expect(fc.message).toBe('BROCK');
  // SELECT doesn't close it in pick mode; B leaves pick mode, B closes it back to the field (not the bag)
  await game.press('B');
  await game.waitFor((t) => t.fameChecker()?.task === 'Task_TopMenuHandleInput' && !t.fameChecker()!.inPickMode, { what: 'pick mode left' });
  const r = await game.eval(async (t) => {
    let bag = false;
    const ok = t.until(() => {
      if (t.gbaScreen() === 'CB2_BagMenuRun') bag = true;
      const f = t.field();
      return !!f && t.gbaScreen() === undefined && t.idle() && !f.locked;
    });
    void t.press('B');
    return { ok: await ok, bag };
  });
  expect(r).toEqual({ ok: true, bag: false });

  // The save keeps gSaveBlock1Ptr->fameChecker
  const before = await game.eval((t) => t.state!.fameChecker);
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A'); // CONTINUE
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => t.state!.fameChecker)).toEqual(before);
  await game.press('SELECT');
  fc = await waitForTopMenu(game, 'the Fame Checker after CONTINUE');
  expect(fc.list).toEqual(['OAK', 'BROCK', 'CANCEL']);
  // SELECT closes it from the field (not in pick mode, not from the bag)
  await game.press('SELECT');
  await game.waitFor((t) => t.gbaScreen() === undefined && t.idle() && !t.field()!.locked, { what: 'back on the field' });
});
