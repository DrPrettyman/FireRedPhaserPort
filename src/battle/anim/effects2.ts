// battle_anim_effects_2.c: sprite callbacks and tasks (the whole file). Contest-only branches are left out
// (IsContest() is always FALSE in FRLG). AnimWaterPulseRing, also defined in this C file, lives in water.ts
// (Water Pulse needed it first).

import {
  AllocOamMatrix,
  AllocSpritePalette,
  CalcCenterToCornerVec,
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  MAX_SPRITES,
  SeekSpriteAnim,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_VFLIP,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type AffineAnimCmd,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT2_ALL,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_WHITE,
  SetGpuReg,
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
import { gfx16 } from '../../gba/gfx';
import { BG_PLTT_ID, BlendPalette, BlendPalettes, gPlttBufferFaded, LoadCompressedPalette, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import { random } from '../../util/random';
import { K } from '../constants';
import { bdata, g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimSpriteOnMonPos,
  AnimTranslateLinear,
  ArcTan2Neg,
  BATTLE_PARTNER,
  CloneBattlerSpriteWithBlend,
  DestroySpriteAndMatrix,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlePalettesMask,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  GetBattlerSpriteSubpriority,
  GetBattlerYCoordWithElevation,
  InitAnimLinearTranslation,
  InitAnimLinearTranslationWithSpeedAndPos,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  PrepareAffineAnimInTaskData,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunAffineAnimFromTaskData,
  RunStoredCallbackWhenAffineAnimEnds,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetAnimSpriteInitialXOffset,
  SetAverageBattlerPositions,
  SetBattlerSpriteYOffsetFromRotation,
  SetBattlerSpriteYOffsetFromYScale,
  SetGreyscaleOrOriginalPalette,
  SetSpriteCoordsToAnimAttackerCoords,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  SetSpriteRotScale,
  StartAnimLinearTranslation,
  TranslateSpriteInCircle,
  TranslateSpriteInEllipse,
  TranslateSpriteLinearFixedPoint,
  TrySetSpriteRotScale,
  WaitAnimForDuration,
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
} from './animMons';
import { animSpriteTemplate, BattleAnimAdjustPanning, PlaySE12WithPanning } from './battleAnim';
import * as effects1 from './effects1';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const UNIT = 'battle_anim_effects_2.c';
/** A static `union AffineAnimCmd[]` of this file (extracted to anims.json) */
const affineAnim = (name: string) => bdata.anims.units[UNIT].affineAnims[name] as AffineAnimCmd[];
const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;
const s16 = (v: number) => (v << 16) >> 16;

/** Q_8_8_mul (math_util.c) */
const Q_8_8_mul = (x: number, y: number) => s16(Math.trunc((s16(x) * s16(y)) / 256));
/** Q_8_8_inv (math_util.c) */
const Q_8_8_inv = (y: number) => s16(Math.trunc(0x10000 / s16(y)));

/**
 * SetSpriteNextToMonHead is defined in battle_anim_effects_1.c (effects1.ts). Looked up at call time, so this
 * file builds whether or not effects1.ts exports it yet; only the unused sBouncingMusicNoteSpriteTemplate needs it.
 */
function SetSpriteNextToMonHead(battler: number, sprite: Sprite): void {
  (effects1 as unknown as Record<string, (battler: number, sprite: Sprite) => void>).SetSpriteNextToMonHead(battler, sprite);
}

// ------------------------------------------------------------------ unused templates' callbacks

/** AnimCirclingFinger (sCirclingFingerSpriteTemplate, unused). Args: x, y, x amplitude, y amplitude, speed, steps. */
const AnimCirclingFinger: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.data[4] = gBattleAnimArgs[3];
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
};

/** AnimBouncingMusicNote (sBouncingMusicNoteSpriteTemplate, unused). Arg 0: battler (0 attacker). */
const AnimBouncingMusicNote: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  SetSpriteNextToMonHead(battler, sprite);
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.callback = AnimBouncingMusicNote_Step;
};

function AnimBouncingMusicNote_Step(sprite: Sprite): void {
  switch (sprite.data[0]) {
    case 0:
      sprite.y2 -= 3;
      if (++sprite.data[1] === 6) sprite.data[0]++;
      break;
    case 1:
      sprite.y2 += 3;
      if (--sprite.data[1] === 0) sprite.data[0]++;
      break;
    case 2:
      if (++sprite.data[1] === 64) DestroyAnimSprite(sprite);
      break;
  }
}

function AnimVibrateBattlerBack_Step(sprite: Sprite): void {
  gSprites[sprite.data[2]].x2 += sprite.data[1];
  sprite.data[1] = -sprite.data[1];
  if (sprite.data[0] === 0) {
    gSprites[sprite.data[2]].x2 = 0;
    DestroySpriteAndMatrix(sprite);
  }
  sprite.data[0]--;
}

/** AnimVibrateBattlerBack (sVibrateBattlerBackSpriteTemplate, unused): shakes the target. Args: x, y, duration, amplitude. */
const AnimVibrateBattlerBack: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const spriteId = g.battlerSpriteIds[anim.target];
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = spriteId;
  sprite.callback = AnimVibrateBattlerBack_Step;
  sprite.invisible = true;
};

/** AnimMovingClamp (sMovingClampSpriteTemplate, unused). Args: x, y, delay, duration, end delay. */
const AnimMovingClamp: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[4];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimMovingClamp_Step);
};

function AnimMovingClamp_Step(sprite: Sprite): void {
  sprite.data[0] = sprite.data[1];
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y + 15;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, AnimMovingClamp_End);
}

function AnimMovingClamp_End(sprite: Sprite): void {
  if (sprite.data[5] === 0) DestroyAnimSprite(sprite);
  else sprite.data[5]--;
}

// ------------------------------------------------------------------ Withdraw, Kinesis, Swords Dance, Sonic Boom

/** AnimTask_Withdraw: rotates the attacker down and back up. */
const AnimTask_Withdraw: TaskFunc = (taskId) => {
  PrepareBattlerSpriteForRotScale(g.battlerSpriteIds[anim.attacker], ST_OAM_OBJ_NORMAL);
  gTasks[taskId].func = AnimTask_Withdraw_Step;
};

const AnimTask_Withdraw_Step: TaskFunc = (taskId) => {
  const spriteId = g.battlerSpriteIds[anim.attacker];
  const d = gTasks[taskId].data;
  const rotation = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? -d[0] : d[0];
  SetSpriteRotScale(spriteId, 0x100, 0x100, s16(rotation));
  if (d[1] === 0) {
    d[0] += 0xb0;
    // this y position update gets overwritten by SetBattlerSpriteYOffsetFromRotation()
    gSprites[spriteId].y2++;
  } else if (d[1] === 1) {
    if (++d[3] === 30) d[1] = 2;
    return;
  } else {
    d[0] -= 0xb0;
    gSprites[spriteId].y2--;
  }
  SetBattlerSpriteYOffsetFromRotation(spriteId);
  if (d[0] === 0xf20 || d[0] === 0) {
    if (d[1] === 2) {
      ResetSpriteRotScale(spriteId);
      DestroyAnimVisualTask(taskId);
    } else {
      d[1]++;
    }
  }
};

/** AnimKinesisZapEnergy (Kinesis). Args: x, y, vertical flip. */
const AnimKinesisZapEnergy: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  if (isOpponent(anim.attacker)) sprite.hFlip = true;
  if (gBattleAnimArgs[2]) sprite.vFlip = true;
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSwordsDanceBlade: a sword that rises after its affine anim. Args: x, y. */
const AnimSwordsDanceBlade: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimSwordsDanceBlade_Step);
};

function AnimSwordsDanceBlade_Step(sprite: Sprite): void {
  sprite.data[0] = 6;
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y - 32;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimSonicBoomProjectile: a projectile to the target, rotated to point along its path. Args: x, y, target x, target y, duration. */
const AnimSonicBoomProjectile: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  InitSpritePosToAnimAttacker(sprite, true);
  const targetXPos = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2]);
  const targetYPos = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3]);
  const rotation = (ArcTan2Neg(targetXPos - sprite.x, targetYPos - sprite.y) + 0xf000) & 0xffff;
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rotation);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = targetXPos;
  sprite.data[4] = targetYPos;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// ------------------------------------------------------------------ Air Cutter

/** The x2/y2 of an air wave: data[1..2] in 1/256 px, task data[7..8] bit 0 negates. */
function airWaveOffsets(sprite: Sprite, task: Task): void {
  const x = (sprite.data[1] & 0xffff) >> 8;
  const y = (sprite.data[2] & 0xffff) >> 8;
  sprite.x2 = task.data[7] & 1 ? -x : x;
  sprite.y2 = task.data[8] & 1 ? -y : y;
}

