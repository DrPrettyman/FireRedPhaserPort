// party_menu.c: the party menu, from the field (start menu, using and giving items) and in battle
// (switching, choosing a mon for an item, Oak's first-battle narration).
//
// Field moves: CursorCB_FieldMove runs the SetUpFieldMove_* function world/fieldMoves.ts registered for the
// move (registerFieldMoveSetUp) and hands over to the field through gFieldCallback2 / gPostMenuFieldCallback;
// Soft-Boiled / Milk Drink (fldeff_softboiled.c) stay in this menu.
//
// Mail (W-mail): giving mail from the bag or the party menu's GIVE writes it on the Easy Chat screen
// (EASY_CHAT_TYPE_MAIL), MAIL → READ shows it (menus/mail.ts), MAIL → TAKE sends it to the PC mailbox or loses the
// message; the data is world/mail.ts (mail_data.c). The player's PC mailbox's GIVE (ui/PlayerPcMenu.ts) opens it with
// ChooseMonToGiveMailFromMailbox (PARTY_ACTION_GIVE_MAILBOX_MAIL: TryGiveMailToSelectedMon).
//
// Not ported because their screens or systems don't exist yet: the item-use animation (pokemon_special_anim.c),
// link/multi battles, the Union Room, minigames and the Pokédude/Teachy TV demos.

import { K } from '../battle/constants';
import { g, pokemon, state } from '../battle/env';
import { AddPCItem, RemovePCItem } from '../state/pcItems';
import { btlCtrlOakOldManTestState2Flag, BtlCtrl_OakOldMan_SetState2Flag } from '../battle/controllerOakOldMan';
import { DrawLevelUpWindowPg1, DrawLevelUpWindowPg2, GetMonLevelUpWindowStats } from '../battle/bsCommands3';
import { GetHPBarLevel, GetScaledHPFraction } from '../battle/battleInterface';
import { CanMonLearnTMHM, CheckPartyPokerus, ExecuteTableBasedItemEffect, GetEvolutionTargetSpecies, itemEffectTable, PokemonItemUseNoEffect } from '../battle/items';
import { battleStringExpandPlaceholders, encodeBattleText, moveName } from '../battle/message';
import { getPartyIdFromBattlePartyId, getPartyIdFromBattleSlot, switchPartyMonSlots } from '../battle/partyOrder';
import { adjustFriendship, giveMoveToMon, monTryLearningNewMove, removeMonPPBonus, setMonMoveSlot } from '../battle/pokemonBattle';
import { SetCB2ToReshowScreenAfterMenu } from '../battle/reshowBattleScreen';
import { getBattlerSide } from '../battle/util';
import {
  CopyRectToBgTilemapBufferRect,
  CopyToBgTilemapBufferRect_ChangePalette,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, PALETTES_ALL, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback, START_BUTTON, type MainCallback } from '../gba/main';
import {
  ClearDialogWindowAndFrameToTransparent,
  ClearScheduledBgCopiesToVram,
  ClearStdWindowAndFrameToTransparent,
  CopyToBufferFromBgTilemap,
  CreateYesNoMenu,
  DoScheduledBgTilemapCopiesToVram,
  DrawDialogFrameWithCustomTileAndPalette,
  DrawHelpMessageWindowTilesById,
  DrawStdFrameWithCustomTileAndPalette,
  GetLRKeysPressedAndHeld,
  GetMenuCursorDimensionByFont,
  GetTextSpeedSetting,
  GetTextWindowPalette,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  MENU_B_PRESSED,
  MENU_L_PRESSED,
  MENU_NOTHING_CHOSEN,
  MENU_R_PRESSED,
  Menu_GetCursorPos,
  Menu_InitCursor,
  Menu_InitCursorInternal,
  Menu_ProcessInput,
  Menu_ProcessInput_other,
  Menu_ProcessInputNoWrapAround_other,
  Menu_ProcessInputNoWrapClearOnChoose,
  MenuHelpers_IsLinkActive,
  MenuHelpers_ShouldWaitForLinkRecv,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ResetVramOamAndBgCntRegs,
  RunTextPrinters_CheckActive,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
  SetWindowTemplateFields,
  AddTextPrinterParameterized2,
  TEXT_COLOR_DARK_GRAY,
  TEXT_COLOR_LIGHT_GRAY,
  TEXT_COLOR_WHITE,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { IsFanfareTaskInactive, PlayFanfare, PlayFanfareByFanfareNum, PlaySE, WaitFanfare } from '../gba/sound';
import {
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
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
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, ResetTasks, RunTasks, SetTaskFuncWithFollowupFunc, SwitchTaskToFollowupFunc, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  BlitBitmapToWindow,
  ClearWindowTilemap,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_LETTER_SPACING,
  FONTATTR_MAX_LETTER_WIDTH,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  GetWindowAttribute,
  gTextFlags,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { animTable, HandleBattleLowHpMusicChange } from '../battle/gfx';
import { GetLastViewedMonIndex, GetMoveSlotToReplace, ShowPokemonSummaryScreen, ShowSelectMovePokemonSummaryScreen } from './summaryScreen';
import {
  AddBagItem,
  CalculatePlayerPartyCount,
  concat,
  ConvertIntToDecimalStringN,
  CopyItemName,
  ExpandToStringVar4,
  GetMonNickname,
  GetPocketByItemId,
  gStringVar1,
  gStringVar2,
  gStringVar4,
  ItemId_GetName,
  ItemId_GetPocket,
  ItemIsMail,
  partyMon,
  partySpecies,
  RemoveBagItem,
  setStringVar4,
  speciesName,
  speciesOrEgg,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  stringsEqual,
  text,
} from './common';
import { menusData } from './data';
import { CB2_ReturnToField, CB2_ReturnToFieldContinueScriptPlayMapMusic, CB2_ReturnToFieldWithOpenMenu, gFieldCallback2, type FieldCallbackHost } from './fieldCallbacks';
import { CB2_OpenFlyMap } from './regionMap';
import { gFieldEffectArguments } from '../world/fieldEffectScripts';
import { avatarField, GetXYCoordsOneStepInFrontOfPlayer, PLAYER_AVATAR_FLAG, TestPlayerAvatarFlags } from '../world/playerAvatar';
import { GetMapName, GetMapSectionOfMap } from '../world/regionMap';
import { CB2_BagMenuFromBattle, CB2_SetUpReshowBattleScreenAfterMenu, GoToBagMenu } from './itemMenu';
import { DoEasyChatScreen } from './easyChatScreen';
import { ReadMail } from './mail';
import { ClearMailStruct, GetMonMailId, GiveMailToMon, GiveMailToMon2, gPlayerPcMenuManager, newMail, TakeMailFromMon, TakeMailFromMon2 } from '../world/mail';
import { SpecialVar } from './itemMenuState';
import { CheckIfItemIsTMHMOrEvolutionStone } from './itemUse';
import { InitTMCase, TMCASE_KEEP_PREV, TMCASE_REOPENING } from './tmCase';
import { BERRYPOUCH_KEEP_PREV, BERRYPOUCH_NA, InitBerryPouch } from './berryPouch';
import { BeginEvolutionScene, setCB2_AfterEvolution } from './evolutionScene';
import { CreateMonIcon, LoadMonIconPalettes, SetPartyHPBarSprite, SpriteCB_MonIcon, UpdateMonIconFrame } from './pokemonIcon';
import { testEvent } from '../dev/testHooks';
import { GetNumberOfRelearnableMoves } from './learnMove';
import { IsNationalPokedexEnabled } from '../state/nationalDex';
import { SetHelpContext } from '../ui/helpSystemContext';

const PARTY_PAL_SELECTED = 1 << 0;
const PARTY_PAL_FAINTED = 1 << 1;
const PARTY_PAL_TO_SWITCH = 1 << 2;
const PARTY_PAL_MULTI_ALT = 1 << 3;
const PARTY_PAL_SWITCHING = 1 << 4;
const PARTY_PAL_TO_SOFTBOIL = 1 << 5;

const MENU_DIR_DOWN = 1;
const MENU_DIR_UP = -1;
const MENU_DIR_RIGHT = 2;
const MENU_DIR_LEFT = -2;

const SLOT_CONFIRM = () => K.PARTY_SIZE;
const SLOT_CANCEL = () => K.PARTY_SIZE + 1;

const CAN_LEARN_MOVE = 0;
const CANNOT_LEARN_MOVE = 1;
const ALREADY_KNOWS_MOVE = 2;
const CANNOT_LEARN_MOVE_IS_EGG = 3;

const LEARN_VIA_TMHM = 0;
const LEARN_VIA_LEVEL_UP = 1;
const LEARN_VIA_TUTOR = 2;

const DRAW_TEXT_ONLY = 0;
const DRAW_MENU_BOX_AND_TEXT = 1;
const DRAW_MENU_BOX_ONLY = 2;

type BlitFunc = (windowId: number, x: number, y: number, width: number, height: number, hideHP: boolean) => void;

/** struct PartyMenuBoxInfoRects */
interface PartyMenuBoxInfoRects {
  blitFunc: BlitFunc;
  dimensions: number[];
  descTextLeft: number;
  descTextTop: number;
  descTextWidth: number;
  descTextHeight: number;
}

/** struct PartyMenuInternal */
interface PartyMenuInternal {
  task: TaskFunc;
  exitCallback: MainCallback | null;
  chooseMultiple: boolean;
  lastSelectedSlot: number;
  spriteIdConfirmPokeball: number;
  spriteIdCancelPokeball: number;
  messageId: number;
  windowId: number[];
  actions: number[];
  numActions: number;
  palBuffer: Uint16Array;
  data: Int16Array;
}

/** struct PartyMenuBox */
interface PartyMenuBox {
  infoRects: PartyMenuBoxInfoRects;
  spriteCoords: number[];
  windowId: number;
  monSpriteId: number;
  itemSpriteId: number;
  pokeballSpriteId: number;
  statusSpriteId: number;
}

/** struct PartyMenu. data[0] doubles as learnMoveId / ppMoveSlot / minigameBitflag, data[1] as learnMoveMethod. */
export const gPartyMenu = {
  exitCallback: null as MainCallback | null,
  task: null as TaskFunc | null,
  menuType: 0,
  layout: 0,
  chooseMonsBattleType: 0,
  slotId: 0,
  slotId2: 0,
  action: 0,
  bagItem: 0,
  data: new Int16Array(2),
  get learnMoveId() {
    return this.data[0] & 0xffff;
  },
  set learnMoveId(v: number) {
    this.data[0] = v;
  },
  get ppMoveSlot() {
    return this.data[0];
  },
  set ppMoveSlot(v: number) {
    this.data[0] = v;
  },
  get learnMoveMethod() {
    return this.data[1];
  },
  set learnMoveMethod(v: number) {
    this.data[1] = v;
  },
};

let sPartyMenuInternal: PartyMenuInternal | null = null;
let sPartyMenuBoxes: PartyMenuBox[] | null = null;
let sPartyBgGfxTilemap: Uint8Array | null = null;
let sPartyBgTilemapBuffer: Uint16Array | null = null;
export let gPartyMenuUseExitCallback = false;
export let gSelectedMonPartyId = 0;
let sSlot1TilemapBuffer: Uint16Array = new Uint16Array(0);
let sSlot2TilemapBuffer: Uint16Array = new Uint16Array(0);
export const gSelectedOrderFromParty = [0, 0, 0];
let sPartyMenuItemId = 0;

/** gItemUseCB */
export let gItemUseCB: ((taskId: number, func: TaskFunc) => void) | null = null;
export function setItemUseCB(cb: (taskId: number, func: TaskFunc) => void): void {
  gItemUseCB = cb;
}

const internal = () => sPartyMenuInternal!;
const boxes = () => sPartyMenuBoxes!;
/** gPlayerParty[slot]! */
const P = (slot: number) => state.party[slot]!;

// ------------------------------------------------------------------ data/party_menu.h

const sPartyMenuBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 28, screenSize: 1, paletteMode: 0, priority: 0, baseTile: 0 },
];

const PARTY_BOX_LEFT_COLUMN = 0;
const PARTY_BOX_RIGHT_COLUMN = 1;

const sPartyBoxInfoRects: PartyMenuBoxInfoRects[] = [
  {
    blitFunc: BlitBitmapToPartyWindow_LeftColumn,
    // x, y, width, height for nickname, level, gender, HP, max HP, HP bar
    dimensions: [24, 11, 40, 13, 32, 20, 32, 8, 64, 20, 8, 8, 38, 36, 24, 8, 53, 36, 24, 8, 24, 35, 48, 3],
    descTextLeft: 12,
    descTextTop: 34,
    descTextWidth: 64,
    descTextHeight: 16,
  },
  {
    blitFunc: BlitBitmapToPartyWindow_RightColumn,
    dimensions: [22, 3, 40, 13, 32, 12, 32, 8, 64, 12, 8, 8, 102, 12, 24, 8, 117, 12, 24, 8, 88, 10, 48, 3],
    descTextLeft: 77,
    descTextTop: 4,
    descTextWidth: 64,
    descTextHeight: 16,
  },
];

/** sPartyMenuSpriteCoords[layout][slot]: pokemon, held item, status, pokeball coords */
const sPartyMenuSpriteCoords: number[][][] = [
  [
    [16, 40, 20, 50, 56, 52, 16, 34],
    [104, 18, 108, 28, 144, 27, 102, 25],
    [104, 42, 108, 52, 144, 51, 102, 49],
    [104, 66, 108, 76, 144, 75, 102, 73],
    [104, 90, 108, 100, 144, 99, 102, 97],
    [104, 114, 108, 124, 144, 123, 102, 121],
  ],
  [
    [16, 24, 20, 34, 56, 36, 16, 18],
    [16, 80, 20, 90, 56, 92, 16, 74],
    [104, 18, 108, 28, 144, 27, 102, 25],
    [104, 50, 108, 60, 144, 59, 102, 57],
    [104, 82, 108, 92, 144, 91, 102, 89],
    [104, 114, 108, 124, 144, 123, 102, 121],
  ],
  [
    [16, 24, 20, 34, 56, 36, 16, 18],
    [16, 80, 20, 90, 56, 92, 16, 74],
    [104, 26, 106, 36, 144, 35, 102, 33],
    [104, 50, 106, 60, 144, 59, 102, 57],
    [104, 82, 106, 92, 144, 91, 102, 89],
    [104, 106, 106, 116, 144, 115, 102, 113],
  ],
  [
    [16, 32, 20, 42, 56, 44, 16, 26],
    [104, 34, 106, 44, 144, 43, 102, 41],
    [104, 58, 106, 68, 144, 67, 102, 65],
    [16, 104, 20, 114, 56, 116, 16, 98],
    [104, 106, 106, 116, 144, 115, 102, 113],
    [104, 130, 106, 140, 144, 139, 102, 137],
  ],
];

/** sFontColorTable: [bg, fg, shadow] */
const sFontColorTable = () => [
  [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_LIGHT_GRAY, K.TEXT_COLOR_DARK_GRAY], // Default
  [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_GREEN], // Unused
  [K.TEXT_COLOR_TRANSPARENT, K.TEXT_DYNAMIC_COLOR_2, K.TEXT_DYNAMIC_COLOR_3], // Gender symbol
  [K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_LIGHT_GRAY], // Selection actions
  [K.TEXT_COLOR_WHITE, K.TEXT_COLOR_BLUE, K.TEXT_COLOR_LIGHT_BLUE], // Field moves
  [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY], // Unused
];

const win = (bg: number, tilemapLeft: number, tilemapTop: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate => ({
  bg,
  tilemapLeft,
  tilemapTop,
  width,
  height,
  paletteNum,
  baseBlock,
});

const sSinglePartyMenuWindowTemplate = [
  win(0, 1, 3, 10, 7, 3, 0x63),
  win(0, 12, 1, 18, 3, 4, 0xa9),
  win(0, 12, 4, 18, 3, 5, 0xdf),
  win(0, 12, 7, 18, 3, 6, 0x115),
  win(0, 12, 10, 18, 3, 7, 0x14b),
  win(0, 12, 13, 18, 3, 8, 0x181),
  win(2, 1, 15, 28, 4, 14, 0x1df),
  DUMMY_WIN_TEMPLATE,
];
const sDoublePartyMenuWindowTemplate = [
  win(0, 1, 1, 10, 7, 3, 0x63),
  win(0, 1, 8, 10, 7, 4, 0xa9),
  win(0, 12, 1, 18, 3, 5, 0xef),
  win(0, 12, 5, 18, 3, 6, 0x125),
  win(0, 12, 9, 18, 3, 7, 0x15b),
  win(0, 12, 13, 18, 3, 8, 0x191),
  win(2, 1, 15, 28, 4, 14, 0x1df),
  DUMMY_WIN_TEMPLATE,
];
const sMultiPartyMenuWindowTemplate = [
  win(0, 1, 1, 10, 7, 3, 0x63),
  win(0, 1, 8, 10, 7, 4, 0xa9),
  win(0, 12, 2, 18, 3, 5, 0xef),
  win(0, 12, 5, 18, 3, 6, 0x125),
  win(0, 12, 9, 18, 3, 7, 0x15b),
  win(0, 12, 12, 18, 3, 8, 0x191),
  win(2, 1, 15, 28, 4, 14, 0x1df),
  DUMMY_WIN_TEMPLATE,
];
const sShowcaseMultiPartyMenuWindowTemplate = [
  win(0, 1, 2, 10, 7, 3, 0x63),
  win(0, 12, 3, 18, 3, 5, 0xa9),
  win(0, 12, 6, 18, 3, 6, 0xdf),
  win(2, 1, 11, 10, 7, 4, 0x115),
  win(2, 12, 12, 18, 3, 7, 0x16b),
  win(2, 12, 15, 18, 3, 8, 0x1a1),
  DUMMY_WIN_TEMPLATE,
];
const sCancelButtonWindowTemplate = win(0, 24, 17, 6, 2, 3, 0x1c7);
const sMultiCancelButtonWindowTemplate = win(0, 24, 18, 6, 2, 3, 0x1c7);
const sConfirmButtonWindowTemplate = win(0, 24, 16, 6, 2, 3, 0x1d3);
const sDefaultPartyMsgWindowTemplate = win(2, 1, 17, 21, 2, 15, 0x24f);
const sDoWhatWithMonMsgWindowTemplate = win(2, 1, 17, 16, 2, 15, 0x279);
const sDoWhatWithItemMsgWindowTemplate = win(2, 1, 17, 19, 2, 15, 0x299);
const sDoWhatWithMailMsgWindowTemplate = win(2, 1, 17, 16, 2, 15, 0x299);
const sWhichMoveMsgWindowTemplate = win(2, 1, 17, 15, 2, 15, 0x299);
const sItemGiveTakeWindowTemplate = win(2, 22, 13, 7, 6, 14, 0x373);
const sMailReadTakeWindowTemplate = win(2, 19, 13, 10, 6, 14, 0x373);
const sMoveSelectWindowTemplate = win(2, 18, 11, 11, 8, 14, 0x2bf);
const sPartyMenuYesNoWindowTemplate = win(2, 21, 9, 6, 4, 14, 0x2bf);
const sLevelUpStatsWindowTemplate = win(2, 19, 1, 10, 11, 14, 0x2bf);
const sWindowTemplate_FirstBattleOakVoiceover = win(2, 2, 15, 26, 4, 14, 0x1df);
const sFieldMoveDescriptionWindowTemplate = win(2, 0, 13, 18, 3, 12, 0x373);

const sGenderPalOffsets = [11, 12];
const sHPBarPalOffsets = [9, 10];
const sPartyBoxPalOffsets1 = [4, 5, 6];
const sPartyBoxPalOffsets2 = [1, 7, 8];
const sGenderMalePalIds = [59, 60];
const sGenderFemalePalIds = [75, 76];
const sHPBarGreenPalIds = [57, 58];
const sHPBarYellowPalIds = [73, 74];
const sHPBarRedPalIds = [89, 90];
const sPartyBoxEmptySlotPalIds1 = [52, 53, 54];
const sPartyBoxMultiPalIds1 = [68, 69, 70];
const sPartyBoxFaintedPalIds1 = [84, 85, 86];
const sPartyBoxCurrSelectionPalIds1 = [116, 117, 118];
const sPartyBoxCurrSelectionMultiPalIds = [132, 133, 134];
const sPartyBoxCurrSelectionFaintedPalIds = [148, 149, 150];
const sPartyBoxSelectedForActionPalIds1 = [100, 101, 102];
const sPartyBoxEmptySlotPalIds2 = [49, 55, 56];
const sPartyBoxMultiPalIds2 = [65, 71, 72];
const sPartyBoxFaintedPalIds2 = [81, 87, 88];
const sPartyBoxCurrSelectionPalIds2 = [97, 103, 104];
const sPartyBoxSelectedForActionPalIds2 = [161, 167, 168];

/** sActionStringTable[PARTY_MSG_*] */
function sActionStringTable(id: number): number[] {
  const names: Record<number, string> = {
    [K.PARTY_MSG_CHOOSE_MON]: 'gText_ChoosePokemon',
    [K.PARTY_MSG_CHOOSE_MON_OR_CANCEL]: 'gText_ChoosePokemonCancel',
    [K.PARTY_MSG_CHOOSE_MON_AND_CONFIRM]: 'gText_ChoosePokemonConfirm',
    [K.PARTY_MSG_MOVE_TO_WHERE]: 'gText_MoveToWhere',
    [K.PARTY_MSG_TEACH_WHICH_MON]: 'gText_TeachWhichPokemon',
    [K.PARTY_MSG_USE_ON_WHICH_MON]: 'gText_UseOnWhichPokemon',
    [K.PARTY_MSG_GIVE_TO_WHICH_MON]: 'gText_GiveToWhichPokemon',
    [K.PARTY_MSG_NOTHING_TO_CUT]: 'gText_NothingToCut',
    [K.PARTY_MSG_CANT_SURF_HERE]: 'gText_CantSurfHere',
    [K.PARTY_MSG_ALREADY_SURFING]: 'gText_AlreadySurfing',
    [K.PARTY_MSG_CURRENT_TOO_FAST]: 'gText_CurrentIsTooFast',
    [K.PARTY_MSG_ENJOY_CYCLING]: 'gText_EnjoyCycling',
    [K.PARTY_MSG_ALREADY_IN_USE]: 'gText_InUseAlready_PM',
    [K.PARTY_MSG_CANT_USE_HERE]: 'gText_CantUseHere',
    [K.PARTY_MSG_NO_MON_FOR_BATTLE]: 'gText_NoPokemonForBattle',
    [K.PARTY_MSG_CHOOSE_MON_2]: 'gText_ChoosePokemon2',
    [K.PARTY_MSG_NOT_ENOUGH_HP]: 'gText_NotEnoughHp',
    [K.PARTY_MSG_THREE_MONS_ARE_NEEDED]: 'gText_ThreePkmnAreNeeded',
    [K.PARTY_MSG_TWO_MONS_ARE_NEEDED]: 'gText_TwoPokemonAreNeeded',
    [K.PARTY_MSG_MONS_CANT_BE_SAME]: 'gText_PokemonCantBeSame',
    [K.PARTY_MSG_NO_SAME_HOLD_ITEMS]: 'gText_NoIdenticalHoldItems',
    [K.PARTY_MSG_UNUSED]: 'gString_Dummy',
    [K.PARTY_MSG_DO_WHAT_WITH_MON]: 'gText_DoWhatWithPokemon',
    [K.PARTY_MSG_RESTORE_WHICH_MOVE]: 'gText_RestoreWhichMove',
    [K.PARTY_MSG_BOOST_PP_WHICH_MOVE]: 'gText_BoostPp',
    [K.PARTY_MSG_DO_WHAT_WITH_ITEM]: 'gText_DoWhatWithItem',
    [K.PARTY_MSG_DO_WHAT_WITH_MAIL]: 'gText_DoWhatWithMail',
  };
  return text(names[id]);
}

/** sDescriptionStringTable[PARTYBOX_DESC_*] */
function sDescriptionStringTable(id: number): number[] {
  const names: Record<number, string> = {
    [K.PARTYBOX_DESC_NO_USE]: 'gText_NoUse',
    [K.PARTYBOX_DESC_ABLE_3]: 'gText_Able',
    [K.PARTYBOX_DESC_FIRST]: 'gText_First_PM',
    [K.PARTYBOX_DESC_SECOND]: 'gText_Second_PM',
    [K.PARTYBOX_DESC_THIRD]: 'gText_Third_PM',
    [K.PARTYBOX_DESC_ABLE]: 'gText_Able2',
    [K.PARTYBOX_DESC_NOT_ABLE]: 'gText_NotAble',
    [K.PARTYBOX_DESC_ABLE_2]: 'gText_Able3',
    [K.PARTYBOX_DESC_NOT_ABLE_2]: 'gText_NotAble2',
    [K.PARTYBOX_DESC_LEARNED]: 'gText_Learned',
  };
  return text(names[id]);
}

/** sFieldMoveDescriptionTable[FIELD_MOVE_*] */
function sFieldMoveDescriptionTable(fieldMove: number): number[] {
  const names: Record<number, string> = {
    [K.FIELD_MOVE_FLASH]: 'gText_LightUpDarkness',
    [K.FIELD_MOVE_CUT]: 'gText_CutATreeOrGrass',
    [K.FIELD_MOVE_FLY]: 'gText_FlyToAKnownTown',
    [K.FIELD_MOVE_STRENGTH]: 'gText_MoveHeavyBoulders',
    [K.FIELD_MOVE_SURF]: 'gText_TravelOnWater',
    [K.FIELD_MOVE_ROCK_SMASH]: 'gText_ShatterACrackedRock',
    [K.FIELD_MOVE_WATERFALL]: 'gText_ClimbAWaterfall',
    [K.FIELD_MOVE_TELEPORT]: 'gText_ReturnToAHealingSpot',
    [K.FIELD_MOVE_DIG]: 'gText_EscapeFromHere',
    [K.FIELD_MOVE_MILK_DRINK]: 'gText_ShareHp',
    [K.FIELD_MOVE_SOFT_BOILED]: 'gText_ShareHp',
    [K.FIELD_MOVE_SWEET_SCENT]: 'gText_LureWildPokemon',
  };
  return text(names[fieldMove]);
}

const sOamData_HeldItem = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], priority: 1 });
const sOamData_MenuPokeball = oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 });
const sOamData_MenuPokeballSmall = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 2 });
const sOamData_StatusCondition = oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1], priority: 1 });

