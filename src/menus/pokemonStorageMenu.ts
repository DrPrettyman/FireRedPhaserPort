// pokemon_storage_system_menu.c (the GBA-layer half): text rendered into sprite tiles
// (DrawTextWindowAndBufferTiles for the box titles, PrintStringToBufferCopyNow for the popup) and the
// "Deposit in / Jump to which BOX?" popup (ChooseBoxMenu). The PC's storage menu (Task_PCMainMenu) runs on
// the field: ui/StoragePcMenu.ts. ResetPokemonStorageSystem / GetFirstFreeBoxSpot / CountMonsInBox are in
// state/PokemonStorage.ts.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { gfx } from '../gba/gfx';
import { OBJ_VRAM0, vram } from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_LEFT, DPAD_RIGHT, JOY_NEW } from '../gba/main';
import { PlaySE } from '../gba/sound';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { animTable } from '../battle/gfx';
import { gfx16 } from '../gba/gfx';
import { AddTextPrinterParameterized4, AddWindow, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, gWindows, PIXEL_FILL, RemoveWindow } from '../gba/window';
import { ConvertIntToDecimalStringN, EOS, encodeRaw, strBody, STR_CONV_MODE_RIGHT_ALIGN } from './common';
import { CreateChooseBoxArrows } from './pokemonStorageGraphics';

/** struct ChooseBoxMenu */
export interface ChooseBoxMenu {
  menuSprite: Sprite | null;
  menuCornerSprites: (Sprite | null)[];
  arrowSprites: (Sprite | null)[];
  strbuf: number[];
  loadedPalette: boolean;
  tileTag: number;
  paletteTag: number;
  curBox: number;
  subpriority: number;
}

export function newChooseBoxMenu(): ChooseBoxMenu {
  return { menuSprite: null, menuCornerSprites: [null, null, null, null], arrowSprites: [null, null], strbuf: [EOS], loadedPalette: false, tileTag: 0, paletteTag: 0, curBox: 0, subpriority: 0 };
}

let sChooseBoxMenu: ChooseBoxMenu = newChooseBoxMenu();

/**
 * DrawTextWindowAndBufferTiles: print into a 24x2-tile window and copy `bytesToBuffer` 32x16 blocks
 * (two rows of four tiles each, 1D sprite layout) into `dst`.
 */
export function DrawTextWindowAndBufferTiles(str: number[], dst: Uint8Array, zero1: number, zero2: number, bytesToBuffer: number): void {
  const windowId = AddWindow({ ...DUMMY_WIN_TEMPLATE, bg: 0, width: 24, height: 2 });
  FillWindowPixelBuffer(windowId, PIXEL_FILL(zero2));
  const tileData = gWindows[windowId].tileData!;
  let src1 = 0;
  let src2 = 24 * 32;
  const txtColor = [zero1 ? zero2 : K.TEXT_COLOR_TRANSPARENT, K.TEXT_DYNAMIC_COLOR_6, K.TEXT_DYNAMIC_COLOR_5];
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL_COPY_1, 0, 2, 0, 0, txtColor, -1, str);

  const tileBytesToBuffer = Math.min(bytesToBuffer, 6);
  let d = 0;
  for (let i = tileBytesToBuffer; i > 0; i--) {
    dst.set(tileData.subarray(src1, src1 + 0x80), d);
    dst.set(tileData.subarray(src2, src2 + 0x80), d + 0x80);
    src1 += 0x80;
    src2 += 0x80;
    d += 0x100;
  }
  RemoveWindow(windowId);
}

