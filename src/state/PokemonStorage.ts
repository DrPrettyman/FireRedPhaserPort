// struct PokemonStorage (gPokemonStoragePtr) and the data side of the PC boxes: pokemon_storage_system.c's
// box accessors, pokemon_storage_system_menu.c's ResetPokemonStorageSystem / GetFirstFreeBoxSpot /
// CountMonsInBox, and pokemon.c's BoxPokemon <-> Pokemon conversions. The storage UI isn't here.

import type { Pokemon, PokemonData } from '../pokemon/Pokemon';

/** The fields struct Pokemon adds to struct BoxPokemon (recomputed by BoxMonToMon). */
export const PARTY_ONLY_FIELDS = ['level', 'status', 'hp', 'maxHP', 'stats'] as const;

/** struct BoxPokemon: a Pokemon without its party fields. An empty slot (SPECIES_NONE) is null. */
export type BoxPokemon = Omit<Pokemon, (typeof PARTY_ONLY_FIELDS)[number]>;

/** The constants the storage reads (pokemon_storage_system.h). */
export interface StorageConstants {
  TOTAL_BOXES_COUNT: number;
  IN_BOX_COUNT: number;
  MAX_DEFAULT_WALLPAPER: number;
  WALLPAPER_COUNT: number;
}

/** A deep copy of the BoxPokemon part of a mon (CopyMon(&boxMon, &mon->box, sizeof(mon->box))). */
export function boxMonFromMon(mon: BoxPokemon): BoxPokemon {
  const box: Partial<Pokemon> = structuredClone(mon);
  for (const f of PARTY_ONLY_FIELDS) delete box[f];
  return box as BoxPokemon;
}

/**
 * BoxMonToMon: status, HP and max HP zeroed, then CalculateMonStats, which (with both HPs 0) sets HP to the new
 * max: a mon taken out of a box is always fully healed. (MON_DATA_MAIL isn't modelled.)
 */
export function boxMonToMon(data: PokemonData, boxMon: BoxPokemon): Pokemon {
  const mon: Pokemon = {
    ...structuredClone(boxMon),
    level: 0,
    status: 0,
    hp: 0,
    maxHP: 0,
    stats: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 },
  };
  data.calculateStats(mon);
  return mon;
}

/** BoxMonRestorePP (MonRestorePP): every known move back to its max PP (with PP Ups). */
export function boxMonRestorePP(data: PokemonData, mon: BoxPokemon): void {
  for (let i = 0; i < data.c.MAX_MON_MOVES; i++) {
    if (mon.moves[i]) mon.pp[i] = data.ppWithBonus(mon.moves[i], mon.ppBonuses, i);
  }
}

/** struct PokemonStorage */
export class PokemonStorage {
  currentBox = 0;
  /** boxes[boxId][boxPosition]; null = an empty slot (SPECIES_NONE). */
  readonly boxes: (BoxPokemon | null)[][];
  /** Encoded names, without EOS (at most BOX_NAME_LENGTH chars). */
  readonly boxNames: number[][];
  readonly boxWallpapers: number[];

  constructor(
    readonly c: StorageConstants,
    /** gText_Box, encoded without EOS ("BOX"). */
    private readonly textBox: number[],
    /** ConvertIntToDecimalStringN(n, STR_CONV_MODE_LEFT_ALIGN, 2) */
    private readonly digits: (n: number) => number[],
  ) {
    this.boxes = Array.from({ length: c.TOTAL_BOXES_COUNT }, () => Array<BoxPokemon | null>(c.IN_BOX_COUNT).fill(null));
    this.boxNames = Array.from({ length: c.TOTAL_BOXES_COUNT }, () => []);
    this.boxWallpapers = Array<number>(c.TOTAL_BOXES_COUNT).fill(0);
    this.reset();
  }

  /** ResetPokemonStorageSystem: box 0 current, every slot empty, names "BOX1".."BOX14", wallpapers 0-3 in turn. */
  reset(): void {
    this.setCurrentBox(0);
    for (let boxId = 0; boxId < this.c.TOTAL_BOXES_COUNT; boxId++) {
      for (let pos = 0; pos < this.c.IN_BOX_COUNT; pos++) this.zeroBoxMonAt(boxId, pos);
    }
    for (let boxId = 0; boxId < this.c.TOTAL_BOXES_COUNT; boxId++) this.boxNames[boxId] = [...this.textBox, ...this.digits(boxId + 1)];
    for (let boxId = 0; boxId < this.c.TOTAL_BOXES_COUNT; boxId++) this.setBoxWallpaper(boxId, boxId % (this.c.MAX_DEFAULT_WALLPAPER + 1));
  }

  private valid(boxId: number, pos?: number): boolean {
    return boxId >= 0 && boxId < this.c.TOTAL_BOXES_COUNT && (pos === undefined || (pos >= 0 && pos < this.c.IN_BOX_COUNT));
  }

  /** StorageGetCurrentBox */
  getCurrentBox(): number {
    return this.currentBox;
  }

  /** SetCurrentBox: ignored for an out-of-range box. */
  setCurrentBox(boxId: number): void {
    if (boxId >= 0 && boxId < this.c.TOTAL_BOXES_COUNT) this.currentBox = boxId;
  }

  /** GetBoxedMonPtr: the mon in a slot (null if empty or out of range). Changes to it change the box. */
  getBoxedMon(boxId: number, pos: number): BoxPokemon | null {
    return this.valid(boxId, pos) ? this.boxes[boxId][pos] : null;
  }

