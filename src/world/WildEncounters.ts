import type { WildEncounterData, WildPokemonInfo } from '../data/types';
import type { Pokemon } from '../pokemon/Pokemon';
import type { Defines } from '../script/Defines';
import type { GameState } from '../state/GameState';
import { random } from '../util/random';
import { tryStartRoamerEncounter } from './roamer';
import { PLAYER_AVATAR_FLAG, TestPlayerAvatarFlags } from './playerAvatar';
import type { TileInfo } from './World';

// wild_encounter.c
const MAX_ENCOUNTER_RATE = 1600;
const HEADER_NONE = 0xffff;
const RAND_MULT = 1103515245;

const enum WildArea {
  LAND,
  WATER,
  ROCKS,
  FISHING,
}

const WILD_CHECK_REPEL = 0x1;

/** What StartWildBattle / StartRoamerBattle need from the field: it builds the battle start task with gEnemyParty[0]. */
export interface WildBattleHost {
  startWildBattle(enemy: Pokemon): void;
  startRoamerBattle(enemy: Pokemon): void;
}

/**
 * wild_encounter.c: the step encounter check (TryStandardWildEncounter), its cooldown and rate
 * modifiers, the repel counter, and wild mon generation. Fields are sWildEncounterData (EWRAM).
 * Not ported: the quest log/Union Room checks. Rock Smash, fishing and Sweet Scent encounters come with those field moves.
 */
export class WildEncounters {
  private rngState = 0;
  private prevMetatileBehavior = 0;
  private encounterRateBuff = 0;
  private stepsSinceLastEncounter = 0;
  private abilityEffect = 0;
  private leadMonHeldItem = 0;
  /** sWildEncountersDisabled (DisableWildEncounters) */
  disabled = false;
  /** gEnemyParty[0] as GenerateWildMon left it. */
  private enemy?: Pokemon;

  constructor(
    private data: WildEncounterData,
    private state: GameState,
    private defines: Defines,
    private host: WildBattleHost,
  ) {
    this.seed(random()); // NewGameInitData: SeedWildEncounterRng(Random())
  }

  /** SeedWildEncounterRng */
  seed(seed: number): void {
    this.rngState = seed >>> 0;
    this.resetEncounterRateModifiers();
  }

  /** ResetEncounterRateModifiers (RestartWildEncounterImmunitySteps) */
  resetEncounterRateModifiers(): void {
    this.encounterRateBuff = 0;
    this.stepsSinceLastEncounter = 0;
  }

  /** TryStandardWildEncounter: called with the attributes of the tile the player just stepped onto. */
  tryStandardWildEncounter(tile: TileInfo): boolean {
    if (!this.handleWildEncounterCooldown(tile)) {
      this.prevMetatileBehavior = tile.behavior;
      return false;
    }
    if (this.standardWildEncounter(tile, this.prevMetatileBehavior)) {
      this.encounterRateBuff = 0;
      this.stepsSinceLastEncounter = 0;
      this.prevMetatileBehavior = tile.behavior;
      return true;
    }
    this.prevMetatileBehavior = tile.behavior;
    return false;
  }

