// title_screen.c (FireRed): the Charizard / logo scene on the GBA layer. The flash that sweeps up over the box art
// mon (a BLDY scanline effect), Charizard fading in from grey, the WIN0 slide that brings in the copyright and
// border BGs, the white flashes, then the run scene: "PRESS START" blinking, flames rising from the bottom and
// the slash of light across the logo (an OBJ-window sprite lightening BG0). A/START: the cry, a fade to white and
// the main menu (CB2_InitMainMenu); 2700 frames without input restart the title; B+SELECT+UP opens the clear save
// data screen. A host scene (scenes/MainMenuScene.ts) fills in `titleScreenEnv` and runs CB2_InitTitleScreen.

import { ChangeBgX, HideBg, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  ClearGpuRegBits,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_OBJWIN_ON,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTES_ALL,
  PALETTES_BG,
  pltt,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  vram,
  WIN_RANGE,
  WININ_WIN0_ALL,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_ALL,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_UP, gMain, JOY_HELD, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, START_BUTTON } from '../gba/main';
import { DecompressAndCopyTileDataToVram, FreeTempTileDataBuffersIfPossible, ResetBgPositions } from '../gba/menu';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalettes,
  BlendPalettesGradually,
  DestroyBlendPalettesGraduallyTask,
  gPaletteFade,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  IsBlendPalettesGraduallyTaskActive,
  LoadPalette,
  OBJ_PLTT_ID,
  PLTT_SIZE_4BPP,
  ResetPaletteFade,
  ResetPaletteFadeControl,
  TintPalette_GrayScale2,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { gScanlineEffect, gScanlineEffectRegBuffers, ScanlineEffect_InitHBlankDmaTransfer, ScanlineEffect_SetParams, SCANLINE_EFFECT_DMACNT_16BIT } from '../gba/scanline';
import { FadeOutBGM, FadeOutMapMusic, IsNotWaitingForBGMStop, m4aSongNumStart, PlayCry_Normal } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_OBJ_WINDOW,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, FuncIsActiveTask, GetWordTaskArg, gTasks, ResetTasks, RunTasks, SetWordTaskArg, TASK_NONE, type TaskFunc } from '../gba/task';
import { testEvent } from '../dev/testHooks';
import { CB2_InitMainMenu } from './mainMenu';

/** What the title screen reads from outside title_screen.c. */
export const titleScreenEnv = {
  /** A decomp constant (SPECIES_*, MUS_*). */
  define: (_name: string): number => 0,
  /**
   * SetTitleScreenScene_Cry's save handling before CB2_InitMainMenu: LoadGameSave(SAVE_NORMAL) (and
   * Sav2_ClearSetDefault for an empty or unreadable slot), so the main menu sees the slot as it is now.
   */
  loadGameSave: (): void => {},
  /** CB2_SaveClearScreen_Init (clear_save_data_screen.c) */
  saveClearScreenInit: (): void => {},
};

// enum TitleScreenScene
const TITLESCREENSCENE_INIT = 0;
const TITLESCREENSCENE_FLASHSPRITE = 1;
const TITLESCREENSCENE_FADEIN = 2;
const TITLESCREENSCENE_RUN = 3;
const TITLESCREENSCENE_RESTART = 4;
const TITLESCREENSCENE_CRY = 5;
const SCENE_NAMES = ['INIT', 'FLASHSPRITE', 'FADEIN', 'RUN', 'RESTART', 'CRY'];

let sTitleScreenTimerTaskId = TASK_NONE;

// tile / palette tags
const TILE_TAG_FLAME_OR_LEAF = 0;
const TILE_TAG_BLANK_OR_STREAK = 1;
const TILE_TAG_BLANK = 2;
const TILE_TAG_SLASH = 3;
const PAL_TAG_DEFAULT = 0;
const PAL_TAG_SLASH = 2;

const sOamData_FlameOrLeaf = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 3 });

