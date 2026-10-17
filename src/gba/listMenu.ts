// list_menu.c: scrolling list menus. The C keeps struct ListMenu inside the list task's data array;
// here it lives in a table keyed by that task id.

import { K } from '../battle/constants';
import { menusData } from '../menus/data';
import { GetMonIconPtr, GetValidMonIconPalettePtr } from '../menus/pokemonIcon';
import { gfx, gfx16 } from './gfx';
import { animTable } from '../battle/gfx';
import { gSineTable } from '../battle/trig';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteTemplate,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  oam,
  SetSubspriteTables,
  SPRITE_SHAPE,
  TAG_NONE,
  TILE_SIZE_4BPP,
  type Sprite,
  type SpriteTemplate,
  type Subsprite,
  type SubspriteTable,
} from './sprite';
import { LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from './palette';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, L_BUTTON, R_BUTTON } from './main';
import { GetMenuCursorDimensionByFont, menuEnv } from './menu';
import { PlaySE } from './sound';
import { CreateTask, DestroyTask } from './task';
import {
  AddTextPrinterParameterized4,
  BlitBitmapRectToWindow,
  BlitBitmapToWindow,
  COPYWIN_GFX,
  CopyWindowToVram,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_MAX_LETTER_HEIGHT,
  GetFontAttribute,
  GetWindowAttribute,
  PIXEL_FILL,
  PutWindowRectTilemapOverridePalette,
  PutWindowTilemap,
  ScrollWindow,
  TEXT_SKIP_DRAW,
} from './window';

// include/list_menu.h
export const LIST_NOTHING_CHOSEN = -1;
export const LIST_CANCEL = -2;
export const LIST_HEADER = -3;
export const LIST_NO_MULTIPLE_SCROLL = 0;
export const LIST_MULTIPLE_SCROLL_DPAD = 1;
export const LIST_MULTIPLE_SCROLL_L_R = 2;
export const LISTFIELD_CURSORKIND = 16;
const TAIL_SENTINEL = 0xff;

export interface ListMenuItem {
  label: number[];
  index: number;
}

export interface ListMenuTemplate {
  items: ListMenuItem[];
  moveCursorFunc: ((itemIndex: number, onInit: boolean, list: ListMenu) => void) | null;
  itemPrintFunc: ((windowId: number, itemId: number, y: number) => void) | null;
  totalItems: number;
  maxShowed: number;
  windowId: number;
  header_X: number;
  item_X: number;
  cursor_X: number;
  upText_Y: number;
  cursorPal: number;
  fillValue: number;
  cursorShadowPal: number;
  lettersSpacing: number;
  itemVerticalPadding: number;
  scrollMultiple: number;
  fontId: number;
  cursorKind: number;
}

export interface ListMenu {
  template: ListMenuTemplate;
  cursorPos: number;
  itemsAbove: number;
  unk_1C: number;
  unk_1D: number;
  taskId: number;
  unk_1F: number;
}

export const gMultiuseListMenuTemplate: ListMenuTemplate = {
  items: [],
  moveCursorFunc: null,
  itemPrintFunc: null,
  totalItems: 0,
  maxShowed: 0,
  windowId: 0,
  header_X: 0,
  item_X: 0,
  cursor_X: 0,
  upText_Y: 0,
  cursorPal: 0,
  fillValue: 0,
  cursorShadowPal: 0,
  lettersSpacing: 0,
  itemVerticalPadding: 0,
  scrollMultiple: 0,
  fontId: 0,
  cursorKind: 0,
};

const gListMenuOverride = { cursorPal: 0, fillValue: 0, cursorShadowPal: 0, lettersSpacing: 0, fontId: 0, enabled: false };

/** gTasks[listTaskId].data as struct ListMenu */
const sListMenus = new Map<number, ListMenu>();

function listOf(listTaskId: number): ListMenu {
  return sListMenus.get(listTaskId)!;
}

function ListMenuDummyTask(_taskId: number): void {}

export function ListMenuInit(listMenuTemplate: ListMenuTemplate, cursorPos: number, itemsAbove: number): number {
  const taskId = ListMenuInitInternal(listMenuTemplate, cursorPos, itemsAbove);
  PutWindowTilemap(listMenuTemplate.windowId);
  CopyWindowToVram(listMenuTemplate.windowId, COPYWIN_GFX);
  return taskId;
}

