// battle_anim_electric.c: every sprite callback and task in the file (including the unused ones).

import {
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  gOamMatrices,
  gSprites,
  MAX_SPRITES,
  SPRITE_SHAPE,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  BATTLE_PARTNER,
  DestroyAnimSpriteAfterTimer,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteCoord,
  GetBattlerSpriteSubpriority,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  RunStoredCallbackWhenAffineAnimEnds,
  RunStoredCallbackWhenAnimEnds,
  TranslateSpriteInCircle,
  WaitAnimForDuration,
} from './animMons';
import { PlaySE12WithPanning } from '../../gba/sound';
import { animSpriteTemplate, BattleAnimAdjustPanning, IsContest } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimLightning (Thunder, Thunder Punch): plays its anim once. Args: x, y. */
const AnimLightning: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = AnimLightning_Step;
};

function AnimLightning_Step(sprite: Sprite): void {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimUnusedSpinningFist (sUnusedSpinningFistSpriteTemplate, no script uses it) */
const AnimUnusedSpinningFist: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.callback = AnimUnusedSpinningFist_Step;
};

function AnimUnusedSpinningFist_Step(sprite: Sprite): void {
  if (sprite.affineAnimEnded) DestroySpriteAndMatrix(sprite);
}

/** AnimUnusedCirclingShock (sUnusedCirclingShockSpriteTemplate, no script uses it) */
const AnimUnusedCirclingShock: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (isOpponent(anim.attacker)) {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y -= gBattleAnimArgs[1];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInCircle;
};

// AnimSparkElectricity (Spark): a rotated spark at a polar offset from a battler, gone after a delay.
// Args: angle, distance, rotation, duration, battler, respect pic offsets, behind the mon (bit 0).
const AnimSparkElectricity: SpriteCallback = (sprite) => {
  let battler: number;
  switch (gBattleAnimArgs[4]) {
    case K.ANIM_ATTACKER:
      battler = anim.attacker;
      break;
    case K.ANIM_ATK_PARTNER:
      battler = IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker)) ? BATTLE_PARTNER(anim.attacker) : anim.attacker;
      break;
    case K.ANIM_DEF_PARTNER:
      // sic: checks the attacker's partner
      battler = IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker)) ? BATTLE_PARTNER(anim.target) : anim.target;
      break;
    case K.ANIM_TARGET:
    default:
      battler = anim.target;
      break;
  }
  if (gBattleAnimArgs[5] === 0) {
    sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
    sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  } else {
    sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  }
  sprite.x2 = ((gSineTable(gBattleAnimArgs[0]) * gBattleAnimArgs[1]) >> 8) << 16 >> 16;
  sprite.y2 = ((gSineTable(gBattleAnimArgs[0] + 64) * gBattleAnimArgs[1]) >> 8) << 16 >> 16;
  if (gBattleAnimArgs[6] & 1) sprite.oam.priority = (GetBattlerSpriteBGPriority(battler) + 1) & 3;
  const m = gOamMatrices[sprite.oam.matrixNum];
  const sineVal = gSineTable(gBattleAnimArgs[2]);
  m.a = m.d = gSineTable(gBattleAnimArgs[2] + 64);
  m.b = sineVal;
  m.c = -sineVal;
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.callback = DestroyAnimSpriteAfterTimer;
};

// AnimZapCannonSpark: flies to the target circling and flickering. Args: x, y, radius, duration, wave
// offset, wave speed, frame.
const AnimZapCannonSpark: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  d[5] = gBattleAnimArgs[2];
  d[6] = gBattleAnimArgs[5];
  d[7] = gBattleAnimArgs[4];
  sprite.oam.tileNum += gBattleAnimArgs[6] * 4;
  sprite.callback = AnimZapCannonSpark_Step;
  sprite.callback(sprite);
};

function AnimZapCannonSpark_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[7], d[5]);
    sprite.y2 += Cos(d[7], d[5]);
    d[7] = (d[7] + d[6]) & 0xff;
    if (!(d[7] % 3)) sprite.invisible = !sprite.invisible;
  } else {
    DestroyAnimSprite(sprite);
  }
}

function AnimThunderboltOrb_Step(sprite: Sprite): void {
  if (--sprite.data[5] === -1) {
    sprite.invisible = !sprite.invisible;
    sprite.data[5] = sprite.data[4];
  }
  if (sprite.data[3]-- <= 0) DestroyAnimSprite(sprite);
}

