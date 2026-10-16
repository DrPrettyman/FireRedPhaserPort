// battle_anim_flying.c: every sprite callback and task in the file (including the unused ones).
// DestroyAnimSpriteAfterTimer, also defined there, lives in animMons.ts with the other shared helpers.

import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../../gba/hw';
import { gPlttBufferFaded, OBJ_PLTT_ID, OBJ_PLTT_OFFSET, PLTT_ID } from '../../gba/palette';
import {
  CreateSpriteAndAnimate,
  gOamMatrices,
  gSprites,
  IndexOfSpritePaletteTag,
  SeekSpriteAnim,
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
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  ArcTan2Neg,
  DestroyAnimSpriteAfterTimer,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteCoord,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  RunStoredCallbackWhenAffineAnimEnds,
  SetAverageBattlerPositions,
  StartAnimLinearTranslation,
  TranslateAnimSpriteToTargetMonLocation,
  TrySetSpriteRotScale,
  TryResetSpriteAffineState,
} from './animMons';
import { animSpriteTemplate, IsContest } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

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

/** AnimGustToTarget (Wing Attack, Steel Wing): flies to the target once its affine anim ends. Args: x, y, target x, target y, duration. */
const AnimGustToTarget: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  InitAnimLinearTranslation(sprite);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimGustToTarget_Step);
};

function AnimGustToTarget_Step(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
}

// AnimAirWaveCrescent (Razor Wind, Aeroblast): flies from the attacker to the target (or the middle of
// both targets). Args: x, y, target x, target y, duration, anim frame, both targets.
const AnimAirWaveCrescent: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  if (IsContest()) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  if (gBattleAnimArgs[6] === 0) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    const avg = SetAverageBattlerPositions(anim.target, true);
    d[2] = avg.x;
    d[4] = avg.y;
  }
  d[2] = d[2] + gBattleAnimArgs[2];
  d[4] = d[4] + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  SeekSpriteAnim(sprite, gBattleAnimArgs[5]);
};

/** AnimFlyBallUp (Fly's first turn): the attacker, as a ball, rises off-screen. Args: x, y, delay, acceleration. */
const AnimFlyBallUp: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimFlyBallUp_Step;
  gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = true;
};

function AnimFlyBallUp_Step(sprite: Sprite): void {
  if (sprite.data[0] > 0) {
    --sprite.data[0];
  } else {
    sprite.data[2] += sprite.data[1];
    sprite.y2 -= sprite.data[2] >> 8;
  }
  if (sprite.y + sprite.y2 < -32) DestroyAnimSprite(sprite);
}

/** AnimFlyBallAttack (Fly's second turn): the ball swoops in from the top corner, through the target. Arg 0: duration. */
const AnimFlyBallAttack: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    sprite.x = DISPLAY_WIDTH + 32;
    sprite.y = -32;
    StartSpriteAffineAnim(sprite, 1);
  } else {
    sprite.x = -32;
    sprite.y = -32;
  }
  const d = sprite.data;
  d[0] = gBattleAnimArgs[0];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimFlyBallAttack_Step;
};