/** struct ListMenuWindowRect: a column band of the list's window put with its own palette. */
export interface ListMenuWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  palNum: number;
}

/** ListMenuInitInRect: like ListMenuInit, but the window's tilemap is put rect by rect (until palNum 0xFF). */
export function ListMenuInitInRect(listMenuTemplate: ListMenuTemplate, rect: ListMenuWindowRect[], cursorPos: number, itemsAbove: number): number {
  const taskId = ListMenuInitInternal(listMenuTemplate, cursorPos, itemsAbove);
  for (let i = 0; rect[i].palNum !== 0xff; i++) PutWindowRectTilemapOverridePalette(listMenuTemplate.windowId, rect[i].x, rect[i].y, rect[i].width, rect[i].height, rect[i].palNum);
  CopyWindowToVram(listMenuTemplate.windowId, COPYWIN_GFX);
  return taskId;
}

export function ListMenu_ProcessInput(listTaskId: number): number {
  const list = listOf(listTaskId);
  if (JOY_NEW(A_BUTTON)) return list.template.items[list.cursorPos + list.itemsAbove].index;
  if (JOY_NEW(B_BUTTON)) return LIST_CANCEL;
  if (gMain.newAndRepeatedKeys & DPAD_UP) {
    ListMenuChangeSelection(list, true, 1, false);
    return LIST_NOTHING_CHOSEN;
  }
  if (gMain.newAndRepeatedKeys & DPAD_DOWN) {
    ListMenuChangeSelection(list, true, 1, true);
    return LIST_NOTHING_CHOSEN;
  }
  // try to move by one window scroll
  let leftButton = 0;
  let rightButton = 0;
  switch (list.template.scrollMultiple) {
    case LIST_MULTIPLE_SCROLL_DPAD:
      leftButton = gMain.newAndRepeatedKeys & DPAD_LEFT;
      rightButton = gMain.newAndRepeatedKeys & DPAD_RIGHT;
      break;
    case LIST_MULTIPLE_SCROLL_L_R:
      leftButton = gMain.newAndRepeatedKeys & L_BUTTON;
      rightButton = gMain.newAndRepeatedKeys & R_BUTTON;
      break;
  }
  if (leftButton) {
    ListMenuChangeSelection(list, true, list.template.maxShowed, false);
  } else if (rightButton) {
    ListMenuChangeSelection(list, true, list.template.maxShowed, true);
  }
  return LIST_NOTHING_CHOSEN;
}

/** DestroyListMenuTask: `out` receives cursorPos/itemsAbove (the C's u16 out-pointers). */
export function DestroyListMenuTask(listTaskId: number, out?: { cursorPos: number; itemsAbove: number }): void {
  const list = listOf(listTaskId);
  if (out) {
    out.cursorPos = list.cursorPos;
    out.itemsAbove = list.itemsAbove;
  }
  if (list.taskId !== TAIL_SENTINEL) ListMenuRemoveCursorObject(list.taskId, list.template.cursorKind - 2);
  sListMenus.delete(listTaskId);
  DestroyTask(listTaskId);
}

export function RedrawListMenu(listTaskId: number): void {
  const list = listOf(listTaskId);
  FillWindowPixelBuffer(list.template.windowId, PIXEL_FILL(list.template.fillValue));
  ListMenuPrintEntries(list, list.cursorPos, 0, list.template.maxShowed);
  ListMenuDrawCursor(list);
  CopyWindowToVram(list.template.windowId, COPYWIN_GFX);
}

export function ListMenuGetScrollAndRow(listTaskId: number): { cursorPos: number; itemsAbove: number } {
  const list = listOf(listTaskId);
  return { cursorPos: list.cursorPos, itemsAbove: list.itemsAbove };
}

export function ListMenuGetYCoordForPrintingArrowCursor(listTaskId: number): number {
  const list = listOf(listTaskId);
  const yMultiplier = GetFontAttribute(list.template.fontId, FONTATTR_MAX_LETTER_HEIGHT) + list.template.itemVerticalPadding;
  return list.itemsAbove * yMultiplier + list.template.upText_Y;
}

