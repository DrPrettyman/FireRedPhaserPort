// Per-move sprite callbacks and tasks from the type-specific battle anim files, ported as the moves that
// use them come up. Each section names its C file; the rest of each file is still to do.

import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPCNT_OBJWIN_ON,
  GetGpuReg,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  SetGpuReg,
  SetGpuRegBits,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../../gba/hw';
import { BG_PLTT_ID, BlendPalette, gPlttBufferFaded, LoadCompressedPalette, OBJ_PLTT_ID, OBJ_PLTT_OFFSET, PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  gSprites,
  IndexOfSpritePaletteTag,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  AnimTranslateLinear,
  AnimTravelDiagonally,
  ArcTan2Neg,
  BATTLE_PARTNER,
  CreateInvisibleSpriteCopy,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoord2,
  InitAnimArcTranslation,
  InitAnimLinearTranslation,
  InitAnimLinearTranslationWithSpeed,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunStoredCallbackWhenAnimEnds,
  SetSpriteRotScale,
  SetAnimBgAttribute,
  SetAnimSpriteInitialXOffset,
  SetAverageBattlerPositions,
  SetGreyscaleOrOriginalPalette,
  SetSpriteCoordsToAnimAttackerCoords,
  SPRITE_NONE,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TrySetSpriteRotScale,
  WaitAnimForDuration,
} from './animMons';
import { LoadBattleMonGfxAndAnimate } from '../gfx';
import { animSpriteTemplate, BattleAnimAdjustPanning, PlaySE12WithPanning } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

// ------------------------------------------------------------------ battle_anim_effects_1.c

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

/** AnimWhipHit (Vine Whip, Slam). Args: x, y. */
const AnimWhipHit: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = AnimWhipHit_WaitEnd;
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
};

function AnimWhipHit_WaitEnd(sprite: Sprite): void {
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

// ------------------------------------------------------------------ battle_anim_effects_2.c

/** AnimMagentaHeart (Status_Infatuation) */
const AnimMagentaHeart: SpriteCallback = (sprite) => {
  if (++sprite.data[0] === 1) InitSpritePosToAnimAttacker(sprite, false);
  sprite.x2 = Sin(sprite.data[1], 8);
  sprite.y2 = sprite.data[2] >> 8;
  sprite.data[1] = (sprite.data[1] + 7) & 0xff;
  sprite.data[2] -= 0x80;
  if (sprite.data[0] === 60) DestroyAnimSprite(sprite);
};

// ------------------------------------------------------------------ battle_anim_effects_3.c

/** AnimLeer: the eyes appear by the attacker. Args: x, y. */
const AnimLeer: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
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

// ------------------------------------------------------------------ battle_anim_fire.c

/** AnimEmberFlare: AnimTravelDiagonally, mirrored for a right-hand attacker on the target's side */
const AnimEmberFlare: SpriteCallback = (sprite) => {
  if (
    getBattlerSide(anim.attacker) === getBattlerSide(anim.target) &&
    (anim.attacker === getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT) || anim.attacker === getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT))
  )
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.callback = AnimTravelDiagonally;
  sprite.callback(sprite);
};

/** AnimBurnFlame (Status_Burn) */
const AnimBurnFlame: SpriteCallback = (sprite) => {
  gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.callback = AnimTravelDiagonally;
};

// ------------------------------------------------------------------ battle_anim_water.c

// AnimWaterBubbleProjectile (Bubble, BubbleBeam): bubbles swaying to the target, then popping. A helper
// invisible sprite carries the wave state. Args: x, y, x amplitude, y amplitude, wave offset, wave speed, duration.
const AnimWaterBubbleProjectile: SpriteCallback = (sprite) => {
  const ax = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  const ay = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.x = isOpponent(anim.attacker) ? ax - gBattleAnimArgs[0] : ax + gBattleAnimArgs[0];
  sprite.y = ay + gBattleAnimArgs[1];
  sprite.animPaused = true;
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[6];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  const spriteId = CreateInvisibleSprite(SpriteCallbackDummy);
  d[5] = spriteId;
  sprite.x -= Sin(gBattleAnimArgs[4] & 0xff, gBattleAnimArgs[2]);
  sprite.y -= Cos(gBattleAnimArgs[4] & 0xff, gBattleAnimArgs[3]);
  const o = gSprites[spriteId].data;
  o[0] = gBattleAnimArgs[2];
  o[1] = gBattleAnimArgs[3];
  o[2] = gBattleAnimArgs[5];
  o[3] = (gBattleAnimArgs[4] & 0xff) * 256;
  o[4] = gBattleAnimArgs[6];
  sprite.callback = AnimWaterBubbleProjectile_Step1;
  sprite.callback(sprite);
};

