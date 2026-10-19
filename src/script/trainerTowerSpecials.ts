// The Trainer Tower's specials (data/specials.inc): trainer_tower.c's CallTrainerTowerFunc, which every
// `ttower_*` macro calls with a TRAINER_TOWER_FUNC_* in VAR_0x8004 (the functions are world/trainerTower.ts), and
// battle_records.c's ShowBattleRecords (menus/battleRecords.ts), the lobby's TIME BOARD and the link records.

import { BATTLE_RECORDS_GFX, ShowBattleRecords } from '../menus/battleRecords';
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
  /**
   * ShowBattleRecords (battle_records.c) after `fadescreen FADE_TO_BLACK`: VAR_0x8004 1 the Trainer Tower's TIME
   * BOARD, 0 the link battle results. It returns through CB2_ReturnToFieldContinueScriptPlayMapMusic; the script's
   * `waitstate` ends once the field has faded back in.
   */
  ShowBattleRecords({ host, setWaitState }: SpecialEnv) {
    setWaitState(host.runScreenFromScript(ShowBattleRecords, BATTLE_RECORDS_GFX));
  },
};
