// trade_scene.c's in-game trade scene (W-trade unit 2): DoInGameTradeScene's CB2_InitInGameTrade → CB2_InGameTrade
// (DoTradeAnim) → CB2_ReturnToField, run on the field's GBA host (script/tradeSpecials.ts starts it through
// ScriptHost.runScreenFromScript).
//
// FireRed's in-game trades never set sTradeAnim->isCableTrade (only CB2_LinkTrade does, for a cable link), so
// DoTradeAnim always takes DoTradeAnim_Wireless: the GBA's wireless signal, the white column where the mons
// cross, Task_OpenCenterWhiteColumn / Task_CloseCenterWhiteColumn. DoTradeAnim_Cable (and the cable map and
// cable end sprites it uses) is only reachable from a link trade, which isn't ported.
//
// The sounds are trade_scene.c's, through gba/sound.ts: MUS_EVOLUTION as the map music for the scene (the map's
// song cached and played again at the end), the two cries (the second's IsCryFinished holds the scene), the SEs
// and the MUS_EVOLVED fanfare. The link path's FadeOutBGM / IsBGMStopped wait (CB2_SaveAndEndTrade) isn't ported.

import { setBattleUi, ui } from '../battle/battleUi';
import { K } from '../battle/constants';
import { bdata, pokemon, state } from '../battle/env';
import {
  AllocateMonSpritesGfx,
  CreatePokeballSpriteToReleaseMon,
  CreateTradePokeballSprite,
  FreeMonSpritesGfx,
  GetMonSpritePalStructFromOtIdPersonality,
  gMonSpritesGfxPtr,
  gMultiuseSpriteTemplate,
  LoadSpecialPokePic,
  monPalSymbols,
  monPicSymbol,
  SetMultiuseSpriteTemplateToPokemon,
} from '../battle/gfx';
import { BgAffineSet } from '../gba/bios';
import { ChangeBgX, ChangeBgY, copyToVram, CopyToBgTilemapBuffer, InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BG_CHAR_ADDR,
  BG_SCREEN_ADDR,
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_OBJ,
  BLDCNT_TGT2_BG2,
  ClearGpuRegBits,
  DISPCNT_BG0_ON,
  DISPCNT_BG1_ON,
  DISPCNT_BG2_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GetGpuReg,
  PALETTES_ALL,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2PA,
  REG_OFFSET_BG2PB,
  REG_OFFSET_BG2PC,
  REG_OFFSET_BG2PD,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG2X_H,
  REG_OFFSET_BG2X_L,
  REG_OFFSET_BG2Y_H,
  REG_OFFSET_BG2Y_L,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  SetGpuRegBits,
  WIN_RANGE,
  WININ_WIN0_BG0,
  WININ_WIN0_BG1,
  WININ_WIN0_OBJ,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { A_BUTTON, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { GetCurrentMapMusic, IsCryFinished, PlayCry_Normal, PlayFanfare, PlayNewMapMusic, PlaySE } from '../gba/sound';
import {
  AFFINEANIMCMD_END,
  AFFINEANIMCMD_FRAME,
  AFFINEANIMCMD_JUMP,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_LOOP,
  AnimateSprites,
  BuildOamBuffer,
  CalcCenterToCornerVec,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  FreeSpriteOamMatrix,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_OBJ_BLEND,
  type AffineAnimCmd,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import { AddTextPrinterParameterized4, CopyWindowToVram, COPYWIN_FULL, DeactivateAllTextPrinters, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, FreeAllWindowBuffers, InitWindows, PIXEL_FILL, PutWindowTilemap, RunTextPrinters, type WindowTemplate } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { BufferInGameTradeMonName, inGameTrade, TradeMons } from '../script/tradeSpecials';
import { EOS, ExpandToStringVar4, GetMonNickname, gStringVar1, gStringVar2, gStringVar3, speciesOrEgg, text } from './common';
import { CB2_ReturnToField } from './fieldCallbacks';

/** What the scene loads besides the battle textbox (preloaded with the menus) and the two mon pics. */
export const TRADE_SCENE_GFX = [
  'gBattleInterface_Textbox_Gfx',
  'gBattleInterface_Textbox_Tilemap',
  'gBattleInterface_Textbox_Pal',
  'gTradeGba2_Pal',
  'gTradeGba_Gfx',
  'gTradeOrHatchMonShadowTilemap',
  'sPokeball_Pal',
  'sPokeball_Gfx',
  'sGba_Pal',
  'sLinkMon_Pal',
  'sLinkMonGlow_Gfx',
  'sLinkMonShadow_Gfx',
  'sCableEnd_Gfx',
  'sGbaScreen_Gfx',
  'sGbaAffine_Gfx',
  'sGbaAffineMapWireless',
  'sGbaMapWireless',
  'sWirelessCloseup_Map',
  'sWirelessSignalAnimPals_Outbound',
  'sWirelessSignalAnimPals_Inbound',
  'sWirelessSignalAnimPals_Off',
  'sWirelessSignal4bpp',
  'sWirelessSignalTilemap',
];

/** Every graphics symbol the in-game trade scene draws for these two mons (for preloading). */
export function tradeSceneGfxSymbols(playerMon: Pokemon, partnerMon: Pokemon): string[] {
  const syms = [...TRADE_SCENE_GFX];
  for (const mon of [playerMon, partnerMon]) {
    const species = speciesOrEgg(mon);
    syms.push(monPicSymbol(true, species, mon.personality), ...monPalSymbols(species));
  }
  return syms;
}

const TRADE_PLAYER = 0;
const TRADE_PARTNER = 1;

const GFXTAG_LINK_MON_GLOW = 5550;
const PALTAG_LINK_MON = 5551;
const GFXTAG_LINK_MON_SHADOW = 5552;
const GFXTAG_CABLE_END = 5554;
const PALTAG_GBA = 5555;
const GFXTAG_GBA_SCREEN = 5556;
const GFXTAG_POKEBALL = 5557;
const PALTAG_POKEBALL = 5558;

const RGB_WHITEALPHA = RGB_WHITE | 0x8000;
const BG_SCREEN_SIZE = 0x800;

// gba_macro.h's BGCNT fields
const BGCNT_PRIORITY = (n: number) => n;
const BGCNT_CHARBASE = (n: number) => n << 2;
const BGCNT_256COLOR = 1 << 7;
const BGCNT_SCREENBASE = (n: number) => n << 8;
const BGCNT_TXT256x256 = 0;
const BGCNT_TXT512x256 = 1 << 14;
const BGCNT_TXT256x512 = 2 << 14;
const BGCNT_AFF128x128 = 0;
const DISPCNT_MODE_0 = 0;
const DISPCNT_MODE_1 = 1;

/** The fields of sTradeAnim the in-game path uses (struct in trade_scene.c). */
interface TradeAnim {
  timer: number;
  /** GetCurrentMapMusic() when the scene started: played again at its end */
  cachedMapMusic: number;
  monPersonalities: [number, number];
  monSpriteIds: [number, number];
  /** Multi-purpose sprite ids used during the transfer sequence */
  connectionSpriteId1: number;
  connectionSpriteId2: number;
  state: number;
  releasePokeballSpriteId: number;
  bouncingPokeballSpriteId: number;
  /** u16 */
  bg2texX: number;
  bg2texY: number;
  bg2srcX: number;
  bg2srcY: number;
  /** s16 */
  bg1vofs: number;
  bg1hofs: number;
  bg2vofs: number;
  bg2hofs: number;
  /** u16 */
  sXY: number;
  bg2Zoom: number;
  bg2alpha: number;
  monSpecies: [number, number];
  textColor: [number, number, number];
  /** u8 */
  win0left: number;
  win0top: number;
  win0right: number;
  win0bottom: number;
}

let sTradeAnim: TradeAnim | null = null;
const anim = () => sTradeAnim!;
/** gSelectedTradeMonPositions */
const gSelectedTradeMonPositions = [0, 0];

const s16 = (v: number) => (v << 16) >> 16;
const u16 = (v: number) => v & 0xffff;
const u8 = (v: number) => v & 0xff;

/** For tests: the scene's state while it runs (null otherwise). */
export function tradeSceneProbe(): { state: number; monSpriteIds: number[]; monSpecies: number[] } | null {
  const a = sTradeAnim;
  return a ? { state: a.state, monSpriteIds: [...a.monSpriteIds], monSpecies: [...a.monSpecies] } : null;
}

// ------------------------------------------------------------------ sprite templates

const sAnims_Pokeball: AnimCmd[][] = [
  // sAnim_Pokeball_SpinOnce
  [...[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map((f) => ANIMCMD_FRAME(f, 3)), ANIMCMD_LOOP(1), ANIMCMD_FRAME(0, 3), ANIMCMD_END],
  // sAnim_Pokeball_SpinTwice
  [...[0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map((f) => ANIMCMD_FRAME(f, 3)), ANIMCMD_LOOP(2), ANIMCMD_FRAME(0, 3), ANIMCMD_END],
];

const sAffineAnims_Pokeball: AffineAnimCmd[][] = [
  [AFFINEANIMCMD_FRAME(0, 0, 0, 1), AFFINEANIMCMD_END], // sAffineAnim_Pokeball_Normal
  [AFFINEANIMCMD_FRAME(-8, 0, 0, 20), AFFINEANIMCMD_END], // sAffineAnim_Pokeball_Squish
  [AFFINEANIMCMD_FRAME(96, 256, 0, 0), AFFINEANIMCMD_FRAME(0, 0, 0, 5), AFFINEANIMCMD_FRAME(8, 0, 0, 20), AFFINEANIMCMD_END], // sAffineAnim_Pokeball_Unsquish
];

const sSpriteTemplate_Pokeball: SpriteTemplate = {
  tileTag: GFXTAG_POKEBALL,
  paletteTag: PALTAG_POKEBALL,
  oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1] }),
  anims: sAnims_Pokeball,
  images: null,
  affineAnims: sAffineAnims_Pokeball,
  callback: SpriteCB_BouncingPokeball,
};

const sSpriteTemplate_LinkMonGlow: SpriteTemplate = {
  tileTag: GFXTAG_LINK_MON_GLOW,
  paletteTag: PALTAG_LINK_MON,
  oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, objMode: ST_OAM_OBJ_BLEND, shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 }),
  anims: [[ANIMCMD_FRAME(0, 5, true, true), ANIMCMD_END]], // ? The graphic is a perfect circle, no need to flip
  images: null,
  affineAnims: [[AFFINEANIMCMD_FRAME(-10, -10, 0, 5), AFFINEANIMCMD_FRAME(10, 10, 0, 5), AFFINEANIMCMD_JUMP(0)]],
  callback: SpriteCB_LinkMonGlow,
};

