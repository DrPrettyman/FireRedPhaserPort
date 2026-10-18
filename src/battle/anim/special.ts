// battle_anim_special.c: the special anims (level up, switch out, the ball throw with its shakes, click and
// break-out, the trainer's throw, substitute swaps), the ball open particles and fades the send-out code
// uses too, shiny sparkles, and the Safari Zone bait/rock throws.

import { BLDALPHA_BLEND, BLDCNT_EFFECT_BLEND, BLDCNT_TGT1_BG1, BLDCNT_TGT1_BG2, BLDCNT_TGT2_ALL, OBJ_VRAM0, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, RGB, RGB_BLACK, RGB_WHITE, SetGpuReg, vram } from '../../gba/hw';
import { gMain } from '../../gba/main';
import { BeginNormalPaletteFade, BlendPalette, BlendPalettes, gPaletteFade, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  AllocSpritePalette,
  AnimateSprite,
  ChangeSpriteAffineAnim,
  CreateSprite,
  DestroySprite,
  DestroySpriteAndFreeResources,
  FreeOamMatrix,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadCompressedSpritePalette,
  LoadCompressedSpriteSheet,
  MAX_SPRITES,
  oam,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  TILE_SIZE_4BPP,
  type Sprite,
  type SpriteCallback,
  type SpriteTemplate,
} from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, TaskDummy, type TaskFunc } from '../../gba/task';
import { gfx, gfx16 } from '../../gba/gfx';
import type { Pokemon } from '../../pokemon/Pokemon';
import { UpdateOamPriorityInAllHealthboxes } from '../battleInterface';
import { ui } from '../battleUi';
import { K } from '../constants';
import { bdata, g } from '../env';
import { animTable, ClearBehindSubstituteBit, FreeBallGfx, gBallSpriteTemplates, ItemIdToBallId, LoadBallGfx, LoadBattleMonGfxAndAnimate, SpriteCB_PlayerThrowInit } from '../gfx';
import { Cos, Sin } from '../trig';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import {
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteSubpriority,
  GetBattlePalettesMask,
  InitAnimArcTranslation,
  InitSpritePosToAnimAttacker,
  IsBattlerSpriteVisible,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  SetBattlerSpriteYOffsetFromYScale,
  SetSpriteRotScale,
  TranslateAnimHorizontalArc,
  TranslateAnimVerticalArc,
} from './animMons';
import { m4aMPlayAllStop } from '../../audio/m4a';
import { PlaySE, PlaySE12WithPanning } from '../../gba/sound';
import { animSpriteTemplate, animTagGfx, LoadAnimSpriteGfx } from './battleAnim';
import { anim, ARG_RET_ID, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const sbd = () => g.battleSpritesDataPtr;
const u16 = (v: number) => v & 0xffff;
const s8 = (v: number) => (v << 24) >> 24;

// gMonShrinkDuration / gMonShrinkDelta / gMonShrinkDistance (COMMON_DATA)
let gMonShrinkDuration = 0;
let gMonShrinkDelta = 0;
let gMonShrinkDistance = 0;

/** sCaptureStar: the three stars when the ball clicks */
const sCaptureStar = [
  { xOffset: 10, yOffset: 2, amplitude: -3 },
  { xOffset: 15, yOffset: 0, amplitude: -4 },
  { xOffset: -10, yOffset: 2, amplitude: -4 },
];

// TAG_PARTICLES_POKEBALL .. TAG_PARTICLES_PREMIERBALL (file-local #defines)
const TAG_PARTICLES = (ballId: number) => 55020 + ballId;

/** sBallParticleAnimNums */
const sBallParticleAnimNums = [0, 0, 0, 5, 1, 2, 2, 3, 5, 5, 4, 4];

/** sBallOpenFadeColors */
const sBallOpenFadeColors = [
  RGB(31, 22, 30),
  RGB(16, 23, 30),
  RGB(23, 30, 20),
  RGB(31, 31, 15),
  RGB(23, 20, 28),
  RGB(21, 31, 25),
  RGB(12, 25, 30),
  RGB(30, 27, 10),
  RGB(31, 24, 16),
  RGB(29, 30, 30),
  RGB(31, 17, 10),
  RGB(31, 9, 10),
];

const particleTemplates: SpriteTemplate[] = [];
/** sBallParticlesSpriteTemplates[ballId] */
function sBallParticlesSpriteTemplate(ballId: number): SpriteTemplate {
  return (particleTemplates[ballId] ??= {
    tileTag: TAG_PARTICLES(ballId),
    paletteTag: TAG_PARTICLES(ballId),
    oam: oam(bdata.animScripts.oam['gOamData_AffineOff_ObjNormal_8x8']),
    anims: animTable('battle_anim_special.c', 'sAnims_BallParticles'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  });
}

// ------------------------------------------------------------------ level up

/** DoLoadHealthboxPalsForLevelUp: the healthbox gets its own copies of its palettes to flash */
export function DoLoadHealthboxPalsForLevelUp(battler: number): { paletteId1: number; paletteId2: number } {
  const healthBoxSpriteId = g.healthboxSpriteIds[battler];
  const spriteId1 = gSprites[healthBoxSpriteId].oam.affineParam;
  const spriteId2 = gSprites[healthBoxSpriteId].data[5];
  const paletteId1 = AllocSpritePalette(K.TAG_HEALTHBOX_PALS_1);
  const paletteId2 = AllocSpritePalette(K.TAG_HEALTHBOX_PALS_2);
  const offset1 = OBJ_PLTT_ID(gSprites[healthBoxSpriteId].oam.paletteNum);
  const offset2 = OBJ_PLTT_ID(gSprites[spriteId2].oam.paletteNum);
  LoadPalette(gPlttBufferUnfaded.slice(offset1, offset1 + 16), OBJ_PLTT_ID(paletteId1), PLTT_SIZE_4BPP);
  LoadPalette(gPlttBufferUnfaded.slice(offset2, offset2 + 16), OBJ_PLTT_ID(paletteId2), PLTT_SIZE_4BPP);
  gSprites[healthBoxSpriteId].oam.paletteNum = paletteId1;
  gSprites[spriteId1].oam.paletteNum = paletteId1;
  gSprites[spriteId2].oam.paletteNum = paletteId2;
  return { paletteId1, paletteId2 };
}

const AnimTask_LoadHealthboxPalsForLevelUp: TaskFunc = (taskId) => {
  DoLoadHealthboxPalsForLevelUp(anim.attacker);
  DestroyAnimVisualTask(taskId);
};

/** DoFreeHealthboxPalsForLevelUp */
export function DoFreeHealthboxPalsForLevelUp(battler: number): void {
  const healthBoxSpriteId = g.healthboxSpriteIds[battler];
  const spriteId1 = gSprites[healthBoxSpriteId].oam.affineParam;
  const spriteId2 = gSprites[healthBoxSpriteId].data[5];
  FreeSpritePaletteByTag(K.TAG_HEALTHBOX_PALS_1);
  FreeSpritePaletteByTag(K.TAG_HEALTHBOX_PALS_2);
  const paletteId1 = IndexOfSpritePaletteTag(K.TAG_HEALTHBOX_PAL);
  const paletteId2 = IndexOfSpritePaletteTag(K.TAG_HEALTHBAR_PAL);
  gSprites[healthBoxSpriteId].oam.paletteNum = paletteId1;
  gSprites[spriteId1].oam.paletteNum = paletteId1;
  gSprites[spriteId2].oam.paletteNum = paletteId2;
}

const AnimTask_FreeHealthboxPalsForLevelUp: TaskFunc = (taskId) => {
  DoFreeHealthboxPalsForLevelUp(anim.attacker);
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_FlashHealthboxOnLevelUp. Args: which colour (0 = colour 6, else 2), delay. */
const AnimTask_FlashHealthboxOnLevelUp: TaskFunc = (taskId) => {
  gTasks[taskId].data[10] = gBattleAnimArgs[0];
  gTasks[taskId].data[11] = gBattleAnimArgs[1];
  gTasks[taskId].func = AnimTask_FlashHealthboxOnLevelUp_Step;
};

const AnimTask_FlashHealthboxOnLevelUp_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0]++;
  if (d[0]++ >= d[11]) {
    d[0] = 0;
    const paletteNum = IndexOfSpritePaletteTag(K.TAG_HEALTHBOX_PALS_1);
    const colorOffset = d[10] === 0 ? 6 : 2;
    switch (d[1]) {
      case 0:
        d[2] += 2;
        if (d[2] > 16) d[2] = 16;
        BlendPalette(OBJ_PLTT_ID(paletteNum) + colorOffset, 1, d[2], RGB(20, 27, 31));
        if (d[2] === 16) d[1]++;
        break;
      case 1:
        d[2] -= 2;
        if (d[2] < 0) d[2] = 0;
        BlendPalette(OBJ_PLTT_ID(paletteNum) + colorOffset, 1, d[2], RGB(20, 27, 31));
        if (d[2] === 0) DestroyAnimVisualTask(taskId);
        break;
    }
  }
};

// ------------------------------------------------------------------ switch out

/** AnimTask_SwitchOutShrinkMon: the attacker grows small (scale up = smaller) and disappears */
const AnimTask_SwitchOutShrinkMon: TaskFunc = (taskId) => {
  const spriteId = g.battlerSpriteIds[anim.attacker];
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      PrepareBattlerSpriteForRotScale(spriteId, 0);
      d[10] = 0x100;
      d[0]++;
      break;
    case 1:
      d[10] += 0x30;
      SetSpriteRotScale(spriteId, d[10], d[10], 0);
      SetBattlerSpriteYOffsetFromYScale(spriteId);
      if (d[10] >= 0x2d0) d[0]++;
      break;
    case 2:
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].invisible = true;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

const battlerBallItem = (battler: number) => (getBattlerSide(battler) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty)[g.battlerPartyIndexes[battler]]?.pokeball ?? K.ITEM_POKE_BALL;

/** AnimTask_SwitchOutBallEffect: the mon's ball opens and the mon fades to the ball's colour */
const AnimTask_SwitchOutBallEffect: TaskFunc = (taskId) => {
  const spriteId = g.battlerSpriteIds[anim.attacker];
  const ballId = ItemIdToBallId(battlerBallItem(anim.attacker));
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      const x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X);
      const y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y);
      d[10] = AnimateBallOpenParticles(x, y + 32, gSprites[spriteId].oam.priority, gSprites[spriteId].subpriority, ballId);
      d[11] = LaunchBallFadeMonTask(false, anim.attacker, GetBattlePalettesMask(true, false, false, false, false, false, false), ballId);
      d[0]++;
      break;
    }
    case 1:
      if (!gTasks[d[10]].isActive && !gTasks[d[11]].isActive) DestroyAnimVisualTask(taskId);
      break;
  }
};

