// battle_anim_fire.c: every sprite callback and task in the file (including the unused ones).

import { BG_PLTT_ID, BlendPalette } from '../../gba/palette';
import { CreateSprite, DestroySprite, gSprites, MAX_SPRITES, StartSpriteAnim, StoreSpriteCallbackInData6, ST_OAM_OBJ_NORMAL, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { DISPLAY_WIDTH } from '../../gba/hw';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  AnimTravelDiagonally,
  BattleAnimHelper_RunSpriteSquash,
  BattleAnimHelper_SetSpriteSquashParams,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteCoord,
  InitAnimLinearTranslation,
  InitAnimLinearTranslationWithSpeed,
  InitSpritePosToAnimAttacker,
  IsBattlerSpriteVisible,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  SetAnimSpriteInitialXOffset,
  SetBattlerSpriteYOffsetFromYScale,
  SetSpriteCoordsToAnimAttackerCoords,
  StartAnimLinearTranslation,
  TranslateSpriteInGrowingCircle,
  TranslateSpriteLinear,
  TranslateSpriteLinearFixedPoint,
  WaitAnimForDuration,
} from './animMons';
import { animSpriteTemplate, IsContest, PlaySE12WithPanning } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimFireSpiralInward (Fire Punch's first stage): a growing-then-shrinking circle. Arg 0: wave offset. */
const AnimFireSpiralInward: SpriteCallback = (sprite) => {
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = 0x3c;
  sprite.data[2] = 0x9;
  sprite.data[3] = 0x1e;
  sprite.data[4] = 0xfe00; // s16: -0x200
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteInGrowingCircle;
  sprite.callback(sprite);
};

/** AnimFireSpread (Fire Punch, Blaze Kick, Flame Wheel): flames flying out of the impact. Args: x, y, x speed, y speed, duration. */
const AnimFireSpread: SpriteCallback = (sprite) => {
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[3];
  sprite.callback = TranslateSpriteLinearFixedPoint;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimFirePlume (Sacred Fire, Blast Burn): a flame at the attacker. Args: x, y, duration, move frames, x step, y step. */
const AnimFirePlume: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (isOpponent(anim.attacker)) {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] = -gBattleAnimArgs[4];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] = gBattleAnimArgs[4];
  }
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.callback = AnimLargeFlame_Step;
};

/** AnimLargeFlame (Sacred Fire, Tri Attack): like AnimFirePlume but placed by the script, x step mirrored */
const AnimLargeFlame: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] = gBattleAnimArgs[4];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[2] = -gBattleAnimArgs[4];
  }
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.callback = AnimLargeFlame_Step;
};

function AnimLargeFlame_Step(sprite: Sprite): void {
  if (++sprite.data[0] < sprite.data[4]) {
    sprite.x2 += sprite.data[2];
    sprite.y2 += sprite.data[3];
  }
  if (sprite.data[0] === sprite.data[1]) DestroySpriteAndMatrix(sprite);
}

/** AnimUnusedSmallEmber (sUnusedSmallEmberSpriteTemplate, no script uses it): an ember on a widening circle */
const AnimUnusedSmallEmber: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (isOpponent(anim.attacker)) {
    sprite.x -= gBattleAnimArgs[0];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.subpriority = 8;
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.data[4] = gBattleAnimArgs[6];
  sprite.data[5] = 0;
  sprite.callback = AnimUnusedSmallEmber_Step;
};

function AnimUnusedSmallEmber_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[3]) {
    if (d[5] > 10000) sprite.subpriority = 1;
    sprite.x2 = Sin(d[0], d[1] + (d[5] >> 8));
    sprite.y2 = Cos(d[0], d[1] + (d[5] >> 8));
    d[0] += d[2];
    d[5] += d[4];
    if (d[0] > 255) d[0] -= 256;
    else if (d[0] < 0) d[0] += 256;
    --d[3];
  } else {
    DestroySpriteAndMatrix(sprite);
  }
}

/** AnimSunlight (Sunny Day, Synthesis): a ray sliding down from the top left */
const AnimSunlight: SpriteCallback = (sprite) => {
  sprite.x = 0;
  sprite.y = 0;
  sprite.data[0] = 60;
  sprite.data[2] = 140;
  sprite.data[4] = 80;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

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

// AnimFireRing (Fire Blast's first half): circles the attacker, flies to the target still circling, then
// circles the target. Args: x, y, wave offset.
const AnimFireRing: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.callback = AnimFireRing_Step1;
};

