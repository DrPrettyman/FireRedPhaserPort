// slot_machine.c's screen on the GBA layer: PlaySlotMachine → CB2_InitSlotMachine → CB2_RunSlotMachine, the main
// tasks (MainTask_SlotsGameLoop and the no coins / help / quit / no payout / payout / exit ones), the setup tasks
// that do the drawing (SlotsTask_*, run by Task_SlotMachine), the reel icon sprites with HBlankCB_SlotMachine's
// per-line squash and darkening, the score digits, the two Clefairy, Task_FlashWinningLine and the reel buttons.
// The game itself (the state, the reels' stops, the bias, the payout) is menus/slotMachineLogic.ts.
//
// From the field: `playslotmachine` (ScrCmd_playslotmachine) → PlaySlotMachine(id,
// CB2_ReturnToFieldContinueScriptPlayMapMusic) on FieldMenuScene (script/gameCornerSpecials.ts).
//
// The win fanfares hold the payout for their sFanfares count (gba/sound.ts); nothing is audible before the mixer
// (AUDIO_PLAN.md W-m4a 3). No game stats (GAME_STAT_SLOT_JACKPOTS).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { gSineTable } from '../battle/trig';
import {
  ChangeBgX,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
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
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_TGT1_BD,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT1_OBJ,
  ClearGpuRegBits,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  getVCount,
  PALETTES_ALL,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  vram,
  WIN_RANGE,
  WININ_WIN0_BG0,
  WININ_WIN0_BG1,
  WININ_WIN0_BG2,
  WININ_WIN0_BG3,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import {
  A_BUTTON,
  B_BUTTON,
  DPAD_ANY,
  DPAD_DOWN,
  DPAD_LEFT,
  DPAD_RIGHT,
  gMain,
  JOY_HELD,
  JOY_NEW,
  R_BUTTON,
  SetHBlankCallback,
  SetMainCallback2,
  SetVBlankCallback,
  START_BUTTON,
  type MainCallback,
} from '../gba/main';
import {
  CreateYesNoMenu,
  DestroyYesNoMenu,
  DrawTextBorderOuter,
  FreeTempTileDataBuffersIfPossible,
  GetTextWindowPalette,
  LoadUserWindowGfx,
  Menu_MoveCursorNoWrapAround,
  Menu_ProcessInputNoWrapClearOnChoose,
  ResetBgPositions,
  ResetTempTileDataBuffers,
  TEXT_COLOR_DARK_GRAY,
  TEXT_COLOR_WHITE,
  DecompressAndCopyTileDataToVram,
} from '../gba/menu';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalettes,
  gPaletteFade,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  LoadPalette,
  PLTT_SIZE_4BPP,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { IsFanfareTaskInactive, PlayFanfare, PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  oam,
  oamBuffer,
  oamMatrices,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_SQUARE,
  ST_OAM_V_RECTANGLE,
  StartSpriteAnim,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, FuncIsActiveTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinter,
  AddTextPrinterParameterized3,
  CopyWindowToVram,
  COPYWIN_FULL,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  GetWindowAttribute,
  FONTATTR_COLOR_BACKGROUND,
  FONTATTR_COLOR_FOREGROUND,
  FONTATTR_COLOR_SHADOW,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { text } from './common';
import {
  CalcPayout,
  CalcSlotBias,
  CreateSlotMachineState,
  GetPayout,
  GetPlayerBet,
  GetWinFlagByLine,
  IsReelSpinning,
  NUM_MATCH_LINES,
  NUM_REELS,
  PAYOUT_7,
  PAYOUT_NONE,
  PAYOUT_ROCKET,
  ResetMachineBias,
  sSlotMachineState,
  SpinReels,
  StartReels,
  StopCurrentReel,
  slotMachineData,
} from './slotMachineLogic';
import { SetQLPlayedTheSlots } from '../world/questLogEvents';

// Only 4 icons are actually visible per reel at a single time, with 1 on deck. Only 3 visible when not spinning.
const REEL_LOAD_LENGTH = 5;
const NUM_BUTTON_TILES = 4;
const NUM_DIGIT_SPRITES = 4;

const PALSLOT_LINE_NORMAL = 4; // Loaded as part of sBg_Pal
const PALSLOT_LINE_BET = 5;
const PALSLOT_LINE_MATCH = 6;

const GFXTAG_REEL_ICONS = 0;
const GFXTAG_CLEFAIRY = 1;
const GFXTAG_DIGITS = 2;

const PALTAG_REEL_ICONS_0 = 0;
const PALTAG_REEL_ICONS_2 = 2;
const PALTAG_REEL_ICONS_3 = 3;
const PALTAG_REEL_ICONS_4 = 4;
const PALTAG_CLEFAIRY = 5;
const PALTAG_DIGITS = 6;

const SLOTTASK_GFX_INIT = 0;
const SLOTTASK_FADEOUT_EXIT = 1;
const SLOTTASK_UPDATE_LINE_LIGHTS = 2;
const SLOTTASK_CLEFAIRY_BOUNCE = 3;
const SLOTTASK_ANIM_WIN = 4;
const SLOTTASK_END_ANIM_WIN = 5;
const SLOTTASK_ANIM_LOSE = 6;
const SLOTTASK_ANIM_BETTING = 7;
const SLOTTASK_SHOW_AMOUNTS = 8;
const SLOTTASK_MSG_NO_COINS = 9;
const SLOTTASK_ASK_QUIT = 10;
const SLOTTASK_DESTROY_YESNO = 11;
const SLOTTASK_PRESS_BUTTON = 12;
const SLOTTASK_RELEASE_BUTTONS = 13;
const SLOTTASK_SHOWHELP = 14;
const SLOTTASK_HIDEHELP = 15;

const TEXT_DYNAMIC_COLOR_6 = 0xf; // characters.h

/** The graphics the screen loads, by C symbol (sBg_Pal is main_menu.c's too, so it's file-qualified). */
export function slotMachineGfxSymbols(): string[] {
  return [
    'sReelIcons_Pal',
    'sReelIcons_Tiles',
    'sClefairy_Pal',
    'sClefairy_Tiles',
    'sDigits_Pal',
    'sDigits_Tiles',
    'slot_machine.sBg_Pal',
    'sBg_Tiles',
    'slot_machine.sBg_Tilemap',
    'sBgPal_MatchLines',
    'sBgPal_PayoutLight',
    'sButtonPressed_Tiles',
    'sCombosWindow_Pal',
    'sCombosWindow_Tiles',
    'sCombosWindow_Tilemap',
  ];
}

const sBg_Pal = () => gfx16('slot_machine.sBg_Pal');

// ------------------------------------------------------------------ sprite data

/** sReelIconPaletteTags (FIRERED) */
const sReelIconPaletteTags = [
  PALTAG_REEL_ICONS_2, // ICON_7
  PALTAG_REEL_ICONS_2, // ICON_ROCKET
  PALTAG_REEL_ICONS_0, // ICON_PIKACHU
  PALTAG_REEL_ICONS_0, // ICON_PSYDUCK
  PALTAG_REEL_ICONS_2, // ICON_CHERRIES
  PALTAG_REEL_ICONS_4, // ICON_MAGNEMITE
  PALTAG_REEL_ICONS_3, // ICON_SHELLDER
];

/** sReelIconAffineParams: the reels' horizontal squash per line from line 0x2B (PA of OAM matrix 0). */
const sReelIconAffineParams = [
  ...Array.from({ length: 32 }, (_, i) => 0x120 - i),
  ...new Array<number>(32).fill(0x100),
  ...Array.from({ length: 32 }, (_, i) => 0x101 + i),
];

/** sReelIconBldY: the reels' darkening per line from line 0x2B. */
// prettier-ignore
const sReelIconBldY = [
  0x10, 0x10, 0x10, 0x10, 0x0f, 0x0e, 0x0d, 0x0d, 0x0c, 0x0b, 0x0a, 0x0a, 0x09, 0x08, 0x07, 0x07, 0x06, 0x05, 0x04, 0x04, 0x03, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x03, 0x04, 0x05, 0x06, 0x06, 0x07, 0x08, 0x09, 0x09, 0x0a, 0x0b, 0x0c, 0x0c, 0x0d, 0x0e, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f,
];

const frameAnim = (imageValue: number, duration: number): AnimCmd[] => [ANIMCMD_FRAME(imageValue, duration), ANIMCMD_END];

/** sAnimTable_ReelIcons: ICON_7 .. ICON_SHELLDER, then the unused _2 copies. */
const sAnimTable_ReelIcons: AnimCmd[][] = [0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x20, 0x30, 0x40, 0x50, 0x60].map((t) => frameAnim(t, 4));

const sSpriteTemplate_ReelIcons: SpriteTemplate = {
  tileTag: GFXTAG_REEL_ICONS,
  paletteTag: PALTAG_REEL_ICONS_0,
  oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: ST_OAM_SQUARE, size: 2, priority: 3 }),
  anims: sAnimTable_ReelIcons,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sAnimTable_Digits: digit n is tiles 2n (8x16). */
const sAnimTable_Digits: AnimCmd[][] = Array.from({ length: 10 }, (_, n) => frameAnim(n * 2, 4));

const sSpriteTemplate_Digits: SpriteTemplate = {
  tileTag: GFXTAG_DIGITS,
  paletteTag: PALTAG_DIGITS,
  oam: oam({ shape: ST_OAM_V_RECTANGLE, size: 0, priority: 1 }),
  anims: sAnimTable_Digits,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sAnimTable_Clefairy: neutral, spinning (reels running), payout, lose. */
const sAnimTable_Clefairy: AnimCmd[][] = [
  [ANIMCMD_FRAME(0, 4), ANIMCMD_END],
  [ANIMCMD_FRAME(0, 24), ANIMCMD_FRAME(16, 24), ANIMCMD_JUMP(0)],
  [ANIMCMD_FRAME(32, 28), ANIMCMD_FRAME(48, 28), ANIMCMD_JUMP(0)],
  [ANIMCMD_FRAME(64, 12), ANIMCMD_FRAME(80, 12), ANIMCMD_JUMP(0)],
];

const sSpriteTemplate_Clefairy: SpriteTemplate = {
  tileTag: GFXTAG_CLEFAIRY,
  paletteTag: PALTAG_CLEFAIRY,
  oam: oam({ shape: ST_OAM_SQUARE, size: 2, priority: 1 }),
  anims: sAnimTable_Clefairy,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

// ------------------------------------------------------------------ BG data

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 5, tilemapTop: 15, width: 20, height: 4, paletteNum: 15, baseBlock: 0x04f },
  { bg: 0, tilemapLeft: 0, tilemapTop: 0, width: 30, height: 2, paletteNum: 14, baseBlock: 0x013 },
  DUMMY_WIN_TEMPLATE,
];

/** sLineStateTileIdxs: the BG2 tilemap entries of each line's lights, in winFlags order (TL-BR, top, middle, bottom, BL-TR). */
// prettier-ignore
const sLineStateTileIdxs: number[][] = [
  [0x00a4, 0x00a5, 0x00a6, 0x00c4, 0x00c5, 0x00c6, 0x00c7, 0x00e7, 0x012c, 0x014c, 0x0191, 0x01b1, 0x01f6, 0x0216, 0x0217, 0x0218, 0x0219, 0x0237, 0x0238, 0x0239],
  [0x00e4, 0x00e5, 0x00e6, 0x00f7, 0x00f8, 0x00f9, 0x0104, 0x0105, 0x0106, 0x0107, 0x010c, 0x0111, 0x0116, 0x0117, 0x0118, 0x0119, 0x0124, 0x0125, 0x0126, 0x0137, 0x0138, 0x0139],
  [0x0144, 0x0145, 0x0146, 0x0157, 0x0158, 0x0159, 0x0164, 0x0165, 0x0166, 0x0167, 0x016c, 0x0171, 0x0176, 0x0177, 0x0178, 0x0179, 0x0184, 0x0185, 0x0186, 0x0197, 0x0198, 0x0199],
  [0x01a4, 0x01a5, 0x01a6, 0x01b7, 0x01b8, 0x01b9, 0x01c4, 0x01c5, 0x01c6, 0x01c7, 0x01cc, 0x01d1, 0x01d6, 0x01d7, 0x01d8, 0x01d9, 0x01e4, 0x01e5, 0x01e6, 0x01f7, 0x01f8, 0x01f9],
  [0x0204, 0x0205, 0x0206, 0x0224, 0x0225, 0x0226, 0x01e7, 0x0207, 0x018c, 0x01ac, 0x0131, 0x0151, 0x00d6, 0x00f6, 0x00b7, 0x00b8, 0x00b9, 0x00d7, 0x00d8, 0x00d9],
];

const sWinningLineFlashPalIdxs = [2, 4];

const sYesNoWindowTemplate: WindowTemplate = { bg: 0, tilemapLeft: 19, tilemapTop: 9, width: 6, height: 4, paletteNum: 15, baseBlock: 0x9f };

/** sReelButtonMapTileIdxs */
const sReelButtonMapTileIdxs = [
  [0x0229, 0x022a, 0x0249, 0x024a],
  [0x022e, 0x022f, 0x024e, 0x024f],
  [0x0233, 0x0234, 0x0253, 0x0254],
];

// ------------------------------------------------------------------ state

/** struct SlotMachineState's screen half (the game half is slotMachineLogic's sSlotMachineState). */
let sScreen: { savedCallback: MainCallback; taskId: number; spinReelsTaskId: number } | null = null;

/** struct SlotMachineGfxManager */
interface SlotMachineGfxManager {
  reelIconSprites: Sprite[][];
  creditDigitSprites: Sprite[];
  payoutDigitSprites: Sprite[];
  clefairySprites: Sprite[];
}
let sSlotMachineGfxManager: SlotMachineGfxManager | null = null;

interface SetupTask {
  funcno: number;
  state: number;
  active: boolean;
}

/** struct SlotMachineSetupTaskData (Task_SlotMachine's word arg; the tilemap buffers are BG 0, 2 and 3's). */
interface SlotMachineSetupTaskData {
  tasks: SetupTask[];
  reelButtonToPress: number;
  bg1X: number;
  yesNoMenuActive: boolean;
  buttonPressedTiles: number[][];
  buttonReleasedTiles: number[][];
  bg0TilemapBuffer: Uint16Array;
  bg2TilemapBuffer: Uint16Array;
  bg3TilemapBuffer: Uint16Array;
}
let sSetupTaskData: SlotMachineSetupTaskData | null = null;

// ------------------------------------------------------------------ entry and main callbacks

/** PlaySlotMachine */
export function PlaySlotMachine(machineIdx: number, savedCallback: MainCallback): void {
  ResetTasks();
  CreateSlotMachineState(machineIdx); // Alloc + the machineIdx clamp + InitSlotMachineState
  sScreen = { savedCallback, taskId: 0, spinReelsTaskId: 0 };
  SetMainCallback2(CB2_InitSlotMachine);
}

/** CB2_InitSlotMachine */
function CB2_InitSlotMachine(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();

  switch (gMain.state) {
    case 0:
      if (CreateSlotMachine()) {
        SetMainCallback2(sScreen!.savedCallback);
        CleanSupSlotMachineState();
      } else {
        SetSlotMachineSetupTask(SLOTTASK_GFX_INIT, 0);
        gMain.state++;
      }
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0)) {
        sScreen!.taskId = CreateTask(MainTask_SlotsGameLoop, 0);
        sScreen!.spinReelsTaskId = CreateTask(Task_SpinReels, 1);
        SetMainCallback2(CB2_RunSlotMachine);
      }
      break;
  }
}

