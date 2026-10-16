// credits.c: the staff credits after the Hall of Fame (`special DoCredits` at the end of
// IndigoPlateau_Exterior_EventScript_Credits). The names print in a darkened band over scrolling maps
// (overworld.c's Overworld_DoScrollSceneForCredits / MapLdr_Credits / CameraCB_CreditsPan), with the player or the
// rival running on a strip of ground; between the maps come the Charizard / Venusaur / Blastoise / Pikachu scenes,
// then the copyright and THE END, and the game resets (SoftReset).
//
// The field hosts it on its GBA layer (world/fieldGbaScreen.ts): `creditsEnv` loads the maps there and moves the
// camera. The GBA loads a map within one frame; here the load is asynchronous, so a map scene can start a frame or
// two later than on the GBA (always behind a black screen). No audio: MUS_CREDITS and the cries are silent.

import { K } from '../battle/constants';
import { monPalSymbols, monPicSymbol, LoadSpecialPokePic, GetMonSpritePalFromSpeciesAndPersonality } from '../battle/gfx';
import { testEvent } from '../dev/testHooks';
import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, FillBgTilemapBufferRect, HideBg, InitBgsFromTemplates, LoadBgTilemap, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  ClearGpuRegBits,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GetGpuReg,
  PALETTES_ALL,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  WIN_RANGE,
} from '../gba/hw';
import { A_BUTTON, JOY_NEW, SetHBlankCallback, SetVBlankCallback } from '../gba/main';
import { InitStandardTextBoxWindows, InitTextBoxGfxAndPrinters } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer } from '../gba/palette';
import {
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  CreateSprite,
  DestroySprite,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SpriteCallbackDummy,
  ST_OAM_H_RECTANGLE,
  ST_OAM_SQUARE,
  TAG_NONE,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, TASK_NONE } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  AddWindow,
  BlitBitmapRectToWindow,
  CopyToWindowPixelBuffer,
  CopyWindowToVram,
  COPYWIN_FULL,
  COPYWIN_GFX,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  type WindowTemplate,
} from '../gba/window';
import { FONT_NORMAL } from '../text/Font';
import { text } from './common';

const FONT_NORMAL_COPY_1 = 1;

/** What the credits need from the field that hosts them. */
export const creditsEnv = {
  /**
   * WarpIntoMap + MapLdr_Credits' map half: load MAP_* `mapId` with the camera on map-local (x, y) and put it on
   * the GBA layer (reloading the BGs, tilesets and palettes). The wait ends once it's there.
   */
  loadMap: (_mapId: string, _x: number, _y: number): (() => boolean) => () => true,
  /** CameraUpdateNoObjectRefresh: move the field camera by (dx, dy) px. */
  moveCamera: (_dx: number, _dy: number): void => {},
  /** UpdateTilesetAnimations (Overworld_CreditsMainCB runs it every other frame). */
  updateTilesetAnimations: (): void => {},
  /** The GBA layer without the map: the Pokémon scenes and the copyright / THE END screens set up the hardware. */
  bareScreen: (): void => {},
  /** SoftReset(RESET_ALL) */
  softReset: (): void => {},
  /** gSaveBlock2Ptr->playerGender (MALE / FEMALE) */
  playerGender: (): number => 0,
};

// enum CreditsSceneIdx
const CREDITSSCENE_INIT_WIN0 = 0;
const CREDITSSCENE_SETUP_DARKEN_EFFECT = 1;
const CREDITSSCENE_OPEN_WIN0 = 2;
const CREDITSSCENE_LOAD_PLAYER_SPRITE_AT_INDIGO = 3;
const CREDITSSCENE_PRINT_TITLE_STAFF = 4;
const CREDITSSCENE_WAIT_TITLE_STAFF = 5;
const CREDITSSCENE_EXEC_CMD = 6;
const CREDITSSCENE_PRINT_ADDPRINTER1 = 7;
const CREDITSSCENE_PRINT_ADDPRINTER2 = 8;
const CREDITSSCENE_PRINT_DELAY = 9;
const CREDITSSCENE_MAPNEXT_DESTROYWINDOW = 10;
const CREDITSSCENE_MAPNEXT_LOADMAP = 11;
const CREDITSSCENE_MAP_LOADMAP_CREATESPRITES = 12;
const CREDITSSCENE_MON_DESTROY_ASSETS = 13;
const CREDITSSCENE_MON_SHOW = 14;
const CREDITSSCENE_THEEND_DESTROY_ASSETS = 15;
const CREDITSSCENE_THEEND_SHOW = 16;
const CREDITSSCENE_WAITBUTTON = 17;
const CREDITSSCENE_TERMINATE = 18;

// enum CreditsScrCmd
const CREDITSSCRCMD_PRINT = 0;
const CREDITSSCRCMD_MAPNEXT = 1;
const CREDITSSCRCMD_MAP = 2;
const CREDITSSCRCMD_MON = 3;
const CREDITSSCRCMD_THEENDGFX = 4;
const CREDITSSCRCMD_WAITBUTTON = 5;

// enum CreditsMon
const CREDITSMON_CHARIZARD = 0;
const CREDITSMON_VENUSAUR = 1;
const CREDITSMON_BLASTOISE = 2;
const CREDITSMON_PIKACHU = 3;

const GFXTAG_CHARACTER = 0x2000;
const GFXTAG_GROUND = 0x2001;

/** struct CreditsResources (sCreditsMgr) */
interface CreditsResources {
  mainseqno: number;
  subseqno: number;
  taskId: number;
  timer: number;
  scrcmdidx: number;
  canSpeedThrough: number;
  whichMon: number;
  windowId: number;
  windowIsActive: boolean;
  creditsMonTimer: number;
  unk_0E: number;
  ovwldseqno: number;
  unk_1D: number;
}

let sCreditsMgr: CreditsResources | null = null;
const M = (): CreditsResources => sCreditsMgr!;

const sBgTemplates_MonSceneOrTheEnd: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 15, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 2, mapBaseIndex: 23, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 1, paletteMode: 1, priority: 2, baseTile: 0 },
];

const monWindows = (third: [number, number, number, number]): WindowTemplate[] => [
  { bg: 0, tilemapLeft: 11, tilemapTop: 6, width: 8, height: 8, paletteNum: 10, baseBlock: 0x0008 },
  { bg: 0, tilemapLeft: 10, tilemapTop: 5, width: 10, height: 10, paletteNum: 10, baseBlock: 0x0048 },
  { bg: 0, tilemapLeft: third[0], tilemapTop: third[1], width: third[2], height: third[3], paletteNum: 10, baseBlock: 0x00ac },
  DUMMY_WIN_TEMPLATE,
];

