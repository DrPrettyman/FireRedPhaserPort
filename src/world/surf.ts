// Surf and Waterfall: party_menu.c's SetUpFieldMove_Surf / _Waterfall and their FieldCallback_*,
// field_effect.c's FldEff_UseSurf (Task_FldEffUseSurf) and FldEff_UseWaterfall (Task_UseWaterfall),
// field_effect_helpers.c's surf blob (FLDEFF_SURF_BLOB: the mon the player rides), field_control_avatar.c's
// GetInteractedWaterScript (facing water and pressing A asks to Surf; data/scripts/surf.inc and
// field_moves.inc's waterfall scripts), and field_player_avatar.c's IsPlayerFacingSurfableFishableWater.
//
// Getting off (CreateStopSurfingTask), arriving on water surfing, and moving on water are the player
// avatar's (world/playerAvatar.ts); it calls back here through its host's surf blob hooks, which
// OverworldScene points at this module's StartPlayerSurfBlob / SetPlayerSurfBlobBobState / DestroyPlayerSurfBlob.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import type { FieldEffectSprite } from '../entities/FieldEffects';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { directionalAction } from '../entities/movementActions';
import { FieldCallback_PrepareFadeInFromMenu, GetCursorSelectionMonId, registerFieldMoveSetUp, setPostMenuFieldCallback } from '../menus/partyMenu';
import { gFieldCallback2 } from '../menus/fieldCallbacks';
import { DELTA, type Direction } from './direction';
import { FieldEffectActiveListContains, FieldEffectActiveListRemove, FieldEffectStart, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import { CreateTask, LoadFieldMoveShowMonGfx, LockPlayerFieldControls, StartPlayerAvatarSummonMonForFieldMoveAnim, UnlockPlayerFieldControls } from './fieldMoves';
import { TILE } from './MapChunk';
import {
  avatarField,
  GetPlayerAvatarGraphicsIdByStateId,
  GetXYCoordsOneStepInFrontOfPlayer,
  gPlayerAvatar,
  IsPlayerSurfingNorth,
  PartyHasMonWithSurf,
  PLAYER_AVATAR_FLAG,
  PlayerGetDestCoords,
  PlayerGetElevation,
  playerObj,
  SetPlayerAvatarStateMask,
} from './playerAvatar';

/** What Surf needs from the field beyond the player avatar's host. Implemented by OverworldScene. */
export interface SurfHost {
  /** MapGridGetMetatileAttributeAt(x, y, METATILE_ATTRIBUTE_TERRAIN), world coords */
  terrainAt(x: number, y: number): number;
  /** CreateSpriteAtEnd with a gFieldEffectObjectTemplate_* (field_effects/objects.json), world pixels. */
  createFieldEffectSprite(fldEff: string, template: string, x: number, y: number, subpriority: number, callback: (s: FieldEffectSprite) => void): FieldEffectSprite;
}

let host: SurfHost | undefined;

export function setSurfHost(h: SurfHost): void {
  host = h;
}

function surfHost(): SurfHost {
  if (!host) throw new Error('[surf] no field host');
  return host;
}

// ------------------------------------------------------------------ field_player_avatar.c

/** TILE_TERRAIN_WATER (global.fieldmap.h's enum) and metatile_behavior.c's sTileBitAttributes */
const TILE_TERRAIN_WATER = 2;
const sTileBitAttributes = [0, 1 << 0, 1 << 1, 1 << 2, 1 << 3];

/** MetatileAtCoordsIsWaterTile: TestMetatileAttributeBit(METATILE_ATTRIBUTE_TERRAIN, TILE_TERRAIN_WATER) */
export function MetatileAtCoordsIsWaterTile(x: number, y: number): boolean {
  return ((sTileBitAttributes[surfHost().terrainAt(x, y)] ?? 0) & TILE_TERRAIN_WATER) !== 0;
}

/** IsPlayerFacingSurfableFishableWater: water below the player's elevation-3 ground, one step ahead. */
export function IsPlayerFacingSurfableFishableWater(): boolean {
  const player = playerObj();
  const { dx, dy } = DELTA[player.facing];
  const x = player.current.x + dx;
  const y = player.current.y + dy;
  return (
    avatarField().collisionAt(player, x, y, player.facing) === K.COLLISION_ELEVATION_MISMATCH &&
    PlayerGetElevation() === 3 &&
    MetatileAtCoordsIsWaterTile(x, y)
  );
}

// ------------------------------------------------------------------ field_control_avatar.c

/** GetInteractedWaterScript: the script for pressing A at the water (or a waterfall) in front. */
export function GetInteractedWaterScript(metatileBehavior: number): string | undefined {
  const b = avatarField().behaviors;
  if (b.is(metatileBehavior, 'FAST_WATER') && PartyHasMonWithSurf()) return 'EventScript_CurrentTooFast';
  if (state.getFlag('FLAG_BADGE05_GET') && PartyHasMonWithSurf() && IsPlayerFacingSurfableFishableWater()) return 'EventScript_UseSurf';
  if (b.is(metatileBehavior, 'WATERFALL')) {
    if (state.getFlag('FLAG_BADGE07_GET') && IsPlayerSurfingNorth()) return 'EventScript_Waterfall';
    return 'EventScript_CantUseWaterfall';
  }
  return undefined;
}

// ------------------------------------------------------------------ party_menu.c

/** SetUpFieldMove_Surf */
function SetUpFieldMove_Surf(): boolean {
  const { x, y } = GetXYCoordsOneStepInFrontOfPlayer();
  const f = avatarField();
  if (!f.behaviors.is(f.behaviorAt(x, y), 'FAST_WATER') && PartyHasMonWithSurf() && IsPlayerFacingSurfableFishableWater()) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_Surf);
    return true;
  }
  return false; // (party_menu.c's DisplayCantUseSurfMessage says why)
}

