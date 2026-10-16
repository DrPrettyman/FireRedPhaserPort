// battle_anim_smokescreen.c: SmokescreenImpact, the four-part smoke cloud of Smokescreen
// (AnimTask_SmokescreenImpact). The file's enemy shadow template lives with the rest of the shadow code in
// ../gfx.ts.

import { gfx, gfx16 } from '../../gba/gfx';
import {
  AnimateSprite,
  CreateInvisibleSprite,
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  LoadCompressedSpritePalette,
  LoadCompressedSpriteSheet,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  TAG_NONE,
  type Sprite,
  type SpriteTemplate,
} from '../../gba/sprite';
import { animTable } from '../gfx';

const TAG_SMOKESCREEN = 55019;
export const SMOKESCREEN_GFX = ['gSmokescreenImpactTiles', 'gSmokescreenImpactPalette'];

let template: SpriteTemplate | undefined;

/** sSmokescreenImpactSpriteTemplate */
function smokescreenImpactTemplate(): SpriteTemplate {
  template ??= {
    tileTag: TAG_SMOKESCREEN,
    paletteTag: TAG_SMOKESCREEN,
    oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1 }),
    anims: animTable('battle_anim_smokescreen.c', 'sAnims_SmokescreenImpact'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_SmokescreenImpact,
  };
  return template;
}

// data[0] of the main sprite: sActiveSprites; data[1]: sPersist. data[0] of each part: sMainSpriteId.

/** SmokescreenImpact: four smoke quarters around (x, y), each flipped to face out. Returns the main sprite. */
export function SmokescreenImpact(x: number, y: number, persist: boolean): number {
  if (GetSpriteTileStartByTag(TAG_SMOKESCREEN) === TAG_NONE) {
    LoadCompressedSpriteSheet({ data: gfx('gSmokescreenImpactTiles'), size: 0x180, tag: TAG_SMOKESCREEN });
    LoadCompressedSpritePalette({ data: gfx16('gSmokescreenImpactPalette'), tag: TAG_SMOKESCREEN });
  }
  const mainSpriteId = CreateInvisibleSprite(SpriteCB_SmokescreenImpactMain);
  const mainSprite = gSprites[mainSpriteId];
  mainSprite.data[1] = +persist;
  const parts: [number, number][] = [
    [x - 16, y - 16], // top left
    [x, y - 16], // top right
    [x - 16, y], // bottom left
    [x, y], // bottom right
  ];
  for (const [i, [px, py]] of parts.entries()) {
    const spriteId = CreateSprite(smokescreenImpactTemplate(), px, py, 2);
    gSprites[spriteId].data[0] = mainSpriteId;
    mainSprite.data[0]++;
    if (i) StartSpriteAnim(gSprites[spriteId], i);
    AnimateSprite(gSprites[spriteId]);
  }
  return mainSpriteId;
}

function SpriteCB_SmokescreenImpactMain(sprite: Sprite): void {
  if (sprite.data[0] === 0) {
    FreeSpriteTilesByTag(TAG_SMOKESCREEN);
    FreeSpritePaletteByTag(TAG_SMOKESCREEN);
    if (!sprite.data[1]) DestroySprite(sprite);
    else sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_SmokescreenImpact(sprite: Sprite): void {
  if (sprite.animEnded) {
    gSprites[sprite.data[0]].data[0]--;
    DestroySprite(sprite);
  }
}
