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
void MOVE_ITEMS;
