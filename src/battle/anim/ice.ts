// battle_anim_ice.c: sprite callbacks and tasks (the whole file). Contest-only branches are left out
// (IsContest() is always FALSE in FRLG).

import { LoadBgTiles } from '../../gba/bg';
import { gfx, gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  SetGpuReg,
} from '../../gba/hw';
import { BG_PLTT_ID, LoadPalette, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  gSprites,
  MAX_SPRITES,
  ST_OAM_AFFINE_OFF,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimFastTranslateLinear,
  AnimLoadCompressedBgTilemap,
  AnimTranslateLinear,
  ConvertPosDataToTranslateLinearData,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  InitAnimArcTranslation,
  InitAnimFastLinearTranslationWithSpeed,
  InitAnimFastLinearTranslationWithSpeedAndPos,
  InitAnimLinearTranslation,
  InitAnimLinearTranslationWithSpeed,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  RunStoredCallbackWhenAffineAnimEnds,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetAverageBattlerPositions,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TranslateAnimSpriteToTargetMonLocation,
  TranslateSpriteInGrowingCircle,
} from './animMons';
import { animSpriteTemplate } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';
import { g } from '../env';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;
/** GET_BATTLER_SIDE2 / gBattlerPositions[battler] & BIT_SIDE */
const battlerSide2 = (battler: number) => getBattlerPosition(battler) & K.BIT_SIDE;

/** Whether a sprite has left the screen (the off-screen test the snowball/particle callbacks share). */
const offScreen = (sprite: Sprite) =>
  sprite.x + sprite.x2 > DISPLAY_WIDTH + 16 || sprite.x + sprite.x2 < -16 || sprite.y + sprite.y2 > DISPLAY_HEIGHT || sprite.y + sprite.y2 < -16;

/**
 * The C's `while (1)` that runs a fast linear translation backwards until the sprite is off screen, to start
 * it from there. On the GBA a zero velocity would hang; cap it so a bad script can't freeze the page.
 */
function runFastTranslationOffScreen(sprite: Sprite): void {
  for (let i = 0; i < 0x10000; i++) {
    sprite.data[0] = 1;
    AnimFastTranslateLinear(sprite);
    if (offScreen(sprite)) break;
  }
}

// AnimUnusedIceCrystalThrow (sUnusedIceCrystalThrowSpriteTemplate, no script uses it): a crystal crossing
// the whole screen through both battlers, wobbling. Args: attacker x, y, target x, y, speed, wobble amplitude, wobble speed.
const AnimUnusedIceCrystalThrow: SpriteCallback = (sprite) => {
  sprite.oam.tileNum += 7;
  let targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  let targetY = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  let attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  let attackerY = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = gBattleAnimArgs[0] + attackerX;
  d[2] = gBattleAnimArgs[2] + targetX;
  d[3] = gBattleAnimArgs[1] + attackerY;
  d[4] = gBattleAnimArgs[3] + targetY;
  ConvertPosDataToTranslateLinearData(sprite);
  const onScreen = (x: number, y: number) => x >= -32 && x <= DISPLAY_WIDTH + 32 && y >= -32 && y <= DISPLAY_HEIGHT + 32;
  // (a zero step would hang the GBA; capped here)
  for (let i = 0; i < 0x10000 && onScreen(targetX, targetY); i++) {
    targetX = (targetX + d[1]) << 16 >> 16;
    targetY = (targetY + d[2]) << 16 >> 16;
  }
  d[1] = -d[1];
  d[2] = -d[2];
  for (let i = 0; i < 0x10000 && onScreen(attackerX, attackerY); i++) {
    attackerX = (attackerX + d[1]) << 16 >> 16;
    attackerY = (attackerY + d[2]) << 16 >> 16;
  }
  sprite.x = attackerX;
  sprite.y = attackerY;
  d[0] = gBattleAnimArgs[4];
  d[1] = attackerX;
  d[2] = targetX;
  d[3] = attackerY;
  d[4] = targetY;
  ConvertPosDataToTranslateLinearData(sprite);
  d[3] = gBattleAnimArgs[5];
  d[4] = gBattleAnimArgs[6];
  sprite.callback = AnimUnusedIceCrystalThrow_Step;
};

