// intro.c (FireRed): the copyright screen and the intro movie in front of the title screen. The copyright screen
// (CB2_InitCopyrightScreenAfterBootup at boot, CB2_InitCopyrightScreenAfterTitleScreen when the title screen's timer
// runs out) fades in from white, holds, fades to black and hands to CB2_SetUpIntro. The movie is one task
// (Task_CallIntroCallback) calling an IntroCallback, each a little state machine that SetIntroCB replaces with the
// next: IntroCB_Init → the Game Freak scene (IntroCB_GF_OpenWindow / _Star / _RevealName / _RevealLogo) → scene 1
// (the grass) → scene 2 (the forest, Gengar and Nidorino) → scene 3 (the fight) → IntroCB_ExitToTitleScreen.
// A / START / SELECT anywhere in the movie skip to IntroCB_ExitToTitleScreen. A host scene (scenes/MainMenuScene.ts)
// fills in `introEnv` and runs CB2_InitCopyrightScreenAfterBootup.

import {
  BG_COORD_ADD,
  BG_COORD_SET,
  BG_COORD_SUB,
  ChangeBgX,
  ChangeBgY,
  FillBgTilemapBufferRect,
  GetBgX,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_OBJ,
  BLDCNT_TGT2_ALL,
  ClearGpuRegBits,
  DISPCNT_BG0_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTES_ALL,
  PALETTES_OBJECTS,
  pltt,
  PLTT_SIZE,
  REG_OFFSET_BG0CNT,
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
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  vram,
  WIN_RANGE,
  WININ_WIN0_BG0,
  WININ_WIN0_BG1,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
} from '../gba/hw';
import { A_BUTTON, gMain, JOY_NEW, R_BUTTON, SELECT_BUTTON, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, START_BUTTON } from '../gba/main';
import { DecompressAndCopyTileDataToVram, FreeTempTileDataBuffersIfPossible, ResetBgPositions, ResetTempTileDataBuffers } from '../gba/menu';
import { IsBlendTaskActive, StartBlendTask } from '../gba/menu2';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalettes,
  FillPalette,
  gPaletteFade,
  gPlttBufferUnfaded,
  LoadPalette,
  PLTT_SIZE_4BPP,
  ResetPaletteFade,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { m4aSongNumStart, PlayCry_ByMode, PlaySE, SOUND_CONSTANTS } from '../gba/sound';
import { SetPokemonCryStereo } from '../audio/m4a';
import {
  AFFINEANIMCMD_END,
  AFFINEANIMCMD_FRAME,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
  CalcCenterToCornerVec,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SetSpriteMatrixAnchor,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_OBJ_BLEND,
  ST_OAM_V_RECTANGLE,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, FuncIsActiveTask, ResetTasks, RunTasks, type TaskFunc, gTasks } from '../gba/task';
import { BlitBitmapToWindow, COPYWIN_FULL, COPYWIN_GFX, CopyWindowToVram, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, InitWindows, PIXEL_FILL, PutWindowTilemap, type WindowTemplate } from '../gba/window';
import { testEvent } from '../dev/testHooks';
import { CB2_InitTitleScreen } from './titleScreen';

/** What the intro reads from outside intro.c. */
export const introEnv = {
  /** A decomp constant (MUS_*). */
  define: (_name: string): number => 0,
  /**
   * CB2_InitCopyrightScreenAfterBootup's save handling once the copyright screen has faded out: LoadGameSave
   * (SAVE_NORMAL), and Sav2_ClearSetDefault for an empty or unreadable slot.
   */
  loadGameSave: (): void => {},
  /** gSaveBlock2Ptr->optionsSound of the save loadGameSave read. */
  savedOptionsSound: (): number => 0,
  /** gSineTable (trig.c), 256 steps per turn plus a quarter, Q8.8. */
  sineTable: [] as ArrayLike<number>,
};

/** The project follows REVISION 0 (FireRed 1.0); see tools/extract.py's BUILD_SYMBOLS. */
const REVISION: number = 0;

/** RGB_WHITEALPHA: white with the alpha bit, which gPaletteFade.blendColor (15 bits) drops. */
const RGB_WHITEALPHA = RGB_WHITE | 0x8000;

const WININ_WIN1_ALL = WININ_WIN1_BG_ALL | WININ_WIN1_OBJ | WININ_WIN1_CLR;

// ------------------------------------------------------------------ tags, BG ids

const GFXTAG_STAR = 0;
const GFXTAG_SPARKLES_SMALL = 1;
const GFXTAG_SPARKLES_BIG = 2;
const GFXTAG_GF_LOGO = 3;
const GFXTAG_PRESENTS = 4;
export const GFXTAG_SCENE3_NIDORINO = 5;
export const GFXTAG_SCENE2_GENGAR = 6;
export const GFXTAG_SCENE2_NIDORINO = 7;
export const GFXTAG_SCENE3_GRASS = 8;
export const GFXTAG_SCENE3_GENGAR = 9;
export const GFXTAG_SCENE3_SWIPE = 10;
export const GFXTAG_SCENE3_RECOIL_DUST = 11;

const PALTAG_STAR = 0;
const PALTAG_SPARKLES = 1;
const PALTAG_GF = 3;
export const PALTAG_GENGAR = 6;
export const PALTAG_NIDORINO = 7;
export const PALTAG_SCENE3_GRASS = 8;
export const PALTAG_SCENE3_SWIPE = 10;
export const PALTAG_SCENE3_RECOIL_DUST = 11;

// Background ids for the Game Freak scene
const BG_GF_TEXT_LOGO = 2;
const BG_GF_BACKGROUND = 3;

const ANIM_SPARKLE_LOOP = 0;
const ANIM_SPARKLE_ONCE = 1;

const WIN_GF_TEXT_LOGO = 0;

// ------------------------------------------------------------------ IntroSequenceData

export type IntroCallback = (ptr: IntroSequenceData) => void;

/** struct IntroSequenceData (Alloc'd by StartIntroSequence, freed by IntroCB_ExitToTitleScreen). */
export interface IntroSequenceData {
  callback: IntroCallback;
  state: number;
  taskId: number;
  gengarAttackLanded: boolean;
  /** [0] and [1] are set but never read, the rest are unused. */
  data: Uint16Array;
  timer: number;
  gameFreakLogoArtSprite: Sprite | null;
  scene3NidorinoSprite: Sprite | null;
  scene2GengarSprite: Sprite | null;
  scene2NidorinoSprite: Sprite | null;
  scene3GrassSprite: Sprite | null;
  scene3GengarSprites: (Sprite | null)[];
  /** gameFreakLogoGfx / gameFreakTextGfx: LZ77UnCompWram'd copies of sGameFreakLogo_Gfx / sGameFreakText_Gfx. */
  gameFreakLogoGfx: Uint8Array;
  gameFreakTextGfx: Uint8Array;
}

/**
 * The IntroSequenceData Task_CallIntroCallback runs: StartIntroSequence stores its pointer in the task's
 * data[0..1] (SetWordTaskArg); here it's this module's variable.
 */
let sIntro: IntroSequenceData | null = null;

// ------------------------------------------------------------------ data

/** Graphics intro.c INCBINs (graphics/intro/), preloaded by the host. */
export const introGfxSymbols = (): string[] => [
  'sCopyright_Pal',
  'sCopyright_Gfx',
  'sCopyright_Map',
  'sGameFreakBg_Pal',
  'sGameFreakBg_Gfx',
  'sGameFreakBg_Map',
  'sGameFreakLogo_Pal',
  'sGameFreakText_Gfx',
  'sGameFreakLogo_Gfx',
  'sStar_Pal',
  'sStar_Gfx',
  'sSparkles_Pal',
  'sSparklesSmall_Gfx',
  'sSparklesBig_Gfx',
  'sPresents_Gfx',
  // scenes 1-3
  'sScene1_Grass_Pal',
  'sScene1_Grass_Gfx',
  'sScene1_Grass_Map',
  'sScene1_Bg_Pal',
  'sScene1_Bg_Gfx',
  'sScene1_Bg_Map',
  'sScene2_Bg_Pal',
  'sScene2_Bg_Gfx',
  'sScene2_Bg_Map',
  'sScene2_Plants_Gfx',
  'sScene2_Plants_Map',
  'sGengar_Pal',
  'sScene2_GengarClose_Gfx',
  'sScene2_GengarClose_Map',
  'sScene2_NidorinoClose_Pal',
  'sScene2_NidorinoClose_Gfx',
  'sScene2_NidorinoClose_Map',
  'sScene3_Bg_Pal',
  'sScene3_Bg_Gfx',
  'sScene3_Bg_Map',
  'sScene3_GengarAnim_Gfx',
  'sScene3_GengarAnim_Map',
  'sScene2_Gengar_Gfx',
  'sNidorino_Pal',
  'sScene2_Nidorino_Gfx',
  'sScene3_Grass_Pal',
  'sScene3_Grass_Gfx',
  'sScene3_GengarStatic_Gfx',
  'sScene3_Nidorino_Gfx',
  'sScene3_Swipe_Pal',
  'sScene3_RecoilDust_Pal',
  'sScene3_Swipe_Gfx',
  'sScene3_RecoilDust_Gfx',
];

const sBgTemplates_GameFreakScene: BgTemplate[] = [
  { bg: BG_GF_BACKGROUND, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
  { bg: BG_GF_TEXT_LOGO, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x010 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: BG_GF_TEXT_LOGO, tilemapLeft: 6, tilemapTop: 4, width: 18, height: 9, paletteNum: 13, baseBlock: 0x000 },
  DUMMY_WIN_TEMPLATE,
];

const sSpriteSheets_GameFreakScene = () => [
  { data: gfx('sStar_Gfx'), size: 0x80, tag: GFXTAG_STAR },
  { data: gfx('sSparklesSmall_Gfx'), size: 0x80, tag: GFXTAG_SPARKLES_SMALL },
  { data: gfx('sSparklesBig_Gfx'), size: 0x800, tag: GFXTAG_SPARKLES_BIG },
  { data: gfx('sGameFreakLogo_Gfx'), size: 0x400, tag: GFXTAG_GF_LOGO },
  { data: gfx('sPresents_Gfx'), size: 0x100, tag: GFXTAG_PRESENTS },
];

const sSpritePalettes_GameFreakScene = () => [
  { data: gfx16('sStar_Pal'), tag: PALTAG_STAR },
  { data: gfx16('sSparkles_Pal'), tag: PALTAG_SPARKLES },
  { data: gfx16('sGameFreakLogo_Pal'), tag: PALTAG_GF },
];

const sTextSparkleCoords = [
  { x: 72, y: 80 },
  { x: 136, y: 74 },
  { x: 168, y: 80 },
  { x: 120, y: 80 },
  { x: 104, y: 86 },
  { x: 88, y: 74 },
  { x: 184, y: 74 },
  { x: 56, y: 86 },
  { x: 152, y: 86 },
];

const sOam_Star = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 2 });
const sOam_SparklesSmall = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], priority: 2 });

const sAnim_SparklesSmall_Loop = [ANIMCMD_FRAME(0, 4), ANIMCMD_FRAME(1, 4), ANIMCMD_FRAME(2, 4), ANIMCMD_FRAME(3, 4), ANIMCMD_JUMP(0)];
const sAnim_SparklesSmall_Once = [ANIMCMD_FRAME(0, 4), ANIMCMD_FRAME(1, 4), ANIMCMD_FRAME(2, 4), ANIMCMD_FRAME(3, 4), ANIMCMD_END];
const sAnims_SparklesSmall = [sAnim_SparklesSmall_Loop, sAnim_SparklesSmall_Once];

