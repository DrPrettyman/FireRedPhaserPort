// vs_seeker.c's rematch table lookups (sRematches, extracted to scripts.json `rematches`): the parts that only
// read the table and the trainer flags, kept free of the field (and of Phaser) so ScriptEngine's trainer specials,
// world/vsSeeker.ts and the unit tests share them.
//
// Each row is one trainer's parties: [original, rematch 1, ..., rematch 5]. SKIP marks a story tier where the
// party doesn't change; a row ends at its last party (TRAINER_NONE = 0 past it). A trainer's rematch state
// (gSaveBlock1Ptr->trainerRematches[localId]) holds the index of the party it will use, 0 = no rematch.

import { random } from '../util/random';

/** MAX_REMATCH_PARTIES */
export const MAX_REMATCH_PARTIES = 6;
/** SKIP */
export const SKIP = 0xffff;
const TRAINER_NONE = 0;

/** What the lookups read: the table and the game state. */
export interface RematchEnv {
  /** sRematches[i].trainerIdxs */
  rematches: number[][];
  /** HasTrainerBeenFought: FlagGet(TRAINER_FLAGS_START + trainer) */
  hasTrainerBeenFought(trainer: number): boolean;
  /** FlagGet */
  flagGet(flag: string): boolean;
}

const at = (row: number[], j: number) => row[j] ?? TRAINER_NONE;

/** GetRematchIdx: the row whose original trainer is `trainerFlagIdx`, or -1. */
export function GetRematchIdx(rematches: number[][], trainerFlagIdx: number): number {
  return rematches.findIndex((r) => r[0] === trainerFlagIdx);
}

/** LookupVsSeekerOpponentInArray: the row with `trainerId` among its parties (SKIPs ignored), or -1. */
export function LookupVsSeekerOpponentInArray(rematches: number[][], trainerId: number): number {
  for (let i = 0; i < rematches.length; i++) {
    for (let j = 0; j < MAX_REMATCH_PARTIES; j++) {
      const testTrainerId = at(rematches[i], j);
      if (testTrainerId === TRAINER_NONE) break;
      if (testTrainerId === SKIP) continue;
      if (testTrainerId === trainerId) return i;
    }
  }
  return -1;
}

/**
 * GetNextAvailableRematchTrainer: for the row of original trainer `trainerFlagNo`, the index of the first party
 * not yet beaten (the last one once all are), and the row (`idx`, *idxPtr). index 0: not in the table.
 */
export function GetNextAvailableRematchTrainer(env: RematchEnv, trainerFlagNo: number): { index: number; idx: number } {
  const rows = env.rematches;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] !== trainerFlagNo) continue;
    let j = 1;
    for (; j < MAX_REMATCH_PARTIES; j++) {
      const id = at(rows[i], j);
      if (id === TRAINER_NONE) return { index: j - 1, idx: i };
      if (id === SKIP) continue;
      if (env.hasTrainerBeenFought(id)) continue;
      return { index: j, idx: i };
    }
    return { index: j - 1, idx: i };
  }
  return { index: 0, idx: 0 };
}

/** GetRematchTrainerIdGivenGameState: the next lower party index that isn't SKIP (0 if none). */
function GetRematchTrainerIdGivenGameState(trainerIdxs: number[], rematchIdx: number): number {
  while (--rematchIdx !== 0) {
    if (at(trainerIdxs, rematchIdx) !== SKIP) return rematchIdx;
  }
  return 0;
}

/**
 * TryGetRematchTrainerIdGivenGameState: each tier unlocks with the story (the VS Seeker, Celadon, Fuchsia,
 * the credits, linking with R/S); a locked tier falls back one step (only one: the lower tier's own gate
 * isn't checked again).
 */
const TIER_FLAGS = ['', 'FLAG_GOT_VS_SEEKER', 'FLAG_WORLD_MAP_CELADON_CITY', 'FLAG_WORLD_MAP_FUCHSIA_CITY', 'FLAG_SYS_GAME_CLEAR', 'FLAG_SYS_CAN_LINK_WITH_RS'];

function TryGetRematchTrainerIdGivenGameState(env: RematchEnv, trainerIdxs: number[], rematchIdx: number): number {
  const flag = TIER_FLAGS[rematchIdx];
  if (flag && !env.flagGet(flag)) return GetRematchTrainerIdGivenGameState(trainerIdxs, rematchIdx);
  return rematchIdx;
}

