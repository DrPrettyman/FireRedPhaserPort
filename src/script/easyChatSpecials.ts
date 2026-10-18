// easy_chat.c's specials and easy_chat_2.c's ShowEasyChatScreen (the screen is menus/easyChatScreen.ts). SPECIALS
// spreads EASY_CHAT_SPECIALS in.

import { BufferRandomHobbyOrLifestyleString, EasyChatMessageText } from '../menus/easyChat';
import { easyChatWordsForType } from '../menus/easyChatData';
import { EASY_CHAT_GFX, ShowEasyChatScreen } from '../menus/easyChatScreen';
import type { Special } from './specials';

export const EASY_CHAT_SPECIALS: Record<string, Special> = {
  /**
   * ShowEasyChatScreen (easy_chat_2.c): the Easy Chat screen for VAR_0x8004's EASY_CHAT_TYPE_* (menus/easyChatScreen.ts),
   * from the field Common_ShowEasyChatScreen has faded to black. It leaves through CB2_ReturnToFieldContinueScript;
   * cancel / confirm set VAR_RESULT, the profile and questionnaire passphrase compares VAR_0x8004. There's no
   * `waitstate`: on the GBA the script stops running when the screen takes over, and its next command (`fadescreen
   * FADE_FROM_BLACK`) has already started and finished out of sight by the time the field is back, where
   * FieldCB_ContinueScript fades it in. Here the script waits at the special until the field is back (still
   * black), and that `fadescreen` does the fade in instead (as SelectMoveDeleterMove). The mail type (VAR_0x8005's
   * mail) isn't modelled: nothing happens.
   */
  ShowEasyChatScreen({ state, host, stopScript }) {
    if (!easyChatWordsForType(state, state.getVar('VAR_0x8004'))) return; // ShowEasyChatScreen's default: return
    stopScript(host.runScreenFromScript(ShowEasyChatScreen, EASY_CHAT_GFX));
  },

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
