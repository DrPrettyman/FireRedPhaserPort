// battle_anim_ghost.c: sprite callbacks and tasks (every one in the file).

import { CopyBgTilemapBufferToVram, CopyToBgTilemapBufferRect_ChangePalette } from '../../gba/bg';
import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_EFFECT_NONE,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT2_ALL,
  ClearGpuRegBits,
  DISPCNT_BG1_ON,
  DISPCNT_BG2_ON,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../../gba/hw';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalette,
  FillPalette,
  gPaletteFade,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  LoadCompressedPalette,
  OBJ_PLTT_ID,
  PLTT_SIZE_4BPP,
} from '../../gba/palette';
import { gScanlineEffect, ScanlineEffect_InitWave } from '../../gba/scanline';
import {
  AllocSpritePalette,
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  gSprites,
  MAX_SPRITES,
  SpriteCallbackDummy,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimTranslateLinear,
  CloneBattlerSpriteWithBlend,
  DestroyAnimSpriteAndDisableBlend,
  DestroySpriteAndMatrix,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattleAnimBgData,
  GetBattlePalettesMask,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  GetBattlerSpriteSubpriority,
  GetBattlerYCoordWithElevation,
  InitAnimLinearTranslationWithSpeed,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  SetAnimBgAttribute,
  SetSpriteRotScale,
  TranslateSpriteLinearFixedPoint,
  WaitAnimForDuration,
} from './animMons';
import { PlaySE, PlaySE12WithPanning } from '../../gba/sound';
import { animSpriteTemplate } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

// ------------------------------------------------------------------ Confuse Ray

/** AnimConfuseRayBallBounce: the ball bounces over to the target, pulsing its blend. Args: x, y, speed. */
const AnimConfuseRayBallBounce: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslationWithSpeed(sprite);
  sprite.callback = AnimConfuseRayBallBounce_Step1;
  d[6] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, d[6]);
};

function AnimConfuseRayBallBounce_Step1(sprite: Sprite): void {
  const d = sprite.data;
  UpdateConfuseRayBallBlend(sprite);
  if (AnimTranslateLinear(sprite)) {
    sprite.callback = AnimConfuseRayBallBounce_Step2;
    return;
  }
  sprite.x2 += Sin(d[5], 10);
  sprite.y2 += Cos(d[5], 15);
  const r2 = d[5];
  d[5] = (d[5] + 5) & 0xff;
  const r0 = d[5];
  if (r2 !== 0 && r2 <= 196) return;
  if (r0 <= 0) return;
  PlaySE12WithPanning(K.SE_M_CONFUSE_RAY, anim.customPanning);
}

function AnimConfuseRayBallBounce_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[0] = 1;
  AnimTranslateLinear(sprite);
  sprite.x2 += Sin(d[5], 10);
  sprite.y2 += Cos(d[5], 15);
  const r2 = d[5];
  d[5] = (d[5] + 5) & 0xff;
  const r0 = d[5];
  if ((r2 === 0 || r2 > 196) && r0 > 0) PlaySE(K.SE_M_CONFUSE_RAY);
  if (d[6] === 0) {
    sprite.invisible = true;
    sprite.callback = DestroyAnimSpriteAndDisableBlend;
  } else {
    UpdateConfuseRayBallBlend(sprite);
  }
}

/** UpdateConfuseRayBallBlend: data[6] is the blend (0-16, bouncing); over 0xFF it counts down a pause */
function UpdateConfuseRayBallBlend(sprite: Sprite): void {
  const d = sprite.data;
  if (d[6] > 0xff) {
    if (++d[6] === 0x10d) d[6] = 0;
    return;
  }
  const r0 = d[7];
  ++d[7];
  if ((r0 & 0xff) === 0) {
    d[7] &= 0xff00;
    if (d[7] & 0x100) ++d[6];
    else --d[6];
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], 16 - d[6]));
    if (d[6] === 0 || d[6] === 16) d[7] ^= 0x100;
    if (d[6] === 0) d[6] = 0x100;
  }
}

/** AnimConfuseRayBallSpiral: circles the target, passing behind it. Args: x, y. */
const AnimConfuseRayBallSpiral: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.callback = AnimConfuseRayBallSpiral_Step;
  sprite.callback(sprite);
};

