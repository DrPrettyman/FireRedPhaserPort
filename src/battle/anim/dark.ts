// battle_anim_dark.c: sprite callbacks and tasks (every one in the file).

import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT2_ALL,
  DISPCNT_OBJWIN_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GetGpuReg,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../../gba/hw';
import { BG_PLTT_ID, BlendPalette, FillPalette, LoadCompressedPalette, PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import {
  DestroySprite,
  gSprites,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Sin } from '../trig';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  BATTLE_PARTNER,
  CreateInvisibleSpriteCopy,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  InitAnimArcTranslation,
  InitBattleAnimBg,
  InitSpriteDataForLinearTranslation,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetGreyscaleOrOriginalPalette,
  SPRITE_NONE,
  TranslateAnimHorizontalArc,
} from './animMons';
import { MoveBattlerSpriteToBG, ResetBattleAnimBg } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

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

/** AnimClawSlash (Crush Claw, Metal Claw, Dragon Claw, ...). Args: x, y, anim. */
const AnimClawSlash: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// ------------------------------------------------------------------ fading the attacker out and in

/** AnimTask_AttackerFadeToInvisible (Faint Attack, Camouflage, ...): the attacker's BG fades out. Arg 0: frames per step - 1. */
const AnimTask_AttackerFadeToInvisible: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  const battler = anim.attacker;
  d[1] = 16;
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
  if (GetBattlerSpriteBGPriorityRank(battler) === 1) SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
  else SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
  gTasks[taskId].func = AnimTask_AttackerFadeToInvisible_Step;
};

const AnimTask_AttackerFadeToInvisible_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let blendA = (d[1] >> 8) & 0xff;
  let blendB = d[1] & 0xff;
  if (d[2] === (d[0] & 0xff)) {
    blendA = (blendA + 1) & 0xff;
    blendB = (blendB - 1) & 0xff;
    d[1] = BLDALPHA_BLEND(blendB, blendA);
    SetGpuReg(REG_OFFSET_BLDALPHA, d[1]);
    d[2] = 0;
    if (blendA === 16) {
      gSprites[g.battlerSpriteIds[anim.attacker]].invisible = true;
      DestroyAnimVisualTask(taskId);
    }
  } else {
    ++d[2];
  }
};

/** AnimTask_AttackerFadeFromInvisible: the reverse (blend set up by AnimTask_InitAttackerFadeFromInvisible). Arg 0: frames per step - 1. */
const AnimTask_AttackerFadeFromInvisible: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = BLDALPHA_BLEND(0, 16);
  gTasks[taskId].func = AnimTask_AttackerFadeFromInvisible_Step;
  SetGpuReg(REG_OFFSET_BLDALPHA, d[1]);
};

const AnimTask_AttackerFadeFromInvisible_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let blendA = (d[1] >> 8) & 0xff;
  let blendB = d[1] & 0xff;
  if (d[2] === (d[0] & 0xff)) {
    blendA = (blendA - 1) & 0xff;
    blendB = (blendB + 1) & 0xff;
    d[1] = (blendA << 8) | blendB;
    SetGpuReg(REG_OFFSET_BLDALPHA, d[1]);
    d[2] = 0;
    if (blendA === 0) {
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimVisualTask(taskId);
    }
  } else {
    ++d[2];
  }
};

/** AnimTask_InitAttackerFadeFromInvisible: blends the attacker's BG fully out, ready to fade back in. */
const AnimTask_InitAttackerFadeFromInvisible: TaskFunc = (taskId) => {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
  else SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
  DestroyAnimVisualTask(taskId);
};

/** AnimUnusedBagSteal (sUnusedBagStealSpriteTemplate, unused): a bag bounces from the target to the attacker. */
const AnimUnusedBagSteal: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[3] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  d[0] = 0x7e;
  InitSpriteDataForLinearTranslation(sprite);
  d[3] = -d[1];
  d[4] = -d[2];
  d[6] = 0xffd8;
  sprite.callback = AnimUnusedBagSteal_Step;
  sprite.callback(sprite);
};

