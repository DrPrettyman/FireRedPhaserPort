// Helpers for the postgame's e2e tests (POSTGAME_PLAN.md, W-sevii): the story state the Hall of Fame and Bill's
// Sevii 1-3 trip leave, and a Pokédex filled far enough for Oak's National Dex. Builds on seagallopHelpers.ts.

import type { Game } from './harness';
import { afterBlaine, triPassState } from './seagallopHelpers';

export { MEWTWO, warp } from './seagallopHelpers';

/**
 * The story state after the Hall of Fame and the Sevii 1-3 trip, as the scripts that run on the way leave it
 * (the flags and vars the postgame's scripts read; the trip's side flags, e.g. the shops' stock, are left out):
 *
 * - afterBlaine (badges 1-7, CinnabarIsland_Gym_EventScript_DefeatedBlaine), Giovanni's badge
 *   (ViridianCity_Gym_EventScript_DefeatedGiovanni: FLAG_DEFEATED_LEADER_GIOVANNI, FLAG_BADGE08_GET), Bill met
 *   (FLAG_SYS_NOT_SOMEONES_PC).
 * - The Hall of Fame: PokemonLeague_HallOfFame_EventScript_EnterRoom → EventScript_SetDefeatedEliteFourFlagsVars
 *   (data/scripts/hall_of_fame.inc: clearflag FLAG_HIDE_POSTGAME_GOSSIPERS, EventScript_ResetEliteFour, and without
 *   the National Dex EventScript_SetReadyTryGiveNationalDexScene: VAR_MAP_SCENE_PALLET_TOWN_OAK 2), then
 *   EnterHallOfFame (post_battle_event_funcs.c: FLAG_SYS_GAME_CLEAR; its save counts GAME_STAT_ENTERED_HOF).
 * - Bill's trip (seviiQuest.test.ts plays it): seagallopHelpers' triPassState (the Tri-Pass, FLAG_SYS_SEVII_MAP_123,
 *   VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 3 from LeaveOneIslandScene, VAR_MAP_SCENE_CINNABAR_ISLAND 4 from
 *   CinnabarIsland_EventScript_ReturnFromSeviiIslands, VAR_MAP_SCENE_ONE_ISLAND_HARBOR 3 from OneIsland's
 *   transition, VAR_MAP_SCENE_VERMILION_CITY 3); MeetCelioScene's Town Map page (VAR_MAP_SCENE_PALLET_TOWN_RIVALS_HOUSE
 *   2, FLAG_HIDE_TOWN_MAP); the islands' setworldmapflag (OneIsland / TwoIsland / ThreeIsland / BerryForest
 *   OnTransition); ThreeIsland_Port_OnTransition (FLAG_SEVII_DETOUR_FINISHED, PC storage back on); the game corner
 *   and Lostelle (TwoIsland_JoyfulGameCorner, ThreeIsland_BerryForest: VAR_MAP_SCENE_TWO_ISLAND_JOYFUL_GAME_CORNER 3,
 *   FLAG_RESCUED_LOSTELLE, FLAG_HIDE_LOSTELLE_IN_BERRY_FOREST, the Moon Stone; CinnabarIsland's way back:
 *   FLAG_HIDE_TWO_ISLAND_GAME_CORNER_LOSTELLE, FLAG_HIDE_LOSTELLE_IN_HER_HOME cleared); Three Island's bikers
 *   (VAR_MAP_SCENE_THREE_ISLAND 4, FLAG_HIDE_THREE_ISLAND_BIKERS / _LONE_BIKER: removeobject); Two Island
 *   (VAR_MAP_SCENE_TWO_ISLAND 1, FLAG_VISITED_TWO_ISLAND); Bill gone from the One Island Pokémon Center
 *   (FLAG_HIDE_ONE_ISLAND_POKECENTER_BILL) and from Cinnabar (removeobject LOCALID_CINNABAR_BILL).
 */
