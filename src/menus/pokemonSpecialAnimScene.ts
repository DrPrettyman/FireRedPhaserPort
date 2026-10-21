// pokemon_special_anim_scene.c: the item-use animation's screen (pokemon_special_anim.c runs it). BG3 is the
// patterned background (sBg_Pal, or sBg_TmHm_Pal for a TM / HM), BG0 the message window; the mon pic is an affine
// 64x64 sprite that zooms in steps of "closeness" (friendship: 1x to 2x), the item icon an affine sprite on it, with
// the sparkles (the outward spiral dots), the forget-move stars and the TM's wobble / zoom out.
//
// CreateLevelUpVerticalSpritesTask / Task_LevelUpVerticalSprites (the battle level-up's rising stripes) are here too:
// no item use starts them (PSA_CreateLevelUpVerticalSpritesTask is unused in the C), battle_controller_player.c's
// Task_CreateLevelUpVerticalStripes does (battle/controllerCommon.ts). DrawLevelUpWindowPg1 / Pg2 are
// battle/bsCommands3.ts's.

import { K } from '../battle/constants';
import { GET_UNOWN_LETTER, GetMonSpritePalFromSpeciesAndPersonality, LoadSpecialPokePic } from '../battle/gfx';
import { gSineTable } from '../battle/trig';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect_Palette0,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16, hasGfx } from '../gba/gfx';
import { BLDALPHA_BLEND, BLDCNT_EFFECT_NONE, BLDCNT_TGT2_ALL, DISPCNT_MODE_0, DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB, RGB_BLACK, RGB_WHITE, SetGpuReg, SetGpuRegBits, vram } from '../gba/hw';
import { ClearStdWindowAndFrameToTransparent, DecompressAndCopyTileDataToVram, DrawTextBorderOuter, FreeTempTileDataBuffersIfPossible, GetTextSpeedSetting, LoadUserWindowGfx, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, ResetPaletteFadeControl } from '../gba/palette';
import { PlaySE } from '../gba/sound';
import {
  AFFINEANIMCMD_END,
  AFFINEANIMCMD_FRAME,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  InitSpriteAffineAnim,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_OBJ_BLEND,
  type AffineAnimCmd,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, FuncIsActiveTask, GetWordTaskArg, gTasks, SetWordTaskArg, TASK_NONE, type TaskFunc } from '../gba/task';
import {
  ClearWindowTilemap,
  COPYWIN_FULL,
  COPYWIN_GFX,
  COPYWIN_MAP,
  CopyWindowToVram,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetFontAttribute,
  FONTATTR_COLOR_BACKGROUND,
  FONTATTR_COLOR_FOREGROUND,
  FONTATTR_COLOR_SHADOW,
  AddTextPrinter,
  GetStringWidth,
  InitWindows,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  type WindowTemplate,
} from '../gba/window';
import { FONT_NORMAL } from '../text/Font';
import { concat, ConvertIntToDecimalStringN, GetMonNickname, ItemId_GetName, STR_CONV_MODE_LEFT_ALIGN, text } from './common';
import { menusData } from './data';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from './dynamicPlaceholderText';
import { AddItemIconObject } from './itemMenuIcons';
import {
  PSA_GetAnimType,
  PSA_GetItemId,
  PSA_GetMonNickname,
  PSA_GetMonPersonality,
  PSA_GetMonSpecies,
  PSA_GetNameOfMoveForgotten,
  PSA_GetNameOfMoveToTeach,
  PSA_GetPokemon,
  PSA_GetSceneWork,
  PSA_ITEM_ANIM_TYPE_TMHM,
} from './pokemonSpecialAnim';

// constants/pokemon_special_anim.h's PSA_TEXT_*
export const PSA_TEXT_ITEM_USED = 0;
export const PSA_TEXT_LEVEL_ELEVATED = 1;
export const PSA_TEXT_FORGET_1 = 2;
export const PSA_TEXT_FORGET_2_AND = 3;
export const PSA_TEXT_FORGET_POOF = 4;
export const PSA_TEXT_FORGET_FORGOT = 5;
export const PSA_TEXT_FORGET_AND = 6;
export const PSA_TEXT_MACHINE_SET = 7;
export const PSA_TEXT_HUH = 8;
export const PSA_TEXT_LEARNED_MOVE = 9;

// constants/menu.h's PSA_MON_ATTR_* (Menu2_GetMonPosAttribute)
const PSA_MON_ATTR_TMHM_X_POS = 0;
const PSA_MON_ATTR_TMHM_Y_POS = 1;
const PSA_MON_ATTR_Y_OFFSET = 2;
const PSA_MON_ATTR_ITEM_X_POS = 3;
const PSA_MON_ATTR_ITEM_Y_POS = 4;
const PSA_MON_ATTR_COUNT = 5;

/** struct PokemonSpecialAnimScene (the text buffer and the BG tilemap buffers it holds; field_1114 / field_2114 unused). */
export interface PokemonSpecialAnimScene {
  state: number;
  /** field_0002: the stars still flying (CreateStarSprites) */
  field_0002: number;
  /** field_0004: PSA_UseTM_RunZoomOutAnim's timer */
  field_0004: number;
  monSpriteY1: number;
  monSpriteY2: number;
  lastCloseness: number;
  monSprite: Sprite | null;
  itemIconSprite: Sprite | null;
  textBuf: number[];
  /** field_0914: BG0's tilemap buffer */
  bg0Tilemap: Uint16Array;
  /** field_1914: BG3's tilemap buffer */
  bg3Tilemap: Uint16Array;
}

export function newPokemonSpecialAnimScene(): PokemonSpecialAnimScene {
  return {
    state: 0,
    field_0002: 0,
    field_0004: 0,
    monSpriteY1: 0,
    monSpriteY2: 0,
    lastCloseness: 0,
    monSprite: null,
    itemIconSprite: null,
    textBuf: [],
    bg0Tilemap: new Uint16Array(0x400),
    bg3Tilemap: new Uint16Array(0x400),
  };
}

