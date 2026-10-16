// battle_anim_mon_movement.c: tasks and dummy sprites that move, shake, rotate and scale battler sprites.

import { DISPLAY_WIDTH } from '../../gba/hw';
import { gSprites, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import {
  GetAnimBattlerSpriteId,
  InitSpriteDataForLinearTranslation,
  IsBattlerSpriteVisible,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  SetBattlerSpriteYOffsetFromRotation,
  SetSpriteRotScale,
  SPRITE_NONE,
  TranslateSpriteLinearById,
  TranslateSpriteLinearByIdFixedPoint,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const s16 = (v: number) => (v << 16) >> 16;

// AnimTask_ShakeMon: shakes between the origin and the offset. Args: battler, x offset, y offset,
// shakes, frame delay.
const AnimTask_ShakeMon: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === SPRITE_NONE) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const d = gTasks[taskId].data;
  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  gSprites[spriteId].y2 = gBattleAnimArgs[2];
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[4];
  d[3] = gBattleAnimArgs[4];
  d[4] = gBattleAnimArgs[1];
  d[5] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeMon_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_ShakeMon_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[3] === 0) {
    const s = gSprites[d[0]];
    s.x2 = s.x2 === 0 ? d[4] : 0;
    s.y2 = s.y2 === 0 ? d[5] : 0;
    d[3] = d[2];
    if (--d[1] === 0) {
      s.x2 = 0;
      s.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else {
    d[3]--;
  }
};

// AnimTask_ShakeMon2: shakes between +offset and -offset. Arg 0 is a battler (< 4), a position + 4,
// or 8 for the attacker.
const AnimTask_ShakeMon2: TaskFunc = (taskId) => {
  let abort = false;
  let spriteId: number;
  if (gBattleAnimArgs[0] < K.MAX_BATTLERS_COUNT) {
    spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
    if (spriteId === SPRITE_NONE) abort = true;
  } else if (gBattleAnimArgs[0] !== 8) {
    const position = [K.B_POSITION_PLAYER_LEFT, K.B_POSITION_PLAYER_RIGHT, K.B_POSITION_OPPONENT_LEFT][gBattleAnimArgs[0] - 4] ?? K.B_POSITION_OPPONENT_RIGHT;
    const battlerId = getBattlerAtPosition(position);
    if (!IsBattlerSpriteVisible(battlerId)) abort = true;
    spriteId = g.battlerSpriteIds[battlerId];
  } else {
    spriteId = g.battlerSpriteIds[anim.attacker];
  }
  if (abort) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const d = gTasks[taskId].data;
  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  gSprites[spriteId].y2 = gBattleAnimArgs[2];
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[4];
  d[3] = gBattleAnimArgs[4];
  d[4] = gBattleAnimArgs[1];
  d[5] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeMon2Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_ShakeMon2Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[3] === 0) {
    const s = gSprites[d[0]];
    s.x2 = s.x2 === d[4] ? -d[4] : d[4];
    s.y2 = s.y2 === d[5] ? -d[5] : d[5];
    d[3] = d[2];
    if (--d[1] === 0) {
      s.x2 = 0;
      s.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else {
    d[3]--;
  }
};

// AnimTask_ShakeMonInPlace: like ShakeMon2, relative to the sprite's current offset.
const AnimTask_ShakeMonInPlace: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (spriteId === SPRITE_NONE) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const d = gTasks[taskId].data;
  gSprites[spriteId].x2 += gBattleAnimArgs[1];
  gSprites[spriteId].y2 += gBattleAnimArgs[2];
  d[0] = spriteId;
  d[1] = 0;
  d[2] = gBattleAnimArgs[3];
  d[3] = 0;
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[1] * 2;
  d[6] = gBattleAnimArgs[2] * 2;
  gTasks[taskId].func = AnimTask_ShakeMonInPlace_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_ShakeMonInPlace_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[3] === 0) {
    const s = gSprites[d[0]];
    if (d[1] & 1) {
      s.x2 += d[5];
      s.y2 += d[6];
    } else {
      s.x2 -= d[5];
      s.y2 -= d[6];
    }
    d[3] = d[4];
    if (++d[1] >= d[2]) {
      if (d[1] & 1) {
        s.x2 += Math.trunc(d[5] / 2);
        s.y2 += Math.trunc(d[6] / 2);
      } else {
        s.x2 -= Math.trunc(d[5] / 2);
        s.y2 -= Math.trunc(d[6] / 2);
      }
      DestroyAnimVisualTask(taskId);
    }
  } else {
    d[3]--;
  }
};