function ListMenuInitInternal(listMenuTemplate: ListMenuTemplate, cursorPos: number, itemsAbove: number): number {
  const listTaskId = CreateTask(ListMenuDummyTask, 0);
  const list: ListMenu = { template: { ...listMenuTemplate }, cursorPos, itemsAbove, unk_1C: 0, unk_1D: 0, taskId: TAIL_SENTINEL, unk_1F: 0 };
  sListMenus.set(listTaskId, list);
  gListMenuOverride.cursorPal = list.template.cursorPal;
  gListMenuOverride.fillValue = list.template.fillValue;
  gListMenuOverride.cursorShadowPal = list.template.cursorShadowPal;
  gListMenuOverride.lettersSpacing = list.template.lettersSpacing;
  gListMenuOverride.fontId = list.template.fontId;
  gListMenuOverride.enabled = false;
  if (list.template.totalItems < list.template.maxShowed) list.template.maxShowed = list.template.totalItems;
  FillWindowPixelBuffer(list.template.windowId, PIXEL_FILL(list.template.fillValue));
  ListMenuPrintEntries(list, list.cursorPos, 0, list.template.maxShowed);
  ListMenuDrawCursor(list);
  ListMenuCallSelectionChangedCallback(list, true);
  return listTaskId;
}

function ListMenuPrint(list: ListMenu, str: number[], x: number, y: number): void {
  if (gListMenuOverride.enabled) {
    const colors = [gListMenuOverride.fillValue, gListMenuOverride.cursorPal, gListMenuOverride.cursorShadowPal];
    AddTextPrinterParameterized4(list.template.windowId, gListMenuOverride.fontId, x, y, gListMenuOverride.lettersSpacing, 0, colors, TEXT_SKIP_DRAW, str);
    gListMenuOverride.enabled = false;
  } else {
    const colors = [list.template.fillValue, list.template.cursorPal, list.template.cursorShadowPal];
    AddTextPrinterParameterized4(list.template.windowId, list.template.fontId, x, y, list.template.lettersSpacing, 0, colors, TEXT_SKIP_DRAW, str);
  }
}

function ListMenuPrintEntries(list: ListMenu, startIndex: number, yOffset: number, count: number): void {
  const yMultiplier = GetFontAttribute(list.template.fontId, FONTATTR_MAX_LETTER_HEIGHT) + list.template.itemVerticalPadding;
  for (let i = 0; i < count; i++) {
    const x = list.template.items[startIndex].index !== LIST_HEADER ? list.template.item_X : list.template.header_X;
    const y = (yOffset + i) * yMultiplier + list.template.upText_Y;
    list.template.itemPrintFunc?.(list.template.windowId, list.template.items[startIndex].index, y);
    ListMenuPrint(list, list.template.items[startIndex].label, x, y);
    startIndex++;
  }
}

function ListMenuDrawCursor(list: ListMenu): void {
  const yMultiplier = GetFontAttribute(list.template.fontId, FONTATTR_MAX_LETTER_HEIGHT) + list.template.itemVerticalPadding;
  const x = list.template.cursor_X;
  const y = list.itemsAbove * yMultiplier + list.template.upText_Y;
  switch (list.template.cursorKind) {
    case 0:
      ListMenuPrint(list, menuEnv.textSelectorArrow2, x, y);
      break;
    case 1:
      break;
    case 2:
      if (list.taskId === TAIL_SENTINEL) list.taskId = ListMenuAddCursorObject(list, 0);
      ListMenuUpdateCursorObject(list.taskId, GetWindowAttribute(list.template.windowId, 'tilemapLeft') * 8 - 1, GetWindowAttribute(list.template.windowId, 'tilemapTop') * 8 + y - 1, 0);
      break;
    case 3:
      if (list.taskId === TAIL_SENTINEL) list.taskId = ListMenuAddCursorObject(list, 1);
      ListMenuUpdateCursorObject(list.taskId, GetWindowAttribute(list.template.windowId, 'tilemapLeft') * 8 + x, GetWindowAttribute(list.template.windowId, 'tilemapTop') * 8 + y, 1);
      break;
  }
}

