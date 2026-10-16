// oak_speech.c: NEW GAME's scene on the GBA layer. The controls guide (three pages), the Pikachu intro (three
// pages), then Oak's speech: Nidoran♀ out of its Poké Ball and back, BOY / GIRL, the player's name (a preset or the
// naming screen), the rival's name, "Let's go!" and the player pic shrinking into the world (an affine BG2) before
// CB2_NewGame. A host scene (scenes/MainMenuScene.ts) fills in `oakSpeechEnv` and runs StartNewGameScene; the
// names and gender go into the host's GameState (gSaveBlock1/2).

import { K } from '../battle/constants';
import { AllocateMonSpritesGfx, CreatePokeballSpriteToReleaseMon, CreateTradePokeballSprite, DecompressPicFromTable, FreeMonSpritesGfx, gMonSpritesGfxPtr, gMultiuseSpriteTemplate, monPalSymbols, monPicSymbol, SetMultiuseSpriteTemplateToPokemon } from '../battle/gfx';
import { Menu_LoadStdPalAt } from '../battle/battleBg';
import {
  BG_ATTR_WRAPAROUND,
  BG_COORD_SET,
  BG_COORD_SUB,
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyRectToBgTilemapBufferRect,
  CopyToBgTilemapBuffer,
  CopyToBgTilemapBufferRect,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  InitBgsFromTemplates,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgAffine,
  SetBgAttribute,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_OBJ,
  ClearGpuRegBits,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTES_ALL,
  pltt,
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
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetHBlankCallback, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import {
  ClearDialogWindowAndFrame,
  ClearStdWindowAndFrameToTransparent,
  CreateYesNoMenu,
  DecompressAndCopyTileDataToVram,
  DrawDialogueFrame,
  DrawStdFrameWithCustomTileAndPalette,
  FreeTempTileDataBuffersIfPossible,
  GetStdWindowBaseTileNum,
  GetTextSpeedSetting,
  GetTextWindowPalette,
  InitStandardTextBoxWindows,
  InitTextBoxGfxAndPrinters,
  Menu_InitCursor,
  Menu_ProcessInput,
  Menu_ProcessInputNoWrapAround,
  Menu_ProcessInputNoWrapClearOnChoose,
  MENU_B_PRESSED,
  MENU_NOTHING_CHOSEN,
  AddTextPrinterParameterized2,
  ResetTempTileDataBuffers,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalette, BlendPalettes, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { FadeOutBGM, IsCryFinished, PlayBGM, PlayCry_Normal, PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSpriteCoordOffsetX,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  setSpriteCoordOffset,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_OBJ_BLEND,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, RunTasks, type TaskFunc } from '../gba/task';
import { CreateTextCursorSprite, DestroyTextCursorSprite, textCursorGfxSymbols } from '../gba/textCursor';
import { ClearTopBarWindow, CreateTopBarWindowLoadPalette, DestroyTopBarWindow, TopBarWindowPrintString, TopBarWindowPrintTwoStrings } from '../gba/topBarWindow';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  ClearWindowTilemap,
  CopyWindowToVram,
  COPYWIN_FULL,
  FillWindowPixelBuffer,
  FONTATTR_MAX_LETTER_HEIGHT,
  FreeAllWindowBuffers,
  GetFontAttribute,
  gTextFlags,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  type WindowTemplate,
  DUMMY_WIN_TEMPLATE,
} from '../gba/window';
import { EOS } from '../text/charmap';
import { FONT_MALE, FONT_NORMAL } from '../text/Font';
import { ballGfxSymbols } from '../battle/gfx';
import { DoNamingScreen, NAMING_SCREEN_PLAYER, NAMING_SCREEN_RIVAL } from './namingScreen';
import { StringExpandPlaceholders } from './common';
import { testEvent } from '../dev/testHooks';

/** What Oak's speech reads and writes outside oak_speech.c. */
export const oakSpeechEnv = {
  /** A gText_* / gOakSpeech_Text_* string, encoded with EOS. */
  text: (_label: string): number[] => [EOS],
  /** gSaveBlock2Ptr->playerGender = MALE / FEMALE */
  setPlayerGender: (_gender: number): void => {},
  getPlayerGender: (): number => 0,
  /** gSaveBlock2Ptr->playerName / gSaveBlock1Ptr->rivalName (encoded, EOS-terminated) */
  setPlayerName: (_name: number[]): void => {},
  setRivalName: (_name: number[]): void => {},
  /** Random() */
  random: (): number => 0,
  /** SetMainCallback2(CB2_NewGame) */
  newGame: (): void => {},
};

const INTRO_SPECIES = () => K.SPECIES_NIDORAN_F;
const PALETTES_OBJECTS = 0xffff0000;
const MALE = 0;
const FEMALE = 1;
const PLAYER_NAME_LENGTH = 7;

// windows
const WIN_INTRO_TEXTBOX = 0;
const WIN_INTRO_BOYGIRL = 1;
const WIN_INTRO_YESNO = 2;
const WIN_INTRO_NAMES = 3;
const NUM_INTRO_WINDOWS = 4;

/** struct OakSpeechResources (the tilemaps are owned by the BGs) */
interface OakSpeechResources {
  hasPlayerBeenNamed: boolean;
  currentPage: number;
  windowIds: number[];
  textColor: number[];
  textSpeed: number;
  bg2TilemapBuffer: Uint16Array;
  bg1TilemapBuffer: Uint16Array;
}

let sOakSpeechResources: OakSpeechResources | null = null;
const R = (): OakSpeechResources => sOakSpeechResources!;

/** The graphics Oak's speech loads (preload before StartNewGameScene). */
export function oakSpeechGfxSymbols(): string[] {
  return [
    'sOakSpeech_Background_Pals',
    'sControlsGuide_PikachuIntro_Background_Tiles',
    'sPikachuIntro_Background_Tilemap',
    'sOakSpeech_Background_Tiles',
    'sOakSpeech_Background_Tilemap',
    'sControlsGuide_Tilemap_Page2',
    'sControlsGuide_Tilemap_Page3',
    'sOakSpeech_Leaf_Pal',
    'sOakSpeech_Leaf_Tiles',
    'sOakSpeech_Red_Pal',
    'sOakSpeech_Red_Tiles',
    'sOakSpeech_Oak_Pal',
    'sOakSpeech_Oak_Tiles',
    'sOakSpeech_Rival_Pal',
    'sOakSpeech_Rival_Tiles',
    'sOakSpeech_Platform_Pal',
    'sPikachuIntro_Pikachu_Pal',
    'sOakSpeech_Platform_Gfx',
    'sPikachuIntro_PikachuBody_Gfx',
    'sPikachuIntro_PikachuEars_Gfx',
    'sPikachuIntro_PikachuEyes_Gfx',
    'gStandardMenuPalette',
    'gKeypadIconTiles', // {A_BUTTON} etc. in the top bar and the controls guide
    'sDownArrowTiles', // the message box's down arrow
    ...textCursorGfxSymbols,
    ...ballGfxSymbols(),
    monPicSymbol(true, INTRO_SPECIES(), 0),
    ...monPalSymbols(INTRO_SPECIES()),
  ];
}

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 28, screenSize: 1, paletteMode: 1, priority: 1, baseTile: 0 },
];

// controls guide pages and windows
const CONTROLS_GUIDE_PAGE_1 = 0;
const CONTROLS_GUIDE_PAGE_2 = 1;
const CONTROLS_GUIDE_PAGE_3 = 2;
const NUM_CONTROLS_GUIDE_PAGES = 3;
const NUM_CONTROLS_GUIDE_PAGE_1_WINDOWS = 1;
const NUM_CONTROLS_GUIDE_PAGES_2_3_WINDOWS = 3;

const win = (tilemapLeft: number, tilemapTop: number, width: number, height: number, baseBlock: number): WindowTemplate => ({ bg: 0, tilemapLeft, tilemapTop, width, height, paletteNum: 15, baseBlock });

const sControlsGuide_WindowTemplates: WindowTemplate[][] = [
  [win(0, 7, 30, 4, 1), DUMMY_WIN_TEMPLATE],
  [win(6, 3, 24, 6, 1), win(6, 10, 24, 4, 146), win(6, 15, 24, 4, 243), DUMMY_WIN_TEMPLATE],
  [win(6, 3, 24, 4, 1), win(6, 8, 24, 4, 98), win(6, 13, 24, 6, 195), DUMMY_WIN_TEMPLATE],
];

const sIntro_WindowTemplates: WindowTemplate[] = [];
sIntro_WindowTemplates[WIN_INTRO_TEXTBOX] = { bg: 0, tilemapLeft: 1, tilemapTop: 4, width: 28, height: 15, paletteNum: 15, baseBlock: 1 };
sIntro_WindowTemplates[WIN_INTRO_BOYGIRL] = { bg: 0, tilemapLeft: 18, tilemapTop: 9, width: 9, height: 4, paletteNum: 15, baseBlock: 372 };
sIntro_WindowTemplates[WIN_INTRO_YESNO] = { bg: 0, tilemapLeft: 2, tilemapTop: 2, width: 6, height: 4, paletteNum: 15, baseBlock: 384 };
sIntro_WindowTemplates[WIN_INTRO_NAMES] = { bg: 0, tilemapLeft: 2, tilemapTop: 2, width: 12, height: 10, paletteNum: 15, baseBlock: 1 };
sIntro_WindowTemplates[NUM_INTRO_WINDOWS] = DUMMY_WIN_TEMPLATE;

