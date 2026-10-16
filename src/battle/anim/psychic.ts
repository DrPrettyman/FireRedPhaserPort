// battle_anim_psychic.c: sprite callbacks and tasks (every one in the file).

import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_ALL,
  DISPLAY_WIDTH,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  SetGpuReg,
} from '../../gba/hw';
import { gPlttBufferFaded, OBJ_PLTT_ID } from '../../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import {
  AllocOamMatrix,
  CalcCenterToCornerVec,
  ChangeSpriteAffineAnim,
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  gSprites,
  IndexOfSpritePaletteTag,
  InitSpriteAffineAnim,
  MAX_SPRITES,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_AFFINE_OFF,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type AffineAnimCmd,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { bdata, g } from '../env';
import { affineAnimTable, GetBattlerSpriteBGPriorityRank } from '../gfx';
import { gSineTable } from '../trig';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import {
  BATTLE_PARTNER,
  CloneBattlerSpriteWithBlend,
  DestroySpriteAndMatrix,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  GetBattlerYCoordWithElevation,
  InitAnimArcTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  PrepareAffineAnimInTaskData,
  ResetSpriteRotScale,
  RunAffineAnimFromTaskData,
  RunStoredCallbackWhenAnimEnds,
  SetBattlerSpriteYOffsetFromOtherYScale,
  SetSpriteRotScale,
  TranslateAnimHorizontalArc,
} from './animMons';
import { animSpriteTemplate, BattleAnimAdjustPanning, MoveBattlerSpriteToBG, PlaySE12WithPanning, ResetBattleAnimBg } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const UNIT = 'battle_anim_psychic.c';
/** A static `union AffineAnimCmd[]` of this file (extracted to anims.json) */
const affineAnim = (name: string) => bdata.anims.units[UNIT].affineAnims[name] as AffineAnimCmd[];

// AnimDefensiveWall (Reflect, Light Screen, Barrier, Mirror Coat, Magic Coat): the wall fades in in front
// of the attacker's side, cycles colours 1-8 of its palette, and fades out. The foes move to the anim
// BGs meanwhile so the (blended) wall draws over them. Args: x, y, palette tag.
const AnimDefensiveWall: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.oam.priority = 2;
    sprite.subpriority = 200;
  }
  const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  const toBG2 = (GetBattlerSpriteBGPriorityRank(battler) ^ 1) !== 0;
  if (IsBattlerSpriteVisible(battler)) MoveBattlerSpriteToBG(battler, toBG2);
  if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) MoveBattlerSpriteToBG(BATTLE_PARTNER(battler), !toBG2);
  if (IsDoubleBattle()) {
    if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
      sprite.x = 72;
      sprite.y = 80;
    } else {
      sprite.x = 176;
      sprite.y = 40;
    }
  } else {
    if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  }
  sprite.data[0] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(gBattleAnimArgs[2]));
  sprite.callback = AnimDefensiveWall_Step2;
  sprite.callback(sprite);
};

function AnimDefensiveWall_Step2(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[3], 16 - sprite.data[3]));
  if (sprite.data[3] === 13) sprite.callback = AnimDefensiveWall_Step3;
  else ++sprite.data[3];
}

function AnimDefensiveWall_Step3(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[1] === 2) {
    d[1] = 0;
    const startOffset = d[0] & 0xffff;
    const color = gPlttBufferFaded[startOffset + 8];
    for (let i = 8; i > 0; --i) gPlttBufferFaded[startOffset + i] = gPlttBufferFaded[startOffset + i - 1];
    gPlttBufferFaded[startOffset + 1] = color;
    if (++d[2] === 16) sprite.callback = AnimDefensiveWall_Step4;
  }
}

function AnimDefensiveWall_Step4(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[3], 16 - sprite.data[3]));
  if (--sprite.data[3] === -1) {
    const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    if (IsBattlerSpriteVisible(battler)) gSprites[g.battlerSpriteIds[battler]].invisible = false;
    if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) gSprites[g.battlerSpriteIds[BATTLE_PARTNER(battler)]].invisible = false;
    sprite.invisible = true;
    sprite.callback = AnimDefensiveWall_Step5;
  }
}

function AnimDefensiveWall_Step5(sprite: Sprite): void {
  const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  const toBG2 = (GetBattlerSpriteBGPriorityRank(battler) ^ 1) !== 0;
  if (IsBattlerSpriteVisible(battler)) ResetBattleAnimBg(toBG2);
  if (IsBattlerSpriteVisible(battler ^ 2)) ResetBattleAnimBg(!toBG2);
  sprite.callback = DestroyAnimSprite;
}