function AnimFlyBallAttack_Step(sprite: Sprite): void {
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  if ((sprite.data[3] & 0xffff) >> 8 > 200) {
    sprite.x += sprite.x2;
    sprite.x2 = 0;
    sprite.data[3] &= 0xff;
  }
  if (sprite.x + sprite.x2 < -32 || sprite.x + sprite.x2 > DISPLAY_WIDTH + 32 || sprite.y + sprite.y2 > DISPLAY_HEIGHT) {
    gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = false;
    DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ Feather Dance

// struct FeatherDanceData, overlaid on sprite.data (s16[8]):
//   data[0]: unk0_0a (bit 0: pausing), unk0_0b (bit 1: which amplitude), unk0_0c (bit 2: may change
//            priority), unk0_0d (bit 3: flip at the next quarter), unk0_1 (bits 4-7: last quarter),
//            unk1 (bits 8-15: pause timer)
//   data[1] unk2 (sine index), data[2] unk4 (sine speed, bit 15: backwards), data[3] unk6 (y speed),
//   data[4] unk8 (y, 8.8 fixed), data[5] unkA (rotation offset), data[6] unkC[2] (two x amplitudes),
//   data[7]: unkE_0 (bit 0: in front of the mon), unkE_1 (bits 1-15: the y to land at)
interface FeatherDanceData {
  unk0_0a: number;
  unk0_0b: number;
  unk0_0c: number;
  unk0_0d: number;
  unk0_1: number;
  unk1: number;
  unk2: number;
  unk4: number;
  unk6: number;
  unk8: number;
  unkA: number;
  unkC: [number, number];
  unkE_0: number;
  unkE_1: number;
}

function readFeatherData(d: Int16Array): FeatherDanceData {
  const w0 = d[0] & 0xffff;
  const w7 = d[7] & 0xffff;
  return {
    unk0_0a: w0 & 1,
    unk0_0b: (w0 >> 1) & 1,
    unk0_0c: (w0 >> 2) & 1,
    unk0_0d: (w0 >> 3) & 1,
    unk0_1: (w0 >> 4) & 0xf,
    unk1: (w0 >> 8) & 0xff,
    unk2: d[1] & 0xffff,
    unk4: d[2],
    unk6: d[3] & 0xffff,
    unk8: d[4] & 0xffff,
    unkA: d[5] & 0xffff,
    unkC: [d[6] & 0xff, (d[6] >> 8) & 0xff],
    unkE_0: w7 & 1,
    unkE_1: w7 >> 1,
  };
}

function writeFeatherData(d: Int16Array, f: FeatherDanceData): void {
  d[0] = (f.unk0_0a & 1) | ((f.unk0_0b & 1) << 1) | ((f.unk0_0c & 1) << 2) | ((f.unk0_0d & 1) << 3) | ((f.unk0_1 & 0xf) << 4) | ((f.unk1 & 0xff) << 8);
  d[1] = f.unk2;
  d[2] = f.unk4;
  d[3] = f.unk6;
  d[4] = f.unk8;
  d[5] = f.unkA;
  d[6] = (f.unkC[0] & 0xff) | ((f.unkC[1] & 0xff) << 8);
  d[7] = (f.unkE_0 & 1) | ((f.unkE_1 & 0x7fff) << 1);
}

/** Flips the feather (its anim is the flipped image) */
function flipFeather(sprite: Sprite): void {
  sprite.hFlip = !sprite.hFlip;
  sprite.animNum = sprite.hFlip ? 1 : 0;
  sprite.animBeginning = true;
  sprite.animEnded = false;
}

/** Rotates the feather against its sway: matrix for sin index (-x2 / 2 + unkA) */
function setFeatherMatrix(sprite: Sprite, f: FeatherDanceData): void {
  const sinIndex = ((-sprite.x2 >> 1) + f.unkA) & 0xff;
  const sinVal = gSineTable(sinIndex);
  const m = gOamMatrices[sprite.oam.matrixNum];
  m.a = m.d = gSineTable(sinIndex + 64);
  m.b = sinVal;
  m.c = -sinVal;
}

// AnimFallingFeather (Feather Dance): sways down past a battler, flipping and passing in front of / behind it.
// Args: x, y, sine index | rotation << 8, sine speed (bit 15: backwards), y speed, x amplitudes (2 bytes),
// landing y, bit 8: around the attacker.
const AnimFallingFeather: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[7] & 0x100 ? anim.attacker : anim.target;
  const f = readFeatherData(sprite.data);
  if (getBattlerSide(battler) === K.B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  // sic: BATTLER_COORD_ATTR_HEIGHT / _WIDTH are BATTLER_COORD_X / _Y as coord types
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_ATTR_HEIGHT) + gBattleAnimArgs[0];
  const spriteCoord = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_ATTR_WIDTH);
  sprite.y = spriteCoord + gBattleAnimArgs[1];
  f.unk8 = (sprite.y << 8) & 0xffff;
  f.unkE_1 = (spriteCoord + gBattleAnimArgs[6]) & 0x7fff;
  f.unk0_0c = 1;
  f.unk2 = gBattleAnimArgs[2] & 0xff;
  f.unkA = (gBattleAnimArgs[2] >> 8) & 0xff;
  f.unk4 = gBattleAnimArgs[3];
  f.unk6 = gBattleAnimArgs[4] & 0xffff;
  f.unkC = [gBattleAnimArgs[5] & 0xff, (gBattleAnimArgs[5] >> 8) & 0xff];
  if (f.unk2 >= 64 && f.unk2 <= 191) {
    if (!IsContest()) sprite.oam.priority = (GetBattlerSpriteBGPriority(battler) + 1) & 3;
    else sprite.oam.priority = GetBattlerSpriteBGPriority(battler);
    f.unkE_0 = 0;
    if (!(f.unk4 & 0x8000)) flipFeather(sprite);
  } else {
    sprite.oam.priority = GetBattlerSpriteBGPriority(battler);
    f.unkE_0 = 1;
    if (f.unk4 & 0x8000) flipFeather(sprite);
  }
  f.unk0_1 = f.unk2 >> 6;
  sprite.x2 = ((gSineTable(f.unk2) * f.unkC[0]) >> 8) << 16 >> 16;
  setFeatherMatrix(sprite, f);
  writeFeatherData(sprite.data, f);
  sprite.callback = AnimFallingFeather_Step;
};

