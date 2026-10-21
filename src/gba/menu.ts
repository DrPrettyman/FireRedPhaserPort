// The window/menu helpers screens share: menu.c (std and dialog frames, the cursor menu sMenu,
// YES/NO), new_menu_helpers.c (scheduled tilemap copies, AddTextPrinterParameterized2, cursor
// dimensions), menu_helpers.c (DisplayMessageAndContinueTask, quantity input, L/R keys),
// text_window.c (window frame graphics) and help_message.c's window tiles.

import { K } from '../battle/constants';
import { QL_InPlaybackState } from '../world/questLogState';
import {
  BG_TILE_V_FLIP,
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  GetBgTilemapBuffer,
  LoadBgTilemap,
  LoadBgTiles,
} from './bg';
import { gfx, gfx16 } from './gfx';
import { pltt, REG_OFFSET_BG0CNT, REG_OFFSET_BG1CNT, REG_OFFSET_BG2CNT, REG_OFFSET_BG3CNT, REG_OFFSET_DISPCNT, SetGpuReg, vram } from './hw';
import { B_BUTTON, DPAD_ANY, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, A_BUTTON, JOY_NEW, JOY_REPT, L_BUTTON, R_BUTTON, SetHBlankCallback, SetVBlankCallback } from './main';
import { BG_PLTT_ID, LoadPalette } from './palette';
import { PlaySE } from './sound';
import { gTasks, type TaskFunc } from './task';
import {
  AddTextPrinter,
  AddTextPrinterParameterized,
  CallWindowFunction,
  ClearWindowTilemap,
  COPYWIN_FULL,
  COPYWIN_GFX,
  CopyToWindowPixelBuffer,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_COLOR_BACKGROUND,
  FONTATTR_COLOR_FOREGROUND,
  FONTATTR_COLOR_SHADOW,
  FONTATTR_LETTER_SPACING,
  FONTATTR_LINE_SPACING,
  FONTATTR_MAX_LETTER_HEIGHT,
  GetFontAttribute,
  GetWindowAttribute,
  gTextFlags,
  InitWindows,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  AddWindow,
  type WindowTemplate,
} from './window';

// include/menu.h
export const MENU_NOTHING_CHOSEN = -2;
export const MENU_B_PRESSED = -1;
// include/menu_helpers.h
export const MENU_L_PRESSED = 1;
export const MENU_R_PRESSED = 2;
// OPTIONS_BUTTON_MODE_* (include/constants/global.h)
const OPTIONS_BUTTON_MODE_LR = 1;
// include/text.h TEXT_COLOR_*
export const TEXT_COLOR_TRANSPARENT = 0;
export const TEXT_COLOR_WHITE = 1;
export const TEXT_COLOR_DARK_GRAY = 2;
export const TEXT_COLOR_LIGHT_GRAY = 3;

/**
 * What these helpers need from the save block and the string tables. The host screen fills it in
 * from GameState (options) and text/strings.json.
 */
export const menuEnv = {
  /** GetTextSpeedSetting: sTextSpeedFrameDelays[gSaveBlock2Ptr->optionsTextSpeed] */
  textSpeedDelay: 4,
  /** gSaveBlock2Ptr->optionsButtonMode */
  buttonMode: 0,
  /** gSaveBlock2Ptr->optionsWindowFrameType */
  windowFrameType: 0,
  /** gText_YesNo, gText_SelectorArrow2 (encoded) */
  textYesNo: [] as number[],
  textSelectorArrow2: [] as number[],
  /** StringExpandPlaceholders into gStringVar4 */
  expandPlaceholders: (str: number[]): number[] => str,
};

// ------------------------------------------------------------------ new_menu_helpers.c

const DLG_WINDOW_PALETTE_NUM = 15;
const DLG_WINDOW_BASE_TILE_NUM = 0x200;
const STD_WINDOW_PALETTE_NUM = 14;
const STD_WINDOW_BASE_TILE_NUM = 0x214;

const sScheduledBgCopiesToVram = [false, false, false, false];

