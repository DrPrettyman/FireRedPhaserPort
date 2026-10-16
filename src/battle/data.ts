// Shapes of public/gen/battle/*.json (tools/extract_battle.py).

export interface BattleScriptsData {
  romBase: number;
  /** base64 of the assembled battle_scripts_1/2.s + battle_ai_scripts.s + STRINGID tables. */
  rom: string;
  /** label -> ROM address */
  labels: Record<string, number>;
  /** RAM symbol -> address (each symbol owns `ramSlot` bytes). */
  ram: Record<string, number>;
  ramSlot: number;
}

export interface BattleWindowText {
  fillValue: number;
  fontId: number;
  x: number;
  y: number;
  letterSpacing: number;
  lineSpacing: number;
  speed: number;
  fgColor: number;
  bgColor: number;
  shadowColor: number;
}

export interface BattleStringsData {
  /** C string symbol -> raw decomp string ($-terminated). */
  strings: Record<string, string>;
  /** STRINGID_* -> C string symbol (gBattleStringsTable). */
  battleStrings: Record<string, string>;
  battleStringsStart: number;
  stringIdTables: Record<string, number[]>;
  pointerTables: Record<string, (string | null)[]>;
  /** sGrammarMoveUsedTable */
  grammarMoveUsed: number[];
  /** gStatusConditionStringsTable: [Japanese status string symbol, English symbol] */
  statusConditionStrings: [string, string][];
  /** sTextOnWindowsInfo_Normal indexed by B_WIN_* */
  textOnWindows: (BattleWindowText | null)[];
  abilityNames: (string | null)[];
  typeNames: (string | null)[];
  trainerClassNames: (string | null)[];
}

export interface TrainerMonData {
  iv: number;
  lvl: number;
  species: number;
  heldItem?: number;
  moves?: number[];
}

export interface TrainerData {
  id: string;
  trainerClass: number;
  encounterMusicGender: number;
  trainerPic: number;
  trainerName: string;
  items: number[];
  doubleBattle: number;
  aiFlags: number;
  partyFlags: number;
  party: TrainerMonData[];
}

export interface BattleTablesData {
  /** gTypeEffectiveness: [atk, def, multiplier] triples, TYPE_FORESIGHT / TYPE_ENDTABLE terminated. */
  typeEffectiveness: number[];
  /** gTrainerMoneyTable: [classId, value], ends with classId 0xFF. */
  trainerMoney: [number, number][];
  /** gStatStageRatios */
  statStageRatios: [number, number][];
  trainers: (TrainerData | null)[];
  coords: {
    /** [size, y_offset]; size = width tiles << 4 | height tiles */
    monFront: ([number, number] | null)[];
    monBack: ([number, number] | null)[];
    trainerFront: ([number, number] | null)[];
    trainerBack: ([number, number] | null)[];
    enemyElevation: number[];
  };
  /** Small mechanics tables from battle_script_commands.c etc., keyed by their C names. */
  mech: Record<string, unknown>;
}

export type Rgb = [number, number, number];

export interface BattlePalettesData {
  textbox: Rgb[];
  healthbox: Rgb[];
  healthbar: Rgb[];
}

export interface AnimUnit {
  anims: Record<string, { type: number; imageValue?: number; duration?: number; hFlip?: boolean; vFlip?: boolean; count?: number; target?: number }[]>;
  affineAnims: Record<string, { type: number; xScale?: number; yScale?: number; rotation?: number; duration?: number; count?: number; target?: number }[]>;
  tables: Record<string, (string | null)[]>;
  affineTables: Record<string, (string | null)[]>;
  /** `const union AnimCmd *const *const` tables: names of anim tables */
  tableTables: Record<string, (string | null)[]>;
}

/** battle/anims.json: anim commands per C file, and pic symbol tables. */
export interface BattleAnimsData {
  units: Record<string, AnimUnit>;
  trainerFrontPics: ({ pic: string; size: number } | null)[];
  trainerFrontPalettes: (string | null)[];
  trainerBackPics: string[];
  trainerBackPalettes: string[];
  monFrontPics: (string | null)[];
  monBackPics: (string | null)[];
  monPalettes: (string | null)[];
  monShinyPalettes: (string | null)[];
}

/** A `struct SpriteTemplate` from a battle_anim_*.c file (tags as numbers, pointers by C name). */
export interface BattleAnimTemplateData {
  tileTag: number;
  paletteTag: number;
  oam: string;
  anims: string;
  images: string;
  affineAnims: string;
  callback: string;
  /** the C file it's defined in (for its file-static anim tables) */
  unit: string;
}

/** battle/battle_anims.json (tools/extract_battle_anims.py) */
export interface BattleAnimScriptsData {
  romBase: number;
  /** base64 of the assembled data/battle_anim_scripts.s */
  rom: string;
  /** label -> ROM address */
  labels: Record<string, number>;
  /** gBattleAnims_Moves / _StatusConditions / _General / _Special: script addresses by table id */
  tables: Record<string, number[]>;
  /** sprite templates / task functions the scripts point at: address externBase + 4 * index */
  externBase: number;
  externs: string[];
  templates: Record<string, BattleAnimTemplateData>;
  /** OamData structs of src/data/battle_anim.h */
  oam: Record<string, { affineMode: number; objMode: number; bpp: number; shape: number; size: number; priority: number; paletteNum: number; tileNum: number }>;
  /** gBattleAnimPicTable / gBattleAnimPaletteTable, indexed by ANIM_TAG - ANIM_SPRITES_START */
  pics: ({ symbol: string; size: number; tag: number } | null)[];
  palettes: ({ symbol: string; tag: number } | null)[];
  /** gBattleAnimBackgroundTable by BG_* */
  backgrounds: ({ image: string; palette: string; tilemap: string } | null)[];
  animSpritesStart: number;
}

export interface BattleData {
  scripts: BattleScriptsData;
  strings: BattleStringsData;
  tables: BattleTablesData;
  palettes: BattlePalettesData;
  anims: BattleAnimsData;
  animScripts: BattleAnimScriptsData;
}

export async function loadBattleData(base: string): Promise<BattleData> {
  const get = async <T>(f: string): Promise<T> => {
    const res = await fetch(`${base}/battle/${f}`);
    if (!res.ok) throw new Error(`Failed to load battle/${f}: ${res.status}`);
    return res.json() as Promise<T>;
  };
  const [scripts, strings, tables, palettes, anims, animScripts] = await Promise.all([
    get<BattleScriptsData>('scripts.json'),
    get<BattleStringsData>('strings.json'),
    get<BattleTablesData>('tables.json'),
    get<BattlePalettesData>('palettes.json'),
    get<BattleAnimsData>('anims.json'),
    get<BattleAnimScriptsData>('battle_anims.json'),
  ]);
  return { scripts, strings, tables, palettes, anims, animScripts };
}