/** sWindowTemplates_Charizard / _Venusaur / _Blastoise / _Pikachu, the species and their two silhouettes */
const sCreditsMons = [
  { windows: monWindows([9, 3, 12, 13]), species: 'SPECIES_CHARIZARD', tiles: ['sCharizard1_Tiles', 'sCharizard2_Tiles'] },
  { windows: monWindows([9, 5, 12, 10]), species: 'SPECIES_VENUSAUR', tiles: ['sVenusaur1_Tiles', 'sVenusaur2_Tiles'] },
  { windows: monWindows([10, 4, 10, 12]), species: 'SPECIES_BLASTOISE', tiles: ['sBlastoise1_Tiles', 'sBlastoise2_Tiles'] },
  { windows: monWindows([9, 4, 12, 12]), species: 'SPECIES_PIKACHU', tiles: ['sPikachu1_Tiles', 'sPikachu2_Tiles'] },
];

/** sCopyrightOrTheEndGfxHeaders */
const sCopyrightOrTheEndGfxHeaders = [
  { tiles: 'gCreditsCopyright_Tiles', map: 'gCreditsCopyright_Tilemap', palette: 'gCreditsCopyright_Pal' },
  { tiles: 'sTheEnd_Tiles', map: 'sTheEnd_Tilemap', palette: 'sTheEnd_Pal' },
];

// sCreditsScript: [cmd, param, duration]
const P = (str: number, duration: number) => [CREDITSSCRCMD_PRINT, str, duration];
const MAPNEXT = (map: number, duration: number) => [CREDITSSCRCMD_MAPNEXT, map, duration];
const MAP = (map: number, duration: number) => [CREDITSSCRCMD_MAP, map, duration];
const MON = (mon: number) => [CREDITSSCRCMD_MON, mon, 0];
const THEENDGFX = (idx: number, duration: number) => [CREDITSSCRCMD_THEENDGFX, idx, duration];
const WAITBUTTON = (time: number) => [CREDITSSCRCMD_WAITBUTTON, 0, time];
const DUMMY = 42;
const sCreditsScript: number[][] = [
  MAPNEXT(0, 16), P(0, 300), P(1, 300), P(2, 300), P(DUMMY, 60),
  MAPNEXT(1, 0), P(3, 211), P(4, 211), P(5, 211),
  MAPNEXT(2, 0), P(6, 211), P(7, 210), P(8, 210),
  MON(CREDITSMON_CHARIZARD),
  MAP(3, 16), P(9, 211), P(10, 210), P(11, 210),
  MAPNEXT(4, 16), P(12, 211), P(13, 210), P(14, 210),
  MAPNEXT(5, 16), P(15, 211), P(16, 210), P(17, 210),
  MON(CREDITSMON_VENUSAUR),
  MAP(6, 16), P(18, 211), P(19, 210), P(20, 210),
  MAPNEXT(7, 16), P(21, 221), P(22, 221), P(23, 221), P(24, 221), P(DUMMY, 51),
  MAPNEXT(8, 16), P(25, 211), P(26, 210), P(27, 210),
  MON(CREDITSMON_BLASTOISE),
  MAP(9, 16), P(28, 331), P(29, 331), P(30, 331),
  MAPNEXT(10, 16), P(31, 221), P(32, 221), P(33, 221), P(34, 221), P(DUMMY, 52),
  MAPNEXT(11, 16), P(41, 210), P(35, 210), P(36, 211),
  MON(CREDITSMON_PIKACHU),
  MAP(12, 16), P(37, 221), P(40, 221), P(38, 221), P(39, 221), P(DUMMY, 52),
  THEENDGFX(0, 224), THEENDGFX(1, 240), WAITBUTTON(600),
];

