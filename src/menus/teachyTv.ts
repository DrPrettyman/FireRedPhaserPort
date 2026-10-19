// teachy_tv.c: Teachy TV. The TV room (BG1: the set from graphics/teachy_tv; BG2: the noise, then the show's title;
// BG3: a piece of Route 1 built from its map layout and tilesets, TeachyTvLoadBg3Map), the Pokédude (the
// OBJ_EVENT_GFX_TEACHY_TV_HOST object), the six-option list (four without the TM case) with its scroll arrows, and
// the TTVcmd sequences each option runs: the noise, the title, the Pokédude walking in and talking, walking into the
// grass (with the tall grass field effect) and then the demo, his closing words, walking off, the end graphic.
// From the bag (InitTeachyTvFromBag) it returns to the bag; from the field (SELECT: Task_InitTeachyTvFromField) to
// the field. Both are in menus/itemUse.ts (FieldUseFunc_TeachyTv).
//
// The four battle options run the Pokédude's battle (TeachyTvPrepBattle: battle/controllerPokedude.ts, on this
// screen's host, then back here through TeachyTvRestorePlayerPartyCallback). Not ported (FIELD_ITEMS_PLAN.md W-teachy
// unit 3): the field demos, the scripted bag and TM case of TTVSCR_REGISTER / _TMS. They go through the seam at the
// bottom of this file (PokedudeDemoNotPorted), which logs and comes back as from the demo's end.

import { K } from '../battle/constants';
import { g, ResetBattleGlobals, state } from '../battle/env';
import { CB2_InitBattle } from '../battle/battleCallbacks';
import { PlayMapChosenOrBattleBGM } from '../battle/battleBgm';
import { setBattleUi, type BattleUi, type GbaButton } from '../battle/battleUi';
import { InitPokedudePartyAndOpponent, LoadPlayerParty, pokedudeBattleMons, SavePlayerParty } from '../battle/controllerPokedude';
import { battleTransitionGfxSymbols, BattleTransition_StartOnField, IsBattleTransitionDone } from '../battle/transition';
import { testEvent } from '../dev/testHooks';
import { itemIconSymbols } from './itemMenuIcons';
import { monIconSymbol } from './pokemonIcon';
import type { Assets } from '../data/assets';
import type { TilesetSymbols } from '../data/types';
import {
  BG_COORD_ADD,
  BG_COORD_SET,
  BG_COORD_SUB,
  ChangeBgX,
  ChangeBgY,
  CopyToBgTilemapBufferRect_ChangePalette,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
  GetBgX,
  GetBgY,
  InitBgsFromTemplates,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16, loadGfx } from '../gba/gfx';
import {
  PALETTES_ALL,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
} from '../gba/hw';
import {
  DestroyListMenuTask,
  gMultiuseListMenuTemplate,
  LIST_CANCEL,
  LIST_NOTHING_CHOSEN,
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuInit,
  type ListMenuItem,
  type ListMenuTemplate,
} from '../gba/listMenu';
import {
  A_BUTTON,
  B_BUTTON,
  DPAD_DOWN,
  DPAD_LEFT,
  DPAD_RIGHT,
  DPAD_UP,
  gMain,
  JOY_HELD,
  JOY_NEW,
  L_BUTTON,
  R_BUTTON,
  SELECT_BUTTON,
  SetMainCallback1,
  SetMainCallback2,
  SetVBlankCallback,
  START_BUTTON,
  type MainCallback,
} from '../gba/main';
import {
  ClearScheduledBgCopiesToVram,
  DecompressAndCopyTileDataToVram,
  DoScheduledBgTilemapCopiesToVram,
  FreeTempTileDataBuffersIfPossible,
  GetTextSpeedSetting,
  AddTextPrinterParameterized2,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ResetTempTileDataBuffers,
  RunTextPrinters_CheckActive,
  ScheduleBgCopyTilemapToVram,
  SetVBlankHBlankCallbacksToNull,
} from '../gba/menu';
import { Overworld_PlaySpecialMapMusic } from '../gba/overworldMusic';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadCompressedPalette, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlayNewMapMusic, PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SeekSpriteAnim,
  SetSubspriteTables,
  SpriteCallbackDummy,
  StartSpriteAnim,
  TAG_NONE,
  type Sprite,
  type SpriteTemplate,
  type SubspriteTable,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import { ClearWindowTilemap, COPYWIN_GFX, CopyWindowToVram, DeactivateAllTextPrinters, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, FreeAllWindowBuffers, gTextFlags, InitWindows, IsTextPrinterActive, PutWindowTilemap, type WindowTemplate } from '../gba/window';
import { SetHelpContextDontCheckBattle } from '../ui/helpSystemContext';
import { random } from '../util/random';
import { CheckBagHasItem, text } from './common';
import { CB2_BagMenuFromStartMenu } from './itemMenu';
import { AddScrollIndicatorArrowPair, RemoveScrollIndicatorArrowPair, SCROLL_ARROW_DOWN, SCROLL_ARROW_UP, type ScrollArrowsTemplate } from './menuIndicators';
import { CreateObjectGraphicsSprite, objectEventGfxSymbols, setObjectEventGraphicsInfo } from './objectEventGraphics';

// enum TeachyTvScript (teachy_tv.h)
export const TTVSCR_BATTLE = 0;
export const TTVSCR_STATUS = 1;
export const TTVSCR_MATCHUPS = 2;
export const TTVSCR_CATCHING = 3;
export const TTVSCR_TMS = 4;
export const TTVSCR_REGISTER = 5;

const TEACHY_TV_HOST = 'OBJ_EVENT_GFX_TEACHY_TV_HOST';

/** The graphics the screen loads beyond Route 1's tilesets and the Pokédude (TeachyTvLoadGraphic, the grass). */
const TEACHY_TV_GFX = [
  'gTeachyTv_Gfx',
  'gTeachyTvScreen_Tilemap',
  'gTeachyTvTitle_Tilemap',
  'gTeachyTv_Pal',
  'gFieldEffectObjectPalette1',
  'gFieldEffectObjectPic_TallGrass',
  'sRedArrowOtherGfx',
  'sRedArrowPal',
];

// fieldmap.h
const NUM_TILES_IN_PRIMARY = 640;
const NUM_TILES_TOTAL = 1024;
const NUM_METATILES_IN_PRIMARY = 640;
const NUM_PALS_IN_PRIMARY = 7;
const TILE_SIZE_4BPP = 32;

/** Route1_Layout as TeachyTvLoadBg3Map reads it: the map's blocks and its two tilesets. */
interface TeachyTvLayout {
  width: number;
  map: number[];
  primaryTileset: TilesetSymbols;
  secondaryTileset: TilesetSymbols;
}
let sRoute1Layout: TeachyTvLayout | undefined;

/**
 * Before the screen can run (it draws synchronously): Route 1's layout (`&Route1_Layout`), its tilesets'
 * graphics, the Teachy TV graphics and the Pokédude's object. FieldMenuScene calls it when the bag holds Teachy TV
 * (the bag, and a registered item opened from the field).
 */
