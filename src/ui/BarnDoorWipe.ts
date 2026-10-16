import Phaser from 'phaser';
import { DEPTH_FADE } from './ScreenFade';

const DISPLAY_WIDTH = 240;

/**
 * DoOutwardBarnDoorWipe → Task_BarnDoorWipe / Task_BarnDoorWipeChild (field_screen_effect.c): WIN0 and
 * WIN1 cover the screen from the edges in and show nothing inside (WININ 0), so the backdrop shows there;
 * then they open out from the middle. The backdrop is palette 0's first colour, which the field forces to
 * black, so the windows are drawn as black rectangles under the screen fade (which fades the backdrop
 * with everything else).
 */
export class BarnDoorWipe {
  private readonly left: Phaser.GameObjects.Rectangle;
  private readonly right: Phaser.GameObjects.Rectangle;
  /** Task_BarnDoorWipe's tState */
  private state = 0;
  /** Task_BarnDoorWipeChild's tChildOffset, or -1 while the child task doesn't exist */
  private childOffset = -1;
  private childActive = false;
  done = false;

  constructor(scene: Phaser.Scene) {
    const height = scene.scale.height;
    const rect = () => scene.add.rectangle(0, 0, 0, height, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_FADE - 1);
    this.left = rect();
    this.right = rect();
  }

  /** One frame of both tasks (the child runs after its parent, in the same RunTasks pass). Returns true when done. */
  tick(): boolean {
    switch (this.state) {
      case 0:
        // BarnDoorWipeSaveGpuRegs; DIR_WIPE_OUT: WIN0H = (0, 120), WIN1H = (120, 255)
        this.setWindows(DISPLAY_WIDTH / 2, DISPLAY_WIDTH / 2);
        this.state = 1;
        break;
      case 1:
        this.childActive = true; // CreateTask(Task_BarnDoorWipeChild, 80)
        this.childOffset = 0;
        this.state = 2;
        break;
      case 2:
        if (!this.childActive) this.state = 3;
        break;
      case 3:
        // BarnDoorWipeLoadGpuRegs
        this.left.destroy();
        this.right.destroy();
        this.done = true;
        return true;
    }
    if (this.childActive) this.tickChild();
    return false;
  }

  /** Task_BarnDoorWipeChild, DIR_WIPE_OUT */
  private tickChild(): void {
    const lhs = DISPLAY_WIDTH / 2 - this.childOffset;
    const rhs = DISPLAY_WIDTH / 2 + this.childOffset;
    if (lhs < 0) {
      this.childActive = false;
      return;
    }
    this.setWindows(lhs, rhs);
    if (lhs < 90) this.childOffset += 4;
    else this.childOffset += 2;
  }

  /** WIN0H = WIN_RANGE(0, lhs), WIN1H = WIN_RANGE(rhs, DISPLAY_WIDTH) */
  private setWindows(lhs: number, rhs: number): void {
    this.left.setSize(lhs, this.left.height);
    this.right.setPosition(rhs, 0).setSize(DISPLAY_WIDTH - rhs, this.right.height);
  }
}
