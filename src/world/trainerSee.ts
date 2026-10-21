import { QL_IsTrainerSightDisabled } from './questLogPlayback';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { towards } from '../script/MovementRunner';
import { DELTA, type Direction } from './direction';

/**
 * Trainer sight and approach (trainer_see.c). Every frame the field's controls are free,
 * CheckForTrainersWantingBattle looks for an unbeaten trainer with a clear line to the player; one
 * that has it gets the trainer battle configured and EventScript_DoTrainerBattleFromApproach
 * started, and its approach task (Task_RunTrainerSeeFuncList) waits until that script's
 * `special EndTrainerApproach` to show the "!" and walk up.
 *
 * Not ported: the disguised (MOVEMENT_TYPE_TREE/MOUNTAIN_DISGUISE) and buried-in-ash trainers
 * (TrainerSeeFunc_*RemoveDisguise / *Ash, sTrainerSeeFuncList2): no FRLG map has one.
 */

/** GetCollisionFlagsAtCoords bits. Bit 0 (outside the movement range) is never needed: see checkPath. */
export const COLLISION_FLAG_IMPASSABLE = 2;
export const COLLISION_FLAG_ELEVATION_MISMATCH = 4;
export const COLLISION_FLAG_OBJECT = 8;

/** An object that might be a trainer: one of the current map's live objects and its template's fields. */
export interface SightCandidate {
  obj: ObjectEvent;
  localId: number;
  trainerType: string;
  /** trainerRange_berryTreeId */
  range: number;
  script: string;
}

export interface TrainerSeeHost {
  readonly player: ObjectEvent;
  /** gObjectEvents: the objects to check, in slot order. */
  sightCandidates(): SightCandidate[];
  /** GetCollisionFlagsAtCoords without bit 0. */
  collisionFlagsAt(obj: ObjectEvent, x: number, y: number, dir: Direction): number;
  /**
   * The trainer of the `trainerbattle` a script starts with (the bytes CheckTrainer reads), and
   * whether its mode is TRAINER_BATTLE_DOUBLE; undefined if the script doesn't start with one.
   */
  trainerScriptBattle(script: string): { trainer: number; double: boolean } | undefined;
  /** FlagGet(TRAINER_FLAGS_START + trainer) */
  trainerFlag(trainer: number): boolean;
  /** GetMonsStateToDoubles() != PLAYER_HAS_TWO_USABLE_MONS */
  cannotDoubleBattle(): boolean;
  /** ConfigureAndSetUpOneTrainerBattle */
  configureAndSetUpOneTrainerBattle(candidate: SightCandidate): void;
  startFieldEffect(fldEff: string, obj: ObjectEvent): boolean;
  /** FieldEffectActiveListContains */
  fieldEffectActive(fldEff: string): boolean;
  /** objEvent->active */
  isActive(obj: ObjectEvent): boolean;
  /**
   * TrainerSeeFunc_PrepareToEngage: SetTrainerMovementType, OverrideMovementTypeForObjectEvent and
   * OverrideTemplateCoordsForObjectEvent, so the trainer stays where it walked to.
   */
  settleTrainer(obj: ObjectEvent, movementType: string): void;
  /**
   * SpawnSpecialObjectEventParameterized(OBJ_EVENT_GFX_YOUNGSTER, ..., LOCALID_CAMERA, at the player,
   * elevation 3), made invisible, and CameraObjectSetFollowedObjectId on it.
   */
  spawnCameraObject(): ObjectEvent;
  /** CameraObjectSetFollowedObjectId(the player) + RemoveObjectEventByLocalIdAndMap(LOCALID_CAMERA). */
  removeCameraObject(): void;
}

/** sDirectionalApproachDistanceFuncs order: DIR_SOUTH, DIR_NORTH, DIR_WEST, DIR_EAST. */
const SIGHT_DIRS: readonly Direction[] = ['down', 'up', 'left', 'right'];

const EXCLAMATION_MARK = 'FLDEFF_EXCLAMATION_MARK_ICON';

/**
 * CheckForTrainersWantingBattle: the approach task of the first trainer that sees the player, after
 * configuring its battle and starting EventScript_DoTrainerBattleFromApproach. Only
 * TRAINER_TYPE_NORMAL and TRAINER_TYPE_BURIED are checked (not SEE_ALL_DIRECTIONS), as in the C. In the quest log's
 * playback, QL_IsTrainerSightDisabled stops it while the actions are stopped or an event's text is up.
 */
