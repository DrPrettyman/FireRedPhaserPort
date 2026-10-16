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

/** Bump when SaveData changes shape; fromSaveData refuses other versions. */
export const SAVE_VERSION = 1;

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
] as const satisfies readonly (keyof BoxPokemon)[];

/** struct Pokemon's party-only fields. */
const PARTY_MON_FIELDS = ['level', 'status', 'hp', 'maxHP', 'stats'] as const satisfies readonly (keyof Pokemon)[];

// A Pokemon field missing from the lists above fails to compile here: add it (and bump SAVE_VERSION).
type Unlisted = Exclude<keyof Pokemon, (typeof BOX_MON_FIELDS)[number] | (typeof PARTY_MON_FIELDS)[number]>;
const allFieldsListed: [Unlisted] extends [never] ? true : Unlisted = true;
void allFieldsListed;

export type BoxMonSave = BoxPokemon;
export type MonSave = Pokemon;
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
  daycareStepCounter: number;
  roamer: RoamerSave;
  rivalName: string;

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
    pcItems: itemSlotsSave(state.pcItems, none),
    bag: state.bag.pockets.map((p) => itemSlotsSave(p, none)),
    trainerRematchStepCounter: state.trainerRematchStepCounter,
    trainerRematches: [...state.trainerRematches],
    flags: state.flagIds().filter((f) => f < specialFlagsStart),
    vars: state.varEntries().filter(([v]) => v >= varsStart && v <= varsEnd),
    daycareStepCounter: state.daycareStepCounter,
    roamer: structuredClone(state.roamer),
    rivalName: state.rivalName,
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
  loadItemSlots(state.pcItems, data.pcItems, none);
  state.bag.pockets.forEach((pocket, i) => loadItemSlots(pocket, data.bag[i] ?? [], none));
  state.trainerRematchStepCounter = data.trainerRematchStepCounter;
  state.trainerRematches = [...data.trainerRematches];
  state.setFlagIds(data.flags);
  state.setVarEntries(data.vars);
  state.daycareStepCounter = data.daycareStepCounter;
  state.roamer = structuredClone(data.roamer);
  state.rivalName = data.rivalName;

  const st = state.storage;
  st.currentBox = data.storage.currentBox;
  st.boxes.forEach((box, b) => box.forEach((_, p) => (box[p] = clone(data.storage.boxes[b]?.[p] ?? null))));
  st.boxNames.forEach((_, b) => (st.boxNames[b] = [...(data.storage.boxNames[b] ?? [])]));
  st.boxWallpapers.forEach((_, b) => (st.boxWallpapers[b] = data.storage.boxWallpapers[b] ?? 0));
  return state;
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
    const data = JSON.parse(raw) as SaveData;
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