// The scene's graphics. Their static names clash with other files' (main_menu.c's sBg_Pal, ...), so extract_gfx.py also
// writes them as `pokemon_special_anim_scene.<symbol>`; the plain name is this file's when nothing else has it.
const GFX_FILE = 'pokemon_special_anim_scene';
const SCENE_SYMBOLS = ['sBg_Pal', 'sBg_TmHm_Pal', 'sBg_Gfx', 'sBg_Tilemap', 'sStar_Pal', 'sStar_Gfx', 'sOutwardSpiralDots_Pal', 'sOutwardSpiralDots_Gfx'];
const sym = (name: string): string => (hasGfx(`${GFX_FILE}.${name}`) ? `${GFX_FILE}.${name}` : name);

/** The graphics symbols the scene loads (besides the mon pic and the item icon), for preloading. */
export function pokemonSpecialAnimGfxSymbols(): string[] {
  return SCENE_SYMBOLS.map(sym);
}

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x001 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

const sWindowTemplates: WindowTemplate[] = [{ bg: 0, tilemapLeft: 1, tilemapTop: 15, width: 28, height: 4, paletteNum: 15, baseBlock: 0x00a }, DUMMY_WIN_TEMPLATE];

const s1_2_and_Poof_textPtrs = ['gText_Counting_1', 'gText_Counting_2And', 'gText_Poof'];

const sAffineScales = [0x100, 0x155, 0x1aa, 0x200];

const sStarCoordOffsets: [number, number][] = [
  [-8, -8],
  [6, -13],
  [8, -8],
];

const sOamData_MonSprite = oam({ affineMode: ST_OAM_AFFINE_DOUBLE, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 });

const zoom = (scale: number): AffineAnimCmd[] => [AFFINEANIMCMD_FRAME(scale, scale, 0, 0), AFFINEANIMCMD_END];
const sAffineAnimTable_Zoom: AffineAnimCmd[][] = sAffineScales.map(zoom);

const sSpriteTemplate_MonSprite: SpriteTemplate = {
  tileTag: 0,
  paletteTag: 0,
  oam: sOamData_MonSprite,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: sAffineAnimTable_Zoom,
  callback: SpriteCallbackDummy,
};

const itemZoom = (scale: number, delta: number): AffineAnimCmd[] => [AFFINEANIMCMD_FRAME(scale, scale, 0, 0), AFFINEANIMCMD_FRAME(delta, delta, 0, 8), AFFINEANIMCMD_END];
const sAffineAnimTable_ItemZoom: AffineAnimCmd[][] = [itemZoom(0x100, -28), itemZoom(0x155, -37), itemZoom(0x1aa, -47), itemZoom(0x200, -56)];

const sOamData_Star = oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1 });

const sOamData_UseItem_OutwardSpiralDots = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], priority: 0 });

const sAnimTable_UseItem_OutwardSpiralDots: AnimCmd[][] = [
  [ANIMCMD_FRAME(0, 16), ANIMCMD_FRAME(1, 8), ANIMCMD_FRAME(2, 4), ANIMCMD_END],
  [ANIMCMD_FRAME(1, 4), ANIMCMD_FRAME(0, 4), ANIMCMD_END],
];

const s16 = (v: number): number => (v << 16) >> 16;
/** ISO_RANDOMIZE1 */
const ISO_RANDOMIZE1 = (v: number): number => (Math.imul(1103515245, v) + 24691) >>> 0;

/** InitPokemonSpecialAnimScene */
export function InitPokemonSpecialAnimScene(buffer: PokemonSpecialAnimScene, animType: number): void {
  FreeAllWindowBuffers();
  ResetTempTileDataBuffers();
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  InitWindows(sWindowTemplates);
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  ChangeBgX(3, 0, 0);
  ChangeBgY(3, 0, 0);
  SetBgTilemapBuffer(0, buffer.bg0Tilemap);
  SetBgTilemapBuffer(3, buffer.bg3Tilemap);
  vram.fill(0, 0, 0x20); // RequestDma3Fill(0, BG_VRAM, 0x20, DMA3_32BIT)
  FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 0, 32, 32);
  LoadBgGfxByAnimType(animType);
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  LoadUserWindowGfx(0, 0x000, BG_PLTT_ID(14));
  CopyWindowToVram(0, COPYWIN_FULL);
  ShowBg(0);
  ShowBg(3);
  HideBg(1);
  HideBg(2);
  CopyBgTilemapBufferToVram(0);
  CopyBgTilemapBufferToVram(3);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
}

/** PokemonSpecialAnimSceneInitIsNotFinished */
export function PokemonSpecialAnimSceneInitIsNotFinished(): boolean {
  if (!FreeTempTileDataBuffersIfPossible()) return IsDma3ManagerBusyWithBgCopy();
  return true;
}

/** PSA_FreeWindowBuffers */
export function PSA_FreeWindowBuffers(): void {
  FreeAllWindowBuffers();
}

/** PSA_ShowMessageWindow */
export function PSA_ShowMessageWindow(): void {
  PutWindowTilemap(0);
  FillWindowPixelBuffer(0, PIXEL_FILL(1));
  DrawTextBorderOuter(0, 0x001, 14);
  CopyWindowToVram(0, COPYWIN_FULL);
}

/** PSA_HideMessageWindow */
export function PSA_HideMessageWindow(): void {
  ClearWindowTilemap(0);
  ClearStdWindowAndFrameToTransparent(0, false);
  CopyWindowToVram(0, COPYWIN_MAP);
}

/** AddTextPrinterParameterized5 (menu2.c) without the callback (NULL here): the font's colours, the given spacing. */
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
    speed & 0xff,
  );
}

