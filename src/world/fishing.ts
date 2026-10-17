// Fishing: field_player_avatar.c's StartFishing / Task_Fishing (Fishing1..Fishing16) and
// AlignFishingAnimationFrames, quest_log_player.c's QL_GfxTransition_Fish (StartPlayerAvatarFishAnim), and
// item_use.c's CanFish. The bag's FieldUseFunc_Rod / ItemUseOnFieldCB_Rod are in menus/itemUse.ts; the
// encounter (DoesCurrentMapHaveFishingMons, FishingWildEncounter) is world/WildEncounters.ts, reached through
// the field items host (world/fieldItems.ts).
//
// FRLG's Task_Fishing differs from R/S/Emerald: Fishing7 (a bite) goes straight to Fishing10 ("A POKéMON's on
// the hook!"), so there is no "Oh! A bite!", no A-press window and only one round of dots; Fishing8, Fishing9
// and Fishing13 ("It got away...") can't be reached. They are ported as they are anyway.
//
// The player's sprite: Phaser draws ObjectEvent sprites without sprite.c's anims, so while the fishing
// graphics are up this module runs the sprite's anim state (SpriteAnim) itself, AnimateSprites' call after
// the task's, and puts the frame, flip and x2/y2 on the player's sprite.

import { K } from '../battle/constants';
import { testEvent } from '../dev/testHooks';
import { SpriteAnim } from '../entities/FieldEffects';
import { encodeRaw, text } from '../menus/common';
import { random } from '../util/random';
import type { Direction } from './direction';
import { registerItemUseFieldFuncs } from '../menus/itemUse';
import { DisplayItemMessageOnField, fieldItemsHost } from './fieldItems';
import {
  CanUseEscapeRopeOnCurrMap,
  CreateTask,
  fieldMoveHost,
  LockPlayerFieldControls,
  Overworld_ResetStateAfterDigEscRope,
  Task_UseDigEscapeRopeOnField,
  UnlockPlayerFieldControls,
} from './fieldMoves';
import {
  avatarField,
  GetPlayerAvatarGraphicsIdByStateId,
  GetPlayerFacingDirection,
  GetXYCoordsOneStepInFrontOfPlayer,
  gPlayerAvatar,
  PLAYER_AVATAR_FLAG,
  playerObj,
  TestPlayerAvatarFlags,
} from './playerAvatar';
import { IsPlayerFacingSurfableFishableWater, PlayerSurfBlob, SetSurfBlob_PlayerOffset } from './surf';

// ------------------------------------------------------------------ item_use.c

/** CanFish: water (not a waterfall) in front, from the bank or while surfing. */
export function CanFish(): boolean {
  const { x, y } = GetXYCoordsOneStepInFrontOfPlayer();
  const tile = fieldMoveHost().tileAt(x, y);
  const behaviors = avatarField().behaviors;
  if (behaviors.is(tile.behavior, 'WATERFALL')) return false;
  if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.UNDERWATER)) return false;
  if (!TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING)) {
    if (IsPlayerFacingSurfableFishableWater()) return true;
  } else {
    if (behaviors.isSurfable(tile.behavior) && tile.collision === 0) return true; // MapGridGetCollisionAt
    // (MetatileBehavior_IsBridge is always FALSE in FRLG)
  }
  return false;
}

// ------------------------------------------------------------------ the player's sprite

/** sFishingDirectionAnimNums / sFishingNoCatchDirectionAnimNums / sFishingBiteDirectionAnimNums (DIR_NONE is SOUTH) */
const DIR_SUFFIX: Record<Direction, string> = { down: 'SOUTH', up: 'NORTH', left: 'WEST', right: 'EAST' };
const GetFishingDirectionAnimNum = (dir: Direction) => K[`ANIM_TAKE_OUT_ROD_${DIR_SUFFIX[dir]}`];
const GetFishingNoCatchDirectionAnimNum = (dir: Direction) => K[`ANIM_PUT_AWAY_ROD_${DIR_SUFFIX[dir]}`];
const GetFishingBiteDirectionAnimNum = (dir: Direction) => K[`ANIM_HOOKED_POKEMON_${DIR_SUFFIX[dir]}`];

/** gSprites[gPlayerAvatar.spriteId]'s anim state and x2/y2 while it shows the fishing graphics. */
let sPlayerSprite: { anim: SpriteAnim; x2: number; y2: number } | undefined;

