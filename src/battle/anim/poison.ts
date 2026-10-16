// battle_anim_poison.c: sprite callbacks and tasks, ported as the moves that use them come up.

import type { Sprite, SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import { InitSpritePosToAnimTarget, SetAverageBattlerPositions } from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimBubbleEffect: a bubble rising and growing (poison moves, Bubble). Args: x, y, both targets. */
const AnimBubbleEffect: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) {
    InitSpritePosToAnimTarget(sprite, true);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    sprite.x = p.x;
    sprite.y = p.y;
    if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.callback = AnimBubbleEffect_Step;
};

function AnimBubbleEffect_Step(sprite: Sprite): void {
  sprite.data[0] = (sprite.data[0] + 0xb) & 0xff;
  sprite.x2 = Sin(sprite.data[0], 4);
  sprite.data[1] += 0x30;
  sprite.y2 = -(sprite.data[1] >> 8);
  if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
}

export const poisonSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimBubbleEffect,
};

export const poisonTasks: Record<string, TaskFunc> = {};
