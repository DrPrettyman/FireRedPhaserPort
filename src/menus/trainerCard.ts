// trainer_card.c on the GBA layer: the player's trainer card from the start menu's PLAYER (ShowPlayerTrainerCard →
// CB2_InitTrainerCard → Task_TrainerCard; B fades out and CloseTrainerCard hands over to the callback,
// CB2_ReturnToFieldWithOpenMenu). Only CARD_TYPE_FRLG for the player: the Hoenn card (CARD_TYPE_RSE, a partner's
// R/S/E card) and the link cards (ShowTrainerCardInLink, the Union Room) wait for link play.
//
// The front (name, ID, money, Pokédex, play time with the blinking colon, the stars' card colour, the badges, the
// player's pic), the back (name, Hall of Fame debut, the link / trade / Berry Crush / Union Room stats when they're
// not zero, the photo's mon icons, the stickers) and the flip between them (FlipTrainerCard / Task_DoCardFlipTask:
// the card squashes to a line and opens again, BG0VOFS set per scanline). A on the front flips to the back; on the
// back B flips back to the front and A closes; B on the front closes.
//
// The SE_CARD_* sounds are the C's (gba/sound.ts); the opening waits for SE_CARD_OPEN (!IsSEPlaying).

import { constant, K } from '../battle/constants';
import { bdata, charmap, state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  WriteSequenceToBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_TGT1_BG0,
  DISPCNT_BG_ALL_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  hblankRegs,
  PALETTES_ALL,
  pltt,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3CNT,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { LoadStdWindowFrameGfx, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY, TEXT_COLOR_TRANSPARENT } from '../gba/menu';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  gPaletteFade,
  LoadPalette,
  PLTT_SIZE_4BPP,
  ResetPaletteFade,
  TintPalette_CustomTone,
  TintPalette_SepiaTone,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { gScanlineEffectRegBuffers, ScanlineEffect_Clear, ScanlineEffect_Stop } from '../gba/scanline';
import { IsSEPlaying, PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, gTasks, ResetTasks, RunTasks, TASK_NONE, type Task } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  CopyWindowToVram,
  COPYWIN_FULL,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FreeAllWindowBuffers,
  gWindows,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import { isNationalDexEnabled } from '../script/specials';
import { EOS } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { concat, ConvertIntToDecimalStringN, STR_CONV_MODE_LEADING_ZEROS, STR_CONV_MODE_LEFT_ALIGN, STR_CONV_MODE_RIGHT_ALIGN, text } from './common';
import { FLAG_GET_CAUGHT, GetKantoPokedexCount, GetNationalPokedexCount, HasAllKantoMons, HasAllMons } from './pokedex';
import { menusData } from './data';
import { CopyEasyChatWord } from './easyChat';
import { CreateTrainerCardTrainerPicSprite, PlayerGenderToFrontTrainerPicId } from './picSprites';
import { GetIconSpecies, GetMonIconTiles, monIconSymbol } from './pokemonIcon';

// include/constants/trainer_card.h
const CARD_TYPE_FRLG = 0;
const CARD_TYPE_RSE = 1;
const TRAINER_CARD_PROFILE_LENGTH = 4;
const TRAINER_CARD_STICKER_TYPES = 3;
const NUM_BADGES = 8;
const PARTY_SIZE = 6;
const MON_ICON_TINT_NORMAL = 0;
const MON_ICON_TINT_BLACK = 1;
const MON_ICON_TINT_PINK = 2;
const MON_ICON_TINT_SEPIA = 3;
// characters.h
const TEXT_COLOR_RED = 4;
const TEXT_COLOR_LIGHT_RED = 5;

// The strings for the back (trainer_card.c's enum)
const TRAINER_CARD_STRING_NAME = 0;
const TRAINER_CARD_STRING_HOF_TIME = 1;
const TRAINER_CARD_STRING_LINK_RECORD = 2;
const TRAINER_CARD_STRING_WIN_LOSS = 3;
const TRAINER_CARD_STRING_LINK_WINS = 4;
const TRAINER_CARD_STRING_LINK_LOSSES = 5;
const TRAINER_CARD_STRING_TRADES = 6;
const TRAINER_CARD_STRING_TRADE_COUNT = 7;
const TRAINER_CARD_STRING_BERRY_CRUSH = 8;
const TRAINER_CARD_STRING_BERRY_CRUSH_COUNT = 9;
const TRAINER_CARD_STRING_UNION_ROOM = 10;
const TRAINER_CARD_STRING_UNION_ROOM_NUM = 11;
const TRAINER_CARD_STRING_COUNT = 12;

/** struct TrainerCardRSE */
interface TrainerCardRSE {
  gender: number;
  stars: number;
  hasPokedex: boolean;
  caughtAllHoenn: boolean;
  hasAllPaintings: boolean;
  hofDebutHours: number;
  hofDebutMinutes: number;
  hofDebutSeconds: number;
  caughtMonsCount: number;
  trainerId: number;
  playTimeHours: number;
  playTimeMinutes: number;
  linkBattleWins: number;
  linkBattleLosses: number;
  battleTowerWins: number;
  battleTowerStraightWins: number;
  contestsWithFriends: number;
  pokeblocksWithFriends: number;
  pokemonTrades: number;
  money: number;
  easyChatProfile: number[];
  /** with EOS */
  playerName: number[];
}

/** struct TrainerCard */
export interface TrainerCard {
  rse: TrainerCardRSE;
  version: number;
  berryCrushPoints: number;
  unionRoomNum: number;
  berriesPicked: number;
  jumpsInRow: number;
  shouldDrawStickers: boolean;
  hasAllMons: boolean;
  monIconTint: number;
  facilityClass: number;
  stickers: number[];
  monSpecies: number[];
}

export const emptyTrainerCard = (): TrainerCard => ({
  rse: {
    gender: 0,
    stars: 0,
    hasPokedex: false,
    caughtAllHoenn: false,
    hasAllPaintings: false,
    hofDebutHours: 0,
    hofDebutMinutes: 0,
    hofDebutSeconds: 0,
    caughtMonsCount: 0,
    trainerId: 0,
    playTimeHours: 0,
    playTimeMinutes: 0,
    linkBattleWins: 0,
    linkBattleLosses: 0,
    battleTowerWins: 0,
    battleTowerStraightWins: 0,
    contestsWithFriends: 0,
    pokeblocksWithFriends: 0,
    pokemonTrades: 0,
    money: 0,
    easyChatProfile: new Array(TRAINER_CARD_PROFILE_LENGTH).fill(0),
    playerName: [EOS],
  },
  version: 0,
  berryCrushPoints: 0,
  unionRoomNum: 0,
  berriesPicked: 0,
  jumpsInRow: 0,
  shouldDrawStickers: false,
  hasAllMons: false,
  monIconTint: 0,
  facilityClass: 0,
  stickers: new Array(TRAINER_CARD_STICKER_TYPES).fill(0),
  monSpecies: new Array(PARTY_SIZE).fill(0),
});

/** struct TrainerCardData */
interface TrainerCardData {
  mainState: number;
  printState: number;
  gfxLoadState: number;
  bgPalLoadState: number;
  flipDrawState: number;
  isLink: boolean;
  timeColonBlinkTimer: number;
  timeColonInvisible: boolean;
  onBack: boolean;
  allowDMACopy: boolean;
  hasPokedex: boolean;
  hasHofResult: boolean;
  hasLinkResults: boolean;
  hasBattleTowerWins: boolean;
  hasTrades: boolean;
  hasBadge: boolean[];
  easyChatProfile: number[][];
  /** strings[TRAINER_CARD_STRING_COUNT]: the back's text, from BufferTextForCardBack */
  strings: number[][];
  /** monIconPals[16 * PARTY_SIZE] */
  monIconPals: Uint16Array;
  flipBlendY: number;
  cardType: number;
  callback2: MainCallback;
  trainerCard: TrainerCard;
  frontTilemap: Uint16Array;
  backTilemap: Uint16Array;
  bgTilemap: Uint16Array;
  badgeTiles: Uint8Array;
  stickerTiles: Uint8Array;
  cardTiles: Uint8Array;
  cardTilemapBuffer: Uint16Array;
  bgTilemapBuffer: Uint16Array;
  cardTop: number;
  timeColonNeedDraw: boolean;
  language: number;
  /** Not in the C: what the front and the back printed last, for the test probe. */
  printed: Partial<Record<PrintedKey, number[]>>;
}

type PrintedKey = 'name' | 'id' | 'money' | 'pokedex' | 'hours' | 'minutes' | 'backName' | 'hofDebut' | 'linkRecord' | 'trades' | 'berryCrush' | 'unionRoom';

/** sTrainerCardDataPtr: null while the card is down. */
let sTrainerCardDataPtr: TrainerCardData | null = null;

function sd(): TrainerCardData {
  return sTrainerCardDataPtr!;
}

const sTrainerCardBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 27, screenSize: 2, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 1, charBaseIndex: 2, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
  { bg: 3, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 192 },
];

const sTrainerCardWindowTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 15, baseBlock: 0x241 },
  { bg: 1, tilemapLeft: 1, tilemapTop: 1, width: 27, height: 18, paletteNum: 15, baseBlock: 0x1 },
  { bg: 3, tilemapLeft: 19, tilemapTop: 5, width: 9, height: 10, paletteNum: 8, baseBlock: 0x150 },
  DUMMY_WIN_TEMPLATE,
];

/** sKantoTrainerCardPals: by star count */
const sKantoTrainerCardPals = [
  'gKantoTrainerCardBlue_Pal', // Default (0 stars)
  'sKantoTrainerCardGreen_Pal', // 1 star
  'sKantoTrainerCardBronze_Pal', // 2 stars
  'sKantoTrainerCardSilver_Pal', // 3 stars
  'sKantoTrainerCardGold_Pal', // 4 stars
];

const sTrainerCardTextColors = [TEXT_COLOR_TRANSPARENT, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY];
const sTrainerCardStatColors = [TEXT_COLOR_TRANSPARENT, TEXT_COLOR_RED, TEXT_COLOR_LIGHT_RED];
const sTimeColonInvisibleTextColors = [TEXT_COLOR_TRANSPARENT, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_TRANSPARENT];
const sTrainerCardFontIds = [FONT_SMALL, FONT_NORMAL, FONT_SMALL];

/** sTrainerPicOffsets[cardType][gender] (Kanto, Hoenn) */
const sTrainerPicOffsets = [
  [
    [13, 4],
    [13, 4],
  ],
  [
    [1, 0],
    [1, 0],
  ],
];

const sTrainerCardFrontNameXPositions = [0x14, 0x10];
const sTrainerCardFrontNameYPositions = [0x1d, 0x21];
const sTrainerCardIdXPositions = [0x8e, 0x80];
const sTrainerCardIdYPositions = [0xa, 0x9];
const sTimeColonTextColors = [sTrainerCardTextColors, sTimeColonInvisibleTextColors];
const sTrainerCardTimeHoursXPositions = [0x65, 0x55];
const sTrainerCardTimeHoursYPositions = [0x77, 0x67];
const sTrainerCardTimeMinutesXPositions = [0x7c, 0x6c];
const sTrainerCardTimeMinutesYPositions = [0x58, 0x59];
const sTrainerCardBackNameXPositions = [0x8a, 0xd8];
const sTrainerCardBackNameYPositions = [0xb, 0xa];
const sTrainerCardHofDebutXPositions = [0xa, 0x10, 0x0, 0x0];
const sLinkTrainerCardRecordStrings = ['gText_LinkBattles', 'gText_LinkCableBattles'];
const sPokemonIconPalSlots = [5, 6, 7, 8, 9, 10];
const sPokemonIconXOffsets = [0, 4, 8, 12, 16, 20];
const sStickerPalSlots = [11, 12, 13, 14];
const sStarYOffsets = [7, 6, 0, 0];

/** The graphics the card loads (preload them before ShowPlayerTrainerCard). `gender`: MALE / FEMALE. */
export function trainerCardGfxSymbols(gender: number): string[] {
  const pic = PlayerGenderToFrontTrainerPicId(gender);
  return [
    'sKantoTrainerCardBg_Tilemap',
    'sKantoTrainerCardBack_Tilemap',
    'sKantoTrainerCardFront_Tilemap',
    'sKantoTrainerCardBadges_Gfx',
    'gKantoTrainerCard_Gfx',
    'sTrainerCardStickers_Gfx',
    ...sKantoTrainerCardPals,
    'sKantoTrainerCardBadges_Pal',
    'sKantoTrainerCardFemaleBg_Pal',
    'sTrainerCardStar_Pal',
    'sTrainerCardStickerPal1',
    'sTrainerCardStickerPal2',
    'sTrainerCardStickerPal3',
    'sTrainerCardStickerPal4',
    bdata.anims.trainerFrontPics[pic]!.pic,
    bdata.anims.trainerFrontPalettes[pic]!,
    // LoadMonIconGfx: the icons of the photo's mons (VAR_TRAINER_CARD_MON_ICON_*; SPECIES_NONE's too)
    'gMonIconPalettes',
    ...Array.from({ length: PARTY_SIZE }, (_, i) => monIconSymbol(MailSpeciesToIconSpecies(state.getVar(`VAR_TRAINER_CARD_MON_ICON_${i + 1}`)))),
  ];
}

// mail_data.c / pokemon_icon.c
const UNOWN_OFFSET = 30000;
const NUM_UNOWN_FORMS = 28;

/** MailSpeciesToIconSpecies: a mail species (SpeciesToMailSpecies: Unown as UNOWN_OFFSET + its letter) to an icon species. */
function MailSpeciesToIconSpecies(species: number): number {
  if (species >= UNOWN_OFFSET && species < UNOWN_OFFSET + NUM_UNOWN_FORMS) {
    // MailSpeciesToSpecies → SPECIES_UNOWN with the letter
    const letter = species - UNOWN_OFFSET;
    return letter === 0 ? K.SPECIES_UNOWN : letter + (K.SPECIES_UNOWN_B - 1);
  }
  if (species > K.SPECIES_UNOWN_B - 1) species = K.SPECIES_NONE;
  return GetIconSpecies(species, 0);
}

/** GetMonIconPaletteIndexFromSpecies */
function GetMonIconPaletteIndexFromSpecies(species: number): number {
  return menusData.monIconPaletteIndices[species] ?? 0;
}

// ------------------------------------------------------------------ callbacks

/** VBlankCB_TrainerCard */
function VBlankCB_TrainerCard(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  BlinkTimeColon();
  // (null after CloseTrainerCard, as in BlinkTimeColon)
  if (sTrainerCardDataPtr?.allowDMACopy) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, 160)); // DmaCopy16(3, ..., 0x140)
}

/**
 * HBlankCB_TrainerCard: REG_BG0VOFS = gScanlineEffectRegBuffers[1][REG_VCOUNT] on every line. Modelled like the
 * scanline effects' HBlank DMA: the PPU reads each line's BG0VOFS from the live buffer (gba/hw.ts hblankRegs, line L
 * gets buffer[L]), so BG0VOFS itself stays 0 and nothing is left behind when the flip ends, whichever frames the
 * host draws.
 */
function SetHBlankCB_TrainerCard(on: boolean): void {
  if (on) hblankRegs.set(REG_OFFSET_BG0VOFS, gScanlineEffectRegBuffers[1]);
  else hblankRegs.delete(REG_OFFSET_BG0VOFS);
  SetHBlankCallback(null);
}

