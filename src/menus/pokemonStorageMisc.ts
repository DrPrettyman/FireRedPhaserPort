// pokemon_storage_system_misc.c: moving several Pokémon at once (MultiMove_*: the selected icons are drawn
// into an 8bpp window on BG0, which then moves as one) and the MOVE ITEMS option's held-item icons and item
// info window. UnkUtil (functionally unused in the C) isn't ported.

import { K } from '../battle/constants';
import { affineAnimTable } from '../battle/gfx';
import { state } from '../battle/env';
import { gSineTable } from '../battle/trig';
import {
  BG_ATTR_BASETILE,
  BG_ATTR_PALETTEMODE,
  BG_COORD_ADD,
  BG_COORD_SET,
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgAttribute,
  HideBg,
  LoadBgTiles,
  SetBgAttribute,
  ShowBg,
  WriteSequenceToBgTilemapBuffer,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { ClearGpuRegBits, OBJ_VRAM0, REG_OFFSET_BG0CNT, RGB_WHITE, SetGpuRegBits, vram } from '../gba/hw';
import { GetTextWindowPalette, ScheduleBgCopyTilemapToVram } from '../gba/menu';
import { BG_PLTT_ID, BlendPalettes, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  AllocSpritePalette,
  CreateSprite,
  gDummySpriteAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  LoadSpriteSheet,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { AddTextPrinter, AddWindow, COPYWIN_FULL, COPYWIN_GFX, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, gWindows, PIXEL_FILL, PutWindowTilemap, WINDOW_NONE, GetFontAttribute, FONTATTR_COLOR_FOREGROUND, FONTATTR_COLOR_BACKGROUND, FONTATTR_COLOR_SHADOW, type WindowTemplate } from '../gba/window';
import { ItemId_GetDescription, ItemId_GetName } from './common';
import { GetItemIconGfxSymbol } from './itemMenuIcons';
import { menusData } from './data';
import { GetMonIconPtr } from './pokemonIcon';
import { gPlayerParty, gStorage, SpeciesOrEgg } from './pokemonStorage';
import { DoMonPlaceChange, GetCursorBoxColumnAndRow, InitMultiMonPlaceChange, SetCursorPriorityTo1, StartCursorAnim, UpdateCursorPos } from './pokemonStorageCursor';
import { CreateBoxMonIconAtPos, DestroyBoxMonIconAtPosition, SetBoxMonIconObjMode, SetPartyMonIconObjMode } from './pokemonStorageGraphics';
import type { BoxPokemon } from '../state/PokemonStorage';

// ------------------------------------------------------------------ moving multiple Pokémon

interface MultiMove {
  funcId: number;
  state: number;
  fromColumn: number;
  fromRow: number;
  toColumn: number;
  toRow: number;
  cursorColumn: number;
  cursorRow: number;
  minColumn: number;
  minRow: number;
  columnsTotal: number;
  rowsTotal: number;
  bgX: number;
  bgY: number;
  bgMoveSteps: number;
  boxMons: (BoxPokemon | null)[];
}

let sMultiMove: MultiMove | null = null;

const sWindowTemplate_MultiMove: WindowTemplate = { bg: 0, tilemapLeft: 10, tilemapTop: 3, width: 20, height: 18, paletteNum: 9, baseBlock: 0x00a };

/** AddWindow8Bit: a window whose tile buffer holds 8bpp tiles. */
function AddWindow8Bit(template: WindowTemplate): number {
  const windowId = AddWindow(template);
  if (windowId === WINDOW_NONE) return WINDOW_NONE;
  gWindows[windowId].tileData = new Uint8Array(0x40 * template.width * template.height);
  return windowId;
}

function FillWindowPixelBuffer8Bit(windowId: number, fillValue: number): void {
  gWindows[windowId].tileData!.fill(fillValue);
}

const px8 = (x: number, y: number, mulY: number) => (x & 7) + ((x >> 3) << 6) + (((y >> 3) * mulY) << 6) + ((y & 7) << 3);

function FillWindowPixelRect8Bit(windowId: number, fillValue: number, x: number, y: number, width: number, height: number): void {
  const w = gWindows[windowId];
  const pw = 8 * w.window.width;
  const ph = 8 * w.window.height;
  const xEnd = Math.min(x + width, pw);
  const yEnd = Math.min(y + height, ph);
  const mulY = (pw + (pw & 7)) >> 3;
  for (let ly = y; ly < yEnd; ly++) for (let lx = x; lx < xEnd; lx++) w.tileData![px8(lx, ly, mulY)] = fillValue;
}

/** BlitBitmapRectToWindow4BitTo8Bit (BlitBitmapRect4BitTo8Bit with colorKey 0) */
function BlitBitmapRectToWindow4BitTo8Bit(windowId: number, pixels: Uint8Array, srcX: number, srcY: number, srcWidth: number, _srcHeight: number, destX: number, destY: number, rectWidth: number, rectHeight: number, paletteNum: number): void {
  const w = gWindows[windowId];
  const dw = 8 * w.window.width;
  const dh = 8 * w.window.height;
  const palOffsetBits = (paletteNum & 0xf) << 4;
  const xEnd = dw - destX < rectWidth ? dw - destX + srcX : rectWidth + srcX;
  const yEnd = dh - destY < rectHeight ? srcY + dh - destY : srcY + rectHeight;
  const mulSrcY = (srcWidth + (srcWidth & 7)) >> 3;
  const mulDstY = (dw + (dw & 7)) >> 3;
  const src4 = (x: number, y: number) => ((x >> 1) & 3) + ((x >> 3) << 5) + (((y >> 3) * mulSrcY) << 5) + ((y & 7) << 2);
  for (let sy = srcY, dy = destY; sy < yEnd; sy++, dy++) {
    let s = src4(srcX, sy);
    for (let sx = srcX, dx = destX; sx < xEnd; sx++, dx++) {
      if (sx & 1) {
        if ((pixels[s] & 0xf0) !== 0) w.tileData![px8(dx, dy, mulDstY)] = palOffsetBits + (pixels[s] >> 4);
      } else {
        s = src4(sx, sy);
        if ((pixels[s] & 0xf) !== 0) w.tileData![px8(dx, dy, mulDstY)] = palOffsetBits + (pixels[s] & 0xf);
      }
    }
  }
}

function CopyWindowToVram8Bit(windowId: number, mode: number): void {
  const w = gWindows[windowId];
  const size = 0x40 * w.window.width * w.window.height;
  if (mode === COPYWIN_GFX || mode === COPYWIN_FULL) LoadBgTiles(w.window.bg, w.tileData!, size, w.window.baseBlock);
  if (mode !== COPYWIN_GFX) CopyBgTilemapBufferToVram(w.window.bg);
}

/** LoadMonIconPalettesAt */
function LoadMonIconPalettesAt(offset: number): void {
  if (offset <= BG_PLTT_ID(16 - 6)) {
    for (let i = 0; i < 6; i++) {
      LoadPalette(i < 3 ? gfx16('gMonIconPalettes').subarray(i * 16, i * 16 + 16) : new Uint16Array(16), offset, PLTT_SIZE_4BPP);
      offset += 16;
    }
  }
}

/** GetValidMonIconPalIndex */
function GetValidMonIconPalIndex(species: number): number {
  if (species > K.NUM_SPECIES) species = K.SPECIES_NONE;
  return menusData.monIconPaletteIndices[species] ?? 0;
}

export function MultiMove_Init(): boolean {
  sMultiMove = {
    funcId: 0,
    state: 0,
    fromColumn: 0,
    fromRow: 0,
    toColumn: 0,
    toRow: 0,
    cursorColumn: 0,
    cursorRow: 0,
    minColumn: 0,
    minRow: 0,
    columnsTotal: 0,
    rowsTotal: 0,
    bgX: 0,
    bgY: 0,
    bgMoveSteps: 0,
    boxMons: Array(K.IN_BOX_COUNT).fill(null),
  };
  gStorage.multiMoveWindowId = AddWindow8Bit(sWindowTemplate_MultiMove);
  if (gStorage.multiMoveWindowId !== WINDOW_NONE) {
    FillWindowPixelBuffer(gStorage.multiMoveWindowId, PIXEL_FILL(0));
    return true;
  }
  return false;
}

export function MultiMove_Free(): void {
  sMultiMove = null;
}

export function MultiMove_SetFunction(funcId: number): void {
  sMultiMove!.funcId = funcId;
  sMultiMove!.state = 0;
}

export function MultiMove_RunFunction(): boolean {
  switch (sMultiMove!.funcId) {
    case K.MULTIMOVE_START:
      return MultiMove_Function_Start();
    case K.MULTIMOVE_SINGLE:
      return MultiMove_Function_Single();
    case K.MULTIMOVE_CHANGE_SELECTION:
      return MultiMove_Function_ChangeSelection();
    case K.MULTIMOVE_GRAB_SELECTION:
      return MultiMove_Function_GrabSelection();
    case K.MULTIMOVE_MOVE_MONS:
      return MultiMove_Function_MoveMons();
    case K.MULTIMOVE_PLACE_MONS:
      return MultiMove_Function_PlaceMons();
  }
  return false;
}

function MultiMove_Function_Start(): boolean {
  const m = sMultiMove!;
  switch (m.state) {
    case 0:
      HideBg(0);
      LoadMonIconPalettesAt(BG_PLTT_ID(8));
      m.state++;
      break;
    case 1: {
      const { column, row } = GetCursorBoxColumnAndRow();
      m.fromColumn = column;
      m.fromRow = row;
      m.toColumn = m.fromColumn;
      m.toRow = m.fromRow;
      ChangeBgX(0, -1024, BG_COORD_SET);
      ChangeBgY(0, -1024, BG_COORD_SET);
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 32, 32);
      FillWindowPixelBuffer8Bit(gStorage.multiMoveWindowId, PIXEL_FILL(0));
      MultiMove_SetIconToBg(m.fromColumn, m.fromRow);
      SetBgAttribute(0, BG_ATTR_PALETTEMODE, 1);
      PutWindowTilemap(gStorage.multiMoveWindowId);
      CopyWindowToVram8Bit(gStorage.multiMoveWindowId, COPYWIN_FULL);
      BlendPalettes(0x3f00, 8, RGB_WHITE);
      StartCursorAnim(K.CURSOR_ANIM_OPEN);
      SetGpuRegBits(REG_OFFSET_BG0CNT, 0x80); // BGCNT_256COLOR
      m.state++;
      break;
    }
    case 2:
      ShowBg(0);
      return false;
  }
  return true;
}

function MultiMove_Function_Single(): boolean {
  const m = sMultiMove!;
  switch (m.state) {
    case 0:
      HideBg(0);
      m.state++;
      break;
    case 1:
      MultiMove_ResetBg();
      StartCursorAnim(K.CURSOR_ANIM_BOUNCE);
      m.state++;
      break;
    case 2:
      SetCursorPriorityTo1();
      LoadPalette(GetTextWindowPalette(3), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
      ShowBg(0);
      return false;
  }
  return true;
}

function MultiMove_Function_ChangeSelection(): boolean {
  const m = sMultiMove!;
  switch (m.state) {
    case 0:
      if (!UpdateCursorPos()) {
        const { column, row } = GetCursorBoxColumnAndRow();
        m.cursorColumn = column;
        m.cursorRow = row;
        MultiMove_UpdateSelectedIcons();
        m.toColumn = m.cursorColumn;
        m.toRow = m.cursorRow;
        CopyWindowToVram8Bit(gStorage.multiMoveWindowId, COPYWIN_GFX);
        m.state++;
      }
      break;
    case 1:
      return false; // IsDma3ManagerBusyWithBgCopy
  }
  return true;
}

function MultiMove_Function_GrabSelection(): boolean {
  const m = sMultiMove!;
  switch (m.state) {
    case 0:
      MultiMove_GetMonsFromSelection();
      MultiMove_RemoveMonsFromBox();
      InitMultiMonPlaceChange(false);
      m.state++;
      break;
    case 1:
      if (!DoMonPlaceChange()) {
        StartCursorAnim(K.CURSOR_ANIM_FIST);
        MultiMove_InitBg(0, 256, 8);
        InitMultiMonPlaceChange(true);
        m.state++;
      }
      break;
    case 2: {
      const movingBg = MultiMove_UpdateBg();
      const movingMon = DoMonPlaceChange();
      if (!movingBg && !movingMon) return false;
      break;
    }
  }
  return true;
}

function MultiMove_Function_MoveMons(): boolean {
  const movingCursor = UpdateCursorPos();
  const movingBg = MultiMove_UpdateBg();
  return movingCursor || movingBg !== 0;
}

function MultiMove_Function_PlaceMons(): boolean {
  const m = sMultiMove!;
  switch (m.state) {
    case 0:
      MultiMove_SetPlacedMonData();
      MultiMove_InitBg(0, -256 & 0xffff, 8);
      InitMultiMonPlaceChange(false);
      m.state++;
      break;
    case 1:
      if (!DoMonPlaceChange() && !MultiMove_UpdateBg()) {
        MultiMove_CreatePlacedMonIcons();
        StartCursorAnim(K.CURSOR_ANIM_OPEN);
        InitMultiMonPlaceChange(true);
        HideBg(0);
        m.state++;
      }
      break;
    case 2:
      if (!DoMonPlaceChange()) {
        StartCursorAnim(K.CURSOR_ANIM_BOUNCE);
        MultiMove_ResetBg();
        m.state++;
      }
      break;
    case 3:
      LoadPalette(GetTextWindowPalette(3), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
      SetCursorPriorityTo1();
      ShowBg(0);
      return false;
  }
  return true;
}

/** MultiMove_TryMoveGroup: dir 0 up, 1 down, 2 left, 3 right. */
export function MultiMove_TryMoveGroup(dir: number): boolean {
  const m = sMultiMove!;
  switch (dir) {
    case 0: // up
      if (m.minRow === 0) return false;
      m.minRow--;
      MultiMove_InitBg(0, 1024, 6);
      break;
    case 1: // down
      if (m.minRow + m.rowsTotal >= 5) return false;
      m.minRow++;
      MultiMove_InitBg(0, -1024 & 0xffff, 6);
      break;
    case 2: // left
      if (m.minColumn === 0) return false;
      m.minColumn--;
      MultiMove_InitBg(1024, 0, 6);
      break;
    case 3: // right
      if (m.minColumn + m.columnsTotal > 5) return false;
      m.minColumn++;
      MultiMove_InitBg(-1024 & 0xffff, 0, 6);
      break;
  }
  return true;
}

function MultiMove_UpdateSelectedIcons(): void {
  const m = sMultiMove!;
  const columnChange = Math.abs(m.fromColumn - m.cursorColumn) - Math.abs(m.fromColumn - m.toColumn);
  const rowChange = Math.abs(m.fromRow - m.cursorRow) - Math.abs(m.fromRow - m.toRow);

  if (columnChange > 0) MultiMove_SelectColumn(m.cursorColumn, m.fromRow, m.toRow);
  if (columnChange < 0) {
    MultiMove_DeselectColumn(m.toColumn, m.fromRow, m.toRow);
    MultiMove_SelectColumn(m.cursorColumn, m.fromRow, m.toRow);
  }
  if (rowChange > 0) MultiMove_SelectRow(m.cursorRow, m.fromColumn, m.toColumn);
  if (rowChange < 0) {
    MultiMove_DeselectRow(m.toRow, m.fromColumn, m.toColumn);
    MultiMove_SelectRow(m.cursorRow, m.fromColumn, m.toColumn);
  }
}

function MultiMove_SelectColumn(column: number, minRow: number, maxRow: number): void {
  if (minRow > maxRow) [minRow, maxRow] = [maxRow, minRow];
  while (minRow <= maxRow) MultiMove_SetIconToBg(column, minRow++);
}

function MultiMove_SelectRow(row: number, minColumn: number, maxColumn: number): void {
  if (minColumn > maxColumn) [minColumn, maxColumn] = [maxColumn, minColumn];
  while (minColumn <= maxColumn) MultiMove_SetIconToBg(minColumn++, row);
}

function MultiMove_DeselectColumn(column: number, minRow: number, maxRow: number): void {
  if (minRow > maxRow) [minRow, maxRow] = [maxRow, minRow];
  while (minRow <= maxRow) MultiMove_ClearIconFromBg(column, minRow++);
}

function MultiMove_DeselectRow(row: number, minColumn: number, maxColumn: number): void {
  if (minColumn > maxColumn) [minColumn, maxColumn] = [maxColumn, minColumn];
  while (minColumn <= maxColumn) MultiMove_ClearIconFromBg(minColumn++, row);
}

function MultiMove_SetIconToBg(x: number, y: number): void {
  const position = x + K.IN_BOX_COLUMNS * y;
  const mon = state.storage.getBoxedMon(state.storage.getCurrentBox(), position);
  const species = SpeciesOrEgg(mon);
  if (species !== K.SPECIES_NONE) {
    const iconGfx = GetMonIconPtr(species, mon!.personality, true);
    const palNum = GetValidMonIconPalIndex(species) + 8;
    BlitBitmapRectToWindow4BitTo8Bit(gStorage.multiMoveWindowId, iconGfx, 0, 0, 32, 32, 24 * x, 24 * y, 32, 32, palNum);
  }
}

function MultiMove_ClearIconFromBg(x: number, y: number): void {
  const position = x + K.IN_BOX_COLUMNS * y;
  if (SpeciesOrEgg(state.storage.getBoxedMon(state.storage.getCurrentBox(), position)) !== K.SPECIES_NONE) {
    FillWindowPixelRect8Bit(gStorage.multiMoveWindowId, PIXEL_FILL(0), 24 * x, 24 * y, 32, 32);
  }
}

/** MultiMove_InitBg: bgX / bgY are u16 offsets (in 1/256 px) added every step. */
function MultiMove_InitBg(bgX: number, bgY: number, duration: number): void {
  const m = sMultiMove!;
  m.bgX = bgX & 0xffff;
  m.bgY = bgY & 0xffff;
  m.bgMoveSteps = duration;
}

function MultiMove_UpdateBg(): number {
  const m = sMultiMove!;
  if (m.bgMoveSteps !== 0) {
    ChangeBgX(0, m.bgX, BG_COORD_ADD);
    ChangeBgY(0, m.bgY, BG_COORD_ADD);
    m.bgMoveSteps--;
  }
  return m.bgMoveSteps;
}

function MultiMove_GetMonsFromSelection(): void {
  const m = sMultiMove!;
  m.minColumn = Math.min(m.fromColumn, m.toColumn);
  m.minRow = Math.min(m.fromRow, m.toRow);
  m.columnsTotal = Math.abs(m.fromColumn - m.toColumn) + 1;
  m.rowsTotal = Math.abs(m.fromRow - m.toRow) + 1;
  const boxId = state.storage.getCurrentBox();
  let monArrayId = 0;
  const columnCount = m.minColumn + m.columnsTotal;
  const rowCount = m.minRow + m.rowsTotal;
  for (let i = m.minRow; i < rowCount; i++) {
    let boxPosition = K.IN_BOX_COLUMNS * i + m.minColumn;
    for (let j = m.minColumn; j < columnCount; j++) {
      m.boxMons[monArrayId] = state.storage.copyBoxMonAt(boxId, boxPosition);
      monArrayId++;
      boxPosition++;
    }
  }
}

function MultiMove_RemoveMonsFromBox(): void {
  const m = sMultiMove!;
  const columnCount = m.minColumn + m.columnsTotal;
  const rowCount = m.minRow + m.rowsTotal;
  const boxId = state.storage.getCurrentBox();
  for (let i = m.minRow; i < rowCount; i++) {
    let boxPosition = K.IN_BOX_COLUMNS * i + m.minColumn;
    for (let j = m.minColumn; j < columnCount; j++) {
      DestroyBoxMonIconAtPosition(boxPosition);
      state.storage.zeroBoxMonAt(boxId, boxPosition);
      boxPosition++;
    }
  }
}

function MultiMove_CreatePlacedMonIcons(): void {
  const m = sMultiMove!;
  const columnCount = m.minColumn + m.columnsTotal;
  const rowCount = m.minRow + m.rowsTotal;
  let monArrayId = 0;
  for (let i = m.minRow; i < rowCount; i++) {
    let boxPosition = K.IN_BOX_COLUMNS * i + m.minColumn;
    for (let j = m.minColumn; j < columnCount; j++) {
      if (m.boxMons[monArrayId]) CreateBoxMonIconAtPos(boxPosition); // MON_DATA_SANITY_HAS_SPECIES
      monArrayId++;
      boxPosition++;
    }
  }
}

function MultiMove_SetPlacedMonData(): void {
  const m = sMultiMove!;
  const columnCount = m.minColumn + m.columnsTotal;
  const rowCount = m.minRow + m.rowsTotal;
  const boxId = state.storage.getCurrentBox();
  let monArrayId = 0;
  for (let i = m.minRow; i < rowCount; i++) {
    let boxPosition = K.IN_BOX_COLUMNS * i + m.minColumn;
    for (let j = m.minColumn; j < columnCount; j++) {
      const mon = m.boxMons[monArrayId];
      if (mon) state.storage.setBoxMonAt(boxId, boxPosition, mon);
      boxPosition++;
      monArrayId++;
    }
  }
}

function MultiMove_ResetBg(): void {
  ChangeBgX(0, 0, BG_COORD_SET);
  ChangeBgY(0, 0, BG_COORD_SET);
  SetBgAttribute(0, BG_ATTR_PALETTEMODE, 0);
  ClearGpuRegBits(REG_OFFSET_BG0CNT, 0x80); // BGCNT_256COLOR
  FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 32, 32);
  CopyBgTilemapBufferToVram(0);
}

export function MultiMove_GetOriginPosition(): number {
  return K.IN_BOX_COLUMNS * sMultiMove!.fromRow + sMultiMove!.fromColumn;
}

export function MultiMove_CanPlaceSelection(): boolean {
  const m = sMultiMove!;
  const columnCount = m.minColumn + m.columnsTotal;
  const rowCount = m.minRow + m.rowsTotal;
  let monArrayId = 0;
  for (let i = m.minRow; i < rowCount; i++) {
    let boxPosition = K.IN_BOX_COLUMNS * i + m.minColumn;
    for (let j = m.minColumn; j < columnCount; j++) {
      if (m.boxMons[monArrayId] && state.storage.getCurrentBoxMonData(boxPosition, 'species')) return false;
      monArrayId++;
      boxPosition++;
    }
  }
  return true;
}

// ------------------------------------------------------------------ held items (MOVE ITEMS)

/** struct PokeStorageItemIcon */
export interface PokeStorageItemIcon {
  sprite: Sprite;
  tilesAddr: number;
  palIndex: number;
  cursorArea: number;
  cursorPos: number;
  active: boolean;
}

// IDs for the item icon sprite callbacks
const ITEM_CB_WAIT_ANIM = 0;
const ITEM_CB_TO_HAND = 1;
const ITEM_CB_TO_MON = 2;
const ITEM_CB_SWAP_TO_HAND = 3;
const ITEM_CB_SWAP_TO_MON = 4;
const ITEM_CB_HIDE_PARTY = 7;

const MAX_ITEM_ICONS = 3;

const sOamData_ItemIcon = oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 });

