// battle_anim_effects_1.c: every sprite callback and task in the file (including the unused ones), in C order.

import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_ALL,
  ClearGpuRegBits,
  DISPCNT_BG1_ON,
  DISPCNT_BG2_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  RGB,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
} from '../../gba/hw';
import {
  BeginNormalPaletteFade,
  BlendPalette,
  BlendPalettes,
  gPaletteFade,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  LoadPalette,
  OBJ_PLTT_ID,
} from '../../gba/palette';
import {
  AllocSpritePalette,
  ChangeSpriteAffineAnim,
  CreateSprite,
  CreateSpriteAndAnimate,
  DestroySprite,
  FreeSpritePaletteByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  MAX_SPRITES,
  SPRITE_SHAPE,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_VFLIP,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible } from '../battleInterface';
import { K } from '../constants';
import { g } from '../env';
import { animTable } from '../gfx';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimFastTranslateLinear,
  AnimTranslateLinear,
  ArcTan2Neg,
  BATTLE_PARTNER,
  CloneBattlerSpriteWithBlend,
  DestroyAnimSpriteAndDisableBlend,
  DestroySpriteAndMatrix,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattleMonSpritePalettesMask,
  GetBattlePalettesMask,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoord2,
  GetBattlerSpriteCoordAttr,
  GetBattlerSpriteSubpriority,
  InitAndRunAnimFastLinearTranslation,
  InitAnimArcTranslation,
  InitAnimFastLinearTranslationWithSpeed,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunStoredCallbackWhenAffineAnimEnds,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetAnimSpriteInitialXOffset,
  SetAverageBattlerPositions,
  SetBattlerSpriteYOffsetFromRotation,
  SetBattlerSpriteYOffsetFromYScale,
  SetSpriteCoordsToAnimAttackerCoords,
  SetSpriteRotScale,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TranslateSpriteLinear,
  TranslateSpriteLinearAndFlicker,
  TranslateSpriteLinearById,
  TranslateSpriteLinearFixedPoint,
  TrySetSpriteRotScale,
  WaitAnimForDuration,
} from './animMons';
import { PlaySE12WithPanning } from '../../gba/sound';
import { animSpriteTemplate, BattleAnimAdjustPanning, IsContest } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const UNIT = 'battle_anim_effects_1.c';
const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;
const s16 = (v: number) => (v << 16) >> 16;
const u8 = (v: number) => v & 0xff;
const u16 = (v: number) => v & 0xffff;
/** `(u16)gBattleAnimArgs[7] == 0xFFFF`: the script's "stop" signal */
const animArgsStop = () => gBattleAnimArgs[7] === -1;

// ------------------------------------------------------------------ powders, Solar Beam, absorb orbs

// AnimMovePowderParticle (Sleep Powder, Stun Spore, Poison Powder). Args: x, y, duration, vertical
// speed (subpixel), wave amplitude, wave speed.
const AnimMovePowderParticle: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = getBattlerSide(anim.attacker) ? -gBattleAnimArgs[4] : gBattleAnimArgs[4];
  sprite.data[4] = gBattleAnimArgs[5];
  sprite.callback = AnimMovePowderParticle_Step;
};

function AnimMovePowderParticle_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    sprite.y2 = d[2] >> 8;
    d[2] += d[1];
    sprite.x2 = Sin(d[5], d[3]);
    d[5] = (d[5] + d[4]) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimPowerAbsorptionOrb: an orb moving into the attacker. Args: x, y, duration. */
const AnimPowerAbsorptionOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

/** AnimSolarBeamBigOrb: an orb straight to the target. Args: x, y, duration, anim number. */
const AnimSolarBeamBigOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  StartSpriteAnim(sprite, gBattleAnimArgs[3]);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSolarBeamSmallOrb: a small orb circling the big ones on its way to the target. Args: x, y, duration, wave offset. */
const AnimSolarBeamSmallOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  d[5] = gBattleAnimArgs[3];
  sprite.callback = AnimSolarBeamSmallOrb_Step;
  sprite.callback(sprite);
};

function AnimSolarBeamSmallOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (AnimTranslateLinear(sprite)) {
    // DestroySprite, not DestroyAnimSprite: AnimTask_CreateSmallSolarBeamOrbs made it, not the script
    DestroySprite(sprite);
  } else {
    if (d[5] > 0x7f) sprite.subpriority = u8(GetBattlerSpriteSubpriority(anim.target) + 1);
    else sprite.subpriority = u8(GetBattlerSpriteSubpriority(anim.target) + 6);
    sprite.x2 += Sin(d[5], 5);
    sprite.y2 += Cos(d[5], 14);
    d[5] = (d[5] + 15) & 0xff;
  }
}

/** AnimTask_CreateSmallSolarBeamOrbs: 15 small orbs, one every 7 frames. */
const AnimTask_CreateSmallSolarBeamOrbs: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (--d[0] === -1) {
    d[1]++;
    d[0] = 6;
    gBattleAnimArgs[0] = 15;
    gBattleAnimArgs[1] = 0;
    gBattleAnimArgs[2] = 80;
    gBattleAnimArgs[3] = 0;
    CreateSpriteAndAnimate(animSpriteTemplate('gSolarBeamSmallOrbSpriteTemplate')!, 0, 0, GetBattlerSpriteSubpriority(anim.target) + 1);
  }
  if (d[1] === 15) DestroyAnimVisualTask(taskId);
};

/** AnimAbsorptionOrb: target -> attacker in an arc. Args: x, y, wave amplitude, duration. */
const AnimAbsorptionOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = gBattleAnimArgs[2];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimAbsorptionOrb_Step;
};

function AnimAbsorptionOrb_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimHyperBeamOrb: an orb waving towards the target, its anim, speed and wave picked at random. */
const AnimHyperBeamOrb: SpriteCallback = (sprite) => {
  const animNum = random();
  // sSolarBeamBigOrbAnimTable has 7 anims: for 7 the GBA reads the next table in ROM, sSolarBeamSmallOrbAnimTable
  if (animNum % 8 >= sprite.anims.length) sprite.anims = [...sprite.anims, ...animTable(UNIT, 'sSolarBeamSmallOrbAnimTable')];
  StartSpriteAnim(sprite, animNum % 8);
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (isOpponent(anim.attacker)) sprite.x -= 20;
  else sprite.x += 20;
  const speed = random();
  const d = sprite.data;
  d[0] = (speed & 31) + 64;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimFastLinearTranslationWithSpeed(sprite);
  d[5] = random() & 0xff;
  d[6] = sprite.subpriority;
  sprite.callback = AnimHyperBeamOrb_Step;
  sprite.callback(sprite);
};

function AnimHyperBeamOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (AnimFastTranslateLinear(sprite)) {
    DestroyAnimSprite(sprite);
  } else {
    sprite.y2 += Cos(d[5], 12);
    if (d[5] < 0x7f) sprite.subpriority = u8(d[6]);
    else sprite.subpriority = u8(d[6] + 1);
    d[5] += 24;
    d[5] &= 0xff;
  }
}

// ------------------------------------------------------------------ Leech Seed, Spore, Petal Dance, Razor Leaf

// AnimLeechSeed: a seed arcs to the target and sprouts. Args: x, y, target x, target y, duration, amplitude.
const AnimLeechSeed: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimLeechSeed_Step;
};

function AnimLeechSeed_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.invisible = true;
    sprite.data[0] = 10;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimLeechSeedSprouts);
  }
}

function AnimLeechSeedSprouts(sprite: Sprite): void {
  sprite.invisible = false;
  StartSpriteAnim(sprite, 1);
  sprite.data[0] = 60;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimSporeParticle: circles the target, passing behind it, drifting down. Args: x, y, wave offset, duration, anim number. */
const AnimSporeParticle: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  if (gBattleAnimArgs[4] === 1) sprite.oam.objMode = ST_OAM_OBJ_BLEND;
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.callback = AnimSporeParticle_Step;
  sprite.callback(sprite);
};

function AnimSporeParticle_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[1], 32);
  d[2] += 24;
  sprite.y2 = Cos(d[1], -3) + (d[2] >> 8);
  if (u16(d[1] - 0x40) < 0x80) {
    sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
  } else {
    let priority = u8(GetBattlerSpriteBGPriority(anim.target) + 1);
    if (priority > 3) priority = 3;
    sprite.oam.priority = priority;
  }
  d[1] += 2;
  d[1] &= 0xff;
  if (--d[0] === -1) DestroyAnimSprite(sprite);
}

/** AnimTask_SporeDoubleBattle: in doubles, moves the target's BG so the spores can pass behind it. */
const AnimTask_SporeDoubleBattle: TaskFunc = (taskId) => {
  if (IsContest() || !IsDoubleBattle()) {
    DestroyAnimVisualTask(taskId);
  } else {
    if (GetBattlerSpriteBGPriorityRank(anim.target) === 1) SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 3);
    else SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimPetalDanceBigFlower: circles the attacker while floating down. Args: x, y, target y offset, duration. */
const AnimPetalDanceBigFlower: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = sprite.x;
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  InitAnimLinearTranslation(sprite);
  d[5] = 0x40;
  sprite.callback = AnimPetalDanceBigFlower_Step;
  sprite.callback(sprite);
};

function AnimPetalDanceBigFlower_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[5], 32);
    sprite.y2 += Cos(d[5], -5);
    if (u16(d[5] - 0x40) < 0x80) sprite.subpriority = u8(GetBattlerSpriteSubpriority(anim.attacker) - 1);
    else sprite.subpriority = u8(GetBattlerSpriteSubpriority(anim.attacker) + 1);
    d[5] = (d[5] + 5) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimPetalDanceSmallFlower: floats down, swaying. Args: x, y, target y offset, duration. */
const AnimPetalDanceSmallFlower: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = sprite.x;
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  InitAnimLinearTranslation(sprite);
  d[5] = 0x40;
  sprite.callback = AnimPetalDanceSmallFlower_Step;
  sprite.callback(sprite);
};

function AnimPetalDanceSmallFlower_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[5], 8);
    if (u16(d[5] - 59) < 5 || u16(d[5] - 187) < 5) sprite.oam.matrixNum ^= ST_OAM_HFLIP;
    d[5] += 5;
    d[5] &= 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimRazorLeafParticle: shoots up, then floats down swaying. Args: x speed, y speed, rising frames. */
const AnimRazorLeafParticle: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[2];
  sprite.callback = AnimRazorLeafParticle_Step1;
};

function AnimRazorLeafParticle_Step1(sprite: Sprite): void {
  const d = sprite.data;
  if (!d[2]) {
    d[0] = d[1] & 1 ? 0x80 : 0;
    d[1] = 0;
    d[2] = 0;
    sprite.callback = AnimRazorLeafParticle_Step2;
  } else {
    d[2]--;
    sprite.x += d[0];
    sprite.y += d[1];
  }
}

function AnimRazorLeafParticle_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (getBattlerSide(anim.attacker)) sprite.x2 = -Sin(d[0], 25);
  else sprite.x2 = Sin(d[0], 25);
  d[0] += 2;
  d[0] &= 0xff;
  d[1]++;
  if (!(d[1] & 1)) sprite.y2++;
  if (d[1] > 80) DestroyAnimSprite(sprite);
}