/** CB2_TrainerCard */
function CB2_TrainerCard(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** CloseTrainerCard */
function CloseTrainerCard(taskId: number): void {
  SetMainCallback2(sd().callback2);
  FreeAllWindowBuffers();
  sTrainerCardDataPtr = null;
  DestroyTask(taskId);
}

// States for Task_TrainerCard. Skips the initial states, which are done once in order
const STATE_HANDLE_INPUT_FRONT = 10;
const STATE_HANDLE_INPUT_BACK = 11;
const STATE_WAIT_FLIP_TO_BACK = 12;
const STATE_WAIT_FLIP_TO_FRONT = 13;
const STATE_CLOSE_CARD = 14;

/** Task_TrainerCard (no link partner, so gReceivedRemoteLinkPlayers is FALSE throughout) */
function Task_TrainerCard(taskId: number): void {
  const d = sd();
  switch (d.mainState) {
    // Draw card initially
    case 0:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        FillWindowPixelBuffer(1, PIXEL_FILL(0));
        d.mainState++;
      }
      break;
    case 1:
      if (PrintAllOnCardFront()) d.mainState++;
      break;
    case 2:
      DrawTrainerCardWindow(1);
      d.mainState++;
      break;
    case 3:
      FillWindowPixelBuffer(2, PIXEL_FILL(0));
      CreateTrainerCardTrainerPic();
      DrawTrainerCardWindow(2);
      d.mainState++;
      break;
    case 4:
      DrawCardScreenBackground(d.bgTilemap);
      d.mainState++;
      break;
    case 5:
      DrawCardFrontOrBack(d.frontTilemap);
      d.mainState++;
      break;
    case 6:
      DrawStarsAndBadgesOnCard();
      d.mainState++;
      break;
    // Fade in
    case 7:
      // (the wireless status indicator: no link)
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      SetVBlankCallback(VBlankCB_TrainerCard);
      d.mainState++;
      break;
    case 8:
      if (!UpdatePaletteFade() && !IsDma3ManagerBusyWithBgCopy()) {
        PlaySE(K.SE_CARD_OPEN);
        d.mainState = STATE_HANDLE_INPUT_FRONT;
      }
      break;
    case 9:
      if (!IsSEPlaying()) d.mainState++;
      break;
    case STATE_HANDLE_INPUT_FRONT:
      // Blink the : in play time
      if (d.timeColonNeedDraw) {
        PrintTimeOnCard();
        DrawTrainerCardWindow(1);
        d.timeColonNeedDraw = false;
      }
      if (JOY_NEW(A_BUTTON)) {
        // SetHelpContext(HELPCONTEXT_TRAINER_CARD_BACK): no help system
        FlipTrainerCard();
        PlaySE(K.SE_CARD_FLIP);
        d.mainState = STATE_WAIT_FLIP_TO_BACK;
      } else if (JOY_NEW(B_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
        d.mainState = STATE_CLOSE_CARD;
      }
      break;
    case STATE_WAIT_FLIP_TO_BACK:
      if (IsCardFlipTaskActive()) {
        PlaySE(K.SE_CARD_OPEN);
        d.mainState = STATE_HANDLE_INPUT_BACK;
      }
      break;
    case STATE_HANDLE_INPUT_BACK:
      // Not linked: B flips back to the front, A closes the card.
      if (JOY_NEW(B_BUTTON)) {
        // SetHelpContext(HELPCONTEXT_TRAINER_CARD_FRONT)
        FlipTrainerCard();
        d.mainState = STATE_WAIT_FLIP_TO_FRONT;
        PlaySE(K.SE_CARD_FLIP);
      } else if (JOY_NEW(A_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
        d.mainState = STATE_CLOSE_CARD;
      }
      break;
    case STATE_CLOSE_CARD:
      if (!UpdatePaletteFade()) CloseTrainerCard(taskId);
      break;
    case STATE_WAIT_FLIP_TO_FRONT:
      if (IsCardFlipTaskActive()) {
        d.mainState = STATE_HANDLE_INPUT_FRONT;
        PlaySE(K.SE_CARD_OPEN);
      }
      break;
  }
}

/** LoadCardGfx (CARD_TYPE_FRLG, not a link card): LZ77UnCompWram into the card's buffers. */
function LoadCardGfx(): boolean {
  const d = sd();
  switch (d.gfxLoadState) {
    case 0:
      d.bgTilemap.set(gfx16('sKantoTrainerCardBg_Tilemap').subarray(0, d.bgTilemap.length));
      break;
    case 1:
      d.backTilemap.set(gfx16('sKantoTrainerCardBack_Tilemap').subarray(0, d.backTilemap.length));
      break;
    case 2:
      d.frontTilemap.set(gfx16(d.isLink ? 'sKantoTrainerCardFrontLink_Tilemap' : 'sKantoTrainerCardFront_Tilemap').subarray(0, d.frontTilemap.length));
      break;
    case 3:
      d.badgeTiles.set(gfx('sKantoTrainerCardBadges_Gfx').subarray(0, d.badgeTiles.length));
      break;
    case 4:
      d.cardTiles.set(gfx('gKantoTrainerCard_Gfx').subarray(0, d.cardTiles.length));
      break;
    case 5:
      if (d.cardType === CARD_TYPE_FRLG) d.stickerTiles.set(gfx('sTrainerCardStickers_Gfx').subarray(0, d.stickerTiles.length));
      break;
    default:
      d.gfxLoadState = 0;
      return true;
  }
  d.gfxLoadState++;
  return false;
}

/** CB2_InitTrainerCard */
function CB2_InitTrainerCard(): void {
  switch (gMain.state) {
    case 0:
      ResetGpuRegs();
      SetUpTrainerCardTask();
      gMain.state++;
      break;
    case 1:
      TrainerCardNull();
      gMain.state++;
      break;
    case 2:
      DmaClearOam();
      gMain.state++;
      break;
    case 3:
      DmaClearPltt();
      gMain.state++;
    // fallthrough
    case 4:
      ResetBgRegs();
      gMain.state++;
      break;
    case 5:
      InitBgsAndWindows();
      gMain.state++;
      break;
    case 6:
      LoadStdWindowFrameGfx();
      gMain.state++;
      break;
    case 7:
      LoadMonIconGfx();
      gMain.state++;
      break;
    case 8:
      if (LoadCardGfx()) gMain.state++;
      break;
    case 9:
      LoadStickerGfx();
      gMain.state++;
      break;
    case 10:
      HandleGpuRegs();
      gMain.state++;
      break;
    case 11:
      BufferTextForCardBack();
      gMain.state++;
      break;
    case 12:
      if (SetTrainerCardBgsAndPals()) gMain.state++;
      break;
    case 13:
      gMain.state++;
      break;
    default:
      SetTrainerCardCB2();
      break;
  }
}

/** GetCappedGameStat */
function GetCappedGameStat(statId: number, maxValue: number): number {
  return Math.min(maxValue, state.getGameStat(statId));
}

/** gSaveBlock2Ptr->playerGender */
function playerGender(): number {
  return state.playerGender === 'female' ? K.FEMALE : K.MALE;
}

/** GetCaughtMonsCount */
function GetCaughtMonsCount(): number {
  if (isNationalDexEnabled(state)) return GetNationalPokedexCount(state, FLAG_GET_CAUGHT);
  return GetKantoPokedexCount(state, FLAG_GET_CAUGHT);
}

/**
 * SetPlayerCardData. The player's card only ever comes here with CARD_TYPE_RSE (from
 * TrainerCard_GenerateCardForLinkPlayer, which then counts the FRLG stars itself), so GetTrainerStarCount, the
 * CARD_TYPE_FRLG branch, is unused in the game too.
 */
function SetPlayerCardData(trainerCard: TrainerCard, cardType: number): void {
  const rse = trainerCard.rse;
  rse.gender = playerGender();
  rse.playTimeHours = state.playTime.hours;
  rse.playTimeMinutes = state.playTime.minutes;

  let playTime = state.getGameStat(K.GAME_STAT_FIRST_HOF_PLAY_TIME);
  if (!state.getGameStat(K.GAME_STAT_ENTERED_HOF)) playTime = 0;
  rse.hofDebutHours = (playTime >>> 16) & 0xffff;
  rse.hofDebutMinutes = (playTime >>> 8) & 0xff;
  rse.hofDebutSeconds = playTime & 0xff;
  if (playTime >>> 16 > 999) {
    rse.hofDebutHours = 999;
    rse.hofDebutMinutes = 59;
    rse.hofDebutSeconds = 59;
  }

  rse.hasPokedex = state.getFlag('FLAG_SYS_POKEDEX_GET');
  rse.caughtAllHoenn = false; // HasAllHoennMons: FireRed has no Hoenn dex (overwritten below with HasAllKantoMons)
  rse.caughtMonsCount = GetCaughtMonsCount();

  rse.trainerId = state.trainerId & 0xffff; // (playerTrainerId[1] << 8) | playerTrainerId[0]

  rse.linkBattleWins = GetCappedGameStat(K.GAME_STAT_LINK_BATTLE_WINS, 9999);
  rse.linkBattleLosses = GetCappedGameStat(K.GAME_STAT_LINK_BATTLE_LOSSES, 9999);
  rse.pokemonTrades = GetCappedGameStat(K.GAME_STAT_POKEMON_TRADES, 0xffff);

  rse.battleTowerWins = 0;
  rse.battleTowerStraightWins = 0;
  rse.contestsWithFriends = 0;
  rse.pokeblocksWithFriends = 0;

  rse.hasAllPaintings = false;

  rse.money = state.money;

  for (let i = 0; i < TRAINER_CARD_PROFILE_LENGTH; i++) rse.easyChatProfile[i] = state.easyChatProfile[i]; // only a link card prints it

  rse.playerName = [...charmap.encodePlain(state.playerName), EOS];

  if (cardType === CARD_TYPE_FRLG) {
    rse.stars = GetTrainerStarCount(trainerCard);
  } else if (cardType === CARD_TYPE_RSE) {
    rse.stars = 0;
    if (rse.hofDebutHours !== 0 || rse.hofDebutMinutes !== 0 || rse.hofDebutSeconds !== 0) rse.stars = cardType;
    if (HasAllKantoMons(state)) rse.stars++;
    if (HasAllMons(state)) rse.stars++;
  }
}

/** GetTrainerStarCount */
function GetTrainerStarCount(trainerCard: TrainerCard): number {
  const rse = trainerCard.rse;
  let stars = 0;
  if (rse.hofDebutHours !== 0 || rse.hofDebutMinutes !== 0 || rse.hofDebutSeconds !== 0) stars++;
  if (rse.caughtAllHoenn) stars++;
  if (rse.battleTowerStraightWins > 49) stars++;
  if (rse.hasAllPaintings) stars++;
  return stars;
}

/**
 * TrainerCard_GenerateCardForLinkPlayer: the card ShowPlayerTrainerCard shows. FRLG stars: the Hall of Fame, every
 * Kanto mon, every mon (HasAllMons), 200 berries picked and 200 jumps in a row (Dodrio Berry Picking and Pokémon
 * Jump are link minigames: always 0 here).
 */
export function TrainerCard_GenerateCardForLinkPlayer(trainerCard: TrainerCard): void {
  trainerCard.version = K.VERSION_FIRE_RED; // GAME_VERSION
  SetPlayerCardData(trainerCard, CARD_TYPE_RSE);
  if (GetCardType() !== CARD_TYPE_FRLG) return;

  const rse = trainerCard.rse;
  rse.stars = 0;
  if (rse.hofDebutHours !== 0 || rse.hofDebutMinutes !== 0 || rse.hofDebutSeconds !== 0) rse.stars = 1;

  rse.caughtAllHoenn = HasAllKantoMons(state);
  trainerCard.hasAllMons = HasAllMons(state);
  trainerCard.berriesPicked = 0; // gSaveBlock2Ptr->berryPick.berriesPicked
  trainerCard.jumpsInRow = 0; // gSaveBlock2Ptr->pokeJump.jumpsInRow

  trainerCard.berryCrushPoints = GetCappedGameStat(K.GAME_STAT_BERRY_CRUSH_POINTS, 0xffff);
  trainerCard.unionRoomNum = GetCappedGameStat(K.GAME_STAT_NUM_UNION_ROOM_BATTLES, 0xffff);
  trainerCard.shouldDrawStickers = true;

  if (rse.caughtAllHoenn) rse.stars++;
  if (trainerCard.hasAllMons) rse.stars++;
  if (trainerCard.berriesPicked >= 200 && trainerCard.jumpsInRow >= 200) rse.stars++;

  // facilityClass (sLinkTrainerPicFacilityClasses by trainer id): only a link card's pic uses it.

  trainerCard.stickers[0] = state.getVar('VAR_HOF_BRAG_STATE');
  trainerCard.stickers[1] = state.getVar('VAR_EGG_BRAG_STATE');
  trainerCard.stickers[2] = state.getVar('VAR_LINK_WIN_BRAG_STATE');

  trainerCard.monIconTint = state.getVar('VAR_TRAINER_CARD_MON_ICON_TINT_IDX');

  // (UpdateTrainerCardPhotoIcons, the Celadon Game Corner photo, stores them as mail species)
  for (let i = 0; i < PARTY_SIZE; i++) trainerCard.monSpecies[i] = MailSpeciesToIconSpecies(state.getVar(`VAR_TRAINER_CARD_MON_ICON_${i + 1}`));
}

/** SetDataFromTrainerCard */
function SetDataFromTrainerCard(): void {
  const d = sd();
  const rse = d.trainerCard.rse;
  d.hasPokedex = false;
  d.hasHofResult = false;
  d.hasLinkResults = false;
  d.hasBattleTowerWins = false;
  d.hasTrades = false;

  d.hasBadge.fill(false);
  if (rse.hasPokedex) d.hasPokedex = true;
  if (rse.hofDebutHours !== 0 || rse.hofDebutMinutes !== 0 || rse.hofDebutSeconds !== 0) d.hasHofResult = true;
  if (rse.linkBattleWins !== 0 || rse.linkBattleLosses !== 0) d.hasLinkResults = true;
  if (rse.pokemonTrades !== 0) d.hasTrades = true;

  for (let i = 0, badgeFlag = K.FLAG_BADGE01_GET; badgeFlag <= K.FLAG_BADGE08_GET; badgeFlag++, i++) {
    if (state.getFlag(badgeFlag)) d.hasBadge[i] = true;
  }
}

/** HandleGpuRegs */
function HandleGpuRegs(): void {
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_OBJ_ON | DISPCNT_OBJ_1D_MAP | DISPCNT_BG_ALL_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ);
  // (as in the C: the stray WININ bits make these 0-160 and 0-240, the whole screen)
  SetGpuReg(REG_OFFSET_WIN0V, WININ_WIN0_CLR | WIN_RANGE(0, 0x80));
  SetGpuReg(REG_OFFSET_WIN0H, WININ_WIN0_CLR | WININ_WIN0_OBJ | WIN_RANGE(0, 0xc0));
  // EnableInterrupts(INTR_FLAG_VBLANK | INTR_FLAG_HBLANK): the port runs every callback
}

/** UpdateCardFlipRegs: part of animating the card flip. */
function UpdateCardFlipRegs(cardTop: number): void {
  const d = sd();
  let blendY = Math.trunc((cardTop + 40) / 10); // s8
  if (blendY <= 4) blendY = 0;
  d.flipBlendY = blendY;
  SetGpuReg(REG_OFFSET_BLDY, d.flipBlendY);
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(d.cardTop, 160 - d.cardTop));
}

