// The VS Seeker: vs_seeker.c's field side (Task_VsSeeker_0..3, GatherNearbyTrainerInfo, GetVsSeekerResponseInArea,
// StartAllRespondantIdleMovements, ClearRematchStateByTrainerId, ResetMovementOfRematchableTrainers and
// EventScript_VsSeekerChargingDone's specials), field_effect.c's FldEff_UseVsSeeker (UseVsSeekerEffect_1..4) and
// field_player_avatar.c's StartPlayerAvatarVsSeekerAnim. The table lookups are world/rematches.ts; the step
// counter (UpdateVsSeekerStepCounter) and MapResetTrainerRematches' state part are world/stepCounters.ts; the
// bag's FieldUseFunc_VsSeeker is menus/itemUse.ts, which reaches Task_VsSeeker_0 through registerVsSeeker.
//
// The player's sprite runs the VS Seeker graphics' anim (sAnimTable_RedGreenVSSeeker[Bike]) through SpriteAnim,
// as fishing does: Phaser draws ObjectEvent sprites without sprite.c's anims. The movement scripts the C starts
// with ScriptMovement_StartObjectMovementScript run here as MovementRunners, each in its own field task.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import type { ObjectEventData } from '../data/types';
import { testEvent } from '../dev/testHooks';
import { SpriteAnim } from '../entities/FieldEffects';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { directionalAction } from '../entities/movementActions';
import { ConvertIntToDecimalStringN, ExpandToStringVar4, gStringVar1, STR_CONV_MODE_LEFT_ALIGN, text } from '../menus/common';
import { registerItemUseFieldFuncs } from '../menus/itemUse';
import { registerSpecials } from '../script/specials';
import { MovementRunner, type Instruction } from '../script/MovementRunner';
import { random } from '../util/random';
import type { Direction } from './direction';
import { FieldEffectActiveListContains, FieldEffectActiveListRemove, FieldEffectStart, registerFieldEffectNatives } from './fieldEffectScripts';
import { DisplayItemMessageOnField, fieldItemsHost } from './fieldItems';
import { CreateTask, fieldMoveHost, LockPlayerFieldControls, UnlockPlayerFieldControls } from './fieldMoves';
import {
  avatarField,
  ClearPlayerHeldMovement,
  GetPlayerAvatarGraphicsIdByStateId,
  gPlayerAvatar,
  HandleEnforcedLookDirectionOnPlayerStopMoving,
  PLAYER_AVATAR_FLAG,
  PlayerGetDestCoords,
  playerObj,
  StopPlayerAvatar,
} from './playerAvatar';
import {
  GetNextAvailableRematchTrainer,
  GetRandomFaceDirectionMovementType,
  GetRunningBehaviorFromGraphicsId,
  IsRaiseHandMovementType,
  LookupVsSeekerOpponentInArray,
  type RematchEnv,
} from './rematches';

/** What the VS Seeker reads and does on the field (OverworldScene.createVsSeekerHost). */
export interface VsSeekerHost {
  /**
   * gSaveBlock1Ptr->objectEventTemplates (the current map's; local id = index + 1), each with the object it
   * spawned while that's out (TryGetObjectEventIdByLocalIdAndMap + ObjectEventIdIsSane).
   */
  objectTemplates(): { localId: number; template: ObjectEventData; obj?: ObjectEvent }[];
  /** gObjectEvents: every NPC on the field, the connected maps' too. */
  objectEvents(): ObjectEvent[];
  /** objectEvent->movementType */
  movementType(obj: ObjectEvent): string | undefined;
  /** SetTrainerMovementType */
  setTrainerMovementType(obj: ObjectEvent, movementType: string): void;
  /** objectEvent->singleMovementActive (the raise-hand jump while in the air) */
  singleMovementActive(obj: ObjectEvent): boolean;
  /** OverrideMovementTypeForObjectEvent: the current map's template for `localId` takes the movement type. */
  setTemplateMovementType(localId: number, movementType: string): void;
  /** GetTrainerFlagFromScript: the trainer of the script's leading `trainerbattle` (0 if it has none). */
  trainerOfScript(script: string): number;
  /** gSelectedObjectEvent */
  selectedObject(): ObjectEvent | undefined;
  /** FieldEffectStart for an effect attached to an object (the emote icons). */
  startFieldEffect(fldEff: string, obj: ObjectEvent): boolean;
  /** sRematches (scripts.json `rematches`) */
  rematches: number[][];
}

