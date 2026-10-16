// Battle anims step 2, worker B (BATTLE_ANIMS_PLAN.md): battle_anim_water.c, battle_anim_ice.c and
// battle_anim_dragon.c. One move per newly ported sprite callback / task, four to a battle against a Snorlax
// that only splashes. Moves that lock the next turns (Hydro Cannon's recharge, Ice Ball, Outrage) go last.

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, ROUTE1, useFirstMove } from './battleAnimHelpers';
import { useGame } from './harness';

const session = useGame();

test.each([
  ['AURORA_BEAM', 'WATERFALL', 'WATER_PULSE', 'HYDRO_CANNON'],
  ['WATER_SPORT', 'WATER_SPOUT', 'ICE_PUNCH', 'ICE_BEAM'],
  ['BLIZZARD', 'POWDER_SNOW', 'ICY_WIND', 'ICE_BALL'],
  ['HAZE', 'MIST_BALL', 'HAIL', 'DRAGON_DANCE'],
  ['DRAGON_BREATH', 'DRAGON_RAGE', 'OVERHEAT', 'OUTRAGE'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test('Poison Gas runs to the end', async () => {
  // Not against the Snorlax: one with Immunity skips the anim. A foe slower than Koffing, so the 55% roll comes
  // straight after the reseed rather than after the foe's anim. (Speed 1 so the gas is caught mid-flight.)
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'KOFFING', level: 30, moves: ['POISON_GAS'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SLOWPOKE', level: 5, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_POISON_GAS', since)).toMatchObject({ ran: true, attacker: 0 });
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_PURPLE_GAS_CLOUD')), { what: 'the gas clouds' });
  await animEvent(game, 'battleAnimEnd', 'Move_POISON_GAS', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_PURPLE_GAS_CLOUD')))).toBe(false);
});

test("Haze's fog blends in on BG1 and clears up after", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'KOFFING', level: 30, moves: ['HAZE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_HAZE', since)).toMatchObject({ ran: true });
  // AnimTask_HazeScrollingFog: BG1 (the weather fog) blends over everything, up to 9/16
  await game.waitFor((t) => t.gpuReg(0x50) === 0x3f42 && (t.gpuReg(0x52) & 0x1f) === 9, { what: 'the fog at full blend' });
  await animEvent(game, 'battleAnimEnd', 'Move_HAZE', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => [t.gpuReg(0x50), t.gpuReg(0x52)])).toEqual([0, 0]);
});

test('Hail: hailstones fall, burst on the battlers, and the end-of-turn hail anim runs', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'LAPRAS', level: 30, moves: ['HAIL'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_HAIL', since)).toMatchObject({ ran: true });
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_HAIL')), { what: 'the hailstones' });
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_ICE_CRYSTALS')), { what: 'a hailstone bursting' });
  await animEvent(game, 'battleAnimEnd', 'Move_HAIL', since);
  expect(await animEvent(game, 'battleAnim', 'General_Hail', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'General_Hail', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_HAIL')))).toBe(false);
});

test('Water Spout: the attacker launches droplets that rain down on the foe', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'WAILMER', level: 30, moves: ['WATER_SPOUT'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_WATER_SPOUT', since)).toMatchObject({ ran: true });
  // At full HP the most droplets: 20 rise from the attacker...
  const rising = await game.waitFor((t) => {
    const n = t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_GLOWY_BLUE_ORB')).length;
    return n >= 10 && n;
  }, { what: 'the launched droplets' });
  expect(rising).toBeGreaterThanOrEqual(10);
  // ...then splash on the foe's side
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_WATER_IMPACT')), { what: 'the droplets splashing' });
  await animEvent(game, 'battleAnimEnd', 'Move_WATER_SPOUT', since);
  await game.waitForActionMenu();
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
});
