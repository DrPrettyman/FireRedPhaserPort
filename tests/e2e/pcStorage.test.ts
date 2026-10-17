// The Pokémon Storage System from a Pokémon Center PC: the PC's storage menu (WITHDRAW / DEPOSIT / MOVE
// POKéMON / MOVE ITEMS / SEE YA!) and the box screen: depositing, withdrawing, carrying a mon to another
// box, releasing, switching boxes, the summary of boxed mons, the box options and the held items.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import type { Button } from '../../src/input/Input';
import { useGame, type Game } from './harness';

const session = useGame();

const PARTY: MonSpec[] = [
  { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
  { species: 'RATTATA', level: 5 },
  { species: 'PIDGEY', level: 3 },
];

/** Viridian City's Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2, party: PARTY } as const;

// The storage menu's options (OPTION_*)
const WITHDRAW = 0;
const DEPOSIT = 1;
const MOVE_MONS = 2;
const MOVE_ITEMS = 3;

/** Put a fresh mon (the player as OT) into a box slot. */
const putInBox = (game: Game, box: number, pos: number, species: string, level = 5, item?: string) =>
  game.eval(
    (t, b, p, sp, lv, it) => {
      const s = t.state!;
      const mon = s.pokemon.createMon(t.define(`SPECIES_${sp}`), lv, { otId: s.trainerId, otName: s.playerName, otGender: s.playerGender, metLocation: 'MAPSEC_ROUTE_1' });
      if (it) mon.heldItem = t.define(`ITEM_${it}`);
      s.storage.setBoxMonAt(b, p, mon);
    },
    box,
    pos,
    species,
    level,
    item ?? '',
  );

/** A box slot's species name (SPECIES_*), or null. */
const boxSlot = (game: Game, box: number, pos: number) =>
  game.eval(
    (t, b, p) => {
      const m = t.state!.storage.getBoxedMon(b, p);
      return m ? t.nameOf('SPECIES_', m.species) : null;
    },
    box,
    pos,
  );

const partySpecies = (game: Game) => game.eval((t) => t.party().map((m) => m.species));

/** Turn on the PC, pick Someone's PC and stop at the storage menu (its WITHDRAW description shows). */
async function openStorageMenu(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /withdraw a POK/.test(t.message() ?? ''), { what: 'the storage menu' });
}

/** Pick option `index` of the storage menu and wait for the box screen to take input. */
async function enterBoxes(game: Game, index: number): Promise<void> {
  for (let i = 0; i < index; i++) await game.press('DOWN');
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
}

/** Wait (frame-exact, in the page) until the box screen runs `task` (in `state`); returns its probe. */
async function waitStorage(game: Game, task: string, state?: number) {
  const ok = await game.eval(
    (t, tk, st) =>
      t.until(() => {
        const p = t.pcStorage();
        return p && p.task === tk && (st === null || p.state === st);
      }, 3600),
    task,
    state ?? null,
  );
  const probe = await game.eval((t) => t.pcStorage());
  if (!ok || !probe) throw new Error(`the box screen never reached ${task}${state === undefined ? '' : ` state ${state}`}: ${JSON.stringify(probe)}`);
  return probe;
}

/** Tap a button in the box screen and wait until it takes input again (Task_PokeStorageMain, state 0). */
async function boxPress(game: Game, button: Button, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await game.press(button);
    await waitStorage(game, 'Task_PokeStorageMain', 0);
  }
}

/** A on the mon under the cursor: wait for its menu; returns the menu's items. */
async function openMonMenu(game: Game): Promise<string[]> {
  await game.press('A');
  const p = await waitStorage(game, 'Task_OnSelectedMon', 2);
  return p.menu.map((s) => s.trim());
}

/** Pick item `index` of the open action menu. */
async function chooseMenuItem(game: Game, index: number): Promise<void> {
  for (let i = 0; i < index; i++) await game.press('DOWN');
  await game.press('A');
}

/** B, then NO on "Continue BOX operations?": back to the field's storage menu. */
async function leaveBoxes(game: Game): Promise<void> {
  await game.press('B');
  await waitStorage(game, 'Task_OnBPressed', 2);
  await game.press('B');
  await game.waitFor((t) => !t.gbaScreen() && /POK|BOX|items/.test(t.message() ?? ''), { what: 'the storage menu again' });
}

