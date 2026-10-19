// help_system.c's menus: RunHelpMenuSubroutine, the help system's state machine while it's up (the welcome page,
// the topics, a topic's submenu, a help item), run by RunHelpSystemCallback (ui/helpSystem.ts). The contexts and
// the lists they give are ui/helpSystemContext.ts.

import { K } from '../battle/constants';
import { A_BUTTON, B_BUTTON, L_BUTTON, R_BUTTON } from '../gba/main';
import { PlaySE } from '../gba/sound';
import {
  gHelpSystemListMenu,
  HelpSystem_FillPanel1,
  HelpSystem_FillPanel2,
  HelpSystem_GetMenuInput,
  HelpSystem_InitListMenuController,
  HelpSystem_JOY_NEW as JOY_NEW,
  HelpSystem_PrintQuestionAndAnswerPair,
  HelpSystem_PrintTextAt,
  HelpSystem_PrintTextRightAlign_Row52,
  HelpSystem_PrintTopicMouseoverDescription,
  HelpSystem_SetInputDelay,
  HelpSystemVideoState,
  HS_SetMainWindowBgBrightness,
  HS_ShowOrHideControlsGuideInTopRight,
  HS_ShowOrHideHeaderAndFooterLines_Darker,
  HS_ShowOrHideHeaderAndFooterLines_Lighter,
  HS_ShowOrHideHeaderLine_Darker_FooterStyle,
  HS_ShowOrHideMainWindowText,
  HS_ShowOrHideScrollArrows,
  HS_ShowOrHideToplevelTooltipWindow,
  HS_UpdateMenuScrollArrows,
  IsHelpSystemOpen,
} from './helpSystem';
import {
  ANSWER_TABLES,
  BuildMainTopicsListAndMoveToH00,
  GetHelpContext,
  gHelpSystemEnabled,
  gHelpSystemState,
  gHelpSystemToggleWithRButtonDisabled,
  helpString,
  label,
  QUESTION_TABLES,
  SetHelpSystemSubmenuItems,
  TOPIC_EXIT,
  type HelpListMenuItem,
  type HelpSystemListMenu,
} from './helpSystemContext';

function ResetHelpSystemListMenu(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  helpListMenu.sub.items = listMenuItemsBuffer;
  helpListMenu.sub.totalItems = 1;
  helpListMenu.sub.maxShowed = 1;
  helpListMenu.sub.left = 1;
  helpListMenu.sub.top = 4;
}

function BuildAndPrintMainTopicsListMenu(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  ResetHelpSystemListMenu(helpListMenu, listMenuItemsBuffer);
  BuildMainTopicsListAndMoveToH00(helpListMenu, listMenuItemsBuffer);
  PrintTextOnPanel2Row52RightAlign(helpString('gText_HelpSystemControls_PickOkEnd'));
  HelpSystem_InitListMenuController(helpListMenu, 0, gHelpSystemState.scrollMain);
  PrintHelpSystemTopicMouseoverDescription(helpListMenu, listMenuItemsBuffer);
  HS_ShowOrHideMainWindowText(1);
  HS_ShowOrHideControlsGuideInTopRight(1);
}

/** BuildMainTopicsListAndMoveToH00: the context's topics in sHelpSystemContextTopicOrder; the last (EXIT) is -2. */
function BuildAndPrintSubmenuList(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  HS_SetMainWindowBgBrightness(0);
  HS_ShowOrHideHeaderLine_Darker_FooterStyle(0);
  HS_ShowOrHideHeaderAndFooterLines_Lighter(1);
  ResetHelpSystemListMenu(helpListMenu, listMenuItemsBuffer);
  SetHelpSystemSubmenuItems(helpListMenu, listMenuItemsBuffer);
  PrintTextOnPanel2Row52RightAlign(helpString('gText_HelpSystemControls_PickOkCancel'));
  HelpSystem_InitListMenuController(helpListMenu, helpListMenu.itemsAbove, helpListMenu.cursorPos);
  HelpSystem_PrintTextAt(label('sHelpSystemTopicPtrs', gHelpSystemState.topic), 0, 0);
  HS_ShowOrHideMainWindowText(1);
  HS_ShowOrHideControlsGuideInTopRight(1);
}

