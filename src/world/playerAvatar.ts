// field_player_avatar.c: the player's object (gPlayerAvatar) and how it moves. PlayerStep turns the
// d-pad into held movement actions on the player's ObjectEvent: walking, running, turning on the spot,
// bumping into things, jumping ledges, forced movement (ice, spinners, currents, slides), the bike
// (bike.ts), surfing and pushing Strength boulders. OverworldScene calls UpdatePlayerAvatarTransitionState
// and PlayerStep from its DoCB1_Overworld part, and implements PlayerAvatarHost for the map, the other
// objects and the field's tasks. Like the C, the state is a module global, so specials and item uses
// (TestPlayerAvatarFlags, GetOnOffBike, ...) reach it directly.
//
// Not here: fishing (StartFishing, Task_Fishing: world/fishing.ts), the teleport warp-out/in spin
// (field moves). Not ported: the warp arrow sprite (HandleWarpArrowSpriteHideShow), the quest log's recordings,
// and the Acro Bike / secret base mat functions, which FRLG's metatile behaviours never trigger.

import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { SpriteInfo } from '../data/types';
import type { Button } from '../input/Input';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { directionalAction, movementAction } from '../entities/movementActions';
import type { Behaviors } from './behaviors';
import { BikeClearState, Bike_HandleBumpySlopeJump, Bike_UpdateBikeCounterSpeed, IsRunningDisallowed, MovePlayerOnBike } from './bike';
import { DELTA, type Direction } from './direction';
import { Overworld_ChangeMusicToDefault, Overworld_ClearSavedMusic } from '../gba/overworldMusic'; // CreateStopSurfingTask (W-sound 3)
import { SetHelpContext, SetHelpContextForMap } from '../ui/helpSystemContext';

/** A d-pad direction, or DIR_NONE. */
export type Dir = Direction | undefined;

/** gMain.newKeys / heldKeys as PlayerStep reads them. */
export interface Keys {
  held(b: Button): boolean;
  pressed(b: Button): boolean;
}

/** What the avatar needs from the field. Implemented by OverworldScene. */
export interface PlayerAvatarHost {
  readonly player: ObjectEvent;
  readonly behaviors: Behaviors;
  /** MapGridGetMetatileBehaviorAt (world coords) */
  behaviorAt(x: number, y: number): number;
  /** MapGridGetElevationAt */
  elevationAt(x: number, y: number): number;
  /** GetCollisionAtCoords: a COLLISION_* value. */
  collisionAt(obj: ObjectEvent, x: number, y: number, dir: Direction): number;
  /** GetObjectEventIdByXY: an object standing on (x, y), at any elevation. */
  objectAt(x: number, y: number): ObjectEvent | undefined;
  /** GetObjectEventIdByPosition: an object on (x, y) at a compatible elevation. */
  objectAtPosition(x: number, y: number, elevation: number): ObjectEvent | undefined;
  /** gObjectEvents[i].graphicsId */
  graphicsIdOf(obj: ObjectEvent): string | undefined;
  flag(name: string): boolean;
  /** gMapHeader.allowRunning */
  allowRunning(): boolean;
  /** gMapHeader.bikingAllowed (Overworld_IsBikingAllowed) */
  allowCycling(): boolean;
  /** The current map's MAP_* id (gSaveBlock1Ptr->location) */
  mapId(): string;
  /** The graphics of an OBJ_EVENT_GFX_* id, loaded in advance so ObjectEventSetGraphicsId can be synchronous. */
  spriteInfo(gfxId: string): SpriteInfo | undefined;
  lockPlayerFieldControls(): void;
  unlockPlayerFieldControls(): void;
  freezeObjectEvents(): void;
  unfreezeObjectEvents(): void;
  /** CreateTask: `tick` runs once a frame with the field's tasks until it returns true. */
  createTask(tick: () => boolean): void;
  /** FieldEffectStart(FLDEFF_DUST) at a tile (Task_BumpBoulder's dust). */
  startDust(x: number, y: number, elevation: number, priority: number): void;
  /**
   * The surf blob (world/surf.ts): FLDEFF_SURF_BLOB for the surfing player (QL_GfxTransition_StartSurf),
   * SetSurfBlob_BobState(BOB_MON_ONLY) when jumping off, DestroySprite once off, and SetPlayerInvisibility's
   * part. Optional, so a field without Surf still runs.
   */
  startSurfBlob?(): void;
  stopSurfBlob?(): void;
  destroySurfBlob?(): void;
  setSurfBlobInvisible?(invisible: boolean): void;
  /** HandleBoulderFallThroughHole + HandleBoulderActivateVictoryRoadSwitch, after a boulder's push. */
  boulderPushed(boulder: ObjectEvent): void;
  /** gPlayerParty: whether a party mon knows MOVE_SURF (PartyHasMonWithSurf) */
  partyKnowsSurf(): boolean;
}

/** struct PlayerAvatar */
export const gPlayerAvatar = {
  flags: 0,
  transitionFlags: 0,
  runningState: 0,
  tileTransitionState: 0,
  gender: 0,
  acroBikeState: 0,
  newDirBackup: undefined as Dir,
  bikeFrameCounter: 0,
  bikeSpeed: 0,
  directionHistory: 0,
  abStartSelectHistory: 0,
  dirTimerHistory: [0, 0, 0, 0, 0, 0, 0, 0],
  lastSpinTile: 0,
  /** preventStep: a task (boulder, getting off a mon) has the player; PlayerStep does nothing. */
  preventStep: false,
};

let host: PlayerAvatarHost | undefined;

export function setPlayerAvatarHost(h: PlayerAvatarHost): void {
  host = h;
}

export function avatarField(): PlayerAvatarHost {
  if (!host) throw new Error('[avatar] no field');
  return host;
}

export function playerObj(): ObjectEvent {
  return avatarField().player;
}