const ANIM_LINKMON_SMALL = 1;

const sSpriteTemplate_LinkMonShadow: SpriteTemplate = {
  tileTag: GFXTAG_LINK_MON_SHADOW,
  paletteTag: PALTAG_LINK_MON,
  oam: oam({ shape: SPRITE_SHAPE['16x32'][0], size: SPRITE_SHAPE['16x32'][1], priority: 1 }),
  anims: [
    [ANIMCMD_FRAME(0, 5, true, true), ANIMCMD_END], // ANIM_LINKMON_BIG
    [ANIMCMD_FRAME(8, 5, true, true), ANIMCMD_END], // ANIM_LINKMON_SMALL
  ],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_LinkMonShadow,
};

const gbaScreenAnim = (loops: number): AnimCmd[] => [...[0, 32, 64, 96, 64, 32, 0].map((f) => ANIMCMD_FRAME(f, 2, true, true)), ANIMCMD_LOOP(loops), ANIMCMD_END];

const sOamData_GbaScreen = oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1], priority: 1 });

const sSpriteTemplate_GbaScreenFlash_Long: SpriteTemplate = {
  tileTag: GFXTAG_GBA_SCREEN,
  paletteTag: PALTAG_GBA,
  oam: sOamData_GbaScreen,
  anims: [gbaScreenAnim(8)],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_GbaScreen,
};

const sSpriteTemplate_GbaScreenFlash_Short: SpriteTemplate = { ...sSpriteTemplate_GbaScreenFlash_Long, anims: [gbaScreenAnim(2)] };

const sLinkMonShadow_Pal = [
  RGB(18, 24, 31),
  RGB(18, 24, 31),
  RGB(18, 24, 31),
  RGB(31, 31, 31),
  RGB(31, 31, 31),
  RGB(31, 31, 31),
  RGB(18, 24, 31),
  RGB(18, 24, 31),
  RGB(18, 24, 31),
  RGB(31, 31, 31),
  RGB(31, 31, 31),
  RGB(31, 31, 31),
];

const sAffineAnims_CrossingMonPics: AffineAnimCmd[][] = [[AFFINEANIMCMD_FRAME(-0x100, 0x100, 0, 0), AFFINEANIMCMD_JUMP(0)]];

const sTradeMessageWindowTemplates: WindowTemplate[] = [{ bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 0, baseBlock: 0x040 }, DUMMY_WIN_TEMPLATE];

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 5, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 1, mapBaseIndex: 18, screenSize: 1, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 0, mapBaseIndex: 6, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

// prettier-ignore
const sTradeBallVerticalVelocityTable = [
   0,  0,  1,  0,
   1,  0,  1,  1,
   1,  1,  2,  2,
   2,  2,  3,  3,
   3,  3,  4,  4,
   4,  4, -4, -4,
  -4, -3, -3, -3,
  -3, -2, -2, -2,
  -2, -1, -1, -1,
  -1,  0, -1,  0,
  -1,  0,  0,  0,
   0,  0,  1,  0,
   1,  0,  1,  1,
   1,  1,  2,  2,
   2,  2,  3,  3,
   3,  3,  4,  4,
   4,  4, -4, -3,
  -3, -2, -2, -1,
  -1, -1,  0, -1,
   0,  0,  0,  0,
   0,  0,  1,  0,
   1,  1,  1,  2,
   2,  3,  3,  4,
  -4, -3, -2, -1,
  -1, -1,  0,  0,
   0,  0,  1,  0,
   1,  1,  2,  3,
];

/** sWirelessSignalAnimParams: [palette index in the send/receive palettes (16 = off), frames]; 0xFF ends it. */
const sWirelessSignalAnimParams: [number, number][] = [
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 3], [11, 3], [12, 3], [13, 4], [14, 5], [15, 2],
  [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 3], [11, 3], [12, 3], [13, 4], [14, 5], [16, 1],
  [16, 0xff],
];

// ------------------------------------------------------------------ sprite callbacks

function SpriteCB_LinkMonGlow(sprite: Sprite): void {
  if (++sprite.data[0] === 10) {
    PlaySE(K.SE_BALL);
    sprite.data[0] = 0;
  }
}

