// The field's scrolling list menu: list_menu.c's ListMenu on a field MenuWindow, menu_indicators.c's
// bouncing scroll arrows as Phaser images, and field_specials.c's `special ListMenu` /
// `special ReturnToListMenu` (Silph Co.'s elevator, the Cerulean badge and berry powder lists).
// The GBA-layer screens (the bag) use src/gba/listMenu.ts; the field draws with Phaser windows.

import Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import type { Input } from '../input/Input';
import { gSineTable } from '../battle/trig';
import type { GameState } from '../state/GameState';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { sElevatorCursorPos, sElevatorScroll, type FieldTask } from '../world/elevator';
import { DEPTH_UI, MenuWindow } from './MenuWindow';
import { SCR_MENU_CANCEL } from './MultichoiceMenu';

// include/list_menu.h
export const LIST_NOTHING_CHOSEN = -1;
export const LIST_CANCEL = -2;
const LIST_HEADER = -3;

/** gMenuCursorDimensions[FONT_NORMAL]: the ▶ cell ListMenuErasePrintedCursor clears. */
const CURSOR_WIDTH = 8;
const CURSOR_HEIGHT = 14;

/** gKeyRepeatStartDelay / gKeyRepeatContinueDelay (main.c) */
const KEY_REPEAT_START_DELAY = 40;
const KEY_REPEAT_CONTINUE_DELAY = 5;

