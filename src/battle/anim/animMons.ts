// battle_anim_mons.c: the helpers battle anim callbacks share (battler sprite lookup, translations,
// rot/scale, palette masks, the anim BGs), plus SetAnimBgAttribute / GetAnimBgAttribute /
// CopyBattlerSpriteToBg from battle_intro.c. Coordinates, subpriorities and the plain linear
// translation were ported earlier with the send-out code and live in ../gfx.ts.

import { ArcTan2 } from '../../gba/bios';
import { FillBgTilemapBufferRect, CopyBgTilemapBufferToVram, CopyToBgTilemapBuffer, LoadBgTiles, LoadBgTilemap } from '../../gba/bg';
import { gfx, gfx16 } from '../../gba/gfx';
import { BLDALPHA_BLEND, GetGpuReg, OBJ_VRAM0, REG_OFFSET_BG0CNT, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, SetGpuReg, vram } from '../../gba/hw';
import { BlendPalette, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, OBJ_PLTT_ID, PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  AllocSpritePalette,
  CalcCenterToCornerVec,
  CopySprite,
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpritePaletteByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gOamMatrices,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ObjAffineSet,
  SetCallbackToStoredInData6,
  SpriteCallbackDummy,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_AFFINE_OFF,
  ST_OAM_AFFINE_ON_MASK,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_OBJ_WINDOW,
  type AffineAnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { bdata, g } from '../env';
import {
  AnimTranslateLinear,
  AnimTranslateLinear_WithFollowup,
  GET_UNOWN_LETTER,
  GetBattlerSpriteBGPriorityRank,
  InitAnimArcTranslation,
  TranslateAnimHorizontalArc,
  GetBattlerElevation,
  GetBattlerSpriteCoord,
  GetBattlerSpriteFinal_Y,
  GetBattlerSpriteSubpriority,
  GetMonSpritePalFromSpeciesAndPersonality,
  gMonSpritesGfxPtr,
  InitAnimLinearTranslation,
  IsBattlerSpritePresent,
  IsBattlerSpriteVisible,
  LoadSpecialPokePic,
  StartAnimLinearTranslation,
} from '../gfx';
import { Cos, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from '../util';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, gBattleAnimBgTileBuffer, gBattleAnimBgTilemapBuffer } from './state';

export {
  AnimTranslateLinear,
  AnimTranslateLinear_WithFollowup,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  InitAnimArcTranslation,
  InitAnimLinearTranslation,
  IsBattlerSpritePresent,
  IsBattlerSpriteVisible,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
} from '../gfx';

export const SPRITE_NONE = 0xff;
export const MON_PIC_HEIGHT = 64;
const BG_ANIM_PAL_1 = 8;
const BG_ANIM_PAL_2 = 9;
const BG_SCREEN_SIZE = 0x800;

export const IsDoubleBattle = (): boolean => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;
/** BATTLE_PARTNER */
export const BATTLE_PARTNER = (battler: number): number => battler ^ K.BIT_FLANK;
const s16 = (v: number) => (v << 16) >> 16;

// ------------------------------------------------------------------ coords

/** GetBattlerSpriteCoord2: like GetBattlerSpriteCoord, but reads gAnimBattlerSpecies */
export function GetBattlerSpriteCoord2(battlerId: number, coordType: number): number {
  if (coordType === K.BATTLER_COORD_Y_PIC_OFFSET || coordType === K.BATTLER_COORD_Y_PIC_OFFSET_DEFAULT) {
    const t = g.battleSpritesDataPtr.battlerData[battlerId].transformSpecies;
    const species = t || anim.battlerSpecies[battlerId];
    return GetBattlerSpriteFinal_Y(battlerId, species, coordType === K.BATTLER_COORD_Y_PIC_OFFSET);
  }
  return GetBattlerSpriteCoord(battlerId, coordType);
}

function battlerMonSpecies(battlerId: number): number {
  const t = g.battleSpritesDataPtr.battlerData[battlerId].transformSpecies;
  if (t) return t;
  const party = getBattlerSide(battlerId) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
  return party[g.battlerPartyIndexes[battlerId]]?.species ?? 0;
}

/** GetBattlerYCoordWithElevation */
export function GetBattlerYCoordWithElevation(battlerId: number): number {
  let y = GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y);
  if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) y -= GetBattlerElevation(battlerId, battlerMonSpecies(battlerId));
  return y & 0xff;
}

/** GetAnimBattlerSpriteId */
export function GetAnimBattlerSpriteId(animBattler: number): number {
  if (animBattler === K.ANIM_ATTACKER) return IsBattlerSpritePresent(anim.attacker) ? g.battlerSpriteIds[anim.attacker] : SPRITE_NONE;
  if (animBattler === K.ANIM_TARGET) return IsBattlerSpritePresent(anim.target) ? g.battlerSpriteIds[anim.target] : SPRITE_NONE;
  if (animBattler === K.ANIM_ATK_PARTNER) {
    return IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker)) ? g.battlerSpriteIds[BATTLE_PARTNER(anim.attacker)] : SPRITE_NONE;
  }
  return IsBattlerSpriteVisible(BATTLE_PARTNER(anim.target)) ? g.battlerSpriteIds[BATTLE_PARTNER(anim.target)] : SPRITE_NONE;
}

// ------------------------------------------------------------------ circles and linear translations

function wrapCirclePos(sprite: Sprite, i: number): void {
  if (sprite.data[i] >= 0x100) sprite.data[i] -= 0x100;
  else if (sprite.data[i] < 0) sprite.data[i] += 0x100;
}

