// item_menu.c: the bag. Three pockets (items, key items, Poké Balls) as a list menu, the context menu
// per item, tossing, registering, giving, selling, and the in-battle and Old Man tutorial bags.
// The Teachy TV scripted bags, the item PC and the Pokémon storage give flow aren't ported (their
// screens don't exist); entering them logs and falls back to the normal bag.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { AddPCItem } from '../state/pcItems';
import { CopyToBgTilemapBufferRect, FillBgTilemapBufferRect_Palette0, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  PALETTES_ALL,
  SetGpuReg,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
} from '../gba/hw';
import {
  DestroyListMenuTask,
  gMultiuseListMenuTemplate,
  LIST_CANCEL,
  LIST_NOTHING_CHOSEN,
  LISTFIELD_CURSORKIND,
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuGetYCoordForPrintingArrowCursor,
  ListMenuInit,
  ListMenuSetTemplateField,
  type ListMenu,
  type ListMenuItem,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import {
  AddItemMenuActionTextPrinters,
  AdjustQuantityAccordingToDPadInput,
  ClearScheduledBgCopiesToVram,
  DecompressAndCopyTileDataToVram,
  DisplayMessageAndContinueTask,
  DoScheduledBgTilemapCopiesToVram,
  FreeTempTileDataBuffersIfPossible,
  GetLRKeysPressed,
  GetMenuCursorDimensionByFont,
  GetTextSpeedSetting,
  IsActiveOverworldLinkBusy,
  MENU_B_PRESSED,
  MENU_L_PRESSED,
  MENU_NOTHING_CHOSEN,
  MENU_R_PRESSED,
  Menu_InitCursor,
  Menu_MoveCursorNoWrapAround,
  Menu_ProcessInputNoWrapAround,
  MenuHelpers_IsLinkActive,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ResetTempTileDataBuffers,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
  type MenuAction,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadCompressedPalette, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, LoadCompressedSpriteSheet, LoadSpritePalette, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, ResetTasks, RunTasks, SetTaskFuncWithFollowupFunc, SwitchTaskToFollowupFunc, type TaskFunc } from '../gba/task';
import {
  BlitBitmapToWindow,
  ClearWindowTilemap,
  COPYWIN_MAP,
  CopyWindowToVram,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_LETTER_SPACING,
  FONTATTR_MAX_LETTER_HEIGHT,
  FreeAllWindowBuffers,
  GetFontAttribute,
  gTextFlags,
  PIXEL_FILL,
  PutWindowTilemap,
} from '../gba/window';
import { SetCB2ToReshowScreenAfterMenu2 } from '../battle/reshowBattleScreen';
import {
  BagCreateYesNoMenuBottomRight,
  BagCreateYesNoMenuTopRight,
  BagDrawDepositItemTextBox,
  BagDrawTextBoxOnWindow,
  BagPrintMoneyAmount,
  BagPrintTextOnWin1CenteredColor0,
  BagPrintTextOnWindow,
  CloseBagWindow,
  GetBagWindow,
  HideBagWindow,
  InitBagWindows,
  OpenBagWindow,
  ShowBagWindow,
} from './bag';
import {
  AddBagItem,
  bagPocket,
  BagGetItemIdByPocketPosition,
  BagGetQuantityByPocketPosition,
  BagPocketCompaction,
  CalculatePlayerPartyCount,
  concat,
  ConvertIntToDecimalStringN,
  CopyItemName,
  encodeRaw,
  ExpandToStringVar4,
  gStringVar1,
  gStringVar2,
  gStringVar3,
  ItemId_GetBattleFunc,
  ItemId_GetBattleUsage,
  ItemId_GetDescription,
  ItemId_GetFieldFunc,
  ItemId_GetImportance,
  ItemId_GetName,
  ItemId_GetPrice,
  ItemId_GetType,
  ItemIsMail,
  RemoveBagItem,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  text,
} from './common';
import { CB2_ReturnToField, CB2_ReturnToFieldWithOpenMenu } from './fieldCallbacks';
import {
  CreateBagSprite,
  CreateItemMenuIcon,
  CreateSwapLine,
  DestroyItemMenuIcon,
  gBagSwapSpritePalette,
  gBagSwapSpriteSheet,
  gSpritePalette_Bag,
  gSpriteSheet_BagFemale,
  gSpriteSheet_BagMale,
  ResetItemMenuIconState,
  SetBagVisualPocketId,
  SetSwapLineInvisibility,
  ShakeBagSprite,
  UpdateSwapLinePos,
} from './itemMenuIcons';
import { gBagMenuState, SpecialVar } from './itemMenuState';
import { TestPlayerAvatarFlags } from '../world/playerAvatar';
import { BATTLE_USE_FUNCS, FIELD_USE_FUNCS } from './itemUse';
import { AddScrollIndicatorArrowPair, AddScrollIndicatorArrowPairParameterized, RemoveScrollIndicatorArrowPair, SCROLL_ARROW_LEFT, SCROLL_ARROW_RIGHT, SCROLL_ARROW_UP, type ScrollArrowsTemplate } from './menuIndicators';
import { PrintMoneyAmount, PrintMoneyAmountInMoneyBox } from './money';
import { CB2_ChooseMonToGiveItem, CB2_SelectBagItemToGive, ItemUseCB_MedicineStep, Pokedude_ChooseMonForInBattleItem, setItemUseCB } from './partyMenu';
import { CB2_ReturnToTeachyTV, SetTeachyTvControllerModeToResume } from './teachyTv';
import { FreeRestoreBattleData } from '../battle/battleCallbacks';
import { LoadPlayerParty } from '../battle/controllerPokedude';
import { CB2_ReturnToPokeStorage } from './pokemonStorage';
import { InitTMCase, Pokedude_InitTMCase, TMCASE_GIVE_PARTY, TMCASE_GIVE_PC, TMCASE_SELL } from './tmCase';
import { BERRYPOUCH_FROMMARTSELL, BERRYPOUCH_FROMPARTYGIVE, BERRYPOUCH_FROMPOKEMONSTORAGEPC, InitBerryPouch } from './berryPouch';
import { SetHelpContext } from '../ui/helpSystemContext';
import { ItemUse_SetQuestLogEvent } from '../world/questLogEvents';

const LIST_TILES_WIDTH = 18;
const LIST_TILES_HEIGHT = 12;
const SHRT_MAX = 0x7fff;

/** struct BagMenuAlloc */
interface BagMenuAlloc {
  exitCB: MainCallback | null;
  itemOriginalLocation: number;
  pocketSwitchMode: number;
  itemMenuIcon: number;
  inhibitItemDescriptionPrint: boolean;
  contextMenuSelectedItem: number;
  pocketScrollArrowsTask: number;
  pocketSwitchArrowsTask: number;
  nItems: number[];
  maxShowed: number[];
  data: number[];
}

let sBagMenuDisplay: BagMenuAlloc | null = null;
let sBagBgTilemapBuffer: Uint16Array | null = null;
let sContextMenuItemsBuffer = [0, 0, 0, 0];
let sContextMenuItemsPtr: number[] = [];
let sContextMenuNumItems = 0;
let sBackupPlayerBag: { pockets: { itemId: number; quantity: number }[][]; registeredItem: number; pocket: number; itemsAbove: number[]; cursorPos: number[] } | null = null;

const disp = () => sBagMenuDisplay!;

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
];

const sPocketNames = () => [text('gText_Items2'), text('gText_KeyItems2'), text('gText_PokeBalls2')];

/** sItemMenuContextActions, indexed by ITEMMENUACTION_* */
function sItemMenuContextActions(): MenuAction[] {
  const a: MenuAction[] = [];
  a[K.ITEMMENUACTION_USE] = { text: text('gOtherText_Use'), func: Task_ItemMenuAction_Use };
  a[K.ITEMMENUACTION_TOSS] = { text: text('gOtherText_Toss'), func: Task_ItemMenuAction_Toss };
  a[K.ITEMMENUACTION_REGISTER] = { text: text('gOtherText_Register'), func: Task_ItemMenuAction_ToggleSelect };
  a[K.ITEMMENUACTION_GIVE] = { text: text('gOtherText_Give'), func: Task_ItemMenuAction_Give };
  a[K.ITEMMENUACTION_CANCEL] = { text: text('gFameCheckerText_Cancel'), func: Task_ItemMenuAction_Cancel };
  a[K.ITEMMENUACTION_BATTLE_USE] = { text: text('gOtherText_Use'), func: Task_ItemMenuAction_BattleUse };
  a[K.ITEMMENUACTION_CHECK] = { text: text('gOtherText_Check'), func: Task_ItemMenuAction_Use };
  a[K.ITEMMENUACTION_OPEN] = { text: text('gOtherText_Open'), func: Task_ItemMenuAction_Use };
  a[K.ITEMMENUACTION_OPEN_BERRIES] = { text: text('gOtherText_Open'), func: Task_ItemMenuAction_BattleUse };
  a[K.ITEMMENUACTION_WALK] = { text: text('gOtherText_Walk'), func: Task_ItemMenuAction_Use };
  a[K.ITEMMENUACTION_DESELECT] = { text: text('gOtherText_Deselect'), func: Task_ItemMenuAction_ToggleSelect };
  a[K.ITEMMENUACTION_DUMMY] = { text: text('gString_Dummy'), func: null };
  return a;
}

const sContextMenuItems_Field = () => [
  [K.ITEMMENUACTION_USE, K.ITEMMENUACTION_GIVE, K.ITEMMENUACTION_TOSS, K.ITEMMENUACTION_CANCEL],
  [K.ITEMMENUACTION_USE, K.ITEMMENUACTION_REGISTER, K.ITEMMENUACTION_CANCEL, K.ITEMMENUACTION_DUMMY],
  [K.ITEMMENUACTION_GIVE, K.ITEMMENUACTION_TOSS, K.ITEMMENUACTION_CANCEL, K.ITEMMENUACTION_DUMMY],
];
const sContextMenuItems_CheckGiveTossCancel = () => [K.ITEMMENUACTION_CHECK, K.ITEMMENUACTION_GIVE, K.ITEMMENUACTION_TOSS, K.ITEMMENUACTION_CANCEL];
const sContextMenuItems_BattleUse = () => [K.ITEMMENUACTION_BATTLE_USE, K.ITEMMENUACTION_CANCEL];
const sContextMenuItems_Cancel = () => [K.ITEMMENUACTION_CANCEL, K.ITEMMENUACTION_DUMMY];

