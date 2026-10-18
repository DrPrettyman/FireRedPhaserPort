// The Sevii Islands 1-3 quest, played (W-ferry unit 2): Bill's trip to One Island and Celio, then Two Island's
// Joyful Game Corner (Lostelle is missing, a biker passes through), Three Island's bikers and Paxton, Berry
// Forest's Lostelle and the Hypno, Lostelle's daddy and the Meteorite (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F
// → 2), the One Island Pokémon Center's leave scene and the ferry back to Cinnabar. Warps skip the walking between
// the scenes (the harbors, the game corner's door, Three Island's road, Berry Forest); every script the story
// needs runs, and the island ferries are taken from their sailors. seagallop.test.ts has a fast variant of the
// way back that sets the var.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { afterBlaine, checkRide, MEWTWO, rideFerry, sail, talkToHarborSailor, warp } from './seagallopHelpers';

const session = useGame();

/** Mashing A through a whole scene (battles included) can take a while under load. */
const SCENE = { timeout: 300_000, maxFrames: 60000 };

/** The battles that started since `since`: their trainer ids (0 for a wild battle). */
function battlesSince(game: Game, since: number) {
  return game.eval((t, s) => t.events(s).filter((e) => e.type === 'battleStart').map((e) => e.trainer as number), since);
}

type Obj = { graphicsId: string; x: number; y: number; facing: string };