/** PSA_PrintMessage */
export function PSA_PrintMessage(messageId: number): void {
  const scene = PSA_GetSceneWork();
  const itemId = PSA_GetItemId();
  let strWidth = 0;
  let textSpeed = GetTextSpeedSetting();
  const pokemon = PSA_GetPokemon();

  switch (messageId) {
    case PSA_TEXT_ITEM_USED: // Item was used on Mon
      scene.textBuf = concat(ItemId_GetName(itemId), text('gText_WasUsedOn'), GetMonNickname(pokemon), text('gText_Period'));
      break;
    case PSA_TEXT_LEVEL_ELEVATED: {
      // Mon's level was elevated to level (no item use prints it)
      let level = pokemon.level;
      if (level < K.MAX_LEVEL) level++;
      scene.textBuf = concat(GetMonNickname(pokemon), text('gText_LevelRoseTo'), ConvertIntToDecimalStringN(level, STR_CONV_MODE_LEFT_ALIGN, level < K.MAX_LEVEL ? 2 : 3), text('gText_Period2'));
      break;
    }
    case PSA_TEXT_LEARNED_MOVE: // Mon learned move
      DynamicPlaceholderTextUtil_Reset();
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, PSA_GetMonNickname());
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, PSA_GetNameOfMoveToTeach());
      scene.textBuf = DynamicPlaceholderTextUtil_ExpandPlaceholders(text('gText_MonLearnedTMHM'));
      break;
    case PSA_TEXT_FORGET_POOF:
      strWidth += GetStringWidth(FONT_NORMAL, text('gText_Counting_2And'), -1);
    // fallthrough
    case PSA_TEXT_FORGET_2_AND:
      strWidth += GetStringWidth(FONT_NORMAL, text('gText_Counting_1'), -1);
    // fallthrough
    case PSA_TEXT_FORGET_1: // 1
      scene.textBuf = text(s1_2_and_Poof_textPtrs[messageId - PSA_TEXT_FORGET_1]);
      textSpeed = 1;
      break;
    case PSA_TEXT_FORGET_FORGOT:
      DynamicPlaceholderTextUtil_Reset();
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, PSA_GetMonNickname());
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, PSA_GetNameOfMoveForgotten());
      scene.textBuf = DynamicPlaceholderTextUtil_ExpandPlaceholders(text('gText_MonForgotMove'));
      break;
    case PSA_TEXT_FORGET_AND:
      scene.textBuf = text('gText_And');
      break;
    case PSA_TEXT_MACHINE_SET:
      scene.textBuf = text('gText_MachineSet');
      break;
    case PSA_TEXT_HUH:
      scene.textBuf = text('gText_Huh');
      break;
    default:
      return;
  }

  AddTextPrinterParameterized5(0, FONT_NORMAL, scene.textBuf, strWidth & 0xff, 0, textSpeed, 0, 4);
}

/** PSA_AfterPoof_ClearMessageWindow */
export function PSA_AfterPoof_ClearMessageWindow(): void {
  FillWindowPixelBuffer(0, PIXEL_FILL(1));
  CopyWindowToVram(0, COPYWIN_GFX);
}

/** PSA_IsMessagePrintTaskActive */
export function PSA_IsMessagePrintTaskActive(): boolean {
  return IsTextPrinterActive(0);
}

/** PSA_DarkenMonSprite: the mon's palette (and BG palette 2) to black, then the three stars. */
export function PSA_DarkenMonSprite(): void {
  const scene = PSA_GetSceneWork();
  scene.state = 0;
  BlendPalettes(((0x10000 << IndexOfSpritePaletteTag(0)) | 4) >>> 0, 16, RGB_BLACK);
  CreateStarSprites(scene);
}

/** PSA_RunPoofAnim: TRUE while the stars fly and the mon fades back in. */
export function PSA_RunPoofAnim(): boolean {
  const scene = PSA_GetSceneWork();
  switch (scene.state) {
    case 0:
      if (!AnyStarSpritesActive()) {
        BeginNormalPaletteFade(((0x10000 << IndexOfSpritePaletteTag(0)) | 4) >>> 0, -1, 16, 0, RGB_BLACK);
        scene.state++;
      }
      break;
    case 1:
      if (!gPaletteFade.active) return false;
      break;
  }
  return true;
}

/** PSA_UseTM_SetUpZoomOutAnim */
export function PSA_UseTM_SetUpZoomOutAnim(): void {
  PSA_GetSceneWork().state = 0;
}

/** PSA_UseTM_CleanUpForCancel */
export function PSA_UseTM_CleanUpForCancel(): void {
  StopMakingOutwardSpiralDots();
  ResetPaletteFadeControl();
}

/** PSA_UseTM_RunZoomOutAnim: the mon and the disc zoom out, the mon shakes in the blue flash, the dots, SE_EXP_MAX. */
export function PSA_UseTM_RunZoomOutAnim(): boolean {
  const scene = PSA_GetSceneWork();
  switch (scene.state) {
    case 0:
      StartZoomOutAnimForUseTM(0);
      scene.state++;
      break;
    case 1:
      if (!PSA_IsZoomTaskActive()) {
        scene.field_0004 = 0;
        scene.state++;
      }
      break;
    case 2:
      scene.field_0004++;
      if (scene.field_0004 > 20) scene.state++;
      break;
    case 3:
      StartMonWiggleAnim(scene, 1, 0, 1);
      scene.field_0004 = 0;
      scene.state++;
      break;
    case 4:
      scene.field_0004++;
      if (scene.field_0004 > 0) {
        scene.field_0004 = 0;
        PlaySE(K.SE_M_MEGA_KICK);
        BeginNormalPaletteFade(0x00000001, 2, 0, 12, RGB(8, 13, 31));
        PSAScene_SeedRandomInTask(scene);
        scene.state++;
      }
      break;
    case 5:
      scene.field_0004++;
      if (scene.field_0004 > 70) {
        StopMonWiggleAnim(scene);
        BeginNormalPaletteFade(0x00000001, 6, 12, 0, RGB(8, 13, 31));
        scene.field_0004 = 0;
        scene.state++;
      }
      break;
    case 6:
      scene.field_0004++;
      if (!IsOutwardSpiralDotsTaskRunning() && scene.field_0004 > 40) {
        scene.field_0004 = 0;
        scene.state++;
      }
      break;
    case 7:
      scene.field_0004++;
      if (scene.field_0004 > 20) scene.state++;
      break;
    case 8:
      PlaySE(K.SE_EXP_MAX);
      DestroySprite(scene.itemIconSprite!);
      scene.state++;
      break;
    default:
      return false;
  }
  return true;
}

/** PSA_UseTM_SetUpMachineSetWobble */
export function PSA_UseTM_SetUpMachineSetWobble(): void {
  PSA_GetSceneWork().state = 0;
}