/** Out of the storage menu and the PC (B twice), back to a free field. */
async function leavePc(game: Game): Promise<void> {
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the PC to turn off' });
}

test('the storage menu describes its options and can be left', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  expect(await game.message()).toMatch(/You can deposit your/);
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  expect(await game.message()).toMatch(/move POKéMON/i);
  await leavePc(game);
  expect(await partySpecies(game)).toEqual(['MEWTWO', 'RATTATA', 'PIDGEY']);
});

test('deposit a party mon in BOX 1', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await enterBoxes(game, DEPOSIT);
  // DEPOSIT starts in the party box, on its first slot
  expect((await game.eval((t) => t.pcStorage()!.cursor)).area).toBe(await game.eval((t) => t.define('CURSOR_AREA_IN_PARTY')));
  await boxPress(game, 'DOWN'); // RATTATA
  expect(await openMonMenu(game)).toEqual(['STORE', 'SUMMARY', 'MARK', 'RELEASE', 'CANCEL']);
  await chooseMenuItem(game, 0);
  const popup = await waitStorage(game, 'Task_DepositMenu', 1);
  expect(popup.message).toMatch(/Deposit in which BOX\?/);
  expect(popup.chooseBox).toBe(0);
  await game.screenshot('pc-deposit-popup');
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await boxSlot(game, 0, 0)).toBe('SPECIES_RATTATA');
  await leaveBoxes(game);
  // The menu comes back on DEPOSIT
  expect(await game.message()).toMatch(/You can deposit your/);
  await leavePc(game);
  expect(await partySpecies(game)).toEqual(['MEWTWO', 'PIDGEY']);
});

test("the last party mon can't be deposited", async () => {
  const game = await session.start({ ...PC, party: [PARTY[0]] });
  await openStorageMenu(game);
  await game.press('DOWN');
  await game.press('A');
  await game.eval((t) => t.waitFrames(4));
  expect(await game.message()).toMatch(/Can’t deposit the last POKéMON!/);
  await leavePc(game);
});

test('withdraw a mon from BOX 1', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'EEVEE', 7);
  await openStorageMenu(game);
  await enterBoxes(game, WITHDRAW);
  expect(await game.eval((t) => t.pcStorage()!.displaySpecies)).toBe(await game.eval((t) => t.define('SPECIES_EEVEE')));
  await game.screenshot('pc-withdraw-eevee');
  expect(await openMonMenu(game)).toEqual(['WITHDRAW', 'SUMMARY', 'MARK', 'RELEASE', 'CANCEL']);
  await chooseMenuItem(game, 0);
  // The mon is picked up, carried into the party box, placed, and the party box closes again
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await boxSlot(game, 0, 0)).toBe(null);
  await leaveBoxes(game);
  await leavePc(game);
  expect(await partySpecies(game)).toEqual(['MEWTWO', 'RATTATA', 'PIDGEY', 'EEVEE']);
  // BoxMonToMon: a withdrawn mon comes back fully healed with its stats
  expect(await game.eval((t) => t.party()[3].level)).toBe(7);
});

test('move a mon to another box and switch boxes', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'ODDISH');
  await putInBox(game, 1, 0, 'ZUBAT');
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  expect(await openMonMenu(game)).toEqual(['MOVE', 'SUMMARY', 'WITHDRAW', 'MARK', 'RELEASE', 'CANCEL']);
  await chooseMenuItem(game, 0); // MOVE: the hand picks Oddish up
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect((await game.eval((t) => t.pcStorage()!.cursor)).holding).toBe(true);
  expect(await boxSlot(game, 0, 0)).toBe(null);
  // Up to the box title, right to BOX2 (the wallpaper and icons scroll)
  await boxPress(game, 'UP');
  await game.press('RIGHT');
  await game.waitFor((t) => t.pcStorage()?.box === 1 && t.pcStorage()?.state === 0, { what: 'BOX2' });
  await game.screenshot('pc-box2-holding');
  // Down into the box (position 2) and place it there
  await boxPress(game, 'DOWN');
  expect((await game.eval((t) => t.pcStorage()!.cursor)).position).toBe(2);
  expect(await openMonMenu(game)).toEqual(['PLACE', 'SUMMARY', 'WITHDRAW', 'MARK', 'RELEASE', 'CANCEL']);
  await chooseMenuItem(game, 0);
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await boxSlot(game, 1, 2)).toBe('SPECIES_ODDISH');
  expect(await boxSlot(game, 1, 0)).toBe('SPECIES_ZUBAT');
  // Box scroll the other way: left from the title goes back to BOX1
  await boxPress(game, 'UP');
  await game.press('LEFT');
  await game.waitFor((t) => t.pcStorage()?.box === 0 && t.pcStorage()?.state === 0, { what: 'BOX1' });
  await leaveBoxes(game);
  await leavePc(game);
  // The box the screen closed on becomes the one caught mons go to
  expect(await game.eval((t) => [t.state!.storage.getCurrentBox(), t.var('VAR_PC_BOX_TO_SEND_MON')])).toEqual([0, 0]);
});

