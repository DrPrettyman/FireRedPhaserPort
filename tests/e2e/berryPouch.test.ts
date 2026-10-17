// The berry pouch (berry_pouch.c): opened from the bag's KEY ITEMS (OPEN), an Oran Berry used on a hurt mon
// through the party menu and back to the pouch (CB2_ReturnToBerryPouchMenu), tossing berries, selling them at a
// Poké Mart (the bag's SELL → the berry pouch → how many → YES), and the battle bag's OPEN → USE → the party menu
// in battle (EnterPartyFromItemMenuInBattle).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival' as const, map: 'Route1', x: 11, y: 30 };

const BERRYPOUCH_FROMFIELD = 0;
const BERRYPOUCH_FROMMARTSELL = 2;
const BERRYPOUCH_FROMBATTLE = 4;

/** Put `items` (ITEM_* names) in the bag; adding the first berry also adds the berry pouch to KEY ITEMS. */
async function addItems(game: Game, items: [string, number][]) {
  await game.eval((t, list) => {
    for (const [name, n] of list) t.state!.bag.add(t.define(`ITEM_${name}`), n);
  }, items);
}

/** The bag is up and takes input (its list task). */
async function waitForBag(game: Game) {
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag' });
  await game.eval((t) => t.waitFrames(30)); // the bag's fade in
}

/** In the bag: KEY ITEMS, down to the berry pouch, A. */
async function selectBerryPouchInBag(game: Game) {
  await game.press('RIGHT'); // ITEMS → KEY ITEMS
  await game.eval((t) => t.waitFrames(20));
  const index = await game.eval((t) => t.state!.bag.pockets[t.define('POCKET_KEY_ITEMS') - 1].findIndex((s) => s.itemId === t.define('ITEM_BERRY_POUCH')));
  await game.pressTimes('DOWN', index);
  await game.press('A');
}

/** The berry pouch's list, taking input. */
async function waitForPouchList(game: Game, type: number) {
  const pouch = await game.waitFor(
    (t) => {
      const p = t.berryPouch();
      return p && p.task === 'Task_BerryPouchMain' && !p.fading ? p : undefined;
    },
    { what: 'the berry pouch list' },
  );
  expect(pouch.type).toBe(type);
  return pouch;
}

/** In the list: A on the current row, then wait for its USE / GIVE / TOSS / EXIT menu. */
async function openContextMenu(game: Game) {
  await game.press('A');
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_NormalContextMenu_HandleInput', { what: 'the context menu' });
}

