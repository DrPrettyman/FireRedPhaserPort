// pokemon_storage_system_tasks.c: the Pokémon Storage System's box screen. EnterPokeStorage runs it for
// one of the PC's options (WITHDRAW / DEPOSIT / MOVE POKéMON / MOVE ITEMS); the screen's flow is a chain of
// tasks (Task_PokeStorageMain and the Task_* it hands over to). The cursor, input and the mon being carried
// are in pokemonStorageCursor.ts (pokemon_storage_system_data.c), the icons, wallpapers and box titles in
// pokemonStorageGraphics.ts, the box-choosing popup in pokemonStorageMenu.ts and the held items / multiple
// moves in pokemonStorageMisc.ts.
//
// gPlayerParty: the C keeps empty party slots while the screen runs (a placed mon can leave a gap until the
// party box closes, CompactPartySlots). The port's party has no empty slots, so the screen works on its own
// six-slot copy (sPlayerParty), loaded when it starts and written back (compacted) when it hands over to
// another screen. Not ported: the quest log events (SetPokeStorageQuestLogEvent), the help context and SEs.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { GetMonSpritePalFromSpeciesAndPersonality, LoadSpecialPokePic, monPalSymbols, monPicSymbol } from '../battle/gfx';
import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, FillBgTilemapBufferRect, FillBgTilemapBufferRect_Palette0, InitBgsFromTemplates, LoadBgTiles, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BG_SCREEN_ADDR,
  BLDALPHA_BLEND,
  BLDCNT_TGT2_ALL,
  DISPCNT_BG_ALL_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  OBJ_VRAM0,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3CNT,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_MOSAIC,
  RGB_BLACK,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_ANY, JOY_NEW, SetKeyRepeatStartDelay, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import {
  ClearScheduledBgCopiesToVram,
  ClearStdWindowAndFrameToTransparent,
  CreateYesNoMenu,
  DoScheduledBgTilemapCopiesToVram,
  DrawTextBorderOuter,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  MENU_B_PRESSED,
  MENU_NOTHING_CHOSEN,
  Menu_MoveCursorNoWrapAround,
  Menu_ProcessInputNoWrapClearOnChoose,
  ScheduleBgCopyTilemapToVram,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { PlaySE } from '../gba/sound';
import {
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  FreeSpritePaletteByTag,
  FreeSpriteTileRanges,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SetReservedSpriteTileCount,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  StartSpriteAnimIfDifferent,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized,
  ClearWindowTilemap,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import type { BoxPokemon } from '../state/PokemonStorage';
import { animTable } from '../battle/gfx';
import { AddBagItem, EOS, ItemIsMail, RemoveBagItem, strBody, text } from './common';
import { CB2_ReturnToField } from './fieldCallbacks';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from './dynamicPlaceholderText';
import { GoToBagMenu } from './itemMenu';
import { SpecialVar } from './itemMenuState';
import { itemIconSymbols } from './itemMenuIcons';
import { BufferMonMarkingsMenuTiles, CreateMonMarkingComboSprite, FreeMonMarkingsMenu, HandleMonMarkingsMenuInput, InitMonMarkingsMenu, newMonMarkingsMenu, OpenMonMarkingsMenu, UpdateMonMarkingTiles, type MonMarkingsMenu } from './monMarkings';
import { DoNamingScreen, NAMING_SCREEN_BOX } from './namingScreen';
import { BeginPCScreenEffect_TurnOff, BeginPCScreenEffect_TurnOn, IsPCScreenEffectRunning_TurnOff, IsPCScreenEffectRunning_TurnOn } from './pcScreenEffect';
import { GetIconSpecies, monIconSymbol } from './pokemonIcon';
import {
  AddMenu,
  CanMovePartyMon,
  CanShiftMon,
  ClearSavedCursorPos,
  DoMonPlaceChange,
  DoTrySetDisplayMonData,
  GetBoxCursorPosition,
  GetMovingMonOriginalBoxId,
  GetSavedCursorPos,
  HandleInput,
  HandleMenuInput,
  InitCanReleaseMonVars,
  InitCursor,
  InitCursorOnReopen,
  InitMenu,
  InitMonPlaceChange,
  InitReleaseMon,
  InitSummaryScreenData,
  IsCursorOnBoxTitle,
  IsCursorOnCloseBox,
  IsMenuLoading,
  IsMonBeingMoved,
  LoadSavedMovingMon,
  ReleaseMon,
  RemoveMenu,
  ResetSelectionAfterDeposit,
  RunCanReleaseMon,
  SaveCursorPos,
  SaveMovingMon,
  SetCursorBoxPosition,
  SetCursorInParty,
  SetMenuText,
  SetMonMarkings,
  SetSelectionAfterSummaryScreen,
  StartCursorAnim,
  StorageCursor,
  TryHideItemAtCursor,
  TryHideReleaseMon,
  TrySetCursorFistAnim,
  TryShowItemAtCursor,
  TryStorePartyMonInBox,
  UpdateCursorPos,
  CompactPartySlots,
} from './pokemonStorageCursor';
import {
  AnimateBoxScrollArrows,
  CompactPartySprites,
  CreateInitBoxTask,
  CreatePartyMonsSprites,
  DestroyAllPartyMonIcons,
  DoReleaseMonComeBackAnim,
  DoWallpaperGfxChange,
  GetNumPartySpritesCompacting,
  InitMonIconFields,
  IsInitBoxActive,
  MovePartySprites,
  ResetReleaseMonSpritePtr,
  ScrollToBox,
  SetMovingMonPriority,
  SetUpScrollToBox,
  SetWallpaperForCurrentBox,
} from './pokemonStorageGraphics';
import { ChooseBoxMenuCurBox, CreateChooseBoxMenuSprites, DestroyChooseBoxMenuSprites, FreeBoxSelectionPopupSpriteGfx, HandleBoxChooseSelectionInput, LoadChooseBoxMenuGfx, newChooseBoxMenu, type ChooseBoxMenu } from './pokemonStorageMenu';
import {
  CreateItemIconSprites,
  GetMovingItem,
  GetMovingItemName,
  InitItemIconInCursor,
  InitItemInfoWindow,
  IsActiveItemMoving,
  IsItemIconAnimActive,
  Item_FromMonToMoving,
  Item_GiveMovingToMon,
  Item_SwitchMonsWithMoving,
  Item_TakeMons,
  MoveHeldItemWithPartyMenu,
  MoveItemFromCursorToBag,
  MultiMove_Free,
  MultiMove_Init,
  MultiMove_RunFunction,
  MultiMove_SetFunction,
  PrintItemDescription,
  TryLoadItemIconAtPos,
  UpdateItemInfoWindowSlideIn,
  UpdateItemInfoWindowSlideOut,
  type PokeStorageItemIcon,
} from './pokemonStorageMisc';
import { ShowPokemonSummaryScreen } from './summaryScreen';
import { TilemapUtil_Free, TilemapUtil_Init, TilemapUtil_Move, TilemapUtil_SetPos, TilemapUtil_SetRect, TilemapUtil_SetTilemap, TilemapUtil_Update } from './tilemapUtil';

// ------------------------------------------------------------------ gStorage

export interface StorageMenuItem {
  text: number[];
  textId: number;
}

/** A pointer to one of gStorage's sprite slots (struct Sprite **). */
export interface SpriteSlot {
  get(): Sprite | null;
  set(sprite: Sprite | null): void;
}

/** struct PokemonStorageSystemData (the fields the port uses). */
export interface PokemonStorageSystemData {
  state: number;
  boxOption: number;
  screenChangeType: number;
  isReopening: boolean;
  taskId: number;
  partyMenuTilemapBuffer: Uint16Array;
  partyMenuUnused1: number;
  partyMenuY: number;
  partyMenuMoveTimer: number;
  showPartyMenuState: number;
  closeBoxFlashing: boolean;
  closeBoxFlashTimer: number;
  closeBoxFlashState: boolean;
  newCurrBoxId: number;
  bg2_X: number;
  scrollSpeed: number;
  scrollTimer: number;
  wallpaperOffset: number;
  boxTitleTiles: Uint8Array;
  boxTitleCycleId: number;
  wallpaperLoadBoxId: number;
  wallpaperLoadDir: number;
  boxTitlePal: Uint16Array;
  boxTitlePalOffset: number;
  boxTitleAltPalOffset: number;
  curBoxTitleSprites: (Sprite | null)[];
  nextBoxTitleSprites: (Sprite | null)[];
  arrowSprites: (Sprite | null)[];
  wallpaperPalBits: number;
  wallpaperSetId: number;
  wallpaperId: number;
  wallpaperTilemap: Uint16Array;
  wallpaperChangeState: number;
  scrollState: number;
  scrollToBoxId: number;
  scrollDirection: number;
  movingMonSprite: Sprite | null;
  partySprites: (Sprite | null)[];
  boxMonsSprites: (Sprite | null)[];
  shiftMonSpritePtr: SpriteSlot | null;
  releaseMonSpritePtr: SpriteSlot | null;
  numIconsPerSpecies: number[];
  iconSpeciesList: number[];
  boxSpecies: number[];
  boxPersonalities: number[];
  incomingBoxId: number;
  shiftTimer: number;
  numPartySpritesToCompact: number;
  iconScrollDistance: number;
  iconScrollPos: number;
  iconScrollSpeed: number;
  iconScrollNumIncoming: number;
  iconScrollCurColumn: number;
  iconScrollDirection: number;
  iconScrollState: number;
  menuWindow: WindowTemplate;
  menuItems: StorageMenuItem[];
  menuItemsCount: number;
  menuWidth: number;
  menuWindowId: number;
  cursorSprite: Sprite;
  cursorShadowSprite: Sprite;
  cursorNewX: number;
  cursorNewY: number;
  cursorSpeedX: number;
  cursorSpeedY: number;
  cursorTargetX: number;
  cursorTargetY: number;
  cursorMoveSteps: number;
  cursorVerticalWrap: number;
  cursorHorizontalWrap: number;
  newCursorArea: number;
  newCursorPosition: number;
  cursorPrevPartyPos: number;
  cursorFlipTimer: number;
  cursorPalNums: number[];
  displayMonPalette: Uint16Array | null;
  displayMonPersonality: number;
  displayMonSpecies: number;
  displayMonItemId: number;
  setMosaic: boolean;
  displayMonMarkings: number;
  displayMonLevel: number;
  displayMonIsEgg: boolean;
  /** POKEMON_NAME_LENGTH + 1 bytes (EOS-terminated) */
  displayMonNickname: number[];
  /** nickname, species name, gender and level, item name (EOS-terminated) */
  displayMonTexts: number[][];
  monPlaceChangeFunc: () => boolean;
  monPlaceChangeState: number;
  shiftBoxId: number;
  markingComboSprite: Sprite | null;
  waveformSprites: (Sprite | null)[];
  markingComboTilesAddr: number;
  markMenu: MonMarkingsMenu;
  chooseBoxMenu: ChooseBoxMenu;
  movingMon: Pokemon;
  tempMon: Pokemon;
  releaseMonStatus: number;
  releaseMonStatusResolved: boolean;
  isSurfMon: boolean;
  isDiveMon: boolean;
  releaseCheckBoxId: number;
  releaseCheckBoxPos: number;
  releaseBoxId: number;
  releaseBoxPos: number;
  releaseCheckState: number;
  restrictedMoveList: number[];
  summaryLastIndex: number;
  summaryCursorPos: number;
  summaryScreenMode: number;
  /** summaryMonPtr: the party, the current box's slots, or the carried mon alone */
  summaryMons: Pokemon[] | (BoxPokemon | null)[];
  actionText: number[];
  boxTitleText: number[];
  releaseMonName: number[];
  itemName: number[];
  inBoxMovingMode: number;
  multiMoveWindowId: number;
  itemIcons: PokeStorageItemIcon[];
  movingItemId: number;
  itemInfoWindowOffset: number;
  displayMonPalOffset: number;
  displayMonTileAddr: number;
  displayMonSprite: Sprite | null;
  displayMonPalBuffer: Uint16Array;
  tileBuffer: Uint8Array;
  itemIconBuffer: Uint8Array;
  wallpaperBgTilemapBuffer: Uint16Array;
  menuTilemapBuffer: Uint16Array;
}

function emptyMon(): Pokemon {
  return {
  species: 0,
  personality: 0,
  otId: 0,
  nickname: [],
  otName: '',
  otGender: 'male',
  heldItem: 0,
  exp: 0,
  friendship: 0,
  moves: [0, 0, 0, 0],
  pp: [0, 0, 0, 0],
  ppBonuses: 0,
  ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
  evs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
  abilityNum: 0,
  metLevel: 0,
  metLocation: '',
  pokeball: 0,
  isEgg: false,
  level: 0,
  status: 0,
  hp: 0,
  maxHP: 0,
  stats: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
  };
}

/** A zeroed struct Pokemon (ZeroMonData): species SPECIES_NONE. */
export function ZeroedMon(): Pokemon {
  return emptyMon();
}

function newStorageData(): PokemonStorageSystemData {
  return {
    state: 0,
    boxOption: 0,
    screenChangeType: 0,
    isReopening: false,
    taskId: 0,
    partyMenuTilemapBuffer: new Uint16Array(0x108),
    partyMenuUnused1: 0,
    partyMenuY: 0,
    partyMenuMoveTimer: 0,
    showPartyMenuState: 0,
    closeBoxFlashing: false,
    closeBoxFlashTimer: 0,
    closeBoxFlashState: false,
    newCurrBoxId: 0,
    bg2_X: 0,
    scrollSpeed: 0,
    scrollTimer: 0,
    wallpaperOffset: 0,
    boxTitleTiles: new Uint8Array(512),
    boxTitleCycleId: 0,
    wallpaperLoadBoxId: 0,
    wallpaperLoadDir: 0,
    boxTitlePal: new Uint16Array(16),
    boxTitlePalOffset: 0,
    boxTitleAltPalOffset: 0,
    curBoxTitleSprites: [null, null],
    nextBoxTitleSprites: [null, null],
    arrowSprites: [null, null],
    wallpaperPalBits: 0,
    wallpaperSetId: 0,
    wallpaperId: 0,
    wallpaperTilemap: new Uint16Array(360),
    wallpaperChangeState: 0,
    scrollState: 0,
    scrollToBoxId: 0,
    scrollDirection: 0,
    movingMonSprite: null,
    partySprites: Array(6).fill(null),
    boxMonsSprites: Array(30).fill(null),
    shiftMonSpritePtr: null,
    releaseMonSpritePtr: null,
    numIconsPerSpecies: [],
    iconSpeciesList: [],
    boxSpecies: Array(30).fill(0),
    boxPersonalities: Array(30).fill(0),
    incomingBoxId: 0,
    shiftTimer: 0,
    numPartySpritesToCompact: 0,
    iconScrollDistance: 0,
    iconScrollPos: 0,
    iconScrollSpeed: 0,
    iconScrollNumIncoming: 0,
    iconScrollCurColumn: 0,
    iconScrollDirection: 0,
    iconScrollState: 0,
    menuWindow: { ...DUMMY_WIN_TEMPLATE },
    menuItems: [],
    menuItemsCount: 0,
    menuWidth: 0,
    menuWindowId: 0,
    cursorSprite: null as unknown as Sprite,
    cursorShadowSprite: null as unknown as Sprite,
    cursorNewX: 0,
    cursorNewY: 0,
    cursorSpeedX: 0,
    cursorSpeedY: 0,
    cursorTargetX: 0,
    cursorTargetY: 0,
    cursorMoveSteps: 0,
    cursorVerticalWrap: 0,
    cursorHorizontalWrap: 0,
    newCursorArea: 0,
    newCursorPosition: 0,
    cursorPrevPartyPos: 0,
    cursorFlipTimer: 0,
    cursorPalNums: [0, 0],
    displayMonPalette: null,
    displayMonPersonality: 0,
    displayMonSpecies: 0,
    displayMonItemId: 0,
    setMosaic: false,
    displayMonMarkings: 0,
    displayMonLevel: 0,
    displayMonIsEgg: false,
    displayMonNickname: [EOS],
    displayMonTexts: [[EOS], [EOS], [EOS], [EOS]],
    monPlaceChangeFunc: () => false,
    monPlaceChangeState: 0,
    shiftBoxId: 0,
    markingComboSprite: null,
    waveformSprites: [null, null],
    markingComboTilesAddr: 0,
    markMenu: newMonMarkingsMenu(),
    chooseBoxMenu: newChooseBoxMenu(),
    movingMon: emptyMon(),
    tempMon: emptyMon(),
    releaseMonStatus: 0,
    releaseMonStatusResolved: false,
    isSurfMon: false,
    isDiveMon: false,
    releaseCheckBoxId: 0,
    releaseCheckBoxPos: 0,
    releaseBoxId: 0,
    releaseBoxPos: 0,
    releaseCheckState: 0,
    restrictedMoveList: [0, 0, 0],
    summaryLastIndex: 0,
    summaryCursorPos: 0,
    summaryScreenMode: 0,
    summaryMons: [],
    actionText: [EOS],
    boxTitleText: [EOS],
    releaseMonName: [EOS],
    itemName: [EOS],
    inBoxMovingMode: 0,
    multiMoveWindowId: 0,
    itemIcons: [],
    movingItemId: 0,
    itemInfoWindowOffset: 0,
    displayMonPalOffset: 0,
    displayMonTileAddr: 0,
    displayMonSprite: null,
    displayMonPalBuffer: new Uint16Array(0x20),
    tileBuffer: new Uint8Array(0x800),
    itemIconBuffer: new Uint8Array(0x200),
    wallpaperBgTilemapBuffer: new Uint16Array(0x800),
    menuTilemapBuffer: new Uint16Array(0x400),
  };
}

/** gStorage (allocated by EnterPokeStorage / CB2_ReturnToPokeStorage, freed by FreePokeStorageData). */
export let gStorage: PokemonStorageSystemData = null as unknown as PokemonStorageSystemData;

let sInPartyMenu = false;
let sCurrentBoxOption = 0;
let sDepositBoxId = 0;
let sWhichToReshow = 0;
let sLastUsedBox = 0;
let sMovingItemId = 0;

/** sInPartyMenu: whether the party box is up. */
export function InPartyMenu(): boolean {
  return sInPartyMenu;
}

// ------------------------------------------------------------------ gPlayerParty (see the header)

/** gPlayerParty as the screen sees it: six slots, null = SPECIES_NONE. */
export const gPlayerParty: (Pokemon | null)[] = Array(6).fill(null);

function LoadPlayerParty(): void {
  for (let i = 0; i < K.PARTY_SIZE; i++) gPlayerParty[i] = state.party[i] ?? null;
}

function StorePlayerParty(): void {
  const mons = gPlayerParty.filter((m): m is Pokemon => m !== null);
  state.party.length = 0;
  state.party.push(...mons);
}

/** GetMonData(&gPlayerParty[i], MON_DATA_SPECIES) */
export function PartySpecies(i: number): number {
  return gPlayerParty[i]?.species ?? K.SPECIES_NONE;
}

/** MON_DATA_SPECIES_OR_EGG */
export function SpeciesOrEgg(mon: { species: number; isEgg: boolean } | null | undefined): number {
  if (!mon || !mon.species) return K.SPECIES_NONE;
  return mon.isEgg ? K.SPECIES_EGG : mon.species;
}

/** CountPartyMons */
export function CountPartyMons(): number {
  return gPlayerParty.filter((m) => m && m.species).length;
}

/** CountPartyAliveNonEggMonsExcept */
export function CountPartyAliveNonEggMonsExcept(slotToIgnore: number): number {
  let count = 0;
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const m = gPlayerParty[i];
    if (i !== slotToIgnore && m && m.species && !m.isEgg && m.hp !== 0) count++;
  }
  return count;
}

/** CalculatePlayerPartyCount on gPlayerParty: the slots before the first empty one. */
export function StoragePartyCount(): number {
  let count = 0;
  while (count < K.PARTY_SIZE && gPlayerParty[count]?.species) count++;
  return count;
}

// ------------------------------------------------------------------ tables

const TILEMAP_PKMN_DATA = 0;
const TILEMAP_PARTY_MENU = 1;
const TILEMAP_CLOSE_BUTTON = 2;
const TILEMAP_COUNT = 3;

const SCREEN_CHANGE_EXIT_BOX = 0;
const SCREEN_CHANGE_SUMMARY_SCREEN = 1;
const SCREEN_CHANGE_NAME_BOX = 2;
const SCREEN_CHANGE_ITEM_FROM_BAG = 3;

const MSG_EXIT_BOX = 0;
const MSG_WHAT_YOU_DO = 1;
const MSG_PICK_A_THEME = 2;
const MSG_PICK_A_WALLPAPER = 3;
const MSG_IS_SELECTED = 4;
const MSG_JUMP_TO_WHICH_BOX = 5;
const MSG_DEPOSIT_IN_WHICH_BOX = 6;
const MSG_WAS_DEPOSITED = 7;
const MSG_BOX_IS_FULL = 8;
const MSG_RELEASE_POKE = 9;
const MSG_WAS_RELEASED = 10;
const MSG_BYE_BYE = 11;
const MSG_MARK_POKE = 12;
const MSG_LAST_POKE = 13;
const MSG_PARTY_FULL = 14;
const MSG_HOLDING_POKE = 15;
const MSG_WHICH_ONE_WILL_TAKE = 16;
const MSG_CANT_RELEASE_EGG = 17;
const MSG_CONTINUE_BOX = 18;
const MSG_CAME_BACK = 19;
const MSG_WORRIED = 20;
const MSG_SURPRISE = 21;
const MSG_PLEASE_REMOVE_MAIL = 22;
const MSG_IS_SELECTED2 = 23;
const MSG_GIVE_TO_MON = 24;
const MSG_PLACED_IN_BAG = 25;
const MSG_BAG_FULL = 26;
const MSG_PUT_IN_BAG = 27;
const MSG_ITEM_IS_HELD = 28;
const MSG_CHANGED_TO_ITEM = 29;
const MSG_CANT_STORE_MAIL = 30;
void MSG_WAS_DEPOSITED;

const MSG_FMT_NONE = 0;
const MSG_FMT_MON_NAME_1 = 1;
const MSG_FMT_RELEASE_MON_1 = 4;
const MSG_FMT_RELEASE_MON_3 = 6;
const MSG_FMT_ITEM_NAME = 7;

/** sMessages: [text, format] */
const sMessages: [string, number][] = [
  ['gText_ExitFromBox', MSG_FMT_NONE],
  ['gText_WhatDoYouWantToDo', MSG_FMT_NONE],
  ['gText_PleasePickATheme', MSG_FMT_NONE],
  ['gText_PickTheWallpaper', MSG_FMT_NONE],
  ['gText_PkmnIsSelected', MSG_FMT_MON_NAME_1],
  ['gText_JumpToWhichBox', MSG_FMT_NONE],
  ['gText_DepositInWhichBox', MSG_FMT_NONE],
  ['gText_PkmnWasDeposited', MSG_FMT_MON_NAME_1],
  ['gText_BoxIsFull2', MSG_FMT_NONE],
  ['gText_ReleaseThisPokemon', MSG_FMT_NONE],
  ['gText_PkmnWasReleased', MSG_FMT_RELEASE_MON_1],
  ['gText_ByeByePkmn', MSG_FMT_RELEASE_MON_3],
  ['gText_MarkYourPkmn', MSG_FMT_NONE],
  ['gText_ThatsYourLastPkmn', MSG_FMT_NONE],
  ['gText_YourPartysFull', MSG_FMT_NONE],
  ['gText_YoureHoldingAPkmn', MSG_FMT_NONE],
  ['gText_WhichOneWillYouTake', MSG_FMT_NONE],
  ['gText_YouCantReleaseAnEgg', MSG_FMT_NONE],
  ['gText_ContinueBoxOperations', MSG_FMT_NONE],
  ['gText_PkmnCameBack', MSG_FMT_MON_NAME_1],
  ['gText_WasItWorriedAboutYou', MSG_FMT_NONE],
  ['gText_FourEllipsesExclamation', MSG_FMT_NONE],
  ['gText_PleaseRemoveTheMail', MSG_FMT_NONE],
  ['gText_PkmnIsSelected', MSG_FMT_ITEM_NAME],
  ['gText_GiveToAPkmn', MSG_FMT_NONE],
  ['gText_PlacedItemInBag', MSG_FMT_ITEM_NAME],
  ['gText_BagIsFull2', MSG_FMT_NONE],
  ['gText_PutItemInBag', MSG_FMT_NONE],
  ['gText_ItemIsNowHeld', MSG_FMT_ITEM_NAME],
  ['gText_ChangedToNewItem', MSG_FMT_ITEM_NAME],
  ['gText_MailCantBeStored', MSG_FMT_NONE],
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 0, tilemapTop: 11, width: 9, height: 7, paletteNum: 3, baseBlock: 0x0c0 },
  { bg: 0, tilemapLeft: 11, tilemapTop: 17, width: 18, height: 2, paletteNum: 13, baseBlock: 0x014 },
  { bg: 0, tilemapLeft: 0, tilemapTop: 12, width: 25, height: 8, paletteNum: 15, baseBlock: 0x014 },
  DUMMY_WIN_TEMPLATE,
];

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x100 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 27, screenSize: 1, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

