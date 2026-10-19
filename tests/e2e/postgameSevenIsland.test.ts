// Seven Island, played (POSTGAME_PLAN.md W-sevii unit 5): the ferry from Three Island with the Rainbow Pass, the
// town, a Tanoby chamber dark and empty while the ruins are locked (EventScript_TryDarkenRuins, wild_encounter.c's
// UnlockedTanobyOrAreNotInTanoby), Sevault Canyon's Tanoby Key (the Strength boulders onto the seven floor switches:
// HandleBoulderActivateVictoryRoadSwitch runs SevenIsland_SevaultCanyon_TanobyKey_EventScript_Switch1-7, each with
// a ShakeScreen, the last with PuzzleSolvedShakeScreen's two; FLAG_SYS_UNLOCKED_TANOBY_RUINS), the chamber lit
// afterwards with its Unown (GenerateWildMon's sUnownLetterSlots), and Altering Cave's Zubat. Warps skip the walking
// between scenes, as postgame.test.ts does.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { checkRide, sail, talkToHarborSailor, waitForMenu } from './seagallopHelpers';
import { afterHallOfFame, MEWTWO, rainbowPassState, SCENE, scriptsSince, warp } from './postgameHelpers';

const session = useGame();

type Dir = 'up' | 'down' | 'left' | 'right';

const WEATHER_NONE = 0;
const WEATHER_SHADE = 11;

/**
 * A solution of the Tanoby Key's boulder puzzle (map-local): stand on [x, y], push the boulder ahead towards `dir`.
 * The seven boulders start at LOCALID_TANOBY_KEY_BOULDER1-7's (7, 6), (8, 6), (8, 9), (6, 10), (8, 10), (6, 9), (6, 6)
 * and end on the switches SevenIsland_SevaultCanyon_TanobyKey_EventScript_MoveBouldersToSolvedPos puts them on.
 * (Worked out with a search over the map's collision; no push takes a boulder off a switch.)
 */
const PUSHES: [number, number, Dir][] = [
  [7, 10, 'right'],
  [9, 11, 'up'],
  [8, 10, 'up'],
  [7, 10, 'left'],
  [5, 11, 'up'],
  [9, 10, 'up'],
  [5, 10, 'up'],
  [6, 10, 'up'],
  [7, 7, 'up'],
  [7, 6, 'right'],
  [7, 6, 'up'],
  [7, 5, 'up'],
  [7, 4, 'up'],
  [5, 6, 'right'],
  [7, 7, 'up'],
  [7, 6, 'up'],
  [8, 4, 'left'],
  [7, 4, 'left'],
  [6, 4, 'left'],
  [6, 9, 'up'],
  [6, 8, 'up'],
  [5, 6, 'right'],
  [7, 7, 'up'],
  [7, 6, 'up'],
  [6, 4, 'right'],
  [7, 4, 'right'],
  [8, 4, 'right'],
  [8, 7, 'down'],
  [9, 9, 'left'],
  [7, 10, 'up'],
  [8, 8, 'left'],
  [6, 9, 'up'],
  [6, 8, 'up'],
  [7, 6, 'left'],
];

/** The switches (the map's coord events) and the boulders' solved positions (MoveBouldersToSolvedPos). */
const SWITCHES = [
  [7, 2],
  [4, 4],
  [10, 4],
  [5, 6],
  [9, 6],
  [5, 8],
  [9, 8],
];

/** The map's boulders (map-local), sorted. */
function boulders(game: Game) {
  return game.eval((t) =>
    t
      .objects()
      .filter((o) => o.graphicsId === 'OBJ_EVENT_GFX_PUSHABLE_BOULDER')
      .map((o) => [o.x, o.y])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  );
}

/** Face `dir` and walk into the boulder there until it moves (Task_BumpBoulder), then wait for the field. */
async function push(game: Game, dir: Dir) {
  const button = dir.toUpperCase() as 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  // Hold, watch and release in one eval (strength.test.ts)
  const pushed = await game.eval(async (t, b, a) => {
    t.hold(b);
    const ok = await t.until(() => t.field()?.avatar.action === a, 60);
    t.release();
    return ok;
  }, button, `WALK_IN_PLACE_NORMAL_${button}`);
  expect(pushed, `push ${dir}`).toBe(true);
  // The boulder's move, then a switch's script if it landed on one
  await game.eval((t) => t.until(() => !t.objects().some((o) => o.moving) && t.idle() && !t.field()!.script, 2000));
}

