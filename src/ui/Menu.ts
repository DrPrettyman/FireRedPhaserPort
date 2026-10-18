import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import type { MenuWindow } from './MenuWindow';

export type MenuResult = number | 'cancel' | undefined;

export interface MenuOptions {
  /** Pixel x of the cursor; items are drawn after it. */
  left: number;
  top: number;
  /** Pixel distance between rows (Menu_InitCursor cursorHeight). */
  rowHeight: number;
  /** Menu_MoveCursor wraps; Menu_ProcessInputNoWrapAround doesn't. */
  wrap: boolean;
  /** Frames to ignore input after opening (Task_YesNoMenu_HandleInput waits 5). */
  inputDelay?: number;
}

/**
 * A vertical cursor menu inside a MenuWindow (menu.c): the cursor is the ▶ glyph, redrawn
 * by clearing its cell and printing at the new row (Menu_RedrawCursor).
 */
export class Menu {
  cursor: number;
  private delay: number;

  constructor(
    private win: MenuWindow,
    private input: Input,
    private cursorGlyph: number[],
    readonly count: number,
    private opts: MenuOptions,
    initial = 0,
  ) {
    this.cursor = initial;
    this.delay = opts.inputDelay ?? 0;
    this.drawCursor();
  }

  /**
   * One frame of input. Returns the chosen index, 'cancel' for B, or undefined. Menu_ProcessInput (wrap) /
   * Menu_ProcessInputNoWrapAround: SE_SELECT on A, and on UP / DOWN (without wrapping, only if the cursor moved).
   */
  tick(): MenuResult {
    if (this.delay > 0) {
      this.delay--;
      return undefined;
    }
    if (this.input.pressed('A')) {
      PlaySE(K.SE_SELECT);
      return this.cursor;
    }
    if (this.input.pressed('B')) return 'cancel';
    if (this.input.pressed('UP')) {
      if (this.move(-1) || this.opts.wrap) PlaySE(K.SE_SELECT);
    } else if (this.input.pressed('DOWN')) {
      if (this.move(1) || this.opts.wrap) PlaySE(K.SE_SELECT);
    }
    return undefined;
  }

  /** Menu_MoveCursor / Menu_MoveCursorNoWrapAround: whether the cursor moved. */
  private move(delta: number): boolean {
    let next = this.cursor + delta;
    if (this.opts.wrap) next = (next + this.count) % this.count;
    else next = Math.max(0, Math.min(this.count - 1, next));
    if (next === this.cursor) return false;
    this.clearCursor();
    this.cursor = next;
    this.drawCursor();
    return true;
  }

  private clearCursor(): void {
    this.win.clearRect(this.opts.left, this.opts.top + this.cursor * this.opts.rowHeight, 8, this.opts.rowHeight);
  }

  private drawCursor(): void {
    this.win.print(this.cursorGlyph, this.opts.left, this.opts.top + this.cursor * this.opts.rowHeight);
  }
}
