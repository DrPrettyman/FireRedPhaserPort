// easy_chat.c's specials (the Easy Chat screen, ShowEasyChatScreen, is a later unit). SPECIALS spreads
// EASY_CHAT_SPECIALS in.

import { BufferRandomHobbyOrLifestyleString, EasyChatMessageText } from '../menus/easyChat';
import type { Special } from './specials';

export const EASY_CHAT_SPECIALS: Record<string, Special> = {
  /**
   * ShowEasyChatMessage: the saved words for VAR_0x8004 (0 = the profile, 1-3 = the battle messages) in the field
   * message box (ShowFieldAutoScrollMessage, shown like `messageautoscroll`: see DEVIATIONS); the script's
   * `waitmessage` waits for it. Nothing for another VAR_0x8004. The Pewter Pokémon Center's profile woman
   * (mystery_event_club.inc) reads the profile back after the Easy Chat screen.
   */
  ShowEasyChatMessage({ state, showFieldMessage }) {
    const text = EasyChatMessageText(state, state.getVar('VAR_0x8004'));
    if (text) showFieldMessage(text);
  },

  /** BufferRandomHobbyOrLifestyleString: gStringVar2 = a random HOBBIES or LIFESTYLE word (no FRLG script calls it). */
  BufferRandomHobbyOrLifestyleString({ state }) {
    BufferRandomHobbyOrLifestyleString(state);
  },
};
