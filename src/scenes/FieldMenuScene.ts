// The GBA-layer screens opened from the field: the party menu and bag from the start menu
// (CB2_PartyMenuFromStartMenu / CB2_BagMenuFromStartMenu), the Poké Mart's buy menu and sell bag
// (CB2_InitBuyMenu / CB2_GoToSellMenu), the naming screen (DoNamingScreen from a special), the Hall of Fame
// (CB2_DoHallOfFameScreen from EnterHallOfFame, CB2_InitHofPC from the PC), the wall maps' region map
// (`special ShowTownMap`), the Pokédex (CB2_OpenPokedexFromStartMenu), the options (CB2_OptionsMenuFromStartMenu)
// and the trainer card (ShowPlayerTrainerCard). The
// overworld isn't a GBA screen, so its return points (CB2_ReturnToFieldWithOpenMenu, CB2_ReturnToField,
// CB2_ReturnToFieldContinueScriptPlayMapMusic) end this scene instead.

import type { Assets } from '../data/assets';
import { K } from '../battle/constants';
import { setBattleTextSpeed } from '../battle/battleWindow';
import { g, initBattleEnv, setTextStrings } from '../battle/env';
import { initBattleMessages } from '../battle/message';
import { loadGfx } from '../gba/gfx';
import {
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  REG_OFFSET_DISPCNT,
  resetHardware,
  SetGpuReg,
} from '../gba/hw';
import { gMain, SetMainCallback1, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { initGbaText } from '../gba/window';
import { CB2_ReturnToField, CB2_ReturnToFieldContinueScriptPlayMapMusic, CB2_ReturnToFieldWithOpenMenu, fieldReturn } from '../menus/fieldCallbacks';
import { prepareMenus } from '../menus/host';
import { CB2_BagMenuFromStartMenu, GoToBagMenu } from '../menus/itemMenu';
import { setObjectEventGraphicsInfo } from '../menus/objectEventGraphics';
import { DoNamingScreen, NAMING_SCREEN_BOX, namingScreenGfxSymbols } from '../menus/namingScreen';
import { EnterPokeStorage, pokemonStorageGfxSymbols } from '../menus/pokemonStorage';
import { ItemPc_Init, itemPcGfxSymbols } from '../menus/itemPc';
import { CB2_PartyMenuFromStartMenu } from '../menus/partyMenu';
import { CB2_DoHallOfFameScreen, CB2_InitHofPC, hallOfFameGfxSymbols, hofEnv, partyHallOfFameTeam } from '../menus/hallOfFame';
import type { WarpData } from '../state/GameState';
import { gHofBuffer, LoadHallOfFameSave } from '../state/hallOfFame';
import { SAVE_STATUS_OK, TrySavingData } from '../state/save';
import { loadPokedexData } from '../menus/pokedex';
import { CB2_OpenPokedexFromStartMenu, pokedexScreenGfxSymbols } from '../menus/pokedexScreen';
import { CB2_OptionsMenuFromStartMenu, optionMenuGfxSymbols } from '../menus/optionMenu';
import { BG_PLTT_ID, LoadPalette } from '../gba/palette';
import { ShowPlayerTrainerCard, trainerCardGfxSymbols } from '../menus/trainerCard';
import { InitRegionMapWithExitCB, REGIONMAP_TYPE_WALL, regionMapGfxSymbols } from '../menus/regionMap';
import { buyMenuGfxSymbols, CB2_GoToSellMenu, CB2_InitBuyMenu, LoadFieldTilesetsForShop, type ShopFieldView } from '../menus/shop';
import type { PokemonData } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { sharedBattleData } from './BattleScene';
import { GbaHostScene } from './GbaHostScene';

const TEXTURE = 'field_menu_screen';

/** DoNamingScreen's arguments, for a naming screen that returns to the field. */
export interface NamingScreenRequest {
  /** NAMING_SCREEN_* */
  templateNum: number;
  /** destBuffer: holds the entered name (with EOS) when `onReturn` runs; untouched if it was left blank. */
  dest: number[];
  /** The species, or the player's gender for NAMING_SCREEN_PLAYER. */
  monSpecies: number;
  monGender: number;
  monPersonality: number;
  /** The return callback's own work before it goes back to the field (e.g. ChangePokemonNickname_CB's SetMonData). */
  onReturn(): void;
}

export interface FieldMenuStart {
  menu: 'party' | 'bag' | 'buy' | 'sell' | 'naming' | 'storage' | 'itemPc' | 'itemPcDeposit' | 'hallOfFame' | 'hallOfFamePc' | 'townMap' | 'pokedex' | 'options' | 'trainerCard';
  /** For 'storage': OPTION_WITHDRAW / OPTION_DEPOSIT / OPTION_MOVE_MONS / OPTION_MOVE_ITEMS */
  storageOption?: number;
  /** For 'buy': what the buy menu's map view reads from the field. */
  shopField?: ShopFieldView;
  /** For 'naming' */
  naming?: NamingScreenRequest;
  state: GameState;
  pokemon: PokemonData;
  charmap: Charmap;
  /** gMapHeader.battleType (MAP_BATTLE_SCENE_*): the evolution scene's backdrop reads it. */
  mapBattleScene: number;
  /**
   * Back to the field; `openStartMenu` for CB2_ReturnToFieldWithOpenMenu. With `warp` the screen left through
   * DoWarp (the Hall of Fame's SetWarpsToRollCredits): CB2_LoadMap into that map instead of CB2_ReturnToField.
   */
  onExit(openStartMenu: boolean, warp?: WarpData): void;
}

export class FieldMenuScene extends GbaHostScene {
  private start!: FieldMenuStart;

  constructor() {
    super('FieldMenu');
  }

  async create(start: FieldMenuStart): Promise<void> {
    this.start = start;
    this.initHost(TEXTURE, start.state.playTime);
    const assets: Assets = this.registry.get('assets');
    // Item effects, anim tables and battle strings come with the battle data.
    const data = await sharedBattleData();
    initBattleEnv(data, assets.scripts.defines, start.pokemon, start.state, start.charmap);
    g.mapBattleScene = start.mapBattleScene;
    setTextStrings(assets.strings);
    await loadGfx(['sDownArrowTiles']);
    await prepareMenus(start.state);
    // The evolution scene (Rare Candy, evolution stones) prints battle text.
    initBattleMessages();
    setBattleTextSpeed(TEXT_SPEED[start.state.textSpeed].delay);
    initGbaText(new Fonts(this, assets.fonts), this.buttons, TEXT_SPEED[start.state.textSpeed].scroll);
    this.lEqualsA = start.state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_L_EQUALS_A;

    if (start.menu === 'buy') {
      setObjectEventGraphicsInfo(assets.sprites);
      await loadGfx(buyMenuGfxSymbols(start.shopField!));
      LoadFieldTilesetsForShop(start.shopField!);
    }
    if (start.menu === 'storage') {
      // The box screen draws every mon's icon and pic synchronously; it can also open the naming screen.
      await loadGfx([...pokemonStorageGfxSymbols(), ...namingScreenGfxSymbols(NAMING_SCREEN_BOX, 0, 0)]);
    }
    // The region map: the fly map from the party menu, the Town Map from the bag (with its dungeon previews), the wall maps.
    if (start.menu === 'party' || start.menu === 'bag' || start.menu === 'townMap') {
      await loadGfx(regionMapGfxSymbols(start.menu === 'bag' && start.state.bag.has(K.ITEM_TOWN_MAP, 1)));
    }
    // The Pokédex (StartMenuPokedexCallback): its data and graphics.
    if (start.menu === 'pokedex') {
      await loadPokedexData('gen');
      await loadGfx(pokedexScreenGfxSymbols());
    }
    if (start.menu === 'options') await loadGfx(optionMenuGfxSymbols());
    // The trainer card (StartMenuPlayerCallback): its graphics and the player's pic.
    if (start.menu === 'trainerCard') await loadGfx(trainerCardGfxSymbols(start.state.playerGender === 'female' ? K.FEMALE : K.MALE));
    // The item PC's list (WITHDRAW ITEM) draws the PC's items' icons.
    if (start.menu === 'itemPc') await loadGfx(itemPcGfxSymbols());
    const naming = start.naming;
    if (naming) {
      setObjectEventGraphicsInfo(assets.sprites);
      await loadGfx(namingScreenGfxSymbols(naming.templateNum, naming.monSpecies, naming.monPersonality));
    }
    if (start.menu === 'hallOfFame' || start.menu === 'hallOfFamePc') {
      // The screens draw the party's (or every saved team's) pics synchronously.
      const teams = start.menu === 'hallOfFame' ? [partyHallOfFameTeam(start.state)] : LoadHallOfFameSave() === SAVE_STATUS_OK ? gHofBuffer.teams : [];
      await loadGfx(hallOfFameGfxSymbols(teams, start.state.playerGender === 'female' ? K.FEMALE : K.MALE));
      hofEnv.trySavingData = (saveType) => TrySavingData(saveType, start.state);
      hofEnv.doWarp = (mapId, warpId, x, y) => this.exit(false, { mapId, warpId, x, y });
      hofEnv.returnFromHallOfFamePC = () => this.exit(false);
      resetHardware();
    }

    fieldReturn.withOpenMenu = () => this.exit(true);
    fieldReturn.plain = () => this.exit(false);
    gMain.inBattle = false;
    SetMainCallback1(null);
    if (naming) {
      DoNamingScreen(naming.templateNum, naming.dest, naming.monSpecies, naming.monGender, naming.monPersonality, () => {
        naming.onReturn();
        CB2_ReturnToFieldContinueScriptPlayMapMusic();
      });
    } else if (start.menu === 'itemPc') {
      SetMainCallback2(() => ItemPc_Init(0, CB2_ReturnToField)); // Task_WithdrawItem_WaitFadeAndGoToItemStorage
    } else if (start.menu === 'itemPcDeposit') {
      SetMainCallback2(() => GoToBagMenu(K.ITEMMENULOCATION_ITEMPC, K.OPEN_BAG_ITEMS, CB2_ReturnToField)); // Task_DepositItem_WaitFadeAndGoToBag
    } else if (start.menu === 'hallOfFame') {
      SetMainCallback2(CB2_DoHallOfFameScreen); // EnterHallOfFame
    } else if (start.menu === 'hallOfFamePc') {
      SetMainCallback2(CB2_InitHofPC); // Task_WaitFadeAndSetCallback
    } else if (start.menu === 'townMap') {
      // ShowTownMap (field_specials.c)
      SetMainCallback2(() => InitRegionMapWithExitCB(REGIONMAP_TYPE_WALL, CB2_ReturnToFieldContinueScriptPlayMapMusic));
    } else if (start.menu === 'pokedex') {
      // The Pokédex keeps the DISPCNT the field set up (InitOverworldGraphicsRegisters: OBJ on, 1D mapping,
      // WIN0/WIN1, which it turns off while it's up): the overworld isn't on the GBA layer, so set it here.
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
      SetMainCallback2(CB2_OpenPokedexFromStartMenu); // StartMenuPokedexCallback
    } else if (start.menu === 'options') {
      // The option menu doesn't load BG palette 0, whose colour 0 is the backdrop: the field's (LoadTilesetPalette
      // forces the primary tileset's first colour to black). The overworld isn't on the GBA layer, so set it here.
      LoadPalette([0], BG_PLTT_ID(0), 2);
      SetMainCallback2(CB2_OptionsMenuFromStartMenu); // StartMenuOptionCallback
      gMain.savedCallback = CB2_ReturnToFieldWithOpenMenu;
    } else if (start.menu === 'trainerCard') {
      ShowPlayerTrainerCard(CB2_ReturnToFieldWithOpenMenu); // StartMenuPlayerCallback
    } else if (start.menu === 'storage') {
      const option = start.storageOption!;
      SetMainCallback2(() => EnterPokeStorage(option));
    } else {
      const entry = { party: CB2_PartyMenuFromStartMenu, bag: CB2_BagMenuFromStartMenu, buy: CB2_InitBuyMenu, sell: CB2_GoToSellMenu };
      SetMainCallback2(entry[start.menu as keyof typeof entry]);
    }
    this.startHost();
  }

  private exit(openStartMenu: boolean, warp?: WarpData): void {
    this.stopHost();
    SetMainCallback2(null);
    SetVBlankCallback(null);
    this.start.onExit(openStartMenu, warp);
  }
}