// AnimTask_ShakeAndSinkMon: shakes horizontally while sinking. Args: battler, x offset, frame delay,
// downward speed (subpixel), duration.
const AnimTask_ShakeAndSinkMon: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const d = gTasks[taskId].data;
  gSprites[spriteId].x2 = gBattleAnimArgs[1];
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  gTasks[taskId].func = AnimTask_ShakeAndSinkMon_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_ShakeAndSinkMon_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const spriteId = d[0] & 0xff;
  let x = d[1];
  if (d[2] === d[8]++) {
    d[8] = 0;
    if (gSprites[spriteId].x2 === x) x = -x;
    gSprites[spriteId].x2 += x;
  }
  d[1] = x;
  d[9] += d[3];
  gSprites[spriteId].y2 = d[9] >> 8;
  if (--d[4] === 0) DestroyAnimVisualTask(taskId);
};

// AnimTask_TranslateMonElliptical: an ellipse that starts and ends at the origin. Args: battler, width,
// height, loops, speed (0-5).
const AnimTask_TranslateMonElliptical: TaskFunc = (taskId) => {
  let wavePeriod = 1;
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  if (gBattleAnimArgs[4] > 5) gBattleAnimArgs[4] = 5;
  for (let i = 0; i < gBattleAnimArgs[4]; i++) wavePeriod = (wavePeriod * 2) & 0xff;
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = wavePeriod;
  gTasks[taskId].func = AnimTask_TranslateMonElliptical_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_TranslateMonElliptical_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[0] & 0xff];
  s.x2 = Sin(d[5], d[1]);
  s.y2 = -Cos(d[5], d[2]);
  s.y2 += d[2];
  d[5] += d[4];
  d[5] &= 0xff;
  if (d[5] === 0) d[3]--;
  if (d[3] === 0) {
    s.x2 = 0;
    s.y2 = 0;
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_TranslateMonEllipticalRespectSide: mirrored for the opponent's side */
const AnimTask_TranslateMonEllipticalRespectSide: TaskFunc = (taskId) => {
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  AnimTask_TranslateMonElliptical(taskId);
};

// DoHorizontalLunge: the attacker moves forward and back. Args: duration of each half, x delta per frame.
const DoHorizontalLunge: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  sprite.data[1] = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? -gBattleAnimArgs[1] : gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[2] = 0;
  sprite.data[3] = g.battlerSpriteIds[anim.attacker];
  sprite.data[4] = gBattleAnimArgs[0];
  StoreSpriteCallbackInData6(sprite, ReverseHorizontalLungeDirection);
  sprite.callback = TranslateSpriteLinearById;
};

function ReverseHorizontalLungeDirection(sprite: Sprite): void {
  sprite.data[0] = sprite.data[4];
  sprite.data[1] = -sprite.data[1];
  sprite.callback = TranslateSpriteLinearById;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// DoVerticalDip: down and back up. Args: duration of each half, y delta per frame, battler.
const DoVerticalDip: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = 0;
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] = spriteId;
  sprite.data[4] = gBattleAnimArgs[0];
  StoreSpriteCallbackInData6(sprite, ReverseVerticalDipDirection);
  sprite.callback = TranslateSpriteLinearById;
};