function AnimAirWaveProjectile_Step2(sprite: Sprite): void {
  if (sprite.data[0]-- <= 0) {
    gTasks[sprite.data[7]].data[1]--;
    DestroySprite(sprite);
  }
}

function AnimAirWaveProjectile_Step1(sprite: Sprite): void {
  const task = gTasks[sprite.data[7]];
  const d = sprite.data;
  if (d[0] > task.data[5]) {
    d[5] += d[3];
    d[6] += d[4];
  } else {
    d[5] -= d[3];
    d[6] -= d[4];
  }
  d[1] += d[5];
  d[2] += d[6];
  airWaveOffsets(sprite, task);
  if (d[0]-- <= 0) {
    d[0] = 30;
    sprite.callback = AnimAirWaveProjectile_Step2;
  }
}

/** AnimAirWaveProjectile (gAirWaveProjectileSpriteTemplate, made by AnimTask_AirCutterProjectile): data[7] is the task. */
const AnimAirWaveProjectile: SpriteCallback = (sprite) => {
  const task = gTasks[sprite.data[7]];
  const d = sprite.data;
  d[1] += -2 & task.data[7];
  d[2] += -2 & task.data[8];
  airWaveOffsets(sprite, task);
  if (d[0]-- <= 0) {
    d[0] = 8;
    task.data[5] = 4;
    const a = Q_8_8_inv(0x1000);
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    const b = s16((task.data[11] >= sprite.x ? task.data[11] - sprite.x : sprite.x - task.data[11]) << 8);
    const c = s16((task.data[12] >= sprite.y ? task.data[12] - sprite.y : sprite.y - task.data[12]) << 8);
    d[2] = 0;
    d[1] = 0;
    d[6] = 0;
    d[5] = 0;
    d[3] = Q_8_8_mul(Q_8_8_mul(b, a), Q_8_8_inv(0x1c0));
    d[4] = Q_8_8_mul(Q_8_8_mul(c, a), Q_8_8_inv(0x1c0));
    sprite.callback = AnimAirWaveProjectile_Step1;
  }
};

const AirCutterProjectile_Step2: TaskFunc = (taskId) => {
  if (gTasks[taskId].data[1] === 0) DestroyAnimVisualTask(taskId);
};

const AirCutterProjectile_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0]-- <= 0) {
    const spriteId = CreateSprite(animSpriteTemplate('gAirWaveProjectileSpriteTemplate')!, d[9], d[10], (d[2] - d[1]) & 0xff);
    const sprite = gSprites[spriteId];
    switch (d[4]) {
      case 1:
        sprite.oam.matrixNum |= ST_OAM_HFLIP | ST_OAM_VFLIP;
        break;
      case 2:
        sprite.oam.matrixNum = ST_OAM_HFLIP;
        break;
    }
    sprite.data[0] = d[5] - d[6];
    sprite.data[7] = taskId;
    d[d[1] + 13] = spriteId;
    d[0] = d[3];
    d[1]++;
    PlaySE12WithPanning(K.SE_M_BLIZZARD2, BattleAnimAdjustPanning(-K.SOUND_PAN_TARGET));
    if (d[1] > 2) gTasks[taskId].func = AirCutterProjectile_Step2;
  }
};

/**
 * AnimTask_AirCutterProjectile: three air waves that curve from the attacker to the target. Args: target x,
 * target y, speed (bit 0: curve direction), delay between waves, subpriority offset (bit 7 ignored).
 */
const AnimTask_AirCutterProjectile: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    d[4] = 1;
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[2] & 1) gBattleAnimArgs[2] &= ~1;
    else gBattleAnimArgs[2] |= 1;
  }
  const attackerX = (d[9] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X));
  const attackerY = (d[10] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y));
  let targetX: number;
  let targetY: number;
  if (IsDoubleBattle() && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.target))) {
    ({ x: targetX, y: targetY } = SetAverageBattlerPositions(anim.target, false));
  } else {
    targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
    targetY = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  }
  targetX = d[11] = targetX + gBattleAnimArgs[0];
  targetY = d[12] = targetY + gBattleAnimArgs[1];
  const xDiff = targetX >= attackerX ? targetX - attackerX : attackerX - targetX;
  d[5] = Q_8_8_mul(xDiff, Q_8_8_inv(gBattleAnimArgs[2] & ~1));
  d[6] = Q_8_8_mul(d[5], 0x80);
  d[7] = gBattleAnimArgs[2];
  if (targetY >= attackerY) d[8] = Q_8_8_mul(targetY - attackerY, Q_8_8_inv(d[5])) & ~1;
  else d[8] = Q_8_8_mul(attackerY - targetY, Q_8_8_inv(d[5])) | 1;
  d[3] = gBattleAnimArgs[3];
  if (gBattleAnimArgs[4] & 0x80) gBattleAnimArgs[4] ^= 0x80;
  if (gBattleAnimArgs[4] >= 64) d[2] = GetBattlerSpriteSubpriority(anim.target) + (gBattleAnimArgs[4] - 64);
  else d[2] = GetBattlerSpriteSubpriority(anim.target) - gBattleAnimArgs[4];
  if (d[2] < 3) d[2] = 3;
  gTasks[taskId].func = AirCutterProjectile_Step1;
};

// ------------------------------------------------------------------ void lines, Pay Day, Bullet Seed, Razor Wind

/** AnimVoidLines (sVoidLinesSpriteTemplate, unused): rotates colours 8-15 of its palette for 48 frames. */
const AnimVoidLines: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  sprite.data[0] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(bdata.animScripts.templates.sVoidLinesSpriteTemplate.paletteTag));
  sprite.callback = AnimVoidLines_Step;
};

function AnimVoidLines_Step(sprite: Sprite): void {
  if (++sprite.data[1] === 2) {
    sprite.data[1] = 0;
    const id = sprite.data[0] & 0xffff;
    const val = gPlttBufferFaded[8 + id];
    for (let i = 8; i < 16; i++) gPlttBufferFaded[i + id] = gPlttBufferFaded[i + id + 1];
    gPlttBufferFaded[id + 15] = val;
    if (++sprite.data[2] === 24) DestroyAnimSprite(sprite);
  }
}

/** AnimCoinThrow (Pay Day): a coin to the target, rotated along its path. Args: x, y, target x, target y, speed. */
const AnimCoinThrow: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  let r6 = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  const r7 = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3]);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  r6 = s16(r6 + gBattleAnimArgs[2]);
  const rotation = (ArcTan2Neg(r6 - sprite.x, r7 - sprite.y) + 0xc000) & 0xffff;
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rotation);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = r6;
  sprite.data[4] = r7;
  sprite.callback = InitAnimLinearTranslationWithSpeedAndPos;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimFallingCoin (Pay Day): bounces twice away from the attacker. */
const AnimFallingCoin: SpriteCallback = (sprite) => {
  sprite.data[2] = -16;
  sprite.y += 8;
  sprite.callback = AnimFallingCoin_Step;
};

function AnimFallingCoin_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += 0x80;
  sprite.x2 = d[0] >> 8;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) sprite.x2 = -sprite.x2;
  sprite.y2 = Sin(d[1], d[2]);
  d[1] += 5;
  if (d[1] > 126) {
    d[1] = 0;
    d[2] = Math.trunc(d[2] / 2);
    if (++d[3] === 2) DestroyAnimSprite(sprite);
  }
}

/** AnimBulletSeed: a seed to the target that bounces off. Args: x, y. */
const AnimBulletSeed: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = 20;
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  sprite.affineAnimPaused = true;
  StoreSpriteCallbackInData6(sprite, AnimBulletSeed_Step1);
};

function AnimBulletSeed_Step1(sprite: Sprite): void {
  PlaySE12WithPanning(K.SE_M_HORN_ATTACK, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  // data[0..7] = 0 (the stored callback lives outside data here)
  for (let i = 0; i < 8; i++) sprite.data[i] = 0;
  let rand = random();
  sprite.data[6] = 0xfff4 - (rand & 7);
  rand = random();
  sprite.data[7] = (rand % 0xa0) + 0xa0;
  sprite.callback = AnimBulletSeed_Step2;
  sprite.affineAnimPaused = false;
}

function AnimBulletSeed_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += d[7];
  sprite.x2 = d[0] >> 8;
  if (d[7] & 1) sprite.x2 = -sprite.x2;
  sprite.y2 = Sin(d[1], d[6]);
  d[1] += 8;
  if (d[1] > 126) {
    d[1] = 0;
    d[2] = Math.trunc(d[2] / 2);
    if (++d[3] === 1) DestroyAnimSprite(sprite);
  }
}