const TAG_HELD_ITEM = 0xd750;
const TAG_POKEBALL = 0x04b0;
const TAG_POKEBALL_SMALL = 0x04b1;
const TAG_STATUS_ICONS = 1202;

const spriteTemplate = (tileTag: number, paletteTag: number, o: typeof sOamData_HeldItem, anims: string): SpriteTemplate => ({
  tileTag,
  paletteTag,
  oam: o,
  anims: animTable('party_menu.c', anims),
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
});
const sSpriteTemplate_HeldItem = () => spriteTemplate(TAG_HELD_ITEM, TAG_HELD_ITEM, sOamData_HeldItem, 'sSpriteAnimTable_HeldItem');
const sSpriteTemplate_MenuPokeball = () => spriteTemplate(TAG_POKEBALL, TAG_POKEBALL, sOamData_MenuPokeball, 'sSpriteAnimTable_MenuPokeball');
const sSpriteTemplate_MenuPokeballSmall = () => spriteTemplate(1201, 1200, sOamData_MenuPokeballSmall, 'sSpriteAnimTable_MenuPokeballSmall');
const sSpriteTemplate_StatusIcons = () => spriteTemplate(TAG_STATUS_ICONS, TAG_STATUS_ICONS, sOamData_StatusCondition, 'sSpriteTemplate_StatusCondition');

// CURSOR_OPTION_*
const CURSOR_OPTION_SUMMARY = 0;
const CURSOR_OPTION_SWITCH = 1;
const CURSOR_OPTION_CANCEL1 = 2;
const CURSOR_OPTION_ITEM = 3;
const CURSOR_OPTION_GIVE = 4;
const CURSOR_OPTION_TAKE_ITEM = 5;
const CURSOR_OPTION_MAIL = 6;
const CURSOR_OPTION_TAKE_MAIL = 7;
const CURSOR_OPTION_READ = 8;
const CURSOR_OPTION_CANCEL2 = 9;
const CURSOR_OPTION_SHIFT = 10;
const CURSOR_OPTION_SEND_OUT = 11;
const CURSOR_OPTION_ENTER = 12;
const CURSOR_OPTION_NO_ENTRY = 13;
const CURSOR_OPTION_STORE = 14;
const CURSOR_OPTION_REGISTER = 15;
const CURSOR_OPTION_TRADE1 = 16;
const CURSOR_OPTION_TRADE2 = 17;
const CURSOR_OPTION_FIELD_MOVES = 18;

/** sCursorOptions[CURSOR_OPTION_*]: text + callback */
function sCursorOptions(option: number): { text: number[]; func: TaskFunc } {
  if (option >= CURSOR_OPTION_FIELD_MOVES) return { text: moveName(sFieldMoves()[option - CURSOR_OPTION_FIELD_MOVES]), func: CursorCB_FieldMove };
  const table: [string, TaskFunc][] = [
    ['gText_Summary5', CursorCB_Summary],
    ['gText_Switch2', CursorCB_Switch],
    ['gFameCheckerText_Cancel', CursorCB_Cancel1],
    ['gText_Item', CursorCB_Item],
    ['gOtherText_Give', CursorCB_Give],
    ['gText_Take', CursorCB_TakeItem],
    ['gText_Mail', CursorCB_Mail],
    ['gText_Take2', CursorCB_TakeMail],
    ['gText_Read2', CursorCB_Read],
    ['gFameCheckerText_Cancel', CursorCB_Cancel2],
    ['gText_Shift', CursorCB_SendMon],
    ['gText_SendOut', CursorCB_SendMon],
    ['gText_Enter', CursorCB_Enter],
    ['gText_NoEntry', CursorCB_NoEntry],
    ['gText_Store', CursorCB_Store],
    ['gText_Register', CursorCB_Register],
    ['gText_Trade4', CursorCB_Trade1],
    ['gText_Trade4', CursorCB_Trade2],
  ];
  const [name, func] = table[option];
  return { text: text(name), func };
}

// ACTIONS_*
const ACTIONS_NONE = 0;
const ACTIONS_SWITCH = 1;
const ACTIONS_SHIFT = 2;
const ACTIONS_SEND_OUT = 3;
const ACTIONS_ENTER = 4;
const ACTIONS_NO_ENTRY = 5;
const ACTIONS_STORE = 6;
const ACTIONS_SUMMARY_ONLY = 7;
const ACTIONS_ITEM = 8;
const ACTIONS_MAIL = 9;
const ACTIONS_REGISTER = 10;
const ACTIONS_TRADE = 11;
const ACTIONS_SPIN_TRADE = 12;

/** sPartyMenuActions[ACTIONS_*] */
const sPartyMenuActions: (number[] | null)[] = [
  null,
  [CURSOR_OPTION_SUMMARY, CURSOR_OPTION_SWITCH, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_SHIFT, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_SEND_OUT, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_ENTER, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_NO_ENTRY, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_STORE, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_GIVE, CURSOR_OPTION_TAKE_ITEM, CURSOR_OPTION_CANCEL2],
  [CURSOR_OPTION_READ, CURSOR_OPTION_TAKE_MAIL, CURSOR_OPTION_CANCEL2],
  [CURSOR_OPTION_REGISTER, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_TRADE1, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
  [CURSOR_OPTION_TRADE2, CURSOR_OPTION_SUMMARY, CURSOR_OPTION_CANCEL1],
];

/** sFieldMoves (FIELD_MOVE_END terminated in C) */
const sFieldMoves = () => [
  K.MOVE_FLASH,
  K.MOVE_CUT,
  K.MOVE_FLY,
  K.MOVE_STRENGTH,
  K.MOVE_SURF,
  K.MOVE_ROCK_SMASH,
  K.MOVE_WATERFALL,
  K.MOVE_TELEPORT,
  K.MOVE_DIG,
  K.MOVE_MILK_DRINK,
  K.MOVE_SOFT_BOILED,
  K.MOVE_SWEET_SCENT,
];

/** sFieldMoveCursorCallbacks[fieldMove].msgId */
function fieldMoveFailMsg(fieldMove: number): number {
  switch (fieldMove) {
    case K.FIELD_MOVE_CUT:
      return K.PARTY_MSG_NOTHING_TO_CUT;
    case K.FIELD_MOVE_SURF:
      return K.PARTY_MSG_CANT_SURF_HERE;
    case K.FIELD_MOVE_MILK_DRINK:
    case K.FIELD_MOVE_SOFT_BOILED:
      return K.PARTY_MSG_NOT_ENOUGH_HP;
    default:
      return K.PARTY_MSG_CANT_USE_HERE;
  }
}

// ------------------------------------------------------------------ party_menu.c

export function InitPartyMenu(menuType: number, layout: number, partyAction: number, keepCursorPos: boolean, messageId: number, task: TaskFunc, callback: MainCallback | null): void {
  ResetPartyMenu();
  sPartyMenuInternal = {
    task,
    exitCallback: null,
    chooseMultiple: menuType === K.PARTY_MENU_TYPE_CHOOSE_MULTIPLE_MONS,
    lastSelectedSlot: 0,
    spriteIdConfirmPokeball: 0,
    spriteIdCancelPokeball: 0,
    messageId,
    windowId: [K.WINDOW_NONE, K.WINDOW_NONE, K.WINDOW_NONE],
    actions: [0, 0, 0, 0, 0, 0, 0, 0],
    numActions: 0,
    palBuffer: new Uint16Array(0x100),
    data: new Int16Array(16),
  };
  gPartyMenu.menuType = menuType;
  gPartyMenu.exitCallback = callback;
  gPartyMenu.action = partyAction;
  if (layout !== K.KEEP_PARTY_LAYOUT) gPartyMenu.layout = layout;
  if (!keepCursorPos) gPartyMenu.slotId = 0;
  else if (gPartyMenu.slotId > K.PARTY_SIZE - 1 || partySpecies(gPartyMenu.slotId) === K.SPECIES_NONE) gPartyMenu.slotId = 0;
  gTextFlags.autoScroll = false;
  CalculatePlayerPartyCount();
  SetMainCallback2(CB2_InitPartyMenu);
}

function CB2_UpdatePartyMenu(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function VBlankCB_PartyMenu(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_InitPartyMenu(): void {
  for (;;) {
    if (MenuHelpers_ShouldWaitForLinkRecv() || ShowPartyMenu() || MenuHelpers_IsLinkActive()) break;
  }
}

function ShowPartyMenu(): boolean {
  switch (gMain.state) {
    case 0:
      SetVBlankHBlankCallbacksToNull();
      ResetVramOamAndBgCntRegs();
      ClearScheduledBgCopiesToVram();
      ++gMain.state;
      break;
    case 1:
      ScanlineEffect_Stop();
      ++gMain.state;
      break;
    case 2:
      ResetPaletteFade();
      gPaletteFade.bufferTransferDisabled = true;
      ++gMain.state;
      break;
    case 3:
      ResetSpriteData();
      ++gMain.state;
      break;
    case 4:
      FreeAllSpritePalettes();
      ++gMain.state;
      break;
    case 5:
      if (!MenuHelpers_IsLinkActive()) ResetTasks();
      ++gMain.state;
      break;
    case 6:
      // SetPartyMonsAllowedInMinigame: no minigames
      ++gMain.state;
      break;
    case 7:
      AllocPartyMenuBg();
      internal().data[0] = 0;
      ++gMain.state;
      break;
    case 8:
      if (AllocPartyMenuBgGfx()) ++gMain.state;
      break;
    case 9:
      InitPartyMenuWindows(gPartyMenu.layout);
      ++gMain.state;
      break;
    case 10:
      InitPartyMenuBoxes(gPartyMenu.layout);
      internal().data[0] = 0;
      ++gMain.state;
      break;
    case 11:
      LoadHeldItemIcons();
      ++gMain.state;
      break;
    case 12:
      LoadPartyMenuPokeballGfx();
      ++gMain.state;
      break;
    case 13:
      LoadPartyMenuAilmentGfx();
      ++gMain.state;
      break;
    case 14:
      LoadMonIconPalettes();
      ++gMain.state;
      break;
    case 15:
      if (CreatePartyMonSpritesLoop()) {
        internal().data[0] = 0;
        ++gMain.state;
      }
      break;
    case 16:
      if (RenderPartyMenuBoxes()) {
        internal().data[0] = 0;
        ++gMain.state;
      }
      break;
    case 17:
      CreateCancelConfirmPokeballSprites();
      ++gMain.state;
      break;
    case 18:
      CreateCancelConfirmWindows(internal().chooseMultiple);
      ++gMain.state;
      break;
    case 19:
      SetHelpContext(K.HELPCONTEXT_PARTY_MENU);
      ++gMain.state;
      break;
    case 20:
      CreateTask(internal().task, 0);
      DisplayPartyMenuStdMessage(internal().messageId);
      ++gMain.state;
      break;
    case 21:
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      ++gMain.state;
      break;
    case 22:
      BeginNormalPaletteFade(PALETTES_ALL, -2, 16, 0, RGB_BLACK);
      gPaletteFade.bufferTransferDisabled = false;
      ++gMain.state;
      break;
    default:
      SetVBlankCallback(VBlankCB_PartyMenu);
      SetMainCallback2(CB2_UpdatePartyMenu);
      return true;
  }
  return false;
}

function ResetPartyMenu(): void {
  sPartyMenuInternal = null;
  sPartyBgTilemapBuffer = null;
  sPartyMenuBoxes = null;
  sPartyBgGfxTilemap = null;
}

function AllocPartyMenuBg(): boolean {
  ResetAllBgsCoordinatesAndBgCntRegs();
  sPartyBgTilemapBuffer = new Uint16Array(0x400);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sPartyMenuBgTemplates);
  SetBgTilemapBuffer(1, sPartyBgTilemapBuffer);
  ScheduleBgCopyTilemapToVram(1);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_OBJ_1D_MAP);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  return true;
}

function AllocPartyMenuBgGfx(): boolean {
  switch (internal().data[0]) {
    case 0:
      sPartyBgGfxTilemap = gfx('gPartyMenuBg_Gfx');
      LoadBgTiles(1, sPartyBgGfxTilemap, sPartyBgGfxTilemap.length, 0);
      ++internal().data[0];
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        sPartyBgTilemapBuffer!.set(gfx16('gPartyMenuBg_Tilemap').subarray(0, 0x400));
        ++internal().data[0];
      }
      break;
    case 2:
      LoadCompressedPalette(gfx16('gPartyMenuBg_Pal'), BG_PLTT_ID(0), 11 * 32);
      internal().palBuffer.set(gPlttBufferUnfaded.subarray(0, 11 * 16));
      ++internal().data[0];
      break;
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
      PartyPaletteBufferCopy(internal().data[0] + 1);
      ++internal().data[0];
      break;
    default:
      return true;
  }
  return false;
}

function PartyPaletteBufferCopy(offset: number): void {
  offset *= 16;
  const src = gPlttBufferUnfaded.slice(BG_PLTT_ID(3), BG_PLTT_ID(3) + 16);
  gPlttBufferUnfaded.set(src, offset);
  gPlttBufferFaded.set(src, offset);
}

function FreePartyPointers(): void {
  sPartyMenuInternal = null;
  sPartyBgTilemapBuffer = null;
  sPartyBgGfxTilemap = null;
  sPartyMenuBoxes = null;
  FreeAllWindowBuffers();
}

function InitPartyMenuBoxes(layout: number): void {
  sPartyMenuBoxes = Array.from({ length: K.PARTY_SIZE }, (_, i) => ({
    infoRects: sPartyBoxInfoRects[PARTY_BOX_RIGHT_COLUMN],
    spriteCoords: sPartyMenuSpriteCoords[layout][i],
    windowId: i,
    monSpriteId: 0,
    itemSpriteId: 0,
    pokeballSpriteId: 0,
    statusSpriteId: 0,
  }));
  // The first party mon goes in the left column
  boxes()[0].infoRects = sPartyBoxInfoRects[PARTY_BOX_LEFT_COLUMN];
  if (layout === K.PARTY_LAYOUT_MULTI_SHOWCASE) boxes()[3].infoRects = sPartyBoxInfoRects[PARTY_BOX_LEFT_COLUMN];
  else if (layout !== K.PARTY_LAYOUT_SINGLE) boxes()[1].infoRects = sPartyBoxInfoRects[PARTY_BOX_LEFT_COLUMN];
}

function RenderPartyMenuBox(slot: number): void {
  if (partySpecies(slot) === K.SPECIES_NONE) {
    DrawEmptySlot(boxes()[slot].windowId);
    CopyWindowToVram(boxes()[slot].windowId, COPYWIN_GFX);
  } else {
    if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_CHOOSE_MULTIPLE_MONS) DisplayPartyPokemonDataForChooseMultiple(slot);
    else if (!DisplayPartyPokemonDataForMoveTutorOrEvolutionItem(slot)) DisplayPartyPokemonData(slot);
    if (gPartyMenu.slotId === slot) AnimatePartySlot(slot, 1);
    else AnimatePartySlot(slot, 0);
  }
  PutWindowTilemap(boxes()[slot].windowId);
  ScheduleBgCopyTilemapToVram(0);
}

function DisplayPartyPokemonData(slot: number): void {
  const b = boxes()[slot];
  if (P(slot).isEgg) {
    b.infoRects.blitFunc(b.windowId, 0, 0, 0, 0, true);
    DisplayPartyPokemonNickname(P(slot), b, DRAW_TEXT_ONLY);
  } else {
    b.infoRects.blitFunc(b.windowId, 0, 0, 0, 0, false);
    DisplayPartyPokemonNickname(P(slot), b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonLevelCheck(P(slot), b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonGenderNidoranCheck(P(slot), b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonHPCheck(P(slot), b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonMaxHPCheck(P(slot), b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonHPBarCheck(P(slot), b);
  }
}

function DisplayPartyPokemonDescriptionData(slot: number, stringId: number): void {
  const mon = P(slot);
  const b = boxes()[slot];
  b.infoRects.blitFunc(b.windowId, 0, 0, 0, 0, true);
  DisplayPartyPokemonNickname(mon, b, DRAW_TEXT_ONLY);
  if (!mon.isEgg) {
    DisplayPartyPokemonLevelCheck(mon, b, DRAW_TEXT_ONLY);
    DisplayPartyPokemonGenderNidoranCheck(mon, b, DRAW_TEXT_ONLY);
  }
  DisplayPartyPokemonDescriptionText(stringId, b, DRAW_TEXT_ONLY);
}

function DisplayPartyPokemonDataForChooseMultiple(slot: number): void {
  const mon = P(slot);
  const order = gSelectedOrderFromParty;
  if (!GetBattleEntryEligibility(mon)) {
    DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_NOT_ABLE);
  } else {
    const maxBattlers = gPartyMenu.chooseMonsBattleType === K.CHOOSE_MONS_FOR_UNION_ROOM_BATTLE ? 2 : 3;
    for (let i = 0; i < maxBattlers; ++i) {
      if (order[i] !== 0 && order[i] - 1 === slot) {
        DisplayPartyPokemonDescriptionData(slot, i + K.PARTYBOX_DESC_FIRST);
        return;
      }
    }
    DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_ABLE_3);
  }
}

/** TRUE if teaching a move or can't evolve with the item (i.e. description data is shown) */
function DisplayPartyPokemonDataForMoveTutorOrEvolutionItem(slot: number): boolean {
  const currentPokemon = P(slot);
  const item = SpecialVar.ItemId;
  if (gPartyMenu.action === K.PARTY_ACTION_MOVE_TUTOR) {
    SpecialVar.Result = 0;
    if (SpecialVar.x8005 >= K.TUTOR_MOVE_COUNT) return false;
    DisplayPartyPokemonDataToTeachMove(slot, 0, SpecialVar.x8005);
  } else {
    if (gPartyMenu.action !== K.PARTY_ACTION_USE_ITEM) return false;
    switch (CheckIfItemIsTMHMOrEvolutionStone(item)) {
      default:
        return false;
      case 1: // TM/HM
        DisplayPartyPokemonDataToTeachMove(slot, item, 0);
        break;
      case 2: // Evolution stone
        if (!currentPokemon.isEgg && GetEvolutionTargetSpecies(currentPokemon, K.EVO_MODE_ITEM_CHECK, item) !== K.SPECIES_NONE) return false;
        DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_NO_USE);
        break;
    }
  }
  return true;
}

function DisplayPartyPokemonDataToTeachMove(slot: number, item: number, tutor: number): void {
  switch (CanMonLearnTMTutor(P(slot), item, tutor)) {
    case CANNOT_LEARN_MOVE:
    case CANNOT_LEARN_MOVE_IS_EGG:
      DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_NOT_ABLE_2);
      break;
    case ALREADY_KNOWS_MOVE:
      DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_LEARNED);
      break;
    default:
      DisplayPartyPokemonDescriptionData(slot, K.PARTYBOX_DESC_ABLE_2);
      break;
  }
}

function RenderPartyMenuBoxes(): boolean {
  RenderPartyMenuBox(internal().data[0]);
  return ++internal().data[0] === K.PARTY_SIZE;
}

function GetPartyMenuBgTile(tileId: number): Uint8Array {
  return sPartyBgGfxTilemap!.subarray(tileId << 5, (tileId << 5) + 32);
}

function CreatePartyMonSprites(slot: number): void {
  if (partySpecies(slot) !== K.SPECIES_NONE) {
    CreatePartyMonIconSprite(P(slot), boxes()[slot], slot);
    CreatePartyMonHeldItemSprite(P(slot), boxes()[slot]);
    CreatePartyMonPokeballSprite(P(slot), boxes()[slot]);
    CreatePartyMonStatusSprite(P(slot), boxes()[slot]);
  }
}

function CreatePartyMonSpritesLoop(): boolean {
  CreatePartyMonSprites(internal().data[0]);
  return ++internal().data[0] === K.PARTY_SIZE;
}

function CreateCancelConfirmPokeballSprites(): void {
  if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_MULTI_SHOWCASE) {
    // The showcase has no Cancel/Confirm buttons
    FillBgTilemapBufferRect(1, 14, 23, 17, 7, 2, 1);
  } else {
    if (internal().chooseMultiple) {
      internal().spriteIdConfirmPokeball = CreateSmallPokeballButtonSprite(0xbf, 0x88);
      DrawCancelConfirmButtons();
      internal().spriteIdCancelPokeball = CreateSmallPokeballButtonSprite(0xbf, 0x98);
    } else {
      internal().spriteIdCancelPokeball = CreatePokeballButtonSprite(198, 148);
    }
    AnimatePartySlot(gPartyMenu.slotId, 1);
  }
}

export function AnimatePartySlot(slot: number, animNum: number): void {
  let spriteId: number;
  switch (slot) {
    default:
      if (partySpecies(slot) !== K.SPECIES_NONE) {
        LoadPartyBoxPalette(boxes()[slot], GetPartyBoxPaletteFlags(slot, animNum));
        AnimateSelectedPartyIcon(boxes()[slot].monSpriteId, animNum);
        PartyMenuStartSpriteAnim(boxes()[slot].pokeballSpriteId, animNum);
      }
      return;
    case SLOT_CONFIRM():
      SetBgTilemapPalette(1, 23, 16, 7, 2, animNum === 0 ? 1 : 2);
      spriteId = internal().spriteIdConfirmPokeball;
      break;
    case SLOT_CANCEL():
      // The position of the Cancel button changes if Confirm is present
      if (!internal().chooseMultiple) SetBgTilemapPalette(1, 23, 17, 7, 2, animNum === 0 ? 1 : 2);
      else SetBgTilemapPalette(1, 23, 18, 7, 2, animNum === 0 ? 1 : 2);
      spriteId = internal().spriteIdCancelPokeball;
      break;
  }
  PartyMenuStartSpriteAnim(spriteId, animNum);
  ScheduleBgCopyTilemapToVram(1);
}

function GetPartyBoxPaletteFlags(slot: number, animNum: number): number {
  let palFlags = 0;
  if (animNum === 1) palFlags |= PARTY_PAL_SELECTED;
  if (P(slot).hp === 0) palFlags |= PARTY_PAL_FAINTED;
  if (gPartyMenu.layout === K.PARTY_LAYOUT_MULTI && (slot === 1 || slot === 4 || slot === 5)) palFlags |= PARTY_PAL_MULTI_ALT;
  if (gPartyMenu.action === K.PARTY_ACTION_SWITCHING) palFlags |= PARTY_PAL_SWITCHING;
  if (gPartyMenu.action === K.PARTY_ACTION_SWITCH) {
    if (slot === gPartyMenu.slotId || slot === gPartyMenu.slotId2) palFlags |= PARTY_PAL_TO_SWITCH;
  }
  if (gPartyMenu.action === K.PARTY_ACTION_SOFTBOILED && slot === gPartyMenu.slotId) palFlags |= PARTY_PAL_TO_SOFTBOIL;
  return palFlags;
}

function DrawCancelConfirmButtons(): void {
  CopyToBgTilemapBufferRect_ChangePalette(1, gfx16('sConfirmButton_Tilemap'), 23, 16, 7, 2, 17);
  CopyToBgTilemapBufferRect_ChangePalette(1, gfx16('sCancelButton_Tilemap'), 23, 18, 7, 2, 17);
  ScheduleBgCopyTilemapToVram(1);
}

export function IsMultiBattle(): boolean {
  const f = g.battleTypeFlags;
  return !!(f & K.BATTLE_TYPE_MULTI && f & K.BATTLE_TYPE_DOUBLE && f & K.BATTLE_TYPE_TRAINER && f & K.BATTLE_TYPE_LINK);
}

/** SwapPartyPokemon(&gPlayerParty[a], &gPlayerParty[b]) */
function SwapPartyPokemon(a: number, b: number): void {
  const party = state.party;
  const buffer = party[a];
  party[a] = party[b];
  party[b] = buffer;
}

function Task_ClosePartyMenu(taskId: number): void {
  BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_ClosePartyMenuAndSetCB2;
}

function Task_ClosePartyMenuAndSetCB2(taskId: number): void {
  if (!gPaletteFade.active) {
    if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) UpdatePartyToFieldOrder();
    if (internal().exitCallback !== null) SetMainCallback2(internal().exitCallback);
    else SetMainCallback2(gPartyMenu.exitCallback);
    FreePartyPointers();
    DestroyTask(taskId);
  }
}

export function GetCursorSelectionMonId(): number {
  return gPartyMenu.slotId;
}

export function GetPartyMenuType(): number {
  return gPartyMenu.menuType;
}

export function Task_HandleChooseMonInput(taskId: number): void {
  if (!gPaletteFade.active && !MenuHelpers_ShouldWaitForLinkRecv()) {
    const slotPtr = GetCurrentPartySlotPtr();
    switch (PartyMenuButtonHandler(slotPtr)) {
      case A_BUTTON:
        HandleChooseMonSelection(taskId, slotPtr);
        break;
      case B_BUTTON: // also handles pressing A_BUTTON on Cancel
        HandleChooseMonCancel(taskId, slotPtr);
        break;
      case START_BUTTON:
        if (internal().chooseMultiple) {
          PlaySE(K.SE_SELECT);
          MoveCursorToConfirm();
        }
        break;
    }
  }
}

