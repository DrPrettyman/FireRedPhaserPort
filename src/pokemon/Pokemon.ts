import type { ItemInfo, MoveInfo, PokemonTables, SpeciesInfo } from '../data/types';
import type { Defines } from '../script/Defines';
import type { Charmap } from '../text/charmap';
import { random, random32 } from '../util/random';

const CONSTANT_NAMES = [
  'MAX_LEVEL',
  'MAX_MON_MOVES',
  'PARTY_SIZE',
  'NUM_NATURES',
  'USE_RANDOM_IVS',
  'MAX_IV_MASK',
  'MON_MALE',
  'MON_FEMALE',
  'MON_GENDERLESS',
  'SPECIES_SHEDINJA',
  'SPECIES_UNOWN',
  'SPECIES_OLD_UNOWN_B',
  'SPECIES_OLD_UNOWN_Z',
  'SPECIES_EGG',
  'ITEM_POKE_BALL',
  'MON_GIVEN_TO_PARTY',
  'MON_GIVEN_TO_PC',
  'MON_CANT_GIVE',
] as const;

/** Constants from include/constants (pokemon.h, species.h, items.h), read from the extracted defines. */
export type PokemonConstants = Record<(typeof CONSTANT_NAMES)[number], number>;

export function readPokemonConstants(defines: Defines): PokemonConstants {
  return Object.fromEntries(CONSTANT_NAMES.map((n) => [n, defines.require(n)])) as PokemonConstants;
}

/** Stat order of struct Pokemon and sNatureStatTable (STAT_HP .. STAT_SPDEF). */
export const STATS = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
export type Stat = (typeof STATS)[number];
export type StatBlock = Record<Stat, number>;

const BASE_STAT: Record<Stat, keyof SpeciesInfo> = {
  hp: 'baseHP',
  attack: 'baseAttack',
  defense: 'baseDefense',
  speed: 'baseSpeed',
  spAttack: 'baseSpAttack',
  spDefense: 'baseSpDefense',
};

/** struct Pokemon (BoxPokemon substructs + party fields), unencrypted. */
export interface Pokemon {
  species: number;
  personality: number;
  otId: number;
  /** Encoded name bytes, no terminator. */
  nickname: number[];
  otName: string;
  otGender: 'male' | 'female';
  heldItem: number;
  exp: number;
  friendship: number;
  moves: number[];
  pp: number[];
  /** Two bits per move slot (gPPUpGetMask). */
  ppBonuses: number;
  ivs: StatBlock;
  evs: StatBlock;
  abilityNum: number;
  metLevel: number;
  /** MAPSEC_* name; the GBA stores the numeric map section id. */
  metLocation: string;
  pokeball: number;
  isEgg: boolean;
  /** MON_DATA_POKERUS (strain << 4 | days); absent = never infected. */
  pokerus?: number;
  /** MON_DATA_MARKINGS (circle, square, triangle, heart bits); absent = none. */
  markings?: number;
  // Party-only fields
  level: number;
  status: number;
  hp: number;
  maxHP: number;
  stats: StatBlock;
  /** MON_DATA_MAIL: the held mail's gSaveBlock1Ptr->mail slot (world/mail.ts); absent = MAIL_NONE. Party only. */
  mail?: number;
}

export interface CreateMonOptions {
  /** fixedIV: < USE_RANDOM_IVS sets every IV to this value. */
  fixedIV?: number;
  personality?: number;
  otId: number;
  otName: string;
  otGender: 'male' | 'female';
  metLocation: string;
}

/** What SpeciesToCryId reads: set by the PokemonData constructor (the species constants, cry_ids.h's table). */
let sCryIds: { unown: number; oldUnownB: number; oldUnownZ: number; hoennSpeciesIdToCryId: readonly number[] } | undefined;

/**
 * SpeciesToCryId (pokemon.c): the gCryTable index of `species`, which PlayCryInternal (gba/sound.ts) has already
 * decremented (species - 1). Gen I-II species are their own cry id, the old Unown letters share Unown's, and the
 * Hoenn species go through sHoennSpeciesIdToCryId. Before any PokemonData exists (the title screen's Charizard)
 * only the first rule applies, which covers every species below the old Unown letters.
 */
export function SpeciesToCryId(species: number): number {
  if (!sCryIds || species < sCryIds.oldUnownB - 1) return species;
  if (species <= sCryIds.oldUnownZ - 1) return sCryIds.unown - 1;
  // past the table (SPECIES_EGG and beyond) the C reads whatever follows it; no caller cries for those
  return sCryIds.hoennSpeciesIdToCryId[species - (sCryIds.oldUnownZ + 1 - 1)] ?? species;
}

/** Species/move/item tables plus the pokemon.c functions that read them. */
export class PokemonData {
  private names = new Map<number, number[]>();