const BUTTONS = ['A', 'B', 'START', 'SELECT', 'L', 'R', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;

/**
 * ReadKeys' key repeat (gMain.newAndRepeatedKeys) for the field, whose Input only has held and new
 * keys. It counts from when the menu opened rather than from whenever the keys went down.
 */
export class KeyRepeat {
  private held = '';
  private counter = KEY_REPEAT_START_DELAY;
  private repeated = false;

  constructor(private input: Input) {}

  sample(): void {
    const held = BUTTONS.filter((b) => this.input.held(b)).join();
    this.repeated = false;
    if (held !== '' && held === this.held) {
      if (--this.counter === 0) {
        this.repeated = true;
        this.counter = KEY_REPEAT_CONTINUE_DELAY;
      }
    } else {
      this.counter = KEY_REPEAT_START_DELAY;
    }
    this.held = held;
  }

  /** JOY_REPT(button) */
  newOrRepeated(b: 'UP' | 'DOWN'): boolean {
    return this.input.pressed(b) || (this.repeated && this.input.held(b));
  }
}

export interface FieldListMenuItem {
  label: number[];
  index: number;
}

/** struct ListMenuTemplate's fields the field lists use (colours are the window's: fill 1, fg 2, shadow 3). */
export interface FieldListMenuTemplate {
  items: FieldListMenuItem[];
  /** moveCursorFunc(itemIndex, onInit) */
  moveCursorFunc?: (itemIndex: number, onInit: boolean) => void;
  /** itemPrintFunc(itemIndex, y): prints before each item's label (the daycare level menu) */
  itemPrintFunc?: (itemIndex: number, y: number) => void;
  totalItems: number;
  maxShowed: number;
  item_X: number;
  cursor_X: number;
  upText_Y: number;
  itemVerticalPadding: number;
  fontId: number;
}

/**
 * list_menu.c's ListMenu (cursorKind 0, no headers' x, no multiple scroll) on a MenuWindow. `cursorPos`
 * is the scroll offset (the first item shown) and `itemsAbove` the cursor's row, as in the C.
 */
export class FieldListMenu {
  cursorPos: number;
  itemsAbove: number;
  private readonly keys: KeyRepeat;
  private readonly t: FieldListMenuTemplate;

  /** ListMenuInit */
  constructor(
    private win: MenuWindow,
    private fonts: Fonts,
    private input: Input,
    private cursorGlyph: number[],
    template: FieldListMenuTemplate,
    cursorPos: number,
    itemsAbove: number,
  ) {
    this.keys = new KeyRepeat(input);
    this.t = { ...template };
    this.cursorPos = cursorPos;
    this.itemsAbove = itemsAbove;
    if (this.t.totalItems < this.t.maxShowed) this.t.maxShowed = this.t.totalItems;
    this.win.clearRect(0, 0, this.win.rect.width * 8, this.win.rect.height * 8); // FillWindowPixelBuffer(fillValue)
    this.printEntries(this.cursorPos, 0, this.t.maxShowed);
    this.drawCursor();
    this.callSelectionChangedCallback(true);
    this.win.flush();
  }

  private get yMultiplier(): number {
    return this.fonts.get(this.t.fontId).info.maxLetterHeight + this.t.itemVerticalPadding;
  }

  /** ListMenu_ProcessInput: the chosen item's index, LIST_CANCEL or LIST_NOTHING_CHOSEN. */
  processInput(): number {
    this.keys.sample();
    let result = LIST_NOTHING_CHOSEN;
    if (this.input.pressed('A')) result = this.t.items[this.cursorPos + this.itemsAbove].index;
    else if (this.input.pressed('B')) result = LIST_CANCEL;
    else if (this.keys.newOrRepeated('UP')) this.changeSelection(1, false);
    else if (this.keys.newOrRepeated('DOWN')) this.changeSelection(1, true);
    this.win.flush();
    return result;
  }

  private printEntries(startIndex: number, yOffset: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const item = this.t.items[startIndex];
      // header_X is 0 for every field list, and none has headers
      const x = item.index !== LIST_HEADER ? this.t.item_X : 0;
      const y = (yOffset + i) * this.yMultiplier + this.t.upText_Y;
      this.t.itemPrintFunc?.(item.index, y);
      this.win.print(item.label, x, y, this.t.fontId);
      startIndex++;
    }
  }

  /** ListMenuDrawCursor (cursorKind 0: gText_SelectorArrow2) */
  private drawCursor(): void {
    const y = this.itemsAbove * this.yMultiplier + this.t.upText_Y;
    this.win.print(this.cursorGlyph, this.t.cursor_X, y, this.t.fontId);
  }

  /** ListMenuErasePrintedCursor */
  private erasePrintedCursor(itemsAbove: number): void {
    this.win.clearRect(this.t.cursor_X, itemsAbove * this.yMultiplier + this.t.upText_Y, CURSOR_WIDTH, CURSOR_HEIGHT);
  }

  /** ListMenuUpdateSelectedRowIndexAndScrollOffset: 0 no change, 1 the cursor moved, 2 the list scrolled. */
  private updateSelectedRowIndexAndScrollOffset(movingDown: boolean): number {
    let itemsAbove = this.itemsAbove;
    const cursorPos = this.cursorPos;
    const maxShowed = this.t.maxShowed;
    const items = this.t.items;
    let newRow: number;
    let newScroll: number;
    if (!movingDown) {
      newRow = maxShowed === 1 ? 0 : maxShowed - (Math.trunc(maxShowed / 2) + (maxShowed % 2)) - 1;
      if (cursorPos === 0) {
        while (itemsAbove !== 0) {
          itemsAbove--;
          if (items[cursorPos + itemsAbove].index !== LIST_HEADER) {
            this.itemsAbove = itemsAbove;
            return 1;
          }
        }
        return 0;
      }
      while (itemsAbove > newRow) {
        itemsAbove--;
        if (items[cursorPos + itemsAbove].index !== LIST_HEADER) {
          this.itemsAbove = itemsAbove;
          return 1;
        }
      }
      newScroll = cursorPos - 1;
    } else {
      newRow = maxShowed === 1 ? 0 : Math.trunc(maxShowed / 2) + (maxShowed % 2);
      if (cursorPos === this.t.totalItems - maxShowed) {
        while (itemsAbove < maxShowed - 1) {
          itemsAbove++;
          if (items[cursorPos + itemsAbove].index !== LIST_HEADER) {
            this.itemsAbove = itemsAbove;
            return 1;
          }
        }
        return 0;
      }
      while (itemsAbove < newRow) {
        itemsAbove++;
        if (items[cursorPos + itemsAbove].index !== LIST_HEADER) {
          this.itemsAbove = itemsAbove;
          return 1;
        }
      }
      newScroll = cursorPos + 1;
    }
    this.itemsAbove = newRow;
    this.cursorPos = newScroll;
    return 2;
  }

  /**
   * ListMenuScroll. The C scrolls the window's pixels by `count` rows and prints the rows that came
   * into view; reprinting every shown row gives the same pixels (each row's glyph cells are rewritten
   * in full, and rows past the window's bottom are clipped either way).
   */
  private scroll(): void {
    this.win.clearRect(0, 0, this.win.rect.width * 8, this.win.rect.height * 8);
    this.printEntries(this.cursorPos, 0, this.t.maxShowed);
  }

  /** ListMenuChangeSelection (updateCursorAndCallCallback = TRUE) */
  private changeSelection(count: number, movingDown: boolean): boolean {
    const oldSelectedRow = this.itemsAbove;
    let selectionChange = 0;
    for (let i = 0; i < count; i++) {
      for (;;) {
        const ret = this.updateSelectedRowIndexAndScrollOffset(movingDown);
        selectionChange |= ret;
        if (ret !== 2) break;
        if (this.t.items[this.cursorPos + this.itemsAbove].index !== LIST_HEADER) break;
      }
    }
    switch (selectionChange) {
      case 1:
        this.erasePrintedCursor(oldSelectedRow);
        this.drawCursor();
        this.callSelectionChangedCallback(false);
        break;
      case 2:
      case 3:
        this.erasePrintedCursor(oldSelectedRow);
        this.scroll();
        this.drawCursor();
        this.callSelectionChangedCallback(false);
        break;
      default:
        return true;
    }
    return false;
  }

  /** ListMenuCallSelectionChangedCallback */
  private callSelectionChangedCallback(onInit: boolean): void {
    this.t.moveCursorFunc?.(this.t.items[this.cursorPos + this.itemsAbove].index, onInit);
  }
}