/** TranslateSpriteInCircle: data[0] pos, [1] amplitude, [2] speed, [3] duration */
export function TranslateSpriteInCircle(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3]) {
    sprite.x2 = Sin(d[0], d[1]);
    sprite.y2 = Cos(d[0], d[1]);
    d[0] += d[2];
    wrapCirclePos(sprite, 0);
    d[3]--;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteInGrowingCircle: data[4] amplitude speed, [5] amplitude change */
export function TranslateSpriteInGrowingCircle(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3]) {
    sprite.x2 = Sin(d[0], (d[5] >> 8) + d[1]);
    sprite.y2 = Cos(d[0], (d[5] >> 8) + d[1]);
    d[0] += d[2];
    d[5] += d[4];
    wrapCirclePos(sprite, 0);
    d[3]--;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteInEllipse: data[1] x amplitude, [4] y amplitude */
export function TranslateSpriteInEllipse(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3]) {
    sprite.x2 = Sin(d[0], d[1]);
    sprite.y2 = Cos(d[0], d[4]);
    d[0] += d[2];
    wrapCirclePos(sprite, 0);
    d[3]--;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** WaitAnimForDuration */
export function WaitAnimForDuration(sprite: Sprite): void {
  if (sprite.data[0] > 0) sprite.data[0]--;
  else SetCallbackToStoredInData6(sprite);
}

/** ConvertPosDataToTranslateLinearData */
export function ConvertPosDataToTranslateLinearData(sprite: Sprite): void {
  const d = sprite.data;
  if (d[1] > d[2]) d[0] = -d[0];
  const xDiff = d[2] - d[1];
  const old = d[0];
  d[0] = Math.abs(Math.trunc(xDiff / d[0]));
  d[2] = Math.trunc((d[4] - d[3]) / d[0]);
  d[1] = old;
}

/** TranslateSpriteLinear: data[0] steps, [1] x speed, [2] y speed */
export function TranslateSpriteLinear(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    sprite.x2 += d[1];
    sprite.y2 += d[2];
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteLinearFixedPoint */
export function TranslateSpriteLinearFixedPoint(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    d[3] += d[1];
    d[4] += d[2];
    sprite.x2 = d[3] >> 8;
    sprite.y2 = d[4] >> 8;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteLinearById: moves gSprites[data[3]] */
export function TranslateSpriteLinearById(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    gSprites[d[3]].x2 += d[1];
    gSprites[d[3]].y2 += d[2];
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteLinearByIdFixedPoint: moves gSprites[data[5]] */
export function TranslateSpriteLinearByIdFixedPoint(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    d[3] += d[1];
    d[4] += d[2];
    gSprites[d[5]].x2 = d[3] >> 8;
    gSprites[d[5]].y2 = d[4] >> 8;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** TranslateSpriteLinearAndFlicker */
export function TranslateSpriteLinearAndFlicker(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    sprite.x2 = d[2] >> 8;
    d[2] += d[1];
    sprite.y2 = d[4] >> 8;
    d[4] += d[3];
    if (d[5] && d[0] % d[5] === 0) sprite.invisible = !sprite.invisible;
  } else {
    SetCallbackToStoredInData6(sprite);
  }
}

/** DestroySpriteAndMatrix */
export function DestroySpriteAndMatrix(sprite: Sprite): void {
  DestroyAnimSprite(sprite);
}

/** DestroyAnimSpriteAfterTimer (battle_anim_flying.c): waits data[0] frames */
export function DestroyAnimSpriteAfterTimer(sprite: Sprite): void {
  if (sprite.data[0]-- <= 0) {
    if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) {
      FreeOamMatrix(sprite.oam.matrixNum);
      sprite.oam.affineMode = ST_OAM_AFFINE_OFF;
    }
    DestroySprite(sprite);
    anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
  }
}

/** RunStoredCallbackWhenAffineAnimEnds */
export function RunStoredCallbackWhenAffineAnimEnds(sprite: Sprite): void {
  if (sprite.affineAnimEnded) SetCallbackToStoredInData6(sprite);
}

/** RunStoredCallbackWhenAnimEnds */
export function RunStoredCallbackWhenAnimEnds(sprite: Sprite): void {
  if (sprite.animEnded) SetCallbackToStoredInData6(sprite);
}

/** DestroyAnimSpriteAndDisableBlend */
export function DestroyAnimSpriteAndDisableBlend(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimSprite(sprite);
}

/** DestroyAnimVisualTaskAndDisableBlend */
export function DestroyAnimVisualTaskAndDisableBlend(taskId: number): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimVisualTask(taskId);
}

/** SetSpriteCoordsToAnimAttackerCoords */
export function SetSpriteCoordsToAnimAttackerCoords(sprite: Sprite): void {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
}

/** SetAnimSpriteInitialXOffset: the offset points from the attacker towards the target */
export function SetAnimSpriteInitialXOffset(sprite: Sprite, xOffset: number): void {
  const attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
  const targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  if (attackerX > targetX) sprite.x -= xOffset;
  else if (attackerX < targetX) sprite.x += xOffset;
  else if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) sprite.x -= xOffset;
  else sprite.x += xOffset;
}

/** TranslateAnimVerticalArc: data[5] is the arc amplitude */
export function TranslateAnimVerticalArc(sprite: Sprite): boolean {
  if (AnimTranslateLinear(sprite)) return true;
  sprite.data[7] += sprite.data[6];
  sprite.x2 += Sin((sprite.data[7] >> 8) & 0xff, sprite.data[5]);
  return false;
}

/** InitSpritePosToAnimTarget */
export function InitSpritePosToAnimTarget(sprite: Sprite, respectMonPicOffsets: boolean): void {
  // Anim sprites are created at the target's center, hence no else branch (as in the C).
  if (!respectMonPicOffsets) {
    sprite.x = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_Y);
  }
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}

/** InitSpritePosToAnimAttacker */
export function InitSpritePosToAnimAttacker(sprite: Sprite, respectMonPicOffsets: boolean): void {
  if (!respectMonPicOffsets) {
    sprite.x = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_Y);
  } else {
    sprite.x = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  }
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
}

/** InitSpriteDataForLinearTranslation */
export function InitSpriteDataForLinearTranslation(sprite: Sprite): void {
  const d = sprite.data;
  const x = s16((d[2] - d[1]) << 8);
  const y = s16((d[4] - d[3]) << 8);
  d[1] = Math.trunc(x / d[0]);
  d[2] = Math.trunc(y / d[0]);
  d[4] = 0;
  d[3] = 0;
}

/** InitAnimLinearTranslationWithSpeed: data[0] is the speed in, the frame count out */
export function InitAnimLinearTranslationWithSpeed(sprite: Sprite): void {
  const v1 = Math.abs(sprite.data[2] - sprite.data[1]) << 8;
  sprite.data[0] = Math.trunc(v1 / sprite.data[0]);
  InitAnimLinearTranslation(sprite);
}

/** InitAnimLinearTranslationWithSpeedAndPos */
export function InitAnimLinearTranslationWithSpeedAndPos(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimTranslateLinear_WithFollowup;
  sprite.callback(sprite);
}

