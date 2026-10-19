// Four Island and Icefall Cave, played (POSTGAME_PLAN.md W-sevii unit 2): the ferry from Three Island with the
// Rainbow Pass, the rival's scene on arrival, the sticker man's brag (StickerManGetBragFlags), Icefall Cave 1F's ice
// (setstepcallback STEP_CB_ICE: field_tasks.c's IcefallCaveIcePerStepCallback cracks the thin ice on the first step
// and breaks it on the second; FallDownHole's `warphole` drops the player to B1F; a CONTINUE keeps the cracked ice
// through SetIcefallCaveCrackedIceMetatiles), the back room's Lorelei / Rockets / Lapras scene, and Lorelei's house
// (UpdateLoreleiDollCollection). Warps skip the walking between scenes, as postgame.test.ts does.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { checkRide, sail, talkToHarborSailor } from './seagallopHelpers';
import { afterHallOfFame, battlesSince, MEWTWO, rainbowPassState, SCENE, scriptsSince, talk, warp } from './postgameHelpers';

const session = useGame();

/** The metatile id at a map-local cell of the current map. */
function metatileAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    return s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).metatile as number;
  }, x, y);
}

/** Once the script the last press started is running, press A until the field is free again; the messages seen. */
function mashScript(game: Game) {
  return game.eval(async (t) => {
    await t.until(() => !!t.field()?.script || !t.idle(), 600);
    const r = await (t as any).mash((u: any) => u.idle() && !u.field()!.script, 'A', 60000, []);
    return (r.messages as string[]).map((m) => m.replace(/\s+/g, ' '));
  });
}

/** The SEs played since `since` (the audio events). */
function sesSince(game: Game, since: number) {
  return game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name as string), since);
}

/** world/fieldTasks.ts's step callback task (Task_RunPerStepCallback): its callback id and state. */
function stepCallback(game: Game) {
  return game.eval(async () => {
    const m = await new Function("return import('/src/world/fieldTasks.ts')")();
    return m.perStepCallbackProbe() as { callbackId: number; state: number };
  });
}

/** START → SAVE → YES, then reload the page and CONTINUE (CB2_ContinueSavedGame: InitMapFromSavedGame's ON_LOAD). */
async function saveAndContinue(game: Game) {
  await game.waitIdle();
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
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  // CONTINUE plays the quest log's scenes first. One of them replays the rival's ON_FRAME scene on Four Island (the
  // scene's VAR_MAP_SCENE_FOUR_ISLAND is 0 again), whose msgbox waits for A in the port's playback (the C's
  // auto-scrolling text and WaitForAorBPress' 120-frame timeout are QUEST_LOG_PLAN.md QL5): B skips to the end.
  await game.mashUntil((t) => !t.field()?.questLogPlayback && t.idle(), { button: 'B', what: 'the quest log skipped to the end', timeout: 60_000 });
  await game.waitIdle();
}