/** The s8 *slotPtr: gPartyMenu.slotId or slotId2. */
type SlotPtr = { get(): number; set(v: number): void };
const slotIdPtr: SlotPtr = { get: () => gPartyMenu.slotId, set: (v) => (gPartyMenu.slotId = v) };
const slotId2Ptr: SlotPtr = { get: () => gPartyMenu.slotId2, set: (v) => (gPartyMenu.slotId2 = v) };

function GetCurrentPartySlotPtr(): SlotPtr {
  if (gPartyMenu.action === K.PARTY_ACTION_SWITCH || gPartyMenu.action === K.PARTY_ACTION_SOFTBOILED) return slotId2Ptr;
  return slotIdPtr;
}

function HandleChooseMonSelection(taskId: number, slotPtr: SlotPtr): void {
  if (slotPtr.get() === SLOT_CONFIRM()) {
    gPartyMenu.task!(taskId); // task here is always Task_ValidateChosenMonsForBattle
    return;
  }
  switch (gPartyMenu.action) {
    case K.PARTY_ACTION_SOFTBOILED:
      if (IsSelectedMonNotEgg(slotPtr.get())) Task_TryUseSoftboiledOnPartyMon(taskId);
      break;
    case K.PARTY_ACTION_USE_ITEM:
      if (IsSelectedMonNotEgg(slotPtr.get())) {
        if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) internal().exitCallback = CB2_SetUpExitToBattleScreen;
        gItemUseCB!(taskId, Task_ClosePartyMenuAfterText);
      }
      break;
    case K.PARTY_ACTION_MOVE_TUTOR:
      if (IsSelectedMonNotEgg(slotPtr.get())) {
        PlaySE(K.SE_SELECT);
        TryTutorSelectedMon(taskId);
      }
      break;
    case K.PARTY_ACTION_GIVE_MAILBOX_MAIL:
      if (IsSelectedMonNotEgg(slotPtr.get())) {
        PlaySE(K.SE_SELECT);
        TryGiveMailToSelectedMon(taskId);
      }
      break;
    case K.PARTY_ACTION_GIVE_ITEM:
    case K.PARTY_ACTION_GIVE_PC_ITEM:
      if (IsSelectedMonNotEgg(slotPtr.get())) {
        PlaySE(K.SE_SELECT);
        TryGiveItemOrMailToSelectedMon(taskId);
      }
      break;
    case K.PARTY_ACTION_SWITCH:
      PlaySE(K.SE_SELECT);
      SwitchSelectedMons(taskId);
      break;
    case K.PARTY_ACTION_CHOOSE_AND_CLOSE:
      PlaySE(K.SE_SELECT);
      SpecialVar.x8004 = slotPtr.get();
      if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_MOVE_RELEARNER) SpecialVar.x8005 = GetNumberOfRelearnableMoves(P(slotPtr.get()));
      Task_ClosePartyMenu(taskId);
      break;
    case K.PARTY_ACTION_MINIGAME:
      console.warn('[party_menu] minigames are not implemented');
      break;
    default:
      PlaySE(K.SE_SELECT);
      Task_TryCreateSelectionWindow(taskId);
      break;
  }
}

function IsSelectedMonNotEgg(slot: number): boolean {
  if (P(slot).isEgg) {
    PlaySE(K.SE_FAILURE);
    return false;
  }
  return true;
}

function HandleChooseMonCancel(taskId: number, slotPtr: SlotPtr): void {
  switch (gPartyMenu.action) {
    case K.PARTY_ACTION_SEND_OUT:
      PlaySE(K.SE_FAILURE);
      break;
    case K.PARTY_ACTION_SWITCH:
    case K.PARTY_ACTION_SOFTBOILED:
      PlaySE(K.SE_SELECT);
      FinishTwoMonAction(taskId);
      break;
    case K.PARTY_ACTION_MINIGAME:
      PlaySE(K.SE_SELECT);
      console.warn('[party_menu] minigames are not implemented');
      break;
    default:
      PlaySE(K.SE_SELECT);
      if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_CHOOSE_MULTIPLE_MONS) {
        DisplayCancelChooseMonYesNo(taskId);
      } else {
        if (!MenuHelpers_IsLinkActive()) SpecialVar.x8004 = SLOT_CANCEL();
        gPartyMenuUseExitCallback = false;
        slotPtr.set(SLOT_CANCEL());
        Task_ClosePartyMenu(taskId);
      }
      break;
  }
}

function DisplayCancelChooseMonYesNo(taskId: number): void {
  PartyMenuRemoveWindow(1);
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_CancelBattle')), true);
  gTasks[taskId].func = Task_CancelChooseMonYesNo;
}

function Task_CancelChooseMonYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleCancelChooseMonYesNoInput;
  }
}

function Task_HandleCancelChooseMonYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0:
      gPartyMenuUseExitCallback = false;
      gPartyMenu.slotId = SLOT_CANCEL();
      ClearSelectedPartyOrder();
      Task_ClosePartyMenu(taskId);
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1:
      Task_ReturnToChooseMonAfterText(taskId);
      break;
  }
}

function PartyMenuButtonHandler(slotPtr: SlotPtr): number {
  let movementDir: number;
  switch (gMain.newAndRepeatedKeys) {
    case DPAD_UP:
      movementDir = MENU_DIR_UP;
      break;
    case DPAD_DOWN:
      movementDir = MENU_DIR_DOWN;
      break;
    case DPAD_LEFT:
      movementDir = MENU_DIR_LEFT;
      break;
    case DPAD_RIGHT:
      movementDir = MENU_DIR_RIGHT;
      break;
    default:
      switch (GetLRKeysPressedAndHeld()) {
        case MENU_L_PRESSED:
          movementDir = MENU_DIR_UP;
          break;
        case MENU_R_PRESSED:
          movementDir = MENU_DIR_DOWN;
          break;
        default:
          movementDir = 0;
          break;
      }
      break;
  }
  if (JOY_NEW(START_BUTTON)) return START_BUTTON;
  if (movementDir) {
    UpdateCurrentPartySelection(slotPtr, movementDir);
    return 0;
  }
  if (JOY_NEW(A_BUTTON) && slotPtr.get() === SLOT_CANCEL()) return B_BUTTON;
  return JOY_NEW(A_BUTTON | B_BUTTON);
}

function UpdateCurrentPartySelection(slotPtr: SlotPtr, movementDir: number): void {
  const newSlotId = slotPtr.get();
  if (gPartyMenu.layout === K.PARTY_LAYOUT_SINGLE) UpdatePartySelectionSingleLayout(slotPtr, movementDir);
  else UpdatePartySelectionDoubleLayout(slotPtr, movementDir);
  if (slotPtr.get() !== newSlotId) {
    PlaySE(K.SE_SELECT);
    AnimatePartySlot(newSlotId, 0);
    AnimatePartySlot(slotPtr.get(), 1);
  }
}

function UpdatePartySelectionSingleLayout(slotPtr: SlotPtr, movementDir: number): void {
  const count = CalculatePlayerPartyCount();
  const slot = slotPtr.get();
  switch (movementDir) {
    case MENU_DIR_UP:
      if (slot === 0) slotPtr.set(SLOT_CANCEL());
      else if (slot === SLOT_CONFIRM()) slotPtr.set(count - 1);
      else if (slot === SLOT_CANCEL()) slotPtr.set(internal().chooseMultiple ? SLOT_CONFIRM() : count - 1);
      else slotPtr.set(slot - 1);
      break;
    case MENU_DIR_DOWN:
      if (slot === SLOT_CANCEL()) slotPtr.set(0);
      else if (slot === count - 1) slotPtr.set(internal().chooseMultiple ? SLOT_CONFIRM() : SLOT_CANCEL());
      else slotPtr.set(slot + 1);
      break;
    case MENU_DIR_RIGHT:
      if (count !== 1 && slot === 0) slotPtr.set(internal().lastSelectedSlot === 0 ? 1 : internal().lastSelectedSlot);
      break;
    case MENU_DIR_LEFT:
      if (slot !== 0 && slot !== SLOT_CONFIRM() && slot !== SLOT_CANCEL()) {
        internal().lastSelectedSlot = slot;
        slotPtr.set(0);
      }
      break;
  }
}

function UpdatePartySelectionDoubleLayout(slotPtr: SlotPtr, movementDir: number): void {
  // newSlot is used temporarily as a movement direction during its later assignment
  let newSlot = movementDir;
  const count = CalculatePlayerPartyCount();
  switch (movementDir) {
    case MENU_DIR_UP:
      if (slotPtr.get() === 0) {
        slotPtr.set(SLOT_CANCEL());
        break;
      } else if (slotPtr.get() === SLOT_CONFIRM()) {
        slotPtr.set(count - 1);
        break;
      } else if (slotPtr.get() === SLOT_CANCEL()) {
        if (internal().chooseMultiple) {
          slotPtr.set(SLOT_CONFIRM());
          break;
        }
        slotPtr.set(slotPtr.get() - 1);
      }
      newSlot = GetNewSlotDoubleLayout(slotPtr.get(), newSlot);
      if (newSlot !== -1) slotPtr.set(newSlot);
      break;
    case MENU_DIR_DOWN:
      if (slotPtr.get() === SLOT_CONFIRM()) {
        slotPtr.set(SLOT_CANCEL());
      } else if (slotPtr.get() === SLOT_CANCEL()) {
        slotPtr.set(0);
      } else {
        newSlot = GetNewSlotDoubleLayout(slotPtr.get(), MENU_DIR_DOWN);
        if (newSlot === -1) slotPtr.set(internal().chooseMultiple ? SLOT_CONFIRM() : SLOT_CANCEL());
        else slotPtr.set(newSlot);
      }
      break;
    case MENU_DIR_RIGHT:
      if (slotPtr.get() === 0) {
        if (internal().lastSelectedSlot === 3) {
          if (partySpecies(3) !== K.SPECIES_NONE) slotPtr.set(3);
        } else if (partySpecies(2) !== K.SPECIES_NONE) {
          slotPtr.set(2);
        }
      } else if (slotPtr.get() === 1) {
        if (internal().lastSelectedSlot === 5) {
          if (partySpecies(5) !== K.SPECIES_NONE) slotPtr.set(5);
        } else if (partySpecies(4) !== K.SPECIES_NONE) {
          slotPtr.set(4);
        }
      }
      break;
    case MENU_DIR_LEFT:
      if (slotPtr.get() === 2 || slotPtr.get() === 3) {
        internal().lastSelectedSlot = slotPtr.get();
        slotPtr.set(0);
      } else if (slotPtr.get() === 4 || slotPtr.get() === 5) {
        internal().lastSelectedSlot = slotPtr.get();
        slotPtr.set(1);
      }
      break;
  }
}

function GetNewSlotDoubleLayout(slotId: number, movementDir: number): number {
  for (;;) {
    slotId += movementDir;
    if ((slotId & 0xff) >= SLOT_CONFIRM()) return -1;
    if (partySpecies(slotId) !== K.SPECIES_NONE) return slotId;
  }
}

const tKeepOpen = 0;

export function DisplayPartyMenuMessage(str: number[], keepOpen: boolean): number {
  PartyMenuPrintText(str);
  const taskId = CreateTask(Task_PrintAndWaitForText, 1);
  gTasks[taskId].data[tKeepOpen] = keepOpen ? 1 : 0;
  return taskId;
}

function Task_PrintAndWaitForText(taskId: number): void {
  if (RunTextPrinters_CheckActive(6) !== true) {
    if (gTasks[taskId].data[tKeepOpen] === 0) {
      ClearStdWindowAndFrameToTransparent(6, false);
      ClearWindowTilemap(6);
    }
    DestroyTask(taskId);
  }
}

export function IsPartyMenuTextPrinterActive(): boolean {
  return FuncIsActiveTask(Task_PrintAndWaitForText);
}

function Task_ReturnToChooseMonAfterText(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    ClearStdWindowAndFrameToTransparent(6, false);
    ClearWindowTilemap(6);
    DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
  }
}

function DisplayGaveHeldItemMessage(mon: Pokemon, item: number, keepOpen: boolean): void {
  // ItemUse_SetQuestLogEvent: no quest log
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(CopyItemName(item));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnWasGivenItem')), keepOpen);
  ScheduleBgCopyTilemapToVram(2);
}

function DisplayTookHeldItemMessage(mon: Pokemon, item: number, keepOpen: boolean): void {
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(CopyItemName(item));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_ReceivedItemFromPkmn')), keepOpen);
  ScheduleBgCopyTilemapToVram(2);
}

function DisplayAlreadyHoldingItemSwitchMessage(mon: Pokemon, item: number, keepOpen: boolean): void {
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(CopyItemName(item));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnAlreadyHoldingItemSwitch')), keepOpen);
  ScheduleBgCopyTilemapToVram(2);
}

function DisplaySwitchedHeldItemMessage(item: number, item2: number, keepOpen: boolean): void {
  gStringVar1.set(CopyItemName(item));
  gStringVar2.set(CopyItemName(item2));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_SwitchedPkmnItem')), keepOpen);
  ScheduleBgCopyTilemapToVram(2);
}

function GiveItemToMon(mon: Pokemon, item: number): void {
  if (ItemIsMail(item)) {
    if (GiveMailToMon(state, mon, item) === 0xff) return;
  }
  mon.heldItem = item;
}

/** TryTakeMonItem: 0 = not holding, 1 = no room, 2 = took it */
function TryTakeMonItem(mon: Pokemon): number {
  const item = mon.heldItem;
  if (item === K.ITEM_NONE) return 0;
  if (AddBagItem(item, 1) === false) return 1;
  mon.heldItem = K.ITEM_NONE;
  return 2;
}

function BufferBagFullCantTakeItemMessage(itemId: number): void {
  let string: number[];
  switch (ItemId_GetPocket(itemId)) {
    default:
      string = text('gText_MenuBag');
      break;
    case K.POCKET_TM_CASE:
      string = ItemId_GetName(K.ITEM_TM_CASE);
      break;
    case K.POCKET_BERRY_POUCH:
      string = ItemId_GetName(K.ITEM_BERRY_POUCH);
      break;
  }
  gStringVar1.set(string);
  ExpandToStringVar4(text('gText_BagFullCouldNotRemoveItem'));
}

// Task data for PartyMenuModifyHP
const tHP = 0;
const tMaxHP = 1;
const tHPIncrement = 2;
const tHPToAdd = 3;
const tPartyId = 4;
const tStartHP = 5;

function Task_PartyMenuModifyHP(taskId: number): void {
  const data = gTasks[taskId].data;
  data[tHP] += data[tHPIncrement];
  --data[tHPToAdd];
  P(data[tPartyId]).hp = data[tHP];
  DisplayPartyPokemonHPCheck(P(data[tPartyId]), boxes()[data[tPartyId]], DRAW_MENU_BOX_AND_TEXT);
  DisplayPartyPokemonHPBarCheck(P(data[tPartyId]), boxes()[data[tPartyId]]);
  if (data[tHPToAdd] === 0 || data[tHP] === 0 || data[tHP] === data[tMaxHP]) {
    // If HP was recovered, buffer the amount recovered
    if (data[tHP] > data[tStartHP]) gStringVar2.set(ConvertIntToDecimalStringN(data[tHP] - data[tStartHP], STR_CONV_MODE_LEFT_ALIGN, 3));
    SwitchTaskToFollowupFunc(taskId);
  }
}

export function PartyMenuModifyHP(taskId: number, slot: number, hpIncrement: number, hpDifference: number, task: TaskFunc): void {
  const mon = P(slot);
  const data = gTasks[taskId].data;
  data[tHP] = mon.hp;
  data[tMaxHP] = mon.maxHP;
  data[tHPIncrement] = hpIncrement;
  data[tHPToAdd] = hpDifference;
  data[tPartyId] = slot;
  data[tStartHP] = data[tHP];
  SetTaskFuncWithFollowupFunc(taskId, Task_PartyMenuModifyHP, task);
}

/** ResetHPTaskData(taskId, 0, hp): caseId is always 0 */
function ResetHPTaskData(taskId: number, hp: number): void {
  const data = gTasks[taskId].data;
  data[tHP] = hp;
  data[tStartHP] = hp;
}

export function GetAilmentFromStatus(status: number): number {
  if (status & K.STATUS1_PSN_ANY) return K.AILMENT_PSN;
  if (status & K.STATUS1_PARALYSIS) return K.AILMENT_PRZ;
  if (status & K.STATUS1_SLEEP) return K.AILMENT_SLP;
  if (status & K.STATUS1_FREEZE) return K.AILMENT_FRZ;
  if (status & K.STATUS1_BURN) return K.AILMENT_BRN;
  return K.AILMENT_NONE;
}

export function GetMonAilment(mon: Pokemon): number {
  if (mon.hp === 0) return K.AILMENT_FNT;
  const ailment = GetAilmentFromStatus(mon.status >>> 0);
  if (ailment !== K.AILMENT_NONE) return ailment;
  if (CheckPartyPokerus(mon)) return K.AILMENT_PKRS;
  return K.AILMENT_NONE;
}

function CanMonLearnTMTutor(mon: Pokemon, item: number, tutor: number): number {
  let move: number;
  if (mon.isEgg) return CANNOT_LEARN_MOVE_IS_EGG;
  if (item >= K.ITEM_TM01_FOCUS_PUNCH) {
    if (!CanMonLearnTMHM(mon, item - K.ITEM_TM01_FOCUS_PUNCH)) return CANNOT_LEARN_MOVE;
    move = ItemIdToBattleMoveId(item);
  } else if (!CanLearnTutorMove(mon.species, tutor)) {
    return CANNOT_LEARN_MOVE;
  } else {
    move = GetTutorMove(tutor);
  }
  return MonKnowsMove(mon, move) ? ALREADY_KNOWS_MOVE : CAN_LEARN_MOVE;
}

function GetTutorMove(tutor: number): number {
  switch (tutor) {
    case K.TUTOR_MOVE_FRENZY_PLANT:
      return K.MOVE_FRENZY_PLANT;
    case K.TUTOR_MOVE_BLAST_BURN:
      return K.MOVE_BLAST_BURN;
    case K.TUTOR_MOVE_HYDRO_CANNON:
      return K.MOVE_HYDRO_CANNON;
    default:
      return menusData.tutorMoves[tutor];
  }
}

function CanLearnTutorMove(species: number, tutor: number): boolean {
  switch (tutor) {
    case K.TUTOR_MOVE_FRENZY_PLANT:
      return species === K.SPECIES_VENUSAUR;
    case K.TUTOR_MOVE_BLAST_BURN:
      return species === K.SPECIES_CHARIZARD;
    case K.TUTOR_MOVE_HYDRO_CANNON:
      return species === K.SPECIES_BLASTOISE;
    default:
      return ((menusData.tutorLearnsets[species] ?? 0) & (1 << tutor)) !== 0;
  }
}

// ------------------------------------------------------------------ Oak's first battle narration

function Task_FirstBattleEnterParty_WaitFadeIn(taskId: number): void {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_FirstBattleEnterParty_DarkenScreen;
}

function Task_FirstBattleEnterParty_DarkenScreen(taskId: number): void {
  BeginNormalPaletteFade(0xffff1fff, 4, 0, 6, RGB_BLACK);
  gTasks[taskId].func = Task_FirstBattleEnterParty_WaitDarken;
}

function Task_FirstBattleEnterParty_WaitDarken(taskId: number): void {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_FirstBattleEnterParty_CreatePrinter;
}

function Task_FirstBattleEnterParty_CreatePrinter(taskId: number): void {
  gTasks[taskId].data[0] = FirstBattleEnterParty_CreateWindowAndMsg1Printer();
  gTasks[taskId].func = Task_FirstBattleEnterParty_RunPrinterMsg1;
}

function Task_FirstBattleEnterParty_RunPrinterMsg1(taskId: number): void {
  if (RunTextPrinters_CheckActive(gTasks[taskId].data[0] & 0xff) !== true) gTasks[taskId].func = Task_FirstBattleEnterParty_LightenFirstMonIcon;
}

function Task_FirstBattleEnterParty_LightenFirstMonIcon(taskId: number): void {
  BeginNormalPaletteFade(0xffff0008, 4, 6, 0, RGB_BLACK);
  gTasks[taskId].func = Task_FirstBattleEnterParty_WaitLightenFirstMonIcon;
}

function Task_FirstBattleEnterParty_WaitLightenFirstMonIcon(taskId: number): void {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_FirstBattleEnterParty_StartPrintMsg2;
}

function Task_FirstBattleEnterParty_StartPrintMsg2(taskId: number): void {
  PartyMenu_Oak_PrintText(gTasks[taskId].data[0], text('gText_OakThisIsListOfPokemon'));
  gTasks[taskId].func = Task_FirstBattleEnterParty_RunPrinterMsg2;
}

function Task_FirstBattleEnterParty_RunPrinterMsg2(taskId: number): void {
  const data = gTasks[taskId].data;
  if (RunTextPrinters_CheckActive(data[0] & 0xff) !== true) {
    FirstBattleEnterParty_DestroyVoiceoverWindow(data[0] & 0xff);
    gTasks[taskId].func = Task_FirstBattleEnterParty_FadeNormal;
  }
}

function Task_FirstBattleEnterParty_FadeNormal(taskId: number): void {
  BeginNormalPaletteFade(0x0000fff7, 4, 6, 0, RGB_BLACK);
  gTasks[taskId].func = Task_FirstBattleEnterParty_WaitFadeNormal;
}

function Task_FirstBattleEnterParty_WaitFadeNormal(taskId: number): void {
  if (!gPaletteFade.active) {
    LoadUserWindowGfx(0, 0x4f, BG_PLTT_ID(13));
    LoadStdWindowGfx(0, 0x58, BG_PLTT_ID(15));
    if (gPartyMenu.action === K.PARTY_ACTION_USE_ITEM) DisplayPartyMenuStdMessage(K.PARTY_MSG_USE_ON_WHICH_MON);
    else DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
  }
}

function InitPartyMenuWindows(layout: number): void {
  switch (layout) {
    case K.PARTY_LAYOUT_SINGLE:
      InitWindows(sSinglePartyMenuWindowTemplate);
      break;
    case K.PARTY_LAYOUT_DOUBLE:
      InitWindows(sDoublePartyMenuWindowTemplate);
      break;
    case K.PARTY_LAYOUT_MULTI:
      InitWindows(sMultiPartyMenuWindowTemplate);
      break;
    default: // PARTY_LAYOUT_MULTI_SHOWCASE
      InitWindows(sShowcaseMultiPartyMenuWindowTemplate);
      break;
  }
  DeactivateAllTextPrinters();
  for (let i = 0; i < K.PARTY_SIZE; ++i) FillWindowPixelBuffer(i, PIXEL_FILL(0));
  LoadUserWindowGfx(0, 0x4f, BG_PLTT_ID(13));
  LoadStdWindowGfx(0, 0x58, BG_PLTT_ID(15));
  LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(12), 32);
  LoadPalette(GetTextWindowPalette(0), BG_PLTT_ID(14), 32);
}

function CreateCancelConfirmWindows(chooseMultiple: boolean): void {
  if (gPartyMenu.menuType !== K.PARTY_MENU_TYPE_MULTI_SHOWCASE) {
    let cancelWindowId: number;
    let offset: number;
    if (chooseMultiple) {
      const confirmWindowId = AddWindow(sConfirmButtonWindowTemplate);
      FillWindowPixelBuffer(confirmWindowId, PIXEL_FILL(0));
      const ok = text('gText_PartyMenu_OK');
      AddTextPrinterParameterized4(confirmWindowId, K.FONT_SMALL, (48 - GetStringWidth(K.FONT_SMALL, ok, 0)) >>> 1, 1, 0, 0, sFontColorTable()[0], -1, ok);
      PutWindowTilemap(confirmWindowId);
      CopyWindowToVram(confirmWindowId, COPYWIN_GFX);
      cancelWindowId = AddWindow(sMultiCancelButtonWindowTemplate);
      offset = 0;
    } else {
      cancelWindowId = AddWindow(sCancelButtonWindowTemplate);
      offset = 3;
    }
    FillWindowPixelBuffer(cancelWindowId, PIXEL_FILL(0));
    const cancel = text('gFameCheckerText_Cancel');
    offset += Math.trunc((48 - GetStringWidth(K.FONT_SMALL, cancel, 0)) / 2);
    AddTextPrinterParameterized3(cancelWindowId, K.FONT_SMALL, offset, 1, sFontColorTable()[0], -1, cancel);
    PutWindowTilemap(cancelWindowId);
    CopyWindowToVram(cancelWindowId, COPYWIN_GFX);
    ScheduleBgCopyTilemapToVram(0);
  }
}

/** GetPartyMenuPalBufferPtr(paletteId): the one colour at palBuffer[paletteId] */
function palColor(paletteId: number): Uint16Array {
  return internal().palBuffer.subarray(paletteId, paletteId + 1);
}

function BlitBitmapToPartyWindow(windowId: number, tileNums: Uint8Array, menuBoxWidth: number, x: number, y: number, width: number, height: number): void {
  const pixels = new Uint8Array(height * width * 32);
  for (let i = 0; i < height; ++i) {
    for (let j = 0; j < width; ++j) pixels.set(GetPartyMenuBgTile(tileNums[x + j + (y + i) * menuBoxWidth]), (i * width + j) * 32);
  }
  BlitBitmapToWindow(windowId, pixels, x * 8, y * 8, width * 8, height * 8);
}