/** InitAnimFastLinearTranslation: like InitAnimLinearTranslation in 1/16 px (data[5] = duration) */
function InitAnimFastLinearTranslation(sprite: Sprite): void {
  const d = sprite.data;
  const xDiff = d[2] - d[1];
  const yDiff = d[4] - d[3];
  let x2 = (Math.abs(xDiff) << 4) & 0xffff;
  let y2 = (Math.abs(yDiff) << 4) & 0xffff;
  x2 = Math.trunc(x2 / d[0]) & 0xffff;
  y2 = Math.trunc(y2 / d[0]) & 0xffff;
  x2 = xDiff < 0 ? x2 | 1 : x2 & ~1;
  y2 = yDiff < 0 ? y2 | 1 : y2 & ~1;
  d[1] = x2;
  d[2] = y2;
  d[4] = 0;
  d[3] = 0;
}

/** InitAndRunAnimFastLinearTranslation */
export function InitAndRunAnimFastLinearTranslation(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimFastLinearTranslation(sprite);
  sprite.callback = AnimFastTranslateLinearWaitEnd;
  sprite.callback(sprite);
}

/** AnimFastTranslateLinear: true when finished */
export function AnimFastTranslateLinear(sprite: Sprite): boolean {
  const d = sprite.data;
  if (!d[0]) return true;
  const v1 = d[1] & 0xffff;
  const v2 = d[2] & 0xffff;
  const x = ((d[3] & 0xffff) + v1) & 0xffff;
  const y = ((d[4] & 0xffff) + v2) & 0xffff;
  sprite.x2 = v1 & 1 ? -(x >> 4) : x >> 4;
  sprite.y2 = v2 & 1 ? -(y >> 4) : y >> 4;
  d[3] = x;
  d[4] = y;
  d[0]--;
  return false;
}

function AnimFastTranslateLinearWaitEnd(sprite: Sprite): void {
  if (AnimFastTranslateLinear(sprite)) SetCallbackToStoredInData6(sprite);
}

/** InitAnimFastLinearTranslationWithSpeed */
export function InitAnimFastLinearTranslationWithSpeed(sprite: Sprite): void {
  const xDiff = Math.abs(sprite.data[2] - sprite.data[1]) << 4;
  sprite.data[0] = Math.trunc(xDiff / sprite.data[0]);
  InitAnimFastLinearTranslation(sprite);
}

/** InitAnimFastLinearTranslationWithSpeedAndPos */
export function InitAnimFastLinearTranslationWithSpeedAndPos(sprite: Sprite): void {
  sprite.data[1] = sprite.x;
  sprite.data[3] = sprite.y;
  InitAnimFastLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimFastTranslateLinearWaitEnd;
  sprite.callback(sprite);
}

// ------------------------------------------------------------------ rot/scale

/** SetSpriteRotScale (never flipped outside contests) */
export function SetSpriteRotScale(spriteId: number, xScale: number, yScale: number, rotation: number): void {
  const m = ObjAffineSet(s16(xScale), s16(yScale), rotation & 0xffff);
  Object.assign(gOamMatrices[gSprites[spriteId].oam.matrixNum], m);
}

/** PrepareBattlerSpriteForRotScale */
export function PrepareBattlerSpriteForRotScale(spriteId: number, objMode: number): void {
  const sprite = gSprites[spriteId];
  const battlerId = sprite.data[0];
  if (IsBattlerSpriteVisible(battlerId)) sprite.invisible = false;
  sprite.oam.objMode = objMode;
  sprite.affineAnimPaused = true;
  if (!sprite.oam.affineMode) sprite.oam.matrixNum = g.battleSpritesDataPtr.healthBoxesData[battlerId].matrixNum;
  sprite.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
}

/** ResetSpriteRotScale */
export function ResetSpriteRotScale(spriteId: number): void {
  const sprite = gSprites[spriteId];
  SetSpriteRotScale(spriteId, 0x100, 0x100, 0);
  sprite.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  sprite.oam.objMode = 0;
  sprite.affineAnimPaused = false;
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
}

/** SetBattlerSpriteYOffsetFromRotation */
export function SetBattlerSpriteYOffsetFromRotation(spriteId: number): void {
  const c = Math.abs(gOamMatrices[gSprites[spriteId].oam.matrixNum].c);
  gSprites[spriteId].y2 = c >> 3;
}

/** TrySetSpriteRotScale */
export function TrySetSpriteRotScale(sprite: Sprite, recalcCenterVector: boolean, xScale: number, yScale: number, rotation: number): void {
  if (sprite.oam.affineMode & 1) {
    sprite.affineAnimPaused = true;
    if (recalcCenterVector) CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
    Object.assign(gOamMatrices[sprite.oam.matrixNum], ObjAffineSet(s16(xScale), s16(yScale), rotation & 0xffff));
  }
}

/** TryResetSpriteAffineState */
export function TryResetSpriteAffineState(sprite: Sprite): void {
  TrySetSpriteRotScale(sprite, true, 0x100, 0x100, 0);
  sprite.affineAnimPaused = false;
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
}

/** ArcTan2Neg */
export function ArcTan2Neg(a: number, b: number): number {
  return -ArcTan2(a, b) & 0xffff;
}

export { ArcTan2 };

// ------------------------------------------------------------------ palettes

/** SetGreyscaleOrOriginalPalette */
export function SetGreyscaleOrOriginalPalette(paletteNum: number, restoreOriginalColor: boolean): void {
  const base = PLTT_ID(paletteNum);
  if (!restoreOriginalColor) {
    for (let i = 0; i < 16; i++) {
      const c = gPlttBufferUnfaded[base + i];
      const average = Math.trunc(((c & 0x1f) + ((c >> 5) & 0x1f) + ((c >> 10) & 0x1f)) / 3);
      gPlttBufferFaded[base + i] = (gPlttBufferFaded[base + i] & 0x8000) | average | (average << 5) | (average << 10);
    }
  } else {
    gPlttBufferFaded.set(gPlttBufferUnfaded.subarray(base, base + 16), base);
  }
}