function sSpriteTemplate_ItemIcon(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_ITEM_ICON_0,
    paletteTag: K.PALTAG_ITEM_ICON_0,
    oam: sOamData_ItemIcon,
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: affineAnimTable('pokemon_storage_system_misc.c', 'sAffineAnims_ItemIcon'),
    callback: SpriteCallbackDummy,
  };
}

export function CreateItemIconSprites(): void {
  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    const sheetData = new Uint8Array(0x200); // sItemIconGfxBuffer
    const spriteTemplate = sSpriteTemplate_ItemIcon();
    for (let i = 0; i < MAX_ITEM_ICONS; i++) {
      const tag = K.GFXTAG_ITEM_ICON_0 + i;
      LoadSpriteSheet({ data: sheetData, size: 0x200, tag });
      const palIndex = AllocSpritePalette(K.PALTAG_ITEM_ICON_0 + i);
      spriteTemplate.tileTag = tag;
      spriteTemplate.paletteTag = K.PALTAG_ITEM_ICON_0 + i;
      const spriteId = CreateSprite({ ...spriteTemplate }, 0, 0, 11);
      gStorage.itemIcons[i] = {
        sprite: gSprites[spriteId],
        tilesAddr: GetSpriteTileStartByTag(tag) * 32 + OBJ_VRAM0,
        palIndex: OBJ_PLTT_ID(palIndex),
        cursorArea: 0,
        cursorPos: 0,
        active: false,
      };
      gStorage.itemIcons[i].sprite.invisible = true;
    }
  }
  gStorage.movingItemId = K.ITEM_NONE;
}