/** GetRematchTrainerId: the party a rematch with original trainer `trainerId` fights (0 if it has none). */
export function GetRematchTrainerId(env: RematchEnv, trainerId: number): number {
  const { index, idx } = GetNextAvailableRematchTrainer(env, trainerId);
  if (!index) return 0;
  const j = TryGetRematchTrainerIdGivenGameState(env, env.rematches[idx], index);
  return at(env.rematches[idx], j);
}

/**
 * ShouldTryRematchBattle (gTrainerBattleOpponent_A = `trainer`, `rematchable` = IsThisTrainerRematchable(
 * gSpecialVar_LastTalked)): a table trainer that the VS Seeker readied, or whose original party was beaten.
 */
export function ShouldTryRematchBattle(env: RematchEnv, trainer: number, rematchable: boolean): boolean {
  // ShouldTryRematchBattleInternal
  const rematchIdx = GetRematchIdx(env.rematches, trainer);
  if (rematchIdx !== -1 && rematchable) return true;
  return HasRematchTrainerAlreadyBeenFought(env, trainer);
}

/** HasRematchTrainerAlreadyBeenFought */
export function HasRematchTrainerAlreadyBeenFought(env: RematchEnv, trainer: number): boolean {
  const rematchIdx = GetRematchIdx(env.rematches, trainer);
  if (rematchIdx === -1) return false;
  return env.hasTrainerBeenFought(env.rematches[rematchIdx][0]);
}

/** IsTrainerReadyForRematchInternal: any party of a table row, and the VS Seeker readied this trainer. */
export function IsTrainerReadyForRematch(env: RematchEnv, trainer: number, rematchable: boolean): boolean {
  const rematchTrainerIdx = LookupVsSeekerOpponentInArray(env.rematches, trainer);
  if (rematchTrainerIdx === -1) return false;
  return rematchable;
}

/** GetRandomFaceDirectionMovementType (one Random()) */
export function GetRandomFaceDirectionMovementType(): string {
  switch (random() % 4) {
    case 0:
      return 'MOVEMENT_TYPE_FACE_UP';
    case 1:
      return 'MOVEMENT_TYPE_FACE_DOWN';
    case 2:
      return 'MOVEMENT_TYPE_FACE_LEFT';
    default:
      return 'MOVEMENT_TYPE_FACE_RIGHT';
  }
}

const JUMPERS = new Set(
  [
    'LITTLE_GIRL',
    'YOUNGSTER',
    'BOY',
    'BUG_CATCHER',
    'LASS',
    'WOMAN_1',
    'CRUSH_GIRL',
    'MAN',
    'ROCKER',
    'WOMAN_2',
    'BEAUTY',
    'BALDING_MAN',
    'TUBER_F',
    'CAMPER',
    'PICNICKER',
    'COOLTRAINER_M',
    'COOLTRAINER_F',
    'SWIMMER_M_LAND',
    'SWIMMER_F_LAND',
    'BLACK_BELT',
    'HIKER',
    'SAILOR',
  ].map((g) => `OBJ_EVENT_GFX_${g}`),
);
const SWIMMERS = new Set(['TUBER_M_WATER', 'SWIMMER_M_WATER', 'SWIMMER_F_WATER'].map((g) => `OBJ_EVENT_GFX_${g}`));

/** GetRunningBehaviorFromGraphicsId: how a trainer who wants a rematch shows it. */
export function GetRunningBehaviorFromGraphicsId(graphicsId: string): string {
  if (JUMPERS.has(graphicsId)) return 'MOVEMENT_TYPE_RAISE_HAND_AND_JUMP';
  if (SWIMMERS.has(graphicsId)) return 'MOVEMENT_TYPE_RAISE_HAND_AND_SWIM';
  return 'MOVEMENT_TYPE_RAISE_HAND_AND_STOP';
}

/** The MOVEMENT_TYPE_RAISE_HAND_AND_* types (ResetMovementOfRematchableTrainers, VsSeekerResetObjectMovementAfterChargeComplete). */
export function IsRaiseHandMovementType(movementType: string): boolean {
  return (
    movementType === 'MOVEMENT_TYPE_RAISE_HAND_AND_STOP' ||
    movementType === 'MOVEMENT_TYPE_RAISE_HAND_AND_JUMP' ||
    movementType === 'MOVEMENT_TYPE_RAISE_HAND_AND_SWIM'
  );
}