/** CleanSupSlotMachineState */
function CleanSupSlotMachineState(): void {
  DestroySlotMachine();
  sScreen = null;
}

/** CB2_RunSlotMachine */
function CB2_RunSlotMachine(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

// ------------------------------------------------------------------ main tasks

/** MainTask_SlotsGameLoop: betting, spinning, stopping the reels one by one, then the payout. */
function MainTask_SlotsGameLoop(taskId: number): void {
  const data = gTasks[taskId].data;
  const s = sSlotMachineState;

  switch (data[0]) {
    case 0:
      // Betting Phase
      if (state.coins === 0) {
        SetMainTask(MainTask_NoCoinsGameOver);
      } else if (JOY_NEW(DPAD_DOWN)) {
        s.bet++;
        state.removeCoins(1);
        PlaySE(K.SE_RS_SHOP);
        SetSlotMachineSetupTask(SLOTTASK_SHOW_AMOUNTS, 0);
        SetSlotMachineSetupTask(SLOTTASK_UPDATE_LINE_LIGHTS, 1);
        data[0] = 1;
      } else if (JOY_NEW(R_BUTTON)) {
        const toAdd = 3 - s.bet;
        if (state.coins >= toAdd) {
          s.bet = 3;
          state.removeCoins(toAdd);
        } else {
          s.bet += state.coins;
          state.coins = 0; // SetCoins(0)
        }
        PlaySE(K.SE_RS_SHOP);
        SetSlotMachineSetupTask(SLOTTASK_SHOW_AMOUNTS, 0);
        SetSlotMachineSetupTask(SLOTTASK_UPDATE_LINE_LIGHTS, 1);
        data[0] = 1;
      } else if (JOY_NEW(A_BUTTON) && s.bet !== 0) {
        data[0] = 2;
      } else if (JOY_NEW(B_BUTTON)) {
        SetMainTask(MainTask_ConfirmExitGame);
      } else if (JOY_NEW(DPAD_RIGHT)) {
        SetMainTask(MainTask_ShowHelp);
      }
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0) && !IsSlotMachineSetupTaskActive(1)) {
        if (s.bet === 3 || state.coins === 0) data[0] = 2;
        else data[0] = 0;
      }
      break;
    case 2:
      SetQLPlayedTheSlots(); // leaving the Game Corner now counts as QL_EVENT_DEPARTED
      CalcSlotBias();
      StartReels();
      s.currentReel = 0;
      SetSlotMachineSetupTask(SLOTTASK_CLEFAIRY_BOUNCE, 0);
      data[0] = 3;
      break;
    case 3:
      if (!IsSlotMachineSetupTaskActive(0)) {
        if (JOY_NEW(A_BUTTON)) {
          PlaySE(K.SE_CONTEST_PLACE);
          StopCurrentReel(s.currentReel, s.currentReel);
          PressReelButton(s.currentReel, 0);
          data[0] = 4;
        }
      }
      break;
    case 4:
      if (!IsReelSpinning(s.currentReel) && !IsSlotMachineSetupTaskActive(0)) {
        s.currentReel++;
        if (s.currentReel >= NUM_REELS) {
          s.slotRewardClass = CalcPayout();
          s.bet = 0;
          s.currentReel = 0;
          if (s.slotRewardClass === PAYOUT_NONE) {
            SetMainTask(MainTask_DarnNoPayout);
          } else {
            if (s.slotRewardClass === PAYOUT_7) state.incrementGameStat(K.GAME_STAT_SLOT_JACKPOTS);
            ResetMachineBias();
            SetMainTask(MainTask_WinHandlePayout);
          }
        } else {
          data[0] = 3;
        }
      }
      break;
  }
}