test('from the bag: an Oran Berry heals a hurt mon and comes back to the pouch; tossing berries', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH'] }] });
  await addItems(game, [
    ['ORAN_BERRY', 3],
    ['CHERI_BERRY', 2],
  ]);
  await game.eval((t) => (t.state!.party[0].hp = 5));
  const [cheri, oran] = await game.eval((t) => [t.define('ITEM_CHERI_BERRY'), t.define('ITEM_ORAN_BERRY')]);

  // START → BAG → KEY ITEMS → BERRY POUCH → OPEN
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // POKéMON → BAG
  await game.press('A');
  await waitForBag(game);
  await selectBerryPouchInBag(game);
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // OPEN
  // Sorted by item id (SortAndCompactBagPocket): CHERI, then ORAN.
  expect(await waitForPouchList(game, BERRYPOUCH_FROMFIELD)).toMatchObject({ numItems: 2, items: [cheri, oran], row: 0, scroll: 0, allowSelect: 0 });
  await game.screenshot('berryPouch-list');

  // ORAN BERRY → USE → CHARMANDER: "...HP was restored by 10 point(s).", then back to the pouch.
  await game.press('DOWN');
  await openContextMenu(game);
  await game.screenshot('berryPouch-context');
  await game.press('A'); // USE
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(40));
  await game.mashUntil((t) => t.berryPouch() !== undefined, { what: 'the berry pouch after the berry' });
  expect(await game.eval((t) => t.state!.party[0].hp)).toBe(15);
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(2);
  // Back where it was (BERRYPOUCH_NA keeps the type, the list position and the exit callback).
  expect(await waitForPouchList(game, BERRYPOUCH_FROMFIELD)).toMatchObject({ row: 1, items: [cheri, oran] });

  // ORAN BERRY → GIVE → CHARMANDER holds it; back to the pouch (CB2_ChooseMonToGiveItem's CB2_ReturnToBerryPouchMenu).
  await openContextMenu(game);
  await game.press('DOWN'); // GIVE
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(40));
  await game.mashUntil((t) => t.berryPouch() !== undefined, { what: 'the berry pouch after GIVE' });
  expect(await game.eval((t) => t.state!.party[0].heldItem)).toBe(oran);
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(1);
  await waitForPouchList(game, BERRYPOUCH_FROMFIELD);

  // CHERI BERRY → TOSS → ×2 → "Throw away 2 of this item?" YES → "Threw away 2 CHERI BERRY(s)." → the list.
  await game.press('UP');
  await openContextMenu(game);
  await game.pressTimes('DOWN', 2); // USE, GIVE, TOSS
  await game.press('A');
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_Toss_SelectMultiple', { what: 'the toss quantity box' });
  await game.press('UP'); // ×002
  await game.eval((t) => t.waitFrames(5));
  await game.screenshot('berryPouch-toss');
  await game.press('A');
  await game.waitFor((t) => t.berryPouch()?.task !== 'Task_Toss_SelectMultiple', { what: 'YES / NO' });
  await game.mashUntil((t) => t.itemCount('CHERI_BERRY') === 0, { what: 'the toss' });
  expect(await waitForPouchList(game, BERRYPOUCH_FROMFIELD)).toMatchObject({ numItems: 1, items: [oran], row: 0 });
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(1);

  // CLOSE (B) → the bag → the field.
  await game.press('B');
  await waitForBag(game);
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test("a berry with no field use: OAK's \"This isn't the time to use that!\", then the list again", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH'] }] });
  await addItems(game, [['RAZZ_BERRY', 1]]);
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // POKéMON → BAG
  await game.press('A');
  await waitForBag(game);
  await selectBerryPouchInBag(game);
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // OPEN
  await waitForPouchList(game, BERRYPOUCH_FROMFIELD);
  await openContextMenu(game);
  await game.press('A'); // USE: FieldUseFunc_OakStopsYou
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_ContinueTaskAfterMessagePrints', { what: "OAK's message" });
  await game.mashUntil((t) => t.berryPouch()?.task === 'Task_BerryPouchMain', { what: 'the list again' });
  expect(await game.eval((t) => t.itemCount('RAZZ_BERRY'))).toBe(1);
});

test("the party menu's ITEM → GIVE → the bag → the berry pouch", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH'] }] });
  await addItems(game, [['ORAN_BERRY', 2]]);
  const oran = await game.eval((t) => t.define('ITEM_ORAN_BERRY'));

  // START → POKéMON → CHARMANDER → ITEM → GIVE
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(40));
  await game.press('A'); // CHARMANDER: SUMMARY / ITEM / CANCEL (no SWITCH with one mon)
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A'); // ITEM: GIVE / TAKE / CANCEL
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // GIVE
  await waitForBag(game);
  await selectBerryPouchInBag(game);
  await waitForPouchList(game, 1 /* BERRYPOUCH_FROMPARTYGIVE */);

  // ORAN BERRY → CB2_GiveHoldItem: "CHARMANDER was given the ORAN BERRY to hold." → the party menu.
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.waitFor((t) => t.state!.party[0].heldItem !== 0, { what: 'the berry given' });
  expect(await game.eval((t) => t.state!.party[0].heldItem)).toBe(oran);
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(1);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test("the PC's MOVE ITEMS → GIVE → the bag → the berry pouch", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2 });
  await addItems(game, [['ORAN_BERRY', 2]]);
  const oran = await game.eval((t) => {
    const s = t.state!;
    s.storage.setBoxMonAt(0, 0, s.pokemon.createMon(t.define('SPECIES_RATTATA'), 5, { otId: s.trainerId, otName: s.playerName, otGender: s.playerGender, metLocation: 'MAPSEC_ROUTE_1' }));
    return t.define('ITEM_ORAN_BERRY');
  });
  /** Wait (in the page) until the box screen runs `task` in state `st`. */
  const storageAt = async (game: Game, task: string, st: number) => {
    const ok = await game.eval(
      (t, tk, s) =>
        t.until(() => {
          const p = t.pcStorage();
          return p !== undefined && p.task === tk && p.state === s;
        }, 3600),
      task,
      st,
    );
    expect(ok, `the box screen's ${task}`).toBeTruthy();
  };

  // The PC → Someone's PC → MOVE ITEMS → RATTATA (box 1, first slot) → GIVE → the bag.
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /withdraw a POK/.test(t.message() ?? ''), { what: 'the storage menu' });
  await game.pressTimes('DOWN', 3); // MOVE ITEMS
  await game.press('A');
  await storageAt(game, 'Task_PokeStorageMain', 0);
  await game.press('A');
  await storageAt(game, 'Task_OnSelectedMon', 2);
  await game.press('A'); // GIVE
  await waitForBag(game);
  await selectBerryPouchInBag(game);
  await waitForPouchList(game, 3 /* BERRYPOUCH_FROMPOKEMONSTORAGEPC */);

  // ORAN BERRY → back to the box screen (CB2_ReturnToPokeStorage), RATTATA holding it.
  await game.press('A');
  await storageAt(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => t.state!.storage.getBoxedMon(0, 0)!.heldItem)).toBe(oran);
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(1);
});