const sSpriteAnim_Flame = [
  ANIMCMD_FRAME(0, 3),
  ANIMCMD_FRAME(4, 6),
  ANIMCMD_FRAME(8, 6),
  ANIMCMD_FRAME(12, 6),
  ANIMCMD_FRAME(16, 6),
  ANIMCMD_FRAME(20, 6),
  ANIMCMD_FRAME(24, 6),
  ANIMCMD_FRAME(28, 6),
  ANIMCMD_FRAME(32, 6),
  ANIMCMD_FRAME(36, 6),
  ANIMCMD_END,
];
const sSpriteAnim_Flame_Unused = [ANIMCMD_FRAME(24, 6), ANIMCMD_FRAME(28, 6), ANIMCMD_FRAME(32, 6), ANIMCMD_FRAME(36, 6), ANIMCMD_END];
const sSpriteAnim_FlameOrLeaf = [sSpriteAnim_Flame, sSpriteAnim_Flame_Unused];

const sSpriteTemplate_FlameOrLeaf: SpriteTemplate = {
  tileTag: TILE_TAG_FLAME_OR_LEAF,
  paletteTag: PAL_TAG_DEFAULT,
  oam: sOamData_FlameOrLeaf,
  anims: sSpriteAnim_FlameOrLeaf,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSpriteTemplate_BlankFlame: SpriteTemplate = { ...sSpriteTemplate_FlameOrLeaf, tileTag: TILE_TAG_BLANK_OR_STREAK };

const sSpriteTemplate_BlankSprite: SpriteTemplate = {
  tileTag: TILE_TAG_BLANK,
  paletteTag: PAL_TAG_SLASH,
  oam: oam({ shape: SPRITE_SHAPE['32x64'][0], size: SPRITE_SHAPE['32x64'][1], priority: 0 }),
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSlashSpriteTemplate: SpriteTemplate = {
  tileTag: TILE_TAG_SLASH,
  paletteTag: PAL_TAG_SLASH,
  oam: oam({ objMode: ST_OAM_OBJ_WINDOW, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 0 }),
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 1, priority: 0, baseTile: 0 }, // 8bpp
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
];

const sSpriteSheets = () => [
  { data: gfx('sFlames_Gfx'), size: 0x500, tag: TILE_TAG_FLAME_OR_LEAF },
  { data: gfx('sBlankFlames_Gfx'), size: 0x500, tag: TILE_TAG_BLANK_OR_STREAK },
  { data: gfx('gTitleScreen_BlankSprite_Tiles'), size: 0x400, tag: TILE_TAG_BLANK },
  { data: gfx('sSlash_Gfx'), size: 0x800, tag: TILE_TAG_SLASH },
];

const sSpritePals = () => [
  { data: gfx16('sFlames_Pal'), tag: PAL_TAG_DEFAULT },
  { data: gfx16('gTitleScreen_Slash_Pal'), tag: PAL_TAG_SLASH },
];

const sFlameXPositions = [4, 16, 26, 32, 48, 200, 216, 224, 232, 60, 76, 92, 108, 128, 144, 0];

/** Graphics the title screen loads. */
export const titleScreenGfxSymbols = (): string[] => [
  'gGraphics_TitleScreen_GameTitleLogoPals',
  'gGraphics_TitleScreen_GameTitleLogoTiles',
  'gGraphics_TitleScreen_GameTitleLogoMap',
  'gGraphics_TitleScreen_BoxArtMonPals',
  'gGraphics_TitleScreen_BoxArtMonTiles',
  'gGraphics_TitleScreen_BoxArtMonMap',
  'gGraphics_TitleScreen_BackgroundPals',
  'gGraphics_TitleScreen_CopyrightPressStartTiles',
  'gGraphics_TitleScreen_CopyrightPressStartMap',
  'sBorderBgTiles',
  'sBorderBgMap',
  'sFlames_Gfx',
  'sBlankFlames_Gfx',
  'gTitleScreen_BlankSprite_Tiles',
  'sSlash_Gfx',
  'sFlames_Pal',
  'gTitleScreen_Slash_Pal',
];

/** CB2_InitTitleScreen */
export function CB2_InitTitleScreen(): void {
  switch (gMain.state) {
    default:
      gMain.state = 0;
    // fallthrough
    case 0:
      SetVBlankCallback(null);
      // StartTimer1 (seeds the RNG later): the port's RNG is seeded at load. InitHeap: no heap.
      ResetTasks();
      ResetSpriteData();
      FreeAllSpritePalettes();
      ResetPaletteFade();
      ResetGpuRegs();
      vram.fill(0); // DmaFill16(3, 0, VRAM, VRAM_SIZE); OAM is ResetSpriteData's
      pltt.fill(0);
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates);
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      sTitleScreenTimerTaskId = TASK_NONE;
      testEvent('titleScreen');
      break;
    case 1:
      LoadPalette(gfx16('gGraphics_TitleScreen_GameTitleLogoPals'), BG_PLTT_ID(0), 13 * PLTT_SIZE_4BPP);
      DecompressAndCopyTileDataToVram(0, gfx('gGraphics_TitleScreen_GameTitleLogoTiles'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(0, gfx('gGraphics_TitleScreen_GameTitleLogoMap'), 0, 0, 1);
      LoadPalette(gfx16('gGraphics_TitleScreen_BoxArtMonPals'), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
      DecompressAndCopyTileDataToVram(1, gfx('gGraphics_TitleScreen_BoxArtMonTiles'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(1, gfx('gGraphics_TitleScreen_BoxArtMonMap'), 0, 0, 1);
      LoadPalette(gfx16('gGraphics_TitleScreen_BackgroundPals'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      DecompressAndCopyTileDataToVram(2, gfx('gGraphics_TitleScreen_CopyrightPressStartTiles'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(2, gfx('gGraphics_TitleScreen_CopyrightPressStartMap'), 0, 0, 1);
      LoadPalette(gfx16('gGraphics_TitleScreen_BackgroundPals'), BG_PLTT_ID(14), PLTT_SIZE_4BPP);
      DecompressAndCopyTileDataToVram(3, gfx('sBorderBgTiles'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(3, gfx('sBorderBgMap'), 0, 0, 1);
      LoadSpriteGfxAndPals();
      break;
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        BlendPalettes(PALETTES_BG, 16, RGB_BLACK);
        CreateTask(Task_TitleScreenMain, 4);
        sTitleScreenTimerTaskId = CreateTask(Task_TitleScreenTimer, 2);
        SetVBlankCallback(VBlankCB);
        SetMainCallback2(CB2_TitleScreenRun);
        m4aSongNumStart(titleScreenEnv.define('MUS_TITLE'));
      }
      return;
  }
  gMain.state++;
}

function ResetGpuRegs(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_BG0HOFS, 0);
  SetGpuReg(REG_OFFSET_BG0VOFS, 0);
  SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  SetGpuReg(REG_OFFSET_BG1VOFS, 0);
  SetGpuReg(REG_OFFSET_BG2HOFS, 0);
  SetGpuReg(REG_OFFSET_BG2VOFS, 0);
  SetGpuReg(REG_OFFSET_BG3HOFS, 0);
  SetGpuReg(REG_OFFSET_BG3VOFS, 0);
}

function CB2_TitleScreenRun(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function VBlankCB(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  ScanlineEffect_InitHBlankDmaTransfer();
  if (sTitleScreenTimerTaskId !== TASK_NONE) gTasks[sTitleScreenTimerTaskId].data[0]++;
}

const Task_TitleScreenTimer: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[0] >= 2700) {
    sTitleScreenTimerTaskId = TASK_NONE;
    DestroyTask(taskId);
  }
};

// task data for Task_TitleScreenMain and the scenes
const tSceneNum = 0;
const tState = 1;
const tHasCreatedBlankSprite = 5;
const tSlashSpriteId = 6;

const Task_TitleScreenMain: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (
    JOY_NEW(A_BUTTON | B_BUTTON | START_BUTTON) &&
    data[tSceneNum] !== TITLESCREENSCENE_RUN &&
    data[tSceneNum] !== TITLESCREENSCENE_RESTART &&
    data[tSceneNum] !== TITLESCREENSCENE_CRY
  ) {
    ScheduleStopScanlineEffect();
    LoadMainTitleScreenPalsAndResetBgs();
    SetPalOnOrCreateBlankSprite(data[tHasCreatedBlankSprite] !== 0);
    SetTitleScreenScene(data, TITLESCREENSCENE_RUN);
  } else {
    sSceneFuncs[data[tSceneNum]](data);
  }
};

/**
 * DestroyTask(FindTaskIdByFunc(func)). The blink task can be gone already (it ends itself after the fade), and
 * then the C passes TASK_NONE, which DestroyTask reads past gTasks for; here that does nothing.
 */
function DestroyTaskByFunc(func: TaskFunc): void {
  const taskId = FindTaskIdByFunc(func);
  if (taskId !== TASK_NONE) DestroyTask(taskId);
}

function SetTitleScreenScene(data: Int16Array, sceneNum: number): void {
  data[tState] = 0;
  data[tSceneNum] = sceneNum;
}

function SetTitleScreenScene_Init(data: Int16Array): void {
  HideBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
  gScanlineEffectRegBuffers[0].fill(0, 0, 0xa0);
  gScanlineEffectRegBuffers[1].fill(0, 0, 0xa0);
  ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_BLDY, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  SetTitleScreenScene(data, TITLESCREENSCENE_FLASHSPRITE);
}

function SetTitleScreenScene_FlashSprite(data: Int16Array): void {
  switch (data[tState]) {
    case 0:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_LIGHTEN);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      data[2] = 128;
      UpdateScanlineEffectRegBuffer(data[2]);
      data[tState]++;
      break;
    case 1:
      data[2] -= 4;
      UpdateScanlineEffectRegBuffer(data[2]);
      if (data[2] < 0) {
        gScanlineEffect.state = 3;
        data[tState]++;
      }
      break;
    case 2:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      SetTitleScreenScene(data, TITLESCREENSCENE_FADEIN);
  }
}

const FLASH_WHITE = RGB(30, 30, 31);

function SetTitleScreenScene_FadeIn(data: Int16Array): void {
  switch (data[tState]) {
    case 0:
      data[2] = 0;
      data[tState]++;
      break;
    case 1:
      data[2]++;
      if (data[2] > 10) {
        TintPalette_GrayScale2(gPlttBufferUnfaded, BG_PLTT_ID(13), 16);
        BeginNormalPaletteFade(1 << 13, 9, 16, 0, RGB_BLACK);
        data[tState]++;
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        data[2] = 0;
        data[tState]++;
      }
      break;
    case 3:
      data[2]++;
      if (data[2] > 36) {
        CreateTask(Task_TitleScreen_SlideWin0, 3);
        BlendPalettesGradually(1 << 13, -4, 1, 16, FLASH_WHITE, 0, 0);
        data[2] = 0;
        data[tState]++;
      }
      break;
    case 4:
      if (!IsBlendPalettesGraduallyTaskActive(0)) {
        BlendPalettesGradually(1 << 13, -4, 15, 0, FLASH_WHITE, 0, 0);
        data[tState]++;
      }
      break;
    case 5:
      data[2]++;
      if (data[2] > 20) {
        data[2] = 0;
        BlendPalettesGradually(1 << 13, -4, 1, 16, FLASH_WHITE, 0, 0);
        data[tState]++;
      }
      break;
    case 6:
      if (!IsBlendPalettesGraduallyTaskActive(0)) {
        BlendPalettesGradually(1 << 13, -4, 15, 0, FLASH_WHITE, 0, 0);
        data[tState]++;
      }
      break;
    case 7:
      data[2]++;
      if (data[2] > 20) {
        data[2] = 0;
        BlendPalettesGradually(1 << 13, -3, 0, 16, FLASH_WHITE, 0, 0);
        data[tState]++;
      }
      break;
    case 8:
      if (!IsBlendPalettesGraduallyTaskActive(0)) {
        data[tHasCreatedBlankSprite] = 1;
        const palettes = ((PALETTES_BG & ~(1 << 13) & ~(1 << 14) & ~(1 << 15)) | (0x10000 << CreateBlankSprite())) >>> 0;
        BlendPalettes(palettes, 16, FLASH_WHITE);
        BeginNormalPaletteFade(palettes, 1, 16, 0, FLASH_WHITE);
        ShowBg(0);
        gPlttBufferUnfaded.set(gfx16('gGraphics_TitleScreen_BoxArtMonPals').subarray(0, 16), BG_PLTT_ID(13));
        BlendPalettesGradually(1 << 13, 1, 15, 0, FLASH_WHITE, 0, 0);
        data[tState]++;
      }
      break;
    case 9:
      if (!IsBlendPalettesGraduallyTaskActive(0) && !gPaletteFade.active) SetTitleScreenScene(data, TITLESCREENSCENE_RUN);
      break;
  }
}

const KEYSTROKE_DELSAVE = B_BUTTON | SELECT_BUTTON | DPAD_UP;
const KEYSTROKE_BERRY_FIX = B_BUTTON | SELECT_BUTTON;

function SetTitleScreenScene_Run(data: Int16Array): void {
  switch (data[tState]) {
    case 0:
      // SetHelpContext(HELPCONTEXT_TITLE_SCREEN), HelpSystem_Enable: the help system isn't ported
      CreateTask(Task_TitleScreen_BlinkPressStart, 0);
      CreateTask(Task_FlameSpawner, 5);
      SetGpuRegsForTitleScreenRun();
      data[tSlashSpriteId] = CreateSlashSprite();
      data[tState]++;
    // fallthrough
    case 1:
      if (JOY_HELD(KEYSTROKE_DELSAVE) === KEYSTROKE_DELSAVE) {
        DeactivateSlashSprite(data[tSlashSpriteId]);
        DestroyTask(FindTaskIdByFunc(Task_TitleScreenMain));
        SetMainCallback2(CB2_FadeOutTransitionToSaveClearScreen);
      } else if (JOY_HELD(KEYSTROKE_BERRY_FIX) === KEYSTROKE_BERRY_FIX) {
        // REVISION 0: B+SELECT goes to CB2_FadeOutTransitionToBerryFix, the multiboot program that fixes Ruby and
        // Sapphire's berry clock. Not ported: the title screen keeps running.
        void KEYSTROKE_BERRY_FIX;
      } else if (JOY_NEW(A_BUTTON | START_BUTTON)) {
        SetTitleScreenScene(data, TITLESCREENSCENE_CRY);
      } else if (!FuncIsActiveTask(Task_TitleScreenTimer)) {
        SetTitleScreenScene(data, TITLESCREENSCENE_RESTART);
      }
      break;
  }
}

function SetGpuRegsForTitleScreenRun(): void {
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WINOBJ_ALL);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_LIGHTEN);
  SetGpuReg(REG_OFFSET_BLDY, 13);
}

function SetTitleScreenScene_Restart(data: Int16Array): void {
  switch (data[tState]) {
    case 0:
      DeactivateSlashSprite(data[tSlashSpriteId]);
      data[tState]++;
      break;
    case 1:
      if (!gPaletteFade.active && !IsSlashSpriteDeactivated(data[tSlashSpriteId])) {
        FadeOutMapMusic(10);
        BeginNormalPaletteFade(PALETTES_ALL, 3, 0, 0x10, RGB_BLACK);
        SignalEndTitleScreenPaletteSomethingTask();
        data[1]++;
      }
      break;
    case 2:
      if (IsNotWaitingForBGMStop() && !gPaletteFade.active) {
        DestroyTaskByFunc(Task_TitleScreen_BlinkPressStart);
        data[2] = 0;
        data[tState]++;
      }
      break;
    case 3:
      data[2]++;
      if (data[2] >= 20) {
        DestroyTaskByFunc(Task_TitleScreen_BlinkPressStart);
        data[tState]++;
      }
      break;
    case 4:
      // HelpSystem_Disable: no help system
      DestroyTask(FindTaskIdByFunc(Task_TitleScreenMain));
      SetMainCallback2(CB2_InitCopyrightScreenAfterTitleScreen);
      break;
  }
}

/**
 * CB2_InitCopyrightScreenAfterTitleScreen (intro.c): the copyright screen and the Game Freak / Nidorino movie,
 * which end on the title screen again. intro.c isn't ported, so this goes straight back to the title screen.
 */
function CB2_InitCopyrightScreenAfterTitleScreen(): void {
  SetMainCallback2(CB2_InitTitleScreen);
}

function SetTitleScreenScene_Cry(data: Int16Array): void {
  switch (data[tState]) {
    case 0:
      if (!gPaletteFade.active) {
        PlayCry_Normal(titleScreenEnv.define('SPECIES_CHARIZARD'), 0);
        DeactivateSlashSprite(data[tSlashSpriteId]);
        data[2] = 0;
        data[tState]++;
      }
      break;
    case 1:
      if (data[2] < 90) data[2]++;
      else if (!IsSlashSpriteDeactivated(data[tSlashSpriteId])) {
        BeginNormalPaletteFade((PALETTES_ALL & ~(1 << 0x1c) & ~(1 << 0x1d) & ~(1 << 0x1e) & ~(1 << 0x1f)) >>> 0, 0, 0, 16, RGB_WHITE);
        SignalEndTitleScreenPaletteSomethingTask();
        FadeOutBGM(4);
        data[tState]++;
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        // SeedRngAndSetTrainerId: the port seeds its RNG at load (and the new game picks the trainer id).
        // SetSaveBlocksPointers, ResetMenuAndMonGlobals, Save_ResetSaveCounters: nothing to reset here.
        titleScreenEnv.loadGameSave(); // LoadGameSave(SAVE_NORMAL) (+ Sav2_ClearSetDefault)
        // SetPokemonCryStereo, InitHeap: no audio, no heap
        SetMainCallback2(CB2_InitMainMenu);
        DestroyTask(FindTaskIdByFunc(Task_TitleScreenMain));
      }
      break;
  }
}

const sSceneFuncs: ((data: Int16Array) => void)[] = [];
sSceneFuncs[TITLESCREENSCENE_INIT] = SetTitleScreenScene_Init;
sSceneFuncs[TITLESCREENSCENE_FLASHSPRITE] = SetTitleScreenScene_FlashSprite;
sSceneFuncs[TITLESCREENSCENE_FADEIN] = SetTitleScreenScene_FadeIn;
sSceneFuncs[TITLESCREENSCENE_RUN] = SetTitleScreenScene_Run;
sSceneFuncs[TITLESCREENSCENE_RESTART] = SetTitleScreenScene_Restart;
sSceneFuncs[TITLESCREENSCENE_CRY] = SetTitleScreenScene_Cry;

const Task_TitleScreen_SlideWin0: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_ALL);
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, DISPLAY_HEIGHT));
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, 0));
      BlendPalettes(1 << 0xe, 0, RGB_BLACK);
      data[0]++;
      break;
    case 1:
      data[1] += 24 << 4;
      data[2] = data[1] >> 4;
      if (data[2] >= DISPLAY_WIDTH) {
        data[2] = DISPLAY_WIDTH;
        data[0]++;
      }
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, data[2]));
      break;
    case 2:
      data[3]++;
      if (data[3] >= 10) {
        data[3] = 0;
        data[0]++;
      }
      break;
    case 3:
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(DISPLAY_WIDTH, DISPLAY_WIDTH));
      ChangeBgX(2, -0xf000, 0);
      BlendPalettes(1 << 0xf, 0, RGB_BLACK);
      data[1] = (10 * 24) << 4;
      data[0]++;
      break;
    case 4:
      data[1] -= 24 << 4;
      data[2] = data[1] >> 4;
      if (data[2] <= 0) {
        data[2] = 0;
        data[0]++;
      }
      ChangeBgX(2, -data[2] << 8, 0);
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(data[2], DISPLAY_WIDTH));
      break;
    case 5:
      ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      DestroyTask(taskId);
      break;
  }
};

