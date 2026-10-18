// overworld.c's map music in the game (gba/overworldMusic.ts on sound.c's state machine): a warp into a map with
// other music waits for the BGM's fade-out (TryFadeOutOldMapMusic + Task_Teleport2Warp's BGMusicStopped: 16 × 2
// frames indoors, 16 × 4 outdoors) before the map loads, and the new map's music starts with the arrival
// (FieldCB_DefaultWarpExit's Overworld_PlaySpecialMapMusic); the same music doesn't fade; a connection fades at speed
// 8 into the next map's music; the bike's MUS_CYCLING is saved (savedMusic) and CONTINUE plays it; Surf fades to
// MUS_SURF and getting off back to the map's. The engine runs headless with the output off, so this times like the GBA
// without anything being heard. Frames are logic ticks (`t.frame()`).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** The tick in which the field first shows `map`, read in the page tick by tick (start it before the warp). */
function watchMap(game: Game, map: string) {
  return game.eval(async (t, map) => {
    let frame = -1;
    await t.until(() => t.field()?.map === map && (frame = t.frame()) >= 0, 20000);
    return { frame };
  }, map);
}

/** The BGM player's state once it plays `song` (in the page, tick by tick; fails after 20000 ticks). */
async function waitForBgm(game: Game, song: string) {
  const bgm = await game.eval(
    async (t, song) => {
      const playing = () => t.audio().players.BGM.song === song && t.audio().players.BGM.playing;
      return (await t.until(playing, 20000)) ? t.audio().players.BGM : undefined;
    },
    song,
  );
  if (!bgm) throw new Error(`${song} never played`);
  return bgm;
}

test('a warp into a map with other music waits for the fade (32 frames indoors, 64 outdoors); the new music starts on arrival', async () => {
  // Pallet Town → Oak's lab through its door (Task_DoorWarp: the door's SE, then the fade at speed 2)
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 16, y: 14 });
  await game.waitIdle();
  expect(await waitForBgm(game, 'MUS_PALLET')).toMatchObject({ volume: 64 });
  let mark = await game.mark();
  let arrived = watchMap(game, 'PalletTown_ProfessorOaksLab');
  await game.walk('up');
  let map = await arrived;
  await waitForBgm(game, 'MUS_OAK_LAB');
  await game.waitIdle();
  let events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.find((e) => e.type === 'se')).toMatchObject({ name: 'SE_DOOR', player: 'SE1' }); // DOOR_SOUND_NORMAL
  let fade = events.find((e) => e.type === 'fade')!;
  expect(fade).toMatchObject({ fade: 'out', speed: 2, name: 'MUS_PALLET', player: 'BGM' });
  // BGMusicStopped holds 16 × 2 + 1 frames after the fade started (sound.test.ts); the map loads after that
  expect(map.frame - fade.frame).toBeGreaterThanOrEqual(33);
  let bgm = events.find((e) => e.type === 'bgm' && e.name === 'MUS_OAK_LAB')!;
  expect(bgm.frame).toBeGreaterThanOrEqual(map.frame);
  expect(events.filter((e) => e.type === 'se').map((e) => e.name)).not.toContain('SE_EXIT');

  // Oak's lab → Pallet Town by the exit mat (DoWarp: SE_EXIT, the fade at speed 4 into an outdoor map)
  expect(await game.eval((t) => ({ x: t.field()!.x, y: t.field()!.y }))).toEqual({ x: 6, y: 12 }); // on the mat (warp 0)
  mark = await game.mark();
  arrived = watchMap(game, 'PalletTown');
  await game.eval((t) => t.enterWarp());
  map = await arrived;
  await waitForBgm(game, 'MUS_PALLET');
  events = await game.eval((t, s) => t.audioEvents(s), mark);
  const exit = events.find((e) => e.type === 'se')!;
  expect(exit).toMatchObject({ name: 'SE_EXIT', started: true });
  fade = events.find((e) => e.type === 'fade')!;
  expect(fade).toMatchObject({ fade: 'out', speed: 4, name: 'MUS_OAK_LAB' });
  expect(fade.frame).toBe(exit.frame);
  expect(map.frame - fade.frame).toBeGreaterThanOrEqual(65);
  bgm = events.find((e) => e.type === 'bgm' && e.name === 'MUS_PALLET')!;
  expect(bgm.frame).toBeGreaterThanOrEqual(map.frame);
});

test('a warp between maps with the same music neither fades nor restarts it', async () => {
  // Pallet Town → the player's house: both MUS_PALLET
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 6, y: 8 });
  await game.waitIdle();
  await waitForBgm(game, 'MUS_PALLET');
  const mark = await game.mark();
  const arrived = watchMap(game, 'PalletTown_PlayersHouse_1F');
  await game.walk('up');
  await arrived;
  await game.waitIdle();
  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.filter((e) => e.player === 'BGM')).toEqual([]);
  expect(await game.eval((t) => t.audio().players.BGM)).toMatchObject({ song: 'MUS_PALLET', playing: true, volume: 64 });
});

