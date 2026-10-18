// daycare.c's script specials (the Route 5 daycare man, Route5_PokemonDayCare_EventScript_DaycareMan in
// data/scripts/day_care.inc); the storage they work on is world/daycare.ts. SPECIALS spreads DAYCARE_SPECIALS in.
// The Four Island daycare's (StoreSelectedPokemonInDaycare, GetDaycareState, eggs, ...) come with W-daycare unit 3.

import { ChooseMonForDaycare, GetCursorSelectionMonId } from '../menus/partyMenu';
import {
  boxMonNickname,
  getCostToWithdrawRoute5DaycareMon,
  getNumLevelsGainedForRoute5DaycareMon,
  isThereMonInRoute5Daycare,
  putMonInRoute5Daycare,
  takePokemonFromRoute5Daycare,
} from '../world/daycare';
import type { Special } from './specials';

export const DAYCARE_SPECIALS: Record<string, Special> = {
  /**
   * ChooseSendDaycareMon: ChooseMonForDaycare (party_menu.c: PARTY_MENU_TYPE_DAYCARE, STORE / SUMMARY / CANCEL;
   * STORE leaves the slot in VAR_0x8004, B leaves SLOT_CANCEL) from the field the script faded to black. Back
   * through CB2_ReturnToField, CB2_FadeFromPartyMenu fades the field in and ends the script's `waitstate`.
   */
  ChooseSendDaycareMon({ host, setWaitState }) {
    setWaitState(host.runScreenFromScript(ChooseMonForDaycare));
  },

  /** GetSelectedMonNicknameAndSpecies: gStringVar1 = the chosen party mon's nickname; returns its species. */
  GetSelectedMonNicknameAndSpecies({ state }) {
    const mon = state.party[GetCursorSelectionMonId()];
    state.stringVars[0] = boxMonNickname(state, mon); // DayCare_GetBoxMonNickname
    return mon.species;
  },

  /** PutMonInRoute5Daycare: the mon the party menu chose leaves the party for the daycare. */
  PutMonInRoute5Daycare({ state }) {
    putMonInRoute5Daycare(state, GetCursorSelectionMonId());
  },

  /** GetCostToWithdrawRoute5DaycareMon: gSpecialVar_0x8005 = the cost (gStringVar1 nickname, gStringVar2 cost). */
  GetCostToWithdrawRoute5DaycareMon({ state }) {
    state.setVar('VAR_0x8005', getCostToWithdrawRoute5DaycareMon(state));
  },

  /** IsThereMonInRoute5Daycare */
  IsThereMonInRoute5Daycare({ state }) {
    return isThereMonInRoute5Daycare(state) ? 1 : 0;
  },

  /** GetNumLevelsGainedForRoute5DaycareMon (gStringVar1 nickname, gStringVar2 the levels) */
  GetNumLevelsGainedForRoute5DaycareMon({ state }) {
    return getNumLevelsGainedForRoute5DaycareMon(state);
  },

  /** TakePokemonFromRoute5Daycare: the mon (with its daycare levels and moves) joins the party; its species. */
  TakePokemonFromRoute5Daycare({ state }) {
    return takePokemonFromRoute5Daycare(state);
  },
};