  /** UpdateRepelCounter: TRUE when the repel just wore off (the caller runs EventScript_RepelWoreOff). */
  updateRepelCounter(): boolean {
    let steps = this.state.getVar('VAR_REPEL_STEP_COUNT');
    if (steps !== 0) {
      steps--;
      this.state.setVar('VAR_REPEL_STEP_COUNT', steps);
      if (steps === 0) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ encounter check

  /** StandardWildEncounter */
  private standardWildEncounter(tile: TileInfo, previousMetatileBehavior: number): boolean {
    if (this.disabled) return false;
    const header = this.currentHeader();
    if (!header) return false;
    const { TILE_ENCOUNTER_LAND, TILE_ENCOUNTER_WATER } = this.data.tileEncounter;
    let info: WildPokemonInfo | undefined;
    let area: WildArea;
    if (tile.encounterType === TILE_ENCOUNTER_LAND) {
      info = header.land_mons;
      area = WildArea.LAND;
    } else if (tile.encounterType === TILE_ENCOUNTER_WATER) {
      // (or surfing over a bridge: MetatileBehavior_IsBridge is always FALSE in FRLG)
      info = header.water_mons;
      area = WildArea.WATER;
    } else {
      return false;
    }
    if (!info) return false;
    if (previousMetatileBehavior !== tile.behavior && !this.doGlobalWildEncounterDiceRoll()) return false;
    if (!this.doWildEncounterRateTest(info.encounterRate, false)) {
      this.addToWildEncounterRateBuff(info.encounterRate);
      return false;
    }
    const roamer = tryStartRoamerEncounter(this.state);
    if (roamer) {
      if (!this.isWildLevelAllowedByRepel(this.state.roamer.level)) return false;
      this.host.startRoamerBattle(roamer);
      return true;
    }
    if (this.tryGenerateWildMon(info, area, WILD_CHECK_REPEL)) {
      this.startWildBattle();
      return true;
    }
    this.addToWildEncounterRateBuff(info.encounterRate);
    return false;
  }

  /** HandleWildEncounterCooldown */
  private handleWildEncounterCooldown(tile: TileInfo): boolean {
    const encounterType = tile.encounterType;
    if (encounterType === this.data.tileEncounter.TILE_ENCOUNTER_NONE) return false;
    let minSteps = this.getMapBaseEncounterCooldown(encounterType);
    if (minSteps === 0xff) return false;
    minSteps *= 256;
    let encRate = 5 * 256;
    switch (this.getFluteEncounterRateModType()) {
      case 1:
        minSteps -= Math.trunc(minSteps / 2);
        encRate += Math.trunc(encRate / 2);
        break;
      case 2:
        minSteps *= 2;
        encRate = Math.trunc(encRate / 2);
        break;
    }
    this.leadMonHeldItem = this.state.party[0]?.heldItem ?? 0;
    if (this.isLeadMonHoldingCleanseTag()) {
      minSteps += Math.trunc(minSteps / 3);
      encRate -= Math.trunc(encRate / 3);
    }
    switch (this.getAbilityEncounterRateModType()) {
      case 1:
        minSteps *= 2;
        encRate = Math.trunc(encRate / 2);
        break;
      case 2:
        minSteps = Math.trunc(minSteps / 2);
        encRate *= 2;
        break;
    }
    minSteps = Math.trunc(minSteps / 256);
    encRate = Math.trunc(encRate / 256);
    if (this.stepsSinceLastEncounter >= minSteps) return true;
    this.stepsSinceLastEncounter = (this.stepsSinceLastEncounter + 1) & 0xff;
    return random() % 100 < encRate;
  }

  /** GetMapBaseEncounterCooldown */
  private getMapBaseEncounterCooldown(encounterType: number): number {
    const header = this.currentHeader();
    if (!header) return 0xff;
    const { TILE_ENCOUNTER_LAND, TILE_ENCOUNTER_WATER } = this.data.tileEncounter;
    let info: WildPokemonInfo | undefined;
    if (encounterType === TILE_ENCOUNTER_LAND) info = header.land_mons;
    else if (encounterType === TILE_ENCOUNTER_WATER) info = header.water_mons;
    else return 0xff;
    if (!info) return 0xff;
    if (info.encounterRate >= 80) return 0;
    if (info.encounterRate < 10) return 8;
    return 8 - Math.trunc(info.encounterRate / 10);
  }

  /** DoGlobalWildEncounterDiceRoll: 60% when stepping onto a different behavior. */
  private doGlobalWildEncounterDiceRoll(): boolean {
    return random() % 100 < 60;
  }

  /** DoWildEncounterRateTest */
  private doWildEncounterRateTest(rate: number, ignoreAbility: boolean): boolean {
    let encounterRate = rate * 16;
    if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE)) encounterRate = Math.trunc((encounterRate * 80) / 100);
    encounterRate += Math.trunc((this.encounterRateBuff * 16) / 200);
    // ApplyFluteEncounterRateMod
    switch (this.getFluteEncounterRateModType()) {
      case 1:
        encounterRate += Math.trunc(encounterRate / 2);
        break;
      case 2:
        encounterRate = Math.trunc(encounterRate / 2);
        break;
    }
    // ApplyCleanseTagEncounterRateMod
    if (this.isLeadMonHoldingCleanseTag()) encounterRate = Math.trunc((encounterRate * 2) / 3);
    if (!ignoreAbility) {
      switch (this.abilityEffect) {
        case 1:
          encounterRate = Math.trunc(encounterRate / 2);
          break;
        case 2:
          encounterRate *= 2;
          break;
      }
    }
    if (encounterRate > MAX_ENCOUNTER_RATE) encounterRate = MAX_ENCOUNTER_RATE;
    return this.wildEncounterRandom() % MAX_ENCOUNTER_RATE < encounterRate; // DoWildEncounterRateDiceRoll
  }