/** The flip at a quarter turn, moving the feather in front of / behind the mon */
function flipFeatherAndPriority(sprite: Sprite, f: FeatherDanceData): void {
  flipFeather(sprite);
  if (f.unk0_0c) {
    if (!IsContest()) {
      if (!f.unkE_0) sprite.oam.priority = (sprite.oam.priority - 1) & 3;
      else sprite.oam.priority = (sprite.oam.priority + 1) & 3;
    } else if (!f.unkE_0) {
      sprite.subpriority = (sprite.subpriority - 12) & 0xff;
    } else {
      sprite.subpriority = (sprite.subpriority + 12) & 0xff;
    }
    f.unkE_0 ^= 1;
  }
  f.unk0_0d = 0;
}

function AnimFallingFeather_Step(sprite: Sprite): void {
  const f = readFeatherData(sprite.data);
  if (f.unk0_0a) {
    const old = f.unk1;
    f.unk1 = (f.unk1 - 1) & 0xff;
    if (old % 256 === 0) {
      f.unk0_0a = 0;
      f.unk1 = 0;
    }
    writeFeatherData(sprite.data, f);
    return;
  }
  // Each quarter of the sine turn: pause on entering some quarters, flip on others (switch (unk2 / 64))
  const pause = () => {
    f.unk0_0a = 1;
    f.unk1 = 0;
  };
  switch (Math.trunc(f.unk2 / 64)) {
    case 0:
      if (f.unk0_1 === 1) {
        f.unk0_0d = 1;
        pause();
      } else if (f.unk0_1 === 3) {
        f.unk0_0b ^= 1;
        pause();
      } else if (f.unk0_0d) {
        flipFeatherAndPriority(sprite, f);
      }
      f.unk0_1 = 0;
      break;
    case 1:
      if (f.unk0_1 === 0) {
        f.unk0_0d = 1;
        pause();
      } else if (f.unk0_1 === 2) {
        pause();
      } else if (f.unk0_0d) {
        flipFeatherAndPriority(sprite, f);
      }
      f.unk0_1 = 1;
      break;
    case 2:
      if (f.unk0_1 === 3) {
        f.unk0_0d = 1;
        pause();
      } else if (f.unk0_1 === 1) {
        pause();
      } else if (f.unk0_0d) {
        flipFeatherAndPriority(sprite, f);
      }
      f.unk0_1 = 2;
      break;
    case 3:
      if (f.unk0_1 === 2) {
        f.unk0_0d = 1;
      } else if (f.unk0_1 === 0) {
        f.unk0_0b ^= 1;
        pause();
      } else if (f.unk0_0d) {
        flipFeatherAndPriority(sprite, f);
      }
      f.unk0_1 = 3;
      break;
  }
  sprite.x2 = ((f.unkC[f.unk0_0b] * gSineTable(f.unk2)) >> 8) << 16 >> 16;
  setFeatherMatrix(sprite, f);
  f.unk8 = (f.unk8 + f.unk6) & 0xffff;
  sprite.y = f.unk8 >> 8;
  if (f.unk4 & 0x8000) f.unk2 = (f.unk2 - (f.unk4 & 0x7fff)) & 0xff;
  else f.unk2 = (f.unk2 + (f.unk4 & 0x7fff)) & 0xff;
  writeFeatherData(sprite.data, f);
  if (sprite.y + sprite.y2 >= f.unkE_1) {
    sprite.data[0] = 0;
    sprite.callback = DestroyAnimSpriteAfterTimer;
  }
}