/** GetBattlePalettesMask */
export function GetBattlePalettesMask(battleBackground: boolean, attacker: boolean, target: boolean, attackerPartner: boolean, targetPartner: boolean, anim1: boolean, anim2: boolean): number {
  let selected = 0;
  if (battleBackground) selected = 0xe;
  if (attacker) selected |= 1 << (anim.attacker + 16);
  if (target) selected |= 1 << (anim.target + 16);
  if (attackerPartner && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) selected |= 1 << (BATTLE_PARTNER(anim.attacker) + 16);
  if (targetPartner && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.target))) selected |= 1 << (BATTLE_PARTNER(anim.target) + 16);
  if (anim1) selected |= 1 << BG_ANIM_PAL_1;
  if (anim2) selected |= 1 << BG_ANIM_PAL_2;
  return selected >>> 0;
}

/** GetBattleMonSpritePalettesMask */
export function GetBattleMonSpritePalettesMask(playerLeft: boolean, playerRight: boolean, foeLeft: boolean, foeRight: boolean): number {
  let selected = 0;
  const add = (on: boolean, position: number) => {
    const b = getBattlerAtPosition(position);
    if (on && IsBattlerSpriteVisible(b)) selected |= 1 << (b + 16);
  };
  add(playerLeft, K.B_POSITION_PLAYER_LEFT);
  add(playerRight, K.B_POSITION_PLAYER_RIGHT);
  add(foeLeft, K.B_POSITION_OPPONENT_LEFT);
  add(foeRight, K.B_POSITION_OPPONENT_RIGHT);
  return selected >>> 0;
}

/** GetSpritePalIdxByBattler */
export function GetSpritePalIdxByBattler(battler: number): number {
  return battler;
}

// ------------------------------------------------------------------ generic anim sprite callbacks

/** AnimSpriteOnMonPos */
export function AnimSpriteOnMonPos(sprite: Sprite): void {
  if (!sprite.data[0]) {
    const respect = !gBattleAnimArgs[3];
    if (!gBattleAnimArgs[2]) InitSpritePosToAnimAttacker(sprite, respect);
    else InitSpritePosToAnimTarget(sprite, respect);
    sprite.data[0]++;
  } else if (sprite.animEnded || sprite.affineAnimEnded) {
    DestroySpriteAndMatrix(sprite);
  }
}

/** TranslateAnimSpriteToTargetMonLocation */
export function TranslateAnimSpriteToTargetMonLocation(sprite: Sprite): void {
  const respectMonPicOffsets = !(gBattleAnimArgs[5] & 0xff00);
  const coordType = !(gBattleAnimArgs[5] & 0xff) ? K.BATTLER_COORD_Y_PIC_OFFSET : K.BATTLER_COORD_Y;
  InitSpritePosToAnimAttacker(sprite, respectMonPicOffsets);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, coordType) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimThrowProjectile */
export function AnimThrowProjectile(sprite: Sprite): void {
  InitSpritePosToAnimAttacker(sprite, true);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimThrowProjectile_Step;
}

function AnimThrowProjectile_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimTravelDiagonally */
export function AnimTravelDiagonally(sprite: Sprite): void {
  const r4 = !gBattleAnimArgs[6];
  const coordType = r4 ? K.BATTLER_COORD_Y_PIC_OFFSET : K.BATTLER_COORD_Y;
  let battlerId: number;
  if (!gBattleAnimArgs[5]) {
    InitSpritePosToAnimAttacker(sprite, r4);
    battlerId = anim.attacker;
  } else {
    InitSpritePosToAnimTarget(sprite, r4);
    battlerId = anim.target;
  }
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  InitSpritePosToAnimTarget(sprite, r4);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(battlerId, coordType) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** CloneBattlerSpriteWithBlend: -1 if there's no free sprite */
export function CloneBattlerSpriteWithBlend(animBattler: number): number {
  const spriteId = GetAnimBattlerSpriteId(animBattler);
  if (spriteId !== SPRITE_NONE) {
    for (let i = 0; i < MAX_SPRITES; i++) {
      if (!gSprites[i].inUse) {
        CopySprite(gSprites[i], gSprites[spriteId]);
        gSprites[i].oam.objMode = ST_OAM_OBJ_BLEND;
        gSprites[i].invisible = false;
        return i;
      }
    }
  }
  return -1;
}

/** DestroySpriteWithActiveSheet: don't free the tiles the clone shares */
export function DestroySpriteWithActiveSheet(sprite: Sprite): void {
  sprite.usingSheet = true;
  DestroySprite(sprite);
}

/** AnimTranslateLinearAndFlicker_Flipped */
export function AnimTranslateLinearAndFlicker_Flipped(sprite: Sprite): void {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    sprite.x -= gBattleAnimArgs[0];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
    sprite.hFlip = true;
  } else {
    sprite.x += gBattleAnimArgs[0];
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.data[5] = gBattleAnimArgs[5];
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteLinearAndFlicker;
}

/** AnimTranslateLinearAndFlicker */
export function AnimTranslateLinearAndFlicker(sprite: Sprite): void {
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    sprite.x -= gBattleAnimArgs[0];
    gBattleAnimArgs[3] *= -1;
  } else {
    sprite.x += gBattleAnimArgs[0];
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.data[5] = gBattleAnimArgs[5];
  StartSpriteAnim(sprite, gBattleAnimArgs[6]);
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteLinearAndFlicker;
}

/** AnimSpinningSparkle (Detect / Disable) */
export function AnimSpinningSparkle(sprite: Sprite): void {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimWeatherBallUp */
export function AnimWeatherBallUp(sprite: Sprite): void {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? 5 : -10;
  sprite.data[1] = -40;
  sprite.callback = AnimWeatherBallUp_Step;
}

function AnimWeatherBallUp_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[2] += d[0];
  d[3] += d[1];
  sprite.x2 = Math.trunc(d[2] / 10);
  sprite.y2 = Math.trunc(d[3] / 10);
  if (d[1] < -20) d[1]++;
  if (sprite.y + sprite.y2 < -32) DestroyAnimSprite(sprite);
}

/** AnimWeatherBallDown */
export function AnimWeatherBallDown(sprite: Sprite): void {
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = sprite.x + gBattleAnimArgs[4];
  sprite.data[4] = sprite.y + gBattleAnimArgs[5];
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    sprite.x += (gBattleAnimArgs[4] & 0xffff) + 30;
    sprite.y = gBattleAnimArgs[5] - 20;
  } else {
    sprite.x += (gBattleAnimArgs[4] & 0xffff) - 30;
    sprite.y = gBattleAnimArgs[5] - 80;
  }
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// ------------------------------------------------------------------ tasks

/** AnimTask_AlphaFadeIn (Moonlight's moon) */
const AnimTask_AlphaFadeIn: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let v1 = 0;
  let v2 = 0;
  if (gBattleAnimArgs[2] > gBattleAnimArgs[0]) v2 = 1;
  if (gBattleAnimArgs[2] < gBattleAnimArgs[0]) v2 = -1;
  if (gBattleAnimArgs[3] > gBattleAnimArgs[1]) v1 = 1;
  if (gBattleAnimArgs[3] < gBattleAnimArgs[1]) v1 = -1;
  d[0] = 0;
  d[1] = gBattleAnimArgs[4];
  d[2] = 0;
  d[3] = gBattleAnimArgs[0];
  d[4] = gBattleAnimArgs[1];
  d[5] = v2;
  d[6] = v1;
  d[7] = gBattleAnimArgs[2];
  d[8] = gBattleAnimArgs[3];
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(gBattleAnimArgs[0], gBattleAnimArgs[1]));
  gTasks[taskId].func = AnimTask_AlphaFadeIn_Step;
};

