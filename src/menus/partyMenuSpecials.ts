// party_menu_specials.c: the script specials that pick a party mon (ChoosePartyMon for the in-game trades, the
// Name Rater, the move deleter...; ChooseMonForMoveRelearner), the move deleter's (SelectMoveDeleterMove,
// MoveDeleterForgetMove and its helpers), plus party_menu.c's ChooseMonForMoveTutor for the move tutors,
// learn_move.c's TeachMoveRelearnerMove (the relearner screen is menus/learnMove.ts) and field_specials.c's Cape
// Brink tutor checks. SPECIALS (script/specials.ts) spreads PARTY_MENU_SPECIALS in.

import { K } from '../battle/constants';
import { bdata } from '../battle/env';
import { moveName } from '../battle/message';
import { removeMonPPBonus, setMonMoveSlot } from '../battle/pokemonBattle';
import type { Pokemon } from '../pokemon/Pokemon';
import type { Special, SpecialEnv } from '../script/specials';
import { GetMonNickname, strBody } from './common';
import { CB2_ReturnToField, gFieldCallback } from './fieldCallbacks';
import { LEARN_MOVE_GFX, StartMoveRelearner } from './learnMove';
import { ChooseMonForMoveTutor, ChoosePartyMonByMenuType } from './partyMenu';
import { SetPokemonSummaryScreenMode, ShowSelectMovePokemonSummaryScreen } from './summaryScreen';

/**
 * ChoosePartyMon / ChooseMonForMoveRelearner: LockPlayerFieldControls, fade to black, then Task_ChoosePartyMon
 * opens the party menu (ChoosePartyMonByMenuType, PARTY_ACTION_CHOOSE_AND_CLOSE) once the fade is over. The
 * menu leaves the chosen slot in VAR_0x8004 (SLOT_CANCEL, PARTY_SIZE + 1, on B), and its CB2_FadeFromPartyMenu
 * (gFieldCallback2) fades the field in and ends the script's `waitstate` (ScriptContext_Enable).
 */
function chooseMon({ state, host, setWaitState }: SpecialEnv, menuType: number): void {
  const fade = host.fadeScreen(state.defines.require('FADE_TO_BLACK')); // BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK)
  let menu: (() => boolean) | undefined;
  setWaitState(() => {
    if (!menu) {
      // Task_ChoosePartyMon
      if (!fade()) return false;
      menu = host.runScreenFromScript(() => ChoosePartyMonByMenuType(menuType));
    }
    return menu();
  });
}

/** ShiftMoveSlot: swap two move slots with their PP and PP Ups. */
export function ShiftMoveSlot(mon: Pokemon, slotTo: number, slotFrom: number): void {
  const gPPUpGetMask = (bdata.tables.mech as Record<string, number[]>).gPPUpGetMask;
  const move1 = mon.moves[slotTo];
  const move0 = mon.moves[slotFrom];
  const pp1 = mon.pp[slotTo];
  const pp0 = mon.pp[slotFrom];
  let ppBonuses = mon.ppBonuses;
  const ppBonusMask1 = gPPUpGetMask[slotTo];
  const ppBonusMove1 = (ppBonuses & ppBonusMask1) >> (slotTo * 2);
  const ppBonusMask2 = gPPUpGetMask[slotFrom];
  const ppBonusMove2 = (ppBonuses & ppBonusMask2) >> (slotFrom * 2);
  ppBonuses &= ~ppBonusMask1;
  ppBonuses &= ~ppBonusMask2;
  ppBonuses |= (ppBonusMove1 << (slotFrom * 2)) + (ppBonusMove2 << (slotTo * 2));
  mon.moves[slotTo] = move0;
  mon.moves[slotFrom] = move1;
  mon.pp[slotTo] = pp0;
  mon.pp[slotFrom] = pp1;
  mon.ppBonuses = ppBonuses & 0xff;
}