/** ResetGpuRegs */
function ResetGpuRegs(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
}

/** TrainerCardNull */
function TrainerCardNull(): void {}

/** DmaClearOam: OAM is ResetSpriteData's (the PPU reads the OAM buffer) */
function DmaClearOam(): void {}

/** DmaClearPltt */
function DmaClearPltt(): void {
  pltt.fill(0);
}

/** ResetBgRegs */
function ResetBgRegs(): void {
  for (const reg of [REG_OFFSET_BG0CNT, REG_OFFSET_BG1CNT, REG_OFFSET_BG2CNT, REG_OFFSET_BG3CNT]) SetGpuReg(reg, 0);
  for (const reg of [REG_OFFSET_BG0HOFS, REG_OFFSET_BG0VOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_BG2HOFS, REG_OFFSET_BG2VOFS, REG_OFFSET_BG3HOFS, REG_OFFSET_BG3VOFS]) {
    SetGpuReg(reg, 0);
  }
}

/** InitBgsAndWindows */
function InitBgsAndWindows(): void {
  ResetSpriteData();
  ResetPaletteFade();
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sTrainerCardBgTemplates, sTrainerCardBgTemplates.length);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  InitWindows(sTrainerCardWindowTemplates);
  DeactivateAllTextPrinters();
}

/** SetTrainerCardCB2 */
function SetTrainerCardCB2(): void {
  SetMainCallback2(CB2_TrainerCard);
  // SetHelpContext(HELPCONTEXT_TRAINER_CARD_FRONT): no help system
}

/** SetUpTrainerCardTask */
function SetUpTrainerCardTask(): void {
  ResetTasks();
  ScanlineEffect_Stop();
  CreateTask(Task_TrainerCard, 0);
  InitTrainerCardData();
  SetDataFromTrainerCard();
}

// ------------------------------------------------------------------ the front

/** PrintAllOnCardFront */
function PrintAllOnCardFront(): boolean {
  const d = sd();
  switch (d.printState) {
    case 0:
      PrintNameOnCardFront();
      break;
    case 1:
      PrintIdOnCard();
      break;
    case 2:
      PrintMoneyOnCard();
      break;
    case 3:
      PrintPokedexOnCard();
      break;
    case 4:
      PrintTimeOnCard();
      break;
    case 5:
      PrintProfilePhraseOnCard();
      break;
    default:
      d.printState = 0;
      return true;
  }
  d.printState++;
  return false;
}

/** PrintAllOnCardBack */
function PrintAllOnCardBack(): boolean {
  const d = sd();
  switch (d.printState) {
    case 0:
      PrintNameOnCardBack();
      break;
    case 1:
      PrintHofDebutTimeOnCard();
      break;
    case 2:
      PrintLinkBattleResultsOnCard();
      break;
    case 3:
      PrintTradesStringOnCard();
      break;
    case 4:
      PrintBerryCrushStringOnCard();
      break;
    case 5:
      PrintUnionStringOnCard();
      break;
    case 6:
      PrintPokemonIconsOnCard();
      break;
    case 7:
      PrintStickersOnCard();
      break;
    default:
      d.printState = 0;
      return true;
  }
  d.printState++;
  return false;
}

/** BufferTextForCardBack */
function BufferTextForCardBack(): void {
  BufferNameForCardBack();
  BufferHofDebutTime();
  BufferLinkBattleResults();
  BufferNumTrades();
  BufferBerryCrushPoints();
  BufferUnionRoomStats();
}

/** PrintNameOnCardFront (ConvertInternationalString: English to English is a no-op) */
function PrintNameOnCardFront(): void {
  const d = sd();
  const buffer = concat(text('gText_TrainerCardName'), d.trainerCard.rse.playerName);
  d.printed.name = buffer;
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardFrontNameXPositions[d.cardType], sTrainerCardFrontNameYPositions[d.cardType], sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
}

/** PrintIdOnCard */
function PrintIdOnCard(): void {
  const d = sd();
  const buffer = concat(text('gText_TrainerCardIDNo'), ConvertIntToDecimalStringN(d.trainerCard.rse.trainerId, STR_CONV_MODE_LEADING_ZEROS, 5));
  d.printed.id = buffer;
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardIdXPositions[d.cardType], sTrainerCardIdYPositions[d.cardType], sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
}

