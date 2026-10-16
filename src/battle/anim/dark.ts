// battle_anim_dark.c: sprite callbacks and tasks, ported as the moves that use them come up.

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
import { BG_PLTT_ID, BlendPalette, LoadCompressedPalette, PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import { DestroySprite, gSprites, StartSpriteAffineAnim, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimLoadCompressedBgGfx,
  AnimLoadCompressedBgTilemap,
  BATTLE_PARTNER,
  CreateInvisibleSpriteCopy,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  InitBattleAnimBg,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  SetAnimBgAttribute,
  SetGreyscaleOrOriginalPalette,
  SPRITE_NONE,
} from './animMons';
import { anim, DestroyAnimVisualTask, gBattleAnimArgs, registerAnimExtraGfx } from './state';

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

export const darkSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimBite,
};

export const darkTasks: Record<string, TaskFunc> = {
  AnimTask_MetallicShine,
  AnimTask_SetGrayscaleOrOriginalPal,
  GetIsDoomDesireHitTurn,
};


export function registerDarkExtraGfx(): void {
  registerAnimExtraGfx({ AnimTask_MetallicShine: ['gMetalShineTilemap', 'gMetalShineGfx', 'gMetalShinePalette'] });
}
