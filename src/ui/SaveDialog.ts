// start_menu.c's save dialog: StartMenuSaveCallback → StartCB_Save1 / StartCB_Save2 run the SaveDialogCB_* chain
// (sSaveDialogCB) once per frame through RunSaveDialogCB, with the save info window (PrintSaveStats) top left and
// the questions in the field message box. Saving itself is save.c's TrySavingData (state/save.ts).

import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import { gSave, SAVE_NORMAL, SAVE_OVERWRITE_DIFFERENT_FILE, SAVE_STATUS_EMPTY, SAVE_STATUS_INVALID, SAVE_STATUS_OK, TrySavingData } from '../state/save';
import type { Charmap } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL, type Fonts } from '../text/Font';
import type { MessageBox } from '../text/MessageBox';
import { stringWidth } from '../text/stringWidth';
import { MenuWindow } from './MenuWindow';
import { SaveStatToString } from './saveMenuUtil';
import { YesNoMenu } from './YesNoMenu';

// enum SaveCBReturn
export const SAVECB_RETURN_CONTINUE = 0;
export const SAVECB_RETURN_OKAY = 1;
export const SAVECB_RETURN_CANCEL = 2;
export const SAVECB_RETURN_ERROR = 3;

/** The running dialog, for the e2e tests' probe. */
let openDialog: SaveDialog | undefined;

/** Dev: whether a save dialog runs, and whether its YES/NO menu and save info window are up. */
export function saveDialogProbe(): { yesNo: boolean; statsWindow: boolean; stats: number[][] } | undefined {
  return openDialog?.probe;
}

/** sSaveStatsWindowTemplate: tile (1, 1), 14x9, the std frame (LoadStdWindowGfx). */
const SAVE_STATS_WINDOW = { left: 1, top: 1, width: 14, height: 9 };

export interface SaveDialogHost {
  scene: Phaser.Scene;
  fonts: Fonts;
  input: Input;
  charmap: Charmap;
  strings: Record<string, string>;
  state: GameState;
  /** The field message box (window 0), which the dialog prints into. */
  messageBox: MessageBox;
  /** GetMapNameGeneric(gMapHeader.regionMapSectionId), encoded with EOS. */
  mapName(): number[];
  /** What gSaveBlock1Ptr->location / pos hold on the GBA at all times: written just before saving. */
  storeLocationForSave(): void;
}

/**
 * The dialog from "Would you like to save the game?" to "PLAYER saved the game." `tick()` is StartCB_Save2's
 * RunSaveDialogCB: it returns SAVECB_RETURN_* (OKAY once saved, CANCEL for NO / B, which goes back to the start
 * menu, ERROR when the write failed). The caller clears the message box after OKAY / ERROR.
 */
export class SaveDialog {
  /** sSaveDialogCB */
  private cb: () => number;
  /** sSaveDialogDelay */
  private delay = 0;
  private statsWindow?: MenuWindow;
  private yesNo?: YesNoMenu;
  /** Dev: the stat strings the save info window shows (location, name, badges, Pokédex, time). */
  private stats: number[][] = [];

  constructor(private host: SaveDialogHost) {
    // StartMenu_PrepareForSave (SaveMapView isn't ported: the port doesn't save the map view)
    this.cb = this.printAskSaveText;
    openDialog = this;
  }

  /** RunSaveDialogCB: nothing while the message is printing (RunTextPrinters_CheckPrinter0Active). */
  tick(): number {
    if (this.host.messageBox.isPrinting) return SAVECB_RETURN_CONTINUE;
    const r = this.cb();
    if (r !== SAVECB_RETURN_CONTINUE && openDialog === this) openDialog = undefined;
    return r;
  }

  /** PrintSaveTextWithFollowupFunc: print `label`'s text in the message box, then `next`. */
  private printSaveText(label: string, next: () => number): void {
    this.host.messageBox.show(this.host.charmap.encode(this.host.strings[label] ?? '?$')); // StringExpandPlaceholders + AddTextPrinterForMessage
    this.cb = next;
  }

  /** DisplayYesNoMenuDefaultYes / DisplayYesNoMenuDefaultNo */
  private displayYesNoMenu(defaultNo: boolean): void {
    const text = (label: string) => this.host.charmap.encode(this.host.strings[label] ?? '?$');
    this.yesNo = new YesNoMenu(this.host.scene, this.host.fonts, this.host.input, { yesNo: text('gText_YesNo'), cursor: text('gText_SelectorArrow2') }, { defaultNo, inputDelay: 0 });
  }

