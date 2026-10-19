// The Kanto postgame (GAPS_PLAN.md W-kanto): Cerulean Cave from the entrance (the guard gone once Celio has the
// Sapphire) through 1F, 2F and back to 1F, down to B1F, and Mewtwo's battle to its end, caught, beaten and run
// from (data/maps/CeruleanCave_B1F/scripts.inc: StartLegendaryBattle, CB2_EndScriptedWildBattle, ON_RESUME's
// CeruleanCave_B1F_EventScript_TryRemoveMewtwo, the GetBattleOutcome checks, EventScript_RemoveStaticMon and
// EventScript_MonFlewAway, ON_TRANSITION's CeruleanCave_B1F_EventScript_ShowMewtwo on the next visit).

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';
import { afterHallOfFame, finishScript, fightToEnd, foeOf, followRoute, objectsWith, outcomeSince, runFromBattle, throwFirstBall, takeWarp, warp } from './postgameHelpers';

const session = useGame();

/** Surf for the cave's water; Shadow Ball (super effective) for Mewtwo. */
const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['SHADOW_BALL', 'SURF', 'PSYCHIC'] };

/**
 * After the Hall of Fame, with Celio's OneIsland_PokemonCenter_1F_EventScript_GiveCelioSapphire done
 * (postgameFiveIsland.test.ts plays it): `setflag FLAG_HIDE_CERULEAN_CAVE_GUARD`. A Repel's worth of steps
 * (VAR_REPEL_STEP_COUNT) keeps the cave's wild Pokémon away from the level-100 lead.
 */
async function ceruleanCaveState(game: Game, balls = 1) {
  await afterHallOfFame(game);
  await game.eval((t, balls) => {
    t.state!.setFlag('FLAG_HIDE_CERULEAN_CAVE_GUARD', true);
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 2000);
    if (balls) t.state!.bag.add(t.define('ITEM_MASTER_BALL'), balls);
  }, balls);
}

/** On B1F below Mewtwo, facing it: talk; "Mew!" (and MUS_ENCOUNTER_GYM_LEADER), then the battle. */
async function talkToMewtwo(game: Game) {
  await game.eval(async (t) => {
    await t.walkTo(7, 13);
    await t.face('up');
  });
  const since = await game.mark();
  await game.press('A');
  expect(await foeOf(game, "Mewtwo's battle")).toEqual(['MEWTWO', 70]);
  return since;
}

const bgm = (game: Game) => game.eval((t) => t.audio().players.BGM.song as string);

test('Cerulean Cave from the entrance to B1F; Mewtwo caught with a full party goes to the PC, and stays gone', async () => {
  const party = [MEWTWO, ...['PIDGEY', 'RATTATA', 'CATERPIE', 'WEEDLE', 'SPEAROW'].map((species) => ({ species, level: 5 }))];
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity', x: 1, y: 14, party });
  await ceruleanCaveState(game);
  // The guard at (1, 13) is gone (its flag is read at load: warp in again)
  await warp(game, 'MAP_CERULEAN_CITY', 1, 14);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_COOLTRAINER_M')).not.toContainEqual([1, 13]);

  // The entrance (1, 12) → 1F at (33, 21)
  expect(await takeWarp(game, 1, 12)).toEqual(['CeruleanCave_1F', 33, 21]);
  expect(await game.eval((t) => t.flag('FLAG_WORLD_MAP_CERULEAN_CAVE_1F'))).toBe(true); // CeruleanCave_1F_OnTransition
  // 1F: north, Surf across the lake, land on the west bank, east to the ladder at (24, 11)
  await followRoute(game, [['to', 36, 13], ['surf', 'up'], ['to', 10, 15], ['land', 'down']]);
  expect(await takeWarp(game, 24, 11)).toEqual(['CeruleanCave_2F', 23, 10]);
  // 2F: west to the ladder down at (5, 6)
  expect(await takeWarp(game, 5, 6)).toEqual(['CeruleanCave_1F', 2, 4]);
  // 1F's north-west corner: the ladder down at (1, 7)
  expect(await takeWarp(game, 1, 7)).toEqual(['CeruleanCave_B1F', 5, 7]);
  // B1F: CeruleanCave_B1F_OnTransition showed Mewtwo (FLAG_FOUGHT_MEWTWO unset)
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([[7, 12]]);
  expect(await bgm(game)).toBe('MUS_ROCKET_HIDEOUT');
  // Round to the south-east shore, Surf west under the island, land below Mewtwo
  await followRoute(game, [['to', 17, 19], ['surf', 'down'], ['to', 7, 16], ['land', 'up']]);

  const since = await talkToMewtwo(game);
  // StartLegendaryBattle: BATTLE_TYPE_LEGENDARY | _LEGENDARY_FRLG behind B_TRANSITION_BLUR, MUS_VS_MEWTWO
  expect((await game.waitForEvent('battleStart', { since })).flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_LEGENDARY') | t.define('BATTLE_TYPE_LEGENDARY_FRLG')));
  expect((await game.waitForEvent('battleTransition', { since })).transition).toBe(await game.eval((t) => t.define('B_TRANSITION_BLUR')));
  expect(await bgm(game)).toBe('MUS_VS_MEWTWO');
  const sent = await throwFirstBall(game);
  expect(sent).toMatch(/MEWTWO was transferred to .*PC\. It was placed in BOX “BOX1\.”/);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_CAUGHT');
  // CB2_EndScriptedWildBattle → CB2_ReturnToFieldContinueScriptPlayMapMusic: ON_RESUME removed Mewtwo
  // (CeruleanCave_B1F_EventScript_TryRemoveMewtwo), the script sets FLAG_FOUGHT_MEWTWO and releases: no message.
  const messages = await finishScript(game);
  expect(messages.filter((m) => /flew away/.test(m))).toEqual([]);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MEWTWO'), t.flag('FLAG_HIDE_MEWTWO'), t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE')])).toEqual([true, true, false]);
  expect(await bgm(game)).toBe('MUS_ROCKET_HIDEOUT');
  expect(await game.eval((t) => t.party().length)).toBe(6);
  expect(await game.eval((t) => {
    const m = t.state!.storage.getBoxedMon(0, 0);
    return m && [t.nameOf('SPECIES_', m.species), t.state!.dexCaught.has(t.define('NATIONAL_DEX_MEWTWO'))];
  })).toEqual(['SPECIES_MEWTWO', true]);
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'CeruleanCave_B1F', x: 7, y: 13 });

  // Back up the ladder and down again: FLAG_FOUGHT_MEWTWO keeps it hidden
  await game.eval((t) => t.setAvatarState('ON_FOOT'));
  await warp(game, 'MAP_CERULEAN_CAVE_1F', 1, 8);
  expect(await takeWarp(game, 1, 7)).toEqual(['CeruleanCave_B1F', 5, 7]);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([]);
}, 600_000);

