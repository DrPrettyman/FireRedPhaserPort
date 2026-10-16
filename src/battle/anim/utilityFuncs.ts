// battle_anim_utility_funcs.c: palette blends over battlers and the BG, the stat change animation
// (InitStatsChangeAnimation), mon traces, scrolling BG masks behind an OBJ window, and small tasks that
// read or set anim state.

import { gfx16 } from '../../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPCNT_OBJWIN_ON,
  GetGpuReg,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  SetGpuReg,
  SetGpuRegBits,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../../gba/hw';
import { BeginHardwarePaletteFade, BG_PLTT_ID, BlendPalette, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, LoadPalette, OBJ_PLTT_ID, PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import { DestroySprite, gSprites, IndexOfSpritePaletteTag, type Sprite } from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { gMonSpritesGfxPtr } from '../gfx';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  BATTLE_PARTNER,
  CloneBattlerSpriteWithBlend,
  CreateInvisibleSpriteCopy,
  DestroySpriteWithActiveSheet,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattleMonSpritePalettesMask,
  GetBattlePalettesMask,
  GetSpritePalIdxByBattler,
  InitBattleAnimBg,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  SetAnimBgAttribute,
  ToggleBg3Mode,
} from './animMons';
import { BattleAnimAdjustPanning2, PlaySE12WithPanning, ResetBattleAnimBg } from './battleAnim';
import { UnpackSelectedBattlePalettes } from './normal';
import { anim, ARG_RET_ID, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

const u16 = (v: number) => v & 0xffff;
const WININ_DEFAULT = WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR;
const WINOUT_NO_BG1 = WINOUT_WIN01_BG0 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR;
const WINOUT_DEFAULT = WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ | WINOUT_WINOBJ_CLR;

// BgCnt bits for the BG1CNT edits below
const BGCNT_PRIORITY = 3;
const BGCNT_CHARBASE = 3 << 2;
const BGCNT_OVERFLOW = 1 << 13;
const BGCNT_SCREENSIZE = 3 << 14;

/**
 * AnimTask_BlendBattleAnimPal: arg 0 bits 0-6 as UnpackSelectedBattlePalettes, bits 7-10 the
 * player left/right and enemy left/right battlers. Args 1-4: delay, start, end, color.
 */
const AnimTask_BlendBattleAnimPal: TaskFunc = (taskId) => {
  let selected = UnpackSelectedBattlePalettes(gBattleAnimArgs[0]);
  const a = gBattleAnimArgs[0];
  selected |= GetBattleMonSpritePalettesMask(!!((a >> 7) & 1), !!((a >> 8) & 1), !!((a >> 9) & 1), !!((a >> 10) & 1));
  StartBlendAnimSpriteColor(taskId, selected >>> 0);
};

/**
 * AnimTask_BlendBattleAnimPalExclude: blends the BG and battlers except: 0 attacker, 1 target,
 * 2 attacker and BG, 3 target and BG, 4 attacker and target, 5 none, 6 BG and attacker's partner,
 * 7 BG and target's partner.
 */
const AnimTask_BlendBattleAnimPalExclude: TaskFunc = (taskId) => {
  const animBattlers = [0, 0xff];
  let selected = UnpackSelectedBattlePalettes(1);
  switch (gBattleAnimArgs[0]) {
    case 2:
      selected = 0;
    // fallthrough
    case K.ANIM_ATTACKER:
      animBattlers[0] = anim.attacker;
      break;
    case 3:
      selected = 0;
    // fallthrough
    case K.ANIM_TARGET:
      animBattlers[0] = anim.target;
      break;
    case 4:
      animBattlers[0] = anim.attacker;
      animBattlers[1] = anim.target;
      break;
    case 5:
      animBattlers[0] = 0xff;
      break;
    case 6:
      selected = 0;
      animBattlers[0] = BATTLE_PARTNER(anim.attacker);
      break;
    case 7:
      selected = 0;
      animBattlers[0] = BATTLE_PARTNER(anim.target);
      break;
  }
  for (let battler = 0; battler < K.MAX_BATTLERS_COUNT; battler++) {
    if (battler !== animBattlers[0] && battler !== animBattlers[1] && IsBattlerSpriteVisible(battler)) selected |= 0x10000 << GetSpritePalIdxByBattler(battler);
  }
  StartBlendAnimSpriteColor(taskId, selected >>> 0);
};

/** AnimTask_SetCamouflageBlend: the blend color follows the battle terrain */
const AnimTask_SetCamouflageBlend: TaskFunc = (taskId) => {
  const selected = UnpackSelectedBattlePalettes(gBattleAnimArgs[0]);
  const colors: Record<number, number> = {
    [K.BATTLE_TERRAIN_GRASS]: RGB(12, 24, 2),
    [K.BATTLE_TERRAIN_LONG_GRASS]: RGB(0, 15, 2),
    [K.BATTLE_TERRAIN_SAND]: RGB(30, 24, 11),
    [K.BATTLE_TERRAIN_UNDERWATER]: RGB(0, 0, 18),
    [K.BATTLE_TERRAIN_WATER]: RGB(11, 22, 31),
    [K.BATTLE_TERRAIN_POND]: RGB(11, 22, 31),
    [K.BATTLE_TERRAIN_MOUNTAIN]: RGB(22, 16, 10),
    [K.BATTLE_TERRAIN_CAVE]: RGB(14, 9, 3),
    [K.BATTLE_TERRAIN_BUILDING]: RGB(31, 31, 31),
    [K.BATTLE_TERRAIN_PLAIN]: RGB(31, 31, 31),
  };
  if (g.battleTerrain in colors) gBattleAnimArgs[4] = colors[g.battleTerrain];
  StartBlendAnimSpriteColor(taskId, selected);
};

/** AnimTask_BlendParticle: by ANIM_TAG */
const AnimTask_BlendParticle: TaskFunc = (taskId) => {
  const paletteIndex = IndexOfSpritePaletteTag(u16(gBattleAnimArgs[0]));
  StartBlendAnimSpriteColor(taskId, (1 << (paletteIndex + 16)) >>> 0);
};

// StartBlendAnimSpriteColor: data[0..1] palette mask, [2] delay, [3] start, [4] end, [5] color,
// [9] timer, [10] current coeff
function StartBlendAnimSpriteColor(taskId: number, selectedPalettes: number): void {
  const d = gTasks[taskId].data;
  d[0] = selectedPalettes & 0xffff;
  d[1] = selectedPalettes >>> 16;
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[4] = gBattleAnimArgs[3];
  d[5] = gBattleAnimArgs[4];
  d[10] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_BlendSpriteColor_Step2;
  gTasks[taskId].func(taskId);
}

const AnimTask_BlendSpriteColor_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[9] === d[2]) {
    d[9] = 0;
    // `data[0] | (data[1] << 16)` sign-extends data[0], like the C
    let selected = (d[0] | (u16(d[1]) << 16)) >>> 0;
    let offset = 0;
    while (selected) {
      if (selected & 1) BlendPalette(offset, 16, d[10], u16(d[5]));
      offset += 0x10;
      selected >>>= 1;
    }
    if (d[10] < d[4]) d[10]++;
    else if (d[10] > d[4]) d[10]--;
    else DestroyAnimVisualTask(taskId);
  } else {
    d[9]++;
  }
};

