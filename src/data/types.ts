// Shapes of the JSON written by tools/extract.py.

export type ConnectionDirection = 'up' | 'down' | 'left' | 'right' | 'dive' | 'emerge';

export interface MapConnection {
  map: string; // MAP_* id
  offset: number;
  direction: ConnectionDirection;
}

export interface ObjectEventData {
  local_id?: string;
  type: string;
  graphics_id: string;
  x: number;
  y: number;
  elevation: number;
  movement_type: string;
  movement_range_x: number;
  movement_range_y: number;
  trainer_type: string;
  trainer_sight_or_berry_tree_id: string;
  script: string;
  flag: string;
}

export interface WarpEventData {
  x: number;
  y: number;
  elevation: number;
  dest_map: string;
  dest_warp_id: string;
}

export interface CoordEventData {
  type: string;
  x: number;
  y: number;
  elevation: number;
  var: string;
  var_value: string;
  script: string;
}

export interface BgEventData {
  type: string;
  x: number;
  y: number;
  elevation: number;
  script?: string;
  [key: string]: unknown;
}

/** struct MapLayout: a map grid, its border and tileset pair (maps/layouts/<LAYOUT_ID>.json for one no map uses). */
export interface MapLayoutData {
  /** LAYOUT_* */
  id: string;
  width: number;
  height: number;
  blocks: number[];
  borderWidth: number;
  borderHeight: number;
  border: number[];
  tilesetPair: string;
}

export interface MapData {
  id: string;
  name: string;
  /** gMapHeader.mapLayoutId, as its LAYOUT_* name */
  layoutId: string;
  width: number;
  height: number;
  /** Map grid values: bits 0-9 metatile, 10-11 collision, 12-15 elevation. */
  blocks: number[];
  borderWidth: number;
  borderHeight: number;
  border: number[];
  tilesetPair: string;
  music: string | null;
  weather: string | null;
  mapType: string | null;
  regionMapSection: string | null;
  /** MAP_BATTLE_SCENE_* (GetCurrentMapBattleScene) */
  battleScene: string | null;
  allowCycling: boolean;
  allowRunning: boolean;
  /** allowEscaping: Dig and the Escape Rope work here (CanUseEscapeRopeOnCurrMap) */
  allowEscaping: boolean;
  showMapName: boolean;
  /** floorNum (map_name_popup.c): 0 none, negative basement, 127 rooftop */
  floorNumber: number;
  /** gMapHeader.cave (map.json `requires_flash`): dark until Flash is used. */
  cave: boolean;
  connections: MapConnection[];
  objectEvents: ObjectEventData[];
  warpEvents: WarpEventData[];
  coordEvents: CoordEventData[];
  bgEvents: BgEventData[];
}

/** Per-metatile attributes of one tileset (primary: ids 0..639, secondary: ids 640.. offset by 640). */
export interface TilesetAttributes {
  behaviors: number[];
  layers: number[];
  encounters: number[];
  /** METATILE_ATTRIBUTE_TERRAIN (TILE_TERRAIN_*) */
  terrains: number[];
}

/** struct WildPokemonInfo: encounter rate and per-slot [minLevel, maxLevel, SPECIES_*] */
export interface WildPokemonInfo {
  encounterRate: number;
  mons: [number, number, string][];
}

/** struct WildPokemonHeader (gWildMonHeaders, FireRed entries in table order) */
export interface WildPokemonHeader {
  map: string;
  land_mons?: WildPokemonInfo;
  water_mons?: WildPokemonInfo;
  rock_smash_mons?: WildPokemonInfo;
  fishing_mons?: WildPokemonInfo;
}

/** wild_encounters.json */
export interface WildEncounterData {
  /** ENCOUNTER_CHANCE_<TYPE>_SLOT_<i> running totals; fishing: per rod, [slot, running total] pairs. */
  chances: {
    land_mons: number[];
    water_mons: number[];
    rock_smash_mons: number[];
    fishing_mons: Record<'old_rod' | 'good_rod' | 'super_rod', [number, number][]>;
  };
  headers: WildPokemonHeader[];
  /** TILE_ENCOUNTER_* */
  tileEncounter: Record<string, number>;
  numAlteringCaveTables: number;
  /** roamer.c sRoamerLocations: MAP_* ids per location set, without the MAP_UNDEFINED padding */
  roamerLocations: string[][];
  /** The sets' width in C (NUM_LOCATIONS_PER_SET), padding included. */
  roamerLocationsPerSet: number;
  /** field_specials.c sStarterSpecies, by VAR_STARTER_MON */
  starterSpecies: string[];
  /** sUnownLetterSlots[chamber][land slot] */
  unownLetterSlots: number[][];
  /** The Tanoby Ruins chambers in map number order (chamber index = mapNum - MAP_NUM(MONEAN_CHAMBER)). */
  tanobyChambers: string[];
}