test('release a boxed mon', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'CATERPIE');
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await openMonMenu(game);
  await chooseMenuItem(game, 4); // RELEASE
  const ask = await waitStorage(game, 'Task_ReleaseMon', 1);
  expect(ask.message).toMatch(/Release this POKéMON\?/);
  await game.press('UP'); // YES (the cursor starts on NO)
  await game.press('A');
  const released = await waitStorage(game, 'Task_ReleaseMon', 4);
  expect(released.message).toMatch(/CATERPIE was released\./);
  await game.press('A');
  const byeBye = await waitStorage(game, 'Task_ReleaseMon', 5);
  expect(byeBye.message).toMatch(/Bye-bye, CATERPIE!/);
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await boxSlot(game, 0, 0)).toBe(null);
  await leaveBoxes(game);
  await leavePc(game);
});

test('the summary of a boxed mon, and the next one in the box', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'BULBASAUR', 12);
  await putInBox(game, 0, 3, 'SQUIRTLE', 9);
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await openMonMenu(game);
  await chooseMenuItem(game, 1); // SUMMARY
  await game.waitFor((t) => t.gbaScreen() === 'CB2_RunPokemonSummaryScreen', { what: 'the summary screen' });
  const summary = () =>
    game.eval(async () => {
      const m = await new Function('p', 'return import(p)')('/src/menus/summaryScreen.ts');
      return m.GetLastViewedMonIndex() as number;
    });
  expect(await summary()).toBe(0);
  await game.eval((t) => t.waitFrames(30));
  await game.screenshot('pc-summary-bulbasaur');
  await game.press('DOWN'); // SeekToNextMonInBox: skips the empty slots
  for (let i = 0; i < 100 && (await summary()) !== 3; i++) await game.eval((t) => t.waitFrames(2));
  expect(await summary()).toBe(3);
  await game.eval((t) => t.waitFrames(30));
  await game.press('B');
  // Back in the box, on the mon the summary ended on
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect((await game.eval((t) => t.pcStorage()!.cursor)).position).toBe(3);
  await leaveBoxes(game);
  await leavePc(game);
});

test('box options: jump to a box and change the wallpaper', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await boxPress(game, 'UP'); // the box title
  await game.press('A');
  const options = await waitStorage(game, 'Task_HandleBoxOptions', 2);
  expect(options.menu.map((s) => s.trim())).toEqual(['JUMP', 'WALLPAPER', 'NAME', 'CANCEL']);
  await chooseMenuItem(game, 0); // JUMP
  const jump = await waitStorage(game, 'Task_JumpBox', 1);
  expect(jump.message).toMatch(/Jump to which BOX\?/);
  await game.press('RIGHT');
  await game.press('RIGHT');
  await game.press('A');
  await game.waitFor((t) => t.pcStorage()?.task === 'Task_PokeStorageMain' && t.pcStorage()?.box === 2, { what: 'BOX3' });
  // WALLPAPER → SCENERY 2 → VOLCANO
  await game.press('A');
  await waitStorage(game, 'Task_HandleBoxOptions', 2);
  await chooseMenuItem(game, 1);
  await waitStorage(game, 'Task_HandleWallpapers', 2);
  await chooseMenuItem(game, 1);
  await waitStorage(game, 'Task_HandleWallpapers', 4);
  await chooseMenuItem(game, 1);
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => t.state!.storage.getBoxWallpaper(2))).toBe(await game.eval((t) => t.define('WALLPAPER_VOLCANO')));
  await game.screenshot('pc-volcano-wallpaper');
  await leaveBoxes(game);
  await leavePc(game);
});