/** AnimTask_HardwarePaletteFade */
const AnimTask_HardwarePaletteFade: TaskFunc = (taskId) => {
  BeginHardwarePaletteFade(gBattleAnimArgs[0] & 0xff, gBattleAnimArgs[1], gBattleAnimArgs[2], gBattleAnimArgs[3], gBattleAnimArgs[4]);
  gTasks[taskId].func = AnimTask_HardwarePaletteFade_Step;
};

const AnimTask_HardwarePaletteFade_Step: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) DestroyAnimVisualTask(taskId);
};

// AnimTask_TraceMonBlended (Agility, Quick Attack): blended copies left behind. Args: battler, delay
// between traces, trace lifetime, traces.
const AnimTask_TraceMonBlended: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = 0;
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[2];
  d[4] = gBattleAnimArgs[3];
  d[5] = 0;
  gTasks[taskId].func = AnimTask_TraceMonBlended_Step;
};

const AnimTask_TraceMonBlended_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[4]) {
    if (d[1]) {
      d[1]--;
    } else {
      d[6] = CloneBattlerSpriteWithBlend(d[0]);
      if (d[6] >= 0) {
        const s = gSprites[d[6]];
        s.oam.priority = d[0] ? 1 : 2;
        s.data[0] = d[3];
        s.data[1] = taskId;
        s.data[2] = 5;
        s.callback = AnimMonTrace;
        d[5]++;
      }
      d[4]--;
      d[1] = d[2];
    }
  } else if (d[5] === 0) {
    DestroyAnimVisualTask(taskId);
  }
};

