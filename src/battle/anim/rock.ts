// battle_anim_rock.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { AnimateSprite, StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { Sin } from '../trig';
import { DestroySpriteAndMatrix, InitSpritePosToAnimAttacker, InitSpritePosToAnimTarget, SetAverageBattlerPositions, TranslateSpriteInEllipse } from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

// AnimParticleInVortex (Fire Spin, Sand Tomb, Whirlpool): rises while swaying. Args: x, y, rise speed,
// duration, wave speed, wave amplitude, battler (0 attacker).
const AnimParticleInVortex: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[6] === 0) InitSpritePosToAnimAttacker(sprite, false);
  else InitSpritePosToAnimTarget(sprite, false);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[1] = gBattleAnimArgs[2];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = gBattleAnimArgs[5];
  sprite.callback = AnimParticleInVortex_Step;
};

function AnimParticleInVortex_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[1];
  sprite.y2 = -(d[4] >> 8);
  sprite.x2 = Sin(d[5], d[3]);
  d[5] = (d[5] + d[2]) & 0xff;
  if (--d[0] === -1) DestroyAnimSprite(sprite);
}

/** AnimFallingRock (Rock Throw, Rock Slide): drops in, then bounces off. Args: x, anim, bounce x speed, both targets. */
const AnimFallingRock: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[3] !== 0) {
    const p = SetAverageBattlerPositions(anim.target, false);
    sprite.x = p.x;
    sprite.y = p.y;
  }
  sprite.x += gBattleAnimArgs[0];
  sprite.y += 14;
  StartSpriteAnim(sprite, gBattleAnimArgs[1]);
  AnimateSprite(sprite);
  const d = sprite.data;
  d[0] = 0;
  d[1] = 0;
  d[2] = 4;
  d[3] = 16;
  d[4] = -70;
  d[5] = gBattleAnimArgs[2];
  StoreSpriteCallbackInData6(sprite, AnimFallingRock_Step);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
};

function AnimFallingRock_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x += d[5];
  d[0] = 192;
  d[1] = d[5];
  d[2] = 4;
  d[3] = 32;
  d[4] = -24;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInEllipse;
  sprite.callback(sprite);
}

export const rockSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimParticleInVortex,
  AnimFallingRock,
};

export const rockTasks: Record<string, TaskFunc> = {};