/** AnimRazorWindTornado: a tornado circling. Args: x, y, amplitude, -, wave offset, wave speed, duration. */
const AnimRazorWindTornado: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) sprite.y += 16;
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[5];
  sprite.data[3] = gBattleAnimArgs[6];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.callback = TranslateSpriteInCircle;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback(sprite);
};

// ------------------------------------------------------------------ Vice Grip, Guillotine

/** AnimViceGripPincer: one pincer closing on the target. Arg 0: the lower pincer. */
const AnimViceGripPincer: SpriteCallback = (sprite) => {
  let startXOffset = 32;
  let startYOffset = -32;
  let endXOffset = 16;
  let endYOffset = -16;
  if (gBattleAnimArgs[0]) {
    startXOffset = -32;
    startYOffset = 32;
    endXOffset = -16;
    endYOffset = 16;
    StartSpriteAnim(sprite, 1);
  }
  sprite.x += startXOffset;
  sprite.y += startYOffset;
  sprite.data[0] = 6;
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + endXOffset;
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + endYOffset;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, AnimViceGripPincer_Step);
};

function AnimViceGripPincer_Step(sprite: Sprite): void {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimGuillotinePincer: one pincer closing on the target, shaking, then opening. Arg 0: anim (the lower pincer). */
const AnimGuillotinePincer: SpriteCallback = (sprite) => {
  let startXOffset = 32;
  let startYOffset = -32;
  let endXOffset = 16;
  let endYOffset = -16;
  if (gBattleAnimArgs[0]) {
    startXOffset = -32;
    startYOffset = 32;
    endXOffset = -16;
    endYOffset = 16;
    StartSpriteAnim(sprite, gBattleAnimArgs[0]);
  }
  sprite.x += startXOffset;
  sprite.y += startYOffset;
  const d = sprite.data;
  d[0] = 6;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + endXOffset;
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + endYOffset;
  InitAnimLinearTranslation(sprite);
  d[5] = gBattleAnimArgs[0];
  d[6] = d[0];
  sprite.callback = AnimGuillotinePincer_Step1;
};

function AnimGuillotinePincer_Step1(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite) && sprite.animEnded) {
    SeekSpriteAnim(sprite, 0);
    sprite.animPaused = true;
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.x2 = 2;
    sprite.y2 = -2;
    const d = sprite.data;
    d[0] = d[6];
    d[1] ^= 1;
    d[2] ^= 1;
    d[4] = 0;
    d[3] = 0;
    sprite.callback = AnimGuillotinePincer_Step2;
  }
}

function AnimGuillotinePincer_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3]) {
    sprite.x2 = -sprite.x2;
    sprite.y2 = -sprite.y2;
  }
  d[3] ^= 1;
  if (++d[4] === 51) {
    sprite.y2 = 0;
    sprite.x2 = 0;
    d[4] = 0;
    d[3] = 0;
    sprite.animPaused = false;
    StartSpriteAnim(sprite, d[5] ^ 1);
    sprite.callback = AnimGuillotinePincer_Step3;
  }
}

function AnimGuillotinePincer_Step3(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ Disable, Minimize, Splash, Swagger

/** AnimTask_GrowAndGrayscale (Disable): the target grows and turns grey for 80 frames. */
const AnimTask_GrowAndGrayscale: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_BLEND);
  SetSpriteRotScale(spriteId, 0xd0, 0xd0, 0);
  SetGreyscaleOrOriginalPalette(gSprites[spriteId].oam.paletteNum + 16, false);
  gTasks[taskId].data[0] = 80;
  gTasks[taskId].func = AnimTask_GrowAndGrayscale_Step;
};

const AnimTask_GrowAndGrayscale_Step: TaskFunc = (taskId) => {
  if (--gTasks[taskId].data[0] === -1) {
    const spriteId = GetAnimBattlerSpriteId(K.ANIM_TARGET);
    ResetSpriteRotScale(spriteId);
    SetGreyscaleOrOriginalPalette(gSprites[spriteId].oam.paletteNum + 16, true);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_Minimize: the attacker shrinks three times, leaving blended copies, then grows back. */
const AnimTask_Minimize: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[0] = spriteId;
  PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_NORMAL);
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[4] = 0x100;
  d[5] = 0;
  d[6] = 0;
  d[7] = GetBattlerSpriteSubpriority(anim.attacker);
  gTasks[taskId].func = AnimTask_Minimize_Step1;
};

const AnimTask_Minimize_Step1: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[1]) {
    case 0:
      if (d[2] === 0 || d[2] === 3 || d[2] === 6) CreateMinimizeSprite(task, taskId);
      d[2]++;
      d[4] += 0x28;
      SetSpriteRotScale(d[0], d[4], d[4], 0);
      SetBattlerSpriteYOffsetFromYScale(d[0]);
      if (d[2] === 32) {
        d[5]++;
        d[1]++;
      }
      break;
    case 1:
      if (d[6] === 0) {
        if (d[5] === 3) {
          d[2] = 0;
          d[1] = 3;
        } else {
          d[2] = 0;
          d[3] = 0;
          d[4] = 0x100;
          SetSpriteRotScale(d[0], d[4], d[4], 0);
          SetBattlerSpriteYOffsetFromYScale(d[0]);
          d[1] = 2;
        }
      }
      break;
    case 2:
      d[1] = 0;
      break;
    case 3:
      if (++d[2] > 32) {
        d[2] = 0;
        d[1]++;
      }
      break;
    case 4:
      d[2] += 2;
      d[4] -= 0x50;
      SetSpriteRotScale(d[0], d[4], d[4], 0);
      SetBattlerSpriteYOffsetFromYScale(d[0]);
      if (d[2] === 32) {
        d[2] = 0;
        d[1]++;
      }
      break;
    case 5:
      ResetSpriteRotScale(d[0]);
      // data[15] is never set here (the C does the same), so this resets sprite 0's y2
      gSprites[d[15]].y2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** CreateMinimizeSprite: a blended copy of the attacker at the current scale, for 16 frames */
function CreateMinimizeSprite(task: Task, taskId: number): void {
  const spriteId = CloneBattlerSpriteWithBlend(K.ANIM_ATTACKER);
  if (spriteId < 0) return;
  const matrixNum = AllocOamMatrix();
  const sprite = gSprites[spriteId];
  if (matrixNum === 0xff) {
    DestroySpriteWithActiveSheet(sprite);
    return;
  }
  const d = task.data;
  sprite.oam.objMode = ST_OAM_OBJ_BLEND;
  sprite.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  sprite.affineAnimPaused = true;
  sprite.oam.matrixNum = matrixNum;
  sprite.subpriority = (d[7] - d[3]) & 0xff;
  d[3]++;
  d[6]++;
  sprite.data[0] = 16;
  sprite.data[1] = taskId;
  sprite.data[2] = 6;
  sprite.callback = ClonedMinizeSprite_Step;
  SetSpriteRotScale(spriteId, d[4], d[4], 0);
  sprite.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
}

function ClonedMinizeSprite_Step(sprite: Sprite): void {
  if (--sprite.data[0] === 0) {
    gTasks[sprite.data[1]].data[sprite.data[2]]--;
    FreeOamMatrix(sprite.oam.matrixNum);
    DestroySpriteWithActiveSheet(sprite);
  }
}

/** AnimTask_Splash: the battler squashes and hops. Args: anim battler, hops. */
const AnimTask_Splash: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  if (gBattleAnimArgs[1] === 0) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const d = task.data;
  d[0] = spriteId;
  d[1] = 0;
  d[2] = gBattleAnimArgs[1];
  d[3] = 0;
  d[4] = 0;
  PrepareAffineAnimInTaskData(task, spriteId, affineAnim('sSplashEffectAffineAnimCmds'));
  task.func = AnimTask_Splash_Step;
};

const AnimTask_Splash_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[1]) {
    case 0:
      RunAffineAnimFromTaskData(task);
      d[4] += 3;
      gSprites[d[0]].y2 += d[4];
      if (++d[3] > 7) {
        d[3] = 0;
        d[1]++;
      }
      break;
    case 1:
      RunAffineAnimFromTaskData(task);
      gSprites[d[0]].y2 += d[4];
      if (++d[3] > 7) {
        d[3] = 0;
        d[1]++;
      }
      break;
    case 2:
      if (d[4] !== 0) {
        gSprites[d[0]].y2 -= 2;
        d[4] -= 2;
      } else {
        d[1]++;
      }
      break;
    case 3:
      if (!RunAffineAnimFromTaskData(task)) {
        if (--d[2] === 0) {
          gSprites[d[0]].y2 = 0;
          DestroyAnimVisualTask(taskId);
        } else {
          PrepareAffineAnimInTaskData(task, d[0], affineAnim('sSplashEffectAffineAnimCmds'));
          d[1] = 0;
        }
      }
      break;
  }
};

