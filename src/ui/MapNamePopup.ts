import type Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { Charmap } from '../text/charmap';
import { FONT_NORMAL, type Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { GetMapName } from '../world/regionMap';
import { MenuWindow } from './MenuWindow';

const FLOOR_ROOFTOP = 127;

/** What MapNamePopupPrintMapNameOnWindow reads from gMapHeader. */
export interface MapNameHeader {
  /** regionMapSectionId (MAPSEC_* value) */
  mapsec: number;
  floorNum: number;
}

/**
 * map_name_popup.c's Task_MapNamePopup: the map's name in a std-framed window on BG0, shown by scrolling
 * BG0 down 2 px a frame until 24 px of it are on screen, held for 120 frames, then scrolled back up.
 * The window sits at tilemap row 29 (just above the top of the screen with BG0VOFS 0), so `pos` (the
 * BG0VOFS written each frame) is how far it has come down, negated.
 */
export class MapNamePopup {
  private state = 0; // tState
  private timer = 0; // tTimer
  private pos = 0; // tPos
  private reshow = false; // tReshow
  private win?: MenuWindow;

  constructor(
    private scene: Phaser.Scene,
    private fonts: Fonts,
    private input: Input,
    private charmap: Charmap,
    private strings: Record<string, string>,
    private header: () => MapNameHeader,
  ) {}

  /** The text on the window, while it's up (for tests). */
  text?: number[];

  /** ShowMapNamePopup while the task runs: slide out, reprint with the current map, slide back in. */
  reshowName(): void {
    this.state = 4;
    this.reshow = true;
  }

  /** The task has reached its clearing states (DismissMapNamePopup or the slide out finished). */
  get closing(): boolean {
    return this.state >= 6;
  }

  /** DismissMapNamePopup: clear the window at once (no slide out). */
  dismiss(): void {
    if (this.state < 6) this.state = 6;
  }

  /** How many px of the window (frame included) are on screen. */
  get visibleHeight(): number {
    return this.win && this.state < 7 ? -this.pos : 0;
  }

  /** One frame of Task_MapNamePopup; true once the task is destroyed. */
  tick(): boolean {
    switch (this.state) {
      case 0:
        this.win = this.createWindow();
        this.state = 1;
        break;
      case 1: // IsDma3ManagerBusyWithBgCopy: the copy is immediate here
      case 2:
        this.pos -= 2;
        if (this.pos <= -24) {
          this.state = 3;
          this.timer = 0;
        }
        break;
      case 3:
        if (++this.timer > 120) {
          this.timer = 0;
          this.state = 4;
        }
        break;
      case 4:
        this.pos += 2;
        if (this.pos >= 0) {
          if (this.reshow) {
            this.printName(this.win!);
            this.state = 1;
            this.reshow = false;
          } else {
            this.state = 6;
            return false; // BG0VOFS keeps last frame's value
          }
        }
        break;
      case 6:
        // rbox_fill_rectangle + CopyWindowToVram(COPYWIN_MAP)
        this.win?.setVisible(false);
        this.state = 7;
        return false;
      case 7:
        // RemoveWindow; ChangeBgY(0, 0, 0)
        this.destroy();
        this.state = 8;
        return false;
      case 8:
        return true; // DestroyTask
    }
    this.win?.setOffsetY(-this.pos); // SetGpuReg(REG_OFFSET_BG0VOFS, tPos)
    return false;
  }

  /** The task's window gone with it (DestroyTask, or ResetTasks on a map load). */
  destroy(): void {
    this.win?.destroy();
    this.win = undefined;
    this.text = undefined;
  }

  /** MapNamePopupCreateWindow: 14 tiles wide, 19 with a floor number, 22 for ROOFTOP; at tilemap (1, 29). */
  private createWindow(): MenuWindow {
    const { floorNum } = this.header();
    let width = 14;
    if (floorNum !== 0) width += floorNum !== FLOOR_ROOFTOP ? 5 : 8;
    // Tilemap row 29 of the 32-row BG0 is row -3 relative to the screen top at BG0VOFS 0.
    const win = new MenuWindow(this.scene, { left: 1, top: -3, width, height: 2 }, this.fonts, this.input, 'std');
    this.printName(win);
    win.setOffsetY(-this.pos);
    return win;
  }

  /** MapNamePopupPrintMapNameOnWindow: the name (and floor) centred in 112 px, 152 with a floor, 176 for ROOFTOP. */
  private printName(win: MenuWindow): void {
    const { mapsec, floorNum } = this.header();
    let mapName = GetMapName(mapsec, 0);
    let maxWidth = 112;
    if (floorNum !== 0) {
      mapName = this.appendFloorNum(mapName, floorNum);
      maxWidth = floorNum !== FLOOR_ROOFTOP ? 152 : 176;
    }
    const xpos = Math.trunc((maxWidth - stringWidth(this.fonts, FONT_NORMAL, mapName, -1)) / 2);
    win.clearRect(0, 0, win.rect.width * 8, win.rect.height * 8); // FillWindowPixelBuffer(PIXEL_FILL(1))
    win.print(mapName, xpos, 2, FONT_NORMAL);
    win.flush();
    this.text = mapName;
  }

  /** MapNamePopupAppendFloorNum: " ROOFTOP", or " B<n>F" / " <n>F". */
  private appendFloorNum(name: number[], floorNum: number): number[] {
    const body = name.slice(0, name.indexOf(0xff));
    if (floorNum === FLOOR_ROOFTOP) return [...body, ...this.charmap.encode(` ${this.strings.gText_Rooftop2}`)];
    const floor = floorNum < 0 ? `B${-floorNum}` : `${floorNum}`; // ConvertIntToDecimalStringN(LEFT_ALIGN, 2)
    return [...body, ...this.charmap.encode(` ${floor}F`)];
  }
}