test("a connection fades the old music at speed 8, then the next map's starts", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 2 });
  await game.waitIdle();
  await waitForBgm(game, 'MUS_PALLET');
  const mark = await game.mark();
  const arrived = watchMap(game, 'Route1');
  await game.walk('up', 3);
  const map = await arrived;
  await waitForBgm(game, 'MUS_ROUTE1');
  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  const fade = events.find((e) => e.type === 'fade')!;
  expect(fade).toMatchObject({ fade: 'out', speed: 8, name: 'MUS_PALLET' });
  // Overworld_TryMapConnectionMusicTransition runs as the step lands on Route 1, before its header is loaded
  expect(fade.frame).toBeLessThanOrEqual(map.frame);
  // FadeOutAndPlayNewMapMusic: MapMusicMain's state 6 plays it once the fade (16 × 8 frames) has stopped the BGM
  const bgm = events.find((e) => e.type === 'bgm')!;
  expect(bgm).toMatchObject({ name: 'MUS_ROUTE1', started: true });
  expect(bgm.frame - fade.frame).toBe(16 * 8);
});

/** START → SAVE → YES (and YES to overwrite if asked), until the saved message is done. */
async function saveGame(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
}

test('on the bike MUS_CYCLING plays and is saved; CONTINUE plays it again; off the bike the map\'s music', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 30 });
  await game.eval((t) => {
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 200);
    t.state!.bag.add(t.define('ITEM_BICYCLE'), 1);
    t.state!.registeredItem = t.define('ITEM_BICYCLE');
  });
  await game.waitIdle();
  await waitForBgm(game, 'MUS_ROUTE1');
  let mark = await game.mark();
  await game.press('SELECT'); // GetOnOffBike: Overworld_SetSavedMusic + Overworld_ChangeMusicTo(MUS_CYCLING)
  await game.waitFor((t) => t.field()!.avatar.flags.includes('MACH_BIKE'), { what: 'on the bike' });
  await waitForBgm(game, 'MUS_CYCLING');
  let events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.find((e) => e.type === 'fade')).toMatchObject({ fade: 'out', speed: 8, name: 'MUS_ROUTE1' });
  expect(await game.eval((t) => t.state!.savedMusic === t.define('MUS_CYCLING'))).toBe(true);

  await saveGame(game);
  const saved = await game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));
  expect(saved.savedMusic).toBe(await game.eval((t) => t.define('MUS_CYCLING')));

  // CONTINUE: CB2_ContinueSavedGame's StopMapMusic, then FieldCB_WarpExitFadeFromBlack plays savedMusic
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  expect(await waitForBgm(game, 'MUS_CYCLING')).toMatchObject({ volume: 64 });
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('MACH_BIKE');

  // Off the bike: Overworld_ClearSavedMusic + Overworld_PlaySpecialMapMusic (no fade: PlayNewMapMusic)
  await game.eval((t) => (t.state!.registeredItem = t.define('ITEM_BICYCLE')));
  mark = await game.mark();
  await game.press('SELECT');
  await game.waitFor((t) => t.field()!.avatar.flags.includes('ON_FOOT'), { what: 'off the bike' });
  await waitForBgm(game, 'MUS_ROUTE1');
  events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.filter((e) => e.type === 'fade')).toEqual([]);
  expect(await game.eval((t) => t.state!.savedMusic)).toBe(0);
});

test('Surf fades to MUS_SURF; getting off fades back to the map\'s music', async () => {
  // Pallet Town's pond: (8, 16) is the shore above it (surf.test.ts)
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 8, y: 16, party: [{ species: 'LAPRAS', level: 40, moves: ['SURF'] }] });
  await game.eval((t) => {
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 200);
    t.state!.setFlag('FLAG_BADGE05_GET', true);
  });
  await game.eval((t) => t.face('down'));
  await game.waitIdle();
  await waitForBgm(game, 'MUS_PALLET');
  let mark = await game.mark();
  await game.press('A');
  await game.waitFor((t) => t.message()?.includes('SURF'), { what: '"Would you like to SURF?"' });
  // YES, then FldEff_UseSurf: Overworld_ClearSavedMusic, Overworld_ChangeMusicTo(MUS_SURF)
  await game.mashUntil((t) => t.field()!.avatar.flags.includes('SURFING') && t.idle(), { what: 'surfing' });
  await waitForBgm(game, 'MUS_SURF');
  let events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.find((e) => e.type === 'fade')).toMatchObject({ fade: 'out', speed: 8, name: 'MUS_PALLET' });

  // Back onto the shore: CreateStopSurfingTask's Overworld_ChangeMusicToDefault
  mark = await game.mark();
  await game.walk('up');
  await game.waitFor((t) => t.field()!.avatar.flags.includes('ON_FOOT') && t.idle(), { what: 'off the water' });
  await waitForBgm(game, 'MUS_PALLET');
  events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.find((e) => e.type === 'fade')).toMatchObject({ fade: 'out', speed: 8, name: 'MUS_SURF' });
});