/** PSA_UseTM_RunMachineSetWobble */
export function PSA_UseTM_RunMachineSetWobble(): boolean {
  const scene = PSA_GetSceneWork();
  switch (scene.state) {
    case 0:
      MachineSetWobbleInit();
      PlaySE(K.SE_SWITCH);
      scene.state++;
      break;
    case 1:
      return MachineSetWobbleCBIsRunning();
  }
  return true;
}

/** PSA_CreateLevelUpVerticalSpritesTask (unused in the C, as here) */
export function PSA_CreateLevelUpVerticalSpritesTask(): void {
  CreateLevelUpVerticalSpritesTask(120, 56, 4, 4, 2, 0);
}

/**
 * PSA_LevelUpVerticalSpritesTaskIsRunning: nothing in the item-use anim starts the stripes
 * (PSA_CreateLevelUpVerticalSpritesTask is unused), so Task_UseItem_Normal's state 5 goes on at once, as on the GBA.
 */
export function PSA_LevelUpVerticalSpritesTaskIsRunning(): boolean {
  return LevelUpVerticalSpritesTaskIsRunning();
}

/** LoadBgGfxByAnimType */
function LoadBgGfxByAnimType(animType: number): void {
  CopyToBgTilemapBuffer(3, gfx16(sym('sBg_Tilemap')), 0, 0x000);
  DecompressAndCopyTileDataToVram(3, gfx(sym('sBg_Gfx')), 0, 0x000, 0);
  if (animType !== PSA_ITEM_ANIM_TYPE_TMHM) LoadPalette(gfx16(sym('sBg_Pal')), BG_PLTT_ID(0), 0x20);
  else LoadPalette(gfx16(sym('sBg_TmHm_Pal')), BG_PLTT_ID(0), 0x20);
}

/**
 * Menu2_GetMonPosAttribute (menu2.c): sMonPosAttributes[species - 1][attr], the Unown letters by their own rows; 32 for
 * an entry of 0xFF, SPECIES_NONE or an attribute out of range.
 */
export function Menu2_GetMonPosAttribute(species: number, personality: number, attributeId: number): number {
  if (species === K.SPECIES_UNOWN) {
    const unownLetter = GET_UNOWN_LETTER(personality);
    switch (unownLetter) {
      case 0:
        break;
      case 26:
        species = K.NUM_SPECIES + 0; // SPECIES_OLD_UNOWN_EMARK
        break;
      case 27:
        species = K.NUM_SPECIES + 1; // SPECIES_OLD_UNOWN_QMARK
        break;
      default:
        species = K.SPECIES_OLD_UNOWN_B + unownLetter - 1;
        break;
    }
  }
  if (species !== K.SPECIES_NONE && attributeId < PSA_MON_ATTR_COUNT) {
    const v = menusData.monPosAttributes[species - 1]?.[attributeId] ?? 0;
    if (v !== 0xff) return v;
  }
  return 32;
}

/** Menu2_GetStarSpritePosAttribute: as an s8 */
function Menu2_GetStarSpritePosAttribute(species: number, personality: number, attributeId: number): number {
  return ((Menu2_GetMonPosAttribute(species, personality, attributeId) - 32) << 24) >> 24;
}

/** PSA_CreateMonSpriteAtCloseness: the mon's front pic (with its personality) at x 120, zoomed to `closeness`. */
export function PSA_CreateMonSpriteAtCloseness(closeness: number): void {
  const scene = PSA_GetSceneWork();
  const pokemon = PSA_GetPokemon();
  const species = pokemon.species;
  const personality = pokemon.personality;
  const yOffset = Menu2_GetMonPosAttribute(species, personality, PSA_MON_ATTR_Y_OFFSET);

  if (yOffset !== 0xff) {
    scene.monSpriteY1 = 72;
    scene.monSpriteY2 = yOffset + 48;
  } else {
    scene.monSpriteY1 = 72;
    scene.monSpriteY2 = 96;
  }

  // HandleLoadSpecialPokePic(&gMonFrontPicTable[species], monPicBuffer, species, personality)
  const monPicBuffer = new Uint8Array(K.MON_PIC_SIZE * 4);
  LoadSpecialPokePic(true, species, personality, monPicBuffer);
  // LZ77UnCompWram(GetMonFrontSpritePal(pokemon), monPalBuffer)
  const monPalBuffer = GetMonSpritePalFromSpeciesAndPersonality(species, pokemon.otId, personality);
  LoadMonSpriteGraphics(monPicBuffer, monPalBuffer);
  const spriteId = CreateSprite(sSpriteTemplate_MonSprite, 120, scene.monSpriteY1, 4);
  if (spriteId !== MAX_SPRITES) {
    scene.monSprite = gSprites[spriteId];
    MonSpriteZoom_UpdateYPos(scene.monSprite, closeness);
  } else {
    scene.monSprite = null;
  }
  scene.lastCloseness = closeness;
}

// Task_ZoomAnim's data (the sprites, tOff_MonSprite / tOff_ItemSprite, are task.ref's)
const tState = 0;
const tCurrCloseness = 1;
const tFinalCloseness = 2;
const tDeltaCloseness = 3;
const tTimer = 4;
const tDelay = 5;
const tHasItemSprite = 8;

interface ZoomSprites {
  mon: Sprite;
  item: Sprite | null;
}

/** PSA_SetUpZoomAnim: step the mon's closeness to `closeness`, one step every 7 frames with SE_BALL_TRAY_EXIT. */
export function PSA_SetUpZoomAnim(closeness: number): void {
  const scene = PSA_GetSceneWork();
  if (closeness !== scene.lastCloseness) {
    const taskId = CreateTask(Task_ZoomAnim, 4);
    gTasks[taskId].ref = { mon: scene.monSprite!, item: null } satisfies ZoomSprites;
    const data = gTasks[taskId].data;
    data[tCurrCloseness] = scene.lastCloseness;
    data[tFinalCloseness] = closeness;
    data[tDelay] = 6;
    data[tDeltaCloseness] = closeness > scene.lastCloseness ? 1 : -1;
  }
}

/** PSA_IsZoomTaskActive */
export function PSA_IsZoomTaskActive(): boolean {
  return FuncIsActiveTask(Task_ZoomAnim);
}

