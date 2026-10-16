// battle_anim_effects_3.c, second half: from AnimTask_PainSplitMovement (C line 2914) to the end of the file.
// The first half is in effects3.ts; the file is split in two only so two workers could port it at once (the
// halves don't call each other). AnimRoarNoiseLine and AnimTask_MonToSubstitute are from this half but were
// ported earlier and live in effects3.ts.

import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT2_ALL,
  DISPCNT_OBJWIN_ON,
  GetGpuReg,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../../gba/hw';
import { BlendPalette, FillPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_32BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import {
  ChangeSpriteAffineAnim,
  CreateSprite,
  DestroySprite,
  DestroySpriteAndFreeResources,
  FreeOamMatrix,
  gSprites,
  MAX_SPRITES,
  ST_OAM_AFFINE_DOUBLE_MASK,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_OBJ_WINDOW,
  StartSpriteAffineAnim,
  StoreSpriteCallbackInData6,
  type AffineAnimCmd,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { bdata, g } from '../env';
import { AnimTranslateLinear, InitAnimArcTranslation, InitAnimLinearTranslation, TranslateAnimHorizontalArc } from '../gfx';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  BATTLE_PARTNER,
  CloneBattlerSpriteWithBlend,
  CreateAdditionalMonSpriteForMoveAnim,
  DestroyAnimSpriteAfterTimer,
  DestroyAnimVisualTaskAndDisableBlend,
  DestroySpriteAndMatrix,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  GetBattlerSpriteSubpriority,
  GetBattlerYCoordWithElevation,
  InitAndRunAnimFastLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsDoubleBattle,
  PrepareAffineAnimInTaskData,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunAffineAnimFromTaskData,
  SetBattlerSpriteYOffsetFromYScale,
  SetSpriteCoordsToAnimAttackerCoords,
  SetSpriteRotScale,
  TryResetSpriteAffineState,
  TrySetSpriteRotScale,
} from './animMons';
import { animSpriteTemplate, BattleAnimAdjustPanning, IsContest, PlaySE12WithPanning } from './battleAnim';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';
import { StartMonScrollingBgMask } from './utilityFuncs';

const UNIT = 'battle_anim_effects_3.c';
/** A static `union AffineAnimCmd[]` of this file (extracted to anims.json) */
const affineAnim = (name: string) => bdata.anims.units[UNIT].affineAnims[name] as AffineAnimCmd[];

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** The party mon in a battler's slot (gPlayerParty / gEnemyParty[gBattlerPartyIndexes[battler]]) */
const partyMon = (party: typeof g.playerParty, battler: number) => party[g.battlerPartyIndexes[battler]];

// ------------------------------------------------------------------ Pain Split

/** AnimTask_PainSplitMovement: squashes, stretches or tilts a battler and shakes it. Args: battler, which (0-2). */
const AnimTask_PainSplitMovement: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    d[11] = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
    const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
    d[10] = spriteId;
    PrepareBattlerSpriteForRotScale(spriteId, ST_OAM_OBJ_NORMAL);
    switch (gBattleAnimArgs[1]) {
      case 0:
        SetSpriteRotScale(spriteId, 0xe0, 0x140, 0);
        SetBattlerSpriteYOffsetFromYScale(spriteId);
        break;
      case 1:
        SetSpriteRotScale(spriteId, 0xd0, 0x130, 0xf00);
        SetBattlerSpriteYOffsetFromYScale(spriteId);
        if (IsContest() || getBattlerSide(d[11]) === K.B_SIDE_PLAYER) gSprites[spriteId].y2 += 16;
        break;
      case 2:
        SetSpriteRotScale(spriteId, 0xd0, 0x130, 0xf100);
        SetBattlerSpriteYOffsetFromYScale(spriteId);
        if (IsContest() || getBattlerSide(d[11]) === K.B_SIDE_PLAYER) gSprites[spriteId].y2 += 16;
        break;
    }
    gSprites[spriteId].x2 = 2;
    d[0]++;
  } else {
    const spriteId = d[10];
    if (++d[2] === 3) {
      d[2] = 0;
      gSprites[spriteId].x2 = -gSprites[spriteId].x2;
    }
    if (++d[1] === 13) {
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].x2 = 0;
      gSprites[spriteId].y2 = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
};

// ------------------------------------------------------------------ Flatter

/** AnimFlatterConfetti: a random piece of confetti flies up across the screen. Args: side it starts from. */
const AnimFlatterConfetti: SpriteCallback = (sprite) => {
  const tileOffset = random() % 12;
  sprite.oam.tileNum += tileOffset;
  const rand1 = random() & 0x1ff;
  const rand2 = random() & 0xff;
  sprite.data[0] = rand1 & 1 ? 0x5e0 + rand1 : 0x5e0 - rand1;
  sprite.data[1] = rand2 & 1 ? 0x480 + rand2 : 0x480 - rand2;
  sprite.data[2] = gBattleAnimArgs[0];
  sprite.x = sprite.data[2] === K.ANIM_ATTACKER ? -8 : 248;
  sprite.y = 104;
  sprite.callback = AnimFlatterConfetti_Step;
};

function AnimFlatterConfetti_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[2] === 0) {
    sprite.x2 += d[0] >> 8;
    sprite.y2 -= d[1] >> 8;
  } else {
    sprite.x2 -= d[0] >> 8;
    sprite.y2 -= d[1] >> 8;
  }
  d[0] -= 22;
  d[1] -= 48;
  if (d[0] < 0) d[0] = 0;
  if (++d[3] === 31) DestroyAnimSprite(sprite);
}

/**
 * AnimFlatterSpotlight: an OBJ-window spotlight over the target opens (affine anim 0), stays, and closes
 * (affine anim 1); outside it the screen is dimmed. Args: x, y, frames fully open.
 */
const AnimFlatterSpotlight: SpriteCallback = (sprite) => {
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WIN0H, g.battle_WIN0H);
  SetGpuReg(REG_OFFSET_WIN0V, g.battle_WIN0V);
  sprite.data[0] = gBattleAnimArgs[2];
  InitSpritePosToAnimTarget(sprite, false);
  sprite.oam.objMode = ST_OAM_OBJ_WINDOW;
  sprite.invisible = true;
  sprite.callback = AnimFlatterSpotlight_Step;
};

function AnimFlatterSpotlight_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[1]) {
    case 0:
      sprite.invisible = false;
      if (sprite.affineAnimEnded) d[1]++;
      break;
    case 1:
      if (--d[0] === 0) {
        ChangeSpriteAffineAnim(sprite, 1);
        d[1]++;
      }
      break;
    case 2:
      if (sprite.affineAnimEnded) {
        sprite.invisible = true;
        d[1]++;
      }
      break;
    case 3:
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR);
      SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) ^ DISPCNT_OBJWIN_ON);
      DestroyAnimSprite(sprite);
      break;
  }
}

// ------------------------------------------------------------------ Reversal

/** AnimReversalOrb: an orb circles the attacker on a growing, then shrinking, ellipse. Args: duration, start angle. */
const AnimReversalOrb: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.callback = AnimReversalOrb_Step;
  sprite.callback(sprite);
};

function AnimReversalOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[1], d[2] >> 8);
  sprite.y2 = Cos(d[1], d[3] >> 8);
  d[1] = (d[1] + 9) & 0xff;
  if ((d[1] & 0xffff) < 64 || d[1] > 195) sprite.subpriority = GetBattlerSpriteSubpriority(anim.attacker) - 1;
  else sprite.subpriority = GetBattlerSpriteSubpriority(anim.attacker) + 1;
  if (!d[5]) {
    d[2] += 0x400;
    d[3] += 0x100;
    d[4]++;
    if (d[4] === d[0]) {
      d[4] = 0;
      d[5] = 1;
    }
  } else if (d[5] === 1) {
    d[2] -= 0x400;
    d[3] -= 0x100;
    d[4]++;
    if (d[4] === d[0]) DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ Role Play

/**
 * AnimTask_RolePlaySilhouette: a white copy of the target's pic appears by the attacker (facing the same way as
 * the attacker), fades in, then stretches up and away.
 */
const AnimTask_RolePlaySilhouette: TaskFunc = (taskId) => {
  GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  // The target's mon, from the party on the target's side (the C reads the personality and OT id from the
  // party opposite the attacker, which is the same thing in battle).
  const party = isOpponent(anim.attacker) ? g.playerParty : g.enemyParty;
  const mon = partyMon(party, anim.target);
  const personality = mon?.personality ?? 0;
  const otId = mon?.otId ?? 0;
  const transformSpecies = g.battleSpritesDataPtr.battlerData[anim.target].transformSpecies;
  const species = transformSpecies === K.SPECIES_NONE ? (partyMon(isOpponent(anim.target) ? g.enemyParty : g.playerParty, anim.target)?.species ?? 0) : transformSpecies;
  const isBackPic = !isOpponent(anim.attacker);
  const xOffset = isBackPic ? -20 : 20;
  const priority = GetBattlerSpriteBGPriority(anim.attacker);
  const coord1 = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
  const coord2 = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
  const spriteId = CreateAdditionalMonSpriteForMoveAnim(species, isBackPic, 0, coord1 + xOffset, coord2, 5, personality, otId, anim.target, true);
  const s = gSprites[spriteId];
  s.oam.priority = priority;
  s.oam.objMode = ST_OAM_OBJ_BLEND;
  FillPalette(RGB_WHITE, OBJ_PLTT_ID(s.oam.paletteNum), PLTT_SIZE_4BPP);
  s.oam.priority = priority;
  const d = gTasks[taskId].data;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
  d[0] = spriteId;
  gTasks[taskId].func = AnimTask_RolePlaySilhouette_Step1;
};

const AnimTask_RolePlaySilhouette_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[10]++ > 1) {
    d[10] = 0;
    d[1]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
    if (d[1] === 10) {
      d[10] = 256;
      d[11] = 256;
      gTasks[taskId].func = AnimTask_RolePlaySilhouette_Step2;
    }
  }
};

const AnimTask_RolePlaySilhouette_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[0]];
  d[10] -= 16;
  d[11] += 128;
  s.oam.affineMode |= ST_OAM_AFFINE_DOUBLE_MASK;
  TrySetSpriteRotScale(s, true, d[10], d[11], 0);
  if (++d[12] === 9) {
    TryResetSpriteAffineState(s);
    DestroySpriteAndFreeResources(s); // DestroySpriteAndFreeResources_
    gTasks[taskId].func = DestroyAnimVisualTaskAndDisableBlend;
  }
};

// ------------------------------------------------------------------ Acid Armor

/**
 * AnimTask_AcidArmor: the battler's BG copy melts down in a wave (per-line BGnHOFS/VOFS by HBlank DMA) while
 * fading out, then fades back in. Args: battler.
 */
const AnimTask_AcidArmor: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 16;
  d[4] = 0;
  d[5] = battler;
  d[6] = 32;
  d[7] = 0;
  d[8] = 24;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) d[8] *= -1;
  d[13] = GetBattlerYCoordWithElevation(battler) - 34;
  if (d[13] < 0) d[13] = 0;
  d[14] = d[13] + 66;
  d[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  let dmaDest: number;
  let bgX: number;
  let bgY: number;
  if (GetBattlerSpriteBGPriorityRank(battler) === 1) {
    dmaDest = REG_OFFSET_BG1HOFS;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
    bgX = g.battle_BG1_X;
    bgY = g.battle_BG1_Y;
  } else {
    dmaDest = REG_OFFSET_BG2HOFS;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
    bgX = g.battle_BG2_X;
    bgY = g.battle_BG2_Y;
  }
  for (let y = 0, i = 0; y < 160; y++, i += 2) {
    gScanlineEffectRegBuffers[0][i] = bgX;
    gScanlineEffectRegBuffers[1][i] = bgX;
    gScanlineEffectRegBuffers[0][i + 1] = bgY;
    gScanlineEffectRegBuffers[1][i + 1] = bgY;
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_32BIT, initState: 1 });
  task.func = AnimTask_AcidArmor_Step;
};

const AnimTask_AcidArmor_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let bgX: number;
  let bgY: number;
  if (GetBattlerSpriteBGPriorityRank(d[5]) === 1) {
    bgX = g.battle_BG1_X;
    bgY = g.battle_BG1_Y;
  } else {
    bgX = g.battle_BG2_X;
    bgY = g.battle_BG2_Y;
  }
  switch (d[0]) {
    case 0: {
      const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
      let offset = d[14] * 2;
      let var1 = 0;
      let var2 = 0;
      let i = 0;
      d[1] = (d[1] + 2) & 0xff;
      let sineIndex = d[1];
      d[9] = Math.trunc(0x7e0 / d[6]);
      d[10] = -Math.trunc((d[7] * 2) / d[9]);
      d[11] = d[7];
      let var3 = d[11] >> 5;
      d[12] = var3;
      let var0 = d[14];
      while (var0 > d[13]) {
        buf[offset + 1] = i - var2 + bgY;
        buf[offset] = bgX + var3 + (gSineTable(sineIndex) >> 5);
        sineIndex = (sineIndex + 10) & 0xff;
        d[11] += d[10];
        var3 = d[11] >> 5;
        d[12] = var3;
        i++;
        offset -= 2;
        var1 = (var1 + d[6]) << 16 >> 16;
        var2 = var1 >> 5;
        var0--;
      }
      // the lines above the melted pic show nothing (scrolled a screen away)
      var0 *= 2;
      while (var0 >= 0) {
        gScanlineEffectRegBuffers[0][var0] = bgX + 240;
        gScanlineEffectRegBuffers[1][var0] = bgX + 240;
        var0 -= 2;
      }
      if (++d[6] > 63) {
        d[6] = 64;
        d[2]++;
        if (d[2] & 1) d[3]--;
        else d[4]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
        if (d[3] === 0 && d[4] === 16) {
          d[2] = 0;
          d[3] = 0;
          d[0]++;
        }
      } else {
        d[7] += d[8];
      }
      break;
    }
    case 1:
      if (++d[2] > 12) {
        gScanlineEffect.state = 3;
        d[2] = 0;
        d[0]++;
      }
      break;
    case 2:
      d[2]++;
      if (d[2] & 1) d[3]++;
      else d[4]--;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
      if (d[3] === 16 && d[4] === 0) {
        d[2] = 0;
        d[3] = 0;
        d[0]++;
      }
      break;
    case 3:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Yawn, Howl

/** AnimTask_DeepInhale: the battler swells (sDeepInhaleAffineAnimCmds), trembling for a while. Args: battler. */
const AnimTask_DeepInhale: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.data[0] = 0;
  task.data[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(task, task.data[15], affineAnim('sDeepInhaleAffineAnimCmds'));
  task.func = AnimTask_DeepInhale_Step;
};

const AnimTask_DeepInhale_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const var0 = (d[0] - 20) & 0xffff;
  d[0]++;
  if (var0 < 23) {
    if (++d[1] > 1) {
      d[1] = 0;
      d[2]++;
      gSprites[d[15]].x2 = d[2] & 1 ? 1 : -1;
    }
  } else {
    gSprites[d[15]].x2 = 0;
  }
  if (!RunAffineAnimFromTaskData(task)) DestroyAnimVisualTask(taskId);
};