const sTextColor_White = [0, 1, 2, 0];
const sTextColor_DarkGray = [0, 2, 3, 0];

const PIKACHU_INTRO_PAGE_1 = 0;
const NUM_PIKACHU_INTRO_PAGES = 3;
const sPikachuIntro_Strings = ['gPikachuIntro_Text_Page1', 'gPikachuIntro_Text_Page2', 'gPikachuIntro_Text_Page3'];

const GFX_TAG_PLATFORM = 0x1000;
const GFX_TAG_PIKACHU = 0x1001;
const GFX_TAG_PIKACHU_EARS = 0x1002;
const GFX_TAG_PIKACHU_EYES = 0x1003;
const PAL_TAG_PLATFORM = 0x1000;
const PAL_TAG_PIKACHU = 0x1001;

const SPRITE_TYPE_PIKACHU = 0;
const SPRITE_TYPE_PLATFORM = 1;
const NUM_PIKACHU_PLATFORM_SPRITES = 3;

const sPikachuIntro_Pikachu_SpriteSheets = () => [
  { data: gfx('sPikachuIntro_PikachuBody_Gfx'), size: 0x400, tag: GFX_TAG_PIKACHU },
  { data: gfx('sPikachuIntro_PikachuEars_Gfx'), size: 0x200, tag: GFX_TAG_PIKACHU_EARS },
  { data: gfx('sPikachuIntro_PikachuEyes_Gfx'), size: 0x80, tag: GFX_TAG_PIKACHU_EYES },
];

const oam32x32 = (objMode = 0) => oam({ objMode, shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1] });

const platformTemplate = (frame: number): SpriteTemplate => ({
  tileTag: GFX_TAG_PLATFORM,
  paletteTag: PAL_TAG_PLATFORM,
  oam: oam32x32(ST_OAM_OBJ_BLEND), // gOamData_AffineOff_ObjBlend_32x32
  anims: [[ANIMCMD_FRAME(frame, 0), ANIMCMD_END]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
});
const sOakSpeech_Platform_SpriteTemplates = [platformTemplate(0), platformTemplate(16), platformTemplate(32)];

const sPikachuIntro_PikachuBody_Anim = [ANIMCMD_FRAME(0, 30), ANIMCMD_FRAME(16, 30), ANIMCMD_JUMP(0)];
const sPikachuIntro_PikachuEars_Anim = [
  ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60),
  ANIMCMD_FRAME(8, 12), ANIMCMD_FRAME(0, 12), ANIMCMD_FRAME(8, 12),
  ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60),
  ANIMCMD_FRAME(8, 12), ANIMCMD_FRAME(0, 12), ANIMCMD_FRAME(8, 12),
  ANIMCMD_JUMP(0),
];
const sPikachuIntro_PikachuEyes_Anim = [
  ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60),
  ANIMCMD_FRAME(2, 8), ANIMCMD_FRAME(0, 8), ANIMCMD_FRAME(2, 8),
  ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(0, 60),
  ANIMCMD_FRAME(2, 8), ANIMCMD_FRAME(0, 8), ANIMCMD_FRAME(2, 8),
  ANIMCMD_JUMP(0),
];

const sPikachuIntro_Pikachu_SpriteTemplates: SpriteTemplate[] = [
  { tileTag: GFX_TAG_PIKACHU, paletteTag: PAL_TAG_PIKACHU, oam: oam32x32(), anims: [sPikachuIntro_PikachuBody_Anim], images: null, affineAnims: gDummySpriteAffineAnimTable, callback: SpriteCallbackDummy },
  {
    tileTag: GFX_TAG_PIKACHU_EARS,
    paletteTag: PAL_TAG_PIKACHU,
    oam: oam({ shape: SPRITE_SHAPE['32x16'][0], size: SPRITE_SHAPE['32x16'][1] }),
    anims: [sPikachuIntro_PikachuEars_Anim],
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  },
  {
    tileTag: GFX_TAG_PIKACHU_EYES,
    paletteTag: PAL_TAG_PIKACHU,
    oam: oam({ shape: SPRITE_SHAPE['16x8'][0], size: SPRITE_SHAPE['16x8'][1] }),
    anims: [sPikachuIntro_PikachuEyes_Anim],
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  },
];

const CONTROLS_GUIDE_STRINGS_PER_PAGE = 3;
const sControlsGuide_Pages2And3_Strings = [
  'gControlsGuide_Text_DPad',
  'gControlsGuide_Text_AButton',
  'gControlsGuide_Text_BButton',
  'gControlsGuide_Text_StartButton',
  'gControlsGuide_Text_SelectButton',
  'gControlsGuide_Text_LRButtons',
];

const choices = (names: string) => names.split(' ').map((n) => `gNameChoice_${n}`);
const sMaleNameChoices = choices('Red Fire Ash Kene Geki Jak Janne Jonn Kamon Karl Taylor Oscar Hiro Max Jon Ralph Kay Tosh Roak');
const sFemaleNameChoices = choices('Red Fire Omi Jodi Amanda Hillary Makey Michi Paula June Cassie Rey Seda Kiko Mina Norie Sai Momo Suzi');
const sRivalNameChoices = choices('Green Gary Kaz Toru');

const MALE_PLAYER_PIC = 0;
const FEMALE_PLAYER_PIC = 1;
const RIVAL_PIC = 2;
const OAK_PIC = 3;

const T = (label: string) => oakSpeechEnv.text(label);

function VBlankCB_NewGameScene(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_NewGameScene(): void {
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** StartNewGameScene (main menu NEW GAME) */
export function StartNewGameScene(): void {
  gPlttBufferUnfaded[0] = RGB_BLACK;
  gPlttBufferFaded[0] = RGB_BLACK;
  CreateTask(Task_NewGameScene, 0);
  SetMainCallback2(CB2_NewGameScene);
  testEvent('oakSpeech');
}

// task data
const tSpriteTimer = 0;
const tTrainerPicPosX = 1;
const tTrainerPicFadeState = 2;
const tTimer = 3;
const tNidoranFSpriteId = 4;
const tTextCursorSpriteId = 5;
const tPokeBallSpriteId = 6;
const tPikachuPlatformSpriteId = (i: number) => 7 + i;
const tMenuWindowId = 13;
const tTextboxWindowId = 14;
const tDelta = 15;
const tBlendTarget = 15;
const tNameNotConfirmed = 15;

const Task_NewGameScene: TaskFunc = (taskId) => {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      SetHBlankCallback(null);
      vram.fill(0);
      pltt.fill(0, 1); // OAM is ResetSpriteData's
      ResetPaletteFade();
      ScanlineEffect_Stop();
      ResetSpriteData();
      FreeAllSpritePalettes();
      ResetTempTileDataBuffers();
      // SetHelpContext(HELPCONTEXT_NEW_GAME): no help system
      break;
    case 1:
      sOakSpeechResources = {
        hasPlayerBeenNamed: false,
        currentPage: 0,
        windowIds: [0, 0, 0, 0],
        textColor: [0, 0, 0],
        textSpeed: 0,
        bg2TilemapBuffer: new Uint16Array(0x400 / 2),
        bg1TilemapBuffer: new Uint16Array(0x800 / 2),
      };
      AllocateMonSpritesGfx(); // CreateMonSpritesGfxManager(1, 1)
      break;
    case 2:
      SetGpuReg(REG_OFFSET_WIN0H, 0);
      SetGpuReg(REG_OFFSET_WIN0V, 0);
      SetGpuReg(REG_OFFSET_WIN1H, 0);
      SetGpuReg(REG_OFFSET_WIN1V, 0);
      SetGpuReg(REG_OFFSET_WININ, 0);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      break;
    case 3:
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(1, sBgTemplates);
      SetBgTilemapBuffer(1, R().bg1TilemapBuffer);
      SetBgTilemapBuffer(2, R().bg2TilemapBuffer);
      ChangeBgX(1, 0, BG_COORD_SET);
      ChangeBgY(1, 0, BG_COORD_SET);
      ChangeBgX(2, 0, BG_COORD_SET);
      ChangeBgY(2, 0, BG_COORD_SET);
      setSpriteCoordOffset(0, 0);
      break;
    case 4:
      gPaletteFade.bufferTransferDisabled = true;
      InitStandardTextBoxWindows();
      InitTextBoxGfxAndPrinters();
      Menu_LoadStdPalAt(BG_PLTT_ID(13));
      LoadBackgroundPals();
      LoadPalette(GetTextWindowPalette(2).subarray(15), BG_PLTT_ID(0), 2);
      break;
    case 5:
      R().textSpeed = GetTextSpeedSetting();
      gTextFlags.canABSpeedUpPrint = true;
      DecompressAndCopyTileDataToVram(1, gfx('sControlsGuide_PikachuIntro_Background_Tiles'), 0, 0, 0);
      break;
    case 6:
      if (FreeTempTileDataBuffersIfPossible()) return;
      ClearDialogWindowAndFrame(WIN_INTRO_TEXTBOX, true);
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 32, 32);
      CopyBgTilemapBufferToVram(1);
      break;
    case 7:
      CreateTopBarWindowLoadPalette(0, 30, 0, 13, 0x1c4);
      FillBgTilemapBufferRect_Palette0(1, 0xd00f, 0, 0, 30, 2);
      FillBgTilemapBufferRect_Palette0(1, 0xd002, 0, 2, 30, 1);
      FillBgTilemapBufferRect_Palette0(1, 0xd00e, 0, 19, 30, 1);
      ControlsGuide_LoadPage1();
      gPaletteFade.bufferTransferDisabled = false;
      gTasks[taskId].data[tTextCursorSpriteId] = CreateTextCursorSprite(0, 230, 149, 0, 0);
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      break;
    case 10:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      ShowBg(0);
      ShowBg(1);
      SetVBlankCallback(VBlankCB_NewGameScene);
      PlayBGM(K.MUS_NEW_GAME_INSTRUCT);
      gTasks[taskId].func = Task_ControlsGuide_HandleInput;
      gMain.state = 0;
      return;
  }
  gMain.state++;
};

