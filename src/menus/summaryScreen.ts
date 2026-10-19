// pokemon_summary_screen.c: the POKéMON INFO / SKILLS / KNOWN MOVES pages, the move details page
// (switching moves), and the select-a-move-to-forget mode used when learning moves.
//
// Box mons (PSS_MODE_BOX, from the PC) are a box's slots (BoxPokemon | null); the screen shows each through
// BoxMonToMon. Not ported because the systems don't exist yet: the trade screen's view of the partner's
// party, multi-battle party order (link) and Pokémon cries. The struct Pokemon fields the
// port doesn't store read as their defaults: met game FireRed, no "fateful encounter" flag, English language.

import { K } from '../battle/constants';
import { SetHelpContext } from '../ui/helpSystemContext';
import { g, pokemon, state } from '../battle/env';
import { GetHPBarLevel } from '../battle/battleInterface';
import { gBallSpriteTemplates, DestroySpriteAndFreeResources_Ball, ItemIdToBallId, LoadBallGfx, ShouldPlayNormalMonCry, animTable } from '../battle/gfx';
import { bdata } from '../battle/env';
import { CheckPartyPokerus } from '../battle/items';
import { moveName } from '../battle/message';
import { getAbilityBySpecies } from '../battle/pokemonBattle';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  ClearGpuRegBits,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN1_ON,
  GetGpuReg,
  PALETTES_ALL,
  pltt,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  SetGpuReg,
  vram,
  WININ_WIN0_BG0,
  WININ_WIN0_BG1,
  WININ_WIN0_BG2,
  WININ_WIN0_BG3,
  WININ_WIN0_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
} from '../gba/hw';
import { BlitMenuInfoIcon, ListMenuLoadStdPalAt } from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, L_BUTTON, R_BUTTON, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { FreeTempTileDataBuffersIfPossible, DecompressAndCopyTileDataToVram, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { IsCryPlayingOrClearCrySongs, PlayCry_ByMode, PlaySE, StopCryAndClearCrySongs } from '../gba/sound';
import {
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySpriteAndFreeResources,
  FreeAllSpritePalettes,
  FreeSpriteOamMatrix,
  gDummySpriteAffineAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetStringWidth,
  InitWindows,
  PutWindowTilemap,
  RemoveWindow,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import {
  ConvertIntToDecimalStringN,
  concat,
  CopyItemName,
  encodeRaw,
  EOS,
  GetMonNickname,
  speciesName,
  speciesOrEgg,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  strBody,
  stringsEqual,
  text,
} from './common';
import { menusData } from './data';
import { GetMapName } from '../world/regionMap';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from './dynamicPlaceholderText';
import { SpecialVar } from './itemMenuState';
import { CreateMonMarkingAllCombosSprite } from './monMarkings';
import { CreateMonPicSprite, CreateMonPicSprite_HandleDeoxys, FreeAndDestroyMonPicSprite } from './picSprites';
import { CreateMonIcon, DestroyMonIcon, SafeFreeMonIconPalette, SafeLoadMonIconPalette } from './pokemonIcon';
import { boxMonToMon, type BoxPokemon } from '../state/PokemonStorage';
import { SpeciesToPokedexNum } from '../state/nationalDex';

// ------------------------------------------------------------------ struct PokemonSummaryScreenData

interface PokeSummary {
  speciesNameStrBuf: number[];
  nicknameStrBuf: number[];
  otNameStrBuf: number[];
  otNameStrBufs: [number[], number[]];
  dexNumStrBuf: number[];
  unk306C: number[];
  itemNameStrBuf: number[];
  genderSymbolStrBuf: number[];
  levelStrBuf: number[];
  curHpStrBuf: number[];
  statValueStrBufs: number[][];
  moveCurPpStrBufs: number[][];
  moveMaxPpStrBufs: number[][];
  moveNameStrBufs: number[][];
  movePowerStrBufs: number[][];
  moveAccuracyStrBufs: number[][];
  expPointsStrBuf: number[];
  expToNextLevelStrBuf: number[];
  abilityNameStrBuf: number[];
  abilityDescStrBuf: number[];
}

const emptyStrs = (n: number) => Array.from({ length: n }, () => [EOS]);

function newSummaryScreenData() {
  return {
    bg1TilemapBuffer: new Uint16Array(0x800),
    bg2TilemapBuffer: new Uint16Array(0x800),
    bg3TilemapBuffer: new Uint16Array(0x800),
    windowIds: [0, 0, 0, 0, 0, 0, 0],
    ballIconSpriteId: 0,
    monPicSpriteId: 0,
    monIconSpriteId: 0,
    inputHandlerTaskId: 0,
    inhibitPageFlipInput: false,
    numMonPicBounces: 0,
    isEnemyParty: false,
    summary: {
      speciesNameStrBuf: [EOS],
      nicknameStrBuf: [EOS],
      otNameStrBuf: [EOS],
      otNameStrBufs: [[EOS], [EOS]],
      dexNumStrBuf: [EOS],
      unk306C: [EOS],
      itemNameStrBuf: [EOS],
      genderSymbolStrBuf: [EOS],
      levelStrBuf: [EOS],
      curHpStrBuf: [EOS],
      statValueStrBufs: emptyStrs(5),
      moveCurPpStrBufs: emptyStrs(5),
      moveMaxPpStrBufs: emptyStrs(5),
      moveNameStrBufs: emptyStrs(5),
      movePowerStrBufs: emptyStrs(5),
      moveAccuracyStrBufs: emptyStrs(5),
      expPointsStrBuf: [EOS],
      expToNextLevelStrBuf: [EOS],
      abilityNameStrBuf: [EOS],
      abilityDescStrBuf: [EOS],
    } as PokeSummary,
    isEgg: false,
    isBadEgg: false,
    mode: 0,
    lastIndex: 0,
    curPageIndex: 0,
    isBoxMon: false,
    monTypes: [0, 0],
    pageFlipDirection: 0,
    lockMovesFlag: false,
    whichBgLayerToTranslate: 0,
    skillsPageBgNum: 0,
    infoAndMovesPageBgNum: 0,
    flippingPages: false,
    flipPagesBgHofs: 0,
    moveTypes: [0, 0, 0, 0, 0],
    moveIds: [0, 0, 0, 0, 0],
    numMoves: 0,
    isSwappingMoves: false,
    curMonStatusAilment: 0,
    state3270: 0,
    summarySetupStep: 0,
    loadBgGfxStep: 0,
    spriteCreationStep: 0,
    bufferStringsStep: 0,
    state3284: 0,
    selectMoveInputHandlerState: 0,
    switchMonTaskState: 0,
    currentMon: null as unknown as Pokemon,
    /** monList.mons, or monList.boxMons when isBoxMon */
    monList: [] as Pokemon[] | (BoxPokemon | null)[],
    savedCallback: null as unknown as MainCallback,
    markingSprite: null as Sprite | null,
    lastPageFlipDirection: 0,
  };
}
type PokemonSummaryScreenData = ReturnType<typeof newSummaryScreenData>;

/** struct Struct203B144: right-alignment x offsets of the printed numbers */
function newPrinterXpos() {
  return { unk00: 0, curHpStr: 0, atkStr: 0, defStr: 0, spAStr: 0, spDStr: 0, speStr: 0, expStr: 0, toNextLevel: 0, curPp: [0, 0, 0, 0, 0], maxPp: [0, 0, 0, 0, 0] };
}

interface BarObjs {
  sprites: Sprite[];
  xpos: number[];
  tileTag: number;
  palTag: number;
}

interface IconObj {
  sprite: Sprite | null;
  tileTag: number;
  palTag: number;
}

interface MoveSelectionCursor extends IconObj {
  whichSprite: number;
}

let sMonSummaryScreenPtr: PokemonSummaryScreenData | null = null;
let sMonSkillsPrinterXposPtr: ReturnType<typeof newPrinterXpos> | null = null;
let sMoveSelectionCursorObjs: (MoveSelectionCursor | null)[] = [null, null, null, null];
let sStatusIcon: IconObj | null = null;
let sHpBarObjs: BarObjs | null = null;
let sExpBarObjs: BarObjs | null = null;
let sPokerusIconObj: IconObj | null = null;
let sShinyStarObjData: IconObj | null = null;
let sLastViewedMonIndex = 0;
let sMoveSelectionCursorPos = 0;
let sMoveSwapCursorPos = 0;
let sMonPicBounceState: { animFrame: number; initDelay: number; vigor: number } | null = null;

const S = () => sMonSummaryScreenPtr!;
const X = () => sMonSkillsPrinterXposPtr!;
const HP = () => sHpBarObjs!;
const EXP = () => sExpBarObjs!;

// ------------------------------------------------------------------ data

const sMoveSelectionCursorOamData = oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1] });
const sStatusAilmentIconOamData = oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1] });
const sHpOrExpBarOamData = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1] });
const sPokerusIconObjOamData = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1] });
const sStarObjOamData = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1] });

const anims = (name: string) => animTable('pokemon_summary_screen.c', name);

const sEggHatchTimeTexts = () => [text('gText_PokeSum_EggHatch_LongTime'), text('gText_PokeSum_EggHatch_SomeTime'), text('gText_PokeSum_EggHatch_Soon'), text('gText_PokeSum_EggHatch_AlmostReady')];

const sEggOriginTexts = () => [
  text('gText_PokeSum_EggOrigin_DayCare'),
  text('gText_PokeSum_EggOrigin_Trade'),
  text('gText_PokeSum_EggOrigin_TravelingMan'),
  text('gText_PokeSum_EggOrigin_Trade'),
  text('gText_PokeSum_EggOrigin_NicePlace'),
  text('gText_PokeSum_EggOrigin_Spa'),
  text('gText_PokeSum_EggOrigin_Trade'),
];

const sPrintMoveTextColors = [
  [0, 7, 8],
  [0, 1, 2],
  [0, 3, 4],
  [0, 5, 6],
];

const sBgTempaltes: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 14, screenSize: 1, paletteMode: 0, priority: 0, baseTile: 0x0000 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 10, screenSize: 1, paletteMode: 0, priority: 1, baseTile: 0x0000 },
  { bg: 3, charBaseIndex: 2, mapBaseIndex: 9, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x0000 },
  { bg: 1, charBaseIndex: 2, mapBaseIndex: 12, screenSize: 1, paletteMode: 0, priority: 2, baseTile: 0x0000 },
];

const POKESUM_WIN_PAGE_NAME = 0;
const POKESUM_WIN_CONTROLS = 1;
const POKESUM_WIN_LVL_NICK = 2;
const POKESUM_WIN_RIGHT_PANE = 3;
const POKESUM_WIN_TRAINER_MEMO = 4;

