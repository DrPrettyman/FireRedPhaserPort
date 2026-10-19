// battle_transition.c: the effects that take the field into a battle. They run on the GBA layer over
// the field, which world/fieldGbaScreen.ts draws into VRAM (BG1-3) and the OBJ layer for them.
// B_TRANSITION_SPIRAL isn't ported: nothing in FRLG starts it.

import { gfx, gfx16 } from '../gba/gfx';
import {
  BG_SCREEN_ADDR,
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_TGT1_ALL,
  BLDCNT_TGT1_BD,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT1_OBJ,
  BLDCNT_TGT2_ALL,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  DmaSetHBlank16,
  DmaStop0,
  getVCount,
  GetGpuReg,
  PALETTES_ALL,
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
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  vram,
  WIN_RANGE,
  WINOUT_WIN01_ALL,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_OBJ,
  WININ_WIN0_ALL,
  WININ_WIN0_BG1,
  WININ_WIN0_BG2,
  WININ_WIN0_BG3,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
} from '../gba/hw';
import { SetHBlankCallback, SetVBlankCallback } from '../gba/main';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, PLTT_SIZE_4BPP, TransferPlttBuffer } from '../gba/palette';
import { gScanlineEffectRegBuffers, ScanlineEffect_Clear } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  AFFINEANIMCMD_FRAME,
  AFFINEANIMCMD_JUMP,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AllocOamMatrix,
  CalcCenterToCornerVec,
  CreateInvisibleSprite,
  CreateSprite,
  CreateSpriteAtEnd,
  DestroySprite,
  FreeSpritePaletteByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  GetSpritePaletteTagByPaletteNum,
  gSprites,
  InitSpriteAffineAnim,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  SetOamMatrixRotationScaling,
  SetReservedSpritePaletteCount,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_AFFINE_NORMAL,
  StartSpriteAffineAnim,
  TAG_NONE,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, gTasks, TASK_NONE, type Task } from '../gba/task';
import { PlayerGenderToFrontTrainerPicId } from '../menus/picSprites';
import { random } from '../util/random';
import { K } from './constants';
import { bdata, state } from './env';
import { Cos, Sin } from './trig';

/** The field's side of the transition: FieldCameraGetPixelOffsetAtGround (BG1-3 scroll). */
let sFieldCameraOffset: () => { x: number; y: number } = () => ({ x: 0, y: 40 });

export function setTransitionFieldCamera(get: () => { x: number; y: number }): void {
  sFieldCameraOffset = get;
}

/** Graphics the transitions load (to preload before BattleTransition_StartOnField). */
export function battleTransitionGfxSymbols(transitionId: number): string[] {
  const syms = ['sBigPokeball_Gfx', 'sBigPokeball_Tilemap', 'sSlidingPokeball_Tilemap', 'sSlidingPokeball_Gfx', 'sFieldEffectPal_Pokeball', 'sGridSquare_Gfx'];
  const mugshot = transitionId - K.B_TRANSITION_LORELEI;
  if (mugshot >= 0 && mugshot < K.MUGSHOTS_COUNT) {
    syms.push('sMugshotBanner_Gfx', 'sMugshotsTilemap', OPPONENT_MUGSHOT_PALS[mugshot], ...PLAYER_MUGSHOT_PALS);
    for (const picId of [MUGSHOT_TRAINER_PICS()[mugshot], K.TRAINER_PIC_RED, K.TRAINER_PIC_LEAF]) {
      const pic = bdata.anims.trainerFrontPics[picId];
      const pal = bdata.anims.trainerFrontPalettes[picId];
      if (pic) syms.push(pic.pic);
      if (pal) syms.push(pal);
    }
  }
  return syms;
}

const s16 = (v: number) => (v << 16) >> 16;
const WIN_RANGE2 = (a: number, b: number) => (b | (a << 8)) & 0xffff;

/** struct TransitionData */
class TransitionData {
  vblankDma = 0;
  winIn = 0;
  winOut = 0;
  win0H = 0;
  win0V = 0;
  win1H = 0;
  win1V = 0;
  bldCnt = 0;
  bldAlpha = 0;
  bldY = 0;
  cameraX = 0;
  cameraY = 0;
  bg0HOfsOpponent = 0;
  bg0HOfsPlayer = 0;
  bg0VOfs = 0;
  counter = 0;
  readonly data = new Int16Array(11); // for multiple purposes

  /** memset(sTransitionData, 0, ...) */
  clear(): void {
    const data = this.data.fill(0);
    Object.assign(this, new TransitionData());
    (this as { data: Int16Array }).data = data;
  }
}

let sTransitionData: TransitionData | null = null;
const T = () => sTransitionData!;

// Used by each transition task to determine which of its functions to call
const tState = 0;

// InitBlackWipe / UpdateBlackWipe's use of TransitionData.data
const tWipeStartX = 0;
const tWipeStartY = 1;
const tWipeCurrX = 2;
const tWipeCurrY = 3;
const tWipeEndX = 4;
const tWipeEndY = 5;
const tWipeXMove = 6;
const tWipeYMove = 7;
const tWipeXDist = 8;
const tWipeYDist = 9;
const tWipeTemp = 10;

type TransitionStateFunc = (task: Task) => boolean;
type TransitionSpriteCallback = (sprite: Sprite) => boolean;

/** SET_TILE: a BG0 tilemap entry in palette 15. */
function SET_TILE(tilemap: number, posY: number, posX: number, tile: number): void {
  const addr = (tilemap + ((posY * 32 + posX) << 1)) & 0xffff;
  const v = tile | (15 << 12);
  vram[addr] = v & 0xff;
  vram[addr + 1] = (v >> 8) & 0xff;
}

/** CpuCopy16 of tile data into VRAM at a byte address. */
function copyToVramAt(src: Uint8Array, dest: number, size = src.length): void {
  vram.set(src.subarray(0, Math.min(size, src.length)), dest);
}

const MUGSHOT_TRAINER_PICS = () => [
  K.TRAINER_PIC_ELITE_FOUR_LORELEI,
  K.TRAINER_PIC_ELITE_FOUR_BRUNO,
  K.TRAINER_PIC_ELITE_FOUR_AGATHA,
  K.TRAINER_PIC_ELITE_FOUR_LANCE,
  K.TRAINER_PIC_CHAMPION_RIVAL,
]; // sMugshotsTrainerPicIDsTable

const sMugshotsOpponentRotationScales = [
  [0x200, 0x200],
  [0x200, 0x200],
  [0x200, 0x200],
  [0x200, 0x200],
  [0x200, 0x200],
];

const sMugshotsOpponentCoords = [
  [-8, 0],
  [-10, 0],
  [0, 0],
  [-32, 0],
  [0, 0],
];

/** sOpponentMugshotsPals / sPlayerMugshotsPals */
const OPPONENT_MUGSHOT_PALS = ['sMugshotPal_Lorelei', 'sMugshotPal_Bruno', 'sMugshotPal_Agatha', 'sMugshotPal_Lance', 'sMugshotPal_Blue'];
const PLAYER_MUGSHOT_PALS = ['sMugshotPal_Red', 'sMugshotPal_Green'];

// One element per slide direction.
// Sign of acceleration is opposite speed, so slide decelerates.
const sTrainerPicSlideSpeeds = [12, -12];
const sTrainerPicSlideAccels = [-1, 1];

const NUM_POKEBALL_TRAILS = 5;
const sPokeballsTrail_StartXCoords = [-16, DISPLAY_WIDTH + 16];
const sPokeballsTrail_Delays = [0, 16, 32, 8, 24];
const sPokeballsTrail_Speeds = [8, -8];

const NUM_WHITE_BARS = 6;
const WHITE_BAR_HEIGHT = 1 + Math.trunc(DISPLAY_HEIGHT / NUM_WHITE_BARS);
const sWhiteBarsFade_StartDelays = [0, 9, 15, 6, 12, 3];

const NUM_ANGLED_WIPES = 7;
const sAngledWipes_MoveData = [
  // startX          startY          endX            endY            yDirection
  [56, 0, 0, DISPLAY_HEIGHT, 0],
  [104, DISPLAY_HEIGHT, DISPLAY_WIDTH, 88, 1],
  [DISPLAY_WIDTH, 72, 56, 0, 1],
  [0, 32, 144, DISPLAY_HEIGHT, 0],
  [144, DISPLAY_HEIGHT, 184, 0, 1],
  [56, 0, 168, DISPLAY_HEIGHT, 0],
  [168, DISPLAY_HEIGHT, 48, 0, 1],
];
const sAngledWipes_EndDelays = [1, 1, 1, 1, 1, 1, 0];

/** gObjectEventBaseOam_32x32 */
const sPokeballOam = () => {
  const [shape, size] = SPRITE_SHAPE['32x32'];
  return oam({ shape, size, priority: 2 });
};

/** sSpriteTemplate_Pokeball (built on first use: its image is extracted gfx) */
let sSpriteTemplate_Pokeball: SpriteTemplate | undefined;
function pokeballTemplate(): SpriteTemplate {
  sSpriteTemplate_Pokeball ??= {
    tileTag: TAG_NONE,
    paletteTag: K.FLDEFF_PAL_TAG_POKEBALL_TRAIL,
    oam: sPokeballOam(),
    anims: [[ANIMCMD_FRAME(0, 1), ANIMCMD_END]],
    images: [{ data: gfx('sSlidingPokeball_Gfx'), size: gfx('sSlidingPokeball_Gfx').length }],
    affineAnims: [
      [AFFINEANIMCMD_FRAME(0, 0, -4, 1), AFFINEANIMCMD_JUMP(0)],
      [AFFINEANIMCMD_FRAME(0, 0, 4, 1), AFFINEANIMCMD_JUMP(0)],
    ],
    callback: SpriteCB_FldEffPokeballTrail,
  };
  return sSpriteTemplate_Pokeball;
}

/** gSpritePalette_Pokeball (shared by the big pokeball and the sliding pokeball) */
const gSpritePalette_Pokeball = () => ({ data: gfx16('sFieldEffectPal_Pokeball'), tag: K.FLDEFF_PAL_TAG_POKEBALL_TRAIL });

