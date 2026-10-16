// battle_anim_water.c: sprite callbacks and tasks (the whole file). Contest-only branches are left out
// (IsContest() is always FALSE in FRLG).

import {
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpriteOamMatrix,
  gSprites,
  IndexOfSpritePaletteTag,
  MAX_SPRITES,
  SpriteCallbackDummy,
  ST_OAM_OBJ_NORMAL,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, NUM_TASKS, TASK_NONE, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  AnimTranslateLinear,
  BattleAnimHelper_RunSpriteSquash,
  BattleAnimHelper_SetSpriteSquashParams,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteCoord,
  GetBattlerSpriteSubpriority,
  InitAnimArcTranslation,
  InitAnimLinearTranslation,
  InitBattleAnimBg,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetBattlerSpriteYOffsetFromYScale,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx, taskFuncByName } from './state';
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
import { BG_PLTT_ID, gPlttBufferFaded, LoadCompressedPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
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
/** RAND_MULT (random.h), for ISO_RANDOMIZE2 */
const RAND_MULT = 1103515245;

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

/** AnimAuroraBeamRings: rings to the target; they turn (anim 1) once AnimTask_StartSinAnimTimer is done. Args: x, y, target x, target y, duration. */
const AnimAuroraBeamRings: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const xOffset = isOpponent(anim.attacker) ? -gBattleAnimArgs[2] : gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + xOffset;
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  InitAnimLinearTranslation(sprite);
  sprite.callback = AnimAuroraBeamRings_Step;
  sprite.affineAnimPaused = true;
  sprite.callback(sprite);
};

function AnimAuroraBeamRings_Step(sprite: Sprite): void {
  if ((gBattleAnimArgs[7] & 0xffff) === 0xffff) {
    StartSpriteAnim(sprite, 1);
    sprite.affineAnimPaused = false;
  }
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
}

/** AnimTask_RotateAuroraRingColors: rotates colours 1-8 of the rainbow rings' palette every 3 frames. Arg 0: duration. */
const AnimTask_RotateAuroraRingColors: TaskFunc = (taskId) => {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  gTasks[taskId].data[2] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(K.ANIM_TAG_RAINBOW_RINGS));
  gTasks[taskId].func = AnimTask_RotateAuroraRingColors_Step;
};

const AnimTask_RotateAuroraRingColors_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[10] === 3) {
    d[10] = 0;
    const palIndex = (d[2] + 1) & 0xffff;
    const temp = gPlttBufferFaded[palIndex];
    for (let i = 1; i < 8; i++) gPlttBufferFaded[palIndex + i - 1] = gPlttBufferFaded[palIndex + i];
    gPlttBufferFaded[palIndex + 7] = temp;
  }
  if (++d[11] === d[0]) DestroyAnimVisualTask(taskId);
};

/** AnimHydroCannonCharge: an orb growing by the attacker (Hydro Cannon), gone when its affine anim ends. */
const AnimHydroCannonCharge: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
  sprite.y2 = -10;
  const priority = GetBattlerSpriteSubpriority(anim.attacker);
  // (the contest branch is left out)
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x2 = 10;
    sprite.subpriority = (priority + 2) & 0xff;
  } else {
    sprite.x2 = -10;
    sprite.subpriority = (priority - 2) & 0xff;
  }
  sprite.callback = AnimHydroCannonCharge_Step;
};

function AnimHydroCannonCharge_Step(sprite: Sprite): void {
  if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
}

// AnimHydroCannonBeam: orbs from the attacker to the target. Args: x, y, target x, target y, duration,
// flags (low byte: aim at the target's feet, not its pic centre; high byte: ignore the attacker's pic offsets).
const AnimHydroCannonBeam: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === getBattlerSide(anim.target)) {
    gBattleAnimArgs[0] *= -1;
    const pos = getBattlerPosition(anim.attacker);
    if (pos === K.B_POSITION_PLAYER_LEFT || pos === K.B_POSITION_OPPONENT_LEFT) gBattleAnimArgs[0] *= -1;
  }
  const respectOffsets = (gBattleAnimArgs[5] & 0xff00) === 0;
  const coordType = (gBattleAnimArgs[5] & 0xff) === 0 ? K.BATTLER_COORD_Y_PIC_OFFSET : K.BATTLER_COORD_Y;
  InitSpritePosToAnimAttacker(sprite, respectOffsets);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[4];
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  d[4] = GetBattlerSpriteCoord(anim.target, coordType) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSmallDriftingBubbles: bubbles scattering from the target (Waterfall, Dive). Args: x, y. */
const AnimSmallDriftingBubbles: SpriteCallback = (sprite) => {
  sprite.oam.tileNum += 8;
  InitSpritePosToAnimTarget(sprite, true);
  const randData = (random() & 0xff) | 256;
  let randData2 = random() & 0x1ff;
  if (randData2 > 255) randData2 = 256 - randData2;
  sprite.data[1] = randData;
  sprite.data[2] = randData2;
  sprite.callback = AnimSmallDriftingBubbles_Step;
};