function AnimUnusedIceCrystalThrow_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] !== 0) {
    d[5] += d[1];
    d[6] += d[2];
    sprite.x2 = d[5];
    sprite.y2 = d[6];
    sprite.x2 += Sin(d[7], d[3]);
    sprite.y2 += Sin(d[7], d[3]);
    d[7] = (d[7] + d[4]) & 0xff;
    d[0]--;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimIcePunchSwirlingParticle: crystals spiralling in (Ice Punch). Arg 0: start angle. */
const AnimIcePunchSwirlingParticle: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[0] = gBattleAnimArgs[0];
  d[1] = 60;
  d[2] = 9;
  d[3] = 30;
  d[4] = -512;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteInGrowingCircle;
  sprite.callback(sprite);
};

/** AnimIceBeamParticle. Args: x, y, target x, target y, duration. */
const AnimIceBeamParticle: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  if (isOpponent(anim.attacker)) d[2] -= gBattleAnimArgs[2];
  else d[2] += gBattleAnimArgs[2];
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  d[0] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = StartAnimLinearTranslation;
};

/** AnimIceEffectParticle: the crystals on impact (Ice Punch, Ice Beam, Blizzard, ...). Args: x, y, both targets. */
const AnimIceEffectParticle: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] === 0) {
    InitSpritePosToAnimTarget(sprite, true);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    sprite.x = p.x;
    sprite.y = p.y;
    if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  StoreSpriteCallbackInData6(sprite, AnimFlickerIceEffectParticle);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

function AnimFlickerIceEffectParticle(sprite: Sprite): void {
  sprite.invisible = !sprite.invisible;
  if (++sprite.data[0] === 20) DestroySpriteAndMatrix(sprite);
}

// AnimSwirlingSnowball (Blizzard, Icy Wind): snowballs fly in from off screen behind the attacker, loop
// once by the target and fly on off screen. Args: x, y, target x, target y, speed, both targets.
const AnimSwirlingSnowball: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = sprite.x;
  d[3] = sprite.y;
  if (!gBattleAnimArgs[5]) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    d[2] = p.x;
    d[4] = p.y;
  }
  if (isOpponent(anim.attacker)) d[2] -= gBattleAnimArgs[2];
  else d[2] += gBattleAnimArgs[2];
  const saved = d.slice();
  InitAnimFastLinearTranslationWithSpeed(sprite);
  d[1] ^= 1;
  d[2] ^= 1;
  runFastTranslationOffScreen(sprite);
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = sprite.y2 = 0;
  d.set(saved);
  sprite.callback = InitAnimFastLinearTranslationWithSpeedAndPos;
  StoreSpriteCallbackInData6(sprite, AnimSwirlingSnowball_Step1);
};

function AnimSwirlingSnowball_Step1(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  d[0] = 128;
  const amplitude = isOpponent(anim.attacker) ? 20 : -20;
  d[3] = Sin(d[0], amplitude);
  d[4] = Cos(d[0], 15);
  d[5] = 0;
  sprite.callback = AnimSwirlingSnowball_Step2;
  sprite.callback(sprite);
}

function AnimSwirlingSnowball_Step2(sprite: Sprite): void {
  const d = sprite.data;
  const amplitude = isOpponent(anim.attacker) ? 20 : -20;
  if (d[5] <= 31) {
    sprite.x2 = Sin(d[0], amplitude) - d[3];
    sprite.y2 = Cos(d[0], 15) - d[4];
    d[0] = (d[0] + 16) & 0xff;
    d[5]++;
  } else {
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.x2 = sprite.y2 = 0;
    d[3] = d[4] = 0;
    sprite.callback = AnimSwirlingSnowball_End;
  }
}

function AnimSwirlingSnowball_End(sprite: Sprite): void {
  sprite.data[0] = 1;
  AnimFastTranslateLinear(sprite);
  // (u32)(x + 16) > 272: off the left or right edge
  const x = sprite.x + sprite.x2 + 16;
  if (x < 0 || x > 272 || sprite.y + sprite.y2 > 256 || sprite.y + sprite.y2 < -16) DestroyAnimSprite(sprite);
}

// AnimMoveParticleBeyondTarget (Blizzard, Powder Snow): from off screen behind the attacker, past the target
// and off screen, in a sine wave. Args: x, y, target x, target y, speed, wave amplitude, wave speed, both targets.
const AnimMoveParticleBeyondTarget: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = sprite.x;
  d[3] = sprite.y;
  if (!gBattleAnimArgs[7]) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    d[2] = p.x;
    d[4] = p.y;
  }
  if (isOpponent(anim.attacker)) d[2] -= gBattleAnimArgs[2];
  else d[2] += gBattleAnimArgs[2];
  d[4] += gBattleAnimArgs[3];
  InitAnimFastLinearTranslationWithSpeed(sprite);
  const saved = d.slice();
  d[1] ^= 1;
  d[2] ^= 1;
  runFastTranslationOffScreen(sprite);
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.y2 = 0;
  sprite.x2 = 0;
  d.set(saved);
  d[5] = gBattleAnimArgs[5];
  d[6] = gBattleAnimArgs[6];
  sprite.callback = AnimWiggleParticleTowardsTarget;
};