const win = (bg: number, tilemapLeft: number, tilemapTop: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate => ({ bg, tilemapLeft, tilemapTop, width, height, paletteNum, baseBlock });

const sWindowTemplates_Permanent_Bg1 = [win(1, 0, 0, 13, 2, 7, 0x0258), win(1, 19, 0, 11, 2, 7, 0x0272), win(1, 0, 2, 15, 2, 7, 0x0288)];
const sWindowTemplates_Permanent_Bg2 = [win(2, 0, 0, 13, 2, 7, 0x0258), win(2, 19, 0, 11, 2, 7, 0x0272), win(2, 0, 2, 15, 2, 7, 0x0288)];
const sWindowTemplates_Info = [win(0, 15, 2, 15, 12, 6, 0x0001), win(0, 1, 14, 28, 6, 6, 0x00b5), win(0, 0, 0, 0, 0, 0, 0), win(0, 0, 0, 0, 0, 0, 0)];
const sWindowTemplates_Skills = [win(0, 20, 2, 10, 14, 6, 0x0001), win(0, 6, 12, 14, 4, 6, 0x008d), win(0, 1, 16, 29, 4, 6, 0x00c5), win(0, 0, 0, 0, 0, 0, 0)];
const sWindowTemplates_Moves = [win(0, 20, 2, 10, 18, 8, 0x0001), win(0, 0, 7, 15, 13, 6, 0x00b5), win(0, 15, 2, 5, 18, 6, 0x0178), win(0, 6, 4, 9, 2, 6, 0x01d2)];
const sWindowTemplates_Dummy = [win(255, 0, 0, 0, 0, 0, 0)];

const sLevelNickTextColors = [
  [0, 14, 10],
  [0, 1, 2],
  [0, 9, 8],
  [0, 5, 4],
  [0, 2, 3],
  [0, 11, 10],
];

const sMultiBattlePartyOrder = [0, 2, 3, 1, 4, 5];

const sMonPicBounceYDelta_Under60 = [-1, 0, 1];
const sMonPicBounceYDelta_60to80 = [-2, -1, 0, 1, 2];
const sMonPicBounceYDelta_80to99 = [-3, -2, -1, 0, 1, 2, 3];
const sMonPicBounceYDelta_Full = [-5, -3, -1, 0, 1, 3, 5];
const sEggPicShakeXDelta_ItWillTakeSomeTime = [1, 1, 0, -1, -1, 0, -1, -1, 0, 1, 1];
const sEggPicShakeXDelta_OccasionallyMoves = [2, 1, 0, -1, -2, 0, -2, -1, 0, 1, 2];
const sEggPicShakeXDelta_AlmostReadyToHatch = [2, 1, 1, 0, -1, -1, -2, 0, -2, -1, -1, 0, 1, 1, 2];

const sHpBarPals = () => [gfx16('gSummaryScreen_HpExpBar_Pal'), gfx16('sPokeSummary_HpBarPalYellow'), gfx16('sPokeSummary_HpBarPalRed')];

/** Every graphics symbol the summary screen loads (pics, palettes and balls come per mon). */
export const SUMMARY_SCREEN_GFX = [
  'gSummaryScreen_Bg_Gfx',
  'gSummaryScreen_Bg_Pal',
  'gSummaryScreen_PageInfo_Tilemap',
  'gSummaryScreen_PageSkills_Tilemap',
  'gSummaryScreen_PageMoves_Tilemap',
  'gSummaryScreen_PageMovesInfo_Tilemap',
  'gSummaryScreen_PageEgg_Tilemap',
  'gSummaryScreen_HpExpBar_Pal',
  'gSummaryScreen_HpBar_Gfx',
  'gSummaryScreen_ExpBar_Gfx',
  'gSummaryScreen_StatusAilmentIcon_Gfx',
  'gSummaryScreen_StatusAilmentIcon_Pal',
  'sTextHeaderPalette',
  'sMonMarkingSpritePalette',
  'sTextMovesPalette',
  'sMoveSelectionCursorPals',
  'sMoveSelectionCursorTiles_Left',
  'sMoveSelectionCursorTiles_Right',
  'sPokeSummary_HpBarPalYellow',
  'sPokeSummary_HpBarPalRed',
  'sPokerusIconObjPal',
  'sPokerusIconObjTiles',
  'sStarObjPal',
  'sStarObjTiles',
  'sBgTilemap_MovesInfoPage',
  'sBgTilemap_MovesPage',
  'sMonMarkings_Gfx',
  'sMonMarkings_Pal',
  'gMenuInfoElements_Gfx',
  'gMenuInfoElements1_Pal',
  'gMenuInfoElements2_Pal',
];

// ------------------------------------------------------------------ GetMonData stand-ins

const monMove = (mon: Pokemon, slot: number) => mon.moves[slot] ?? 0;
const monPp = (mon: Pokemon, slot: number) => mon.pp[slot] ?? 0;
/** MON_DATA_MET_LOCATION as its map section id */
const monMetLocation = (mon: Pokemon) => (K as unknown as Record<string, number>)[mon.metLocation] & 0xff;
/** MON_DATA_MET_GAME: the port only creates FireRed mons. */
const monMetGame = (_mon: Pokemon) => K.VERSION_FIRE_RED;
/** MON_DATA_MODERN_FATEFUL_ENCOUNTER */
const monFatefulEncounter = (_mon: Pokemon) => false;
/** MON_DATA_MARKINGS */
const monMarkings = (mon: Pokemon) => mon.markings ?? 0;

/** IsMonShiny */
function IsMonShiny(mon: Pokemon): boolean {
  const otId = mon.otId >>> 0;
  const p = mon.personality >>> 0;
  return ((otId >>> 16) ^ (otId & 0xffff) ^ (p >>> 16) ^ (p & 0xffff)) < K.SHINY_ODDS;
}

/** CheckPartyHasHadPokerus(mon, 0) */
const CheckPartyHasHadPokerus = (mon: Pokemon) => (mon.pokerus ?? 0) !== 0;

/** IsMonSpriteNotFlipped */
const IsMonSpriteNotFlipped = (species: number) => !!pokemon.species[species]?.noFlip;

/** IsMoveHm */
function IsMoveHm(move: number): boolean {
  const hm = bdata.tables.mech.sHMMoves as number[];
  for (let i = 0; hm[i] !== 0xffff; i++) if (hm[i] === move) return true;
  return false;
}

/** StringLength */
const StringLength = (s: number[]) => strBody(s).length;

const EXT_CTRL_CODE_BEGIN = 0xfc;
/** GetExtCtrlCodeLength (string_util.c), less one for the code byte itself. */
const sExtCtrlCodeLengths = [1, 2, 2, 2, 4, 2, 2, 1, 2, 1, 1, 3, 2, 2, 2, 1, 3, 2, 2, 2, 2, 1, 1, 1, 1];

/** StringCompareWithoutExtCtrlCodes */
function StringCompareWithoutExtCtrlCodes(a: number[], b: number[]): number {
  const skip = (s: number[], i: number) => {
    while (s[i] === EXT_CTRL_CODE_BEGIN) {
      i++;
      i += sExtCtrlCodeLengths[s[i]] ?? 1;
    }
    return i;
  };
  let i = 0;
  let j = 0;
  let retVal = 0;
  for (;;) {
    i = skip(a, i);
    j = skip(b, j);
    if (a[i] > b[j]) break;
    if (a[i] < b[j]) {
      retVal = -1;
      if (b[j] === EOS) retVal = 1;
    }
    if (a[i] === EOS) return retVal;
    i++;
    j++;
  }
  retVal = 1;
  if (a[i] === EOS) retVal = -1;
  return retVal;
}

/** GetMapNameGeneric_ */
const GetMapNameGeneric_ = (mapsec: number) => GetMapName(mapsec, 0);

const GetPlayerTrainerId = () => state.trainerId >>> 0;

// ------------------------------------------------------------------ entry points

export function ShowPokemonSummaryScreen(party: Pokemon[] | (BoxPokemon | null)[], cursorPos: number, lastIdx: number, savedCallback: MainCallback, mode: number): void {
  sMonSummaryScreenPtr = newSummaryScreenData();
  sMonSkillsPrinterXposPtr = newPrinterXpos();
  const s = S();

  sLastViewedMonIndex = cursorPos;

  sMoveSelectionCursorPos = 0;
  sMoveSwapCursorPos = 0;
  s.savedCallback = savedCallback;
  s.monList = party;

  s.isEnemyParty = party === g.enemyParty;

  s.lastIndex = lastIdx;
  s.mode = mode;

  switch (s.mode) {
    case K.PSS_MODE_NORMAL:
    default:
      SetHelpContext(K.HELPCONTEXT_POKEMON_INFO);
      s.curPageIndex = K.PSS_PAGE_INFO;
      s.isBoxMon = false;
      s.lockMovesFlag = false;
      break;
    case K.PSS_MODE_BOX:
      SetHelpContext(K.HELPCONTEXT_POKEMON_INFO);
      s.curPageIndex = K.PSS_PAGE_INFO;
      s.isBoxMon = true;
      s.lockMovesFlag = false;
      break;
    case K.PSS_MODE_SELECT_MOVE:
    case K.PSS_MODE_FORGET_MOVE:
      SetHelpContext(K.HELPCONTEXT_POKEMON_MOVES);
      s.curPageIndex = K.PSS_PAGE_MOVES_INFO;
      s.isBoxMon = false;
      s.lockMovesFlag = true;
      break;
  }

  s.state3270 = 0;
  s.summarySetupStep = 0;
  s.loadBgGfxStep = 0;
  s.spriteCreationStep = 0;

  s.whichBgLayerToTranslate = 0;
  s.skillsPageBgNum = 2;
  s.infoAndMovesPageBgNum = 1;
  s.flippingPages = false;

  BufferSelectedMonData();
  s.isEgg = s.currentMon.isEgg;
  s.isBadEgg = false; // MON_DATA_SANITY_IS_BAD_EGG

  if (s.isBadEgg) s.isEgg = true;

  s.lastPageFlipDirection = 0xff;
  SetMainCallback2(CB2_SetUpPSS);
}

export function ShowSelectMovePokemonSummaryScreen(party: Pokemon[], cursorPos: number, lastIdx: number, savedCallback: MainCallback, a4: number): void {
  ShowPokemonSummaryScreen(party, cursorPos, lastIdx, savedCallback, K.PSS_MODE_SELECT_MOVE);
  S().moveIds[4] = a4;
}

function PageFlipInputIsDisabled(direction: number): boolean {
  return S().inhibitPageFlipInput && S().pageFlipDirection !== direction;
}

export function IsPageFlipInput(direction: number): boolean {
  const s = S();
  if (s.isEgg) return false;

  if (s.lastPageFlipDirection !== 0xff && s.lastPageFlipDirection === direction) {
    s.lastPageFlipDirection = 0xff;
    return true;
  }

  if (PageFlipInputIsDisabled(direction)) return false;

  switch (direction) {
    case 1:
      if (JOY_NEW(DPAD_RIGHT)) return true;
      if (state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_LR && JOY_NEW(R_BUTTON)) return true;
      break;
    case 0:
      if (JOY_NEW(DPAD_LEFT)) return true;
      if (state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_LR && JOY_NEW(L_BUTTON)) return true;
      break;
  }
  return false;
}

function Task_InputHandler_Info(taskId: number): void {
  const s = S();
  switch (s.state3270) {
    case K.PSS_STATE3270_FADEIN:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0);
      s.state3270 = K.PSS_STATE3270_PLAYCRY;
      break;
    case K.PSS_STATE3270_PLAYCRY:
      if (!gPaletteFade.active) {
        PokeSum_TryPlayMonCry();
        s.state3270 = K.PSS_STATE3270_HANDLEINPUT;
        return;
      }
      s.state3270 = K.PSS_STATE3270_PLAYCRY;
      break;
    case K.PSS_STATE3270_HANDLEINPUT:
      // IsActiveOverworldLinkBusy / IsLinkRecvQueueAtOverworldMax: no link
      if (FuncIsActiveTask(Task_PokeSum_SwitchDisplayedPokemon)) return;

      if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) {
        if (IsPageFlipInput(1)) {
          if (FuncIsActiveTask(Task_PokeSum_FlipPages)) {
            s.lastPageFlipDirection = 1;
            return;
          } else if (s.curPageIndex < K.PSS_PAGE_MOVES) {
            PlaySE(K.SE_SELECT);
            HideBg(0);
            s.pageFlipDirection = 1;
            PokeSum_RemoveWindows(s.curPageIndex);
            s.curPageIndex++;
            s.state3270 = K.PSS_STATE3270_FLIPPAGES;
          }
          return;
        } else if (IsPageFlipInput(0)) {
          if (FuncIsActiveTask(Task_PokeSum_FlipPages)) {
            s.lastPageFlipDirection = 0;
            return;
          } else if (s.curPageIndex > K.PSS_PAGE_INFO) {
            PlaySE(K.SE_SELECT);
            HideBg(0);
            s.pageFlipDirection = 0;
            PokeSum_RemoveWindows(s.curPageIndex);
            s.curPageIndex--;
            s.state3270 = K.PSS_STATE3270_FLIPPAGES;
          }
          return;
        }
      }

      if (!FuncIsActiveTask(Task_PokeSum_FlipPages) || FuncIsActiveTask(Task_PokeSum_SwitchDisplayedPokemon)) {
        if (JOY_NEW(DPAD_UP)) {
          PokeSum_SeekToNextMon(taskId, -1);
          return;
        } else if (JOY_NEW(DPAD_DOWN)) {
          PokeSum_SeekToNextMon(taskId, 1);
          return;
        } else if (JOY_NEW(A_BUTTON)) {
          if (s.curPageIndex === K.PSS_PAGE_INFO) {
            PlaySE(K.SE_SELECT);
            s.state3270 = K.PSS_STATE3270_ATEXIT_FADEOUT;
          } else if (s.curPageIndex === K.PSS_PAGE_MOVES) {
            PlaySE(K.SE_SELECT);
            s.pageFlipDirection = 1;
            PokeSum_RemoveWindows(s.curPageIndex);
            s.curPageIndex++;
            s.state3270 = K.PSS_STATE3270_FLIPPAGES;
          }
          return;
        } else if (JOY_NEW(B_BUTTON)) {
          s.state3270 = K.PSS_STATE3270_ATEXIT_FADEOUT;
        }
      }
      break;
    case K.PSS_STATE3270_FLIPPAGES:
      if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) {
        CreateTask(Task_PokeSum_FlipPages, 0);
        s.state3270 = K.PSS_STATE3270_HANDLEINPUT;
      } else {
        gTasks[s.inputHandlerTaskId].func = Task_FlipPages_FromInfo;
        s.state3270 = K.PSS_STATE3270_HANDLEINPUT;
      }
      break;
    case K.PSS_STATE3270_ATEXIT_FADEOUT:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, 0);
      s.state3270 = K.PSS_STATE3270_ATEXIT_WAITLINKDELAY;
      break;
    case K.PSS_STATE3270_ATEXIT_WAITLINKDELAY:
      // Overworld_LinkRecvQueueLengthMoreThan2 / IsLinkRecvQueueAtOverworldMax: no link
      s.state3270 = K.PSS_STATE3270_ATEXIT_WAITFADE;
      break;
    default:
      if (!gPaletteFade.active) Task_DestroyResourcesOnExit(taskId);
      break;
  }
}

/** The three clears every flip does before drawing the new page (case 1 of the flip tasks). */
function clearPageHeaders(): void {
  const s = S();
  if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) {
    if (!(s.curPageIndex === K.PSS_PAGE_MOVES && s.pageFlipDirection === 0)) {
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 30, 20);
      CopyBgTilemapBufferToVram(0);
    }
  }
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 2);
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 2, 15, 2);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 30, 2);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 2, 15, 2);
}

function Task_PokeSum_FlipPages(taskId: number): void {
  const s = S();
  const data = gTasks[taskId].data;

  switch (data[0]) {
    case 0:
      PokeSum_HideSpritesBeforePageFlip();
      PokeSum_ShowSpritesBeforePageFlip();
      s.lockMovesFlag = true;
      s.inhibitPageFlipInput = true;
      PokeSum_UpdateWin1ActiveFlag(s.curPageIndex);
      PokeSum_AddWindows(s.curPageIndex);
      break;
    case 1:
      clearPageHeaders();
      break;
    case 2:
      PokeSum_CopyNewBgTilemapBeforePageFlip_2();
      PokeSum_CopyNewBgTilemapBeforePageFlip();
      PokeSum_DrawPageProgressTiles();
      PokeSum_PrintPageHeaderText(s.curPageIndex);
      break;
    case 3:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_PAGE_NAME], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_CONTROLS], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_LVL_NICK], 2);
      break;
    case 4:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CopyBgTilemapBufferToVram(3);
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
      } else return;
      break;
    case 5:
      PokeSum_InitBgCoordsBeforePageFlips();
      s.flippingPages = true;
      break;
    case 6:
      if (!PokeSum_IsPageFlipFinished(s.pageFlipDirection)) return;
      break;
    case 7:
      PokeSum_PrintRightPaneText();
      if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) PokeSum_PrintBottomPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      PokeSum_PrintMonTypeIcons();
      break;
    case 8:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      CopyWindowToVram(s.windowIds[6], 2);
      break;
    case 9:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CopyBgTilemapBufferToVram(0);
        ShowBg(0);
      } else return;
      break;
    default:
      PokeSum_SetHelpContext();
      if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) gTasks[s.inputHandlerTaskId].func = Task_HandleInput_SelectMove;
      DestroyTask(taskId);
      data[0] = 0;
      s.lockMovesFlag = false;
      s.inhibitPageFlipInput = false;
      return;
  }
  data[0]++;
}

function Task_FlipPages_FromInfo(_taskId: number): void {
  const s = S();
  switch (s.state3284) {
    case 0:
      s.lockMovesFlag = true;
      s.inhibitPageFlipInput = true;
      PokeSum_AddWindows(s.curPageIndex);
      break;
    case 1:
      clearPageHeaders();
      break;
    case 2:
      PokeSum_HideSpritesBeforePageFlip();
      PokeSum_UpdateWin1ActiveFlag(s.curPageIndex);
      PokeSum_CopyNewBgTilemapBeforePageFlip();
      PokeSum_DrawPageProgressTiles();
      PokeSum_CopyNewBgTilemapBeforePageFlip_2();
      break;
    case 3:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_KnownMoves'));
      // gReceivedRemoteLinkPlayers: no link
      if (!gMain.inBattle) PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PickSwitch'));
      else PokeSum_PrintControlsString(text('gText_PokeSum_Controls_Pick'));
      break;
    case 4:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_PAGE_NAME], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_CONTROLS], 2);
      break;
    case 5:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
        CopyBgTilemapBufferToVram(3);
      } else return;
      break;
    case 6:
      PokeSum_PrintRightPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      break;
    case 7:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CopyBgTilemapBufferToVram(0);
        PokeSum_InitBgCoordsBeforePageFlips();
        s.flippingPages = true;
      } else return;
      break;
    case 8:
      if (!PokeSum_IsPageFlipFinished(s.pageFlipDirection)) return;
      PokeSum_PrintBottomPaneText();
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      break;
    case 9:
      PokeSum_PrintMonTypeIcons();
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case 10:
      PokeSum_ShowSpritesBeforePageFlip();
      CopyWindowToVram(s.windowIds[6], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_LVL_NICK], 2);
      break;
    case 11:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CopyBgTilemapBufferToVram(0);
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
      } else return;
      break;
    default:
      PokeSum_SetHelpContext();
      gTasks[s.inputHandlerTaskId].func = Task_HandleInput_SelectMove;
      s.state3284 = 0;
      s.lockMovesFlag = false;
      s.inhibitPageFlipInput = false;
      return;
  }
  s.state3284++;
}

function Task_BackOutOfSelectMove(_taskId: number): void {
  const s = S();
  switch (s.state3284) {
    case 0:
      s.lockMovesFlag = true;
      s.inhibitPageFlipInput = true;
      PokeSum_AddWindows(s.curPageIndex);
      break;
    case 1:
      clearPageHeaders();
      break;
    case 2:
      PokeSum_CopyNewBgTilemapBeforePageFlip_2();
      break;
    case 3:
      PokeSum_PrintRightPaneText();
      PokeSum_PrintBottomPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      CopyBgTilemapBufferToVram(0);
      break;
    case 4:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_KnownMoves'));
      PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PageDetail'));
      break;
    case 5:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_PAGE_NAME], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_CONTROLS], 2);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      break;
    case 6:
      PokeSum_InitBgCoordsBeforePageFlips();
      s.flippingPages = true;
      PokeSum_HideSpritesBeforePageFlip();
      PokeSum_UpdateWin1ActiveFlag(s.curPageIndex);
      PokeSum_PrintMonTypeIcons();
      break;
    case 7:
      break;
    case 8:
      if (!PokeSum_IsPageFlipFinished(s.pageFlipDirection)) return;
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case 9:
      CopyWindowToVram(s.windowIds[6], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_LVL_NICK], 2);
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      break;
    case 10:
      PokeSum_CopyNewBgTilemapBeforePageFlip();
      PokeSum_DrawPageProgressTiles();
      CopyBgTilemapBufferToVram(3);
      PokeSum_ShowSpritesBeforePageFlip();
      break;
    default:
      PokeSum_SetHelpContext();
      gTasks[s.inputHandlerTaskId].func = Task_InputHandler_Info;
      s.state3284 = 0;
      s.lockMovesFlag = false;
      s.inhibitPageFlipInput = false;
      return;
  }
  s.state3284++;
}

function PokeSum_SetHpExpBarCoordsFullRight(): void {
  for (let i = 0; i < 11; i++) {
    EXP().xpos[i] = 8 * i + 396;
    EXP().sprites[i].x = EXP().xpos[i];
    if (i >= 9) continue;
    HP().xpos[i] = 8 * i + 412;
    HP().sprites[i].x = HP().xpos[i];
  }
}

function PokeSum_SetHpExpBarCoordsFullLeft(): void {
  for (let i = 0; i < 11; i++) {
    EXP().xpos[i] = 8 * i + 156;
    EXP().sprites[i].x = EXP().xpos[i];
    if (i >= 9) continue;
    HP().xpos[i] = 8 * i + 172;
    HP().sprites[i].x = HP().xpos[i];
  }
}