const Task_TitleScreen_BlinkPressStart: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[15] && gPaletteFade.active) data[14] = 1;
  if (data[14] && !gPaletteFade.active) {
    DestroyTask(taskId);
  } else {
    data[2] = !data[1] ? 60 : 30;
    data[0]++;
    if (data[0] >= data[2]) {
      data[0] = 0;
      data[1] ^= 1;
      const pals = gfx16('gGraphics_TitleScreen_BackgroundPals');
      for (let i = 0; i < 5; i++) {
        const c = data[1] ? pals[6] : pals[1 + i];
        gPlttBufferUnfaded[BG_PLTT_ID(15) + 1 + i] = c;
        gPlttBufferFaded[BG_PLTT_ID(15) + 1 + i] = c;
      }
      if (data[14]) BlendPalettes(0x00008000, gPaletteFade.y, gPaletteFade.blendColor);
    }
  }
};

function SignalEndTitleScreenPaletteSomethingTask(): void {
  const taskId = FindTaskIdByFunc(Task_TitleScreen_BlinkPressStart);
  // (the C writes gTasks[TASK_NONE] when the task is gone; there is no such slot here)
  if (taskId !== TASK_NONE) gTasks[taskId].data[15] = 1;
}

function UpdateScanlineEffectRegBuffer(y: number): void {
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  if (y >= 0) buf[y] = 16;
  for (let i = 0; i < 16; i++) {
    if (y + i >= 0) buf[y + i] = 15 - i;
    if (y - i >= 0) buf[y - i] = 15 - i;
  }
  for (let i = y + 16; i < 160; i++) if (i >= 0) buf[i] = 0;
  for (let i = y - 16; i >= 0; i--) buf[i] = 0;
}

