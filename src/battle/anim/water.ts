// battle_anim_water.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  gSprites,
  SpriteCallbackDummy,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  AnimTranslateLinear,
  DestroySpriteAndMatrix,
  GetBattleAnimBg1Data,
  GetBattlerSpriteCoord,
  InitAnimLinearTranslation,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  StartAnimLinearTranslation,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';
import { gfx16 } from '../../gba/gfx';
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
import { BG_PLTT_ID, gPlttBufferFaded, LoadCompressedPalette, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  gScanlineEffect,
  gScanlineEffectRegBuffers,
  SCANLINE_EFFECT_DMACNT_16BIT,
  ScanlineEffect_SetParams,
  ScanlineEffect_Stop,
} from '../../gba/scanline';
import { random } from '../../util/random';
import { g } from '../env';
import { animSpriteTemplate } from './battleAnim';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

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

// AnimTask_CreateSurfWave (Surf, Muddy Water): the wave tilemap on BG1 scrolls across the screen. A helper
// task blends it in with a per-scanline BLDALPHA band (full alpha above/below it) that sweeps open.
// Arg 0: Muddy Water's palette.
const AnimTask_CreateSurfWave: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 1);
  const animBg = GetBattleAnimBg1Data();
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  const opponent = getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT;
  AnimLoadCompressedBgTilemap(animBg.bgId, opponent ? 'gBattleAnimBgTilemap_SurfOpponent' : 'gBattleAnimBgTilemap_SurfPlayer');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gBattleAnimBgImage_Surf', animBg.tilesOffset);
  const pal = gBattleAnimArgs[0] === 0 ? 'gBattleAnimBgPalette_Surf' : 'gBattleAnimBgPalette_MuddyWater';
  LoadCompressedPalette(gfx16(pal), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  const taskId2 = CreateTask(AnimTask_SurfWaveScanlineEffect, gTasks[taskId].priority + 1);
  const d = gTasks[taskId].data;
  const d2 = gTasks[taskId2].data;
  d[15] = taskId2;
  d2[0] = 0;
  d2[1] = 0x1000;
  d2[2] = 0x1000;
  if (opponent) {
    g.battle_BG1_X = -224;
    g.battle_BG1_Y = 256;
    d[0] = 2;
    d[1] = -1;
    d2[3] = 1;
  } else {
    g.battle_BG1_X = 0;
    g.battle_BG1_Y = -48;
    d[0] = -2;
    d[1] = 1;
    d2[3] = 0;
  }
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  if (d2[3] === 0) {
    d2[4] = 48;
    d2[5] = 112;
  } else {
    d2[4] = 0;
    d2[5] = 0;
  }
  d[6] = 1;
  gTasks[taskId].func = AnimTask_CreateSurfWave_Step1;
};

const AnimTask_SurfWaveScanlineEffect: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  // Lines [data4, data5) get the band's BLDALPHA (data1), the rest data2.
  const fill = (buf: Uint16Array) => {
    let i = 0;
    for (; i < d[4]; i++) buf[i] = d[2];
    for (i = d[4]; i < d[5]; i++) buf[i] = d[1];
    for (i = d[5]; i < 160; i++) buf[i] = d[2];
    return i;
  };
  switch (d[0]) {
    case 0: {
      fill(gScanlineEffectRegBuffers[1]);
      const i = fill(gScanlineEffectRegBuffers[0]);
      gScanlineEffectRegBuffers[0][i] = gScanlineEffectRegBuffers[1][i] = d[4] === 0 ? d[1] : d[2];
      ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_BLDALPHA, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
      d[0]++;
      break;
    }
    case 1:
      if (d[3] === 0) {
        if (--d[4] <= 0) {
          d[4] = 0;
          d[0]++;
        }
      } else if (++d[5] > 111) {
        d[0]++;
      }
      fill(gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer]);
      break;
    case 2:
      fill(gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer]);
      if (d[15] === -1) {
        ScanlineEffect_Stop();
        DestroyTask(taskId);
      }
      break;
  }
};

const AnimTask_CreateSurfWave_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const d2 = gTasks[d[15]].data;
  g.battle_BG1_X += d[0];
  g.battle_BG1_Y += d[1];
  const animBg = GetBattleAnimBg1Data();
  d[2] += d[1];
  if (++d[5] === 4) {
    // rotate colours 1-7 of the wave palette
    const base = 16 * animBg.paletteId;
    const rgbBuffer = gPlttBufferFaded[base + 7];
    for (let i = 6; i !== 0; i--) gPlttBufferFaded[base + 1 + i] = gPlttBufferFaded[base + i];
    gPlttBufferFaded[base + 1] = rgbBuffer;
    d[5] = 0;
  }
  if (++d[6] > 1) {
    d[6] = 0;
    if (++d[3] < 14) {
      d2[1] = d[3] | ((16 - d[3]) << 8);
      d[4]++;
    }
    if (d[3] > 54) {
      d[4]--;
      d2[1] = d[4] | ((16 - d[4]) << 8);
    }
  }
  if (!(d2[1] & 0x1f)) {
    d[0] = d2[1] & 0x1f;
    gTasks[taskId].func = AnimTask_CreateSurfWave_Step2;
  }
};

const AnimTask_CreateSurfWave_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    InitBattleAnimBg(1);
    InitBattleAnimBg(2);
    d[0]++;
  } else {
    SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
    g.battle_BG1_X = 0;
    g.battle_BG1_Y = 0;
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0));
    gTasks[d[15]].data[15] = -1;
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_CreateRaindrops (Rain Dance, General_Rain): a drop at a random spot every few frames. Args: -, interval, duration. */
const AnimTask_CreateRaindrops: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    d[1] = gBattleAnimArgs[0];
    d[2] = gBattleAnimArgs[1];
    d[3] = gBattleAnimArgs[2];
  }
  d[0]++;
  if (d[0] % d[2] === 1) {
    const x = random() % DISPLAY_WIDTH;
    const y = random() % (DISPLAY_HEIGHT / 2);
    CreateSprite(animSpriteTemplate('gRainDropSpriteTemplate')!, x, y, 4);
  }
  if (d[0] === d[3]) DestroyAnimVisualTask(taskId);
};

/** AnimRainDrop (gRainDropSpriteTemplate, made by AnimTask_CreateRaindrops) */
const AnimRainDrop: SpriteCallback = (sprite) => {
  sprite.callback = AnimRainDrop_Step;
};

function AnimRainDrop_Step(sprite: Sprite): void {
  if (++sprite.data[0] < 14) {
    sprite.x2 += 1;
    sprite.y2 += 4;
  }
  if (sprite.animEnded) DestroySprite(sprite);
}

export const waterSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimWaterBubbleProjectile,
  AnimToTargetInSinWave,
  AnimWaterGunDroplet,
  AnimSmallBubblePair,
  AnimRainDrop,
};

export const waterTasks: Record<string, TaskFunc> = {
  AnimTask_StartSinAnimTimer,
  AnimTask_CreateSurfWave,
  AnimTask_CreateRaindrops,
};

export function registerWaterExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_CreateSurfWave: ['gBattleAnimBgTilemap_SurfOpponent', 'gBattleAnimBgTilemap_SurfPlayer', 'gBattleAnimBgImage_Surf', 'gBattleAnimBgPalette_Surf', 'gBattleAnimBgPalette_MuddyWater'],
  });
}