/** sItemContextTaskFuncs, indexed by ITEMMENULOCATION_* */
function sItemContextTaskFuncs(location: number): TaskFunc | null {
  switch (location) {
    case K.ITEMMENULOCATION_FIELD:
    case K.ITEMMENULOCATION_BATTLE:
      return Task_ItemContext_FieldOrBattle;
    case K.ITEMMENULOCATION_PARTY:
      return Task_ItemContext_FieldGive;
    case K.ITEMMENULOCATION_SHOP:
      return Task_ItemContext_Sell;
    case K.ITEMMENULOCATION_ITEMPC:
      return Task_ItemContext_Deposit;
    case K.ITEMMENULOCATION_PCBOX:
      return Task_ItemContext_PcBoxGive;
  }
  return null;
}

const sYesNoMenu_Toss = { yesFunc: Task_TossItem_Yes, noFunc: Task_TossItem_No };
const sYesNoMenu_Sell = { yesFunc: Task_SellItem_Yes, noFunc: Task_SellItem_No };

/** sListItemTextColor_RegularItem / sListItemTextColor_TmCase_BerryPouch */
const sListItemTextColor_RegularItem = () => encodeRaw('{COLOR_HIGHLIGHT_SHADOW DARK_GRAY TRANSPARENT LIGHT_GRAY}').slice(0, -1);
const sListItemTextColor_TmCase_BerryPouch = () => encodeRaw('{COLOR_HIGHLIGHT_SHADOW BLUE TRANSPARENT LIGHT_BLUE}').slice(0, -1);

const sPocketSwitchArrowPairTemplate: ScrollArrowsTemplate = {
  firstArrowType: SCROLL_ARROW_LEFT,
  firstX: 8,
  firstY: 72,
  secondArrowType: SCROLL_ARROW_RIGHT,
  secondX: 72,
  secondY: 72,
  fullyUpThreshold: 0,
  fullyDownThreshold: 2,
  tileTag: 111,
  palTag: 111,
  palNum: 0,
};

// task data
const tSwitchDir = 11;
const tSwitchCounter = 12;
const tSwitchState = 13;

/** DestroyListMenuTask(data[0], &cursorPos[pocket], &itemsAbove[pocket]) */
function destroyBagList(listTaskId: number): void {
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(listTaskId, out);
  gBagMenuState.cursorPos[gBagMenuState.pocket] = out.cursorPos;
  gBagMenuState.itemsAbove[gBagMenuState.pocket] = out.itemsAbove;
}

/** ListMenuGetScrollAndRow(data[0], &cursorPos[pocket], &itemsAbove[pocket]) */
function saveBagScroll(listTaskId: number): void {
  const r = ListMenuGetScrollAndRow(listTaskId);
  gBagMenuState.cursorPos[gBagMenuState.pocket] = r.cursorPos;
  gBagMenuState.itemsAbove[gBagMenuState.pocket] = r.itemsAbove;
}

/** ListMenuInit(&gMultiuseListMenuTemplate, cursorPos[pocket], itemsAbove[pocket]) */
function initBagList(): number {
  return ListMenuInit(gMultiuseListMenuTemplate, gBagMenuState.cursorPos[gBagMenuState.pocket], gBagMenuState.itemsAbove[gBagMenuState.pocket]);
}

export function GoToBagMenu(location: number, pocket: number, bagCallback: MainCallback | null): void {
  NullBagMenuBufferPtrs();
  sBagMenuDisplay = {
    exitCB: null,
    itemOriginalLocation: 0xff,
    pocketSwitchMode: 0,
    itemMenuIcon: 0,
    inhibitItemDescriptionPrint: false,
    contextMenuSelectedItem: 0,
    pocketScrollArrowsTask: K.TASK_NONE,
    pocketSwitchArrowsTask: K.TASK_NONE,
    nItems: [0, 0, 0],
    maxShowed: [0, 0, 0],
    data: [0, 0, 0, 0],
  };
  if (location !== K.ITEMMENULOCATION_LAST) gBagMenuState.location = location;
  if (bagCallback !== null) gBagMenuState.bagCallback = bagCallback;
  if (location === K.ITEMMENULOCATION_ITEMPC) disp().pocketSwitchMode = 1;
  else if (location === K.ITEMMENULOCATION_OLD_MAN) disp().pocketSwitchMode = 2;
  if (pocket === K.OPEN_BAG_ITEMS || pocket === K.OPEN_BAG_KEYITEMS || pocket === K.OPEN_BAG_POKEBALLS) gBagMenuState.pocket = pocket;
  gTextFlags.autoScroll = false;
  SpecialVar.ItemId = K.ITEM_NONE;
  SetMainCallback2(CB2_OpenBagMenu);
}

export function CB2_BagMenuFromStartMenu(): void {
  GoToBagMenu(K.ITEMMENULOCATION_FIELD, K.OPEN_BAG_LAST, CB2_ReturnToFieldWithOpenMenu);
}

export function CB2_BagMenuFromBattle(): void {
  GoToBagMenu(K.ITEMMENULOCATION_BATTLE, K.OPEN_BAG_LAST, SetCB2ToReshowScreenAfterMenu2);
}

function CB2_BagMenuRun(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function VBlankCB_BagMenuRun(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_OpenBagMenu(): void {
  for (;;) {
    if (IsActiveOverworldLinkBusy()) break;
    if (LoadBagMenuGraphics()) break;
    if (MenuHelpers_IsLinkActive()) break;
  }
}

function LoadBagMenuGraphics(): boolean {
  switch (gMain.state) {
    case 0:
      SetVBlankHBlankCallbacksToNull();
      ClearScheduledBgCopiesToVram();
      gMain.state++;
      break;
    case 1:
      ScanlineEffect_Stop();
      gMain.state++;
      break;
    case 2:
      FreeAllSpritePalettes();
      gMain.state++;
      break;
    case 3:
      ResetPaletteFade();
      gPaletteFade.bufferTransferDisabled = true;
      gMain.state++;
      break;
    case 4:
      ResetSpriteData();
      gMain.state++;
      break;
    case 5:
      ResetItemMenuIconState();
      gMain.state++;
      break;
    case 6:
      if (!MenuHelpers_IsLinkActive()) ResetTasks();
      gMain.state++;
      break;
    case 7:
      if (BagMenuInitBgsAndAllocTilemapBuffer()) {
        disp().data[0] = 0;
        gMain.state++;
      } else {
        FadeOutOfBagMenu();
        return true;
      }
      break;
    case 8:
      if (DoLoadBagGraphics()) gMain.state++;
      break;
    case 9:
      InitBagWindows();
      gMain.state++;
      break;
    case 10:
      All_CalculateNItemsAndMaxShowed();
      CalculateInitialCursorPosAndItemsAbove();
      UpdatePocketScrollPositions();
      gMain.state++;
      break;
    case 11:
      TryAllocListMenuBuffers();
      gMain.state++;
      break;
    case 12:
      Bag_BuildListMenuTemplate(gBagMenuState.pocket);
      gMain.state++;
      break;
    case 13:
      if (gBagMenuState.location !== K.ITEMMENULOCATION_ITEMPC) PrintBagPocketName();
      else BagDrawDepositItemTextBox();
      gMain.state++;
      break;
    case 14: {
      const taskId = CreateBagInputHandlerTask(gBagMenuState.location);
      gTasks[taskId].data[0] = initBagList();
      gTasks[taskId].data[3] = 0;
      gTasks[taskId].data[8] = 0;
      gMain.state++;
      break;
    }
    case 15:
      CreateBagSprite(gBagMenuState.pocket);
      gMain.state++;
      break;
    case 16:
      CreatePocketScrollArrowPair();
      CreatePocketSwitchArrowPair();
      gMain.state++;
      break;
    case 17:
      CreateSwapLine();
      gMain.state++;
      break;
    case 18:
      ShowBagOrBeginWin0OpenTask();
      gMain.state++;
      break;
    case 19:
      SetHelpContext(gBagMenuState.location === K.ITEMMENULOCATION_ITEMPC ? K.HELPCONTEXT_PLAYERS_PC_ITEMS : K.HELPCONTEXT_BAG);
      gPaletteFade.bufferTransferDisabled = false;
      gMain.state++;
      break;
    default:
      SetVBlankCallback(VBlankCB_BagMenuRun);
      SetMainCallback2(CB2_BagMenuRun);
      return true;
  }
  return false;
}

function FadeOutOfBagMenu(): void {
  BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_BLACK);
  CreateTask(Task_WaitFadeOutOfBagMenu, 0);
  SetVBlankCallback(VBlankCB_BagMenuRun);
  SetMainCallback2(CB2_BagMenuRun);
}

function Task_WaitFadeOutOfBagMenu(taskId: number): void {
  if (!gPaletteFade.active) {
    SetMainCallback2(gBagMenuState.bagCallback);
    DestroyBagMenuResources();
    DestroyTask(taskId);
  }
}

function NullBagMenuBufferPtrs(): void {
  sBagMenuDisplay = null;
  sBagBgTilemapBuffer = null;
}

function BagMenuInitBgsAndAllocTilemapBuffer(): boolean {
  ResetAllBgsCoordinatesAndBgCntRegs();
  sBagBgTilemapBuffer = new Uint16Array(0x400);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates);
  SetBgTilemapBuffer(1, sBagBgTilemapBuffer);
  ScheduleBgCopyTilemapToVram(1);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON);
  ShowBg(0);
  ShowBg(1);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  return true;
}