function PokeSum_InitBgCoordsBeforePageFlips(): void {
  const s = S();
  let pageDelta = 1;
  if (s.pageFlipDirection === 1) pageDelta = -1;

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
    s.flipPagesBgHofs = 240;
    return;
  }

  if (s.curPageIndex + pageDelta === K.PSS_PAGE_MOVES_INFO) {
    PokeSum_UpdateBgPriorityForPageFlip(0, 0);
    s.flipPagesBgHofs = 0;
    SetGpuReg(REG_OFFSET_BG1HOFS, 0);
    SetGpuReg(REG_OFFSET_BG2HOFS, 0);
    return;
  }

  if (s.pageFlipDirection === 1) {
    s.flipPagesBgHofs = 0;
    SetGpuReg(REG_OFFSET_BG0HOFS, 0);
    SetGpuReg(REG_OFFSET_BG1HOFS, 0);
    SetGpuReg(REG_OFFSET_BG2HOFS, 0);
    PokeSum_UpdateBgPriorityForPageFlip(1, 1);
  } else {
    const bg1Priority = GetGpuReg(REG_OFFSET_BG1CNT) & 3;
    const bg2Priority = GetGpuReg(REG_OFFSET_BG2CNT) & 3;
    s.flipPagesBgHofs = 240;

    if (bg1Priority > bg2Priority) SetGpuReg(REG_OFFSET_BG1HOFS, 240);
    else SetGpuReg(REG_OFFSET_BG2HOFS, 240);

    SetGpuReg(REG_OFFSET_BG0HOFS, 240);
    PokeSum_UpdateBgPriorityForPageFlip(1, 0);
  }

  if (s.curPageIndex === K.PSS_PAGE_SKILLS) {
    if (s.pageFlipDirection === 1) PokeSum_SetHpExpBarCoordsFullLeft();
    else PokeSum_SetHpExpBarCoordsFullRight();
  } else if (s.curPageIndex === K.PSS_PAGE_MOVES) PokeSum_SetHpExpBarCoordsFullLeft();
}

/** The page being left (the C's newPage). */
function pageBeforeFlip(): number {
  const s = S();
  return s.pageFlipDirection === 1 ? s.curPageIndex - 1 : s.curPageIndex + 1;
}

function PokeSum_HideSpritesBeforePageFlip(): void {
  switch (pageBeforeFlip()) {
    case K.PSS_PAGE_INFO:
      break;
    case K.PSS_PAGE_SKILLS:
      ShowOrHideHpBarObjs(true);
      ShowOrHideExpBarObjs(true);
      break;
    case K.PSS_PAGE_MOVES:
      if (S().pageFlipDirection === 1) {
        PokeSum_ShowOrHideMonPicSprite(true);
        PokeSum_ShowOrHideMonMarkingsSprite(true);
        ShowOrHideBallIconObj(true);
        ShowOrHideStatusIcon(true);
        HideShowPokerusIcon(true);
        HideShowShinyStar(true);
      }
      break;
    case K.PSS_PAGE_MOVES_INFO:
      ShoworHideMoveSelectionCursor(true);
      PokeSum_ShowOrHideMonIconSprite(true);
      ShowOrHideStatusIcon(true);
      HideShowPokerusIcon(true);
      HideShowShinyStar(true);
      break;
  }
}

function PokeSum_ShowSpritesBeforePageFlip(): void {
  switch (pageBeforeFlip()) {
    case K.PSS_PAGE_INFO:
      ShowOrHideHpBarObjs(false);
      ShowOrHideExpBarObjs(false);
      break;
    case K.PSS_PAGE_SKILLS:
      break;
    case K.PSS_PAGE_MOVES:
      if (S().pageFlipDirection === 0) {
        ShowOrHideHpBarObjs(false);
        ShowOrHideExpBarObjs(false);
      } else {
        ShoworHideMoveSelectionCursor(false);
        HideShowPokerusIcon(false);
        PokeSum_ShowOrHideMonIconSprite(false);
        HideShowShinyStar(false);
      }
      break;
    case K.PSS_PAGE_MOVES_INFO:
      PokeSum_ShowOrHideMonPicSprite(false);
      PokeSum_ShowOrHideMonMarkingsSprite(false);
      ShowOrHideStatusIcon(false);
      ShowOrHideBallIconObj(false);
      HideShowPokerusIcon(false);
      HideShowShinyStar(false);
      break;
  }
}

function PokeSum_IsPageFlipFinished(_a0: number): boolean {
  const s = S();
  let pageDelta = 1;
  if (s.pageFlipDirection === 1) pageDelta = -1;

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO)
    if (s.flipPagesBgHofs <= 0) {
      s.flipPagesBgHofs = 0;
      s.whichBgLayerToTranslate ^= 1;
      PokeSum_UpdateBgPriorityForPageFlip(0, 0);
      s.flippingPages = false;
      return true;
    }

  if (s.curPageIndex + pageDelta === K.PSS_PAGE_MOVES_INFO)
    if (s.flipPagesBgHofs >= 240) {
      s.flipPagesBgHofs = 240;
      s.whichBgLayerToTranslate ^= 1;
      s.flippingPages = false;
      return true;
    }

  if (s.pageFlipDirection === 1) {
    if (s.flipPagesBgHofs >= 240) {
      s.flipPagesBgHofs = 240;
      s.whichBgLayerToTranslate ^= 1;
      PokeSum_UpdateBgPriorityForPageFlip(0, 0);
      s.flippingPages = false;
      return true;
    }
  } else if (s.flipPagesBgHofs <= 0) {
    s.whichBgLayerToTranslate ^= 1;
    s.flipPagesBgHofs = 0;
    s.flippingPages = false;
    return true;
  }
  return false;
}

function PokeSum_UpdateBgPriorityForPageFlip(setBg0Priority: number, keepBg1Bg2PriorityOrder: number): void {
  const s = S();
  let bg0Priority = GetGpuReg(REG_OFFSET_BG0CNT) & 3;
  let bg1Priority = GetGpuReg(REG_OFFSET_BG1CNT) & 3;
  let bg2Priority = GetGpuReg(REG_OFFSET_BG2CNT) & 3;

  if (s.pageFlipDirection === 1) {
    if (setBg0Priority === 0) {
      bg0Priority = 0;
      if (keepBg1Bg2PriorityOrder === 0) {
        if (bg1Priority > bg2Priority) [bg1Priority, bg2Priority] = [1, 2];
        else [bg1Priority, bg2Priority] = [2, 1];
      } else {
        if (bg1Priority > bg2Priority) [bg1Priority, bg2Priority] = [2, 1];
        else [bg1Priority, bg2Priority] = [1, 2];
      }
    }
    if (setBg0Priority === 1) {
      bg0Priority = 1;
      if (keepBg1Bg2PriorityOrder === 0) {
        if (bg1Priority > bg2Priority) [bg1Priority, bg2Priority] = [0, 2];
        else [bg1Priority, bg2Priority] = [2, 0];
      } else {
        if (bg1Priority > bg2Priority) [bg1Priority, bg2Priority] = [2, 0];
        else [bg1Priority, bg2Priority] = [0, 2];
      }
    }
  }

  if (s.pageFlipDirection === 0) {
    bg0Priority = 0;
    if (bg1Priority > bg2Priority) [bg1Priority, bg2Priority] = [1, 2];
    else [bg1Priority, bg2Priority] = [2, 1];
  }

  for (let i = 0; i < 11; i++) {
    if (s.curPageIndex === K.PSS_PAGE_SKILLS && s.pageFlipDirection === 1) EXP().sprites[i].oam.priority = bg0Priority;
    else EXP().sprites[i].oam.priority = bg1Priority;

    if (i >= 9) continue;

    if (s.curPageIndex === K.PSS_PAGE_SKILLS && s.pageFlipDirection === 1) HP().sprites[i].oam.priority = bg0Priority;
    else HP().sprites[i].oam.priority = bg1Priority;
  }

  SetGpuReg(REG_OFFSET_BG0CNT, (GetGpuReg(REG_OFFSET_BG0CNT) & ~3 & 0xffff) | bg0Priority);
  SetGpuReg(REG_OFFSET_BG1CNT, (GetGpuReg(REG_OFFSET_BG1CNT) & ~3 & 0xffff) | bg1Priority);
  SetGpuReg(REG_OFFSET_BG2CNT, (GetGpuReg(REG_OFFSET_BG2CNT) & ~3 & 0xffff) | bg2Priority);
}

function PokeSum_CopyNewBgTilemapBeforePageFlip_2(): void {
  const s = S();
  switch (pageBeforeFlip()) {
    case K.PSS_PAGE_INFO:
      CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
      break;
    case K.PSS_PAGE_SKILLS:
      if (s.pageFlipDirection === 1) CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageMoves_Tilemap'), 0, 0);
      else CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageInfo_Tilemap'), 0, 0);
      break;
    case K.PSS_PAGE_MOVES:
      if (s.pageFlipDirection === 1) CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageMovesInfo_Tilemap'), 0, 0);
      else CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
      break;
    case K.PSS_PAGE_MOVES_INFO:
      CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageMoves_Tilemap'), 0, 0);
      break;
  }
}

function PokeSum_CopyNewBgTilemapBeforePageFlip(): void {
  const s = S();
  switch (pageBeforeFlip()) {
    case K.PSS_PAGE_INFO:
      CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
      break;
    case K.PSS_PAGE_SKILLS:
      break;
    case K.PSS_PAGE_MOVES:
      if (s.pageFlipDirection === 1) CopyToBgTilemapBuffer(3, gfx16('sBgTilemap_MovesPage'), 0, 0);
      else CopyToBgTilemapBuffer(3, gfx16('sBgTilemap_MovesInfoPage'), 0, 0);
      break;
    case K.PSS_PAGE_MOVES_INFO:
      CopyToBgTilemapBuffer(3, gfx16('sBgTilemap_MovesInfoPage'), 0, 0);
      break;
  }
}

// ------------------------------------------------------------------ setup

function CB2_SetUpPSS(): void {
  const s = S();
  switch (s.summarySetupStep) {
    case 0:
      PokeSum_Setup_ResetCallbacks();
      break;
    case 1:
      PokeSum_Setup_InitGpu();
      break;
    case 2:
      PokeSum_Setup_SpritesReset();
      break;
    case 3:
      if (!PokeSum_HandleLoadBgGfx()) return;
      break;
    case 4:
      if (!PokeSum_HandleCreateSprites()) return;
      break;
    case 5:
      PokeSum_CreateWindows();
      break;
    case 6:
      if (!PokeSum_Setup_BufferStrings()) return;
      break;
    case 7:
      PokeSum_PrintRightPaneText();
      break;
    case 8:
      PokeSum_PrintBottomPaneText();
      break;
    case 9:
      PokeSum_PrintAbilityDataOrMoveTypes();
      PokeSum_PrintMonTypeIcons();
      break;
    case 10:
      if (s.mode === K.PSS_MODE_SELECT_MOVE || s.mode === K.PSS_MODE_FORGET_MOVE) CopyToBgTilemapBuffer(3, gfx16('sBgTilemap_MovesPage'), 0, 0);
      else CopyToBgTilemapBuffer(3, gfx16('sBgTilemap_MovesInfoPage'), 0, 0);
      PokeSum_DrawPageProgressTiles();
      break;
    case 11:
      if (s.isEgg) CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageEgg_Tilemap'), 0, 0);
      else {
        if (s.mode === K.PSS_MODE_SELECT_MOVE || s.mode === K.PSS_MODE_FORGET_MOVE) {
          CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageMoves_Tilemap'), 0, 0);
          CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageMovesInfo_Tilemap'), 0, 0);
        } else {
          CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageInfo_Tilemap'), 0, 0);
          CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
        }
      }
      break;
    case 12:
      BlendPalettes(PALETTES_ALL, 16, 0);
      PokeSum_PrintPageHeaderText(s.curPageIndex);
      CommitStaticWindowTilemaps();
      break;
    case 13:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_PAGE_NAME], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_CONTROLS], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_LVL_NICK], 2);
      CopyWindowToVram(s.windowIds[6], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      break;
    case 14:
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(3);
      break;
    case 15:
      if (s.mode === K.PSS_MODE_SELECT_MOVE || s.mode === K.PSS_MODE_FORGET_MOVE) {
        PokeSum_ShowOrHideMonIconSprite(false);
        ShoworHideMoveSelectionCursor(false);
      } else {
        PokeSum_ShowOrHideMonPicSprite(false);
        PokeSum_ShowOrHideMonMarkingsSprite(false);
        ShowOrHideBallIconObj(false);
        ShowOrHideHpBarObjs(false);
        ShowOrHideExpBarObjs(false);
      }
      ShowOrHideStatusIcon(false);
      HideShowPokerusIcon(false);
      HideShowShinyStar(false);
      break;
    default:
      PokeSum_Setup_SetVBlankCallback();
      PokeSum_FinishSetup();
      return;
  }
  s.summarySetupStep++;
}

