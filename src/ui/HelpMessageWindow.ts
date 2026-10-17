// help_message.c (+ new_menu_helpers.c's DrawHelpMessageWindowWithText / DestroyHelpMessageWindow_) on the field:
// the bar across the bottom of the screen (sHelpMessageWindowTemplate: tile (0, 15), 30x5) that shows the start
// menu's description of the item under the cursor. Like the start menu itself, it's drawn as a Phaser window over
// the field, not on the GBA layer: graphics/help_system/msg_window.4bpp (top row tile 0, middle rows tile 5, bottom
// row tile 14) in GetTextWindowPalette(2), which LoadHelpMessageWindowGfx loads for it, and the text in white
// (TEXT_DYNAMIC_COLOR_1) with a dark gray shadow straight on the bar. One window at a time, like sHelpMessageWindowId.

import type Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { TextPrinter } from '../text/TextPrinter';
import { DEPTH_UI, TextWindow } from '../text/TextWindow';

/** What the window draws with (preload with loadGfx). */
export const helpMessageWindowGfxSymbols = ['gHelpMessageWindow_Gfx', 'gTextWindowPalettes'];

/** sHelpMessageWindowTemplate */
const TEMPLATE = { tilemapLeft: 0, tilemapTop: 15, width: 30, height: 5 };

// sHelpMessageTextColors: TEXT_COLOR_TRANSPARENT, TEXT_DYNAMIC_COLOR_1, TEXT_COLOR_DARK_GRAY
const TEXT_COLOR_TRANSPARENT = 0;
const TEXT_DYNAMIC_COLOR_1 = 0xa;
const TEXT_COLOR_DARK_GRAY = 2;

interface HelpWindow {
  scene: Phaser.Scene;
  fonts: Fonts;
  input: Input;
  win: TextWindow;
  /** The text printed last (for the tests' probe). */
  text: number[];
}

/** sHelpMessageWindowId: the window while it's up. */
let sHelpWindow: HelpWindow | undefined;

/** GetTextWindowPalette(2) as RGB, for the window's 16 colours. */
function helpWindowPalette(): [number, number, number][] {
  const pal = gfx16('gTextWindowPalettes').subarray(2 * 16, 3 * 16);
  const ch = (v: number) => (v << 3) | (v >> 2);
  return Array.from(pal, (c) => [ch(c & 0x1f), ch((c >> 5) & 0x1f), ch((c >> 10) & 0x1f)]);
}

/** CreateHelpMessageWindow (+ LoadHelpMessageWindowGfx's palette): a no-op while the window is up. */
export function CreateHelpMessageWindow(scene: Phaser.Scene, fonts: Fonts, input: Input): void {
  if (sHelpWindow) return;
  const win = new TextWindow(scene, TEMPLATE.tilemapLeft * 8, TEMPLATE.tilemapTop * 8, TEMPLATE.width * 8, TEMPLATE.height * 8, helpWindowPalette());
  win.image.setDepth(DEPTH_UI + 11); // BG0, with the start menu
  sHelpWindow = { scene, fonts, input, win, text: [] };
}

/** DrawHelpMessageWindowTilesById: tile 0 along the top row, tile 5 in the middle rows, tile 14 along the bottom. */
function DrawHelpMessageWindowTiles(w: HelpWindow): void {
  const ptr = gfx('gHelpMessageWindow_Gfx');
  const width = TEMPLATE.width;
  const height = TEMPLATE.height;
  const pixels = new Uint8Array(width * 8 * height * 8);
  for (let i = 0; i < height; i++) {
    const tileId = i === 0 ? 0 : i === height - 1 ? 14 : 5;
    for (let j = 0; j < width; j++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const byte = ptr[tileId * 32 + y * 4 + (x >> 1)];
          pixels[(i * 8 + y) * width * 8 + j * 8 + x] = x & 1 ? byte >> 4 : byte & 0xf;
        }
      }
    }
  }
  // CopyToWindowPixelBuffer: every pixel, colour 0 included
  for (let y = 0; y < height * 8; y++) {
    for (let x = 0; x < width * 8; x++) w.win.fillRect(x, y, 1, 1, pixels[y * width * 8 + x]);
  }
}

/** PrintHelpMessageText: AddTextPrinterParameterized4(window, FONT_NORMAL, 2, 5, 1, 1, sHelpMessageTextColors, -1, text) */
function PrintHelpMessageText(w: HelpWindow, text: number[]): void {
  const printer = new TextPrinter(w.win, w.fonts, w.input, new ImageData(1, 1), text, {
    fontId: FONT_NORMAL,
    x: 2,
    y: 5,
    fgColor: TEXT_DYNAMIC_COLOR_1,
    bgColor: TEXT_COLOR_TRANSPARENT,
    shadowColor: TEXT_COLOR_DARK_GRAY,
    lineSpacing: 1,
    speed: 0,
    canABSpeedUp: false,
    scrollSpeed: 1,
  });
  printer.tick();
  w.text = text;
}

/** PrintTextOnHelpMessageWindow: redraw the bar and print `text` (encoded, with EOS) on it. */
export function PrintTextOnHelpMessageWindow(text: number[]): void {
  const w = sHelpWindow;
  if (!w) return;
  DrawHelpMessageWindowTiles(w);
  PrintHelpMessageText(w, text);
  w.win.flush(); // CopyWindowToVram
}

/** DrawHelpMessageWindowWithText (new_menu_helpers.c): create the window if needed and print `text`. */
export function DrawHelpMessageWindowWithText(scene: Phaser.Scene, fonts: Fonts, input: Input, text: number[]): void {
  CreateHelpMessageWindow(scene, fonts, input);
  PrintTextOnHelpMessageWindow(text);
}

/** DestroyHelpMessageWindow / DestroyHelpMessageWindow_: a no-op when there's no window. */
export function DestroyHelpMessageWindow(): void {
  if (!sHelpWindow) return;
  sHelpWindow.win.destroy();
  sHelpWindow = undefined;
}

/** Dev: the text on the help window while it's up (encoded). */
export function helpMessageWindowProbe(): number[] | undefined {
  return sHelpWindow?.text;
}