/** AnimWiggleParticleTowardsTarget */
function AnimWiggleParticleTowardsTarget(sprite: Sprite): void {
  const d = sprite.data;
  AnimFastTranslateLinear(sprite);
  if (d[0] === 0) d[0] = 1;
  sprite.y2 += Sin(d[7], d[5]);
  d[7] = (d[7] + d[6]) & 0xff;
  if (d[0] === 1 && offScreen(sprite)) DestroyAnimSprite(sprite);
}

/** AnimWaveFromCenterOfTarget: the ice pillars of Icy Wind. Args: x, y, both targets. */
const AnimWaveFromCenterOfTarget: SpriteCallback = (sprite) => {
  if (sprite.data[0] === 0) {
    if (gBattleAnimArgs[2] === 0) {
      InitSpritePosToAnimTarget(sprite, false);
    } else {
      const p = SetAverageBattlerPositions(anim.target, false);
      sprite.x = p.x;
      sprite.y = p.y;
      if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
      sprite.x += gBattleAnimArgs[0];
      sprite.y += gBattleAnimArgs[1];
    }
    sprite.data[0]++;
  } else if (sprite.animEnded) {
    DestroyAnimSprite(sprite);
  }
};

// InitSwirlingFogAnim (Mist, Smog, Haze, ...): a cloud drifting around a battler, passing behind it on
// the far half of the circle. Args: x, y, y distance, duration, battler (0 attacker), both mons.
const InitSwirlingFogAnim: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[4] === 0 ? anim.attacker : anim.target;
  if (gBattleAnimArgs[5] === 0) {
    if (gBattleAnimArgs[4] === 0) InitSpritePosToAnimAttacker(sprite, false);
    else InitSpritePosToAnimTarget(sprite, false);
  } else {
    const p = SetAverageBattlerPositions(battler, false);
    sprite.x = p.x;
    sprite.y = p.y;
    if (isOpponent(battler)) sprite.x -= gBattleAnimArgs[0];
    else sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  const d = sprite.data;
  d[7] = battler;
  d[6] = gBattleAnimArgs[5] === 0 || !IsDoubleBattle() ? 0x20 : 0x40;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = sprite.x;
  d[3] = sprite.y;
  d[4] = sprite.y + gBattleAnimArgs[2];
  InitAnimLinearTranslation(sprite);
  d[5] = 64;
  sprite.callback = AnimSwirlingFogAnim;
  sprite.callback(sprite);
};

function AnimSwirlingFogAnim(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[5], d[6]);
    sprite.y2 += Cos(d[5], -6);
    if (((d[5] - 64) & 0xffff) <= 0x7f) sprite.oam.priority = GetBattlerSpriteBGPriority(d[7]);
    else sprite.oam.priority = GetBattlerSpriteBGPriority(d[7]) + 1;
    d[5] = (d[5] + 3) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

// AnimTask_HazeScrollingFog / AnimTask_MistBallFog: the weather fog on BG1, scrolling left while it blends
// in, holds and fades out again.
const sHazeBlendAmounts = [0, 1, 2, 2, 2, 2, 3, 4, 4, 4, 5, 6, 6, 6, 6, 7, 8, 8, 8, 9];
const sMistBlendAmounts = [0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5];
const FOG_GFX = ['gWeatherFogHorizontalTiles', 'gBattleAnimFogTilemap', 'gDefaultWeatherSpritePalette'];