function ReverseVerticalDipDirection(sprite: Sprite): void {
  sprite.data[0] = sprite.data[4];
  sprite.data[2] = -sprite.data[2];
  sprite.callback = TranslateSpriteLinearById;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

// SlideMonToOriginalPos: slides a battler back to its origin. Args: 0 attacker / 1 target,
// direction (0 both, 1 horizontal, 2 vertical), duration.
const SlideMonToOriginalPos: SpriteCallback = (sprite) => {
  const spriteId = gBattleAnimArgs[0] === 0 ? g.battlerSpriteIds[anim.attacker] : g.battlerSpriteIds[anim.target];
  const mon = gSprites[spriteId];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = mon.x + mon.x2;
  d[2] = mon.x;
  d[3] = mon.y + mon.y2;
  d[4] = mon.y;
  InitSpriteDataForLinearTranslation(sprite);
  d[3] = 0;
  d[4] = 0;
  d[5] = mon.x2;
  d[6] = mon.y2;
  sprite.invisible = true;
  if (gBattleAnimArgs[1] === 1) d[2] = 0;
  else if (gBattleAnimArgs[1] === 2) d[1] = 0;
  d[7] = gBattleAnimArgs[1];
  d[7] |= spriteId << 8;
  sprite.callback = SlideMonToOriginalPos_Step;
};

function SlideMonToOriginalPos_Step(sprite: Sprite): void {
  const d = sprite.data;
  const data7 = d[7] & 0xff;
  const monSprite = gSprites[(d[7] >> 8) & 0xff];
  if (d[0] === 0) {
    if (data7 === 1 || data7 === 0) monSprite.x2 = 0;
    if (data7 === 2 || data7 === 0) monSprite.y2 = 0;
    DestroyAnimSprite(sprite);
  } else {
    d[0]--;
    d[3] += d[1];
    d[4] += d[2];
    monSprite.x2 = s16((d[3] >> 8) + d[5]);
    monSprite.y2 = s16((d[4] >> 8) + d[6]);
  }
}

// SlideMonToOffset: slides a battler to an offset (x mirrored for the opponent, y too if arg 3 is 1).
// Args: 0 attacker / 1 target, x, y, mirror y, duration.
const SlideMonToOffset: SpriteCallback = (sprite) => {
  const battlerId = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  const monSpriteId = g.battlerSpriteIds[battlerId];
  if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[3] === 1) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  }
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = gSprites[monSpriteId].x;
  d[2] = gSprites[monSpriteId].x + gBattleAnimArgs[1];
  d[3] = gSprites[monSpriteId].y;
  d[4] = gSprites[monSpriteId].y + gBattleAnimArgs[2];
  InitSpriteDataForLinearTranslation(sprite);
  d[3] = 0;
  d[4] = 0;
  d[5] = monSpriteId;
  sprite.invisible = true;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearByIdFixedPoint;
};

const SlideMonToOffsetAndBack: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  const battlerId = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  const spriteId = g.battlerSpriteIds[battlerId];
  if (getBattlerSide(battlerId) !== K.B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    if (gBattleAnimArgs[3] === 1) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  }
  const d = sprite.data;
  const mon = gSprites[spriteId];
  d[0] = gBattleAnimArgs[4];
  d[1] = mon.x + mon.x2;
  d[2] = d[1] + gBattleAnimArgs[1];
  d[3] = mon.y + mon.y2;
  d[4] = d[3] + gBattleAnimArgs[2];
  InitSpriteDataForLinearTranslation(sprite);
  d[3] = mon.x2 << 8;
  d[4] = mon.y2 << 8;
  d[5] = spriteId;
  d[6] = gBattleAnimArgs[5];
  StoreSpriteCallbackInData6(sprite, gBattleAnimArgs[5] === 0 ? DestroyAnimSprite : SlideMonToOffsetAndBack_End);
  sprite.callback = TranslateSpriteLinearByIdFixedPoint;
};

function SlideMonToOffsetAndBack_End(sprite: Sprite): void {
  gSprites[sprite.data[5]].x2 = 0;
  gSprites[sprite.data[5]].y2 = 0;
  DestroyAnimSprite(sprite);
}

// AnimTask_WindUpLunge (Take Down): an arc back, then a lunge. Args: battler, x speed (subpixel),
// wave amplitude, first duration, delay, lunge x offset, lunge duration.
const AnimTask_WindUpLunge: TaskFunc = (taskId) => {
  const wavePeriod = Math.trunc(0x8000 / gBattleAnimArgs[3]) & 0xffff;
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[5] = -gBattleAnimArgs[5];
  }
  const d = gTasks[taskId].data;
  d[0] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  d[1] = Math.trunc((gBattleAnimArgs[1] * 256) / gBattleAnimArgs[3]);
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = Math.trunc((gBattleAnimArgs[5] * 256) / gBattleAnimArgs[6]);
  d[6] = gBattleAnimArgs[6];
  d[7] = wavePeriod;
  gTasks[taskId].func = AnimTask_WindUpLunge_Step1;
};

const AnimTask_WindUpLunge_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[0] & 0xff];
  d[11] += d[1];
  s.x2 = d[11] >> 8;
  s.y2 = Sin((d[10] >> 8) & 0xff, d[2]);
  d[10] += d[7];
  if (--d[3] === 0) gTasks[taskId].func = AnimTask_WindUpLunge_Step2;
};