const AnimTask_AlphaFadeIn_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[0] > d[1]) {
    d[0] = 0;
    if (++d[2] & 1) {
      if (d[3] !== d[7]) d[3] += d[5];
    } else if (d[4] !== d[8]) {
      d[4] += d[6];
    }
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
    if (d[3] === d[7] && d[4] === d[8]) DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_BlendMonInAndOut: args battler, color, target coeff, delay, times */
const AnimTask_BlendMonInAndOut: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === 0xff) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  gTasks[taskId].data[0] = OBJ_PLTT_ID(gSprites[spriteId].oam.paletteNum) + 1;
  AnimTask_BlendMonInAndOutSetup(gTasks[taskId]);
};

function AnimTask_BlendMonInAndOutSetup(task: Task): void {
  const d = task.data;
  d[1] = gBattleAnimArgs[1];
  d[2] = 0;
  d[3] = gBattleAnimArgs[2];
  d[4] = 0;
  d[5] = gBattleAnimArgs[3];
  d[6] = 0;
  d[7] = gBattleAnimArgs[4];
  task.func = AnimTask_BlendMonInAndOut_Step;
}

const AnimTask_BlendMonInAndOut_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[4] >= d[5]) {
    d[4] = 0;
    if (!d[6]) {
      d[2]++;
      BlendPalette(d[0], 15, d[2], d[1] & 0xffff);
      if (d[2] === d[3]) d[6] = 1;
    } else {
      d[2]--;
      BlendPalette(d[0], 15, d[2], d[1] & 0xffff);
      if (!d[2]) {
        if (--d[7]) {
          d[4] = 0;
          d[6] = 0;
        } else {
          DestroyAnimVisualTask(taskId);
        }
      }
    }
  }
};

/** AnimTask_BlendPalInAndOutByTag: AnimTask_BlendMonInAndOut by ANIM_TAG */
const AnimTask_BlendPalInAndOutByTag: TaskFunc = (taskId) => {
  const palette = IndexOfSpritePaletteTag(gBattleAnimArgs[0] & 0xffff);
  if (palette === 0xff) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  gTasks[taskId].data[0] = palette * 0x10 + 0x101;
  AnimTask_BlendMonInAndOutSetup(gTasks[taskId]);
};

/** PrepareAffineAnimInTaskData: the commands go in task.ref (StorePointerInVars in the C) */
export function PrepareAffineAnimInTaskData(task: Task, spriteId: number, affineAnimCmds: AffineAnimCmd[]): void {
  const d = task.data;
  d[7] = 0;
  d[8] = 0;
  d[9] = 0;
  d[15] = spriteId;
  d[10] = 0x100;
  d[11] = 0x100;
  d[12] = 0;
  task.ref = affineAnimCmds;
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_NORMAL);
}

/** RunAffineAnimFromTaskData: false once the anim has ended */
export function RunAffineAnimFromTaskData(task: Task): boolean {
  const d = task.data;
  const cmds = task.ref as AffineAnimCmd[];
  let i = d[7];
  const cmd = cmds[i];
  switch (cmd.type) {
    default: {
      let c = cmd;
      if (!c.duration) {
        d[10] = c.xScale ?? 0;
        d[11] = c.yScale ?? 0;
        d[12] = c.rotation ?? 0;
        d[7]++;
        c = cmds[++i];
      }
      d[10] += c.xScale ?? 0;
      d[11] += c.yScale ?? 0;
      d[12] += c.rotation ?? 0;
      SetSpriteRotScale(d[15], d[10], d[11], d[12]);
      SetBattlerSpriteYOffsetFromYScale(d[15]);
      if (++d[8] >= (c.duration ?? 0)) {
        d[8] = 0;
        d[7]++;
      }
      break;
    }
    case 0x7ffe: // AFFINEANIMCMDTYPE_JUMP
      d[7] = cmd.target ?? 0;
      break;
    case 0x7ffd: // AFFINEANIMCMDTYPE_LOOP
      if (cmd.count) {
        if (d[9]) {
          if (!--d[9]) {
            d[7]++;
            break;
          }
        } else {
          d[9] = cmd.count;
        }
        if (!d[7]) break;
        for (;;) {
          d[7]--;
          i--;
          if (cmds[i].type === 0x7ffd) {
            d[7]++;
            return true;
          }
          if (!d[7]) return true;
        }
      }
      d[7]++;
      break;
    case 0x7fff: // AFFINEANIMCMDTYPE_END
      gSprites[d[15]].y2 = 0;
      ResetSpriteRotScale(d[15]);
      return false;
  }
  return true;
}

/** SetBattlerSpriteYOffsetFromYScale: keeps the mon's feet in place while its y scale changes */
export function SetBattlerSpriteYOffsetFromYScale(spriteId: number): void {
  SetBattlerSpriteYOffsetFromOtherYScale(spriteId, spriteId);
}

/** SetBattlerSpriteYOffsetFromOtherYScale */
export function SetBattlerSpriteYOffsetFromOtherYScale(spriteId: number, otherSpriteId: number): void {
  const v = MON_PIC_HEIGHT - GetBattlerYDeltaFromSpriteId(otherSpriteId) * 2;
  const dm = gOamMatrices[gSprites[spriteId].oam.matrixNum].d;
  let v2 = dm ? Math.trunc((v << 8) / dm) : 0; // SAFE_DIV
  if (v2 > MON_PIC_HEIGHT * 2) v2 = MON_PIC_HEIGHT * 2;
  gSprites[spriteId].y2 = s16(Math.trunc((v - v2) / 2));
}