/** InitYawnCloudPosition: 12.4 fixed-point steps from (startX, startY) to (destX, destY) */
function InitYawnCloudPosition(sprite: Sprite, startX: number, startY: number, destX: number, destY: number, duration: number): void {
  sprite.x = startX;
  sprite.y = startY;
  sprite.data[4] = startX << 4;
  sprite.data[5] = startY << 4;
  sprite.data[6] = Math.trunc(((destX - startX) << 4) / duration);
  sprite.data[7] = Math.trunc(((destY - startY) << 4) / duration);
}

function UpdateYawnCloudPosition(sprite: Sprite): void {
  sprite.data[4] += sprite.data[6];
  sprite.data[5] += sprite.data[7];
  sprite.x = sprite.data[4] >> 4;
  sprite.y = sprite.data[5] >> 4;
}

/** AnimYawnCloud: a cloud drifts on a wave from the attacker to where it was created (the target). Args: affine anim. */
const AnimYawnCloud: SpriteCallback = (sprite) => {
  const destX = sprite.x;
  const destY = sprite.y;
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[0]);
  InitYawnCloudPosition(sprite, sprite.x, sprite.y, destX, destY, 64);
  sprite.data[0] = 0;
  sprite.callback = AnimYawnCloud_Step;
};

function AnimYawnCloud_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0]++;
  const index = (d[0] * 8) & 0xff;
  UpdateYawnCloudPosition(sprite);
  sprite.y2 = Sin(index, 8);
  if (d[0] > 58) {
    if (++d[1] > 1) {
      d[1] = 0;
      d[2]++;
      sprite.invisible = !!(d[2] & 1);
      if (d[2] > 3) DestroySpriteAndMatrix(sprite);
    }
  }
}

// ------------------------------------------------------------------ Smoke Ball, Focus Band

/** AnimSmokeBallEscapeCloud: a cloud by the attacker for a while. Args: affine anim, x, y, duration. */
const AnimSmokeBallEscapeCloud: SpriteCallback = (sprite) => {
  sprite.data[0] = gBattleAnimArgs[3];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[0]);
  if (getBattlerSide(anim.target) !== K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  sprite.callback = DestroyAnimSpriteAfterTimer;
};

// AnimTask_SlideMonForFocusBand's data: [0] frames left, [1] wobble timer, [2]/[3] x/y speed (bit 15 = negative,
// 8.8 fixed point), [4]/[5] x/y wobble, [6] bit 15 = wobble, [7]/[8] x/y offset, [9]/[10] current wobble,
// [13] wobble period, [15] sprite.

/** The wobble both steps share: every data[13]+1 frames, toggle between no offset and +-data[4]/[5]. */
function slideMonForFocusBandWobble(d: Int16Array): void {
  if (d[6] & 0x8000 && --d[1] === -1) {
    if (d[9] === 0) {
      d[9] = d[4];
      d[4] = -d[4];
    } else {
      d[9] = 0;
    }
    if (d[10] === 0) {
      d[10] = d[5];
      d[5] = -d[5];
    } else {
      d[10] = 0;
    }
    d[1] = d[13];
  }
}

function slideMonForFocusBandPlace(d: Int16Array, var0: number, var1: number): void {
  const s = gSprites[d[15]];
  s.x2 = d[2] & 0x8000 ? d[9] - (var0 >> 8) : d[9] + (var0 >> 8);
  s.y2 = d[3] & 0x8000 ? d[10] - (var1 >> 8) : d[10] + (var1 >> 8);
}

/** AnimTask_SlideMonForFocusBand_Step2: holds the slid position (still wobbling) for 30 frames */
const AnimTask_SlideMonForFocusBand_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0]--;
  slideMonForFocusBandWobble(d);
  slideMonForFocusBandPlace(d, d[7] & 0xffff, d[8] & 0xffff);
  if (d[0] < 1) DestroyAnimVisualTask(taskId);
};

const AnimTask_SlideMonForFocusBand_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0]--;
  slideMonForFocusBandWobble(d);
  const var0 = ((d[2] & 0x7fff) + d[7]) & 0xffff;
  const var1 = ((d[3] & 0x7fff) + d[8]) & 0xffff;
  slideMonForFocusBandPlace(d, var0, var1);
  d[7] = var0;
  d[8] = var1;
  if (d[0] < 1) {
    d[0] = 30;
    d[13] = 0;
    gTasks[taskId].func = AnimTask_SlideMonForFocusBand_Step2;
  }
};

/**
 * AnimTask_SlideMonForFocusBand (General_FocusBand): slides the attacker, accelerating, optionally wobbling.
 * Args: duration, x speed, y speed, wobble?, x wobble, y wobble, wobble period.
 */
const AnimTask_SlideMonForFocusBand: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[15] = g.battlerSpriteIds[anim.attacker];
  d[14] = gBattleAnimArgs[0];
  d[0] = gBattleAnimArgs[0];
  d[13] = gBattleAnimArgs[6];
  if (gBattleAnimArgs[3]) d[6] = d[6] | -0x8000;
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    d[2] = gBattleAnimArgs[1];
    d[3] = gBattleAnimArgs[2];
  } else {
    d[2] = gBattleAnimArgs[1] & 0x8000 ? gBattleAnimArgs[1] & 0x7fff : gBattleAnimArgs[1] | -0x8000;
    d[3] = gBattleAnimArgs[2] & 0x8000 ? gBattleAnimArgs[2] & 0x7fff : gBattleAnimArgs[2] | -0x8000;
  }
  d[8] = 0;
  d[7] = 0;
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  gTasks[taskId].func = AnimTask_SlideMonForFocusBand_Step1;
};

// ------------------------------------------------------------------ Facade, Endeavor

// AnimTask_SquishAndSweatDroplets' data: [0] state, [1] timer, [2] droplets alive (IDX_ACTIVE_SPRITES),
// [3] squishes left, [4]/[5] battler x/y, [6] subpriority, [7]-[15] PrepareAffineAnimInTaskData ([15] sprite).
const SWEAT_ACTIVE_SPRITES = 2;

/** AnimTask_SquishAndSweatDroplets: the battler squishes, sweat flying off, a few times. Args: battler, squishes. */
const AnimTask_SquishAndSweatDroplets: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  if (!gBattleAnimArgs[1]) DestroyAnimVisualTask(taskId);
  d[0] = 0;
  d[1] = 0;
  d[SWEAT_ACTIVE_SPRITES] = 0;
  d[3] = gBattleAnimArgs[1];
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  d[4] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  d[5] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  d[6] = GetBattlerSpriteSubpriority(battler);
  d[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(task, d[15], affineAnim('sFacadeSquishAffineAnimCmds'));
  task.func = AnimTask_SquishAndSweatDroplets_Step;
};

