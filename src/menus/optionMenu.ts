// option_menu.c: the OPTION screen from the start menu (CB2_OptionsMenuFromStartMenu). Six settings (text speed,
// battle scene, battle style, sound, button mode, frame) and CANCEL; LEFT/RIGHT change the one under the cursor
// (the frame's tiles and palette are reloaded at once), A or B fades out and CloseAndSaveOptionMenu writes them to
// the save block (GameState) and goes to gMain.savedCallback (CB2_ReturnToFieldWithOpenMenu from the start menu).
// Not ported: the help system context (SetHelpContext) and SetPokemonCryStereo (no audio; the sound setting is
// stored and saved only).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_RIGHT_ALIGN } from '../battle/stringUtil';
import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, FillBgTilemapBufferRect, InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_BLEND,
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  PALETTES_ALL,
  pltt,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  vram,
  WIN_RANGE,
  WININ_WIN0_BG0,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_CLR,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, JOY_REPT, SetHBlankCallback, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { GetTextWindowPalette, IsActiveOverworldLinkBusy } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  CopyWindowToVram,
  COPYWIN_FULL,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_MAX_LETTER_HEIGHT,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { TextSpeed } from '../text/TextPrinter';
import { EOS, text } from './common';
import { CB2_ReturnToFieldWithOpenMenu } from './fieldCallbacks';

// Menu items
const MENUITEM_TEXTSPEED = 0;
const MENUITEM_BATTLESCENE = 1;
const MENUITEM_BATTLESTYLE = 2;
const MENUITEM_SOUND = 3;
const MENUITEM_BUTTONMODE = 4;
const MENUITEM_FRAMETYPE = 5;
const MENUITEM_CANCEL = 6;
const MENUITEM_COUNT = 7;

// Window ids
const WIN_TEXT_OPTION = 0;
const WIN_OPTIONS = 1;

/** struct OptionMenu */
interface OptionMenu {
  option: number[];
  cursorPos: number;
  loadState: number;
  state: number;
  loadPaletteState: number;
}

let sOptionMenuPtr: OptionMenu | null = null;

const sOptionMenuWinTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 2, tilemapTop: 3, width: 26, height: 2, paletteNum: 1, baseBlock: 2 },
  { bg: 0, tilemapLeft: 2, tilemapTop: 7, width: 26, height: 12, paletteNum: 1, baseBlock: 0x36 },
  { bg: 2, tilemapLeft: 0, tilemapTop: 0, width: 30, height: 2, paletteNum: 15, baseBlock: 0x16e },
  DUMMY_WIN_TEMPLATE,
];

const sOptionMenuBgTemplates: BgTemplate[] = [
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 0, charBaseIndex: 1, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 1, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
];

const sOptionMenuItemCounts = [3, 2, 2, 2, 3, 10, 0];

const sOptionMenuItemsNames = ['gText_TextSpeed', 'gText_BattleScene', 'gText_BattleStyle', 'gText_Sound', 'gText_ButtonMode', 'gText_Frame', 'gText_OptionMenuCancel'];
const sTextSpeedOptions = ['gText_TextSpeedSlow', 'gText_TextSpeedMid', 'gText_TextSpeedFast'];
const sBattleSceneOptions = ['gText_BattleSceneOn', 'gText_BattleSceneOff'];
const sBattleStyleOptions = ['gText_BattleStyleShift', 'gText_BattleStyleSet'];
const sSoundOptions = ['gText_SoundMono', 'gText_SoundStereo'];
const sButtonTypeOptions = ['gText_ButtonTypeHelp', 'gText_ButtonTypeLR', 'gText_ButtonTypeLEqualsA'];

// TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY
const sOptionMenuPickSwitchCancelTextColor = [0xf, 1, 2];
// TEXT_COLOR_TRANSPARENT, TEXT_COLOR_LIGHT_RED, TEXT_COLOR_RED
const sOptionMenuTextColor = [0, 5, 4];

/** gSaveBlock2Ptr->optionsTextSpeed as the port stores it (OPTIONS_TEXT_SPEED_SLOW / _MID / _FAST). */
const TEXT_SPEEDS: TextSpeed[] = ['slow', 'mid', 'fast'];

/** GetUserWindowGraphics(id): gUserFrames' tiles and palette symbols. */
const userFrame = (frameType: number) => `sUserFrame_Type${frameType + 1}`;

/** What the screen draws: sOptionMenuPalette, the std window frame, the text window palettes and every user frame. */
export const optionMenuGfxSymbols = (): string[] => [
  'sOptionMenuPalette',
  'gStdTextWindow_Gfx',
  'gTextWindowPalettes',
  ...Array.from({ length: 10 }, (_, i) => [`${userFrame(i)}_Gfx`, `${userFrame(i)}_Pal`]).flat(),
];

