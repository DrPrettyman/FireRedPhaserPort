// battle_anim_effects_3.c, first half (up to AnimPainSplitProjectile, C line 2877): every sprite callback and
// task in it (IsContest() is always FALSE in FRLG). The rest of the file is in effects3b.ts; AnimRoarNoiseLine
// and AnimTask_MonToSubstitute are from that half but were ported earlier and stay here.

import { LoadBgTiles } from '../../gba/bg';
import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPCNT_OBJWIN_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GetGpuReg,
  ClearGpuRegBits,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
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
import { BG_PLTT_ID, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, PLTT_SIZE_4BPP } from '../../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import {
  ChangeSpriteAffineAnim,
  CreateSprite,
  CreateSpriteAndAnimate,
  DestroySprite,
  gSprites,
  MAX_SPRITES,
  SpriteCallbackDummy,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_OBJ_WINDOW,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type AffineAnimCmd,
  type Sprite,
  type SpriteCallback,
  type SpriteTemplate,
} from '../../gba/sprite';
import { DestroyTask, gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { bdata, g } from '../env';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  ArcTan2Neg,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattleAnimBgDataByPriorityRank,
  GetBattleBgPaletteNum,
  GetBattlerSpriteCoord,
  GetBattlerYCoordWithElevation,
  InitAnimArcTranslation,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsDoubleBattle,
  PrepareAffineAnimInTaskData,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunAffineAnimFromTaskData,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetAnimSpriteInitialXOffset,
  SetAverageBattlerPositions,
  SetBattlerSpriteYOffsetFromRotation,
  SetSpriteCoordsToAnimAttackerCoords,
  SetSpriteRotScale,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TrySetSpriteRotScale,
  WaitAnimForDuration,
} from './animMons';
import { GetBattlerSpriteBGPriorityRank, gMonSpritesGfxPtr, HandleSpeciesGfxDataChange, LoadBattleMonGfxAndAnimate, SetBattlerShadowSpriteCallback } from '../gfx';
import { animSpriteTemplate, BattleAnimAdjustPanning, PlaySE12WithPanning } from './battleAnim';
import { SMOKESCREEN_GFX, SmokescreenImpact } from './smokescreen';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const UNIT = 'battle_anim_effects_3.c';
/** A static `union AffineAnimCmd[]` of this file (extracted to anims.json) */
const affineAnim = (name: string) => bdata.anims.units[UNIT].affineAnims[name] as AffineAnimCmd[];
/** A template this file's code creates sprites from (its callback is ported here) */
const template = (name: string): SpriteTemplate => animSpriteTemplate(name)!;

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimBlackSmoke (Smokescreen): a puff drifting sideways while it flickers. Args: x, y, speed, flip, duration. */
const AnimBlackSmoke: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = !gBattleAnimArgs[3] ? gBattleAnimArgs[2] : -gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[4];
  sprite.callback = AnimBlackSmoke_Step;
};

function AnimBlackSmoke_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[1] > 0) {
    sprite.x2 = d[2] >> 8;
    d[2] += d[0];
    sprite.invisible = !sprite.invisible;
    d[1]--;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimTask_SmokescreenImpact: the smoke cloud on the target (battle_anim_smokescreen.c) */
const AnimTask_SmokescreenImpact: TaskFunc = (taskId) => {
  SmokescreenImpact(
    GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + 8,
    GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + 8,
    false,
  );
  DestroyAnimVisualTask(taskId);
};

/** AnimWhiteHalo (Moonlight): the halo holds for 90 frames, then fades out. */
const AnimWhiteHalo: SpriteCallback = (sprite) => {
  sprite.data[0] = 90;
  sprite.callback = WaitAnimForDuration;
  sprite.data[1] = 7;
  StoreSpriteCallbackInData6(sprite, AnimWhiteHalo_Step1);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[1], 16 - sprite.data[1]));
};

function AnimWhiteHalo_Step1(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[1], 16 - sprite.data[1]));
  if (--sprite.data[1] < 0) {
    sprite.invisible = true;
    sprite.callback = AnimWhiteHalo_Step2;
  }
}

function AnimWhiteHalo_Step2(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimSprite(sprite);
}

/** AnimTealAlert (Mind Reader): a streak pointing at and flying into the target. Args: x, y, duration. */
const AnimTealAlert: SpriteCallback = (sprite) => {
  const x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) & 0xff;
  const y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) & 0xff;
  InitSpritePosToAnimTarget(sprite, true);
  const rotation = (ArcTan2Neg(sprite.x - x, sprite.y - y) + 0x6000) & 0xffff;
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rotation);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = x;
  sprite.data[4] = y;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimMeanLookEye (Mean Look): the eye pulses in, shrinks away, reappears, jitters and fades out. */
const AnimMeanLookEye: SpriteCallback = (sprite) => {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  sprite.data[0] = 4;
  sprite.callback = AnimMeanLookEye_Step1;
};

function AnimMeanLookEye_Step1(sprite: Sprite): void {
  const d = sprite.data;
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[0], 16 - d[0]));
  if (d[1]) d[0]--;
  else d[0]++;
  if (d[0] === 15 || d[0] === 4) d[1] ^= 1;
  if (d[2]++ > 70) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    StartSpriteAffineAnim(sprite, 1);
    d[2] = 0;
    sprite.invisible = true;
    sprite.affineAnimPaused = true;
    sprite.callback = AnimMeanLookEye_Step2;
  }
}

function AnimMeanLookEye_Step2(sprite: Sprite): void {
  if (sprite.data[2]++ > 9) {
    sprite.invisible = false;
    sprite.affineAnimPaused = false;
    if (sprite.affineAnimEnded) sprite.callback = AnimMeanLookEye_Step3;
  }
}

