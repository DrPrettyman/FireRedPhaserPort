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
 *   (ViridianCity_Gym_EventScript_DefeatedGiovanni: FLAG_DEFEATED_LEADER_GIOVANNI, FLAG_BADGE08_GET).
 * - The Hall of Fame: PokemonLeague_HallOfFame_EventScript_EnterRoom → EventScript_SetDefeatedEliteFourFlagsVars
 *   (data/scripts/hall_of_fame.inc: clearflag FLAG_HIDE_POSTGAME_GOSSIPERS, EventScript_ResetEliteFour, and without
 *   the National Dex EventScript_SetReadyTryGiveNationalDexScene: VAR_MAP_SCENE_PALLET_TOWN_OAK 2), then
 *   EnterHallOfFame (post_battle_event_funcs.c: FLAG_SYS_GAME_CLEAR).
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