function ListMenuErasePrintedCursor(list: ListMenu, itemsAbove: number): void {
  if (list.template.cursorKind === 0) {
    const yMultiplier = GetFontAttribute(list.template.fontId, FONTATTR_MAX_LETTER_HEIGHT) + list.template.itemVerticalPadding;
    const width = GetMenuCursorDimensionByFont(list.template.fontId, 0);
    const height = GetMenuCursorDimensionByFont(list.template.fontId, 1);
    FillWindowPixelRect(list.template.windowId, PIXEL_FILL(list.template.fillValue), list.template.cursor_X, itemsAbove * yMultiplier + list.template.upText_Y, width, height);
  }
}

function ListMenuUpdateSelectedRowIndexAndScrollOffset(list: ListMenu, movingDown: boolean): number {
  let itemsAbove = list.itemsAbove;
  const cursorPos = list.cursorPos;
  let newRow: number;
  let newScroll: number;
  const maxShowed = list.template.maxShowed;
  if (!movingDown) {
    newRow = maxShowed === 1 ? 0 : maxShowed - (Math.trunc(maxShowed / 2) + (maxShowed % 2)) - 1;
    if (cursorPos === 0) {
      while (itemsAbove !== 0) {
        itemsAbove--;
        if (list.template.items[cursorPos + itemsAbove].index !== LIST_HEADER) {
          list.itemsAbove = itemsAbove;
          return 1;
        }
      }
      return 0;
    }
    while (itemsAbove > newRow) {
      itemsAbove--;
      if (list.template.items[cursorPos + itemsAbove].index !== LIST_HEADER) {
        list.itemsAbove = itemsAbove;
        return 1;
      }
    }
    newScroll = cursorPos - 1;
  } else {
    newRow = maxShowed === 1 ? 0 : Math.trunc(maxShowed / 2) + (maxShowed % 2);
    if (cursorPos === list.template.totalItems - maxShowed) {
      while (itemsAbove < maxShowed - 1) {
        itemsAbove++;
        if (list.template.items[cursorPos + itemsAbove].index !== LIST_HEADER) {
          list.itemsAbove = itemsAbove;
          return 1;
        }
      }
      return 0;
    }
    while (itemsAbove < newRow) {
      itemsAbove++;
      if (list.template.items[cursorPos + itemsAbove].index !== LIST_HEADER) {
        list.itemsAbove = itemsAbove;
        return 1;
      }
    }
    newScroll = cursorPos + 1;
  }
  list.itemsAbove = newRow;
  list.cursorPos = newScroll;
  return 2;
}

function ListMenuScroll(list: ListMenu, count: number, movingDown: boolean): void {
  const t = list.template;
  if (count >= t.maxShowed) {
    FillWindowPixelBuffer(t.windowId, PIXEL_FILL(t.fillValue));
    ListMenuPrintEntries(list, list.cursorPos, 0, t.maxShowed);
    return;
  }
  const yMultiplier = GetFontAttribute(t.fontId, FONTATTR_MAX_LETTER_HEIGHT) + t.itemVerticalPadding;
  if (!movingDown) {
    ScrollWindow(t.windowId, 1, count * yMultiplier, PIXEL_FILL(t.fillValue));
    ListMenuPrintEntries(list, list.cursorPos, 0, count);
    const y = t.maxShowed * yMultiplier + t.upText_Y;
    const width = GetWindowAttribute(t.windowId, 'width') * 8;
    const height = GetWindowAttribute(t.windowId, 'height') * 8 - y;
    FillWindowPixelRect(t.windowId, PIXEL_FILL(t.fillValue), 0, y, width, height);
  } else {
    ScrollWindow(t.windowId, 0, count * yMultiplier, PIXEL_FILL(t.fillValue));
    ListMenuPrintEntries(list, list.cursorPos + (t.maxShowed - count), t.maxShowed - count, count);
    const width = GetWindowAttribute(t.windowId, 'width') * 8;
    FillWindowPixelRect(t.windowId, PIXEL_FILL(t.fillValue), 0, 0, width, t.upText_Y);
  }
}