function BlitBitmapToPartyWindow_LeftColumn(windowId: number, x: number, y: number, width: number, height: number, hideHP: boolean): void {
  if (width === 0 && height === 0) {
    width = 10;
    height = 7;
  }
  BlitBitmapToPartyWindow(windowId, gfx(hideHP ? 'sSlotTilemap_MainNoHP' : 'sSlotTilemap_Main'), 10, x, y, width, height);
}

function BlitBitmapToPartyWindow_RightColumn(windowId: number, x: number, y: number, width: number, height: number, hideHP: boolean): void {
  if (width === 0 && height === 0) {
    width = 18;
    height = 3;
  }
  BlitBitmapToPartyWindow(windowId, gfx(hideHP ? 'sSlotTilemap_WideNoHP' : 'sSlotTilemap_Wide'), 18, x, y, width, height);
}

function DrawEmptySlot(windowId: number): void {
  BlitBitmapToPartyWindow(windowId, gfx('sSlotTilemap_WideEmpty'), 18, 0, 0, 18, 3);
}

function LOAD_PARTY_BOX_PAL(paletteIds: number[], paletteOffsets: number[], palOffset: number): void {
  for (let i = 0; i < 3; i++) LoadPalette(palColor(paletteIds[i]), paletteOffsets[i] + palOffset, 2);
}

function LoadPartyBoxPalette(menuBox: PartyMenuBox, palFlags: number): void {
  const palOffset = BG_PLTT_ID(GetWindowAttribute(menuBox.windowId, 'paletteNum'));
  const load = (ids1: number[], ids2: number[]) => {
    LOAD_PARTY_BOX_PAL(ids1, sPartyBoxPalOffsets1, palOffset);
    LOAD_PARTY_BOX_PAL(ids2, sPartyBoxPalOffsets2, palOffset);
  };
  if (palFlags & PARTY_PAL_TO_SOFTBOIL) {
    if (palFlags & PARTY_PAL_SELECTED) load(sPartyBoxSelectedForActionPalIds1, sPartyBoxCurrSelectionPalIds2);
    else load(sPartyBoxSelectedForActionPalIds1, sPartyBoxSelectedForActionPalIds2);
  } else if (palFlags & PARTY_PAL_SWITCHING) {
    load(sPartyBoxSelectedForActionPalIds1, sPartyBoxSelectedForActionPalIds2);
  } else if (palFlags & PARTY_PAL_TO_SWITCH) {
    if (palFlags & PARTY_PAL_SELECTED) load(sPartyBoxSelectedForActionPalIds1, sPartyBoxCurrSelectionPalIds2);
    else load(sPartyBoxSelectedForActionPalIds1, sPartyBoxSelectedForActionPalIds2);
  } else if (palFlags & PARTY_PAL_FAINTED) {
    if (palFlags & PARTY_PAL_SELECTED) load(sPartyBoxCurrSelectionFaintedPalIds, sPartyBoxCurrSelectionPalIds2);
    else load(sPartyBoxFaintedPalIds1, sPartyBoxFaintedPalIds2);
  } else if (palFlags & PARTY_PAL_MULTI_ALT) {
    if (palFlags & PARTY_PAL_SELECTED) load(sPartyBoxCurrSelectionMultiPalIds, sPartyBoxCurrSelectionPalIds2);
    else load(sPartyBoxMultiPalIds1, sPartyBoxMultiPalIds2);
  } else if (palFlags & PARTY_PAL_SELECTED) {
    load(sPartyBoxCurrSelectionPalIds1, sPartyBoxCurrSelectionPalIds2);
  } else {
    load(sPartyBoxEmptySlotPalIds1, sPartyBoxEmptySlotPalIds2);
  }
}

function DisplayPartyPokemonBarDetail(windowId: number, str: number[], color: number, dimensions: number[]): void {
  AddTextPrinterParameterized3(windowId, K.FONT_SMALL, dimensions[0], dimensions[1], sFontColorTable()[color], 0, str);
}

function DisplayPartyPokemonNickname(mon: Pokemon, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  if (mon.species !== K.SPECIES_NONE) {
    const d = menuBox.infoRects.dimensions;
    if (drawMenuBoxOrText === DRAW_MENU_BOX_AND_TEXT) menuBox.infoRects.blitFunc(menuBox.windowId, d[0] >> 3, d[1] >> 3, d[2] >> 3, d[3] >> 3, false);
    DisplayPartyPokemonBarDetail(menuBox.windowId, GetMonNickname(mon), 0, d);
  }
}

function DisplayPartyPokemonLevelCheck(mon: Pokemon, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  if (mon.species !== K.SPECIES_NONE) {
    const ailment = GetMonAilment(mon);
    if (ailment === K.AILMENT_NONE || ailment === K.AILMENT_PKRS) {
      const d = menuBox.infoRects.dimensions;
      if (drawMenuBoxOrText !== DRAW_TEXT_ONLY) menuBox.infoRects.blitFunc(menuBox.windowId, d[4] >> 3, (d[5] >> 3) + 1, d[6] >> 3, d[7] >> 3, false);
      if (drawMenuBoxOrText !== DRAW_MENU_BOX_ONLY) DisplayPartyPokemonLevel(mon.level, menuBox);
    }
  }
}

function DisplayPartyPokemonLevel(level: number, menuBox: PartyMenuBox): void {
  gStringVar2.set(ConvertIntToDecimalStringN(level, STR_CONV_MODE_LEFT_ALIGN, 3));
  gStringVar1.set(concat(text('gText_Lv'), gStringVar2.get()));
  DisplayPartyPokemonBarDetail(menuBox.windowId, [...gStringVar1.get(), 0xff], 0, menuBox.infoRects.dimensions.slice(4));
}

function DisplayPartyPokemonGenderNidoranCheck(mon: Pokemon, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  const d = menuBox.infoRects.dimensions;
  if (drawMenuBoxOrText === DRAW_MENU_BOX_AND_TEXT) menuBox.infoRects.blitFunc(menuBox.windowId, d[8] >> 3, (d[9] >> 3) + 1, d[10] >> 3, d[11] >> 3, false);
  DisplayPartyPokemonGender(pokemon.gender(mon), mon.species, GetMonNickname(mon), menuBox);
}

function DisplayPartyPokemonGender(gender: number, species: number, nickname: number[], menuBox: PartyMenuBox): void {
  const palOffset = BG_PLTT_ID(GetWindowAttribute(menuBox.windowId, 'paletteNum'));
  if (species === K.SPECIES_NONE) return;
  if ((species === K.SPECIES_NIDORAN_M || species === K.SPECIES_NIDORAN_F) && stringsEqual(nickname, speciesName(species))) return;
  switch (gender) {
    case K.MON_MALE:
      LoadPalette(palColor(sGenderMalePalIds[0]), sGenderPalOffsets[0] + palOffset, 2);
      LoadPalette(palColor(sGenderMalePalIds[1]), sGenderPalOffsets[1] + palOffset, 2);
      DisplayPartyPokemonBarDetail(menuBox.windowId, text('gText_MaleSymbol'), 2, menuBox.infoRects.dimensions.slice(8));
      break;
    case K.MON_FEMALE:
      LoadPalette(palColor(sGenderFemalePalIds[0]), sGenderPalOffsets[0] + palOffset, 2);
      LoadPalette(palColor(sGenderFemalePalIds[1]), sGenderPalOffsets[1] + palOffset, 2);
      DisplayPartyPokemonBarDetail(menuBox.windowId, text('gText_FemaleSymbol'), 2, menuBox.infoRects.dimensions.slice(8));
      break;
  }
}

function DisplayPartyPokemonHPCheck(mon: Pokemon, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  if (mon.species !== K.SPECIES_NONE) {
    const d = menuBox.infoRects.dimensions;
    if (drawMenuBoxOrText !== DRAW_TEXT_ONLY) menuBox.infoRects.blitFunc(menuBox.windowId, d[12] >> 3, (d[13] >> 3) + 1, d[14] >> 3, d[15] >> 3, false);
    if (drawMenuBoxOrText !== DRAW_MENU_BOX_ONLY) DisplayPartyPokemonHP(mon.hp, menuBox);
  }
}

function DisplayPartyPokemonHP(hp: number, menuBox: PartyMenuBox): void {
  // strOut[0] = CHAR_SLASH; strOut[1] = EOS -- the slash right after the digits
  const str = [...ConvertIntToDecimalStringN(hp, STR_CONV_MODE_RIGHT_ALIGN, 3).slice(0, -1), K.CHAR_SLASH, 0xff];
  gStringVar1.set(str);
  DisplayPartyPokemonBarDetail(menuBox.windowId, str, 0, menuBox.infoRects.dimensions.slice(12));
}

function DisplayPartyPokemonMaxHPCheck(mon: Pokemon, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  if (mon.species !== K.SPECIES_NONE) {
    const d = menuBox.infoRects.dimensions;
    if (drawMenuBoxOrText !== DRAW_TEXT_ONLY) menuBox.infoRects.blitFunc(menuBox.windowId, (d[16] >> 3) + 1, (d[17] >> 3) + 1, d[18] >> 3, d[19] >> 3, false);
    if (drawMenuBoxOrText !== DRAW_MENU_BOX_ONLY) DisplayPartyPokemonMaxHP(mon.maxHP, menuBox);
  }
}

function DisplayPartyPokemonMaxHP(maxhp: number, menuBox: PartyMenuBox): void {
  gStringVar2.set(ConvertIntToDecimalStringN(maxhp, STR_CONV_MODE_RIGHT_ALIGN, 3));
  gStringVar1.set(concat(text('gText_Slash'), gStringVar2.get()));
  DisplayPartyPokemonBarDetail(menuBox.windowId, [...gStringVar1.get(), 0xff], 0, menuBox.infoRects.dimensions.slice(16));
}

function DisplayPartyPokemonHPBarCheck(mon: Pokemon, menuBox: PartyMenuBox): void {
  if (mon.species !== K.SPECIES_NONE) DisplayPartyPokemonHPBar(mon.hp, mon.maxHP, menuBox);
}

function DisplayPartyPokemonHPBar(hp: number, maxhp: number, menuBox: PartyMenuBox): void {
  const palOffset = BG_PLTT_ID(GetWindowAttribute(menuBox.windowId, 'paletteNum'));
  const d = menuBox.infoRects.dimensions;
  switch (GetHPBarLevel(hp, maxhp)) {
    case K.HP_BAR_GREEN:
    case K.HP_BAR_FULL:
      LoadPalette(palColor(sHPBarGreenPalIds[0]), sHPBarPalOffsets[0] + palOffset, 2);
      LoadPalette(palColor(sHPBarGreenPalIds[1]), sHPBarPalOffsets[1] + palOffset, 2);
      break;
    case K.HP_BAR_YELLOW:
      LoadPalette(palColor(sHPBarYellowPalIds[0]), sHPBarPalOffsets[0] + palOffset, 2);
      LoadPalette(palColor(sHPBarYellowPalIds[1]), sHPBarPalOffsets[1] + palOffset, 2);
      break;
    default:
      LoadPalette(palColor(sHPBarRedPalIds[0]), sHPBarPalOffsets[0] + palOffset, 2);
      LoadPalette(palColor(sHPBarRedPalIds[1]), sHPBarPalOffsets[1] + palOffset, 2);
      break;
  }
  const hpFraction = GetScaledHPFraction(hp, maxhp, d[22]);
  FillWindowPixelRect(menuBox.windowId, sHPBarPalOffsets[1], d[20], d[21], hpFraction, 1);
  FillWindowPixelRect(menuBox.windowId, sHPBarPalOffsets[0], d[20], d[21] + 1, hpFraction, 2);
  if (hpFraction !== d[22]) {
    // This appears to be an alternating fill
    FillWindowPixelRect(menuBox.windowId, 0x0d, d[20] + hpFraction, d[21], d[22] - hpFraction, 1);
    FillWindowPixelRect(menuBox.windowId, 0x02, d[20] + hpFraction, d[21] + 1, d[22] - hpFraction, 2);
  }
  CopyWindowToVram(menuBox.windowId, COPYWIN_GFX);
}

function DisplayPartyPokemonDescriptionText(stringId: number, menuBox: PartyMenuBox, drawMenuBoxOrText: number): void {
  const r = menuBox.infoRects;
  if (drawMenuBoxOrText !== DRAW_TEXT_ONLY) r.blitFunc(menuBox.windowId, r.descTextLeft >> 3, r.descTextTop >> 3, r.descTextWidth >> 3, r.descTextHeight >> 3, true);
  if (drawMenuBoxOrText !== DRAW_MENU_BOX_ONLY) AddTextPrinterParameterized3(menuBox.windowId, K.FONT_NORMAL_COPY_1, r.descTextLeft, r.descTextTop, sFontColorTable()[0], 0, sDescriptionStringTable(stringId));
}

/** PartyMenuRemoveWindow(&sPartyMenuInternal->windowId[which]) */
function PartyMenuRemoveWindow(which: number): void {
  const w = internal().windowId;
  if (w[which] !== K.WINDOW_NONE) {
    ClearStdWindowAndFrameToTransparent(w[which], false);
    RemoveWindow(w[which]);
    w[which] = K.WINDOW_NONE;
    ScheduleBgCopyTilemapToVram(2);
  }
}

export function DisplayPartyMenuStdMessage(stringId: number): void {
  testEvent('partyMenuMessage', { msgId: stringId });
  const w = internal().windowId;
  if (w[1] !== K.WINDOW_NONE) PartyMenuRemoveWindow(1);
  if (stringId !== K.PARTY_MSG_NONE) {
    switch (stringId) {
      case K.PARTY_MSG_DO_WHAT_WITH_MON:
        w[1] = AddWindow(sDoWhatWithMonMsgWindowTemplate);
        break;
      case K.PARTY_MSG_DO_WHAT_WITH_ITEM:
        w[1] = AddWindow(sDoWhatWithItemMsgWindowTemplate);
        break;
      case K.PARTY_MSG_DO_WHAT_WITH_MAIL:
        w[1] = AddWindow(sDoWhatWithMailMsgWindowTemplate);
        break;
      case K.PARTY_MSG_RESTORE_WHICH_MOVE:
      case K.PARTY_MSG_BOOST_PP_WHICH_MOVE:
        w[1] = AddWindow(sWhichMoveMsgWindowTemplate);
        break;
      default:
        w[1] = AddWindow(sDefaultPartyMsgWindowTemplate);
        break;
    }
    if (stringId === K.PARTY_MSG_CHOOSE_MON) {
      if (internal().chooseMultiple) stringId = K.PARTY_MSG_CHOOSE_MON_AND_CONFIRM;
      else if (!ShouldUseChooseMonText()) stringId = K.PARTY_MSG_CHOOSE_MON_OR_CANCEL;
    }
    DrawStdFrameWithCustomTileAndPalette(w[1], false, 0x58, 15);
    AddTextPrinterParameterized(w[1], K.FONT_NORMAL, ExpandToStringVar4(sActionStringTable(stringId)), 0, 2, 0);
    ScheduleBgCopyTilemapToVram(2);
  }
}

function ShouldUseChooseMonText(): boolean {
  let numAliveMons = 0;
  if (gPartyMenu.action === K.PARTY_ACTION_SEND_OUT) return true;
  for (let i = 0; i < K.PARTY_SIZE; ++i) {
    const mon = partyMon(i);
    if (mon && mon.species !== K.SPECIES_NONE && (mon.hp !== 0 || mon.isEgg)) ++numAliveMons;
    if (numAliveMons > 1) return true;
  }
  return false;
}

function DisplaySelectionWindow(windowType: number): number {
  let window: WindowTemplate;
  switch (windowType) {
    case K.SELECTWINDOW_ACTIONS:
      window = SetWindowTemplateFields(2, 19, 19 - internal().numActions * 2, 10, internal().numActions * 2, 14, 0x2bf);
      break;
    case K.SELECTWINDOW_ITEM:
      window = sItemGiveTakeWindowTemplate;
      break;
    case K.SELECTWINDOW_MAIL:
      window = sMailReadTakeWindowTemplate;
      break;
    default: // SELECTWINDOW_MOVES
      window = sMoveSelectWindowTemplate;
      break;
  }
  const w = internal().windowId;
  w[0] = AddWindow(window);
  DrawStdFrameWithCustomTileAndPalette(w[0], false, 0x4f, 13);
  if (windowType === K.SELECTWINDOW_MOVES) return w[0];
  const cursorDimension = GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0);
  const fontAttribute = GetFontAttribute(K.FONT_NORMAL, FONTATTR_LETTER_SPACING);
  for (let i = 0; i < internal().numActions; ++i) {
    const fontColorsId = internal().actions[i] >= CURSOR_OPTION_FIELD_MOVES ? 4 : 3;
    AddTextPrinterParameterized4(w[0], K.FONT_NORMAL, cursorDimension, i * 16 + 2, fontAttribute, 0, sFontColorTable()[fontColorsId], 0, sCursorOptions(internal().actions[i]).text);
  }
  Menu_InitCursorInternal(w[0], K.FONT_NORMAL, 0, 2, 16, internal().numActions, 0, true);
  ScheduleBgCopyTilemapToVram(2);
  return w[0];
}

function PartyMenuPrintText(str: number[]): void {
  DrawStdFrameWithCustomTileAndPalette(6, false, 0x4f, 13);
  gTextFlags.canABSpeedUpPrint = true;
  AddTextPrinterParameterized2(6, K.FONT_NORMAL, str, GetTextSpeedSetting(), TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
}

function PartyMenuDisplayYesNoMenu(): void {
  CreateYesNoMenu(sPartyMenuYesNoWindowTemplate, K.FONT_NORMAL, 0, 2, 0x4f, 13, 0);
}

function CreateLevelUpStatsWindow(): number {
  internal().windowId[0] = AddWindow(sLevelUpStatsWindowTemplate);
  DrawStdFrameWithCustomTileAndPalette(internal().windowId[0], false, 0x4f, 13);
  return internal().windowId[0];
}

function RemoveLevelUpStatsWindow(): void {
  ClearWindowTilemap(internal().windowId[0]);
  PartyMenuRemoveWindow(0);
}

function PartyMenu_Oak_PrintText(windowId: number, str: number[]): void {
  gTextFlags.canABSpeedUpPrint = true;
  AddTextPrinterParameterized2(windowId, K.FONT_MALE, ExpandToStringVar4(str), GetTextSpeedSetting(), TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
}

function FirstBattleEnterParty_CreateWindowAndMsg1Printer(): number {
  const windowId = AddWindow(sWindowTemplate_FirstBattleOakVoiceover);
  LoadMenuMessageWindowGfx(windowId, 0x4f, BG_PLTT_ID(14));
  DrawDialogFrameWithCustomTileAndPalette(windowId, true, 0x4f, 0xe);
  PartyMenu_Oak_PrintText(windowId, text('gText_OakImportantToGetToKnowPokemonThroughly'));
  return windowId;
}

function FirstBattleEnterParty_DestroyVoiceoverWindow(windowId: number): void {
  ClearWindowTilemap(windowId);
  ClearDialogWindowAndFrameToTransparent(windowId, false);
  RemoveWindow(windowId);
  ScheduleBgCopyTilemapToVram(2);
}

function ToggleFieldMoveDescriptionWindow(action: number): void {
  const ptr = internal();
  if (action < CURSOR_OPTION_FIELD_MOVES) {
    if (ptr.windowId[2] !== K.WINDOW_NONE) {
      ClearWindowTilemap(ptr.windowId[2]);
      RemoveWindow(ptr.windowId[2]);
      ptr.windowId[2] = K.WINDOW_NONE;
      ScheduleBgCopyTilemapToVram(2);
    }
  } else {
    if (ptr.windowId[2] === K.WINDOW_NONE) ptr.windowId[2] = AddWindow(sFieldMoveDescriptionWindowTemplate);
    DrawHelpMessageWindowTilesById(ptr.windowId[2]);
    const letterSpacing = GetFontAttribute(K.FONT_NORMAL, FONTATTR_LETTER_SPACING);
    AddTextPrinterParameterized4(ptr.windowId[2], K.FONT_NORMAL, 3, 6, letterSpacing, 0, sFontColorTable()[5], 0, sFieldMoveDescriptionTable(action - CURSOR_OPTION_FIELD_MOVES));
    PutWindowTilemap(ptr.windowId[2]);
    ScheduleBgCopyTilemapToVram(2);
  }
}

function CreatePartyMonIconSprite(mon: Pokemon, menuBox: PartyMenuBox, _slot: number): void {
  // handleDeoxys stays TRUE outside multi battles
  CreatePartyMonIconSpriteParameterized(speciesOrEgg(mon), mon.personality, menuBox, 1, true);
  UpdatePartyMonHPBar(menuBox.monSpriteId, mon);
}

function CreatePartyMonIconSpriteParameterized(species: number, pid: number, menuBox: PartyMenuBox, priority: number, handleDeoxys: boolean): void {
  if (species !== K.SPECIES_NONE) {
    menuBox.monSpriteId = CreateMonIcon(species, SpriteCB_MonIcon, menuBox.spriteCoords[0], menuBox.spriteCoords[1], 4, pid, handleDeoxys);
    gSprites[menuBox.monSpriteId].oam.priority = priority;
  }
}

function UpdateHPBar(spriteId: number, hp: number, maxhp: number): void {
  switch (GetHPBarLevel(hp, maxhp)) {
    case K.HP_BAR_FULL:
      SetPartyHPBarSprite(gSprites[spriteId], 0);
      break;
    case K.HP_BAR_GREEN:
      SetPartyHPBarSprite(gSprites[spriteId], 1);
      break;
    case K.HP_BAR_YELLOW:
      SetPartyHPBarSprite(gSprites[spriteId], 2);
      break;
    case K.HP_BAR_RED:
      SetPartyHPBarSprite(gSprites[spriteId], 3);
      break;
    default:
      SetPartyHPBarSprite(gSprites[spriteId], 4);
      break;
  }
}

function UpdatePartyMonHPBar(spriteId: number, mon: Pokemon): void {
  UpdateHPBar(spriteId, mon.hp, mon.maxHP);
}

function AnimateSelectedPartyIcon(spriteId: number, animNum: number): void {
  const s = gSprites[spriteId];
  s.data[0] = 0;
  if (animNum === 0) {
    if (s.x === 16) {
      s.x2 = 0;
      s.y2 = -4;
    } else {
      s.x2 = -4;
      s.y2 = 0;
    }
    s.callback = SpriteCB_UpdatePartyMonIcon;
  } else {
    s.x2 = 0;
    s.y2 = 0;
    s.callback = SpriteCB_BouncePartyMonIcon;
  }
}

function SpriteCB_BouncePartyMonIcon(sprite: Sprite): void {
  const animCmd = UpdateMonIconFrame(sprite);
  if (animCmd !== 0) {
    if (animCmd & 1) sprite.y2 = -3;
    else sprite.y2 = 1;
  }
}

function SpriteCB_UpdatePartyMonIcon(sprite: Sprite): void {
  UpdateMonIconFrame(sprite);
}

function CreatePartyMonHeldItemSprite(mon: Pokemon, menuBox: PartyMenuBox): void {
  if (mon.species !== K.SPECIES_NONE) {
    menuBox.itemSpriteId = CreateSprite(sSpriteTemplate_HeldItem(), menuBox.spriteCoords[2], menuBox.spriteCoords[3], 0);
    UpdatePartyMonHeldItemSprite(mon, menuBox);
  }
}

function UpdatePartyMonHeldItemSprite(mon: Pokemon, menuBox: PartyMenuBox): void {
  ShowOrHideHeldItemSprite(mon.heldItem, menuBox);
}

function ShowOrHideHeldItemSprite(item: number, menuBox: PartyMenuBox): void {
  if (item === K.ITEM_NONE) {
    gSprites[menuBox.itemSpriteId].invisible = true;
  } else {
    StartSpriteAnim(gSprites[menuBox.itemSpriteId], ItemIsMail(item) ? 1 : 0);
    gSprites[menuBox.itemSpriteId].invisible = false;
  }
}

export function LoadHeldItemIcons(): void {
  LoadSpriteSheet({ data: gfx('sHeldItemGfx'), size: gfx('sHeldItemGfx').length, tag: TAG_HELD_ITEM });
  LoadSpritePalette({ data: gfx16('sHeldItemPalette'), tag: TAG_HELD_ITEM });
}

function CreatePartyMonPokeballSprite(mon: Pokemon, menuBox: PartyMenuBox): void {
  if (mon.species !== K.SPECIES_NONE) menuBox.pokeballSpriteId = CreateSprite(sSpriteTemplate_MenuPokeball(), menuBox.spriteCoords[6], menuBox.spriteCoords[7], 8);
}

/** For Cancel when Confirm isn't present */
function CreatePokeballButtonSprite(x: number, y: number): number {
  const spriteId = CreateSprite(sSpriteTemplate_MenuPokeball(), x, y, 8);
  gSprites[spriteId].oam.priority = 2;
  return spriteId;
}

/** For Confirm and Cancel when both are present */
function CreateSmallPokeballButtonSprite(x: number, y: number): number {
  return CreateSprite(sSpriteTemplate_MenuPokeballSmall(), x, y, 8);
}

function PartyMenuStartSpriteAnim(spriteId: number, animNum: number): void {
  StartSpriteAnim(gSprites[spriteId], animNum);
}

function LoadPartyMenuPokeballGfx(): void {
  LoadCompressedSpriteSheet({ data: gfx('gPartyMenuPokeball_Gfx'), size: 0x400, tag: TAG_POKEBALL });
  LoadCompressedSpriteSheet({ data: gfx('gPartyMenuPokeballSmall_Gfx'), size: 0x300, tag: TAG_POKEBALL_SMALL });
  LoadSpritePalette({ data: gfx16('gPartyMenuPokeball_Pal'), tag: TAG_POKEBALL });
}

function CreatePartyMonStatusSprite(mon: Pokemon, menuBox: PartyMenuBox): void {
  if (mon.species !== K.SPECIES_NONE) {
    menuBox.statusSpriteId = CreateSprite(sSpriteTemplate_StatusIcons(), menuBox.spriteCoords[4], menuBox.spriteCoords[5], 0);
    SetPartyMonAilmentGfx(mon, menuBox);
  }
}

function SetPartyMonAilmentGfx(mon: Pokemon, menuBox: PartyMenuBox): void {
  UpdatePartyMonAilmentGfx(GetMonAilment(mon), menuBox);
}

function UpdatePartyMonAilmentGfx(status: number, menuBox: PartyMenuBox): void {
  switch (status) {
    case K.AILMENT_NONE:
    case K.AILMENT_PKRS:
      gSprites[menuBox.statusSpriteId].invisible = true;
      break;
    default:
      StartSpriteAnim(gSprites[menuBox.statusSpriteId], status - 1);
      gSprites[menuBox.statusSpriteId].invisible = false;
      break;
  }
}

function LoadPartyMenuAilmentGfx(): void {
  LoadCompressedSpriteSheet({ data: gfx('gStatusGfx_Icons'), size: 0x400, tag: TAG_STATUS_ICONS });
  LoadSpritePalette({ data: gfx16('gStatusPal_Icons'), tag: TAG_STATUS_ICONS });
}

function SetPartyMonSelectionActions(slotId: number, action: number): void {
  if (action === ACTIONS_NONE) {
    SetPartyMonFieldSelectionActions(slotId);
  } else {
    const list = sPartyMenuActions[action]!;
    internal().numActions = list.length;
    for (let i = 0; i < list.length; ++i) internal().actions[i] = list[i];
  }
}

function AppendToList(list: number[], count: { n: number }, value: number): void {
  list[count.n++] = value;
}

function SetPartyMonFieldSelectionActions(slotId: number): void {
  const count = { n: 0 };
  const actions = internal().actions;
  const mon = P(slotId);
  AppendToList(actions, count, CURSOR_OPTION_SUMMARY);
  // Add field moves to action list
  const fieldMoves = sFieldMoves();
  for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
    for (let j = 0; j < fieldMoves.length; ++j) {
      if (mon.moves[i] === fieldMoves[j]) {
        AppendToList(actions, count, j + CURSOR_OPTION_FIELD_MOVES);
        break;
      }
    }
  }
  if (partySpecies(1) !== K.SPECIES_NONE) AppendToList(actions, count, CURSOR_OPTION_SWITCH);
  if (ItemIsMail(mon.heldItem)) AppendToList(actions, count, CURSOR_OPTION_MAIL);
  else AppendToList(actions, count, CURSOR_OPTION_ITEM);
  AppendToList(actions, count, CURSOR_OPTION_CANCEL1);
  internal().numActions = count.n;
}

function GetPartyMenuActionsType(mon: Pokemon): number {
  switch (gPartyMenu.menuType) {
    case K.PARTY_MENU_TYPE_FIELD:
      return mon.isEgg ? ACTIONS_SWITCH : ACTIONS_NONE; // actions populated by SetPartyMonFieldSelectionActions
    case K.PARTY_MENU_TYPE_IN_BATTLE:
      return GetPartyMenuActionsTypeInBattle(mon);
    case K.PARTY_MENU_TYPE_CHOOSE_MULTIPLE_MONS:
      switch (GetPartySlotEntryStatus(gPartyMenu.slotId)) {
        default: // Not eligible
          return ACTIONS_SUMMARY_ONLY;
        case 0: // Eligible
          return ACTIONS_ENTER;
        case 1: // Already selected
          return ACTIONS_NO_ENTRY;
      }
    case K.PARTY_MENU_TYPE_DAYCARE:
      return mon.isEgg ? ACTIONS_SUMMARY_ONLY : ACTIONS_STORE;
    case K.PARTY_MENU_TYPE_UNION_ROOM_REGISTER:
      return ACTIONS_REGISTER;
    case K.PARTY_MENU_TYPE_UNION_ROOM_TRADE:
      return ACTIONS_TRADE;
    case K.PARTY_MENU_TYPE_SPIN_TRADE:
      return ACTIONS_SPIN_TRADE;
    // The rest have no selection actions (they exit immediately upon selection)
    default:
      return ACTIONS_NONE;
  }
}

function CreateSelectionWindow(): void {
  const mon = P(gPartyMenu.slotId);
  gStringVar1.set(GetMonNickname(mon));
  PartyMenuRemoveWindow(1);
  SetPartyMonSelectionActions(gPartyMenu.slotId, GetPartyMenuActionsType(mon));
  DisplaySelectionWindow(K.SELECTWINDOW_ACTIONS);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_DO_WHAT_WITH_MON);
}

