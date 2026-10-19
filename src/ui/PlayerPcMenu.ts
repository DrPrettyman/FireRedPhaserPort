import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { KeyRepeat } from './FieldListMenu';
import { BackupHelpContext, RestoreHelpContext, SetHelpContext } from './helpSystemContext';
import { MenuWindow } from './MenuWindow';

/** What the player's PC needs from the overworld. */
export interface PlayerPcMenuHost {
  /** The encoded C string (gText_* / gOtherText_* / gFameCheckerText_*). */
  text(symbol: string): number[];
  /** CountItemsInPC */
  countItemsInPc(): number;
  /** CountPCMail: mail isn't modelled, so 0. */
  countPcMail(): number;
  /** DisplayItemMessageOnField(FONT_NORMAL): the wait ends when the text has printed. */
  displayItemMessageOnField(str: number[]): () => boolean;
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

type Phase = 'message' | 'topMenu' | 'submenu' | 'fade' | 'away' | 'fadeIn';

/**
 * player_pc.c's field side: PlayerPC / BedroomPC (ITEM STORAGE / MAILBOX / TURN OFF), the item storage
 * submenu (WITHDRAW ITEM / DEPOSIT ITEM / CANCEL with its descriptions) and the way back from the item PC and
 * the bag (CB2_ReturnFromWithdrawMenu / CB2_ReturnFromDepositMenu). `done` is set when the player turns the PC
 * off (Task_PlayerPcTurnOff). The mailbox is always empty (mail isn't modelled).
 */
export class PlayerPcMenu {
  done = false;
  private phase: Phase = 'message';
  private win?: MenuWindow;
  private cursorPos = 0;
  private count = 0;
  private wait?: () => boolean;
  private next?: () => void;
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
    BackupHelpContext();
    // PlayerPC / BedroomPC: DisplayItemMessageOnField(gText_WhatWouldYouLikeToDo, Task_DrawPlayerPcTopMenu)
    this.message(this.host.text('gText_WhatWouldYouLikeToDo'), () => this.Task_DrawPlayerPcTopMenu());
  }

  /** One frame; true once the PC is off. */
  tick(): boolean {
    if (this.done) return true;
    this.keys.sample();
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
    }
    this.win?.flush();
    return this.done;
  }

  private message(str: number[], next: () => void): void {
    this.phase = 'message';
    this.wait = this.host.displayItemMessageOnField(str);
    this.next = next;
  }

  private openWindow(rect: typeof TOP_MENU_RECT, labels: string[], cursorPos: number): void {
    // SetStdWindowBorderStyle + PrintTextArray / AddItemMenuActionTextPrinters + Menu_InitCursor
    this.win = new MenuWindow(this.scene, rect, this.fonts, this.input, 'std');
    const cursorWidth = this.fonts.get(FONT_NORMAL).info.maxLetterWidth; // GetMenuCursorDimensionByFont(FONT_NORMAL, 0)
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

  /** Task_PlayerPcMailbox: CountPCMail is always 0 here. */
  private Task_PlayerPcMailbox(): void {
    if (this.host.countPcMail() === 0) this.message(this.host.text('gText_TheresNoMailHere'), () => this.Task_ReturnToTopMenu());
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
}