/** sCreditsTexts: [title, names] (CREDITS_STRING_* order) */
const sCreditsTexts: [string, string][] = [
  ['gCreditsString_Director', 'gCreditsString_Junichi_Masuda'],
  ['gCreditsString_Art_Director_Battle_Director', 'gCreditsString_Ken_Sugimori_Shigeki_Morimoto'],
  ['gCreditsString_Program_Leader_Planning_Leader_Graphic_Design_Leader', 'gCreditsString_Tetsuya_Watanabe_Koji_Nishino_Takao_Unno'],
  ['gCreditsString_Programmers', 'gCreditsString_Hiroyuki_Nakamura_Masao_Taya_Satoshi_Nohara_Miyuki_Iwasawa_Daisuke_Goto'],
  ['gCreditsString_System_Programmers', 'gCreditsString_Tetsuya_Watanabe_Akito_Mori_Hisashi_Sogabe_Sousuke_Tamada'],
  ['gCreditsString_Graphic_Designers', 'gCreditsString_Takao_Unno_Asuka_Iwashita_Kanako_Eo_Hiroki_Fuchino'],
  ['gCreditsString_Graphic_Designers_2', 'gCreditsString_Ken_Sugimori_Hironobu_Yoshida'],
  ['gCreditsString_Music_Composition', 'gCreditsString_Go_Ichinose_Junichi_Masuda'],
  ['gCreditsString_Sound_Effects', 'gCreditsString_Go_Ichinose'],
  ['gCreditsString_Game_Designers', 'gCreditsString_Junichi_Masuda_Koji_Nishino_Tetsuji_Ohta'],
  ['gCreditsString_Game_Designers_2', 'gCreditsString_Hitomi_Sato_Shigeru_Ohmori_Tadashi_Takahashi'],
  ['gCreditsString_Game_Scenario', 'gCreditsString_Hitomi_Sato_Satoshi_Tajiri'],
  ['gCreditsString_Script_Designer_Map_Designer', 'gCreditsString_Satoshi_Nohara_Shigeru_Ohmori'],
  ['gCreditsString_Parametric_Designers', 'gCreditsString_Koji_Nishino_Tetsuji_Ohta_Shigeki_Morimoto'],
  ['gCreditsString_POKeDEX_Text', 'gCreditsString_Kenji_Matsushima'],
  ['gCreditsString_POKeMON_Designers', 'gCreditsString_Ken_Sugimori_Motofumi_Fujiwara_Shigeki_Morimoto_Hironobu_Yoshida'],
  ['gCreditsString_POKeMON_Designers_2', 'gCreditsString_Satoshi_Ohta_Asuka_Iwashita_Takao_Unno_Kanako_Eo_Aimi_Tomita'],
  ['gCreditsString_POKeMON_Designers_3', 'gCreditsString_Atsuko_Nishida_Muneo_Saito_Rena_Yoshikawa_Jun_Okutani'],
  ['gCreditsString_Supporting_Programmers', 'gCreditsString_Teruyuki_Yoshioka_Takao_Nakano_Satoshi_Mitsuhara_Daisuke_Hoshino'],
  ['gCreditsString_NCL_Product_Testing', 'gCreditsString_NCL_Super_Mario_Club'],
  ['gCreditsString_Special_Thanks', 'gCreditsString_Hiro_Nakamura_Hiroyuki_Uesugi_Teruki_Murakawa_Kazuya_Suyama'],
  ['gCreditsString_Special_Thanks_2', 'gCreditsString_Kenji_Tominaga_Kenjiro_Ito_Tomotaka_Komura_Michiko_Takizawa'],
  ['gCreditsString_Special_Thanks_3', 'gCreditsString_Makiko_Takada_Mikiko_Ohashi_Shusaku_Egami_Takanao_Kondo_Rui_Kawaguchi'],
  ['gCreditsString_Braille_Code_Check', 'gCreditsString_Japan_Braille_Library'],
  ['gCreditsString_Information_Supervisors', 'gCreditsString_Hiroki_Enomoto_Kazuyuki_Terada_Yuri_Sakurai_Yumi_Funasaka_Naoko_Yanase'],
  ['gCreditsString_Coordinators', 'gCreditsString_Azusa_Tajima_Akira_Kinashi_Kazuki_Yoshihara_Retsuji_Nomoto'],
  ['gCreditsString_Task_Managers', 'gCreditsString_Hitoshi_Yamagami_Gakuji_Nomoto'],
  ['gCreditsString_Producers', 'gCreditsString_Hiroyuki_Jinnai_Takehiro_Izushi_Hiroaki_Tsuru'],
  ['gCreditsString_Executive_Director', 'gCreditsString_Satoshi_Tajiri'],
  ['gCreditsString_Executive_Producer', 'gCreditsString_Satoru_Iwata'],
  ['gCreditsString_Executive_Producer_2', 'gCreditsString_Tsunekaz_Ishihara'],
  ['gCreditsString_English_Version_Coordinators', 'gCreditsString_Hiro_Nakamura_Seth_McMahill'],
  ['gCreditsString_Translator_Text_Editor', 'gCreditsString_Nob_Ogasawara_Teresa_Lillygren'],
  ['gCreditsString_Programmers_2', 'gCreditsString_Teruki_Murakawa_Souichi_Yamamoto_Yuichiro_Ito_Akira_Kinashi'],
  ['gCreditsString_Environment_Tool_Programmers', 'gCreditsString_Teruki_Murakawa_Souichi_Yamamoto_Kimiko_Nakamichi'],
  ['gCreditsString_NOA_Product_Testing', 'gCreditsString_Thomas_Hertzog_Kathy_Huguenard_Mika_Kurosawa'],
  ['gCreditsString_Braille_Code_Check_2', 'gCreditsString_National_Federation_of_the_Blind_Patricia_A_Maurer_Japan_Braille_Library_European_Blind_Union'],
  ['gCreditsString_Braille_Code_Check_3', 'gCreditsString_National_Information_Library_Service_Margaret_Campion'],
  ['gCreditsString_Special_Thanks_4', 'gCreditsString_Takehiro_Izushi_Motoyasu_Tojima_Hitoshi_Yamagami_Hiroyuki_Uesugi'],
  ['gCreditsString_Special_Thanks_5', 'gCreditsString_Nicola_Pratt_Barlow_Shellie_Dow_Anthony_Howitt_Naoko_Saeki_Kyoko_Onishi'],
  ['gCreditsString_Braille_Code_Check_4', 'gCreditsString_The_Royal_New_Zealand_Foundation_of_the_Blind_Greg_Moran'],
  ['gCreditsString_Graphic_Designer', 'gCreditsString_Akira_Kinashi'],
  ['gString_Dummy', 'gString_Dummy'],
];

/** sOverworldMapScenes (CREDITS_MAP_* order): CREDITSOVWLDLOADMAP(map, x, y, 1), CREDITSOVWLDSCROLL(xs, ys, 0x500), END */
const sOverworldMapScenes: [string, number, number, number, number][] = [
  ['MAP_ROUTE23', 11, 107, 0, 1],
  ['MAP_VIRIDIAN_CITY', 30, 34, 0, -1],
  ['MAP_PEWTER_CITY', 20, 26, 0, -1],
  ['MAP_CERULEAN_CITY', 8, 6, 1, 1],
  ['MAP_ROUTE25', 25, 6, 1, 0],
  ['MAP_VERMILION_CITY', 9, 7, 1, 1],
  ['MAP_ROUTE10', 11, 68, 0, 1],
  ['MAP_CELADON_CITY', 48, 16, -1, 0],
  ['MAP_SAFFRON_CITY', 39, 5, 0, 1],
  ['MAP_ROUTE17', 7, 43, 0, 1],
  ['MAP_FUCHSIA_CITY', 28, 5, 0, 1],
  ['MAP_CINNABAR_ISLAND', 13, 17, 0, -1],
  ['MAP_ROUTE21_NORTH', 8, 20, 0, -1],
];

/** The maps the credits scroll over (MAP_* ids), for preloading. */
export const CREDITS_MAPS = sOverworldMapScenes.map(([map]) => map);

/** sPlayerRivalSpriteParams: [player (0) / rival (1), ground, spriteMoveCmd] */
const sPlayerRivalSpriteParams = [
  [0, 3, 1],
  [0, 2, 0],
  [0, 3, 0],
  [1, 1, 2],
  [0, 0, 3],
];

const sTextColor_Header = [0, 5, 2];
const sTextColor_Regular = [0, 1, 2];

const sCreditsWindowTemplate: WindowTemplate = { bg: 0, tilemapLeft: 0, tilemapTop: 4, width: 30, height: 12, paletteNum: 15, baseBlock: 0x008 };

