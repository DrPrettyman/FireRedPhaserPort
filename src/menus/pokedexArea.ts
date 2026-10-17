// pokedex_area_markers.c: the red markers on the Pokédex area page's map. All the markers together are one
// sprite whose subsprites are the markers (GetSpeciesPokedexAreaMarkers, menus/wildPokemonArea.ts, picks
// them). The sprite is an OBJ window: inside it BG1, filled with tile 0x00F from char base 0 (a solid tile of the
// area map's graphics), shows through, alpha-blended (12/8) over the map below.
// The area page (DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources in pokedex_screen.c) is
// added here by W-dexarea unit 2.

import { CopyBgTilemapBufferToVram, FillBgTilemapBufferRect_Palette0, HideBg, SetBgAttribute, ShowBg, BG_ATTR_CHARBASEINDEX } from '../gba/bg';
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
import { LoadPalette, OBJ_PLTT_ID } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeSpriteTilesByTag,
  gDummySpriteTemplate,
  gSprites,
  LoadCompressedSpriteSheet,
  SetSubspriteTables,
  ST_OAM_OBJ_WINDOW,
  TAG_NONE,
  type Subsprite,
  type SubspriteTable,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import { menusData } from './data';
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
