// help_system_util.c: the L/R help system's engine. RunHelpSystemCallback runs before the main callbacks every
// frame (main.c's CallCallbacks: GbaHostScene on the GBA layer, OverworldScene.tick through ui/helpSystemField.ts
// in the field); while it isn't in state 0 the callbacks don't run, so whatever screen is up is paused. It saves
// BG char block 3, BG0's registers and the VBlank / HBlank callbacks, draws the help on BG0 alone (char block 3,
// screen block 31: the tilemap and the text tiles share one 0x4000 buffer, gDecompressionBuffer, committed to VRAM
// whole), and puts everything back when it closes.
//
// The menus themselves (the welcome page, the topics, the submenus, the help items, the contexts) are
// help_system.c: ui/helpSystemMenu.ts.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { gfx, gfx16, isGfxLoaded } from '../gba/gfx';
import {
  BG_CHAR_ADDR,
  DISPCNT_BG0_ON,
  DmaStop0,
  GetGpuReg,
  hblankRegs,
  pltt,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, L_BUTTON, R_BUTTON, type KeyState, type MainCallback } from '../gba/main';
import { HelpSystem_BGMVolumeControl, HelpSystem_StopSE1AndSE2, IsHelpSystemVolumeReduceDisabled, PlaySE } from '../gba/sound';
import { BlitBitmapRect4Bit, FillBitmapRect4Bit, type Bitmap } from '../gba/window';
import { CHAR_NEWLINE, CHAR_PROMPT_CLEAR, CHAR_PROMPT_SCROLL, EOS, EXT_CTRL_CODE_BEGIN, PLACEHOLDER_BEGIN } from '../text/charmap';
import { FONT_FEMALE, FONT_NORMAL, FONT_SMALL, type Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import {
  gHelpSystemEnabled,
  gHelpSystemToggleWithRButtonDisabled,
  helpString,
  HelpSystem_IsSinglePlayer,
  HelpSystem_UpdateHasntSeenIntro,
  type HelpListMenuItem,
  type HelpSystemListMenu,
} from './helpSystemContext';
import {
  GetHelpSystemMenuLevel,
  HelpSystem_PrintTopicLabel,
  HelpSystemSubroutine_PrintWelcomeMessage,
  HelpSystemSubroutine_WelcomeEndGotoMenu,
  RunHelpMenuSubroutine,
} from './helpSystemMenu';

/** The graphics the help system draws with (preloaded by the field: OverworldScene). */
export const helpSystemGfxSymbols = ['help_system_util.sTiles', 'sPals', 'gKeypadIconTiles'];

let sFonts: Fonts | undefined;

/** The fonts HelpSystemRenderText draws with; until they're set the help system doesn't open (OverworldScene). */
export function InitHelpSystemFonts(fonts: Fonts): void {
  sFonts = fonts;
}

// ------------------------------------------------------------------ state (help_system_util.c's globals)

/** struct HelpSystemVideoState */
const sVideoState = {
  savedVblankCb: null as MainCallback | null,
  savedHblankCb: null as MainCallback | null,
  savedDispCnt: 0,
  savedBg0Cnt: 0,
  savedBg0Hofs: 0,
  savedBg0Vofs: 0,
  savedBldCnt: 0,
  state: 0,
};

const BG_CHAR_SIZE = 0x4000;
/** sMapTilesBackup */
const sMapTilesBackup = new Uint8Array(BG_CHAR_SIZE);
/** gDecompressionBuffer's first 0x4000 bytes, the help system's copy of char block 3 (tiles and tilemap). */
const gDecompressionBuffer = new Uint8Array(BG_CHAR_SIZE);
const gDecompressionBuffer16 = new Uint16Array(gDecompressionBuffer.buffer);
let sDelayTimer = 0;
/** sInHelpSystem */
let sInHelpSystem = 0;

export const gHelpSystemListMenu: HelpSystemListMenu = {
  sub: { items: [], totalItems: 0, maxShowed: 0, left: 0, top: 0 },
  itemsAbove: 0,
  cursorPos: 0,
  state: 0,
};
/** gHelpSystemListMenuItems[52] */
export const gHelpSystemListMenuItems: HelpListMenuItem[] = Array.from({ length: 52 }, () => ({ label: [EOS], index: 0 }));

/** The keys this frame's RunHelpSystemCallback reads (gMain, or the field's own: ui/helpSystemField.ts). */
let sKeys: KeyState = gMain;
const JOY_NEW = (button: number): number => sKeys.newKeys & button;
const JOY_REPT = (button: number): number => sKeys.newAndRepeatedKeys & button;
/** JOY_NEW on this frame's keys, for help_system.c's subroutines (ui/helpSystemMenu.ts). */
export const HelpSystem_JOY_NEW = JOY_NEW;

/** Whether the help system is up (sInHelpSystem), for the tests. */
export function IsHelpSystemOpen(): boolean {
  return sInHelpSystem !== 0;
}

/** RunHelpSystemCallback's state (sVideoState.state): 0 closed, 5 taking input. */
export function HelpSystemVideoState(): number {
  return sVideoState.state;
}

// ------------------------------------------------------------------ RunHelpSystemCallback

/**
 * RunHelpSystemCallback: once a frame before the main callbacks, which only run while it returns 0. `keys` is
 * gMain on the GBA layer. Returns sVideoState.state.
 */
export function RunHelpSystemCallback(keys: KeyState = gMain): number {
  sKeys = keys;
  switch (sVideoState.state) {
    case 0:
      sInHelpSystem = 0;
      // (the port: nothing until the field has handed over the fonts and loaded the graphics)
      if (!sFonts || !state || !helpSystemGfxSymbols.every(isGfxLoaded)) return 0;
      if (state.optionsButtonMode !== K.OPTIONS_BUTTON_MODE_HELP) return 0;
      if (JOY_NEW(R_BUTTON) && gHelpSystemToggleWithRButtonDisabled === true) return 0;
      if (JOY_NEW(L_BUTTON | R_BUTTON)) {
        if (!HelpSystem_IsSinglePlayer() || !gHelpSystemEnabled) {
          PlaySE(K.SE_HELP_ERROR);
          return 0;
        }
        HelpSystem_StopSE1AndSE2();
        PlaySE(K.SE_HELP_OPEN);
        if (!IsHelpSystemVolumeReduceDisabled()) HelpSystem_BGMVolumeControl(0x80);
        SaveCallbacks();
        sInHelpSystem = 1;
        sVideoState.state = 1;
      }
      break;
    case 1:
      SaveMapTiles();
      SaveMapGPURegs();
      SaveMapTextColors();
      pltt[0] = sPals()[15];
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      sVideoState.state = 2;
      break;
    case 2: {
      vram.fill(0, BG_CHAR_ADDR(3), BG_CHAR_ADDR(3) + BG_CHAR_SIZE);
      pltt.set(sPals(), 0);
      gDecompressionBuffer.set(gfx('help_system_util.sTiles'), 0x3ee0);
      sVideoState.state = 3;
      break;
    }
    case 3:
      HS_BufferFillMapWithTile1FF();
      HelpSystem_FillPanel3();
      HelpSystem_FillPanel2();
      HelpSystem_PrintTextInTopLeftCorner(helpString('gString_Help'));
      HS_ShowOrHideWordHELPinTopLeft(1);
      if (HelpSystem_UpdateHasntSeenIntro() === true) HelpSystemSubroutine_PrintWelcomeMessage(gHelpSystemListMenu, gHelpSystemListMenuItems);
      else HelpSystemSubroutine_WelcomeEndGotoMenu(gHelpSystemListMenu, gHelpSystemListMenuItems);
      HS_ShowOrHideHeaderAndFooterLines_Lighter(1);
      HS_ShowOrHideVerticalBlackBarsAlongSides(1);
      CommitTilemap();
      sVideoState.state = 4;
      break;
    case 4:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BG0HOFS, 0);
      SetGpuReg(REG_OFFSET_BG0VOFS, 0);
      // BGCNT_PRIORITY(0) | BGCNT_CHARBASE(3) | BGCNT_16COLOR | BGCNT_SCREENBASE(31)
      SetGpuReg(REG_OFFSET_BG0CNT, (3 << 2) | (31 << 8));
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_BG0_ON);
      sVideoState.state = 5;
      break;
    case 5:
      if (!RunHelpMenuSubroutine(gHelpSystemListMenu, gHelpSystemListMenuItems)) {
        PlaySE(K.SE_HELP_CLOSE);
        sVideoState.state = 6;
      }
      break;
    case 6:
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      RestoreMapTiles();
      pltt.fill(sPals()[15], 0, 0x200);
      sVideoState.state = 7;
      break;
    case 7:
      if (!IsHelpSystemVolumeReduceDisabled()) HelpSystem_BGMVolumeControl(0x100);
      RestoreMapTextColors();
      RestoreGPURegs();
      sVideoState.state = 8;
      break;
    case 8:
      RestoreCallbacks();
      sInHelpSystem = 0;
      sVideoState.state = 0;
      break;
  }
  return sVideoState.state;
}