function AnimFireRing_Step1(sprite: Sprite): void {
  UpdateFireRingCircleOffset(sprite);
  if (++sprite.data[0] === 0x12) {
    sprite.data[0] = 0x19;
    sprite.data[1] = sprite.x;
    sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    sprite.data[3] = sprite.y;
    sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
    InitAnimLinearTranslation(sprite);
    sprite.callback = AnimFireRing_Step2;
  }
}

function AnimFireRing_Step2(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) {
    sprite.data[0] = 0;
    sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.x2 = sprite.y2 = 0;
    sprite.callback = AnimFireRing_Step3;
    sprite.callback(sprite);
  } else {
    sprite.x2 += Sin(sprite.data[7], 28);
    sprite.y2 += Cos(sprite.data[7], 28);
    sprite.data[7] = (sprite.data[7] + 20) & 0xff;
  }
}

function AnimFireRing_Step3(sprite: Sprite): void {
  UpdateFireRingCircleOffset(sprite);
  if (++sprite.data[0] === 0x1f) DestroyAnimSprite(sprite);
}

function UpdateFireRingCircleOffset(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[7], 28);
  sprite.y2 = Cos(sprite.data[7], 28);
  sprite.data[7] = (sprite.data[7] + 20) & 0xff;
}

/** AnimFireCross (Fire Blast's cross). Args: x, y, duration, x delta, y delta. */
const AnimFireCross: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinear;
};

/** AnimFireSpiralOutward (Flame Wheel): hidden for a delay, then spirals out from the attacker. Args: x, y, duration, delay. */
const AnimFireSpiralOutward: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.invisible = true;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimFireSpiralOutward_Step1);
};

function AnimFireSpiralOutward_Step1(sprite: Sprite): void {
  sprite.invisible = false;
  sprite.data[0] = sprite.data[1];
  sprite.data[1] = 0;
  sprite.callback = AnimFireSpiralOutward_Step2;
  sprite.callback(sprite);
}

function AnimFireSpiralOutward_Step2(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[1], sprite.data[2] >> 8);
  sprite.y2 = Cos(sprite.data[1], sprite.data[2] >> 8);
  sprite.data[1] = (sprite.data[1] + 10) & 0xff;
  sprite.data[2] += 0xd0;
  if (--sprite.data[0] === -1) DestroyAnimSprite(sprite);
}

// ------------------------------------------------------------------ Eruption

const IDX_ACTIVE_SPRITES = 6;
// Task data: [0] state, [1..3] timers, [4] attacker y, [5] attacker side, [6] active rocks,
// [8..15] BattleAnimHelper_SetSpriteSquashParams ([15] is the attacker's sprite id).
const sEruptionLaunchRockSpeeds = [
  [-2, -5],
  [-1, -1],
  [3, -6],
  [4, -2],
  [2, -8],
  [-5, -5],
  [4, -7],
];

/** AnimTask_EruptionLaunchRocks: the attacker squashes, shakes and launches rocks (gEruptionLaunchRockSpriteTemplate) */
const AnimTask_EruptionLaunchRocks: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 0;
  d[4] = gSprites[d[15]].y;
  d[5] = getBattlerSide(anim.attacker);
  d[IDX_ACTIVE_SPRITES] = 0;
  PrepareBattlerSpriteForRotScale(d[15], ST_OAM_OBJ_NORMAL);
  task.func = AnimTask_EruptionLaunchRocks_Step;
};