// ------------------------------------------------------------------ the ball throw

const AnimTask_LoadBallGfx: TaskFunc = (taskId) => {
  LoadBallGfx(ItemIdToBallId(g.lastUsedItem));
  DestroyAnimVisualTask(taskId);
};

const AnimTask_FreeBallGfx: TaskFunc = (taskId) => {
  FreeBallGfx(ItemIdToBallId(g.lastUsedItem));
  DestroyAnimVisualTask(taskId);
};

const AnimTask_IsBallBlockedByTrainerOrDodged: TaskFunc = (taskId) => {
  const caseId = sbd().animationData.ballThrowCaseId;
  gBattleAnimArgs[ARG_RET_ID] = caseId === K.BALL_TRAINER_BLOCK ? -1 : caseId === K.BALL_GHOST_DODGE ? -2 : 0;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_ThrowBall: the ball (thrown from off-screen left) flies to the target */
const AnimTask_ThrowBall: TaskFunc = (taskId) => {
  const ballId = ItemIdToBallId(g.lastUsedItem);
  const spriteId = CreateSprite(gBallSpriteTemplates()[ballId], 32, 80, 29);
  const s = gSprites[spriteId];
  s.data[0] = 34;
  s.data[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  s.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) - 16;
  s.callback = SpriteCB_ThrowBall_Init;
  sbd().animationData.wildMonInvisible = +gSprites[g.battlerSpriteIds[anim.target]].invisible;
  gTasks[taskId].data[0] = spriteId;
  gTasks[taskId].func = AnimTask_ThrowBall_WaitAnimObjComplete;
};

const AnimTask_ThrowBall_WaitAnimObjComplete: TaskFunc = (taskId) => {
  if (u16(gSprites[gTasks[taskId].data[0]].data[0]) === 0xffff) DestroyAnimVisualTask(taskId);
};

/** AnimTask_ThrowBallSpecial: the player's (or the old man's) back sprite throws the ball */
const AnimTask_ThrowBallSpecial: TaskFunc = (taskId) => {
  let x: number;
  let y: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL) {
    x = 28;
    y = 11;
  } else {
    x = 23;
    y = 11;
    if (ui.playerGender() === K.FEMALE) y = 13;
  }
  const ballId = ItemIdToBallId(g.lastUsedItem);
  const subpriority = GetBattlerSpriteSubpriority(getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT)) + 1;
  const spriteId = CreateSprite(gBallSpriteTemplates()[ballId], x | 32, y | 80, subpriority);
  const s = gSprites[spriteId];
  s.data[0] = 34;
  s.data[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  s.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) - 16;
  s.callback = SpriteCallbackDummy;
  gSprites[g.battlerSpriteIds[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)]].callback = SpriteCB_PlayerThrowInit;
  gTasks[taskId].data[0] = spriteId;
  gTasks[taskId].func = AnimTask_ThrowBallSpecial_PlaySfx;
};

