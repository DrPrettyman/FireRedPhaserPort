// battle_anim_sound_tasks.c: sound effects and cries panned across the battle. There's no audio yet, so
// the SE/cry calls are the sound.ts no-ops; the tasks keep their timing (cries count as finished at once).

import { IsCryPlaying, PlayCry_ByMode } from '../../gba/sound';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { getBattlerSide } from '../util';
import { BATTLE_PARTNER, IsBattlerSpriteVisible } from './animMons';
import { BattleAnimAdjustPanning, CalculatePanIncrement, KeepPanInRange, PlaySE12WithPanning } from './battleAnim';
import { anim, DestroyAnimSoundTask, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const s8 = (v: number) => (v << 24) >> 24;
const u8 = (v: number) => v & 0xff;

// SoundTask_FireBlast: the looped SE (arg 0) pans attacker -> target, then the ending SE (arg 1) twice.
const SoundTask_FireBlast: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  const pan1 = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  const pan2 = BattleAnimAdjustPanning(K.SOUND_PAN_TARGET);
  d[2] = pan1;
  d[3] = pan2;
  d[4] = s8(CalculatePanIncrement(pan1, pan2, 2));
  d[10] = 10;
  gTasks[taskId].func = SoundTask_FireBlast_Step1;
};

const SoundTask_FireBlast_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  let pan = d[2];
  const panIncrement = s8(d[4]);
  if (++d[11] === 111) {
    d[10] = 5;
    d[11] = 0;
    gTasks[taskId].func = SoundTask_FireBlast_Step2;
  } else {
    if (++d[10] === 11) {
      d[10] = 0;
      PlaySE12WithPanning(d[0] & 0xffff, pan);
    }
    pan += panIncrement;
    d[2] = KeepPanInRange(pan, panIncrement);
  }
};

const SoundTask_FireBlast_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (++d[10] === 6) {
    d[10] = 0;
    PlaySE12WithPanning(d[1] & 0xffff, BattleAnimAdjustPanning(K.SOUND_PAN_TARGET));
    if (++d[11] === 2) DestroyAnimSoundTask(taskId);
  }
};

// SoundTask_LoopSEAdjustPanning. Args: SE, source pan, target pan, pan step, plays, frames per pan
// step, frames per play.
const SoundTask_LoopSEAdjustPanning: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const songId = gBattleAnimArgs[0] & 0xffff;
  const r10 = u8(gBattleAnimArgs[4]);
  const r7 = u8(gBattleAnimArgs[5]);
  const r9 = u8(gBattleAnimArgs[6]);
  const sourcePan = BattleAnimAdjustPanning(s8(gBattleAnimArgs[1]));
  const targetPan = BattleAnimAdjustPanning(s8(gBattleAnimArgs[2]));
  const panIncrement = s8(CalculatePanIncrement(sourcePan, targetPan, s8(gBattleAnimArgs[3])));
  d[0] = songId;
  d[1] = sourcePan;
  d[2] = targetPan;
  d[3] = panIncrement;
  d[4] = r10;
  d[5] = r7;
  d[6] = r9;
  d[10] = 0;
  d[11] = sourcePan;
  d[12] = r9;
  gTasks[taskId].func = SoundTask_LoopSEAdjustPanning_Step;
  gTasks[taskId].func(taskId);
};

const SoundTask_LoopSEAdjustPanning_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[12]++ === d[6]) {
    d[12] = 0;
    PlaySE12WithPanning(d[0] & 0xffff, d[11]);
    if (--d[4] === 0) {
      DestroyAnimSoundTask(taskId);
      return;
    }
  }
  if (d[10]++ === d[5]) {
    d[10] = 0;
    const oldPan = d[11];
    d[11] = (d[3] + oldPan) & 0xffff;
    d[11] = KeepPanInRange(d[11], oldPan);
  }
};

/** The battler SoundTask_PlayCryHighPitch / PlayDoubleCry name in arg 0, or -1 if it isn't visible. */
function cryBattler(): number {
  let battlerId: number;
  if (gBattleAnimArgs[0] === K.ANIM_ATTACKER) battlerId = anim.attacker;
  else if (gBattleAnimArgs[0] === K.ANIM_TARGET) battlerId = anim.target;
  else if (gBattleAnimArgs[0] === K.ANIM_ATK_PARTNER) battlerId = BATTLE_PARTNER(anim.attacker);
  else battlerId = BATTLE_PARTNER(anim.target);
  if ((gBattleAnimArgs[0] === K.ANIM_TARGET || gBattleAnimArgs[0] === K.ANIM_DEF_PARTNER) && !IsBattlerSpriteVisible(battlerId)) return -1;
  return battlerId;
}

const battlerSpecies = (b: number) => (getBattlerSide(b) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty)[g.battlerPartyIndexes[b]]?.species ?? K.SPECIES_NONE;