export async function afterHallOfFame(game: Game) {
  await afterBlaine(game);
  await triPassState(game);
  await game.eval((t) => {
    const s = t.state!;
    for (const f of ['FLAG_DEFEATED_LEADER_GIOVANNI', 'FLAG_BADGE08_GET', 'FLAG_SYS_GAME_CLEAR']) s.setFlag(f, true);
    // Bill met in the Sea Cottage (Route25_SeaCottage's `setflag FLAG_SYS_NOT_SOMEONES_PC`): "BILL's PC"
    s.setFlag('FLAG_SYS_NOT_SOMEONES_PC', true);
    // EnterHallOfFame's save (state/save.ts): GAME_STAT_ENTERED_HOF
    s.setGameStat(t.define('GAME_STAT_ENTERED_HOF'), 1);
    // EventScript_SetDefeatedEliteFourFlagsVars
    s.setFlag('FLAG_HIDE_POSTGAME_GOSSIPERS', false);
    for (const f of ['FLAG_DEFEATED_LORELEI', 'FLAG_DEFEATED_BRUNO', 'FLAG_DEFEATED_AGATHA', 'FLAG_DEFEATED_LANCE', 'FLAG_DEFEATED_CHAMP']) s.setFlag(f, false);
    s.setVar('VAR_MAP_SCENE_PALLET_TOWN_OAK', 2);
    // Bill's Sevii 1-3 trip
    for (const f of [
      'FLAG_WORLD_MAP_ONE_ISLAND',
      'FLAG_WORLD_MAP_TWO_ISLAND',
      'FLAG_WORLD_MAP_THREE_ISLAND',
      'FLAG_WORLD_MAP_THREE_ISLAND_BERRY_FOREST',
      'FLAG_SEVII_DETOUR_FINISHED',
      'FLAG_HIDE_TOWN_MAP',
      'FLAG_VISITED_TWO_ISLAND',
      'FLAG_RESCUED_LOSTELLE',
      'FLAG_HIDE_LOSTELLE_IN_BERRY_FOREST',
      'FLAG_HIDE_TWO_ISLAND_GAME_CORNER_LOSTELLE',
      'FLAG_GOT_MOON_STONE_FROM_JOYFUL_GAME_CORNER',
      'FLAG_HIDE_THREE_ISLAND_BIKERS',
      'FLAG_HIDE_THREE_ISLAND_LONE_BIKER',
      'FLAG_HIDE_ONE_ISLAND_POKECENTER_BILL',
      'FLAG_HIDE_CINNABAR_BILL',
    ])
      s.setFlag(f, true);
    for (const f of ['FLAG_SYS_PC_STORAGE_DISABLED', 'FLAG_HIDE_LOSTELLE_IN_HER_HOME']) s.setFlag(f, false);
    s.setVar('VAR_MAP_SCENE_PALLET_TOWN_RIVALS_HOUSE', 2);
    s.setVar('VAR_MAP_SCENE_TWO_ISLAND', 1);
    s.setVar('VAR_MAP_SCENE_TWO_ISLAND_JOYFUL_GAME_CORNER', 3);
    s.setVar('VAR_MAP_SCENE_THREE_ISLAND', 4);
  });
}

/**
 * The state the first postgame stretch leaves (postgame.test.ts plays it): the National Dex
 * (PalletTown_ProfessorOaksLab_EventScript_EnterForNationalDexScene: EnableNationalPokedex, VAR_MAP_SCENE_PALLET_TOWN_OAK
 * 3, VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB 8, FLAG_HIDE_OAK_IN_PALLET_TOWN), Mt. Ember's Rockets gone
 * (MtEmber_Exterior_EventScript_RocketPasswordScene: VAR_MAP_SCENE_MT_EMBER_EXTERIOR 2; the grunts' defeat scripts:
 * FLAG_HIDE_MT_EMBER_EXTERIOR_ROCKETS), the Ruby taken (FLAG_GOT_RUBY, FLAG_HIDE_RUBY), Moltres fought
 * (FLAG_FOUGHT_MOLTRES), and Celio's OneIsland_PokemonCenter_1F_EventScript_GiveRainbowPass (the Ruby and the Tri-Pass
 * for the Rainbow Pass, VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 5, FLAG_SYS_SEVII_MAP_4567).
 */
export async function rainbowPassState(game: Game) {
  await game.eval((t) => {
    const s = t.state!;
    s.nationalDexEnabled = true;
    s.setVar('VAR_MAP_SCENE_PALLET_TOWN_OAK', 3);
    s.setVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB', 8);
    s.setVar('VAR_MAP_SCENE_MT_EMBER_EXTERIOR', 2);
    for (const f of ['FLAG_HIDE_OAK_IN_PALLET_TOWN', 'FLAG_HIDE_MT_EMBER_EXTERIOR_ROCKETS', 'FLAG_GOT_RUBY', 'FLAG_HIDE_RUBY', 'FLAG_FOUGHT_MOLTRES', 'FLAG_SYS_SEVII_MAP_4567']) s.setFlag(f, true);
    s.bag.remove(t.define('ITEM_TRI_PASS'), 1);
    s.bag.add(t.define('ITEM_RAINBOW_PASS'), 1);
    s.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 5);
  });
}

/** At map-local (x, y) facing `dir`, press A: the object or bg event there starts. */
export async function talk(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  await game.eval(async (t, x, y, dir) => {
    await t.walkTo(x, y);
    await t.face(dir);
  }, x, y, dir);
  await game.press('A');
}

/** Kanto Pokédex numbers 1..n seen and caught (GetPokedexCount's VAR_0x8006 for Oak's 60, prof_pc.c). */
export async function fillPokedex(game: Game, n: number) {
  await game.eval((t, n) => {
    for (let i = 1; i <= n; i++) t.state!.setDexFlags(i, true, true);
  }, n);
}

/** Mashing A through a whole scene (battles included) can take a while under load. */
export const SCENE = { timeout: 300_000, maxFrames: 60000 };

/** The battles that started since `since`: their trainer ids (0 for a wild battle). */
export function battlesSince(game: Game, since: number) {
  return game.eval((t, s) => t.events(s).filter((e) => e.type === 'battleStart').map((e) => e.trainer as number), since);
}

/** The labels of the scripts that started since `since` (the `script` events). */
export function scriptsSince(game: Game, since: number) {
  return game.eval((t, s) => t.events(s).filter((e) => e.type === 'script').map((e) => e.label as string), since);
}

