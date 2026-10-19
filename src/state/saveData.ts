// The save file: what gSaveBlock1 / gSaveBlock2 / gPokemonStorage hold that the port keeps, as a plain JSON
// object with a version number. toSaveData is SaveSerializedGame + the copy into the flash sectors (save.c);
// fromSaveData is LoadSerializedGame + LoadPlayerParty etc. (load_save.c). Saves live in browser localStorage,
// one slot, like the GBA's one save file (writeSave / readSave / hasSave / clearSave).
//
// Not saved, as on the GBA: EWRAM state (gEnemyParty, gBattleOutcome, gStringVar*, special vars 0x8000+,
// special flags 0x4000+, gNumSafariBalls / gSafariZoneStepCounter, the roamer's location, sPCBoxToSendMon).
// Before saving, the field writes the player's position into state.location (OverworldScene.storeLocationForSave).

import type { Pokemon } from '../pokemon/Pokemon';
import type { TextSpeed } from '../text/TextPrinter';
import type { ItemSlot } from './Bag';
import type { GameState, PlayerLocation, RoamerSave, WarpData } from './GameState';
import type { PlayTime } from './playTime';
import type { BoxPokemon } from './PokemonStorage';
import type { DaycareMon } from '../world/daycare';
import type { TrainerTowerRecord } from './trainerTowerRecord';

/**
 * Bump when SaveData changes shape; fromSaveData refuses other versions. Older versions that only lack fields
 * are brought up to date by `upgradeSave` (version 1 had no gameStats, version 2 no options.sound, version 3 had
 * daycareStepCounter instead of daycare and no route5DayCareMon, version 4 no easyChat, version 5 no savedMusic,
 * version 6 no weather, version 7 no trainerTower).
 */
export const SAVE_VERSION = 8;

/** The localStorage key of the one save slot. */
export const SAVE_STORAGE_KEY = 'firered-phaser:save';

/** struct BoxPokemon's fields as the port keeps them (see Pokemon). */
const BOX_MON_FIELDS = [
  'species',
  'personality',
  'otId',
  'nickname',
  'otName',
  'otGender',
  'heldItem',
  'exp',
  'friendship',
  'moves',
  'pp',
  'ppBonuses',
  'ivs',
  'evs',
  'abilityNum',
  'metLevel',
  'metLocation',
  'pokeball',
  'isEgg',
  'pokerus',
  'markings',
] as const satisfies readonly (keyof BoxPokemon)[];

/** struct Pokemon's party-only fields. */
const PARTY_MON_FIELDS = ['level', 'status', 'hp', 'maxHP', 'stats'] as const satisfies readonly (keyof Pokemon)[];

// A Pokemon field missing from the lists above fails to compile here: add it (and bump SAVE_VERSION).
type Unlisted = Exclude<keyof Pokemon, (typeof BOX_MON_FIELDS)[number] | (typeof PARTY_MON_FIELDS)[number]>;
const allFieldsListed: [Unlisted] extends [never] ? true : Unlisted = true;
void allFieldsListed;

export type BoxMonSave = BoxPokemon;
export type MonSave = Pokemon;
/** struct DaycareMon (world/daycare.ts). */
export interface DaycareMonSave {
  mon: BoxMonSave | null;
  steps: number;
}
/** The Easy Chat words of gSaveBlock1 (GameState's fields of the same names). */
export interface EasyChatSave {
  profile: number[];
  battleStart: number[];
  battleWon: number[];
  battleLost: number[];
  questionnaireWords: number[];
  additionalPhrases: number[];
}
/** An item slot as [itemId, quantity]. */
export type ItemSlotSave = [number, number];

export interface SaveData {
  version: number;

  // ---- gSaveBlock2
  playerName: string;
  playerGender: 'male' | 'female';
  trainerId: number;
  playTime: PlayTime;
  options: {
    textSpeed: TextSpeed;
    windowFrameType: number;
    buttonMode: number;
    battleStyleSet: boolean;
    battleSceneOff: boolean;
    /** OPTIONS_SOUND_MONO / _STEREO; since version 3. */
    sound: number;
  };
  /** struct Pokedex: seen / caught national dex numbers, ascending; nationalMagic as a flag. */
  pokedex: { seen: number[]; caught: number[]; nationalDexEnabled: boolean };
  specialSaveWarpFlags: number;