function AnimWaterBubbleProjectile_Step1(sprite: Sprite): void {
  const other = gSprites[sprite.data[5] & 0xff];
  let timer = other.data[4] & 0xff;
  const trigIndex = other.data[3] & 0xffff;
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  sprite.x2 += Sin(trigIndex >> 8, other.data[0]);
  sprite.y2 += Cos(trigIndex >> 8, other.data[1]);
  other.data[3] = trigIndex + other.data[2];
  timer = (timer - 1) & 0xff;
  if (timer !== 0) {
    other.data[4] = timer;
  } else {
    sprite.callback = AnimWaterBubbleProjectile_Step2;
    DestroySprite(other);
  }
}

function AnimWaterBubbleProjectile_Step2(sprite: Sprite): void {
  sprite.animPaused = false;
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimWaterBubbleProjectile_Step3);
}

function AnimWaterBubbleProjectile_Step3(sprite: Sprite): void {
  sprite.data[0] = 10;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

// AnimToTargetInSinWave (Flamethrower, Hydro Pump): gBattleAnimArgs[7] is the AnimTask_StartSinAnimTimer phase.
const AnimToTargetInSinWave: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = 30;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  d[5] = Math.trunc(0xd200 / d[0]);
  d[7] = gBattleAnimArgs[3];
  const retArg = gBattleAnimArgs[7] & 0xffff;
  if (gBattleAnimArgs[7] > 127) {
    d[6] = (retArg - 127) * 256;
    d[7] = -d[7];
  } else {
    d[6] = retArg * 256;
  }
  sprite.callback = AnimToTargetInSinWave_Step;
  sprite.callback(sprite);
};

function AnimToTargetInSinWave_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
  sprite.y2 += Sin((d[6] >> 8) & 0xff, d[7]);
  if ((d[6] + d[5]) >> 8 > 127) {
    d[6] = 0;
    d[7] = -d[7];
  } else {
    d[6] += d[5];
  }
}

const AnimTask_StartSinAnimTimer: TaskFunc = (taskId) => {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  gBattleAnimArgs[7] = 0;
  gTasks[taskId].func = AnimTask_RunSinAnimTimer;
};

const AnimTask_RunSinAnimTimer: TaskFunc = (taskId) => {
  gBattleAnimArgs[7] = (gBattleAnimArgs[7] + 3) & 0xff;
  if (--gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
};

/** AnimWaterGunDroplet: drips down from the impact. Args: x, y, target x, -, duration. */
const AnimWaterGunDroplet: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + gBattleAnimArgs[4];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSmallBubblePair: bubbles rising and swaying. Args: x, y, duration, battler. */
const AnimSmallBubblePair: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[3] !== K.ANIM_ATTACKER) InitSpritePosToAnimTarget(sprite, true);
  else InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.callback = AnimSmallBubblePair_Step;
};

function AnimSmallBubblePair_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0] = (d[0] + 11) & 0xff;
  sprite.x2 = Sin(d[0], 4);
  d[1] += 48;
  sprite.y2 = -(d[1] >> 8);
  if (d[7]-- === 0) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ battle_anim_poison.c

/** AnimBubbleEffect: a bubble rising and growing (poison moves, Bubble). Args: x, y, both targets. */
const AnimBubbleEffect: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) {
    InitSpritePosToAnimTarget(sprite, true);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    sprite.x = p.x;
    sprite.y = p.y;
    if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.callback = AnimBubbleEffect_Step;
};