function AnimSmallDriftingBubbles_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 = d[1] & 1 ? -(d[3] >> 8) : d[3] >> 8;
  sprite.y2 = d[4] >> 8;
  if (++d[0] === 21) DestroyAnimSprite(sprite);
}

// AnimTask_WaterSpoutLaunch (Water Spout): the attacker squashes, shakes and stretches, shooting up a fan of
// droplets (more the healthier it is); ends once they're all off screen. data[2] counts live droplets.
const AnimTask_WaterSpoutLaunch: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.data[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.data[5] = gSprites[task.data[15]].y;
  task.data[1] = GetWaterSpoutPowerForAnim();
  PrepareBattlerSpriteForRotScale(task.data[15], ST_OAM_OBJ_NORMAL);
  task.func = AnimTask_WaterSpoutLaunch_Step;
};

const AnimTask_WaterSpoutLaunch_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const mon = gSprites[d[15]];
  switch (d[0]) {
    case 0:
      BattleAnimHelper_SetSpriteSquashParams(task, d[15], 0x100, 0x100, 224, 0x200, 32);
      d[0]++;
    // fallthrough
    case 1:
      if (++d[3] > 1) {
        d[3] = 0;
        if (++d[4] & 1) {
          mon.x2 = 3;
          mon.y++;
        } else {
          mon.x2 = -3;
        }
      }
      if (BattleAnimHelper_RunSpriteSquash(task) === 0) {
        SetBattlerSpriteYOffsetFromYScale(d[15]);
        mon.x2 = 0;
        d[3] = 0;
        d[4] = 0;
        d[0]++;
      }
      break;
    case 2:
      if (++d[3] > 4) {
        BattleAnimHelper_SetSpriteSquashParams(task, d[15], 224, 0x200, 384, 224, 8);
        d[3] = 0;
        d[0]++;
      }
      break;
    case 3:
      if (BattleAnimHelper_RunSpriteSquash(task) === 0) {
        d[3] = 0;
        d[4] = 0;
        d[0]++;
      }
      break;
    case 4:
      CreateWaterSpoutLaunchDroplets(task, taskId);
      d[0]++;
    // fallthrough
    case 5:
      if (++d[3] > 1) {
        d[3] = 0;
        if (++d[4] & 1) mon.y2 += 2;
        else mon.y2 -= 2;
        if (d[4] === 10) {
          BattleAnimHelper_SetSpriteSquashParams(task, d[15], 384, 224, 0x100, 0x100, 8);
          d[3] = 0;
          d[4] = 0;
          d[0]++;
        }
      }
      break;
    case 6:
      mon.y--;
      if (BattleAnimHelper_RunSpriteSquash(task) === 0) {
        ResetSpriteRotScale(d[15]);
        mon.y = d[5];
        d[4] = 0;
        d[0]++;
      }
      break;
    case 7:
      if (d[2] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** GetWaterSpoutPowerForAnim: which quarter of its max HP the attacker is in (0-3). */
function GetWaterSpoutPowerForAnim(): number {
  const party = isOpponent(anim.attacker) ? g.enemyParty : g.playerParty;
  const mon = party[g.battlerPartyIndexes[anim.attacker]];
  const hp = mon?.hp ?? 0;
  const quarter = ((mon?.maxHP ?? 0) & 0xffff) >> 2;
  for (let i = 0; i < 3; i++) if (hp < quarter * (i + 1)) return i;
  return 3;
}

function CreateWaterSpoutLaunchDroplets(task: Task, taskId: number): void {
  const x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  const y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  let trigIndex = 172;
  const subpriority = (GetBattlerSpriteSubpriority(anim.attacker) - 1) & 0xff;
  let increment = 4 - task.data[1];
  if (increment <= 0) increment = 1;
  for (let i = 0; i < 20; i += increment) {
    const spriteId = CreateSprite(animSpriteTemplate('gSmallWaterOrbSpriteTemplate')!, x, y, subpriority);
    if (spriteId !== MAX_SPRITES) {
      const d = gSprites[spriteId].data;
      d[1] = i;
      d[2] = x * 16;
      d[3] = y * 16;
      d[4] = Cos(trigIndex, 64);
      d[5] = Sin(trigIndex, 64);
      d[6] = taskId;
      d[7] = 2;
      if (task.data[2] & 1) AnimSmallWaterOrb(gSprites[spriteId]);
      task.data[2]++;
    }
    trigIndex = (trigIndex + increment * 2) & 0xff;
  }
}

/** AnimSmallWaterOrb (gSmallWaterOrbSpriteTemplate): data[2..5] 1/16 px position and velocity; data[6..7] the task slot counting it. */
function AnimSmallWaterOrb(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      d[4] += (d[1] % 6) * 3;
      d[5] += (d[1] % 3) * 3;
      d[0]++;
    // fallthrough
    case 1:
      d[2] += d[4];
      d[3] += d[5];
      sprite.x = d[2] >> 4;
      sprite.y = d[3] >> 4;
      if (sprite.x < -8 || sprite.x > 248 || sprite.y < -8 || sprite.y > 120) {
        gTasks[d[6]].data[d[7]]--;
        DestroySprite(sprite);
      }
      break;
  }
}

// AnimTask_WaterSpoutRain (Water Spout): droplets rain down on the target's side, splashing; the targets shake
// (AnimTask_HorizontalShake) once the first lands. data[9] counts live droplets and splashes.
const AnimTask_WaterSpoutRain: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1] = GetWaterSpoutPowerForAnim();
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    d[4] = 136;
    d[6] = 40;
  } else {
    d[4] = 16;
    d[6] = 80;
  }
  d[5] = 98;
  d[7] = d[4] + 49;
  d[12] = d[1] * 5 + 5;
  gTasks[taskId].func = AnimTask_WaterSpoutRain_Step;
};