  constructor(
    readonly c: PokemonConstants,
    readonly species: SpeciesInfo[],
    readonly moves: MoveInfo[],
    readonly items: ItemInfo[],
    readonly tables: PokemonTables,
    private charmap: Charmap,
  ) {
    sCryIds = {
      unown: c.SPECIES_UNOWN,
      oldUnownB: c.SPECIES_OLD_UNOWN_B,
      oldUnownZ: c.SPECIES_OLD_UNOWN_Z,
      hoennSpeciesIdToCryId: tables.hoennSpeciesIdToCryId,
    };
  }

  /** gSpeciesNames[species], encoded without the terminator. */
  speciesName(species: number): number[] {
    let n = this.names.get(species);
    if (!n) {
      n = this.charmap.encodePlain(this.species[species]?.name ?? '??????????$');
      this.names.set(species, n);
    }
    return n;
  }

  /** Encode a runtime name (player/OT name) without the terminator. */
  encodeName(name: string): number[] {
    return this.charmap.encodePlain(name);
  }

  /** ItemId_GetName / CopyItemName, encoded without the terminator. */
  itemName(item: number): number[] {
    return this.charmap.encodePlain(this.items[item]?.name ?? '????????$');
  }

  itemPocket(item: number): number {
    return this.items[item]?.pocket ?? 0;
  }