function SpriteCB_LinkMonGlowWireless(sprite: Sprite): void {
  if (!sprite.invisible && ++sprite.data[0] === 10) {
    PlaySE(K.SE_M_SWAGGER2);
    sprite.data[0] = 0;
  }
}

/** Palette flash for trade glow core */
function SpriteCB_LinkMonShadow(sprite: Sprite): void {
  if (sprite.data[1] === 0) {
    if (++sprite.data[0] === 12) sprite.data[0] = 0;
    LoadPalette([sLinkMonShadow_Pal[sprite.data[0]]], OBJ_PLTT_ID(sprite.oam.paletteNum) + 4, 2);
  }
}

function SpriteCB_GbaScreen(sprite: Sprite): void {
  if (++sprite.data[0] === 15) {
    PlaySE(K.SE_M_MINIMIZE);
    sprite.data[0] = 0;
  }
}

function SpriteCB_BouncingPokeball(sprite: Sprite): void {
  sprite.y += Math.trunc(sprite.data[0] / 10);
  sprite.data[5] += sprite.data[1];
  sprite.x = Math.trunc(sprite.data[5] / 10);
  if (sprite.y > 76) {
    sprite.y = 76;
    sprite.data[0] = Math.trunc(-(sprite.data[0] * sprite.data[2]) / 100);
    sprite.data[3]++;
  }
  if (sprite.x === 120) sprite.data[1] = 0;
  sprite.data[0] += sprite.data[4];
  if (sprite.data[3] === 4) {
    sprite.data[7] = 1;
    sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_BouncingPokeballDepart(sprite: Sprite): void {
  sprite.y2 += sTradeBallVerticalVelocityTable[sprite.data[0]];
  if (sprite.data[0] === 22) PlaySE(K.SE_BALL_BOUNCE_1);
  if (++sprite.data[0] === 44) {
    PlaySE(K.SE_M_MEGA_KICK);
    sprite.callback = SpriteCB_BouncingPokeballDepartEnd;
    sprite.data[0] = 0;
    BeginNormalPaletteFade((1 << (sprite.oam.paletteNum + 16)) >>> 0, -1, 0, 16, RGB_WHITEALPHA);
  }
}

function SpriteCB_BouncingPokeballDepartEnd(sprite: Sprite): void {
  if (sprite.data[1] === 20) StartSpriteAffineAnim(sprite, 1);
  if (++sprite.data[1] > 20) {
    sprite.y2 -= sTradeBallVerticalVelocityTable[sprite.data[0]];
    if (++sprite.data[0] === 23) {
      DestroySprite(sprite);
      anim().state = STATE_FADE_OUT_TO_GBA_SEND;
    }
  }
}

function SpriteCB_BouncingPokeballArrive(sprite: Sprite): void {
  if (sprite.data[2] === 0) {
    sprite.y += 4;
    if (sprite.y > sprite.data[3]) {
      sprite.data[2]++;
      sprite.data[0] = 22;
      PlaySE(K.SE_BALL_BOUNCE_1);
    }
  } else {
    if (sprite.data[0] === 66) PlaySE(K.SE_BALL_BOUNCE_2);
    if (sprite.data[0] === 92) PlaySE(K.SE_BALL_BOUNCE_3);
    if (sprite.data[0] === 107) PlaySE(K.SE_BALL_BOUNCE_4);
    sprite.y2 += sTradeBallVerticalVelocityTable[sprite.data[0]];
    if (++sprite.data[0] === 108) sprite.callback = SpriteCallbackDummy;
  }
}

// ------------------------------------------------------------------ GPU registers

function SetTradeBGAffine(): void {
  const a = anim();
  // DoBgAffineSet
  const affine = BgAffineSet({ texX: a.bg2texX * 0x100, texY: a.bg2texY * 0x100, scrX: a.bg2srcX, scrY: a.bg2srcY, sx: a.sXY, sy: a.sXY, alpha: a.bg2alpha });
  SetGpuReg(REG_OFFSET_BG2PA, affine.pa);
  SetGpuReg(REG_OFFSET_BG2PB, affine.pb);
  SetGpuReg(REG_OFFSET_BG2PC, affine.pc);
  SetGpuReg(REG_OFFSET_BG2PD, affine.pd);
  SetGpuReg(REG_OFFSET_BG2X_L, affine.dx & 0xffff);
  SetGpuReg(REG_OFFSET_BG2X_H, (affine.dx >> 16) & 0xffff);
  SetGpuReg(REG_OFFSET_BG2Y_L, affine.dy & 0xffff);
  SetGpuReg(REG_OFFSET_BG2Y_H, (affine.dy >> 16) & 0xffff);
}

function SetTradeGpuRegs(): void {
  const a = anim();
  SetGpuReg(REG_OFFSET_BG1VOFS, u16(a.bg1vofs));
  SetGpuReg(REG_OFFSET_BG1HOFS, u16(a.bg1hofs));
  const dispcnt = GetGpuReg(REG_OFFSET_DISPCNT);
  if ((dispcnt & 7) === DISPCNT_MODE_0) {
    SetGpuReg(REG_OFFSET_BG2VOFS, u16(a.bg2vofs));
    SetGpuReg(REG_OFFSET_BG2HOFS, u16(a.bg2hofs));
  } else {
    SetTradeBGAffine();
  }
}

function VBlankCB_TradeAnim(): void {
  if (!sTradeAnim) return; // freed at the end, before the field takes over
  SetTradeGpuRegs();
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** SetTradeSequenceBgGpuRegs: the in-game (wireless) branches; the cable maps are a link trade's. */
function SetTradeSequenceBgGpuRegs(idx: number): void {
  const a = anim();
  switch (idx) {
    case 0:
      a.bg2vofs = 0;
      a.bg2hofs = 0xb4;
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(2) | BGCNT_CHARBASE(1) | BGCNT_SCREENBASE(18) | BGCNT_TXT512x256);
      LoadPalette(gfx16('gTradeGba2_Pal'), BG_PLTT_ID(1), 3 * PLTT_SIZE_4BPP);
      copyToVram(gfx('gTradeGba_Gfx'), BG_CHAR_ADDR(1), 0x1420); // DmaCopyLarge16
      copyToVram(gfx('gTradeOrHatchMonShadowTilemap'), BG_SCREEN_ADDR(18), 0x1000);
      break;
    case 1:
      a.bg1hofs = 0;
      a.bg1vofs = 0x15c;
      SetGpuReg(REG_OFFSET_BG1VOFS, 0x15c);
      SetGpuReg(REG_OFFSET_BG1CNT, BGCNT_PRIORITY(2) | BGCNT_CHARBASE(0) | BGCNT_SCREENBASE(5) | BGCNT_TXT256x512);
      SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(2) | BGCNT_CHARBASE(1) | BGCNT_SCREENBASE(18) | BGCNT_TXT256x512);
      copyToVram(gfx('sGbaMapWireless'), BG_SCREEN_ADDR(5), 0x1000);
      copyToVram(gfx('gTradeGba_Gfx'), BG_CHAR_ADDR(0), 0x1420);
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_OBJ_ON);
      break;
    case 2:
      a.bg1vofs = 0;
      a.bg1hofs = 0;
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_1 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_OBJ_ON);
      copyToVram(gfx('sWirelessCloseup_Map'), BG_SCREEN_ADDR(5), 0x800); // LZ77UnCompVram
      BlendPalettes(0x8, 16, RGB_BLACK);
      break;
    case 3:
      LoadPalette(gfx16('sWirelessSignalAnimPals_Off'), BG_PLTT_ID(3), PLTT_SIZE_4BPP);
      copyToVram(gfx('sWirelessSignal4bpp'), BG_CHAR_ADDR(1), gfx('sWirelessSignal4bpp').length);
      copyToVram(gfx('sWirelessSignalTilemap'), BG_SCREEN_ADDR(18), gfx('sWirelessSignalTilemap').length);
      a.bg2vofs = 0x50;
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      break;
    case 4:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_1 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(3) | BGCNT_CHARBASE(1) | BGCNT_256COLOR | BGCNT_SCREENBASE(18) | BGCNT_AFF128x128);
      a.bg2texX = 0x40;
      a.bg2texY = 0x5c;
      a.sXY = 0x20;
      a.bg2Zoom = 0x400;
      a.bg2alpha = 0;
      copyToVram(gfx('sGbaAffine_Gfx'), BG_CHAR_ADDR(1), 0x2840);
      copyToVram(gfx('sGbaAffineMapWireless'), BG_SCREEN_ADDR(18), 0x100);
      break;
    case 5:
      a.bg1vofs = 0;
      a.bg1hofs = 0;
      break;
    case 6:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_1 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(3) | BGCNT_CHARBASE(1) | BGCNT_256COLOR | BGCNT_SCREENBASE(18) | BGCNT_TXT256x256);
      a.bg2texX = 0x40;
      a.bg2texY = 0x5c;
      a.sXY = 0x100;
      a.bg2Zoom = 0x80;
      a.bg2srcX = 0x78;
      a.bg2srcY = 0x50;
      a.bg2alpha = 0;
      copyToVram(gfx('sGbaAffine_Gfx'), BG_CHAR_ADDR(1), 0x2840);
      copyToVram(gfx('sGbaAffineMapWireless'), BG_SCREEN_ADDR(18), 0x100);
      break;
    case 7:
      a.bg2vofs = 0;
      a.bg2hofs = 0;
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BG2CNT, BGCNT_PRIORITY(2) | BGCNT_CHARBASE(1) | BGCNT_SCREENBASE(18) | BGCNT_TXT512x256);
      LoadPalette(gfx16('gTradeGba2_Pal'), BG_PLTT_ID(1), 3 * PLTT_SIZE_4BPP);
      copyToVram(gfx('gTradeGba_Gfx'), BG_CHAR_ADDR(1), 0x1420);
      copyToVram(gfx('gTradeOrHatchMonShadowTilemap'), BG_SCREEN_ADDR(18), 0x1000);
      break;
  }
}