/** AnimUnusedBubbleThrow (sUnusedBubbleThrowSpriteTemplate, no script uses it) */
const AnimUnusedBubbleThrow: SpriteCallback = (sprite) => {
  sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = TranslateAnimSpriteToTargetMonLocation;
};

// AnimUnusedFeather (sUnusedFeatherSpriteTemplate, no script uses it): a feather thrown out along an angle,
// then falling like AnimFallingFeather. Args: angle | rotation << 8, distance, speed | y speed << 8 (in
// FeatherDanceData terms after the throw), landing y, behind the mon.
const AnimUnusedFeather: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[1] = gBattleAnimArgs[0];
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  if (!IsContest()) {
    if (g.battlerPositions[anim.target] & K.B_POSITION_OPPONENT_LEFT)
      d[7] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_ATTR_WIDTH) + gBattleAnimArgs[3];
    else d[7] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_ATTR_WIDTH) + 40;
    if (gBattleAnimArgs[4]) sprite.oam.priority = (GetBattlerSpriteBGPriority(anim.target) + 1) & 3;
    else sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
  } else {
    d[7] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_ATTR_WIDTH) + gBattleAnimArgs[3];
  }
  d[4] = gSineTable(d[1] & 0xff);
  d[5] = -gSineTable((d[1] & 0xff) + 64);
  d[6] = 0;
  sprite.y2 = 0;
  sprite.x2 = 0;
  d[1] = (d[1] & 0xffff) >> 8;
  const rn = random();
  if (rn & 0x8000) d[1] = 0xff - d[1];
  const sinVal = gSineTable(d[1]);
  const m = gOamMatrices[sprite.oam.matrixNum];
  m.a = m.d = gSineTable(d[1] + 64);
  m.b = sinVal;
  m.c = -sinVal;
  sprite.animBeginning = true;
  sprite.animEnded = false;
  if (rn & 1) {
    sprite.animNum = 1;
    sprite.hFlip = true;
  }
  sprite.callback = AnimUnusedFeather_Step;
};

function AnimUnusedFeather_Step(sprite: Sprite): void {
  const d = sprite.data;
  ++d[0];
  if (d[0] <= 4) return;
  sprite.x2 = ((d[4] * d[6]) >> 8) << 16 >> 16;
  sprite.y2 = ((d[5] * d[6]) >> 8) << 16 >> 16;
  d[6] += d[3] & 0xff;
  if (d[6] < (d[2] & 0xff)) return;
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
  // memcpy the old data to fData, memset the FeatherDanceData to 0 and refill it
  const fData = Int16Array.from(d);
  d.fill(0);
  const t = readFeatherData(d);
  t.unk8 = (sprite.y << 8) & 0xffff;
  t.unk6 = (fData[3] & 0xffff) >> 8;
  t.unk2 = 0;
  t.unkA = fData[1] & 0xffff;
  if (sprite.animNum !== 0) t.unk4 = t.unk6 & 8 ? 0x8001 : 0x8002;
  else t.unk4 = t.unk6 & 8 ? 1 : 2;
  const item = (fData[2] >> 8) & 0xff;
  t.unkC = [item, (item - 2) & 0xff];
  writeFeatherData(d, t);
  // ((u16 *)tData)[7] = (((u16 *)&fData)[7] << 1) | (((u16 *)tData)[7] & 1): the landing y moves into unkE_1
  d[7] = ((fData[7] & 0xffff) << 1) | (d[7] & 1);
  sprite.callback = AnimFallingFeather_Step;
}

// ------------------------------------------------------------------ Whirlwind, Drill Peck, Bounce, Dive, Sky Attack

/** AnimWhirlwindLine: lines streaking across a battler. Args: x, y, battler, duration, start frame. */
const AnimWhirlwindLine: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] === K.ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, false);
  else InitSpritePosToAnimTarget(sprite, false);
  if (
    (gBattleAnimArgs[2] === K.ANIM_ATTACKER && getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) ||
    (gBattleAnimArgs[2] === K.ANIM_TARGET && getBattlerSide(anim.target) === K.B_SIDE_PLAYER)
  )
    sprite.x += 8;
  SeekSpriteAnim(sprite, gBattleAnimArgs[4]);
  sprite.x -= 32;
  sprite.data[1] = 0x0ccc;
  const arg = gBattleAnimArgs[4] & 0xffff;
  const mult = 12;
  sprite.x2 += mult * arg;
  sprite.data[0] = arg;
  sprite.data[7] = gBattleAnimArgs[3];
  sprite.callback = AnimWhirlwindLine_Step;
};

