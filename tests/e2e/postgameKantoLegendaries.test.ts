// The legendaries' battles to their end (GAPS_PLAN.md W-kanto): the birds (Moltres on Mt. Ember's summit, Articuno
// on Seafoam B4F, Zapdos in the Power Plant) and the event legendaries (Lugia at Navel Rock's base, Ho-Oh at its
// summit, Deoxys on Birth Island) caught with a Master Ball: StartLegendaryBattle, CB2_EndScriptedWildBattle, the
// map's ON_RESUME removing the caught mon, the script's GetBattleOutcome checks and FLAG_FOUGHT_*, the map's music
// back (CB2_ReturnToFieldContinueScriptPlayMapMusic), and gone on the next visit (ON_TRANSITION). Lugia beaten
// (FLAG_LUGIA_FLEW_AWAY: EventScript_MonFlewAway, and it stays away) and Ho-Oh run from (back on the next visit).
// Mewtwo is postgameKanto.test.ts's; Zapdos beaten is scriptedBattles.test.ts's, Moltres beaten postgame.test.ts's.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';
import { fightToEnd, finishScript, foeOf, objectsWith, outcomeSince, runFromBattle, throwFirstBall, warp } from './postgameHelpers';

const session = useGame();

const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['SHADOW_BALL', 'THUNDERBOLT'] };

type Dir = 'up' | 'down' | 'left' | 'right';

interface Legendary {
  species: string;
  level: number;
  map: string;
  mapId: string;
  /** Where to stand to talk to it, and which way to face (Ho-Oh: the coord event's tile, walked onto from below). */
  stand: [number, number, Dir];
  at: [number, number];
  gfx: string;
  fought: string;
  hide: string;
  music: string;
  battleMusic: string;
}

const MOLTRES: Legendary = { species: 'MOLTRES', level: 50, map: 'MtEmber_Summit', mapId: 'MAP_MT_EMBER_SUMMIT', stand: [9, 7, 'up'], at: [9, 6], gfx: 'OBJ_EVENT_GFX_MOLTRES', fought: 'FLAG_FOUGHT_MOLTRES', hide: 'FLAG_HIDE_MOLTRES', music: 'MUS_SEVII_CAVE', battleMusic: 'MUS_VS_LEGEND' };
const ARTICUNO: Legendary = { species: 'ARTICUNO', level: 50, map: 'SeafoamIslands_B4F', mapId: 'MAP_SEAFOAM_ISLANDS_B4F', stand: [9, 3, 'up'], at: [9, 2], gfx: 'OBJ_EVENT_GFX_ARTICUNO', fought: 'FLAG_FOUGHT_ARTICUNO', hide: 'FLAG_HIDE_ARTICUNO', music: 'MUS_VIRIDIAN_FOREST', battleMusic: 'MUS_VS_LEGEND' };
const ZAPDOS: Legendary = { species: 'ZAPDOS', level: 50, map: 'PowerPlant', mapId: 'MAP_POWER_PLANT', stand: [5, 12, 'up'], at: [5, 11], gfx: 'OBJ_EVENT_GFX_ZAPDOS', fought: 'FLAG_FOUGHT_ZAPDOS', hide: 'FLAG_HIDE_ZAPDOS', music: 'MUS_POKE_MANSION', battleMusic: 'MUS_VS_LEGEND' };
const LUGIA: Legendary = { species: 'LUGIA', level: 70, map: 'NavelRock_Base', mapId: 'MAP_NAVEL_ROCK_BASE', stand: [10, 16, 'up'], at: [10, 15], gfx: 'OBJ_EVENT_GFX_LUGIA', fought: 'FLAG_FOUGHT_LUGIA', hide: 'FLAG_HIDE_LUGIA', music: 'MUS_SEVII_CAVE', battleMusic: 'MUS_VS_LEGEND' };
const HO_OH: Legendary = { species: 'HO_OH', level: 70, map: 'NavelRock_Summit', mapId: 'MAP_NAVEL_ROCK_SUMMIT', stand: [9, 12, 'up'], at: [9, 6], gfx: 'OBJ_EVENT_GFX_HO_OH', fought: 'FLAG_FOUGHT_HO_OH', hide: 'FLAG_HIDE_HO_OH', music: 'MUS_SEVII_CAVE', battleMusic: 'MUS_VS_LEGEND' };

const bgm = (game: Game) => game.eval((t) => t.audio().players.BGM.song as string);