/**
 * AnimTranslateLinearSingleSineWave (Razor Leaf, Magical Leaf, Swift): a line to the target with one sine
 * wave on y. Args: x, y, target x, target y, duration, wave amplitude, aim between the two foes (doubles).
 */
const AnimTranslateLinearSingleSineWave: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  if (!gBattleAnimArgs[6]) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    d[2] = p.x + gBattleAnimArgs[2];
    d[4] = p.y + gBattleAnimArgs[3];
  }
  d[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  d[0] = getBattlerSide(anim.attacker) === getBattlerSide(anim.target) ? 1 : 0;
  sprite.callback = AnimTranslateLinearSingleSineWave_Step;
};

function AnimTranslateLinearSingleSineWave_Step(sprite: Sprite): void {
  const d = sprite.data;
  let destroy = false;
  const a = d[0];
  const b = d[7];
  d[0] = 1;
  TranslateAnimHorizontalArc(sprite);
  const r0 = d[7];
  d[0] = a;
  // oam.affineParam is a spare counter here
  if (b > 200 && r0 < 56 && sprite.oam.affineParam === 0) sprite.oam.affineParam++;
  if (sprite.oam.affineParam !== 0 && d[0] !== 0) {
    sprite.invisible = !sprite.invisible;
    sprite.oam.affineParam++;
    if (sprite.oam.affineParam === 30) destroy = true;
  }
  if (
    sprite.x + sprite.x2 > DISPLAY_WIDTH + 16 ||
    sprite.x + sprite.x2 < -16 ||
    sprite.y + sprite.y2 > DISPLAY_HEIGHT ||
    sprite.y + sprite.y2 < -16
  ) {
    destroy = true;
  }
  if (destroy) DestroyAnimSprite(sprite);
}

/**
 * AnimMoveTwisterParticle (Twister; also battle_anim_rock.c's gTwisterRockSpriteTemplate): rises around
 * the target. Args: duration, total rise (0xFF: keep rising), wave speed, wave amplitude, speed-up frame.
 */
export const AnimMoveTwisterParticle: SpriteCallback = (sprite) => {
  if (!IsContest() && IsDoubleBattle()) {
    const p = SetAverageBattlerPositions(anim.target, true);
    sprite.x = p.x;
    sprite.y = p.y;
  }
  sprite.y += 32;
  const d = sprite.data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  sprite.callback = AnimMoveTwisterParticle_Step;
};

function AnimMoveTwisterParticle_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[1] === 0xff) {
    sprite.y -= 2;
  } else if (d[1] > 0) {
    sprite.y -= 2;
    d[1] -= 2;
  }
  d[5] += d[2];
  if (d[0] < d[4]) d[5] += d[2];
  d[5] &= 0xff;
  sprite.x2 = Cos(d[5], d[3]);
  sprite.y2 = Sin(d[5], 5);
  // oam.priority is a 2-bit field
  if (d[5] < 0x80) sprite.oam.priority = (GetBattlerSpriteBGPriority(anim.target) - 1) & 3;
  else sprite.oam.priority = (GetBattlerSpriteBGPriority(anim.target) + 1) & 3;
  if (--d[0] === 0) DestroyAnimSprite(sprite);
}

// AnimConstrictBinding (Constrict, Bind, Wrap): waits for gBattleAnimArgs[7] == -1, then plays its
// affine anim. Args: x, y, affine anim, repeats.
const AnimConstrictBinding: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.affineAnimPaused = true;
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[6] = gBattleAnimArgs[2];
  sprite.data[7] = gBattleAnimArgs[3];
  sprite.callback = AnimConstrictBinding_Step1;
};

function AnimConstrictBinding_Step1(sprite: Sprite): void {
  if (animArgsStop()) {
    sprite.affineAnimPaused = false;
    sprite.data[0] = 0x100;
    sprite.callback = AnimConstrictBinding_Step2;
  }
}

function AnimConstrictBinding_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (!d[2]) d[0] += 11;
  else d[0] -= 11;
  if (++d[1] === 6) {
    d[1] = 0;
    d[2] ^= 1;
  }
  if (sprite.affineAnimEnded) {
    if (--d[7] > 0) StartSpriteAffineAnim(sprite, d[6]);
    else DestroyAnimSprite(sprite);
  }
}

/** AnimTask_ShrinkTargetCopy (Mimic): the target slides and grows, then snaps back on the script's signal. Args: x speed (Q8), frames. */
const AnimTask_ShrinkTargetCopy: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  const d = gTasks[taskId].data;
  if (gSprites[spriteId].invisible) {
    DestroyAnimVisualTask(taskId);
  } else {
    PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_BLEND);
    d[0] = gBattleAnimArgs[0];
    d[1] = gBattleAnimArgs[1];
    d[11] = 0x100;
    gTasks[taskId].func = AnimTask_DuplicateAndShrinkToPos_Step1;
  }
};

const AnimTask_DuplicateAndShrinkToPos_Step1: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  const d = gTasks[taskId].data;
  d[10] += d[0];
  gSprites[spriteId].x2 = d[10] >> 8;
  if (isOpponent(anim.target)) gSprites[spriteId].x2 = -gSprites[spriteId].x2;
  d[11] += 16;
  SetSpriteRotScale(spriteId, d[11], d[11], 0);
  SetBattlerSpriteYOffsetFromYScale(spriteId);
  if (--d[1] === 0) {
    d[0] = 0;
    gTasks[taskId].func = AnimTask_DuplicateAndShrinkToPos_Step2;
  }
};

const AnimTask_DuplicateAndShrinkToPos_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (animArgsStop()) {
    if (d[0] === 0) {
      const spriteId = GetAnimBattlerSpriteId(K.ANIM_TARGET);
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].y2 = gSprites[spriteId].x2 = 0;
      d[0]++;
      return;
    }
  } else if (d[0] === 0) {
    return;
  }
  d[0]++;
  if (d[0] === 3) DestroyAnimVisualTask(taskId);
};

/** AnimMimicOrb: appears on the target, then flies to the attacker. Args: x, y. */
const AnimMimicOrb: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) gBattleAnimArgs[0] *= -1;
      sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
      sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
      sprite.invisible = true;
      d[0]++;
      break;
    case 1:
      sprite.invisible = false;
      if (sprite.affineAnimEnded) {
        ChangeSpriteAffineAnim(sprite, 1);
        d[0] = 25;
        d[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
        d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
        sprite.callback = InitAndRunAnimFastLinearTranslation;
        StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
      }
      break;
  }
};

// ------------------------------------------------------------------ Ingrain, Frenzy Plant

/** AnimIngrainRoot: a root under the attacker that flickers out. Args: x, y, subpriority offset, anim number, duration. */
const AnimIngrainRoot: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
    sprite.x2 = gBattleAnimArgs[0];
    sprite.y2 = gBattleAnimArgs[1];
    sprite.subpriority = u8(gBattleAnimArgs[2] + 30);
    StartSpriteAnim(sprite, gBattleAnimArgs[3]);
    d[2] = gBattleAnimArgs[4];
    d[0]++;
    if (sprite.y + sprite.y2 > 120) sprite.y = s16(sprite.y + sprite.y2 + sprite.y - 120);
  }
  sprite.callback = AnimRootFlickerOut;
};

/**
 * AnimFrenzyPlantRoot: a root part of the way from the attacker to the target, flickering out. Args: percent
 * of the way, x, y, subpriority offset, anim number, duration. (The C also writes the positions to the
 * never-read sFrenzyPlantRootData.)
 */
const AnimFrenzyPlantRoot: SpriteCallback = (sprite) => {
  const attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  const attackerY = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const targetX = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) - attackerX);
  const targetY = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) - attackerY);
  sprite.x = s16(attackerX + Math.trunc((targetX * gBattleAnimArgs[0]) / 100));
  sprite.y = s16(attackerY + Math.trunc((targetY * gBattleAnimArgs[0]) / 100));
  sprite.x2 = gBattleAnimArgs[1];
  sprite.y2 = gBattleAnimArgs[2];
  sprite.subpriority = u8(gBattleAnimArgs[3] + 30);
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  sprite.data[2] = gBattleAnimArgs[5];
  sprite.callback = AnimRootFlickerOut;
};

function AnimRootFlickerOut(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] > d[2] - 10) sprite.invisible = d[0] % 2 !== 0;
  if (d[0] > d[2]) DestroyAnimSprite(sprite);
}

/** AnimIngrainOrb: a fast wavy line. Args: x, y, x speed, wave amplitude, duration. */
const AnimIngrainOrb: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
    d[1] = gBattleAnimArgs[2];
    d[2] = gBattleAnimArgs[3];
    d[3] = gBattleAnimArgs[4];
  }
  d[0]++;
  sprite.x2 = s16(d[1] * d[0]);
  sprite.y2 = Sin((d[0] * 20) & 0xff, d[2]);
  if (d[0] > d[3]) DestroyAnimSprite(sprite);
};

// ------------------------------------------------------------------ item bags (Present, Knock Off, Thief, Trick)

/** InitItemBagData: packs start (x, y), end (data[6], data[7]) and duration into data[5..7] */
function InitItemBagData(sprite: Sprite, c: number): void {
  const d = sprite.data;
  const a = (sprite.x << 8) | sprite.y;
  const b = (d[6] << 8) | d[7];
  d[5] = a;
  d[6] = b;
  d[7] = s16(c) << 8;
}

/** MoveAlongLinearPath: one step from the packed start to end (InitItemBagData); true when done */
export function MoveAlongLinearPath(sprite: Sprite): boolean {
  const d = sprite.data;
  const xStartPos = u8(d[5] >> 8);
  const yStartPos = u8(d[5]);
  let xEndPos = u8(d[6] >> 8);
  const yEndPos = u8(d[6]);
  const totalTime = d[7] >> 8;
  let currentTime = d[7] & 0xff;
  if (xEndPos === 0) xEndPos = -32;
  else if (xEndPos === 255) xEndPos = DISPLAY_WIDTH + 32;
  const yEndPos2 = s16(yEndPos - yStartPos);
  const r0 = s16(xEndPos - xStartPos);
  const var1 = Math.trunc((r0 * currentTime) / totalTime);
  const vaxEndPos = Math.trunc((yEndPos2 * currentTime) / totalTime);
  sprite.x = s16(var1 + xStartPos);
  sprite.y = s16(vaxEndPos + yStartPos);
  if (++currentTime === totalTime) return true;
  d[7] = (totalTime << 8) | currentTime;
  return false;
}

function AnimItemSteal_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 10) StartSpriteAffineAnim(sprite, 1);
  d[0]++;
  if (d[0] > 50) DestroyAnimSprite(sprite);
}

function AnimItemSteal_Step1(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += Math.trunc((d[3] * 128) / d[4]);
  if (d[0] >= 128) {
    d[1]++;
    d[0] = 0;
  }
  sprite.y2 = Sin(d[0] + 128, 30 - d[1] * 8);
  if (MoveAlongLinearPath(sprite)) {
    sprite.y2 = 0;
    d[0] = 0;
    sprite.callback = AnimItemSteal_Step2;
  }
}