/** sStandardTextBox_WindowTemplates: the field message box (window 0). */
const sStandardTextBox_WindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: DLG_WINDOW_PALETTE_NUM, baseBlock: 0x198 },
  DUMMY_WIN_TEMPLATE,
];

/** InitStandardTextBoxWindows (the start menu / map name popup window ids it resets live in the field). */
export function InitStandardTextBoxWindows(): void {
  InitWindows(sStandardTextBox_WindowTemplates);
}

/** InitTextBoxGfxAndPrinters */
export function InitTextBoxGfxAndPrinters(): void {
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  DeactivateAllTextPrinters();
  LoadStdWindowFrameGfx();
}

/** LoadStdWindowFrameGfx. In the quest log's playback (the GBA-layer screens that call it don't run there) the
 *  dialogue frame is gQuestLogWindow_Gfx in whatever palette 15 holds, and the text auto-scrolls. */
export function LoadStdWindowFrameGfx(): void {
  if (QL_InPlaybackState()) {
    gTextFlags.autoScroll = true;
    LoadQuestLogWindowTiles(0, DLG_WINDOW_BASE_TILE_NUM);
  } else {
    Menu_LoadStdPal();
    LoadMenuMessageWindowGfx(0, DLG_WINDOW_BASE_TILE_NUM, BG_PLTT_ID(DLG_WINDOW_PALETTE_NUM));
  }
  LoadUserWindowGfx(0, STD_WINDOW_BASE_TILE_NUM, BG_PLTT_ID(STD_WINDOW_PALETTE_NUM));
}

/** DrawDialogueFrame (not a signpost message, so WindowFunc_DrawDialogueFrame's normal frame) */
export function DrawDialogueFrame(windowId: number, copyToVram: boolean): void {
  DrawDialogFrameWithCustomTileAndPalette(windowId, copyToVram, DLG_WINDOW_BASE_TILE_NUM, DLG_WINDOW_PALETTE_NUM);
}

/** Menu_LoadStdPal */
export function Menu_LoadStdPal(): void {
  LoadPalette(gfx16('gStandardMenuPalette'), BG_PLTT_ID(STD_WINDOW_PALETTE_NUM), 2 * 10);
}

export function ClearScheduledBgCopiesToVram(): void {
  sScheduledBgCopiesToVram.fill(false);
}

export function ScheduleBgCopyTilemapToVram(bgId: number): void {
  sScheduledBgCopiesToVram[bgId] = true;
}

export function DoScheduledBgTilemapCopiesToVram(): void {
  for (let i = 0; i < 4; i++) {
    if (sScheduledBgCopiesToVram[i]) {
      CopyBgTilemapBufferToVram(i);
      sScheduledBgCopiesToVram[i] = false;
    }
  }
}

/** ResetTempTileDataBuffers: graphics are already decompressed, so there's nothing to track. */
export function ResetTempTileDataBuffers(): void {}

/** FreeTempTileDataBuffersIfPossible: TRUE while a BG copy is pending (DMA is instant here). */
export function FreeTempTileDataBuffersIfPossible(): boolean {
  return false;
}

/** DecompressAndCopyTileDataToVram: `src` is the decompressed data; mode 1 loads a tilemap. */
export function DecompressAndCopyTileDataToVram(bgId: number, src: Uint8Array, size: number, offset: number, mode: number): void {
  if (!size) size = src.length;
  if (mode === 1) LoadBgTilemap(bgId, src, size, offset);
  else LoadBgTiles(bgId, src, size, offset);
}

export function SetBgTilemapPalette(bgId: number, left: number, top: number, width: number, height: number, palette: number): void {
  const ptr = GetBgTilemapBuffer(bgId)!;
  for (let i = top; i < top + height; i++) {
    for (let j = left; j < left + width; j++) ptr[i * 32 + j] = (ptr[i * 32 + j] & 0xfff) | (palette << 12);
  }
}

