// A Phaser scene that runs the emulated GBA main loop (main.c's AgbMain): every 60 Hz tick reads the
// keys, calls gMain.callback1/callback2, then the VBlank callback; the software PPU draws the frame
// into a canvas texture. Screens on the GBA layer (battle, party menu, bag) hand control to each
// other through gMain, so one host runs them all.

import Phaser from 'phaser';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { CallCallbacks, gMain, ReadKeys, VBlankCounter1Update } from '../gba/main';
import { renderFrame } from '../gba/ppu';
import { Input } from '../input/Input';
import { logicSpeed } from '../dev/testHooks';
import { PlayTimeCounter_Update, type PlayTime } from '../state/playTime';
import { AgbMainFrameEnd } from '../audio/frame';

const FRAME_MS = 1000 / 60;

export abstract class GbaHostScene extends Phaser.Scene {
  protected buttons!: Input;
  /** gSaveBlock2Ptr->optionsButtonMode == OPTIONS_BUTTON_MODE_L_EQUALS_A */
  protected lEqualsA = false;
  private running = false;
  private accumulator = 0;
  private canvas!: Phaser.Textures.CanvasTexture;
  private image!: ImageData;
  private pixels!: Uint32Array;
  /** gSaveBlock2Ptr's play time, which AgbMain's PlayTimeCounter_Update counts on every screen. */
  private playTime?: PlayTime;

  /** Create the input and the canvas the PPU draws into (call from create()). */
  protected initHost(textureKey: string, playTime?: PlayTime): void {
    this.playTime = playTime;
    this.running = false;
    this.accumulator = 0;
    this.buttons = new Input(this);
    this.canvas = this.textures.exists(textureKey) ? (this.textures.get(textureKey) as Phaser.Textures.CanvasTexture) : this.textures.createCanvas(textureKey, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.image = this.canvas.context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.add.image(0, 0, textureKey).setOrigin(0, 0);
  }

  /** Start ticking gMain (after gMain.callback2 is set up). */
  protected startHost(): void {
    this.running = true;
  }

  /** Stop ticking; the current tick finishes its callbacks but skips VBlank and drawing. */
  protected stopHost(): void {
    this.running = false;
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;
    this.accumulator = Math.min(this.accumulator + delta * logicSpeed, FRAME_MS * 5 * logicSpeed);
    let ticked = false;
    while (this.accumulator >= FRAME_MS && this.running) {
      this.accumulator -= FRAME_MS;
      this.buttons.sample();
      ReadKeys(this.buttons, this.lEqualsA);
      CallCallbacks();
      if (this.playTime) PlayTimeCounter_Update(this.playTime);
      VBlankCounter1Update(); // VBlankIntr: the Trainer Tower's timer
      AgbMainFrameEnd(); // the sound tasks, MapMusicMain, m4aSoundMain: every tick, also the one that hands over
      if (!this.running) break;
      gMain.vblankCallback?.();
      ticked = true;
    }
    if (ticked && this.running) {
      renderFrame(this.pixels);
      this.canvas.context.putImageData(this.image, 0, 0);
      this.canvas.refresh();
    }
  }
}