test('selling berries at a Poké Mart through the berry pouch', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Mart', x: 4, y: 3 });
  await addItems(game, [['ORAN_BERRY', 5]]);
  const money = await game.eval((t) => t.money());
  const price = await game.eval((t) => t.state!.pokemon.items[t.define('ITEM_ORAN_BERRY')].price);

  // The clerk: "May I help you?" → SELL → the bag → KEY ITEMS → the berry pouch.
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.waitFor((t) => t.field()?.overlay, { what: 'BUY / SELL / SEE YA!' });
  await game.eval((t) => t.waitFrames(60));
  await game.press('DOWN');
  await game.press('A');
  await waitForBag(game);
  await selectBerryPouchInBag(game);
  await waitForPouchList(game, BERRYPOUCH_FROMMARTSELL);

  // ORAN BERRY: how many? ×3 → "I can pay ¥… Would that be okay?" → YES.
  await game.press('A');
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_Sell_SelectMultiple', { what: 'the quantity box' });
  await game.pressTimes('UP', 2); // ×03
  await game.eval((t) => t.waitFrames(5));
  await game.screenshot('berryPouch-sell');
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('ORAN_BERRY') < 5, { what: 'the sale', maxFrames: 1200 });
  expect(await game.eval((t) => t.itemCount('ORAN_BERRY'))).toBe(2);
  expect(await game.eval((t) => t.money())).toBe(money + Math.trunc(price / 2) * 3);

  // "Turned over…" → A → the list again, then out: the bag, the shop menu, the field.
  await game.mashUntil((t) => t.berryPouch()?.task === 'Task_BerryPouchMain', { what: 'the list after the sale' });
  await game.press('B');
  await waitForBag(game);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PewterCity_Mart', x: 4, y: 3 });
});

test('in battle: the bag\'s OPEN → the berry pouch → USE an Oran Berry on the battler', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await addItems(game, [['ORAN_BERRY', 2]]);
  await game.eval((t) => (t.state!.party[0].hp = 50));
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 2 }));

  await game.chooseAction('BAG');
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  await selectBerryPouchInBag(game);
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // OPEN (ITEMMENUACTION_OPEN_BERRIES)
  await waitForPouchList(game, BERRYPOUCH_FROMBATTLE);

  // ORAN BERRY → USE / TOSS / EXIT → USE → the party menu → MEWTWO.
  await openContextMenu(game);
  await game.press('A'); // USE
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(40));
  await game.mashUntil((t) => t.itemCount('ORAN_BERRY') === 1, { what: 'the berry used' });
  // The berry takes the turn: back in the battle (Magikarp's Splash), then the next action menu.
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction') ?? false, { what: 'the next turn' });
  expect(await game.eval((t) => t.state!.party[0].hp)).toBe(60);
});