function AnimMonTrace(sprite: Sprite): void {
  if (sprite.data[0]) {
    sprite.data[0]--;
  } else {
    gTasks[sprite.data[1]].data[sprite.data[2]]--;
    DestroySpriteWithActiveSheet(sprite);
  }
}

/** Begins the BG1-behind-an-OBJ-window setup the stat change, Curse and scrolling masks share. */
function beginObjWindowBg1(blendAlpha: number): void {
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_NO_BG1);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_TGT2_ALL | BLDCNT_EFFECT_BLEND);
  SetGpuReg(REG_OFFSET_BLDALPHA, blendAlpha);
}

function endObjWindowBg1(): void {
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  SetGpuReg(REG_OFFSET_WININ, WININ_DEFAULT);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_DEFAULT);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 0);
  SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) ^ DISPCNT_OBJWIN_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
}

const battlerSpecies = (battler: number) => (getBattlerSide(battler) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty)[g.battlerPartyIndexes[battler]]?.species ?? 0;
const sRgbWhite = [RGB(31, 31, 31)];

/** AnimTask_DrawFallingWhiteLinesOnAttacker: Curse used by a non-Ghost */
const AnimTask_DrawFallingWhiteLinesOnAttacker: TaskFunc = (taskId) => {
  let var0 = 0;
  beginObjWindowBg1(BLDALPHA_BLEND(8, 12));
  let bg1Cnt = GetGpuReg(0xa) & ~(BGCNT_PRIORITY | BGCNT_SCREENSIZE);
  SetGpuReg(0xa, bg1Cnt);
  bg1Cnt = (bg1Cnt & ~BGCNT_CHARBASE) | (1 << 2);
  SetGpuReg(0xa, bg1Cnt);
  if (IsDoubleBattle()) {
    const pos = getBattlerPosition(anim.attacker);
    if ((pos === K.B_POSITION_OPPONENT_RIGHT || pos === K.B_POSITION_PLAYER_LEFT) && IsBattlerSpriteVisible(BATTLE_PARTNER(anim.attacker))) {
      gSprites[g.battlerSpriteIds[BATTLE_PARTNER(anim.attacker)]].oam.priority -= 1;
      SetGpuReg(0xa, (bg1Cnt & ~BGCNT_PRIORITY) | 1);
      var0 = 1;
    }
  }
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  const newSpriteId = CreateInvisibleSpriteCopy(anim.attacker, spriteId, battlerSpecies(anim.attacker));
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, 'gFile_graphics_battle_anims_masks_curse_tilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gFile_graphics_battle_anims_masks_curse_sheet', animBg.tilesOffset);
  LoadPalette(sRgbWhite, BG_PLTT_ID(animBg.paletteId) + 1, 2);
  g.battle_BG1_X = -gSprites[spriteId].x + 32;
  g.battle_BG1_Y = -gSprites[spriteId].y + 32;
  gTasks[taskId].data[0] = newSpriteId;
  gTasks[taskId].data[6] = var0;
  gTasks[taskId].func = AnimTask_DrawFallingWhiteLinesOnAttacker_Step;
};

const AnimTask_DrawFallingWhiteLinesOnAttacker_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[10] += 4;
  g.battle_BG1_Y -= 4;
  if (d[10] === 64) {
    d[10] = 0;
    g.battle_BG1_Y += 64;
    if (++d[11] === 4) {
      ResetBattleAnimBg(false);
      endObjWindowBg1();
      DestroySprite(gSprites[d[0]]);
      InitBattleAnimBg(GetBattleAnimBg1Data().bgId);
      if (d[6] === 1) gSprites[g.battlerSpriteIds[BATTLE_PARTNER(anim.attacker)]].oam.priority++;
      g.battle_BG1_Y = 0;
      DestroyAnimVisualTask(taskId);
    }
  }
};

// The stat change animation: the arrows mask scrolling over the battler (an OBJ window copy of its
// sprite). sAnimStatsChangeData's fields: battler1, battler2, higherPriority, data[8] (the anim
// args: [0] goes down, [1] stat, [2] 0 attacker / 1 target, [3] include partner, [4] sharply), species.
interface AnimStatsChangeData {
  battler1: number;
  battler2: number;
  higherPriority: number;
  data: Int16Array;
  species: number;
}
let sAnimStatsChangeData: AnimStatsChangeData | null = null;