/** The screen while it's up (test probe): the input state, cursor and the settings as shown. */
export function optionMenuProbe(): { loadState: number; cursorPos: number; option: number[] } | undefined {
  return sOptionMenuPtr ? { loadState: sOptionMenuPtr.loadState, cursorPos: sOptionMenuPtr.cursorPos, option: [...sOptionMenuPtr.option] } : undefined;
}

function CB2_InitOptionMenu(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function VBlankCB_OptionMenu(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_OptionsMenuFromStartMenu */
export function CB2_OptionsMenuFromStartMenu(): void {
  if (gMain.savedCallback === null) gMain.savedCallback = CB2_ReturnToFieldWithOpenMenu;
  const ptr: OptionMenu = { option: new Array<number>(MENUITEM_COUNT).fill(0), cursorPos: 0, loadState: 0, state: 0, loadPaletteState: 0 };
  sOptionMenuPtr = ptr;
  ptr.option[MENUITEM_TEXTSPEED] = TEXT_SPEEDS.indexOf(state.textSpeed);
  ptr.option[MENUITEM_BATTLESCENE] = state.battleSceneOff ? 1 : 0;
  ptr.option[MENUITEM_BATTLESTYLE] = state.battleStyleSet ? K.OPTIONS_BATTLE_STYLE_SET : K.OPTIONS_BATTLE_STYLE_SHIFT;
  ptr.option[MENUITEM_SOUND] = state.optionsSound;
  ptr.option[MENUITEM_BUTTONMODE] = state.optionsButtonMode;
  ptr.option[MENUITEM_FRAMETYPE] = state.optionsWindowFrameType;
  for (let i = 0; i < MENUITEM_COUNT - 1; i++) {
    if (ptr.option[i] > sOptionMenuItemCounts[i] - 1 || ptr.option[i] < 0) ptr.option[i] = 0;
  }
  // SetHelpContext(HELPCONTEXT_OPTIONS): no help system
  SetMainCallback2(CB2_OptionMenu);
}

function OptionMenu_InitCallbacks(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
}

function OptionMenu_SetVBlankCallback(): void {
  SetVBlankCallback(VBlankCB_OptionMenu);
}

function CB2_OptionMenu(): void {
  const ptr = sOptionMenuPtr!;
  switch (ptr.state) {
    case 0:
      OptionMenu_InitCallbacks();
      break;
    case 1:
      InitOptionMenuBg();
      break;
    case 2:
      OptionMenu_ResetSpriteData();
      break;
    case 3:
      if (!LoadOptionMenuPalette()) return;
      break;
    case 4:
      PrintOptionMenuHeader();
      break;
    case 5:
      DrawOptionMenuBg();
      break;
    case 6:
      LoadOptionMenuItemNames();
      break;
    case 7:
      for (let i = 0; i < MENUITEM_COUNT; i++) BufferOptionMenuString(i);
      break;
    case 8:
      UpdateSettingSelectionDisplay(ptr.cursorPos);
      break;
    case 9:
      OptionMenu_PickSwitchCancel();
      break;
    default:
      SetOptionMenuTask();
      break;
  }
  ptr.state++;
}

function SetOptionMenuTask(): void {
  CreateTask(Task_OptionMenu, 0);
  SetMainCallback2(CB2_InitOptionMenu);
}

function InitOptionMenuBg(): void {
  vram.fill(0); // DmaClearLarge16(VRAM); OAM is ResetSpriteData's
  pltt.fill(0); // DmaClear16(PLTT)
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sOptionMenuBgTemplates, sOptionMenuBgTemplates.length);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  InitWindows(sOptionMenuWinTemplates);
  DeactivateAllTextPrinters();
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_BLEND | BLDCNT_EFFECT_LIGHTEN);
  SetGpuReg(REG_OFFSET_BLDY, BLDCNT_TGT1_BG1);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG0);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_CLR);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON);
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
}

function OptionMenu_PickSwitchCancel(): void {
  const str = text('gText_PickSwitchCancel');
  const x = 0xe4 - GetStringWidth(K.FONT_SMALL, str, 0);
  FillWindowPixelBuffer(2, PIXEL_FILL(15));
  AddTextPrinterParameterized3(2, K.FONT_SMALL, x, 0, sOptionMenuPickSwitchCancelTextColor, 0, str);
  PutWindowTilemap(2);
  CopyWindowToVram(2, COPYWIN_FULL);
}

function OptionMenu_ResetSpriteData(): void {
  ResetSpriteData();
  ResetPaletteFade();
  FreeAllSpritePalettes();
  ResetTasks();
  ScanlineEffect_Stop();
}

/** The frame's tiles (at 0x1AA on BG1) and palette (BG palette 2). */
function LoadFrameGfx(frameType: number): void {
  LoadBgTiles(1, gfx(`${userFrame(frameType)}_Gfx`), 0x120, 0x1aa);
}