function ScheduleStopScanlineEffect(): void {
  if (gScanlineEffect.state) gScanlineEffect.state = 3;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
}

function LoadMainTitleScreenPalsAndResetBgs(): void {
  const taskId = FindTaskIdByFunc(Task_TitleScreen_SlideWin0);
  if (taskId !== TASK_NONE) DestroyTask(taskId);
  DestroyBlendPalettesGraduallyTask();
  ResetPaletteFadeControl();
  LoadPalette(gfx16('gGraphics_TitleScreen_GameTitleLogoPals'), BG_PLTT_ID(0), 13 * PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gGraphics_TitleScreen_BoxArtMonPals'), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gGraphics_TitleScreen_BackgroundPals'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gGraphics_TitleScreen_BackgroundPals'), BG_PLTT_ID(14), PLTT_SIZE_4BPP);
  ResetBgPositions();
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON | DISPCNT_OBJWIN_ON);
  ShowBg(1);
  ShowBg(2);
  ShowBg(0);
  ShowBg(3);
}

function CB2_FadeOutTransitionToSaveClearScreen(): void {
  if (!UpdatePaletteFade()) titleScreenEnv.saveClearScreenInit(); // SetMainCallback2(CB2_SaveClearScreen_Init)
}

function LoadSpriteGfxAndPals(): void {
  for (const sheet of sSpriteSheets()) LoadSpriteSheet(sheet);
  for (const pal of sSpritePals()) LoadSpritePalette(pal);
}

