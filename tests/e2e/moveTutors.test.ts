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

// ------------------------------------------------------------------ the move relearner (learn_move.c)
// Two Island's Move Maniac (TwoIsland_House) stands at (7, 5) facing down; he wants a Big Mushroom or two Tiny
// Mushrooms per move. Charmander's level-up learnset: SCRATCH 1, GROWL 1, EMBER 7, METAL_CLAW 13, SMOKESCREEN 19.
const MOVE_MANIAC = { start: 'after-rival', map: 'TwoIsland_House', x: 7, y: 6 } as const;
// learn_move.c's MENU_STATE_* the tests wait on
const RELEARNER_IDLE = 4; // the list takes input
const RELEARNER_GIVE_UP_CONFIRM = 13; // "Give up trying to teach a new move to ...?" YES/NO

const giveItem = (game: Game, item: string, n: number) => game.eval((t, i, k) => t.state!.bag.add(t.define(`ITEM_${i}`), k), item, n);
const itemCount = (game: Game, item: string) => game.eval((t, i) => t.itemCount(i), item);
const relearnerAt = (game: Game, state: number, what: string) =>
  game.eval(async (t, s) => t.until(() => t.moveRelearner()?.state === s && !t.paletteFadeActive(), 20000), state).then((ok) => expect(ok, what).toBe(true));

/** Talk to the Move Maniac, YES to "teach a move?", pick the first party mon and land in the relearner's list. */
async function toRelearnerList(game: Game) {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'ChooseMonForMoveRelearner\'s party menu' });
  await game.waitForPartyMenu();
  await game.press('A');
  // The party menu leaves the slot in VAR_0x8004 and GetNumberOfRelearnableMoves in VAR_0x8005; "Which move
  // should I teach?", then TeachMoveRelearnerMove.
  await game.mashUntil((t) => t.moveRelearner()?.state === 4, { what: 'the relearner\'s list' });
  await relearnerAt(game, RELEARNER_IDLE, 'the relearner taking input');
}

test('the move relearner teaches a forgotten move to a mon with a free slot', async () => {
  const game = await session.start({ ...MOVE_MANIAC, party: [{ species: 'CHARMANDER', level: 19, moves: ['SCRATCH', 'EMBER'] }] });
  await giveItem(game, 'BIG_MUSHROOM', 1);
  await toRelearnerList(game);
  expect(await game.eval((t) => t.var('VAR_0x8005'))).toBe(3);
  const moves = await game.eval((t) => t.moveRelearner()!.moves);
  expect(moves).toEqual(await game.eval((t) => ['GROWL', 'METAL_CLAW', 'SMOKESCREEN'].map((m) => t.define(`MOVE_${m}`))));
  await game.press('DOWN'); // METAL CLAW
  // A: "Teach METAL CLAW?" YES → "CHARMANDER learned METAL CLAW!", A, back to the field; he takes the Big Mushroom.
  await game.mashUntil((t) => t.idle() && t.itemCount('BIG_MUSHROOM') === 0, { what: 'the Move Maniac taking the Big Mushroom' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'EMBER', 'METAL_CLAW']);
  expect(await game.eval((t) => t.var('VAR_0x8004'))).toBe(1);
  expect(await game.eval((t) => t.field()?.map)).toBe('TwoIsland_House');
});

test('with four moves, the relearner\'s move replaces one through the summary screen', async () => {
  const game = await session.start({ ...MOVE_MANIAC, party: [{ species: 'CHARMANDER', level: 19, moves: ['SCRATCH', 'GROWL', 'EMBER', 'SMOKESCREEN'] }] });
  await giveItem(game, 'TINY_MUSHROOM', 3);
  await toRelearnerList(game);
  // METAL CLAW, CANCEL. A: "Teach METAL CLAW?" YES → "...is trying to learn METAL CLAW..." YES →
  // "Which move should be forgotten?" → the select-move summary.
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the summary screen' });
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  await game.press('DOWN'); // GROWL
  // A: back in the relearner (CB2_MoveRelearner_Resume), "1, 2, and... Poof!... forgot GROWL. And... learned
  // METAL CLAW!", A, back to the field; he takes two Tiny Mushrooms.
  await game.mashUntil((t) => t.idle() && t.itemCount('TINY_MUSHROOM') === 1, { what: 'the Move Maniac taking two Tiny Mushrooms' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'METAL_CLAW', 'EMBER', 'SMOKESCREEN']);
});

