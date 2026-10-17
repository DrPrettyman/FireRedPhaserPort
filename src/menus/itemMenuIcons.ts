// item_menu_icons.c: the bag sprite, the item-swap line and the item icon shown under the bag.

import { K } from '../battle/constants';
import { affineAnimTable, animTable } from '../battle/gfx';
import { gfx, gfx16, isGfxLoaded } from '../gba/gfx';
import {
  CreateSprite,
  DestroySpriteAndFreeResources,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  ST_OAM_AFFINE_NORMAL,
  type Sprite,
  type SpriteSheet,
  type SpritePalette,
  type SpriteTemplate,
} from '../gba/sprite';
import { menusData } from './data';

const TAG_BAG = 100;
const TAG_SWAP_LINE = 101;
const TAG_ITEM_ICON = 102;

const NUM_SWAP_LINE_SPRITES = 9;
const SPR_BAG = 0;
const SPR_SWAP_LINE_START = 1;
const SPR_ITEM_ICON = SPR_SWAP_LINE_START + NUM_SWAP_LINE_SPRITES;
const SPR_COUNT = SPR_ITEM_ICON + 2;

const ANIM_SWAP_LINE_MID = 1;
const ANIM_SWAP_LINE_END = 2;
const AFFINEANIM_BAG_IDLE = 0;
const AFFINEANIM_BAG_SHAKE = 1;

const sItemMenuIconSpriteIds = new Array<number>(SPR_COUNT).fill(0);

const unit = 'item_menu_icons.c';

function sSpriteTemplate_Bag(): SpriteTemplate {
  return {
    tileTag: TAG_BAG,
    paletteTag: TAG_BAG,
    oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 }),
    anims: animTable(unit, 'sAnims_Bag'),
    images: null,
    affineAnims: affineAnimTable(unit, 'sAffineAnimTable_Bag'),
    callback: SpriteCallbackDummy,
  };
}