  /** Menu_ProcessInputNoWrapClearOnChoose: 0 (YES), 1 (NO), -1 (B) or -2 (nothing chosen yet). */
  private processYesNoInput(): number {
    if (!this.yesNo?.tick()) return -2;
    const yes = this.yesNo.result;
    this.yesNo = undefined;
    return yes ? 0 : 1;
  }

  /** CloseSaveStatsWindow */
  private closeSaveStatsWindow(): void {
    this.statsWindow?.destroy();
    this.statsWindow = undefined;
  }

  /** CloseSaveMessageWindow: ClearDialogWindowAndFrame(0, TRUE) */
  private closeSaveMessageWindow(): void {
    this.host.messageBox.hide();
  }

  /** SetSaveDialogDelayTo60Frames */
  private setDelayTo60Frames(): void {
    this.delay = 60;
  }

  /** SaveDialog_Wait60FramesOrAButtonHeld */
  private wait60FramesOrAButtonHeld(): boolean {
    this.delay--;
    if (this.host.input.held('A')) return true; // PlaySE(SE_SELECT)
    return this.delay === 0;
  }

  /** SaveDialog_Wait60FramesThenCheckAButtonHeld */
  private wait60FramesThenCheckAButtonHeld(): boolean {
    if (this.delay === 0) return this.host.input.held('A');
    this.delay--;
    return false;
  }

  private printAskSaveText = (): number => {
    // The start menu window is already gone (ClearStdWindowAndFrame + RemoveStartMenuWindow); no help message window.
    this.printSaveStats();
    this.printSaveText('gText_WouldYouLikeToSaveTheGame', this.askSavePrintYesNoMenu);
    return SAVECB_RETURN_CONTINUE;
  };

  private askSavePrintYesNoMenu = (): number => {
    this.displayYesNoMenu(false);
    this.cb = this.askSaveHandleInput;
    return SAVECB_RETURN_CONTINUE;
  };

  private askSaveHandleInput = (): number => {
    switch (this.processYesNoInput()) {
      case 0:
        if ((gSave.fileStatus !== SAVE_STATUS_EMPTY && gSave.fileStatus !== SAVE_STATUS_INVALID) || !gSave.differentSaveFile)
          this.cb = this.printAskOverwriteText;
        else this.cb = this.printSavingDontTurnOffPower;
        break;
      case 1:
      case -1:
        this.closeSaveStatsWindow();
        this.closeSaveMessageWindow();
        return SAVECB_RETURN_CANCEL;
    }
    return SAVECB_RETURN_CONTINUE;
  };

  private printAskOverwriteText = (): number => {
    if (gSave.differentSaveFile) this.printSaveText('gText_DifferentGameFile', this.askReplacePreviousFilePrintYesNoMenu);
    else this.printSaveText('gText_AlreadySaveFile_WouldLikeToOverwrite', this.askOverwritePrintYesNoMenu);
    return SAVECB_RETURN_CONTINUE;
  };

  private askOverwritePrintYesNoMenu = (): number => {
    this.displayYesNoMenu(false);
    this.cb = this.askOverwriteOrReplacePreviousFileHandleInput;
    return SAVECB_RETURN_CONTINUE;
  };

  private askReplacePreviousFilePrintYesNoMenu = (): number => {
    this.displayYesNoMenu(true);
    this.cb = this.askOverwriteOrReplacePreviousFileHandleInput;
    return SAVECB_RETURN_CONTINUE;
  };

  private askOverwriteOrReplacePreviousFileHandleInput = (): number => {
    switch (this.processYesNoInput()) {
      case 0:
        this.cb = this.printSavingDontTurnOffPower;
        break;
      case 1:
      case -1:
        this.closeSaveStatsWindow();
        this.closeSaveMessageWindow();
        return SAVECB_RETURN_CANCEL;
    }
    return SAVECB_RETURN_CONTINUE;
  };

  private printSavingDontTurnOffPower = (): number => {
    // SaveQuestLogData: no quest log
    this.printSaveText('gText_SavingDontTurnOffThePower', this.doSave);
    return SAVECB_RETURN_CONTINUE;
  };