function AnimBubbleEffect_Step(sprite: Sprite): void {
  sprite.data[0] = (sprite.data[0] + 0xb) & 0xff;
  sprite.x2 = Sin(sprite.data[0], 4);
  sprite.data[1] += 0x30;
  sprite.y2 = -(sprite.data[1] >> 8);
  if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ battle_anim_electric.c

/** AnimElectricity: arcs over the target (Status_Paralysis, electric hits). Args: x, y, duration, frame. */
const AnimElectricity: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.oam.tileNum += gBattleAnimArgs[3] * 4;
  if (gBattleAnimArgs[3] === 1) sprite.oam.matrixNum = 0x08; // ST_OAM_HFLIP
  else if (gBattleAnimArgs[3] === 2) sprite.oam.matrixNum = 0x10; // ST_OAM_VFLIP
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// AnimTask_ElectricBolt: the falling bolt (Thunder Shock/Wave/bolt). Args: x, y, wide (0/1).
const AnimTask_ElectricBolt: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
  d[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ElectricBolt_Step;
};

const AnimTask_ElectricBolt_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sp = d[2] & 0xff;
  const x = d[0];
  const y = d[1];
  let r8 = d[2] ? 8 : 0;
  const r2 = d[2] ? 4 : 1;
  let r12 = 16;
  let spriteId = 0;
  let created = false;
  const segment = animSpriteTemplate('sElectricBoltSegmentSpriteTemplate')!;
  switch (d[10]) {
    case 0:
    case 2:
    case 4:
    case 6:
    case 8: {
      const n = d[10] / 2; // 0..4
      r12 *= n + 1;
      if (n >= 1 && n <= 3) r8 += r2 * n;
      spriteId = CreateSprite(segment, x, y + r12, 2);
      created = true;
      break;
    }
    case 10:
      DestroyAnimVisualTask(taskId);
      return;
  }
  if (created) {
    gSprites[spriteId].oam.tileNum += r8;
    gSprites[spriteId].data[0] = sp;
    gSprites[spriteId].callback(gSprites[spriteId]);
  }
  d[10]++;
};

const AnimElectricBoltSegment: SpriteCallback = (sprite) => {
  const dim = !sprite.data[0] ? SPRITE_SHAPE['8x16'] : SPRITE_SHAPE['16x16'];
  sprite.oam.shape = dim[0];
  sprite.oam.size = dim[1];
  if (++sprite.data[1] === 15) DestroySprite(sprite);
};

/** AnimThunderWave: two flickering bands (the second sprite is the template's right half) */
const AnimThunderWave: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  const spriteId = CreateSprite(animSpriteTemplate('gThunderWaveSpriteTemplate')!, sprite.x + 32, sprite.y, sprite.subpriority);
  gSprites[spriteId].oam.tileNum += 8;
  anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
  gSprites[spriteId].callback = AnimThunderWave_Step;
  sprite.callback = AnimThunderWave_Step;
};

function AnimThunderWave_Step(sprite: Sprite): void {
  if (++sprite.data[0] === 3) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
  }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ battle_anim_flying.c

/** AnimEllipticalGust: the tornado circling the target */
const AnimEllipticalGust: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.y += 20;
  sprite.data[1] = 191;
  sprite.callback = AnimEllipticalGust_Step;
  sprite.callback(sprite);
};

function AnimEllipticalGust_Step(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[1], 32);
  sprite.y2 = Cos(sprite.data[1], 8);
  sprite.data[1] = (sprite.data[1] + 5) & 0xff;
  if (++sprite.data[0] === 71) DestroyAnimSprite(sprite);
}

/** AnimTask_AnimateGustTornadoPalette: rotates colours 1-8 of the gust palette. Args: delay, duration. */
const AnimTask_AnimateGustTornadoPalette: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = gBattleAnimArgs[0];
  d[2] = IndexOfSpritePaletteTag(K.ANIM_TAG_GUST);
  gTasks[taskId].func = AnimTask_AnimateGustTornadoPalette_Step;
};

const AnimTask_AnimateGustTornadoPalette_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[10]++ === d[1]) {
    d[10] = 0;
    const data2 = d[2] & 0xff;
    const temp = gPlttBufferFaded[OBJ_PLTT_ID(data2) + 8];
    const base = PLTT_ID(data2) + OBJ_PLTT_OFFSET;
    for (let i = 7; i > 0; i--) gPlttBufferFaded[base + 1 + i] = gPlttBufferFaded[base + i];
    gPlttBufferFaded[base + 1] = temp;
  }
  if (--d[0] === 0) DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ battle_anim_ground.c

/** AnimDirtScatter (Sand-Attack, Mud-Slap): to a random spot on the target. Args: x, y, duration. */
const AnimDirtScatter: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const targetXPos = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_X_2) & 0xff;
  const targetYPos = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) & 0xff;
  let xOffset = random() & 0x1f;
  let yOffset = random() & 0x1f;
  if (xOffset > 16) xOffset = 16 - xOffset;
  if (yOffset > 16) yOffset = 16 - yOffset;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = targetXPos + xOffset;
  sprite.data[4] = targetYPos + yOffset;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

// ------------------------------------------------------------------ battle_anim_bug.c