/** sPlayerOrRivalSpriteTemplate (64x64, a 6-frame run) */
const sPlayerOrRivalSpriteTemplate = (): SpriteTemplate => ({
  tileTag: GFXTAG_CHARACTER,
  paletteTag: TAG_NONE,
  oam: oam({ shape: ST_OAM_SQUARE, size: 3, priority: 0, paletteNum: 15 }),
  anims: [[0x000, 0x040, 0x080, 0x0c0, 0x100, 0x140].map((f) => ANIMCMD_FRAME(f, 8)).concat([ANIMCMD_JUMP(0)])],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
});

/** sGroundSpriteTemplate_Running / _Static (64x32) */
const sGroundSpriteTemplate = (running: boolean): SpriteTemplate => ({
  tileTag: GFXTAG_GROUND,
  paletteTag: TAG_NONE,
  oam: oam({ shape: ST_OAM_H_RECTANGLE, size: 3, priority: 0, paletteNum: 14 }),
  anims: [running ? [0, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0].map((f) => ANIMCMD_FRAME(f, 8)).concat([ANIMCMD_JUMP(0)]) : [ANIMCMD_FRAME(0, 8), ANIMCMD_JUMP(0)]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
});

/** The graphics the credits draw (preload them before DoCredits). */
export function creditsGfxSymbols(): string[] {
  const syms = [
    ...sCopyrightOrTheEndGfxHeaders.flatMap((h) => [h.tiles, h.map, h.palette]),
    'gCreditsMonPokeball_Tiles',
    'gCreditsMonPokeball_Tilemap',
    'gCreditsMonPokeball_Pals',
    'sCreditsMonCircle_Tiles',
    'sCreditsMonCircle_Tilemap',
    'sCreditsMonCircle_Pal',
    ...sCreditsMons.flatMap((m) => [...m.tiles, monPicSymbol(true, K[m.species], 0), ...monPalSymbols(K[m.species])]),
    ...['sPlayerMale', 'sPlayerFemale', 'sRival', 'sGround_Grass', 'sGround_Dirt', 'sGround_City'].flatMap((s) => [`${s}_Tiles`, `${s}_Pal`]),
    'gStandardMenuPalette',
  ];
  return syms;
}

// ------------------------------------------------------------------ credits.c

/** DoCredits (special) */
export function DoCredits(): void {
  sCreditsMgr = { mainseqno: 0, subseqno: 0, taskId: TASK_NONE, timer: 0, scrcmdidx: 0, canSpeedThrough: 0, whichMon: 0, windowId: 0, windowIsActive: false, creditsMonTimer: 0, unk_0E: 0, ovwldseqno: 0, unk_1D: 0 };
  ResetTasks();
  ResetSpriteData();
  testEvent('creditsStart');
}

/**
 * CB2_Credits, before the host's RunTasks / AnimateSprites / BuildOamBuffer / UpdatePaletteFade (FieldGbaScreen.frame
 * runs those every frame). Returns false once the credits have handed over to SoftReset.
 */
export function CB2_Credits(): boolean {
  switch (RollCredits()) {
    case 0:
      break;
    case 1:
      // Overworld_CreditsMainCB on every other frame: the camera pan and the tile animations
      if (M().unk_1D & 1) {
        CameraUpdateNoObjectRefresh();
        creditsEnv.updateTilesetAnimations();
      }
      M().unk_1D = (M().unk_1D + 1) & 0xff;
      break;
    case 2:
      // FlagClear(FLAG_DONT_SHOW_MAP_NAME_POPUP) and gDisableMapMusicChangeOnMapLoad: gone with the reset anyway
      testEvent('creditsEnd');
      sCreditsMgr = null;
      creditsEnv.softReset();
      return false;
  }
  return true;
}

function SwitchWin1OffWin0On(): void {
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN1_ON);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
  SetGpuReg(REG_OFFSET_WININ, 0x1f3f);
  SetGpuReg(REG_OFFSET_WINOUT, 0x000e);
}

function InitBgDarkenEffect(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_BG3 | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 4));
  SetGpuReg(REG_OFFSET_BLDY, 10);
}

/** Menu_LoadStdPalAt */
function Menu_LoadStdPalAt(offset: number): void {
  LoadPalette(gfx16('gStandardMenuPalette'), offset, 2 * 10);
}

function CreateCreditsWindow(): void {
  const m = M();
  m.windowId = AddWindow(sCreditsWindowTemplate);
  FillWindowPixelBuffer(m.windowId, PIXEL_FILL(0));
  PutWindowTilemap(m.windowId);
  CopyWindowToVram(m.windowId, COPYWIN_FULL);
  m.windowIsActive = true;
}

function DestroyCreditsWindow(): void {
  const m = M();
  if (m.windowIsActive) {
    RemoveWindow(m.windowId);
    // CleanupOverworldWindowsAndTilemaps: the next map scene reloads the BGs
    m.windowIsActive = false;
  }
}

function DoOverworldMapScrollScene(_whichMon: number): boolean {
  const m = M();
  switch (m.subseqno) {
    case 0:
      // FlagSet(FLAG_DONT_SHOW_MAP_NAME_POPUP): the credits' maps never show it
      m.ovwldseqno = 0;
      m.subseqno++;
    // fallthrough
    case 1:
      if (!Overworld_DoScrollSceneForCredits(sOverworldMapScenes[m.whichMon])) return false;
      CreateCreditsWindow();
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, DISPLAY_WIDTH));
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(36, DISPLAY_HEIGHT - 36));
      SwitchWin1OffWin0On();
      InitBgDarkenEffect();
      Menu_LoadStdPalAt(BG_PLTT_ID(15));
      gPlttBufferUnfaded[BG_PLTT_ID(15) + 15] = RGB_BLACK;
      gPlttBufferFaded[BG_PLTT_ID(15) + 15] = RGB_BLACK;
      testEvent('creditsMap', { map: sOverworldMapScenes[m.whichMon][0] });
      return true;
    default:
      return false;
  }
}

