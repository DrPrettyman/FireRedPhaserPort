import type { Input } from '../input/Input';
import { CHAR_NEWLINE, CHAR_PROMPT_CLEAR, CHAR_PROMPT_SCROLL, EOS, EXT_CTRL_CODE_BEGIN, PLACEHOLDER_BEGIN } from './charmap';
import type { Fonts } from './Font';
import type { TextSurface } from './TextWindow';

const CHAR_KEYPAD_ICON = 0xf8;
const CHAR_EXTRA_SYMBOL = 0xf9;

// EXT_CTRL_CODE_* (charmap.txt: FC xx)
const EXT = {
  COLOR: 0x01,
  HIGHLIGHT: 0x02,
  SHADOW: 0x03,
  COLOR_HIGHLIGHT_SHADOW: 0x04,
  PALETTE: 0x05,
  FONT: 0x06,
  RESET_FONT: 0x07,
  PAUSE: 0x08,
  PAUSE_UNTIL_PRESS: 0x09,
  WAIT_SE: 0x0a,
  PLAY_BGM: 0x0b,
  ESCAPE: 0x0c,
  SHIFT_RIGHT: 0x0d,
  SHIFT_DOWN: 0x0e,
  FILL_WINDOW: 0x0f,
  PLAY_SE: 0x10,
  CLEAR: 0x11,
  SKIP: 0x12,
  CLEAR_TO: 0x13,
  MIN_LETTER_SPACING: 0x14,
  JPN: 0x15,
  ENG: 0x16,
  PAUSE_MUSIC: 0x17,
  RESUME_MUSIC: 0x18,
} as const;

/** sTextSpeedFrameDelays / sWindowVerticalScrollSpeeds indexed by options text speed. */
export const TEXT_SPEED = {
  slow: { delay: 8, scroll: 1 },
  mid: { delay: 4, scroll: 2 },
  fast: { delay: 1, scroll: 4 },
} as const;
export type TextSpeed = keyof typeof TEXT_SPEED;

/** src/text.c: CURSOR_DELAY and sDownArrowYCoords (actually x offsets into the arrow sheet). */
const CURSOR_DELAY = 8;
const DOWN_ARROW_FRAMES = [0, 16, 32, 16];

export interface PrinterTemplate {
  fontId: number;
  x: number;
  y: number;
  fgColor: number;
  bgColor: number;
  shadowColor: number;
  lineSpacing: number;
  /** Frames between characters; 0 prints everything up to the next wait in one frame. */
  speed: number;
  /** gTextFlags.canABSpeedUpPrint */
  canABSpeedUp: boolean;
  scrollSpeed: number;
}

const enum State {
  HandleChar,
  Wait,
  Clear,
  ScrollStart,
  Scroll,
  WaitSe,
  Pause,
}

const enum Result {
  Print,
  Update,
  Repeat,
  Finish,
}

/** Port of RenderText (src/text.c): prints one encoded string into a window over time. */
export class TextPrinter {
  finished = false;
  private pos = 0;
  private state = State.HandleChar;
  private currentX: number;
  private currentY: number;
  private glyphId: number;
  private fg: number;
  private bg: number;
  private shadow: number;
  private delayCounter = 0;
  private hasPrintBeenSpedUp = false;
  private minLetterSpacing = 0;
  private scrollDistance = 0;
  private arrowDelay = 0;
  private arrowFrame = 0;

  constructor(
    private window: TextSurface,
    private fonts: Fonts,
    private input: Input,
    private arrowSheet: ImageData,
    private bytes: number[],
    readonly t: PrinterTemplate,
  ) {
    this.currentX = t.x;
    this.currentY = t.y;
    this.glyphId = t.fontId;
    this.fg = t.fgColor;
    this.bg = t.bgColor;
    this.shadow = t.shadowColor;
  }

  /** Run one frame (RunTextPrinters → RenderFont, which loops while RENDER_REPEAT). */
  tick(): void {
    if (this.finished) return;
    for (;;) {
      const r = this.render();
      if (r === Result.Finish) {
        this.finished = true;
        return;
      }
      if (r === Result.Repeat) continue;
      if (r === Result.Print && this.t.speed === 0) continue;
      return;
    }
  }

