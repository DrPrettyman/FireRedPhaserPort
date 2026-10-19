import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { SetHelpContext } from './helpSystemContext';
import { MenuWindow } from './MenuWindow';

/** What the PC's storage menu needs from the overworld. */
export interface StoragePcMenuHost {
  /** The encoded C string (gText_*). */
  text(symbol: string): number[];
  /** CountPartyMons */
  partyCount(): number;
  /** PARTY_SIZE and the OPTION_* ids (pokemon_storage_system_internal.h) */
  constants: { PARTY_SIZE: number; OPTION_WITHDRAW: number; OPTION_DEPOSIT: number; OPTION_EXIT: number };
  /** Window 0's description: DrawDialogueFrame + an instant print (TEXT_SKIP_DRAW / speed 0). */
  showDescription(str: number[]): void;
  /** ClearStdWindowAndFrame(0) */
  hideDescription(): void;
  /** FadeScreen(FADE_TO_BLACK, 0); the wait ends when the fade has finished. */
  fadeToBlack(): () => boolean;
  /**
   * CleanupOverworldWindowsAndTilemaps + EnterPokeStorage(option): the box screen (FieldMenuScene). It comes
   * back through CB2_ExitPokeStorage → CB2_ReturnToField, after which the field calls `onReturn`
   * (gFieldCallback = FieldTask_ReturnToPcMenu) with the screen still black.
   */
  enterPokeStorage(option: number, onReturn: () => void): void;
  /** sPreviousBoxOption (GetCurrentBoxOption when the box screen closed) */
  previousBoxOption(): number;
  /** FadeInFromBlack; the wait ends when the fade has finished (IsWeatherNotFadingIn). */
  fadeInFromBlack(): () => boolean;
}

/** sWindowTemplate_MainMenu: tile (1, 1), 17x10, the standard frame. */
const RECT = { left: 1, top: 1, width: 17, height: 10 };

/** sMainMenuTexts: OPTION_WITHDRAW .. OPTION_EXIT */
const MAIN_MENU_TEXTS: [string, string][] = [
  ['gText_WithdrawPokemon', 'gText_WithdrawMonDescription'],
  ['gText_DepositPokemon', 'gText_DepositMonDescription'],
  ['gText_MovePokemon', 'gText_MoveMonDescription'],
  ['gText_MoveItems', 'gText_MoveItemsDescription'],
  ['gText_SeeYa', 'gText_SeeYaDescription'],
];

const STATE_LOAD = 0;
const STATE_FADE_IN = 1;
const STATE_HANDLE_INPUT = 2;
const STATE_ERROR_MSG = 3;
const STATE_ENTER_PC = 4;

/**
 * pokemon_storage_system_menu.c's field half: ShowPokemonStorageSystemPC's Task_PCMainMenu (the WITHDRAW /
 * DEPOSIT / MOVE POKéMON / MOVE ITEMS / SEE YA! menu with its description below), the fade into the box screen
 * and FieldTask_ReturnToPcMenu on the way back. `done` is set when the player leaves (ScriptContext_Enable).
 */