/** The label table a topic's submenu items come from (SetHelpSystemSubmenuItems), and its answers' (HelpItemPrint). */
// ------------------------------------------------------------------ RunHelpMenuSubroutine

/** RunHelpMenuSubroutine: FALSE closes the help. */
export function RunHelpMenuSubroutine(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  switch (helpListMenu.state) {
    case 8:
      return HelpSystemSubroutine_PrintWelcomeMessage(helpListMenu, listMenuItemsBuffer);
    case 9:
      return HelpSystemSubroutine_WelcomeWaitButton(helpListMenu, listMenuItemsBuffer);
    case 10:
      return HelpSystemSubroutine_WelcomeEndGotoMenu(helpListMenu, listMenuItemsBuffer);
    case 0:
      return HelpSystemSubroutine_MenuInputHandlerMain(helpListMenu, listMenuItemsBuffer);
    case 1:
      return HelpMenuSubroutine_InitSubmenu(helpListMenu, listMenuItemsBuffer);
    case 2:
      return HelpMenuSubroutine_ReturnFromSubmenu(helpListMenu, listMenuItemsBuffer);
    case 3:
      return HelpMenuSubroutine_SubmenuInputHandler(helpListMenu, listMenuItemsBuffer);
    case 4:
      return HelpMenuSubroutine_HelpItemPrint(helpListMenu, listMenuItemsBuffer);
    case 5:
      return HelpMenuSubroutine_ReturnFromHelpItem(helpListMenu, listMenuItemsBuffer);
    case 6:
      return HelpMenuSubroutine_HelpItemWaitButton(helpListMenu, listMenuItemsBuffer);
  }
  return false;
}

export function HelpSystemSubroutine_PrintWelcomeMessage(helpListMenu: HelpSystemListMenu, _listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  PrintTextOnPanel2Row52RightAlign(helpString('gText_HelpSystemControls_A_Next'));
  PrintWelcomeMessageOnPanel1();
  HS_ShowOrHideMainWindowText(1);
  HS_ShowOrHideControlsGuideInTopRight(1);
  helpListMenu.state = 9;
  return true;
}

function HelpSystemSubroutine_WelcomeWaitButton(helpListMenu: HelpSystemListMenu, _listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    helpListMenu.state = 10;
  }
  return true;
}

export function HelpSystemSubroutine_WelcomeEndGotoMenu(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  gHelpSystemState.scrollMain = 0;
  ResetHelpSystemCursor(helpListMenu);
  BuildAndPrintMainTopicsListMenu(helpListMenu, listMenuItemsBuffer);
  helpListMenu.state = 0;
  return true;
}

function HelpSystemSubroutine_MenuInputHandlerMain(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  const input = HelpSystem_GetMenuInput();
  switch (input) {
    case -6:
    case -2:
      return false;
    case -5:
    case -4:
      PrintHelpSystemTopicMouseoverDescription(helpListMenu, listMenuItemsBuffer);
      break;
    case -3:
    case -1:
      break;
    default:
      gHelpSystemState.topic = input;
      helpListMenu.state = 1;
      break;
  }
  return true;
}

function HelpMenuSubroutine_InitSubmenu(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  gHelpSystemState.level = 1;
  gHelpSystemState.scrollMain = helpListMenu.cursorPos;
  ResetHelpSystemCursor(helpListMenu);
  BuildAndPrintSubmenuList(helpListMenu, listMenuItemsBuffer);
  HS_UpdateMenuScrollArrows();
  HelpSystem_SetInputDelay(2);
  helpListMenu.state = 3;
  return true;
}

function HelpMenuSubroutine_ReturnFromSubmenu(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  HS_ShowOrHideScrollArrows(0, 0);
  HS_ShowOrHideScrollArrows(1, 0);
  gHelpSystemState.level = 0;
  BuildAndPrintMainTopicsListMenu(helpListMenu, listMenuItemsBuffer);
  helpListMenu.state = 0;
  return true;
}

