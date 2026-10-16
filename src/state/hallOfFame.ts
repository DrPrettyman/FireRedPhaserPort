// The Hall of Fame records: on the GBA they live in their own two flash sectors (SECTOR_ID_HOF_1/2), apart from
// the save slot, and are read and written through gDecompressionBuffer by LoadGameSave(SAVE_HALL_OF_FAME) and
// TrySavingData(SAVE_HALL_OF_FAME) (state/save.ts). The port keeps them under their own localStorage key, as a
// versioned JSON object: up to HALL_OF_FAME_MAX_TEAMS teams in the order they entered, the oldest first.

/** hall_of_fame.c's HALL_OF_FAME_MAX_TEAMS */
export const HALL_OF_FAME_MAX_TEAMS = 50;
/** PARTY_SIZE */
const PARTY_SIZE = 6;

/** struct HallofFameMon */
export interface HallofFameMon {
  tid: number;
  personality: number;
  /** species:9 (SPECIES_EGG for an egg; SPECIES_NONE for an empty slot) */
  species: number;
  /** lvl:7 */
  lvl: number;
  /** nick[POKEMON_NAME_LENGTH]: the first 10 bytes of the nickname (EOS-terminated if shorter) */
  nick: number[];
}

/** struct HallofFameTeam: PARTY_SIZE mons, empty slots with species SPECIES_NONE. */
export type HallofFameTeam = HallofFameMon[];

/** Bump when the stored shape changes; other versions read as corrupted (SAVE_STATUS_INVALID). */
export const HOF_SAVE_VERSION = 1;
/** The localStorage key of the Hall of Fame "sectors". */
export const HOF_STORAGE_KEY = 'firered-phaser:hall-of-fame';

interface HofSaveData {
  version: number;
  teams: HallofFameTeam[];
}

// include/save.h (as in state/save.ts)
const SAVE_STATUS_EMPTY = 0;
const SAVE_STATUS_OK = 1;
const SAVE_STATUS_INVALID = 2;

export function emptyHofMon(): HallofFameMon {
  return { tid: 0, personality: 0, species: 0, lvl: 0, nick: [] };
}

export function emptyHofTeam(): HallofFameTeam {
  return Array.from({ length: PARTY_SIZE }, emptyHofMon);
}

/**
 * gDecompressionBuffer as the Hall of Fame code uses it: HALL_OF_FAME_MAX_TEAMS team slots, filled from the start;
 * the first team whose first mon is SPECIES_NONE ends the list.
 */
export const gHofBuffer: { teams: HallofFameTeam[] } = { teams: [] };

/** memset(gDecompressionBuffer, 0, SECTOR_SIZE * NUM_HOF_SECTORS) */
export function ClearHofBuffer(): void {
  gHofBuffer.teams = Array.from({ length: HALL_OF_FAME_MAX_TEAMS }, emptyHofTeam);
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function cloneTeam(team: HallofFameTeam): HallofFameTeam {
  const out = emptyHofTeam();
  for (let i = 0; i < PARTY_SIZE; i++) {
    const m = team[i];
    if (m) out[i] = { tid: m.tid >>> 0, personality: m.personality >>> 0, species: m.species & 0x1ff, lvl: m.lvl & 0x7f, nick: [...m.nick].slice(0, 10) };
  }
  return out;
}

/**
 * LoadGameSave(SAVE_HALL_OF_FAME): read the records into gHofBuffer. SAVE_STATUS_EMPTY if they were never
 * written (TryLoadSaveSector's missing signature), SAVE_STATUS_INVALID if they can't be read.
 */
export function LoadHallOfFameSave(storage = defaultStorage()): number {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(HOF_STORAGE_KEY);
  } catch {
    raw = undefined;
  }
  if (!raw) return SAVE_STATUS_EMPTY;
  try {
    const data = JSON.parse(raw) as HofSaveData;
    if (data?.version !== HOF_SAVE_VERSION || !Array.isArray(data.teams)) return SAVE_STATUS_INVALID;
    ClearHofBuffer();
    data.teams.slice(0, HALL_OF_FAME_MAX_TEAMS).forEach((t, i) => (gHofBuffer.teams[i] = cloneTeam(t)));
    return SAVE_STATUS_OK;
  } catch {
    return SAVE_STATUS_INVALID;
  }
}

/** The HandleWriteSectorNBytes(SECTOR_ID_HOF_1/2, gDecompressionBuffer) part of TrySavingData(SAVE_HALL_OF_FAME). */
export function WriteHallOfFameSave(storage = defaultStorage()): boolean {
  const teams: HallofFameTeam[] = [];
  for (const t of gHofBuffer.teams) {
    if (!t[0] || t[0].species === 0) break;
    teams.push(cloneTeam(t));
  }
  try {
    if (!storage) return false;
    storage.setItem(HOF_STORAGE_KEY, JSON.stringify({ version: HOF_SAVE_VERSION, teams } satisfies HofSaveData));
    return true;
  } catch {
    return false;
  }
}

/** EraseFlashSector(SECTOR_ID_HOF_1 .. SECTORS_COUNT - 1) (SAVE_OVERWRITE_DIFFERENT_FILE, ClearSaveData). */
export function EraseHallOfFameSave(storage = defaultStorage()): void {
  try {
    storage?.removeItem(HOF_STORAGE_KEY);
  } catch {
    // nothing to erase
  }
}
