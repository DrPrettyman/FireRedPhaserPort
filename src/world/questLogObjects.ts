// quest_log_objects.c: a scene's snapshot of gObjectEvents (QL_RecordObjects) and, in playback, the templates and
// objects back from it (QL_LoadObjectsAndTemplates' templates here, the objects through the host: OverworldScene's
// questLogLoadObjects) and QL_TryStopSurfing.
//
// The port has no gObjectEvents array: OverworldScene hands over the player and the current map's objects (see
// `questLogObjectEventFrom`), the player first. Coordinates are the C's map coordinates (map-local + MAP_OFFSET).

import { K } from '../battle/constants';
import type { ObjectEvent } from '../entities/ObjectEvent';
import type { Direction } from './direction';
import type { ObjectEventData } from '../data/types';
import { PLAYER_AVATAR_FLAG, SetPlayerAvatarTransitionFlags, TestPlayerAvatarFlags, avatarField } from './playerAvatar';
import { gQL, OBJECT_EVENT_TEMPLATES_COUNT, type QuestLogScene } from './questLog';

/** struct QuestLogObjectEvent (the bitfields as 0 / 1) */
export interface QuestLogObjectEvent {
  active: number;
  triggerGroundEffectsOnStop: number;
  disableCoveringGroundEffects: number;
  landingJump: number;
  frozen: number;
  facingDirectionLocked: number;
  disableAnim: number;
  enableAnim: number;
  inanimate: number;
  invisible: number;
  offScreen: number;
  trackedByCamera: number;
  isPlayer: number;
  spriteAnimPausedBackup: number;
  spriteAffineAnimPausedBackup: number;
  disableJumpLandingGroundEffect: number;
  fixedPriority: number;
  /** DIR_* */
  facingDirection: number;
  currentElevation: number;
  previousElevation: number;
  /** OBJ_EVENT_GFX_* */
  graphicsId: number;
  /** MOVEMENT_TYPE_* */
  movementType: number;
  /** TRAINER_TYPE_* */
  trainerType: number;
  localId: number;
  mapNum: number;
  mapGroup: number;
  /** currentCoords (map coordinates: map-local + MAP_OFFSET) */
  x: number;
  y: number;
  trainerRange_berryTreeId: number;
  previousMetatileBehavior: number;
  directionSequenceIndex: number;
  /** playerCopyableMovement */
  animId: number;
}

export function emptyQuestLogObjectEvent(): QuestLogObjectEvent {
  return {
    active: 0,
    triggerGroundEffectsOnStop: 0,
    disableCoveringGroundEffects: 0,
    landingJump: 0,
    frozen: 0,
    facingDirectionLocked: 0,
    disableAnim: 0,
    enableAnim: 0,
    inanimate: 0,
    invisible: 0,
    offScreen: 0,
    trackedByCamera: 0,
    isPlayer: 0,
    spriteAnimPausedBackup: 0,
    spriteAffineAnimPausedBackup: 0,
    disableJumpLandingGroundEffect: 0,
    fixedPriority: 0,
    facingDirection: 0,
    currentElevation: 0,
    previousElevation: 0,
    graphicsId: 0,
    movementType: 0,
    trainerType: 0,
    localId: 0,
    mapNum: 0,
    mapGroup: 0,
    x: 0,
    y: 0,
    trainerRange_berryTreeId: 0,
    previousMetatileBehavior: 0,
    directionSequenceIndex: 0,
    animId: 0,
  };
}

/** QL_RecordObjects: gObjectEvents[OBJECT_EVENTS_COUNT] into the scene (the slots past `objects` are inactive). */
export function QL_RecordObjects(questLog: QuestLogScene, objects: QuestLogObjectEvent[]): void {
  for (let i = 0; i < questLog.objectEvents.length; i++) {
    questLog.objectEvents[i] = objects[i] ? { ...objects[i] } : emptyQuestLogObjectEvent();
  }
}

/** DIR_* of a Direction */
export function dirNumber(dir: Direction): number {
  return { down: K.DIR_SOUTH, up: K.DIR_NORTH, left: K.DIR_WEST, right: K.DIR_EAST }[dir];
}

