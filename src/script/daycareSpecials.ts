// daycare.c's script specials: the Route 5 daycare man (Route5_PokemonDayCare_EventScript_DaycareMan in
// data/scripts/day_care.inc), the Four Island daycare (FourIsland_PokemonDayCare_EventScript_DaycareWoman, and
// FourIsland_EventScript_DaycareMan's eggs), plus the field_specials.c ones their scripts and the Water
// Labyrinth's egg gentleman need. The storage and eggs they work on are world/daycare.ts. SPECIALS spreads
// DAYCARE_SPECIALS in.

import { gStringVar4 } from '../menus/common';
import { ChooseMonForDaycare, GetCursorSelectionMonId } from '../menus/partyMenu';
import { ShowDaycareLevelMenu } from '../ui/DaycareLevelMenu';
import {
  boxMonNickname,
  daycareMonReceivedMail,
  getCostToWithdrawRoute5DaycareMon,
  getDaycareCost,
  getDaycareMonNicknames,
  getDaycarePokemonCount,
  getDaycareState,
  getNumLevelsGainedForRoute5DaycareMon,
  getNumLevelsGainedFromDaycare,
  giveEggFromDaycare,
  isThereMonInRoute5Daycare,
  putMonInRoute5Daycare,
  rejectEggFromDayCare,
  setDaycareCompatibilityString,
  storeSelectedPokemonInDaycare,
  takePokemonFromDaycare,
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

  // ---------------------------------------------------------------- the Four Island daycare

  /** StoreSelectedPokemonInDaycare: the mon the party menu chose goes into the first empty slot. */
  StoreSelectedPokemonInDaycare({ state }) {
    storeSelectedPokemonInDaycare(state, GetCursorSelectionMonId());
  },

  /** GetDaycareState: DAYCARE_NO_MONS, DAYCARE_EGG_WAITING, DAYCARE_ONE_MON or DAYCARE_TWO_MONS. */
  GetDaycareState({ state }) {
    return getDaycareState(state);
  },

  /** GetDaycarePokemonCount */
  GetDaycarePokemonCount({ state }) {
    return getDaycarePokemonCount(state);
  },

  /** GetDaycareMonNicknames: gStringVar1/2 = the two nicknames, gStringVar3 = the first one's OT. */
  GetDaycareMonNicknames({ state }) {
    getDaycareMonNicknames(state);
  },

  /** GetNumLevelsGainedFromDaycare: slot VAR_0x8004's levels gained (gStringVar1 nickname, gStringVar2 levels). */
  GetNumLevelsGainedFromDaycare({ state }) {
    return getNumLevelsGainedFromDaycare(state, state.getVar('VAR_0x8004'));
  },

  /** GetDaycareCost: gSpecialVar_0x8005 = slot VAR_0x8004's cost (gStringVar1 nickname, gStringVar2 cost). */
  GetDaycareCost({ state }) {
    state.setVar('VAR_0x8005', getDaycareCost(state, state.getVar('VAR_0x8004')));
  },

  /** TakePokemonFromDaycare: slot VAR_0x8004's mon joins the party (the other moves up); its species. */
  TakePokemonFromDaycare({ state }) {
    return takePokemonFromDaycare(state, state.getVar('VAR_0x8004'));
  },

  /** ShowDaycareLevelMenu: VAR_RESULT = 0 / 1 for a mon, DAYCARE_EXITED_LEVEL_MENU for EXIT or B. */
  ShowDaycareLevelMenu({ state, host, setWaitState }) {
    setWaitState(ShowDaycareLevelMenu(state, host.listMenuHost()));
  },

  /** GiveEggFromDaycare: the pending egg joins the party. */
  GiveEggFromDaycare({ state }) {
    giveEggFromDaycare(state);
  },

  /** RejectEggFromDayCare: the pending egg is gone. */
  RejectEggFromDayCare({ state }) {
    rejectEggFromDayCare(state);
  },

  /**
   * DaycareMonReceivedMail: whether slot VAR_0x8004's mon holds mail from someone else or under another nickname
   * (gStringVar1 its nickname, gStringVar2 / 3 the stored OT name and nickname). No FRLG script calls it.
   */
  DaycareMonReceivedMail({ state }) {
    return daycareMonReceivedMail(state) ? 1 : 0;
  },

  /** SetDaycareCompatibilityString: gStringVar4 = how well the two get along. */
  SetDaycareCompatibilityString({ state }) {
    setDaycareCompatibilityString(state);
  },

  // ---------------------------------------------------------------- field_specials.c

  /** ShowFieldMessageStringVar4: ShowFieldMessage(gStringVar4); the script's `waitmessage` waits for it. */
  ShowFieldMessageStringVar4({ showFieldMessage }) {
    showFieldMessage(gStringVar4);
  },

  /**
   * PlayerPartyContainsSpeciesWithPlayerID: a party mon of species VAR_0x8004 (MON_DATA_SPECIES_OR_EGG: an egg
   * counts as SPECIES_EGG) with the player's trainer ID as its OT ID.
   */
  PlayerPartyContainsSpeciesWithPlayerID({ state }) {
    const species = state.getVar('VAR_0x8004');
    const SPECIES_EGG = state.defines.require('SPECIES_EGG');
    return state.party.some((m) => (m.isEgg ? SPECIES_EGG : m.species) === species && m.otId >>> 0 === state.trainerId >>> 0) ? 1 : 0;
  },
};
