import { adjustFriendship } from '../battle/pokemonBattle';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';

// The per-step counters of field_control_avatar.c's TryStartStepCountScript, with the parts of
// vs_seeker.c, field_poison.c and daycare.c they call.

/** FLDPSN_* (field_poison.h) */
export const enum FieldPoison {
  NONE,
  PSN,
  FNT,
}

/** UpdateHappinessStepCounter: every 128 steps each party mon may gain walking friendship. */
export function updateHappinessStepCounter(state: GameState): void {
  const steps = (state.getVar('VAR_HAPPINESS_STEP_COUNTER') + 1) % 128;
  state.setVar('VAR_HAPPINESS_STEP_COUNTER', steps);
  if (steps === 0) {
    for (const mon of state.party) adjustFriendship(mon, state.defines.require('FRIENDSHIP_EVENT_WALKING'));
  }
}

/** UpdateVsSeekerStepCounter: TRUE when the VS Seeker has finished charging (100 steps). */
export function updateVsSeekerStepCounter(state: GameState): boolean {
  const d = state.defines;
  if (state.bag.has(d.require('ITEM_VS_SEEKER'), 1)) {
    if ((state.trainerRematchStepCounter & 0xff) < 100) state.trainerRematchStepCounter++;
  }
  if (state.getFlag('FLAG_SYS_VS_SEEKER_CHARGING')) {
    if (((state.trainerRematchStepCounter >> 8) & 0xff) < 100) {
      const x = ((state.trainerRematchStepCounter >> 8) & 0xff) + 1;
      state.trainerRematchStepCounter = (state.trainerRematchStepCounter & 0xff) | (x << 8);
    }
    if (((state.trainerRematchStepCounter >> 8) & 0xff) === 100) {
      state.setFlag('FLAG_SYS_VS_SEEKER_CHARGING', false);
      vsSeekerResetChargingStepCounter(state);
      state.trainerRematches = []; // ClearAllTrainerRematchStates
      return true;
    }
  }
  return false;
}

/** VsSeekerResetChargingStepCounter */
function vsSeekerResetChargingStepCounter(state: GameState): void {
  state.trainerRematchStepCounter &= 0x00ff;
}

/**
 * MapResetTrainerRematches' state part, on every map load; its ResetMovementOfRematchableTrainers (the objects'
 * part) is world/vsSeeker.ts, called right after.
 */
export function mapResetTrainerRematches(state: GameState): void {
  state.setFlag('FLAG_SYS_VS_SEEKER_CHARGING', false);
  vsSeekerResetChargingStepCounter(state);
  state.trainerRematches = []; // ClearAllTrainerRematchStates
}

/** UpdatePoisonStepCounter: every 5 steps (not in secret bases), poisoned mons lose 1 HP; TRUE if one fainted. */
export function updatePoisonStepCounter(state: GameState, mapType: string | null, startPoisonEffect: () => void): boolean {
  if (mapType === 'MAP_TYPE_SECRET_BASE') return false;
  const steps = (state.getVar('VAR_POISON_STEP_COUNTER') + 1) % 5;
  state.setVar('VAR_POISON_STEP_COUNTER', steps);
  if (steps !== 0) return false;
  return doPoisonFieldEffect(state, startPoisonEffect) === FieldPoison.FNT;
}

/** DoPoisonFieldEffect */
function doPoisonFieldEffect(state: GameState, startPoisonEffect: () => void): FieldPoison {
  let numPoisoned = 0;
  let numFainted = 0;
  for (const mon of state.party) {
    if (isPoisoned(state, mon)) {
      // MON_DATA_SANITY_HAS_SPECIES: every party entry here has one
      if (mon.hp === 0 || --mon.hp === 0) numFainted++;
      numPoisoned++;
    }
  }
  if (numFainted || numPoisoned) startPoisonEffect(); // FldEffPoison_Start
  if (numFainted) return FieldPoison.FNT;
  if (numPoisoned) return FieldPoison.PSN;
  return FieldPoison.NONE;
}

/** GetAilmentFromStatus(status) == AILMENT_PSN */
export function isPoisoned(state: GameState, mon: Pokemon): boolean {
  return (mon.status & state.defines.require('STATUS1_PSN_ANY')) !== 0;
}

// ShouldEggHatch (daycare.c: the Route 5 daycare mon's steps, the Four Island daycare's, party eggs' egg cycles)
// lives with the daycare in world/daycare.ts.
export { shouldEggHatch } from './daycare';