// ------------------------------------------------------------------ menu_indicators.c

/** The scroll arrows' graphics (preload with loadGfx before a list opens). */
export const fieldListMenuGfxSymbols = ['sRedArrowOtherGfx', 'sRedArrowPal'];

const ARROW_TEXTURE = 'field_scroll_arrow';

/** sRedArrowOtherGfx's second 16x16 frame (tile 4, the up arrow) in sRedArrowPal, as a texture. */
function arrowTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(ARROW_TEXTURE)) return ARROW_TEXTURE;
  const tiles = gfx('sRedArrowOtherGfx');
  const pal = gfx16('sRedArrowPal');
  const tex = scene.textures.createCanvas(ARROW_TEXTURE, 16, 16)!;
  const img = tex.context.createImageData(16, 16);
  // 1D-mapped 16x16 OBJ: tiles 4..7 are its top-left, top-right, bottom-left and bottom-right 8x8s
  for (let t = 0; t < 4; t++) {
    const base = (4 + t) * 32;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = tiles[base + py * 4 + (px >> 1)];
        const ci = px & 1 ? byte >> 4 : byte & 0xf;
        if (ci === 0) continue;
        const c = pal[ci];
        const x = (t & 1) * 8 + px;
        const y = (t >> 1) * 8 + py;
        const o = (y * 16 + x) * 4;
        const ch = (v: number) => (v << 3) | (v >> 2);
        img.data[o] = ch(c & 0x1f);
        img.data[o + 1] = ch((c >> 5) & 0x1f);
        img.data[o + 2] = ch((c >> 10) & 0x1f);
        img.data[o + 3] = 255;
      }
    }
  }
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
  return ARROW_TEXTURE;
}

/** SCROLL_ARROW_UP / SCROLL_ARROW_DOWN's sScrollIndicatorTemplates: animNum 2/3 (down = v-flipped), bounce in y. */
const ARROW_FREQUENCY = { up: 8, down: -8 };
const ARROW_MULTIPLIER = 2;

/**
 * AddScrollIndicatorArrowPair for an up/down pair (SpriteCallback_ScrollIndicatorArrow's bounce and
 * Task_ScrollIndicatorArrowPair's hiding at the thresholds). OAM priority 0: over the text windows.
 */
export class FieldScrollArrows {
  private arrows: { image: Phaser.GameObjects.Image; y: number; state: number; sinePos: number; frequency: number }[];
  private thresholds: number[];