let host: VsSeekerHost | undefined;

export function setVsSeekerHost(h: VsSeekerHost): void {
  host = h;
}

function field(): VsSeekerHost {
  if (!host) throw new Error('[vs seeker] no field host');
  return host;
}

/** The rematch table lookups' view of the game. */
function rematchEnv(): RematchEnv {
  return {
    rematches: field().rematches,
    hasTrainerBeenFought: HasTrainerBeenFought,
    flagGet: (flag) => state.getFlag(flag),
  };
}

/** HasTrainerBeenFought */
function HasTrainerBeenFought(trainer: number): boolean {
  return state.getFlag(K.TRAINER_FLAGS_START + trainer);
}

// ------------------------------------------------------------------ constants and state

const VSSEEKER_NOT_CHARGED = 0;
const VSSEEKER_NO_ONE_IN_RANGE = 1;
const VSSEEKER_CAN_USE = 2;

const VSSEEKER_SINGLE_RESP_RAND = 0;
const VSSEEKER_SINGLE_RESP_NO = 1;
const VSSEEKER_SINGLE_RESP_YES = 2;

const VSSEEKER_RESPONSE_NO_RESPONSE = 0;
const VSSEEKER_RESPONSE_UNFOUGHT_TRAINERS = 1;
const VSSEEKER_RESPONSE_FOUND_REMATCHES = 2;

const RESPONSE_NAMES = ['noResponse', 'unfoughtTrainers', 'foundRematches'];

/** struct VsSeekerTrainerInfo (the list ends at the first entry with localId NO_REMATCH_LOCALID; here at its length) */
interface VsSeekerTrainerInfo {
  script: string;
  trainerIdx: number;
  localId: number;
  /** gObjectEvents[objectEventId], if the template's object is out (ObjectEventIdIsSane) */
  obj?: ObjectEvent;
  xCoord: number;
  yCoord: number;
  graphicsId: string;
}

/** struct VsSeekerStruct */
interface VsSeekerStruct {
  trainerInfo: VsSeekerTrainerInfo[];
  trainerIdxArray: number[];
  runningBehaviourEtcArray: string[];
  numRematchableTrainers: number;
  trainerHasNotYetBeenFought: boolean;
  trainerDoesNotWantRematch: boolean;
  trainerWantsRematch: boolean;
  responseCode: number;
}

/** sVsSeeker */
let sVsSeeker: VsSeekerStruct | undefined;

/** The VS Seeker task's func (0..3 = Task_VsSeeker_0..3) and data, while it runs (for the test probe). */
let sTask: { func: number; data: number[]; destroyed: boolean } | undefined;

// sMovementScript_* (MOVEMENT_ACTION_* as movement macros, for MovementRunner)
const sMovementScript_Wait48: Instruction[] = [['delay_16'], ['delay_16'], ['delay_16'], ['step_end']];
const sMovementScript_TrainerUnfought: Instruction[] = [['emote_exclamation_mark'], ['step_end']];
const sMovementScript_TrainerNoRematch: Instruction[] = [['emote_x'], ['step_end']];
const sMovementScript_TrainerRematch: Instruction[] = [['walk_in_place_faster_down'], ['emote_double_exclamation_mark'], ['step_end']];

/** sFaceDirectionMovementTypeByFacingDirection */
const sFaceDirectionMovementTypeByFacingDirection: Record<Direction, string> = {
  down: 'MOVEMENT_TYPE_FACE_DOWN',
  up: 'MOVEMENT_TYPE_FACE_UP',
  left: 'MOVEMENT_TYPE_FACE_LEFT',
  right: 'MOVEMENT_TYPE_FACE_RIGHT',
};

const isTrainerTemplate = (t: ObjectEventData) => t.trainer_type === 'TRAINER_TYPE_NORMAL' || t.trainer_type === 'TRAINER_TYPE_BURIED';