/** ObjectEventSetGraphicsId on the player (the graphics are preloaded at boot). */
function setPlayerGraphics(gfxId: string): void {
  const info = avatarField().spriteInfo(gfxId);
  if (info) playerObj().setGraphics(info, gfxId);
  else console.warn(`[fishing] graphics ${gfxId} not loaded`);
}

/** StartSpriteAnim on the player's sprite, with the anim table its current graphics info names. */
function StartPlayerSpriteAnim(animNum: number): void {
  if (!sPlayerSprite) {
    const anims = fieldItemsHost().objectEventAnims(playerObj().info.anims) ?? [];
    sPlayerSprite = { anim: new SpriteAnim(anims), x2: 0, y2: 0 };
  }
  sPlayerSprite.anim.startAnim(animNum);
}

/**
 * StartPlayerAvatarFishAnim → QuestLogCallUpdatePlayerSprite(QL_PLAYER_GFX_FISH) → QL_GfxTransition_Fish
 * (outside quest log playback): the fishing graphics and the take-out-rod anim for the facing.
 */
function StartPlayerAvatarFishAnim(direction: Direction): void {
  setPlayerGraphics(GetPlayerAvatarGraphicsIdByStateId(K.PLAYER_AVATAR_GFX_FISH));
  StartPlayerSpriteAnim(GetFishingDirectionAnimNum(direction));
}

/** Back from the fishing graphics (Fishing11 / Fishing15): ObjectEventSetGraphicsId, ObjectEventTurn, x2 = y2 = 0. */
function RestorePlayerGraphics(gfxId: string): void {
  sPlayerSprite = undefined;
  setPlayerGraphics(gfxId);
  const player = playerObj();
  player.face(player.movementDirection);
  if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.SURFING) SetSurfBlob_PlayerOffset(PlayerSurfBlob(), false, 0);
  player.sprite.setPosition(player.anchor.x, player.feetY + player.lift);
}

/** The OAM entry for the player's sprite: the anim's frame and flip, at x2/y2. */
function renderPlayerSprite(): void {
  if (!sPlayerSprite) return;
  const player = playerObj();
  const { anim, x2, y2 } = sPlayerSprite;
  player.sprite.setFrame(anim.image);
  player.sprite.setFlipX(anim.hFlip);
  // (while surfing the blob's bobbing sets the y, with the offset SetSurfBlob_PlayerOffset gave it)
  player.sprite.setPosition(player.anchor.x + x2, player.feetY + player.lift + y2);
}

/** anims[animNum][animCmdIndex].type: a frame's imageValue, or -1 / -2 / -3 for END / JUMP / LOOP. */
function cmdType(anim: SpriteAnim, index: number): number {
  const cmd = anim.anims[anim.animNum]?.[index];
  if (!cmd) return -1;
  if (typeof cmd[0] === 'number') return cmd[0];
  return cmd[0] === 'end' ? -1 : cmd[0] === 'jump' ? -2 : -3;
}

/**
 * AlignFishingAnimationFrames: an extra AnimateSprite whose delay countdown is given back (so the anim keeps
 * its speed), then the 32x32 frame's offset: the rod frames to the side, above or below the player.
 */
function AlignFishingAnimationFrames(): void {
  const s = sPlayerSprite;
  if (!s) return;
  const anim = s.anim;
  anim.animate();
  s.x2 = 0;
  s.y2 = 0;
  let animCmdIndex = anim.animCmdIndex;
  if (cmdType(anim, animCmdIndex) === -1) {
    animCmdIndex--;
  } else {
    anim.animDelayCounter = (anim.animDelayCounter + 1) & 0x3f; // a 6-bit field
    if (cmdType(anim, animCmdIndex) === -1) animCmdIndex--;
  }
  const animType = cmdType(anim, animCmdIndex);
  if (animType === 1 || animType === 2 || animType === 3) {
    s.x2 = 8;
    if (GetPlayerFacingDirection() === 'left') s.x2 = -8;
  }
  if (animType === 5) s.y2 = -8;
  if (animType === 10 || animType === 11) s.y2 = 8;
  if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.SURFING) SetSurfBlob_PlayerOffset(PlayerSurfBlob(), true, s.y2);
}

// ------------------------------------------------------------------ Task_Fishing

/** Task_Fishing's data: tStep, tFrameCounter, tNumDots, tDotsRequired, tRoundsPlayed, tMinRoundsRequired, tPlayerGfxId, tFishingRod */
interface FishingTask {
  step: number;
  frameCounter: number;
  numDots: number;
  dotsRequired: number;
  roundsPlayed: number;
  minRoundsRequired: number;
  playerGfxId: string;
  rod: number;
  destroyed: boolean;
}

