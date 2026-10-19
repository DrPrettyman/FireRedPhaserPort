// The field's drawing of the weathers' sprites (world/weatherSprites.ts; the horizontal fog has its own,
// world/fogHorizontal.ts). Once a render frame, after the frame's logic ticks, `draw()` takes BuildWeatherOam with
// this frame's gSpriteCoordOffsetX / Y and puts each sprite on screen at its OAM position:
//
// - ST_OAM_OBJ_NORMAL sprites are Phaser images of their frame (the sheet's tiles at the frame's tile offset, in the
//   weather palette through its GAMMA_ALT gamma row), at the depth their OAM priority and subpriority give
//   (MapChunk.objectDepth: priority 1 over BG1, 2 between BG2 and BG1, ...).
// - ST_OAM_OBJ_BLEND sprites blend with the BG under them through BLDALPHA: min(31, (obj * EVA + bg * EVB) >> 4) per
//   5-bit channel where the sprite has an opaque pixel, the screen unchanged where it hasn't. The field is drawn by
//   Phaser, so the GPU does it in two passes, as for the horizontal fog but masked by the sprites' pixels: the
//   blended sprites of one priority and subpriority are composited into one screen-sized pair of textures (OAM order:
//   the front sprite's pixel wins, as the PPU's one OBJ pixel per dot does), a MULTIPLY pass of EVB / 16 grey where a
//   sprite pixel is opaque and nothing elsewhere, then an ADD pass of the sprites' colours times EVA / 16 (less half a
//   5-bit step: `addChannel`). The arithmetic is on 8-bit colours, so a pixel can be half a step of the 5-bit channel
//   off the PPU's (the e2e test allows 5 of 255). On the GBA a blended OBJ pixel hides the objects behind it and blends with the BG; here what's under
//   it, objects too, is blended (docs/DEVIATIONS.md).
//
// The GBA layer's copy of the field (world/fieldGbaScreen.ts, battle transitions) takes the same sprites through
// `gbaLayer()`: their frames, positions, depth and whether they're semi-transparent.

import Phaser from 'phaser';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { gfx, gfx16, loadGfx } from '../gba/gfx';
import { objectDepth } from './MapChunk';
import { expand5, objGammaTable } from './weather';
import { BuildWeatherOam, WEATHER_GFX, weatherSpritePalette, weatherSpriteSheet, weatherSpritesVersion, type WeatherOam } from './weatherSprites';

export interface WeatherSpriteRendererHost {
  scene: Phaser.Scene;
  /** gSpriteCoordOffsetX / Y after this frame's camera update (BuildOamBuffer's). */
  spriteCoordOffsetX(): number;
  spriteCoordOffsetY(): number;
}

/** One weather sprite for the GBA layer's copy of the field. */
export interface WeatherGbaSprite {
  image: HTMLCanvasElement;
  x: number;
  y: number;
  hFlip: boolean;
  vFlip: boolean;
  /** The depth the field draws it at (MapChunk.objectDepth), to order it among the objects. */
  depth: number;
  priority: number;
  /** ST_OAM_OBJ_BLEND */
  semi: boolean;
}

/** A frame's texture: the canvas of its colours as shown. */
interface Frame {
  key: string;
  tag: number;
  tileNum: number;
  width: number;
  height: number;
  texture: Phaser.Textures.CanvasTexture;
  /** The 4bpp colour indices (0 = transparent). */
  indices: Uint8Array;
}

/** The two passes of one priority / subpriority's blended sprites. */
interface BlendGroup {
  multiply: Phaser.GameObjects.Image;
  add: Phaser.GameObjects.Image;
  maskTexture: Phaser.Textures.CanvasTexture;
  addTexture: Phaser.Textures.CanvasTexture;
  signature: string;
}

const TEXTURE_PREFIX = 'weather_sprite';
let blendTextureCount = 0;