function AnimUnusedBagSteal_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  sprite.x2 = d[3] >> 8;
  sprite.y2 = d[4] >> 8;
  if (d[7] === 0) {
    d[3] += d[1];
    d[4] += d[2];
    sprite.x2 = d[3] >> 8;
    sprite.y2 = d[4] >> 8;
    --d[0];
  }
  sprite.y2 += Sin(d[5], d[6]);
  d[5] = (d[5] + 3) & 0xff;
  if (d[5] > 0x7f) {
    d[5] = 0;
    d[6] += 20;
    ++d[7];
  }
  if (--d[0] === 0) DestroyAnimSprite(sprite);
}

/** AnimTearDrop (Fake Tears): a tear arcs off the battler. Args: battler, which corner (0-3). */
const AnimTearDrop: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  let xOffset = 20;
  sprite.oam.tileNum += 4;
  switch (gBattleAnimArgs[1]) {
    case 0:
      sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_RIGHT) - 8;
      sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP) + 8;
      break;
    case 1:
      sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_RIGHT) - 14;
      sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP) + 16;
      break;
    case 2:
      sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_LEFT) + 8;
      sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP) + 8;
      StartSpriteAffineAnim(sprite, 1);
      xOffset = -20;
      break;
    case 3:
      sprite.x = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_LEFT) + 14;
      sprite.y = GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_TOP) + 16;
      StartSpriteAffineAnim(sprite, 1);
      xOffset = -20;
      break;
  }
  const d = sprite.data;
  d[0] = 32;
  d[2] = sprite.x + xOffset;
  d[4] = sprite.y + 12;
  d[5] = -12;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimTearDrop_Step;
};

function AnimTearDrop_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroySpriteAndMatrix(sprite);
}

// ------------------------------------------------------------------ Memento

/**
 * AnimTask_MoveAttackerMementoShadow: the attacker's BG is blacked out and squashed up into a shadow (a
 * per-line BGnVOFS table, DoMementoShadowEffect) inside a window that then closes.
 */
const AnimTask_MoveAttackerMementoShadow: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  d[7] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + 31;
  d[6] = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_TOP) - 7;
  d[5] = d[7];
  d[4] = d[6];
  d[13] = (d[7] - d[6]) << 8;
  const pos = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) & 0xff;
  d[14] = pos - 32;
  d[15] = pos + 32;
  d[8] = getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER ? -12 : -64;
  d[3] = GetBattlerSpriteBGPriorityRank(anim.attacker);
  let dmaDest: number;
  let var0: number;
  if (d[3] === 1) {
    const animBg = GetBattleAnimBg1Data();
    d[10] = g.battle_BG1_Y;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
    FillPalette(RGB_BLACK, BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
    dmaDest = REG_OFFSET_BG1VOFS;
    var0 = WINOUT_WIN01_BG1;
    g.battle_BG2_X += DISPLAY_WIDTH;
  } else {
    d[10] = g.battle_BG2_Y;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
    FillPalette(RGB_BLACK, BG_PLTT_ID(9), PLTT_SIZE_4BPP);
    dmaDest = REG_OFFSET_BG2VOFS;
    var0 = WINOUT_WIN01_BG2;
    g.battle_BG1_X += DISPLAY_WIDTH;
  }
  d[11] = 0;
  d[12] = 16;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  SetAllBattlersSpritePriority(3);
  for (let i = 0; i < 112; ++i) {
    gScanlineEffectRegBuffers[0][i] = d[10];
    gScanlineEffectRegBuffers[1][i] = d[10];
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | (var0 ^ (WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR)));
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  g.battle_WIN0H = ((d[14] << 8) | d[15]) & 0xffff;
  g.battle_WIN0V = DISPLAY_HEIGHT;
  task.func = AnimTask_MoveAttackerMementoShadow_Step;
};