/** What the port's ObjectEvent doesn't hold itself (the C's gObjectEvents fields the field keeps elsewhere). */
export interface QuestLogObjectInfo {
  isPlayer: boolean;
  /** LOCALID_PLAYER for the player */
  localId: number;
  mapNum: number;
  mapGroup: number;
  /** the map's origin in world tiles (currentCoords are map-local + MAP_OFFSET) */
  originX: number;
  originY: number;
  /** OBJ_EVENT_GFX_*, MOVEMENT_TYPE_*, TRAINER_TYPE_* numbers */
  graphicsId: number;
  movementType: number;
  trainerType: number;
  trainerRange_berryTreeId: number;
  frozen: boolean;
  trackedByCamera: boolean;
}

/** A gObjectEvents entry as QL_RecordObjects copies it, from the port's object. */
export function questLogObjectEventFrom(obj: ObjectEvent, info: QuestLogObjectInfo): QuestLogObjectEvent {
  const b = (v: boolean) => (v ? 1 : 0);
  return {
    ...emptyQuestLogObjectEvent(),
    active: 1,
    triggerGroundEffectsOnStop: b(obj.triggerGroundEffectsOnStop),
    disableCoveringGroundEffects: b(obj.disableCoveringGroundEffects),
    landingJump: b(obj.landingJump),
    frozen: b(info.frozen),
    facingDirectionLocked: b(obj.facingDirectionLocked),
    disableAnim: b(obj.disableAnim),
    enableAnim: b(obj.enableAnim),
    inanimate: b(obj.inanimate),
    invisible: b(!obj.visible),
    trackedByCamera: b(info.trackedByCamera),
    isPlayer: b(info.isPlayer),
    disableJumpLandingGroundEffect: b(obj.disableJumpLandingGroundEffect),
    fixedPriority: b(obj.fixedPriority),
    facingDirection: dirNumber(obj.facing),
    currentElevation: obj.currentElevation & 0xf,
    previousElevation: obj.previousElevation & 0xf,
    graphicsId: info.graphicsId & 0xff,
    movementType: info.movementType & 0xff,
    trainerType: info.trainerType & 0xff,
    localId: info.localId & 0xff,
    mapNum: info.mapNum & 0xff,
    mapGroup: info.mapGroup & 0xff,
    x: obj.current.x - info.originX + 7, // MAP_OFFSET
    y: obj.current.y - info.originY + 7,
    trainerRange_berryTreeId: info.trainerRange_berryTreeId & 0xff,
    previousMetatileBehavior: obj.previousMetatileBehavior & 0xff,
    animId: obj.playerCopyableMovement & 0xff,
  };
}

/** A DIR_* as a Direction (DIR_NONE faces down) */
export function directionOf(dir: number): Direction {
  if (dir === K.DIR_NORTH) return 'up';
  if (dir === K.DIR_WEST) return 'left';
  if (dir === K.DIR_EAST) return 'right';
  return 'down';
}

/**
 * QL_LoadObjectsAndTemplates' templates: the scene's positions, elevations and movement types into
 * gSaveBlock1Ptr->objectEventTemplates (the current map's templates, as the field spawns from them).
 */
export function QL_LoadTemplates(questLog: QuestLogScene, templates: ObjectEventData[], movementTypeName: (id: number) => string | undefined): void {
  for (let i = 0; i < OBJECT_EVENT_TEMPLATES_COUNT && i < templates.length; i++) {
    const q = questLog.objectEventTemplates[i];
    const t = templates[i];
    t.x = q.negx ? -q.x : q.x;
    t.y = q.negy ? -q.y : q.y;
    t.elevation = q.elevation;
    t.movement_type = movementTypeName(q.movementType) ?? t.movement_type;
  }
}

/** QL_TryStopSurfing (LoadMap_QLPlayback): a scene that starts surfing on land starts on foot. */
export function QL_TryStopSurfing(destSurfable: boolean): void {
  if (gQL.state !== K.QL_STATE_PLAYBACK) return;
  if (!destSurfable && TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING)) {
    SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.ON_FOOT);
    avatarField().destroySurfBlob?.(); // DestroySprite(&gSprites[objectEvent->fieldEffectSpriteId])
  }
}