const sYesNoWindowTemplate: WindowTemplate = { bg: 0, tilemapLeft: 24, tilemapTop: 11, width: 5, height: 4, paletteNum: 15, baseBlock: 0x05c };

const sOamData_DisplayMon = oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 0 });
const sOamData_Waveform = oam({ shape: SPRITE_SHAPE['16x8'][0], size: SPRITE_SHAPE['16x8'][1], priority: 0 });

function sSpriteTemplate_DisplayMon(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_DISPLAY_MON,
    paletteTag: K.PALTAG_DISPLAY_MON,
    oam: sOamData_DisplayMon,
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

function sSpriteTemplate_Waveform(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_WAVEFORM,
    paletteTag: K.PALTAG_MISC_2,
    oam: sOamData_Waveform,
    anims: animTable('pokemon_storage_system_tasks.c', 'sAnims_Waveform'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

// ------------------------------------------------------------------ graphics to preload

/** Every graphic the storage screens can draw for this save (the screen draws synchronously). */
export function pokemonStorageGfxSymbols(): string[] {
  const syms = new Set<string>([
    'sScrollingBg_Gfx',
    'sScrollingBg_Tilemap',
    'gPokeStorageMenu_Gfx',
    'sMenu_Tilemap',
    'sPkmnData_Tilemap',
    'sScrollingBg_Pal',
    'sScrollingBgMoveItems_Pal',
    'sCloseBoxButton_Tilemap',
    'sPartySlotFilled_Tilemap',
    'sPartySlotEmpty_Tilemap',
    'sPokeStorageMisc2Pal',
    'sWaveform_Gfx',
    'sItemInfoFrame_Pal',
    'gPokeStorageInterface_Pal',
    'gPokeStorageInterface_NoDisplayMon_Pal',
    'gPokeStoragePartyMenu_Pal',
    'gPokeStoragePartyMenu_Tilemap',
    'sPokeStorageMisc1Pal',
    'sHandCursorTiles',
    'sHandCursorShadowTiles',
    'sBoxScrollArrow_Gfx',
    'sChooseBoxMenuCenter_Gfx',
    'sChooseBoxMenuCorners_Gfx',
    'sItemInfoFrame_Gfx',
    'gMonIconPalettes',
    'sMonMarkings_Gfx',
    'sMonMarkings_Pal',
    'gMonMarkingsMenu_Gfx',
    'gMonMarkingsMenu_Pal',
  ]);
  for (const name of WALLPAPER_NAMES) syms.add(`sWallpaperTiles_${name}`).add(`sWallpaperTilemap_${name}`).add(`sWallpaperPalettes_${name}`);
  const mons: { species: number; personality: number; isEgg: boolean; heldItem: number }[] = [...state.party];
  for (const box of state.storage.boxes) for (const m of box) if (m) mons.push(m);
  const items = new Set<number>();
  for (const mon of mons) {
    const species = mon.isEgg ? K.SPECIES_EGG : mon.species;
    syms.add(monPicSymbol(true, species, mon.personality));
    for (const p of monPalSymbols(species)) syms.add(p);
    syms.add(monIconSymbol(GetIconSpecies(species, mon.personality)));
    if (mon.heldItem) items.add(mon.heldItem);
  }
  for (const pocket of state.bag.pockets) for (const slot of pocket) if (slot.itemId) items.add(slot.itemId);
  for (const s of itemIconSymbols(items)) syms.add(s);
  return [...syms];
}

/** sWallpapers, by WALLPAPER_* */
export const WALLPAPER_NAMES = ['Forest', 'City', 'Desert', 'Savanna', 'Crag', 'Volcano', 'Snow', 'Cave', 'Beach', 'Seafloor', 'River', 'Sky', 'Stars', 'Pokecenter', 'Tiles', 'Simple'];

// ------------------------------------------------------------------ main callbacks

function VBlankCB_PokeStorage(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  // UnkUtil_Run: nothing ever adds to it
  TransferPlttBuffer();
  SetGpuReg(REG_OFFSET_BG2HOFS, gStorage.bg2_X & 0xffff);
}

function CB2_PokeStorage(): void {
  RunTasks();
  DoScheduledBgTilemapCopiesToVram();
  ScrollBackground();
  UpdateCloseBoxButtonFlash();
  AnimateSprites();
  BuildOamBuffer();
}

/** EnterPokeStorage */
export function EnterPokeStorage(boxOption: number): void {
  ResetTasks();
  sCurrentBoxOption = boxOption;
  gStorage = newStorageData();
  gStorage.boxOption = boxOption;
  gStorage.isReopening = false;
  sMovingItemId = 0;
  gStorage.state = 0;
  gStorage.taskId = CreateTask(Task_InitPokeStorage, 3);
  sLastUsedBox = state.storage.getCurrentBox();
  SetMainCallback2(CB2_PokeStorage);
}

/** CB2_ReturnToPokeStorage */
export function CB2_ReturnToPokeStorage(): void {
  ResetTasks();
  gStorage = newStorageData();
  gStorage.boxOption = sCurrentBoxOption;
  gStorage.isReopening = true;
  gStorage.state = 0;
  gStorage.taskId = CreateTask(Task_InitPokeStorage, 3);
  SetMainCallback2(CB2_PokeStorage);
}

let sPreviousBoxOption = 0;

/** CB2_ExitPokeStorage (pokemon_storage_system_menu.c): back to the field, which reopens the PC's storage menu. */
export function CB2_ExitPokeStorage(): void {
  sPreviousBoxOption = GetCurrentBoxOption();
  // gFieldCallback = FieldTask_ReturnToPcMenu: the field side (ui/StoragePcMenu.ts) reopens its menu
  SetMainCallback2(CB2_ReturnToField);
}

/** sPreviousBoxOption: the option FieldTask_ReturnToPcMenu reopens the menu on. */
export function GetPreviousBoxOption(): number {
  return sPreviousBoxOption;
}

function ResetAllBgCoords(): void {
  SetGpuReg(REG_OFFSET_BG0HOFS, 0);
  SetGpuReg(REG_OFFSET_BG0VOFS, 0);
  SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  SetGpuReg(REG_OFFSET_BG1VOFS, 0);
  SetGpuReg(REG_OFFSET_BG2HOFS, 0);
  SetGpuReg(REG_OFFSET_BG2VOFS, 0);
  SetGpuReg(REG_OFFSET_BG3HOFS, 0);
  SetGpuReg(REG_OFFSET_BG3VOFS, 0);
}

function ResetForPokeStorage(): void {
  ResetPaletteFade();
  ResetSpriteData();
  FreeSpriteTileRanges();
  FreeAllSpritePalettes();
  // ClearDma3Requests: DMA is instant here
  SetReservedSpriteTileCount(0x280);
  // UnkUtil_Init: functionally unused
  SetKeyRepeatStartDelay(20);
  ClearScheduledBgCopiesToVram();
  TilemapUtil_Init(TILEMAP_COUNT);
  TilemapUtil_SetTilemap(TILEMAP_PKMN_DATA, 1, gfx16('sPkmnData_Tilemap'), 8, 4);
  TilemapUtil_SetPos(TILEMAP_PKMN_DATA, 1, 0);
  gStorage.closeBoxFlashing = false;
}

function InitStartingPosData(): void {
  ClearSavedCursorPos();
  sInPartyMenu = gStorage.boxOption === K.OPTION_DEPOSIT;
  sDepositBoxId = 0;
}

function SetMonIconTransparency(): void {
  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT2_ALL);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(7, 11));
  }
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_BG_ALL_ON | DISPCNT_OBJ_1D_MAP);
}