// ------------------------------------------------------------------ init

/** LoadTradeMonPic */
function LoadTradeMonPic(whichParty: number, step: number): void {
  const a = anim();
  let mon: Pokemon;
  let pos: number;
  if (whichParty === TRADE_PLAYER) {
    mon = state.party[gSelectedTradeMonPositions[TRADE_PLAYER]];
    pos = K.B_POSITION_OPPONENT_LEFT;
  } else {
    mon = state.enemyParty[gSelectedTradeMonPositions[TRADE_PARTNER] % K.PARTY_SIZE];
    pos = K.B_POSITION_OPPONENT_RIGHT;
  }
  const species = speciesOrEgg(mon);
  const pal = GetMonSpritePalStructFromOtIdPersonality(species, mon.otId, mon.personality); // GetMonSpritePalStruct
  switch (step) {
    case 0:
      // Load graphics (HandleLoadSpecialPokePic(_DontHandleDeoxys))
      LoadSpecialPokePic(true, species, mon.personality, gMonSpritesGfxPtr!.sprites[whichParty === TRADE_PLAYER ? 1 : whichParty * 2 + 1]);
      LoadSpritePalette(pal); // LoadCompressedSpritePalette
      a.monSpecies[whichParty] = species;
      a.monPersonalities[whichParty] = mon.personality;
      break;
    case 1: {
      // Create sprite
      SetMultiuseSpriteTemplateToPokemon(pal.tag, pos);
      const id = CreateSprite(gMultiuseSpriteTemplate, 120, 60, 6);
      a.monSpriteIds[whichParty] = id;
      gSprites[id].invisible = true;
      gSprites[id].callback = SpriteCallbackDummy;
      break;
    }
  }
}