function HeldItemAt(cursorArea: number, cursorPos: number): number | undefined {
  switch (cursorArea) {
    case K.CURSOR_AREA_IN_BOX: {
      const mon = state.storage.getBoxedMon(state.storage.getCurrentBox(), cursorPos);
      return mon ? mon.heldItem : undefined;
    }
    case K.CURSOR_AREA_IN_PARTY: {
      const mon = gPlayerParty[cursorPos];
      return mon && mon.species ? mon.heldItem : undefined;
    }
  }
  return undefined;
}

function SetHeldItemAt(cursorArea: number, cursorPos: number, item: number): void {
  if (cursorArea === K.CURSOR_AREA_IN_BOX) state.storage.setCurrentBoxMonData(cursorPos, 'heldItem', item);
  else {
    const mon = gPlayerParty[cursorPos];
    if (mon) mon.heldItem = item;
  }
}

export function TryLoadItemIconAtPos(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS || IsItemIconAtPosition(cursorArea, cursorPos)) return;
  const heldItem = HeldItemAt(cursorArea, cursorPos);
  if (heldItem === undefined) return;
  if (heldItem !== K.ITEM_NONE) {
    const id = GetNewItemIconIdx();
    SetItemIconPosition(id, cursorArea, cursorPos);
    LoadItemIconGfx(id, heldItem);
    SetItemIconAffineAnim(id, K.ITEM_ANIM_APPEAR);
    SetItemIconActive(id, true);
  }
}