// ------------------------------------------------------------------ flames

// sprite data
const sPosX = 0;
const sSpeedX = 1;
const sPosY = 2;
const sSpeedY = 3;

function SpriteCallback_TitleScreenFlame(sprite: Sprite): void {
  const data = sprite.data;
  data[sPosX] -= data[sSpeedX];
  sprite.x = data[sPosX] >> 4;
  if (sprite.x < -8) {
    DestroySprite(sprite);
    return;
  }
  data[sPosY] += data[sSpeedY];
  sprite.y = data[sPosY] >> 4;
  if (sprite.y < 16 || sprite.y > 200) {
    DestroySprite(sprite);
    return;
  }
  if (sprite.animEnded) {
    DestroySprite(sprite);
    return;
  }
  if (data[7] !== 0 && --data[7] === 0) {
    StartSpriteAnim(sprite, 0);
    sprite.invisible = false;
  }
}

function CreateFlameSprite(x: number, y: number, xspeed: number, yspeed: number, createFlame: boolean): boolean {
  const spriteId = CreateSprite(createFlame ? sSpriteTemplate_FlameOrLeaf : sSpriteTemplate_BlankFlame, x, y, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.data[sPosX] = x * 16;
    s.data[sSpeedX] = xspeed;
    s.data[sPosY] = y * 16;
    s.data[sSpeedY] = yspeed;
    s.data[4] = 0;
    s.data[5] = (xspeed * yspeed) % 16;
    s.data[6] = createFlame ? 1 : 0;
    s.callback = SpriteCallback_TitleScreenFlame;
    return true;
  }
  return false;
}