/** AnimWallSparkle: a sparkle on the wall (doubles: at the side's centre). Args: x, y, battler (0 attacker), ignore pic offsets. */
const AnimWallSparkle: SpriteCallback = (sprite) => {
  if (sprite.data[0] === 0) {
    const respectMonPicOffsets = !gBattleAnimArgs[3];
    if (IsDoubleBattle()) {
      if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
        sprite.x = 72 - gBattleAnimArgs[0];
        sprite.y = gBattleAnimArgs[1] + 80;
      } else {
        sprite.x = gBattleAnimArgs[0] + 176;
        sprite.y = gBattleAnimArgs[1] + 40;
      }
    } else if (gBattleAnimArgs[2] === 0) {
      InitSpritePosToAnimAttacker(sprite, respectMonPicOffsets);
    } else {
      InitSpritePosToAnimTarget(sprite, respectMonPicOffsets);
    }
    ++sprite.data[0];
  } else if (sprite.animEnded || sprite.affineAnimEnded) {
    DestroySpriteAndMatrix(sprite);
  }
};

/** AnimBentSpoon (Kinesis): the spoon bends beside the attacker. */
const AnimBentSpoon: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    StartSpriteAnim(sprite, 1);
    sprite.x -= 40;
    sprite.y += 10;
    sprite.data[1] = -1;
  } else {
    sprite.x += 40;
    sprite.y -= 10;
    sprite.data[1] = 1;
  }
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

/** AnimQuestionMark (Amnesia): appears over the attacker's head, then wobbles (sAffineAnims_QuestionMark). */
const AnimQuestionMark: SpriteCallback = (sprite) => {
  let x = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_WIDTH) / 2);
  const y = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_HEIGHT) / -2);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) x = -x;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + x;
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + y;
  if (sprite.y < 16) sprite.y = 16;
  StoreSpriteCallbackInData6(sprite, AnimQuestionMark_Step1);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
};

function AnimQuestionMark_Step1(sprite: Sprite): void {
  sprite.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  sprite.affineAnims = affineAnimTable(UNIT, 'sAffineAnims_QuestionMark');
  sprite.data[0] = 0;
  InitSpriteAffineAnim(sprite);
  sprite.callback = AnimQuestionMark_Step2;
}

function AnimQuestionMark_Step2(sprite: Sprite): void {
  switch (sprite.data[0]) {
    case 0:
      if (sprite.affineAnimEnded) {
        FreeOamMatrix(sprite.oam.matrixNum);
        sprite.oam.affineMode = ST_OAM_AFFINE_OFF;
        sprite.data[1] = 18;
        ++sprite.data[0];
      }
      break;
    case 1:
      if (--sprite.data[1] === -1) DestroyAnimSprite(sprite);
      break;
  }
}

/** AnimTask_MeditateStretchAttacker: squashes and stretches the attacker (sAffineAnim_MeditateStretchAttacker). */
const AnimTask_MeditateStretchAttacker: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  task.data[0] = spriteId;
  PrepareAffineAnimInTaskData(task, spriteId, affineAnim('sAffineAnim_MeditateStretchAttacker'));
  task.func = AnimTask_MeditateStretchAttacker_Step;
};

const AnimTask_MeditateStretchAttacker_Step: TaskFunc = (taskId) => {
  if (!RunAffineAnimFromTaskData(gTasks[taskId])) DestroyAnimVisualTask(taskId);
};

/** AnimTask_Teleport: the attacker stretches thin, shoots up and is hidden off screen. */
const AnimTask_Teleport: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  d[0] = spriteId;
  d[1] = 0;
  d[2] = 0;
  d[3] = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? 4 : 8;
  PrepareAffineAnimInTaskData(task, d[0], affineAnim('sAffineAnim_Teleport'));
  task.func = AnimTask_Teleport_Step;
};

const AnimTask_Teleport_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[1]) {
    case 0:
      RunAffineAnimFromTaskData(task);
      if (++d[2] > 19) ++d[1];
      break;
    case 1:
      if (d[3] !== 0) {
        gSprites[d[0]].y2 -= 8;
        --d[3];
      } else {
        gSprites[d[0]].invisible = true;
        gSprites[d[0]].x = DISPLAY_WIDTH + 32;
        ResetSpriteRotScale(d[0]);
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
};

/** AnimTask_ImprisonOrbs: five hollow orbs pop up around the attacker, then fade out. */
const AnimTask_ImprisonOrbs: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[3] = 16;
  d[4] = 0;
  d[13] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  d[14] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const var0 = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_WIDTH) / 3) & 0xffff;
  const var1 = Math.trunc(GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_HEIGHT) / 3) & 0xffff;
  d[12] = var0 > var1 ? var0 : var1;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
  gTasks[taskId].func = AnimTask_ImprisonOrbs_Step;
};

