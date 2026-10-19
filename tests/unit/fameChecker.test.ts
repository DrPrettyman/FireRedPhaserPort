// fame_checker.c's save data and specials (src/state/fameChecker.ts): ResetFameChecker on a new game, the
// `famechecker` macro's SetFlavorTextFlagFromSpecialVars / UpdatePickStateFromSpecialVar8005, the save (version 10),
// and the extracted tables (tools/extract_fame_checker.py) against fame_checker.c.

import { describe, expect, test } from 'vitest';
import {
  FCPICKSTATE_COLORED,
  FCPICKSTATE_NO_DRAW,
  FCPICKSTATE_SILHOUETTE,
  FullyUnlockFameChecker,
  SetFlavorTextFlagFromSpecialVars,
  UpdatePickStateFromSpecialVar8005,
  type FameCheckerData,
} from '../../src/state/fameChecker';
import { fromSaveData, SAVE_VERSION, toSaveData } from '../../src/state/saveData';
import { newGame, readGen } from './gameData';

/** `famechecker person, value[, special]`: setvar VAR_0x8004 / VAR_0x8005, then the special. */
function famechecker(s: ReturnType<typeof newGame>['state'], person: number, value: number, special = SetFlavorTextFlagFromSpecialVars) {
  s.setVar('VAR_0x8004', person);
  s.setVar('VAR_0x8005', value);
  special(s);
}

describe('the Fame Checker save data', () => {
  test('a new game (ResetFameChecker): 16 persons, only OAK drawn, in colour, no texts', () => {
    const { state, d } = newGame();
    expect(state.fameChecker).toHaveLength(d('NUM_FAMECHECKER_PERSONS'));
    expect(state.fameChecker[d('FAMECHECKER_OAK')]).toEqual({ pickState: FCPICKSTATE_COLORED, flavorTextFlags: 0, unk_0_E: 0 });
    expect(state.fameChecker.slice(1).every((p) => p.pickState === FCPICKSTATE_NO_DRAW && p.flavorTextFlags === 0)).toBe(true);
  });

  test('SetFlavorTextFlagFromSpecialVars sets the text\'s bit and draws the person as a silhouette, not over a colour', () => {
    const { state, d } = newGame();
    const BILL = d('FAMECHECKER_BILL');
    famechecker(state, BILL, 0); // CeruleanCity_EventScript_Rival
    expect(state.fameChecker[BILL]).toMatchObject({ pickState: FCPICKSTATE_SILHOUETTE, flavorTextFlags: 0b1 });
    expect(state.getVar('VAR_0x8005')).toBe(FCPICKSTATE_SILHOUETTE);
    famechecker(state, BILL, 5);
    expect(state.fameChecker[BILL].flavorTextFlags).toBe(0b100001);
    // OAK stays in colour
    famechecker(state, d('FAMECHECKER_OAK'), 3);
    expect(state.fameChecker[d('FAMECHECKER_OAK')]).toMatchObject({ pickState: FCPICKSTATE_COLORED, flavorTextFlags: 0b1000 });
    // Out of range: nothing (index >= 6, person >= NUM_FAMECHECKER_PERSONS)
    famechecker(state, BILL, 6);
    famechecker(state, d('NUM_FAMECHECKER_PERSONS'), 0);
    expect(state.fameChecker[BILL].flavorTextFlags).toBe(0b100001);
    expect(state.getVar('VAR_0x8005')).toBe(0);
  });

  test('UpdatePickStateFromSpecialVar8005: never back to NO_DRAW, never from COLORED down to SILHOUETTE', () => {
    const { state, d } = newGame();
    const BROCK = d('FAMECHECKER_BROCK');
    const update = UpdatePickStateFromSpecialVar8005;
    famechecker(state, BROCK, FCPICKSTATE_NO_DRAW, update);
    expect(state.fameChecker[BROCK].pickState).toBe(FCPICKSTATE_NO_DRAW);
    famechecker(state, BROCK, FCPICKSTATE_SILHOUETTE, update);
    expect(state.fameChecker[BROCK].pickState).toBe(FCPICKSTATE_SILHOUETTE);
    famechecker(state, BROCK, FCPICKSTATE_COLORED, update); // PewterCity_Gym_EventScript_Brock
    expect(state.fameChecker[BROCK].pickState).toBe(FCPICKSTATE_COLORED);
    famechecker(state, BROCK, FCPICKSTATE_SILHOUETTE, update);
    famechecker(state, BROCK, FCPICKSTATE_NO_DRAW, update);
    famechecker(state, BROCK, 1); // `famechecker FAMECHECKER_BROCK, 1` after his battle
    expect(state.fameChecker[BROCK]).toMatchObject({ pickState: FCPICKSTATE_COLORED, flavorTextFlags: 0b10 });
    famechecker(state, BROCK, 3, update); // not a pick state
    expect(state.fameChecker[BROCK].pickState).toBe(FCPICKSTATE_COLORED);
  });

  test('FullyUnlockFameChecker: everyone in colour with all six texts', () => {
    const { state } = newGame();
    FullyUnlockFameChecker(state);
    expect(state.fameChecker.every((p) => p.pickState === FCPICKSTATE_COLORED && p.flavorTextFlags === 0x3f)).toBe(true);
  });

  test('the save keeps it; a version 9 save (none) loads with the new-game state', () => {
    const { state, d } = newGame();
    famechecker(state, d('FAMECHECKER_MISTY'), 2);
    famechecker(state, d('FAMECHECKER_GIOVANNI'), FCPICKSTATE_COLORED, UpdatePickStateFromSpecialVar8005);
    const data = toSaveData(state);
    expect(data.version).toBe(SAVE_VERSION);
    const loaded = fromSaveData(JSON.parse(JSON.stringify(data)), newGame().state);
    expect(loaded.fameChecker).toEqual(state.fameChecker);
    const { fameChecker: _fc, ...v9 } = { ...data, version: 9 };
    expect(fromSaveData(v9, newGame().state).fameChecker).toEqual(newGame().state.fameChecker);
  });
});

