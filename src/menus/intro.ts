// intro.c (FireRed): the copyright screen and the intro movie in front of the title screen. The copyright screen
// (CB2_InitCopyrightScreenAfterBootup at boot, CB2_InitCopyrightScreenAfterTitleScreen when the title screen's timer
// runs out) fades in from white, holds, fades to black and hands to CB2_SetUpIntro. The movie is one task
// (Task_CallIntroCallback) calling an IntroCallback, each a little state machine that SetIntroCB replaces with the
// next: IntroCB_Init → the Game Freak scene (IntroCB_GF_OpenWindow / _Star / _RevealName / _RevealLogo) → scene 1
// (the grass) → scene 2 (the forest, Gengar and Nidorino) → scene 3 (the fight) → IntroCB_ExitToTitleScreen.
// A / START / SELECT anywhere in the movie skip to IntroCB_ExitToTitleScreen. A host scene (scenes/MainMenuScene.ts)
// fills in `introEnv` and runs CB2_InitCopyrightScreenAfterBootup.
//
// Ported so far: the copyright screen, the framework and the Game Freak scene. TODO(W-intro unit 2): scenes 1-3
// (IntroCB_Scene1 below is a stub that goes on to IntroCB_ExitToTitleScreen).

import { HideBg, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, ShowBg, FillBgTilemapBufferRect, IsDma3ManagerBusyWithBgCopy, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_OBJ,
  BLDCNT_TGT2_ALL,
  DISPCNT_BG0_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTES_ALL,
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
  WININ_WIN1_BG_ALL,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
} from '../gba/hw';
import { A_BUTTON, gMain, JOY_NEW, SELECT_BUTTON, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, START_BUTTON } from '../gba/main';
import { DecompressAndCopyTileDataToVram, FreeTempTileDataBuffersIfPossible, ResetTempTileDataBuffers } from '../gba/menu';
import { IsBlendTaskActive, StartBlendTask } from '../gba/menu2';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, FillPalette, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { SetPokemonCryStereo } from '../audio/m4a';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
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
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_OBJ_BLEND,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, ResetTasks, RunTasks, type TaskFunc, gTasks } from '../gba/task';
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

/**
 * IntroCB_Scene1: the grass close-up, then scenes 2 and 3.
 * TODO(W-intro unit 2): port IntroCB_Scene1 (the grass and the BG zoom), IntroCB_Scene2 and IntroCB_Scene3_Entrance /
 * _Fight. Until then the movie ends here, as a skip would (IntroCB_ExitToTitleScreen).
 */
function IntroCB_Scene1(ptr: IntroSequenceData): void {
  SetIntroCB(ptr, IntroCB_ExitToTitleScreen);
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
