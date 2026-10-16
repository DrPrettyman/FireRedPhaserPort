// battle_anim_ghost.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_ALL,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  SetGpuReg,
} from '../../gba/hw';
import { type Sprite, type SpriteCallback } from '../../gba/sprite';
import { type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import { anim, DestroyAnimSprite } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimGhostStatusSprite (Curse, Nightmare): rises and fades out */
const AnimGhostStatusSprite: SpriteCallback = (sprite) => {
  const d = sprite.data;
  sprite.x2 = Sin(d[0], 12);
  if (isOpponent(anim.attacker)) sprite.x2 = -sprite.x2;
  d[0] = (d[0] + 6) & 0xff;
  d[1] += 0x100;
  sprite.y2 = -(d[1] >> 8);
  d[7]++;
  if (d[7] === 1) {
    d[6] = 0x050b;
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
    SetGpuReg(REG_OFFSET_BLDALPHA, d[6]);
  } else if (d[7] > 30) {
    d[2]++;
    let coeffB = (d[6] >> 8) & 0xffff;
    let coeffA = d[6] & 0xff;
    if (++coeffB > 16) coeffB = 16;
    coeffA = (coeffA - 1) & 0xffff;
    if ((coeffA << 16) >> 16 < 0) coeffA = 0;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(coeffA, coeffB));
    d[6] = BLDALPHA_BLEND(coeffA, coeffB);
    if (coeffB === 16 && coeffA === 0) {
      sprite.invisible = true;
      sprite.callback = AnimGhostStatusSprite_End;
    }
  }
};

function AnimGhostStatusSprite_End(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  DestroyAnimSprite(sprite);
}

export const ghostSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimGhostStatusSprite,
};

export const ghostTasks: Record<string, TaskFunc> = {
};