/** FieldCallback_Surf */
function FieldCallback_Surf(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  FieldEffectStart('FLDEFF_USE_SURF');
}

/** SetUpFieldMove_Waterfall: surfing north into a waterfall. */
function SetUpFieldMove_Waterfall(): boolean {
  const { x, y } = GetXYCoordsOneStepInFrontOfPlayer();
  const f = avatarField();
  if (f.behaviors.is(f.behaviorAt(x, y), 'WATERFALL') && IsPlayerSurfingNorth()) {
    gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
    setPostMenuFieldCallback(FieldCallback_Waterfall);
    return true;
  }
  return false;
}

/** FieldCallback_Waterfall */
function FieldCallback_Waterfall(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  FieldEffectStart('FLDEFF_USE_WATERFALL');
}

// ------------------------------------------------------------------ field_effect.c: FldEff_UseSurf

/**
 * FldEff_UseSurf → Task_FldEffUseSurf (UseSurfEffect_1..5): the player's field move pose, the mon's banner,
 * then a jump onto the water with the surf blob under them. gFieldEffectArguments[0] is the party index.
 * (Overworld_ClearSavedMusic / MUS_SURF and SetHelpContext(HELPCONTEXT_SURFING): no audio, no help system.)
 */
function FldEff_UseSurf(): boolean {
  const data15 = gFieldEffectArguments[0];
  // The C holds FieldCallback_PrepareFadeInFromMenu's lock (or the script's) until UseSurfEffect_1 takes it;
  // the port's hand-offs don't, so it's taken now.
  LockPlayerFieldControls();
  // The banner's graphics load while the pose plays (as CreateFieldEffectShowMon does).
  let loaded = false;
  void LoadFieldMoveShowMonGfx().then(() => (loaded = true));
  let stage = 1;
  let dest = { x: 0, y: 0 };
  let pose: () => boolean = () => true;
  CreateTask(() => {
    const player = playerObj();
    switch (stage) {
      case 1: {
        // UseSurfEffect_1
        LockPlayerFieldControls();
        avatarField().freezeObjectEvents();
        gPlayerAvatar.preventStep = true;
        SetPlayerAvatarStateMask(PLAYER_AVATAR_FLAG.SURFING);
        const { x, y } = PlayerGetDestCoords();
        const { dx, dy } = DELTA[player.movementDirection]; // MoveCoords
        dest = { x: x + dx, y: y + dy };
        stage++;
        return false;
      }
      case 2:
        // UseSurfEffect_2: StartPlayerAvatarSummonMonForFieldMoveAnim + MOVEMENT_ACTION_START_ANIM_IN_DIRECTION
        if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
          pose = StartPlayerAvatarSummonMonForFieldMoveAnim();
          pose();
          stage++;
        }
        return false;
      case 3:
        // UseSurfEffect_3 (ObjectEventCheckHeldMovementStatus: the pose has ended; and the banner's graphics)
        if (pose() && loaded) {
          gFieldEffectArguments[0] = data15 | 0x80000000;
          FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
          stage++;
        }
        return false;
      case 4:
        // UseSurfEffect_4
        if (!FieldEffectActiveListContains('FLDEFF_FIELD_MOVE_SHOW_MON')) {
          setPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_RIDE));
          player.clearHeldMovementIfFinished();
          player.setHeldMovement(directionalAction('JUMP_SPECIAL', player.movementDirection)); // GetJumpSpecialMovementAction
          gFieldEffectArguments[0] = dest.x;
          gFieldEffectArguments[1] = dest.y;
          sPlayerSurfBlob = StartSurfBlobFieldEffect(player);
          stage++;
        }
        return false;
      default:
        // UseSurfEffect_5
        if (player.clearHeldMovementIfFinished()) {
          gPlayerAvatar.preventStep = false;
          gPlayerAvatar.flags &= ~PLAYER_AVATAR_FLAG.CONTROLLABLE;
          player.setHeldMovement(directionalAction('FACE', player.movementDirection));
          SetSurfBlob_BobState(sPlayerSurfBlob, BOB_PLAYER_AND_MON);
          avatarField().unfreezeObjectEvents();
          UnlockPlayerFieldControls();
          FieldEffectActiveListRemove('FLDEFF_USE_SURF');
          return true;
        }
        return false;
    }
  });
  return false;
}

