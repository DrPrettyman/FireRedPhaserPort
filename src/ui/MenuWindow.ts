import Phaser from 'phaser';
import type { Input } from '../input/Input';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { TextPrinter } from '../text/TextPrinter';
import { DEPTH_UI, TextWindow } from '../text/TextWindow';

const TEXT_COLOR_WHITE = 1;
const TEXT_COLOR_DARK_GRAY = 2;
const TEXT_COLOR_LIGHT_GRAY = 3;

/** Options "FRAME" setting: 1..10 (gUserFrames). */
export function userFrameTexture(type: number): string {
  return `text_frame_type${type}`;
}

/** LoadStdWindowGfx's frame (gStdTextWindow_Gfx), which ignores the options setting. */
export const STD_FRAME_TEXTURE = 'text_frame_std';

export interface TileRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A window drawn with the standard (user-selectable) frame: WindowFunc_DrawStandardFrame puts a
 * one-tile border from a 3x3 tile set around the window, and the interior is filled with white.
 */
export class MenuWindow {
  readonly window: TextWindow;
  private frame: Phaser.GameObjects.Image;
  private frameKey: string;
  private static count = 0;

  constructor(
    scene: Phaser.Scene,
    readonly rect: TileRect,
    private fonts: Fonts,
    private input: Input,
    frameType: number | 'std' = 1,
  ) {
    this.frameKey = `menu_frame_${MenuWindow.count++}`;
    this.frame = drawStdFrame(scene, rect, frameType === 'std' ? STD_FRAME_TEXTURE : userFrameTexture(frameType), this.frameKey);
    this.window = new TextWindow(scene, rect.left * 8, rect.top * 8, rect.width * 8, rect.height * 8, fonts.windowPalette);
    this.window.image.setDepth(DEPTH_UI + 11); // menus sit above the dialogue box
    this.window.fill(TEXT_COLOR_WHITE);
  }

  /** AddTextPrinterParameterized with speed 0: draw text instantly. */
  print(bytes: number[], x: number, y: number, fontId = FONT_NORMAL): void {
    const font = this.fonts.get(fontId);
    const printer = new TextPrinter(this.window, this.fonts, this.input, new ImageData(1, 1), bytes, {
      fontId,
      x,
      y,
      fgColor: TEXT_COLOR_DARK_GRAY,
      bgColor: TEXT_COLOR_WHITE,
      shadowColor: TEXT_COLOR_LIGHT_GRAY,
      lineSpacing: font.info.lineSpacing,
      speed: 0,
      canABSpeedUp: false,
      scrollSpeed: 1,
    });
    printer.tick();
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.window.fillRect(x, y, w, h, TEXT_COLOR_WHITE);
  }

  flush(): void {
    this.window.flush();
  }

  /** Shifts the window and its frame `dy` px down from where `rect` puts them (a BG scroll offset). */
  setOffsetY(dy: number): void {
    this.window.image.y = this.rect.top * 8 + dy;
    this.frame.y = (this.rect.top - 1) * 8 + dy;
  }

  setVisible(visible: boolean): void {
    this.window.setVisible(visible);
    this.frame.setVisible(visible);
  }

  destroy(): void {
    this.window.destroy();
    this.frame.destroy();
    this.frame.scene?.textures.remove(this.frameKey);
  }
}

function drawStdFrame(scene: Phaser.Scene, r: TileRect, srcKey: string, key: string): Phaser.GameObjects.Image {
  const src = scene.textures.get(srcKey).getSourceImage() as HTMLImageElement;
  const cols = r.width + 2;
  const rows = r.height + 2;
  const tex = scene.textures.createCanvas(key, cols * 8, rows * 8)!;
  const ctx = tex.context;
  const tile = (n: number, col: number, row: number) =>
    ctx.drawImage(src, (n % 3) * 8, Math.floor(n / 3) * 8, 8, 8, col * 8, row * 8, 8, 8);
  tile(0, 0, 0);
  tile(2, cols - 1, 0);
  tile(6, 0, rows - 1);
  tile(8, cols - 1, rows - 1);
  for (let c = 1; c < cols - 1; c++) {
    tile(1, c, 0);
    tile(7, c, rows - 1);
  }
  for (let rr = 1; rr < rows - 1; rr++) {
    tile(3, 0, rr);
    tile(5, cols - 1, rr);
  }
  tex.refresh();
  return scene.add
    .image((r.left - 1) * 8, (r.top - 1) * 8, key)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(DEPTH_UI + 10);
}

export { DEPTH_UI };
