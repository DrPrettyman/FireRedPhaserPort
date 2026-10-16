// Battle anims step 3, worker E2 (BATTLE_ANIMS_PLAN.md): battle_anim_effects_2.c. One move per newly ported
// callback / task, plus Sketch's HBlank scroll (the target's BG copy drawn in from the bottom).

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, ROUTE1, useFirstMove, useMoveSlot } from './battleAnimHelpers';
import { useGame, type Game } from './harness';

const session = useGame();

/** expectMovesRun with a chosen attacker and foe (Attract needs opposite genders, Soft-Boiled a hurt user). */
async function expectMovesRunAs(attacker: { species: string; level: number }, foe: { species: string; moves: string[] }, moves: string[]): Promise<void> {
  const game = await session.start({ ...ROUTE1, party: [{ ...attacker, moves }] });
  await game.eval((t, f) => t.startWildBattle({ level: 100, ...f }), foe);
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

// Moves that lock the user in (Thrash, Uproar), change the moveset (Sketch), count down (Perish Song) or leave
// the foe only Struggle (Disable) go last; Fake Out only works on the first turn. Mud Sport stands in for
// Splash (AnimTask_Splash): the foe's own Splash would be the first Move_SPLASH anim.
test.each([
  ['FAKE_OUT', 'WITHDRAW', 'KINESIS', 'SWAGGER'],
  ['SWORDS_DANCE', 'SONIC_BOOM', 'PAY_DAY', 'BULLET_SEED'],
  ['VICE_GRIP', 'MINIMIZE', 'BULK_UP', 'DISABLE'],
  ['EXTREME_SPEED', 'HIDDEN_POWER', 'HYPER_VOICE', 'THRASH'],
  ['SAFEGUARD', 'SCARY_FACE', 'FURY_SWIPES', 'UPROAR'],
  ['STRUGGLE', 'FURY_CUTTER', 'RAZOR_WIND', 'SKETCH'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test('Tickle, Mud Sport and Perish Song run to the end', () => expectMovesRun(session, ['TICKLE', 'MUD_SPORT', 'PERISH_SONG']));

test('Attract, Soft-Boiled, Sweet Kiss and Lovely Kiss run to the end', () =>
  // Chansey is always female and Tauros always male; Tauros's Sonic Boom leaves Chansey hurt for Soft-Boiled.
  expectMovesRunAs({ species: 'CHANSEY', level: 50 }, { species: 'TAUROS', moves: ['SONIC_BOOM'] }, ['ATTRACT', 'SOFT_BOILED', 'SWEET_KISS', 'LOVELY_KISS']));

test('Guillotine runs to the end', async () => {
  // A one-hit KO only hits a lower-level foe.
  const game = await session.start({ ...ROUTE1, party: [{ species: 'KINGLER', level: 100, moves: ['GUILLOTINE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 5, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_GUILLOTINE', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Move_GUILLOTINE', since);
});

/** The per-line values the PPU uses for a register this frame (hblankRegs: HBlank DMA), or null. */
function hblankLines(game: Game, regOffset: number): Promise<number[] | null> {
  return game.eval(async (_t, path, reg) => {
    const hw = await new Function('p', 'return import(p)')(path);
    const lines = hw.hblankRegs.get(reg) as Uint16Array | undefined;
    return lines ? [...lines] : null;
  }, '/src/gba/hw.ts', regOffset);
}

test("Sketch: the target's BG copy is scrolled away on its lines, then drawn back in", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'SMEARGLE', level: 10, moves: ['SKETCH'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_SKETCH', since)).toMatchObject({ ran: true, attacker: 0, target: 1 });
  // AnimTask_SketchDrawMon: BG1HOFS or BG2HOFS (whichever BG holds the target's copy) is the BG's scroll + 240
  // on the 65 lines above its feet, so nothing of the copy shows there, until the lines are put back.
  const shifted = (l: number[]) => l.some((a) => l.some((b) => ((b - a) & 0x1ff) === 0xf0));
  let lines: number[] | null = null;
  for (let i = 0; i < 600 && !lines; i++) {
    for (const reg of [0x14, 0x18]) {
      const l = await hblankLines(game, reg);
      if (l && shifted(l)) lines = l;
    }
    if (!lines) await game.eval((t) => t.waitFrames(1));
  }
  expect(lines).not.toBeNull();
  await animEvent(game, 'battleAnimEnd', 'Move_SKETCH', since);
  await game.waitForActionMenu();
  expect(await hblankLines(game, 0x14)).toBeNull();
  expect(await hblankLines(game, 0x18)).toBeNull();
});