const AnimTask_ThrowBallSpecial_PlaySfx: TaskFunc = (taskId) => {
  if (gSprites[g.battlerSpriteIds[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)]].animCmdIndex === 1) {
    PlaySE12WithPanning(K.SE_BALL_THROW, 0);
    gSprites[gTasks[taskId].data[0]].callback = SpriteCB_ThrowBall_Init;
    CreateTask(AnimTask_ThrowBallSpecial_ResetPlayerSprite, 10);
    gTasks[taskId].func = AnimTask_ThrowBall_WaitAnimObjComplete;
  }
};

const AnimTask_ThrowBallSpecial_ResetPlayerSprite: TaskFunc = (taskId) => {
  const player = gSprites[g.battlerSpriteIds[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)]];
  if (player.animEnded) {
    StartSpriteAnim(player, 0);
    DestroyTask(taskId);
  }
};

function SpriteCB_ThrowBall_Init(sprite: Sprite): void {
  const destX = u16(sprite.data[1]);
  const destY = u16(sprite.data[2]);
  sprite.data[1] = sprite.x;
  sprite.data[2] = destX;
  sprite.data[3] = sprite.y;
  sprite.data[4] = destY;
  sprite.data[5] = -40;
  InitAnimArcTranslation(sprite);
  sprite.callback = SpriteCB_ThrowBall_ArcFlight;
}

function SpriteCB_ThrowBall_ArcFlight(sprite: Sprite): void {
  if (!TranslateAnimHorizontalArc(sprite)) return;
  const caseId = sbd().animationData.ballThrowCaseId;
  if (caseId === K.BALL_TRAINER_BLOCK) {
    sprite.callback = TrainerBallBlock;
  } else if (caseId === K.BALL_GHOST_DODGE) {
    sprite.callback = GhostBallDodge;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.x2 = 0;
    sprite.y2 = 0;
    sprite.data.fill(0);
    sprite.callback = SpriteCB_ThrowBall_TenFrameDelay;
    const ballId = ItemIdToBallId(g.lastUsedItem);
    if (ballId >= 0 && ballId < K.POKEBALL_COUNT) {
      AnimateBallOpenParticles(sprite.x, sprite.y - 5, 1, 28, ballId);
      LaunchBallFadeMonTask(false, anim.target, 14, ballId);
    }
  }
}

function SpriteCB_ThrowBall_TenFrameDelay(sprite: Sprite): void {
  if (++sprite.data[5] === 10) {
    sprite.data[5] = CreateTask(TaskDummy, 50);
    sprite.callback = SpriteCB_ThrowBall_ShrinkMon;
    gSprites[g.battlerSpriteIds[anim.target]].data[1] = 0;
  }
}

/** The target shrinks into the ball (the task holds the state, as in the C) */
function SpriteCB_ThrowBall_ShrinkMon(sprite: Sprite): void {
  const spriteId = g.battlerSpriteIds[anim.target];
  const taskId = sprite.data[5] & 0xff;
  const d = gTasks[taskId].data;
  if (++d[1] === 11) PlaySE(K.SE_BALL_TRADE);
  switch (d[0]) {
    case 0:
      PrepareBattlerSpriteForRotScale(spriteId, 0);
      d[10] = 256;
      gMonShrinkDuration = 28;
      gMonShrinkDistance = u16(gSprites[spriteId].y + gSprites[spriteId].y2 - (sprite.y + sprite.y2));
      gMonShrinkDelta = u16(Math.trunc((gMonShrinkDistance * 256) / gMonShrinkDuration));
      d[2] = gMonShrinkDelta;
      d[0]++;
      break;
    case 1:
      d[10] += 0x20;
      SetSpriteRotScale(spriteId, d[10], d[10], 0);
      d[3] += d[2];
      gSprites[spriteId].y2 = -d[3] >> 8;
      if (d[10] >= 0x480) d[0]++;
      break;
    case 2:
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].invisible = true;
      d[0]++;
      break;
    default:
      if (d[1] > 10) {
        DestroyTask(taskId);
        StartSpriteAnim(sprite, 2);
        sprite.data[5] = 0;
        sprite.callback = SpriteCB_ThrowBall_InitialFall;
      }
      break;
  }
}

function SpriteCB_ThrowBall_InitialFall(sprite: Sprite): void {
  if (sprite.animEnded) {
    sprite.data[3] = 0;
    sprite.data[4] = 40;
    sprite.data[5] = 0;
    sprite.y += Cos(0, 40);
    sprite.y2 = -Cos(0, sprite.data[4]);
    sprite.callback = SpriteCB_ThrowBall_Bounce;
  }
}

/** Four bounces, each lower, with their own SE */
function SpriteCB_ThrowBall_Bounce(sprite: Sprite): void {
  const d = sprite.data;
  let lastBounce = false;
  switch (d[3] & 0xff) {
    case 0:
      sprite.y2 = -Cos(d[5], d[4]);
      d[5] += (d[3] >> 8) + 4;
      if (d[5] >= 64) {
        d[4] -= 10;
        d[3] += 257;
        const bounceCount = d[3] >> 8;
        if (bounceCount === 4) lastBounce = true;
        PlaySE([K.SE_BALL_BOUNCE_1, K.SE_BALL_BOUNCE_2, K.SE_BALL_BOUNCE_3][bounceCount - 1] ?? K.SE_BALL_BOUNCE_4);
      }
      break;
    case 1:
      sprite.y2 = -Cos(d[5], d[4]);
      d[5] -= (d[3] >> 8) + 4;
      if (d[5] <= 0) {
        d[5] = 0;
        d[3] &= ~0xff;
      }
      break;
  }
  if (lastBounce) {
    d[3] = 0;
    sprite.y += Cos(64, 40);
    sprite.y2 = 0;
    if (sbd().animationData.ballThrowCaseId === K.BALL_NO_SHAKES) {
      d[5] = 0;
      sprite.callback = SpriteCB_ThrowBall_DelayThenBreakOut;
    } else {
      sprite.callback = SpriteCB_ThrowBall_InitShake;
      d[4] = 1;
      d[5] = 0;
    }
  }
}

function SpriteCB_ThrowBall_InitShake(sprite: Sprite): void {
  if (++sprite.data[3] === 31) {
    sprite.data[3] = 0;
    sprite.affineAnimPaused = true;
    StartSpriteAffineAnim(sprite, 1);
    sbd().animationData.ballSubpx = 0;
    sprite.callback = SpriteCB_ThrowBall_DoShake;
    PlaySE(K.SE_BALL);
  }
}