  // ---- gSaveBlock1
  /** location + pos + the player object (absent if the field never stored one). */
  location?: PlayerLocation;
  continueGameWarp?: WarpData;
  dynamicWarp?: WarpData;
  lastHealLocation?: { map: string; x: number; y: number };
  escapeWarp?: WarpData;
  party: MonSave[];
  money: number;
  coins: number;
  registeredItem: number;
  /** gSaveBlock1Ptr->flashLevel (world/flash.ts). */
  flashLevel: number;
  /** gSaveBlock1Ptr->savedMusic (gba/overworldMusic.ts: the bike's MUS_CYCLING, `savebgm`), 0 = none; since version 6. */
  savedMusic: number;
  /** gSaveBlock1Ptr->weather (world/weather.ts: the map's, or `setweather`'s), WEATHER_NONE = 0; since version 7. */
  weather: number;
  /** gSaveBlock1Ptr->gameStats (NUM_GAME_STATS, unencrypted); since version 2. */
  gameStats: number[];
  /** pcItems, trailing empty slots left out. */
  pcItems: ItemSlotSave[];
  /** bagPocket_* in POCKET_* order, trailing empty slots left out. */
  bag: ItemSlotSave[][];
  trainerRematchStepCounter: number;
  trainerRematches: number[];
  /** Set flag ids below SPECIAL_FLAGS_START, ascending. */
  flags: number[];
  /** Non-zero vars VARS_START..VARS_END as [id, value], ascending. */
  vars: [number, number][];
  /** struct DayCare (the Four Island daycare); since version 4 (version 3 had only its stepCounter). */
  daycare: { mons: DaycareMonSave[]; offspringPersonality: number; stepCounter: number };
  /** The Route 5 daycare man's mon; since version 4. */
  route5DayCareMon: DaycareMonSave;
  roamer: RoamerSave;
  rivalName: string;
  /**
   * gSaveBlock1Ptr->easyChatProfile / easyChatBattleStart / easyChatBattleWon / easyChatBattleLost,
   * mysteryGift.questionnaireWords and additionalPhrases (menus/easyChatData.ts); since version 5. Absent in a
   * save from version 4: the fresh state's new-game words (InitEasyChatPhrases, InitQuestionnaireWords) stay, as
   * they would have on the GBA, where every new game ran them.
   */
  easyChat?: EasyChatSave;
  /**
   * gSaveBlock1Ptr->towerChallengeId and trainerTower[NUM_TOWER_CHALLENGE_TYPES] (state/trainerTowerRecord.ts);
   * since version 8. Absent in an older save: the new-game records (ResetTrainerTowerResults) stay.
   */
  trainerTower?: { challengeId: number; records: TrainerTowerRecord[] };

  // ---- gPokemonStoragePtr
  storage: {
    currentBox: number;
    /** [box][position]; null = empty slot. */
    boxes: (BoxMonSave | null)[][];
    /** Encoded names, no EOS. */
    boxNames: number[][];
    boxWallpapers: number[];
  };
}

function copyFields<T extends object>(src: T, fields: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const f of fields) if (src[f] !== undefined) out[f] = structuredClone(src[f]);
  return out;
}

function boxMonSave(mon: BoxPokemon): BoxMonSave {
  return copyFields(mon, BOX_MON_FIELDS) as BoxMonSave;
}

function monSave(mon: Pokemon): MonSave {
  return { ...boxMonSave(mon), ...copyFields(mon, PARTY_MON_FIELDS) } as MonSave;
}

function daycareMonSave(m: DaycareMon): DaycareMonSave {
  return { mon: m.mon && boxMonSave(m.mon), steps: m.steps };
}

function loadDaycareMon(m: DaycareMon, saved: DaycareMonSave | undefined): void {
  m.mon = clone(saved?.mon ?? null);
  m.steps = saved?.steps ?? 0;
}

function itemSlotsSave(slots: ItemSlot[], none: number): ItemSlotSave[] {
  const out = slots.map((s): ItemSlotSave => [s.itemId, s.quantity]);
  while (out.length && out[out.length - 1][0] === none && out[out.length - 1][1] === 0) out.pop();
  return out;
}