function sSpriteTemplate_SwapLine(): SpriteTemplate {
  return {
    tileTag: TAG_SWAP_LINE,
    paletteTag: TAG_SWAP_LINE,
    oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1, paletteNum: 1 }),
    anims: animTable(unit, 'sAnims_SwapLine'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

function sSpriteTemplate_ItemIcon(): SpriteTemplate {
  return {
    tileTag: TAG_ITEM_ICON,
    paletteTag: TAG_ITEM_ICON,
    oam: oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1, paletteNum: 2 }),
    anims: animTable(unit, 'sAnims_ItemIcon'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

export const gSpriteSheet_BagMale = (): SpriteSheet => ({ data: gfx('gBagMale_Gfx'), size: 0x2000, tag: TAG_BAG });
export const gSpriteSheet_BagFemale = (): SpriteSheet => ({ data: gfx('gBagFemale_Gfx'), size: 0x2000, tag: TAG_BAG });
export const gSpritePalette_Bag = (): SpritePalette => ({ data: gfx16('gBag_Pal'), tag: TAG_BAG });
export const gBagSwapSpriteSheet = (): SpriteSheet => ({ data: gfx('gSwapLine_Gfx'), size: 0x100, tag: TAG_SWAP_LINE });
export const gBagSwapSpritePalette = (): SpritePalette => ({ data: gfx16('gSwapLine_Pal'), tag: TAG_SWAP_LINE });

export function ResetItemMenuIconState(): void {
  sItemMenuIconSpriteIds.fill(K.SPRITE_NONE);
}

export function CreateBagSprite(animNum: number): void {
  sItemMenuIconSpriteIds[SPR_BAG] = CreateSprite(sSpriteTemplate_Bag(), 40, 68, 0);
  SetBagVisualPocketId(animNum);
}

export function SetBagVisualPocketId(animNum: number): void {
  const sprite = gSprites[sItemMenuIconSpriteIds[SPR_BAG]];
  sprite.y2 = -5;
  sprite.callback = SpriteCB_BagVisualSwitchingPockets;
  StartSpriteAnim(sprite, animNum);
}

function SpriteCB_BagVisualSwitchingPockets(sprite: Sprite): void {
  if (sprite.y2 !== 0) sprite.y2++;
  else sprite.callback = SpriteCallbackDummy;
}

export function ShakeBagSprite(): void {
  const sprite = gSprites[sItemMenuIconSpriteIds[SPR_BAG]];
  if (sprite.affineAnimEnded) {
    StartSpriteAffineAnim(sprite, AFFINEANIM_BAG_SHAKE);
    sprite.callback = SpriteCB_ShakeBagSprite;
  }
}

function SpriteCB_ShakeBagSprite(sprite: Sprite): void {
  if (sprite.affineAnimEnded) {
    StartSpriteAffineAnim(sprite, AFFINEANIM_BAG_IDLE);
    sprite.callback = SpriteCallbackDummy;
  }
}

export function CreateSwapLine(): void {
  for (let i = 0; i < NUM_SWAP_LINE_SPRITES; i++) {
    const id = CreateSprite(sSpriteTemplate_SwapLine(), i * 16 + 96, 7, 0);
    sItemMenuIconSpriteIds[SPR_SWAP_LINE_START + i] = id;
    if (i === NUM_SWAP_LINE_SPRITES - 1) StartSpriteAnim(gSprites[id], ANIM_SWAP_LINE_END);
    else if (i !== 0) StartSpriteAnim(gSprites[id], ANIM_SWAP_LINE_MID);
    gSprites[id].invisible = true;
  }
}

export function SetSwapLineInvisibility(invisible: boolean): void {
  for (let i = 0; i < NUM_SWAP_LINE_SPRITES; i++) gSprites[sItemMenuIconSpriteIds[SPR_SWAP_LINE_START + i]].invisible = invisible;
}

export function UpdateSwapLinePos(x: number, y: number): void {
  for (let i = 0; i < NUM_SWAP_LINE_SPRITES; i++) {
    const s = gSprites[sItemMenuIconSpriteIds[SPR_SWAP_LINE_START + i]];
    s.x2 = x;
    s.y = y + 7;
  }
}

/** CopyItemIconPicTo4x4Buffer: the 24x24 icon's three tile rows into a 32x32 sprite's tiles. */
function CopyItemIconPicTo4x4Buffer(src: Uint8Array, dest: Uint8Array): void {
  for (let i = 0; i < 3; i++) dest.set(src.subarray(0x60 * i, 0x60 * i + 0x60), 0x80 * i);
}

export function AddItemIconObject(tilesTag: number, paletteTag: number, itemId: number): number {
  const padded = new Uint8Array(0x200);
  CopyItemIconPicTo4x4Buffer(gfx(GetItemIconGfxSymbol(itemId, K.ITEMICON_TILES)), padded);
  LoadSpriteSheet({ data: padded, size: 0x200, tag: tilesTag });
  LoadSpritePalette({ data: gfx16(GetItemIconGfxSymbol(itemId, K.ITEMICON_PAL)), tag: paletteTag });
  return CreateSprite({ ...sSpriteTemplate_ItemIcon(), tileTag: tilesTag, paletteTag }, 0, 0, 0);
}

export function CreateItemMenuIcon(itemId: number, idx: number): void {
  const slot = SPR_ITEM_ICON + idx;
  if (sItemMenuIconSpriteIds[slot] === K.SPRITE_NONE) {
    // Either TAG_ITEM_ICON or TAG_ITEM_ICON_ALT
    FreeSpriteTilesByTag(TAG_ITEM_ICON + idx);
    FreeSpritePaletteByTag(TAG_ITEM_ICON + idx);
    const spriteId = AddItemIconObject(TAG_ITEM_ICON + idx, TAG_ITEM_ICON + idx, itemId);
    if (spriteId !== MAX_SPRITES) {
      sItemMenuIconSpriteIds[slot] = spriteId;
      gSprites[spriteId].x2 = 24;
      gSprites[spriteId].y2 = 140;
    }
  }
}

/** CreateBerryPouchItemIcon: CreateItemMenuIcon for the berry pouch (7 px lower). */
export function CreateBerryPouchItemIcon(itemId: number, idx: number): void {
  const slot = SPR_ITEM_ICON + idx;
  if (sItemMenuIconSpriteIds[slot] === K.SPRITE_NONE) {
    // Either TAG_ITEM_ICON or TAG_ITEM_ICON_ALT
    FreeSpriteTilesByTag(TAG_ITEM_ICON + idx);
    FreeSpritePaletteByTag(TAG_ITEM_ICON + idx);
    const spriteId = AddItemIconObject(TAG_ITEM_ICON + idx, TAG_ITEM_ICON + idx, itemId);
    if (spriteId !== MAX_SPRITES) {
      sItemMenuIconSpriteIds[slot] = spriteId;
      gSprites[spriteId].x2 = 24;
      gSprites[spriteId].y2 = 147; // This value is the only difference from CreateItemMenuIcon
    }
  }
}

export function DestroyItemMenuIcon(idx: number): void {
  const slot = SPR_ITEM_ICON + idx;
  if (sItemMenuIconSpriteIds[slot] !== K.SPRITE_NONE) {
    DestroySpriteAndFreeResources(gSprites[sItemMenuIconSpriteIds[slot]]);
    sItemMenuIconSpriteIds[slot] = K.SPRITE_NONE;
  }
}

/**
 * GetItemIconGfxPtr's symbol: attrId is ITEMICON_TILES or ITEMICON_PAL. Icons are preloaded per
 * screen (itemIconSymbols); an icon that wasn't falls back to the question mark with a warning.
 */
export function GetItemIconGfxSymbol(itemId: number, attrId: number): string {
  if (itemId > K.ITEMS_COUNT) itemId = K.ITEM_NONE;
  const entry = menusData.itemIcons[itemId] ?? menusData.itemIcons[K.ITEM_NONE]!;
  if (!isGfxLoaded(entry[attrId])) {
    console.warn(`[item_menu_icons] icon for item ${itemId} wasn't preloaded`);
    return menusData.itemIcons[K.ITEM_NONE]![attrId];
  }
  return entry[attrId];
}

/** Symbols for the icons of `items` (plus the question mark and the return arrow), to preload. */
export function itemIconSymbols(items: Iterable<number>): string[] {
  const out = new Set<string>();
  for (const item of [K.ITEM_NONE, K.ITEMS_COUNT, ...items]) {
    const entry = menusData.itemIcons[item > K.ITEMS_COUNT ? K.ITEM_NONE : item];
    if (entry) entry.forEach((s) => out.add(s));
  }
  return [...out];
}