function ListMenuChangeSelection(list: ListMenu, updateCursorAndCallCallback: boolean, count: number, movingDown: boolean): boolean {
  const oldSelectedRow = list.itemsAbove;
  let cursorCount = 0;
  let selectionChange = 0;
  for (let i = 0; i < count; i++) {
    do {
      const ret = ListMenuUpdateSelectedRowIndexAndScrollOffset(list, movingDown);
      selectionChange |= ret;
      if (ret !== 2) break;
      cursorCount++;
    } while (list.template.items[list.cursorPos + list.itemsAbove].index === LIST_HEADER);
  }
  if (updateCursorAndCallCallback) {
    switch (selectionChange) {
      case 1:
        ListMenuErasePrintedCursor(list, oldSelectedRow);
        ListMenuDrawCursor(list);
        ListMenuCallSelectionChangedCallback(list, false);
        CopyWindowToVram(list.template.windowId, COPYWIN_GFX);
        break;
      case 2:
      case 3:
        ListMenuErasePrintedCursor(list, oldSelectedRow);
        ListMenuScroll(list, cursorCount, movingDown);
        ListMenuDrawCursor(list);
        ListMenuCallSelectionChangedCallback(list, false);
        CopyWindowToVram(list.template.windowId, COPYWIN_GFX);
        break;
      default:
        return true;
    }
  }
  return false;
}

function ListMenuCallSelectionChangedCallback(list: ListMenu, onInit: boolean): void {
  list.template.moveCursorFunc?.(list.template.items[list.cursorPos + list.itemsAbove].index, onInit, list);
}

export function ListMenuOverrideSetColors(cursorPal: number, fillValue: number, cursorShadowPal: number): void {
  gListMenuOverride.cursorPal = cursorPal;
  gListMenuOverride.fillValue = fillValue;
  gListMenuOverride.cursorShadowPal = cursorShadowPal;
  gListMenuOverride.enabled = true;
}

export function ListMenuDefaultCursorMoveFunc(_itemIndex: number, onInit: boolean): void {
  if (!onInit) PlaySE(K.SE_SELECT);
}

export function ListMenuSetTemplateField(taskId: number, field: number, value: number): void {
  const data = listOf(taskId);
  // Only the field the ported screens set (LISTFIELD_CURSORKIND) is needed.
  if (field === LISTFIELD_CURSORKIND) data.template.cursorKind = value;
  else console.warn(`[list_menu] ListMenuSetTemplateField(${field}) not implemented`);
}

/** ListMenu_LoadMonIconPalette: the species' icon palette into the BG palettes at palOffset */
export function ListMenu_LoadMonIconPalette(palOffset: number, speciesId: number): void {
  LoadPalette(GetValidMonIconPalettePtr(speciesId), palOffset, PLTT_SIZE_4BPP);
}

/** ListMenu_DrawMonIconGraphics: the icon's first frame (32x32) into a window. Preload its graphics (monIconSymbol). */
export function ListMenu_DrawMonIconGraphics(windowId: number, speciesId: number, personality: number, x: number, y: number): void {
  BlitBitmapToWindow(windowId, GetMonIconPtr(speciesId, personality, true), x, y, 32, 32);
}

/** ListMenuLoadStdPalAt: the caught-ball palette (0) or the type icons' palette (1). */
export function ListMenuLoadStdPalAt(palOffset: number, palId: number): void {
  LoadPalette(gfx16(palId === 1 ? 'gMenuInfoElements2_Pal' : 'gMenuInfoElements1_Pal'), palOffset, PLTT_SIZE_4BPP);
}

/** BlitMenuInfoIcon: a type / category icon from gMenuInfoElements_Gfx (a 128x128 sheet), by sMenuInfoIcons. */
export function BlitMenuInfoIcon(windowId: number, iconId: number, x: number, y: number): void {
  const [width, height, offset] = menusData.menuInfoIcons[iconId];
  BlitBitmapRectToWindow(windowId, gfx('gMenuInfoElements_Gfx').subarray(offset * TILE_SIZE_4BPP), 0, 0, 128, 128, x, y, width, height);
}

/** ListMenuAddCursorObject: the list's red outline (cursorKind 2) or red arrow (3) sprite cursor */
function ListMenuAddCursorObject(list: ListMenu, cursorKind: number): number {
  const cursor: CursorStruct = {
    left: 0,
    top: 160,
    rowWidth: GetWindowAttribute(list.template.windowId, 'width') * 8 + 2,
    rowHeight: GetFontAttribute(list.template.fontId, FONTATTR_MAX_LETTER_HEIGHT) + 2,
    tileTag: 0x4000,
    palTag: TAG_NONE,
    palNum: 15,
  };
  return ListMenuAddCursorObjectInternal(cursor, cursorKind);
}

