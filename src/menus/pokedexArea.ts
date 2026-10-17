// pokedex_area_markers.c: the red markers on the Pokédex area page's map. All the markers together are one
// sprite whose subsprites are the markers (GetSpeciesPokedexAreaMarkers, menus/wildPokemonArea.ts, picks
// them). The sprite is an OBJ window: inside it BG1, filled with tile 0x00F from char base 0 (a solid tile of the
// area map's graphics), shows through, alpha-blended (12/8) over the map below.
//
// The area page (pokedex_screen.c's DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources), A on the
// mon page: the Kanto map and the unlocked Sevii islands with the markers over them, the species' icon, number and
// name, its types once caught, and the size comparison (the mon's and the player's pics as silhouettes).

import { K } from '../battle/constants';
import { bdata, state } from '../battle/env';
import { BG_ATTR_CHARBASEINDEX, BG_TILE_H_FLIP, BG_TILE_V_FLIP, CopyBgTilemapBufferToVram, FillBgTilemapBufferRect_Palette0, HideBg, SetBgAttribute, ShowBg } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_BD,
  BLDCNT_TGT2_BG0,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG2,
  BLDCNT_TGT2_BG3,
  ClearGpuRegBits,
  DISPCNT_OBJWIN_ON,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  SetGpuReg,
  SetGpuRegBits,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG_ALL,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
  WINOUT_WINOBJ_BG_ALL,
  WINOUT_WINOBJ_CLR,
  WINOUT_WINOBJ_OBJ,
} from '../gba/hw';
import { BlitMenuInfoIcon, ListMenu_DrawMonIconGraphics, ListMenu_LoadMonIconPalette, ListMenuLoadStdPalAt } from '../gba/listMenu';
import { BG_PLTT_ID, gPaletteFade, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeSpriteTilesByTag,
  gDummySpriteTemplate,
  gOamMatrices,
  gSprites,
  LoadCompressedSpriteSheet,
  SetOamMatrix,
  SetSubspriteTables,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_OBJ_WINDOW,
  TAG_NONE,
  type Subsprite,
  type SubspriteTable,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import {
  AddWindow,
  BlitBitmapRectToWindow,
  COPYWIN_GFX,
  CopyToWindowPixelBuffer,
  CopyWindowToVram,
  FillWindowPixelBuffer,
  GetStringWidth,
  GetWindowAttribute,
  gWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  SetWindowAttribute,
  WINDOW_NONE,
  type WindowTemplate,
} from '../gba/window';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { GetUnlockedSeviiAreas } from '../world/regionMap';
import { speciesName, text } from './common';
import { menusData } from './data';
import { PlayerGenderToFrontTrainerPicId } from './hallOfFame';
import { CreateMonPicSprite_HandleDeoxys, CreateTrainerPicSprite, FreeAndDestroyMonPicSprite, FreeAndDestroyTrainerPicSprite, ResetAllPicSprites } from './picSprites';
import { DexScreen_GetSetPokedexFlag, FLAG_GET_CAUGHT, pokedexData } from './pokedex';
import {
  DexScreen_AddTextPrinterParameterized,
  DexScreen_GetDefaultPersonality,
  DexScreen_PrintControlInfo,
  DexScreen_PrintMonDexNo,
  sPokedexScreenData,
  type PokedexScreenData,
} from './pokedexScreen';
import { GetSpeciesPokedexAreaMarkers } from './wildPokemonArea';

/** What the area page preloads (loadGfx) before it creates the markers. */
export const pokedexAreaMarkerGfxSymbols = ['sMarkerTiles', 'sMarkerPal'];

/** struct PAM_TaskData (kept in the task's `ref`) */
interface PAM_TaskData {
  subsprites: SubspriteTable;
  /** the Alloc'd subsprite buffer (120 entries in the C) */
  buffer: Subsprite[];
  spriteId: number;
  tilesTag: number;
  /** Never read */
  paletteTag: number;
}

function taskData(taskId: number): PAM_TaskData {
  return gTasks[taskId].ref as PAM_TaskData;
}

/** Task_ShowAreaMarkers: the markers appear on the task's first run, the frame after they're created. */
function Task_ShowAreaMarkers(taskId: number): void {
  gSprites[taskData(taskId).spriteId].invisible = false;
}

/**
 * CreatePokedexAreaMarkers: loads the marker tiles (`tilesTag`) and palette (OBJ palette `palIdx`), builds the
 * species' markers as one OBJ-window sprite at (104, y + 32), and sets BG1 and the window/blend registers
 * up to show them. Returns the task id (GetNumPokedexAreaMarkers / DestroyPokedexAreaMarkers take it).
 */
export function CreatePokedexAreaMarkers(species: number, tilesTag: number, palIdx: number, y: number): number {
  // Load gfx
  LoadCompressedSpriteSheet({ data: gfx('sMarkerTiles'), size: 0x4a0, tag: tilesTag });
  LoadPalette(gfx16('sMarkerPal'), OBJ_PLTT_ID(palIdx), 32);

  // Get marker subsprites
  const taskId = CreateTask(Task_ShowAreaMarkers, 0);
  const subsprites: Subsprite[] = [];
  const data: PAM_TaskData = {
    subsprites: { subspriteCount: 0, subsprites },
    buffer: subsprites,
    spriteId: 0,
    tilesTag,
    paletteTag: TAG_NONE,
  };
  gTasks[taskId].ref = data;
  data.subsprites.subspriteCount = GetSpeciesPokedexAreaMarkers(species, subsprites);

  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG0 | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_BG2 | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_BD);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(12, 8));
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG0 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_CLR);

  // Set marker subsprites on full sprite
  const spriteId = CreateSprite({ ...gDummySpriteTemplate, tileTag: tilesTag }, 104, y + 32, 0);
  data.spriteId = spriteId;
  const sprite = gSprites[spriteId];
  SetSubspriteTables(sprite, [data.subsprites]);
  sprite.oam.objMode = ST_OAM_OBJ_WINDOW;
  sprite.oam.paletteNum = palIdx;
  sprite.subspriteTableNum = 0;
  sprite.invisible = true;

  // Show markers
  HideBg(1);
  SetBgAttribute(1, BG_ATTR_CHARBASEINDEX, 0);
  FillBgTilemapBufferRect_Palette0(1, 0x00f, 0, 0, 30, 20);
  CopyBgTilemapBufferToVram(1);
  ShowBg(1);
  return taskId;
}