/** The wild mon the battle started with: species and personality (gEnemyParty[0]). */
function enemy(game: Game) {
  return game.eval(async () => {
    const env = await new Function("return import('/src/battle/env.ts')")();
    const mon = env.g.enemyParty[0];
    return { species: mon.species as number, personality: mon.personality as number };
  });
}

/** GET_UNOWN_LETTER (pokemon.h), worked out here from the personality's bytes: 0 = A ... 25 = Z, 26 = !, 27 = ?. */
function unownLetter(p: number) {
  const n = (((p >>> 24) & 3) << 6) | (((p >>> 16) & 3) << 4) | (((p >>> 8) & 3) << 2) | (p & 3);
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!?'[n % 28];
}

/**
 * From a chamber's entrance (11, 15): a step up, then up and down until a wild battle starts (true) or `steps` steps
 * went by without one.
 */
async function walkForEncounter(game: Game, steps: number) {
  await game.walk('up');
  return game.eval(async (t, steps) => {
    const s0 = t.lastSeq();
    for (let i = 0; i < steps; i++) {
      await t.walk(i % 2 ? 'down' : 'up', 1);
      if (t.events(s0).some((e) => e.type === 'battleStart')) return true;
      await t.until(() => t.idle() || t.events(s0).some((e) => e.type === 'battleStart'), 600);
      if (t.events(s0).some((e) => e.type === 'battleStart')) return true;
    }
    return false;
  }, steps);
}