// Task_FlameSpawner's data
const tSpawnState = 0;
const tTimer = 1;
const tDelay = 2;
const tOff_Seed = 3; // data[3] and data[4]
const tOffsetX = 5;

const Task_FlameSpawner: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (data[tSpawnState]) {
    case 0:
      TitleScreen_srand(taskId, tOff_Seed, 30840);
      data[tSpawnState]++;
      break;
    case 1:
      data[tTimer]++;
      if (data[tTimer] >= data[tDelay]) {
        data[tTimer] = 0;
        TitleScreen_rand(taskId, tOff_Seed);
        data[tDelay] = 18;
        let xspeed = (TitleScreen_rand(taskId, tOff_Seed) % 4) - 2;
        let yspeed = (TitleScreen_rand(taskId, tOff_Seed) % 8) - 16;
        const y = (TitleScreen_rand(taskId, tOff_Seed) % 3) + 116;
        const x = TitleScreen_rand(taskId, tOff_Seed) % DISPLAY_WIDTH;
        CreateFlameSprite(x, y, xspeed, yspeed, TitleScreen_rand(taskId, tOff_Seed) % 16 < 8 ? false : true);
        for (let i = 0; i < 15; i++) {
          CreateFlameSprite(data[tOffsetX] + sFlameXPositions[i], y, xspeed, yspeed, true);
          xspeed = (TitleScreen_rand(taskId, tOff_Seed) % 4) - 2;
          yspeed = (TitleScreen_rand(taskId, tOff_Seed) % 8) - 16;
        }
        data[tOffsetX]++;
        if (data[tOffsetX] > 3) data[tOffsetX] = 0;
      }
  }
};

