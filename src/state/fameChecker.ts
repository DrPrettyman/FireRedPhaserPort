// fame_checker.c's save data and specials: struct FameCheckerSaveData (global.h), gSaveBlock1Ptr->fameChecker[
// NUM_FAMECHECKER_PERSONS] (GameState.fameChecker), ResetFameChecker (NewGameInitData), FullyUnlockFameChecker and
// the two specials the `famechecker` script macro calls. Phaser-free (GameState and the specials import it); the
// screen is menus/fameChecker.ts. The tables come from tools/extract_fame_checker.py (public/gen/fameChecker.json,
// set by Assets.init).

import type { GameState } from './GameState';

/** FCPICKSTATE_* (include/constants/fame_checker.h) */
export const FCPICKSTATE_NO_DRAW = 0;
export const FCPICKSTATE_SILHOUETTE = 1;
export const FCPICKSTATE_COLORED = 2;

/** struct FameCheckerSaveData: pickState:2, flavorTextFlags:12 (one bit per flavor text, 6 used), unk_0_E:2 */
export interface FameCheckerSaveData {
  pickState: number;
  flavorTextFlags: number;
  unk_0_E: number;
}

export function newFameCheckerSaveData(): FameCheckerSaveData {
  return { pickState: FCPICKSTATE_NO_DRAW, flavorTextFlags: 0, unk_0_E: 0 };
}

/** public/gen/fameChecker.json (tools/extract_fame_checker.py) */
export interface FameCheckerData {
  /** FC_NONTRAINER_START */
  nonTrainerStart: number;
  /** sTrainerIdxs: FAMECHECKER_* -> TRAINER_* (or FC_NONTRAINER_START + n: OAK, DAISY, BILL, FUJI) */
  trainerIdxs: number[];
  /** sFameCheckerTrainerPicIdxs: FAMECHECKER_* -> TRAINER_PIC_* */
  trainerPicIdxs: number[];
  /** sFameCheckerArrayNpcGraphicsIds: [person * 6 + i] -> OBJ_EVENT_GFX_* */
  npcGraphicsIds: string[];
  /** The palette symbols InitObjectEventPalettes(0) loads into OBJ slots 0-9 (sObjectPaletteTags0) */
  objectPalettes0: (string | null)[];
}

let sData: FameCheckerData | undefined;

/** Assets.init (and the unit tests) hand over fameChecker.json. */
export function initFameCheckerData(data: FameCheckerData): void {
  sData = data;
}

export function fameCheckerData(): FameCheckerData {
  if (!sData) throw new Error('[fame checker] fameChecker.json not loaded');
  return sData;
}

/** ResetFameChecker: nobody drawn, no flavor texts, but OAK in colour. */
export function ResetFameChecker(state: GameState, FAMECHECKER_OAK = 0): void {
  for (const p of state.fameChecker) {
    p.pickState = FCPICKSTATE_NO_DRAW;
    p.flavorTextFlags = 0;
    p.unk_0_E = 0;
  }
  state.fameChecker[FAMECHECKER_OAK].pickState = FCPICKSTATE_COLORED;
}

/** FullyUnlockFameChecker (no caller in FRLG but the debug menu): everyone in colour with all six texts. */
export function FullyUnlockFameChecker(state: GameState): void {
  for (const p of state.fameChecker) {
    p.pickState = FCPICKSTATE_COLORED;
    for (let j = 0; j < 6; j++) p.flavorTextFlags |= 1 << j;
  }
}

/**
 * SetFlavorTextFlagFromSpecialVars (`famechecker person, index`): VAR_0x8004 is the person, VAR_0x8005 the flavor
 * text; sets its flag, then the person is drawn at least as a silhouette (VAR_0x8005 = FCPICKSTATE_SILHOUETTE).
 */
export function SetFlavorTextFlagFromSpecialVars(state: GameState): void {
  const person = state.getVar('VAR_0x8004');
  const index = state.getVar('VAR_0x8005');
  if (person < state.fameChecker.length && index < 6) {
    state.fameChecker[person].flavorTextFlags |= 1 << index;
    state.setVar('VAR_0x8005', FCPICKSTATE_SILHOUETTE);
    UpdatePickStateFromSpecialVar8005(state);
  }
}

/**
 * UpdatePickStateFromSpecialVar8005 (`famechecker person, state, UpdatePickStateFromSpecialVar8005`): VAR_0x8004's
 * pick state becomes VAR_0x8005, but never back to NO_DRAW and never from COLORED down to SILHOUETTE.
 */
export function UpdatePickStateFromSpecialVar8005(state: GameState): void {
  const person = state.getVar('VAR_0x8004');
  const pick = state.getVar('VAR_0x8005');
  if (person < state.fameChecker.length && pick < 3) {
    if (pick === FCPICKSTATE_NO_DRAW) return;
    if (pick === FCPICKSTATE_SILHOUETTE && state.fameChecker[person].pickState === FCPICKSTATE_COLORED) return;
    state.fameChecker[person].pickState = pick;
  }
}
