// Battle anims step 2, worker D (BATTLE_ANIMS_PLAN.md): battle_anim_ghost.c, battle_anim_psychic.c and
// battle_anim_dark.c. One move per newly ported callback / task, plus the new engine path
// (ScanlineEffect_InitWave, Spite's wavering shadow).

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, ROUTE1, useFirstMove, useMoveSlot } from './battleAnimHelpers';
import { useGame, type Game } from './harness';

const session = useGame();

/**
 * expectMovesRun with a chosen attacker and foe: Ghost moves don't touch expectMovesRun's Snorlax (a Normal
 * type), and Curse only plays its ghost half for a Ghost-type user.
 */
async function expectMovesRunAs(attacker: string, foe: { species: string; status?: string }, moves: string[]): Promise<void> {
  const game = await session.start({ ...ROUTE1, party: [{ species: attacker, level: 10, moves }] });
  await game.eval((t, f) => t.startWildBattle({ level: 100, moves: ['SPLASH'], ...f }), foe);
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

/** The per-line values the PPU uses for a register this frame (hblankRegs: HBlank DMA), or null. */
function hblankLines(game: Game, regOffset: number): Promise<number[] | null> {
  return game.eval(async (_t, path, reg) => {
    const hw = await new Function('p', 'return import(p)')(path);
    const lines = hw.hblankRegs.get(reg) as Uint16Array | undefined;
    return lines ? [...lines] : null;
  }, '/src/gba/hw.ts', regOffset);
}

/** Polls `fn` (in Node) until it returns something truthy. */
async function poll<T>(game: Game, fn: () => Promise<T | null | undefined | false>, what: string): Promise<T> {
  for (let i = 0; i < 600; i++) {
    const r = await fn();
    if (r) return r;
    await game.eval((t) => t.waitFrames(1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// battle_anim_ghost.c
test('Shadow Ball, Lick, Curse (ghost) and Nightmare run to the end', () =>
  expectMovesRunAs('GASTLY', { species: 'LAPRAS', status: 'SLEEP' }, ['SHADOW_BALL', 'LICK', 'CURSE', 'NIGHTMARE']));

test('Spite, Confuse Ray, Night Shade and Grudge run to the end', () =>
  expectMovesRunAs('GASTLY', { species: 'LAPRAS' }, ['SPITE', 'CONFUSE_RAY', 'NIGHT_SHADE', 'GRUDGE']));

// battle_anim_psychic.c, battle_anim_dark.c (and Destiny Bond)
test.each([
  ['DESTINY_BOND', 'MEDITATE', 'AMNESIA', 'SKILL_SWAP'],
  ['EXTRASENSORY', 'FAKE_TEARS', 'FAINT_ATTACK', 'CAMOUFLAGE'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test("Spite: a scanline wave wavers the target's BG, and stops after", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'GASTLY', level: 10, moves: ['SPITE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'LAPRAS', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_SPITE', since)).toMatchObject({ ran: true, attacker: 0, target: 1 });
  // ScanlineEffect_InitWave on BG1HOFS or BG2HOFS (whichever BG the target's copy is on): 64 lines of a sine
  // wave, amplitude 6.
  await poll(game, async () => {
    for (const reg of [0x14, 0x18]) {
      const lines = await hblankLines(game, reg);
      if (lines && new Set(lines).size > 4) return lines;
    }
    return null;
  }, 'the wave');
  await animEvent(game, 'battleAnimEnd', 'Move_SPITE', since);
  await game.waitForActionMenu();
  expect(await hblankLines(game, 0x14)).toBeNull();
  expect(await hblankLines(game, 0x18)).toBeNull();
  expect(await game.eval(async (_t, path) => (await new Function('p', 'return import(p)')(path)).gScanlineEffect.waveTaskId, '/src/gba/scanline.ts')).toBe(0xff);
});

test('Teleport: the attacker shoots up off screen and the battle ends', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'ABRA', level: 10, moves: ['TELEPORT'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  // The battle ends ~150 ticks after the anim (the SE wait lengthened the anim, not the gap): read the attacker's
  // sprite in the page, in the tick after the anim's end.
  const atEnd = game.watch((t) => t.events().some((e) => e.type === 'battleAnimEnd' && e.label === 'Move_TELEPORT') && { invisible: t.battle()!.mons[0].spriteInvisible }, { what: "Teleport's end" });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_TELEPORT', since)).toMatchObject({ ran: true, attacker: 0 });
  expect(await atEnd).toEqual({ invisible: true });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
});

test("Memento: the attacker's shadow shrinks away and the target's grows, then the attacker faints", async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'RATTATA', level: 10, moves: ['MEMENTO'] },
      { species: 'PIDGEY', level: 10, moves: ['TACKLE'] },
    ],
  });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_MEMENTO', since)).toMatchObject({ ran: true, attacker: 0 });
  // the shadows are per-line BGnVOFS tables
  await poll(game, async () => (await hblankLines(game, 0x16)) ?? (await hblankLines(game, 0x1a)), 'the shadow');
  await animEvent(game, 'battleAnimEnd', 'Move_MEMENTO', since);
  await game.waitFor((t) => t.battle()!.mons[0].hp === 0, { what: 'the attacker to faint' });
  expect(await hblankLines(game, 0x16)).toBeNull();
  expect(await hblankLines(game, 0x1a)).toBeNull();
});