/** One step of the ball's sub-pixel wobble (shared by the shake phases) */
function shakeStep(sprite: Sprite, half: number): void {
  const ad = sbd().animationData;
  if (ad.ballSubpx > 0xff) {
    sprite.x2 += sprite.data[4];
    ad.ballSubpx &= 0xff;
  } else {
    ad.ballSubpx += 0xb0;
  }
  sprite.data[5]++;
  sprite.affineAnimPaused = false;
  if (u16(sprite.data[5] + half) > half * 2) {
    ad.ballSubpx = 0;
    sprite.data[3]++;
    sprite.data[5] = 0;
  }
}

function SpriteCB_ThrowBall_DoShake(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[3] & 0xff) {
    case 0:
      shakeStep(sprite, 7);
      break;
    case 1:
      if (++d[5] === 1) {
        d[5] = 0;
        d[4] = -d[4];
        d[3]++;
        sprite.affineAnimPaused = false;
        ChangeSpriteAffineAnim(sprite, d[4] < 0 ? 2 : 1);
      } else {
        sprite.affineAnimPaused = true;
      }
      break;
    case 2:
      shakeStep(sprite, 12);
      break;
    case 3:
      if (d[5]++ < 0) {
        sprite.affineAnimPaused = true;
        break;
      }
      d[5] = 0;
      d[4] = -d[4];
      d[3]++;
      sprite.affineAnimPaused = false;
      ChangeSpriteAffineAnim(sprite, d[4] < 0 ? 2 : 1);
    // fallthrough
    case 4: {
      const before = d[3];
      shakeStep(sprite, 4);
      if (d[3] !== before) d[4] = -d[4];
      break;
    }
    case 5: {
      d[3] += 0x100;
      const state = s8(d[3] >> 8);
      const caseId = sbd().animationData.ballThrowCaseId;
      if (state === caseId) {
        sprite.affineAnimPaused = true;
        sprite.callback = SpriteCB_ThrowBall_DelayThenBreakOut;
      } else if (caseId === K.BALL_3_SHAKES_SUCCESS && state === 3) {
        sprite.callback = SpriteCB_ThrowBall_InitClick;
        sprite.affineAnimPaused = true;
      } else {
        d[3]++;
        sprite.affineAnimPaused = true;
      }
      break;
    }
    case 6:
    default:
      if (++d[5] === 31) {
        d[5] = 0;
        d[3] &= ~0xff;
        StartSpriteAffineAnim(sprite, 3);
        StartSpriteAffineAnim(sprite, d[4] < 0 ? 2 : 1);
        PlaySE(K.SE_BALL);
      }
      break;
  }
}

function SpriteCB_ThrowBall_DelayThenBreakOut(sprite: Sprite): void {
  if (++sprite.data[5] === 31) {
    sprite.data[5] = 0;
    sprite.callback = SpriteCB_ThrowBall_BeginBreakOut;
  }
}

function SpriteCB_ThrowBall_InitClick(sprite: Sprite): void {
  sprite.animPaused = true;
  sprite.callback = SpriteCB_ThrowBall_DoClick;
  sprite.data[3] = 0;
  sprite.data[4] = 0;
  sprite.data[5] = 0;
}

/** Caught: the click, stars, darkening, then the target's sprite goes */
function SpriteCB_ThrowBall_DoClick(sprite: Sprite): void {
  sprite.data[4]++;
  if (sprite.data[4] === 40) {
    PlaySE(K.SE_BALL_CLICK);
    BlendPalettes((0x10000 << sprite.oam.paletteNum) >>> 0, 6, RGB_BLACK);
    CreateStarsWhenBallClicks(sprite);
  } else if (sprite.data[4] === 60) {
    BeginNormalPaletteFade((0x10000 << sprite.oam.paletteNum) >>> 0, 2, 6, 0, RGB_BLACK);
  } else if (sprite.data[4] === 95) {
    g.doingBattleAnim = false;
    UpdateOamPriorityInAllHealthboxes(1);
    m4aMPlayAllStop();
    PlaySE(K.MUS_CAUGHT_INTRO);
  } else if (sprite.data[4] === 315) {
    const target = gSprites[g.battlerSpriteIds[anim.target]];
    FreeOamMatrix(target.oam.matrixNum);
    DestroySprite(target);
    sprite.data[0] = 0;
    sprite.callback = SpriteCB_ThrowBall_FinishClick;
  }
}

function SpriteCB_ThrowBall_FinishClick(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0: {
      d[1] = 0;
      d[2] = 0;
      sprite.oam.objMode = 1; // ST_OAM_OBJ_BLEND
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
      const paletteIndex = IndexOfSpritePaletteTag(sprite.template.paletteTag);
      BeginNormalPaletteFade((1 << (paletteIndex + 0x10)) >>> 0, 0, 0, 16, RGB_WHITE);
      d[0]++;
      break;
    }
    case 1:
      if (d[1]++ > 0) {
        d[1] = 0;
        d[2]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[2], d[2]));
        if (d[2] === 16) d[0]++;
      }
      break;
    case 2:
      sprite.invisible = true;
      d[0]++;
      break;
    default:
      if (!gPaletteFade.active) {
        SetGpuReg(REG_OFFSET_BLDCNT, 0);
        SetGpuReg(REG_OFFSET_BLDALPHA, 0);
        d[0] = 0;
        sprite.callback = BattleAnimObj_SignalEnd;
      }
      break;
  }
}

/** BattleAnimObj_SignalEnd: data[0] = -1 tells AnimTask_ThrowBall_WaitAnimObjComplete, then it goes */
function BattleAnimObj_SignalEnd(sprite: Sprite): void {
  if (sprite.data[0] === 0) {
    sprite.data[0] = -1;
  } else {
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
  }
}

function CreateStarsWhenBallClicks(sprite: Sprite): void {
  let subpriority: number;
  if (sprite.subpriority) {
    subpriority = sprite.subpriority - 1;
  } else {
    subpriority = 0;
    sprite.subpriority = 1;
  }
  LoadBallParticleGfx(K.BALL_MASTER);
  for (const star of sCaptureStar) {
    const spriteId = CreateSprite(sBallParticlesSpriteTemplate(K.BALL_MASTER), sprite.x, sprite.y, subpriority);
    if (spriteId !== MAX_SPRITES) {
      const s = gSprites[spriteId];
      s.data[0] = 24;
      s.data[2] = sprite.x + star.xOffset;
      s.data[4] = sprite.y + star.yOffset;
      s.data[5] = star.amplitude;
      InitAnimArcTranslation(s);
      s.callback = SpriteCB_BallCaptureSuccessStar;
      StartSpriteAnim(s, sBallParticleAnimNums[K.BALL_MASTER]);
    }
  }
}

function SpriteCB_BallCaptureSuccessStar(sprite: Sprite): void {
  sprite.invisible = !sprite.invisible;
  if (TranslateAnimHorizontalArc(sprite)) DestroySprite(sprite);
}