function AnimConfuseRayBallSpiral_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], 32);
  sprite.y2 = Cos(d[0], 8);
  const temp1 = (d[0] - 65) & 0xffff;
  sprite.oam.priority = temp1 <= 130 ? 2 : 1;
  d[0] = (d[0] + 19) & 0xff;
  d[2] += 80;
  sprite.y2 += d[2] >> 8;
  d[7] += 1;
  if (d[7] === 61) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ Night Shade

/** AnimTask_NightShadeClone: a big blended attacker that shrinks back to size. Arg 0: delay before shrinking. */
const AnimTask_NightShadeClone: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_BLEND);
  SetSpriteRotScale(spriteId, 128, 128, 0);
  gSprites[spriteId].invisible = false;
  const d = gTasks[taskId].data;
  d[0] = 128;
  d[1] = gBattleAnimArgs[0];
  d[2] = 0;
  d[3] = 16;
  gTasks[taskId].func = AnimTask_NightShadeClone_Step1;
};

const AnimTask_NightShadeClone_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[10] += 1;
  if (d[10] === 3) {
    d[10] = 0;
    d[2] += 1;
    d[3] -= 1;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
    if (d[2] !== 9) return;
    gTasks[taskId].func = AnimTask_NightShadeClone_Step2;
  }
};

const AnimTask_NightShadeClone_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[1] > 0) {
    d[1] -= 1;
    return;
  }
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[0] += 8;
  if (d[0] <= 0xff) {
    SetSpriteRotScale(spriteId, d[0], d[0], 0);
  } else {
    ResetSpriteRotScale(spriteId);
    DestroyAnimVisualTask(taskId);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  }
};

// ------------------------------------------------------------------ Shadow Ball

/**
 * AnimShadowBall: spins towards the target, pausing in the middle. Args: frames attacker -> centre,
 * frames paused, frames centre -> target. (The sprite starts at the centre: its pre-callback position.)
 */
const AnimShadowBall: SpriteCallback = (sprite) => {
  const oldPosX = sprite.x;
  const oldPosY = sprite.y;
  const d = sprite.data;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[0] = 0;
  d[1] = gBattleAnimArgs[0];
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[4] = sprite.x << 4;
  d[5] = sprite.y << 4;
  d[6] = Math.trunc(((oldPosX - sprite.x) << 4) / (gBattleAnimArgs[0] << 1));
  d[7] = Math.trunc(((oldPosY - sprite.y) << 4) / (gBattleAnimArgs[0] << 1));
  sprite.callback = AnimShadowBall_Step;
};

function AnimShadowBall_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      d[4] += d[6];
      d[5] += d[7];
      sprite.x = d[4] >> 4;
      sprite.y = d[5] >> 4;
      d[1] -= 1;
      if (d[1] > 0) break;
      d[0] += 1;
      break;
    case 1:
      d[2] -= 1;
      if (d[2] > 0) break;
      d[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
      d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
      d[4] = sprite.x << 4;
      d[5] = sprite.y << 4;
      d[6] = Math.trunc(((d[1] - sprite.x) << 4) / d[3]);
      d[7] = Math.trunc(((d[2] - sprite.y) << 4) / d[3]);
      d[0] += 1;
      break;
    case 2:
      d[4] += d[6];
      d[5] += d[7];
      sprite.x = d[4] >> 4;
      sprite.y = d[5] >> 4;
      d[3] -= 1;
      if (d[3] > 0) break;
      sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
      d[0] += 1;
      break;
    case 3:
      DestroySpriteAndMatrix(sprite);
      break;
  }
}

// ------------------------------------------------------------------ Lick

/** AnimLick: the tongue anim plays, then the sprite blinks out. Args: x, y. */
const AnimLick: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.callback = AnimLick_Step;
};

function AnimLick_Step(sprite: Sprite): void {
  const d = sprite.data;
  let toggle = false;
  let done = false;
  if (!sprite.animEnded) return;
  if (!sprite.invisible) sprite.invisible = true;
  switch (d[0]) {
    default:
      done = true;
      break;
    case 0:
      if (d[1] === 2) toggle = true;
      break;
    case 1:
      if (d[1] === 4) toggle = true;
      break;
  }
  if (toggle) {
    sprite.invisible = !sprite.invisible;
    ++d[2];
    d[1] = 0;
    if (d[2] === 5) {
      d[2] = 0;
      ++d[0];
    }
  } else if (done) {
    DestroyAnimSprite(sprite);
  } else {
    ++d[1];
  }
}

// ------------------------------------------------------------------ Nightmare

