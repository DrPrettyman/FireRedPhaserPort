// The field weathers' sprites (field_weather_effects.c's sprite templates, anims and callbacks): the weather's share of
// sprite.c's gSprites, in plain TS so the unit tests can run them. The weathers (world/weatherRain.ts, ...) create
// and destroy sprites here as the C does (LoadSpriteSheet, CreateSprite / CreateSpriteAtEnd with a SpriteTemplate,
// DestroySprite, FreeSpriteTilesByTag), set their fields and callbacks (a gba/sprite.ts `Sprite`: x / y, x2 / y2,
// data[], invisible, coordOffsetEnabled, StartSpriteAnim, oam.priority / objMode), and the field runs
// AnimateWeatherSprites once a frame right after the weather task (AnimateSprites: each sprite's callback, then its
// frame anim). The field's renderer (world/weatherSpriteRenderer.ts) only draws what BuildWeatherOam gives it:
// UpdateOamCoords (x + x2 + centerToCornerVec, plus gSpriteCoordOffsetX / Y where coordOffsetEnabled) and
// SortSprites' order.
//
// A sheet is its tiles' gfx symbol (gWeatherRainTiles, ...); a sprite's frame is the tile offset its anim sets
// (oam.tileNum: sheetTileStart is 0 for every weather sheet), its size the OAM shape. The weather's palette is one
// slot (PALTAG_WEATHER: gDefaultWeatherSpritePalette, or LoadCustomWeatherSpritePalette's), shown through the
// weather's GAMMA_ALT gamma row (world/weather.ts objGammaTable('alt'): ApplyGammaShift's altGammaSpritePalIndex).
//
// The pool has MAX_SPRITES slots of its own: CreateSpriteAtEnd takes the highest free one and CreateSprite the
// lowest, so the weather's sprites keep their relative OAM order. On the GBA they share gSprites with the field's
// objects, so a weather that wants many sprites can run out sooner there (docs/DEVIATIONS.md).

import { DISPLAY_HEIGHT } from '../gba/hw';
import {
  AnimateSprite,
  CalcCenterToCornerVec,
  MAX_SPRITES,
  Sprite,
  ST_OAM_AFFINE_DOUBLE,
  ST_OAM_HFLIP,
  ST_OAM_OBJ_BLEND,
  ST_OAM_SQUARE,
  ST_OAM_V_RECTANGLE,
  ST_OAM_VFLIP,
  sOamDimensions,
  type SpriteTemplate,
} from '../gba/sprite';

export { MAX_SPRITES };

// include/field_weather.h: the weathers' sprite tags (TAG_WEATHER_START's enums)
export const TAG_WEATHER_START = 0x1200;
export const GFXTAG_CLOUD = TAG_WEATHER_START;
export const GFXTAG_FOG_H = TAG_WEATHER_START + 1;
export const GFXTAG_ASH = TAG_WEATHER_START + 2;
export const GFXTAG_FOG_D = TAG_WEATHER_START + 3;
export const GFXTAG_SANDSTORM = TAG_WEATHER_START + 4;
export const GFXTAG_BUBBLE = TAG_WEATHER_START + 5;
export const GFXTAG_RAIN = TAG_WEATHER_START + 6;
export const PALTAG_WEATHER = TAG_WEATHER_START;

/** Every weather sheet's tiles and the weather palettes (tools/extract_gfx.py's graphics/weather/): the field preloads them. */
export const WEATHER_GFX = [
  'gDefaultWeatherSpritePalette',
  'gCloudsWeatherPalette',
  'gSandstormWeatherPalette',
  'gWeatherFogDiagonalTiles',
  'gWeatherFogHorizontalTiles',
  'gWeatherCloudTiles',
  'gWeatherSnow1Tiles',
  'gWeatherSnow2Tiles',
  'gWeatherBubbleTiles',
  'gWeatherAshTiles',
  'gWeatherRainTiles',
  'gWeatherSandstormTiles',
];

/** struct SpriteSheet, with the tiles as their gfx symbol. */
export interface WeatherSpriteSheet {
  data: string;
  size: number;
  tag: number;
}