/** AnimPresent: the present bounces from the attacker to the target. Args: x, y. */
const AnimPresent: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  const targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  const targetY = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  const d = sprite.data;
  d[6] = targetX;
  d[7] = targetY + 10;
  InitItemBagData(sprite, 60);
  d[3] = BATTLE_PARTNER(anim.attacker) === anim.target ? 1 : 3;
  d[4] = 60;
  sprite.callback = AnimItemSteal_Step1;
};

function AnimKnockOffOpponentsItem(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += Math.trunc((d[3] * 128) / d[4]);
  if (d[0] > 0x7f) {
    d[1]++;
    d[0] = 0;
  }
  sprite.y2 = Sin(d[0] + 0x80, 30 - d[1] * 8);
  if (MoveAlongLinearPath(sprite)) {
    sprite.y2 = 0;
    d[0] = 0;
    DestroyAnimSprite(sprite);
  }
}

/** AnimKnockOffItem (General_ItemKnockoff): the item bounces off the target, out of the screen. */
const AnimKnockOffItem: SpriteCallback = (sprite) => {
  const targetY = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  const d = sprite.data;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    d[6] = 0;
    d[7] = targetY + 10;
    InitItemBagData(sprite, 40);
    d[3] = 3;
    d[4] = 60;
    sprite.callback = AnimItemSteal_Step1;
  } else {
    d[6] = 255;
    d[7] = targetY + 10;
    if (IsContest()) d[6] = 0;
    InitItemBagData(sprite, 40);
    d[3] = 3;
    d[4] = 60;
    sprite.callback = AnimKnockOffOpponentsItem;
  }
};

/** AnimPresentHealParticle: a heal particle rising off the target. Args: x, y, y speed, (unused). */
const AnimPresentHealParticle: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    InitSpritePosToAnimTarget(sprite, false);
    d[1] = gBattleAnimArgs[2];
  }
  d[0]++;
  sprite.y2 = s16(d[1] * d[0]);
  if (sprite.animEnded) DestroyAnimSprite(sprite);
};

/** AnimItemSteal (General_ItemSteal, Thief, Covet): the item bounces from the target to the attacker. Args: x, y. */
const AnimItemSteal: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  const attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
  const attackerY = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
  const d = sprite.data;
  d[6] = attackerX;
  d[7] = attackerY + 10;
  InitItemBagData(sprite, 60);
  d[3] = BATTLE_PARTNER(anim.target) === anim.attacker ? 1 : 3;
  d[4] = 60;
  sprite.callback = AnimItemSteal_Step3;
};

function AnimItemSteal_Step3(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += Math.trunc((d[3] * 128) / d[4]);
  if (d[0] > 127) {
    d[1]++;
    d[0] = 0;
  }
  sprite.y2 = Sin(d[0] + 0x80, 30 - d[1] * 8);
  if (sprite.y2 === 0) PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
  if (MoveAlongLinearPath(sprite)) {
    sprite.y2 = 0;
    d[0] = 0;
    sprite.callback = AnimItemSteal_Step2;
    PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
  }
}

/** gTrickBagCoordinates: {angle step, frames, direction}, ending at direction 127 */
const gTrickBagCoordinates = [
  [5, 24, 1],
  [0, 4, 0],
  [8, 16, -1],
  [0, 2, 0],
  [8, 16, 1],
  [0, 2, 0],
  [8, 16, 1],
  [0, 2, 0],
  [8, 16, 1],
  [0, 16, 0],
  [0, 0, 127],
];

/** AnimTrickBag (Trick): a bag drops in, then circles over the field. Args: y, wave offset. */
const AnimTrickBag: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    if (!IsContest()) {
      d[1] = gBattleAnimArgs[1];
      sprite.x = 120;
    } else {
      const a = gBattleAnimArgs[1] - 32;
      const b = a < 0 ? gBattleAnimArgs[1] + 0xdf : a;
      d[1] = a - ((b >> 8) << 8);
      sprite.x = 70;
    }
    sprite.y = gBattleAnimArgs[0];
    d[2] = gBattleAnimArgs[0];
    d[4] = 20;
    sprite.x2 = Cos(d[1], 60);
    sprite.y2 = Sin(d[1], 20);
    sprite.callback = AnimTrickBag_Step1;
    sprite.subpriority = d[1] > 0 && d[1] < 192 ? 31 : 29;
  }
};

function AnimTrickBag_Step1(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[3]) {
    case 0:
      if (d[2] > 78) {
        d[3] = 1;
        StartSpriteAffineAnim(sprite, 1);
      } else {
        d[2] += Math.trunc(d[4] / 10);
        d[4] += 3;
        sprite.y = d[2];
      }
      break;
    case 1:
      if (d[3] && sprite.affineAnimEnded) {
        d[0] = 0;
        d[2] = 0;
        sprite.callback = AnimTrickBag_Step2;
      }
      break;
  }
}

function AnimTrickBag_Step2(sprite: Sprite): void {
  const d = sprite.data;
  const c = gTrickBagCoordinates[d[0]];
  if (d[2] === c[1]) {
    if (c[2] === 127) {
      d[0] = 0;
      sprite.callback = AnimTrickBag_Step3;
    }
    d[2] = 0;
    d[0]++;
  } else {
    d[2]++;
    d[1] = (c[0] * c[2] + d[1]) & 0xff;
    if (!IsContest()) sprite.subpriority = u16(d[1] - 1) < 191 ? 31 : 29;
    sprite.x2 = Cos(d[1], 60);
    sprite.y2 = Sin(d[1], 20);
  }
}

function AnimTrickBag_Step3(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 20) {
    // (the C goes on to write to the destroyed sprite; DestroySprite resets ours, so stop here)
    DestroyAnimSprite(sprite);
    return;
  }
  sprite.invisible = d[0] % 2 !== 0;
  d[0]++;
}

// ------------------------------------------------------------------ Leaf Blade

/** AnimTask_LeafBlade: a leaf slashes around the target in arcs, leaving a flickering trail. */
const AnimTask_LeafBlade: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[4] = GetBattlerSpriteSubpriority(anim.target) - 1;
  d[6] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[7] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[10] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_WIDTH);
  d[11] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_HEIGHT);
  d[5] = getBattlerSide(anim.target) === K.B_SIDE_OPPONENT ? 1 : -1;
  d[9] = 56 - d[5] * 64;
  d[8] = d[7] - d[9] + d[6];
  d[2] = CreateSprite(animSpriteTemplate('gLeafBladeSpriteTemplate')!, d[8], d[9], u8(d[4]));
  // (with no free sprite the C destroys the task but goes on to set up the spare gSprites[MAX_SPRITES])
  if (d[2] === MAX_SPRITES) DestroyAnimVisualTask(taskId);
  const s = gSprites[d[2]];
  s.data[0] = 10;
  s.data[1] = d[8];
  s.data[2] = d[6] - (Math.trunc(d[10] / 2) + 10) * d[5];
  s.data[3] = d[9];
  s.data[4] = d[7] + (Math.trunc(d[11] / 2) + 10) * d[5];
  s.data[5] = LeafBladeGetPosFactor(s);
  InitAnimArcTranslation(s);
  task.func = AnimTask_LeafBlade_Step;
};

/** One arc of the leaf: from where it is to (x, y), with anim `animNum`; data[4] (subpriority) moved by `subDelta`. */
function leafBladeNextArc(task: Task, sprite: Sprite, x: number, y: number, subDelta: number, animNum: number): void {
  const d = task.data;
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
  sprite.data[0] = 10;
  sprite.data[1] = sprite.x;
  sprite.data[2] = x;
  sprite.data[3] = sprite.y;
  sprite.data[4] = y;
  sprite.data[5] = LeafBladeGetPosFactor(sprite);
  d[4] += subDelta;
  d[3] = animNum;
  sprite.subpriority = u8(d[4]);
  StartSpriteAnim(sprite, d[3]);
  InitAnimArcTranslation(sprite);
  d[0]++;
}

const AnimTask_LeafBlade_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const sprite = gSprites[d[2]];
  const a = d[0];
  const halfW = Math.trunc(d[10] / 2) + 10;
  const halfH = Math.trunc(d[11] / 2) + 10;
  // the arcing states: on landing, pause (state 0xFF) then go to the next state
  const arc = (next: number) => {
    AnimTask_LeafBlade_Step2(task, taskId);
    if (TranslateAnimHorizontalArc(sprite)) {
      d[15] = next;
      d[0] = 0xff;
    }
  };
  switch (a) {
    case 4:
      arc(5);
      break;
    case 8:
      arc(9);
      break;
    case 0:
      arc(1);
      break;
    case 1:
      leafBladeNextArc(task, sprite, d[6], d[7], 2, a);
      break;
    case 2:
      arc(3);
      break;
    case 3:
      leafBladeNextArc(task, sprite, d[6] - halfW * d[5], d[7] - halfH * d[5], 0, 2);
      break;
    case 5:
      leafBladeNextArc(task, sprite, d[6] + halfW * d[5], d[7] + halfH * d[5], -2, 3);
      break;
    case 6:
      arc(7);
      break;
    case 7:
      leafBladeNextArc(task, sprite, d[6], d[7], 2, 4);
      break;
    case 9:
      leafBladeNextArc(task, sprite, d[6] - halfW * d[5], d[7] + halfH * d[5], 0, 5);
      break;
    case 10:
      arc(11);
      break;
    case 11:
      leafBladeNextArc(task, sprite, d[8], d[9], -2, 6);
      break;
    case 12:
      AnimTask_LeafBlade_Step2(task, taskId);
      if (TranslateAnimHorizontalArc(sprite)) {
        DestroySprite(sprite);
        d[0]++;
      }
      break;
    case 13:
      if (d[12] === 0) DestroyAnimVisualTask(taskId);
      break;
    case 0xff:
      if (++d[1] > 5) {
        d[1] = 0;
        d[0] = d[15];
      }
      break;
  }
};

function LeafBladeGetPosFactor(sprite: Sprite): number {
  return sprite.data[4] < sprite.y ? -8 : 8;
}

/** AnimTask_LeafBlade_Step2: drops a flickering copy of the leaf where it is (data[12] counts them) */
function AnimTask_LeafBlade_Step2(task: Task, taskId: number): void {
  const d = task.data;
  d[14]++;
  if (d[14] > 0) {
    d[14] = 0;
    const leaf = gSprites[d[2]];
    const spriteX = s16(leaf.x + leaf.x2);
    const spriteY = s16(leaf.y + leaf.y2);
    const spriteId = CreateSprite(animSpriteTemplate('gLeafBladeSpriteTemplate')!, spriteX, spriteY, u8(d[4]));
    if (spriteId !== MAX_SPRITES) {
      const s = gSprites[spriteId];
      s.data[6] = taskId;
      s.data[7] = 12;
      d[12]++;
      s.data[0] = d[13] & 1;
      d[13]++;
      StartSpriteAnim(s, d[3]);
      s.subpriority = u8(d[4]);
      s.callback = AnimTask_LeafBlade_Step2_Callback;
    }
  }
}

