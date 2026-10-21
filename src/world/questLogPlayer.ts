// quest_log_player.c's recording half (QuestLogTryRecordPlayerAvatarGfxTransition), the table its playback half
// runs (sQLGfxTransitions: QuestLogUpdatePlayerSprite is in world/playerAvatar.ts with QL_GfxTransition_Normal /
// _Bike / _StartSurf / _StopSurf*; QL_GfxTransition_Fish with Task_QLFishMovement is in world/fishing.ts and
// QL_GfxTransition_VSSeeker with Task_QLVSSeekerMovement in world/vsSeeker.ts, registered here at boot), and
// field_player_avatar.c's quest log helpers (QL_TryRecordPlayerStepWithDuration0, QL_TryRecordNPCStepWithDuration32,
// sQuestLogSurfDismountActionIds) and field_effect.c's VS Seeker recording.

import { K } from '../battle/constants';
import type { ObjectEvent } from '../entities/ObjectEvent';
import type { Direction } from './direction';
import {
  QuestLogRecordNPCStepWithDuration,
  QuestLogRecordPlayerAvatarGfxTransition,
  QuestLogRecordPlayerAvatarGfxTransitionWithDuration,
  QuestLogRecordPlayerStepWithDuration,
  gQL,
  questLogHost,
} from './questLog';

/** QL_PLAYER_GFX_* (quest_log_player.h) */
export const QL_PLAYER_GFX_NORMAL = 0;
export const QL_PLAYER_GFX_BIKE = 1;
export const QL_PLAYER_GFX_FISH = 2;
export const QL_PLAYER_GFX_SURF = 3;
export const QL_PLAYER_GFX_STOP_SURF_S = 4;
export const QL_PLAYER_GFX_STOP_SURF_N = 5;
export const QL_PLAYER_GFX_STOP_SURF_W = 6;
export const QL_PLAYER_GFX_STOP_SURF_E = 7;
export const QL_PLAYER_GFX_VSSEEKER = 8;
export const QL_PLAYER_GFX_NONE = 0xff;

/** sQLGfxTransitions' entries that live with their field code (FISH: fishing.ts, VSSEEKER: vsSeeker.ts). */
const sQLGfxTransitions = new Map<number, () => void>();

/** Registers sQLGfxTransitions[state] (the field modules' registerFieldItems / registerVsSeeker at boot). */
export function registerQLGfxTransition(state: number, transition: () => void): void {
  sQLGfxTransitions.set(state, transition);
}

/** sQLGfxTransitions[state]() for a registered state (QuestLogUpdatePlayerSprite's FISH and VSSEEKER). */
export function QLGfxTransition(state: number): void {
  sQLGfxTransitions.get(state)?.();
}

/** sQuestLogSurfDismountActionIds by direction */
const sQuestLogSurfDismountActionIds: Record<Direction, number> = {
  down: QL_PLAYER_GFX_STOP_SURF_S,
  up: QL_PLAYER_GFX_STOP_SURF_N,
  left: QL_PLAYER_GFX_STOP_SURF_W,
  right: QL_PLAYER_GFX_STOP_SURF_E,
};

/** QuestLogTryRecordPlayerAvatarGfxTransition: only while recording; TRUE if it was. */
export function QuestLogTryRecordPlayerAvatarGfxTransition(state: number): boolean {
  if (gQL.playbackState === K.QL_PLAYBACK_STATE_RECORDING) {
    QuestLogRecordPlayerAvatarGfxTransition(state);
    return true;
  }
  return false;
}

/** CanStopSurfing / SeafoamIslandsB4F_CurrentDumpsPlayerOnLand: the dismount, 16 frames before the next action. */
export function QuestLogRecordSurfDismount(direction: Direction): void {
  QuestLogRecordPlayerAvatarGfxTransitionWithDuration(sQuestLogSurfDismountActionIds[direction], 16);
}

/** FldEff_UseVsSeeker: QuestLogRecordPlayerAvatarGfxTransitionWithDuration(QL_PLAYER_GFX_VSSEEKER, 89) while recording. */
export function QuestLogRecordUseVsSeeker(): void {
  if (gQL.state === K.QL_STATE_RECORDING) QuestLogRecordPlayerAvatarGfxTransitionWithDuration(QL_PLAYER_GFX_VSSEEKER, 89);
}

/** QL_TryRecordPlayerStepWithDuration0: ObjectEventSetHeldMovement on the player, recorded if it took. */
export function QL_TryRecordPlayerStepWithDuration0(player: ObjectEvent, movementAction: number): void {
  if (!player.setHeldMovement(movementAction)) QuestLogRecordPlayerStepWithDuration(movementAction, 0);
}

/** QL_TryRecordNPCStepWithDuration32: the same for an object (the boulder Strength pushes), 32 frames. */
export function QL_TryRecordNPCStepWithDuration32(obj: ObjectEvent, movementAction: number): void {
  if (!obj.setHeldMovement(movementAction)) {
    const id = questLogHost()?.objectIdentity?.(obj);
    QuestLogRecordNPCStepWithDuration(id?.localId ?? 0, id?.mapNum ?? 0, id?.mapGroup ?? 0, movementAction, 32);
  }
}