/** StringLength */
function StringLength(s: number[]): number {
  const n = s.indexOf(EOS);
  return n < 0 ? s.length : n;
}

/** PrintMoneyOnCard */
function PrintMoneyOnCard(): void {
  const d = sd();
  const buffer = concat(text('gText_TrainerCardYen'), ConvertIntToDecimalStringN(d.trainerCard.rse.money, STR_CONV_MODE_LEFT_ALIGN, 6));
  d.printed.money = buffer;
  if (d.cardType !== CARD_TYPE_RSE) {
    const x = (-122 - 6 * StringLength(buffer)) & 0xff; // u8
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 20, 56, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardMoney'));
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], x, 56, sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
  } else {
    const x = (118 - 6 * StringLength(buffer)) & 0xff;
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 16, 57, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardMoney'));
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], x, 57, sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
  }
}

/** PrintPokedexOnCard: only once the player has the Pokédex. */
function PrintPokedexOnCard(): void {
  const d = sd();
  if (!state.getFlag('FLAG_SYS_POKEDEX_GET')) return;
  const buffer = ConvertIntToDecimalStringN(d.trainerCard.rse.caughtMonsCount, STR_CONV_MODE_LEFT_ALIGN, 3);
  d.printed.pokedex = buffer;
  if (d.cardType !== CARD_TYPE_RSE) {
    const x = (-120 - 6 * StringLength(buffer)) & 0xff; // u8
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 20, 72, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardPokedex'));
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], x, 72, sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 138, 72, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardNull'));
  } else {
    const x = (120 - 6 * StringLength(buffer)) & 0xff;
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 16, 73, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardPokedex'));
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], x, 73, sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 138, 73, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardNull'));
  }
}

/** PrintTimeOnCard: the live play time (a link card shows the partner's). */
function PrintTimeOnCard(): void {
  const d = sd();
  let hours = state.playTime.hours;
  let minutes = state.playTime.minutes;
  if (d.isLink) {
    hours = d.trainerCard.rse.playTimeHours;
    minutes = d.trainerCard.rse.playTimeMinutes;
  }
  if (hours > 999) hours = 999;
  if (minutes > 59) minutes = 59;

  const t = d.cardType;
  FillWindowPixelRect(1, PIXEL_FILL(0), sTrainerCardTimeHoursXPositions[t], sTrainerCardTimeMinutesYPositions[t], 50, 12);
  if (t !== CARD_TYPE_RSE) AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 20, 88, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardTime'));
  else AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 16, 89, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_TrainerCardTime'));

  let buffer = ConvertIntToDecimalStringN(hours, STR_CONV_MODE_RIGHT_ALIGN, 3);
  d.printed.hours = buffer;
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardTimeHoursXPositions[t], sTrainerCardTimeMinutesYPositions[t], sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
  AddTextPrinterParameterized3(
    1,
    sTrainerCardFontIds[1],
    sTrainerCardTimeHoursYPositions[t],
    sTrainerCardTimeMinutesYPositions[t],
    sTimeColonTextColors[d.timeColonInvisible ? 1 : 0],
    TEXT_SKIP_DRAW,
    text('gText_Colon2'),
  );

  buffer = ConvertIntToDecimalStringN(minutes, STR_CONV_MODE_LEADING_ZEROS, 2);
  d.printed.minutes = buffer;
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardTimeMinutesXPositions[t], sTrainerCardTimeMinutesYPositions[t], sTrainerCardTextColors, TEXT_SKIP_DRAW, buffer);
}

/** PrintProfilePhraseOnCard: only a link card shows the easy chat profile. */
function PrintProfilePhraseOnCard(): void {
  if (sd().isLink) console.warn('[trainer_card] the link card profile phrase is not implemented');
}

// ------------------------------------------------------------------ the back

/** BufferNameForCardBack (ConvertInternationalString: English to English is a no-op) */
function BufferNameForCardBack(): void {
  const d = sd();
  let name = concat(d.trainerCard.rse.playerName);
  if (d.cardType === CARD_TYPE_RSE) name = concat(name, text('gText_Var1sTrainerCard'));
  d.strings[TRAINER_CARD_STRING_NAME] = name;
}

/** PrintNameOnCardBack: "<name>'s TRAINER CARD" on the Hoenn card is right-aligned (not ported: no RSE card). */
function PrintNameOnCardBack(): void {
  const d = sd();
  const name = d.strings[TRAINER_CARD_STRING_NAME];
  d.printed.backName = name;
  if (d.cardType === CARD_TYPE_FRLG) {
    AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardBackNameXPositions[d.cardType], sTrainerCardBackNameYPositions[d.cardType], sTrainerCardTextColors, TEXT_SKIP_DRAW, name);
  } else {
    console.warn('[trainer_card] the Hoenn card back is not implemented');
  }
}

/** BufferHofDebutTime: "hhh:mm:ss" (the hours right-aligned to 3). */
function BufferHofDebutTime(): void {
  const d = sd();
  if (!d.hasHofResult) return;
  const rse = d.trainerCard.rse;
  d.strings[TRAINER_CARD_STRING_HOF_TIME] = concat(
    ConvertIntToDecimalStringN(rse.hofDebutHours, STR_CONV_MODE_RIGHT_ALIGN, 3),
    text('gText_Colon2'),
    ConvertIntToDecimalStringN(rse.hofDebutMinutes, STR_CONV_MODE_LEADING_ZEROS, 2),
    text('gText_Colon2'),
    ConvertIntToDecimalStringN(rse.hofDebutSeconds, STR_CONV_MODE_LEADING_ZEROS, 2),
  );
}

/** PrintHofDebutTimeOnCard: only after the Hall of Fame. */
function PrintHofDebutTimeOnCard(): void {
  const d = sd();
  if (!d.hasHofResult) return;
  d.printed.hofDebut = d.strings[TRAINER_CARD_STRING_HOF_TIME];
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardHofDebutXPositions[d.cardType], 35, sTrainerCardTextColors, TEXT_SKIP_DRAW, text('gText_HallOfFameDebut'));
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 164, 35, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_HOF_TIME]);
}

/** BufferLinkBattleResults */
function BufferLinkBattleResults(): void {
  const d = sd();
  if (!d.hasLinkResults) return;
  d.strings[TRAINER_CARD_STRING_LINK_RECORD] = text(sLinkTrainerCardRecordStrings[d.cardType]);
  d.strings[TRAINER_CARD_STRING_WIN_LOSS] = text('gText_WinLossRatio');
  d.strings[TRAINER_CARD_STRING_LINK_WINS] = ConvertIntToDecimalStringN(d.trainerCard.rse.linkBattleWins, STR_CONV_MODE_RIGHT_ALIGN, 4);
  d.strings[TRAINER_CARD_STRING_LINK_LOSSES] = ConvertIntToDecimalStringN(d.trainerCard.rse.linkBattleLosses, STR_CONV_MODE_RIGHT_ALIGN, 4);
}

/** PrintLinkBattleResultsOnCard: only with a link battle won or lost. */
function PrintLinkBattleResultsOnCard(): void {
  const d = sd();
  if (!d.hasLinkResults) return;
  const x = sTrainerCardHofDebutXPositions[d.cardType];
  d.printed.linkRecord = concat(d.strings[TRAINER_CARD_STRING_LINK_WINS], d.strings[TRAINER_CARD_STRING_LINK_LOSSES]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], x, 51, sTrainerCardTextColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_LINK_RECORD]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 130, 51, sTrainerCardTextColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_WIN_LOSS]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 144, 51, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_LINK_WINS]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 192, 51, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_LINK_LOSSES]);
}

/** BufferNumTrades */
function BufferNumTrades(): void {
  const d = sd();
  if (!d.hasTrades) return;
  d.strings[TRAINER_CARD_STRING_TRADES] = text('gText_PokemonTrades');
  d.strings[TRAINER_CARD_STRING_TRADE_COUNT] = ConvertIntToDecimalStringN(d.trainerCard.rse.pokemonTrades, STR_CONV_MODE_RIGHT_ALIGN, 5);
}

/** PrintTradesStringOnCard: only with a trade made. */
function PrintTradesStringOnCard(): void {
  const d = sd();
  if (!d.hasTrades) return;
  d.printed.trades = d.strings[TRAINER_CARD_STRING_TRADE_COUNT];
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardHofDebutXPositions[d.cardType], 67, sTrainerCardTextColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_TRADES]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 186, 67, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_TRADE_COUNT]);
}

/** BufferBerryCrushPoints */
function BufferBerryCrushPoints(): void {
  const d = sd();
  if (d.cardType === CARD_TYPE_RSE) return;
  d.strings[TRAINER_CARD_STRING_BERRY_CRUSH] = text('gText_BerryCrushes');
  d.strings[TRAINER_CARD_STRING_BERRY_CRUSH_COUNT] = ConvertIntToDecimalStringN(d.trainerCard.berryCrushPoints, STR_CONV_MODE_RIGHT_ALIGN, 5);
}