/** ObjectEventSetGraphicsId on the player (the avatar's graphics are preloaded) */
function setPlayerGraphics(gfxId: string): void {
  const info = avatarField().spriteInfo(gfxId);
  if (info) playerObj().setGraphics(info, gfxId);
  else console.warn('[surf] graphics not loaded:', gfxId);
}

// ------------------------------------------------------------------ field_effect.c: FldEff_UseWaterfall

/**
 * FldEff_UseWaterfall → Task_UseWaterfall: the banner, then the player rides up (WALK_SLOWER north, one tile
 * at a time) until they're off the waterfall. gFieldEffectArguments[0] is the party index.
 */
function FldEff_UseWaterfall(): number {
  const data1 = gFieldEffectArguments[0];
  let loaded = false;
  void LoadFieldMoveShowMonGfx().then(() => (loaded = true));
  let stage = 0;
  let done = false;
  const player = (): ObjectEvent => playerObj();
  /** sUseWaterfallFieldEffectFuncs: each returns whether to run the next one this frame. */
  const funcs: (() => boolean)[] = [
    // waterfall_0_setup
    () => {
      LockPlayerFieldControls();
      gPlayerAvatar.preventStep = true;
      stage++;
      return false;
    },
    // waterfall_1_do_anim_probably (+ the banner's graphics)
    () => {
      LockPlayerFieldControls();
      if (!player().movementOverridden && loaded) {
        player().clearHeldMovementIfFinished();
        gFieldEffectArguments[0] = data1;
        FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
        stage++;
      }
      return false;
    },
    // waterfall_2_wait_anim_finish_probably
    () => {
      if (FieldEffectActiveListContains('FLDEFF_FIELD_MOVE_SHOW_MON')) return false;
      stage++;
      return true;
    },
    // waterfall_3_move_player_probably
    () => {
      player().setHeldMovement(directionalAction('WALK_SLOWER', 'up')); // GetWalkSlowerMovementAction(DIR_NORTH)
      stage++;
      return false;
    },
    // waterfall_4_wait_player_move_probably
    () => {
      if (!player().clearHeldMovementIfFinished()) return false;
      if (avatarField().behaviors.is(player().currentMetatileBehavior, 'WATERFALL')) {
        stage = 3;
        return true;
      }
      UnlockPlayerFieldControls();
      gPlayerAvatar.preventStep = false;
      done = true; // DestroyTask(FindTaskIdByFunc(Task_UseWaterfall))
      FieldEffectActiveListRemove('FLDEFF_USE_WATERFALL');
      return false;
    },
  ];
  const Task_UseWaterfall = (): boolean => {
    while (!done && funcs[stage]());
    return done;
  };
  Task_UseWaterfall();
  CreateTask(Task_UseWaterfall);
  return 0;
}