/** sOakSpeech_Background_Pals (shared by the controls guide, the Pikachu intro and Oak's speech) */
function LoadBackgroundPals(): void {
  const pals = gfx16('sOakSpeech_Background_Pals');
  LoadPalette(pals, BG_PLTT_ID(0), pals.length * 2);
}

function ControlsGuide_LoadPage1(): void {
  TopBarWindowPrintTwoStrings(T('gText_Controls'), T('gText_ABUTTONNext'), false, 0, true);
  R().windowIds[0] = AddWindow(sControlsGuide_WindowTemplates[R().currentPage][0]);
  PutWindowTilemap(R().windowIds[0]);
  FillWindowPixelBuffer(R().windowIds[0], PIXEL_FILL(0));
  AddTextPrinterParameterized4(R().windowIds[0], FONT_NORMAL, 2, 0, 1, 1, sTextColor_White, 0, T('gControlsGuide_Text_Intro'));
  CopyWindowToVram(R().windowIds[0], COPYWIN_FULL);
  FillBgTilemapBufferRect_Palette0(1, 0x3000, 1, 3, 5, 16);
  CopyBgTilemapBufferToVram(1);
}

const Task_ControlsGuide_LoadPage: TaskFunc = (taskId) => {
  const page2Or3 = R().currentPage - 1;
  if (R().currentPage === CONTROLS_GUIDE_PAGE_1) {
    ControlsGuide_LoadPage1();
  } else {
    TopBarWindowPrintString(T('gText_ABUTTONNext_BBUTTONBack'), 0, true);
    for (let currWindow = 0; currWindow < NUM_CONTROLS_GUIDE_PAGES_2_3_WINDOWS; currWindow++) {
      R().windowIds[currWindow] = AddWindow(sControlsGuide_WindowTemplates[R().currentPage][currWindow]);
      PutWindowTilemap(R().windowIds[currWindow]);
      FillWindowPixelBuffer(R().windowIds[currWindow], PIXEL_FILL(0));
      AddTextPrinterParameterized4(R().windowIds[currWindow], FONT_NORMAL, 6, 0, 1, 1, sTextColor_White, 0, T(sControlsGuide_Pages2And3_Strings[currWindow + page2Or3 * CONTROLS_GUIDE_STRINGS_PER_PAGE]));
      CopyWindowToVram(R().windowIds[currWindow], COPYWIN_FULL);
    }
    if (R().currentPage === CONTROLS_GUIDE_PAGE_2) CopyToBgTilemapBufferRect(1, gfx16('sControlsGuide_Tilemap_Page2'), 1, 3, 5, 16);
    else CopyToBgTilemapBufferRect(1, gfx16('sControlsGuide_Tilemap_Page3'), 1, 3, 5, 16);
    CopyBgTilemapBufferToVram(1);
  }
  BeginNormalPaletteFade((PALETTES_OBJECTS | 0xdfff) >>> 0, -1, 16, 0, GetTextWindowPalette(2)[15]);
  gTasks[taskId].func = Task_ControlsGuide_HandleInput;
};

const Task_ControlsGuide_HandleInput: TaskFunc = (taskId) => {
  if (gPaletteFade.active) return;
  if (!JOY_NEW(A_BUTTON | B_BUTTON)) return;
  if (JOY_NEW(A_BUTTON)) {
    gTasks[taskId].data[tDelta] = 1;
    if (R().currentPage < CONTROLS_GUIDE_PAGE_3) BeginNormalPaletteFade((PALETTES_OBJECTS | 0xdfff) >>> 0, -1, 0, 16, GetTextWindowPalette(2)[15]);
  } else {
    if (R().currentPage === CONTROLS_GUIDE_PAGE_1) return;
    gTasks[taskId].data[tDelta] = -1;
    BeginNormalPaletteFade((PALETTES_OBJECTS | 0xdfff) >>> 0, -1, 0, 16, GetTextWindowPalette(2)[15]);
  }
  PlaySE(K.SE_SELECT);
  gTasks[taskId].func = Task_ControlsGuide_ChangePage;
};

const Task_ControlsGuide_ChangePage: TaskFunc = (taskId) => {
  if (gPaletteFade.active) return;
  let numWindows = 0;
  switch (R().currentPage) {
    case CONTROLS_GUIDE_PAGE_1:
      numWindows = NUM_CONTROLS_GUIDE_PAGE_1_WINDOWS;
      break;
    case CONTROLS_GUIDE_PAGE_2:
    case CONTROLS_GUIDE_PAGE_3:
      numWindows = NUM_CONTROLS_GUIDE_PAGES_2_3_WINDOWS;
      break;
  }
  R().currentPage = (R().currentPage + gTasks[taskId].data[tDelta]) & 0xffff;
  if (R().currentPage < NUM_CONTROLS_GUIDE_PAGES) {
    for (let i = 0; i < numWindows; i++) {
      FillWindowPixelBuffer(R().windowIds[i], PIXEL_FILL(0));
      ClearWindowTilemap(R().windowIds[i]);
      CopyWindowToVram(R().windowIds[i], COPYWIN_FULL);
      RemoveWindow(R().windowIds[i]);
      R().windowIds[i] = 0;
    }
    gTasks[taskId].func = Task_ControlsGuide_LoadPage;
  } else {
    BeginNormalPaletteFade(PALETTES_ALL, 2, 0, 16, 0);
    gTasks[taskId].func = Task_ControlsGuide_Clear;
  }
};

const Task_ControlsGuide_Clear: TaskFunc = (taskId) => {
  if (gPaletteFade.active) return;
  for (let i = 0; i < NUM_CONTROLS_GUIDE_PAGES_2_3_WINDOWS; i++) {
    FillWindowPixelBuffer(R().windowIds[i], PIXEL_FILL(0));
    ClearWindowTilemap(R().windowIds[i]);
    CopyWindowToVram(R().windowIds[i], COPYWIN_FULL);
    RemoveWindow(R().windowIds[i]);
    R().windowIds[i] = 0;
  }
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 2, 30, 18);
  CopyBgTilemapBufferToVram(1);
  DestroyTextCursorSprite(gTasks[taskId].data[tTextCursorSpriteId]);
  R().windowIds[0] = RGB_BLACK;
  LoadPalette([RGB_BLACK], BG_PLTT_ID(0), 2);
  gTasks[taskId].data[tTimer] = 32;
  gTasks[taskId].func = Task_PikachuIntro_LoadPage1;
};

// Pikachu intro states (gMain.state)
const PIKACHU_INTRO_SET_GPU_REGS = 0;
const PIKACHU_INTRO_HANDLE_INPUT = 1;
const PIKACHU_INTRO_PRINT_PAGE_TEXT = 2;
const PIKACHU_INTRO_FADE_IN_PAGE = 3;
const PIKACHU_INTRO_EXIT = 4;

