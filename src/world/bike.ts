// bike.c: riding the Bicycle. FRLG has one bike, ridden with PLAYER_AVATAR_FLAG_MACH_BIKE; its speed
// is a fixed MOVE_SPEED_FAST_2 step (PlayerRideWaterCurrent). Cycling Road's slopes
// (MB_CYCLING_ROAD_PULL_DOWN*) pull the player south unless B is held. The Acro Bike tricks are an R/S
// leftover that no FRLG tile triggers (the rail and bumpy slope behaviours are FALSE), so they're left out.

import { K } from '../battle/constants';
import type { Direction } from './direction';
import { DELTA } from './direction';
import {
  CheckForObjectEventCollision,
  gPlayerAvatar,
  GetPlayerMovementDirection,
  PLAYER_AVATAR_FLAG as F,
  PlayerFaceDirection,
  PlayerIsMovingOnRockStairs,
  PlayerJumpLedge,
  PlayerOnBikeCollide,
  playerObj,
  PlayerRideWaterCurrent,
  PlayerWalkFast,
  PlayerWalkFaster,
  PlayerWalkNormal,
  SetPlayerAvatarTransitionFlags,
  avatarField,
  type Dir,
  type Keys,
} from './playerAvatar';
import { Overworld_ChangeMusicTo } from '../gba/sound';
import { Overworld_ClearSavedMusic, Overworld_MusicCanOverrideMapMusic, Overworld_PlaySpecialMapMusic, Overworld_SetSavedMusic } from '../gba/overworldMusic';

/** MovePlayerOnBike */
export function MovePlayerOnBike(direction: Dir, keys: Keys): void {
  const r = GetBikeTransitionId(direction, keys);
  sBikeTransitions[r.transition](r.direction);
}

const sBikeTransitions: ((direction: Direction) => void)[] = [
  BikeTransition_FaceDirection, // BIKE_TRANS_FACE_DIRECTION
  BikeTransition_TurnDirection, // BIKE_TRANS_TURNING
  BikeTransition_MoveDirection, // BIKE_TRANS_MOVE
  BikeTransition_Downhill, // BIKE_TRANS_DOWNHILL
  BikeTransition_Uphill, // BIKE_TRANS_UPHILL
];

interface BikeTransition {
  transition: number;
  direction: Direction;
}

/** GetBikeTransitionId: sBikeInputHandlers[gPlayerAvatar.acroBikeState] (which holds a BIKE_STATE_* here) */
function GetBikeTransitionId(direction: Dir, keys: Keys): BikeTransition {
  switch (gPlayerAvatar.acroBikeState) {
    case K.BIKE_STATE_TURNING:
      return BikeInputHandler_Turning();
    case K.BIKE_STATE_SLOPE:
      return BikeInputHandler_Slope(direction, keys);
    default:
      return BikeInputHandler_Normal(direction, keys);
  }
}

/** DIR_SOUTH (1) is the only direction below DIR_NORTH (2). */
function isBelowNorth(direction: Dir): boolean {
  return direction === undefined || direction === 'down';
}

function BikeInputHandler_Normal(direction: Dir, keys: Keys): BikeTransition {
  const player = playerObj();
  const movementDirection = GetPlayerMovementDirection();
  gPlayerAvatar.bikeFrameCounter = 0;
  if (avatarField().behaviors.isCyclingRoadPullDownTile(player.currentMetatileBehavior)) {
    if (!keys.held('B')) {
      gPlayerAvatar.acroBikeState = K.BIKE_STATE_SLOPE;
      gPlayerAvatar.runningState = K.MOVING;
      // *direction_p keeps DIR_NONE here; the downhill transition always goes south
      return { transition: isBelowNorth(direction) ? K.BIKE_TRANS_DOWNHILL : K.BIKE_TRANS_UPHILL, direction: direction ?? 'down' };
    }
    if (direction !== undefined) {
      gPlayerAvatar.acroBikeState = K.BIKE_STATE_SLOPE;
      gPlayerAvatar.runningState = K.MOVING;
      return { transition: K.BIKE_TRANS_UPHILL, direction };
    }
  }
  if (direction === undefined) {
    gPlayerAvatar.runningState = K.NOT_MOVING;
    return { transition: K.BIKE_TRANS_FACE_DIRECTION, direction: movementDirection };
  }
  if (direction !== movementDirection && gPlayerAvatar.runningState !== K.MOVING) {
    gPlayerAvatar.acroBikeState = K.BIKE_STATE_TURNING;
    gPlayerAvatar.newDirBackup = direction;
    gPlayerAvatar.runningState = K.NOT_MOVING;
    return GetBikeTransitionId(direction, keys);
  }
  gPlayerAvatar.runningState = K.MOVING;
  return { transition: K.BIKE_TRANS_MOVE, direction };
}

