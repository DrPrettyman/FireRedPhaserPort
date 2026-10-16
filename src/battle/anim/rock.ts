// battle_anim_rock.c: every sprite callback and task in the file.

import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPLAY_WIDTH,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  SetGpuReg,
} from '../../gba/hw';
import { BG_PLTT_ID, LoadCompressedPalette, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  AnimateSprite,
  CreateSprite,
  DestroySprite,
  gSprites,
  MAX_SPRITES,
  SetSubspriteTables,
  SPRITE_SHAPE,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  ST_OAM_HFLIP,
  type Sprite,
  type SpriteCallback,
  type SubspriteTable,
} from '../../gba/sprite';
import { FindTaskIdByFunc, gTasks, TASK_NONE, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  BATTLE_PARTNER,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteCoord,
  InitAnimArcTranslation,
  InitBattleAnimBg,
  InitSpriteDataForLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  SetAnimBgAttribute,
  SetAverageBattlerPositions,
  StartAnimLinearTranslation,
  ToggleBg3Mode,
  TranslateAnimHorizontalArc,
  TranslateAnimSpriteToTargetMonLocation,
  TranslateSpriteInEllipse,
  TranslateSpriteLinearFixedPoint,
} from './animMons';
import { animSpriteTemplate, BattleAnimAdjustPanning, PlaySE12WithPanning } from './battleAnim';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimFallingRock (Rock Throw, Rock Slide): drops in, then bounces off. Args: x, anim, bounce x speed, both targets. */
const AnimFallingRock: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[3] !== 0) {
    const p = SetAverageBattlerPositions(anim.target, false);
    sprite.x = p.x;
    sprite.y = p.y;
  }
  sprite.x += gBattleAnimArgs[0];
  sprite.y += 14;
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  AnimateSprite(sprite);
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 4;
  d[3] = 16;
  d[4] = -70;
  d[5] = gBattleAnimArgs[2];
  StoreSpriteCallbackInData6(sprite, AnimFallingRock_Step);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
};

function AnimFallingRock_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x += d[5];
  d[0] = 192;
  d[1] = d[5];
  d[2] = 4;
  d[3] = 32;
  d[4] = -24;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
}

/** AnimRockFragment (Rock Smash, Rock Blast): flies off in a line. Args: x, y, x distance, y distance, duration, anim. */
const AnimRockFragment: SpriteCallback = (sprite) => {
  StartSpriteAnim(sprite, gBattleAnimArgs[5]);
  AnimateSprite(sprite);
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = sprite.x;
  d[2] = sprite.x + gBattleAnimArgs[2];
  d[3] = sprite.y;
  d[4] = sprite.y + gBattleAnimArgs[3];
  InitSpriteDataForLinearTranslation(sprite);
  d[3] = 0;
  d[4] = 0;
  sprite.callback = TranslateSpriteLinearFixedPoint;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

// AnimParticleInVortex (Fire Spin, Sand Tomb, Whirlpool): rises while swaying. Args: x, y, rise speed,
// duration, wave speed, wave amplitude, battler (0 attacker).
const AnimParticleInVortex: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[6] === 0) InitSpritePosToAnimAttacker(sprite, false);
  else InitSpritePosToAnimTarget(sprite, false);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.callback = AnimParticleInVortex_Step;
};

function AnimParticleInVortex_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[1];
  sprite.y2 = -(d[4] >> 8);
  sprite.x2 = Sin(d[5], d[3]);
  d[5] = (d[5] + d[2]) & 0xff;
  if (--d[0] === -1) DestroyAnimSprite(sprite);
}