export function checkForTrainersWantingBattle(host: TrainerSeeHost): TrainerApproach | undefined {
  if (QL_IsTrainerSightDisabled()) return undefined;
  for (const c of host.sightCandidates()) {
    if (c.trainerType !== 'TRAINER_TYPE_NORMAL' && c.trainerType !== 'TRAINER_TYPE_BURIED') continue;
    const approach = checkTrainer(host, c);
    if (approach) return approach;
  }
  return undefined;
}

/** CheckTrainer */
function checkTrainer(host: TrainerSeeHost, c: SightCandidate): TrainerApproach | undefined {
  const battle = host.trainerScriptBattle(c.script);
  // GetTrainerFlagFromScriptPointer reads the script's bytes whatever they are; every FRLG trainer's
  // script starts with its trainerbattle.
  if (!battle || host.trainerFlag(battle.trainer)) return undefined;
  const approachDistance = getTrainerApproachDistance(host, c);
  if (approachDistance === 0) return undefined;
  if (battle.double && host.cannotDoubleBattle()) return undefined;
  host.configureAndSetUpOneTrainerBattle(c);
  return new TrainerApproach(host, c.obj, approachDistance - 1); // TrainerApproachPlayer
}

/** GetTrainerApproachDistance: how far the trainer walks to the player, 0 if it can't see them. */
function getTrainerApproachDistance(host: TrainerSeeHost, c: SightCandidate): number {
  const { tileX: x, tileY: y } = host.player; // PlayerGetDestCoords
  if (c.trainerType === 'TRAINER_TYPE_NORMAL') {
    // can only see in one direction
    const dir = c.obj.facing;
    return checkPath(host, c.obj, distanceInDirection(c.obj, dir, c.range, x, y), dir);
  }
  for (const dir of SIGHT_DIRS) {
    const approachDistance = distanceInDirection(c.obj, dir, c.range, x, y);
    if (checkPath(host, c.obj, approachDistance, dir)) return approachDistance;
  }
  return 0;
}

/**
 * GetTrainerApproachDistanceSouth/North/West/East: how far the player is from the trainer in `dir`,
 * 0 if they're out of the trainer's sight. (South also gives 0 for a range over 3 while every object
 * event slot is taken, since the camera object then couldn't spawn; slots never run out here.)
 */
function distanceInDirection(trainer: ObjectEvent, dir: Direction, range: number, x: number, y: number): number {
  const { dx, dy } = DELTA[dir];
  if (dx === 0 ? trainer.tileX !== x : trainer.tileY !== y) return 0;
  const d = dx === 0 ? (y - trainer.tileY) * dy : (x - trainer.tileX) * dx;
  return d > 0 && d <= range ? d : 0;
}

/**
 * CheckPathBetweenTrainerAndPlayer: every tile from the trainer's own up to the one before the
 * player must be free (COLLISION_MASK drops the out-of-range bit), and the player's tile must give
 * COLLISION_OBJECT_EVENT with the trainer's movement range cleared, i.e. be reachable and occupied.
 */
function checkPath(host: TrainerSeeHost, trainer: ObjectEvent, approachDistance: number, dir: Direction): number {
  if (approachDistance === 0) return 0;
  const { dx, dy } = DELTA[dir];
  let x = trainer.tileX;
  let y = trainer.tileY;
  for (let i = 0; i <= approachDistance - 1; i++, x += dx, y += dy) {
    if (host.collisionFlagsAt(trainer, x, y, dir) !== 0) return 0;
  }
  // GetCollisionAtCoords: impassable, then elevation mismatch, then an object
  const flags = host.collisionFlagsAt(trainer, x, y, dir);
  if (flags & (COLLISION_FLAG_IMPASSABLE | COLLISION_FLAG_ELEVATION_MISMATCH)) return 0;
  return flags & COLLISION_FLAG_OBJECT ? approachDistance : 0;
}

/**
 * The trainer's approach: Task_RunTrainerSeeFuncList over sTrainerSeeFuncList. Created idle
 * (TrainerSeeFunc_Dummy) by CheckTrainer; `start` is EndTrainerApproach.
 */
export class TrainerApproach {
  /** tFuncId */
  private funcId = 0;
  /** tData5: camera object steps taken */
  private cameraSteps = 0;
  private cameraObject?: ObjectEvent;
  /** SwitchTaskToFollowupFunc has run: Task_DestroyTrainerApproachTask re-enables the script next frame. */
  private followup = false;
  /** Task_DestroyTrainerApproachTask has run (ScriptContext_Enable). */
  done = false;

