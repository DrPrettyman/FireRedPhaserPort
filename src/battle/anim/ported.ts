// Registers every ported battle anim sprite callback and task function under its C name. Called lazily
// by the engine (battleAnim.ts) before it first looks one up, so the import cycle through ../gfx.ts never
// runs registration code before the modules it needs are initialised.

import { AnimSpriteOnMonPos, AnimSpinningSparkle, AnimThrowProjectile, AnimTranslateLinearAndFlicker, AnimTranslateLinearAndFlicker_Flipped, AnimTravelDiagonally, AnimWeatherBallDown, AnimWeatherBallUp, animMonsTasks, TranslateAnimSpriteToTargetMonLocation } from './animMons';
import { monMovementSpriteCallbacks, monMovementTasks } from './monMovement';
import { moveSpriteCallbacks, moveTasks, registerMovesExtraGfx } from './moves';
import { normalSpriteCallbacks, normalTasks } from './normal';
import { soundTasks } from './soundTasks';
import { registerSpecialExtraGfx, specialSpriteCallbacks, specialTasks } from './special';
import { statusEffectsSpriteCallbacks, statusEffectsTasks } from './statusEffects';
import { registerUtilityExtraGfx, utilityTasks } from './utilityFuncs';
import { registerSpriteCallbacks, registerTaskFuncs } from './state';

let done = false;

export function registerPortedBattleAnims(): void {
  if (done) return;
  done = true;
  registerSpriteCallbacks({
    AnimSpriteOnMonPos,
    AnimSpinningSparkle,
    AnimThrowProjectile,
    AnimTranslateLinearAndFlicker,
    AnimTranslateLinearAndFlicker_Flipped,
    AnimTravelDiagonally,
    AnimWeatherBallDown,
    AnimWeatherBallUp,
    TranslateAnimSpriteToTargetMonLocation,
    ...monMovementSpriteCallbacks,
    ...normalSpriteCallbacks,
    ...statusEffectsSpriteCallbacks,
    ...moveSpriteCallbacks,
    ...specialSpriteCallbacks,
  });
  registerTaskFuncs({ ...animMonsTasks, ...monMovementTasks, ...normalTasks, ...utilityTasks, ...statusEffectsTasks, ...soundTasks, ...moveTasks, ...specialTasks });
  registerUtilityExtraGfx();
  registerMovesExtraGfx();
  registerSpecialExtraGfx();
}
