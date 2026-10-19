import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { GetMenuCursorDimensionByFont } from '../gba/menu';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { CB2_ReturnToField } from '../menus/fieldCallbacks';
import { ConvertInternationalString, mailGfxSymbols, ReadMail, StringLength } from '../menus/mail';
import { ChooseMonToGiveMailFromMailbox } from '../menus/partyMenu';
import type { GameState } from '../state/GameState';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { ClearMailStruct, CountPCMail, gPlayerPcMenuManager, PCMailCompaction, selectedPcMail } from '../world/mail';
import { KeyRepeat, LIST_CANCEL, LIST_NOTHING_CHOSEN } from './FieldListMenu';
import { BackupHelpContext, RestoreHelpContext, SetHelpContext } from './helpSystemContext';
import { MailboxPc, MAILBOX_WINDOWS } from './MailboxPc';
import { MenuWindow } from './MenuWindow';
import { YesNoMenu } from './YesNoMenu';

/** What the player's PC needs from the overworld. */
export interface PlayerPcMenuHost {
  /** The encoded C string (gText_* / gOtherText_* / gFameCheckerText_*). */
  text(symbol: string): number[];
  /** The game state (the mailbox's slots, the bag, the party). */
  state: GameState;
  /** CountItemsInPC */
  countItemsInPc(): number;
  /** DisplayItemMessageOnField(FONT_NORMAL): the wait ends when the text has printed. */
  displayItemMessageOnField(str: number[]): () => boolean;
  /** ClearDialogWindowAndFrame(0, FALSE) */
  hideMessage(): void;
  /** PrintStringOnWindow0WithDialogueFrame: DrawDialogueFrame + an instant print. */
  showDescription(str: number[]): void;
  /** FadeScreen(FADE_TO_BLACK, 0); the wait ends when the fade has finished. */
  fadeToBlack(): () => boolean;
  /**
   * WITHDRAW ITEM: CleanupOverworldWindowsAndTilemaps + ItemPc_Init (FieldMenuScene 'itemPc'); DEPOSIT ITEM:
   * GoToBagMenu(ITEMMENULOCATION_ITEMPC) ('itemPcDeposit'). Both come back through CB2_ReturnToField, after which
   * the field calls `onReturn` (gFieldCallback = CB2_ReturnFromWithdrawMenu / CB2_ReturnFromDepositMenu).
   */
  enter(menu: 'itemPc' | 'itemPcDeposit', onReturn: () => void): void;
  /**
   * The mailbox's READ (ReadMail) and GIVE (ChooseMonToGiveMailFromMailbox): CleanupOverworldWindowsAndTilemaps,
   * then `init` sets up the GBA-layer screen (with `gfxSymbols` loaded first), which leaves through
   * CB2_ReturnToField; the field then calls `onReturn` (gFieldCallback = CB2_ReturnToMailbox /
   * CB2_ReturnToMailboxPc_UpdateScrollVariables) with the screen still black.
   */
  enterScreen(init: () => void, gfxSymbols: string[], onReturn: () => void): void;
  /** FadeInFromBlack; the wait ends when the fade has finished (IsWeatherNotFadingIn). */
  fadeInFromBlack(): () => boolean;
}

/** sWindowTemplate_TopMenu_3Items: tile (1, 1), 13x6 */
const TOP_MENU_RECT = { left: 1, top: 1, width: 13, height: 6 };
/** sWindowTemplate_ItemStorageSubmenu: tile (1, 1), 14x6 */
const SUBMENU_RECT = { left: 1, top: 1, width: 14, height: 6 };

/** sMenuActions_TopMenu in sItemOrder_PlayerPC / sItemOrder_BedroomPC order (0, 1, 2) */
const TOP_MENU = ['gText_ItemStorage', 'gText_Mailbox', 'gText_TurnOff'];
const TOP_ITEM_STORAGE = 0;
const TOP_MAILBOX = 1;
/** sMenuActions_ItemPc */
const ITEM_PC_MENU = ['gText_WithdrawItem2', 'gText_DepositItem2', 'gFameCheckerText_Cancel'];
const ITEM_PC_WITHDRAW = 0;
const ITEM_PC_DEPOSIT = 1;
/** sItemStorageActionDescriptionPtrs */
const ITEM_PC_DESCRIPTIONS = ['gText_TakeOutItemsFromThePC', 'gText_StoreItemsInThePC', 'gText_GoBackToThePreviousMenu'];

