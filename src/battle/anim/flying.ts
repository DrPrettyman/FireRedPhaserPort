// battle_anim_flying.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { gPlttBufferFaded, OBJ_PLTT_ID, OBJ_PLTT_OFFSET, PLTT_ID } from '../../gba/palette';
import { IndexOfSpritePaletteTag, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, Sin } from '../trig';
import { InitSpritePosToAnimTarget } from './animMons';
import { DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

/** AnimEllipticalGust: the tornado circling the target */
const AnimEllipticalGust: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.y += 20;
  sprite.data[1] = 191;
  sprite.callback = AnimEllipticalGust_Step;
  sprite.callback(sprite);
};

function AnimEllipticalGust_Step(sprite: Sprite): void {
  sprite.x2 = Sin(sprite.data[1], 32);
  sprite.y2 = Cos(sprite.data[1], 8);
  sprite.data[1] = (sprite.data[1] + 5) & 0xff;
  if (++sprite.data[0] === 71) DestroyAnimSprite(sprite);
}

/** AnimTask_AnimateGustTornadoPalette: rotates colours 1-8 of the gust palette. Args: delay, duration. */
const AnimTask_AnimateGustTornadoPalette: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = gBattleAnimArgs[0];
  d[2] = IndexOfSpritePaletteTag(K.ANIM_TAG_GUST);
  gTasks[taskId].func = AnimTask_AnimateGustTornadoPalette_Step;
};

const AnimTask_AnimateGustTornadoPalette_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[10]++ === d[1]) {
    d[10] = 0;
    const data2 = d[2] & 0xff;
    const temp = gPlttBufferFaded[OBJ_PLTT_ID(data2) + 8];
    const base = PLTT_ID(data2) + OBJ_PLTT_OFFSET;
    for (let i = 7; i > 0; i--) gPlttBufferFaded[base + 1 + i] = gPlttBufferFaded[base + i];
    gPlttBufferFaded[base + 1] = temp;
  }
  if (--d[0] === 0) DestroyAnimVisualTask(taskId);
};

export const flyingSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimEllipticalGust,
};

export const flyingTasks: Record<string, TaskFunc> = {
  AnimTask_AnimateGustTornadoPalette,
};
