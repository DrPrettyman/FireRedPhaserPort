// daycare.c's storage and the Route 5 daycare (world/daycare.ts, script/daycareSpecials.ts, the money specials).
// Expected levels come from GROWTH_MEDIUM_FAST (exp = level³) and Rattata's learnset in the decomp (Quick Attack
// at 7, Hyper Fang at 13).

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { GameState } from '../../src/state/GameState';
import { fromSaveData, toSaveData } from '../../src/state/saveData';
import { ClearMailData, GiveMailToMon, MonHasMail, type Mail } from '../../src/world/mail';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import { gPartyMenu } from '../../src/menus/partyMenu';
import { SPECIALS, type SpecialEnv } from '../../src/script/specials';
import {
  getCostToWithdrawRoute5DaycareMon,
  getNumLevelsGainedForRoute5DaycareMon,
  isThereMonInRoute5Daycare,
  putMonInRoute5Daycare,
  shouldEggHatch,
  takePokemonFromRoute5Daycare,
} from '../../src/world/daycare';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;

beforeAll(async () => {
  t = await newBattleEnv();
});

const make = (species: string, level: number, moves?: string[]): Pokemon => {
  const mon = t.pokemon.createMon(t.d(`SPECIES_${species}`), level, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' });
  if (moves) {
    mon.moves = [0, 1, 2, 3].map((i) => (moves[i] ? t.d(`MOVE_${moves[i]}`) : 0));
    mon.pp = mon.moves.map((m) => (m ? t.pokemon.moves[m].pp : 0));
  }
  return mon;
};
const str = (i: number) => t.charmap.decodePlain(t.state.stringVars[i]);
const run = (name: string) => SPECIALS[name]({ state: t.state } as SpecialEnv);

beforeEach(() => {
  t.state.party = [make('PIDGEY', 10), make('RATTATA', 5, ['TACKLE', 'TAIL_WHIP'])];
  t.state.route5DayCareMon = { mon: null, steps: 0 };
  t.state.daycare = { mons: [{ mon: null, steps: 0 }, { mon: null, steps: 0 }], offspringPersonality: 0, stepCounter: 0 };
  t.state.money = 3000;
});

test('PutMonInRoute5Daycare: the mon leaves the party with its PP restored', () => {
  t.state.party[1].pp[0] = 3;
  putMonInRoute5Daycare(t.state, 1);
  expect(t.state.party.map((m) => m.species)).toEqual([t.d('SPECIES_PIDGEY')]);
  expect(isThereMonInRoute5Daycare(t.state)).toBe(true);
  const { mon, steps } = t.state.route5DayCareMon;
  expect(steps).toBe(0);
  expect(mon!.species).toBe(t.d('SPECIES_RATTATA'));
  expect(mon!.pp[0]).toBe(t.pokemon.moves[t.d('MOVE_TACKLE')].pp);
  expect(mon).not.toHaveProperty('level'); // a BoxPokemon
});

test('ShouldEggHatch counts steps for the Route 5 mon only while there is one', () => {
  shouldEggHatch(t.state);
  expect(t.state.route5DayCareMon.steps).toBe(0);
  putMonInRoute5Daycare(t.state, 1);
  for (let i = 0; i < 10; i++) expect(shouldEggHatch(t.state)).toBe(false);
  expect(t.state.route5DayCareMon.steps).toBe(10);
  expect(t.state.daycare.stepCounter).toBe(11);
});

test('no steps: 0 levels, 100 to take it back, and it comes back as it went in', () => {
  putMonInRoute5Daycare(t.state, 1);
  expect(getNumLevelsGainedForRoute5DaycareMon(t.state)).toBe(0);
  expect(str(1)).toBe('0');
  expect(getCostToWithdrawRoute5DaycareMon(t.state)).toBe(100);
  expect(str(0)).toBe('RATTATA');
  expect(str(1)).toBe('100');
  expect(takePokemonFromRoute5Daycare(t.state)).toBe(t.d('SPECIES_RATTATA'));
  const mon = t.state.party[1];
  expect(mon.level).toBe(5);
  expect(mon.exp).toBe(125);
  expect(isThereMonInRoute5Daycare(t.state)).toBe(false);
  expect(t.state.route5DayCareMon).toEqual({ mon: null, steps: 0 });
});

test('levels gained, the cost, and the moves learned on the way (ApplyDaycareExperience)', () => {
  putMonInRoute5Daycare(t.state, 1);
  t.state.route5DayCareMon.steps = 13 ** 3 - 125 + 1; // just past level 13
  expect(getNumLevelsGainedForRoute5DaycareMon(t.state)).toBe(8);
  expect(str(0)).toBe('RATTATA');
  expect(str(1)).toBe('8');
  expect(getCostToWithdrawRoute5DaycareMon(t.state)).toBe(900);
  takePokemonFromRoute5Daycare(t.state);
  const mon = t.state.party[1];
  expect(mon.level).toBe(13);
  expect(mon.exp).toBe(13 ** 3 + 1);
  expect(mon.moves).toEqual(['TACKLE', 'TAIL_WHIP', 'QUICK_ATTACK', 'HYPER_FANG'].map((m) => t.d(`MOVE_${m}`)));
  expect(mon.hp).toBe(mon.maxHP);
});

test('with four moves, each new move pushes out the first (DeleteFirstMoveAndGiveMoveToMon)', () => {
  t.state.party[1] = make('RATTATA', 5, ['TACKLE', 'TAIL_WHIP', 'BITE', 'GROWL']);
  putMonInRoute5Daycare(t.state, 1);
  t.state.route5DayCareMon.steps = 13 ** 3 - 125 + 1;
  takePokemonFromRoute5Daycare(t.state);
  expect(t.state.party[1].moves).toEqual(['BITE', 'GROWL', 'QUICK_ATTACK', 'HYPER_FANG'].map((m) => t.d(`MOVE_${m}`)));
});

test('experience exactly at the next level: the level counts, but its moves aren\'t learned (TryIncrementMonLevel needs more)', () => {
  putMonInRoute5Daycare(t.state, 1);
  t.state.route5DayCareMon.steps = 7 ** 3 - 125; // exactly level 7's experience
  expect(getNumLevelsGainedForRoute5DaycareMon(t.state)).toBe(2);
  takePokemonFromRoute5Daycare(t.state);
  const mon = t.state.party[1];
  expect(mon.level).toBe(7); // CalculateMonStats sets the level from the experience
  expect(mon.moves).toEqual([t.d("MOVE_TACKLE"), t.d("MOVE_TAIL_WHIP"), 0, 0]);
});

test('a level 100 mon gains nothing', () => {
  t.state.party[1] = make('RATTATA', 100);
  putMonInRoute5Daycare(t.state, 1);
  t.state.route5DayCareMon.steps = 5000;
  expect(getNumLevelsGainedForRoute5DaycareMon(t.state)).toBe(0);
  takePokemonFromRoute5Daycare(t.state);
  expect(t.state.party[1].exp).toBe(100 ** 3);
});

test('the specials: VAR_0x8005 cost, IsEnoughForCostInVar0x8005, SubtractMoneyFromVar0x8005, CalculatePlayerPartyCount', () => {
  expect(run('CalculatePlayerPartyCount')).toBe(2);
  expect(run('IsThereMonInRoute5Daycare')).toBe(0);
  gPartyMenu.slotId = 0; // GetCursorSelectionMonId: what the party menu chose
  run('PutMonInRoute5Daycare');
  expect(t.state.party.map((m) => m.species)).toEqual([t.d('SPECIES_RATTATA')]);
  expect(run('CalculatePlayerPartyCount')).toBe(1);
  // Pidgey (GROWTH_MEDIUM_SLOW) at 10 has 560 exp; level 11 needs 742, level 12 973.
  t.state.route5DayCareMon.steps = 216;
  expect(run('GetNumLevelsGainedForRoute5DaycareMon')).toBe(1);
  run('GetCostToWithdrawRoute5DaycareMon');
  const cost = t.state.getVar('VAR_0x8005');
  expect(cost).toBe(200);
  t.state.money = cost - 1;
  expect(run('IsEnoughForCostInVar0x8005')).toBe(0);
  t.state.money = cost;
  expect(run('IsEnoughForCostInVar0x8005')).toBe(1);
  run('SubtractMoneyFromVar0x8005');
  expect(t.state.money).toBe(0);
  expect(run('TakePokemonFromRoute5Daycare')).toBe(t.d('SPECIES_PIDGEY'));
  expect(t.state.party.map((m) => m.species)).toEqual([t.d('SPECIES_RATTATA'), t.d('SPECIES_PIDGEY')]);
  expect(t.state.party[1].level).toBe(11);
});

test('GetSelectedMonNicknameAndSpecies', () => {
  t.state.party[1].nickname = t.charmap.encodePlain('RATTY');
  gPartyMenu.slotId = 1;
  expect(run('GetSelectedMonNicknameAndSpecies')).toBe(t.d('SPECIES_RATTATA'));
  expect(str(0)).toBe('RATTY');
});

// ------------------------------------------------------------------ struct DayCareMail (W-mail unit 2)

describe('a mon left holding mail (struct DayCareMail)', () => {
  /** Party slot 1 (RATTATA) holding a Retro Mail with words [7, 8], written by RED. */
  function giveMail(): Mail {
    ClearMailData(t.state);
    t.state.playerName = 'RED';
    const id = GiveMailToMon(t.state, t.state.party[1], t.d('ITEM_RETRO_MAIL'));
    t.state.mail[id].words.splice(0, 2, 7, 8);
    return structuredClone(t.state.mail[id]);
  }

  test('StorePokemonInDaycare moves the mail into the DaycareMon; TakeSelectedPokemonFromDaycare gives it back', () => {
    const mail = giveMail();
    t.state.party[1].nickname = t.charmap.encodePlain('RATTY');
    putMonInRoute5Daycare(t.state, 1);
    const daycareMon = t.state.route5DayCareMon;
    expect(daycareMon.mon!.heldItem).toBe(t.d('ITEM_NONE')); // TakeMailFromMon
    expect(daycareMon.mail!.message).toEqual(mail);
    expect(t.charmap.decodePlain(daycareMon.mail!.OT_name)).toBe('RED');
    expect(daycareMon.mail!.OT_name).toHaveLength(8);
    expect(t.charmap.decodePlain(daycareMon.mail!.monName)).toBe('RATTY');
    expect(daycareMon.mail!.monName).toHaveLength(11);
    expect(t.state.mail[0].itemId).toBe(t.d('ITEM_NONE')); // the party slot is free
    // The party's PIDGEY takes slot 0 meanwhile: the mail comes back into the next free one.
    GiveMailToMon(t.state, t.state.party[0], t.d('ITEM_WOOD_MAIL'));
    takePokemonFromRoute5Daycare(t.state);
    const rattata = t.state.party[1];
    expect(rattata.heldItem).toBe(t.d('ITEM_RETRO_MAIL'));
    expect(rattata.mail).toBe(1);
    expect(t.state.mail[1]).toEqual(mail);
    expect(MonHasMail(t.state.defines, rattata)).toBe(true);
    expect(t.state.route5DayCareMon).toEqual({ mon: null, steps: 0 }); // ClearDaycareMonMail
  });

  test('a mon holding another item keeps it, with no DayCareMail', () => {
    ClearMailData(t.state);
    t.state.party[1].heldItem = t.d('ITEM_POTION');
    putMonInRoute5Daycare(t.state, 1);
    expect(t.state.route5DayCareMon.mon!.heldItem).toBe(t.d('ITEM_POTION'));
    expect(t.state.route5DayCareMon.mail).toBeUndefined();
  });

  test('the Four Island daycare: taking out the first mon moves the second up with its mail (ShiftDaycareSlots)', () => {
    const mail = giveMail();
    gPartyMenu.slotId = 0;
    run('StoreSelectedPokemonInDaycare'); // PIDGEY, no mail: slot 0
    gPartyMenu.slotId = 0;
    run('StoreSelectedPokemonInDaycare'); // RATTATA with its mail: slot 1
    expect(t.state.daycare.mons[0].mail).toBeUndefined();
    expect(t.state.daycare.mons[1].mail!.message).toEqual(mail);
    t.state.setVar('VAR_0x8004', 0);
    run('TakePokemonFromDaycare');
    expect(t.state.daycare.mons[0].mon!.species).toBe(t.d('SPECIES_RATTATA'));
    expect(t.state.daycare.mons[0].mail!.message).toEqual(mail);
    expect(t.state.daycare.mons[1]).toEqual({ mon: null, steps: 0 });
    run('TakePokemonFromDaycare');
    expect(t.state.party.map((m) => [m.species, m.heldItem])).toEqual([
      [t.d('SPECIES_PIDGEY'), 0],
      [t.d('SPECIES_RATTATA'), t.d('ITEM_RETRO_MAIL')],
    ]);
    expect(t.state.mail[t.state.party[1].mail!]).toEqual(mail);
  });

  test('DaycareMonReceivedMail: TRUE (names buffered) only when the nickname or the player differs from the stored ones', () => {
    giveMail();
    t.state.party[1].nickname = t.charmap.encodePlain('RATTY');
    gPartyMenu.slotId = 1;
    run('StoreSelectedPokemonInDaycare');
    t.state.setVar('VAR_0x8004', 0);
    expect(run('DaycareMonReceivedMail')).toBe(0);
    t.state.daycare.mons[0].mon!.nickname = t.charmap.encodePlain('RAT');
    expect(run('DaycareMonReceivedMail')).toBe(1);
    expect([str(0), str(1), str(2)]).toEqual(['RAT', 'RED', 'RATTY']);
    t.state.setVar('VAR_0x8004', 1); // the empty slot
    expect(run('DaycareMonReceivedMail')).toBe(0);
  });

  test('the DayCareMail survives the save', () => {
    const mail = giveMail();
    putMonInRoute5Daycare(t.state, 1);
    const data = JSON.parse(JSON.stringify(toSaveData(t.state)));
    const fresh = new GameState(t.state.defines, [], t.pokemon, {});
    fromSaveData(data, fresh);
    expect(fresh.route5DayCareMon.mail).toEqual(t.state.route5DayCareMon.mail);
    expect(fresh.route5DayCareMon.mail!.message).toEqual(mail);
    expect(fresh.daycare.mons[0].mail).toBeUndefined();
  });
});