/** Runs a task's PrepareAffineAnimInTaskData anim to its end, then destroys the task. */
const runTaskAffineAnimToEnd: TaskFunc = (taskId) => {
  if (!RunAffineAnimFromTaskData(gTasks[taskId])) DestroyAnimVisualTask(taskId);
};

/** AnimTask_GrowAndShrink (Swagger, Bulk Up): the attacker grows, pauses and shrinks back. */
const AnimTask_GrowAndShrink: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  PrepareAffineAnimInTaskData(gTasks[taskId], spriteId, affineAnim('sGrowAndShrinkAffineAnimCmds'));
  gTasks[taskId].func = runTaskAffineAnimToEnd; // AnimTask_GrowAndShrink_Step
};

/** AnimBreathPuff (Swagger, Bulk Up): a puff of breath from the attacker. */
const AnimBreathPuff: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    StartSpriteAnim(sprite, 0);
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + 32;
    sprite.data[1] = 64;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) - 32;
    sprite.data[1] = -64;
  }
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = 52;
  sprite.data[2] = 0;
  sprite.data[3] = 0;
  sprite.data[4] = 0;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearFixedPoint;
};

/** AnimAngerMark (Rage, Swagger, ...): pops on a battler. Args: battler (0 attacker), x, y. */
const AnimAngerMark: SpriteCallback = (sprite) => {
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) gBattleAnimArgs[1] *= -1;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  if (sprite.y < 8) sprite.y = 8;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

// ------------------------------------------------------------------ Thrash, Sketch

/** AnimTask_ThrashMoveMonHorizontal: the attacker's left/right squash. */
const AnimTask_ThrashMoveMonHorizontal: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.data[0] = spriteId;
  task.data[1] = 0;
  PrepareAffineAnimInTaskData(task, spriteId, affineAnim('sThrashMoveMonAffineAnimCmds'));
  task.func = runTaskAffineAnimToEnd; // AnimTask_ThrashMoveMonHorizontal_Step
};

/** AnimTask_ThrashMoveMonVertical: the attacker sways sideways, bobbing up and down. */
const AnimTask_ThrashMoveMonVertical: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[1] = 0;
  d[2] = 4;
  d[3] = 7;
  d[4] = 3;
  d[5] = gSprites[d[0]].x;
  d[6] = gSprites[d[0]].y;
  d[7] = 0;
  d[8] = 0;
  d[9] = 2;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) d[2] *= -1;
  gTasks[taskId].func = AnimTask_ThrashMoveMonVertical_Step;
};

const AnimTask_ThrashMoveMonVertical_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sprite = gSprites[d[0]];
  if (++d[7] > 2) {
    d[7] = 0;
    d[8]++;
    if (d[8] & 1) sprite.y += d[9];
    else sprite.y -= d[9];
  }
  switch (d[1]) {
    case 0:
      sprite.x += d[2];
      if (--d[3] === 0) {
        d[3] = 14;
        d[1] = 1;
      }
      break;
    case 1:
      sprite.x -= d[2];
      if (--d[3] === 0) {
        d[3] = 7;
        d[1] = 2;
      }
      break;
    case 2:
      sprite.x += d[2];
      if (--d[3] === 0) {
        if (--d[4] !== 0) {
          d[3] = 7;
          d[1] = 0;
        } else {
          if (d[8] & 1) sprite.y -= d[9];
          DestroyAnimVisualTask(taskId);
        }
      }
      break;
  }
};

/**
 * AnimTask_SketchDrawMon: hides the target's BG copy (scrolled off on its lines with an HBlank scroll), then
 * reveals it a line at a time from the bottom.
 */
const AnimTask_SketchDrawMon: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = GetBattlerYCoordWithElevation(anim.target) + 32;
  d[1] = 4;
  d[2] = 0;
  d[3] = 0;
  d[4] = 0;
  d[5] = 0;
  d[15] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_HEIGHT);
  let dmaDest: number;
  if (GetBattlerSpriteBGPriorityRank(anim.target) === 1) {
    d[6] = g.battle_BG1_X;
    dmaDest = REG_OFFSET_BG1HOFS;
  } else {
    d[6] = g.battle_BG2_X;
    dmaDest = REG_OFFSET_BG2HOFS;
  }
  for (let i = s16(d[0] - 0x40); i <= d[0]; i++) {
    if (i >= 0) {
      gScanlineEffectRegBuffers[0][i] = d[6] + 0xf0;
      gScanlineEffectRegBuffers[1][i] = d[6] + 0xf0;
    }
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  gTasks[taskId].func = AnimTask_SketchDrawMon_Step;
};

const AnimTask_SketchDrawMon_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[4]) {
    case 0:
      if (++d[5] > 20) d[4]++;
      break;
    case 1:
      if (++d[1] > 3) {
        d[1] = 0;
        d[2] = d[3] & 3;
        d[5] = d[0] - d[3];
        switch (d[2]) {
          case 1:
            d[5] -= 2;
            break;
          case 2:
          case 3:
            d[5] += 1;
            break;
        }
        if (d[5] >= 0) {
          gScanlineEffectRegBuffers[0][d[5]] = d[6];
          gScanlineEffectRegBuffers[1][d[5]] = d[6];
        }
        if (++d[3] >= d[15]) {
          gScanlineEffect.state = 3;
          DestroyAnimVisualTask(taskId);
        }
      }
      break;
  }
};

/** AnimPencil (Sketch): blinks in, scribbles up the target, blinks out. */
const AnimPencil: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) - 16;
  sprite.y = GetBattlerYCoordWithElevation(anim.target) + 16;
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 16;
  d[4] = 0;
  d[5] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_HEIGHT) + 2;
  d[6] = BattleAnimAdjustPanning(K.SOUND_PAN_TARGET);
  sprite.callback = AnimPencil_Step;
};

function AnimPencil_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
    case 2:
      if (++d[2] > 1) {
        d[2] = 0;
        sprite.invisible = !sprite.invisible;
      }
      if (++d[1] > 16) {
        sprite.invisible = false;
        if (d[0] === 2) DestroyAnimSprite(sprite);
        else d[0]++;
      }
      break;
    case 1:
      if (++d[1] > 3 && d[2] < d[5]) {
        d[1] = 0;
        sprite.y -= 1;
        d[2]++;
        if (d[2] % 10 === 0) PlaySE12WithPanning(K.SE_M_SKETCH, d[6]);
      }
      d[4] += d[3];
      if (d[4] > 31) {
        d[4] = 0x40 - d[4];
        d[3] *= -1;
      } else if (d[4] <= -32) {
        d[4] = -0x40 - d[4];
        d[3] *= -1;
      }
      sprite.x2 = d[4];
      if (d[5] === d[2]) {
        d[1] = 0;
        d[2] = 0;
        d[0]++;
      }
      break;
  }
}

// ------------------------------------------------------------------ rings (Heal Bell, Hyper Voice, Uproar)

/** AnimBlendThinRing: AnimSpriteOnMonPos, centred between the battler and its partner in doubles. Args: x, y, battler, use pic offsets (inverted), ... */
const AnimBlendThinRing: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[2] === 0 ? anim.attacker : anim.target;
  let r4 = (gBattleAnimArgs[3] ^ 1) & 0xff;
  if (IsDoubleBattle() && IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) {
    const sp0 = SetAverageBattlerPositions(battler, r4 !== 0).x & 0xffff;
    r4 = GetBattlerSpriteCoord(battler, r4 === 0 ? K.BATTLER_COORD_X : K.BATTLER_COORD_X_2) & 0xff;
    if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) gBattleAnimArgs[0] -= sp0 - r4 - gBattleAnimArgs[0];
    else gBattleAnimArgs[0] = sp0 - r4;
  }
  sprite.callback = AnimSpriteOnMonPos;
  sprite.callback(sprite);
};

function AnimHyperVoiceRing_WaitEnd(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) {
    FreeSpriteOamMatrix(sprite);
    DestroyAnimSprite(sprite);
  }
}

/**
 * AnimHyperVoiceRing: a ring from one battler to the other. Args: x (also the duration), y, -, target x,
 * target y, reversed, use pic offsets.
 */