const Task_PikachuIntro_LoadPage1: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTimer] !== 0) {
    data[tTimer]--;
    return;
  }
  PlayBGM(K.MUS_NEW_GAME_INTRO);
  ClearTopBarWindow();
  TopBarWindowPrintString(T('gText_ABUTTONNext'), 0, true);
  CopyToBgTilemapBufferRect(1, gfx16('sPikachuIntro_Background_Tilemap'), 0, 2, 30, 19);
  CopyBgTilemapBufferToVram(1);
  data[tTextboxWindowId] = AddWindow(sIntro_WindowTemplates[WIN_INTRO_TEXTBOX]);
  PutWindowTilemap(data[tTextboxWindowId]);
  FillWindowPixelBuffer(data[tTextboxWindowId], PIXEL_FILL(0));
  CopyWindowToVram(data[tTextboxWindowId], COPYWIN_FULL);
  R().currentPage = PIKACHU_INTRO_PAGE_1;
  gMain.state = PIKACHU_INTRO_SET_GPU_REGS;
  data[tBlendTarget] = 16;
  AddTextPrinterParameterized4(data[tTextboxWindowId], FONT_NORMAL, 3, 5, 1, 0, sTextColor_DarkGray, 0, T(sPikachuIntro_Strings[PIKACHU_INTRO_PAGE_1]));
  data[tTextCursorSpriteId] = CreateTextCursorSprite(0, 226, 145, 0, 0);
  gSprites[data[tTextCursorSpriteId]].oam.objMode = ST_OAM_OBJ_BLEND;
  gSprites[data[tTextCursorSpriteId]].oam.priority = 0;
  CreatePikachuOrPlatformSprites(taskId, SPRITE_TYPE_PIKACHU);
  BeginNormalPaletteFade(PALETTES_ALL, 2, 16, 0, 0);
  gTasks[taskId].func = Task_PikachuIntro_HandleInput;
};

const Task_PikachuIntro_HandleInput: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (gMain.state) {
    case PIKACHU_INTRO_SET_GPU_REGS:
      if (!gPaletteFade.active) {
        SetGpuReg(REG_OFFSET_WIN0H, DISPLAY_WIDTH);
        SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(16, DISPLAY_HEIGHT));
        SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_CLR | WININ_WIN0_OBJ);
        SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ);
        SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
        gMain.state = PIKACHU_INTRO_HANDLE_INPUT;
      }
      break;
    case PIKACHU_INTRO_HANDLE_INPUT:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) {
        if (JOY_NEW(A_BUTTON)) {
          R().currentPage++;
        } else if (R().currentPage !== PIKACHU_INTRO_PAGE_1) {
          R().currentPage--;
        } else {
          break;
        }
        PlaySE(K.SE_SELECT);
        if (R().currentPage === NUM_PIKACHU_INTRO_PAGES) {
          gMain.state = PIKACHU_INTRO_EXIT;
        } else {
          SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG1);
          SetGpuReg(REG_OFFSET_BLDALPHA, (16 - data[tBlendTarget]) | data[tBlendTarget]);
          gMain.state++;
        }
      }
      break;
    case PIKACHU_INTRO_PRINT_PAGE_TEXT:
      data[tBlendTarget] -= 2;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(data[tBlendTarget], 16 - data[tBlendTarget]));
      if (data[tBlendTarget] <= 0) {
        FillWindowPixelBuffer(data[tTextboxWindowId], PIXEL_FILL(0));
        AddTextPrinterParameterized4(data[tTextboxWindowId], FONT_NORMAL, 3, 5, 1, 0, sTextColor_DarkGray, 0, T(sPikachuIntro_Strings[R().currentPage]));
        ClearTopBarWindow();
        TopBarWindowPrintString(T(R().currentPage === PIKACHU_INTRO_PAGE_1 ? 'gText_ABUTTONNext' : 'gText_ABUTTONNext_BBUTTONBack'), 0, true);
        gMain.state++;
      }
      break;
    case PIKACHU_INTRO_FADE_IN_PAGE:
      data[tBlendTarget] += 2;
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(data[tBlendTarget], 16 - data[tBlendTarget]));
      if (data[tBlendTarget] >= 16) {
        data[tBlendTarget] = 16;
        SetGpuReg(REG_OFFSET_BLDCNT, 0);
        SetGpuReg(REG_OFFSET_BLDALPHA, 0);
        gMain.state = PIKACHU_INTRO_HANDLE_INPUT;
      }
      break;
    case PIKACHU_INTRO_EXIT:
      DestroyTextCursorSprite(data[tTextCursorSpriteId]);
      PlayBGM(K.MUS_NEW_GAME_EXIT);
      data[tBlendTarget] = 24;
      gMain.state++;
      break;
    default:
      if (data[tBlendTarget] !== 0) {
        data[tBlendTarget]--;
      } else {
        gMain.state = 0;
        R().currentPage = 0;
        SetGpuReg(REG_OFFSET_WIN0H, 0);
        SetGpuReg(REG_OFFSET_WIN0V, 0);
        SetGpuReg(REG_OFFSET_WININ, 0);
        SetGpuReg(REG_OFFSET_WINOUT, 0);
        ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
        BeginNormalPaletteFade(PALETTES_ALL, 2, 0, 16, RGB_BLACK);
        gTasks[taskId].func = Task_PikachuIntro_Clear;
      }
      break;
  }
};

const Task_PikachuIntro_Clear: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  DestroyTopBarWindow();
  FillWindowPixelBuffer(data[tTextboxWindowId], PIXEL_FILL(0));
  ClearWindowTilemap(data[tTextboxWindowId]);
  CopyWindowToVram(data[tTextboxWindowId], COPYWIN_FULL);
  RemoveWindow(data[tTextboxWindowId]);
  data[tTextboxWindowId] = 0;
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 20);
  CopyBgTilemapBufferToVram(1);
  DestroyPikachuOrPlatformSprites(taskId, SPRITE_TYPE_PIKACHU);
  data[tTimer] = 80;
  gTasks[taskId].func = Task_OakSpeech_Init;
};

const Task_OakSpeech_Init: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTimer] !== 0) {
    data[tTimer]--;
    return;
  }
  const tiles = gfx('sOakSpeech_Background_Tiles');
  LoadBgTiles(1, tiles, tiles.length, 0);
  CopyToBgTilemapBuffer(1, gfx16('sOakSpeech_Background_Tilemap'), 0, 0);
  CopyBgTilemapBufferToVram(1);
  CreateNidoranFSprite(taskId);
  LoadTrainerPic(OAK_PIC, 0);
  CreatePikachuOrPlatformSprites(taskId, SPRITE_TYPE_PLATFORM);
  PlayBGM(K.MUS_ROUTE24);
  BeginNormalPaletteFade(PALETTES_ALL, 5, 16, 0, RGB_BLACK);
  data[tTimer] = 80;
  ShowBg(2);
  gTasks[taskId].func = Task_OakSpeech_WelcomeToTheWorld;
};

/** OakSpeechPrintMessage: `str` is a string label, or already expanded text (gStringVar4). */
function OakSpeechPrintMessage(str: number[], speed: number, expanded = false): void {
  DrawDialogueFrame(WIN_INTRO_TEXTBOX, false);
  const text = expanded ? str : StringExpandPlaceholders(str);
  AddTextPrinterParameterized2(WIN_INTRO_TEXTBOX, FONT_MALE, text, speed, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(WIN_INTRO_TEXTBOX, COPYWIN_FULL);
}

const Task_OakSpeech_WelcomeToTheWorld: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  if (data[tTimer] !== 0) {
    data[tTimer]--;
  } else {
    OakSpeechPrintMessage(T('gOakSpeech_Text_WelcomeToTheWorld'), R().textSpeed);
    gTasks[taskId].func = Task_OakSpeech_ThisWorld;
  }
};

const Task_OakSpeech_ThisWorld: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  OakSpeechPrintMessage(T('gOakSpeech_Text_ThisWorld'), R().textSpeed);
  gTasks[taskId].data[tTimer] = 30;
  gTasks[taskId].func = Task_OakSpeech_ReleaseNidoranFFromPokeBall;
};

const Task_OakSpeech_ReleaseNidoranFFromPokeBall: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  if (data[tTimer] !== 0) data[tTimer]--;
  const spriteId = data[tNidoranFSpriteId];
  gSprites[spriteId].invisible = false;
  gSprites[spriteId].data[tSpriteTimer] = 0;
  CreatePokeballSpriteToReleaseMon(spriteId, gSprites[spriteId].oam.paletteNum, 100, 66, 0, 0, 32, 0xffff1fff);
  gTasks[taskId].func = Task_OakSpeech_IsInhabitedFarAndWide;
  data[tTimer] = 0;
};

const Task_OakSpeech_IsInhabitedFarAndWide: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (IsCryFinished() && data[tTimer] >= 96) gTasks[taskId].func = Task_OakSpeech_IStudyPokemon;
  if (data[tTimer] < 0x4000) {
    data[tTimer]++;
    if (data[tTimer] === 32) {
      OakSpeechPrintMessage(T('gOakSpeech_Text_IsInhabitedFarAndWide'), R().textSpeed);
      PlayCry_Normal(INTRO_SPECIES(), 0);
    }
  }
};

const Task_OakSpeech_IStudyPokemon: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  OakSpeechPrintMessage(T('gOakSpeech_Text_IStudyPokemon'), R().textSpeed);
  gTasks[taskId].func = Task_OakSpeech_ReturnNidoranFToPokeBall;
};