function TitleScreen_srand(taskId: number, field: number, seed: number): void {
  SetWordTaskArg(taskId, field, seed);
}

/** TitleScreen_rand: ISO_RANDOMIZE1 on the task's own seed, upper 16 bits. */
function TitleScreen_rand(taskId: number, field: number): number {
  let rngval = GetWordTaskArg(taskId, field);
  rngval = (Math.imul(1103515245, rngval) + 24691) >>> 0;
  SetWordTaskArg(taskId, field, rngval);
  return rngval >>> 16;
}

// ------------------------------------------------------------------ blank sprite, slash

function CreateBlankSprite(): number {
  CreateSprite(sSpriteTemplate_BlankSprite, 24, 144, 0);
  return IndexOfSpritePaletteTag(PAL_TAG_SLASH);
}

function SetPalOnOrCreateBlankSprite(hasCreatedBlankSprite: boolean): void {
  if (hasCreatedBlankSprite) {
    const palIdx = IndexOfSpritePaletteTag(PAL_TAG_SLASH);
    LoadPalette(gfx16('gTitleScreen_Slash_Pal'), OBJ_PLTT_ID(palIdx), PLTT_SIZE_4BPP);
  } else {
    CreateBlankSprite();
  }
}

// slash sprite data
const sState = 0;
const sTimer = 1;
const sDeactivate = 2;

