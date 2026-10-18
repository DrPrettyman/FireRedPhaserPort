// daycare.c's ShowDaycareLevelMenu: the Four Island daycare's "which one?" list (the two mons' nicknames with
// their gender symbols and the levels they'd be at now, and EXIT) in a field window, and
// Task_HandleDaycareLevelMenuInput, which leaves the choice in VAR_RESULT and ends the script's `waitstate`.

import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import { strBody, text } from '../menus/common';
import type { GameState } from '../state/GameState';
import { stringWidth } from '../text/stringWidth';
import { appendMonGenderSymbol, boxMonNickname, getLevelAfterDaycareSteps } from '../world/daycare';
import type { FieldTask } from '../world/elevator';
import { FieldListMenu, type ListMenuHost } from './FieldListMenu';
import { MenuWindow } from './MenuWindow';

const EOS = 0xff;

/** sDaycareLevelMenuWindowTemplate: bg 0, tilemapLeft 12, tilemapTop 1, width 17, height 5. */
const WINDOW = { left: 12, top: 1, width: 17, height: 5 };

/** The level menu while it's up, for tests. */
export interface DaycareLevelMenuProbe {
  /** The item under the cursor (0, 1, or DAYCARE_LEVEL_MENU_EXIT's row 2) */
  selected: number;
}

let sLevelMenuTask: DaycareLevelMenuTask | undefined;

/** Dev: the open level menu, if any. */
export function daycareLevelMenuProbe(): DaycareLevelMenuProbe | undefined {
  return sLevelMenuTask?.probe();
}

/** Task_HandleDaycareLevelMenuInput with its list (tMenuListTaskId) and window (tWindowId). */
class DaycareLevelMenuTask implements FieldTask {
  private readonly win: MenuWindow;
  private readonly list: FieldListMenu;
  done = false;

  constructor(
    private state: GameState,
    private host: ListMenuHost,
  ) {
    const d = (name: string) => state.defines.require(name);
    const fontId = d('FONT_NORMAL_COPY_2');
    // AddWindow + DrawStdWindowFrame(windowId, FALSE)
    this.win = new MenuWindow(host.scene, WINDOW, host.fonts, host.input, host.frameType());
    // sDaycareListMenuLevelTemplate (sLevelMenuItems: two empty labels the item print func fills, and EXIT)
    this.list = new FieldListMenu(
      this.win,
      host.fonts,
      host.input,
      host.cursorGlyph(),
      {
        items: [
          { label: text('gExpandedPlaceholder_Empty'), index: 0 },
          { label: text('gExpandedPlaceholder_Empty'), index: 1 },
          { label: text('gOtherText_Exit'), index: d('DAYCARE_LEVEL_MENU_EXIT') },
        ],
        itemPrintFunc: (index, y) => this.daycarePrintMonInfo(index, y),
        totalItems: 3,
        maxShowed: 3,
        item_X: 8,
        cursor_X: 0,
        upText_Y: 0,
        itemVerticalPadding: 0,
        fontId,
      },
      0,
      0,
    );
  }

  /** DaycarePrintMonInfo: the nickname and gender symbol at x 8, "Lv." and the level right-aligned to x 132. */
  private daycarePrintMonInfo(daycareSlotId: number, y: number): void {
    const daycare = this.state.daycare;
    if (daycareSlotId >>> 0 >= daycare.mons.length) return;
    const fontId = this.state.defines.require('FONT_NORMAL_COPY_2');
    const daycareMon = daycare.mons[daycareSlotId];
    const mon = daycareMon.mon;
    if (mon === null) return; // (the menu only opens with both mons in)
    // DaycarePrintMonNickname
    const nickname = appendMonGenderSymbol(this.state, boxMonNickname(this.state, mon), mon);
    this.win.print([...nickname, EOS], 8, y, fontId);
    // DaycarePrintMonLvl
    const level = getLevelAfterDaycareSteps(this.state, mon, daycareMon.steps);
    const lvlText = [...strBody(text('gText_Lv')), ...ConvertIntToDecimalStringN(level, STR_CONV_MODE_LEFT_ALIGN, 3), EOS];
    const x = 132 - stringWidth(this.host.fonts, fontId, lvlText, 0);
    this.win.print(lvlText, x, y, fontId);
  }

  tick(): boolean {
    if (this.done) return true;
    const input = this.list.processInput(); // ListMenu_ProcessInput
    const d = (name: string) => this.state.defines.require(name);
    if (this.host.input.pressed('A')) {
      if (input === 0 || input === 1) this.state.setVar('VAR_RESULT', input);
      else if (input === d('DAYCARE_LEVEL_MENU_EXIT')) this.state.setVar('VAR_RESULT', d('DAYCARE_EXITED_LEVEL_MENU'));
    } else if (this.host.input.pressed('B')) {
      this.state.setVar('VAR_RESULT', d('DAYCARE_EXITED_LEVEL_MENU'));
    } else {
      return false;
    }
    // DestroyListMenuTask, ClearStdWindowAndFrame(TRUE), RemoveWindow, DestroyTask, ScriptContext_Enable
    this.win.destroy();
    this.done = true;
    if (sLevelMenuTask === this) sLevelMenuTask = undefined;
    return true;
  }

  probe(): DaycareLevelMenuProbe {
    return { selected: this.list.cursorPos + this.list.itemsAbove };
  }
}

/** ShowDaycareLevelMenu: returns the wait for the script's `waitstate` (until A or B closes the menu). */
export function ShowDaycareLevelMenu(state: GameState, host: ListMenuHost): () => boolean {
  const task = new DaycareLevelMenuTask(state, host);
  sLevelMenuTask = task;
  host.startFieldTask(task);
  return () => task.done;
}