/** The weather's gSprites (sprite ids are indices here; MAX_SPRITES = none). */
export const gWeatherSprites: Sprite[] = Array.from({ length: MAX_SPRITES }, () => new Sprite());
/** The sheets loaded (LoadSpriteSheet), by tag. */
const sheets = new Map<number, WeatherSpriteSheet>();
/** The weather palette's colours as loaded (gPlttBufferUnfaded at weatherPicSpritePalIndex): a gfx16 symbol. */
let weatherPalette = 'gDefaultWeatherSpritePalette';
/** Bumped whenever the sprites' drawing inputs change outside the sprites (a sheet, the palette). */
let version = 0;

/** LoadSpriteSheet: the sheet's tiles under its tag (once per tag). */
export function LoadSpriteSheet(sheet: WeatherSpriteSheet): void {
  if (sheets.get(sheet.tag)?.data === sheet.data) return;
  sheets.set(sheet.tag, sheet);
  version++;
}

/** FreeSpriteTilesByTag */
export function FreeSpriteTilesByTag(tag: number): void {
  if (sheets.delete(tag)) version++;
}

/** The sheet loaded under a tag (the renderer draws frames from it). */
export function weatherSpriteSheet(tag: number): WeatherSpriteSheet | undefined {
  return sheets.get(tag);
}

/** The weather palette slot's colours as loaded: StartWeather's gDefaultWeatherSpritePalette or LoadCustomWeatherSpritePalette's. */
export function setWeatherSpritePalette(symbol: string): void {
  if (weatherPalette === symbol) return;
  weatherPalette = symbol;
  version++;
}

export function weatherSpritePalette(): string {
  return weatherPalette;
}

/** Changes when a sheet or the palette does (the renderer's cache key). */
export function weatherSpritesVersion(): number {
  return version;
}

/** CreateSprite: the lowest free slot. */
export function CreateSprite(template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  for (let i = 0; i < MAX_SPRITES; i++) if (!gWeatherSprites[i].inUse) return CreateSpriteAt(i, template, x, y, subpriority);
  return MAX_SPRITES;
}

/** CreateSpriteAtEnd: the highest free slot. */
export function CreateSpriteAtEnd(template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  for (let i = MAX_SPRITES - 1; i >= 0; i--) if (!gWeatherSprites[i].inUse) return CreateSpriteAt(i, template, x, y, subpriority);
  return MAX_SPRITES;
}

const s16 = (v: number) => (v << 16) >> 16;

/** CreateSpriteAt for a sheet sprite (the weathers' templates all have a tileTag and no images). */
function CreateSpriteAt(index: number, template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  const sprite = gWeatherSprites[index];
  sprite.reset();
  sprite.inUse = true;
  sprite.animBeginning = true;
  sprite.affineAnimBeginning = true;
  sprite.usingSheet = true;
  sprite.subpriority = subpriority & 0xff;
  sprite.oam = { ...template.oam };
  sprite.anims = template.anims;
  sprite.affineAnims = template.affineAnims;
  sprite.template = template;
  sprite.callback = template.callback;
  sprite.x = s16(x);
  sprite.y = s16(y);
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
  sprite.sheetTileStart = 0; // GetSpriteTileStartByTag: frames are tile offsets into the tag's own sheet
  const tileOffset = sprite.anims[sprite.animNum][sprite.animCmdIndex].imageValue ?? 0; // SetSpriteSheetFrameTileNum
  sprite.oam.tileNum = Math.max(0, tileOffset) & 0x3ff;
  return index;
}

/** DestroySprite */
export function DestroySprite(sprite: Sprite): void {
  if (sprite.inUse) sprite.reset();
}

/**
 * The map load's ResetSpriteData and FreeSpriteTileRanges for the weather's sprites (StartWeather in the port: the
 * GBA's map load freed them; the port's outlive it).
 */
export function ResetWeatherSprites(): void {
  for (const s of gWeatherSprites) if (s.inUse) s.reset();
  sheets.clear();
  weatherPalette = 'gDefaultWeatherSpritePalette';
  version++;
}