describe('fameChecker.json (fame_checker.c\'s tables)', () => {
  const data = readGen<FameCheckerData>('fameChecker.json');
  const { d } = newGame();

  test('sTrainerIdxs: the leaders, the Elite Four and Giovanni by TRAINER_*, the others from FC_NONTRAINER_START', () => {
    expect(data.nonTrainerStart).toBe(0xfe00);
    expect(data.trainerIdxs[d('FAMECHECKER_OAK')]).toBe(0xfe00);
    expect(data.trainerIdxs[d('FAMECHECKER_MRFUJI')]).toBe(0xfe03);
    expect(data.trainerIdxs[d('FAMECHECKER_BROCK')]).toBe(d('TRAINER_LEADER_BROCK'));
    expect(data.trainerIdxs[d('FAMECHECKER_LANCE')]).toBe(d('TRAINER_ELITE_FOUR_LANCE'));
    expect(data.trainerIdxs[d('FAMECHECKER_GIOVANNI')]).toBe(d('TRAINER_BOSS_GIOVANNI'));
    expect(data.trainerPicIdxs[d('FAMECHECKER_BILL')]).toBe(d('TRAINER_PIC_PSYCHIC_M'));
    expect(data.trainerPicIdxs[d('FAMECHECKER_SABRINA')]).toBe(d('TRAINER_PIC_LEADER_SABRINA'));
  });

  test('sFameCheckerArrayNpcGraphicsIds: six per person', () => {
    expect(data.npcGraphicsIds).toHaveLength(6 * 16);
    expect(data.npcGraphicsIds.slice(0, 2)).toEqual(['OBJ_EVENT_GFX_SIGN', 'OBJ_EVENT_GFX_PROF_OAK']);
    expect(data.npcGraphicsIds[6 * d('FAMECHECKER_BILL')]).toBe('OBJ_EVENT_GFX_BLUE');
    expect(data.npcGraphicsIds[6 * 15 + 5]).toBe('OBJ_EVENT_GFX_SCIENTIST');
    expect(data.objectPalettes0).toHaveLength(10);
    expect(data.objectPalettes0[2]).toBe('gObjectEventPal_NpcBlue');
  });
});
