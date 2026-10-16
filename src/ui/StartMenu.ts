import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import type { Fonts } from '../text/Font';
import { expandPlaceholders } from '../text/placeholders';
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
 * Safari Zone the steps and balls left are shown top left (DrawSafariZoneStatsWindow).
 */
export class StartMenu {
  readonly items: StartMenuItem[];
  private win: MenuWindow;
  private menu: Menu;
  private safariStats?: MenuWindow;

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    private input: Input,
    charmap: Charmap,
    strings: Record<string, string>,
    state: GameState,
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
    this.win = new MenuWindow(scene, { left: 22, top: 1, width: 7, height: this.items.length * 2 - 1 }, fonts, input);
    const text = (label: string) => expandPlaceholders(charmap.encode(strings[label] ?? '?$'), charmap, state);
    if (safari) {
      // DrawSafariZoneStatsWindow: steps left / 600, balls left (STR_CONV_MODE_RIGHT_ALIGN pads with spaces)
      this.safariStats = new MenuWindow(scene, { left: 1, top: 1, width: 10, height: 4 }, fonts, input);
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
  }

  /** Returns the chosen item, 'close' when dismissed, or undefined while open. */
  tick(): StartMenuItem | 'close' | undefined {
    if (this.input.pressed('START')) return this.close();
    const r = this.menu.tick();
    this.win.flush();
    lastCursor = this.menu.cursor;
    if (r === 'cancel') return this.close();
    if (r === undefined) return undefined;
    const item = this.items[r];
    if (item === 'EXIT') return this.close();
    this.destroy();
    return item;
  }

  private close(): 'close' {
    this.destroy();
    return 'close';
  }

  /** CloseStartMenu + DestroySafariZoneStatsWindow */
  private destroy(): void {
    if (openMenu === this) openMenu = undefined;
    this.win.destroy();
    this.safariStats?.destroy();
  }
}
