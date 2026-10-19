// trainer_tower.c's save record: struct TrainerTower (global.h), gSaveBlock1Ptr->trainerTower[NUM_TOWER_CHALLENGE_TYPES]
// and towerChallengeId (GameState), with the record-time accessors and ResetTrainerTowerResults (NewGameInitData).
// Kept apart from world/trainerTower.ts so GameState can build it without the tower's other imports.

import type { GameState } from './GameState';

/** struct TrainerTower (global.h): gSaveBlock1Ptr->trainerTower[challenge type]. */
export interface TrainerTowerRecord {
  /** VBlanks since the challenge started (SetVBlankCounter1Ptr counts it), capped at TRAINER_TOWER_MAX_TIME */
  timer: number;
  /** The record time. The GBA XORs it with gSaveBlock2Ptr->encryptionKey; the port keeps it plain (no key). */
  bestTime: number;
  floorsCleared: number;
  /** The set id the record belongs to (ValidateOrResetCurTrainerTowerRecord) */
  unk9: number;
  receivedPrize: boolean;
  checkedFinalTime: boolean;
  spokeToOwner: boolean;
  hasLost: boolean;
  /** CHALLENGE_STATUS_UNK: never set (e-Reader) */
  unkA_4: boolean;
  validated: boolean;
}

export function newTrainerTowerRecord(): TrainerTowerRecord {
  return {
    timer: 0,
    bestTime: 0,
    floorsCleared: 0,
    unk9: 0,
    receivedPrize: false,
    checkedFinalTime: false,
    spokeToOwner: false,
    hasLost: false,
    unkA_4: false,
    validated: false,
  };
}

/** GetTrainerTowerRecordTime: `*counter ^ encryptionKey` (no key in the port). */
export function GetTrainerTowerRecordTime(rec: TrainerTowerRecord): number {
  return rec.bestTime;
}

/** SetTrainerTowerRecordTime */
export function SetTrainerTowerRecordTime(rec: TrainerTowerRecord, value: number): void {
  rec.bestTime = value >>> 0;
}

/** ResetTrainerTowerResults (NewGameInitData): every challenge's record time at TRAINER_TOWER_MAX_TIME. */
export function ResetTrainerTowerResults(state: GameState): void {
  for (const rec of state.trainerTower) SetTrainerTowerRecordTime(rec, state.defines.require('TRAINER_TOWER_MAX_TIME'));
}

/** TRAINER_TOWER: gSaveBlock1Ptr->trainerTower[gSaveBlock1Ptr->towerChallengeId] */
export function currentTrainerTowerRecord(state: GameState): TrainerTowerRecord {
  return state.trainerTower[state.towerChallengeId];
}