function DoLoadBagGraphics(): boolean {
  switch (disp().data[0]) {
    case 0:
      ResetTempTileDataBuffers();
      DecompressAndCopyTileDataToVram(1, gfx('gBagBg_Gfx'), 0, 0, 0);
      disp().data[0]++;
      break;
    case 1:
      if (FreeTempTileDataBuffersIfPossible() !== true) {
        // LZDecompressWram(gBagBg_Tilemap / gBagBg_ItemPC_Tilemap, sBagBgTilemapBuffer)
        const src = gfx16(gBagMenuState.location !== K.ITEMMENULOCATION_ITEMPC ? 'gBagBg_Tilemap' : 'gBagBg_ItemPC_Tilemap');
        sBagBgTilemapBuffer!.set(src.subarray(0, sBagBgTilemapBuffer!.length));
        disp().data[0]++;
      }
      break;
    case 2:
      LoadCompressedPalette(gfx16('gBagBgPalette'), BG_PLTT_ID(0), 3 * 32);
      if (!BagIsTutorial() && state.playerGender !== 'male') LoadCompressedPalette(gfx16('gBagBgPalette_FemaleOverride'), BG_PLTT_ID(0), 32);
      disp().data[0]++;
      break;
    case 3:
      if (BagIsTutorial() || state.playerGender === 'male') LoadCompressedSpriteSheet(gSpriteSheet_BagMale());
      else LoadCompressedSpriteSheet(gSpriteSheet_BagFemale());
      disp().data[0]++;
      break;
    case 4:
      LoadSpritePalette(gSpritePalette_Bag());
      disp().data[0]++;
      break;
    case 5:
      LoadCompressedSpriteSheet(gBagSwapSpriteSheet());
      disp().data[0]++;
      break;
    default:
      LoadSpritePalette(gBagSwapSpritePalette());
      disp().data[0] = 0;
      return true;
  }
  return false;
}

function CreateBagInputHandlerTask(location: number): number {
  switch (location) {
    case K.ITEMMENULOCATION_OLD_MAN:
      return CreateTask(Task_Bag_OldManTutorial, 0);
    case K.ITEMMENULOCATION_TTVSCR_STATUS:
      return CreateTask(Task_Bag_TeachyTvStatus, 0);
    case K.ITEMMENULOCATION_TTVSCR_CATCHING:
      return CreateTask(Task_Bag_TeachyTvCatching, 0);
    case K.ITEMMENULOCATION_TTVSCR_REGISTER:
      return CreateTask(Task_Bag_TeachyTvRegister, 0);
    case K.ITEMMENULOCATION_TTVSCR_TMS:
      return CreateTask(Task_Bag_TeachyTvTMs, 0);
    default:
      return CreateTask(Task_BagMenu_HandleInput, 0);
  }
}

/** TryAllocListMenuBuffers: the list items are built per pocket in Bag_BuildListMenuTemplate. */
function TryAllocListMenuBuffers(): void {}

function Bag_BuildListMenuTemplate(pocket: number): void {
  const slots = bagPocket(pocket);
  const items: ListMenuItem[] = [];
  let i = 0;
  for (; i < disp().nItems[pocket]; i++) items.push({ label: BagListMenuGetItemNameColored(slots[i].itemId), index: i });
  items.push({ label: concat(sListItemTextColor_RegularItem(), text('gFameCheckerText_Cancel')), index: i });
  const t = gMultiuseListMenuTemplate;
  t.items = items;
  t.totalItems = disp().nItems[pocket] + 1;
  t.windowId = 0;
  t.header_X = 0;
  t.item_X = 9;
  t.cursor_X = 1;
  t.lettersSpacing = 0;
  t.itemVerticalPadding = 2;
  t.upText_Y = 2;
  t.maxShowed = disp().maxShowed[pocket];
  t.fontId = K.FONT_NORMAL;
  t.cursorPal = 2;
  t.fillValue = 0;
  t.cursorShadowPal = 3;
  t.moveCursorFunc = BagListMenuMoveCursorFunc;
  t.itemPrintFunc = BagListMenuItemPrintFunc;
  t.cursorKind = 0;
  t.scrollMultiple = 0;
}

function BagListMenuGetItemNameColored(itemId: number): number[] {
  const color = itemId === K.ITEM_TM_CASE || itemId === K.ITEM_BERRY_POUCH ? sListItemTextColor_TmCase_BerryPouch() : sListItemTextColor_RegularItem();
  return concat(color, ItemId_GetName(itemId));
}

function BagListMenuMoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  if (onInit !== true) {
    PlaySE(K.SE_BAG_CURSOR);
    ShakeBagSprite();
  }
  if (disp().itemOriginalLocation === 0xff) {
    DestroyItemMenuIcon(disp().itemMenuIcon ^ 1);
    if (disp().nItems[gBagMenuState.pocket] !== itemIndex) CreateItemMenuIcon(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, itemIndex), disp().itemMenuIcon);
    else CreateItemMenuIcon(K.ITEMS_COUNT, disp().itemMenuIcon);
    disp().itemMenuIcon ^= 1;
    if (!disp().inhibitItemDescriptionPrint) PrintItemDescriptionOnMessageWindow(itemIndex);
  }
}

function BagListMenuItemPrintFunc(windowId: number, itemId: number, y: number): void {
  if (disp().itemOriginalLocation !== 0xff) {
    if (disp().itemOriginalLocation === (itemId & 0xff)) bag_menu_print_cursor(y, 2);
    else bag_menu_print_cursor(y, 0xff);
  }
  if (itemId !== LIST_CANCEL && disp().nItems[gBagMenuState.pocket] !== itemId) {
    const bagItemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, itemId);
    const bagItemQuantity = BagGetQuantityByPocketPosition(gBagMenuState.pocket + 1, itemId);
    if (gBagMenuState.pocket !== K.POCKET_KEY_ITEMS - 1 && ItemId_GetImportance(bagItemId) === 0) {
      gStringVar1.set(ConvertIntToDecimalStringN(bagItemQuantity, STR_CONV_MODE_RIGHT_ALIGN, 3));
      BagPrintTextOnWindow(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 0x6e, y, 0, 0, 0xff, 1);
    } else if (state.registeredItem !== K.ITEM_NONE && state.registeredItem === bagItemId) {
      BlitBitmapToWindow(windowId, gfx('sBlit_SelectButton'), 0x70, y, 0x18, 0x10);
    }
  }
}

function bag_menu_print_cursor_(listTaskId: number, colorIdx: number): void {
  bag_menu_print_cursor(ListMenuGetYCoordForPrintingArrowCursor(listTaskId), colorIdx);
}

function bag_menu_print_cursor(y: number, colorIdx: number): void {
  if (colorIdx === 0xff) {
    FillWindowPixelRect(0, PIXEL_FILL(0), 1, y, GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0), GetMenuCursorDimensionByFont(K.FONT_NORMAL, 1));
  } else {
    BagPrintTextOnWindow(0, K.FONT_NORMAL, text('gText_SelectorArrow2'), 1, y, 0, 0, 0, colorIdx);
  }
}

function PrintBagPocketName(): void {
  FillWindowPixelBuffer(2, PIXEL_FILL(0));
  BagPrintTextOnWin1CenteredColor0(sPocketNames()[gBagMenuState.pocket]);
}

function PrintItemDescriptionOnMessageWindow(itemIndex: number): void {
  const description = itemIndex !== disp().nItems[gBagMenuState.pocket] ? ItemId_GetDescription(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, itemIndex)) : text('gText_CloseBag');
  FillWindowPixelBuffer(1, PIXEL_FILL(0));
  BagPrintTextOnWindow(1, K.FONT_NORMAL, description, 0, 3, 2, 0, 0, 0);
}

function CreatePocketScrollArrowPair(): void {
  const pocket = gBagMenuState.pocket;
  disp().pocketScrollArrowsTask = AddScrollIndicatorArrowPairParameterized(
    SCROLL_ARROW_UP,
    160,
    8,
    104,
    disp().nItems[pocket] - disp().maxShowed[pocket] + 1,
    110,
    110,
    () => gBagMenuState.cursorPos[pocket],
  );
}

function CreatePocketSwitchArrowPair(): void {
  if (disp().pocketSwitchMode !== 1) disp().pocketSwitchArrowsTask = AddScrollIndicatorArrowPair(sPocketSwitchArrowPairTemplate, () => gBagMenuState.pocket);
}

function CreatePocketScrollArrowPair_SellQuantity(): void {
  disp().contextMenuSelectedItem = 1;
  disp().pocketScrollArrowsTask = AddScrollIndicatorArrowPairParameterized(SCROLL_ARROW_UP, 152, 72, 104, 2, 110, 110, () => disp().contextMenuSelectedItem);
}

function CreateArrowPair_QuantitySelect(): void {
  disp().contextMenuSelectedItem = 1;
  disp().pocketScrollArrowsTask = AddScrollIndicatorArrowPairParameterized(SCROLL_ARROW_UP, 212, 120, 152, 2, 110, 110, () => disp().contextMenuSelectedItem);
}

function BagDestroyPocketScrollArrowPair(): void {
  if (disp().pocketScrollArrowsTask !== 0xff) {
    RemoveScrollIndicatorArrowPair(disp().pocketScrollArrowsTask);
    disp().pocketScrollArrowsTask = 0xff;
  }
  BagDestroyPocketSwitchArrowPair();
}

function BagDestroyPocketSwitchArrowPair(): void {
  if (disp().pocketSwitchArrowsTask !== 0xff) {
    RemoveScrollIndicatorArrowPair(disp().pocketSwitchArrowsTask);
    disp().pocketSwitchArrowsTask = 0xff;
  }
}

export function ResetBagCursorPositions(): void {
  gBagMenuState.pocket = K.POCKET_ITEMS - 1;
  gBagMenuState.bagOpen = false;
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) {
    gBagMenuState.itemsAbove[i] = 0;
    gBagMenuState.cursorPos[i] = 0;
  }
}

export function PocketCalculateInitialCursorPosAndItemsAbove(pocketId: number): void {
  if (!sBagMenuDisplay) return; // freed with the bag (item_use.c's field callbacks read through NULL on the GBA)
  const nItems = disp().nItems[pocketId];
  const maxShowed = disp().maxShowed[pocketId];
  if (gBagMenuState.cursorPos[pocketId] !== 0 && gBagMenuState.cursorPos[pocketId] + maxShowed > nItems + 1) {
    gBagMenuState.cursorPos[pocketId] = nItems + 1 - maxShowed;
  }
  if (gBagMenuState.cursorPos[pocketId] + gBagMenuState.itemsAbove[pocketId] >= nItems + 1) {
    if (nItems + 1 < 2) gBagMenuState.itemsAbove[pocketId] = 0;
    else gBagMenuState.itemsAbove[pocketId] = nItems;
  }
}