const sSpriteTemplate_Star: SpriteTemplate = {
  tileTag: GFXTAG_STAR,
  paletteTag: PALTAG_STAR,
  oam: sOam_Star,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (s) => SpriteCB_Star(s),
};

const sSpriteTemplate_SparklesSmall: SpriteTemplate = {
  tileTag: GFXTAG_SPARKLES_SMALL,
  paletteTag: PALTAG_SPARKLES,
  oam: sOam_SparklesSmall,
  anims: sAnims_SparklesSmall,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (s) => SpriteCB_SparklesSmall_Star(s),
};

const sOam_SparklesBig = oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 2 });
const sAnim_SparklesBig = [ANIMCMD_FRAME(0, 8), ANIMCMD_FRAME(16, 8), ANIMCMD_FRAME(32, 8), ANIMCMD_FRAME(48, 8), ANIMCMD_END];

const sSpriteTemplate_SparklesBig: SpriteTemplate = {
  tileTag: GFXTAG_SPARKLES_BIG,
  paletteTag: PALTAG_SPARKLES,
  oam: sOam_SparklesBig,
  anims: [sAnim_SparklesBig],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (s) => SpriteCB_SparklesBig(s),
};

const sOam_GameFreakLogo = oam({ objMode: ST_OAM_OBJ_BLEND, shape: SPRITE_SHAPE['32x64'][0], size: SPRITE_SHAPE['32x64'][1], priority: 3 });

const sSpriteTemplate_GameFreakLogoArt: SpriteTemplate = {
  tileTag: GFXTAG_GF_LOGO,
  paletteTag: PALTAG_GF,
  oam: sOam_GameFreakLogo,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sOam_PresentsText = oam({ objMode: ST_OAM_OBJ_BLEND, shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1], priority: 3 });

const sSpriteTemplate_Presents: SpriteTemplate = {
  tileTag: GFXTAG_PRESENTS,
  paletteTag: PALTAG_GF,
  oam: sOam_PresentsText,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sFightSceneSpriteSheets: scenes 2 and 3's sprites. */
const sFightSceneSpriteSheets = () => [
  { data: gfx('sScene2_Gengar_Gfx'), size: 0x800, tag: GFXTAG_SCENE2_GENGAR },
  { data: gfx('sScene2_Nidorino_Gfx'), size: 0x800, tag: GFXTAG_SCENE2_NIDORINO },
  { data: gfx('sScene3_Nidorino_Gfx'), size: 0x2800, tag: GFXTAG_SCENE3_NIDORINO },
  { data: gfx('sScene3_Grass_Gfx'), size: 0x800, tag: GFXTAG_SCENE3_GRASS },
  { data: gfx('sScene3_GengarStatic_Gfx'), size: 0x1800, tag: GFXTAG_SCENE3_GENGAR },
  { data: gfx('sScene3_Swipe_Gfx'), size: 0xa00, tag: GFXTAG_SCENE3_SWIPE },
  { data: gfx('sScene3_RecoilDust_Gfx'), size: 0x200, tag: GFXTAG_SCENE3_RECOIL_DUST },
];

/**
 * sFightSceneSpritePalettes. Without BUGFIX the C array has no {0} terminator, so LoadSpritePalettes reads on into
 * the next .rodata until it meets a zero tag word; only these five are loaded here.
 */
const sFightSceneSpritePalettes = () => [
  { data: gfx16('sGengar_Pal'), tag: PALTAG_GENGAR },
  { data: gfx16('sNidorino_Pal'), tag: PALTAG_NIDORINO },
  { data: gfx16('sScene3_Grass_Pal'), tag: PALTAG_SCENE3_GRASS },
  { data: gfx16('sScene3_Swipe_Pal'), tag: PALTAG_SCENE3_SWIPE },
  { data: gfx16('sScene3_RecoilDust_Pal'), tag: PALTAG_SCENE3_RECOIL_DUST },
];

// ------------------------------------------------------------------ the copyright screen

function VBlankCB_Copyright(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_WaitFadeBeforeSetUpIntro(): void {
  if (!UpdatePaletteFade()) SetMainCallback2(CB2_SetUpIntro);
}

/** LoadCopyrightGraphics: straight into BG VRAM and the palette (the data is stored decompressed). */
function LoadCopyrightGraphics(charBase: number, screenBase: number, palOffset: number): void {
  vram.set(gfx('sCopyright_Gfx'), charBase);
  vram.set(gfx('sCopyright_Map'), screenBase);
  const pal = gfx16('sCopyright_Pal');
  LoadPalette(pal, palOffset, pal.length * 2);
}

const BG_CHAR_SIZE = 0x4000;
const BG_SCREEN_SIZE = 0x800;
/** BGCNT_PRIORITY(0) | BGCNT_CHARBASE(0) | BGCNT_16COLOR | BGCNT_SCREENBASE(7) */
const COPYRIGHT_BG0CNT = (0 << 0) | (0 << 2) | (0 << 7) | (7 << 8);

/**
 * SetUpCopyrightScreen: 140 frames fading in from white (REVISION 0; black from 0xA) and holding, then a fade to
 * black. FALSE once, the frame the fade-out ends. The GameCube multiboot (sGcmb: Pokémon Colosseum's link over the
 * GBA cable, SerialCB_CopyrightScreen) isn't ported: no GameCube ever answers, so gcmb_field_2 stays 0.
 */
function SetUpCopyrightScreen(): boolean {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      // "Fade from white" is pure black from REVISION 0xA
      pltt[0] = REVISION >= 0xa ? RGB_BLACK : RGB_WHITE;
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      SetGpuReg(REG_OFFSET_BG0HOFS, 0);
      SetGpuReg(REG_OFFSET_BG0VOFS, 0);
      vram.fill(0); // DmaFill16(3, 0, VRAM, VRAM_SIZE); DmaFill32 OAM: ResetSpriteData below
      pltt.fill(0, 1); // DmaFill16(3, 0, PLTT + 2, PLTT_SIZE - 2)
      ResetPaletteFade();
      LoadCopyrightGraphics(0 * BG_CHAR_SIZE, 7 * BG_SCREEN_SIZE, BG_PLTT_ID(0));
      ScanlineEffect_Stop();
      ResetTasks();
      ResetSpriteData();
      FreeAllSpritePalettes();
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, REVISION >= 0xa ? RGB_BLACK : RGB_WHITEALPHA);
      SetGpuReg(REG_OFFSET_BG0CNT, COPYRIGHT_BG0CNT);
      SetVBlankCallback(VBlankCB_Copyright);
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON);
      // SetSerialCallback(SerialCB_CopyrightScreen), GameCubeMultiBoot_Init: no GameCube
      testEvent('copyrightScreen', { cb2: gMain.callback2?.name }); // after bootup or after the title screen
    // fallthrough
    default:
      UpdatePaletteFade();
      gMain.state++;
      // GameCubeMultiBoot_Main
      break;
    case 140:
      // GameCubeMultiBoot_Main; gcmb_field_2 is 0 (no GameCube), not 1 (one is talking)
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      gMain.state++;
      break;
    case 141:
      if (!UpdatePaletteFade()) {
        gMain.state++;
        // gcmb_field_2 == 0: GameCubeMultiBoot_Quit, SetSerialCallback(SerialCB). (2 would run Colosseum's
        // multiboot program.)
        return false;
      }
      break;
    case 142:
      // ResetSerial
      SetMainCallback2(CB2_WaitFadeBeforeSetUpIntro);
      break;
  }
  return true;
}

/** CB2_InitCopyrightScreenAfterBootup: the game's first screen; loads the save once the copyright fades out. */
export function CB2_InitCopyrightScreenAfterBootup(): void {
  if (!SetUpCopyrightScreen()) {
    // ResetMenuAndMonGlobals, Save_ResetSaveCounters: nothing to reset here
    introEnv.loadGameSave(); // LoadGameSave(SAVE_NORMAL) (+ Sav2_ClearSetDefault for an empty or invalid slot)
    SetPokemonCryStereo(introEnv.savedOptionsSound());
  }
}

/** CB2_InitCopyrightScreenAfterTitleScreen: the title screen's timer ran out. */
export function CB2_InitCopyrightScreenAfterTitleScreen(): void {
  SetUpCopyrightScreen();
}

// ------------------------------------------------------------------ the intro's framework

function CB2_SetUpIntro(): void {
  switch (gMain.state) {
    default:
      gMain.state = 0;
    // fallthrough
    case 0:
      SetVBlankCallback(null);
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      // InitHeap: no heap
      ResetTasks();
      ResetSpriteData();
      ResetPaletteFade();
      ResetTempTileDataBuffers();
      Intro_ResetGpuRegs();
      vram.fill(0); // DmaFill16 VRAM; DmaFill32 OAM is ResetSpriteData's
      pltt.fill(0);
      FillPalette(RGB_BLACK, 0, PLTT_SIZE);
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates_GameFreakScene);
      break;
    case 1: {
      const bgPal = gfx16('sGameFreakBg_Pal');
      LoadPalette(bgPal, BG_PLTT_ID(0), bgPal.length * 2);
      DecompressAndCopyTileDataToVram(BG_GF_BACKGROUND, gfx('sGameFreakBg_Gfx'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(BG_GF_BACKGROUND, gfx('sGameFreakBg_Map'), 0, 0, 1);
      const logoPal = gfx16('sGameFreakLogo_Pal');
      LoadPalette(logoPal, BG_PLTT_ID(13), logoPal.length * 2);
      break;
    }
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        StartIntroSequence();
        BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
        SetMainCallback2(CB2_Intro);
        SetVBlankCallback(VBlankCB_Intro);
      }
      return;
  }
  gMain.state++;
}

function CB2_Intro(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** VBlankCB_Intro (scenes 1 and 3 turn it off while they load) */
export function VBlankCB_Intro(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function Intro_ResetGpuRegs(): void {
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
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
}

function StartIntroSequence(): void {
  const ptr: IntroSequenceData = {
    callback: IntroCB_Init,
    state: 0,
    taskId: 0,
    gengarAttackLanded: false,
    data: new Uint16Array(5),
    timer: 0,
    gameFreakLogoArtSprite: null,
    scene3NidorinoSprite: null,
    scene2GengarSprite: null,
    scene2NidorinoSprite: null,
    scene3GrassSprite: null,
    scene3GengarSprites: [null, null, null, null],
    gameFreakLogoGfx: new Uint8Array(0x400),
    gameFreakTextGfx: new Uint8Array(0x400),
  };
  SetIntroCB(ptr, IntroCB_Init);
  ptr.taskId = CreateTask(Task_CallIntroCallback, 3);
  sIntro = ptr; // SetWordTaskArg(ptr->taskId, 0, (uintptr_t)ptr)
}

/** SetIntroCB: the next callback, from its state 0. */
export function SetIntroCB(ptr: IntroSequenceData, cb: IntroCallback): void {
  ptr.callback = cb;
  ptr.state = 0;
  testEvent('introCB', { cb: cb.name });
}

const Task_CallIntroCallback: TaskFunc = () => {
  const ptr = sIntro!;
  // End the intro early if the player presses A / START / SELECT
  if (JOY_NEW(A_BUTTON | START_BUTTON | SELECT_BUTTON) && ptr.callback !== IntroCB_ExitToTitleScreen) SetIntroCB(ptr, IntroCB_ExitToTitleScreen);
  ptr.callback(ptr);
};

function IntroCB_Init(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      InitWindows(sWindowTemplates);
      // LZ77UnCompWram into the 0x400-byte buffers (the 0x480-byte text overruns into unused1 in the C)
      ptr.gameFreakTextGfx = gfx('sGameFreakText_Gfx').slice();
      ptr.gameFreakLogoGfx = gfx('sGameFreakLogo_Gfx').slice();
      FillBgTilemapBufferRect(BG_GF_TEXT_LOGO, 0x000, 0, 0, 32, 32, 17);
      FillWindowPixelBuffer(WIN_GF_TEXT_LOGO, PIXEL_FILL(0));
      BlitBitmapToWindow(WIN_GF_TEXT_LOGO, ptr.gameFreakTextGfx, 0, 40, 144, 16);
      PutWindowTilemap(WIN_GF_TEXT_LOGO);
      CopyWindowToVram(WIN_GF_TEXT_LOGO, COPYWIN_FULL);
      ptr.state++;
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) SetIntroCB(ptr, IntroCB_GF_OpenWindow);
      break;
  }
}

