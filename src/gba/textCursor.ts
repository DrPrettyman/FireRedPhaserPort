// text.c's text cursor sprite: the bobbing double arrow (CreateTextCursorSprite / DestroyTextCursorSprite) that the
// controls guide and the Pikachu intro before Oak's speech show in a corner.

import { gfx, gfx16 } from './gfx';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  SPRITE_SHAPE,
  type Sprite,
  type SpriteTemplate,
} from './sprite';

const TAG_CURSOR = 0x8000;
const CURSOR_DELAY = 8;

/** The cursor sheets and palette, for preloading. */
export const textCursorGfxSymbols = ['sDoubleArrowTiles1', 'sDoubleArrowTiles2', 'gStandardMenuPalette'];

const sDelay = 0;
const sState = 1;

function SpriteCB_TextCursor(sprite: Sprite): void {
  if (sprite.data[sDelay]) {
    sprite.data[sDelay]--;
    return;
  }
  sprite.data[sDelay] = CURSOR_DELAY;
  switch (sprite.data[sState]) {
    case 0:
      sprite.y2 = 0;
      break;
    case 1:
      sprite.y2 = 1;
      break;
    case 2:
      sprite.y2 = 2;
      break;
    case 3:
      sprite.y2 = 1;
      sprite.data[sState] = 0;
      return;
  }
  sprite.data[sState]++;
}

const sSpriteTemplate_TextCursor = (): SpriteTemplate => ({
  tileTag: TAG_CURSOR,
  paletteTag: TAG_CURSOR,
  oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1] }), // gOamData_AffineOff_ObjNormal_16x16
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_TextCursor,
});

/** CreateTextCursorSprite */
export function CreateTextCursorSprite(sheetId: number, x: number, y: number, priority: number, subpriority: number): number {
  const tiles = gfx(sheetId & 1 ? 'sDoubleArrowTiles2' : 'sDoubleArrowTiles1');
  LoadSpriteSheet({ data: tiles, size: tiles.length, tag: TAG_CURSOR });
  LoadSpritePalette({ data: gfx16('gStandardMenuPalette'), tag: TAG_CURSOR });
  const spriteId = CreateSprite(sSpriteTemplate_TextCursor(), x + 3, y + 4, subpriority);
  gSprites[spriteId].oam.priority = priority & 3;
  gSprites[spriteId].oam.matrixNum = 0;
  gSprites[spriteId].data[sDelay] = CURSOR_DELAY;
  return spriteId;
}

/** DestroyTextCursorSprite */
export function DestroyTextCursorSprite(spriteId: number): void {
  DestroySprite(gSprites[spriteId]);
  FreeSpriteTilesByTag(TAG_CURSOR);
  FreeSpritePaletteByTag(TAG_CURSOR);
}