/** AnimTask_NightmareClone: a blended copy of the target drifts up and away, fading out. */
const AnimTask_NightmareClone: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[0] = CloneBattlerSpriteWithBlend(K.ANIM_TARGET);
  if (d[0] < 0) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  d[1] = 0;
  d[2] = 15;
  d[3] = 2;
  d[4] = 0;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
  const clone = gSprites[d[0]];
  clone.data[0] = 80;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    clone.data[1] = -144;
    clone.data[2] = 112;
  } else {
    clone.data[1] = 144;
    clone.data[2] = -112;
  }
  clone.data[3] = 0;
  clone.data[4] = 0;
  StoreSpriteCallbackInData6(clone, SpriteCallbackDummy);
  clone.callback = TranslateSpriteLinearFixedPoint;
  task.func = AnimTask_NightmareClone_Step;
};

const AnimTask_NightmareClone_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[4]) {
    case 0:
      d[1] += 1;
      d[5] = d[1] & 3;
      if (d[5] === 1 && d[2] > 0) d[2] -= 1;
      if (d[5] === 3 && d[3] <= 15) d[3] += 1;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
      if (d[3] !== 16 || d[2] !== 0) break;
      if (d[1] <= 80) break;
      DestroySpriteWithActiveSheet(gSprites[d[0]]);
      d[4] = 1;
      break;
    case 1:
      if (++d[6] <= 1) break;
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      d[4] += 1;
      break;
    case 2:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Spite

/**
 * AnimTask_SpiteTargetShadow: a purple-tinted copy of the target behind it, made to waver by a scanline
 * wave on the target's BG while the target's palette is blended purple and the BG faded in and out.
 */
const AnimTask_SpiteTargetShadow: TaskFunc = (taskId) => {
  gTasks[taskId].data[15] = 0;
  gTasks[taskId].func = AnimTask_SpiteTargetShadow_Step1;
  gTasks[taskId].func(taskId);
};

const AnimTask_SpiteTargetShadow_Step1: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const position = GetBattlerSpriteBGPriorityRank(anim.target);
  switch (d[15]) {
    case 0:
      d[14] = AllocSpritePalette(K.ANIM_TAG_BENT_SPOON);
      if (d[14] === 0xff || d[14] === 0xf) {
        DestroyAnimVisualTask(taskId);
      } else {
        d[0] = CloneBattlerSpriteWithBlend(K.ANIM_TARGET);
        if (d[0] < 0) {
          FreeSpritePaletteByTag(K.ANIM_TAG_BENT_SPOON);
          DestroyAnimVisualTask(taskId);
        } else {
          const clone = gSprites[d[0]];
          clone.oam.paletteNum = d[14];
          clone.oam.objMode = ST_OAM_OBJ_NORMAL;
          clone.oam.priority = 3;
          clone.invisible = !!g.battleSpritesDataPtr.battlerData[anim.target].invisible;
          d[1] = 0;
          d[2] = 0;
          d[3] = 16;
          d[13] = GetAnimBattlerSpriteId(K.ANIM_TARGET);
          d[4] = OBJ_PLTT_ID(gSprites[d[13]].oam.paletteNum);
          ClearGpuRegBits(REG_OFFSET_DISPCNT, position === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
          ++d[15];
        }
      }
      break;
    case 1:
      d[14] = OBJ_PLTT_ID(d[14]);
      gPlttBufferFaded.set(gPlttBufferUnfaded.subarray(d[4], d[4] + 16), d[14]);
      BlendPalette(d[4], 16, 10, RGB(13, 0, 15));
      ++d[15];
      break;
    case 2: {
      let startLine = gSprites[d[13]].y + gSprites[d[13]].y2 - 32;
      if (startLine < 0) startLine = 0;
      d[10] = ScanlineEffect_InitWave(startLine, startLine + 64, 2, 6, 0, position === 1 ? 4 : 8, true);
      ++d[15];
      break;
    }
    case 3:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL | (position === 1 ? BLDCNT_TGT1_BG1 : BLDCNT_TGT1_BG2));
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
      ++d[15];
      break;
    case 4:
      SetGpuRegBits(REG_OFFSET_DISPCNT, position === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
      task.func = AnimTask_SpiteTargetShadow_Step2;
      ++d[15];
      break;
    default:
      ++d[15];
      break;
  }
};

const AnimTask_SpiteTargetShadow_Step2: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  ++d[1];
  d[5] = d[1] & 1;
  if (d[5] === 0) d[2] = Math.trunc(gSineTable(d[1]) / 18);
  if (d[5] === 1) d[3] = 16 - Math.trunc(gSineTable(d[1]) / 18);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
  if (d[1] === 128) {
    d[15] = 0;
    task.func = AnimTask_SpiteTargetShadow_Step3;
    task.func(taskId);
  }
};