const STAT_MASK_PALS = ['gBattleStatMask2_Pal', 'gBattleStatMask1_Pal', 'gBattleStatMask3_Pal', 'gBattleStatMask4_Pal', 'gBattleStatMask6_Pal', 'gBattleStatMask7_Pal', 'gBattleStatMask8_Pal'];
const STAT_MASK_GFX = ['gBattleStatMask_Gfx', 'gBattleStatMask1_Tilemap', 'gBattleStatMask2_Tilemap', 'gBattleStatMask5_Pal', ...STAT_MASK_PALS];

/** InitStatsChangeAnimation */
export const InitStatsChangeAnimation: TaskFunc = (taskId) => {
  sAnimStatsChangeData = { battler1: 0, battler2: 0, higherPriority: 0, data: Int16Array.from(gBattleAnimArgs), species: 0 };
  gTasks[taskId].func = StatsChangeAnimation_Step1;
};

const StatsChangeAnimation_Step1: TaskFunc = (taskId) => {
  const s = sAnimStatsChangeData!;
  s.battler1 = s.data[2] === 0 ? anim.attacker : anim.target;
  s.battler2 = BATTLE_PARTNER(s.battler1);
  if (s.data[3] && !IsBattlerSpriteVisible(s.battler2)) s.data[3] = 0;
  beginObjWindowBg1(BLDALPHA_BLEND(0, 16));
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 0);
  SetAnimBgAttribute(1, K.BG_ANIM_CHAR_BASE_BLOCK, 1);
  if (IsDoubleBattle() && s.data[3] === 0) {
    const pos = getBattlerPosition(s.battler1);
    if ((pos === K.B_POSITION_OPPONENT_RIGHT || pos === K.B_POSITION_PLAYER_LEFT) && IsBattlerSpriteVisible(s.battler2)) {
      gSprites[g.battlerSpriteIds[s.battler2]].oam.priority -= 1;
      SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
      s.higherPriority = 1;
    }
  }
  s.species = battlerSpecies(s.battler1);
  gTasks[taskId].func = StatsChangeAnimation_Step2;
};

const StatsChangeAnimation_Step2: TaskFunc = (taskId) => {
  const s = sAnimStatsChangeData!;
  const d = gTasks[taskId].data;
  let newSpriteId = 0;
  const spriteId = CreateInvisibleSpriteCopy(s.battler1, g.battlerSpriteIds[s.battler1], s.species);
  if (s.data[3]) newSpriteId = CreateInvisibleSpriteCopy(s.battler2, g.battlerSpriteIds[s.battler2], s.species);
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, s.data[0] === 0 ? 'gBattleStatMask1_Tilemap' : 'gBattleStatMask2_Tilemap');
  AnimLoadCompressedBgGfx(animBg.bgId, 'gBattleStatMask_Gfx', animBg.tilesOffset);
  LoadCompressedPalette(gfx16(STAT_MASK_PALS[s.data[1]] ?? 'gBattleStatMask5_Pal'), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  if (s.data[0] === 1) {
    g.battle_BG1_X = 64;
    d[1] = -3;
  } else {
    d[1] = 3;
  }
  d[4] = s.data[4] === 0 ? 10 : 13;
  d[5] = s.data[4] === 0 ? 20 : 30;
  d[0] = spriteId;
  d[2] = s.data[3];
  d[3] = newSpriteId;
  d[6] = s.higherPriority;
  d[7] = g.battlerSpriteIds[s.battler2];
  gTasks[taskId].func = StatsChangeAnimation_Step3;
  PlaySE12WithPanning(s.data[0] === 0 ? K.SE_M_STAT_INCREASE : K.SE_M_STAT_DECREASE, BattleAnimAdjustPanning2(K.SOUND_PAN_ATTACKER));
};