export function TryHideItemIconAtPos(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  const id = GetItemIconIdxByPosition(cursorArea, cursorPos);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_DISAPPEAR);
  SetItemIconCallback(id, ITEM_CB_WAIT_ANIM, cursorArea, cursorPos);
}

export function Item_FromMonToMoving(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  const id = GetItemIconIdxByPosition(cursorArea, cursorPos);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_PICK_UP);
  SetItemIconCallback(id, ITEM_CB_TO_HAND, cursorArea, cursorPos);
  SetItemIconPosition(id, K.CURSOR_AREA_IN_HAND, 0);
  SetHeldItemAt(cursorArea, cursorPos, K.ITEM_NONE);
  if (cursorArea === K.CURSOR_AREA_IN_BOX) SetBoxMonIconObjMode(cursorPos, ST_OAM_OBJ_BLEND);
  else SetPartyMonIconObjMode(cursorPos, ST_OAM_OBJ_BLEND);
  gStorage.movingItemId = gStorage.displayMonItemId;
}

export function InitItemIconInCursor(item: number): void {
  const id = GetNewItemIconIdx();
  LoadItemIconGfx(id, item);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_LARGE);
  SetItemIconCallback(id, ITEM_CB_TO_HAND, 0, 0);
  SetItemIconPosition(id, K.CURSOR_AREA_IN_HAND, 0);
  SetItemIconActive(id, true);
  gStorage.movingItemId = item;
}

