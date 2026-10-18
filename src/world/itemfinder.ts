// The Itemfinder: itemfinder.c's field side (ItemUseOnFieldCB_Itemfinder, the response tasks and their messages,
// the arrow and star sprites). The search itself (HiddenItemIsWithinRangeOfPlayer and the connected maps') is
// world/itemfinderSearch.ts; the bag's ItemUseOutOfBattle_Itemfinder is menus/itemUse.ts, which reaches
// ItemUseOnFieldCB_Itemfinder through registerItemfinder.
//
// FRLG's Itemfinder doesn't turn the player (Emerald's does): the arrows point the way. They're screen-fixed
// sprites (CreateSprite at (120, 76), no coordinate offset), drawn here as FieldEffectSprites at the camera's
// top left plus their screen position (the camera doesn't move meanwhile). Their tiles (sArrowAndStarSpriteTiles)
// use OBJ palette 0, the player's (gObjectEventPal_Player) in the field. Each ding plays SE_ITEMFINDER.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import type { MapData } from '../data/types';
import { testEvent } from '../dev/testHooks';
import { FieldEffectSprite, type AnimCmd } from '../entities/FieldEffects';
import { gfx, gfx16 } from '../gba/gfx';
import { PlaySE } from '../gba/sound';
import { ConvertIntToDecimalStringN, ExpandToStringVar4, STR_CONV_MODE_LEFT_ALIGN, text } from '../menus/common';
import { registerItemUseFieldFuncs } from '../menus/itemUse';
import { DisplayItemMessageOnField, fieldItemsHost } from './fieldItems';
import { CreateTask, fieldMoveHost, LockPlayerFieldControls, ScriptContext_SetupScript, UnlockPlayerFieldControls } from './fieldMoves';
import { canvasTexture, drawFrames } from './hallOfFameRecord';
import {
  DIR_EAST,
  DIR_NONE,
  DIR_NORTH,
  DIR_SOUTH,
  DIR_WEST,
  GetPlayerDirectionTowardsHiddenItem,
  HiddenItemIsWithinRangeOfPlayer,
  newItemfinderSearch,
  type ItemfinderSearch,
} from './itemfinderSearch';
import { avatarField, ClearPlayerHeldMovement, GetPlayerFacingDirection } from './playerAvatar';

/** Graphics the Itemfinder draws (preload at boot). */
export const ITEMFINDER_GFX = ['sArrowAndStarSpriteTiles', 'gObjectEventPal_Player'];

/** What the Itemfinder reads from the field (OverworldScene). */
export interface ItemfinderHost {
  /** gMapHeader */
  currentMap(): MapData;
  /** GetMapHeaderFromConnection: a connected map's header (the loaded neighbours'). */
  mapHeader(mapId: string): MapData | undefined;
  /** PlayerGetDestCoords, map-local */
  playerLocal(): { x: number; y: number };
}

let host: ItemfinderHost | undefined;

export function setItemfinderHost(h: ItemfinderHost): void {
  host = h;
}

function field(): ItemfinderHost {
  if (!host) throw new Error('[itemfinder] no field host');
  return host;
}

// ------------------------------------------------------------------ the task

interface ItemfinderTask {
  /** gTasks[taskId].func while the task runs its own funcs (undefined while a message's task has it) */
  func: ((task: ItemfinderTask) => void) | undefined;
  search: ItemfinderSearch;
  tDingTimer: number;
  tDingNum: number;
  tStartSpriteId: number;
  destroyed: boolean;
}

let sTask: ItemfinderTask | undefined;

/** ItemUseOnFieldCB_Itemfinder (ItemUseOutOfBattle_Itemfinder sets it; GAME_STAT_USED_ITEMFINDER isn't tracked). */
export function ItemUseOnFieldCB_Itemfinder(): void {
  // On the GBA the start menu's lock is still held when the bag returns; here the field's overlay held the
  // controls until now, so the task takes the lock itself (as the VS Seeker's does).
  LockPlayerFieldControls();
  const task: ItemfinderTask = { func: undefined, search: newItemfinderSearch(), tDingTimer: 0, tDingNum: 0, tStartSpriteId: 0, destroyed: false };
  sTask = task;
  const h = field();
  const found = HiddenItemIsWithinRangeOfPlayer(
    { map: h.currentMap(), mapHeader: (id) => h.mapHeader(id), player: h.playerLocal(), flagGet: (flag) => state.getFlag(flag) },
    task.search,
  );
  const s = task.search;
  if (found) {
    if (s.tUnderfoot) SetUnderfootHiddenItemVars(s);
    testEvent('itemfinder', {
      result: s.tUnderfoot ? 'underfoot' : 'response',
      itemX: s.tItemX,
      itemY: s.tItemY,
      dings: s.tNumDingsRemaining,
      direction: GetPlayerDirectionTowardsHiddenItem(s.tItemX, s.tItemY),
    });
    LoadArrowAndStarTiles();
    task.func = s.tUnderfoot ? Task_ItemfinderUnderfootSoundsAndAnims : Task_ItemfinderResponseSoundsAndAnims;
    // The item's task, then AnimateSprites (each sprite's callback, then its anim), every frame
    CreateTask(() => {
      if (!task.destroyed) task.func?.(task);
      runSprites();
      return task.destroyed && sSprites.length === 0;
    });
  } else {
    testEvent('itemfinder', { result: 'none' });
    task.destroyed = true; // (DisplayItemMessageOnField's task takes over)
    DisplayItemMessageOnField(ExpandToStringVar4(text('gText_NopeTheresNoResponse')), Task_NoResponse_CleanUp);
  }
}