function CalculateInitialCursorPosAndItemsAbove(): void {
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) PocketCalculateInitialCursorPosAndItemsAbove(i);
}

function UpdatePocketScrollPositions(): void {
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) {
    if (gBagMenuState.itemsAbove[i] > 3) {
      for (let j = 0; j <= gBagMenuState.itemsAbove[i] - 3; gBagMenuState.itemsAbove[i]--, gBagMenuState.cursorPos[i]++, j++) {
        if (gBagMenuState.cursorPos[i] + disp().maxShowed[i] === disp().nItems[i] + 1) break;
      }
    }
  }
}

function DestroyBagMenuResources(): void {
  sBagMenuDisplay = null;
  sBagBgTilemapBuffer = null;
  FreeAllWindowBuffers();
}

export function ItemMenu_StartFadeToExitCallback(taskId: number): void {
  BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_ItemMenu_WaitFadeAndSwitchToExitCallback;
}

function Task_ItemMenu_WaitFadeAndSwitchToExitCallback(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active && FuncIsActiveTask(Task_AnimateWin0v) !== true) {
    destroyBagList(data[0]);
    if (disp().exitCB !== null) SetMainCallback2(disp().exitCB);
    else SetMainCallback2(gBagMenuState.bagCallback);
    BagDestroyPocketScrollArrowPair();
    DestroyBagMenuResources();
    DestroyTask(taskId);
  }
}

function ShowBagOrBeginWin0OpenTask(): void {
  // SetBackdropFromPalette(&paldata)
  LoadPalette([RGB_BLACK], 0, 2);
  SetGpuReg(REG_OFFSET_WININ, 0);
  SetGpuReg(REG_OFFSET_WINOUT, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR);
  BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
  BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
  if (gBagMenuState.bagOpen === true) {
    SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, DISPLAY_WIDTH));
    SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, 0));
  } else {
    SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, DISPLAY_WIDTH));
    SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, DISPLAY_HEIGHT));
    const taskId = CreateTask(Task_AnimateWin0v, 0);
    gTasks[taskId].data[0] = 192;
    gTasks[taskId].data[1] = -16;
    gBagMenuState.bagOpen = true;
  }
}

export function Bag_BeginCloseWin0Animation(): void {
  const taskId = CreateTask(Task_AnimateWin0v, 0);
  gTasks[taskId].data[0] = -16;
  gTasks[taskId].data[1] = 16;
  gBagMenuState.bagOpen = false;
}

export function CB2_SetUpReshowBattleScreenAfterMenu(): void {
  gBagMenuState.bagOpen = false;
}

function Task_AnimateWin0v(taskId: number): void {
  const data = gTasks[taskId].data;
  data[0] += data[1];
  if (data[0] > 160) SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, 160));
  else SetGpuReg(REG_OFFSET_WIN0V, data[0] & 0xffff);
  if ((data[1] === 16 && data[0] === 160) || (data[1] === -16 && data[0] === 0)) DestroyTask(taskId);
}

export function MoveItemSlotInList(itemSlots: { itemId: number; quantity: number }[], from: number, to: number): void {
  if (from !== to) {
    const firstSlot = { ...itemSlots[from] };
    if (to > from) {
      to--;
      for (let i = from; i < to; i++) itemSlots[i] = { ...itemSlots[i + 1] };
    } else {
      for (let i = from; i > to; i--) itemSlots[i] = { ...itemSlots[i - 1] };
    }
    itemSlots[to] = firstSlot;
  }
}

export function Pocket_CalculateNItemsAndMaxShowed(pocketId: number): void {
  const slots = bagPocket(pocketId);
  BagPocketCompaction(slots, slots.length);
  if (!sBagMenuDisplay) return; // freed with the bag (the Escape Rope's RemoveUsedItem on the field)
  disp().nItems[pocketId] = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].itemId === K.ITEM_NONE) break;
    disp().nItems[pocketId]++;
  }
  disp().maxShowed[pocketId] = disp().nItems[pocketId] + 1 > 6 ? 6 : disp().nItems[pocketId] + 1;
}

function All_CalculateNItemsAndMaxShowed(): void {
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) Pocket_CalculateNItemsAndMaxShowed(i);
}

export function DisplayItemMessageInBag(taskId: number, fontId: number, string: number[], followUpFunc: TaskFunc): void {
  const data = gTasks[taskId].data;
  data[10] = OpenBagWindow(5);
  FillWindowPixelBuffer(data[10], PIXEL_FILL(1));
  DisplayMessageAndContinueTask(taskId, data[10], 0x06d, 0x0d, fontId, GetTextSpeedSetting(), string, followUpFunc);
  ScheduleBgCopyTilemapToVram(0);
}

export function ItemMenu_SetExitCallback(cb: MainCallback | null): void {
  disp().exitCB = cb;
}

function Task_BagMenu_HandleInput(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  if (FuncIsActiveTask(Task_AnimateWin0v) === true) return;
  if (IsActiveOverworldLinkBusy()) return;
  switch (ProcessPocketSwitchInput(taskId, gBagMenuState.pocket)) {
    case 1:
      SwitchPockets(taskId, -1, false);
      return;
    case 2:
      SwitchPockets(taskId, 1, false);
      return;
    default:
      if (JOY_NEW(SELECT_BUTTON) && gBagMenuState.location === K.ITEMMENULOCATION_FIELD) {
        const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(data[0]);
        if (cursorPos + itemsAbove !== disp().nItems[gBagMenuState.pocket]) {
          PlaySE(K.SE_SELECT);
          BeginMovingItemInPocket(taskId, cursorPos + itemsAbove);
          return;
        }
      }
      break;
  }
  const input = ListMenu_ProcessInput(data[0]);
  saveBagScroll(data[0]);
  switch (input) {
    case LIST_NOTHING_CHOSEN:
      return;
    case LIST_CANCEL:
      PlaySE(K.SE_SELECT);
      SpecialVar.ItemId = K.ITEM_NONE;
      Bag_BeginCloseWin0Animation();
      gTasks[taskId].func = ItemMenu_StartFadeToExitCallback;
      break;
    default:
      PlaySE(K.SE_SELECT);
      if (input === disp().nItems[gBagMenuState.pocket]) {
        SpecialVar.ItemId = K.ITEM_NONE;
        Bag_BeginCloseWin0Animation();
        gTasks[taskId].func = ItemMenu_StartFadeToExitCallback;
      } else {
        BagDestroyPocketScrollArrowPair();
        bag_menu_print_cursor_(data[0], 2);
        data[1] = input;
        data[2] = BagGetQuantityByPocketPosition(gBagMenuState.pocket + 1, input);
        SpecialVar.ItemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, input);
        gTasks[taskId].func = Task_ItemContextMenuByLocation;
      }
      break;
  }
}

function Task_ItemContextMenuByLocation(taskId: number): void {
  Bag_FillMessageBoxWithPalette(1);
  sItemContextTaskFuncs(gBagMenuState.location)!(taskId);
}

function Task_RedrawArrowsAndReturnToBagMenuSelect(taskId: number): void {
  Bag_FillMessageBoxWithPalette(0);
  CreatePocketScrollArrowPair();
  CreatePocketSwitchArrowPair();
  gTasks[taskId].func = Task_BagMenu_HandleInput;
}

function Bag_FillMessageBoxWithPalette(a0: number): void {
  SetBgTilemapPalette(1, 0, 14, 30, 6, a0 + 1);
  ScheduleBgCopyTilemapToVram(1);
}

function ProcessPocketSwitchInput(_taskId: number, pocketId: number): number {
  if (disp().pocketSwitchMode !== 0) return 0;
  const lrState = GetLRKeysPressed();
  if (JOY_NEW(DPAD_LEFT) || lrState === MENU_L_PRESSED) {
    if (pocketId === K.POCKET_ITEMS - 1) return 0;
    PlaySE(K.SE_BAG_POCKET);
    return 1;
  }
  if (JOY_NEW(DPAD_RIGHT) || lrState === MENU_R_PRESSED) {
    if (pocketId >= K.POCKET_POKE_BALLS - 1) return 0;
    PlaySE(K.SE_BAG_POCKET);
    return 2;
  }
  return 0;
}

function SwitchPockets(taskId: number, direction: number, a2: boolean): void {
  const data = gTasks[taskId].data;
  data[tSwitchState] = 0;
  data[tSwitchCounter] = 0;
  data[tSwitchDir] = direction;
  if (!a2) {
    ClearWindowTilemap(0);
    ClearWindowTilemap(1);
    ClearWindowTilemap(2);
    destroyBagList(data[0]);
    ScheduleBgCopyTilemapToVram(0);
    DestroyItemMenuIcon(disp().itemMenuIcon ^ 1);
    BagDestroyPocketScrollArrowPair();
  }
  FillBgTilemapBufferRect_Palette0(1, 0x02d, 11, 1, 18, 12);
  ScheduleBgCopyTilemapToVram(1);
  SetBagVisualPocketId(gBagMenuState.pocket + direction);
  SetTaskFuncWithFollowupFunc(taskId, Task_AnimateSwitchPockets, gTasks[taskId].func);
}

function Task_AnimateSwitchPockets(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!MenuHelpers_IsLinkActive() && !BagIsTutorial()) {
    switch (ProcessPocketSwitchInput(taskId, gBagMenuState.pocket + data[tSwitchDir])) {
      case 1:
        gBagMenuState.pocket += data[tSwitchDir];
        SwitchTaskToFollowupFunc(taskId);
        SwitchPockets(taskId, -1, true);
        return;
      case 2:
        gBagMenuState.pocket += data[tSwitchDir];
        SwitchTaskToFollowupFunc(taskId);
        SwitchPockets(taskId, 1, true);
        return;
    }
  }
  switch (data[tSwitchState]) {
    case 0:
      // Animate the item list being revealed from the bottom row up
      if (data[tSwitchCounter] !== SHRT_MAX) {
        data[tSwitchCounter]++;
        DrawItemListRow(data[tSwitchCounter]);
        if (data[tSwitchCounter] === LIST_TILES_HEIGHT) data[tSwitchCounter] = SHRT_MAX;
      }
      if (data[tSwitchCounter] === SHRT_MAX) data[tSwitchState]++;
      break;
    case 1:
      gBagMenuState.pocket += data[tSwitchDir];
      PrintBagPocketName();
      Bag_BuildListMenuTemplate(gBagMenuState.pocket);
      data[0] = initBagList();
      PutWindowTilemap(1);
      PutWindowTilemap(2);
      ScheduleBgCopyTilemapToVram(0);
      CreatePocketScrollArrowPair();
      CreatePocketSwitchArrowPair();
      SwitchTaskToFollowupFunc(taskId);
      break;
  }
}