function LoadFramePalette(frameType: number): void {
  LoadPalette(gfx16(`${userFrame(frameType)}_Pal`), BG_PLTT_ID(2), PLTT_SIZE_4BPP);
}

function LoadOptionMenuPalette(): boolean {
  const ptr = sOptionMenuPtr!;
  switch (ptr.loadPaletteState) {
    case 0:
      LoadFrameGfx(ptr.option[MENUITEM_FRAMETYPE]);
      break;
    case 1:
      LoadFramePalette(ptr.option[MENUITEM_FRAMETYPE]);
      break;
    case 2: {
      const pal = gfx16('sOptionMenuPalette');
      LoadPalette(pal, BG_PLTT_ID(1), pal.length * 2);
      LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      break;
    }
    case 3:
      // LoadStdWindowGfxOnBg(1, 0x1B3, BG_PLTT_ID(3))
      LoadBgTiles(1, gfx('gStdTextWindow_Gfx'), 0x120, 0x1b3);
      LoadPalette(GetTextWindowPalette(3), BG_PLTT_ID(3), PLTT_SIZE_4BPP);
      break;
    default:
      return true;
  }
  ptr.loadPaletteState++;
  return false;
}

function Task_OptionMenu(taskId: number): void {
  const ptr = sOptionMenuPtr!;
  switch (ptr.loadState) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, RGB_BLACK);
      OptionMenu_SetVBlankCallback();
      ptr.loadState++;
      break;
    case 1:
      if (gPaletteFade.active) return;
      ptr.loadState++;
      break;
    case 2:
      if (IsActiveOverworldLinkBusy()) break;
      switch (OptionMenu_ProcessInput()) {
        case 0:
          break;
        case 1:
          ptr.loadState++;
          break;
        case 2:
          LoadFrameGfx(ptr.option[MENUITEM_FRAMETYPE]);
          LoadFramePalette(ptr.option[MENUITEM_FRAMETYPE]);
          BufferOptionMenuString(ptr.cursorPos);
          break;
        case 3:
          UpdateSettingSelectionDisplay(ptr.cursorPos);
          break;
        case 4:
          BufferOptionMenuString(ptr.cursorPos);
          break;
      }
      break;
    case 3:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
      ptr.loadState++;
      break;
    case 4:
      if (gPaletteFade.active) return;
      ptr.loadState++;
      break;
    case 5:
      CloseAndSaveOptionMenu(taskId);
      break;
  }
}

function OptionMenu_ProcessInput(): number {
  const ptr = sOptionMenuPtr!;
  const pos = ptr.cursorPos;
  if (JOY_REPT(DPAD_RIGHT)) {
    const current = ptr.option[pos];
    ptr.option[pos] = current === sOptionMenuItemCounts[pos] - 1 ? 0 : current + 1;
    return pos === MENUITEM_FRAMETYPE ? 2 : 4;
  } else if (JOY_REPT(DPAD_LEFT)) {
    // On CANCEL (count 0) this leaves 0xFFFF in option[CANCEL], which nothing reads.
    ptr.option[pos] = ptr.option[pos] === 0 ? sOptionMenuItemCounts[pos] - 1 : ptr.option[pos] - 1;
    return pos === MENUITEM_FRAMETYPE ? 2 : 4;
  } else if (JOY_REPT(DPAD_UP)) {
    ptr.cursorPos = pos === MENUITEM_TEXTSPEED ? MENUITEM_CANCEL : pos - 1;
    return 3;
  } else if (JOY_REPT(DPAD_DOWN)) {
    ptr.cursorPos = pos === MENUITEM_CANCEL ? MENUITEM_TEXTSPEED : pos + 1;
    return 3;
  } else if (JOY_NEW(B_BUTTON) || JOY_NEW(A_BUTTON)) {
    return 1;
  }
  return 0;
}

function BufferOptionMenuString(selection: number): void {
  const ptr = sOptionMenuPtr!;
  const x = 0x82;
  const maxLetterHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT);
  const y = (maxLetterHeight - 1) * selection + 2;
  FillWindowPixelRect(1, 1, x, y, 0x46, maxLetterHeight);

  const value = ptr.option[selection];
  const table = [sTextSpeedOptions, sBattleSceneOptions, sBattleStyleOptions, sSoundOptions, sButtonTypeOptions][selection];
  if (table) {
    AddTextPrinterParameterized3(1, K.FONT_NORMAL, x, y, sOptionMenuTextColor, TEXT_SKIP_DRAW, text(table[value]));
  } else if (selection === MENUITEM_FRAMETYPE) {
    // StringCopy(str, gText_FrameType) + ConvertIntToDecimalStringN(buf, n + 1, STR_CONV_MODE_RIGHT_ALIGN, 2)
    const typeText = text('gText_FrameType');
    const str = [...typeText.slice(0, typeText.indexOf(EOS)), ...ConvertIntToDecimalStringN(value + 1, STR_CONV_MODE_RIGHT_ALIGN, 2), EOS];
    AddTextPrinterParameterized3(1, K.FONT_NORMAL, x, y, sOptionMenuTextColor, TEXT_SKIP_DRAW, str);
  }
  PutWindowTilemap(1);
  CopyWindowToVram(1, COPYWIN_FULL);
}