const AnimTask_SquishAndSweatDroplets_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[1]++;
      if (d[1] === 6) CreateSweatDroplets(taskId, true);
      if (d[1] === 18) CreateSweatDroplets(taskId, false);
      if (!RunAffineAnimFromTaskData(task)) {
        if (--d[3] === 0) {
          d[0]++;
        } else {
          d[1] = 0;
          PrepareAffineAnimInTaskData(task, d[15], affineAnim('sFacadeSquishAffineAnimCmds'));
        }
      }
      break;
    case 1:
      // wait for the droplets to go
      if (d[SWEAT_ACTIVE_SPRITES] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** CreateSweatDroplets: two droplets fly off each side of the battler */
function CreateSweatDroplets(taskId: number, lowerDroplets: boolean): void {
  const d = gTasks[taskId].data;
  const xOffset = lowerDroplets ? 30 : 18;
  const yOffset = lowerDroplets ? 20 : -20;
  const xCoords = [d[4] - xOffset, d[4] - xOffset - 4, d[4] + xOffset, d[4] + xOffset + 4];
  const yCoords = [d[5] + yOffset, d[5] + yOffset + 6];
  for (let i = 0; i < 4; i++) {
    const spriteId = CreateSprite(animSpriteTemplate('gFacadeSweatDropSpriteTemplate')!, xCoords[i], yCoords[i & 1], d[6] - 5);
    if (spriteId !== MAX_SPRITES) {
      const sd = gSprites[spriteId].data;
      sd[0] = 0;
      sd[1] = i < 2 ? -2 : 2; // the first two go left, the others right
      sd[2] = -1;
      sd[3] = taskId;
      sd[4] = SWEAT_ACTIVE_SPRITES;
      d[SWEAT_ACTIVE_SPRITES]++;
    }
  }
}

/** AnimFacadeSweatDrop: data [0] timer, [1]/[2] velocity, [3] task, [4] the task's live-sprite counter slot */
const AnimFacadeSweatDrop: SpriteCallback = (sprite) => {
  const d = sprite.data;
  sprite.x += d[1];
  sprite.y += d[2];
  if (++d[0] > 6) {
    gTasks[d[3]].data[d[4]]--;
    DestroySprite(sprite);
  }
};

/** sFacadeBlendColors: yellow to purple to red to yellow */
const sFacadeBlendColors = [
  RGB(28, 25, 1), RGB(28, 21, 5), RGB(27, 18, 8), RGB(27, 14, 11), RGB(26, 10, 15), RGB(26, 7, 18),
  RGB(25, 3, 21), RGB(25, 0, 25), RGB(25, 0, 23), RGB(25, 0, 20), RGB(25, 0, 16), RGB(25, 0, 13),
  RGB(26, 0, 10), RGB(26, 0, 6), RGB(26, 0, 3), RGB(27, 0, 0), RGB(27, 1, 0), RGB(27, 5, 0),
  RGB(27, 9, 0), RGB(27, 12, 0), RGB(28, 16, 0), RGB(28, 19, 0), RGB(28, 23, 0), RGB(29, 27, 0),
];

/** AnimTask_FacadeColorBlend: tints the battler through sFacadeBlendColors. Args: battler, duration. */
const AnimTask_FacadeColorBlend: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = 0;
  d[1] = gBattleAnimArgs[1];
  const spriteId = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  d[2] = OBJ_PLTT_ID(gSprites[spriteId].oam.paletteNum);
  gTasks[taskId].func = AnimTask_FacadeColorBlend_Step;
};

const AnimTask_FacadeColorBlend_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[1]) {
    BlendPalette(d[2], 16, 8, sFacadeBlendColors[d[0]]);
    if (++d[0] > 23) d[0] = 0;
    d[1]--;
  } else {
    BlendPalette(d[2], 16, 0, RGB_BLACK);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_StatusClearedEffect (Refresh, Aromatherapy): bubbles scroll over the attacker. Args: include partner. */
const AnimTask_StatusClearedEffect: TaskFunc = (taskId) => {
  StartMonScrollingBgMask(taskId, 0x1a0, anim.attacker, !!gBattleAnimArgs[0], 10, 2, 30, 'gCureBubblesGfx', 'gCureBubblesTilemap', 'gCureBubblesPal');
};

// ------------------------------------------------------------------ Glare

// AnimTask_GlareEyeDots' data: [0] state, [1] timer, [2] pair number, [5] pairs, [6] dot offset, [7] contest,
// [10] dots alive (IDX_ACTIVE_SPRITES), [11]-[14] start and end x/y.
const GLARE_ACTIVE_SPRITES = 10;

/** AnimTask_GlareEyeDots: pairs of dots trail from the attacker's eyes to the target. */
const AnimTask_GlareEyeDots: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[5] = 12;
  d[6] = 3;
  d[7] = 0;
  const quarterHeight = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_HEIGHT) / 4);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) d[11] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + quarterHeight;
  else d[11] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) - quarterHeight;
  d[12] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) - quarterHeight;
  d[13] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[14] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  gTasks[taskId].func = AnimTask_GlareEyeDots_Step;
};

const AnimTask_GlareEyeDots_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      // wait to create the next pair
      if (++d[1] > 3) {
        d[1] = 0;
        const [x, y] = GetGlareEyeDotCoords(d[11], d[12], d[13], d[14], d[5], d[2]);
        for (let i = 0; i < 2; i++) {
          const spriteId = CreateSprite(animSpriteTemplate('gGlareEyeDotSpriteTemplate')!, x, y, 35);
          if (spriteId !== MAX_SPRITES) {
            const s = gSprites[spriteId];
            if (!d[7]) {
              s.x2 = s.y2 = i === 0 ? -d[6] : d[6];
            } else {
              s.x2 = i === 0 ? -d[6] : d[6];
              s.y2 = i === 0 ? d[6] : -d[6];
            }
            s.data[0] = 0;
            s.data[1] = taskId;
            s.data[2] = GLARE_ACTIVE_SPRITES;
            d[GLARE_ACTIVE_SPRITES]++;
          }
        }
        if (d[2] === d[5]) d[0]++;
        d[2]++;
      }
      break;
    case 1:
      // wait for the dots to go
      if (d[GLARE_ACTIVE_SPRITES] === 0) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** GetGlareEyeDotCoords: pair `pairNum` of `pairMax`, evenly along the line (8.8 fixed point) */
function GetGlareEyeDotCoords(startX: number, startY: number, endX: number, endY: number, pairMax: number, pairNum: number): [number, number] {
  pairMax &= 0xff;
  pairNum &= 0xff;
  if (pairNum === 0) return [startX, startY];
  if (pairNum >= pairMax) return [endX, endY];
  pairMax--;
  const x2 = (startX << 8) + pairNum * Math.trunc(((endX - startX) << 8) / pairMax);
  const y2 = (startY << 8) + pairNum * Math.trunc(((endY - startY) << 8) / pairMax);
  return [(x2 >> 8) << 16 >> 16, (y2 >> 8) << 16 >> 16];
}

/** AnimGlareEyeDot: data [0] timer, [1] task, [2] the task's live-sprite counter slot */
const AnimGlareEyeDot: SpriteCallback = (sprite) => {
  if (++sprite.data[0] > 36) {
    gTasks[sprite.data[1]].data[sprite.data[2]]--;
    DestroySprite(sprite);
  }
};

// ------------------------------------------------------------------ Assist, Barrage

/** AnimAssistPawprint: a pawprint moves in a straight line. Args: x, y, dest x, dest y, duration. */
const AnimAssistPawprint: SpriteCallback = (sprite) => {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[2];
  sprite.data[4] = gBattleAnimArgs[3];
  sprite.data[0] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = InitAndRunAnimFastLinearTranslation;
};

/** AnimTask_BarrageBall: a ball arcs to the target (half speed at first), spinning, then flickers out. */
const AnimTask_BarrageBall: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[11] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[12] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[13] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[14] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + Math.trunc(GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_HEIGHT) / 4);
  d[15] = CreateSprite(animSpriteTemplate('gBarrageBallSpriteTemplate')!, d[11], d[12], GetBattlerSpriteSubpriority(anim.target) - 5);
  if (d[15] !== MAX_SPRITES) {
    const s = gSprites[d[15]];
    s.data[0] = 16;
    s.data[2] = d[13];
    s.data[4] = d[14];
    s.data[5] = -32;
    InitAnimArcTranslation(s);
    if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) StartSpriteAffineAnim(s, 1);
    task.func = AnimTask_BarrageBall_Step;
  } else {
    DestroyAnimVisualTask(taskId);
  }
};

