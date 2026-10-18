// Small side specials (SIDE_PLAN.md W-misc): falling through a hole (EventScript_DoFallWarp, DoFallWarp,
// FieldCB_FallWarpExit), Daisy's grooming, the Route 12 Magikarp size record, the diploma, and the rest of
// script/miscSpecials.ts.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Press A until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string, button: 'A' | 'B' = 'A'): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__sideRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__sideRe.test(t.message() ?? '') && t.message(), { what, button })) as string;
}

/** Press B until the script has ended and the field is free. */
const scriptDone = (game: Game, what: string) => game.mashUntil((t) => t.idle() && !t.field()!.script, { what, button: 'B' });

// ---------------------------------------------------------------- falling through a hole

test('falling through a hole in the Pokémon Mansion lands on the floor below', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonMansion_3F', x: 18, y: 17, party: [MEWTWO] });
  // Watched in the page: the drop lasts a few dozen ticks.
  const dropped = game.watch((t) => {
    const f = t.field();
    return f?.map === 'PokemonMansion_1F' && f.playerVisible && f.avatar.spriteY2 < -40 && f.avatar.spriteY2;
  }, { what: 'the player dropping in from above the screen' });
  const shook = game.watch((t) => t.field()?.map === 'PokemonMansion_1F' && t.field()!.avatar.cameraPanY === 4, { what: 'the landing shake' });
  const since = await game.mark();
  await game.walk('down');
  await game.waitForEvent('fallWarp', { since });
  expect(await dropped).toBeLessThan(-40);
  await shook;
  await game.waitForEvent('fallWarpDone', { since });
  const f = (await game.eval((t) => t.field()))!;
  // PokemonMansion_1F's warp 7 (the 3F hole at (18, 18) leads to it)
  expect([f.map, f.x, f.y]).toEqual(['PokemonMansion_1F', 19, 22]);
  expect(f.avatar.spriteY2).toBe(0);
  expect(f.avatar.cameraPanY).toBe(0);
  expect(f.locked).toBe(false);
  await game.mashUntil((t) => t.idle(), { what: 'the field free again', button: 'B' });
});

test('falling into Seafoam Islands B4F lands the player surfing', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SeafoamIslands_B3F', x: 6, y: 17, party: [MEWTWO] });
  // No boulders pushed down to B4F yet, so the current runs (with both, EventScript_CurrentBlocked leaves the
  // player surfing where they land).
  await game.eval((t) => {
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_1', true);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_2', true);
  });
  // FallWarpEffect_7: MetatileBehavior_IsSurfableInSeafoamIslands → VAR_TEMP_1 = 1 and surfing, read in the
  // tick it ends (the map's ON_FRAME script SeafoamIslands_B4F_EventScript_EnterByFalling takes it from there).
  const landed = game.watch((t) => {
    const f = t.field();
    return f?.map === 'SeafoamIslands_B4F' && f.avatar.flags.includes('SURFING') && t.var('VAR_TEMP_1') === 1 && { x: f.x, y: f.y };
  }, { what: 'landing in the water, surfing' });
  const since = await game.mark();
  await game.walk('down');
  await game.waitForEvent('fallWarpDone', { since });
  expect(await landed).toEqual({ x: 8, y: 17 }); // SeafoamIslands_B4F's warp 2
  // The current carries the player off and dumps them on land (SeafoamIslandsB4F_CurrentDumpsPlayerOnLand)
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.var('VAR_TEMP_1') === 0, { what: 'the current ride', button: 'B' });
  const f = (await game.eval((t) => t.field()))!;
  expect(f.avatar.flags).not.toContain('SURFING');
  expect([f.x, f.y]).not.toEqual([8, 17]);
});
