// quest_log.c's three windows on BG0 during the playback (sWindowTemplates): the top bar ("Previously on your
// quest…" and the scene number), the bottom bar and the description window over it (an event's line of text). Like
// the help message window, they're Phaser windows over the field, not the GBA layer: palette 15 is
// GetTextWindowPalette(4) (FieldCB2_QuestLogStartPlayback* / FieldCB2_FinalScene load it), the description window's
// tiles graphics/quest_log/description_window.4bpp (sDescriptionWindow_Gfx). They sit under the screen fade, which
// fades them with the field as the GBA's palette fade does. The logic (which C function draws what, and when) is
// world/questLogScreen.ts; this is the window side: AddWindow, FillWindowPixelRect, PutWindowTilemap /
// ClearWindowTilemap, the text printers.

import type Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { TextPrinter } from '../text/TextPrinter';
import { DEPTH_UI, TextWindow } from '../text/TextWindow';

/** What the windows draw with (preload with loadGfx). */
export const questLogWindowsGfxSymbols = ['sDescriptionWindow_Gfx', 'gTextWindowPalettes'];

export const WIN_TOP_BAR = 0;
export const WIN_BOTTOM_BAR = 1;
export const WIN_DESCRIPTION = 2;

/** sWindowTemplates (all on BG0, palette 15) */
export const QUEST_LOG_WINDOW_TEMPLATES = [
  { tilemapLeft: 0, tilemapTop: 0, width: 30, height: 2 },
  { tilemapLeft: 0, tilemapTop: 18, width: 30, height: 2 },
  { tilemapLeft: 0, tilemapTop: 14, width: 30, height: 6 }, // DESC_WIN_WIDTH x DESC_WIN_HEIGHT
] as const;

/** Under the screen fade, over the field's other windows (the description window over the bottom bar). */
const DEPTHS = [DEPTH_UI + 20, DEPTH_UI + 20, DEPTH_UI + 21];

/** sTextColors: TEXT_DYNAMIC_COLOR_6 (background), TEXT_COLOR_WHITE, TEXT_DYNAMIC_COLOR_3 (shadow) */
const TEXT_BG = 0xf;
const TEXT_FG = 0x1;
const TEXT_SHADOW = 0xc;

/** GetTextWindowPalette(4) as RGB. */
function questLogWindowPalette(): [number, number, number][] {
  const pal = gfx16('gTextWindowPalettes').subarray(4 * 16, 5 * 16);
  const ch = (v: number) => (v << 3) | (v >> 2);
  return Array.from(pal, (c) => [ch(c & 0x1f), ch((c >> 5) & 0x1f), ch((c >> 10) & 0x1f)]);
}

export class QuestLogWindows {
  /** sWindowIds: undefined until AddWindow / after RemoveWindow */
  private wins: (TextWindow | undefined)[] = [];
  /** What each window last printed (for the tests' probe). */
  private texts: (number[] | undefined)[] = [];

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
  ) {}

  /** AddWindow(sWindowTemplates[i]) (an earlier window of the same id goes: the C overwrites sWindowIds). The tilemap isn't put yet. */
  addWindow(id: number): void {
    this.wins[id]?.destroy();
    const t = QUEST_LOG_WINDOW_TEMPLATES[id];
    const win = new TextWindow(this.scene, t.tilemapLeft * 8, t.tilemapTop * 8, t.width * 8, t.height * 8, questLogWindowPalette());
    win.image.setDepth(DEPTHS[id]);
    win.setVisible(false);
    this.wins[id] = win;
    this.texts[id] = undefined;
    win.flush();
  }

  /** FillWindowPixelRect */
  fillRect(id: number, color: number, x: number, y: number, w: number, h: number): void {
    this.wins[id]?.fillRect(x, y, w, h, color);
    this.wins[id]?.flush(); // CopyWindowToVram
    if (x === 0 && y === 0 && color === TEXT_BG) this.texts[id] = undefined;
  }

  /** PutWindowTilemap / ClearWindowTilemap (each drawing call copies its window to the screen: CopyWindowToVram). */
  setTilemap(id: number, shown: boolean): void {
    this.wins[id]?.setVisible(shown);
  }

  /** CopyDescriptionWindowTiles: the description window's rows of tiles (top edge, middle, bottom edge) into its pixels. */
  copyDescriptionWindowTiles(): void {
    const win = this.wins[WIN_DESCRIPTION];
    if (!win) return;
    const src = gfx('sDescriptionWindow_Gfx');
    const { width, height } = QUEST_LOG_WINDOW_TEMPLATES[WIN_DESCRIPTION];
    for (let i = 0; i < height; i++) {
      const tile = i === 0 ? 0 : i === height - 1 ? 2 : 1;
      for (let j = 0; j < width; j++) {
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const byte = src[tile * 32 + y * 4 + (x >> 1)];
            win.fillRect(j * 8 + x, i * 8 + y, 1, 1, x & 1 ? byte >> 4 : byte & 0xf); // CopyToWindowPixelBuffer: colour 0 too
          }
        }
      }
    }
    win.flush();
  }

  /** AddTextPrinterParameterized4(window, FONT_NORMAL, x, y, 1, lineSpacing, sTextColors, 0, text): printed at once. */
  print(id: number, text: number[], x: number, y: number, lineSpacing: number): void {
    const win = this.wins[id];
    if (!win) return;
    const printer = new TextPrinter(win, this.fonts, this.input, new ImageData(1, 1), text, {
      fontId: FONT_NORMAL,
      x,
      y,
      fgColor: TEXT_FG,
      bgColor: TEXT_BG,
      shadowColor: TEXT_SHADOW,
      lineSpacing,
      speed: 0,
      canABSpeedUp: false,
      scrollSpeed: 1,
    });
    printer.tick();
    win.flush();
    this.texts[id] = text;
  }

  /** RemoveWindow */
  removeWindow(id: number): void {
    this.wins[id]?.destroy();
    this.wins[id] = undefined;
    this.texts[id] = undefined;
  }

  /** Every window gone (a map load's FreeAllWindowBuffers after a soft reset, the scene going). */
  destroy(): void {
    for (let i = 0; i < this.wins.length; i++) this.removeWindow(i);
  }

  /** Dev: each window's state: added, shown (its tilemap put) and the text it printed last (encoded). */
  probe(): { added: boolean; shown: boolean; text?: number[] }[] {
    return [0, 1, 2].map((i) => ({ added: !!this.wins[i], shown: !!this.wins[i]?.image.visible, text: this.texts[i] }));
  }
}