/** Starts AnimTask_HorizontalShake (battle_anim_ground.c) the way the C does, if it's ported. */
function startHorizontalShake(): void {
  const shake = taskFuncByName('AnimTask_HorizontalShake');
  if (!shake) return;
  const taskId2 = CreateTask(shake, 80);
  if (taskId2 !== TASK_NONE) {
    gTasks[taskId2].func(taskId2);
    anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
  }
}

const AnimTask_WaterSpoutRain_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      if (++d[2] > 2) {
        d[2] = 0;
        CreateWaterSpoutRainDroplet(task, taskId);
      }
      if (d[10] !== 0 && d[13] === 0) {
        gBattleAnimArgs[0] = K.ANIM_TARGET;
        gBattleAnimArgs[1] = 0;
        gBattleAnimArgs[2] = 12;
        startHorizontalShake();
        gBattleAnimArgs[0] = K.ANIM_DEF_PARTNER;
        startHorizontalShake();
        d[13] = 1;
      }
      if (d[11] >= d[12]) d[0]++;
      break;
    case 1:
      if (d[9] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

function CreateWaterSpoutRainDroplet(task: Task, taskId: number): void {
  const d = task.data;
  const yPosArg = (((gSineTable(d[8]) + 3) >> 4) + d[6]) & 0xffff;
  const spriteId = CreateSprite(animSpriteTemplate('gSmallWaterOrbSpriteTemplate')!, d[7], 0, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.callback = AnimWaterSpoutRain;
    s.data[5] = yPosArg;
    s.data[6] = taskId;
    s.data[7] = 9;
    d[9]++;
  }
  d[11]++;
  d[8] = (d[8] + 39) & 0xff;
  // ISO_RANDOMIZE2(data[7]) % data[5], in signed int arithmetic like the C
  d[7] = ((Math.imul(RAND_MULT, d[7]) + 12345) | 0) % d[5] + d[4];
}

function AnimWaterSpoutRain(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    sprite.y += 8;
    if (sprite.y >= d[5]) {
      gTasks[d[6]].data[10] = 1;
      d[1] = CreateSprite(animSpriteTemplate('gWaterHitSplatSpriteTemplate', true)!, sprite.x, sprite.y, 1);
      if (d[1] !== MAX_SPRITES) {
        const splat = gSprites[d[1]];
        StartSpriteAffineAnim(splat, 3);
        splat.data[6] = d[6];
        splat.data[7] = d[7];
        splat.callback = AnimWaterSpoutRainHit;
      }
      DestroySprite(sprite);
    }
  }
}

