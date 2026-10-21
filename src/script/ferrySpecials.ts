// The Seagallop ferry's specials (W-ferry), spread into SPECIALS: seagallop.c's DoSeagallopFerryScene,
// GetSeagallopNumber and IsPlayerLeftOfVermilionSailor (menus/seagallop.ts), and script_menu.c's two-page
// destination menu for the Rainbow Pass (DrawSeagallopDestinationMenu / GetSelectedSeagallopDestination) on the
// field's multichoice menu. No Phaser here.

import {
  DoSeagallopFerryScene,
  GetSeagallopNumber,
  IsPlayerLeftOfVermilionSailor,
  SEAGALLOP_FIVE_ISLAND,
  SEAGALLOP_FOUR_ISLAND,
  SEAGALLOP_GFX,
  SEAGALLOP_SEVEN_ISLAND,
  SEAGALLOP_SIX_ISLAND,
  SEAGALLOP_VERMILION_CITY,
  SeagallopWarpWait,
} from '../menus/seagallop';
import { EOS } from '../text/charmap';
import { SCR_MENU_CANCEL, SCR_MENU_UNSET } from '../ui/MultichoiceMenu';
import type { Special } from './specials';
import { avoidDisplay } from './scriptMenuAvoidDisplay';

const SEAGALLOP_MORE = 254; // include/constants/seagallop.h
const MULTICHOICE_NONE = 255;

/** sSeagallopDestStrings (script_menu.c), by SEAGALLOP_* */
const sSeagallopDestStrings = ['gText_Vermilion', 'gText_OneIsland', 'gText_TwoIsland', 'gText_ThreeIsland', 'gText_FourIsland', 'gText_FiveIsland', 'gText_SixIsland', 'gText_SevenIsland'];

/**
 * DrawSeagallopDestinationMenu's items: page 0 (VAR_0x8005) is Vermilion to Four Island, page 1 Four or Five to
 * Seven Island; the origin (VAR_0x8004) is skipped, and OTHER and EXIT come last. Returns the SEAGALLOP_* list
 * (without OTHER / EXIT) and the window's top row.
 */
export function SeagallopDestinationMenuItems(origin: number, page: number): { destinations: number[]; top: number; numItems: number } {
  let destinationId: number;
  let numItems: number;
  let top: number;
  if (page === 1) {
    destinationId = origin < SEAGALLOP_FIVE_ISLAND ? SEAGALLOP_FIVE_ISLAND : SEAGALLOP_FOUR_ISLAND;
    numItems = 5;
    top = 2;
  } else {
    destinationId = SEAGALLOP_VERMILION_CITY;
    numItems = 6;
    top = 0;
  }
  const destinations: number[] = [];
  // -2 excludes "Other" and "Exit", appended after the loop
  for (let i = 0; i < numItems - 2; i++) {
    if (destinationId !== origin) destinations.push(destinationId);
    else i--;
    destinationId++;
    // Wrap around
    if (destinationId === SEAGALLOP_SEVEN_ISLAND + 1) destinationId = SEAGALLOP_VERMILION_CITY;
  }
  return { destinations, top, numItems };
}

/** GetSelectedSeagallopDestination: the menu's VAR_RESULT as a SEAGALLOP_* (or SEAGALLOP_MORE / SCR_MENU_CANCEL). */
export function GetSelectedSeagallopDestination(result: number, origin: number, page: number): number {
  if (result === SCR_MENU_CANCEL) return SCR_MENU_CANCEL;
  if (page === 1) {
    if (result === 3) return SEAGALLOP_MORE;
    if (result === 4) return SCR_MENU_CANCEL;
    if (result === 0) return origin > SEAGALLOP_FOUR_ISLAND ? SEAGALLOP_FOUR_ISLAND : SEAGALLOP_FIVE_ISLAND;
    if (result === 1) return origin > SEAGALLOP_FIVE_ISLAND ? SEAGALLOP_FIVE_ISLAND : SEAGALLOP_SIX_ISLAND;
    if (result === 2) return origin > SEAGALLOP_SIX_ISLAND ? SEAGALLOP_SIX_ISLAND : SEAGALLOP_SEVEN_ISLAND;
  } else {
    if (result === 4) return SEAGALLOP_MORE;
    if (result === 5) return SCR_MENU_CANCEL;
    if (result >= origin) return result + 1;
    return result;
  }
  return SEAGALLOP_VERMILION_CITY;
}

