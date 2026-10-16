// Battle anims step 2C (BATTLE_ANIMS_PLAN.md): battle_anim_fire.c, battle_anim_electric.c and
// battle_anim_flying.c. One move per newly ported sprite callback / task, four to a battle.

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, reseedAfterAnims, ROUTE1, useFirstMove } from './battleAnimHelpers';
import { useGame } from './harness';

const session = useGame();

test.each([
  // AnimFireSpiralInward + AnimFireSpread, AnimFireRing + AnimFireCross, AnimFireSpiralOutward,
  // AnimFirePlume + AnimLargeFlame
  ['FIRE_PUNCH', 'FIRE_BLAST', 'FLAME_WHEEL', 'SACRED_FIRE'],
  // AnimWillOWispOrb + AnimWillOWispFire, AnimLightning + AnimTask_ShakeTargetInPattern,
  // AnimThunderboltOrb + AnimSparkElectricityFlashing, AnimFirePlume (then a recharge turn)
  ['WILL_O_WISP', 'THUNDER', 'THUNDERBOLT', 'BLAST_BURN'],
  // AnimZapCannonSpark, AnimSparkElectricity, AnimTask_ElectricChargingParticles + AnimGrowingChargeOrb +
  // AnimElectricPuff, AnimVoltTackleOrbSlide + AnimTask_VoltTackleBolt + AnimTask_VoltTackleAttackerReappear
  ['ZAP_CANNON', 'SPARK', 'CHARGE', 'VOLT_TACKLE'],
  // AnimGrowingShockWaveOrb + AnimTask_ShockWaveProgressingBolt + AnimTask_ShockWaveLightning,
  // AnimAirWaveCrescent, AnimTask_DrillPeckHitSplats, AnimFallingFeather
  ['SHOCK_WAVE', 'AEROBLAST', 'DRILL_PECK', 'FEATHER_DANCE'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test.each([
  // AnimFlyBallUp, then AnimFlyBallAttack
  ['FLY'],
  // AnimBounceBallShrink, then AnimBounceBallLand
  ['BOUNCE'],
])('%s: the attacker hides on the first turn and is back after the second', async (move) => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEOT', level: 50, moves: [move] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  // Reseed after the foe's turn-1 Splash, so turn 2's accuracy roll doesn't depend on how long the anims before it
  // took (it missed once Splash's anim was ported). Started now so it runs in the page, ahead of the roll.
  const reseeded = reseedAfterAnims(game, 'Move_SPLASH', 1, since);
  const label = `Move_${move}`;
  expect(await animEvent(game, 'battleAnim', label, since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', label, since);
  // The attacker stays hidden in the air (STATUS3_ON_AIR) until the second turn's anim brings it back.
  expect((await game.eval((t) => t.battle()))!.mons[0].spriteInvisible).toBe(true);
  await reseeded;
  const turn2 = await game.mark();
  expect(await animEvent(game, 'battleAnim', label, turn2)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', label, turn2);
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
});

test('Whirlwind (AnimWhirlwindLine) blows the wild mon away', async () => {
  // A wild mon is only blown away by a user of at least its level
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEOT', level: 50, moves: ['WHIRLWIND'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 5, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_WHIRLWIND', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Move_WHIRLWIND', since);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
});