  // bool8 func(...): TRUE runs the next func at once, FALSE waits for the next frame
  private readonly funcs: (() => boolean)[] = [
    () => false, // TrainerSeeFunc_Dummy
    () => this.startExclMark(),
    () => this.waitExclMark(),
    () => this.trainerApproach(),
    () => this.prepareToEngage(),
    () => this.end(),
    ...new Array<() => boolean>(6).fill(() => false), // disguise and ash funcs (unused in FRLG)
    () => this.offscreenAboveTrainerCreateCameraObj(),
    () => this.offscreenAboveTrainerCameraObjMoveUp(),
    () => this.offscreenAboveTrainerCameraObjMoveDown(),
  ];

  constructor(
    private readonly host: TrainerSeeHost,
    readonly trainer: ObjectEvent,
    /** tTrainerRange: tiles left to walk */
    private range: number,
  ) {}

  /** EndTrainerApproach → StartTrainerApproachWithFollowupTask: returns the script's waitstate. */
  start(): () => boolean {
    this.funcId = 1;
    this.tick();
    return () => this.done;
  }

  /** Task_RunTrainerSeeFuncList, then Task_DestroyTrainerApproachTask once it has switched to it. */
  tick(): void {
    if (this.done) return;
    if (this.followup) {
      this.done = true;
      return;
    }
    if (!this.host.isActive(this.trainer)) {
      this.followup = true;
      return;
    }
    while (this.funcs[this.funcId]());
  }

  private startExclMark(): boolean {
    // FRLG introduces trainers who can see the player from offscreen above.
    if (this.trainer.facing === 'down' && this.range > 2) {
      this.funcId = 12;
    } else {
      this.host.startFieldEffect(EXCLAMATION_MARK, this.trainer);
      this.trainer.face(this.trainer.facing); // GetFaceDirectionMovementAction
      this.funcId++;
    }
    return true;
  }

  private waitExclMark(): boolean {
    if (this.host.fieldEffectActive(EXCLAMATION_MARK)) return false;
    this.funcId++;
    return true;
  }

  private trainerApproach(): boolean {
    if (!this.trainer.isMoving) {
      if (this.range) {
        this.trainer.move(this.trainer.facing, 'walk'); // GetWalkNormalMovementAction
        this.range--;
      } else {
        this.trainer.face(towards(this.trainer, this.host.player)); // MOVEMENT_ACTION_FACE_PLAYER
        this.funcId++;
      }
    }
    return false;
  }

  private prepareToEngage(): boolean {
    if (this.trainer.isMoving) return false;
    // GetTrainerFacingDirectionMovementType
    this.host.settleTrainer(this.trainer, `MOVEMENT_TYPE_FACE_${this.trainer.facing.toUpperCase()}`);
    if (this.host.player.isMoving) return false;
    // CancelPlayerForcedMovement: there's no forced movement yet
    this.funcId++;
    return false;
  }

  private end(): boolean {
    if (!this.host.player.isMoving) this.followup = true; // SwitchTaskToFollowupFunc
    return false;
  }

  // FRLG exclusive: scroll the camera up to reveal a trainer offscreen above

  private offscreenAboveTrainerCreateCameraObj(): boolean {
    this.cameraSteps = 0;
    this.cameraObject = this.host.spawnCameraObject();
    this.funcId++;
    return false;
  }

  private offscreenAboveTrainerCameraObjMoveUp(): boolean {
    const camera = this.cameraObject!;
    if (camera.isMoving) return false;
    if (this.cameraSteps !== this.range - 1) {
      camera.move('up', 'fast'); // GetWalkFastMovementAction
      this.cameraSteps++;
    } else {
      this.host.startFieldEffect(EXCLAMATION_MARK, this.trainer);
      this.cameraSteps = 0;
      this.funcId++;
    }
    return false;
  }

  private offscreenAboveTrainerCameraObjMoveDown(): boolean {
    const camera = this.cameraObject!;
    if (this.host.fieldEffectActive(EXCLAMATION_MARK)) return false;
    if (camera.isMoving) return false;
    if (this.cameraSteps !== this.range - 1) {
      camera.move('down', 'fast');
      this.cameraSteps++;
    } else {
      this.host.removeCameraObject();
      this.cameraObject = undefined;
      this.cameraSteps = 0;
      this.funcId = 2;
    }
    return false;
  }
}