const AnimTask_BarrageBall_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[15]];
  switch (d[0]) {
    case 0:
      if (++d[1] > 1) {
        d[1] = 0;
        TranslateAnimHorizontalArc(s);
        if (++d[2] > 7) d[0]++;
      }
      break;
    case 1:
      if (TranslateAnimHorizontalArc(s)) {
        d[1] = 0;
        d[2] = 0;
        d[0]++;
      }
      break;
    case 2:
      if (++d[1] > 1) {
        d[1] = 0;
        d[2]++;
        s.invisible = !!(d[2] & 1);
        if (d[2] === 16) {
          FreeOamMatrix(s.oam.matrixNum);
          DestroySprite(s);
          d[0]++;
        }
      }
      break;
    case 3:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Smelling Salt

/** AnimSmellingSaltsHand: a hand by the battler pokes it a few times. Args: battler, side (0 = left, flipped), pokes. */
const AnimSmellingSaltsHand: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  sprite.oam.tileNum += 16;
  sprite.data[6] = gBattleAnimArgs[2];
  sprite.data[7] = gBattleAnimArgs[1] === 0 ? -1 : 1;
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (gBattleAnimArgs[1] === 0) {
    sprite.oam.matrixNum |= ST_OAM_HFLIP;
    sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_LEFT) - 8;
  } else {
    sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_RIGHT) + 8;
  }
  sprite.callback = AnimSmellingSaltsHand_Step;
};

function AnimSmellingSaltsHand_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 1) {
        d[1] = 0;
        sprite.x2 += d[7];
        if (++d[2] === 12) d[0]++;
      }
      break;
    case 1:
      if (++d[1] === 8) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      sprite.x2 -= d[7] * 4;
      if (++d[1] === 6) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 3:
      sprite.x2 += d[7] * 3;
      if (++d[1] === 8) {
        if (--d[6]) {
          d[1] = 0;
          d[0]--;
        } else {
          DestroyAnimSprite(sprite);
        }
      }
      break;
  }
}

/** AnimTask_SmellingSaltsSquish: the target squishes sideways, shaking, a few times. Args: battler, squishes. */
const AnimTask_SmellingSaltsSquish: TaskFunc = (taskId) => {
  if (gBattleAnimArgs[0] === K.ANIM_ATTACKER) {
    DestroyAnimVisualTask(taskId);
  } else {
    const task = gTasks[taskId];
    task.data[0] = gBattleAnimArgs[1];
    task.data[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
    PrepareAffineAnimInTaskData(task, task.data[15], affineAnim('sSmellingSaltsSquishAffineAnimCmds'));
    task.func = AnimTask_SmellingSaltsSquish_Step;
  }
};

const AnimTask_SmellingSaltsSquish_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  if (++d[1] > 1) {
    d[1] = 0;
    gSprites[d[15]].x2 = !(d[2] & 1) ? 2 : -2;
  }
  if (!RunAffineAnimFromTaskData(task)) {
    gSprites[d[15]].x2 = 0;
    if (--d[0]) {
      PrepareAffineAnimInTaskData(task, d[15], affineAnim('sSmellingSaltsSquishAffineAnimCmds'));
      d[1] = 0;
      d[2] = 0;
    } else {
      DestroyAnimVisualTask(taskId);
    }
  }
};

/** AnimSmellingSaltExclamation: an exclamation mark blinks over the battler. Args: battler, blink delay, blinks. */
const AnimSmellingSaltExclamation: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP);
  if (sprite.y < 8) sprite.y = 8;
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = 0;
  sprite.data[3] = gBattleAnimArgs[2];
  sprite.callback = AnimSmellingSaltExclamation_Step;
};

function AnimSmellingSaltExclamation_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] >= d[1]) {
    d[0] = 0;
    d[2] = (d[2] + 1) & 1;
    sprite.invisible = !!d[2];
    if (d[2] && --d[3] === 0) DestroyAnimSprite(sprite);
  }
}

// ------------------------------------------------------------------ Helping Hand

/** AnimHelpingHandClap: a hand rises, claps against the other, and slides away. Args: which hand (0 = left). */
const AnimHelpingHandClap: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[0] === 0) {
    sprite.oam.matrixNum |= ST_OAM_HFLIP;
    sprite.x = 100;
    sprite.data[7] = 1;
  } else {
    sprite.x = 140;
    sprite.data[7] = -1;
  }
  sprite.y = 56;
  sprite.callback = AnimHelpingHandClap_Step;
};

function AnimHelpingHandClap_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.y -= d[7] * 2;
      if (d[1] & 1) sprite.x -= d[7] * 2;
      if (++d[1] === 9) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 1:
      if (++d[1] === 4) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      d[1]++;
      sprite.y += d[7] * 3;
      sprite.x2 = d[7] * (gSineTable(d[1] * 10) >> 3);
      if (d[1] === 12) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 3:
      if (++d[1] === 2) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 4:
      d[1]++;
      sprite.y -= d[7] * 3;
      sprite.x2 = d[7] * (gSineTable(d[1] * 10) >> 3);
      if (d[1] === 12) d[0]++;
      break;
    case 5:
      d[1]++;
      sprite.y += d[7] * 3;
      sprite.x2 = d[7] * (gSineTable(d[1] * 10) >> 3);
      if (d[1] === 15) sprite.oam.tileNum += 16;
      if (d[1] === 18) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 6:
      sprite.x += d[7] * 6;
      if (++d[1] === 9) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 7:
      sprite.x += d[7] * 2;
      if (++d[1] === 1) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 8:
      sprite.x -= d[7] * 3;
      if (++d[1] === 5) DestroyAnimSprite(sprite);
      break;
  }
}

/** AnimTask_HelpingHandAttackerMovement: the attacker lunges towards its partner (or the middle) a few times. */
const AnimTask_HelpingHandAttackerMovement: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[15] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  if (IsDoubleBattle()) {
    const attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
    const partnerX = GetBattlerSpriteCoord(BATTLE_PARTNER(anim.attacker), K.BATTLER_COORD_X);
    d[14] = attackerX > partnerX ? 1 : -1;
  } else {
    d[14] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? -1 : 1;
  }
  gTasks[taskId].func = AnimTask_HelpingHandAttackerMovement_Step;
};

const AnimTask_HelpingHandAttackerMovement_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[15]];
  switch (d[0]) {
    case 0:
      if (++d[1] === 13) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 1:
      s.x2 -= d[14] * 3;
      if (++d[1] === 6) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      s.x2 += d[14] * 3;
      if (++d[1] === 6) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 3:
      if (++d[1] === 2) {
        d[1] = 0;
        if (d[2] === 0) {
          d[2]++;
          d[0] = 1;
        } else {
          d[0]++;
        }
      }
      break;
    case 4:
      s.x2 += d[14];
      if (++d[1] === 3) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 5:
      if (++d[1] === 6) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 6:
      s.x2 -= d[14] * 4;
      if (++d[1] === 5) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 7:
      s.x2 += d[14] * 4;
      if (++d[1] === 5) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 8:
      s.x2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Foresight

/** AnimForesightMagnifyingGlass: a magnifying glass moves corner to corner over the battler, then fades. Args: battler. */
const AnimForesightMagnifyingGlass: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[0] === K.ANIM_ATTACKER) {
    InitSpritePosToAnimAttacker(sprite, true);
    sprite.data[7] = anim.attacker;
  } else {
    sprite.data[7] = anim.target;
  }
  if (getBattlerSide(sprite.data[7]) === K.B_SIDE_OPPONENT) sprite.oam.matrixNum = ST_OAM_HFLIP;
  sprite.oam.priority = GetBattlerSpriteBGPriority(sprite.data[7]);
  sprite.oam.objMode = ST_OAM_OBJ_BLEND;
  sprite.callback = AnimForesightMagnifyingGlass_Step;
};