function GetBattlerYDeltaFromSpriteId(spriteId: number): number {
  const battlerId = gSprites[spriteId].data[0];
  const c = bdata.tables.coords;
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    if (g.battlerSpriteIds[i] === spriteId) {
      const t = g.battleSpritesDataPtr.battlerData[battlerId].transformSpecies;
      const party = getBattlerSide(i) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
      const species = t || (party[g.battlerPartyIndexes[i]]?.species ?? 0);
      const table = getBattlerSide(i) === K.B_SIDE_PLAYER ? c.monBack : c.monFront;
      return (table[species] ?? table[0] ?? [0, 0])[1];
    }
  }
  return MON_PIC_HEIGHT;
}

/** BattleAnimHelper_SetSpriteSquashParams */
export function BattleAnimHelper_SetSpriteSquashParams(task: Task, spriteId: number, xScaleStart: number, yScaleStart: number, xScaleEnd: number, yScaleEnd: number, duration: number): void {
  const d = task.data;
  d[8] = duration;
  d[15] = spriteId;
  d[9] = xScaleStart;
  d[10] = yScaleStart;
  d[13] = xScaleEnd;
  d[14] = yScaleEnd;
  d[11] = Math.trunc((xScaleEnd - xScaleStart) / duration);
  d[12] = Math.trunc((yScaleEnd - yScaleStart) / duration);
}

/** BattleAnimHelper_RunSpriteSquash: frames left */
export function BattleAnimHelper_RunSpriteSquash(task: Task): number {
  const d = task.data;
  if (!d[8]) return 0;
  if (--d[8] !== 0) {
    d[9] += d[11];
    d[10] += d[12];
  } else {
    d[9] = d[13];
    d[10] = d[14];
  }
  SetSpriteRotScale(d[15], d[9], d[10], 0);
  if (d[8]) SetBattlerSpriteYOffsetFromYScale(d[15]);
  else gSprites[d[15]].y2 = 0;
  return d[8] & 0xff;
}

/** AnimTask_GetFrustrationPowerLevel */
const AnimTask_GetFrustrationPowerLevel: TaskFunc = (taskId) => {
  const f = anim.friendship;
  gBattleAnimArgs[ARG_RET_ID] = f <= 30 ? 0 : f <= 100 ? 1 : f <= 200 ? 2 : 3;
  DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ priorities

/** InitPrioritiesForVisibleBattlers */
export function InitPrioritiesForVisibleBattlers(): void {
  for (let i = 0; i < g.battlersCount; i++) {
    if (IsBattlerSpriteVisible(i)) {
      gSprites[g.battlerSpriteIds[i]].subpriority = GetBattlerSpriteSubpriority(i);
      gSprites[g.battlerSpriteIds[i]].oam.priority = 2;
    }
  }
}

/** GetBattlerSpriteBGPriority */
export function GetBattlerSpriteBGPriority(battlerId: number): number {
  const position = getBattlerPosition(battlerId);
  if (position === K.B_POSITION_PLAYER_LEFT || position === K.B_POSITION_OPPONENT_RIGHT) return GetAnimBgAttribute(2, K.BG_ANIM_PRIORITY);
  return GetAnimBgAttribute(1, K.BG_ANIM_PRIORITY);
}

/** GetBattlerSpriteCoordAttr */
export function GetBattlerSpriteCoordAttr(battlerId: number, attr: number): number {
  const c = bdata.tables.coords;
  const player = getBattlerSide(battlerId) === K.B_SIDE_PLAYER;
  const info = g.battleSpritesDataPtr.battlerData[battlerId];
  const party = player ? g.playerParty : g.enemyParty;
  const mon = party[g.battlerPartyIndexes[battlerId]];
  const species = info.transformSpecies || (mon?.species ?? 0);
  const personality = info.transformSpecies ? g.transformedPersonalities[battlerId] : (mon?.personality ?? 0);
  const table = player ? c.monBack : c.monFront;
  let coords: [number, number];
  if (species === K.SPECIES_UNOWN) {
    const letter = GET_UNOWN_LETTER(personality);
    coords = table[letter ? letter + K.SPECIES_UNOWN_B - 1 : K.SPECIES_UNOWN] ?? [0, 0];
  } else if (!player && species === K.SPECIES_CASTFORM) {
    coords = [[0x44, 17], [0x66, 9], [0x46, 9], [0x86, 8]][g.battleMonForms[battlerId]] as [number, number]; // gCastformFrontSpriteCoords
  } else {
    coords = (species > K.NUM_SPECIES ? table[0] : table[species]) ?? [0, 0];
  }
  const width = (coords[0] >> 4) * 8;
  const height = (coords[0] & 0xf) * 8;
  switch (attr) {
    case K.BATTLER_COORD_ATTR_HEIGHT:
      return height;
    case K.BATTLER_COORD_ATTR_WIDTH:
      return width;
    case K.BATTLER_COORD_ATTR_LEFT:
      return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2) - (width >> 1);
    case K.BATTLER_COORD_ATTR_RIGHT:
      return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2) + (width >> 1);
    case K.BATTLER_COORD_ATTR_TOP:
      return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y_PIC_OFFSET) - (height >> 1);
    case K.BATTLER_COORD_ATTR_BOTTOM:
      return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y_PIC_OFFSET) + (height >> 1);
    case K.BATTLER_COORD_ATTR_RAW_BOTTOM:
      return GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_Y) + 31 - coords[1];
    default:
      return 0;
  }
}

/** SetAverageBattlerPositions: the middle of a battler and its partner (doubles) */
export function SetAverageBattlerPositions(battlerId: number, respectMonPicOffsets: boolean): { x: number; y: number } {
  const xType = respectMonPicOffsets ? K.BATTLER_COORD_X_2 : K.BATTLER_COORD_X;
  const yType = respectMonPicOffsets ? K.BATTLER_COORD_Y_PIC_OFFSET : K.BATTLER_COORD_Y;
  const bx = GetBattlerSpriteCoord(battlerId, xType);
  const by = GetBattlerSpriteCoord(battlerId, yType);
  const px = IsDoubleBattle() ? GetBattlerSpriteCoord(BATTLE_PARTNER(battlerId), xType) : bx;
  const py = IsDoubleBattle() ? GetBattlerSpriteCoord(BATTLE_PARTNER(battlerId), yType) : by;
  return { x: Math.trunc((bx + px) / 2), y: Math.trunc((by + py) / 2) };
}