function RollCredits(): number {
  const m = M();
  switch (m.mainseqno) {
    case CREDITSSCENE_INIT_WIN0:
      SwitchWin1OffWin0On();
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, DISPLAY_WIDTH));
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(DISPLAY_HEIGHT / 2 - 1, DISPLAY_HEIGHT / 2 + 1));
      m.mainseqno = CREDITSSCENE_SETUP_DARKEN_EFFECT;
      return 0;
    case CREDITSSCENE_SETUP_DARKEN_EFFECT:
      InitBgDarkenEffect();
      CreateCreditsWindow();
      Menu_LoadStdPalAt(BG_PLTT_ID(15));
      gPlttBufferUnfaded[BG_PLTT_ID(15) + 15] = RGB_BLACK;
      gPlttBufferFaded[BG_PLTT_ID(15) + 15] = RGB_BLACK;
      m.mainseqno = CREDITSSCENE_OPEN_WIN0;
      return 0;
    case CREDITSSCENE_OPEN_WIN0: {
      let top = GetGpuReg(REG_OFFSET_WIN0V) >> 8;
      let bottom = GetGpuReg(REG_OFFSET_WIN0V) & 0xff;
      if (top === 0x24) {
        m.timer = 0;
        m.mainseqno = CREDITSSCENE_LOAD_PLAYER_SPRITE_AT_INDIGO;
      } else {
        top--;
        bottom++;
        SetGpuReg(REG_OFFSET_WIN0V, (top << 8) + bottom);
      }
      return 0;
    }
    case CREDITSSCENE_LOAD_PLAYER_SPRITE_AT_INDIGO:
      if (m.timer) {
        m.timer--;
        return 0;
      }
      LoadPlayerOrRivalSprite(0);
      m.timer = 100;
      m.mainseqno = CREDITSSCENE_PRINT_TITLE_STAFF;
      return 0;
    case CREDITSSCENE_PRINT_TITLE_STAFF:
      if (m.timer) {
        m.timer--;
        return 0;
      }
      m.timer = 360;
      AddTextPrinterParameterized4(m.windowId, FONT_NORMAL_COPY_1, 0x08, 0x29, 1, 2, sTextColor_Header, 0, text('gString_PokemonFireRed_Staff'));
      m.mainseqno = CREDITSSCENE_WAIT_TITLE_STAFF;
      return 0;
    case CREDITSSCENE_WAIT_TITLE_STAFF:
      if (m.timer) {
        m.timer--;
        return 0;
      }
      DestroyCreditsWindow();
      m.mainseqno = CREDITSSCENE_EXEC_CMD;
      m.timer = 0;
      m.scrcmdidx = 0;
      return 0;
    case CREDITSSCENE_EXEC_CMD: {
      if (m.timer !== 0) {
        m.timer--;
        return m.canSpeedThrough;
      }
      const [cmd, param, duration] = sCreditsScript[m.scrcmdidx];
      switch (cmd) {
        case CREDITSSCRCMD_PRINT:
          BeginNormalPaletteFade(0x00008000, 0, 0, 16, RGB_BLACK);
          m.mainseqno = CREDITSSCENE_PRINT_ADDPRINTER1;
          FillWindowPixelBuffer(m.windowId, PIXEL_FILL(0));
          return m.canSpeedThrough;
        case CREDITSSCRCMD_MAPNEXT:
          m.mainseqno = CREDITSSCENE_MAPNEXT_DESTROYWINDOW;
          m.whichMon = param;
          BeginNormalPaletteFade(0x3fffffff, 0, 0, 16, RGB_BLACK); // FadeSelectedPals(FADE_TO_BLACK, 0, 0x3FFFFFFF)
          break;
        case CREDITSSCRCMD_MAP:
          m.mainseqno = CREDITSSCENE_MAP_LOADMAP_CREATESPRITES;
          m.whichMon = param;
          break;
        case CREDITSSCRCMD_MON:
          m.mainseqno = CREDITSSCENE_MON_DESTROY_ASSETS;
          m.whichMon = param;
          BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK); // FadeScreen(FADE_TO_BLACK, 0)
          break;
        case CREDITSSCRCMD_THEENDGFX:
          m.mainseqno = CREDITSSCENE_THEEND_DESTROY_ASSETS;
          m.whichMon = param;
          BeginNormalPaletteFade(PALETTES_ALL, 4, 0, 16, RGB_BLACK);
          break;
        case CREDITSSCRCMD_WAITBUTTON:
          m.mainseqno = CREDITSSCENE_WAITBUTTON;
          testEvent('creditsTheEnd');
          break;
      }
      m.timer = duration;
      m.scrcmdidx++;
      return 0;
    }
    case CREDITSSCENE_PRINT_ADDPRINTER1: {
      if (gPaletteFade.active) return m.canSpeedThrough;
      const [title] = sCreditsTexts[sCreditsScript[m.scrcmdidx][1]];
      AddTextPrinterParameterized4(m.windowId, FONT_NORMAL_COPY_1, 2, 6, 0, 0, sTextColor_Header, -1, text(title));
      m.mainseqno = CREDITSSCENE_PRINT_ADDPRINTER2;
      return m.canSpeedThrough;
    }
    case CREDITSSCENE_PRINT_ADDPRINTER2: {
      const [title, names] = sCreditsTexts[sCreditsScript[m.scrcmdidx][1]];
      AddTextPrinterParameterized4(m.windowId, FONT_NORMAL, 8, 6, 0, 0, sTextColor_Regular, -1, text(names));
      testEvent('creditsPrint', { title });
      m.mainseqno = CREDITSSCENE_PRINT_DELAY;
      return m.canSpeedThrough;
    }
    case CREDITSSCENE_PRINT_DELAY:
      CopyWindowToVram(m.windowId, COPYWIN_GFX);
      m.timer = sCreditsScript[m.scrcmdidx][2];
      m.scrcmdidx++;
      BeginNormalPaletteFade(0x00008000, 0, 16, 0, RGB_BLACK);
      m.mainseqno = CREDITSSCENE_EXEC_CMD;
      return m.canSpeedThrough;
    case CREDITSSCENE_MAPNEXT_DESTROYWINDOW:
      if (!gPaletteFade.active) {
        DestroyCreditsWindow();
        m.subseqno = 0;
        m.mainseqno = CREDITSSCENE_MAPNEXT_LOADMAP;
      }
      return 0;
    case CREDITSSCENE_MAPNEXT_LOADMAP:
      if (DoOverworldMapScrollScene(m.whichMon)) {
        m.canSpeedThrough = 1;
        m.mainseqno = CREDITSSCENE_EXEC_CMD;
      }
      return 0;
    case CREDITSSCENE_MAP_LOADMAP_CREATESPRITES:
      if (!gPaletteFade.active) {
        DestroyCreditsWindow();
        m.subseqno = 0;
        m.mainseqno = CREDITSSCENE_MAP_LOADMAP_CREATESPRITES + 0x100; // the load below, over as many frames as it takes
      }
      return 0;
    case CREDITSSCENE_MAP_LOADMAP_CREATESPRITES + 0x100: {
      // `while (!DoOverworldMapScrollScene(whichMon)) {}`: the GBA loads the map within the frame
      if (!DoOverworldMapScrollScene(m.whichMon)) return 0;
      const scene = m.whichMon === 6 ? 2 : m.whichMon === 9 ? 3 : m.whichMon === 12 ? 4 : 1;
      LoadPlayerOrRivalSprite(scene);
      m.canSpeedThrough = 1;
      m.mainseqno = CREDITSSCENE_EXEC_CMD;
      return 0;
    }
    case CREDITSSCENE_MON_DESTROY_ASSETS:
      if (!gPaletteFade.active) {
        DestroyPlayerOrRivalSprite();
        DestroyCreditsWindow();
        m.subseqno = 0;
        m.canSpeedThrough = 0;
        m.mainseqno = CREDITSSCENE_MON_SHOW;
      }
      return 0;
    case CREDITSSCENE_MON_SHOW:
      if (DoCreditsMonScene()) m.mainseqno = CREDITSSCENE_EXEC_CMD;
      return 0;
    case CREDITSSCENE_THEEND_DESTROY_ASSETS:
      if (!gPaletteFade.active) {
        DestroyCreditsWindow();
        m.subseqno = 0;
        m.canSpeedThrough = 0;
        m.mainseqno = CREDITSSCENE_THEEND_SHOW;
      }
      return 0;
    case CREDITSSCENE_THEEND_SHOW:
      if (DoCopyrightOrTheEndGfxScene()) m.mainseqno = CREDITSSCENE_EXEC_CMD;
      return 0;
    case CREDITSSCENE_WAITBUTTON:
      if (JOY_NEW(A_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_WHITE);
        m.mainseqno = CREDITSSCENE_TERMINATE;
        return 0;
      }
      if (m.timer) {
        m.timer--;
      } else {
        m.mainseqno = CREDITSSCENE_TERMINATE;
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_WHITE);
      }
      return 0;
    case CREDITSSCENE_TERMINATE:
      if (!gPaletteFade.active) DestroyCreditsWindow();
      break;
  }
  return 2;
}