function PokeSum_HandleLoadBgGfx(): boolean {
  const s = S();
  const bgPal = gfx16('gSummaryScreen_Bg_Pal');
  switch (s.loadBgGfxStep) {
    case 0:
      LoadPalette(bgPal, BG_PLTT_ID(0), 5 * PLTT_SIZE_4BPP);
      if (IsMonShiny(s.currentMon) && !s.isEgg) {
        LoadPalette(bgPal.subarray(16 * 6), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
        LoadPalette(bgPal.subarray(16 * 5), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      } else {
        LoadPalette(bgPal.subarray(16 * 0), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
        LoadPalette(bgPal.subarray(16 * 1), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      }
      break;
    case 1:
      ListMenuLoadStdPalAt(BG_PLTT_ID(6), 1);
      LoadPalette(gfx16('sTextHeaderPalette'), BG_PLTT_ID(7), PLTT_SIZE_4BPP);
      break;
    case 2:
      ResetTempTileDataBuffers();
      break;
    case 3:
      DecompressAndCopyTileDataToVram(2, gfx('gSummaryScreen_Bg_Gfx'), 0, 0, 0);
      break;
    case 4:
      if (FreeTempTileDataBuffersIfPossible()) return false;
      break;
    case 5:
    case 6:
      break;
    default:
      LoadPalette(gfx16('sTextMovesPalette'), BG_PLTT_ID(8), PLTT_SIZE_4BPP);
      return true;
  }
  s.loadBgGfxStep++;
  return false;
}

function PokeSum_Setup_BufferStrings(): boolean {
  const s = S();
  switch (s.bufferStringsStep) {
    case 0:
      BufferMonInfo();
      if (s.isEgg) {
        s.bufferStringsStep = 0;
        return true;
      }
      break;
    case 1:
      if (!s.isEgg) BufferMonSkills();
      break;
    case 2:
      if (!s.isEgg) BufferMonMoves();
      break;
    default:
      s.bufferStringsStep = 0;
      return true;
  }
  s.bufferStringsStep++;
  return false;
}

function BufferMonInfo(): void {
  const s = S();
  const mon = s.currentMon;

  let dexNum = SpeciesToPokedexNum(state, mon.species);
  if (dexNum === 0xffff) s.summary.dexNumStrBuf = text('gText_PokeSum_DexNoUnknown');
  else s.summary.dexNumStrBuf = ConvertIntToDecimalStringN(dexNum, STR_CONV_MODE_LEADING_ZEROS, 3);

  X().unk00 = 0;

  if (!s.isEgg) {
    dexNum = mon.species;
    s.summary.speciesNameStrBuf = speciesName(dexNum);
  } else {
    s.summary.speciesNameStrBuf = GetMonNickname(mon);
    return;
  }

  s.monTypes[0] = pokemon.species[dexNum].types[0];
  s.monTypes[1] = pokemon.species[dexNum].types[1];

  s.summary.nicknameStrBuf = GetMonNickname(mon); // StringCopyN_Multibyte + StringGet_Nickname

  const gender = pokemon.gender(mon);
  dexNum = speciesOrEgg(mon);

  if (gender === K.MON_FEMALE) s.summary.genderSymbolStrBuf = text('gText_FemaleSymbol');
  else if (gender === K.MON_MALE) s.summary.genderSymbolStrBuf = text('gText_MaleSymbol');
  else s.summary.genderSymbolStrBuf = text('gString_Dummy');

  if (dexNum === K.SPECIES_NIDORAN_M || dexNum === K.SPECIES_NIDORAN_F)
    if (stringsEqual(s.summary.nicknameStrBuf, speciesName(dexNum))) s.summary.genderSymbolStrBuf = text('gString_Dummy');

  s.summary.otNameStrBuf = [...pokemon.encodeName(mon.otName).slice(0, K.PLAYER_NAME_LENGTH), EOS];
  // ConvertInternationalString: only Japanese names change

  const otId = mon.otId & 0xffff;
  s.summary.unk306C = ConvertIntToDecimalStringN(otId, STR_CONV_MODE_LEADING_ZEROS, 5);

  const tempStr = ConvertIntToDecimalStringN(mon.level, STR_CONV_MODE_LEFT_ALIGN, 3);
  s.summary.levelStrBuf = concat(text('gText_Lv'), strBody(tempStr).slice(0, 4));

  const heldItem = mon.heldItem;
  if (heldItem === K.ITEM_NONE) s.summary.itemNameStrBuf = text('gText_PokeSum_Item_None');
  else s.summary.itemNameStrBuf = CopyItemName(heldItem);
}

const GetNumberRightAlign63 = (x: number[]) => 63 - StringLength(x) * 6;
const GetNumberRightAlign27 = (x: number[]) => 27 - StringLength(x) * 6;

function BufferMonSkills(): void {
  const s = S();
  const mon = s.currentMon;
  const sum = s.summary;

  sum.curHpStrBuf = concat(ConvertIntToDecimalStringN(mon.hp, STR_CONV_MODE_LEFT_ALIGN, 3), text('gText_Slash'), ConvertIntToDecimalStringN(mon.maxHP, STR_CONV_MODE_LEFT_ALIGN, 3));
  X().curHpStr = GetNumberRightAlign63(sum.curHpStrBuf);

  // The trade screen's view of the partner's mons (MON_DATA_ATK2...) isn't ported.
  const stat = (value: number) => ConvertIntToDecimalStringN(value, STR_CONV_MODE_LEFT_ALIGN, 3);
  sum.statValueStrBufs[K.PSS_STAT_ATK] = stat(mon.stats.attack);
  X().atkStr = GetNumberRightAlign27(sum.statValueStrBufs[K.PSS_STAT_ATK]);
  sum.statValueStrBufs[K.PSS_STAT_DEF] = stat(mon.stats.defense);
  X().defStr = GetNumberRightAlign27(sum.statValueStrBufs[K.PSS_STAT_DEF]);
  sum.statValueStrBufs[K.PSS_STAT_SPA] = stat(mon.stats.spAttack);
  X().spAStr = GetNumberRightAlign27(sum.statValueStrBufs[K.PSS_STAT_SPA]);
  sum.statValueStrBufs[K.PSS_STAT_SPD] = stat(mon.stats.spDefense);
  X().spDStr = GetNumberRightAlign27(sum.statValueStrBufs[K.PSS_STAT_SPD]);
  sum.statValueStrBufs[K.PSS_STAT_SPE] = stat(mon.stats.speed);
  X().speStr = GetNumberRightAlign27(sum.statValueStrBufs[K.PSS_STAT_SPE]);

  const exp = mon.exp;
  sum.expPointsStrBuf = ConvertIntToDecimalStringN(exp, STR_CONV_MODE_LEFT_ALIGN, 7);
  X().expStr = GetNumberRightAlign63(sum.expPointsStrBuf);

  const level = mon.level;
  let expToNextLevel = 0;
  if (level < 100) {
    const species = mon.species;
    expToNextLevel = (pokemon.tables.experience[pokemon.species[species].growthRate][level + 1] - exp) >>> 0;
  }
  sum.expToNextLevelStrBuf = ConvertIntToDecimalStringN(expToNextLevel, STR_CONV_MODE_LEFT_ALIGN, 7);
  X().toNextLevel = GetNumberRightAlign63(sum.expToNextLevelStrBuf);

  const ability = getAbilityBySpecies(mon.species, mon.abilityNum);
  sum.abilityNameStrBuf = encodeRaw(bdata.strings.abilityNames[ability] ?? '$');
  sum.abilityDescStrBuf = encodeRaw(menusData.abilityDescriptions[ability] ?? '$');

  s.curMonStatusAilment = StatusToAilment(mon.status);
  if (s.curMonStatusAilment === K.AILMENT_NONE) if (CheckPartyPokerus(mon)) s.curMonStatusAilment = K.AILMENT_PKRS;
}

function BufferMonMoves(): void {
  for (let i = 0; i < 4; i++) BufferMonMoveI(i);
  if (S().mode === K.PSS_MODE_SELECT_MOVE) BufferMonMoveI(4);
}

const GetRightAlignXpos_NDigits = (a: number, b: number[]) => 6 * a - StringLength(b) * 6;

function BufferMonMoveI(i: number): void {
  const s = S();
  const sum = s.summary;
  if (i < 4) s.moveIds[i] = GetMonMoveBySlotId(s.currentMon, i);

  if (s.moveIds[i] === 0) {
    sum.moveNameStrBufs[i] = text('gText_PokeSum_OneHyphen');
    sum.moveCurPpStrBufs[i] = text('gText_PokeSum_TwoHyphens');
    sum.movePowerStrBufs[i] = text('gText_ThreeHyphens');
    sum.moveAccuracyStrBufs[i] = text('gText_ThreeHyphens');
    X().curPp[i] = 0xff;
    X().maxPp[i] = 0xff;
    return;
  }

  const move = pokemon.moves[s.moveIds[i]];
  s.numMoves++;
  s.moveTypes[i] = move.type;
  sum.moveNameStrBufs[i] = moveName(s.moveIds[i]);

  if (i >= 4 && s.mode === K.PSS_MODE_SELECT_MOVE) {
    sum.moveCurPpStrBufs[i] = ConvertIntToDecimalStringN(move.pp, STR_CONV_MODE_LEFT_ALIGN, 3);
    sum.moveMaxPpStrBufs[i] = ConvertIntToDecimalStringN(move.pp, STR_CONV_MODE_LEFT_ALIGN, 3);
  } else {
    sum.moveCurPpStrBufs[i] = ConvertIntToDecimalStringN(GetMonPpByMoveSlot(s.currentMon, i), STR_CONV_MODE_LEFT_ALIGN, 3);
    sum.moveMaxPpStrBufs[i] = ConvertIntToDecimalStringN(pokemon.ppWithBonus(s.moveIds[i], s.currentMon.ppBonuses, i), STR_CONV_MODE_LEFT_ALIGN, 3);
  }

  X().curPp[i] = GetRightAlignXpos_NDigits(2, sum.moveCurPpStrBufs[i]);
  X().maxPp[i] = GetRightAlignXpos_NDigits(2, sum.moveMaxPpStrBufs[i]);

  if (move.power <= 1) sum.movePowerStrBufs[i] = text('gText_ThreeHyphens');
  else sum.movePowerStrBufs[i] = ConvertIntToDecimalStringN(move.power, STR_CONV_MODE_RIGHT_ALIGN, 3);

  if (move.accuracy === 0) sum.moveAccuracyStrBufs[i] = text('gText_ThreeHyphens');
  else sum.moveAccuracyStrBufs[i] = ConvertIntToDecimalStringN(move.accuracy, STR_CONV_MODE_RIGHT_ALIGN, 3);
}

function PokeSum_HandleCreateSprites(): boolean {
  const s = S();
  switch (s.spriteCreationStep) {
    case 0:
      CreateShinyStarObj(K.TAG_PSS_UNK_A0, K.TAG_PSS_UNK_A0);
      break;
    case 1:
      CreatePokerusIconObj(K.TAG_PSS_UNK_96, K.TAG_PSS_UNK_96);
      break;
    case 2:
      PokeSum_CreateMonMarkingsSprite();
      break;
    case 3:
      CreateMoveSelectionCursorObjs(K.TAG_PSS_UNK_64, K.TAG_PSS_UNK_64);
      break;
    case 4:
      CreateMonStatusIconObj(K.TAG_PSS_UNK_6E, K.TAG_PSS_UNK_6E);
      break;
    case 5:
      CreateHpBarObjs(K.TAG_PSS_UNK_78, K.TAG_PSS_UNK_78);
      break;
    case 6:
      CreateExpBarObjs(K.TAG_PSS_UNK_82, K.TAG_PSS_UNK_82);
      break;
    case 7:
      CreateBallIconObj();
      break;
    case 8:
      PokeSum_CreateMonIconSprite();
      break;
    default:
      PokeSum_CreateMonPicSprite();
      return true;
  }
  s.spriteCreationStep++;
  return false;
}

function PokeSum_Setup_SpritesReset(): void {
  ResetSpriteData();
  ResetPaletteFade();
  FreeAllSpritePalettes();
  ScanlineEffect_Stop();
}

function PokeSum_Setup_InitGpu(): void {
  const s = S();
  vram.fill(0); // DmaClearLarge16(VRAM)
  // DmaClear32(OAM): the PPU reads the OAM buffer, which ResetSpriteData clears
  pltt.fill(0); // DmaClear16(PLTT)

  SetGpuReg(REG_OFFSET_DISPCNT, 0);

  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTempaltes, sBgTempaltes.length);

  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }

  DeactivateAllTextPrinters();

  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN1_ON);

  PokeSum_UpdateWin1ActiveFlag(s.curPageIndex);

  SetGpuReg(REG_OFFSET_WININ, (WININ_WIN0_OBJ | WININ_WIN0_BG0 | WININ_WIN0_BG1 | WININ_WIN0_BG2 | WININ_WIN0_BG3) << 8);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3);
  SetGpuReg(REG_OFFSET_WIN1V, (32 << 8) | 135);
  SetGpuReg(REG_OFFSET_WIN1H, (2 << 8) | 240);

  SetBgTilemapBuffer(1, s.bg1TilemapBuffer);
  SetBgTilemapBuffer(2, s.bg2TilemapBuffer);
  SetBgTilemapBuffer(3, s.bg3TilemapBuffer);

  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
}

function PokeSum_FinishSetup(): void {
  const s = S();
  if (s.mode === K.PSS_MODE_SELECT_MOVE || s.mode === K.PSS_MODE_FORGET_MOVE) s.inputHandlerTaskId = CreateTask(Task_InputHandler_SelectOrForgetMove, 0);
  else s.inputHandlerTaskId = CreateTask(Task_InputHandler_Info, 0);
  SetMainCallback2(CB2_RunPokemonSummaryScreen);
}

// ------------------------------------------------------------------ printing

function PokeSum_PrintPageName(str: number[]): void {
  const id = S().windowIds[POKESUM_WIN_PAGE_NAME];
  FillWindowPixelBuffer(id, 0);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 4, 1, sLevelNickTextColors[1], 0, str);
  PutWindowTilemap(id);
}

function PokeSum_PrintControlsString(str: number[]): void {
  const id = S().windowIds[POKESUM_WIN_CONTROLS];
  FillWindowPixelBuffer(id, 0);
  const width = GetStringWidth(K.FONT_SMALL, str, 0);
  AddTextPrinterParameterized3(id, K.FONT_SMALL, 0x54 - width, 0, sLevelNickTextColors[1], 0, str);
  PutWindowTilemap(id);
}

function PrintMonLevelNickOnWindow2(_str: number[]): void {
  const s = S();
  const id = s.windowIds[POKESUM_WIN_LVL_NICK];
  FillWindowPixelBuffer(id, 0);

  if (!s.isEgg) {
    if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) AddTextPrinterParameterized3(id, 2, 4, 2, sLevelNickTextColors[1], TEXT_SKIP_DRAW, s.summary.levelStrBuf);

    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 40, 2, sLevelNickTextColors[1], TEXT_SKIP_DRAW, s.summary.nicknameStrBuf);

    if (pokemon.gender(s.currentMon) === K.MON_FEMALE) AddTextPrinterParameterized3(id, K.FONT_NORMAL, 105, 2, sLevelNickTextColors[3], 0, s.summary.genderSymbolStrBuf);
    else AddTextPrinterParameterized3(id, K.FONT_NORMAL, 105, 2, sLevelNickTextColors[2], 0, s.summary.genderSymbolStrBuf);
  }

  PutWindowTilemap(id);
}

function PokeSum_PrintRightPaneText(): void {
  const s = S();
  FillWindowPixelBuffer(s.windowIds[POKESUM_WIN_RIGHT_PANE], 0);

  switch (s.curPageIndex) {
    case K.PSS_PAGE_INFO:
      PrintInfoPage();
      break;
    case K.PSS_PAGE_SKILLS:
      PrintSkillsPage();
      break;
    case K.PSS_PAGE_MOVES:
    case K.PSS_PAGE_MOVES_INFO:
      PrintMovesPage();
      break;
  }

  PutWindowTilemap(s.windowIds[POKESUM_WIN_RIGHT_PANE]);
}

function PrintInfoPage(): void {
  const s = S();
  const id = s.windowIds[POKESUM_WIN_RIGHT_PANE];
  const c = sLevelNickTextColors[0];
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 47, 19, c, TEXT_SKIP_DRAW, s.summary.speciesNameStrBuf);

  if (!s.isEgg) {
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 47 + X().unk00, 5, c, TEXT_SKIP_DRAW, s.summary.dexNumStrBuf);
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 47, 49, c, TEXT_SKIP_DRAW, s.summary.otNameStrBuf);
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 47, 64, c, TEXT_SKIP_DRAW, s.summary.unk306C);
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 47, 79, c, TEXT_SKIP_DRAW, s.summary.itemNameStrBuf);
  } else {
    const eggCycles = s.currentMon.friendship & 0xff;
    let hatchMsgIndex: number;
    if (eggCycles <= 5) hatchMsgIndex = 3;
    else if (eggCycles <= 10) hatchMsgIndex = 2;
    else if (eggCycles <= 40) hatchMsgIndex = 1;
    else hatchMsgIndex = 0;

    if (s.isBadEgg) hatchMsgIndex = 0;

    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 7, 45, c, TEXT_SKIP_DRAW, sEggHatchTimeTexts()[hatchMsgIndex]);
  }
}

function PrintSkillsPage(): void {
  const s = S();
  const id = s.windowIds[POKESUM_WIN_RIGHT_PANE];
  const c = sLevelNickTextColors[0];
  const sum = s.summary;
  const x = X();
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 14 + x.curHpStr, 4, c, TEXT_SKIP_DRAW, sum.curHpStrBuf);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 50 + x.atkStr, 22, c, TEXT_SKIP_DRAW, sum.statValueStrBufs[K.PSS_STAT_ATK]);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 50 + x.defStr, 35, c, TEXT_SKIP_DRAW, sum.statValueStrBufs[K.PSS_STAT_DEF]);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 50 + x.spAStr, 48, c, TEXT_SKIP_DRAW, sum.statValueStrBufs[K.PSS_STAT_SPA]);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 50 + x.spDStr, 61, c, TEXT_SKIP_DRAW, sum.statValueStrBufs[K.PSS_STAT_SPD]);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 50 + x.speStr, 74, c, TEXT_SKIP_DRAW, sum.statValueStrBufs[K.PSS_STAT_SPE]);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 15 + x.expStr, 87, c, TEXT_SKIP_DRAW, sum.expPointsStrBuf);
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 15 + x.toNextLevel, 100, c, TEXT_SKIP_DRAW, sum.expToNextLevelStrBuf);
}

const GetMoveNamePrinterYpos = (x: number) => x * 28 + 5;
const GetMovePpPrinterYpos = (x: number) => x * 28 + 16;

function PrintMovesPage(): void {
  const s = S();
  for (let i = 0; i < 4; i++) PokeSum_PrintMoveName(i);

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
    if (s.mode === K.PSS_MODE_SELECT_MOVE) PokeSum_PrintMoveName(4);
    else AddTextPrinterParameterized3(s.windowIds[POKESUM_WIN_RIGHT_PANE], K.FONT_NORMAL, 3, GetMoveNamePrinterYpos(4), sPrintMoveTextColors[0], TEXT_SKIP_DRAW, text('gFameCheckerText_Cancel'));
  }
}

function PokeSum_PrintMoveName(i: number): void {
  const s = S();
  const id = s.windowIds[POKESUM_WIN_RIGHT_PANE];
  let colorIdx = 0;
  let curPP = GetMonPpByMoveSlot(s.currentMon, i) & 0xff;
  const move = s.moveIds[i];
  const ppBonuses = s.currentMon.ppBonuses;
  const maxPP = pokemon.ppWithBonus(move, ppBonuses, i) & 0xff;

  if (i === 4) curPP = maxPP;

  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 3, GetMoveNamePrinterYpos(i), sPrintMoveTextColors[0], TEXT_SKIP_DRAW, s.summary.moveNameStrBufs[i]);

  if (s.moveIds[i] === 0 || curPP === maxPP) colorIdx = 0;
  else if (curPP === 0) colorIdx = 3;
  else if (maxPP === 3) {
    if (curPP === 2) colorIdx = 2;
    else if (curPP === 1) colorIdx = 1;
  } else if (maxPP === 2) {
    if (curPP === 1) colorIdx = 1;
  } else {
    if (curPP <= Math.trunc(maxPP / 4)) colorIdx = 2;
    else if (curPP <= Math.trunc(maxPP / 2)) colorIdx = 1;
  }

  const color = sPrintMoveTextColors[colorIdx];
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 36, GetMovePpPrinterYpos(i), color, TEXT_SKIP_DRAW, text('gText_PokeSum_PP'));
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 46 + X().curPp[i], GetMovePpPrinterYpos(i), color, TEXT_SKIP_DRAW, s.summary.moveCurPpStrBufs[i]);

  if (s.moveIds[i] !== K.MOVE_NONE) {
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 58, GetMovePpPrinterYpos(i), color, TEXT_SKIP_DRAW, text('gText_Slash'));
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 64 + X().maxPp[i], GetMovePpPrinterYpos(i), color, TEXT_SKIP_DRAW, s.summary.moveMaxPpStrBufs[i]);
  }
}