/** The shared start of AnimTask_HazeScrollingFog and AnimTask_MistBallFog */
function initFogBg(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  const animBg = GetBattleAnimBg1Data();
  LoadBgTiles(animBg.bgId, gfx('gWeatherFogHorizontalTiles'), 0x800, animBg.tilesOffset);
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gBattleAnimFogTilemap');
  LoadPalette(gfx16('gDefaultWeatherSpritePalette'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
}

/** The shared end (cases 3-4) of the fog tasks' steps */
function endFogBg(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[12] === 3) {
    InitBattleAnimBg(1);
    InitBattleAnimBg(2);
    d[12]++;
  }
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  DestroyAnimVisualTask(taskId);
}

/** AnimTask_HazeScrollingFog (Haze) */
const AnimTask_HazeScrollingFog: TaskFunc = (taskId) => {
  initFogBg();
  gTasks[taskId].func = AnimTask_HazeScrollingFog_Step;
};

const AnimTask_HazeScrollingFog_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  g.battle_BG1_X += -1;
  switch (d[12]) {
    case 0:
      if (++d[10] === 4) {
        d[10] = 0;
        d[9]++;
        d[11] = sHazeBlendAmounts[d[9]];
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === 9) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
    case 1:
      if (++d[11] === 0x51) {
        d[11] = 9;
        d[12]++;
      }
      break;
    case 2:
      if (++d[10] === 4) {
        d[10] = 0;
        d[11]--;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === 0) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
    case 3:
    case 4:
      endFogBg(taskId);
      break;
  }
};

/** AnimThrowMistBall: from the attacker to the target. Args: x, y, target x, target y, duration. */
const AnimThrowMistBall: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = TranslateAnimSpriteToTargetMonLocation;
};

/** AnimTask_MistBallFog (Mist Ball) */
const AnimTask_MistBallFog: TaskFunc = (taskId) => {
  initFogBg();
  gTasks[taskId].data[15] = -1;
  gTasks[taskId].func = AnimTask_MistBallFog_Step;
};

const AnimTask_MistBallFog_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  g.battle_BG1_X += d[15];
  switch (d[12]) {
    case 0:
      d[9]++;
      d[11] = sMistBlendAmounts[d[9]];
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 17 - d[11]));
      if (d[11] === 5) {
        d[12]++;
        d[11] = 0;
      }
      break;
    case 1:
      if (++d[11] === 0x51) {
        d[11] = 5;
        d[12]++;
      }
      break;
    case 2:
      if (++d[10] === 4) {
        d[10] = 0;
        d[11]--;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === 0) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
    case 3:
    case 4:
      endFogBg(taskId);
      break;
  }
};

// InitPoisonGasCloudAnim (Poison Gas): clouds drift to the target, circle it (behind it on the far side) and
// drift off screen. Args: duration, x, y, target x, target y, -, -, use the target's pic offsets.
// data[7]: 0x8000 if the attacker is left of the target, the target's BG priority << 8, and the stage.
const InitPoisonGasCloudAnim: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[0] = gBattleAnimArgs[0];
  if (GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) < GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2)) d[7] = 0x8000 << 16 >> 16;
  if (battlerSide2(anim.target) === K.B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
    if (d[7] & 0x8000 && battlerSide2(anim.attacker) === K.B_SIDE_PLAYER) {
      sprite.subpriority = gSprites[GetAnimBattlerSpriteId(K.ANIM_TARGET)].subpriority + 1;
    }
    d[6] = 1;
  }
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const picOffsets = gBattleAnimArgs[7] !== 0;
  d[1] = sprite.x + gBattleAnimArgs[1];
  d[2] = GetBattlerSpriteCoord(anim.target, picOffsets ? K.BATTLER_COORD_X_2 : K.BATTLER_COORD_X) + gBattleAnimArgs[3];
  d[3] = sprite.y + gBattleAnimArgs[2];
  d[4] = GetBattlerSpriteCoord(anim.target, picOffsets ? K.BATTLER_COORD_Y_PIC_OFFSET : K.BATTLER_COORD_Y) + gBattleAnimArgs[4];
  d[7] |= GetBattlerSpriteBGPriority(anim.target) << 8;
  InitAnimLinearTranslation(sprite);
  sprite.callback = MovePoisonGasCloud;
};