export class WeatherSpriteRenderer {
  private frames = new Map<string, Frame>();
  /** The palette inputs the frames were drawn with. */
  private framesDrawn: { version: number; palette: string; table: Uint8Array | undefined } = { version: -1, palette: '', table: undefined };
  private images: Phaser.GameObjects.Image[] = [];
  private groups = new Map<string, BlendGroup>();
  private eva = 16;
  private evb = 0;
  private visible = true;
  private oam: WeatherOam[] = [];
  /** The palette's colours as shown (JASC [r, g, b] by colour index) and a serial of its changes. */
  private rgb: number[][] = [];
  private paletteSerial = 0;

  constructor(private host: WeatherSpriteRendererHost) {}

  /** Preload every weather sheet and palette (boot). */
  static load(): Promise<void> {
    return loadGfx(WEATHER_GFX);
  }

  /** REG_BLDALPHA as the weather writes it. */
  setBlendAlpha(eva: number, evb: number): void {
    this.eva = eva;
    this.evb = evb;
  }

  /** BuildOamBuffer and the frame's drawing (after the frame's ticks). */
  draw(): void {
    this.oam = BuildWeatherOam(this.host.spriteCoordOffsetX(), this.host.spriteCoordOffsetY());
    this.refreshFrames();
    const normal = this.oam.filter((o) => !o.blend);
    const scene = this.host.scene;
    while (this.images.length < normal.length) this.images.push(scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0).setScrollFactor(0));
    this.images.forEach((image, i) => {
      const o = normal[i];
      if (!o || !this.visible) {
        image.setVisible(false);
        return;
      }
      const frame = this.frame(o);
      if (!frame) {
        image.setVisible(false);
        return;
      }
      image
        .setTexture(frame.key)
        .setPosition(o.x, o.y)
        .setFlip(o.hFlip, o.vFlip)
        .setDepth(depthOf(o))
        .setVisible(true);
    });
    this.drawBlendGroups(this.oam.filter((o) => o.blend));
  }

  /** The map load's ResetSpriteData: nothing on screen until the weather makes sprites again. */
  clear(): void {
    this.oam = [];
    for (const image of this.images) image.setVisible(false);
    for (const g of this.groups.values()) {
      g.multiply.setVisible(false);
      g.add.setVisible(false);
      g.signature = '';
    }
  }

  /** The field scene is going: its images go with it (the textures stay in the game's texture manager). */
  destroy(): void {
    for (const image of this.images) image.destroy();
    this.images = [];
    for (const g of this.groups.values()) {
      g.multiply.destroy();
      g.add.destroy();
    }
    this.groups.clear();
  }

  /** The sprites for the GBA layer's copy of the field, back to front. */
  gbaLayer(): WeatherGbaSprite[] {
    const out: WeatherGbaSprite[] = [];
    for (const o of [...this.oam].reverse()) {
      const frame = this.frame(o);
      if (!frame) continue;
      out.push({ image: frame.texture.getSourceImage() as HTMLCanvasElement, x: o.x, y: o.y, hFlip: o.hFlip, vFlip: o.vFlip, depth: depthOf(o), priority: o.priority, semi: o.blend });
    }
    return out;
  }

  /**
   * Dev: the sprites' OAM as of now (front first), BLDALPHA, and the colour (JASC [r, g, b]) of the front sprite's
   * opaque pixel at screen pixel (px, py), if any, with whether that sprite blends.
   */
  probe(px?: number, py?: number) {
    // BuildOamBuffer now (the drawn OAM is the last render's, a few ticks behind under the e2e harness's speed)
    const oam = BuildWeatherOam(this.host.spriteCoordOffsetX(), this.host.spriteCoordOffsetY());
    this.refreshFrames();
    let pixel: { rgb: number[]; blend: boolean; id: number } | undefined;
    if (px !== undefined && py !== undefined) {
      for (const o of oam) {
        const rgb = this.pixelOf(o, px - o.x, py - o.y);
        if (rgb) {
          pixel = { rgb, blend: o.blend, id: o.id };
          break;
        }
      }
    }
    return { sprites: oam.map((o) => ({ ...o, depth: depthOf(o) })), eva: this.eva, evb: this.evb, visible: this.visible, pixel };
  }

  /** Dev: hide the weather's sprites (an e2e test reads the field under them); drawn as they are at the next draw. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.clear();
  }

  // ------------------------------------------------------------------ frames

  /** The weather palette as shown: as loaded (or LoadCustomWeatherSpritePalette's) through the GAMMA_ALT row. */
  private paletteRgb(): number[][] {
    const palette = gfx16(this.framesDrawn.palette);
    const table = this.framesDrawn.table;
    return Array.from({ length: 16 }, (_, i) => {
      const c = palette[i] ?? 0;
      const ch = [c & 0x1f, (c >> 5) & 0x1f, (c >> 10) & 0x1f];
      return ch.map((v) => expand5(table ? table[v] : v));
    });
  }

  /** Redraw the frames when the palette or its gamma row changed. */
  private refreshFrames(): void {
    const version = weatherSpritesVersion();
    const palette = weatherSpritePalette();
    const table = objGammaTable('alt');
    const d = this.framesDrawn;
    if (d.version === version && d.palette === palette && d.table === table) return;
    const paletteChanged = d.palette !== palette || d.table !== table;
    this.framesDrawn = { version, palette, table };
    if (!paletteChanged) return;
    this.rgb = this.paletteRgb();
    this.paletteSerial++;
    for (const f of this.frames.values()) this.paint(f, this.rgb);
  }

  private frame(o: WeatherOam): Frame | undefined {
    const key = `${TEXTURE_PREFIX}_${o.image ?? o.tag}_${o.tileNum}_${o.width}x${o.height}`;
    const cached = this.frames.get(key);
    // A sheet's frame starts at its tile offset; a template's image (the snowflakes) is the frame's tiles
    const data = o.image ?? weatherSpriteSheet(o.tag)?.data;
    if (!data) return undefined;
    if (cached) return cached;
    const tiles = gfx(data);
    const firstTile = o.image ? 0 : o.tileNum;
    const indices = new Uint8Array(o.width * o.height);
    const tilesW = o.width / 8;
    for (let t = 0; t < tilesW * (o.height / 8); t++) {
      const base = (firstTile + t) * 32;
      const tx = (t % tilesW) * 8;
      const ty = Math.floor(t / tilesW) * 8;
      for (let i = 0; i < 64; i++) {
        const byte = tiles[base + (i >> 1)] ?? 0;
        indices[(ty + (i >> 3)) * o.width + tx + (i & 7)] = i & 1 ? byte >> 4 : byte & 0xf;
      }
    }
    const textures = this.host.scene.textures;
    const texture = (textures.exists(key) ? textures.get(key) : textures.createCanvas(key, o.width, o.height)) as Phaser.Textures.CanvasTexture;
    const f: Frame = { key, tag: o.tag, tileNum: o.tileNum, width: o.width, height: o.height, texture, indices };
    this.paint(f, this.rgb);
    this.frames.set(key, f);
    return f;
  }

  private paint(f: Frame, rgb: number[][]): void {
    const img = new ImageData(f.width, f.height);
    f.indices.forEach((idx, p) => {
      if (!idx) return;
      img.data.set([...rgb[idx], 255], p * 4);
    });
    f.texture.context.putImageData(img, 0, 0);
    f.texture.refresh();
  }

  /** The JASC colour of a sprite's pixel (sprite-local x, y, flips applied), undefined where it's transparent. */
  private pixelOf(o: WeatherOam, x: number, y: number): number[] | undefined {
    if (x < 0 || y < 0 || x >= o.width || y >= o.height) return undefined;
    const f = this.frame(o);
    if (!f) return undefined;
    const fx = o.hFlip ? o.width - 1 - x : x;
    const fy = o.vFlip ? o.height - 1 - y : y;
    const idx = f.indices[fy * o.width + fx];
    return idx ? this.rgb[idx] : undefined;
  }

  // ------------------------------------------------------------------ BLDALPHA

  private drawBlendGroups(blended: WeatherOam[]): void {
    const byGroup = new Map<string, WeatherOam[]>();
    if (this.visible) {
      for (const o of blended) {
        const key = `${o.priority}_${o.subpriority}`;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key)!.push(o);
      }
    }
    for (const [key, g] of this.groups) {
      if (byGroup.has(key)) continue;
      g.multiply.setVisible(false);
      g.add.setVisible(false);
      g.signature = '';
    }
    const eva = Math.min(this.eva, 16);
    const evb = Math.min(this.evb, 16);
    for (const [key, list] of byGroup) {
      const g = this.group(key, list[0]);
      const signature = JSON.stringify([eva, evb, this.paletteSerial, list.map((o) => [o.tag, o.tileNum, o.x, o.y, o.hFlip, o.vFlip])]);
      g.multiply.setVisible(true);
      g.add.setVisible(true);
      if (signature === g.signature) continue;
      g.signature = signature;
      const mask = new ImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
      const add = new ImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
      const grey = Math.round((255 * evb) / 16);
      const filled = new Uint8Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
      // OAM order: the first sprite with an opaque pixel at a dot is the one the PPU shows there
      for (const o of list) {
        const x0 = Math.max(0, o.x);
        const y0 = Math.max(0, o.y);
        const x1 = Math.min(DISPLAY_WIDTH, o.x + o.width);
        const y1 = Math.min(DISPLAY_HEIGHT, o.y + o.height);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const p = y * DISPLAY_WIDTH + x;
            if (filled[p]) continue;
            const rgb = this.pixelOf(o, x - o.x, y - o.y);
            if (!rgb) continue;
            filled[p] = 1;
            mask.data.set([grey, grey, grey, 255], p * 4);
            add.data.set([addChannel(rgb[0], eva), addChannel(rgb[1], eva), addChannel(rgb[2], eva), 255], p * 4);
          }
        }
      }
      g.maskTexture.context.putImageData(mask, 0, 0);
      g.maskTexture.refresh();
      g.addTexture.context.putImageData(add, 0, 0);
      g.addTexture.refresh();
    }
  }

  private group(key: string, o: WeatherOam): BlendGroup {
    let g = this.groups.get(key);
    if (g) return g;
    const scene = this.host.scene;
    const n = blendTextureCount++;
    const maskTexture = scene.textures.createCanvas(`${TEXTURE_PREFIX}_mask_${n}`, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    const addTexture = scene.textures.createCanvas(`${TEXTURE_PREFIX}_add_${n}`, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    // Behind the objects of the same priority and subpriority (they sort by their screen top on a tie)
    const depth = objectDepth(o.priority, o.subpriority, -512) - 0.5;
    g = {
      maskTexture,
      addTexture,
      multiply: scene.add.image(0, 0, maskTexture.key).setOrigin(0, 0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(depth - 0.25),
      add: scene.add.image(0, 0, addTexture.key).setOrigin(0, 0).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth),
      signature: '',
    };
    this.groups.set(key, g);
    return g;
  }
}

/**
 * The ADD pass's share of a channel: obj * EVA / 16, less half a 5-bit step. The PPU floors the 5-bit sum
 * (obj * EVA + bg * EVB) >> 4; the GPU's sum of the two 8-bit passes has no floor, so it sits half a step lower to be
 * within half a step of the PPU's (a step is 255 / 31: up to 4 or 5 off, where the plain sum was up to 8).
 */
function addChannel(c: number, eva: number): number {
  return Math.max(0, Math.round((c * eva) / 16 - 255 / 62));
}

/** A sprite's depth on the field: its OAM priority and subpriority, then its screen top (SortSprites). */
function depthOf(o: WeatherOam): number {
  return objectDepth(o.priority, o.subpriority, o.y);
}