const SoundTask_PlayCryHighPitch: TaskFunc = (taskId) => {
  const pan = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  const battlerId = cryBattler();
  if (battlerId < 0) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const species = battlerSpecies(battlerId);
  if (species !== K.SPECIES_NONE) PlayCry_ByMode(species, pan, K.CRY_MODE_HIGH_PITCH);
  DestroyAnimVisualTask(taskId);
};

// SoundTask_PlayDoubleCry (Growl, Roar). Args: battler, DOUBLE_CRY_GROWL / DOUBLE_CRY_ROAR.
const SoundTask_PlayDoubleCry: TaskFunc = (taskId) => {
  const pan = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  const battlerId = cryBattler();
  if (battlerId < 0) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  const species = battlerSpecies(battlerId);
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = species;
  d[2] = pan;
  if (species !== K.SPECIES_NONE) {
    PlayCry_ByMode(species, pan, gBattleAnimArgs[1] === K.DOUBLE_CRY_GROWL ? K.CRY_MODE_GROWL_1 : K.CRY_MODE_ROAR_1);
    gTasks[taskId].func = SoundTask_PlayDoubleCry_Step;
  } else {
    DestroyAnimVisualTask(taskId);
  }
};

const SoundTask_PlayDoubleCry_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const species = d[1] & 0xffff;
  const pan = s8(d[2]);
  if (d[9] < 2) {
    d[9]++;
  } else if (!IsCryPlaying()) {
    PlayCry_ByMode(species, pan, d[0] === K.DOUBLE_CRY_GROWL ? K.CRY_MODE_GROWL_2 : K.CRY_MODE_ROAR_2);
    DestroyAnimVisualTask(taskId);
  }
};

const SoundTask_WaitForCry: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[9] < 2) d[9]++;
  else if (!IsCryPlaying()) DestroyAnimVisualTask(taskId);
};

const SoundTask_PlayCryWithEcho: TaskFunc = (taskId) => {
  const pan = BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER);
  const species = anim.battlerSpecies[anim.attacker];
  const d = gTasks[taskId].data;
  d[1] = species;
  d[2] = pan;
  if (species !== K.SPECIES_NONE) {
    PlayCry_ByMode(species, pan, K.CRY_MODE_ECHO_START);
    gTasks[taskId].func = SoundTask_PlayCryWithEcho_Step;
  } else {
    DestroyAnimVisualTask(taskId);
  }
};

const SoundTask_PlayCryWithEcho_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[9] < 2) {
    d[9]++;
  } else if (!IsCryPlaying()) {
    PlayCry_ByMode(d[1] & 0xffff, s8(d[2]), K.CRY_MODE_ECHO_END);
    DestroyAnimVisualTask(taskId);
  }
};

const SoundTask_PlaySE1WithPanning: TaskFunc = (taskId) => {
  PlaySE12WithPanning(gBattleAnimArgs[0] & 0xffff, BattleAnimAdjustPanning(s8(gBattleAnimArgs[1])));
  DestroyAnimVisualTask(taskId);
};

const SoundTask_PlaySE2WithPanning: TaskFunc = (taskId) => {
  PlaySE12WithPanning(gBattleAnimArgs[0] & 0xffff, BattleAnimAdjustPanning(s8(gBattleAnimArgs[1])));
  DestroyAnimVisualTask(taskId);
};

/** SoundTask_AdjustPanningVar: only moves gAnimCustomPanning (Confuse Ray, Will-O-Wisp) */
const SoundTask_AdjustPanningVar: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sourcePan = BattleAnimAdjustPanning(s8(gBattleAnimArgs[0]));
  const targetPan = BattleAnimAdjustPanning(s8(gBattleAnimArgs[1]));
  d[1] = sourcePan;
  d[2] = targetPan;
  d[3] = s8(CalculatePanIncrement(sourcePan, targetPan, s8(gBattleAnimArgs[2])));
  d[5] = gBattleAnimArgs[3];
  d[10] = 0;
  d[11] = sourcePan;
  gTasks[taskId].func = SoundTask_AdjustPanningVar_Step;
  gTasks[taskId].func(taskId);
};

const SoundTask_AdjustPanningVar_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[10]++ === d[5]) {
    d[10] = 0;
    const oldPan = d[11];
    d[11] = (d[3] + oldPan) & 0xffff;
    d[11] = KeepPanInRange(d[11], oldPan);
  }
  anim.customPanning = d[11];
  if (d[11] === d[2]) DestroyAnimVisualTask(taskId);
};

export const soundTasks: Record<string, TaskFunc> = {
  SoundTask_FireBlast,
  SoundTask_LoopSEAdjustPanning,
  SoundTask_PlayCryHighPitch,
  SoundTask_PlayDoubleCry,
  SoundTask_WaitForCry,
  SoundTask_PlayCryWithEcho,
  SoundTask_PlaySE1WithPanning,
  SoundTask_PlaySE2WithPanning,
  SoundTask_AdjustPanningVar,
};