/** LoadFightSceneSpriteGraphics: scenes 2 and 3's sprite sheets and palettes (IntroCB_Scene1 loads them). */
export function LoadFightSceneSpriteGraphics(): void {
  for (const sheet of sFightSceneSpriteSheets()) LoadCompressedSpriteSheet(sheet);
  for (const pal of sFightSceneSpritePalettes()) LoadSpritePalette(pal); // LoadSpritePalettes
}

/** IntroCB_ExitToTitleScreen: the movie's end, or a skip. */
function IntroCB_ExitToTitleScreen(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      FillPalette(RGB_BLACK, 0, PLTT_SIZE);
      ptr.state++;
      break;
    case 1:
      if (!FreeTempTileDataBuffersIfPossible()) {
        DestroyTask(ptr.taskId);
        sIntro = null; // Free(this)
        // DisableInterrupts(INTR_FLAG_HBLANK)
        SetHBlankCallback(null);
        SetMainCallback2(CB2_InitTitleScreen);
      }
      break;
  }
}

// ------------------------------------------------------------------ the Game Freak scene

function IntroCB_GF_OpenWindow(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN1_ON);
      SetGpuReg(REG_OFFSET_WININ, WININ_WIN1_ALL);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_WIN1H, DISPLAY_WIDTH);
      SetGpuReg(REG_OFFSET_WIN1V, 0);
      ptr.timer = 0;
      ptr.state++;
      break;
    case 1:
      ShowBg(BG_GF_BACKGROUND);
      BlendPalettes(PALETTES_ALL, 0, RGB_BLACK);
      ptr.state++;
      break;
    case 2:
      // Extend the window both ways from the middle until it's a narrow "theatric" view
      ptr.timer += 8;
      if (ptr.timer >= 48) ptr.timer = 48;
      SetGpuReg(REG_OFFSET_WIN1V, WIN_RANGE(DISPLAY_HEIGHT / 2 - ptr.timer, DISPLAY_HEIGHT / 2 + ptr.timer));
      if (ptr.timer === 48) SetIntroCB(ptr, IntroCB_GF_Star);
      break;
  }
}

function IntroCB_GF_Star(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      PlaySE(introEnv.define('MUS_GAME_FREAK'));
      GFScene_LoadGfxCreateStar();
      ptr.timer = 0;
      ptr.state++;
      break;
    case 1:
      if (++ptr.timer === 30) {
        GFScene_StartNameSparklesSmall();
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 2:
      ptr.timer++;
      if (ptr.timer === 90) SetIntroCB(ptr, IntroCB_GF_RevealName);
      break;
  }
}

function IntroCB_GF_RevealName(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      GFScene_StartNameSparklesBig();
      ptr.timer = 0;
      ptr.state++;
      break;
    case 1:
      if (++ptr.timer >= 40) ptr.state++;
      break;
    case 2:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      StartBlendTask(0, 16, 16, 0, 48, 0);
      ptr.state++;
      break;
    case 3:
      ShowBg(BG_GF_TEXT_LOGO);
      ptr.state++;
      break;
    case 4:
      if (!IsBlendTaskActive()) {
        SetGpuReg(REG_OFFSET_BLDCNT, 0);
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 5:
      if (++ptr.timer > 50) SetIntroCB(ptr, IntroCB_GF_RevealLogo);
      break;
  }
}

function IntroCB_GF_RevealLogo(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_OBJ | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      StartBlendTask(0, 16, 16, 0, 16, 0);
      ptr.data[0] = 0; // never read
      ptr.data[1] = 16; // never read
      ptr.timer = 0;
      ptr.state++;
      break;
    case 1:
      ptr.gameFreakLogoArtSprite = GFScene_CreateLogoSprite();
      ptr.state++;
      break;
    case 2:
      if (!IsBlendTaskActive()) {
        BlitBitmapToWindow(WIN_GF_TEXT_LOGO, ptr.gameFreakLogoGfx, 0x38, 0x06, 0x20, 0x40);
        BlitBitmapToWindow(WIN_GF_TEXT_LOGO, ptr.gameFreakTextGfx, 0x00, 0x28, 0x90, 0x10);
        CopyWindowToVram(WIN_GF_TEXT_LOGO, COPYWIN_GFX);
        ptr.state++;
      }
      break;
    case 3:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        DestroySprite(ptr.gameFreakLogoArtSprite!);
        // "presents" is REVISION 1's (FireRed 1.1)
        if (REVISION >= 1) GFScene_CreatePresentsSprite();
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 4:
      if (++ptr.timer > 90) {
        SetGpuRegBits(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2);
        StartBlendTask(16, 0, 0, 16, 20, 0);
        ptr.state++;
      }
      break;
    case 5:
      if (!IsBlendTaskActive()) {
        HideBg(BG_GF_TEXT_LOGO);
        ptr.state++;
      }
      break;
    case 6:
      ResetSpriteData();
      FreeAllSpritePalettes();
      ptr.timer = 0;
      ptr.state++;
      break;
    case 7:
      if (++ptr.timer > 20) {
        SetGpuReg(REG_OFFSET_BLDCNT, 0);
        SetIntroCB(ptr, IntroCB_Scene1);
      }
      break;
  }
}

// Sprite data for SpriteCB_Star
const sStar_BaseX = 0;
const sStar_BaseY = 1;
const sStar_SpeedX = 2;
const sStar_SpeedY = 3;
const sStar_SinIdx = 4;
const sStar_SparkleTimer = 5;
const sStar_SparkleRngSeed = 6; // data[6..7]

// EWRAM_DATA: kept across replays of the intro
let sStarSpeedX = 0;
let sStarSpeedY = 0;
let sStarSparklesXmodMask = 0;
let sStarSparklesSpawnRate = 0;
let sStarSparklesFlickerStartTime = 0;
let sStarSparklesDestroySpriteTime = 0;
const sStarSparklesGravityShift = 0; // never set: the trailing sparkles don't fall
let sStarSparklesXspeed = 0;
let sStarSparklesYspeed = 0;
let sStarSparklesXprecision = 0;
let sStarSparklesYprecision = 0;
let sStarSparklesRngSeed = 0;
let sYmod = 0;

function GFScene_LoadGfxCreateStar(): void {
  for (const sheet of sSpriteSheets_GameFreakScene()) LoadCompressedSpriteSheet(sheet);
  for (const pal of sSpritePalettes_GameFreakScene()) LoadSpritePalette(pal); // LoadSpritePalettes
  sStarSpeedX = 96;
  sStarSpeedY = 16;
  sStarSparklesXmodMask = 0x07;
  // sStarSparklesUnusedVar = 5: never read
  sStarSparklesSpawnRate = 8;
  sStarSparklesFlickerStartTime = 90;
  sStarSparklesDestroySpriteTime = 120;
  sStarSparklesXspeed = 1;
  sStarSparklesYspeed = 1;
  sStarSparklesXprecision = 5;
  sStarSparklesYprecision = 5;
  if (sStarSparklesRngSeed === 0) sStarSparklesRngSeed = 354128453;
  const spriteId = CreateSprite(sSpriteTemplate_Star, 248, 55, 0);
  if (spriteId !== MAX_SPRITES) {
    const data = gSprites[spriteId].data;
    data[sStar_BaseX] = 248 << 4;
    data[sStar_BaseY] = 55 << 4;
    data[sStar_SpeedX] = sStarSpeedX;
    data[sStar_SpeedY] = sStarSpeedY;
    StoreWordInTwoHalfwords(data, sStar_SparkleRngSeed, sStarSparklesRngSeed);
  }
}

function StoreWordInTwoHalfwords(data: Int16Array, i: number, word: number): void {
  data[i] = word & 0xffff;
  data[i + 1] = word >>> 16;
}

function LoadWordFromTwoHalfwords(data: Int16Array, i: number): number {
  return ((data[i] & 0xffff) | ((data[i + 1] & 0xffff) << 16)) >>> 0;
}

// Sprite data for SpriteCB_SparklesSmall_Star
const sSmSparkleStar_BaseX = 0;
const sSmSparkleStar_BaseY = 1;
const sSmSparkleStar_SpeedX = 2;
const sSmSparkleStar_SpeedY = 3;
const sSmSparkleStar_FallSpeed = 4;
const sSmSparkleStar_FallDist = 5;
const sSmSparkleStar_Timer = 7;

/** GFScene_CreateStarSparkle: a sparkle trailing the star, a few pixels behind it. */
function GFScene_CreateStarSparkle(x: number, y: number, random: number): void {
  const xMod = (random & sStarSparklesXmodMask) + 2;
  const yMod = sYmod;
  if (++sYmod > 3) sYmod = -3;
  x = (x + xMod) << 16 >> 16;
  y = (y + yMod) << 16 >> 16;
  if (x > 0 && x < DISPLAY_WIDTH) {
    const spriteId = CreateSprite(sSpriteTemplate_SparklesSmall, x, y, 1);
    if (spriteId !== MAX_SPRITES) {
      const data = gSprites[spriteId].data;
      data[sSmSparkleStar_BaseX] = x << sStarSparklesXprecision;
      data[sSmSparkleStar_BaseY] = y << sStarSparklesYprecision;
      data[sSmSparkleStar_SpeedX] = sStarSparklesXspeed * xMod;
      data[sSmSparkleStar_SpeedY] = sStarSparklesYspeed * yMod;
    }
  }
}

function GFScene_StartNameSparklesSmall(): void {
  CreateTask(GFScene_Task_NameSparklesSmall, 1);
}

// Sprite data for SpriteCB_SparklesSmall_Name
const sSmSparkleName_State = 0;
const sSmSparkleName_BaseY = 1;
const sSmSparkleName_AnimTimer = 2;
const sSmSparkleName_NumLoops = 3;
const sSmSparkleName_DestroyTimer = 4;

/** GFScene_Task_NameSparklesSmall: every 7 frames a small sparkle on the name, twice through the 9 spots. */
const GFScene_Task_NameSparklesSmall: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const tSparkleIdx = 0;
  const tNumLoops = 1;
  const tTimer = 2;
  data[tTimer]++;
  data[3]++; // unused
  if (data[tTimer] > 6) {
    data[tTimer] = 0;
    const i = data[tSparkleIdx];
    const spriteId = CreateSprite(sSpriteTemplate_SparklesSmall, sTextSparkleCoords[i].x, sTextSparkleCoords[i].y, 2);
    const sprite = gSprites[spriteId]; // gSprites[MAX_SPRITES] when full, as in the C
    StartSpriteAnim(sprite, ANIM_SPARKLE_ONCE);
    sprite.callback = SpriteCB_SparklesSmall_Name;
    sprite.data[sSmSparkleName_BaseY] = sTextSparkleCoords[i].y << 4;
    sprite.data[sSmSparkleName_AnimTimer] = 120;
    sprite.data[sSmSparkleName_NumLoops] = data[tNumLoops];
    if (sprite.data[sSmSparkleName_NumLoops] < 0) sprite.data[sSmSparkleName_NumLoops] = 1;
    if (++data[tSparkleIdx] >= sTextSparkleCoords.length) {
      if (++data[tNumLoops] > 1) DestroyTask(taskId);
      else data[tSparkleIdx] = 0;
    }
  }
};