/** sPals (graphics/help_system/bg_tiles.gbapal) */
function sPals(): Uint16Array {
  return gfx16('sPals');
}

/** SaveCallbacks: the VBlank and HBlank callbacks off, and DMA0 (the HBlank DMA: scanline effects) stopped. */
function SaveCallbacks(): void {
  sVideoState.savedVblankCb = gMain.vblankCallback;
  sVideoState.savedHblankCb = gMain.hblankCallback;
  gMain.vblankCallback = null;
  gMain.hblankCallback = null;
  DmaStop0();
  hblankRegs.clear(); // every HBlank DMA runs on DMA0; a scanline effect's VBlank callback starts it again
}

function SaveMapGPURegs(): void {
  sVideoState.savedDispCnt = GetGpuReg(REG_OFFSET_DISPCNT);
  sVideoState.savedBg0Cnt = GetGpuReg(REG_OFFSET_BG0CNT);
  sVideoState.savedBg0Hofs = GetGpuReg(REG_OFFSET_BG0HOFS);
  sVideoState.savedBg0Vofs = GetGpuReg(REG_OFFSET_BG0VOFS);
  sVideoState.savedBldCnt = GetGpuReg(REG_OFFSET_BLDCNT);
}

function SaveMapTiles(): void {
  sMapTilesBackup.set(vram.subarray(BG_CHAR_ADDR(3), BG_CHAR_ADDR(3) + BG_CHAR_SIZE));
}