/** Not caught: the ball opens and the target grows back out of it */
function SpriteCB_ThrowBall_BeginBreakOut(sprite: Sprite): void {
  StartSpriteAnim(sprite, 1);
  StartSpriteAffineAnim(sprite, 0);
  sprite.callback = SpriteCB_ThrowBall_RunBreakOut;
  const ballId = ItemIdToBallId(g.lastUsedItem);
  if (ballId >= 0 && ballId < K.POKEBALL_COUNT) {
    AnimateBallOpenParticles(sprite.x, sprite.y - 5, 1, 28, ballId);
    LaunchBallFadeMonTask(true, anim.target, 14, ballId);
  }
  const target = gSprites[g.battlerSpriteIds[anim.target]];
  target.invisible = false;
  StartSpriteAffineAnim(target, 1);
  AnimateSprite(target);
  target.data[1] = 0x1000;
}

function SpriteCB_ThrowBall_RunBreakOut(sprite: Sprite): void {
  let next = false;
  const target = gSprites[g.battlerSpriteIds[anim.target]];
  if (sprite.animEnded) sprite.invisible = true;
  if (target.affineAnimEnded) {
    StartSpriteAffineAnim(target, 0);
    next = true;
  } else {
    target.data[1] -= 288;
    target.y2 = target.data[1] >> 8;
  }
  if (sprite.animEnded && next) {
    target.y2 = 0;
    target.invisible = !!sbd().animationData.wildMonInvisible;
    sprite.data[0] = 0;
    sprite.callback = BattleAnimObj_SignalEnd;
    g.doingBattleAnim = false;
    UpdateOamPriorityInAllHealthboxes(1);
  }
}

/** The trainer knocks the ball away */
function TrainerBallBlock(sprite: Sprite): void {
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
  sprite.data.fill(0, 0, 6);
  sprite.callback = TrainerBallBlock2;
}

function TrainerBallBlock2(sprite: Sprite): void {
  const var0 = ((sprite.data[0] + 0x800) << 16) >> 16;
  const var1 = ((sprite.data[1] + 0x680) << 16) >> 16;
  sprite.x2 -= var1 >> 8;
  sprite.y2 += var0 >> 8;
  sprite.data[0] = (sprite.data[0] + 0x800) & 0xff;
  sprite.data[1] = (sprite.data[1] + 0x680) & 0xff;
  if (sprite.y + sprite.y2 > 160 || sprite.x + sprite.x2 < -8) {
    sprite.data[0] = 0;
    sprite.callback = BattleAnimObj_SignalEnd;
    g.doingBattleAnim = false;
    UpdateOamPriorityInAllHealthboxes(1);
  }
}

/** The ghost dodges: the ball drops past it */
function GhostBallDodge(sprite: Sprite): void {
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  sprite.x2 = 0;
  sprite.y2 = 0;
  sprite.data[0] = 0x22;
  sprite.data[1] = sprite.x;
  sprite.data[2] = sprite.x - 8;
  sprite.data[3] = sprite.y;
  sprite.data[4] = 0x90;
  sprite.data[5] = 0x20;
  InitAnimArcTranslation(sprite);
  TranslateAnimVerticalArc(sprite);
  sprite.callback = GhostBallDodge2;
}

function GhostBallDodge2(sprite: Sprite): void {
  if (!TranslateAnimVerticalArc(sprite) && sprite.y + sprite.y2 < 65) return;
  sprite.data[0] = 0;
  sprite.callback = BattleAnimObj_SignalEnd;
  g.doingBattleAnim = false;
  UpdateOamPriorityInAllHealthboxes(1);
}

// ------------------------------------------------------------------ ball open particles

function LoadBallParticleGfx(ballId: number): void {
  const tag = TAG_PARTICLES(ballId);
  if (GetSpriteTileStartByTag(tag) === 0xffff) {
    LoadCompressedSpriteSheet({ data: gfx('gBattleAnimSpriteGfx_Particles'), size: 0x100, tag });
    LoadCompressedSpritePalette({ data: gfx16('gBattleAnimSpritePal_CircleImpact'), tag });
  }
}

/** AnimateBallOpenParticles: the ball's burst (each ball has its own pattern) */
export function AnimateBallOpenParticles(x: number, y: number, priority: number, subpriority: number, ballId: number): number {
  LoadBallParticleGfx(ballId);
  const taskId = CreateTask(sBallParticleAnimationFuncs[ballId], 5);
  const d = gTasks[taskId].data;
  d[1] = x & 0xff;
  d[2] = y & 0xff;
  d[3] = priority & 0xff;
  d[4] = subpriority & 0xff;
  d[15] = ballId;
  PlaySE(K.SE_BALL_OPEN);
  return taskId;
}

function IncrementBattleParticleCounter(): void {
  if (gMain.inBattle) sbd().animationData.numBallParticles++;
}

interface FanOut {
  count: number;
  spacing: number;
  speed: number;
  dx: number;
  dy: number;
}

/** The burst functions that create all their particles at once and fan them out */
function fanOutTask(params: FanOut[], callback: SpriteCallback = FanOutBallOpenParticles_Step1): TaskFunc {
  return (taskId) => {
    const d = gTasks[taskId].data;
    const ballId = d[15];
    let spriteId = MAX_SPRITES;
    for (const p of params) {
      for (let i = 0; i < p.count; i++) {
        spriteId = CreateSprite(sBallParticlesSpriteTemplate(ballId), d[1], d[2], d[4]);
        if (spriteId !== MAX_SPRITES) {
          const s = gSprites[spriteId];
          IncrementBattleParticleCounter();
          StartSpriteAnim(s, sBallParticleAnimNums[ballId]);
          s.callback = callback;
          s.oam.priority = d[3];
          s.data[0] = i * p.spacing;
          if (callback === FanOutBallOpenParticles_Step1) {
            s.data[4] = p.speed;
            s.data[5] = p.dx;
            s.data[6] = p.dy;
          }
        }
      }
    }
    if (!gMain.inBattle) gSprites[spriteId].data[7] = 1;
    DestroyTask(taskId);
  };
}

const PokeBallOpenParticleAnimation: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const ballId = d[15];
  if (d[0] < 16) {
    const spriteId = CreateSprite(sBallParticlesSpriteTemplate(ballId), d[1], d[2], d[4]);
    if (spriteId !== MAX_SPRITES) {
      IncrementBattleParticleCounter();
      StartSpriteAnim(gSprites[spriteId], sBallParticleAnimNums[ballId]);
      gSprites[spriteId].callback = PokeBallOpenParticleAnimation_Step1;
      gSprites[spriteId].oam.priority = d[3];
      let var0 = d[0] & 0xff;
      if (var0 >= 8) var0 -= 8;
      gSprites[spriteId].data[0] = var0 * 32;
    }
    if (d[0] === 15) {
      if (!gMain.inBattle) gSprites[spriteId].data[7] = 1;
      DestroyTask(taskId);
      return;
    }
  }
  d[0]++;
};