// ------------------------------------------------------------------ field_effect_helpers.c: the surf blob

/** enum { BOB_NONE, BOB_PLAYER_AND_MON, BOB_MON_ONLY } (field_effect_helpers.h) */
export const BOB_NONE = 0;
export const BOB_PLAYER_AND_MON = 1;
export const BOB_MON_ONLY = 2;

// The blob's sprite data (field_effect_helpers.c's defines)
const sBitfield = 0;
const sPlayerOffset = 1;
const sBobDirection = 3;
const sTimer = 4;

/** gObjectEvents[gPlayerAvatar.objectEventId].fieldEffectSpriteId: the player's surf blob, if any. */
let sPlayerSurfBlob: FieldEffectSprite | undefined;
/** The sprite FldEff_SurfBlob just made (its return value, a sprite id, in the C). */
let sNewSurfBlob: FieldEffectSprite | undefined;
/** gFieldEffectArguments[2] for FLDEFF_SURF_BLOB (an object event id in the C) */
let sBlobObject: ObjectEvent | undefined;

/** FieldEffectStart(FLDEFF_SURF_BLOB) with gFieldEffectArguments[0..1] set and [2] = `obj`; returns the sprite. */
function StartSurfBlobFieldEffect(obj: ObjectEvent): FieldEffectSprite | undefined {
  sNewSurfBlob = undefined;
  sBlobObject = obj;
  FieldEffectStart('FLDEFF_SURF_BLOB');
  return sNewSurfBlob;
}

/** FldEff_SurfBlob: at map coords (gFieldEffectArguments[0], [1]) + (8, 8), subpriority 0x96. */
function FldEff_SurfBlob(): number {
  const obj = sBlobObject ?? playerObj();
  // SetSpritePosToOffsetMapCoords(x, y, 8, 8)
  const x = gFieldEffectArguments[0] * TILE + 8;
  const y = gFieldEffectArguments[1] * TILE + 8;
  const sprite = surfHost().createFieldEffectSprite('FLDEFF_SURF_BLOB', 'SurfBlob', x, y, 0x96, UpdateSurfBlobFieldEffect);
  sprite.obj = obj; // sPlayerObjectId
  sprite.priority = 2; // gObjectEventBaseOam_32x32 (the callback copies the player's from now on)
  sprite.data[sBobDirection] = 0;
  sprite.data[6] = -1;
  sprite.data[7] = -1;
  // (oam.paletteNum = 0: the player's palette, which tools/extract_field.py draws TAG_NONE templates with)
  FieldEffectActiveListRemove('FLDEFF_SURF_BLOB');
  sNewSurfBlob = sprite;
  return 1;
}