function AnimTask_LeafBlade_Step2_Callback(sprite: Sprite): void {
  const d = sprite.data;
  d[0]++;
  if (d[0] > 1) {
    d[0] = 0;
    sprite.invisible = !sprite.invisible;
    d[1]++;
    if (d[1] > 8) {
      gTasks[d[6]].data[d[7]]--;
      DestroySprite(sprite);
    }
  }
}

// ------------------------------------------------------------------ Aromatherapy / Silver Wind, Magical Leaf, Needle Arm

/**
 * AnimFlyingParticle (Aromatherapy, Silver Wind): flies across the screen on a sine wave. Args: y, wave
 * amplitude, wave offset, x speed, wave speed, y mode (0-1 absolute, 2-3 relative to a mon), battler.
 */
const AnimFlyingParticle: SpriteCallback = (sprite) => {
  const battler = !gBattleAnimArgs[6] ? anim.attacker : anim.target;
  const d = sprite.data;
  if (isOpponent(battler)) {
    d[4] = 0;
    d[2] = gBattleAnimArgs[3];
    sprite.x = -16; // 0xFFF0
  } else {
    d[4] = 1;
    d[2] = -gBattleAnimArgs[3];
    sprite.x = 0x100;
  }
  d[1] = gBattleAnimArgs[1];
  d[0] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[4];
  switch (gBattleAnimArgs[5]) {
    case 0:
      sprite.y = gBattleAnimArgs[0];
      sprite.oam.priority = GetBattlerSpriteBGPriority(battler);
      break;
    case 1:
      sprite.y = gBattleAnimArgs[0];
      sprite.oam.priority = (GetBattlerSpriteBGPriority(battler) + 1) & 3;
      break;
    case 2:
      sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[0];
      sprite.oam.priority = GetBattlerSpriteBGPriority(battler);
      break;
    case 3:
      sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[0];
      sprite.oam.priority = (GetBattlerSpriteBGPriority(battler) + 1) & 3;
      break;
  }
  sprite.callback = AnimFlyingParticle_Step;
};

function AnimFlyingParticle_Step(sprite: Sprite): void {
  const d = sprite.data;
  const a = d[7];
  d[7]++;
  sprite.y2 = s16((d[1] * gSineTable(d[0])) >> 8);
  sprite.x2 = s16(d[2] * a);
  d[0] = (d[3] * a) & 0xff;
  if (!d[4]) {
    if (sprite.x2 + sprite.x <= 0xf7) return;
  } else if (sprite.x2 + sprite.x > -16) {
    return;
  }
  DestroySpriteAndMatrix(sprite);
}

const sMagicalLeafBlendColors = [RGB(31, 0, 0), RGB(31, 19, 0), RGB(31, 31, 0), RGB(0, 31, 0), RGB(5, 14, 31), RGB(22, 10, 31), RGB(22, 21, 31)];

/** AnimTask_CycleMagicalLeafPal: blends the leaf palettes through a rainbow until gBattleAnimArgs[7] is -1. */
const AnimTask_CycleMagicalLeafPal: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      d[8] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(K.ANIM_TAG_LEAF));
      d[12] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(K.ANIM_TAG_RAZOR_LEAF));
      d[0]++;
      break;
    case 1:
      if (++d[9] >= 0) {
        d[9] = 0;
        BlendPalette(d[8], 16, d[10], sMagicalLeafBlendColors[d[11]]);
        BlendPalette(d[12], 16, d[10], sMagicalLeafBlendColors[d[11]]);
        if (++d[10] === 17) {
          d[10] = 0;
          if (++d[11] === 7) d[11] = 0;
        }
      }
      break;
  }
  if (gBattleAnimArgs[7] === -1) DestroyAnimVisualTask(taskId);
};

/** AnimNeedleArmSpike: a spike flying into or out of a mon, rotated along its path. Args: battler, inwards (0) / outwards, x, y, duration. */
const AnimNeedleArmSpike: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[4] === 0) {
    DestroyAnimSprite(sprite);
    return;
  }
  let a: number, b: number;
  if (gBattleAnimArgs[0] === 0) {
    a = u8(GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2));
    b = u8(GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET));
  } else {
    a = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2));
    b = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET));
  }
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  if (gBattleAnimArgs[1] === 0) {
    sprite.x = gBattleAnimArgs[2] + a;
    sprite.y = gBattleAnimArgs[3] + b;
    d[5] = a;
    d[6] = b;
  } else {
    sprite.x = a;
    sprite.y = b;
    d[5] = gBattleAnimArgs[2] + a;
    d[6] = gBattleAnimArgs[3] + b;
  }
  const x = u16(sprite.x);
  d[1] = x * 16;
  const y = u16(sprite.y);
  d[2] = y * 16;
  d[3] = Math.trunc(((d[5] - sprite.x) * 16) / gBattleAnimArgs[4]);
  d[4] = Math.trunc(((d[6] - sprite.y) * 16) / gBattleAnimArgs[4]);
  let c = ArcTan2Neg(s16(d[5] - x), s16(d[6] - y));
  if (IsContest()) c = u16(c - 0x8000);
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, c);
  sprite.callback = AnimNeedleArmSpike_Step;
};

function AnimNeedleArmSpike_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0]) {
    d[1] += d[3];
    d[2] += d[4];
    sprite.x = d[1] >> 4;
    sprite.y = d[2] >> 4;
    d[0]--;
  } else {
    DestroySpriteAndMatrix(sprite);
  }
}

// ------------------------------------------------------------------ hits, slices

function AnimWhipHit_WaitEnd(sprite: Sprite): void {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimSlidingHit (sSlidingHit1/2SpriteTemplate, unused): plays its anim at an offset. Args: x, y. */
const AnimSlidingHit: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimWhipHit (Vine Whip, Slam). Args: x, y. */
const AnimWhipHit: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = AnimWhipHit_WaitEnd;
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
};

/** AnimFlickeringPunch (sFlickeringPunchSpriteTemplate, unused). Args: x, y, then TranslateSpriteLinearAndFlicker's, affine anim. */
const AnimFlickeringPunch: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.data[5] = gBattleAnimArgs[5];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[6]);
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteLinearAndFlicker;
};

/** AnimCuttingSlice (Cut): an arcing slice over the target. Args: x, y, flipped. */
const AnimCuttingSlice: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  initSlice(sprite);
};

/** AnimAirCutterSlice: AnimCuttingSlice on the target (0), its partner (1) or between them (2). Args: x, y, flipped, which. */
const AnimAirCutterSlice: SpriteCallback = (sprite) => {
  let a: number, b: number;
  switch (gBattleAnimArgs[3]) {
    case 1:
      a = u8(GetBattlerSpriteCoord(BATTLE_PARTNER(anim.target), K.BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(BATTLE_PARTNER(anim.target), K.BATTLER_COORD_Y));
      break;
    case 2:
      a = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y));
      if (IsBattlerSpriteVisible(BATTLE_PARTNER(anim.target))) {
        a = u8(Math.trunc((GetBattlerSpriteCoord(BATTLE_PARTNER(anim.target), K.BATTLER_COORD_X) + a) / 2));
        b = u8(Math.trunc((GetBattlerSpriteCoord(BATTLE_PARTNER(anim.target), K.BATTLER_COORD_Y) + b) / 2));
      }
      break;
    default:
      a = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X));
      b = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y));
      break;
  }
  sprite.x = a;
  sprite.y = b;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  initSlice(sprite);
};

/** The tail AnimCuttingSlice and AnimAirCutterSlice share */
function initSlice(sprite: Sprite): void {
  sprite.callback = AnimSlice_Step;
  if (gBattleAnimArgs[2] === 0) {
    sprite.x += gBattleAnimArgs[0];
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.hFlip = true;
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] -= 0x400;
  sprite.data[2] += 0x400;
  sprite.data[5] = gBattleAnimArgs[2];
  if (sprite.data[5] === 1) sprite.data[1] = -sprite.data[1];
}

function AnimSlice_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  if (d[5] === 0) d[1] += 0x18;
  else d[1] -= 0x18;
  d[2] -= 0x18;
  sprite.x2 = d[3] >> 8;
  sprite.y2 = d[4] >> 8;
  d[0]++;
  if (d[0] === 20) {
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
    d[0] = 3;
    sprite.callback = WaitAnimForDuration;
  }
}

/** UnusedFlickerAnim: flickers itself and the sprites in data[0], data[1], then destroys all three. */
const UnusedFlickerAnim: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[2] > 1) {
    const invisible = !(d[3] & 1);
    sprite.invisible = invisible;
    gSprites[d[0]].invisible = invisible;
    gSprites[d[1]].invisible = invisible;
    d[2] = 0;
    d[3]++;
  } else {
    d[2]++;
  }
  if (d[3] === 10) {
    DestroySprite(gSprites[d[0]]);
    DestroySprite(gSprites[d[1]]);
    DestroyAnimSprite(sprite);
  }
};

// ------------------------------------------------------------------ music notes (unused), Protect, Milk Drink

/** AnimCirclingMusicNote (sCirclingMusicNoteSpriteTemplate, unused). Args: x, y, angle, angle speed, duration, anim number. */
const AnimCirclingMusicNote: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  StartSpriteAnim(sprite, gBattleAnimArgs[5]);
  d[1] = -gBattleAnimArgs[3];
  sprite.y += gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[4];
  sprite.callback = AnimCirclingMusicNote_Step;
  sprite.callback(sprite);
};

function AnimCirclingMusicNote_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Cos(d[0], 100);
  sprite.y2 = Sin(d[0], 20);
  sprite.subpriority = d[0] < 128 ? 0 : 14;
  d[0] = (d[0] + d[1]) & 0xff;
  d[5] += 0x82;
  sprite.y2 += d[5] >> 8;
  d[2]++;
  if (d[2] === d[3]) DestroyAnimSprite(sprite);
}

/** AnimProtect: the shield fades in over the attacker, its colours cycling, then fades out. Args: x, y, duration. */
const AnimProtect: SpriteCallback = (sprite) => {
  if (IsContest()) gBattleAnimArgs[1] += 8;
  sprite.x = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord2(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER || IsContest()) sprite.oam.priority = (GetBattlerSpriteBGPriority(anim.attacker) + 1) & 3;
  else sprite.oam.priority = GetBattlerSpriteBGPriority(anim.attacker);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[2] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(K.ANIM_TAG_PROTECT));
  d[7] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[7], d[7]));
  sprite.callback = AnimProtect_Step;
};

function AnimProtect_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[5] += 96;
  sprite.x2 = -(d[5] >> 8);
  if (++d[1] > 1) {
    d[1] = 0;
    // rotate colours 1-7 of the shield's palette
    const savedPal = gPlttBufferFaded[d[2] + 1];
    for (let i = 1; i <= 6; i++) gPlttBufferFaded[d[2] + i] = gPlttBufferFaded[d[2] + i + 1];
    gPlttBufferFaded[d[2] + 7] = savedPal;
  }
  if (d[7] > 6 && d[0] > 0 && ++d[6] > 1) {
    d[6] = 0;
    d[7] -= 1;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[7], d[7]));
  }
  if (d[0] > 0) {
    d[0] -= 1;
  } else if (++d[6] > 1) {
    d[6] = 0;
    d[7]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[7], d[7]));
    if (d[7] === 16) {
      sprite.invisible = true;
      sprite.callback = DestroyAnimSpriteAndDisableBlend;
    }
  }
}