export async function prepareTeachyTv(assets: Assets): Promise<void> {
  setObjectEventGraphicsInfo(assets.sprites);
  if (!sRoute1Layout) {
    const layout = await assets.loadLayout('LAYOUT_ROUTE1');
    const ts = assets.tilesetSymbols(layout.tilesetPair);
    sRoute1Layout = { width: layout.width, map: layout.blocks, primaryTileset: ts.primary, secondaryTileset: ts.secondary };
  }
  const l = sRoute1Layout;
  await loadGfx([
    ...TEACHY_TV_GFX,
    ...[l.primaryTileset, l.secondaryTileset].flatMap((t) => [t.tiles, t.palettes, t.metatiles]),
    ...objectEventGfxSymbols([TEACHY_TV_HOST]),
    ...pokedudeDemoGfxSymbols(),
  ]);
}

/**
 * What the Pokédude's battle demos draw beyond the battle itself (FieldMenuScene loads pokedudeBattleGfxSymbols): the
 * transitions, his bag's item icons (InitPokedudeBag) and his mons' party menu icons.
 */
function pokedudeDemoGfxSymbols(): string[] {
  const items = [K.ITEM_POTION, K.ITEM_ANTIDOTE, K.ITEM_TEACHY_TV, K.ITEM_TM_CASE, K.ITEM_POKE_BALL, K.ITEM_GREAT_BALL, K.ITEM_NEST_BALL];
  return [
    ...battleTransitionGfxSymbols(K.B_TRANSITION_WHITE_BARS_FADE),
    ...battleTransitionGfxSymbols(K.B_TRANSITION_SLICE),
    ...itemIconSymbols(items),
    ...pokedudeBattleMons().map((mon) => monIconSymbol(mon.species)),
  ];
}

/** struct TeachyTvCtrlBlk: kept while the demos run, so the screen can come back to the same option. */
const sStaticResources = {
  callback: null as MainCallback | null,
  mode: 0,
  whichScript: TTVSCR_BATTLE,
  scrollOffset: 0,
  selectedRow: 0,
};

/** struct TeachyTvBuf (sResources): allocated while the screen is up. */
interface TeachyTvBuf {
  savedCallback: MainCallback | null;
  screenTilemap: Uint16Array;
  buffer2: Uint16Array;
  buffer3: Uint16Array;
  titleTilemap: Uint16Array;
  grassAnimCounterLo: number;
  grassAnimCounterHi: number;
  grassAnimDisabled: number;
  scrollIndicatorArrowPairId: number;
  /** For the probe: the string symbol the text window printed last. */
  lastText?: string;
}
let sResources: TeachyTvBuf | null = null;
/**
 * The buffer TeachyTvFree freed last: TeachyTvPrepBattle frees it while the grass sprites can still be up for the
 * battle transition, and their callback reads it (on the GBA, from the freed heap).
 */
let sFreedResources: TeachyTvBuf | null = null;

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 2, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 3, baseBlock: 0x0ea },
  { bg: 0, tilemapLeft: 4, tilemapTop: 1, width: 22, height: 12, paletteNum: 3, baseBlock: 0x152 },
  DUMMY_WIN_TEMPLATE,
];

const sListMenuItems = (): ListMenuItem[] => [
  { label: text('gTeachyTvString_TeachBattle'), index: TTVSCR_BATTLE },
  { label: text('gTeachyTvString_StatusProblems'), index: TTVSCR_STATUS },
  { label: text('gTeachyTvString_TypeMatchups'), index: TTVSCR_MATCHUPS },
  { label: text('gTeachyTvString_CatchPkmn'), index: TTVSCR_CATCHING },
  { label: text('gTeachyTvString_AboutTMs'), index: TTVSCR_TMS },
  { label: text('gTeachyTvString_RegisterItem'), index: TTVSCR_REGISTER },
  { label: text('gTeachyTvString_Cancel'), index: LIST_CANCEL },
];

const sListMenuItems_NoTMCase = (): ListMenuItem[] => [
  { label: text('gTeachyTvString_TeachBattle'), index: TTVSCR_BATTLE },
  { label: text('gTeachyTvString_StatusProblems'), index: TTVSCR_STATUS },
  { label: text('gTeachyTvString_TypeMatchups'), index: TTVSCR_MATCHUPS },
  { label: text('gTeachyTvString_CatchPkmn'), index: TTVSCR_CATCHING },
  { label: text('gTeachyTvString_Cancel'), index: LIST_CANCEL },
];

const sListMenuTemplate = (): ListMenuTemplate => ({
  items: sListMenuItems(),
  moveCursorFunc: null,
  itemPrintFunc: null,
  totalItems: 7,
  maxShowed: 6,
  windowId: 0,
  header_X: 0,
  item_X: 8,
  cursor_X: 0,
  upText_Y: 6,
  cursorPal: 1,
  fillValue: 0,
  cursorShadowPal: 2,
  lettersSpacing: 0,
  itemVerticalPadding: 0,
  scrollMultiple: 1,
  fontId: K.FONT_NORMAL,
  cursorKind: 0,
});

const sScrollIndicatorArrowPair: ScrollArrowsTemplate = {
  firstArrowType: SCROLL_ARROW_UP,
  firstX: 0x78,
  firstY: 0xc,
  secondArrowType: SCROLL_ARROW_DOWN,
  secondX: 0x78,
  secondY: 0x64,
  fullyUpThreshold: 0,
  fullyDownThreshold: 1,
  tileTag: 0x800,
  palTag: 0x800,
  palNum: 0,
};

/** The step each option's script carries on from when the screen comes back after its demo (mode 2). */
const sWhereToReturnToFromBattle = [12, 12, 12, 12, 9, 9];

type TTVcmd = (taskId: number) => void;

// sBattleScript, sStatusScript, sMatchupsScript and sCatchingScript are the same list.
const sBattleScript: TTVcmd[] = [
  TTVcmd_TransitionRenderBg2TeachyTvGraphicInitNpcPos,
  TTVcmd_ClearBg2TeachyTvGraphic,
  TTVcmd_NpcMoveAndSetupTextPrinter,
  TTVcmd_IdleIfTextPrinterIsActive,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_TextPrinterSwitchStringByOptionChosen,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_EraseTextWindowIfKeyPressed,
  TTVcmd_StartAnimNpcWalkIntoGrass,
  TTVcmd_DudeMoveUp,
  TTVcmd_DudeMoveRight,
  TTVcmd_TaskBattleOrFadeByOptionChosen,
  TTVcmd_TextPrinterSwitchStringByOptionChosen2,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_EraseTextWindowIfKeyPressed,
  TTVcmd_DudeTurnLeft,
  TTVcmd_DudeMoveLeft,
  TTVcmd_RenderAndRemoveBg1EndGraphic,
  TTVcmd_End,
];

// sTMsScript and sRegisterKeyItemScript are the same list: no walk into the grass.
const sTMsScript: TTVcmd[] = [
  TTVcmd_TransitionRenderBg2TeachyTvGraphicInitNpcPos,
  TTVcmd_ClearBg2TeachyTvGraphic,
  TTVcmd_NpcMoveAndSetupTextPrinter,
  TTVcmd_IdleIfTextPrinterIsActive,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_TextPrinterSwitchStringByOptionChosen,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_EraseTextWindowIfKeyPressed,
  TTVcmd_TaskBattleOrFadeByOptionChosen,
  TTVcmd_TextPrinterSwitchStringByOptionChosen2,
  TTVcmd_IdleIfTextPrinterIsActive2,
  TTVcmd_EraseTextWindowIfKeyPressed,
  TTVcmd_DudeTurnLeft,
  TTVcmd_DudeMoveLeft,
  TTVcmd_RenderAndRemoveBg1EndGraphic,
  TTVcmd_End,
];