// ------------------------------------------------------------------ menu_indicators.c: the cursor objects
// The red outline (kind 0) and red arrow (kind 1) sprite cursors. Their state lives in a table keyed by the
// cursor's task id instead of in the task data.

/** struct CursorStruct (include/menu_indicators.h) */
export interface CursorStruct {
  left: number;
  top: number;
  rowWidth: number;
  rowHeight: number;
  tileTag: number;
  palTag: number;
  palNum: number;
}

interface CursorObject {
  spriteId: number;
  tileTag: number;
  palTag: number;
}

const sCursorObjects = new Map<number, CursorObject>();

/** ListMenuAddCursorObjectInternal */
export function ListMenuAddCursorObjectInternal(cursor: CursorStruct, cursorKind: number): number {
  switch (cursorKind) {
    case 0:
    default:
      return ListMenuAddRedOutlineCursorObject(cursor);
    case 1:
      return ListMenuAddRedArrowCursorObject(cursor);
  }
}

/** ListMenuUpdateCursorObject */
export function ListMenuUpdateCursorObject(taskId: number, x: number, y: number, cursorKind: number): void {
  switch (cursorKind) {
    case 0:
      ListMenuUpdateRedOutlineCursorObject(taskId, x, y);
      break;
    case 1:
      ListMenuUpdateRedArrowCursorObject(taskId, x, y);
      break;
  }
}

/** ListMenuRemoveCursorObject */
export function ListMenuRemoveCursorObject(taskId: number, cursorKind: number): void {
  switch (cursorKind) {
    case 0:
    case 1:
      // ListMenuRemoveRedOutlineCursorObject / ListMenuRemoveRedArrowCursorObject: the same steps (the outline's
      // subsprite table is garbage collected)
      ListMenuRemoveCursorObjectSprite(taskId);
      break;
  }
}

function Task_RedOutlineCursor(_taskId: number): void {}

/** ListMenuGetRedOutlineCursorSpriteCount */
function ListMenuGetRedOutlineCursorSpriteCount(rowWidth: number, rowHeight: number): number {
  let count = 4;
  if (rowWidth > 16) for (let i = 8; i < rowWidth - 8; i += 8) count += 2;
  if (rowHeight > 16) for (let i = 8; i < rowHeight - 8; i += 8) count += 2;
  return count;
}

/** sSubsprite_RedOutline1..8: 8x8 pieces, tiles 0-7 (corners, edges) */
function redOutlinePiece(tileOffset: number, x: number, y: number): Subsprite {
  const s8 = (v: number) => (((v & 0xff) ^ 0x80) - 0x80); // struct Subsprite's x / y are s8
  return { x: s8(x), y: s8(y), shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], tileOffset, priority: 0 };
}

/** ListMenuSetUpRedOutlineCursorSpriteOamTable */
function ListMenuSetUpRedOutlineCursorSpriteOamTable(rowWidth: number, rowHeight: number): Subsprite[] {
  const subsprites = [
    redOutlinePiece(0, 136, 136),
    redOutlinePiece(1, rowWidth + 128, 136),
    redOutlinePiece(6, 136, rowHeight + 128),
    redOutlinePiece(7, rowWidth + 128, rowHeight + 128),
  ];
  if (rowWidth > 16) {
    for (let i = 8; i < rowWidth - 8; i += 8) {
      subsprites.push(redOutlinePiece(2, i - 120, 136));
      subsprites.push(redOutlinePiece(5, i - 120, rowHeight + 128));
    }
  }
  if (rowHeight > 16) {
    for (let j = 8; j < rowHeight - 8; j += 8) {
      subsprites.push(redOutlinePiece(3, 136, j - 120));
      subsprites.push(redOutlinePiece(4, rowWidth + 128, j - 120));
    }
  }
  return subsprites;
}

/** Loads the cursor's palette (sRedArrowPal) into its slot or under its tag. */
function loadCursorPalette(cursor: CursorStruct): void {
  if (cursor.palTag === TAG_NONE) LoadPalette(gfx16('sRedArrowPal'), OBJ_PLTT_ID(cursor.palNum), PLTT_SIZE_4BPP);
  else LoadSpritePalette({ data: gfx16('sRedArrowPal'), tag: cursor.palTag });
}

