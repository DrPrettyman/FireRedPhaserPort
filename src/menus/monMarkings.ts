// mon_markings.c: the marking-combination sprites (the summary screen's, which holds every combination, and
// the PC's, which holds one) and the markings menu the PC's MARK option opens (a window drawn from the user's
// frame as two 64x64 sprites, the four markings, OK/CANCEL and a cursor).

import { animTable } from '../battle/gfx';
import { gfx, gfx16 } from '../gba/gfx';
import { vram } from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, JOY_NEW } from '../gba/main';
import { menuEnv } from '../gba/menu';
import { PlaySE } from '../gba/sound';
import {
  CalcCenterToCornerVec,
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  StartSpriteAnim,
  ST_OAM_AFFINE_OFF,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { K } from '../battle/constants';

const NUM_MON_MARKINGS = 4;
const ANIM_CURSOR = NUM_MON_MARKINGS * 2;
const ANIM_TEXT = ANIM_CURSOR + 1;
const SELECTION_OK = NUM_MON_MARKINGS;
const SELECTION_CANCEL = SELECTION_OK + 1;

const sOamData_MenuWindow = oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1] });
const sOamData_8x8 = oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1] });
const sOamData_MarkingCombo = oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1] });

/** struct MonMarkingsMenu */
export interface MonMarkingsMenu {
  baseTileTag: number;
  basePaletteTag: number;
  markings: number;
  cursorPos: number;
  markingsArray: boolean[];
  windowSprites: (Sprite | null)[];
  markingSprites: (Sprite | null)[];
  cursorSprite: Sprite | null;
  textSprite: Sprite | null;
  frameTiles: Uint8Array;
  framePalette: Uint16Array;
  windowSpriteTiles: Uint8Array;
  tileLoadState: number;
}

export function newMonMarkingsMenu(): MonMarkingsMenu {
  return {
    baseTileTag: 0,
    basePaletteTag: 0,
    markings: 0,
    cursorPos: 0,
    markingsArray: [false, false, false, false],
    windowSprites: [null, null],
    markingSprites: [null, null, null, null],
    cursorSprite: null,
    textSprite: null,
    frameTiles: new Uint8Array(0),
    framePalette: new Uint16Array(16),
    windowSpriteTiles: new Uint8Array(0x1000),
    tileLoadState: 0,
  };
}

function SpriteCB_Dummy(_sprite: Sprite): void {}

let sMenu: MonMarkingsMenu = newMonMarkingsMenu();

export function InitMonMarkingsMenu(ptr: MonMarkingsMenu): void {
  sMenu = ptr;
}

/** BufferMenuWindowTiles: GetUserWindowGraphics(gSaveBlock2Ptr->optionsWindowFrameType) */
function BufferMenuWindowTiles(): void {
  const frame = `sUserFrame_Type${menuEnv.windowFrameType + 1}`;
  sMenu.frameTiles = gfx(`${frame}_Gfx`);
  sMenu.framePalette = gfx16(`${frame}_Pal`);
  sMenu.tileLoadState = 0;
  sMenu.windowSpriteTiles.fill(0);
}

function BufferMenuFrameTiles(): boolean {
  const T = 32; // TILE_SIZE_4BPP
  const dest = sMenu.tileLoadState * 0x100;
  const copy = (srcTile: number, destOffset: number) => sMenu.windowSpriteTiles.set(sMenu.frameTiles.subarray(srcTile * T, srcTile * T + T), dest + destOffset);
  switch (sMenu.tileLoadState) {
    case 0:
      copy(0, 0);
      for (let i = 0; i < 6; i++) copy(1, T * (i + 1));
      copy(2, T * 7);
      sMenu.tileLoadState++;
      break;
    default:
      copy(3, 0);
      for (let i = 0; i < 6; i++) copy(4, T * (i + 1));
      copy(5, T * 7);
      sMenu.tileLoadState++;
      break;
    case 13:
      copy(6, 0);
      for (let i = 0; i < 6; i++) copy(7, T * (i + 1));
      copy(8, T * 7);
      sMenu.tileLoadState++;
      return false;
    case 14:
      return false;
  }
  return true;
}