/** TeachyTvRenderMsgAndSwitchClusterFuncs' array, by TTVSCR_* */
const sScripts: TTVcmd[][] = [sBattleScript, sBattleScript, sBattleScript, sBattleScript, sTMsScript, sTMsScript];

function TeachyTvCallback(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function TeachyTvVblankHandler(): void {
  // LoadOam: the PPU reads the OAM buffer
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** InitTeachyTvController: mode 0 from the bag or the field (the list from the top), 1 back to the list, 2 after a demo. */
export function InitTeachyTvController(mode: number, cb: MainCallback): void {
  sStaticResources.mode = mode;
  sStaticResources.callback = cb;
  if (mode === 0) {
    sStaticResources.scrollOffset = 0;
    sStaticResources.selectedRow = 0;
    sStaticResources.whichScript = TTVSCR_BATTLE;
  }
  if (mode === 1) sStaticResources.mode = 0;
  SetMainCallback2(TeachyTvMainCallback);
}

/** CB2_ReturnToTeachyTV: the demos come back here, to the list (resume, after B) or to the option's closing text. */
export function CB2_ReturnToTeachyTV(): void {
  if (sStaticResources.mode === 1) InitTeachyTvController(1, sStaticResources.callback!);
  else InitTeachyTvController(2, sStaticResources.callback!);
}

export function SetTeachyTvControllerModeToResume(): void {
  sStaticResources.mode = 1;
}

function TeachyTvMainCallback(): void {
  switch (gMain.state) {
    case 0: {
      sResources = {
        savedCallback: null,
        screenTilemap: new Uint16Array(0x400),
        buffer2: new Uint16Array(0x400),
        buffer3: new Uint16Array(0x400),
        titleTilemap: new Uint16Array(0x400),
        grassAnimCounterLo: 0,
        grassAnimCounterHi: 0,
        grassAnimDisabled: 0,
        scrollIndicatorArrowPairId: 0xff,
      };
      SetVBlankHBlankCallbacksToNull();
      ClearScheduledBgCopiesToVram();
      ScanlineEffect_Stop();
      FreeAllSpritePalettes();
      ResetPaletteFade();
      ResetSpriteData();
      ResetTasks();
      TeachyTvSetupBg();
      TeachyTvLoadGraphic();
      gMain.state++;
      break;
    }
    case 1: {
      if (FreeTempTileDataBuffersIfPossible()) return;
      TeachyTvCreateAndRenderRbox();
      TeachyTvInitIo();
      if (sStaticResources.mode === 2) {
        const taskId = CreateTask(TeachyTvPostBattleFadeControl, 0);
        gTasks[taskId].data[1] = TeachyTvSetupObjEventAndOam();
        TeachyTvSetupPostBattleWindowAndObj(taskId);
      } else {
        const taskId = CreateTask(TeachyTvOptionListController, 0);
        gTasks[taskId].data[0] = TeachyTvSetupWindow();
        gTasks[taskId].data[1] = TeachyTvSetupObjEventAndOam();
        TeachyTvSetupScrollIndicatorArrowPair();
        PlayNewMapMusic(K.MUS_TEACHY_TV_MENU);
        TeachyTvSetWindowRegs();
      }
      ScheduleBgCopyTilemapToVram(0);
      ScheduleBgCopyTilemapToVram(1);
      ScheduleBgCopyTilemapToVram(2);
      ScheduleBgCopyTilemapToVram(3);
      SetHelpContextDontCheckBattle(K.HELPCONTEXT_BAG);
      BlendPalettes(PALETTES_ALL, 0x10, 0);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, 0);
      SetVBlankCallback(TeachyTvVblankHandler);
      SetMainCallback2(TeachyTvCallback);
      break;
    }
  }
}

function TeachyTvSetupBg(): void {
  const r = sResources!;
  ResetAllBgsCoordinatesAndBgCntRegs();
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, 4);
  SetBgTilemapBuffer(1, r.screenTilemap);
  SetBgTilemapBuffer(2, r.buffer2);
  SetBgTilemapBuffer(3, r.buffer3);
  SetGpuReg(REG_OFFSET_DISPCNT, 0x3040); // WIN0, OBJ, 1D OBJ mapping
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
  ChangeBgX(3, 0x1000, BG_COORD_SUB);
  ChangeBgY(3, 0x2800, BG_COORD_ADD);
  r.grassAnimCounterLo = 0;
  r.grassAnimCounterHi = 3;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
}

function TeachyTvLoadGraphic(): void {
  const r = sResources!;
  ResetTempTileDataBuffers();
  DecompressAndCopyTileDataToVram(1, gfx('gTeachyTv_Gfx'), 0, 0, 0);
  r.screenTilemap.set(gfx16('gTeachyTvScreen_Tilemap').subarray(0, 0x400)); // LZDecompressWram
  r.titleTilemap.set(gfx16('gTeachyTvTitle_Tilemap').subarray(0, 0x400));
  LoadCompressedPalette(gfx16('gTeachyTv_Pal'), BG_PLTT_ID(0), 4 * PLTT_SIZE_4BPP);
  LoadPalette([RGB_BLACK], BG_PLTT_ID(0), 2);
  LoadSpritePalette(gSpritePalette_GeneralFieldEffect1());
  TeachyTvLoadBg3Map(r.buffer3);
}

function TeachyTvCreateAndRenderRbox(): void {
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  FillWindowPixelBuffer(0, 0xcc);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  CopyWindowToVram(0, COPYWIN_GFX);
}

function TeachyTvSetupWindow(): number {
  const t = gMultiuseListMenuTemplate;
  Object.assign(t, sListMenuTemplate());
  t.windowId = 1;
  t.moveCursorFunc = TeachyTvAudioByInput;
  if (!CheckBagHasItem(K.ITEM_TM_CASE, 1)) {
    t.items = sListMenuItems_NoTMCase();
    t.totalItems = 5;
    t.maxShowed = 5;
    t.upText_Y = (t.upText_Y + 8) & 0xf;
  }
  return ListMenuInit(t, sStaticResources.scrollOffset, sStaticResources.selectedRow);
}

function TeachyTvSetupScrollIndicatorArrowPair(): void {
  if (!CheckBagHasItem(K.ITEM_TM_CASE, 1)) sResources!.scrollIndicatorArrowPairId = 0xff;
  else sResources!.scrollIndicatorArrowPairId = AddScrollIndicatorArrowPair(sScrollIndicatorArrowPair, () => sStaticResources.scrollOffset);
}

function TeachyTvRemoveScrollIndicatorArrowPair(): void {
  if (sResources!.scrollIndicatorArrowPairId !== 0xff) {
    RemoveScrollIndicatorArrowPair(sResources!.scrollIndicatorArrowPairId);
    sResources!.scrollIndicatorArrowPairId = 0xff;
  }
}

function TeachyTvAudioByInput(_notUsed: number, play: boolean): void {
  if (play !== true) PlaySE(K.SE_SELECT);
}