// ------------------------------------------------------------------ script movement

/** The objects' running ScriptMovement_StartObjectMovementScript scripts. */
const sMovements = new Map<ObjectEvent, MovementRunner>();

/**
 * ScriptMovement_StartObjectMovementScript: run a movement script on `obj` in its own task. (The C refuses
 * while that object already has one; so does this.)
 */
function ScriptMovement_StartObjectMovementScript(obj: ObjectEvent, script: Instruction[]): void {
  if (sMovements.has(obj)) return;
  const runner = new MovementRunner(obj, script, 0, playerObj(), (f, o) => field().startFieldEffect(f, o));
  sMovements.set(obj, runner);
  CreateTask(() => {
    runner.tick();
    if (!runner.done) return false;
    sMovements.delete(obj);
    return true;
  });
}

/** ScriptMovement_IsObjectMovementFinished */
function ScriptMovement_IsObjectMovementFinished(obj: ObjectEvent): boolean {
  return !sMovements.has(obj);
}

// ------------------------------------------------------------------ charge complete (EventScript_VsSeekerChargingDone)

/**
 * VsSeekerFreezeObjectsAfterChargeComplete → Task_ResetObjectsRematchWantedState: once the player stands still
 * (facing their way) and no object is mid-jump, StopPlayerAvatar and let the script go on. (Other objects already
 * hold still while a script runs; the raise-hand jump lands first.) Returns the script's `waitstate`.
 */
export function VsSeekerFreezeObjectsAfterChargeComplete(): () => boolean {
  let playerStopped = false;
  let frozen = false;
  let done = false;
  CreateTask(() => {
    if (!playerStopped && IsPlayerStandingStill()) {
      HandleEnforcedLookDirectionOnPlayerStopMoving();
      playerStopped = true;
    }
    if (!frozen) {
      for (const obj of field().objectEvents()) {
        if (field().singleMovementActive(obj)) return false;
      }
    }
    frozen = true;
    if (!playerStopped) return false;
    StopPlayerAvatar();
    done = true; // ScriptContext_Enable
    return true;
  });
  return () => done;
}

/** walkrun_is_standing_still */
function IsPlayerStandingStill(): boolean {
  return gPlayerAvatar.tileTransitionState !== K.T_TILE_TRANSITION && !playerObj().isMoving;
}

/**
 * VsSeekerResetObjectMovementAfterChargeComplete: the current map's trainers that were raising their hands look
 * a random way again (their objects and their templates), and wait for the next VS Seeker.
 */
export function VsSeekerResetObjectMovementAfterChargeComplete(): void {
  for (const { localId, template, obj } of field().objectTemplates()) {
    if (!isTrainerTemplate(template) || !IsRaiseHandMovementType(template.movement_type)) continue;
    const movementType = GetRandomFaceDirectionMovementType();
    if (obj) field().setTrainerMovementType(obj, movementType);
    field().setTemplateMovementType(localId, movementType);
  }
}

// ------------------------------------------------------------------ map changes and battles

/**
 * ResetMovementOfRematchableTrainers (MapResetTrainerRematches, on every map load): any object still raising its
 * hand (e.g. the last map's, across a connection) looks a random way again.
 */
export function ResetMovementOfRematchableTrainers(): void {
  if (!host) return;
  for (const obj of host.objectEvents()) {
    const type = host.movementType(obj);
    if (!type || !IsRaiseHandMovementType(type)) continue;
    const movementType = GetRandomFaceDirectionMovementType();
    host.setTrainerMovementType(obj, movementType); // (x2 = y2 = 0: NpcBrain zeroes them on leaving the type)
  }
}

/**
 * ClearRematchStateByTrainerId (HandleEndTurn_FinishBattle, after any trainer battle; `trainer` is
 * gTrainerBattleOpponent_A): every trainer of the current map in the same rematch row loses its rematch state
 * and stops raising its hand.
 */