const AnimHyperVoiceRing: SpriteCallback = (sprite) => {
  const [battler1, battler2] = gBattleAnimArgs[5] === 0 ? [anim.attacker, anim.target] : [anim.target, anim.attacker];
  const [xCoordType, yCoordType] = !gBattleAnimArgs[6]
    ? [K.BATTLER_COORD_X, K.BATTLER_COORD_Y]
    : [K.BATTLER_COORD_X_2, K.BATTLER_COORD_Y_PIC_OFFSET];
  const spriteOf = (battler: number) => gSprites[g.battlerSpriteIds[battler]];
  let startX: number;
  if (getBattlerSide(battler1) !== K.B_SIDE_PLAYER) {
    startX = GetBattlerSpriteCoord(battler1, xCoordType) + gBattleAnimArgs[0];
    if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler2))) sprite.subpriority = (spriteOf(BATTLE_PARTNER(battler2)).subpriority - 1) & 0xff;
    else sprite.subpriority = (spriteOf(battler2).subpriority - 1) & 0xff;
  } else {
    startX = GetBattlerSpriteCoord(battler1, xCoordType) - gBattleAnimArgs[0];
    if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler1))) {
      if (spriteOf(battler1).x < spriteOf(BATTLE_PARTNER(battler1)).x) sprite.subpriority = (spriteOf(BATTLE_PARTNER(battler1)).subpriority + 1) & 0xff;
      else sprite.subpriority = (spriteOf(battler1).subpriority - 1) & 0xff;
    } else {
      sprite.subpriority = (spriteOf(battler1).subpriority - 1) & 0xff;
    }
  }
  const startY = GetBattlerSpriteCoord(battler1, yCoordType) + gBattleAnimArgs[1];
  let x: number;
  let y: number;
  if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler2))) {
    ({ x, y } = SetAverageBattlerPositions(battler2, gBattleAnimArgs[6] !== 0));
  } else {
    x = GetBattlerSpriteCoord(battler2, xCoordType);
    y = GetBattlerSpriteCoord(battler2, yCoordType);
  }
  if (getBattlerSide(battler2) !== K.B_SIDE_PLAYER) x += gBattleAnimArgs[3];
  else x -= gBattleAnimArgs[3];
  y += gBattleAnimArgs[4];
  const d = sprite.data;
  d[1] = startX;
  sprite.x = d[1];
  d[3] = startY;
  sprite.y = d[3];
  d[2] = x;
  d[4] = y;
  d[0] = gBattleAnimArgs[0];
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimHyperVoiceRing_WaitEnd;
  sprite.callback(sprite);
};

/** AnimUproarRing: AnimSpriteOnMonPos with the thin ring blended towards a colour. Args 4-5: colour, amount. */
const AnimUproarRing: SpriteCallback = (sprite) => {
  const index = IndexOfSpritePaletteTag(K.ANIM_TAG_THIN_RING);
  if (index !== 0xff) BlendPalette(OBJ_PLTT_ID(index) + 1, 15, gBattleAnimArgs[5], gBattleAnimArgs[4]);
  StartSpriteAffineAnim(sprite, 1);
  sprite.callback = AnimSpriteOnMonPos;
  sprite.callback(sprite);
};

// ------------------------------------------------------------------ Soft-Boiled

/** AnimSoftBoiledEgg: an egg hops off the attacker, wobbles and hatches. Args: x, y, keep the BLDCNT (non-zero). */
const AnimSoftBoiledEgg: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  sprite.data[0] = 0x380;
  sprite.data[1] = isOpponent(anim.attacker) ? -160 : 160;
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.callback = AnimSoftBoiledEgg_Step1;
};

function AnimSoftBoiledEgg_Step1(sprite: Sprite): void {
  const d = sprite.data;
  sprite.y2 -= d[0] >> 8;
  sprite.x2 = d[1] >> 8;
  d[0] -= 32;
  d[1] += isOpponent(anim.attacker) ? -160 : 160;
  if (sprite.y2 > 0) {
    sprite.y += sprite.y2;
    sprite.x += sprite.x2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    d[0] = 0;
    StartSpriteAffineAnim(sprite, 1);
    sprite.callback = AnimSoftBoiledEgg_Step2;
  }
}

function AnimSoftBoiledEgg_Step2(sprite: Sprite): void {
  if (sprite.data[0]++ > 19) {
    StartSpriteAffineAnim(sprite, 2);
    sprite.callback = AnimSoftBoiledEgg_Step3;
  }
}

function AnimSoftBoiledEgg_Step3(sprite: Sprite): void {
  if (sprite.affineAnimEnded) {
    StartSpriteAffineAnim(sprite, 1);
    sprite.data[0] = 0;
    if (sprite.data[7] === 0) {
      sprite.oam.tileNum += 16;
      sprite.callback = AnimSoftBoiledEgg_Step3_Callback1;
    } else {
      sprite.oam.tileNum += 32;
      sprite.callback = AnimSoftBoiledEgg_Step4;
    }
  }
}

function AnimSoftBoiledEgg_Step3_Callback1(sprite: Sprite): void {
  sprite.y2 -= 2;
  if (++sprite.data[0] === 9) {
    sprite.data[0] = 16;
    sprite.data[1] = 0;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[0] & 0xffff, 0));
    sprite.callback = AnimSoftBoiledEgg_Step3_Callback2;
  }
}

function AnimSoftBoiledEgg_Step3_Callback2(sprite: Sprite): void {
  if (sprite.data[1]++ % 3 === 0) {
    sprite.data[0]--;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[0], 16 - sprite.data[0]));
    if (sprite.data[0] === 0) sprite.callback = AnimSoftBoiledEgg_Step4;
  }
}

function AnimSoftBoiledEgg_Step4(sprite: Sprite): void {
  if ((gBattleAnimArgs[7] & 0xffff) === 0xffff) {
    sprite.invisible = true;
    sprite.callback = sprite.data[7] === 0 ? AnimSoftBoiledEgg_Step4_Callback : DestroyAnimSprite;
  }
}

function AnimSoftBoiledEgg_Step4_Callback(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ Extreme Speed

/** AnimTask_AttackerStretchAndDisappear (Extreme Speed) */
const AnimTask_AttackerStretchAndDisappear: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.data[0] = spriteId;
  PrepareAffineAnimInTaskData(task, spriteId, affineAnim('sStretchAttackerAffineAnimCmds'));
  task.func = AnimTask_AttackerStretchAndDisappear_Step;
};

const AnimTask_AttackerStretchAndDisappear_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  if (!RunAffineAnimFromTaskData(task)) {
    gSprites[task.data[0]].y2 = 0;
    gSprites[task.data[0]].invisible = true;
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_ExtremeSpeedImpact: the target is knocked back and shakes, three times. */
const AnimTask_ExtremeSpeedImpact: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[12] = 3;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    d[13] = -1;
    d[14] = 8;
  } else {
    d[13] = 1;
    d[14] = -8;
  }
  d[15] = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  gTasks[taskId].func = AnimTask_ExtremeSpeedImpact_Step;
};

const AnimTask_ExtremeSpeedImpact_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sprite = gSprites[d[15]];
  switch (d[0]) {
    case 0:
      sprite.x2 += d[14];
      d[1] = 0;
      d[2] = 0;
      d[3] = 0;
      d[0]++;
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        d[2]++;
        if (d[2] & 1) sprite.x2 += 6;
        else sprite.x2 -= 6;
        if (++d[3] > 4) {
          if (d[2] & 1) sprite.x2 -= 6;
          d[0]++;
        }
      }
      break;
    case 2:
      if (--d[12] !== 0) d[0] = 0;
      else d[0]++;
      break;
    case 3:
      sprite.x2 += d[13];
      if (sprite.x2 === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_ExtremeSpeedMonReappear: the attacker blinks back in, slower each round. */
const AnimTask_ExtremeSpeedMonReappear: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[4] = 1;
  d[13] = 14;
  d[14] = 2;
  d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  gTasks[taskId].func = AnimTask_ExtremeSpeedMonReappear_Step;
};

const AnimTask_ExtremeSpeedMonReappear_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0 && ++d[1] > d[4]) {
    d[1] = 0;
    gSprites[d[15]].invisible = !(++d[2] & 1);
    if (++d[3] >= d[13]) {
      if (++d[4] < d[14]) {
        d[1] = 0;
        d[2] = 0;
        d[3] = 0;
      } else {
        gSprites[d[15]].invisible = false;
        DestroyAnimVisualTask(taskId);
      }
    }
  }
};

/** sSpeedDustPosTable */
const sSpeedDustPosTable = [
  [30, 28],
  [-20, 24],
  [16, 26],
  [-10, 28],
];

/** AnimTask_SpeedDust: puffs of dust at the attacker's feet, flickering. */
const AnimTask_SpeedDust: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d.fill(0, 0, 9);
  d[1] = 4;
  d[13] = 0;
  d[14] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
  d[15] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
  gTasks[taskId].func = AnimTask_SpeedDust_Step;
};

