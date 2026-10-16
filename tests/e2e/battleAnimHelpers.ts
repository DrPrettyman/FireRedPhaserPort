// Helpers shared by the battle anim e2e files (battleAnims.test.ts and one battleAnims.<file>.test.ts per
// battle_anim_*.c file ported in BATTLE_ANIMS_PLAN.md steps 2-3).

import { expect } from 'vitest';
import type { Game, useGame } from './harness';

export const ROUTE1 = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

/** The first battleAnim / battleAnimEnd event for `label` after `since` (pressing A through text meanwhile). */
export async function animEvent(game: Game, type: 'battleAnim' | 'battleAnimEnd', label: string, since: number) {
  for (let i = 0; i < 300; i++) {
    const e = (await game.events(since)).find((ev) => ev.type === type && ev.label === label);
    if (e) return e;
    await game.eval((t) => t.waitFrames(10));
  }
  throw new Error(`no ${type} event for ${label}: ${JSON.stringify((await game.events(since)).map((e) => [e.type, e.label]))}`);
}

/**
 * Reseeds the RNG, so the turn's rolls (the wild mon's move, accuracy, damage) don't depend on how many frames
 * the run took to get here: a 95% Tackle otherwise misses now and then, and a miss plays no anim at all.
 */
export async function reseed(game: Game): Promise<void> {
  await game.eval((t) => t.seed(1));
}

/** Picks the first move at the action menu. */
export async function useFirstMove(game: Game): Promise<number> {
  await game.waitForActionMenu();
  const since = await game.mark();
  await game.press('A'); // FIGHT
  await game.eval((t) => t.waitFrames(10));
  await reseed(game);
  await game.press('A'); // move 1
  return since;
}

/** At the action menu: FIGHT, then the move in `slot` (0-3, laid out 2x2). The cursor starts on `from`, where it was last turn. */
export async function useMoveSlot(game: Game, from: number, slot: number): Promise<number> {
  await game.waitForActionMenu();
  const since = await game.mark();
  await game.press('A'); // FIGHT
  await game.eval((t) => t.waitFrames(10));
  if ((slot & 1) !== (from & 1)) await game.press(slot & 1 ? 'RIGHT' : 'LEFT');
  if ((slot & 2) !== (from & 2)) await game.press(slot & 2 ? 'DOWN' : 'UP');
  await reseed(game);
  await game.press('A');
  return since;
}

/**
 * Uses up to four moves in turn against a Lv. 100 Snorlax that only splashes (and has the HP to take them),
 * checking each move's anim script runs to its end, and that both battlers are back on screen afterwards.
 */
export async function expectMovesRun(session: ReturnType<typeof useGame>, moves: string[]): Promise<void> {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  let from = 0;
  for (const [slot, move] of moves.entries()) {
    const since = await useMoveSlot(game, from, slot);
    from = slot;
    expect(await animEvent(game, 'battleAnim', `Move_${move}`, since)).toMatchObject({ ran: true, attacker: 0 });
    await animEvent(game, 'battleAnimEnd', `Move_${move}`, since);
  }
  await game.waitForActionMenu();
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