const AnimTask_SpiteTargetShadow_Step3: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const rank = GetBattlerSpriteBGPriorityRank(anim.target);
  switch (d[15]) {
    case 0:
      gScanlineEffect.state = 3;
      d[14] = GetAnimBattlerSpriteId(K.ANIM_TARGET);
      ClearGpuRegBits(REG_OFFSET_DISPCNT, rank === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
      break;
    case 1:
      BlendPalette(d[4], 16, 0, RGB(13, 0, 15));
      break;
    case 2:
      gSprites[d[14]].invisible = true;
      DestroySpriteWithActiveSheet(gSprites[d[0]]);
      FreeSpritePaletteByTag(K.ANIM_TAG_BENT_SPOON);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuRegBits(REG_OFFSET_DISPCNT, rank === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
      DestroyAnimVisualTask(taskId);
      break;
  }
  ++d[15];
};

// ------------------------------------------------------------------ Destiny Bond

/**
 * AnimDestinyBondWhiteShadow: a shadow sliding from one battler's feet to the other's. Args: 0 attacker to
 * target (else the reverse), duration. (Unused by scripts: AnimTask_DestinyBondWhiteShadow makes its own.)
 */
const AnimDestinyBondWhiteShadow: SpriteCallback = (sprite) => {
  let b1X: number, b1Y: number, b2X: number, b2Y: number;
  if (gBattleAnimArgs[0] === 0) {
    b1X = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
    b1Y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 28;
    b2X = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
    b2Y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 28;
  } else {
    b1X = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
    b1Y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 28;
    b2X = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
    b2Y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 28;
  }
  const yDiff = (b2Y - b1Y) << 16 >> 16;
  const d = sprite.data;
  d[0] = b1X * 16;
  d[1] = b1Y * 16;
  d[2] = Math.trunc(((b2X - b1X) * 16) / gBattleAnimArgs[1]);
  d[3] = Math.trunc((yDiff * 16) / gBattleAnimArgs[1]);
  d[4] = gBattleAnimArgs[1];
  d[5] = b2X;
  d[6] = b2Y;
  d[7] = Math.trunc(d[4] / 2);
  sprite.oam.priority = 2;
  sprite.x = b1X;
  sprite.y = b1Y;
  sprite.callback = AnimDestinyBondWhiteShadow_Step;
  sprite.invisible = true;
};

function AnimDestinyBondWhiteShadow_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[4]) {
    d[0] += d[2];
    d[1] += d[3];
    sprite.x = d[0] >> 4;
    sprite.y = d[1] >> 4;
    if (--d[4] === 0) d[0] = 0;
  }
}

/** AnimTask_DestinyBondWhiteShadow: shadows slide from the attacker to every foe, fading in and out. Args: delay, duration. */
const AnimTask_DestinyBondWhiteShadow: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
  d[5] = 0;
  d[6] = 0;
  d[7] = 0;
  d[8] = 0;
  d[9] = 16;
  d[10] = gBattleAnimArgs[0];
  const baseX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  const baseY = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_BOTTOM);
  const template = animSpriteTemplate('gDestinyBondWhiteShadowSpriteTemplate')!;
  for (let battler = 0; battler < K.MAX_BATTLERS_COUNT; ++battler) {
    if (battler !== anim.attacker && battler !== (anim.attacker ^ 2) && IsBattlerSpriteVisible(battler)) {
      const spriteId = CreateSprite(template, baseX, baseY, 55);
      if (spriteId !== MAX_SPRITES) {
        const x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
        const y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_BOTTOM);
        const s = gSprites[spriteId].data;
        s[0] = baseX << 4;
        s[1] = baseY << 4;
        s[2] = Math.trunc(((x - baseX) << 4) / gBattleAnimArgs[1]);
        s[3] = Math.trunc(((y - baseY) << 4) / gBattleAnimArgs[1]);
        s[4] = gBattleAnimArgs[1];
        s[5] = x;
        s[6] = y;
        gSprites[spriteId].callback = AnimDestinyBondWhiteShadow_Step;
        d[d[12] + 13] = spriteId;
        ++d[12];
      }
    }
  }
  task.func = AnimTask_DestinyBondWhiteShadow_Step;
};

