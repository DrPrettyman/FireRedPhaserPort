import type Phaser from 'phaser';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_RIGHT_ALIGN } from '../battle/stringUtil';
import type { Input } from '../input/Input';
import { EOS, type Charmap } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL, type Fonts } from '../text/Font';
import { MenuWindow } from './MenuWindow';

/** coins.c's field coins box: "COINS" over "   N COINS", in a std-framed 8x3 window (ShowCoinsWindow). */
export class CoinsBox {
  private win: MenuWindow;

  constructor(
    scene: Phaser.Scene,
    private fonts: Fonts,
    input: Input,
    private charmap: Charmap,
    private strings: Record<string, string>,
    amount: number,
    x: number,
    y: number,
  ) {
    // SetWindowTemplateFields(0, x + 1, y + 1, 8, 3, 0xF, 0x20) with LoadStdWindowGfx's frame
    this.win = new MenuWindow(scene, { left: x + 1, top: y + 1, width: 8, height: 3 }, fonts, input, 'std');
    this.win.print(charmap.encode(strings.gText_Coins_2), 0, 0, FONT_NORMAL);
    this.change(amount);
  }

  /** PrintCoinsString: "{STR_VAR_1} COINS" (4 digits, right-aligned with spaces) right-aligned to x 64, y 12. */
  change(amount: number): void {
    const digits = ConvertIntToDecimalStringN(amount, STR_CONV_MODE_RIGHT_ALIGN, 4);
    // StringExpandPlaceholders(gStringVar4, gText_Coins)
    const [before, after] = this.strings.gText_Coins.split('{STR_VAR_1}');
    const text = [...this.charmap.encodePlain(`${before}$`), ...digits, ...this.charmap.encodePlain(after)]; // after ends in $
    const font = this.fonts.get(FONT_SMALL);
    const width = text.reduce((w, c) => w + font.width(c), 0); // GetStringWidth(FONT_SMALL, gStringVar4, 0)
    this.win.clearRect(0, 12, 64, 12); // the leading spaces repaint the old amount on the GBA
    this.win.print([...text, EOS], 64 - width, 12, FONT_SMALL);
    this.win.flush();
  }

  /** HideCoinsWindow */
  destroy(): void {
    this.win.destroy();
  }
}