/** sMenuActions_MailSubmenu */
const MAIL_SUBMENU = ['gOtherText_Read', 'gOtherText_MoveToBag', 'gOtherText_Give2', 'gOtherText_Exit'];
const MAIL_READ = 0;
const MAIL_MOVE_TO_BAG = 1;
const MAIL_GIVE = 2;

type Phase = 'message' | 'topMenu' | 'submenu' | 'fade' | 'away' | 'fadeIn' | 'task' | 'mailbox' | 'mailSubmenu' | 'yesNo';

/** The player's PC while it's up, for the probe. */
let sPlayerPc: PlayerPcMenu | undefined;

/** The mailbox while the player's PC shows it (dev probe). */
export interface MailboxProbe {
  /** 'mailbox' (Task_MailboxPcHandleInput), 'mailSubmenu', 'yesNo', 'message', 'fade', 'away', 'fadeIn', ... */
  phase: string;
  /** gPlayerPcMenuManager's list state */
  count: number;
  cursorPos: number;
  itemsAbove: number;
  pageItems: number;
  /** Whether the list (window 1) is up, and the submenu's cursor while it is */
  listShown: boolean;
  submenuCursor?: number;
}

/** Dev: the player's PC mailbox, while the PC is on. */
export function mailboxProbe(): MailboxProbe | undefined {
  return sPlayerPc?.probe();
}

/**
 * player_pc.c's field side: PlayerPC / BedroomPC (ITEM STORAGE / MAILBOX / TURN OFF), the item storage
 * submenu (WITHDRAW ITEM / DEPOSIT ITEM / CANCEL with its descriptions) and the way back from the item PC and
 * the bag (CB2_ReturnFromWithdrawMenu / CB2_ReturnFromDepositMenu), and the MAILBOX (Task_PlayerPcMailbox: the
 * list of the mails in gSaveBlock1Ptr->mail's PC slots, ui/MailboxPc.ts; READ / MOVE TO BAG / GIVE / EXIT).
 * `done` is set when the player turns the PC off (Task_PlayerPcTurnOff).
 */