/** MainTask_NoCoinsGameOver */
function MainTask_NoCoinsGameOver(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetSlotMachineSetupTask(SLOTTASK_MSG_NO_COINS, 0);
      data[0]++;
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0)) data[0]++;
      break;
    case 2:
      if (JOY_NEW(A_BUTTON | B_BUTTON | DPAD_ANY)) SetMainTask(MainTask_ExitSlots);
      break;
  }
}

/** MainTask_ShowHelp: the combos window slides in; LEFT slides it out. */
function MainTask_ShowHelp(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetSlotMachineSetupTask(SLOTTASK_SHOWHELP, 0);
      data[0]++;
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0)) data[0]++;
      break;
    case 2:
      if (JOY_NEW(DPAD_LEFT)) {
        SetSlotMachineSetupTask(SLOTTASK_HIDEHELP, 0);
        data[0]++;
      }
      break;
    case 3:
      if (!IsSlotMachineSetupTaskActive(0)) SetMainTask(MainTask_SlotsGameLoop);
      break;
  }
}

/** MainTask_ConfirmExitGame: "Quit playing?" YES gives the bet back and leaves. */
function MainTask_ConfirmExitGame(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetSlotMachineSetupTask(SLOTTASK_ASK_QUIT, 0);
      data[0]++;
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0)) data[0]++;
      break;
    case 2:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case 0:
          state.addCoins(sSlotMachineState.bet);
          SetSlotMachineSetupTask(SLOTTASK_SHOW_AMOUNTS, 0);
          data[0] = 3;
          break;
        case 1:
        case -1:
          SetSlotMachineSetupTask(SLOTTASK_DESTROY_YESNO, 0);
          data[0] = 4;
          break;
      }
      break;
    case 3:
      if (!IsSlotMachineSetupTaskActive(0)) SetMainTask(MainTask_ExitSlots);
      break;
    case 4:
      if (!IsSlotMachineSetupTaskActive(0)) SetMainTask(MainTask_SlotsGameLoop);
      break;
  }
}