function PokeSum_PrintBottomPaneText(): void {
  const s = S();
  FillWindowPixelBuffer(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 0);

  switch (s.curPageIndex) {
    case K.PSS_PAGE_INFO:
      PokeSum_PrintTrainerMemo();
      break;
    case K.PSS_PAGE_SKILLS:
      PokeSum_PrintExpPoints_NextLv();
      break;
    case K.PSS_PAGE_MOVES_INFO:
      PokeSum_PrintSelectedMoveStats();
      break;
    case K.PSS_PAGE_MOVES:
      break;
  }

  PutWindowTilemap(s.windowIds[POKESUM_WIN_TRAINER_MEMO]);
}

function PokeSum_PrintTrainerMemo(): void {
  if (!S().isEgg) PokeSum_PrintTrainerMemo_Mon();
  else PokeSum_PrintTrainerMemo_Egg();
}

/** The nature/level placeholders both memo variants start with. */
function setNatureAndLevelPlaceholders(): number {
  const mon = S().currentMon;
  DynamicPlaceholderTextUtil_Reset();
  const nature = pokemon.nature(mon);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, encodeRaw(menusData.natureNames[nature]));
  let level = mon.metLevel & 0xff;
  if (level === 0) level = 5;
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, ConvertIntToDecimalStringN(level, STR_CONV_MODE_LEFT_ALIGN, 3));
  return nature;
}

/** The pairs are bytewise identical in English; Japanese uses different grammar for Bold and Gentle. */
const memoText = (nature: number, sym: string) => text(PokeSum_IsMonBoldOrGentle(nature) ? `${sym}_BoldGentleGrammar` : sym);

function printMemo(str: number[]): void {
  AddTextPrinterParameterized4(S().windowIds[POKESUM_WIN_TRAINER_MEMO], K.FONT_NORMAL, 0, 3, 0, 0, sLevelNickTextColors[0], TEXT_SKIP_DRAW, str);
}

function PokeSum_PrintTrainerMemo_Mon_HeldByOT(): void {
  const s = S();
  const mon = s.currentMon;
  const nature = setNatureAndLevelPlaceholders();

  const metLocation = monMetLocation(mon);
  let mapNameStr: number[];
  if (MapSecIsInKantoOrSevii(metLocation)) mapNameStr = GetMapNameGeneric_(metLocation);
  else {
    if (s.isEnemyParty || IsMultiBattlePartner()) mapNameStr = text('gText_Somewhere');
    else mapNameStr = text('gText_PokeSum_ATrade');
  }
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, mapNameStr);

  let sym: string;
  if ((mon.metLevel & 0xff) === 0) {
    // Hatched
    sym = monFatefulEncounter(mon) ? 'gText_PokeSum_FatefulEncounterHatched' : 'gText_PokeSum_Hatched';
  } else {
    sym = metLocation === K.METLOC_FATEFUL_ENCOUNTER ? 'gText_PokeSum_FatefulEncounterMet' : 'gText_PokeSum_Met';
  }
  printMemo(DynamicPlaceholderTextUtil_ExpandPlaceholders(memoText(nature, sym)));
}

function PokeSum_PrintTrainerMemo_Mon_NotHeldByOT(): void {
  const mon = S().currentMon;
  const nature = setNatureAndLevelPlaceholders();

  const metLocation = monMetLocation(mon);

  if (!MapSecIsInKantoOrSevii(metLocation) || !CurrentMonIsFromGBA()) {
    if (IsMultiBattlePartner()) {
      PokeSum_PrintTrainerMemo_Mon_HeldByOT();
      return;
    }
    const sym = metLocation === K.METLOC_FATEFUL_ENCOUNTER ? 'gText_PokeSum_FatefulEncounterMet' : 'gText_PokeSum_MetInATrade';
    printMemo(DynamicPlaceholderTextUtil_ExpandPlaceholders(memoText(nature, sym)));
    return;
  }

  let mapNameStr: number[];
  if (MapSecIsInKantoOrSevii(metLocation)) mapNameStr = GetMapNameGeneric_(metLocation);
  else mapNameStr = text('gText_PokeSum_ATrade');
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, mapNameStr);

  let sym: string;
  if ((mon.metLevel & 0xff) === 0) {
    // hatched from an EGG
    sym = monFatefulEncounter(mon) ? 'gText_PokeSum_ApparentlyFatefulEncounterHatched' : 'gText_PokeSum_ApparentlyMet';
  } else {
    sym = metLocation === K.METLOC_FATEFUL_ENCOUNTER ? 'gText_PokeSum_FatefulEncounterMet' : 'gText_PokeSum_ApparentlyMet';
  }
  printMemo(DynamicPlaceholderTextUtil_ExpandPlaceholders(memoText(nature, sym)));
}

function PokeSum_PrintTrainerMemo_Mon(): void {
  if (PokeSum_BufferOtName_IsEqualToCurrentOwner(S().currentMon)) PokeSum_PrintTrainerMemo_Mon_HeldByOT();
  else PokeSum_PrintTrainerMemo_Mon_NotHeldByOT();
}

function PokeSum_PrintTrainerMemo_Egg(): void {
  const s = S();
  const mon = s.currentMon;
  let chosenStrIndex = 0;
  const metLocation = monMetLocation(mon);

  if (!s.isEnemyParty) {
    if (metLocation === K.METLOC_FATEFUL_ENCOUNTER || monFatefulEncounter(mon)) chosenStrIndex = 4;
    else {
      const version = monMetGame(mon);
      if (version !== K.VERSION_LEAF_GREEN && version !== K.VERSION_FIRE_RED) chosenStrIndex = 1;
      else if (metLocation === K.METLOC_SPECIAL_EGG) chosenStrIndex = 2;

      if (chosenStrIndex === 0 || chosenStrIndex === 2) if (!PokeSum_BufferOtName_IsEqualToCurrentOwner(mon)) chosenStrIndex++;
    }
  } else {
    if (metLocation === K.METLOC_FATEFUL_ENCOUNTER || monFatefulEncounter(mon)) chosenStrIndex = 4;
    else {
      const version = monMetGame(mon);
      if (version !== K.VERSION_LEAF_GREEN && version !== K.VERSION_FIRE_RED) {
        if (metLocation === K.METLOC_SPECIAL_EGG) chosenStrIndex = 5;
      } else if (metLocation === K.METLOC_SPECIAL_EGG) chosenStrIndex = 2;

      if (!PokeSum_BufferOtName_IsEqualToCurrentOwner(mon)) chosenStrIndex++;
    }
  }

  if (s.isBadEgg) chosenStrIndex = 0;

  printMemo(sEggOriginTexts()[chosenStrIndex]);
}

function PokeSum_PrintExpPoints_NextLv(): void {
  const id = S().windowIds[POKESUM_WIN_TRAINER_MEMO];
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 26, 7, sLevelNickTextColors[0], TEXT_SKIP_DRAW, text('gText_PokeSum_ExpPoints'));
  AddTextPrinterParameterized3(id, K.FONT_NORMAL, 26, 20, sLevelNickTextColors[0], TEXT_SKIP_DRAW, text('gText_PokeSum_NextLv'));
}

function PokeSum_PrintSelectedMoveStats(): void {
  const s = S();
  const id = s.windowIds[POKESUM_WIN_TRAINER_MEMO];
  if (sMoveSelectionCursorPos < 5) {
    if (s.mode !== K.PSS_MODE_SELECT_MOVE && sMoveSelectionCursorPos === 4) return;

    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 57, 1, sLevelNickTextColors[0], TEXT_SKIP_DRAW, s.summary.movePowerStrBufs[sMoveSelectionCursorPos]);
    AddTextPrinterParameterized3(id, K.FONT_NORMAL, 57, 15, sLevelNickTextColors[0], TEXT_SKIP_DRAW, s.summary.moveAccuracyStrBufs[sMoveSelectionCursorPos]);
    AddTextPrinterParameterized4(id, K.FONT_NORMAL, 7, 42, 0, 0, sLevelNickTextColors[0], TEXT_SKIP_DRAW, encodeRaw(menusData.moveDescriptions[s.moveIds[sMoveSelectionCursorPos] - 1] ?? '$'));
  }
}

function PokeSum_PrintAbilityDataOrMoveTypes(): void {
  const s = S();
  switch (s.curPageIndex) {
    case K.PSS_PAGE_INFO:
      break;
    case K.PSS_PAGE_SKILLS:
      PokeSum_PrintAbilityNameAndDesc();
      break;
    case K.PSS_PAGE_MOVES:
    case K.PSS_PAGE_MOVES_INFO:
      PokeSum_DrawMoveTypeIcons();
      break;
  }
  PutWindowTilemap(s.windowIds[5]);
}

function PokeSum_PrintAbilityNameAndDesc(): void {
  const s = S();
  FillWindowPixelBuffer(s.windowIds[5], 0);
  AddTextPrinterParameterized3(s.windowIds[5], K.FONT_NORMAL, 66, 1, sLevelNickTextColors[0], TEXT_SKIP_DRAW, s.summary.abilityNameStrBuf);
  AddTextPrinterParameterized3(s.windowIds[5], K.FONT_NORMAL, 2, 15, sLevelNickTextColors[0], TEXT_SKIP_DRAW, s.summary.abilityDescStrBuf);
}

function PokeSum_DrawMoveTypeIcons(): void {
  const s = S();
  FillWindowPixelBuffer(s.windowIds[5], 0);
  for (let i = 0; i < 4; i++) {
    if (s.moveIds[i] === K.MOVE_NONE) continue;
    BlitMenuInfoIcon(s.windowIds[5], s.moveTypes[i] + 1, 3, GetMoveNamePrinterYpos(i));
  }
  if (s.mode === K.PSS_MODE_SELECT_MOVE) BlitMenuInfoIcon(s.windowIds[5], s.moveTypes[4] + 1, 3, GetMoveNamePrinterYpos(4));
}

function PokeSum_PrintPageHeaderText(curPageIndex: number): void {
  const s = S();
  switch (curPageIndex) {
    case K.PSS_PAGE_INFO:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_PokemonInfo'));
      if (!s.isEgg) PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PageCancel'));
      else PokeSum_PrintControlsString(text('gText_PokeSum_Controls_Cancel'));
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case K.PSS_PAGE_SKILLS:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_PokemonSkills'));
      PokeSum_PrintControlsString(text('gText_PokeSum_Controls_Page'));
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case K.PSS_PAGE_MOVES:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_KnownMoves'));
      PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PageDetail'));
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case K.PSS_PAGE_MOVES_INFO:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_KnownMoves'));
      if (!gMain.inBattle) PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PickSwitch'));
      else PokeSum_PrintControlsString(text('gText_PokeSum_Controls_Pick'));
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    case K.PSS_PAGE_MOVE_DELETER:
      PokeSum_PrintPageName(text('gText_PokeSum_PageName_KnownMoves'));
      PokeSum_PrintControlsString(text('gText_PokeSum_Controls_PickDelete'));
      PrintMonLevelNickOnWindow2(text('gText_PokeSum_NoData'));
      break;
    default:
      break;
  }
}

function CommitStaticWindowTilemaps(): void {
  const s = S();
  PutWindowTilemap(s.windowIds[POKESUM_WIN_PAGE_NAME]);
  PutWindowTilemap(s.windowIds[POKESUM_WIN_CONTROLS]);
  PutWindowTilemap(s.windowIds[POKESUM_WIN_LVL_NICK]);
}

function Task_DestroyResourcesOnExit(taskId: number): void {
  const s = S();
  PokeSum_DestroySprites();
  FreeAllSpritePalettes();

  if (IsCryPlayingOrClearCrySongs()) StopCryAndClearCrySongs();

  PokeSum_RemoveWindows(s.curPageIndex);
  FreeAllWindowBuffers();
  DestroyTask(taskId);
  SetMainCallback2(s.savedCallback);

  sLastViewedMonIndex = GetLastViewedMonIndex();

  sMonSummaryScreenPtr = null;
  sMonSkillsPrinterXposPtr = null;
}

function CB2_RunPokemonSummaryScreen(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

// ------------------------------------------------------------------ page flip animation (VBlank)

function PokeSum_FlipPages_SlideHpExpBarsOut(): void {
  for (let i = 0; i < 11; i++) {
    if (EXP().xpos[i] < 240) {
      EXP().xpos[i] += 60;
      EXP().sprites[i].x = EXP().xpos[i] + 60;
    }
    if (i >= 9) continue;
    if (HP().xpos[i] < 240) {
      HP().xpos[i] += 60;
      HP().sprites[i].x = HP().xpos[i] + 60;
    }
  }
}

function PokeSum_FlipPages_SlideHpExpBarsIn(): void {
  for (let i = 0; i < 11; i++) {
    if (EXP().xpos[i] > 156 + 8 * i) {
      EXP().xpos[i] -= 60;
      if (EXP().xpos[i] < 156 + 8 * i) EXP().xpos[i] = 156 + 8 * i;
      EXP().sprites[i].x = EXP().xpos[i];
    }
    if (i >= 9) continue;
    if (HP().xpos[i] > 172 + 8 * i) {
      HP().xpos[i] -= 60;
      if (HP().xpos[i] < 172 + 8 * i) HP().xpos[i] = 172 + 8 * i;
      HP().sprites[i].x = HP().xpos[i];
    }
  }
}

function PokeSum_FlipPages_SlideLayerLeft(): void {
  const s = S();
  if (s.flipPagesBgHofs < 240) {
    s.flipPagesBgHofs += 60;
    if (s.flipPagesBgHofs > 240) s.flipPagesBgHofs = 240;

    if (s.whichBgLayerToTranslate === 0) SetGpuReg(REG_OFFSET_BG2HOFS, -s.flipPagesBgHofs & 0xffff);
    else SetGpuReg(REG_OFFSET_BG1HOFS, -s.flipPagesBgHofs & 0xffff);
  }
}

function PokeSum_FlipPages_SlideLayeRight(): void {
  const s = S();
  if (s.flipPagesBgHofs >= 60) {
    s.flipPagesBgHofs -= 60;
    if (s.flipPagesBgHofs < 0) s.flipPagesBgHofs = 0;

    if (s.whichBgLayerToTranslate === 0) SetGpuReg(REG_OFFSET_BG1HOFS, -s.flipPagesBgHofs & 0xffff);
    else SetGpuReg(REG_OFFSET_BG2HOFS, -s.flipPagesBgHofs & 0xffff);

    if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) SetGpuReg(REG_OFFSET_BG0HOFS, -s.flipPagesBgHofs & 0xffff);
  }
}

function PokeSum_FlipPages_HandleBgHofs(): void {
  const s = S();
  if (s.pageFlipDirection === 1) {
    // Right
    if (s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) PokeSum_FlipPages_SlideLayerLeft();
    else PokeSum_FlipPages_SlideLayeRight();
  } else {
    if (s.curPageIndex !== K.PSS_PAGE_MOVES) PokeSum_FlipPages_SlideLayeRight();
    else PokeSum_FlipPages_SlideLayerLeft();
  }
}

function PokeSum_FlipPages_HandleHpExpBarSprites(): void {
  const s = S();
  if (s.curPageIndex === K.PSS_PAGE_SKILLS && s.pageFlipDirection === 0) PokeSum_FlipPages_SlideHpExpBarsIn();
  if (s.curPageIndex === K.PSS_PAGE_MOVES && s.pageFlipDirection === 1) PokeSum_FlipPages_SlideHpExpBarsOut();
}

function VBlankCB_PokemonSummaryScreen(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();

  // The C keeps reading sMonSummaryScreen here after Task_DestroyResourcesOnExit has freed it,
  // until the next screen replaces this callback.
  if (!sMonSummaryScreenPtr?.flippingPages) return;

  PokeSum_FlipPages_HandleBgHofs();
  PokeSum_FlipPages_HandleHpExpBarSprites();
}

function PokeSum_Setup_ResetCallbacks(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
}

function PokeSum_Setup_SetVBlankCallback(): void {
  SetVBlankCallback(VBlankCB_PokemonSummaryScreen);
}

// ------------------------------------------------------------------ windows

function PokeSum_CreateWindows(): void {
  const s = S();
  InitWindows(sWindowTemplates_Dummy);

  for (let i = 0; i < 3; i++) s.windowIds[i] = AddWindow(sWindowTemplates_Permanent_Bg1[i]);

  for (let i = 0; i < 4; i++)
    switch (s.curPageIndex) {
      case K.PSS_PAGE_INFO:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Info[i]);
        break;
      case K.PSS_PAGE_SKILLS:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Skills[i]);
        break;
      case K.PSS_PAGE_MOVES:
      case K.PSS_PAGE_MOVES_INFO:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Moves[i]);
        break;
      default:
        break;
    }
}

