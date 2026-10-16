// Registers every ported battle anim sprite callback and task function under its C name. Called lazily
// by the engine (battleAnim.ts) before it first looks one up, so the import cycle through ../gfx.ts never
// runs registration code before the modules it needs are initialised.

import { AnimSpriteOnMonPos, AnimSpinningSparkle, AnimThrowProjectile, AnimTranslateLinearAndFlicker, AnimTranslateLinearAndFlicker_Flipped, AnimTravelDiagonally, AnimWeatherBallDown, AnimWeatherBallUp, animMonsTasks, TranslateAnimSpriteToTargetMonLocation } from './animMons';
import { monMovementSpriteCallbacks, monMovementTasks } from './monMovement';
import { normalSpriteCallbacks, normalTasks } from './normal';
import { soundTasks } from './soundTasks';
import { registerSpecialExtraGfx, specialSpriteCallbacks, specialTasks } from './special';
import { statusEffectsSpriteCallbacks, statusEffectsTasks } from './statusEffects';
import { registerUtilityExtraGfx, utilityTasks } from './utilityFuncs';
import { registerSpriteCallbacks, registerTaskFuncs } from './state';
// The per-move files (battle_anim_effects_1.c ... battle_anim_water.c)
import { effects1SpriteCallbacks, effects1Tasks } from './effects1';
import { effects2SpriteCallbacks, effects2Tasks } from './effects2';
import { effects3SpriteCallbacks, effects3Tasks } from './effects3';
import { bugSpriteCallbacks, bugTasks } from './bug';
import { darkSpriteCallbacks, darkTasks, registerDarkExtraGfx } from './dark';
import { dragonSpriteCallbacks, dragonTasks } from './dragon';
import { electricSpriteCallbacks, electricTasks } from './electric';
import { fightSpriteCallbacks, fightTasks } from './fight';
import { fireSpriteCallbacks, fireTasks } from './fire';
import { flyingSpriteCallbacks, flyingTasks } from './flying';
import { ghostSpriteCallbacks, ghostTasks } from './ghost';
import { groundSpriteCallbacks, groundTasks } from './ground';
import { iceSpriteCallbacks, iceTasks, registerIceExtraGfx } from './ice';
import { poisonSpriteCallbacks, poisonTasks } from './poison';
import { psychicSpriteCallbacks, psychicTasks } from './psychic';
import { rockSpriteCallbacks, rockTasks } from './rock';
import { registerWaterExtraGfx, waterSpriteCallbacks, waterTasks } from './water';

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
    ...specialSpriteCallbacks,
    ...effects1SpriteCallbacks,
    ...effects2SpriteCallbacks,
    ...effects3SpriteCallbacks,
    ...bugSpriteCallbacks,
    ...darkSpriteCallbacks,
    ...dragonSpriteCallbacks,
    ...electricSpriteCallbacks,
    ...fightSpriteCallbacks,
    ...fireSpriteCallbacks,
    ...flyingSpriteCallbacks,
    ...ghostSpriteCallbacks,
    ...groundSpriteCallbacks,
    ...iceSpriteCallbacks,
    ...poisonSpriteCallbacks,
    ...psychicSpriteCallbacks,
    ...rockSpriteCallbacks,
    ...waterSpriteCallbacks,
  });
  registerTaskFuncs({ ...animMonsTasks, ...monMovementTasks, ...normalTasks, ...utilityTasks, ...statusEffectsTasks, ...soundTasks, ...specialTasks });
  registerTaskFuncs({
    ...effects1Tasks,
    ...effects2Tasks,
    ...effects3Tasks,
    ...bugTasks,
    ...darkTasks,
    ...dragonTasks,
    ...electricTasks,
    ...fightTasks,
    ...fireTasks,
    ...flyingTasks,
    ...ghostTasks,
    ...groundTasks,
    ...iceTasks,
    ...poisonTasks,
    ...psychicTasks,
    ...rockTasks,
    ...waterTasks,
  });
  registerUtilityExtraGfx();
  registerDarkExtraGfx();
  registerWaterExtraGfx();
  registerIceExtraGfx();
  registerSpecialExtraGfx();
}