test('Four Island: the rival, the sticker man, Icefall Cave (the ice, the fall, the back room), Lorelei and her dolls', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ThreeIsland_Harbor', x: 8, y: 5, party: [MEWTWO] });
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => {
    t.state!.battleSceneOff = true;
    // 25 Hall of Fame entries: UpdateLoreleiDollCollection's first doll (GAME_STAT_ENTERED_HOF, as the special reads it)
    t.state!.setGameStat(t.define('GAME_STAT_ENTERED_HOF'), 25);
  });

  // Three Island's sailor with the Rainbow Pass: VERMILION, ONE, TWO, FOUR ISLAND, OTHER, EXIT
  expect(await talkToHarborSailor(game)).toBe(255); // a list menu, not a multichoice
  await game.pressTimes('DOWN', 3);
  await game.press('A');
  const ride = await sail(game, 'Three → Four Island', 6);
  checkRide(ride.frames, true);
  expect(ride.map).toBe('FourIsland_Harbor');

  // Up the pier onto Four Island: FourIsland_OnTransition shows the rival (VAR_MAP_SCENE_FOUR_ISLAND 0), and its
  // ON_FRAME table runs FourIsland_EventScript_RivalScene: he walks up, talks, leaves (SE_EXIT), the scene var is 1.
  await game.eval((t) => t.until(() => t.idle(), 20000));
  let since = await game.mark();
  await game.walk('up', 3);
  await game.waitForEvent('map', { since, what: 'FourIsland' });
  const rival = await mashScript(game);
  expect(rival.some((m) => /What are you doing here in the SEVII ISLANDS\?/.test(m))).toBe(true);
  expect(await scriptsSince(game, since)).toContain('FourIsland_EventScript_RivalScene');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_FOUR_ISLAND'), t.flag('FLAG_HIDE_FOUR_ISLAND_RIVAL'), t.flag('FLAG_WORLD_MAP_FOUR_ISLAND')])).toEqual([1, true, true]);
  expect((await game.eval((t) => t.objects() as { graphicsId: string }[])).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE')).toBe(false);
  expect(await sesSince(game, since)).toContain('SE_EXIT');

  // The sticker man (FourIsland_House2): StickerManGetBragFlags gives 1 (Hall of Fame entries only), so the first
  // visit's MULTICHOICE_HOF_QUIT; HALL OF FAME with 25 entries is BragHoFLowest (VAR_HOF_BRAG_STATE 1).
  await warp(game, 'MAP_FOUR_ISLAND_HOUSE2', 4, 6);
  since = await game.mark();
  await talk(game, 4, 5, 'up');
  const brag = await mashScript(game);
  expect(await game.eval((t) => [t.var('VAR_0x8008'), t.var('VAR_0x8004'), t.var('VAR_HOF_BRAG_STATE'), t.flag('FLAG_MET_STICKER_MAN')])).toEqual([1, 25, 1, true]);
  expect(brag.some((m) => /I wish I could show them off/.test(m))).toBe(true);
  expect(brag.some((m) => /you made it into the HALL OF FAME/.test(m))).toBe(true);
  expect(brag.some((m) => /HALL OF FAME STICKER was applied/.test(m))).toBe(true);
  expect((await game.eval((t, s) => t.events(s).filter((e) => e.type === 'multichoice').map((e) => e.mcId), since))).toEqual([await game.eval((t) => t.define('MULTICHOICE_HOF_QUIT'))]);

  // Icefall Cave 1F: ON_RESUME's setstepcallback STEP_CB_ICE; the thin ice at (8, 14) (sIcefallCaveIceCoords[8])
  await warp(game, 'MAP_FOUR_ISLAND_ICEFALL_CAVE_1F', 8, 15);
  const d = await game.eval((t) => ({
    thin: (window as any).game.scene.getScene('Overworld').world.tileAt(t.field()!.worldX, t.field()!.worldY - 1).metatile as number,
    cracked: t.define('METATILE_SeafoamIslands_CrackedIce'),
    hole: t.define('METATILE_SeafoamIslands_IceHole'),
    ice: t.define('STEP_CB_ICE'),
  }));
  expect(d.thin).not.toBe(d.cracked);
  expect(await stepCallback(game)).toEqual({ callbackId: d.ice, state: 1 });
  // The first step onto it cracks it (SE_ICE_CRACK) and sets FLAG_TEMP_9 (MarkIcePuzzleCoordVisited)
  since = await game.mark();
  await game.walk('up');
  const cracked = await game.waitForEvent('iceCracked', { since });
  expect([cracked.x, cracked.y]).toEqual([8, 14]);
  expect(await metatileAt(game, 8, 14)).toBe(d.cracked);
  expect(await game.eval((t) => [t.flag('FLAG_TEMP_9'), t.var('VAR_TEMP_1')])).toEqual([true, 0]);
  expect(await sesSince(game, since)).toContain('SE_ICE_CRACK');
  await game.walk('down');
  expect(await metatileAt(game, 8, 14)).toBe(d.cracked);

  // Saved and continued: the map is loaded afresh, and ON_LOAD's SetIcefallCaveCrackedIceMetatiles cracks it again
  // from the saved FLAG_TEMP_9; ON_RESUME sets the step callback again.
  await saveAndContinue(game);
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y])).toEqual(['FourIsland_IcefallCave_1F', 8, 15]);
  expect(await metatileAt(game, 8, 14)).toBe(d.cracked);
  expect((await stepCallback(game)).callbackId).toBe(d.ice);

  // The second step breaks it (SE_ICE_BREAK, VAR_TEMP_1 1): FourIsland_IcefallCave_1F_EventScript_FallDownHole
  // (SE_FALL, `warphole MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F`) drops the player to the same spot on B1F.
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('iceBroken', { since });
  expect(await metatileAt(game, 8, 14)).toBe(d.hole);
  const fall = await game.waitForEvent('fallWarp', { since, timeout: 60_000 });
  expect(fall.map).toBe('MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F');
  await game.waitForEvent('fallWarpDone', { since, timeout: 60_000 });
  await game.eval((t) => t.until(() => t.idle(), 20000));
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y])).toEqual(['FourIsland_IcefallCave_B1F', 8, 14]);
  expect(await scriptsSince(game, since)).toContain('FourIsland_IcefallCave_1F_EventScript_FallDownHole');
  const ses = await sesSince(game, since);
  expect(ses.indexOf('SE_ICE_BREAK')).toBeGreaterThanOrEqual(0);
  expect(ses.indexOf('SE_FALL')).toBeGreaterThan(ses.indexOf('SE_ICE_BREAK'));
  // B1F has no step callback (SetUpFieldTasks' STEP_CB_DUMMY); back on 1F the temp flags are gone and the ice is whole
  expect((await stepCallback(game)).callbackId).toBe(await game.eval((t) => t.define('STEP_CB_DUMMY')));
  await warp(game, 'MAP_FOUR_ISLAND_ICEFALL_CAVE_1F', 8, 15);
  expect(await metatileAt(game, 8, 14)).toBe(d.thin);

  // The back room: onto (12, 18), FourIsland_IcefallCave_Back_EventScript_LoreleiRocketsScene: Lorelei calls the
  // player over, the grunt's battle (TRAINER_TEAM_ROCKET_GRUNT_45), Lapras's cry, the Rockets run, Lorelei thanks
  // the player (VAR_MAP_SCENE_ICEFALL_CAVE_BACK 1).
  await warp(game, 'MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK', 12, 22);
  since = await game.mark();
  await game.walk('up', 4);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ICEFALL_CAVE_BACK') === 1 && t.idle() && !t.field()!.script, { what: 'the back room scene', ...SCENE });
  expect(await scriptsSince(game, since)).toContain('FourIsland_IcefallCave_Back_EventScript_LoreleiRocketsScene');
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_TEAM_ROCKET_GRUNT_45'))]);
  expect(await game.eval((t) => [t.trainerDefeated('TEAM_ROCKET_GRUNT_45'), t.flag('FLAG_HIDE_ICEFALL_CAVE_ROCKETS'), t.flag('FLAG_HIDE_RUIN_VALLEY_SCIENTIST'), t.flag('FLAG_HIDE_LORELEI_IN_HER_HOUSE')])).toEqual([true, true, true, false]);
  // (playmoncry SPECIES_LAPRAS, CRY_MODE_ENCOUNTER)
  const cries = await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'cry').map((e) => [e.id, e.mode]), since);
  expect(cries).toContainEqual(await game.eval((t) => [t.define('SPECIES_LAPRAS'), t.define('CRY_MODE_ENCOUNTER')]));
  const objs = (await game.eval((t) => t.objects())) as { graphicsId: string; x: number; y: number }[];
  expect(objs.filter((o) => o.graphicsId === 'OBJ_EVENT_GFX_ROCKET_M')).toEqual([]);
  // The player walked up to the Rockets (up, up, right, up) and faces Lorelei, who walked over (left, up, right)
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual([13, 15, 'left']);
  expect(objs.filter((o) => o.graphicsId === 'OBJ_EVENT_GFX_LORELEI').map((o) => [o.x, o.y])).toEqual([[12, 15]]);
  // On the next visit, FourIsland_IcefallCave_Back_OnTransition hides her
  await warp(game, 'MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK', 12, 22);
  expect(await game.eval((t) => t.flag('FLAG_HIDE_ICEFALL_CAVE_LORELEI'))).toBe(true);
  expect(((await game.eval((t) => t.objects())) as { graphicsId: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_LORELEI')).toBe(false);

  // Lorelei's house: ON_TRANSITION's UpdateLoreleiDollCollection shows the Meowth doll (25 entries), not the
  // Chansey (50); Lorelei is home.
  await warp(game, 'MAP_FOUR_ISLAND_LORELEIS_HOUSE', 4, 6);
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_LORELEI_HOUSE_MEOWTH_DOLL'), t.flag('FLAG_HIDE_LORELEI_HOUSE_CHANSEY_DOLL')])).toEqual([false, true]);
  const gfx = ((await game.eval((t) => t.objects())) as { graphicsId: string }[]).map((o) => o.graphicsId);
  expect(gfx).toEqual(expect.arrayContaining(['OBJ_EVENT_GFX_MEOWTH', 'OBJ_EVENT_GFX_LORELEI']));
  expect(gfx).not.toContain('OBJ_EVENT_GFX_CHANSEY');
  await talk(game, 9, 5, 'up'); // the Meowth doll (9, 4)
  expect(await mashScript(game)).toContain('Stuffed POKéMON dolls galore!');
  await talk(game, 7, 5, 'up'); // Lorelei (7, 4)
  expect((await mashScript(game)).some((m) => /If anything were to happen on/.test(m))).toBe(true);
}, 900_000);