const Task_OakSpeech_ReturnNidoranFToPokeBall: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  ClearDialogWindowAndFrame(WIN_INTRO_TEXTBOX, true);
  const spriteId = data[tNidoranFSpriteId];
  data[tPokeBallSpriteId] = CreateTradePokeballSprite(spriteId, gSprites[spriteId].oam.paletteNum, 100, 66, 0, 0, 32, 0xffff1f3f);
  data[tTimer] = 48;
  data[tSpriteTimer] = 64;
  gTasks[taskId].func = Task_OakSpeech_TellMeALittleAboutYourself;
};

const Task_OakSpeech_TellMeALittleAboutYourself: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tSpriteTimer] !== 0) {
    if (data[tSpriteTimer] < 24) gSprites[data[tNidoranFSpriteId]].y--;
    data[tSpriteTimer]--;
  } else {
    if (data[tTimer] === 48) {
      DestroySprite(gSprites[data[tNidoranFSpriteId]]);
      DestroySprite(gSprites[data[tPokeBallSpriteId]]);
    }
    if (data[tTimer] !== 0) {
      data[tTimer]--;
    } else {
      OakSpeechPrintMessage(T('gOakSpeech_Text_TellMeALittleAboutYourself'), R().textSpeed);
      gTasks[taskId].func = Task_OakSpeech_FadeOutOak;
    }
  }
};

const Task_OakSpeech_FadeOutOak: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  ClearDialogWindowAndFrame(WIN_INTRO_TEXTBOX, true);
  CreateFadeInTask(taskId, 2);
  gTasks[taskId].data[tTimer] = 48;
  gTasks[taskId].func = Task_OakSpeech_AskPlayerGender;
};

const Task_OakSpeech_AskPlayerGender: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTrainerPicFadeState] === 0) return;
  if (data[tTimer] !== 0) {
    data[tTimer]--;
  } else {
    data[tTrainerPicPosX] = -60;
    ClearTrainerPic();
    OakSpeechPrintMessage(T('gOakSpeech_Text_AskPlayerGender'), R().textSpeed);
    gTasks[taskId].func = Task_OakSpeech_ShowGenderOptions;
  }
};

const Task_OakSpeech_ShowGenderOptions: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  data[tMenuWindowId] = AddWindow(sIntro_WindowTemplates[WIN_INTRO_BOYGIRL]);
  PutWindowTilemap(data[tMenuWindowId]);
  DrawStdFrameWithCustomTileAndPalette(data[tMenuWindowId], true, GetStdWindowBaseTileNum(), 14);
  FillWindowPixelBuffer(data[tMenuWindowId], PIXEL_FILL(1));
  R().textColor = [1, 2, 3];
  AddTextPrinterParameterized3(data[tMenuWindowId], FONT_NORMAL, 8, 1, R().textColor, 0, T('gText_Boy'));
  AddTextPrinterParameterized3(data[tMenuWindowId], FONT_NORMAL, 8, 17, R().textColor, 0, T('gText_Girl'));
  Menu_InitCursor(data[tMenuWindowId], FONT_NORMAL, 0, 1, GetFontAttribute(FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT) + 2, 2, 0);
  CopyWindowToVram(data[tMenuWindowId], COPYWIN_FULL);
  gTasks[taskId].func = Task_OakSpeech_HandleGenderInput;
};

const Task_OakSpeech_HandleGenderInput: TaskFunc = (taskId) => {
  const input = Menu_ProcessInputNoWrapAround();
  switch (input) {
    case 0: // BOY
      oakSpeechEnv.setPlayerGender(MALE);
      break;
    case 1: // GIRL
      oakSpeechEnv.setPlayerGender(FEMALE);
      break;
    case MENU_B_PRESSED:
    case MENU_NOTHING_CHOSEN:
      return;
  }
  gTasks[taskId].func = Task_OakSpeech_ClearGenderWindows;
};

const Task_OakSpeech_ClearGenderWindows: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  ClearStdWindowAndFrameToTransparent(data[tMenuWindowId], true);
  RemoveWindow(data[tMenuWindowId]);
  data[tMenuWindowId] = WIN_INTRO_TEXTBOX;
  ClearDialogWindowAndFrame(data[tMenuWindowId], true);
  FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 30, 20);
  CopyBgTilemapBufferToVram(0);
  gTasks[taskId].func = Task_OakSpeech_LoadPlayerPic;
};

const Task_OakSpeech_LoadPlayerPic: TaskFunc = (taskId) => {
  LoadTrainerPic(oakSpeechEnv.getPlayerGender() === MALE ? MALE_PLAYER_PIC : FEMALE_PLAYER_PIC, 0);
  CreateFadeOutTask(taskId, 2);
  gTasks[taskId].data[tTimer] = 32;
  gTasks[taskId].func = Task_OakSpeech_YourNameWhatIsIt;
};

const Task_OakSpeech_YourNameWhatIsIt: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTrainerPicFadeState] === 0) return;
  if (data[tTimer] !== 0) {
    data[tTimer]--;
  } else {
    data[tTrainerPicPosX] = 0;
    OakSpeechPrintMessage(T('gOakSpeech_Text_YourNameWhatIsIt'), R().textSpeed);
    gTasks[taskId].func = Task_OakSpeech_FadeOutForPlayerNamingScreen;
  }
};

const Task_OakSpeech_FadeOutForPlayerNamingScreen: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
  R().hasPlayerBeenNamed = false;
  gTasks[taskId].func = Task_OakSpeech_DoNamingScreen;
};

const Task_OakSpeech_MoveRivalDisplayNameOptions: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  if (data[tTrainerPicPosX] > -60) {
    data[tTrainerPicPosX] -= 2;
    setSpriteCoordOffset(gSpriteCoordOffsetX + 2, 0);
    ChangeBgX(2, 0x200, BG_COORD_SUB);
  } else {
    data[tTrainerPicPosX] = -60;
    PrintNameChoiceOptions(taskId, R().hasPlayerBeenNamed);
    gTasks[taskId].func = Task_OakSpeech_HandleRivalNameInput;
  }
};

const Task_OakSpeech_RepeatNameQuestion: TaskFunc = (taskId) => {
  PrintNameChoiceOptions(taskId, R().hasPlayerBeenNamed);
  OakSpeechPrintMessage(T(R().hasPlayerBeenNamed ? 'gOakSpeech_Text_YourRivalsNameWhatWasIt' : 'gOakSpeech_Text_YourNameWhatIsIt'), 0);
  gTasks[taskId].func = Task_OakSpeech_HandleRivalNameInput;
};

const Task_OakSpeech_HandleRivalNameInput: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const input = Menu_ProcessInput();
  switch (input) {
    case 0: // NEW NAME
      PlaySE(K.SE_SELECT);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      gTasks[taskId].func = Task_OakSpeech_DoNamingScreen;
      break;
    case 1: // the preset names
    case 2:
    case 3:
    case 4:
      PlaySE(K.SE_SELECT);
      ClearStdWindowAndFrameToTransparent(data[tMenuWindowId], true);
      RemoveWindow(data[tMenuWindowId]);
      GetDefaultName(R().hasPlayerBeenNamed, input - 1);
      data[tNameNotConfirmed] = 1;
      gTasks[taskId].func = Task_OakSpeech_ConfirmName;
      break;
    case MENU_B_PRESSED:
      break;
  }
};

/** The naming screen's buffer (gSaveBlock2Ptr->playerName / gSaveBlock1Ptr->rivalName while it runs). */
let sNameBuffer: number[] = [];

const Task_OakSpeech_DoNamingScreen: TaskFunc = (taskId) => {
  if (gPaletteFade.active) return;
  GetDefaultName(R().hasPlayerBeenNamed, 0);
  if (!R().hasPlayerBeenNamed) {
    sNameBuffer = [...sPlayerName];
    DoNamingScreen(NAMING_SCREEN_PLAYER, sNameBuffer, oakSpeechEnv.getPlayerGender(), 0, 0, CB2_ReturnFromNamingScreen);
  } else {
    ClearStdWindowAndFrameToTransparent(gTasks[taskId].data[tMenuWindowId], true);
    RemoveWindow(gTasks[taskId].data[tMenuWindowId]);
    sNameBuffer = [...sRivalName];
    DoNamingScreen(NAMING_SCREEN_RIVAL, sNameBuffer, 0, 0, 0, CB2_ReturnFromNamingScreen);
  }
  DestroyPikachuOrPlatformSprites(taskId, SPRITE_TYPE_PLATFORM);
  FreeAllWindowBuffers();
};

const Task_OakSpeech_ConfirmName: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  if (data[tNameNotConfirmed] === 1) {
    const str = StringExpandPlaceholders(T(R().hasPlayerBeenNamed ? 'gOakSpeech_Text_ConfirmRivalName' : 'gOakSpeech_Text_SoYourNameIsPlayer'));
    OakSpeechPrintMessage(str, R().textSpeed, true);
    data[tNameNotConfirmed] = 0;
    data[tTimer] = 25;
  } else if (!IsTextPrinterActive(WIN_INTRO_TEXTBOX)) {
    if (data[tTimer] !== 0) {
      data[tTimer]--;
    } else {
      CreateYesNoMenu(sIntro_WindowTemplates[WIN_INTRO_YESNO], FONT_NORMAL, 0, 2, GetStdWindowBaseTileNum(), 14, 0);
      gTasks[taskId].func = Task_OakSpeech_HandleConfirmNameInput;
    }
  }
};