export function ClearRematchStateByTrainerId(trainer: number): void {
  if (!host) return;
  const h = host;
  const vsSeekerDataIdx = LookupVsSeekerOpponentInArray(h.rematches, trainer);
  if (vsSeekerDataIdx === -1) return;
  for (const { localId, template, obj } of h.objectTemplates()) {
    if (!isTrainerTemplate(template)) continue;
    if (LookupVsSeekerOpponentInArray(h.rematches, h.trainerOfScript(template.script)) !== vsSeekerDataIdx) continue;
    GetRandomFaceDirectionMovementType(); // (called for nothing, but it rolls the RNG)
    state.trainerRematches[localId] = 0;
    if (!obj) continue; // (the C reads a stale gObjectEvents slot here)
    const faceType = sFaceDirectionMovementTypeByFacingDirection[obj.facing];
    h.setTemplateMovementType(localId, faceType); // OverrideMovementTypeForObjectEvent
    // objectEvent->movementType only: the selected trainer's sprite callback was already set by
    // SetUpTrainerMovement (or the approach), the others' stays as it was.
    if (h.selectedObject() === obj) h.setTrainerMovementType(obj, faceType);
  }
}

// ------------------------------------------------------------------ using it from the bag

/** ItemUseOnFieldCB for the VS Seeker (FieldUseFunc_VsSeeker sets sItemUseOnFieldCB = Task_VsSeeker_0). */
export function Task_VsSeeker_0(): void {
  // On the GBA the start menu's lock is still held when the bag returns; here the field's overlay held the
  // controls until now, so the task takes the lock itself (UseVsSeekerEffect_1 would take it again).
  LockPlayerFieldControls();
  const task = { func: 0, data: new Array<number>(16).fill(0), destroyed: false };
  sTask = task;
  sVsSeeker = {
    trainerInfo: [],
    trainerIdxArray: [],
    runningBehaviourEtcArray: [],
    numRematchableTrainers: 0,
    trainerHasNotYetBeenFought: false,
    trainerDoesNotWantRematch: false,
    trainerWantsRematch: false,
    responseCode: 0,
  };
  GatherNearbyTrainerInfo();
  const respval = CanUseVsSeeker();
  testEvent('vsSeeker', { result: ['notCharged', 'noOneInRange', 'canUse'][respval] });
  if (respval === VSSEEKER_NOT_CHARGED) {
    sVsSeeker = undefined;
    task.destroyed = true;
    DisplayItemMessageOnField(ExpandToStringVar4(text('VSSeeker_Text_BatteryNotChargedNeedXSteps')), Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker);
  } else if (respval === VSSEEKER_NO_ONE_IN_RANGE) {
    sVsSeeker = undefined;
    task.destroyed = true;
    DisplayItemMessageOnField(ExpandToStringVar4(text('VSSeeker_Text_NoTrainersWithinRange')), Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker);
  } else {
    // (ItemUse_SetQuestLogEvent: no quest log.) The item's task runs before FLDEFF_USE_VS_SEEKER's each frame (its
    // priority is 0xFF, the lowest), so Task_VsSeeker_2 sees the effect end the frame after.
    CreateTask(() => {
      if (!task.destroyed) sVsSeekerTaskFuncs[task.func](task);
      return task.destroyed;
    });
    FieldEffectStart('FLDEFF_USE_VS_SEEKER');
    task.func = 1;
    task.data[0] = 15;
  }
}

type VsSeekerTask = NonNullable<typeof sTask>;

function Task_VsSeeker_1(task: VsSeekerTask): void {
  if (--task.data[0] === 0) {
    task.func = 2;
    task.data[1] = 16;
  }
}

function Task_VsSeeker_2(task: VsSeekerTask): void {
  const data = task.data;
  if (data[2] !== 2 && --data[1] === 0) {
    // PlaySE(SE_CONTEST_MONS_TURN): no audio
    data[1] = 11;
    data[2]++;
  }
  if (!FieldEffectActiveListContains('FLDEFF_USE_VS_SEEKER')) {
    data[1] = 0;
    data[2] = 0;
    VsSeekerResetInBagStepCounter();
    sVsSeeker!.responseCode = GetVsSeekerResponseInArea();
    testEvent('vsSeekerResponse', { response: RESPONSE_NAMES[sVsSeeker!.responseCode] });
    ScriptMovement_StartObjectMovementScript(playerObj(), sMovementScript_Wait48);
    task.func = 3;
  }
}