function BeginMovingItemInPocket(taskId: number, itemIndex: number): void {
  const data = gTasks[taskId].data;
  ListMenuSetTemplateField(data[0], LISTFIELD_CURSORKIND, 1);
  data[1] = itemIndex;
  disp().itemOriginalLocation = itemIndex;
  gStringVar1.set(ItemId_GetName(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1])));
  FillWindowPixelBuffer(1, PIXEL_FILL(0));
  BagPrintTextOnWindow(1, K.FONT_NORMAL, ExpandToStringVar4(text('gOtherText_WhereShouldTheStrVar1BePlaced')), 0, 3, 2, 0, 0, 0);
  UpdateSwapLinePos(0, ListMenuGetYCoordForPrintingArrowCursor(data[0]));
  SetSwapLineInvisibility(false);
  BagDestroyPocketSwitchArrowPair();
  bag_menu_print_cursor_(data[0], 2);
  gTasks[taskId].func = Task_MoveItemInPocket_HandleInput;
}

function Task_MoveItemInPocket_HandleInput(taskId: number): void {
  const data = gTasks[taskId].data;
  if (IsActiveOverworldLinkBusy()) return;
  const input = ListMenu_ProcessInput(data[0]);
  saveBagScroll(data[0]);
  UpdateSwapLinePos(0, ListMenuGetYCoordForPrintingArrowCursor(data[0]));
  if (JOY_NEW(SELECT_BUTTON)) {
    PlaySE(K.SE_SELECT);
    disp().itemOriginalLocation = 0xff;
    const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(data[0]);
    ExecuteMoveItemInPocket(taskId, cursorPos + itemsAbove);
    return;
  }
  switch (input) {
    case LIST_NOTHING_CHOSEN:
      return;
    case LIST_CANCEL: {
      PlaySE(K.SE_SELECT);
      disp().itemOriginalLocation = 0xff;
      const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(data[0]);
      AbortMovingItemInPocket(taskId, cursorPos + itemsAbove);
      break;
    }
    default:
      PlaySE(K.SE_SELECT);
      disp().itemOriginalLocation = 0xff;
      ExecuteMoveItemInPocket(taskId, input);
      break;
  }
}

function ExecuteMoveItemInPocket(taskId: number, itemIndex: number): void {
  const data = gTasks[taskId].data;
  if (data[1] === itemIndex || data[1] === itemIndex - 1) {
    AbortMovingItemInPocket(taskId, itemIndex);
  } else {
    MoveItemSlotInList(bagPocket(gBagMenuState.pocket), data[1], itemIndex);
    destroyBagList(data[0]);
    if (data[1] < itemIndex) gBagMenuState.itemsAbove[gBagMenuState.pocket]--;
    Bag_BuildListMenuTemplate(gBagMenuState.pocket);
    data[0] = initBagList();
    SetSwapLineInvisibility(true);
    CreatePocketSwitchArrowPair();
    gTasks[taskId].func = Task_BagMenu_HandleInput;
  }
}

function AbortMovingItemInPocket(taskId: number, itemIndex: number): void {
  const data = gTasks[taskId].data;
  destroyBagList(data[0]);
  if (data[1] < itemIndex) gBagMenuState.itemsAbove[gBagMenuState.pocket]--;
  Bag_BuildListMenuTemplate(gBagMenuState.pocket);
  data[0] = initBagList();
  SetSwapLineInvisibility(true);
  CreatePocketSwitchArrowPair();
  gTasks[taskId].func = Task_BagMenu_HandleInput;
}

function InitQuantityToTossOrDeposit(cursorPos: number, str: number[]): void {
  const r5 = ShowBagWindow(6, 2);
  gStringVar1.set(CopyItemName(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, cursorPos)));
  BagPrintTextOnWindow(r5, K.FONT_NORMAL, ExpandToStringVar4(str), 0, 2, 1, 0, 0, 1);
  const r4 = ShowBagWindow(0, 0);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 3));
  BagPrintTextOnWindow(r4, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, 1);
  CreateArrowPair_QuantitySelect();
}

function UpdateQuantityToTossOrDeposit(value: number, ndigits: number): void {
  const r6 = GetBagWindow(0);
  FillWindowPixelBuffer(r6, PIXEL_FILL(1));
  gStringVar1.set(ConvertIntToDecimalStringN(value, STR_CONV_MODE_LEADING_ZEROS, ndigits));
  BagPrintTextOnWindow(r6, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, 1);
}

/** DrawItemListRow: row 0 is the bottom row in the list, up to LIST_TILES_HEIGHT at the top. */
function DrawItemListRow(row: number): void {
  const tilemap = gfx16('sItemListTilemap');
  const start = (LIST_TILES_HEIGHT - row) * LIST_TILES_WIDTH;
  CopyToBgTilemapBufferRect(1, tilemap.subarray(start, start + LIST_TILES_WIDTH), 11, 1 + LIST_TILES_HEIGHT - row, LIST_TILES_WIDTH, 1);
  ScheduleBgCopyTilemapToVram(1);
}

function OpenContextMenu(_taskId: number): void {
  const itemId = SpecialVar.ItemId;
  switch (gBagMenuState.location) {
    case K.ITEMMENULOCATION_BATTLE:
    case K.ITEMMENULOCATION_TTVSCR_STATUS:
      if (itemId === K.ITEM_BERRY_POUCH) {
        sContextMenuItemsBuffer[0] = K.ITEMMENUACTION_OPEN_BERRIES;
        sContextMenuItemsBuffer[1] = K.ITEMMENUACTION_CANCEL;
        sContextMenuItemsPtr = sContextMenuItemsBuffer;
        sContextMenuNumItems = 2;
      } else if (ItemId_GetBattleUsage(itemId)) {
        sContextMenuItemsPtr = sContextMenuItems_BattleUse();
        sContextMenuNumItems = 2;
      } else {
        sContextMenuItemsPtr = sContextMenuItems_Cancel();
        sContextMenuNumItems = 1;
      }
      break;
    case K.ITEMMENULOCATION_OLD_MAN:
    case K.ITEMMENULOCATION_TTVSCR_CATCHING:
      sContextMenuItemsPtr = sContextMenuItems_BattleUse();
      sContextMenuNumItems = 2;
      break;
    default:
      // No link play or Union Room, so the GiveIfNotKeyItemPocket / Open lists never apply.
      switch (gBagMenuState.pocket) {
        case K.OPEN_BAG_ITEMS:
          sContextMenuNumItems = 4;
          sContextMenuItemsPtr = ItemIsMail(itemId) ? sContextMenuItems_CheckGiveTossCancel() : sContextMenuItems_Field()[gBagMenuState.pocket];
          break;
        case K.OPEN_BAG_KEYITEMS:
          sContextMenuItemsPtr = sContextMenuItemsBuffer;
          sContextMenuNumItems = 3;
          sContextMenuItemsBuffer[2] = K.ITEMMENUACTION_CANCEL;
          sContextMenuItemsBuffer[1] = state.registeredItem === itemId ? K.ITEMMENUACTION_DESELECT : K.ITEMMENUACTION_REGISTER;
          if (itemId === K.ITEM_TM_CASE || itemId === K.ITEM_BERRY_POUCH) sContextMenuItemsBuffer[0] = K.ITEMMENUACTION_OPEN;
          else if (itemId === K.ITEM_BICYCLE && TestPlayerAvatarFlags(K.PLAYER_AVATAR_FLAG_ACRO_BIKE | K.PLAYER_AVATAR_FLAG_MACH_BIKE)) {
            sContextMenuItemsBuffer[0] = K.ITEMMENUACTION_WALK;
          } else sContextMenuItemsBuffer[0] = K.ITEMMENUACTION_USE;
          break;
        case K.OPEN_BAG_POKEBALLS:
          sContextMenuItemsPtr = sContextMenuItems_Field()[gBagMenuState.pocket];
          sContextMenuNumItems = 3;
          break;
      }
  }
  const r6 = ShowBagWindow(10, sContextMenuNumItems - 1);
  const fontHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT);
  AddItemMenuActionTextPrinters(
    r6,
    K.FONT_NORMAL,
    GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0),
    2,
    GetFontAttribute(K.FONT_NORMAL, FONTATTR_LETTER_SPACING),
    fontHeight + 2,
    sContextMenuNumItems,
    sItemMenuContextActions(),
    sContextMenuItemsPtr,
  );
  Menu_InitCursor(r6, K.FONT_NORMAL, 0, 2, fontHeight + 2, sContextMenuNumItems, 0);
  const r4 = ShowBagWindow(6, 0);
  gStringVar1.set(CopyItemName(itemId));
  BagPrintTextOnWindow(r4, K.FONT_NORMAL, ExpandToStringVar4(text('gText_Var1IsSelected')), 0, 2, 1, 0, 0, 1);
}

function Task_ItemContext_FieldOrBattle(taskId: number): void {
  OpenContextMenu(taskId);
  gTasks[taskId].func = Task_FieldItemContextMenuHandleInput;
}

function Task_FieldItemContextMenuHandleInput(taskId: number): void {
  if (IsActiveOverworldLinkBusy()) return;
  const input = Menu_ProcessInputNoWrapAround();
  switch (input) {
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
      sItemMenuContextActions()[K.ITEMMENUACTION_CANCEL].func!(taskId);
      break;
    case MENU_NOTHING_CHOSEN:
      break;
    default:
      PlaySE(K.SE_SELECT);
      sItemMenuContextActions()[sContextMenuItemsPtr[input]].func!(taskId);
      break;
  }
}