export function Item_SwitchMonsWithMoving(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  let id = GetItemIconIdxByPosition(cursorArea, cursorPos);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_PICK_UP);
  SetItemIconCallback(id, ITEM_CB_SWAP_TO_HAND, K.CURSOR_AREA_IN_HAND, 0);
  const item = HeldItemAt(cursorArea, cursorPos) ?? K.ITEM_NONE;
  SetHeldItemAt(cursorArea, cursorPos, gStorage.movingItemId);
  gStorage.movingItemId = item;

  id = GetItemIconIdxByPosition(2, 0);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_PUT_DOWN);
  SetItemIconCallback(id, ITEM_CB_SWAP_TO_MON, cursorArea, cursorPos);
}

export function Item_GiveMovingToMon(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  const id = GetItemIconIdxByPosition(2, 0);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_PUT_DOWN);
  SetItemIconCallback(id, ITEM_CB_TO_MON, cursorArea, cursorPos);
  SetHeldItemAt(cursorArea, cursorPos, gStorage.movingItemId);
  if (cursorArea === K.CURSOR_AREA_IN_BOX) SetBoxMonIconObjMode(cursorPos, ST_OAM_OBJ_NORMAL);
  else SetPartyMonIconObjMode(cursorPos, ST_OAM_OBJ_NORMAL);
}