/** MainTask_DarnNoPayout */
function MainTask_DarnNoPayout(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetSlotMachineSetupTask(SLOTTASK_ANIM_LOSE, 0);
      data[1] = 0;
      data[0]++;
      break;
    case 1:
      data[1]++;
      if (data[1] > 60) {
        SetSlotMachineSetupTask(SLOTTASK_ANIM_BETTING, 0);
        SetSlotMachineSetupTask(SLOTTASK_UPDATE_LINE_LIGHTS, 1);
        SetSlotMachineSetupTask(SLOTTASK_RELEASE_BUTTONS, 2);
        data[0]++;
      }
      break;
    case 2:
      if (!IsSlotMachineSetupTaskActive(0) && !IsSlotMachineSetupTaskActive(1) && !IsSlotMachineSetupTaskActive(2)) SetMainTask(MainTask_SlotsGameLoop);
      break;
  }
}

/** MainTask_WinHandlePayout: a coin every 8 frames (2 with A held); START pays the rest at once. */
function MainTask_WinHandlePayout(taskId: number): void {
  const data = gTasks[taskId].data;
  const s = sSlotMachineState;
  switch (data[0]) {
    case 0:
      if (s.slotRewardClass === PAYOUT_ROCKET || s.slotRewardClass === PAYOUT_7) PlayFanfare(K.MUS_SLOTS_JACKPOT);
      else PlayFanfare(K.MUS_SLOTS_WIN);
      SetSlotMachineSetupTask(SLOTTASK_SHOW_AMOUNTS, 0);
      SetSlotMachineSetupTask(SLOTTASK_ANIM_WIN, 1);
      data[1] = 8;
      data[0]++;
      break;
    case 1:
      data[1]++;
      if (data[1] > 120) {
        data[1] = 8;
        if (JOY_HELD(A_BUTTON)) data[1] = 2;
        data[0]++;
      }
      break;
    case 2:
      if (!IsSlotMachineSetupTaskActive(0)) {
        if (IsFanfareTaskInactive() && JOY_NEW(START_BUTTON)) {
          state.addCoins(s.payout);
          s.payout = 0;
        } else {
          data[1]--;
          if (data[1] === 0) {
            if (IsFanfareTaskInactive()) PlaySE(K.SE_PIN);
            if (s.payout !== 0) {
              state.addCoins(1);
              s.payout--;
            }
            data[1] = 8;
            if (JOY_HELD(A_BUTTON)) data[1] = 2;
          }
        }
        SetSlotMachineSetupTask(SLOTTASK_SHOW_AMOUNTS, 0);
        if (s.payout === 0) data[0]++;
      }
      break;
    case 3:
      if (IsFanfareTaskInactive() && !IsSlotMachineSetupTaskActive(0)) {
        SetSlotMachineSetupTask(SLOTTASK_END_ANIM_WIN, 0);
        data[0]++;
      }
      break;
    case 4:
      if (!IsSlotMachineSetupTaskActive(0)) {
        SetSlotMachineSetupTask(SLOTTASK_UPDATE_LINE_LIGHTS, 0);
        SetSlotMachineSetupTask(SLOTTASK_RELEASE_BUTTONS, 1);
        data[0]++;
      }
      break;
    case 5:
      if (!IsSlotMachineSetupTaskActive(0) && !IsSlotMachineSetupTaskActive(1)) SetMainTask(MainTask_SlotsGameLoop);
      break;
  }
}

/** MainTask_ExitSlots */
function MainTask_ExitSlots(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      SetSlotMachineSetupTask(SLOTTASK_FADEOUT_EXIT, 0);
      data[0]++;
      break;
    case 1:
      if (!IsSlotMachineSetupTaskActive(0)) {
        SetMainCallback2(sScreen!.savedCallback);
        CleanSupSlotMachineState();
      }
      break;
  }
}

/** SetMainTask */
function SetMainTask(taskFunc: TaskFunc): void {
  gTasks[sScreen!.taskId].func = taskFunc;
  gTasks[sScreen!.taskId].data[0] = 0;
}

/** Task_SpinReels: the logic's spin step, then the icons follow it. */
function Task_SpinReels(_taskId: number): void {
  // MainTask_ExitSlots frees the screen inside the same RunTasks, and this task (priority 1) still runs after it: on
  // the GBA, UpdateReelIconSprites then reads through the NULL sSlotMachineGfxManager (harmlessly). Not here.
  if (!sSlotMachineGfxManager) return;
  SpinReels();
  UpdateReelIconSprites(sSlotMachineState.reelPositions, sSlotMachineState.reelSubpixel);
}

// ------------------------------------------------------------------ sprites

/** LoadSpriteGraphicsAndAllocateManager */
function LoadSpriteGraphicsAndAllocateManager(): boolean {
  // sSpriteSheets
  LoadCompressedSpriteSheet({ data: gfx('sReelIcons_Tiles'), size: 0xe00, tag: GFXTAG_REEL_ICONS });
  LoadCompressedSpriteSheet({ data: gfx('sClefairy_Tiles'), size: 0xc00, tag: GFXTAG_CLEFAIRY });
  LoadCompressedSpriteSheet({ data: gfx('sDigits_Tiles'), size: 0x280, tag: GFXTAG_DIGITS });
  // LoadSpritePalettes(sSpritePalettes)
  const reelPals = gfx16('sReelIcons_Pal');
  for (let i = 0; i < 5; i++) LoadSpritePalette({ data: reelPals.subarray(i * 16, i * 16 + 16), tag: PALTAG_REEL_ICONS_0 + i });
  LoadSpritePalette({ data: gfx16('sClefairy_Pal'), tag: PALTAG_CLEFAIRY });
  LoadSpritePalette({ data: gfx16('sDigits_Pal'), tag: PALTAG_DIGITS });
  sSlotMachineGfxManager = { reelIconSprites: [[], [], []], creditDigitSprites: [], payoutDigitSprites: [], clefairySprites: [] }; // InitGfxManager
  return true;
}

/** DestroyGfxManager */
function DestroyGfxManager(): void {
  sSlotMachineGfxManager = null;
}

/** CreateReelIconSprites: five 32x32 icons per reel, all on OAM matrix 0 (HBlankCB_SlotMachine squashes it per line). */
function CreateReelIconSprites(): void {
  const reelIcons = slotMachineData.reelIcons;
  for (let i = 0; i < NUM_REELS; i++) {
    for (let j = 0; j < REEL_LOAD_LENGTH; j++) {
      const spriteId = CreateSprite(sSpriteTemplate_ReelIcons, 80 + 40 * i, 44 + 24 * j, 2);
      const animId = reelIcons[i][j];
      const sprite = gSprites[spriteId];
      StartSpriteAnim(sprite, animId);
      sprite.oam.paletteNum = IndexOfSpritePaletteTag(sReelIconPaletteTags[animId]);
      sprite.data[0] = i;
      sprite.data[1] = j;
      sprite.data[2] = j;
      sprite.data[3] = 0;
      sprite.oam.matrixNum = 0;
      sSlotMachineGfxManager!.reelIconSprites[i][j] = sprite;
    }
  }
}

