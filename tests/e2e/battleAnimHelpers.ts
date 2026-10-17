// Helpers shared by the battle anim e2e files (battleAnims.test.ts and one battleAnims.<file>.test.ts per
// battle_anim_*.c file ported in BATTLE_ANIMS_PLAN.md steps 2-3).

import { expect } from 'vitest';
import type { Game, useGame } from './harness';

export const ROUTE1 = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

/** The first battleAnim / battleAnimEnd event for `label` after `since` (no presses meanwhile: battle text goes on by itself). */
export async function animEvent(game: Game, type: 'battleAnim' | 'battleAnimEnd', label: string, since: number) {
  for (let i = 0; i < 300; i++) {
    const e = (await game.events(since)).find((ev) => ev.type === type && ev.label === label);
    if (e) return e;
    await game.eval((t) => t.waitFrames(10));
  }
  throw new Error(`no ${type} event for ${label}: ${JSON.stringify((await game.events(since)).map((e) => [e.type, e.label]))}`);
}

/** Reseeds the RNG now (wherever the frame's batch of ticks ends; to seed for a press, use pressSeeded). */
export async function reseed(game: Game, seed = 1): Promise<void> {
  await game.eval((t, n) => t.seed(n), seed);
}

/**
 * Reseeds the RNG and taps `button` in one eval, so the press is sampled in the tick right after the seed and
 * the turn's rolls (the wild mon's move, accuracy, damage) don't depend on how long the run took to get here: a
 * 95% Tackle otherwise misses now and then, and a miss plays no anim at all. VBlankCB_Battle calls Random() every
 * tick, so a seed in one eval and the press in the next were as many rolls apart as ticks ran between the two
 * round trips (none on an idle machine, dozens under load).
 */
export async function pressSeeded(game: Game, button: Parameters<Game['press']>[0] = 'A', seed = 1): Promise<void> {
  await game.eval((t, b, n) => {
    t.seed(n);
    return t.press(b);
  }, button, seed);
}

/** Picks the first move at the action menu. */
export async function useFirstMove(game: Game): Promise<number> {
  await game.waitForActionMenu();
  const since = await game.mark();
  await game.press('A'); // FIGHT
  await game.eval((t) => t.waitFrames(10));
  await pressSeeded(game, 'A'); // move 1
  return since;
}

/**
 * At the action menu: FIGHT, then the move in `slot` (0-3, laid out 2x2). The cursor starts on `from`, where it was
 * last turn. Reseeds with `seed` just before the move is chosen.
 */
export async function useMoveSlot(game: Game, from: number, slot: number, seed = 1): Promise<number> {
  await game.waitForActionMenu();
  const since = await game.mark();
  await game.press('A'); // FIGHT
  await game.eval((t) => t.waitFrames(10));
  if ((slot & 1) !== (from & 1)) await game.press(slot & 1 ? 'RIGHT' : 'LEFT');
  if ((slot & 2) !== (from & 2)) await game.press(slot & 2 ? 'DOWN' : 'UP');
  await pressSeeded(game, 'A', seed);
  return since;
}

/**
 * Uses up to four moves in turn against a Lv. 100 Snorlax that only splashes (and has the HP to take them),
 * checking each move's anim script runs to its end, and that both battlers are back on screen afterwards.
 * A move that can miss (SING, DISABLE, THUNDER, ...) plays no anim when it does, and the reseed can't rule that
 * out (waitForActionMenu's A presses, timed from here, can cut the foe's messages short before the move's rolls,
 * and VBlankCB_Battle rolls every tick), so a miss uses the move again, with another seed.
 */
export async function expectMovesRun(session: ReturnType<typeof useGame>, moves: string[]): Promise<void> {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  let from = 0;
  for (const [slot, move] of moves.entries()) {
    const label = `Move_${move}`;
    for (let attempt = 0; ; attempt++) {
      if (attempt === 8) throw new Error(`${move} missed ${attempt} times`);
      const since = await useMoveSlot(game, from, slot, 1 + attempt);
      from = slot;
      await game.waitForActionMenu(); // the end of the turn
      const events = await game.events(since);
      const anim = events.find((e) => e.type === 'battleAnim' && e.label === label);
      if (!anim) continue; // missed
      expect(anim).toMatchObject({ ran: true, attacker: 0 });
      expect(events.some((e) => e.type === 'battleAnimEnd' && e.label === label)).toBe(true);
      break;
    }
  }
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
}

/**
 * Reseeds the RNG inside the page as soon as `count` `label` anims have ended since `since`. Start it (without
 * awaiting) before those anims play and await it later: the wait runs in the page, so the reseed lands within a
 * frame of the anim's end even when the machine is busy, ahead of a later turn's accuracy roll.
 */
export function reseedAfterAnims(game: Game, label: string, count: number, since: number): Promise<void> {
  return game.eval(async (t, l, n, s) => {
    // seedWhen seeds inside the tick the condition first holds, so the reseed lands on an exact tick.
    const ok = await t.seedWhen(() => t.events(s).filter((e) => e.type === 'battleAnimEnd' && e.label === l).length >= n, 1);
    if (!ok) throw new Error(`reseedAfterAnims: ${n} ${l} never ended`);
  }, label, count, since);
}