/** AnimMilkBottle (Milk Drink): fades in over the target, tips and wobbles, fades out. */
const AnimMilkBottle: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.y = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + 0xffe8);
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[4] = 0;
  d[6] = 0;
  d[7] = 16;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], d[7]));
  sprite.callback = AnimMilkBottle_Step1;
};

function AnimMilkBottle_Step1(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      if (++d[2] > 0) {
        d[2] = 0;
        if ((++d[1] & 1) !== 0) {
          if (d[6] <= 15) d[6]++;
        } else if (d[7] > 0) {
          d[7]--;
        }
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], d[7]));
        if (d[6] === 16 && d[7] === 0) {
          d[1] = 0;
          d[0]++;
        }
      }
      break;
    case 1:
      if (++d[1] > 8) {
        d[1] = 0;
        StartSpriteAffineAnim(sprite, 1);
        d[0]++;
      }
      break;
    case 2:
      AnimMilkBottle_Step2(sprite);
      if (++d[1] > 2) {
        d[1] = 0;
        sprite.y++;
      }
      if (++d[2] <= 29) break;
      if (d[2] & 1) {
        if (d[6] > 0) d[6]--;
      } else if (d[7] <= 15) {
        d[7]++;
      }
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], d[7]));
      if (d[6] === 0 && d[7] === 16) {
        d[1] = 0;
        d[2] = 0;
        d[0]++;
      }
      break;
    case 3:
      sprite.invisible = true;
      d[0]++;
      break;
    case 4:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0));
      DestroyAnimSprite(sprite);
      break;
  }
}

/** AnimMilkBottle_Step2: the wobble (the C's two extra arguments are unused) */
function AnimMilkBottle_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3] <= 11) d[4] += 2;
  if (u16(d[3] - 0x12) <= 0x17) d[4] -= 2;
  if (d[3] > 0x2f) d[4] += 2;
  sprite.x2 = Math.trunc(d[4] / 9);
  sprite.y2 = Math.trunc(d[4] / 14);
  if (sprite.y2 < 0) sprite.y2 *= -1;
  d[3]++;
  if (d[3] > 0x3b) d[3] = 0;
}

// ------------------------------------------------------------------ stars, bubbles, Z

/** AnimGrantingStars (Focus Energy, Wish heal): linear drift. Args: x, y, attacker coords (0) or as-is, x speed, y speed, duration. */
const AnimGrantingStars: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[5];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearFixedPoint;
};

/**
 * AnimSparklingStars: AnimGrantingStars on a battler (or between it and its partner in doubles). Args: x,
 * y, battler, x speed, y speed, duration, use pic-offset coords.
 */
const AnimSparklingStars: SpriteCallback = (sprite) => {
  const battler = !gBattleAnimArgs[2] ? anim.attacker : anim.target;
  if (IsDoubleBattle() && IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) {
    const p = SetAverageBattlerPositions(battler, !!gBattleAnimArgs[6]);
    sprite.x = p.x;
    sprite.y = p.y;
    SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
    sprite.y += gBattleAnimArgs[1];
  } else {
    if (!gBattleAnimArgs[6]) {
      sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
      sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
    } else {
      sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
    }
    SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  }
  sprite.data[0] = gBattleAnimArgs[5];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearFixedPoint;
};

/** AnimBubbleBurst (sBubbleBurstSpriteTemplate, unused). Args: x, y. */
const AnimBubbleBurst: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    StartSpriteAnim(sprite, 1);
  }
  sprite.callback = AnimBubbleBurst_Step;
};

function AnimBubbleBurst_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] > 30) {
    sprite.y2 = Math.trunc((30 - d[0]) / 3);
    sprite.x2 = Sin(d[1] * 4, 3);
    d[1]++;
  }
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimSleepLetterZ (Status_Sleep, Rest). Args: x, y. */
const AnimSleepLetterZ: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = 1;
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = -1; // 0xFFFF
    StartSpriteAffineAnim(sprite, 1);
  }
  sprite.callback = AnimSleepLetterZ_Step;
};

function AnimSleepLetterZ_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.y2 = -Math.trunc(d[0] / 0x28);
  sprite.x2 = Math.trunc(d[4] / 10);
  d[4] += d[3] * 2;
  d[0] += d[1];
  if (++d[1] > 60) DestroySpriteAndMatrix(sprite);
}

// ------------------------------------------------------------------ Lock-On

/** sInclineMonCoordTable: the reticle's four jumps */
const sInclineMonCoordTable = [
  [64, 64],
  [0, -64],
  [-64, 64],
  [32, -32],
];

/** AnimLockOnTarget: the reticle jumps about, closes in on the target, flashes the field and blinks out on the script's signal. */
const AnimLockOnTarget: SpriteCallback = (sprite) => {
  sprite.x -= 32;
  sprite.y -= 32;
  sprite.data[0] = 20;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step1);
};

function AnimLockOnTarget_Step1(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[5] & 1) {
    case 0:
      d[0] = 1;
      sprite.callback = WaitAnimForDuration;
      StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step1);
      break;
    case 1:
      sprite.x += sprite.x2;
      sprite.y += sprite.y2;
      sprite.y2 = 0;
      sprite.x2 = 0;
      d[0] = 8;
      d[2] = sprite.x + sInclineMonCoordTable[d[5] >> 8][0];
      d[4] = sprite.y + sInclineMonCoordTable[d[5] >> 8][1];
      sprite.callback = StartAnimLinearTranslation;
      StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step2);
      d[5] += 0x100;
      PlaySE12WithPanning(K.SE_M_LOCK_ON, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
      break;
  }
  d[5] ^= 1;
}

function AnimLockOnTarget_Step2(sprite: Sprite): void {
  if (sprite.data[5] >> 8 === 4) {
    sprite.data[0] = 10;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step3);
  } else {
    sprite.callback = AnimLockOnTarget_Step1;
  }
}

function AnimLockOnTarget_Step3(sprite: Sprite): void {
  const d = sprite.data;
  // oam.affineParam: which corner (AnimLockOnMoveTarget), 0 for the centre reticle
  if (sprite.oam.affineParam === 0) {
    d[0] = 3;
    d[1] = 0;
    d[2] = 0;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step4);
  } else {
    let a: number, b: number;
    switch (sprite.oam.affineParam) {
      case 1:
        a = -8;
        b = -8;
        break;
      case 2:
        a = -8;
        b = 8;
        break;
      case 3:
        a = 8;
        b = -8;
        break;
      default:
        a = 8;
        b = 8;
        break;
    }
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    d[0] = 6;
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + a;
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + b;
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, AnimLockOnTarget_Step5);
  }
}

function AnimLockOnTarget_Step4(sprite: Sprite): void {
  const d = sprite.data;
  if (d[2] === 0) {
    if ((d[1] += 3) > 16) d[1] = 16;
  } else if ((d[1] -= 3) < 0) {
    d[1] = 0;
  }
  BlendPalettes(GetBattlePalettesMask(true, true, true, true, true, false, false), d[1], RGB_WHITE);
  if (d[1] === 16) {
    d[2]++;
    const base = OBJ_PLTT_ID(sprite.oam.paletteNum);
    LoadPalette(gPlttBufferUnfaded.slice(base + 8, base + 10), base + 1, 2 * 2); // PLTT_SIZEOF(2)
    PlaySE12WithPanning(K.SE_M_LEER, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
  } else if (d[1] === 0) {
    sprite.callback = AnimLockOnTarget_Step5;
  }
}

function AnimLockOnTarget_Step5(sprite: Sprite): void {
  if (animArgsStop()) {
    sprite.data[1] = 0;
    sprite.data[0] = 0;
    sprite.callback = AnimLockOnTarget_Step6;
  }
}

function AnimLockOnTarget_Step6(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] % 3 === 0) {
    d[1]++;
    sprite.invisible = !sprite.invisible;
  }
  d[0]++;
  if (d[1] === 8) DestroyAnimSprite(sprite);
}

/** AnimLockOnMoveTarget: one of the four corner pieces. Arg 0: corner (1-4). */
const AnimLockOnMoveTarget: SpriteCallback = (sprite) => {
  sprite.oam.affineParam = u16(gBattleAnimArgs[0]);
  const corner = s16(sprite.oam.affineParam);
  if (corner === 1) {
    sprite.x -= 0x18;
    sprite.y -= 0x18;
  } else if (corner === 2) {
    sprite.x -= 0x18;
    sprite.y += 0x18;
    sprite.oam.matrixNum = ST_OAM_VFLIP;
  } else if (corner === 3) {
    sprite.x += 0x18;
    sprite.y -= 0x18;
    sprite.oam.matrixNum = ST_OAM_HFLIP;
  } else {
    sprite.x += 0x18;
    sprite.y += 0x18;
    sprite.oam.matrixNum = ST_OAM_HFLIP | ST_OAM_VFLIP;
  }
  sprite.oam.tileNum = sprite.oam.tileNum + 16;
  sprite.callback = AnimLockOnTarget;
  sprite.callback(sprite);
};

// ------------------------------------------------------------------ bowing and tipping the attacker, Skull Bash

// AnimBowMon (Headbutt, Take Down, ...): an invisible sprite that rocks the attacker. Arg 0 picks the
// step: 0 lean back, 1 lunge forward, 2 rock back upright, else nothing.
const AnimBowMon: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  sprite.data[0] = 0;
  switch (gBattleAnimArgs[0]) {
    case 0:
      sprite.callback = AnimBowMon_Step1;
      break;
    case 1:
      sprite.callback = AnimBowMon_Step2;
      break;
    case 2:
      sprite.callback = AnimBowMon_Step3;
      break;
    default:
      sprite.callback = AnimBowMon_Step4;
      break;
  }
};

function AnimBowMon_Step1(sprite: Sprite): void {
  sprite.data[0] = 6;
  sprite.data[1] = isOpponent(anim.attacker) ? 2 : -2;
  sprite.data[2] = 0;
  sprite.data[3] = g.battlerSpriteIds[anim.attacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step1_Callback);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step1_Callback(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    d[3] = g.battlerSpriteIds[anim.attacker];
    PrepareBattlerSpriteForRotScale(d[3], ST_OAM_OBJ_NORMAL);
    d[6] = getBattlerSide(anim.attacker);
    d[4] = d[6] ? 0x300 : -0x300; // 0xFFFFFD00
    d[5] = 0;
  }
  d[5] += d[4];
  SetSpriteRotScale(d[3], 0x100, 0x100, d[5]);
  SetBattlerSpriteYOffsetFromRotation(d[3]);
  if (++d[0] > 3) {
    d[0] = 0;
    sprite.callback = AnimBowMon_Step4;
  }
}