  /** CreateMon + CreateBoxMon */
  createMon(speciesId: number, level: number, opts: CreateMonOptions): Pokemon {
    const info = this.species[speciesId];
    const personality = opts.personality ?? random32();
    let ivs: StatBlock;
    const { USE_RANDOM_IVS, MAX_IV_MASK } = this.c;
    if ((opts.fixedIV ?? USE_RANDOM_IVS) < USE_RANDOM_IVS) {
      const v = opts.fixedIV!;
      ivs = { hp: v, attack: v, defense: v, speed: v, spAttack: v, spDefense: v };
    } else {
      const a = random();
      const b = random();
      ivs = {
        hp: a & MAX_IV_MASK,
        attack: (a >> 5) & MAX_IV_MASK,
        defense: (a >> 10) & MAX_IV_MASK,
        speed: b & MAX_IV_MASK,
        spAttack: (b >> 5) & MAX_IV_MASK,
        spDefense: (b >> 10) & MAX_IV_MASK,
      };
    }
    const zero = (): StatBlock => ({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
    const mon: Pokemon = {
      species: speciesId,
      personality,
      otId: opts.otId,
      nickname: [...this.speciesName(speciesId)],
      otName: opts.otName,
      otGender: opts.otGender,
      heldItem: 0,
      exp: this.tables.experience[info.growthRate][level],
      friendship: info.friendship,
      moves: [0, 0, 0, 0],
      pp: [0, 0, 0, 0],
      ppBonuses: 0,
      ivs,
      evs: zero(),
      abilityNum: info.abilities[1] ? personality & 1 : 0,
      metLevel: level,
      metLocation: opts.metLocation,
      pokeball: this.c.ITEM_POKE_BALL,
      isEgg: false,
      level,
      status: 0,
      hp: 0,
      maxHP: 0,
      stats: zero(),
    };
    this.giveInitialMoveset(mon);
    this.calculateStats(mon);
    return mon;
  }

  /** GiveBoxMonInitialMoveset: every level-up move up to the current level, oldest pushed out first. */
  private giveInitialMoveset(mon: Pokemon): void {
    const level = this.levelFromExp(mon);
    for (const [moveLevel, move] of this.species[mon.species].learnset) {
      if (moveLevel > level) break;
      if (this.giveMove(mon, move) === 'full') this.deleteFirstMoveAndGiveMove(mon, move);
    }
  }

  /** GiveMoveToBoxMon */
  giveMove(mon: Pokemon, move: number): number | 'known' | 'full' {
    for (let i = 0; i < this.c.MAX_MON_MOVES; i++) {
      if (!mon.moves[i]) {
        mon.moves[i] = move;
        mon.pp[i] = this.moves[move].pp;
        return move;
      }
      if (mon.moves[i] === move) return 'known';
    }
    return 'full';
  }

  /** DeleteFirstMoveAndGiveMoveToBoxMon */
  private deleteFirstMoveAndGiveMove(mon: Pokemon, move: number): void {
    mon.moves = [...mon.moves.slice(1), move];
    mon.pp = [...mon.pp.slice(1), this.moves[move].pp];
    mon.ppBonuses >>= 2;
  }

  /** GetLevelFromMonExp */
  levelFromExp(mon: Pokemon): number {
    const table = this.tables.experience[this.species[mon.species].growthRate];
    let level = 1;
    while (level <= this.c.MAX_LEVEL && table[level] <= mon.exp) level++;
    return level - 1;
  }

  /** CalculateMonStats (incl. CALC_STAT and ModifyStatByNature). */
  calculateStats(mon: Pokemon): void {
    const info = this.species[mon.species];
    const oldMaxHP = mon.maxHP;
    let currentHP = mon.hp;
    const level = this.levelFromExp(mon);
    mon.level = level;

    const { SPECIES_SHEDINJA } = this.c;
    const newMaxHP =
      mon.species === SPECIES_SHEDINJA
        ? 1
        : Math.trunc(((2 * info.baseHP + mon.ivs.hp + Math.trunc(mon.evs.hp / 4)) * level) / 100) + level + 10;
    mon.maxHP = newMaxHP;

    const nature = this.nature(mon);
    for (let s = 1; s < STATS.length; s++) {
      const stat = STATS[s];
      const base = info[BASE_STAT[stat]] as number;
      const n = Math.trunc(((2 * base + mon.ivs[stat] + Math.trunc(mon.evs[stat] / 4)) * level) / 100) + 5;
      mon.stats[stat] = this.modifyStatByNature(nature, n, s);
    }
    mon.stats.hp = newMaxHP;

    if (mon.species === SPECIES_SHEDINJA) {
      if (currentHP !== 0 || oldMaxHP === 0) currentHP = 1;
      else return;
    } else if (currentHP === 0 && oldMaxHP === 0) {
      currentHP = newMaxHP;
    } else if (currentHP !== 0) {
      currentHP += newMaxHP - oldMaxHP; // can reach <= 0 on the GBA too (see the BUG note in the decomp)
    } else {
      return;
    }
    mon.hp = currentHP;
  }

  /** ModifyStatByNature: ±10%, computed in a u16 like the original. */
  private modifyStatByNature(nature: number, stat: number, statIndex: number): number {
    switch (this.tables.natureStats[nature][statIndex - 1]) {
      case 1:
        return Math.trunc(((stat * 110) & 0xffff) / 100);
      case -1:
        return Math.trunc(((stat * 90) & 0xffff) / 100);
      default:
        return stat;
    }
  }

  /** GetNature */
  nature(mon: Pokemon): number {
    return (mon.personality >>> 0) % this.c.NUM_NATURES;
  }

  /** GetMonGender */
  gender(mon: Pokemon): number {
    return this.genderFromPersonality(mon.species, mon.personality);
  }

  /** GetGenderFromSpeciesAndPersonality */
  genderFromPersonality(species: number, personality: number): number {
    const { MON_MALE, MON_FEMALE, MON_GENDERLESS } = this.c;
    const ratio = this.species[species].genderRatio;
    if (ratio === MON_MALE || ratio === MON_FEMALE || ratio === MON_GENDERLESS) return ratio;
    return ratio > (personality & 0xff) ? MON_FEMALE : MON_MALE;
  }

  /** CreateMonWithNature: rerolls the personality until it has `nature` (OT_ID_PLAYER_ID: opts.otId is the player's). */
  createMonWithNature(speciesId: number, level: number, fixedIV: number, nature: number, opts: Omit<CreateMonOptions, 'personality' | 'fixedIV'>): Pokemon {
    let personality: number;
    do {
      personality = random32();
    } while (nature !== (personality >>> 0) % this.c.NUM_NATURES);
    return this.createMon(speciesId, level, { ...opts, fixedIV, personality });
  }

  /**
   * CreateMonWithGenderNatureLetter: rerolls the personality until it has `gender` and `nature`
   * (OT_ID_PLAYER_ID: opts.otId is the player's). Every caller passes unownLetter 0, so the Unown branch is left out.
   */
  createMonWithGenderNatureLetter(
    speciesId: number,
    level: number,
    fixedIV: number,
    gender: number,
    nature: number,
    opts: Omit<CreateMonOptions, 'personality' | 'fixedIV'>,
  ): Pokemon {
    let personality: number;
    do {
      personality = random32();
    } while (nature !== (personality >>> 0) % this.c.NUM_NATURES || gender !== this.genderFromPersonality(speciesId, personality));
    return this.createMon(speciesId, level, { ...opts, fixedIV, personality });
  }

  /** CreateMaleMon: rerolls personality and OT id together until the mon is male. */
  createMaleMon(speciesId: number, level: number, opts: Omit<CreateMonOptions, 'personality' | 'otId' | 'fixedIV'>): Pokemon {
    let otId: number;
    let personality: number;
    do {
      otId = random32();
      personality = random32();
    } while (this.genderFromPersonality(speciesId, personality) !== this.c.MON_MALE);
    return this.createMon(speciesId, level, { ...opts, personality, otId }); // USE_RANDOM_IVS, OT_ID_PRESET
  }

  /** CalculatePPWithBonus */
  ppWithBonus(move: number, ppBonuses: number, slot: number): number {
    const basePP = this.moves[move]?.pp ?? 0;
    const ups = (ppBonuses >> (2 * slot)) & 3;
    return basePP + Math.trunc((basePP * 20 * ups) / 100);
  }

  /** SpeciesToNationalPokedexNum */
  nationalDex(species: number): number {
    return this.species[species]?.nationalDex ?? 0;
  }
}
