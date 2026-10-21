// field_fadetransition.c's staircase warps (MB_UP_RIGHT_STAIR_WARP .. MB_DOWN_LEFT_STAIR_WARP: the stairs that
// are walked into sideways):
// - DoStairWarp / Task_StairWarp: TryArrowWarp's IsDirectionalStairWarpMetatileBehavior branch
//   (OverworldScene.tryArrowWarp, after SetupWarp; 12 frames' delay when it takes the player off the bike). The
//   player walks in place while the sprite slides into the stairs (UpdateStairsMovement), then the fade and the warp.
// - Task_ExitStairs: SetUpWarpExitTask's MetatileBehavior_IsDirectionalStairWarp branch (OverworldScene's
//   setUpWarpExitTask): on arrival the sprite slides out of the stairs while the screen fades in.
// - gExitStairsMovementDisabled (overworld.c): set by CONTINUE (CB2_ContinueSavedGame, CB2_EnterFieldFromQuestLog),
//   the region map and a quest log scene that doesn't start with a warp; cleared by SetUpWarpExitTask, the main
//   menu, FieldCB2_UseItemFromField and a quest log scene that starts with one (QL_START_WARP).

import { K } from '../battle/constants';
import { testEvent } from '../dev/testHooks';
import { directionalAction } from '../entities/movementActions';
import { Overworld_PlaySpecialMapMusic, TryFadeOutOldMapMusic, type MapMusicHeader } from '../gba/overworldMusic';
import { BGMusicStopped, PlaySE } from '../gba/sound';
import type { Direction } from './direction';
import { CreateTask, LockPlayerFieldControls, UnlockPlayerFieldControls } from './fieldMoves';
import { avatarField, GetPlayerFacingDirection, PlayerGetDestCoords, playerObj } from './playerAvatar';
import { PlayRainStoppingSoundEffect } from './weather';

// ------------------------------------------------------------------ gExitStairsMovementDisabled

/** gExitStairsMovementDisabled: SetUpWarpExitTask picks Task_ExitNonDoor over Task_ExitStairs (and clears it). */
let sExitStairsMovementDisabled = false;

export function gExitStairsMovementDisabled(): boolean {
  return sExitStairsMovementDisabled;
}

export function setExitStairsMovementDisabled(disabled: boolean): void {
  sExitStairsMovementDisabled = disabled;
}

// ------------------------------------------------------------------ the host

/** What the stair warp needs from the field beyond the avatar host. Implemented by OverworldScene. */
export interface StairWarpHost {
  /** The destination SetupWarp stored, once its header has loaded: undefined while it loads, null if there's none. */
  warpDestinationHeader(): MapMusicHeader | null | undefined;
  /** WarpFadeOutScreen toward the destination (to white into a cave). */
  warpFadeOutScreen(): void;
  /** WaitWarpFadeOutScreen: gPaletteFade.active */
  paletteFadeActive(): boolean;
  /** gFieldCallback = FieldCB_DefaultWarpExit, WarpIntoMap, SetMainCallback2(CB2_LoadMap) */
  warpIntoMap(): void;
}

/** Task_ExitStairs' field: the arrival's fade. */
export interface ExitStairsHost {
  /** WarpFadeInScreen (from white out of a cave) */
  warpFadeInScreen(): void;
  /** FieldFadeTransitionBackgroundEffectIsFinished */
  fieldFadeTransitionBackgroundEffectIsFinished(): boolean;
}

// ------------------------------------------------------------------ the movement

/** GetWalkInPlaceNormalMovementAction / GetWalkInPlaceFastMovementAction */
function walkInPlace(speed: 'NORMAL' | 'FAST', dir: Direction): number {
  return directionalAction(`WALK_IN_PLACE_${speed}`, dir);
}

/** The player sprite's x2 / y2 (the offsets are in 1/32 px: >> 5). */
function setPlayerSpriteX2Y2(offsetX: number, offsetY: number): void {
  playerObj().setSpriteX2Y2(offsetX >> 5, offsetY >> 5);
}