/** ListMenuAddRedOutlineCursorObject: a rowWidth x rowHeight outline built from 8x8 subsprites */
function ListMenuAddRedOutlineCursorObject(cursor: CursorStruct): number {
  LoadCompressedSpriteSheet({ data: gfx('sSelectorOutlineGfx'), size: 0x100, tag: cursor.tileTag });
  loadCursorPalette(cursor);
  const taskId = CreateTask(Task_RedOutlineCursor, 0);
  const subsprites = ListMenuSetUpRedOutlineCursorSpriteOamTable(cursor.rowWidth, cursor.rowHeight);
  const subspriteTable: SubspriteTable = { subspriteCount: ListMenuGetRedOutlineCursorSpriteCount(cursor.rowWidth, cursor.rowHeight), subsprites };
  const spriteTemplate: SpriteTemplate = { ...gDummySpriteTemplate, tileTag: cursor.tileTag, paletteTag: cursor.palTag };
  const spriteId = CreateSprite(spriteTemplate, cursor.left + 120, cursor.top + 120, 0);
  const sprite = gSprites[spriteId];
  SetSubspriteTables(sprite, [subspriteTable]);
  sprite.oam.priority = 0;
  sprite.subpriority = 0;
  sprite.subspriteTableNum = 0;
  if (cursor.palTag === TAG_NONE) sprite.oam.paletteNum = cursor.palNum;
  sCursorObjects.set(taskId, { spriteId, tileTag: cursor.tileTag, palTag: cursor.palTag });
  return taskId;
}

/** ListMenuUpdateRedOutlineCursorObject: (x, y) is the outline's top left */
function ListMenuUpdateRedOutlineCursorObject(taskId: number, x: number, y: number): void {
  const sprite = gSprites[sCursorObjects.get(taskId)!.spriteId];
  sprite.x = (x + 120) & 0xffff;
  sprite.y = (y + 120) & 0xffff;
}

/** ListMenuRemoveRedOutlineCursorObject / ListMenuRemoveRedArrowCursorObject */
function ListMenuRemoveCursorObjectSprite(taskId: number): void {
  const data = sCursorObjects.get(taskId)!;
  if (data.tileTag !== TAG_NONE) FreeSpriteTilesByTag(data.tileTag);
  if (data.palTag !== TAG_NONE) FreeSpritePaletteByTag(data.palTag);
  DestroySprite(gSprites[data.spriteId]);
  sCursorObjects.delete(taskId);
  DestroyTask(taskId);
}

/** SpriteCallback_RedArrowCursor: sways left and right */
function SpriteCallback_RedArrowCursor(sprite: Sprite): void {
  sprite.x2 = Math.trunc(gSineTable(sprite.data[0] & 0xff) / 64);
  sprite.data[0] += 8;
}

function Task_RedArrowCursor(_taskId: number): void {}

/** ListMenuAddRedArrowCursorObject */
function ListMenuAddRedArrowCursorObject(cursor: CursorStruct): number {
  LoadCompressedSpriteSheet({ data: gfx('sRedArrowGfx'), size: 0x80, tag: cursor.tileTag });
  loadCursorPalette(cursor);
  const taskId = CreateTask(Task_RedArrowCursor, 0);
  const spriteTemplate: SpriteTemplate = {
    tileTag: cursor.tileTag,
    paletteTag: cursor.palTag,
    oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 0 }),
    anims: animTable('menu_indicators.c', 'sSpriteAnimTable_RedArrowCursor'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallback_RedArrowCursor,
  };
  const spriteId = CreateSprite(spriteTemplate, cursor.left, cursor.top, 0);
  const sprite = gSprites[spriteId];
  sprite.x2 = 8;
  sprite.y2 = 8;
  if (cursor.palTag === TAG_NONE) sprite.oam.paletteNum = cursor.palNum;
  sCursorObjects.set(taskId, { spriteId, tileTag: cursor.tileTag, palTag: cursor.palTag });
  return taskId;
}

/** ListMenuUpdateRedArrowCursorObject */
function ListMenuUpdateRedArrowCursorObject(taskId: number, x: number, y: number): void {
  const sprite = gSprites[sCursorObjects.get(taskId)!.spriteId];
  sprite.x = x;
  sprite.y = y;
}
