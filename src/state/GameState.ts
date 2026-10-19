import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import type { Pokemon, PokemonData, StatBlock } from '../pokemon/Pokemon';
import { TEMP_VARS_END, TEMP_VARS_START, type Defines } from '../script/Defines';
import type { TextSpeed } from '../text/TextPrinter';
import { random32 } from '../util/random';
import type { Direction } from '../world/direction';
import type { DayCare, DaycareMon } from '../world/daycare';
import { Bag, type ItemSlot } from './Bag';
import type { PlayTime } from './playTime';
import { NewGameInitPCItems } from './pcItems';
import { InitEasyChatPhrases, InitQuestionnaireWords } from '../menus/easyChatData';
import { boxMonFromMon, boxMonRestorePP, PokemonStorage } from './PokemonStorage';
import { newTrainerTowerRecord, ResetTrainerTowerResults, type TrainerTowerRecord } from './trainerTowerRecord';
import { emptyQuestLogScenes, type QuestLogScene } from '../world/questLog';

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
  /** gSaveBlock2Ptr->optionsSound (OPTIONS_SOUND_MONO = 0 / _STEREO): SetPokemonCryStereo's argument */
  optionsSound = 0;
  /**
   * gSaveBlock1Ptr->dynamicWarp: where a MAP_DYNAMIC warp leads (an elevator's door back to the floor it
   * was entered from). Set on entering a map by a warp whose counterpart is dynamic, or by `setdynamicwarp`.
   */
  dynamicWarp?: { mapId: string; warpId: number; x: number; y: number };
  /** gSaveBlock1Ptr->lastHealLocation (set by `setrespawn`): where a white-out sends you. */
  lastHealLocation?: { map: string; x: number; y: number };
  /**
   * gSaveBlock1Ptr->escapeWarp: where Dig and the Escape Rope lead. Set on warps from outdoors to indoors
   * (UpdateEscapeWarp in world/fieldMoves.ts) and by `setescapewarp`.
   */
  escapeWarp?: WarpData;
  /** gSaveBlock1Ptr->continueGameWarp: where CONTINUE starts instead of the saved position (SetContinueGameWarp*). */
  continueGameWarp?: WarpData;
  /** gSaveBlock2Ptr->specialSaveWarpFlags (CONTINUE_GAME_WARP, ...): NewGameInitData clears it. */
  specialSaveWarpFlags = 0;
  /** gSaveBlock2Ptr->gcnLinkFlags (SetUnlockedPokedexFlags, SetPostgameFlags: save_location.c): NewGameInitData clears it. */
  gcnLinkFlags = 0;
  /**
   * Where the player stood when the game was last saved: gSaveBlock1Ptr->location's map, gSaveBlock1Ptr->pos
   * (map-local) and the player object's facing and avatar flags (SaveObjectEvents). Unlike the GBA, which keeps
   * pos current on every step, the field writes this only when saving (`OverworldScene.storeLocationForSave`).
   */
  location?: PlayerLocation;
  /** gSaveBlock1Ptr->trainerRematches, by local id: set by the VS Seeker (not implemented yet). */
  trainerRematches: number[] = [];
  /** gSaveBlock1Ptr->trainerRematchStepCounter: low byte = steps with the VS Seeker in the bag, high byte = charging steps. */
  trainerRematchStepCounter = 0;
  /** gSaveBlock1Ptr->daycare (world/daycare.ts): the Four Island daycare's two mons, pending egg and egg-cycle step counter. */
  daycare: DayCare = { mons: [{ mon: null, steps: 0 }, { mon: null, steps: 0 }], offspringPersonality: 0, stepCounter: 0 }; // DAYCARE_MON_COUNT
  /** gSaveBlock1Ptr->route5DayCareMon: the Route 5 daycare man's one mon (world/daycare.ts). */
  route5DayCareMon: DaycareMon = { mon: null, steps: 0 };
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
  /** gSaveBlock1Ptr->weather: the saved weather (world/weather.ts), WEATHER_NONE = 0. */
  weather = 0;
  /**
   * gSaveBlock1Ptr->savedMusic: a song that overrides the map's music on map loads (gba/overworldMusic.ts:
   * MUS_CYCLING on the bike, `savebgm`'s songs); 0 = none. Cleared by every map load.
   */
  savedMusic = 0;
  /**
   * gSaveBlock1Ptr->gameStats (NUM_GAME_STATS words; the GBA XORs them with the encryption key, the port keeps
   * them plain). Read and written through GetGameStat / SetGameStat / IncrementGameStat.
   */
  gameStats: number[] = new Array<number>(64).fill(0);
  /**
   * Easy Chat (menus/easyChat.ts): gSaveBlock1Ptr->easyChatProfile / easyChatBattleStart / easyChatBattleWon /
   * easyChatBattleLost (EASY_CHAT_BATTLE_WORDS_COUNT words each), mysteryGift.questionnaireWords and
   * additionalPhrases (the unlocked trendy sayings, a bit each). Set by InitEasyChatPhrases / InitQuestionnaireWords
   * in the constructor (NewGameInitData).
   */
  easyChatProfile: number[] = [];
  easyChatBattleStart: number[] = [];
  easyChatBattleWon: number[] = [];
  easyChatBattleLost: number[] = [];
  questionnaireWords: number[] = [];
  additionalPhrases: number[] = [];

  /** GetGameStat (overworld.c): 0 for ids from NUM_USED_GAME_STATS on. */
  getGameStat(statId: number): number {
    if (statId >= this.defines.require('NUM_USED_GAME_STATS')) return 0;
    return this.gameStats[statId] >>> 0;
  }

  /** SetGameStat */
  setGameStat(statId: number, value: number): void {
    if (statId >= this.defines.require('NUM_USED_GAME_STATS')) return;
    this.gameStats[statId] = value >>> 0;
  }

  /** IncrementGameStat: capped at 0xFFFFFF. */
  incrementGameStat(statId: number): void {
    if (statId >= this.defines.require('NUM_USED_GAME_STATS')) return;
    this.setGameStat(statId, Math.min(this.getGameStat(statId) + 1, 0xffffff));
  }

  /**
   * gSaveBlock1Ptr->mapLayoutId: the current map's layout (LAYOUT_* value). LoadCurrentMapData sets it from the
   * header on every map load; `setmaplayoutindex` (SetCurrentMapLayout) changes it from ON_TRANSITION.
   */
  mapLayoutId = 0;
  /** gMapHeader.mapLayoutId: the current map header's own layout (LoadCurrentMapData); not saved. */
  mapHeaderLayoutId = 0;
  /** gSaveBlock1Ptr->towerChallengeId: the Trainer Tower challenge (CHALLENGE_TYPE_*) last started. */
  towerChallengeId = 0;
  /** gSaveBlock1Ptr->trainerTower[NUM_TOWER_CHALLENGE_TYPES] (world/trainerTower.ts); ResetTrainerTowerResults in the constructor. */
  trainerTower: TrainerTowerRecord[] = [];
  /** gSaveBlock1Ptr->questLog[QUEST_LOG_SCENE_COUNT] (world/questLog.ts); ResetQuestLog zeroes them on a new game. */
  questLog: QuestLogScene[] = emptyQuestLogScenes();

  private flags = new Set<number>();
  private vars = new Map<number, number>();
  /** STR_VAR_1..3 contents as encoded bytes (filled by buffer* script commands). */
  stringVars: number[][] = [[], [], []];

  /** gSaveBlock2Ptr->playTime* (play_time.c). */
  readonly playTime: PlayTime = { hours: 0, minutes: 0, seconds: 0, vblanks: 0 };

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
  /** gSaveBlock1Ptr->pcItems (PC_ITEMS_COUNT slots; state/pcItems.ts), with NewGameInitPCItems's Potion. */
  readonly pcItems: ItemSlot[];
  /** gPokemonStoragePtr: the PC boxes. */
  readonly storage: PokemonStorage;
  /** sPCBoxToSendMon (field_specials.c, EWRAM): the box SendMonToPC / IsDestinationBoxFull started from. */
  private pcBoxToSendMon = 0;
  /** Pokédex seen/caught flags by national dex number. */
  readonly dexSeen = new Set<number>();
  readonly dexCaught = new Set<number>();
  /** gSaveBlock2Ptr->pokedex.nationalMagic == 0xB9; IsNationalPokedexEnabled (state/nationalDex.ts) checks it too. */
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
    /** src/strings.c (text/strings.json), for gText_Box. */
    strings: Record<string, string>,
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
    this.pcItems = Array.from({ length: defines.require('PC_ITEMS_COUNT') }, () => ({ itemId: defines.require('ITEM_NONE'), quantity: 0 }));
    NewGameInitPCItems(this.pcItems, defines.require('ITEM_NONE'), defines.require('ITEM_POTION'));
    InitEasyChatPhrases(this); // NewGameInitData
    InitQuestionnaireWords(this); // ClearMysteryGift
    this.trainerTower = Array.from({ length: defines.require('NUM_TOWER_CHALLENGE_TYPES') }, newTrainerTowerRecord);
    ResetTrainerTowerResults(this); // NewGameInitData
    // ResetPokemonStorageSystem (NewGameInitData)
    this.storage = new PokemonStorage(
      {
        TOTAL_BOXES_COUNT: defines.require('TOTAL_BOXES_COUNT'),
        IN_BOX_COUNT: defines.require('IN_BOX_COUNT'),
        MAX_DEFAULT_WALLPAPER: defines.require('MAX_DEFAULT_WALLPAPER'),
        WALLPAPER_COUNT: defines.require('WALLPAPER_COUNT'),
      },
      pokemon.encodeName(strings.gText_Box ?? '$'),
      (n) => ConvertIntToDecimalStringN(n, STR_CONV_MODE_LEFT_ALIGN, 2),
    );
  }

  /**
   * GiveMonToPlayer: OT is the player; the first free party slot, or SendMonToPC when the party is full.
   * Returns MON_GIVEN_TO_PARTY, MON_GIVEN_TO_PC or MON_CANT_GIVE (every box full).
   */
  giveMon(mon: Pokemon): number {
    const c = this.pokemon.c;
    mon.otName = this.playerName;
    mon.otGender = this.playerGender;
    mon.otId = this.trainerId;
    if (this.party.length >= c.PARTY_SIZE) return this.sendMonToPC(mon);
    this.party.push(mon);
    return c.MON_GIVEN_TO_PARTY;
  }

  /**
   * SendMonToPC (pokemon.c): the first free slot, searching from the current box and wrapping around. The mon's PP
   * is restored (MonRestorePP) and its BoxPokemon part copied in; gSpecialVar_MonBoxId/Pos and
   * VAR_PC_BOX_TO_SEND_MON say where it went (FLAG_SHOWN_BOX_WAS_FULL_MESSAGE is cleared if that isn't the box
   * the last mon went to).
   */
  sendMonToPC(mon: Pokemon): number {
    const c = this.pokemon.c;
    this.setPCBoxToSendMon(this.getVar('VAR_PC_BOX_TO_SEND_MON'));
    const st = this.storage;
    let boxNo = st.getCurrentBox();
    do {
      for (let boxPos = 0; boxPos < st.c.IN_BOX_COUNT; boxPos++) {
        if (!st.getBoxMonDataAt(boxNo, boxPos, 'species')) {
          boxMonRestorePP(this.pokemon, mon);
          st.boxes[boxNo][boxPos] = boxMonFromMon(mon);
          this.setVar('VAR_MON_BOX_ID', boxNo);
          this.setVar('VAR_MON_BOX_POS', boxPos);
          if (this.getPCBoxToSendMon() !== boxNo) this.setFlag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE', false);
          this.setVar('VAR_PC_BOX_TO_SEND_MON', boxNo);
          return c.MON_GIVEN_TO_PC;
        }
      }
      boxNo++;
      if (boxNo === st.c.TOTAL_BOXES_COUNT) boxNo = 0;
    } while (boxNo !== st.getCurrentBox());
    return c.MON_CANT_GIVE;
  }

  /** SetPCBoxToSendMon (field_specials.c) */
  setPCBoxToSendMon(boxId: number): void {
    this.pcBoxToSendMon = boxId & 0xff;
  }

  /** GetPCBoxToSendMon (field_specials.c) */
  getPCBoxToSendMon(): number {
    return this.pcBoxToSendMon;
  }

  /**
   * ShouldShowBoxWasFullMessage (field_specials.c): TRUE once per change of destination box, when the mon didn't
   * go to the current box.
   */
  shouldShowBoxWasFullMessage(): boolean {
    if (this.getFlag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE')) return false;
    if (this.storage.getCurrentBox() === this.getVar('VAR_PC_BOX_TO_SEND_MON')) return false;
    this.setFlag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE');
    return true;
  }

  /**
   * IsDestinationBoxFull (field_specials.c): SendMonToPC's search without storing anything: points
   * VAR_PC_BOX_TO_SEND_MON at the first box with room, then ShouldShowBoxWasFullMessage. FALSE (and nothing
   * changed) if every box is full.
   */
  isDestinationBoxFull(): boolean {
    this.setPCBoxToSendMon(this.getVar('VAR_PC_BOX_TO_SEND_MON'));
    const st = this.storage;
    let i = st.getCurrentBox();
    do {
      for (let j = 0; j < st.c.IN_BOX_COUNT; j++) {
        if (!st.getBoxMonDataAt(i, j, 'species')) {
          if (this.getPCBoxToSendMon() !== i) this.setFlag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE', false);
          this.setVar('VAR_PC_BOX_TO_SEND_MON', i);
          return this.shouldShowBoxWasFullMessage();
        }
      }
      i++;
      if (i === st.c.TOTAL_BOXES_COUNT) i = 0;
    } while (i !== st.getCurrentBox());
    return false;
  }

  /** IsThereRoomInAnyBoxForMorePokemon (field_specials.c) */
  isThereRoomInAnyBoxForMorePokemon(): boolean {
    return !this.storage.isFull();
  }

  /** IsPlayerPartyAndPokemonStorageFull (pokemon.c) */
  isPlayerPartyAndPokemonStorageFull(): boolean {
    return this.party.length >= this.pokemon.c.PARTY_SIZE && this.storage.isFull();
  }

  /** CountPartyMons (pokemon_storage_system_menu.c); also CalculatePlayerPartyCount, as the party has no gaps. */
  countPartyMons(): number {
    return this.party.length;
  }

  /** CountPartyNonEggMons */
  countPartyNonEggMons(): number {
    return this.party.filter((m) => !m.isEgg).length;
  }

  /** CountPartyAliveNonEggMonsExcept: non-egg mons with HP left, not counting party slot `slotToIgnore`. */
  countPartyAliveNonEggMonsExcept(slotToIgnore: number): number {
    return this.party.filter((m, i) => i !== slotToIgnore && !m.isEgg && m.hp !== 0).length;
  }

  /** CountPartyAliveNonEggMons_IgnoreVar0x8004Slot */
  countPartyAliveNonEggMonsIgnoreVar0x8004Slot(): number {
    return this.countPartyAliveNonEggMonsExcept(this.getVar('VAR_0x8004'));
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

  /** Every set flag id, ascending (for the save: gSaveBlock1Ptr->flags). */
  flagIds(): number[] {
    return [...this.flags].sort((a, b) => a - b);
  }

  /** Replace every flag (loading a save). */
  setFlagIds(ids: number[]): void {
    this.flags = new Set(ids);
  }

  /** Every non-zero var as [id, value], by id (for the save: gSaveBlock1Ptr->vars). */
  varEntries(): [number, number][] {
    return [...this.vars].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  }

  /** Replace every var (loading a save). */
  setVarEntries(entries: [number, number][]): void {
    this.vars = new Map(entries.map(([id, v]) => [id, v & 0xffff]));
  }

  /** ClearTempFieldEventData: on every map load. */
  clearTemps(): void {
    const [fs, fe] = this.tempFlags;
    for (const f of [...this.flags]) if (f >= fs && f <= fe) this.flags.delete(f);
    for (let v = TEMP_VARS_START; v <= TEMP_VARS_END; v++) this.vars.delete(v);
    for (const f of ['FLAG_SYS_WHITE_FLUTE_ACTIVE', 'FLAG_SYS_BLACK_FLUTE_ACTIVE', 'FLAG_SYS_USE_STRENGTH', 'FLAG_SYS_SPECIAL_WILD_BATTLE', 'FLAG_SYS_INFORMED_OF_LOCAL_WIRELESS_PLAYER']) {
      this.setFlag(f, false);
    }
  }
}

/** struct WarpData: a MAP_* id, a warp id (-1: use x/y) and map-local x/y. */
export interface WarpData {
  mapId: string;
  warpId: number;
  x: number;
  y: number;
}

/** gSaveBlock1Ptr->location + pos, plus the player object's facing and PLAYER_AVATAR_FLAG_* (see GameState.location). */
export interface PlayerLocation {
  /** MAP_* id */
  mapId: string;
  /** Map-local tile */
  x: number;
  y: number;
  facing: Direction;
  /** PLAYER_AVATAR_FLAG_ON_FOOT / MACH_BIKE / ACRO_BIKE / SURFING (the state, not the transient flags). */
  avatarFlags: number;
  /** gSaveBlock1Ptr->mapLayoutId, stored with the location (absent: the header's layout). */
  mapLayoutId?: number;
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