/** PrintBerryCrushStringOnCard: only with Berry Crush points. */
function PrintBerryCrushStringOnCard(): void {
  const d = sd();
  if (d.cardType === CARD_TYPE_RSE || !d.trainerCard.berryCrushPoints) return;
  d.printed.berryCrush = d.strings[TRAINER_CARD_STRING_BERRY_CRUSH_COUNT];
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardHofDebutXPositions[d.cardType], 99, sTrainerCardTextColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_BERRY_CRUSH]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 186, 99, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_BERRY_CRUSH_COUNT]);
}

/** BufferUnionRoomStats */
function BufferUnionRoomStats(): void {
  const d = sd();
  if (d.cardType === CARD_TYPE_RSE) return;
  d.strings[TRAINER_CARD_STRING_UNION_ROOM] = text('gText_UnionRoomTradesBattles');
  d.strings[TRAINER_CARD_STRING_UNION_ROOM_NUM] = ConvertIntToDecimalStringN(d.trainerCard.unionRoomNum, STR_CONV_MODE_RIGHT_ALIGN, 5);
}

/** PrintUnionStringOnCard: only with Union Room trades or battles. */
function PrintUnionStringOnCard(): void {
  const d = sd();
  if (d.cardType === CARD_TYPE_RSE || !d.trainerCard.unionRoomNum) return;
  d.printed.unionRoom = d.strings[TRAINER_CARD_STRING_UNION_ROOM_NUM];
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], sTrainerCardHofDebutXPositions[d.cardType], 83, sTrainerCardTextColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_UNION_ROOM]);
  AddTextPrinterParameterized3(1, sTrainerCardFontIds[1], 186, 83, sTrainerCardStatColors, TEXT_SKIP_DRAW, d.strings[TRAINER_CARD_STRING_UNION_ROOM_NUM]);
}

/** PrintPokemonIconsOnCard: the photo's mons (Celadon Game Corner's printer), 4x4 tiles each along row 15 of BG3. */
function PrintPokemonIconsOnCard(): void {
  const d = sd();
  if (d.cardType === CARD_TYPE_RSE) return;
  for (let i = 0; i < PARTY_SIZE; i++) {
    if (d.trainerCard.monSpecies[i]) {
      const palIndex = GetMonIconPaletteIndexFromSpecies(d.trainerCard.monSpecies[i]);
      WriteSequenceToBgTilemapBuffer(3, 16 * i + 224, sPokemonIconXOffsets[i] + 3, 15, 4, 4, sPokemonIconPalSlots[palIndex], 1);
    }
  }
}

/**
 * LoadMonIconGfx: the icon palettes, tinted as the photo was printed, into BG palettes 5-10, and each photo mon's
 * first icon frame (SPECIES_NONE's "?" for an empty slot) into BG3 tiles 224 + 16 * i. The C copies 96 colours from
 * gMonIconPalettes, which has 48: the rest (palettes 8-10, read past it in the ROM) are never used by an icon, and the
 * trainer pic's palette replaces 8. They're zeros here.
 */
function LoadMonIconGfx(): void {
  const d = sd();
  d.monIconPals.fill(0);
  d.monIconPals.set(gfx16('gMonIconPalettes').subarray(0, 48));
  switch (d.trainerCard.monIconTint) {
    case MON_ICON_TINT_NORMAL:
      break;
    case MON_ICON_TINT_BLACK:
      TintPalette_CustomTone(d.monIconPals, 96, 0, 0, 0);
      break;
    case MON_ICON_TINT_PINK:
      TintPalette_CustomTone(d.monIconPals, 96, 500, 330, 310);
      break;
    case MON_ICON_TINT_SEPIA:
      TintPalette_SepiaTone(d.monIconPals, 96);
      break;
  }
  LoadPalette(d.monIconPals, BG_PLTT_ID(5), d.monIconPals.length * 2);
  for (let i = 0; i < PARTY_SIZE; i++) LoadBgTiles(3, GetMonIconTiles(d.trainerCard.monSpecies[i], false), 512, 16 * i + 32);
}

/** PrintStickersOnCard: the Four Island sticker man's stickers (the brag vars: 0 none, else the sticker's palette). */
function PrintStickersOnCard(): void {
  const d = sd();
  if (d.cardType !== CARD_TYPE_FRLG || !d.trainerCard.shouldDrawStickers) return;
  for (let i = 0; i < TRAINER_CARD_STICKER_TYPES; i++) {
    const sticker = d.trainerCard.stickers[i];
    if (sticker) WriteSequenceToBgTilemapBuffer(3, i * 4 + 320, i * 3 + 2, 2, 2, 2, sStickerPalSlots[sticker - 1] ?? 0, 1);
  }
}

/**
 * LoadStickerGfx. LoadBgTiles reads 1024 bytes from stickerTiles (512 bytes long), so the second half is the start
 * of cardTiles, which follows it in the struct; those tiles (336+) are never shown.
 */
function LoadStickerGfx(): void {
  const d = sd();
  LoadPalette(gfx16('sTrainerCardStickerPal1'), BG_PLTT_ID(11), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sTrainerCardStickerPal2'), BG_PLTT_ID(12), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sTrainerCardStickerPal3'), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sTrainerCardStickerPal4'), BG_PLTT_ID(14), PLTT_SIZE_4BPP);
  const src = new Uint8Array(1024);
  src.set(d.stickerTiles);
  src.set(d.cardTiles.subarray(0, 1024 - d.stickerTiles.length), d.stickerTiles.length);
  LoadBgTiles(3, src, 1024, 128);
}

/** DrawTrainerCardWindow */
function DrawTrainerCardWindow(windowId: number): void {
  PutWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_FULL);
}

/** SetTrainerCardBgsAndPals (CARD_TYPE_FRLG) */
function SetTrainerCardBgsAndPals(): boolean {
  const d = sd();
  switch (d.bgPalLoadState) {
    case 0:
      LoadBgTiles(3, d.badgeTiles, d.badgeTiles.length, 0);
      break;
    case 1:
      LoadBgTiles(0, d.cardTiles, 0x1800, 0);
      break;
    case 2:
      LoadPalette(gfx16(sKantoTrainerCardPals[d.trainerCard.rse.stars]), BG_PLTT_ID(0), 3 * PLTT_SIZE_4BPP);
      break;
    case 3:
      LoadPalette(gfx16('sKantoTrainerCardBadges_Pal'), BG_PLTT_ID(3), PLTT_SIZE_4BPP);
      break;
    case 4:
      if (d.trainerCard.rse.gender !== K.MALE) LoadPalette(gfx16('sKantoTrainerCardFemaleBg_Pal'), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      break;
    case 5:
      LoadPalette(gfx16('sTrainerCardStar_Pal'), BG_PLTT_ID(4), PLTT_SIZE_4BPP);
      break;
    case 6:
      SetBgTilemapBuffer(0, d.cardTilemapBuffer);
      SetBgTilemapBuffer(2, d.bgTilemapBuffer);
      break;
    default:
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 32, 32);
      FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 32, 32);
      FillBgTilemapBufferRect_Palette0(3, 0, 0, 0, 32, 32);
      return true;
  }
  d.bgPalLoadState++;
  return false;
}

/** The 30x20 tilemaps into a 32-wide buffer, the two extra columns filled with the first entry. */
function copyCardTilemap(src: Uint16Array, dst: Uint16Array): void {
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 32; j++) dst[32 * i + j] = j < 30 ? src[30 * i + j] : src[0];
  }
}

/** DrawCardScreenBackground */
function DrawCardScreenBackground(ptr: Uint16Array): void {
  copyCardTilemap(ptr, sd().bgTilemapBuffer);
  CopyBgTilemapBufferToVram(2);
}

/** DrawCardFrontOrBack */
function DrawCardFrontOrBack(ptr: Uint16Array): void {
  copyCardTilemap(ptr, sd().cardTilemapBuffer);
  CopyBgTilemapBufferToVram(0);
}

/** DrawStarsAndBadgesOnCard: the stars (tile 143) right of the name, each badge's 2x2 tiles along the bottom. */
function DrawStarsAndBadgesOnCard(): void {
  const d = sd();
  let tileNum = 192;
  const palNum = 3;
  FillBgTilemapBufferRect(3, 143, 15, sStarYOffsets[d.cardType], d.trainerCard.rse.stars, 1, 4);
  if (!d.isLink) {
    for (let i = 0, x = 4; i < NUM_BADGES; i++, tileNum += 2, x += 3) {
      if (d.hasBadge[i]) {
        FillBgTilemapBufferRect(3, tileNum, x, 16, 1, 1, palNum);
        FillBgTilemapBufferRect(3, tileNum + 1, x + 1, 16, 1, 1, palNum);
        FillBgTilemapBufferRect(3, tileNum + 16, x, 17, 1, 1, palNum);
        FillBgTilemapBufferRect(3, tileNum + 17, x + 1, 17, 1, 1, palNum);
      }
    }
  }
  CopyBgTilemapBufferToVram(3);
}