  constructor(
    scene: Phaser.Scene,
    t: { firstX: number; firstY: number; secondX: number; secondY: number; fullyUpThreshold: number; fullyDownThreshold: number },
    private scrollOffset: () => number,
  ) {
    const key = arrowTexture(scene);
    const make = (x: number, y: number, dir: 'up' | 'down') => ({
      // a 16x16 sprite's x/y is its centre
      image: scene.add.image(x - 8, y - 8, key).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_UI + 13).setFlipY(dir === 'down').setVisible(false),
      y: y - 8,
      state: 0,
      sinePos: 0,
      frequency: ARROW_FREQUENCY[dir],
    });
    this.arrows = [make(t.firstX, t.firstY, 'up'), make(t.secondX, t.secondY, 'down')];
    this.thresholds = [t.fullyUpThreshold, t.fullyDownThreshold];
  }

  /** Task_ScrollIndicatorArrowPair: hide an arrow at its end of the list. */
  updateVisibility(): void {
    const currItem = this.scrollOffset() & 0xffff;
    this.arrows.forEach((a, i) => a.image.setVisible(currItem !== this.thresholds[i]));
  }

  /** SpriteCallback_ScrollIndicatorArrow (AnimateSprites) */
  animate(): void {
    for (const a of this.arrows) {
      if (a.state === 0) {
        a.state++; // StartSpriteAnim
        continue;
      }
      a.image.y = a.y + Math.trunc((gSineTable(a.sinePos & 0xff) * ARROW_MULTIPLIER) / 256);
      a.sinePos += a.frequency;
    }
  }

  /** RemoveScrollIndicatorArrowPair */
  destroy(): void {
    for (const a of this.arrows) a.image.destroy();
  }
}

// ------------------------------------------------------------------ field_specials.c

/** What special ListMenu needs from the field. */
export interface ListMenuHost {
  scene: Phaser.Scene;
  fonts: Fonts;
  input: Input;
  /** LoadStdWindowFrameGfx's frame: the options' frame type + 1 */
  frameType(): number;
  /** gText_SelectorArrow2, encoded */
  cursorGlyph(): number[];
  /** sListMenuLabels[listMenuId], encoded */
  labels(listMenuId: number): number[][] | undefined;
  /** CreateTask: run once per frame after the script (RunTasks). */
  startFieldTask(task: FieldTask): void;
}

/** sListMenuLastScrollPosition: what the scroll arrows compare against. */
let sListMenuLastScrollPosition = 0;
/** ScriptContext_Enable from the list's tasks (the script waits on it with `waitstate`). */
let sScriptEnabled = false;
/** The ListMenu task while it exists (FindTaskIdByFunc). */
let sListMenuTask: ScriptListMenuTask | undefined;

type ListTaskFunc = 'Task_CreateScriptListMenu' | 'Task_ListMenuHandleInput' | 'Task_SuspendListMenu' | 'Task_RedrawScrollArrowsAndWaitInput';

/**
 * ListMenu's task. data[0] maxShowed, [1] totalItems, [2] window left, [3] top, [4] width, [5] height,
 * [6] suspend on a choice (1; 2 once ReturnToListMenu asks to come back), [7] initial scroll, [8] initial
 * row; the C's [12] arrow pair, [13] window and [14] list are the fields below.
 */
class ScriptListMenuTask implements FieldTask {
  readonly data = new Array<number>(16).fill(0);
  func: ListTaskFunc = 'Task_CreateScriptListMenu';
  private destroyed = false;
  private win?: MenuWindow;
  private list?: FieldListMenu;
  private arrows?: FieldScrollArrows;

  constructor(
    private host: ListMenuHost,
    private state: GameState,
    /** gSpecialVar_0x8004 */
    private listMenuId: number,
  ) {}

  tick(): boolean {
    this.arrows?.updateVisibility(); // Task_ScrollIndicatorArrowPair (priority 0) runs first
    switch (this.func) {
      case 'Task_CreateScriptListMenu':
        this.create();
        break;
      case 'Task_ListMenuHandleInput':
        this.handleInput();
        break;
      case 'Task_SuspendListMenu':
        this.suspend();
        break;
      case 'Task_RedrawScrollArrowsAndWaitInput':
        // LockPlayerFieldControls: the script still runs
        this.createScrollArrows();
        this.func = 'Task_ListMenuHandleInput';
        break;
    }
    if (this.destroyed) return true;
    this.arrows?.animate(); // AnimateSprites
    return false;
  }