const AnimTask_EruptionLaunchRocks_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const mon = gSprites[d[15]];
  switch (d[0]) {
    case 0:
      BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0x100, 0x100, 0xe0, 0x200, 32);
      d[0]++;
    // fallthrough
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        mon.x2 = ++d[2] & 1 ? 3 : -3;
      }
      if (d[5] !== K.B_SIDE_PLAYER && ++d[3] > 4) {
        d[3] = 0;
        mon.y++;
      }
      if (!BattleAnimHelper_RunSpriteSquash(task)) {
        SetBattlerSpriteYOffsetFromYScale(d[15]);
        mon.x2 = 0;
        d[1] = 0;
        d[2] = 0;
        d[3] = 0;
        d[0]++;
      }
      break;
    case 2:
      if (++d[1] > 4) {
        if (d[5] !== K.B_SIDE_PLAYER) BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0xe0, 0x200, 0x180, 0xf0, 6);
        else BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0xe0, 0x200, 0x180, 0xc0, 6);
        d[1] = 0;
        d[0]++;
      }
      break;
    case 3:
      if (!BattleAnimHelper_RunSpriteSquash(task)) {
        CreateEruptionLaunchRocks(d[15], taskId, IDX_ACTIVE_SPRITES);
        d[0]++;
      }
      break;
    case 4:
      if (++d[1] > 1) {
        d[1] = 0;
        if (++d[2] & 1) mon.y2 += 3;
        else mon.y2 -= 3;
      }
      if (++d[3] > 24) {
        if (d[5] !== K.B_SIDE_PLAYER) BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0x180, 0xf0, 0x100, 0x100, 8);
        else BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0x180, 0xc0, 0x100, 0x100, 8);
        if (d[2] & 1) mon.y2 -= 3;
        d[1] = 0;
        d[2] = 0;
        d[3] = 0;
        d[0]++;
      }
      break;
    case 5:
      if (d[5] !== K.B_SIDE_PLAYER) mon.y--;
      if (!BattleAnimHelper_RunSpriteSquash(task)) {
        mon.y = d[4];
        ResetSpriteRotScale(d[15]);
        d[2] = 0;
        d[0]++;
      }
      break;
    case 6:
      if (d[IDX_ACTIVE_SPRITES] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** CreateEruptionLaunchRocks: seven rocks from the attacker's feet, cycling through five rock frames */
function CreateEruptionLaunchRocks(spriteId: number, taskId: number, activeSpritesIdx: number): void {
  const y = GetEruptionLaunchRockInitialYPos(spriteId) & 0xffff;
  let x = gSprites[spriteId].x & 0xffff;
  let sign: number;
  if (!getBattlerSide(anim.attacker)) {
    x -= 12;
    sign = 1;
  } else {
    x += 16;
    sign = -1;
  }
  const template = animSpriteTemplate('gEruptionLaunchRockSpriteTemplate')!;
  for (let i = 0, j = 0; i <= 6; i++) {
    const id = CreateSprite(template, (x << 16) >> 16, (y << 16) >> 16, 2);
    if (id !== MAX_SPRITES) {
      gSprites[id].oam.tileNum += j * 4 + 0x40;
      if (++j >= 5) j = 0;
      InitEruptionLaunchRockCoordData(gSprites[id], sEruptionLaunchRockSpeeds[i][0] * sign, sEruptionLaunchRockSpeeds[i][1]);
      gSprites[id].data[6] = taskId;
      gSprites[id].data[7] = activeSpritesIdx;
      gTasks[taskId].data[activeSpritesIdx]++;
    }
  }
}

/** AnimEruptionLaunchRock (gEruptionLaunchRockSpriteTemplate, made by AnimTask_EruptionLaunchRocks) */
const AnimEruptionLaunchRock: SpriteCallback = (sprite) => {
  UpdateEruptionLaunchRockPos(sprite);
  if (sprite.invisible) {
    gTasks[sprite.data[6]].data[sprite.data[7]]--;
    DestroySprite(sprite);
  }
};

function GetEruptionLaunchRockInitialYPos(spriteId: number): number {
  const s = gSprites[spriteId];
  let y = s.y + s.y2 + s.centerToCornerVecY;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) y += 74;
  else y += 44;
  return (y << 16) >> 16;
}

// Sprite data: [0] speed delay, [1] launch stage, [2]/[3] x/y in 1/8 px, [4]/[5] x/y speed
function InitEruptionLaunchRockCoordData(sprite: Sprite, speedX: number, speedY: number): void {
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = (sprite.x & 0xffff) * 8;
  d[3] = (sprite.y & 0xffff) * 8;
  d[4] = speedX * 8;
  d[5] = speedY * 8;
}

function UpdateEruptionLaunchRockPos(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] > 2) {
    d[0] = 0;
    ++d[1];
    const stage = d[1] & 0xffff;
    d[3] += stage * stage;
  }
  d[2] += d[4];
  sprite.x = d[2] >> 3;
  d[3] += d[5];
  sprite.y = d[3] >> 3;
  if (sprite.x < -8 || sprite.x > DISPLAY_WIDTH + 8 || sprite.y < -8 || sprite.y > 120) sprite.invisible = true;
}