/** The running Task_Fishing (dev probe) */
let sTask: FishingTask | undefined;

const FISHING_START_ROUND = 3;
const FISHING_NO_BITE = 11;
const FISHING_GOT_AWAY = 12;
const FISHING_SHOW_RESULT = 13;

/** StartFishing: the rod is ItemId_GetSecondaryId (OLD_ROD / GOOD_ROD / SUPER_ROD). */
export function StartFishing(rod: number): void {
  const task: FishingTask = {
    step: 0,
    frameCounter: 0,
    numDots: 0,
    dotsRequired: 0,
    roundsPlayed: 0,
    minRoundsRequired: 0,
    playerGfxId: '',
    rod,
    destroyed: false,
  };
  sTask = task;
  testEvent('fishing', { rod });
  Task_Fishing(task); // (QuestLogTryRecordPlayerAvatarGfxTransition: no quest log)
  CreateTask(() => {
    if (!task.destroyed) Task_Fishing(task);
    // AnimateSprites, after the tasks: the player's sprite runs its anim once more and is drawn
    if (sPlayerSprite) {
      sPlayerSprite.anim.animate();
      renderPlayerSprite();
    }
    return task.destroyed;
  });
}

function Task_Fishing(task: FishingTask): void {
  while (!task.destroyed && sFishingStateFuncs[task.step](task));
}

function Fishing1(task: FishingTask): boolean {
  LockPlayerFieldControls();
  gPlayerAvatar.preventStep = true;
  task.step++;
  return false;
}

function Fishing2(task: FishingTask): boolean {
  const arr1 = [1, 1, 1];
  const arr2 = [1, 3, 6];
  task.roundsPlayed = 0;
  task.minRoundsRequired = arr1[task.rod] + (random() % arr2[task.rod]);
  const player = playerObj();
  task.playerGfxId = player.graphicsId;
  player.clearHeldMovementIfActive(); // ObjectEventClearHeldMovementIfActive
  player.enableAnim = true;
  StartPlayerAvatarFishAnim(player.facing);
  task.step++;
  return false;
}

/** Wait one second */
function Fishing3(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  task.frameCounter++;
  if (task.frameCounter >= 60) task.step++;
  return false;
}

function Fishing4(task: FishingTask): boolean {
  fieldItemsHost().openMessageBox(); // LoadMessageBoxAndFrameGfx(0, TRUE)
  task.step++;
  task.frameCounter = 0;
  task.numDots = 0;
  const randVal = random() % 10;
  task.dotsRequired = randVal + 1;
  if (task.roundsPlayed === 0) task.dotsRequired = randVal + 4;
  if (task.dotsRequired >= 10) task.dotsRequired = 10;
  return true;
}

/** Play a round of the dot game */
function Fishing5(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  task.frameCounter++;
  if (task.frameCounter >= 20) {
    task.frameCounter = 0;
    if (task.numDots >= task.dotsRequired) {
      task.step++;
      if (task.roundsPlayed !== 0) task.step++;
      task.roundsPlayed++;
    } else {
      fieldItemsHost().printMessage(encodeRaw('·$'), task.numDots * 12, 0, false);
      task.numDots++;
    }
  }
  return false;
}

/** Determine if fish bites */
function Fishing6(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  task.step++;
  if (!fieldItemsHost().doesCurrentMapHaveFishingMons() || random() & 1) {
    task.step = FISHING_NO_BITE;
  } else {
    StartPlayerSpriteAnim(GetFishingBiteDirectionAnimNum(GetPlayerFacingDirection()));
    testEvent('fishingBite');
  }
  return true;
}

/** A bite: on to "A POKéMON's on the hook!" (FRLG skips Fishing8's A-press window) */
function Fishing7(task: FishingTask): boolean {
  task.step += 3; // FISHING_ON_HOOK
  return false;
}

/** We have a bite. Now, wait for the player to press A, or the timer to expire. (Unreachable in FRLG.) */
function Fishing8(task: FishingTask): boolean {
  const reelTimeouts = [36, 33, 30];
  AlignFishingAnimationFrames();
  task.frameCounter++;
  if (task.frameCounter >= reelTimeouts[task.rod]) task.step = FISHING_GOT_AWAY;
  else if (fieldItemsHost().aButtonNew()) task.step++;
  return false;
}