const F = {
  get ON_FOOT() {
    return K.PLAYER_AVATAR_FLAG_ON_FOOT;
  },
  get MACH_BIKE() {
    return K.PLAYER_AVATAR_FLAG_MACH_BIKE;
  },
  get ACRO_BIKE() {
    return K.PLAYER_AVATAR_FLAG_ACRO_BIKE;
  },
  get SURFING() {
    return K.PLAYER_AVATAR_FLAG_SURFING;
  },
  get UNDERWATER() {
    return K.PLAYER_AVATAR_FLAG_UNDERWATER;
  },
  get CONTROLLABLE() {
    return K.PLAYER_AVATAR_FLAG_CONTROLLABLE;
  },
  get FORCED() {
    return K.PLAYER_AVATAR_FLAG_FORCED;
  },
  get DASH() {
    return K.PLAYER_AVATAR_FLAG_DASH;
  },
};
export { F as PLAYER_AVATAR_FLAG };

// ------------------------------------------------------------------ PlayerStep

/** player_step / PlayerStep: one frame of the player's own movement, while the field controls are free. */
export function PlayerStep(direction: Dir, keys: Keys): void {
  const player = playerObj();
  // HandleWarpArrowSpriteHideShow: the warp arrow sprite isn't ported
  if (!gPlayerAvatar.preventStep && !TryUpdatePlayerSpinDirection()) {
    if (!TryInterruptObjectEventSpecialAnim(player, direction)) {
      npc_clear_strange_bits(player);
      DoPlayerAvatarTransition();
      if (!TryDoMetatileBehaviorForcedMovement()) {
        MovePlayerAvatarUsingKeypadInput(direction, keys);
        PlayerAllowForcedMovementIfMovingSameDirection();
      }
    }
  }
}

/**
 * TryInterruptObjectEventSpecialAnim: a held movement blocks the step until it's finished, except that a
 * bump (walking in place slowly into a wall) gives way to a new direction.
 */
function TryInterruptObjectEventSpecialAnim(player: ObjectEvent, direction: Dir): boolean {
  if (player.movementOverridden && !player.clearHeldMovementIfFinished()) {
    const id = player.heldMovementActionId;
    if (id > K.MOVEMENT_ACTION_WALK_FAST_RIGHT && id < K.MOVEMENT_ACTION_WALK_IN_PLACE_NORMAL_DOWN) {
      if (direction !== undefined && player.movementDirection !== direction) {
        player.clearHeldMovement();
        return false;
      }
    }
    return true;
  }
  return false;
}

/** npc_clear_strange_bits */
function npc_clear_strange_bits(player: ObjectEvent): void {
  // (objEvent->inanimate is always FALSE for the player)
  player.disableAnim = false;
  player.facingDirectionLocked = false;
  gPlayerAvatar.flags &= ~F.DASH;
}

function MovePlayerAvatarUsingKeypadInput(direction: Dir, keys: Keys): void {
  if (gPlayerAvatar.flags & F.MACH_BIKE || gPlayerAvatar.flags & F.ACRO_BIKE) MovePlayerOnBike(direction, keys);
  else MovePlayerNotOnBike(direction, keys);
}

function PlayerAllowForcedMovementIfMovingSameDirection(): void {
  if (gPlayerAvatar.runningState === K.MOVING) gPlayerAvatar.flags &= ~F.CONTROLLABLE;
}