/** ItemId_GetFieldFunc(gSpecialVar_ItemId), resolved to the ported function (null = NULL). */
function fieldFunc(itemId: number): TaskFunc | null {
  const name = ItemId_GetFieldFunc(itemId);
  if (name === 'NULL' || !name) return null;
  return FIELD_USE_FUNCS[name] ?? ((taskId) => notImplemented(taskId, name));
}

function battleFunc(itemId: number): TaskFunc | null {
  const name = ItemId_GetBattleFunc(itemId);
  if (name === 'NULL' || !name) return null;
  return BATTLE_USE_FUNCS[name] ?? ((taskId) => notImplemented(taskId, name));
}

function notImplemented(taskId: number, name: string): void {
  console.warn(`[bag] ${name} is not implemented`);
  Task_ReturnToBagFromContextMenu(taskId);
}

function Task_ItemMenuAction_Use(taskId: number): void {
  const func = fieldFunc(SpecialVar.ItemId);
  if (func !== null) {
    HideBagWindow(10);
    HideBagWindow(6);
    PutWindowTilemap(0);
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    if (CalculatePlayerPartyCount() === 0 && ItemId_GetType(SpecialVar.ItemId) === K.ITEM_TYPE_PARTY_MENU) Task_PrintThereIsNoPokemon(taskId);
    else func(taskId);
  }
}

function Task_ItemMenuAction_Toss(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearWindowTilemap(GetBagWindow(10));
  ClearWindowTilemap(GetBagWindow(6));
  HideBagWindow(10);
  HideBagWindow(6);
  PutWindowTilemap(0);
  data[8] = 1;
  if (data[2] === 1) {
    Task_ConfirmTossItems(taskId);
  } else {
    InitQuantityToTossOrDeposit(data[1], text('gText_TossOutHowManyStrVar1s'));
    gTasks[taskId].func = Task_SelectQuantityToToss;
  }
}

function Task_ConfirmTossItems(taskId: number): void {
  const data = gTasks[taskId].data;
  gStringVar2.set(ConvertIntToDecimalStringN(data[8], STR_CONV_MODE_LEFT_ALIGN, 3));
  BagPrintTextOnWindow(ShowBagWindow(6, 1), K.FONT_NORMAL, ExpandToStringVar4(text('gText_ThrowAwayStrVar2OfThisItemQM')), 0, 2, 1, 0, 0, 1);
  BagCreateYesNoMenuBottomRight(taskId, sYesNoMenu_Toss);
}

function Task_TossItem_No(taskId: number): void {
  const data = gTasks[taskId].data;
  HideBagWindow(6);
  PutWindowTilemap(1);
  ScheduleBgCopyTilemapToVram(0);
  bag_menu_print_cursor_(data[0], 1);
  Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
}

function Task_SelectQuantityToToss(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, 8, data[2]) === true) {
    UpdateQuantityToTossOrDeposit(data[8], 3);
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearWindowTilemap(GetBagWindow(6));
    HideBagWindow(6);
    HideBagWindow(0);
    ScheduleBgCopyTilemapToVram(0);
    BagDestroyPocketScrollArrowPair();
    Task_ConfirmTossItems(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    HideBagWindow(6);
    HideBagWindow(0);
    PutWindowTilemap(0);
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    bag_menu_print_cursor_(data[0], 1);
    BagDestroyPocketScrollArrowPair();
    Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
  }
}

function Task_TossItem_Yes(taskId: number): void {
  const data = gTasks[taskId].data;
  HideBagWindow(6);
  gStringVar1.set(CopyItemName(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1])));
  gStringVar2.set(ConvertIntToDecimalStringN(data[8], STR_CONV_MODE_LEFT_ALIGN, 3));
  BagPrintTextOnWindow(ShowBagWindow(6, 3), K.FONT_NORMAL, ExpandToStringVar4(text('gText_ThrewAwayStrVar2StrVar1s')), 0, 2, 1, 0, 0, 1);
  gTasks[taskId].func = Task_WaitAB_RedrawAndReturnToBag;
}

function Task_WaitAB_RedrawAndReturnToBag(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    RemoveBagItem(SpecialVar.ItemId, data[8]);
    HideBagWindow(6);
    destroyBagList(data[0]);
    Pocket_CalculateNItemsAndMaxShowed(gBagMenuState.pocket);
    PocketCalculateInitialCursorPosAndItemsAbove(gBagMenuState.pocket);
    Bag_BuildListMenuTemplate(gBagMenuState.pocket);
    data[0] = initBagList();
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    bag_menu_print_cursor_(data[0], 1);
    Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
  }
}

function Task_ItemMenuAction_ToggleSelect(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1]);
  if (state.registeredItem === itemId) state.registeredItem = K.ITEM_NONE;
  else state.registeredItem = itemId;
  destroyBagList(data[0]);
  Bag_BuildListMenuTemplate(gBagMenuState.pocket);
  data[0] = initBagList();
  CopyWindowToVram(0, COPYWIN_MAP);
  Task_ItemMenuAction_Cancel(taskId);
}

function Task_ItemMenuAction_Give(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1]);
  HideBagWindow(10);
  HideBagWindow(6);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  CopyWindowToVram(0, COPYWIN_MAP);
  // IsWritingMailAllowed: always allowed without link play
  if (ItemId_GetImportance(itemId) === 0) {
    if (CalculatePlayerPartyCount() === 0) {
      Task_PrintThereIsNoPokemon(taskId);
    } else {
      disp().exitCB = CB2_ChooseMonToGiveItem;
      gTasks[taskId].func = ItemMenu_StartFadeToExitCallback;
    }
  } else {
    Task_PrintItemCantBeHeld(taskId);
  }
}

function Task_PrintThereIsNoPokemon(taskId: number): void {
  DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_ThereIsNoPokemon'), Task_WaitAButtonAndCloseContextMenu);
}

function Task_PrintItemCantBeHeld(taskId: number): void {
  gStringVar1.set(CopyItemName(SpecialVar.ItemId));
  DisplayItemMessageInBag(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_ItemCantBeHeld')), Task_WaitAButtonAndCloseContextMenu);
}

function Task_WaitAButtonAndCloseContextMenu(taskId: number): void {
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    Task_ReturnToBagFromContextMenu(taskId);
  }
}

export function Task_ReturnToBagFromContextMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  CloseBagWindow(5);
  destroyBagList(data[0]);
  Pocket_CalculateNItemsAndMaxShowed(gBagMenuState.pocket);
  PocketCalculateInitialCursorPosAndItemsAbove(gBagMenuState.pocket);
  Bag_BuildListMenuTemplate(gBagMenuState.pocket);
  data[0] = initBagList();
  ScheduleBgCopyTilemapToVram(0);
  bag_menu_print_cursor_(data[0], 1);
  Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
}

function Task_ItemMenuAction_Cancel(taskId: number): void {
  HideBagWindow(10);
  HideBagWindow(6);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  ScheduleBgCopyTilemapToVram(0);
  bag_menu_print_cursor_(gTasks[taskId].data[0], 1);
  Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
}

function Task_ItemMenuAction_BattleUse(taskId: number): void {
  const func = battleFunc(SpecialVar.ItemId);
  if (func !== null) {
    HideBagWindow(10);
    HideBagWindow(6);
    PutWindowTilemap(0);
    PutWindowTilemap(1);
    CopyWindowToVram(0, COPYWIN_MAP);
    func(taskId);
  }
}

function Task_ItemContext_FieldGive(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1]);
  if (itemId === K.ITEM_TM_CASE) {
    ItemMenu_SetExitCallback(GoToTMCase_Give);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (itemId === K.ITEM_BERRY_POUCH) {
    ItemMenu_SetExitCallback(GoToBerryPouch_Give);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (gBagMenuState.pocket !== K.POCKET_KEY_ITEMS - 1 && ItemId_GetImportance(itemId) === 0) {
    Bag_BeginCloseWin0Animation();
    gTasks[taskId].func = ItemMenu_StartFadeToExitCallback;
  } else {
    Task_PrintItemCantBeHeld(taskId);
  }
}

/** Task_ItemContext_Deposit: the item PC's DEPOSIT ITEM (one at once, or choose how many first). */
function Task_ItemContext_Deposit(taskId: number): void {
  const data = gTasks[taskId].data;
  data[8] = 1;
  if (data[2] === 1) {
    Task_TryDoItemDeposit(taskId);
  } else {
    InitQuantityToTossOrDeposit(data[1], text('gText_DepositHowManyStrVars1'));
    gTasks[taskId].func = Task_SelectQuantityToDeposit;
  }
}

function Task_SelectQuantityToDeposit(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, 8, data[2]) === true) {
    UpdateQuantityToTossOrDeposit(data[8], 3);
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearWindowTilemap(GetBagWindow(6));
    HideBagWindow(6);
    HideBagWindow(0);
    ScheduleBgCopyTilemapToVram(0);
    BagDestroyPocketScrollArrowPair();
    Task_TryDoItemDeposit(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    HideBagWindow(6);
    HideBagWindow(0);
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    bag_menu_print_cursor_(data[0], 1);
    BagDestroyPocketScrollArrowPair();
    Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
  }
}

function Task_TryDoItemDeposit(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AddPCItem(state.pcItems, K.ITEM_NONE, SpecialVar.ItemId, data[8])) {
    ItemUse_SetQuestLogEvent(K.QL_EVENT_DEPOSITED_ITEM_PC, null, SpecialVar.ItemId, 0xffff);
    gStringVar1.set(CopyItemName(SpecialVar.ItemId));
    gStringVar2.set(ConvertIntToDecimalStringN(data[8], STR_CONV_MODE_LEFT_ALIGN, 3));
    BagPrintTextOnWindow(ShowBagWindow(6, 3), K.FONT_NORMAL, ExpandToStringVar4(text('gText_DepositedStrVar2StrVar1s')), 0, 2, 1, 0, 0, 1);
    gTasks[taskId].func = Task_WaitAB_RedrawAndReturnToBag;
  } else {
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_NoRoomToStoreItems'), Task_WaitAButtonAndCloseContextMenu);
  }
}

