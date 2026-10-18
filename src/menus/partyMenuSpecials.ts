// party_menu_specials.c: the script specials that pick a party mon (ChoosePartyMon for the in-game trades, the
// Name Rater, the move deleter...; ChooseMonForMoveRelearner), the move deleter's (SelectMoveDeleterMove,
// MoveDeleterForgetMove and its helpers), plus party_menu.c's ChooseMonForMoveTutor for the move tutors.
// SPECIALS (script/specials.ts) spreads PARTY_MENU_SPECIALS in.

import { K } from '../battle/constants';
import { bdata } from '../battle/env';
import { moveName } from '../battle/message';
import { removeMonPPBonus, setMonMoveSlot } from '../battle/pokemonBattle';
import type { Pokemon } from '../pokemon/Pokemon';
import type { Special, SpecialEnv } from '../script/specials';
import { GetMonNickname, strBody } from './common';
import { CB2_ReturnToField, gFieldCallback } from './fieldCallbacks';
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

  /** The party menu half; the relearner screen it leads to (learn_move.c) isn't ported yet. */
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
};