function Task_TryCreateSelectionWindow(taskId: number): void {
  CreateSelectionWindow();
  gTasks[taskId].data[0] = MENU_B_PRESSED & 0xff;
  gTasks[taskId].func = Task_HandleSelectionMenuInput;
}

function Task_HandleSelectionMenuInput(taskId: number): void {
  if (!gPaletteFade.active && !MenuHelpers_ShouldWaitForLinkRecv()) {
    const data = gTasks[taskId].data;
    const input = internal().numActions <= 3 ? Menu_ProcessInputNoWrapAround_other() : Menu_ProcessInput_other();
    if (data[0] !== Menu_GetCursorPos()) ToggleFieldMoveDescriptionWindow(internal().actions[Menu_GetCursorPos()]);
    data[0] = Menu_GetCursorPos();
    switch (input) {
      case MENU_NOTHING_CHOSEN:
        break;
      case MENU_B_PRESSED:
        PlaySE(K.SE_SELECT);
        PartyMenuRemoveWindow(2);
        sCursorOptions(internal().actions[internal().numActions - 1]).func(taskId);
        break;
      default:
        PartyMenuRemoveWindow(2);
        sCursorOptions(internal().actions[input]).func(taskId);
        break;
    }
  }
}

function CursorCB_Summary(taskId: number): void {
  PlaySE(K.SE_SELECT);
  internal().exitCallback = CB2_ShowPokemonSummaryScreen;
  Task_ClosePartyMenu(taskId);
}

function CB2_ShowPokemonSummaryScreen(): void {
  if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) UpdatePartyToBattleOrder();
  ShowPokemonSummaryScreen(state.party, gPartyMenu.slotId, CalculatePlayerPartyCount() - 1, CB2_ReturnToPartyMenuFromSummaryScreen, K.PSS_MODE_NORMAL);
}

function CB2_ReturnToPartyMenuFromSummaryScreen(): void {
  gPaletteFade.bufferTransferDisabled = true;
  gPartyMenu.slotId = GetLastViewedMonIndex();
  InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_DO_WHAT_WITH_MON, Task_TryCreateSelectionWindow, gPartyMenu.exitCallback);
}

function CursorCB_Switch(taskId: number): void {
  PlaySE(K.SE_SELECT);
  gPartyMenu.action = K.PARTY_ACTION_SWITCH;
  PartyMenuRemoveWindow(1);
  PartyMenuRemoveWindow(0);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_MOVE_TO_WHERE);
  AnimatePartySlot(gPartyMenu.slotId, 1);
  gPartyMenu.slotId2 = gPartyMenu.slotId;
  gTasks[taskId].func = Task_HandleChooseMonInput;
}

// Task data for the switch slide
const tSlot1Left = 0;
const tSlot1Top = 1;
const tSlot1Width = 2;
const tSlot1Height = 3;
const tSlot2Left = 4;
const tSlot2Top = 5;
const tSlot2Width = 6;
const tSlot2Height = 7;
const tSlot1Offset = 8;
const tSlot2Offset = 9;
const tSlot1SlideDir = 10;
const tSlot2SlideDir = 11;

function SwitchSelectedMons(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gPartyMenu.slotId2 === gPartyMenu.slotId) {
    FinishTwoMonAction(taskId);
    return;
  }
  // Initialize switching party mons slide animation
  const windowIds = [boxes()[gPartyMenu.slotId].windowId, boxes()[gPartyMenu.slotId2].windowId];
  data[tSlot1Left] = GetWindowAttribute(windowIds[0], 'tilemapLeft');
  data[tSlot1Top] = GetWindowAttribute(windowIds[0], 'tilemapTop');
  data[tSlot1Width] = GetWindowAttribute(windowIds[0], 'width');
  data[tSlot1Height] = GetWindowAttribute(windowIds[0], 'height');
  data[tSlot1Offset] = 0;
  data[tSlot1SlideDir] = data[tSlot1Width] === 10 ? -1 : 1;
  data[tSlot2Left] = GetWindowAttribute(windowIds[1], 'tilemapLeft');
  data[tSlot2Top] = GetWindowAttribute(windowIds[1], 'tilemapTop');
  data[tSlot2Width] = GetWindowAttribute(windowIds[1], 'width');
  data[tSlot2Height] = GetWindowAttribute(windowIds[1], 'height');
  data[tSlot2Offset] = 0;
  data[tSlot2SlideDir] = data[tSlot2Width] === 10 ? -1 : 1;
  sSlot1TilemapBuffer = new Uint16Array(data[tSlot1Width] * data[tSlot1Height]);
  sSlot2TilemapBuffer = new Uint16Array(data[tSlot2Width] * data[tSlot2Height]);
  CopyToBufferFromBgTilemap(0, sSlot1TilemapBuffer, data[tSlot1Left], data[tSlot1Top], data[tSlot1Width], data[tSlot1Height]);
  CopyToBufferFromBgTilemap(0, sSlot2TilemapBuffer, data[tSlot2Left], data[tSlot2Top], data[tSlot2Width], data[tSlot2Height]);
  ClearWindowTilemap(windowIds[0]);
  ClearWindowTilemap(windowIds[1]);
  gPartyMenu.action = K.PARTY_ACTION_SWITCHING;
  AnimatePartySlot(gPartyMenu.slotId, 1);
  AnimatePartySlot(gPartyMenu.slotId2, 1);
  SlidePartyMenuBoxOneStep(taskId);
  gTasks[taskId].func = Task_SlideSelectedSlotsOffscreen;
}

/** TryMovePartySlot: false if the slot has slid fully offscreen / back onscreen */
function TryMovePartySlot(x: number, width: number): { leftMove: number; newX: number; newWidth: number } | null {
  if (x + width < 0) return null;
  if (x > 31) return null;
  if (x < 0) return { leftMove: -x, newX: 0, newWidth: width + x };
  return { leftMove: 0, newX: x, newWidth: x + width > 31 ? 32 - x : width };
}

function MoveAndBufferPartySlot(rectSrc: Uint16Array, x: number, y: number, width: number, height: number, dir: number): void {
  // The use of the dimension parameters here is a mess
  const a = TryMovePartySlot(x, width);
  if (a) {
    FillBgTilemapBufferRect_Palette0(0, 0, a.newX & 0xff, y, a.newWidth & 0xff, height);
    const b = TryMovePartySlot(x + dir, width);
    if (b) CopyRectToBgTilemapBufferRect(0, rectSrc, b.leftMove & 0xff, 0, width, height, b.newX & 0xff, y, b.newWidth & 0xff, height, 17, 0, 0);
  }
}

function MovePartyMenuBoxSprites(menuBox: PartyMenuBox, offset: number): void {
  gSprites[menuBox.pokeballSpriteId].x2 += offset * 8;
  gSprites[menuBox.itemSpriteId].x2 += offset * 8;
  gSprites[menuBox.monSpriteId].x2 += offset * 8;
  gSprites[menuBox.statusSpriteId].x2 += offset * 8;
}

function SlidePartyMenuBoxSpritesOneStep(taskId: number): void {
  const data = gTasks[taskId].data;
  if (data[tSlot1SlideDir] !== 0) MovePartyMenuBoxSprites(boxes()[gPartyMenu.slotId], data[tSlot1SlideDir]);
  if (data[tSlot2SlideDir] !== 0) MovePartyMenuBoxSprites(boxes()[gPartyMenu.slotId2], data[tSlot2SlideDir]);
}

function SlidePartyMenuBoxOneStep(taskId: number): void {
  const data = gTasks[taskId].data;
  if (data[tSlot1SlideDir] !== 0) MoveAndBufferPartySlot(sSlot1TilemapBuffer, data[tSlot1Left] + data[tSlot1Offset], data[tSlot1Top], data[tSlot1Width], data[tSlot1Height], data[tSlot1SlideDir]);
  if (data[tSlot2SlideDir] !== 0) MoveAndBufferPartySlot(sSlot2TilemapBuffer, data[tSlot2Left] + data[tSlot2Offset], data[tSlot2Top], data[tSlot2Width], data[tSlot2Height], data[tSlot2SlideDir]);
  ScheduleBgCopyTilemapToVram(0);
}

function Task_SlideSelectedSlotsOffscreen(taskId: number): void {
  const data = gTasks[taskId].data;
  SlidePartyMenuBoxOneStep(taskId);
  SlidePartyMenuBoxSpritesOneStep(taskId);
  data[tSlot1Offset] += data[tSlot1SlideDir];
  data[tSlot2Offset] += data[tSlot2SlideDir];
  const pos0 = (data[tSlot1Left] + data[tSlot1Offset]) & 0xffff;
  const pos1 = (data[tSlot2Left] + data[tSlot2Offset]) & 0xffff;
  // Both slots have slid offscreen
  if (pos0 > 33 && pos1 > 33) {
    data[tSlot1SlideDir] *= -1;
    data[tSlot2SlideDir] *= -1;
    SwitchPartyMon();
    DisplayPartyPokemonData(gPartyMenu.slotId);
    DisplayPartyPokemonData(gPartyMenu.slotId2);
    PutWindowTilemap(boxes()[gPartyMenu.slotId].windowId);
    PutWindowTilemap(boxes()[gPartyMenu.slotId2].windowId);
    CopyToBufferFromBgTilemap(0, sSlot1TilemapBuffer, data[tSlot1Left], data[tSlot1Top], data[tSlot1Width], data[tSlot1Height]);
    CopyToBufferFromBgTilemap(0, sSlot2TilemapBuffer, data[tSlot2Left], data[tSlot2Top], data[tSlot2Width], data[tSlot2Height]);
    ClearWindowTilemap(boxes()[gPartyMenu.slotId].windowId);
    ClearWindowTilemap(boxes()[gPartyMenu.slotId2].windowId);
    gTasks[taskId].func = Task_SlideSelectedSlotsOnscreen;
  }
}

function Task_SlideSelectedSlotsOnscreen(taskId: number): void {
  const data = gTasks[taskId].data;
  SlidePartyMenuBoxOneStep(taskId);
  SlidePartyMenuBoxSpritesOneStep(taskId);
  // Both slots have slid back onscreen
  if (data[tSlot1SlideDir] === 0 && data[tSlot2SlideDir] === 0) {
    PutWindowTilemap(boxes()[gPartyMenu.slotId].windowId);
    PutWindowTilemap(boxes()[gPartyMenu.slotId2].windowId);
    ScheduleBgCopyTilemapToVram(0);
    FinishTwoMonAction(taskId);
  } else {
    // Continue sliding
    data[tSlot1Offset] += data[tSlot1SlideDir];
    data[tSlot2Offset] += data[tSlot2SlideDir];
    if (data[tSlot1Offset] === 0) data[tSlot1SlideDir] = 0;
    if (data[tSlot2Offset] === 0) data[tSlot2SlideDir] = 0;
  }
}

type SpriteField = 'pokeballSpriteId' | 'itemSpriteId' | 'monSpriteId' | 'statusSpriteId';

function SwitchMenuBoxSprites(box1: PartyMenuBox, box2: PartyMenuBox, field: SpriteField): void {
  const spriteIdBuffer = box1[field];
  box1[field] = box2[field];
  box2[field] = spriteIdBuffer;
  const s1 = gSprites[box1[field]];
  const s2 = gSprites[box2[field]];
  const [x1, y1, x21, y21] = [s1.x, s1.y, s1.x2, s1.y2];
  s1.x = s2.x;
  s1.y = s2.y;
  s1.x2 = s2.x2;
  s1.y2 = s2.y2;
  s2.x = x1;
  s2.y = y1;
  s2.x2 = x21;
  s2.y2 = y21;
}

function SwitchPartyMon(): void {
  const b1 = boxes()[gPartyMenu.slotId];
  const b2 = boxes()[gPartyMenu.slotId2];
  SwapPartyPokemon(gPartyMenu.slotId, gPartyMenu.slotId2);
  SwitchMenuBoxSprites(b1, b2, 'pokeballSpriteId');
  SwitchMenuBoxSprites(b1, b2, 'itemSpriteId');
  SwitchMenuBoxSprites(b1, b2, 'monSpriteId');
  SwitchMenuBoxSprites(b1, b2, 'statusSpriteId');
}

/** Finish switching mons or using Softboiled */
function FinishTwoMonAction(taskId: number): void {
  PartyMenuRemoveWindow(1);
  gPartyMenu.action = K.PARTY_ACTION_CHOOSE_MON;
  AnimatePartySlot(gPartyMenu.slotId, 0);
  gPartyMenu.slotId = gPartyMenu.slotId2;
  AnimatePartySlot(gPartyMenu.slotId2, 1);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
  gTasks[taskId].func = Task_HandleChooseMonInput;
}

function CursorCB_Cancel1(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_DAYCARE) DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON_2);
  else DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
  gTasks[taskId].func = Task_HandleChooseMonInput;
}

function CursorCB_Item(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  SetPartyMonSelectionActions(gPartyMenu.slotId, ACTIONS_ITEM);
  DisplaySelectionWindow(K.SELECTWINDOW_ITEM);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_DO_WHAT_WITH_ITEM);
  gTasks[taskId].data[0] = MENU_B_PRESSED & 0xff;
  gTasks[taskId].func = Task_HandleSelectionMenuInput;
}

function CursorCB_Give(taskId: number): void {
  PlaySE(K.SE_SELECT);
  internal().exitCallback = CB2_SelectBagItemToGive;
  Task_ClosePartyMenu(taskId);
}

export function CB2_SelectBagItemToGive(): void {
  GoToBagMenu(K.ITEMMENULOCATION_PARTY, K.OPEN_BAG_LAST, CB2_GiveHoldItem);
}

export function CB2_GiveHoldItem(): void {
  if (SpecialVar.ItemId === K.ITEM_NONE) {
    InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_NONE, Task_TryCreateSelectionWindow, gPartyMenu.exitCallback);
  } else {
    sPartyMenuItemId = P(gPartyMenu.slotId).heldItem;
    // Already holding item
    if (sPartyMenuItemId !== K.ITEM_NONE) {
      InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_NONE, Task_SwitchHoldItemsPrompt, gPartyMenu.exitCallback);
    } else if (ItemIsMail(SpecialVar.ItemId)) {
      // Give mail
      RemoveBagItem(SpecialVar.ItemId, 1);
      GiveItemToMon(P(gPartyMenu.slotId), SpecialVar.ItemId);
      CB2_WriteMailToGiveMon();
    } else {
      // Give item
      InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_NONE, Task_GiveHoldItem, gPartyMenu.exitCallback);
    }
  }
}

function Task_GiveHoldItem(taskId: number): void {
  if (!gPaletteFade.active) {
    const item = SpecialVar.ItemId;
    DisplayGaveHeldItemMessage(P(gPartyMenu.slotId), item, false);
    GiveItemToMon(P(gPartyMenu.slotId), item);
    RemoveBagItem(item, 1);
    gTasks[taskId].func = Task_UpdateHeldItemSprite;
  }
}

function Task_SwitchHoldItemsPrompt(taskId: number): void {
  if (!gPaletteFade.active) {
    DisplayAlreadyHoldingItemSwitchMessage(P(gPartyMenu.slotId), sPartyMenuItemId, true);
    gTasks[taskId].func = Task_SwitchItemsYesNo;
  }
}

function Task_SwitchItemsYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleSwitchItemsYesNoInput;
  }
}

function Task_HandleSwitchItemsYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: // Yes, switch items
      RemoveBagItem(SpecialVar.ItemId, 1);
      // No room to return held item to bag
      if (AddBagItem(sPartyMenuItemId, 1) === false) {
        AddBagItem(SpecialVar.ItemId, 1);
        BufferBagFullCantTakeItemMessage(sPartyMenuItemId);
        DisplayPartyMenuMessage(gStringVar4, false);
        gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
      } else if (ItemIsMail(SpecialVar.ItemId)) {
        // Giving mail
        GiveItemToMon(P(gPartyMenu.slotId), SpecialVar.ItemId);
        gTasks[taskId].func = Task_WriteMailToGiveMonAfterText;
      } else {
        // Giving item
        GiveItemToMon(P(gPartyMenu.slotId), SpecialVar.ItemId);
        DisplaySwitchedHeldItemMessage(SpecialVar.ItemId, sPartyMenuItemId, true);
        gTasks[taskId].func = Task_UpdateHeldItemSprite;
      }
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1: // No
      gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
      break;
  }
}

function Task_WriteMailToGiveMonAfterText(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    internal().exitCallback = CB2_WriteMailToGiveMon;
    Task_ClosePartyMenu(taskId);
  }
}

/** CB2_WriteMailToGiveMon: the Easy Chat screen on the mon's new mail's words. */
function CB2_WriteMailToGiveMon(): void {
  const mail = GetMonMailId(state.defines, P(gPartyMenu.slotId));
  DoEasyChatScreen(K.EASY_CHAT_TYPE_MAIL, mailWords(mail), CB2_ReturnToPartyMenuFromWritingMail);
}

/** gSaveBlock1Ptr->mail[mail].words (a scratch array if GiveMailToMon found no free slot: the C writes past mail[]). */
function mailWords(mail: number): number[] {
  return (state.mail[mail] ?? newMail(state.defines)).words;
}

function CB2_ReturnToPartyMenuFromWritingMail(): void {
  const mon = P(gPartyMenu.slotId);
  const item = mon.heldItem;
  if (state.getVar('VAR_RESULT') === 0) {
    // Canceled writing mail
    TakeMailFromMon(state, mon);
    mon.heldItem = sPartyMenuItemId;
    RemoveBagItem(sPartyMenuItemId, 1);
    AddBagItem(item, 1);
    InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_CHOOSE_MON, Task_TryCreateSelectionWindow, gPartyMenu.exitCallback);
  } else {
    // Wrote mail
    InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_CHOOSE_MON, Task_DisplayGaveMailFromPartyMessage, gPartyMenu.exitCallback);
  }
}

/** Task_DisplayGaveMailFromPartyMessage: nearly redundant with Task_DisplayGaveMailFromBagMessage. */
function Task_DisplayGaveMailFromPartyMessage(taskId: number): void {
  if (!gPaletteFade.active) {
    if (sPartyMenuItemId === K.ITEM_NONE) DisplayGaveHeldItemMessage(P(gPartyMenu.slotId), SpecialVar.ItemId, false);
    else DisplaySwitchedHeldItemMessage(SpecialVar.ItemId, sPartyMenuItemId, false);
    gTasks[taskId].func = Task_UpdateHeldItemSprite;
  }
}

function Task_UpdateHeldItemSprite(taskId: number): void {
  const slotId = gPartyMenu.slotId;
  if (!IsPartyMenuTextPrinterActive()) {
    UpdatePartyMonHeldItemSprite(P(slotId), boxes()[slotId]);
    Task_ReturnToChooseMonAfterText(taskId);
  }
}

function CursorCB_TakeItem(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  const item = mon.heldItem;
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  switch (TryTakeMonItem(mon)) {
    case 0: // Not holding item
      gStringVar1.set(GetMonNickname(mon));
      DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnNotHolding')), true);
      break;
    case 1: // No room to take item
      BufferBagFullCantTakeItemMessage(item);
      DisplayPartyMenuMessage(gStringVar4, true);
      break;
    default: // Took item
      DisplayTookHeldItemMessage(mon, item, true);
      break;
  }
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_UpdateHeldItemSprite;
}

function CursorCB_Mail(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  SetPartyMonSelectionActions(gPartyMenu.slotId, ACTIONS_MAIL);
  DisplaySelectionWindow(K.SELECTWINDOW_MAIL);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_DO_WHAT_WITH_MAIL);
  gTasks[taskId].data[0] = MENU_B_PRESSED & 0xff;
  gTasks[taskId].func = Task_HandleSelectionMenuInput;
}

function CursorCB_Read(taskId: number): void {
  PlaySE(K.SE_SELECT);
  internal().exitCallback = CB2_ReadHeldMail;
  Task_ClosePartyMenu(taskId);
}

/** CB2_ReadHeldMail (a mail item without a slot reads as a blank one) */
function CB2_ReadHeldMail(): void {
  const mail = state.mail[GetMonMailId(state.defines, P(gPartyMenu.slotId))] ?? newMail(state.defines);
  ReadMail(mail, CB2_ReturnToPartyMenuFromReadingMail, true);
}

function CB2_ReturnToPartyMenuFromReadingMail(): void {
  gPaletteFade.bufferTransferDisabled = true;
  InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_DO_WHAT_WITH_MON, Task_TryCreateSelectionWindow, gPartyMenu.exitCallback);
}

function CursorCB_TakeMail(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(1);
  PartyMenuRemoveWindow(0);
  DisplayPartyMenuMessage(text('gText_SendMailToPC'), true);
  gTasks[taskId].func = Task_SendMailToPCYesNo;
}

