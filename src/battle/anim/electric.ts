// battle_anim_electric.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  CreateSprite,
  DestroySprite,
  gSprites,
  SPRITE_SHAPE,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { GetBattlerSpriteCoord, InitSpritePosToAnimTarget, WaitAnimForDuration } from './animMons';
import { animSpriteTemplate } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

/** AnimElectricity: arcs over the target (Status_Paralysis, electric hits). Args: x, y, duration, frame. */
const AnimElectricity: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.oam.tileNum += gBattleAnimArgs[3] * 4;
  if (gBattleAnimArgs[3] === 1) sprite.oam.matrixNum = 0x08; // ST_OAM_HFLIP
  else if (gBattleAnimArgs[3] === 2) sprite.oam.matrixNum = 0x10; // ST_OAM_VFLIP
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// AnimTask_ElectricBolt: the falling bolt (Thunder Shock/Wave/bolt). Args: x, y, wide (0/1).
const AnimTask_ElectricBolt: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
  d[1] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  gTasks[taskId].func = AnimTask_ElectricBolt_Step;
};

const AnimTask_ElectricBolt_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sp = d[2] & 0xff;
  const x = d[0];
  const y = d[1];
  let r8 = d[2] ? 8 : 0;
  const r2 = d[2] ? 4 : 1;
  let r12 = 16;
  let spriteId = 0;
  let created = false;
  const segment = animSpriteTemplate('sElectricBoltSegmentSpriteTemplate')!;
  switch (d[10]) {
    case 0:
    case 2:
    case 4:
    case 6:
    case 8: {
      const n = d[10] / 2; // 0..4
      r12 *= n + 1;
      if (n >= 1 && n <= 3) r8 += r2 * n;
      spriteId = CreateSprite(segment, x, y + r12, 2);
      created = true;
      break;
    }
    case 10:
      DestroyAnimVisualTask(taskId);
      return;
  }
  if (created) {
    gSprites[spriteId].oam.tileNum += r8;
    gSprites[spriteId].data[0] = sp;
    gSprites[spriteId].callback(gSprites[spriteId]);
  }
  d[10]++;
};

const AnimElectricBoltSegment: SpriteCallback = (sprite) => {
  const dim = !sprite.data[0] ? SPRITE_SHAPE['8x16'] : SPRITE_SHAPE['16x16'];
  sprite.oam.shape = dim[0];
  sprite.oam.size = dim[1];
  if (++sprite.data[1] === 15) DestroySprite(sprite);
};

/** AnimThunderWave: two flickering bands (the second sprite is the template's right half) */
const AnimThunderWave: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  const spriteId = CreateSprite(animSpriteTemplate('gThunderWaveSpriteTemplate')!, sprite.x + 32, sprite.y, sprite.subpriority);
  gSprites[spriteId].oam.tileNum += 8;
  anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
  gSprites[spriteId].callback = AnimThunderWave_Step;
  sprite.callback = AnimThunderWave_Step;
};

function AnimThunderWave_Step(sprite: Sprite): void {
  if (++sprite.data[0] === 3) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
  }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

export const electricSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimElectricity,
  AnimElectricBoltSegment,
  AnimThunderWave,
};

export const electricTasks: Record<string, TaskFunc> = {
  AnimTask_ElectricBolt,
};
