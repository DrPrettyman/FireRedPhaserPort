// The TM case (tm_case.c): opened from the bag's KEY ITEMS (OPEN), teaching HM01 through the party menu
// (and a mon that can't learn it), back to the TM case after teaching, GIVE from its own menu, and selling a TM
// at a Poké Mart (the bag's SELL → the TM case → how many → YES).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival' as const, map: 'Route1', x: 11, y: 30 };

/** Put `items` (ITEM_* names) in the bag; adding the first TM also adds the TM case to KEY ITEMS. */
async function addItems(game: Game, items: [string, number][]) {
  await game.eval((t, list) => {
    for (const [name, n] of list) t.state!.bag.add(t.define(`ITEM_${name}`), n);
  }, items);
}

/** In the bag: KEY ITEMS, down to the TM case, A. */
async function selectTmCaseInBag(game: Game) {
  await game.press('RIGHT'); // ITEMS → KEY ITEMS
  await game.eval((t) => t.waitFrames(20));
  const index = await game.eval((t) => t.state!.bag.pockets[t.define('POCKET_KEY_ITEMS') - 1].findIndex((s) => s.itemId === t.define('ITEM_TM_CASE')));
  await game.pressTimes('DOWN', index);
  await game.press('A');
}

/** The TM case's list, taking input (`menuType` TMCASE_*). */
async function waitForTmCaseList(game: Game, menuType?: number) {
  return game.waitFor(
    (t) => {
      const c = t.tmCase();
      return c && c.task === 'Task_HandleListInput' && !c.fading ? c : undefined;
    },
    { what: 'the TM case list' },
  ).then((c) => {
    if (menuType !== undefined) expect(c.menuType).toBe(menuType);
    return c;
  });
}

/** START → BAG → KEY ITEMS → TM CASE → OPEN. */
async function openTmCaseFromField(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // POKéMON → BAG
  await game.press('A');
  await game.waitForBag();
  await selectTmCaseInBag(game);
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // OPEN
  return waitForTmCaseList(game, 0 /* TMCASE_FIELD */);
}

/** In the list: the row `row`, A, then USE (the context menu's first entry). */
async function useRow(game: Game, row: number) {
  await game.pressTimes('DOWN', row);
  await game.press('A');
  await game.waitFor((t) => t.tmCase()?.task === 'Task_ContextMenu_HandleInput', { what: 'the USE / GIVE / EXIT menu' });
  await game.press('A'); // USE
  await game.waitForPartyMenu();
}

test('HM01 from the TM case teaches CUT, a mon that cannot learn it says so, and both come back to the TM case', async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL'] },
      { species: 'PIDGEY', level: 10, moves: ['TACKLE'] },
    ],
  });
  await addItems(game, [
    ['TM28', 2],
    ['HM01', 1],
  ]);

  const tmCase = await openTmCaseFromField(game);
  // HMs first (SortPocketAndPlaceHMsFirst), then the TMs.
  const [hm01, tm28] = await game.eval((t) => [t.define('ITEM_HM01'), t.define('ITEM_TM28')]);
  expect(tmCase).toMatchObject({ numTMs: 2, items: [hm01, tm28], row: 0, scroll: 0, selectClose: false });

  // HM01 → USE → CHARMANDER (the first slot): "CHARMANDER learned CUT!", then back to the TM case.
  await useRow(game, 0);
  await game.mashUntil((t) => t.tmCase() !== undefined, { what: 'the TM case after teaching' });
  expect((await game.eval((t) => t.party()))[0].moves).toEqual(['SCRATCH', 'GROWL', 'CUT']);
  // Back where it was (TMCASE_REOPENING keeps the type, the list position and the exit callback); HMs stay.
  expect(await waitForTmCaseList(game, 0)).toMatchObject({ row: 0, items: [hm01, tm28] });

  // HM01 → USE → PIDGEY: "PIDGEY can't learn CUT." and back to the TM case.
  await useRow(game, 0);
  await game.press('DOWN'); // the second slot
  await game.eval((t) => t.waitFrames(10));
  await game.mashUntil((t) => t.tmCase() !== undefined, { what: 'the TM case after "can\'t learn"' });
  expect((await game.eval((t) => t.party()))[1].moves).toEqual(['TACKLE']);
  await waitForTmCaseList(game, 0);

  // TM28 → GIVE → CHARMANDER holds it; back to the TM case with one TM28 left.
  await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => t.tmCase()?.task === 'Task_ContextMenu_HandleInput', { what: 'the USE / GIVE / EXIT menu' });
  await game.press('DOWN'); // GIVE
  await game.press('A');
  await game.waitForPartyMenu();
  await game.mashUntil((t) => t.tmCase() !== undefined, { what: 'the TM case after GIVE' });
  expect(await game.eval((t) => t.state!.party[0].heldItem)).toBe(tm28);
  expect(await game.eval((t) => t.itemCount('TM28'))).toBe(1);
  await waitForTmCaseList(game, 0);

  // CLOSE (B) → the bag → the field.
  await game.press('B');
  await game.waitForBag();
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test('selling TMs at a Poké Mart through the TM case (and an HM it won\'t buy)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Mart', x: 4, y: 3 });
  await addItems(game, [
    ['TM28', 3],
    ['HM01', 1],
  ]);
  const money = await game.eval((t) => t.money());
  const price = await game.eval((t) => t.state!.pokemon.items[t.define('ITEM_TM28')].price);

  // The clerk: "May I help you?" → SELL → the bag.
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.waitFor((t) => t.field()?.overlay, { what: 'BUY / SELL / SEE YA!' });
  await game.eval((t) => t.waitFrames(60));
  await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
  await selectTmCaseInBag(game);
  await waitForTmCaseList(game, 2 /* TMCASE_SELL */);

  // HM01 (row 0): "Oh no, I can't buy that."
  await game.press('A');
  await game.mashUntil((t) => t.tmCase()?.task === 'Task_HandleListInput', { what: 'back to the list' });
  expect(await game.eval((t) => t.itemCount('HM01'))).toBe(1);
  expect(await game.eval((t) => t.money())).toBe(money);

  // TM28 (row 1): how many? ×2 → "I can pay ¥… Would that be okay?" → YES.
  await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => t.tmCase()?.task === 'Task_QuantitySelect_HandleInput', { what: 'the quantity box' });
  await game.press('UP'); // ×02
  await game.eval((t) => t.waitFrames(5));
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('TM28') < 3, { what: 'the sale', maxFrames: 1200 });
  expect(await game.eval((t) => t.itemCount('TM28'))).toBe(1);
  expect(await game.eval((t) => t.money())).toBe(money + Math.trunc(price / 2) * 2);

  // "Turned over…" → A → the list again, then out: the bag, the shop menu, the field.
  await game.mashUntil((t) => t.tmCase()?.task === 'Task_HandleListInput', { what: 'the list after the sale' });
  await game.press('B');
  await game.waitForBag();
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PewterCity_Mart', x: 4, y: 3 });
});