/** Task_ItemContext_PcBoxGive: the PC's MOVE ITEMS GIVE; the bag closes with gSpecialVar_ItemId set. */
function Task_ItemContext_PcBoxGive(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1]);
  if (ItemIsMail(itemId)) {
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_CantWriteMailHere'), Task_WaitAButtonAndCloseContextMenu);
  } else if (itemId === K.ITEM_TM_CASE) {
    ItemMenu_SetExitCallback(GoToTMCase_PCBox);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (itemId === K.ITEM_BERRY_POUCH) {
    ItemMenu_SetExitCallback(GoToBerryPouch_PCBox);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (gBagMenuState.pocket !== K.POCKET_KEY_ITEMS - 1 && ItemId_GetImportance(itemId) === 0) {
    Bag_BeginCloseWin0Animation();
    gTasks[taskId].func = ItemMenu_StartFadeToExitCallback;
  } else {
    Task_PrintItemCantBeHeld(taskId);
  }
}

/** GoToTMCase_Give */
function GoToTMCase_Give(): void {
  InitTMCase(TMCASE_GIVE_PARTY, ReturnToBagMenuFromSubmenu_Give, false);
}

/** GoToBerryPouch_Give */
function GoToBerryPouch_Give(): void {
  InitBerryPouch(BERRYPOUCH_FROMPARTYGIVE, ReturnToBagMenuFromSubmenu_Give, 0);
}

/** ReturnToBagMenuFromSubmenu_Give */
export function ReturnToBagMenuFromSubmenu_Give(): void {
  CB2_SelectBagItemToGive();
}

/** GoToTMCase_PCBox */
function GoToTMCase_PCBox(): void {
  InitTMCase(TMCASE_GIVE_PC, ReturnToBagMenuFromSubmenu_PCBox, false);
}

/** GoToBerryPouch_PCBox */
function GoToBerryPouch_PCBox(): void {
  InitBerryPouch(BERRYPOUCH_FROMPOKEMONSTORAGEPC, ReturnToBagMenuFromSubmenu_PCBox, 0);
}

/** ReturnToBagMenuFromSubmenu_PCBox */
function ReturnToBagMenuFromSubmenu_PCBox(): void {
  GoToBagMenu(K.ITEMMENULOCATION_PCBOX, K.OPEN_BAG_LAST, CB2_ReturnToPokeStorage);
}

/** GoToTMCase_Sell */
function GoToTMCase_Sell(): void {
  InitTMCase(TMCASE_SELL, ReturnToBagMenuFromSubmenu_Sell, false);
}

/** GoToBerryPouch_Sell */
function GoToBerryPouch_Sell(): void {
  InitBerryPouch(BERRYPOUCH_FROMMARTSELL, ReturnToBagMenuFromSubmenu_Sell, 0);
}

/** ReturnToBagMenuFromSubmenu_Sell */
function ReturnToBagMenuFromSubmenu_Sell(): void {
  GoToBagMenu(K.ITEMMENULOCATION_SHOP, K.OPEN_BAG_LAST, CB2_ReturnToField);
}

function Task_ItemContext_Sell(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = SpecialVar.ItemId;
  if (itemId === K.ITEM_TM_CASE) {
    ItemMenu_SetExitCallback(GoToTMCase_Sell);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (itemId === K.ITEM_BERRY_POUCH) {
    ItemMenu_SetExitCallback(GoToBerryPouch_Sell);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else if (ItemId_GetPrice(itemId) === 0) {
    gStringVar1.set(CopyItemName(itemId));
    DisplayItemMessageInBag(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_OhNoICantBuyThat')), Task_ReturnToBagFromContextMenu);
  } else {
    data[8] = 1;
    if (data[2] === 1) {
      BagPrintMoneyAmount();
      Task_PrintSaleConfirmationText(taskId);
    } else {
      if (data[2] > 99) data[2] = 99;
      gStringVar1.set(CopyItemName(itemId));
      DisplayItemMessageInBag(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_HowManyWouldYouLikeToSell')), Task_InitSaleQuantitySelectInterface);
    }
  }
}

/** GetDialogBoxFontId: FONT_MALE for a male NPC's text colour, otherwise FONT_FEMALE. */
export function GetDialogBoxFontId(): number {
  return state.getVar('VAR_TEXT_COLOR') === K.NPC_TEXT_COLOR_MALE ? K.FONT_MALE : K.FONT_FEMALE;
}

function salePrice(taskId: number): number {
  const data = gTasks[taskId].data;
  return Math.trunc(ItemId_GetPrice(BagGetItemIdByPocketPosition(gBagMenuState.pocket + 1, data[1])) / 2) * data[8];
}

function Task_PrintSaleConfirmationText(taskId: number): void {
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId), STR_CONV_MODE_LEFT_ALIGN, 6));
  DisplayItemMessageInBag(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_ICanPayThisMuch_WouldThatBeOkay')), Task_ShowSellYesNoMenu);
}

function Task_ShowSellYesNoMenu(taskId: number): void {
  BagCreateYesNoMenuTopRight(taskId, sYesNoMenu_Sell);
}

function Task_SellItem_No(taskId: number): void {
  const data = gTasks[taskId].data;
  HideBagWindow(2);
  CloseBagWindow(5);
  PutWindowTilemap(2);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  ScheduleBgCopyTilemapToVram(0);
  bag_menu_print_cursor_(data[0], 1);
  Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
}

function Task_InitSaleQuantitySelectInterface(taskId: number): void {
  const r4 = ShowBagWindow(0, 1);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 2));
  BagPrintTextOnWindow(r4, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0xff, 1);
  UpdateSalePriceDisplay(salePrice(taskId));
  BagPrintMoneyAmount();
  CreatePocketScrollArrowPair_SellQuantity();
  gTasks[taskId].func = Task_SelectQuantityToSell;
}

function UpdateSalePriceDisplay(amount: number): void {
  PrintMoneyAmount(GetBagWindow(0), 56, 10, amount, 0);
}

function Task_SelectQuantityToSell(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, 8, data[2]) === true) {
    UpdateQuantityToTossOrDeposit(data[8], 2);
    UpdateSalePriceDisplay(salePrice(taskId));
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    HideBagWindow(0);
    PutWindowTilemap(0);
    ScheduleBgCopyTilemapToVram(0);
    BagDestroyPocketScrollArrowPair();
    Task_PrintSaleConfirmationText(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    HideBagWindow(0);
    HideBagWindow(2);
    CloseBagWindow(5);
    PutWindowTilemap(2);
    PutWindowTilemap(0);
    PutWindowTilemap(1);
    ScheduleBgCopyTilemapToVram(0);
    BagDestroyPocketScrollArrowPair();
    bag_menu_print_cursor_(data[0], 1);
    Task_RedrawArrowsAndReturnToBagMenuSelect(taskId);
  }
}

function Task_SellItem_Yes(taskId: number): void {
  PutWindowTilemap(0);
  ScheduleBgCopyTilemapToVram(0);
  gStringVar1.set(CopyItemName(SpecialVar.ItemId));
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId), STR_CONV_MODE_LEFT_ALIGN, 6));
  DisplayItemMessageInBag(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_TurnedOverItemsWorthYen')), Task_FinalizeSaleToShop);
}

function Task_FinalizeSaleToShop(taskId: number): void {
  const data = gTasks[taskId].data;
  PlaySE(K.SE_SHOP);
  RemoveBagItem(SpecialVar.ItemId, data[8]);
  state.addMoney(Math.trunc(ItemId_GetPrice(SpecialVar.ItemId) / 2) * data[8]);
  // RecordItemTransaction: the quest log isn't implemented
  destroyBagList(data[0]);
  Pocket_CalculateNItemsAndMaxShowed(gBagMenuState.pocket);
  PocketCalculateInitialCursorPosAndItemsAbove(gBagMenuState.pocket);
  disp().inhibitItemDescriptionPrint = true;
  Bag_BuildListMenuTemplate(gBagMenuState.pocket);
  data[0] = initBagList();
  bag_menu_print_cursor_(data[0], 2);
  BagDrawTextBoxOnWindow(GetBagWindow(2));
  PrintMoneyAmountInMoneyBox(GetBagWindow(2), state.money, 0);
  gTasks[taskId].func = Task_WaitPressAB_AfterSell;
}

function Task_WaitPressAB_AfterSell(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    HideBagWindow(2);
    PutWindowTilemap(2);
    disp().inhibitItemDescriptionPrint = false;
    Task_ReturnToBagFromContextMenu(taskId);
  }
}

function BagIsTutorial(): boolean {
  const l = gBagMenuState.location;
  return (
    l === K.ITEMMENULOCATION_OLD_MAN ||
    l === K.ITEMMENULOCATION_TTVSCR_CATCHING ||
    l === K.ITEMMENULOCATION_TTVSCR_STATUS ||
    l === K.ITEMMENULOCATION_TTVSCR_REGISTER ||
    l === K.ITEMMENULOCATION_TTVSCR_TMS
  );
}

function BackUpPlayerBag(): void {
  sBackupPlayerBag = {
    pockets: state.bag.pockets.slice(0, K.NUM_BAG_POCKETS_NO_CASES).map((p) => p.map((s) => ({ ...s }))),
    registeredItem: state.registeredItem,
    pocket: gBagMenuState.pocket,
    itemsAbove: [...gBagMenuState.itemsAbove],
    cursorPos: [...gBagMenuState.cursorPos],
  };
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) for (const s of state.bag.pockets[i]) Object.assign(s, { itemId: K.ITEM_NONE, quantity: 0 });
  state.registeredItem = K.ITEM_NONE;
  ResetBagCursorPositions();
}

function RestorePlayerBag(): void {
  const b = sBackupPlayerBag!;
  b.pockets.forEach((p, i) => p.forEach((s, j) => Object.assign(state.bag.pockets[i][j], s)));
  state.registeredItem = b.registeredItem;
  gBagMenuState.pocket = b.pocket;
  for (let i = 0; i < K.NUM_BAG_POCKETS_NO_CASES; i++) {
    gBagMenuState.itemsAbove[i] = b.itemsAbove[i];
    gBagMenuState.cursorPos[i] = b.cursorPos[i];
  }
  sBackupPlayerBag = null;
}