function TeachyTvInitIo(): void {
  SetGpuReg(REG_OFFSET_WININ, 0x3f);
  SetGpuReg(REG_OFFSET_WINOUT, 0x1f);
  SetGpuReg(REG_OFFSET_BLDCNT, 0xcc); // darken BG2 and BG3 inside WIN0 (the list's frame)
  SetGpuReg(REG_OFFSET_BLDY, 0x5);
}

function TeachyTvSetupObjEventAndOam(): number {
  const objId = CreateObjectGraphicsSprite(TEACHY_TV_HOST, SpriteCallbackDummy, 0, 0, 8);
  gSprites[objId].oam.priority = 2;
  gSprites[objId].invisible = true;
  return objId;
}

function TeachyTvSetSpriteCoordsAndSwitchFrame(objId: number, x: number, y: number, frame: number): void {
  gSprites[objId].x2 = x;
  gSprites[objId].y2 = y;
  gSprites[objId].invisible = false;
  StartSpriteAnim(gSprites[objId], frame);
}

function TeachyTvSetWindowRegs(): void {
  SetGpuReg(REG_OFFSET_WIN0V, 0xc64);
  SetGpuReg(REG_OFFSET_WIN0H, 0x1cd4);
}

function TeachyTvClearWindowRegs(): void {
  SetGpuReg(REG_OFFSET_WIN0V, 0x0);
  SetGpuReg(REG_OFFSET_WIN0H, 0x0);
}

/** TeachyTvBg2AnimController: the noise, tile 0x1F in palette 3 with random flips, redrawn every frame. */
function TeachyTvBg2AnimController(): void {
  const tilemapBuffer = GetBgTilemapBuffer(2)!;
  for (let i = 1; i < 13; i++) {
    for (let j = 2; j < 28; j++) tilemapBuffer[32 * i + j] = ((random() & 3) << 10) + 0x301f;
  }
  ScheduleBgCopyTilemapToVram(2);
}

function TeachyTvSetupPostBattleWindowAndObj(taskId: number): void {
  const data = gTasks[taskId].data;
  const obj = gSprites[data[1]];
  const r = sResources!;
  ClearWindowTilemap(1);
  TeachyTvClearWindowRegs();
  switch (sStaticResources.whichScript) {
    case TTVSCR_BATTLE:
    case TTVSCR_STATUS:
    case TTVSCR_MATCHUPS:
    case TTVSCR_CATCHING:
      TeachyTvSetSpriteCoordsAndSwitchFrame(data[1], 0x78, 0x38, 0);
      ChangeBgX(3, 0x3000, BG_COORD_ADD);
      ChangeBgY(3, 0x3000, BG_COORD_SUB);
      r.grassAnimCounterLo = (r.grassAnimCounterLo + 3) & 0xff;
      r.grassAnimCounterHi = (r.grassAnimCounterHi - 3) & 0xff;
      break;
    case TTVSCR_TMS:
    case TTVSCR_REGISTER:
      TeachyTvSetSpriteCoordsAndSwitchFrame(data[1], 0x78, 0x38, 0);
      break;
  }
  data[4] = 0;
  data[5] = 0;
  TeachyTvGrassAnimationMain(taskId, obj.x2, obj.y2, 0, true);
}

/** TeachyTvInitTextPrinter: the Pokédude's words in the bottom window, at the player's text speed. */
function TeachyTvInitTextPrinter(symbol: string): void {
  gTextFlags.autoScroll = false;
  sResources!.lastText = symbol;
  AddTextPrinterParameterized2(0, K.FONT_MALE, text(symbol), GetTextSpeedSetting(), 1, 0xc, 3);
}

function TeachyTvFree(): void {
  sFreedResources = sResources;
  sResources = null;
  FreeAllWindowBuffers();
}

function TeachyTvQuitBeginFade(taskId: number): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, 0);
  gTasks[taskId].func = TeachyTvQuitFadeControlAndTaskDel;
}

function TeachyTvQuitFadeControlAndTaskDel(taskId: number): void {
  if (!gPaletteFade.active) {
    if (sResources!.savedCallback !== null) {
      SetMainCallback2(sResources!.savedCallback);
    } else {
      Overworld_PlaySpecialMapMusic();
      SetMainCallback2(sStaticResources.callback);
    }
    TeachyTvFree();
    DestroyTask(taskId);
  }
}

function TeachyTvOptionListController(taskId: number): void {
  const data = gTasks[taskId].data;
  TeachyTvBg2AnimController();
  if (!gPaletteFade.active) {
    const input = ListMenu_ProcessInput(data[0]);
    const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(data[0]);
    sStaticResources.scrollOffset = cursorPos;
    sStaticResources.selectedRow = itemsAbove;
    if (JOY_NEW(SELECT_BUTTON) && sStaticResources.callback !== CB2_BagMenuFromStartMenu) {
      PlaySE(K.SE_SELECT);
      TeachyTvQuitBeginFade(taskId);
    } else {
      switch (input) {
        case LIST_NOTHING_CHOSEN:
          break;
        case LIST_CANCEL:
          PlaySE(K.SE_SELECT);
          TeachyTvQuitBeginFade(taskId);
          break;
        default: {
          PlaySE(K.SE_SELECT);
          sStaticResources.whichScript = input;
          const out = { cursorPos: 0, itemsAbove: 0 };
          DestroyListMenuTask(data[0], out);
          sStaticResources.scrollOffset = out.cursorPos;
          sStaticResources.selectedRow = out.itemsAbove;
          TeachyTvClearWindowRegs();
          ClearWindowTilemap(1);
          ScheduleBgCopyTilemapToVram(0);
          TeachyTvRemoveScrollIndicatorArrowPair();
          data[3] = 0;
          data[2] = 0;
          gTasks[taskId].func = TeachyTvRenderMsgAndSwitchClusterFuncs;
          break;
        }
      }
    }
  }
}

/** The noise for 64 frames, then the show's title over it and the Pokédude at the left edge, to MUS_FOLLOW_ME. */
function TTVcmd_TransitionRenderBg2TeachyTvGraphicInitNpcPos(taskId: number): void {
  const data = gTasks[taskId].data;
  TeachyTvBg2AnimController();
  if (++data[2] > 63) {
    CopyToBgTilemapBufferRect_ChangePalette(2, sResources!.titleTilemap, 0, 0, 0x20, 0x20, 0x11);
    TeachyTvSetSpriteCoordsAndSwitchFrame(data[1], 8, 0x38, 7);
    ScheduleBgCopyTilemapToVram(2);
    data[2] = 0;
    ++data[3];
    PlayNewMapMusic(K.MUS_FOLLOW_ME);
  }
}

function TTVcmd_ClearBg2TeachyTvGraphic(taskId: number): void {
  const data = gTasks[taskId].data;
  if (++data[2] === 134) {
    FillBgTilemapBufferRect_Palette0(2, 0, 2, 1, 0x1a, 0xc);
    ScheduleBgCopyTilemapToVram(2);
    data[2] = 0;
    ++data[3];
  }
}