function AnimBowMon_Step2(sprite: Sprite): void {
  sprite.data[0] = 4;
  sprite.data[1] = isOpponent(anim.attacker) ? -3 : 3;
  sprite.data[2] = 0;
  sprite.data[3] = g.battlerSpriteIds[anim.attacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step4);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step3(sprite: Sprite): void {
  if (++sprite.data[0] > 8) {
    sprite.data[0] = 0;
    sprite.callback = AnimBowMon_Step3_Callback;
  }
}

function AnimBowMon_Step3_Callback(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    d[3] = g.battlerSpriteIds[anim.attacker];
    d[6] = getBattlerSide(anim.attacker);
    if (isOpponent(anim.attacker)) {
      d[4] = -0x400; // 0xFC00
      d[5] = 0xc00;
    } else {
      d[4] = 0x400;
      d[5] = -0xc00; // 0xF400
    }
  }
  d[5] += d[4];
  SetSpriteRotScale(d[3], 0x100, 0x100, d[5]);
  SetBattlerSpriteYOffsetFromRotation(d[3]);
  if (++d[0] > 2) {
    ResetSpriteRotScale(d[3]);
    sprite.callback = AnimBowMon_Step4;
  }
}

function AnimBowMon_Step4(sprite: Sprite): void {
  DestroyAnimSprite(sprite);
}

/** AnimTipMon (sTipMonSpriteTemplate, unused): tips the attacker forward and back. */
const AnimTipMon: SpriteCallback = (sprite) => {
  sprite.data[0] = 0;
  sprite.callback = AnimTipMon_Step;
};

function AnimTipMon_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      d[1] = 0;
      d[2] = g.battlerSpriteIds[anim.attacker];
      d[3] = getBattlerSide(anim.attacker);
      d[4] = d[3] !== K.B_SIDE_PLAYER ? 0x200 : -0x200;
      d[5] = 0;
      PrepareBattlerSpriteForRotScale(d[2], ST_OAM_OBJ_NORMAL);
      d[0]++;
    // fallthrough
    case 1:
      d[5] += d[4];
      SetSpriteRotScale(d[2], 0x100, 0x100, d[5]);
      SetBattlerSpriteYOffsetFromRotation(d[2]);
      if (++d[1] > 3) {
        d[1] = 0;
        d[4] *= -1;
        d[0]++;
      }
      break;
    case 2:
      d[5] += d[4];
      SetSpriteRotScale(d[2], 0x100, 0x100, d[5]);
      SetBattlerSpriteYOffsetFromRotation(d[2]);
      if (++d[1] > 3) {
        ResetSpriteRotScale(d[2]);
        DestroyAnimSprite(sprite);
      }
      break;
  }
}

/** AnimTask_SkullBashPosition: arg 0 = 0 pulls the attacker back and tilts it; 1 tilts it back upright. */
const AnimTask_SkullBashPosition: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = g.battlerSpriteIds[anim.attacker];
  const side = getBattlerSide(anim.attacker);
  d[1] = side;
  d[2] = 0;
  switch (gBattleAnimArgs[0]) {
    default:
      DestroyAnimVisualTask(taskId);
      break;
    case 0:
      d[2] = 0;
      d[3] = 8;
      d[4] = 0;
      d[5] = 3;
      if (side === K.B_SIDE_PLAYER) d[5] *= -1;
      gTasks[taskId].func = AnimTask_SkullBashPositionSet;
      break;
    case 1:
      d[3] = 8;
      d[4] = 0x600;
      d[5] = 0xc0;
      if (side === K.B_SIDE_PLAYER) {
        d[4] = -d[4];
        d[5] = -d[5];
      }
      gTasks[taskId].func = AnimTask_SkullBashPositionReset;
      break;
  }
};

const AnimTask_SkullBashPositionSet: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const mon = gSprites[d[0]];
  switch (d[2]) {
    case 0:
      if (d[3]) {
        d[4] += d[5];
        mon.x2 = d[4];
        d[3]--;
      } else {
        d[3] = 8;
        d[4] = 0;
        d[5] = d[1] === 0 ? -0xc0 : 0xc0;
        PrepareBattlerSpriteForRotScale(d[0], ST_OAM_OBJ_NORMAL);
        d[2]++;
      }
      break;
    case 1:
      if (d[3]) {
        d[4] += d[5];
        SetSpriteRotScale(d[0], 0x100, 0x100, d[4]);
        SetBattlerSpriteYOffsetFromRotation(d[0]);
        d[3]--;
      } else {
        d[3] = 8;
        d[4] = mon.x2;
        d[5] = d[1] === 0 ? 2 : -2;
        d[6] = 1;
        d[2]++;
      }
      break;
    case 2:
      if (d[3]) {
        if (d[6]) {
          d[6]--;
        } else {
          if (d[3] & 1) mon.x2 = d[4] + d[5];
          else mon.x2 = d[4] - d[5];
          d[6] = 1;
          d[3]--;
        }
      } else {
        mon.x2 = d[4];
        d[3] = 12;
        d[2]++;
      }
      break;
    case 3:
      if (d[3]) {
        d[3]--;
      } else {
        d[3] = 3;
        d[4] = mon.x2;
        d[5] = d[1] === 0 ? 8 : -8;
        d[2]++;
      }
      break;
    case 4:
      if (d[3]) {
        d[4] += d[5];
        mon.x2 = d[4];
        d[3]--;
      } else {
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
};

const AnimTask_SkullBashPositionReset: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[3]) {
    d[4] -= d[5];
    SetSpriteRotScale(d[0], 0x100, 0x100, d[4]);
    SetBattlerSpriteYOffsetFromRotation(d[0]);
    d[3]--;
  } else {
    ResetSpriteRotScale(d[0]);
    DestroyAnimVisualTask(taskId);
  }
};

// ------------------------------------------------------------------ Slash, False Swipe

/** AnimSlashSlice: plays the slash, then blinks out. Args: battler, x, y. */
const AnimSlashSlice: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  } else {
    sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
    sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  }
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  StoreSpriteCallbackInData6(sprite, AnimFalseSwipeSlice_Step3);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

/** AnimFalseSwipeSlice: slashes left of the target, slides over, then blinks out. */
const AnimFalseSwipeSlice: SpriteCallback = (sprite) => {
  sprite.x = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + 0xffd0);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  StoreSpriteCallbackInData6(sprite, AnimFalseSwipeSlice_Step1);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

/** AnimFalseSwipePositionedSlice: a finished slash at x offset arg 0, blinking out. */
const AnimFalseSwipePositionedSlice: SpriteCallback = (sprite) => {
  sprite.x = s16(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + 0xffd0 + gBattleAnimArgs[0]);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  StartSpriteAnim(sprite, 1);
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.callback = AnimFalseSwipeSlice_Step3;
};

function AnimFalseSwipeSlice_Step1(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] > 8) {
    d[0] = 12;
    d[1] = 8;
    d[2] = 0;
    StoreSpriteCallbackInData6(sprite, AnimFalseSwipeSlice_Step2);
    sprite.callback = TranslateSpriteLinear;
  }
}

function AnimFalseSwipeSlice_Step2(sprite: Sprite): void {
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.callback = AnimFalseSwipeSlice_Step3;
}

function AnimFalseSwipeSlice_Step3(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] > 1) {
    d[0] = 0;
    sprite.invisible = !sprite.invisible;
    if (++d[1] > 8) DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ Endure, Sharpen, Conversion

/** AnimEndureEnergy (Endure, Focus Energy): rises, speeding up. Args: battler, x, y, frames per extra pixel. */
const AnimEndureEnergy: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y) + gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimEndureEnergy_Step;
};

function AnimEndureEnergy_Step(sprite: Sprite): void {
  if (++sprite.data[0] > sprite.data[1]) {
    sprite.data[0] = 0;
    sprite.y--;
  }
  sprite.y -= sprite.data[0];
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimSharpenSphere: flickers above the attacker, ever slower, with a sound on every other flash. */
const AnimSharpenSphere: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) - 12;
  const d = sprite.data;
  d[0] = 0;
  d[1] = 2;
  d[2] = 0;
  d[3] = 0;
  d[4] = 0;
  d[5] = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  sprite.callback = AnimSharpenSphere_Step;
};

function AnimSharpenSphere_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] >= d[1]) {
    sprite.invisible = !sprite.invisible;
    if (!sprite.invisible) {
      d[4]++;
      if (!(d[4] & 1)) PlaySE12WithPanning(K.SE_M_SWAGGER2, d[5]);
    }
    d[0] = 0;
    if (++d[2] > 1) {
      d[2] = 0;
      d[1]++;
    }
  }
  if (sprite.animEnded && d[1] > 16 && sprite.invisible) DestroyAnimSprite(sprite);
}

/** AnimConversion: a tile on the attacker that waits for gBattleAnimArgs[7] == -1. Args: x, y. */
const AnimConversion: SpriteCallback = (sprite) => {
  if (sprite.data[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
    if (IsContest()) sprite.y += 10;
    sprite.data[0]++;
  }
  if (animArgsStop()) DestroyAnimSprite(sprite);
};

/** AnimTask_ConversionAlphaBlend: fades the tiles in, then sets gBattleAnimArgs[7] to -1. */
const AnimTask_ConversionAlphaBlend: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2] === 1) {
    gBattleAnimArgs[7] = -1; // 0xFFFF
    d[2]++;
  } else if (d[2] === 2) {
    DestroyAnimVisualTask(taskId);
  } else if (++d[0] === 4) {
    d[0] = 0;
    d[1]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[1], d[1]));
    if (d[1] === 16) d[2]++;
  }
};

/** AnimConversion2: a tile on the target that waits, then flies to the attacker. Args: x, y, delay. */
const AnimConversion2: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.animPaused = true;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = AnimConversion2_Step;
};

function AnimConversion2_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0]) {
    d[0]--;
  } else {
    sprite.animPaused = false;
    d[0] = 30;
    d[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  }
}

/** AnimTask_Conversion2AlphaBlend: fades the tiles out. */
const AnimTask_Conversion2AlphaBlend: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[0] === 4) {
    d[0] = 0;
    d[1]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
    if (d[1] === 16) DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_HideBattlersHealthbox (unused): hides the player's (arg 0) and/or the foe's (arg 1) healthboxes. */
const AnimTask_HideBattlersHealthbox: TaskFunc = (taskId) => {
  for (let i = 0; i < g.battlersCount; i++) {
    if (gBattleAnimArgs[0] === 1 && getBattlerSide(i) === K.B_SIDE_PLAYER) SetHealthboxSpriteInvisible(g.healthboxSpriteIds[i]);
    if (gBattleAnimArgs[1] === 1 && getBattlerSide(i) === K.B_SIDE_OPPONENT) SetHealthboxSpriteInvisible(g.healthboxSpriteIds[i]);
  }
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_ShowBattlersHealthbox (unused) */
const AnimTask_ShowBattlersHealthbox: TaskFunc = (taskId) => {
  for (let i = 0; i < g.battlersCount; i++) SetHealthboxSpriteVisible(g.healthboxSpriteIds[i]);
  DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ Moonlight

/** AnimMoon: the moon, until AnimTask_MoonlightEndFade sets data[0]. Args: x, y. */
const AnimMoon: SpriteCallback = (sprite) => {
  if (IsContest()) {
    sprite.x = 48;
    sprite.y = 40;
  } else {
    sprite.x = gBattleAnimArgs[0];
    sprite.y = gBattleAnimArgs[1];
  }
  sprite.oam.shape = SPRITE_SHAPE['8x8'][0];
  sprite.oam.size = SPRITE_SHAPE['64x32'][1];
  sprite.data[0] = 0;
  sprite.callback = AnimMoon_Step;
};

function AnimMoon_Step(sprite: Sprite): void {
  if (sprite.data[0]) DestroyAnimSprite(sprite);
}

/** AnimMoonlightSparkle: drifts down, until AnimTask_MoonlightEndFade sets data[0]. Args: x offset, y. */
const AnimMoonlightSparkle: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = gBattleAnimArgs[1];
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[4] = 1;
  sprite.callback = AnimMoonlightSparkle_Step;
};

function AnimMoonlightSparkle_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[1] > 1) {
    d[1] = 0;
    if (d[2] < 120) {
      sprite.y++;
      d[2]++;
    }
  }
  if (d[0]) DestroyAnimSprite(sprite);
}

