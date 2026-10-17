// What a host scene does before the party menu, bag, TM case, berry pouch, summary screen or evolution scene can run: load menus.json, preload every
// graphic the screens can touch (graphics are fetched asynchronously, the screens use them
// synchronously), and point the menu helpers at the save-block options and string tables.
// Call after initBattleEnv (the K constants and battle data are needed).

import { K } from '../battle/constants';
import { battleBgGfxSymbols } from '../battle/battleBg';
import { ballGfxSymbols, monPalSymbols, monPicSymbol } from '../battle/gfx';
import { loadGfx } from '../gba/gfx';
import { menuEnv } from '../gba/menu';
import { setStringVarLookup } from '../gba/window';
import type { GameState } from '../state/GameState';
import { TEXT_SPEED } from '../text/TextPrinter';
import { StringExpandPlaceholders, text } from './common';
import { loadMenusData } from './data';
import { EVOLUTION_SCENE_GFX, evolutionTargetSpecies } from './evolutionScene';
import { itemIconSymbols } from './itemMenuIcons';
import { GetIconSpecies, monIconSymbol } from './pokemonIcon';
import { SUMMARY_SCREEN_GFX } from './summaryScreen';
import { TM_CASE_GFX } from './tmCase';
import { BERRY_POUCH_GFX } from './berryPouch';

const PARTY_MENU_GFX = [
  'gPartyMenuBg_Gfx',
  'gPartyMenuBg_Tilemap',
  'gPartyMenuBg_Pal',
  'gPartyMenuPokeball_Gfx',
  'gPartyMenuPokeballSmall_Gfx',
  'gPartyMenuPokeball_Pal',
  'sConfirmButton_Tilemap',
  'sCancelButton_Tilemap',
  'sSlotTilemap_Main',
  'sSlotTilemap_MainNoHP',
  'sSlotTilemap_Wide',
  'sSlotTilemap_WideNoHP',
  'sSlotTilemap_WideEmpty',
  'sHeldItemGfx',
  'sHeldItemPalette',
  'gStatusGfx_Icons',
  'gStatusPal_Icons',
  'gMonIconPalettes',
];

const BAG_GFX = [
  'gBagBg_Gfx',
  'gBagBg_Tilemap',
  'gBagBg_ItemPC_Tilemap',
  'gBagBgPalette',
  'gBagBgPalette_FemaleOverride',
  'gBagMale_Gfx',
  'gBagFemale_Gfx',
  'gBag_Pal',
  'gSwapLine_Gfx',
  'gSwapLine_Pal',
  'sItemListTilemap',
  'sBagWindowPalF',
  'sBlit_SelectButton',
  'sRedArrowOtherGfx',
  'sRedArrowPal',
];

const WINDOW_GFX = ['gMenuMessageWindow_Gfx', 'gStdTextWindow_Gfx', 'gTextWindowPalettes', 'gHelpMessageWindow_Gfx', 'sDownArrowTiles', 'gKeypadIconTiles'];

/** Every graphics symbol the party menu, bag, summary screen and evolution scene can load for this save. */
export function menuGfxSymbols(state: GameState): string[] {
  const syms = new Set<string>([...PARTY_MENU_GFX, ...BAG_GFX, ...WINDOW_GFX, ...SUMMARY_SCREEN_GFX, ...ballGfxSymbols()]);
  // The TM case opens from the bag (USE, GIVE, the PC box's GIVE, the Poké Mart's SELL).
  for (const s of TM_CASE_GFX) syms.add(s);
  // So does the berry pouch (and from the battle bag: BattleScene preloads these too).
  for (const s of BERRY_POUCH_GFX) syms.add(s);
  // The evolution scene draws on the battle textbox and terrain.
  for (const s of [...EVOLUTION_SCENE_GFX, ...battleBgGfxSymbols()]) syms.add(s);
  // Summary screen / evolution scene front pics and their palettes (normal and shiny), and the
  // party menu icons, for each party mon and whatever it can evolve into.
  for (const mon of state.party) {
    const species = mon.isEgg ? K.SPECIES_EGG : mon.species;
    syms.add(monPicSymbol(true, species, mon.personality));
    for (const p of monPalSymbols(species)) syms.add(p);
  }
  for (const species of evolutionTargetSpecies(state.party)) {
    syms.add(monPicSymbol(true, species, 0)); // nothing evolves into Unown, the one pic that depends on personality
    for (const p of monPalSymbols(species)) syms.add(p);
    syms.add(monIconSymbol(species));
  }
  const frame = `sUserFrame_Type${state.optionsWindowFrameType + 1}`;
  syms.add(`${frame}_Gfx`).add(`${frame}_Pal`);
  syms.add(monIconSymbol(K.SPECIES_EGG));
  for (const mon of state.party) syms.add(monIconSymbol(GetIconSpecies(mon.isEgg ? K.SPECIES_EGG : mon.species, mon.personality)));
  // Icons for whatever can show up in the bag: its items, and held items that can be taken.
  const items = new Set<number>();
  for (const pocket of state.bag.pockets) for (const slot of pocket) if (slot.itemId) items.add(slot.itemId);
  for (const mon of state.party) if (mon.heldItem) items.add(mon.heldItem);
  // InitOldManBag's demo bag (the old man's tutorial battle)
  items.add(K.ITEM_POTION).add(K.ITEM_POKE_BALL);
  for (const s of itemIconSymbols(items)) syms.add(s);
  return [...syms];
}

/** Load menus.json and the screens' graphics, and set up the menu helpers for this save. */
export async function prepareMenus(state: GameState): Promise<void> {
  await loadMenusData('gen');
  await loadGfx(menuGfxSymbols(state));
  configureMenuEnv(state);
}

export function configureMenuEnv(state: GameState): void {
  menuEnv.textSpeedDelay = TEXT_SPEED[state.textSpeed].delay;
  menuEnv.buttonMode = state.optionsButtonMode;
  menuEnv.windowFrameType = state.optionsWindowFrameType;
  menuEnv.textYesNo = text('gText_YesNo');
  menuEnv.textSelectorArrow2 = text('gText_SelectorArrow2');
  menuEnv.expandPlaceholders = StringExpandPlaceholders;
  setStringVarLookup((n) => state.stringVars[n]);
}