function loadItemSlots(slots: ItemSlot[], saved: ItemSlotSave[], none: number): void {
  for (let i = 0; i < slots.length; i++) {
    const s = saved[i];
    slots[i] = s ? { itemId: s[0], quantity: s[1] } : { itemId: none, quantity: 0 };
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** SaveSerializedGame: the state as a save file. */
export function toSaveData(state: GameState): SaveData {
  const d = state.defines;
  const none = d.require('ITEM_NONE');
  const specialFlagsStart = d.require('SPECIAL_FLAGS_START');
  const varsStart = d.require('VARS_START');
  const varsEnd = d.require('VARS_END');
  const st = state.storage;
  const data: SaveData = {
    version: SAVE_VERSION,
    playerName: state.playerName,
    playerGender: state.playerGender,
    trainerId: state.trainerId >>> 0,
    playTime: { ...state.playTime },
    options: {
      textSpeed: state.textSpeed,
      windowFrameType: state.optionsWindowFrameType,
      buttonMode: state.optionsButtonMode,
      battleStyleSet: state.battleStyleSet,
      battleSceneOff: state.battleSceneOff,
      sound: state.optionsSound,
    },
    pokedex: {
      seen: [...state.dexSeen].sort((a, b) => a - b),
      caught: [...state.dexCaught].sort((a, b) => a - b),
      nationalDexEnabled: state.nationalDexEnabled,
    },
    specialSaveWarpFlags: state.specialSaveWarpFlags,
    location: clone(state.location),
    continueGameWarp: clone(state.continueGameWarp),
    dynamicWarp: clone(state.dynamicWarp),
    lastHealLocation: clone(state.lastHealLocation),
    escapeWarp: clone(state.escapeWarp),
    party: state.party.map(monSave),
    money: state.money,
    coins: state.coins,
    registeredItem: state.registeredItem,
    flashLevel: state.flashLevel,
    savedMusic: state.savedMusic,
    weather: state.weather,
    gameStats: [...state.gameStats],
    pcItems: itemSlotsSave(state.pcItems, none),
    bag: state.bag.pockets.map((p) => itemSlotsSave(p, none)),
    trainerRematchStepCounter: state.trainerRematchStepCounter,
    trainerRematches: [...state.trainerRematches],
    flags: state.flagIds().filter((f) => f < specialFlagsStart),
    vars: state.varEntries().filter(([v]) => v >= varsStart && v <= varsEnd),
    daycare: {
      mons: state.daycare.mons.map(daycareMonSave),
      offspringPersonality: state.daycare.offspringPersonality,
      stepCounter: state.daycare.stepCounter,
    },
    route5DayCareMon: daycareMonSave(state.route5DayCareMon),
    roamer: structuredClone(state.roamer),
    rivalName: state.rivalName,
    easyChat: {
      profile: [...state.easyChatProfile],
      battleStart: [...state.easyChatBattleStart],
      battleWon: [...state.easyChatBattleWon],
      battleLost: [...state.easyChatBattleLost],
      questionnaireWords: [...state.questionnaireWords],
      additionalPhrases: [...state.additionalPhrases],
    },
    trainerTower: { challengeId: state.towerChallengeId, records: state.trainerTower.map((r) => ({ ...r })) },
    storage: {
      currentBox: st.currentBox,
      boxes: st.boxes.map((box) => box.map((mon) => mon && boxMonSave(mon))),
      boxNames: st.boxNames.map((n) => [...n]),
      boxWallpapers: [...st.boxWallpapers],
    },
  };
  // Optional fields the state doesn't have are left out rather than written as undefined.
  for (const k of ['location', 'continueGameWarp', 'dynamicWarp', 'lastHealLocation', 'escapeWarp'] as const) {
    if (data[k] === undefined) delete data[k];
  }
  return data;
}

/**
 * LoadSerializedGame: replaces everything the save holds in `state`, which should be a fresh GameState (what
 * isn't in the save keeps its new-game value). Throws on a save of another version.
 */
export function fromSaveData(data: SaveData, state: GameState): GameState {
  data = upgradeSave(data);
  if (data?.version !== SAVE_VERSION) throw new Error(`[save] unsupported save version ${String(data?.version)}`);
  const none = state.defines.require('ITEM_NONE');

  state.playerName = data.playerName;
  state.playerGender = data.playerGender;
  state.trainerId = data.trainerId >>> 0;
  Object.assign(state.playTime, data.playTime);
  state.textSpeed = data.options.textSpeed;
  state.optionsWindowFrameType = data.options.windowFrameType;
  state.optionsButtonMode = data.options.buttonMode;
  state.battleStyleSet = data.options.battleStyleSet;
  state.battleSceneOff = data.options.battleSceneOff;
  state.optionsSound = data.options.sound;
  state.dexSeen.clear();
  for (const n of data.pokedex.seen) state.dexSeen.add(n);
  state.dexCaught.clear();
  for (const n of data.pokedex.caught) state.dexCaught.add(n);
  state.nationalDexEnabled = data.pokedex.nationalDexEnabled;
  state.specialSaveWarpFlags = data.specialSaveWarpFlags;

  state.location = clone(data.location);
  state.continueGameWarp = clone(data.continueGameWarp);
  state.dynamicWarp = clone(data.dynamicWarp);
  state.lastHealLocation = clone(data.lastHealLocation);
  state.escapeWarp = clone(data.escapeWarp);
  state.party = data.party.map((m) => structuredClone(m));
  state.money = data.money;
  state.coins = data.coins;
  state.registeredItem = data.registeredItem;
  state.flashLevel = data.flashLevel;
  state.savedMusic = data.savedMusic;
  state.weather = data.weather;
  state.gameStats.forEach((_, i) => (state.gameStats[i] = data.gameStats[i] ?? 0));
  loadItemSlots(state.pcItems, data.pcItems, none);
  state.bag.pockets.forEach((pocket, i) => loadItemSlots(pocket, data.bag[i] ?? [], none));
  state.trainerRematchStepCounter = data.trainerRematchStepCounter;
  state.trainerRematches = [...data.trainerRematches];
  state.setFlagIds(data.flags);
  state.setVarEntries(data.vars);
  state.daycare.mons.forEach((m, i) => loadDaycareMon(m, data.daycare.mons[i]));
  state.daycare.offspringPersonality = data.daycare.offspringPersonality;
  state.daycare.stepCounter = data.daycare.stepCounter;
  loadDaycareMon(state.route5DayCareMon, data.route5DayCareMon);
  state.roamer = structuredClone(data.roamer);
  state.rivalName = data.rivalName;
  if (data.easyChat) {
    state.easyChatProfile = [...data.easyChat.profile];
    state.easyChatBattleStart = [...data.easyChat.battleStart];
    state.easyChatBattleWon = [...data.easyChat.battleWon];
    state.easyChatBattleLost = [...data.easyChat.battleLost];
    state.questionnaireWords = [...data.easyChat.questionnaireWords];
    state.additionalPhrases = [...data.easyChat.additionalPhrases];
  }
  if (data.trainerTower) {
    state.towerChallengeId = data.trainerTower.challengeId;
    state.trainerTower.forEach((r, i) => Object.assign(r, data.trainerTower!.records[i]));
  }

  const st = state.storage;
  st.currentBox = data.storage.currentBox;
  st.boxes.forEach((box, b) => box.forEach((_, p) => (box[p] = clone(data.storage.boxes[b]?.[p] ?? null))));
  st.boxNames.forEach((_, b) => (st.boxNames[b] = [...(data.storage.boxNames[b] ?? [])]));
  st.boxWallpapers.forEach((_, b) => (st.boxWallpapers[b] = data.storage.boxWallpapers[b] ?? 0));
  return state;
}

/** Bring a save of an older version that only lacks fields up to SAVE_VERSION (other saves are returned as they are). */
export function upgradeSave(data: SaveData): SaveData {
  if (data?.version === 1) data = { ...data, version: 2, gameStats: new Array<number>(64).fill(0) };
  // OPTIONS_SOUND_MONO, the new-game default
  if (data?.version === 2) data = { ...data, version: 3, options: { ...data.options, sound: 0 } };
  // The daycare's step counter was saved on its own; both daycares were empty (they weren't ported).
  if (data?.version === 3) {
    const { daycareStepCounter, ...rest } = data as SaveData & { daycareStepCounter?: number };
    const empty = (): DaycareMonSave => ({ mon: null, steps: 0 });
    data = { ...rest, version: 4, daycare: { mons: [empty(), empty()], offspringPersonality: 0, stepCounter: daycareStepCounter ?? 0 }, route5DayCareMon: empty() };
  }
  // No easyChat: fromSaveData keeps the new-game words.
  if (data?.version === 4) data = { ...data, version: 5 };
  // No music was saved: the map's own (as on a new game).
  if (data?.version === 5) data = { ...data, version: 6, savedMusic: 0 };
  // No weather was saved: WEATHER_NONE until the next map load sets the map's (a CONTINUE in a shaded map is lit).
  if (data?.version === 6) data = { ...data, version: 7, weather: 0 };
  // No Trainer Tower records: fromSaveData keeps the new-game ones (ResetTrainerTowerResults).
  if (data?.version === 7) data = { ...data, version: 8 };
  return data;
}

// ------------------------------------------------------------------ the save slot (browser localStorage)

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // blocked (e.g. a sandboxed frame)
  }
}

/** Write the save slot. False if storage isn't available or is full (the GBA's SAVE_STATUS_ERROR). */
export function writeSave(data: SaveData, storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[save] write failed', err);
    return false;
  }
}

/** The save slot's contents, or undefined if there's none or it can't be read (unparsable or another version). */
export function readSave(storage = defaultStorage()): SaveData | undefined {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(SAVE_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  try {
    const data = upgradeSave(JSON.parse(raw) as SaveData);
    if (data?.version !== SAVE_VERSION) {
      console.warn(`[save] ignoring a save of version ${String(data?.version)}`);
      return undefined;
    }
    return data;
  } catch (err) {
    console.warn('[save] unreadable save', err);
    return undefined;
  }
}

/** Whether the slot holds anything at all, readable or not (save.c's empty-slot check). */
export function saveSlotUsed(storage = defaultStorage()): boolean {
  try {
    return !!storage?.getItem(SAVE_STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Whether the slot holds a readable save (main_menu.c's HAS_SAVED_GAME check). */
export function hasSave(storage = defaultStorage()): boolean {
  return readSave(storage) !== undefined;
}

/** Empty the slot (ClearSaveData). */
export function clearSave(storage = defaultStorage()): void {
  try {
    storage?.removeItem(SAVE_STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