/**
 * AnimTask_MoonlightEndFade: the battle BG brightens to a pale blue while the mons, moon and sparkles fade
 * to it; then the moon and sparkles go and everything fades back.
 */
const AnimTask_MoonlightEndFade: TaskFunc = (taskId) => {
  const a = GetBattlePalettesMask(true, false, false, false, false, false, false) & 0xffff;
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = a;
  d[4] = 0;
  d[5] = 0;
  d[6] = 0;
  d[7] = 13;
  d[8] = 14;
  d[9] = 15;
  let b = GetBattleMonSpritePalettesMask(true, true, true, true);
  const c = (a | b) >>> 0;
  // StorePointerInVars(&data[14], &data[15], c)
  d[14] = c & 0xffff;
  d[15] = c >>> 16;
  b = (b | (0x10000 << IndexOfSpritePaletteTag(K.ANIM_TAG_MOON))) >>> 0;
  const dd = IndexOfSpritePaletteTag(K.ANIM_TAG_GREEN_SPARKLE);
  BeginNormalPaletteFade(((0x10000 << dd) | b) >>> 0, 0, 0, 16, RGB(27, 29, 31));
  gTasks[taskId].func = AnimTask_MoonlightEndFade_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_MoonlightEndFade_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 0) {
        d[1] = 0;
        let color: number;
        if (++d[2] <= 15) {
          d[4] += d[7];
          d[5] += d[8];
          d[6] += d[9];
          color = RGB(u16(d[4]) >> 3, u16(d[5]) >> 3, u16(d[6]) >> 3);
        } else {
          color = RGB(27, 29, 31);
          d[0]++;
        }
        for (let i = 0, bitmask = 1, r3 = 0; i <= 15; i++, bitmask <<= 1, r3 += 16) {
          if (d[3] & bitmask) for (let j = 1; j <= 15; j++) gPlttBufferFaded[r3 + j] = color;
        }
      }
      break;
    case 1:
      if (!gPaletteFade.active) {
        const moon = animSpriteTemplate('gMoonSpriteTemplate');
        const sparkle = animSpriteTemplate('gMoonlightSparkleSpriteTemplate');
        for (let spriteId = 0; spriteId < MAX_SPRITES; spriteId++) {
          if (gSprites[spriteId].template === moon || gSprites[spriteId].template === sparkle) gSprites[spriteId].data[0] = 1;
        }
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      if (++d[1] > 30) {
        // LoadPointerFromVars(data[14], data[15])
        BeginNormalPaletteFade(((d[14] & 0xffff) | (d[15] << 16)) >>> 0, 0, 16, 0, RGB(27, 29, 31));
        d[0]++;
      }
      break;
    case 3:
      if (!gPaletteFade.active) DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Horn Attack, Double Team, Super Fang

/** AnimHornHit (Horn Attack, Fury Attack, Horn Drill): the horn thrusts into the target. Args: x, y, duration. */
const AnimHornHit: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] < 2) gBattleAnimArgs[2] = 2;
  if (gBattleAnimArgs[2] > 0x7f) gBattleAnimArgs[2] = 0x7f;
  const d = sprite.data;
  d[0] = 0;
  d[1] = gBattleAnimArgs[2];
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  d[6] = sprite.x;
  d[7] = sprite.y;
  if (IsContest()) {
    sprite.oam.matrixNum = ST_OAM_HFLIP;
    sprite.x += 40;
    sprite.y += 20;
    d[2] = sprite.x << 7;
    d[3] = Math.trunc(-0x1400 / d[1]);
    d[4] = sprite.y << 7;
    d[5] = Math.trunc(-0xa00 / d[1]);
  } else if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x -= 40;
    sprite.y += 20;
    d[2] = sprite.x << 7;
    d[3] = Math.trunc(0x1400 / d[1]);
    d[4] = sprite.y << 7;
    d[5] = Math.trunc(-0xa00 / d[1]);
  } else {
    sprite.x += 40;
    sprite.y -= 20;
    d[2] = sprite.x << 7;
    d[3] = Math.trunc(-0x1400 / d[1]);
    d[4] = sprite.y << 7;
    d[5] = Math.trunc(0xa00 / d[1]);
    sprite.oam.matrixNum = ST_OAM_HFLIP | ST_OAM_VFLIP;
  }
  sprite.callback = AnimHornHit_Step;
};

function AnimHornHit_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[2] += d[3];
  d[4] += d[5];
  sprite.x = d[2] >> 7;
  sprite.y = d[4] >> 7;
  if (--d[1] === 1) {
    sprite.x = d[6];
    sprite.y = d[7];
  }
  if (d[1] === 0) DestroyAnimSprite(sprite);
}

/** AnimTask_DoubleTeam: two dark copies of the attacker sway out to the sides and back. */
const AnimTask_DoubleTeam: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[0] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[1] = AllocSpritePalette(K.ANIM_TAG_BENT_SPOON);
  const r3 = OBJ_PLTT_ID(d[1]);
  const r4 = OBJ_PLTT_ID(gSprites[d[0]].oam.paletteNum); // OBJ_PLTT_ID2
  for (let i = 1; i < 16; i++) gPlttBufferUnfaded[r3 + i] = gPlttBufferUnfaded[r4 + i];
  BlendPalette(r3, 16, 11, RGB_BLACK);
  d[3] = 0;
  let obj: number;
  for (let i = 0; i < 2 && (obj = CloneBattlerSpriteWithBlend(K.ANIM_ATTACKER)) >= 0; i++) {
    const clone = gSprites[obj];
    clone.oam.paletteNum = d[1];
    clone.data[0] = 0;
    clone.data[1] = i << 7;
    clone.data[2] = taskId;
    clone.callback = AnimDoubleTeam;
    d[3]++;
  }
  task.func = AnimTask_DoubleTeam_Step;
  if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG1_ON);
  else ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG2_ON);
};

const AnimTask_DoubleTeam_Step: TaskFunc = (taskId) => {
  if (!gTasks[taskId].data[3]) {
    if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG1_ON);
    else SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_BG2_ON);
    FreeSpritePaletteByTag(K.ANIM_TAG_BENT_SPOON);
    DestroyAnimVisualTask(taskId);
  }
};

function AnimDoubleTeam(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[3] > 1) {
    d[3] = 0;
    d[0]++;
  }
  if (d[0] > 64) {
    gTasks[d[2]].data[3]--;
    DestroySpriteWithActiveSheet(sprite);
  } else {
    d[4] = Math.trunc(gSineTable(d[0]) / 6);
    d[5] = Math.trunc(gSineTable(d[0]) / 13);
    d[1] = (d[1] + d[5]) & 0xff;
    sprite.x2 = Sin(d[1], d[4]);
  }
}

/** AnimSuperFang: plays its anim once. */
const AnimSuperFang: SpriteCallback = (sprite) => {
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

// ------------------------------------------------------------------ music notes (Sing, Grass Whistle, Belly Drum, ...)

/** sParticlesColorBlendTable: {palette tag, colours 1-5} for the four rainbow note palettes */
const sParticlesColorBlendTable = () => [
  [K.ANIM_TAG_MUSIC_NOTES, RGB_WHITE, RGB(31, 26, 28), RGB(31, 22, 26), RGB(31, 17, 24), RGB(31, 13, 22)],
  [K.ANIM_TAG_BENT_SPOON, RGB_WHITE, RGB(25, 31, 26), RGB(20, 31, 21), RGB(15, 31, 16), RGB(10, 31, 12)],
  [K.ANIM_TAG_SPHERE_TO_CUBE, RGB_WHITE, RGB(31, 31, 24), RGB(31, 31, 17), RGB(31, 31, 10), RGB(31, 31, 3)],
  [K.ANIM_TAG_LARGE_FRESH_EGG, RGB_WHITE, RGB(26, 28, 31), RGB(21, 26, 31), RGB(16, 24, 31), RGB(12, 22, 31)],
];

/** AnimTask_MusicNotesRainbowBlend: recolours the notes' palette and sets up three more (by borrowing other tags). */
const AnimTask_MusicNotesRainbowBlend: TaskFunc = (taskId) => {
  const table = sParticlesColorBlendTable();
  let index = IndexOfSpritePaletteTag(table[0][0]);
  if (index !== 0xff) {
    index = OBJ_PLTT_ID(index);
    for (let i = 1; i < table[0].length; i++) gPlttBufferFaded[index + i] = table[0][i];
  }
  for (let j = 1; j < table.length; j++) {
    index = AllocSpritePalette(table[j][0]);
    if (index !== 0xff) {
      index = OBJ_PLTT_ID(index);
      for (let i = 1; i < table[0].length; i++) gPlttBufferFaded[index + i] = table[j][i];
    }
  }
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_MusicNotesClearRainbowBlend: frees the three borrowed palettes. */
const AnimTask_MusicNotesClearRainbowBlend: TaskFunc = (taskId) => {
  const table = sParticlesColorBlendTable();
  for (let i = 1; i < table.length; i++) FreeSpritePaletteByTag(table[i][0]);
  DestroyAnimVisualTask(taskId);
};

// AnimWavyMusicNotes data: [0] move timer, [1] blend table index, [2] blend timer, [3] blend cycle time,
// [4]/[5] x/y (Q4), [6]/[7] x/y velocity
/** AnimWavyMusicNotes: a note waving towards the target, cycling the rainbow palettes. Args: anim number, palette, cycle time. */
const AnimWavyMusicNotes: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  StartSpriteAnim(sprite, gBattleAnimArgs[0]);
  const index = IndexOfSpritePaletteTag(sParticlesColorBlendTable()[gBattleAnimArgs[1]][0]);
  if (index !== 0xff) sprite.oam.paletteNum = index;
  const d = sprite.data;
  d[1] = gBattleAnimArgs[1];
  d[2] = 0;
  d[3] = gBattleAnimArgs[2];
  let x: number, y: number;
  if (IsContest()) {
    x = 48;
    y = 40;
  } else {
    x = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2));
    y = u8(GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET));
  }
  d[4] = sprite.x << 4;
  d[5] = sprite.y << 4;
  const v = AnimWavyMusicNotes_CalcVelocity(s16(x - sprite.x), s16(y - sprite.y), 40);
  d[6] = v.x;
  d[7] = v.y;
  sprite.callback = AnimWavyMusicNotes_Step;
};