function GFScene_StartNameSparklesBig(): void {
  CreateTask(GFScene_Task_NameSparklesBig, 2);
}

/** GFScene_Task_NameSparklesBig: every 10 frames a big sparkle, 4 spots on each time, 9 in all. */
const GFScene_Task_NameSparklesBig: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const tTimer = 0;
  const tSparkleIdx = 1;
  const tNumSparkles = 2;
  if (data[tTimer] === 0) {
    const i = data[tSparkleIdx];
    data[tSparkleIdx] += 4;
    if (data[tSparkleIdx] >= sTextSparkleCoords.length) data[tSparkleIdx] -= sTextSparkleCoords.length;
    CreateSprite(sSpriteTemplate_SparklesBig, sTextSparkleCoords[i].x, sTextSparkleCoords[i].y, 3);
    if (++data[tNumSparkles] >= sTextSparkleCoords.length) DestroyTask(taskId);
  }
  if (++data[tTimer] > 9) data[tTimer] = 0;
};

function GFScene_CreateLogoSprite(): Sprite {
  const spriteId = CreateSprite(sSpriteTemplate_GameFreakLogoArt, 120, 70, 4);
  return gSprites[spriteId];
}

/** GFScene_CreatePresentsSprite (REVISION >= 1): "presents" under the logo, two 32x8 halves. */
function GFScene_CreatePresentsSprite(): void {
  for (let i = 0; i < 2; i++) gSprites[CreateSprite(sSpriteTemplate_Presents, 104 + 32 * i, 108, 5)].oam.tileNum += i * 4;
}

/** SpriteCB_Star: the shooting star, right to left on a sine wave, dropping sparkles 7 frames out of 8. */
function SpriteCB_Star(sprite: Sprite): void {
  const data = sprite.data;
  data[sStar_BaseX] -= data[sStar_SpeedX];
  data[sStar_BaseY] += data[sStar_SpeedY];
  data[sStar_SinIdx] += 48;
  sprite.x = data[sStar_BaseX] >> 4;
  sprite.y = data[sStar_BaseY] >> 4;
  sprite.y2 = introEnv.sineTable[(data[sStar_SinIdx] >> 4) + 64] >> 5;
  data[sStar_SparkleTimer]++;
  if (data[sStar_SparkleTimer] % sStarSparklesSpawnRate) {
    let random = LoadWordFromTwoHalfwords(data, sStar_SparkleRngSeed);
    random = (Math.imul(1103515245, random) + 24691) >>> 0; // ISO_RANDOMIZE1
    StoreWordInTwoHalfwords(data, sStar_SparkleRngSeed, random);
    GFScene_CreateStarSparkle(sprite.x, sprite.y + sprite.y2, random >>> 16);
  }
  if (sprite.x < -8) DestroySprite(sprite);
}

/** SpriteCB_SparklesSmall_Star: the sparkles behind the star drift off, flicker after 90 frames, go at 120. */
function SpriteCB_SparklesSmall_Star(sprite: Sprite): void {
  const data = sprite.data;
  data[sSmSparkleStar_BaseX] += data[sSmSparkleStar_SpeedX];
  data[sSmSparkleStar_BaseY] += data[sSmSparkleStar_SpeedY];
  data[sSmSparkleStar_FallDist] += ++data[sSmSparkleStar_FallSpeed];
  data[sSmSparkleStar_Timer]++;
  sprite.x = (data[sSmSparkleStar_BaseX] & 0xffff) >> sStarSparklesXprecision;
  sprite.y = data[sSmSparkleStar_BaseY] >> sStarSparklesYprecision;
  if (sStarSparklesGravityShift && data[sSmSparkleStar_SpeedY] < 0) sprite.y2 = data[sSmSparkleStar_FallDist] >> sStarSparklesGravityShift;
  if (data[sSmSparkleStar_Timer] > sStarSparklesFlickerStartTime) {
    sprite.invisible = !sprite.invisible;
    if (data[sSmSparkleStar_Timer] > sStarSparklesDestroySpriteTime) DestroySprite(sprite);
  }
  if (sprite.y + sprite.y2 < 0 || sprite.y + sprite.y2 > DISPLAY_HEIGHT) DestroySprite(sprite);
}

/** SpriteCB_SparklesSmall_Name: the small sparkles hopping along the "GAME FREAK" name, then falling away. */
function SpriteCB_SparklesSmall_Name(sprite: Sprite): void {
  const data = sprite.data;
  if (data[sSmSparkleName_AnimTimer]) {
    data[sSmSparkleName_AnimTimer]--;
    data[sSmSparkleName_BaseY]++;
    sprite.y = data[sSmSparkleName_BaseY] >> 4;
    if (sprite.y > 86) {
      sprite.y = 74;
      data[sSmSparkleName_BaseY] = 74 << 4;
    }
    if (sprite.animEnded) {
      if (data[sSmSparkleName_State] === 0) {
        sprite.x += 26;
        if (sprite.x > 188) {
          sprite.x = 188 * 2 - sprite.x;
          data[sSmSparkleName_State] = 1;
        }
      } else {
        sprite.x -= 26;
        if (sprite.x < 52) {
          sprite.x = 52 * 2 - sprite.x;
          data[sSmSparkleName_State] = 0;
        }
      }
      StartSpriteAnim(sprite, ANIM_SPARKLE_ONCE);
    }
  } else {
    // (the C goes on with the destroyed sprite; it's out of use, so what it writes doesn't show)
    if (data[sSmSparkleName_NumLoops]) DestroySprite(sprite);
    if (sprite.animEnded) StartSpriteAnim(sprite, ANIM_SPARKLE_LOOP);
    data[sSmSparkleName_BaseY] += 4;
    sprite.y = data[sSmSparkleName_BaseY] >> 4;
    if (++data[sSmSparkleName_DestroyTimer] > 50) DestroySprite(sprite);
  }
}

/** SpriteCB_SparklesBig */
function SpriteCB_SparklesBig(sprite: Sprite): void {
  if (sprite.animEnded) DestroySprite(sprite);
}

// ------------------------------------------------------------------ scenes 1-3: data

// Background ids for scene 1
const BG_SCENE1_GRASS = 0;
const BG_SCENE1_BACKGROUND = 1;
const BG_SCENE1_UNUSED1 = 2;
const BG_SCENE1_UNUSED2 = 3;

const PALSLOT_SCENE1_GRASS = 1;
const PALSLOT_SCENE1_BG = 2;

// Background ids for scene 2
const BG_SCENE2_PLANTS = 0;
const BG_SCENE2_NIDORINO = 1;
const BG_SCENE2_GENGAR = 2;
const BG_SCENE2_BACKGROUND = 3; // the wide shot on the upper half, the close-up on the lower half

// Background ids for scene 3
const BG_SCENE3_GENGAR = 0;
const BG_SCENE3_BACKGROUND = 1;
const BG_SCENE3_UNUSED1 = 2;
const BG_SCENE3_UNUSED2 = 3;

const ANIM_NIDORINO_NORMAL = 0;
const ANIM_NIDORINO_CRY = 1;
const ANIM_NIDORINO_CROUCH = 2;
const ANIM_NIDORINO_HOP = 3;
const ANIM_NIDORINO_ATTACK = 4;

const ANIM_SWIPE_BOTTOM = 1;

const AFFINEANIM_ZOOM = 1;

const NUM_GENGAR_BACK_SPRITES = 4;

/** RAND_MULT (random.h) */
const RAND_MULT = 1103515245;

const sBgTemplates_Scene1: BgTemplate[] = [
  { bg: BG_SCENE1_GRASS, charBaseIndex: 0, mapBaseIndex: 28, screenSize: 2, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: BG_SCENE1_BACKGROUND, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 2, paletteMode: 0, priority: 0, baseTile: 0x000 },
];

const sBgTemplates_Scene2: BgTemplate[] = [
  { bg: BG_SCENE2_BACKGROUND, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 2, paletteMode: 0, priority: 3, baseTile: 0x000 },
  { bg: BG_SCENE2_PLANTS, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: BG_SCENE2_GENGAR, charBaseIndex: 3, mapBaseIndex: 27, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: BG_SCENE2_NIDORINO, charBaseIndex: 2, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
];

const sBgTemplates_Scene3: BgTemplate[] = [
  { bg: BG_SCENE3_BACKGROUND, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: BG_SCENE3_GENGAR, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 2, paletteMode: 0, priority: 0, baseTile: 0x000 },
];

/** sGengarZoomMatrixAnchors: each quarter of Gengar's back zooms from the corner it shares with the others. */
const sGengarZoomMatrixAnchors = [
  [63, 63],
  [0, 63],
  [63, 0],
  [0, 0],
];

const sOam_Scene3_Nidorino = oam({ affineMode: ST_OAM_AFFINE_DOUBLE, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 });

const sAnims_Scene3_Nidorino = [
  [ANIMCMD_FRAME(0, 1), ANIMCMD_END], // ANIM_NIDORINO_NORMAL
  [ANIMCMD_FRAME(64, 1), ANIMCMD_END], // ANIM_NIDORINO_CRY
  [ANIMCMD_FRAME(128, 1), ANIMCMD_END], // ANIM_NIDORINO_CROUCH
  [ANIMCMD_FRAME(192, 1), ANIMCMD_END], // ANIM_NIDORINO_HOP
  [ANIMCMD_FRAME(256, 1), ANIMCMD_END], // ANIM_NIDORINO_ATTACK
];

const sAffineAnim_Scene3_Mons_Normal = [AFFINEANIMCMD_FRAME(256, 256, 0, 0), AFFINEANIMCMD_END];
const sAffineAnim_Scene3_Mons_Zoom = [AFFINEANIMCMD_FRAME(256, 256, 0, 0), AFFINEANIMCMD_FRAME(32, 32, 0, 8), AFFINEANIMCMD_END];
const sAffineAnims_Scene3_Mons = [sAffineAnim_Scene3_Mons_Normal, sAffineAnim_Scene3_Mons_Zoom];

const sSpriteTemplate_Scene3_Nidorino: SpriteTemplate = {
  tileTag: GFXTAG_SCENE3_NIDORINO,
  paletteTag: PALTAG_NIDORINO,
  oam: sOam_Scene3_Nidorino,
  anims: sAnims_Scene3_Nidorino,
  images: null,
  affineAnims: sAffineAnims_Scene3_Mons,
  callback: SpriteCallbackDummy,
};

const sOam_Scene2_Mons = oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 });

const sSpriteTemplate_Scene2_Nidorino: SpriteTemplate = {
  tileTag: GFXTAG_SCENE2_NIDORINO,
  paletteTag: PALTAG_NIDORINO,
  oam: sOam_Scene2_Mons,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSpriteTemplate_Scene2_Gengar: SpriteTemplate = {
  tileTag: GFXTAG_SCENE2_GENGAR,
  paletteTag: PALTAG_GENGAR,
  oam: sOam_Scene2_Mons,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sOam_Grass = oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1], priority: 0 });