export function InitOldManBag(): void {
  BackUpPlayerBag();
  AddBagItem(K.ITEM_POTION, 1);
  AddBagItem(K.ITEM_POKE_BALL, 1);
  GoToBagMenu(K.ITEMMENULOCATION_OLD_MAN, K.OPEN_BAG_ITEMS, SetCB2ToReshowScreenAfterMenu2);
}

function Task_Bag_OldManTutorial(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    switch (data[8]) {
      case 102:
      case 204:
        PlaySE(K.SE_BAG_POCKET);
        SwitchPockets(taskId, 1, false);
        break;
      case 306:
        PlaySE(K.SE_SELECT);
        bag_menu_print_cursor_(data[0], 2);
        Bag_FillMessageBoxWithPalette(1);
        SpecialVar.ItemId = K.ITEM_POKE_BALL;
        OpenContextMenu(taskId);
        break;
      case 408:
        PlaySE(K.SE_SELECT);
        HideBagWindow(10);
        HideBagWindow(6);
        PutWindowTilemap(0);
        PutWindowTilemap(1);
        CopyWindowToVram(0, COPYWIN_MAP);
        DestroyListMenuTask(data[0]);
        RestorePlayerBag();
        Bag_BeginCloseWin0Animation();
        gTasks[taskId].func = Task_Pokedude_FadeFromBag;
        return;
    }
    data[8]++;
  }
}

function Task_Pokedude_FadeFromBag(taskId: number): void {
  BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_Pokedude_WaitFadeAndExitBag;
}

/**
 * InitPokedudeBag: the Pokédude's own bag (the player's backed up), scripted by the location's task. The battle demos
 * (TTVSCR_STATUS / _CATCHING, from the Pokédude's controller) go back to the battle; the field ones (TTVSCR_REGISTER /
 * _TMS, from Teachy TV) to Teachy TV.
 */
export function InitPokedudeBag(location: number): void {
  BackUpPlayerBag();
  AddBagItem(K.ITEM_POTION, 1);
  AddBagItem(K.ITEM_ANTIDOTE, 1);
  AddBagItem(K.ITEM_TEACHY_TV, 1);
  AddBagItem(K.ITEM_TM_CASE, 1);
  AddBagItem(K.ITEM_POKE_BALL, 5);
  AddBagItem(K.ITEM_GREAT_BALL, 1);
  AddBagItem(K.ITEM_NEST_BALL, 1);
  let cb2: MainCallback;
  switch (location) {
    default:
      cb2 = CB2_ReturnToTeachyTV;
      break;
    case K.ITEMMENULOCATION_TTVSCR_STATUS:
    case K.ITEMMENULOCATION_TTVSCR_CATCHING:
      cb2 = SetCB2ToReshowScreenAfterMenu2;
      break;
  }
  GoToBagMenu(location, K.OPEN_BAG_ITEMS, cb2);
}

/** Task_BButtonInterruptTeachyTv: B stops the demo, back to Teachy TV's list. */
function Task_BButtonInterruptTeachyTv(taskId: number): boolean {
  if (JOY_NEW(B_BUTTON)) {
    RestorePlayerBag();
    SetTeachyTvControllerModeToResume();
    disp().exitCB = CB2_ReturnToTeachyTV;
    gTasks[taskId].func = Task_Pokedude_FadeFromBag;
    return true;
  }
  return false;
}

/** The scripted presses (ListMenu_ProcessInput reads gMain.newAndRepeatedKeys). */
function pressListDpad(listTaskId: number, button: number): void {
  gMain.newKeys = 0;
  gMain.newAndRepeatedKeys = button;
  ListMenu_ProcessInput(listTaskId);
}

/** Task_Bag_TeachyTvCatching: the POKé BALLS pocket, down twice, up twice, POKé BALL → USE. */
function Task_Bag_TeachyTvCatching(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    if (Task_BButtonInterruptTeachyTv(taskId)) {
      FreeRestoreBattleData();
      LoadPlayerParty();
      return;
    }
    switch (data[8]) {
      case 102:
      case 204:
        PlaySE(K.SE_BAG_POCKET);
        SwitchPockets(taskId, 1, false);
        break;
      case 306:
      case 408:
        pressListDpad(data[0], DPAD_DOWN);
        break;
      case 510:
      case 612:
        pressListDpad(data[0], DPAD_UP);
        break;
      case 714:
        PlaySE(K.SE_SELECT);
        bag_menu_print_cursor_(data[0], 2);
        Bag_FillMessageBoxWithPalette(1);
        SpecialVar.ItemId = K.ITEM_POKE_BALL;
        OpenContextMenu(taskId);
        break;
      case 816:
        PlaySE(K.SE_SELECT);
        HideBagWindow(10);
        HideBagWindow(6);
        PutWindowTilemap(0);
        PutWindowTilemap(1);
        CopyWindowToVram(0, COPYWIN_MAP);
        DestroyListMenuTask(data[0]);
        RestorePlayerBag();
        Bag_BeginCloseWin0Animation();
        gTasks[taskId].func = Task_Pokedude_FadeFromBag;
        return;
    }
    data[8]++;
  }
}

/** Task_Bag_TeachyTvStatus: down to ANTIDOTE → USE, then the party menu (Pokedude_ChooseMonForInBattleItem). */
function Task_Bag_TeachyTvStatus(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    if (Task_BButtonInterruptTeachyTv(taskId)) {
      FreeRestoreBattleData();
      LoadPlayerParty();
      return;
    }
    switch (data[8]) {
      case 102:
        pressListDpad(data[0], DPAD_DOWN);
        break;
      case 204:
        PlaySE(K.SE_SELECT);
        bag_menu_print_cursor_(data[0], 2);
        Bag_FillMessageBoxWithPalette(1);
        SpecialVar.ItemId = K.ITEM_ANTIDOTE;
        OpenContextMenu(taskId);
        break;
      case 306:
        PlaySE(K.SE_SELECT);
        HideBagWindow(10);
        HideBagWindow(6);
        PutWindowTilemap(0);
        PutWindowTilemap(1);
        CopyWindowToVram(0, COPYWIN_MAP);
        DestroyListMenuTask(data[0]);
        RestorePlayerBag();
        setItemUseCB(ItemUseCB_MedicineStep);
        ItemMenu_SetExitCallback(Pokedude_ChooseMonForInBattleItem);
        gTasks[taskId].func = Task_Pokedude_FadeFromBag;
        return;
    }
    data[8]++;
  }
}

/**
 * Task_Bag_TeachyTvRegister: KEY ITEMS, TEACHY TV → REGISTER (gSaveBlock1Ptr->registeredItem, the list redrawn with
 * its mark), down twice, then the bag closes (back to Teachy TV, CB2_ReturnToTeachyTV).
 */
function Task_Bag_TeachyTvRegister(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active && Task_BButtonInterruptTeachyTv(taskId) !== true) {
    switch (data[8]) {
      case 102:
        PlaySE(K.SE_BAG_POCKET);
        SwitchPockets(taskId, 1, false);
        break;
      case 204:
        PlaySE(K.SE_SELECT);
        bag_menu_print_cursor_(data[0], 2);
        Bag_FillMessageBoxWithPalette(1);
        SpecialVar.ItemId = K.ITEM_TEACHY_TV;
        OpenContextMenu(taskId);
        break;
      case 306:
        PlaySE(K.SE_SELECT);
        Menu_MoveCursorNoWrapAround(1);
        break;
      case 408:
        PlaySE(K.SE_SELECT);
        state.registeredItem = SpecialVar.ItemId;
        HideBagWindow(10);
        HideBagWindow(6);
        PutWindowTilemap(0);
        PutWindowTilemap(1);
        destroyBagList(data[0]);
        Bag_BuildListMenuTemplate(gBagMenuState.pocket);
        data[0] = initBagList();
        Bag_FillMessageBoxWithPalette(0);
        bag_menu_print_cursor_(data[0], 1);
        CopyWindowToVram(0, COPYWIN_MAP);
        break;
      case 510:
      case 612:
        pressListDpad(data[0], DPAD_DOWN);
        break;
      case 714:
        PlaySE(K.SE_SELECT);
        DestroyListMenuTask(data[0]);
        RestorePlayerBag();
        Bag_BeginCloseWin0Animation();
        gTasks[taskId].func = Task_Pokedude_FadeFromBag;
        return;
    }
    data[8]++;
  }
}

/** Task_Bag_TeachyTvTMs: KEY ITEMS, down to the TM CASE → USE; the bag closes into the Pokédude's TM case. */
function Task_Bag_TeachyTvTMs(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active && Task_BButtonInterruptTeachyTv(taskId) !== true) {
    switch (data[8]) {
      case 102:
        PlaySE(K.SE_BAG_POCKET);
        SwitchPockets(taskId, 1, false);
        break;
      case 204:
        pressListDpad(data[0], DPAD_DOWN);
        break;
      case 306:
        PlaySE(K.SE_SELECT);
        bag_menu_print_cursor_(data[0], 2);
        Bag_FillMessageBoxWithPalette(1);
        SpecialVar.ItemId = K.ITEM_TM_CASE;
        OpenContextMenu(taskId);
        break;
      case 408:
        PlaySE(K.SE_SELECT);
        HideBagWindow(10);
        HideBagWindow(6);
        PutWindowTilemap(0);
        PutWindowTilemap(1);
        CopyWindowToVram(0, COPYWIN_MAP);
        DestroyListMenuTask(data[0]);
        RestorePlayerBag();
        disp().exitCB = Pokedude_InitTMCase;
        gTasks[taskId].func = Task_Pokedude_FadeFromBag;
        return;
    }
    data[8]++;
  }
}

function Task_Pokedude_WaitFadeAndExitBag(taskId: number): void {
  if (!gPaletteFade.active && FuncIsActiveTask(Task_AnimateWin0v) !== true) {
    if (disp().exitCB !== null) SetMainCallback2(disp().exitCB);
    else SetMainCallback2(gBagMenuState.bagCallback);
    BagDestroyPocketScrollArrowPair();
    DestroyBagMenuResources();
    DestroyTask(taskId);
  }
}
