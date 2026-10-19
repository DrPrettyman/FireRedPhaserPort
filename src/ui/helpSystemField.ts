// The help system in the field. On the GBA, main.c's CallCallbacks runs RunHelpSystemCallback before the field's
// callbacks every frame; here OverworldScene.tick asks `tick()` first and skips the field's logic (tickField and the
// GBA layer's half of the frame) while it says the help is up. The field is drawn by Phaser, so while the help's
// BG0 is on the screen (from its DISPCNT = 0 in state 1 to RestoreGPURegs in state 7) the software PPU draws the
// GBA layer into a canvas over everything else.

import Phaser from 'phaser';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { NewKeyState, ReadKeys } from '../gba/main';
import { renderFrame } from '../gba/ppu';
import type { Input } from '../input/Input';
import type { Fonts } from '../text/Font';
import { InitHelpSystemFonts, RunHelpSystemCallback, SetHelpSystemNameEncoder } from './helpSystem';
import { SetHelpSystemFieldQuery, type HelpSystemFieldQuery } from './helpSystemContext';

const TEXTURE = 'helpSystemField';

export class HelpSystemFieldHost {
  private readonly canvas: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly frameData: ImageData;
  private readonly pixels: Uint32Array;
  /** The field's ReadKeys: its own key state (the field's logic reads its Input; gMain stays the GBA layer's). */
  private readonly keys = NewKeyState();

  /** The field hands over what the help system draws with and what SetHelpContextForMap asks it. */
  constructor(scene: Phaser.Scene, depth: number, fonts: Fonts, encodePlain: (s: string) => number[], query: HelpSystemFieldQuery) {
    InitHelpSystemFonts(fonts);
    SetHelpSystemNameEncoder(encodePlain);
    SetHelpSystemFieldQuery(query);
    this.canvas = scene.textures.exists(TEXTURE) ? (scene.textures.get(TEXTURE) as Phaser.Textures.CanvasTexture) : scene.textures.createCanvas(TEXTURE, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.frameData = this.canvas.context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.pixels = new Uint32Array(this.frameData.data.buffer);
    this.image = scene.add.image(0, 0, TEXTURE).setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setVisible(false);
  }

  /**
   * One frame's RunHelpSystemCallback (`input` sampled this tick). True while the help is up: the field's
   * callbacks and VBlank callback don't run this frame.
   */
  tick(input: Input): boolean {
    ReadKeys(input, false, this.keys);
    const state = RunHelpSystemCallback(this.keys);
    const shown = state >= 2 && state <= 7;
    if (shown) {
      renderFrame(this.pixels);
      this.canvas.context.putImageData(this.frameData, 0, 0);
      this.canvas.refresh();
    }
    this.image.setVisible(shown);
    return state !== 0;
  }
}
