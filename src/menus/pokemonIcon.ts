// pokemon_icon.c: animated party icons. The sprite's own anim is paused; UpdateMonIconFrame copies
// each frame of the icon into the sprite's tiles itself.

import { K } from '../battle/constants';
import { animTable, affineAnimTable } from '../battle/gfx';
import { gfx, gfx16 } from '../gba/gfx';
import {
  CreateSprite,
  DestroySprite,
  FreeSpritePaletteByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  oam,
  RequestSpriteCopy,
  SPRITE_SHAPE,
  TAG_NONE,
  type Sprite,
  type SpriteCallback,
  TILE_SIZE_4BPP,
} from '../gba/sprite';
import { OBJ_VRAM0 } from '../gba/hw';
import { menusData } from './data';

const POKE_ICON_BASE_PAL_TAG = 56000;

/** sSpriteImageSizes[shape][size] */
const sSpriteImageSizes = [
  [0x020, 0x080, 0x200, 0x800],
  [0x040, 0x080, 0x100, 0x400],
  [0x040, 0x080, 0x100, 0x400],
];

const sMonIconOamData = oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 });

/**
 * gMonIconPaletteTable: three real palettes; entries 3-5 point past gMonIconPalettes (never used
 * for drawing, but LoadMonIconPalettes still allocates their slots).
 */
function monIconPalette(index: number): Uint16Array {
  return index < 3 ? gfx16('gMonIconPalettes').subarray(index * 16, index * 16 + 16) : new Uint16Array(16);
}
const MON_ICON_PALETTE_TABLE_COUNT = 6;

function paletteIndex(species: number): number {
  return menusData.monIconPaletteIndices[species] ?? 0;
}

export function CreateMonIcon(species: number, callback: SpriteCallback, x: number, y: number, subpriority: number, personality: number, extra: boolean): number {
  let paletteTag = POKE_ICON_BASE_PAL_TAG + paletteIndex(species);
  if (species > K.NUM_SPECIES) paletteTag = POKE_ICON_BASE_PAL_TAG;
  const spriteId = CreateMonIconSprite(GetMonIconPtr(species, personality, extra), callback, paletteTag, x, y, subpriority);
  UpdateMonIconFrame(gSprites[spriteId]);
  return spriteId;
}

/** CreateMonIcon_HandleDeoxys: an icon for an icon species as it is (the Unown letters past NUM_SPECIES too: the mail screen). */
export function CreateMonIcon_HandleDeoxys(species: number, callback: SpriteCallback, x: number, y: number, subpriority: number, extra: boolean): number {
  const spriteId = CreateMonIconSprite(GetMonIconTiles(species, extra), callback, POKE_ICON_BASE_PAL_TAG + paletteIndex(species), x, y, subpriority);
  UpdateMonIconFrame(gSprites[spriteId]);
  return spriteId;
}

/** LoadMonIconPalette: the icon species' palette, unless its tag is loaded already (no NUM_SPECIES check, unlike SafeLoadMonIconPalette). */
export function LoadMonIconPalette(species: number): void {
  const palIndex = paletteIndex(species);
  if (IndexOfSpritePaletteTag(POKE_ICON_BASE_PAL_TAG + palIndex) === 0xff) LoadSpritePalette({ data: monIconPalette(palIndex), tag: POKE_ICON_BASE_PAL_TAG + palIndex });
}

/** FreeMonIconPalette */
export function FreeMonIconPalette(species: number): void {
  FreeSpritePaletteByTag(POKE_ICON_BASE_PAL_TAG + paletteIndex(species));
}

export function GetIconSpecies(species: number, personality: number): number {
  if (species === K.SPECIES_UNOWN) {
    let letter = GetUnownLetterByPersonality(personality);
    if (letter === 0) letter = K.SPECIES_UNOWN;
    else letter += K.SPECIES_UNOWN_B - 1;
    return letter;
  }
  return species > K.NUM_SPECIES ? K.SPECIES_NONE : species;
}

export function GetUnownLetterByPersonality(personality: number): number {
  if (!personality) return 0;
  return (((personality & 0x3000000) >>> 18) | ((personality & 0x30000) >>> 12) | ((personality & 0x300) >>> 6) | (personality & 0x3)) % 0x1c;
}

/** The icon graphics symbol for an icon species (GetMonIconTiles' table lookup). */
export function monIconSymbol(species: number): string {
  return menusData.monIcons[species] ?? menusData.monIcons[0]!;
}