const sAnims_Grass = [
  [ANIMCMD_FRAME(0, 0), ANIMCMD_END], // static
  [ANIMCMD_FRAME(32, 4), ANIMCMD_FRAME(0, 4), ANIMCMD_END], // rustle (unused)
];

const sSpriteTemplate_Grass: SpriteTemplate = {
  tileTag: GFXTAG_SCENE3_GRASS,
  paletteTag: PALTAG_SCENE3_GRASS,
  oam: sOam_Grass,
  anims: sAnims_Grass,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sOam_Scene3_Gengar = oam({ affineMode: ST_OAM_AFFINE_DOUBLE, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 });

const sAnims_Scene3_Gengar = [
  [ANIMCMD_FRAME(0, 0), ANIMCMD_END], // top left
  [ANIMCMD_FRAME(64, 0), ANIMCMD_END], // top right
  [ANIMCMD_FRAME(96, 0), ANIMCMD_END], // bottom left
  [ANIMCMD_FRAME(160, 0), ANIMCMD_END], // bottom right
];

const sSpriteTemplate_Scene3_Gengar: SpriteTemplate = {
  tileTag: GFXTAG_SCENE3_GENGAR,
  paletteTag: PALTAG_GENGAR,
  oam: sOam_Scene3_Gengar,
  anims: sAnims_Scene3_Gengar,
  images: null,
  affineAnims: sAffineAnims_Scene3_Mons,
  callback: SpriteCallbackDummy,
};

const sOam_Swipe = oam({ shape: SPRITE_SHAPE['32x64'][0], size: SPRITE_SHAPE['32x64'][1], priority: 1 });

const sAnims_Swipe = [
  [ANIMCMD_FRAME(0, 8), ANIMCMD_FRAME(32, 4), ANIMCMD_END], // ANIM_SWIPE_TOP
  [ANIMCMD_FRAME(64, 8), ANIMCMD_FRAME(72, 4), ANIMCMD_END], // ANIM_SWIPE_BOTTOM
];

const sSpriteTemplate_GengarSwipe: SpriteTemplate = {
  tileTag: GFXTAG_SCENE3_SWIPE,
  paletteTag: PALTAG_SCENE3_SWIPE,
  oam: sOam_Swipe,
  anims: sAnims_Swipe,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_GengarSwipe,
};

const sOam_RecoilDust = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1 });

const sAnim_RecoilDust = [ANIMCMD_FRAME(0, 10), ANIMCMD_FRAME(4, 10), ANIMCMD_FRAME(8, 10), ANIMCMD_FRAME(12, 8), ANIMCMD_END];

const sSpriteTemplate_NidorinoRecoilDust: SpriteTemplate = {
  tileTag: GFXTAG_SCENE3_RECOIL_DUST,
  paletteTag: PALTAG_SCENE3_RECOIL_DUST,
  oam: sOam_RecoilDust,
  anims: [sAnim_RecoilDust],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_RecoilDust,
};

// EWRAM_DATA: kept across replays of the intro
let sNidorinoJumpMult = 0;
let sNidorinoAnimDelayTime = 0;
let sNidorinoJumpDiv = 0;
let sNidorinoRecoilReturnTime = 0;
// sUnusedScene3Var0 / 1, sNidorinoUnusedVar: set but never read
/** Scene3_Task_GengarEnter's static sGengarScroll */
let sGengarScroll = 0;

/** gSineTable[i] (Q8.8) */
const Sin = (i: number): number => introEnv.sineTable[i];

// ------------------------------------------------------------------ scene 1: the grass, the forest zooming in

function IntroCB_Scene1(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0: {
      SetVBlankCallback(null);
      const grassPal = gfx16('sScene1_Grass_Pal');
      LoadPalette(grassPal, BG_PLTT_ID(PALSLOT_SCENE1_GRASS), grassPal.length * 2);
      const bgPal = gfx16('sScene1_Bg_Pal');
      LoadPalette(bgPal, BG_PLTT_ID(PALSLOT_SCENE1_BG), bgPal.length * 2);
      BlendPalettes((1 << PALSLOT_SCENE1_GRASS) | (1 << PALSLOT_SCENE1_BG), 16, RGB_WHITE);
      InitBgsFromTemplates(0, sBgTemplates_Scene1);
      DecompressAndCopyTileDataToVram(BG_SCENE1_BACKGROUND, gfx('sScene1_Bg_Gfx'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(BG_SCENE1_BACKGROUND, gfx('sScene1_Bg_Map'), 0, 0, 1);
      ShowBg(BG_SCENE1_BACKGROUND);
      HideBg(BG_SCENE1_GRASS);
      HideBg(BG_SCENE1_UNUSED1);
      HideBg(BG_SCENE1_UNUSED2);
      LoadFightSceneSpriteGraphics();
      SetVBlankCallback(VBlankCB_Intro);
      ptr.state++;
      break;
    }
    case 1:
      if (!FreeTempTileDataBuffersIfPossible()) {
        DecompressAndCopyTileDataToVram(BG_SCENE1_GRASS, gfx('sScene1_Grass_Gfx'), 0, 0, 0);
        DecompressAndCopyTileDataToVram(BG_SCENE1_GRASS, gfx('sScene1_Grass_Map'), 0, 0, 1);
        ResetBgPositions();
        ShowBg(BG_SCENE1_BACKGROUND);
        ptr.state++;
      }
      break;
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        ShowBg(BG_SCENE1_GRASS);
        CreateTask(Scene1_Task_AnimateGrass, 0);
        BeginNormalPaletteFade((1 << PALSLOT_SCENE1_GRASS) | (1 << PALSLOT_SCENE1_BG), -2, 16, 0, RGB_WHITE);
        ptr.state++;
      }
      break;
    case 3:
      if (!gPaletteFade.active) {
        m4aSongNumStart(introEnv.define('MUS_INTRO_FIGHT'));
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 4:
      if (++ptr.timer === 20) {
        // Start the animation into the next scene
        CreateTask(Scene1_Task_BgZoom, 0);
        Scene1_StartGrassScrolling();
      }
      if (ptr.timer >= 30) {
        // End the scene
        BlendPalettes(PALETTES_ALL & ~1, 16, RGB_WHITE);
        DestroyTask(FindTaskIdByFunc(Scene1_Task_AnimateGrass));
        DestroyTask(FindTaskIdByFunc(Scene1_Task_BgZoom));
        SetIntroCB(ptr, IntroCB_Scene2);
      }
      break;
    case 5:
      // Never reached
      if (!gPaletteFade.active) {
        DestroyTask(FindTaskIdByFunc(Scene1_Task_AnimateGrass));
        DestroyTask(FindTaskIdByFunc(Scene1_Task_BgZoom));
        SetIntroCB(ptr, IntroCB_Scene2);
      }
      break;
  }
}

/**
 * Scene1_Task_AnimateGrass: the grass's 3 frames are stacked on the tilemap; the BG's y picks one every 6 frames.
 * Once it's exiting, the grass is meant to scroll down off screen, but the frame change overwrites the scroll, so it
 * "stutters" back up (as in the C).
 */
const Scene1_Task_AnimateGrass: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const tTimer = 0;
  const tFrame = 1;
  const tExiting = 2;
  const tScroll = 3;
  if (++data[tTimer] > 5) {
    data[tTimer] = 0;
    if (++data[tFrame] >= 3) data[tFrame] = 0;
    ChangeBgY(BG_SCENE1_GRASS, data[tFrame] << 15, BG_COORD_SET);
  }
  if (data[tExiting]) {
    data[tScroll] += 0x120;
    ChangeBgY(BG_SCENE1_GRASS, data[tScroll], BG_COORD_SUB);
  }
};

function Scene1_StartGrassScrolling(): void {
  const taskId = FindTaskIdByFunc(Scene1_Task_AnimateGrass);
  gTasks[taskId].data[2] = 1; // tExiting
}

/** Scene1_Task_BgZoom: the silhouetted forest "zooms in", frames stacked on the tilemap like the grass's. */
const Scene1_Task_BgZoom: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const tTimer = 0;
  const tFrame = 1;
  if (++data[tTimer] > 3) {
    data[tTimer] = 0;
    if (data[tFrame] < 2) data[tFrame]++;
    ChangeBgY(BG_SCENE1_BACKGROUND, data[tFrame] << 15, BG_COORD_SET);
  }
};

// ------------------------------------------------------------------ scene 2: the forest pan, Gengar and Nidorino close up