/** UpdateReelIconSprites: each reel's five icons from its position down, shifted 8px per subpixel step. */
function UpdateReelIconSprites(reelPositions: number[], subpixels: number[]): void {
  const reelIcons = slotMachineData.reelIcons;
  for (let i = 0; i < NUM_REELS; i++) {
    let reelPos = reelPositions[i];
    const ypos = subpixels[i] * 8;
    for (let j = 0; j < REEL_LOAD_LENGTH; j++) {
      const sprite = sSlotMachineGfxManager!.reelIconSprites[i][j];
      sprite.y2 = ypos;
      const animId = reelIcons[i][reelPos];
      StartSpriteAnim(sprite, animId);
      StartSpriteAnim(sprite, animId); // (twice in the C too)
      sprite.oam.paletteNum = IndexOfSpritePaletteTag(sReelIconPaletteTags[animId]);
      reelPos++;
      if (reelPos >= slotMachineData.reelIcons[i].length) reelPos = 0;
    }
  }
}

/**
 * HBlankCB_SlotMachine: from line 0x2B, 84 lines of the reels' window squash the icons horizontally (OAM matrix 0's
 * PA, written straight into OAM after LoadOam) and darken them towards the top and bottom (BLDY).
 */
function HBlankCB_SlotMachine(): void {
  const vcount = getVCount() - 0x2b;
  if (vcount >= 0 && vcount < 0x54) {
    oamMatrices[0].a = sReelIconAffineParams[vcount];
    SetGpuReg(REG_OFFSET_BLDY, sReelIconBldY[vcount]);
  } else {
    oamMatrices[0].a = 0x100;
    SetGpuReg(REG_OFFSET_BLDY, 0);
  }
}

/** CreateScoreDigitSprites: CREDIT and PAYOUT, four digits each. */
function CreateScoreDigitSprites(): void {
  for (let i = 0; i < NUM_DIGIT_SPRITES; i++) {
    let spriteId = CreateSprite(sSpriteTemplate_Digits, 85 + 7 * i, 30, 0);
    sSlotMachineGfxManager!.creditDigitSprites[i] = gSprites[spriteId];
    spriteId = CreateSprite(sSpriteTemplate_Digits, 133 + 7 * i, 30, 0);
    sSlotMachineGfxManager!.payoutDigitSprites[i] = gSprites[spriteId];
  }
}

/** UpdateCoinsDisplay */
function UpdateCoinsDisplay(): void {
  let coins = state.coins;
  let payout = GetPayout();
  let divisor = 1000;
  for (let i = 0; i < NUM_DIGIT_SPRITES; i++) {
    let quotient = Math.trunc(coins / divisor);
    StartSpriteAnim(sSlotMachineGfxManager!.creditDigitSprites[i], quotient);
    coins -= quotient * divisor;
    quotient = Math.trunc(payout / divisor);
    StartSpriteAnim(sSlotMachineGfxManager!.payoutDigitSprites[i], quotient);
    payout -= quotient * divisor;
    divisor = Math.trunc(divisor / 10);
  }
}

/** CreateClefairySprites: one each side, the right one flipped. */
function CreateClefairySprites(): void {
  let spriteId = CreateSprite(sSpriteTemplate_Clefairy, 16, 136, 1);
  sSlotMachineGfxManager!.clefairySprites[0] = gSprites[spriteId];
  spriteId = CreateSprite(sSpriteTemplate_Clefairy, K.DISPLAY_WIDTH - 16, 136, 1);
  sSlotMachineGfxManager!.clefairySprites[1] = gSprites[spriteId];
  sSlotMachineGfxManager!.clefairySprites[1].hFlip = true;
}

/** SetClefairySpriteAnim */
function SetClefairySpriteAnim(animId: number): void {
  for (const sprite of sSlotMachineGfxManager!.clefairySprites) StartSpriteAnim(sprite, animId);
}

// ------------------------------------------------------------------ setup tasks

/** CreateSlotMachine: Task_SlotMachine with its data; FALSE unless the Alloc failed. */
function CreateSlotMachine(): boolean {
  sSetupTaskData = {
    tasks: Array.from({ length: 8 }, () => ({ funcno: 0, state: 0, active: false })),
    reelButtonToPress: 0,
    bg1X: 0,
    yesNoMenuActive: false,
    buttonPressedTiles: [[], [], []],
    buttonReleasedTiles: [[], [], []],
    bg0TilemapBuffer: new Uint16Array(0x400),
    bg2TilemapBuffer: new Uint16Array(0x400),
    bg3TilemapBuffer: new Uint16Array(0x400),
  };
  CreateTask(Task_SlotMachine, 2);
  return false;
}

/** DestroySlotMachine */
function DestroySlotMachine(): void {
  if (FuncIsActiveTask(Task_SlotMachine)) {
    sSetupTaskData = null;
    DestroyTask(FindTaskIdByFunc(Task_SlotMachine));
  }
  DestroyGfxManager();
  FreeAllWindowBuffers();
}

/** Task_SlotMachine: runs the active setup tasks. */
function Task_SlotMachine(_taskId: number): void {
  const ptr = sSetupTaskData!;
  for (const t of ptr.tasks) {
    if (t.active) t.active = sSlotMachineSetupTasks[t.funcno](t, ptr);
  }
}

/** VBlankCB_SlotMachine (LoadOam: the PPU reads the OAM buffer directly) */
function VBlankCB_SlotMachine(): void {
  TransferPlttBuffer();
  ProcessSpriteCopyRequests();
}

/** SetSlotMachineSetupTask: start a setup task in slot `taskId`; it runs its first step now. */
function SetSlotMachineSetupTask(funcno: number, taskId: number): void {
  const ptr = sSetupTaskData!;
  const t = ptr.tasks[taskId];
  t.funcno = funcno;
  t.state = 0;
  t.active = sSlotMachineSetupTasks[funcno](t, ptr);
}

/** IsSlotMachineSetupTaskActive */
function IsSlotMachineSetupTaskActive(taskId: number): boolean {
  return sSetupTaskData!.tasks[taskId].active;
}

type SetupTaskFunc = (t: SetupTask, ptr: SlotMachineSetupTaskData) => boolean;