const Task_OakSpeech_HandleConfirmNameInput: TaskFunc = (taskId) => {
  const input = Menu_ProcessInputNoWrapClearOnChoose();
  switch (input) {
    case 0: // YES
      PlaySE(K.SE_SELECT);
      gTasks[taskId].data[tTimer] = 40;
      if (!R().hasPlayerBeenNamed) {
        ClearDialogWindowAndFrame(WIN_INTRO_TEXTBOX, true);
        CreateFadeInTask(taskId, 2);
        gTasks[taskId].func = Task_OakSpeech_FadeOutPlayerPic;
      } else {
        OakSpeechPrintMessage(StringExpandPlaceholders(T('gOakSpeech_Text_RememberRivalsName')), R().textSpeed, true);
        gTasks[taskId].func = Task_OakSpeech_FadeOutRivalPic;
      }
      break;
    case 1: // NO
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
      gTasks[taskId].func = R().hasPlayerBeenNamed ? Task_OakSpeech_RepeatNameQuestion : Task_OakSpeech_FadeOutForPlayerNamingScreen;
      break;
  }
};

const Task_OakSpeech_FadeOutPlayerPic: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTrainerPicFadeState] === 0) return;
  ClearTrainerPic();
  if (data[tTimer] !== 0) data[tTimer]--;
  else gTasks[taskId].func = Task_OakSpeech_FadeInRivalPic;
};

const Task_OakSpeech_FadeOutRivalPic: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  ClearDialogWindowAndFrame(WIN_INTRO_TEXTBOX, true);
  CreateFadeInTask(taskId, 2);
  gTasks[taskId].func = Task_OakSpeech_ReshowPlayersPic;
};

const Task_OakSpeech_FadeInRivalPic: TaskFunc = (taskId) => {
  ChangeBgX(2, 0, BG_COORD_SET);
  gTasks[taskId].data[tTrainerPicPosX] = 0;
  setSpriteCoordOffset(0, 0);
  LoadTrainerPic(RIVAL_PIC, 0);
  CreateFadeOutTask(taskId, 2);
  gTasks[taskId].func = Task_OakSpeech_AskRivalsName;
};

const Task_OakSpeech_AskRivalsName: TaskFunc = (taskId) => {
  if (gTasks[taskId].data[tTrainerPicFadeState] === 0) return;
  OakSpeechPrintMessage(T('gOakSpeech_Text_WhatWasHisName'), R().textSpeed);
  R().hasPlayerBeenNamed = true;
  gTasks[taskId].func = Task_OakSpeech_MoveRivalDisplayNameOptions;
};

const Task_OakSpeech_ReshowPlayersPic: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tTrainerPicFadeState] === 0) return;
  ClearTrainerPic();
  if (data[tTimer] !== 0) {
    data[tTimer]--;
  } else {
    LoadTrainerPic(oakSpeechEnv.getPlayerGender() === MALE ? MALE_PLAYER_PIC : FEMALE_PLAYER_PIC, 0);
    data[tTrainerPicPosX] = 0;
    setSpriteCoordOffset(0, 0);
    ChangeBgX(2, 0, BG_COORD_SET);
    CreateFadeOutTask(taskId, 2);
    gTasks[taskId].func = Task_OakSpeech_LetsGo;
  }
};

const Task_OakSpeech_LetsGo: TaskFunc = (taskId) => {
  if (gTasks[taskId].data[tTrainerPicFadeState] === 0) return;
  OakSpeechPrintMessage(StringExpandPlaceholders(T('gOakSpeech_Text_LetsGo')), R().textSpeed, true);
  gTasks[taskId].data[tTimer] = 30;
  gTasks[taskId].func = Task_OakSpeech_FadeOutBGM;
};

const Task_OakSpeech_FadeOutBGM: TaskFunc = (taskId) => {
  if (IsTextPrinterActive(WIN_INTRO_TEXTBOX)) return;
  if (gTasks[taskId].data[tTimer] !== 0) {
    gTasks[taskId].data[tTimer]--;
  } else {
    FadeOutBGM(4);
    gTasks[taskId].func = Task_OakSpeech_SetUpExitAnimation;
  }
};

// currentPage doubles as the shrink timer below (shrinkTimer)
const Task_OakSpeech_SetUpExitAnimation: TaskFunc = (taskId) => {
  R().currentPage = 0;
  Task_OakSpeech_SetUpDestroyPlatformSprites(taskId);
  Task_OakSpeech_SetUpFadePlayerPicWhite(taskId);
  Task_OakSpeech_SetUpShrinkPlayerPic(taskId);
};

const tPlayerPicFadeOutTimer = 0;
const tScaleDelta = 2;
const tPlayerIsShrunk = 15;

function Task_OakSpeech_SetUpShrinkPlayerPic(taskId: number): void {
  const data = gTasks[taskId].data;
  SetBgAttribute(2, BG_ATTR_WRAPAROUND, 1);
  data[tPlayerPicFadeOutTimer] = 0;
  data[1] = 0; // assigned, but never read
  data[tScaleDelta] = 256;
  data[tPlayerIsShrunk] = 0;
  gTasks[taskId].func = Task_OakSpeech_ShrinkPlayerPic;
}

/** Q_8_8_inv (math_util.c) */
const Q_8_8_inv = (y: number): number => (Math.trunc(0x10000 / ((y << 16) >> 16)) << 16) >> 16;

const Task_OakSpeech_ShrinkPlayerPic: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  R().currentPage = (R().currentPage + 1) & 0xffff;
  if (R().currentPage % 20 === 0) {
    if (R().currentPage === 40) PlaySE(K.SE_WARP_IN);
    const oldScaleDelta = data[tScaleDelta] & 0xffff;
    data[tScaleDelta] -= 32;
    const x = Q_8_8_inv(oldScaleDelta - 8);
    const y = Q_8_8_inv(data[tScaleDelta] - 16);
    SetBgAffine(2, 0x7800, 0x5400, 120, 84, x, y, 0);
    if (data[tScaleDelta] <= 96) {
      data[tPlayerIsShrunk] = 1;
      data[tPlayerPicFadeOutTimer] = 36;
      gTasks[taskId].func = Task_OakSpeech_FadePlayerPicToBlack;
    }
  }
};

const tBGFadeStarted = 1;

function Task_OakSpeech_SetUpDestroyPlatformSprites(_taskId: number): void {
  const taskId2 = CreateTask(Task_OakSpeech_DestroyPlatformSprites, 1);
  const data = gTasks[taskId2].data;
  data[0] = 0; // assigned, but never read
  data[tBGFadeStarted] = 0;
  data[2] = 0; // assigned, but never read
  data[15] = 0; // assigned, but never read
  BeginNormalPaletteFade((PALETTES_OBJECTS | 0x0fcf) >>> 0, 4, 0, 16, RGB_BLACK);
}

const Task_OakSpeech_DestroyPlatformSprites: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  if (data[tBGFadeStarted] !== 0) {
    DestroyTask(taskId);
    // (sic) this task's data[7..9] were never given the platform sprite ids, so this destroys sprite 0 three times
    DestroyPikachuOrPlatformSprites(taskId, SPRITE_TYPE_PLATFORM);
  } else {
    data[tBGFadeStarted]++;
    BeginNormalPaletteFade(0x0000 | 0xf000, 0, 0, 16, RGB_BLACK);
  }
};

const tPlayerPicFadeWhiteTimer = 0;
const tUnderflowingTimer = 1;
const tSecondaryTimer = 2;
const tBlendCoefficient = 14;

function Task_OakSpeech_SetUpFadePlayerPicWhite(_taskId: number): void {
  const taskId2 = CreateTask(Task_OakSpeech_FadePlayerPicWhite, 2);
  const data = gTasks[taskId2].data;
  data[tPlayerPicFadeWhiteTimer] = 8;
  data[tUnderflowingTimer] = 0;
  data[tSecondaryTimer] = 8;
  data[tBlendCoefficient] = 0;
  data[15] = 0; // assigned, but never read
}

const Task_OakSpeech_FadePlayerPicWhite: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tPlayerPicFadeWhiteTimer] !== 0) {
    data[tPlayerPicFadeWhiteTimer]--;
    return;
  }
  if (data[tUnderflowingTimer] <= 0 && data[tSecondaryTimer] !== 0) data[tSecondaryTimer]--;
  BlendPalette(BG_PLTT_ID(4), 0x20, data[tBlendCoefficient], RGB_WHITE);
  data[tBlendCoefficient]++;
  data[tUnderflowingTimer]--;
  data[tPlayerPicFadeWhiteTimer] = data[tSecondaryTimer];
  if (data[tBlendCoefficient] > 14) {
    for (let i = 0; i < 32; i++) {
      gPlttBufferFaded[i + BG_PLTT_ID(4)] = RGB_WHITE;
      gPlttBufferUnfaded[i + BG_PLTT_ID(4)] = RGB_WHITE;
    }
    DestroyTask(taskId);
  }
};