function SetPokeStorageTask(newFunc: TaskFunc): void {
  gTasks[gStorage.taskId].func = newFunc;
  gStorage.state = 0;
}

function Task_InitPokeStorage(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      SetVBlankCallback(null);
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      LoadPlayerParty();
      ResetForPokeStorage();
      if (gStorage.isReopening) {
        switch (sWhichToReshow) {
          case SCREEN_CHANGE_NAME_BOX - 1:
            LoadSavedMovingMon();
            break;
          case SCREEN_CHANGE_SUMMARY_SCREEN - 1:
            SetSelectionAfterSummaryScreen();
            break;
          case SCREEN_CHANGE_ITEM_FROM_BAG - 1:
            GiveChosenBagItem();
            break;
        }
      }
      LoadPokeStorageMenuGfx();
      LoadsMiscSpritePalette();
      break;
    case 1:
      if (!InitPokeStorageWindows()) {
        SetPokeStorageTask(Task_ChangeScreen);
        return;
      }
      break;
    case 2:
      PutWindowTilemap(0);
      ClearWindowTilemap(1);
      vram.fill(0, 0, 0x200);
      LoadUserWindowGfx(1, 0xb, BG_PLTT_ID(14));
      break;
    case 3:
      ResetAllBgCoords();
      if (!gStorage.isReopening) InitStartingPosData();
      break;
    case 4:
      InitMonIconFields();
      if (!gStorage.isReopening) InitCursor();
      else InitCursorOnReopen();
      break;
    case 5:
      if (!MultiMove_Init()) {
        SetPokeStorageTask(Task_ChangeScreen);
        return;
      }
      SetScrollingBackground();
      InitPokeStorageBg0();
      break;
    case 6:
      InitPalettesAndSprites();
      break;
    case 7:
      InitSupplementalTilemaps();
      break;
    case 8:
      CreateInitBoxTask(state.storage.getCurrentBox());
      break;
    case 9:
      if (IsInitBoxActive()) return;
      if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
        gStorage.markMenu.baseTileTag = K.GFXTAG_MARKING_MENU;
        gStorage.markMenu.basePaletteTag = K.PALTAG_MARKING_MENU;
        InitMonMarkingsMenu(gStorage.markMenu);
        BufferMonMarkingsMenuTiles();
      } else {
        CreateItemIconSprites();
        InitCursorItemIcon();
      }
      break;
    case 10:
      SetMonIconTransparency();
      BlendPalettes(0xffffffff, 16, RGB_BLACK);
      SetPokeStorageTask(gStorage.isReopening ? Task_ReshowPokeStorage : Task_ShowPokeStorage);
      SetVBlankCallback(VBlankCB_PokeStorage);
      return;
    default:
      return;
  }
  gStorage.state++;
}

