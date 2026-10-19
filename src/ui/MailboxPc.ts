// mailbox_pc.c: the player's PC mailbox list on the field. Window 0 holds the "MAILBOX" title, window 1 the list of
// mails (each by its writer's name: ItemPrintFunc) with CANCEL, scrolling eight at a time with the bouncing arrows;
// window 2 (the READ / MOVE TO BAG / GIVE / EXIT submenu) is drawn by ui/PlayerPcMenu.ts, which runs player_pc.c's
// mailbox tasks on top of this.

import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { GetMenuCursorDimensionByFont } from '../gba/menu';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { ConvertInternationalString, StringLength } from '../menus/mail';
import type { GameState } from '../state/GameState';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { gPlayerPcMenuManager } from '../world/mail';
import { FieldListMenu, FieldScrollArrows, LIST_CANCEL, type FieldListMenuItem } from './FieldListMenu';
import { MenuWindow, type TileRect } from './MenuWindow';

const EOS = 0xff;

/** sWindowTemplates: 0 the title, 1 the list, 2 the mail submenu. */
export const MAILBOX_WINDOWS: TileRect[] = [
  { left: 1, top: 1, width: 10, height: 2 },
  { left: 19, top: 1, width: 10, height: 18 },
  { left: 1, top: 1, width: 15, height: 8 },
];

/** The list's windows, list menu and scroll arrows (sWindowIds, sListMenuItems, gPlayerPcMenuManager.scrollIndicatorId). */
export class MailboxPc {
  private readonly windows: (MenuWindow | undefined)[] = [undefined, undefined, undefined];
  list?: FieldListMenu;
  private arrows?: FieldScrollArrows;

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private state: GameState,
    /** gText_* encoded */
    private text: (symbol: string) => number[],
  ) {}

  /** MailboxPC_InitBuffers: the list's items are made in MailboxPC_InitListMenu; every window id unset. */
  MailboxPC_InitBuffers(_num: number): boolean {
    for (let i = 0; i < this.windows.length; i++) this.windows[i] = undefined;
    return true;
  }

  /** MailboxPC_GetAddWindow: the window, added (with its std frame) if it isn't up. */
  MailboxPC_GetAddWindow(winIdx: number): MenuWindow {
    this.windows[winIdx] ??= new MenuWindow(this.scene, MAILBOX_WINDOWS[winIdx], this.fonts, this.input, 'std'); // SetStdWindowBorderStyle
    return this.windows[winIdx];
  }

  /** MailboxPC_RemoveWindow: ClearStdWindowAndFrameToTransparent + RemoveWindow. */
  MailboxPC_RemoveWindow(winIdx: number): void {
    this.windows[winIdx]?.destroy();
    this.windows[winIdx] = undefined;
  }

  /** ItemPrintFunc: a mail's writer at x 8 (a name under 6 chars as a Japanese one); nothing for CANCEL. */
  private itemPrintFunc(win: MenuWindow, itemId: number, y: number): void {
    if (itemId === LIST_CANCEL) return;
    let strbuf = [...this.state.mail[itemId + K.PARTY_SIZE].playerName];
    if (StringLength(strbuf) <= 5) strbuf = ConvertInternationalString(strbuf.slice(0, StringLength(strbuf) + 1), K.LANGUAGE_JAPANESE);
    win.print(strbuf.includes(EOS) ? strbuf : [...strbuf, EOS], 8, y, FONT_NORMAL); // sTextColor {1, 2, 3}: the window's own
  }

  /** MailboxPC_InitListMenu: `count` mails (labels empty, the print func writes the names) and CANCEL. */
  MailboxPC_InitListMenu(mgr: typeof gPlayerPcMenuManager): FieldListMenu {
    const win = this.windows[1]!;
    const items: FieldListMenuItem[] = [];
    for (let i = 0; i < mgr.count; i++) items.push({ label: [EOS], index: i }); // sString_Dummy
    items.push({ label: this.text('gFameCheckerText_Cancel'), index: LIST_CANCEL });
    this.list = new FieldListMenu(
      win,
      this.fonts,
      this.input,
      this.text('gText_SelectorArrow2'),
      {
        items,
        moveCursorFunc: (_itemIndex, onInit) => {
          if (onInit !== true) PlaySE(K.SE_SELECT); // MoveCursorFunc
        },
        itemPrintFunc: (index, y) => this.itemPrintFunc(win, index, y),
        totalItems: mgr.count + 1,
        maxShowed: 8,
        item_X: GetMenuCursorDimensionByFont(FONT_NORMAL, 0), // 8, not the font's maxLetterWidth (10)
        cursor_X: 0,
        upText_Y: 10,
        itemVerticalPadding: 2,
        fontId: FONT_NORMAL,
      },
      mgr.cursorPos,
      mgr.itemsAbove,
    );
    return this.list;
  }

  /** MailboxPC_AddScrollIndicatorArrows: x 0xC2, y 0xC / 0x94, down to count - pageItems + 1 (Task_ScrollIndicatorArrowPair reads cursorPos). */
  MailboxPC_AddScrollIndicatorArrows(mgr: typeof gPlayerPcMenuManager): void {
    this.arrows = new FieldScrollArrows(
      this.scene,
      { firstX: 0xc2, firstY: 0xc, secondX: 0xc2, secondY: 0x94, fullyUpThreshold: 0, fullyDownThreshold: mgr.count - mgr.pageItems + 1 },
      () => mgr.cursorPos,
    );
    this.arrows.updateVisibility();
  }

  /** RemoveScrollIndicatorArrowPair(gPlayerPcMenuManager.scrollIndicatorId) */
  removeScrollIndicatorArrows(): void {
    this.arrows?.destroy();
    this.arrows = undefined;
  }

  /** DestroyListMenuTask: the list's scroll and row back into the manager (when asked). */
  destroyListMenuTask(mgr?: typeof gPlayerPcMenuManager): void {
    if (this.list && mgr) {
      mgr.cursorPos = this.list.cursorPos;
      mgr.itemsAbove = this.list.itemsAbove;
    }
    this.list = undefined;
  }

  /** MailboxPC_DestroyListMenuBuffer (Free(sListMenuItems)): nothing to free here. */
  MailboxPC_DestroyListMenuBuffer(): void {}

  /** One frame of the sprites: Task_ScrollIndicatorArrowPair, then AnimateSprites. */
  tickSprites(): void {
    this.arrows?.updateVisibility();
    this.arrows?.animate();
  }

  flush(): void {
    for (const w of this.windows) w?.flush();
  }

  /** Everything down (CleanupOverworldWindowsAndTilemaps before a screen). */
  destroy(): void {
    this.removeScrollIndicatorArrows();
    for (let i = 0; i < this.windows.length; i++) this.MailboxPC_RemoveWindow(i);
    this.list = undefined;
  }
}