function HelpMenuSubroutine_SubmenuInputHandler(helpListMenu: HelpSystemListMenu, _listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  const input = HelpSystem_GetMenuInput();
  switch (input) {
    case -6:
      return false;
    case -2:
      helpListMenu.state = 2;
      break;
    case -5:
    case -4:
    case -3:
    case -1:
      break;
    default:
      gHelpSystemState.scrollSub = input;
      helpListMenu.state = 4;
      break;
  }
  return true;
}

export function HelpSystem_PrintTopicLabel(): void {
  HelpSystem_PrintTextAt(label('sHelpSystemTopicPtrs', gHelpSystemState.topic), 0, 0);
}

function HelpMenuSubroutine_HelpItemPrint(helpListMenu: HelpSystemListMenu, _listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  gHelpSystemState.level = 2;
  HS_ShowOrHideMainWindowText(0);
  HelpSystem_FillPanel1();
  PrintTextOnPanel2Row52RightAlign(helpString('gText_HelpSystemControls_AorBtoCancel'));
  HS_SetMainWindowBgBrightness(1);
  HS_ShowOrHideHeaderAndFooterLines_Darker(1);
  const topic = gHelpSystemState.topic;
  HelpSystem_PrintQuestionAndAnswerPair(label(QUESTION_TABLES[topic], gHelpSystemState.scrollSub), label(ANSWER_TABLES[topic], gHelpSystemState.scrollSub));
  HS_ShowOrHideMainWindowText(1);
  HS_ShowOrHideControlsGuideInTopRight(1);
  helpListMenu.state = 6;
  return true;
}

function HelpMenuSubroutine_ReturnFromHelpItem(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  gHelpSystemState.level = 1;
  BuildAndPrintSubmenuList(helpListMenu, listMenuItemsBuffer);
  HS_UpdateMenuScrollArrows();
  HelpSystem_SetInputDelay(2);
  helpListMenu.state = 3;
  return true;
}

function HelpMenuSubroutine_HelpItemWaitButton(helpListMenu: HelpSystemListMenu, _listMenuItemsBuffer: HelpListMenuItem[]): boolean {
  if (JOY_NEW(B_BUTTON) || JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    helpListMenu.state = 5;
    return true;
  }
  if (JOY_NEW(L_BUTTON | R_BUTTON)) return false;
  return true;
}

function PrintWelcomeMessageOnPanel1(): void {
  HelpSystem_FillPanel1();
  HelpSystem_PrintTextAt(helpString('Help_Text_Greetings'), 0, 0);
}

function PrintTextOnPanel2Row52RightAlign(str: number[]): void {
  HelpSystem_FillPanel2();
  HelpSystem_PrintTextRightAlign_Row52(str);
}

export function GetHelpSystemMenuLevel(): number {
  return gHelpSystemState.level;
}

function ResetHelpSystemCursor(helpListMenu: HelpSystemListMenu): void {
  helpListMenu.itemsAbove = 0;
  helpListMenu.cursorPos = 0;
}

function PrintHelpSystemTopicMouseoverDescription(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  const index = listMenuItemsBuffer[helpListMenu.itemsAbove + helpListMenu.cursorPos].index;
  HelpSystem_PrintTopicMouseoverDescription(label('sHelpSystemTopicMouseoverDescriptionPtrs', index === -2 ? TOPIC_EXIT : index));
  HS_ShowOrHideToplevelTooltipWindow(1);
}

// ------------------------------------------------------------------ dev probe

/**
 * The help system for the tests (`__test.helpSystem()`): RunHelpSystemCallback's state (5 = up and taking input),
 * RunHelpMenuSubroutine's, gHelpSystemState, the context and the list shown (labels encoded).
 */
export function helpSystemProbe() {
  const m = gHelpSystemListMenu;
  return {
    open: IsHelpSystemOpen(),
    videoState: HelpSystemVideoState(),
    menuState: m.state,
    level: gHelpSystemState.level,
    topic: gHelpSystemState.topic,
    scrollSub: gHelpSystemState.scrollSub,
    context: GetHelpContext(),
    enabled: gHelpSystemEnabled,
    toggleWithRButtonDisabled: gHelpSystemToggleWithRButtonDisabled,
    itemsAbove: m.itemsAbove,
    cursorPos: m.cursorPos,
    items: m.sub.items.slice(0, m.sub.totalItems).map((it) => ({ label: it.label, index: it.index })),
  };
}
