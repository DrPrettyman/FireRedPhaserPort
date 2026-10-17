// menu_indicators.c: the bouncing scroll indicator arrow pairs (the red outline / red arrow list cursor
// objects, ListMenuAddCursorObjectInternal & co., are in gba/listMenu.ts). The C's `u16 *scrollOffset` is a getter here, and the
// pair's state lives in a table keyed by its task id instead of in the task data.

import { animTable } from '../battle/gfx';
import { gSineTable } from '../battle/trig';
import { gfx, gfx16 } from '../gba/gfx';
import { LoadPalette, OBJ_PLTT_ID } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  oam,
  SPRITE_SHAPE,
  StartSpriteAnim,
  TAG_NONE,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask } from '../gba/task';

// SCROLL_ARROW_* (include/menu_indicators.h)
export const SCROLL_ARROW_LEFT = 0;
export const SCROLL_ARROW_RIGHT = 1;
export const SCROLL_ARROW_UP = 2;
export const SCROLL_ARROW_DOWN = 3;

export interface ScrollArrowsTemplate {
  firstArrowType: number;
  firstX: number;
  firstY: number;
  secondArrowType: number;
  secondX: number;
  secondY: number;
  fullyUpThreshold: number;
  fullyDownThreshold: number;
  tileTag: number;
  palTag: number;
  palNum: number;
}

interface ScrollIndicatorPair {
  scrollOffset: () => number;
  fullyUpThreshold: number;
  fullyDownThreshold: number;
  topSpriteId: number;
  bottomSpriteId: number;
  tileTag: number;
  palTag: number;
}

/** sScrollIndicatorTemplates: animNum, bounceDir, multiplier, frequency */
const sScrollIndicatorTemplates = [
  { animNum: 0, bounceDir: 0, multiplier: 2, frequency: 8 },
  { animNum: 1, bounceDir: 0, multiplier: 2, frequency: -8 },
  { animNum: 2, bounceDir: 1, multiplier: 2, frequency: 8 },
  { animNum: 3, bounceDir: 1, multiplier: 2, frequency: -8 },
];

const sOamData_ScrollArrowIndicator = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 0 });

function sSpriteTemplate_ScrollArrowIndicator(): SpriteTemplate {
  return {
    tileTag: 0,
    paletteTag: 0,
    oam: sOamData_ScrollArrowIndicator,
    anims: animTable('menu_indicators.c', 'sSpriteAnimTable_ScrollArrowIndicator'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallback_ScrollIndicatorArrow,
  };
}

const sPairs = new Map<number, ScrollIndicatorPair>();

// sprite->data: tState 0, tAnimNum 1, tBounceDir 2, tMultiplier 3, tFrequency 4, tSinePos 5
function SpriteCallback_ScrollIndicatorArrow(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      StartSpriteAnim(sprite, d[1]);
      d[0]++;
      break;
    case 1:
      switch (d[2]) {
        case 0:
          sprite.x2 = Math.trunc((gSineTable(d[5] & 0xff) * d[3]) / 256);
          break;
        case 1:
          sprite.y2 = Math.trunc((gSineTable(d[5] & 0xff) * d[3]) / 256);
          break;
      }
      d[5] += d[4];
      break;
  }
}

function AddScrollIndicatorArrowObject(arrowDir: number, x: number, y: number, tileTag: number, palTag: number): number {
  const spriteTemplate = { ...sSpriteTemplate_ScrollArrowIndicator(), tileTag, paletteTag: palTag };
  const spriteId = CreateSprite(spriteTemplate, x, y, 0);
  const s = gSprites[spriteId];
  const t = sScrollIndicatorTemplates[arrowDir];
  s.invisible = true;
  s.data[0] = 0;
  s.data[1] = t.animNum;
  s.data[2] = t.bounceDir;
  s.data[3] = t.multiplier;
  s.data[4] = t.frequency;
  s.data[5] = 0;
  return spriteId;
}

export function AddScrollIndicatorArrowPair(arrowInfo: ScrollArrowsTemplate, scrollOffset: () => number): number {
  LoadCompressedSpriteSheet({ data: gfx('sRedArrowOtherGfx'), size: 0x100, tag: arrowInfo.tileTag });
  if (arrowInfo.palTag === TAG_NONE) LoadPalette(gfx16('sRedArrowPal'), OBJ_PLTT_ID(arrowInfo.palNum), 32);
  else LoadSpritePalette({ data: gfx16('sRedArrowPal'), tag: arrowInfo.palTag });
  const taskId = CreateTask(Task_ScrollIndicatorArrowPair, 0);
  const data: ScrollIndicatorPair = {
    scrollOffset,
    fullyUpThreshold: arrowInfo.fullyUpThreshold,
    fullyDownThreshold: arrowInfo.fullyDownThreshold,
    tileTag: arrowInfo.tileTag,
    palTag: arrowInfo.palTag,
    topSpriteId: AddScrollIndicatorArrowObject(arrowInfo.firstArrowType, arrowInfo.firstX, arrowInfo.firstY, arrowInfo.tileTag, arrowInfo.palTag),
    bottomSpriteId: AddScrollIndicatorArrowObject(arrowInfo.secondArrowType, arrowInfo.secondX, arrowInfo.secondY, arrowInfo.tileTag, arrowInfo.palTag),
  };
  sPairs.set(taskId, data);
  if (arrowInfo.palTag === TAG_NONE) {
    gSprites[data.topSpriteId].oam.paletteNum = arrowInfo.palNum;
    gSprites[data.bottomSpriteId].oam.paletteNum = arrowInfo.palNum;
  }
  return taskId;
}

export function AddScrollIndicatorArrowPairParameterized(
  arrowType: number,
  commonPos: number,
  firstPos: number,
  secondPos: number,
  fullyDownThreshold: number,
  tileTag: number,
  palTag: number,
  scrollOffset: () => number,
): number {
  const t: ScrollArrowsTemplate =
    arrowType === SCROLL_ARROW_UP || arrowType === SCROLL_ARROW_DOWN
      ? { firstArrowType: SCROLL_ARROW_UP, firstX: commonPos, firstY: firstPos, secondArrowType: SCROLL_ARROW_DOWN, secondX: commonPos, secondY: secondPos, fullyUpThreshold: 0, fullyDownThreshold, tileTag, palTag, palNum: 0 }
      : { firstArrowType: SCROLL_ARROW_LEFT, firstX: firstPos, firstY: commonPos, secondArrowType: SCROLL_ARROW_RIGHT, secondX: secondPos, secondY: commonPos, fullyUpThreshold: 0, fullyDownThreshold, tileTag, palTag, palNum: 0 };
  return AddScrollIndicatorArrowPair(t, scrollOffset);
}

function Task_ScrollIndicatorArrowPair(taskId: number): void {
  const data = sPairs.get(taskId)!;
  const currItem = data.scrollOffset() & 0xffff;
  gSprites[data.topSpriteId].invisible = currItem === data.fullyUpThreshold;
  gSprites[data.bottomSpriteId].invisible = currItem === data.fullyDownThreshold;
}

export function RemoveScrollIndicatorArrowPair(taskId: number): void {
  const data = sPairs.get(taskId)!;
  if (data.tileTag !== TAG_NONE) FreeSpriteTilesByTag(data.tileTag);
  if (data.palTag !== TAG_NONE) FreeSpritePaletteByTag(data.palTag);
  DestroySprite(gSprites[data.topSpriteId]);
  DestroySprite(gSprites[data.bottomSpriteId]);
  sPairs.delete(taskId);
  DestroyTask(taskId);
}