function Task_VsSeeker_3(task: VsSeekerTask): void {
  if (!ScriptMovement_IsObjectMovementFinished(playerObj())) return;
  if (sVsSeeker!.responseCode === VSSEEKER_RESPONSE_NO_RESPONSE) {
    task.destroyed = true; // (DisplayItemMessageOnField's task takes over)
    DisplayItemMessageOnField(ExpandToStringVar4(text('VSSeeker_Text_TrainersNotReady')), Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker);
  } else {
    if (sVsSeeker!.responseCode === VSSEEKER_RESPONSE_FOUND_REMATCHES) StartAllRespondantIdleMovements();
    fieldItemsHost().clearMessageBox(); // ClearDialogWindowAndFrame(0, TRUE)
    ClearPlayerHeldMovementAndUnfreezeObjectEvents();
    UnlockPlayerFieldControls();
    task.destroyed = true;
    testEvent('vsSeekerEnd');
  }
  sVsSeeker = undefined;
}

const sVsSeekerTaskFuncs: ((task: VsSeekerTask) => void)[] = [() => {}, Task_VsSeeker_1, Task_VsSeeker_2, Task_VsSeeker_3];

/** Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker → Task_ItemUse_CloseMessageBoxAndReturnToField */
function Task_ItemUse_CloseMessageBoxAndReturnToField_VsSeeker(): void {
  fieldItemsHost().clearMessageBox(); // ClearDialogWindowAndFrame(0, 1)
  ClearPlayerHeldMovementAndUnfreezeObjectEvents();
  UnlockPlayerFieldControls();
  testEvent('vsSeekerEnd');
}

/** ClearPlayerHeldMovementAndUnfreezeObjectEvents */
function ClearPlayerHeldMovementAndUnfreezeObjectEvents(): void {
  ClearPlayerHeldMovement();
  avatarField().unfreezeObjectEvents();
}

/** VsSeekerResetInBagStepCounter */
function VsSeekerResetInBagStepCounter(): void {
  state.trainerRematchStepCounter &= 0xff00;
}

/** VsSeekerResetChargingStepCounter */
function VsSeekerResetChargingStepCounter(): void {
  state.trainerRematchStepCounter &= 0x00ff;
}

/** GatherNearbyTrainerInfo: the current map's trainers (by template) and where their objects stand. */
function GatherNearbyTrainerInfo(): void {
  const vs = sVsSeeker!;
  for (const { localId, template, obj } of field().objectTemplates()) {
    if (!isTrainerTemplate(template)) continue;
    // (currentCoords - 7: the C's offset, which IsTrainerVisibleOnScreen takes off the player's coords too)
    const at = obj?.current;
    vs.trainerInfo.push({
      script: template.script,
      trainerIdx: field().trainerOfScript(template.script),
      localId,
      obj,
      xCoord: (at?.x ?? 0) - 7,
      yCoord: (at?.y ?? 0) - 7,
      graphicsId: template.graphics_id,
    });
  }
}

/** CanUseVsSeeker: fully charged, and a trainer in range who is unfought or has a rematch left. */
function CanUseVsSeeker(): number {
  const vsSeekerChargeSteps = state.trainerRematchStepCounter & 0xff;
  if (vsSeekerChargeSteps === 100) {
    return GetRematchableTrainerLocalId() === undefined ? VSSEEKER_NO_ONE_IN_RANGE : VSSEEKER_CAN_USE;
  }
  // TV_PrintIntToStringVar(0, 100 - vsSeekerChargeSteps)
  const n = 100 - vsSeekerChargeSteps;
  gStringVar1.set(ConvertIntToDecimalStringN(n, STR_CONV_MODE_LEFT_ALIGN, CountDigits(n)));
  return VSSEEKER_NOT_CHARGED;
}

/** CountDigits (of a positive number) */
function CountDigits(number: number): number {
  return String(Math.trunc(number)).length;
}

