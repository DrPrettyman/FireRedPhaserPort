// The audio specials (data/specials.inc): battle_setup.c's PlayTrainerEncounterMusic and field_screen_effect.c's
// Script_FadeOutMapMusic. LoopWingFlapSound (Navel Rock's summit) is postgame and not here.

import { bdata } from '../battle/env';
import { BGMusicStopped, FadeOutMapMusic, PlayNewMapMusic } from '../gba/sound';
import type { Special, SpecialEnv } from './specials';

/** GetTrainerEncounterMusicId (pokemon.c): TRAINER_ENCOUNTER_MUSIC(trainer), gTrainers' encounterMusic_gender & 0x7F. */
function GetTrainerEncounterMusicId(trainerId: number): number {
  return (bdata?.tables.trainers[trainerId]?.encounterMusicGender ?? 0) & 0x7f;
}

export const AUDIO_SPECIALS: Record<string, Special> = {
  /**
   * PlayTrainerEncounterMusic (battle_setup.c): the trainer's encounter music by gTrainers' encounterMusic id, as
   * new map music (EventScript_DoTrainerBattle and the other trainer_battle.inc scripts call it before the intro
   * text). Not for TRAINER_BATTLE_CONTINUE_SCRIPT(_DOUBLE)_NO_MUSIC; the quest log's playback isn't ported.
   */
  PlayTrainerEncounterMusic({ state, trainerBattle }: SpecialEnv) {
    const d = state.defines;
    const battle = trainerBattle(); // sTrainerBattleMode, gTrainerBattleOpponent_A
    if (!battle) return;
    if (battle.mode === d.require('TRAINER_BATTLE_CONTINUE_SCRIPT_NO_MUSIC')) return;
    if (battle.mode === d.require('TRAINER_BATTLE_CONTINUE_SCRIPT_DOUBLE_NO_MUSIC')) return;
    let music: string;
    switch (GetTrainerEncounterMusicId(battle.trainer)) {
      case d.require('TRAINER_ENCOUNTER_MUSIC_FEMALE'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_GIRL'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_TWINS'):
        music = 'MUS_ENCOUNTER_GIRL';
        break;
      case d.require('TRAINER_ENCOUNTER_MUSIC_MALE'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_INTENSE'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_COOL'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_SWIMMER'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_ELITE_FOUR'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_HIKER'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_INTERVIEWER'):
      case d.require('TRAINER_ENCOUNTER_MUSIC_RICH'):
        music = 'MUS_ENCOUNTER_BOY';
        break;
      default:
        music = 'MUS_ENCOUNTER_ROCKET';
        break;
    }
    PlayNewMapMusic(d.require(music));
  },

  /**
   * Script_FadeOutMapMusic (field_screen_effect.c): Overworld_FadeOutMapMusic (FadeOutMapMusic(4): 64 frames), then
   * Task_EnableScriptAfterMusicFade, which re-enables the script (its `waitstate`) once BGMusicStopped. The task runs
   * after the script in the frame, and the script goes on the frame after the one that saw the music stop.
   */
  Script_FadeOutMapMusic({ setWaitState }: SpecialEnv) {
    FadeOutMapMusic(4);
    let enabled = false;
    setWaitState(() => {
      if (enabled) return true;
      if (BGMusicStopped()) enabled = true; // ScriptContext_Enable: the script runs in the next frame
      return false;
    });
  },
};