const StatsChangeAnimation_Step3: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  g.battle_BG1_Y += d[1];
  switch (d[15]) {
    case 0:
      if (d[11]++ > 0) {
        d[11] = 0;
        d[12]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[12], 16 - d[12]));
        if (d[12] === d[4]) d[15]++;
      }
      break;
    case 1:
      if (++d[10] === d[5]) d[15]++;
      break;
    case 2:
      if (d[11]++ > 0) {
        d[11] = 0;
        d[12]--;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[12], 16 - d[12]));
        if (d[12] === 0) {
          ResetBattleAnimBg(false);
          d[15]++;
        }
      }
      break;
    case 3:
      endObjWindowBg1();
      DestroySprite(gSprites[d[0]]);
      if (d[2]) DestroySprite(gSprites[d[3]]);
      if (d[6] === 1) gSprites[d[7]].oam.priority++;
      sAnimStatsChangeData = null;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** AnimTask_Flash: battlers to black, BG to white, then both fade back */
const AnimTask_Flash: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let selected = GetBattleMonSpritePalettesMask(true, true, true, true);
  SetPalettesToColor(selected, 0);
  d[14] = selected >>> 16;
  selected = GetBattlePalettesMask(true, false, false, false, false, false, false) & 0xffff;
  SetPalettesToColor(selected, 0xffff);
  d[15] = selected;
  d[0] = 0;
  d[1] = 0;
  gTasks[taskId].func = AnimTask_Flash_Step;
};

const AnimTask_Flash_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 6) {
        d[1] = 0;
        d[2] = 16;
        d[0]++;
      }
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        d[2]--;
        for (let i = 0; i < 16; i++) {
          if ((d[15] >> i) & 1) BlendPalette(BG_PLTT_ID(i), 16, d[2], 0xffff);
          if ((d[14] >> i) & 1) BlendPalette(OBJ_PLTT_ID(i), 16, d[2], 0);
        }
        if (d[2] === 0) d[0]++;
      }
      break;
    case 2:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

function SetPalettesToColor(selectedPalettes: number, color: number): void {
  for (let i = 0; i < 32; selectedPalettes >>>= 1, i++) if (selectedPalettes & 1) gPlttBufferFaded.fill(color, PLTT_ID(i), PLTT_ID(i) + 16);
}

/** AnimTask_BlendNonAttackerPalettes: args shifted up by one, then StartBlendAnimSpriteColor */
const AnimTask_BlendNonAttackerPalettes: TaskFunc = (taskId) => {
  let selected = 0;
  for (let battler = 0; battler < K.MAX_BATTLERS_COUNT; battler++) if (anim.attacker !== battler) selected |= 1 << (battler + 16);
  for (let j = 5; j !== 0; j--) gBattleAnimArgs[j] = gBattleAnimArgs[j - 1];
  StartBlendAnimSpriteColor(taskId, selected >>> 0);
};

/** AnimTask_StartSlidingBg: scrolls BG3 until gBattleAnimArgs[7] reaches arg 3 */
const AnimTask_StartSlidingBg: TaskFunc = (taskId) => {
  ToggleBg3Mode(false);
  const newTaskId = CreateTask(AnimTask_UpdateSlidingBg, 5);
  if (gBattleAnimArgs[2] && getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  }
  const d = gTasks[newTaskId].data;
  d[1] = gBattleAnimArgs[0];
  d[2] = gBattleAnimArgs[1];
  d[3] = gBattleAnimArgs[3];
  d[0]++;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_UpdateSlidingBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[10] += d[1];
  d[11] += d[2];
  g.battle_BG3_X += d[10] >> 8;
  g.battle_BG3_Y += d[11] >> 8;
  d[10] &= 0xff;
  d[11] &= 0xff;
  if (gBattleAnimArgs[7] === d[3]) {
    g.battle_BG3_X = 0;
    g.battle_BG3_Y = 0;
    ToggleBg3Mode(true);
    DestroyTask(taskId);
  }
};