function AnimForesightMagnifyingGlass_Step(sprite: Sprite): void {
  const d = sprite.data;
  const b = d[7];
  const attr = (a: number) => GetBattlerSpriteCoordAttr(b, a);
  switch (d[5]) {
    case 0: {
      let x: number;
      let y: number;
      if (d[6] < 0 || d[6] > 5) d[6] = 0; // default: falls into case 0
      switch (d[6]) {
        case 1:
          x = attr(K.BATTLER_COORD_ATTR_RIGHT) - 4;
          y = attr(K.BATTLER_COORD_ATTR_TOP) + 4;
          break;
        case 2:
          x = attr(K.BATTLER_COORD_ATTR_LEFT) + 4;
          y = attr(K.BATTLER_COORD_ATTR_BOTTOM) - 4;
          break;
        case 3:
          x = attr(K.BATTLER_COORD_ATTR_LEFT) + 4;
          y = attr(K.BATTLER_COORD_ATTR_TOP) - 4;
          break;
        case 5:
          x = GetBattlerSpriteCoord(b, K.BATTLER_COORD_X_2);
          y = GetBattlerSpriteCoord(b, K.BATTLER_COORD_Y_PIC_OFFSET);
          break;
        default: // 0, 4
          x = attr(K.BATTLER_COORD_ATTR_RIGHT) - 4;
          y = attr(K.BATTLER_COORD_ATTR_BOTTOM) - 4;
          break;
      }
      if (d[6] === 4) d[0] = 24;
      else if (d[6] === 5) d[0] = 6;
      else d[0] = 12;
      d[1] = sprite.x;
      d[2] = x;
      d[3] = sprite.y;
      d[4] = y;
      InitAnimLinearTranslation(sprite);
      d[5]++;
      break;
    }
    case 1:
      if (AnimTranslateLinear(sprite)) {
        switch (d[6]) {
          default:
            sprite.x += sprite.x2;
            sprite.y += sprite.y2;
            sprite.y2 = 0;
            sprite.x2 = 0;
            d[0] = 0;
            d[5]++;
            d[6]++;
            break;
          case 4:
            sprite.x += sprite.x2;
            sprite.y += sprite.y2;
            sprite.y2 = 0;
            sprite.x2 = 0;
            d[5] = 0;
            d[6]++;
            break;
          case 5:
            d[0] = 0;
            d[1] = 16;
            d[2] = 0;
            d[5] = 3;
            break;
        }
      }
      break;
    case 2:
      if (++d[0] === 4) d[5] = 0;
      break;
    case 3:
      if (!(d[0] & 1)) d[1]--;
      else d[2]++;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], d[2]));
      if (++d[0] === 32) {
        sprite.invisible = true;
        d[5]++;
      }
      break;
    case 4:
      DestroyAnimSprite(sprite);
      break;
  }
}

// ------------------------------------------------------------------ Meteor Mash

function AnimMeteorMashStar_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Math.trunc(((d[2] - d[0]) * d[5]) / d[4]);
  sprite.y2 = Math.trunc(((d[3] - d[1]) * d[5]) / d[4]);
  if (!(d[5] & 1)) {
    // gMiniTwinklingStarSpriteTemplate's callback (AnimMiniTwinklingStar) is in the first half of the file
    // (effects3.ts); until it's registered the trail is left out.
    const template = animSpriteTemplate('gMiniTwinklingStarSpriteTemplate');
    if (template) CreateSprite(template, sprite.x + sprite.x2, sprite.y + sprite.y2, 5);
  }
  if (d[5] === d[4]) DestroyAnimSprite(sprite);
  d[5]++;
}

/** AnimMeteorMashStar: a shooting star crosses the target, leaving twinkling stars. Args: x, y, dest x, dest y, duration. */
const AnimMeteorMashStar: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    d[0] = sprite.x - gBattleAnimArgs[0];
    d[2] = sprite.x - gBattleAnimArgs[2];
  } else {
    d[0] = sprite.x + gBattleAnimArgs[0];
    d[2] = sprite.x + gBattleAnimArgs[2];
  }
  d[1] = sprite.y + gBattleAnimArgs[1];
  d[3] = sprite.y + gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  sprite.x = d[0];
  sprite.y = d[1];
  sprite.callback = AnimMeteorMashStar_Step;
};

// ------------------------------------------------------------------ Block

/** AnimBlockX: an X drops onto the target, bounces twice, and flickers away. */
const AnimBlockX: SpriteCallback = (sprite) => {
  let y: number;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    sprite.subpriority = GetBattlerSpriteSubpriority(anim.target) - 2;
    y = -144;
  } else {
    sprite.subpriority = GetBattlerSpriteSubpriority(anim.target) + 2;
    y = -96;
  }
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.y2 = y;
  sprite.callback = AnimBlockX_Step;
};

