// save.c's behaviour on top of the one save slot (state/saveData.ts): LoadGameSave at boot sets gSaveFileStatus,
// TrySavingData writes the game and sets gSaveAttemptStatus. Also new_game.c's gDifferentSaveFile and load_save.c's
// continue-game warp flag (UseContinueGameWarp & co.). These are EWRAM globals on the GBA, so module state here.

import type { GameState } from './GameState';
import { readSave, saveSlotUsed, toSaveData, writeSave, type SaveData } from './saveData';

// include/save.h (the port keeps them as plain numbers so this module needs no Defines; tests check them
// against the extracted constants)
export const SAVE_STATUS_EMPTY = 0;
export const SAVE_STATUS_OK = 1;
export const SAVE_STATUS_INVALID = 2;
export const SAVE_STATUS_ERROR = 0xff;
export const SAVE_NORMAL = 0;
export const SAVE_OVERWRITE_DIFFERENT_FILE = 4;
// include/save_location.h
export const CONTINUE_GAME_WARP = 1 << 0;

export const gSave = {
  /** gSaveFileStatus: what LoadGameSave found in the slot at boot (SAVE_STATUS_*). */
  fileStatus: SAVE_STATUS_EMPTY,
  /** gSaveAttemptStatus: how the last TrySavingData went. */
  attemptStatus: SAVE_STATUS_EMPTY,
  /**
   * gDifferentSaveFile (new_game.c): NewGameInitData sets it, ResetMenuAndMonGlobals (CONTINUE) and the first
   * save of the new file clear it. While set, saving over an existing save warns that it's another game's.
   */
  differentSaveFile: false,
};

/**
 * LoadGameSave(SAVE_NORMAL) at boot: read the slot into memory. Returns the save when it's readable
 * (SAVE_STATUS_OK). A slot that holds something unreadable (another version, broken JSON) is
 * SAVE_STATUS_INVALID, like a save whose sectors fail their checksums.
 */
export function LoadGameSave(storage?: Storage): SaveData | undefined {
  const data = readSave(storage);
  gSave.fileStatus = data ? SAVE_STATUS_OK : saveSlotUsed(storage) ? SAVE_STATUS_INVALID : SAVE_STATUS_EMPTY;
  return data;
}

/**
 * TrySavingData + HandleSavingData: SaveSerializedGame and write the slot. SAVE_OVERWRITE_DIFFERENT_FILE
 * also erases the Hall of Fame sectors on the GBA, which the port doesn't keep. A failed write is
 * SAVE_STATUS_ERROR (DoSaveFailedScreen isn't ported: the caller shows the save error message).
 */
export function TrySavingData(saveType: number, state: GameState, storage?: Storage): number {
  void saveType;
  gSave.attemptStatus = writeSave(toSaveData(state), storage) ? SAVE_STATUS_OK : SAVE_STATUS_ERROR;
  return gSave.attemptStatus;
}

/** UseContinueGameWarp */
export function UseContinueGameWarp(state: GameState): boolean {
  return (state.specialSaveWarpFlags & CONTINUE_GAME_WARP) !== 0;
}

/** ClearContinueGameWarpStatus / ClearContinueGameWarpStatus2 */
export function ClearContinueGameWarpStatus(state: GameState): void {
  state.specialSaveWarpFlags &= ~CONTINUE_GAME_WARP;
}

/** SetContinueGameWarpStatus */
export function SetContinueGameWarpStatus(state: GameState): void {
  state.specialSaveWarpFlags |= CONTINUE_GAME_WARP;
}

/** SetContinueGameWarpStatusToDynamicWarp (SetContinueGameWarpToDynamicWarp + the flag) */
export function SetContinueGameWarpStatusToDynamicWarp(state: GameState): void {
  state.continueGameWarp = state.dynamicWarp && { ...state.dynamicWarp };
  state.specialSaveWarpFlags |= CONTINUE_GAME_WARP;
}