export class PlayerPcMenu {
  done = false;
  private phase: Phase = 'message';
  private win?: MenuWindow;
  private cursorPos = 0;
  private count = 0;
  private wait?: () => boolean;
  private next?: () => void;
  /** gTasks[taskId].func while the phase is 'task' (a one-frame step) */
  private task?: () => void;
  private yesNo?: YesNoMenu;
  private readonly mailbox: MailboxPc;
  /** JOY_REPT for the submenu */
  private readonly keys: KeyRepeat;

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private host: PlayerPcMenuHost,
    /** gPlayerPcMenuManager.notInRoom: PlayerPC (TRUE) or BedroomPC (FALSE) */
    private notInRoom = true,
  ) {
    this.keys = new KeyRepeat(input);
    this.mailbox = new MailboxPc(scene, fonts, input, host.state, (symbol) => host.text(symbol));
    sPlayerPc = this;
    gPlayerPcMenuManager.notInRoom = notInRoom; // the mail screen's help context reads it
    BackupHelpContext();
    // PlayerPC / BedroomPC: DisplayItemMessageOnField(gText_WhatWouldYouLikeToDo, Task_DrawPlayerPcTopMenu)
    this.message(this.host.text('gText_WhatWouldYouLikeToDo'), () => this.Task_DrawPlayerPcTopMenu());
  }

  /** One frame; true once the PC is off. */
  tick(): boolean {
    if (this.done) return true;
    this.keys.sample();
    this.mailbox.tickSprites(); // Task_ScrollIndicatorArrowPair, AnimateSprites
    switch (this.phase) {
      case 'message':
      case 'fade':
      case 'fadeIn':
        if (this.wait!()) {
          const next = this.next!;
          this.wait = this.next = undefined;
          next();
        }
        break;
      case 'topMenu':
        this.Task_TopMenuHandleInput();
        break;
      case 'submenu':
        this.Task_TopMenu_ItemStorageSubmenu_HandleInput();
        break;
      case 'away':
        break;
      case 'task': {
        const task = this.task!;
        this.task = undefined;
        task();
        break;
      }
      case 'mailbox':
        this.Task_MailboxPcHandleInput();
        break;
      case 'mailSubmenu':
        this.Task_MailSubmenuHandleInput();
        break;
      case 'yesNo':
        this.Task_MoveToBagYesNoMenuHandleInput();
        break;
    }
    this.win?.flush();
    this.mailbox.flush();
    if (this.done && sPlayerPc === this) sPlayerPc = undefined;
    return this.done;
  }

  /** gTasks[taskId].func = `task`: it runs on the next frame. */
  private setTask(task: () => void): void {
    this.phase = 'task';
    this.task = task;
  }

  probe(): MailboxProbe {
    const m = gPlayerPcMenuManager;
    return {
      phase: this.phase,
      count: m.count,
      cursorPos: m.cursorPos,
      itemsAbove: m.itemsAbove,
      pageItems: m.pageItems,
      listShown: this.mailbox.list !== undefined,
      submenuCursor: this.phase === 'mailSubmenu' ? this.cursorPos : undefined,
    };
  }

  private message(str: number[], next: () => void): void {
    this.phase = 'message';
    this.wait = this.host.displayItemMessageOnField(str);
    this.next = next;
  }

  private openWindow(rect: typeof TOP_MENU_RECT, labels: string[], cursorPos: number): void {
    // SetStdWindowBorderStyle + PrintTextArray / AddItemMenuActionTextPrinters + Menu_InitCursor
    this.win = new MenuWindow(this.scene, rect, this.fonts, this.input, 'std');
    const cursorWidth = GetMenuCursorDimensionByFont(FONT_NORMAL, 0); // 8, not the font's maxLetterWidth (10)
    labels.forEach((label, i) => this.win!.print(this.host.text(label), cursorWidth, 2 + i * 16));
    this.count = labels.length;
    this.cursorPos = cursorPos;
    this.drawCursor();
  }

  private closeWindow(): void {
    this.win?.destroy();
    this.win = undefined;
  }

  private drawCursor(): void {
    this.win!.print(this.host.text('gText_SelectorArrow2'), 0, 2 + this.cursorPos * 16);
  }

  /** Menu_MoveCursor: wraps around. */
  private moveCursorWrap(delta: number): void {
    this.win!.clearRect(0, 2 + this.cursorPos * 16, 8, 16);
    this.cursorPos = (this.cursorPos + delta + this.count) % this.count;
    this.drawCursor();
  }

  /** Menu_MoveCursorNoWrapAround: whether it moved. */
  private moveCursor(delta: number): boolean {
    const next = this.cursorPos + delta;
    if (next < 0 || next >= this.count) return false;
    this.win!.clearRect(0, 2 + this.cursorPos * 16, 8, 16);
    this.cursorPos = next;
    this.drawCursor();
    return true;
  }

  private Task_DrawPlayerPcTopMenu(): void {
    this.openWindow(TOP_MENU_RECT, TOP_MENU, 0);
    this.phase = 'topMenu';
  }

  /** Task_TopMenuHandleInput (Menu_ProcessInputNoWrapAround: SE_SELECT on A and on a cursor move) */
  private Task_TopMenuHandleInput(): void {
    if (this.input.pressed('A')) {
      PlaySE(K.SE_SELECT);
      const input = this.cursorPos;
      this.closeWindow();
      if (input === TOP_ITEM_STORAGE) this.Task_PlayerPcItemStorage();
      else if (input === TOP_MAILBOX) this.Task_PlayerPcMailbox();
      else this.Task_PlayerPcTurnOff();
    } else if (this.input.pressed('B')) {
      PlaySE(K.SE_SELECT);
      this.closeWindow();
      this.Task_PlayerPcTurnOff();
    } else if (this.input.pressed('UP')) {
      if (this.moveCursor(-1)) PlaySE(K.SE_SELECT);
    } else if (this.input.pressed('DOWN')) {
      if (this.moveCursor(1)) PlaySE(K.SE_SELECT);
    }
  }

  private Task_ReturnToTopMenu(): void {
    RestoreHelpContext();
    this.message(this.host.text('gText_WhatWouldYouLikeToDo'), () => this.Task_DrawPlayerPcTopMenu());
  }

  private Task_PlayerPcItemStorage(): void {
    this.Task_CreateItemStorageSubmenu(ITEM_PC_WITHDRAW);
  }

  /** Task_PlayerPcMailbox */
  private Task_PlayerPcMailbox(): void {
    const mgr = gPlayerPcMenuManager;
    mgr.count = CountPCMail(this.host.state);
    if (mgr.count === 0) {
      this.message(this.host.text('gText_TheresNoMailHere'), () => this.Task_ReturnToTopMenu());
      return;
    }
    mgr.itemsAbove = 0;
    mgr.cursorPos = 0;
    PCMailCompaction(this.host.state);
    this.Task_SetPageItemVars();
    this.setMailboxHelpContext();
    if (this.mailbox.MailboxPC_InitBuffers(mgr.count)) {
      this.host.hideMessage(); // ClearDialogWindowAndFrame(0, FALSE)
      this.Task_DrawMailboxPcMenu();
      this.phase = 'mailbox';
    } else {
      this.message(this.host.text('gText_TheresNoMailHere'), () => this.Task_ReturnToTopMenu());
    }
  }

  /** Task_PlayerPcTurnOff: ScriptContext_Enable (or, for the bedroom PC, the shut-down script). */
  private Task_PlayerPcTurnOff(): void {
    this.done = true;
  }

  private Task_CreateItemStorageSubmenu(cursorPos: number): void {
    SetHelpContext(this.notInRoom ? K.HELPCONTEXT_PLAYERS_PC_ITEMS : K.HELPCONTEXT_BEDROOM_PC_ITEMS);
    this.openWindow(SUBMENU_RECT, ITEM_PC_MENU, cursorPos);
    this.host.showDescription(this.host.text(ITEM_PC_DESCRIPTIONS[cursorPos]));
    this.phase = 'submenu';
  }

  private Task_TopMenu_ItemStorageSubmenu_HandleInput(): void {
    if (this.keys.newOrRepeated('UP')) {
      if (this.cursorPos !== 0) {
        PlaySE(K.SE_SELECT);
        this.moveCursor(-1);
        this.host.showDescription(this.host.text(ITEM_PC_DESCRIPTIONS[this.cursorPos]));
      }
    } else if (this.keys.newOrRepeated('DOWN')) {
      if (this.cursorPos !== 2) {
        PlaySE(K.SE_SELECT);
        this.moveCursor(1);
        this.host.showDescription(this.host.text(ITEM_PC_DESCRIPTIONS[this.cursorPos]));
      }
    } else if (this.input.pressed('A')) {
      PlaySE(K.SE_SELECT);
      if (this.cursorPos === ITEM_PC_WITHDRAW) this.Task_PlayerPcWithdrawItem();
      else if (this.cursorPos === ITEM_PC_DEPOSIT) this.Task_PlayerPcDepositItem();
      else this.Task_PlayerPcCancel();
    } else if (this.input.pressed('B')) {
      PlaySE(K.SE_SELECT);
      this.Task_PlayerPcCancel();
    }
  }

  private Task_PlayerPcDepositItem(): void {
    this.leaveFor('itemPcDeposit', ITEM_PC_DEPOSIT);
  }

  private Task_PlayerPcWithdrawItem(): void {
    if (this.host.countItemsInPc() !== 0) {
      this.leaveFor('itemPc', ITEM_PC_WITHDRAW);
    } else {
      this.closeWindow();
      this.message(this.host.text('gText_ThereAreNoItems'), () => this.Task_PlayerPcItemStorage());
    }
  }

  /** The fade out, the screen, then CB2_ReturnFromWithdrawMenu / CB2_ReturnFromDepositMenu. */
  private leaveFor(menu: 'itemPc' | 'itemPcDeposit', returnCursorPos: number): void {
    this.phase = 'fade';
    this.wait = this.host.fadeToBlack();
    this.next = () => {
      this.closeWindow(); // CleanupOverworldWindowsAndTilemaps
      this.phase = 'away';
      this.host.enter(menu, () => {
        this.Task_CreateItemStorageSubmenu(returnCursorPos);
        this.win?.flush();
        // Task_ReturnToItemStorageSubmenu: input once the field has faded in
        this.phase = 'fadeIn';
        this.wait = this.host.fadeInFromBlack();
        this.next = () => (this.phase = 'submenu');
      });
    };
  }

  private Task_PlayerPcCancel(): void {
    this.closeWindow();
    this.Task_ReturnToTopMenu();
  }

  // ---------------------------------------------------------------- the mailbox

  /** Task_SetPageItemVars: the mailbox's rows on a page (the list and CANCEL, at most 8). */
  private Task_SetPageItemVars(): void {
    const mgr = gPlayerPcMenuManager;
    mgr.pageItems = mgr.count >= 8 ? 8 : mgr.count + 1;
  }

  private setMailboxHelpContext(): void {
    SetHelpContext(gPlayerPcMenuManager.notInRoom === false ? K.HELPCONTEXT_BEDROOM_PC_MAILBOX : K.HELPCONTEXT_PLAYERS_PC_MAILBOX);
  }

  /** Task_DrawMailboxPcMenu: the title window ("MAILBOX" centred in 80 px), the list window, the list and its arrows. */
  private Task_DrawMailboxPcMenu(): void {
    const win = this.mailbox.MailboxPC_GetAddWindow(0);
    const title = this.host.text('gText_Mailbox');
    const width = stringWidth(this.fonts, FONT_NORMAL, title, 0);
    this.mailbox.MailboxPC_GetAddWindow(1);
    win.print(title, Math.trunc((80 - width) / 2), 2, FONT_NORMAL);
    this.mailbox.MailboxPC_InitListMenu(gPlayerPcMenuManager);
    this.mailbox.MailboxPC_AddScrollIndicatorArrows(gPlayerPcMenuManager);
  }

  /** Task_MailboxPcHandleInput (the field's fade in is over: the 'fadeIn' phase waited for it) */
  private Task_MailboxPcHandleInput(): void {
    const mgr = gPlayerPcMenuManager;
    const list = this.mailbox.list!;
    const input = list.processInput();
    mgr.cursorPos = list.cursorPos; // ListMenuGetScrollAndRow
    mgr.itemsAbove = list.itemsAbove;
    if (input === LIST_NOTHING_CHOSEN) return;
    PlaySE(K.SE_SELECT);
    if (input === LIST_CANCEL) {
      this.mailbox.removeScrollIndicatorArrows();
      this.Task_DestroyMailboxPcViewAndCancel();
      return;
    }
    this.mailbox.MailboxPC_RemoveWindow(0);
    this.mailbox.MailboxPC_RemoveWindow(1);
    this.mailbox.destroyListMenuTask(mgr);
    this.mailbox.removeScrollIndicatorArrows();
    this.setTask(() => this.Task_PrintWhatToDoWithSelectedMail());
  }

  /** Task_PrintWhatToDoWithSelectedMail: gStringVar1 = the writer (trailing spaces cut, or a short name as Japanese). */
  private Task_PrintWhatToDoWithSelectedMail(): void {
    const EOS = 0xff;
    let name = [...selectedPcMail(this.host.state).playerName];
    const length = StringLength(name);
    if (length > 5) {
      for (let i = length - 1; i >= 0; i--) {
        if (name[i]) break; // CHAR_SPACE is 0
        name[i] = EOS;
      }
    } else {
      name = ConvertInternationalString(name.slice(0, length + 1), K.LANGUAGE_JAPANESE);
    }
    this.host.state.stringVars[0] = name.slice(0, StringLength(name));
    // StringExpandPlaceholders(gStringVar4, ...): the field's message box expands {STR_VAR_1}
    this.message(this.host.text('gText_WhatWouldYouLikeToDoWithPlayersMail'), () => this.Task_DrawMailSubmenu());
  }

  /** Task_DestroyMailboxPcViewAndCancel */
  private Task_DestroyMailboxPcViewAndCancel(): void {
    this.mailbox.MailboxPC_RemoveWindow(0);
    this.mailbox.MailboxPC_RemoveWindow(1);
    this.mailbox.destroyListMenuTask();
    this.mailbox.MailboxPC_DestroyListMenuBuffer();
    this.Task_ReturnToTopMenu();
  }

  /** Task_DrawMailSubmenu: window 2, READ / MOVE TO BAG / GIVE / EXIT. */
  private Task_DrawMailSubmenu(): void {
    this.openWindow(MAILBOX_WINDOWS[2], MAIL_SUBMENU, 0);
    this.phase = 'mailSubmenu';
  }

  /** Task_MailSubmenuHandleInput (Menu_ProcessInput_other: wraps, SE_SELECT on a move) */
  private Task_MailSubmenuHandleInput(): void {
    if (this.input.pressed('A')) {
      PlaySE(K.SE_SELECT); // (Menu_ProcessInput_other's, then the task's: the same SE in the same frame)
      const input = this.cursorPos;
      if (input === MAIL_READ) this.Task_PlayerPcReadMail();
      else if (input === MAIL_MOVE_TO_BAG) this.Task_PlayerPcMoveMailToBag();
      else if (input === MAIL_GIVE) this.Task_PlayerPcGiveMailToMon();
      else this.Task_PlayerPcExitMailSubmenu();
    } else if (this.input.pressed('B')) {
      PlaySE(K.SE_SELECT);
      this.Task_PlayerPcExitMailSubmenu();
    } else if (this.keys.newOrRepeated('UP') && !this.input.held('DOWN')) {
      PlaySE(K.SE_SELECT);
      this.moveCursorWrap(-1);
    } else if (this.keys.newOrRepeated('DOWN') && !this.input.held('UP')) {
      PlaySE(K.SE_SELECT);
      this.moveCursorWrap(1);
    }
  }

  /** Task_PlayerPcReadMail → Task_WaitFadeAndReadSelectedMail: ReadMail, back through CB2_SetCbToReturnToMailbox. */
  private Task_PlayerPcReadMail(): void {
    const mail = selectedPcMail(this.host.state);
    this.leaveForScreen(() => ReadMail(selectedPcMail(this.host.state), CB2_ReturnToField, true), mailGfxSymbols([mail]), () => this.CB2_ReturnToMailbox());
  }

  /** The fade to black, then MailboxPC_DestroyListMenuBuffer, CleanupOverworldWindowsAndTilemaps and the screen. */
  private leaveForScreen(init: () => void, gfxSymbols: string[], onReturn: () => void): void {
    this.phase = 'fade';
    this.wait = this.host.fadeToBlack(); // FadeScreen(FADE_TO_BLACK, 0)
    this.next = () => {
      this.mailbox.MailboxPC_DestroyListMenuBuffer();
      this.closeWindow(); // CleanupOverworldWindowsAndTilemaps
      this.mailbox.destroy();
      this.phase = 'away';
      this.host.enterScreen(init, gfxSymbols, onReturn);
    };
  }

  /** The mailbox redrawn on the black field and faded in; input once the fade is over (Task_WaitFadeAndReturnToMailboxPcInputHandler). */
  private redrawMailboxAndFadeIn(): void {
    if (this.mailbox.MailboxPC_InitBuffers(gPlayerPcMenuManager.count)) this.Task_DrawMailboxPcMenu();
    this.mailbox.flush();
    this.phase = 'fadeIn';
    this.wait = this.host.fadeInFromBlack(); // FadeInFromBlack
    this.next = () => (this.phase = 'mailbox');
  }

  /** CB2_ReturnToMailbox (the field's gFieldCallback after READ) */
  private CB2_ReturnToMailbox(): void {
    this.setMailboxHelpContext();
    this.redrawMailboxAndFadeIn(); // LoadStdWindowFrameGfx, Task_DrawMailboxPcMenu, FadeInFromBlack
  }

  /** Task_PlayerPcMoveMailToBag: "The message will be lost. Is that okay?" */
  private Task_PlayerPcMoveMailToBag(): void {
    this.message(this.host.text('gText_MessageWillBeLost'), () => this.Task_DrawYesNoMenuToConfirmMoveToBag());
  }

  /** Task_DrawYesNoMenuToConfirmMoveToBag: DisplayYesNoMenuDefaultYes */
  private Task_DrawYesNoMenuToConfirmMoveToBag(): void {
    this.yesNo = new YesNoMenu(this.scene, this.fonts, this.input, { yesNo: this.host.text('gText_YesNo'), cursor: this.host.text('gText_SelectorArrow2') }, { inputDelay: 0 });
    this.phase = 'yesNo';
  }

  /** Task_MoveToBagYesNoMenuHandleInput (Menu_ProcessInputNoWrapClearOnChoose) */
  private Task_MoveToBagYesNoMenuHandleInput(): void {
    const b = this.input.pressed('B');
    if (!this.yesNo!.tick()) return;
    const yes = this.yesNo!.result;
    this.yesNo = undefined;
    if (yes) {
      this.Task_TryPutMailInBag_DestroyMsgIfSuccessful();
    } else {
      if (b) PlaySE(K.SE_SELECT);
      this.Task_PlayerPcExitMailSubmenu(); // Task_DeclinedMoveMailToBag
    }
  }

  /** Task_TryPutMailInBag_DestroyMsgIfSuccessful: the mail item into the bag and the message erased, or "The BAG is full." */
  private Task_TryPutMailInBag_DestroyMsgIfSuccessful(): void {
    const state = this.host.state;
    const mgr = gPlayerPcMenuManager;
    const mail = selectedPcMail(state);
    if (!state.bag.add(mail.itemId, 1)) {
      this.message(this.host.text('gText_BagIsFull'), () => this.Task_PlayerPcExitMailSubmenu());
      return;
    }
    this.message(this.host.text('gText_MailReturnedToBagMessageErased'), () => this.Task_PlayerPcExitMailSubmenu());
    ClearMailStruct(state.defines, mail);
    PCMailCompaction(state);
    mgr.count--;
    if (mgr.count < mgr.pageItems + mgr.cursorPos) {
      if (mgr.cursorPos !== 0) mgr.cursorPos--;
    }
    this.Task_SetPageItemVars();
  }

  /** Task_PlayerPcGiveMailToMon: "There is no POKéMON." or the party menu (ChooseMonToGiveMailFromMailbox). */
  private Task_PlayerPcGiveMailToMon(): void {
    if (this.host.state.party.length === 0) {
      this.message(this.host.text('gText_ThereIsNoPokemon'), () => this.Task_PlayerPcExitMailSubmenu()); // Task_Error_NoPokemon
      return;
    }
    // Task_WaitFadeAndGoToPartyMenu; Mailbox_ReturnToMailListAfterDeposit sets the field callback
    this.leaveForScreen(() => ChooseMonToGiveMailFromMailbox(CB2_ReturnToField), [], () => this.CB2_ReturnToMailboxPc_UpdateScrollVariables());
  }

  /** CB2_ReturnToMailboxPc_UpdateScrollVariables (after GIVE): recount, compact, the cursor up a row if a mail went. */
  private CB2_ReturnToMailboxPc_UpdateScrollVariables(): void {
    const mgr = gPlayerPcMenuManager;
    this.setMailboxHelpContext();
    const count = mgr.count;
    mgr.count = CountPCMail(this.host.state);
    PCMailCompaction(this.host.state);
    if (count !== mgr.count) {
      if (mgr.count < mgr.pageItems + mgr.cursorPos) {
        if (mgr.cursorPos !== 0) mgr.cursorPos--;
      }
    }
    this.Task_SetPageItemVars();
    this.redrawMailboxAndFadeIn();
  }

  /** Task_PlayerPcExitMailSubmenu: window 2 down, then Task_RedrawPlayerPcMailboxAndSetUpInputHandler. */
  private Task_PlayerPcExitMailSubmenu(): void {
    this.closeWindow(); // MailboxPC_RemoveWindow(2)
    this.setTask(() => {
      // Task_RedrawPlayerPcMailboxAndSetUpInputHandler
      this.host.hideMessage();
      this.Task_DrawMailboxPcMenu();
      this.phase = 'mailbox';
    });
  }
}
