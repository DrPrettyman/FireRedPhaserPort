// The Trainer Tower's one special (data/specials.inc): trainer_tower.c's CallTrainerTowerFunc, which every
// `ttower_*` macro calls with a TRAINER_TOWER_FUNC_* in VAR_0x8004. The functions are world/trainerTower.ts.

import { testEvent } from '../dev/testHooks';
import { CallTrainerTowerFunc } from '../world/trainerTower';
import type { Special, SpecialEnv } from './specials';

export const TRAINER_TOWER_SPECIALS: Record<string, Special> = {
  /** CallTrainerTowerFunc: sTrainerTowerFunctions[gSpecialVar_0x8004] on the current challenge's floors. */
  CallTrainerTowerFunc({ state, warnOnce }: SpecialEnv) {
    CallTrainerTowerFunc({
      state,
      warnOnce,
      battleStandIn: (info) => testEvent('trainerTowerBattle', info),
    });
  },
};