// AnimTranslateWebThread (String Shot). Args: x, y, speed, amplitude, both targets.
const AnimTranslateWebThread: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = sprite.x;
  d[3] = sprite.y;
  if (!gBattleAnimArgs[4]) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    d[2] = p.x;
    d[4] = p.y;
  }
  InitAnimLinearTranslationWithSpeed(sprite);
  d[5] = gBattleAnimArgs[3];
  sprite.callback = AnimTranslateWebThread_Step;
};

function AnimTranslateWebThread_Step(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) {
    DestroyAnimSprite(sprite);
    return;
  }
  sprite.x2 += Sin(sprite.data[6], sprite.data[5]);
  sprite.data[6] = (sprite.data[6] + 13) & 0xff;
}

/** AnimStringWrap: the string around the target, flickering. Args: x, y. */
const AnimStringWrap: SpriteCallback = (sprite) => {
  const p = SetAverageBattlerPositions(anim.target, false);
  sprite.x = p.x;
  sprite.y = p.y;
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimStringWrap_Step;
};

function AnimStringWrap_Step(sprite: Sprite): void {
  if (++sprite.data[0] === 3) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
  }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

/** AnimTranslateStinger (Poison Sting, Twineedle): rotated to point along its path. Args: x, y, target x, target y, duration. */
const AnimTranslateStinger: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  if (getBattlerSide(anim.attacker) === getBattlerSide(anim.target)) {
    const pos = getBattlerPosition(anim.target);
    if (pos === K.B_POSITION_PLAYER_LEFT || pos === K.B_POSITION_OPPONENT_LEFT) {
      gBattleAnimArgs[2] = -gBattleAnimArgs[2];
      gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    }
  }
  InitSpritePosToAnimAttacker(sprite, true);
  const lVarX = (GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2]) << 16 >> 16;
  const lVarY = (GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3]) << 16 >> 16;
  const rot = (ArcTan2Neg(lVarX - sprite.x, lVarY - sprite.y) + 0xc000) & 0xffff;
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rot);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = lVarX;
  sprite.data[4] = lVarY;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// ------------------------------------------------------------------ battle_anim_dark.c

/** AnimBite: the jaws close in and back. Args: x, y, affine anim, x speed, y speed, duration. */
const AnimBite: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = gBattleAnimArgs[4];
  sprite.data[2] = gBattleAnimArgs[5];
  sprite.callback = AnimBite_Step1;
};

function AnimBite_Step1(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[0];
  d[5] += d[1];
  sprite.x2 = d[4] >> 8;
  sprite.y2 = d[5] >> 8;
  if (++d[3] === d[2]) sprite.callback = AnimBite_Step2;
}

function AnimBite_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[4] -= d[0];
  d[5] -= d[1];
  sprite.x2 = d[4] >> 8;
  sprite.y2 = d[5] >> 8;
  if (--d[3] === 0) DestroySpriteAndMatrix(sprite);
}

const WININ_DEFAULT = WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR;

// AnimTask_MetallicShine (Harden, Iron Defense, Poison Tail): a shine scrolling over the attacker
// behind an OBJ window copy, the mon greyed (or tinted with arg 2 when arg 1 is set). Arg 0: keep
// the palette afterwards.
const AnimTask_MetallicShine: TaskFunc = (taskId) => {
  let priorityChanged = false;
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | WINOUT_WIN01_BG0 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(8, 12));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  if (IsDoubleBattle()) {
    const pos = getBattlerPosition(anim.attacker);
    if ((pos === K.B_POSITION_OPPONENT_RIGHT || pos === K.B_POSITION_PLAYER_LEFT) && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) {
      gSprites[g.battlerSpriteIds[BATTLE_PARTNER(anim.attacker)]].oam.priority--;
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
      priorityChanged = true;
    }
  }
  const party = isOpponent(anim.attacker) ? g.enemyParty : g.playerParty;
  const species = party[g.battlerPartyIndexes[anim.attacker]]?.species ?? 0;
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  const newSpriteId = CreateInvisibleSpriteCopy(anim.attacker, spriteId, species);
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gMetalShineTilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gMetalShineGfx', animBg.tilesOffset);
  LoadCompressedPalette(gfx16('gMetalShinePalette'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  g.battle_BG1_X = -gSprites[spriteId].x + 96;
  g.battle_BG1_Y = -gSprites[spriteId].y + 32;
  const paletteNum = 16 + gSprites[spriteId].oam.paletteNum;
  if (gBattleAnimArgs[1] === 0) SetGreyscaleOrOriginalPalette(paletteNum, false);
  else BlendPalette(PLTT_ID(paletteNum), 16, 11, gBattleAnimArgs[2] & 0xffff);
  const d = gTasks[taskId].data;
  d[0] = newSpriteId;
  d[1] = gBattleAnimArgs[0];
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[6] = +priorityChanged;
  gTasks[taskId].func = AnimTask_MetallicShine_Step;
};

const AnimTask_MetallicShine_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[10] += 4;
  g.battle_BG1_X -= 4;
  if (d[10] === 128) {
    d[10] = 0;
    g.battle_BG1_X += 128;
    d[11]++;
    if (d[11] === 2) {
      const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      const paletteNum = 16 + gSprites[spriteId].oam.paletteNum;
      if (d[1] === 0) SetGreyscaleOrOriginalPalette(paletteNum, true);
      DestroySprite(gSprites[d[0]]);
      InitBattleAnimBg(GetBattleAnimBg1Data().bgId);
      if (d[6] === 1) gSprites[g.battlerSpriteIds[BATTLE_PARTNER(anim.attacker)]].oam.priority++;
    } else if (d[11] === 3) {
      g.battle_WIN0H = 0;
      g.battle_WIN0V = 0;
      SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
      SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) ^ DISPCNT_OBJWIN_ON);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
    }
  }
};