// AnimTask_LoadSandstormBackground (Sandstorm, Heat Wave): the sandstorm tilemap on BG1 scrolls across,
// blending in over 28 frames, holding for 100, then fading out. Arg 0: scroll the other way for an opponent.
const AnimTask_LoadSandstormBackground: TaskFunc = (taskId) => {
  let var0 = 0;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gFile_graphics_battle_anims_backgrounds_sandstorm_brew_tilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gFile_graphics_battle_anims_backgrounds_sandstorm_brew_sheet', animBg.tilesOffset);
  LoadCompressedPalette(gfx16('gBattleAnimSpritePal_FlyingDirt'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  if (gBattleAnimArgs[0] && isOpponent(anim.attacker)) var0 = 1;
  gTasks[taskId].data[0] = var0;
  gTasks[taskId].func = AnimTask_LoadSandstormBackground_Step;
};

const AnimTask_LoadSandstormBackground_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) g.battle_BG1_X += -6;
  else g.battle_BG1_X += 6;
  g.battle_BG1_Y += -1;
  switch (d[12]) {
    case 0:
      if (++d[10] === 4) {
        d[10] = 0;
        d[11]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], 16 - d[11]));
        if (d[11] === 7) {
          d[12]++;
          d[11] = 0;
        }
      }
      break;
    case 1:
      if (++d[11] === 101) {
        d[11] = 7;
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
      InitBattleAnimBg(GetBattleAnimBg1Data().bgId);
      d[12]++;
      break;
    case 4:
      SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
      g.battle_BG1_X = 0;
      g.battle_BG1_Y = 0;
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** sFlyingSandSubspriteTable: two 32x16 halves side by side */
const sFlyingSandSubspriteTable: SubspriteTable[] = [
  {
    subspriteCount: 2,
    subsprites: [
      { x: -16, y: 0, shape: SPRITE_SHAPE['32x16'][0], size: SPRITE_SHAPE['32x16'][1], tileOffset: 0, priority: 1 },
      { x: 16, y: 0, shape: SPRITE_SHAPE['32x16'][0], size: SPRITE_SHAPE['32x16'][1], tileOffset: 8, priority: 1 },
    ],
  },
];

// AnimFlyingSandCrescent (Sandstorm, Heat Wave): flies diagonally across the screen. Args: y, x speed (Q8),
// y speed (Q8), from the right for an opponent attacker.
const AnimFlyingSandCrescent: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) {
    if (gBattleAnimArgs[3] !== 0 && isOpponent(anim.attacker)) {
      sprite.x = 304;
      gBattleAnimArgs[1] = -gBattleAnimArgs[1];
      d[5] = 1;
      sprite.oam.matrixNum = ST_OAM_HFLIP;
    } else {
      sprite.x = -64;
    }
    sprite.y = gBattleAnimArgs[0];
    SetSubspriteTables(sprite, sFlyingSandSubspriteTable);
    d[1] = gBattleAnimArgs[1];
    d[2] = gBattleAnimArgs[2];
    d[0]++;
  } else {
    d[3] += d[1];
    d[4] += d[2];
    sprite.x2 += d[3] >> 8;
    sprite.y2 += d[4] >> 8;
    d[3] &= 0xff;
    d[4] &= 0xff;
    if (d[5] === 0) {
      if (sprite.x + sprite.x2 > DISPLAY_WIDTH + 32) sprite.callback = DestroyAnimSprite;
    } else if (sprite.x + sprite.x2 < -32) {
      sprite.callback = DestroyAnimSprite;
    }
  }
};

/** AnimRaiseSprite (Ancient Power): a rock rises from the attacker. Args: x, y, rise, duration, anim. */
const AnimRaiseSprite: SpriteCallback = (sprite) => {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  InitSpritePosToAnimAttacker(sprite, false);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[2] = sprite.x;
  sprite.data[4] = sprite.y + gBattleAnimArgs[2];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// AnimTask_Rollout: the attacker winds back, then rolls to the target throwing up dirt (bigger rocks as the
// Rollout counter grows), and waits for the last particle to land.
const AnimTask_Rollout: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const var0 = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) & 0xffff;
  const var1 = (GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 24) & 0xffff;
  const var2 = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) & 0xffff;
  let var3 = (GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 24) & 0xffff;
  if (BATTLE_PARTNER(anim.attacker) === anim.target) var3 = var1;
  const rolloutCounter = GetRolloutCounter();
  if (rolloutCounter === 1) d[8] = 32;
  else d[8] = 48 - rolloutCounter * 8;
  d[0] = 0;
  d[11] = 0;
  d[9] = 0;
  d[12] = 1;
  let var5 = d[8];
  if (var5 < 0) var5 += 7;
  d[10] = (var5 >> 3) - 1;
  d[2] = var0 * 8;
  d[3] = var1 * 8;
  d[4] = Math.trunc(((var2 - var0) * 8) / d[8]);
  d[5] = Math.trunc(((var3 - var1) * 8) / d[8]);
  d[6] = 0;
  d[7] = 0;
  const pan1 = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  const pan2 = BattleAnimAdjustPanning(K.SOUND_PAN_TARGET);
  d[13] = pan1;
  d[14] = Math.trunc((pan2 - pan1) / d[8]);
  d[1] = rolloutCounter;
  d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.func = AnimTask_Rollout_Step;
};