/** TryUpdatePlayerSpinDirection: while spinning, each finished step re-applies the last spin tile. */
function TryUpdatePlayerSpinDirection(): boolean {
  const b = avatarField().behaviors;
  if (gPlayerAvatar.flags & F.FORCED && b.isSpinTile(gPlayerAvatar.lastSpinTile)) {
    const player = playerObj();
    if (player.heldMovementFinished) {
      if (b.is(player.currentMetatileBehavior, 'STOP_SPINNING')) return false;
      if (b.isSpinTile(player.currentMetatileBehavior)) gPlayerAvatar.lastSpinTile = player.currentMetatileBehavior;
      player.clearHeldMovement();
      PlayerApplyTileForcedMovement(gPlayerAvatar.lastSpinTile);
    }
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ forced movement

type MovementAction = (direction: Direction) => void;

/** sForcedMovementFuncs: [MB_* (or a predicate), ForcedMovement_*] */
const sForcedMovementFuncs: [(b: Behaviors, behavior: number) => boolean, () => boolean][] = [
  [(b, m) => b.is(m, 'TRICK_HOUSE_PUZZLE_8_FLOOR'), ForcedMovement_Slip], // MetatileBehavior_IsTrickHouseSlipperyFloor
  [(b, m) => b.is(m, 'ICE'), ForcedMovement_Slip], // MetatileBehavior_IsIce_2
  [(b, m) => b.is(m, 'WALK_SOUTH'), () => DoForcedMovement('down', PlayerWalkNormal)],
  [(b, m) => b.is(m, 'WALK_NORTH'), () => DoForcedMovement('up', PlayerWalkNormal)],
  [(b, m) => b.is(m, 'WALK_WEST'), () => DoForcedMovement('left', PlayerWalkNormal)],
  [(b, m) => b.is(m, 'WALK_EAST'), () => DoForcedMovement('right', PlayerWalkNormal)],
  [(b, m) => b.is(m, 'SOUTHWARD_CURRENT'), () => DoForcedMovement('down', PlayerRideWaterCurrent)],
  [(b, m) => b.is(m, 'NORTHWARD_CURRENT'), () => DoForcedMovement('up', PlayerRideWaterCurrent)],
  [(b, m) => b.is(m, 'WESTWARD_CURRENT'), () => DoForcedMovement('left', PlayerRideWaterCurrent)],
  [(b, m) => b.is(m, 'EASTWARD_CURRENT'), () => DoForcedMovement('right', PlayerRideWaterCurrent)],
  [(b, m) => b.is(m, 'SPIN_RIGHT'), () => (PlaySpinSound(), DoForcedMovement('right', PlayerGoSpin))], // ForcedMovement_SpinRight
  [(b, m) => b.is(m, 'SPIN_LEFT'), () => (PlaySpinSound(), DoForcedMovement('left', PlayerGoSpin))],
  [(b, m) => b.is(m, 'SPIN_UP'), () => (PlaySpinSound(), DoForcedMovement('up', PlayerGoSpin))],
  [(b, m) => b.is(m, 'SPIN_DOWN'), () => (PlaySpinSound(), DoForcedMovement('down', PlayerGoSpin))],
  [(b, m) => b.is(m, 'SLIDE_SOUTH'), () => ForcedMovement_Slide('down', PlayerWalkFast)],
  [(b, m) => b.is(m, 'SLIDE_NORTH'), () => ForcedMovement_Slide('up', PlayerWalkFast)],
  [(b, m) => b.is(m, 'SLIDE_WEST'), () => ForcedMovement_Slide('left', PlayerWalkFast)],
  [(b, m) => b.is(m, 'SLIDE_EAST'), () => ForcedMovement_Slide('right', PlayerWalkFast)],
  [(b, m) => b.is(m, 'WATERFALL'), () => DoForcedMovement('down', PlayerRideWaterCurrent)], // ForcedMovement_PushedSouthByCurrent
  // MetatileBehavior_IsSecretBaseJumpMat / IsSecretBaseSpinMat are FALSE in FRLG (ForcedMovement_MatJump/MatSpin)
];

/** TryDoMetatileBehaviorForcedMovement: the tile under an uncontrollable player moves them on. */
function TryDoMetatileBehaviorForcedMovement(): boolean {
  if (!(gPlayerAvatar.flags & F.CONTROLLABLE)) {
    const behavior = playerObj().currentMetatileBehavior;
    for (const [check, apply] of sForcedMovementFuncs) {
      if (check(avatarField().behaviors, behavior)) {
        gPlayerAvatar.lastSpinTile = behavior;
        return apply();
      }
    }
  }
  return ForcedMovement_None();
}

function ForcedMovement_None(): boolean {
  if (gPlayerAvatar.flags & F.FORCED) {
    const player = playerObj();
    player.facingDirectionLocked = false;
    player.enableAnim = true;
    player.face(player.facing); // SetObjectEventDirection(playerObjEvent, playerObjEvent->facingDirection)
    gPlayerAvatar.flags &= ~F.FORCED;
  }
  return false;
}

/** DoForcedMovement */
function DoForcedMovement(direction: Direction, movementAction: MovementAction): boolean {
  const collision = CheckForPlayerAvatarCollision(direction);
  gPlayerAvatar.flags |= F.FORCED;
  if (collision) {
    ForcedMovement_None();
    if (collision < K.COLLISION_STOP_SURFING) return false;
    if (collision === K.COLLISION_LEDGE_JUMP) PlayerJumpLedge(direction);
    gPlayerAvatar.flags |= F.FORCED;
    gPlayerAvatar.runningState = K.MOVING;
    return true;
  }
  gPlayerAvatar.runningState = K.MOVING;
  movementAction(direction);
  return true;
}

/** ForcedMovement_Slip (ice): on in the direction already moving, without the walking animation. */
function ForcedMovement_Slip(): boolean {
  const player = playerObj();
  player.disableAnim = true;
  return DoForcedMovement(player.movementDirection, PlayerWalkFast);
}

/** ForcedMovement_Slide */
function ForcedMovement_Slide(direction: Direction, movementAction: MovementAction): boolean {
  const player = playerObj();
  player.disableAnim = true;
  player.facingDirectionLocked = true;
  return DoForcedMovement(direction, movementAction);
}

/** PlayerApplyTileForcedMovement */
function PlayerApplyTileForcedMovement(behavior: number): void {
  for (const [check, apply] of sForcedMovementFuncs) if (check(avatarField().behaviors, behavior)) apply();
}

/** CancelPlayerForcedMovement */
export function CancelPlayerForcedMovement(): void {
  ForcedMovement_None();
}

// ------------------------------------------------------------------ on foot

/** MovePlayerNotOnBike */
export function MovePlayerNotOnBike(direction: Dir, keys: Keys): void {
  switch (CheckMovementInputNotOnBike(direction)) {
    case 0:
      return PlayerFaceDirection(GetPlayerFacingDirection()); // PlayerNotOnBikeNotMoving
    case 1:
      return PlayerTurnInPlace(direction!); // PlayerNotOnBikeTurningInPlace
    default:
      return PlayerNotOnBikeMoving(direction!, keys);
  }
}

/** CheckMovementInputNotOnBike: 0 still, 1 turning on the spot, 2 moving. */
function CheckMovementInputNotOnBike(direction: Dir): number {
  if (direction === undefined) {
    gPlayerAvatar.runningState = K.NOT_MOVING;
    return 0;
  }
  if (direction !== GetPlayerMovementDirection() && gPlayerAvatar.runningState !== K.MOVING) {
    gPlayerAvatar.runningState = K.TURN_DIRECTION;
    return 1;
  }
  gPlayerAvatar.runningState = K.MOVING;
  return 2;
}

function PlayerNotOnBikeMoving(direction: Direction, keys: Keys): void {
  const collision = CheckForPlayerAvatarCollision(direction);
  if (collision !== K.COLLISION_NONE) {
    if (collision === K.COLLISION_LEDGE_JUMP) PlayerJumpLedge(direction);
    else if (collision === K.COLLISION_DIRECTIONAL_STAIR_WARP) PlayerFaceDirection(direction);
    else if (collision !== K.COLLISION_STOP_SURFING && collision !== K.COLLISION_PUSHED_BOULDER) PlayerNotOnBikeCollide(direction);
    return;
  }
  if (gPlayerAvatar.flags & F.SURFING) {
    PlayerWalkFast(direction); // same speed as running
    return;
  }
  if (keys.held('B') && avatarField().flag('FLAG_SYS_B_DASH') && !IsRunningDisallowed(playerObj().currentMetatileBehavior)) {
    if (PlayerIsMovingOnRockStairs(direction)) PlayerRunSlow(direction);
    else PlayerRun(direction);
    gPlayerAvatar.flags |= F.DASH;
  } else if (PlayerIsMovingOnRockStairs(direction)) {
    PlayerWalkSlow(direction);
  } else {
    PlayerWalkNormal(direction);
  }
}

/** PlayerIsMovingOnRockStairs */
export function PlayerIsMovingOnRockStairs(direction: Direction): boolean {
  const { x, y } = playerObj().current;
  const b = avatarField().behaviors;
  if (direction === 'up') return b.is(avatarField().behaviorAt(x, y), 'ROCK_STAIRS');
  if (direction === 'down') return b.is(avatarField().behaviorAt(x, y + 1), 'ROCK_STAIRS');
  return false;
}

// ------------------------------------------------------------------ collision

/** CheckForPlayerAvatarCollision */
export function CheckForPlayerAvatarCollision(direction: Direction): number {
  const player = playerObj();
  const { x, y } = player.current;
  if (avatarField().behaviors.isDirectionalStairWarp(avatarField().behaviorAt(x, y), direction)) return K.COLLISION_DIRECTIONAL_STAIR_WARP;
  const { dx, dy } = DELTA[direction];
  return CheckForObjectEventCollision(player, x + dx, y + dy, direction, avatarField().behaviorAt(x + dx, y + dy));
}

/** CheckForObjectEventCollision: GetCollisionAtCoords, then getting off a surfing mon, ledges and boulders. */
export function CheckForObjectEventCollision(obj: ObjectEvent, x: number, y: number, direction: Direction, _behavior: number): number {
  let collision = avatarField().collisionAt(obj, x, y, direction);
  if (collision === K.COLLISION_ELEVATION_MISMATCH && CanStopSurfing(x, y, direction)) return K.COLLISION_STOP_SURFING;
  if (ShouldJumpLedge(x, y, direction)) return K.COLLISION_LEDGE_JUMP; // (GAME_STAT_JUMPED_DOWN_LEDGES isn't kept)
  if (collision === K.COLLISION_OBJECT_EVENT && TryPushBoulder(x, y, direction)) return K.COLLISION_PUSHED_BOULDER;
  // CheckAcroBikeCollision: FRLG's rail / bumpy slope behaviours are all FALSE
  return collision;
}

/** CanStopSurfing: surfing into land at elevation 3 with nobody there gets the player off (CreateStopSurfingTask). */
function CanStopSurfing(x: number, y: number, direction: Direction): boolean {
  if (gPlayerAvatar.flags & F.SURFING && avatarField().elevationAt(x, y) === 3 && !avatarField().objectAtPosition(x, y, 3)) {
    CreateStopSurfingTask(direction);
    return true;
  }
  return false;
}

/** ShouldJumpLedge (GetLedgeJumpDirection): the tile ahead is a ledge facing this way. */
function ShouldJumpLedge(x: number, y: number, direction: Direction): boolean {
  return avatarField().behaviors.isJump(avatarField().behaviorAt(x, y), direction);
}

/** TryPushBoulder: with Strength in use, a boulder ahead moves on if the tile behind it is free. */
function TryPushBoulder(x: number, y: number, direction: Direction): boolean {
  const f = avatarField();
  if (!f.flag('FLAG_SYS_USE_STRENGTH')) return false;
  const boulder = f.objectAt(x, y);
  if (!boulder || f.graphicsIdOf(boulder) !== 'OBJ_EVENT_GFX_PUSHABLE_BOULDER') return false;
  const { dx, dy } = DELTA[direction];
  const bx = boulder.current.x + dx;
  const by = boulder.current.y + dy;
  const behavior = f.behaviorAt(bx, by);
  if (f.behaviors.is(behavior, 'FALL_WARP') || (f.collisionAt(boulder, bx, by, direction) === K.COLLISION_NONE && !f.behaviors.is(behavior, 'CAVE_DOOR'))) {
    StartStrengthAnim(boulder, direction);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ transitions (graphics and state)

/** SetPlayerAvatarTransitionFlags */
export function SetPlayerAvatarTransitionFlags(flags: number): void {
  gPlayerAvatar.transitionFlags |= flags;
  DoPlayerAvatarTransition();
}

/** sPlayerAvatarTransitionFuncs, by PLAYER_AVATAR_STATE_* bit */
const sPlayerAvatarTransitionFuncs: (() => void)[] = [
  PlayerAvatarTransition_Normal,
  PlayerAvatarTransition_Bike, // MACH_BIKE
  PlayerAvatarTransition_Bike, // ACRO_BIKE
  PlayerAvatarTransition_Surfing,
  () => {}, // PlayerAvatarTransition_Underwater
  PlayerAvatarTransition_ReturnToField, // CONTROLLABLE
  () => {}, // FORCED: PlayerAvatarTransition_Dummy
  () => {}, // DASH
];

/** DoPlayerAvatarTransition */
function DoPlayerAvatarTransition(): void {
  let flags = gPlayerAvatar.transitionFlags;
  if (flags !== 0) {
    for (let i = 0; i < sPlayerAvatarTransitionFuncs.length; i++, flags >>= 1) {
      if (flags & 1) sPlayerAvatarTransitionFuncs[i]();
    }
    gPlayerAvatar.transitionFlags = 0;
  }
}

/** PlayerAvatarTransition_Normal → QL_GfxTransition_Normal */
function PlayerAvatarTransition_Normal(): void {
  const player = playerObj();
  SetPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_NORMAL));
  player.face(player.movementDirection); // ObjectEventTurn
  SetPlayerAvatarStateMask(F.ON_FOOT);
}

/** PlayerAvatarTransition_Bike → QL_GfxTransition_Bike, then BikeClearState */
function PlayerAvatarTransition_Bike(): void {
  const player = playerObj();
  SetPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_BIKE));
  player.face(player.movementDirection);
  SetPlayerAvatarStateMask(F.MACH_BIKE);
  BikeClearState(0, 0); // QL_GfxTransition_Bike's
  BikeClearState(0, 0); // PlayerAvatarTransition_Bike's own
}