function Task_SendMailToPCYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleSendMailToPCYesNoInput;
  }
}

/** Task_HandleSendMailToPCYesNoInput: YES moves the mail into the PC mailbox's slots (TakeMailFromMon2). */
function Task_HandleSendMailToPCYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: // Yes, send to PC
      if (TakeMailFromMon2(state, P(gPartyMenu.slotId)) !== 0xff) {
        DisplayPartyMenuMessage(text('gText_MailSentToPC'), false);
        gTasks[taskId].func = Task_UpdateHeldItemSprite;
      } else {
        DisplayPartyMenuMessage(text('gText_PCMailboxFull'), false);
        gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
      }
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1:
      DisplayPartyMenuMessage(text('gText_MailMessageWillBeLost'), true);
      gTasks[taskId].func = Task_LoseMailMessageYesNo;
      break;
  }
}

function Task_LoseMailMessageYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleLoseMailMessageYesNoInput;
  }
}

function Task_HandleLoseMailMessageYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: {
      // Yes, lose mail message
      const item = P(gPartyMenu.slotId).heldItem;
      if (AddBagItem(item, 1) === true) {
        TakeMailFromMon(state, P(gPartyMenu.slotId));
        DisplayPartyMenuMessage(text('gText_MailTakenFromPkmn'), false);
        gTasks[taskId].func = Task_UpdateHeldItemSprite;
      } else {
        BufferBagFullCantTakeItemMessage(item);
        DisplayPartyMenuMessage(gStringVar4, false);
        gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
      }
      break;
    }
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1:
      gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
      break;
  }
}

function CursorCB_Cancel2(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  SetPartyMonSelectionActions(gPartyMenu.slotId, GetPartyMenuActionsType(mon));
  DisplaySelectionWindow(K.SELECTWINDOW_ACTIONS);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_DO_WHAT_WITH_MON);
  gTasks[taskId].data[0] = MENU_B_PRESSED & 0xff;
  gTasks[taskId].func = Task_HandleSelectionMenuInput;
}

function CursorCB_SendMon(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  if (TrySwitchInPokemon() === true) {
    Task_ClosePartyMenu(taskId);
  } else {
    // gStringVar4 below is the error message buffered by TrySwitchInPokemon
    PartyMenuRemoveWindow(1);
    DisplayPartyMenuMessage(gStringVar4, true);
    gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
  }
}

function CursorCB_Enter(taskId: number): void {
  let maxBattlers: number;
  let str: number[];
  if (gPartyMenu.chooseMonsBattleType === K.CHOOSE_MONS_FOR_UNION_ROOM_BATTLE) {
    maxBattlers = 2;
    str = text('gText_NoMoreThanTwoMayEnter');
  } else {
    maxBattlers = 3;
    str = text('gText_NoMoreThanThreeMayEnter');
  }
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  for (let i = 0; i < maxBattlers; ++i) {
    if (gSelectedOrderFromParty[i] === 0) {
      PlaySE(K.SE_SELECT);
      gSelectedOrderFromParty[i] = gPartyMenu.slotId + 1;
      DisplayPartyPokemonDescriptionText(i + K.PARTYBOX_DESC_FIRST, boxes()[gPartyMenu.slotId], 1);
      if (i === maxBattlers - 1) MoveCursorToConfirm();
      DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
      gTasks[taskId].func = Task_HandleChooseMonInput;
      return;
    }
  }
  PlaySE(K.SE_FAILURE);
  DisplayPartyMenuMessage(str, true);
  gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
}

function MoveCursorToConfirm(): void {
  AnimatePartySlot(gPartyMenu.slotId, 0);
  gPartyMenu.slotId = SLOT_CONFIRM();
  AnimatePartySlot(gPartyMenu.slotId, 1);
}

function CursorCB_NoEntry(taskId: number): void {
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  const o = gSelectedOrderFromParty;
  for (let i = 0; i < 3; ++i) {
    if (o[i] === gPartyMenu.slotId + 1) {
      o[i] = 0;
      switch (i) {
        case 0:
          o[0] = o[1];
          o[1] = o[2];
          o[2] = 0;
          break;
        case 1:
          o[1] = o[2];
          o[2] = 0;
          break;
      }
      break;
    }
  }
  DisplayPartyPokemonDescriptionText(K.PARTYBOX_DESC_ABLE_3, boxes()[gPartyMenu.slotId], DRAW_MENU_BOX_AND_TEXT);
  if (o[0] !== 0) DisplayPartyPokemonDescriptionText(K.PARTYBOX_DESC_FIRST, boxes()[o[0] - 1], DRAW_MENU_BOX_AND_TEXT);
  if (o[1] !== 0) DisplayPartyPokemonDescriptionText(K.PARTYBOX_DESC_SECOND, boxes()[o[1] - 1], DRAW_MENU_BOX_AND_TEXT);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
  gTasks[taskId].func = Task_HandleChooseMonInput;
}

function CursorCB_Store(taskId: number): void {
  PlaySE(K.SE_SELECT);
  SpecialVar.x8004 = gPartyMenu.slotId;
  Task_ClosePartyMenu(taskId);
}

function CursorCB_Register(taskId: number): void {
  console.warn('[party_menu] the Union Room trading board is not implemented');
  CursorCB_Cancel1(taskId);
}

function CursorCB_Trade1(taskId: number): void {
  console.warn('[party_menu] Union Room trades are not implemented');
  CursorCB_Cancel1(taskId);
}

/** Spin Trade: not implemented in the game either (PARTY_MENU_TYPE_SPIN_TRADE is never used) */
function CursorCB_Trade2(_taskId: number): void {}

/**
 * sFieldMoveCursorCallbacks[fieldMove].fieldMoveFunc, by FIELD_MOVE_* name: a SetUpFieldMove_* function
 * returns TRUE when the move can be used here, after setting gFieldCallback2 / gPostMenuFieldCallback
 * (Soft-Boiled sets nothing: it stays in the menu). The field moves register theirs
 * (world/fieldMoves.ts registerFieldMoves); one that isn't registered can't be used anywhere yet.
 */
const sFieldMoveSetUpFuncs = new Map<string, () => boolean>([
  ['FIELD_MOVE_MILK_DRINK', SetUpFieldMove_SoftBoiled],
  ['FIELD_MOVE_SOFT_BOILED', SetUpFieldMove_SoftBoiled],
]);

/** Plug a SetUpFieldMove_* function into sFieldMoveCursorCallbacks. */
export function registerFieldMoveSetUp(fieldMove: string, fn: () => boolean): void {
  sFieldMoveSetUpFuncs.set(fieldMove, fn);
}

function fieldMoveFunc(fieldMove: number): () => boolean {
  for (const [name, fn] of sFieldMoveSetUpFuncs) if (K[name] === fieldMove) return fn;
  return () => {
    console.warn(`[party_menu] field move ${fieldMove} is not implemented`);
    return false;
  };
}

/** gPostMenuFieldCallback: what FieldCallback_PrepareFadeInFromMenu calls once the field has faded in. */
let gPostMenuFieldCallback: (() => void) | null = null;

export function setPostMenuFieldCallback(fn: (() => void) | null): void {
  gPostMenuFieldCallback = fn;
}

function CursorCB_FieldMove(taskId: number): void {
  const fieldMove = internal().actions[Menu_GetCursorPos()] - CURSOR_OPTION_FIELD_MOVES;
  PlaySE(K.SE_SELECT);
  PartyMenuRemoveWindow(0);
  PartyMenuRemoveWindow(1);
  if (MenuHelpers_IsLinkActive()) {
    // (InUnionRoom: no Union Room)
    if (fieldMove === K.FIELD_MOVE_MILK_DRINK || fieldMove === K.FIELD_MOVE_SOFT_BOILED) DisplayPartyMenuStdMessage(K.PARTY_MSG_CANT_USE_HERE);
    else DisplayPartyMenuStdMessage(fieldMoveFailMsg(fieldMove));
    gTasks[taskId].func = Task_CancelAfterAorBPress;
  } else if (fieldMove <= K.FIELD_MOVE_WATERFALL && state.getFlag(K.FLAG_BADGE01_GET + fieldMove) !== true) {
    // All field moves before WATERFALL are HMs.
    DisplayPartyMenuMessage(text('gText_CantUseUntilNewBadge'), true);
    gTasks[taskId].func = Task_ReturnToChooseMonAfterText;
  } else if (fieldMoveFunc(fieldMove)()) {
    switch (fieldMove) {
      case K.FIELD_MOVE_MILK_DRINK:
      case K.FIELD_MOVE_SOFT_BOILED:
        ChooseMonForSoftboiled(taskId);
        break;
      case K.FIELD_MOVE_TELEPORT:
        gStringVar1.set(GetMapName(GetMapSectionOfMap(state.lastHealLocation?.map)));
        DisplayFieldMoveExitAreaMessage(taskId, ExpandToStringVar4(text('gText_ReturnToHealingSpot')));
        internal().data[0] = fieldMove;
        break;
      case K.FIELD_MOVE_DIG:
        gStringVar1.set(GetMapName(GetMapSectionOfMap(state.escapeWarp?.mapId)));
        DisplayFieldMoveExitAreaMessage(taskId, ExpandToStringVar4(text('gText_EscapeFromHereAndReturnTo')));
        internal().data[0] = fieldMove;
        break;
      case K.FIELD_MOVE_FLY:
        gPartyMenu.exitCallback = CB2_OpenFlyMap; // menus/regionMap.ts
        Task_ClosePartyMenu(taskId);
        break;
      default:
        gPartyMenu.exitCallback = CB2_ReturnToField;
        // (SetUsedFieldMoveQuestLogEvent: no quest log)
        Task_ClosePartyMenu(taskId);
        break;
    }
  } else {
    // Can't use the field move
    switch (fieldMove) {
      case K.FIELD_MOVE_SURF:
        DisplayCantUseSurfMessage();
        break;
      case K.FIELD_MOVE_FLASH:
        DisplayCantUseFlashMessage();
        break;
      default:
        DisplayPartyMenuStdMessage(fieldMoveFailMsg(fieldMove));
        break;
    }
    gTasks[taskId].func = Task_CancelAfterAorBPress;
  }
}

/** DisplayFieldMoveExitAreaMessage: gStringVar4 */
function DisplayFieldMoveExitAreaMessage(taskId: number, str: number[]): void {
  DisplayPartyMenuMessage(str, true);
  gTasks[taskId].func = Task_FieldMoveExitAreaYesNo;
}

function Task_FieldMoveExitAreaYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleFieldMoveExitAreaYesNoInput;
  }
}

function Task_HandleFieldMoveExitAreaYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: // Yes
      gPartyMenu.exitCallback = CB2_ReturnToField;
      Task_ClosePartyMenu(taskId);
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1: // No
      gFieldCallback2.fn = undefined;
      gPostMenuFieldCallback = null;
      Task_ReturnToChooseMonAfterText(taskId);
      break;
  }
}

/**
 * FieldCallback_PrepareFadeInFromMenu (gFieldCallback2) + Task_FieldMoveWaitForFade: fade the field in,
 * then gFieldEffectArguments[0] = the mon's species and gPostMenuFieldCallback. The field holds its
 * controls until then; the callback's field effect locks them itself.
 */
export function FieldCallback_PrepareFadeInFromMenu(field: FieldCallbackHost): () => boolean {
  const faded = field.fadeInFromBlack();
  return () => {
    if (!faded()) return false; // IsWeatherNotFadingIn
    gFieldEffectArguments[0] = GetFieldMoveMonSpecies();
    const callback = gPostMenuFieldCallback;
    gPostMenuFieldCallback = null;
    callback?.();
    return true;
  };
}

function GetFieldMoveMonSpecies(): number {
  return state.party[gPartyMenu.slotId]?.species ?? 0;
}

function Task_CancelAfterAorBPress(taskId: number): void {
  if (gMain.newKeys & A_BUTTON || gMain.newKeys & B_BUTTON) CursorCB_Cancel1(taskId);
}

function DisplayCantUseFlashMessage(): void {
  if (state.getFlag('FLAG_SYS_FLASH_ACTIVE')) DisplayPartyMenuStdMessage(K.PARTY_MSG_ALREADY_IN_USE);
  else DisplayPartyMenuStdMessage(K.PARTY_MSG_CANT_USE_HERE);
}

function DisplayCantUseSurfMessage(): void {
  if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING)) {
    DisplayPartyMenuStdMessage(K.PARTY_MSG_ALREADY_SURFING);
  } else {
    const { x, y } = GetXYCoordsOneStepInFrontOfPlayer();
    const f = avatarField();
    const mapId = f.mapId();
    if (f.behaviors.is(f.behaviorAt(x, y), 'FAST_WATER')) DisplayPartyMenuStdMessage(K.PARTY_MSG_CURRENT_TOO_FAST);
    else if (mapId === 'MAP_ROUTE17' || mapId === 'MAP_ROUTE18') DisplayPartyMenuStdMessage(K.PARTY_MSG_ENJOY_CYCLING);
    else DisplayPartyMenuStdMessage(K.PARTY_MSG_CANT_SURF_HERE);
  }
}

// ------------------------------------------------------------------ fldeff_softboiled.c

/** SetUpFieldMove_SoftBoiled: the user needs more than a fifth of its max HP. */
function SetUpFieldMove_SoftBoiled(): boolean {
  const mon = P(GetCursorSelectionMonId());
  return mon.hp > Math.floor(mon.maxHP / 5);
}

function ChooseMonForSoftboiled(taskId: number): void {
  gPartyMenu.action = K.PARTY_ACTION_SOFTBOILED;
  gPartyMenu.slotId2 = gPartyMenu.slotId;
  AnimatePartySlot(GetCursorSelectionMonId(), 1);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_USE_ON_WHICH_MON);
  gTasks[taskId].func = Task_HandleChooseMonInput;
}

function Task_TryUseSoftboiledOnPartyMon(taskId: number): void {
  const userPartyId = gPartyMenu.slotId;
  const recipientPartyId = gPartyMenu.slotId2;
  if (recipientPartyId > K.PARTY_SIZE) {
    gPartyMenu.action = K.PARTY_ACTION_CHOOSE_MON;
    DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
    return;
  }
  const recipient = P(recipientPartyId);
  const curHp = recipient.hp;
  if (curHp === 0 || userPartyId === recipientPartyId || recipient.maxHP === curHp) {
    CantUseSoftboiledOnMon(taskId);
  } else {
    PlaySE(K.SE_USE_ITEM);
    PartyMenuModifyHP(taskId, userPartyId, -1, Math.floor(P(userPartyId).maxHP / 5), Task_SoftboiledRestoreHealth);
  }
}

function Task_SoftboiledRestoreHealth(taskId: number): void {
  PlaySE(K.SE_USE_ITEM);
  PartyMenuModifyHP(taskId, gPartyMenu.slotId2, 1, Math.floor(P(gPartyMenu.slotId).maxHP / 5), Task_Softboiled_DisplayHPRestoredMessage);
}

/** fldeff_softboiled.c's (static) Task_DisplayHPRestoredMessage */
function Task_Softboiled_DisplayHPRestoredMessage(taskId: number): void {
  gStringVar1.set(GetMonNickname(P(gPartyMenu.slotId2)));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnHPRestoredByVar2')), false);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_FinishSoftboiled;
}

function Task_FinishSoftboiled(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    gPartyMenu.action = K.PARTY_ACTION_CHOOSE_MON;
    AnimatePartySlot(gPartyMenu.slotId, 0);
    gPartyMenu.slotId = gPartyMenu.slotId2;
    AnimatePartySlot(gPartyMenu.slotId2, 1);
    ClearStdWindowAndFrameToTransparent(6, false);
    ClearWindowTilemap(6);
    DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
  }
}

function Task_ChooseNewMonForSoftboiled(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    DisplayPartyMenuStdMessage(K.PARTY_MSG_USE_ON_WHICH_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
  }
}

function CantUseSoftboiledOnMon(taskId: number): void {
  PlaySE(K.SE_SELECT);
  DisplayPartyMenuMessage(text('gText_CantBeUsedOnPkmn'), false);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_ChooseNewMonForSoftboiled;
}

export function CB2_ShowPartyMenuForItemUse(): void {
  let callback: MainCallback = CB2_ReturnToBagMenu;
  let partyLayout: number;
  let menuType: number;
  let msgId: number;
  let task: TaskFunc;
  if (gMain.inBattle) {
    menuType = K.PARTY_MENU_TYPE_IN_BATTLE;
    partyLayout = GetPartyLayoutFromBattleType();
  } else {
    menuType = K.PARTY_MENU_TYPE_FIELD;
    partyLayout = K.PARTY_LAYOUT_SINGLE;
  }
  if (GetItemEffectType(SpecialVar.ItemId) === K.ITEM_EFFECT_SACRED_ASH) {
    gPartyMenu.slotId = 0;
    for (let i = 0; i < K.PARTY_SIZE; ++i) {
      if (partySpecies(i) !== K.SPECIES_NONE && P(i).hp === 0) {
        gPartyMenu.slotId = i;
        break;
      }
    }
    task = Task_SetSacredAshCB;
    msgId = K.PARTY_MSG_NONE;
  } else {
    switch (GetPocketByItemId(SpecialVar.ItemId)) {
      default:
        msgId = K.PARTY_MSG_USE_ON_WHICH_MON;
        break;
      case K.POCKET_TM_CASE:
        msgId = K.PARTY_MSG_TEACH_WHICH_MON;
        callback = CB2_ReturnToTMCaseMenu;
        break;
      case K.POCKET_BERRY_POUCH:
        msgId = K.PARTY_MSG_USE_ON_WHICH_MON;
        callback = CB2_ReturnToBerryPouchMenu;
        break;
    }
    task = Task_HandleChooseMonInput;
  }
  InitPartyMenu(menuType, partyLayout, K.PARTY_ACTION_USE_ITEM, true, msgId, task, callback);
}

function CB2_ReturnToBagMenu(): void {
  GoToBagMenu(K.ITEMMENULOCATION_LAST, K.OPEN_BAG_LAST, null);
}

/** CB2_ReturnToTMCaseMenu */
function CB2_ReturnToTMCaseMenu(): void {
  InitTMCase(TMCASE_REOPENING, null, TMCASE_KEEP_PREV);
}

/** CB2_ReturnToBerryPouchMenu */
function CB2_ReturnToBerryPouchMenu(): void {
  InitBerryPouch(BERRYPOUCH_NA, null, BERRYPOUCH_KEEP_PREV);
}

function Task_DoUseItemAnim(taskId: number): void {
  internal().exitCallback = CB2_DoUseItemAnim;
  Task_ClosePartyMenu(taskId);
}

/**
 * CB2_DoUseItemAnim: StartUseItemAnim_Normal / _CantEvolve (pokemon_special_anim.c) aren't
 * implemented, so the animation is skipped and its callback runs at once.
 */
function CB2_DoUseItemAnim(): void {
  if (CheckIfItemIsTMHMOrEvolutionStone(SpecialVar.ItemId) === 2) {
    // Evolution stone
    if (MonCanEvolve()) SetMainCallback2(CB2_UseEvolutionStone);
    else SetMainCallback2(gPartyMenu.exitCallback);
  } else {
    SetMainCallback2(CB2_UseItem);
  }
}

function CB2_UseItem(): void {
  // PSA_IsCancelDisabled() is FALSE without the item-use animation
  InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, K.PARTY_ACTION_CHOOSE_MON, gPartyMenu.slotId !== 0, K.PARTY_MSG_NONE, Task_SetSacredAshCB, gPartyMenu.exitCallback);
}

function Task_SetSacredAshCB(taskId: number): void {
  if (!gPaletteFade.active) {
    if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) internal().exitCallback = CB2_SetUpExitToBattleScreen;
    gItemUseCB!(taskId, Task_ClosePartyMenuAfterText); // ItemUseCB_SacredAsh in this case
  }
}

/** gItemEffectTable[item - ITEM_POTION] (or the Enigma Berry's, which isn't modelled: all zero) */
function itemEffect(item: number): number[] {
  return itemEffectTable(item) ?? new Array(8).fill(0);
}

function IsHPRecoveryItem(item: number): boolean {
  return (itemEffect(item)[4] & K.ITEM4_HEAL_HP) !== 0;
}

