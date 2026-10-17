// Registered key items used with SELECT on the field (item_menu.c's UseRegisteredKeyItemOnField from
// field_control_avatar.c's ProcessPlayerFieldInput): the item's field func runs as a task with data[3] = 1
// (menus/registeredItem.ts, the from-the-field branches in menus/itemUse.ts). `field().locked` is
// LockPlayerFieldControls, `field().objectsFrozen` FreezeObjectEvents.

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
/** Pallet Town's pond: the bank at (8, 16), the water one step south (as in fieldItems.test.ts). */
const PALLET_SHORE: StartOptions = { start: 'after-rival', map: 'PalletTown', x: 8, y: 16, party: [MEWTWO] };
/** Fishing6's roll: seed 3 gives no bite (fieldItems.test.ts). */
const NO_BITE_SEED = 3;
const FISHING6 = 5;

async function setUp(game: Game, items: string[], registered?: string) {
  await game.eval(
    (t, items, registered) => {
      t.state!.setVar('VAR_REPEL_STEP_COUNT', 200);
      for (const item of items) t.state!.bag.add(t.define(item), 1);
      t.state!.registeredItem = registered ? t.define(registered) : 0;
    },
    items,
    registered,
  );
  await game.waitIdle();
}

/** The bag's list is taking input: the bag task, no fade, no window animation. */
async function waitForBagList(game: Game, what: string) {
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun' && !t.gbaFading() && t.gbaTasks().includes('Task_BagMenu_HandleInput') && !t.gbaTasks().includes('Task_AnimateWin0v'), { what });
}

/** SELECT, then wait for the field to be free again: no script, overlay or message, the controls unlocked. */
async function waitFree(game: Game, what: string) {
  await game.waitFor((t) => t.idle() && !t.field()!.locked && !t.field()!.message, { what });
}

test('register the Bicycle in the bag, then SELECT gets on and off it', async () => {
  const game = await session.start(PALLET_SHORE);
  await setUp(game, ['ITEM_BICYCLE']);
  // START → BAG (no POKéDEX yet) → KEY ITEMS → BICYCLE → REGISTER
  await game.press('START');
  await game.waitFor((t) => !!t.startMenu(), { what: 'the start menu' });
  await game.press('DOWN');
  await game.press('A');
  await waitForBagList(game, 'the bag');
  await game.press('RIGHT');
  await waitForBagList(game, 'the key items pocket');
  await game.press('A');
  await game.waitFor((t) => t.gbaTasks().includes('Task_FieldItemContextMenuHandleInput'), { what: 'the context menu' });
  await game.press('DOWN'); // USE / REGISTER / CANCEL
  await game.press('A');
  await waitForBagList(game, 'back to the list');
  expect(await game.eval((t) => t.state!.registeredItem === t.define('ITEM_BICYCLE'))).toBe(true);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'back on the field' });

  // SELECT: on the bike at once, and the controls are free again
  await game.press('SELECT');
  await game.waitFor((t) => t.field()!.avatar.flags.includes('MACH_BIKE'), { what: 'on the bike' });
  await waitFree(game, 'the controls back');
  let f = await game.eval((t) => t.field()!);
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_BIKE');
  expect(f.objectsFrozen).toBe(false);
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(7);

  // SELECT again: off the bike
  await game.press('SELECT');
  await game.waitFor((t) => t.field()!.avatar.flags.includes('ON_FOOT'), { what: 'off the bike' });
  await waitFree(game, 'the controls back');
  f = await game.eval((t) => t.field()!);
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  await game.eval((t) => t.walk('right', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(8);
});

test('on Cycling Road, SELECT with the Bicycle says you can\'t dismount', async () => {
  const game = await session.start(PALLET_SHORE);
  await setUp(game, ['ITEM_BICYCLE'], 'ITEM_BICYCLE');
  await game.press('SELECT');
  await game.waitFor((t) => t.field()!.avatar.flags.includes('MACH_BIKE'), { what: 'on the bike' });
  await waitFree(game, 'the controls back');
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_ON_CYCLING_ROAD', true));
  await game.press('SELECT');
  await game.waitFor((t) => t.message()?.includes('dismount your BIKE'), { what: '"You can\'t dismount your BIKE here."' });
  const f = await game.eval((t) => t.field()!);
  expect(f.locked).toBe(true);
  expect(f.objectsFrozen).toBe(true);
  // {PAUSE_UNTIL_PRESS}, then Task_ItemUse_CloseMessageBoxAndReturnToField
  await game.mashUntil((t) => !t.field()!.message, { what: 'the message to close' });
  await waitFree(game, 'the controls back');
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('MACH_BIKE');
  expect(await game.eval((t) => t.field()!.objectsFrozen)).toBe(false);
});