const AnimTask_WindUpLunge_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[4] > 0) {
    d[4]--;
  } else {
    d[12] += d[5];
    gSprites[d[0] & 0xff].x2 = s16((d[12] >> 8) + (d[11] >> 8));
    if (--d[6] === 0) DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_SlideOffScreen: Roar / Whirlwind pushing a mon out */
const AnimTask_SlideOffScreen: TaskFunc = (taskId) => {
  let spriteId: number;
  switch (gBattleAnimArgs[0]) {
    case K.ANIM_ATTACKER:
    case K.ANIM_TARGET:
      spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
      break;
    case K.ANIM_ATK_PARTNER:
      if (!IsBattlerSpriteVisible(anim.attacker ^ K.BIT_FLANK)) {
        DestroyAnimVisualTask(taskId);
        return;
      }
      spriteId = g.battlerSpriteIds[anim.attacker ^ K.BIT_FLANK];
      break;
    case K.ANIM_DEF_PARTNER:
      if (!IsBattlerSpriteVisible(anim.target ^ K.BIT_FLANK)) {
        DestroyAnimVisualTask(taskId);
        return;
      }
      spriteId = g.battlerSpriteIds[anim.target ^ K.BIT_FLANK];
      break;
    default:
      DestroyAnimVisualTask(taskId);
      return;
  }
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = getBattlerSide(anim.target) !== K.B_SIDE_PLAYER ? gBattleAnimArgs[1] : -gBattleAnimArgs[1];
  gTasks[taskId].func = AnimTask_SlideOffScreen_Step;
};

const AnimTask_SlideOffScreen_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[0] & 0xff];
  s.x2 += d[1];
  if (s.x2 + s.x < -32 || s.x2 + s.x > DISPLAY_WIDTH + 32) DestroyAnimVisualTask(taskId);
};

// AnimTask_SwayMon: a sine sway, horizontal or vertical. Args: direction (0 horizontal, 1 vertical),
// amplitude, period, sways, 0 attacker / 1 target.
const AnimTask_SwayMon: TaskFunc = (taskId) => {
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[4]);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = spriteId;
  d[5] = gBattleAnimArgs[4] === 0 ? anim.attacker : anim.target;
  d[12] = 1;
  gTasks[taskId].func = AnimTask_SwayMon_Step;
};

const AnimTask_SwayMon_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[4] & 0xff];
  const sineIndex = (d[10] + d[2]) & 0xffff;
  d[10] = sineIndex;
  const waveIndex = sineIndex >> 8;
  const sineValue = Sin(waveIndex, d[1]);
  if (d[0] === 0) s.x2 = sineValue;
  else if (getBattlerSide(d[5]) === K.B_SIDE_PLAYER) s.y2 = Math.abs(sineValue);
  else s.y2 = -Math.abs(sineValue);
  if ((waveIndex > 0x7f && d[11] === 0 && d[12] === 1) || (waveIndex < 0x7f && d[11] === 1 && d[12] === 0)) {
    d[11] ^= 1;
    d[12] ^= 1;
    if (--d[3] === 0) {
      s.x2 = 0;
      s.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
};

// AnimTask_ScaleMonAndRestore: scales a battler, then back. Args: x scale delta, y scale delta,
// duration, battler, objMode.
const AnimTask_ScaleMonAndRestore: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[3]);
  PrepareBattlerSpriteForRotScale(spriteId, gBattleAnimArgs[4]);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[2];
  d[4] = spriteId;
  d[10] = 0x100;
  d[11] = 0x100;
  gTasks[taskId].func = AnimTask_ScaleMonAndRestore_Step;
};

const AnimTask_ScaleMonAndRestore_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[10] += d[0];
  d[11] += d[1];
  const spriteId = d[4] & 0xff;
  SetSpriteRotScale(spriteId, d[10], d[11], 0);
  if (--d[2] === 0) {
    if (d[3] > 0) {
      d[0] = -d[0];
      d[1] = -d[1];
      d[2] = d[3];
      d[3] = 0;
    } else {
      ResetSpriteRotScale(spriteId);
      DestroyAnimVisualTask(taskId);
    }
  }
};