export function BufferMonMarkingsMenuTiles(): void {
  BufferMenuWindowTiles();
  while (BufferMenuFrameTiles());
}

export function OpenMonMarkingsMenu(markings: number, x: number, y: number): void {
  sMenu.cursorPos = 0;
  sMenu.markings = markings;
  for (let i = 0; i < NUM_MON_MARKINGS; i++) sMenu.markingsArray[i] = ((sMenu.markings >> i) & 1) !== 0;
  CreateMonMarkingsMenuSprites(x, y, sMenu.baseTileTag, sMenu.basePaletteTag);
}

export function FreeMonMarkingsMenu(): void {
  for (let i = 0; i < 3; i++) FreeSpriteTilesByTag(sMenu.baseTileTag + i);
  FreeSpritePaletteByTag(sMenu.basePaletteTag);
  FreeSpritePaletteByTag(sMenu.basePaletteTag + 1);
  for (let i = 0; i < 2; i++) {
    const s = sMenu.windowSprites[i];
    if (s === null) return;
    DestroySprite(s);
  }
  for (let i = 0; i < NUM_MON_MARKINGS; i++) {
    const s = sMenu.markingSprites[i];
    if (s === null) return;
    DestroySprite(s);
  }
  if (sMenu.cursorSprite) DestroySprite(sMenu.cursorSprite);
  if (sMenu.textSprite) DestroySprite(sMenu.textSprite);
}

/** HandleMonMarkingsMenuInput: FALSE once the menu is closed (markings updated on OK). */
export function HandleMonMarkingsMenuInput(): boolean {
  if (JOY_NEW(DPAD_UP)) {
    PlaySE(K.SE_SELECT);
    if (--sMenu.cursorPos < 0) sMenu.cursorPos = SELECTION_CANCEL;
    return true;
  }
  if (JOY_NEW(DPAD_DOWN)) {
    PlaySE(K.SE_SELECT);
    if (++sMenu.cursorPos > SELECTION_CANCEL) sMenu.cursorPos = 0;
    return true;
  }
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    switch (sMenu.cursorPos) {
      case SELECTION_OK:
        sMenu.markings = 0;
        for (let i = 0; i < NUM_MON_MARKINGS; i++) sMenu.markings |= (sMenu.markingsArray[i] ? 1 : 0) << i;
        return false;
      case SELECTION_CANCEL:
        return false;
    }
    sMenu.markingsArray[sMenu.cursorPos] = !sMenu.markingsArray[sMenu.cursorPos];
    return true;
  }
  if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    return false;
  }
  return true;
}