function AnimWhirlwindLine_Step(sprite: Sprite): void {
  sprite.x2 += sprite.data[1] >> 8;
  if (++sprite.data[0] === 6) {
    sprite.data[0] = 0;
    sprite.x2 = 0;
    StartSpriteAnim(sprite, 0);
  }
  if (--sprite.data[7] === -1) DestroyAnimSprite(sprite);
}

/** AnimTask_DrillPeckHitSplats: a gFlashingHitSplatSpriteTemplate hit splat every 4 frames, circling the target */
const AnimTask_DrillPeckHitSplats: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (!(d[0] % 32)) {
    anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
    gBattleAnimArgs[0] = Sin(d[0], -13);
    gBattleAnimArgs[1] = Cos(d[0], -13);
    gBattleAnimArgs[2] = 1;
    gBattleAnimArgs[3] = 3;
    CreateSpriteAndAnimate(
      animSpriteTemplate('gFlashingHitSplatSpriteTemplate')!,
      GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2),
      GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET),
      3,
    );
  }
  d[0] += 8;
  if (d[0] > 255) DestroyAnimVisualTask(taskId);
};

/** AnimBounceBallShrink (Bounce's first turn): the attacker, as a ball, until its affine anim ends */
const AnimBounceBallShrink: SpriteCallback = (sprite) => {
  switch (sprite.data[0]) {
    case 0:
      InitSpritePosToAnimAttacker(sprite, true);
      gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = true;
      ++sprite.data[0];
      break;
    case 1:
      if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
      break;
  }
};

/** AnimBounceBallLand (Bounce's second turn): drops onto the target and bounces back off-screen */
const AnimBounceBallLand: SpriteCallback = (sprite) => {
  switch (sprite.data[0]) {
    case 0:
      sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
      sprite.y2 = -sprite.y - 32;
      ++sprite.data[0];
      break;
    case 1:
      sprite.y2 += 10;
      if (sprite.y2 >= 0) ++sprite.data[0];
      break;
    case 2:
      sprite.y2 -= 10;
      if (sprite.y + sprite.y2 < -32) {
        gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = false;
        DestroyAnimSprite(sprite);
      }
      break;
  }
};

/** AnimDiveBall (Dive's first turn): rises off-screen, waits, then drops back. Args: x, y, delay, acceleration. */
const AnimDiveBall: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimDiveBall_Step1;
  gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = true;
};

function AnimDiveBall_Step1(sprite: Sprite): void {
  if (sprite.data[0] > 0) {
    --sprite.data[0];
  } else if (sprite.y + sprite.y2 > -32) {
    sprite.data[2] += sprite.data[1];
    sprite.y2 -= sprite.data[2] >> 8;
  } else {
    sprite.invisible = true;
    if (sprite.data[3]++ > 20) sprite.callback = AnimDiveBall_Step2;
  }
}

function AnimDiveBall_Step2(sprite: Sprite): void {
  sprite.y2 += sprite.data[2] >> 8;
  if (sprite.y + sprite.y2 > -32) sprite.invisible = false;
  if (sprite.y2 > 0) DestroyAnimSprite(sprite);
}

/** AnimDiveWaterSplash: a splash squashing down then back up at a battler's feet. Arg 0: battler (0 attacker). */
const AnimDiveWaterSplash: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[0]) {
    case 0: {
      const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
      sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
      sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
      d[1] = 512;
      TrySetSpriteRotScale(sprite, false, 256, d[1], 0);
      ++d[0];
      break;
    }
    case 1: {
      if (d[2] <= 11) d[1] -= 40;
      else d[1] += 40;
      ++d[2];
      TrySetSpriteRotScale(sprite, false, 256, d[1], 0);
      const t1 = 15616;
      let t2 = Math.trunc(t1 / gOamMatrices[sprite.oam.matrixNum].d) + 1;
      if (t2 > 128) t2 = 128;
      t2 = Math.trunc((64 - t2) / 2);
      sprite.y2 = t2;
      if (d[2] === 24) {
        TryResetSpriteAffineState(sprite);
        DestroyAnimSprite(sprite);
      }
      break;
    }
  }
};