function PokeSum_AddWindows(curPageIndex: number): void {
  const s = S();
  const bgPriority1 = GetGpuReg(REG_OFFSET_BG1CNT) & 3;
  const bgPriority2 = GetGpuReg(REG_OFFSET_BG2CNT) & 3;

  for (let i = 0; i < 7; i++) s.windowIds[i] = 0xff;

  let permanent: WindowTemplate[];
  if ((s.pageFlipDirection === 1 && s.curPageIndex !== K.PSS_PAGE_MOVES_INFO) || (s.pageFlipDirection === 0 && s.curPageIndex === K.PSS_PAGE_MOVES))
    permanent = bgPriority2 > bgPriority1 ? sWindowTemplates_Permanent_Bg2 : sWindowTemplates_Permanent_Bg1;
  else permanent = bgPriority2 > bgPriority1 ? sWindowTemplates_Permanent_Bg1 : sWindowTemplates_Permanent_Bg2;
  for (let i = 0; i < 3; i++) s.windowIds[i] = AddWindow(permanent[i]);

  for (let i = 0; i < 4; i++)
    switch (curPageIndex) {
      case K.PSS_PAGE_INFO:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Info[i]);
        break;
      case K.PSS_PAGE_SKILLS:
      default:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Skills[i]);
        break;
      case K.PSS_PAGE_MOVES:
      case K.PSS_PAGE_MOVES_INFO:
        s.windowIds[i + 3] = AddWindow(sWindowTemplates_Moves[i]);
        break;
    }
}

function PokeSum_RemoveWindows(_curPageIndex: number): void {
  for (let i = 0; i < 7; i++) RemoveWindow(S().windowIds[i]);
}

function PokeSum_SetHelpContext(): void {
  switch (S().curPageIndex) {
    case K.PSS_PAGE_INFO:
      SetHelpContext(K.HELPCONTEXT_POKEMON_INFO);
      break;
    case K.PSS_PAGE_SKILLS:
      SetHelpContext(K.HELPCONTEXT_POKEMON_SKILLS);
      break;
    case K.PSS_PAGE_MOVES:
    case K.PSS_PAGE_MOVES_INFO:
      SetHelpContext(K.HELPCONTEXT_POKEMON_MOVES);
      break;
  }
}

function PokeSum_BufferOtName_IsEqualToCurrentOwner(mon: Pokemon): boolean {
  const s = S();
  let trainerId: number;
  if (s.isEnemyParty) {
    // gLinkPlayers[GetMultiplayerId() ^ 1]: only reached from the trade screen, which isn't ported
    return false;
  } else {
    trainerId = GetPlayerTrainerId() & 0xffff;
    s.summary.otNameStrBufs[0] = [...pokemon.encodeName(state.playerName), EOS];
  }

  if (trainerId !== (mon.otId & 0xffff)) return false;

  s.summary.otNameStrBufs[1] = [...pokemon.encodeName(mon.otName), EOS];

  return !StringCompareWithoutExtCtrlCodes(s.summary.otNameStrBufs[0], s.summary.otNameStrBufs[1]);
}

const PAGE_PROGRESS_BASE_TILE_NUM = 345;

function PokeSum_DrawPageProgressTiles(): void {
  const s = S();
  const t = (tile: number, x: number, y: number, w = 1, h = 1) => FillBgTilemapBufferRect(3, tile + PAGE_PROGRESS_BASE_TILE_NUM, x, y, w, h, 0);
  switch (s.curPageIndex) {
    case K.PSS_PAGE_INFO:
      if (!s.isEgg) {
        t(17, 13, 0);
        t(33, 13, 1);
        t(16, 14, 0);
        t(32, 14, 1);
        t(18, 15, 0);
        t(34, 15, 1);
        t(20, 16, 0);
        t(36, 16, 1);
        t(18, 17, 0);
        t(34, 17, 1);
        t(21, 18, 0);
        t(37, 18, 1);
      } else {
        t(17, 13, 0);
        t(33, 13, 1);
        t(48, 14, 0);
        t(64, 14, 1);
        t(2, 15, 0, 4, 2);
      }
      break;
    case K.PSS_PAGE_SKILLS:
      t(49, 13, 0);
      t(65, 13, 1);
      t(1, 14, 0);
      t(19, 14, 1);
      t(17, 15, 0);
      t(33, 15, 1);
      t(16, 16, 0);
      t(32, 16, 1);
      t(18, 17, 0);
      t(34, 17, 1);
      t(21, 18, 0);
      t(37, 18, 1);
      break;
    case K.PSS_PAGE_MOVES:
      t(49, 13, 0);
      t(65, 13, 1);
      t(1, 14, 0);
      t(19, 14, 1);
      t(49, 15, 0);
      t(65, 15, 1);
      t(1, 16, 0);
      t(19, 16, 1);
      t(17, 17, 0);
      t(33, 17, 1);
      t(48, 18, 0);
      t(64, 18, 1);
      break;
    case K.PSS_PAGE_MOVES_INFO:
      if (s.mode === K.PSS_MODE_SELECT_MOVE) {
        t(1, 13, 0, 4, 1);
        t(19, 13, 1, 4, 1);
      } else {
        t(49, 13, 0);
        t(65, 13, 1);
        t(1, 14, 0);
        t(19, 14, 1);
        t(49, 15, 0);
        t(65, 15, 1);
        t(1, 16, 0);
        t(19, 16, 1);
      }
      t(50, 17, 0);
      t(66, 17, 1);
      t(48, 18, 0);
      t(64, 18, 1);
      break;
  }
}

function PokeSum_PrintMonTypeIcons(): void {
  const s = S();
  switch (s.curPageIndex) {
    case K.PSS_PAGE_INFO:
      if (!s.isEgg) {
        BlitMenuInfoIcon(s.windowIds[POKESUM_WIN_RIGHT_PANE], s.monTypes[0] + 1, 47, 35);
        if (s.monTypes[0] !== s.monTypes[1]) BlitMenuInfoIcon(s.windowIds[POKESUM_WIN_RIGHT_PANE], s.monTypes[1] + 1, 83, 35);
      }
      break;
    case K.PSS_PAGE_SKILLS:
      break;
    case K.PSS_PAGE_MOVES:
      break;
    case K.PSS_PAGE_MOVES_INFO:
      FillWindowPixelBuffer(s.windowIds[6], 0);
      BlitMenuInfoIcon(s.windowIds[6], s.monTypes[0] + 1, 0, 3);
      if (s.monTypes[0] !== s.monTypes[1]) BlitMenuInfoIcon(s.windowIds[6], s.monTypes[1] + 1, 36, 3);
      PutWindowTilemap(s.windowIds[6]);
      break;
  }
}

export function GetLastViewedMonIndex(): number {
  return sLastViewedMonIndex;
}

export function GetMoveSlotToReplace(): number {
  return sMoveSwapCursorPos;
}

export function SetPokemonSummaryScreenMode(mode: number): void {
  S().mode = mode;
}

/** IsMultiBattlePartner: link multi battles only */
function IsMultiBattlePartner(): boolean {
  return false;
}

/** BufferSelectedMonData: a box mon goes through BoxMonToMon. */
function BufferSelectedMonData(): void {
  s_currentMonFromList();
}

/** `*mon = partyMons[i]` or BoxMonToMon(&boxMons[i], mon) */
function s_currentMonFromList(): void {
  const s = S();
  const entry = s.monList[GetLastViewedMonIndex()];
  if (!s.isBoxMon) s.currentMon = copyMon(entry as Pokemon);
  else s.currentMon = boxMonToMon(pokemon, entry as BoxPokemon);
}

/** `*mon = partyMons[i]`: the screen works on a copy. */
function copyMon(mon: Pokemon): Pokemon {
  return { ...mon, nickname: [...mon.nickname], moves: [...mon.moves], pp: [...mon.pp], ivs: { ...mon.ivs }, evs: { ...mon.evs }, stats: { ...mon.stats } };
}

function GetMonMoveBySlotId(mon: Pokemon, moveSlot: number): number {
  return monMove(mon, Math.min(moveSlot, 3));
}

function GetMonPpByMoveSlot(mon: Pokemon, moveSlot: number): number {
  return monPp(mon, Math.min(moveSlot, 3));
}

function StatusToAilment(status: number): number {
  if (S().currentMon.hp === 0) return K.AILMENT_FNT;
  if (status & K.STATUS1_PSN_ANY) return K.AILMENT_PSN;
  if (status & K.STATUS1_PARALYSIS) return K.AILMENT_PRZ;
  if (status & K.STATUS1_SLEEP) return K.AILMENT_SLP;
  if (status & K.STATUS1_FREEZE) return K.AILMENT_FRZ;
  if (status & K.STATUS1_BURN) return K.AILMENT_BRN;
  if (CheckPartyPokerus(S().currentMon)) return K.AILMENT_PKRS;
  return K.AILMENT_NONE;
}

// ------------------------------------------------------------------ moves pages input

function Task_HandleInput_SelectMove(_taskId: number): void {
  const s = S();
  switch (s.selectMoveInputHandlerState) {
    case 0:
      // IsActiveOverworldLinkBusy / IsLinkRecvQueueAtOverworldMax: no link
      if (JOY_NEW(DPAD_UP)) {
        if (sMoveSelectionCursorPos > 0) {
          s.selectMoveInputHandlerState = 2;
          PlaySE(K.SE_SELECT);
          for (let i = sMoveSelectionCursorPos; i > 0; i--)
            if (s.moveIds[i - 1] !== 0) {
              PlaySE(K.SE_SELECT);
              sMoveSelectionCursorPos = i - 1;
              return;
            }
        } else {
          sMoveSelectionCursorPos = 4;
          s.selectMoveInputHandlerState = 2;
          PlaySE(K.SE_SELECT);
          if (s.isSwappingMoves)
            for (let i = sMoveSelectionCursorPos; i > 0; i--)
              if (s.moveIds[i - 1] !== 0) {
                PlaySE(K.SE_SELECT);
                sMoveSelectionCursorPos = i - 1;
                return;
              }
        }
      } else if (JOY_NEW(DPAD_DOWN)) {
        if (sMoveSelectionCursorPos < 4) {
          let v0 = 4;
          s.selectMoveInputHandlerState = 2;
          if (s.isSwappingMoves) {
            if (sMoveSelectionCursorPos === 5 - 2) {
              sMoveSelectionCursorPos = 0;
              s.selectMoveInputHandlerState = 2;
              PlaySE(K.SE_SELECT);
              return;
            }
            v0--;
          }
          let i = sMoveSelectionCursorPos;
          for (; i < v0; i++)
            if (s.moveIds[i + 1] !== 0) {
              PlaySE(K.SE_SELECT);
              sMoveSelectionCursorPos = i + 1;
              return;
            }
          if (!s.isSwappingMoves) {
            PlaySE(K.SE_SELECT);
            sMoveSelectionCursorPos = i;
          } else {
            PlaySE(K.SE_SELECT);
            sMoveSelectionCursorPos = 0;
          }
          return;
        } else if (sMoveSelectionCursorPos === 4) {
          sMoveSelectionCursorPos = 0;
          s.selectMoveInputHandlerState = 2;
          PlaySE(K.SE_SELECT);
          return;
        }
      } else if (JOY_NEW(A_BUTTON)) {
        PlaySE(K.SE_SELECT);
        if (sMoveSelectionCursorPos === 4) {
          sMoveSelectionCursorPos = 0;
          sMoveSwapCursorPos = 0;
          s.isSwappingMoves = false;
          ShoworHideMoveSelectionCursor(true);
          s.pageFlipDirection = 0;
          PokeSum_RemoveWindows(s.curPageIndex);
          s.curPageIndex--;
          s.selectMoveInputHandlerState = 1;
          return;
        }

        if (!s.isSwappingMoves) {
          // gReceivedRemoteLinkPlayers: no link
          if (!s.isEnemyParty && !gMain.inBattle) {
            sMoveSwapCursorPos = sMoveSelectionCursorPos;
            s.isSwappingMoves = true;
          }
          return;
        } else {
          s.isSwappingMoves = false;
          if (sMoveSelectionCursorPos === sMoveSwapCursorPos) return;
          SwapMonMoveSlots(); // SwapBoxMonMoveSlots for a box mon: the same fields
          UpdateCurrentMonBufferFromPartyOrBox();
          BufferMonMoves();
          s.selectMoveInputHandlerState = 2;
          return;
        }
      } else if (JOY_NEW(B_BUTTON)) {
        if (s.isSwappingMoves) {
          sMoveSwapCursorPos = sMoveSelectionCursorPos;
          s.isSwappingMoves = false;
          return;
        }
        if (sMoveSelectionCursorPos === 4) {
          sMoveSelectionCursorPos = 0;
          sMoveSwapCursorPos = 0;
        }
        ShoworHideMoveSelectionCursor(true);
        s.pageFlipDirection = 0;
        PokeSum_RemoveWindows(s.curPageIndex);
        s.curPageIndex--;
        s.selectMoveInputHandlerState = 1;
      }
      break;
    case 1:
      gTasks[s.inputHandlerTaskId].func = Task_BackOutOfSelectMove;
      s.selectMoveInputHandlerState = 0;
      break;
    case 2:
      PokeSum_PrintRightPaneText();
      PokeSum_PrintBottomPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      s.selectMoveInputHandlerState = 3;
      break;
    case 3:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      CopyWindowToVram(s.windowIds[6], 2);
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(3);
      s.selectMoveInputHandlerState = 0;
      break;
    default:
      break;
  }
}

/** SwapMonMoveSlots / SwapBoxMonMoveSlots: moves, PP and PP Ups trade places on the mon itself. */
function SwapMonMoveSlots(): void {
  const s = S();
  const mon = s.monList[GetLastViewedMonIndex()] as BoxPokemon;
  const a = sMoveSelectionCursorPos;
  const b = sMoveSwapCursorPos;

  const move1 = mon.moves[a];
  const move2 = mon.moves[b];
  const pp1 = mon.pp[a];
  const pp2 = mon.pp[b];

  let allMovesPPBonuses = mon.ppBonuses & 0xff;
  const mask = (slot: number) => 3 << (slot * 2); // gPPUpGetMask
  const move1ppBonus = (allMovesPPBonuses & mask(a)) >> (a * 2);
  const move2ppBonus = (allMovesPPBonuses & mask(b)) >> (b * 2);

  allMovesPPBonuses &= ~mask(a);
  allMovesPPBonuses &= ~mask(b);
  allMovesPPBonuses |= (move1ppBonus << (b * 2)) + (move2ppBonus << (a * 2));

  mon.moves[a] = move2;
  mon.moves[b] = move1;
  mon.pp[a] = pp2;
  mon.pp[b] = pp1;
  mon.ppBonuses = allMovesPPBonuses & 0xff;
}

function UpdateCurrentMonBufferFromPartyOrBox(): void {
  s_currentMonFromList();
}

function PokeSum_CanForgetSelectedMove(): boolean {
  const move = GetMonMoveBySlotId(S().currentMon, sMoveSelectionCursorPos);
  if (IsMoveHm(move) && S().mode !== K.PSS_MODE_FORGET_MOVE) return false;
  return true;
}