function Task_ShowPokeStorage(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PlaySE(K.SE_PC_LOGIN);
      BeginPCScreenEffect_TurnOn(20, 0, 1);
      gStorage.state++;
      break;
    case 1:
      if (!IsPCScreenEffectRunning_TurnOn()) SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_ReshowPokeStorage(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      BeginNormalPaletteFade(0xffffffff, -1, 0x10, 0, RGB_BLACK);
      gStorage.state++;
      break;
    case 1:
      if (!UpdatePaletteFade()) SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_PokeStorageMain(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      switch (HandleInput()) {
        case K.INPUT_MOVE_CURSOR:
          PlaySE(K.SE_SELECT);
          gStorage.state = 1;
          break;
        case K.INPUT_SHOW_PARTY:
          if (gStorage.boxOption !== K.OPTION_MOVE_MONS && gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
            PrintStorageMessage(MSG_WHICH_ONE_WILL_TAKE);
            gStorage.state = 3;
          } else {
            ClearSavedCursorPos();
            SetPokeStorageTask(Task_ShowPartyPokemon);
          }
          break;
        case K.INPUT_HIDE_PARTY:
          if (gStorage.boxOption === K.OPTION_MOVE_MONS) {
            if (IsMonBeingMoved() && ItemIsMail(gStorage.displayMonItemId)) gStorage.state = 5;
            else SetPokeStorageTask(Task_HidePartyPokemon);
          } else if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
            SetPokeStorageTask(Task_HidePartyPokemon);
          }
          break;
        case K.INPUT_CLOSE_BOX:
          SetPokeStorageTask(Task_OnCloseBoxPressed);
          break;
        case K.INPUT_PRESSED_B:
          SetPokeStorageTask(Task_OnBPressed);
          break;
        case K.INPUT_BOX_OPTIONS:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_HandleBoxOptions);
          break;
        case K.INPUT_IN_MENU:
          SetPokeStorageTask(Task_OnSelectedMon);
          break;
        case K.INPUT_SCROLL_RIGHT:
          PlaySE(K.SE_SELECT);
          gStorage.newCurrBoxId = state.storage.getCurrentBox() + 1;
          if (gStorage.newCurrBoxId >= K.TOTAL_BOXES_COUNT) gStorage.newCurrBoxId = 0;
          if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
            SetUpScrollToBox(gStorage.newCurrBoxId);
            gStorage.state = 2;
          } else {
            TryHideItemAtCursor();
            gStorage.state = 10;
          }
          break;
        case K.INPUT_SCROLL_LEFT:
          PlaySE(K.SE_SELECT);
          gStorage.newCurrBoxId = state.storage.getCurrentBox() - 1;
          if (gStorage.newCurrBoxId < 0) gStorage.newCurrBoxId = K.TOTAL_BOXES_COUNT - 1;
          if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
            SetUpScrollToBox(gStorage.newCurrBoxId);
            gStorage.state = 2;
          } else {
            TryHideItemAtCursor();
            gStorage.state = 10;
          }
          break;
        case K.INPUT_DEPOSIT:
          if (!CanMovePartyMon()) {
            if (ItemIsMail(gStorage.displayMonItemId)) {
              gStorage.state = 5;
            } else {
              PlaySE(K.SE_SELECT);
              SetPokeStorageTask(Task_DepositMenu);
            }
          } else {
            gStorage.state = 4;
          }
          break;
        case K.INPUT_MOVE_MON:
          if (CanMovePartyMon()) {
            gStorage.state = 4;
          } else {
            PlaySE(K.SE_SELECT);
            SetPokeStorageTask(Task_MoveMon);
          }
          break;
        case K.INPUT_SHIFT_MON:
          if (!CanShiftMon()) {
            gStorage.state = 4;
          } else {
            PlaySE(K.SE_SELECT);
            SetPokeStorageTask(Task_ShiftMon);
          }
          break;
        case K.INPUT_WITHDRAW:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_WithdrawMon);
          break;
        case K.INPUT_PLACE_MON:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_PlaceMon);
          break;
        case K.INPUT_TAKE_ITEM:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_TakeItemForMoving);
          break;
        case K.INPUT_GIVE_ITEM:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_GiveMovingItemToMon);
          break;
        case K.INPUT_SWITCH_ITEMS:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_SwitchSelectedItem);
          break;
        case K.INPUT_MULTIMOVE_START:
          PlaySE(K.SE_SELECT);
          MultiMove_SetFunction(K.MULTIMOVE_START);
          gStorage.state = 7;
          break;
        case K.INPUT_MULTIMOVE_SINGLE:
          MultiMove_SetFunction(K.MULTIMOVE_SINGLE);
          gStorage.state = 8;
          break;
        case K.INPUT_MULTIMOVE_CHANGE_SELECTION:
          PlaySE(K.SE_SELECT);
          MultiMove_SetFunction(K.MULTIMOVE_CHANGE_SELECTION);
          gStorage.state = 9;
          break;
        case K.INPUT_MULTIMOVE_GRAB_SELECTION:
          MultiMove_SetFunction(K.MULTIMOVE_GRAB_SELECTION);
          gStorage.state = 7;
          break;
        case K.INPUT_MULTIMOVE_MOVE_MONS:
          PlaySE(K.SE_SELECT);
          MultiMove_SetFunction(K.MULTIMOVE_MOVE_MONS);
          gStorage.state = 9;
          break;
        case K.INPUT_MULTIMOVE_PLACE_MONS:
          PlaySE(K.SE_SELECT);
          SetPokeStorageQuestLogEvent(3);
          MultiMove_SetFunction(K.MULTIMOVE_PLACE_MONS);
          gStorage.state = 7;
          break;
        case K.INPUT_MULTIMOVE_UNABLE:
          PlaySE(K.SE_FAILURE);
          break;
      }
      break;
    case 1:
      if (!UpdateCursorPos()) {
        if (IsCursorOnCloseBox()) StartFlashingCloseBoxButton();
        else StopFlashingCloseBoxButton();
        if (gStorage.setMosaic) StartDisplayMonMosaic();
        gStorage.state = 0;
      }
      break;
    case 2:
      if (!ScrollToBox()) {
        state.storage.setCurrentBox(gStorage.newCurrBoxId);
        if (!sInPartyMenu && !IsMonBeingMoved()) {
          DoTrySetDisplayMonData();
          StartDisplayMonMosaic();
        }
        if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
          TryShowItemAtCursor();
          gStorage.state = 11;
        } else {
          gStorage.state = 0;
        }
      }
      break;
    case 3:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        gStorage.state = 0;
      }
      break;
    case 4:
      PlaySE(K.SE_FAILURE);
      PrintStorageMessage(MSG_LAST_POKE);
      gStorage.state = 6;
      break;
    case 5:
      PlaySE(K.SE_FAILURE);
      PrintStorageMessage(MSG_PLEASE_REMOVE_MAIL);
      gStorage.state = 6;
      break;
    case 6:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 7:
      if (!MultiMove_RunFunction()) gStorage.state = 0;
      break;
    case 8:
      if (!MultiMove_RunFunction()) SetPokeStorageTask(Task_MoveMon);
      break;
    case 9:
      if (!MultiMove_RunFunction()) {
        if (gStorage.setMosaic) StartDisplayMonMosaic();
        gStorage.state = 0;
      }
      break;
    case 10:
      if (!IsItemIconAnimActive()) {
        SetUpScrollToBox(gStorage.newCurrBoxId);
        gStorage.state = 2;
      }
      break;
    case 11:
      if (!IsItemIconAnimActive()) gStorage.state = 0;
      break;
  }
}

function Task_ShowPartyPokemon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      SetUpDoShowPartyMenu();
      gStorage.state++;
      break;
    case 1:
      if (!DoShowPartyMenu()) SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_HidePartyPokemon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PlaySE(K.SE_SELECT);
      SetUpHidePartyMenu();
      gStorage.state++;
      break;
    case 1:
      if (!HidePartyMenu()) {
        SetCursorBoxPosition(GetSavedCursorPos());
        gStorage.state++;
      }
      break;
    case 2:
      if (!UpdateCursorPos()) {
        if (gStorage.setMosaic) StartDisplayMonMosaic();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_OnSelectedMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (!IsDisplayMonMosaicActive()) {
        PlaySE(K.SE_SELECT);
        if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) PrintStorageMessage(MSG_IS_SELECTED);
        else if (IsActiveItemMoving() || gStorage.displayMonItemId !== 0) PrintStorageMessage(MSG_IS_SELECTED2);
        else PrintStorageMessage(MSG_GIVE_TO_MON);
        AddMenu();
        gStorage.state = 1;
      }
      break;
    case 1:
      if (!IsMenuLoading()) gStorage.state = 2;
      break;
    case 2:
      switch (HandleMenuInput()) {
        case MENU_B_PRESSED:
        case K.MENU_TEXT_CANCEL:
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case K.MENU_TEXT_MOVE:
          if (CanMovePartyMon()) {
            gStorage.state = 3;
          } else {
            PlaySE(K.SE_SELECT);
            ClearBottomWindow();
            SetPokeStorageTask(Task_MoveMon);
          }
          break;
        case K.MENU_TEXT_PLACE:
          PlaySE(K.SE_SELECT);
          ClearBottomWindow();
          SetPokeStorageTask(Task_PlaceMon);
          break;
        case K.MENU_TEXT_SHIFT:
          if (!CanShiftMon()) {
            gStorage.state = 3;
          } else {
            PlaySE(K.SE_SELECT);
            ClearBottomWindow();
            SetPokeStorageTask(Task_ShiftMon);
          }
          break;
        case K.MENU_TEXT_WITHDRAW:
          PlaySE(K.SE_SELECT);
          ClearBottomWindow();
          SetPokeStorageTask(Task_WithdrawMon);
          break;
        case K.MENU_TEXT_STORE:
          if (CanMovePartyMon()) {
            gStorage.state = 3;
          } else if (ItemIsMail(gStorage.displayMonItemId)) {
            gStorage.state = 4;
          } else {
            PlaySE(K.SE_SELECT);
            ClearBottomWindow();
            SetPokeStorageTask(Task_DepositMenu);
          }
          break;
        case K.MENU_TEXT_RELEASE:
          if (CanMovePartyMon()) {
            gStorage.state = 3;
          } else if (gStorage.displayMonIsEgg) {
            gStorage.state = 5;
          } else if (ItemIsMail(gStorage.displayMonItemId)) {
            gStorage.state = 4;
          } else {
            PlaySE(K.SE_SELECT);
            SetPokeStorageTask(Task_ReleaseMon);
          }
          break;
        case K.MENU_TEXT_SUMMARY:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_ShowMonSummary);
          break;
        case K.MENU_TEXT_MARK:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_ShowMarkMenu);
          break;
        case K.MENU_TEXT_TAKE:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_TakeItemForMoving);
          break;
        case K.MENU_TEXT_GIVE:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_GiveMovingItemToMon);
          break;
        case K.MENU_TEXT_BAG:
          SetPokeStorageTask(Task_ItemToBag);
          break;
        case K.MENU_TEXT_SWITCH:
          SetPokeStorageTask(Task_SwitchSelectedItem);
          break;
        case K.MENU_TEXT_GIVE2:
          SetPokeStorageTask(Task_GiveItemFromBag);
          break;
        case K.MENU_TEXT_INFO:
          SetPokeStorageTask(Task_ShowItemInfo);
          break;
      }
      break;
    case 3:
      PlaySE(K.SE_FAILURE);
      PrintStorageMessage(MSG_LAST_POKE);
      gStorage.state = 6;
      break;
    case 5:
      PlaySE(K.SE_FAILURE);
      PrintStorageMessage(MSG_CANT_RELEASE_EGG);
      gStorage.state = 6;
      break;
    case 4:
      PlaySE(K.SE_FAILURE);
      PrintStorageMessage(MSG_PLEASE_REMOVE_MAIL);
      gStorage.state = 6;
      break;
    case 6:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_MoveMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      InitMonPlaceChange(K.CHANGE_GRAB);
      gStorage.state++;
      break;
    case 1:
      if (!DoMonPlaceChange()) SetPokeStorageTask(sInPartyMenu ? Task_HandleMovingMonFromParty : Task_PokeStorageMain);
      break;
  }
}