function AnimMeanLookEye_Step3(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[3]) {
    case 0:
    case 1:
      sprite.x2 = 1;
      sprite.y2 = 0;
      break;
    case 2:
    case 3:
      sprite.x2 = -1;
      sprite.y2 = 0;
      break;
    case 4:
    case 5:
      sprite.x2 = 0;
      sprite.y2 = 1;
      break;
    default:
      sprite.x2 = 0;
      sprite.y2 = -1;
      break;
  }
  if (++d[3] > 7) d[3] = 0;
  if (d[4]++ > 15) {
    d[0] = 16;
    d[1] = 0;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[0], 0));
    sprite.callback = AnimMeanLookEye_Step4;
  }
}

function AnimMeanLookEye_Step4(sprite: Sprite): void {
  const d = sprite.data;
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[0], 16 - d[0]));
  if (d[1]++ > 1) {
    d[0]--;
    d[1] = 0;
  }
  if (d[0] === 0) sprite.invisible = true;
  if (d[0] < 0) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    DestroyAnimSprite(sprite);
  }
}

// AnimTask_SetPsychicBackground: cycles colours 1-11 of the battle BG palette every 4 frames until a
// script sets gBattleAnimArgs[7] to -1. It doesn't count as a visual task (waitforvisualfinish skips it).
const AnimTask_SetPsychicBackground: TaskFunc = (taskId) => {
  gTasks[taskId].func = SetPsychicBackground_Step;
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
};

/** Rotates colours 1-11 of BG palette `paletteIndex` in `buf` by one (SetPsychicBackground_Step, FadeScreenToWhite_Step) */
function rotateBgColors(buf: Uint16Array, paletteIndex: number): void {
  const base = BG_PLTT_ID(paletteIndex);
  const lastColor = buf[base + 11];
  for (let i = 10; i > 0; i--) buf[base + i + 1] = buf[base + i];
  buf[base + 1] = lastColor;
}

const SetPsychicBackground_Step: TaskFunc = (taskId) => {
  const paletteIndex = GetBattleBgPaletteNum();
  const d = gTasks[taskId].data;
  if (++d[5] === 4) {
    rotateBgColors(gPlttBufferFaded, paletteIndex);
    d[5] = 0;
  }
  if (gBattleAnimArgs[7] === -1) DestroyTask(taskId);
};

// AnimTask_FadeScreenToWhite (Psycho Boost, Luster Purge): as AnimTask_SetPsychicBackground, but cycles the
// unfaded palette too, so a palette fade running meanwhile keeps the rotation.
const AnimTask_FadeScreenToWhite: TaskFunc = (taskId) => {
  gTasks[taskId].func = FadeScreenToWhite_Step;
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
};

const FadeScreenToWhite_Step: TaskFunc = (taskId) => {
  const paletteIndex = GetBattleBgPaletteNum();
  const d = gTasks[taskId].data;
  if (++d[5] === 4) {
    rotateBgColors(gPlttBufferFaded, paletteIndex);
    rotateBgColors(gPlttBufferUnfaded, paletteIndex);
    d[5] = 0;
  }
  if (gBattleAnimArgs[7] === -1) DestroyTask(taskId);
};

/** AnimSpikes: a spike arcs over to the target's side and blinks out. Args: x, y, target x, target y, duration. */
const AnimSpikes: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const { x, y } = SetAverageBattlerPositions(anim.target, false);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = x + gBattleAnimArgs[2];
  sprite.data[4] = y + gBattleAnimArgs[3];
  sprite.data[5] = -50;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimSpikes_Step1;
};

function AnimSpikes_Step1(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.data[0] = 30;
    sprite.data[1] = 0;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimSpikes_Step2);
  }
}

function AnimSpikes_Step2(sprite: Sprite): void {
  if (sprite.data[1] & 1) sprite.invisible = !sprite.invisible;
  if (++sprite.data[1] === 16) DestroyAnimSprite(sprite);
}

/** AnimLeer: the eyes appear by the attacker. Args: x, y. */
const AnimLeer: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimLetterZ (Sleep Talk, Rest, ...): a "Z" drifts off with a wobble. Args: x, y, x speed, y speed. */
const AnimLetterZ: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) {
    SetSpriteCoordsToAnimAttackerCoords(sprite);
    SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
    if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
      d[1] = gBattleAnimArgs[2];
      d[2] = gBattleAnimArgs[3];
    } else {
      d[1] = -1 * gBattleAnimArgs[2];
      d[2] = -1 * gBattleAnimArgs[3];
    }
  }
  d[0]++;
  const var0 = (d[0] * 20) & 0xff;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 = Math.trunc(d[3] / 2);
  sprite.y2 = Sin(var0 & 0xff, 5) + Math.trunc(d[4] / 2);
  if (((sprite.x + sprite.x2) & 0xffff) > 240) DestroyAnimSprite(sprite);
};

/** AnimFang (Hyper Fang, Poison Fang): the fangs close once. */
const AnimFang: SpriteCallback = (sprite) => {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
};

/** AnimTask_IsTargetPlayerSide: ARG_RET_ID = whether the target is on the player's side */
const AnimTask_IsTargetPlayerSide: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = getBattlerSide(anim.target) === K.B_SIDE_OPPONENT ? 0 : 1;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_IsHealingMove: ARG_RET_ID = whether the move did no damage (Present's heal) */
const AnimTask_IsHealingMove: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = anim.moveDmg > 0 ? 0 : 1;
  DestroyAnimVisualTask(taskId);
};

// AnimSpotlight (Encore, Focus Punch...): an OBJ-window light cone on the target (what's outside it is
// drawn without colour effects), widening, swaying and narrowing away. Args: x, y.
const AnimSpotlight: SpriteCallback = (sprite) => {
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WIN0H, g.battle_WIN0H);
  SetGpuReg(REG_OFFSET_WIN0V, g.battle_WIN0V);
  InitSpritePosToAnimTarget(sprite, false);
  sprite.oam.objMode = ST_OAM_OBJ_WINDOW;
  sprite.invisible = true;
  sprite.callback = AnimSpotlight_Step1;
};