/** PlayerAvatarTransition_Surfing → QL_GfxTransition_StartSurf */
function PlayerAvatarTransition_Surfing(): void {
  if (gPlayerAvatar.flags & F.SURFING) return;
  const player = playerObj();
  SetPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_RIDE));
  player.face(player.movementDirection);
  SetPlayerAvatarStateMask(F.SURFING);
  avatarField().startSurfBlob?.(); // FieldEffectStart(FLDEFF_SURF_BLOB) + SetSurfBlob_BobState(BOB_PLAYER_AND_MON)
}

function PlayerAvatarTransition_ReturnToField(): void {
  gPlayerAvatar.flags |= F.CONTROLLABLE;
}

/** ObjectEventSetGraphicsId on the player */
function SetPlayerGraphics(gfxId: string): void {
  const info = avatarField().spriteInfo(gfxId);
  if (info) playerObj().setGraphics(info, gfxId);
  else console.warn('[avatar] graphics not loaded:', gfxId);
}

/** sPlayerAvatarGfxIds[state][gender] */
const sPlayerAvatarGfxIds = [
  ['OBJ_EVENT_GFX_RED_NORMAL', 'OBJ_EVENT_GFX_GREEN_NORMAL'],
  ['OBJ_EVENT_GFX_RED_BIKE', 'OBJ_EVENT_GFX_GREEN_BIKE'],
  ['OBJ_EVENT_GFX_RED_SURF', 'OBJ_EVENT_GFX_GREEN_SURF'],
  ['OBJ_EVENT_GFX_RED_FIELD_MOVE', 'OBJ_EVENT_GFX_GREEN_FIELD_MOVE'],
  ['OBJ_EVENT_GFX_RED_FISH', 'OBJ_EVENT_GFX_GREEN_FISH'],
  ['OBJ_EVENT_GFX_RED_VS_SEEKER', 'OBJ_EVENT_GFX_GREEN_VS_SEEKER'],
];