export const FERRY_SPECIALS: Record<string, Special> = {
  /**
   * DoSeagallopFerryScene: SetMainCallback2(CB2_SetUpSeagallopScene) (menus/seagallop.ts). The scene ends in a
   * warp (WarpIntoMap + CB2_LoadMap), whose ScriptContext_Init ends the script that waits on it with `waitstate`.
   * Until then the script stays stopped, which keeps the field's controls from the player: the field runs out the
   * frame's ticks after the special, and an A press there talked to the Vermilion sailor in front of the player,
   * whose script then ran on at the destination. Once the warp has started, the wait ends and the script reaches
   * its `end`.
   */
  DoSeagallopFerryScene({ host, setWaitState }) {
    const warped = SeagallopWarpWait();
    host.runScreenFromScript(DoSeagallopFerryScene, SEAGALLOP_GFX);
    setWaitState(warped);
  },

  /** GetSeagallopNumber: the ferry's number for "All aboard SEAGALLOP HI-SPEED ##" (VAR_0x8004 → VAR_0x8006). */
  GetSeagallopNumber({ state }) {
    return GetSeagallopNumber(state.getVar('VAR_0x8004'), state.getVar('VAR_0x8006'));
  },

  /** IsPlayerLeftOfVermilionSailor: EventScript_CancelSail walks the player back up Vermilion's pier. */
  IsPlayerLeftOfVermilionSailor({ state, host }) {
    return IsPlayerLeftOfVermilionSailor(state.currentMapId, host.playerLocal().x) ? 1 : 0;
  },

  /**
   * DrawSeagallopDestinationMenu (script_menu.c): the Rainbow Pass menu, a std-framed window from rect
   * (17, top, 11, numItems * 2) with 16 px rows, on the multichoice input task (CreateMCMenuInputHandlerTask:
   * B cancels, it wraps with more than 3 items). Its `waitstate` ends the frame after the choice, with it in
   * VAR_RESULT. QL_AvoidDisplay first: in playback no menu, and the `waitstate` stops the script until
   * QL_DestroyAbortedDisplay replaces it.
   */
  DrawSeagallopDestinationMenu(env) {
    const { state, host, setWaitState, encodeText } = env;
    state.setVar('VAR_RESULT', SCR_MENU_UNSET);
    if (avoidDisplay(env)) return setWaitState(() => false);
    const { destinations, top, numItems } = SeagallopDestinationMenuItems(state.getVar('VAR_0x8004'), state.getVar('VAR_0x8005'));
    const item = (label: string) => [...encodeText(label), EOS];
    const items = [...destinations.map((dest) => item(sSeagallopDestStrings[dest])), item('gText_Other'), item('gOtherText_Exit')];
    const menu = host.openMultichoice({
      left: 17,
      top,
      mcId: MULTICHOICE_NONE,
      items,
      ignoreBPress: false,
      initPos: 0,
      layout: { width: 11, height: numItems * 2, rowHeight: 16 },
    });
    // Task_MultichoiceMenu_HandleInput's ScriptContext_Enable: the script runs on in the next frame's
    // ScriptContext_RunScript, not in the frame of the press (else the A that picks OTHER would also pick the
    // first item of the page the script draws next).
    let chosen = false;
    setWaitState(() => {
      if (chosen) return true;
      if (!menu.tick()) return false;
      state.setVar('VAR_RESULT', menu.result);
      chosen = true;
      return false;
    });
  },

  /** GetSelectedSeagallopDestination (script_menu.c) */
  GetSelectedSeagallopDestination({ state }) {
    return GetSelectedSeagallopDestination(state.getVar('VAR_RESULT'), state.getVar('VAR_0x8004'), state.getVar('VAR_0x8005'));
  },
};