  /** Task_CreateScriptListMenu */
  private create(): void {
    const data = this.data;
    const lsil = this.host;
    sListMenuLastScrollPosition = this.listMenuId === LISTMENU_SILPHCO_FLOORS ? sElevatorScroll : 0;
    const labels = lsil.labels(this.listMenuId) ?? [];
    const items: FieldListMenuItem[] = [];
    let mwidth = 0;
    for (let i = 0; i < data[1]; i++) {
      const label = labels[i] ?? [0xff];
      items.push({ label, index: i });
      mwidth = Math.max(mwidth, stringWidth(lsil.fonts, FONT_NORMAL, label, 0));
    }
    data[4] = Math.trunc((mwidth + 9) / 8) + 1;
    if (data[2] + data[4] > 29) data[2] = 29 - data[4];
    // SetWindowTemplateFields(0, left, top, width, height, 15, 0x038) + SetStdWindowBorderStyle
    this.win = new MenuWindow(lsil.scene, { left: data[2], top: data[3], width: data[4], height: data[5] }, lsil.fonts, lsil.input, lsil.frameType());
    this.createScrollArrows();
    // CreateScriptListMenu's template
    this.list = new FieldListMenu(
      this.win,
      lsil.fonts,
      lsil.input,
      lsil.cursorGlyph(),
      {
        items,
        moveCursorFunc: () => this.scriptListMenuMoveCursorFunction(),
        totalItems: data[1],
        maxShowed: data[0],
        item_X: 8,
        cursor_X: 0,
        upText_Y: 0,
        itemVerticalPadding: 0,
        fontId: FONT_NORMAL,
      },
      data[7],
      data[8],
    );
    this.func = 'Task_ListMenuHandleInput';
  }

  /** ScriptListMenuMoveCursorFunction (PlaySE(SE_SELECT) is silent) */
  private scriptListMenuMoveCursorFunction(): void {
    // FindTaskIdByFunc(Task_ListMenuHandleInput): not yet while the list is being created
    if (this.func === 'Task_ListMenuHandleInput' && this.list) sListMenuLastScrollPosition = this.list.cursorPos;
  }

  /** Task_ListMenuHandleInput */
  private handleInput(): void {
    const input = this.list!.processInput();
    switch (input) {
      case LIST_NOTHING_CHOSEN:
        break;
      case LIST_CANCEL:
        this.state.setVar('VAR_RESULT', SCR_MENU_CANCEL);
        this.destroyListMenu();
        break;
      default:
        this.state.setVar('VAR_RESULT', input);
        if (this.data[6] === 0 || input === this.data[1] - 1) {
          this.destroyListMenu();
        } else {
          this.removeScrollArrows();
          this.func = 'Task_SuspendListMenu';
          sScriptEnabled = true;
        }
        break;
    }
  }

  /** Task_DestroyListMenu: ClearStdWindowAndFrameToTransparent + RemoveWindow, then ScriptContext_Enable. */
  private destroyListMenu(): void {
    this.removeScrollArrows();
    this.win?.destroy();
    this.destroyed = true;
    if (sListMenuTask === this) sListMenuTask = undefined;
    sScriptEnabled = true;
  }

  /** Task_SuspendListMenu: the list stays up while the script talks; ReturnToListMenu brings input back. */
  private suspend(): void {
    if (this.data[6] === 2) {
      this.data[6] = 1;
      this.func = 'Task_RedrawScrollArrowsAndWaitInput';
    }
  }

  /** ReturnToListMenu's half */
  resume(): void {
    this.data[6]++;
  }

  /** Task_CreateMenuRemoveScrollIndicatorArrowPair */
  private createScrollArrows(): void {
    const data = this.data;
    if (data[0] === data[1]) return;
    const x = 4 * data[4] + 8 * data[2];
    this.arrows = new FieldScrollArrows(
      this.host.scene,
      { firstX: x, firstY: 8, secondX: x, secondY: 8 * data[5] + 10, fullyUpThreshold: 0, fullyDownThreshold: data[1] - data[0] },
      () => sListMenuLastScrollPosition,
    );
  }

  /** Task_ListMenuRemoveScrollIndicatorArrowPair */
  private removeScrollArrows(): void {
    this.arrows?.destroy();
    this.arrows = undefined;
  }

  /** Dev probe */
  probe(): FieldListMenuProbe | undefined {
    if (!this.list) return undefined;
    return {
      listMenuId: this.listMenuId,
      scroll: this.list.cursorPos,
      row: this.list.itemsAbove,
      selected: this.list.cursorPos + this.list.itemsAbove,
      suspended: this.func === 'Task_SuspendListMenu',
      arrows: this.arrows ? this.arrowsVisible() : undefined,
    };
  }