function IntroCB_Scene2(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      BlendPalettes(PALETTES_ALL & ~1, 16, RGB_WHITE);
      InitBgsFromTemplates(0, sBgTemplates_Scene2);
      DecompressAndCopyTileDataToVram(BG_SCENE2_BACKGROUND, gfx('sScene2_Bg_Gfx'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(BG_SCENE2_BACKGROUND, gfx('sScene2_Bg_Map'), 0, 0, 1);
      ShowBg(BG_SCENE2_BACKGROUND);
      ptr.state++;
      break;
    case 1:
      if (!FreeTempTileDataBuffersIfPossible()) {
        SetVBlankCallback(null);
        const bgPal = gfx16('sScene2_Bg_Pal');
        LoadPalette(bgPal, BG_PLTT_ID(1), bgPal.length * 2);
        const gengarPal = gfx16('sGengar_Pal');
        LoadPalette(gengarPal, BG_PLTT_ID(5), gengarPal.length * 2);
        const nidorinoPal = gfx16('sScene2_NidorinoClose_Pal');
        LoadPalette(nidorinoPal, BG_PLTT_ID(6), nidorinoPal.length * 2);
        BlendPalettes(PALETTES_ALL & ~1, 16, RGB_WHITE);
        DecompressAndCopyTileDataToVram(BG_SCENE2_PLANTS, gfx('sScene2_Plants_Gfx'), 0, 0, 0);
        DecompressAndCopyTileDataToVram(BG_SCENE2_PLANTS, gfx('sScene2_Plants_Map'), 0, 0, 1);
        DecompressAndCopyTileDataToVram(BG_SCENE2_NIDORINO, gfx('sScene2_NidorinoClose_Gfx'), 0, 0, 0);
        DecompressAndCopyTileDataToVram(BG_SCENE2_NIDORINO, gfx('sScene2_NidorinoClose_Map'), 0, 0, 1);
        DecompressAndCopyTileDataToVram(BG_SCENE2_GENGAR, gfx('sScene2_GengarClose_Gfx'), 0, 0, 0);
        DecompressAndCopyTileDataToVram(BG_SCENE2_GENGAR, gfx('sScene2_GengarClose_Map'), 0, 0, 1);
        ResetBgPositions();
        ShowBg(BG_SCENE2_PLANTS);
        HideBg(BG_SCENE2_NIDORINO); // hidden until the close-up
        HideBg(BG_SCENE2_GENGAR);
        ChangeBgY(BG_SCENE2_GENGAR, 0x0001ce00, BG_COORD_SET);
        ChangeBgY(BG_SCENE2_NIDORINO, 0x00002800, BG_COORD_SET);
        CreateTask(Scene2_Task_PanForest, 0);
        Scene2_CreateMonSprites(ptr);
        BlendPalettes(PALETTES_ALL & ~1, 16, RGB_WHITE);
        SetVBlankCallback(VBlankCB_Intro);
        ptr.state++;
      }
      break;
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        BeginNormalPaletteFade(PALETTES_ALL & ~1, -2, 16, 0, RGB_WHITE);
        ptr.state++;
      }
      break;
    case 3:
      if (!gPaletteFade.active) {
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 4:
      if (++ptr.timer >= 60) {
        ptr.timer = 0;
        DestroyTask(FindTaskIdByFunc(Scene2_Task_PanForest));
        Scene2_DestroyMonSprites(ptr);
        CreateTask(Scene2_Task_PanMons, 0);
        ChangeBgY(BG_SCENE2_BACKGROUND, 0x00010000, BG_COORD_SET); // the wide shot (upper half) → the close-up (lower half)
        HideBg(BG_SCENE2_PLANTS);
        ShowBg(BG_SCENE2_BACKGROUND);
        ShowBg(BG_SCENE2_NIDORINO);
        ShowBg(BG_SCENE2_GENGAR);
        ptr.state++;
      }
      break;
    case 5:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 6:
      if (++ptr.timer >= 60) {
        DestroyTask(FindTaskIdByFunc(Scene2_Task_PanMons));
        SetIntroCB(ptr, IntroCB_Scene3_Entrance);
      }
      break;
  }
}

/** Scene2_Task_PanForest: the trees pan right and the plants in front left, in the wide shot. */
const Scene2_Task_PanForest: TaskFunc = () => {
  ChangeBgX(BG_SCENE2_BACKGROUND, 0x0e0, BG_COORD_SUB);
  ChangeBgX(BG_SCENE2_PLANTS, 0x110, BG_COORD_ADD);
};

/** Scene2_Task_PanMons: Gengar pans up and Nidorino down, in the close-up. */
const Scene2_Task_PanMons: TaskFunc = () => {
  ChangeBgY(BG_SCENE2_GENGAR, 0x020, BG_COORD_ADD);
  ChangeBgY(BG_SCENE2_NIDORINO, 0x024, BG_COORD_SUB);
};

/** Scene2_CreateMonSprites: Gengar and Nidorino in the wide shot. */
function Scene2_CreateMonSprites(ptr: IntroSequenceData): void {
  ptr.scene2GengarSprite = null;
  ptr.scene2NidorinoSprite = null;
  let spriteId = CreateSprite(sSpriteTemplate_Scene2_Nidorino, 168, 80, 11);
  if (spriteId !== MAX_SPRITES) ptr.scene2NidorinoSprite = gSprites[spriteId];
  spriteId = CreateSprite(sSpriteTemplate_Scene2_Gengar, 72, 80, 12);
  if (spriteId !== MAX_SPRITES) ptr.scene2GengarSprite = gSprites[spriteId];
}

function Scene2_DestroyMonSprites(ptr: IntroSequenceData): void {
  if (ptr.scene2GengarSprite) DestroySprite(ptr.scene2GengarSprite);
  if (ptr.scene2NidorinoSprite) DestroySprite(ptr.scene2NidorinoSprite);
}

// ------------------------------------------------------------------ scene 3: Gengar and Nidorino's fight

/** IntroCB_Scene3_Entrance: scene 3's graphics, then Gengar and Nidorino slide into their places. */
function IntroCB_Scene3_Entrance(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0: {
      const bgPal = gfx16('sScene3_Bg_Pal');
      LoadPalette(bgPal, BG_PLTT_ID(1), bgPal.length * 2);
      const gengarPal = gfx16('sGengar_Pal');
      LoadPalette(gengarPal, BG_PLTT_ID(5), gengarPal.length * 2);
      BlendPalettes(PALETTES_ALL & ~1, 16, RGB_WHITE);
      InitBgsFromTemplates(0, sBgTemplates_Scene3);
      DecompressAndCopyTileDataToVram(BG_SCENE3_BACKGROUND, gfx('sScene3_Bg_Gfx'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(BG_SCENE3_BACKGROUND, gfx('sScene3_Bg_Map'), 0, 0, 1);
      ShowBg(BG_SCENE3_BACKGROUND);
      HideBg(BG_SCENE3_GENGAR);
      HideBg(BG_SCENE3_UNUSED1);
      HideBg(BG_SCENE3_UNUSED2);
      ResetBgPositions();
      ptr.state++;
      // Gengar (BG0) is hidden on the left half until it has scrolled in
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuRegBits(REG_OFFSET_WININ, WININ_WIN0_BG1 | WININ_WIN0_OBJ);
      ClearGpuRegBits(REG_OFFSET_WININ, WININ_WIN0_BG0);
      SetGpuRegBits(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(32, DISPLAY_HEIGHT - 32));
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, DISPLAY_WIDTH / 2));
      break;
    }
    case 1:
      if (!FreeTempTileDataBuffersIfPossible()) {
        DecompressAndCopyTileDataToVram(BG_SCENE3_GENGAR, gfx('sScene3_GengarAnim_Gfx'), 0, 0, 0);
        DecompressAndCopyTileDataToVram(BG_SCENE3_GENGAR, gfx('sScene3_GengarAnim_Map'), 0, 0, 1);
        // sUnusedScene3Var0 = 4, sUnusedScene3Var1 = 52: never read
        ChangeBgX(BG_SCENE3_GENGAR, 0x00001800, BG_COORD_SET);
        ChangeBgY(BG_SCENE3_GENGAR, 0x0001f000, BG_COORD_SET);
        ptr.state++;
      }
      break;
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        BlendPalettes(PALETTES_ALL & ~1, 0, RGB_WHITE);
        ShowBg(BG_SCENE3_GENGAR);
        CreateTask(Scene3_Task_GengarBounce, 0);
        Scene3_CreateNidorinoSprite(ptr);
        Scene3_StartNidorinoEntrance(ptr.scene3NidorinoSprite!, 0, 180, 52);
        CreateTask(Scene3_Task_GengarEnter, 0);
        Scene3_StartBgScroll();
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 3:
      if (++ptr.timer === 16) Scene3_CreateGrassSprite(ptr);
      if (!Scene3_IsNidorinoEntering(ptr) && !FuncIsActiveTask(Scene3_Task_GengarEnter)) SetIntroCB(ptr, IntroCB_Scene3_Fight);
      break;
  }
}

/** Scene3_Task_BgScroll: the trees pan right, fast while the mons slide in, slowly after (tSlow). */
const Scene3_Task_BgScroll: TaskFunc = (taskId) => {
  if (!gTasks[taskId].data[0]) ChangeBgX(BG_SCENE3_BACKGROUND, 0x400, BG_COORD_SUB);
  else ChangeBgX(BG_SCENE3_BACKGROUND, 0x020, BG_COORD_SUB);
};

function Scene3_StartBgScroll(): void {
  CreateTask(Scene3_Task_BgScroll, 0);
}

function Scene3_SlowBgScroll(): void {
  gTasks[FindTaskIdByFunc(Scene3_Task_BgScroll)].data[0] = 1; // tSlow
}

// Scene3_Task_GengarBounce's data
const tBounce_Paused = 0;
const tBounce_Timer = 1;
const tBounce_State = 2;

/** Scene3_Task_GengarBounce: Gengar's idle bounce, between its normal and slightly crouched frames every 30 frames. */
const Scene3_Task_GengarBounce: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (!data[tBounce_Paused]) {
    if (++data[tBounce_Timer] >= 30) {
      data[tBounce_Timer] = 0;
      data[tBounce_State] ^= 1;
      ChangeBgY(BG_SCENE3_GENGAR, (data[tBounce_State] << 15) + 0x1f000, BG_COORD_SET);
    }
  }
};

function Scene3_PauseGengarBounce(): void {
  gTasks[FindTaskIdByFunc(Scene3_Task_GengarBounce)].data[tBounce_Paused] = 1;
}

function Scene3_ResumeGengarBounce(): void {
  gTasks[FindTaskIdByFunc(Scene3_Task_GengarBounce)].data[tBounce_Paused] = 0;
}

function Scene3_IsGengarMidBounce(): boolean {
  return gTasks[FindTaskIdByFunc(Scene3_Task_GengarBounce)].data[tBounce_State] !== 0;
}

/** Scene3_CreateGrassSprite: the clump of grass passing by in front during the fight. */
function Scene3_CreateGrassSprite(ptr: IntroSequenceData): void {
  const spriteId = CreateSprite(sSpriteTemplate_Grass, 296, 112, 7);
  if (spriteId !== MAX_SPRITES) {
    ptr.scene3GrassSprite = gSprites[spriteId];
    ptr.scene3GrassSprite.callback = SpriteCB_Grass;
  } else {
    ptr.scene3GrassSprite = null;
  }
}

/** SpriteCB_Grass: in fast with the BG, then slow (and the BG with it) once it's at x 52. */
function SpriteCB_Grass(sprite: Sprite): void {
  const data = sprite.data;
  const sState = 0;
  const sBaseX = 1;
  const sVeloc = 2;
  switch (data[sState]) {
    case 0:
      data[sBaseX] = sprite.x << 5;
      data[sVeloc] = 160;
      data[sState]++;
    // fallthrough
    case 1:
      data[sBaseX] -= data[sVeloc];
      sprite.x = data[sBaseX] >> 5;
      if (sprite.x <= 52) {
        Scene3_SlowBgScroll();
        data[sState]++;
      }
      break;
    case 2:
      data[sBaseX] -= 32;
      sprite.x = data[sBaseX] >> 5;
      if (sprite.x <= -32) {
        sprite.invisible = true;
        data[sState]++;
        DestroySprite(sprite);
      }
      break;
  }
}