function AnimBlockX_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.y2 += 10;
      if (sprite.y2 >= 0) {
        PlaySE12WithPanning(K.SE_M_SKETCH, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
        sprite.y2 = 0;
        d[0]++;
      }
      break;
    case 1:
      d[1] += 4;
      sprite.y2 = -(gSineTable(d[1]) >> 3);
      if (d[1] > 0x7f) {
        PlaySE12WithPanning(K.SE_M_SKETCH, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
        d[1] = 0;
        sprite.y2 = 0;
        d[0]++;
      }
      break;
    case 2:
      d[1] += 6;
      sprite.y2 = -(gSineTable(d[1]) >> 4);
      if (d[1] > 0x7f) {
        d[1] = 0;
        sprite.y2 = 0;
        d[0]++;
      }
      break;
    case 3:
      if (++d[1] > 8) {
        PlaySE12WithPanning(K.SE_M_LEER, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
        d[1] = 0;
        d[0]++;
      }
      break;
    case 4:
      if (++d[1] > 8) {
        d[1] = 0;
        d[2]++;
        sprite.invisible = !!(d[2] & 1);
        if (d[2] === 7) DestroyAnimSprite(sprite);
      }
      break;
  }
}

// ------------------------------------------------------------------ Odor Sleuth

/** AnimTask_OdorSleuthMovement: two flickering copies of the target sway either side of it and close in. */
const AnimTask_OdorSleuthMovement: TaskFunc = (taskId) => {
  const spriteId1 = CloneBattlerSpriteWithBlend(K.ANIM_TARGET);
  if (spriteId1 < 0) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const spriteId2 = CloneBattlerSpriteWithBlend(K.ANIM_TARGET);
  if (spriteId2 < 0) {
    DestroySpriteWithActiveSheet(gSprites[spriteId1]);
    DestroyAnimVisualTask(taskId);
    return;
  }
  const s1 = gSprites[spriteId1];
  const s2 = gSprites[spriteId2];
  s2.x2 += 24;
  s1.x2 -= 24;
  s2.data[0] = 0;
  s1.data[0] = 0;
  s2.data[1] = 0;
  s1.data[1] = 0;
  s2.data[2] = 0;
  s1.data[2] = 0;
  s2.data[3] = 16;
  s1.data[3] = -16;
  s2.data[4] = 0;
  s1.data[4] = 128;
  s2.data[5] = 24;
  s1.data[5] = 24;
  s2.data[6] = taskId;
  s1.data[6] = taskId;
  s2.data[7] = 0;
  s1.data[7] = 0;
  gTasks[taskId].data[0] = 2;
  if (!g.battleSpritesDataPtr.battlerData[anim.target].invisible) {
    s2.invisible = false;
    s1.invisible = true;
  } else {
    s2.invisible = true;
    s1.invisible = true;
  }
  s2.oam.objMode = ST_OAM_OBJ_NORMAL;
  s1.oam.objMode = ST_OAM_OBJ_NORMAL;
  s2.callback = MoveOdorSleuthClone;
  s1.callback = MoveOdorSleuthClone;
  gTasks[taskId].func = AnimTask_OdorSleuthMovementWaitFinish;
};

const AnimTask_OdorSleuthMovementWaitFinish: TaskFunc = (taskId) => {
  if (gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
};

/** MoveOdorSleuthClone: data [3] angle speed, [4] angle, [5] radius, [6] task, [7] its live-clone counter slot */
function MoveOdorSleuthClone(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[1] > 1) {
    d[1] = 0;
    if (!g.battleSpritesDataPtr.battlerData[anim.target].invisible) sprite.invisible = !sprite.invisible;
  }
  d[4] = (d[4] + d[3]) & 0xff;
  sprite.x2 = Cos(d[4], d[5]);
  switch (d[0]) {
    case 0:
      if (++d[2] === 60) {
        d[2] = 0;
        d[0]++;
      }
      break;
    case 1:
      if (++d[2] > 0) {
        d[2] = 0;
        d[5] -= 2;
        if (d[5] < 0) {
          gTasks[d[6]].data[d[7]]--;
          DestroySpriteWithActiveSheet(sprite);
        }
      }
      break;
  }
}

// ------------------------------------------------------------------ Return

/** AnimTask_GetReturnPowerLevel: 0-3 by the attacker's friendship, in gBattleAnimArgs[ARG_RET_ID] */
const AnimTask_GetReturnPowerLevel: TaskFunc = (taskId) => {
  const friendship = anim.friendship;
  gBattleAnimArgs[ARG_RET_ID] = 0;
  if (friendship < 60) gBattleAnimArgs[ARG_RET_ID] = 0;
  if (friendship > 60 && friendship < 92) gBattleAnimArgs[ARG_RET_ID] = 1;
  if (friendship > 91 && friendship < 201) gBattleAnimArgs[ARG_RET_ID] = 2;
  if (friendship > 200) gBattleAnimArgs[ARG_RET_ID] = 3;
  DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ Snatch

/**
 * AnimTask_SnatchOpposingMonMove (General_SnatchMove): the attacker runs off screen, a copy of it runs past the
 * target (setting gBattleAnimArgs[7] to -1 as it passes), and the attacker runs back in from the other side.
 */
const AnimTask_SnatchOpposingMonMove: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const playerSide = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER;
  switch (d[0]) {
    case 0: {
      const s = gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)];
      d[1] += 0x800;
      if (playerSide) s.x2 += d[1] >> 8;
      else s.x2 -= d[1] >> 8;
      d[1] &= 0xff;
      const x = s.x + s.x2;
      if (x < -32 || x > K.DISPLAY_WIDTH + 32) {
        d[1] = 0;
        d[0]++;
      }
      break;
    }
    case 1: {
      const party = playerSide ? g.playerParty : g.enemyParty;
      const mon = partyMon(party, anim.attacker);
      const personality = mon?.personality ?? 0;
      const otId = mon?.otId ?? 0;
      const transformSpecies = g.battleSpritesDataPtr.battlerData[anim.attacker].transformSpecies;
      const species = transformSpecies === K.SPECIES_NONE ? (mon?.species ?? 0) : transformSpecies;
      const targetSubpriority = gSprites[GetAnimBattlerSpriteId(K.ANIM_TARGET)].subpriority;
      const subpriority = (playerSide ? targetSubpriority + 1 : targetSubpriority - 1) & 0xff;
      const isBackPic = !playerSide;
      const x = playerSide ? K.DISPLAY_WIDTH + 32 : -32;
      const spriteId2 = CreateAdditionalMonSpriteForMoveAnim(species, isBackPic, 0, x, GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y), subpriority, personality, otId, anim.attacker, false);
      if (transformSpecies !== K.SPECIES_NONE) BlendPalette(OBJ_PLTT_ID(gSprites[spriteId2].oam.paletteNum), 16, 6, RGB_WHITE);
      d[15] = spriteId2;
      d[0]++;
      break;
    }
    case 2: {
      const s2 = gSprites[d[15]];
      d[1] += 0x800;
      if (playerSide) s2.x2 -= d[1] >> 8;
      else s2.x2 += d[1] >> 8;
      d[1] &= 0xff;
      const x = s2.x + s2.x2;
      if (d[14] === 0) {
        const targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
        if (playerSide ? x < targetX : x > targetX) {
          d[14]++;
          gBattleAnimArgs[7] = -1; // 0xFFFF
        }
      }
      if (x < -32 || x > K.DISPLAY_WIDTH + 32) {
        d[1] = 0;
        d[0]++;
      }
      break;
    }
    case 3: {
      const s = gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)];
      DestroySpriteAndFreeResources(gSprites[d[15]]); // DestroySpriteAndFreeResources_
      if (playerSide) s.x2 = -s.x - 32;
      else s.x2 = K.DISPLAY_WIDTH + 32 - s.x;
      d[0]++;
      break;
    }
    case 4: {
      const s = gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)];
      d[1] += 0x800;
      if (playerSide) {
        s.x2 += d[1] >> 8;
        if (s.x2 + s.x >= GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X)) s.x2 = 0;
      } else {
        s.x2 -= d[1] >> 8;
        if (s.x2 + s.x <= GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X)) s.x2 = 0;
      }
      d[1] &= 0xff;
      if (s.x2 === 0) DestroyAnimVisualTask(taskId);
      break;
    }
  }
};

/**
 * AnimUnusedItemBagSteal (gUnusedItemBagStealSpriteTemplate, no script uses it): hidden until
 * gBattleAnimArgs[7] is -1, then bounces away from the target.
 */
const AnimUnusedItemBagSteal: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[7]) {
    case 0:
      if (gBattleAnimArgs[7] === -1) {
        PlaySE12WithPanning(K.SE_M_VITAL_THROW, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
        sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 16;
        d[0] = -32;
        d[7]++;
        sprite.invisible = false;
        if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) sprite.subpriority = gSprites[GetAnimBattlerSpriteId(K.ANIM_TARGET)].subpriority - 1;
      } else {
        sprite.invisible = true;
      }
      break;
    case 1:
      sprite.y2 = Sin(d[1], d[0]);
      d[1] += 5;
      if (d[1] > 0x7f) {
        d[0] = Math.trunc(d[0] / 2);
        d[3]++;
        d[1] -= 0x7f;
      }
      d[2] += 0x100;
      if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) sprite.x2 -= d[2] >> 8;
      else sprite.x2 += d[2] >> 8;
      d[2] &= 0xff;
      if (d[3] === 2) DestroyAnimSprite(sprite);
      break;
  }
};