export function GetMonIconTiles(species: number, extra: boolean): Uint8Array {
  const iconSprite = gfx(monIconSymbol(species));
  if (species === K.SPECIES_DEOXYS && extra) return iconSprite.subarray(0x400);
  return iconSprite;
}

export function GetMonIconPtr(species: number, personality: number, extra: boolean): Uint8Array {
  return GetMonIconTiles(GetIconSpecies(species, personality), extra);
}

export function DestroyMonIcon(sprite: Sprite): void {
  DestroyMonIconInternal(sprite);
}

export function LoadMonIconPalettes(): void {
  for (let i = 0; i < MON_ICON_PALETTE_TABLE_COUNT; i++) LoadSpritePalette({ data: monIconPalette(i), tag: POKE_ICON_BASE_PAL_TAG + i });
}

export function SafeLoadMonIconPalette(species: number): void {
  if (species > K.NUM_SPECIES) species = K.SPECIES_NONE;
  const palIndex = paletteIndex(species);
  if (IndexOfSpritePaletteTag(POKE_ICON_BASE_PAL_TAG + palIndex) === 0xff) LoadSpritePalette({ data: monIconPalette(palIndex), tag: POKE_ICON_BASE_PAL_TAG + palIndex });
}

export function SafeFreeMonIconPalette(species: number): void {
  if (species > K.NUM_SPECIES) species = K.SPECIES_NONE;
  FreeSpritePaletteByTag(POKE_ICON_BASE_PAL_TAG + paletteIndex(species));
}

export function FreeMonIconPalettes(): void {
  for (let i = 0; i < MON_ICON_PALETTE_TABLE_COUNT; i++) FreeSpritePaletteByTag(POKE_ICON_BASE_PAL_TAG + i);
}

export function SpriteCB_MonIcon(sprite: Sprite): void {
  UpdateMonIconFrame(sprite);
}

export function GetValidMonIconPalettePtr(species: number): Uint16Array {
  if (species > K.NUM_SPECIES) species = K.SPECIES_NONE;
  return monIconPalette(paletteIndex(species));
}

/** UpdateMonIconFrame: returns the new anim command index when a frame was copied, else 0. */
export function UpdateMonIconFrame(sprite: Sprite): number {
  let result = 0;
  if (sprite.animDelayCounter === 0) {
    const cmd = sprite.anims[sprite.animNum][sprite.animCmdIndex];
    // frame.imageValue overlaps the command type: -1 = END, -2 = JUMP
    const frame = cmd.type;
    switch (frame) {
      case -1:
        break;
      case -2:
        sprite.animCmdIndex = 0;
        break;
      default: {
        const size = sSpriteImageSizes[sprite.oam.shape][sprite.oam.size];
        RequestSpriteCopy(sprite.images![0].data.subarray(size * frame), OBJ_VRAM0 + sprite.oam.tileNum * TILE_SIZE_4BPP, size);
        sprite.animDelayCounter = (cmd.duration ?? 0) & 0xff;
        sprite.animCmdIndex++;
        result = sprite.animCmdIndex;
        break;
      }
    }
  } else {
    sprite.animDelayCounter--;
  }
  return result;
}

function CreateMonIconSprite(image: Uint8Array, callback: SpriteCallback, paletteTag: number, x: number, y: number, subpriority: number): number {
  const size = sSpriteImageSizes[sMonIconOamData.shape][sMonIconOamData.size];
  const spriteId = CreateSprite(
    {
      tileTag: TAG_NONE,
      paletteTag,
      oam: sMonIconOamData,
      anims: animTable('pokemon_icon.c', 'sMonIconAnims'),
      images: [{ data: image, size }],
      affineAnims: affineAnimTable('pokemon_icon.c', 'sMonIconAffineAnims'),
      callback,
    },
    x,
    y,
    subpriority,
  );
  gSprites[spriteId].animPaused = true;
  gSprites[spriteId].animBeginning = false;
  return spriteId;
}

function DestroyMonIconInternal(sprite: Sprite): void {
  DestroySprite(sprite);
}

export function SetPartyHPBarSprite(sprite: Sprite, animNum: number): void {
  sprite.animNum = animNum;
  sprite.animDelayCounter = 0;
  sprite.animCmdIndex = 0;
}