export function CopyToBufferFromBgTilemap(bgId: number, dest: Uint16Array, left: number, top: number, width: number, height: number): void {
  const src = GetBgTilemapBuffer(bgId)!;
  for (let i = 0; i < height; i++) for (let j = 0; j < width; j++) dest[i * width + j] = src[(i + top) * 32 + j + left];
}

export function GetTextSpeedSetting(): number {
  return menuEnv.textSpeedDelay;
}

export function AddTextPrinterParameterized2(windowId: number, fontId: number, str: number[], speed: number, fgColor: number, bgColor: number, shadowColor: number): boolean {
  gTextFlags.useAlternateDownArrow = false;
  return AddTextPrinter({ currentChar: str, windowId, fontId, x: 0, y: 1, letterSpacing: 1, lineSpacing: 1, fgColor, bgColor, shadowColor }, speed);
}

export function ClearDialogWindowAndFrame(windowId: number, copyToVram: boolean): void {
  CallWindowFunction(windowId, (bg, left, top, width, height) => FillBgTilemapBufferRect(bg, 0, left - 2, top - 1, width + 4, height + 2, STD_WINDOW_PALETTE_NUM));
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  ClearWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

export function ClearStdWindowAndFrame(windowId: number, copyToVram: boolean): void {
  CallWindowFunction(windowId, (bg, left, top, width, height) => FillBgTilemapBufferRect(bg, 0, left - 1, top - 1, width + 2, height + 2, STD_WINDOW_PALETTE_NUM));
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  ClearWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

/** gMenuCursorDimensions[fontId] (FONT_SMALL..FONT_BRAILLE) */
const gMenuCursorDimensions: [number, number][] = [
  [8, 13],
  [8, 14],
  [8, 14],
  [8, 14],
  [8, 14],
  [8, 14],
  [8, 16],
  [0, 0],
];

export function GetMenuCursorDimensionByFont(fontId: number, whichDimension: number): number {
  return gMenuCursorDimensions[fontId][whichDimension];
}

// ------------------------------------------------------------------ menu.c

const sMenu = {
  left: 0,
  top: 0,
  cursorPos: 0,
  minCursorPos: 0,
  maxCursorPos: 0,
  windowId: 0,
  fontId: 0,
  optionWidth: 0,
  optionHeight: 0,
  columns: 0,
  rows: 0,
  APressMuted: false,
};
let sTileNum = 0;
let sPaletteNum = 0;
let sYesNoWindowId = 0;

export function DrawDialogFrameWithCustomTileAndPalette(windowId: number, copyToVram: boolean, tileNum: number, paletteNum: number): void {
  sTileNum = tileNum;
  sPaletteNum = paletteNum;
  CallWindowFunction(windowId, WindowFunc_DrawDialogFrameWithCustomTileAndPalette);
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  PutWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

function WindowFunc_DrawDialogFrameWithCustomTileAndPalette(bg: number, left: number, top: number, width: number): void {
  const t = sTileNum;
  const p = sPaletteNum;
  const V = BG_TILE_V_FLIP;
  FillBgTilemapBufferRect(bg, t, left - 2, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 1, left - 1, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 2, left, top - 1, width, 1, p);
  FillBgTilemapBufferRect(bg, t + 3, left + width, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 4, left + width + 1, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 5, left - 2, top, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 6, left - 1, top, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 8, left + width, top, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 9, left + width + 1, top, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 10, left - 2, top + 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 11, left - 1, top + 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 12, left + width, top + 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 13, left + width + 1, top + 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 10), left - 2, top + 2, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 11), left - 1, top + 2, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 12), left + width, top + 2, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 13), left + width + 1, top + 2, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 5), left - 2, top + 3, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 6), left - 1, top + 3, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 8), left + width, top + 3, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 9), left + width + 1, top + 3, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t), left - 2, top + 4, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 1), left - 1, top + 4, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 2), left, top + 4, width, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 3), left + width, top + 4, 1, 1, p);
  FillBgTilemapBufferRect(bg, V(t + 4), left + width + 1, top + 4, 1, 1, p);
}