function PokeBallOpenParticleAnimation_Step1(sprite: Sprite): void {
  if (sprite.data[1] === 0) sprite.callback = PokeBallOpenParticleAnimation_Step2;
  else sprite.data[1]--;
}

function PokeBallOpenParticleAnimation_Step2(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[0], sprite.data[1]);
  sprite.y2 = Cos(sprite.data[0], sprite.data[1]);
  sprite.data[1] += 2;
  if (sprite.data[1] === 50) DestroyBallOpenAnimationParticle(sprite);
}

const TimerBallOpenParticleAnimation = fanOutTask([{ count: 8, spacing: 32, speed: 10, dx: 2, dy: 1 }]);
const DiveBallOpenParticleAnimation = fanOutTask([{ count: 8, spacing: 32, speed: 10, dx: 1, dy: 2 }]);
/** Also used for the Net Ball */
const SafariBallOpenParticleAnimation = fanOutTask([{ count: 8, spacing: 32, speed: 4, dx: 1, dy: 1 }]);
/** Also used for the Nest Ball */
const UltraBallOpenParticleAnimation = fanOutTask([{ count: 10, spacing: 25, speed: 5, dx: 1, dy: 1 }]);
const MasterBallOpenParticleAnimation = fanOutTask([
  { count: 8, spacing: 32, speed: 8, dx: 2, dy: 1 },
  { count: 8, spacing: 32, speed: 8, dx: 1, dy: 2 },
]);
const RepeatBallOpenParticleAnimation = fanOutTask([{ count: 12, spacing: 21, speed: 0, dx: 0, dy: 0 }], RepeatBallOpenParticleAnimation_Step1);
const PremierBallOpenParticleAnimation = fanOutTask([{ count: 8, spacing: 32, speed: 0, dx: 0, dy: 0 }], PremierBallOpenParticleAnimation_Step1);

/** Also used for the Luxury Ball: two waves, 8 frames apart */
const GreatBallOpenParticleAnimation: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[7]) {
    d[7]--;
    return;
  }
  const ballId = d[15];
  let spriteId = MAX_SPRITES;
  for (let i = 0; i < 8; i++) {
    spriteId = CreateSprite(sBallParticlesSpriteTemplate(ballId), d[1], d[2], d[4]);
    if (spriteId !== MAX_SPRITES) {
      const s = gSprites[spriteId];
      IncrementBattleParticleCounter();
      StartSpriteAnim(s, sBallParticleAnimNums[ballId]);
      s.callback = FanOutBallOpenParticles_Step1;
      s.oam.priority = d[3];
      s.data[0] = i * 32;
      s.data[4] = 8;
      s.data[5] = 2;
      s.data[6] = 2;
    }
  }
  d[7] = 8;
  if (++d[0] === 2) {
    if (!gMain.inBattle) gSprites[spriteId].data[7] = 1;
    DestroyTask(taskId);
  }
};

function FanOutBallOpenParticles_Step1(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], d[1]);
  sprite.y2 = Cos(d[0], d[2]);
  d[0] = (d[0] + d[4]) & 0xff;
  d[1] += d[5];
  d[2] += d[6];
  if (++d[3] === 51) DestroyBallOpenAnimationParticle(sprite);
}

function RepeatBallOpenParticleAnimation_Step1(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], d[1]);
  sprite.y2 = Cos(d[0], Sin(d[0], d[2]));
  d[0] = (d[0] + 6) & 0xff;
  d[1]++;
  d[2]++;
  if (++d[3] === 51) DestroyBallOpenAnimationParticle(sprite);
}

function PremierBallOpenParticleAnimation_Step1(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], d[1]);
  sprite.y2 = Cos(d[0], Sin(d[0] & 0x3f, d[2]));
  d[0] = (d[0] + 10) & 0xff;
  d[1]++;
  d[2]++;
  if (++d[3] === 51) DestroyBallOpenAnimationParticle(sprite);
}

/** sBallParticleAnimationFuncs */
const sBallParticleAnimationFuncs: TaskFunc[] = [
  PokeBallOpenParticleAnimation, // BALL_POKE
  GreatBallOpenParticleAnimation, // BALL_GREAT
  SafariBallOpenParticleAnimation, // BALL_SAFARI
  UltraBallOpenParticleAnimation, // BALL_ULTRA
  MasterBallOpenParticleAnimation, // BALL_MASTER
  SafariBallOpenParticleAnimation, // BALL_NET
  DiveBallOpenParticleAnimation, // BALL_DIVE
  UltraBallOpenParticleAnimation, // BALL_NEST
  RepeatBallOpenParticleAnimation, // BALL_REPEAT
  TimerBallOpenParticleAnimation, // BALL_TIMER
  GreatBallOpenParticleAnimation, // BALL_LUXURY
  PremierBallOpenParticleAnimation, // BALL_PREMIER
];

function DestroyBallOpenAnimationParticle(sprite: Sprite): void {
  if (!gMain.inBattle) {
    if (sprite.data[7] === 1) DestroySpriteAndFreeResources(sprite);
    else DestroySprite(sprite);
    return;
  }
  sbd().animationData.numBallParticles--;
  if (sbd().animationData.numBallParticles === 0) {
    for (let j = 0; j < K.POKEBALL_COUNT; j++) {
      FreeSpriteTilesByTag(TAG_PARTICLES(j));
      FreeSpritePaletteByTag(TAG_PARTICLES(j));
    }
  }
  DestroySprite(sprite);
}

// ------------------------------------------------------------------ ball fade

/** LaunchBallFadeMonTask: the mon fades to the ball's colour (and back, when `unfadeLater`) */
export function LaunchBallFadeMonTask(unfadeLater: boolean, battler: number, selectedPalettes: number, ballId: number): number {
  const taskId = CreateTask(Task_FadeMon_ToBallColor, 5);
  const d = gTasks[taskId].data;
  d[15] = ballId;
  d[3] = battler;
  d[10] = selectedPalettes & 0xffff;
  d[11] = selectedPalettes >>> 16;
  if (!unfadeLater) {
    BlendPalette(OBJ_PLTT_ID(battler), 16, 0, sBallOpenFadeColors[ballId]);
    d[1] = 1;
  } else {
    BlendPalette(OBJ_PLTT_ID(battler), 16, 16, sBallOpenFadeColors[ballId]);
    d[0] = 16;
    d[1] = -1;
    gTasks[taskId].func = Task_FadeMon_ToNormal;
  }
  BeginNormalPaletteFade(selectedPalettes, 0, 0, 16, RGB_WHITE);
  return taskId;
}