const AnimTask_DestinyBondWhiteShadow_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (d[6] === 0) {
        if (++d[5] > 1) {
          d[5] = 0;
          ++d[7];
          if (d[7] & 1) {
            if (d[8] < 16) ++d[8];
          } else if (d[9]) {
            --d[9];
          }
          SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[8], d[9]));
          if (d[7] >= 24) {
            d[7] = 0;
            d[6] = 1;
          }
        }
      }
      if (d[10]) --d[10];
      else if (d[6]) ++d[0];
      break;
    case 1:
      if (++d[5] > 1) {
        d[5] = 0;
        ++d[7];
        if (d[7] & 1) {
          if (d[8]) --d[8];
        } else if (d[9] < 16) {
          ++d[9];
        }
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[8], d[9]));
        if (d[8] === 0 && d[9] === 16) {
          for (let i = 0; i < d[12]; ++i) DestroySprite(gSprites[d[i + 13]]);
          ++d[0];
        }
      }
      break;
    case 2:
      if (++d[5] > 0) ++d[0];
      break;
    case 3:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Curse

const WININ_DEFAULT = WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR;

/** AnimTask_CurseStretchingBlackBg: a darkened window stretches out from a point over the field, then the BG fades to black. */
const AnimTask_CurseStretchingBlackBg: TaskFunc = (taskId) => {
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDY, 16);
  const startX = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? 40 : 200;
  g.battle_WIN0H = WIN_RANGE(startX, startX);
  const startY = 40;
  g.battle_WIN0V = WIN_RANGE(startY, startY);
  const d = gTasks[taskId].data;
  d[1] = startX; // leftDistance
  d[2] = 240 - startX; // rightDistance
  d[3] = startY; // topDistance
  d[4] = 72; // bottomDistance
  d[5] = startX;
  d[6] = startY;
  gTasks[taskId].func = AnimTask_CurseStretchingBlackBg_Step1;
};

const AnimTask_CurseStretchingBlackBg_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const step = d[0];
  ++d[0];
  const [leftDistance, rightDistance, topDistance, bottomDistance, startX, startY] = [d[1], d[2], d[3], d[4], d[5], d[6]];
  let left: number, right: number, top: number, bottom: number;
  if (step < 16) {
    left = Math.trunc(startX - leftDistance * 0.0625 * step) & 0xffff;
    right = Math.trunc(startX + rightDistance * 0.0625 * step) & 0xffff;
    top = Math.trunc(startY - topDistance * 0.0625 * step) & 0xffff;
    bottom = Math.trunc(startY + bottomDistance * 0.0625 * step) & 0xffff;
  } else {
    left = 0;
    right = 240;
    top = 0;
    bottom = 112;
    const selectedPalettes = GetBattlePalettesMask(true, false, false, false, false, false, false);
    BeginNormalPaletteFade(selectedPalettes, 0, 16, 16, RGB_BLACK);
    gTasks[taskId].func = AnimTask_CurseStretchingBlackBg_Step2;
  }
  g.battle_WIN0H = WIN_RANGE(left, right);
  g.battle_WIN0V = WIN_RANGE(top, bottom);
};

const AnimTask_CurseStretchingBlackBg_Step2: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) {
    g.battle_WIN0H = 0;
    g.battle_WIN0V = 0;
    SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDY, 0);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimCurseNail: the nail is driven into the attacker in three steps, then fades out. Args: x, y. */
const AnimCurseNail: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  let xDelta: number, xDelta2: number;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    xDelta = 24;
    xDelta2 = -2;
    sprite.oam.matrixNum = ST_OAM_HFLIP;
  } else {
    xDelta = -24;
    xDelta2 = 2;
  }
  sprite.x += xDelta;
  sprite.data[1] = xDelta2;
  sprite.data[0] = 60;
  sprite.callback = AnimCurseNail_Step1;
};

function AnimCurseNail_Step1(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    --d[0];
    return;
  }
  sprite.x2 += d[1];
  const var0 = (sprite.x2 + 7) & 0xffff;
  if (var0 > 14) {
    sprite.x += sprite.x2;
    sprite.x2 = 0;
    sprite.oam.tileNum += 8;
    if (++d[2] === 3) {
      d[0] = 30;
      sprite.callback = WaitAnimForDuration;
      StoreSpriteCallbackInData6(sprite, AnimCurseNail_Step2);
    } else {
      d[0] = 40;
    }
  }
}