const AnimTask_SpeedDust_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[8]) {
    case 0:
      if (++d[4] > 1) {
        d[4] = 0;
        d[5] = (d[5] + 1) & 1;
        if (++d[6] > 20) {
          if (d[7] === 0) {
            d[6] = 0;
            d[8] = 1;
          } else {
            d[8] = 2;
          }
        }
      }
      break;
    case 1:
      d[5] = 0;
      if (++d[4] > 20) {
        d[7] = 1;
        d[8] = 0;
      }
      break;
    case 2:
      d[5] = 1;
      break;
  }
  switch (d[0]) {
    case 0:
      if (++d[1] > 4) {
        d[1] = 0;
        const spriteId = CreateSprite(animSpriteTemplate('gSpeedDustSpriteTemplate')!, d[14], d[15], 0);
        if (spriteId !== MAX_SPRITES) {
          const sprite = gSprites[spriteId];
          sprite.data[0] = taskId;
          sprite.data[1] = 13;
          sprite.x2 = sSpeedDustPosTable[d[2]][0];
          sprite.y2 = sSpeedDustPosTable[d[2]][1];
          d[13]++;
          if (++d[2] > 3) {
            d[2] = 0;
            if (++d[3] > 5) d[0]++;
          }
        }
      }
      break;
    case 1:
      if (d[13] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimSpeedDust (made by AnimTask_SpeedDust): blinks with the task's data[5] until its anim ends. */
const AnimSpeedDust: SpriteCallback = (sprite) => {
  sprite.invisible = gTasks[sprite.data[0]].data[5] !== 0;
  if (sprite.animEnded) {
    gTasks[sprite.data[0]].data[sprite.data[1]]--;
    DestroySprite(sprite);
  }
};

// ------------------------------------------------------------------ music notes (Heal Bell)

/** gMusicNotePaletteTagsTable */
const musicNotePaletteTags = () => [K.ANIM_TAG_MUSIC_NOTES_2, bdata.animScripts.animSpritesStart - 1, bdata.animScripts.animSpritesStart - 2];

/** AnimTask_LoadMusicNotesPals: palettes 0-2 of gBattleAnimSpritePal_MusicNotes2, under three tags. */
const AnimTask_LoadMusicNotesPals: TaskFunc = (taskId) => {
  const tags = musicNotePaletteTags();
  const paletteNums = [IndexOfSpritePaletteTag(tags[0])];
  for (let i = 1; i < tags.length; i++) paletteNums[i] = AllocSpritePalette(tags[i]);
  const pals = gfx16('gBattleAnimSpritePal_MusicNotes2');
  for (let i = 0; i < tags.length; i++) LoadPalette(pals.subarray(i * 16), OBJ_PLTT_ID(paletteNums[i]), PLTT_SIZE_4BPP);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_FreeMusicNotesPals: TaskFunc = (taskId) => {
  for (const tag of musicNotePaletteTags()) FreeSpritePaletteByTag(tag);
  DestroyAnimVisualTask(taskId);
};

/** SetMusicNotePalette: note shape `a`; `b` picks the tile half (bit 0) and palette (b >> 1) */
function SetMusicNotePalette(sprite: Sprite, a: number, b: number): void {
  a &= 0xff;
  b &= 0xff;
  const tile = b & 1 ? 32 : 0;
  sprite.oam.tileNum += tile + (a << 2);
  sprite.oam.paletteNum = IndexOfSpritePaletteTag(musicNotePaletteTags()[b >> 1]);
}

/** AnimHealBellMusicNote: a note from the attacker to a point near it. Args: x, y, target x, target y, duration, note, palette. */
const AnimHealBellMusicNote: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  SetMusicNotePalette(sprite, gBattleAnimArgs[5], gBattleAnimArgs[6]);
};

/** AnimMagentaHeart (Status_Infatuation) */
const AnimMagentaHeart: SpriteCallback = (sprite) => {
  if (++sprite.data[0] === 1) InitSpritePosToAnimAttacker(sprite, false);
  sprite.x2 = Sin(sprite.data[1], 8);
  sprite.y2 = sprite.data[2] >> 8;
  sprite.data[1] = (sprite.data[1] + 7) & 0xff;
  sprite.data[2] -= 0x80;
  if (sprite.data[0] === 60) DestroyAnimSprite(sprite);
};

// ------------------------------------------------------------------ Fake Out, stretches

/** AnimTask_FakeOut: a closing window darkens BG3, then everything flashes white. */
const AnimTask_FakeOut: TaskFunc = (taskId) => {
  const win0h = DISPLAY_WIDTH;
  const win0v = 0;
  g.battle_WIN0H = win0h;
  g.battle_WIN0V = DISPLAY_HEIGHT;
  SetGpuReg(REG_OFFSET_WIN0H, g.battle_WIN0H);
  SetGpuReg(REG_OFFSET_WIN0V, g.battle_WIN0V);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN1_CLR | WININ_WIN1_OBJ | WININ_WIN1_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_BG_ALL);
  SetGpuReg(REG_OFFSET_WINOUT, WININ_WIN1_CLR | WININ_WIN1_OBJ | WININ_WIN1_BG_ALL | WININ_WIN0_CLR | WININ_WIN0_OBJ | WININ_WIN0_BG_ALL);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDY, 16);
  gTasks[taskId].data[0] = win0v;
  gTasks[taskId].data[1] = win0h;
  gTasks[taskId].func = AnimTask_FakeOut_Step1;
};

const AnimTask_FakeOut_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] += 13;
  d[1] -= 13;
  if (d[0] >= d[1]) {
    g.battle_WIN0H = 0;
    gTasks[taskId].func = AnimTask_FakeOut_Step2;
  } else {
    g.battle_WIN0H = (d[1] | (d[0] << 8)) & 0xffff;
  }
};

const AnimTask_FakeOut_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[10] === 5) {
    d[11] = 0x88;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_LIGHTEN);
    BlendPalettes(GetBattlePalettesMask(true, false, false, false, false, false, false), 16, RGB_WHITE);
  } else if (d[10] > 4) {
    g.battle_WIN0H = 0;
    g.battle_WIN0V = 0;
    SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR);
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDY, 0);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_StretchTargetUp / AnimTask_StretchAttackerUp: the battler stretches up, shaking sideways. */
function stretchBattlerUp(taskId: number, animBattler: number): void {
  const spriteId = GetAnimBattlerSpriteId(animBattler);
  if (++gTasks[taskId].data[0] === 1) {
    PrepareAffineAnimInTaskData(gTasks[taskId], GetAnimBattlerSpriteId(animBattler), affineAnim('sAffineAnims_StretchBattlerUp'));
    gSprites[spriteId].x2 = 4;
  } else {
    gSprites[spriteId].x2 = -gSprites[spriteId].x2;
    if (!RunAffineAnimFromTaskData(gTasks[taskId])) {
      gSprites[spriteId].x2 = 0;
      gSprites[spriteId].y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
}

const AnimTask_StretchTargetUp: TaskFunc = (taskId) => stretchBattlerUp(taskId, K.ANIM_TARGET);
const AnimTask_StretchAttackerUp: TaskFunc = (taskId) => stretchBattlerUp(taskId, K.ANIM_ATTACKER);

// ------------------------------------------------------------------ Attract, Sweet Kiss, Lovely Kiss

/** AnimRedHeartProjectile (Attract): a heart weaving to the target. */
const AnimRedHeartProjectile: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = 95;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimRedHeartProjectile_Step;
};

function AnimRedHeartProjectile_Step(sprite: Sprite): void {
  if (!AnimTranslateLinear(sprite)) {
    sprite.y2 += Sin(sprite.data[5], 14);
    sprite.data[5] = (sprite.data[5] + 4) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimParticleBurst (also used by battle_anim_effects_3.c's templates): drifts sideways, bobbing, then flickers out. Args: x speed, amplitude. */
export function AnimParticleBurst(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    d[1] = gBattleAnimArgs[0];
    d[2] = gBattleAnimArgs[1];
    d[0]++;
  } else {
    d[4] += d[1];
    sprite.x2 = d[4] >> 8;
    sprite.y2 = Sin(d[3], d[2]);
    d[3] = (d[3] + 3) & 0xff;
    if (d[3] > 100) sprite.invisible = d[3] % 2 !== 0;
    if (d[3] > 120) DestroyAnimSprite(sprite);
  }
}

/** AnimRedHeartRising (Attract): rises from the bottom of the screen. Args: x, speed, delay. */
const AnimRedHeartRising: SpriteCallback = (sprite) => {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = DISPLAY_HEIGHT;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimRedHeartRising_Step);
};

function AnimRedHeartRising_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[2] += d[1];
  sprite.y2 = -((d[2] & 0xffff) >> 8);
  sprite.x2 = Sin(d[3], 4);
  d[3] = (d[3] + 3) & 0xff;
  const y = s16(sprite.y + sprite.y2);
  if (y <= 72) {
    sprite.invisible = d[3] % 2 !== 0;
    if (y <= 64) DestroyAnimSprite(sprite);
  }
}

/** AnimTask_HeartsBackground (Attract): the hearts BG on BG1 fades in, stays, and fades out. */
const AnimTask_HeartsBackground: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 3);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gBattleAnimBg_AttractTilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gBattleAnimBg_AttractGfx', animBg.tilesOffset);
  LoadCompressedPalette(gfx16('gBattleAnimBg_AttractPal'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  gTasks[taskId].func = AnimTask_HeartsBackground_Step;
};

/**
 * The fade of AnimTask_HeartsBackground / AnimTask_ScaryFace: up to `peak` every `step` frames, hold until
 * data[11] reaches `hold`, back down; data[12] is 3 once faded out.
 */
function fadeBg1InHoldOut(d: Int16Array, step: number, peak: number, hold: number): void {
  switch (d[12]) {
    case 0:
      if (++d[10] === step) {
        d[10] = 0;
        d[11]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === peak) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
    case 1:
      if (++d[11] === hold) {
        d[11] = peak;
        d[12]++;
      }
      break;
    case 2:
      if (++d[10] === step) {
        d[10] = 0;
        d[11]--;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === 0) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
  }
}

/** Case 4 of AnimTask_HeartsBackground_Step / AnimTask_ScaryFace_Step */
function endBg1Blend(taskId: number): void {
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  DestroyAnimVisualTask(taskId);
}

const AnimTask_HeartsBackground_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[12]) {
    case 3:
      InitBattleAnimBg(GetBattleAnimBg1Data().bgId);
      d[12]++;
      break;
    case 4:
      endBg1Blend(taskId);
      break;
    default:
      fadeBg1InHoldOut(d, 4, 16, 141);
      break;
  }
};