const AnimTask_ImprisonOrbs_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 8) {
        d[1] = 0;
        const spriteId = CreateSprite(animSpriteTemplate('sImprisonOrbSpriteTemplate')!, d[13], d[14], 0);
        d[d[2] + 8] = spriteId;
        if (spriteId !== MAX_SPRITES) {
          const s = gSprites[spriteId];
          switch (d[2]) {
            case 0:
              s.x2 = d[12];
              s.y2 = -d[12];
              break;
            case 1:
              s.x2 = -d[12];
              s.y2 = d[12];
              break;
            case 2:
              s.x2 = d[12];
              s.y2 = d[12];
              break;
            case 3:
              s.x2 = -d[12];
              s.y2 = -d[12];
              break;
          }
        }
        if (++d[2] === 5) ++d[0];
      }
      break;
    case 1:
      if (d[1] & 1) --d[3];
      else ++d[4];
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[3], d[4]));
      if (++d[1] === 32) {
        for (let i = 8; i < 13; ++i) if (d[i] !== MAX_SPRITES) DestroySprite(gSprites[d[i]]);
        ++d[0];
      }
      break;
    case 2:
      ++d[0];
      break;
    case 3:
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimRedX (Imprison, Rock Tomb): blinks for its last 10 frames. Args: 0 on the attacker (else where it was made), duration. */
const AnimRedX: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  }
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.callback = AnimRedX_Step;
};

function AnimRedX_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[1] > d[0] - 10) sprite.invisible = !!(d[1] & 1);
  if (d[1] === d[0]) DestroyAnimSprite(sprite);
  ++d[1];
}

/** AnimTask_SkillSwap: twelve orbs arc from one battler to the other. Arg 0: 1 target to attacker, else attacker to target. */
const AnimTask_SkillSwap: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (gBattleAnimArgs[0] === 1) {
    d[10] = -10;
    d[11] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_LEFT) + 8;
    d[12] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_TOP) + 8;
    d[13] = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_LEFT) + 8;
    d[14] = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_TOP) + 8;
  } else {
    d[10] = 10;
    d[11] = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_RIGHT) - 8;
    d[12] = GetBattlerSpriteCoordAttr(anim.attacker, K.BATTLER_COORD_ATTR_BOTTOM) - 8;
    d[13] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_RIGHT) - 8;
    d[14] = GetBattlerSpriteCoordAttr(anim.target, K.BATTLER_COORD_ATTR_BOTTOM) - 8;
  }
  d[1] = 6;
  gTasks[taskId].func = AnimTask_SkillSwap_Step;
};

const AnimTask_SkillSwap_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 6) {
        d[1] = 0;
        const spriteId = CreateSprite(animSpriteTemplate('sSkillSwapOrbSpriteTemplate')!, d[11], d[12], 0);
        if (spriteId !== MAX_SPRITES) {
          const s = gSprites[spriteId];
          s.data[0] = 16;
          s.data[2] = d[13];
          s.data[4] = d[14];
          s.data[5] = d[10];
          InitAnimArcTranslation(s);
          StartSpriteAffineAnim(s, d[2] & 3);
        }
        if (++d[2] === 12) ++d[0];
      }
      break;
    case 1:
      if (++d[1] > 17) DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimSkillSwapOrb (sSkillSwapOrbSpriteTemplate, made by AnimTask_SkillSwap) */
const AnimSkillSwapOrb: SpriteCallback = (sprite) => {
  if (TranslateAnimHorizontalArc(sprite)) {
    FreeOamMatrix(sprite.oam.matrixNum);
    DestroySprite(sprite);
  }
};

/**
 * AnimTask_ExtrasensoryDistortion: shifts the lines of the target's BG sideways in a sine pattern (the target
 * is on a BG for the move: monbg). Arg 0: stage, 0 slight right, 1 medium left, 2 severe right.
 */
const AnimTask_ExtrasensoryDistortion: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const yOffset = GetBattlerYCoordWithElevation(anim.target) & 0xff;
  d[14] = yOffset - 32;
  switch (gBattleAnimArgs[0]) {
    case 0:
      d[11] = 2;
      d[12] = 5;
      d[13] = 64;
      d[15] = yOffset + 32;
      break;
    case 1:
      d[11] = 2;
      d[12] = 5;
      d[13] = 192;
      d[15] = yOffset + 32;
      break;
    case 2:
      d[11] = 4;
      d[12] = 4;
      d[13] = 0;
      d[15] = yOffset + 32;
      break;
  }
  if (d[14] < 0) d[14] = 0;
  let dmaDest: number;
  if (GetBattlerSpriteBGPriorityRank(anim.target) === 1) {
    d[10] = g.battle_BG1_X;
    dmaDest = REG_OFFSET_BG1HOFS;
  } else {
    d[10] = g.battle_BG2_X;
    dmaDest = REG_OFFSET_BG2HOFS;
  }
  for (let i = d[14]; i <= d[14] + 64; ++i) {
    gScanlineEffectRegBuffers[0][i] = d[10];
    gScanlineEffectRegBuffers[1][i] = d[10];
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  gTasks[taskId].func = AnimTask_ExtrasensoryDistortion_Step;
};