test('Seven Island: the ferry, a dark Tanoby chamber, the Tanoby Key puzzle and its shakes, the lit chamber and its Unown', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ThreeIsland_Harbor', x: 8, y: 5, party: [MEWTWO] });
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => {
    t.state!.battleSceneOff = true;
  });
  let since = 0;

  // Three Island's sailor with the Rainbow Pass (DrawSeagallopDestinationMenu): page 1 VERMILION, ONE, TWO, FOUR
  // ISLAND, OTHER, EXIT; OTHER → page 2 (VAR_0x8005 1) FIVE, SIX, SEVEN ISLAND, OTHER, EXIT. Three → Seven is HI-SPEED 6.
  expect(await talkToHarborSailor(game)).toBe(255);
  await game.pressTimes('DOWN', 4);
  since = await game.mark();
  await game.press('A');
  expect(await waitForMenu(game, since, false)).toBe(255);
  await game.pressTimes('DOWN', 2);
  await game.press('A');
  const ride = await sail(game, 'Three → Seven Island', 6);
  checkRide(ride.frames, true);
  expect(ride.map).toBe('SevenIsland_Harbor');

  // Up the pier onto Seven Island: SevenIsland_OnTransition's setworldmapflag
  await game.eval((t) => t.until(() => t.idle(), 20000));
  since = await game.mark();
  await game.walk('up', 3);
  await game.waitForEvent('map', { since, what: 'SevenIsland' });
  await game.waitIdle();
  expect(await game.eval((t) => [t.field()!.map, t.flag('FLAG_WORLD_MAP_SEVEN_ISLAND')])).toEqual(['SevenIsland', true]);

  // The ruins, still locked: the Liptoo Chamber's ON_TRANSITION runs EventScript_TryDarkenRuins (setweather
  // WEATHER_SHADE, doweather), and UnlockedTanobyOrAreNotInTanoby keeps its Unown away.
  await warp(game, 'MAP_SEVEN_ISLAND_TANOBY_RUINS', 103, 11);
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 0));
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'the Liptoo Chamber' });
  await game.waitFor((t) => t.field()?.map === 'SevenIsland_TanobyRuins_LiptooChamber' && t.idle() && t.weather()!.palProcessingState === 3, { what: 'the chamber, idle' });
  expect(await game.eval((t) => [t.weather()!.savedWeather, t.weather()!.currWeather, t.weather()!.gammaIndex])).toEqual([WEATHER_SHADE, WEATHER_SHADE, 3]);
  expect(await walkForEncounter(game, 40), 'no wild battle in a locked chamber').toBe(false);

  // Sevault Canyon → the Tanoby Key (its ON_TRANSITION: the world map flag, VAR_TEMP_1-8 zeroed)
  await warp(game, 'MAP_SEVEN_ISLAND_SEVAULT_CANYON', 7, 18);
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'the Tanoby Key' });
  await game.waitIdle();
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y, t.flag('FLAG_WORLD_MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY')])).toEqual([
    'SevenIsland_SevaultCanyon_TanobyKey',
    7,
    13,
    true,
  ]);
  expect(await boulders(game)).toEqual([
    [6, 6],
    [6, 9],
    [6, 10],
    [7, 6],
    [8, 6],
    [8, 9],
    [8, 10],
  ]);

  // Strength from a boulder (EventScript_StrengthBoulder: YES)
  await game.eval(async (t) => {
    await t.walkTo(5, 10);
    await t.face('right');
  });
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_SYS_USE_STRENGTH') && t.idle() && !t.field()!.script, { what: 'Strength' });

  // Every tick from the first push to the end: SetCameraPanning's offsets
  const pans = game.watch(
    (t) => {
      const w = ((window as any).__pans ??= []) as [number, number][];
      const f = t.field();
      if (f) w.push([f.avatar.cameraPanX, f.avatar.cameraPanY]);
      return t.flag('FLAG_SYS_UNLOCKED_TANOBY_RUINS') && t.idle() && !f?.script && w;
    },
    { what: 'the puzzle solved', maxFrames: 100000 },
  );
  since = await game.mark();
  for (const [i, [x, y, dir]] of PUSHES.entries()) {
    await game.eval(async (t, x, y) => {
      await t.walkTo(x, y);
    }, x, y);
    expect(await game.eval((t) => [t.field()!.x, t.field()!.y]), `push ${i}: the spot`).toEqual([x, y]);
    await push(game, dir);
    expect(await game.eval((t) => t.flag('FLAG_SYS_UNLOCKED_TANOBY_RUINS')), `push ${i}`).toBe(false);
  }
  // The last switch's script: PuzzleSolvedShakeScreen, the message, FLAG_SYS_UNLOCKED_TANOBY_RUINS
  await game.waitFor((t) => /A mysterious rumble echoed\s+somewhere far away\./.test(t.message() ?? ''), { what: 'the rumble', timeout: 120_000 });
  expect(await game.eval((t) => t.flag('FLAG_SYS_UNLOCKED_TANOBY_RUINS'))).toBe(false);
  await game.mashUntil((t) => t.flag('FLAG_SYS_UNLOCKED_TANOBY_RUINS') && t.idle() && !t.field()!.script, { what: 'the puzzle solved' });
  expect(await boulders(game)).toEqual([...SWITCHES].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  expect(await game.eval((t) => [1, 2, 3, 4, 5, 6, 7].map((n) => t.var(`VAR_TEMP_${n}`)).concat(t.var('VAR_TEMP_8')))).toEqual([100, 100, 100, 100, 100, 100, 100, 7]);
  const labels = await scriptsSince(game, since);
  for (let n = 1; n <= 7; n++) expect(labels).toContain(`SevenIsland_SevaultCanyon_TanobyKey_EventScript_Switch${n}`);

  // ShakeScreen: each switch (VAR_0x8004 1, 0x8005 1, 0x8006 8, 0x8007 3) pans the view 1 px up-left / down-right
  // every 3 frames; Task_ShakeScreen's 8th flip goes straight back to the standard pan. The last switch then shakes
  // twice more (2, 2, 10, 3 and 3, 3, 12, 2), 60 frames apart.
  const shake = (v: number, flips: number, frames: number) => Array.from({ length: (flips - 1) * frames }, (_, i) => (Math.floor(i / frames) % 2 ? v : -v));
  const runs: [number[], number[]][] = [];
  let run: [number[], number[]] | undefined;
  for (const [x, y] of await pans) {
    if (x !== 0 || y !== 0) (run ??= [[], []]), run[0].push(x), run[1].push(y);
    else if (run) runs.push(run), (run = undefined);
  }
  const one = shake(1, 8, 3);
  expect(runs).toEqual([...Array(7).fill([one, one]), [shake(2, 10, 3), shake(2, 10, 3)], [shake(3, 12, 2), shake(3, 12, 2)]]);
  const ses = await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name as string), since);
  expect(ses.filter((n) => n === 'SE_TRUCK_MOVE').length).toBe(7);
  expect(ses.filter((n) => n === 'SE_LAVARIDGE_FALL_WARP').length).toBe(1);
  // the 34 pushes' SE_M_STRENGTH and the 9 shakes'
  expect(ses.filter((n) => n === 'SE_M_STRENGTH').length).toBe(PUSHES.length + 9);

  // Back in: the boulders stay on the switches (MoveBouldersToSolvedPos)
  since = await game.mark();
  await game.eval(async (t) => {
    await t.walkTo(7, 13);
  });
  await game.walk('down');
  await game.waitForEvent('map', { since, what: 'Sevault Canyon' });
  await game.waitIdle();
  // (on the cave mouth's warp at (7, 17): a step off it and back)
  await game.walk('down');
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'the Tanoby Key again' });
  await game.waitIdle();
  expect(await boulders(game)).toEqual([...SWITCHES].sort((a, b) => a[0] - b[0] || a[1] - b[1]));

  // The Liptoo Chamber again: lit (TryDarkenRuins returns at once; the header's WEATHER_NONE), and its Unown: slots
  // 0-11 are C C C D D D H H H U U O (sUnownLetterSlots[1])
  await warp(game, 'MAP_SEVEN_ISLAND_TANOBY_RUINS', 103, 11);
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'the Liptoo Chamber' });
  await game.waitFor((t) => t.field()?.map === 'SevenIsland_TanobyRuins_LiptooChamber' && t.idle() && t.weather()!.palProcessingState === 3, { what: 'the chamber, idle' });
  expect(await game.eval((t) => [t.weather()!.savedWeather, t.weather()!.currWeather, t.weather()!.gammaIndex])).toEqual([WEATHER_NONE, WEATHER_NONE, 0]);
  await game.eval((t) => t.seed(7));
  expect(await walkForEncounter(game, 200), 'a wild battle in the unlocked chamber').toBe(true);
  await game.waitFor((t) => (t.battle()?.mons[1]?.species ?? 'NONE') !== 'NONE', { what: 'the battle' });
  const mon = await enemy(game);
  expect(mon.species).toBe(await game.eval((t) => t.define('SPECIES_UNOWN')));
  expect('CDHUO').toContain(unownLetter(mon.personality));
  // Its letter's own front pic (LoadSpecialPokePic) was loaded with the battle; away again
  await game.chooseAction('RUN');
  await game.mashUntil((t) => t.idle() && !t.battle() && t.field()?.map === 'SevenIsland_TanobyRuins_LiptooChamber', { what: 'back in the chamber', ...SCENE });
}, 600_000);