/** AnimSprayWaterDroplet (Dive, Astonish): a droplet thrown up from a battler. Args: flip (go left), battler (0 attacker). */
const AnimSprayWaterDroplet: SpriteCallback = (sprite) => {
  const v1 = 0x1ff & random();
  const v2 = 0x7f & random();
  const d = sprite.data;
  d[0] = v1 % 2 ? 736 + v1 : 736 - v1;
  d[1] = v2 % 2 ? 896 + v2 : 896 - v2;
  d[2] = gBattleAnimArgs[0];
  if (d[2]) sprite.oam.matrixNum = 0x08; // ST_OAM_HFLIP
  const battler = gBattleAnimArgs[1] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y) + 32;
  sprite.callback = AnimSprayWaterDroplet_Step;
};

function AnimSprayWaterDroplet_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[2] === 0) sprite.x2 += d[0] >> 8;
  else sprite.x2 -= d[0] >> 8;
  sprite.y2 -= d[1] >> 8;
  d[1] -= 32;
  if (d[0] < 0) d[0] = 0;
  if (++d[3] === 31) DestroyAnimSprite(sprite);
}

/** AnimUnusedFlashingLight (sUnusedFlashingLightSpriteTemplate, no script uses it) */
const AnimUnusedFlashingLight: SpriteCallback = (sprite) => {
  sprite.data[6] = 0;
  sprite.data[7] = 64;
  sprite.callback = AnimUnusedFlashingLight_Step;
};

function AnimUnusedFlashingLight_Step(sprite: Sprite): void {
  switch (sprite.data[0]) {
    case 0:
      if (++sprite.data[1] > 8) {
        sprite.data[1] = 0;
        sprite.invisible = !sprite.invisible;
        if (++sprite.data[2] > 5 && sprite.invisible) ++sprite.data[0];
      }
      break;
    case 1:
      DestroyAnimSprite(sprite);
      break;
  }
}

/** AnimSkyAttackBird: flies from the attacker towards where the script placed it, rotated to face that way */
const AnimSkyAttackBird: SpriteCallback = (sprite) => {
  const posx = sprite.x;
  const posy = sprite.y;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const d = sprite.data;
  d[4] = sprite.x << 4;
  d[5] = sprite.y << 4;
  d[6] = Math.trunc(((posx - sprite.x) << 4) / 12);
  d[7] = Math.trunc(((posy - sprite.y) << 4) / 12);
  const rotation = (ArcTan2Neg(posx - sprite.x, posy - sprite.y) + 49152) & 0xffff;
  TrySetSpriteRotScale(sprite, true, 0x100, 0x100, rotation);
  sprite.callback = AnimSkyAttackBird_Step;
};

function AnimSkyAttackBird_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[6];
  d[5] += d[7];
  sprite.x = d[4] >> 4;
  sprite.y = d[5] >> 4;
  if (sprite.x > DISPLAY_WIDTH + 45 || sprite.x < -45 || sprite.y > 157 || sprite.y < -45) DestroySpriteAndMatrix(sprite);
}

/** AnimTask_SetAttackerVisibility (unused). Arg 0: 0 hides the attacker, otherwise shows it. */
const AnimTask_SetAttackerVisibility: TaskFunc = (taskId) => {
  gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)].invisible = gBattleAnimArgs[0] === 0;
  DestroyAnimVisualTask(taskId);
};

export const flyingSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimEllipticalGust,
  AnimGustToTarget,
  AnimAirWaveCrescent,
  AnimFlyBallUp,
  AnimFlyBallAttack,
  AnimFallingFeather,
  AnimUnusedBubbleThrow,
  AnimUnusedFeather,
  AnimWhirlwindLine,
  AnimBounceBallShrink,
  AnimBounceBallLand,
  AnimDiveBall,
  AnimDiveWaterSplash,
  AnimSprayWaterDroplet,
  AnimUnusedFlashingLight,
  AnimSkyAttackBird,
};

export const flyingTasks: Record<string, TaskFunc> = {
  AnimTask_AnimateGustTornadoPalette,
  AnimTask_DrillPeckHitSplats,
  AnimTask_SetAttackerVisibility,
};
