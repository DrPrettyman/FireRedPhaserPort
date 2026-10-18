import Phaser from 'phaser';
import type { Input } from '../input/Input';
import type { Fonts } from '../text/Font';
import { DEPTH_UI, MenuWindow } from './MenuWindow';

/**
 * ScriptMenu_ShowPokemonPic: an 8x8-tile std-framed window at tile (x+1, y+1) with the species'
 * front pic centred on it (CreateMonSprite_PicBox at 8x+40, 8y+40). Task_ScriptShowMonPic tears
 * it down over two frames once hidden: sprite first, then the window.
 * Difference: the sprite appears once its PNG has loaded (the GBA shows it immediately). The cry is
 * ScrCmd_showmonpic's (PlayCry_Script, in script/ScriptEngine.ts).
 */
export class MonPicBox {
  private win: MenuWindow;
  private sprite?: Phaser.GameObjects.Image;
  private state: 'shown' | 'hiding-sprite' | 'hiding-window' | 'gone' = 'shown';

  constructor(
    scene: Phaser.Scene,
    fonts: Fonts,
    input: Input,
    x: number,
    y: number,
    textureKey: Promise<string>,
  ) {
    this.win = new MenuWindow(scene, { left: x + 1, top: y + 1, width: 8, height: 8 }, fonts, input);
    this.win.flush();
    void textureKey.then((key) => {
      if (this.state !== 'shown') return;
      this.sprite = scene.add
        .image(8 * x + 40, 8 * y + 40, key)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI + 12);
    });
  }

  /** ScriptMenu_HidePokemonPic */
  hide(): void {
    if (this.state === 'shown') this.state = 'hiding-sprite';
  }

  /** PicboxCancel: tear the box down at once. */
  cancel(): void {
    if (this.state === 'gone') return;
    if (this.state !== 'hiding-window') this.sprite?.destroy();
    this.win.destroy();
    this.state = 'gone';
  }

  /** PicboxWait: true once the box is fully gone. */
  get gone(): boolean {
    return this.state === 'gone';
  }

  tick(): void {
    if (this.state === 'hiding-sprite') {
      this.sprite?.destroy();
      this.state = 'hiding-window';
    } else if (this.state === 'hiding-window') {
      this.win.destroy();
      this.state = 'gone';
    }
  }
}