/** SetSurfBlob_BobState */
export function SetSurfBlob_BobState(sprite: FieldEffectSprite | undefined, bobState: number): void {
  if (!sprite) return;
  sprite.data[sBitfield] = (sprite.data[sBitfield] & ~0xf) | (bobState & 0xf);
}

/** SetSurfBlob_DontSyncAnim */
export function SetSurfBlob_DontSyncAnim(sprite: FieldEffectSprite | undefined, value: boolean): void {
  if (!sprite) return;
  sprite.data[sBitfield] = (sprite.data[sBitfield] & ~0xf0) | ((Number(value) & 0xf) << 4);
}

/** SetSurfBlob_PlayerOffset (the rods' bobbing; fishing isn't ported yet) */
export function SetSurfBlob_PlayerOffset(sprite: FieldEffectSprite | undefined, hasOffset: boolean, offset: number): void {
  if (!sprite) return;
  sprite.data[sBitfield] = (sprite.data[sBitfield] & ~0xf00) | ((Number(hasOffset) & 0xf) << 8);
  sprite.data[sPlayerOffset] = offset;
}

function GetSurfBlob_BobState(sprite: FieldEffectSprite): number {
  return sprite.data[sBitfield] & 0xf;
}

function GetSurfBlob_DontSyncAnim(sprite: FieldEffectSprite): boolean {
  return ((sprite.data[sBitfield] & 0xf0) >> 4) !== 0;
}

function GetSurfBlob_HasPlayerOffset(sprite: FieldEffectSprite): boolean {
  return ((sprite.data[sBitfield] & 0xf00) >> 8) !== 0;
}

/** UpdateSurfBlobFieldEffect */
function UpdateSurfBlobFieldEffect(sprite: FieldEffectSprite): void {
  const playerObject = sprite.obj!;
  SynchroniseSurfAnim(playerObject, sprite);
  SynchroniseSurfPosition(playerObject, sprite);
  CreateBobbingEffect(playerObject, sprite);
  sprite.priority = playerObject.priority; // sprite->oam.priority = playerSprite->oam.priority
}

/** surfBlobDirectionAnims[movementDirection] */
const SURF_BLOB_DIRECTION_ANIMS: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 3 };

/** SynchroniseSurfAnim: StartSpriteAnimIfDifferent by the object's movement direction. */
function SynchroniseSurfAnim(objectEvent: ObjectEvent, sprite: FieldEffectSprite): void {
  const anim = SURF_BLOB_DIRECTION_ANIMS[objectEvent.movementDirection];
  if (!GetSurfBlob_DontSyncAnim(sprite) && sprite.animNum !== anim) sprite.startAnim(anim);
}

/** SynchroniseSurfPosition: on each new tile, whether land (elevation 3) is next to it picks the bob interval. */
function SynchroniseSurfPosition(playerObject: ObjectEvent, sprite: FieldEffectSprite): void {
  let { x, y } = playerObject.current;
  const yOffset = sprite.y2;
  if (yOffset === 0 && (x !== sprite.data[6] || y !== sprite.data[7])) {
    sprite.data[5] = yOffset;
    sprite.data[6] = x;
    sprite.data[7] = y;
    for (const dir of ['down', 'up', 'left', 'right'] as Direction[]) {
      x = sprite.data[6] + DELTA[dir].dx; // MoveCoords
      y = sprite.data[7] + DELTA[dir].dy;
      if (avatarField().elevationAt(x, y) === 3) {
        sprite.data[5]++;
        break;
      }
    }
  }
}

/**
 * CreateBobbingEffect. In FRLG sBobDirection is never set off 0, so the blob itself never moves; the player
 * rides 1 px lower on the anim's second frame. The player's y2 is the sprite's offset from its tile.
 */