const selected = (d: Int16Array) => ((d[10] & 0xffff) | ((d[11] & 0xffff) << 16)) >>> 0;

const Task_FadeMon_ToBallColor: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2] <= 16) {
    BlendPalette(OBJ_PLTT_ID(d[3]), 16, d[0], sBallOpenFadeColors[d[15]]);
    d[0] += d[1];
    d[2]++;
  } else if (!gPaletteFade.active) {
    BeginNormalPaletteFade(selected(d), 0, 16, 0, RGB_WHITE);
    DestroyTask(taskId);
  }
};

const Task_FadeMon_ToNormal: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) {
    BeginNormalPaletteFade(selected(gTasks[taskId].data), 0, 16, 0, RGB_WHITE);
    gTasks[taskId].func = Task_FadeMon_ToNormal_Step;
  }
};

const Task_FadeMon_ToNormal_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2] <= 16) {
    BlendPalette(OBJ_PLTT_ID(d[3]), 16, d[0], sBallOpenFadeColors[d[15]]);
    d[0] += d[1];
    d[2]++;
  } else {
    DestroyTask(taskId);
  }
};

// ------------------------------------------------------------------ substitute

/**
 * AnimTask_SwapMonSpriteToFromSubstitute: the attacker slides off-screen, its gfx swap (arg 0: TRUE =
 * the mon, FALSE = the substitute doll), and it slides back.
 */
const AnimTask_SwapMonSpriteToFromSubstitute: TaskFunc = (taskId) => {
  const spriteId = g.battlerSpriteIds[anim.attacker];
  const s = gSprites[spriteId];
  const d = gTasks[taskId].data;
  const opponent = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER;
  switch (d[10]) {
    case 0:
      d[11] = gBattleAnimArgs[0];
      d[0] += 0x500;
      if (opponent) s.x2 += d[0] >> 8;
      else s.x2 -= d[0] >> 8;
      d[0] &= 0xff;
      if ((s.x + s.x2 + 32) >>> 0 > 304) d[10]++;
      break;
    case 1:
      LoadBattleMonGfxAndAnimate(anim.attacker, !!d[11], spriteId);
      d[10]++;
      break;
    case 2: {
      let done = false;
      d[0] += 0x500;
      if (opponent) s.x2 -= d[0] >> 8;
      else s.x2 += d[0] >> 8;
      d[0] &= 0xff;
      if (opponent ? s.x2 <= 0 : s.x2 >= 0) {
        s.x2 = 0;
        done = true;
      }
      if (done) DestroyAnimVisualTask(taskId);
      break;
    }
  }
};

/** AnimTask_SubstituteFadeToInvisible: the doll on its anim BG fades out, then its tiles are cleared */
const AnimTask_SubstituteFadeToInvisible: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[15]) {
    case 0:
      // (compares the BG priority rank with B_POSITION_OPPONENT_LEFT, as the C does)
      if (GetBattlerSpriteBGPriorityRank(anim.attacker) === K.B_POSITION_OPPONENT_LEFT) SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      else SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
      d[15]++;
      break;
    case 1:
      if (d[1]++ > 1) {
        d[1] = 0;
        d[0]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16 - d[0], d[0]));
        if (d[0] === 16) d[15]++;
      }
      break;
    case 2: {
      const start = OBJ_VRAM0 + gSprites[g.battlerSpriteIds[anim.attacker]].oam.tileNum * TILE_SIZE_4BPP;
      vram.fill(0, start, start + 0x800);
      ClearBehindSubstituteBit(anim.attacker);
      DestroyAnimVisualTask(taskId);
      break;
    }
  }
};

const AnimTask_IsAttackerBehindSubstitute: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = sbd().battlerData[anim.attacker].behindSubstitute;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_SetTargetToEffectBattler: TaskFunc = (taskId) => {
  anim.target = g.effectBattler;
  DestroyAnimVisualTask(taskId);
};

// ------------------------------------------------------------------ shiny sparkles

/** TryShinyAnimation: sparkles around a shiny mon as it comes out (two tasks: circle and diagonal) */
export function TryShinyAnimation(battler: number, mon: Pokemon): void {
  let isShiny = false;
  sbd().healthBoxesData[battler].triedShinyMonAnim = 1;
  const otId = mon.otId >>> 0;
  const personality = mon.personality >>> 0;
  if (IsBattlerSpriteVisible(battler)) {
    const shinyValue = (otId >>> 16) ^ (otId & 0xffff) ^ (personality >>> 16) ^ (personality & 0xffff);
    if (shinyValue < K.SHINY_ODDS) isShiny = true;
    if (isShiny) {
      if (GetSpriteTileStartByTag(K.ANIM_TAG_GOLD_STARS) === 0xffff) LoadAnimSpriteGfx(K.ANIM_TAG_GOLD_STARS);
      const taskId1 = CreateTask(AnimTask_ShinySparkles, 10);
      const taskId2 = CreateTask(AnimTask_ShinySparkles, 10);
      gTasks[taskId1].data[0] = battler;
      gTasks[taskId2].data[0] = battler;
      gTasks[taskId1].data[1] = 0;
      gTasks[taskId2].data[1] = 1;
      return;
    }
  }
  sbd().healthBoxesData[battler].finishedShinyMonAnim = 1;
}

const AnimTask_ShinySparkles: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[13] < 60) {
    d[13]++;
    return;
  }
  if (sbd().animationData.numBallParticles) return;
  const counter = u16(d[10]++);
  if (counter & 3) return;
  const battler = d[0];
  const x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  const y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  const state = d[11];
  let spriteId: number;
  if (state === 0) {
    spriteId = CreateSprite(animSpriteTemplate('gWishStarSpriteTemplate', true)!, x, y, 5);
  } else if (state >= 0 && d[11] < 4) {
    spriteId = CreateSprite(animSpriteTemplate('gMiniTwinklingStarSpriteTemplate', true)!, x, y, 5);
    gSprites[spriteId].oam.tileNum += 4;
  } else {
    spriteId = CreateSprite(animSpriteTemplate('gMiniTwinklingStarSpriteTemplate', true)!, x, y, 5);
    gSprites[spriteId].oam.tileNum += 5;
  }
  const s = gSprites[spriteId];
  if (!d[1]) {
    s.callback = SpriteCB_ShinySparkles_1;
  } else {
    s.callback = SpriteCB_ShinySparkles_2;
    s.x2 = -32;
    s.y2 = 32;
    s.invisible = true;
    if (!d[11]) PlaySE12WithPanning(K.SE_SHINY, getBattlerSide(battler) === K.B_SIDE_PLAYER ? K.SOUND_PAN_ATTACKER : K.SOUND_PAN_TARGET);
  }
  s.data[0] = taskId;
  d[11]++;
  if (spriteId !== MAX_SPRITES) d[12]++;
  if (d[11] === 5) gTasks[taskId].func = AnimTask_ShinySparkles_WaitSparkles;
};