/** AnimThunderboltOrb: a flickering orb by the target. Args: duration, x, y, flicker delay. */
const AnimThunderboltOrb: SpriteCallback = (sprite) => {
  if (IsContest() || getBattlerSide(anim.target) === K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  sprite.data[3] = gBattleAnimArgs[0];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[3];
  sprite.callback = AnimThunderboltOrb_Step;
};

// AnimSparkElectricityFlashing (Thunderbolt, Spark): circles a battler, flickering. Args: x, y, radius,
// duration, wave offset, wave speed, frame, flicker period (bit 15: around the target).
const AnimSparkElectricityFlashing: SpriteCallback = (sprite) => {
  sprite.data[0] = gBattleAnimArgs[3];
  const battler = gBattleAnimArgs[7] & 0x8000 ? anim.target : anim.attacker;
  if (IsContest() || getBattlerSide(battler) === K.B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  sprite.data[4] = gBattleAnimArgs[7] & 0x7fff;
  sprite.data[5] = gBattleAnimArgs[2];
  sprite.data[6] = gBattleAnimArgs[5];
  sprite.data[7] = gBattleAnimArgs[4];
  sprite.oam.tileNum += gBattleAnimArgs[6] * 4;
  sprite.callback = AnimSparkElectricityFlashing_Step;
  sprite.callback(sprite);
};

function AnimSparkElectricityFlashing_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[7], d[5]);
  sprite.y2 = Cos(d[7], d[5]);
  d[7] = (d[7] + d[6]) & 0xff;
  if (d[7] % d[4] === 0) sprite.invisible = !sprite.invisible;
  if (d[0]-- <= 0) DestroyAnimSprite(sprite);
}

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

// ------------------------------------------------------------------ Charge, Volt Tackle, Shock Wave

const sElectricChargingParticleCoordOffsets = [
  [58, -60],
  [-56, -36],
  [8, -56],
  [-16, 56],
  [58, -10],
  [-58, 10],
  [48, -18],
  [-8, 56],
  [16, -56],
  [-58, -42],
  [58, 30],
  [-48, 40],
  [12, -48],
  [48, -12],
  [-56, 18],
  [48, 48],
];

// AnimTask_ElectricChargingParticles (Charge, Shock Wave): particles (gElectricChargingParticlesSpriteTemplate)
// fly in to a battler, faster and faster. Args: battler (0 attacker), count, delay, particles per speed-up.
const AnimTask_ElectricChargingParticles: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  d[14] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  d[15] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[6] = gBattleAnimArgs[1];
  d[7] = 0;
  d[8] = 0;
  d[9] = 0;
  d[10] = 0;
  d[11] = gBattleAnimArgs[3];
  d[12] = 0;
  d[13] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ElectricChargingParticles_Step;
};

const AnimTask_ElectricChargingParticles_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[6]) {
    if (++d[12] > d[13]) {
      d[12] = 0;
      const spriteId = CreateSprite(animSpriteTemplate('gElectricChargingParticlesSpriteTemplate')!, d[14], d[15], 2);
      if (spriteId !== MAX_SPRITES) {
        const sprite = gSprites[spriteId];
        sprite.x += sElectricChargingParticleCoordOffsets[d[9]][0];
        sprite.y += sElectricChargingParticleCoordOffsets[d[9]][1];
        sprite.data[0] = 40 - d[8] * 5;
        sprite.data[1] = sprite.x;
        sprite.data[2] = d[14];
        sprite.data[3] = sprite.y;
        sprite.data[4] = d[15];
        sprite.data[5] = taskId;
        InitAnimLinearTranslation(sprite);
        StoreSpriteCallbackInData6(sprite, AnimElectricChargingParticles);
        sprite.callback = RunStoredCallbackWhenAnimEnds;
        if (++d[9] > 15) d[9] = 0;
        if (++d[10] >= d[11]) {
          d[10] = 0;
          if (d[8] <= 5) ++d[8];
        }
        ++d[7];
        --d[6];
      }
    }
  } else if (d[7] === 0) {
    DestroyAnimVisualTask(taskId);
  }
};

function AnimElectricChargingParticles_Step(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) {
    --gTasks[sprite.data[5]].data[7];
    DestroySprite(sprite);
  }
}

function AnimElectricChargingParticles(sprite: Sprite): void {
  StartSpriteAnim(sprite, 1);
  sprite.callback = AnimElectricChargingParticles_Step;
}

/** AnimGrowingChargeOrb (Charge): grows on a battler until its affine anim ends. Arg 0: battler. */
const AnimGrowingChargeOrb: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

/** AnimElectricPuff (Charge, Volt Tackle): a quick burst on a battler. Args: battler, x, y. */
const AnimElectricPuff: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.x2 = gBattleAnimArgs[1];
  sprite.y2 = gBattleAnimArgs[2];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

/** AnimVoltTackleOrbSlide: an orb grows on the attacker, then slides off-screen taking the attacker with it */
const AnimVoltTackleOrbSlide: SpriteCallback = (sprite) => {
  StartSpriteAffineAnim(sprite, 1);
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[6] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  sprite.data[7] = 16;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) sprite.data[7] *= -1;
  sprite.callback = AnimVoltTackleOrbSlide_Step;
};