function AnimCurseNail_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
    ++d[0];
    d[1] = 0;
    d[2] = 0;
  } else if (d[1] < 2) {
    ++d[1];
  } else {
    d[1] = 0;
    ++d[2];
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[2], d[2])); // BLDALPHA_BLEND2(16 - d[2], d[2])
    if (d[2] === 16) {
      sprite.invisible = true;
      sprite.callback = AnimCurseNail_End;
    }
  }
}

function AnimCurseNail_End(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  DestroyAnimSprite(sprite);
}

/** AnimGhostStatusSprite (Curse, Nightmare): rises and fades out */
const AnimGhostStatusSprite: SpriteCallback = (sprite) => {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], 12);
  if (isOpponent(anim.attacker)) sprite.x2 = -sprite.x2;
  d[0] = (d[0] + 6) & 0xff;
  d[1] += 0x100;
  sprite.y2 = -(d[1] >> 8);
  d[7]++;
  if (d[7] === 1) {
    d[6] = 0x050b;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
    SetGpuReg(REG_OFFSET_BLDALPHA, d[6]);
  } else if (d[7] > 30) {
    d[2]++;
    let coeffB = (d[6] >> 8) & 0xffff;
    let coeffA = d[6] & 0xff;
    if (++coeffB > 16) coeffB = 16;
    coeffA = (coeffA - 1) & 0xffff;
    if ((coeffA << 16) >> 16 < 0) coeffA = 0;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(coeffA, coeffB));
    d[6] = BLDALPHA_BLEND(coeffA, coeffB);
    if (coeffB === 16 && coeffA === 0) {
      sprite.invisible = true;
      sprite.callback = AnimGhostStatusSprite_End;
    }
  }
};

function AnimGhostStatusSprite_End(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ Grudge

/** AnimTask_GrudgeFlames: six purple flames circle the attacker, blended in and out. */
const AnimTask_GrudgeFlames: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = 16;
  d[9] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[10] = GetBattlerYCoordWithElevation(anim.attacker);
  d[11] = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_WIDTH) / 2) + 8;
  d[7] = 0;
  d[5] = GetBattlerSpriteBGPriority(anim.attacker);
  d[6] = GetBattlerSpriteSubpriority(anim.attacker) - 2;
  d[3] = 0;
  d[4] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
  d[8] = 0;
  gTasks[taskId].func = AnimTask_GrudgeFlames_Step;
};

const AnimTask_GrudgeFlames_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      const template = animSpriteTemplate('gGrudgeFlameSpriteTemplate')!;
      for (let i = 0; i < 6; ++i) {
        const spriteId = CreateSprite(template, d[9], d[10], d[6] & 0xff);
        if (spriteId !== MAX_SPRITES) {
          const s = gSprites[spriteId].data;
          s[0] = taskId;
          s[1] = +(getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER);
          s[2] = (i * 42) & 0xff;
          s[3] = d[11];
          s[5] = i * 6;
          ++d[7];
        }
      }
      ++d[0];
      break;
    }
    case 1:
      if (++d[1] & 1) {
        if (d[3] < 14) ++d[3];
      } else if (d[4] > 4) {
        --d[4];
      }
      if (d[3] === 14 && d[4] === 4) {
        d[1] = 0;
        ++d[0];
      }
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
      break;
    case 2:
      if (++d[1] > 30) {
        d[1] = 0;
        ++d[0];
      }
      break;
    case 3:
      if (++d[1] & 1) {
        if (d[3] > 0) --d[3];
      } else if (d[4] < 16) {
        ++d[4];
      }
      if (d[3] === 0 && d[4] === 16) {
        d[8] = 1;
        ++d[0];
      }
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
      break;
    case 4:
      if (d[7] === 0) ++d[0];
      break;
    case 5:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimGrudgeFlame (gGrudgeFlameSpriteTemplate, made by AnimTask_GrudgeFlames): circles, behind the mon on the far side */
const AnimGrudgeFlame: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[1] === 0) d[2] += 2;
  else d[2] -= 2;
  d[2] &= 0xff;
  sprite.x2 = Sin(d[2], d[3]);
  const index = (d[2] - 65) & 0xffff;
  const task = gTasks[d[0]].data;
  sprite.oam.priority = index < 127 ? task[5] + 1 : task[5];
  ++d[5];
  d[6] = (d[5] * 8) & 0xff;
  sprite.y2 = Sin(d[6], 7);
  if (task[8]) {
    --task[7];
    DestroySprite(sprite);
  }
};

