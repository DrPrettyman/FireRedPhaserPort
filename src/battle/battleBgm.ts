// pokemon.c's battle music: GetBattleBGM and PlayMapChosenOrBattleBGM (PlayBattleBGM: no caller in FRLG). CreateBattleStartTask
// (battle_setup.c) calls PlayMapChosenOrBattleBGM before the transition, so the battle's song starts with it.
// The C reads gBattleTypeFlags and gTrainers[gTrainerBattleOpponent_A].trainerClass, which battle_setup.c has
// set by then; the port's battle globals are only set when BattleScene starts, so the callers pass them (the
// class: battle-test.html starts its battle music before the battle data is loaded).

import { m4aMPlayAllStop } from '../audio/m4a';
import { PlayNewMapMusic, ResetMapMusic } from '../gba/sound';
import { K } from './constants';

/** GetBattleBGM (pokemon.c) */
export function GetBattleBGM(battleTypeFlags: number, trainerClass: number): number {
  if (battleTypeFlags & K.BATTLE_TYPE_KYOGRE_GROUDON) return K.MUS_VS_WILD;
  if (battleTypeFlags & K.BATTLE_TYPE_REGI) return K.MUS_RS_VS_TRAINER;
  if (battleTypeFlags & K.BATTLE_TYPE_LINK) return K.MUS_RS_VS_TRAINER;
  if (battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
    switch (trainerClass) {
      case K.TRAINER_CLASS_CHAMPION:
        return K.MUS_VS_CHAMPION;
      case K.TRAINER_CLASS_LEADER:
      case K.TRAINER_CLASS_ELITE_FOUR:
        return K.MUS_VS_GYM_LEADER;
      default: // BOSS, TEAM_ROCKET, COOLTRAINER, GENTLEMAN, RIVAL_LATE, ...
        return K.MUS_VS_TRAINER;
    }
  }
  return K.MUS_VS_WILD;
}

/** PlayMapChosenOrBattleBGM (pokemon.c): `songId` 0 is the battle's default music. */
export function PlayMapChosenOrBattleBGM(songId: number, battleTypeFlags: number, trainerClass: number): void {
  ResetMapMusic();
  m4aMPlayAllStop();
  if (songId) PlayNewMapMusic(songId);
  else PlayNewMapMusic(GetBattleBGM(battleTypeFlags, trainerClass));
}