/** SlotsTask_GraphicsInit */
function SlotsTask_GraphicsInit(t: SetupTask, ptr: SlotMachineSetupTaskData): boolean {
  switch (t.state) {
    case 0:
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      t.state++;
      break;
    case 1: {
      SetVBlankCallback(null);
      ResetSpriteData();
      FreeAllSpritePalettes();
      for (const o of oamBuffer) Object.assign(o, { y: 0, x: 0, affineMode: 0, matrixNum: 0, tileNum: 0 }); // RequestDma3Fill(0, OAM, OAM_SIZE)
      vram.fill(0, 0, 0x20); // RequestDma3Fill(0, VRAM, 0x20): BG0's tile 0
      vram.fill(0, 0xc000, 0xc020); // BG3's tile 0
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      ResetBgPositions();
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
      InitWindows(sWindowTemplates);

      SetBgTilemapBuffer(3, ptr.bg3TilemapBuffer);
      FillBgTilemapBufferRect_Palette0(3, 0, 0, 0, 32, 32);
      CopyBgTilemapBufferToVram(3);

      ResetTempTileDataBuffers();
      DecompressAndCopyTileDataToVram(2, gfx('sBg_Tiles'), 0, 0x00, 0);
      DecompressAndCopyTileDataToVram(2, gfx('sButtonPressed_Tiles'), 0, 0xc0, 0);
      SetBgTilemapBuffer(2, ptr.bg2TilemapBuffer);
      CopyToBgTilemapBuffer(2, gfx16('slot_machine.sBg_Tilemap'), 0, 0x00);
      CopyBgTilemapBufferToVram(2);
      LoadPalette(sBg_Pal(), BG_PLTT_ID(0), sBg_Pal().length * 2);
      LoadPalette(gfx16('sBgPal_MatchLines'), BG_PLTT_ID(PALSLOT_LINE_BET), PLTT_SIZE_4BPP);
      LoadPalette(gfx16('sCombosWindow_Pal'), BG_PLTT_ID(7), gfx16('sCombosWindow_Pal').length * 2);
      LoadPalette([RGB(30, 30, 31)], 0, 2); // SetBackdropColor(RGB(30, 30, 31)): SetBackdropFromPalette
      LoadUserWindowGfx(0, 0x00a, BG_PLTT_ID(13)); // LoadUserWindowGfx2
      LoadStdWindowGfxOnBg(0, 0x001, BG_PLTT_ID(15));

      SetBgTilemapBuffer(0, ptr.bg0TilemapBuffer);
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 2, 32, 30);
      DecompressAndCopyTileDataToVram(1, gfx('sCombosWindow_Tiles'), 0, 0, 0);
      DecompressAndCopyTileDataToVram(1, gfx('sCombosWindow_Tilemap'), 0, 0, 1);
      CopyBgTilemapBufferToVram(1);

      LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(14), PLTT_SIZE_4BPP);
      FillWindowPixelBuffer(1, 0xff);
      PutWindowTilemap(1);

      const controls = text('gString_SlotMachineControls');
      const x = K.DISPLAY_WIDTH - 4 - GetStringWidth(FONT_SMALL, controls, 0);
      const textColor = [TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY];
      AddTextPrinterParameterized3(1, FONT_SMALL, x, 0, textColor, 0, controls);
      CopyBgTilemapBufferToVram(0);

      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | 0x20 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG3 | BLDCNT_TGT1_OBJ | BLDCNT_TGT1_BD | BLDCNT_EFFECT_DARKEN);
      LoadSpriteGraphicsAndAllocateManager();
      CreateReelIconSprites();
      CreateScoreDigitSprites();
      CreateClefairySprites();
      UpdateCoinsDisplay();
      BlendPalettes(PALETTES_ALL, 0x10, RGB_BLACK);
      SetVBlankCallback(VBlankCB_SlotMachine);
      SetHBlankCallback(HBlankCB_SlotMachine);
      t.state++;
      break;
    }
    case 2:
      if (!FreeTempTileDataBuffersIfPossible()) {
        ShowBg(0);
        ShowBg(3);
        ShowBg(2);
        HideBg(1);
        InitReelButtonTileMem();
        BlendPalettes(PALETTES_ALL, 0x10, RGB_BLACK);
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        // EnableInterrupts(INTR_FLAG_VBLANK | INTR_FLAG_HBLANK)
        t.state++;
      }
      break;
    case 3:
      UpdatePaletteFade();
      if (!gPaletteFade.active) return false;
      break;
  }
  return true;
}

/** LoadStdWindowGfxOnBg (text_window.c): LoadStdWindowGfx by bg id. */
function LoadStdWindowGfxOnBg(bgId: number, destOffset: number, palOffset: number): void {
  DecompressAndCopyTileDataToVram(bgId, gfx('gStdTextWindow_Gfx'), 0x120, destOffset, 0);
  LoadPalette(GetTextWindowPalette(3), palOffset, PLTT_SIZE_4BPP);
}

/** SlotsTask_FadeOut */
function SlotsTask_FadeOut(t: SetupTask): boolean {
  switch (t.state) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, 0);
      t.state++;
      break;
    case 1:
      if (!gPaletteFade.active) return false;
      break;
  }
  return true;
}

/** Waits a frame for the BG copy (IsDma3ManagerBusyWithBgCopy), as the C's two-state tasks do. */
function twoStep(t: SetupTask, first: () => void): boolean {
  switch (t.state) {
    case 0:
      first();
      t.state++;
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) return false;
      break;
  }
  return true;
}

/** SlotsTask_UpdateLineStates */
function SlotsTask_UpdateLineStates(t: SetupTask): boolean {
  return twoStep(t, () => {
    SetLineStatesByBet(GetBgTilemapBuffer(2)!);
    CopyBgTilemapBufferToVram(2);
  });
}

/** SlotsTask_ClefairyUpdateOnReelsStart */
function SlotsTask_ClefairyUpdateOnReelsStart(): boolean {
  SetClefairySpriteAnim(1);
  return false;
}

/** SlotsTask_StartClefairyDanceAndWinningLineFlash */
function SlotsTask_StartClefairyDanceAndWinningLineFlash(): boolean {
  SetClefairySpriteAnim(2);
  CreateTask(Task_FlashWinningLine, 3);
  return false;
}

/** SlotsTask_StopWinningLineFlashTask */
function SlotsTask_StopWinningLineFlashTask(t: SetupTask): boolean {
  switch (t.state) {
    case 0:
      SignalStopWinningLineFlashTask();
      t.state++;
      break;
    case 1:
      if (!FuncIsActiveTask(Task_FlashWinningLine)) {
        SetClefairySpriteAnim(0);
        return false;
      }
      break;
  }
  return true;
}

/** SlotsTask_ClefairyFainted */
function SlotsTask_ClefairyFainted(): boolean {
  SetClefairySpriteAnim(3);
  return false;
}

/** SlotsTask_ClefairyNeutral */
function SlotsTask_ClefairyNeutral(): boolean {
  SetClefairySpriteAnim(0);
  return false;
}

/** SlotsTask_UpdateCoinsDisplay */
function SlotsTask_UpdateCoinsDisplay(): boolean {
  UpdateCoinsDisplay();
  return false;
}

/** SlotsTask_MessageOutOfCoins */
function SlotsTask_MessageOutOfCoins(t: SetupTask): boolean {
  return twoStep(t, () => {
    Slot_PrintOnWindow0(text('gString_OutOfCoins'));
    CopyWindowToVram(0, COPYWIN_FULL);
  });
}

/** SlotsTask_AskQuitPlaying */
function SlotsTask_AskQuitPlaying(t: SetupTask): boolean {
  return twoStep(t, () => {
    Slot_PrintOnWindow0(text('gString_QuitPlaying'));
    Slot_CreateYesNoMenu(0);
    CopyWindowToVram(0, COPYWIN_FULL);
  });
}

/** SlotsTask_DestroyYesNoMenu */
function SlotsTask_DestroyYesNoMenu(t: SetupTask): boolean {
  return twoStep(t, () => {
    Slot_ClearWindow0();
    Slot_DestroyYesNoMenu();
    CopyWindowToVram(0, COPYWIN_FULL);
  });
}

/** SlotsTask_PressReelButton */
function SlotsTask_PressReelButton(t: SetupTask, ptr: SlotMachineSetupTaskData): boolean {
  return twoStep(t, () => {
    SetReelButtonPressed(ptr.reelButtonToPress);
    CopyBgTilemapBufferToVram(2);
  });
}

