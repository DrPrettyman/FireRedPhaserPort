// learn_move.c: the move relearner (Two Island's Move Maniac, `special TeachMoveRelearnerMove`). A list of the
// level-up moves the mon (VAR_0x8004) has forgotten or skipped, the selected move's type, power, accuracy, PP and
// description, "Teach X?" / "Give up?" YES/NO prompts, and, with four moves known, the "forget a move" flow
// through the summary screen (ShowSelectMovePokemonSummaryScreen, back through CB2_MoveRelearner_Resume).
// VAR_0x8004 comes back TRUE if a move was taught, FALSE if the player gave up. Plus pokemon.c's
// GetMoveRelearnerMoves / GetNumberOfRelearnableMoves, which the party menu's PARTY_MENU_TYPE_MOVE_RELEARNER
// branch uses. The SEs and the level-up fanfare go through gba/sound.ts (the fanfare holds the screen for its
// sFanfares count; nothing is audible before the mixer, AUDIO_PLAN.md W-m4a 3).

import { K } from '../battle/constants';
import { gBattleMoves, gSpeciesInfo, state } from '../battle/env';
import { moveName } from '../battle/message';
import { giveMoveToMon, removeMonPPBonus, setMonMoveSlot } from '../battle/pokemonBattle';
import { Sin } from '../battle/trig';
import { CopyBgTilemapBufferToVram, CopyToBgTilemapBuffer, FillBgTilemapBufferRect, InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { REG_OFFSET_BG0HOFS, REG_OFFSET_BG0VOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
import { BlitMenuInfoIcon, gMultiuseListMenuTemplate, ListMenu_ProcessInput, ListMenuGetScrollAndRow, ListMenuInit, ListMenuLoadStdPalAt, type ListMenu, type ListMenuItem, type ListMenuTemplate } from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { CreateYesNoMenu, DrawTextBorderOuter, GetTextSpeedSetting, LoadUserWindowGfx, Menu_ProcessInputNoWrapClearOnChoose, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, FillPalette, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { IsFanfareTaskInactive, PlayFanfare, PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  ClearWindowTilemap,
  COPYWIN_FULL,
  COPYWIN_GFX,
  COPYWIN_MAP,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RunTextPrinters,
  type WindowTemplate,
} from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { ConvertIntToDecimalStringN, encodeRaw, ExpandToStringVar4, GetMonNickname, gStringVar1, gStringVar2, gStringVar3, STR_CONV_MODE_LEFT_ALIGN, STR_CONV_MODE_RIGHT_ALIGN, text } from './common';
import { menusData } from './data';
import { CB2_ReturnToField } from './fieldCallbacks';
import { SpecialVar } from './itemMenuState';
import { ShowSelectMovePokemonSummaryScreen } from './summaryScreen';

// ------------------------------------------------------------------ pokemon.c

/**
 * GetMoveRelearnerMoves: the level-up moves at or below the mon's level that it doesn't know, in learnset order,
 * without duplicates (the first MAX_LEVEL_UP_MOVES learnset entries).
 */
export function GetMoveRelearnerMoves(mon: Pokemon): number[] {
  const moves: number[] = [];
  const learnset = gSpeciesInfo[mon.species].learnset;
  for (let i = 0; i < K.MAX_LEVEL_UP_MOVES && i < learnset.length; i++) {
    const [moveLevel, move] = learnset[i];
    if (moveLevel <= mon.level && !mon.moves.slice(0, K.MAX_MON_MOVES).includes(move) && !moves.includes(move)) moves.push(move);
  }
  return moves;
}

/** GetNumberOfRelearnableMoves: GetMoveRelearnerMoves' count, 0 for an egg. */
export function GetNumberOfRelearnableMoves(mon: Pokemon): number {
  if (mon.isEgg) return 0; // MON_DATA_SPECIES_OR_EGG == SPECIES_EGG
  return GetMoveRelearnerMoves(mon).length;
}

// ------------------------------------------------------------------ learn_move.c

const MENU_STATE_FADE_TO_BLACK = 0;
const MENU_STATE_WAIT_FOR_FADE = 1;
const MENU_STATE_UNREACHABLE = 2;
const MENU_STATE_SETUP_BATTLE_MODE = 3;
const MENU_STATE_IDLE_BATTLE_MODE = 4;
const MENU_STATE_PRINT_TEACH_MOVE_PROMPT = 8;
const MENU_STATE_TEACH_MOVE_CONFIRM = 9;
const MENU_STATE_PRINT_GIVE_UP_PROMPT = 12;
const MENU_STATE_GIVE_UP_CONFIRM = 13;
const MENU_STATE_FADE_AND_RETURN = 14;
const MENU_STATE_RETURN_TO_FIELD = 15;
const MENU_STATE_PRINT_TRYING_TO_LEARN_PROMPT = 16;
const MENU_STATE_WAIT_FOR_TRYING_TO_LEARN = 17;
const MENU_STATE_CONFIRM_DELETE_OLD_MOVE = 18;
const MENU_STATE_PRINT_WHICH_MOVE_PROMPT = 19;
const MENU_STATE_SHOW_MOVE_SUMMARY_SCREEN = 20;
const MENU_STATE_PRINT_STOP_TEACHING = 24;
const MENU_STATE_WAIT_FOR_STOP_TEACHING = 25;
const MENU_STATE_CONFIRM_STOP_TEACHING = 26;
const MENU_STATE_CHOOSE_SETUP_STATE = 27;
const MENU_STATE_FADE_FROM_SUMMARY_SCREEN = 28;
const MENU_STATE_TRY_OVERWRITE_MOVE = 29;
const MENU_STATE_DOUBLE_FANFARE_FORGOT_MOVE = 30;
const MENU_STATE_PRINT_TEXT_THEN_FANFARE = 31;
const MENU_STATE_WAIT_FOR_FANFARE = 32;
const MENU_STATE_WAIT_FOR_A_BUTTON = 33;

/** The list item index of CANCEL. */
const CANCEL_INDEX = 0xfe;

/** struct LearnMoveGfxResources (only the fields the code reads) */
interface MoveRelearner {
  state: number;
  spriteIds: [number, number];
  /** Never changes (the C never writes it), so the up arrow stays hidden. */
  scrollPositionMaybe: number;
  numLearnableMoves: number;
  listMenuItems: ListMenuItem[];
  learnableMoves: number[];
  listMenuStrbufs: number[][];
  scheduleMoveInfoUpdate: boolean;
  selectedPartyMember: number;
  selectedMoveSlot: number;
  listMenuTaskId: number;
  bg1TilemapBuffer: Uint16Array;
  textColor: number[];
  selectedIndex: number;
  listMenuScrollPos: number;
  listMenuScrollRow: number;
}

let sMoveRelearner: MoveRelearner | null = null;
const R = (): MoveRelearner => sMoveRelearner!;

/** Every graphic the relearner loads beyond what prepareMenus does (runScreenFromScript preloads them). */
export const LEARN_MOVE_GFX = [
  'gMoveRelearner_Gfx',
  'gMoveRelearner_Tilemap',
  'gMoveRelearner_Pal',
  'sLearnMoveInterfaceSpritesTiles',
  'sLearnMoveInterfaceSpritesPalette',
  'gMenuInfoElements_Gfx',
  'gMenuInfoElements2_Pal',
];

const TAG_SCROLL_INDICATORS = 5525;
const TAG_SCROLL_INDICATORS_PAL = 5526;

/** sSpriteTemplate_MoveRelearnerListMenuScrollIndicators (16x8; anim 0 = down arrow, 1 = up arrow) */
const sSpriteTemplate_MoveRelearnerListMenuScrollIndicators: SpriteTemplate = {
  tileTag: TAG_SCROLL_INDICATORS,
  paletteTag: TAG_SCROLL_INDICATORS_PAL,
  oam: oam({ shape: SPRITE_SHAPE['16x8'][0], size: SPRITE_SHAPE['16x8'][1] }),
  anims: [
    [ANIMCMD_FRAME(4, 5), ANIMCMD_END], // sAnimCmd_ScrollIndicatorDown
    [ANIMCMD_FRAME(6, 5), ANIMCMD_END], // sAnimCmd_ScrollIndicatorUp
  ],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_ListMenuScrollIndicators,
};

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 8, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 0, tilemapTop: 0, width: 6, height: 7, paletteNum: 13, baseBlock: 0x014 }, // labels: TYPE, PP, EFFECT
  { bg: 0, tilemapLeft: 10, tilemapTop: 0, width: 5, height: 5, paletteNum: 13, baseBlock: 0x03e }, // labels: POWER, ACCURACY
  { bg: 0, tilemapLeft: 5, tilemapTop: 0, width: 5, height: 2, paletteNum: 13, baseBlock: 0x057 }, // type icon
  { bg: 0, tilemapLeft: 15, tilemapTop: 0, width: 3, height: 5, paletteNum: 15, baseBlock: 0x061 }, // power, accuracy
  { bg: 0, tilemapLeft: 5, tilemapTop: 2, width: 3, height: 3, paletteNum: 15, baseBlock: 0x070 }, // PP
  { bg: 0, tilemapLeft: 2, tilemapTop: 6, width: 15, height: 8, paletteNum: 15, baseBlock: 0x079 }, // description
  { bg: 0, tilemapLeft: 19, tilemapTop: 1, width: 10, height: 12, paletteNum: 15, baseBlock: 0x0f1 }, // the list
  { bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 15, baseBlock: 0x169 }, // messages
  DUMMY_WIN_TEMPLATE,
];

const sMoveRelearnerYesNoMenuTemplate: WindowTemplate = { bg: 0, tilemapLeft: 21, tilemapTop: 8, width: 6, height: 4, paletteNum: 15, baseBlock: 0x1d1 };

const sMoveRelearnerListMenuTemplate: ListMenuTemplate = {
  items: [],
  moveCursorFunc: MoveRelearnerMenu_MoveCursorFunc,
  itemPrintFunc: null,
  totalItems: 0,
  maxShowed: 7,
  windowId: 6,
  header_X: 0,
  item_X: 8,
  cursor_X: 0,
  upText_Y: 0,
  cursorPal: 2,
  fillValue: 1,
  cursorShadowPal: 3,
  lettersSpacing: 1,
  itemVerticalPadding: 0,
  scrollMultiple: 0,
  fontId: 0, // FONT_NORMAL: K isn't filled in when this module loads, so MoveRelearnerInitListMenuBuffersEtc sets it
  cursorKind: 0,
};

function VBlankCB_MoveRelearner(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/**
 * The script side of TeachMoveRelearnerMove (LockPlayerFieldControls, the fade to black, Task_InitMoveRelearnerMenu
 * waiting for it) is the special in menus/partyMenuSpecials.ts; this is what the task hands over to. The C's
 * gFieldCallback = FieldCB_ContinueScriptHandleMusic is the field's default return here (fade in, the script's
 * `waitstate` ends).
 */
export function StartMoveRelearner(): void {
  SetMainCallback2(CB2_MoveRelearner_Init);
}

function MoveRelearnerLoadBgGfx(): void {
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  ResetTempTileDataBuffers();
  if (InitWindows(sWindowTemplates)) {
    DeactivateAllTextPrinters();
    for (let i = 0; i < sWindowTemplates.length - 1; i++) {
      ClearWindowTilemap(i);
      FillWindowPixelBuffer(i, PIXEL_FILL(0));
    }
    FillWindowPixelBuffer(7, PIXEL_FILL(1));
    FillBgTilemapBufferRect(0, 0x000, 0, 0, 30, 20, 15);
    SetBgTilemapBuffer(1, R().bg1TilemapBuffer);
    LoadUserWindowGfx(0, 1, BG_PLTT_ID(14));
    ListMenuLoadStdPalAt(BG_PLTT_ID(13), 1);
    LoadPalette(gfx16('gMoveRelearner_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
    const tiles = gfx('gMoveRelearner_Gfx'); // DecompressAndLoadBgGfxUsingHeap
    LoadBgTiles(1, tiles, tiles.length, 0);
    CopyToBgTilemapBuffer(1, gfx16('gMoveRelearner_Tilemap'), 0, 0);
    CopyBgTilemapBufferToVram(1);
    SetGpuReg(REG_OFFSET_BG0VOFS, 0);
    SetGpuReg(REG_OFFSET_BG0HOFS, 0);
    SetGpuReg(REG_OFFSET_BG1VOFS, 0);
    SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  }
}

function CB2_MoveRelearner_Init(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetSpriteData();
  FreeAllSpritePalettes();
  ResetTasks();
  sMoveRelearner = {
    state: 0,
    spriteIds: [0, 0],
    scrollPositionMaybe: 0,
    numLearnableMoves: 0,
    listMenuItems: [],
    learnableMoves: [],
    listMenuStrbufs: [],
    scheduleMoveInfoUpdate: false,
    selectedPartyMember: 0,
    selectedMoveSlot: 0,
    listMenuTaskId: 0,
    bg1TilemapBuffer: new Uint16Array(0x400),
    textColor: [0, 0, 0],
    selectedIndex: 0,
    listMenuScrollPos: 0,
    listMenuScrollRow: 0,
  };
  InitMoveRelearnerStateVariables();
  R().selectedPartyMember = SpecialVar.x8004;
  MoveRelearnerInitListMenuBuffersEtc();
  SetVBlankCallback(VBlankCB_MoveRelearner);
  MoveRelearnerLoadBgGfx();
  SpawnListMenuScrollIndicatorSprites();
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
  SetMainCallback2(CB2_MoveRelearner);
}

function CB2_MoveRelearner_Resume(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetSpriteData();
  FreeAllSpritePalettes();
  ResetTasks();
  MoveRelearnerInitListMenuBuffersEtc();
  R().selectedMoveSlot = SpecialVar.x8005;
  SetVBlankCallback(VBlankCB_MoveRelearner);
  MoveRelearnerLoadBgGfx();
  SpawnListMenuScrollIndicatorSprites();
  FillPalette(RGB_BLACK, 0, 2); // SetBackdropFromColor(RGB_BLACK)
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
  SetMainCallback2(CB2_MoveRelearner);
}

function CB2_MoveRelearner(): void {
  if (!IsTextPrinterActive(7)) MoveRelearnerStateMachine();
  // (the state machine can leave for the summary screen or the field, freeing sMoveRelearner)
  if (sMoveRelearner?.scheduleMoveInfoUpdate) {
    PrintMoveInfoHandleCancel_CopyToVram();
    sMoveRelearner.scheduleMoveInfoUpdate = false;
  }
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function StringExpandPlaceholdersAndPrintTextOnWindow7Color2(str: number[]): void {
  PrintTextOnWindow(7, ExpandToStringVar4(str), 0, 2, GetTextSpeedSetting(), 2);
}

function MoveRelearnerStateMachine(): void {
  const r = R();
  switch (r.state) {
    case MENU_STATE_FADE_TO_BLACK:
      BeginNormalPaletteFade(0xffffffff, 0, 16, 0, RGB_BLACK);
      ShowBg(0);
      ShowBg(1);
      LoadMoveInfoUI();
      r.state++;
      DrawTextBorderOnWindows6and7();
      PrintTeachWhichMoveToStrVar1(false);
      MoveLearnerInitListMenu();
      r.scheduleMoveInfoUpdate = true;
      break;
    case MENU_STATE_WAIT_FOR_FADE:
      if (!gPaletteFade.active) r.state = MENU_STATE_IDLE_BATTLE_MODE;
      break;
    case MENU_STATE_UNREACHABLE:
      r.state++;
      break;
    case MENU_STATE_SETUP_BATTLE_MODE:
      PrintTeachWhichMoveToStrVar1(false);
      r.scheduleMoveInfoUpdate = true;
      r.state++;
      break;
    case MENU_STATE_IDLE_BATTLE_MODE:
      MoveRelearnerMenuHandleInput();
      break;
    case MENU_STATE_PRINT_TEACH_MOVE_PROMPT:
      CreateYesNoMenu(sMoveRelearnerYesNoMenuTemplate, K.FONT_NORMAL_COPY_2, 0, 2, 0x001, 14, 0);
      r.state++;
      break;
    case MENU_STATE_TEACH_MOVE_CONFIRM:
      switch (YesNoMenuProcessInput()) {
        case 0:
          if (giveMoveToMon(state.party[r.selectedPartyMember], r.learnableMoves[r.selectedIndex]) !== K.MON_HAS_MAX_MOVES) {
            StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_MonLearnedMove'));
            SpecialVar.x8004 = 1;
            r.state = MENU_STATE_PRINT_TEXT_THEN_FANFARE;
          } else {
            r.state = MENU_STATE_PRINT_TRYING_TO_LEARN_PROMPT;
          }
          break;
        case 1:
        case -1:
          r.state = MENU_STATE_SETUP_BATTLE_MODE;
          break;
      }
      break;
    case MENU_STATE_PRINT_GIVE_UP_PROMPT:
      CreateYesNoMenu(sMoveRelearnerYesNoMenuTemplate, K.FONT_NORMAL_COPY_2, 0, 2, 0x001, 14, 0);
      r.state++;
      break;
    case MENU_STATE_GIVE_UP_CONFIRM:
      switch (YesNoMenuProcessInput()) {
        case 0:
          SpecialVar.x8004 = 0;
          r.state = MENU_STATE_FADE_AND_RETURN;
          break;
        case 1:
        case -1:
          r.state = MENU_STATE_SETUP_BATTLE_MODE;
          break;
      }
      break;
    case MENU_STATE_PRINT_TRYING_TO_LEARN_PROMPT:
      StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_MonIsTryingToLearnMove'));
      r.state++;
      break;
    case MENU_STATE_WAIT_FOR_TRYING_TO_LEARN:
      CreateYesNoMenu(sMoveRelearnerYesNoMenuTemplate, K.FONT_NORMAL_COPY_2, 0, 2, 0x001, 14, 0);
      r.state = MENU_STATE_CONFIRM_DELETE_OLD_MOVE;
      break;
    case MENU_STATE_CONFIRM_DELETE_OLD_MOVE:
      switch (YesNoMenuProcessInput()) {
        case 0:
          StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_WhichMoveShouldBeForgotten'));
          r.state = MENU_STATE_PRINT_WHICH_MOVE_PROMPT;
          break;
        case 1:
        case -1:
          r.state = MENU_STATE_PRINT_STOP_TEACHING;
          break;
      }
      break;
    case MENU_STATE_PRINT_STOP_TEACHING:
      StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_StopLearningMove'));
      r.state++;
      break;
    case MENU_STATE_WAIT_FOR_STOP_TEACHING:
      CreateYesNoMenu(sMoveRelearnerYesNoMenuTemplate, K.FONT_NORMAL_COPY_2, 0, 2, 0x001, 14, 0);
      r.state = MENU_STATE_CONFIRM_STOP_TEACHING;
      break;
    case MENU_STATE_CONFIRM_STOP_TEACHING:
      switch (YesNoMenuProcessInput()) {
        case 0:
          r.state = MENU_STATE_CHOOSE_SETUP_STATE;
          break;
        case 1:
        case -1:
          r.state = MENU_STATE_PRINT_TRYING_TO_LEARN_PROMPT;
          break;
      }
      break;
    case MENU_STATE_CHOOSE_SETUP_STATE:
      r.state = MENU_STATE_SETUP_BATTLE_MODE;
      break;
    case MENU_STATE_PRINT_WHICH_MOVE_PROMPT:
      r.state = MENU_STATE_SHOW_MOVE_SUMMARY_SCREEN;
      BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
      break;
    case MENU_STATE_SHOW_MOVE_SUMMARY_SCREEN:
      if (!gPaletteFade.active) {
        const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(r.listMenuTaskId);
        r.listMenuScrollPos = cursorPos;
        r.listMenuScrollRow = itemsAbove;
        FreeAllWindowBuffers();
        ShowSelectMovePokemonSummaryScreen(state.party, r.selectedPartyMember, state.party.length - 1, CB2_MoveRelearner_Resume, r.learnableMoves[r.selectedIndex]);
        r.state = MENU_STATE_FADE_FROM_SUMMARY_SCREEN;
      }
      break;
    case 21:
      r.state = MENU_STATE_FADE_AND_RETURN;
      break;
    case 22:
      BeginNormalPaletteFade(0xffffffff, 0, 16, 0, RGB_BLACK);
      break;
    case MENU_STATE_FADE_AND_RETURN:
      BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
      r.state++;
      break;
    case MENU_STATE_RETURN_TO_FIELD:
      if (!gPaletteFade.active) {
        FreeAllWindowBuffers();
        sMoveRelearner = null;
        SetMainCallback2(CB2_ReturnToField);
      }
      break;
    case MENU_STATE_FADE_FROM_SUMMARY_SCREEN:
      BeginNormalPaletteFade(0xffffffff, 0, 16, 0, RGB_BLACK);
      ShowBg(0);
      ShowBg(1);
      r.state++;
      LoadMoveInfoUI();
      DrawTextBorderOnWindows6and7();
      MoveLearnerInitListMenu();
      PrintTeachWhichMoveToStrVar1(true);
      PrintMoveInfoHandleCancel_CopyToVram();
      break;
    case MENU_STATE_TRY_OVERWRITE_MOVE:
      if (!gPaletteFade.active) {
        if (r.selectedMoveSlot === K.MAX_MON_MOVES) {
          r.state = MENU_STATE_PRINT_STOP_TEACHING;
        } else {
          const mon = state.party[r.selectedPartyMember];
          gStringVar3.set(moveName(mon.moves[r.selectedMoveSlot]));
          removeMonPPBonus(mon, r.selectedMoveSlot);
          setMonMoveSlot(mon, r.learnableMoves[r.selectedIndex], r.selectedMoveSlot);
          gStringVar2.set(moveName(r.learnableMoves[r.selectedIndex]));
          StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_1_2_and_Poof'));
          r.state = MENU_STATE_DOUBLE_FANFARE_FORGOT_MOVE;
          SpecialVar.x8004 = 1;
        }
      }
      break;
    case MENU_STATE_DOUBLE_FANFARE_FORGOT_MOVE:
      StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_MonForgotOldMoveAndMonLearnedNewMove'));
      r.state = MENU_STATE_PRINT_TEXT_THEN_FANFARE;
      PlayFanfare(K.MUS_LEVEL_UP);
      break;
    case MENU_STATE_PRINT_TEXT_THEN_FANFARE:
      PlayFanfare(K.MUS_LEVEL_UP);
      r.state = MENU_STATE_WAIT_FOR_FANFARE;
      break;
    case MENU_STATE_WAIT_FOR_FANFARE:
      if (IsFanfareTaskInactive()) r.state = MENU_STATE_WAIT_FOR_A_BUTTON;
      break;
    case MENU_STATE_WAIT_FOR_A_BUTTON:
      if (JOY_NEW(A_BUTTON)) {
        PlaySE(K.SE_SELECT);
        r.state = MENU_STATE_FADE_AND_RETURN;
      }
      break;
  }
}

function DrawTextBorderOnWindows6and7(): void {
  for (let i = 6; i < 8; i++) DrawTextBorderOuter(i, 0x001, 14);
}

function PrintTeachWhichMoveToStrVar1(onInit: boolean): void {
  if (!onInit) {
    PrintTextOnWindow(7, ExpandToStringVar4(text('gText_TeachWhichMoveToMon')), 0, 2, 0, 2);
    PutWindowTilemap(7);
    CopyWindowToVram(7, COPYWIN_FULL);
  }
}

function InitMoveRelearnerStateVariables(): void {
  const r = R();
  r.state = 0;
  r.scrollPositionMaybe = 0;
  r.numLearnableMoves = 0;
  r.scheduleMoveInfoUpdate = false;
  r.learnableMoves = [];
}

/** SpriteCB_ListMenuScrollIndicators: data[0] 1 = sway sideways, 2 = bob up and down (data[2] = direction). */
function SpriteCB_ListMenuScrollIndicators(sprite: Sprite): void {
  const abcissa = (sprite.data[1] * 10) & 0xff;
  switch (sprite.data[0]) {
    case 0:
      break;
    case 1:
      sprite.x2 = Sin(abcissa, 3) * sprite.data[2];
      break;
    case 2:
      sprite.y2 = Sin(abcissa, 1) * sprite.data[2];
      break;
  }
  sprite.data[1]++;
}

function SpawnListMenuScrollIndicatorSprites(): void {
  const r = R();
  LoadSpriteSheet({ data: gfx('sLearnMoveInterfaceSpritesTiles'), size: 0x180, tag: TAG_SCROLL_INDICATORS });
  LoadSpritePalette({ data: gfx16('sLearnMoveInterfaceSpritesPalette'), tag: TAG_SCROLL_INDICATORS_PAL });
  r.spriteIds[0] = CreateSprite(sSpriteTemplate_MoveRelearnerListMenuScrollIndicators, 200, 4, 0);
  StartSpriteAnim(gSprites[r.spriteIds[0]], 1);
  gSprites[r.spriteIds[0]].data[0] = 2;
  gSprites[r.spriteIds[0]].data[2] = -1;

  // Bug (kept): this should be using the second element of spriteIds.
  r.spriteIds[0] = CreateSprite(sSpriteTemplate_MoveRelearnerListMenuScrollIndicators, 200, 108, 0);
  gSprites[r.spriteIds[0]].data[0] = 2;
  gSprites[r.spriteIds[0]].data[2] = 1;
  for (let i = 0; i < 2; i++) gSprites[r.spriteIds[i]].invisible = true;
}

function MoveRelearnerInitListMenuBuffersEtc(): void {
  const r = R();
  const mon = state.party[r.selectedPartyMember];
  r.learnableMoves = GetMoveRelearnerMoves(mon);
  const count = r.learnableMoves.length;
  r.numLearnableMoves = count;
  r.listMenuStrbufs = r.learnableMoves.map((move) => moveName(move));
  gStringVar1.set(GetMonNickname(mon)); // StringCopy_Nickname
  r.listMenuStrbufs.push(text('gFameCheckerText_Cancel'));
  r.numLearnableMoves++;
  r.listMenuItems = [];
  for (let i = 0; i < count; i++) r.listMenuItems.push({ label: r.listMenuStrbufs[i], index: i });
  r.listMenuItems.push({ label: text('gFameCheckerText_Cancel'), index: CANCEL_INDEX });
  Object.assign(gMultiuseListMenuTemplate, sMoveRelearnerListMenuTemplate, { fontId: K.FONT_NORMAL, items: r.listMenuItems, totalItems: count + 1 });
}

function MoveRelearnerMenuHandleInput(): void {
  const r = R();
  ListMenu_ProcessInput(r.listMenuTaskId);
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    if (r.selectedIndex !== CANCEL_INDEX) {
      r.state = MENU_STATE_PRINT_TEACH_MOVE_PROMPT;
      gStringVar2.set(r.listMenuStrbufs[r.selectedIndex]);
      StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_TeachMoveQues'));
    } else {
      StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_GiveUpTryingToTeachNewMove'));
      r.state = MENU_STATE_PRINT_GIVE_UP_PROMPT;
    }
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    r.state = MENU_STATE_PRINT_GIVE_UP_PROMPT;
    StringExpandPlaceholdersAndPrintTextOnWindow7Color2(text('gText_GiveUpTryingToTeachNewMove'));
  }
  // As in the C, gSprites[0] / [1] are the two arrows, and scrollPositionMaybe never moves off 0: with more than
  // six entries the down arrow shows and the up arrow stays hidden.
  if (r.numLearnableMoves > 6) {
    gSprites[0].invisible = false;
    gSprites[1].invisible = false;
    if (r.scrollPositionMaybe === 0) gSprites[0].invisible = true;
    else if (r.scrollPositionMaybe === r.numLearnableMoves - 6) gSprites[1].invisible = true;
  }
}

function MoveLearnerInitListMenu(): void {
  const r = R();
  r.listMenuTaskId = ListMenuInit(gMultiuseListMenuTemplate, r.listMenuScrollPos, r.listMenuScrollRow);
  CopyWindowToVram(6, COPYWIN_MAP);
}

function PrintMoveInfo(move: number): void {
  const m = gBattleMoves[move];
  BlitMenuInfoIcon(2, m.type + 1, 1, 4);
  if (m.power < 2) PrintTextOnWindow(3, text('gText_ThreeHyphens'), 1, 4, 0, 0);
  else PrintTextOnWindow(3, ConvertIntToDecimalStringN(m.power, STR_CONV_MODE_RIGHT_ALIGN, 3), 1, 4, 0, 0);
  if (m.accuracy === 0) PrintTextOnWindow(3, text('gText_ThreeHyphens'), 1, 18, 0, 1);
  else PrintTextOnWindow(3, ConvertIntToDecimalStringN(m.accuracy, STR_CONV_MODE_RIGHT_ALIGN, 3), 1, 18, 0, 1);
  PrintTextOnWindow(4, ConvertIntToDecimalStringN(m.pp, STR_CONV_MODE_LEFT_ALIGN, 2), 2, 2, 0, 0);
  PrintTextOnWindow(5, encodeRaw(menusData.moveDescriptions[move - 1] ?? '$'), 1, 0, 0, 0);
}

function LoadMoveInfoUI(): void {
  BlitMenuInfoIcon(0, K.MENU_INFO_ICON_TYPE, 1, 4);
  BlitMenuInfoIcon(1, K.MENU_INFO_ICON_POWER, 0, 4);
  BlitMenuInfoIcon(1, K.MENU_INFO_ICON_ACCURACY, 0, 19);
  BlitMenuInfoIcon(0, K.MENU_INFO_ICON_PP, 1, 19);
  BlitMenuInfoIcon(0, K.MENU_INFO_ICON_EFFECT, 1, 34);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  PutWindowTilemap(4);
  PutWindowTilemap(3);
  PutWindowTilemap(5);
  PutWindowTilemap(2);
  PutWindowTilemap(7);
  CopyWindowToVram(0, COPYWIN_GFX);
  CopyWindowToVram(1, COPYWIN_GFX);
}

function PrintMoveInfoHandleCancel_CopyToVram(): void {
  const r = R();
  if (r.selectedIndex !== CANCEL_INDEX) {
    PrintMoveInfo(r.learnableMoves[r.selectedIndex]);
  } else {
    for (let i = 2; i < 6; i++) {
      FillWindowPixelBuffer(i, PIXEL_FILL(0));
      CopyWindowToVram(i, COPYWIN_GFX);
    }
  }
  CopyWindowToVram(3, COPYWIN_GFX);
  CopyWindowToVram(4, COPYWIN_GFX);
  CopyWindowToVram(2, COPYWIN_GFX);
  CopyWindowToVram(5, COPYWIN_GFX);
  CopyWindowToVram(7, COPYWIN_FULL);
}

function MoveRelearnerMenu_MoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  if (!onInit) {
    PlaySE(K.SE_SELECT);
    R().scheduleMoveInfoUpdate = true;
    R().selectedIndex = itemIndex;
  }
}

function YesNoMenuProcessInput(): number {
  const input = Menu_ProcessInputNoWrapClearOnChoose();
  if (input !== -2) {
    PutWindowTilemap(6);
    CopyWindowToVram(6, COPYWIN_MAP);
  }
  return input;
}

/** colorIdx 0 / 1: the info windows (1 prints over what's there); 2: the message window. */
function PrintTextOnWindow(windowId: number, str: number[], x: number, y: number, speed: number, colorIdx: number): void {
  const r = R();
  let letterSpacing = 1;
  let lineSpacing = 1;
  if (colorIdx === 0 || colorIdx === 1) {
    letterSpacing = 0;
    lineSpacing = 0;
  }
  switch (colorIdx) {
    case 0:
    case 1:
      r.textColor = [0, 2, 3];
      break;
    case 2:
      r.textColor = [1, 2, 3];
  }
  if (colorIdx !== 1) FillWindowPixelBuffer(windowId, PIXEL_FILL(r.textColor[0]));
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL_COPY_2, x, y, letterSpacing, lineSpacing, r.textColor, speed, str);
}

/** Test probe (__test.moveRelearner()): the state machine's state, the list and the selected entry. */
export function moveRelearnerProbe(): { state: number; selectedIndex: number; moves: number[]; selectedMoveSlot: number; textPrinting: boolean } | undefined {
  if (!sMoveRelearner) return undefined;
  const r = sMoveRelearner;
  return { state: r.state, selectedIndex: r.selectedIndex, moves: [...r.learnableMoves], selectedMoveSlot: r.selectedMoveSlot, textPrinting: IsTextPrinterActive(7) };
}