  private doSave = (): number => {
    // IncrementGameStat(GAME_STAT_SAVED_GAME): no game stats
    this.host.storeLocationForSave();
    if (gSave.differentSaveFile) {
      TrySavingData(SAVE_OVERWRITE_DIFFERENT_FILE, this.host.state);
      gSave.differentSaveFile = false;
    } else {
      TrySavingData(SAVE_NORMAL, this.host.state);
    }
    this.cb = this.printSaveResult;
    return SAVECB_RETURN_CONTINUE;
  };

  private printSaveResult = (): number => {
    if (gSave.attemptStatus === SAVE_STATUS_OK) this.printSaveText('gText_PlayerSavedTheGame', this.waitPrintSuccessAndPlaySE);
    else this.printSaveText('gText_SaveError_PleaseExchangeBackupMemory', this.waitPrintErrorAndPlaySE);
    this.setDelayTo60Frames();
    return SAVECB_RETURN_CONTINUE;
  };

  private waitPrintSuccessAndPlaySE = (): number => {
    // RunSaveDialogCB only gets here once the printer is done; PlaySE(SE_SAVE) (no audio)
    this.cb = this.returnSuccess;
    return SAVECB_RETURN_CONTINUE;
  };

  private returnSuccess = (): number => {
    // !IsSEPlaying(): no audio, so never playing
    if (this.wait60FramesOrAButtonHeld()) {
      this.closeSaveStatsWindow();
      return SAVECB_RETURN_OKAY;
    }
    return SAVECB_RETURN_CONTINUE;
  };

  private waitPrintErrorAndPlaySE = (): number => {
    // PlaySE(SE_BOO) (no audio)
    this.cb = this.returnError;
    return SAVECB_RETURN_CONTINUE;
  };

  private returnError = (): number => {
    if (!this.wait60FramesThenCheckAButtonHeld()) return SAVECB_RETURN_CONTINUE;
    this.closeSaveStatsWindow();
    return SAVECB_RETURN_ERROR;
  };

  /**
   * PrintSaveStats: the location centred in blue, then PLAYER, BADGES, POKéDEX (once the player has it) and TIME
   * in the small font with their values at x 60. The values carry their own {COLOR}{SHADOW} (SaveStatToString).
   */
  private printSaveStats(): void {
    const { scene, fonts, input, charmap, state } = this.host;
    const d = state.defines;
    const win = new MenuWindow(scene, SAVE_STATS_WINDOW, fonts, input, 'std');
    this.statsWindow = win;
    const label = (name: string) => charmap.encode(this.host.strings[name] ?? '?$');
    const stat = (id: string, color: number) => {
      const str = SaveStatToString(state, charmap, d.require(id), color, () => this.host.mapName());
      this.stats.push(str);
      return str;
    };
    const location = stat('SAVE_STAT_LOCATION', 8);
    win.print(location, Math.trunc(((112 - stringWidth(fonts, FONT_NORMAL, location, -1)) >>> 0) / 2) & 0xff, 0, FONT_NORMAL);
    win.print(label('gSaveStatName_Player'), 2, 14, FONT_SMALL);
    win.print(stat('SAVE_STAT_NAME', 2), 60, 14, FONT_NORMAL); // Menu_PrintFormatIntlPlayerName
    win.print(label('gSaveStatName_Badges'), 2, 28, FONT_SMALL);
    win.print(stat('SAVE_STAT_BADGES', 2), 60, 28, FONT_SMALL);
    let y = 42;
    if (state.getFlag('FLAG_SYS_POKEDEX_GET')) {
      win.print(label('gSaveStatName_Pokedex'), 2, 42, FONT_SMALL);
      win.print(stat('SAVE_STAT_POKEDEX', 2), 60, 42, FONT_SMALL);
      y = 56;
    }
    win.print(label('gSaveStatName_Time'), 2, y, FONT_SMALL);
    win.print(stat('SAVE_STAT_TIME', 2), 60, y, FONT_SMALL);
    win.flush();
  }

  /** Dev: what the dialog shows, for the e2e tests. */
  get probe(): { yesNo: boolean; statsWindow: boolean; stats: number[][] } {
    return { yesNo: this.yesNo !== undefined, statsWindow: this.statsWindow !== undefined, stats: this.stats };
  }
}