function CreateBobbingEffect(objectEvent: ObjectEvent, sprite: FieldEffectSprite): void {
  const intervals = [7, 15];
  const bobState = GetSurfBlob_BobState(sprite);
  if (bobState === BOB_NONE) return;
  sprite.data[sTimer] = (sprite.data[sTimer] + 1) & 0xffff;
  if ((sprite.data[sTimer] & intervals[sprite.data[5]]) === 0) sprite.y2 += sprite.data[sBobDirection];
  if ((sprite.data[sTimer] & 0x1f) === 0) sprite.data[sBobDirection] = -sprite.data[sBobDirection];
  if (bobState !== BOB_MON_ONLY) {
    let y2 = GetSurfBlob_HasPlayerOffset(sprite) ? sprite.data[sPlayerOffset] + sprite.y2 : sprite.y2;
    if (sprite.animCmdIndex !== 0) y2++;
    objectEvent.sprite.setY(objectEvent.feetY + y2); // playerSprite->y2
    sprite.x = objectEvent.spriteX;
    sprite.y = objectEvent.spriteY + 8;
  }
}

// ------------------------------------------------------------------ the player avatar's hooks

/**
 * QL_GfxTransition_StartSurf's blob (PlayerAvatarTransition_Surfing): FLDEFF_SURF_BLOB on the player's tile,
 * bobbing with them. A blob left from before a battle or menu goes first, as the GBA rebuilds the field's sprites.
 */
export function StartPlayerSurfBlob(): void {
  DestroyPlayerSurfBlob();
  const player = playerObj();
  gFieldEffectArguments[0] = player.current.x;
  gFieldEffectArguments[1] = player.current.y;
  sPlayerSurfBlob = StartSurfBlobFieldEffect(player);
  SetSurfBlob_BobState(sPlayerSurfBlob, BOB_PLAYER_AND_MON);
}

/** SetSurfBlob_BobState on the player's blob (Task_StopSurfingInit: BOB_MON_ONLY) */
export function SetPlayerSurfBlobBobState(bobState: number): void {
  SetSurfBlob_BobState(PlayerSurfBlob(), bobState);
}

/** DestroySprite(&gSprites[playerObjEvent->fieldEffectSpriteId]) (Task_WaitStopSurfing) */
export function DestroyPlayerSurfBlob(): void {
  if (sPlayerSurfBlob?.inUse) sPlayerSurfBlob.destroy();
  sPlayerSurfBlob = undefined;
}

/** SetPlayerInvisibility's part for the blob */
export function SetPlayerSurfBlobInvisible(invisible: boolean): void {
  const blob = PlayerSurfBlob();
  if (blob) blob.invisible = invisible;
}

/** The player's blob while it's alive (a warp's sprite reset destroys it). */
export function PlayerSurfBlob(): FieldEffectSprite | undefined {
  return sPlayerSurfBlob?.inUse ? sPlayerSurfBlob : undefined;
}

/** Dev: the player's surf blob for `__test.field().surfBlob`. */
export function surfBlobProbe(): { x: number; y: number; anim: number; bobState: number; invisible: boolean; playerY2: number } | undefined {
  const blob = PlayerSurfBlob();
  if (!blob) return undefined;
  const obj = blob.obj!;
  return {
    x: blob.x + blob.x2,
    y: blob.y + blob.y2,
    anim: blob.animNum,
    bobState: GetSurfBlob_BobState(blob),
    invisible: blob.invisible,
    playerY2: obj.sprite.y - obj.feetY,
  };
}

// ------------------------------------------------------------------ registration

/** sFieldMoveCursorCallbacks' Surf and Waterfall, and their field effects' natives (called by registerFieldMoves). */
export function registerSurfAndWaterfall(): void {
  registerFieldEffectNatives({ FldEff_UseSurf, FldEff_UseWaterfall, FldEff_SurfBlob });
  registerFieldMoveSetUp('FIELD_MOVE_SURF', SetUpFieldMove_Surf);
  registerFieldMoveSetUp('FIELD_MOVE_WATERFALL', SetUpFieldMove_Waterfall);
}
