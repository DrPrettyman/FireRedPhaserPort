import Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import type { Charmap } from './charmap';
import { FONT_FEMALE, FONT_MALE, FONT_NORMAL, type Fonts } from './Font';
import { expandPlaceholders } from './placeholders';
import { TEXT_SPEED, TextPrinter } from './TextPrinter';
import { DEPTH_UI, TextWindow } from './TextWindow';

/** NPC_TEXT_COLOR_* (include/constants/vars.h). */
export type TextColor = 'male' | 'female' | 'neutral';

// TEXT_COLOR_* (include/characters.h)
const TEXT_COLOR_WHITE = 1;
const TEXT_COLOR_DARK_GRAY = 2;
const TEXT_COLOR_LIGHT_GRAY = 3;
const TEXT_COLOR_RED = 4;
const TEXT_COLOR_BLUE = 8;

/** sStandardTextBox_WindowTemplates[0]: tilemapLeft 2, tilemapTop 15, 26x4 tiles. */
const WIN = { left: 2, top: 15, width: 26, height: 4 };

export const MESSAGE_TEXTURES = {
  frame: 'text_dialogue_frame',
  signpostFrame: 'text_signpost_frame',
  arrows: 'text_down_arrows',
};

/** The field message box (field_message_box.c + WindowFunc_DrawDialogueFrame). */
export class MessageBox {
  private frame: Phaser.GameObjects.Image;
  private signpostFrame: Phaser.GameObjects.Image;
  /** Which frame the last message loaded (LoadStdWindowFrameGfx or LoadSignpostWindowFrameGfx). */
  private signpost = false;
  private window: TextWindow;
  private printer?: TextPrinter;
  private arrowSheet: ImageData;
  visible = false;
  /** The message being shown, placeholders expanded (dev/test probes read it). */
  text: number[] = [];

  constructor(
    scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private charmap: Charmap,
    private state: GameState,
  ) {
    this.arrowSheet = imageDataOf(scene, MESSAGE_TEXTURES.arrows);
    this.frame = drawDialogueFrame(scene, false);
    this.signpostFrame = drawDialogueFrame(scene, true);
    this.window = new TextWindow(scene, WIN.left * 8, WIN.top * 8, WIN.width * 8, WIN.height * 8, fonts.windowPalette);
    this.setVisible(false);
  }

  /**
   * ShowFieldMessage: expand placeholders, draw the frame, start printing. Task_DrawFieldMessageBox
   * loads the signpost frame instead of the dialogue frame while IsMsgSignpost().
   */
  show(raw: number[], color: TextColor = 'neutral', signpost = false, instant = false): void {
    this.signpost = signpost;
    // `instant`: AddTextPrinterParameterized2 with TEXT_SKIP_DRAW / speed 0 (e.g. the PC storage menu's descriptions)
    const speed = instant ? { delay: 0, scroll: TEXT_SPEED[this.state.textSpeed].scroll } : TEXT_SPEED[this.state.textSpeed];
    const [fontId, fg] =
      color === 'male' ? [FONT_MALE, TEXT_COLOR_BLUE] : color === 'female' ? [FONT_FEMALE, TEXT_COLOR_RED] : [FONT_NORMAL, TEXT_COLOR_DARK_GRAY];
    this.window.fill(TEXT_COLOR_WHITE);
    this.text = expandPlaceholders(raw, this.charmap, this.state);
    this.printer = new TextPrinter(this.window, this.fonts, this.input, this.arrowSheet, this.text, {
      fontId,
      x: 0,
      y: 1,
      fgColor: fg,
      bgColor: TEXT_COLOR_WHITE,
      shadowColor: TEXT_COLOR_LIGHT_GRAY,
      lineSpacing: this.fonts.get(fontId).info.lineSpacing,
      speed: speed.delay,
      canABSpeedUp: !instant,
      scrollSpeed: speed.scroll,
    });
    this.setVisible(true);
  }

  /** True while the printer is still running (waitmessage blocks on this). */
  get isPrinting(): boolean {
    return this.printer !== undefined && !this.printer.finished;
  }

  /** Called once per logic tick. */
  tick(): void {
    this.printer?.tick();
    this.window.flush();
  }

  /** HideFieldMessageBox / closemessage. */
  hide(): void {
    this.printer = undefined;
    this.setVisible(false);
  }

  private setVisible(v: boolean): void {
    this.visible = v;
    this.frame.setVisible(v && !this.signpost);
    this.signpostFrame.setVisible(v && this.signpost);
    this.window.setVisible(v);
  }
}

/**
 * Build a dialogue frame once into a canvas: 30x6 tiles around the text window
 * (WindowFunc_DrawDialogueFrame, whose signpost layout mirrors the side rows the other way round).
 */
function drawDialogueFrame(scene: Phaser.Scene, signpost: boolean): Phaser.GameObjects.Image {
  const src = scene.textures.get(signpost ? MESSAGE_TEXTURES.signpostFrame : MESSAGE_TEXTURES.frame).getSourceImage() as HTMLImageElement;
  const sheetCols = src.width / 8;
  const cols = WIN.width + 4;
  const rows = WIN.height + 2;
  const key = signpost ? 'text_signpost_frame_composed' : 'text_dialogue_frame_composed';
  const tex = scene.textures.exists(key) ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) : scene.textures.createCanvas(key, cols * 8, rows * 8)!;
  const ctx = tex.context;
  ctx.clearRect(0, 0, cols * 8, rows * 8);
  const tile = (n: number, col: number, row: number, vflip = false) => {
    const sx = (n % sheetCols) * 8;
    const sy = Math.floor(n / sheetCols) * 8;
    ctx.save();
    if (vflip) {
      ctx.translate(0, row * 8 + 8);
      ctx.scale(1, -1);
      ctx.drawImage(src, sx, sy, 8, 8, col * 8, 0, 8, 8);
    } else {
      ctx.drawImage(src, sx, sy, 8, 8, col * 8, row * 8, 8, 8);
    }
    ctx.restore();
  };
  const edgeRow = (row: number, ids: [number, number, number, number, number], vflip: boolean) => {
    tile(ids[0], 0, row, vflip);
    tile(ids[1], 1, row, vflip);
    for (let c = 0; c < WIN.width; c++) tile(ids[2], 2 + c, row, vflip);
    tile(ids[3], cols - 2, row, vflip);
    tile(ids[4], cols - 1, row, vflip);
  };
  const sideRow = (row: number, ids: [number, number, number, number], vflip: boolean) => {
    tile(ids[0], 0, row, vflip);
    tile(ids[1], 1, row, vflip);
    tile(ids[2], cols - 2, row, vflip);
    tile(ids[3], cols - 1, row, vflip);
  };
  edgeRow(0, [0, 1, 2, 3, 4], false);
  sideRow(1, [5, 6, 8, 9], false);
  sideRow(2, [10, 11, 12, 13], false);
  sideRow(3, signpost ? [5, 6, 8, 9] : [10, 11, 12, 13], true);
  sideRow(4, signpost ? [10, 11, 12, 13] : [5, 6, 8, 9], true);
  edgeRow(5, [0, 1, 2, 3, 4], true);
  tex.refresh();
  return scene.add
    .image((WIN.left - 2) * 8, (WIN.top - 1) * 8, key)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(DEPTH_UI - 1);
}

export function imageDataOf(scene: Phaser.Scene, key: string): ImageData {
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}