export function Item_TakeMons(cursorArea: number, cursorPos: number): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  const id = GetItemIconIdxByPosition(cursorArea, cursorPos);
  SetItemIconAffineAnim(id, K.ITEM_ANIM_DISAPPEAR);
  SetItemIconCallback(id, ITEM_CB_WAIT_ANIM, cursorArea, cursorPos);
  SetHeldItemAt(cursorArea, cursorPos, K.ITEM_NONE);
  if (cursorArea === K.CURSOR_AREA_IN_BOX) SetBoxMonIconObjMode(cursorPos, ST_OAM_OBJ_BLEND);
  else SetPartyMonIconObjMode(cursorPos, ST_OAM_OBJ_BLEND);
}

export function MoveItemFromCursorToBag(): void {
  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    const id = GetItemIconIdxByPosition(K.CURSOR_AREA_IN_HAND, 0);
    SetItemIconAffineAnim(id, K.ITEM_ANIM_PUT_AWAY);
    SetItemIconCallback(id, ITEM_CB_WAIT_ANIM, 2, 0);
  }
}

/** MoveHeldItemWithPartyMenu: a held item shown in the party box slides up with it as the box closes. */
export function MoveHeldItemWithPartyMenu(): void {
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return;
  for (let i = 0; i < MAX_ITEM_ICONS; i++) {
    if (gStorage.itemIcons[i].active && gStorage.itemIcons[i].cursorArea === K.CURSOR_AREA_IN_PARTY) SetItemIconCallback(i, ITEM_CB_HIDE_PARTY, 2, 0);
  }
}

export function IsItemIconAnimActive(): boolean {
  for (let i = 0; i < MAX_ITEM_ICONS; i++) {
    const icon = gStorage.itemIcons[i];
    if (icon?.active) {
      if (!icon.sprite.affineAnimEnded && icon.sprite.affineAnimBeginning) return true;
      if (icon.sprite.callback !== SpriteCallbackDummy && icon.sprite.callback !== SpriteCB_ItemIcon_SetPosToCursor) return true;
    }
  }
  return false;
}

export function IsActiveItemMoving(): boolean {
  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    for (let i = 0; i < MAX_ITEM_ICONS; i++) {
      if (gStorage.itemIcons[i]?.active && gStorage.itemIcons[i].cursorArea === K.CURSOR_AREA_BOX_TITLE) return true;
    }
  }
  return false;
}

export function GetMovingItemName(): number[] {
  return ItemId_GetName(gStorage.movingItemId);
}

export function GetMovingItem(): number {
  return gStorage.movingItemId;
}

function GetNewItemIconIdx(): number {
  for (let i = 0; i < MAX_ITEM_ICONS; i++) {
    if (!gStorage.itemIcons[i].active) {
      gStorage.itemIcons[i].active = true;
      return i;
    }
  }
  return MAX_ITEM_ICONS;
}

function IsItemIconAtPosition(cursorArea: number, cursorPos: number): boolean {
  return GetItemIconIdxByPosition(cursorArea, cursorPos) !== MAX_ITEM_ICONS;
}

function GetItemIconIdxByPosition(cursorArea: number, cursorPos: number): number {
  for (let i = 0; i < MAX_ITEM_ICONS; i++) {
    const icon = gStorage.itemIcons[i];
    if (icon.active && icon.cursorArea === cursorArea && icon.cursorPos === cursorPos) return i;
  }
  return MAX_ITEM_ICONS;
}

function GetItemIconIdxBySprite(sprite: Sprite): number {
  for (let i = 0; i < MAX_ITEM_ICONS; i++) if (gStorage.itemIcons[i].active && gStorage.itemIcons[i].sprite === sprite) return i;
  return MAX_ITEM_ICONS;
}

function SetItemIconPosition(id: number, cursorArea: number, cursorPos: number): void {
  if (id >= MAX_ITEM_ICONS) return;
  const icon = gStorage.itemIcons[id];
  switch (cursorArea) {
    case K.CURSOR_AREA_IN_BOX: {
      const row = cursorPos % K.IN_BOX_COLUMNS;
      const column = Math.trunc(cursorPos / K.IN_BOX_COLUMNS);
      icon.sprite.x = 24 * row + 112;
      icon.sprite.y = 24 * column + 56;
      icon.sprite.oam.priority = 2;
      break;
    }
    case K.CURSOR_AREA_IN_PARTY:
      if (cursorPos === 0) {
        icon.sprite.x = 116;
        icon.sprite.y = 76;
      } else {
        icon.sprite.x = 164;
        icon.sprite.y = 24 * (cursorPos - 1) + 28;
      }
      icon.sprite.oam.priority = 1;
      break;
  }
  icon.cursorArea = cursorArea;
  icon.cursorPos = cursorPos;
}

