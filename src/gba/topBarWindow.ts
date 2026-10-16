// menu.c's top bar window: the strip with a title on the left and button help ("{A_BUTTON}NEXT") on the right that
// the controls guide before Oak's speech (and the Hall of Fame) draw.

import { BG_PLTT_ID, LoadPalette, PLTT_SIZE_4BPP } from './palette';
import { GetTextWindowPalette } from './menu';
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
} from './window';
import { FONT_SMALL } from '../text/Font';

/** FONT_NORMAL_COPY_1 (the port's fonts fall back to FONT_NORMAL for the copies) */
const FONT_NORMAL_COPY_1 = 1;

let sTopBarWindowId = 0xff;

const sTopBarWindowTextColors = [15, 1, 2];

/** CreateTopBarWindowLoadPalette */
export function CreateTopBarWindowLoadPalette(bg: number, width: number, yPos: number, palette: number, baseTile: number): number {
  sTopBarWindowId = AddWindow({
    bg: bg > 3 ? 0 : bg,
    tilemapTop: yPos,
    height: 2,
    tilemapLeft: 0x1e - width,
    width,
    paletteNum: palette,
    baseBlock: baseTile,
  });
  LoadPalette(GetTextWindowPalette(2), palette > 15 ? BG_PLTT_ID(15) : BG_PLTT_ID(palette), PLTT_SIZE_4BPP);
  return sTopBarWindowId;
}

/** TopBarWindowPrintString: right-aligned, in the small font. */
export function TopBarWindowPrintString(string: number[], _unused: number, copyToVram: boolean): void {
  if (sTopBarWindowId === 0xff) return;
  PutWindowTilemap(sTopBarWindowId);
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(15));
  const width = GetStringWidth(FONT_SMALL, string, 0);
  AddTextPrinterParameterized3(sTopBarWindowId, FONT_SMALL, (-20 - width) & 0xff, 1, sTopBarWindowTextColors, 0, string); // (u8) x: right-aligned
  if (copyToVram) CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
}

/** TopBarWindowPrintTwoStrings: `string` on the left, `string2` right-aligned. */
export function TopBarWindowPrintTwoStrings(string: number[], string2: number[] | null, fgColorChooser: boolean, _unused: number, copyToVram: boolean): void {
  if (sTopBarWindowId === 0xff) return;
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

/** ClearTopBarWindow */
export function ClearTopBarWindow(): void {
  if (sTopBarWindowId === 0xff) return;
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(15));
  CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
}

/** DestroyTopBarWindow */
export function DestroyTopBarWindow(): void {
  if (sTopBarWindowId === 0xff) return;
  FillWindowPixelBuffer(sTopBarWindowId, PIXEL_FILL(0));
  ClearWindowTilemap(sTopBarWindowId);
  CopyWindowToVram(sTopBarWindowId, COPYWIN_FULL);
  RemoveWindow(sTopBarWindowId);
  sTopBarWindowId = 0xff;
}