const AnimTask_ExtrasensoryDistortion_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      let sineIndex = d[13];
      for (let i = d[14]; i <= d[15]; ++i) {
        let var2 = ((gSineTable(sineIndex) >> d[12]) << 16) >> 16;
        if (var2 > 0) var2 += d[1] & 3;
        else if (var2 < 0) var2 -= d[1] & 3;
        gScanlineEffectRegBuffers[0][i] = d[10] + var2;
        gScanlineEffectRegBuffers[1][i] = d[10] + var2;
        sineIndex += d[11];
      }
      if (++d[1] > 23) ++d[0];
      break;
    }
    case 1:
      gScanlineEffect.state = 3;
      ++d[0];
      break;
    case 2:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_TransparentCloneGrowAndShrink (Extrasensory): a blended copy of the battler grows and shrinks back. Arg 0: anim battler. */
const AnimTask_TransparentCloneGrowAndShrink: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const matrixNum = AllocOamMatrix();
  if (matrixNum === 0xff) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const spriteId = CloneBattlerSpriteWithBlend(gBattleAnimArgs[0]);
  if (spriteId < 0) {
    FreeOamMatrix(matrixNum);
    DestroyAnimVisualTask(taskId);
    return;
  }
  const clone = gSprites[spriteId];
  clone.callback = SpriteCallbackDummy;
  clone.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  clone.oam.matrixNum = matrixNum;
  clone.affineAnimPaused = true;
  ++clone.subpriority;
  SetSpriteRotScale(spriteId, 256, 256, 0);
  CalcCenterToCornerVec(clone, clone.oam.shape, clone.oam.size, clone.oam.affineMode);
  d[13] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  d[14] = matrixNum;
  d[15] = spriteId;
  gTasks[taskId].func = AnimTask_TransparentCloneGrowAndShrink_Step;
};

const AnimTask_TransparentCloneGrowAndShrink_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      d[1] += 4;
      d[2] = 256 - (gSineTable(d[1]) >> 1);
      SetSpriteRotScale(d[15], d[2], d[2], 0);
      SetBattlerSpriteYOffsetFromOtherYScale(d[15], d[13]);
      if (d[1] === 48) ++d[0];
      break;
    case 1:
      d[1] -= 4;
      d[2] = 256 - (gSineTable(d[1]) >> 1);
      SetSpriteRotScale(d[15], d[2], d[2], 0);
      SetBattlerSpriteYOffsetFromOtherYScale(d[15], d[13]);
      if (d[1] === 0) ++d[0];
      break;
    case 2:
      DestroySpriteWithActiveSheet(gSprites[d[15]]);
      ++d[0];
      break;
    case 3:
      FreeOamMatrix(d[14]);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimPsychoBoost: the orb pulses on the attacker, then stretches up and fades away. */
const AnimPsychoBoost: SpriteCallback = (sprite) => {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
      sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
      d[1] = 8;
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
      ++d[0];
      break;
    case 1:
      if (sprite.affineAnimEnded) {
        PlaySE12WithPanning(K.SE_M_TELEPORT, BattleAnimAdjustPanning(-64));
        ChangeSpriteAffineAnim(sprite, 1);
        ++d[0];
      }
      break;
    case 2:
      if (d[2]++ > 1) {
        d[2] = 0;
        --d[1];
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[1], 16 - d[1]));
        if (d[1] === 0) {
          ++d[0];
          sprite.invisible = true;
        }
      }
      d[3] += 0x380;
      sprite.y2 -= d[3] >> 8;
      d[3] &= 0xff;
      break;
    case 3:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      DestroyAnimSprite(sprite);
      break;
  }
};

export const psychicSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimDefensiveWall,
  AnimWallSparkle,
  AnimBentSpoon,
  AnimQuestionMark,
  AnimRedX,
  AnimSkillSwapOrb,
  AnimPsychoBoost,
};

export const psychicTasks: Record<string, TaskFunc> = {
  AnimTask_MeditateStretchAttacker,
  AnimTask_Teleport,
  AnimTask_ImprisonOrbs,
  AnimTask_SkillSwap,
  AnimTask_ExtrasensoryDistortion,
  AnimTask_TransparentCloneGrowAndShrink,
};