function MovePoisonGasCloud(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[7] & 0xff) {
    case 0:
      AnimTranslateLinear(sprite);
      sprite.x2 += gSineTable(d[5]) >> 4;
      if (d[6]) d[5] = (d[5] - 8) & 0xff;
      else d[5] = (d[5] + 8) & 0xff;
      if (d[0] <= 0) {
        d[0] = 80;
        sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
        d[1] = sprite.x;
        d[2] = sprite.x;
        sprite.y += sprite.y2;
        d[3] = sprite.y;
        d[4] = sprite.y + 29;
        d[7]++;
        d[5] = battlerSide2(anim.target) !== K.B_SIDE_PLAYER ? 204 : 80;
        sprite.y2 = 0;
        sprite.x2 = gSineTable(d[5]) >> 3;
        d[5] = (d[5] + 2) & 0xff;
        InitAnimLinearTranslation(sprite);
      }
      break;
    case 1:
      AnimTranslateLinear(sprite);
      sprite.x2 += gSineTable(d[5]) >> 3;
      sprite.y2 += (gSineTable(d[5] + 0x40) * -3) >> 8;
      // (s16 data[7] >> 8 keeps the 0x8000 flag's sign; the 2-bit priority field keeps the low bits)
      if (((d[5] - 0x40) & 0xffff) <= 0x7f) sprite.oam.priority = (d[7] >> 8) & 3;
      else sprite.oam.priority = ((d[7] >> 8) + 1) & 3;
      d[5] = (d[5] + 4) & 0xff;
      if (d[0] <= 0) {
        d[0] = 0x300;
        d[1] = sprite.x += sprite.x2;
        d[3] = sprite.y += sprite.y2;
        d[4] = sprite.y + 4;
        d[2] = battlerSide2(anim.target) !== K.B_SIDE_PLAYER ? 0x100 : -0x10;
        d[7]++;
        sprite.x2 = sprite.y2 = 0;
        InitAnimLinearTranslationWithSpeed(sprite);
      }
      break;
    case 2:
      if (AnimTranslateLinear(sprite)) {
        if (sprite.oam.affineMode & 1) {
          FreeOamMatrix(sprite.oam.matrixNum);
          sprite.oam.affineMode = ST_OAM_AFFINE_OFF;
        }
        DestroySprite(sprite);
        anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
      }
      break;
  }
}

// AnimTask_Hail (Hail, General_Hail): 30 hailstones fall diagonally at ten spots, three at a time. Spots on a
// visible battler aim at it and burst into ice crystals there.
// sHailCoordData: x, y, B_POSITION_*, 0/1 (aim above-left/below-right of the battler) or 2 (fixed spot).
const sHailCoordData: [number, number, string, number][] = [
  [100, 120, 'B_POSITION_PLAYER_LEFT', 2],
  [85, 120, 'B_POSITION_PLAYER_LEFT', 0],
  [242, 120, 'B_POSITION_OPPONENT_LEFT', 1],
  [66, 120, 'B_POSITION_PLAYER_RIGHT', 1],
  [182, 120, 'B_POSITION_OPPONENT_RIGHT', 0],
  [60, 120, 'B_POSITION_PLAYER_LEFT', 2],
  [214, 120, 'B_POSITION_OPPONENT_LEFT', 0],
  [113, 120, 'B_POSITION_PLAYER_LEFT', 1],
  [210, 120, 'B_POSITION_OPPONENT_RIGHT', 1],
  [38, 120, 'B_POSITION_PLAYER_RIGHT', 0],
];

const AnimTask_Hail: TaskFunc = (taskId) => {
  gTasks[taskId].func = AnimTask_Hail2;
};