const AnimTask_MoveAttackerMementoShadow_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 1) {
        d[1] = 0;
        if (++d[2] & 1) {
          if (d[11] !== 12) ++d[11];
        } else if (d[12] !== 8) {
          --d[12];
        }
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], d[12]));
        if (d[11] === 12 && d[12] === 8) ++d[0];
      }
      break;
    case 1:
      d[4] -= 8;
      DoMementoShadowEffect(task);
      if (d[4] < d[8]) ++d[0];
      break;
    case 2:
      d[4] -= 8;
      DoMementoShadowEffect(task);
      d[14] += 4;
      d[15] -= 4;
      if (d[14] >= d[15]) d[14] = d[15];
      g.battle_WIN0H = ((d[14] << 8) | d[15]) & 0xffff;
      if (d[14] === d[15]) ++d[0];
      break;
    case 3:
      gScanlineEffect.state = 3;
      ++d[0];
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_MoveTargetMementoShadow: the target's BG, blacked out, unfolds from a shadow at its feet, then fades. */
const AnimTask_MoveTargetMementoShadow: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[3] = GetBattlerSpriteBGPriorityRank(anim.target);
      if (d[3] === 1) {
        SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG1);
        g.battle_BG2_X += DISPLAY_WIDTH;
      } else {
        SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND | BLDCNT_TGT1_BG2);
        g.battle_BG1_X += DISPLAY_WIDTH;
      }
      ++d[0];
      break;
    case 1:
      if (d[3] === 1) {
        const animBg = GetBattleAnimBg1Data();
        d[10] = g.battle_BG1_Y;
        FillPalette(RGB_BLACK, BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
      } else {
        d[10] = g.battle_BG2_Y;
        FillPalette(RGB_BLACK, BG_PLTT_ID(9), PLTT_SIZE_4BPP);
      }
      SetAllBattlersSpritePriority(3);
      ++d[0];
      break;
    case 2: {
      d[7] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + 31;
      d[6] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_TOP) - 7;
      d[13] = (d[7] - d[6]) << 8;
      const x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) & 0xff;
      d[14] = x - 4;
      d[15] = x + 4;
      d[8] = getBattlerSide(anim.target) === K.B_SIDE_PLAYER ? -12 : -64;
      d[4] = d[8];
      d[5] = d[8];
      d[11] = 12;
      d[12] = 8;
      ++d[0];
      break;
    }
    case 3: {
      const dmaDest = d[3] === 1 ? REG_OFFSET_BG1VOFS : REG_OFFSET_BG2VOFS;
      for (let i = 0; i < 112; ++i) {
        gScanlineEffectRegBuffers[0][i] = d[10] + (159 - i);
        gScanlineEffectRegBuffers[1][i] = d[10] + (159 - i);
      }
      ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
      ++d[0];
      break;
    }
    case 4:
      if (d[3] === 1) SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | WINOUT_WIN01_BG0 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      else SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
      g.battle_WIN0H = ((d[14] << 8) | d[15]) & 0xffff;
      g.battle_WIN0V = DISPLAY_HEIGHT;
      d[0] = 0;
      d[1] = 0;
      d[2] = 0;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(12, 8));
      task.func = AnimTask_MoveTargetMementoShadow_Step;
      break;
  }
};

const AnimTask_MoveTargetMementoShadow_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      d[5] += 8;
      if (d[5] >= d[7]) d[5] = d[7];
      DoMementoShadowEffect(task);
      if (d[5] === d[7]) ++d[0];
      break;
    case 1:
      if (d[15] - d[14] < 0x40) {
        d[14] -= 4;
        d[15] += 4;
      } else {
        d[1] = 1;
      }
      g.battle_WIN0H = ((d[14] << 8) | d[15]) & 0xffff;
      d[4] += 8;
      if (d[4] >= d[6]) d[4] = d[6];
      DoMementoShadowEffect(task);
      if (d[4] === d[6] && d[1]) {
        d[1] = 0;
        ++d[0];
      }
      break;
    case 2:
      if (++d[1] > 1) {
        d[1] = 0;
        ++d[2];
        if (d[2] & 1) {
          if (d[11]) --d[11];
        } else if (d[12] < 16) {
          ++d[12];
        }
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[11], d[12]));
        if (d[11] === 0 && d[12] === 16) ++d[0];
      }
      break;
    case 3:
      gScanlineEffect.state = 3;
      ++d[0];
      break;
    case 4:
      g.battle_WIN0H = 0;
      g.battle_WIN0V = 0;
      SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR | WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/**
 * DoMementoShadowEffect: per-line BGnVOFS so lines [data4, data5] show the mon's rows [data6, data7]
 * squashed (or stretched); the lines outside show the blank row below the mon.
 */