/**
 * SaveMapTextColors / RestoreMapTextColors: SaveTextColors keeps GenerateFontHalfRowLookupTable's colours. The
 * port's text printers carry their own colours (there's no global lookup table), so there's nothing to keep.
 */
function SaveMapTextColors(): void {}

function RestoreMapTextColors(): void {}

function RestoreCallbacks(): void {
  gMain.vblankCallback = sVideoState.savedVblankCb;
  gMain.hblankCallback = sVideoState.savedHblankCb;
}

function RestoreGPURegs(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, sVideoState.savedBldCnt);
  SetGpuReg(REG_OFFSET_BG0HOFS, sVideoState.savedBg0Hofs);
  SetGpuReg(REG_OFFSET_BG0VOFS, sVideoState.savedBg0Vofs);
  SetGpuReg(REG_OFFSET_BG0CNT, sVideoState.savedBg0Cnt);
  SetGpuReg(REG_OFFSET_DISPCNT, sVideoState.savedDispCnt);
}

function RestoreMapTiles(): void {
  vram.set(sMapTilesBackup, BG_CHAR_ADDR(3));
}

/** CommitTilemap: the whole buffer (text tiles and tilemap) to char block 3. */
function CommitTilemap(): void {
  vram.set(gDecompressionBuffer, BG_CHAR_ADDR(3));
}

// ------------------------------------------------------------------ BG0's tilemap (HS_*)

/** HS_DrawBgTilemapRect: the tilemap is screen block 31, the buffer's 0x3800. */
function HS_DrawBgTilemapRect(baseTile: number, left: number, top: number, width: number, height: number, increment: number): void {
  for (let i = top; i < top + height; i++) {
    for (let j = left; j < left + width; j++) {
      gDecompressionBuffer16[(0x3800 + 64 * i + 2 * j) >> 1] = baseTile & 0xffff;
      baseTile += increment;
    }
  }
  CommitTilemap();
}

function HS_BufferFillMapWithTile1FF(): void {
  HS_DrawBgTilemapRect(0x1ff, 0, 0, 30, 20, 0);
}

export function HS_ShowOrHideWordHELPinTopLeft(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 1, 0, 7, 2, 0);
  else if (mode === 1) HS_DrawBgTilemapRect(0x1e8, 1, 0, 7, 2, 1);
}