test('the Sevii 1-3 quest: Celio, the game corner, the bikers, Lostelle, the Meteorite, the way back', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_Gym', x: 25, y: 21, party: [MEWTWO] });
  await afterBlaine(game);
  await warp(game, 'MAP_CINNABAR_ISLAND', 20, 5);
  await game.mashUntil((t) => t.message()?.includes('ONE ISLAND'), { what: "Bill's question" });
  const there = await rideFerry(game, 'Bill');
  expect(there.map).toBe('OneIsland_Harbor');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 1 && t.idle() && !t.field()!.script, { what: 'Celio', ...SCENE });

  // One Island harbor → Two Island. Bill's trip isn't over (VAR_MAP_SCENE_CINNABAR_ISLAND 2): MULTICHOICE_ISLAND_23
  // (TWO, THREE ISLAND, EXIT), HI-SPEED 2.
  await warp(game, 'MAP_ONE_ISLAND_HARBOR', 8, 5);
  expect(await talkToHarborSailor(game)).toBe(await game.eval((t) => t.define('MULTICHOICE_ISLAND_23')));
  await game.press('A'); // TWO ISLAND
  const toTwo = await sail(game, 'One → Two Island', 2);
  checkRide(toTwo.frames, true);
  expect(toTwo.map).toBe('TwoIsland_Harbor');

  // Two Island (TwoIsland_OnTransition: the shop's first stock), in through the Joyful Game Corner's door (39, 9):
  // HelpFindLostelleScene. The player steps left off the mat for the biker, who leaves again.
  await warp(game, 'MAP_TWO_ISLAND', 39, 10);
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_TWO_ISLAND'), t.flag('FLAG_VISITED_TWO_ISLAND')])).toEqual([1, true]);
  await game.walk('up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_TWO_ISLAND_JOYFUL_GAME_CORNER') === 1 && t.idle() && !t.field()!.script, { what: 'HelpFindLostelleScene', ...SCENE });
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual(['TwoIsland_JoyfulGameCorner', 4, 8, 'right']);
  expect(await game.eval((t) => (t.objects() as Obj[]).filter((o) => ['OBJ_EVENT_GFX_BALDING_MAN', 'OBJ_EVENT_GFX_BIKER'].includes(o.graphicsId)).map((o) => [o.graphicsId, o.x, o.y, o.facing]))).toEqual([['OBJ_EVENT_GFX_BALDING_MAN', 6, 8, 'left']]);
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_THREE_ISLAND'), t.flag('FLAG_HIDE_THREE_ISLAND_LONE_BIKER')])).toEqual([2, false]);

  // Two Island harbor → Three Island (MULTICHOICE_ISLAND_13: ONE, THREE ISLAND, EXIT)
  await warp(game, 'MAP_TWO_ISLAND_HARBOR', 8, 5);
  expect(await talkToHarborSailor(game)).toBe(await game.eval((t) => t.define('MULTICHOICE_ISLAND_13')));
  await game.press('DOWN');
  await game.press('A'); // THREE ISLAND
  const toThree = await sail(game, 'Two → Three Island', 2);
  checkRide(toThree.frames, true);
  expect(toThree.map).toBe('ThreeIsland_Harbor');

  // Three Island, up the road from the port onto (9, 27): BikerBossIntroTrigger (Paxton has come); then onto
  // (9, 26): BattleBikersScene, YES, three bikers and Paxton, and they're gone.
  await warp(game, 'MAP_THREE_ISLAND', 9, 29);
  await game.walk('up', 2);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_THREE_ISLAND') === 3 && t.idle() && !t.field()!.script, { what: 'BikerBossIntroTrigger', ...SCENE });
  let since = await game.mark();
  await game.walk('up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_THREE_ISLAND') === 4 && t.idle() && !t.field()!.script, { what: 'the bikers and Paxton', ...SCENE });
  const bikers = await game.eval((t) => ['TRAINER_BIKER_GOON', 'TRAINER_BIKER_GOON_2', 'TRAINER_BIKER_GOON_3', 'TRAINER_CUE_BALL_PAXTON'].map((n) => t.define(n)));
  expect(await battlesSince(game, since)).toEqual(bikers);
  expect(await game.eval((t) => (t.objects() as Obj[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BIKER'))).toBe(false);
  // removeobject sets the bikers' flags, so the port's bikers are gone too
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_THREE_ISLAND_BIKERS'), t.flag('FLAG_HIDE_THREE_ISLAND_LONE_BIKER')])).toEqual([true, true]);

  // Berry Forest (over Bond Bridge): Lostelle at (4, 8), the Hypno (a wild battle), the Iapapa Berry, and the warp
  // to her daddy's game corner: FoundLostelleScene.
  await warp(game, 'MAP_THREE_ISLAND_BERRY_FOREST', 4, 9);
  await game.eval((t) => t.face('up'));
  since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_TWO_ISLAND_JOYFUL_GAME_CORNER') === 3 && t.idle() && !t.field()!.script, { what: 'Lostelle', ...SCENE });
  expect(await battlesSince(game, since)).toEqual([0]);
  expect(await game.eval((t) => [t.field()!.map, t.flag('FLAG_RESCUED_LOSTELLE'), t.flag('FLAG_HIDE_LOSTELLE_IN_BERRY_FOREST'), t.itemCount('IAPAPA_BERRY')])).toEqual(['TwoIsland_JoyfulGameCorner', true, true, 1]);

  // Lostelle's daddy at (5, 5): the Meteorite from Bill → VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 2, a Moon Stone.
  // (The player came in at (6, 6) facing north, OnWarp's TurnPlayerNorth.)
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual([6, 6, 'up']);
  await game.walk('left');
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_GOT_MOON_STONE_FROM_JOYFUL_GAME_CORNER') && t.idle() && !t.field()!.script, { what: 'the Meteorite', ...SCENE });
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F'), t.itemCount('METEORITE'), t.itemCount('MOON_STONE')])).toEqual([2, 0, 1]);

  // Two Island harbor → One Island, westbound
  await warp(game, 'MAP_TWO_ISLAND_HARBOR', 8, 5);
  expect(await talkToHarborSailor(game)).toBe(await game.eval((t) => t.define('MULTICHOICE_ISLAND_13')));
  await game.press('A'); // ONE ISLAND
  const toOne = await sail(game, 'Two → One Island', 2);
  checkRide(toOne.frames, false);
  expect(toOne.map).toBe('OneIsland_Harbor');

  // The One Island Pokémon Center: Bill and Celio wait by the machine (SetBillCelioReadyToLeavePos); onto (12, 8):
  // LeaveOneIslandTriggerMidBottom, the ferry to Cinnabar, Bill's goodbye.
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 9, 8);
  await game.walk('right', 3);
  const back = await rideFerry(game, 'the leave scene');
  checkRide(back.frames, false);
  expect(back.map).toBe('CinnabarIsland');
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([21, 7]);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND') === 4 && t.idle() && !t.field()!.script, { what: "Bill's goodbye", ...SCENE });
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_TWO_ISLAND_GAME_CORNER_LOSTELLE'), t.flag('FLAG_HIDE_LOSTELLE_IN_HER_HOME'), t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F')])).toEqual([true, false, 3]);
}, 600_000);