  /** GetAbilityEncounterRateModType: Stench halves, Illuminate doubles (lead mon, unless an egg). */
  private getAbilityEncounterRateModType(): number {
    this.abilityEffect = 0;
    const lead = this.state.party[0];
    if (lead && !lead.isEgg) {
      const abilities = this.state.pokemon.species[lead.species]?.abilities ?? [];
      const ability = lead.abilityNum ? abilities[1] : abilities[0]; // GetMonAbility
      if (ability === this.defines.require('ABILITY_STENCH')) this.abilityEffect = 1;
      else if (ability === this.defines.require('ABILITY_ILLUMINATE')) this.abilityEffect = 2;
    }
    return this.abilityEffect;
  }

  /** GetFluteEncounterRateModType */
  private getFluteEncounterRateModType(): number {
    if (this.state.getFlag('FLAG_SYS_WHITE_FLUTE_ACTIVE')) return 1;
    if (this.state.getFlag('FLAG_SYS_BLACK_FLUTE_ACTIVE')) return 2;
    return 0;
  }

  /** IsLeadMonHoldingCleanseTag */
  private isLeadMonHoldingCleanseTag(): boolean {
    return this.leadMonHeldItem === this.defines.require('ITEM_CLEANSE_TAG');
  }

  /** AddToWildEncounterRateBuff */
  private addToWildEncounterRateBuff(encounterRate: number): void {
    if (this.state.getVar('VAR_REPEL_STEP_COUNT') === 0) this.encounterRateBuff = (this.encounterRateBuff + encounterRate) & 0xffff;
    else this.encounterRateBuff = 0;
  }

  /** WildEncounterRandom: its own LCG (ISO_RANDOMIZE2), upper 16 bits. */
  private wildEncounterRandom(): number {
    this.rngState = (Math.imul(RAND_MULT, this.rngState) + 12345) >>> 0;
    return this.rngState >>> 16;
  }

  // ------------------------------------------------------------------ headers and mon generation

  /** GetCurrentMapWildMonHeaderId, as the header itself. */
  private currentHeader() {
    const id = this.currentMapWildMonHeaderId();
    return id === HEADER_NONE ? undefined : this.data.headers[id];
  }