const AnimTask_ShinySparkles_WaitSparkles: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (!d[12]) {
    if (d[1] === 1) sbd().healthBoxesData[d[0]].finishedShinyMonAnim = 1;
    DestroyTask(taskId);
  }
};

function SpriteCB_ShinySparkles_1(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[1], 24);
  sprite.y2 = Cos(sprite.data[1], 24);
  sprite.data[1] += 12;
  if (sprite.data[1] > 0xff) {
    gTasks[sprite.data[0]].data[12]--;
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
  }
}

function SpriteCB_ShinySparkles_2(sprite: Sprite): void {
  if (sprite.data[1] < 4) {
    sprite.data[1]++;
  } else {
    sprite.invisible = false;
    sprite.x2 += 5;
    sprite.y2 -= 5;
    if (sprite.x2 > 32) {
      gTasks[sprite.data[0]].data[12]--;
      FreeSpriteOamMatrix(sprite);
      DestroySprite(sprite);
    }
  }
}

// ------------------------------------------------------------------ Safari Zone, misc

const AnimTask_LoadBaitGfx: TaskFunc = (taskId) => {
  LoadAnimSpriteGfx(K.ANIM_TAG_SAFARI_BAIT);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_FreeBaitGfx: TaskFunc = (taskId) => {
  FreeSpriteTilesByTag(K.ANIM_TAG_SAFARI_BAIT);
  FreeSpritePaletteByTag(K.ANIM_TAG_SAFARI_BAIT);
  DestroyAnimVisualTask(taskId);
};

/** SpriteCB_SafariBaitOrRock_Init: thrown by the player's back sprite at the wild mon. Args: x, y, x/y offset. */
const SpriteCB_SafariBaitOrRock_Init: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, false);
  const opp = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  sprite.data[0] = 30;
  sprite.data[2] = GetBattlerSpriteCoord(opp, K.BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(opp, K.BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.data[5] = -32;
  InitAnimArcTranslation(sprite);
  gSprites[g.battlerSpriteIds[anim.attacker]].callback = SpriteCB_PlayerThrowInit;
  sprite.callback = SpriteCB_SafariBaitOrRock_WaitPlayerThrow;
};

function SpriteCB_SafariBaitOrRock_WaitPlayerThrow(sprite: Sprite): void {
  if (gSprites[g.battlerSpriteIds[anim.attacker]].animCmdIndex === 1) sprite.callback = SpriteCB_SafariBaitOrRock_ArcFlight;
}

function SpriteCB_SafariBaitOrRock_ArcFlight(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.data[0] = 0;
    sprite.invisible = true;
    sprite.callback = SpriteCB_SafariBaitOrRock_Finish;
  }
}

function SpriteCB_SafariBaitOrRock_Finish(sprite: Sprite): void {
  const player = gSprites[g.battlerSpriteIds[anim.attacker]];
  if (player.animEnded && ++sprite.data[0] > 0) {
    StartSpriteAnim(player, 0);
    DestroyAnimSprite(sprite);
  }
}

/** AnimTask_SafariOrGhost_DecideAnimSides. Arg 0: 0 player -> foe, 1 foe -> player. */
const AnimTask_SafariOrGhost_DecideAnimSides: TaskFunc = (taskId) => {
  switch (gBattleAnimArgs[0]) {
    case 0:
      anim.attacker = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
      anim.target = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      break;
    case 1:
      anim.attacker = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      anim.target = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
      break;
  }
  DestroyAnimVisualTask(taskId);
};

const AnimTask_SafariGetReaction: TaskFunc = (taskId) => {
  const r = g.battleCommunication[K.MULTISTRING_CHOOSER];
  gBattleAnimArgs[7] = r >= K.NUM_SAFARI_REACTIONS ? 0 : r;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_GetTrappedMoveAnimId: TaskFunc = (taskId) => {
  const arg = sbd().animationData.animArg;
  if (arg === K.MOVE_FIRE_SPIN) gBattleAnimArgs[0] = K.TRAP_ANIM_FIRE_SPIN;
  else if (arg === K.MOVE_WHIRLPOOL) gBattleAnimArgs[0] = K.TRAP_ANIM_WHIRLPOOL;
  else if (arg === K.MOVE_CLAMP) gBattleAnimArgs[0] = K.TRAP_ANIM_CLAMP;
  else if (arg === K.MOVE_SAND_TOMB) gBattleAnimArgs[0] = K.TRAP_ANIM_SAND_TOMB;
  else gBattleAnimArgs[0] = K.TRAP_ANIM_BIND;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_GetBattlersFromArg: TaskFunc = (taskId) => {
  anim.attacker = sbd().animationData.animArg & 0xff;
  anim.target = (sbd().animationData.animArg >> 8) & 0xff;
  DestroyAnimVisualTask(taskId);
};

export const specialSpriteCallbacks: Record<string, SpriteCallback> = { SpriteCB_SafariBaitOrRock_Init };

export const specialTasks: Record<string, TaskFunc> = {
  AnimTask_LoadHealthboxPalsForLevelUp,
  AnimTask_FreeHealthboxPalsForLevelUp,
  AnimTask_FlashHealthboxOnLevelUp,
  AnimTask_SwitchOutShrinkMon,
  AnimTask_SwitchOutBallEffect,
  AnimTask_LoadBallGfx,
  AnimTask_FreeBallGfx,
  AnimTask_IsBallBlockedByTrainerOrDodged,
  AnimTask_ThrowBall,
  AnimTask_ThrowBallSpecial,
  AnimTask_SwapMonSpriteToFromSubstitute,
  AnimTask_SubstituteFadeToInvisible,
  AnimTask_IsAttackerBehindSubstitute,
  AnimTask_SetTargetToEffectBattler,
  AnimTask_LoadBaitGfx,
  AnimTask_FreeBaitGfx,
  AnimTask_SafariOrGhost_DecideAnimSides,
  AnimTask_SafariGetReaction,
  AnimTask_GetTrappedMoveAnimId,
  AnimTask_GetBattlersFromArg,
};

/** Graphics the special anims load in code: ball particles, shiny stars, Safari bait */
export function registerSpecialExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_SwitchOutBallEffect: ['gBattleAnimSpriteGfx_Particles', 'gBattleAnimSpritePal_CircleImpact'],
    AnimTask_ThrowBall: ['gBattleAnimSpriteGfx_Particles', 'gBattleAnimSpritePal_CircleImpact'],
    AnimTask_LoadBaitGfx: animTagGfx(K.ANIM_TAG_SAFARI_BAIT),
  });
}

/** Graphics TryShinyAnimation loads (not reached from a script) */
export function shinyGfxSymbols(): string[] {
  return animTagGfx(K.ANIM_TAG_GOLD_STARS);
}