/** DestroyPokedexAreaMarkers: frees the markers and puts BG1 and the window/blend registers back. */
export function DestroyPokedexAreaMarkers(taskId: number): void {
  const data = taskData(taskId);
  FreeSpriteTilesByTag(data.tilesTag);
  DestroySprite(gSprites[data.spriteId]);
  data.buffer.length = 0; // Free(data->buffer)
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN1_BG_ALL | WININ_WIN1_OBJ);
  SetGpuReg(REG_OFFSET_WINOUT, WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WINOBJ_BG_ALL | WINOUT_WINOBJ_OBJ);
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJWIN_ON);
  HideBg(1);
  SetBgAttribute(1, BG_ATTR_CHARBASEINDEX, 2);
  FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 0, 30, 20);
  CopyBgTilemapBufferToVram(1);
  ShowBg(1);
  gTasks[taskId].ref = undefined;
  DestroyTask(taskId);
}

/** GetAreaMarkerSubsprite: subsprites[i] = the DEX_AREA_*'s marker shape at its sAreaMarkers position. */
export function GetAreaMarkerSubsprite(i: number, dexArea: number, subsprites: Subsprite[]): void {
  const { areaMarkers, subsprites: shapes } = menusData.pokedexArea;
  const [marker, x, y] = areaMarkers[dexArea];
  const [shape, size, priority, tileOffset] = shapes[marker];
  subsprites[i] = { x, y, shape, size, tileOffset, priority };
}