const AnimTask_Rollout_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[6] -= d[4];
      d[7] -= d[5];
      gSprites[d[15]].x2 = d[6] >> 3;
      gSprites[d[15]].y2 = d[7] >> 3;
      if (++d[9] === 10) {
        d[11] = 20;
        d[0]++;
      }
      PlaySE12WithPanning(K.SE_M_HEADBUTT, d[13]);
      break;
    case 1:
      if (--d[11] === 0) d[0]++;
      break;
    case 2:
      if (--d[9] !== 0) {
        d[6] += d[4];
        d[7] += d[5];
      } else {
        d[6] = 0;
        d[7] = 0;
        d[0]++;
      }
      gSprites[d[15]].x2 = d[6] >> 3;
      gSprites[d[15]].y2 = d[7] >> 3;
      break;
    case 3:
      d[2] += d[4];
      d[3] += d[5];
      if (++d[9] >= d[10]) {
        d[9] = 0;
        CreateRolloutDirtSprite(task);
        d[13] += d[14];
        PlaySE12WithPanning(K.SE_M_DIG, d[13]);
      }
      if (--d[8] === 0) d[0]++;
      break;
    case 4:
      if (d[11] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

function CreateRolloutDirtSprite(task: Task): void {
  const d = task.data;
  let templateName: string;
  let tileOffset: number;
  switch (d[1]) {
    case 1:
      templateName = 'gRolloutMudSpriteTemplate';
      tileOffset = 0;
      break;
    case 2:
    case 3:
      templateName = 'gRolloutRockSpriteTemplate';
      tileOffset = 80;
      break;
    case 4:
      templateName = 'gRolloutRockSpriteTemplate';
      tileOffset = 64;
      break;
    case 5:
      templateName = 'gRolloutRockSpriteTemplate';
      tileOffset = 48;
      break;
    default:
      return;
  }
  let x = (d[2] >> 3) & 0xffff;
  const y = (d[3] >> 3) & 0xffff;
  x = (x + d[12] * 4) & 0xffff;
  const spriteId = CreateSprite(animSpriteTemplate(templateName)!, x, y, 35);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[0] = 18;
    s.data[2] = d[12] * 20 + x + d[1] * 3;
    s.data[4] = y;
    s.data[5] = -16 - d[1] * 2;
    s.oam.tileNum += tileOffset;
    InitAnimArcTranslation(s);
    d[11]++;
  }
  d[12] *= -1;
}

/** AnimRolloutParticle (gRolloutMudSpriteTemplate / gRolloutRockSpriteTemplate, made by AnimTask_Rollout) */
const AnimRolloutParticle: SpriteCallback = (sprite) => {
  if (TranslateAnimHorizontalArc(sprite)) {
    const taskId = FindTaskIdByFunc(AnimTask_Rollout_Step);
    if (taskId !== TASK_NONE) gTasks[taskId].data[11]--;
    DestroySprite(sprite);
  }
};

/** GetRolloutCounter: which Rollout hit this is (1-5) */
function GetRolloutCounter(): number {
  const ds = anim.disableStruct;
  let retVal = ((ds?.rolloutTimerStartValue ?? 0) - (ds?.rolloutTimer ?? 0)) & 0xff;
  const var0 = (retVal - 1) & 0xff;
  if (var0 > 4) retVal = 1;
  return retVal;
}