test('mark a boxed mon', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'PIKACHU');
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await openMonMenu(game);
  await chooseMenuItem(game, 3); // MARK
  const mark = await waitStorage(game, 'Task_ShowMarkMenu', 1);
  expect(mark.message).toMatch(/Mark your POKéMON\./);
  await game.press('A'); // ● on
  await game.press('DOWN');
  await game.press('A'); // ■ on
  await game.pressTimes('DOWN', 3); // OK
  await game.screenshot('pc-mark-menu');
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => t.state!.storage.getBoxedMon(0, 0)!.markings)).toBe(0b0011);
  await leaveBoxes(game);
  await leavePc(game);
});

test('name a box', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await boxPress(game, 'UP'); // the box title
  await game.press('A');
  await waitStorage(game, 'Task_HandleBoxOptions', 2);
  await chooseMenuItem(game, 2); // NAME
  await game.waitFor((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.eval((t) => t.waitFrames(30)); // the screen fades in
  await game.pressTimes('B', 4); // "BOX1" → ""
  await game.pressTimes('A', 3); // the cursor starts on "A"
  await game.press('START'); // jump to OK
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => t.decode(t.state!.storage.getBoxName(0)!))).toBe('AAA');
  await game.screenshot('pc-box-renamed');
  await leaveBoxes(game);
  await leavePc(game);
});

test('move several mons at once (SELECT, then hold A)', async () => {
  const game = await session.start(PC);
  await putInBox(game, 0, 0, 'ODDISH');
  await putInBox(game, 0, 1, 'BELLSPROUT');
  await putInBox(game, 0, 6, 'PARAS');
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_MONS);
  await game.press('SELECT'); // the hand turns into the multiple-move hand
  await game.eval((t) => t.hold('A'));
  await game.eval((t) => t.waitFrames(2));
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  await boxPress(game, 'RIGHT');
  await boxPress(game, 'DOWN');
  await game.screenshot('pc-multimove-selecting');
  await game.eval((t) => t.release('A'));
  await game.eval((t) => t.waitFrames(2));
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  // The 2x2 selection is in the hand: move it down a row and put it down
  expect([await boxSlot(game, 0, 0), await boxSlot(game, 0, 1), await boxSlot(game, 0, 6)]).toEqual([null, null, null]);
  await boxPress(game, 'DOWN');
  await game.press('A');
  await game.eval((t) => t.waitFrames(2));
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect([await boxSlot(game, 0, 6), await boxSlot(game, 0, 7), await boxSlot(game, 0, 12), await boxSlot(game, 0, 13)]).toEqual([
    'SPECIES_ODDISH',
    'SPECIES_BELLSPROUT',
    'SPECIES_PARAS',
    null,
  ]);
  await leaveBoxes(game);
  await leavePc(game);
});

test('move items: put a held item in the bag, then give one from the bag', async () => {
  const game = await session.start(PC);
  await game.eval((t) => {
    for (const slot of t.state!.bag.pockets[0]) {
      slot.itemId = 0;
      slot.quantity = 0;
    }
  });
  await putInBox(game, 0, 0, 'SNORLAX', 30, 'LEFTOVERS');
  await openStorageMenu(game);
  await enterBoxes(game, MOVE_ITEMS);
  await game.eval((t) => t.waitFrames(20)); // the held item's icon appears
  expect(await openMonMenu(game)).toEqual(['TAKE', 'BAG', 'INFO', 'CANCEL']);
  await chooseMenuItem(game, 1); // BAG
  const placed = await waitStorage(game, 'Task_ItemToBag', 2);
  expect(placed.message).toMatch(/Placed item in the BAG\./);
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => [t.state!.storage.getBoxedMon(0, 0)!.heldItem, t.itemCount('LEFTOVERS')])).toEqual([0, 1]);
  // GIVE: the bag opens on its ITEMS pocket; pick the LEFTOVERS
  expect(await openMonMenu(game)).toEqual(['GIVE', 'CANCEL']);
  await chooseMenuItem(game, 0);
  await game.waitForBag();
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect(await game.eval((t) => [t.state!.storage.getBoxedMon(0, 0)!.heldItem === t.define('ITEM_LEFTOVERS'), t.itemCount('LEFTOVERS')])).toEqual([true, 0]);
  await game.screenshot('pc-move-items');
  await leaveBoxes(game);
  await leavePc(game);
});