test('B out of the relearner\'s list gives up, back to the party menu', async () => {
  const game = await session.start({ ...MOVE_MANIAC, party: [{ species: 'CHARMANDER', level: 19, moves: ['SCRATCH', 'EMBER'] }] });
  await giveItem(game, 'BIG_MUSHROOM', 1);
  await toRelearnerList(game);
  // B: "Give up trying to teach a new move to CHARMANDER?"; NO (B) goes back to the list.
  await game.press('B');
  await relearnerAt(game, RELEARNER_GIVE_UP_CONFIRM, 'the give-up YES/NO');
  await game.press('B');
  await relearnerAt(game, RELEARNER_IDLE, 'the list again');
  // B, then YES: VAR_0x8004 = FALSE, back to the field and "Which POKéMON...?" (ChooseMonForMoveRelearner again).
  await game.press('B');
  await relearnerAt(game, RELEARNER_GIVE_UP_CONFIRM, 'the give-up YES/NO');
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu again' });
  expect(await game.eval((t) => t.var('VAR_0x8004'))).toBe(0);
  await game.waitForPartyMenu();
  // B in the party menu: "...need a mushroom or two...", and he keeps the Big Mushroom.
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await itemCount(game, 'BIG_MUSHROOM')).toBe(1);
  const [mon] = await game.eval((t) => t.party());
  expect(mon.moves).toEqual(['SCRATCH', 'EMBER']);
});

// ------------------------------------------------------------------ the Cape Brink tutor (field_specials.c)
// TwoIsland_CapeBrink_House: the tutor stands at (4, 4) facing down. CapeBrinkGetMoveToTeachLeadPokemon wants a
// fully evolved starter with max friendship in the lead; each of the three moves is taught once.

const CAPE_BRINK = { start: 'after-rival', map: 'TwoIsland_CapeBrink_House', x: 4, y: 5 } as const;

test('the Cape Brink tutor teaches Blast Burn, Frenzy Plant and Hydro Cannon', async () => {
  const game = await session.start({ ...CAPE_BRINK });
  const starters = [
    ['CHARIZARD', 'FLAMETHROWER', 'BLAST_BURN', 'FLAG_TUTOR_BLAST_BURN'],
    ['VENUSAUR', 'RAZOR_LEAF', 'FRENZY_PLANT', 'FLAG_TUTOR_FRENZY_PLANT'],
    ['BLASTOISE', 'SURF', 'HYDRO_CANNON', 'FLAG_TUTOR_HYDRO_CANNON'],
  ] as const;
  for (const [species, known, move, moveFlag] of starters) {
    await game.eval((t, s, k) => {
      t.setParty([{ species: s, level: 50, moves: [k] }]);
      t.state!.party[0].friendship = 255;
      t.state!.setFlag('FLAG_TEMP_2', false); // "Make the best use of the move" until the map reloads
    }, species, known);
    await game.eval((t) => t.face('up'));
    await game.press('A');
    // "...ultimate move...", he jumps, "Allow me to teach...?" YES, "only once" YES, then ChooseMonForMoveTutor.
    await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: `the tutor's party menu (${species})` });
    await game.waitForPartyMenu();
    // A on the starter: "...learned ...!", back to the field, "...taught..." (or, with all three, "...passed on everything...").
    await game.mashUntil((t) => t.idle() && t.party()[0]?.moves.length === 2, { what: `${move} taught` });
    expect(await flag(game, moveFlag)).toBe(true);
    const [mon] = await game.eval((t) => t.party());
    expect(mon.moves).toEqual([known, move]);
  }
  expect(await flag(game, 'FLAG_LEARNED_ALL_MOVES_AT_CAPE_BRINK')).toBe(true);
});