/** AnimRockTomb: a rock drops onto the target with gravity, then stays. Args: x, y, drop height, duration, anim. */
const AnimRockTomb: SpriteCallback = (sprite) => {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  sprite.x2 = gBattleAnimArgs[0];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] -= gBattleAnimArgs[2];
  sprite.data[0] = 3;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimRockTomb_Step;
  sprite.invisible = true;
};

function AnimRockTomb_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.invisible = false;
  if (d[3] !== 0) {
    sprite.y2 = d[2] + d[3];
    d[3] += d[0];
    d[0]++;
    if (d[3] > 0) d[3] = 0;
  } else if (--d[1] === 0) {
    DestroyAnimSprite(sprite);
  }
}

/** AnimRockBlastRock: TranslateAnimSpriteToTargetMonLocation, spinning the other way for an opponent attacker. */
const AnimRockBlastRock: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) StartSpriteAffineAnim(sprite, 1);
  TranslateAnimSpriteToTargetMonLocation(sprite);
};

/** AnimRockScatter (Seismic Toss, Weather Ball): a rock bouncing off the target. Args: x, y, arc height, anim. */
const AnimRockScatter: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] = gBattleAnimArgs[0];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[5] = gBattleAnimArgs[2];
  StartSpriteAnim(sprite, gBattleAnimArgs[3]);
  sprite.callback = AnimRockScatter_Step;
};

function AnimRockScatter_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0] += 8;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 += Math.trunc(d[3] / 40);
  sprite.y2 -= Sin(d[0], d[5]);
  if (d[0] > 140) DestroyAnimSprite(sprite);
}

/** AnimTask_GetSeismicTossDamageLevel: 0 (< 33 damage), 1 (< 66) or 2 in ARG_RET_ID */
const AnimTask_GetSeismicTossDamageLevel: TaskFunc = (taskId) => {
  if (anim.moveDmg < 33) gBattleAnimArgs[ARG_RET_ID] = 0;
  if ((anim.moveDmg - 33) >>> 0 < 33) gBattleAnimArgs[ARG_RET_ID] = 1;
  if (anim.moveDmg > 65) gBattleAnimArgs[ARG_RET_ID] = 2;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_MoveSeismicTossBg: scrolls BG3 up, slowing down and turning back, for 120 frames */
const AnimTask_MoveSeismicTossBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    ToggleBg3Mode(false);
    d[1] = 200;
  }
  g.battle_BG3_Y += Math.trunc(d[1] / 10);
  d[1] -= 3;
  if (d[0] === 120) {
    ToggleBg3Mode(true);
    DestroyAnimVisualTask(taskId);
  }
  d[0]++;
};

/** AnimTask_SeismicTossBgAccelerateDownAtEnd: wobbles BG3 until the script sets arg 7 to 0xFFF */
const AnimTask_SeismicTossBgAccelerateDownAtEnd: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    ToggleBg3Mode(false);
    d[0]++;
    d[2] = g.battle_BG3_Y;
  }
  d[1] += 80;
  d[1] &= 0xff;
  g.battle_BG3_Y = d[2] + Cos(4, d[1]);
  if (gBattleAnimArgs[7] === 0xfff) {
    g.battle_BG3_Y = 0;
    ToggleBg3Mode(true);
    DestroyAnimVisualTask(taskId);
  }
};

export const rockSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimFallingRock,
  AnimRockFragment,
  AnimParticleInVortex,
  AnimFlyingSandCrescent,
  AnimRaiseSprite,
  AnimRolloutParticle,
  AnimRockTomb,
  AnimRockBlastRock,
  AnimRockScatter,
};

export const rockTasks: Record<string, TaskFunc> = {
  AnimTask_LoadSandstormBackground,
  AnimTask_Rollout,
  AnimTask_GetSeismicTossDamageLevel,
  AnimTask_MoveSeismicTossBg,
  AnimTask_SeismicTossBgAccelerateDownAtEnd,
};

export function registerRockExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_LoadSandstormBackground: [
      'gFile_graphics_battle_anims_backgrounds_sandstorm_brew_tilemap',
      'gFile_graphics_battle_anims_backgrounds_sandstorm_brew_sheet',
      'gBattleAnimSpritePal_FlyingDirt',
    ],
  });
}
