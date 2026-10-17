// Main-path leftovers: Silph Co.'s card key doors (data/scripts/silphco_doors.inc), `setmaplayoutindex`
// (Seafoam Islands B3F/B4F's stopped currents), `special Field_AskSaveTheGame` (EventScript_AskSaveGame) and
// `seteventmon` (special CreateEnemyEventMon).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** The metatile id at a map-local cell, and whether its collision bits are set. */
function cell(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const tile = s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y);
    return { metatile: tile.metatile, impassable: tile.collision !== 0 };
  }, x, y);
}

/** The metatile behavior (MB_*) at a map-local cell. */
function behaviorAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const b = s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).behavior;
    return Object.entries(s.assets.behaviorIds as Record<string, number>).find(([, v]) => v === b)?.[0];
  }, x, y);
}

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
  await game.waitIdle();
}

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));
}

/** START → SAVE: resolves once the save info window is up. */
async function openSaveDialog(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
}

/** Wait for the save dialog's YES/NO menu and answer it. */
async function answerSave(game: Game, yes: boolean): Promise<void> {
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press(yes ? 'UP' : 'DOWN');
  await game.press('A');
}

const savedGame = (game: Game) => game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));

async function scriptDone(game: Game, what: string) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what });
}

/** Mark the floor's trainers beaten, so none of them walks up mid-test. */
async function beatTrainers(game: Game, trainers: string[]) {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`), true);
  }, trainers);
}

const SILPH_5F_TRAINERS = ['SCIENTIST_BEAU', 'TEAM_ROCKET_GRUNT_28', 'TEAM_ROCKET_GRUNT_29', 'JUGGLER_DALTON'];

test('Silph Co. 5F: a card key door blocks, needs the Card Key, opens and stays open', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_5F', x: 9, y: 9, party: [MEWTWO] });
  await beatTrainers(game, SILPH_5F_TRAINERS);
  const d = await game.eval((t) => ({
    midLeft: t.define('METATILE_SilphCo_VerticalBarrier_MidLeft'),
    midRight: t.define('METATILE_SilphCo_VerticalBarrier_MidRight'),
    shade: t.define('METATILE_SilphCo_Floor_ShadeFull'),
  }));
  // SilphCo_5F_OnLoad → EventScript_Close5FDoor1
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.midLeft, impassable: true });
  expect(await cell(game, 8, 9)).toEqual({ metatile: d.midRight, impassable: true });
  expect(await game.walk('left')).toMatchObject({ x: 9, y: 9 });

  // Without the key: EventScript_NeedCardKey
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => /needs a CARD KEY/i.test(t.message() ?? ''), { what: 'Text_ItNeedsCardKey' });
  await scriptDone(game, 'EventScript_NeedCardKey');
  expect(await game.eval((t) => t.flag('FLAG_SILPH_5F_DOOR_1'))).toBe(false);

  // With it (FLAG_HIDE_SILPH_CO_5F_CARD_KEY: the item ball is gone): EventScript_OpenDoor
  await game.eval((t) => t.state!.setFlag('FLAG_HIDE_SILPH_CO_5F_CARD_KEY', true));
  await game.press('A');
  await game.mashUntil((t) => /CARD KEY opened the door/i.test(t.message() ?? ''), { what: 'Text_CardKeyOpenedDoor' });
  await scriptDone(game, 'EventScript_OpenDoor');
  expect(await game.eval((t) => t.flag('FLAG_SILPH_5F_DOOR_1'))).toBe(true); // SetHiddenItemFlag
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.shade, impassable: false });
  expect(await cell(game, 8, 9)).toEqual({ metatile: d.shade, impassable: false });
  expect(await game.walk('left', 2)).toMatchObject({ x: 7, y: 9, arrived: true });

  // Talking to it again: EventScript_DoorUnlocked
  await game.eval((t) => t.walkTo(9, 9));
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => /door is open/i.test(t.message() ?? ''), { what: 'Text_TheDoorIsOpen' });
  await scriptDone(game, 'EventScript_DoorUnlocked');

  // The warp pad at (15, 7) to 3F's (4, 6) and back: ON_LOAD leaves the open door alone.
  let mark = await game.mark();
  await game.eval((t) => t.walkTo(15, 7));
  await game.waitForEvent('map', { since: mark, what: 'Silph Co. 3F' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('SilphCo_3F');
  await game.walk('down');
  mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark, what: 'Silph Co. 5F' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('SilphCo_5F');
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.shade, impassable: false });
  // Door 2 is still shut.
  expect(await cell(game, 7, 18)).toEqual({ metatile: d.midLeft, impassable: true });
});

test('Silph Co. 5F: picking up the Card Key sets FLAG_HIDE_SILPH_CO_5F_CARD_KEY', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_5F', x: 22, y: 20, party: [MEWTWO] });
  await beatTrainers(game, SILPH_5F_TRAINERS);
  await game.eval((t) => t.face('down'));
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_HIDE_SILPH_CO_5F_CARD_KEY') && t.idle() && !t.field()!.script, { what: 'the Card Key item ball' });
  expect(await game.eval((t) => t.itemCount('CARD_KEY'))).toBe(1);
});

test('Seafoam Islands B4F: with both boulders down the currents stop (setmaplayoutindex), also after CONTINUE', async () => {
  // A dev start never went through Route 20 (Route20_OnTransition hides the fallen boulders again), so both of
  // B4F's boulders count as down: SeafoamIslands_B4F_OnTransition sets FLAG_STOPPED_SEAFOAM_B4F_CURRENT and
  // switches to LAYOUT_SEAFOAM_ISLANDS_B4F_CURRENT_STOPPED.
  const game = await session.start({ start: 'after-rival', map: 'SeafoamIslands_B4F', x: 7, y: 6, party: [MEWTWO] });
  await repel(game);
  expect(await game.eval((t) => t.flag('FLAG_STOPPED_SEAFOAM_B4F_CURRENT'))).toBe(true);
  expect(await game.eval((t) => t.state!.mapLayoutId)).toBe(await game.eval((t) => t.define('LAYOUT_SEAFOAM_ISLANDS_B4F_CURRENT_STOPPED')));
  expect(await behaviorAt(game, 8, 6)).toBe('MB_OCEAN_WATER');
  expect(await behaviorAt(game, 17, 3)).toBe('MB_OCEAN_WATER');
  // Surfing right: one step, no current takes over.
  await game.eval((t) => t.setAvatarState('SURFING'));
  await game.eval((t) => t.face('right'));
  const rode = game.eval((t) => t.until(() => /^RIDE_WATER_CURRENT/.test(t.field()?.avatar.action ?? ''), 120));
  expect(await game.walk('right', 1)).toMatchObject({ x: 8, y: 6, arrived: true });
  expect(await rode).toBe(false);
  expect(await game.eval((t) => t.field()!.avatar.flags)).not.toContain('FORCED');

  // CONTINUE: InitMapFromSavedGame loads the saved layout (no ON_TRANSITION then).
  await openSaveDialog(game);
  await answerSave(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  expect((await savedGame(game)).location.mapLayoutId).toBe(await game.eval((t) => t.define('LAYOUT_SEAFOAM_ISLANDS_B4F_CURRENT_STOPPED')));
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A'); // CONTINUE
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'SeafoamIslands_B4F', x: 8, y: 6 });
  expect(await behaviorAt(game, 9, 6)).toBe('MB_OCEAN_WATER');
});

test('Seafoam Islands B4F: with the boulders not down yet the header layout keeps its currents', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SeafoamIslands_B3F', x: 12, y: 8, party: [MEWTWO] });
  await repel(game);
  // What Route20_OnTransition does while the currents run: B4F's boulders hidden (not fallen yet).
  await game.eval((t) => {
    t.state!.setFlag('FLAG_STOPPED_SEAFOAM_B4F_CURRENT', false);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_1', true);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_2', true);
  });
  await warp(game, 'MAP_SEAFOAM_ISLANDS_B4F', 7, 6);
  expect(await game.eval((t) => t.flag('FLAG_STOPPED_SEAFOAM_B4F_CURRENT'))).toBe(false);
  expect(await game.eval((t) => t.state!.mapLayoutId)).toBe(await game.eval((t) => t.define('LAYOUT_SEAFOAM_ISLANDS_B4F')));
  expect(await behaviorAt(game, 8, 6)).toBe('MB_EASTWARD_CURRENT');
  await game.eval((t) => t.setAvatarState('SURFING'));
  await game.eval((t) => t.face('right'));
  const pushed = game.eval((t) => t.until(() => t.field()?.avatar.action === 'RIDE_WATER_CURRENT_UP', 300));
  await game.walk('right', 1);
  expect(await pushed).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 17, y: 1 });

  // Both boulders down (FLAG_HIDE_* cleared, as falling through B3F's holes does), back in: the currents stop.
  await game.eval((t) => {
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_1', false);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_2', false);
  });
  await warp(game, 'MAP_SEAFOAM_ISLANDS_B4F', 7, 6);
  expect(await game.eval((t) => t.flag('FLAG_STOPPED_SEAFOAM_B4F_CURRENT'))).toBe(true);
  expect(await behaviorAt(game, 8, 6)).toBe('MB_OCEAN_WATER');
});

test('Seafoam Islands B3F: both boulders in place stop its currents too', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SeafoamIslands_B3F', x: 12, y: 8, party: [MEWTWO] });
  expect(await game.eval((t) => t.flag('FLAG_STOPPED_SEAFOAM_B3F_CURRENT'))).toBe(true);
  expect(await game.eval((t) => t.state!.mapLayoutId)).toBe(await game.eval((t) => t.define('LAYOUT_SEAFOAM_ISLANDS_B3F_CURRENT_STOPPED')));
  expect(await behaviorAt(game, 23, 9)).toBe('MB_OCEAN_WATER');
  await game.eval((t) => {
    t.state!.setFlag('FLAG_STOPPED_SEAFOAM_B3F_CURRENT', false);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B3F_BOULDER_1', true);
  });
  await warp(game, 'MAP_SEAFOAM_ISLANDS_B3F', 12, 8);
  expect(await game.eval((t) => t.flag('FLAG_STOPPED_SEAFOAM_B3F_CURRENT'))).toBe(false);
  expect(await behaviorAt(game, 23, 9)).toBe('MB_SOUTHWARD_CURRENT');
});

/**
 * Viridian Pokémon Center 2F's Direct Corner attendant (CableClub_EventScript_DirectCornerAttendant, no wireless
 * adapter) → COLOSSEUM → SINGLE BATTLE → CableClub_EventScript_TryEnterColosseum → EventScript_AskSaveGame.
 */
async function askToSaveAtCableClub(game: Game) {
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_POKEDEX_GET', true));
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.events().filter((e) => e.type === 'multichoice').length === 1, { what: 'the cable club menu' });
  await game.eval((t) => t.waitFrames(20)); // sDelay: 12 frames before the cable club menus take input
  await game.press('DOWN');
  await game.press('A'); // COLOSSEUM
  await game.mashUntil((t) => t.events().filter((e) => e.type === 'multichoice').length === 2, { what: 'the battle mode menu' });
  await game.press('A'); // SINGLE BATTLE
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  expect(await game.message()).toMatch(/Would you like to save the game\?/);
}

test('Field_AskSaveTheGame: NO at the cable club\'s save prompt gives VAR_RESULT FALSE and no save', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_2F', x: 10, y: 4 });
  await askToSaveAtCableClub(game);
  await answerSave(game, false);
  await game.waitFor((t) => /Please do visit again/.test(t.message() ?? ''), { what: 'CableClub_EventScript_AbortLink' });
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(0);
  await scriptDone(game, 'the script to end');
  expect(await savedGame(game)).toBeNull();
});

test('Field_AskSaveTheGame: YES saves (VAR_RESULT TRUE), then B cancels the linkup', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_2F', x: 10, y: 4 });
  await askToSaveAtCableClub(game);
  await answerSave(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  // task50_save_game: TRUE once SAVECB_RETURN_OKAY; the script goes on to TryBattleLinkup
  await game.waitFor((t) => /Please wait/.test(t.message() ?? ''), { what: 'CableClub_Text_PleaseWaitBCancel' });
  expect(await game.eval((t) => t.saveDialog())).toBeUndefined();
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(1); // (the linkup only writes it when it ends)
  const save = await savedGame(game);
  expect(save?.location).toMatchObject({ mapId: 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_2F', x: 10, y: 4, facing: 'up' });
  // Nobody on the other end: only B ends the linkup (Task_LinkupFailed), then CableClub_EventScript_AbortLink.
  await game.eval((t) => t.waitFrames(30));
  expect(await game.eval((t) => t.field()!.script)).toBeTruthy();
  await game.mashUntil((t) => /Please do visit again/.test(t.message() ?? ''), { button: 'B', what: 'CableClub_EventScript_AbortLink' });
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(await game.eval((t) => t.define('LINKUP_FAILED')));
  await scriptDone(game, 'the script to end');
});

test('seteventmon (CreateEnemyEventMon): Navel Rock\'s Lugia, caught with a Master Ball', async () => {
  const game = await session.start({ start: 'after-rival', map: 'NavelRock_Base', x: 10, y: 16, party: [{ species: 'ALAKAZAM', level: 80, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.face('up'));
  expect(await game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_LUGIA'))).toMatchObject({ x: 10, y: 15 });
  const since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the battle' });
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.battle()!.mons[1])).toMatchObject({ species: 'LUGIA', level: 70 });
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);
  await game.mashUntil((t) => /nickname/.test(t.battle()?.message ?? ''), { what: '"Give a nickname...?"' });
  // No nickname: mash B (a single B can land while the question is still printing, and A would then pick YES)
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { button: 'B', what: 'the battle to end' });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_CAUGHT');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && !t.field()!.fading, { what: 'the script to end' });
  // NavelRock_Base_OnResume removed it; the script set FLAG_FOUGHT_LUGIA.
  expect(await game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_LUGIA'))).toBeUndefined();
  expect(await game.eval((t) => t.flag('FLAG_FOUGHT_LUGIA'))).toBe(true);
  expect(await game.eval((t) => t.party().map((m) => [m.species, m.level]))).toEqual([['ALAKAZAM', 80], ['LUGIA', 70]]);
});
