// public/gen/menus.json (tools/extract_menus.py): tables the party menu, bag, summary and naming screens index.

export interface MenusData {
  /** gMonIconTable: species -> icon graphics symbol */
  monIcons: (string | null)[];
  /** gMonIconPaletteIndices */
  monIconPaletteIndices: (number | null)[];
  /** sItemIconTable: item -> [tiles symbol, palette symbol] */
  itemIcons: ([string, string] | null)[];
  /** sTMHMMoves */
  tmhmMoves: number[];
  /** sTutorMoves */
  tutorMoves: number[];
  /** sTutorLearnsets: species -> bits by TUTOR_MOVE_* */
  tutorLearnsets: (number | null)[];
  /** sTMHMLearnsets: species -> [TM01..TM32 bits, TM33..HM08 bits] */
  tmhmLearnsets: ([number, number] | null)[];
  /** gEvolutionTable: species -> [method, param, targetSpecies][] */
  evolutions: ([number, number, number][] | null)[];
  /** gNatureNamePointers (raw decomp strings) */
  natureNames: string[];
  /** gAbilityDescriptionPointers */
  abilityDescriptions: string[];
  /** gMoveDescriptionPointers: indexed move - 1 */
  moveDescriptions: string[];
  /** sMapNames: indexed mapsec - KANTO_MAPSEC_START */
  mapsecNames: (string | null)[];
  /** sMenuInfoIcons: [width, height, tile offset] */
  menuInfoIcons: [number, number, number][];
  /** sKeyboardChars (naming_screen.c): raw `__()` rows (no EOS), 4 per KEYBOARD_* page */
  namingKeyboardChars: string[][];
  /** region_map.c's tables (menus/regionMap.ts RegionMapData) */
  regionMap: import('./regionMap').RegionMapData;
  /** wild_pokemon_area.c's / pokedex_area_markers.c's tables (menus/wildPokemonArea.ts PokedexAreaData) */
  pokedexArea: import('./wildPokemonArea').PokedexAreaData;
}

export let menusData: MenusData;
let loading: Promise<MenusData> | undefined;

export async function loadMenusData(base: string): Promise<MenusData> {
  loading ??= fetch(`${base}/menus.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load menus.json: ${res.status}`);
    return res.json() as Promise<MenusData>;
  });
  menusData = await loading;
  return menusData;
}