function Task_InputHandler_SelectOrForgetMove(taskId: number): void {
  const s = S();
  switch (s.selectMoveInputHandlerState) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0);
      s.selectMoveInputHandlerState++;
      break;
    case 1:
      if (!gPaletteFade.active) {
        PokeSum_TryPlayMonCry();
        s.selectMoveInputHandlerState++;
      }
      break;
    case 2:
      if (JOY_NEW(DPAD_UP)) {
        if (sMoveSelectionCursorPos > 0) {
          s.selectMoveInputHandlerState = 3;
          PlaySE(K.SE_SELECT);
          for (let i = sMoveSelectionCursorPos; i > 0; i--)
            if (s.moveIds[i - 1] !== 0) {
              PlaySE(K.SE_SELECT);
              sMoveSelectionCursorPos = i - 1;
              return;
            }
        } else {
          sMoveSelectionCursorPos = 4;
          s.selectMoveInputHandlerState = 3;
          PlaySE(K.SE_SELECT);
          return;
        }
      } else if (JOY_NEW(DPAD_DOWN)) {
        if (sMoveSelectionCursorPos < 4) {
          let v0 = 4;
          s.selectMoveInputHandlerState = 3;
          if (s.isSwappingMoves) v0--;
          let i = sMoveSelectionCursorPos;
          for (; i < v0; i++)
            if (s.moveIds[i + 1] !== 0) {
              PlaySE(K.SE_SELECT);
              sMoveSelectionCursorPos = i + 1;
              return;
            }
          if (!s.isSwappingMoves) {
            PlaySE(K.SE_SELECT);
            sMoveSelectionCursorPos = i;
          }
          return;
        } else if (sMoveSelectionCursorPos === 4) {
          sMoveSelectionCursorPos = 0;
          s.selectMoveInputHandlerState = 3;
          PlaySE(K.SE_SELECT);
          return;
        }
      } else if (JOY_NEW(A_BUTTON)) {
        if (PokeSum_CanForgetSelectedMove() || sMoveSelectionCursorPos === 4) {
          PlaySE(K.SE_SELECT);
          sMoveSwapCursorPos = sMoveSelectionCursorPos;
          SpecialVar.x8005 = sMoveSwapCursorPos;
          s.selectMoveInputHandlerState = 6;
        } else {
          PlaySE(K.SE_FAILURE);
          s.selectMoveInputHandlerState = 5;
        }
      } else if (JOY_NEW(B_BUTTON)) {
        sMoveSwapCursorPos = 4;
        SpecialVar.x8005 = sMoveSwapCursorPos;
        s.selectMoveInputHandlerState = 6;
      }
      break;
    case 3:
      PokeSum_PrintRightPaneText();
      PokeSum_PrintBottomPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      s.selectMoveInputHandlerState = 4;
      break;
    case 4:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      CopyWindowToVram(s.windowIds[6], 2);
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(3);
      s.selectMoveInputHandlerState = 2;
      break;
    case 5:
      FillWindowPixelBuffer(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 0);
      AddTextPrinterParameterized4(s.windowIds[POKESUM_WIN_TRAINER_MEMO], K.FONT_NORMAL, 7, 42, 0, 0, sLevelNickTextColors[0], TEXT_SKIP_DRAW, text('gText_PokeSum_HmMovesCantBeForgotten'));
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(3);
      s.selectMoveInputHandlerState = 2;
      break;
    case 6:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, 0);
      s.selectMoveInputHandlerState++;
      break;
    default:
      if (!gPaletteFade.active) Task_DestroyResourcesOnExit(taskId);
      break;
  }
}

// ------------------------------------------------------------------ sprites

function SpriteCB_PokeSum_MonPicSprite(sprite: Sprite): void {
  const s = S();
  const b = sMonPicBounceState!;
  if (s.numMonPicBounces >= 2) return;

  if (b.initDelay++ >= 2) {
    let table: number[];
    switch (b.vigor) {
      case 0:
        table = sMonPicBounceYDelta_Under60;
        break;
      case 1:
        table = sMonPicBounceYDelta_60to80;
        break;
      case 2:
        table = sMonPicBounceYDelta_80to99;
        break;
      case 3:
      default:
        table = sMonPicBounceYDelta_Full;
        break;
    }
    sprite.y += table[b.animFrame++];
    if (b.animFrame >= table.length) {
      b.animFrame = 0;
      s.numMonPicBounces++;
    }
    b.initDelay = 0;
  }
}

function SpriteCB_PokeSum_EggPicShake(sprite: Sprite): void {
  const s = S();
  const b = sMonPicBounceState!;
  if (s.numMonPicBounces >= 2) return;

  const shake = (delay: number, table: number[]) => {
    if (b.initDelay++ >= delay) {
      sprite.x += table[b.animFrame];
      if (++b.animFrame >= table.length) {
        b.animFrame = 0;
        b.initDelay = 0;
        s.numMonPicBounces++;
      }
    }
  };
  switch (b.vigor) {
    case 0:
    default:
      shake(120, sEggPicShakeXDelta_ItWillTakeSomeTime);
      break;
    case 1:
      shake(90, sEggPicShakeXDelta_OccasionallyMoves);
      break;
    case 2:
      shake(60, sEggPicShakeXDelta_AlmostReadyToHatch);
      break;
  }
}

function SpriteCB_MonPicDummy(_sprite: Sprite): void {}

function PokeSum_CreateMonPicSprite(): void {
  const s = S();
  sMonPicBounceState = { animFrame: 0, initDelay: 0, vigor: 0 };

  const species = speciesOrEgg(s.currentMon);
  const personality = s.currentMon.personality;
  const trainerId = s.currentMon.otId;

  // savedCallback == CB2_ReturnToTradeMenuFromSummary: the trade screen isn't ported
  let spriteId: number;
  if (ShouldIgnoreDeoxysForm(K.DEOXYS_CHECK_TRADE_MAIN, sLastViewedMonIndex)) spriteId = CreateMonPicSprite(species, trainerId, personality, true, 60, 65, 12, 0xffff, true);
  else spriteId = CreateMonPicSprite_HandleDeoxys(species, trainerId, personality, true, 60, 65, 12, 0xffff);

  FreeSpriteOamMatrix(gSprites[spriteId]);

  gSprites[spriteId].hFlip = !IsMonSpriteNotFlipped(species);

  s.monPicSpriteId = spriteId;

  PokeSum_ShowOrHideMonPicSprite(true);
  PokeSum_SetMonPicSpriteCallback(spriteId);
}

/** ShouldIgnoreDeoxysForm(DEOXYS_CHECK_TRADE_MAIN, ...): only for a multi battle partner's mons */
function ShouldIgnoreDeoxysForm(_caseId: number, _battlerId: number): boolean {
  return false;
}

function PokeSum_SetMonPicSpriteCallback(spriteId: number): void {
  const s = S();
  const b = sMonPicBounceState!;
  s.numMonPicBounces = 0;

  if (s.isEgg) {
    const friendship = s.currentMon.friendship & 0xff;
    if (friendship <= 5) b.vigor = 2;
    else {
      if (friendship <= 10) b.vigor = 1;
      else if (friendship <= 40) b.vigor = 0;
    }
    gSprites[spriteId].callback = SpriteCB_PokeSum_EggPicShake;
    return;
  }

  if (s.curMonStatusAilment !== K.AILMENT_NONE && s.curMonStatusAilment !== K.AILMENT_PKRS) {
    if (s.curMonStatusAilment === K.AILMENT_FNT) return;
    gSprites[spriteId].callback = SpriteCB_MonPicDummy;
    return;
  }

  const curHp = s.currentMon.hp;
  const maxHp = s.currentMon.maxHP;

  if (curHp === maxHp) b.vigor = 3;
  else if (maxHp * 0.8 <= curHp) b.vigor = 2;
  else if (maxHp * 0.6 <= curHp) b.vigor = 1;
  else b.vigor = 0;

  gSprites[spriteId].callback = SpriteCB_PokeSum_MonPicSprite;
}

function PokeSum_ShowOrHideMonPicSprite(invisible: boolean): void {
  gSprites[S().monPicSpriteId].invisible = invisible;
}

function PokeSum_DestroyMonPicSprite(): void {
  FreeAndDestroyMonPicSprite(S().monPicSpriteId);
  sMonPicBounceState = null;
}

function CreateBallIconObj(): void {
  const s = S();
  const ballItemId = !s.isEgg ? s.currentMon.pokeball : 0;
  const ballId = ItemIdToBallId(ballItemId);
  LoadBallGfx(ballId);

  s.ballIconSpriteId = CreateSprite(gBallSpriteTemplates()[ballId], 106, 88, 0);
  gSprites[s.ballIconSpriteId].callback = SpriteCallbackDummy;
  gSprites[s.ballIconSpriteId].oam.priority = 0;

  ShowOrHideBallIconObj(true);
}

function ShowOrHideBallIconObj(invisible: boolean): void {
  gSprites[S().ballIconSpriteId].invisible = invisible;
}

function DestroyBallIconObj(): void {
  // Redundant, as DestroySpriteAndFreeResources could've been used.
  DestroySpriteAndFreeResources_Ball(gSprites[S().ballIconSpriteId]);
}

function PokeSum_CreateMonIconSprite(): void {
  const s = S();
  const species = speciesOrEgg(s.currentMon);
  const personality = s.currentMon.personality;

  SafeLoadMonIconPalette(species);

  if (ShouldIgnoreDeoxysForm(K.DEOXYS_CHECK_TRADE_MAIN, sLastViewedMonIndex)) s.monIconSpriteId = CreateMonIcon(species, SpriteCallbackDummy, 24, 32, 0, personality, false);
  else s.monIconSpriteId = CreateMonIcon(species, SpriteCallbackDummy, 24, 32, 0, personality, true);

  gSprites[s.monIconSpriteId].hFlip = !IsMonSpriteNotFlipped(species);

  PokeSum_ShowOrHideMonIconSprite(true);
}

function PokeSum_ShowOrHideMonIconSprite(invisible: boolean): void {
  gSprites[S().monIconSpriteId].invisible = invisible;
}

function PokeSum_DestroyMonIconSprite(): void {
  const species = speciesOrEgg(S().currentMon);
  SafeFreeMonIconPalette(species);
  DestroyMonIcon(gSprites[S().monIconSpriteId]);
}

function CreateMoveSelectionCursorObjs(tileTag: number, palTag: number): void {
  const gfxBufferPtrs = [gfx('sMoveSelectionCursorTiles_Left'), gfx('sMoveSelectionCursorTiles_Right')];

  for (let i = 0; i < 4; i++) {
    const template: SpriteTemplate = {
      tileTag: tileTag + i,
      paletteTag: palTag,
      oam: sMoveSelectionCursorOamData,
      anims: anims('sMoveSelectionCursorOamAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCB_MoveSelectionCursor,
    };

    LoadSpriteSheet({ data: gfxBufferPtrs[i % 2], size: 0x20 * 64, tag: tileTag + i });
    LoadSpritePalette({ data: gfx16('sMoveSelectionCursorPals'), tag: palTag });

    const spriteId = CreateSprite(template, 64 * (i % 2) + 152, sMoveSelectionCursorPos * 28 + 34, i % 2);
    const obj: MoveSelectionCursor = { sprite: gSprites[spriteId], whichSprite: i, tileTag: tileTag + i, palTag };
    sMoveSelectionCursorObjs[i] = obj;
    obj.sprite!.subpriority = i;

    if (i > 1) StartSpriteAnim(obj.sprite!, 1);
  }

  ShoworHideMoveSelectionCursor(true);
}

function ShoworHideMoveSelectionCursor(invisible: boolean): void {
  for (let i = 0; i < 4; i++) sMoveSelectionCursorObjs[i]!.sprite!.invisible = invisible;
}

function SpriteCB_MoveSelectionCursor(_sprite: Sprite): void {
  const s = S();
  for (let i = 0; i < 4; i++) {
    if (s.isSwappingMoves && i > 1) continue;
    sMoveSelectionCursorObjs[i]!.sprite!.y = sMoveSelectionCursorPos * 28 + 34;
  }

  if (!s.isSwappingMoves) {
    if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
      sMoveSelectionCursorObjs[0]!.sprite!.invisible = false;
      sMoveSelectionCursorObjs[1]!.sprite!.invisible = false;
    }
    return;
  }

  for (let i = 0; i < 2; i++) {
    const sprite = sMoveSelectionCursorObjs[i]!.sprite!;
    sprite.data[0]++;

    if (sprite.invisible) {
      if (sprite.data[0] > 60) {
        sprite.invisible = false;
        sprite.data[0] = 0;
      }
    } else if (sprite.data[0] > 60) {
      sprite.invisible = true;
      sprite.data[0] = 0;
    }
  }
}

function DestroyMoveSelectionCursorObjs(): void {
  for (let i = 0; i < 4; i++) {
    const obj = sMoveSelectionCursorObjs[i];
    if (obj?.sprite) DestroySpriteAndFreeResources(obj.sprite);
    sMoveSelectionCursorObjs[i] = null;
  }
}