function AnimSpotlight_Step1(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.invisible = false;
      if (sprite.affineAnimEnded) d[0]++;
      break;
    case 1:
    case 3:
      d[1] += 117;
      sprite.x2 = d[1] >> 8;
      if (++d[2] === 21) {
        d[2] = 0;
        d[0]++;
      }
      break;
    case 2:
      d[1] -= 117;
      sprite.x2 = d[1] >> 8;
      if (++d[2] === 41) {
        d[2] = 0;
        d[0]++;
      }
      break;
    case 4:
      ChangeSpriteAffineAnim(sprite, 1);
      d[0]++;
      break;
    case 5:
      if (sprite.affineAnimEnded) {
        sprite.invisible = true;
        sprite.callback = AnimSpotlight_Step2;
      }
      break;
  }
}

function AnimSpotlight_Step2(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
  SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) ^ DISPCNT_OBJWIN_ON);
  DestroyAnimSprite(sprite);
}

// AnimClappingHand (Encore): a hand that claps toward the middle. Args: x, y, side (0 left, 1 right), 0 = at
// the attacker / 1 = keep the sprite's position, claps.
const AnimClappingHand: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (gBattleAnimArgs[3] === 0) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
  }
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.oam.tileNum += 16;
  if (gBattleAnimArgs[2] === 0) {
    sprite.oam.matrixNum = ST_OAM_HFLIP;
    sprite.x2 = -12;
    d[1] = 2;
  } else {
    sprite.x2 = 12;
    d[1] = -2;
  }
  d[0] = gBattleAnimArgs[4];
  if (d[3] !== 255) d[3] = gBattleAnimArgs[2];
  sprite.callback = AnimClappingHand_Step;
};

function AnimClappingHand_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[2] === 0) {
    sprite.x2 += d[1];
    if (sprite.x2 === 0) {
      d[2]++;
      if (d[3] === 0) PlaySE12WithPanning(K.SE_M_ENCORE, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER)); // PlaySE1WithPanning
    }
  } else {
    sprite.x2 -= d[1];
    if (Math.abs(sprite.x2) === 12) {
      d[0]--;
      d[2]--;
    }
  }
  if (d[0] === 0) DestroyAnimSprite(sprite);
}

/** AnimClappingHand2: an OBJ-window copy of the hand, for the spotlight (silent) */
const AnimClappingHand2: SpriteCallback = (sprite) => {
  sprite.oam.objMode = ST_OAM_OBJ_WINDOW;
  sprite.data[3] = 255;
  AnimClappingHand(sprite);
};

const WININ_DEFAULT = WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR;

/** AnimTask_CreateSpotlight: WIN1 over the bottom 40 lines (the textbox), without colour effects */
const AnimTask_CreateSpotlight: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ);
  g.battle_WIN1H = WIN_RANGE(0, DISPLAY_WIDTH);
  g.battle_WIN1V = WIN_RANGE(120, DISPLAY_HEIGHT);
  SetGpuReg(REG_OFFSET_WIN1H, g.battle_WIN1H);
  SetGpuReg(REG_OFFSET_WIN1V, g.battle_WIN1V);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN1_ON);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_RemoveSpotlight: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  g.battle_WIN1H = 0;
  g.battle_WIN1V = 0;
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN1_ON);
  DestroyAnimVisualTask(taskId);
};

/** AnimRapidSpin: a spinning ring sweeping up/down a battler. Args: battler, x, y, end y, sine speed, y speed. */
const AnimRapidSpin: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  sprite.y2 = gBattleAnimArgs[2];
  sprite.data[0] = +(sprite.y2 > gBattleAnimArgs[3]);
  sprite.data[1] = 0;
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.callback = AnimRapidSpin_Step;
};

function AnimRapidSpin_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[1] = (d[1] + d[2]) & 0xff;
  sprite.x2 = gSineTable(d[1]) >> 4;
  sprite.y2 += d[3];
  if (d[0]) {
    if (sprite.y2 < d[4]) DestroyAnimSprite(sprite);
  } else if (sprite.y2 > d[4]) {
    DestroyAnimSprite(sprite);
  }
}

// AnimTask_RapinSpinMonElevation (sic, Rapid Spin): a scanline effect on the battler's BG copy that wipes
// it up out of view, every other pair of frames alternating the wiped lines between two scroll values.
// Args: 0 attacker / 1 target, speed, 1 = stop the scanline effect at the end.
const AnimTask_RapinSpinMonElevation: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  const var0 = GetBattlerYCoordWithElevation(battler);
  const toBG2 = GetBattlerSpriteBGPriorityRank(battler);
  d[0] = var0 + 36;
  d[1] = d[0];
  d[2] = var0 - 33;
  if (d[2] < 0) d[2] = 0;
  d[3] = d[0];
  d[4] = 8;
  d[5] = gBattleAnimArgs[1];
  d[6] = 0;
  d[7] = 0;
  const var3 = (toBG2 === 1 ? g.battle_BG1_X : g.battle_BG2_X) & 0xffff;
  d[8] = var3;
  const var4 = var3 + DISPLAY_WIDTH;
  d[9] = var4;
  d[10] = gBattleAnimArgs[2];
  let var2: number;
  if (!gBattleAnimArgs[2]) {
    d[11] = var4;
    var2 = d[8];
  } else {
    d[11] = var3;
    var2 = d[9];
  }
  d[15] = 0;
  for (let i = d[2]; i <= d[3]; i++) {
    gScanlineEffectRegBuffers[0][i] = var2;
    gScanlineEffectRegBuffers[1][i] = var2;
  }
  const dmaDest = toBG2 === 1 ? REG_OFFSET_BG1HOFS : REG_OFFSET_BG2HOFS;
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  task.func = RapinSpinMonElevation_Step;
};