function Task_PlaceMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      SetPokeStorageQuestLogEvent(1);
      InitMonPlaceChange(K.CHANGE_PLACE);
      gStorage.state++;
      break;
    case 1:
      if (!DoMonPlaceChange()) SetPokeStorageTask(sInPartyMenu ? Task_HandleMovingMonFromParty : Task_PokeStorageMain);
      break;
  }
}

function Task_ShiftMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      SetPokeStorageQuestLogEvent(0);
      InitMonPlaceChange(K.CHANGE_SHIFT);
      gStorage.state++;
      break;
    case 1:
      if (!DoMonPlaceChange()) {
        StartDisplayMonMosaic();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_WithdrawMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (StoragePartyCount() === K.PARTY_SIZE) {
        PrintStorageMessage(MSG_PARTY_FULL);
        gStorage.state = 1;
      } else {
        SaveCursorPos();
        InitMonPlaceChange(K.CHANGE_GRAB);
        gStorage.state = 2;
      }
      break;
    case 1:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 2:
      if (!DoMonPlaceChange()) {
        SetMovingMonPriority(1);
        SetUpDoShowPartyMenu();
        gStorage.state++;
      }
      break;
    case 3:
      if (!DoShowPartyMenu()) {
        SetPokeStorageQuestLogEvent(1);
        InitMonPlaceChange(K.CHANGE_PLACE);
        gStorage.state++;
      }
      break;
    case 4:
      if (!DoMonPlaceChange()) {
        UpdatePartySlotColors();
        gStorage.state++;
      }
      break;
    case 5:
      SetPokeStorageTask(Task_HidePartyPokemon);
      break;
  }
}

function Task_DepositMenu(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_DEPOSIT_IN_WHICH_BOX);
      LoadChooseBoxMenuGfx(gStorage.chooseBoxMenu, K.GFXTAG_CHOOSE_BOX_MENU_CENTER, K.PALTAG_MISC_1, 3, false);
      CreateChooseBoxMenuSprites(sDepositBoxId);
      gStorage.state++;
      break;
    case 1: {
      const boxId = HandleBoxChooseSelectionInput();
      switch (boxId) {
        case K.BOXID_NONE_CHOSEN:
          break;
        case K.BOXID_CANCELED:
          ClearBottomWindow();
          DestroyChooseBoxMenuSprites();
          FreeBoxSelectionPopupSpriteGfx();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        default:
          if (TryStorePartyMonInBox(boxId)) {
            sDepositBoxId = boxId;
            SetPokeStorageQuestLogEvent(2);
            ClearBottomWindow();
            DestroyChooseBoxMenuSprites();
            FreeBoxSelectionPopupSpriteGfx();
            gStorage.state = 2;
          } else {
            PrintStorageMessage(MSG_BOX_IS_FULL);
            gStorage.state = 4;
          }
          break;
      }
      break;
    }
    case 2:
      CompactPartySlots();
      CompactPartySprites();
      gStorage.state++;
      break;
    case 3:
      if (GetNumPartySpritesCompacting() === 0) {
        ResetSelectionAfterDeposit();
        StartDisplayMonMosaic();
        UpdatePartySlotColors();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 4:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        PrintStorageMessage(MSG_DEPOSIT_IN_WHICH_BOX);
        gStorage.state = 1;
      }
      break;
  }
}

function Task_ReleaseMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_RELEASE_POKE);
      ShowYesNoWindow(1);
      gStorage.state++;
    // fallthrough
    case 1:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case MENU_B_PRESSED:
        case 1:
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case 0:
          ClearBottomWindow();
          InitCanReleaseMonVars();
          InitReleaseMon();
          gStorage.state++;
          break;
      }
      break;
    case 2:
      RunCanReleaseMon();
      if (!TryHideReleaseMon()) {
        for (;;) {
          // keep checking until status is no longer RELEASE_MON_UNDETERMINED
          const canReleaseStatus = RunCanReleaseMon();
          if (canReleaseStatus === K.RELEASE_MON_ALLOWED) {
            gStorage.state++;
            break;
          } else if (canReleaseStatus === K.RELEASE_MON_NOT_ALLOWED) {
            gStorage.state = 8; // Can't release the mon.
            break;
          }
        }
      }
      break;
    case 3:
      ReleaseMon();
      RefreshDisplayMonData();
      PrintStorageMessage(MSG_WAS_RELEASED);
      gStorage.state++;
      break;
    case 4:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        PrintStorageMessage(MSG_BYE_BYE);
        gStorage.state++;
      }
      break;
    case 5:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        if (sInPartyMenu) {
          CompactPartySlots();
          CompactPartySprites();
          gStorage.state++;
        } else {
          gStorage.state = 7;
        }
      }
      break;
    case 6:
      if (GetNumPartySpritesCompacting() === 0) {
        DoTrySetDisplayMonData();
        StartDisplayMonMosaic();
        UpdatePartySlotColors();
        gStorage.state++;
      }
      break;
    case 7:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
    case 8:
      // Start "can't release" sequence
      PrintStorageMessage(MSG_WAS_RELEASED);
      gStorage.state++;
      break;
    case 9:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        PrintStorageMessage(MSG_SURPRISE);
        gStorage.state++;
      }
      break;
    case 10:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        DoReleaseMonComeBackAnim();
        gStorage.state++;
      }
      break;
    case 11:
      if (!ResetReleaseMonSpritePtr()) {
        TrySetCursorFistAnim();
        PrintStorageMessage(MSG_CAME_BACK);
        gStorage.state++;
      }
      break;
    case 12:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        PrintStorageMessage(MSG_WORRIED);
        gStorage.state++;
      }
      break;
    case 13:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_ShowMarkMenu(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_MARK_POKE);
      gStorage.markMenu.markings = gStorage.displayMonMarkings;
      OpenMonMarkingsMenu(gStorage.displayMonMarkings, 176, 16);
      gStorage.state++;
      break;
    case 1:
      if (!HandleMonMarkingsMenuInput()) {
        FreeMonMarkingsMenu();
        ClearBottomWindow();
        SetMonMarkings(gStorage.markMenu.markings);
        RefreshDisplayMonData();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_TakeItemForMoving(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (!ItemIsMail(gStorage.displayMonItemId)) {
        ClearBottomWindow();
        gStorage.state++;
      } else {
        SetPokeStorageTask(Task_PrintCantStoreMail);
      }
      break;
    case 1:
      StartCursorAnim(K.CURSOR_ANIM_OPEN);
      Item_FromMonToMoving(sInPartyMenu ? K.CURSOR_AREA_IN_PARTY : K.CURSOR_AREA_IN_BOX, GetBoxCursorPosition());
      gStorage.state++;
      break;
    case 2:
      if (!IsItemIconAnimActive()) {
        StartCursorAnim(K.CURSOR_ANIM_FIST);
        ClearBottomWindow();
        DoTrySetDisplayMonData();
        PrintDisplayMonInfo();
        gStorage.state++;
      }
      break;
    case 3:
      SetPokeStorageTask(Task_PokeStorageMain); // IsDma3ManagerBusyWithBgCopy: never busy
      break;
  }
}

function Task_GiveMovingItemToMon(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      ClearBottomWindow();
      gStorage.state++;
      break;
    case 1:
      StartCursorAnim(K.CURSOR_ANIM_OPEN);
      Item_GiveMovingToMon(sInPartyMenu ? K.CURSOR_AREA_IN_PARTY : K.CURSOR_AREA_IN_BOX, GetBoxCursorPosition());
      gStorage.state++;
      break;
    case 2:
      if (!IsItemIconAnimActive()) {
        StartCursorAnim(K.CURSOR_ANIM_BOUNCE);
        DoTrySetDisplayMonData();
        PrintDisplayMonInfo();
        PrintStorageMessage(MSG_ITEM_IS_HELD);
        gStorage.state++;
      }
      break;
    case 3:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        gStorage.state++;
      }
      break;
    case 4:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_ItemToBag(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (!AddBagItem(gStorage.displayMonItemId, 1)) {
        PlaySE(K.SE_FAILURE);
        PrintStorageMessage(MSG_BAG_FULL);
        gStorage.state = 3;
      } else {
        PlaySE(K.SE_SELECT);
        Item_TakeMons(sInPartyMenu ? K.CURSOR_AREA_IN_PARTY : K.CURSOR_AREA_IN_BOX, GetBoxCursorPosition());
        gStorage.state = 1;
      }
      break;
    case 1:
      if (!IsItemIconAnimActive()) {
        PrintStorageMessage(MSG_PLACED_IN_BAG);
        gStorage.state = 2;
      }
      break;
    case 2:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        DoTrySetDisplayMonData();
        PrintDisplayMonInfo();
        gStorage.state = 4;
      }
      break;
    case 4:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
    case 3:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_SwitchSelectedItem(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (!ItemIsMail(gStorage.displayMonItemId)) {
        ClearBottomWindow();
        gStorage.state++;
      } else {
        SetPokeStorageTask(Task_PrintCantStoreMail);
      }
      break;
    case 1:
      StartCursorAnim(K.CURSOR_ANIM_OPEN);
      Item_SwitchMonsWithMoving(sInPartyMenu ? K.CURSOR_AREA_IN_PARTY : K.CURSOR_AREA_IN_BOX, GetBoxCursorPosition());
      gStorage.state++;
      break;
    case 2:
      if (!IsItemIconAnimActive()) {
        StartCursorAnim(K.CURSOR_ANIM_FIST);
        DoTrySetDisplayMonData();
        PrintDisplayMonInfo();
        PrintStorageMessage(MSG_CHANGED_TO_ITEM);
        gStorage.state++;
      }
      break;
    case 3:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        gStorage.state++;
      }
      break;
    case 4:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_ShowItemInfo(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      ClearBottomWindow();
      gStorage.state++;
      break;
    case 1:
      PlaySE(K.SE_WIN_OPEN);
      PrintItemDescription();
      InitItemInfoWindow();
      gStorage.state++;
      break;
    case 2:
      if (!UpdateItemInfoWindowSlideIn()) gStorage.state++;
      break;
    case 3:
      gStorage.state++;
      break;
    case 4:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        PlaySE(K.SE_WIN_OPEN);
        gStorage.state++;
      }
      break;
    case 5:
      if (!UpdateItemInfoWindowSlideOut()) gStorage.state++;
      break;
    case 6:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_CloseBoxWhileHoldingItem(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PlaySE(K.SE_SELECT);
      PrintStorageMessage(MSG_PUT_IN_BAG);
      ShowYesNoWindow(0);
      gStorage.state = 1;
      break;
    case 1:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case MENU_B_PRESSED:
        case 1:
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case 0:
          if (AddBagItem(gStorage.movingItemId, 1)) {
            ClearBottomWindow();
            gStorage.state = 3;
          } else {
            PrintStorageMessage(MSG_BAG_FULL);
            gStorage.state = 2;
          }
          break;
      }
      break;
    case 2:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        gStorage.state = 5;
      }
      break;
    case 3:
      MoveItemFromCursorToBag();
      gStorage.state = 4;
      break;
    case 4:
      if (!IsItemIconAnimActive()) {
        StartCursorAnim(K.CURSOR_ANIM_BOUNCE);
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 5:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_HandleMovingMonFromParty(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      CompactPartySlots();
      CompactPartySprites();
      gStorage.state++;
      break;
    case 1:
      if (GetNumPartySpritesCompacting() === 0) {
        UpdatePartySlotColors();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_PrintCantStoreMail(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_CANT_STORE_MAIL);
      gStorage.state++;
      break;
    case 1:
      gStorage.state++;
      break;
    case 2:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        gStorage.state++;
      }
      break;
    case 3:
      SetPokeStorageTask(Task_PokeStorageMain);
      break;
  }
}

