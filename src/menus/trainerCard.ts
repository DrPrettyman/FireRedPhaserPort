// trainer_card.c on the GBA layer: the player's trainer card from the start menu's PLAYER (ShowPlayerTrainerCard →
// CB2_InitTrainerCard → Task_TrainerCard; B fades out and CloseTrainerCard hands over to the callback,
// CB2_ReturnToFieldWithOpenMenu). Only CARD_TYPE_FRLG for the player: the Hoenn card (CARD_TYPE_RSE, a partner's
// R/S/E card) and the link cards (ShowTrainerCardInLink, the Union Room) wait for link play.
//
// Ported so far: the card front (name, ID, money, Pokédex, play time with the blinking colon, the stars' card
// colour, the badges, the player's pic). Not yet (W-tcard unit 2): the back (PrintAllOnCardBack, DrawCardBackStats,
// the stickers and mon icons) and the flip (FlipTrainerCard / Task_DoCardFlipTask with its HBlank squash); A on the
// front is a no-op until then.
//
// No audio: the SE_CARD_* calls are no-ops.

import { constant, K } from '../battle/constants';
import { bdata, charmap, state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
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
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { IsSEPlaying, PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, ResetTasks, RunTasks } from '../gba/task';
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
import { CreateTrainerCardTrainerPicSprite, PlayerGenderToFrontTrainerPicId } from './picSprites';

// include/constants/trainer_card.h
const CARD_TYPE_FRLG = 0;
const CARD_TYPE_RSE = 1;
const TRAINER_CARD_PROFILE_LENGTH = 4;
const TRAINER_CARD_STICKER_TYPES = 3;
const NUM_BADGES = 8;
const PARTY_SIZE = 6;

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

/** struct TrainerCardData (the strings for the back, monIconPals and the flip's fields come with unit 2) */
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
  /** Not in the C: what the front printed last, for the test probe. */
  printed: Partial<Record<'name' | 'id' | 'money' | 'pokedex' | 'hours' | 'minutes', number[]>>;
}

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
  ];
}

// ------------------------------------------------------------------ callbacks

/** VBlankCB_TrainerCard */
function VBlankCB_TrainerCard(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  BlinkTimeColon();
  // allowDMACopy (the flip's scanline buffers): unit 2
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
        // TODO(W-tcard unit 2): SetHelpContext(HELPCONTEXT_TRAINER_CARD_BACK); FlipTrainerCard(); PlaySE(SE_CARD_FLIP);
        // d.mainState = STATE_WAIT_FLIP_TO_BACK
      } else if (JOY_NEW(B_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
        d.mainState = STATE_CLOSE_CARD;
      }
      break;
    case STATE_WAIT_FLIP_TO_BACK:
    case STATE_HANDLE_INPUT_BACK:
    case STATE_WAIT_FLIP_TO_FRONT:
      // TODO(W-tcard unit 2): the back and the flip
      break;
    case STATE_CLOSE_CARD:
      if (!UpdatePaletteFade()) CloseTrainerCard(taskId);
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

  // gSaveBlock1Ptr->easyChatProfile: the port has no easy chat; the profile is only printed on a link card.
  for (let i = 0; i < TRAINER_CARD_PROFILE_LENGTH; i++) rse.easyChatProfile[i] = 0;

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

  // MailSpeciesToIconSpecies: the identity for anything but the Unown mail species, which these vars never hold.
  for (let i = 0; i < PARTY_SIZE; i++) trainerCard.monSpecies[i] = state.getVar(`VAR_TRAINER_CARD_MON_ICON_${i + 1}`);
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

/** BufferTextForCardBack: TODO(W-tcard unit 2) the name, Hall of Fame debut and link stats for the back */
function BufferTextForCardBack(): void {}

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

/** LoadMonIconGfx: TODO(W-tcard unit 2) the mon icons' palettes and tiles for the back */
function LoadMonIconGfx(): void {}

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
  // CopyEasyChatWord: no easy chat in the port (only a link card prints the profile)
  for (let i = 0; i < TRAINER_CARD_PROFILE_LENGTH; i++) d.easyChatProfile[i] = [EOS];
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
  return {
    mainState: d.mainState,
    ready: d.mainState === STATE_HANDLE_INPUT_FRONT && !gPaletteFade.active,
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