/** After 35 frames the Pokédude walks right to x 120, faces down and says hello. */
function TTVcmd_NpcMoveAndSetupTextPrinter(taskId: number): void {
  const data = gTasks[taskId].data;
  const sprite = gSprites[data[1]];
  if (data[2] !== 35) {
    ++data[2];
  } else if (sprite.x2 === 0x78) {
    StartSpriteAnim(gSprites[data[1]], 0);
    TeachyTvInitTextPrinter('gTeachyTvText_PokedudeSaysHello');
    data[2] = 0;
    ++data[3];
  } else {
    ++sprite.x2;
  }
}

function TTVcmd_IdleIfTextPrinterIsActive(taskId: number): void {
  if (!RunTextPrinters_CheckActive(0)) ++gTasks[taskId].data[3];
}

/** B quits the sequence at any step (to TTVcmd_End: back to the list); otherwise the option's next TTVcmd. */
function TeachyTvRenderMsgAndSwitchClusterFuncs(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(B_BUTTON)) {
    sResources!.grassAnimDisabled = 1;
    TeachyTvSetSpriteCoordsAndSwitchFrame(data[1], 0, 0, 0);
    FillWindowPixelBuffer(0, 0xcc);
    CopyWindowToVram(0, COPYWIN_GFX);
    TeachyTvClearBg1EndGraphicText();
    data[2] = 0;
    data[3] = 0;
    gTasks[taskId].func = TTVcmd_End;
  } else {
    sScripts[sStaticResources.whichScript][data[3]](taskId);
  }
}

const sScript1Texts = [
  'gTeachyTvText_BattleScript1',
  'gTeachyTvText_StatusScript1',
  'gTeachyTvText_MatchupsScript1',
  'gTeachyTvText_CatchingScript1',
  'gTeachyTvText_TMsScript1',
  'gTeachyTvText_RegisterScript1',
];

const sScript2Texts = [
  'gTeachyTvText_BattleScript2',
  'gTeachyTvText_StatusScript2',
  'gTeachyTvText_MatchupsScript2',
  'gTeachyTvText_CatchingScript2',
  'gTeachyTvText_TMsScript2',
  'gTeachyTvText_RegisterScript2',
];

function TTVcmd_TextPrinterSwitchStringByOptionChosen(taskId: number): void {
  TeachyTvInitTextPrinter(sScript1Texts[sStaticResources.whichScript]);
  ++gTasks[taskId].data[3];
}

function TTVcmd_TextPrinterSwitchStringByOptionChosen2(taskId: number): void {
  TeachyTvInitTextPrinter(sScript2Texts[sStaticResources.whichScript]);
  ++gTasks[taskId].data[3];
}

/** sBg1EndGraphic: the "END" sign's BG1 tiles. */
const sBg1EndGraphic = [0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8];

// ST_OAM_H_RECTANGLE, SPRITE_SIZE(16x8)
const sSubspriteArray = [
  { x: -0x8, y: -0x8, shape: 1, size: 0, tileOffset: 0, priority: 3 },
  { x: -0x8, y: 0x0, shape: 1, size: 0, tileOffset: 2, priority: 2 },
];

const sSubspriteTableArray: SubspriteTable[] = [
  { subspriteCount: 0, subsprites: null },
  { subspriteCount: 2, subsprites: sSubspriteArray },
];

/** sGrassAnimArray: where the TV's piece of Route 1 has tall grass, 16 blocks a row (as the C lays it out, 8 a line). */
// prettier-ignore
const sGrassAnimArray = [
  0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 0, 0,
];

function TTVcmd_IdleIfTextPrinterIsActive2(taskId: number): void {
  if (!RunTextPrinters_CheckActive(0)) ++gTasks[taskId].data[3];
}

function TTVcmd_EraseTextWindowIfKeyPressed(taskId: number): void {
  if (JOY_NEW(A_BUTTON | B_BUTTON)) {
    FillWindowPixelBuffer(0, 0xcc);
    CopyWindowToVram(0, COPYWIN_GFX);
    ++gTasks[taskId].data[3];
  }
}

function TTVcmd_StartAnimNpcWalkIntoGrass(taskId: number): void {
  const data = gTasks[taskId].data;
  StartSpriteAnim(gSprites[data[1]], 5);
  data[2] = 0;
  data[4] = 0;
  data[5] = 1;
  ++data[3];
}

/** Walking up into the grass: BG3 scrolls down a pixel a frame for 48 frames, a grass sprite every 16. */
function TTVcmd_DudeMoveUp(taskId: number): void {
  const data = gTasks[taskId].data;
  const obj = gSprites[data[1]];
  ChangeBgY(3, 0x100, BG_COORD_SUB);
  if (!(++data[2] & 0xf)) {
    sResources!.grassAnimCounterHi = (sResources!.grassAnimCounterHi - 1) & 0xff;
    TeachyTvGrassAnimationMain(taskId, obj.x2, obj.y2, 0, false);
  }
  if (data[2] === 48) {
    data[2] = 0;
    data[4] = -1;
    data[5] = 0;
    StartSpriteAnim(obj, 7);
    ++data[3];
  }
}

function TTVcmd_DudeMoveRight(taskId: number): void {
  const data = gTasks[taskId].data;
  const obj = gSprites[data[1]];
  ChangeBgX(3, 0x100, BG_COORD_ADD);
  if (!(++data[2] & 0xf)) sResources!.grassAnimCounterLo = (sResources!.grassAnimCounterLo + 1) & 0xff;
  if (!((data[2] + 8) & 0xf)) TeachyTvGrassAnimationMain(taskId, obj.x2 + 8, obj.y2, 0, false);
  if (data[2] === 0x30) {
    data[2] = 0;
    data[4] = 0;
    data[5] = 0;
    StartSpriteAnim(obj, 3);
    ++data[3];
  }
}

function TTVcmd_DudeTurnLeft(taskId: number): void {
  const data = gTasks[taskId].data;
  const obj = gSprites[data[1]];
  StartSpriteAnim(obj, 6);
  ++data[3];
  data[4] = 0;
  data[5] = 0;
  TeachyTvGrassAnimationMain(taskId, obj.x2, obj.y2, 0, false);
}

function TTVcmd_DudeMoveLeft(taskId: number): void {
  const data = gTasks[taskId].data;
  const obj = gSprites[data[1]];
  if (!(obj.x2 & 0xf)) TeachyTvGrassAnimationMain(taskId, obj.x2 - 8, obj.y2, 0, false);
  if (obj.x2 === 8) ++data[3];
  else --obj.x2;
}

/** The END sign on BG1 for 127 frames. */
function TTVcmd_RenderAndRemoveBg1EndGraphic(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!data[2]) {
    CopyToBgTilemapBufferRect_ChangePalette(1, sBg1EndGraphic, 20, 10, 8, 2, 0x11);
    ScheduleBgCopyTilemapToVram(1);
  }
  if (++data[2] > 126) {
    TeachyTvClearBg1EndGraphicText();
    data[2] = 0;
    ++data[3];
  }
}

function TeachyTvClearBg1EndGraphicText(): void {
  FillBgTilemapBufferRect_Palette0(1, 0, 20, 10, 8, 2);
  ScheduleBgCopyTilemapToVram(1);
}