/** AnimTask_ScaryFace (Scary Face, Glare): the face BG on BG1 fades in, stays, and fades out. */
const AnimTask_ScaryFace: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  const animBg = GetBattleAnimBg1Data();
  if (getBattlerSide(anim.target) === K.B_SIDE_OPPONENT) AnimLoadCompressedBgTilemap(animBg.bgId, 'gBattleAnimBgTilemap_ScaryFacePlayer');
  else AnimLoadCompressedBgTilemap(animBg.bgId, 'gBattleAnimBgTilemap_ScaryFaceOpponent');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gBattleAnim_ScaryFaceGfx', animBg.tilesOffset);
  LoadCompressedPalette(gfx16('gBattleAnim_ScaryFacePal'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  gTasks[taskId].func = AnimTask_ScaryFace_Step;
};

const AnimTask_ScaryFace_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[12]) {
    case 3:
      InitBattleAnimBg(1);
      InitBattleAnimBg(2);
      d[12]++;
      endBg1Blend(taskId); // falls through to case 4
      break;
    case 4:
      endBg1Blend(taskId);
      break;
    default:
      fadeBg1InHoldOut(d, 2, 14, 21);
      break;
  }
};

// ------------------------------------------------------------------ Hidden Power, Spit Up, sparkles

/** AnimOrbitFast (Hidden Power): an orb orbiting the attacker in a widening then narrowing ellipse. Args: duration, wave offset. */
const AnimOrbitFast: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.affineAnimPaused = true;
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[7] = GetBattlerSpriteSubpriority(anim.attacker);
  sprite.callback = AnimOrbitFast_Step;
  sprite.callback(sprite);
};

function AnimOrbitFast_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.subpriority = (d[1] >= 64 && d[1] <= 191 ? d[7] + 1 : d[7] - 1) & 0xff;
  sprite.x2 = Sin(d[1], d[2] >> 8);
  sprite.y2 = Cos(d[1], d[3] >> 8);
  d[1] = (d[1] + 9) & 0xff;
  switch (d[5]) {
    case 1:
      d[2] -= 0x400;
      d[3] -= 0x100;
      if (++d[4] === d[0]) {
        d[5] = 2;
        return;
      }
      break;
    case 0:
      d[2] += 0x400;
      d[3] += 0x100;
      if (++d[4] === d[0]) {
        d[4] = 0;
        d[5] = 1;
      }
      break;
  }
  if ((gBattleAnimArgs[7] & 0xffff) === 0xffff) DestroyAnimSprite(sprite);
}

/** AnimOrbitScatter (Hidden Power): flies off the screen from its orbit position. Arg 0: wave offset. */
const AnimOrbitScatter: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = Sin(gBattleAnimArgs[0], 10);
  sprite.data[1] = Cos(gBattleAnimArgs[0], 7);
  sprite.callback = AnimOrbitScatter_Step;
};

function AnimOrbitScatter_Step(sprite: Sprite): void {
  sprite.x2 += sprite.data[0];
  sprite.y2 += sprite.data[1];
  // an unsigned compare in the C: off either side of the screen
  if ((sprite.x + sprite.x2 + 16) >>> 0 > DISPLAY_WIDTH + 32 || sprite.y + sprite.y2 > DISPLAY_HEIGHT || sprite.y + sprite.y2 < -16) DestroyAnimSprite(sprite);
}

function AnimSpitUpOrb_Step(sprite: Sprite): void {
  sprite.x2 += sprite.data[0];
  sprite.y2 += sprite.data[1];
  if (sprite.data[3]++ >= sprite.data[2]) DestroyAnimSprite(sprite);
}

/** AnimSpitUpOrb: flies out from the attacker. Args: direction, duration. */
const AnimSpitUpOrb: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = Sin(gBattleAnimArgs[0], 10);
  sprite.data[1] = Cos(gBattleAnimArgs[0], 7);
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.callback = AnimSpitUpOrb_Step;
};

/** AnimEyeSparkle (Scary Face, Tickle, ...): plays its anim on the attacker. Args: x, y. */
const AnimEyeSparkle: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.callback = AnimEyeSparkle_Step;
};

function AnimEyeSparkle_Step(sprite: Sprite): void {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimAngel (Sweet Kiss): swings down and away. Args: x, y. */
const AnimAngel: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  d[0]++;
  const var0 = (d[0] * 10) & 0xff;
  sprite.x2 = Sin(var0, 80) >> 8;
  if (d[0] < 80) sprite.y2 = Math.trunc(d[0] / 2) + (Cos(var0, 80) >> 8);
  if (d[0] > 90) {
    d[2]++;
    sprite.x2 -= Math.trunc(d[2] / 2);
  }
  if (d[0] > 100) DestroyAnimSprite(sprite);
};

function AnimPinkHeart_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[5]++;
  sprite.x2 = Sin(d[3], 5);
  sprite.y2 = Math.trunc(d[5] / 2);
  d[3] = (d[3] + 3) & 0xff;
  if (d[5] > 20) sprite.invisible = d[5] % 2 !== 0;
  if (d[5] > 30) DestroyAnimSprite(sprite);
}

/** AnimPinkHeart (Lovely Kiss): AnimParticleBurst, then it sinks and flickers out. Args: x speed, amplitude. */
const AnimPinkHeart: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) {
    d[1] = gBattleAnimArgs[0];
    d[2] = gBattleAnimArgs[1];
    d[0]++;
  } else {
    d[4] += d[1];
    sprite.x2 = d[4] >> 8;
    sprite.y2 = Sin(d[3], d[2]);
    d[3] = (d[3] + 3) & 0xff;
    if (d[3] > 70) {
      sprite.callback = AnimPinkHeart_Step;
      sprite.x += sprite.x2;
      sprite.y += sprite.y2;
      sprite.x2 = 0;
      sprite.y2 = 0;
      d[3] = random() % 180;
    }
  }
};

/** AnimDevil (Lovely Kiss): swings round the target, flickering in and out. Args: x, y. */
const AnimDevil: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[3] === 0) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    StartSpriteAnim(sprite, 0);
    sprite.subpriority = (GetBattlerSpriteSubpriority(anim.target) - 1) & 0xff;
    d[2] = 1;
  }
  d[0] += d[2];
  d[1] = (d[0] * 4) % 256;
  if (d[1] < 0) d[1] = 0;
  sprite.x2 = Cos(d[1], 30 - Math.trunc(d[0] / 4));
  sprite.y2 = Sin(d[1], 10 - Math.trunc(d[0] / 8));
  if (d[1] > 128 && d[2] > 0) d[2] = -1;
  if (d[1] === 0 && d[2] < 0) d[2] = 1;
  d[3]++;
  if (d[3] < 10 || d[3] > 80) sprite.invisible = d[0] % 2 !== 0;
  else sprite.invisible = false;
  if (d[3] > 90) DestroyAnimSprite(sprite);
};