  /** Where the down arrow goes, i.e. the printer's current position. */
  get cursor(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  private next(): number {
    return this.bytes[this.pos++] ?? EOS;
  }

  private render(): Result {
    switch (this.state) {
      case State.HandleChar:
        return this.handleChar();
      case State.Wait:
        if (this.input.pressedAorB()) this.state = State.HandleChar;
        return Result.Update;
      case State.Clear:
        if (this.waitWithDownArrow()) {
          this.window.fill(this.bg);
          this.currentX = this.t.x;
          this.currentY = this.t.y;
          this.state = State.HandleChar;
        }
        return Result.Update;
      case State.ScrollStart:
        if (this.waitWithDownArrow()) {
          this.clearDownArrow();
          const font = this.fonts.get(this.t.fontId);
          this.scrollDistance = font.info.maxLetterHeight + this.t.lineSpacing;
          this.currentX = this.t.x;
          this.state = State.Scroll;
        }
        return Result.Update;
      case State.Scroll:
        if (this.scrollDistance) {
          const step = Math.min(this.scrollDistance, this.t.scrollSpeed);
          this.window.scrollUp(step, this.bg);
          this.scrollDistance -= step;
        } else {
          this.state = State.HandleChar;
        }
        return Result.Update;
      case State.WaitSe:
        this.state = State.HandleChar; // no audio yet
        return Result.Update;
      case State.Pause:
        if (this.delayCounter) this.delayCounter--;
        else this.state = State.HandleChar;
        return Result.Update;
    }
  }

  private handleChar(): Result {
    if (this.input.held('A') || this.input.held('B')) {
      if (this.hasPrintBeenSpedUp) this.delayCounter = 0;
    }
    if (this.delayCounter && this.t.speed) {
      this.delayCounter--;
      if (this.t.canABSpeedUp && this.input.pressedAorB()) {
        this.hasPrintBeenSpedUp = true;
        this.delayCounter = 0;
      }
      return Result.Update;
    }
    this.delayCounter = this.t.speed;

    let c = this.next();
    switch (c) {
      case EOS:
        return Result.Finish;
      case CHAR_NEWLINE:
        this.currentX = this.t.x;
        this.currentY += this.fonts.get(this.t.fontId).info.maxLetterHeight + this.t.lineSpacing;
        return Result.Repeat;
      case PLACEHOLDER_BEGIN:
        this.pos++; // placeholders are expanded before printing
        return Result.Repeat;
      case EXT_CTRL_CODE_BEGIN: {
        const r = this.extCtrl(this.next());
        if (r !== undefined) return r;
        c = this.next(); // ESCAPE: print the following byte literally
        break;
      }
      case CHAR_PROMPT_CLEAR:
        this.state = State.Clear;
        this.initDownArrow();
        return Result.Update;
      case CHAR_PROMPT_SCROLL:
        this.state = State.ScrollStart;
        this.initDownArrow();
        return Result.Update;
      case CHAR_EXTRA_SYMBOL:
        c = this.next() | 0x100;
        break;
      case CHAR_KEYPAD_ICON: {
        const icon = this.fonts.keypadIcons[this.next()];
        const w = icon ? (this.window.drawKeypadIcon?.(icon, this.currentX, this.currentY) ?? 0) : 0;
        // currentX += width + letterSpacing (the template's; the latin fonts' is 0)
        this.currentX += w + this.fonts.get(this.glyphId).info.letterSpacing;
        return Result.Print;
      }
    }

    const font = this.fonts.get(this.glyphId);
    const w = this.window.drawGlyph(font, c, this.currentX, this.currentY, this.fg, this.bg, this.shadow);
    if (this.minLetterSpacing) {
      this.currentX += w;
      const pad = this.minLetterSpacing - w;
      if (pad > 0) {
        this.clearSpan(pad);
        this.currentX += pad;
      }
    } else {
      this.currentX += w; // latin text ignores letterSpacing (only applied to Japanese)
    }
    return Result.Print;
  }

  /** Returns a result, or undefined for EXT_CTRL_CODE_ESCAPE (caller prints the next byte). */
  private extCtrl(code: number): Result | undefined {
    switch (code) {
      case EXT.COLOR:
        this.fg = this.next();
        return Result.Repeat;
      case EXT.HIGHLIGHT:
        this.bg = this.next();
        return Result.Repeat;
      case EXT.SHADOW:
        this.shadow = this.next();
        return Result.Repeat;
      case EXT.COLOR_HIGHLIGHT_SHADOW:
        this.fg = this.next();
        this.bg = this.next();
        this.shadow = this.next();
        return Result.Repeat;
      case EXT.PALETTE:
        this.pos++;
        return Result.Repeat;
      case EXT.FONT:
        this.glyphId = this.next();
        return Result.Repeat;
      case EXT.PAUSE:
        this.delayCounter = this.next();
        this.state = State.Pause;
        return Result.Repeat;
      case EXT.PAUSE_UNTIL_PRESS:
        this.state = State.Wait;
        return Result.Update;
      case EXT.WAIT_SE:
        this.state = State.WaitSe;
        return Result.Update;
      case EXT.PLAY_BGM:
      case EXT.PLAY_SE:
        this.pos += 2; // TODO: audio
        return Result.Repeat;
      case EXT.ESCAPE:
        return undefined;
      case EXT.SHIFT_RIGHT:
        this.currentX = this.t.x + this.next();
        return Result.Repeat;
      case EXT.SHIFT_DOWN:
        this.currentY = this.t.y + this.next();
        return Result.Repeat;
      case EXT.FILL_WINDOW:
        this.window.fill(this.bg);
        return Result.Repeat;
      case EXT.CLEAR: {
        const w = this.next();
        if (w > 0) {
          this.clearSpan(w);
          this.currentX += w;
          return Result.Print;
        }
        return Result.Repeat;
      }
      case EXT.SKIP:
        this.currentX = this.next() + this.t.x;
        return Result.Repeat;
      case EXT.CLEAR_TO: {
        const w = this.next() + this.t.x - this.currentX;
        if (w > 0) {
          this.clearSpan(w);
          this.currentX += w;
          return Result.Print;
        }
        return Result.Repeat;
      }
      case EXT.MIN_LETTER_SPACING:
        this.minLetterSpacing = this.next();
        return Result.Repeat;
      case EXT.RESET_FONT:
      case EXT.JPN:
      case EXT.ENG:
      case EXT.PAUSE_MUSIC:
      case EXT.RESUME_MUSIC:
      default:
        return Result.Repeat;
    }
  }

  /**
   * ClearTextSpan: an empty function in FRLG's text_printer.c, so CLEAR / CLEAR_TO / MIN_LETTER_SPACING only move
   * the cursor and leave what's under it (the TM case's HM icon sits under an HM's {CLEAR_TO 18}).
   */
  private clearSpan(_width: number): void {}

  // -------------------------------------------------------------- down arrow (TextPrinterDrawDownArrow)

  private initDownArrow(): void {
    this.arrowDelay = 0;
    this.arrowFrame = 0;
  }

  private waitWithDownArrow(): boolean {
    this.drawDownArrow();
    return this.input.pressedAorB();
  }

  private drawDownArrow(): void {
    if (this.arrowDelay) {
      this.arrowDelay--;
      return;
    }
    drawDownArrowAt(this.window, this.arrowSheet, this.currentX, this.currentY, this.bg, this.arrowFrame);
    this.arrowDelay = CURSOR_DELAY;
    this.arrowFrame = (this.arrowFrame + 1) & 3;
  }

  private clearDownArrow(): void {
    this.window.fillRect(this.currentX, this.currentY, 10, 12, this.bg);
  }
}

/** DrawDownArrow: a 10x12 cell of the arrow sheet; frames step through x = 0,16,32,16. */
export function drawDownArrowAt(window: TextSurface, sheet: ImageData, x: number, y: number, bg: number, frame: number): void {
  window.fillRect(x, y, 10, 12, bg);
  window.blit(sheet, DOWN_ARROW_FRAMES[frame & 3], 0, x, y, 10, 12, bg);
}

export { CURSOR_DELAY };