export function HS_ShowOrHideControlsGuideInTopRight(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 13, 0, 16, 2, 0);
  else if (mode === 1) HS_DrawBgTilemapRect(0x1a0, 13, 0, 16, 2, 1);
}

export function HS_ShowOrHideMainWindowText(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 2, 3, 26, 16, 0);
  else if (mode === 1) HS_DrawBgTilemapRect(0x000, 2, 3, 26, 16, 1);
}

export function HS_SetMainWindowBgBrightness(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 1, 3, 28, 16, 0); // brighter
  else if (mode === 1) HS_DrawBgTilemapRect(0x1fa, 1, 3, 28, 17, 0); // darker
}

export function HS_ShowOrHideToplevelTooltipWindow(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 2, 14, 26, 5, 0);
  else if (mode === 1) HS_DrawBgTilemapRect(0x11e, 2, 14, 26, 5, 1);
}

export function HS_ShowOrHideHeaderAndFooterLines_Lighter(mode: number): void {
  if (mode === 0) {
    HS_DrawBgTilemapRect(0x1ff, 1, 2, 28, 1, 0);
    HS_DrawBgTilemapRect(0x1ff, 1, 19, 28, 1, 0);
  } else if (mode === 1) {
    HS_DrawBgTilemapRect(0x1f7, 1, 2, 28, 1, 0);
    HS_DrawBgTilemapRect(0x1f8, 1, 19, 28, 1, 0);
  }
}

export function HS_ShowOrHideHeaderAndFooterLines_Darker(mode: number): void {
  if (mode === 0) {
    HS_DrawBgTilemapRect(0x1ff, 1, 2, 28, 1, 0);
    HS_DrawBgTilemapRect(0x1ff, 1, 19, 28, 1, 0);
  } else if (mode === 1) {
    HS_DrawBgTilemapRect(0x1fb, 1, 2, 28, 1, 0);
    HS_DrawBgTilemapRect(0x1fc, 1, 19, 28, 1, 0);
  }
}

function HS_ShowOrHideVerticalBlackBarsAlongSides(mode: number): void {
  if (mode === 0) {
    HS_DrawBgTilemapRect(0x1ff, 0, 0, 1, 20, 0);
    HS_DrawBgTilemapRect(0x1ff, 29, 0, 1, 20, 0);
  } else if (mode === 1) {
    HS_DrawBgTilemapRect(0x1f9, 0, 0, 1, 20, 0);
    HS_DrawBgTilemapRect(0x1f9, 29, 0, 1, 20, 0);
  }
}

export function HS_ShowOrHideHeaderLine_Darker_FooterStyle(mode: number): void {
  if (mode === 0) HS_DrawBgTilemapRect(0x1ff, 1, 5, 28, 1, 0);
  else if (mode === 1) HS_DrawBgTilemapRect(0x1fc, 1, 5, 28, 1, 0);
}

/** HS_ShowOrHideScrollArrows: `which` 0 top, 1 bottom; mode 0 hides both. */
export function HS_ShowOrHideScrollArrows(which: number, mode: number): void {
  if (mode === 0) {
    HS_DrawBgTilemapRect(0x1ff, 28, 3, 1, 1, 0);
    HS_DrawBgTilemapRect(0x1ff, 28, 18, 1, 1, 0);
  } else if (mode === 1) {
    if (which === 0) HS_DrawBgTilemapRect(0x1fe, 28, 3, 1, 1, 0);
    else HS_DrawBgTilemapRect(0x1fd, 28, 18, 1, 1, 0);
  }
}

// ------------------------------------------------------------------ text (HelpSystemRenderText)