export function ClearDialogWindowAndFrameToTransparent(windowId: number, copyToVram: boolean): void {
  // The palette slot doesn't matter, since the tiles are transparent.
  CallWindowFunction(windowId, (bg, left, top, width, height) => FillBgTilemapBufferRect(bg, 0, left - 2, top - 1, width + 4, height + 2, 0));
  FillWindowPixelBuffer(windowId, PIXEL_FILL(0));
  ClearWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

export function DrawStdFrameWithCustomTileAndPalette(windowId: number, copyToVram: boolean, baseTileNum: number, paletteNum: number): void {
  sTileNum = baseTileNum;
  sPaletteNum = paletteNum;
  CallWindowFunction(windowId, WindowFunc_DrawStdFrameWithCustomTileAndPalette);
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  PutWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

function WindowFunc_DrawStdFrameWithCustomTileAndPalette(bg: number, left: number, top: number, width: number, height: number): void {
  const t = sTileNum;
  const p = sPaletteNum;
  FillBgTilemapBufferRect(bg, t, left - 1, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 1, left, top - 1, width, 1, p);
  FillBgTilemapBufferRect(bg, t + 2, left + width, top - 1, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 3, left - 1, top, 1, height, p);
  FillBgTilemapBufferRect(bg, t + 5, left + width, top, 1, height, p);
  FillBgTilemapBufferRect(bg, t + 6, left - 1, top + height, 1, 1, p);
  FillBgTilemapBufferRect(bg, t + 7, left, top + height, width, 1, p);
  FillBgTilemapBufferRect(bg, t + 8, left + width, top + height, 1, 1, p);
}

export function ClearStdWindowAndFrameToTransparent(windowId: number, copyToVram: boolean): void {
  CallWindowFunction(windowId, (bg, left, top, width, height) => FillBgTilemapBufferRect(bg, 0, left - 1, top - 1, width + 2, height + 2, 0));
  FillWindowPixelBuffer(windowId, PIXEL_FILL(0));
  ClearWindowTilemap(windowId);
  if (copyToVram) CopyWindowToVram(windowId, COPYWIN_FULL);
}

export function Menu_InitCursorInternal(windowId: number, fontId: number, left: number, top: number, cursorHeight: number, numChoices: number, initialCursorPos: number, APressMuted: boolean): number {
  sMenu.left = left;
  sMenu.top = top;
  sMenu.minCursorPos = 0;
  sMenu.maxCursorPos = numChoices - 1;
  sMenu.windowId = windowId;
  sMenu.fontId = fontId;
  sMenu.optionHeight = cursorHeight;
  sMenu.APressMuted = APressMuted;
  const pos = initialCursorPos;
  sMenu.cursorPos = pos < 0 || pos > sMenu.maxCursorPos ? 0 : pos;
  Menu_MoveCursor(0);
  return sMenu.cursorPos;
}

export function Menu_InitCursor(windowId: number, fontId: number, left: number, top: number, cursorHeight: number, numChoices: number, initialCursorPos: number): number {
  return Menu_InitCursorInternal(windowId, fontId, left, top, cursorHeight, numChoices, initialCursorPos, false);
}

function Menu_RedrawCursor(oldPos: number, newPos: number): void {
  const width = GetMenuCursorDimensionByFont(sMenu.fontId, 0);
  const height = GetMenuCursorDimensionByFont(sMenu.fontId, 1);
  FillWindowPixelRect(sMenu.windowId, 1, sMenu.left, sMenu.optionHeight * oldPos + sMenu.top, width, height);
  AddTextPrinterParameterized(sMenu.windowId, sMenu.fontId, menuEnv.textSelectorArrow2, sMenu.left, sMenu.optionHeight * newPos + sMenu.top, 0);
}

export function Menu_MoveCursor(cursorDelta: number): number {
  const oldPos = sMenu.cursorPos;
  const newPos = sMenu.cursorPos + cursorDelta;
  if (newPos < sMenu.minCursorPos) sMenu.cursorPos = sMenu.maxCursorPos;
  else if (newPos > sMenu.maxCursorPos) sMenu.cursorPos = sMenu.minCursorPos;
  else sMenu.cursorPos += cursorDelta;
  Menu_RedrawCursor(oldPos, sMenu.cursorPos);
  return sMenu.cursorPos;
}

export function Menu_MoveCursorNoWrapAround(cursorDelta: number): number {
  const oldPos = sMenu.cursorPos;
  const newPos = sMenu.cursorPos + cursorDelta;
  if (newPos < sMenu.minCursorPos) sMenu.cursorPos = sMenu.minCursorPos;
  else if (newPos > sMenu.maxCursorPos) sMenu.cursorPos = sMenu.maxCursorPos;
  else sMenu.cursorPos += cursorDelta;
  Menu_RedrawCursor(oldPos, sMenu.cursorPos);
  return sMenu.cursorPos;
}

export function Menu_GetCursorPos(): number {
  return sMenu.cursorPos;
}

export function Menu_ProcessInput(): number {
  if (JOY_NEW(A_BUTTON)) {
    if (!sMenu.APressMuted) PlaySE(K.SE_SELECT);
    return sMenu.cursorPos;
  }
  if (JOY_NEW(B_BUTTON)) return MENU_B_PRESSED;
  if (JOY_NEW(DPAD_UP)) {
    PlaySE(K.SE_SELECT);
    Menu_MoveCursor(-1);
    return MENU_NOTHING_CHOSEN;
  }
  if (JOY_NEW(DPAD_DOWN)) {
    PlaySE(K.SE_SELECT);
    Menu_MoveCursor(1);
    return MENU_NOTHING_CHOSEN;
  }
  return MENU_NOTHING_CHOSEN;
}

export function Menu_ProcessInputNoWrapAround(): number {
  const oldPos = sMenu.cursorPos;
  if (JOY_NEW(A_BUTTON)) {
    if (!sMenu.APressMuted) PlaySE(K.SE_SELECT);
    return sMenu.cursorPos;
  }
  if (JOY_NEW(B_BUTTON)) return MENU_B_PRESSED;
  if (JOY_NEW(DPAD_UP)) {
    if (oldPos !== Menu_MoveCursorNoWrapAround(-1)) PlaySE(K.SE_SELECT);
    return MENU_NOTHING_CHOSEN;
  }
  if (JOY_NEW(DPAD_DOWN)) {
    if (oldPos !== Menu_MoveCursorNoWrapAround(1)) PlaySE(K.SE_SELECT);
    return MENU_NOTHING_CHOSEN;
  }
  return MENU_NOTHING_CHOSEN;
}

export function Menu_ProcessInput_other(): number {
  if (JOY_NEW(A_BUTTON)) {
    if (!sMenu.APressMuted) PlaySE(K.SE_SELECT);
    return sMenu.cursorPos;
  }
  if (JOY_NEW(B_BUTTON)) return MENU_B_PRESSED;
  if (JOY_REPT(DPAD_ANY) === DPAD_UP) {
    PlaySE(K.SE_SELECT);
    Menu_MoveCursor(-1);
    return MENU_NOTHING_CHOSEN;
  }
  if (JOY_REPT(DPAD_ANY) === DPAD_DOWN) {
    PlaySE(K.SE_SELECT);
    Menu_MoveCursor(1);
    return MENU_NOTHING_CHOSEN;
  }
  return MENU_NOTHING_CHOSEN;
}

export function Menu_ProcessInputNoWrapAround_other(): number {
  const oldPos = sMenu.cursorPos;
  if (JOY_NEW(A_BUTTON)) {
    if (!sMenu.APressMuted) PlaySE(K.SE_SELECT);
    return sMenu.cursorPos;
  }
  if (JOY_NEW(B_BUTTON)) return MENU_B_PRESSED;
  if (JOY_REPT(DPAD_ANY) === DPAD_UP) {
    if (oldPos !== Menu_MoveCursorNoWrapAround(-1)) PlaySE(K.SE_SELECT);
    return MENU_NOTHING_CHOSEN;
  }
  if (JOY_REPT(DPAD_ANY) === DPAD_DOWN) {
    if (oldPos !== Menu_MoveCursorNoWrapAround(1)) PlaySE(K.SE_SELECT);
    return MENU_NOTHING_CHOSEN;
  }
  return MENU_NOTHING_CHOSEN;
}

/** struct MenuAction: text + a task callback */
export interface MenuAction {
  text: number[];
  func: TaskFunc | null;
}

export function AddItemMenuActionTextPrinters(
  windowId: number,
  fontId: number,
  left: number,
  top: number,
  letterSpacing: number,
  lineHeight: number,
  itemCount: number,
  strs: MenuAction[],
  orderArray: number[],
): void {
  for (let i = 0; i < itemCount; i++) {
    AddTextPrinter(
      {
        currentChar: strs[orderArray[i]].text,
        windowId,
        fontId,
        x: left,
        y: lineHeight * i + top,
        letterSpacing,
        lineSpacing: GetFontAttribute(fontId, FONTATTR_LINE_SPACING),
        fgColor: GetFontAttribute(fontId, FONTATTR_COLOR_FOREGROUND),
        bgColor: GetFontAttribute(fontId, FONTATTR_COLOR_BACKGROUND),
        shadowColor: GetFontAttribute(fontId, FONTATTR_COLOR_SHADOW),
      },
      0xff,
    );
  }
  CopyWindowToVram(windowId, COPYWIN_GFX);
}

export function SetWindowTemplateFields(bg: number, left: number, top: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate {
  return { bg, tilemapLeft: left, tilemapTop: top, width, height, paletteNum, baseBlock };
}

export function CreateYesNoMenu(window: WindowTemplate, fontId: number, left: number, top: number, baseTileNum: number, paletteNum: number, initialCursorPos: number): void {
  sYesNoWindowId = AddWindow(window);
  DrawStdFrameWithCustomTileAndPalette(sYesNoWindowId, true, baseTileNum, paletteNum);
  const lineSpacing = GetFontAttribute(fontId, FONTATTR_LINE_SPACING);
  AddTextPrinter(
    {
      currentChar: menuEnv.textYesNo,
      windowId: sYesNoWindowId,
      fontId,
      x: GetMenuCursorDimensionByFont(fontId, 0) + left,
      y: top,
      letterSpacing: GetFontAttribute(fontId, FONTATTR_LETTER_SPACING),
      lineSpacing,
      fgColor: GetFontAttribute(fontId, FONTATTR_COLOR_FOREGROUND),
      bgColor: GetFontAttribute(fontId, FONTATTR_COLOR_BACKGROUND),
      shadowColor: GetFontAttribute(fontId, FONTATTR_COLOR_SHADOW),
    },
    0xff,
  );
  Menu_InitCursor(sYesNoWindowId, fontId, left, top, GetFontAttribute(fontId, FONTATTR_MAX_LETTER_HEIGHT) + lineSpacing, 2, initialCursorPos);
}

export function Menu_ProcessInputNoWrapClearOnChoose(): number {
  const result = Menu_ProcessInputNoWrapAround();
  if (result !== MENU_NOTHING_CHOSEN) DestroyYesNoMenu();
  return result;
}

export function DestroyYesNoMenu(): void {
  ClearStdWindowAndFrameToTransparent(sYesNoWindowId, true);
  RemoveWindow(sYesNoWindowId);
}

// ------------------------------------------------------------------ menu_helpers.c

let sYesNo: { yesFunc: TaskFunc; noFunc: TaskFunc } | null = null;
let sMessageNextTask: TaskFunc | null = null;
let sMessageWindowId = 0;

export function DisplayMessageAndContinueTask(taskId: number, windowId: number, tileNum: number, paletteNum: number, fontId: number, textSpeed: number, string: number[], taskFunc: TaskFunc | null): void {
  sMessageWindowId = windowId;
  DrawDialogFrameWithCustomTileAndPalette(windowId, true, tileNum, paletteNum);
  const str = menuEnv.expandPlaceholders(string);
  gTextFlags.canABSpeedUpPrint = true;
  AddTextPrinterParameterized2(windowId, fontId, str, textSpeed, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  sMessageNextTask = taskFunc;
  gTasks[taskId].func = Task_ContinueTaskAfterMessagePrints;
}

export function RunTextPrinters_CheckActive(textPrinterId: number): boolean {
  RunTextPrinters();
  return IsTextPrinterActive(textPrinterId);
}

function Task_ContinueTaskAfterMessagePrints(taskId: number): void {
  if (!RunTextPrinters_CheckActive(sMessageWindowId)) sMessageNextTask!(taskId);
}

function Task_CallYesOrNoCallback(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0:
      PlaySE(K.SE_SELECT);
      gTasks[taskId].func = sYesNo!.yesFunc;
      break;
    case 1:
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
      gTasks[taskId].func = sYesNo!.noFunc;
      break;
  }
}

export function CreateYesNoMenuWithCallbacks(
  taskId: number,
  template: WindowTemplate,
  fontId: number,
  left: number,
  top: number,
  tileStart: number,
  palette: number,
  yesNo: { yesFunc: TaskFunc; noFunc: TaskFunc },
): void {
  CreateYesNoMenu(template, fontId, left, top, tileStart, palette, 0);
  sYesNo = yesNo;
  gTasks[taskId].func = Task_CallYesOrNoCallback;
}

export function GetLRKeysPressed(): number {
  if (menuEnv.buttonMode === OPTIONS_BUTTON_MODE_LR) {
    if (JOY_NEW(L_BUTTON)) return MENU_L_PRESSED;
    if (JOY_NEW(R_BUTTON)) return MENU_R_PRESSED;
  }
  return 0;
}

export function GetLRKeysPressedAndHeld(): number {
  if (menuEnv.buttonMode === OPTIONS_BUTTON_MODE_LR) {
    if (JOY_REPT(L_BUTTON)) return MENU_L_PRESSED;
    if (JOY_REPT(R_BUTTON)) return MENU_R_PRESSED;
  }
  return 0;
}

/** MenuHelpers_IsLinkActive: there's no link play. */
export function MenuHelpers_IsLinkActive(): boolean {
  return false;
}

export function IsActiveOverworldLinkBusy(): boolean {
  return false;
}

export function MenuHelpers_ShouldWaitForLinkRecv(): boolean {
  return false;
}

export function SetVBlankHBlankCallbacksToNull(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
}

export function ResetVramOamAndBgCntRegs(): void {
  ResetAllBgsCoordinatesAndBgCntRegs();
  vram.fill(0);
  // OAM: the PPU reads the OAM buffer, which ResetSpriteData clears
  pltt.fill(0);
}

export function ResetAllBgsCoordinatesAndBgCntRegs(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  SetGpuReg(REG_OFFSET_BG3CNT, 0);
  SetGpuReg(REG_OFFSET_BG2CNT, 0);
  SetGpuReg(REG_OFFSET_BG1CNT, 0);
  SetGpuReg(REG_OFFSET_BG0CNT, 0);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
}

/** GetStdWindowBaseTileNum */
export function GetStdWindowBaseTileNum(): number {
  return STD_WINDOW_BASE_TILE_NUM;
}

/** ResetBgPositions (new_menu_helpers.c) */
export function ResetBgPositions(): void {
  for (let bg = 0; bg < 4; bg++) ChangeBgX(bg, 0, 0);
  for (let bg = 0; bg < 4; bg++) ChangeBgY(bg, 0, 0);
}

/** AdjustQuantityAccordingToDPadInput: `quantity[index]` is the s16 being edited. */
export function AdjustQuantityAccordingToDPadInput(quantity: Int16Array, index: number, qmax: number): boolean {
  const valBefore = quantity[index];
  const changed = () => {
    if (quantity[index] === valBefore) return false;
    PlaySE(K.SE_SELECT);
    return true;
  };
  if (JOY_REPT(DPAD_ANY) === DPAD_UP) {
    quantity[index]++;
    if (quantity[index] > qmax) quantity[index] = 1;
    return changed();
  }
  if (JOY_REPT(DPAD_ANY) === DPAD_DOWN) {
    quantity[index]--;
    if (quantity[index] <= 0) quantity[index] = qmax;
    return changed();
  }
  if (JOY_REPT(DPAD_ANY) === DPAD_RIGHT) {
    quantity[index] += 10;
    if (quantity[index] > qmax) quantity[index] = qmax;
    return changed();
  }
  if (JOY_REPT(DPAD_ANY) === DPAD_LEFT) {
    quantity[index] -= 10;
    if (quantity[index] <= 0) quantity[index] = 1;
    return changed();
  }
  return false;
}

// ------------------------------------------------------------------ text_window.c

/** gUserFrames[frameType] tiles/palette symbols */
const userFrame = (frameType: number) => `sUserFrame_Type${frameType + 1}`;

export function LoadUserWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  const f = userFrame(menuEnv.windowFrameType);
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx(`${f}_Gfx`), 0x120, destOffset);
  LoadPalette(gfx16(`${f}_Pal`), palOffset, 32);
}

/** LoadQuestLogWindowTiles (text_window.c): gQuestLogWindow_Gfx's tiles, no palette. */
export function LoadQuestLogWindowTiles(windowId: number, destOffset: number): void {
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx('gQuestLogWindow_Gfx'), 0x280, destOffset);
}

