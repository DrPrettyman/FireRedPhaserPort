import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { Menu } from './Menu';
import { MenuWindow } from './MenuWindow';

// include/constants/menu.h
export const SCR_MENU_CANCEL = 127;
export const SCR_MENU_UNSET = 255;

const FONT_NORMAL_COPY_1 = 1;

/** gMenuCursorDimensions for FONT_NORMAL and FONT_NORMAL_COPY_1: the ▶ cell Menu_RedrawCursor clears. */
const CURSOR_WIDTH = 8;
const CURSOR_HEIGHT = 14;

export interface MultichoiceOptions {
  left: number;
  top: number;
  /** The list's texts (sMultichoiceLists[mcId]), encoded. */
  items: number[][];
  ignoreBPress: boolean;
  initPos: number;
  /** gMenuCursorDimensions' ▶ glyph */
  cursor: number[];
  /** LoadUserWindowGfx's frame (options frame type + 1) */
  frameType: number;
  /** Frames to ignore input after opening: sDelay (12 for the cable club menus, else 0). */
  delay: number;
  /** gPaletteFade.active: input waits for a field fade to finish. */
  fadeActive(): boolean;
  /**
   * A window of a fixed size at `left`/`top` with `rowHeight` px rows, for menus that draw their own
   * window and hand it to CreateMCMenuInputHandlerTask (CreatePCMenu).
   */
  layout?: { width: number; height: number; rowHeight: number };
}

/** GetMCWindowHeight */
function GetMCWindowHeight(count: number): number {
  return [1, 2, 4, 6, 7, 9, 11, 13, 14][count] ?? 1;
}

/**
 * ScriptMenu_Multichoice(WithDefault): DrawVerticalMultichoiceMenu + Task_MultichoiceMenu_HandleInput.
 * `result` is the chosen index or SCR_MENU_CANCEL. The cable club menus' help descriptions
 * (MultiChoicePrintHelpDescription) aren't drawn: link play isn't ported.
 */
export class MultichoiceMenu {
  result = SCR_MENU_UNSET;
  private win: MenuWindow;
  private menu: Menu;
  private delay: number;

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    input: Input,
    private opts: MultichoiceOptions,
  ) {
    const count = opts.items.length;
    let left = opts.left;
    let { width, height, rowHeight } = opts.layout ?? { width: 0, height: 0, rowHeight: 14 };
    if (!opts.layout) {
      let strWidth = 0;
      for (const item of opts.items) strWidth = Math.max(strWidth, stringWidth(fonts, FONT_NORMAL, item, 0));
      width = Math.trunc((strWidth + 9) / 8) + 1;
      if (left + width > 28) left = 28 - width;
      height = GetMCWindowHeight(count);
    }
    // CreateWindowFromRect: the window's interior starts one tile in, inside the frame
    this.win = new MenuWindow(scene, { left: left + 1, top: opts.top + 1, width, height }, fonts, input, opts.frameType);
    // MultichoiceList_PrintItems(windowId, FONT_NORMAL, 8, 2, 14, count, list, 0, 2)
    opts.items.forEach((item, i) => this.win.print(item, 8, rowHeight * i + 2, FONT_NORMAL));
    // Menu_InitCursor(windowId, FONT_NORMAL, 0, 2, 14, count, initPos); Menu_ProcessInput wraps for more than 3
    const initPos = opts.initPos >= 0 && opts.initPos < count ? opts.initPos : 0;
    this.menu = new Menu(this.win, input, opts.cursor, count, { left: 0, top: 2, rowHeight, wrap: count > 3 }, initPos);
    this.delay = opts.delay;
    this.win.flush();
  }

  /** One frame; true once a choice is made (the window is gone). */
  tick(): boolean {
    if (this.opts.fadeActive()) return false;
    if (this.delay !== 0) {
      this.delay--;
      return false;
    }
    const input = this.menu.tick();
    this.win.flush();
    if (input === undefined) return false;
    if (input === 'cancel') {
      if (this.opts.ignoreBPress) return false;
      PlaySE(K.SE_SELECT);
      this.result = SCR_MENU_CANCEL;
    } else {
      this.result = input;
    }
    this.win.destroy(); // DestroyScriptMenuWindow
    return true;
  }
}

export interface MultichoiceGridOptions {
  left: number;
  top: number;
  items: number[][];
  ignoreBPress: boolean;
  columnCount: number;
  cursor: number[];
  frameType: number;
  /** OPTIONS_BUTTON_MODE_LR: L and R move the cursor left and right (GetLRKeysPressed). */
  lrMode: boolean;
}