// AnimTask_RotateMonSpriteToSide. Args: duration, rotation step, battler, mode (0 stay, 1 reset, 2 and back).
const AnimTask_RotateMonSpriteToSide: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  PrepareBattlerSpriteForRotScale(spriteId, 0);
  const d = gTasks[taskId].data;
  d[1] = 0;
  d[2] = gBattleAnimArgs[0];
  d[3] = gBattleAnimArgs[3] !== 1 ? 0 : gBattleAnimArgs[0] * gBattleAnimArgs[1];
  d[4] = gBattleAnimArgs[1];
  d[5] = spriteId;
  d[6] = gBattleAnimArgs[3];
  // (contests always set data[7])
  d[7] = gBattleAnimArgs[2] === K.ANIM_ATTACKER ? +(getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) : +(getBattlerSide(anim.target) === K.B_SIDE_PLAYER);
  if (d[7]) {
    d[3] = -d[3];
    d[4] = -d[4];
  }
  gTasks[taskId].func = AnimTask_RotateMonSpriteToSide_Step;
};

/** AnimTask_RotateMonToSideAndRestore: Peck and held items activating */
const AnimTask_RotateMonToSideAndRestore: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[2]);
  PrepareBattlerSpriteForRotScale(spriteId, 0);
  const d = gTasks[taskId].data;
  d[1] = 0;
  d[2] = gBattleAnimArgs[0];
  const battler = gBattleAnimArgs[2] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[3] !== 1 ? 0 : gBattleAnimArgs[0] * gBattleAnimArgs[1];
  d[4] = gBattleAnimArgs[1];
  d[5] = spriteId;
  d[6] = gBattleAnimArgs[3];
  d[7] = 1;
  d[3] = -d[3];
  d[4] = -d[4];
  gTasks[taskId].func = AnimTask_RotateMonSpriteToSide_Step;
};

const AnimTask_RotateMonSpriteToSide_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[3] += d[4];
  SetSpriteRotScale(d[5], 0x100, 0x100, d[3]);
  if (d[7]) SetBattlerSpriteYOffsetFromRotation(d[5]);
  if (++d[1] >= d[2]) {
    switch (d[6]) {
      case 1:
        ResetSpriteRotScale(d[5]);
      // fallthrough
      case 0:
      default:
        DestroyAnimVisualTask(taskId);
        break;
      case 2:
        d[1] = 0;
        d[4] *= -1;
        d[6] = 1;
        break;
    }
  }
};

// AnimTask_ShakeTargetBasedOnMovePowerOrDmg. Args: 0 power / 1 damage, delay, shakes, x, y.
const AnimTask_ShakeTargetBasedOnMovePowerOrDmg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[15] = Math.trunc((gBattleAnimArgs[0] === 0 ? anim.movePower : anim.moveDmg) / 12);
  if (d[15] < 1) d[15] = 1;
  if (d[15] > 16) d[15] = 16;
  d[14] = Math.trunc(d[15] / 2);
  d[13] = d[14] + (d[15] & 1);
  d[12] = 0;
  d[10] = gBattleAnimArgs[3];
  d[11] = gBattleAnimArgs[4];
  d[7] = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  d[8] = gSprites[d[7]].x2;
  d[9] = gSprites[d[7]].y2;
  d[0] = 0;
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ShakeTargetBasedOnMovePowerOrDmg_Step;
};

const AnimTask_ShakeTargetBasedOnMovePowerOrDmg_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[0] > d[1]) {
    d[0] = 0;
    d[12] = (d[12] + 1) & 1;
    const s = gSprites[d[7]];
    if (d[10]) s.x2 = d[12] ? d[8] + d[13] : d[8] - d[14];
    if (d[11]) s.y2 = d[12] ? d[15] : 0;
    if (!--d[2]) {
      s.x2 = 0;
      s.y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
};

export const monMovementSpriteCallbacks: Record<string, SpriteCallback> = {
  DoHorizontalLunge,
  DoVerticalDip,
  SlideMonToOriginalPos,
  SlideMonToOffset,
  SlideMonToOffsetAndBack,
};

export const monMovementTasks: Record<string, TaskFunc> = {
  AnimTask_ShakeMon,
  AnimTask_ShakeMon2,
  AnimTask_ShakeMonInPlace,
  AnimTask_ShakeAndSinkMon,
  AnimTask_TranslateMonElliptical,
  AnimTask_TranslateMonEllipticalRespectSide,
  AnimTask_WindUpLunge,
  AnimTask_SlideOffScreen,
  AnimTask_SwayMon,
  AnimTask_ScaleMonAndRestore,
  AnimTask_RotateMonSpriteToSide,
  AnimTask_RotateMonToSideAndRestore,
  AnimTask_ShakeTargetBasedOnMovePowerOrDmg,
};