const AnimTask_GetAttackerSide: TaskFunc = (taskId) => {
  gBattleAnimArgs[7] = getBattlerSide(anim.attacker);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_GetTargetSide: TaskFunc = (taskId) => {
  gBattleAnimArgs[7] = getBattlerSide(anim.target);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_GetTargetIsAttackerPartner: TaskFunc = (taskId) => {
  gBattleAnimArgs[7] = +(BATTLE_PARTNER(anim.attacker) === anim.target);
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_SetAllNonAttackersInvisiblity: arg 0 = invisible */
const AnimTask_SetAllNonAttackersInvisiblity: TaskFunc = (taskId) => {
  for (let battler = 0; battler < K.MAX_BATTLERS_COUNT; battler++) {
    if (battler !== anim.attacker && IsBattlerSpriteVisible(battler)) gSprites[g.battlerSpriteIds[battler]].invisible = !!gBattleAnimArgs[0];
  }
  DestroyAnimVisualTask(taskId);
};

/**
 * StartMonScrollingBgMask: like the stat change, a BG1 mask scrolling over the battler (and partner).
 * `gfx`, `tilemap` and `palette` are graphics symbols.
 */
export function StartMonScrollingBgMask(taskId: number, scrollSpeed: number, battler1: number, includePartner: boolean, numFadeSteps: number, fadeStepDelay: number, duration: number, gfxSym: string, tilemap: string, palette: string): void {
  const battler2 = BATTLE_PARTNER(battler1);
  if (includePartner && !IsBattlerSpriteVisible(battler2)) includePartner = false;
  beginObjWindowBg1(BLDALPHA_BLEND(0, 16));
  const bg1Cnt = (GetGpuReg(0xa) & ~(BGCNT_PRIORITY | BGCNT_SCREENSIZE | BGCNT_CHARBASE)) | BGCNT_OVERFLOW | (1 << 2);
  SetGpuReg(0xa, bg1Cnt);
  const species = battlerSpecies(battler1);
  const spriteId = CreateInvisibleSpriteCopy(battler1, g.battlerSpriteIds[battler1], species);
  const newSpriteId = includePartner ? CreateInvisibleSpriteCopy(battler2, g.battlerSpriteIds[battler2], species) : 0;
  const animBg = GetBattleAnimBg1Data();
  AnimLoadCompressedBgTilemap(animBg.bgId, tilemap);
  AnimLoadCompressedBgGfx(animBg.bgId, gfxSym, animBg.tilesOffset);
  LoadCompressedPalette(gfx16(palette), BG_PLTT_ID(animBg.paletteId), PLTT_SIZE_4BPP);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  const d = gTasks[taskId].data;
  d[1] = scrollSpeed;
  d[4] = numFadeSteps;
  d[5] = duration;
  d[6] = fadeStepDelay;
  d[0] = spriteId;
  d[2] = +includePartner;
  d[3] = newSpriteId;
  gTasks[taskId].func = UpdateMonScrollingBgMask;
}

const UpdateMonScrollingBgMask: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[13] += Math.abs(d[1]);
  if (d[1] < 0) g.battle_BG1_Y -= d[13] >> 8;
  else g.battle_BG1_Y += d[13] >> 8;
  d[13] &= 0xff;
  switch (d[15]) {
    case 0:
      if (d[11]++ >= d[6]) {
        d[11] = 0;
        d[12]++;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[12], 16 - d[12]));
        if (d[12] === d[4]) d[15]++;
      }
      break;
    case 1:
      if (++d[10] === d[5]) d[15]++;
      break;
    case 2:
      if (d[11]++ >= d[6]) {
        d[11] = 0;
        d[12]--;
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(d[12], 16 - d[12]));
        if (d[12] === 0) {
          ResetBattleAnimBg(false);
          endObjWindowBg1();
          DestroySprite(gSprites[d[0]]);
          if (d[2]) DestroySprite(gSprites[d[3]]);
          DestroyAnimVisualTask(taskId);
        }
      }
      break;
  }
};