const Task_ZoomAnim: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const { mon: sprite, item } = gTasks[taskId].ref as ZoomSprites;
  switch (data[tState]) {
    case 0:
      SetSpriteWithCloseness(sprite, data[tCurrCloseness]);
      if (data[tHasItemSprite]) SetSpriteWithCloseness(item!, data[tCurrCloseness]);
      data[tCurrCloseness] += data[tDeltaCloseness];
      data[tState]++;
      break;
    case 1:
      if (!IsZoomSpriteCBActive(sprite)) {
        PlaySE(K.SE_BALL_TRAY_EXIT);
        MonSpriteZoom_UpdateYPos(sprite, data[tCurrCloseness]);
        if (data[tHasItemSprite]) ItemSpriteZoom_UpdateYPos(item!, data[tCurrCloseness]);
        if (data[tCurrCloseness] === data[tFinalCloseness]) {
          PSA_GetSceneWork().lastCloseness = data[tFinalCloseness];
          DestroyTask(taskId);
        } else {
          data[tTimer] = 0;
          data[tState] = 2;
        }
      }
      break;
    case 2:
      data[tTimer]++;
      if (data[tTimer] > data[tDelay]) data[tState] = 0;
      break;
  }
};

function SetSpriteWithCloseness(sprite: Sprite, closeness: number): void {
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.data[2] = closeness;
}

function IsZoomSpriteCBActive(sprite: Sprite): boolean {
  return sprite.callback !== SpriteCallbackDummy;
}

function GetSpriteOffsetByScale(pos: number, closeness: number): number {
  return s16((pos * sAffineScales[closeness]) >> 8);
}

/** GetYPosByScale: Y1 at scale 0x100, Y2 at 0x200, linear between. */
function GetYPosByScale(pos: number): number {
  const scene = PSA_GetSceneWork();
  const v = ((scene.monSpriteY2 - scene.monSpriteY1) * (pos - 256)) >> 8;
  return (v + scene.monSpriteY1) & 0xffff;
}

function MonSpriteZoom_UpdateYPos(sprite: Sprite, closeness: number): void {
  if (closeness > 3) closeness = 3;
  StartSpriteAffineAnim(sprite, closeness);
  sprite.y = s16(GetYPosByScale(sAffineScales[closeness]));
}

function ItemSpriteZoom_UpdateYPos(sprite: Sprite, closeness: number): void {
  MonSpriteZoom_UpdateYPos(sprite, closeness);
  sprite.x2 = GetSpriteOffsetByScale(sprite.data[6] - 32, closeness);
  sprite.y2 = GetSpriteOffsetByScale(sprite.data[7] - 32, closeness);
}

/** StartMonWiggleAnim: frameLen = frame duration, niter = 0 iterates for ever. */
function StartMonWiggleAnim(scene: PokemonSpecialAnimScene, frameLen: number, niter: number, amplitude: number): void {
  const s = scene.monSprite!;
  s.data[0] = frameLen;
  s.data[1] = niter;
  s.data[2] = amplitude;
  s.callback = SpriteCallback_MonSpriteWiggle;
}

function StopMonWiggleAnim(scene: PokemonSpecialAnimScene): void {
  scene.monSprite!.x2 = 0;
  scene.monSprite!.callback = SpriteCallbackDummy;
}

function SpriteCallback_MonSpriteWiggle(sprite: Sprite): void {
  sprite.data[7]++;
  if (sprite.data[7] > sprite.data[0]) {
    sprite.data[7] = 0;
    sprite.data[6]++;
    if (sprite.data[1] !== 0 && sprite.data[6] >= sprite.data[1]) {
      sprite.x2 = 0;
      sprite.callback = SpriteCallbackDummy;
    } else if (sprite.data[6] & 1) sprite.x2 = sprite.data[2];
    else sprite.x2 = -sprite.data[2];
  }
}

function LoadMonSpriteGraphics(tiles: Uint8Array, palette: Uint16Array): void {
  LoadSpriteSheet({ data: tiles, size: K.MON_PIC_SIZE, tag: 0 });
  LoadSpritePalette({ data: palette, tag: 0 });
}

// Task_ItemUseOnMonAnim's data (the item sprite, tOff_ItemSprite, is task.ref)
const tIState = 0;
const tITimer = 1;
const tICloseness = 2;
const tIYpos = 3;
const tIData6 = 6;
const tIData7 = 7;
const tIActiveSprCt = 8;
const tIBlendColor = 9;
const tITimerReset = 10;
const tISuppressDots = 11;

/** PSA_SetUpItemUseOnMonAnim: the item appears on the mon, flashes white and shrinks, then three bursts of dots. */
export function PSA_SetUpItemUseOnMonAnim(itemId: number, closeness: number, a2: boolean): void {
  const scene = PSA_GetSceneWork();
  scene.itemIconSprite = PSA_CreateItemIconObject(itemId);
  if (scene.itemIconSprite !== null) {
    InitItemIconSpriteState(scene, scene.itemIconSprite, closeness);
    StartSpriteAffineAnim(scene.itemIconSprite, closeness);
    scene.itemIconSprite.invisible = true;
    const taskId = CreateTask(Task_ItemUseOnMonAnim, 2);
    gTasks[taskId].ref = scene.itemIconSprite;
    const data = gTasks[taskId].data;
    data[tICloseness] = closeness;
    data[tIYpos] = GetYPosByScale(sAffineScales[closeness]);
    data[tIData6] = a2 ? 1 : 0;
    data[tIBlendColor] = GetBlendColorByItemId(itemId);
  }
}

function GetBlendColorByItemId(_itemId: number): number {
  return RGB_WHITE;
}

/** CreateItemIconSpriteAtMaxCloseness */
export function CreateItemIconSpriteAtMaxCloseness(itemId: number): void {
  const scene = PSA_GetSceneWork();
  scene.itemIconSprite = PSA_CreateItemIconObject(itemId);
  if (scene.itemIconSprite !== null) {
    StartSpriteAffineAnim(scene.itemIconSprite, 3);
    InitItemIconSpriteState(scene, scene.itemIconSprite, 3);
  }
}

