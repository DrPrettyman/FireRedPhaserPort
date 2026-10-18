// party_menu_specials.c's move deleter specials on a party mon (no screens).

import { beforeAll, expect, test } from 'vitest';
import { PARTY_MENU_SPECIALS } from '../../src/menus/partyMenuSpecials';
import type { SpecialEnv } from '../../src/script/specials';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;

beforeAll(async () => {
  t = await newBattleEnv();
});

const run = (name: string) => PARTY_MENU_SPECIALS[name]({ state: t.state } as SpecialEnv);

function partyWith(moves: string[], ppBonuses = 0) {
  const mon = t.pokemon.createMon(t.d('SPECIES_CHARMANDER'), 10, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' });
  mon.moves = [0, 0, 0, 0].map((_, i) => (moves[i] ? t.d(`MOVE_${moves[i]}`) : 0));
  mon.pp = mon.moves.map((m) => (m ? t.pokemon.moves[m].pp : 0));
  mon.ppBonuses = ppBonuses;
  t.state.party = [t.pokemon.createMon(t.d('SPECIES_PIDGEY'), 5, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' }), mon];
  t.state.setVar('VAR_0x8004', 1);
  return mon;
}

test('GetNumMovesSelectedMonHas counts the non-empty slots', () => {
  partyWith(['SCRATCH', 'GROWL']);
  run('GetNumMovesSelectedMonHas');
  expect(t.state.getVar('VAR_RESULT')).toBe(2);
  partyWith(['SCRATCH', 'GROWL', 'EMBER', 'MEGA_PUNCH']);
  run('GetNumMovesSelectedMonHas');
  expect(t.state.getVar('VAR_RESULT')).toBe(4);
});

test('IsSelectedMonEgg', () => {
  const mon = partyWith(['SCRATCH']);
  run('IsSelectedMonEgg');
  expect(t.state.getVar('VAR_RESULT')).toBe(0);
  mon.isEgg = true;
  run('IsSelectedMonEgg');
  expect(t.state.getVar('VAR_RESULT')).toBe(1);
});

test('BufferMoveDeleterNicknameAndMove puts the nickname and move VAR_0x8005 in STR_VAR_1 / 2', () => {
  partyWith(['SCRATCH', 'GROWL', 'EMBER']);
  t.state.setVar('VAR_0x8005', 2);
  run('BufferMoveDeleterNicknameAndMove');
  expect(t.state.stringVars[0]).toEqual(t.charmap.encodePlain('CHARMANDER'));
  expect(t.state.stringVars[1]).toEqual(t.charmap.encodePlain('EMBER'));
});

test('MoveDeleterForgetMove clears the slot and shifts the later moves, PP and PP Ups up', () => {
  // PP Ups per slot: 0, 1, 2, 3 (two bits each, slot 0 lowest).
  const mon = partyWith(['SCRATCH', 'GROWL', 'EMBER', 'MEGA_PUNCH'], 0b11_10_01_00);
  mon.pp = [30, 31, 22, 18];
  t.state.setVar('VAR_0x8005', 1);
  run('MoveDeleterForgetMove');
  expect(mon.moves).toEqual([t.d('MOVE_SCRATCH'), t.d('MOVE_EMBER'), t.d('MOVE_MEGA_PUNCH'), 0]);
  expect(mon.pp).toEqual([30, 22, 18, 0]);
  // GROWL's PP Up (1) goes; EMBER's (2) and MEGA_PUNCH's (3) move up a slot.
  expect(mon.ppBonuses).toBe(0b00_11_10_00);
});

test('MoveDeleterForgetMove on the last slot only clears it', () => {
  const mon = partyWith(['SCRATCH', 'GROWL', 'EMBER', 'MEGA_PUNCH'], 0b11_00_00_01);
  t.state.setVar('VAR_0x8005', 3);
  run('MoveDeleterForgetMove');
  expect(mon.moves).toEqual([t.d('MOVE_SCRATCH'), t.d('MOVE_GROWL'), t.d('MOVE_EMBER'), 0]);
  expect(mon.ppBonuses).toBe(0b00_00_00_01);
});