/** AnimTask_SetGrayscaleOrOriginalPal. Args: battler (0-3 anim battler, 4-7 position), 0 grey / 1 original. */
const AnimTask_SetGrayscaleOrOriginalPal: TaskFunc = (taskId) => {
  let spriteId: number = SPRITE_NONE;
  const a = gBattleAnimArgs[0];
  if (a >= K.ANIM_ATTACKER && a <= K.ANIM_DEF_PARTNER) {
    spriteId = GetAnimBattlerSpriteId(a);
  } else if (a >= 4 && a <= 7) {
    const position = [K.B_POSITION_PLAYER_LEFT, K.B_POSITION_PLAYER_RIGHT, K.B_POSITION_OPPONENT_LEFT, K.B_POSITION_OPPONENT_RIGHT][a - 4];
    const battler = getBattlerAtPosition(position);
    spriteId = IsBattlerSpriteVisible(battler) ? g.battlerSpriteIds[battler] : SPRITE_NONE;
  }
  if (spriteId !== SPRITE_NONE) SetGreyscaleOrOriginalPalette(gSprites[spriteId].oam.paletteNum + 16, !!gBattleAnimArgs[1]);
  DestroyAnimVisualTask(taskId);
};

/** GetIsDoomDesireHitTurn */
const GetIsDoomDesireHitTurn: TaskFunc = (taskId) => {
  if (anim.moveTurn < 2) gBattleAnimArgs[7] = 0;
  if (anim.moveTurn === 2) gBattleAnimArgs[7] = 1;
  DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ battle_anim_ghost.c

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

export const moveSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMovePowderParticle,
  AnimPowerAbsorptionOrb,
  AnimAbsorptionOrb,
  AnimLeechSeed,
  AnimWhipHit,
  AnimSleepLetterZ,
  AnimMagentaHeart,
  AnimLeer,
  AnimRoarNoiseLine,
  AnimEmberFlare,
  AnimBurnFlame,
  AnimWaterBubbleProjectile,
  AnimToTargetInSinWave,
  AnimWaterGunDroplet,
  AnimSmallBubblePair,
  AnimBubbleEffect,
  AnimElectricity,
  AnimElectricBoltSegment,
  AnimThunderWave,
  AnimEllipticalGust,
  AnimDirtScatter,
  AnimTranslateWebThread,
  AnimStringWrap,
  AnimTranslateStinger,
  AnimBite,
  AnimGhostStatusSprite,
};

export const moveTasks: Record<string, TaskFunc> = {
  AnimTask_StartSinAnimTimer,
  AnimTask_ElectricBolt,
  AnimTask_AnimateGustTornadoPalette,
  AnimTask_MetallicShine,
  AnimTask_SetGrayscaleOrOriginalPal,
  GetIsDoomDesireHitTurn,
  AnimTask_MonToSubstitute,
};

export function registerMovesExtraGfx(): void {
  registerAnimExtraGfx({ AnimTask_MetallicShine: ['gMetalShineTilemap', 'gMetalShineGfx', 'gMetalShinePalette'] });
}