/** SlotsTask_ReleaseReelButtons */
function SlotsTask_ReleaseReelButtons(t: SetupTask): boolean {
  return twoStep(t, () => {
    ReleaseReelButtons();
    CopyBgTilemapBufferToVram(2);
  });
}

/** SlotsTask_ShowHelp: BG1's combos window slides in from the left, 16px a frame, inside WIN0. */
function SlotsTask_ShowHelp(t: SetupTask, ptr: SlotMachineSetupTaskData): boolean {
  switch (t.state) {
    case 0:
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG0 | WININ_WIN0_BG1 | WININ_WIN0_BG2 | WININ_WIN0_BG3 | WININ_WIN0_OBJ | WININ_WIN0_CLR);
      SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, 0));
      SetGpuReg(REG_OFFSET_WIN1H, WIN_RANGE(0, 160));
      ShowBg(1);
      PlaySE(K.SE_WIN_OPEN);
      ptr.bg1X = 0;
      t.state++;
      break;
    case 1:
      ptr.bg1X += 16;
      if (ptr.bg1X >= 256) {
        ptr.bg1X = 256;
        t.state++;
      }
      ChangeBgX(1, 256 * (256 - ptr.bg1X), 0);
      SetGpuReg(REG_OFFSET_WIN0H, (0 << 8) | ptr.bg1X); // WIN_RANGE(0, bg1X): 256 makes it 0x100, X1 1 > X2 0, so X2 = 240
      break;
    case 2:
      return false;
  }
  return true;
}

/** SlotsTask_HideHelp */
function SlotsTask_HideHelp(t: SetupTask, ptr: SlotMachineSetupTaskData): boolean {
  switch (t.state) {
    case 0:
      PlaySE(K.SE_WIN_OPEN);
      t.state++;
    // fallthrough
    case 1:
      ptr.bg1X -= 16;
      if (ptr.bg1X <= 0) {
        ptr.bg1X = 0;
        t.state++;
      }
      ChangeBgX(1, 256 * (256 - ptr.bg1X), 0);
      SetGpuReg(REG_OFFSET_WIN0H, (0 << 8) | ptr.bg1X);
      break;
    case 2:
      HideBg(1);
      ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      t.state++;
      break;
    case 3:
      return false;
  }
  return true;
}

/** sSlotMachineSetupTasks */
const sSlotMachineSetupTasks: SetupTaskFunc[] = [];
sSlotMachineSetupTasks[SLOTTASK_GFX_INIT] = SlotsTask_GraphicsInit;
sSlotMachineSetupTasks[SLOTTASK_FADEOUT_EXIT] = SlotsTask_FadeOut;
sSlotMachineSetupTasks[SLOTTASK_UPDATE_LINE_LIGHTS] = SlotsTask_UpdateLineStates;
sSlotMachineSetupTasks[SLOTTASK_CLEFAIRY_BOUNCE] = SlotsTask_ClefairyUpdateOnReelsStart;
sSlotMachineSetupTasks[SLOTTASK_ANIM_WIN] = SlotsTask_StartClefairyDanceAndWinningLineFlash;
sSlotMachineSetupTasks[SLOTTASK_END_ANIM_WIN] = SlotsTask_StopWinningLineFlashTask;
sSlotMachineSetupTasks[SLOTTASK_ANIM_LOSE] = SlotsTask_ClefairyFainted;
sSlotMachineSetupTasks[SLOTTASK_ANIM_BETTING] = SlotsTask_ClefairyNeutral;
sSlotMachineSetupTasks[SLOTTASK_SHOW_AMOUNTS] = SlotsTask_UpdateCoinsDisplay;
sSlotMachineSetupTasks[SLOTTASK_MSG_NO_COINS] = SlotsTask_MessageOutOfCoins;
sSlotMachineSetupTasks[SLOTTASK_ASK_QUIT] = SlotsTask_AskQuitPlaying;
sSlotMachineSetupTasks[SLOTTASK_DESTROY_YESNO] = SlotsTask_DestroyYesNoMenu;
sSlotMachineSetupTasks[SLOTTASK_PRESS_BUTTON] = SlotsTask_PressReelButton;
sSlotMachineSetupTasks[SLOTTASK_RELEASE_BUTTONS] = SlotsTask_ReleaseReelButtons;
sSlotMachineSetupTasks[SLOTTASK_SHOWHELP] = SlotsTask_ShowHelp;
sSlotMachineSetupTasks[SLOTTASK_HIDEHELP] = SlotsTask_HideHelp;

// ------------------------------------------------------------------ windows, lines, buttons

/** Slot_PrintOnWindow0 */
function Slot_PrintOnWindow0(str: number[]): void {
  FillWindowPixelBuffer(0, PIXEL_FILL(1));
  PutWindowTilemap(0);
  DrawTextBorderOuter(0, 0x001, 15);
  AddTextPrinterParameterized5(0, FONT_NORMAL, str, 1, 2, TEXT_SKIP_DRAW, 1, 2);
}

/** AddTextPrinterParameterized5 (menu2.c), without the callback (always NULL here). */
function AddTextPrinterParameterized5(windowId: number, fontId: number, str: number[], x: number, y: number, speed: number, letterSpacing: number, lineSpacing: number): void {
  AddTextPrinter(
    {
      currentChar: str,
      windowId,
      fontId,
      x,
      y,
      currentX: x,
      currentY: y,
      letterSpacing,
      lineSpacing,
      fgColor: GetFontAttribute(fontId, FONTATTR_COLOR_FOREGROUND),
      bgColor: GetFontAttribute(fontId, FONTATTR_COLOR_BACKGROUND),
      shadowColor: GetFontAttribute(fontId, FONTATTR_COLOR_SHADOW),
    },
    speed,
  );
}

/** Slot_ClearWindow0: rbox_fill_rectangle (text_window.c) */
function Slot_ClearWindow0(): void {
  const bg = GetWindowAttribute(0, 'bg');
  const left = GetWindowAttribute(0, 'tilemapLeft');
  const top = GetWindowAttribute(0, 'tilemapTop');
  const width = GetWindowAttribute(0, 'width');
  const height = GetWindowAttribute(0, 'height');
  FillBgTilemapBufferRect(bg, 0, left - 1, top - 1, width + 2, height + 2, 17);
}

/** SetLineStatesByBet: the lines the bet covers light up (1: middle, 2: + top and bottom, 3: + diagonals). */
function SetLineStatesByBet(bgTilemapBuffer: Uint16Array): void {
  switch (GetPlayerBet()) {
    case 0:
      for (let i = 0; i < NUM_MATCH_LINES; i++) SetLineState(bgTilemapBuffer, i, PALSLOT_LINE_NORMAL);
      break;
    // fallthroughs as in the C
    case 3:
      SetLineState(bgTilemapBuffer, 0, PALSLOT_LINE_BET);
      SetLineState(bgTilemapBuffer, 4, PALSLOT_LINE_BET);
    // fallthrough
    case 2:
      SetLineState(bgTilemapBuffer, 1, PALSLOT_LINE_BET);
      SetLineState(bgTilemapBuffer, 3, PALSLOT_LINE_BET);
    // fallthrough
    case 1:
      SetLineState(bgTilemapBuffer, 2, PALSLOT_LINE_BET);
      break;
  }
}