const TEXT_COLOR_WHITE = 1;
const TEXT_COLOR_DARK_GRAY = 2;
const TEXT_COLOR_LIGHT_GRAY = 3;
const TEXT_DYNAMIC_COLOR_5 = 0xe;
const TEXT_DYNAMIC_COLOR_6 = 0xf;
const PLACEHOLDER_ID_PLAYER = 1;
const PLACEHOLDER_ID_STRING_VAR_1 = 2;
const CHAR_SPACE = 0x00;
const CHAR_KEYPAD_ICON = 0xf8;
const CHAR_EXTRA_SYMBOL = 0xf9;
// EXT_CTRL_CODE_* (charmap.txt: FC xx)
const EXT_COLOR = 0x01;
const EXT_HIGHLIGHT = 0x02;
const EXT_SHADOW = 0x03;
const EXT_COLOR_HIGHLIGHT_SHADOW = 0x04;
const EXT_PALETTE = 0x05;
const EXT_FONT = 0x06;
const EXT_PAUSE = 0x08;
const EXT_PLAY_BGM = 0x0b;
const EXT_ESCAPE = 0x0c;
const EXT_SHIFT_RIGHT = 0x0d;
const EXT_SHIFT_DOWN = 0x0e;
const EXT_PLAY_SE = 0x10;
const EXT_CLEAR = 0x11;
const EXT_SKIP = 0x12;
const EXT_CLEAR_TO = 0x13;
const EXT_MIN_LETTER_SPACING = 0x14;

/** GenerateFontHalfRowLookupTable's colours: a glyph's 0 / 1 / 2 / 3 as bg / fg / shadow / bg. */
let sFontColors = [0, 0, 0, 0];

function GenerateFontHalfRowLookupTable(fg: number, bg: number, shadow: number): void {
  sFontColors = [bg, fg, shadow, bg];
}

/** gGlyphInfo's width and height (the last glyph DecompressAndRenderGlyph decompressed). */
const gGlyphInfo = { width: 0, height: 14 };

/** A 4bpp tiled bitmap at `offset` in the buffer, `width` x `height` tiles. */
function bufferBitmap(offset: number, width: number, height: number): Bitmap {
  return { pixels: gDecompressionBuffer.subarray(offset), width: width * 8, height: height * 8 };
}

/**
 * HelpSystemRenderText: a string straight into a tiled bitmap (no text printer): placeholders {PLAYER} and
 * {STR_VAR_1} (BILL or SOMEONE, as FLAG_SYS_NOT_SOMEONES_PC says), newlines and \l \p as line breaks, CLEAR_TO and
 * keypad icons; other control codes are skipped.
 */
function HelpSystemRenderText(fontId: number, dest: number, src: number[], x: number, y: number, width: number, height: number): void {
  const fonts = sFonts!;
  const origX = x;
  const destBlit = bufferBitmap(dest, width, height);
  const advance = () => (x += gGlyphInfo.width);
  let p = 0;
  for (;;) {
    let curChar = src[p++] ?? EOS;
    switch (curChar) {
      case EOS:
        return;
      case CHAR_NEWLINE:
        x = origX;
        y += gGlyphInfo.height + 1;
        break;
      case PLACEHOLDER_BEGIN: {
        curChar = src[p++];
        let str: number[] | undefined;
        if (curChar === PLACEHOLDER_ID_PLAYER) str = playerName().slice(0, 10);
        else if (curChar === PLACEHOLDER_ID_STRING_VAR_1) str = helpString(state.getFlag('FLAG_SYS_NOT_SOMEONES_PC') ? 'gString_Bill' : 'gString_Someone');
        for (const c of str ?? []) {
          if (c === EOS) break;
          DecompressAndRenderGlyph(fonts, fontId, c, destBlit, x, y);
          advance();
        }
        break;
      }
      case CHAR_PROMPT_SCROLL:
      case CHAR_PROMPT_CLEAR:
        x = origX;
        y += gGlyphInfo.height + 1;
        break;
      case EXT_CTRL_CODE_BEGIN:
        curChar = src[p++];
        switch (curChar) {
          case EXT_COLOR_HIGHLIGHT_SHADOW:
            p++;
          // fallthrough
          case EXT_PLAY_BGM:
          case EXT_PLAY_SE:
            p++;
          // fallthrough
          case EXT_COLOR:
          case EXT_HIGHLIGHT:
          case EXT_SHADOW:
          case EXT_PALETTE:
          case EXT_FONT:
          case EXT_PAUSE:
          case EXT_ESCAPE:
          case EXT_SHIFT_RIGHT:
          case EXT_SHIFT_DOWN:
            p++;
            break;
          case EXT_CLEAR:
          case EXT_SKIP:
            p++;
            break;
          case EXT_CLEAR_TO: {
            const clearPixels = src[p] + origX - x;
            if (clearPixels > 0) {
              FillBitmapRect4Bit(destBlit, x, y, clearPixels, fonts.get(fontId).info.maxLetterHeight, 0);
              x += clearPixels;
            }
            p++;
            break;
          }
          case EXT_MIN_LETTER_SPACING:
            p++;
            break;
          // RESET_FONT, PAUSE_UNTIL_PRESS, WAIT_SE, FILL_WINDOW, JPN, ENG: nothing to skip
        }
        break;
      case CHAR_KEYPAD_ICON: {
        curChar = src[p++];
        const icon = fonts.keypadIcons[curChar];
        if (!icon) break;
        const [tileOffset, iconWidth, iconHeight] = icon;
        const srcBlit: Bitmap = { pixels: gfx('gKeypadIconTiles').subarray(0x20 * tileOffset), width: 0x80, height: 0x80 };
        BlitBitmapRect4Bit(srcBlit, destBlit, 0, 0, x, y, iconWidth, iconHeight, 0);
        x += iconWidth;
        break;
      }
      case CHAR_EXTRA_SYMBOL:
        curChar = src[p++] + 0x100;
      // fallthrough
      default:
        if (curChar === CHAR_SPACE) {
          x += fontId === FONT_SMALL ? 5 : 4;
        } else {
          DecompressAndRenderGlyph(fonts, fontId, curChar, destBlit, x, y);
          advance();
        }
        break;
    }
  }
}