test('Mewtwo beaten: EventScript_RemoveStaticMon fades it away, and it never comes back', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCave_B1F', x: 7, y: 14, party: [MEWTWO] });
  await ceruleanCaveState(game, 0);
  const since = await talkToMewtwo(game);
  // ON_RESUME leaves it (not caught); CeruleanCave_B1F_EventScript_DefeatedMewtwo: FLAG_FOUGHT_MEWTWO, the fade
  // to black, removeobject VAR_LAST_TALKED, the fade back, no message. (Watch from before the battle's end: the
  // fade comes a few dozen ticks after it.)
  const fade = game.watch((t) => t.field()?.fading && t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_MEWTWO') && t.flag('FLAG_FOUGHT_MEWTWO') && { message: t.message() ?? null }, { what: 'the fade with Mewtwo still there', maxFrames: 60000 });
  await fightToEnd(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_WON');
  const messages = await finishScript(game);
  // (InitFieldMessageBox on the way back from the battle: "Mew!" isn't up any more)
  expect(await fade).toEqual({ message: null });
  expect(messages.filter((m) => /flew away/.test(m))).toEqual([]);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MEWTWO'), t.flag('FLAG_HIDE_MEWTWO')])).toEqual([true, true]);
  expect(await game.eval((t) => t.party().map((m: any) => m.species))).toEqual(['MEWTWO']);
  expect(await bgm(game)).toBe('MUS_ROCKET_HIDEOUT');
  await warp(game, 'MAP_CERULEAN_CAVE_B1F', 5, 7);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([]);
}, 300_000);

test('running from Mewtwo: "The MEWTWO flew away!", and it is back on the next visit', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCave_B1F', x: 7, y: 14, party: [MEWTWO] });
  await ceruleanCaveState(game, 0);
  const since = await talkToMewtwo(game);
  await runFromBattle(game);
  expect(await outcomeSince(game, since)).toBe('B_OUTCOME_RAN');
  // CeruleanCave_B1F_EventScript_RanFromMewtwo → EventScript_MonFlewAway; FLAG_FOUGHT_MEWTWO stays unset
  const messages = await finishScript(game);
  expect(messages).toContain('The MEWTWO flew away!');
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([]);
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MEWTWO'), t.flag('FLAG_HIDE_MEWTWO')])).toEqual([false, true]);
  // CeruleanCave_B1F_OnTransition: FLAG_FOUGHT_MEWTWO unset, so clearflag FLAG_HIDE_MEWTWO
  await warp(game, 'MAP_CERULEAN_CAVE_B1F', 7, 14);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([[7, 12]]);
}, 300_000);