/** Every graphics id the avatar can switch to, for preloading. */
export function playerAvatarGraphicsIds(gender: number): string[] {
  return sPlayerAvatarGfxIds.map((ids) => ids[gender]);
}

/** GetPlayerAvatarGraphicsIdByStateIdAndGender */
export function GetPlayerAvatarGraphicsIdByStateIdAndGender(state: number, gender: number): string {
  return sPlayerAvatarGfxIds[state][gender];
}

/** GetPlayerAvatarGraphicsIdByStateId */
export function GetPlayerAvatarGraphicsIdByStateId(state: number): string {
  return GetPlayerAvatarGraphicsIdByStateIdAndGender(state, gPlayerAvatar.gender);
}

/** sPlayerAvatarGfxToStateFlag[gender]: [graphics id, flag name] */
const sPlayerAvatarGfxToStateFlag: [string, keyof typeof F][][] = [
  [
    ['OBJ_EVENT_GFX_RED_NORMAL', 'ON_FOOT'],
    ['OBJ_EVENT_GFX_RED_BIKE', 'MACH_BIKE'],
    ['OBJ_EVENT_GFX_RED_SURF', 'SURFING'],
  ],
  [
    ['OBJ_EVENT_GFX_GREEN_NORMAL', 'ON_FOOT'],
    ['OBJ_EVENT_GFX_GREEN_BIKE', 'MACH_BIKE'],
    ['OBJ_EVENT_GFX_GREEN_SURF', 'SURFING'],
  ],
];

/** GetPlayerAvatarStateTransitionByGraphicsId */
export function GetPlayerAvatarStateTransitionByGraphicsId(graphicsId: string, gender: number): number {
  for (const [gfx, flag] of sPlayerAvatarGfxToStateFlag[gender]) if (gfx === graphicsId) return F[flag];
  return 1;
}

/** GetPlayerAvatarGraphicsIdByCurrentState */
export function GetPlayerAvatarGraphicsIdByCurrentState(): string | undefined {
  for (const [gfx, flag] of sPlayerAvatarGfxToStateFlag[gPlayerAvatar.gender]) if (F[flag] & gPlayerAvatar.flags) return gfx;
  return undefined;
}

/** SetPlayerAvatarExtraStateTransition */
export function SetPlayerAvatarExtraStateTransition(graphicsId: string, extras: number): void {
  gPlayerAvatar.transitionFlags |= GetPlayerAvatarStateTransitionByGraphicsId(graphicsId, gPlayerAvatar.gender) | extras;
  DoPlayerAvatarTransition();
}

/** SetPlayerAvatarStateMask */
export function SetPlayerAvatarStateMask(flags: number): void {
  gPlayerAvatar.flags &= F.DASH | F.FORCED | F.CONTROLLABLE;
  gPlayerAvatar.flags |= flags;
}

/** ClearPlayerAvatarInfo */
export function ClearPlayerAvatarInfo(): void {
  Object.assign(gPlayerAvatar, {
    flags: 0,
    transitionFlags: 0,
    runningState: 0,
    tileTransitionState: 0,
    acroBikeState: 0,
    newDirBackup: undefined,
    bikeFrameCounter: 0,
    bikeSpeed: 0,
    directionHistory: 0,
    abStartSelectHistory: 0,
    dirTimerHistory: [0, 0, 0, 0, 0, 0, 0, 0],
    lastSpinTile: 0,
    preventStep: false,
  });
}

/**
 * InitPlayerAvatar for the player object the field already has: facing `direction`, then the state
 * flags the warp brought along (InitObjectEventsLocal's SetPlayerAvatarTransitionFlags).
 */
export function InitPlayerAvatar(direction: Direction, gender: number, transitionFlags: number): void {
  const player = playerObj();
  player.facingDirectionLocked = false;
  player.disableAnim = false;
  player.enableAnim = false;
  player.face(direction); // ObjectEventTurn
  ClearPlayerAvatarInfo();
  gPlayerAvatar.runningState = K.NOT_MOVING;
  gPlayerAvatar.tileTransitionState = K.T_NOT_MOVING;
  gPlayerAvatar.gender = gender;
  // A fresh object has the normal graphics (sPlayerAvatarGfxIds[PLAYER_AVATAR_GFX_NORMAL])
  SetPlayerGraphics(GetPlayerAvatarGraphicsIdByStateIdAndGender(K.PLAYER_AVATAR_GFX_NORMAL, gender));
  SetPlayerAvatarStateMask(F.CONTROLLABLE | F.ON_FOOT);
  SetPlayerAvatarTransitionFlags(transitionFlags);
}

/**
 * SpawnObjectEventsOnReturnToField for the player (after a battle or a menu): ClearPlayerAvatarInfo, then
 * the state its graphics stand for (SetPlayerAvatarObjectEventIdAndObjectId).
 */
export function ReturnPlayerAvatarToField(): void {
  const player = playerObj();
  const gfx = avatarField().graphicsIdOf(player) ?? GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_NORMAL);
  const gender = gPlayerAvatar.gender;
  ClearPlayerAvatarInfo();
  gPlayerAvatar.gender = gender;
  SetPlayerAvatarExtraStateTransition(gfx, F.CONTROLLABLE);
}