const AnimTask_GetBattleTerrain: TaskFunc = (taskId) => {
  gBattleAnimArgs[0] = g.battleTerrain;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_AllocBackupPalBuffer: TaskFunc = (taskId) => {
  gMonSpritesGfxPtr!.multiUseBuffer = new Uint16Array(0x1000);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_FreeBackupPalBuffer: TaskFunc = (taskId) => {
  gMonSpritesGfxPtr!.multiUseBuffer = null;
  DestroyAnimVisualTask(taskId);
};

/** The palette arg 0 names: 0 the first battle BG palette, 1 attacker, 2 target */
function backupPaletteIndex(): number {
  if (gBattleAnimArgs[0] === 0) {
    let selected = GetBattlePalettesMask(true, false, false, false, false, false, false);
    let i = 0;
    while ((selected & 1) === 0) {
      selected >>>= 1;
      i++;
    }
    return i;
  }
  if (gBattleAnimArgs[0] === 1) return anim.attacker + 16;
  if (gBattleAnimArgs[0] === 2) return anim.target + 16;
  return 0;
}

const AnimTask_CopyPalUnfadedToBackup: TaskFunc = (taskId) => {
  const p = PLTT_ID(backupPaletteIndex());
  gMonSpritesGfxPtr!.multiUseBuffer!.set(gPlttBufferUnfaded.subarray(p, p + 16), gBattleAnimArgs[1] * 16);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_CopyPalUnfadedFromBackup: TaskFunc = (taskId) => {
  const p = PLTT_ID(backupPaletteIndex());
  const b = gBattleAnimArgs[1] * 16;
  gPlttBufferUnfaded.set(gMonSpritesGfxPtr!.multiUseBuffer!.subarray(b, b + 16), p);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_CopyPalFadedToUnfaded: TaskFunc = (taskId) => {
  const p = PLTT_ID(backupPaletteIndex());
  gPlttBufferUnfaded.set(gPlttBufferFaded.subarray(p, p + 16), p);
  DestroyAnimVisualTask(taskId);
};

const AnimTask_IsContest: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = 0;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_SetAnimAttackerAndTargetForEffectTgt: TaskFunc = (taskId) => {
  anim.attacker = g.battlerTarget;
  anim.target = g.effectBattler;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_IsTargetSameSide: TaskFunc = (taskId) => {
  gBattleAnimArgs[ARG_RET_ID] = +(getBattlerSide(anim.attacker) === getBattlerSide(anim.target));
  DestroyAnimVisualTask(taskId);
};

const AnimTask_SetAnimTargetToBattlerTarget: TaskFunc = (taskId) => {
  anim.target = g.battlerTarget;
  DestroyAnimVisualTask(taskId);
};

const AnimTask_SetAnimAttackerAndTargetForEffectAtk: TaskFunc = (taskId) => {
  anim.attacker = g.battlerAttacker;
  anim.target = g.effectBattler;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_SetAttackerInvisibleWaitForSignal: stays until gBattleAnimArgs[7] is 0x1000 */
const AnimTask_SetAttackerInvisibleWaitForSignal: TaskFunc = (taskId) => {
  const info = g.battleSpritesDataPtr.battlerData[anim.attacker];
  gTasks[taskId].data[0] = info.invisible;
  info.invisible = 1;
  gTasks[taskId].func = AnimTask_WaitAndRestoreVisibility;
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
};

const AnimTask_WaitAndRestoreVisibility: TaskFunc = (taskId) => {
  if (gBattleAnimArgs[7] === 0x1000) {
    g.battleSpritesDataPtr.battlerData[anim.attacker].invisible = gTasks[taskId].data[0] & 1;
    DestroyTask(taskId);
  }
};

export const utilityTasks: Record<string, TaskFunc> = {
  AnimTask_BlendBattleAnimPal,
  AnimTask_BlendBattleAnimPalExclude,
  AnimTask_SetCamouflageBlend,
  AnimTask_BlendParticle,
  AnimTask_HardwarePaletteFade,
  AnimTask_TraceMonBlended,
  AnimTask_DrawFallingWhiteLinesOnAttacker,
  AnimTask_Flash,
  AnimTask_BlendNonAttackerPalettes,
  AnimTask_StartSlidingBg,
  AnimTask_GetAttackerSide,
  AnimTask_GetTargetSide,
  AnimTask_GetTargetIsAttackerPartner,
  AnimTask_SetAllNonAttackersInvisiblity,
  AnimTask_GetBattleTerrain,
  AnimTask_AllocBackupPalBuffer,
  AnimTask_FreeBackupPalBuffer,
  AnimTask_CopyPalUnfadedToBackup,
  AnimTask_CopyPalUnfadedFromBackup,
  AnimTask_CopyPalFadedToUnfaded,
  AnimTask_IsContest,
  AnimTask_SetAnimAttackerAndTargetForEffectTgt,
  AnimTask_IsTargetSameSide,
  AnimTask_SetAnimTargetToBattlerTarget,
  AnimTask_SetAnimAttackerAndTargetForEffectAtk,
  AnimTask_SetAttackerInvisibleWaitForSignal,
};

export function registerUtilityExtraGfx(): void {
  registerAnimExtraGfx({
    AnimTask_DrawFallingWhiteLinesOnAttacker: ['gFile_graphics_battle_anims_masks_curse_tilemap', 'gFile_graphics_battle_anims_masks_curse_sheet'],
    AnimTask_StatsChange: STAT_MASK_GFX,
  });
}