/** AnimEruptionFallingRock: drops from (x, y) after a delay, lands and bounces. Args: x, y, delay, target y, frame. */
const AnimEruptionFallingRock: SpriteCallback = (sprite) => {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = gBattleAnimArgs[1];
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.data[2] = 0;
  sprite.data[6] = gBattleAnimArgs[2];
  sprite.data[7] = gBattleAnimArgs[3];
  sprite.oam.tileNum += gBattleAnimArgs[4] * 16;
  sprite.callback = AnimEruptionFallingRock_Step;
};

// Sprite data: [0] state, [1] bounce timer, [2] bounce direction, [3] end timer, [6] fall delay, [7] target y
function AnimEruptionFallingRock_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      if (d[6] !== 0) {
        d[6]--;
        return;
      }
      d[0]++;
    // fallthrough
    case 1:
      sprite.y += 8;
      if (sprite.y >= d[7]) {
        sprite.y = d[7];
        d[0]++;
      }
      break;
    case 2:
      if (++d[1] > 1) {
        d[1] = 0;
        sprite.y2 = (++d[2] & 1) !== 0 ? -3 : 3;
      }
      if (++d[3] > 16) DestroyAnimSprite(sprite);
      break;
  }
}

// ------------------------------------------------------------------ Will-O-Wisp

/** AnimWillOWispOrb: rises and sways at the attacker, then weaves to the target. Args: x, y, anim (orb number). */
const AnimWillOWispOrb: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      InitSpritePosToAnimAttacker(sprite, false);
      StartSpriteAnim(sprite, gBattleAnimArgs[2]);
      d[7] = gBattleAnimArgs[2];
      d[4] = isOpponent(anim.attacker) ? 4 : -4;
      sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
      ++d[0];
      break;
    case 1:
      d[1] += 192;
      if (isOpponent(anim.attacker)) sprite.y2 = -(d[1] >> 8);
      else sprite.y2 = d[1] >> 8;
      sprite.x2 = Sin(d[2], d[4]);
      d[2] = (d[2] + 4) & 0xff;
      if (++d[3] === 1) {
        d[3] = 0;
        ++d[0];
      }
      break;
    case 2:
      sprite.x2 = Sin(d[2], d[4]);
      d[2] = (d[2] + 4) & 0xff;
      if (++d[3] === 31) {
        sprite.x += sprite.x2;
        sprite.y += sprite.y2;
        sprite.x2 = sprite.y2 = 0;
        d[0] = 256;
        d[1] = sprite.x;
        d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
        d[3] = sprite.y;
        d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
        InitAnimLinearTranslationWithSpeed(sprite);
        sprite.callback = AnimWillOWispOrb_Step;
      }
      break;
  }
};

function AnimWillOWispOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[5], 16);
    const initialData5 = d[5];
    d[5] = (d[5] + 4) & 0xff;
    const newData5 = d[5];
    if ((initialData5 === 0 || initialData5 > 196) && newData5 > 0 && d[7] === 0) PlaySE12WithPanning(K.SE_M_FLAME_WHEEL, anim.customPanning);
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimWillOWispFire: circles the target, passing behind it for half the turn, flickering out. Arg 0: wave offset. */
const AnimWillOWispFire: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (!d[0]) {
    d[1] = gBattleAnimArgs[0];
    ++d[0];
  }
  d[3] += 0xc0 * 2;
  d[4] += 0xa0;
  sprite.x2 = Sin(d[1], d[3] >> 8);
  sprite.y2 = Cos(d[1], d[4] >> 8);
  d[1] = (d[1] + 7) & 0xff;
  if (!IsContest()) {
    if (d[1] < 64 || d[1] > 195) sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
    else sprite.oam.priority = (GetBattlerSpriteBGPriority(anim.target) + 1) & 3;
  } else {
    sprite.subpriority = d[1] < 64 || d[1] > 195 ? 0x1d : 0x1f;
  }
  if (++d[2] > 0x14) sprite.invisible = !sprite.invisible;
  if (d[2] === 0x1e) DestroyAnimSprite(sprite);
};