/** gSaveBlock2Ptr->playerName, encoded (without EOS). */
function playerName(): number[] {
  return helpEncodePlain(state.playerName);
}

let helpEncodePlain: (s: string) => number[] = () => [];

/** The charmap's encodePlain, for the player's name ({PLAYER}). */
export function SetHelpSystemNameEncoder(encodePlain: (s: string) => number[]): void {
  helpEncodePlain = encodePlain;
}

/**
 * DecompressAndRenderGlyph: FONT_SMALL, FONT_FEMALE or (any other id) FONT_NORMAL's glyph, its 0-3 pixels through
 * the colour table, onto `destBlit` (BlitBitmapRect4Bit with colour key 0: colour 0 is left alone).
 */
function DecompressAndRenderGlyph(fonts: Fonts, fontId: number, glyph: number, destBlit: Bitmap, x: number, y: number): void {
  const font = fonts.get(fontId === FONT_SMALL ? FONT_SMALL : fontId === FONT_FEMALE ? FONT_FEMALE : FONT_NORMAL);
  gGlyphInfo.width = font.width(glyph);
  gGlyphInfo.height = font.height;
  const glyphBlit: Bitmap = { pixels: new Uint8Array(16 * 16 / 2), width: 16, height: 16 };
  for (let gy = 0; gy < gGlyphInfo.height; gy++) {
    for (let gx = 0; gx < gGlyphInfo.width; gx++) {
      const v = sFontColors[font.pixel(glyph, gx, gy)] & 0xf;
      const i = ((gx >> 1) & 3) + ((gx >> 3) << 5) + ((gy >> 3) << 6) + ((gy & 7) << 2);
      glyphBlit.pixels[i] |= gx & 1 ? v << 4 : v;
    }
  }
  BlitBitmapRect4Bit(glyphBlit, destBlit, 0, 0, x, y, gGlyphInfo.width, gGlyphInfo.height, 0);
}

function HelpSystem_PrintTextInTopLeftCorner(str: number[]): void {
  GenerateFontHalfRowLookupTable(TEXT_COLOR_WHITE, TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_DARK_GRAY);
  HelpSystemRenderText(FONT_FEMALE, 0x3d00, str, 6, 2, 7, 2);
}

export function HelpSystem_PrintTextRightAlign_Row52(str: number[]): void {
  const left = 0x7c - stringWidth(sFonts!, FONT_SMALL, str, 0);
  GenerateFontHalfRowLookupTable(TEXT_COLOR_WHITE, TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_DARK_GRAY);
  HelpSystemRenderText(FONT_SMALL, 0x3400, str, left, 2, 16, 2);
}

export function HelpSystem_PrintTextAt(str: number[], x: number, y: number): void {
  GenerateFontHalfRowLookupTable(TEXT_COLOR_WHITE, TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_DARK_GRAY);
  HelpSystemRenderText(FONT_NORMAL, 0x0000, str, x, y, 26, 16);
}

