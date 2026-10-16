// battle_anim_effects_2.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { type SpriteCallback } from '../../gba/sprite';
import { type TaskFunc } from '../../gba/task';
import { Sin } from '../trig';
import { InitSpritePosToAnimAttacker } from './animMons';
import { DestroyAnimSprite } from './state';

/** AnimMagentaHeart (Status_Infatuation) */
const AnimMagentaHeart: SpriteCallback = (sprite) => {
  if (++sprite.data[0] === 1) InitSpritePosToAnimAttacker(sprite, false);
  sprite.x2 = Sin(sprite.data[1], 8);
  sprite.y2 = sprite.data[2] >> 8;
  sprite.data[1] = (sprite.data[1] + 7) & 0xff;
  sprite.data[2] -= 0x80;
  if (sprite.data[0] === 60) DestroyAnimSprite(sprite);
};

export const effects2SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMagentaHeart,
};

export const effects2Tasks: Record<string, TaskFunc> = {
};
