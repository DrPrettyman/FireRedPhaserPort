// Seven Island, played (POSTGAME_PLAN.md W-sevii unit 5): the ferry from Three Island with the Rainbow Pass, the
// town, a Tanoby chamber dark and empty while the ruins are locked (EventScript_TryDarkenRuins, wild_encounter.c's
// UnlockedTanobyOrAreNotInTanoby), Sevault Canyon's Tanoby Key (the Strength boulders onto the seven floor switches:
// HandleBoulderActivateVictoryRoadSwitch runs SevenIsland_SevaultCanyon_TanobyKey_EventScript_Switch1-7, each with
// a ShakeScreen, the last with PuzzleSolvedShakeScreen's two; FLAG_SYS_UNLOCKED_TANOBY_RUINS), the chamber lit
// afterwards with its Unown (GenerateWildMon's sUnownLetterSlots), and Altering Cave's Zubat. Warps skip the walking
// between scenes, as postgame.test.ts does.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { checkRide, sail, talkToHarborSailor, waitForMenu } from './seagallopHelpers';
import { afterHallOfFame, battlesSince, MEWTWO, rainbowPassState, SCENE, scriptsSince, warp } from './postgameHelpers';

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

/** sUnownLetterSlots (wild_encounter.c), one row per chamber in map number order: the letter of land slots 0-11. */
const CHAMBERS: [string, string][] = [
  ['MoneanChamber', 'AAAAAAAAAAA?'],
  ['LiptooChamber', 'CCCDDDHHHUUO'],
  ['WeepthChamber', 'NNNNSSSSIIEE'],
  ['DilfordChamber', 'PPLLJJRRRQQQ'],
  ['ScufibChamber', 'YYTTGGGFFFKK'],
  ['RixyChamber', 'VVVWWWXXMMBB'],
  ['ViapoisChamber', 'ZZZZZZZZZZZ!'],
];