function AnimWavyMusicNotes_CalcVelocity(x: number, y: number, xSpeedFactor: number): { x: number; y: number } {
  if (x < 0) xSpeedFactor = -xSpeedFactor;
  const x2 = x * 256;
  let time = Math.trunc(x2 / xSpeedFactor);
  if (time === 0) time = 1;
  return { x: s16(Math.trunc(x2 / time)), y: s16(Math.trunc((y * 256) / time)) };
}

function AnimWavyMusicNotes_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0]++;
  const trigIdx = s16(d[0] * 5 - (Math.trunc((d[0] * 5) / 256) << 8));
  d[4] += d[6];
  d[5] += d[7];
  sprite.x = d[4] >> 4;
  sprite.y = d[5] >> 4;
  sprite.y2 = Sin(trigIdx, 15);
  const y = sprite.y;
  if (sprite.x < -16 || sprite.x > DISPLAY_WIDTH + 16 || y < -16 || y > DISPLAY_HEIGHT - 32) {
    DestroySpriteAndMatrix(sprite);
  } else if (d[3] && ++d[2] > d[3]) {
    d[2] = 0;
    if (++d[1] > 3) d[1] = 0;
    const index = IndexOfSpritePaletteTag(sParticlesColorBlendTable()[d[1]][0]);
    if (index !== 0xff) sprite.oam.paletteNum = index;
  }
}

/** AnimFlyingMusicNotes: a note flying out from the attacker, looping once. Args: anim number, x, y. */
const AnimFlyingMusicNotes: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) gBattleAnimArgs[1] *= -1;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  StartSpriteAnim(sprite, gBattleAnimArgs[0]);
  const d = sprite.data;
  d[2] = 0;
  d[3] = 0;
  d[4] = sprite.x << 4;
  d[5] = sprite.y << 4;
  d[6] = Math.trunc((gBattleAnimArgs[1] << 4) / 5);
  d[7] = Math.trunc((gBattleAnimArgs[2] << 7) / 5);
  sprite.callback = AnimFlyingMusicNotes_Step;
};

function AnimFlyingMusicNotes_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[6];
  d[5] += d[7];
  sprite.x = d[4] >> 4;
  sprite.y = d[5] >> 4;
  if (d[0] > 5 && d[3] === 0) {
    d[2] = (d[2] + 16) & 0xff;
    sprite.x2 = Cos(d[2], 18);
    sprite.y2 = Sin(d[2], 18);
    if (d[2] === 0) d[3] = 1;
  }
  if (++d[0] === 48) DestroySpriteAndMatrix(sprite);
}

/** AnimBellyDrumHand: a hand beside the attacker for 8 frames. Arg 0: 1 = right (flipped). */
const AnimBellyDrumHand: SpriteCallback = (sprite) => {
  let a: number;
  if (gBattleAnimArgs[0] === 1) {
    sprite.oam.matrixNum = ST_OAM_HFLIP;
    a = 16;
  } else {
    a = -16;
  }
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + a;
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + 8;
  sprite.data[0] = 8;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSlowFlyingMusicNotes: a note drifting up and out from the attacker. Args: left (0) / right, anim number, palette, wave offset. */
const AnimSlowFlyingMusicNotes: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  sprite.y += 8;
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  const index = IndexOfSpritePaletteTag(sParticlesColorBlendTable()[gBattleAnimArgs[2]][0]);
  if (index !== 0xff) sprite.oam.paletteNum = index;
  const xDiff = gBattleAnimArgs[0] === 0 ? -32 : 32;
  const d = sprite.data;
  d[0] = 40;
  d[1] = sprite.x;
  d[2] = xDiff + d[1];
  d[3] = sprite.y;
  d[4] = d[3] - 40;
  InitAnimLinearTranslation(sprite);
  d[5] = gBattleAnimArgs[3];
  sprite.callback = AnimSlowFlyingMusicNotes_Step;
};

function AnimSlowFlyingMusicNotes_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    let xDiff = Sin(d[5], 8);
    if (sprite.x2 < 0) xDiff = -xDiff;
    sprite.x2 += xDiff;
    sprite.y2 += Sin(d[5], 4);
    d[5] = (d[5] + 8) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ thought bubble, fingers

/** SetSpriteNextToMonHead (also used by battle_anim_effects_2.c): beside the battler's head, on the side facing the foe */
export function SetSpriteNextToMonHead(battler: number, sprite: Sprite): void {
  if (getBattlerSide(battler) === K.B_SIDE_PLAYER) sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_RIGHT) + 8;
  else sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_LEFT) - 8;
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) - Math.trunc(s16(GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_HEIGHT)) / 4);
}

/** AnimThoughtBubble (Metronome, Mimic...): pops up beside the battler's head, stays, pops away. Args: battler, frames. */
const AnimThoughtBubble: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  SetSpriteNextToMonHead(battler, sprite);
  const animNum = getBattlerSide(battler) === K.B_SIDE_PLAYER ? 0 : 1;
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.data[1] = animNum + 2;
  StartSpriteAnim(sprite, animNum);
  StoreSpriteCallbackInData6(sprite, AnimThoughtBubble_Step);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

function AnimThoughtBubble_Step(sprite: Sprite): void {
  if (--sprite.data[0] === 0) {
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
    StartSpriteAnim(sprite, sprite.data[1]);
    sprite.callback = RunStoredCallbackWhenAnimEnds;
  }
}

/** AnimMetronomeFinger: grows beside the battler's head, wags, shrinks away. Arg 0: battler. */
const AnimMetronomeFinger: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  SetSpriteNextToMonHead(battler, sprite);
  sprite.data[0] = 0;
  StoreSpriteCallbackInData6(sprite, AnimMetronomeFinger_Step);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

function AnimMetronomeFinger_Step(sprite: Sprite): void {
  if (++sprite.data[0] > 16) {
    StartSpriteAffineAnim(sprite, 1);
    StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
    sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  }
}

/** AnimFollowMeFinger: grows over the battler's head, sways once side to side, shrinks away. Arg 0: battler. */
const AnimFollowMeFinger: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP);
  if (sprite.y <= 9) sprite.y = 10;
  const d = sprite.data;
  d[0] = 1;
  d[1] = 0;
  d[2] = sprite.subpriority;
  d[3] = sprite.subpriority + 4;
  d[4] = 0;
  StoreSpriteCallbackInData6(sprite, AnimFollowMeFinger_Step1);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

function AnimFollowMeFinger_Step1(sprite: Sprite): void {
  if (++sprite.data[4] > 12) sprite.callback = AnimFollowMeFinger_Step2;
}

function AnimFollowMeFinger_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[1] += 4;
  if (d[1] > 254) {
    if (--d[0] === 0) {
      sprite.x2 = 0;
      sprite.callback = AnimMetronomeFinger_Step;
      return;
    }
    d[1] &= 0xff;
  }
  if (d[1] > 0x4f) sprite.subpriority = u8(d[3]);
  if (d[1] > 0x9f) sprite.subpriority = u8(d[2]);
  const x1 = gSineTable(d[1]);
  const x2 = x1 >> 3;
  sprite.x2 = (x1 >> 3) + (x2 >> 1);
}

/** AnimTauntFinger: a wagging finger beside the battler's head. Arg 0: battler. */
const AnimTauntFinger: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  SetSpriteNextToMonHead(battler, sprite);
  if (getBattlerSide(battler) === K.B_SIDE_PLAYER) {
    StartSpriteAnim(sprite, 0);
    sprite.data[0] = 2;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.data[0] = 3;
  }
  sprite.callback = AnimTauntFinger_Step1;
};

function AnimTauntFinger_Step1(sprite: Sprite): void {
  if (++sprite.data[1] > 10) {
    sprite.data[1] = 0;
    StartSpriteAnim(sprite, sprite.data[0]);
    StoreSpriteCallbackInData6(sprite, AnimTauntFinger_Step2);
    sprite.callback = RunStoredCallbackWhenAnimEnds;
  }
}

function AnimTauntFinger_Step2(sprite: Sprite): void {
  if (++sprite.data[1] > 5) DestroyAnimSprite(sprite);
}

export const effects1SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMovePowderParticle,
  AnimPowerAbsorptionOrb,
  AnimSolarBeamBigOrb,
  AnimSolarBeamSmallOrb,
  AnimAbsorptionOrb,
  AnimHyperBeamOrb,
  AnimLeechSeed,
  AnimSporeParticle,
  AnimPetalDanceBigFlower,
  AnimPetalDanceSmallFlower,
  AnimRazorLeafParticle,
  AnimTranslateLinearSingleSineWave,
  AnimMoveTwisterParticle,
  AnimConstrictBinding,
  AnimMimicOrb,
  AnimIngrainRoot,
  AnimFrenzyPlantRoot,
  AnimIngrainOrb,
  AnimPresent,
  AnimKnockOffItem,
  AnimPresentHealParticle,
  AnimItemSteal,
  AnimTrickBag,
  AnimFlyingParticle,
  AnimNeedleArmSpike,
  AnimSlidingHit,
  AnimWhipHit,
  AnimFlickeringPunch,
  AnimCuttingSlice,
  AnimAirCutterSlice,
  UnusedFlickerAnim,
  AnimCirclingMusicNote,
  AnimProtect,
  AnimMilkBottle,
  AnimGrantingStars,
  AnimSparklingStars,
  AnimBubbleBurst,
  AnimSleepLetterZ,
  AnimLockOnTarget,
  AnimLockOnMoveTarget,
  AnimBowMon,
  AnimTipMon,
  AnimSlashSlice,
  AnimFalseSwipeSlice,
  AnimFalseSwipePositionedSlice,
  AnimEndureEnergy,
  AnimSharpenSphere,
  AnimConversion,
  AnimConversion2,
  AnimMoon,
  AnimMoonlightSparkle,
  AnimHornHit,
  AnimSuperFang,
  AnimWavyMusicNotes,
  AnimFlyingMusicNotes,
  AnimBellyDrumHand,
  AnimSlowFlyingMusicNotes,
  AnimThoughtBubble,
  AnimMetronomeFinger,
  AnimFollowMeFinger,
  AnimTauntFinger,
};

export const effects1Tasks: Record<string, TaskFunc> = {
  AnimTask_CreateSmallSolarBeamOrbs,
  AnimTask_SporeDoubleBattle,
  AnimTask_ShrinkTargetCopy,
  AnimTask_LeafBlade,
  AnimTask_CycleMagicalLeafPal,
  AnimTask_SkullBashPosition,
  AnimTask_ConversionAlphaBlend,
  AnimTask_Conversion2AlphaBlend,
  AnimTask_HideBattlersHealthbox,
  AnimTask_ShowBattlersHealthbox,
  AnimTask_MoonlightEndFade,
  AnimTask_DoubleTeam,
  AnimTask_MusicNotesRainbowBlend,
  AnimTask_MusicNotesClearRainbowBlend,
};