/** The noise for 64 frames to MUS_TEACHY_TV_MENU, then the list again (the same option under the cursor). */
function TTVcmd_End(taskId: number): void {
  const data = gTasks[taskId].data;
  const r = sResources!;
  if (data[2] === 0) PlayNewMapMusic(K.MUS_TEACHY_TV_MENU);
  TeachyTvBg2AnimController();
  if (++data[2] > 63) {
    data[2] = 0;
    data[3] = 0;
    data[0] = TeachyTvSetupWindow();
    gTasks[taskId].func = TeachyTvOptionListController;
    PutWindowTilemap(0);
    TeachyTvSetupScrollIndicatorArrowPair();
    TeachyTvSetWindowRegs();
    ScheduleBgCopyTilemapToVram(0);
    ChangeBgX(3, 0x0, BG_COORD_SET);
    ChangeBgY(3, 0x0, BG_COORD_SET);
    ChangeBgX(3, 0x1000, BG_COORD_SUB);
    ChangeBgY(3, 0x2800, BG_COORD_ADD);
    r.grassAnimCounterLo = 0;
    r.grassAnimCounterHi = 3;
    r.grassAnimDisabled = 0;
  }
}

/** The four battle options start the Pokédude's battle; TMS and REGISTER fade out to his bag. */
function TTVcmd_TaskBattleOrFadeByOptionChosen(taskId: number): void {
  switch (sStaticResources.whichScript) {
    case TTVSCR_BATTLE:
    case TTVSCR_STATUS:
    case TTVSCR_MATCHUPS:
    case TTVSCR_CATCHING:
      TeachyTvPrepBattle(taskId);
      break;
    case TTVSCR_TMS:
    case TTVSCR_REGISTER:
      sResources!.savedCallback = TeachyTvSetupBagItemsByOptionChosen;
      TeachyTvQuitBeginFade(taskId);
      break;
  }
}

function TeachyTvSetupBagItemsByOptionChosen(): void {
  if (sStaticResources.whichScript === TTVSCR_TMS) InitPokedudeBag(K.ITEMMENULOCATION_TTVSCR_TMS);
  else InitPokedudeBag(K.ITEMMENULOCATION_TTVSCR_REGISTER);
}

/** After a demo (mode 2): once the screen has faded in, the option's script goes on with its closing text. */
function TeachyTvPostBattleFadeControl(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    data[3] = sWhereToReturnToFromBattle[sStaticResources.whichScript];
    gTasks[taskId].func = TeachyTvRenderMsgAndSwitchClusterFuncs;
  }
}

// gFieldEffectObjectTemplatePointers[FLDEFFOBJ_TALL_GRASS] (gFieldEffectObjectTemplate_TallGrass) and
// gSpritePalette_GeneralFieldEffect1
const gSpritePalette_GeneralFieldEffect1 = () => ({ data: gfx16('gFieldEffectObjectPalette1'), tag: K.FLDEFF_PAL_TAG_GENERAL_1 });
let sTallGrassTemplate: SpriteTemplate | undefined;
function gFieldEffectObjectTemplate_TallGrass(): SpriteTemplate {
  if (!sTallGrassTemplate) {
    const pic = gfx('gFieldEffectObjectPic_TallGrass');
    sTallGrassTemplate = {
      tileTag: TAG_NONE,
      paletteTag: K.FLDEFF_PAL_TAG_GENERAL_1,
      oam: oam({ shape: 0, size: 1, priority: 2 }), // gObjectEventBaseOam_16x16
      anims: [[ANIMCMD_FRAME(1, 10), ANIMCMD_FRAME(2, 10), ANIMCMD_FRAME(3, 10), ANIMCMD_FRAME(4, 10), ANIMCMD_FRAME(0, 10), ANIMCMD_END]],
      images: [0, 1, 2, 3, 4].map((i) => ({ data: pic.subarray(i * 128, (i + 1) * 128), size: 128 })),
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy, // UpdateTallGrassFieldEffect: replaced below
    };
  }
  return sTallGrassTemplate;
}

/** A tall grass sprite where the Pokédude steps, if the TV's Route 1 has grass there (mode: already rustled). */
function TeachyTvGrassAnimationMain(taskId: number, x: number, y: number, subpriority: number, mode: boolean): void {
  if (sResources!.grassAnimDisabled !== 1 && TeachyTvGrassAnimationCheckIfNeedsToGenerateGrassObj(x - 0x10, y)) {
    const spriteId = CreateSprite(gFieldEffectObjectTemplate_TallGrass(), 0, 0, subpriority);
    const obj = gSprites[spriteId];
    obj.x2 = x;
    obj.y2 = y + 8;
    obj.callback = TeachyTvGrassAnimationObjCallback;
    obj.data[0] = taskId;
    if (mode) {
      SeekSpriteAnim(obj, 4);
      obj.oam.priority = 2;
    } else {
      SetSubspriteTables(obj, sSubspriteTableArray);
      obj.subspriteTableNum = 0;
      obj.subspriteMode = 1;
    }
  }
}

/** The grass scrolls with the map (the task's data[4], data[5]) and goes once the Pokédude is a block away. */
function TeachyTvGrassAnimationObjCallback(sprite: Sprite): void {
  const data = gTasks[sprite.data[0]].data;
  const obj = gSprites[data[1]];
  if ((sResources ?? sFreedResources)!.grassAnimDisabled === 1) {
    DestroySprite(sprite);
  } else {
    sprite.subspriteTableNum = sprite.animCmdIndex === 0 ? 1 : 0;
    sprite.x2 += data[4];
    sprite.y2 += data[5];
    if (sprite.animEnded) {
      sprite.subpriority = 0;
      const diff1 = sprite.x2 - obj.x2;
      const diff2 = sprite.y2 - obj.y2;
      if (diff1 <= -16 || diff1 >= 16 || diff2 <= -16 || diff2 >= 24) DestroySprite(sprite);
    }
  }
}

function TeachyTvGrassAnimationCheckIfNeedsToGenerateGrassObj(x: number, y: number): number {
  if (x < 0 || y < 0) return 0;
  const high = ((y >> 4) + sResources!.grassAnimCounterHi) << 4;
  const low = (x >> 4) + sResources!.grassAnimCounterLo;
  return sGrassAnimArray[high + low] ?? 0;
}

/**
 * TeachyTvPrepBattle: the screen's buffers go, VAR_0x8004 is the option (the Pokédude's battle reads it), the player's
 * party waits in the save block while the Pokédude's mons take its place, and the battle comes back through
 * TeachyTvRestorePlayerPartyCallback.
 */
function TeachyTvPrepBattle(taskId: number): void {
  const data = gTasks[taskId].data;
  TeachyTvFree();
  state.setVar('VAR_0x8004', sStaticResources.whichScript);
  gMain.savedCallback = TeachyTvRestorePlayerPartyCallback;
  ResetBattleGlobals(); // the battle's EWRAM, as BattleScene gets it (gBattleTypeFlags etc. are set from here on)
  SavePlayerParty();
  InitPokedudePartyAndOpponent();
  PlayMapChosenOrBattleBGM(K.MUS_DUMMY, g.battleTypeFlags, 0);
  data[6] = sStaticResources.whichScript === TTVSCR_BATTLE ? K.B_TRANSITION_WHITE_BARS_FADE : K.B_TRANSITION_SLICE;
  data[7] = 0;
  gTasks[taskId].func = TeachyTvPreBattleAnimAndSetBattleCallback;
}