/** ScriptMenu_MultichoiceGrid + Hask_MultichoiceGridMenu_HandleInput (menu.c's grid cursor). */
export class MultichoiceGridMenu {
  result = SCR_MENU_UNSET;
  private win: MenuWindow;
  private cursorPos = 0;
  private readonly rows: number;
  private readonly optionWidth: number;
  private readonly maxCursorPos: number;

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    private input: Input,
    private opts: MultichoiceGridOptions,
  ) {
    const count = opts.items.length;
    // GetMenuWidthFromList: the widest item in tiles (GetStringTilesWide, FONT_NORMAL_COPY_1)
    let width = 0;
    for (const item of opts.items) width = Math.max(width, Math.trunc((stringWidth(fonts, FONT_NORMAL_COPY_1, item, 0) + 7) / 8));
    width += 1;
    const cols = opts.columnCount;
    this.rows = Math.trunc(count / cols);
    this.win = new MenuWindow(scene, { left: opts.left + 1, top: opts.top + 1, width: width * cols, height: this.rows * 2 }, fonts, input, opts.frameType);
    // MultichoiceGrid_PrintItems(windowId, FONT_NORMAL_COPY_1, width * 8, 16, cols, rows, list)
    const info = fonts.get(FONT_NORMAL_COPY_1).info;
    const yOffset = Math.trunc((16 - info.maxLetterHeight) / 2);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < cols; j++) this.win.print(opts.items[i * cols + j], width * 8 * j + info.maxLetterWidth, yOffset + 16 * i, FONT_NORMAL_COPY_1);
    }
    // MultichoiceGrid_InitCursor(windowId, FONT_NORMAL_COPY_1, 0, 1, width * 8, cols, rows, 0)
    this.optionWidth = width * 8;
    this.maxCursorPos = cols * this.rows - 1;
    this.redrawCursor(0, 0);
    this.win.flush();
  }

  tick(): boolean {
    const input = this.processInputGridLayout();
    this.win.flush();
    if (input === undefined) return false;
    if (input === 'cancel') {
      if (this.opts.ignoreBPress) return false;
      this.result = SCR_MENU_CANCEL;
    } else {
      this.result = input;
    }
    this.win.destroy();
    return true;
  }

  /** Menu_ProcessInputGridLayout */
  private processInputGridLayout(): number | 'cancel' | undefined {
    const inp = this.input;
    if (inp.pressed('A')) return this.cursorPos;
    if (inp.pressed('B')) return 'cancel';
    if (inp.pressed('UP')) this.moveCursorIfValid(0, -1);
    else if (inp.pressed('DOWN')) this.moveCursorIfValid(0, 1);
    else if (inp.pressed('LEFT') || (this.opts.lrMode && inp.pressed('L'))) this.moveCursorIfValid(-1, 0);
    else if (inp.pressed('RIGHT') || (this.opts.lrMode && inp.pressed('R'))) this.moveCursorIfValid(1, 0);
    return undefined;
  }

  /** MultichoiceGrid_MoveCursorIfValid */
  private moveCursorIfValid(deltaX: number, deltaY: number): void {
    const cols = this.opts.columnCount;
    const oldPos = this.cursorPos;
    let pos = oldPos;
    if (deltaX && (pos % cols) + deltaX >= 0 && (pos % cols) + deltaX < cols) pos += deltaX;
    if (deltaY && Math.trunc(pos / cols) + deltaY >= 0 && Math.trunc(pos / cols) + deltaY < this.rows) pos += cols * deltaY;
    if (pos > this.maxCursorPos) return;
    this.cursorPos = pos;
    this.redrawCursor(oldPos, pos);
  }

  /** MultichoiceGrid_RedrawCursor (left 0, top 1, cursor height 16) */
  private redrawCursor(oldPos: number, newPos: number): void {
    const cols = this.opts.columnCount;
    const at = (pos: number) => ({ x: (pos % cols) * this.optionWidth, y: Math.trunc(pos / cols) * 16 + 1 });
    const o = at(oldPos);
    this.win.clearRect(o.x, o.y, CURSOR_WIDTH, CURSOR_HEIGHT);
    const n = at(newPos);
    this.win.print(this.opts.cursor, n.x, n.y, FONT_NORMAL_COPY_1);
  }
}