/** AnimTask_SnatchPartnerMove (General_SnatchMove in doubles): the attacker dashes to its partner and back. */
const AnimTask_SnatchPartnerMove: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[15]) {
    case 0: {
      const attackerX = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
      const targetX = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
      d[0] = 6;
      if (attackerX > targetX) d[0] *= -1;
      d[1] = attackerX;
      d[2] = targetX;
      d[15]++;
      break;
    }
    case 1: {
      const s = gSprites[g.battlerSpriteIds[anim.attacker]];
      s.x2 += d[0];
      if (d[0] > 0 ? s.x + s.x2 >= d[2] : s.x + s.x2 <= d[2]) d[15]++;
      break;
    }
    case 2:
      d[0] *= -1;
      d[15]++;
      break;
    case 3: {
      const s = gSprites[g.battlerSpriteIds[anim.attacker]];
      s.x2 += d[0];
      if (d[0] < 0 ? s.x + s.x2 <= d[1] : s.x + s.x2 >= d[1]) d[15]++;
      break;
    }
    default:
      gSprites[g.battlerSpriteIds[anim.attacker]].x2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Teeter Dance

/** AnimTask_TeeterDanceMovement: the attacker sways side to side, wobbling. */
const AnimTask_TeeterDanceMovement: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[3] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[4] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? 1 : -1;
  d[6] = gSprites[d[3]].y;
  d[5] = gSprites[d[3]].x;
  d[9] = 0;
  d[11] = 0;
  d[10] = 1;
  d[12] = 0;
  gTasks[taskId].func = AnimTask_TeeterDanceMovement_Step;
};

const AnimTask_TeeterDanceMovement_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const s = gSprites[d[3]];
  switch (d[0]) {
    case 0:
      d[11] = (d[11] + 8) & 0xff;
      s.x2 = gSineTable(d[11]) >> 5;
      d[9] = (d[9] + 2) & 0xff;
      s.x = (gSineTable(d[9]) >> 3) * d[4] + d[5];
      if (d[9] === 0) {
        s.x = d[5];
        d[0]++;
      }
      break;
    case 1:
      d[11] = (d[11] + 8) & 0xff;
      s.x2 = gSineTable(d[11]) >> 5;
      if (d[11] === 0) {
        s.x2 = 0;
        d[0]++;
      }
      break;
    case 2:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ Knock Off

function AnimKnockOffStrike_Step(sprite: Sprite): void {
  const d = sprite.data;
  // the C has the same code for both sides
  d[1] = (d[1] + d[0]) & 0xff;
  sprite.x2 = Cos(d[1], 20);
  sprite.y2 = Sin(d[1], 20);
  if (sprite.animEnded) DestroyAnimSprite(sprite);
  d[2]++;
}

/** AnimKnockOffStrike: a strike swipes down across the target in an arc. Args: x, y. */
const AnimKnockOffStrike: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[0] = -11;
    sprite.data[1] = 192;
    StartSpriteAffineAnim(sprite, 1);
  } else {
    sprite.data[0] = 11;
    sprite.data[1] = 192;
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.callback = AnimKnockOffStrike_Step;
};

// ------------------------------------------------------------------ Recycle

/** AnimRecycle: the spinning recycle arrows fade in over the attacker, stay, and fade out. */
const AnimRecycle: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_TOP);
  if (sprite.y < 16) sprite.y = 16;
  sprite.data[6] = 0;
  sprite.data[7] = 16;
  sprite.callback = AnimRecycle_Step;
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[6], sprite.data[7]));
};

function AnimRecycle_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[2]) {
    case 0:
      if (++d[0] > 1) {
        d[0] = 0;
        if (!(d[1] & 1)) {
          if (d[6] < 16) d[6]++;
        } else if (d[7] !== 0) {
          d[7]--;
        }
        d[1]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], d[7]));
        if (d[7] === 0) d[2]++;
      }
      break;
    case 1:
      if (++d[0] === 10) {
        d[0] = 0;
        d[1] = 0;
        d[2]++;
      }
      break;
    case 2:
      if (++d[0] > 1) {
        d[0] = 0;
        if (!(d[1] & 1)) {
          if (d[6] !== 0) d[6]--;
        } else if (d[7] < 16) {
          d[7]++;
        }
        d[1]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[6], d[7]));
        if (d[7] === 16) d[2]++;
      }
      break;
    case 3:
      DestroySpriteAndMatrix(sprite);
      break;
  }
}

// ------------------------------------------------------------------ Weather Ball, Slack Off

/** AnimTask_GetWeather: ANIM_WEATHER_* for gWeatherMoveAnim, in gBattleAnimArgs[ARG_RET_ID] */
const AnimTask_GetWeather: TaskFunc = (taskId) => {
  const w = anim.weatherMoveAnim;
  gBattleAnimArgs[ARG_RET_ID] = K.ANIM_WEATHER_NONE;
  if (w & K.B_WEATHER_SUN) gBattleAnimArgs[ARG_RET_ID] = K.ANIM_WEATHER_SUN;
  else if (w & K.B_WEATHER_RAIN) gBattleAnimArgs[ARG_RET_ID] = K.ANIM_WEATHER_RAIN;
  else if (w & K.B_WEATHER_SANDSTORM) gBattleAnimArgs[ARG_RET_ID] = K.ANIM_WEATHER_SANDSTORM;
  else if (w & K.B_WEATHER_HAIL) gBattleAnimArgs[ARG_RET_ID] = K.ANIM_WEATHER_HAIL;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_SlackOffSquish: the battler squishes down (sSlackOffSquishAffineAnimCmds), shaking. Args: battler. */
const AnimTask_SlackOffSquish: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.data[0] = 0;
  task.data[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  PrepareAffineAnimInTaskData(task, task.data[15], affineAnim('sSlackOffSquishAffineAnimCmds'));
  task.func = AnimTask_SlackOffSquish_Step;
};

const AnimTask_SlackOffSquish_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[0]++;
  if (d[0] > 16 && d[0] < 40) {
    if (++d[1] > 2) {
      d[1] = 0;
      d[2]++;
      gSprites[d[15]].x2 = !(d[2] & 1) ? -1 : 1;
    }
  } else {
    gSprites[d[15]].x2 = 0;
  }
  if (!RunAffineAnimFromTaskData(task)) DestroyAnimVisualTask(taskId);
};

export const effects3bSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimFlatterConfetti,
  AnimFlatterSpotlight,
  AnimReversalOrb,
  AnimYawnCloud,
  AnimSmokeBallEscapeCloud,
  AnimFacadeSweatDrop,
  AnimGlareEyeDot,
  AnimAssistPawprint,
  AnimSmellingSaltsHand,
  AnimSmellingSaltExclamation,
  AnimHelpingHandClap,
  AnimForesightMagnifyingGlass,
  AnimMeteorMashStar,
  AnimBlockX,
  AnimUnusedItemBagSteal,
  AnimKnockOffStrike,
  AnimRecycle,
};

export const effects3bTasks: Record<string, TaskFunc> = {
  AnimTask_PainSplitMovement,
  AnimTask_RolePlaySilhouette,
  AnimTask_AcidArmor,
  AnimTask_DeepInhale,
  AnimTask_SlideMonForFocusBand,
  AnimTask_SquishAndSweatDroplets,
  AnimTask_FacadeColorBlend,
  AnimTask_StatusClearedEffect,
  AnimTask_GlareEyeDots,
  AnimTask_BarrageBall,
  AnimTask_SmellingSaltsSquish,
  AnimTask_HelpingHandAttackerMovement,
  AnimTask_OdorSleuthMovement,
  AnimTask_GetReturnPowerLevel,
  AnimTask_SnatchOpposingMonMove,
  AnimTask_SnatchPartnerMove,
  AnimTask_TeeterDanceMovement,
  AnimTask_GetWeather,
  AnimTask_SlackOffSquish,
};

export function registerEffects3bExtraGfx(): void {
  registerAnimExtraGfx({ AnimTask_StatusClearedEffect: ['gCureBubblesGfx', 'gCureBubblesTilemap', 'gCureBubblesPal'] });
}