// ------------------------------------------------------------------ Heat Wave and shared tasks

/** AnimTask_MoveHeatWaveTargets: shoves the target (and its partner) away from the attacker, jittering, then back */
const AnimTask_MoveHeatWaveTargets: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.data[12] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? 1 : -1;
  task.data[13] = (IsBattlerSpriteVisible(anim.target ^ K.BIT_FLANK) ? 1 : 0) + 1;
  task.data[14] = GetAnimBattlerSpriteId(K.ANIM_TARGET);
  task.data[15] = GetAnimBattlerSpriteId(K.ANIM_DEF_PARTNER);
  task.func = AnimTask_MoveHeatWaveTargets_Step;
};

const AnimTask_MoveHeatWaveTargets_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const jitter = (every: number) => {
    if (++d[1] >= every) {
      d[1] = 0;
      ++d[2];
      d[11] = d[2] & 1 ? 2 : -2;
    }
    for (d[3] = 0; d[3] < d[13]; d[3]++) gSprites[d[d[3] + 14]].x2 = d[10] + d[11];
  };
  switch (d[0]) {
    case 0:
      d[10] += d[12] * 2;
      jitter(2);
      if (++d[9] === 16) {
        d[9] = 0;
        ++d[0];
      }
      break;
    case 1:
      jitter(5);
      if (++d[9] === 96) {
        d[9] = 0;
        ++d[0];
      }
      break;
    case 2:
      d[10] -= d[12] * 2;
      jitter(2);
      if (++d[9] === 16) ++d[0];
      break;
    case 3:
      for (d[3] = 0; d[3] < d[13]; d[3]++) gSprites[d[d[3] + 14]].x2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_BlendBackground: blends the anim BG1 palette towards a colour. Args: coefficient, colour. */
const AnimTask_BlendBackground: TaskFunc = (taskId) => {
  const animBg = GetBattleAnimBg1Data();
  BlendPalette(BG_PLTT_ID(animBg.paletteId), 16, gBattleAnimArgs[0], gBattleAnimArgs[1]);
  DestroyAnimVisualTask(taskId);
};

// Directions for AnimTask_ShakeTargetInPattern (only the first 10 are used): the first pattern shakes
// further, the second oscillates faster.
const sShakeDirsPattern0 = [-1, -1, 0, 1, 1, 0, 0, -1, -1, 1, 1, 0, 0, -1, 0, 1];
const sShakeDirsPattern1 = [-1, 0, 1, 0, -1, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, 1];

/** AnimTask_ShakeTargetInPattern (Thunder, Glare, Scary Face, Tri Attack). Args: shakes, offset, vertical, pattern. */
const AnimTask_ShakeTargetInPattern: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    d[1] = gBattleAnimArgs[0];
    d[2] = gBattleAnimArgs[1];
    d[3] = gBattleAnimArgs[2];
    d[4] = gBattleAnimArgs[3];
  }
  d[0]++;
  const spriteId = g.battlerSpriteIds[anim.target];
  const dir = (d[4] === 0 ? sShakeDirsPattern0 : sShakeDirsPattern1)[d[0] % 10];
  if (d[3] === 1) gSprites[spriteId].y2 = Math.abs(gBattleAnimArgs[1] * dir);
  else gSprites[spriteId].x2 = gBattleAnimArgs[1] * dir;
  if (d[0] === d[1]) {
    gSprites[spriteId].x2 = 0;
    gSprites[spriteId].y2 = 0;
    DestroyAnimVisualTask(taskId);
  }
};

export const fireSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimFireSpiralInward,
  AnimFireSpread,
  AnimFirePlume,
  AnimLargeFlame,
  AnimUnusedSmallEmber,
  AnimSunlight,
  AnimEmberFlare,
  AnimBurnFlame,
  AnimFireRing,
  AnimFireCross,
  AnimFireSpiralOutward,
  AnimEruptionLaunchRock,
  AnimEruptionFallingRock,
  AnimWillOWispOrb,
  AnimWillOWispFire,
};

export const fireTasks: Record<string, TaskFunc> = {
  AnimTask_EruptionLaunchRocks,
  AnimTask_MoveHeatWaveTargets,
  AnimTask_BlendBackground,
  AnimTask_ShakeTargetInPattern,
};