function CloseAndSaveOptionMenu(taskId: number): void {
  const ptr = sOptionMenuPtr!;
  // gFieldCallback = FieldCB_DefaultWarpExit: CB2_ReturnToFieldWithOpenMenu's gFieldCallback2 runs instead of it
  SetMainCallback2(gMain.savedCallback);
  FreeAllWindowBuffers();
  state.textSpeed = TEXT_SPEEDS[ptr.option[MENUITEM_TEXTSPEED]];
  state.battleSceneOff = ptr.option[MENUITEM_BATTLESCENE] !== 0;
  state.battleStyleSet = ptr.option[MENUITEM_BATTLESTYLE] === K.OPTIONS_BATTLE_STYLE_SET;
  state.optionsSound = ptr.option[MENUITEM_SOUND];
  state.optionsButtonMode = ptr.option[MENUITEM_BUTTONMODE];
  state.optionsWindowFrameType = ptr.option[MENUITEM_FRAMETYPE];
  // SetPokemonCryStereo(gSaveBlock2Ptr->optionsSound): no audio
  sOptionMenuPtr = null;
  DestroyTask(taskId);
}

function PrintOptionMenuHeader(): void {
  FillWindowPixelBuffer(0, PIXEL_FILL(1));
  AddTextPrinterParameterized(WIN_TEXT_OPTION, K.FONT_NORMAL, text('gText_Option'), 8, 1, TEXT_SKIP_DRAW);
  PutWindowTilemap(0);
  CopyWindowToVram(0, COPYWIN_FULL);
}

function DrawOptionMenuBg(): void {
  const h = 2;
  // The header's std frame (palette 3, tiles 0x1B3..)
  FillBgTilemapBufferRect(1, 0x1b3, 1, 2, 1, 1, 3);
  FillBgTilemapBufferRect(1, 0x1b4, 2, 2, 0x1b, 1, 3);
  FillBgTilemapBufferRect(1, 0x1b5, 0x1c, 2, 1, 1, 3);
  FillBgTilemapBufferRect(1, 0x1b6, 1, 3, 1, h, 3);
  FillBgTilemapBufferRect(1, 0x1b8, 0x1c, 3, 1, h, 3);
  FillBgTilemapBufferRect(1, 0x1b9, 1, 5, 1, 1, 3);
  FillBgTilemapBufferRect(1, 0x1ba, 2, 5, 0x1b, 1, 3);
  FillBgTilemapBufferRect(1, 0x1bb, 0x1c, 5, 1, 1, 3);
  // The settings' user frame (palette 2, tiles 0x1AA..)
  FillBgTilemapBufferRect(1, 0x1aa, 1, 6, 1, 1, h);
  FillBgTilemapBufferRect(1, 0x1ab, 2, 6, 0x1a, 1, h);
  FillBgTilemapBufferRect(1, 0x1ac, 0x1c, 6, 1, 1, h);
  FillBgTilemapBufferRect(1, 0x1ad, 1, 7, 1, 0x10, h);
  FillBgTilemapBufferRect(1, 0x1af, 0x1c, 7, 1, 0x10, h);
  FillBgTilemapBufferRect(1, 0x1b0, 1, 0x13, 1, 1, h);
  FillBgTilemapBufferRect(1, 0x1b1, 2, 0x13, 0x1a, 1, h);
  FillBgTilemapBufferRect(1, 0x1b2, 0x1c, 0x13, 1, 1, h);
  CopyBgTilemapBufferToVram(1);
}

function LoadOptionMenuItemNames(): void {
  FillWindowPixelBuffer(1, PIXEL_FILL(1));
  const maxLetterHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT);
  for (let i = 0; i < MENUITEM_COUNT; i++) {
    AddTextPrinterParameterized(WIN_OPTIONS, K.FONT_NORMAL, text(sOptionMenuItemsNames[i]), 8, ((i * maxLetterHeight + 2) & 0xff) - i, TEXT_SKIP_DRAW);
  }
}

/** The selected row is WIN0, left out of the lightening the rest of the window gets. */
function UpdateSettingSelectionDisplay(selection: number): void {
  const maxLetterHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT);
  const y = selection * (maxLetterHeight - 1) + 0x3a;
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(y, y + maxLetterHeight));
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0x10, 0xe0));
}