function PSA_CreateItemIconObject(itemId: number): Sprite | null {
  const spriteId = AddItemIconObject(1, 1, itemId);
  if (spriteId === MAX_SPRITES) return null;
  const s = gSprites[spriteId];
  s.oam.affineMode = ST_OAM_AFFINE_DOUBLE;
  s.oam.priority = 1;
  s.subpriority = 1;
  s.affineAnims = sAffineAnimTable_Zoom;
  s.callback = SpriteCallbackDummy;
  InitSpriteAffineAnim(s);
  return s;
}

/** PSA_IsItemUseOnMonAnimActive */
export function PSA_IsItemUseOnMonAnimActive(): boolean {
  return FuncIsActiveTask(Task_ItemUseOnMonAnim);
}

const Task_ItemUseOnMonAnim: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  const sprite = gTasks[taskId].ref as Sprite;
  switch (data[tIState]) {
    case 0:
      data[tITimer]++;
      if (data[tITimer] > 20) {
        data[tITimer] = 0;
        PlaySE(K.SE_M_SWAGGER2);
        sprite.invisible = false;
        if (!data[tISuppressDots]) LoadOutwardSpiralDotsGfx();
        data[tIState] = 1;
      }
      break;
    case 1:
      data[tITimer]++;
      if (data[tITimer] > 30) {
        data[tITimer] = 0;
        sprite.affineAnims = sAffineAnimTable_ItemZoom;
        StartSpriteAffineAnim(sprite, data[tICloseness]);
        BeginNormalPaletteFade((0x10000 << IndexOfSpritePaletteTag(1)) >>> 0, -2, 0, 12, data[tIBlendColor] & 0xffff);
        data[tIState] = 2;
        PlaySE(K.SE_M_MILK_DRINK);
      }
      break;
    case 2:
      if (sprite.affineAnimEnded) {
        sprite.invisible = true;
        data[tITimerReset] = 20;
        data[tIState] = 3;
      }
      break;
    case 3:
      data[tITimer]++;
      if (data[tITimer] > data[tITimerReset]) {
        data[tITimer] = 0;
        if (!data[tISuppressDots]) CreateSprites_UseItem_OutwardSpiralDots(taskId, data, sprite);
        if (data[tIData7] === 0) PlaySE(K.SE_M_REVERSAL);
        data[tIData7]++;
        if (data[tIData7] > 2) data[tIState] = 4;
        else data[tITimerReset] = 8;
      }
      break;
    case 4:
      if (data[tIActiveSprCt] === 0) {
        if (data[tIData6]) DestroySprite(sprite);
        DestroyTask(taskId);
      }
      break;
  }
};

const sSpriteTemplate_UseItem_OutwardSpiralDots: SpriteTemplate = {
  tileTag: 5,
  paletteTag: 5,
  oam: sOamData_UseItem_OutwardSpiralDots,
  anims: sAnimTable_UseItem_OutwardSpiralDots,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallback_UseItem_OutwardSpiralDots,
};

function CreateSprites_UseItem_OutwardSpiralDots(taskId: number, data: Int16Array, sprite: Sprite): void {
  const x = sprite.x + sprite.x2 - 4;
  const y = sprite.y + sprite.y2 - 4;
  BlendPalettes((0x10000 << IndexOfSpritePaletteTag(5)) >>> 0, 16, data[tIBlendColor] & 0xffff);
  for (let i = 0; i < 15; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_UseItem_OutwardSpiralDots, x, y, 0);
    if (spriteId !== MAX_SPRITES) {
      gSprites[spriteId].data[1] = i << 4;
      gSprites[spriteId].data[7] = taskId;
      gSprites[spriteId].callback = SpriteCB_OutwardSpiralDots;
      StartSpriteAnim(gSprites[spriteId], 1);
      data[tIActiveSprCt]++;
    }
  }
}

function SpriteCB_OutwardSpiralDots(sprite: Sprite): void {
  const data = sprite.data;
  if (data[0] < 16) {
    data[0]++;
    data[1] += 7;
    data[1] &= 0xff;
    data[2] += 4;
    sprite.x2 = s16((data[2] * gSineTable(data[1] + 0x40)) >> 8);
    sprite.y2 = s16((data[2] * gSineTable(data[1])) >> 8);
  } else {
    gTasks[data[7]].data[tIActiveSprCt]--;
    DestroySprite(sprite);
  }
}

/** PSA_UseItem_CleanUpForCancel: no more dots from the running item anim. */
export function PSA_UseItem_CleanUpForCancel(): void {
  const taskId = FindTaskIdByFunc(Task_ItemUseOnMonAnim);
  if (taskId !== TASK_NONE) gTasks[taskId].data[tISuppressDots] = 1;
}

function InitItemIconSpriteState(scene: PokemonSpecialAnimScene, sprite: Sprite, closeness: number): void {
  if (closeness === 3) {
    sprite.x = 120;
    sprite.y = scene.monSpriteY2;
  } else {
    sprite.x = 120;
    sprite.y = scene.monSpriteY1;
  }
  sprite.x += 4;
  sprite.y += 4;
  const species = PSA_GetMonSpecies();
  const personality = PSA_GetMonPersonality();
  let x: number;
  let y: number;
  if (PSA_GetAnimType() === PSA_ITEM_ANIM_TYPE_TMHM) {
    x = Menu2_GetMonPosAttribute(species, personality, PSA_MON_ATTR_TMHM_X_POS);
    y = Menu2_GetMonPosAttribute(species, personality, PSA_MON_ATTR_TMHM_Y_POS);
  } else {
    x = Menu2_GetMonPosAttribute(species, personality, PSA_MON_ATTR_ITEM_X_POS);
    y = Menu2_GetMonPosAttribute(species, personality, PSA_MON_ATTR_ITEM_Y_POS);
  }
  if (x === 0xff) x = 0;
  if (y === 0xff) y = 0;
  sprite.data[6] = x;
  sprite.data[7] = y;
  ItemSpriteZoom_UpdateYPos(sprite, closeness);
}

function MachineSetWobbleInit(): void {
  const scene = PSA_GetSceneWork();
  MachineSetWobble_SetCB(scene.monSprite!);
  MachineSetWobble_SetCB(scene.itemIconSprite!);
}