/** TeachyTvPreBattleAnimAndSetBattleCallback: the transition on this screen, then the battle. */
function TeachyTvPreBattleAnimAndSetBattleCallback(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[7]) {
    case 0:
      testEvent('battleTransition', { transition: data[6] });
      BattleTransition_StartOnField(data[6]);
      ++data[7];
      break;
    case 1:
      if (IsBattleTransitionDone()) {
        SetMainCallback2(CB2_InitPokedudeBattle);
        DestroyTask(taskId);
      }
      break;
  }
}

/**
 * CB2_InitBattle for the Pokédude's battle. It runs on this screen's host (FieldMenuScene), which set up the battle
 * env and preloaded the demos' graphics (pokedudeBattleGfxSymbols); what BattleScene.create would add from a
 * BattleStart is set here: no trainer, the BattleUi, and the way back (ReturnFromBattleToOverworld's
 * SetMainCallback2(gMain.savedCallback)). The terrain is BATTLE_TERRAIN_GRASS (GetBattleTerrainOverride).
 */
function CB2_InitPokedudeBattle(): void {
  g.trainerBattleOpponent_A = 0;
  g.trainerBattleMode = 0;
  g.rivalBattleFlags = 0;
  g.npcTextColor = K.NPC_TEXT_COLOR_NEUTRAL;
  g.onBattleEnd = ReturnFromPokedudeBattle;
  setBattleUi(sPokedudeBattleUi);
  testEvent('battleStart', { flags: g.battleTypeFlags, trainer: 0 });
  SetMainCallback1(null); // gPreBattleCallback1
  CB2_InitBattle(K.BATTLE_TERRAIN_GRASS);
}

/** ReturnFromBattleToOverworld's end, on this host: gMain.inBattle off, gMain.savedCallback. */
function ReturnFromPokedudeBattle(outcome: number): void {
  testEvent('battleEnd', { outcome });
  gMain.inBattle = false;
  SetMainCallback1(null); // gMain.callback1 = gPreBattleCallback1
  SetMainCallback2(gMain.savedCallback);
}

/** The BattleUi the Pokédude's battle reads (BattleScene's, on gMain's keys). */
const sPokedudeBattleUi: BattleUi = {
  joyNew: (button) => JOY_NEW(GBA_BUTTON_BITS[button]) !== 0,
  joyHeld: (button) => JOY_HELD(GBA_BUTTON_BITS[button]) !== 0,
  anyNewKeys: () => gMain.newKeys !== 0,
  addBagItem: (itemId, count) => state.bag.add(itemId, count),
  playerGender: () => (state.playerGender === 'female' ? K.FEMALE : K.MALE),
};

const GBA_BUTTON_BITS: Record<GbaButton, number> = {
  A: A_BUTTON,
  B: B_BUTTON,
  SELECT: SELECT_BUTTON,
  START: START_BUTTON,
  RIGHT: DPAD_RIGHT,
  LEFT: DPAD_LEFT,
  UP: DPAD_UP,
  DOWN: DPAD_DOWN,
  R: R_BUTTON,
  L: L_BUTTON,
};

/** TeachyTvRestorePlayerPartyCallback: back from the battle (a draw is B, which quits to the list). */
function TeachyTvRestorePlayerPartyCallback(): void {
  LoadPlayerParty();
  if (g.battleOutcome === K.B_OUTCOME_DREW) SetTeachyTvControllerModeToResume();
  else PlayNewMapMusic(K.MUS_FOLLOW_ME);
  CB2_ReturnToTeachyTV();
}

// TeachyTvLoadBg3Map and its helpers: BG3 is Route 1's blocks at (8..23, 6..14), each metatile's two layers merged
// into four tiles (only the tiles those blocks use, in order), with the bottom layer's palettes loaded from slot 15
// down.

function TeachyTvLoadBg3Map(buffer: Uint16Array): void {
  const layout = sRoute1Layout!;
  const blockIndicesBuffer = new Uint16Array(0x400);
  const tilesetsBuffer = new Uint8Array(NUM_TILES_TOTAL * TILE_SIZE_4BPP);
  const palIndicesBuffer = new Uint8Array(16).fill(0xff);
  let numMapTilesRows = 0;

  TeachyTvLoadMapTilesetToBuffer(layout.primaryTileset, tilesetsBuffer, 0, NUM_TILES_IN_PRIMARY);
  TeachyTvLoadMapTilesetToBuffer(layout.secondaryTileset, tilesetsBuffer, NUM_TILES_IN_PRIMARY * TILE_SIZE_4BPP, NUM_TILES_TOTAL - NUM_TILES_IN_PRIMARY);

  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 16; j++) {
      const currentBlockIdx = layout.map[8 + (i + 6) * layout.width + j] & 0x3ff;
      let k = 0;
      for (; k < (i << 4) + j; k++) {
        if (blockIndicesBuffer[k] === 0) break;
        if (blockIndicesBuffer[k] === currentBlockIdx) break;
      }
      if (blockIndicesBuffer[k] === 0) {
        blockIndicesBuffer[k] = currentBlockIdx;
        numMapTilesRows++;
      }
      TeachyTvPushBackNewMapPalIndexArrayEntry(layout, buffer, 64 * i + 2 * j, palIndicesBuffer, currentBlockIdx, k);
    }
  }

  const bgTilesBuffer = new Uint8Array(numMapTilesRows * 0x80);
  const primaryMetatiles = gfx16(layout.primaryTileset.metatiles);
  const secondaryMetatiles = gfx16(layout.secondaryTileset.metatiles);
  for (let i = 0; i < numMapTilesRows; i++) {
    const mapTilesRowBuffer = new Uint8Array(0x80);
    const block = blockIndicesBuffer[i];
    if (block < NUM_METATILES_IN_PRIMARY) TeachyTvComputeMapTilesFromTilesetAndMetaTiles(primaryMetatiles.subarray(block * 8), mapTilesRowBuffer, tilesetsBuffer);
    else TeachyTvComputeMapTilesFromTilesetAndMetaTiles(secondaryMetatiles.subarray((block - NUM_METATILES_IN_PRIMARY) * 8), mapTilesRowBuffer, tilesetsBuffer);
    bgTilesBuffer.set(mapTilesRowBuffer, i * 0x80);
  }

  LoadBgTiles(3, bgTilesBuffer, numMapTilesRows * 0x80, 0);
  TeachyTvLoadMapPalette(layout, palIndicesBuffer);
}

/** TeachyTvLoadMapTilesetToBuffer: the extracted tiles are already decompressed. */
function TeachyTvLoadMapTilesetToBuffer(ts: TilesetSymbols, dstBuffer: Uint8Array, offset: number, size: number): void {
  const tiles = gfx(ts.tiles);
  dstBuffer.set(tiles.subarray(0, Math.min(tiles.length, TILE_SIZE_4BPP * size)), offset);
}

