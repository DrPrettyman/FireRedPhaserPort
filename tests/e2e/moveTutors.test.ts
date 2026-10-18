// The move tutors (data/scripts/move_tutors.inc: ChooseMonForMoveTutor) and the Fuchsia move deleter
// (FuchsiaCity_House3: party_menu_specials.c's ChoosePartyMon, SelectMoveDeleterMove, MoveDeleterForgetMove).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

// Route 4's Mega Punch tutor stands at (47, 3) facing right; the Mega Kick tutor at (50, 3).
const MEGA_PUNCH_TUTOR = { start: 'after-rival', map: 'Route4', x: 48, y: 3 } as const;
// The move deleter stands at (4, 4) facing right.
const MOVE_DELETER = { start: 'after-rival', map: 'FuchsiaCity_House3', x: 5, y: 4 } as const;

const flag = (game: Game, name: string) => game.eval((t, n) => t.flag(n), name);

/** Talk to the tutor on the left, answer YES to "teach it?" and "only once", and land in the party menu. */
async function toTutorPartyMenu(game: Game) {
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the tutor\'s party menu' });
  await game.waitForPartyMenu();
}

test('the Mega Punch tutor teaches a mon with a free slot', async () => {
  const game = await session.start({ ...MEGA_PUNCH_TUTOR, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL'] }] });
  await toTutorPartyMenu(game);
  // A on CHARMANDER: "CHARMANDER learned MEGA PUNCH!", back to the field, the tutor's "taught" text.
  await game.mashUntil((t) => t.idle() && t.flag('FLAG_TUTOR_MEGA_PUNCH'), { what: 'the tutor done' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'GROWL', 'MEGA_PUNCH']);
  expect(await game.eval((t) => t.field()?.map)).toBe('Route4');
});

test('with four moves, the tutor\'s move replaces one through the summary screen', async () => {
  const game = await session.start({ ...MEGA_PUNCH_TUTOR, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL', 'EMBER', 'SMOKESCREEN'] }] });
  await toTutorPartyMenu(game);
  // "...needs to replace a move" → "Delete a move...?" YES → the select-move summary.
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the summary screen' });
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  await game.press('DOWN'); // GROWL
  // A: "1, 2, and... Poof! ... forgot GROWL. And... learned MEGA PUNCH!", then the tutor's "taught" text.
  await game.mashUntil((t) => t.idle() && t.flag('FLAG_TUTOR_MEGA_PUNCH'), { what: 'the tutor done' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'MEGA_PUNCH', 'EMBER', 'SMOKESCREEN']);
});

test('B in the tutor\'s party menu declines and leaves the tutor for later', async () => {
  const game = await session.start({ ...MEGA_PUNCH_TUTOR, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL'] }] });
  await toTutorPartyMenu(game);
  await game.press('B');
  await game.mashUntil((t) => /\S/.test(t.message() ?? '') && t.gbaScreen() === undefined, { what: 'the tutor\'s "declined" text' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await flag(game, 'FLAG_TUTOR_MEGA_PUNCH')).toBe(false);
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'GROWL']);
});

/** Talk to the move deleter, YES to "forget a move?", and land in ChoosePartyMon's party menu. */
async function toDeleterPartyMenu(game: Game) {
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'ChoosePartyMon\'s party menu' });
  await game.waitForPartyMenu();
}

test('the move deleter makes a mon forget a move', async () => {
  const game = await session.start({ ...MOVE_DELETER, party: [
    { species: 'PIDGEY', level: 10, moves: ['TACKLE'] },
    { species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL', 'EMBER', 'SMOKESCREEN'] },
  ] });
  await game.eval((t) => (t.state!.party[1].ppBonuses = 0b11_10_01_00)); // PP Ups 0, 1, 2, 3
  await toDeleterPartyMenu(game);
  await game.press('DOWN'); // CHARMANDER
  await game.press('A');
  // ChoosePartyMon leaves the slot in VAR_0x8004 and the script runs on: "Which move should be forgotten?",
  // then the summary screen (PSS_MODE_FORGET_MOVE).
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the forget-move summary' });
  expect(await game.eval((t) => t.var('VAR_0x8004'))).toBe(1);
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  await game.press('DOWN'); // GROWL
  await game.press('A');
  // "Hm! CHARMANDER's GROWL? That move should be forgotten?" YES → "...has forgotten the move completely."
  await game.mashUntil((t) => /GROWL\?/.test(t.message() ?? ''), { what: 'the deleter asking about GROWL' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const party = await game.eval((t) => t.party());
  expect(party[1].moves).toEqual(['SCRATCH', 'EMBER', 'SMOKESCREEN']);
  expect(party[0].moves).toEqual(['TACKLE']);
  expect(await game.eval((t) => t.state!.party[1].ppBonuses)).toBe(0b00_11_10_00);
});

test('B out of the move deleter\'s party menu and summary screen', async () => {
  const game = await session.start({ ...MOVE_DELETER, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL'] }] });

  // B in the party menu: VAR_0x8004 = SLOT_CANCEL (PARTY_SIZE + 1; Emerald's PARTY_NOTHING_CHOSEN), "Come again..."
  await toDeleterPartyMenu(game);
  await game.press('B');
  await game.mashUntil((t) => t.gbaScreen() === undefined && /again/i.test(t.message() ?? ''), { what: 'the deleter\'s goodbye' });
  expect(await game.eval((t) => t.var('VAR_0x8004'))).toBe(await game.eval((t) => t.define('PARTY_SIZE') + 1));
  await game.mashUntil((t) => t.idle(), { what: 'the field' });

  // B in the summary screen: VAR_0x8005 = MAX_MON_MOVES, back to "Which POKéMON...", then B in the party menu.
  await toDeleterPartyMenu(game);
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the forget-move summary' });
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  await game.press('B');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu again' });
  await game.waitForPartyMenu();
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'GROWL']);
});
