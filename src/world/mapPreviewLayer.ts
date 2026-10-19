// The forest map preview's BG0 (world/mapPreviewScreen.ts, Task_RunMapPreviewScreenForest) over the Phaser field.

import Phaser from 'phaser';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { TransferPlttBuffer } from '../gba/palette';
import { renderFrame } from '../gba/ppu';
import type { ForestPreviewLayer } from './mapPreviewScreen';

const TEXTURE = 'map_preview_forest';

/**
 * BG0 blended over the Phaser field: the PPU renders BG0 (the preview tiles have no transparent pixel, nor does the
 * name window), and the GPU blends it as BLDALPHA does, min(31, (bg0 * EVA + field * EVB) >> 4): a screen-sized grey
 * rectangle of EVB / 16 in MULTIPLY mode, then the image with its colours scaled by EVA / 16 in ADD mode. 8-bit maths
 * rather than the PPU's 5-bit (docs/DEVIATIONS.md).
 */
export class MapPreviewLayer implements ForestPreviewLayer {
  private readonly multiply: Phaser.GameObjects.Rectangle;
  private readonly image: Phaser.GameObjects.Image;
  private readonly canvas: Phaser.Textures.CanvasTexture;
  private readonly frame = new Uint32Array(DISPLAY_WIDTH * DISPLAY_HEIGHT);
  private rendered = false;
  private drawnEva = -1;

  constructor(scene: Phaser.Scene, depth: number) {
    const textures = scene.textures;
    this.canvas = textures.exists(TEXTURE)
      ? (textures.get(TEXTURE) as Phaser.Textures.CanvasTexture)
      : textures.createCanvas(TEXTURE, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.multiply = scene.add
      .rectangle(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, 0x000000)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(depth)
      .setVisible(false);
    this.image = scene.add
      .image(0, 0, TEXTURE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth + 0.5)
      .setVisible(false);
  }

  /** The PPU draws BG0 as VRAM and the palettes now hold it (VBlank's TransferPlttBuffer first). */
  render(): void {
    TransferPlttBuffer();
    renderFrame(this.frame);
    this.rendered = true;
    this.drawnEva = -1;
  }

  draw(eva: number, evb: number): void {
    if (!this.rendered) return;
    const grey = Math.round((255 * Math.min(evb, 16)) / 16);
    this.multiply.setFillStyle((grey << 16) | (grey << 8) | grey, 1).setVisible(true);
    this.image.setVisible(true);
    eva = Math.min(eva, 16);
    if (eva === this.drawnEva) return;
    this.drawnEva = eva;
    const out = this.canvas.context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    const src = new Uint8Array(this.frame.buffer);
    for (let o = 0; o < out.data.length; o += 4) {
      out.data[o] = Math.round((src[o] * eva) / 16);
      out.data[o + 1] = Math.round((src[o + 1] * eva) / 16);
      out.data[o + 2] = Math.round((src[o + 2] * eva) / 16);
      out.data[o + 3] = 255;
    }
    this.canvas.context.putImageData(out, 0, 0);
    this.canvas.refresh();
  }

  destroy(): void {
    this.multiply.destroy();
    this.image.destroy();
  }
}