export function HelpSystem_PrintQuestionAndAnswerPair(question: number[], answer: number[]): void {
  gDecompressionBuffer.fill(0xee, 0x0000, 0x3400);
  GenerateFontHalfRowLookupTable(TEXT_COLOR_WHITE, TEXT_DYNAMIC_COLOR_5, TEXT_COLOR_DARK_GRAY);
  HelpSystemRenderText(FONT_NORMAL, 0x0000, question, 0, 0, 26, 16);
  HelpSystemRenderText(FONT_NORMAL, 0x09c0, answer, 0, 0, 26, 13);
}

export function HelpSystem_PrintTopicMouseoverDescription(str: number[]): void {
  gDecompressionBuffer.fill(0x11, 0x23c0, 0x23c0 + 0x1040);
  GenerateFontHalfRowLookupTable(TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  HelpSystemRenderText(FONT_NORMAL, 0x23c0, str, 2, 6, 26, 5);
}

/** HelpSystem_FillPanel3: the "HELP" word's tiles. */
function HelpSystem_FillPanel3(): void {
  gDecompressionBuffer.fill(0xff, 0x3d00, 0x3d00 + 0x1c0);
}

/** HelpSystem_FillPanel2: the controls guide's tiles. */
export function HelpSystem_FillPanel2(): void {
  gDecompressionBuffer.fill(0xff, 0x3400, 0x3400 + 0x400);
}

/** HelpSystem_FillPanel1: the main window's tiles. */
export function HelpSystem_FillPanel1(): void {
  gDecompressionBuffer.fill(0xff, 0x0000, 0x3400);
}

// ------------------------------------------------------------------ the list menu controller

export function HelpSystem_InitListMenuController(a0: HelpSystemListMenu, itemsAbove: number, cursorPos: number): void {
  gHelpSystemListMenu.sub = { ...a0.sub };
  gHelpSystemListMenu.itemsAbove = itemsAbove;
  gHelpSystemListMenu.cursorPos = cursorPos;
  gHelpSystemListMenu.state = 0;
  if (gHelpSystemListMenu.sub.totalItems < gHelpSystemListMenu.sub.maxShowed) gHelpSystemListMenu.sub.maxShowed = gHelpSystemListMenu.sub.totalItems;
  HS_ShowOrHideMainWindowText(0);
  HelpSystem_FillPanel1();
  PrintListMenuItems();
  PlaceListMenuCursor();
}

export function HelpSystem_SetInputDelay(delay: number): void {
  sDelayTimer = delay;
}

/**
 * HelpSystem_GetMenuInput: the item's index on A, -2 on B, -6 on L / R (close), -4 / -5 after a move up / down
 * (UP / DOWN one row, LEFT / RIGHT seven), -1 for nothing.
 */
export function HelpSystem_GetMenuInput(): number {
  if (sDelayTimer !== 0) {
    sDelayTimer--;
    return -1;
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    return gHelpSystemListMenu.sub.items[gHelpSystemListMenu.itemsAbove + gHelpSystemListMenu.cursorPos].index;
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    return -2;
  } else if (JOY_NEW(L_BUTTON | R_BUTTON)) {
    return -6;
  } else if (JOY_REPT(DPAD_UP)) {
    if (!MoveCursor(1, 0)) PlaySE(K.SE_SELECT);
    return -4;
  } else if (JOY_REPT(DPAD_DOWN)) {
    if (!MoveCursor(1, 1)) PlaySE(K.SE_SELECT);
    return -5;
  } else if (JOY_REPT(DPAD_LEFT)) {
    if (!MoveCursor(7, 0)) PlaySE(K.SE_SELECT);
    return -4;
  } else if (JOY_REPT(DPAD_RIGHT)) {
    if (!MoveCursor(7, 1)) PlaySE(K.SE_SELECT);
    return -5;
  }
  return -1;
}

export function HS_UpdateMenuScrollArrows(): void {
  const topItemIdx = (gHelpSystemListMenu.sub.totalItems - 7) & 0xff;
  if (gHelpSystemListMenu.sub.totalItems > 7) {
    const cursorPos = gHelpSystemListMenu.itemsAbove + gHelpSystemListMenu.cursorPos;
    HS_ShowOrHideScrollArrows(0, 0); // hide both
    if (cursorPos === 0) HS_ShowOrHideScrollArrows(1, 1); // show bottom
    else if (gHelpSystemListMenu.itemsAbove === 0 && gHelpSystemListMenu.cursorPos !== 0) HS_ShowOrHideScrollArrows(1, 1);
    else if (gHelpSystemListMenu.itemsAbove === topItemIdx) HS_ShowOrHideScrollArrows(0, 1); // show top
    else if (gHelpSystemListMenu.itemsAbove !== 0) {
      HS_ShowOrHideScrollArrows(0, 1); // show both
      HS_ShowOrHideScrollArrows(1, 1);
    }
  }
}

/** GetFontAttribute(FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT) + 1 */
function glyphHeight(): number {
  return sFonts!.get(FONT_NORMAL).info.maxLetterHeight + 1;
}

function PrintListMenuItems(): void {
  let r5 = gHelpSystemListMenu.itemsAbove;
  for (let i = 0; i < gHelpSystemListMenu.sub.maxShowed; i++) {
    const x = gHelpSystemListMenu.sub.left + 8;
    const y = gHelpSystemListMenu.sub.top + glyphHeight() * i;
    HelpSystem_PrintTextAt(gHelpSystemListMenu.sub.items[r5].label, x, y);
    r5++;
  }
}

function PlaceListMenuCursor(): void {
  const x = gHelpSystemListMenu.sub.left;
  const y = gHelpSystemListMenu.sub.top + glyphHeight() * gHelpSystemListMenu.cursorPos;
  HelpSystem_PrintTextAt(helpString('gText_SelectorArrow2'), x, y);
}

function HS_RemoveSelectionCursorAt(i: number): void {
  const x = gHelpSystemListMenu.sub.left;
  const y = gHelpSystemListMenu.sub.top + i * glyphHeight();
  HelpSystem_PrintTextAt(helpString('gString_HelpSystem_ClearTo8'), x, y);
}

/** TryMoveCursor1: 0 nothing moved, 1 the cursor moved, 2 the list scrolled. `dirn` 0 up, 1 down. */
function TryMoveCursor1(dirn: number): number {
  const m = gHelpSystemListMenu;
  const maxShowed = m.sub.maxShowed;
  if (dirn === 0) {
    const midPoint = maxShowed === 1 ? 0 : (maxShowed - ((maxShowed >> 1) + (maxShowed & 1)) - 1) & 0xffff;
    if (m.itemsAbove === 0) {
      if (m.cursorPos !== 0) {
        m.cursorPos--;
        return 1;
      }
      return 0;
    }
    if (m.cursorPos > midPoint) {
      m.cursorPos--;
      return 1;
    }
    m.itemsAbove--;
    return 2;
  }
  const midPoint = maxShowed === 1 ? 0 : (maxShowed >> 1) + (maxShowed & 1);
  if (m.itemsAbove === m.sub.totalItems - maxShowed) {
    if (m.cursorPos < maxShowed - 1) {
      m.cursorPos++;
      return 1;
    }
    return 0;
  } else if (m.cursorPos < midPoint) {
    m.cursorPos++;
    return 1;
  }
  m.itemsAbove++;
  return 2;
}

/** MoveCursor: TRUE when nothing moved. */
function MoveCursor(by: number, dirn: number): boolean {
  const r7 = gHelpSystemListMenu.cursorPos;
  let flags = 0;
  for (let i = 0; i < by; i++) flags |= TryMoveCursor1(dirn);
  switch (flags) {
    case 0:
    default:
      return true;
    case 1:
      HS_RemoveSelectionCursorAt(r7);
      PlaceListMenuCursor();
      CommitTilemap();
      break;
    case 2:
    case 3:
      if (GetHelpSystemMenuLevel() === 1) {
        HelpSystem_SetInputDelay(2);
        HelpSystem_FillPanel1();
        PrintListMenuItems();
        PlaceListMenuCursor();
        HelpSystem_PrintTopicLabel();
        HS_UpdateMenuScrollArrows();
      } else {
        HS_ShowOrHideMainWindowText(0);
        HelpSystem_FillPanel1();
        PrintListMenuItems();
        PlaceListMenuCursor();
        HS_ShowOrHideMainWindowText(1);
      }
      CommitTilemap();
      break;
  }
  return false;
}