/** DrawCardBackStats: the stat lines' end tiles (none for the player: trades, Berry Crush and Union Room are 0). */
function DrawCardBackStats(): void {
  const d = sd();
  if (d.cardType !== CARD_TYPE_RSE) {
    if (d.hasTrades) {
      FillBgTilemapBufferRect(3, 141, 26, 9, 1, 1, 1);
      FillBgTilemapBufferRect(3, 157, 26, 10, 1, 1, 1);
    }
    if (d.trainerCard.berryCrushPoints) {
      FillBgTilemapBufferRect(3, 141, 21, 13, 1, 1, 1);
      FillBgTilemapBufferRect(3, 157, 21, 14, 1, 1, 1);
    }
    if (d.trainerCard.unionRoomNum) {
      FillBgTilemapBufferRect(3, 141, 27, 11, 1, 1, 1);
      FillBgTilemapBufferRect(3, 157, 27, 12, 1, 1, 1);
    }
  } else if (d.hasTrades) {
    FillBgTilemapBufferRect(3, 141, 26, 9, 1, 1, 0);
    FillBgTilemapBufferRect(3, 157, 26, 10, 1, 1, 0);
  }
  CopyBgTilemapBufferToVram(3);
}

/** BlinkTimeColon (VBlank): the colon toggles every 61 frames. */
function BlinkTimeColon(): void {
  // The VBlank after CloseTrainerCard still runs this callback; the C reads the freed struct there.
  const d = sTrainerCardDataPtr;
  if (!d) return;
  if (++d.timeColonBlinkTimer > 60) {
    d.timeColonBlinkTimer = 0;
    d.timeColonInvisible = !d.timeColonInvisible;
    d.timeColonNeedDraw = true;
  }
}

// ------------------------------------------------------------------ the flip

const tFlipState = 0;
const tCardTop = 1;

type FlipFunc = (task: Task) => boolean;

/** FlipTrainerCard */
function FlipTrainerCard(): void {
  const taskId = CreateTask(Task_DoCardFlipTask, 0);
  Task_DoCardFlipTask(taskId);
  SetHBlankCB_TrainerCard(true); // SetHBlankCallback(HBlankCB_TrainerCard)
}

/** IsCardFlipTaskActive: TRUE once the flip task is gone (sic). */
function IsCardFlipTaskActive(): boolean {
  return FindTaskIdByFunc(Task_DoCardFlipTask) === TASK_NONE;
}

/** Task_DoCardFlipTask: every step returns FALSE, so one step per frame. */
function Task_DoCardFlipTask(taskId: number): void {
  const task = gTasks[taskId];
  while (sTrainerCardFlipTasks[task.data[tFlipState]](task));
}

/** Task_BeginCardFlip */
function Task_BeginCardFlip(task: Task): boolean {
  HideBg(1);
  HideBg(3);
  ScanlineEffect_Stop();
  ScanlineEffect_Clear();
  gScanlineEffectRegBuffers[1].fill(0, 0, 160);
  task.data[tFlipState]++;
  return false;
}

/**
 * The squash both ways (Task_AnimateCardFlipDown / Up, in their u32 arithmetic): the card's rows between cardTop and
 * 160 - cardTop show the whole card, `down` packing rows tighter towards the bottom, up towards the top.
 */
function SetCardFlipScanlines(cardTop: number, down: boolean): void {
  const buf = gScanlineEffectRegBuffers[0];
  const r7 = cardTop;
  const r9 = 160 - r7;
  const r4 = r9 - r7;
  let r6 = (-r7 << 16) >>> 0;
  let r5 = (Math.floor(0xa00000 / r4) + 0xffff0000) >>> 0;
  const var24 = (r6 + Math.imul(r5, r4)) >>> 0;
  const r10 = Math.floor(r5 / r4);
  r5 = down ? (r5 * 2) >>> 0 : r5 >>> 1;
  let i = 0;
  for (; i < r7; i++) buf[i] = -i;
  for (; i < r9; i++) {
    buf[i] = r6 >>> 16;
    r6 = (r6 + r5) >>> 0;
    r5 = (down ? r5 - r10 : r5 + r10) >>> 0;
  }
  for (; i < 160; i++) buf[i] = var24 >>> 16;
}

/** Task_AnimateCardFlipDown: the card closes 7 lines from each edge per frame, to a line at 77. */
function Task_AnimateCardFlipDown(task: Task): boolean {
  const d = sd();
  d.allowDMACopy = false;
  if (task.data[tCardTop] >= 77) task.data[tCardTop] = 77;
  else task.data[tCardTop] += 7;
  d.cardTop = task.data[tCardTop];
  UpdateCardFlipRegs(task.data[tCardTop]);
  SetCardFlipScanlines(task.data[tCardTop], true);
  d.allowDMACopy = true;
  if (task.data[tCardTop] >= 77) task.data[tFlipState]++;
  return false;
}

/** Task_DrawFlippedCardSide: the other side's text and tiles, one print a frame (no link, so no waiting on it). */
function Task_DrawFlippedCardSide(task: Task): boolean {
  const d = sd();
  d.allowDMACopy = false;
  for (;;) {
    switch (d.flipDrawState) {
      case 0:
        FillWindowPixelBuffer(1, PIXEL_FILL(0));
        FillBgTilemapBufferRect_Palette0(3, 0, 0, 0, 32, 32);
        break;
      case 1:
        if (!d.onBack) {
          if (!PrintAllOnCardBack()) return false;
        } else if (!PrintAllOnCardFront()) {
          return false;
        }
        break;
      case 2:
        if (!d.onBack) DrawCardFrontOrBack(d.backTilemap);
        else DrawTrainerCardWindow(1);
        break;
      case 3:
        if (!d.onBack) DrawCardBackStats();
        else FillWindowPixelBuffer(2, PIXEL_FILL(0));
        break;
      case 4:
        if (d.onBack) CreateTrainerCardTrainerPic();
        break;
      default:
        task.data[tFlipState]++;
        d.allowDMACopy = true;
        d.flipDrawState = 0;
        return false;
    }
    d.flipDrawState++;
  }
}

/** Task_SetCardFlipped: going to the front, its BGs are drawn again here. */
function Task_SetCardFlipped(task: Task): boolean {
  const d = sd();
  d.allowDMACopy = false;
  if (d.onBack) {
    DrawTrainerCardWindow(2);
    DrawCardScreenBackground(d.bgTilemap);
    DrawCardFrontOrBack(d.frontTilemap);
    DrawStarsAndBadgesOnCard();
  }
  DrawTrainerCardWindow(1);
  d.onBack = !d.onBack;
  task.data[tFlipState]++;
  d.allowDMACopy = true;
  PlaySE(K.SE_CARD_FLIPPING);
  return false;
}

/** Task_AnimateCardFlipUp: the card opens 5 lines per frame. */
function Task_AnimateCardFlipUp(task: Task): boolean {
  const d = sd();
  d.allowDMACopy = false;
  if (task.data[tCardTop] <= 5) task.data[tCardTop] = 0;
  else task.data[tCardTop] -= 5;
  d.cardTop = task.data[tCardTop];
  UpdateCardFlipRegs(task.data[tCardTop]);
  SetCardFlipScanlines(task.data[tCardTop], false);
  d.allowDMACopy = true;
  if (task.data[tCardTop] <= 0) task.data[tFlipState]++;
  return false;
}

/** Task_EndCardFlip */
function Task_EndCardFlip(_task: Task): boolean {
  ShowBg(1);
  ShowBg(3);
  SetHBlankCB_TrainerCard(false); // SetHBlankCallback(NULL)
  DestroyTask(FindTaskIdByFunc(Task_DoCardFlipTask));
  return false;
}

const sTrainerCardFlipTasks: FlipFunc[] = [Task_BeginCardFlip, Task_AnimateCardFlipDown, Task_DrawFlippedCardSide, Task_SetCardFlipped, Task_AnimateCardFlipUp, Task_EndCardFlip];

// ------------------------------------------------------------------ open

/**
 * ShowPlayerTrainerCard: the start menu's PLAYER (StartMenuPlayerCallback, with CB2_ReturnToFieldWithOpenMenu).
 * InUnionRoom() is never TRUE in the port, so it's never a link card.
 */