function AnimVoltTackleOrbSlide_Step(sprite: Sprite): void {
  switch (sprite.data[0]) {
    case 0:
      if (++sprite.data[1] > 40) ++sprite.data[0];
      break;
    case 1:
      sprite.x += sprite.data[7];
      gSprites[sprite.data[6]].x2 += sprite.data[7];
      if (((sprite.x + 80) & 0xffff) > 400) DestroySpriteAndMatrix(sprite);
      break;
  }
}

/** AnimTask_VoltTackleAttackerReappear: the attacker slides back in from its side, flickering */
const AnimTask_VoltTackleAttackerReappear: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      d[14] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
      if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
        d[14] = -32;
        d[13] = 2;
      } else {
        d[14] = 32;
        d[13] = -2;
      }
      gSprites[d[15]].x2 = d[14];
      ++d[0];
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        gSprites[d[15]].invisible = !gSprites[d[15]].invisible;
        if (d[14]) {
          d[14] += d[13];
          gSprites[d[15]].x2 = d[14];
        } else {
          ++d[0];
        }
      }
      break;
    case 2:
      if (++d[1] > 1) {
        d[1] = 0;
        gSprites[d[15]].invisible = !gSprites[d[15]].invisible;
        if (++d[2] === 8) ++d[0];
      }
      break;
    case 3:
      gSprites[d[15]].invisible = false;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// AnimTask_VoltTackleBolt: a horizontal bolt of gVoltTackleBoltSpriteTemplate segments. Arg 0: 0 from the
// attacker, 4 into the target, otherwise one of the full-width bolts (1-3) at different heights.
const AnimTask_VoltTackleBolt: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[1] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? 1 : -1;
      switch (gBattleAnimArgs[0]) {
        case 0:
          d[3] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
          d[5] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
          d[4] = d[1] * 128 + 120;
          break;
        case 4:
          d[3] = 120 - d[1] * 128;
          d[5] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
          d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) - d[1] * 32;
          break;
        default:
          if ((gBattleAnimArgs[0] & 1) !== 0) {
            d[3] = 256;
            d[4] = -16;
          } else {
            d[3] = -16;
            d[4] = 256;
          }
          if (d[1] === 1) {
            d[5] = 80 - gBattleAnimArgs[0] * 10;
          } else {
            d[5] = gBattleAnimArgs[0] * 10 + 40;
            const temp = d[3];
            d[3] = d[4];
            d[4] = temp;
          }
      }
      if (d[3] < d[4]) {
        d[1] = 1;
        d[6] = 0;
      } else {
        d[1] = -1;
        d[6] = 3;
      }
      ++d[0];
      break;
    case 1:
      if (++d[2] > 0) {
        d[2] = 0;
        if (CreateVoltTackleBolt(task, taskId) || CreateVoltTackleBolt(task, taskId)) ++d[0];
      }
      break;
    case 2:
      if (d[7] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

function CreateVoltTackleBolt(task: Task, taskId: number): boolean {
  const d = task.data;
  const spriteId = CreateSprite(animSpriteTemplate('gVoltTackleBoltSpriteTemplate')!, d[3], d[5], 35);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].data[6] = taskId;
    gSprites[spriteId].data[7] = 7;
    ++d[7];
  }
  d[6] += d[1];
  if (d[6] < 0) d[6] = 3;
  if (d[6] > 3) d[6] = 0;
  d[3] += d[1] * 16;
  return (d[1] === 1 && d[3] >= d[4]) || (d[1] === -1 && d[3] <= d[4]);
}

/** AnimVoltTackleBolt (gVoltTackleBoltSpriteTemplate, made by AnimTask_VoltTackleBolt) */
const AnimVoltTackleBolt: SpriteCallback = (sprite) => {
  if (++sprite.data[0] > 12) {
    --gTasks[sprite.data[6]].data[sprite.data[7]];
    FreeOamMatrix(sprite.oam.matrixNum);
    DestroySprite(sprite);
  }
};

/** AnimGrowingShockWaveOrb (Shock Wave): grows on the attacker */
const AnimGrowingShockWaveOrb: SpriteCallback = (sprite) => {
  switch (sprite.data[0]) {
    case 0:
      sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
      sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
      StartSpriteAffineAnim(sprite, 2);
      ++sprite.data[0];
      break;
    case 1:
      if (sprite.affineAnimEnded) DestroySpriteAndMatrix(sprite);
      break;
  }
};