const RapinSpinMonElevation_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] -= d[5];
  if (d[0] < d[2]) d[0] = d[2];
  if (d[4] === 0) {
    d[1] -= d[5];
    if (d[1] < d[2]) {
      d[1] = d[2];
      d[15] = 1;
    }
  } else {
    d[4]--;
  }
  if (++d[6] > 1) {
    d[6] = 0;
    d[7] = d[7] === 0 ? 1 : 0;
    d[12] = d[7] ? d[8] : d[9];
  }
  for (let i = d[0]; i < d[1]; i++) {
    gScanlineEffectRegBuffers[0][i] = d[12];
    gScanlineEffectRegBuffers[1][i] = d[12];
  }
  for (let i = d[1]; i <= d[3]; i++) {
    gScanlineEffectRegBuffers[0][i] = d[11];
    gScanlineEffectRegBuffers[1][i] = d[11];
  }
  if (d[15]) {
    if (d[10]) gScanlineEffect.state = 3;
    DestroyAnimVisualTask(taskId);
  }
};

// AnimTask_TormentAttacker (Torment): six thought bubbles pop up around the attacker in turn, alternating
// sides, the attacker squashing each time; then all six play their closing anim.
const thoughtBubbleTemplate = (): SpriteTemplate => animSpriteTemplate('gThoughtBubbleSpriteTemplate', true)!;

const AnimTask_TormentAttacker: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[3] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[4] = 32;
  d[5] = -20;
  d[6] = 0;
  d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.func = TormentAttacker_Step;
};

const TormentAttacker_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0: {
      const x = (d[1] & 1 ? d[2] - d[4] : d[2] + d[4]) << 16 >> 16;
      const y = (d[3] + d[5]) << 16 >> 16;
      const spriteId = CreateSprite(thoughtBubbleTemplate(), x, y, (6 - d[1]) & 0xff);
      PlaySE12WithPanning(K.SE_M_METRONOME, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
      if (spriteId !== MAX_SPRITES) {
        gSprites[spriteId].hFlip = !!(d[1] & 1);
        gSprites[spriteId].callback = SpriteCallbackDummy;
      }
      if (d[1] & 1) {
        d[4] -= 6;
        d[5] -= 6;
      }
      PrepareAffineAnimInTaskData(task, d[15], affineAnim('sAffineAnims_Torment'));
      d[1]++;
      d[0] = 1;
      break;
    }
    case 1:
      if (!RunAffineAnimFromTaskData(task)) {
        if (d[1] === 6) {
          d[6] = 8;
          d[0] = 3;
        } else {
          d[6] = d[1] <= 2 ? 10 : 0;
          d[0] = 2;
        }
      }
      break;
    case 2:
      if (d[6] !== 0) d[6]--;
      else d[0] = 0;
      break;
    case 3:
      if (d[6] !== 0) d[6]--;
      else d[0] = 4;
      break;
    case 4: {
      let j = 0;
      for (let i = 0; i < MAX_SPRITES; i++) {
        if (gSprites[i].template === thoughtBubbleTemplate()) {
          gSprites[i].data[0] = taskId;
          gSprites[i].data[1] = 6;
          StartSpriteAnim(gSprites[i], 2);
          gSprites[i].callback = TormentAttacker_Callback;
          if (++j === 6) break;
        }
      }
      d[6] = j;
      d[0] = 5;
      break;
    }
    case 5:
      if (d[6] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

function TormentAttacker_Callback(sprite: Sprite): void {
  if (sprite.animEnded) {
    gTasks[sprite.data[0]].data[sprite.data[1]]--;
    DestroySprite(sprite);
  }
}

/** AnimTriAttackTriangle (Tri Attack): the spinning triangle flickers in by the attacker, then flies at the target. Args: x, y. */
const AnimTriAttackTriangle: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) InitSpritePosToAnimAttacker(sprite, false);
  if (++d[0] < 40) sprite.invisible = (d[0] & 1) === 0;
  if (d[0] > 30) sprite.invisible = false;
  if (d[0] === 61) {
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.x2 = 0;
    sprite.y2 = 0;
    d[0] = 20;
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.callback = StartAnimLinearTranslation;
  }
};

/** Runs one of this file's affine anims on the attacker (the *DeformMon tasks and Strong Frustration) */
function deformAttackerTask(cmds: string): TaskFunc {
  return (taskId) => {
    const task = gTasks[taskId];
    if (!task.data[0]) {
      PrepareAffineAnimInTaskData(task, GetAnimBattlerSpriteId(K.ANIM_ATTACKER), affineAnim(cmds));
      task.data[0]++;
    } else if (!RunAffineAnimFromTaskData(task)) {
      DestroyAnimVisualTask(taskId);
    }
  };
}

/** AnimTask_DefenseCurlDeformMon */
const AnimTask_DefenseCurlDeformMon = deformAttackerTask('DefenseCurlDeformMonAffineAnimCmds');

/** AnimBatonPassPokeball (Baton Pass): the attacker squashes into a ball that flies up off screen. */
const AnimBatonPassPokeball: SpriteCallback = (sprite) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
      PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_NORMAL);
      d[1] = 256;
      d[2] = 256;
      d[0]++;
      break;
    case 1:
      d[1] += 96;
      d[2] -= 26;
      SetSpriteRotScale(spriteId, d[1], d[2], 0);
      if (++d[3] === 5) d[0]++;
    // fall through
    case 2:
      d[1] += 96;
      d[2] += 48;
      SetSpriteRotScale(spriteId, d[1], d[2], 0);
      if (++d[3] === 9) {
        d[3] = 0;
        gSprites[spriteId].invisible = true;
        ResetSpriteRotScale(spriteId);
        d[0]++;
      }
      break;
    case 3:
      sprite.y2 -= 6;
      if (sprite.y + sprite.y2 < -32) DestroyAnimSprite(sprite);
      break;
  }
};

/** AnimWishStar (Wish): a star falls across the screen from behind the attacker, leaving twinkles. */
const AnimWishStar: SpriteCallback = (sprite) => {
  sprite.x = isOpponent(anim.attacker) ? -16 : DISPLAY_WIDTH + 16;
  sprite.y = 0;
  sprite.callback = AnimWishStar_Step;
};

