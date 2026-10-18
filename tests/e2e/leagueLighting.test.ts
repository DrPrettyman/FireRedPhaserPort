// The Elite Four and Champion rooms' lighting (field_specials.c, world/leagueLighting.ts): BG palette 7 cycles
// through sEliteFourLightingPalettes / sChampionRoomLightingPalettes on their timers once the player has walked in
// (FLAG_TEMP_2), the map's atlases are redrawn with it (read back from the canvas), the start menu stops it as it
// leaves the field (StopPokemonLeagueLightingEffectTask) and the return restarts it (ON_RESUME), and after the
// battle Task_CancelPokemonLeagueLightingEffect sets the last palette once FLAG_TEMP_4 is set.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'SURF'] };

/** public/gen/leagueLighting.json, the tables the port reads (tools/extract_field.py). */
const LIGHTING: { eliteFourPalettes: number[][]; championRoomPalettes: number[][]; eliteFourTimers: number[]; championRoomTimers: number[] } = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/gen/leagueLighting.json'), 'utf8'),
);

const color = (pal: number[], i: number) => pal.slice(i * 3, i * 3 + 3);

interface Change {
  tick: number;
  index: number;
  palette7: number[];
  pixel?: { rgb: number[]; colorIndex: number };
}

/**
 * Watch the running lighting task in the page for `n` palette changes: the tick of each, the palette index,
 * BG palette 7 and a canvas pixel of colour `colorIndex` drawn with palette 7, read in the tick after the load.
 */
function watchCycle(game: Game, n: number, colorIndex: number): Promise<Change[]> {
  return game.eval(
    async (t, n, colorIndex) => {
      const changes: Change[] = [];
      let tick = 0;
      let last = t.leagueLighting()?.tasks[0]?.index;
      await t.until(() => {
        tick++;
        const task = t.leagueLighting()?.tasks[0];
        if (task && task.index !== last) {
          last = task.index;
          const l = t.leagueLighting(colorIndex)!;
          changes.push({ tick, index: task.index, palette7: l.palette7!, pixel: l.pixel });
        }
        return changes.length >= n;
      }, 2000);
      return changes;
    },
    n,
    colorIndex,
  );
}

/** Each change loads the palette its index names, the atlas shows it, and comes timers[previous index] ticks after the last. */
function checkCycle(changes: Change[], palettes: number[][], timers: number[], count: number, colorIndex: number) {
  expect(changes.length).toBeGreaterThan(count);
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    expect(c.palette7, `palette ${c.index}`).toEqual(palettes[c.index]);
    expect(c.pixel, `a pixel of colour ${colorIndex} drawn with palette 7`).toBeDefined();
    expect(c.pixel!.rgb, `the atlas pixel with palette ${c.index}`).toEqual(color(palettes[c.index], colorIndex));
    if (i === 0) continue;
    const prev = changes[i - 1].index;
    expect(c.index, 'the next palette, wrapping at the count').toBe((prev + 1) % count);
    expect(c.tick - changes[i - 1].tick, `the timer after palette ${prev}`).toBe(timers[prev]);
  }
}

/** Walk to (x, y), face `dir` and press A. */
async function talkFrom(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  expect(await game.eval((t, x, y) => t.walkTo(x, y), x, y)).toMatchObject({ arrived: true });
  await game.eval((t, d) => t.face(d), dir);
  await game.press('A');
}

/** Press A until the battle has ended (won). */
async function winBattle(game: Game, what: string) {
  const since = await game.mark();
  await game.eval((_t, s) => ((window as any).__lightingSince = s), since);
  await game.mashUntil((t) => t.events((window as any).__lightingSince).some((e) => e.type === 'battleEnd'), { what, maxFrames: 200000, timeout: 280_000 });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_WON');
}