/** LoadItemIconGfx: the 24x24 icon copied into the top-left of a 32x32 sprite. */
function LoadItemIconGfx(id: number, itemId: number): void {
  if (id >= MAX_ITEM_ICONS) return;
  const icon = gStorage.itemIcons[id];
  gStorage.itemIconBuffer.fill(0);
  const tiles = gfx(GetItemIconGfxSymbol(itemId, 0));
  gStorage.tileBuffer.fill(0);
  gStorage.tileBuffer.set(tiles.subarray(0, Math.min(tiles.length, gStorage.tileBuffer.length)));
  for (let i = 0; i < 3; i++) gStorage.itemIconBuffer.set(gStorage.tileBuffer.subarray(i * 0x60, i * 0x60 + 0x60), i * 0x80);
  vram.set(gStorage.itemIconBuffer, icon.tilesAddr);
  LoadPalette(gfx16(GetItemIconGfxSymbol(itemId, 1)), icon.palIndex, PLTT_SIZE_4BPP);
}

function SetItemIconAffineAnim(id: number, animNum: number): void {
  if (id >= MAX_ITEM_ICONS) return;
  StartSpriteAffineAnim(gStorage.itemIcons[id].sprite, animNum);
}

const sItemIconId = 0;
const sState = 0;
const sCursorArea = 6;
const sCursorPos = 7;

function SetItemIconCallback(id: number, callbackId: number, cursorArea: number, cursorPos: number): void {
  if (id >= MAX_ITEM_ICONS) return;
  const s = gStorage.itemIcons[id].sprite;
  switch (callbackId) {
    case ITEM_CB_WAIT_ANIM:
      s.data[sItemIconId] = id;
      s.callback = SpriteCB_ItemIcon_WaitAnim;
      break;
    case ITEM_CB_TO_HAND:
      s.data[sState] = 0;
      s.callback = SpriteCB_ItemIcon_ToHand;
      break;
    case ITEM_CB_TO_MON:
      s.data[sState] = 0;
      s.data[sCursorArea] = cursorArea;
      s.data[sCursorPos] = cursorPos;
      s.callback = SpriteCB_ItemIcon_ToMon;
      break;
    case ITEM_CB_SWAP_TO_HAND:
      s.data[sState] = 0;
      s.callback = SpriteCB_ItemIcon_SwapToHand;
      s.data[sCursorArea] = cursorArea;
      s.data[sCursorPos] = cursorPos;
      break;
    case ITEM_CB_SWAP_TO_MON:
      s.data[sState] = 0;
      s.data[sCursorArea] = cursorArea;
      s.data[sCursorPos] = cursorPos;
      s.callback = SpriteCB_ItemIcon_SwapToMon;
      break;
    case ITEM_CB_HIDE_PARTY:
      // If the cursor is on a Pokémon with a held item and the player closes the party menu,
      // the held item follows the Pokémon as the menu slides out
      s.callback = SpriteCB_ItemIcon_HideParty;
      break;
  }
}

function SetItemIconActive(id: number, show: boolean): void {
  if (id >= MAX_ITEM_ICONS) return;
  gStorage.itemIcons[id].active = show;
  gStorage.itemIcons[id].sprite.invisible = !show;
}

/** PrintItemDescription (AddTextPrinterParameterized5 with the font's colors) */
export function PrintItemDescription(): void {
  const description = ItemId_GetDescription(IsActiveItemMoving() ? gStorage.movingItemId : gStorage.displayMonItemId);
  FillWindowPixelBuffer(2, PIXEL_FILL(1));
  AddTextPrinter(
    {
      currentChar: description,
      windowId: 2,
      fontId: K.FONT_NORMAL,
      x: 2,
      y: 0,
      letterSpacing: 0,
      lineSpacing: 0,
      fgColor: GetFontAttribute(K.FONT_NORMAL, FONTATTR_COLOR_FOREGROUND),
      bgColor: GetFontAttribute(K.FONT_NORMAL, FONTATTR_COLOR_BACKGROUND),
      shadowColor: GetFontAttribute(K.FONT_NORMAL, FONTATTR_COLOR_SHADOW),
    },
    0,
  );
}

export function InitItemInfoWindow(): void {
  gStorage.itemInfoWindowOffset = 25;
  LoadBgTiles(0, gfx('sItemInfoFrame_Gfx'), 0x80, 0x1a4);
  DrawItemInfoWindow(0);
}

export function UpdateItemInfoWindowSlideIn(): boolean {
  if (gStorage.itemInfoWindowOffset === 0) return false;
  gStorage.itemInfoWindowOffset--;
  const pos = 25 - gStorage.itemInfoWindowOffset;
  for (let i = 0; i < pos; i++) WriteSequenceToBgTilemapBuffer(0, GetBgAttribute(0, BG_ATTR_BASETILE) + 0x14 + gStorage.itemInfoWindowOffset + i, i, 12, 1, 8, 15, 25);
  DrawItemInfoWindow(pos);
  return gStorage.itemInfoWindowOffset !== 0;
}