function AnimWishStar_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += 72;
  sprite.x2 = isOpponent(anim.attacker) ? d[0] >> 4 : -(d[0] >> 4);
  d[1] += 16;
  sprite.y2 += d[1] >> 8;
  if (++d[2] % 3 === 0) {
    CreateSpriteAndAnimate(template('gMiniTwinklingStarSpriteTemplate'), sprite.x + sprite.x2, sprite.y + sprite.y2, (sprite.subpriority + 1) & 0xff);
  }
  const newX = (sprite.x + sprite.x2 + 32) >>> 0;
  if (newX > DISPLAY_WIDTH + 64) DestroyAnimSprite(sprite);
}

/** AnimMiniTwinklingStar: one of the Wish star's twinkles (a random frame and y offset), blinking out. */
const AnimMiniTwinklingStar: SpriteCallback = (sprite) => {
  const rand = random() & 3;
  sprite.oam.tileNum += rand === 0 ? 4 : 5;
  let y = random() & 7;
  if (y > 3) y = -y;
  sprite.y2 = y;
  sprite.callback = AnimMiniTwinklingStar_Step;
};

function AnimMiniTwinklingStar_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] < 30) {
    if (++d[1] === 2) {
      sprite.invisible = !sprite.invisible;
      d[1] = 0;
    }
  } else {
    if (d[1] === 2) sprite.invisible = false;
    if (d[1] === 3) {
      sprite.invisible = true;
      d[1] = -1;
    }
    d[1]++;
  }
  if (d[0] > 60) DestroySprite(sprite);
}

/** AnimTask_StockpileDeformMon */
const AnimTask_StockpileDeformMon = deformAttackerTask('sStockpileDeformMonAffineAnimCmds');

/** AnimTask_SpitUpDeformMon */
const AnimTask_SpitUpDeformMon = deformAttackerTask('sSpitUpDeformMonAffineAnimCmds');

/** AnimSwallowBlueOrb (Swallow): an orb pops up from the attacker and falls back in. Args: x, y. */
const AnimSwallowBlueOrb: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      InitSpritePosToAnimAttacker(sprite, false);
      d[1] = 0x900;
      d[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
      d[0]++;
      break;
    case 1:
      sprite.y2 -= d[1] >> 8;
      d[1] -= 96;
      if (sprite.y + sprite.y2 > d[2]) DestroyAnimSprite(sprite);
      break;
  }
};

/** AnimTask_SwallowDeformMon */
const AnimTask_SwallowDeformMon = deformAttackerTask('sSwallowDeformMonAffineAnimCmds');

// AnimTask_TransformMon (Transform, General_SilphScoped, General_CastformChange): mosaics the attacker's BG
// copy (monbg) up, swaps its pic (HandleSpeciesGfxDataChange; arg 0 is the transform type), and mosaics back down.
const AnimTask_TransformMon: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      SetGpuReg(REG_OFFSET_MOSAIC, 0);
      if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetAnimBgAttribute(1, K.BG_ANIM_MOSAIC, 1);
      else SetAnimBgAttribute(2, K.BG_ANIM_MOSAIC, 1);
      d[10] = gBattleAnimArgs[0];
      d[0]++;
      break;
    case 1:
      if (d[2]++ > 1) {
        d[2] = 0;
        d[1]++;
        const stretch = d[1] & 0xffff;
        SetGpuReg(REG_OFFSET_MOSAIC, (stretch << 4) | stretch);
        if (stretch === 15) d[0]++;
      }
      break;
    case 2: {
      HandleSpeciesGfxDataChange(anim.attacker, anim.target, d[10] & 0xff);
      const animBg = GetBattleAnimBgDataByPriorityRank();
      const position = getBattlerPosition(anim.attacker);
      const start = g.battleMonForms[anim.attacker] << 11;
      animBg.bgTiles.set(gMonSpritesGfxPtr!.sprites[position].subarray(start, start + 0x800)); // MON_PIC_SIZE
      LoadBgTiles(1, animBg.bgTiles, 0x800, animBg.tilesOffset);
      d[0]++;
      break;
    }
    case 3:
      if (d[2]++ > 1) {
        d[2] = 0;
        d[1]--;
        const stretch = d[1] & 0xffff;
        SetGpuReg(REG_OFFSET_MOSAIC, (stretch << 4) | stretch);
        if (stretch === 0) d[0]++;
      }
      break;
    case 4:
      SetGpuReg(REG_OFFSET_MOSAIC, 0);
      if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetAnimBgAttribute(1, K.BG_ANIM_MOSAIC, 0);
      else SetAnimBgAttribute(2, K.BG_ANIM_MOSAIC, 0);
      if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT && d[10] === 0)
        SetBattlerShadowSpriteCallback(anim.attacker, g.battleSpritesDataPtr.battlerData[anim.attacker].transformSpecies);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_IsMonInvisible: ARG_RET_ID = whether the attacker's sprite is hidden (General_CastformChange) */
const AnimTask_IsMonInvisible: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = +gSprites[g.battlerSpriteIds[anim.attacker]].invisible;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_CastformGfxChange: Castform's new form without the mosaic (when its sprite is hidden) */
const AnimTask_CastformGfxChange: TaskFunc = (taskId) => {
  HandleSpeciesGfxDataChange(anim.attacker, anim.target, 1);
  DestroyAnimVisualTask(taskId);
};

const MORNING_SUN_GFX = ['gBattleAnim_MorningSunTilemap', 'gBattleAnim_MorningSunGfx', 'gBattleAnim_MorningSunPal'];

