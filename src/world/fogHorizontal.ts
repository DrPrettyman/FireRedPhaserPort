// field_weather_effects.c's horizontal fog sprites (WEATHER_FOG_HORIZONTAL, and WEATHER_UNDERWATER, which shares its
// callbacks): CreateFogHorizontalSprites' 20 64x64 sprites (sFogHorizontalSpriteTemplate: gWeatherFogHorizontalTiles
// in the weather's palette, gDefaultWeatherSpritePalette; OAM priority 2, subpriority 0xFF, ST_OAM_OBJ_BLEND),
// FogHorizontalSpriteCallback placing them from the scroll world/weather.ts keeps (fogHScrollPosX) and the camera
// (gSpriteCoordOffsetY), and DestroyFogHorizontalSprites. world/weather.ts runs the weather and asks for the sprites
// through its host; the field (OverworldScene) owns one of these.
//
// The blend: on the GBA the fog's OBJ pixels blend with the BG pixel under them through BLDALPHA (BLDCNT has BG1-3 as
// second targets): min(31, (fog * EVA + bg * EVB) >> 4) per 5-bit channel, EVA / EVB from Weather_SetBlendCoeffs /
// Weather_UpdateBlend. The field is drawn by Phaser, so the GPU does it in two passes at the fog's depth (above BG2,
// BG3 and the priority-3 sprites, below every other priority-2 sprite, BG1 and the priority-1 sprites, as subpriority
// 0xFF puts it): a screen-sized grey rectangle of EVB / 16 in MULTIPLY mode (everything under the fog scaled by EVB /
// 16: the fog's tiles have no transparent pixel and its 5 x 4 sprites always cover the screen), then the sprites in
// ADD mode from a texture of the fog's colours scaled by EVA / 16. The sum saturates at white as the PPU's does; the
// arithmetic is 8-bit (the JASC colours) rather than the PPU's 5-bit with its truncations (docs/DEVIATIONS.md).
//
// The GBA layer's copy of the field (world/fieldGbaScreen.ts, the battle transitions) draws the sprites itself as
// semi-transparent OBJ pixels for the software PPU (`gbaLayer`).

import Phaser from 'phaser';
import { state } from '../battle/env';
import { gfx, gfx16, loadGfx } from '../gba/gfx';
import { expand5, fogHorizontalScrollPosX } from './weather';

/** gWeatherFogHorizontalTiles (graphics/weather/fog_horizontal.4bpp) and gDefaultWeatherSpritePalette. */
export const FOG_HORIZONTAL_GFX = ['gWeatherFogHorizontalTiles', 'gDefaultWeatherSpritePalette'];

/** sOamData_FogH: SPRITE_SHAPE(64x64) */
const FOG_SIZE = 64;
/** The colours as loaded, and the ADD pass's texture (scaled by EVA / 16). */
const TEXTURE = 'weather_fog_horizontal';
const TEXTURE_EVA = 'weather_fog_horizontal_eva';

/** What the GBA layer's copy of the field needs to draw the fog (screen positions are the OAM's, top-left). */
export interface FogGbaLayer {
  image: HTMLCanvasElement;
  positions: { x: number; y: number }[];
}

export interface FogHorizontalHost {
  scene: Phaser.Scene;
  /** gSpriteCoordOffsetY as of the last camera update (field_camera.c UpdateCameraPanning). */
  spriteCoordOffsetY(): number;
}

/** sprite->data[0] (tSpriteColumn) and the OAM position of one fog sprite. */
interface FogSprite {
  column: number;
  /** sprite->x / sprite->y: the sprite's centre in screen pixels (y2 aside). */
  x: number;
  y: number;
  /** The OAM position drawn: top-left, 9-bit x and 8-bit y wrapped as the PPU wraps them. */
  screenX: number;
  screenY: number;
  image: Phaser.GameObjects.Image;
}

export class FogHorizontal {
  /** DEPTH of the ADD pass: between the middle layer (BG2) and the priority-2 objects (MapChunk.objectDepth). */
  static readonly DEPTH = 399_999.5;

