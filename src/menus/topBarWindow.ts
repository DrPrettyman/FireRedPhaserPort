// menu.c's top bar window: a two-tile-high window at the top right of a screen with button hints
// ("{A_BUTTON}EXIT") and an optional title on its left. The Hall of Fame PC uses it (Oak's speech does too).

import { LoadPalette, BG_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import { GetTextWindowPalette } from '../gba/menu';
import {
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  ClearWindowTilemap,
  CopyWindowToVram,
  COPYWIN_FULL,
  FillWindowPixelBuffer,
  GetStringWidth,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  WINDOW_NONE,
  type WindowTemplate,
} from '../gba/window';
import { FONT_SMALL } from '../text/Font';

const FONT_NORMAL_COPY_1 = 1;

/** sTopBarWindowId */
let sTopBarWindowId = WINDOW_NONE;
/** sTopBarWindowTextColors */
const sTopBarWindowTextColors = [15, 1, 2];

/** CreateTopBarWindowLoadPalette */
export function CreateTopBarWindowLoadPalette(bg: number, width: number, yPos: number, palette: number, baseTile: number): number {
  const window: WindowTemplate = {
    bg: bg > 3 ? 0 : bg,
    tilemapTop: yPos,
    height: 2,
    tilemapLeft: 0x1e - width,
    width,
    paletteNum: palette,
    baseBlock: baseTile,
  };
  sTopBarWindowId = AddWindow(window);
  LoadPalette(GetTextWindowPalette(2), palette > 15 ? BG_PLTT_ID(15) : BG_PLTT_ID(palette), PLTT_SIZE_4BPP);
  return sTopBarWindowId;
}

/** TopBarWindowPrintString: right-aligned 20 px from the window's right edge (x is a u8: -20 - width). */
export function TopBarWindowPrintString(string: number[], _unused: number, copyToVram: boolean): void {
  if (sTopBarWindowId === WINDOW_NONE) return;
  PutWindowTilemap(sTopBarWindowId);
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(15));
  const width = GetStringWidth(FONT_SMALL, string, 0);
  AddTextPrinterParameterized3(sTopBarWindowId, FONT_SMALL, (-20 - width) & 0xff, 1, sTopBarWindowTextColors, 0, string);
  if (copyToVram) CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
}

/** TopBarWindowPrintTwoStrings: `string` on the left, `string2` (the button hints) on the right. */
export function TopBarWindowPrintTwoStrings(string: number[], string2: number[] | null, fgColorChooser: boolean, _unused: number, copyToVram: boolean): void {
  if (sTopBarWindowId === WINDOW_NONE) return;
  const color = fgColorChooser ? [0, 1, 2] : [15, 1, 2];
  PutWindowTilemap(sTopBarWindowId);
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(15));
  if (string2) {
    const width = GetStringWidth(FONT_SMALL, string2, 0);
    AddTextPrinterParameterized3(sTopBarWindowId, FONT_SMALL, (-20 - width) & 0xff, 1, color, 0, string2);
  }
  AddTextPrinterParameterized4(sTopBarWindowId, FONT_NORMAL_COPY_1, 4, 1, 0, 0, color, 0, string);
  if (copyToVram) CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
}

/** DestroyTopBarWindow */
export function DestroyTopBarWindow(): void {
  if (sTopBarWindowId === WINDOW_NONE) return;
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(0));
  ClearWindowTilemap(sTopBarWindowId);
  CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
  RemoveWindow(sTopBarWindowId);
  sTopBarWindowId = WINDOW_NONE;
}