function MachineSetWobble_SetCB(sprite: Sprite): void {
  sprite.data[0] = 0;
  sprite.data[1] = 0;
  sprite.callback = SpriteCB_MachineSetWobble;
}

function MachineSetWobbleCBIsRunning(): boolean {
  return PSA_GetSceneWork().monSprite!.callback !== SpriteCallbackDummy;
}

function SpriteCB_MachineSetWobble(sprite: Sprite): void {
  switch (sprite.data[0]) {
    case 0:
      sprite.x += 3;
      sprite.data[0]++;
      break;
    case 1:
      sprite.data[1]++;
      if (sprite.data[1] > 30) {
        sprite.x -= 3;
        sprite.callback = SpriteCallbackDummy;
      }
      break;
  }
}

/** StartZoomOutAnimForUseTM: Task_ZoomAnim on both the mon and the disc. */
function StartZoomOutAnimForUseTM(closeness: number): void {
  const scene = PSA_GetSceneWork();
  if (closeness !== scene.lastCloseness) {
    const taskId = CreateTask(Task_ZoomAnim, 1);
    gTasks[taskId].ref = { mon: scene.monSprite!, item: scene.itemIconSprite } satisfies ZoomSprites;
    const data = gTasks[taskId].data;
    data[tCurrCloseness] = scene.lastCloseness;
    data[tFinalCloseness] = closeness;
    data[tHasItemSprite] = 1;
    data[tDelay] = 6;
    data[tDeltaCloseness] = closeness > scene.lastCloseness ? 1 : -1;
  }
}

const sSpriteTemplate_Star: SpriteTemplate = {
  tileTag: 2,
  paletteTag: 2,
  oam: sOamData_Star,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_Star,
};

function CreateStarSprites(scene: PokemonSpecialAnimScene): void {
  LoadCompressedSpriteSheet({ data: gfx(sym('sStar_Gfx')), size: 0x80, tag: 2 });
  LoadSpritePalette({ data: gfx16(sym('sStar_Pal')), tag: 2 });
  scene.field_0002 = 0;
  for (let i = 0; i < 3; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_Star, 120 + sStarCoordOffsets[i][0], scene.monSpriteY2 + sStarCoordOffsets[i][1], 2);
    if (spriteId !== MAX_SPRITES) {
      const species = PSA_GetMonSpecies();
      const personality = PSA_GetMonPersonality();
      const s = gSprites[spriteId];
      s.data[3] = sStarCoordOffsets[i][0] * 8;
      s.data[4] = sStarCoordOffsets[i][1] * 8;
      s.x += GetSpriteOffsetByScale(Menu2_GetStarSpritePosAttribute(species, personality, PSA_MON_ATTR_TMHM_X_POS), 3);
      s.y += GetSpriteOffsetByScale(Menu2_GetStarSpritePosAttribute(species, personality, PSA_MON_ATTR_TMHM_Y_POS), 3);
      scene.field_0002++;
    }
  }
}

function AnyStarSpritesActive(): boolean {
  return PSA_GetSceneWork().field_0002 !== 0;
}

function SpriteCB_Star(sprite: Sprite): void {
  sprite.data[0]++;
  if (sprite.data[0] < 10) {
    sprite.data[1] += sprite.data[3];
    sprite.data[2] += sprite.data[4];
    sprite.x2 = sprite.data[1] >> 4;
    sprite.y2 = sprite.data[2] >> 4;
  } else {
    PSA_GetSceneWork().field_0002--;
    DestroySprite(sprite);
  }
}

// Task_UseItem_OutwardSpiralDots's data (the u32 RNG state is data[3..4], tOff_RngState)
const tDState = 0;
const tDTimer = 1;
const tDActiveSprCt = 2;
const tOff_RngState = 3;
const tDAngle = 5;
const tDMadeSprCt = 6;

// SpriteCallback_UseItem_OutwardSpiralDots's data
const tsRadius = 0;
const tsSpeed = 1;
const tsXinit = 2;
const tsYinit = 3;
const tsXorig = 4;
const tsYorig = 5;
const tsTaskId = 6;

/** PSAScene_SeedRandomInTask: the TM's 48 dots, drawn in towards the disc (their own RNG, seeded 2022069025). */
function PSAScene_SeedRandomInTask(_scene: PokemonSpecialAnimScene): void {
  LoadOutwardSpiralDotsGfx();
  const taskId = CreateTask(Task_UseItem_OutwardSpiralDots, 1);
  SetWordTaskArg(taskId, tOff_RngState, 2022069025);
  gTasks[taskId].data[tDAngle] = 0xe0;
}

function StopMakingOutwardSpiralDots(): void {
  const taskId = FindTaskIdByFunc(Task_UseItem_OutwardSpiralDots);
  if (taskId !== TASK_NONE) gTasks[taskId].data[tDState] = 1;
}

const Task_UseItem_OutwardSpiralDots: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (data[tDState]) {
    case 0:
      if (data[tDTimer] === 0) {
        const sprite = PSA_GetSceneWork().itemIconSprite!;
        // u32 arithmetic: (u32)(sine * ampl) >> 8 is a logical shift, the s16 sprite coordinates keep its low bits
        const x = (sprite.x + sprite.x2) >>> 0;
        const y = (sprite.y + sprite.y2) >>> 0;
        const ampl = (PSAScene_RandomFromTask(taskId) % 21) + 70;
        const x2 = (x + ((gSineTable(data[tDAngle] + 0x40) * ampl) >>> 0 >>> 8)) >>> 0;
        const y2 = (y + ((gSineTable(data[tDAngle]) * ampl) >>> 0 >>> 8)) >>> 0;
        data[tDAngle] += 0x4c;
        data[tDAngle] &= 0xff;
        const spriteId = CreateSprite(sSpriteTemplate_UseItem_OutwardSpiralDots, s16(x2), s16(y2), 0);
        if (spriteId !== MAX_SPRITES) {
          const d = gSprites[spriteId].data;
          d[tsRadius] = 0;
          d[tsSpeed] = (PSAScene_RandomFromTask(taskId) & 1) + 6;
          d[tsXinit] = x2;
          d[tsYinit] = y2;
          d[tsXorig] = x;
          d[tsYorig] = y;
          d[tsTaskId] = taskId;
          data[tDActiveSprCt]++;
        }
        data[tDMadeSprCt]++;
        if (data[tDMadeSprCt] > 47) data[tDState]++;
      } else data[tDTimer]--;
      break;
    case 1:
      if (data[tDActiveSprCt] === 0) DestroyTask(taskId);
      break;
  }
};