/** MoveDeleterForgetMove's work on one mon: clear `slot`, then shift the moves after it up. */
export function ForgetMoveSlot(mon: Pokemon, slot: number): void {
  setMonMoveSlot(mon, K.MOVE_NONE, slot);
  removeMonPPBonus(mon, slot);
  for (let i = slot; i < K.MAX_MON_MOVES - 1; ++i) ShiftMoveSlot(mon, i, i + 1);
}

const selectedMon = (state: SpecialEnv['state']): Pokemon => state.party[state.getVar('VAR_0x8004')]!;

export const PARTY_MENU_SPECIALS: Record<string, Special> = {
  ChoosePartyMon(env) {
    chooseMon(env, env.state.defines.require('PARTY_MENU_TYPE_CHOOSE_SINGLE_MON'));
  },

  /** The party menu half: VAR_0x8005 = GetNumberOfRelearnableMoves of the chosen mon (HandleChooseMonSelection). */
  ChooseMonForMoveRelearner(env) {
    chooseMon(env, env.state.defines.require('PARTY_MENU_TYPE_MOVE_RELEARNER'));
  },

  /**
   * ChooseMonForMoveTutor (party_menu.c): straight to the party menu (PARTY_ACTION_MOVE_TUTOR, the tutor move in
   * VAR_0x8005). It returns through CB2_ReturnToFieldContinueScriptPlayMapMusic, whose
   * FieldCB_ContinueScriptHandleMusic fades the field in and ends the `waitstate`; VAR_RESULT says whether the
   * move was taught.
   */
  ChooseMonForMoveTutor({ host, setWaitState }) {
    setWaitState(host.runScreenFromScript(ChooseMonForMoveTutor));
  },

  /**
   * SelectMoveDeleterMove: the summary screen in PSS_MODE_FORGET_MOVE on mon VAR_0x8004; the chosen slot comes
   * back in VAR_0x8005 (MAX_MON_MOVES on B). There's no `waitstate`: on the GBA the script stops running when
   * the summary screen takes over, and its next command (`fadescreen FADE_FROM_BLACK`) has already started
   * and finished out of sight by the time the field is back; FieldCB_ContinueScriptHandleMusic fades the field
   * in. Here the script waits at the special until the field is back (still black), and that `fadescreen`
   * does the fade in instead.
   */
  SelectMoveDeleterMove({ state, host, stopScript }) {
    gFieldCallback.fn = () => () => true;
    stopScript(
      host.runScreenFromScript(() => {
        ShowSelectMovePokemonSummaryScreen(state.party, state.getVar('VAR_0x8004'), state.party.length - 1, CB2_ReturnToField, 0);
        SetPokemonSummaryScreenMode(K.PSS_MODE_FORGET_MOVE);
      }),
    );
  },

  GetNumMovesSelectedMonHas({ state }) {
    const mon = selectedMon(state);
    let n = 0;
    for (let i = 0; i < K.MAX_MON_MOVES; ++i) if (mon.moves[i] !== K.MOVE_NONE) ++n;
    state.setVar('VAR_RESULT', n);
  },

  BufferMoveDeleterNicknameAndMove({ state }) {
    const mon = selectedMon(state);
    const move = mon.moves[state.getVar('VAR_0x8005')] ?? K.MOVE_NONE;
    state.stringVars[0] = strBody(GetMonNickname(mon));
    state.stringVars[1] = strBody(moveName(move));
  },

  MoveDeleterForgetMove({ state }) {
    ForgetMoveSlot(selectedMon(state), state.getVar('VAR_0x8005'));
  },

  IsSelectedMonEgg({ state }) {
    state.setVar('VAR_RESULT', selectedMon(state).isEgg ? 1 : 0);
  },

  /**
   * TeachMoveRelearnerMove (learn_move.c): LockPlayerFieldControls, fade to black, then Task_InitMoveRelearnerMenu
   * hands over to the relearner (CB2_MoveRelearner_Init) for mon VAR_0x8004. It comes back through
   * CB2_ReturnToField; FieldCB_ContinueScriptHandleMusic (the field's default return) fades in and ends the
   * `waitstate`. VAR_0x8004 is TRUE if a move was taught.
   */
  TeachMoveRelearnerMove({ state, host, setWaitState }) {
    const fade = host.fadeScreen(state.defines.require('FADE_TO_BLACK'));
    let screen: (() => boolean) | undefined;
    setWaitState(() => {
      if (!screen) {
        if (!fade()) return false;
        screen = host.runScreenFromScript(StartMoveRelearner, LEARN_MOVE_GFX);
      }
      return screen();
    });
  },

  /**
   * CapeBrinkGetMoveToTeachLeadPokemon (field_specials.c): whether the lead mon is a fully evolved starter with
   * max friendship that hasn't had its ultimate move yet. VAR_0x8005 = the MOVETUTOR_* index, VAR_0x8006 = how many
   * moves the lead knows, VAR_0x8007 = the lead's slot, STR_VAR_2 = the move's name.
   */
  CapeBrinkGetMoveToTeachLeadPokemon({ state }) {
    const d = state.defines;
    const leadMonSlot = GetLeadMonIndex(state.party);
    state.setVar('VAR_0x8007', leadMonSlot);
    const mon = state.party[leadMonSlot];
    // sCapeBrinkCompatibleSpecies, with the tutor move, its MOVETUTOR_* index and flag for each
    const tutors = [
      [K.SPECIES_VENUSAUR, K.MOVE_FRENZY_PLANT, 'MOVETUTOR_FRENZY_PLANT', 'FLAG_TUTOR_FRENZY_PLANT'],
      [K.SPECIES_CHARIZARD, K.MOVE_BLAST_BURN, 'MOVETUTOR_BLAST_BURN', 'FLAG_TUTOR_BLAST_BURN'],
      [K.SPECIES_BLASTOISE, K.MOVE_HYDRO_CANNON, 'MOVETUTOR_HYDRO_CANNON', 'FLAG_TUTOR_HYDRO_CANNON'],
    ] as const;
    const tutor = mon && !mon.isEgg ? tutors.find(([species]) => species === mon.species) : undefined;
    if (!tutor || mon.friendship !== 255) return 0;
    const [, move, tutorId, flag] = tutor;
    state.stringVars[1] = strBody(moveName(move));
    state.setVar('VAR_0x8005', d.require(tutorId));
    if (state.getFlag(flag)) return 0;
    let numMovesKnown = 0;
    for (let i = 0; i < K.MAX_MON_MOVES; i++) if (mon.moves[i] !== K.MOVE_NONE) numMovesKnown++;
    state.setVar('VAR_0x8006', numMovesKnown);
    return 1;
  },

  /** HasLearnedAllMovesFromCapeBrinkTutor (field_specials.c): set the taught move's flag; TRUE once all three are. */
  HasLearnedAllMovesFromCapeBrinkTutor({ state }) {
    const tutor = state.getVar('VAR_0x8005');
    const d = state.defines;
    if (tutor === d.require('MOVETUTOR_FRENZY_PLANT')) state.setFlag('FLAG_TUTOR_FRENZY_PLANT');
    else if (tutor === d.require('MOVETUTOR_BLAST_BURN')) state.setFlag('FLAG_TUTOR_BLAST_BURN');
    else state.setFlag('FLAG_TUTOR_HYDRO_CANNON');
    const n = ['FLAG_TUTOR_FRENZY_PLANT', 'FLAG_TUTOR_BLAST_BURN', 'FLAG_TUTOR_HYDRO_CANNON'].filter((f) => state.getFlag(f)).length;
    return n === 3 ? 1 : 0;
  },
};

/** GetLeadMonIndex (field_specials.c): the first party mon that isn't an egg, else slot 0. */
function GetLeadMonIndex(party: Pokemon[]): number {
  for (let i = 0; i < party.length; i++) if (!party[i].isEgg && party[i].species !== K.SPECIES_NONE) return i;
  return 0;
}