function GetMedicineItemEffectMessage(item: number): void {
  switch (GetItemEffectType(item)) {
    case K.ITEM_EFFECT_CURE_POISON:
      ExpandToStringVar4(text('gText_PkmnCuredOfPoison'));
      break;
    case K.ITEM_EFFECT_CURE_SLEEP:
      ExpandToStringVar4(text('gText_PkmnWokeUp2'));
      break;
    case K.ITEM_EFFECT_CURE_BURN:
      ExpandToStringVar4(text('gText_PkmnBurnHealed'));
      break;
    case K.ITEM_EFFECT_CURE_FREEZE:
      ExpandToStringVar4(text('gText_PkmnThawedOut'));
      break;
    case K.ITEM_EFFECT_CURE_PARALYSIS:
      ExpandToStringVar4(text('gText_PkmnCuredOfParalysis'));
      break;
    case K.ITEM_EFFECT_CURE_CONFUSION:
      ExpandToStringVar4(text('gText_PkmnSnappedOutOfConfusion'));
      break;
    case K.ITEM_EFFECT_CURE_INFATUATION:
      ExpandToStringVar4(text('gText_PkmnGotOverInfatuation'));
      break;
    case K.ITEM_EFFECT_CURE_ALL_STATUS:
      ExpandToStringVar4(text('gText_PkmnBecameHealthy'));
      break;
    case K.ITEM_EFFECT_HP_EV:
      gStringVar2.set(text('gText_ItemEffect_HP'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_ATK_EV:
      gStringVar2.set(text('gText_ItemEffect_Attack'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_DEF_EV:
      gStringVar2.set(text('gText_ItemEffect_Defense'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_SPEED_EV:
      gStringVar2.set(text('gText_ItemEffect_Speed'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_SPATK_EV:
      gStringVar2.set(text('gText_ItemEffect_SpAtk'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_SPDEF_EV:
      gStringVar2.set(text('gText_ItemEffect_SpDef'));
      ExpandToStringVar4(text('gText_PkmnBaseVar2StatIncreased'));
      break;
    case K.ITEM_EFFECT_PP_UP:
    case K.ITEM_EFFECT_PP_MAX:
      ExpandToStringVar4(text('gText_MovesPPIncreased'));
      break;
    case K.ITEM_EFFECT_HEAL_PP:
      ExpandToStringVar4(text('gText_PPWasRestored'));
      break;
    default:
      ExpandToStringVar4(text('gText_WontHaveEffect'));
      break;
  }
}

function NotUsingHPEVItemOnShedinja(mon: Pokemon, item: number): boolean {
  return !(GetItemEffectType(item) === K.ITEM_EFFECT_HP_EV && mon.species === K.SPECIES_SHEDINJA);
}

function IsItemFlute(item: number): boolean {
  return item === K.ITEM_BLUE_FLUTE || item === K.ITEM_RED_FLUTE || item === K.ITEM_YELLOW_FLUTE;
}

function ExecuteTableBasedItemEffect_(partyMonIndex: number, item: number, monMoveIndex: number): boolean {
  if (gMain.inBattle) return ExecuteTableBasedItemEffect(P(partyMonIndex), item, getPartyIdFromBattleSlot(partyMonIndex), monMoveIndex);
  return ExecuteTableBasedItemEffect(P(partyMonIndex), item, partyMonIndex, monMoveIndex);
}

export function ItemUseCB_Medicine(taskId: number, func: TaskFunc): void {
  const mon = P(gPartyMenu.slotId);
  const item = SpecialVar.ItemId;
  let canHeal: boolean;
  if (!NotUsingHPEVItemOnShedinja(mon, item)) {
    canHeal = true;
  } else {
    canHeal = PokemonItemUseNoEffect(mon, item, gPartyMenu.slotId, 0);
  }
  PlaySE(K.SE_SELECT);
  if (canHeal) {
    gPartyMenuUseExitCallback = false;
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = func;
  } else {
    Task_DoUseItemAnim(taskId);
    gItemUseCB = ItemUseCB_MedicineStep;
  }
}

export function ItemUseCB_MedicineStep(taskId: number, func: TaskFunc): void {
  let hp = 0;
  const mon = P(gPartyMenu.slotId);
  const item = SpecialVar.ItemId;
  let canHeal = false;
  let cannotHeal: boolean;
  if (NotUsingHPEVItemOnShedinja(mon, item) === false) {
    cannotHeal = true;
  } else {
    canHeal = IsHPRecoveryItem(item);
    if (canHeal) {
      hp = mon.hp;
      if (hp === mon.maxHP) canHeal = false;
    }
    cannotHeal = ExecuteTableBasedItemEffect_(gPartyMenu.slotId, item, 0);
  }
  if (cannotHeal) {
    gPartyMenuUseExitCallback = false;
    PlaySE(K.SE_SELECT);
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = func;
  } else {
    gPartyMenuUseExitCallback = true;
    if (!IsItemFlute(item)) {
      PlaySE(K.SE_USE_ITEM);
      if (gPartyMenu.action !== K.PARTY_ACTION_REUSABLE_ITEM) RemoveBagItem(item, 1);
    } else {
      PlaySE(K.SE_GLASS_FLUTE);
    }
    SetPartyMonAilmentGfx(mon, boxes()[gPartyMenu.slotId]);
    if (gSprites[boxes()[gPartyMenu.slotId].statusSpriteId].invisible) DisplayPartyPokemonLevelCheck(mon, boxes()[gPartyMenu.slotId], 1);
    if (canHeal) {
      if (hp === 0) AnimatePartySlot(gPartyMenu.slotId, 1);
      PartyMenuModifyHP(taskId, gPartyMenu.slotId, 1, mon.hp - hp, Task_DisplayHPRestoredMessage);
      ResetHPTaskData(taskId, hp);
    } else {
      gStringVar1.set(GetMonNickname(mon));
      GetMedicineItemEffectMessage(item);
      DisplayPartyMenuMessage(gStringVar4, true);
      ScheduleBgCopyTilemapToVram(2);
      gTasks[taskId].func = func;
    }
  }
}

function Task_DisplayHPRestoredMessage(taskId: number): void {
  gStringVar1.set(GetMonNickname(P(gPartyMenu.slotId)));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnHPRestoredByVar2')), false);
  ScheduleBgCopyTilemapToVram(2);
  HandleBattleLowHpMusicChange();
  gTasks[taskId].func = Task_ClosePartyMenuAfterText;
}

function Task_ClosePartyMenuAfterText(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    if (gPartyMenuUseExitCallback === false) internal().exitCallback = null;
    Task_ClosePartyMenu(taskId);
  }
}

function ShowMoveSelectWindow(slot: number): void {
  let moveCount = 0;
  const fontId = K.FONT_NORMAL;
  const windowId = DisplaySelectionWindow(K.SELECTWINDOW_MOVES);
  for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
    const move = P(slot).moves[i] ?? K.MOVE_NONE;
    AddTextPrinterParameterized(windowId, fontId, moveName(move), GetFontAttribute(fontId, FONTATTR_MAX_LETTER_WIDTH) + GetFontAttribute(fontId, FONTATTR_LETTER_SPACING), i * 16 + 2, TEXT_SKIP_DRAW);
    if (move !== K.MOVE_NONE) ++moveCount;
  }
  Menu_InitCursor(windowId, fontId, 0, 2, 16, moveCount, 0);
  ScheduleBgCopyTilemapToVram(2);
}

function Task_HandleRestoreWhichMoveInput(taskId: number): void {
  const input = Menu_ProcessInput();
  if (input !== MENU_NOTHING_CHOSEN) {
    if (input === MENU_B_PRESSED) {
      PlaySE(K.SE_SELECT);
      ReturnToUseOnWhichMon(taskId);
    } else {
      SetSelectedMoveForPPItem(taskId);
    }
  }
}

export function ItemUseCB_TryRestorePP(taskId: number, _func: TaskFunc): void {
  const item = SpecialVar.ItemId;
  if (!(itemEffect(item)[4] & K.ITEM4_HEAL_PP_ONE)) {
    gPartyMenu.ppMoveSlot = 0;
    if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) TryUsePPItemInBattle(taskId);
    else TryUsePPItemOutsideBattle(taskId);
  } else {
    PlaySE(K.SE_SELECT);
    DisplayPartyMenuStdMessage(K.PARTY_MSG_RESTORE_WHICH_MOVE);
    ShowMoveSelectWindow(gPartyMenu.slotId);
    gTasks[taskId].func = Task_HandleRestoreWhichMoveInput;
  }
}

function SetSelectedMoveForPPItem(taskId: number): void {
  PartyMenuRemoveWindow(0);
  gPartyMenu.ppMoveSlot = Menu_GetCursorPos();
  if (gPartyMenu.menuType === K.PARTY_MENU_TYPE_IN_BATTLE) TryUsePPItemInBattle(taskId);
  else TryUsePPItemOutsideBattle(taskId);
}

function ReturnToUseOnWhichMon(taskId: number): void {
  gTasks[taskId].func = Task_HandleChooseMonInput;
  internal().exitCallback = null;
  PartyMenuRemoveWindow(0);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_USE_ON_WHICH_MON);
}

function TryUsePPItemOutsideBattle(taskId: number): void {
  const noEffect = PokemonItemUseNoEffect(P(gPartyMenu.slotId), SpecialVar.ItemId, gPartyMenu.slotId, gPartyMenu.ppMoveSlot);
  PlaySE(K.SE_SELECT);
  if (noEffect) {
    gPartyMenuUseExitCallback = false;
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = Task_ClosePartyMenuAfterText;
  } else {
    Task_DoUseItemAnim(taskId);
    gItemUseCB = ItemUseCB_RestorePP;
  }
}

function ItemUseCB_RestorePP(taskId: number, _func: TaskFunc): void {
  const mon = P(gPartyMenu.slotId);
  ExecuteTableBasedItemEffect_(gPartyMenu.slotId, SpecialVar.ItemId, gPartyMenu.ppMoveSlot & 0xff);
  gPartyMenuUseExitCallback = true;
  PlaySE(K.SE_USE_ITEM);
  RemoveBagItem(SpecialVar.ItemId, 1);
  const move = mon.moves[gPartyMenu.ppMoveSlot];
  gStringVar1.set(moveName(move));
  GetMedicineItemEffectMessage(SpecialVar.ItemId);
  DisplayPartyMenuMessage(gStringVar4, true);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_ClosePartyMenuAfterText;
}

function TryUsePPItemInBattle(taskId: number): void {
  const item = SpecialVar.ItemId;
  if (ExecuteTableBasedItemEffect_(gPartyMenu.slotId, item, gPartyMenu.ppMoveSlot)) {
    gPartyMenuUseExitCallback = false;
    PlaySE(K.SE_SELECT);
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = Task_ClosePartyMenuAfterText;
  } else {
    gPartyMenuUseExitCallback = true;
    const mon = P(gPartyMenu.slotId);
    PlaySE(K.SE_USE_ITEM);
    RemoveBagItem(item, 1);
    gStringVar1.set(moveName(mon.moves[gPartyMenu.ppMoveSlot]));
    GetMedicineItemEffectMessage(item);
    DisplayPartyMenuMessage(gStringVar4, true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = Task_ClosePartyMenuAfterText;
  }
}

export function ItemUseCB_PPUp(taskId: number, _func: TaskFunc): void {
  PlaySE(K.SE_SELECT);
  DisplayPartyMenuStdMessage(K.PARTY_MSG_BOOST_PP_WHICH_MOVE);
  ShowMoveSelectWindow(gPartyMenu.slotId);
  gTasks[taskId].func = Task_HandleRestoreWhichMoveInput;
}

export function ItemIdToBattleMoveId(item: number): number {
  return menusData.tmhmMoves[item - K.ITEM_TM01_FOCUS_PUNCH];
}

export function IsMoveHm(move: number): boolean {
  for (let i = 0; i < K.NUM_HIDDEN_MACHINES - 1; ++i) {
    // no dive
    if (menusData.tmhmMoves[i + K.NUM_TECHNICAL_MACHINES] === move) return true;
  }
  return false;
}

export function MonKnowsMove(mon: Pokemon, move: number): boolean {
  for (let i = 0; i < K.MAX_MON_MOVES; ++i) if (mon.moves[i] === move) return true;
  return false;
}

function DisplayLearnMoveMessage(str: number[]): void {
  DisplayPartyMenuMessage(ExpandToStringVar4(str), true);
  ScheduleBgCopyTilemapToVram(2);
}

function DisplayLearnMoveMessageAndClose(taskId: number, str: number[]): void {
  DisplayLearnMoveMessage(str);
  gTasks[taskId].func = Task_ClosePartyMenuAfterText;
}

export function ItemUseCB_TMHM(taskId: number, _func: TaskFunc): void {
  PlaySE(K.SE_SELECT);
  const mon = P(gPartyMenu.slotId);
  const item = SpecialVar.ItemId;
  gStringVar1.set(GetMonNickname(mon));
  gPartyMenu.learnMoveId = ItemIdToBattleMoveId(item);
  gStringVar2.set(moveName(gPartyMenu.learnMoveId));
  gPartyMenu.learnMoveMethod = LEARN_VIA_TMHM;
  switch (CanMonLearnTMTutor(mon, item, 0)) {
    case CANNOT_LEARN_MOVE:
      DisplayLearnMoveMessageAndClose(taskId, text('gText_PkmnCantLearnMove'));
      return;
    case ALREADY_KNOWS_MOVE:
      DisplayLearnMoveMessageAndClose(taskId, text('gText_PkmnAlreadyKnows'));
      return;
  }
  if (giveMoveToMon(mon, gPartyMenu.learnMoveId) !== K.MON_HAS_MAX_MOVES) {
    Task_DoUseItemAnim(taskId);
    gItemUseCB = ItemUseCB_LearnedMove;
  } else {
    DisplayLearnMoveMessage(text('gText_PkmnNeedsToReplaceMove'));
    gTasks[taskId].func = Task_ReplaceMoveYesNo;
  }
}

function ItemUseCB_LearnedMove(taskId: number, _func: TaskFunc): void {
  Task_LearnedMove(taskId);
}

function Task_LearnedMove(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  const item = SpecialVar.ItemId;
  if (gPartyMenu.learnMoveMethod === LEARN_VIA_TMHM) {
    adjustFriendship(mon, K.FRIENDSHIP_EVENT_LEARN_TMHM);
    if (item < K.ITEM_HM01) RemoveBagItem(item, 1);
  }
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(moveName(gPartyMenu.learnMoveId));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnLearnedMove3')), true);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_DoLearnedMoveFanfareAfterText;
}

function Task_DoLearnedMoveFanfareAfterText(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PlayFanfare(K.MUS_LEVEL_UP);
    gTasks[taskId].func = Task_LearnNextMoveOrClosePartyMenu;
  }
}

function Task_LearnNextMoveOrClosePartyMenu(taskId: number): void {
  if (IsFanfareTaskInactive() && (gMain.newKeys & A_BUTTON || gMain.newKeys & B_BUTTON)) {
    if (gPartyMenu.learnMoveMethod === LEARN_VIA_LEVEL_UP) {
      Task_TryLearningNextMove(taskId);
    } else {
      if (gPartyMenu.learnMoveMethod === LEARN_VIA_TUTOR) SpecialVar.Result = 1;
      Task_ClosePartyMenu(taskId);
    }
  }
}

function Task_ReplaceMoveYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleReplaceMoveYesNoInput;
  }
}

function Task_HandleReplaceMoveYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: // Yes
      DisplayPartyMenuMessage(text('gText_WhichMoveToForget'), true);
      gTasks[taskId].func = Task_ShowSummaryScreenToForgetMove;
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1: // No
      StopLearningMovePrompt(taskId);
      break;
  }
}

function Task_ShowSummaryScreenToForgetMove(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    internal().exitCallback = CB2_ShowSummaryScreenToForgetMove;
    Task_ClosePartyMenu(taskId);
  }
}

function CB2_ShowSummaryScreenToForgetMove(): void {
  ShowSelectMovePokemonSummaryScreen(state.party, gPartyMenu.slotId, CalculatePlayerPartyCount() - 1, CB2_ReturnToPartyMenuWhileLearningMove, gPartyMenu.learnMoveId);
}

function CB2_ReturnToPartyMenuWhileLearningMove(): void {
  const moveIdx = GetMoveSlotToReplace();
  const learnMethod = gPartyMenu.learnMoveMethod;

  if (learnMethod === LEARN_VIA_TMHM && moveIdx !== K.MAX_MON_MOVES) {
    // StartUseItemAnim_ForgetMoveAndLearnTMorHM (pokemon_special_anim.c) isn't implemented: its
    // callback runs at once.
    gItemUseCB = ItemUseCB_ReplaceMoveWithTMHM;
    gPartyMenu.action = K.PARTY_ACTION_CHOOSE_MON;
    SetMainCallback2(CB2_UseTMHMAfterForgettingMove);
  } else
    InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_MON, true, K.PARTY_MSG_NONE, Task_ReturnToPartyMenuWhileLearningMove, gPartyMenu.exitCallback);
}

/** CB2_UseTMHMAfterForgettingMove: PSA_IsCancelDisabled() is FALSE without the animation. */
function CB2_UseTMHMAfterForgettingMove(): void {
  InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, gPartyMenu.slotId !== 0, K.PARTY_MSG_NONE, Task_SetSacredAshCB, gPartyMenu.exitCallback);
}

function ItemUseCB_ReplaceMoveWithTMHM(taskId: number, _func: TaskFunc): void {
  Task_ReplaceMoveWithTMHM(taskId);
}

function Task_ReplaceMoveWithTMHM(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  const moveIdx = GetMoveSlotToReplace();
  const move = mon.moves[moveIdx];
  // ItemUse_SetQuestLogEvent: no quest log
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(moveName(move));
  removeMonPPBonus(mon, moveIdx);
  setMonMoveSlot(mon, gPartyMenu.learnMoveId, moveIdx);
  Task_LearnedMove(taskId);
}

function Task_ReturnToPartyMenuWhileLearningMove(taskId: number): void {
  if (!gPaletteFade.active) {
    if (GetMoveSlotToReplace() !== K.MAX_MON_MOVES) DisplayPartyMenuForgotMoveMessage(taskId);
    else StopLearningMovePrompt(taskId);
  }
}

function DisplayPartyMenuForgotMoveMessage(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(moveName(mon.moves[GetMoveSlotToReplace()]));
  DisplayLearnMoveMessage(text('gText_12PoofForgotMove'));
  gTasks[taskId].func = Task_PartyMenuReplaceMove;
}

function Task_PartyMenuReplaceMove(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    const mon = P(gPartyMenu.slotId);
    removeMonPPBonus(mon, GetMoveSlotToReplace());
    setMonMoveSlot(mon, gPartyMenu.learnMoveId, GetMoveSlotToReplace());
    Task_LearnedMove(taskId);
  }
}

function StopLearningMovePrompt(taskId: number): void {
  gStringVar2.set(moveName(gPartyMenu.learnMoveId));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_StopLearningMove2')), true);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_StopLearningMoveYesNo;
}

function Task_StopLearningMoveYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleStopLearningMoveYesNoInput;
  }
}

function Task_HandleStopLearningMoveYesNoInput(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: // Yes
      gStringVar1.set(GetMonNickname(mon));
      gStringVar2.set(moveName(gPartyMenu.learnMoveId));
      DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_MoveNotLearned')), true);
      if (gPartyMenu.learnMoveMethod === LEARN_VIA_LEVEL_UP) {
        gTasks[taskId].func = Task_TryLearningNextMoveAfterText;
      } else {
        if (gPartyMenu.learnMoveMethod === LEARN_VIA_TUTOR) SpecialVar.Result = 0;
        gTasks[taskId].func = Task_ClosePartyMenuAfterText;
      }
      break;
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1: // No
      gStringVar1.set(GetMonNickname(mon));
      gStringVar2.set(moveName(gPartyMenu.learnMoveId));
      DisplayLearnMoveMessage(text('gText_PkmnNeedsToReplaceMove'));
      gTasks[taskId].func = Task_ReplaceMoveYesNo;
      break;
  }
}

function Task_TryLearningNextMoveAfterText(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) Task_TryLearningNextMove(taskId);
}

export function ItemUseCB_RareCandy(taskId: number, func: TaskFunc): void {
  const mon = P(gPartyMenu.slotId);
  const item = SpecialVar.ItemId;
  const noEffect = mon.level !== K.MAX_LEVEL ? PokemonItemUseNoEffect(mon, item, gPartyMenu.slotId, 0) : true;
  PlaySE(K.SE_SELECT);
  if (noEffect) {
    gPartyMenuUseExitCallback = false;
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = func;
  } else {
    Task_DoUseItemAnim(taskId);
    gItemUseCB = ItemUseCB_RareCandyStep;
  }
}

function ItemUseCB_RareCandyStep(taskId: number, _func: TaskFunc): void {
  const mon = P(gPartyMenu.slotId);
  const arr = internal().data;
  arr.set(GetMonLevelUpWindowStats(mon), 0);
  ExecuteTableBasedItemEffect_(gPartyMenu.slotId, SpecialVar.ItemId, 0);
  arr.set(GetMonLevelUpWindowStats(mon), K.NUM_STATS);
  gPartyMenuUseExitCallback = true;
  PlayFanfareByFanfareNum(K.FANFARE_LEVEL_UP);
  UpdateMonDisplayInfoAfterRareCandy(gPartyMenu.slotId, mon);
  RemoveBagItem(SpecialVar.ItemId, 1);
  gStringVar1.set(GetMonNickname(mon));
  gStringVar2.set(ConvertIntToDecimalStringN(mon.level, STR_CONV_MODE_LEFT_ALIGN, 3));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnElevatedToLvVar2')), true);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_DisplayLevelUpStatsPg1;
}

function UpdateMonDisplayInfoAfterRareCandy(slot: number, mon: Pokemon): void {
  const b = boxes()[slot];
  SetPartyMonAilmentGfx(mon, b);
  if (gSprites[b.statusSpriteId].invisible) DisplayPartyPokemonLevelCheck(mon, b, DRAW_MENU_BOX_AND_TEXT);
  DisplayPartyPokemonHPCheck(mon, b, DRAW_MENU_BOX_AND_TEXT);
  DisplayPartyPokemonMaxHPCheck(mon, b, DRAW_MENU_BOX_AND_TEXT);
  DisplayPartyPokemonHPBarCheck(mon, b);
  UpdatePartyMonHPBar(b.monSpriteId, mon);
  AnimatePartySlot(slot, 1);
  ScheduleBgCopyTilemapToVram(0);
}

function Task_DisplayLevelUpStatsPg1(taskId: number): void {
  if (WaitFanfare(false) && !IsPartyMenuTextPrinterActive() && (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON))) {
    PlaySE(K.SE_SELECT);
    DisplayLevelUpStatsPg1();
    gTasks[taskId].func = Task_DisplayLevelUpStatsPg2;
  }
}

function Task_DisplayLevelUpStatsPg2(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DisplayLevelUpStatsPg2();
    gTasks[taskId].func = Task_TryLearnNewMoves;
  }
}

function DisplayLevelUpStatsPg1(): void {
  const arr = internal().data;
  arr[12] = CreateLevelUpStatsWindow();
  DrawLevelUpWindowPg1(arr[12], arr.subarray(0, 6), arr.subarray(6, 12), K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(arr[12], COPYWIN_GFX);
  ScheduleBgCopyTilemapToVram(2);
}

function DisplayLevelUpStatsPg2(): void {
  const arr = internal().data;
  DrawLevelUpWindowPg2(arr[12], arr.subarray(6, 12), K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(arr[12], COPYWIN_GFX);
  ScheduleBgCopyTilemapToVram(2);
}

function Task_TryLearnNewMoves(taskId: number): void {
  if (WaitFanfare(false) && (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON))) {
    RemoveLevelUpStatsWindow();
    const learnMove = monTryLearningNewMove(P(gPartyMenu.slotId), true);
    gPartyMenu.learnMoveMethod = LEARN_VIA_LEVEL_UP;
    switch (learnMove) {
      case K.MOVE_NONE: // No moves to learn
        PartyMenuTryEvolution(taskId);
        break;
      case K.MON_HAS_MAX_MOVES:
        DisplayMonNeedsToReplaceMove(taskId);
        break;
      case K.MON_ALREADY_KNOWS_MOVE:
        gTasks[taskId].func = Task_TryLearningNextMove;
        break;
      default:
        DisplayMonLearnedMove(taskId, learnMove);
        break;
    }
  }
}

function Task_TryLearningNextMove(taskId: number): void {
  const result = monTryLearningNewMove(P(gPartyMenu.slotId), false);
  switch (result) {
    case K.MOVE_NONE: // No moves to learn
      PartyMenuTryEvolution(taskId);
      break;
    case K.MON_HAS_MAX_MOVES:
      DisplayMonNeedsToReplaceMove(taskId);
      break;
    case K.MON_ALREADY_KNOWS_MOVE:
      return;
    default:
      DisplayMonLearnedMove(taskId, result);
      break;
  }
}

function PartyMenuTryEvolution(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  const targetSpecies = GetEvolutionTargetSpecies(mon, K.EVO_MODE_NORMAL, K.ITEM_NONE);
  if (targetSpecies !== K.SPECIES_NONE) {
    FreePartyPointers();
    setCB2_AfterEvolution(gPartyMenu.exitCallback);
    BeginEvolutionScene(mon, targetSpecies, 1, gPartyMenu.slotId);
    DestroyTask(taskId);
  } else {
    gTasks[taskId].func = Task_ClosePartyMenuAfterText;
  }
}

function DisplayMonNeedsToReplaceMove(taskId: number): void {
  gStringVar1.set(GetMonNickname(P(gPartyMenu.slotId)));
  gStringVar2.set(moveName(g.moveToLearn));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnNeedsToReplaceMove')), true);
  ScheduleBgCopyTilemapToVram(2);
  gPartyMenu.learnMoveId = g.moveToLearn;
  gTasks[taskId].func = Task_ReplaceMoveYesNo;
}

function DisplayMonLearnedMove(taskId: number, move: number): void {
  gStringVar1.set(GetMonNickname(P(gPartyMenu.slotId)));
  gStringVar2.set(moveName(move));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnLearnedMove3')), true);
  ScheduleBgCopyTilemapToVram(2);
  gPartyMenu.learnMoveId = move;
  gTasks[taskId].func = Task_DoLearnedMoveFanfareAfterText;
}

// sPartyMenuInternal->data for Sacred Ash
const tUsedOnSlot = 0;
const tHadEffect = 1;
const tLastSlotUsed = 2;

export function ItemUseCB_SacredAsh(taskId: number, _func: TaskFunc): void {
  internal().data[tUsedOnSlot] = 0;
  internal().data[tHadEffect] = 0;
  internal().data[tLastSlotUsed] = gPartyMenu.slotId;
  UseSacredAsh(taskId);
}

function UseSacredAsh(taskId: number): void {
  const mon = partyMon(gPartyMenu.slotId);
  if (!mon || mon.species === K.SPECIES_NONE) {
    gTasks[taskId].func = Task_SacredAshLoop;
    return;
  }
  const hp = mon.hp;
  if (ExecuteTableBasedItemEffect_(gPartyMenu.slotId, SpecialVar.ItemId, 0)) {
    gTasks[taskId].func = Task_SacredAshLoop;
    return;
  }
  PlaySE(K.SE_USE_ITEM);
  SetPartyMonAilmentGfx(mon, boxes()[gPartyMenu.slotId]);
  if (gSprites[boxes()[gPartyMenu.slotId].statusSpriteId].invisible) DisplayPartyPokemonLevelCheck(mon, boxes()[gPartyMenu.slotId], DRAW_MENU_BOX_AND_TEXT);
  AnimatePartySlot(internal().data[tLastSlotUsed], 0);
  AnimatePartySlot(gPartyMenu.slotId, 1);
  PartyMenuModifyHP(taskId, gPartyMenu.slotId, 1, mon.hp - hp, Task_SacredAshDisplayHPRestored);
  ResetHPTaskData(taskId, hp);
  internal().data[tUsedOnSlot] = 1;
  internal().data[tHadEffect] = 1;
}

function Task_SacredAshLoop(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    if (internal().data[tUsedOnSlot] === 1) {
      internal().data[tUsedOnSlot] = 0;
      internal().data[tLastSlotUsed] = gPartyMenu.slotId;
    }
    if (++gPartyMenu.slotId === K.PARTY_SIZE) {
      if (internal().data[tHadEffect] === 0) {
        gPartyMenuUseExitCallback = false;
        DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
        ScheduleBgCopyTilemapToVram(2);
      } else {
        gPartyMenuUseExitCallback = true;
        RemoveBagItem(SpecialVar.ItemId, 1);
      }
      gTasks[taskId].func = Task_ClosePartyMenuAfterText;
      gPartyMenu.slotId = 0;
    } else {
      UseSacredAsh(taskId);
    }
  }
}

function Task_SacredAshDisplayHPRestored(taskId: number): void {
  gStringVar1.set(GetMonNickname(P(gPartyMenu.slotId)));
  DisplayPartyMenuMessage(ExpandToStringVar4(text('gText_PkmnHPRestoredByVar2')), false);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_SacredAshLoop;
}

export function ItemUseCB_EvolutionStone(taskId: number, func: TaskFunc): void {
  PlaySE(K.SE_SELECT);
  const noEffect = PokemonItemUseNoEffect(P(gPartyMenu.slotId), SpecialVar.ItemId, gPartyMenu.slotId, 0);
  if (noEffect) {
    gPartyMenuUseExitCallback = false;
    DisplayPartyMenuMessage(text('gText_WontHaveEffect'), true);
    ScheduleBgCopyTilemapToVram(2);
    gTasks[taskId].func = func;
  } else {
    Task_DoUseItemAnim(taskId);
  }
}

/** CB2_UseEvolutionStone: ExecuteTableBasedItemEffect starts the evolution scene. */
function CB2_UseEvolutionStone(): void {
  setCB2_AfterEvolution(gPartyMenu.exitCallback);
  ExecuteTableBasedItemEffect_(gPartyMenu.slotId, SpecialVar.ItemId, 0);
  // ItemUse_SetQuestLogEvent: no quest log
  RemoveBagItem(SpecialVar.ItemId, 1);
}

function MonCanEvolve(): boolean {
  return !(!IsNationalPokedexEnabled(state) && GetEvolutionTargetSpecies(P(gPartyMenu.slotId), K.EVO_MODE_ITEM_USE, SpecialVar.ItemId) > K.KANTO_DEX_COUNT);
}