/** BattleTransition_StartOnField (gMain.callback2 = CB2_OverworldBasic is the field host's part). */
export function BattleTransition_StartOnField(transitionId: number): void {
  sTransitionData = new TransitionData();
  LaunchBattleTransitionTask(transitionId);
}

const tTransitionId = 1;
const tTransitionDone = 15;

export function IsBattleTransitionDone(): boolean {
  const taskId = FindTaskIdByFunc(Task_BattleTransition);
  if (gTasks[taskId].data[tTransitionDone]) {
    InitTransitionData();
    sTransitionData = null;
    DestroyTask(taskId);
    return true;
  }
  return false;
}

function LaunchBattleTransitionTask(transitionId: number): void {
  const taskId = CreateTask(Task_BattleTransition, 2);
  gTasks[taskId].data[tTransitionId] = transitionId;
}

const sTaskHandlers: TransitionStateFunc[] = [Transition_StartIntro, Transition_WaitForIntro, Transition_StartMain, Transition_WaitForMain];

function Task_BattleTransition(taskId: number): void {
  while (sTaskHandlers[gTasks[taskId].data[tState]](gTasks[taskId]));
}

// All battle transitions use the same intro (sTasks_Intro)
const sTasks_Intro = (_transitionId: number) => Task_Intro;

/** sTasks_Main: after the intro each transition has a unique main task. */
function sTasks_Main(transitionId: number): (taskId: number) => void {
  const tasks: Record<number, (taskId: number) => void> = {
    [K.B_TRANSITION_BLUR]: Task_Blur,
    [K.B_TRANSITION_SWIRL]: Task_Swirl,
    [K.B_TRANSITION_SHUFFLE]: Task_Shuffle,
    [K.B_TRANSITION_BIG_POKEBALL]: Task_BigPokeball,
    [K.B_TRANSITION_POKEBALLS_TRAIL]: Task_PokeballsTrail,
    [K.B_TRANSITION_CLOCKWISE_WIPE]: Task_ClockwiseWipe,
    [K.B_TRANSITION_RIPPLE]: Task_Ripple,
    [K.B_TRANSITION_WAVE]: Task_Wave,
    [K.B_TRANSITION_SLICE]: Task_Slice,
    [K.B_TRANSITION_WHITE_BARS_FADE]: Task_WhiteBarsFade,
    [K.B_TRANSITION_GRID_SQUARES]: Task_GridSquares,
    [K.B_TRANSITION_ANGLED_WIPES]: Task_AngledWipes,
    [K.B_TRANSITION_LORELEI]: Task_Lorelei,
    [K.B_TRANSITION_BRUNO]: Task_Bruno,
    [K.B_TRANSITION_AGATHA]: Task_Agatha,
    [K.B_TRANSITION_LANCE]: Task_Lance,
    [K.B_TRANSITION_BLUE]: Task_Blue,
  };
  const task = tasks[transitionId];
  if (!task) throw new Error(`Battle transition ${transitionId} isn't ported`);
  return task;
}

function Transition_StartIntro(task: Task): boolean {
  // SetWeatherScreenFadeOut: weather isn't ported
  gPlttBufferUnfaded.set(gPlttBufferFaded);
  CreateTask(sTasks_Intro(task.data[tTransitionId]), 4);
  task.data[tState]++;
  return false;
}

function Transition_WaitForIntro(task: Task): boolean {
  if (FindTaskIdByFunc(sTasks_Intro(task.data[tTransitionId])) === TASK_NONE) {
    task.data[tState]++;
    return true;
  }
  return false;
}

function Transition_StartMain(task: Task): boolean {
  CreateTask(sTasks_Main(task.data[tTransitionId]), 0);
  task.data[tState]++;
  return false;
}

function Transition_WaitForMain(task: Task): boolean {
  task.data[tTransitionDone] = 0;
  if (FindTaskIdByFunc(sTasks_Main(task.data[tTransitionId])) === TASK_NONE) task.data[tTransitionDone] = 1;
  return false;
}

function Task_Intro(taskId: number): void {
  if (gTasks[taskId].data[tState] === 0) {
    gTasks[taskId].data[tState]++;
    CreateIntroTask(0, 0, 2, 2, 2);
  } else if (IsIntroTaskDone()) {
    DestroyTask(taskId);
  }
}

// --------------------
// B_TRANSITION_BLUR
// --------------------

const sBlur_Funcs: TransitionStateFunc[] = [Blur_Init, Blur_Main, Blur_End];