function PSAScene_RandomFromTask(taskId: number): number {
  let state = GetWordTaskArg(taskId, tOff_RngState);
  state = ISO_RANDOMIZE1(state);
  SetWordTaskArg(taskId, tOff_RngState, state);
  return state >>> 16;
}

function SpriteCallback_UseItem_OutwardSpiralDots(sprite: Sprite): void {
  const d = sprite.data;
  d[tsRadius] += d[tsSpeed];
  if (d[tsRadius] > 255) {
    gTasks[d[tsTaskId]].data[tDActiveSprCt]--;
    DestroySprite(sprite);
  } else {
    const x = (d[tsXorig] - d[tsXinit]) * d[tsRadius];
    const y = (d[tsYorig] - d[tsYinit]) * d[tsRadius];
    sprite.x = s16((x >> 8) + d[tsXinit]);
    sprite.y = s16((y >> 8) + d[tsYinit]);
  }
}

function LoadOutwardSpiralDotsGfx(): void {
  LoadCompressedSpriteSheet({ data: gfx(sym('sOutwardSpiralDots_Gfx')), size: 0x60, tag: 5 });
  LoadSpritePalette({ data: gfx16(sym('sOutwardSpiralDots_Pal')), tag: 5 });
}

function IsOutwardSpiralDotsTaskRunning(): boolean {
  return FuncIsActiveTask(Task_UseItem_OutwardSpiralDots);
}

// ---------------------------------------------------------------- the level-up's vertical stripes

// Task_LevelUpVerticalSprites' data
const tLState = 0;
const tLActiveSprCt = 1;
const tLMadeSprCt = 2;
const tLTimer = 3;
const tLXpos = 4;
const tLYpos = 5;
const tLTileTag = 6;
const tLPaletteTag = 7;
const tLPriority = 8;
const tLSubpriority = 9;
// SpriteCB_LevelUpVertical's
const tsYsubpixel = 1;
const tsLSpeed = 2;
const tsLTaskId = 7;

const sOamData_LevelUpVertical = oam({ objMode: ST_OAM_OBJ_BLEND, shape: SPRITE_SHAPE['8x16'][0], size: SPRITE_SHAPE['8x16'][1], priority: 1 });

const sAnimTable_LevelUpVertical: AnimCmd[][] = [[ANIMCMD_FRAME(0, 3), ANIMCMD_END]];

const sSpriteTemplate_LevelUpVertical: SpriteTemplate = {
  tileTag: 0,
  paletteTag: 0,
  oam: sOamData_LevelUpVertical,
  anims: sAnimTable_LevelUpVertical,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_LevelUpVertical,
};

/**
 * CreateLevelUpVerticalSpritesTask: 18 translucent 8x16 stripes, one every other frame, rising from (x - 32 + 0..63,
 * y + 32) at 2-6 px a frame (BLDALPHA 12 / 6 over everything); the task ends once the last has risen 64 px.
 */
export function CreateLevelUpVerticalSpritesTask(x: number, y: number, tileTag: number, paletteTag: number, priority: number, subpriority: number): void {
  const sheet = gfx('sLevelUp_Gfx');
  LoadCompressedSpriteSheet({ data: sheet, size: sheet.length, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sLevelUp_Pal'), tag: paletteTag });
  const taskId = CreateTask(Task_LevelUpVerticalSprites, 0);
  const data = gTasks[taskId].data;
  data[tLXpos] = x - 32;
  data[tLYpos] = y + 32;
  data[tLTileTag] = tileTag;
  data[tLPaletteTag] = paletteTag;
  data[tLPriority] = priority;
  data[tLSubpriority] = subpriority;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_NONE | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(12, 6));
}

/** LevelUpVerticalSpritesTaskIsRunning */
export function LevelUpVerticalSpritesTaskIsRunning(): boolean {
  return FuncIsActiveTask(Task_LevelUpVerticalSprites);
}

/** Task_LevelUpVerticalSprites */
function Task_LevelUpVerticalSprites(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[tLState]) {
    case 0:
      if (data[tLTimer] === 0) {
        data[tLTimer]++;
        CreateLevelUpVerticalSprite(taskId, data);
        if (data[tLMadeSprCt] > 17) data[tLState]++;
      } else {
        data[tLTimer]++;
        if (data[tLTimer] === 2) data[tLTimer] = 0;
      }
      break;
    case 1:
      if (data[tLActiveSprCt] === 0) {
        FreeSpriteTilesByTag(data[tLTileTag]);
        FreeSpritePaletteByTag(data[tLPaletteTag]);
        DestroyTask(taskId);
      }
      break;
  }
}

/** CreateLevelUpVerticalSprite */
function CreateLevelUpVerticalSprite(taskId: number, data: Int16Array): void {
  const template: SpriteTemplate = { ...sSpriteTemplate_LevelUpVertical, tileTag: data[tLTileTag], paletteTag: data[tLPaletteTag] };
  data[tLMadeSprCt]++;
  const spriteId = CreateSprite(template, ((data[tLMadeSprCt] * 219) & 0x3f) + data[tLXpos], data[tLYpos], data[tLSubpriority]);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    s.oam.priority = data[tLPriority];
    s.data[tsYsubpixel] = 0;
    s.data[tsLSpeed] = (ISO_RANDOMIZE1(data[tLMadeSprCt]) & 0x3f) + 0x20;
    s.data[tsLTaskId] = taskId;
    data[tLActiveSprCt]++;
  }
}

/** SpriteCB_LevelUpVertical */
function SpriteCB_LevelUpVertical(sprite: Sprite): void {
  sprite.data[tsYsubpixel] -= sprite.data[tsLSpeed];
  sprite.y2 = sprite.data[tsYsubpixel] >> 4;
  if (sprite.y2 < -0x40) {
    gTasks[sprite.data[tsLTaskId]].data[tLActiveSprCt]--;
    DestroySprite(sprite);
  }
}