/** TradeAnimInit_LoadGfx */
function TradeAnimInit_LoadGfx(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates);
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  SetBgTilemapBuffer(0, new Uint16Array(BG_SCREEN_SIZE / 2));
  SetBgTilemapBuffer(1, new Uint16Array(BG_SCREEN_SIZE / 2));
  SetBgTilemapBuffer(3, new Uint16Array(BG_SCREEN_SIZE / 2));
  DeactivateAllTextPrinters();
  // Doing the graphics load... (and the C does the same load again after InitWindows)
  const textboxGfx = gfx('gBattleInterface_Textbox_Gfx');
  LoadBgTiles(0, textboxGfx, textboxGfx.length, 0); // DecompressAndLoadBgGfxUsingHeap
  CopyToBgTilemapBuffer(0, gfx16('gBattleInterface_Textbox_Tilemap'), BG_SCREEN_SIZE, 0);
  LoadPalette(gfx16('gBattleInterface_Textbox_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
  InitWindows(sTradeMessageWindowTemplates);
}

/** TradeBufferOTnameAndNicknames (in-game trade branch) */
function TradeBufferOTnameAndNicknames(): void {
  const trade = inGameTrade(state.getVar('VAR_0x8004'));
  gStringVar1.set([...pokemon.encodeName(trade.otName), EOS]);
  gStringVar3.set([...pokemon.encodeName(trade.nickname), EOS]); // StringCopy_Nickname
  gStringVar2.set(GetMonNickname(state.party[state.getVar('VAR_0x8005')]));
}

function newTradeAnim(): TradeAnim {
  return {
    timer: 0,
    cachedMapMusic: 0,
    monPersonalities: [0, 0],
    monSpriteIds: [0, 0],
    connectionSpriteId1: 0,
    connectionSpriteId2: 0,
    state: 0,
    releasePokeballSpriteId: 0,
    bouncingPokeballSpriteId: 0,
    bg2texX: 0,
    bg2texY: 0,
    bg2srcX: 0,
    bg2srcY: 0,
    bg1vofs: 0,
    bg1hofs: 0,
    bg2vofs: 0,
    bg2hofs: 0,
    sXY: 0,
    bg2Zoom: 0,
    bg2alpha: 0,
    monSpecies: [0, 0],
    textColor: [0, 0, 0],
    win0left: 0,
    win0top: 0,
    win0right: 0,
    win0bottom: 0,
  };
}

/**
 * CB2_InitInGameTrade: both mons are in place already (CreateInGameTradePokemon put the trade's mon in
 * gEnemyParty[0]; the player's is party slot VAR_0x8005). Its graphics must be preloaded (tradeSceneGfxSymbols).
 */
export function CB2_InitInGameTrade(): void {
  switch (gMain.state) {
    case 0: {
      gSelectedTradeMonPositions[TRADE_PLAYER] = state.getVar('VAR_0x8005');
      gSelectedTradeMonPositions[TRADE_PARTNER] = K.PARTY_SIZE;
      // gLinkPlayers[0/1].name: only the link path reads them
      sTradeAnim = newTradeAnim();
      AllocateMonSpritesGfx();
      ResetTasks();
      ResetSpriteData();
      FreeAllSpritePalettes();
      SetVBlankCallback(VBlankCB_TradeAnim);
      // The Poké Balls' open particles (battle_anim_special.c) play their SE (SE_BALL_OPEN) through the battle's hooks
      if (!ui) setBattleUi({ joyNew: () => false, joyHeld: () => false, anyNewKeys: () => false, playSE: (songId) => PlaySE(songId), playCry() {}, playBGM() {}, playFanfare() {}, addBagItem() {}, playerGender: () => 0 });
      TradeAnimInit_LoadGfx();
      const a = anim();
      a.state = 0;
      a.bg2texX = 64;
      a.bg2texY = 64;
      a.bg2srcX = DISPLAY_WIDTH / 2;
      a.bg2srcY = DISPLAY_HEIGHT / 2;
      a.sXY = 256;
      a.bg2alpha = 0;
      a.timer = 0;
      gMain.state = 5;
      break;
    }
    case 5:
      LoadTradeMonPic(TRADE_PLAYER, 0);
      gMain.state++;
      break;
    case 6:
      LoadTradeMonPic(TRADE_PLAYER, 1);
      gMain.state++;
      break;
    case 7:
      LoadTradeMonPic(TRADE_PARTNER, 0);
      ShowBg(0);
      gMain.state++;
      break;
    case 8:
      LoadTradeMonPic(TRADE_PARTNER, 1);
      FillWindowPixelBuffer(0, PIXEL_FILL(15));
      PutWindowTilemap(0);
      CopyWindowToVram(0, COPYWIN_FULL);
      gMain.state++;
      break;
    case 9:
      LoadTradeGbaSpriteGfx();
      LoadSpriteSheet({ data: gfx('sPokeball_Gfx'), size: gfx('sPokeball_Gfx').length, tag: GFXTAG_POKEBALL });
      LoadSpritePalette({ data: gfx16('sPokeball_Pal'), tag: PALTAG_POKEBALL });
      gMain.state++;
      break;
    case 10:
      ShowBg(0);
      gMain.state++;
      break;
    case 11:
      SetTradeSequenceBgGpuRegs(5);
      SetTradeSequenceBgGpuRegs(0);
      TradeBufferOTnameAndNicknames();
      gMain.state++;
      break;
    case 12:
      SetMainCallback2(CB2_InGameTrade);
      break;
  }
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** LoadTradeGbaSpriteGfx */
function LoadTradeGbaSpriteGfx(): void {
  LoadSpriteSheet({ data: gfx('sLinkMonGlow_Gfx'), size: gfx('sLinkMonGlow_Gfx').length, tag: GFXTAG_LINK_MON_GLOW });
  LoadSpriteSheet({ data: gfx('sLinkMonShadow_Gfx'), size: 0x300, tag: GFXTAG_LINK_MON_SHADOW });
  LoadSpriteSheet({ data: gfx('sCableEnd_Gfx'), size: 0x100, tag: GFXTAG_CABLE_END });
  LoadSpriteSheet({ data: gfx('sGbaScreen_Gfx'), size: gfx('sGbaScreen_Gfx').length, tag: GFXTAG_GBA_SCREEN });
  LoadSpritePalette({ data: gfx16('sLinkMon_Pal'), tag: PALTAG_LINK_MON });
  LoadSpritePalette({ data: gfx16('sGba_Pal'), tag: PALTAG_GBA });
}

function CB2_InGameTrade(): void {
  DoTradeAnim();
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** DoTradeAnim: sTradeAnim->isCableTrade is FALSE for an in-game trade (see the top of the file). */
function DoTradeAnim(): boolean {
  return DoTradeAnim_Wireless();
}

// ------------------------------------------------------------------ the sequence

const STATE_START = 0;
const STATE_MON_SLIDE_IN = 1;
const STATE_SEND_MSG = 10;
const STATE_BYE_BYE = 11;
const STATE_POKEBALL_DEPART = 12;
const STATE_POKEBALL_DEPART_WAIT = 13;
const STATE_FADE_OUT_TO_GBA_SEND = 14;
const STATE_WAIT_FADE_OUT_TO_GBA_SEND = 20;
const STATE_FADE_IN_TO_GBA_SEND = 21;
const STATE_WAIT_FADE_IN_TO_GBA_SEND = 22;
const STATE_GBA_ZOOM_OUT = 23;
const STATE_GBA_FLASH_SEND = 24;
const STATE_PAN_AWAY_GBA = 26;
const STATE_CREATE_LINK_MON_LEAVING = 27;
const STATE_LINK_MON_TRAVEL_OUT = 28;
const STATE_FADE_OUT_TO_CROSSING = 29;
const STATE_WAIT_FADE_OUT_TO_CROSSING = 30;
const STATE_FADE_IN_TO_CROSSING = 31;
const STATE_WAIT_FADE_IN_TO_CROSSING = 32;
const STATE_CROSSING_LINK_MONS_ENTER = 33;
const STATE_CROSSING_BLEND_WHITE_1 = 34;
const STATE_CROSSING_BLEND_WHITE_2 = 35;
const STATE_CROSSING_BLEND_WHITE_3 = 36;
const STATE_CROSSING_CREATE_MON_PICS = 37;
const STATE_CROSSING_MON_PICS_MOVE = 38;
const STATE_CROSSING_LINK_MONS_EXIT = 39;
const STATE_CREATE_LINK_MON_ARRIVING = 40;
const STATE_FADE_OUT_TO_GBA_RECV = 41;
const STATE_WAIT_FADE_OUT_TO_GBA_RECV = 42;
const STATE_LINK_MON_TRAVEL_IN = 43;
const STATE_PAN_TO_GBA = 44;
const STATE_LINK_MON_ARRIVED_DELAY = 46;
const STATE_MOVE_GBA_TO_CENTER = 47;
const STATE_GBA_FLASH_RECV = 48;
const STATE_GBA_STOP_FLASH_RECV = 50;
const STATE_GBA_ZOOM_IN = 51;
const STATE_FADE_OUT_TO_NEW_MON = 52;
const STATE_WAIT_FADE_OUT_TO_NEW_MON = 60;
const STATE_FADE_IN_TO_NEW_MON = 61;
const STATE_WAIT_FADE_IN_TO_NEW_MON = 62;
const STATE_POKEBALL_ARRIVE = 63;
const STATE_FADE_POKEBALL_TO_NORMAL = 64;
const STATE_POKEBALL_ARRIVE_WAIT = 65;
const STATE_SHOW_NEW_MON = 66;
const STATE_NEW_MON_MSG = 67;
const STATE_TAKE_CARE_OF_MON = 68;
const STATE_AFTER_NEW_MON_DELAY = 69;
const STATE_CHECK_RIBBONS = 70;
const STATE_END_LINK_TRADE = 71;
const STATE_TRY_EVOLUTION = 72;
const STATE_FADE_OUT_END = 73;
const STATE_WAIT_FADE_OUT_END = 74;
const STATE_WIRELESS = 100;
const STATE_GBA_FLASH_SEND_WIRELESS = STATE_GBA_FLASH_SEND + STATE_WIRELESS;
const STATE_GBA_STOP_FLASH_SEND_WIRELESS = STATE_GBA_FLASH_SEND_WIRELESS + 1;
const STATE_WAIT_WIRELESS_SIGNAL_SEND = STATE_GBA_FLASH_SEND_WIRELESS + 2;
const STATE_PAN_TO_GBA_WIRELESS = STATE_PAN_TO_GBA + STATE_WIRELESS;
const STATE_DESTROY_LINK_MON_WIRELESS = STATE_PAN_TO_GBA_WIRELESS + 1;
const STATE_WAIT_WIRELESS_SIGNAL_RECV = STATE_PAN_TO_GBA_WIRELESS + 2;
const STATE_DELAY_FOR_MON_ANIM = 167;
const STATE_LINK_MON_TRAVEL_OFFSCREEN = 200;
const STATE_WAIT_FOR_MON_CRY = 267;

/** The front pic's y offset (gMonFrontPicCoords[species].y_offset). */
const frontPicYOffset = (species: number): number => bdata.tables.coords.monFront[species]?.[1] ?? 0;
/** IsMonSpriteNotFlipped */
const IsMonSpriteNotFlipped = (species: number): boolean => !!pokemon.species[species]?.noFlip;

/** DrawTextOnTradeWindow */
function DrawTextOnTradeWindow(windowId: number, str: number[], speed: number): void {
  const a = anim();
  FillWindowPixelBuffer(windowId, PIXEL_FILL(15));
  a.textColor = [15, 1, 6];
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL, 0, 2, 0, 2, a.textColor, speed, str);
  CopyWindowToVram(windowId, COPYWIN_FULL);
}

/** DoTradeAnim_Wireless: returns TRUE if it finished a link trade (never here). */
function DoTradeAnim_Wireless(): boolean {
  const a = anim();
  const playerMon = () => gSprites[a.monSpriteIds[TRADE_PLAYER]];
  const partnerMon = () => gSprites[a.monSpriteIds[TRADE_PARTNER]];
  const conn1 = () => gSprites[a.connectionSpriteId1];
  const conn2 = () => gSprites[a.connectionSpriteId2];

  switch (a.state) {
    case STATE_START:
      playerMon().invisible = false;
      playerMon().x2 = -180;
      playerMon().y2 = frontPicYOffset(a.monSpecies[TRADE_PLAYER]);
      a.state++;
      a.cachedMapMusic = GetCurrentMapMusic();
      PlayNewMapMusic(K.MUS_EVOLUTION);
      break;
    case STATE_MON_SLIDE_IN:
      if (a.bg2hofs > 0) {
        playerMon().x2 += 3;
        a.bg2hofs = s16(a.bg2hofs - 3);
      } else {
        playerMon().x2 = 0;
        a.bg2hofs = 0;
        a.state = STATE_SEND_MSG;
      }
      break;
    case STATE_SEND_MSG:
      DrawTextOnTradeWindow(0, ExpandToStringVar4(text('gText_XWillBeSentToY')), 0);
      if (a.monSpecies[TRADE_PLAYER] !== K.SPECIES_EGG) PlayCry_Normal(a.monSpecies[TRADE_PLAYER], 0);
      a.state = STATE_BYE_BYE;
      a.timer = 0;
      break;
    case STATE_BYE_BYE:
      if (++a.timer === 80) {
        a.releasePokeballSpriteId = CreateTradePokeballSprite(a.monSpriteIds[TRADE_PLAYER], playerMon().oam.paletteNum, 120, 32, 2, 1, 0x14, 0xfffff);
        a.state++;
        DrawTextOnTradeWindow(0, ExpandToStringVar4(text('gText_ByeByeVar1')), 0);
      }
      break;
    case STATE_POKEBALL_DEPART:
      if (gSprites[a.releasePokeballSpriteId].callback === SpriteCallbackDummy) {
        a.bouncingPokeballSpriteId = CreateSprite(sSpriteTemplate_Pokeball, 120, 32, 0);
        gSprites[a.bouncingPokeballSpriteId].callback = SpriteCB_BouncingPokeballDepart;
        DestroySprite(gSprites[a.releasePokeballSpriteId]);
        a.state++;
      }
      break;
    case STATE_POKEBALL_DEPART_WAIT:
      // The game waits here for the sprite to finish its animation sequence.
      break;
    case STATE_FADE_OUT_TO_GBA_SEND:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      a.state = STATE_WAIT_FADE_OUT_TO_GBA_SEND;
      break;
    case STATE_WAIT_FADE_OUT_TO_GBA_SEND:
      if (!gPaletteFade.active) {
        SetTradeSequenceBgGpuRegs(4);
        FillWindowPixelBuffer(0, PIXEL_FILL(15));
        CopyWindowToVram(0, COPYWIN_FULL);
        a.state++;
      }
      break;
    case STATE_FADE_IN_TO_GBA_SEND:
      BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
      a.state++;
      break;
    case STATE_WAIT_FADE_IN_TO_GBA_SEND:
      if (!gPaletteFade.active) a.state = STATE_GBA_ZOOM_OUT;
      break;
    case STATE_GBA_ZOOM_OUT:
      if (a.bg2Zoom > 0x100) {
        a.bg2Zoom = u16(a.bg2Zoom - 0x34);
      } else {
        SetTradeSequenceBgGpuRegs(1);
        a.bg2Zoom = 0x80;
        a.state = STATE_GBA_FLASH_SEND_WIRELESS;
        a.timer = 0;
      }
      a.sXY = u16(Math.trunc(0x8000 / a.bg2Zoom));
      break;
    case STATE_GBA_FLASH_SEND_WIRELESS:
      if (++a.timer > 20) {
        SetTradeSequenceBgGpuRegs(3);
        a.connectionSpriteId2 = CreateSprite(sSpriteTemplate_GbaScreenFlash_Short, 120, 80, 0);
        a.state++;
      }
      break;
    case STATE_GBA_STOP_FLASH_SEND_WIRELESS:
      if (conn2().animEnded) {
        DestroySprite(conn2());
        SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_TGT1_OBJ | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG2);
        SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 4));
        // Start wireless signal effect
        CreateTask(Task_AnimateWirelessSignal, 5);
        a.state++;
      }
      break;
    case STATE_WAIT_WIRELESS_SIGNAL_SEND:
      if (!FuncIsActiveTask(Task_AnimateWirelessSignal)) a.state = STATE_PAN_AWAY_GBA;
      break;
    case STATE_PAN_AWAY_GBA:
      if ((a.bg1vofs = s16(a.bg1vofs - 1)) === 316) a.state++;
      break;
    case STATE_CREATE_LINK_MON_LEAVING:
      a.connectionSpriteId1 = CreateSprite(sSpriteTemplate_LinkMonGlow, 120, 80, 3);
      conn1().callback = SpriteCB_LinkMonGlowWireless;
      a.connectionSpriteId2 = CreateSprite(sSpriteTemplate_LinkMonShadow, 120, 80, 0);
      StartSpriteAnim(conn2(), ANIM_LINKMON_SMALL);
      a.state++;
      break;
    case STATE_LINK_MON_TRAVEL_OUT:
      if ((a.bg1vofs = s16(a.bg1vofs - 3)) === 166) a.state = STATE_LINK_MON_TRAVEL_OFFSCREEN;
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_1 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_OBJ_ON);
      break;
    case STATE_LINK_MON_TRAVEL_OFFSCREEN:
      conn1().y -= 2;
      conn2().y -= 2;
      if (conn1().y < -8) a.state = STATE_FADE_OUT_TO_CROSSING;
      break;
    case STATE_FADE_OUT_TO_CROSSING:
      BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
      a.state = STATE_WAIT_FADE_OUT_TO_CROSSING;
      break;
    case STATE_WAIT_FADE_OUT_TO_CROSSING:
      if (!gPaletteFade.active) {
        DestroySprite(conn1());
        DestroySprite(conn2());
        SetTradeSequenceBgGpuRegs(2);
        a.state++;
      }
      break;
    case STATE_FADE_IN_TO_CROSSING:
      BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
      a.connectionSpriteId1 = CreateSprite(sSpriteTemplate_LinkMonShadow, 111, 170, 0);
      a.connectionSpriteId2 = CreateSprite(sSpriteTemplate_LinkMonShadow, 129, -10, 0);
      a.state++;
      break;
    case STATE_WAIT_FADE_IN_TO_CROSSING:
      if (!gPaletteFade.active) {
        PlaySE(K.SE_WARP_OUT);
        a.state++;
      }
      conn1().y2 -= 3;
      conn2().y2 += 3;
      break;
    case STATE_CROSSING_LINK_MONS_ENTER:
      conn1().y2 -= 3;
      conn2().y2 += 3;
      if (conn1().y2 <= -90) {
        conn1().data[1] = 1;
        conn2().data[1] = 1;
        a.state++;
        CreateTask(Task_OpenCenterWhiteColumn, 5);
      }
      break;
    case STATE_CROSSING_BLEND_WHITE_1:
    case STATE_CROSSING_BLEND_WHITE_2:
    case STATE_CROSSING_BLEND_WHITE_3:
      BlendPalettes(0x8, 16, RGB_WHITEALPHA);
      a.state++;
      break;
    case STATE_CROSSING_CREATE_MON_PICS:
      if (!IsMonSpriteNotFlipped(a.monSpecies[TRADE_PLAYER])) {
        const s = playerMon();
        s.affineAnims = sAffineAnims_CrossingMonPics;
        s.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
        CalcCenterToCornerVec(s, SPRITE_SHAPE['64x64'][0], SPRITE_SHAPE['64x64'][1], ST_OAM_AFFINE_DOUBLE);
        StartSpriteAffineAnim(s, 0);
      } else {
        StartSpriteAffineAnim(playerMon(), 0);
      }
      StartSpriteAffineAnim(partnerMon(), 0);
      playerMon().x = 40;
      partnerMon().x = 200;
      playerMon().y = 192;
      partnerMon().y = -32;
      playerMon().invisible = false;
      partnerMon().invisible = false;
      a.state++;
      break;
    case STATE_CROSSING_MON_PICS_MOVE:
      playerMon().y2 -= 3;
      partnerMon().y2 += 3;
      if (playerMon().y2 < -DISPLAY_HEIGHT && playerMon().y2 >= -DISPLAY_HEIGHT - 3) PlaySE(K.SE_WARP_IN);
      if (playerMon().y2 < -222) {
        conn1().data[1] = 0;
        conn2().data[1] = 0;
        a.state++;
        playerMon().invisible = true;
        partnerMon().invisible = true;
        CreateTask(Task_CloseCenterWhiteColumn, 5);
      }
      break;
    case STATE_CROSSING_LINK_MONS_EXIT:
      conn1().y2 -= 3;
      conn2().y2 += 3;
      if (conn1().y2 <= -222) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
        a.state++;
        DestroySprite(conn1());
        DestroySprite(conn2());
      }
      break;
    case STATE_CREATE_LINK_MON_ARRIVING:
      if (!gPaletteFade.active) {
        a.state++;
        SetTradeSequenceBgGpuRegs(1);
        a.bg1vofs = 166;
        SetTradeSequenceBgGpuRegs(3);
        a.bg2vofs = 412;
        a.connectionSpriteId1 = CreateSprite(sSpriteTemplate_LinkMonGlow, 120, -20, 3);
        conn1().callback = SpriteCB_LinkMonGlowWireless;
        a.connectionSpriteId2 = CreateSprite(sSpriteTemplate_LinkMonShadow, 120, -20, 0);
        StartSpriteAnim(conn2(), ANIM_LINKMON_SMALL);
      }
      break;
    case STATE_FADE_OUT_TO_GBA_RECV:
      BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
      a.state++;
      break;
    case STATE_WAIT_FADE_OUT_TO_GBA_RECV:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_OBJ_ON);
      if (!gPaletteFade.active) a.state++;
      break;
    case STATE_LINK_MON_TRAVEL_IN:
      conn1().y2 += 4;
      conn2().y2 += 4;
      if (conn1().y2 + conn1().y === 64) {
        a.state = STATE_PAN_TO_GBA_WIRELESS;
        a.timer = 0;
      }
      break;
    case STATE_PAN_TO_GBA_WIRELESS:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG1_ON | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      a.bg1vofs = s16(a.bg1vofs + 3);
      a.bg2vofs = s16(a.bg2vofs + 3);
      if (++a.timer === 10) {
        const taskId = CreateTask(Task_AnimateWirelessSignal, 5);
        gTasks[taskId].data[tSignalComingBack] = 1;
      }
      if (a.bg1vofs > 316) {
        a.bg1vofs = 316;
        a.state++;
      }
      break;
    case STATE_DESTROY_LINK_MON_WIRELESS:
      DestroySprite(conn1());
      DestroySprite(conn2());
      a.state++;
      a.timer = 0;
      break;
    case STATE_WAIT_WIRELESS_SIGNAL_RECV:
      if (!FuncIsActiveTask(Task_AnimateWirelessSignal)) {
        a.state = STATE_LINK_MON_ARRIVED_DELAY;
        a.timer = 0;
      }
      break;
    case STATE_LINK_MON_ARRIVED_DELAY:
      if (++a.timer === 10) a.state++;
      break;
    case STATE_MOVE_GBA_TO_CENTER:
      if ((a.bg1vofs = s16(a.bg1vofs + 1)) > 348) {
        a.bg1vofs = 348;
        a.state++;
      }
      break;
    case STATE_GBA_FLASH_RECV:
      a.connectionSpriteId2 = CreateSprite(sSpriteTemplate_GbaScreenFlash_Long, 120, 80, 0);
      a.state = STATE_GBA_STOP_FLASH_RECV;
      break;
    case STATE_GBA_STOP_FLASH_RECV:
      if (conn2().animEnded) {
        DestroySprite(conn2());
        SetTradeSequenceBgGpuRegs(6);
        a.state++;
        PlaySE(K.SE_M_SAND_ATTACK);
      }
      break;
    case STATE_GBA_ZOOM_IN:
      if (a.bg2Zoom < 0x400) {
        a.bg2Zoom = u16(a.bg2Zoom + 0x34);
      } else {
        a.bg2Zoom = 0x400;
        a.state++;
      }
      a.sXY = u16(Math.trunc(0x8000 / a.bg2Zoom));
      break;
    case STATE_FADE_OUT_TO_NEW_MON:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      a.state = STATE_WAIT_FADE_OUT_TO_NEW_MON;
      break;
    case STATE_WAIT_FADE_OUT_TO_NEW_MON:
      if (!gPaletteFade.active) {
        SetTradeSequenceBgGpuRegs(5);
        SetTradeSequenceBgGpuRegs(7);
        gPaletteFade.bufferTransferDisabled = true;
        a.state++;
      }
      break;
    case STATE_FADE_IN_TO_NEW_MON:
      gPaletteFade.bufferTransferDisabled = false;
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      a.state++;
      break;
    case STATE_WAIT_FADE_IN_TO_NEW_MON:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      if (!gPaletteFade.active) a.state++;
      break;
    case STATE_POKEBALL_ARRIVE: {
      a.bouncingPokeballSpriteId = CreateSprite(sSpriteTemplate_Pokeball, 120, -8, 0);
      const ball = gSprites[a.bouncingPokeballSpriteId];
      ball.data[3] = 74;
      ball.callback = SpriteCB_BouncingPokeballArrive;
      StartSpriteAnim(ball, 1);
      StartSpriteAffineAnim(ball, 2);
      BlendPalettes((1 << (16 + ball.oam.paletteNum)) >>> 0, 16, RGB_WHITEALPHA);
      a.state++;
      a.timer = 0;
      break;
    }
    case STATE_FADE_POKEBALL_TO_NORMAL:
      BeginNormalPaletteFade((1 << (16 + gSprites[a.bouncingPokeballSpriteId].oam.paletteNum)) >>> 0, 1, 16, 0, RGB_WHITEALPHA);
      a.state++;
      break;
    case STATE_POKEBALL_ARRIVE_WAIT:
      if (gSprites[a.bouncingPokeballSpriteId].callback === SpriteCallbackDummy) {
        LoadSpecialPokePic(true, a.monSpecies[TRADE_PARTNER], a.monPersonalities[TRADE_PARTNER], gMonSpritesGfxPtr!.sprites[K.B_POSITION_OPPONENT_RIGHT]);
        a.state++;
      }
      break;
    case STATE_SHOW_NEW_MON: {
      const s = partnerMon();
      s.x = 120;
      s.y = frontPicYOffset(a.monSpecies[TRADE_PARTNER]) + 60;
      s.x2 = 0;
      s.y2 = 0;
      StartSpriteAnim(s, 0);
      CreatePokeballSpriteToReleaseMon(a.monSpriteIds[TRADE_PARTNER], s.oam.paletteNum, 120, 84, 2, 1, 20, 0xfffff);
      FreeSpriteOamMatrix(gSprites[a.bouncingPokeballSpriteId]);
      DestroySprite(gSprites[a.bouncingPokeballSpriteId]);
      a.state++;
      break;
    }
    case STATE_NEW_MON_MSG:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_BG2_ON | DISPCNT_OBJ_ON);
      DrawTextOnTradeWindow(0, ExpandToStringVar4(text('gText_XSentOverY')), 0);
      a.state = STATE_DELAY_FOR_MON_ANIM;
      a.timer = 0;
      break;
    case STATE_DELAY_FOR_MON_ANIM:
      if (++a.timer > 60) {
        if (a.monSpecies[TRADE_PARTNER] !== K.SPECIES_EGG) PlayCry_Normal(a.monSpecies[TRADE_PARTNER], 0);
        a.state = STATE_WAIT_FOR_MON_CRY;
        a.timer = 0;
      }
      break;
    case STATE_WAIT_FOR_MON_CRY:
      if (IsCryFinished()) a.state = STATE_TAKE_CARE_OF_MON;
      break;
    case STATE_TAKE_CARE_OF_MON:
      if (++a.timer === 10) PlayFanfare(K.MUS_EVOLVED);
      if (a.timer === 250) {
        a.state++;
        DrawTextOnTradeWindow(0, ExpandToStringVar4(text('gText_TakeGoodCareOfX')), 0);
        a.timer = 0;
      }
      break;
    case STATE_AFTER_NEW_MON_DELAY:
      if (++a.timer === 60) a.state++;
      break;
    case STATE_CHECK_RIBBONS:
      // CheckPartnersMonForRibbons: ribbons aren't modelled (no in-game trade mon has any)
      a.state++;
      break;
    case STATE_END_LINK_TRADE:
      // (sTradeAnim->isLinkTrade is FALSE)
      if (JOY_NEW(A_BUTTON)) a.state++;
      break;
    case STATE_TRY_EVOLUTION:
      // Only if in-game trade, link trades use CB2_TryLinkTradeEvolution
      TradeMons(state, state.getVar('VAR_0x8005'), 0);
      // gCB2_AfterEvolution = CB2_InGameTrade; GetEvolutionTargetSpecies(EVO_MODE_TRADE) + TradeEvolutionScene:
      // no FRLG in-game trade mon evolves by trading, so TradeEvolutionScene never runs (and isn't ported).
      a.state++;
      break;
    case STATE_FADE_OUT_END:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      a.state++;
      break;
    case STATE_WAIT_FADE_OUT_END:
      if (!gPaletteFade.active) {
        PlayNewMapMusic(a.cachedMapMusic);
        FreeAllWindowBuffers();
        FreeMonSpritesGfx();
        sTradeAnim = null;
        SetMainCallback2(CB2_ReturnToField);
        BufferInGameTradeMonName(state);
      }
      break;
  }
  return false;
}

