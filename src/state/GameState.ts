import type { Pokemon, PokemonData, StatBlock } from '../pokemon/Pokemon';
import { TEMP_VARS_END, TEMP_VARS_START, type Defines } from '../script/Defines';
import type { TextSpeed } from '../text/TextPrinter';
import { random32 } from '../util/random';
import { Bag } from './Bag';

/**
 * Save-block style game state: event flags, vars, names, options, party, bag, Pokédex.
 * Flags and vars are keyed by their numeric ids (as on the GBA), resolved from decomp constant
 * names through Defines, so aliases like `.equ SIGN_LADY_READY, VAR_TEMP_2` just work.
 */
export class GameState {
  playerName = 'PLAYER'; // until the naming screen exists
  rivalName = 'RIVAL';
  playerGender: 'male' | 'female' = 'male';
  textSpeed: TextSpeed = 'mid';
  /** gSaveBlock2Ptr->optionsBattleSceneOff / optionsBattleStyle (OPTIONS_BATTLE_STYLE_SET) */
  battleSceneOff = false;
  battleStyleSet = false;
  /** gSaveBlock2Ptr->optionsButtonMode (OPTIONS_BUTTON_MODE_HELP = 0, the new-game default) */
  optionsButtonMode = 0;
  /** gSaveBlock2Ptr->optionsWindowFrameType (frame 1 = 0) */
  optionsWindowFrameType = 0;
  /**
   * gSaveBlock1Ptr->dynamicWarp: where a MAP_DYNAMIC warp leads (an elevator's door back to the floor it
   * was entered from). Set on entering a map by a warp whose counterpart is dynamic, or by `setdynamicwarp`.
   */
  dynamicWarp?: { mapId: string; warpId: number; x: number; y: number };
  /** gSaveBlock1Ptr->lastHealLocation (set by `setrespawn`): where a white-out sends you. */
  lastHealLocation?: { map: string; x: number; y: number };
  /** gSaveBlock1Ptr->trainerRematches, by local id: set by the VS Seeker (not implemented yet). */
  trainerRematches: number[] = [];
  /** gSaveBlock1Ptr->trainerRematchStepCounter: low byte = steps with the VS Seeker in the bag, high byte = charging steps. */
  trainerRematchStepCounter = 0;
  /** gSaveBlock1Ptr->daycare.stepCounter (u8): party eggs lose an egg cycle each time it reaches 255. */
  daycareStepCounter = 0;
  /** gSaveBlock1Ptr->roamer (struct Roamer). The contest stats are left out: FRLG mons never have any. */
  roamer: RoamerSave = { ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 }, personality: 0, species: 0, hp: 0, level: 0, status: 0, active: false };
  /** gNumSafariBalls / gSafariZoneStepCounter (safari_zone.c, EWRAM): set by EnterSafariMode. */
  numSafariBalls = 0;
  safariZoneStepCounter = 0;
  /** gBattleOutcome as the last battle left it (GetBattleOutcome). */
  battleOutcome = 0;
  /**
   * gEnemyParty as `setwildbattle` (CreateScriptedWildMon) leaves it for the battle special that follows
   * (StartMarowakBattle). Other battles hand their enemy party to the battle directly.
   */
  enemyParty: Pokemon[] = [];
  /** gSaveBlock1Ptr->registeredItem (ITEM_NONE = 0) */
  registeredItem = 0;
  /** gSaveBlock1Ptr->flashLevel: 0 = lit, up to gMaxFlashLevel (world/flash.ts) in a dark cave. */
  flashLevel = 0;

  private flags = new Set<number>();
  private vars = new Map<number, number>();
  /** STR_VAR_1..3 contents as encoded bytes (filled by buffer* script commands). */
  stringVars: number[][] = [[], [], []];

  /** gSaveBlock2Ptr->playerTrainerId. The GBA rolls it in Oak's intro; until that exists, at state creation. */
  trainerId = random32();
  /** NewGameInitData: SetMoney(&gSaveBlock1Ptr->money, 3000) */
  money = 3000;
  /** AddMoney (money.c): capped at MAX_MONEY. */
  addMoney(amount: number): void {
    this.money = Math.min(this.money + amount, 999999);
  }
  /** RemoveMoney: floored at 0. */
  removeMoney(amount: number): void {
    this.money = Math.max(this.money - amount, 0);
  }
  /** gSaveBlock1Ptr->coins (coins.c), at most MAX_COINS. */
  coins = 0;
  /** AddCoins: false if already at MAX_COINS; otherwise adds, capped. */
  addCoins(amount: number): boolean {
    const max = this.defines.require('MAX_COINS');
    if (this.coins >= max) return false;
    this.coins = Math.min(this.coins + amount, max);
    return true;
  }
  /** RemoveCoins: false if there aren't enough. */
  removeCoins(amount: number): boolean {
    if (this.coins < amount) return false;
    this.coins -= amount;
    return true;
  }
  /** gPlayerParty: up to PARTY_SIZE mons, no gaps. */
  party: Pokemon[] = [];
  readonly bag: Bag;
  /** Pokédex seen/caught flags by national dex number. */
  readonly dexSeen = new Set<number>();
  readonly dexCaught = new Set<number>();
  nationalDexEnabled = false;
  /** GetCurrentRegionMapSectionId(), kept current by the overworld. */
  currentMapSection = 'MAPSEC_NONE';
  /** The current map's folder name (e.g. "Route1"), kept current by the overworld. */
  currentMap = '';
  /** gSaveBlock1Ptr->location as its MAP_* id (e.g. "MAP_ROUTE1"), kept current by the overworld. */
  currentMapId = '';

  constructor(
    readonly defines: Defines,
    newGameFlags: string[],
    readonly pokemon: PokemonData,
  ) {
    for (const f of newGameFlags) this.setFlag(f);
    this.tempFlags = [defines.get('TEMP_FLAGS_START') ?? 0, defines.get('TEMP_FLAGS_END') ?? -1];
    this.bag = new Bag(
      {
        capacities: ['BAG_ITEMS_COUNT', 'BAG_KEYITEMS_COUNT', 'BAG_POKEBALLS_COUNT', 'BAG_TMHM_COUNT', 'BAG_BERRIES_COUNT'].map((c) =>
          defines.require(c),
        ),
        ITEM_NONE: defines.require('ITEM_NONE'),
        ITEM_TM_CASE: defines.require('ITEM_TM_CASE'),
        ITEM_BERRY_POUCH: defines.require('ITEM_BERRY_POUCH'),
        POCKET_KEY_ITEMS: defines.require('POCKET_KEY_ITEMS'),
        POCKET_TM_CASE: defines.require('POCKET_TM_CASE'),
        POCKET_BERRY_POUCH: defines.require('POCKET_BERRY_POUCH'),
      },
      (item) => pokemon.itemPocket(item),
      () => this.setFlag('FLAG_SYS_GOT_BERRY_POUCH'),
    );
  }

  /**
   * GiveMonToPlayer: OT is the player; first free party slot. When the party is full the GBA calls
   * SendMonToPC; PC storage doesn't exist yet, so that case returns MON_CANT_GIVE.
   */
  giveMon(mon: Pokemon): number {
    const c = this.pokemon.c;
    mon.otName = this.playerName;
    mon.otGender = this.playerGender;
    mon.otId = this.trainerId;
    if (this.party.length >= c.PARTY_SIZE) {
      console.warn('[state] party full; SendMonToPC not implemented');
      return c.MON_CANT_GIVE;
    }
    this.party.push(mon);
    return c.MON_GIVEN_TO_PARTY;
  }

  /** GetSetPokedexFlag(FLAG_SET_SEEN / FLAG_SET_CAUGHT) */
  setDexFlags(nationalDex: number, seen: boolean, caught: boolean): void {
    if (nationalDex <= 0) return;
    if (seen) this.dexSeen.add(nationalDex);
    if (caught) this.dexCaught.add(nationalDex);
  }

  private tempFlags: [number, number];

  private id(token: string | number): number | undefined {
    const n = this.defines.get(token);
    if (n === undefined) console.warn(`[state] unknown flag/var ${token}`);
    return n;
  }

  getFlag(flag: string | number): boolean {
    const n = this.id(flag);
    return n !== undefined && n !== 0 && this.flags.has(n);
  }

  setFlag(flag: string | number, value = true): void {
    const n = this.id(flag);
    if (n === undefined || n === 0) return;
    if (value) this.flags.add(n);
    else this.flags.delete(n);
  }

  getVar(v: string | number): number {
    const n = this.id(v);
    return n === undefined ? 0 : (this.vars.get(n) ?? 0);
  }

  setVar(v: string | number, value: number): void {
    const n = this.id(v);
    if (n !== undefined) this.vars.set(n, value & 0xffff);
  }

  /** VarGet semantics: ids below VARS_START are literal values, not variables. */
  value(token: string | number): number {
    const n = this.defines.get(token) ?? 0;
    return n >= TEMP_VARS_START ? this.getVar(n) : n;
  }

  /** ClearTempFieldEventData: on every map load. */
  clearTemps(): void {
    const [fs, fe] = this.tempFlags;
    for (const f of [...this.flags]) if (f >= fs && f <= fe) this.flags.delete(f);
    for (let v = TEMP_VARS_START; v <= TEMP_VARS_END; v++) this.vars.delete(v);
  }
}

/** struct Roamer */
export interface RoamerSave {
  ivs: StatBlock;
  personality: number;
  species: number;
  hp: number;
  level: number;
  /** u8: only the non-volatile status's low byte survives */
  status: number;
  active: boolean;
}