// ------------------------------------------------------------------ the ghost Marowak

/**
 * AnimTask_GhostGetOut (General_GhostGetOut, the ghost Marowak before the Silph Scope): a shimmering,
 * blue-tinted copy of the attacker with the Scary Face BG behind it.
 */
const AnimTask_GhostGetOut: TaskFunc = (taskId) => {
  gTasks[taskId].data[15] = 0;
  gTasks[taskId].func = AnimTask_GhostGetOut_Step1;
  gTasks[taskId].func(taskId);
};

const AnimTask_GhostGetOut_Step1: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const rank = GetBattlerSpriteBGPriorityRank(anim.attacker);
  switch (d[15]) {
    case 0:
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 2);
      SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 1);
      d[1] = 0;
      d[2] = 0;
      d[3] = 16;
      d[4] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      d[5] = gSprites[d[4]].oam.priority;
      d[6] = OBJ_PLTT_ID(gSprites[d[4]].oam.paletteNum);
      gSprites[d[4]].oam.objMode = ST_OAM_OBJ_BLEND;
      gSprites[d[4]].oam.priority = 3;
      d[7] = BG_PLTT_ID(8);
      break;
    case 1:
      ++d[1];
      if (d[1] & 1) return;
      BlendPalette(d[6], 0x10, d[2], RGB(0, 23, 25));
      BlendPalette(d[7], 0x10, d[2], RGB(0, 23, 25));
      if (d[2] <= 11) {
        ++d[2];
        return;
      }
      d[1] = 0;
      d[2] = 0;
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
      break;
    case 2: {
      SetAnimBgAttribute(2, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
      SetAnimBgAttribute(2, K.BG_ANIM_SCREEN_SIZE, 0);
      g.battle_BG2_X = 0;
      g.battle_BG2_Y = 0;
      SetGpuReg(REG_OFFSET_BG2HOFS, g.battle_BG2_X);
      SetGpuReg(REG_OFFSET_BG2VOFS, g.battle_BG2_Y);
      const animBgData = GetBattleAnimBgData(2);
      AnimLoadCompressedBgGfx(animBgData.bgId, 'gBattleAnim_ScaryFaceGfx', animBgData.tilesOffset);
      LoadCompressedPalette(gfx16('gBattleAnim_ScaryFacePal'), BG_PLTT_ID(animBgData.paletteId), PLTT_SIZE_4BPP);
      break;
    }
    case 3: {
      const animBgData = GetBattleAnimBgData(2);
      // gMonSpritesGfxPtr->multiUseBuffer
      const buffer = new Uint16Array(0x1000);
      const tilemap = gfx16('gBattleAnimBgTilemap_ScaryFacePlayer');
      buffer.set(tilemap.subarray(0, Math.min(tilemap.length, buffer.length)));
      RelocateBattleBgPal(animBgData.paletteId, buffer, 256, false);
      CopyToBgTilemapBufferRect_ChangePalette(animBgData.bgId, buffer, 0, 0, 0x20, 0x20, 0x11);
      CopyBgTilemapBufferToVram(2);
      break;
    }
    case 4:
      ++d[1];
      if (d[1] & 1) return;
      ++d[2];
      --d[3];
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
      if (d[3]) return;
      d[1] = 0;
      d[2] = 0;
      d[3] = 16;
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
      SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 2);
      break;
    case 5:
      ClearGpuRegBits(REG_OFFSET_DISPCNT, rank === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
      break;
    case 6: {
      let y = gSprites[d[4]].y + gSprites[d[4]].y2 - 0x20;
      if (y < 0) y = 0;
      d[10] = ScanlineEffect_InitWave(y, y + 0x40, 4, 8, 0, rank === 1 ? 4 : 8, true);
      break;
    }
    case 7:
      BlendPalette(d[7], 0x10, 0xc, RGB(31, 31, 29));
      SetGpuRegBits(REG_OFFSET_DISPCNT, rank === 1 ? DISPCNT_BG1_ON : DISPCNT_BG2_ON);
      task.func = AnimTask_GhostGetOut_Step2;
      d[15] = 0;
      break;
  }
  ++d[15];
};