// battle_anim_mons.c's local tags for the two extra mon sprites a move anim can make
const TAG_MOVE_EFFECT_MON_1 = 55125;
const TAG_MOVE_EFFECT_MON_2 = 55126;
const MON_PIC_SIZE = 0x800;

let sSpriteTemplates_MoveEffectMons: SpriteTemplate[] | null = null;

/** sSpriteTemplates_MoveEffectMons: 64x64 affine sprites with a dummy callback */
function moveEffectMonTemplates(): SpriteTemplate[] {
  return (sSpriteTemplates_MoveEffectMons ??= [TAG_MOVE_EFFECT_MON_1, TAG_MOVE_EFFECT_MON_2].map((tag) => ({
    tileTag: tag,
    paletteTag: tag,
    oam: oam(bdata.animScripts.oam['gOamData_AffineNormal_ObjNormal_64x64']),
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  })));
}

/**
 * CreateAdditionalMonSpriteForMoveAnim (Role Play, Snatch): a sprite of `species`' front or back pic, with its
 * own sheet and palette (templateId 0 or 1 picks the tag), at (x, y + the pic's y offset). The pic is
 * preloaded with the battle (every party mon's front and back pics). Deoxys's forms aren't handled
 * (LoadSpecialPokePic doesn't draw them), so ignoreDeoxys has no effect.
 */
export function CreateAdditionalMonSpriteForMoveAnim(species: number, isBackpic: boolean, templateId: number, x: number, y: number, subpriority: number, personality: number, trainerId: number, _battlerId: number, _ignoreDeoxys: boolean): number {
  const template = moveEffectMonTemplates()[templateId];
  // sSpriteSheets_MoveEffectMons: gMiscBlank_Gfx, overwritten with the pic below
  const sheet = LoadSpriteSheet({ data: new Uint8Array(MON_PIC_SIZE), size: MON_PIC_SIZE, tag: template.tileTag });
  const palette = AllocSpritePalette(template.paletteTag);
  LoadCompressedPalette(GetMonSpritePalFromSpeciesAndPersonality(species, trainerId, personality), OBJ_PLTT_ID(palette), PLTT_SIZE_4BPP);
  // gMonSpritesGfxPtr->multiUseBuffer, then RequestDma3Copy to the sheet's tiles
  const buffer = new Uint8Array(MON_PIC_SIZE);
  LoadSpecialPokePic(!isBackpic, species, personality, buffer);
  vram.set(buffer, OBJ_VRAM0 + sheet * 0x20);
  const coords = isBackpic ? bdata.tables.coords.monBack : bdata.tables.coords.monFront;
  return CreateSprite(template, x, y + (coords[species]?.[1] ?? 0), subpriority);
}

/** CreateInvisibleSpriteCopy: an OBJ-window copy of a battler sprite */
export function CreateInvisibleSpriteCopy(_battlerId: number, spriteId: number, _species: number): number {
  const newSpriteId = CreateInvisibleSprite(SpriteCallbackDummy);
  CopySprite(gSprites[newSpriteId], gSprites[spriteId]);
  const s = gSprites[newSpriteId];
  s.usingSheet = true;
  s.oam.priority = 0;
  s.oam.objMode = ST_OAM_OBJ_WINDOW;
  s.oam.tileNum = gSprites[spriteId].oam.tileNum;
  s.callback = SpriteCallbackDummy;
  return newSpriteId;
}

// AnimTask_AttackerPunchWithTrace: data[0] battler sprite, [1] speed, [2] state, [3] counter,
// [4] palette, [5] traces alive, [6] priority
const AnimTask_AttackerPunchWithTrace: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[1] = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? -8 : 8;
  d[2] = 0;
  d[3] = 0;
  gSprites[d[0]].x2 -= d[0];
  d[4] = AllocSpritePalette(K.ANIM_TAG_BENT_SPOON);
  d[5] = 0;
  const dest = OBJ_PLTT_ID(d[4]);
  const src = OBJ_PLTT_ID(gSprites[d[0]].oam.paletteNum);
  d[6] = GetBattlerSpriteSubpriority(anim.attacker);
  d[6] = d[6] === 20 || d[6] === 40 ? 2 : 3;
  gPlttBufferFaded.set(gPlttBufferUnfaded.subarray(src, src + 16), dest);
  BlendPalette(dest, 16, gBattleAnimArgs[1], gBattleAnimArgs[0] & 0xffff);
  gTasks[taskId].func = AnimTask_AttackerPunchWithTrace_Step;
};