function AnimWaterSpoutRainHit(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[1] > 1) {
    d[1] = 0;
    sprite.invisible = !sprite.invisible;
    if (++d[2] === 12) {
      gTasks[d[6]].data[d[7]]--;
      FreeOamMatrix(sprite.oam.matrixNum);
      DestroySprite(sprite);
    }
  }
}

// AnimTask_WaterSport (Water Sport): a stream of droplets arcing from the attacker, sweeping across the screen
// and back (three passes). data[8] counts live droplets; data[10] is set once the first lands.
const AnimTask_WaterSport: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[3] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[7] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? 1 : -1;
  d[5] = d[3] + d[7] * 8;
  d[6] = d[4] - d[7] * 8;
  d[9] = -32;
  d[1] = 0;
  d[0] = 0;
  gTasks[taskId].func = AnimTask_WaterSport_Step;
};

const AnimTask_WaterSport_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const offScreen = () => !(d[5] >= -16 && d[5] <= 256);
  switch (d[0]) {
    case 0:
      CreateWaterSportDroplet(task);
      if (d[10] !== 0) d[0]++;
      break;
    case 1:
      CreateWaterSportDroplet(task);
      if (++d[1] > 16) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      CreateWaterSportDroplet(task);
      d[5] += d[7] * 6;
      if (offScreen()) {
        if (++d[12] > 2) {
          d[13] = 1;
          d[0] = 6;
          d[1] = 0;
        } else {
          d[1] = 0;
          d[0]++;
        }
      }
      break;
    case 3:
      CreateWaterSportDroplet(task);
      d[6] -= d[7] * 2;
      if (++d[1] > 7) d[0]++;
      break;
    case 4:
      CreateWaterSportDroplet(task);
      d[5] -= d[7] * 6;
      if (offScreen()) {
        d[12]++;
        d[1] = 0;
        d[0]++;
      }
      break;
    case 5:
      CreateWaterSportDroplet(task);
      d[6] -= d[7] * 2;
      if (++d[1] > 7) d[0] = 2;
      break;
    case 6:
      if (d[8] === 0) d[0]++;
      break;
    default:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

function CreateWaterSportDroplet(task: Task): void {
  const d = task.data;
  if (++d[2] > 1) {
    d[2] = 0;
    const spriteId = CreateSprite(animSpriteTemplate('gSmallWaterOrbSpriteTemplate')!, d[3], d[4], 10);
    if (spriteId !== MAX_SPRITES) {
      const s = gSprites[spriteId];
      s.data[0] = 16;
      s.data[2] = d[5];
      s.data[4] = d[6];
      s.data[5] = d[9];
      InitAnimArcTranslation(s);
      s.callback = AnimWaterSportDroplet;
      d[8]++;
    }
  }
}

function AnimWaterSportDroplet(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    const d = sprite.data;
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    d[0] = 6;
    d[2] = (random() & 0x1f) - 16 + sprite.x;
    d[4] = (random() & 0x1f) - 16 + sprite.y;
    d[5] = ~(random() & 7);
    InitAnimArcTranslation(sprite);
    sprite.callback = AnimWaterSportDroplet_Step;
  }
}

function AnimWaterSportDroplet_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    for (let i = 0; i < NUM_TASKS; i++) {
      if (gTasks[i].func === AnimTask_WaterSport_Step) {
        gTasks[i].data[10] = 1;
        gTasks[i].data[8]--;
        DestroySprite(sprite);
      }
    }
  }
}

/** AnimWaterPulseBubble: a bubble rising and swaying. Args: x, y, rise speed (1/10 px), sway speed, sway amplitude, duration. */
const AnimWaterPulseBubble: SpriteCallback = (sprite) => {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = gBattleAnimArgs[1];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[4];
  d[3] = gBattleAnimArgs[5];
  sprite.callback = AnimWaterPulseBubble_Step;
};