test("Altering Cave: Zubat only (VAR_ALTERING_CAVE_WILD_SET 0's table)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'SixIsland_AlteringCave', x: 18, y: 21, party: [MEWTWO] });
  await game.waitIdle();
  expect(await game.eval((t) => [t.var('VAR_ALTERING_CAVE_WILD_SET'), t.flag('FLAG_WORLD_MAP_SIX_ISLAND_ALTERING_CAVE')])).toEqual([0, true]);
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 0));
  const species: string[] = [];
  for (let i = 0; i < 3; i++) {
    await game.eval((t, i) => t.seed(100 + i), i);
    const found = await game.eval(async (t) => {
      const s0 = t.lastSeq();
      for (let i = 0; i < 300; i++) {
        await t.walk(i % 2 ? 'down' : 'up', 1);
        await t.until(() => t.idle() || t.events(s0).some((e) => e.type === 'battleStart'), 600);
        if (t.events(s0).some((e) => e.type === 'battleStart')) return true;
      }
      return false;
    });
    expect(found).toBe(true);
    species.push(await game.waitFor((t) => (t.battle()?.mons[1]?.species ?? 'NONE') !== 'NONE' && t.battle()!.mons[1].species, { what: 'the battle' }));
    await game.mashUntil((t) => t.idle() && !t.battle(), { what: 'the battle over', ...SCENE });
  }
  expect(species).toEqual(['ZUBAT', 'ZUBAT', 'ZUBAT']);
}, 300_000);