function Task_HandleBoxOptions(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_WHAT_YOU_DO);
      AddMenu();
      gStorage.state++;
      break;
    case 1:
      if (IsMenuLoading()) return;
      gStorage.state++;
    // fallthrough
    case 2:
      switch (HandleMenuInput()) {
        case MENU_B_PRESSED:
        case K.MENU_TEXT_CANCEL:
          AnimateBoxScrollArrows(true);
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case K.MENU_TEXT_NAME:
          PlaySE(K.SE_SELECT);
          SetPokeStorageTask(Task_NameBox);
          break;
        case K.MENU_TEXT_WALLPAPER:
          PlaySE(K.SE_SELECT);
          ClearBottomWindow();
          SetPokeStorageTask(Task_HandleWallpapers);
          break;
        case K.MENU_TEXT_JUMP:
          PlaySE(K.SE_SELECT);
          ClearBottomWindow();
          SetPokeStorageTask(Task_JumpBox);
          break;
      }
      break;
  }
}

function Task_HandleWallpapers(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      AddWallpaperSetsMenu();
      PrintStorageMessage(MSG_PICK_A_THEME);
      gStorage.state++;
      break;
    case 1:
      if (!IsMenuLoading()) gStorage.state++;
      break;
    case 2:
      gStorage.wallpaperSetId = HandleMenuInput();
      switch (gStorage.wallpaperSetId) {
        case MENU_B_PRESSED:
          AnimateBoxScrollArrows(true);
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case K.MENU_TEXT_SCENERY_1:
        case K.MENU_TEXT_SCENERY_2:
        case K.MENU_TEXT_SCENERY_3:
        case K.MENU_TEXT_ETCETERA:
          PlaySE(K.SE_SELECT);
          RemoveMenu();
          gStorage.wallpaperSetId -= K.MENU_TEXT_SCENERY_1;
          gStorage.state++;
          break;
      }
      break;
    case 3:
      AddWallpapersMenu(gStorage.wallpaperSetId);
      PrintStorageMessage(MSG_PICK_A_WALLPAPER);
      gStorage.state++;
      break;
    case 4:
      gStorage.wallpaperId = HandleMenuInput();
      switch (gStorage.wallpaperId) {
        case MENU_NOTHING_CHOSEN:
          break;
        case MENU_B_PRESSED:
          ClearBottomWindow();
          gStorage.state = 0;
          break;
        default:
          PlaySE(K.SE_SELECT);
          ClearBottomWindow();
          gStorage.wallpaperId -= K.MENU_TEXT_FOREST;
          SetWallpaperForCurrentBox(gStorage.wallpaperId);
          gStorage.state++;
          break;
      }
      break;
    case 5:
      if (!DoWallpaperGfxChange()) {
        AnimateBoxScrollArrows(true);
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_JumpBox(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      PrintStorageMessage(MSG_JUMP_TO_WHICH_BOX);
      LoadChooseBoxMenuGfx(gStorage.chooseBoxMenu, K.GFXTAG_CHOOSE_BOX_MENU_CENTER, K.PALTAG_MISC_1, 3, false);
      CreateChooseBoxMenuSprites(state.storage.getCurrentBox());
      gStorage.state++;
      break;
    case 1:
      gStorage.newCurrBoxId = HandleBoxChooseSelectionInput();
      switch (gStorage.newCurrBoxId) {
        case K.BOXID_NONE_CHOSEN:
          break;
        default:
          ClearBottomWindow();
          DestroyChooseBoxMenuSprites();
          FreeBoxSelectionPopupSpriteGfx();
          if (gStorage.newCurrBoxId === K.BOXID_CANCELED || gStorage.newCurrBoxId === state.storage.getCurrentBox()) {
            AnimateBoxScrollArrows(true);
            SetPokeStorageTask(Task_PokeStorageMain);
          } else {
            gStorage.state++;
          }
          break;
      }
      break;
    case 2:
      SetUpScrollToBox(gStorage.newCurrBoxId);
      gStorage.state++;
      break;
    case 3:
      if (!ScrollToBox()) {
        state.storage.setCurrentBox(gStorage.newCurrBoxId);
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
  }
}

function Task_NameBox(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      SaveMovingMon();
      BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
      gStorage.state++;
      break;
    case 1:
      if (!UpdatePaletteFade()) {
        sWhichToReshow = SCREEN_CHANGE_NAME_BOX - 1;
        gStorage.screenChangeType = SCREEN_CHANGE_NAME_BOX;
        SetPokeStorageTask(Task_ChangeScreen);
      }
      break;
  }
}

function Task_ShowMonSummary(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      InitSummaryScreenData();
      BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
      gStorage.state++;
      break;
    case 1:
      if (!UpdatePaletteFade()) {
        sWhichToReshow = SCREEN_CHANGE_SUMMARY_SCREEN - 1;
        gStorage.screenChangeType = SCREEN_CHANGE_SUMMARY_SCREEN;
        SetPokeStorageTask(Task_ChangeScreen);
      }
      break;
  }
}

function Task_GiveItemFromBag(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
      gStorage.state++;
      break;
    case 1:
      if (!UpdatePaletteFade()) {
        sWhichToReshow = SCREEN_CHANGE_ITEM_FROM_BAG - 1;
        gStorage.screenChangeType = SCREEN_CHANGE_ITEM_FROM_BAG;
        SetPokeStorageTask(Task_ChangeScreen);
      }
      break;
  }
}

function Task_OnCloseBoxPressed(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (IsMonBeingMoved()) {
        PlaySE(K.SE_FAILURE);
        PrintStorageMessage(MSG_HOLDING_POKE);
        gStorage.state = 1;
      } else if (IsActiveItemMoving()) {
        SetPokeStorageTask(Task_CloseBoxWhileHoldingItem);
      } else {
        PlaySE(K.SE_SELECT);
        PrintStorageMessage(MSG_EXIT_BOX);
        ShowYesNoWindow(0);
        gStorage.state = 2;
      }
      break;
    case 1:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 2:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case MENU_B_PRESSED:
        case 1:
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case 0:
          PlaySE(K.SE_PC_OFF);
          ClearBottomWindow();
          gStorage.state++;
          break;
      }
      break;
    case 3:
      BeginPCScreenEffect_TurnOff(20, 0, 1);
      gStorage.state++;
      break;
    case 4:
      if (!IsPCScreenEffectRunning_TurnOff()) {
        UpdateBoxToSendMons();
        // gPlayerPartyCount = CalculatePlayerPartyCount(): the port counts state.party
        gStorage.screenChangeType = SCREEN_CHANGE_EXIT_BOX;
        SetPokeStorageTask(Task_ChangeScreen);
      }
      break;
  }
}

function Task_OnBPressed(_taskId: number): void {
  switch (gStorage.state) {
    case 0:
      if (IsMonBeingMoved()) {
        PlaySE(K.SE_FAILURE);
        PrintStorageMessage(MSG_HOLDING_POKE);
        gStorage.state = 1;
      } else if (IsActiveItemMoving()) {
        SetPokeStorageTask(Task_CloseBoxWhileHoldingItem);
      } else {
        PlaySE(K.SE_SELECT);
        PrintStorageMessage(MSG_CONTINUE_BOX);
        ShowYesNoWindow(0);
        gStorage.state = 2;
      }
      break;
    case 1:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) {
        ClearBottomWindow();
        SetPokeStorageTask(Task_PokeStorageMain);
      }
      break;
    case 2:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case 0:
          ClearBottomWindow();
          SetPokeStorageTask(Task_PokeStorageMain);
          break;
        case 1:
        case MENU_B_PRESSED:
          PlaySE(K.SE_PC_OFF);
          ClearBottomWindow();
          gStorage.state++;
          break;
      }
      break;
    case 3:
      BeginPCScreenEffect_TurnOff(20, 0, 0);
      gStorage.state++;
      break;
    case 4:
      if (!IsPCScreenEffectRunning_TurnOff()) {
        UpdateBoxToSendMons();
        gStorage.screenChangeType = SCREEN_CHANGE_EXIT_BOX;
        SetPokeStorageTask(Task_ChangeScreen);
      }
      break;
  }
}

function Task_ChangeScreen(taskId: number): void {
  const screenChangeType = gStorage.screenChangeType;

  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS && IsActiveItemMoving()) sMovingItemId = GetMovingItem();
  else sMovingItemId = K.ITEM_NONE;

  switch (screenChangeType) {
    case SCREEN_CHANGE_EXIT_BOX:
    default:
      FreePokeStorageData();
      SetMainCallback2(CB2_ExitPokeStorage);
      break;
    case SCREEN_CHANGE_SUMMARY_SCREEN: {
      const mons = gStorage.summaryMons;
      const cursorPos = gStorage.summaryCursorPos;
      const lastIndex = gStorage.summaryLastIndex;
      const mode = gStorage.summaryScreenMode;
      FreePokeStorageData();
      ShowPokemonSummaryScreen(mons, cursorPos, lastIndex, CB2_ReturnToPokeStorage, mode);
      break;
    }
    case SCREEN_CHANGE_NAME_BOX: {
      FreePokeStorageData();
      // GetBoxNamePtr(StorageGetCurrentBox()): the naming screen writes into the box's name buffer
      const boxId = state.storage.getCurrentBox();
      const dest = [...(state.storage.getBoxName(boxId) ?? []), EOS];
      DoNamingScreen(NAMING_SCREEN_BOX, dest, 0, 0, 0, () => {
        state.storage.setBoxName(boxId, strBody(dest));
        CB2_ReturnToPokeStorage();
      });
      break;
    }
    case SCREEN_CHANGE_ITEM_FROM_BAG:
      FreePokeStorageData();
      GoToBagMenu(K.ITEMMENULOCATION_PCBOX, K.OPEN_BAG_ITEMS, CB2_ReturnToPokeStorage);
      break;
  }

  DestroyTask(taskId);
}