function CreateSlashSprite(): number {
  const spriteId = CreateSprite(sSlashSpriteTemplate, -32, 27, 1);
  if (spriteId !== MAX_SPRITES) {
    gSprites[spriteId].callback = SpriteCallback_Slash;
    gSprites[spriteId].data[sTimer] = 540;
  }
  return spriteId;
}

function DeactivateSlashSprite(spriteId: number): void {
  if (spriteId !== MAX_SPRITES) gSprites[spriteId].data[sDeactivate] = 1;
}

/** IsSlashSpriteDeactivated: (sic) TRUE while the slash is still active (sState != 2). */
function IsSlashSpriteDeactivated(spriteId: number): boolean {
  if (spriteId !== MAX_SPRITES) return (gSprites[spriteId].data[sState] ^ 2) !== 0;
  return false;
}

function SpriteCallback_Slash(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sState]) {
    case 0:
      if (data[sDeactivate]) {
        sprite.invisible = true;
        data[sState] = 2;
      }
      data[sTimer]--;
      if (data[sTimer] === 0) {
        sprite.invisible = false;
        data[sState] = 1;
      }
      break;
    case 1:
      sprite.x += 9;
      if (sprite.x === 67) sprite.y -= 7;
      if (sprite.x === 148) sprite.y += 7;
      if (sprite.x > DISPLAY_WIDTH + 32) {
        sprite.invisible = true;
        if (data[sDeactivate]) {
          data[sState] = 2;
        } else {
          sprite.x = -32;
          data[sTimer] = 540;
          data[sState] = 0;
        }
      }
      break;
    case 2:
      break;
  }
}

/** Dev: the title screen's state for the e2e tests (undefined when its main task isn't running). */
export function titleScreenProbe(): { scene: string; state: number; timer: number | undefined; pressStartShown: boolean; flames: number } | undefined {
  const task = gTasks.find((t) => t.isActive && t.func === Task_TitleScreenMain);
  if (!task) return undefined;
  const blink = gTasks.find((t) => t.isActive && t.func === Task_TitleScreen_BlinkPressStart);
  return {
    scene: SCENE_NAMES[task.data[tSceneNum]],
    state: task.data[tState],
    timer: sTitleScreenTimerTaskId !== TASK_NONE ? gTasks[sTitleScreenTimerTaskId].data[0] : undefined,
    pressStartShown: !!blink && !blink.data[1],
    flames: gSprites.filter((s) => s.inUse && s.callback === SpriteCallback_TitleScreenFlame).length,
  };
}