/** SetUnderfootHiddenItem's special vars: the flag, the item, a quantity of 1 (HIDDEN_ITEM_QUANTITY is ignored). */
function SetUnderfootHiddenItemVars(s: ItemfinderSearch): void {
  const e = s.underfootItem!;
  const item = K[String(e.item)];
  state.setVar('VAR_0x8004', K[String(e.flag)]);
  state.setVar('VAR_0x8005', item);
  state.setVar('VAR_0x8006', 1);
  // TV_PrintIntToStringVar(0, gSpecialVar_0x8005)
  state.stringVars[0] = ConvertIntToDecimalStringN(item, STR_CONV_MODE_LEFT_ALIGN, String(item).length).slice(0, -1);
}

/** Task_NoResponse_CleanUp */
function Task_NoResponse_CleanUp(): void {
  fieldItemsHost().clearMessageBox(); // ClearDialogWindowAndFrame(0, TRUE)
  ClearPlayerHeldMovementAndUnfreezeObjectEvents();
  UnlockPlayerFieldControls();
  testEvent('itemfinderEnd');
}

/** Task_ItemfinderResponseSoundsAndAnims: a ding (and an arrow) every 25 frames, then the message. */
function Task_ItemfinderResponseSoundsAndAnims(task: ItemfinderTask): void {
  const s = task.search;
  if (task.tDingTimer % 25 === 0) {
    const direction = GetPlayerDirectionTowardsHiddenItem(s.tItemX, s.tItemY);
    if (s.tNumDingsRemaining === 0) {
      task.func = Task_ItemfinderResponsePrintMessage;
      return;
    }
    PlaySE(K.SE_ITEMFINDER);
    CreateArrowSprite(task.tDingNum, direction);
    task.tDingNum++;
    s.tNumDingsRemaining--;
  }
  task.tDingTimer++;
}

/** Task_ItemfinderUnderfootSoundsAndAnims: a ding (and a star) every 25 frames, then the message. */
function Task_ItemfinderUnderfootSoundsAndAnims(task: ItemfinderTask): void {
  const s = task.search;
  if (task.tDingTimer % 25 === 0) {
    if (s.tNumDingsRemaining === 0) {
      task.func = Task_ItemfinderUnderfootPrintMessage;
      return;
    }
    PlaySE(K.SE_ITEMFINDER);
    task.tStartSpriteId = CreateStarSprite();
    task.tDingNum++;
    s.tNumDingsRemaining--;
  }
  task.tDingTimer++;
}

/** Task_ItemfinderResponsePrintMessage */
function Task_ItemfinderResponsePrintMessage(task: ItemfinderTask): void {
  task.func = undefined;
  DisplayItemMessageOnField(ExpandToStringVar4(text('gText_ItemfinderResponding')), () => Task_ItemfinderResponseCleanUp(task));
}

/** Task_ItemfinderResponseCleanUp */
function Task_ItemfinderResponseCleanUp(task: ItemfinderTask): void {
  DestroyArrowAndStarTiles();
  fieldItemsHost().clearMessageBox(); // ClearDialogWindowAndFrame(0, TRUE)
  ClearPlayerHeldMovementAndUnfreezeObjectEvents();
  UnlockPlayerFieldControls();
  task.destroyed = true;
  testEvent('itemfinderEnd');
}

/** Task_ItemfinderUnderfootPrintMessage */
function Task_ItemfinderUnderfootPrintMessage(task: ItemfinderTask): void {
  task.func = undefined;
  DisplayItemMessageOnField(ExpandToStringVar4(text('gText_ItemfinderShakingWildly')), () => Task_ItemfinderUnderfootDigUpItem(task));
}