// ------------------------------------------------------------------ tasks

const tIdx = 0;
const tCounter = 1;
const tSignalComingBack = 2;

function Task_AnimateWirelessSignal(taskId: number): void {
  const data = gTasks[taskId].data;
  const paletteIdx = 16 * sWirelessSignalAnimParams[data[tIdx]][0];
  if (paletteIdx === 0x100) {
    LoadPalette(gfx16('sWirelessSignalAnimPals_Off'), BG_PLTT_ID(3), PLTT_SIZE_4BPP);
  } else {
    const pals = gfx16(data[tSignalComingBack] ? 'sWirelessSignalAnimPals_Inbound' : 'sWirelessSignalAnimPals_Outbound');
    LoadPalette(pals.subarray(paletteIdx, paletteIdx + 16), BG_PLTT_ID(3), PLTT_SIZE_4BPP);
  }
  if (sWirelessSignalAnimParams[data[tIdx]][0] === 0 && data[tCounter] === 0) PlaySE(K.SE_M_HEAL_BELL);
  if (data[tCounter] === sWirelessSignalAnimParams[data[tIdx]][1]) {
    data[tIdx]++;
    data[tCounter] = 0;
    if (sWirelessSignalAnimParams[data[tIdx]][1] === 0xff) DestroyTask(taskId);
  } else {
    data[tCounter]++;
  }
}