function BikeInputHandler_Turning(): BikeTransition {
  const direction = gPlayerAvatar.newDirBackup ?? 'down'; // DIR_NONE faces south (sFaceDirectionMovementActions[DIR_NONE])
  gPlayerAvatar.runningState = K.TURN_DIRECTION;
  gPlayerAvatar.acroBikeState = K.BIKE_STATE_NORMAL;
  Bike_SetBikeStill();
  return { transition: K.BIKE_TRANS_TURNING, direction };
}

function BikeInputHandler_Slope(direction: Dir, keys: Keys): BikeTransition {
  const movementDirection = GetPlayerMovementDirection();
  if (avatarField().behaviors.isCyclingRoadPullDownTile(playerObj().currentMetatileBehavior)) {
    if (direction !== movementDirection) {
      gPlayerAvatar.acroBikeState = K.BIKE_STATE_TURNING;
      gPlayerAvatar.newDirBackup = direction;
      gPlayerAvatar.runningState = K.NOT_MOVING;
      return GetBikeTransitionId(direction, keys);
    }
    gPlayerAvatar.runningState = K.MOVING;
    gPlayerAvatar.acroBikeState = K.BIKE_STATE_SLOPE;
    return { transition: isBelowNorth(direction) ? K.BIKE_TRANS_DOWNHILL : K.BIKE_TRANS_UPHILL, direction: direction ?? 'down' };
  }
  gPlayerAvatar.acroBikeState = K.BIKE_STATE_NORMAL;
  if (direction === undefined) {
    gPlayerAvatar.runningState = K.NOT_MOVING;
    return { transition: K.BIKE_TRANS_FACE_DIRECTION, direction: movementDirection };
  }
  gPlayerAvatar.runningState = K.MOVING;
  return { transition: K.BIKE_TRANS_MOVE, direction };
}

function BikeTransition_FaceDirection(direction: Direction): void {
  PlayerFaceDirection(direction);
}

function BikeTransition_TurnDirection(direction: Direction): void {
  // CanBikeFaceDirectionOnRail: FRLG has no rails
  PlayerFaceDirection(direction);
}

function BikeTransition_MoveDirection(direction: Direction): void {
  // CanBikeFaceDirectionOnRail is always TRUE (no rails in FRLG)
  const collision = GetBikeCollision(direction);
  if (collision > K.COLLISION_NONE && collision <= K.COLLISION_ISOLATED_HORIZONTAL_RAIL) {
    if (collision === K.COLLISION_LEDGE_JUMP) PlayerJumpLedge(direction);
    else if (collision !== K.COLLISION_STOP_SURFING && collision !== K.COLLISION_PUSHED_BOULDER && collision !== K.COLLISION_DIRECTIONAL_STAIR_WARP) {
      PlayerOnBikeCollide(direction);
    }
  } else if (collision === K.COLLISION_COUNT) {
    PlayerWalkFast(direction); // cracked ice
  } else if (PlayerIsMovingOnRockStairs(direction)) {
    PlayerWalkFast(direction);
  } else {
    PlayerRideWaterCurrent(direction);
  }
}

/** BikeTransition_Downhill: rolling south down a Cycling Road slope. */
function BikeTransition_Downhill(_direction: Direction): void {
  const collision = GetBikeCollision('down');
  if (collision === K.COLLISION_NONE) PlayerWalkFaster('down');
  else if (collision === K.COLLISION_LEDGE_JUMP) PlayerJumpLedge('down');
}

/** BikeTransition_Uphill: pedalling against the slope at walking speed. */
function BikeTransition_Uphill(direction: Direction): void {
  if (GetBikeCollision(direction) === K.COLLISION_NONE) PlayerWalkNormal(direction);
}

/** GetBikeCollision */
function GetBikeCollision(direction: Direction): number {
  const player = playerObj();
  const { dx, dy } = DELTA[direction];
  const x = player.current.x + dx;
  const y = player.current.y + dy;
  return GetBikeCollisionAt(x, y, direction, avatarField().behaviorAt(x, y));
}

/** GetBikeCollisionAt */
function GetBikeCollisionAt(x: number, y: number, direction: Direction, behavior: number): number {
  let collision = CheckForObjectEventCollision(playerObj(), x, y, direction, behavior);
  if (collision <= K.COLLISION_OBJECT_EVENT) {
    if (avatarField().behaviors.is(behavior, 'CRACKED_ICE')) return K.COLLISION_COUNT;
    if (collision === K.COLLISION_NONE && MetatileBehaviorForbidsBiking(behavior)) collision = K.COLLISION_IMPASSABLE;
  }
  return collision;
}