// ------------------------------------------------------------------ tile transition state

/** UpdatePlayerAvatarTransitionState: whether the player is still, between tiles, or just centred on one. */
export function UpdatePlayerAvatarTransitionState(): void {
  gPlayerAvatar.tileTransitionState = K.T_NOT_MOVING;
  if (PlayerIsAnimActive()) {
    if (!PlayerCheckIfAnimFinishedOrInactive()) {
      if (!PlayerAnimIsMultiFrameStationary()) gPlayerAvatar.tileTransitionState = K.T_TILE_TRANSITION;
    } else if (!PlayerAnimIsMultiFrameStationaryAndStateNotTurning()) {
      gPlayerAvatar.tileTransitionState = K.T_TILE_CENTER;
    }
  }
}

function PlayerAnimIsMultiFrameStationary(): boolean {
  const id = playerObj().movementActionId;
  return (
    id <= K.MOVEMENT_ACTION_FACE_RIGHT_FAST ||
    (id >= K.MOVEMENT_ACTION_DELAY_1 && id <= K.MOVEMENT_ACTION_DELAY_16) ||
    (id >= K.MOVEMENT_ACTION_WALK_IN_PLACE_SLOW_DOWN && id <= K.MOVEMENT_ACTION_WALK_IN_PLACE_FASTER_RIGHT) ||
    (id >= K.MOVEMENT_ACTION_ACRO_WHEELIE_FACE_DOWN && id <= K.MOVEMENT_ACTION_ACRO_END_WHEELIE_FACE_RIGHT) ||
    (id >= K.MOVEMENT_ACTION_ACRO_WHEELIE_IN_PLACE_DOWN && id <= K.MOVEMENT_ACTION_ACRO_WHEELIE_IN_PLACE_RIGHT)
  );
}

function PlayerAnimIsMultiFrameStationaryAndStateNotTurning(): boolean {
  return PlayerAnimIsMultiFrameStationary() && gPlayerAvatar.runningState !== K.TURN_DIRECTION;
}

function PlayerIsAnimActive(): boolean {
  return playerObj().movementOverridden;
}

function PlayerCheckIfAnimFinishedOrInactive(): boolean {
  return playerObj().checkHeldMovementStatus() !== 0;
}

// ------------------------------------------------------------------ movement actions

/** PlayerSetAnimId: start a held movement unless one is running. */
function PlayerSetAnimId(movementActionId: number, copyableMovement: number): void {
  if (!PlayerIsAnimActive()) {
    playerObj().playerCopyableMovement = copyableMovement; // PlayerSetCopyableMovement
    playerObj().setHeldMovement(movementActionId);
  }
}

/** PlayerGetCopyableMovement */
export function PlayerGetCopyableMovement(): number {
  return playerObj().playerCopyableMovement;
}

export function PlayerWalkSlower(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_SLOWER', direction), 2);
}
export function PlayerWalkSlow(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_SLOW', direction), 2);
}
export function PlayerWalkNormal(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_NORMAL', direction), 2);
}
export function PlayerWalkFast(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_FAST', direction), 2);
}
export function PlayerRideWaterCurrent(direction: Direction): void {
  PlayerSetAnimId(directionalAction('RIDE_WATER_CURRENT', direction), 2);
}
export function PlayerWalkFaster(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_FASTER', direction), 2);
}
export function PlayerRun(direction: Direction): void {
  PlayerSetAnimId(directionalAction('PLAYER_RUN', direction), 2);
}
export function PlayerRunSlow(direction: Direction): void {
  PlayerSetAnimId(directionalAction('PLAYER_RUN_SLOW', direction), 2);
}
/** PlayerOnBikeCollide */
export function PlayerOnBikeCollide(direction: Direction): void {
  PlayCollisionSoundIfNotFacingWarp(direction);
  PlayerSetAnimId(directionalAction('WALK_IN_PLACE_NORMAL', direction), 2);
}
/** PlayerNotOnBikeCollide: the bump */
export function PlayerNotOnBikeCollide(direction: Direction): void {
  PlayCollisionSoundIfNotFacingWarp(direction);
  PlayerSetAnimId(directionalAction('WALK_IN_PLACE_SLOW', direction), 2);
}
export function PlayerFaceDirection(direction: Direction): void {
  PlayerSetAnimId(directionalAction('FACE', direction), 1);
}
export function PlayerTurnInPlace(direction: Direction): void {
  PlayerSetAnimId(directionalAction('WALK_IN_PLACE_FAST', direction), 1);
}
/** PlayerJumpLedge */
export function PlayerJumpLedge(direction: Direction): void {
  PlaySE(K.SE_LEDGE);
  PlayerSetAnimId(directionalAction('JUMP_2', direction), 8);
}
/**
 * PlayCollisionSoundIfNotFacingWarp: SE_WALL_HIT, unless the player stands on an arrow warp facing its way
 * (sArrowWarpMetatileBehaviorChecks) or a directional stair warp facing west / east, or faces a door going north.
 */
function PlayCollisionSoundIfNotFacingWarp(direction: Direction): void {
  const f = avatarField();
  if (f.behaviors.is(playerObj().currentMetatileBehavior, `${{ up: 'NORTH', down: 'SOUTH', left: 'WEST', right: 'EAST' }[direction]}_ARROW_WARP`)) return;
  if (f.behaviors.isDirectionalStairWarp(playerObj().currentMetatileBehavior, direction)) return;
  if (direction === 'up') {
    const { x, y } = PlayerGetDestCoords();
    if (f.behaviors.is(f.behaviorAt(x, y - 1), 'WARP_DOOR')) return; // MetatileBehavior_IsWarpDoor
  }
  PlaySE(K.SE_WALL_HIT);
}

/** PlaySpinSound */
function PlaySpinSound(): void {
  PlaySE(K.SE_M_RAZOR_WIND2);
}

function PlayerGoSpin(direction: Direction): void {
  PlayerSetAnimId(directionalAction('SPIN', direction), 3);
}