  /**
   * GetBoxMonDataAt: one field of a boxed mon. As on the GBA, an empty slot reads as 0 (SPECIES_NONE), and so does
   * an out-of-range slot; non-numeric fields read as undefined there.
   */
  getBoxMonDataAt<F extends keyof BoxPokemon>(boxId: number, pos: number, field: F): BoxPokemon[F] | 0 {
    const mon = this.getBoxedMon(boxId, pos);
    return mon ? mon[field] : 0;
  }

  /** SetBoxMonDataAt */
  setBoxMonDataAt<F extends keyof BoxPokemon>(boxId: number, pos: number, field: F, value: BoxPokemon[F]): void {
    const mon = this.getBoxedMon(boxId, pos);
    if (mon) mon[field] = value;
  }

  /** GetCurrentBoxMonData */
  getCurrentBoxMonData<F extends keyof BoxPokemon>(pos: number, field: F): BoxPokemon[F] | 0 {
    return this.getBoxMonDataAt(this.currentBox, pos, field);
  }

  /** SetCurrentBoxMonData */
  setCurrentBoxMonData<F extends keyof BoxPokemon>(pos: number, field: F, value: BoxPokemon[F]): void {
    this.setBoxMonDataAt(this.currentBox, pos, field, value);
  }

  /** GetBoxMonNickAt: the nickname (empty for an empty or out-of-range slot). */
  getBoxMonNickAt(boxId: number, pos: number): number[] {
    const mon = this.getBoxedMon(boxId, pos);
    return mon ? [...mon.nickname] : [];
  }

  /** SetBoxMonNickAt */
  setBoxMonNickAt(boxId: number, pos: number, nick: number[]): void {
    const mon = this.getBoxedMon(boxId, pos);
    if (mon) mon.nickname = [...nick];
  }

  /** SetBoxMonAt: stores a copy of `mon` (null empties the slot). */
  setBoxMonAt(boxId: number, pos: number, mon: BoxPokemon | null): void {
    if (this.valid(boxId, pos)) this.boxes[boxId][pos] = mon && boxMonFromMon(mon);
  }

  /** CopyBoxMonAt: a copy of the boxed mon (null if empty). */
  copyBoxMonAt(boxId: number, pos: number): BoxPokemon | null {
    const mon = this.getBoxedMon(boxId, pos);
    return mon && boxMonFromMon(mon);
  }

  /** ZeroBoxMonAt */
  zeroBoxMonAt(boxId: number, pos: number): void {
    if (this.valid(boxId, pos)) this.boxes[boxId][pos] = null;
  }

  /** BoxMonAtToMon: the boxed mon as a party mon (stats recalculated, fully healed); undefined if empty. */
  boxMonAtToMon(data: PokemonData, boxId: number, pos: number): Pokemon | undefined {
    const mon = this.getBoxedMon(boxId, pos);
    return mon ? boxMonToMon(data, mon) : undefined;
  }

  /** GetBoxNamePtr: the box's name (encoded, no EOS); undefined for an out-of-range box. */
  getBoxName(boxId: number): number[] | undefined {
    return this.valid(boxId) ? this.boxNames[boxId] : undefined;
  }

  /** The box's name being replaced (the naming screen writes into GetBoxNamePtr's buffer). */
  setBoxName(boxId: number, name: number[]): void {
    if (this.valid(boxId)) this.boxNames[boxId] = [...name];
  }

  /** GetBoxWallpaper */
  getBoxWallpaper(boxId: number): number {
    return this.valid(boxId) ? this.boxWallpapers[boxId] : 0;
  }

  /** SetBoxWallpaper: ignored for an out-of-range box or wallpaper. */
  setBoxWallpaper(boxId: number, wallpaperId: number): void {
    if (this.valid(boxId) && wallpaperId >= 0 && wallpaperId < this.c.WALLPAPER_COUNT) this.boxWallpapers[boxId] = wallpaperId;
  }

  /** GetFirstFreeBoxSpot: the first empty slot in the box, or -1. */
  getFirstFreeBoxSpot(boxId: number): number {
    for (let i = 0; i < this.c.IN_BOX_COUNT; i++) if (!this.getBoxMonDataAt(boxId, i, 'species')) return i;
    return -1;
  }

  /** CountMonsInBox */
  countMonsInBox(boxId: number): number {
    let count = 0;
    for (let i = 0; i < this.c.IN_BOX_COUNT; i++) if (this.getBoxMonDataAt(boxId, i, 'species')) count++;
    return count;
  }

  /** IsPokemonStorageFull (pokemon.c) */
  isFull(): boolean {
    for (let i = 0; i < this.c.TOTAL_BOXES_COUNT; i++) {
      for (let j = 0; j < this.c.IN_BOX_COUNT; j++) if (!this.getBoxMonDataAt(i, j, 'species')) return false;
    }
    return true;
  }

  /**
   * SeekToNextMonInBox: the next (or, with flags bit 1, previous) occupied slot after curIndex, up to maxIndex;
   * eggs are skipped unless flags bit 0 is set. -1 if there is none.
   */
  seekToNextMonInBox(boxId: number, curIndex: number, maxIndex: number, flags: number): number {
    const adder = flags === 0 || flags === 1 ? 1 : -1;
    const allowEggs = flags === 1 || flags === 3;
    for (let i = curIndex + adder; i >= 0 && i <= maxIndex; i += adder) {
      const mon = this.boxes[boxId][i];
      if (mon && (allowEggs || !mon.isEgg)) return i;
    }
    return -1;
  }
}