/** The light beam BG on BG1 (the shared start of AnimTask_MorningSunLightBeam and AnimTask_DoomDesireLightBeam) */
function loadLightBeamBg(): void {
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gBattleAnim_MorningSunTilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gBattleAnim_MorningSunGfx', animBg.tilesOffset);
  LoadCompressedPalette(gfx16('gBattleAnim_MorningSunPal'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
}

/** The shared end of the light beam tasks */
function endLightBeamBg(taskId: number): void {
  InitBattleAnimBg(GetBattleAnimBg1Data().bgId);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimVisualTask(taskId);
}

// sMorningSunLightBeamCoordsTable (s8): 0xE8, 0x18, 0xFC, 0x00
const sMorningSunLightBeamCoordsTable = [-24, 24, -4, 0];

/** AnimTask_MorningSunLightBeam (Morning Sun): a light beam fades in and out four times over the attacker, shifting each time. */
const AnimTask_MorningSunLightBeam: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
      loadLightBeamBg();
      g.battle_BG1_X = isOpponent(anim.attacker) ? -135 : -10;
      g.battle_BG1_Y = 0;
      d[10] = g.battle_BG1_X;
      d[11] = g.battle_BG1_Y;
      d[0]++;
      PlaySE12WithPanning(K.SE_M_MORNING_SUN, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
      break;
    case 1:
      if (d[4]++ > 0) {
        d[4] = 0;
        if (++d[1] > 12) d[1] = 12;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
        if (d[1] === 12) d[0]++;
      }
      break;
    case 2:
      if (--d[1] < 0) d[1] = 0;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
      if (!d[1]) {
        g.battle_BG1_X = sMorningSunLightBeamCoordsTable[d[2]] + d[10];
        d[0] = ++d[2] === 4 ? 4 : 3;
      }
      break;
    case 3:
      if (++d[3] === 4) {
        d[3] = 0;
        d[0] = 1;
        PlaySE12WithPanning(K.SE_M_MORNING_SUN, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
      }
      break;
    case 4:
      endLightBeamBg(taskId);
      break;
  }
};

/** AnimGreenStar (Ingrain, Wish heal...): a star rises from below the attacker, two smaller ones following. Args: frames, speed. */
const AnimGreenStar: SpriteCallback = (sprite) => {
  let xOffset = random() & 0x3f;
  if (xOffset > 31) xOffset = 32 - xOffset;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + xOffset;
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 32;
  sprite.data[1] = gBattleAnimArgs[0];
  sprite.data[2] = gBattleAnimArgs[1];
  const t = template('gGreenStarSpriteTemplate');
  const spriteId1 = CreateSprite(t, sprite.x, sprite.y, (sprite.subpriority + 1) & 0xff);
  const spriteId2 = CreateSprite(t, sprite.x, sprite.y, (sprite.subpriority + 1) & 0xff);
  StartSpriteAnim(gSprites[spriteId1], 1);
  StartSpriteAnim(gSprites[spriteId2], 2);
  for (const id of [spriteId1, spriteId2]) {
    gSprites[id].data[1] = gBattleAnimArgs[0];
    gSprites[id].data[2] = gBattleAnimArgs[1];
    gSprites[id].data[7] = -1;
    gSprites[id].invisible = true;
    gSprites[id].callback = AnimGreenStar_Callback;
  }
  sprite.data[6] = spriteId1;
  sprite.data[7] = spriteId2;
  sprite.callback = AnimGreenStar_Step1;
};

function AnimGreenStar_Step1(sprite: Sprite): void {
  const d = sprite.data;
  const delta = (d[3] + d[2]) << 16 >> 16;
  sprite.y2 -= delta >> 8;
  d[3] += d[2];
  d[3] &= 0xff;
  if (d[4] === 0 && sprite.y2 < -8) {
    gSprites[d[6]].invisible = false;
    d[4]++;
  }
  if (d[4] === 1 && sprite.y2 < -16) {
    gSprites[d[7]].invisible = false;
    d[4]++;
  }
  if (--d[1] === -1) {
    sprite.invisible = true;
    sprite.callback = AnimGreenStar_Step2;
  }
}

function AnimGreenStar_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (gSprites[d[6]].callback === SpriteCallbackDummy && gSprites[d[7]].callback === SpriteCallbackDummy) {
    DestroySprite(gSprites[d[6]]);
    DestroySprite(gSprites[d[7]]);
    DestroyAnimSprite(sprite);
  }
}

function AnimGreenStar_Callback(sprite: Sprite): void {
  if (!sprite.invisible) {
    const d = sprite.data;
    const delta = (d[3] + d[2]) << 16 >> 16;
    sprite.y2 -= delta >> 8;
    d[3] += d[2];
    d[3] &= 0xff;
    if (--d[1] === -1) {
      sprite.invisible = true;
      sprite.callback = SpriteCallbackDummy;
    }
  }
}

// sDoomDesireLightBeamCoordTable (s8): 0x78, 0x50, 0x28, 0x00. The task reads index 4 too, past the end of
// the table: that's sDoomDesireLightBeamDelayTable[0], 0.
const sDoomDesireLightBeamCoordTable = [120, 80, 40, 0, 0];
const sDoomDesireLightBeamDelayTable = [0, 0, 0, 0, 50];

/** AnimTask_DoomDesireLightBeam (General_DoomDesireHit): the light beam flashes five times over the target, moving across it. */
const AnimTask_DoomDesireLightBeam: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(3, 13));
      loadLightBeamBg();
      const position = getBattlerPosition(anim.target);
      if (IsDoubleBattle()) {
        if (position === K.B_POSITION_OPPONENT_LEFT) g.battle_BG1_X = -155;
        if (position === K.B_POSITION_OPPONENT_RIGHT) g.battle_BG1_X = -115;
        if (position === K.B_POSITION_PLAYER_LEFT) g.battle_BG1_X = 14;
        if (position === K.B_POSITION_PLAYER_RIGHT) g.battle_BG1_X = -20;
      } else {
        if (position === K.B_POSITION_OPPONENT_LEFT) g.battle_BG1_X = -135;
        if (position === K.B_POSITION_PLAYER_LEFT) g.battle_BG1_X = -10;
      }
      g.battle_BG1_Y = 0;
      d[10] = g.battle_BG1_X;
      d[11] = g.battle_BG1_Y;
      d[0]++;
      break;
    }
    case 1:
      d[3] = 0;
      if (getBattlerSide(anim.target) === K.B_SIDE_OPPONENT) g.battle_BG1_X = d[10] + sDoomDesireLightBeamCoordTable[d[2]];
      else g.battle_BG1_X = d[10] - sDoomDesireLightBeamCoordTable[d[2]];
      d[0] = ++d[2] === 5 ? 5 : d[0] + 1;
      break;
    case 2:
      if (--d[1] <= 4) d[1] = 5;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(3, d[1]));
      if (d[1] === 5) d[0]++;
      break;
    case 3:
      if (++d[3] > sDoomDesireLightBeamDelayTable[d[2]]) d[0]++;
      break;
    case 4:
      if (++d[1] > 13) d[1] = 13;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(3, d[1]));
      if (d[1] === 13) d[0] = 1;
      break;
    case 5:
      endLightBeamBg(taskId);
      break;
  }
};

