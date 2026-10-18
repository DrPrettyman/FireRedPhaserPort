import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { FLAG_GET_SEEN, GetNationalPokedexCount } from '../menus/pokedex';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import type { Fonts } from '../text/Font';
import { expandPlaceholders } from '../text/placeholders';
import { DestroyHelpMessageWindow, DrawHelpMessageWindowWithText, PrintTextOnHelpMessageWindow } from './HelpMessageWindow';
import { Menu } from './Menu';
import { MenuWindow } from './MenuWindow';

export type StartMenuItem = 'POKEDEX' | 'POKEMON' | 'BAG' | 'PLAYER' | 'SAVE' | 'OPTION' | 'EXIT' | 'RETIRE';

/** sStartMenuActionTable labels (src/strings.c). */
const LABELS: Record<StartMenuItem, string> = {
  POKEDEX: 'gText_MenuPokedex',
  POKEMON: 'gText_MenuPokemon',
  BAG: 'gText_MenuBag',
  PLAYER: 'gText_MenuPlayer',
  SAVE: 'gText_MenuSave',
  OPTION: 'gText_MenuOption',
  EXIT: 'gText_MenuExit',
  RETIRE: 'gText_MenuRetire',
};

/** sStartMenuDescPointers: what the help window says about each item. */
const DESCRIPTIONS: Record<StartMenuItem, string> = {
  POKEDEX: 'gStartMenuDesc_Pokedex',
  POKEMON: 'gStartMenuDesc_Pokemon',
  BAG: 'gStartMenuDesc_Bag',
  PLAYER: 'gStartMenuDesc_Player',
  SAVE: 'gStartMenuDesc_Save',
  OPTION: 'gStartMenuDesc_Option',
  EXIT: 'gStartMenuDesc_Exit',
  RETIRE: 'gStartMenuDesc_Retire',
};

/** OPTIONS_BUTTON_MODE_HELP (include/constants/global.h) */
const OPTIONS_BUTTON_MODE_HELP = 0;

/** Remembered across openings, like sStartMenuCursorPos. */
let lastCursor = 0;
/** The open menu, for the e2e tests' probe. */
let openMenu: StartMenu | undefined;

/** Dev: the open start menu's items and cursor. */
export function startMenuProbe(): { items: StartMenuItem[]; cursor: number } | undefined {
  return openMenu && { items: [...openMenu.items], cursor: lastCursor };
}

/**
 * The field start menu (start_menu.c): SetUpStartMenu_NormalField / _SafariZone item order, a std-framed
 * window at tile (22, 1) sized to the item count, ▶ cursor that wraps, A selects, B/START close. In the
 * Safari Zone the steps and balls left are shown top left (DrawSafariZoneStatsWindow). In the HELP button mode
 * the help window at the bottom describes the item under the cursor (sStartMenuDescPointers).
 */
export class StartMenu {
  readonly items: StartMenuItem[];
  private win: MenuWindow;
  private menu: Menu;
  private safariStats?: MenuWindow;
  /** The help window shows the descriptions (!MenuHelpers_IsLinkActive() && !InUnionRoom(): always, no link play). */
  private showsHelp: boolean;
  private describe: (item: StartMenuItem) => number[];

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    private input: Input,
    charmap: Charmap,
    strings: Record<string, string>,
    private state: GameState,
  ) {
    this.items = [];
    const safari = state.getFlag('FLAG_SYS_SAFARI_MODE'); // GetSafariZoneFlag
    if (safari) {
      this.items.push('RETIRE', 'POKEDEX', 'POKEMON', 'BAG', 'PLAYER', 'OPTION', 'EXIT');
    } else {
      if (state.getFlag('FLAG_SYS_POKEDEX_GET')) this.items.push('POKEDEX');
      if (state.getFlag('FLAG_SYS_POKEMON_GET')) this.items.push('POKEMON');
      this.items.push('BAG', 'PLAYER', 'SAVE', 'OPTION', 'EXIT');
    }

    // CreateStartMenuWindow: SetWindowTemplateFields(0, 22, 1, 7, height * 2 - 1, ...)
    // DrawStdWindowFrame: the user's frame (LoadStdWindowFrameGfx loads it as the std window graphics)
    const frameType = state.optionsWindowFrameType + 1;
    this.win = new MenuWindow(scene, { left: 22, top: 1, width: 7, height: this.items.length * 2 - 1 }, fonts, input, frameType);
    const text = (label: string) => expandPlaceholders(charmap.encode(strings[label] ?? '?$'), charmap, state);
    if (safari) {
      // DrawSafariZoneStatsWindow: steps left / 600, balls left (STR_CONV_MODE_RIGHT_ALIGN pads with spaces)
      this.safariStats = new MenuWindow(scene, { left: 1, top: 1, width: 10, height: 4 }, fonts, input, frameType);
      const pad = (n: number, width: number) => charmap.encodePlain(`${String(n).padStart(width, ' ')}$`);
      state.stringVars = [pad(state.safariZoneStepCounter, 3), pad(600, 3), pad(state.numSafariBalls, 2)];
      this.safariStats.print(text('gText_MenuSafariStats'), 4, 3);
      this.safariStats.flush();
    }
    this.items.forEach((item, i) => this.win.print(text(LABELS[item]), 8, i * 15));
    lastCursor = Math.min(lastCursor, this.items.length - 1);
    this.menu = new Menu(this.win, input, text('gText_SelectorArrow2'), this.items.length, {
      left: 0,
      top: 0,
      rowHeight: 15,
      wrap: true,
    }, lastCursor);
    openMenu = this;
    // DoDrawStartMenu case 5: DrawHelpMessageWindowWithText(sStartMenuDescPointers[...])
    this.showsHelp = state.optionsButtonMode === OPTIONS_BUTTON_MODE_HELP;
    this.describe = (item) => charmap.encode(strings[DESCRIPTIONS[item]] ?? '?$');
    if (this.showsHelp) DrawHelpMessageWindowWithText(scene, fonts, input, this.describe(this.items[lastCursor]));
  }

  /** Returns the chosen item, 'close' when dismissed, or undefined while open. */
  tick(): StartMenuItem | 'close' | undefined {
    if (this.input.pressed('START')) return this.close();
    const r = this.menu.tick();
    this.win.flush();
    // StartCB_HandleInput: UP / DOWN reprint the help window
    if (this.menu.cursor !== lastCursor && this.showsHelp) PrintTextOnHelpMessageWindow(this.describe(this.items[this.menu.cursor]));
    lastCursor = this.menu.cursor;
    if (r === 'cancel') return this.close();
    if (r === undefined) return undefined;
    const item = this.items[r];
    // StartMenuPokedexSanityCheck: no POKéDEX before a mon has been seen
    if (item === 'POKEDEX' && GetNationalPokedexCount(this.state, FLAG_GET_SEEN) === 0) return undefined;
    if (item === 'EXIT') return this.close();
    if (item === 'RETIRE') PlaySE(K.SE_SELECT); // StartMenuSafariZoneRetireCallback's CloseStartMenu
    this.destroy();
    return item;
  }

  /** CloseStartMenu (B / START, StartMenuExitCallback) */
  private close(): 'close' {
    PlaySE(K.SE_SELECT);
    this.destroy();
    return 'close';
  }

  /** CloseStartMenu + DestroySafariZoneStatsWindow + DestroyHelpMessageWindow_ */
  private destroy(): void {
    if (openMenu === this) openMenu = undefined;
    this.win.destroy();
    this.safariStats?.destroy();
    DestroyHelpMessageWindow();
  }
}