export function GetItemEffectType(item: number): number {
  if (!(item >= K.ITEM_POTION && item <= K.MAX_BERRY_INDEX)) return K.ITEM_EFFECT_NONE;
  // Read the item's effect properties.
  const e = itemEffect(item);
  if (e[0] & (K.ITEM0_DIRE_HIT | K.ITEM0_X_ATTACK) || e[1] || e[2] || e[3] & K.ITEM3_GUARD_SPEC) return K.ITEM_EFFECT_X_ITEM;
  if (e[0] & K.ITEM0_SACRED_ASH) return K.ITEM_EFFECT_SACRED_ASH;
  if (e[3] & K.ITEM3_LEVEL_UP) return K.ITEM_EFFECT_RAISE_LEVEL;
  const statusCure = e[3] & K.ITEM3_STATUS_ALL;
  if (statusCure || e[0] >> 7) {
    if (statusCure === K.ITEM3_SLEEP) return K.ITEM_EFFECT_CURE_SLEEP;
    if (statusCure === K.ITEM3_POISON) return K.ITEM_EFFECT_CURE_POISON;
    if (statusCure === K.ITEM3_BURN) return K.ITEM_EFFECT_CURE_BURN;
    if (statusCure === K.ITEM3_FREEZE) return K.ITEM_EFFECT_CURE_FREEZE;
    if (statusCure === K.ITEM3_PARALYSIS) return K.ITEM_EFFECT_CURE_PARALYSIS;
    if (statusCure === K.ITEM3_CONFUSION) return K.ITEM_EFFECT_CURE_CONFUSION;
    if (e[0] >> 7 && !statusCure) return K.ITEM_EFFECT_CURE_INFATUATION;
    return K.ITEM_EFFECT_CURE_ALL_STATUS;
  }
  if (e[4] & (K.ITEM4_REVIVE | K.ITEM4_HEAL_HP)) return K.ITEM_EFFECT_HEAL_HP;
  if (e[4] & K.ITEM4_EV_ATK) return K.ITEM_EFFECT_ATK_EV;
  if (e[4] & K.ITEM4_EV_HP) return K.ITEM_EFFECT_HP_EV;
  if (e[5] & K.ITEM5_EV_SPATK) return K.ITEM_EFFECT_SPATK_EV;
  if (e[5] & K.ITEM5_EV_SPDEF) return K.ITEM_EFFECT_SPDEF_EV;
  if (e[5] & K.ITEM5_EV_SPEED) return K.ITEM_EFFECT_SPEED_EV;
  if (e[5] & K.ITEM5_EV_DEF) return K.ITEM_EFFECT_DEF_EV;
  if (e[4] & K.ITEM4_EVO_STONE) return K.ITEM_EFFECT_EVO_STONE;
  if (e[4] & K.ITEM4_PP_UP) return K.ITEM_EFFECT_PP_UP;
  if (e[5] & K.ITEM5_PP_MAX) return K.ITEM_EFFECT_PP_MAX;
  if (e[4] & (K.ITEM4_HEAL_PP_ALL | K.ITEM4_HEAL_PP_ONE)) return K.ITEM_EFFECT_HEAL_PP;
  return K.ITEM_EFFECT_NONE;
}

function TryTutorSelectedMon(taskId: number): void {
  if (!gPaletteFade.active) {
    const mon = P(gPartyMenu.slotId);
    gStringVar1.set(GetMonNickname(mon));
    gPartyMenu.learnMoveId = GetTutorMove(SpecialVar.x8005);
    gStringVar2.set(moveName(gPartyMenu.learnMoveId));
    gPartyMenu.learnMoveMethod = LEARN_VIA_TUTOR;
    switch (CanMonLearnTMTutor(mon, 0, SpecialVar.x8005)) {
      case CANNOT_LEARN_MOVE:
        DisplayLearnMoveMessageAndClose(taskId, text('gText_PkmnCantLearnMove'));
        return;
      case ALREADY_KNOWS_MOVE:
        DisplayLearnMoveMessageAndClose(taskId, text('gText_PkmnAlreadyKnows'));
        return;
      default:
        if (giveMoveToMon(mon, gPartyMenu.learnMoveId) !== K.MON_HAS_MAX_MOVES) {
          Task_LearnedMove(taskId);
          return;
        }
        break;
    }
    DisplayLearnMoveMessage(text('gText_PkmnNeedsToReplaceMove'));
    gTasks[taskId].func = Task_ReplaceMoveYesNo;
  }
}

export function CB2_PartyMenuFromStartMenu(): void {
  InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_MON, false, K.PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput, CB2_ReturnToFieldWithOpenMenu);
}

/** Giving an item by selecting Give from the bag menu (as opposed to Give in the party menu) */
export function CB2_ChooseMonToGiveItem(): void {
  let callback: MainCallback;
  switch (GetPocketByItemId(SpecialVar.ItemId)) {
    default:
      callback = CB2_ReturnToBagMenu;
      break;
    case K.POCKET_TM_CASE:
      callback = CB2_ReturnToTMCaseMenu;
      break;
    case K.POCKET_BERRY_POUCH:
      callback = CB2_ReturnToBerryPouchMenu;
      break;
  }
  InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_GIVE_ITEM, false, K.PARTY_MSG_GIVE_TO_WHICH_MON, Task_HandleChooseMonInput, callback);
  gPartyMenu.bagItem = SpecialVar.ItemId;
}

function TryGiveItemOrMailToSelectedMon(taskId: number): void {
  sPartyMenuItemId = P(gPartyMenu.slotId).heldItem;
  if (sPartyMenuItemId === K.ITEM_NONE) {
    GiveItemOrMailToSelectedMon(taskId);
  } else if (ItemIsMail(sPartyMenuItemId)) {
    DisplayItemMustBeRemovedFirstMessage(taskId);
  } else {
    DisplayAlreadyHoldingItemSwitchMessage(P(gPartyMenu.slotId), sPartyMenuItemId, true);
    gTasks[taskId].func = Task_SwitchItemsFromBagYesNo;
  }
}

function GiveItemOrMailToSelectedMon(taskId: number): void {
  if (ItemIsMail(gPartyMenu.bagItem)) {
    RemoveItemToGiveFromBag(gPartyMenu.bagItem);
    internal().exitCallback = CB2_WriteMailToGiveMonFromBag;
    Task_ClosePartyMenu(taskId);
  } else {
    GiveItemToSelectedMon(taskId);
  }
}

function GiveItemToSelectedMon(taskId: number): void {
  if (!gPaletteFade.active) {
    const item = gPartyMenu.bagItem;
    DisplayGaveHeldItemMessage(P(gPartyMenu.slotId), item, false);
    GiveItemToMon(P(gPartyMenu.slotId), item);
    RemoveItemToGiveFromBag(item);
    gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
  }
}

function Task_UpdateHeldItemSpriteAndClosePartyMenu(taskId: number): void {
  const slot = gPartyMenu.slotId;
  if (!IsPartyMenuTextPrinterActive()) {
    UpdatePartyMonHeldItemSprite(P(slot), boxes()[slot]);
    Task_ClosePartyMenu(taskId);
  }
}

function CB2_WriteMailToGiveMonFromBag(): void {
  GiveItemToMon(P(gPartyMenu.slotId), gPartyMenu.bagItem);
  const mail = GetMonMailId(state.defines, P(gPartyMenu.slotId));
  DoEasyChatScreen(K.EASY_CHAT_TYPE_MAIL, mailWords(mail), CB2_ReturnToPartyOrBagMenuFromWritingMail);
}

function CB2_ReturnToPartyOrBagMenuFromWritingMail(): void {
  const mon = P(gPartyMenu.slotId);
  const item = mon.heldItem;
  if (state.getVar('VAR_RESULT') === 0) {
    // Canceled writing mail
    TakeMailFromMon(state, mon);
    mon.heldItem = sPartyMenuItemId;
    RemoveBagItem(sPartyMenuItemId, 1);
    ReturnGiveItemToBagOrPC(item);
    SetMainCallback2(gPartyMenu.exitCallback);
  } else {
    // Wrote mail
    InitPartyMenu(gPartyMenu.menuType, K.KEEP_PARTY_LAYOUT, gPartyMenu.action, true, K.PARTY_MSG_NONE, Task_DisplayGaveMailFromBagMessage, gPartyMenu.exitCallback);
  }
}

function Task_DisplayGaveMailFromBagMessage(taskId: number): void {
  if (!gPaletteFade.active) {
    if (sPartyMenuItemId !== K.ITEM_NONE) DisplaySwitchedHeldItemMessage(gPartyMenu.bagItem, sPartyMenuItemId, false);
    else DisplayGaveHeldItemMessage(P(gPartyMenu.slotId), gPartyMenu.bagItem, false);
    gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
  }
}

function Task_SwitchItemsFromBagYesNo(taskId: number): void {
  if (!IsPartyMenuTextPrinterActive()) {
    PartyMenuDisplayYesNoMenu();
    gTasks[taskId].func = Task_HandleSwitchItemsFromBagYesNoInput;
  }
}

function Task_HandleSwitchItemsFromBagYesNoInput(taskId: number): void {
  switch (Menu_ProcessInputNoWrapClearOnChoose()) {
    case 0: {
      // Yes, switch items
      const item = gPartyMenu.bagItem;
      RemoveItemToGiveFromBag(item);
      if (AddBagItem(sPartyMenuItemId, 1) === false) {
        ReturnGiveItemToBagOrPC(item);
        BufferBagFullCantTakeItemMessage(sPartyMenuItemId);
        DisplayPartyMenuMessage(gStringVar4, false);
        gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
      } else if (ItemIsMail(item)) {
        internal().exitCallback = CB2_WriteMailToGiveMonFromBag;
        Task_ClosePartyMenu(taskId);
      } else {
        GiveItemToMon(P(gPartyMenu.slotId), item);
        DisplaySwitchedHeldItemMessage(item, sPartyMenuItemId, true);
        gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
      }
      break;
    }
    case MENU_B_PRESSED:
      PlaySE(K.SE_SELECT);
    // fallthrough
    case 1: // No, don't switch items
      gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
      break;
  }
}

function DisplayItemMustBeRemovedFirstMessage(taskId: number): void {
  DisplayPartyMenuMessage(text('gText_RemoveMailBeforeItem'), true);
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
}

/** RemoveItemToGiveFromBag: the item PC's GIVE (item_pc.c) gives from the PC's items. */
function RemoveItemToGiveFromBag(item: number): void {
  if (gPartyMenu.action === K.PARTY_ACTION_GIVE_PC_ITEM) RemovePCItem(state.pcItems, K.ITEM_NONE, item, 1);
  else RemoveBagItem(item, 1);
}

/** Returns FALSE if there was no space to return the item (there always should be). */
function ReturnGiveItemToBagOrPC(item: number): boolean {
  if (gPartyMenu.action === K.PARTY_ACTION_GIVE_ITEM) return AddBagItem(item, 1);
  return AddPCItem(state.pcItems, K.ITEM_NONE, item, 1);
}

export function InitChooseMonsForBattle(chooseMonsBattleType: number): void {
  ClearSelectedPartyOrder();
  InitPartyMenu(K.PARTY_MENU_TYPE_CHOOSE_MULTIPLE_MONS, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_MON, false, K.PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput, gMain.savedCallback);
  gPartyMenu.chooseMonsBattleType = chooseMonsBattleType;
  gPartyMenu.task = Task_ValidateChosenMonsForBattle;
}

export function ClearSelectedPartyOrder(): void {
  gSelectedOrderFromParty.fill(0);
}

function GetPartySlotEntryStatus(slot: number): number {
  if (!GetBattleEntryEligibility(P(slot))) return 2; // Not eligible
  if (HasPartySlotAlreadyBeenSelected(slot + 1)) return 1; // Already selected
  return 0; // Eligible, not selected
}

function GetBattleEntryEligibility(mon: Pokemon): boolean {
  if (mon.isEgg) return false;
  switch (gPartyMenu.chooseMonsBattleType) {
    default:
      if (mon.level > 30) return false;
      break;
    case K.CHOOSE_MONS_FOR_CABLE_CLUB_BATTLE:
      if (mon.hp === 0) return false;
      break;
    case K.CHOOSE_MONS_FOR_BATTLE_TOWER:
      console.warn('[party_menu] the Battle Tower is not implemented');
      break;
  }
  return true;
}

function CheckBattleEntriesAndGetMessage(): number {
  const order = gSelectedOrderFromParty;
  switch (gPartyMenu.chooseMonsBattleType) {
    case K.CHOOSE_MONS_FOR_BATTLE_TOWER: {
      if (order[2] === 0) return K.PARTY_MSG_THREE_MONS_ARE_NEEDED;
      for (let i = 0; i < 2; ++i) {
        const species = P(order[i] - 1).species;
        const heldItem = P(order[i] - 1).heldItem;
        for (let j = i + 1; j < 3; ++j) {
          if (species === P(order[j] - 1).species) return K.PARTY_MSG_MONS_CANT_BE_SAME;
          if (heldItem !== K.ITEM_NONE && heldItem === P(order[j] - 1).heldItem) return K.PARTY_MSG_NO_SAME_HOLD_ITEMS;
        }
      }
      break;
    }
    case K.CHOOSE_MONS_FOR_UNION_ROOM_BATTLE:
      if (order[1] === 0) return K.PARTY_MSG_TWO_MONS_ARE_NEEDED;
      break;
  }
  return 0xff;
}

function HasPartySlotAlreadyBeenSelected(slot: number): boolean {
  return gSelectedOrderFromParty.includes(slot);
}

function Task_ValidateChosenMonsForBattle(taskId: number): void {
  const msgId = CheckBattleEntriesAndGetMessage();
  if (msgId !== 0xff) {
    PlaySE(K.SE_FAILURE);
    DisplayPartyMenuStdMessage(msgId);
    gTasks[taskId].func = Task_ContinueChoosingMonsForBattle;
  } else if (gSelectedOrderFromParty[0] !== 0) {
    PlaySE(K.SE_SELECT);
    Task_ClosePartyMenu(taskId);
  } else {
    PlaySE(K.SE_FAILURE);
    DisplayPartyMenuStdMessage(K.PARTY_MSG_NO_MON_FOR_BATTLE);
    gTasks[taskId].func = Task_ContinueChoosingMonsForBattle;
  }
}

function Task_ContinueChoosingMonsForBattle(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DisplayPartyMenuStdMessage(K.PARTY_MSG_CHOOSE_MON);
    gTasks[taskId].func = Task_HandleChooseMonInput;
  }
}

export function ChooseMonForMoveTutor(): void {
  if (SpecialVar.x8005 < K.TUTOR_MOVE_COUNT) {
    InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_MOVE_TUTOR, false, K.PARTY_MSG_TEACH_WHICH_MON, Task_HandleChooseMonInput, CB2_ReturnToFieldContinueScriptPlayMapMusic);
  } else {
    InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_MOVE_TUTOR, false, K.PARTY_MSG_NONE, TryTutorSelectedMon, CB2_ReturnToFieldContinueScriptPlayMapMusic);
    gPartyMenu.slotId = SpecialVar.x8007;
  }
}

function GetPartyLayoutFromBattleType(): number {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) return K.PARTY_LAYOUT_SINGLE;
  if (IsMultiBattle()) return K.PARTY_LAYOUT_MULTI;
  return K.PARTY_LAYOUT_DOUBLE;
}

export function OpenPartyMenuInTutorialBattle(partyAction: number): void {
  if (!btlCtrlOakOldManTestState2Flag(K.FIRST_BATTLE_MSG_FLAG_PARTY_MENU) && g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) {
    InitPartyMenu(K.PARTY_MENU_TYPE_IN_BATTLE, GetPartyLayoutFromBattleType(), partyAction, false, K.PARTY_MSG_NONE, Task_FirstBattleEnterParty_WaitFadeIn, SetCB2ToReshowScreenAfterMenu);
    BtlCtrl_OakOldMan_SetState2Flag(K.FIRST_BATTLE_MSG_FLAG_PARTY_MENU);
  } else {
    InitPartyMenu(K.PARTY_MENU_TYPE_IN_BATTLE, GetPartyLayoutFromBattleType(), partyAction, false, K.PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput, SetCB2ToReshowScreenAfterMenu);
  }
  // ReshowBattleScreenDummy
  UpdatePartyToBattleOrder();
}

export function EnterPartyFromItemMenuInBattle(): void {
  if (!btlCtrlOakOldManTestState2Flag(K.FIRST_BATTLE_MSG_FLAG_PARTY_MENU) && g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) {
    InitPartyMenu(K.PARTY_MENU_TYPE_IN_BATTLE, GetPartyLayoutFromBattleType(), K.PARTY_ACTION_USE_ITEM, false, K.PARTY_MSG_NONE, Task_FirstBattleEnterParty_WaitFadeIn, CB2_BagMenuFromBattle);
    BtlCtrl_OakOldMan_SetState2Flag(K.FIRST_BATTLE_MSG_FLAG_PARTY_MENU);
  } else {
    const callback: MainCallback = GetPocketByItemId(SpecialVar.ItemId) === K.POCKET_BERRY_POUCH ? CB2_ReturnToBerryPouchMenu : CB2_BagMenuFromBattle;
    InitPartyMenu(K.PARTY_MENU_TYPE_IN_BATTLE, GetPartyLayoutFromBattleType(), K.PARTY_ACTION_USE_ITEM, false, K.PARTY_MSG_USE_ON_WHICH_MON, Task_HandleChooseMonInput, callback);
  }
  // ReshowBattleScreenDummy
  UpdatePartyToBattleOrder();
}

function GetPartyMenuActionsTypeInBattle(mon: Pokemon): number {
  if (partySpecies(1) === K.SPECIES_NONE || mon.isEgg) return ACTIONS_SUMMARY_ONLY;
  if (gPartyMenu.action === K.PARTY_ACTION_SEND_OUT) return ACTIONS_SEND_OUT;
  return ACTIONS_SHIFT;
}

function TrySwitchInPokemon(): boolean {
  const slot = GetCursorSelectionMonId();
  // In a multi battle, slots 1, 4, and 5 are the partner's pokemon
  if (IsMultiBattle() && (slot === 1 || slot === 4 || slot === 5)) {
    console.warn('[party_menu] multi battles are not implemented');
    ExpandToStringVar4(text('gText_CantSwitchWithAlly'));
    return false;
  }
  if (P(slot).hp === 0) {
    gStringVar1.set(GetMonNickname(P(slot)));
    ExpandToStringVar4(text('gText_PkmnHasNoEnergy'));
    return false;
  }
  for (let i = 0; i < g.battlersCount; ++i) {
    if (getBattlerSide(i) === K.B_SIDE_PLAYER && getPartyIdFromBattleSlot(slot) === g.battlerPartyIndexes[i]) {
      gStringVar1.set(GetMonNickname(P(slot)));
      ExpandToStringVar4(text('gText_PkmnAlreadyInBattle'));
      return false;
    }
  }
  if (P(slot).isEgg) {
    ExpandToStringVar4(text('gText_EggCantBattle'));
    return false;
  }
  if (getPartyIdFromBattleSlot(slot) === g.battleStruct.playerPartyIdx) {
    gStringVar1.set(GetMonNickname(P(slot)));
    ExpandToStringVar4(text('gText_PkmnAlreadySelected'));
    return false;
  }
  if (gPartyMenu.action === K.PARTY_ACTION_ABILITY_PREVENTS) {
    SetMonPreventsSwitchingString();
    return false;
  }
  if (gPartyMenu.action === K.PARTY_ACTION_CANT_SWITCH) {
    const currBattler = g.battlerInMenuId;
    gStringVar1.set(GetMonNickname(P(getPartyIdFromBattlePartyId(g.battlerPartyIndexes[currBattler]))));
    ExpandToStringVar4(text('gText_PkmnCantSwitchOut'));
    return false;
  }
  gSelectedMonPartyId = getPartyIdFromBattleSlot(slot);
  gPartyMenuUseExitCallback = true;
  const newSlot = getPartyIdFromBattlePartyId(g.battlerPartyIndexes[g.battlerInMenuId]);
  switchPartyMonSlots(newSlot, slot);
  SwapPartyPokemon(newSlot, slot);
  return true;
}

/** SetMonPreventsSwitchingString (pokemon.c) */
function SetMonPreventsSwitchingString(): void {
  const bs = g.battleStruct;
  g.lastUsedAbility = bs.abilityPreventingSwitchout;
  const b1 = g.battleTextBuff1;
  b1[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
  b1[1] = K.B_BUFF_MON_NICK_WITH_PREFIX;
  b1[2] = bs.battlerPreventingSwitchout;
  b1[4] = K.B_BUFF_EOS;
  if (getBattlerSide(bs.battlerPreventingSwitchout) === K.B_SIDE_PLAYER) b1[3] = getPartyIdFromBattlePartyId(g.battlerPartyIndexes[bs.battlerPreventingSwitchout]);
  else b1[3] = g.battlerPartyIndexes[bs.battlerPreventingSwitchout];
  // PREPARE_MON_NICK_WITH_PREFIX_BUFFER(gBattleTextBuff2, gBattlerInMenuId, ...)
  const b2 = g.battleTextBuff2;
  b2[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
  b2[1] = K.B_BUFF_MON_NICK_WITH_PREFIX;
  b2[2] = g.battlerInMenuId;
  b2[3] = getPartyIdFromBattlePartyId(g.battlerPartyIndexes[g.battlerInMenuId]);
  b2[4] = K.B_BUFF_EOS;
  setStringVar4(battleStringExpandPlaceholders(encodeBattleText('gText_PkmnsXPreventsSwitching')));
}

/** Rebuild gPlayerParty in place from six slots (empty slots stay at the end). */
function setPartySlots(slots: (Pokemon | undefined)[]): void {
  const party = state.party;
  const n = slots.findIndex((m) => m === undefined);
  const count = n < 0 ? slots.length : n;
  if (slots.slice(count).some((m) => m !== undefined)) console.warn('[party_menu] party order left a gap');
  party.length = 0;
  for (let i = 0; i < count; i++) party.push(slots[i]!);
}

function UpdatePartyToBattleOrder(): void {
  const partyBuffer = Array.from({ length: K.PARTY_SIZE }, (_, i) => state.party[i]);
  const out: (Pokemon | undefined)[] = new Array(K.PARTY_SIZE);
  for (let i = 0; i < K.PARTY_SIZE; ++i) out[getPartyIdFromBattlePartyId(i)] = partyBuffer[i];
  setPartySlots(out);
}

function UpdatePartyToFieldOrder(): void {
  const partyBuffer = Array.from({ length: K.PARTY_SIZE }, (_, i) => state.party[i]);
  const out: (Pokemon | undefined)[] = new Array(K.PARTY_SIZE);
  for (let i = 0; i < K.PARTY_SIZE; ++i) out[getPartyIdFromBattleSlot(i)] = partyBuffer[i];
  setPartySlots(out);
}

function CB2_SetUpExitToBattleScreen(): void {
  CB2_SetUpReshowBattleScreenAfterMenu();
  SetMainCallback2(SetCB2ToReshowScreenAfterMenu);
}

/**
 * ChooseMonToGiveMailFromMailbox (the player's PC mailbox's GIVE): the party menu gives the mailbox's selected mail
 * (gPlayerPcMenuManager) to the chosen mon, then leaves through `callback` (Mailbox_ReturnToMailListAfterDeposit:
 * CB2_ReturnToField with the mailbox's field callback, which the field host sets).
 */
export function ChooseMonToGiveMailFromMailbox(callback: MainCallback): void {
  InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_GIVE_MAILBOX_MAIL, false, K.PARTY_MSG_GIVE_TO_WHICH_MON, Task_HandleChooseMonInput, callback);
}

/**
 * TryGiveMailToSelectedMon: the mailbox's selected mail (PC slot cursorPos + itemsAbove) into a party mail slot for
 * the chosen mon (GiveMailToMon2) and cleared in the PC, or "This POKéMON is holding an item..." if it holds one.
 */
function TryGiveMailToSelectedMon(taskId: number): void {
  const mon = P(gPartyMenu.slotId);
  gPartyMenuUseExitCallback = false;
  const mail = state.mail[gPlayerPcMenuManager.cursorPos + K.PARTY_SIZE + gPlayerPcMenuManager.itemsAbove];
  if (mon.heldItem !== K.ITEM_NONE) {
    DisplayPartyMenuMessage(text('gText_PkmnHoldingItemCantHoldMail'), true);
  } else {
    GiveMailToMon2(state, mon, mail);
    ClearMailStruct(state.defines, mail);
    DisplayPartyMenuMessage(text('gText_MailTransferredFromMailbox'), true);
  }
  ScheduleBgCopyTilemapToVram(2);
  gTasks[taskId].func = Task_UpdateHeldItemSpriteAndClosePartyMenu;
}

export function ChooseMonForDaycare(): void {
  gFieldCallback2.fn = CB2_FadeFromPartyMenu;
  InitPartyMenu(K.PARTY_MENU_TYPE_DAYCARE, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_MON, false, K.PARTY_MSG_CHOOSE_MON_2, Task_HandleChooseMonInput, CB2_ReturnToField);
}

export function ChoosePartyMonByMenuType(menuType: number): void {
  gFieldCallback2.fn = CB2_FadeFromPartyMenu;
  InitPartyMenu(menuType, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_AND_CLOSE, false, K.PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput, CB2_ReturnToField);
}

/**
 * CB2_FadeFromPartyMenu (gFieldCallback2 after ChoosePartyMonByMenuType): FadeInFromBlack, then
 * Task_PartyMenuWaitForFade's UnlockPlayerFieldControls + ScriptContext_Enable once it's over.
 */
function CB2_FadeFromPartyMenu(field: FieldCallbackHost): () => boolean {
  return field.fadeInFromBlack();
}

/** CB2_ReturnToPartyMenuFromFlyMap: the fly map closed without a destination. */
export function CB2_ReturnToPartyMenuFromFlyMap(): void {
  InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_CHOOSE_MON, true, K.PARTY_MSG_CHOOSE_MON, Task_HandleChooseMonInput, CB2_ReturnToFieldWithOpenMenu);
}