/** AnimFurySwipes: plays one of its anims. Args: x, y, anim. */
const AnimFurySwipes: SpriteCallback = (sprite) => {
  if (sprite.data[0] === 0) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    StartSpriteAnim(sprite, gBattleAnimArgs[2]);
    sprite.data[0]++;
  } else if (sprite.animEnded) {
    DestroyAnimSprite(sprite);
  }
};

/** AnimMovementWaves (Struggle): waves beside a battler. Args: battler (0 attacker), side (0 right), repeats (0: none). */
const AnimMovementWaves: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) {
    DestroyAnimSprite(sprite);
    return;
  }
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (!gBattleAnimArgs[1]) sprite.x += 32;
  else sprite.x -= 32;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[1];
  StartSpriteAnim(sprite, sprite.data[1]);
  sprite.callback = AnimMovementWaves_Step;
};

function AnimMovementWaves_Step(sprite: Sprite): void {
  if (sprite.animEnded) {
    if (--sprite.data[0]) StartSpriteAnim(sprite, sprite.data[1]);
    else DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ Uproar, Perish Song, Safeguard, Fury Cutter

/** AnimTask_UproarDistortion: arg 0 the battler. */
const AnimTask_UproarDistortion: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(gTasks[taskId], spriteId, affineAnim('sUproarAffineAnimCmds'));
  gTasks[taskId].func = runTaskAffineAnimToEnd; // AnimTask_UproarDistortion_Step
};

/** AnimJaggedMusicNote (Uproar): flies out from a battler for 17 frames. Args: battler, x, y, note. */
const AnimJaggedMusicNote: SpriteCallback = (sprite) => {
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) gBattleAnimArgs[1] *= -1;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = 0;
  d[1] = (sprite.x & 0xffff) << 3;
  d[2] = (sprite.y & 0xffff) << 3;
  let var1 = gBattleAnimArgs[1] << 3;
  if (var1 < 0) var1 += 7;
  d[3] = var1 >> 3;
  var1 = gBattleAnimArgs[2] << 3;
  if (var1 < 0) var1 += 7;
  d[4] = var1 >> 3;
  sprite.oam.tileNum += gBattleAnimArgs[3] * 16;
  sprite.callback = AnimJaggedMusicNote_Step;
};

function AnimJaggedMusicNote_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[1] += d[3];
  d[2] += d[4];
  sprite.x = d[1] >> 3;
  sprite.y = d[2] >> 3;
  if (++d[0] > 16) DestroyAnimSprite(sprite);
}

/** AnimPerishSongMusicNote2: an invisible sprite that greys its palette at 120 - arg 0 frames, then waits 80. */
const AnimPerishSongMusicNote2: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    d[1] = 120 - gBattleAnimArgs[0];
    sprite.invisible = true;
  }
  if (++d[0] === d[1]) SetGreyscaleOrOriginalPalette(sprite.oam.paletteNum + 16, false);
  if (d[0] === d[1] + 80) DestroyAnimSprite(sprite);
};

/** AnimPerishSongMusicNote: notes circling the screen, then dropping and bouncing. Args: y (x2), anim, wave offset. */
const AnimPerishSongMusicNote: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    sprite.x = 120;
    sprite.y = Math.trunc(gBattleAnimArgs[0] / 2) - 15;
    StartSpriteAnim(sprite, gBattleAnimArgs[1]);
    d[5] = 120;
    d[3] = gBattleAnimArgs[2];
  }
  d[0]++;
  d[1] = Math.trunc(d[0] / 2);
  const index = (d[0] * 3 + (d[3] & 0xffff)) & 0xff;
  d[6] = (d[6] + 10) & 0xff;
  sprite.x2 = Cos(index, 100);
  sprite.y2 = d[1] + Sin(index, 10) + Cos(d[6], 4);
  if (d[0] > d[5]) {
    sprite.callback = AnimPerishSongMusicNote_Step1;
    d[0] = 0;
    SetSpritePrimaryCoordsFromSecondaryCoords(sprite);
    d[2] = 5;
    d[4] = 0;
    d[3] = 0;
    StartSpriteAffineAnim(sprite, 1);
  }
};

function AnimPerishSongMusicNote_Step1(sprite: Sprite): void {
  if (++sprite.data[0] > 10) {
    sprite.data[0] = 0;
    sprite.callback = AnimPerishSongMusicNote_Step2;
  }
}

function AnimPerishSongMusicNote_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[2];
  sprite.y2 = d[3];
  d[2]++;
  if (d[3] > 48 && d[2] > 0) {
    d[2] = d[4] - 5;
    d[4]++;
  }
  if (d[4] > 3) {
    sprite.invisible = d[2] % 2 !== 0;
    DestroyAnimSprite(sprite);
  }
  if (d[4] === 4) DestroyAnimSprite(sprite);
}

/** AnimGuardRing (Safeguard): rises up the attacker (both battlers of its side in doubles). */
const AnimGuardRing: SpriteCallback = (sprite) => {
  if (IsDoubleBattle() && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) {
    const { x, y } = SetAverageBattlerPositions(anim.attacker, false);
    sprite.x = x;
    sprite.y = y + 40;
    StartSpriteAffineAnim(sprite, 1);
  } else {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 40;
  }
  sprite.data[0] = 13;
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y - 72;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

const AnimTask_IsFuryCutterHitRight: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = anim.disableStruct!.furyCutterCounter & 1;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_GetFuryCutterHitCount: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = anim.disableStruct!.furyCutterCounter;
  DestroyAnimVisualTask(taskId);
};

export const effects2SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimCirclingFinger,
  AnimBouncingMusicNote,
  AnimVibrateBattlerBack,
  AnimMovingClamp,
  AnimKinesisZapEnergy,
  AnimSwordsDanceBlade,
  AnimSonicBoomProjectile,
  AnimAirWaveProjectile,
  AnimVoidLines,
  AnimCoinThrow,
  AnimFallingCoin,
  AnimBulletSeed,
  AnimRazorWindTornado,
  AnimViceGripPincer,
  AnimGuillotinePincer,
  AnimBreathPuff,
  AnimAngerMark,
  AnimPencil,
  AnimBlendThinRing,
  AnimHyperVoiceRing,
  AnimUproarRing,
  AnimSoftBoiledEgg,
  AnimSpeedDust,
  AnimHealBellMusicNote,
  AnimMagentaHeart,
  AnimRedHeartProjectile,
  AnimParticleBurst,
  AnimRedHeartRising,
  AnimOrbitFast,
  AnimOrbitScatter,
  AnimSpitUpOrb,
  AnimEyeSparkle,
  AnimAngel,
  AnimPinkHeart,
  AnimDevil,
  AnimFurySwipes,
  AnimMovementWaves,
  AnimJaggedMusicNote,
  AnimPerishSongMusicNote2,
  AnimPerishSongMusicNote,
  AnimGuardRing,
};

export const effects2Tasks: Record<string, TaskFunc> = {
  AnimTask_Withdraw,
  AnimTask_AirCutterProjectile,
  AnimTask_GrowAndGrayscale,
  AnimTask_Minimize,
  AnimTask_Splash,
  AnimTask_GrowAndShrink,
  AnimTask_ThrashMoveMonHorizontal,
  AnimTask_ThrashMoveMonVertical,
  AnimTask_SketchDrawMon,
  AnimTask_AttackerStretchAndDisappear,
  AnimTask_ExtremeSpeedImpact,
  AnimTask_ExtremeSpeedMonReappear,
  AnimTask_SpeedDust,
  AnimTask_LoadMusicNotesPals,
  AnimTask_FreeMusicNotesPals,
  AnimTask_FakeOut,
  AnimTask_StretchTargetUp,
  AnimTask_StretchAttackerUp,
  AnimTask_HeartsBackground,
  AnimTask_ScaryFace,
  AnimTask_UproarDistortion,
  AnimTask_IsFuryCutterHitRight,
  AnimTask_GetFuryCutterHitCount,
};

export function registerEffects2ExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_HeartsBackground: ['gBattleAnimBg_AttractTilemap', 'gBattleAnimBg_AttractGfx', 'gBattleAnimBg_AttractPal'],
    AnimTask_ScaryFace: ['gBattleAnimBgTilemap_ScaryFacePlayer', 'gBattleAnimBgTilemap_ScaryFaceOpponent', 'gBattleAnim_ScaryFaceGfx', 'gBattleAnim_ScaryFacePal'],
    AnimTask_LoadMusicNotesPals: ['gBattleAnimSpritePal_MusicNotes2'],
  });
}