/** HandleEnforcedLookDirectionOnPlayerStopMoving */
export function HandleEnforcedLookDirectionOnPlayerStopMoving(): void {
  if (gPlayerAvatar.tileTransitionState === K.T_TILE_CENTER || gPlayerAvatar.tileTransitionState === K.T_NOT_MOVING) {
    // IsPlayerNotUsingAcroBikeOnBumpySlope: always TRUE in FRLG
    playerObj().forceSetHeldMovement(directionalAction('FACE', playerObj().facing));
  }
}

/**
 * FreezeObjects_WaitForPlayer's Task_WaitPlayerStopMoving + IsFreezePlayerFinished (lock / lockall): true
 * once the player isn't between tiles, after making them face their way and StopPlayerAvatar.
 */
export function IsFreezePlayerFinished(): boolean {
  if (gPlayerAvatar.tileTransitionState === K.T_TILE_TRANSITION || (playerObj().isMoving && playerObj().movementActionId === movementAction('NONE'))) {
    return false; // walkrun_is_standing_still (a scripted step isn't a held movement, but still has to end)
  }
  HandleEnforcedLookDirectionOnPlayerStopMoving();
  StopPlayerAvatar();
  return true;
}

/** ClearPlayerHeldMovementAndUnfreezeObjectEvents's part for the player (release / releaseall) */
export function ClearPlayerHeldMovement(): void {
  playerObj().clearHeldMovementIfFinished();
}

// ------------------------------------------------------------------ getters

/** GetXYCoordsOneStepInFrontOfPlayer */
export function GetXYCoordsOneStepInFrontOfPlayer(): { x: number; y: number } {
  const p = playerObj();
  const { dx, dy } = DELTA[p.facing];
  return { x: p.current.x + dx, y: p.current.y + dy };
}

/** PlayerGetDestCoords */
export function PlayerGetDestCoords(): { x: number; y: number } {
  return playerObj().current;
}

export function GetPlayerFacingDirection(): Direction {
  return playerObj().facing;
}

export function GetPlayerMovementDirection(): Direction {
  return playerObj().movementDirection;
}

/** PlayerGetElevation */
export function PlayerGetElevation(): number {
  return playerObj().previousElevation;
}

export function TestPlayerAvatarFlags(bm: number): number {
  return gPlayerAvatar.flags & bm;
}

export function GetPlayerAvatarFlags(): number {
  return gPlayerAvatar.flags;
}

/** StopPlayerAvatar */
export function StopPlayerAvatar(): void {
  const player = playerObj();
  npc_clear_strange_bits(player);
  player.face(player.facing); // SetObjectEventDirection(playerObjEvent, playerObjEvent->facingDirection)
  if (TestPlayerAvatarFlags(F.MACH_BIKE | F.ACRO_BIKE)) {
    Bike_HandleBumpySlopeJump();
    Bike_UpdateBikeCounterSpeed(0);
  }
}

/** PartyHasMonWithSurf */
export function PartyHasMonWithSurf(): boolean {
  return !TestPlayerAvatarFlags(F.SURFING) && avatarField().partyKnowsSurf();
}

/** IsPlayerSurfingNorth */
export function IsPlayerSurfingNorth(): boolean {
  return GetPlayerMovementDirection() === 'up' && !!TestPlayerAvatarFlags(F.SURFING);
}

/** SetPlayerInvisibility */
export function SetPlayerInvisibility(invisible: boolean): void {
  playerObj().setVisible(!invisible);
  if (TestPlayerAvatarFlags(F.SURFING)) avatarField().setSurfBlobInvisible?.(invisible);
}

// ------------------------------------------------------------------ boulders

/** StartStrengthAnim → Task_BumpBoulder: DoBoulderInit, DoBoulderDust, DoBoulderFinish */
function StartStrengthAnim(boulder: ObjectEvent, direction: Direction): void {
  const f = avatarField();
  const player = playerObj();
  let state = 0;
  const step = (): boolean => {
    switch (state) {
      case 0: // DoBoulderInit
        f.lockPlayerFieldControls();
        gPlayerAvatar.preventStep = true;
        state++;
        return false;
      case 1: // DoBoulderDust
        if (!player.movementOverridden && !boulder.movementOverridden) {
          player.clearHeldMovementIfFinished();
          boulder.clearHeldMovementIfFinished();
          player.setHeldMovement(directionalAction('WALK_IN_PLACE_NORMAL', direction));
          boulder.setHeldMovement(directionalAction('WALK_SLOWER', direction));
          f.startDust(boulder.current.x, boulder.current.y, boulder.previousElevation, boulder.priority); // FLDEFF_DUST
          PlaySE(K.SE_M_STRENGTH);
          state++;
        }
        return false;
      default: // DoBoulderFinish
        if (player.checkHeldMovementStatus() && boulder.checkHeldMovementStatus()) {
          player.clearHeldMovementIfFinished();
          boulder.clearHeldMovementIfFinished();
          f.boulderPushed(boulder);
          gPlayerAvatar.preventStep = false;
          f.unlockPlayerFieldControls();
          return true;
        }
        return false;
    }
  };
  step(); // Task_BumpBoulder runs once when created
  f.createTask(step);
}

// ------------------------------------------------------------------ surfing

/** CreateStopSurfingTask: jump off the surfing mon onto land, then walk on. */
export function CreateStopSurfingTask(direction: Direction): void {
  const f = avatarField();
  f.lockPlayerFieldControls();
  f.freezeObjectEvents();
  Overworld_ClearSavedMusic();
  Overworld_ChangeMusicToDefault();
  gPlayerAvatar.flags &= ~F.SURFING;
  gPlayerAvatar.flags |= F.ON_FOOT;
  gPlayerAvatar.preventStep = true;
  const player = playerObj();
  let waiting = false;
  const step = (): boolean => {
    if (!waiting) {
      // Task_StopSurfingInit
      if (player.movementOverridden && !player.clearHeldMovementIfFinished()) return false;
      f.stopSurfBlob?.(); // SetSurfBlob_BobState(BOB_MON_ONLY)
      player.setHeldMovement(directionalAction('JUMP_SPECIAL_WITH_EFFECT', direction));
      waiting = true;
      return false;
    }
    // Task_WaitStopSurfing
    if (!player.clearHeldMovementIfFinished()) return false;
    SetPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_NORMAL));
    player.setHeldMovement(directionalAction('FACE', player.facing));
    gPlayerAvatar.preventStep = false;
    f.unlockPlayerFieldControls();
    f.unfreezeObjectEvents();
    f.destroySurfBlob?.(); // DestroySprite(&gSprites[playerObjEvent->fieldEffectSpriteId])
    SetHelpContextForMap();
    return true;
  };
  step();
  f.createTask(step);
}