/** AnimTask_StrongFrustrationGrowAndShrink: the attacker stretches up and down twice. */
const AnimTask_StrongFrustrationGrowAndShrink = deformAttackerTask('sStrongFrustrationAffineAnimCmds');

/** AnimWeakFrustrationAngerMark: an anger mark by the attacker's head, falling away after 20 frames. Args: x, y. */
const AnimWeakFrustrationAngerMark: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) {
    InitSpritePosToAnimAttacker(sprite, false);
    d[0]++;
  } else if (d[0]++ > 20) {
    d[1] += 160;
    d[2] += 128;
    sprite.x2 = isOpponent(anim.attacker) ? -(d[1] >> 8) : d[1] >> 8;
    sprite.y2 += d[2] >> 8;
    if (sprite.y2 > 64) DestroyAnimSprite(sprite);
  }
};

// AnimTask_RockMonBackAndForth (Rock Slide, Muddy Water, ...): tilts and sways a battler. Args: battler,
// times, speed (0-2).
const AnimTask_RockMonBackAndForth: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  if (!gBattleAnimArgs[1]) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  if (gBattleAnimArgs[2] < 0) gBattleAnimArgs[2] = 0;
  if (gBattleAnimArgs[2] > 2) gBattleAnimArgs[2] = 2;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 8 - 2 * gBattleAnimArgs[2];
  d[4] = 0x100 + gBattleAnimArgs[2] * 128;
  d[5] = gBattleAnimArgs[2] + 2;
  d[6] = gBattleAnimArgs[1] - 1;
  d[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const side = getBattlerSide(gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target);
  if (side === K.B_SIDE_OPPONENT) {
    d[4] *= -1;
    d[5] *= -1;
  }
  PrepareBattlerSpriteForRotScale(d[15], ST_OAM_OBJ_NORMAL);
  task.func = AnimTask_RockMonBackAndForth_Step;
};

const AnimTask_RockMonBackAndForth_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sway = (dir: number) => {
    gSprites[d[15]].x2 += dir * d[5];
    d[2] -= dir * d[4];
    SetSpriteRotScale(d[15], 0x100, 0x100, d[2]);
    SetBattlerSpriteYOffsetFromRotation(d[15]);
  };
  switch (d[0]) {
    case 0:
      sway(1);
      if (++d[1] >= d[3]) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 1:
      sway(-1);
      if (++d[1] >= d[3] * 2) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      sway(1);
      if (++d[1] >= d[3]) {
        if (d[6]) {
          d[6]--;
          d[1] = 0;
          d[0] = 0;
        } else {
          d[0]++;
        }
      }
      break;
    case 3:
      ResetSpriteRotScale(d[15]);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimSweetScentPetal: a petal floats across the screen toward the target's side. Args: y, anim, (unused). */
const AnimSweetScentPetal: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x = 0;
    sprite.y = gBattleAnimArgs[0];
  } else {
    sprite.x = DISPLAY_WIDTH;
    sprite.y = gBattleAnimArgs[0] - 30;
  }
  sprite.data[2] = gBattleAnimArgs[2];
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  sprite.callback = AnimSweetScentPetal_Step;
};

function AnimSweetScentPetal_Step(sprite: Sprite): void {
  sprite.data[0] += 3;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x += 5;
    sprite.y -= 1;
    if (sprite.x > DISPLAY_WIDTH) {
      DestroyAnimSprite(sprite); // the C goes on to set y2 on the freed sprite
      return;
    }
    sprite.y2 = Sin(sprite.data[0] & 0xff, 16);
  } else {
    sprite.x -= 5;
    sprite.y += 1;
    if (sprite.x < 0) {
      DestroyAnimSprite(sprite); // the C goes on to set y2 on the freed sprite
      return;
    }
    sprite.y2 = Cos(sprite.data[0] & 0xff, 16);
  }
}

/** AnimTask_FlailMovement (Flail): the battler rocks back and forth, the swing shrinking each time. Arg: battler. */
const AnimTask_FlailMovement: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[12] = 0x20;
  d[13] = 0x40;
  d[14] = 0x800;
  d[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareBattlerSpriteForRotScale(d[15], ST_OAM_OBJ_NORMAL);
  task.func = AnimTask_FlailMovement_Step;
};

const s16 = (v: number) => (v << 16) >> 16;

const AnimTask_FlailMovement_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      d[2] += 0x200;
      if (d[2] >= d[14]) {
        const diff = s16(d[14] - d[2]);
        const div = s16(Math.trunc(diff / (d[14] * 2)));
        const mod = s16(diff % (d[14] * 2));
        if ((div & 1) === 0) {
          d[2] = d[14] - mod;
          d[0] = 1;
        } else {
          d[2] = mod - d[14];
        }
      }
      break;
    case 1:
      d[2] -= 0x200;
      if (d[2] <= -d[14]) {
        const diff = s16(d[14] - d[2]);
        const div = s16(Math.trunc(diff / (d[14] * 2)));
        const mod = s16(diff % (d[14] * 2));
        if ((1 & div) === 0) {
          d[2] = mod - d[14];
          d[0] = 0;
        } else {
          d[2] = d[14] - mod;
        }
      }
      break;
    case 2:
      ResetSpriteRotScale(d[15]);
      DestroyAnimVisualTask(taskId);
      return;
  }
  SetSpriteRotScale(d[15], 0x100, 0x100, d[2]);
  SetBattlerSpriteYOffsetFromRotation(d[15]);
  gSprites[d[15]].x2 = -((d[2] >= 0 ? d[2] : d[2] + 63) >> 6);
  if (++d[1] > 8) {
    if (d[12]) {
      d[12]--;
      d[14] -= d[13];
      if (d[14] < 16) d[14] = 16;
    } else {
      d[0] = 2;
    }
  }
};

