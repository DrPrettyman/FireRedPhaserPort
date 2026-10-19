// The Trainer Tower's one special (data/specials.inc): trainer_tower.c's CallTrainerTowerFunc, which every
// `ttower_*` macro calls with a TRAINER_TOWER_FUNC_* in VAR_0x8004. The functions are world/trainerTower.ts.

import { CallTrainerTowerFunc } from '../world/trainerTower';
import type { Special, SpecialEnv } from './specials';

export const TRAINER_TOWER_SPECIALS: Record<string, Special> = {
  /** CallTrainerTowerFunc: sTrainerTowerFunctions[gSpecialVar_0x8004] on the current challenge's floors. */
  CallTrainerTowerFunc({ state, warnOnce, host, setWaitState }: SpecialEnv) {
    CallTrainerTowerFunc({
      state,
      warnOnce,
      // Task_DoTrainerTowerBattle (its own task, not Task_BattleStart), then CB2_EndTrainerTowerBattle:
      // CB2_ReturnToFieldContinueScriptPlayMapMusic whatever the outcome; `waitstate` waits for the fade-in.
      startTowerBattle(battleTypeFlags, enemyParty, transition) {
        const run = host.startScriptedBattle(battleTypeFlags, enemyParty, transition, 0, false);
        let fadeIn: (() => boolean) | undefined;
        setWaitState(() => {
          if (fadeIn) return fadeIn();
          if (run.done()) fadeIn = run.returnToField();
          return false;
        });
      },
    });
  },
};