/** GetStairsMovementDirection: the sprite's speed into the stairs, in 1/32 px a frame. */
export function GetStairsMovementDirection(metatileBehavior: number): { x: number; y: number } {
  const b = metatileBehavior & 0xff; // (a u8 parameter)
  if (b === K.MB_UP_RIGHT_STAIR_WARP) return { x: 16, y: -10 };
  if (b === K.MB_UP_LEFT_STAIR_WARP) return { x: -17, y: -10 };
  if (b === K.MB_DOWN_RIGHT_STAIR_WARP) return { x: 17, y: 3 };
  if (b === K.MB_DOWN_LEFT_STAIR_WARP) return { x: -17, y: 3 };
  return { x: 0, y: 0 };
}

/** MetatileBehavior_IsDirectionalStairWarp: any of the four. */
export function MetatileBehavior_IsDirectionalStairWarp(metatileBehavior: number): boolean {
  return metatileBehavior >= K.MB_UP_RIGHT_STAIR_WARP && metatileBehavior <= K.MB_DOWN_LEFT_STAIR_WARP;
}

/** The stair warp's task data (s16 data[16]): its state, the behavior, the speed, the offset, the timer, the delay. */
interface StairTaskData {
  state: number; // data[0]
  behavior: number; // data[1]
  speedX: number; // data[2]
  speedY: number; // data[3]
  offsetX: number; // data[4]
  offsetY: number; // data[5]
  timer: number; // data[6]
  delay: number; // data[15]
}

/**
 * UpdateStairsMovement: x moves every frame, y (going up) only after the first 6 frames; the player keeps
 * walking in place.
 */
function UpdateStairsMovement(d: StairTaskData): void {
  const player = playerObj();
  if (d.speedY > 0 || d.timer > 6) d.offsetY += d.speedY;
  d.offsetX += d.speedX;
  d.timer++;
  setPlayerSpriteX2Y2(d.offsetX, d.offsetY);
  if (player.heldMovementFinished) player.forceSetHeldMovement(walkInPlace('NORMAL', GetPlayerFacingDirection()));
}

/** ForceStairsMovement: walking in place, and the speed for the behavior. */
function ForceStairsMovement(d: StairTaskData): void {
  playerObj().forceSetHeldMovement(walkInPlace('NORMAL', GetPlayerFacingDirection()));
  const speed = GetStairsMovementDirection(d.behavior);
  d.speedX = speed.x;
  d.speedY = speed.y;
}

// ------------------------------------------------------------------ DoStairWarp

let host: StairWarpHost | undefined;

export function setStairWarpHost(h: StairWarpHost): void {
  host = h;
}

function stairHost(): StairWarpHost {
  if (!host) throw new Error('[stairWarp] no field host');
  return host;
}

/** DoStairWarp: Task_StairWarp (priority 10), whose first state runs at once. */
export function DoStairWarp(metatileBehavior: number, delay: number): void {
  const d: StairTaskData = { state: 0, behavior: metatileBehavior, speedX: 0, speedY: 0, offsetX: 0, offsetY: 0, timer: 0, delay };
  testEvent('stairWarp', { behavior: metatileBehavior, delay });
  let destroyed = false;
  const task = (): boolean => {
    Task_StairWarp(d, () => (destroyed = true));
    return destroyed;
  };
  task();
  CreateTask(task);
}

