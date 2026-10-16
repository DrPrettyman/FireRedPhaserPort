// Battle anims step 3, worker E1 (BATTLE_ANIMS_PLAN.md): battle_anim_effects_1.c. One move per newly ported
// sprite callback / task, plus the item anims (General_ItemSteal / General_ItemKnockoff).

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, ROUTE1, useFirstMove, useMoveSlot } from './battleAnimHelpers';
import { useGame } from './harness';

const session = useGame();

/** expectMovesRun with a chosen attacker and foe (for moves that need the foe to attack first, or to hold an item). */
async function expectMovesRunAs(attacker: { species: string; level: number }, foe: { species: string; moves: string[]; item?: string }, moves: string[]): Promise<void> {
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

// Against a Snorlax that only splashes (and moves first, so Mimic has a move to copy). Hyper Beam and Frenzy
// Plant make the attacker recharge for a turn; Petal Dance comes last (it locks the attacker in, then confuses
// it). Conversion needs a move of another type in the moveset (Cotton Spore). Milk Drink and Moonlight fail at
// full HP, so Belly Drum goes first; Lock-On makes sure Grass Whistle (55%) hits.
test.each([
  ['HYPER_BEAM', 'SPORE', 'TWISTER', 'PETAL_DANCE'],
  ['RAZOR_LEAF', 'MAGICAL_LEAF', 'LEAF_BLADE', 'NEEDLE_ARM'],
  ['FRENZY_PLANT', 'INGRAIN', 'SILVER_WIND', 'SWIFT'],
  ['MIMIC', 'LOCK_ON', 'SUPER_FANG', 'TAUNT'],
  ['SLASH', 'FALSE_SWIPE', 'SHARPEN', 'DOUBLE_TEAM'],
  ['CONVERSION', 'SKULL_BASH', 'COTTON_SPORE', 'PROTECT'],
  ['BELLY_DRUM', 'MOONLIGHT', 'SING', 'FOLLOW_ME'],
  ['BELLY_DRUM', 'MILK_DRINK', 'LOCK_ON', 'GRASS_WHISTLE'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test('Secret Power and Metronome run to the end', () => expectMovesRun(session, ['SECRET_POWER', 'METRONOME']));

// Conversion 2 needs a move to have hit the user: a sturdy attacker that outspeeds a tackling Snorlax uses
// Sharpen first.
test('Conversion 2 runs to the end', () =>
  expectMovesRunAs({ species: 'RATTATA', level: 100 }, { species: 'SNORLAX', moves: ['TACKLE'] }, ['SHARPEN', 'CONVERSION_2']));

test.each([
  ['THIEF', 'General_ItemSteal'],
  ['KNOCK_OFF', 'General_ItemKnockoff'],
])('%s on a foe holding an item plays %s', async (move, label) => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: [move] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'], item: 'LEFTOVERS' }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', label, since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', label, since);
  await game.waitForActionMenu();
});
