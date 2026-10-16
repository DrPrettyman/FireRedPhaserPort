// The main menu (menus/mainMenu.ts, main_menu.c) on the GBA layer. BootScene starts it when the save slot holds
// something (there's no title screen yet); CONTINUE hands the save to the overworld (CB2_ContinueSavedGame),
// NEW GAME starts the new game as booting without a save does (Oak's speech isn't ported).

import { initConstants } from '../battle/constants';
import type { Assets } from '../data/assets';
import { loadGfx } from '../gba/gfx';
import { resetHardware } from '../gba/hw';
import { gMain, SetMainCallback1, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { CB2_InitMainMenu, mainMenuEnv, mainMenuGfxSymbols } from '../menus/mainMenu';
import { Defines } from '../script/Defines';
import type { SaveData } from '../state/saveData';
import { Charmap, EOS } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { saveDataView } from '../ui/saveMenuUtil';
import { initGbaText } from '../gba/window';
import { testEvent } from '../dev/testHooks';
import { GbaHostScene } from './GbaHostScene';
import type { OverworldStart } from './OverworldScene';

const TEXTURE = 'main_menu_screen';

export interface MainMenuStart {
  /** gSaveFileStatus (SAVE_STATUS_*) from LoadGameSave */
  saveFileStatus: number;
  /** The save LoadGameSave read, if it's readable. */
  save?: SaveData;
  /** Where NEW GAME starts (new_game.c's warp into the player's room). */
  newGame: OverworldStart;
}

export class MainMenuScene extends GbaHostScene {
  constructor() {
    super('MainMenu');
  }

  async create(start: MainMenuStart): Promise<void> {
    this.initHost(TEXTURE);
    const assets: Assets = this.registry.get('assets');
    const defines = new Defines(assets.scripts.defines);
    initConstants(assets.scripts.defines); // string_util.c's helpers read the K table
    const charmap = new Charmap(assets.charmap);
    await assets.loadTextTextures(this);
    await loadGfx(mainMenuGfxSymbols());
    const save = start.save;
    const textSpeed = TEXT_SPEED[save?.options.textSpeed ?? 'mid'];
    initGbaText(new Fonts(this, assets.fonts), this.buttons, textSpeed.scroll);

    Object.assign(mainMenuEnv, {
      define: (name: string) => defines.require(name),
      saveFileStatus: start.saveFileStatus,
      saveBlock: save && saveDataView(save, defines),
      windowFrameType: save?.options.windowFrameType ?? 0,
      text: (label: string) => charmap.encode(assets.strings[label] ?? '?$'),
      encode: (s: string) => [...charmap.encodePlain(s), EOS],
      continueSavedGame: () => this.exit({ ...start.newGame, continueGame: save }),
      startNewGame: () => this.exit(start.newGame),
    });
    resetHardware();
    gMain.inBattle = false;
    SetMainCallback1(null);
    SetMainCallback2(CB2_InitMainMenu);
    this.startHost();
    testEvent('mainMenu');
  }

  /** Off the GBA layer and into the field. */
  private exit(overworld: OverworldStart): void {
    this.stopHost();
    SetMainCallback2(null);
    SetVBlankCallback(null);
    this.scene.start('Overworld', overworld);
  }
}