function DoMementoShadowEffect(task: Task): void {
  const d = task.data;
  const var2 = (d[5] - d[4]) << 16 >> 16;
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  let i: number;
  if (var2 !== 0) {
    const var0 = Math.trunc(d[13] / var2);
    let var1 = d[6] << 8;
    for (i = 0; i < d[4]; ++i) buf[i] = d[10] - (i - 159);
    for (i = d[4]; i <= d[5]; ++i) {
      if (i >= 0) {
        const var3 = ((var1 >> 8) - i) << 16 >> 16;
        buf[i] = var3 + d[10];
      }
      var1 += var0;
    }
    let var4 = d[10] - (i - 159);
    for (; i < d[7]; ++i) if (i >= 0) buf[i] = var4--;
  } else {
    let var4 = d[10] + 159;
    for (i = 0; i < 112; ++i) {
      gScanlineEffectRegBuffers[0][i] = var4;
      gScanlineEffectRegBuffers[1][i] = var4;
      --var4;
    }
  }
}

/** SetAllBattlersSpritePriority */
function SetAllBattlersSpritePriority(priority: number): void {
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; ++i) {
    const spriteId = GetAnimBattlerSpriteId(i);
    if (spriteId !== SPRITE_NONE) gSprites[spriteId].oam.priority = priority;
  }
}

/** AnimTask_InitMementoShadow: puts the attacker (and partner) on the anim BGs. */
const AnimTask_InitMementoShadow: TaskFunc = (taskId) => {
  const toBG2 = (GetBattlerSpriteBGPriorityRank(anim.attacker) ^ 1) !== 0;
  MoveBattlerSpriteToBG(anim.attacker, toBG2);
  gSprites[g.battlerSpriteIds[anim.attacker]].invisible = false;
  if (IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) {
    MoveBattlerSpriteToBG(anim.attacker ^ 2, !toBG2);
    gSprites[g.battlerSpriteIds[anim.attacker ^ 2]].invisible = false;
  }
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_MementoHandleBg: clears the anim BGs AnimTask_InitMementoShadow used. */
const AnimTask_MementoHandleBg: TaskFunc = (taskId) => {
  const toBG2 = (GetBattlerSpriteBGPriorityRank(anim.attacker) ^ 1) !== 0;
  ResetBattleAnimBg(toBG2);
  if (IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) ResetBattleAnimBg(!toBG2);
  DestroyAnimVisualTask(taskId);
};

export const darkSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimUnusedBagSteal,
  AnimBite,
  AnimTearDrop,
  AnimClawSlash,
};

export const darkTasks: Record<string, TaskFunc> = {
  AnimTask_AttackerFadeToInvisible,
  AnimTask_AttackerFadeFromInvisible,
  AnimTask_InitAttackerFadeFromInvisible,
  AnimTask_MoveAttackerMementoShadow,
  AnimTask_MoveTargetMementoShadow,
  AnimTask_InitMementoShadow,
  AnimTask_MementoHandleBg,
  AnimTask_MetallicShine,
  AnimTask_SetGrayscaleOrOriginalPal,
  GetIsDoomDesireHitTurn,
};

export function registerDarkExtraGfx(): void {
  registerAnimExtraGfx({ AnimTask_MetallicShine: ['gMetalShineTilemap', 'gMetalShineGfx', 'gMetalShinePalette'] });
}