const AnimTask_AttackerPunchWithTrace_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[2]) {
    case 0:
      CreateBattlerTrace(task, taskId);
      gSprites[d[0]].x2 += d[1];
      if (++d[3] === 5) {
        d[3]--;
        d[2]++;
      }
      break;
    case 1:
      CreateBattlerTrace(task, taskId);
      gSprites[d[0]].x2 -= d[1];
      if (--d[3] === 0) {
        gSprites[d[0]].x2 = 0;
        d[2]++;
      }
      break;
    case 2:
      if (d[5] === 0) {
        FreeSpritePaletteByTag(K.ANIM_TAG_BENT_SPOON);
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
};

function CreateBattlerTrace(task: Task, taskId: number): void {
  const spriteId = CloneBattlerSpriteWithBlend(K.ANIM_ATTACKER);
  if (spriteId >= 0) {
    const s = gSprites[spriteId];
    s.oam.priority = task.data[6];
    s.oam.paletteNum = task.data[4];
    s.data[0] = 8;
    s.data[1] = taskId;
    s.data[2] = spriteId;
    s.x2 = gSprites[task.data[0]].x2;
    s.callback = AnimBattlerTrace;
    task.data[5]++;
  }
}

function AnimBattlerTrace(sprite: Sprite): void {
  if (--sprite.data[0] === 0) {
    gTasks[sprite.data[1]].data[5]--;
    DestroySpriteWithActiveSheet(sprite);
  }
}

export const animMonsTasks: Record<string, TaskFunc> = {
  AnimTask_AlphaFadeIn,
  AnimTask_BlendMonInAndOut,
  AnimTask_BlendPalInAndOutByTag,
  AnimTask_GetFrustrationPowerLevel,
  AnimTask_AttackerPunchWithTrace,
};

// ------------------------------------------------------------------ anim BGs

export interface BattleAnimBgData {
  bgTiles: Uint8Array;
  bgTilemap: Uint16Array;
  paletteId: number;
  bgId: number;
  tilesOffset: number;
}

/** GetBattleAnimBg1Data */
export function GetBattleAnimBg1Data(): BattleAnimBgData {
  return { bgTiles: gBattleAnimBgTileBuffer, bgTilemap: gBattleAnimBgTilemapBuffer, paletteId: BG_ANIM_PAL_1, bgId: 1, tilesOffset: 0x200 };
}

/** GetBattleAnimBgData */
export function GetBattleAnimBgData(bgId: number): BattleAnimBgData {
  if (bgId === 1) return GetBattleAnimBg1Data();
  return { bgTiles: gBattleAnimBgTileBuffer, bgTilemap: gBattleAnimBgTilemapBuffer, paletteId: BG_ANIM_PAL_2, bgId: 2, tilesOffset: 0x300 };
}

/** GetBattleAnimBgDataByPriorityRank */
export function GetBattleAnimBgDataByPriorityRank(): BattleAnimBgData {
  return GetBattleAnimBgData(GetBattlerSpriteBGPriorityRank(anim.attacker) === 1 ? 1 : 2);
}

/** InitBattleAnimBg */
export function InitBattleAnimBg(bgId: number): void {
  const bg = GetBattleAnimBgData(bgId);
  bg.bgTiles.fill(0);
  LoadBgTiles(bgId, bg.bgTiles, 0x2000, bg.tilesOffset);
  FillBgTilemapBufferRect(bgId, 0, 0, 0, 32, 64, 17);
  CopyBgTilemapBufferToVram(bgId);
}

/** AnimLoadCompressedBgGfx: `src` is the graphics symbol */
export function AnimLoadCompressedBgGfx(bgId: number, src: string, tilesOffset: number): void {
  gBattleAnimBgTileBuffer.fill(0);
  const data = gfx(src);
  gBattleAnimBgTileBuffer.set(data.subarray(0, Math.min(data.length, gBattleAnimBgTileBuffer.length)));
  LoadBgTiles(bgId, gBattleAnimBgTileBuffer, 0x2000, tilesOffset);
}

/** InitAnimBgTilemapBuffer */
export function InitAnimBgTilemapBuffer(bgId: number, src: string): void {
  FillBgTilemapBufferRect(bgId, 0, 0, 0, 32, 64, 17);
  CopyToBgTilemapBuffer(bgId, gfx16(src), 0, 0);
}

/** AnimLoadCompressedBgTilemap */
export function AnimLoadCompressedBgTilemap(bgId: number, src: string): void {
  InitAnimBgTilemapBuffer(bgId, src);
  CopyBgTilemapBufferToVram(bgId);
}

/** GetBattleBgPaletteNum (2 outside contests) */
export function GetBattleBgPaletteNum(): number {
  return 2;
}

/** ToggleBg3Mode */
export function ToggleBg3Mode(largeScreenSize: boolean): void {
  SetAnimBgAttribute(3, K.BG_ANIM_SCREEN_SIZE, largeScreenSize ? 1 : 0);
  SetAnimBgAttribute(3, K.BG_ANIM_AREA_OVERFLOW_MODE, largeScreenSize ? 0 : 1);
}

// struct BgCnt bit layout: priority 0-1, charBaseBlock 2-3, mosaic 6, palettes 7, screenBaseBlock 8-12,
// areaOverflowMode 13, screenSize 14-15 (indexed by BG_ANIM_*)
const BGCNT_FIELDS: [number, number][] = [
  [14, 3], // BG_ANIM_SCREEN_SIZE
  [13, 1], // BG_ANIM_AREA_OVERFLOW_MODE
  [6, 1], // BG_ANIM_MOSAIC
  [2, 3], // BG_ANIM_CHAR_BASE_BLOCK
  [0, 3], // BG_ANIM_PRIORITY
  [7, 1], // BG_ANIM_PALETTES_MODE
  [8, 0x1f], // BG_ANIM_SCREEN_BASE_BLOCK
];

/** SetAnimBgAttribute (battle_intro.c) */
export function SetAnimBgAttribute(bgId: number, attributeId: number, value: number): void {
  if (bgId >= 4) return;
  const f = BGCNT_FIELDS[attributeId];
  if (!f) return;
  const reg = REG_OFFSET_BG0CNT + bgId * 2;
  const [shift, mask] = f;
  SetGpuReg(reg, (GetGpuReg(reg) & ~(mask << shift)) | ((value & mask) << shift));
}

/** GetAnimBgAttribute (battle_intro.c) */
export function GetAnimBgAttribute(bgId: number, attributeId: number): number {
  if (bgId >= 4) return 0;
  const f = BGCNT_FIELDS[attributeId];
  if (!f) return 0;
  return (GetGpuReg(REG_OFFSET_BG0CNT + bgId * 2) >> f[0]) & f[1];
}

/** CopyBattlerSpriteToBg (battle_intro.c): an 8x8-tile copy of the battler's current frame */
export function CopyBattlerSpriteToBg(bgId: number, x: number, y: number, battlerPosition: number, palno: number, tilesDest: Uint8Array, tilemapDest: Uint16Array, tilesOffset: number): void {
  const battler = getBattlerAtPosition(battlerPosition);
  let offset = tilesOffset;
  const src = gMonSpritesGfxPtr!.sprites[battlerPosition];
  const start = BG_SCREEN_SIZE * g.battleMonForms[battler];
  tilesDest.set(src.subarray(start, start + BG_SCREEN_SIZE));
  LoadBgTiles(bgId, tilesDest, 0x1000, tilesOffset);
  for (let i = y; i < y + 8; i++) for (let j = x; j < x + 8; j++) tilemapDest[i * 32 + j] = (offset++ | (palno << 12)) & 0xffff;
  LoadBgTilemap(bgId, tilemapDest, BG_SCREEN_SIZE, 0);
}