const AnimTask_Hail2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[4] > 2) {
        d[4] = 0;
        d[5] = 0;
        d[2] = 0;
        d[0]++;
      }
      break;
    case 1:
      if (d[5] === 0) {
        if (GenerateHailParticle(d[3], d[2], taskId, 1)) d[1]++;
        if (++d[2] === 3) {
          if (++d[3] === 10) d[0]++;
          else d[0]--;
        } else {
          d[5] = 1;
        }
      } else {
        d[5]--;
      }
      break;
    case 2:
      if (d[1] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** GenerateHailParticle: data[7] is the task data slot counting live hailstones. */
function GenerateHailParticle(hailStructId: number, affineAnimNum: number, taskId: number, c: number): boolean {
  const [hx, hy, position, kind] = sHailCoordData[hailStructId];
  let battlerX = hx;
  let battlerY = hy;
  let hitsBattler = false;
  if (kind !== 2) {
    const id = getBattlerAtPosition(K[position]);
    if (IsBattlerSpriteVisible(id)) {
      hitsBattler = true;
      battlerX = GetBattlerSpriteCoord(id, K.BATTLER_COORD_X_2);
      battlerY = GetBattlerSpriteCoord(id, K.BATTLER_COORD_Y_PIC_OFFSET);
      const dx = Math.trunc(GetBattlerSpriteCoordAttr(id, K.BATTLER_COORD_ATTR_WIDTH) / 6);
      const dy = Math.trunc(GetBattlerSpriteCoordAttr(id, K.BATTLER_COORD_ATTR_HEIGHT) / 6);
      if (kind === 0) {
        battlerX -= dx;
        battlerY -= dy;
      } else {
        battlerX += dx;
        battlerY += dy;
      }
    }
  }
  const spriteX = battlerX - Math.trunc((battlerY + 8) / 2);
  const id = CreateSprite(animSpriteTemplate('sHailParticleSpriteTemplate')!, spriteX, -8, 18);
  if (id === MAX_SPRITES) return false;
  StartSpriteAffineAnim(gSprites[id], affineAnimNum);
  const d = gSprites[id].data;
  d[0] = hitsBattler ? 1 : 0;
  d[3] = battlerX;
  d[4] = battlerY;
  d[5] = affineAnimNum;
  d[6] = taskId;
  d[7] = c;
  return true;
}

function AnimHailBegin(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x += 4;
  sprite.y += 8;
  if (sprite.x < d[3] && sprite.y < d[4]) return;
  if (d[0] === 1 && d[5] === 0) {
    // the largest hailstones on a battler burst into crystals there
    const spriteId = CreateSprite(animSpriteTemplate('gIceCrystalHitLargeSpriteTemplate')!, d[3], d[4], sprite.subpriority);
    d[0] = spriteId;
    if (spriteId !== MAX_SPRITES) {
      const o = gSprites[spriteId];
      o.callback = AnimHailContinue;
      o.data[6] = d[6];
      o.data[7] = d[7];
    }
  } else {
    gTasks[d[6]].data[d[7]]--;
  }
  FreeOamMatrix(sprite.oam.matrixNum);
  DestroySprite(sprite);
}

function AnimHailContinue(sprite: Sprite): void {
  if (++sprite.data[0] === 20) {
    gTasks[sprite.data[6]].data[sprite.data[7]]--;
    FreeOamMatrix(sprite.oam.matrixNum);
    DestroySprite(sprite);
  }
}

/** The Ice Ball hit number, 0-4 (rollout counter). */
function rolloutCount(): number {
  const ds = anim.disableStruct;
  return ((ds?.rolloutTimerStartValue ?? 0) - (ds?.rolloutTimer ?? 0) - 1) & 0xff;
}

/** InitIceBallAnim: the ball, bigger each hit, arcs to the target. Args: x, y, target x, target y, duration, arc height. */
const InitIceBallAnim: SpriteCallback = (sprite) => {
  const animNum = Math.min(rolloutCount(), 4);
  StartSpriteAffineAnim(sprite, animNum);
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  d[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimThrowIceBall;
};

function AnimThrowIceBall(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    StartSpriteAnim(sprite, 1);
    sprite.callback = RunStoredCallbackWhenAnimEnds;
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  }
}

/** InitIceBallParticle: shards scattering from the target. Args: x, y. */
const InitIceBallParticle: SpriteCallback = (sprite) => {
  sprite.oam.tileNum += 8;
  InitSpritePosToAnimTarget(sprite, true);
  const randA = (random() & 0xff) + 256;
  let randB = random() & 0x1ff;
  if (randB > 0xff) randB = 256 - randB;
  sprite.data[1] = randA;
  sprite.data[2] = randB;
  sprite.callback = AnimIceBallParticle;
};

function AnimIceBallParticle(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 = d[1] & 1 ? -(d[3] >> 8) : d[3] >> 8;
  sprite.y2 = d[4] >> 8;
  if (++d[0] === 21) DestroyAnimSprite(sprite);
}

/** AnimTask_GetRolloutCounter: gBattleAnimArgs[arg 0] = the Ice Ball hit number. */
const AnimTask_GetRolloutCounter: TaskFunc = (taskId) => {
  const arg = gBattleAnimArgs[0] & 0xff;
  gBattleAnimArgs[arg] = rolloutCount();
  DestroyAnimVisualTask(taskId);
};

export const iceSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimUnusedIceCrystalThrow,
  AnimIcePunchSwirlingParticle,
  AnimIceBeamParticle,
  AnimIceEffectParticle,
  AnimSwirlingSnowball,
  AnimMoveParticleBeyondTarget,
  AnimWaveFromCenterOfTarget,
  InitSwirlingFogAnim,
  AnimThrowMistBall,
  InitPoisonGasCloudAnim,
  AnimHailBegin,
  InitIceBallAnim,
  InitIceBallParticle,
};

export const iceTasks: Record<string, TaskFunc> = {
  AnimTask_HazeScrollingFog,
  AnimTask_MistBallFog,
  AnimTask_Hail,
  AnimTask_GetRolloutCounter,
};

export function registerIceExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_HazeScrollingFog: FOG_GFX,
    AnimTask_MistBallFog: FOG_GFX,
  });
}