  /** GetCurrentMapWildMonHeaderId */
  private currentMapWildMonHeaderId(): number {
    const map = this.state.currentMapId;
    const headers = this.data.headers;
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].map !== map) continue;
      if (map === 'MAP_SIX_ISLAND_ALTERING_CAVE') {
        let alteringCaveId = this.state.getVar('VAR_ALTERING_CAVE_WILD_SET');
        if (alteringCaveId >= this.data.numAlteringCaveTables) alteringCaveId = 0;
        i += alteringCaveId;
      }
      if (!this.unlockedTanobyOrAreNotInTanoby()) break;
      return i;
    }
    return HEADER_NONE;
  }

  /** UnlockedTanobyOrAreNotInTanoby */
  private unlockedTanobyOrAreNotInTanoby(): boolean {
    if (this.state.getFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS')) return true;
    return !this.data.tanobyChambers.includes(this.state.currentMapId);
  }

  /** ChooseWildMonIndex_Land / ChooseWildMonIndex_WaterRock: the first slot whose running total exceeds the roll. */
  private chooseWildMonIndex(chances: number[]): number {
    const rand = random() % chances[chances.length - 1];
    const i = chances.findIndex((total) => rand < total);
    return i < 0 ? chances.length - 1 : i;
  }

  /** ChooseWildMonLevel */
  private chooseWildMonLevel(info: WildPokemonInfo, slot: number): number {
    const [min, max] = info.mons[slot];
    const lo = max >= min ? min : max;
    const hi = max >= min ? max : min;
    const mod = (hi - lo + 1) & 0xff;
    return lo + (random() % mod);
  }

  private species(info: WildPokemonInfo, slot: number): number {
    return this.defines.require(info.mons[slot][2]);
  }

  /** TryGenerateWildMon */
  private tryGenerateWildMon(info: WildPokemonInfo, area: WildArea, flags: number): boolean {
    let slot = 0;
    switch (area) {
      case WildArea.LAND:
        slot = this.chooseWildMonIndex(this.data.chances.land_mons);
        break;
      case WildArea.WATER:
        slot = this.chooseWildMonIndex(this.data.chances.water_mons);
        break;
      case WildArea.ROCKS:
        slot = this.chooseWildMonIndex(this.data.chances.rock_smash_mons);
        break;
    }
    const level = this.chooseWildMonLevel(info, slot);
    if (flags === WILD_CHECK_REPEL && !this.isWildLevelAllowedByRepel(level)) return false;
    this.generateWildMon(this.species(info, slot), level, slot);
    return true;
  }

  /** GenerateWildMon: gEnemyParty[0]; Unown get the chamber's letter for the slot. */
  private generateWildMon(species: number, level: number, slot: number): void {
    const s = this.state;
    const opts = { otId: s.trainerId, otName: s.playerName, otGender: s.playerGender, metLocation: s.currentMapSection };
    const USE_RANDOM_IVS = this.defines.require('USE_RANDOM_IVS');
    if (species !== this.defines.require('SPECIES_UNOWN')) {
      const nature = random() % this.defines.require('NUM_NATURES');
      this.enemy = s.pokemon.createMonWithNature(species, level, USE_RANDOM_IVS, nature, opts);
    } else {
      const chamber = this.data.tanobyChambers.indexOf(s.currentMapId);
      const personality = this.generateUnownPersonalityByLetter(this.data.unownLetterSlots[chamber][slot]);
      this.enemy = s.pokemon.createMon(species, level, { ...opts, fixedIV: USE_RANDOM_IVS, personality });
    }
  }

  /** GenerateUnownPersonalityByLetter */
  private generateUnownPersonalityByLetter(letter: number): number {
    let personality: number;
    do {
      personality = ((random() << 16) | random()) >>> 0;
    } while (getUnownLetterByPersonality(personality, this.defines.require('NUM_UNOWN_FORMS')) !== letter);
    return personality;
  }

  /** IsWildLevelAllowedByRepel: the first healthy non-egg party mon's level must not exceed the wild one's. */
  private isWildLevelAllowedByRepel(wildLevel: number): boolean {
    if (!this.state.getVar('VAR_REPEL_STEP_COUNT')) return true;
    for (const mon of this.state.party) {
      if (mon.hp && !mon.isEgg) return !(wildLevel < mon.level);
    }
    return false;
  }

  /** StartWildBattle (battle_setup.c): the field side picks safari/ghost/standard. */
  private startWildBattle(): void {
    this.host.startWildBattle(this.enemy!);
  }
}

/** GET_UNOWN_LETTER */
function getUnownLetterByPersonality(personality: number, numUnownForms: number): number {
  return (((personality & 0x03000000) >>> 18) | ((personality & 0x00030000) >>> 12) | ((personality & 0x00000300) >>> 6) | (personality & 0x00000003)) % numUnownForms;
}
