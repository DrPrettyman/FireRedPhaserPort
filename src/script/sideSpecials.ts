// Small side-content specials (SIDE_PLAN.md W-daycare): Prof. Oak's Pokédex rating and the help context pair it
// uses. Kept apart from specials.ts like storySpecials.ts; SPECIALS spreads this table in. No Phaser here: the
// museum's fossil pic (it draws) registers itself from ui/MuseumFossilPic.ts.

import { FLAG_GET_CAUGHT, GetSetPokedexFlag, HasAllMons } from '../menus/pokedex';
import type { GameState } from '../state/GameState';
import type { Special } from './specials';

/**
 * GetProfOaksRatingMessageByCount (prof_pc.c): Oak's rating for `count` Kanto mons caught, and whether the Kanto
 * dex counts as complete (gSpecialVar_Result). Mew doesn't count: 150 caught without Mew is complete, 150 with
 * Mew (so one other missing) is not.
 */
export function GetProfOaksRatingMessageByCount(state: GameState, count: number): { label: string; complete: boolean } {
  const kantoDexCount = state.pokemon.tables.kantoDexCount;
  if (count < 150) {
    // PokedexRating_Text_LessThan10 .. LessThan150, one per ten
    return { label: `PokedexRating_Text_LessThan${(Math.floor(count / 10) + 1) * 10}`, complete: false };
  }
  if (count === kantoDexCount - 1) {
    if (GetSetPokedexFlag(state, state.pokemon.nationalDex(state.defines.require('SPECIES_MEW')), FLAG_GET_CAUGHT))
      return { label: 'PokedexRating_Text_LessThan150', complete: false };
    return { label: 'PokedexRating_Text_Complete', complete: true };
  }
  if (count === kantoDexCount) return { label: 'PokedexRating_Text_Complete', complete: true };
  return { label: 'PokedexRating_Text_LessThan10', complete: false };
}

export const SIDE_SPECIALS: Record<string, Special> = {
  /**
   * GetProfOaksRatingMessage (prof_pc.c): ShowFieldMessage(the rating for VAR_0x8004 Kanto mons caught);
   * gSpecialVar_Result = whether the Kanto dex is complete. The script's `waitmessage` waits for it to print.
   * PokedexRating_EventScript_ShowRatingMsg, from Oak in his lab and from "PROF. OAK's PC".
   */
  GetProfOaksRatingMessage({ state, showFieldMessage }) {
    const { label, complete } = GetProfOaksRatingMessageByCount(state, state.getVar('VAR_0x8004'));
    state.setVar('VAR_RESULT', complete ? 1 : 0);
    showFieldMessage(label);
  },

  /** HasAllMons (pokedex.c): every mon caught but Mew, Lugia, Ho-Oh, Celebi, Jirachi and Deoxys. */
  HasAllMons({ state }) {
    return HasAllMons(state) ? 1 : 0;
  },

  // help_system.c: the L/R help system isn't ported, so its context is never read (like Script_SetHelpContext).
  /** BackupHelpContext: sHelpSystemContextBackup = the current context (the Pokédex rating, the Hall of Fame PC). */
  BackupHelpContext() {},
  /** RestoreHelpContext */
  RestoreHelpContext() {},
};
