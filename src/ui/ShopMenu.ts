import type Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { Input } from '../input/Input';
import { GetMartFontId, GetMartTypeFromItemList, MART_TYPE_REGULAR, SetShopItemsForSale, sShopData } from '../menus/shop';
import { FONT_MALE, FONT_NORMAL, type Fonts } from '../text/Font';
import type { TextColor } from '../text/MessageBox';
import { Menu } from './Menu';
import { MenuWindow } from './MenuWindow';

/** What the shop needs from the overworld. */
export interface ShopHost {
  /** ContextNpcGetTextColor */
  contextTextColor(): TextColor;
  /** gSaveBlock2Ptr->optionsWindowFrameType + 1 (LoadUserWindowGfx's frame) */
  windowFrameType(): number;
  /** The encoded C string (gText_*). */
  text(symbol: string): number[];
  /** FadeScreen(FADE_TO_BLACK, 0); the wait ends when the fade has finished. */
  fadeToBlack(): () => boolean;
  /**
   * Task_GoToBuyOrSellMenu: leave the field for the buy menu or the sell bag (FieldMenuScene). They come
   * back through CB2_ReturnToField, after which the field calls `onReturn` (gFieldCallback).
   */
  goToBuyOrSellMenu(menu: 'buy' | 'sell', onReturn: () => void): void;
  /** FadeInFromBlack; the wait ends when the fade has finished (IsWeatherNotFadingIn). */
  fadeInFromBlack(): () => boolean;
  /** DisplayItemMessageOnField: the wait ends when the text has printed. */
  displayItemMessageOnField(color: TextColor, str: number[]): () => boolean;
}

/** sShopMenuWindowTemplate: tile (2, 1), 12x6. */
const RECT = { left: 2, top: 1, width: 12, height: 6 };

const ACTIONS = ['gText_ShopBuy', 'gText_ShopSell', 'gText_ShopQuit'];

/**
 * The field side of shop.c: CreatePokemartMenu's BUY/SELL/SEE YA! menu (CreateShopMenu +
 * Task_ShopMenu), the fade out to the buy menu or the sell bag, and the way back
 * (MapPostLoadHook_ReturnToShopMenu → Task_ReturnToShopMenu → "anything else" and the menu again).
 * `done` is set when the player quits (sShopData.callback = ScriptContext_Enable).
 */
export class ShopMenu {
  done = false;
  private win?: MenuWindow;
  private menu?: Menu;
  /** What the shop's current task is waiting on, and what it does next. */
  private wait?: () => boolean;
  private next?: () => void;
  private away = false;

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private host: ShopHost,
    items: number[],
  ) {
    // CreatePokemartMenu
    SetShopItemsForSale(items);
    this.CreateShopMenu(MART_TYPE_REGULAR);
    sShopData.callback = () => (this.done = true); // ScriptContext_Enable
  }

  /** One frame; true once the shop has closed. */
  tick(): boolean {
    if (this.done) return true;
    if (this.away) return false;
    if (this.wait) {
      if (!this.wait()) return false;
      const next = this.next!;
      this.wait = this.next = undefined;
      next();
      return this.done;
    }
    if (this.menu) this.Task_ShopMenu();
    this.win?.flush();
    return this.done;
  }

  private CreateShopMenu(martType: number): void {
    sShopData.martType = GetMartTypeFromItemList(martType);
    sShopData.selectedRow = 0;
    sShopData.fontId = this.host.contextTextColor() === 'male' ? K.FONT_MALE : K.FONT_FEMALE;
    this.win = new MenuWindow(this.scene, RECT, this.fonts, this.input, this.host.windowFrameType());
    // PrintTextArray(FONT_NORMAL, GetMenuCursorDimensionByFont(FONT_NORMAL, 0), 2, 16, 3) + Menu_InitCursor(0, 2, 16, 3, 0)
    const cursorWidth = this.fonts.get(FONT_NORMAL).info.maxLetterWidth;
    ACTIONS.forEach((label, i) => this.win!.print(this.host.text(label), cursorWidth, 2 + i * 16));
    this.menu = new Menu(this.win, this.input, this.host.text('gText_SelectorArrow2'), ACTIONS.length, { left: 0, top: 2, rowHeight: 16, wrap: false });
    this.win.flush();
  }

  /** Task_ShopMenu (Menu_ProcessInputNoWrapAround) */
  private Task_ShopMenu(): void {
    const input = this.menu!.tick();
    if (input === undefined) return;
    if (input === 'cancel') PlaySE(K.SE_SELECT); // MENU_B_PRESSED (A's SE_SELECT is Menu_ProcessInputNoWrapAround's)
    if (input === 'cancel' || input === 2) this.Task_HandleShopMenuQuit();
    else this.Task_HandleShopMenuBuyOrSell(input === 0 ? 'buy' : 'sell');
  }

  /** Task_HandleShopMenuBuy / Task_HandleShopMenuSell + Task_GoToBuyOrSellMenu */
  private Task_HandleShopMenuBuyOrSell(menu: 'buy' | 'sell'): void {
    this.menu = undefined;
    this.wait = this.host.fadeToBlack();
    this.next = () => {
      // FreeAllWindowBuffers: the field's windows go with it
      this.ClearShopMenuWindow();
      this.away = true;
      this.host.goToBuyOrSellMenu(menu, () => this.MapPostLoadHook_ReturnToShopMenu());
    };
  }

  private Task_HandleShopMenuQuit(): void {
    this.ClearShopMenuWindow();
    // RecordTransactionForQuestLog: the quest log isn't implemented
    sShopData.callback?.();
  }

  private ClearShopMenuWindow(): void {
    this.win?.destroy();
    this.win = undefined;
    this.menu = undefined;
  }

  /** MapPostLoadHook_ReturnToShopMenu + Task_ReturnToShopMenu */
  private MapPostLoadHook_ReturnToShopMenu(): void {
    this.away = false;
    this.wait = this.host.fadeInFromBlack();
    this.next = () => {
      const color: TextColor = GetMartFontId() === FONT_MALE ? 'male' : 'female';
      this.wait = this.host.displayItemMessageOnField(color, this.host.text('gText_AnythingElseICanHelp'));
      this.next = () => this.CreateShopMenu(sShopData.martType); // ShowShopMenuAfterExitingBuyOrSellMenu
    };
  }
}