/** PrintStringToBufferCopyNow: the text's two tile rows go to `dst` and `dst + offset` in OBJ VRAM. */
function PrintStringToBufferCopyNow(str: number[], dst: number, offset: number, bgColor: number, fgColor: number, shadowColor: number): void {
  const width = strBody(str).length; // StringLength_Multibyte
  const size = width * 32;
  const windowId = AddWindow({ ...DUMMY_WIN_TEMPLATE, bg: 0, width, height: 2 });
  FillWindowPixelBuffer(windowId, PIXEL_FILL(bgColor));
  const tileData = gWindows[windowId].tileData!;
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL_COPY_1, 0, 2, 0, 0, [bgColor, fgColor, shadowColor], -1, str);
  vram.set(tileData.subarray(0, size), dst);
  vram.set(tileData.subarray(size, size * 2), dst + offset);
  RemoveWindow(windowId);
}

/** LoadChooseBoxMenuGfx (loadPal is always FALSE) */
export function LoadChooseBoxMenuGfx(menu: ChooseBoxMenu, tileTag: number, palTag: number, subpriority: number, loadPal: boolean): void {
  if (loadPal) LoadSpritePalette({ data: gfx16('sChooseBoxMenu_Pal'), tag: palTag });
  LoadSpriteSheet({ data: gfx('sChooseBoxMenuCenter_Gfx'), size: 0x800, tag: tileTag });
  LoadSpriteSheet({ data: gfx('sChooseBoxMenuCorners_Gfx'), size: 0x180, tag: tileTag + 1 });
  sChooseBoxMenu = menu;
  menu.tileTag = tileTag;
  menu.paletteTag = palTag;
  menu.subpriority = subpriority;
  menu.loadedPalette = loadPal;
}

export function FreeBoxSelectionPopupSpriteGfx(): void {
  if (sChooseBoxMenu.loadedPalette) FreeSpritePaletteByTag(sChooseBoxMenu.paletteTag);
  FreeSpriteTilesByTag(sChooseBoxMenu.tileTag);
  FreeSpriteTilesByTag(sChooseBoxMenu.tileTag + 1);
}

export function CreateChooseBoxMenuSprites(curBox: number): void {
  ChooseBoxMenu_CreateSprites(curBox);
}

export function DestroyChooseBoxMenuSprites(): void {
  ChooseBoxMenu_DestroySprites();
}

/** HandleBoxChooseSelectionInput: the chosen box, BOXID_CANCELED or BOXID_NONE_CHOSEN. */
export function HandleBoxChooseSelectionInput(): number {
  if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    return K.BOXID_CANCELED;
  }
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    return sChooseBoxMenu.curBox;
  }
  if (JOY_NEW(DPAD_LEFT)) {
    PlaySE(K.SE_SELECT);
    ChooseBoxMenu_MoveLeft();
  } else if (JOY_NEW(DPAD_RIGHT)) {
    PlaySE(K.SE_SELECT);
    ChooseBoxMenu_MoveRight();
  }
  return K.BOXID_NONE_CHOSEN;
}

function ChooseBoxMenu_CreateSprites(curBox: number): void {
  const menuOam = oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], paletteNum: 1 });
  const template: SpriteTemplate = {
    tileTag: sChooseBoxMenu.tileTag,
    paletteTag: sChooseBoxMenu.paletteTag,
    oam: menuOam,
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
  sChooseBoxMenu.curBox = curBox;

  let spriteId = CreateSprite(template, 160, 96, 0);
  sChooseBoxMenu.menuSprite = gSprites[spriteId];

  const cornerTemplate: SpriteTemplate = {
    ...template,
    tileTag: sChooseBoxMenu.tileTag + 1,
    oam: oam({ shape: SPRITE_SHAPE['8x32'][0], size: SPRITE_SHAPE['8x32'][1], paletteNum: 1 }),
    anims: animTable('pokemon_storage_system_menu.c', 'sAnims_ChooseBoxMenu'),
  };
  for (let i = 0; i < 4; i++) {
    // corner sprites are created in order of top left, bottom left, top right, bottom right
    spriteId = CreateSprite(cornerTemplate, 124, 80, sChooseBoxMenu.subpriority); // place at top left
    const corner = gSprites[spriteId];
    sChooseBoxMenu.menuCornerSprites[i] = corner;
    let animNum = 0;
    if (i & 2) {
      corner.x = 196; // move to bottom
      animNum = 2;
    }
    if (i & 1) {
      corner.y = 112; // move to right
      corner.oam.size = SPRITE_SHAPE['8x16'][1];
      animNum++;
    }
    StartSpriteAnim(corner, animNum);
  }
  for (let i = 0; i < 2; i++) {
    const arrow = CreateChooseBoxArrows(72 * i + 124, 88, i, 0, sChooseBoxMenu.subpriority);
    sChooseBoxMenu.arrowSprites[i] = arrow;
    if (arrow) {
      arrow.data[0] = i === 0 ? -1 : 1;
      arrow.callback = SpriteCB_ChooseBoxArrow;
    }
  }
  ChooseBoxMenu_PrintBoxNameAndCount();
  ChooseBoxMenu_PrintTextToSprite(encodeRaw('/30$'), 5, 3); // sText_OutOf30
}