const Task_OakSpeech_FadePlayerPicToBlack: TaskFunc = (taskId) => {
  if (gTasks[taskId].data[tPlayerPicFadeOutTimer] !== 0) {
    gTasks[taskId].data[tPlayerPicFadeOutTimer]--;
  } else {
    BeginNormalPaletteFade(0x0000 | 0x0030, 2, 0, 16, RGB_BLACK);
    gTasks[taskId].func = Task_OakSpeech_WaitForFade;
  }
};

const Task_OakSpeech_WaitForFade: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_OakSpeech_FreeResources;
};

const Task_OakSpeech_FreeResources: TaskFunc = (taskId) => {
  FreeAllWindowBuffers();
  FreeMonSpritesGfx(); // DestroyMonSpritesGfxManager
  sOakSpeechResources = null;
  gTextFlags.canABSpeedUpPrint = false;
  DestroyTask(taskId);
  oakSpeechEnv.newGame(); // SetMainCallback2(CB2_NewGame)
};

function CB2_ReturnFromNamingScreen(): void {
  switch (gMain.state) {
    case 0: {
      // The naming screen leaves the entered name in its buffer (untouched if left blank)
      if (!R().hasPlayerBeenNamed) setPlayerName(sNameBuffer);
      else setRivalName(sNameBuffer);
      SetVBlankCallback(null);
      vram.fill(0);
      pltt.fill(RGB_BLACK, 1); // DmaFill16(3, RGB_BLACK, PLTT + 2, PLTT_SIZE - 2)
      ResetPaletteFade();
      ScanlineEffect_Stop();
      ResetSpriteData();
      FreeAllSpritePalettes();
      ResetTempTileDataBuffers();
      break;
    }
    case 1:
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(1, sBgTemplates);
      SetBgTilemapBuffer(1, R().bg1TilemapBuffer);
      SetBgTilemapBuffer(2, R().bg2TilemapBuffer);
      ChangeBgX(1, 0, BG_COORD_SET);
      ChangeBgY(1, 0, BG_COORD_SET);
      ChangeBgX(2, 0, BG_COORD_SET);
      ChangeBgY(2, 0, BG_COORD_SET);
      break;
    case 2:
      SetGpuReg(REG_OFFSET_WIN0H, 0);
      SetGpuReg(REG_OFFSET_WIN0V, 0);
      SetGpuReg(REG_OFFSET_WININ, 0);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      break;
    case 3:
      FreeAllWindowBuffers();
      InitStandardTextBoxWindows();
      InitTextBoxGfxAndPrinters();
      // (the C loads 48 colours past the palette, out of the tiles after it; the player and rival pics overwrite them)
      LoadBackgroundPals();
      break;
    case 4:
      DecompressAndCopyTileDataToVram(1, gfx('sOakSpeech_Background_Tiles'), 0, 0, 0);
      break;
    case 5:
      if (FreeTempTileDataBuffersIfPossible()) return;
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 20);
      CopyToBgTilemapBuffer(1, gfx16('sOakSpeech_Background_Tilemap'), 0, 0);
      FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 30, 20);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(2);
      break;
    case 6: {
      const taskId = CreateTask(Task_OakSpeech_ConfirmName, 0);
      if (!R().hasPlayerBeenNamed) LoadTrainerPic(oakSpeechEnv.getPlayerGender() === MALE ? MALE_PLAYER_PIC : FEMALE_PLAYER_PIC, 0);
      else LoadTrainerPic(RIVAL_PIC, 0);
      gTasks[taskId].data[tTrainerPicPosX] = -60;
      setSpriteCoordOffset(gSpriteCoordOffsetX + 60, 0);
      ChangeBgX(2, 0xffffc400, BG_COORD_SET);
      CreatePikachuOrPlatformSprites(taskId, SPRITE_TYPE_PLATFORM);
      gTasks[taskId].data[tNameNotConfirmed] = 1;
      break;
    }
    case 7:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      ShowBg(0);
      ShowBg(1);
      ShowBg(2);
      SetVBlankCallback(VBlankCB_NewGameScene);
      gTextFlags.canABSpeedUpPrint = true;
      SetMainCallback2(CB2_NewGameScene);
      return;
  }
  gMain.state++;
}

function CreateNidoranFSprite(taskId: number): void {
  const species = INTRO_SPECIES();
  DecompressPicFromTable(monPicSymbol(true, species, 0), gMonSpritesGfxPtr!.sprites[0]); // MonSpritesGfxManager_GetSpritePtr(0)
  LoadSpritePalette({ data: gfx16(monPalSymbols(species)[0]), tag: species }); // LoadCompressedSpritePaletteUsingHeap(&gMonPaletteTable[species])
  SetMultiuseSpriteTemplateToPokemon(species, 0);
  const spriteId = CreateSprite(gMultiuseSpriteTemplate, 96, 96, 1);
  gSprites[spriteId].callback = SpriteCallbackDummy;
  gSprites[spriteId].oam.priority = 1;
  gSprites[spriteId].invisible = true;
  gTasks[taskId].data[tNidoranFSpriteId] = spriteId;
}

const sBodySpriteId = 0;

function SpriteCB_Pikachu(sprite: Sprite): void {
  sprite.y2 = gSprites[sprite.data[sBodySpriteId]].animCmdIndex;
}

function CreatePikachuOrPlatformSprites(taskId: number, spriteType: number): void {
  const data = gTasks[taskId].data;
  switch (spriteType) {
    case SPRITE_TYPE_PIKACHU: {
      for (const sheet of sPikachuIntro_Pikachu_SpriteSheets()) LoadSpriteSheet(sheet);
      LoadSpritePalette({ data: gfx16('sPikachuIntro_Pikachu_Pal'), tag: PAL_TAG_PIKACHU });
      let spriteId = CreateSprite(sPikachuIntro_Pikachu_SpriteTemplates[0], 16, 17, 2);
      gSprites[spriteId].oam.priority = 0;
      data[tPikachuPlatformSpriteId(0)] = spriteId;
      spriteId = CreateSprite(sPikachuIntro_Pikachu_SpriteTemplates[1], 16, 9, 3);
      gSprites[spriteId].oam.priority = 0;
      gSprites[spriteId].data[sBodySpriteId] = data[tPikachuPlatformSpriteId(0)];
      gSprites[spriteId].callback = SpriteCB_Pikachu;
      data[tPikachuPlatformSpriteId(1)] = spriteId;
      spriteId = CreateSprite(sPikachuIntro_Pikachu_SpriteTemplates[2], 24, 13, 1);
      gSprites[spriteId].oam.priority = 0;
      gSprites[spriteId].data[sBodySpriteId] = data[tPikachuPlatformSpriteId(0)];
      gSprites[spriteId].callback = SpriteCB_Pikachu;
      data[tPikachuPlatformSpriteId(2)] = spriteId;
      break;
    }
    case SPRITE_TYPE_PLATFORM:
      LoadSpriteSheet({ data: gfx('sOakSpeech_Platform_Gfx'), size: 0x600, tag: GFX_TAG_PLATFORM });
      LoadSpritePalette({ data: gfx16('sOakSpeech_Platform_Pal'), tag: PAL_TAG_PLATFORM });
      for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) {
        const spriteId = CreateSprite(sOakSpeech_Platform_SpriteTemplates[i], i * 32 + 88, 112, 1);
        gSprites[spriteId].oam.priority = 2;
        gSprites[spriteId].animPaused = true;
        gSprites[spriteId].coordOffsetEnabled = true;
        data[tPikachuPlatformSpriteId(i)] = spriteId;
      }
      break;
  }
}

function DestroyPikachuOrPlatformSprites(taskId: number, spriteType: number): void {
  for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) DestroySprite(gSprites[gTasks[taskId].data[tPikachuPlatformSpriteId(i)]]);
  switch (spriteType) {
    case SPRITE_TYPE_PIKACHU:
      FreeSpriteTilesByTag(GFX_TAG_PIKACHU_EYES);
      FreeSpriteTilesByTag(GFX_TAG_PIKACHU_EARS);
      FreeSpriteTilesByTag(GFX_TAG_PIKACHU);
      FreeSpritePaletteByTag(PAL_TAG_PIKACHU);
      break;
    case SPRITE_TYPE_PLATFORM:
      FreeSpriteTilesByTag(GFX_TAG_PLATFORM);
      FreeSpritePaletteByTag(PAL_TAG_PLATFORM);
      break;
  }
}