/** AnimateSprites for the weather's sprites: each one's callback, then (if it's still there) its frame anim. */
export function AnimateWeatherSprites(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    const sprite = gWeatherSprites[i];
    if (sprite.inUse) {
      sprite.callback(sprite);
      if (sprite.inUse) AnimateSprite(sprite);
    }
  }
}

/** The weather sprites that are up (in slot order). */
export function weatherSpriteCount(): number {
  return gWeatherSprites.reduce((n, s) => n + (s.inUse ? 1 : 0), 0);
}

/** One sprite as OAM holds it after BuildOamBuffer: what the renderer draws. */
export interface WeatherOam {
  /** The sprite's id (its slot). */
  id: number;
  tag: number;
  /** The frame: a tile offset into the tag's sheet. */
  tileNum: number;
  width: number;
  height: number;
  /** The top-left corner on screen: OAM's 9-bit x and 8-bit y, wrapped as the PPU wraps them. */
  x: number;
  y: number;
  hFlip: boolean;
  vFlip: boolean;
  priority: number;
  subpriority: number;
  /** ST_OAM_OBJ_BLEND: blended with the BG under it through BLDALPHA. */
  blend: boolean;
  /** The sprite moves with the camera (gSpriteCoordOffsetX / Y added). */
  coordOffsetEnabled: boolean;
}

/** SortSprites' y key (sortY in gba/sprite.ts). */
function sortY(s: Sprite, oamY: number): number {
  let y = oamY;
  if (y >= DISPLAY_HEIGHT) y -= 256;
  if (s.oam.affineMode === ST_OAM_AFFINE_DOUBLE && s.oam.size === 3 && (s.oam.shape === ST_OAM_SQUARE || s.oam.shape === ST_OAM_V_RECTANGLE) && y > 128) y -= 256;
  return y;
}

/**
 * BuildOamBuffer for the weather's sprites with this frame's gSpriteCoordOffsetX / Y: UpdateOamCoords, then
 * SortSprites (priority << 8 | subpriority, then the lower on screen first; a tie keeps slot order), front to back
 * as OAM is (the first entry draws on top). Invisible sprites aren't in it.
 */
export function BuildWeatherOam(spriteCoordOffsetX: number, spriteCoordOffsetY: number): WeatherOam[] {
  const entries: { s: Sprite; id: number; oamX: number; oamY: number; key: number }[] = [];
  for (let id = 0; id < MAX_SPRITES; id++) {
    const s = gWeatherSprites[id];
    if (!s.inUse || s.invisible) continue;
    const ox = s.coordOffsetEnabled ? spriteCoordOffsetX : 0;
    const oy = s.coordOffsetEnabled ? spriteCoordOffsetY : 0;
    const oamX = (s.x + s.x2 + s.centerToCornerVecX + ox) & 0x1ff;
    const oamY = (s.y + s.y2 + s.centerToCornerVecY + oy) & 0xff;
    entries.push({ s, id, oamX, oamY, key: (s.subpriority & 0xff) | (s.oam.priority << 8) });
  }
  // SortSprites' insertion sort: swap while the earlier one sorts behind
  for (let i = 1; i < entries.length; i++) {
    for (let j = i; j > 0; j--) {
      const a = entries[j - 1];
      const b = entries[j];
      if (!(a.key > b.key || (a.key === b.key && sortY(a.s, a.oamY) < sortY(b.s, b.oamY)))) break;
      entries[j - 1] = b;
      entries[j] = a;
    }
  }
  return entries.map(({ s, id, oamX, oamY }) => {
    const [width, height] = sOamDimensions[s.oam.shape][s.oam.size];
    return {
      id,
      tag: s.template.tileTag,
      tileNum: s.oam.tileNum,
      width,
      height,
      x: oamX >= 256 ? oamX - 512 : oamX,
      y: oamY + height > 256 ? oamY - 256 : oamY,
      hFlip: !!(s.oam.matrixNum & ST_OAM_HFLIP),
      vFlip: !!(s.oam.matrixNum & ST_OAM_VFLIP),
      priority: s.oam.priority,
      subpriority: s.subpriority,
      blend: s.oam.objMode === ST_OAM_OBJ_BLEND,
      coordOffsetEnabled: s.coordOffsetEnabled,
    };
  });
}