/**
 * Task_ItemfinderUnderfootDigUpItem: EventScript_ItemfinderDigUpUnderfootItem with the message box still up.
 * (The C locks the controls again after setting the script up; here the running script holds the field's input,
 * and ScriptContext_SetupScript hands the task's lock to it.)
 */
function Task_ItemfinderUnderfootDigUpItem(task: ItemfinderTask): void {
  DestroyArrowAndStarTiles();
  task.destroyed = true;
  ScriptContext_SetupScript('EventScript_ItemfinderDigUpUnderfootItem');
  testEvent('itemfinderEnd');
}

/** ClearPlayerHeldMovementAndUnfreezeObjectEvents */
function ClearPlayerHeldMovementAndUnfreezeObjectEvents(): void {
  ClearPlayerHeldMovement();
  avatarField().unfreezeObjectEvents();
}

// ------------------------------------------------------------------ the arrow and star sprites

const ARROW_TEXTURE = 'itemfinder_arrow_star';

/** sArrowAndStarSpriteAnimTable: sArrowAnim0..3, sStarAnim (ANIMCMD_FRAME(tile, 10): 4 tiles a frame). */
const sArrowAndStarSpriteAnimTable: AnimCmd[][] = [0, 4, 8, 12, 16].map((tile) => [[tile / 4, 10, 0, 0], ['end']]);

/** sArrowAndStarSpriteAffineAnimTable: Left, Down, Right, Up (AFFINEANIMCMD_FRAME's rotation, 256 = a turn). */
const sAffineRotations = [0x00, 0x40, 0x80, 0xc0];

/** The sprite's screen position (x, y), its data (spData0, spDeltaX, ...) and callback. */
interface ArrowSprite {
  fe: FieldEffectSprite;
  x: number;
  y: number;
  data: number[];
  callback: (s: ArrowSprite) => void;
  /** probe: anim and affine anim numbers */
  animNum: number;
  affineAnim: number;
}

const spData0 = 0;
const spDeltaX = 1;
const spDeltaY = 2;
const spCurX = 3;
const spCurY = 4;
const spCenterX = 5;
const spCenterY = 6;
const spAnimNum = 7;

const sSprites: ArrowSprite[] = [];

/** LoadArrowAndStarTiles: the tiles, drawn in OBJ palette 0 (the player's). */
function LoadArrowAndStarTiles(): void {
  const tex = canvasTexture(fieldMoveHost().scene, ARROW_TEXTURE, 16, 16, 5);
  drawFrames(tex, gfx('sArrowAndStarSpriteTiles'), gfx16('gObjectEventPal_Player'), 16, 16, 5);
}

/** DestroyArrowAndStarTiles: FreeSpriteTilesByTag (the texture stays; any sprite still out is gone by then). */
function DestroyArrowAndStarTiles(): void {}

/** CreateSprite(&sSpriteTemplate_ArrowAndStar, 120, 76, 0) */
function createArrowAndStarSprite(callback: (s: ArrowSprite) => void): ArrowSprite {
  const fe = new FieldEffectSprite(fieldMoveHost().scene, 'ITEMFINDER', ARROW_TEXTURE, { frameWidth: 16, frameHeight: 16, anims: sArrowAndStarSpriteAnimTable }, 0, 0, 0, () => {});
  const s: ArrowSprite = { fe, x: 120, y: 76, data: [0, 0, 0, 0, 0, 0, 0, 0], callback, animNum: 0, affineAnim: 0 };
  sSprites.push(s);
  return s;
}

function StartSpriteAnim(s: ArrowSprite, animNum: number): void {
  s.animNum = animNum;
  s.fe.animNum = animNum;
  s.fe.animBeginning = true;
}

function StartSpriteAffineAnim(s: ArrowSprite, anim: number): void {
  s.affineAnim = anim;
  // GBA rotations turn the picture counterclockwise; Phaser's turn it clockwise
  s.fe.rotation = (-sAffineRotations[anim] / 256) * 2 * Math.PI;
}