function CreateMonMarkingsMenuSprites(x: number, y: number, baseTileTag: number, basePaletteTag: number): void {
  LoadSpriteSheet({ data: sMenu.windowSpriteTiles, size: 0x1000, tag: baseTileTag });
  LoadSpriteSheet({ data: gfx('gMonMarkingsMenu_Gfx'), size: 0x320, tag: baseTileTag + 1 });
  LoadSpritePalette({ data: sMenu.framePalette, tag: basePaletteTag });
  LoadSpritePalette({ data: gfx16('gMonMarkingsMenu_Pal'), tag: basePaletteTag + 1 });

  const template: SpriteTemplate = {
    tileTag: baseTileTag,
    paletteTag: basePaletteTag,
    oam: sOamData_MenuWindow,
    anims: animTable('mon_markings.c', 'sAnims_MenuWindow'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_Dummy,
  };

  // Create window sprites
  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(template, x + 32, y + 32, 1);
    if (spriteId !== MAX_SPRITES) {
      sMenu.windowSprites[i] = gSprites[spriteId];
      StartSpriteAnim(gSprites[spriteId], i);
    } else {
      sMenu.windowSprites[i] = null;
      return;
    }
  }
  sMenu.windowSprites[1]!.y = y + 96;

  // Create marking sprites
  const markTemplate: SpriteTemplate = {
    ...template,
    tileTag: template.tileTag + 1,
    paletteTag: template.paletteTag + 1,
    anims: animTable('mon_markings.c', 'sAnims_MenuSprite'),
    callback: SpriteCB_Marking,
    oam: sOamData_8x8,
  };
  for (let i = 0; i < NUM_MON_MARKINGS; i++) {
    const spriteId = CreateSprite(markTemplate, x + 32, y + 16 + 16 * i, 0);
    if (spriteId !== MAX_SPRITES) {
      sMenu.markingSprites[i] = gSprites[spriteId];
      gSprites[spriteId].data[0] = i;
    } else {
      sMenu.markingSprites[i] = null;
      return;
    }
  }

  // Create OK/Cancel text sprite
  let spriteId = CreateSprite({ ...markTemplate, callback: SpriteCB_Dummy }, 0, 0, 0);
  if (spriteId !== MAX_SPRITES) {
    const s = gSprites[spriteId];
    sMenu.textSprite = s;
    s.oam.shape = SPRITE_SHAPE['32x32'][0];
    s.oam.size = SPRITE_SHAPE['32x32'][1];
    StartSpriteAnim(s, ANIM_TEXT);
    s.x = x + 32;
    s.y = y + 80;
    CalcCenterToCornerVec(s, SPRITE_SHAPE['32x16'][0], SPRITE_SHAPE['32x16'][1], ST_OAM_AFFINE_OFF);
  } else {
    sMenu.textSprite = null;
  }

  // Create cursor sprite
  spriteId = CreateSprite({ ...markTemplate, callback: SpriteCB_Cursor }, x + 12, 0, 0);
  if (spriteId !== MAX_SPRITES) {
    sMenu.cursorSprite = gSprites[spriteId];
    sMenu.cursorSprite.data[0] = y + 16;
    StartSpriteAnim(sMenu.cursorSprite, ANIM_CURSOR);
  } else {
    sMenu.cursorSprite = null;
  }
}

function SpriteCB_Marking(sprite: Sprite): void {
  if (sMenu.markingsArray[sprite.data[0]]) StartSpriteAnim(sprite, 2 * sprite.data[0] + 1); // Set marking 'on'
  else StartSpriteAnim(sprite, 2 * sprite.data[0]); // Set marking 'off'
}

function SpriteCB_Cursor(sprite: Sprite): void {
  sprite.y = 16 * sMenu.cursorPos + sprite.data[0];
}

/** CreateMonMarkingAllCombosSprite: one sheet holding every combination; the anim picks one (summary screen). */
export function CreateMonMarkingAllCombosSprite(tileTag: number, paletteTag: number, palette: Uint16Array | null): Sprite | null {
  return CreateMarkingComboSprite(tileTag, paletteTag, palette ?? gfx16('sMonMarkings_Pal'), 1 << K.NUM_MON_MARKINGS);
}

/** CreateMonMarkingComboSprite: a sheet holding one combination (the PC's selected mon), see UpdateMonMarkingTiles. */
export function CreateMonMarkingComboSprite(tileTag: number, paletteTag: number, palette: Uint16Array | null): Sprite | null {
  return CreateMarkingComboSprite(tileTag, paletteTag, palette ?? gfx16('sMonMarkings_Pal'), 1);
}

function CreateMarkingComboSprite(tileTag: number, paletteTag: number, palette: Uint16Array, size: number): Sprite | null {
  LoadSpriteSheet({ data: gfx('sMonMarkings_Gfx'), size: size * 0x80, tag: tileTag });
  LoadSpritePalette({ data: palette, tag: paletteTag });
  const spriteId = CreateSprite(
    {
      tileTag,
      paletteTag,
      oam: sOamData_MarkingCombo,
      anims: animTable('mon_markings.c', 'sAnims_MarkingCombo'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCB_Dummy,
    },
    0,
    0,
    0,
  );
  return spriteId !== MAX_SPRITES ? gSprites[spriteId] : null;
}

/** UpdateMonMarkingTiles: copy one combination's tiles to `dest` (an OBJ VRAM address). */
export function UpdateMonMarkingTiles(markings: number, dest: number): void {
  vram.set(gfx('sMonMarkings_Gfx').subarray(0x80 * markings, 0x80 * markings + 0x80), dest);
}