/** LoadTrainerPic: the 8bpp pic into BG2's tiles at 0x600 and its 8x12 tilemap at (11, 2). */
function LoadTrainerPic(whichPic: number, tileOffset: number): void {
  const pics: Record<number, [string, number]> = {
    [MALE_PLAYER_PIC]: ['sOakSpeech_Red', BG_PLTT_ID(4)],
    [FEMALE_PLAYER_PIC]: ['sOakSpeech_Leaf', BG_PLTT_ID(4)],
    [RIVAL_PIC]: ['sOakSpeech_Rival', BG_PLTT_ID(6)],
    [OAK_PIC]: ['sOakSpeech_Oak', BG_PLTT_ID(6)],
  };
  const pic = pics[whichPic];
  if (!pic) return;
  const pal = gfx16(`${pic[0]}_Pal`);
  LoadPalette(pal, pic[1], pal.length * 2);
  vram.set(gfx(`${pic[0]}_Tiles`), 0x600 + tileOffset); // LZ77UnCompVram
  const trainerPicTilemap = Array.from({ length: 0x60 }, (_, i) => i);
  FillBgTilemapBufferRect(2, 0, 0, 0, 32, 32, 16);
  CopyRectToBgTilemapBufferRect(2, trainerPicTilemap, 0, 0, 8, 12, 11, 2, 8, 12, 16, (tileOffset >> 6) + 24, 0);
  CopyBgTilemapBufferToVram(2);
}

function ClearTrainerPic(): void {
  FillBgTilemapBufferRect(2, 0, 11, 1, 8, 12, 16);
  CopyBgTilemapBufferToVram(2);
}

// fade-in/out task data
const tParentTaskId = 0;
const tBlendTarget1 = 1;
const tBlendTarget2 = 2;
const tUnusedState = 3;
const tFadeTimer = 4;

const Task_SlowFadeIn: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[tBlendTarget1] === 0) {
    gTasks[d[tParentTaskId]].data[tTrainerPicFadeState] = 1;
    DestroyTask(taskId);
    for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) gSprites[d[tPikachuPlatformSpriteId(i)]].invisible = true;
  } else if (d[tFadeTimer] !== 0) {
    d[tFadeTimer]--;
  } else {
    d[tFadeTimer] = d[tTimer];
    d[tBlendTarget1]--;
    d[tBlendTarget2]++;
    if (d[tBlendTarget1] === 8) for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) gSprites[d[tPikachuPlatformSpriteId(i)]].invisible = !gSprites[d[tPikachuPlatformSpriteId(i)]].invisible;
    SetGpuReg(REG_OFFSET_BLDALPHA, d[tBlendTarget2] * 256 + d[tBlendTarget1]);
  }
};

/** CreateFadeInTask: (sic) the pic fades *out* (BG2 blends away over BG1). */
function CreateFadeInTask(taskId: number, delay: number): void {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_OBJ);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 0));
  SetGpuReg(REG_OFFSET_BLDY, 0);
  gTasks[taskId].data[tTrainerPicFadeState] = 0;
  const taskId2 = CreateTask(Task_SlowFadeIn, 0);
  const d = gTasks[taskId2].data;
  d[tParentTaskId] = taskId;
  d[tBlendTarget1] = 16;
  d[tBlendTarget2] = 0;
  d[tUnusedState] = delay;
  d[tFadeTimer] = delay;
  for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) d[tPikachuPlatformSpriteId(i)] = gTasks[taskId].data[tPikachuPlatformSpriteId(i)];
}

const Task_SlowFadeOut: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[tBlendTarget1] === 16) {
    if (!gPaletteFade.active) {
      gTasks[d[tParentTaskId]].data[tTrainerPicFadeState] = 1;
      DestroyTask(taskId);
    }
  } else if (d[tFadeTimer] !== 0) {
    d[tFadeTimer]--;
  } else {
    d[tFadeTimer] = d[tTimer];
    d[tBlendTarget1] += 2;
    d[tBlendTarget2] -= 2;
    if (d[tBlendTarget1] === 8) for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) gSprites[d[tPikachuPlatformSpriteId(i)]].invisible = !gSprites[d[tPikachuPlatformSpriteId(i)]].invisible;
    SetGpuReg(REG_OFFSET_BLDALPHA, d[tBlendTarget2] * 256 + d[tBlendTarget1]);
  }
};

/** CreateFadeOutTask: (sic) the pic fades *in*. */
function CreateFadeOutTask(taskId: number, delay: number): void {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG2 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_OBJ);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  SetGpuReg(REG_OFFSET_BLDY, 0);
  gTasks[taskId].data[tTrainerPicFadeState] = 0;
  const taskId2 = CreateTask(Task_SlowFadeOut, 0);
  const d = gTasks[taskId2].data;
  d[tParentTaskId] = taskId;
  d[tBlendTarget1] = 0;
  d[tBlendTarget2] = 16;
  d[tUnusedState] = delay;
  d[tFadeTimer] = delay;
  for (let i = 0; i < NUM_PIKACHU_PLATFORM_SPRITES; i++) d[tPikachuPlatformSpriteId(i)] = gTasks[taskId].data[tPikachuPlatformSpriteId(i)];
}

function PrintNameChoiceOptions(taskId: number, hasPlayerBeenNamed: boolean): void {
  const data = gTasks[taskId].data;
  data[tMenuWindowId] = AddWindow(sIntro_WindowTemplates[WIN_INTRO_NAMES]);
  PutWindowTilemap(data[tMenuWindowId]);
  DrawStdFrameWithCustomTileAndPalette(data[tMenuWindowId], true, GetStdWindowBaseTileNum(), 14);
  FillWindowPixelBuffer(data[tMenuWindowId], PIXEL_FILL(1));
  AddTextPrinterParameterized(data[tMenuWindowId], FONT_NORMAL, T('gOtherText_NewName'), 8, 1, 0);
  const textPtrs = !hasPlayerBeenNamed ? (oakSpeechEnv.getPlayerGender() === MALE ? sMaleNameChoices : sFemaleNameChoices) : sRivalNameChoices;
  for (let i = 0; i < sRivalNameChoices.length; i++) AddTextPrinterParameterized(data[tMenuWindowId], FONT_NORMAL, T(textPtrs[i]), 8, 16 * (i + 1) + 1, 0);
  Menu_InitCursor(data[tMenuWindowId], FONT_NORMAL, 0, 1, 16, 5, 0);
  CopyWindowToVram(data[tMenuWindowId], COPYWIN_FULL);
}

// gSaveBlock2Ptr->playerName / gSaveBlock1Ptr->rivalName as Oak's speech fills them (PLAYER_NAME_LENGTH + 1 bytes)
let sPlayerName: number[] = [];
let sRivalName: number[] = [];

function setPlayerName(name: number[]): void {
  sPlayerName = fixedName(name);
  oakSpeechEnv.setPlayerName(sPlayerName);
}

function setRivalName(name: number[]): void {
  sRivalName = fixedName(name);
  oakSpeechEnv.setRivalName(sRivalName);
}

/** Up to PLAYER_NAME_LENGTH characters, then EOS up to PLAYER_NAME_LENGTH + 1 bytes. */
function fixedName(src: number[]): number[] {
  const dest: number[] = [];
  let i = 0;
  for (; i < PLAYER_NAME_LENGTH && src[i] !== undefined && src[i] !== EOS; i++) dest[i] = src[i];
  for (; i < PLAYER_NAME_LENGTH + 1; i++) dest[i] = EOS;
  return dest;
}

function GetDefaultName(hasPlayerBeenNamed: boolean, rivalNameChoice: number): void {
  if (!hasPlayerBeenNamed) {
    const list = oakSpeechEnv.getPlayerGender() === MALE ? sMaleNameChoices : sFemaleNameChoices;
    setPlayerName(T(list[oakSpeechEnv.random() % list.length]));
  } else {
    setRivalName(T(sRivalNameChoices[rivalNameChoice]));
  }
}

/**
 * Dev: Oak's speech for the e2e tests: the running task's function name, the page (or shrink timer), the menu taking
 * input, whether a palette fade runs, gMain.state (the Pikachu intro's state), the gender and the names so far.
 */
export function oakSpeechProbe():
  | { task: string; page: number; menu: 'gender' | 'names' | 'yesNo' | undefined; fading: boolean; pikachuState: number; playerGender: 'male' | 'female'; playerName: number[]; rivalName: number[] }
  | undefined {
  if (!sOakSpeechResources) return undefined;
  const helpers = ['Task_OakSpeech_DestroyPlatformSprites', 'Task_OakSpeech_FadePlayerPicWhite'];
  const task = gTasks.find((t) => t.isActive && /^Task_(OakSpeech|ControlsGuide|PikachuIntro|NewGameScene)/.test(t.func.name) && !helpers.includes(t.func.name));
  const name = task?.func.name ?? '';
  const menus: Record<string, 'gender' | 'names' | 'yesNo'> = {
    Task_OakSpeech_HandleGenderInput: 'gender',
    Task_OakSpeech_HandleRivalNameInput: 'names',
    Task_OakSpeech_HandleConfirmNameInput: 'yesNo',
  };
  return {
    task: name,
    page: sOakSpeechResources.currentPage,
    menu: menus[name],
    fading: gPaletteFade.active,
    pikachuState: gMain.state,
    playerGender: oakSpeechEnv.getPlayerGender() === MALE ? 'male' : 'female',
    playerName: sPlayerName,
    rivalName: sRivalName,
  };
}