// AnimTask_ShockWaveProgressingBolt: a zigzag bolt of sShockWaveProgressingBoltSpriteTemplate segments from
// the attacker to the target, in five legs.
const AnimTask_ShockWaveProgressingBolt: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[6] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
      d[7] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
      d[8] = 4;
      d[10] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
      d[9] = Math.trunc((d[10] - d[6]) / 5);
      d[4] = 7;
      d[5] = -1;
      d[11] = 12;
      d[12] = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
      d[13] = BattleAnimAdjustPanning(K.SOUND_PAN_TARGET);
      d[14] = d[12];
      d[15] = Math.trunc((d[13] - d[12]) / 3);
      ++d[0];
      break;
    case 1:
      if (++d[1] > 0) {
        d[1] = 0;
        if (CreateShockWaveBoltSprite(task, taskId)) {
          if (d[2] === 5) d[0] = 3;
          else ++d[0];
        }
      }
      if (d[11]) --d[11];
      break;
    case 2:
      if (d[11]) --d[11];
      if (++d[1] > 4) {
        d[1] = 0;
        if (d[2] & 1) {
          d[7] = 4;
          d[8] = 68;
          d[4] = 0;
          d[5] = 1;
        } else {
          d[7] = 68;
          d[8] = 4;
          d[4] = 7;
          d[5] = -1;
        }
        d[0] = d[11] ? 4 : 1;
      }
      break;
    case 3:
      if (d[3] === 0) DestroyAnimVisualTask(taskId);
      break;
    case 4:
      if (d[11]) --d[11];
      else d[0] = 1;
      break;
  }
};

function CreateShockWaveBoltSprite(task: Task, taskId: number): boolean {
  const d = task.data;
  const spriteId = CreateSprite(animSpriteTemplate('sShockWaveProgressingBoltSpriteTemplate')!, d[6], d[7], 35);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].oam.tileNum += d[4];
    d[4] += d[5];
    if (d[4] < 0) d[4] = 7;
    if (d[4] > 7) d[4] = 0;
    gSprites[spriteId].data[6] = taskId;
    gSprites[spriteId].data[7] = 3;
    ++d[3];
  }
  if (d[4] === 0 && d[5] > 0) {
    d[14] += d[15];
    PlaySE12WithPanning(K.SE_M_THUNDERBOLT, d[14]);
  }
  if ((d[5] < 0 && d[7] <= d[8]) || (d[5] > 0 && d[7] >= d[8])) {
    ++d[2];
    d[6] += d[9];
    return true;
  }
  d[7] += d[5] * 8;
  return false;
}

/** AnimShockWaveProgressingBolt: a segment's timer (see AnimTask_ShockWaveProgressingBolt) */
const AnimShockWaveProgressingBolt: SpriteCallback = (sprite) => {
  if (++sprite.data[0] > 12) {
    --gTasks[sprite.data[6]].data[sprite.data[7]];
    DestroySprite(sprite);
  }
};

/** AnimTask_ShockWaveLightning: a column of gLightningSpriteTemplate bolts down onto the target */
const AnimTask_ShockWaveLightning: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[15] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 32;
      d[14] = d[15];
      while (d[14] > 16) d[14] -= 32;
      d[13] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
      d[12] = GetBattlerSpriteSubpriority(anim.target) - 2;
      ++d[0];
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        if (CreateShockWaveLightningSprite(task, taskId)) ++d[0];
      }
      break;
    case 2:
      if (d[10] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

function CreateShockWaveLightningSprite(task: Task, taskId: number): boolean {
  const d = task.data;
  const spriteId = CreateSprite(animSpriteTemplate('gLightningSpriteTemplate')!, d[13], d[14], d[12] & 0xff);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].callback = AnimShockWaveLightning;
    gSprites[spriteId].data[6] = taskId;
    gSprites[spriteId].data[7] = 10;
    ++d[10];
  }
  if (d[14] >= d[15]) return true;
  d[14] += 32;
  return false;
}

function AnimShockWaveLightning(sprite: Sprite): void {
  if (sprite.animEnded) {
    --gTasks[sprite.data[6]].data[sprite.data[7]];
    DestroySprite(sprite);
  }
}

export const electricSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimLightning,
  AnimUnusedSpinningFist,
  AnimUnusedCirclingShock,
  AnimSparkElectricity,
  AnimZapCannonSpark,
  AnimThunderboltOrb,
  AnimSparkElectricityFlashing,
  AnimElectricity,
  AnimElectricBoltSegment,
  AnimThunderWave,
  AnimGrowingChargeOrb,
  AnimElectricPuff,
  AnimVoltTackleOrbSlide,
  AnimVoltTackleBolt,
  AnimGrowingShockWaveOrb,
  AnimShockWaveProgressingBolt,
};

export const electricTasks: Record<string, TaskFunc> = {
  AnimTask_ElectricBolt,
  AnimTask_ElectricChargingParticles,
  AnimTask_VoltTackleAttackerReappear,
  AnimTask_VoltTackleBolt,
  AnimTask_ShockWaveProgressingBolt,
  AnimTask_ShockWaveLightning,
};