/** CreateArrowSprite: an arrow moving 100/256 px a frame toward the item (see GetPlayerDirectionTowardsHiddenItem). */
function CreateArrowSprite(animNum: number, direction: number): void {
  const s = createArrowAndStarSprite(SpriteCallback_Arrow);
  StartSpriteAnim(s, animNum);
  StartSpriteAffineAnim(s, 0);
  const d = s.data;
  d[spAnimNum] = animNum;
  d[spData0] = 0;
  d[spCurX] = 0;
  d[spCurY] = 0;
  d[spCenterX] = 120;
  d[spCenterY] = 76;
  switch (direction) {
    case DIR_NONE:
      switch (GetPlayerFacingDirection()) {
        case 'left':
          d[spDeltaX] = -100;
          d[spDeltaY] = 0;
          StartSpriteAffineAnim(s, 0);
          break;
        case 'up':
          d[spDeltaX] = 0;
          d[spDeltaY] = -100;
          StartSpriteAffineAnim(s, 3);
          break;
        case 'right':
          d[spDeltaX] = 100;
          d[spDeltaY] = 0;
          StartSpriteAffineAnim(s, 2);
          break;
        case 'down':
          d[spDeltaX] = 0;
          d[spDeltaY] = 100;
          StartSpriteAffineAnim(s, 1);
          break;
      }
      break;
    case DIR_SOUTH:
      d[spDeltaX] = 0;
      d[spDeltaY] = -100;
      StartSpriteAffineAnim(s, 3);
      break;
    case DIR_NORTH:
      d[spDeltaX] = 100;
      d[spDeltaY] = 0;
      StartSpriteAffineAnim(s, 2);
      break;
    case DIR_WEST:
      d[spDeltaX] = 0;
      d[spDeltaY] = 100;
      StartSpriteAffineAnim(s, 1);
      break;
    case DIR_EAST:
      d[spDeltaX] = -100;
      d[spDeltaY] = 0;
      break;
  }
  testEvent('itemfinderArrow', { anim: animNum, affineAnim: s.affineAnim, deltaX: d[spDeltaX], deltaY: d[spDeltaY] });
}

/** SpriteCallback_Arrow / SpriteCallback_Star: move until 16 px out from the centre. */
function SpriteCallback_Arrow(s: ArrowSprite): void {
  const d = s.data;
  d[spCurX] = (d[spCurX] + d[spDeltaX]) << 16 >> 16; // s16
  d[spCurY] = (d[spCurY] + d[spDeltaY]) << 16 >> 16;
  s.x = d[spCenterX] + (d[spCurX] >> 8);
  s.y = d[spCenterY] + (d[spCurY] >> 8);
  if (s.x <= 104 || s.x > 132 || s.y <= 60 || s.y > 88) s.callback = SpriteCallback_Destroy;
}

/** SpriteCallback_DestroyArrow (FreeSpriteOamMatrix + DestroySprite) / SpriteCallback_DestroyStar */
function SpriteCallback_Destroy(s: ArrowSprite): void {
  s.fe.destroy();
}

/** CreateStarSprite: a star rising from the player. */
function CreateStarSprite(): number {
  const s = createArrowAndStarSprite(SpriteCallback_Arrow); // SpriteCallback_Star is the same movement
  StartSpriteAnim(s, 4);
  const d = s.data;
  d[spAnimNum] = 0;
  d[spData0] = 0;
  d[spCurX] = 0;
  d[spCurY] = 0;
  d[spCenterX] = 120;
  d[spCenterY] = 76;
  d[spDeltaX] = 0;
  d[spDeltaY] = -100;
  testEvent('itemfinderStar');
  return sSprites.length - 1;
}

/** AnimateSprites for the arrows and stars, then their OAM entries (priority 0, subpriority 0: above the objects). */
function runSprites(): void {
  const h = fieldMoveHost();
  const o = h.camera();
  for (const s of [...sSprites]) {
    s.callback(s);
    if (!s.fe.inUse) {
      sSprites.splice(sSprites.indexOf(s), 1);
      continue;
    }
    s.fe.animate();
    s.fe.x = o.x + s.x;
    s.fe.y = o.y + s.y;
    s.fe.render(h.cameraTop());
  }
}

// ------------------------------------------------------------------ registration and probes

/** Dev: the Itemfinder's sprites while they're out (screen position, anim, affine anim), for `__test.field().itemfinder`. */
export function itemfinderProbe(): { running: boolean; sprites: { x: number; y: number; anim: number; affineAnim: number; image: number }[] } | undefined {
  if (!sTask || (sTask.destroyed && sSprites.length === 0)) return undefined;
  return {
    running: !sTask.destroyed,
    sprites: sSprites.map((s) => ({ x: s.x, y: s.y, anim: s.animNum, affineAnim: s.affineAnim, image: s.fe.image })),
  };
}

/** The bag's side: ItemUseOutOfBattle_Itemfinder's ItemUseOnFieldCB. */
export function registerItemfinder(): void {
  registerItemUseFieldFuncs({ ItemUseOnFieldCB_Itemfinder });
}