/** IsRunningDisallowed */
export function IsRunningDisallowed(behavior: number): boolean {
  if (!avatarField().allowRunning()) return true;
  return MetatileBehaviorForbidsBiking(behavior);
}

/** MetatileBehaviorForbidsBiking (MetatileBehavior_IsFortreeBridge is FALSE in FRLG) */
function MetatileBehaviorForbidsBiking(behavior: number): boolean {
  return avatarField().behaviors.is(behavior, 'RUNNING_DISALLOWED');
}

/** IsBikingDisallowedByPlayer: surfing, or standing where biking isn't allowed. */
export function IsBikingDisallowedByPlayer(): boolean {
  if (!(gPlayerAvatar.flags & (F.UNDERWATER | F.SURFING))) {
    const { x, y } = playerObj().current;
    if (!MetatileBehaviorForbidsBiking(avatarField().behaviorAt(x, y))) return false;
  }
  return true;
}

/** GetOnOffBike: off the bike, the map's music again; on it, MUS_CYCLING (saved, so map loads and CONTINUE keep it). */
export function GetOnOffBike(transitionFlags: number): void {
  // gBikeCameraAheadPanback = FALSE: the camera's pan-ahead isn't ported
  if (gPlayerAvatar.flags & (F.MACH_BIKE | F.ACRO_BIKE)) {
    SetPlayerAvatarTransitionFlags(F.ON_FOOT);
    Overworld_ClearSavedMusic();
    Overworld_PlaySpecialMapMusic();
  } else {
    SetPlayerAvatarTransitionFlags(transitionFlags);
    if (Overworld_MusicCanOverrideMapMusic(K.MUS_CYCLING)) {
      Overworld_SetSavedMusic(K.MUS_CYCLING);
      Overworld_ChangeMusicTo(K.MUS_CYCLING);
    }
  }
}

/** BikeClearState */
export function BikeClearState(directionHistory: number, abStartSelectHistory: number): void {
  gPlayerAvatar.acroBikeState = K.BIKE_STATE_NORMAL;
  gPlayerAvatar.newDirBackup = undefined;
  gPlayerAvatar.bikeFrameCounter = 0;
  gPlayerAvatar.bikeSpeed = K.PLAYER_SPEED_STANDING;
  gPlayerAvatar.directionHistory = directionHistory;
  gPlayerAvatar.abStartSelectHistory = abStartSelectHistory;
  gPlayerAvatar.lastSpinTile = 0;
  gPlayerAvatar.dirTimerHistory.fill(0);
}

/** Bike_UpdateBikeCounterSpeed */
export function Bike_UpdateBikeCounterSpeed(counter: number): void {
  gPlayerAvatar.bikeFrameCounter = counter;
  gPlayerAvatar.bikeSpeed = counter + (gPlayerAvatar.bikeFrameCounter >> 1);
}

function Bike_SetBikeStill(): void {
  gPlayerAvatar.bikeFrameCounter = 0;
  gPlayerAvatar.bikeSpeed = K.PLAYER_SPEED_STANDING;
}

/** GetPlayerSpeed */
export function GetPlayerSpeed(): number {
  const machBikeSpeeds = [K.PLAYER_SPEED_NORMAL, K.PLAYER_SPEED_FAST, K.PLAYER_SPEED_FASTEST];
  if (gPlayerAvatar.flags & F.MACH_BIKE) return machBikeSpeeds[gPlayerAvatar.bikeFrameCounter];
  if (gPlayerAvatar.flags & F.ACRO_BIKE) return K.PLAYER_SPEED_FASTER;
  if (gPlayerAvatar.flags & (F.SURFING | F.DASH)) return K.PLAYER_SPEED_FAST;
  return K.PLAYER_SPEED_NORMAL;
}

/** Bike_HandleBumpySlopeJump: only the Acro Bike on a bumpy slope, which FRLG doesn't have. */
export function Bike_HandleBumpySlopeJump(): void {}

/** ForcePlayerOntoBike (field_specials.c; Cycling Road's map scripts): on the Mach Bike, with MUS_CYCLING saved. */
export function ForcePlayerOntoBike(): void {
  if (gPlayerAvatar.flags & F.ON_FOOT) SetPlayerAvatarTransitionFlags(F.MACH_BIKE);
  Overworld_SetSavedMusic(K.MUS_CYCLING);
  Overworld_ChangeMusicTo(K.MUS_CYCLING);
}

/** GetPlayerAvatarBike (field_specials.c): 1 Acro, 2 Mach, 0 on foot. */
export function GetPlayerAvatarBike(): number {
  if (gPlayerAvatar.flags & F.ACRO_BIKE) return 1;
  if (gPlayerAvatar.flags & F.MACH_BIKE) return 2;
  return 0;
}