test('SELECT with a registered rod casts it; not facing water, Oak says it isn\'t the time', async () => {
  const game = await session.start(PALLET_SHORE);
  await setUp(game, ['ITEM_OLD_ROD'], 'ITEM_OLD_ROD');

  // Facing away from the water: PrintNotTheTimeToUseThat on the field
  await game.eval((t) => t.face('up'));
  await game.waitIdle();
  let since = await game.mark();
  await game.press('SELECT');
  await game.waitFor((t) => t.message()?.includes('the time to use that'), { what: 'Oak\'s "This isn\'t the time to use that!"' });
  await game.mashUntil((t) => !t.field()!.message, { what: 'the message to close' });
  await waitFree(game, 'the controls back');
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fishing')).toBe(false);

  // Facing the water: the cast, no bite, the rod put away and the player free again
  await game.eval((t) => t.face('down'));
  await game.waitIdle();
  await game.eval(
    (t, seed, step) => {
      void t.seedWhen(() => t.field()?.fishing?.step === step, seed);
    },
    NO_BITE_SEED,
    FISHING6,
  );
  since = await game.mark();
  await game.press('SELECT');
  expect((await game.waitForEvent('fishing', { since })).rod).toBe(0); // OLD_ROD
  const cast = await game.waitFor((t) => t.field()?.fishing?.animNum !== undefined && t.field()!, { what: 'the cast' });
  expect(cast.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_FISH');
  expect((await game.waitForEvent('fishingResult', { since })).result).toBe('noBite');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fishingEnd'), { what: 'the message to close' });
  await waitFree(game, 'the controls back');
  const f = await game.eval((t) => t.field()!);
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(f.objectsFrozen).toBe(false);
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(7);
});

test('SELECT with the Coin Case shows the coins in the field message box', async () => {
  const game = await session.start(PALLET_SHORE);
  await setUp(game, ['ITEM_COIN_CASE'], 'ITEM_COIN_CASE');
  await game.eval((t) => (t.state!.coins = 123));
  await game.press('SELECT');
  await game.waitFor((t) => t.message()?.includes('COINS'), { what: '"Your COINS:"' });
  const f = await game.eval((t) => ({ ...t.field()!, text: t.message() }));
  expect(f.text).toContain('123');
  expect(f.locked).toBe(true);
  expect(f.objectsFrozen).toBe(true);
  expect(f.script).toBeUndefined();
  await game.mashUntil((t) => !t.field()!.message, { what: 'the message to close' });
  await waitFree(game, 'the controls back');
  expect(await game.eval((t) => t.field()!.objectsFrozen)).toBe(false);
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(7);
});

test('SELECT with nothing registered, or a registered item no longer in the bag: "An item in the BAG can be registered…"', async () => {
  const game = await session.start(PALLET_SHORE);
  await setUp(game, []);
  let since = await game.mark();
  await game.press('SELECT');
  await game.waitFor((t) => t.message()?.includes('registered to SELECT'), { what: 'EventScript_BagItemCanBeRegistered' });
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_BagItemCanBeRegistered');
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(7);

  // Registered, but gone from the bag: the registration is cleared (gSaveBlock1Ptr->registeredItem = ITEM_NONE)
  await game.eval((t) => (t.state!.registeredItem = t.define('ITEM_BICYCLE')));
  since = await game.mark();
  await game.press('SELECT');
  await game.waitFor((t) => t.message()?.includes('registered to SELECT'), { what: 'EventScript_BagItemCanBeRegistered' });
  expect(await game.eval((t) => t.state!.registeredItem)).toBe(0);
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('ON_FOOT');
});

/** SELECT with `item` registered: wait for its message (`shown`), close it, and check the field is free again. */
async function selectAndClose(game: Game, item: string, shown: (t: Parameters<Parameters<Game['waitFor']>[0]>[0]) => boolean | undefined, what: string) {
  await game.eval((t, item) => (t.state!.registeredItem = t.define(item)), item);
  await game.press('SELECT');
  await game.waitFor(shown, { what });
  await game.mashUntil((t) => !t.field()!.message && !t.field()!.locked, { what: `${item}: the message to close` });
  await waitFree(game, `${item}: the controls back`);
  expect(await game.eval((t) => t.field()!.objectsFrozen)).toBe(false);
}

test('SELECT with the VS Seeker, the Itemfinder and the Poké Flute: their field messages, then the controls back', async () => {
  // Pallet Town at (12, 13): no trainers, no hidden items in range (vsSeeker / itemfinder tests)
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 13, party: [MEWTWO] });
  await setUp(game, ['ITEM_VS_SEEKER', 'ITEM_ITEMFINDER', 'ITEM_POKE_FLUTE']);
  let since = await game.mark();
  await selectAndClose(game, 'ITEM_VS_SEEKER', (t) => t.message()?.includes('battery'), 'the VS Seeker\'s "No. of steps required to charge the battery"');
  expect((await game.waitForEvent('vsSeeker', { since })).result).toBe('notCharged');
  since = await game.mark();
  await selectAndClose(game, 'ITEM_ITEMFINDER', (t) => t.message()?.includes('no response'), '"Nope! There\'s no response."');
  expect((await game.waitForEvent('itemfinder', { since })).result).toBe('none');
  // Nobody asleep: "Played the POKé FLUTE.\pNow, that's a catchy tune!"
  await selectAndClose(game, 'ITEM_POKE_FLUTE', (t) => t.message()?.includes('Played the'), '"Played the POKé FLUTE."');
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(11);
});