function ChooseBoxMenu_DestroySprites(): void {
  if (sChooseBoxMenu.menuSprite) {
    DestroySprite(sChooseBoxMenu.menuSprite);
    sChooseBoxMenu.menuSprite = null;
  }
  for (let i = 0; i < 4; i++) {
    const s = sChooseBoxMenu.menuCornerSprites[i];
    if (s) {
      DestroySprite(s);
      sChooseBoxMenu.menuCornerSprites[i] = null;
    }
  }
  for (let i = 0; i < 2; i++) {
    const s = sChooseBoxMenu.arrowSprites[i];
    if (s) DestroySprite(s);
  }
}

function ChooseBoxMenu_MoveRight(): void {
  if (++sChooseBoxMenu.curBox >= K.TOTAL_BOXES_COUNT) sChooseBoxMenu.curBox = 0;
  ChooseBoxMenu_PrintBoxNameAndCount();
}

function ChooseBoxMenu_MoveLeft(): void {
  sChooseBoxMenu.curBox = sChooseBoxMenu.curBox === 0 ? K.TOTAL_BOXES_COUNT - 1 : sChooseBoxMenu.curBox - 1;
  ChooseBoxMenu_PrintBoxNameAndCount();
}

function ChooseBoxMenu_PrintBoxNameAndCount(): void {
  const numMonInBox = state.storage.countMonsInBox(sChooseBoxMenu.curBox);
  const name = [...(state.storage.getBoxName(sChooseBoxMenu.curBox) ?? [])];
  while (name.length < K.BOX_NAME_LENGTH) name.push(K.CHAR_SPACE);
  sChooseBoxMenu.strbuf = [...name, EOS];
  ChooseBoxMenu_PrintTextToSprite(sChooseBoxMenu.strbuf, 0, 1);
  sChooseBoxMenu.strbuf = ConvertIntToDecimalStringN(numMonInBox, STR_CONV_MODE_RIGHT_ALIGN, 2);
  ChooseBoxMenu_PrintTextToSprite(sChooseBoxMenu.strbuf, 3, 3);
}

function ChooseBoxMenu_PrintTextToSprite(str: number[], x: number, y: number): void {
  const dst = OBJ_VRAM0 + GetSpriteTileStartByTag(sChooseBoxMenu.tileTag) * 32 + 256 * y + 32 * x;
  PrintStringToBufferCopyNow(str, dst, 0x100, K.TEXT_COLOR_RED, K.TEXT_DYNAMIC_COLOR_6, K.TEXT_DYNAMIC_COLOR_5);
}

function SpriteCB_ChooseBoxArrow(sprite: Sprite): void {
  if (++sprite.data[1] > 3) {
    sprite.data[1] = 0;
    sprite.x2 += sprite.data[0];
    if (++sprite.data[2] > 5) {
      sprite.data[2] = 0;
      sprite.x2 = 0;
    }
  }
}

/** The popup's box (test probe). */
export function ChooseBoxMenuCurBox(): number {
  return sChooseBoxMenu.curBox;
}