/** GetNumPokedexAreaMarkers */
export function GetNumPokedexAreaMarkers(taskId: number): number {
  return taskData(taskId).subsprites.subspriteCount;
}

/** The markers' sprite, for probes (undefined once destroyed). */
export function pokedexAreaMarkersSprite(taskId: number): number | undefined {
  return (gTasks[taskId].ref as PAM_TaskData | undefined)?.spriteId;
}

// ------------------------------------------------------------------ the area page (pokedex_screen.c)

const TAG_AREA_MARKERS = 2001;

/** BG_TILE_H_FLIP(BG_TILE_V_FLIP(n)) */
const BG_TILE_H_V_FLIP = (n: number) => BG_TILE_H_FLIP(BG_TILE_V_FLIP(n));

const sWindowTemplate_AreaMap_MonIcon: WindowTemplate = { bg: 2, tilemapLeft: 1, tilemapTop: 2, width: 4, height: 4, paletteNum: 10, baseBlock: 0x01a8 };
const sWindowTemplate_AreaMap_SpeciesName: WindowTemplate = { bg: 2, tilemapLeft: 5, tilemapTop: 2, width: 8, height: 3, paletteNum: 0, baseBlock: 0x01b8 };
const sWindowTemplate_AreaMap_Size: WindowTemplate = { bg: 2, tilemapLeft: 2, tilemapTop: 7, width: 10, height: 2, paletteNum: 0, baseBlock: 0x01d0 };
const sWindowTemplate_AreaMap_Area: WindowTemplate = { bg: 2, tilemapLeft: 18, tilemapTop: 2, width: 10, height: 2, paletteNum: 0, baseBlock: 0x01e4 };
const sWindowTemplate_AreaMap_MonTypes: WindowTemplate = { bg: 2, tilemapLeft: 5, tilemapTop: 5, width: 8, height: 2, paletteNum: 11, baseBlock: 0x01f8 };
const sWindowTemplate_AreaMap_Kanto: WindowTemplate = { bg: 2, tilemapLeft: 17, tilemapTop: 4, width: 12, height: 9, paletteNum: 0, baseBlock: 0x0208 };

/** sAreaMapStructs_SeviiIslands: each island's window and its map (4bpp tiles, sTilemap_AreaMap_*) */
const sAreaMapStructs_SeviiIslands: { window: WindowTemplate; tiles: string }[] = [
  { window: { bg: 2, tilemapLeft: 13, tilemapTop: 4, width: 4, height: 3, paletteNum: 0, baseBlock: 0x0274 }, tiles: 'sTilemap_AreaMap_OneIsland' },
  { window: { bg: 2, tilemapLeft: 13, tilemapTop: 7, width: 4, height: 3, paletteNum: 0, baseBlock: 0x0280 }, tiles: 'sTilemap_AreaMap_TwoIsland' },
  { window: { bg: 2, tilemapLeft: 13, tilemapTop: 10, width: 4, height: 3, paletteNum: 0, baseBlock: 0x028c }, tiles: 'sTilemap_AreaMap_ThreeIsland' },
  { window: { bg: 2, tilemapLeft: 13, tilemapTop: 13, width: 4, height: 4, paletteNum: 0, baseBlock: 0x0298 }, tiles: 'sTilemap_AreaMap_FourIsland' },
  { window: { bg: 2, tilemapLeft: 17, tilemapTop: 13, width: 4, height: 4, paletteNum: 0, baseBlock: 0x02a8 }, tiles: 'sTilemap_AreaMap_FiveIsland' },
  { window: { bg: 2, tilemapLeft: 21, tilemapTop: 13, width: 4, height: 4, paletteNum: 0, baseBlock: 0x02b8 }, tiles: 'sTilemap_AreaMap_SixIsland' },
  { window: { bg: 2, tilemapLeft: 25, tilemapTop: 13, width: 4, height: 4, paletteNum: 0, baseBlock: 0x02c8 }, tiles: 'sTilemap_AreaMap_SevenIsland' },
];

function playerGender(): number {
  return state.playerGender === 'female' ? K.FEMALE : K.MALE;
}

