// Saving from the start menu (start_menu.c's save dialog) and continuing from the main menu (main_menu.c's
// CONTINUE → CB2_ContinueSavedGame), plus the play time counter and the boot flow without the title screen (the
// harness's ?skipIntro; titleScreen.test.ts boots through it): a save boots to the main menu, no save (or a dev
// start preset) boots straight into the field.

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
  await game.press(yes ? 'UP' : 'DOWN'); // the cursor doesn't wrap
  await game.press('A');
}

/** Wait until the main menu takes input (faded in). */
const mainMenuReady = (game: Game) => game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });

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
    // The avatar's state (CONTROLLABLE etc. aren't saved: SpawnObjectEventsOnReturnToField sets them anew)
    avatar: { state: t.field()!.avatar.flags.filter((f) => ['ON_FOOT', 'MACH_BIKE', 'ACRO_BIKE', 'SURFING'].includes(f)), graphicsId: t.field()!.avatar.graphicsId },
    party: t.party(),
    potions: t.itemCount('POTION'),
    money: t.money(),
    snapshot: t.snapshot(),
    playTime: { ...t.state!.playTime },
  }));

test('CONTINUE after a reload: same map, position, facing, bike, party, bag, flags and play time', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 30 });
  await game.waitIdle();
  await game.walk('up', 2);
  await game.eval((t) => t.setAvatarState('MACH_BIKE'));
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
  expect(await mainMenuReady(game)).toMatchObject({ menuType: 1, cursorPos: 0 });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  const after = await progress(game);
  expect(after.field).toEqual(before.field);
  expect(before.avatar.state).toEqual(['MACH_BIKE']);
  expect(after.avatar).toEqual(before.avatar);
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
});

test('CONTINUE with the continue-game warp set goes there instead, once', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 30 });
  await game.waitIdle();
  // What the Hall of Fame does (SetContinueGameWarpStatus + SetContinueGameWarpToHealLocation)
  await game.eval((t) => {
    t.state!.specialSaveWarpFlags |= t.define('CONTINUE_GAME_WARP');
    t.state!.continueGameWarp = { mapId: 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F', warpId: -1, x: 7, y: 4 };
  });
  await openSaveDialog(game);
  await answer(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();

  await game.load({ keepSave: true, mainMenu: true });
  await mainMenuReady(game);
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => ({ map: t.field()!.map, x: t.field()!.x, y: t.field()!.y }))).toEqual({ map: 'ViridianCity_PokemonCenter_1F', x: 7, y: 4 });
  expect(await game.eval((t) => t.state!.specialSaveWarpFlags & t.define('CONTINUE_GAME_WARP'))).toBe(0);
});

test('the play time counts every frame, in the field and on GBA screens, and the save stats show it', async () => {
  const game = await session.start(LAB);
  await game.waitIdle();
  const clock = () => game.eval((t) => ({ frame: t.frame(), time: { ...t.state!.playTime } }));
  const vblanks = (p: { hours: number; minutes: number; seconds: number; vblanks: number }) => ((p.hours * 60 + p.minutes) * 60 + p.seconds) * 60 + p.vblanks;
  const a = await clock();
  // Into the bag (FieldMenuScene, a GBA screen) and back
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('BAG') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await game.waitForBag();
  await game.eval((t) => t.waitFrames(60)); // a while in the bag, for the clock check below
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
  const b = await clock();
  expect(b.frame - a.frame).toBeGreaterThan(60);
  expect(vblanks(b.time) - vblanks(a.time)).toBe(b.frame - a.frame);

  // The save info window and the main menu show hours:minutes
  await game.eval((t) => Object.assign(t.state!.playTime, { hours: 12, minutes: 34, seconds: 0, vblanks: 0 }));
  await openSaveDialog(game);
  const stats = (await game.eval((t) => t.saveDialog()!.stats)).map((s) => s.trim());
  expect(stats).toContain('PALLET TOWN');
  expect(stats).toContain('PLAYER');
  expect(stats).toContain('12:34');
  await game.screenshot('save-info-window');
  await answer(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  await game.load({ keepSave: true, mainMenu: true });
  const mainMenu = await mainMenuReady(game);
  expect(mainMenu.stats.map((s) => s.trim())).toEqual(['PLAYER', '12:34', '0']);
  await game.screenshot('main-menu');
});

test('boot: no save goes to the new game, a dev preset skips the main menu, NEW GAME over a save warns before saving', async () => {
  const game = await session.start();
  expect((await game.events()).some((e) => e.type === 'mainMenu')).toBe(false);
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_PlayersHouse_2F');
  await openSaveDialog(game);
  await answer(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  const saved = await savedGame(game);

  // ?start= ignores the save
  await game.load({ start: 'after-rival', keepSave: true });
  expect((await game.events()).some((e) => e.type === 'mainMenu')).toBe(false);
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_ProfessorOaksLab');

  // B on the main menu goes to the title screen; START there brings the main menu back
  await game.load({ keepSave: true, mainMenu: true });
  await mainMenuReady(game);
  await game.press('B');
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen' });
  await game.press('START');
  expect(await mainMenuReady(game)).toMatchObject({ menuType: 1, cursorPos: 0 });

  // NEW GAME
  await game.press('DOWN');
  expect((await game.eval((t) => t.mainMenu()))!.cursorPos).toBe(1);
  const since = await game.mark();
  await game.press('A');
  await game.waitForEvent('ready', { since, timeout: 60_000 });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_PlayersHouse_2F');

  // Saving the new game: the other file's warning, NO by default
  await openSaveDialog(game);
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the first YES/NO menu' });
  await game.press('A');
  const warning = await game.mashUntil((t) => t.saveDialog()?.yesNo && t.message(), { button: 'B', what: 'the different file warning' });
  expect(warning).toMatch(/overwrite the other save file\?/);
  await game.press('A'); // NO
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  expect(await savedGame(game)).toEqual(saved);
  await game.press('B');
  await game.waitIdle();
});

test('a save that can no longer be read: "The save file has been deleted...", then the new game', async () => {
  const game = await session.start(LAB);
  await game.eval(() => localStorage.setItem('firered-phaser:save', '{"version":0}'));
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.gbaScreen() === 'CB2_MainMenu', { what: 'the main menu' });
  await game.eval((t) => t.waitFrames(150));
  await game.screenshot('save-file-deleted');
  expect(await game.eval((t) => t.mainMenu())).toBeUndefined(); // the message, not the menu
  await game.mashUntil((t) => t.events().some((e) => e.type === 'ready'), { what: 'the new game' });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_PlayersHouse_2F');
});