  private arrowsVisible(): { up: boolean; down: boolean } {
    const at = sListMenuLastScrollPosition;
    return { up: at !== 0, down: at !== this.data[1] - this.data[0] };
  }
}

/** The list special ListMenu has open, for tests. */
export interface FieldListMenuProbe {
  listMenuId: number;
  scroll: number;
  row: number;
  /** The item under the cursor */
  selected: number;
  suspended: boolean;
  /** Which scroll arrows are showing (undefined: the list has none, or they're down while suspended). */
  arrows?: { up: boolean; down: boolean };
}

/** Dev: the open ListMenu, if any. */
export function fieldListMenuProbe(): FieldListMenuProbe | undefined {
  return sListMenuTask?.probe();
}

// include/constants/menu.h
const LISTMENU_BADGES = 0;
const LISTMENU_SILPHCO_FLOORS = 1;
const LISTMENU_ROCKET_HIDEOUT_FLOORS = 2;
const LISTMENU_DEPT_STORE_FLOORS = 3;
const LISTMENU_WIRELESS_LECTURE_HEADERS = 4;
const LISTMENU_BERRY_POWDER = 5;
const LISTMENU_TRAINER_TOWER_FLOORS = 6;

/** ListMenu's switch: data[0..6] per LISTMENU_* (maxShowed, totalItems, left, top, width, height, suspend). */
const LIST_MENU_LAYOUTS: Record<number, number[]> = {
  [LISTMENU_BADGES]: [4, 9, 1, 1, 12, 7, 1],
  [LISTMENU_SILPHCO_FLOORS]: [7, 12, 1, 1, 8, 12, 0],
  [LISTMENU_ROCKET_HIDEOUT_FLOORS]: [4, 4, 1, 1, 8, 8, 0],
  [LISTMENU_DEPT_STORE_FLOORS]: [4, 6, 1, 1, 8, 8, 0],
  [LISTMENU_WIRELESS_LECTURE_HEADERS]: [4, 4, 1, 1, 17, 8, 1],
  [LISTMENU_BERRY_POWDER]: [7, 12, 16, 1, 17, 12, 0],
  [LISTMENU_TRAINER_TOWER_FLOORS]: [3, 3, 1, 1, 8, 6, 0],
};

/** A wait that ends at the list task's next ScriptContext_Enable. */
function waitForScriptEnable(): () => boolean {
  sScriptEnabled = false;
  return () => {
    if (!sScriptEnabled) return false;
    sScriptEnabled = false;
    return true;
  };
}

/**
 * special ListMenu: a list of sListMenuLabels[VAR_0x8004] (Silph Co.'s floor list starts where
 * InitElevatorFloorSelectMenuPos left it). Returns the wait for the script's `waitstate`, or undefined
 * when there's no list (an unknown id: VAR_RESULT = 127). QL_AvoidDisplay is the quest log's.
 */
export function ListMenu(state: GameState, host: ListMenuHost): (() => boolean) | undefined {
  const listMenuId = state.getVar('VAR_0x8004');
  const layout = LIST_MENU_LAYOUTS[listMenuId];
  if (!layout) {
    // case 99 makes a task with no list; anything else is the default case
    state.setVar('VAR_RESULT', SCR_MENU_CANCEL);
    return undefined;
  }
  const task = new ScriptListMenuTask(host, state, listMenuId);
  layout.forEach((v, i) => (task.data[i] = v));
  if (listMenuId === LISTMENU_SILPHCO_FLOORS) {
    task.data[7] = sElevatorScroll;
    task.data[8] = sElevatorCursorPos;
  }
  sListMenuTask = task;
  host.startFieldTask(task);
  return waitForScriptEnable();
}

/**
 * special ReturnToListMenu: back to the suspended list (Task_SuspendListMenu), whose next choice ends the
 * script's `waitstate`. Without one, ScriptContext_Enable at once.
 */
export function ReturnToListMenu(): (() => boolean) | undefined {
  const task = sListMenuTask;
  if (!task || task.func !== 'Task_SuspendListMenu') return undefined;
  task.resume();
  return waitForScriptEnable();
}