/**
 * The graphics the area page draws that don't depend on the species (the Pokédex preloads them): the maps, the
 * "AREA UNKNOWN" ellipse, the silhouette palette, the markers and the player's front pic. The mon's icon comes with
 * the mon page's graphics (dexMonGfxSymbols).
 */
export function pokedexAreaGfxSymbols(): string[] {
  const pic = PlayerGenderToFrontTrainerPicId(playerGender());
  return [
    ...pokedexAreaMarkerGfxSymbols,
    'sTilemap_AreaMap_Kanto',
    ...sAreaMapStructs_SeviiIslands.map((s) => s.tiles),
    'sBlitTiles_WideEllipse',
    'sPalette_Silhouette',
    'gMonIconPalettes',
    bdata.anims.trainerFrontPics[pic]!.pic,
    bdata.anims.trainerFrontPalettes[pic]!,
  ];
}

/** What the area page drew last (the test probe reads it). */
let sAreaPage: { species: number; kantoMapVoff: number; unlockedSeviiAreas: number; types: number[]; areaUnknown: boolean } | undefined;

/** DexScreen_RemoveWindow on sPokedexScreenData->windowIds[i] */
function removeAreaWindow(d: PokedexScreenData, i: number): void {
  if (d.windowIds[i] !== WINDOW_NONE) {
    RemoveWindow(d.windowIds[i]);
    d.windowIds[i] = WINDOW_NONE;
  }
}