test('the summary of a party mon from the party box, and release one', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await enterBoxes(game, DEPOSIT);
  await boxPress(game, 'DOWN'); // RATTATA
  await openMonMenu(game);
  await chooseMenuItem(game, 1); // SUMMARY
  await game.waitFor((t) => t.gbaScreen() === 'CB2_RunPokemonSummaryScreen', { what: 'the summary screen' });
  await game.eval((t) => t.waitFrames(30));
  await game.press('DOWN'); // the next party mon: PIDGEY
  await game.eval((t) => t.waitFrames(30));
  await game.press('B');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  expect((await game.eval((t) => t.pcStorage()!.cursor)).position).toBe(2);
  // RELEASE the PIDGEY: the party closes up behind it
  expect(await openMonMenu(game)).toEqual(['STORE', 'SUMMARY', 'MARK', 'RELEASE', 'CANCEL']);
  await chooseMenuItem(game, 3);
  await waitStorage(game, 'Task_ReleaseMon', 1);
  await game.press('UP');
  await game.press('A');
  await waitStorage(game, 'Task_ReleaseMon', 4);
  await game.press('A');
  await waitStorage(game, 'Task_ReleaseMon', 5);
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  await leaveBoxes(game);
  await leavePc(game);
  expect(await partySpecies(game)).toEqual(['MEWTWO', 'RATTATA']);
});

test("a mon that knows Surf can't be released while no other mon knows it", async () => {
  const game = await session.start({ ...PC, party: [PARTY[0], { species: 'LAPRAS', level: 30, moves: ['SURF'] }] });
  await openStorageMenu(game);
  await enterBoxes(game, DEPOSIT);
  await boxPress(game, 'DOWN'); // LAPRAS
  await openMonMenu(game);
  await chooseMenuItem(game, 3); // RELEASE
  await waitStorage(game, 'Task_ReleaseMon', 1);
  await game.press('UP');
  await game.press('A');
  // RunCanReleaseMon finds no other Surf user: "LAPRAS was released...", "....!", then it comes back
  await waitStorage(game, 'Task_ReleaseMon', 9);
  await game.press('A');
  await waitStorage(game, 'Task_ReleaseMon', 10);
  await game.press('A');
  const cameBack = await waitStorage(game, 'Task_ReleaseMon', 12);
  expect(cameBack.message).toMatch(/LAPRAS came back!/);
  await game.press('A');
  await waitStorage(game, 'Task_ReleaseMon', 13);
  await game.press('A');
  await waitStorage(game, 'Task_PokeStorageMain', 0);
  await leaveBoxes(game);
  await leavePc(game);
  expect(await partySpecies(game)).toEqual(['MEWTWO', 'LAPRAS']);
});

// ------------------------------------------------------------------ the player's PC (item storage)

/** PC items as [item id, quantity]. */
const pcItems = (game: Game) => game.eval((t) => t.state!.pcItems.filter((s) => s.itemId).map((s) => [s.itemId, s.quantity] as [number, number]));
const itemId = (game: Game, name: string) => game.eval((t, n) => t.define(`ITEM_${n}`), name);

/** Turn on the PC, pick PLAYER's PC and stop once its "What would you like to do?" shows. */
async function openPlayerPc(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which PC should be accessed\?/.test(t.message() ?? ''), { what: 'the PC menu' });
  await game.eval((t) => t.waitFrames(60)); // the message prints, then the PC menu opens
  await game.press('DOWN');
  await game.press('A');
  await game.mashUntil((t) => /What would you like to do\?/.test(t.message() ?? ''), { what: "the player's PC" });
}

/** From the top menu: ITEM STORAGE (A once the menu is up), then WITHDRAW ITEM into the item PC's list. */
async function openItemPcList(game: Game): Promise<void> {
  await game.mashUntil((t) => /Take out items from the PC\./.test(t.message() ?? ''), { what: 'the item storage menu' });
  await game.mashUntil((t) => t.itemPc()?.task === 'Task_ItemPcMain', { what: 'the item PC' });
  await game.eval((t) => t.waitFrames(40)); // the screen turns on
}