/**
 * GetVsSeekerResponseInArea: each trainer in range reacts. Unfought: "!". Beaten with no rematch left, or
 * not wanting one (30%, one Random() each; a trainer already answered for keeps its answer): "X". Wanting one:
 * steps in place facing down, "!!", and its rematch state is set.
 */
function GetVsSeekerResponseInArea(): number {
  const vs = sVsSeeker!;
  const env = rematchEnv();
  for (let vsSeekerIdx = 0; vsSeekerIdx < vs.trainerInfo.length; vsSeekerIdx++) {
    const info = vs.trainerInfo[vsSeekerIdx];
    if (!IsTrainerVisibleOnScreen(info)) continue;
    const trainerIdx = info.trainerIdx;
    if (!HasTrainerBeenFought(trainerIdx)) {
      StartTrainerObjectMovementScript(info, sMovementScript_TrainerUnfought);
      vs.trainerHasNotYetBeenFought = true;
      continue;
    }
    const rematchTrainerIdx = GetNextAvailableRematchTrainer(env, trainerIdx).index;
    if (rematchTrainerIdx === 0) {
      StartTrainerObjectMovementScript(info, sMovementScript_TrainerNoRematch);
      vs.trainerDoesNotWantRematch = true;
      continue;
    }
    let rval = random() % 100; // Even if it's overwritten below, it progresses the RNG.
    const response = GetCurVsSeekerResponse(vsSeekerIdx, trainerIdx);
    if (response === VSSEEKER_SINGLE_RESP_YES) rval = 100;
    else if (response === VSSEEKER_SINGLE_RESP_NO) rval = 0;
    if (rval < 30) {
      StartTrainerObjectMovementScript(info, sMovementScript_TrainerNoRematch);
      vs.trainerDoesNotWantRematch = true;
    } else {
      state.trainerRematches[info.localId] = rematchTrainerIdx;
      // (ShiftStillObjectEventCoords: the object is standing still already)
      StartTrainerObjectMovementScript(info, sMovementScript_TrainerRematch);
      vs.trainerIdxArray[vs.numRematchableTrainers] = trainerIdx;
      vs.runningBehaviourEtcArray[vs.numRematchableTrainers] = GetRunningBehaviorFromGraphicsId(info.graphicsId);
      vs.numRematchableTrainers++;
      vs.trainerWantsRematch = true;
    }
  }
  if (vs.trainerWantsRematch) {
    // PlaySE(SE_PIN): no audio
    state.setFlag('FLAG_SYS_VS_SEEKER_CHARGING', true);
    VsSeekerResetChargingStepCounter();
    return VSSEEKER_RESPONSE_FOUND_REMATCHES;
  }
  if (vs.trainerHasNotYetBeenFought) return VSSEEKER_RESPONSE_UNFOUGHT_TRAINERS;
  return VSSEEKER_RESPONSE_NO_RESPONSE;
}

/** IsTrainerVisibleOnScreen: within 7 tiles across and 5 up or down of the player, and out on the field. */
function IsTrainerVisibleOnScreen(trainerInfo: VsSeekerTrainerInfo): boolean {
  const { x: px, y: py } = PlayerGetDestCoords();
  const x = px - 7;
  const y = py - 7;
  return (
    x - 7 <= trainerInfo.xCoord &&
    x + 7 >= trainerInfo.xCoord &&
    y - 5 <= trainerInfo.yCoord &&
    y + 5 >= trainerInfo.yCoord &&
    ObjectEventIdIsSane(trainerInfo.obj)
  );
}

/** ObjectEventIdIsSane: the object is active on the field. */
function ObjectEventIdIsSane(obj: ObjectEvent | undefined): obj is ObjectEvent {
  return !!obj && obj.sprite.active;
}

/** GetRematchableTrainerLocalId: the first trainer in range who is unfought or has a rematch left. */
function GetRematchableTrainerLocalId(): number | undefined {
  const env = rematchEnv();
  for (const info of sVsSeeker!.trainerInfo) {
    if (!IsTrainerVisibleOnScreen(info)) continue;
    if (!HasTrainerBeenFought(info.trainerIdx) || GetNextAvailableRematchTrainer(env, info.trainerIdx).index) return info.localId;
  }
  return undefined; // NO_REMATCH_LOCALID
}