/** AnimPainSplitProjectile (Pain Split): a spark bounces down onto a battler. Args: x, y, battler. */
const AnimPainSplitProjectile: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    if (gBattleAnimArgs[2] === K.ANIM_ATTACKER) {
      sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    }
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    d[1] = 0x80;
    d[2] = 0x300;
    d[3] = gBattleAnimArgs[1];
    d[0]++;
  } else {
    sprite.x2 = d[1] >> 8;
    sprite.y2 += d[2] >> 8;
    if (d[4] === 0 && sprite.y2 > -d[3]) {
      d[4] = 1;
      d[2] = Math.trunc(-d[2] / 3) * 2;
    }
    d[1] += 192;
    d[2] += 128;
    if (sprite.animEnded) DestroyAnimSprite(sprite);
  }
};

/** AnimRoarNoiseLine (Growl, Roar). Args: x, y, direction (0 up, 1 down, 2 horizontal). */
const AnimRoarNoiseLine: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  if (gBattleAnimArgs[2] === 0) {
    sprite.data[0] = 0x280;
    sprite.data[1] = -0x280;
  } else if (gBattleAnimArgs[2] === 1) {
    sprite.vFlip = true;
    sprite.data[0] = 0x280;
    sprite.data[1] = 0x280;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.data[0] = 0x280;
  }
  if (isOpponent(anim.attacker)) {
    sprite.data[0] = -sprite.data[0];
    sprite.hFlip = true;
  }
  sprite.callback = AnimRoarNoiseLine_Step;
};

function AnimRoarNoiseLine_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[6] += d[0];
  d[7] += d[1];
  sprite.x2 = d[6] >> 8;
  sprite.y2 = d[7] >> 8;
  if (++d[5] === 14) DestroyAnimSprite(sprite);
}

/** AnimTask_MonToSubstitute (General_SubstituteAppear): the mon squashes away and the doll drops in */
const AnimTask_MonToSubstitute: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    PrepareBattlerSpriteForRotScale(spriteId, 0);
    d[1] = 0x100;
    d[2] = 0x100;
    d[0]++;
  } else if (d[0] === 1) {
    d[1] += 0x60;
    d[2] -= 0xd;
    SetSpriteRotScale(spriteId, d[1], d[2], 0);
    if (++d[3] === 9) {
      d[3] = 0;
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].invisible = true;
      d[0]++;
    }
  } else {
    LoadBattleMonGfxAndAnimate(anim.attacker, false, spriteId);
    d.fill(0);
    gTasks[taskId].func = AnimTask_MonToSubstituteDoll;
  }
};

const AnimTask_MonToSubstituteDoll: TaskFunc = (taskId) => {
  const s = gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)];
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      s.y2 = -200;
      s.x2 = 200;
      s.invisible = false;
      d[10] = 0;
      d[0]++;
      break;
    case 1:
      d[10] += 112;
      s.y2 += d[10] >> 8;
      if (s.y + s.y2 >= -32) s.x2 = 0;
      if (s.y2 > 0) s.y2 = 0;
      if (s.y2 === 0) {
        PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
        d[10] -= 0x800;
        d[0]++;
      }
      break;
    case 2:
      d[10] -= 112;
      if (d[10] < 0) d[10] = 0;
      s.y2 -= d[10] >> 8;
      if (d[10] === 0) d[0]++;
      break;
    case 3:
      d[10] += 112;
      s.y2 += d[10] >> 8;
      if (s.y2 > 0) s.y2 = 0;
      if (s.y2 === 0) {
        PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
};

export const effects3SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimBlackSmoke,
  AnimWhiteHalo,
  AnimTealAlert,
  AnimMeanLookEye,
  AnimSpikes,
  AnimLeer,
  AnimLetterZ,
  AnimFang,
  AnimSpotlight,
  AnimClappingHand,
  AnimClappingHand2,
  AnimRapidSpin,
  AnimTriAttackTriangle,
  AnimBatonPassPokeball,
  AnimWishStar,
  AnimMiniTwinklingStar,
  AnimSwallowBlueOrb,
  AnimGreenStar,
  AnimWeakFrustrationAngerMark,
  AnimSweetScentPetal,
  AnimPainSplitProjectile,
  AnimRoarNoiseLine,
};

export const effects3Tasks: Record<string, TaskFunc> = {
  AnimTask_SmokescreenImpact,
  AnimTask_SetPsychicBackground,
  AnimTask_FadeScreenToWhite,
  AnimTask_IsTargetPlayerSide,
  AnimTask_IsHealingMove,
  AnimTask_CreateSpotlight,
  AnimTask_RemoveSpotlight,
  AnimTask_RapinSpinMonElevation,
  AnimTask_TormentAttacker,
  AnimTask_DefenseCurlDeformMon,
  AnimTask_StockpileDeformMon,
  AnimTask_SpitUpDeformMon,
  AnimTask_SwallowDeformMon,
  AnimTask_TransformMon,
  AnimTask_IsMonInvisible,
  AnimTask_CastformGfxChange,
  AnimTask_MorningSunLightBeam,
  AnimTask_DoomDesireLightBeam,
  AnimTask_StrongFrustrationGrowAndShrink,
  AnimTask_RockMonBackAndForth,
  AnimTask_FlailMovement,
  AnimTask_MonToSubstitute,
};

export function registerEffects3ExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_SmokescreenImpact: SMOKESCREEN_GFX,
    AnimTask_MorningSunLightBeam: MORNING_SUN_GFX,
    AnimTask_DoomDesireLightBeam: MORNING_SUN_GFX,
  });
}