/** Determine if we're going to play the dot game again (unreachable in FRLG) */
function Fishing9(task: FishingTask): boolean {
  const arr = [
    [0, 0],
    [40, 10],
    [70, 30],
  ];
  AlignFishingAnimationFrames();
  task.step++;
  if (task.roundsPlayed < task.minRoundsRequired) {
    task.step = FISHING_START_ROUND;
  } else if (task.roundsPlayed < 2) {
    // probability of having to play another round
    const probability = random() % 100;
    if (arr[task.rod][task.roundsPlayed] > probability) task.step = FISHING_START_ROUND;
  }
  return false;
}

function Fishing10(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  fieldItemsHost().printMessage(text('gText_PokemonOnHook'), 0, 1, true);
  testEvent('fishingResult', { result: 'onHook' });
  task.step++;
  task.frameCounter = 0;
  return false;
}

function Fishing11(task: FishingTask): boolean {
  const h = fieldItemsHost();
  if (task.frameCounter === 0) AlignFishingAnimationFrames();
  // (RunTextPrinters: the field's message box runs its printer itself)
  if (task.frameCounter === 0) {
    if (!h.messagePrinting()) {
      RestorePlayerGraphics(task.playerGfxId);
      h.clearMessageBox();
      task.frameCounter++;
      return false;
    }
  }
  if (task.frameCounter !== 0) {
    gPlayerAvatar.preventStep = false;
    UnlockPlayerFieldControls();
    task.destroyed = true; // DestroyTask(FindTaskIdByFunc(Task_Fishing))
    h.fishingWildEncounter(task.rod);
  }
  return false;
}

/** Not even a nibble */
function Fishing12(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  StartPlayerSpriteAnim(GetFishingNoCatchDirectionAnimNum(GetPlayerFacingDirection()));
  fieldItemsHost().printMessage(text('gText_NotEvenANibble'), 0, 1, true);
  testEvent('fishingResult', { result: 'noBite' });
  task.step = FISHING_SHOW_RESULT;
  return true;
}

/** It got away (unreachable in FRLG; it prints without clearing the window first) */
function Fishing13(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  StartPlayerSpriteAnim(GetFishingNoCatchDirectionAnimNum(GetPlayerFacingDirection()));
  fieldItemsHost().printMessage(text('gText_ItGotAway'), 0, 1, false);
  testEvent('fishingResult', { result: 'gotAway' });
  task.step++;
  return true;
}

function Fishing14(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  task.step++;
  return false;
}

function Fishing15(task: FishingTask): boolean {
  AlignFishingAnimationFrames();
  if (sPlayerSprite?.anim.animEnded) {
    RestorePlayerGraphics(task.playerGfxId);
    task.step++;
  }
  return false;
}

function Fishing16(task: FishingTask): boolean {
  const h = fieldItemsHost();
  if (!h.messagePrinting()) {
    gPlayerAvatar.preventStep = false;
    UnlockPlayerFieldControls();
    avatarField().unfreezeObjectEvents();
    h.clearMessageBox();
    task.destroyed = true;
    testEvent('fishingEnd');
  }
  return false;
}

const sFishingStateFuncs: ((task: FishingTask) => boolean)[] = [
  Fishing1,
  Fishing2,
  Fishing3,
  Fishing4,
  Fishing5,
  Fishing6,
  Fishing7,
  Fishing8,
  Fishing9,
  Fishing10,
  Fishing11,
  Fishing12,
  Fishing13,
  Fishing14,
  Fishing15,
  Fishing16,
];

/**
 * Dev: Task_Fishing's state (tStep: 0 = Fishing1, ...) and the fishing anim on the player's sprite, for
 * `__test.field().fishing`.
 */
export function fishingProbe(): { step: number; animNum?: number; image?: number; x2?: number; y2?: number } | undefined {
  if (!sTask || sTask.destroyed) return undefined;
  const s = sPlayerSprite;
  return { step: sTask.step, ...(s && { animNum: s.anim.animNum, image: s.anim.image, x2: s.x2, y2: s.y2 }) };
}

/** The field side of the bag's rods and Escape Rope (menus/itemUse.ts' ItemUseFieldFuncs), registered at boot. */
export function registerFieldItems(): void {
  registerItemUseFieldFuncs({
    CanFish,
    StartFishing,
    CanUseEscapeRopeOnCurrMap,
    LockPlayerFieldControls,
    Overworld_ResetStateAfterDigEscRope,
    DisplayItemMessageOnField,
    Task_UseDigEscapeRopeOnField,
  });
}