/** DexScreen_DrawMonAreaPage: draws the area page of sPokedexScreenData->dexSpecies (the caller copies the BGs). */
export function DexScreen_DrawMonAreaPage(): number {
  const d = sPokedexScreenData!;
  const species = d.dexSpecies;
  const speciesId = state.pokemon.nationalDex(species);
  const monIsCaught = DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_CAUGHT, true);

  // The frame: BG3 around the whole page, BG0 around the size comparison
  let width = 28;
  let height = 14;
  let left = 0;
  let top = 2;
  FillBgTilemapBufferRect_Palette0(3, 4, left, top, 1, 1);
  FillBgTilemapBufferRect_Palette0(3, BG_TILE_H_FLIP(4), left + 1 + width, top, 1, 1);
  FillBgTilemapBufferRect_Palette0(3, BG_TILE_V_FLIP(4), left, top + 1 + height, 1, 1);
  FillBgTilemapBufferRect_Palette0(3, BG_TILE_H_V_FLIP(4), left + 1 + width, top + 1 + height, 1, 1);
  FillBgTilemapBufferRect_Palette0(3, 5, left + 1, top, width, 1);
  FillBgTilemapBufferRect_Palette0(3, BG_TILE_V_FLIP(5), left + 1, top + 1 + height, width, 1);
  FillBgTilemapBufferRect_Palette0(3, 6, left, top + 1, 1, height);
  FillBgTilemapBufferRect_Palette0(3, BG_TILE_H_FLIP(6), left + 1 + width, top + 1, 1, height);
  FillBgTilemapBufferRect_Palette0(3, 1, left + 1, top + 1, width, height);
  FillBgTilemapBufferRect_Palette0(0, 0, 0, 2, 30, 16);

  width = 10;
  height = 6;
  left = 1;
  top = 9;
  FillBgTilemapBufferRect_Palette0(0, 29, left, top, 1, 1);
  FillBgTilemapBufferRect_Palette0(0, BG_TILE_H_FLIP(29), left + 1 + width, top, 1, 1);
  FillBgTilemapBufferRect_Palette0(0, BG_TILE_V_FLIP(29), left, top + 1 + height, 1, 1);
  FillBgTilemapBufferRect_Palette0(0, BG_TILE_H_V_FLIP(29), left + 1 + width, top + 1 + height, 1, 1);
  FillBgTilemapBufferRect_Palette0(0, 30, left + 1, top, width, 1);
  FillBgTilemapBufferRect_Palette0(0, BG_TILE_V_FLIP(30), left + 1, top + 1 + height, width, 1);
  FillBgTilemapBufferRect_Palette0(0, 31, left, top + 1, 1, height);
  FillBgTilemapBufferRect_Palette0(0, BG_TILE_H_FLIP(31), left + 1 + width, top + 1, 1, height);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 30, 20);
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 20);

  d.unlockedSeviiAreas = GetUnlockedSeviiAreas();
  let kantoMapVoff = 4;
  // If any of the postgame islands are unlocked, Kanto map needs to be flush with the top of the screen.
  for (let i = 3; i < 7; i++) if ((d.unlockedSeviiAreas >> i) & 1) kantoMapVoff = 0;

  // The maps: 4bpp tiles copied straight into the windows' pixel buffers
  d.windowIds[0] = AddWindow(sWindowTemplate_AreaMap_Kanto);
  CopyToWindowPixelBuffer(d.windowIds[0], gfx('sTilemap_AreaMap_Kanto'), 0, 0);
  SetWindowAttribute(d.windowIds[0], 'tilemapTop', GetWindowAttribute(d.windowIds[0], 'tilemapTop') + kantoMapVoff);
  PutWindowTilemap(d.windowIds[0]);
  for (let i = 0; i < 7; i++) {
    if ((d.unlockedSeviiAreas >> i) & 1) {
      const win = (d.windowIds[i + 1] = AddWindow(sAreaMapStructs_SeviiIslands[i].window));
      CopyToWindowPixelBuffer(win, gfx(sAreaMapStructs_SeviiIslands[i].tiles), 0, 0);
      SetWindowAttribute(win, 'tilemapTop', GetWindowAttribute(win, 'tilemapTop') + kantoMapVoff);
      PutWindowTilemap(win);
      CopyWindowToVram(win, COPYWIN_GFX);
    }
  }
  d.windowIds[8] = AddWindow(sWindowTemplate_AreaMap_SpeciesName);
  d.windowIds[9] = AddWindow(sWindowTemplate_AreaMap_Size);
  d.windowIds[10] = AddWindow(sWindowTemplate_AreaMap_Area);
  d.windowIds[11] = AddWindow(sWindowTemplate_AreaMap_MonIcon);
  d.windowIds[12] = AddWindow(sWindowTemplate_AreaMap_MonTypes);

  // Draw the mon icon
  FillWindowPixelBuffer(d.windowIds[11], PIXEL_FILL(0));
  ListMenu_LoadMonIconPalette(BG_PLTT_ID(10), species);
  ListMenu_DrawMonIconGraphics(d.windowIds[11], species, DexScreen_GetDefaultPersonality(species), 0, 0);
  PutWindowTilemap(d.windowIds[11]);
  CopyWindowToVram(d.windowIds[11], COPYWIN_GFX);

  // Print "Size"
  FillWindowPixelBuffer(d.windowIds[9], PIXEL_FILL(0));
  const size = text('gText_Size');
  DexScreen_AddTextPrinterParameterized(d.windowIds[9], FONT_SMALL, size, Math.trunc((sWindowTemplate_AreaMap_Size.width * 8 - GetStringWidth(FONT_SMALL, size, 0)) / 2), 4, 0);
  PutWindowTilemap(d.windowIds[9]);
  CopyWindowToVram(d.windowIds[9], COPYWIN_GFX);

  // Print "Area"
  FillWindowPixelBuffer(d.windowIds[10], PIXEL_FILL(0));
  const area = text('gText_Area');
  DexScreen_AddTextPrinterParameterized(d.windowIds[10], FONT_SMALL, area, Math.trunc((sWindowTemplate_AreaMap_Area.width * 8 - GetStringWidth(FONT_SMALL, area, 0)) / 2), 4, 0);
  SetWindowAttribute(d.windowIds[10], 'tilemapTop', GetWindowAttribute(d.windowIds[10], 'tilemapTop') + kantoMapVoff);
  PutWindowTilemap(d.windowIds[10]);
  CopyWindowToVram(d.windowIds[10], COPYWIN_GFX);

  // Print species name
  FillWindowPixelBuffer(d.windowIds[8], PIXEL_FILL(0));
  DexScreen_PrintMonDexNo(d.windowIds[8], FONT_SMALL, species, 0, 0);
  DexScreen_AddTextPrinterParameterized(d.windowIds[8], FONT_NORMAL, speciesName(species), 3, 12, 0);
  PutWindowTilemap(d.windowIds[8]);
  CopyWindowToVram(d.windowIds[8], COPYWIN_GFX);

  // Type icons
  FillWindowPixelBuffer(d.windowIds[12], PIXEL_FILL(0));
  ListMenuLoadStdPalAt(BG_PLTT_ID(11), 1);
  const types: number[] = [];
  if (monIsCaught) {
    const speciesTypes = state.pokemon.species[species].types;
    BlitMenuInfoIcon(d.windowIds[12], 1 + speciesTypes[0], 0, 1);
    types.push(speciesTypes[0]);
    if (speciesTypes[0] !== speciesTypes[1]) {
      BlitMenuInfoIcon(d.windowIds[12], 1 + speciesTypes[1], 32, 1);
      types.push(speciesTypes[1]);
    }
  }
  PutWindowTilemap(d.windowIds[12]);
  CopyWindowToVram(d.windowIds[12], COPYWIN_GFX);

  // Show size comparison: the mon's pic (matrix 2) and the player's (matrix 1) in the silhouette palette, scaled
  // by gPokedexEntries' pokemonScale / trainerScale (0x100 = full size) and moved down by the offsets
  ResetAllPicSprites();
  LoadPalette(gfx16('sPalette_Silhouette'), OBJ_PLTT_ID(2), PLTT_SIZE_4BPP);
  if (monIsCaught) {
    const entry = pokedexData.entries[speciesId];
    const monSpriteId = (d.windowIds[14] = CreateMonPicSprite_HandleDeoxys(species, K.SHINY_ODDS, DexScreen_GetDefaultPersonality(species), true, 40, 104, 0, 0xffff));
    const mon = gSprites[monSpriteId];
    mon.oam.paletteNum = 2;
    mon.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    mon.oam.matrixNum = 2;
    mon.oam.priority = 1;
    mon.y2 = entry.pokemonOffset;
    SetOamMatrix(2, entry.pokemonScale, 0, 0, entry.pokemonScale);
    const trainerSpriteId = (d.windowIds[15] = CreateTrainerPicSprite(PlayerGenderToFrontTrainerPicId(playerGender()), true, 80, 104, 0, 0xffff));
    const trainer = gSprites[trainerSpriteId];
    trainer.oam.paletteNum = 2;
    trainer.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    trainer.oam.matrixNum = 1;
    trainer.oam.priority = 1;
    trainer.y2 = entry.trainerOffset;
    SetOamMatrix(1, entry.trainerScale, 0, 0, entry.trainerScale);
  } else {
    d.windowIds[14] = 0xff;
    d.windowIds[15] = 0xff;
  }

  // Create the area markers
  d.areaMarkersTaskId = CreatePokedexAreaMarkers(species, TAG_AREA_MARKERS, 3, kantoMapVoff * 8);
  const areaUnknown = GetNumPokedexAreaMarkers(d.areaMarkersTaskId) === 0;
  if (areaUnknown) {
    // No markers, display "Area Unknown"
    BlitBitmapRectToWindow(d.windowIds[0], gfx('sBlitTiles_WideEllipse'), 0, 0, 88, 16, 4, 28, 88, 16);
    const unknown = text('gText_AreaUnknown');
    DexScreen_AddTextPrinterParameterized(d.windowIds[0], FONT_SMALL, unknown, Math.trunc((96 - GetStringWidth(FONT_SMALL, unknown, 0)) / 2), 29, 0);
  }
  CopyWindowToVram(d.windowIds[0], COPYWIN_GFX);

  // Draw the control info
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  DexScreen_AddTextPrinterParameterized(1, FONT_SMALL, text('gText_Cry'), 8, 2, 4);
  DexScreen_PrintControlInfo(text('gText_CancelPreviousData'));
  PutWindowTilemap(1);
  CopyWindowToVram(1, COPYWIN_GFX);

  sAreaPage = { species, kantoMapVoff, unlockedSeviiAreas: d.unlockedSeviiAreas, types, areaUnknown };
  return 1;
}