const AnimTask_GhostGetOut_Step2: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  ++d[1];
  d[8] = d[1] & 1;
  if (!d[8]) d[2] = Math.trunc(gSineTable(d[1]) / 18);
  if (d[8] === 1) d[3] = 16 - Math.trunc(gSineTable(d[1]) / 18);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
  if (d[1] === 128) {
    d[15] = 0;
    task.func = AnimTask_GhostGetOut_Step3;
    task.func(taskId);
  }
};

const AnimTask_GhostGetOut_Step3: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[15]) {
    case 0:
      gScanlineEffect.state = 3;
      BlendPalette(d[7], 0x10, 0xc, RGB(0, 23, 25));
      break;
    case 1:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0x10, 0));
      d[2] = 16;
      d[3] = 0;
      break;
    case 2:
      --d[2];
      ++d[3];
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[2], d[3]));
      if (d[3] <= 15) return;
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 2);
      SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 2);
      break;
    case 3:
      InitBattleAnimBg(2);
      FillPalette(RGB_BLACK, BG_PLTT_ID(9), PLTT_SIZE_4BPP);
      SetAnimBgAttribute(2, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
      d[1] = 12;
      break;
    case 4:
      BlendPalette(d[6], 0x10, d[1], RGB(0, 23, 25));
      BlendPalette(d[7], 0x10, d[1], RGB(0, 23, 25));
      if (d[1]) {
        --d[1];
        return;
      }
      d[1] = 0;
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0x10));
      break;
    case 5:
      gSprites[d[4]].oam.priority = d[5];
      gSprites[d[4]].oam.objMode = ST_OAM_OBJ_NORMAL;
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
      SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 1);
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_NONE);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
      break;
  }
  ++d[15];
};

/**
 * RelocateBattleBgPal (battle_anim.c): points a 32x32 (or 32x64) tilemap at BG palette `paletteNum`,
 * offsetting its tile numbers. Kept local: only this file uses it on a buffer of its own.
 */
function RelocateBattleBgPal(paletteNum: number, dest: Uint16Array, offset: number, largeScreen: boolean): void {
  const size = largeScreen ? 64 : 32;
  const pal = (paletteNum << 12) & 0xffff;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < 32; j++) dest[j + i * 32] = (((dest[j + i * 32] & 0xfff) | pal) + offset) & 0xffff;
  }
}

// ------------------------------------------------------------------ unused

/** AnimMonMoveCircular (sMonMoveCircularSpriteTemplate, unused): circles the attacker's sprite. Args: speed, duration. */
const AnimMonMoveCircular: SpriteCallback = (sprite) => {
  const d = sprite.data;
  sprite.invisible = true;
  d[5] = g.battlerSpriteIds[anim.attacker];
  d[0] = 128;
  d[1] = 10;
  d[2] = gBattleAnimArgs[0];
  d[3] = gBattleAnimArgs[1];
  sprite.callback = AnimMonMoveCircular_Step;
  gSprites[d[5]].y += 8;
};

function AnimMonMoveCircular_Step(sprite: Sprite): void {
  const d = sprite.data;
  const mon = gSprites[d[5]];
  if (d[3]) {
    --d[3];
    mon.x2 = Sin(d[0], d[1]);
    mon.y2 = Cos(d[0], d[1]);
    d[0] += d[2];
    if (d[0] > 255) d[0] -= 256;
  } else {
    mon.x2 = 0;
    mon.y2 = 0;
    mon.y -= 8;
    sprite.callback = DestroySpriteAndMatrix;
  }
}

export const ghostSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimConfuseRayBallBounce,
  AnimConfuseRayBallSpiral,
  AnimShadowBall,
  AnimLick,
  AnimDestinyBondWhiteShadow,
  AnimCurseNail,
  AnimGhostStatusSprite,
  AnimGrudgeFlame,
  AnimMonMoveCircular,
};

export const ghostTasks: Record<string, TaskFunc> = {
  AnimTask_NightShadeClone,
  AnimTask_NightmareClone,
  AnimTask_SpiteTargetShadow,
  AnimTask_DestinyBondWhiteShadow,
  AnimTask_CurseStretchingBlackBg,
  AnimTask_GrudgeFlames,
  AnimTask_GhostGetOut,
};

export function registerGhostExtraGfx(): void {
  registerAnimExtraGfx({ AnimTask_GhostGetOut: ['gBattleAnim_ScaryFaceGfx', 'gBattleAnim_ScaryFacePal', 'gBattleAnimBgTilemap_ScaryFacePlayer'] });
}
