// The boot screens on the GBA layer, one host for all of them since they hand over to each other through gMain
// like the C: the title screen (menus/titleScreen.ts, title_screen.c), its clear save data screen
// (menus/clearSaveDataScreen.ts) and the main menu (menus/mainMenu.ts, main_menu.c). BootScene starts it on the
// title screen (or, with the dev-only ?skipIntro, on the main menu). CONTINUE hands the save to the overworld
// (CB2_ContinueSavedGame); NEW GAME starts the new game (Oak's speech isn't ported). The clear save data screen
// ends with DoSoftReset (BootScene's `softReset`).

import { initConstants } from '../battle/constants';
import type { Assets } from '../data/assets';
import { loadGfx } from '../gba/gfx';
import { resetHardware } from '../gba/hw';
import { gMain, SetMainCallback1, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { menuEnv } from '../gba/menu';
import { CB2_SaveClearScreen_Init, clearSaveDataEnv } from '../menus/clearSaveDataScreen';
import { CB2_InitMainMenu, mainMenuEnv, mainMenuGfxSymbols } from '../menus/mainMenu';
import { CB2_InitTitleScreen, titleScreenEnv, titleScreenGfxSymbols } from '../menus/titleScreen';
import { Defines } from '../script/Defines';
import { gSave, LoadGameSave } from '../state/save';
import { clearSave, type SaveData } from '../state/saveData';
import { Charmap, EOS } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { saveDataView } from '../ui/saveMenuUtil';
import { initGbaText } from '../gba/window';
import { softReset } from './BootScene';
import { GbaHostScene } from './GbaHostScene';
import type { OverworldStart } from './OverworldScene';

const TEXTURE = 'main_menu_screen';

export interface MainMenuStart {
  /** Which screen to start on: the title screen (CB2_InitTitleScreen) or the main menu (CB2_InitMainMenu). */
  entry: 'title' | 'mainMenu';
  /** Where NEW GAME starts (new_game.c's warp into the player's room). */
  newGame: OverworldStart;
}

export class MainMenuScene extends GbaHostScene {
  private fonts!: Fonts;

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
    await loadGfx([...mainMenuGfxSymbols(), ...titleScreenGfxSymbols()]);
    this.fonts = new Fonts(this, assets.fonts);
    const text = (label: string) => charmap.encode(assets.strings[label] ?? '?$');
    let save: SaveData | undefined;

    /** LoadGameSave(SAVE_NORMAL) and what the main menu reads of it (gSaveBlock1/2, the options). */
    const loadGameSave = () => {
      save = LoadGameSave();
      // An empty or unreadable slot gets Sav2_ClearSetDefault's options
      initGbaText(this.fonts, this.buttons, TEXT_SPEED[save?.options.textSpeed ?? 'mid'].scroll);
      Object.assign(mainMenuEnv, {
        saveFileStatus: gSave.fileStatus,
        saveBlock: save && saveDataView(save, defines),
        windowFrameType: save?.options.windowFrameType ?? 0,
      });
    };
    loadGameSave();

    Object.assign(mainMenuEnv, {
      define: (name: string) => defines.require(name),
      text,
      encode: (s: string) => [...charmap.encodePlain(s), EOS],
      continueSavedGame: () => this.exit({ ...start.newGame, continueGame: save }),
      startNewGame: () => this.exit(start.newGame),
    });
    Object.assign(titleScreenEnv, {
      define: (name: string) => defines.require(name),
      loadGameSave,
      saveClearScreenInit: () => SetMainCallback2(CB2_SaveClearScreen_Init),
    });
    Object.assign(clearSaveDataEnv, {
      define: (name: string) => defines.require(name),
      text,
      clearSaveData: () => clearSave(),
      softReset: () => {
        this.stopHost();
        SetMainCallback2(null);
        SetVBlankCallback(null);
        softReset(this);
      },
    });
    // The clear save data screen's YES/NO
    menuEnv.textYesNo = text('gText_YesNo');
    menuEnv.textSelectorArrow2 = text('gText_SelectorArrow2');

    resetHardware();
    gMain.inBattle = false;
    SetMainCallback1(null);
    SetMainCallback2(start.entry === 'title' ? CB2_InitTitleScreen : CB2_InitMainMenu);
    this.startHost();
  }

  /** Off the GBA layer and into the field. */
  private exit(overworld: OverworldStart): void {
    this.stopHost();
    SetMainCallback2(null);
    SetVBlankCallback(null);
    this.scene.start('Overworld', overworld);
  }
}