/** DexScreen_DestroyAreaScreenResources: the markers, the page's windows and the two silhouettes. */
export function DexScreen_DestroyAreaScreenResources(): number {
  const d = sPokedexScreenData!;
  DestroyPokedexAreaMarkers(d.areaMarkersTaskId);
  for (let i = 0; i < 13; i++) removeAreaWindow(d, i);
  if (d.windowIds[15] !== 0xff) FreeAndDestroyTrainerPicSprite(d.windowIds[15]);
  if (d.windowIds[14] !== 0xff) FreeAndDestroyMonPicSprite(d.windowIds[14]);
  sAreaPage = undefined;
  return 0;
}

/** The area page while it's up (for `__test.pokedexArea()`). */
export function pokedexAreaProbe():
  | {
      species: number;
      /** Task_DexScreen_ShowMonPage's input state (9) and no fade */
      ready: boolean;
      kantoMapVoff: number;
      unlockedSeviiAreas: number;
      /** How many markers CreatePokedexAreaMarkers made, and the markers sprite's position and visibility */
      markers: number;
      markersSprite?: { x: number; y: number; invisible: boolean };
      /** "AREA UNKNOWN" was drawn over the map */
      areaUnknown: boolean;
      /** The TYPE_*s whose icons were blitted, and the types window's drawn pixels */
      types: number[];
      typePixels: number;
      /** Pixels drawn in the mon icon window */
      iconPixels: number;
      /** The silhouettes: the mon's (matrix 2) and the player's (matrix 1), with their OAM and matrix */
      silhouettes: { x: number; y: number; y2: number; paletteNum: number; affineMode: number; matrixNum: number; scale: [number, number]; priority: number }[];
    }
  | undefined {
  const d = sPokedexScreenData;
  if (!d || !sAreaPage) return undefined;
  const task = gTasks[d.taskId];
  const markersSpriteId = pokedexAreaMarkersSprite(d.areaMarkersTaskId);
  const markersSprite = markersSpriteId !== undefined ? gSprites[markersSpriteId] : undefined;
  const silhouettes = [d.windowIds[14], d.windowIds[15]]
    .filter((id) => id !== 0xff)
    .map((id) => {
      const s = gSprites[id];
      const m = gOamMatrices[s.oam.matrixNum];
      return { x: s.x, y: s.y, y2: s.y2, paletteNum: s.oam.paletteNum, affineMode: s.oam.affineMode, matrixNum: s.oam.matrixNum, scale: [m.a, m.d] as [number, number], priority: s.oam.priority };
    });
  return {
    species: sAreaPage.species,
    ready: task.isActive && task.func.name === 'Task_DexScreen_ShowMonPage' && d.state === 9 && !gPaletteFade.active,
    kantoMapVoff: sAreaPage.kantoMapVoff,
    unlockedSeviiAreas: sAreaPage.unlockedSeviiAreas,
    markers: GetNumPokedexAreaMarkers(d.areaMarkersTaskId),
    markersSprite: markersSprite && { x: markersSprite.x, y: markersSprite.y, invisible: markersSprite.invisible },
    areaUnknown: sAreaPage.areaUnknown,
    types: sAreaPage.types,
    typePixels: windowPixels(d.windowIds[12]),
    iconPixels: windowPixels(d.windowIds[11]),
    silhouettes,
  };
}

/** Non-zero pixels in a window's buffer */
function windowPixels(windowId: number): number {
  const td = gWindows[windowId]?.tileData;
  if (!td) return 0;
  let n = 0;
  for (const byte of td) n += (byte & 0xf ? 1 : 0) + (byte >> 4 ? 1 : 0);
  return n;
}