// --- the legendaries' battles (postgameKanto*.test.ts)

/** The outcome of the battle that ended since `since` (B_OUTCOME_*). */
export async function outcomeSince(game: Game, since: number) {
  const end = await game.waitForEvent('battleEnd', { since, timeout: 300_000 });
  return game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number);
}

/** The objects with graphics `gfx` on the current map, as map-local [x, y]. */
export function objectsWith(game: Game, gfx: string) {
  return game.eval((t, g) => t.objects().filter((o) => o.graphicsId === g).map((o) => [o.x, o.y]), gfx);
}

/** The foe's species and level once the battle has sent it out (mashing A through the script before it). */
export function foeOf(game: Game, what: string) {
  return game.mashUntil((t) => {
    const m = t.battle()?.mons?.[1];
    return m && m.species !== 'NONE' && ([m.species, m.level] as [string, number]);
  }, { what, ...SCENE });
}

/**
 * At the action menu: BAG → the POKé BALLS pocket → the first ball (the test's Master Ball) → throw it; "Give a
 * nickname...?" answered NO by mashing B (a single B can land while the question still prints, and A would then
 * pick YES) until the battle is over. Returns the battle messages from the throw on that matched `/transferred/`.
 */
export async function throwFirstBall(game: Game) {
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);
  await game.mashUntil((t) => {
    const m = t.battle()?.message ?? '';
    if (/transferred/.test(m)) (window as any).__sentToPc = m;
    return t.events().some((e) => e.type === 'battleEnd');
  }, { button: 'B', what: 'the catch and the battle to end', ...SCENE });
  return game.eval(() => (window as any).__sentToPc as string | undefined);
}

/** Mash A through the battle (the first move every turn) until it's over. */
export function fightToEnd(game: Game) {
  return game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end', ...SCENE });
}

/** At the action menu: RUN, then mash until the battle is over. */
export async function runFromBattle(game: Game) {
  await game.chooseAction('RUN');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end', ...SCENE });
}

/** Mash A through what the script does after the battle until the field is free; the field messages seen. */
export async function finishScript(game: Game) {
  const r = await game.eval(async (t) => {
    const res = await (t as any).mash((u: any) => u.idle() && !u.field()!.script && !u.field()!.fading, 'A', 60000, []);
    return (res.messages as string[]).map((m) => m.replace(/\s+/g, ' '));
  });
  return r;
}

/**
 * A route across a map that needs Surf (planned from the map's collision, elevation and behaviors): `to` walks to
 * a map-local tile along the shortest way (TestApi.walkTo), `surf` faces the water and uses Surf from the field
 * (EventScript_UseSurf: YES), `land` steps off the water onto the shore (Task_StopSurfingInit).
 */
export type RouteStep = ['to', number, number] | ['surf' | 'land', 'up' | 'down' | 'left' | 'right'];

export async function followRoute(game: Game, route: RouteStep[]) {
  for (const step of route) {
    if (step[0] === 'to') {
      const r = await game.eval((t, x, y) => t.walkTo(x, y), step[1], step[2]);
      if (!r.arrived) throw new Error(`Stopped at (${r.x}, ${r.y}) on the way to (${step[1]}, ${step[2]})`);
    } else if (step[0] === 'surf') {
      await game.eval((t, d) => t.face(d), step[1]);
      await game.waitIdle();
      await game.eval((t) => ((window as any).__surfSince = t.lastSeq()));
      await game.press('A');
      await game.waitFor((t) => t.message()?.includes('SURF'), { what: '"Would you like to SURF?"' });
      // YES (the cursor starts there), "MEWTWO used SURF!", the banner, the jump onto the water (the field counts as
      // idle while the field effects run: wait for them too)
      await game.mashUntil((t) => t.events((window as any).__surfSince).some((e) => e.type === 'fieldMoveShowMon'), { what: 'the banner' });
      await game.waitFor((t) => {
        const f = t.field()!;
        return t.idle() && !f.script && f.avatar.graphicsId.endsWith('_SURF') && !f.fieldEffects.some((e) => /^FLDEFF_(FIELD_MOVE_SHOW_MON|USE_)/.test(e));
      }, { what: 'surfing' });
    } else {
      await game.eval((t, d) => t.walk(d, 1), step[1]);
      await game.waitFor((t) => t.idle() && t.field()!.avatar.flags.includes('ON_FOOT'), { what: 'the player on land' });
    }
  }
}

/**
 * Walk onto the warp at map-local (x, y) and wait until the next map is loaded and the field is idle there (a cave's
 * map preview screen or flash can come first: wait on the field, not on a frame count). Returns the new map.
 */
export async function takeWarp(game: Game, x: number, y: number) {
  const from = await game.eval((t) => t.field()!.map);
  const since = await game.mark();
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  await game.waitForEvent('map', { since, what: `the warp at (${x}, ${y}) on ${from}`, timeout: 60_000 });
  await game.eval((t, from) => t.until(() => t.field()?.map !== from && t.idle() && !t.field()!.script, 20000), from);
  return game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y] as [string, number, number]);
}