function Task_Blur(taskId: number): void {
  while (sBlur_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

const BGCNT_MOSAIC = 0x40;

function Blur_Init(task: Task): boolean {
  SetGpuReg(REG_OFFSET_MOSAIC, 0);
  SetGpuRegBits(REG_OFFSET_BG1CNT, BGCNT_MOSAIC);
  SetGpuRegBits(REG_OFFSET_BG2CNT, BGCNT_MOSAIC);
  SetGpuRegBits(REG_OFFSET_BG3CNT, BGCNT_MOSAIC);
  task.data[tState]++;
  return true;
}

function Blur_Main(task: Task): boolean {
  const tDelay = 1;
  const tCounter = 2;
  if (task.data[tDelay] !== 0) {
    task.data[tDelay]--;
  } else {
    task.data[tDelay] = 2;
    if (++task.data[tCounter] === 10) BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
    SetGpuReg(REG_OFFSET_MOSAIC, (task.data[tCounter] & 0xf) + ((task.data[tCounter] & 0xf) << 4));
    if (task.data[tCounter] > 14) task.data[tState]++;
  }
  return false;
}

function Blur_End(_task: Task): boolean {
  if (!gPaletteFade.active) DestroyTask(FindTaskIdByFunc(Task_Blur));
  return false;
}

// --------------------
// B_TRANSITION_SWIRL
// --------------------

const sSwirl_Funcs: TransitionStateFunc[] = [Swirl_Init, Swirl_End];

function Task_Swirl(taskId: number): void {
  while (sSwirl_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function Swirl_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  BeginNormalPaletteFade(PALETTES_ALL, 4, 0, 16, RGB_BLACK);
  SetSinWave(gScanlineEffectRegBuffers[1], T().cameraX, 0, 2, 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_Swirl);
  SetHBlankCallback(HBlankCB_Swirl);
  task.data[tState]++;
  return false;
}

function Swirl_End(task: Task): boolean {
  const tSinIndex = 1;
  const tAmplitude = 2;
  T().vblankDma = 0;
  task.data[tSinIndex] += 4;
  task.data[tAmplitude] += 8;
  SetSinWave(gScanlineEffectRegBuffers[0], T().cameraX, task.data[tSinIndex], 2, task.data[tAmplitude], 160);
  if (!gPaletteFade.active) DestroyTask(FindTaskIdByFunc(Task_Swirl));
  T().vblankDma++;
  return false;
}

function VBlankCB_Swirl(): void {
  VBlankCB_BattleTransition();
  if (T().vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, 160));
}

function HBlankCB_Swirl(): void {
  const offset = gScanlineEffectRegBuffers[1][getVCount()];
  SetGpuReg(REG_OFFSET_BG1HOFS, offset);
  SetGpuReg(REG_OFFSET_BG2HOFS, offset);
  SetGpuReg(REG_OFFSET_BG3HOFS, offset);
}

// ----------------------
// B_TRANSITION_SHUFFLE
// ----------------------

const sShuffle_Funcs: TransitionStateFunc[] = [Shuffle_Init, Shuffle_End];

function Task_Shuffle(taskId: number): void {
  while (sShuffle_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function Shuffle_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  BeginNormalPaletteFade(PALETTES_ALL, 4, 0, 16, RGB_BLACK);
  // memset: every byte of the buffer is cameraY's low byte
  gScanlineEffectRegBuffers[1].fill((T().cameraY & 0xff) * 0x101, 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_Shuffle);
  SetHBlankCallback(HBlankCB_Shuffle);
  task.data[tState]++;
  return false;
}

function Shuffle_End(task: Task): boolean {
  const tSinVal = 1;
  const tAmplitude = 2;
  T().vblankDma = 0;
  let sinVal = task.data[tSinVal] & 0xffff;
  const amplitude = (task.data[tAmplitude] >> 8) & 0xffff;
  task.data[tSinVal] += 4224;
  task.data[tAmplitude] += 384;
  for (let i = 0; i < DISPLAY_HEIGHT; i++, sinVal = (sinVal + 4224) & 0xffff) {
    gScanlineEffectRegBuffers[0][i] = T().cameraY + Sin(sinVal >> 8, s16(amplitude));
  }
  if (!gPaletteFade.active) DestroyTask(FindTaskIdByFunc(Task_Shuffle));
  T().vblankDma++;
  return false;
}

function VBlankCB_Shuffle(): void {
  VBlankCB_BattleTransition();
  if (T().vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, 160));
}

function HBlankCB_Shuffle(): void {
  const offset = gScanlineEffectRegBuffers[1][getVCount()];
  SetGpuReg(REG_OFFSET_BG1VOFS, offset);
  SetGpuReg(REG_OFFSET_BG2VOFS, offset);
  SetGpuReg(REG_OFFSET_BG3VOFS, offset);
}

// ------------------------------------------------------------------------
// B_TRANSITION_BIG_POKEBALL
//
// In Emerald, the "PatternWeave" effect of this transition is used
// by multiple different transitions. In FRLG it's unique to this one.
// ------------------------------------------------------------------------

const tBlendTarget1 = 1;
const tBlendTarget2 = 2;
const tBlendDelay = 3;
// Data 1-3 change purpose for PatternWeave_CircularMask
const tRadius = 1;
const tRadiusDelta = 2;
const tVBlankSet = 3;
const tPatternSinIndex = 4;
const tPatternAmplitude = 5;

const sBigPokeball_Funcs: TransitionStateFunc[] = [
  BigPokeball_Init,
  BigPokeball_SetGfx,
  PatternWeave_Blend1,
  PatternWeave_Blend2,
  PatternWeave_FinishAppear,
  PatternWeave_CircularMask,
];

function Task_BigPokeball(taskId: number): void {
  while (sBigPokeball_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

// Separate function in Emerald
function InitPatternWeaveTransition(task: Task): void {
  InitTransitionData();
  ScanlineEffect_Clear();
  task.data[tBlendTarget1] = 16;
  task.data[tBlendTarget2] = 0;
  task.data[tPatternSinIndex] = 0;
  task.data[tPatternAmplitude] = 0x4000;
  const t = T();
  t.winIn = WININ_WIN0_ALL;
  t.winOut = 0;
  t.win0H = DISPLAY_WIDTH;
  t.win0V = DISPLAY_HEIGHT;
  t.bldCnt = BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL;
  t.bldAlpha = BLDALPHA_BLEND(task.data[tBlendTarget2], task.data[tBlendTarget1]);
  gScanlineEffectRegBuffers[1].fill(DISPLAY_WIDTH, 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_PatternWeave);
}

function BigPokeball_Init(task: Task): boolean {
  InitPatternWeaveTransition(task);
  const { tilemap, tileset } = GetBg0TilesDst();
  vram.fill(0, tilemap, tilemap + 0x800);
  copyToVramAt(gfx('sBigPokeball_Gfx'), tileset);
  LoadPalette(gfx16('sFieldEffectPal_Pokeball'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  task.data[tState]++;
  return false;
}

function BigPokeball_SetGfx(task: Task): boolean {
  const { tilemap } = GetBg0TilesDst();
  const bigPokeballMap = gfx16('sBigPokeball_Tilemap');
  let k = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 30; j++, k++) SET_TILE(tilemap, i, j, bigPokeballMap[k]);
  SetSinWave(gScanlineEffectRegBuffers[0], 0, task.data[tPatternSinIndex], 132, task.data[tPatternAmplitude], DISPLAY_HEIGHT);
  task.data[tState]++;
  return true;
}

function PatternWeave_Blend1(task: Task): boolean {
  T().vblankDma = 0;
  if (task.data[tBlendDelay] === 0 || --task.data[tBlendDelay] === 0) {
    task.data[tBlendTarget2]++;
    task.data[tBlendDelay] = 1; // Broken logic. This makes the condition always TRUE.
  }
  T().bldAlpha = BLDALPHA_BLEND(task.data[tBlendTarget2], task.data[tBlendTarget1]);
  // Increment eva until it reaches 50% coeff
  if (task.data[tBlendTarget2] > 15) task.data[tState]++;
  task.data[tPatternSinIndex] += 12;
  task.data[tPatternAmplitude] -= 384;
  // Assign a very high frequency value so that 2 adjacent values in gScanlineEffectRegBuffers[0] will have different sign.
  SetSinWave(gScanlineEffectRegBuffers[0], 0, task.data[tPatternSinIndex], 132, task.data[tPatternAmplitude] >> 8, DISPLAY_HEIGHT);
  T().vblankDma++;
  return false;
}

function PatternWeave_Blend2(task: Task): boolean {
  T().vblankDma = 0;
  if (task.data[tBlendDelay] === 0 || --task.data[tBlendDelay] === 0) {
    task.data[tBlendTarget1]--;
    task.data[tBlendDelay] = 2;
  }
  T().bldAlpha = BLDALPHA_BLEND(task.data[tBlendTarget2], task.data[tBlendTarget1]);
  if (task.data[tBlendTarget1] === 0) task.data[tState]++;
  if (task.data[tPatternAmplitude] > 0) {
    task.data[tPatternSinIndex] += 12;
    task.data[tPatternAmplitude] -= 384;
  } else {
    task.data[tPatternAmplitude] = 0;
  }
  SetSinWave(gScanlineEffectRegBuffers[0], 0, task.data[tPatternSinIndex], 132, task.data[tPatternAmplitude] >> 8, DISPLAY_HEIGHT);
  T().vblankDma++;
  return false;
}

function PatternWeave_FinishAppear(task: Task): boolean {
  T().vblankDma = 0;
  if (task.data[tPatternAmplitude] > 0) {
    task.data[tPatternSinIndex] += 12;
    task.data[tPatternAmplitude] -= 384;
  } else {
    task.data[tPatternAmplitude] = 0;
  }
  SetSinWave(gScanlineEffectRegBuffers[0], 0, task.data[tPatternSinIndex], 132, task.data[tPatternAmplitude] >> 8, DISPLAY_HEIGHT);
  if (task.data[tPatternAmplitude] <= 0) {
    task.data[tState]++;
    task.data[tRadius] = DISPLAY_HEIGHT;
    task.data[tRadiusDelta] = 1 << 8;
    task.data[tVBlankSet] = 0;
  }
  T().vblankDma++;
  return false;
}

// Do a shrinking circular mask to go to a black screen after the pattern appears.
function PatternWeave_CircularMask(task: Task): boolean {
  T().vblankDma = 0;
  if (task.data[tRadiusDelta] < 8 << 8) task.data[tRadiusDelta] += 1 << 8;
  if (task.data[tRadius] !== 0) {
    task.data[tRadius] -= task.data[tRadiusDelta] >> 8;
    if (task.data[tRadius] < 0) task.data[tRadius] = 0;
  }
  SetCircularMask(gScanlineEffectRegBuffers[0], DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2, task.data[tRadius]);
  if (task.data[tRadius] === 0) {
    DmaStop0();
    FadeScreenBlack();
    DestroyTask(FindTaskIdByFunc(Task_BigPokeball)); // FindTaskIdByFunc(task->func) in Emerald to accomdate other functions
  }
  if (!task.data[tVBlankSet]) {
    task.data[tVBlankSet]++;
    SetVBlankCallback(VBlankCB_CircularMask);
  }
  T().vblankDma++;
  return false;
}

function VBlankCB_SetWinAndBlend(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, 160));
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  SetGpuReg(REG_OFFSET_BLDCNT, t.bldCnt);
  SetGpuReg(REG_OFFSET_BLDALPHA, t.bldAlpha);
}

function VBlankCB_PatternWeave(): void {
  VBlankCB_SetWinAndBlend();
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_BG0HOFS);
}

function VBlankCB_CircularMask(): void {
  VBlankCB_SetWinAndBlend();
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_WIN0H);
}

// ------------------------------
// B_TRANSITION_POKEBALLS_TRAIL
// ------------------------------

const sPokeballsTrail_Funcs: TransitionStateFunc[] = [PokeballsTrail_Init, PokeballsTrail_Main, PokeballsTrail_End];

function Task_PokeballsTrail(taskId: number): void {
  while (sPokeballsTrail_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function PokeballsTrail_Init(task: Task): boolean {
  const { tilemap, tileset } = GetBg0TilesDst();
  copyToVramAt(gfx('sSlidingPokeball_Tilemap'), tileset);
  vram.fill(0, tilemap, tilemap + 0x800);
  LoadPalette(gfx16('sFieldEffectPal_Pokeball'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  task.data[tState]++;
  return false;
}

function PokeballsTrail_Main(task: Task): boolean {
  // Randomly pick which side the first ball should start on.
  // The side is then flipped for each subsequent ball.
  let side = random() & 1;
  for (let i = 0; i < NUM_POKEBALL_TRAILS; i++, side ^= 1) {
    FieldEffectStart_Pokeball(sPokeballsTrail_StartXCoords[side], i * 32 + 16, side, sPokeballsTrail_Delays[i]);
  }
  task.data[tState]++;
  return false;
}

function PokeballsTrail_End(_task: Task): boolean {
  if (sActivePokeballFieldEffects === 0) {
    // !FieldEffectActiveListContains(FLDEFF_POKEBALL)
    FadeScreenBlack();
    DestroyTask(FindTaskIdByFunc(Task_PokeballsTrail));
  }
  return false;
}

/** gFieldEffectActiveList entries for FLDEFF_POKEBALL (the only field effect these transitions start). */
let sActivePokeballFieldEffects = 0;

/**
 * FieldEffectStart(FLDEFF_POKEBALL) with gFieldEffectArguments[0..3] = x, y, side, delay:
 * gFldEffScript_Pokeball (loadpal gSpritePalette_Pokeball, callnative FldEff_PokeballTrail).
 */
function FieldEffectStart_Pokeball(x: number, y: number, side: number, delay: number): void {
  sActivePokeballFieldEffects++;
  LoadSpritePalette(gSpritePalette_Pokeball()); // FieldEffectScript_LoadPal (no global field tint)
  FldEff_PokeballTrail(x, y, side, delay);
}

/** FieldEffectStop(sprite, FLDEFF_POKEBALL): FieldEffectFreeGraphicsResources + FieldEffectActiveListRemove */
function FieldEffectStop_Pokeball(sprite: Sprite): void {
  const paletteNum = sprite.oam.paletteNum;
  DestroySprite(sprite);
  // FieldEffectFreeTilesIfUnused: the sprite has no sheet. FieldEffectFreePaletteIfUnused:
  const paletteTag = GetSpritePaletteTagByPaletteNum(paletteNum);
  if (paletteTag !== TAG_NONE && !gSprites.slice(0, MAX_SPRITES).some((s) => s.inUse && s.oam.paletteNum === paletteNum)) FreeSpritePaletteByTag(paletteTag);
  sActivePokeballFieldEffects--;
}

const sSide = 0;
const sDelay = 1;
const sPrevX = 2;

/** FldEff_PokeballTrail */
function FldEff_PokeballTrail(x: number, y: number, side: number, delay: number): boolean {
  const spriteId = CreateSpriteAtEnd(pokeballTemplate(), x, y, 0);
  const sprite = gSprites[spriteId];
  sprite.oam.priority = 0;
  sprite.oam.affineMode = ST_OAM_AFFINE_NORMAL;
  sprite.data[sSide] = side;
  sprite.data[sDelay] = delay;
  sprite.data[sPrevX] = -1;
  InitSpriteAffineAnim(sprite);
  StartSpriteAffineAnim(sprite, side);
  return false;
}

function SpriteCB_FldEffPokeballTrail(sprite: Sprite): void {
  if (sprite.data[sDelay]) {
    sprite.data[sDelay]--;
  } else {
    if (sprite.x >= 0 && sprite.x <= DISPLAY_WIDTH) {
      // Set Pokéball position
      const posX = sprite.x >> 3;
      const posY = sprite.y >> 3;
      // If Pokéball moved forward clear trail behind it
      if (posX !== sprite.data[sPrevX]) {
        sprite.data[sPrevX] = posX;
        const ptr = BG_SCREEN_ADDR((GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f);
        SET_TILE(ptr, posY - 2, posX, 1);
        SET_TILE(ptr, posY - 1, posX, 1);
        SET_TILE(ptr, posY - 0, posX, 1);
        SET_TILE(ptr, posY + 1, posX, 1);
      }
    }
    sprite.x += sPokeballsTrail_Speeds[sprite.data[sSide]];
    if (sprite.x < -15 || sprite.x > DISPLAY_WIDTH + 15) FieldEffectStop_Pokeball(sprite);
  }
}

// -----------------------------
// B_TRANSITION_CLOCKWISE_WIPE
// -----------------------------

const sClockwiseWipe_Funcs: TransitionStateFunc[] = [
  ClockwiseWipe_Init,
  ClockwiseWipe_TopRight,
  ClockwiseWipe_Right,
  ClockwiseWipe_Bottom,
  ClockwiseWipe_Left,
  ClockwiseWipe_TopLeft,
  ClockwiseWipe_End,
];

function Task_ClockwiseWipe(taskId: number): void {
  while (sClockwiseWipe_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function ClockwiseWipe_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  const t = T();
  t.winIn = 0;
  t.winOut = WINOUT_WIN01_ALL;
  t.win0H = WIN_RANGE(DISPLAY_WIDTH, DISPLAY_WIDTH + 1);
  t.win0V = DISPLAY_HEIGHT;
  gScanlineEffectRegBuffers[1].fill(WIN_RANGE(DISPLAY_WIDTH + 3, DISPLAY_WIDTH + 4), 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_ClockwiseWipe);
  t.data[tWipeEndX] = DISPLAY_WIDTH / 2;
  task.data[tState]++;
  return true;
}

function ClockwiseWipe_TopRight(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  // (UBFIX would end at y 0)
  InitBlackWipe(t.data, DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2, t.data[tWipeEndX], -1, 1, 1);
  do {
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = WIN_RANGE(DISPLAY_WIDTH / 2, t.data[tWipeCurrX] + 1); // y -1 lands outside the buffer
  } while (!UpdateBlackWipe(t.data, true, true));
  t.data[tWipeEndX] += 32;
  if (t.data[tWipeEndX] >= DISPLAY_WIDTH) {
    t.data[tWipeEndY] = 0;
    task.data[tState]++;
  }
  t.vblankDma++;
  return false;
}

function ClockwiseWipe_Right(task: Task): boolean {
  const t = T();
  let start = 0;
  let end = 0;
  let finished = false;
  t.vblankDma = 0;
  InitBlackWipe(t.data, DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2, DISPLAY_WIDTH, t.data[tWipeEndY], 1, 1);
  for (;;) {
    start = DISPLAY_WIDTH / 2;
    end = t.data[tWipeCurrX] + 1;
    if (t.data[tWipeEndY] >= DISPLAY_HEIGHT / 2) {
      start = t.data[tWipeCurrX];
      end = DISPLAY_WIDTH;
    }
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = WIN_RANGE2(start, end);
    if (finished) break;
    finished = UpdateBlackWipe(t.data, true, true);
  }
  t.data[tWipeEndY] += 16;
  if (t.data[tWipeEndY] >= DISPLAY_HEIGHT) {
    t.data[tWipeEndX] = DISPLAY_WIDTH;
    task.data[tState]++;
  } else {
    while (t.data[tWipeCurrY] < t.data[tWipeEndY]) gScanlineEffectRegBuffers[0][++t.data[tWipeCurrY]] = WIN_RANGE2(start, end);
  }
  t.vblankDma++;
  return false;
}

function ClockwiseWipe_Bottom(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  InitBlackWipe(t.data, DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2, t.data[tWipeEndX], DISPLAY_HEIGHT, 1, 1);
  do {
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = (t.data[tWipeCurrX] << 8) | DISPLAY_WIDTH;
  } while (!UpdateBlackWipe(t.data, true, true));
  t.data[tWipeEndX] -= 32;
  if (t.data[tWipeEndX] <= 0) {
    t.data[tWipeEndY] = DISPLAY_HEIGHT;
    task.data[tState]++;
  }
  t.vblankDma++;
  return false;
}

/*
 * BUG: The following 2 functions are incorrect. The animation after
 * the rotation angle reaches 1.5π will not be displayed.
 *
 * There're 2 problems which need to be solved in order to correct the logic.
 * 1. With current setup, nothing is displayed inside WIN0 and everything
 * is displayed outside WIN0. Thus, if the rotation angle is > 1.5π, it
 * won't be able to handle the situation.
 * 2. The programmer sometimes swapped the place of start and end boundary
 * of WIN0 (see variables start and end), which will sometimes cause end
 * to be smaller than start. In this way, garbage data will be written to WIN0H.
 */
function ClockwiseWipe_Left(task: Task): boolean {
  const t = T();
  let end = 0;
  let start = 0;
  let finished = false;
  t.vblankDma = 0;
  InitBlackWipe(t.data, DISPLAY_WIDTH / 2, DISPLAY_HEIGHT / 2, 0, t.data[tWipeEndY], 1, 1);
  for (;;) {
    end = gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] & 0xff;
    start = t.data[tWipeCurrX];
    if (t.data[tWipeEndY] <= DISPLAY_HEIGHT / 2) {
      start = DISPLAY_WIDTH / 2;
      end = t.data[tWipeCurrX];
    }
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = WIN_RANGE2(start, end);
    if (finished) break;
    finished = UpdateBlackWipe(t.data, true, true);
  }
  t.data[tWipeEndY] -= 16;
  if (t.data[tWipeEndY] <= 0) {
    t.data[tWipeEndX] = 0;
    task.data[tState]++;
  } else {
    while (t.data[tWipeCurrY] > t.data[tWipeEndY]) gScanlineEffectRegBuffers[0][--t.data[tWipeCurrY]] = WIN_RANGE2(start, end);
  }
  t.vblankDma++;
  return false;
}

function ClockwiseWipe_TopLeft(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  InitBlackWipe(t.data, 120, 80, t.data[tWipeEndX], 0, 1, 1);
  do {
    let start = DISPLAY_WIDTH / 2;
    let end: number = t.data[tWipeCurrX];
    if (t.data[tWipeCurrX] >= 120) {
      start = 0;
      end = DISPLAY_WIDTH;
    }
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = WIN_RANGE2(start, end);
  } while (!UpdateBlackWipe(t.data, true, true));
  t.data[tWipeEndX] += 32;
  if (t.data[tWipeCurrX] > DISPLAY_WIDTH / 2) task.data[tState]++;
  t.vblankDma++;
  return false;
}

function ClockwiseWipe_End(_task: Task): boolean {
  DmaStop0();
  FadeScreenBlack();
  DestroyTask(FindTaskIdByFunc(Task_ClockwiseWipe));
  return false;
}

function VBlankCB_ClockwiseWipe(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  SetGpuReg(REG_OFFSET_WIN0H, gScanlineEffectRegBuffers[1][0]);
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_WIN0H);
}

// ---------------------
// B_TRANSITION_RIPPLE
// ---------------------

const sRipple_Funcs: TransitionStateFunc[] = [Ripple_Init, Ripple_Main];

function Task_Ripple(taskId: number): void {
  while (sRipple_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function Ripple_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  gScanlineEffectRegBuffers[1].fill(T().cameraY & 0xffff, 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_Ripple);
  SetHBlankCallback(HBlankCB_Ripple);
  task.data[tState]++;
  return true;
}

function Ripple_Main(task: Task): boolean {
  const tSinVal = 1;
  const tAmplitude = 2;
  const tTimer = 3;
  const tFadeStarted = 4;
  T().vblankDma = 0;
  const amplitude = task.data[tAmplitude] >> 8;
  let sinVal = task.data[tSinVal] & 0xffff;
  const speed = 384;
  task.data[tSinVal] += 0x400;
  if (task.data[tAmplitude] <= 0x1fff) task.data[tAmplitude] += 384;
  for (let i = 0; i < DISPLAY_HEIGHT; i++, sinVal = (sinVal + speed) & 0xffff) {
    const sinIndex = sinVal >> 8;
    gScanlineEffectRegBuffers[0][i] = T().cameraY + Sin(sinIndex & 0xffff, amplitude);
  }
  if (++task.data[tTimer] === 41) {
    task.data[tFadeStarted]++;
    BeginNormalPaletteFade(PALETTES_ALL, -8, 0, 16, RGB_BLACK);
  }
  if (task.data[tFadeStarted] && !gPaletteFade.active) DestroyTask(FindTaskIdByFunc(Task_Ripple));
  T().vblankDma++;
  return false;
}

function VBlankCB_Ripple(): void {
  VBlankCB_BattleTransition();
  if (T().vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, 160));
}

function HBlankCB_Ripple(): void {
  const offset = gScanlineEffectRegBuffers[1][getVCount()];
  SetGpuReg(REG_OFFSET_BG1VOFS, offset);
  SetGpuReg(REG_OFFSET_BG2VOFS, offset);
  SetGpuReg(REG_OFFSET_BG3VOFS, offset);
}

// -------------------
// B_TRANSITION_WAVE
// -------------------

const sWave_Funcs: TransitionStateFunc[] = [Wave_Init, Wave_Main, Wave_End];

function Task_Wave(taskId: number): void {
  while (sWave_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function Wave_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  const t = T();
  t.winIn = WININ_WIN0_ALL;
  t.winOut = 0;
  t.win0H = DISPLAY_WIDTH;
  t.win0V = DISPLAY_HEIGHT;
  gScanlineEffectRegBuffers[1].fill(DISPLAY_WIDTH + 2, 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_Wave);
  task.data[tState]++;
  return true;
}

function Wave_Main(task: Task): boolean {
  const tX = 1;
  const tSinIndex = 2;
  T().vblankDma = 0;
  const winVal = gScanlineEffectRegBuffers[0];
  let sinIndex = task.data[tSinIndex] & 0xff;
  task.data[tSinIndex] += 16;
  task.data[tX] += 8;
  let finished = true;
  for (let i = 0; i < DISPLAY_HEIGHT; i++, sinIndex = (sinIndex + 4) & 0xff) {
    let x = s16(task.data[tX] + Sin(sinIndex, 40));
    if (x < 0) x = 0;
    if (x > DISPLAY_WIDTH) x = DISPLAY_WIDTH;
    winVal[i] = WIN_RANGE(x, DISPLAY_WIDTH + 1);
    if (x < DISPLAY_WIDTH) finished = false;
  }
  if (finished) task.data[tState]++;
  T().vblankDma++;
  return false;
}

function Wave_End(_task: Task): boolean {
  DmaStop0();
  FadeScreenBlack();
  DestroyTask(FindTaskIdByFunc(Task_Wave));
  return false;
}

function VBlankCB_Wave(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_WIN0H);
}

// ----------------------------------------------------------------
// B_TRANSITION_LORELEI, B_TRANSITION_BRUNO, B_TRANSITION_AGATHA,
// B_TRANSITION_LANCE, and B_TRANSITION_BLUE
//
// These are all the "mugshot" transitions, where a banner shows
// the trainer pic of the player and their opponent.
// ----------------------------------------------------------------

const tMugshotSinIndex = 1;
const tTopBannerX = 2;
const tBottomBannerX = 3;
const tTimer = 3; // Re-used
const tFadeSpread = 4;
const tOpponentSpriteId = 13;
const tPlayerSpriteId = 14;
const tMugshotId = 15;

// Sprite data for trainer sprites in mugshots
const sState = 0;
const sSlideSpeed = 1;
const sSlideAccel = 2;
const sDone = 6;
const sSlideDir = 7;

const sMugshot_Funcs: TransitionStateFunc[] = [
  Mugshot_Init,
  Mugshot_SetGfx,
  Mugshot_ShowBanner,
  Mugshot_StartOpponentSlide,
  Mugshot_WaitStartPlayerSlide,
  Mugshot_WaitPlayerSlide,
  Mugshot_GradualWhiteFade,
  Mugshot_InitFadeWhiteToBlack,
  Mugshot_FadeToBlack,
  Mugshot_End,
];

function Task_Lorelei(taskId: number): void {
  gTasks[taskId].data[tMugshotId] = K.MUGSHOT_LORELEI;
  DoMugshotTransition(taskId);
}

function Task_Bruno(taskId: number): void {
  gTasks[taskId].data[tMugshotId] = K.MUGSHOT_BRUNO;
  DoMugshotTransition(taskId);
}

function Task_Agatha(taskId: number): void {
  gTasks[taskId].data[tMugshotId] = K.MUGSHOT_AGATHA;
  DoMugshotTransition(taskId);
}

function Task_Lance(taskId: number): void {
  gTasks[taskId].data[tMugshotId] = K.MUGSHOT_LANCE;
  DoMugshotTransition(taskId);
}

function Task_Blue(taskId: number): void {
  gTasks[taskId].data[tMugshotId] = K.MUGSHOT_BLUE;
  DoMugshotTransition(taskId);
}

function DoMugshotTransition(taskId: number): void {
  while (sMugshot_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function Mugshot_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  Mugshots_CreateTrainerPics(task);
  task.data[tMugshotSinIndex] = 0;
  task.data[tTopBannerX] = 1;
  task.data[tBottomBannerX] = DISPLAY_WIDTH - 1;
  const t = T();
  t.winIn = WININ_WIN0_ALL;
  t.winOut = WININ_WIN0_BG1 | WININ_WIN0_BG2 | WININ_WIN0_BG3 | WININ_WIN0_OBJ | WININ_WIN0_CLR;
  t.win0V = DISPLAY_HEIGHT;
  gScanlineEffectRegBuffers[1].fill(WIN_RANGE(DISPLAY_WIDTH, DISPLAY_WIDTH + 1), 0, DISPLAY_HEIGHT);
  SetVBlankCallback(VBlankCB_Mugshots);
  task.data[tState]++;
  return false;
}

function Mugshot_SetGfx(task: Task): boolean {
  const { tilemap, tileset } = GetBg0TilesDst();
  const mugshotsMap = gfx16('sMugshotsTilemap');
  copyToVramAt(gfx('sMugshotBanner_Gfx'), tileset);
  LoadPalette(gfx16(OPPONENT_MUGSHOT_PALS[task.data[tMugshotId]]), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  LoadPalette(gfx16(PLAYER_MUGSHOT_PALS[playerGender()]), BG_PLTT_ID(15) + 10, (16 - 10) * 2);
  let k = 0;
  for (let i = 0; i < 20; i++) for (let j = 0; j < 32; j++, k++) SET_TILE(tilemap, i, j, mugshotsMap[k]);
  SetHBlankCallback(HBlankCB_Mugshots);
  task.data[tState]++;
  return false;
}

function Mugshot_ShowBanner(task: Task): boolean {
  T().vblankDma = 0;
  const winVal = gScanlineEffectRegBuffers[0];
  let sinIndex = task.data[tMugshotSinIndex] & 0xff;
  task.data[tMugshotSinIndex] += 16;
  let i = 0;
  // Update top banner
  for (; i < DISPLAY_HEIGHT / 2; i++, sinIndex = (sinIndex + 16) & 0xff) {
    let x = s16(task.data[tTopBannerX] + Sin(sinIndex, 16));
    if (x < 0) x = 1;
    if (x > DISPLAY_WIDTH) x = DISPLAY_WIDTH;
    winVal[i] = x;
  }
  // Update bottom banner
  for (; i < DISPLAY_HEIGHT; i++, sinIndex = (sinIndex + 16) & 0xff) {
    let x = s16(task.data[tBottomBannerX] - Sin(sinIndex, 16));
    if (x < 0) x = 0;
    if (x > DISPLAY_WIDTH - 1) x = DISPLAY_WIDTH - 1;
    winVal[i] = (x << 8) | DISPLAY_WIDTH;
  }
  // Slide banners across screen
  task.data[tTopBannerX] += 8;
  task.data[tBottomBannerX] -= 8;
  if (task.data[tTopBannerX] > DISPLAY_WIDTH) task.data[tTopBannerX] = DISPLAY_WIDTH;
  if (task.data[tBottomBannerX] < 0) task.data[tBottomBannerX] = 0;
  // mergedValue = *(s32 *)(&task->tTopBannerX)
  const mergedValue = (task.data[tTopBannerX] & 0xffff) | (task.data[tBottomBannerX] << 16);
  if (mergedValue === DISPLAY_WIDTH) task.data[tState]++;
  T().bg0HOfsOpponent -= 8;
  T().bg0HOfsPlayer += 8;
  T().vblankDma++;
  return false;
}

function Mugshot_StartOpponentSlide(task: Task): boolean {
  T().vblankDma = 0;
  gScanlineEffectRegBuffers[0].fill(DISPLAY_WIDTH, 0, DISPLAY_HEIGHT);
  task.data[tState]++;
  // Clear old data
  task.data[tMugshotSinIndex] = 0;
  task.data[tTopBannerX] = 0;
  task.data[tBottomBannerX] = 0;
  T().bg0HOfsOpponent -= 8;
  T().bg0HOfsPlayer += 8;
  SetTrainerPicSlideDirection(task.data[tOpponentSpriteId], 0);
  SetTrainerPicSlideDirection(task.data[tPlayerSpriteId], 1);
  // Start opponent slide
  IncrementTrainerPicState(task.data[tOpponentSpriteId]);
  PlaySE(K.SE_MUGSHOT);
  T().vblankDma++;
  return false;
}

function Mugshot_WaitStartPlayerSlide(task: Task): boolean {
  T().bg0HOfsOpponent -= 8;
  T().bg0HOfsPlayer += 8;
  // Start player's slide in once the opponent is finished
  if (IsTrainerPicSlideDone(task.data[tOpponentSpriteId])) {
    task.data[tState]++;
    IncrementTrainerPicState(task.data[tPlayerSpriteId]);
  }
  return false;
}

function Mugshot_WaitPlayerSlide(task: Task): boolean {
  T().bg0HOfsOpponent -= 8;
  T().bg0HOfsPlayer += 8;
  if (IsTrainerPicSlideDone(task.data[tPlayerSpriteId])) {
    T().vblankDma = 0;
    SetVBlankCallback(null);
    DmaStop0();
    gScanlineEffectRegBuffers[0].fill(0, 0, DISPLAY_HEIGHT);
    gScanlineEffectRegBuffers[1].fill(0, 0, DISPLAY_HEIGHT);
    SetGpuReg(REG_OFFSET_WIN0H, DISPLAY_WIDTH);
    SetGpuReg(REG_OFFSET_BLDY, 0);
    task.data[tState]++;
    task.data[tTimer] = 0;
    task.data[tFadeSpread] = 0;
    T().bldCnt = BLDCNT_TGT1_ALL | BLDCNT_EFFECT_LIGHTEN;
    SetVBlankCallback(VBlankCB_MugshotsFadeOut);
  }
  return false;
}

function Mugshot_GradualWhiteFade(task: Task): boolean {
  T().vblankDma = 0;
  let active = true;
  T().bg0HOfsOpponent -= 8;
  T().bg0HOfsPlayer += 8;
  if (task.data[tFadeSpread] < DISPLAY_HEIGHT / 2) task.data[tFadeSpread] += 2;
  if (task.data[tFadeSpread] > DISPLAY_HEIGHT / 2) task.data[tFadeSpread] = DISPLAY_HEIGHT / 2;
  if (++task.data[tTimer] & 1) {
    active = false;
    for (let i = 0; i <= task.data[tFadeSpread]; i++) {
      // Fade starts in middle of screen and
      // spreads outwards in both directions.
      const y1 = DISPLAY_HEIGHT / 2 - i;
      const y2 = DISPLAY_HEIGHT / 2 + i;
      if (gScanlineEffectRegBuffers[0][y1] <= 15) {
        active = true;
        gScanlineEffectRegBuffers[0][y1]++;
      }
      if (gScanlineEffectRegBuffers[0][y2] <= 15) {
        active = true;
        gScanlineEffectRegBuffers[0][y2]++;
      }
    }
  }
  if (task.data[tFadeSpread] === DISPLAY_HEIGHT / 2 && !active) task.data[tState]++;
  T().vblankDma++;
  return false;
}

// Set palette to white to replace the scanline white fade
// before the screen fades to black.
function Mugshot_InitFadeWhiteToBlack(task: Task): boolean {
  T().vblankDma = 0;
  BlendPalettes(PALETTES_ALL, 16, RGB_WHITE);
  T().bldCnt = BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_BG3 | BLDCNT_TGT1_OBJ | BLDCNT_TGT1_BD | BLDCNT_EFFECT_DARKEN;
  task.data[tTimer] = 0;
  task.data[tState]++;
  return true;
}

function Mugshot_FadeToBlack(task: Task): boolean {
  T().vblankDma = 0;
  task.data[tTimer]++;
  // memset: every byte of the buffer is the timer
  gScanlineEffectRegBuffers[0].fill((task.data[tTimer] & 0xff) * 0x101, 0, DISPLAY_HEIGHT);
  if (task.data[tTimer] > 15) task.data[tState]++;
  T().vblankDma++;
  return false;
}

function Mugshot_End(task: Task): boolean {
  DmaStop0();
  FadeScreenBlack();
  DestroyTask(FindTaskIdByFunc(task.func));
  return false;
}

function VBlankCB_Mugshots(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetGpuReg(REG_OFFSET_BG0VOFS, t.bg0VOfs);
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_WIN0H);
}

function VBlankCB_MugshotsFadeOut(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetGpuReg(REG_OFFSET_BLDCNT, t.bldCnt);
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_BLDY);
}

function HBlankCB_Mugshots(): void {
  if (getVCount() < DISPLAY_HEIGHT / 2) SetGpuReg(REG_OFFSET_BG0HOFS, T().bg0HOfsOpponent);
  else SetGpuReg(REG_OFFSET_BG0HOFS, T().bg0HOfsPlayer);
}

/** gSaveBlock2Ptr->playerGender */
function playerGender(): number {
  return state.playerGender === 'female' ? K.FEMALE : K.MALE;
}

/** sNewGameOakOamAttributes */
const sNewGameOakOamAttributes = () => {
  const [shape, size] = SPRITE_SHAPE['64x64'];
  return oam({ shape, size, priority: 0 });
};

/** CreateTrainerSprite (field_effect.c): the trainer's front pic, sheet and palette tagged with its id. */
function CreateTrainerSprite(trainerSpriteID: number, x: number, y: number, subpriority: number): number {
  const pic = bdata.anims.trainerFrontPics[trainerSpriteID]!;
  LoadSpritePalette({ data: gfx16(bdata.anims.trainerFrontPalettes[trainerSpriteID]!), tag: trainerSpriteID });
  LoadSpriteSheet({ data: gfx(pic.pic), size: pic.size, tag: trainerSpriteID });
  const spriteTemplate: SpriteTemplate = {
    tileTag: trainerSpriteID,
    paletteTag: trainerSpriteID,
    oam: sNewGameOakOamAttributes(),
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
  return CreateSprite(spriteTemplate, x, y, subpriority);
}

function Mugshots_CreateTrainerPics(task: Task): void {
  SetReservedSpritePaletteCount(10);
  const mugshotId = task.data[tMugshotId];
  task.data[tOpponentSpriteId] = CreateTrainerSprite(
    MUGSHOT_TRAINER_PICS()[mugshotId],
    sMugshotsOpponentCoords[mugshotId][0] - 32,
    sMugshotsOpponentCoords[mugshotId][1] + 42,
    0,
  );
  task.data[tPlayerSpriteId] = CreateTrainerSprite(PlayerGenderToFrontTrainerPicId(playerGender()), DISPLAY_WIDTH + 32, 106, 0);
  SetReservedSpritePaletteCount(12);

  const opponentSprite = gSprites[task.data[tOpponentSpriteId]];
  const playerSprite = gSprites[task.data[tPlayerSpriteId]];
  opponentSprite.callback = SpriteCB_MugshotTrainerPic;
  playerSprite.callback = SpriteCB_MugshotTrainerPic;
  opponentSprite.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  playerSprite.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  opponentSprite.oam.matrixNum = AllocOamMatrix();
  playerSprite.oam.matrixNum = AllocOamMatrix();
  const [shape, size] = SPRITE_SHAPE['64x32'];
  opponentSprite.oam.shape = shape;
  playerSprite.oam.shape = shape;
  opponentSprite.oam.size = size;
  playerSprite.oam.size = size;
  CalcCenterToCornerVec(opponentSprite, shape, size, ST_OAM_AFFINE_DOUBLE);
  CalcCenterToCornerVec(playerSprite, shape, size, ST_OAM_AFFINE_DOUBLE);
  SetOamMatrixRotationScaling(opponentSprite.oam.matrixNum, sMugshotsOpponentRotationScales[mugshotId][0], sMugshotsOpponentRotationScales[mugshotId][1], 0);
  SetOamMatrixRotationScaling(playerSprite.oam.matrixNum, -512, 512, 0);
}

const sMugshotTrainerPicFuncs: TransitionSpriteCallback[] = [
  MugshotTrainerPic_Pause,
  MugshotTrainerPic_Init,
  MugshotTrainerPic_Slide,
  MugshotTrainerPic_SlideSlow,
  MugshotTrainerPic_Pause,
  MugshotTrainerPic_SlideOffscreen,
  MugshotTrainerPic_Pause,
];

function SpriteCB_MugshotTrainerPic(sprite: Sprite): void {
  while (sMugshotTrainerPicFuncs[sprite.data[sState]](sprite));
}

// Wait until IncrementTrainerPicState is called
function MugshotTrainerPic_Pause(_sprite: Sprite): boolean {
  return false;
}

function MugshotTrainerPic_Init(sprite: Sprite): boolean {
  sprite.data[sState]++;
  sprite.data[sSlideSpeed] = sTrainerPicSlideSpeeds[sprite.data[sSlideDir]];
  sprite.data[sSlideAccel] = sTrainerPicSlideAccels[sprite.data[sSlideDir]];
  return true;
}

function MugshotTrainerPic_Slide(sprite: Sprite): boolean {
  sprite.x += sprite.data[sSlideSpeed];
  // Advance state when pic passes ~40% of screen
  if (sprite.data[sSlideDir] && sprite.x < DISPLAY_WIDTH - 107) sprite.data[sState]++;
  else if (!sprite.data[sSlideDir] && sprite.x > 103) sprite.data[sState]++;
  return false;
}

function MugshotTrainerPic_SlideSlow(sprite: Sprite): boolean {
  // Add acceleration value to speed, then add speed.
  // For both sides acceleration is opposite speed, so slide slows down.
  sprite.data[sSlideSpeed] += sprite.data[sSlideAccel];
  sprite.x += sprite.data[sSlideSpeed];
  // Advance state when slide comes to a stop
  if (sprite.data[sSlideSpeed] === 0) {
    sprite.data[sState]++;
    sprite.data[sSlideAccel] = -sprite.data[sSlideAccel];
    sprite.data[sDone] = 1;
  }
  return false;
}

// Slides trainer pic offscreen. This is never reached, because it's preceded
// by a second MugshotTrainerPic_Pause, and IncrementTrainerPicState is
// only called once per trainer pic.
function MugshotTrainerPic_SlideOffscreen(sprite: Sprite): boolean {
  sprite.data[sSlideSpeed] += sprite.data[sSlideAccel];
  sprite.x += sprite.data[sSlideSpeed];
  if (sprite.x < -31 || sprite.x > DISPLAY_WIDTH + 31) sprite.data[sState]++;
  return false;
}

function SetTrainerPicSlideDirection(spriteId: number, dirId: number): void {
  gSprites[spriteId].data[sSlideDir] = dirId;
}

function IncrementTrainerPicState(spriteId: number): void {
  gSprites[spriteId].data[sState]++;
}

function IsTrainerPicSlideDone(spriteId: number): number {
  return gSprites[spriteId].data[sDone];
}

// --------------------
// B_TRANSITION_SLICE
// --------------------

const sSlice_Funcs: TransitionStateFunc[] = [Slice_Init, Slice_Main, Slice_End];

function Task_Slice(taskId: number): void {
  while (sSlice_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

const tEffectX = 1;
const tSpeed = 2;
const tAccel = 3;

function Slice_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  task.data[tSpeed] = 1 << 8;
  task.data[tAccel] = 1;
  const t = T();
  t.winIn = WININ_WIN0_ALL;
  t.winOut = 0;
  t.win0V = DISPLAY_HEIGHT;
  for (let i = 0; i < DISPLAY_HEIGHT; i++) {
    gScanlineEffectRegBuffers[1][i] = t.cameraX;
    gScanlineEffectRegBuffers[1][DISPLAY_HEIGHT + i] = DISPLAY_WIDTH;
  }
  SetVBlankCallback(VBlankCB_Slice);
  SetHBlankCallback(HBlankCB_Slice);
  task.data[tState]++;
  return true;
}

function Slice_Main(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  task.data[tEffectX] += task.data[tSpeed] >> 8;
  if (task.data[tEffectX] > DISPLAY_WIDTH) task.data[tEffectX] = DISPLAY_WIDTH;
  if (task.data[tSpeed] <= 0xfff) task.data[tSpeed] += task.data[tAccel];
  if (task.data[tAccel] < 128) task.data[tAccel] <<= 1;
  for (let i = 0; i < DISPLAY_HEIGHT; i++) {
    // Alternate rows
    if (i & 1) {
      gScanlineEffectRegBuffers[0][i] = t.cameraX + task.data[tEffectX];
      gScanlineEffectRegBuffers[0][i + DISPLAY_HEIGHT] = DISPLAY_WIDTH - task.data[tEffectX];
    } else {
      gScanlineEffectRegBuffers[0][i] = t.cameraX - task.data[tEffectX];
      gScanlineEffectRegBuffers[0][i + DISPLAY_HEIGHT] = WIN_RANGE(task.data[tEffectX], DISPLAY_WIDTH + 1);
    }
  }
  if (task.data[tEffectX] >= DISPLAY_WIDTH) task.data[tState]++;
  t.vblankDma++;
  return false;
}

function Slice_End(_task: Task): boolean {
  DmaStop0();
  FadeScreenBlack();
  DestroyTask(FindTaskIdByFunc(Task_Slice));
  return false;
}

function VBlankCB_Slice(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT * 2));
  DmaSetHBlank16(gScanlineEffectRegBuffers[1].subarray(DISPLAY_HEIGHT), REG_OFFSET_WIN0H);
}

function HBlankCB_Slice(): void {
  const offset = gScanlineEffectRegBuffers[1][getVCount()];
  SetGpuReg(REG_OFFSET_BG1HOFS, offset);
  SetGpuReg(REG_OFFSET_BG2HOFS, offset);
  SetGpuReg(REG_OFFSET_BG3HOFS, offset);
}

// ------------------------------
// B_TRANSITION_WHITE_BARS_FADE
// ------------------------------

const sFade = 0;
const sFinished = 1;
const sBarDelay = 5;
const sIsMainSprite = 6;

const FADE_TARGET = 16 << 8;

const sWhiteBarsFade_Funcs: TransitionStateFunc[] = [
  WhiteBarsFade_Init,
  WhiteBarsFade_StartBars,
  WhiteBarsFade_WaitBars,
  WhiteBarsFade_BlendToBlack,
  WhiteBarsFade_End,
];

function Task_WhiteBarsFade(taskId: number): void {
  while (sWhiteBarsFade_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function WhiteBarsFade_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  const t = T();
  t.bldCnt = BLDCNT_TGT1_ALL | BLDCNT_EFFECT_LIGHTEN;
  t.bldY = 0;
  t.winIn = WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ;
  t.winOut = WINOUT_WIN01_ALL;
  t.win0V = DISPLAY_HEIGHT;
  for (let i = 0; i < DISPLAY_HEIGHT; i++) {
    gScanlineEffectRegBuffers[1][i] = 0;
    gScanlineEffectRegBuffers[1][i + DISPLAY_HEIGHT] = DISPLAY_WIDTH;
  }
  SetHBlankCallback(HBlankCB_WhiteBarsFade);
  SetVBlankCallback(VBlankCB_WhiteBarsFade);
  task.data[tState]++;
  return false;
}

function WhiteBarsFade_StartBars(task: Task): boolean {
  let sprite: Sprite | undefined;
  for (let i = 0, posY = 0; i < NUM_WHITE_BARS; i++, posY += WHITE_BAR_HEIGHT) {
    sprite = gSprites[CreateInvisibleSprite(SpriteCB_WhiteBarFade)];
    sprite.x = DISPLAY_WIDTH;
    sprite.y = posY;
    sprite.data[sBarDelay] = sWhiteBarsFade_StartDelays[i];
  }
  // Set on one sprite only. This one will enable the DMA
  // copy in VBlank and wait for the others to destroy.
  sprite!.data[sIsMainSprite]++;
  task.data[tState]++;
  return false;
}

function WhiteBarsFade_WaitBars(task: Task): boolean {
  T().vblankDma = 0;
  if (T().counter >= NUM_WHITE_BARS) {
    BlendPalettes(PALETTES_ALL, 16, RGB_WHITE);
    task.data[tState]++;
  }
  return false;
}

function WhiteBarsFade_BlendToBlack(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  DmaStop0();
  SetVBlankCallback(null);
  SetHBlankCallback(null);
  t.win0H = DISPLAY_WIDTH;
  t.bldY = 0;
  t.bldCnt = BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_BG3 | BLDCNT_TGT1_OBJ | BLDCNT_TGT1_BD | BLDCNT_EFFECT_DARKEN;
  t.winIn = WININ_WIN0_ALL;
  t.counter = 0;
  SetVBlankCallback(VBlankCB_WhiteBarsFade_Blend);
  task.data[tState]++;
  return false;
}

function WhiteBarsFade_End(_task: Task): boolean {
  const t = T();
  t.counter += 480;
  t.bldY = t.counter >> 8;
  if (t.bldY > 16) {
    FadeScreenBlack();
    DestroyTask(FindTaskIdByFunc(Task_WhiteBarsFade));
  }
  return false;
}

function VBlankCB_WhiteBarsFade(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  SetGpuReg(REG_OFFSET_BLDCNT, t.bldCnt);
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0H); // BUG: This should obviously be sTransitionData->win0V
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT * 2));
  DmaSetHBlank16(gScanlineEffectRegBuffers[1].subarray(DISPLAY_HEIGHT), REG_OFFSET_WIN0H);
}

function VBlankCB_WhiteBarsFade_Blend(): void {
  VBlankCB_BattleTransition();
  const t = T();
  SetGpuReg(REG_OFFSET_BLDY, t.bldY);
  SetGpuReg(REG_OFFSET_BLDCNT, t.bldCnt);
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0H, t.win0H);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
}

function HBlankCB_WhiteBarsFade(): void {
  let index = getVCount();
  if (index === 227) index = 0;
  SetGpuReg(REG_OFFSET_BLDY, gScanlineEffectRegBuffers[1][index]);
}

function SpriteCB_WhiteBarFade(sprite: Sprite): void {
  if (sprite.data[sBarDelay]) {
    sprite.data[sBarDelay]--;
    if (sprite.data[sIsMainSprite]) T().vblankDma = 1;
  } else {
    const bldY = sprite.y;
    const win0H = sprite.y + DISPLAY_HEIGHT;
    // Each bar is 27 pixels high. With 6 bars this is a total of 162, which is 2 pixels taller than the screen.
    // 1 bar is therefore shortened by 2 pixels
    const stripeWidth = sprite.data[sIsMainSprite] ? WHITE_BAR_HEIGHT - 2 : WHITE_BAR_HEIGHT;
    for (let i = 0; i < stripeWidth; i++) {
      gScanlineEffectRegBuffers[0][bldY + i] = sprite.data[sFade] >> 8;
      gScanlineEffectRegBuffers[0][win0H + i] = sprite.x & 0xff;
    }
    if (sprite.x === 0 && sprite.data[sFade] === FADE_TARGET) sprite.data[sFinished] = 1;
    sprite.x -= 24;
    sprite.data[sFade] += 192;
    if (sprite.x < 0) sprite.x = 0;
    if (sprite.data[sFade] > FADE_TARGET) sprite.data[sFade] = FADE_TARGET;
    if (sprite.data[sIsMainSprite]) T().vblankDma = 1;
    if (sprite.data[sFinished]) {
      if (sprite.data[sIsMainSprite] === 0 || T().counter > 4) {
        T().counter++;
        DestroySprite(sprite);
      }
    }
  }
}

// ---------------------------
// B_TRANSITION_GRID_SQUARES
// ---------------------------

const sGridSquares_Funcs: TransitionStateFunc[] = [GridSquares_Init, GridSquares_Main, GridSquares_End];

function Task_GridSquares(taskId: number): void {
  while (sGridSquares_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function GridSquares_Init(task: Task): boolean {
  const { tilemap, tileset } = GetBg0TilesDst();
  copyToVramAt(gfx('sGridSquare_Gfx'), tileset, 0x20);
  // CpuFill16(0xF0 << 8, tilemap, BG_SCREEN_SIZE): tile 0 in palette 15 everywhere
  for (let i = 0; i < 0x800; i += 2) {
    vram[tilemap + i] = 0;
    vram[tilemap + i + 1] = 0xf0;
  }
  LoadPalette(gfx16('sFieldEffectPal_Pokeball'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  task.data[tState]++;
  return false;
}

function GridSquares_Main(task: Task): boolean {
  const tDelay = 1;
  const tShrinkStage = 2;
  if (task.data[tDelay] === 0) {
    const tileset = GetBg0TilemapDst();
    task.data[tDelay] = 3;
    task.data[tShrinkStage]++;
    // &sGridSquare_Gfx[stage * 8]: 8 u32s = one 4bpp tile per stage
    copyToVramAt(gfx('sGridSquare_Gfx').subarray(task.data[tShrinkStage] * 32), tileset, 0x20);
    if (task.data[tShrinkStage] > 13) {
      task.data[tState]++;
      task.data[tDelay] = 16;
    }
  }
  task.data[tDelay]--;
  return false;
}

function GridSquares_End(task: Task): boolean {
  if (--task.data[1] === 0) {
    FadeScreenBlack();
    DestroyTask(FindTaskIdByFunc(Task_GridSquares));
  }
  return false;
}

// ---------------------------
// B_TRANSITION_ANGLED_WIPES
// ---------------------------

const tWipeId = 1;
const tDir = 2;
const tAngledDelay = 3;

const sAngledWipes_Funcs: TransitionStateFunc[] = [AngledWipes_Init, AngledWipes_SetWipeData, AngledWipes_DoWipe, AngledWipes_TryEnd, AngledWipes_StartNext];

function Task_AngledWipes(taskId: number): void {
  while (sAngledWipes_Funcs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function AngledWipes_Init(task: Task): boolean {
  InitTransitionData();
  ScanlineEffect_Clear();
  const t = T();
  t.winIn = WININ_WIN0_ALL;
  t.winOut = 0;
  t.win0V = DISPLAY_HEIGHT;
  gScanlineEffectRegBuffers[0].fill(WIN_RANGE(0, DISPLAY_WIDTH), 0, DISPLAY_HEIGHT);
  gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetVBlankCallback(VBlankCB_AngledWipes);
  task.data[tState]++;
  return true;
}

function AngledWipes_SetWipeData(task: Task): boolean {
  const d = sAngledWipes_MoveData[task.data[tWipeId]];
  InitBlackWipe(T().data, d[0], d[1], d[2], d[3], 1, 1);
  task.data[tDir] = d[4];
  task.data[tState]++;
  return true;
}

function AngledWipes_DoWipe(task: Task): boolean {
  const t = T();
  t.vblankDma = 0;
  let finished = false;
  for (let i = 0; i < 16; i++) {
    let left = gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] >> 8;
    let right = gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] & 0xff;
    if (task.data[tDir] === 0) {
      // Moving down
      if (left < t.data[tWipeCurrX]) left = t.data[tWipeCurrX];
      if (left > right) left = right;
    } else {
      // Moving up
      if (right > t.data[tWipeCurrX]) right = t.data[tWipeCurrX];
      if (right <= left) right = left;
    }
    gScanlineEffectRegBuffers[0][t.data[tWipeCurrY]] = WIN_RANGE2(left, right);
    if (finished) {
      task.data[tState]++;
      break;
    }
    finished = UpdateBlackWipe(t.data, true, true);
  }
  t.vblankDma++;
  return false;
}

function AngledWipes_TryEnd(task: Task): boolean {
  if (++task.data[tWipeId] < NUM_ANGLED_WIPES) {
    // Continue with next wipe
    task.data[tState]++;
    task.data[tAngledDelay] = sAngledWipes_EndDelays[task.data[tWipeId] - 1];
    return true;
  }
  // End transition
  DmaStop0();
  FadeScreenBlack();
  DestroyTask(FindTaskIdByFunc(Task_AngledWipes));
  return false;
}

function AngledWipes_StartNext(task: Task): boolean {
  if (--task.data[tAngledDelay] === 0) {
    // Return to AngledWipes_SetWipeData
    task.data[tState] = 1;
    return true;
  }
  return false;
}

function VBlankCB_AngledWipes(): void {
  DmaStop0();
  VBlankCB_BattleTransition();
  const t = T();
  if (t.vblankDma) gScanlineEffectRegBuffers[1].set(gScanlineEffectRegBuffers[0].subarray(0, DISPLAY_HEIGHT));
  SetGpuReg(REG_OFFSET_WININ, t.winIn);
  SetGpuReg(REG_OFFSET_WINOUT, t.winOut);
  SetGpuReg(REG_OFFSET_WIN0V, t.win0V);
  SetGpuReg(REG_OFFSET_WIN0H, gScanlineEffectRegBuffers[1][0]);
  DmaSetHBlank16(gScanlineEffectRegBuffers[1], REG_OFFSET_WIN0H);
}

// -----------------------------------
// Transition intro
// -----------------------------------

const tFadeToGrayDelay = 1;
const tFadeFromGrayDelay = 2;
const tNumFades = 3;
const tFadeToGraySpeed = 4;
const tFadeFromGraySpeed = 5;
const tDelayTimer = 6;
const tBlend = 7;

const sTransitionIntroFuncs: TransitionStateFunc[] = [TransitionIntro_FadeToGray, TransitionIntro_FadeFromGray];

function CreateIntroTask(fadeToGrayDelay: number, fadeFromGrayDelay: number, numFades: number, fadeToGraySpeed: number, fadeFromGraySpeed: number): void {
  const taskId = CreateTask(Task_BattleTransition_Intro, 3);
  const data = gTasks[taskId].data;
  data[tFadeToGrayDelay] = fadeToGrayDelay;
  data[tFadeFromGrayDelay] = fadeFromGrayDelay;
  data[tNumFades] = numFades;
  data[tFadeToGraySpeed] = fadeToGraySpeed;
  data[tFadeFromGraySpeed] = fadeFromGraySpeed;
  data[tDelayTimer] = fadeToGrayDelay;
}

function IsIntroTaskDone(): boolean {
  return FindTaskIdByFunc(Task_BattleTransition_Intro) === TASK_NONE;
}

function Task_BattleTransition_Intro(taskId: number): void {
  while (sTransitionIntroFuncs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function TransitionIntro_FadeToGray(task: Task): boolean {
  if (task.data[tDelayTimer] === 0 || --task.data[tDelayTimer] === 0) {
    task.data[tDelayTimer] = task.data[tFadeToGrayDelay];
    task.data[tBlend] += task.data[tFadeToGraySpeed];
    if (task.data[tBlend] > 16) task.data[tBlend] = 16;
    BlendPalettes(PALETTES_ALL, task.data[tBlend], RGB(11, 11, 11));
  }
  if (task.data[tBlend] >= 16) {
    // Fade to gray complete, start fade back
    task.data[tState]++;
    task.data[tDelayTimer] = task.data[tFadeFromGrayDelay];
  }
  return false;
}

function TransitionIntro_FadeFromGray(task: Task): boolean {
  if (task.data[tDelayTimer] === 0 || --task.data[tDelayTimer] === 0) {
    task.data[tDelayTimer] = task.data[tFadeFromGrayDelay];
    task.data[tBlend] -= task.data[tFadeFromGraySpeed];
    if (task.data[tBlend] < 0) task.data[tBlend] = 0;
    BlendPalettes(PALETTES_ALL, task.data[tBlend], RGB(11, 11, 11));
  }
  if (task.data[tBlend] === 0) {
    if (--task.data[tNumFades] === 0) {
      // All fades done, end intro
      DestroyTask(FindTaskIdByFunc(Task_BattleTransition_Intro));
    } else {
      // Fade from gray complete, start new fade
      task.data[tDelayTimer] = task.data[tFadeToGrayDelay];
      task.data[tState] = 0;
    }
  }
  return false;
}

// -----------------------------------
// General transition functions
// -----------------------------------

function InitTransitionData(): void {
  const t = T();
  t.clear();
  // FieldCameraGetPixelOffsetAtGround
  const camera = sFieldCameraOffset();
  t.cameraX = s16(camera.x);
  t.cameraY = s16(camera.y);
}

function VBlankCB_BattleTransition(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** GetBg0TilemapDst: the BG0 tile data's VRAM address (the C names it tileset). */
function GetBg0TilemapDst(): number {
  const charBase = (GetGpuReg(REG_OFFSET_BG0CNT) >> 2) & 3;
  return charBase << 14;
}

function GetBg0TilesDst(): { tilemap: number; tileset: number } {
  const screenBase = (GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f;
  const charBase = (GetGpuReg(REG_OFFSET_BG0CNT) >> 2) & 3;
  return { tilemap: screenBase << 11, tileset: charBase << 14 };
}

function FadeScreenBlack(): void {
  BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
}

function SetSinWave(buffer: Uint16Array, offset: number, index: number, frequency: number, amplitude: number, bufSize: number): void {
  for (let i = 0; bufSize > 0; bufSize--, i = (i + 1) & 0xff, index = s16(index + frequency)) buffer[i] = offset + Sin(index & 0xff, amplitude);
}

function SetCircularMask(buffer: Uint16Array, x: number, y: number, radius: number): void {
  buffer.fill(0x0a0a, 0, DISPLAY_HEIGHT); // memset(buffer, 10, ...)
  // 64 iterations because we only want to cover [0, π/2) discretely.
  for (let i = 0; i < 64; i++) {
    // The loop variable i here does not stand for rotation angle,
    // but is the angle between segment (center, pointOnCircle)
    // and vertical line.
    const sinResult = Sin(i, radius);
    let cosResult = Cos(i, radius);
    let leftX = s16(x - sinResult);
    let winVal = s16(x + sinResult);
    let topY = s16(y - cosResult);
    let bottomY = s16(y + cosResult);
    if (leftX < 0) leftX = 0;
    if (winVal > DISPLAY_WIDTH) winVal = DISPLAY_WIDTH;
    if (topY < 0) topY = 0;
    if (bottomY > DISPLAY_HEIGHT - 1) bottomY = DISPLAY_HEIGHT - 1;
    winVal = s16(winVal | (leftX << 8));
    buffer[topY] = winVal;
    buffer[bottomY] = winVal;
    cosResult = Cos(i + 1, radius);
    let nextTopY = s16(y - cosResult);
    let nextBottomY = s16(y + cosResult);
    if (nextTopY < 0) nextTopY = 0;
    if (nextBottomY > DISPLAY_HEIGHT - 1) nextBottomY = DISPLAY_HEIGHT - 1;
    // fill everything in between with the same WIN0H value
    while (topY > nextTopY) buffer[--topY] = winVal;
    while (topY < nextTopY) buffer[++topY] = winVal;
    while (bottomY > nextBottomY) buffer[--bottomY] = winVal;
    while (bottomY < nextBottomY) buffer[++bottomY] = winVal;
  }
}

function InitBlackWipe(data: Int16Array, startX: number, startY: number, endX: number, endY: number, stepX: number, stepY: number): void {
  data[tWipeStartX] = startX;
  data[tWipeStartY] = startY;
  data[tWipeCurrX] = startX;
  data[tWipeCurrY] = startY;
  data[tWipeEndX] = endX;
  data[tWipeEndY] = endY;
  data[tWipeXMove] = stepX;
  data[tWipeYMove] = stepY;
  data[tWipeXDist] = endX - startX;
  if (data[tWipeXDist] < 0) {
    // If end was less than start, reverse direction
    data[tWipeXDist] = -data[tWipeXDist];
    data[tWipeXMove] = -stepX;
  }
  data[tWipeYDist] = endY - startY;
  if (data[tWipeYDist] < 0) {
    // If end was less than start, reverse direction
    data[tWipeYDist] = -data[tWipeYDist];
    data[tWipeYMove] = -stepY;
  }
  data[tWipeTemp] = 0;
}

function UpdateBlackWipe(data: Int16Array, xExact: boolean, yExact: boolean): boolean {
  if (data[tWipeXDist] > data[tWipeYDist]) {
    // X has further to move, move it first
    data[tWipeCurrX] += data[tWipeXMove];
    // If it has been far enough since Y's
    // last move then move it too
    data[tWipeTemp] += data[tWipeYDist];
    if (data[tWipeTemp] > data[tWipeXDist]) {
      data[tWipeCurrY] += data[tWipeYMove];
      data[tWipeTemp] -= data[tWipeXDist];
    }
  } else {
    // Y has further to move, move it first
    data[tWipeCurrY] += data[tWipeYMove];
    // If it has been far enough since X's
    // last move then move it too
    data[tWipeTemp] += data[tWipeXDist];
    if (data[tWipeTemp] > data[tWipeYDist]) {
      data[tWipeCurrX] += data[tWipeXMove];
      data[tWipeTemp] -= data[tWipeYDist];
    }
  }
  let numFinished = 0;
  // Has X coord reached end?
  if ((data[tWipeXMove] > 0 && data[tWipeCurrX] >= data[tWipeEndX]) || (data[tWipeXMove] < 0 && data[tWipeCurrX] <= data[tWipeEndX])) {
    numFinished++;
    if (xExact) data[tWipeCurrX] = data[tWipeEndX];
  }
  // Has Y coord reached end?
  if ((data[tWipeYMove] > 0 && data[tWipeCurrY] >= data[tWipeEndY]) || (data[tWipeYMove] < 0 && data[tWipeCurrY] <= data[tWipeEndY])) {
    numFinished++;
    if (yExact) data[tWipeCurrY] = data[tWipeEndY];
  }
  // Return TRUE if both coords have reached end
  return numFinished === 2;
}