/** gSpecialVar_ItemId, which the bag's PC box context (Task_ItemContext_PcBoxGive) sets. */
function GiveChosenBagItem(): void {
  const item = SpecialVar.ItemId;
  if (item !== K.ITEM_NONE) {
    const id = GetBoxCursorPosition();
    if (sInPartyMenu) {
      const mon = gPlayerParty[id];
      if (mon) mon.heldItem = item;
    } else {
      state.storage.setCurrentBoxMonData(id, 'heldItem', item);
    }
    RemoveBagItem(item, 1);
  }
}

function FreePokeStorageData(): void {
  TilemapUtil_Free();
  MultiMove_Free();
  StorePlayerParty();
  FreeAllWindowBuffers();
}

function SetScrollingBackground(): void {
  SetGpuReg(REG_OFFSET_BG3CNT, (3 << 0) | (3 << 2) | (31 << 8)); // BGCNT_PRIORITY(3) | BGCNT_CHARBASE(3) | BGCNT_16COLOR | BGCNT_SCREENBASE(31)
  const tiles = gfx('sScrollingBg_Gfx'); // DecompressAndLoadBgGfxUsingHeap
  LoadBgTiles(3, tiles, tiles.length, 0);
  vram.set(gfx('sScrollingBg_Tilemap'), BG_SCREEN_ADDR(31));
}

function ScrollBackground(): void {
  ChangeBgX(3, 128, 1);
  ChangeBgY(3, 128, 2);
}

function LoadPokeStorageMenuGfx(): void {
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  const tiles = gfx('gPokeStorageMenu_Gfx'); // DecompressAndLoadBgGfxUsingHeap
  LoadBgTiles(1, tiles, tiles.length, 0);
  gStorage.menuTilemapBuffer.set(gfx16('sMenu_Tilemap').subarray(0, gStorage.menuTilemapBuffer.length));
  SetBgTilemapBuffer(1, gStorage.menuTilemapBuffer);
  ShowBg(1);
  ScheduleBgCopyTilemapToVram(1);
}

function InitPokeStorageWindows(): boolean {
  if (!InitWindows(sWindowTemplates)) return false;
  DeactivateAllTextPrinters();
  return true;
}

function LoadsMiscSpritePalette(): void {
  LoadSpritePalette({ data: gfx16('sPokeStorageMisc2Pal'), tag: K.PALTAG_MISC_2 });
}

function InitPalettesAndSprites(): void {
  LoadPalette(gfx16('gPokeStorageInterface_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gPokeStorageInterface_NoDisplayMon_Pal'), BG_PLTT_ID(2), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sItemInfoFrame_Pal'), BG_PLTT_ID(15), 32);
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) LoadPalette(gfx16('sScrollingBg_Pal'), BG_PLTT_ID(3), 32);
  else LoadPalette(gfx16('sScrollingBgMoveItems_Pal'), BG_PLTT_ID(3), 32);

  SetGpuReg(REG_OFFSET_BG1CNT, (1 << 0) | (1 << 2) | (30 << 8)); // BGCNT_PRIORITY(1) | BGCNT_CHARBASE(1) | BGCNT_16COLOR | BGCNT_SCREENBASE(30)
  CreateDisplayMonSprite();
  CreateMarkingComboSprite();
  CreateWaveformSprites();
  RefreshDisplayMonData();
}

function CreateMarkingComboSprite(): void {
  const sprite = CreateMonMarkingComboSprite(K.GFXTAG_MARKING_COMBO, K.PALTAG_MARKING_COMBO, null)!;
  gStorage.markingComboSprite = sprite;
  sprite.oam.priority = 1;
  sprite.subpriority = 1;
  sprite.x = 40;
  sprite.y = 150;
  gStorage.markingComboTilesAddr = OBJ_VRAM0 + 32 * GetSpriteTileStartByTag(K.GFXTAG_MARKING_COMBO);
}

function CreateWaveformSprites(): void {
  LoadSpriteSheet({ data: gfx('sWaveform_Gfx'), size: 0x01c0, tag: K.GFXTAG_WAVEFORM });
  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_Waveform(), i * 63 + 8, 9, 2);
    gStorage.waveformSprites[i] = gSprites[spriteId];
  }
}

/** RefreshDisplayMonData */
export function RefreshDisplayMonData(): void {
  LoadDisplayMonGfx(gStorage.displayMonSpecies, gStorage.displayMonPersonality);
  PrintDisplayMonInfo();
  UpdateWaveformAnimation();
  ScheduleBgCopyTilemapToVram(0);
}

/** StartDisplayMonMosaic (OBJ mosaic isn't drawn by the PPU: the pic just appears when the effect ends). */
function StartDisplayMonMosaic(): void {
  RefreshDisplayMonData();
  const sprite = gStorage.displayMonSprite;
  if (sprite) {
    sprite.oam.mosaic = 1;
    sprite.data[0] = 10;
    sprite.data[1] = 1;
    sprite.callback = SpriteCB_DisplayMonMosaic;
    SetGpuReg(REG_OFFSET_MOSAIC, (sprite.data[0] << 12) | (sprite.data[0] << 8));
  }
}

function IsDisplayMonMosaicActive(): boolean {
  return !!gStorage.displayMonSprite?.oam.mosaic;
}

function SpriteCB_DisplayMonMosaic(sprite: Sprite): void {
  sprite.data[0] -= sprite.data[1];
  if (sprite.data[0] < 0) sprite.data[0] = 0;
  SetGpuReg(REG_OFFSET_MOSAIC, (sprite.data[0] << 12) | (sprite.data[0] << 8));
  if (sprite.data[0] === 0) {
    sprite.oam.mosaic = 0;
    sprite.callback = SpriteCallbackDummy;
  }
}

function CreateDisplayMonSprite(): void {
  gStorage.tileBuffer.fill(0);
  gStorage.displayMonPalBuffer.fill(0);
  gStorage.displayMonSprite = null;
  do {
    const tileStart = LoadSpriteSheet({ data: gStorage.tileBuffer, size: K.MON_PIC_SIZE, tag: K.GFXTAG_DISPLAY_MON });
    if (tileStart === 0) break;
    const palSlot = LoadSpritePalette({ data: gStorage.displayMonPalBuffer, tag: K.PALTAG_DISPLAY_MON });
    if (palSlot === 0xff) break;
    const spriteId = CreateSprite(sSpriteTemplate_DisplayMon(), 40, 48, 0);
    if (spriteId === MAX_SPRITES) break;
    gStorage.displayMonSprite = gSprites[spriteId];
    gStorage.displayMonPalOffset = OBJ_PLTT_ID(palSlot);
    gStorage.displayMonTileAddr = OBJ_VRAM0 + tileStart * 32;
  } while (false);

  if (gStorage.displayMonSprite === null) {
    FreeSpriteTilesByTag(K.GFXTAG_DISPLAY_MON);
    FreeSpritePaletteByTag(K.PALTAG_DISPLAY_MON);
  }
}

function LoadDisplayMonGfx(species: number, personality: number): void {
  if (gStorage.displayMonSprite === null) return;
  if (species !== K.SPECIES_NONE) {
    LoadSpecialPokePic(true, species, personality, gStorage.tileBuffer);
    gStorage.displayMonPalBuffer.set(gStorage.displayMonPalette!.subarray(0, 16));
    vram.set(gStorage.tileBuffer, gStorage.displayMonTileAddr);
    LoadPalette(gStorage.displayMonPalBuffer, gStorage.displayMonPalOffset, PLTT_SIZE_4BPP);
    gStorage.displayMonSprite.invisible = false;
  } else {
    gStorage.displayMonSprite.invisible = true;
  }
}

/** GetMonSpritePalFromSpeciesAndPersonality, for SetDisplayMonData */
export function DisplayMonPalette(species: number, otId: number, personality: number): Uint16Array {
  return GetMonSpritePalFromSpeciesAndPersonality(species, otId, personality);
}

/** PrintDisplayMonInfo */
export function PrintDisplayMonInfo(): void {
  FillWindowPixelBuffer(0, PIXEL_FILL(1));
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
    let y = 0;
    for (let i = 0; i < 3; i++, y += 14) AddTextPrinterParameterized(0, K.FONT_NORMAL, gStorage.displayMonTexts[i], i === 2 ? 10 : 6, y, TEXT_SKIP_DRAW);
    AddTextPrinterParameterized(0, K.FONT_SMALL, gStorage.displayMonTexts[3], 6, y + 2, TEXT_SKIP_DRAW);
  } else {
    AddTextPrinterParameterized(0, K.FONT_SMALL, gStorage.displayMonTexts[3], 6, 0, TEXT_SKIP_DRAW);
    let y = 15;
    for (let i = 0; i < 3; i++, y += 14) AddTextPrinterParameterized(0, K.FONT_NORMAL, gStorage.displayMonTexts[i], i === 2 ? 10 : 6, y, TEXT_SKIP_DRAW);
  }

  CopyWindowToVram(0, COPYWIN_GFX);
  if (gStorage.displayMonSpecies !== K.SPECIES_NONE) {
    UpdateMonMarkingTiles(gStorage.displayMonMarkings, gStorage.markingComboTilesAddr);
    gStorage.markingComboSprite!.invisible = false;
  } else {
    gStorage.markingComboSprite!.invisible = true;
  }
}

function UpdateWaveformAnimation(): void {
  if (gStorage.displayMonSpecies !== K.SPECIES_NONE) {
    TilemapUtil_SetRect(TILEMAP_PKMN_DATA, 0, 0, 8, 2);
    for (let i = 0; i < 2; i++) StartSpriteAnimIfDifferent(gStorage.waveformSprites[i]!, i * 2 + 1);
  } else {
    TilemapUtil_SetRect(TILEMAP_PKMN_DATA, 0, 2, 8, 2);
    for (let i = 0; i < 2; i++) StartSpriteAnim(gStorage.waveformSprites[i]!, i * 2);
  }
  TilemapUtil_Update(TILEMAP_PKMN_DATA);
  ScheduleBgCopyTilemapToVram(1);
}