/** Task_StairWarp */
function Task_StairWarp(d: StairTaskData, destroyTask: () => void): void {
  const h = stairHost();
  const player = playerObj();
  switch (d.state) {
    case 0:
      LockPlayerFieldControls();
      avatarField().freezeObjectEvents(); // FreezeObjectEvents
      // CameraObjectReset2: the camera stays where it is (it follows the object's tile, not the sprite's x2 / y2)
      d.state++;
      break;
    case 1:
      if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
        if (d.delay !== 0) d.delay--;
        else {
          // (the port loads the destination's header after SetupWarp: until it's there, this state holds)
          const dest = h.warpDestinationHeader();
          if (dest === undefined) break;
          if (dest) TryFadeOutOldMapMusic(dest);
          PlayRainStoppingSoundEffect();
          player.priority = 1; // playerSpr->oam.priority = 1
          player.updateSubpriority();
          ForceStairsMovement(d);
          PlaySE(K.SE_EXIT);
          testEvent('stairWarpMove');
          d.state++;
        }
      }
      break;
    case 2:
      UpdateStairsMovement(d);
      d.delay++;
      if (d.delay >= 12) {
        if (h.warpDestinationHeader()) h.warpFadeOutScreen();
        testEvent('stairWarpFadeOut');
        d.state++;
      }
      break;
    case 3:
      UpdateStairsMovement(d);
      if (!h.paletteFadeActive() && BGMusicStopped()) d.state++;
      break;
    default:
      if (h.warpDestinationHeader()) h.warpIntoMap();
      else {
        console.warn('[warp] no warp destination set');
        UnlockPlayerFieldControls();
        avatarField().unfreezeObjectEvents();
      }
      destroyTask();
      break;
  }
}

// ------------------------------------------------------------------ Task_ExitStairs

/** Task_ExitStairs' data: its state, then ExitStairsMovement's speed, offset and timer (data[1..5]). */
interface ExitTaskData {
  state: number;
  speedX: number;
  speedY: number;
  offsetX: number;
  offsetY: number;
  timer: number;
}

/**
 * ExitStairsMovement: facing away from the stairs (walking in place fast), the sprite starts 16 frames' worth of
 * the stairs' speed into them and comes back out.
 */
function ExitStairsMovement(d: ExitTaskData): void {
  const { x, y } = PlayerGetDestCoords();
  const behavior = avatarField().behaviorAt(x, y) & 0xff; // (u8)
  const direction: Direction = behavior === K.MB_DOWN_RIGHT_STAIR_WARP || behavior === K.MB_UP_RIGHT_STAIR_WARP ? 'left' : 'right';
  playerObj().forceSetHeldMovement(walkInPlace('FAST', direction));
  const speed = GetStairsMovementDirection(behavior);
  d.offsetX = speed.x * 16;
  d.offsetY = speed.y * 16;
  d.timer = 16;
  setPlayerSpriteX2Y2(d.offsetX, d.offsetY);
  d.speedX = -speed.x;
  d.speedY = -speed.y;
}

/** WaitStairExitMovementFinished: TRUE while the sprite is still coming out. */
function WaitStairExitMovementFinished(d: ExitTaskData): boolean {
  if (d.timer !== 0) {
    d.offsetX += d.speedX;
    d.offsetY += d.speedY;
    setPlayerSpriteX2Y2(d.offsetX, d.offsetY);
    d.timer--;
    return true;
  }
  playerObj().setSpriteX2Y2(0, 0);
  return false;
}

/**
 * CreateTask(Task_ExitStairs, 10) from SetUpWarpExitTask. Returns whether the task has ended (it unlocks the
 * controls then), for the field's wait.
 */
export function StartExitStairs(h: ExitStairsHost): () => boolean {
  const d: ExitTaskData = { state: 0, speedX: 0, speedY: 0, offsetX: 0, offsetY: 0, timer: 0 };
  let done = false;
  testEvent('exitStairs');
  CreateTask(() => {
    switch (d.state) {
      default:
        if (h.fieldFadeTransitionBackgroundEffectIsFinished()) {
          // CameraObjectReset1 (the camera never left the player's tile)
          UnlockPlayerFieldControls();
          done = true;
          testEvent('exitStairsDone');
        }
        break;
      case 0:
        Overworld_PlaySpecialMapMusic();
        h.warpFadeInScreen();
        LockPlayerFieldControls();
        ExitStairsMovement(d);
        d.state++;
        break;
      case 1:
        if (!WaitStairExitMovementFinished(d)) d.state++;
        break;
    }
    return done;
  });
  return () => done;
}