function AnimWaterPulseBubble_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] -= d[0];
  sprite.y2 = Math.trunc(d[4] / 10);
  d[5] = (d[5] + d[1]) & 0xff;
  sprite.x2 = Sin(d[5], d[2]);
  if (--d[3] === 0) DestroyAnimSprite(sprite);
}

/** AnimWaterPulseRingBubble (made by CreateWaterPulseRingBubbles): drifts for data[0] frames, velocity data[1..2] in 1/128 px. */
function AnimWaterPulseRingBubble(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 = d[3] >> 7;
  sprite.y2 = d[4] >> 7;
  if (--d[0] === 0) {
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
  }
}

/** AnimWaterPulseRing (gWaterPulseRingSpriteTemplate, battle_anim_effects_2.c): a ring to the target, shedding bubbles. Args: x, y, duration, bubble interval. */
export function AnimWaterPulseRing(sprite: Sprite): void {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[3] = gBattleAnimArgs[2];
  d[4] = gBattleAnimArgs[3];
  sprite.callback = AnimWaterPulseRing_Step;
}

function AnimWaterPulseRing_Step(sprite: Sprite): void {
  const d = sprite.data;
  const xDiff = d[1] - sprite.x;
  const yDiff = d[2] - sprite.y;
  sprite.x2 = Math.trunc((d[0] * xDiff) / d[3]);
  sprite.y2 = Math.trunc((d[0] * yDiff) / d[3]);
  if (++d[5] === d[4]) {
    d[5] = 0;
    CreateWaterPulseRingBubbles(sprite, xDiff, yDiff);
  }
  if (d[3] === d[0]) DestroyAnimSprite(sprite);
  d[0]++;
}

/** CreateWaterPulseRingBubbles: one bubble above and one below the ring, drifting back towards the attacker. */
function CreateWaterPulseRingBubbles(sprite: Sprite, xDiff: number, yDiff: number): void {
  const half = Math.trunc(sprite.data[0] / 2);
  const x = (sprite.x + sprite.x2) << 16 >> 16;
  const y = (sprite.y + sprite.y2) << 16 >> 16;
  const randomY = (yDiff + (random() % 10) - 5) << 16 >> 16;
  const randomX = (-xDiff + (random() % 10) - 5) << 16 >> 16;
  const template = animSpriteTemplate('gWaterPulseRingBubbleSpriteTemplate')!;
  const subpriority = (GetBattlerSpriteSubpriority(anim.attacker) - 1) & 0xff;
  let spriteId = CreateSprite(template, x, y + half, 130);
  gSprites[spriteId].data[0] = 20;
  gSprites[spriteId].data[1] = randomY;
  gSprites[spriteId].subpriority = subpriority;
  gSprites[spriteId].data[2] = randomX < 0 ? -randomX : randomX;
  spriteId = CreateSprite(template, x, y - half, 130);
  gSprites[spriteId].data[0] = 20;
  gSprites[spriteId].data[1] = randomY;
  gSprites[spriteId].subpriority = subpriority;
  gSprites[spriteId].data[2] = randomX > 0 ? -randomX : randomX;
}

export const waterSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimWaterBubbleProjectile,
  AnimToTargetInSinWave,
  AnimWaterGunDroplet,
  AnimSmallBubblePair,
  AnimRainDrop,
  AnimAuroraBeamRings,
  AnimHydroCannonCharge,
  AnimHydroCannonBeam,
  AnimSmallDriftingBubbles,
  AnimSmallWaterOrb,
  AnimWaterPulseBubble,
  AnimWaterPulseRingBubble,
  AnimWaterPulseRing,
};

export const waterTasks: Record<string, TaskFunc> = {
  AnimTask_StartSinAnimTimer,
  AnimTask_CreateSurfWave,
  AnimTask_CreateRaindrops,
  AnimTask_RotateAuroraRingColors,
  AnimTask_WaterSpoutLaunch,
  AnimTask_WaterSpoutRain,
  AnimTask_WaterSport,
};

export function registerWaterExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_CreateSurfWave: ['gBattleAnimBgTilemap_SurfOpponent', 'gBattleAnimBgTilemap_SurfPlayer', 'gBattleAnimBgImage_Surf', 'gBattleAnimBgPalette_Surf', 'gBattleAnimBgPalette_MuddyWater'],
  });
}