export function ShowPlayerTrainerCard(callback: MainCallback): void {
  sTrainerCardDataPtr = {
    mainState: 0,
    printState: 0,
    gfxLoadState: 0,
    bgPalLoadState: 0,
    flipDrawState: 0,
    isLink: false,
    timeColonBlinkTimer: 0,
    timeColonInvisible: false,
    onBack: false,
    allowDMACopy: false,
    hasPokedex: false,
    hasHofResult: false,
    hasLinkResults: false,
    hasBattleTowerWins: false,
    hasTrades: false,
    hasBadge: new Array(NUM_BADGES).fill(false),
    easyChatProfile: Array.from({ length: TRAINER_CARD_PROFILE_LENGTH }, () => [EOS]),
    strings: Array.from({ length: TRAINER_CARD_STRING_COUNT }, () => [EOS]),
    monIconPals: new Uint16Array(16 * PARTY_SIZE),
    flipBlendY: 0,
    cardType: CARD_TYPE_FRLG,
    callback2: callback,
    trainerCard: emptyTrainerCard(),
    frontTilemap: new Uint16Array(600),
    backTilemap: new Uint16Array(600),
    bgTilemap: new Uint16Array(600),
    badgeTiles: new Uint8Array(0x80 * NUM_BADGES),
    stickerTiles: new Uint8Array(0x100 * 2),
    cardTiles: new Uint8Array(0x1180 * 2),
    cardTilemapBuffer: new Uint16Array(0x1000),
    bgTilemapBuffer: new Uint16Array(0x1000),
    cardTop: 0,
    timeColonNeedDraw: false,
    language: constant('GAME_LANGUAGE') ?? 0, // (only ConvertInternationalString reads it)
    printed: {},
  };
  TrainerCard_GenerateCardForLinkPlayer(sd().trainerCard);
  SetMainCallback2(CB2_InitTrainerCard);
}

/** InitTrainerCardData */
function InitTrainerCardData(): void {
  const d = sd();
  d.mainState = 0;
  d.timeColonBlinkTimer = state.playTime.vblanks;
  d.timeColonInvisible = false;
  d.onBack = false;
  d.flipBlendY = 0;
  d.cardType = GetCardType() === CARD_TYPE_RSE ? CARD_TYPE_RSE : CARD_TYPE_FRLG;
  for (let i = 0; i < TRAINER_CARD_PROFILE_LENGTH; i++) d.easyChatProfile[i] = [...CopyEasyChatWord(state, d.trainerCard.rse.easyChatProfile[i]), EOS];
}

/** GetCardType */
function GetCardType(): number {
  const version = sTrainerCardDataPtr ? sTrainerCardDataPtr.trainerCard.version : K.VERSION_FIRE_RED; // gGameVersion
  return version === K.VERSION_FIRE_RED || version === K.VERSION_LEAF_GREEN ? CARD_TYPE_FRLG : CARD_TYPE_RSE;
}

/** CreateTrainerCardTrainerPic: the player's front pic into window 2 (BG palette 8). */
function CreateTrainerCardTrainerPic(): void {
  const d = sd();
  const gender = d.trainerCard.rse.gender;
  const [x, y] = sTrainerPicOffsets[d.cardType][gender];
  if (d.cardType !== CARD_TYPE_FRLG) {
    console.warn('[trainer_card] the Hoenn card pic (FacilityClassToPicIndex) is not implemented');
    return;
  }
  CreateTrainerCardTrainerPicSprite(PlayerGenderToFrontTrainerPicId(gender), true, x, y, 8, 2);
}

// ------------------------------------------------------------------ test probe

/** What the card shows, for tests (`__test.trainerCard()`); undefined while it's down. */
export function trainerCardProbe():
  | {
      mainState: number;
      /** The front takes input (STATE_HANDLE_INPUT_FRONT) and no fade runs. */
      ready: boolean;
      /** The back takes input (STATE_HANDLE_INPUT_BACK) and no fade runs. */
      backReady: boolean;
      onBack: boolean;
      /**
       * While Task_DoCardFlipTask runs: its step (tFlipState: 1 closing, 2 drawing the other side, 4 opening), the
       * card's top line, BLDY, and whether BG0VOFS is set per line (the squash) with its offsets on lines 0-159.
       */
      flip: { state: number; cardTop: number; blendY: number; squash: boolean; vofs: number[] } | undefined;
      /** BG0VOFS is set per line (the flip's squash is still on) */
      squashActive: boolean;
      /** BG palette 5 (the first mon icon palette), as the hardware has it */
      iconPalette: number[];
      /** Per photo slot: the icon species, and the BG palette its tiles are drawn with on BG3 (-1 if not drawn) */
      monSpecies: number[];
      drawnIcons: number[];
      /** Per sticker slot: the brag var, and the BG palette its tiles are drawn with on BG3 (-1 if not drawn) */
      stickers: number[];
      drawnStickers: number[];
      cardType: number;
      stars: number;
      /** hasBadge per badge, and which badges' tiles are on BG3 */
      badges: boolean[];
      drawnBadges: boolean[];
      /** How many star tiles (143) BG3 has on the stars' row */
      drawnStars: number;
      /** The card palette in BG palettes 0-2 (the hardware's, so faded in) is sKantoTrainerCardPals[i] */
      cardPalette: number;
      femaleBg: boolean;
      timeColonInvisible: boolean;
      /** Non-transparent pixels in the trainer pic's window */
      picPixels: number;
      printed: TrainerCardData['printed'];
      card: { trainerId: number; money: number; caughtMonsCount: number; hofDebut: number[]; gender: number };
    }
  | undefined {
  const d = sTrainerCardDataPtr;
  if (!d) return undefined;
  const bg3 = GetBgTilemapBuffer(3);
  const entry = (x: number, y: number) => (bg3 ? bg3[y * 32 + x] : 0);
  const drawnBadges = Array.from({ length: NUM_BADGES }, (_, i) => (entry(4 + 3 * i, 16) & 0x3ff) === 192 + 2 * i && entry(4 + 3 * i, 16) >> 12 === 3);
  let drawnStars = 0;
  for (let x = 15; x < 32 && (entry(x, sStarYOffsets[d.cardType]) & 0x3ff) === 143; x++) drawnStars++;
  const cardPalette = sKantoTrainerCardPals.findIndex((sym) => {
    const p = gfx16(sym);
    // BG palette 1 is the female background's for a girl
    return p.subarray(0, 48).every((c, i) => (i >= 16 && i < 32 && d.trainerCard.rse.gender !== K.MALE) || c === pltt[i]);
  });
  const female = gfx16('sKantoTrainerCardFemaleBg_Pal');
  const pic = gWindows[2].tileData;
  let picPixels = 0;
  if (pic) for (const b of pic) picPixels += (b & 0xf ? 1 : 0) + (b >> 4 ? 1 : 0);
  const rse = d.trainerCard.rse;
  const flipTask = FindTaskIdByFunc(Task_DoCardFlipTask);
  const squash = hblankRegs.get(REG_OFFSET_BG0VOFS);
  const drawnAt = (x: number, y: number, tile: number) => ((entry(x, y) & 0x3ff) === tile ? entry(x, y) >> 12 : -1);
  return {
    mainState: d.mainState,
    ready: d.mainState === STATE_HANDLE_INPUT_FRONT && !gPaletteFade.active,
    backReady: d.mainState === STATE_HANDLE_INPUT_BACK && !gPaletteFade.active,
    onBack: d.onBack,
    flip:
      flipTask === TASK_NONE
        ? undefined
        : { state: gTasks[flipTask].data[tFlipState], cardTop: d.cardTop, blendY: d.flipBlendY, squash: squash === gScanlineEffectRegBuffers[1], vofs: squash ? Array.from(squash.subarray(0, 160), (v) => (v << 16) >> 16) : [] },
    squashActive: hblankRegs.has(REG_OFFSET_BG0VOFS),
    iconPalette: Array.from(pltt.subarray(BG_PLTT_ID(5), BG_PLTT_ID(5) + 16)),
    monSpecies: [...d.trainerCard.monSpecies],
    drawnIcons: Array.from({ length: PARTY_SIZE }, (_, i) => drawnAt(sPokemonIconXOffsets[i] + 3, 15, 224 + 16 * i)),
    stickers: [...d.trainerCard.stickers],
    drawnStickers: Array.from({ length: TRAINER_CARD_STICKER_TYPES }, (_, i) => drawnAt(i * 3 + 2, 2, 320 + 4 * i)),
    cardType: d.cardType,
    stars: rse.stars,
    badges: [...d.hasBadge],
    drawnBadges,
    drawnStars,
    cardPalette,
    femaleBg: Array.from({ length: 16 }, (_, i) => pltt[16 + i]).every((c, i) => c === female[i]),
    timeColonInvisible: d.timeColonInvisible,
    picPixels,
    printed: { ...d.printed },
    card: { trainerId: rse.trainerId, money: rse.money, caughtMonsCount: rse.caughtMonsCount, hofDebut: [rse.hofDebutHours, rse.hofDebutMinutes, rse.hofDebutSeconds], gender: rse.gender },
  };
}
