// Battle anims step 3, worker E3a (BATTLE_ANIMS_PLAN.md): the first half of battle_anim_effects_3.c. One move
// per newly ported callback / task, plus the new engine paths: SmokescreenImpact (battle_anim_smokescreen.c),
// the OBJ-window spotlight (Encore) and Castform's form change (HandleSpeciesGfxDataChange).

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, reseedAfterAnims, ROUTE1, useFirstMove, useMoveSlot } from './battleAnimHelpers';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

/** expectMovesRun with a chosen attacker and foe (moves that need a hurt or sleeping user, or a foe that hits). */
async function expectMovesRunAs(attacker: MonSpec, foe: { species: string; level: number; moves: string[] }, moves: string[]): Promise<void> {
  const game = await session.start({ ...ROUTE1, party: [{ ...attacker, moves }] });
  await game.eval((t, f) => t.startWildBattle(f), foe);
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

/** Reads a battle global in the page (src/battle/env.ts `g`). */
function battleGlobal<T>(game: Game, fn: string): Promise<T> {
  return game.eval(async (_t, path, body) => new Function('g', `return ${body}`)((await new Function('p', 'return import(p)')(path)).g), '/src/battle/env.ts', fn);
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

test.each([
  ['SMOKESCREEN', 'MIND_READER', 'MEAN_LOOK', 'SPIKES'],
  ['HYPER_FANG', 'ENCORE', 'RAPID_SPIN', 'TORMENT'],
  ['TRI_ATTACK', 'DEFENSE_CURL', 'WISH', 'PSYCHO_BOOST'],
  ['FRUSTRATION', 'FLAIL', 'SWEET_SCENT', 'POISON_FANG'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

// Swallow and Morning Sun fail (no anim) at full HP: the foe takes 40 HP off with Dragon Rage each turn.
test('Stockpile, Swallow and Morning Sun run to the end', () =>
  expectMovesRunAs({ species: 'RATTATA', level: 70 }, { species: 'SNORLAX', level: 100, moves: ['DRAGON_RAGE'] }, ['STOCKPILE', 'SWALLOW', 'MORNING_SUN']));

test('Sleep Talk runs to the end', () =>
  expectMovesRunAs({ species: 'RATTATA', level: 10, status: 'SLEEP' }, { species: 'SNORLAX', level: 100, moves: ['SPLASH'] }, ['SLEEP_TALK', 'SNORE']));

test('Baton Pass: the attacker squashes into a ball that flies off', async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'RATTATA', level: 10, moves: ['BATON_PASS'] },
      { species: 'PIDGEY', level: 10, moves: ['TACKLE'] },
    ],
  });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  // The party screen opens right after the anim (openpartyscreen), so read the attacker's sprite in the page, at
  // the start of the tick after the anim ended: a read from Node can come after the battle sprites are gone.
  const start = await game.mark();
  const invisibleAtEnd = game.eval(async (t, s) => {
    let invisible: boolean | undefined;
    const ended = await t.until(
      () => t.events(s).some((e) => e.type === 'battleAnimEnd' && e.label === 'Move_BATON_PASS') && ((invisible = t.battle()?.mons[0].spriteInvisible), true),
      20000,
    );
    return ended ? invisible : 'no battleAnimEnd';
  }, start);
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_BATON_PASS', since)).toMatchObject({ ran: true, attacker: 0 });
  expect(await invisibleAtEnd).toBe(true);
});

// The hit rolls accuracy (85%) at the end of turn 3; with the RNG reseeded at each move choice it's the same
// roll every run (Splash on turns 2-3 gives a hit, Growl a miss).
test('Doom Desire: two turns later the light beam flashes over the target', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['DOOM_DESIRE', 'SPLASH'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  await useMoveSlot(game, 0, 1);
  const turn3 = await useMoveSlot(game, 1, 1);
  // Reseed once both turn-3 Splashes are done, just before the delayed hit's accuracy roll, so the roll doesn't
  // depend on how long the anims before it took. The wait runs in the page, so it's on time under load too.
  await reseedAfterAnims(game, 'Move_SPLASH', 2, turn3);
  expect(await animEvent(game, 'battleAnim', 'General_DoomDesireHit', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'General_DoomDesireHit', since);
  await game.waitForActionMenu();
  expect(await battleGlobal<number>(game, 'g.battle_BG1_X')).toBe(0);
});

test('Smokescreen: the four-part smoke cloud appears on the target and is freed after', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 10, moves: ['SMOKESCREEN'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_SMOKESCREEN', since)).toMatchObject({ ran: true });
  // TAG_SMOKESCREEN (55019) sprites: the four quarters
  const smokeCount = () =>
    game.eval(async (_t, path) => (await new Function('p', 'return import(p)')(path)).gSprites.filter((s: { inUse: boolean; template: { tileTag: number } }) => s.inUse && s.template.tileTag === 55019).length, '/src/gba/sprite.ts');
  await poll(game, async () => (await smokeCount()) === 4, 'the smoke cloud');
  await game.screenshot('e3a-smokescreen');
  await animEvent(game, 'battleAnimEnd', 'Move_SMOKESCREEN', since);
  await poll(game, async () => (await smokeCount()) === 0, 'the smoke to clear');
});

test('Encore: an OBJ-window spotlight lights the target, and the window is off again after', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 10, moves: ['GROWL', 'ENCORE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  await useFirstMove(game);
  const since = await useMoveSlot(game, 0, 1);
  expect(await animEvent(game, 'battleAnim', 'Move_ENCORE', since)).toMatchObject({ ran: true });
  const dispcnt = () => game.eval(async (_t, path) => (await new Function('p', 'return import(p)')(path)).GetGpuReg(0), '/src/gba/hw.ts');
  await poll(game, async () => ((await dispcnt()) & 0xc000) === 0xc000, 'the spotlight (OBJ window + WIN1)');
  await game.eval((t) => t.waitFrames(30));
  await game.screenshot('e3a-encore');
  await animEvent(game, 'battleAnimEnd', 'Move_ENCORE', since);
  await game.waitForActionMenu();
  expect((await dispcnt()) & 0xc000).toBe(0);
});

test("Castform's Forecast: Sunny Day changes it to its sunny form (General_CastformChange)", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CASTFORM', level: 30, moves: ['SUNNY_DAY'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'General_CastformChange', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'General_CastformChange', since);
  await game.waitForActionMenu();
  expect(await battleGlobal<number>(game, 'g.battleMonForms[0]')).toBe(1); // CASTFORM_FIRE
  await game.screenshot('e3a-castform-sunny');
  expect((await game.eval((t) => t.battle()))!.mons[0].spriteInvisible).toBe(false);
});