function VBlankCB(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** SetBgAffine(bg, srcCenterX, srcCenterY, dispCenterX, dispCenterY, scaleX, scaleY, rotation 0): BgAffineSet's result in BGxPA..BGxY. */
function SetBgAffine(bg: number, srcCenterX: number, srcCenterY: number, dispCenterX: number, dispCenterY: number, scaleX: number, scaleY: number): void {
  const base = 0x20 + (bg - 2) * 0x10;
  // no rotation: pa = sx, pd = sy, pb = pc = 0; start = srcCenter - (pa * dispCenterX, pd * dispCenterY)
  const x = srcCenterX - scaleX * dispCenterX;
  const y = srcCenterY - scaleY * dispCenterY;
  SetGpuReg(base + 0, scaleX & 0xffff);
  SetGpuReg(base + 2, 0);
  SetGpuReg(base + 4, 0);
  SetGpuReg(base + 6, scaleY & 0xffff);
  SetGpuReg(base + 8, x & 0xffff);
  SetGpuReg(base + 10, (x >> 16) & 0xffff);
  SetGpuReg(base + 12, y & 0xffff);
  SetGpuReg(base + 14, (y >> 16) & 0xffff);
}

/** LoadMonPicInWindow (CreateTrainerCardSprite): the front pic blitted into the window, its palette into BG slot `paletteSlot`. */
function LoadMonPicInWindow(species: number, otId: number, personality: number, paletteSlot: number, windowId: number): void {
  const framePics = new Uint8Array(4 * 0x800);
  LoadSpecialPokePic(true, species, personality, framePics);
  BlitBitmapRectToWindow(windowId, framePics, 0, 0, 0x40, 0x40, 0, 0, 0x40, 0x40);
  LoadPalette(GetMonSpritePalFromSpeciesAndPersonality(species, otId, personality), BG_PLTT_ID(paletteSlot), PLTT_SIZE_4BPP);
}

function LoadCreditsMonPic(whichMon: number): void {
  const mon = sCreditsMons[whichMon];
  InitWindows(mon.windows);
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  LoadMonPicInWindow(K[mon.species], K.SHINY_ODDS, 0, 10, 0);
  CopyToWindowPixelBuffer(1, gfx(mon.tiles[0]), 0, 0);
  CopyToWindowPixelBuffer(2, gfx(mon.tiles[1]), 0, 0);
  CopyWindowToVram(0, COPYWIN_GFX);
  CopyWindowToVram(1, COPYWIN_GFX);
  CopyWindowToVram(2, COPYWIN_GFX);
}

function DoCreditsMonScene(): boolean {
  const m = M();
  switch (m.subseqno) {
    case 0:
      creditsEnv.bareScreen();
      SetVBlankCallback(null);
      SetHBlankCallback(null);
      ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
      SetGpuReg(REG_OFFSET_WININ, 0);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      ResetPaletteFade();
      ResetSpriteData();
      ResetTasks();
      ResetBgsAndClearDma3BusyFlags(true);
      InitBgsFromTemplates(1, sBgTemplates_MonSceneOrTheEnd, sBgTemplates_MonSceneOrTheEnd.length);
      SetBgTilemapBuffer(0, new Uint16Array(0x400));
      ChangeBgX(0, 0, 0);
      ChangeBgY(0, 0, 0);
      ChangeBgX(1, 0, 0);
      ChangeBgY(1, 0, 0);
      m.creditsMonTimer = 0;
      m.unk_0E = 0;
      SetBgAffine(2, 0x8000, 0x8000, 0x78, 0x50, m.creditsMonTimer, m.creditsMonTimer);
      LoadBgTiles(1, gfx('gCreditsMonPokeball_Tiles'), 0x2000, 0);
      LoadBgTiles(2, gfx('sCreditsMonCircle_Tiles'), 0x2000, 0);
      LoadBgTilemap(1, gfx('gCreditsMonPokeball_Tilemap'), 0x500, 0);
      LoadBgTilemap(2, gfx('sCreditsMonCircle_Tilemap'), 0x400, 0);
      LoadPalette(gfx16('gCreditsMonPokeball_Pals').subarray(m.whichMon * 16, m.whichMon * 16 + 16), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
      LoadPalette(gfx16('sCreditsMonCircle_Pal'), BG_PLTT_ID(15), 32);
      LoadCreditsMonPic(m.whichMon);
      SetVBlankCallback(VBlankCB);
      m.subseqno++;
      break;
    case 1:
      FillBgTilemapBufferRect(0, 0, 0, 0, 32, 32, 17);
      PutWindowTilemap(0);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      m.subseqno++;
      break;
    case 2:
      ShowBg(2);
      ShowBg(0);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      m.creditsMonTimer = 40;
      m.subseqno++;
      testEvent('creditsMon', { species: K[sCreditsMons[m.whichMon].species] });
      break;
    case 3:
      if (m.creditsMonTimer !== 0) m.creditsMonTimer--;
      else m.subseqno++;
      break;
    case 4:
      if (!gPaletteFade.active) {
        m.creditsMonTimer = 8;
        m.unk_0E = 1;
        m.subseqno++;
      }
      break;
    case 5:
      if (m.creditsMonTimer !== 0) m.creditsMonTimer--;
      else if (m.unk_0E < 3) {
        PutWindowTilemap(m.unk_0E);
        CopyBgTilemapBufferToVram(0);
        m.creditsMonTimer = 4;
        m.unk_0E++;
      } else m.subseqno++;
      break;
    case 6:
      if (m.creditsMonTimer < 256) {
        m.creditsMonTimer += 16;
        SetBgAffine(2, 0x8000, 0x8000, 0x78, 0x50, m.creditsMonTimer, m.creditsMonTimer);
      } else {
        SetBgAffine(2, 0x8000, 0x8000, 0x78, 0x50, 0x100, 0x100);
        m.creditsMonTimer = 32;
        m.subseqno++;
      }
      break;
    case 7:
      if (m.creditsMonTimer !== 0) m.creditsMonTimer--;
      else {
        HideBg(2);
        ShowBg(1);
        // PlayCry_NormalNoDucking: no audio
        m.creditsMonTimer = 128;
        m.subseqno++;
      }
      break;
    case 8:
      if (m.creditsMonTimer !== 0) m.creditsMonTimer--;
      else {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
        m.subseqno++;
      }
      break;
    case 9:
      if (!gPaletteFade.active) {
        FreeAllWindowBuffers();
        m.subseqno = 0;
        return true;
      }
      break;
  }
  return false;
}

function DoCopyrightOrTheEndGfxScene(): boolean {
  const m = M();
  switch (m.subseqno) {
    case 0: {
      creditsEnv.bareScreen();
      SetVBlankCallback(null);
      SetHBlankCallback(null);
      ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
      SetGpuReg(REG_OFFSET_WININ, 0);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      ResetPaletteFade();
      ResetSpriteData();
      ResetTasks();
      ResetBgsAndClearDma3BusyFlags(true);
      InitBgsFromTemplates(0, sBgTemplates_MonSceneOrTheEnd, 1);
      ChangeBgX(0, 0, 0);
      ChangeBgY(0, 0, 0);
      const h = sCopyrightOrTheEndGfxHeaders[m.whichMon];
      LoadBgTiles(0, gfx(h.tiles), gfx(h.tiles).length, 0);
      LoadBgTilemap(0, gfx(h.map), 0x800, 0);
      const pal = gfx16(h.palette);
      LoadPalette(pal, BG_PLTT_ID(0), Math.min(pal.length * 2, 16 * PLTT_SIZE_4BPP));
      SetVBlankCallback(VBlankCB);
      m.subseqno++;
      break;
    }
    case 1:
      CopyBgTilemapBufferToVram(0);
      m.subseqno++;
      break;
    case 2:
      ShowBg(0);
      if (m.whichMon !== 0) BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0, RGB_BLACK);
      else BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      m.subseqno++;
      break;
    case 3:
      if (!gPaletteFade.active) {
        m.subseqno = 0;
        return true;
      }
      break;
  }
  return false;
}

// Task_MovePlayerAndGroundSprites's data: spriteMoveCmd, characterSpriteId, groundSpriteId
const tSpriteMoveCmd = 0;
const tCharacterSpriteId = 1;
const tGroundSpriteId = 2;

function Task_MovePlayerAndGroundSprites(taskId: number): void {
  const d = gTasks[taskId].data;
  const ch = gSprites[d[tCharacterSpriteId]];
  const ground = gSprites[d[tGroundSpriteId]];
  switch (d[tSpriteMoveCmd]) {
    case 1:
      if (ch.x !== 0xd0) {
        ch.x--;
        ground.x--;
      } else d[tSpriteMoveCmd] = 0;
      break;
    case 2:
      if (M().unk_1D & 1) {
        if (ch.y !== 0x50) {
          ch.y--;
          ground.y--;
        } else d[tSpriteMoveCmd] = 0;
      }
      break;
    case 3:
      if (M().mainseqno === CREDITSSCENE_THEEND_DESTROY_ASSETS) {
        ch.x--;
        ground.x--;
      }
      break;
  }
}

function DestroyPlayerOrRivalSprite(): void {
  const m = M();
  if (m.taskId === TASK_NONE) return;
  const d = gTasks[m.taskId].data;
  FreeSpriteTilesByTag(GFXTAG_CHARACTER);
  DestroySprite(gSprites[d[tCharacterSpriteId]]);
  FreeSpriteTilesByTag(GFXTAG_GROUND);
  DestroySprite(gSprites[d[tGroundSpriteId]]);
  DestroyTask(m.taskId);
  m.taskId = TASK_NONE;
}

function LoadPlayerOrRivalSprite(whichScene: number): void {
  const m = M();
  if (m.taskId !== TASK_NONE) return;
  const taskId = CreateTask(Task_MovePlayerAndGroundSprites, 0);
  const d = gTasks[taskId].data;
  m.taskId = taskId;
  const [who, groundType, moveCmd] = sPlayerRivalSpriteParams[whichScene];
  let x = DISPLAY_WIDTH - 32;
  let y = DISPLAY_HEIGHT / 2;
  if (moveCmd === 1) x = DISPLAY_WIDTH + 32;
  else if (moveCmd === 2) y = DISPLAY_HEIGHT;
  d[tSpriteMoveCmd] = moveCmd;
  const character = who === 1 ? 'sRival' : creditsEnv.playerGender() === K.MALE ? 'sPlayerMale' : 'sPlayerFemale';
  const tiles = gfx(`${character}_Tiles`);
  LoadSpriteSheet({ data: tiles, size: tiles.length, tag: GFXTAG_CHARACTER });
  LoadPalette(gfx16(`${character}_Pal`), OBJ_PLTT_ID(15), 32);
  d[tCharacterSpriteId] = CreateSprite(sPlayerOrRivalSpriteTemplate(), x, y, 0);
  gSprites[d[tCharacterSpriteId]].oam.paletteNum = 15;
  gSprites[d[tCharacterSpriteId]].subpriority = 0;

  const ground = ['sGround_Grass', 'sGround_Grass', 'sGround_Dirt', 'sGround_City'][groundType];
  const groundTiles = gfx(`${ground}_Tiles`);
  LoadSpriteSheet({ data: groundTiles, size: groundTiles.length, tag: GFXTAG_GROUND });
  LoadPalette(gfx16(`${ground}_Pal`), OBJ_PLTT_ID(14), 32);
  d[tGroundSpriteId] = CreateSprite(sGroundSpriteTemplate(groundType !== 1), x, y + 38, 0);
  gSprites[d[tGroundSpriteId]].oam.paletteNum = 14;
  gSprites[d[tGroundSpriteId]].subpriority = 1;
}

// ------------------------------------------------------------------ overworld.c's credits scenes

const CREDITSOVWLDCMD_END = 0xfd;

/** sCreditsOverworld_Script as [unk_0, unk_2, unk_4] commands, the index and the remaining length */
let sCreditsOverworld_Script: number[][] = [];
let sCreditsOverworld_CmdIndex = 0;
let sCreditsOverworld_CmdLength = 0;
let sMapLoaded: (() => boolean) | null = null;
/** gFieldCamera's credits pan: its callback is set and its movement speeds */
const gFieldCamera = { pan: false, movementSpeedX: 0, movementSpeedY: 0 };

/** Overworld_DoScrollSceneForCredits (QL_TINT_NONE) + SetUpScrollSceneForCredits */
function Overworld_DoScrollSceneForCredits(scene: [string, number, number, number, number]): boolean {
  const m = M();
  const [map, x, y, xs, ys] = scene;
  switch (m.ovwldseqno) {
    case 0:
      // CREDITSOVWLDLOADMAP(map, x, y, 1), CREDITSOVWLDSCROLL(xs, ys, 0x500), CREDITSOVWLDEND
      sCreditsOverworld_Script = [
        [0xfe, 0, 0],
        [x, y, 1],
        [xs, ys, 0x500],
        [CREDITSOVWLDCMD_END, CREDITSOVWLDCMD_END, CREDITSOVWLDCMD_END],
      ];
      sCreditsOverworld_CmdIndex = 0;
      sCreditsOverworld_CmdLength = 0;
      m.ovwldseqno++;
      return false;
    case 1:
      sCreditsOverworld_CmdIndex++;
      sCreditsOverworld_CmdLength = sCreditsOverworld_Script[sCreditsOverworld_CmdIndex][2];
      // WarpIntoMap + MapLdr_Credits (gPaletteFade.bufferTransferDisabled while it loads)
      gFieldCamera.pan = false;
      gFieldCamera.movementSpeedX = 0;
      gFieldCamera.movementSpeedY = 0;
      sMapLoaded = creditsEnv.loadMap(map, x, y);
      m.ovwldseqno++;
      return false;
    case 2:
      if (!sMapLoaded!()) return false;
      // MapLdr_Credits: the BGs' text windows (InitOverworldBgs_NoResetHeap), InitTilesetAnimations (the host),
      // FadeSelectedPals(FADE_FROM_BLACK, 0, 0x3FFFFFFF)
      InitStandardTextBoxWindows();
      InitTextBoxGfxAndPrinters();
      BeginNormalPaletteFade(0x3fffffff, 0, 16, 0, RGB_BLACK);
      m.ovwldseqno++;
      return false;
    case 3:
      gFieldCamera.pan = true; // gFieldCamera.callback = CameraCB_CreditsPan
      m.ovwldseqno = 0;
      return true;
  }
  return false;
}

/** CameraUpdateNoObjectRefresh: the camera callback, then the move. */
function CameraUpdateNoObjectRefresh(): void {
  if (gFieldCamera.pan) CameraCB_CreditsPan();
  if (gFieldCamera.movementSpeedX || gFieldCamera.movementSpeedY) creditsEnv.moveCamera(gFieldCamera.movementSpeedX, gFieldCamera.movementSpeedY);
}

/** CameraCB_CreditsPan */
function CameraCB_CreditsPan(): void {
  const camera = gFieldCamera;
  if (sCreditsOverworld_CmdLength === 0) {
    sCreditsOverworld_CmdIndex++;
    const cmd = sCreditsOverworld_Script[sCreditsOverworld_CmdIndex];
    switch (cmd[0]) {
      case 0xfc: // CREDITSOVWLDCMD_FC
      case 0xfe: // CREDITSOVWLDCMD_LOADMAP
        return;
      case 0xff: // CREDITSOVWLDCMD_FF (Task_OvwldCredits_FadeOut: unused by FRLG's scenes)
      case 0xfb: // CREDITSOVWLDCMD_FB
      case CREDITSOVWLDCMD_END:
        camera.movementSpeedX = 0;
        camera.movementSpeedY = 0;
        camera.pan = false;
        return;
      default:
        sCreditsOverworld_CmdLength = cmd[2];
        camera.movementSpeedX = cmd[0];
        camera.movementSpeedY = cmd[1];
        break;
    }
  }
  if (sCreditsOverworld_Script[sCreditsOverworld_CmdIndex][0] === 0xff) {
    camera.movementSpeedX = 0;
    camera.movementSpeedY = 0;
  } else sCreditsOverworld_CmdLength--;
}

/** Dev: where the credits are. */
export function creditsProbe(): { mainseqno: number; scrcmdidx: number; whichMon: number } | undefined {
  return sCreditsMgr ? { mainseqno: sCreditsMgr.mainseqno, scrcmdidx: sCreditsMgr.scrcmdidx, whichMon: sCreditsMgr.whichMon } : undefined;
}

/**
 * Dev (tests): jump the credits script to its closing (the copyright, THE END) from wherever it's waiting between
 * commands, so a test doesn't have to watch all of it. Returns whether it jumped.
 */
export function creditsSkipToClosing(): boolean {
  const m = sCreditsMgr;
  if (!m || m.mainseqno !== CREDITSSCENE_EXEC_CMD) return false;
  m.scrcmdidx = sCreditsScript.findIndex(([cmd]) => cmd === CREDITSSCRCMD_THEENDGFX);
  m.timer = 0;
  return true;
}