function InitSupplementalTilemaps(): void {
  gStorage.partyMenuTilemapBuffer.set(gfx16('gPokeStoragePartyMenu_Tilemap').subarray(0, 0x108));
  LoadPalette(gfx16('gPokeStoragePartyMenu_Pal'), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
  TilemapUtil_SetTilemap(TILEMAP_PARTY_MENU, 1, gStorage.partyMenuTilemapBuffer, 12, 22);
  TilemapUtil_SetTilemap(TILEMAP_CLOSE_BUTTON, 1, gfx16('sCloseBoxButton_Tilemap'), 9, 4);
  TilemapUtil_SetPos(TILEMAP_PARTY_MENU, 10, 0);
  TilemapUtil_SetPos(TILEMAP_CLOSE_BUTTON, 21, 0);
  SetPartySlotTilemaps();
  if (sInPartyMenu) {
    UpdateCloseBoxButtonTilemap(true);
    CreatePartyMonsSprites(true);
    TilemapUtil_Update(TILEMAP_CLOSE_BUTTON);
    TilemapUtil_Update(TILEMAP_PARTY_MENU);
  } else {
    TilemapUtil_SetRect(TILEMAP_PARTY_MENU, 0, 20, 12, 2);
    UpdateCloseBoxButtonTilemap(true);
    TilemapUtil_Update(TILEMAP_PARTY_MENU);
    TilemapUtil_Update(TILEMAP_CLOSE_BUTTON);
  }
  ScheduleBgCopyTilemapToVram(1);
  gStorage.closeBoxFlashing = false;
}

function SetUpShowPartyMenu(): void {
  gStorage.partyMenuUnused1 = 20;
  gStorage.partyMenuY = 2;
  gStorage.partyMenuMoveTimer = 0;
  CreatePartyMonsSprites(false);
}

function ShowPartyMenu(): boolean {
  if (gStorage.partyMenuMoveTimer === 20) return false;
  gStorage.partyMenuUnused1--;
  gStorage.partyMenuY++;
  TilemapUtil_Move(TILEMAP_PARTY_MENU, 3, 1);
  TilemapUtil_Update(TILEMAP_PARTY_MENU);
  ScheduleBgCopyTilemapToVram(1);
  MovePartySprites(8);
  if (++gStorage.partyMenuMoveTimer === 20) {
    sInPartyMenu = true;
    return false;
  }
  return true;
}

function SetUpHidePartyMenu(): void {
  gStorage.partyMenuUnused1 = 0;
  gStorage.partyMenuY = 22;
  gStorage.partyMenuMoveTimer = 0;
  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) MoveHeldItemWithPartyMenu();
}

function HidePartyMenu(): boolean {
  if (gStorage.partyMenuMoveTimer !== 20) {
    gStorage.partyMenuUnused1++;
    gStorage.partyMenuY--;
    TilemapUtil_Move(TILEMAP_PARTY_MENU, 3, -1);
    TilemapUtil_Update(TILEMAP_PARTY_MENU);
    FillBgTilemapBufferRect_Palette0(1, 0x100, 10, gStorage.partyMenuY, 12, 1);
    MovePartySprites(-8);
    if (++gStorage.partyMenuMoveTimer !== 20) {
      ScheduleBgCopyTilemapToVram(1);
      return true;
    }
    sInPartyMenu = false;
    DestroyAllPartyMonIcons();
    CompactPartySlots();
    TilemapUtil_SetRect(TILEMAP_CLOSE_BUTTON, 0, 0, 9, 2);
    TilemapUtil_Update(TILEMAP_CLOSE_BUTTON);
    ScheduleBgCopyTilemapToVram(1);
    return false;
  }
  return false;
}

function UpdateCloseBoxButtonTilemap(normal: boolean): void {
  if (normal) TilemapUtil_SetRect(TILEMAP_CLOSE_BUTTON, 0, 0, 9, 2);
  else TilemapUtil_SetRect(TILEMAP_CLOSE_BUTTON, 0, 2, 9, 2);
  TilemapUtil_Update(TILEMAP_CLOSE_BUTTON);
  ScheduleBgCopyTilemapToVram(1);
}

function StartFlashingCloseBoxButton(): void {
  gStorage.closeBoxFlashing = true;
  gStorage.closeBoxFlashTimer = 30;
  gStorage.closeBoxFlashState = true;
}

function StopFlashingCloseBoxButton(): void {
  if (gStorage.closeBoxFlashing) {
    gStorage.closeBoxFlashing = false;
    UpdateCloseBoxButtonTilemap(true);
  }
}

function UpdateCloseBoxButtonFlash(): void {
  if (gStorage.closeBoxFlashing && ++gStorage.closeBoxFlashTimer > 30) {
    gStorage.closeBoxFlashTimer = 0;
    gStorage.closeBoxFlashState = !gStorage.closeBoxFlashState;
    UpdateCloseBoxButtonTilemap(gStorage.closeBoxFlashState);
  }
}

function SetPartySlotTilemaps(): void {
  // Skips first party slot, it should always be drawn as if it has a Pokémon in it
  for (let i = 1; i < K.PARTY_SIZE; i++) SetPartySlotTilemap(i, PartySpecies(i) !== K.SPECIES_NONE);
}

function SetPartySlotTilemap(pos: number, isFilled: boolean): void {
  const tilemap = gfx16(isFilled ? 'sPartySlotFilled_Tilemap' : 'sPartySlotEmpty_Tilemap');
  let index = 3 * (3 * (pos - 1) + 1);
  index *= 4;
  index += 7;
  let t = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) gStorage.partyMenuTilemapBuffer[index + j] = tilemap[t + j];
    t += 4;
    index += 12;
  }
}

function UpdatePartySlotColors(): void {
  SetPartySlotTilemaps();
  TilemapUtil_SetRect(TILEMAP_PARTY_MENU, 0, 0, 12, 22);
  TilemapUtil_Update(TILEMAP_PARTY_MENU);
  ScheduleBgCopyTilemapToVram(1);
}

function SetUpDoShowPartyMenu(): void {
  gStorage.showPartyMenuState = 0;
  PlaySE(K.SE_WIN_OPEN);
  SetUpShowPartyMenu();
}

function DoShowPartyMenu(): boolean {
  switch (gStorage.showPartyMenuState) {
    case 0:
      if (!ShowPartyMenu()) {
        SetCursorInParty();
        gStorage.showPartyMenuState++;
      }
      break;
    case 1:
      if (!UpdateCursorPos()) {
        if (gStorage.setMosaic) StartDisplayMonMosaic();
        gStorage.showPartyMenuState++;
      }
      break;
    case 2:
      return false;
  }
  return true;
}

function InitPokeStorageBg0(): void {
  SetGpuReg(REG_OFFSET_BG0CNT, (0 << 0) | (0 << 2) | (29 << 8)); // BGCNT_PRIORITY(0) | BGCNT_CHARBASE(0) | BGCNT_SCREENBASE(29)
  LoadStdWindowGfx(1, 2, BG_PLTT_ID(13));
  FillBgTilemapBufferRect(0, 0, 0, 0, 32, 20, 17);
  CopyBgTilemapBufferToVram(0);
}

function PrintStorageMessage(id: number): void {
  DynamicPlaceholderTextUtil_Reset();
  const [symbol, format] = sMessages[id];
  switch (format) {
    case MSG_FMT_NONE:
      break;
    case MSG_FMT_MON_NAME_1:
    case 2:
    case 3:
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, gStorage.displayMonNickname);
      break;
    case MSG_FMT_RELEASE_MON_1:
    case 5:
    case MSG_FMT_RELEASE_MON_3:
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, gStorage.releaseMonName);
      break;
    case MSG_FMT_ITEM_NAME: {
      const name = strBody(IsActiveItemMoving() ? GetMovingItemName() : gStorage.displayMonTexts[3]);
      while (name.length && name[name.length - 1] === K.CHAR_SPACE) name.pop();
      gStorage.itemName = [...name, EOS];
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, gStorage.itemName);
      break;
    }
  }
  gStorage.actionText = DynamicPlaceholderTextUtil_ExpandPlaceholders(text(symbol));
  FillWindowPixelBuffer(1, PIXEL_FILL(1));
  AddTextPrinterParameterized(1, K.FONT_NORMAL_COPY_1, gStorage.actionText, 0, 2, TEXT_SKIP_DRAW);
  DrawTextBorderOuter(1, 2, 13);
  PutWindowTilemap(1);
  CopyWindowToVram(1, COPYWIN_GFX);
  ScheduleBgCopyTilemapToVram(0);
}

function ShowYesNoWindow(cursorPos: number): void {
  CreateYesNoMenu(sYesNoWindowTemplate, K.FONT_NORMAL_COPY_1, 0, 2, 11, 14, 1);
  Menu_MoveCursorNoWrapAround(cursorPos);
}

function ClearBottomWindow(): void {
  ClearStdWindowAndFrameToTransparent(1, false);
  ScheduleBgCopyTilemapToVram(0);
}

function AddWallpaperSetsMenu(): void {
  InitMenu();
  SetMenuText(K.MENU_TEXT_SCENERY_1);
  SetMenuText(K.MENU_TEXT_SCENERY_2);
  SetMenuText(K.MENU_TEXT_SCENERY_3);
  SetMenuText(K.MENU_TEXT_ETCETERA);
  AddMenu();
}

function AddWallpapersMenu(wallpaperSet: number): void {
  InitMenu();
  switch (wallpaperSet) {
    case 0: // SCENERY_1
      SetMenuText(K.MENU_TEXT_FOREST);
      SetMenuText(K.MENU_TEXT_CITY);
      SetMenuText(K.MENU_TEXT_DESERT);
      SetMenuText(K.MENU_TEXT_SAVANNA);
      break;
    case 1: // SCENERY_2
      SetMenuText(K.MENU_TEXT_CRAG);
      SetMenuText(K.MENU_TEXT_VOLCANO);
      SetMenuText(K.MENU_TEXT_SNOW);
      SetMenuText(K.MENU_TEXT_CAVE);
      break;
    case 2: // SCENERY_3
      SetMenuText(K.MENU_TEXT_BEACH);
      SetMenuText(K.MENU_TEXT_SEAFLOOR);
      SetMenuText(K.MENU_TEXT_RIVER);
      SetMenuText(K.MENU_TEXT_SKY);
      break;
    case 3: // ETCETERA
      SetMenuText(K.MENU_TEXT_POLKADOT);
      SetMenuText(K.MENU_TEXT_POKECENTER);
      SetMenuText(K.MENU_TEXT_MACHINE);
      SetMenuText(K.MENU_TEXT_SIMPLE);
      break;
  }
  AddMenu();
}

/** GetCurrentBoxOption */
export function GetCurrentBoxOption(): number {
  return sCurrentBoxOption;
}

function InitCursorItemIcon(): void {
  if (!IsCursorOnBoxTitle()) TryLoadItemIconAtPos(sInPartyMenu ? K.CURSOR_AREA_IN_PARTY : K.CURSOR_AREA_IN_BOX, GetBoxCursorPosition());
  if (sMovingItemId !== K.ITEM_NONE) {
    InitItemIconInCursor(sMovingItemId);
    StartCursorAnim(K.CURSOR_ANIM_FIST);
  }
}

/** SetPokeStorageQuestLogEvent: the quest log isn't ported. */
function SetPokeStorageQuestLogEvent(_action: number): void {
  void GetMovingMonOriginalBoxId;
}

function UpdateBoxToSendMons(): void {
  if (sLastUsedBox !== state.storage.getCurrentBox()) {
    state.setFlag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE', false);
    state.setVar('VAR_PC_BOX_TO_SEND_MON', state.storage.getCurrentBox());
  }
}

export { ClearBottomWindow, PrintStorageMessage };

/** Test probe: the box screen's state (see __test.pcStorage). */
export function storageProbe(): {
  task: string;
  state: number;
  cursor: { area: number; position: number; holding: boolean };
  inParty: boolean;
  box: number;
  displaySpecies: number;
  message: number[];
  menu: number[][];
  chooseBox: number;
} {
  return {
    task: gTasks[gStorage.taskId].func.name,
    state: gStorage.state,
    cursor: StorageCursor(),
    inParty: sInPartyMenu,
    box: state.storage.getCurrentBox(),
    displaySpecies: gStorage.displayMonSpecies,
    message: gStorage.actionText,
    menu: gStorage.menuItems.slice(0, gStorage.menuItemsCount).map((m) => m.text),
    chooseBox: ChooseBoxMenuCurBox(),
  };
}