export interface TilesetPairInfo {
  primary: string;
  secondary: string;
  /** Primary metatile ids drawn in the pair atlas because they use secondary palettes/tiles. */
  overrides: number[];
}

export interface TilesetIndex {
  primaries: Record<string, TilesetAttributes>;
  secondaries: Record<string, TilesetAttributes>;
  pairs: Record<string, TilesetPairInfo>;
  /** gTileset_X's C symbols for the GBA-native tiles, palettes and metatiles (extract_gfx), by X. */
  symbols: Record<string, TilesetSymbols>;
}

export interface TilesetSymbols {
  tiles: string;
  palettes: string;
  metatiles: string;
  /** The tileset's animation init function (tileset_anims.c InitTilesetAnim_*), if it has one. */
  callback?: string;
}

export interface SpriteInfo {
  key: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anims: string;
  inanimate: boolean;
  /** NPC_TEXT_COLOR_*: 0 male (blue), 1 female (red), 2 mon, 3 neutral. */
  textColor: number;
  /** graphicsInfo->shadowSize (SHADOW_SIZE_*) and ->tracks (TRACKS_*), by name */
  shadowSize: string;
  tracks: string;
  /** Whether `<key>_reflection.png` exists: the sheet in the palette its reflection draws with. */
  reflection?: boolean;
  /** The graphics info as GBA-native data, for screens on the GBA layer (CreateObjectGraphicsSprite). */
  gba: ObjectEventGbaInfo;
}

export interface ObjectEventGbaInfo {
  /** OBJ_EVENT_PAL_TAG_* value */
  paletteTag: number;
  /** sObjectEventSpritePalettes' palette symbol for that tag */
  palette: string | null;
  /** gObjectEventBaseOam_<shape> */
  oam: string;
  /** sPicTable_*: [pic symbol, byte offset, size (-1: the whole symbol)] per frame */
  images: [string, number, number][];
}

export interface Constants {
  newGameFlags: string[];
  metatileBehaviors: Record<string, number>;
}

/** gSpeciesInfo entry + name + level-up learnset (pokemon/species.json, indexed by SPECIES_* id). */
export interface SpeciesInfo {
  /** gSpeciesInfo[].noFlip: the summary screen and trade scene show the pic unflipped */
  noFlip?: boolean;
  id: string;
  name: string;
  nationalDex?: number;
  baseHP: number;
  baseAttack: number;
  baseDefense: number;
  baseSpeed: number;
  baseSpAttack: number;
  baseSpDefense: number;
  types: number[];
  catchRate: number;
  expYield: number;
  genderRatio: number;
  eggCycles: number;
  friendship: number;
  growthRate: number;
  abilities: number[];
  itemCommon: number;
  itemRare: number;
  /** [level, move id] pairs in learn order (LEVEL_UP_MOVE). */
  learnset: [number, number][];
}

/** gBattleMoves entry + name (pokemon/moves.json, indexed by MOVE_* id). */
export interface MoveInfo {
  id: string;
  name: string;
  effect: number;
  power: number;
  type: number;
  accuracy: number;
  pp: number;
  secondaryEffectChance: number;
  target: number;
  priority: number;
  flags: number;
}

/** gItems entry (pokemon/items.json, indexed by ITEM_* id). */
export interface ItemInfo {
  id: string;
  name: string;
  price: number;
  holdEffect: number;
  holdEffectParam: number;
  description: string;
  importance: number;
  /** POCKET_* (1-based); 0 = no pocket. */
  pocket: number;
  type: number;
  fieldUseFunc: string;
  battleUsage: number;
  battleUseFunc: string;
  secondaryId: number;
}

export interface PokemonTables {
  /** gExperienceTables[growthRate][level] */
  experience: number[][];
  /** sNatureStatTable[nature][stat - 1]: Attack, Defense, Speed, Sp.Atk, Sp.Def */
  natureStats: number[][];
  /** gStdStringPtrs: STDSTRING_* -> C string symbol in strings.json */
  stdStrings: (string | null)[];
  kantoDexCount: number;
  nationalDexCount: number;
}