test('the seven chambers: dark while the ruins are locked, then lit, each with its own Unown letters by slot', async () => {
  // Start inside a chamber, not on the ruins: a ruins trainer could spot the player as the dev start loads, and the
  // test's warp would then carry EventScript_DoTrainerBattleFromApproach into the chamber (the end-of-batch run hit it)
  const game = await session.start({ start: 'after-rival', map: 'SevenIsland_TanobyRuins_MoneanChamber', x: 11, y: 15, party: [MEWTWO] });
  await game.waitIdle();
  for (const unlocked of [false, true]) {
    await game.eval((t, u) => t.state!.setFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS', u), unlocked);
    for (const [chamber, letters] of CHAMBERS) {
      const map = `SevenIsland_TanobyRuins_${chamber}`;
      await warp(game, mapJson(map).id, 11, 15);
      await game.waitFor((t) => t.idle() && t.weather()!.palProcessingState === 3, { what: map });
      expect(await game.eval((t) => [t.field()!.map, t.weather()!.savedWeather]), map).toEqual([map, unlocked ? WEATHER_NONE : WEATHER_SHADE]);
      if (!unlocked) continue;
      // GenerateWildMon for each land slot: the personality's letter (GenerateUnownPersonalityByLetter)
      const personalities = await game.eval((t) => {
        const wild = (window as any).game.scene.getScene('Overworld').wild;
        return Array.from({ length: 12 }, (_, slot) => {
          wild.generateWildMon(t.define('SPECIES_UNOWN'), 25, slot);
          return wild.enemy.personality as number;
        });
      });
      expect(personalities.map(unownLetter).join(''), map).toBe(letters);
    }
  }
}, 300_000);

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

// ---- The sweep: every trainer, item, NPC and sign of Seven Island, Sevault Canyon and its entrance, the Tanoby
// Ruins and the Trainer Tower's path, against the decomp's map events and texts.

/** Two level-100 Mewtwo with Surf first: nothing out here resists it into a stall (PSYCHIC would leave Dark types). */
const SWEEPER = { species: 'MEWTWO', level: 100, moves: ['SURF', 'PSYCHIC'] };

interface MapJson {
  id: string;
  width: number;
  height: number;
  blocks: number[];
  objectEvents: { x: number; y: number; script: string; graphics_id: string }[];
}
const MAPS: Record<string, MapJson> = {};
function mapJson(name: string): MapJson {
  return (MAPS[name] ??= JSON.parse(readFileSync(resolve(__dirname, `../../public/gen/maps/${name}.json`), 'utf8')));
}

/** A free cell next to (x, y) on the map (no collision, no object), and the way to face from it. */
function standBy(name: string, x: number, y: number): [number, number, Dir] {
  const m = mapJson(name);
  const taken = new Set(m.objectEvents.map((o) => `${o.x},${o.y}`));
  const free = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < m.width && cy < m.height && ((m.blocks[cy * m.width + cx] >> 10) & 3) === 0 && !taken.has(`${cx},${cy}`);
  for (const [dx, dy, dir] of [[0, 1, 'up'], [-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down']] as const) if (free(x + dx, y + dy)) return [x + dx, y + dy, dir];
  throw new Error(`nowhere to stand by (${x}, ${y}) on ${name}`);
}

/**
 * Warp beside what is at (x, y) on `map` (an object: its local id is its index + 1, and a wandering one is
 * followed; else a sign or hidden item), face it and press A, then press A until the field is free again (and
 * `trainer` is defeated, when given). Returns the messages seen and the battles' trainer ids.
 */
async function interact(game: Game, map: string, x: number, y: number, trainer?: string, answers: [RegExp, 'B'][] = []) {
  const m = mapJson(map);
  const index = m.objectEvents.findIndex((o) => o.x === x && o.y === y);
  const [sx, sy] = standBy(map, x, y);
  await warp(game, m.id, sx, sy);
  const since = await game.mark();
  await game.eval(
    async (t, localId, x, y) => {
      // The field can be held for a tick or two after the warp helper saw it idle (the full run of batch 11 caught
      // it so: this returned at once, nothing was read and the sign's message was missing); wait for it.
      await t.until(() => t.idle() || !!t.field()!.script, 600);
      if (t.field()!.script || !t.idle()) return; // a trainer saw the player
      const target = () => {
        const o = localId ? t.objects().find((o) => o.localId === localId) : undefined;
        return o ? [o.x, o.y] : [x, y];
      };
      for (let attempt = 0; attempt < 8; attempt++) {
        const [tx, ty] = target();
        const f = t.field()!;
        if (Math.abs(f.x - tx) + Math.abs(f.y - ty) !== 1) {
          for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
            try {
              if ((await t.walkTo(tx + dx, ty + dy)).arrived) break;
            } catch {
              // no route to that side
            }
          }
          if (t.field()!.script || !t.idle()) return;
        }
        const [ox, oy] = target();
        const g = t.field()!;
        if (Math.abs(g.x - ox) + Math.abs(g.y - oy) !== 1) continue;
        await t.face(ox < g.x ? 'left' : ox > g.x ? 'right' : oy < g.y ? 'up' : 'down');
        await t.press('A');
        if (await t.until(() => !!t.field()!.script || !t.idle(), 30)) return;
      }
      throw new Error(`could not talk to (${x}, ${y})`);
    },
    index >= 0 ? index + 1 : 0,
    x,
    y,
  );
  await game.eval((_t, trainer) => ((window as any).__trainer = trainer), trainer ?? '');
  const r = await game.eval(
    (t, answers) =>
      (t as any).mash((u: any) => u.idle() && !u.field()!.script && !u.battle() && (!(window as any).__trainer || u.trainerDefeated((window as any).__trainer)), 'A', 40000, answers),
    answers.map(([re, b]) => [re.source, re.flags, b]),
  );
  expect(r.value, `${map} (${x}, ${y}): the field free again${trainer ? `, ${trainer} defeated` : ''}`).toBeTruthy();
  return { messages: (r.messages as string[]).map((s) => s.replace(/\s+/g, ' ')), battles: await battlesSince(game, since) };
}

async function sweepStart(map: string, x: number, y: number) {
  const game = await session.start({ start: 'after-rival', map, x, y, party: [SWEEPER, SWEEPER] });
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => {
    t.state!.battleSceneOff = true;
    t.state!.battleStyleSet = true; // no "Will you change POKéMON?" with two in the party
  });
  return game;
}

/** Fight the trainer at (x, y): one battle against TRAINER_<trainer>, which is then defeated. */
async function fight(game: Game, map: string, x: number, y: number, trainer: string) {
  // HealPlayerParty first (Surf's PP last a few battles)
  await game.eval((t) => {
    const s = t.state!;
    for (const mon of s.party) {
      mon.hp = mon.maxHP;
      for (let j = 0; j < 4; j++) mon.pp[j] = s.pokemon.ppWithBonus(mon.moves[j], mon.ppBonuses, j);
      mon.status = 0;
    }
  });
  const { battles } = await interact(game, map, x, y, trainer);
  expect(battles, `${trainer}'s battle`).toEqual([await game.eval((t, n) => t.define(`TRAINER_${n}`), trainer)]);
}

/** An item ball or hidden item at (x, y): `item` +1 in the bag and its flag set. */
async function pickUp(game: Game, map: string, x: number, y: number, item: string, flag: string) {
  const before = await game.eval((t, i) => t.itemCount(i), item);
  const { messages } = await interact(game, map, x, y);
  expect(await game.eval((t, i, f) => [t.itemCount(i), t.flag(f)], item, flag), `${item} at (${x}, ${y})`).toEqual([before + 1, true]);
  return messages;
}

/** Talk to (or read) what is at (x, y): the first message matches `text`. */
async function read(game: Game, map: string, x: number, y: number, text: RegExp) {
  const { messages } = await interact(game, map, x, y);
  expect(messages[0], `${map} (${x}, ${y})`).toMatch(text);
  return messages;
}

test('Seven Island: the town, its Mart, Pokémon Center and house, the Swords Dance tutor', async () => {
  const game = await sweepStart('SevenIsland', 12, 10);
  await read(game, 'SevenIsland', 17, 9, /^SEVEN ISLAND/);
  await read(game, 'SevenIsland', 9, 7, /^These islands are called the SEVII/);
  await read(game, 'SevenIsland', 15, 5, /^This island has been left virtually/);
  // NO to the tutor (B on the YES / NO)
  const tutor = await interact(game, 'SevenIsland', 7, 18, undefined, [[/It's SWORDS DANCE/, 'B']]);
  expect(tutor.messages[0]).toMatch(/^Not many people come out here\./);
  expect(tutor.messages.at(-1)).toMatch(/^Well, that['’]s fine, too\./);
  expect(await game.eval((t) => t.flag('FLAG_TUTOR_SWORDS_DANCE'))).toBe(false);

  await read(game, 'SevenIsland_Mart', 6, 2, /^POKéMON have personalities of their/);
  await read(game, 'SevenIsland_Mart', 5, 4, /^Okay, preparations are complete/);
  await read(game, 'SevenIsland_Mart', 9, 5, /^I need to fish on SEVEN ISLAND\./);
  await read(game, 'SevenIsland_PokemonCenter_1F', 11, 5, /^On this island, different events/);
  await read(game, 'SevenIsland_PokemonCenter_1F', 14, 6, /^Did you ride a SEAGALLOP ferry/);
  await read(game, 'SevenIsland_PokemonCenter_1F', 4, 4, /^If you['’]re confident, you should/);
  // The house: no e-Reader trainer (ValidateEReaderTrainer fails), so the old woman only reminisces
  await read(game, 'SevenIsland_House_Room1', 4, 4, /^I may not look like much now,/);
  // ValidateEReaderTrainer's VAR_RESULT 1 kept the plain layout (no SetTrainerVisitingLayout)
  expect(await game.eval((t) => [t.var('VAR_TEMP_1'), t.state!.mapLayoutId === t.define('LAYOUT_SEVEN_ISLAND_HOUSE_ROOM1')])).toEqual([0, true]);
  await read(game, 'SevenIsland_House_Room1', 4, 1, /^There is a slight breeze blowing/);
}, 300_000);

test("Sevault Canyon and its entrance: the trainers, the items, the Black Belt, the Chansey Dance", async () => {
  const game = await sweepStart('SevenIsland_SevaultCanyon_Entrance', 9, 10);
  const E = 'SevenIsland_SevaultCanyon_Entrance';
  await read(game, E, 14, 26, /^SEVAULT CANYON ENTRANCE/);
  await fight(game, E, 12, 6, 'AROMA_LADY_MIAH');
  await fight(game, E, 3, 34, 'YOUNG_COUPLE_EVE_JON');
  await fight(game, E, 11, 26, 'PKMN_RANGER_NICOLAS');
  await fight(game, E, 10, 26, 'PKMN_RANGER_MADELINE');
  await fight(game, E, 11, 17, 'JUGGLER_MASON');
  await pickUp(game, E, 8, 29, 'RAWST_BERRY', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_SEVAULT_CANYON_ENTRANCE_RAWST_BERRY');

  const C = 'SevenIsland_SevaultCanyon';
  await read(game, C, 16, 71, /^SEVAULT CANYON/);
  await fight(game, C, 13, 43, 'CRUSH_GIRL_CYNDY');
  await fight(game, C, 13, 36, 'TAMER_EVAN');
  await fight(game, C, 3, 35, 'PKMN_RANGER_JACKSON');
  await fight(game, C, 3, 36, 'PKMN_RANGER_KATELYN');
  await fight(game, C, 7, 56, 'COOLTRAINER_LEROY');
  await fight(game, C, 11, 63, 'COOLTRAINER_MICHELLE');
  await fight(game, C, 14, 13, 'COOL_COUPLE_LEX_NYA');
  await pickUp(game, C, 18, 45, 'KINGS_ROCK', 'FLAG_HIDE_SEVEN_ISLAND_SEVAULT_CANYON_KINGS_ROCK');
  await pickUp(game, C, 7, 38, 'MAX_ELIXIR', 'FLAG_HIDE_SEVEN_ISLAND_SEVAULT_CANYON_MAX_ELIXIR');
  await pickUp(game, C, 17, 23, 'NUGGET', 'FLAG_HIDE_SEVEN_ISLAND_SEVAULT_CANYON_NUGGET');
  await pickUp(game, C, 15, 66, 'CHERI_BERRY', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_SEVAULT_CANYON_CHERI_BERRY');
  // The Black Belt: famechecker FAMECHECKER_BRUNO, 5
  await read(game, C, 8, 26, /^Training by oneself is certainly/);

  // The house: the Lucky Punch, the Chansey, the Chansey Dance (YES: the party healed, FLAG_TEMP_2)
  const H = 'SevenIsland_SevaultCanyon_House';
  await pickUp(game, H, 6, 4, 'LUCKY_PUNCH', 'FLAG_HIDE_SEVEN_ISLAND_SEVAULT_CANYON_HOUSE_LUCKY_PUNCH');
  await read(game, H, 4, 2, /^CHANSEY: Chansi! Chansi!/);
  await game.eval((t) => {
    const mon = t.state!.party[0];
    mon.hp = 1;
  });
  const dance = await read(game, H, 2, 4, /^Dance, dance!/);
  expect(dance).toEqual(expect.arrayContaining([expect.stringMatching(/^Would you like to dance\?/), expect.stringMatching(/danced the CHANSEY Dance!/), expect.stringMatching(/^Ahahahaha!/)]));
  expect(await game.eval((t) => [t.party()[0].hp === t.party()[0].maxHP, t.flag('FLAG_TEMP_2')])).toEqual([true, true]);
}, 600_000);

test("The Tanoby Ruins and the Trainer Tower's path: the trainers, the hidden items, the signs", async () => {
  const game = await sweepStart('SevenIsland_TanobyRuins', 120, 11);
  const R = 'SevenIsland_TanobyRuins';
  await fight(game, R, 35, 7, 'RUIN_MANIAC_BRANDON');
  await fight(game, R, 121, 11, 'RUIN_MANIAC_BENJAMIN');
  await fight(game, R, 85, 8, 'PAINTER_EDNA');
  await fight(game, R, 85, 5, 'GENTLEMAN_CLIFFORD');
  // The Tanoby Ruins' and the Trainer Tower path's Heart Scales and pearls are renewable (renewable_hidden_items.c):
  // hidden from the new game on until a regeneration brings their group back, so they're put back here as one would.
  await game.eval((t) => {
    for (const f of ['TANOBY_RUINS_HEART_SCALE', 'TANOBY_RUINS_HEART_SCALE_2', 'TANOBY_RUINS_HEART_SCALE_3', 'TANOBY_RUINS_HEART_SCALE_4', 'TRAINER_TOWER_BIG_PEARL', 'TRAINER_TOWER_PEARL']) {
      t.state!.setFlag(`FLAG_HIDDEN_ITEM_SEVEN_ISLAND_${f}`, false);
    }
  });
  await pickUp(game, R, 33, 10, 'HEART_SCALE', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TANOBY_RUINS_HEART_SCALE');
  await pickUp(game, R, 86, 9, 'HEART_SCALE', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TANOBY_RUINS_HEART_SCALE_2');
  await pickUp(game, R, 125, 5, 'HEART_SCALE', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TANOBY_RUINS_HEART_SCALE_3');
  await pickUp(game, R, 8, 2, 'HEART_SCALE', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TANOBY_RUINS_HEART_SCALE_4');

  const T = 'SevenIsland_TrainerTower';
  await fight(game, T, 56, 26, 'PSYCHIC_DARIO');
  await fight(game, T, 56, 29, 'PSYCHIC_RODETTE');
  await pickUp(game, T, 49, 27, 'BIG_PEARL', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TRAINER_TOWER_BIG_PEARL');
  await pickUp(game, T, 47, 30, 'PEARL', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TRAINER_TOWER_PEARL');
  await pickUp(game, T, 59, 32, 'NANAB_BERRY', 'FLAG_HIDDEN_ITEM_SEVEN_ISLAND_TRAINER_TOWER_NANAB_BERRY');
  await read(game, T, 56, 8, /^TRAINER TOWER ENTRANCE/);
  await read(game, T, 50, 30, /^TRAINER TOWER AHEAD/);
  // SevenIsland_TrainerTower_OnTransition: VAR_MAP_SCENE_TRAINER_TOWER 0
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_TRAINER_TOWER'))).toBe(0);
}, 600_000);