/** SetLineState: repaint a line's tiles with `paletteNum`. */
function SetLineState(bgTilemapBuffer: Uint16Array, whichLine: number, paletteNum: number): void {
  const palMask = (paletteNum & 0xf) << 12;
  for (const idx of sLineStateTileIdxs[whichLine]) {
    bgTilemapBuffer[idx] &= 0x0fff;
    bgTilemapBuffer[idx] |= palMask;
  }
}

/** Task_FlashWinningLine: the winning lines and the payout lights flash until SignalStopWinningLineFlashTask. */
function Task_FlashWinningLine(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      LoadPalette(gfx16('sBgPal_MatchLines'), BG_PLTT_ID(PALSLOT_LINE_MATCH), PLTT_SIZE_4BPP);
      for (let i = 0; i < NUM_MATCH_LINES; i++) {
        if (GetWinFlagByLine(i)) SetLineState(GetBgTilemapBuffer(2)!, i, PALSLOT_LINE_MATCH);
      }
      CopyBgTilemapBufferToVram(2);
      data[0]++;
      break;
    case 1: {
      if (data[1] === 0) {
        const y = (gSineTable(data[2]) >> 7) & 0xffff;
        LoadPalette(gfx16('sBgPal_PayoutLight').subarray(y * 16, y * 16 + 16), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
        data[2] += 32;
        data[2] &= 0x7f;
        data[1] = 8;
      } else {
        data[1]--;
      }

      if (data[3] === 0) {
        data[4] += 8;
        data[4] &= 0x7f;
        data[5] = gSineTable(data[4]) >> 5;
        BlendPalettes(1 << PALSLOT_LINE_MATCH, data[5], RGB_BLACK);
      } else {
        data[4]++;
        if (data[4] > 1) {
          data[4] = 0;
          data[5]++;
          data[5] &= 1;
          BlendPalettes(1 << PALSLOT_LINE_MATCH, data[5] * 8, RGB_BLACK);
        }
      }

      for (const idx of sWinningLineFlashPalIdxs) gPlttBufferFaded[idx + BG_PLTT_ID(PALSLOT_LINE_MATCH)] = gPlttBufferUnfaded[idx + BG_PLTT_ID(PALSLOT_LINE_MATCH)];
      break;
    }
    case 2:
      // Restore match lines to normal color
      for (let i = 0; i < NUM_MATCH_LINES; i++) {
        if (GetWinFlagByLine(i)) SetLineState(GetBgTilemapBuffer(2)!, i, PALSLOT_LINE_NORMAL);
      }
      // Restore payout lights to normal color
      LoadPalette(sBg_Pal().subarray(16, 32), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      CopyBgTilemapBufferToVram(2);
      data[0]++;
      break;
    case 3:
      if (!IsDma3ManagerBusyWithBgCopy()) DestroyTask(taskId);
      break;
  }
}

/** SignalStopWinningLineFlashTask */
function SignalStopWinningLineFlashTask(): void {
  gTasks[FindTaskIdByFunc(Task_FlashWinningLine)].data[0] = 2;
}

/** Slot_CreateYesNoMenu */
function Slot_CreateYesNoMenu(cursorPos: number): void {
  CreateYesNoMenu(sYesNoWindowTemplate, FONT_NORMAL, 0, 2, 10, 13, cursorPos);
  Menu_MoveCursorNoWrapAround(cursorPos);
  sSetupTaskData!.yesNoMenuActive = true;
}

/** Slot_DestroyYesNoMenu */
function Slot_DestroyYesNoMenu(): void {
  const data = sSetupTaskData!;
  if (data.yesNoMenuActive) {
    DestroyYesNoMenu();
    data.yesNoMenuActive = false;
  }
}

/** InitReelButtonTileMem: the released buttons are what the tilemap has; the pressed ones are tiles 0xC0+. */
function InitReelButtonTileMem(): void {
  const data = sSetupTaskData!;
  const buffer = GetBgTilemapBuffer(2)!;
  for (let i = 0; i < NUM_REELS; i++) {
    for (let j = 0; j < NUM_BUTTON_TILES; j++) {
      data.buttonReleasedTiles[i][j] = buffer[sReelButtonMapTileIdxs[i][j]];
      data.buttonPressedTiles[i][j] = j + 0xc0;
    }
  }
}

/** SetReelButtonPressed */
function SetReelButtonPressed(reel: number): void {
  if (reel < NUM_REELS) {
    const data = sSetupTaskData!;
    const buffer = GetBgTilemapBuffer(2)!;
    for (let i = 0; i < NUM_BUTTON_TILES; i++) buffer[sReelButtonMapTileIdxs[reel][i]] = data.buttonPressedTiles[reel][i];
  }
}

/** ReleaseReelButtons */
function ReleaseReelButtons(): void {
  const data = sSetupTaskData!;
  const buffer = GetBgTilemapBuffer(2)!;
  for (let i = 0; i < NUM_REELS; i++) {
    for (let j = 0; j < NUM_BUTTON_TILES; j++) buffer[sReelButtonMapTileIdxs[i][j]] = data.buttonReleasedTiles[i][j];
  }
}

/** PressReelButton */
function PressReelButton(reel: number, taskId: number): void {
  sSetupTaskData!.reelButtonToPress = reel;
  SetSlotMachineSetupTask(SLOTTASK_PRESS_BUTTON, taskId);
}

// ------------------------------------------------------------------ test probe

/** For tests (__test.slotMachine()): the main task and its step, the game state, what's drawn. */
export function slotMachineProbe() {
  if (!sScreen || !sSlotMachineGfxManager) return undefined;
  const main = gTasks[sScreen.taskId];
  const s = sSlotMachineState;
  const digits = (sprites: Sprite[]) => Number(sprites.map((sp) => sp.animNum).join(''));
  return {
    mainTask: main.isActive ? main.func.name : undefined,
    step: main.data[0],
    ready: gMain.callback2 === CB2_RunSlotMachine && !gPaletteFade.active,
    machineIdx: s.machineIdx,
    machineBias: s.machineBias,
    bet: s.bet,
    currentReel: s.currentReel,
    reelIsSpinning: [...s.reelIsSpinning],
    reelPositions: [...s.reelPositions],
    winFlags: [...s.winFlags],
    payout: s.payout,
    slotRewardClass: s.slotRewardClass,
    credit: digits(sSlotMachineGfxManager.creditDigitSprites),
    payoutShown: digits(sSlotMachineGfxManager.payoutDigitSprites),
    clefairyAnim: sSlotMachineGfxManager.clefairySprites[0].animNum,
    helpShown: sSetupTaskData?.bg1X ?? 0,
    flashing: FuncIsActiveTask(Task_FlashWinningLine),
    yesNo: sSetupTaskData?.yesNoMenuActive ?? false,
    /** Each line's lights' palette in the BG2 tilemap (4 normal, 5 bet, 6 won), in winFlags order. */
    linePalettes: sLineStateTileIdxs.map((idxs) => (GetBgTilemapBuffer(2)![idxs[0]] >> 12) & 0xf),
    /** Whether each reel's button shows pressed. */
    buttonsPressed: sReelButtonMapTileIdxs.map((idxs) => GetBgTilemapBuffer(2)![idxs[0]] === 0xc0),
  };
}
