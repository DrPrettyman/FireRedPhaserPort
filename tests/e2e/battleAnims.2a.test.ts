// Battle anims step 2A (BATTLE_ANIMS_PLAN.md): battle_anim_fight.c, _rock.c, _ground.c, _bug.c and _poison.c.

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, ROUTE1, useFirstMove } from './battleAnimHelpers';
import { useGame } from './harness';

const session = useGame();

// One move per newly ported sprite callback / task, four to a battle against a Snorlax that only splashes.
// Rollout comes last in its battle: it locks the attacker in for up to five turns (one rock size per turn).
test.each([
  ['KARATE_CHOP', 'DOUBLE_KICK', 'CROSS_CHOP', 'STOMP'],
  ['DIZZY_PUNCH', 'BRICK_BREAK', 'SUPERPOWER', 'ARM_THRUST'],
  ['REVENGE', 'SKY_UPPERCUT', 'ROCK_SMASH', 'ACID'],
  ['ANCIENT_POWER', 'ROCK_BLAST', 'SEISMIC_TOSS', 'ROLLOUT'],
  ['BONEMERANG', 'EARTHQUAKE', 'MEGAHORN', 'LEECH_LIFE'],
  ['SPIDER_WEB', 'TAIL_GLOW', 'SLUDGE', 'SANDSTORM'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test('Sludge Bomb runs to the end', () => expectMovesRun(session, ['SLUDGE_BOMB']));

test('Magnitude reads its power from past the end of gBattleAnimArgs and shakes the terrain', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 10, moves: ['MAGNITUDE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_MAGNITUDE', since)).toMatchObject({ ran: true });
  // AnimTask_IsPowerOver99 sets arg 15 and jumpargeq 15 picks a branch; both shake BG3 (the terrain).
  await game.waitFor((t) => t.gpuReg(0x1c) !== 0, { what: 'the terrain shake (BG3HOFS)' });
  await animEvent(game, 'battleAnimEnd', 'Move_MAGNITUDE', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.gpuReg(0x1c))).toBe(0);
});

test('Dig: the attacker sinks out of sight, then rises out of the hole next turn', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['DIG'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  // Turn 1 (DigSetUp): AnimTask_DigDownMovement scrolls the mon's BG copy down behind a BG1/2HOFS scanline
  // effect, then hides the sprite.
  expect(await animEvent(game, 'battleAnim', 'Move_DIG', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Move_DIG', since);
  expect((await game.eval((t) => t.battle()))!.mons[0].spriteInvisible).toBe(true);
  // Turn 2 (DigUnleash) runs without a menu: AnimTask_DigUpMovement brings the sprite back up.
  const digs = async () => (await game.events(since)).filter((e) => e.label === 'Move_DIG');
  for (let i = 0; (await digs()).length < 4; i++) {
    if (i > 300) throw new Error(`Dig's second turn never ended: ${JSON.stringify(await digs())}`);
    await game.eval((t) => t.waitFrames(10));
  }
  expect((await digs()).map((e) => [e.type, e.ran])).toEqual([
    ['battleAnim', true],
    ['battleAnimEnd', undefined],
    ['battleAnim', true],
    ['battleAnimEnd', undefined],
  ]);
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
});

test('Fissure: dirt plumes, then the crack BG under the target', async () => {
  // A Lv. 100 Fissure always hits a Lv. 5 target (30% + the level difference).
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'MEWTWO', level: 100, moves: ['FISSURE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 5, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_FISSURE', since)).toMatchObject({ ran: true });
  // AnimTask_PositionFissureBgOnBattler holds BG3's offsets on the target until arg 7 is set to -1.
  await game.waitFor((t) => t.gpuReg(0x1e) !== 0, { what: 'the crack BG positioned (BG3VOFS)' });
  await animEvent(game, 'battleAnimEnd', 'Move_FISSURE', since);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
});