function TeachyTvPushBackNewMapPalIndexArrayEntry(mStruct: TeachyTvLayout, buf1: Uint16Array, at: number, palIndexArray: Uint8Array, mapEntry: number, offset: number): void {
  const metatiles = mapEntry < NUM_METATILES_IN_PRIMARY ? gfx16(mStruct.primaryTileset.metatiles).subarray(8 * mapEntry) : gfx16(mStruct.secondaryTileset.metatiles).subarray(8 * (mapEntry - NUM_METATILES_IN_PRIMARY));
  buf1[at] = ((TeachyTvComputePalIndexArrayEntryByMetaTile(palIndexArray, metatiles[0]) << 12) + 4 * offset) & 0xffff;
  buf1[at + 1] = ((TeachyTvComputePalIndexArrayEntryByMetaTile(palIndexArray, metatiles[1]) << 12) + 4 * offset + 1) & 0xffff;
  buf1[at + 32] = ((TeachyTvComputePalIndexArrayEntryByMetaTile(palIndexArray, metatiles[2]) << 12) + 4 * offset + 2) & 0xffff;
  buf1[at + 33] = ((TeachyTvComputePalIndexArrayEntryByMetaTile(palIndexArray, metatiles[3]) << 12) + 4 * offset + 3) & 0xffff;
}

/** Tile n of the block is the metatile's bottom tile n with its top tile n drawn over it. */
function TeachyTvComputeMapTilesFromTilesetAndMetaTiles(metaTilesArray: Uint16Array, blockBuf: Uint8Array, tileset: Uint8Array): void {
  for (let n = 0; n < 4; n++) {
    const dst = blockBuf.subarray(0x20 * n);
    for (const entry of [metaTilesArray[n], metaTilesArray[n + 4]]) {
      TeachyTvComputeSingleMapTileBlockFromTilesetAndMetaTiles(dst, tileset.subarray(0x20 * (entry & 0x3ff)), (entry >> 10) & 3);
    }
  }
}

/** One 4bpp tile, flipped (bit 0 h, bit 1 v), over blockBuf: its non-zero pixels replace blockBuf's. */
function TeachyTvComputeSingleMapTileBlockFromTilesetAndMetaTiles(blockBuf: Uint8Array, tileset: Uint8Array, metaTile: number): void {
  let buffer = tileset.slice(0, 0x20);
  if (metaTile & 1) {
    const src = new Uint8Array(0x20);
    for (let i = 0; i < 8; ++i) {
      for (let j = 0; j < 4; ++j) {
        const value = buffer[(i << 2) + 3 - j];
        src[(i << 2) + j] = ((value & 0xf) << 4) + ((value & 0xf0) >> 4);
      }
    }
    buffer = src;
  }
  if (metaTile & 2) {
    const src = new Uint8Array(0x20);
    for (let i = 0; i < 8; ++i) src.set(buffer.subarray(4 * (7 - i), 4 * (7 - i) + 4), 4 * i);
    buffer = src;
  }
  for (let i = 0; i < 32; ++i) {
    if (buffer[i] & 0xf0) blockBuf[i] = (blockBuf[i] & 0xf) + (buffer[i] & 0xf0);
    if (buffer[i] & 0xf) blockBuf[i] = (blockBuf[i] & 0xf0) + (buffer[i] & 0xf);
  }
}

/** The palette slot (15 down) for the metatile entry's palette, added to the list if it's new. */
function TeachyTvComputePalIndexArrayEntryByMetaTile(palIndexArrayBuf: Uint8Array, metaTile: number): number {
  let i = 0;
  const pal = metaTile >> 12;
  const firstEntry = palIndexArrayBuf[0];
  if (firstEntry !== pal) {
    if (firstEntry === 0xff) {
      palIndexArrayBuf[0] = pal;
    } else {
      while (++i < 16) {
        const temp = palIndexArrayBuf[i];
        if (temp === pal) break;
        if (temp === 0xff) {
          palIndexArrayBuf[i] = pal;
          break;
        }
      }
    }
  }
  return (0xf - i) & 0xffff;
}

function TeachyTvLoadMapPalette(mStruct: TeachyTvLayout, palIndexArray: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    if (palIndexArray[i] === 0xff) break;
    const pals = gfx16(palIndexArray[i] >= NUM_PALS_IN_PRIMARY ? mStruct.secondaryTileset.palettes : mStruct.primaryTileset.palettes);
    LoadPalette(pals.subarray(palIndexArray[i] * 16, palIndexArray[i] * 16 + 16), BG_PLTT_ID(15 - i), PLTT_SIZE_4BPP);
  }
}

// ------------------------------------------------------------------ the seam for unit 3

/**
 * The field demos aren't ported yet (FIELD_ITEMS_PLAN.md W-teachy unit 3: TTVSCR_REGISTER / _TMS, the field half of
 * item_menu.c's InitPokedudeBag and tm_case.c's Pokedude_InitTMCase). Until they are, such a demo logs and is skipped:
 * the screen comes back through `exit` as from the demo's end, and the option's script goes on with its closing text
 * (CB2_ReturnToTeachyTV in mode 2, sWhereToReturnToFromBattle).
 */
function PokedudeDemoNotPorted(demo: string, exit: MainCallback): void {
  console.warn(`[teachy_tv] ${demo} is not implemented`);
  SetMainCallback2(exit);
}

/**
 * item_menu.c's InitPokedudeBag for TTVSCR_REGISTER / _TMS: menus/itemMenu.ts has it (the battle demos use it), but
 * not those locations' scripted tasks (unit 3), so until then they're skipped.
 */
function InitPokedudeBag(location: number): void {
  PokedudeDemoNotPorted(`the Pokédude's bag (InitPokedudeBag(${location}))`, CB2_ReturnToTeachyTV);
}

// ------------------------------------------------------------------ test probe

/** Teachy TV while it's up (__test.teachyTv()). */
export function teachyTvProbe() {
  const r = sResources;
  const listTask = gTasks.findIndex((t) => t.isActive && (t.func === TeachyTvOptionListController || t.func === TeachyTvRenderMsgAndSwitchClusterFuncs || t.func === TTVcmd_End || t.func === TeachyTvPostBattleFadeControl || t.func === TeachyTvQuitFadeControlAndTaskDel));
  const task = listTask >= 0 ? gTasks[listTask] : undefined;
  const dude = task ? gSprites[task.data[1]] : undefined;
  return {
    mode: sStaticResources.mode,
    whichScript: sStaticResources.whichScript,
    scrollOffset: sStaticResources.scrollOffset,
    selectedRow: sStaticResources.selectedRow,
    allocated: !!r,
    task: task?.func.name,
    /** the TTVcmd step (data[3]) and its frame count (data[2]) */
    step: task?.data[3],
    timer: task?.data[2],
    cmd: task && task.func === TeachyTvRenderMsgAndSwitchClusterFuncs ? sScripts[sStaticResources.whichScript][task.data[3]]?.name : undefined,
    /** the list is taking input */
    listReady: task?.func === TeachyTvOptionListController && !gPaletteFade.active,
    listItems: gMultiuseListMenuTemplate.moveCursorFunc === TeachyTvAudioByInput ? gMultiuseListMenuTemplate.items.length : undefined,
    arrows: r ? r.scrollIndicatorArrowPairId !== 0xff : false,
    text: r?.lastText,
    textActive: r ? IsTextPrinterActive(0) : false, // without running the printers
    dude: dude ? { x2: dude.x2, y2: dude.y2, anim: dude.animNum, invisible: dude.invisible } : undefined,
    grass: gSprites.filter((s) => s.inUse && s.callback === TeachyTvGrassAnimationObjCallback).length,
    grassDisabled: r?.grassAnimDisabled,
    bg3: { x: GetBgX(3) | 0, y: GetBgY(3) | 0 },
  };
}