export function LoadMenuMessageWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx('gMenuMessageWindow_Gfx'), 0x280, destOffset);
  LoadPalette(GetTextWindowPalette(0), palOffset, 32);
}

export function LoadStdWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx('gStdTextWindow_Gfx'), 0x120, destOffset);
  LoadPalette(GetTextWindowPalette(3), palOffset, 32);
}

export function LoadHelpMessageWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx('gHelpMessageWindow_Gfx'), 0x280, destOffset);
  LoadPalette(GetTextWindowPalette(2), palOffset, 32);
}

export function DrawTextBorderOuter(windowId: number, tileNum: number, palNum: number): void {
  const bg = GetWindowAttribute(windowId, 'bg');
  const left = GetWindowAttribute(windowId, 'tilemapLeft');
  const top = GetWindowAttribute(windowId, 'tilemapTop');
  const width = GetWindowAttribute(windowId, 'width');
  const height = GetWindowAttribute(windowId, 'height');
  FillBgTilemapBufferRect(bg, tileNum + 0, left - 1, top - 1, 1, 1, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 1, left, top - 1, width, 1, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 2, left + width, top - 1, 1, 1, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 3, left - 1, top, 1, height, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 5, left + width, top, 1, height, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 6, left - 1, top + height, 1, 1, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 7, left, top + height, width, 1, palNum);
  FillBgTilemapBufferRect(bg, tileNum + 8, left + width, top + height, 1, 1, palNum);
}

/** GetTextWindowPalette: gTextWindowPalettes[id] (ids above 3 use the last palette). */
export function GetTextWindowPalette(id: number): Uint16Array {
  const all = gfx16('gTextWindowPalettes');
  const offset = id <= 3 ? id * 0x10 : 0x40;
  return all.subarray(offset, offset + 0x10);
}

// ------------------------------------------------------------------ help_message.c

/** DrawHelpMessageWindowTilesById: top row tile 0, middle rows tile 5, bottom row tile 14. */
export function DrawHelpMessageWindowTilesById(windowId: number): void {
  const ptr = gfx('gHelpMessageWindow_Gfx');
  const width = GetWindowAttribute(windowId, 'width');
  const height = GetWindowAttribute(windowId, 'height');
  const buffer = new Uint8Array(32 * width * height);
  for (let i = 0; i < height; i++) {
    const tileId = i === 0 ? 0 : i === height - 1 ? 14 : 5;
    for (let j = 0; j < width; j++) buffer.set(ptr.subarray(tileId * 32, tileId * 32 + 32), (i * width + j) * 32);
  }
  CopyToWindowPixelBuffer(windowId, buffer, width * height * 32, 0);
}