/** StartTrainerObjectMovementScript: UnfreezeObjectEvent (frozen objects still finish a script's steps here). */
function StartTrainerObjectMovementScript(trainerInfo: VsSeekerTrainerInfo, script: Instruction[]): void {
  if (trainerInfo.obj) ScriptMovement_StartObjectMovementScript(trainerInfo.obj, script);
}

/** GetCurVsSeekerResponse: an earlier trainer in range with the same trainer id already answered. */
function GetCurVsSeekerResponse(vsSeekerIdx: number, trainerIdx: number): number {
  const vs = sVsSeeker!;
  for (let i = 0; i < vsSeekerIdx; i++) {
    const info = vs.trainerInfo[i];
    if (IsTrainerVisibleOnScreen(info) && info.trainerIdx === trainerIdx) {
      for (let j = 0; j < vs.numRematchableTrainers; j++) {
        if (vs.trainerIdxArray[j] === info.trainerIdx) return VSSEEKER_SINGLE_RESP_YES;
      }
      return VSSEEKER_SINGLE_RESP_NO;
    }
  }
  return VSSEEKER_SINGLE_RESP_RAND;
}

/** StartAllRespondantIdleMovements: the trainers who want a rematch raise their hands. */
function StartAllRespondantIdleMovements(): void {
  const vs = sVsSeeker!;
  const env = rematchEnv();
  for (let i = 0; i < vs.numRematchableTrainers; i++) {
    for (const info of vs.trainerInfo) {
      if (info.trainerIdx !== vs.trainerIdxArray[i]) continue;
      if (ObjectEventIdIsSane(info.obj)) field().setTrainerMovementType(info.obj, vs.runningBehaviourEtcArray[i]);
      field().setTemplateMovementType(info.localId, vs.runningBehaviourEtcArray[i]); // OverrideMovementTypeForObjectEvent
      state.trainerRematches[info.localId] = GetNextAvailableRematchTrainer(env, info.trainerIdx).index;
    }
  }
}

// ------------------------------------------------------------------ FLDEFF_USE_VS_SEEKER

/** gSprites[gPlayerAvatar.spriteId]'s anim state while it shows the VS Seeker graphics. */
let sPlayerAnim: SpriteAnim | undefined;

/** FldEff_UseVsSeeker (QuestLogRecordPlayerAvatarGfxTransitionWithDuration: no quest log) */
function FldEff_UseVsSeeker(): number {
  const task = { state: 0, done: false };
  CreateTask(() => {
    sUseVsSeekerEffectFuncs[task.state](task);
    // AnimateSprites, after the tasks: the player's sprite runs its anim and is drawn
    if (sPlayerAnim) {
      sPlayerAnim.animate();
      const player = playerObj();
      player.sprite.setFrame(sPlayerAnim.image);
      player.sprite.setFlipX(sPlayerAnim.hFlip);
    }
    return task.done;
  });
  return 0;
}

type UseVsSeekerTask = { state: number; done: boolean };

function UseVsSeekerEffect_1(task: UseVsSeekerTask): void {
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  gPlayerAvatar.preventStep = true;
  task.state++;
}

function UseVsSeekerEffect_2(task: UseVsSeekerTask): void {
  const player = playerObj();
  if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
    StartPlayerAvatarVsSeekerAnim();
    // ObjectEventSetHeldMovement(MOVEMENT_ACTION_START_ANIM_IN_DIRECTION): StartSpriteAnimInDirection restarts the
    // anim; MovementAction_WaitSpriteAnim waits for it (UseVsSeekerEffect_3).
    task.state++;
  }
}