/** IntroCB_Scene3_Fight: Nidorino cries, Gengar swipes, Nidorino recoils, hops back twice and jumps at Gengar. */
function IntroCB_Scene3_Fight(ptr: IntroSequenceData): void {
  switch (ptr.state) {
    case 0:
      ptr.timer = 0;
      ptr.state++;
      break;
    case 1:
      if (++ptr.timer > 30) {
        Scene3_StartNidorinoCry(ptr);
        ptr.state++;
      }
      break;
    case 2:
      if (!Scene3_NidorinoAnimIsRunning(ptr)) {
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 3:
      if (++ptr.timer > 30) {
        Scene3_PauseGengarBounce();
        Scene3_StartGengarAttack(ptr);
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 4:
      if (ptr.gengarAttackLanded) {
        Scene3_StartNidorinoRecoil(ptr);
        ptr.state++;
      }
      break;
    case 5:
      if (!Scene3_NidorinoAnimIsRunning(ptr)) {
        Scene3_ResumeGengarBounce();
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 6:
      if (++ptr.timer > 16) {
        // Nidorino's 1st hop back before its attack
        Scene3_StartNidorinoHop(ptr.scene3NidorinoSprite!, 8, 12, 5);
        ptr.state++;
      }
      break;
    case 7:
      if (!Scene3_NidorinoAnimIsRunning(ptr)) {
        // Nidorino's 2nd hop back
        Scene3_StartNidorinoHop(ptr.scene3NidorinoSprite!, 8, 12, 5);
        ptr.state++;
      }
      break;
    case 8:
      if (!Scene3_NidorinoAnimIsRunning(ptr)) {
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 9:
      if (++ptr.timer > 20) {
        Scene3_StartNidorinoAttack(ptr);
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 10:
      if (!Scene3_IsGengarMidBounce()) {
        Scene3_PauseGengarBounce();
        Scene3_CreateGengarSprite(ptr);
        ptr.state++;
      }
      break;
    case 11:
      HideBg(BG_SCENE3_GENGAR);
      ptr.timer = 0;
      ptr.state++;
      break;
    case 12:
      if (++ptr.timer === 48) BeginNormalPaletteFade((1 << 1) | (1 << 2), 2, 0, 16, RGB_WHITE);
      if (ptr.timer > 120) {
        Scene3_NidorinoZoom(ptr);
        Scene3_GengarZoom(ptr);
        ptr.state++;
        ptr.timer = 0;
      }
      break;
    case 13:
      if (++ptr.timer > 8) {
        gPlttBufferUnfaded.fill(RGB_WHITE, BG_PLTT_ID(1), BG_PLTT_ID(1) + PLTT_SIZE_4BPP); // CpuFill16, 2 palettes
        BeginNormalPaletteFade(PALETTES_ALL & ~1, -2, 0, 16, RGB_BLACK);
        ptr.state++;
      }
      break;
    case 14:
      if (!gPaletteFade.active) {
        ptr.timer = 0;
        ptr.state++;
      }
      break;
    case 15:
      if (++ptr.timer > 60) SetIntroCB(ptr, IntroCB_ExitToTitleScreen);
      break;
    default:
      // Never reached (a debug replay with R)
      if (JOY_NEW(R_BUTTON)) {
        BlendPalettes(PALETTES_OBJECTS | (1 << 2) | (1 << 5) | (1 << 6), 0, RGB_WHITE);
        ptr.scene3NidorinoSprite!.x2 = 0;
        ptr.scene3NidorinoSprite!.x = 180;
        ptr.state = 1;
        ptr.timer = 30;
      }
      break;
  }
}

function Scene3_CalcCenterToCornerVec(sprite: Sprite): void {
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
}

/** Scene3_CreateGengarSprite: Gengar's back as four sprites (no subsprite table) for the zoom. */
function Scene3_CreateGengarSprite(ptr: IntroSequenceData): void {
  for (let i = 0; i < NUM_GENGAR_BACK_SPRITES; i++) {
    const x = (i & 1) * 48 + 49;
    const y = Math.trunc(i / 2) * 64 + 72;
    const spriteId = CreateSprite(sSpriteTemplate_Scene3_Gengar, x, y, 8);
    if (spriteId !== MAX_SPRITES) {
      StartSpriteAnim(gSprites[spriteId], i);
      const sprite = gSprites[spriteId];
      ptr.scene3GengarSprites[i] = sprite;
      if (i & 1) sprite.oam.shape = ST_OAM_V_RECTANGLE;
      Scene3_CalcCenterToCornerVec(sprite);
    }
  }
}

function Scene3_NidorinoZoom(ptr: IntroSequenceData): void {
  const sprite = ptr.scene3NidorinoSprite!;
  sprite.x += sprite.x2;
  sprite.y += sprite.y2;
  SetSpriteMatrixAnchor(sprite, 0, 42);
  sprite.callback = SpriteCallbackDummy;
  StartSpriteAffineAnim(sprite, AFFINEANIM_ZOOM);
}

function SpriteCB_Idle(_sprite: Sprite): void {}

function Scene3_GengarZoom(ptr: IntroSequenceData): void {
  for (let i = 0; i < NUM_GENGAR_BACK_SPRITES; i++) {
    const sprite = ptr.scene3GengarSprites[i]!;
    StartSpriteAffineAnim(sprite, AFFINEANIM_ZOOM);
    sprite.callback = SpriteCB_Idle;
    SetSpriteMatrixAnchor(sprite, sGengarZoomMatrixAnchors[i][0], sGengarZoomMatrixAnchors[i][1]);
  }
}

// Scene3_Task_GengarAttack's data (IDX_INTRO_DATA, data[5..6], held the IntroSequenceData: `sIntro` here)
const tAttack_State = 0;
const tAttack_Timer = 1;
const tAttack_SinIdx = 3;
const tAttack_BaseX = 4;
const tAttack_Frame = 7;
const tAttack_MultY = 8;
const tAttack_MultX = 9;

function Scene3_StartGengarAttack(ptr: IntroSequenceData): void {
  ptr.gengarAttackLanded = false;
  const taskId = CreateTask(Scene3_Task_GengarAttack, 4);
  // SetWordTaskArg(taskId, IDX_INTRO_DATA, ptr): the task reads sIntro
  gTasks[taskId].data[tAttack_SinIdx] = 64;
  gTasks[taskId].data[tAttack_BaseX] = GetBgX(BG_SCENE3_GENGAR); // s16
}

function Scene3_ApplyGengarAnim(frame: number, xSub: number, ySub: number, xBase: number): void {
  ChangeBgY(BG_SCENE3_GENGAR, (frame << 15) + 0x1f000, BG_COORD_SET);
  ChangeBgX(BG_SCENE3_GENGAR, xBase, BG_COORD_SET);
  ChangeBgX(BG_SCENE3_GENGAR, xSub << 8, BG_COORD_SUB);
  ChangeBgY(BG_SCENE3_GENGAR, ySub << 8, BG_COORD_SUB);
}

/** Scene3_Task_GengarAttack: Gengar rears back in an arc, swipes forward (the swipe sprites) and settles back. */
const Scene3_Task_GengarAttack: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (data[tAttack_State]) {
    case 0:
      data[tAttack_Frame] = 2; // arm up
      data[tAttack_Timer] = 0;
      data[tAttack_MultY] = 6;
      data[tAttack_MultX] = 32;
      data[tAttack_State]++;
      break;
    case 1:
      // a backward arc
      data[tAttack_SinIdx] -= 2;
      if (++data[tAttack_Timer] > 15) {
        data[tAttack_Timer] = 0;
        data[tAttack_State]++;
      }
      break;
    case 2:
      // a pause at the end of the arc
      if (++data[tAttack_Timer] === 14) sIntro!.gengarAttackLanded = true; // GetWordTaskArg(taskId, IDX_INTRO_DATA)
      if (data[tAttack_Timer] > 15) {
        data[tAttack_Timer] = 0;
        data[tAttack_State]++;
      }
      break;
    case 3:
      // a forward arc
      data[tAttack_SinIdx] += 8;
      if (++data[tAttack_Timer] === 4) {
        Scene3_CreateGengarSwipeSprites();
        data[tAttack_MultY] = 32;
        data[tAttack_MultX] = 48;
        data[tAttack_Frame] = 3; // the arm swipes down
      }
      if (data[tAttack_Timer] > 7) {
        data[tAttack_Timer] = 0;
        data[tAttack_State]++;
      }
      break;
    case 4:
      // back to where it was
      data[tAttack_SinIdx] -= 8;
      if (++data[tAttack_Timer] > 3) {
        data[tAttack_Frame] = 0; // normal posture
        data[tAttack_SinIdx] = 64;
        data[tAttack_Timer] = 0;
        data[tAttack_State]++;
      }
      break;
    case 5:
      DestroyTask(taskId);
      return;
  }
  // The arc and the frame
  const sinIdx = data[tAttack_SinIdx];
  const xSub = -((Sin(sinIdx + 64) * data[tAttack_MultX]) >> 8);
  const ySub = data[tAttack_MultY] - ((Sin(sinIdx) * data[tAttack_MultY]) >> 8);
  Scene3_ApplyGengarAnim(data[tAttack_Frame], xSub, ySub, data[tAttack_BaseX]);
};

function Scene3_CreateGengarSwipeSprites(): void {
  CreateSprite(sSpriteTemplate_GengarSwipe, 132, 78, 6); // ANIM_SWIPE_TOP
  const spriteId = CreateSprite(sSpriteTemplate_GengarSwipe, 132, 118, 6);
  if (spriteId !== MAX_SPRITES) {
    const sprite = gSprites[spriteId];
    sprite.oam.shape = SPRITE_SHAPE['32x16'][0];
    sprite.oam.size = SPRITE_SHAPE['32x16'][1];
    Scene3_CalcCenterToCornerVec(sprite);
    StartSpriteAnim(sprite, ANIM_SWIPE_BOTTOM);
  }
}

function SpriteCB_GengarSwipe(sprite: Sprite): void {
  sprite.invisible = !sprite.invisible;
  if (sprite.animEnded) DestroySprite(sprite);
}

/** Scene3_Task_GengarEnter: Gengar scrolls into place, fast for 40 frames, then slowing. */
const Scene3_Task_GengarEnter: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const tState = 0;
  const tSpeed = 1;
  const tMoves = 2;
  switch (data[tState]) {
    case 0:
      data[tSpeed] = 0x400;
      data[tState]++;
    // fallthrough
    case 1:
      // no slowing down for the first 40 moves
      if (++data[tMoves] >= 40 && data[tSpeed] > 16) data[tSpeed] -= 16;
      sGengarScroll = ChangeBgX(BG_SCENE3_GENGAR, data[tSpeed], BG_COORD_ADD);
      if (sGengarScroll >= 0x8000) ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      if (sGengarScroll >= 0xef00) {
        ChangeBgX(BG_SCENE3_GENGAR, 0xef00, BG_COORD_SET);
        DestroyTask(taskId);
      }
      break;
  }
};

function Scene3_CreateNidorinoSprite(ptr: IntroSequenceData): void {
  const spriteId = CreateSprite(sSpriteTemplate_Scene3_Nidorino, 0, 0, 9);
  ptr.scene3NidorinoSprite = gSprites[spriteId];
}

// Scene3_SpriteCB_NidorinoEnter's data
const sEnter_X = 0;
const sEnter_Speed = 1;
const sEnter_Time = 2; // not read
const sEnter_TargetX = 3;
const sEnter_Timer = 4;

function Scene3_StartNidorinoEntrance(sprite: Sprite, xStart: number, x1: number, time: number): void {
  sprite.data[sEnter_X] = xStart << 4;
  sprite.data[sEnter_Speed] = Math.trunc(((x1 - xStart) << 4) / time);
  sprite.data[sEnter_Time] = time;
  sprite.data[sEnter_TargetX] = x1;
  sprite.data[sEnter_Timer] = 0;
  sprite.x = xStart;
  sprite.y = 100;
  sprite.callback = Scene3_SpriteCB_NidorinoEnter;
}

function Scene3_SpriteCB_NidorinoEnter(sprite: Sprite): void {
  const data = sprite.data;
  if (++data[sEnter_Timer] >= 40) {
    // slowing down after 40 frames
    if (data[sEnter_Speed] > 1) data[sEnter_Speed]--;
  }
  data[sEnter_X] += data[sEnter_Speed];
  sprite.x = data[sEnter_X] >> 4;
  if (sprite.x >= data[sEnter_TargetX]) {
    sprite.x = data[sEnter_TargetX];
    sprite.callback = SpriteCallbackDummy;
  }
}

function Scene3_IsNidorinoEntering(ptr: IntroSequenceData): boolean {
  return ptr.scene3NidorinoSprite!.callback === Scene3_SpriteCB_NidorinoEnter;
}

// SpriteCB_NidorinoCry's data
const sCry_State = 0;
const sCry_StateTimer = 1;
const sCry_BounceTimer = 2;

function Scene3_StartNidorinoCry(ptr: IntroSequenceData): void {
  const sprite = ptr.scene3NidorinoSprite!;
  StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
  sprite.data[sCry_State] = 0;
  sprite.data[sCry_StateTimer] = 0;
  sprite.y2 = 3;
  sprite.callback = SpriteCB_NidorinoCry;
}

function SpriteCB_NidorinoCry(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sCry_State]) {
    case 0:
      if (++data[sCry_StateTimer] > 8) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_CRY);
        sprite.y2 = 0;
        data[sCry_State]++;
      }
      break;
    case 1:
      PlayCry_ByMode(introEnv.define('SPECIES_NIDORINO'), 0x3f, SOUND_CONSTANTS.CRY_MODE_DOUBLES);
      data[sCry_StateTimer] = 0;
      data[sCry_State]++;
      break;
    case 2:
      if (++data[sCry_BounceTimer] > 1) {
        // a little bounce while it cries
        data[sCry_BounceTimer] = 0;
        sprite.y2 = sprite.y2 === 0 ? 1 : 0;
      }
      if (++data[sCry_StateTimer] > 48) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_NORMAL);
        sprite.y2 = 0;
        sprite.callback = SpriteCallbackDummy;
      }
      break;
  }
}

