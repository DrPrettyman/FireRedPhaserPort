import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import type { Fonts } from '../text/Font';
import { Menu } from './Menu';
import { MenuWindow } from './MenuWindow';

/** sYesNo_WindowTemplate: tile (21, 9), 6x4. */
const RECT = { left: 21, top: 9, width: 6, height: 4 };

/**
 * DisplayYesNoMenuDefaultYes (or DisplayYesNoMenuDefaultNo with `defaultNo`) + Task_YesNoMenu_HandleInput:
 * resolves true for YES, false for NO or B. Input is ignored for the first 5 frames (Task_YesNoMenu_HandleInput's
 * wait; `inputDelay: 0` for callers that run Menu_ProcessInputNoWrapClearOnChoose themselves).
 */
export class YesNoMenu {
  private win: MenuWindow;
  private menu: Menu;
  result: boolean | undefined;
  /** script_menu.c's Task_HandleYesNoInput plays SE_SELECT on NO / B (the script's `yesnobox`). */
  private readonly seOnNo: boolean;

  constructor(scene: Phaser.Scene, fonts: Fonts, input: Input, text: { yesNo: number[]; cursor: number[] }, opts: { defaultNo?: boolean; inputDelay?: number; seOnNo?: boolean } = {}) {
    this.seOnNo = opts.seOnNo ?? false;
    this.win = new MenuWindow(scene, RECT, fonts, input);
    const font = fonts.get(2);
    const cursorWidth = font.info.maxLetterWidth;
    this.win.print(text.yesNo, cursorWidth, 2);
    this.menu = new Menu(this.win, input, text.cursor, 2, {
      left: 0,
      top: 2,
      rowHeight: font.info.maxLetterHeight + font.info.lineSpacing,
      wrap: false,
      inputDelay: opts.inputDelay ?? 5,
    }, opts.defaultNo ? 1 : 0);
  }

  tick(): boolean {
    const r = this.menu.tick();
    this.win.flush();
    if (r === undefined) return false;
    this.result = r === 0;
    if (!this.result && this.seOnNo) PlaySE(K.SE_SELECT); // Task_HandleYesNoInput: B or NO
    this.win.destroy();
    return true;
  }
}