/** SeafoamIslandsB4F_CurrentDumpsPlayerOnLand (special) */
export function SeafoamIslandsB4F_CurrentDumpsPlayerOnLand(): void {
  CreateStopSurfingTask('up');
}

/** ForcePlayerToStartSurfing (field_specials.c) */
export function ForcePlayerToStartSurfing(): void {
  SetHelpContext(K.HELPCONTEXT_SURFING);
  SetPlayerAvatarTransitionFlags(F.SURFING);
}

// ------------------------------------------------------------------ warps (overworld.c)

/** sInitialPlayerAvatarState */
const sInitialPlayerAvatarState = { direction: 'down' as Direction, transitionFlags: 0, hasDirectionSet: false };

/** StoreInitialPlayerAvatarState: what the player will be on the other side of a warp. */
export function StoreInitialPlayerAvatarState(): void {
  sInitialPlayerAvatarState.direction = GetPlayerFacingDirection();
  if (TestPlayerAvatarFlags(F.MACH_BIKE)) sInitialPlayerAvatarState.transitionFlags = F.MACH_BIKE;
  else if (TestPlayerAvatarFlags(F.ACRO_BIKE)) sInitialPlayerAvatarState.transitionFlags = F.ACRO_BIKE;
  else if (TestPlayerAvatarFlags(F.SURFING)) sInitialPlayerAvatarState.transitionFlags = F.SURFING;
  else if (TestPlayerAvatarFlags(F.UNDERWATER)) sInitialPlayerAvatarState.transitionFlags = F.UNDERWATER;
  else sInitialPlayerAvatarState.transitionFlags = F.ON_FOOT;
  sInitialPlayerAvatarState.hasDirectionSet = false;
}

/** ResetInitialPlayerAvatarState */
export function ResetInitialPlayerAvatarState(): void {
  sInitialPlayerAvatarState.direction = 'down';
  sInitialPlayerAvatarState.transitionFlags = F.ON_FOOT;
  sInitialPlayerAvatarState.hasDirectionSet = false;
}

/** SetInitialPlayerAvatarStateWithDirection */
export function SetInitialPlayerAvatarStateWithDirection(direction: Direction): void {
  sInitialPlayerAvatarState.direction = direction;
  sInitialPlayerAvatarState.transitionFlags = F.ON_FOOT;
  sInitialPlayerAvatarState.hasDirectionSet = true;
}

/**
 * GetInitialPlayerAvatarState: the state and facing to start a map with, from the stored state and the
 * arrival tile (`behavior`, the centre of the screen).
 */
export function GetInitialPlayerAvatarState(mapType: number, behavior: number, mapId: string): { transitionFlags: number; direction: Direction } {
  const transitionFlags = GetAdjustedInitialTransitionFlags(behavior, mapType, mapId);
  const direction = GetAdjustedInitialDirection(transitionFlags, behavior, mapType);
  sInitialPlayerAvatarState.transitionFlags = transitionFlags;
  sInitialPlayerAvatarState.direction = direction;
  sInitialPlayerAvatarState.hasDirectionSet = false;
  return { transitionFlags, direction };
}

function GetAdjustedInitialTransitionFlags(behavior: number, mapType: number, mapId: string): number {
  const f = avatarField();
  const b = f.behaviors;
  const s = sInitialPlayerAvatarState;
  if (mapType !== K.MAP_TYPE_INDOOR && f.flag('FLAG_SYS_CRUISE_MODE')) return F.ON_FOOT;
  if (mapType === K.MAP_TYPE_UNDERWATER) return F.UNDERWATER;
  // MetatileBehavior_IsSurfableInSeafoamIslands
  if (b.isSurfable(behavior) && (mapId === 'MAP_SEAFOAM_ISLANDS_B3F' || mapId === 'MAP_SEAFOAM_ISLANDS_B4F')) return F.ON_FOOT;
  if (b.isSurfable(behavior)) return F.SURFING;
  if (!f.allowCycling()) return F.ON_FOOT;
  if (s.transitionFlags === F.MACH_BIKE) return F.MACH_BIKE;
  if (s.transitionFlags !== F.ACRO_BIKE) return F.ON_FOOT;
  return F.ACRO_BIKE;
}

function GetAdjustedInitialDirection(transitionFlags: number, behavior: number, mapType: number): Direction {
  const b = avatarField().behaviors;
  const s = sInitialPlayerAvatarState;
  if (avatarField().flag('FLAG_SYS_CRUISE_MODE') && mapType === K.MAP_TYPE_OCEAN_ROUTE) return 'right';
  // MetatileBehavior_IsDeepSouthWarp is FALSE in FRLG
  if (b.is(behavior, 'CAVE_DOOR', 'WARP_DOOR')) return 'down';
  if (b.is(behavior, 'SOUTH_ARROW_WARP')) return 'up';
  if (b.is(behavior, 'NORTH_ARROW_WARP')) return 'down';
  if (b.is(behavior, 'WEST_ARROW_WARP')) return 'right';
  if (b.is(behavior, 'EAST_ARROW_WARP')) return 'left';
  if (b.is(behavior, 'UP_RIGHT_STAIR_WARP', 'DOWN_RIGHT_STAIR_WARP')) return 'left';
  if (b.is(behavior, 'UP_LEFT_STAIR_WARP', 'DOWN_LEFT_STAIR_WARP')) return 'right';
  if ((s.transitionFlags === F.UNDERWATER && transitionFlags === F.SURFING) || (s.transitionFlags === F.SURFING && transitionFlags === F.UNDERWATER)) return s.direction;
  if (b.is(behavior, 'LADDER')) return s.direction;
  if (s.hasDirectionSet) return s.direction;
  return 'down';
}