  private sprites: FogSprite[] = [];
  private multiply?: Phaser.GameObjects.Rectangle;
  private colors?: ImageData;
  private eva = 16;
  private evb = 0;
  /** The EVA the ADD texture was drawn with. */
  private textureEva = -1;

  constructor(private host: FogHorizontalHost) {}

  /** Preload the graphics (boot). */
  static load(): Promise<void> {
    return loadGfx(FOG_HORIZONTAL_GFX);
  }

  /** CreateFogHorizontalSprites: LoadSpriteSheet and the 20 sprites (CreateSpriteAtEnd at subpriority 0xFF). */
  create(): void {
    this.destroy();
    const scene = this.host.scene;
    this.loadSpriteSheet();
    const width = state.defines.require('DISPLAY_WIDTH');
    const height = state.defines.require('DISPLAY_HEIGHT');
    this.multiply = scene.add
      .rectangle(0, 0, width, height, 0xffffff)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(FogHorizontal.DEPTH - 0.25);
    const count = state.defines.require('NUM_FOG_HORIZONTAL_SPRITES');
    for (let i = 0; i < count; i++) {
      const image = scene.add.image(0, 0, TEXTURE_EVA).setOrigin(0, 0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(FogHorizontal.DEPTH);
      // tSpriteColumn = i % 5; x = (i % 5) * 64 + 32; y = (i / 5) * 64 + 32
      const s: FogSprite = { column: i % 5, x: (i % 5) * 64 + 32, y: Math.floor(i / 5) * 64 + 32, screenX: 0, screenY: 0, image };
      this.sprites.push(s);
    }
    this.textureEva = -1;
    this.applyBlend();
    this.update();
  }

  /** DestroyFogHorizontalSprites (FreeSpriteTilesByTag(GFXTAG_FOG_H): the texture stays, it's the same every time). */
  destroy(): void {
    for (const s of this.sprites) s.image.destroy();
    this.sprites = [];
    this.multiply?.destroy();
    this.multiply = undefined;
  }

  get active(): boolean {
    return this.sprites.length > 0;
  }

  /** REG_BLDALPHA as the weather writes it. */
  setBlendAlpha(eva: number, evb: number): void {
    this.eva = eva;
    this.evb = evb;
    this.applyBlend();
  }

  /**
   * AnimateSprites' FogHorizontalSpriteCallback for each sprite: y2 follows the camera (gSpriteCoordOffsetY as a u8),
   * x the weather's fogHScrollPosX, a column past the screen's right edge wrapping round to the left. Runs after the
   * weather task and before the camera moves this frame, as on the GBA.
   */
  update(): void {
    const posX = fogHorizontalScrollPosX();
    if (!this.sprites.length || posX === undefined) return;
    const displayWidth = state.defines.require('DISPLAY_WIDTH');
    const y2 = this.host.spriteCoordOffsetY() & 0xff;
    for (const s of this.sprites) {
      s.x = posX + 32 + s.column * 64;
      if (s.x >= displayWidth + 32) {
        s.x = displayWidth * 2 + posX - (4 - s.column) * 64;
        s.x &= 0x1ff;
      }
      // BuildOamBuffer: centerToCornerVec (-32, -32), OAM x 9 bits and y 8 bits; the PPU draws x >= 256 left of the
      // screen and a sprite past line 255 from the top
      const oamX = (s.x - 32) & 0x1ff;
      const oamY = (s.y + y2 - 32) & 0xff;
      s.screenX = oamX >= 256 ? oamX - 512 : oamX;
      s.screenY = oamY + FOG_SIZE > 256 ? oamY - 256 : oamY;
      s.image.setPosition(s.screenX, s.screenY);
    }
  }

  /** The fog for the GBA layer's copy of the field, while the sprites are up. */
  gbaLayer(): FogGbaLayer | undefined {
    if (!this.sprites.length) return undefined;
    const image = this.host.scene.textures.get(TEXTURE).getSourceImage() as HTMLCanvasElement;
    return { image, positions: this.sprites.map((s) => ({ x: s.screenX, y: s.screenY })) };
  }

  /** Dev: the sprites' OAM positions, the blend, and the fog's colour (JASC [r, g, b]) at a screen pixel. */
  probe(px?: number, py?: number) {
    let fogColor: number[] | undefined;
    if (px !== undefined && py !== undefined && this.colors) {
      const s = this.sprites.find((s) => px >= s.screenX && px < s.screenX + FOG_SIZE && py >= s.screenY && py < s.screenY + FOG_SIZE);
      if (s) {
        const o = ((py - s.screenY) * FOG_SIZE + (px - s.screenX)) * 4;
        fogColor = [this.colors.data[o], this.colors.data[o + 1], this.colors.data[o + 2]];
      }
    }
    return {
      sprites: this.sprites.map((s) => ({ x: s.screenX, y: s.screenY, visible: s.image.visible, depth: s.image.depth })),
      eva: this.eva,
      evb: this.evb,
      fogColor,
    };
  }

  /** Dev: hide the fog for a frame (an e2e test reads the field under it). */
  setVisible(visible: boolean): void {
    for (const s of this.sprites) s.image.setVisible(visible);
    this.multiply?.setVisible(visible);
  }

  /** LoadSpriteSheet: gWeatherFogHorizontalTiles (8 x 8 4bpp tiles, 1D) in the weather palette, as JASC colours. */
  private loadSpriteSheet(): void {
    const textures = this.host.scene.textures;
    if (this.colors && textures.exists(TEXTURE) && textures.exists(TEXTURE_EVA)) return;
    const tiles = gfx('gWeatherFogHorizontalTiles');
    const palette = gfx16('gDefaultWeatherSpritePalette');
    const img = new ImageData(FOG_SIZE, FOG_SIZE);
    const tilesW = FOG_SIZE / 8;
    for (let t = 0; t < tilesW * tilesW; t++) {
      const tx = (t % tilesW) * 8;
      const ty = Math.floor(t / tilesW) * 8;
      for (let i = 0; i < 64; i++) {
        const byte = tiles[t * 32 + (i >> 1)];
        const idx = i & 1 ? byte >> 4 : byte & 0xf;
        if (!idx) continue; // (the fog uses no transparent pixel)
        const c = palette[idx];
        const o = ((ty + (i >> 3)) * FOG_SIZE + tx + (i & 7)) * 4;
        img.data[o] = expand5(c & 0x1f);
        img.data[o + 1] = expand5((c >> 5) & 0x1f);
        img.data[o + 2] = expand5((c >> 10) & 0x1f);
        img.data[o + 3] = 255;
      }
    }
    this.colors = img;
    const full = textures.exists(TEXTURE) ? (textures.get(TEXTURE) as Phaser.Textures.CanvasTexture) : textures.createCanvas(TEXTURE, FOG_SIZE, FOG_SIZE)!;
    full.context.putImageData(img, 0, 0);
    full.refresh();
    if (!textures.exists(TEXTURE_EVA)) textures.createCanvas(TEXTURE_EVA, FOG_SIZE, FOG_SIZE);
  }

  /** The two passes' factors: the MULTIPLY rectangle's grey (EVB / 16), the ADD texture's colours (EVA / 16). */
  private applyBlend(): void {
    if (!this.multiply || !this.colors) return;
    const grey = Math.round((255 * Math.min(this.evb, 16)) / 16);
    this.multiply.setFillStyle((grey << 16) | (grey << 8) | grey, 1);
    const eva = Math.min(this.eva, 16);
    if (eva === this.textureEva) return;
    this.textureEva = eva;
    const tex = this.host.scene.textures.get(TEXTURE_EVA) as Phaser.Textures.CanvasTexture;
    const out = new ImageData(new Uint8ClampedArray(this.colors.data), FOG_SIZE, FOG_SIZE);
    for (let o = 0; o < out.data.length; o += 4) {
      out.data[o] = Math.round((out.data[o] * eva) / 16);
      out.data[o + 1] = Math.round((out.data[o + 1] * eva) / 16);
      out.data[o + 2] = Math.round((out.data[o + 2] * eva) / 16);
    }
    tex.context.putImageData(out, 0, 0);
    tex.refresh();
  }
}
