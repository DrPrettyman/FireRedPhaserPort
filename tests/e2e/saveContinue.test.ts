// Saving from the start menu (start_menu.c's save dialog) and continuing from the main menu (main_menu.c's
// CONTINUE → CB2_ContinueSavedGame), plus the play time counter and the boot flow: a save boots to the main
// menu, no save (or a dev start preset) boots straight into the field.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** After the first rival battle, in Oak's lab. */
const LAB = { start: 'after-rival' } as const;

/** START, move the cursor to SAVE and select it; resolves once the save info window is up. */
async function openSaveDialog(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
}

/** Wait for the dialog's YES/NO menu (once its question has printed) and answer it. */
async function answer(game: Game, yes: boolean): Promise<void> {
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  if (!yes) await game.press('DOWN');
  await game.press('A');
}

/** The save slot's contents (parsed), straight from localStorage. */
const savedGame = (game: Game) => game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));

test('saving: YES saves, then the next save asks to overwrite; NO goes back to the start menu', async () => {
  const game = await session.start(LAB);
  await openSaveDialog(game);
  expect(await game.message()).toMatch(/Would you like to save the game\?/);
  await answer(game, true);
  // A new game with nothing saved: no overwrite question
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  expect(await game.eval((t) => t.saveDialog())).toBeUndefined();
  const first = await savedGame(game);
  expect(first?.location?.mapId).toBe('MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB');

  // NO at the first question: back to the start menu, with the cursor still on SAVE
  await openSaveDialog(game);
  await answer(game, false);
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu again' });
  expect(menu.items[menu.cursor]).toBe('SAVE');
  await game.press('B');
  await game.waitIdle();

  // The game is now this file's: YES asks to overwrite; NO there cancels too
  await game.walk('left');
  await openSaveDialog(game);
  await answer(game, true);
  await game.waitFor((t) => /already a saved file/.test(t.message() ?? ''), { what: 'the overwrite question' });
  await answer(game, false);
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu after NO' });
  expect((await savedGame(game)).location).toEqual(first.location);
  await game.press('B');

  await openSaveDialog(game);
  await answer(game, true);
  await game.waitFor((t) => /already a saved file/.test(t.message() ?? ''), { what: 'the overwrite question' });
  await answer(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  const second = await savedGame(game);
  expect(second.location.x).toBe(first.location.x - 1);
});

/** Where the field is and what the player has, to compare before saving and after continuing. */
const progress = (game: Game) =>
  game.eval((t) => ({
    field: { map: t.field()!.map, x: t.field()!.x, y: t.field()!.y, facing: t.field()!.facing },
    party: t.party(),
    potions: t.itemCount('POTION'),
    money: t.money(),
    snapshot: t.snapshot(),
    playTime: { ...t.state!.playTime },
  }));

test('CONTINUE after a reload: same map, position, facing, party, bag, flags and play time', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 30 });
  await game.waitIdle();
  await game.walk('up', 2);
  await game.eval((t) => t.face('left'));
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_POTION'), 3);
    t.state!.setFlag('FLAG_BADGE01_GET');
    t.state!.money = 1234;
  });
  await openSaveDialog(game);
  await game.screenshot('save-dialog');
  await answer(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  const before = await progress(game);

  await game.load({ keepSave: true, mainMenu: true });
  await game.screenshot('main-menu');
  expect(await game.eval((t) => t.mainMenu())).toMatchObject({ menuType: 1, cursorPos: 0 });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  const after = await progress(game);
  expect(after.field).toEqual(before.field);
  expect(after.party).toEqual(before.party);
  expect(after.potions).toBe(before.potions);
  expect(after.money).toBe(1234);
  expect(after.snapshot.flags).toContain('FLAG_BADGE01_GET');
  expect(after.snapshot.flags).toEqual(before.snapshot.flags);
  // The counter carries on from the saved time
  const secs = (p: { hours: number; minutes: number; seconds: number }) => p.hours * 3600 + p.minutes * 60 + p.seconds;
  const savedTime = (await savedGame(game)).playTime;
  expect(secs(savedTime)).toBeGreaterThan(0);
  expect(secs(after.playTime)).toBeGreaterThanOrEqual(secs(savedTime));
  await game.screenshot('continued');
});