function CreateMonStatusIconObj(tileTag: number, palTag: number): void {
  LoadSpriteSheet({ data: gfx('gSummaryScreen_StatusAilmentIcon_Gfx'), size: 0x20 * 32, tag: tileTag });
  LoadSpritePalette({ data: gfx16('gSummaryScreen_StatusAilmentIcon_Pal'), tag: palTag });
  const spriteId = CreateSprite(
    {
      tileTag,
      paletteTag: palTag,
      oam: sStatusAilmentIconOamData,
      anims: anims('sStatusAilmentIconAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    },
    0,
    0,
    0,
  );
  sStatusIcon = { sprite: gSprites[spriteId], tileTag, palTag };

  ShowOrHideStatusIcon(true);
  UpdateMonStatusIconObj();
}

function DestroyMonStatusIconObj(): void {
  if (sStatusIcon?.sprite) DestroySpriteAndFreeResources(sStatusIcon.sprite);
  sStatusIcon = null;
}

function UpdateMonStatusIconObj(): void {
  const s = S();
  s.curMonStatusAilment = StatusToAilment(s.currentMon.status);

  if (s.curMonStatusAilment === K.AILMENT_NONE) {
    ShowOrHideStatusIcon(true);
    return;
  }

  StartSpriteAnim(sStatusIcon!.sprite!, s.curMonStatusAilment - 1);
  ShowOrHideStatusIcon(false);
}

function ShowOrHideStatusIcon(invisible: boolean): void {
  const s = S();
  const sprite = sStatusIcon!.sprite!;
  if (s.curMonStatusAilment === K.AILMENT_NONE || s.isEgg) sprite.invisible = true;
  else sprite.invisible = invisible;

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
    if (sprite.y !== 45) {
      sprite.x = 16;
      sprite.y = 45;
      return;
    }
  } else if (sprite.y !== 38) {
    sprite.x = 16;
    sprite.y = 38;
    return;
  }
}

function CreateHpBarObjs(tileTag: number, palTag: number): void {
  const s = S();
  let hpBarPalTagOffset = 0;

  const curHp = s.currentMon.hp;
  const maxHp = s.currentMon.maxHP;

  if (Math.trunc(maxHp / 4) > curHp) hpBarPalTagOffset = 2;
  else if (Math.trunc(maxHp / 2) > curHp) hpBarPalTagOffset = 1;

  const pals = sHpBarPals();
  LoadSpriteSheet({ data: gfx('gSummaryScreen_HpBar_Gfx'), size: 0x20 * 12, tag: tileTag });
  LoadSpritePalette({ data: pals[0], tag: palTag });
  LoadSpritePalette({ data: pals[1], tag: palTag + 1 });
  LoadSpritePalette({ data: pals[2], tag: palTag + 2 });

  sHpBarObjs = { sprites: [], xpos: [], tileTag, palTag };
  for (let i = 0; i < 9; i++) {
    const template: SpriteTemplate = {
      tileTag,
      paletteTag: palTag + hpBarPalTagOffset,
      oam: sHpOrExpBarOamData,
      anims: anims('sHpOrExpBarAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    };
    HP().xpos[i] = i * 8 + 172;
    const spriteId = CreateSprite(template, HP().xpos[i], 36, 0);
    HP().sprites[i] = gSprites[spriteId];
    HP().sprites[i].invisible = false;
    HP().sprites[i].oam.priority = 2;
    StartSpriteAnim(HP().sprites[i], 8);
  }

  UpdateHpBarObjs();
  ShowOrHideHpBarObjs(true);
}

function UpdateHpBarObjs(): void {
  const s = S();
  let numWholeHpBarTiles = 0;
  const two = 2;
  let hpBarPalOffset = 0;

  if (s.isEgg) return;

  const curHp = s.currentMon.hp;
  const maxHp = s.currentMon.maxHP;

  if (Math.trunc(maxHp / 5) >= curHp) hpBarPalOffset = 2;
  else if (Math.trunc(maxHp / 2) >= curHp) hpBarPalOffset = 1;

  switch (GetHPBarLevel(curHp, maxHp)) {
    case 3:
    default:
      hpBarPalOffset = 0;
      break;
    case 2:
      hpBarPalOffset = 1;
      break;
    case 1:
      hpBarPalOffset = 2;
      break;
  }

  for (let i = 0; i < 9; i++) HP().sprites[i].oam.paletteNum = IndexOfSpritePaletteTag(K.TAG_PSS_UNK_78) + hpBarPalOffset;

  if (curHp === maxHp) for (let i = two; i < 8; i++) StartSpriteAnim(HP().sprites[i], 8);
  else {
    const pointsPerTile = Math.trunc((maxHp << 2) / 6);
    let totalPoints = curHp << 2;

    // A 1-HP mon has no points per tile; the GBA would spin forever here.
    while (pointsPerTile > 0) {
      if (totalPoints <= pointsPerTile) break;
      totalPoints -= pointsPerTile;
      numWholeHpBarTiles++;
    }

    numWholeHpBarTiles += two;

    for (let i = two; i < numWholeHpBarTiles; i++) StartSpriteAnim(HP().sprites[i], 8);

    const animNum = pointsPerTile > 0 ? Math.trunc((totalPoints * 6) / pointsPerTile) : 0;
    StartSpriteAnim(HP().sprites[numWholeHpBarTiles], animNum);

    for (let i = numWholeHpBarTiles + 1; i < 8; i++) StartSpriteAnim(HP().sprites[i], 0);
  }

  StartSpriteAnim(HP().sprites[0], 9);
  StartSpriteAnim(HP().sprites[1], 10);
  StartSpriteAnim(HP().sprites[8], 11);
}

function DestroyHpBarObjs(): void {
  for (let i = 0; i < 9; i++) if (HP().sprites[i]) DestroySpriteAndFreeResources(HP().sprites[i]);
  sHpBarObjs = null;
}

function ShowOrHideHpBarObjs(invisible: boolean): void {
  for (let i = 0; i < 9; i++) HP().sprites[i].invisible = invisible;
}

function CreateExpBarObjs(tileTag: number, palTag: number): void {
  LoadSpriteSheet({ data: gfx('gSummaryScreen_ExpBar_Gfx'), size: 0x20 * 12, tag: tileTag });
  LoadSpritePalette({ data: gfx16('gSummaryScreen_HpExpBar_Pal'), tag: palTag });

  sExpBarObjs = { sprites: [], xpos: [], tileTag, palTag };
  for (let i = 0; i < 11; i++) {
    const template: SpriteTemplate = {
      tileTag,
      paletteTag: palTag,
      oam: sHpOrExpBarOamData,
      anims: anims('sHpOrExpBarAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    };
    EXP().xpos[i] = i * 8 + 156;
    const spriteId = CreateSprite(template, EXP().xpos[i], 132, 0);
    EXP().sprites[i] = gSprites[spriteId];
    EXP().sprites[i].oam.priority = 2;
  }

  UpdateExpBarObjs();
  ShowOrHideExpBarObjs(true);
}

function UpdateExpBarObjs(): void {
  const s = S();
  let numWholeExpBarTiles = 0;
  const two = 2;

  if (s.isEgg) return;

  const exp = s.currentMon.exp;
  const level = s.currentMon.level;
  const species = s.currentMon.species;

  if (level < 100) {
    const table = pokemon.tables.experience[pokemon.species[species].growthRate];
    const totalExpToNextLevel = (table[level + 1] - table[level]) >>> 0;
    const curExpToNextLevel = (exp - table[level]) >>> 0;
    const pointsPerTile = Math.trunc((totalExpToNextLevel * 4) / 8);
    let totalPoints = curExpToNextLevel * 4;

    while (true) {
      if (totalPoints <= pointsPerTile) break;
      totalPoints -= pointsPerTile;
      numWholeExpBarTiles++;
    }

    numWholeExpBarTiles += two;

    for (let i = two; i < numWholeExpBarTiles; i++) StartSpriteAnim(EXP().sprites[i], 8);

    if (numWholeExpBarTiles >= 10) {
      if (totalExpToNextLevel === curExpToNextLevel) return;
      else StartSpriteAnim(EXP().sprites[9], 7);
    }

    const animNum = Math.trunc((totalPoints * 8) / pointsPerTile);
    StartSpriteAnim(EXP().sprites[numWholeExpBarTiles], animNum);

    for (let i = numWholeExpBarTiles + 1; i < 10; i++) StartSpriteAnim(EXP().sprites[i], 0);
  } else for (let i = two; i < 10; i++) StartSpriteAnim(EXP().sprites[i], 0);

  StartSpriteAnim(EXP().sprites[0], 9);
  StartSpriteAnim(EXP().sprites[1], 10);
  StartSpriteAnim(EXP().sprites[10], 11);
}

function DestroyExpBarObjs(): void {
  for (let i = 0; i < 11; i++) if (EXP().sprites[i]) DestroySpriteAndFreeResources(EXP().sprites[i]);
  sExpBarObjs = null;
}

function ShowOrHideExpBarObjs(invisible: boolean): void {
  for (let i = 0; i < 11; i++) EXP().sprites[i].invisible = invisible;
}

function CreatePokerusIconObj(tileTag: number, palTag: number): void {
  LoadSpriteSheet({ data: gfx('sPokerusIconObjTiles'), size: 0x20 * 1, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sPokerusIconObjPal'), tag: palTag });
  const spriteId = CreateSprite(
    {
      tileTag,
      paletteTag: palTag,
      oam: sPokerusIconObjOamData,
      anims: anims('sPokerusIconObjAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    },
    114,
    92,
    0,
  );
  sPokerusIconObj = { sprite: gSprites[spriteId], tileTag, palTag };

  HideShowPokerusIcon(true);
  ShowPokerusIconObjIfHasOrHadPokerus();
}

function DestroyPokerusIconObj(): void {
  if (sPokerusIconObj?.sprite) DestroySpriteAndFreeResources(sPokerusIconObj.sprite);
  sPokerusIconObj = null;
}

function ShowPokerusIconObjIfHasOrHadPokerus(): void {
  const mon = S().currentMon;
  if (!CheckPartyPokerus(mon) && CheckPartyHasHadPokerus(mon)) HideShowPokerusIcon(false);
  else HideShowPokerusIcon(true);
}

function HideShowPokerusIcon(invisible: boolean): void {
  const s = S();
  const sprite = sPokerusIconObj!.sprite!;
  if (!CheckPartyPokerus(s.currentMon) && CheckPartyHasHadPokerus(s.currentMon)) {
    sprite.invisible = invisible;
    return;
  } else sprite.invisible = true;

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
    sprite.invisible = true;
    sprite.x = 16;
    sprite.y = 44;
  } else {
    sprite.x = 114;
    sprite.y = 92;
  }
}

function CreateShinyStarObj(tileTag: number, palTag: number): void {
  LoadSpriteSheet({ data: gfx('sStarObjTiles'), size: 0x20 * 2, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sStarObjPal'), tag: palTag });
  const spriteId = CreateSprite(
    {
      tileTag,
      paletteTag: palTag,
      oam: sStarObjOamData,
      anims: anims('sStarObjAnimTable'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    },
    106,
    40,
    0,
  );
  sShinyStarObjData = { sprite: gSprites[spriteId], tileTag, palTag };

  HideShowShinyStar(true);
  ShowShinyStarObjIfMonShiny();
}

function DestroyShinyStarObj(): void {
  if (sShinyStarObjData?.sprite) DestroySpriteAndFreeResources(sShinyStarObjData.sprite);
  sShinyStarObjData = null;
}

function HideShowShinyStar(invisible: boolean): void {
  const s = S();
  const sprite = sShinyStarObjData!.sprite!;
  if (IsMonShiny(s.currentMon) && !s.isEgg) sprite.invisible = invisible;
  else sprite.invisible = true;

  if (s.curPageIndex === K.PSS_PAGE_MOVES_INFO) {
    sprite.x = 8;
    sprite.y = 24;
  } else {
    sprite.x = 106;
    sprite.y = 40;
  }
}

function ShowShinyStarObjIfMonShiny(): void {
  const s = S();
  if (IsMonShiny(s.currentMon) && !s.isEgg) HideShowShinyStar(false);
  else HideShowShinyStar(true);
}

function PokeSum_DestroySprites(): void {
  DestroyMoveSelectionCursorObjs();
  DestroyHpBarObjs();
  DestroyExpBarObjs();
  PokeSum_DestroyMonPicSprite();
  PokeSum_DestroyMonIconSprite();
  DestroyBallIconObj();
  PokeSum_DestroyMonMarkingsSprite();
  DestroyMonStatusIconObj();
  DestroyPokerusIconObj();
  DestroyShinyStarObj();
  ResetSpriteData();
}

function PokeSum_CreateSprites(): void {
  CreateBallIconObj();
  ShowOrHideBallIconObj(false);
  PokeSum_CreateMonIconSprite();
  PokeSum_CreateMonPicSprite();
  PokeSum_ShowOrHideMonPicSprite(false);
  UpdateHpBarObjs();
  UpdateExpBarObjs();
  PokeSum_UpdateMonMarkingsAnim();
  UpdateMonStatusIconObj();
  ShowPokerusIconObjIfHasOrHadPokerus();
  ShowShinyStarObjIfMonShiny();
}

function PokeSum_CreateMonMarkingsSprite(): void {
  const s = S();
  const markings = monMarkings(s.currentMon);

  // The C passes the (still NULL) sprite pointer through DestroySpriteAndFreeResources first.
  if (s.markingSprite) DestroySpriteAndFreeResources(s.markingSprite);
  s.markingSprite = CreateMonMarkingAllCombosSprite(K.TAG_PSS_UNK_8C, K.TAG_PSS_UNK_8C, gfx16('sMonMarkingSpritePalette'));

  if (s.markingSprite) {
    StartSpriteAnim(s.markingSprite, markings);
    s.markingSprite.x = 20;
    s.markingSprite.y = 91;
  }

  PokeSum_ShowOrHideMonMarkingsSprite(true);
}

function PokeSum_DestroyMonMarkingsSprite(): void {
  if (S().markingSprite) DestroySpriteAndFreeResources(S().markingSprite!);
}

function PokeSum_ShowOrHideMonMarkingsSprite(invisible: boolean): void {
  const markings = monMarkings(S().currentMon);
  if (markings === 0) S().markingSprite!.invisible = true;
  else S().markingSprite!.invisible = invisible;
}

function PokeSum_UpdateMonMarkingsAnim(): void {
  const markings = monMarkings(S().currentMon);
  StartSpriteAnim(S().markingSprite!, markings);
  PokeSum_ShowOrHideMonMarkingsSprite(false);
}

// ------------------------------------------------------------------ switching mons

function PokeSum_SeekToNextMon(_taskId: number, direction: number): void {
  const s = S();
  let scrollResult = -1;

  if (s.isBoxMon) {
    let flags: number;
    if (s.curPageIndex !== K.PSS_PAGE_INFO) flags = direction === 1 ? 0 : 2;
    else flags = direction === 1 ? 1 : 3; // Allow Eggs
    scrollResult = SeekToNextMonInBox(s.monList as (BoxPokemon | null)[], GetLastViewedMonIndex(), s.lastIndex, flags);
  } else {
    // SeekToNextMonInMultiParty is for link multi battles
    scrollResult = SeekToNextMonInSingleParty(direction);
  }

  if (scrollResult === -1) return;

  sLastViewedMonIndex = scrollResult;
  CreateTask(Task_PokeSum_SwitchDisplayedPokemon, 0);
  s.switchMonTaskState = 0;
}

/**
 * SeekToNextMonInBox (pokemon_storage_system.c): the next (flags bit 1: previous) occupied slot after curIndex,
 * up to maxIndex; eggs are skipped unless flags bit 0 is set. -1 if there is none.
 */
function SeekToNextMonInBox(boxMons: (BoxPokemon | null)[], curIndex: number, maxIndex: number, flags: number): number {
  const adder = flags === 0 || flags === 1 ? 1 : -1;
  const allowEggs = flags === 1 || flags === 3;
  for (let i = curIndex + adder; i >= 0 && i <= maxIndex; i += adder) {
    const mon = boxMons[i];
    if (mon && mon.species && (allowEggs || !mon.isEgg)) return i;
  }
  return -1;
}

function SeekToNextMonInSingleParty(direction: number): number {
  const s = S();
  const partyMons = s.monList as Pokemon[];
  let seekDelta = 0;

  if (s.curPageIndex === 0) {
    if (direction === -1 && sLastViewedMonIndex === 0) return -1;
    else if (direction === 1 && sLastViewedMonIndex >= s.lastIndex) return -1;
    else return sLastViewedMonIndex + direction;
  }

  for (;;) {
    seekDelta += direction;
    if (0 > sLastViewedMonIndex + seekDelta || sLastViewedMonIndex + seekDelta > s.lastIndex) return -1;
    if (!partyMons[sLastViewedMonIndex + seekDelta].isEgg) return sLastViewedMonIndex + seekDelta;
  }
}

/** SeekToNextMonInMultiParty's order table (link multi battles; kept for reference). */
void sMultiBattlePartyOrder;

function Task_PokeSum_SwitchDisplayedPokemon(taskId: number): void {
  const s = S();
  switch (s.switchMonTaskState) {
    case 0:
      StopCryAndClearCrySongs();
      sMoveSelectionCursorPos = 0;
      sMoveSwapCursorPos = 0;
      s.switchMonTaskState++;
      break;
    case 1:
      PokeSum_DestroyMonPicSprite();
      PokeSum_DestroyMonIconSprite();
      DestroyBallIconObj();
      s.switchMonTaskState++;
      break;
    case 2:
      BufferSelectedMonData();
      s.isEgg = s.currentMon.isEgg;
      s.isBadEgg = false;
      if (s.isBadEgg) s.isEgg = true;
      s.switchMonTaskState++;
      break;
    case 3: {
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 30, 20);
      const bgPal = gfx16('gSummaryScreen_Bg_Pal');
      if (IsMonShiny(s.currentMon) && !s.isEgg) {
        LoadPalette(bgPal.subarray(16 * 6), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
        LoadPalette(bgPal.subarray(16 * 5), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      } else {
        LoadPalette(bgPal.subarray(16 * 0), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
        LoadPalette(bgPal.subarray(16 * 1), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      }
      s.switchMonTaskState++;
      break;
    }
    case 4:
      if (s.curPageIndex === K.PSS_PAGE_INFO) {
        if (s.isEgg) {
          CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageEgg_Tilemap'), 0, 0);
          CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
        } else {
          CopyToBgTilemapBuffer(s.skillsPageBgNum, gfx16('gSummaryScreen_PageInfo_Tilemap'), 0, 0);
          CopyToBgTilemapBuffer(s.infoAndMovesPageBgNum, gfx16('gSummaryScreen_PageSkills_Tilemap'), 0, 0);
        }
      }
      s.switchMonTaskState++;
      break;
    case 5:
      BufferMonInfo();
      s.switchMonTaskState++;
      break;
    case 6:
      if (!s.isEgg) BufferMonSkills();
      s.switchMonTaskState++;
      break;
    case 7:
      if (!s.isEgg) BufferMonMoves();
      s.switchMonTaskState++;
      break;
    case 8:
      PokeSum_PrintRightPaneText();
      PokeSum_PrintBottomPaneText();
      PokeSum_PrintAbilityDataOrMoveTypes();
      s.switchMonTaskState++;
      break;
    case 9:
      PokeSum_PrintMonTypeIcons();
      PokeSum_DrawPageProgressTiles();
      PokeSum_PrintPageHeaderText(s.curPageIndex);
      s.switchMonTaskState++;
      break;
    case 10:
      CopyWindowToVram(s.windowIds[POKESUM_WIN_PAGE_NAME], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_CONTROLS], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_LVL_NICK], 2);
      CopyWindowToVram(s.windowIds[6], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_RIGHT_PANE], 2);
      CopyWindowToVram(s.windowIds[POKESUM_WIN_TRAINER_MEMO], 2);
      CopyWindowToVram(s.windowIds[5], 2);
      CopyBgTilemapBufferToVram(0);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(3);
      s.switchMonTaskState++;
      break;
    case 11:
      // Overworld_LinkRecvQueueLengthMoreThan2 / IsLinkRecvQueueAtOverworldMax: no link
      PokeSum_CreateSprites();
      PokeSum_TryPlayMonCry();
      s.switchMonTaskState++;
      break;
    default:
      s.switchMonTaskState = 0;
      DestroyTask(taskId);
      break;
  }
}

function PokeSum_UpdateWin1ActiveFlag(curPageIndex: number): void {
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN1_ON);
  switch (curPageIndex) {
    case K.PSS_PAGE_INFO:
    case K.PSS_PAGE_SKILLS:
    case K.PSS_PAGE_MOVES:
      SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) | DISPCNT_WIN1_ON);
      break;
    default:
      break;
  }
}

function PokeSum_TryPlayMonCry(): void {
  const mon = S().currentMon;
  if (!mon.isEgg) {
    if (ShouldPlayNormalMonCry(mon)) PlayCry_ByMode(speciesOrEgg(mon), 0, K.CRY_MODE_NORMAL);
    else PlayCry_ByMode(speciesOrEgg(mon), 0, K.CRY_MODE_WEAK);
  }
}

function PokeSum_IsMonBoldOrGentle(nature: number): boolean {
  return nature === K.NATURE_BOLD || nature === K.NATURE_GENTLE;
}

function CurrentMonIsFromGBA(): boolean {
  const version = monMetGame(S().currentMon);
  return version === K.VERSION_LEAF_GREEN || version === K.VERSION_FIRE_RED || version === K.VERSION_RUBY || version === K.VERSION_SAPPHIRE || version === K.VERSION_EMERALD;
}

function MapSecIsInKantoOrSevii(mapSec: number): boolean {
  return mapSec >= K.KANTO_MAPSEC_START && mapSec < K.MAPSEC_NONE;
}