export class StoragePcMenu {
  done = false;
  private win?: MenuWindow;
  private tState = STATE_LOAD;
  private tSelectedOption = 0;
  /** Menu_InitCursor's cursor position */
  private cursorPos = 0;
  private fadeWait?: () => boolean;
  private away = false;
  private enterOption = 0;

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private host: StoragePcMenuHost,
  ) {
    // ShowPokemonStorageSystemPC: LockPlayerFieldControls is the overlay itself
    this.Task_PCMainMenu();
  }

  /** One frame; true once the menu has closed. */
  tick(): boolean {
    if (this.done) return true;
    if (this.away) return false;
    this.Task_PCMainMenu();
    this.win?.flush();
    return this.done;
  }

  private printDescription(option: number): void {
    this.host.showDescription(this.host.text(MAIN_MENU_TEXTS[option][1]));
  }

  private Task_PCMainMenu(): void {
    const k = this.host.constants;
    switch (this.tState) {
      case STATE_LOAD:
        SetHelpContext(K.HELPCONTEXT_BILLS_PC);
        this.CreatePCMainMenu(this.tSelectedOption);
        this.printDescription(this.tSelectedOption);
        this.tState++;
        break;
      case STATE_FADE_IN:
        if (!this.fadeWait || this.fadeWait()) {
          this.fadeWait = undefined;
          this.tState++;
        }
        break;
      case STATE_HANDLE_INPUT: {
        const input = this.Menu_ProcessInput();
        if (input === undefined) {
          // MENU_NOTHING_CHOSEN: the cursor moved with the D-pad
          if (this.tSelectedOption !== this.cursorPos) {
            this.tSelectedOption = this.cursorPos;
            this.printDescription(this.tSelectedOption);
          }
        } else if (input === 'cancel' || input === k.OPTION_EXIT) {
          this.host.hideDescription();
          this.destroyMenu();
          this.done = true; // UnlockPlayerFieldControls + ScriptContext_Enable
        } else if (input === k.OPTION_WITHDRAW && this.host.partyCount() === k.PARTY_SIZE) {
          // Can't withdraw
          this.host.showDescription(this.host.text('gText_PartyFull'));
          this.tState = STATE_ERROR_MSG;
        } else if (input === k.OPTION_DEPOSIT && this.host.partyCount() === 1) {
          // Can't deposit
          this.host.showDescription(this.host.text('gText_JustOnePkmn'));
          this.tState = STATE_ERROR_MSG;
        } else {
          // Enter PC
          this.enterOption = input;
          this.fadeWait = this.host.fadeToBlack();
          this.tState = STATE_ENTER_PC;
        }
        break;
      }
      case STATE_ERROR_MSG:
        // Printed "can't do PC option message"; wait for new input after it
        if (this.input.pressed('A') || this.input.pressed('B')) {
          this.printDescription(this.tSelectedOption);
          this.tState = STATE_HANDLE_INPUT;
        } else if (this.input.pressed('UP')) {
          this.moveCursor(-1);
          this.tSelectedOption = this.cursorPos;
          this.printDescription(this.tSelectedOption);
          this.tState = STATE_HANDLE_INPUT;
        } else if (this.input.pressed('DOWN')) {
          this.moveCursor(1);
          this.tSelectedOption = this.cursorPos;
          this.printDescription(this.tSelectedOption);
          this.tState = STATE_HANDLE_INPUT;
        }
        break;
      case STATE_ENTER_PC:
        if (this.fadeWait!()) {
          this.fadeWait = undefined;
          // CleanupOverworldWindowsAndTilemaps
          this.host.hideDescription();
          this.destroyMenu();
          this.away = true;
          this.host.enterPokeStorage(this.enterOption, () => this.FieldTask_ReturnToPcMenu());
        }
        break;
    }
  }

  /** FieldTask_ReturnToPcMenu: the menu comes back on the box option just used, then the field fades in. */
  private FieldTask_ReturnToPcMenu(): void {
    this.away = false;
    this.tState = STATE_LOAD;
    this.tSelectedOption = this.host.previousBoxOption();
    this.Task_PCMainMenu();
    this.win?.flush();
    this.fadeWait = this.host.fadeInFromBlack();
  }

  /** CreatePCMainMenu: DrawStdWindowFrame + PrintTextArray + Menu_InitCursor */
  private CreatePCMainMenu(whichMenu: number): void {
    this.win = new MenuWindow(this.scene, RECT, this.fonts, this.input, 'std');
    const cursorWidth = this.fonts.get(FONT_NORMAL).info.maxLetterWidth; // GetMenuCursorDimensionByFont(FONT_NORMAL, 0)
    MAIN_MENU_TEXTS.forEach(([label], i) => this.win!.print(this.host.text(label), cursorWidth, 2 + i * 16));
    this.cursorPos = whichMenu;
    this.drawCursor();
  }

  private destroyMenu(): void {
    this.win?.destroy();
    this.win = undefined;
  }

  private drawCursor(): void {
    this.win!.print(this.host.text('gText_SelectorArrow2'), 0, 2 + this.cursorPos * 16);
  }

  /** Menu_MoveCursor: wraps around. */
  private moveCursor(delta: number): void {
    this.win!.clearRect(0, 2 + this.cursorPos * 16, 8, 16);
    const n = MAIN_MENU_TEXTS.length;
    this.cursorPos = (this.cursorPos + delta + n) % n;
    this.drawCursor();
  }

  /** Menu_ProcessInput: the chosen option, 'cancel' for B, undefined otherwise (SE_SELECT on A and the D-pad). */
  private Menu_ProcessInput(): number | 'cancel' | undefined {
    if (this.input.pressed('A')) {
      PlaySE(K.SE_SELECT);
      return this.cursorPos;
    }
    if (this.input.pressed('B')) return 'cancel';
    if (this.input.pressed('UP')) {
      PlaySE(K.SE_SELECT);
      this.moveCursor(-1);
    } else if (this.input.pressed('DOWN')) {
      PlaySE(K.SE_SELECT);
      this.moveCursor(1);
    }
    return undefined;
  }
}