function UseVsSeekerEffect_3(task: UseVsSeekerTask): void {
  if (!sPlayerAnim?.animEnded) return;
  sPlayerAnim = undefined;
  const player = playerObj();
  let gfx: number;
  if (gPlayerAvatar.flags & (PLAYER_AVATAR_FLAG.ACRO_BIKE | PLAYER_AVATAR_FLAG.MACH_BIKE)) gfx = K.PLAYER_AVATAR_GFX_BIKE;
  else if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.SURFING) gfx = K.PLAYER_AVATAR_GFX_RIDE;
  else gfx = K.PLAYER_AVATAR_GFX_NORMAL;
  setPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(gfx));
  player.forceSetHeldMovement(directionalAction('FACE', player.facing)); // GetFaceDirectionMovementAction
  task.state++;
}

function UseVsSeekerEffect_4(task: UseVsSeekerTask): void {
  if (playerObj().clearHeldMovementIfFinished()) {
    gPlayerAvatar.preventStep = false;
    FieldEffectActiveListRemove('FLDEFF_USE_VS_SEEKER');
    task.done = true;
  }
}

const sUseVsSeekerEffectFuncs = [UseVsSeekerEffect_1, UseVsSeekerEffect_2, UseVsSeekerEffect_3, UseVsSeekerEffect_4];

/** sPlayerAvatarVsSeekerBikeGfxIds */
const sPlayerAvatarVsSeekerBikeGfxIds = ['OBJ_EVENT_GFX_RED_VS_SEEKER_BIKE', 'OBJ_EVENT_GFX_GREEN_VS_SEEKER_BIKE'];

/** GetPlayerAvatarVsSeekerGfxId */
export function GetPlayerAvatarVsSeekerGfxId(): string {
  if (gPlayerAvatar.flags & (PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE)) return sPlayerAvatarVsSeekerBikeGfxIds[gPlayerAvatar.gender];
  return GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_VSSEEKER);
}

/** The VS Seeker-on-the-bike graphics, for the field to preload (PLAYER_AVATAR_GFX_VSSEEKER is the on-foot one). */
export function vsSeekerBikeGraphicsId(gender: number): string {
  return sPlayerAvatarVsSeekerBikeGfxIds[gender];
}

/** StartPlayerAvatarVsSeekerAnim: the VS Seeker graphics and ANIM_VS_SEEKER. */
function StartPlayerAvatarVsSeekerAnim(): void {
  setPlayerGraphics(GetPlayerAvatarVsSeekerGfxId());
  sPlayerAnim = new SpriteAnim(fieldItemsHost().objectEventAnims(playerObj().info.anims) ?? []);
  sPlayerAnim.startAnim(K.ANIM_VS_SEEKER);
}

/** ObjectEventSetGraphicsId on the player (the graphics are preloaded). */
function setPlayerGraphics(gfxId: string): void {
  const info = avatarField().spriteInfo(gfxId);
  if (info) playerObj().setGraphics(info, gfxId);
  else console.warn(`[vs seeker] graphics ${gfxId} not loaded`);
}

// ------------------------------------------------------------------ registration and probes

/** Dev: the VS Seeker task (func 0..3 = Task_VsSeeker_0..3) and the player's anim, for `__test.field().vsSeeker`. */
export function vsSeekerProbe(): { func: number; animNum?: number; image?: number } | undefined {
  if (!sTask || sTask.destroyed) return undefined;
  return { func: sTask.func, ...(sPlayerAnim && { animNum: sPlayerAnim.animNum, image: sPlayerAnim.image }) };
}

/**
 * The bag's side (FieldUseFunc_VsSeeker's checks and Task_VsSeeker_0), FLDEFF_USE_VS_SEEKER's native and
 * EventScript_VsSeekerChargingDone's specials.
 */
export function registerVsSeeker(): void {
  registerItemUseFieldFuncs({
    GetCurrentMapType: () => fieldMoveHost().mapType(),
    GetCurrentMapId: () => fieldMoveHost().mapId(),
    Task_VsSeeker_0,
  });
  registerFieldEffectNatives({ FldEff_UseVsSeeker });
  registerSpecials({
    /** The script's waitstate ends once the player and the raise-hand jumpers stand still. */
    VsSeekerFreezeObjectsAfterChargeComplete: ({ setWaitState }) => setWaitState(VsSeekerFreezeObjectsAfterChargeComplete()),
    VsSeekerResetObjectMovementAfterChargeComplete,
  });
}