// SpriteCB_NidorinoRecoil's data
const sRecoil_State = 0;
const sRecoil_StateTimer = 1;
const sRecoil_OffsetX = 2;
const sRecoil_SinIdx = 3;
const sRecoil_LandTimer = 4;
const sRecoil_SlowdownTimer = 5;
const sRecoil_RandSeed = 6;
const sRecoil_SpeedX = 7;

function Scene3_StartNidorinoRecoil(ptr: IntroSequenceData): void {
  sNidorinoRecoilReturnTime = 16;
  sNidorinoJumpMult = 3;
  sNidorinoJumpDiv = 5;
  sNidorinoAnimDelayTime = 0;
  const sprite = ptr.scene3NidorinoSprite!;
  StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
  sprite.data[sRecoil_State] = 0;
  sprite.data[sRecoil_StateTimer] = 0;
  sprite.data[sRecoil_OffsetX] = 0;
  sprite.data[sRecoil_SinIdx] = 0;
  sprite.data[sRecoil_LandTimer] = 0;
  sprite.data[sRecoil_SpeedX] = 40;
  sprite.callback = SpriteCB_NidorinoRecoil;
}

function SpriteCB_NidorinoRecoil(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sRecoil_State]) {
    case 0:
      if (++data[sRecoil_StateTimer] > 4) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_HOP);
        data[sRecoil_State]++;
      }
      break;
    case 1:
      // in the air, backwards
      data[sRecoil_OffsetX] += data[sRecoil_SpeedX];
      data[sRecoil_SinIdx] += 8;
      sprite.x2 = data[sRecoil_OffsetX] >> 4;
      sprite.y2 = -((Sin(data[sRecoil_SinIdx]) * sNidorinoJumpMult) >> sNidorinoJumpDiv);
      data[sRecoil_SlowdownTimer]++;
      if (data[sRecoil_SlowdownTimer] > sNidorinoAnimDelayTime) {
        data[sRecoil_SlowdownTimer] = 0;
        data[sRecoil_SpeedX]--;
      }
      if (++data[sRecoil_LandTimer] > 15) {
        // it lands
        StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
        data[sRecoil_StateTimer] = 0;
        data[sRecoil_RandSeed] = 0x4757;
        data[sRecoil_SpeedX] = 28;
        data[sRecoil_State]++;
      }
      break;
    case 2:
      // sliding on the ground
      data[sRecoil_OffsetX] += data[sRecoil_SpeedX];
      sprite.x2 = data[sRecoil_OffsetX] >> 4;
      if (++data[sRecoil_StateTimer] > 6) {
        // "Random" dust from a fixed seed: the same every time the intro plays
        CreateNidorinoRecoilDustSprites(sprite.x + sprite.x2, sprite.y + sprite.y2, data[sRecoil_RandSeed]);
        data[sRecoil_RandSeed] = Math.imul(data[sRecoil_RandSeed], RAND_MULT); // s16
      }
      if (data[sRecoil_StateTimer] > 12) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_NORMAL);
        data[sRecoil_StateTimer] = 0;
        data[sRecoil_State]++;
      }
      break;
    case 3:
      // a hop back to where it was
      if (++data[sRecoil_StateTimer] > 16) Scene3_StartNidorinoHop(sprite, sNidorinoRecoilReturnTime, -sprite.x2, 4);
      break;
  }
}

function Scene3_NidorinoAnimIsRunning(ptr: IntroSequenceData): boolean {
  return ptr.scene3NidorinoSprite!.callback !== SpriteCallbackDummy;
}

// SpriteCB_RecoilDust's data
const sDust_State = 0;
const sDust_X = 1;
const sDust_Y = 2;
const sDust_SpeedX = 3;
const sDust_SpeedY = 4;
const sDust_InvisibleTimer = 7;

/** CreateNidorinoRecoilDustSprites: a pair at the same place with different speeds, one visible at a time. */
function CreateNidorinoRecoilDustSprites(x: number, y: number, seed: number): void {
  x = (x << 16) >> 16; // s16
  y = (y << 16) >> 16;
  seed = (seed << 16) >> 16;
  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_NidorinoRecoilDust, x - 22, y + 24, 10);
    if (spriteId !== MAX_SPRITES) {
      const data = gSprites[spriteId].data;
      data[sDust_SpeedX] = (seed % 13) + 8;
      data[sDust_SpeedY] = seed % 3;
      data[sDust_InvisibleTimer] = i;
      seed = (Math.imul(seed, RAND_MULT) << 16) >> 16;
    }
  }
}

function SpriteCB_RecoilDust(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sDust_State]) {
    case 0:
      data[sDust_X] = sprite.x << 4;
      data[sDust_Y] = sprite.y << 4;
      data[sDust_State]++;
    // fallthrough
    case 1:
      data[sDust_X] -= data[sDust_SpeedX];
      data[sDust_Y] += data[sDust_SpeedY];
      sprite.x = data[sDust_X] >> 4;
      sprite.y = data[sDust_Y] >> 4;
      if (sprite.animEnded) DestroySprite(sprite);
      break;
  }
  // The dust flashes in and out (the C goes on with a destroyed sprite here; it's out of use, so it doesn't show)
  if (++data[sDust_InvisibleTimer] > 1) {
    data[sDust_InvisibleTimer] = 0;
    sprite.invisible = !sprite.invisible;
  }
}

// Scene3_StartNidorinoHop / SpriteCB_NidorinoHop's data
const sHop_State = 0;
const sHop_AirTime = 1;
const sHop_OffsetX = 2;
const sHop_SpeedX = 3;
const sHop_SinIdx = 4;
const sHop_SpeedY = 5;
const sHop_Timer = 6;
const sHop_HeightShift = 7;

function Scene3_StartNidorinoHop(sprite: Sprite, time: number, targetX: number, heightShift: number): void {
  targetX = (targetX << 16) >> 16; // s16
  const data = sprite.data;
  data[sHop_State] = 0;
  data[sHop_AirTime] = time;
  data[sHop_OffsetX] = sprite.x2 << 4;
  data[sHop_SpeedX] = Math.trunc((targetX << 4) / time);
  data[sHop_SinIdx] = 0;
  data[sHop_SpeedY] = Math.trunc(0x800 / time);
  data[sHop_Timer] = 0;
  data[sHop_HeightShift] = heightShift;
  StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
  sprite.callback = SpriteCB_NidorinoHop;
}

function SpriteCB_NidorinoHop(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sHop_State]) {
    case 0:
      if (++data[sHop_Timer] > 4) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_HOP);
        data[sHop_Timer] = 0;
        data[sHop_State]++;
      }
      break;
    case 1:
      if (--data[sHop_AirTime]) {
        // in the air
        data[sHop_OffsetX] += data[sHop_SpeedX];
        data[sHop_SinIdx] += data[sHop_SpeedY];
        sprite.x2 = data[sHop_OffsetX] >> 4;
        sprite.y2 = -(Sin(data[sHop_SinIdx] >> 4) >> data[sHop_HeightShift]);
      } else {
        // it lands
        sprite.x2 = ((data[sHop_OffsetX] & 0xffff) >> 4) << 16 >> 16; // (u16)sOffsetX >> 4 into the s16 x2
        sprite.y2 = 0;
        StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
        if (data[sHop_HeightShift] === 5) {
          // The short hops before the attack: it stays crouched
          sprite.callback = SpriteCallbackDummy;
        } else {
          data[sHop_Timer] = 0;
          data[sHop_State]++;
        }
      }
      break;
    case 2:
      if (++data[sHop_Timer] > 4) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_NORMAL);
        sprite.callback = SpriteCallbackDummy;
      }
      break;
  }
}

// SpriteCB_NidorinoAttack's data
const sAttack_State = 0;
const sAttack_Timer = 1;
const sAttack_ShakeTimer = 2;
const sAttack_Speed = 7;

function Scene3_StartNidorinoAttack(ptr: IntroSequenceData): void {
  const sprite = ptr.scene3NidorinoSprite!;
  sprite.data[sAttack_State] = 0;
  sprite.data[sAttack_Timer] = 0;
  sprite.data[sAttack_ShakeTimer] = 0;
  sprite.data[3] = 0; // unused
  sprite.data[4] = 0;
  sprite.data[5] = 0;
  sprite.x += sprite.x2;
  sprite.x2 = 0;
  // sNidorinoUnusedVar = 36: never read
  sNidorinoAnimDelayTime = 40;
  sNidorinoJumpMult = 3;
  sNidorinoJumpDiv = 4;
  sprite.data[sAttack_Speed] = 36;
  StartSpriteAnim(sprite, ANIM_NIDORINO_CROUCH);
  sprite.callback = SpriteCB_NidorinoAttack;
}

function SpriteCB_NidorinoAttack(sprite: Sprite): void {
  const data = sprite.data;
  switch (data[sAttack_State]) {
    case 0:
      if (++data[sAttack_Timer] & 1) {
        // a shake before it attacks
        if (++data[sAttack_ShakeTimer] & 1) sprite.x2++;
        else sprite.x2--;
      }
      if (data[sAttack_Timer] > 17) {
        data[sAttack_Timer] = 0;
        data[sAttack_State]++;
      }
      break;
    case 1:
      if (++data[sAttack_Timer] >= sNidorinoAnimDelayTime) {
        StartSpriteAnim(sprite, ANIM_NIDORINO_ATTACK);
        data[sAttack_Timer] = 0;
        data[sAttack_ShakeTimer] = 0;
        data[sAttack_State]++;
      }
      break;
    case 2:
      // the jump at Gengar, slowing as it goes
      data[sAttack_Timer] += data[sAttack_Speed];
      sprite.x2 = -(data[sAttack_Timer] >> 4);
      sprite.y2 = -((Sin(data[sAttack_Timer] >> 4) * sNidorinoJumpMult) >> sNidorinoJumpDiv);
      data[sAttack_ShakeTimer]++; // does nothing
      if (data[sAttack_Speed] > 12) data[sAttack_Speed]--;
      if (data[sAttack_Timer] >> 4 > 63) sprite.callback = SpriteCallbackDummy;
      break;
  }
}

// ------------------------------------------------------------------ test probe

/** For the tests: the copyright screen's gMain.state, or the intro's callback, its state and timer. */
export function introProbe(): { screen: string; callback?: string; state: number; timer?: number; sprites: number } | undefined {
  const cb2 = gMain.callback2;
  const sprites = gSprites.slice(0, MAX_SPRITES).filter((s) => s.inUse).length;
  if (cb2 === CB2_InitCopyrightScreenAfterBootup || cb2 === CB2_InitCopyrightScreenAfterTitleScreen) return { screen: 'copyright', state: gMain.state, sprites };
  if (cb2 === CB2_WaitFadeBeforeSetUpIntro || cb2 === CB2_SetUpIntro) return { screen: 'setUp', state: gMain.state, sprites };
  if (cb2 === CB2_Intro && sIntro) return { screen: 'intro', callback: sIntro.callback.name, state: sIntro.state, timer: sIntro.timer, sprites };
  return undefined;
}