export function UpdateItemInfoWindowSlideOut(): boolean {
  if (gStorage.itemInfoWindowOffset === 25) return false;
  if (gStorage.itemInfoWindowOffset === 0) FillBgTilemapBufferRect(0, 0, 25, 11, 1, 10, 17);
  gStorage.itemInfoWindowOffset++;
  const pos = 25 - gStorage.itemInfoWindowOffset;
  for (let i = 0; i < pos; i++) WriteSequenceToBgTilemapBuffer(0, GetBgAttribute(0, BG_ATTR_BASETILE) + 0x14 + gStorage.itemInfoWindowOffset + i, i, 12, 1, 8, 15, 25);
  DrawItemInfoWindow(pos);
  FillBgTilemapBufferRect(0, 0, pos, 11, 1, 10, 17);
  return gStorage.itemInfoWindowOffset !== 25;
}

function DrawItemInfoWindow(x: number): void {
  if (x !== 0) {
    FillBgTilemapBufferRect(0, 0x1a4, 0, 0xb, x, 1, 15);
    FillBgTilemapBufferRect(0, 0x9a4, 0, 0x14, x, 1, 15);
  }
  FillBgTilemapBufferRect(0, 0x1a5, x, 0xc, 1, 8, 15);
  FillBgTilemapBufferRect(0, 0x1a6, x, 0xb, 1, 1, 15);
  FillBgTilemapBufferRect(0, 0x1a7, x, 0x14, 1, 1, 15);
  ScheduleBgCopyTilemapToVram(0);
}

function SpriteCB_ItemIcon_WaitAnim(sprite: Sprite): void {
  if (sprite.affineAnimEnded) {
    SetItemIconActive(sprite.data[sItemIconId], false);
    sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_ItemIcon_ToHand(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      sprite.data[1] = sprite.x << 4;
      sprite.data[2] = sprite.y << 4;
      sprite.data[3] = 10;
      sprite.data[4] = 21;
      sprite.data[5] = 0;
      sprite.data[sState]++;
    // fallthrough
    case 1:
      sprite.data[1] -= sprite.data[3];
      sprite.data[2] -= sprite.data[4];
      sprite.x = sprite.data[1] >> 4;
      sprite.y = sprite.data[2] >> 4;
      if (++sprite.data[5] > 11) sprite.callback = SpriteCB_ItemIcon_SetPosToCursor;
      break;
  }
}

function SpriteCB_ItemIcon_SetPosToCursor(sprite: Sprite): void {
  sprite.x = gStorage.cursorSprite.x + 4;
  sprite.y = gStorage.cursorSprite.y + gStorage.cursorSprite.y2 + 8;
  sprite.oam.priority = gStorage.cursorSprite.oam.priority;
}

function SpriteCB_ItemIcon_ToMon(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      sprite.data[1] = sprite.x << 4;
      sprite.data[2] = sprite.y << 4;
      sprite.data[3] = 10;
      sprite.data[4] = 21;
      sprite.data[5] = 0;
      sprite.data[sState]++;
    // fallthrough
    case 1:
      sprite.data[1] += sprite.data[3];
      sprite.data[2] += sprite.data[4];
      sprite.x = sprite.data[1] >> 4;
      sprite.y = sprite.data[2] >> 4;
      if (++sprite.data[5] > 11) {
        SetItemIconPosition(GetItemIconIdxBySprite(sprite), sprite.data[sCursorArea], sprite.data[sCursorPos]);
        sprite.callback = SpriteCallbackDummy;
      }
      break;
  }
}

function SpriteCB_ItemIcon_SwapToHand(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      sprite.data[1] = sprite.x << 4;
      sprite.data[2] = sprite.y << 4;
      sprite.data[3] = 10;
      sprite.data[4] = 21;
      sprite.data[5] = 0;
      sprite.data[sState]++;
    // fallthrough
    case 1:
      sprite.data[1] -= sprite.data[3];
      sprite.data[2] -= sprite.data[4];
      sprite.x = sprite.data[1] >> 4;
      sprite.y = sprite.data[2] >> 4;
      sprite.x2 = gSineTable(sprite.data[5] * 8) >> 4;
      if (++sprite.data[5] > 11) {
        SetItemIconPosition(GetItemIconIdxBySprite(sprite), sprite.data[sCursorArea], sprite.data[sCursorPos]);
        sprite.x2 = 0;
        sprite.callback = SpriteCB_ItemIcon_SetPosToCursor;
      }
      break;
  }
}

function SpriteCB_ItemIcon_SwapToMon(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      sprite.data[1] = sprite.x << 4;
      sprite.data[2] = sprite.y << 4;
      sprite.data[3] = 10;
      sprite.data[4] = 21;
      sprite.data[5] = 0;
      sprite.data[sState]++;
    // fallthrough
    case 1:
      sprite.data[1] += sprite.data[3];
      sprite.data[2] += sprite.data[4];
      sprite.x = sprite.data[1] >> 4;
      sprite.y = sprite.data[2] >> 4;
      sprite.x2 = -(gSineTable(sprite.data[5] * 8) >> 4);
      if (++sprite.data[5] > 11) {
        SetItemIconPosition(GetItemIconIdxBySprite(sprite), sprite.data[sCursorArea], sprite.data[sCursorPos]);
        sprite.callback = SpriteCallbackDummy;
        sprite.x2 = 0;
      }
      break;
  }
}

function SpriteCB_ItemIcon_HideParty(sprite: Sprite): void {
  sprite.y -= 8;
  if (sprite.y + sprite.y2 < -16) {
    sprite.callback = SpriteCallbackDummy;
    SetItemIconActive(GetItemIconIdxBySprite(sprite), false);
  }
}

void DUMMY_WIN_TEMPLATE;