test("the player's PC: withdraw the new game's Potion, then deposit it again", async () => {
  const game = await session.start(PC);
  const potion = await itemId(game, 'POTION');
  expect(await pcItems(game)).toEqual([[potion, 1]]); // NewGameInitPCItems
  const potions = await game.eval((t) => t.itemCount('POTION'));
  await openPlayerPc(game);
  await openItemPcList(game);
  await game.screenshot('pc-item-pc');
  await game.press('A'); // POTION
  await game.waitFor((t) => t.itemPc()?.task === 'Task_ItemPcSubmenuRun', { what: 'the item menu' });
  await game.press('A'); // WITHDRAW: one of them, so no quantity to choose
  await game.waitFor((t) => t.itemPc()?.task === 'Task_ItemPcWaitButtonAndFinishWithdrawMultiple', { what: 'the withdraw message' });
  await game.press('A');
  await game.waitFor((t) => t.itemPc()?.task === 'Task_ItemPcMain' && t.itemPc()?.nItems === 0, { what: 'the emptied list' });
  await game.eval((t) => t.waitFrames(4));
  await game.press('B'); // CANCEL: the screen turns off, back to the item storage menu
  await game.waitFor((t) => !t.gbaScreen() && /Take out items/.test(t.message() ?? ''), { what: 'the item storage menu' });
  expect(await pcItems(game)).toEqual([]);
  expect(await game.eval((t) => t.itemCount('POTION'))).toBe(potions + 1);

  // DEPOSIT ITEM: the bag opens on its ITEMS pocket; the first item is the POTION
  await game.eval((t) => t.waitFrames(30)); // the field fades in
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  expect(await game.message()).toMatch(/Store items in the PC\./);
  await game.press('A');
  await game.waitForBag();
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  if (potions + 1 > 1) await game.press('A'); // how many: one
  await game.eval((t) => t.waitFrames(20));
  await game.press('A'); // "Deposited ..."
  await game.eval((t) => t.waitFrames(20));
  await game.press('B'); // close the bag
  await game.waitFor((t) => !t.gbaScreen() && /Store items in the PC/.test(t.message() ?? ''), { what: 'the item storage menu again' });
  expect(await pcItems(game)).toEqual([[potion, 1]]);
  expect(await game.eval((t) => t.itemCount('POTION'))).toBe(potions);
  await game.eval((t) => t.waitFrames(30));
  await game.mashUntil((t) => /What would you like to do\?/.test(t.message() ?? ''), { button: 'B', what: 'the top menu' });
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test("the player's PC: give a stored item to a party mon", async () => {
  const game = await session.start(PC);
  await game.eval((t) => {
    t.state!.pcItems[1].itemId = t.define('ITEM_LEFTOVERS');
    t.state!.pcItems[1].quantity = 1;
  });
  await openPlayerPc(game);
  await openItemPcList(game);
  await game.press('DOWN'); // LEFTOVERS
  await game.press('A');
  await game.waitFor((t) => t.itemPc()?.task === 'Task_ItemPcSubmenuRun', { what: 'the item menu' });
  await game.press('DOWN'); // GIVE
  await game.press('A');
  await game.waitForPartyMenu();
  await game.press('A'); // MEWTWO
  // "MEWTWO was given the LEFTOVERS to hold.", then back to the item PC's list
  await game.mashUntil((t) => t.itemPc()?.task === 'Task_ItemPcMain', { what: 'the item PC again' });
  expect(await game.eval((t) => t.state!.party[0].heldItem === t.define('ITEM_LEFTOVERS'))).toBe(true);
  expect(await pcItems(game)).toEqual([[await itemId(game, 'POTION'), 1]]);
});

test('the bedroom PC turns off through its shut-down script', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 1, y: 2, party: PARTY });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /What would you like to do\?/.test(t.message() ?? ''), { what: 'the bedroom PC' });
  await game.eval((t) => t.waitFrames(120)); // the message prints (2 frames a letter), then the menu opens
  const since = await game.mark();
  await game.press('B'); // TURN OFF
  const e = await game.waitForEvent('script', { since });
  expect(e.label).toBe('EventScript_PalletTown_PlayersHouse_2F_ShutDownPC');
  await game.waitIdle();
});