test("Lorelei's room: the cycle on its timers, the start menu stops it, the last palette after the battle", async () => {
  // A warp in (the dev start loads the map like one): ON_RESUME starts the task, ON_FRAME walks the player in.
  const game = await session.start({ start: 'after-rival', map: 'PokemonLeague_LoreleisRoom', x: 6, y: 12, party: [MEWTWO] });
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 1 && t.idle() && !t.field()!.script, { what: 'the walk in' });
  expect(await game.eval((t) => t.flag('FLAG_TEMP_2'))).toBe(true);
  expect((await game.eval((t) => t.leagueLighting()!.tasks)).map((x) => [x.func, x.count])).toEqual([['Task_RunPokemonLeagueLightingEffect', 11]]);

  // 11 palettes (0-10) on sEliteFourLightingTimers, round and back to 0
  const changes = await watchCycle(game, 13, 14);
  checkCycle(changes, LIGHTING.eliteFourPalettes, LIGHTING.eliteFourTimers, 11, 14);
  expect(changes.some((c) => c.index === 0)).toBe(true);

  // The start menu leaves it running; picking BAG stops it as the screen fades out (StartMenu_FadeScreenIfLeavingOverworld).
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  expect(await game.eval((t) => t.leagueLighting()!.tasks.length)).toBe(1);
  await game.pressTimes('DOWN', (menu.items.indexOf('BAG') - menu.cursor + menu.items.length) % menu.items.length);
  const stopped = game.eval((t) => t.until(() => t.field()?.fading === true && t.leagueLighting()!.tasks.length === 0, 600));
  await game.press('A');
  expect(await stopped).toBe(true);
  await game.waitForBag();
  // Back on the field (CB2_ReturnToFieldWithOpenMenu): ON_RESUME starts it again from palette 0, and the map's
  // palettes are reloaded (LoadMapTilesetPalettes).
  await game.press('B');
  await game.waitFor((t) => t.field()?.map === 'PokemonLeague_LoreleisRoom' && t.startMenu() && !t.field()!.fading, { what: 'the field again' });
  const back = await game.eval((t) => t.leagueLighting()!);
  expect(back.tasks.map((x) => [x.func, x.count])).toEqual([['Task_RunPokemonLeagueLightingEffect', 11]]);
  expect(back.palette7).toEqual(LIGHTING.eliteFourPalettes[0]);
  await game.press('B');
  await game.waitIdle();

  // The battle: FLAG_TEMP_3 / FLAG_TEMP_5 before it; the return runs ON_RESUME again, now the cancel task, which
  // loads the last palette when the door opens (PokemonLeague_EventScript_OpenDoor: FLAG_TEMP_4).
  await talkFrom(game, 6, 6, 'up');
  await winBattle(game, 'Lorelei');
  await game.mashUntil((t) => t.flag('FLAG_TEMP_4') && t.idle() && !t.field()!.script, { what: 'the door opening', button: 'B' });
  const after = await game.eval(async (t) => {
    const first = t.leagueLighting(3)!;
    await t.waitFrames(60);
    return { first, later: t.leagueLighting(3)! };
  });
  const last = LIGHTING.eliteFourPalettes[11];
  expect(after.first.tasks).toEqual([]);
  expect(after.first.palette7).toEqual(last);
  expect(after.first.pixel!.rgb).toEqual(color(last, 3));
  expect(after.later.palette7).toEqual(last);
}, 400_000);

test("The Champion's room: the faster cycle during the rival's speech, the last palette after the battle", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonLeague_ChampionsRoom', x: 6, y: 19, party: [{ ...MEWTWO, moves: ['PSYCHIC'] }], speed: 16 });
  // PokemonLeague_ChampionsRoom_EventScript_EnterRoom: FLAG_TEMP_2, the walk in, the rival's intro (the message waits)
  await game.waitFor((t) => t.flag('FLAG_TEMP_2') && !!t.message(), { what: "the rival's intro", timeout: 60_000 });
  expect((await game.eval((t) => t.leagueLighting()!.tasks)).map((x) => [x.func, x.count])).toEqual([['Task_RunPokemonLeagueLightingEffect', 8]]);
  const changes = await watchCycle(game, 10, 14);
  checkCycle(changes, LIGHTING.championRoomPalettes, LIGHTING.championRoomTimers, 8, 14);

  // After the battle the script sets FLAG_TEMP_4 at once: the last palette, the task gone. (The rival's team is
  // left at 1 HP once the battle has started, so the battle is short; with one move, Struggle once its PP is gone.)
  const since = await game.mark();
  const weakened = game.eval((t, since) =>
    t.until(() => t.events(since).some((e) => e.type === 'battleStart'), 20000).then(() => t.state!.enemyParty.forEach((m) => (m.hp = 1))),
  since);
  await winBattle(game, 'the Champion');
  await weakened;
  const last = LIGHTING.championRoomPalettes[8];
  const after = await game.eval((t) =>
    t.until(() => t.flag('FLAG_TEMP_4') && t.leagueLighting()!.tasks.length === 0, 20000).then(() => ({ map: t.field()!.map, l: t.leagueLighting(3)! })),
  );
  expect(after.map).toBe('PokemonLeague_ChampionsRoom');
  expect(after.l.palette7).toEqual(last);
  expect(after.l.pixel!.rgb).toEqual(color(last, 3));
}, 400_000);