/** Start below the legendary with a Master Ball and a Repel's worth of steps. */
async function startAt(l: Legendary, from: [number, number]) {
  const game = await session.start({ start: 'after-rival', map: l.map, x: from[0], y: from[1], party: [MEWTWO] });
  await game.eval((t) => {
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 2000);
    t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1);
  });
  expect(await objectsWith(game, l.gfx), `${l.species} shown by ON_TRANSITION`).toEqual([l.at]);
  return game;
}

/** Talk to it (or walk onto Ho-Oh's coord event): its cry and text, then the battle. */
async function meet(game: Game, l: Legendary) {
  const [x, y, dir] = l.stand;
  const since = await game.mark();
  if (l === HO_OH) {
    await game.walk('up'); // the coord event at (9, 12): NavelRock_Summit_EventScript_HoOh
  } else {
    await game.eval(async (t, x, y, dir) => {
      await t.walkTo(x, y);
      await t.face(dir);
    }, x, y, dir);
    await game.press('A');
  }
  expect(await foeOf(game, `${l.species}'s battle`)).toEqual([l.species, l.level]);
  expect((await game.waitForEvent('battleStart', { since })).flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_LEGENDARY') | t.define('BATTLE_TYPE_LEGENDARY_FRLG')));
  expect(await bgm(game)).toBe(l.battleMusic);
  return since;
}

/** Caught: ON_RESUME's removeobject, FLAG_FOUGHT_*, the mon in the party, the map's music, no "flew away". */
async function catchIt(game: Game, l: Legendary) {
  const since = await meet(game, l);
  await throwFirstBall(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_CAUGHT');
  const messages = await finishScript(game);
  expect(messages.filter((m) => /flew away/.test(m))).toEqual([]);
  expect(await objectsWith(game, l.gfx)).toEqual([]);
  expect(await game.eval((t, f, h) => [t.flag(f), t.flag(h), t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE')], l.fought, l.hide)).toEqual([true, true, false]);
  expect(await game.eval((t) => t.party().map((m: any) => [m.species, m.level]))).toEqual([['MEWTWO', 100], [l.species, l.level]]);
  expect(await bgm(game)).toBe(l.music);
}

for (const l of [MOLTRES, ARTICUNO, ZAPDOS]) {
  test(`${l.species} caught with a Master Ball: gone, and still gone on the next visit`, async () => {
    const game = await startAt(l, [l.stand[0], l.stand[1] + 1]);
    await catchIt(game, l);
    // ON_TRANSITION: FLAG_FOUGHT_* set, so FLAG_HIDE_* stays
    await warp(game, l.mapId, l.stand[0], l.stand[1] + 1);
    expect(await objectsWith(game, l.gfx)).toEqual([]);
  }, 300_000);
}

test('Moltres teleported away from (B_OUTCOME_PLAYER_TELEPORTED): it flies away, and is back on the next visit', async () => {
  const game = await startAt(MOLTRES, [9, 8]);
  await game.eval((t) => t.setParty([{ species: 'ABRA', level: 100, moves: ['TELEPORT'] }]));
  const since = await meet(game, MOLTRES);
  await fightToEnd(game); // TELEPORT: BattleScript_EffectTeleport's setoutcomeonteleport
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_PLAYER_TELEPORTED');
  // MtEmber_Summit_EventScript_RanFromMoltres → EventScript_MonFlewAway; FLAG_FOUGHT_MOLTRES stays unset
  expect(await finishScript(game)).toContain('The MOLTRES flew away!');
  expect(await objectsWith(game, MOLTRES.gfx)).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MOLTRES'), t.flag('FLAG_HIDE_MOLTRES')])).toEqual([false, true]);
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'MtEmber_Summit', x: 9, y: 7 });
  // MtEmber_Summit_OnTransition → MtEmber_Summit_EventScript_ShowMoltres
  await warp(game, MOLTRES.mapId, 9, 8);
  expect(await objectsWith(game, MOLTRES.gfx)).toEqual([MOLTRES.at]);
}, 300_000);

test('Lugia caught; FLAG_FOUGHT_LUGIA keeps Navel Rock\'s base empty', async () => {
  const game = await startAt(LUGIA, [10, 17]);
  await catchIt(game, LUGIA);
  // NavelRock_Base_OnTransition → NavelRock_Base_EventScript_HideLugia
  await warp(game, LUGIA.mapId, 10, 17);
  expect(await objectsWith(game, LUGIA.gfx)).toEqual([]);
}, 300_000);

test('Lugia beaten: "The LUGIA flew away!" (FLAG_LUGIA_FLEW_AWAY), and it stays away', async () => {
  const game = await startAt(LUGIA, [10, 17]);
  const since = await meet(game, LUGIA);
  await fightToEnd(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_WON');
  // NavelRock_Base_EventScript_DefeatedLugia: FLAG_LUGIA_FLEW_AWAY, EventScript_MonFlewAway
  expect(await finishScript(game)).toContain('The LUGIA flew away!');
  expect(await objectsWith(game, LUGIA.gfx)).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_LUGIA_FLEW_AWAY'), t.flag('FLAG_FOUGHT_LUGIA'), t.flag('FLAG_HIDE_LUGIA')])).toEqual([true, false, true]);
  expect(await bgm(game)).toBe(LUGIA.music);
  // NavelRock_Base_EventScript_TryShowLugia: FLAG_LUGIA_FLEW_AWAY, so it isn't shown
  await warp(game, LUGIA.mapId, 10, 17);
  expect(await objectsWith(game, LUGIA.gfx)).toEqual([]);
}, 300_000);

test('Ho-Oh caught at the summit; gone on the next visit', async () => {
  const game = await startAt(HO_OH, [9, 13]);
  await catchIt(game, HO_OH);
  await warp(game, HO_OH.mapId, 9, 13);
  expect(await objectsWith(game, HO_OH.gfx)).toEqual([]);
  // NavelRock_Summit_EventScript_HideHoOh's VAR_TEMP_1 1: the coord event doesn't start again
  const since = await game.mark();
  await game.walk('up');
  expect((await game.events(since)).some((e) => e.type === 'script')).toBe(false);
}, 300_000);

test('running from Ho-Oh: it flies away, and is back on the next visit', async () => {
  const game = await startAt(HO_OH, [9, 13]);
  const since = await meet(game, HO_OH);
  await runFromBattle(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_RAN');
  expect(await finishScript(game)).toContain('The HO-OH flew away!');
  expect(await objectsWith(game, HO_OH.gfx)).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_HO_OH_FLEW_AWAY'), t.flag('FLAG_FOUGHT_HO_OH')])).toEqual([false, false]);
  await warp(game, HO_OH.mapId, 9, 13);
  expect(await objectsWith(game, HO_OH.gfx)).toEqual([HO_OH.at]);
}, 300_000);

test('Deoxys caught on Birth Island: the triangle\'s last touch, the battle, gone with its rock on the next visit', async () => {
  const game = await session.start({ start: 'after-rival', map: 'BirthIsland_Exterior', x: 15, y: 13, party: [MEWTWO] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  // The ten corners are eventIslands.test.ts's: here the last touch (VAR_DEOXYS_INTERACTION_NUM 10, no steps)
  await game.eval((t) => t.state!.setVar('VAR_DEOXYS_INTERACTION_NUM', 10));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await game.press('A');
  expect(await foeOf(game, "Deoxys's battle")).toEqual(['DEOXYS', 30]);
  expect(await bgm(game)).toBe('MUS_VS_DEOXYS');
  await throwFirstBall(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_CAUGHT');
  // BirthIsland_Exterior_OnResume: removeobject LOCALID_BIRTH_ISLAND_DEOXYS; then FLAG_FOUGHT_DEOXYS
  const messages = await finishScript(game);
  expect(messages.filter((m) => /flew away/.test(m))).toEqual([]);
  expect(await game.eval((t) => t.objects().filter((o) => /DEOXYS|VAR_0/.test(o.graphicsId)).length)).toBe(0);
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_DEOXYS'), t.flag('FLAG_HIDE_DEOXYS'), t.flag('FLAG_SYS_DEOXYS_AWAKENED')])).toEqual([true, true, true]);
  expect(await game.eval((t) => t.party().map((m: any) => [m.species, m.level]))).toEqual([['MEWTWO', 100], ['DEOXYS', 30]]);
  // BirthIsland_Exterior_EventScript_HideDeoxysAndPuzzle: no Deoxys, no triangle
  await warp(game, 'MAP_BIRTH_ISLAND_EXTERIOR', 15, 13);
  expect(await game.eval((t) => t.objects().map((o) => o.graphicsId).filter((g) => /DEOXYS|VAR_0|METEORITE/.test(g)))).toEqual([]);
}, 300_000);