function Task_OpenCenterWhiteColumn(taskId: number): void {
  const data = gTasks[taskId].data;
  const a = anim();
  if (data[0] === 0) {
    a.win0left = a.win0right = DISPLAY_WIDTH / 2;
    a.win0top = 0;
    a.win0bottom = DISPLAY_HEIGHT;
    SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_OBJ);
    SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG0 | WININ_WIN0_BG1 | WININ_WIN0_OBJ);
  }
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(a.win0left, a.win0right));
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(a.win0top, a.win0bottom));
  data[0]++;
  a.win0left = u8(a.win0left - 5);
  a.win0right = u8(a.win0right + 5);
  if (a.win0left < 80) DestroyTask(taskId);
}

function Task_CloseCenterWhiteColumn(taskId: number): void {
  const data = gTasks[taskId].data;
  const a = anim();
  if (data[0] === 0) {
    a.win0left = 80;
    a.win0right = DISPLAY_WIDTH - 80;
    SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_OBJ);
    SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG0 | WININ_WIN0_BG1 | WININ_WIN0_OBJ);
  }
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(a.win0left, a.win0right));
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(a.win0top, a.win0bottom));
  if (a.win0left !== DISPLAY_WIDTH / 2) {
    data[0]++;
    a.win0left = u8(a.win0left + 5);
    a.win0right = u8(a.win0right - 5);
    if (a.win0left > DISPLAY_WIDTH / 2 - 5) BlendPalettes(0x8, 0, RGB_WHITEALPHA);
  } else {
    ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
    DestroyTask(taskId);
  }
}
