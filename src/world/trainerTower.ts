// trainer_tower.c: the Trainer Tower (Seven Island). Every `ttower_*` macro (asm/macros/trainer_tower.inc, expanded
// by the script extractor) is `setvar VAR_0x8004, TRAINER_TOWER_FUNC_*` + `special CallTrainerTowerFunc`, which runs
// one of sTrainerTowerFunctions on the current challenge's floors. The data is trainer_tower_sets.c and the tables of
// trainer_tower.c through tools/extract_trainer_tower.py (public/gen/trainerTower.json, set by Assets.init).
// The challenge's record is gSaveBlock1Ptr->trainerTower[towerChallengeId] (GameState.trainerTower, saved); its timer
// counts VBlanks through gMain.vblankCounter1 (SetVBlankCounter1Ptr, gba/main.ts). No Phaser here.
//
// The e-Reader sets (ReadTrainerTowerAndValidate, CEReaderTool_LoadTrainerTower) are link content: the port always
// takes the local sets, as the C does when ReadTrainerTowerAndValidate returns FALSE. The battle's side of the tower
// (InitTrainerTowerBattleStruct, GetTrainerTowerOpponent*) is read by src/battle/ for BATTLE_TYPE_TRAINER_TOWER.

import { DisableVBlankCounter1, SetVBlankCounter1Ptr } from '../gba/main';
import { PlayNewMapMusic } from '../gba/sound';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEADING_ZEROS, STR_CONV_MODE_LEFT_ALIGN, STR_CONV_MODE_RIGHT_ALIGN } from '../battle/stringUtil';
import { setStringVar4 } from '../menus/common';
import { ConvertEasyChatWordsToString } from '../menus/easyChat';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import {
  currentTrainerTowerRecord,
  GetTrainerTowerRecordTime,
  newTrainerTowerRecord,
  ResetTrainerTowerResults,
  SetTrainerTowerRecordTime,
  type TrainerTowerRecord,
} from '../state/trainerTowerRecord';

// ------------------------------------------------------------------ data (trainerTower.json)

/** struct BattleTowerPokemon (pokemon.h); nickname is a raw decomp string ending in `$`. */
export interface BattleTowerPokemon {
  species: number;
  heldItem: number;
  moves: number[];
  level: number;
  ppBonuses: number;
  hpEV: number;
  attackEV: number;
  defenseEV: number;
  speedEV: number;
  spAttackEV: number;
  spDefenseEV: number;
  otId: number;
  hpIV: number;
  attackIV: number;
  defenseIV: number;
  speedIV: number;
  spAttackIV: number;
  spDefenseIV: number;
  gap: number;
  abilityNum: number;
  personality: number;
  nickname: string;
  friendship: number;
}

/** struct TrainerTowerTrainer (cereader_tool.h); name is a raw decomp string ending in `$`, speeches Easy Chat words. */
export interface TrainerTowerTrainer {
  name: string;
  facilityClass: number;
  textColor: number;
  speechBefore: number[];
  speechWin: number[];
  speechLose: number[];
  speechAfter: number[];
  mons: BattleTowerPokemon[];
}

/** struct TrainerTowerFloor */
export interface TrainerTowerFloor {
  id: number;
  floorIdx: number;
  challengeType: number;
  /** TTPRIZE_*: an index into sPrizeList */
  prize: number;
  trainers: TrainerTowerTrainer[];
  checksum: number;
}

/** public/gen/trainerTower.json (tools/extract_trainer_tower.py) */
export interface TrainerTowerData {
  /** gTrainerTowerLocalHeader (struct EReaderTrainerTowerSetSubstruct) */
  localHeader: { numFloors: number; id: number };
  /** Every sTrainerTowerFloor_* by symbol */
  floors: Record<string, TrainerTowerFloor>;
  /** gTrainerTowerFloors[NUM_TOWER_CHALLENGE_TYPES][MAX_TRAINER_TOWER_FLOORS], as floor symbols */
  sets: string[][];
  /** sSingleBattleTrainerInfo */
  singleBattleTrainerInfo: { objGfx: number; facilityClass: number; gender: number }[];
  /** sDoubleBattleTrainerInfo */
  doubleBattleTrainerInfo: { objGfx1: number; objGfx2: number; facilityClass: number; gender1: number; gender2: number }[];
  /** sTrainerEncounterMusicLUT */
  trainerEncounterMusicLUT: { facilityClass: number; musicId: number }[];
  /** sFloorLayouts[MAX_TRAINER_TOWER_FLOORS][NUM_TOWER_CHALLENGE_TYPES - 1], LAYOUT_* names */
  floorLayouts: string[][];
  /** sPrizeList: ITEM_* by TTPRIZE_* */
  prizeList: number[];
  /** sTrainerTowerEncounterMusic: MUS_* by TRAINER_ENCOUNTER_MUSIC_* */
  encounterMusic: number[];
  /** sSingleBattleChallengeMonIdxs / sDoubleBattleChallengeMonIdxs / sKnockoutChallengeMonIdxs (BuildEnemyParty) */
  singleBattleChallengeMonIdxs: number[][];
  doubleBattleChallengeMonIdxs: number[][];
  knockoutChallengeMonIdxs: number[][];
  /** gFacilityClassToTrainerClass / gFacilityClassToPicIndex (trainer_class_lookups.h) */
  facilityClassToTrainerClass: number[];
  facilityClassToPicIndex: number[];
}

let sData: TrainerTowerData | undefined;

/** Assets.init (and the unit tests) hand over trainerTower.json. */
export function initTrainerTowerData(data: TrainerTowerData): void {
  sData = data;
}

export function trainerTowerData(): TrainerTowerData {
  if (!sData) throw new Error('[trainer tower] trainerTower.json not loaded');
  return sData;
}

// ------------------------------------------------------------------ the save record (state/trainerTowerRecord.ts)

export { currentTrainerTowerRecord, GetTrainerTowerRecordTime, newTrainerTowerRecord, ResetTrainerTowerResults, SetTrainerTowerRecordTime, type TrainerTowerRecord };

// ------------------------------------------------------------------ CallTrainerTowerFunc

/** What the functions need beyond the GameState (script/trainerTowerSpecials.ts fills it from the SpecialEnv). */
export interface TrainerTowerEnv {
  state: GameState;
  warnOnce(key: string, message: string): void;
  /**
   * DoTrainerTowerBattle's Task_DoTrainerTowerBattle and CB2_EndTrainerTowerBattle: the battle (gEnemyParty =
   * `enemyParty`, no gTrainers entry) after `transition`, then back to the field, which the script's `waitstate`
   * waits for (script/trainerTowerSpecials.ts: host.startScriptedBattle).
   */
  startTowerBattle(battleTypeFlags: number, enemyParty: Pokemon[], transition: number): void;
}

/** struct TrainerTowerState: sTrainerTowerState (allocated around each CallTrainerTowerFunc). */
interface TrainerTowerState {
  /** gMapHeader.mapLayoutId - LAYOUT_TRAINER_TOWER_1F, as a u8 (0xFF in the lobby) */
  floorIdx: number;
  /** struct EReaderTrainerTowerSet: the local header and the challenge's floors (shared, not copied: read only) */
  data: { numFloors: number; id: number; floors: TrainerTowerFloor[] };
}

let sTrainerTowerState: TrainerTowerState | null = null;

/** gSpecialVar_* accessors */
const varGet = (state: GameState, name: string) => state.getVar(name);
const setResult = (state: GameState, v: number) => state.setVar('VAR_RESULT', v);

function tt(): TrainerTowerState {
  if (!sTrainerTowerState) throw new Error('[trainer tower] no sTrainerTowerState');
  return sTrainerTowerState;
}

/** CURR_FLOOR: sTrainerTowerState->data.floors[sTrainerTowerState->floorIdx] (undefined off the floors, e.g. the lobby). */
function currFloor(): TrainerTowerFloor {
  const s = tt();
  const floor = s.data.floors[s.floorIdx];
  if (!floor) throw new Error(`[trainer tower] no floor ${s.floorIdx}`);
  return floor;
}

/**
 * SetUpTrainerTowerDataStruct: the floor from the map header's layout, then (ReadTrainerTowerAndValidate being
 * FALSE: no e-Reader set) the local header and gTrainerTowerFloors[towerChallengeId]; the record is validated
 * against the set's id. The C also sums the floors into data.checksum, which only the e-Reader path checks.
 */
function SetUpTrainerTowerDataStruct(state: GameState): void {
  const d = trainerTowerData();
  const challengeType = state.towerChallengeId;
  sTrainerTowerState = {
    floorIdx: (state.mapHeaderLayoutId - state.defines.require('LAYOUT_TRAINER_TOWER_1F')) & 0xff,
    data: {
      numFloors: d.localHeader.numFloors,
      id: d.localHeader.id,
      floors: d.sets[challengeType].map((sym) => d.floors[sym]),
    },
  };
  ValidateOrResetCurTrainerTowerRecord(state);
}

/** FreeTrainerTowerDataStruct */
function FreeTrainerTowerDataStruct(): void {
  sTrainerTowerState = null;
}

/** ValidateOrResetCurTrainerTowerRecord: a record from another set starts over (record time, prize). */
function ValidateOrResetCurTrainerTowerRecord(state: GameState): void {
  const rec = currentTrainerTowerRecord(state);
  if (rec.unk9 !== tt().data.id) {
    rec.unk9 = tt().data.id;
    SetTrainerTowerRecordTime(rec, state.defines.require('TRAINER_TOWER_MAX_TIME'));
    rec.receivedPrize = false;
  }
}

/** CallTrainerTowerFunc: sTrainerTowerFunctions[gSpecialVar_0x8004]. */
export function CallTrainerTowerFunc(env: TrainerTowerEnv): void {
  const { state } = env;
  SetUpTrainerTowerDataStruct(state);
  try {
    const d = state.defines;
    const funcs: Record<string, () => void> = {
      TRAINER_TOWER_FUNC_INIT_FLOOR: () => InitTrainerTowerFloor(state),
      TRAINER_TOWER_FUNC_GET_SPEECH: () => BufferTowerOpponentSpeech(state),
      TRAINER_TOWER_FUNC_DO_BATTLE: () => DoTrainerTowerBattle(env),
      TRAINER_TOWER_FUNC_GET_CHALLENGE_TYPE: () => TrainerTowerGetChallengeType(state),
      TRAINER_TOWER_FUNC_CLEARED_FLOOR: () => TrainerTowerAddFloorCleared(state),
      TRAINER_TOWER_FUNC_GET_FLOOR_CLEARED: () => GetFloorAlreadyCleared(state),
      TRAINER_TOWER_FUNC_START_CHALLENGE: () => StartTrainerTowerChallenge(state),
      TRAINER_TOWER_FUNC_GET_OWNER_STATE: () => GetOwnerState(state),
      TRAINER_TOWER_FUNC_GIVE_PRIZE: () => GiveChallengePrize(state),
      TRAINER_TOWER_FUNC_CHECK_FINAL_TIME: () => CheckFinalTime(state),
      TRAINER_TOWER_FUNC_RESUME_TIMER: () => TrainerTowerResumeTimer(state),
      TRAINER_TOWER_FUNC_SET_LOST: () => TrainerTowerSetPlayerLost(state),
      TRAINER_TOWER_FUNC_GET_CHALLENGE_STATUS: () => GetTrainerTowerChallengeStatus(state),
      TRAINER_TOWER_FUNC_GET_TIME: () => GetCurrentTime(state),
      TRAINER_TOWER_FUNC_SHOW_RESULTS: () => ShowResultsBoard(env),
      TRAINER_TOWER_FUNC_CLOSE_RESULTS: () => CloseResultsBoard(env),
      TRAINER_TOWER_FUNC_CHECK_DOUBLES: () => TrainerTowerGetDoublesEligiblity(state),
      TRAINER_TOWER_FUNC_GET_NUM_FLOORS: () => TrainerTowerGetNumFloors(state),
      TRAINER_TOWER_FUNC_SHOULD_WARP_TO_COUNTER: () => ShouldWarpToCounter(state),
      TRAINER_TOWER_FUNC_ENCOUNTER_MUSIC: () => PlayTrainerTowerEncounterMusic(state),
      TRAINER_TOWER_FUNC_GET_BEAT_CHALLENGE: () => HasSpokenToOwner(state),
    };
    const func = varGet(state, 'VAR_0x8004');
    const name = Object.keys(funcs).find((k) => d.require(k) === func);
    if (!name) throw new Error(`[trainer tower] no function ${func}`);
    funcs[name]();
  } finally {
    FreeTrainerTowerDataStruct();
  }
}

/**
 * InitTrainerTowerFloor (ON_TRANSITION): past the set's last floor the roof's layout (VAR_RESULT 3, past the usable
 * challenge types); otherwise VAR_RESULT = the floor's challenge type, its layout (SetCurrentMapLayout before the
 * map is built) and the trainers' graphics.
 */
function InitTrainerTowerFloor(state: GameState): void {
  const d = state.defines;
  if (state.mapHeaderLayoutId - d.require('LAYOUT_TRAINER_TOWER_LOBBY') > tt().data.numFloors) {
    setResult(state, 3);
    state.mapLayoutId = d.require('LAYOUT_TRAINER_TOWER_ROOF'); // SetCurrentMapLayout
  } else {
    const type = currFloor().challengeType;
    setResult(state, type);
    state.mapLayoutId = d.require(trainerTowerData().floorLayouts[tt().floorIdx][type]); // SetCurrentMapLayout
    SetTrainerTowerNPCGraphics(state);
  }
}

/** sSingleBattleTrainerInfo's entry for a facility class (NELEMS when none). */
function singleInfo(facilityClass: number) {
  return trainerTowerData().singleBattleTrainerInfo.find((e) => e.facilityClass === facilityClass);
}

function doubleInfo(facilityClass: number) {
  return trainerTowerData().doubleBattleTrainerInfo.find((e) => e.facilityClass === facilityClass);
}

/**
 * SetTrainerTowerNPCGraphics: VAR_OBJ_GFX_ID_* for the floor's trainer objects (OBJ_EVENT_GFX_VAR_0..3): singles
 * VAR_1, doubles VAR_0 and VAR_3, knockout VAR_2 / VAR_0 / VAR_1 for trainers 0 / 1 / 2. A facility class the tables
 * don't have shows a Youngster.
 */
function SetTrainerTowerNPCGraphics(state: GameState): void {
  const d = state.defines;
  const floor = currFloor();
  const youngster = d.require('OBJ_EVENT_GFX_YOUNGSTER');
  switch (floor.challengeType) {
    case d.require('CHALLENGE_TYPE_SINGLE'):
      state.setVar('VAR_OBJ_GFX_ID_1', singleInfo(floor.trainers[0].facilityClass)?.objGfx ?? youngster);
      break;
    case d.require('CHALLENGE_TYPE_DOUBLE'): {
      const info = doubleInfo(floor.trainers[0].facilityClass);
      state.setVar('VAR_OBJ_GFX_ID_0', info?.objGfx1 ?? youngster);
      state.setVar('VAR_OBJ_GFX_ID_3', info?.objGfx2 ?? youngster);
      break;
    }
    case d.require('CHALLENGE_TYPE_KNOCKOUT'): {
      const vars = ['VAR_OBJ_GFX_ID_2', 'VAR_OBJ_GFX_ID_0', 'VAR_OBJ_GFX_ID_1'];
      for (let j = 0; j < d.require('MAX_TRAINERS_PER_FLOOR'); j++) {
        state.setVar(vars[j], singleInfo(floor.trainers[j].facilityClass)?.objGfx ?? youngster);
      }
      break;
    }
  }
}

const CHAR_PROMPT_SCROLL = 0xfa;
const CHAR_NEWLINE = 0xfe;

/** GetStringWidth(FONT_NORMAL, str, -1): the field's font metrics, set by OverworldScene. */
let sStringWidth: ((str: number[]) => number) | undefined;
export function setTrainerTowerStringWidth(fn: (str: number[]) => number): void {
  sStringWidth = fn;
}

/**
 * TT_ConvertEasyChatMessageToString: 3 words a row in 2 rows, or, when that is wider than 196 px, 2 words a row in
 * 3 rows with the second row's newline made a scroll prompt (\l), so the message box shows two rows at a time.
 */
export function TT_ConvertEasyChatMessageToString(state: GameState, ecWords: readonly number[]): number[] {
  let dest = ConvertEasyChatWordsToString(state, ecWords, 3, 2);
  if (!sStringWidth) throw new Error('[trainer tower] no string width (setTrainerTowerStringWidth)');
  if (sStringWidth(dest) >>> 0 > 196) {
    dest = ConvertEasyChatWordsToString(state, ecWords, 2, 3);
    let i = 0;
    while (dest[i++] !== CHAR_NEWLINE); // skip line 1
    while (dest[i] !== CHAR_NEWLINE) i++; // skip line 2
    dest[i] = CHAR_PROMPT_SCROLL;
  }
  return dest;
}

/**
 * BufferTowerOpponentSpeech: VAR_0x8006's trainer's speech VAR_0x8005 (TRAINER_TOWER_TEXT_*) into gStringVar4; all
 * but the after-battle one set the text colour by the trainer's gender (a doubles pair goes by trainer 0's class).
 */
function BufferTowerOpponentSpeech(state: GameState): void {
  const d = state.defines;
  const trainerId = varGet(state, 'VAR_0x8006');
  const floor = currFloor();
  const challengeType = floor.challengeType;
  const trainer = floor.trainers[trainerId];
  const facilityClass = challengeType !== d.require('CHALLENGE_TYPE_DOUBLE') ? trainer.facilityClass : floor.trainers[0].facilityClass;
  let words: number[] | undefined;
  switch (varGet(state, 'VAR_0x8005')) {
    case d.require('TRAINER_TOWER_TEXT_INTRO'):
      TrainerTowerGetOpponentTextColor(state, challengeType, facilityClass);
      words = trainer.speechBefore;
      break;
    case d.require('TRAINER_TOWER_TEXT_PLAYER_LOST'):
      TrainerTowerGetOpponentTextColor(state, challengeType, facilityClass);
      words = trainer.speechWin;
      break;
    case d.require('TRAINER_TOWER_TEXT_PLAYER_WON'):
      TrainerTowerGetOpponentTextColor(state, challengeType, facilityClass);
      words = trainer.speechLose;
      break;
    case d.require('TRAINER_TOWER_TEXT_AFTER'):
      words = trainer.speechAfter;
      break;
  }
  if (words) setStringVar4(TT_ConvertEasyChatMessageToString(state, words)); // gStringVar4, for `msgbox gStringVar4`
}

/**
 * TrainerTowerGetOpponentTextColor: gSpecialVar_TextColor = the trainer's gender (MALE / FEMALE, i.e.
 * NPC_TEXT_COLOR_MALE / _FEMALE), the old one kept in gSpecialVar_PrevTextColor. A doubles pair's VAR_TEMP_3 picks
 * the second trainer's gender.
 */
export function TrainerTowerGetOpponentTextColor(state: GameState, challengeType: number, facilityClass: number): void {
  const d = state.defines;
  let gender = d.require('MALE');
  switch (challengeType) {
    case d.require('CHALLENGE_TYPE_SINGLE'):
    case d.require('CHALLENGE_TYPE_KNOCKOUT'):
      gender = singleInfo(facilityClass)?.gender ?? gender;
      break;
    case d.require('CHALLENGE_TYPE_DOUBLE'): {
      const info = doubleInfo(facilityClass);
      if (info) gender = varGet(state, 'VAR_TEMP_3') ? info.gender2 : info.gender1;
      break;
    }
  }
  state.setVar('VAR_PREV_TEXT_COLOR', state.getVar('VAR_TEXT_COLOR'));
  state.setVar('VAR_TEXT_COLOR', gender);
}

/**
 * DoTrainerTowerBattle: gBattleTypeFlags TRAINER | TRAINER_TOWER (| DOUBLE on a doubles floor), no gTrainers entry
 * (gTrainerBattleOpponent_A 0), gEnemyParty from BuildEnemyParty, then Task_DoTrainerTowerBattle starts the battle
 * once BattleTransition_StartOnField(BattleSetup_GetBattleTowerBattleTransition()) is done; PlayMapChosenOrBattleBGM(0)
 * (the battle's default music: gTrainers[0]'s class gives MUS_VS_TRAINER). Its own task, not Task_BattleStart: no
 * wait for FldEffPoison, no ClearPoisonStepCounter. CB2_EndTrainerTowerBattle → CB2_ReturnToFieldContinueScriptPlayMapMusic
 * whatever the outcome (no white-out): the script's `waitstate` ends once the field has faded back in, and
 * `switch VAR_RESULT` reads gBattleOutcome (set by the battle's end).
 */
function DoTrainerTowerBattle(env: TrainerTowerEnv): void {
  const { state } = env;
  const d = state.defines;
  let battleTypeFlags = d.require('BATTLE_TYPE_TRAINER') | d.require('BATTLE_TYPE_TRAINER_TOWER');
  if (currFloor().challengeType === d.require('CHALLENGE_TYPE_DOUBLE')) battleTypeFlags |= d.require('BATTLE_TYPE_DOUBLE');
  // gTrainerBattleOpponent_A = 0: startTowerBattle starts the battle with no trainer
  BuildEnemyParty(state);
  env.startTowerBattle(battleTypeFlags, state.enemyParty, BattleSetup_GetBattleTowerBattleTransition(state));
}

/** BattleSetup_GetBattleTowerBattleTransition (battle_setup.c): gEnemyParty[0]'s level against the lead mon's. */
export function BattleSetup_GetBattleTowerBattleTransition(state: GameState): number {
  const d = state.defines;
  const enemyLevel = state.enemyParty[0]?.level ?? 0;
  const playerLevel = GetSumOfPlayerPartyLevel(state, 1);
  return d.require(enemyLevel < playerLevel ? 'B_TRANSITION_POKEBALLS_TRAIL' : 'B_TRANSITION_BIG_POKEBALL');
}

/** GetSumOfPlayerPartyLevel (battle_setup.c): the levels of the first `numMons` healthy, non-egg party mons (a u8). */
function GetSumOfPlayerPartyLevel(state: GameState, numMons: number): number {
  let sum = 0;
  for (const mon of state.party) {
    if (mon.isEgg || !mon.species || mon.hp === 0) continue;
    sum = (sum + mon.level) & 0xff;
    if (--numMons === 0) break;
  }
  return sum;
}

/**
 * BuildEnemyParty: the floor's mons at the party's highest level, picked by the number of floors cleared from
 * sSingleBattleChallengeMonIdxs (two of VAR_TEMP_1's trainer's), sDoubleBattleChallengeMonIdxs (one of each
 * trainer's) or sKnockoutChallengeMonIdxs (one of VAR_TEMP_1's). The C sets `level` in its copy of the floor; the
 * port's floors are the loaded data, so each mon is copied first.
 */
function BuildEnemyParty(state: GameState): void {
  const d = state.defines;
  const data = trainerTowerData();
  const trainerIdx = varGet(state, 'VAR_TEMP_1');
  const level = GetPartyMaxLevel(state);
  const floorIdx = currentTrainerTowerRecord(state).floorsCleared;
  const floor = currFloor();
  const mon = (trainer: number, monIdx: number) => CreateBattleTowerMon(state, { ...floor.trainers[trainer].mons[monIdx], level });
  state.enemyParty = []; // ZeroEnemyPartyMons
  switch (floor.challengeType) {
    case d.require('CHALLENGE_TYPE_SINGLE'):
    default:
      for (let i = 0; i < 2; i++) state.enemyParty[i] = mon(trainerIdx, data.singleBattleChallengeMonIdxs[floorIdx][i]);
      break;
    case d.require('CHALLENGE_TYPE_DOUBLE'):
      state.enemyParty[0] = mon(0, data.doubleBattleChallengeMonIdxs[floorIdx][0]);
      state.enemyParty[1] = mon(1, data.doubleBattleChallengeMonIdxs[floorIdx][1]);
      break;
    case d.require('CHALLENGE_TYPE_KNOCKOUT'):
      state.enemyParty[0] = mon(trainerIdx, data.knockoutChallengeMonIdxs[floorIdx][trainerIdx]);
      break;
  }
}

/** GetPartyMaxLevel: the highest level among the party's mons (eggs left out). */
export function GetPartyMaxLevel(state: GameState): number {
  let topLevel = 0;
  for (const mon of state.party) {
    if (mon.species !== 0 && !mon.isEgg && mon.level > topLevel) topLevel = mon.level;
  }
  return topLevel;
}

/**
 * CreateBattleTowerMon (pokemon.c): CreateMon with all IVs 0, the mon's personality and OT_ID_PRESET (no Random()
 * call), its moves (SetMonMoveSlot: base PP), PP bonuses, held item, nickname (the C never sets the language), friendship,
 * EVs, ability bit and IVs, then CalculateMonStats.
 */
export function CreateBattleTowerMon(state: GameState, src: BattleTowerPokemon): Pokemon {
  const p = state.pokemon;
  const mon = p.createMon(src.species, src.level, {
    fixedIV: 0,
    personality: src.personality >>> 0,
    otId: src.otId >>> 0,
    otName: state.playerName, // CreateBoxMon copies the player's name and gender
    otGender: state.playerGender,
    metLocation: state.currentMapSection,
  });
  for (let i = 0; i < p.c.MAX_MON_MOVES; i++) {
    // SetMonMoveSlot
    mon.moves[i] = src.moves[i];
    mon.pp[i] = p.moves[src.moves[i]].pp;
  }
  mon.ppBonuses = src.ppBonuses;
  mon.heldItem = src.heldItem;
  mon.nickname = p.encodeName(src.nickname);
  mon.friendship = src.friendship;
  mon.evs = { hp: src.hpEV, attack: src.attackEV, defense: src.defenseEV, speed: src.speedEV, spAttack: src.spAttackEV, spDefense: src.spDefenseEV };
  mon.abilityNum = src.abilityNum & 1;
  mon.ivs = { hp: src.hpIV, attack: src.attackIV, defense: src.defenseIV, speed: src.speedIV, spAttack: src.spAttackIV, spDefense: src.spDefenseIV };
  p.calculateStats(mon);
  return mon;
}

// ------------------------------------------------------------------ the battle's opponent (battle_util2.c, battle_message.c, battle_controller_opponent.c)

/** struct OpponentTrainerTowerData (sTrainerTowerOpponent): the battle's trainer(s), set up by AllocateBattleResources. */
interface TrainerTowerOpponent {
  name: string;
  speechWin: number[];
  speechLose: number[];
  speechWin2: number[];
  speechLose2: number[];
  battleType: number;
  facilityClass: number;
  textColor: number;
}

let sTrainerTowerOpponent: TrainerTowerOpponent | null = null;

function opponent(): TrainerTowerOpponent {
  if (!sTrainerTowerOpponent) throw new Error('[trainer tower] no sTrainerTowerOpponent (InitTrainerTowerBattleStruct)');
  return sTrainerTowerOpponent;
}

/**
 * InitTrainerTowerBattleStruct (AllocateBattleResources, for a BATTLE_TYPE_TRAINER_TOWER battle): VAR_TEMP_1's
 * trainer's name, win / lose speeches (and the next trainer's on a doubles floor), class and text colour; the
 * timer counts again (SetVBlankCounter1Ptr).
 */
export function InitTrainerTowerBattleStruct(state: GameState): void {
  SetUpTrainerTowerDataStruct(state);
  try {
    const d = state.defines;
    const trainerId = varGet(state, 'VAR_TEMP_1');
    const floor = currFloor();
    const trainer = floor.trainers[trainerId];
    const double = floor.challengeType === d.require('CHALLENGE_TYPE_DOUBLE');
    sTrainerTowerOpponent = {
      name: trainer.name,
      speechWin: [...trainer.speechWin],
      speechLose: [...trainer.speechLose],
      // AllocZeroed: only a doubles floor fills the second trainer's speeches
      speechWin2: double ? [...floor.trainers[trainerId + 1].speechWin] : new Array(6).fill(0),
      speechLose2: double ? [...floor.trainers[trainerId + 1].speechLose] : new Array(6).fill(0),
      battleType: floor.challengeType,
      facilityClass: trainer.facilityClass,
      textColor: trainer.textColor,
    };
    SetVBlankCounter1Ptr(currentTrainerTowerRecord(state));
  } finally {
    FreeTrainerTowerDataStruct();
  }
}

/** FreeTrainerTowerBattleStruct (FreeBattleResources) */
export function FreeTrainerTowerBattleStruct(): void {
  sTrainerTowerOpponent = null;
}

/** GetTrainerTowerOpponentClass: gFacilityClassToTrainerClass[facilityClass] (TRAINER_CLASS_*). */
export function GetTrainerTowerOpponentClass(): number {
  return trainerTowerData().facilityClassToTrainerClass[opponent().facilityClass];
}

/** GetTrainerTowerOpponentName: the name, a raw decomp string ending in `$` (StringCopyN 11). */
export function GetTrainerTowerOpponentName(): string {
  return opponent().name;
}

/** GetTrainerTowerTrainerFrontSpriteId: gFacilityClassToPicIndex[facilityClass] (TRAINER_PIC_*). */
export function GetTrainerTowerTrainerFrontSpriteId(): number {
  return trainerTowerData().facilityClassToPicIndex[opponent().facilityClass];
}

/**
 * The front pic the battle will draw, before it starts (BattleScene loads its graphics before CB2_InitBattle, where
 * InitTrainerTowerBattleStruct runs): VAR_TEMP_1's trainer's class on the current floor.
 */
export function trainerTowerOpponentPicId(state: GameState): number {
  SetUpTrainerTowerDataStruct(state);
  try {
    return trainerTowerData().facilityClassToPicIndex[currFloor().trainers[varGet(state, 'VAR_TEMP_1')].facilityClass];
  } finally {
    FreeTrainerTowerDataStruct();
  }
}

/**
 * GetTrainerTowerOpponentWinText / GetTrainerTowerOpponentLoseText: trainer `opponentIdx`'s speech for the battle's
 * end into gStringVar4 (VAR_TEMP_3 = opponentIdx picks the doubles pair's text colour). Returned with EOS.
 */
export function GetTrainerTowerOpponentWinText(state: GameState, opponentIdx: number): number[] {
  return opponentText(state, opponentIdx, opponentIdx === 0 ? opponent().speechWin : opponent().speechWin2);
}

export function GetTrainerTowerOpponentLoseText(state: GameState, opponentIdx: number): number[] {
  return opponentText(state, opponentIdx, opponentIdx === 0 ? opponent().speechLose : opponent().speechLose2);
}

function opponentText(state: GameState, opponentIdx: number, words: number[]): number[] {
  state.setVar('VAR_TEMP_3', opponentIdx);
  TrainerTowerGetOpponentTextColor(state, opponent().battleType, opponent().facilityClass);
  const text = TT_ConvertEasyChatMessageToString(state, words);
  setStringVar4(text);
  return text;
}

/** TrainerTowerGetChallengeType: VAR_RESULT = the floor's challenge type, unless VAR_0x8005 is set. */
function TrainerTowerGetChallengeType(state: GameState): void {
  if (!varGet(state, 'VAR_0x8005')) setResult(state, currFloor().challengeType);
}

/** TrainerTowerAddFloorCleared */
function TrainerTowerAddFloorCleared(state: GameState): void {
  const rec = currentTrainerTowerRecord(state);
  rec.floorsCleared = (rec.floorsCleared + 1) & 0xff;
}

/**
 * GetFloorAlreadyCleared: FALSE only on the next floor to clear (so the player can go back down through beaten
 * floors to the lobby's Pokémon Center), TRUE elsewhere. On the roof with every floor cleared the C reads
 * floors[8], past the set (heap memory after the allocation); the port reads a zeroed floor there, so TRUE.
 */
function GetFloorAlreadyCleared(state: GameState): void {
  const d = state.defines;
  const mapLayoutId = state.mapHeaderLayoutId;
  const notCleared =
    mapLayoutId - d.require('LAYOUT_TRAINER_TOWER_1F') === currentTrainerTowerRecord(state).floorsCleared &&
    mapLayoutId - d.require('LAYOUT_TRAINER_TOWER_LOBBY') <= (tt().data.floors[tt().floorIdx]?.floorIdx ?? 0);
  setResult(state, notCleared ? 0 : 1);
}

/** StartTrainerTowerChallenge: the challenge VAR_0x8005 picked (CHALLENGE_TYPE_*), its record reset, the timer on. */
function StartTrainerTowerChallenge(state: GameState): void {
  state.towerChallengeId = varGet(state, 'VAR_0x8005');
  if (state.towerChallengeId >= state.defines.require('NUM_TOWER_CHALLENGE_TYPES')) state.towerChallengeId = 0;
  ValidateOrResetCurTrainerTowerRecord(state);
  const rec = currentTrainerTowerRecord(state);
  rec.validated = true; // !ReadTrainerTowerAndValidate()
  rec.floorsCleared = 0;
  SetVBlankCounter1Ptr(rec);
  rec.timer = 0;
  rec.spokeToOwner = false;
  rec.checkedFinalTime = false;
}

/** GetOwnerState (the owner on the roof): the timer stops; 0 first time, 1 spoken to, 2 also prize and time done. */
function GetOwnerState(state: GameState): void {
  DisableVBlankCounter1();
  const rec = currentTrainerTowerRecord(state);
  let result = 0;
  if (rec.spokeToOwner) result++;
  if (rec.receivedPrize && rec.checkedFinalTime) result++;
  setResult(state, result);
  rec.spokeToOwner = true;
}

/** GiveChallengePrize: the set's prize (floor 0's), item name in STR_VAR_2. 0 given, 1 no room, 2 already given. */
function GiveChallengePrize(state: GameState): void {
  const itemId = trainerTowerData().prizeList[tt().data.floors[0].prize];
  const rec = currentTrainerTowerRecord(state);
  if (rec.receivedPrize) {
    setResult(state, 2);
  } else if (state.bag.add(itemId, 1)) {
    state.stringVars[1] = state.pokemon.itemName(itemId); // CopyItemName(itemId, gStringVar2)
    rec.receivedPrize = true;
    setResult(state, 0);
  } else {
    setResult(state, 1);
  }
}

/** CheckFinalTime: 0 a new record (saved), 1 not, 2 already checked. */
function CheckFinalTime(state: GameState): void {
  const rec = currentTrainerTowerRecord(state);
  if (rec.checkedFinalTime) {
    setResult(state, 2);
  } else if (GetTrainerTowerRecordTime(rec) > rec.timer) {
    SetTrainerTowerRecordTime(rec, rec.timer);
    setResult(state, 0);
  } else {
    setResult(state, 1);
  }
  rec.checkedFinalTime = true;
}

/** TrainerTowerResumeTimer (every floor's ON_RESUME): the timer counts again until the owner is reached. */
function TrainerTowerResumeTimer(state: GameState): void {
  const rec = currentTrainerTowerRecord(state);
  if (!rec.spokeToOwner) {
    const max = state.defines.require('TRAINER_TOWER_MAX_TIME');
    if (rec.timer >= max) rec.timer = max;
    else SetVBlankCounter1Ptr(rec);
  }
}

/** TrainerTowerSetPlayerLost */
function TrainerTowerSetPlayerLost(state: GameState): void {
  currentTrainerTowerRecord(state).hasLost = true;
}

/** GetTrainerTowerChallengeStatus: CHALLENGE_STATUS_LOST once after a loss, else _NORMAL (_UNK is never set). */
function GetTrainerTowerChallengeStatus(state: GameState): void {
  const d = state.defines;
  const rec = currentTrainerTowerRecord(state);
  if (rec.hasLost) {
    rec.hasLost = false;
    setResult(state, d.require('CHALLENGE_STATUS_LOST'));
  } else if (rec.unkA_4) {
    rec.unkA_4 = false;
    setResult(state, d.require('CHALLENGE_STATUS_UNK'));
  } else {
    setResult(state, d.require('CHALLENGE_STATUS_NORMAL'));
  }
}

/**
 * PRINT_TOWER_TIME: frames as minutes (STR_VAR_1, right-aligned in 2), seconds (STR_VAR_2, the same) and
 * hundredths (STR_VAR_3, 2 digits with leading zeros; frames * 168 / 100, so 59 frames read 99).
 */
export function trainerTowerTimeStrings(frames: number): [number[], number[], number[]] {
  const minutes = Math.trunc(frames / (60 * 60));
  frames %= 60 * 60;
  const seconds = Math.trunc(frames / 60);
  frames %= 60;
  const centiseconds = Math.trunc((frames * 168) / 100);
  return [
    ConvertIntToDecimalStringN(minutes, STR_CONV_MODE_RIGHT_ALIGN, 2),
    ConvertIntToDecimalStringN(seconds, STR_CONV_MODE_RIGHT_ALIGN, 2),
    ConvertIntToDecimalStringN(centiseconds, STR_CONV_MODE_LEADING_ZEROS, 2),
  ];
}

function PRINT_TOWER_TIME(state: GameState, frames: number): void {
  const [m, s, c] = trainerTowerTimeStrings(frames);
  state.stringVars[0] = m;
  state.stringVars[1] = s;
  state.stringVars[2] = c;
}

/** GetCurrentTime (the floors' clocks, TrainerTower_EventScript_ShowTime): a maxed-out timer stops there. */
function GetCurrentTime(state: GameState): void {
  const rec = currentTrainerTowerRecord(state);
  const max = state.defines.require('TRAINER_TOWER_MAX_TIME');
  if (rec.timer >= max) {
    DisableVBlankCounter1();
    rec.timer = max;
  }
  PRINT_TOWER_TIME(state, rec.timer);
}

/**
 * ShowResultsBoard (`ttower_showresults`, which no script uses: the lobby's board is ShowBattleRecords): the record
 * is validated and VAR_TEMP_1 gets the window id, but the TIME BOARD window isn't drawn (see docs/DEVIATIONS.md).
 */
function ShowResultsBoard(env: TrainerTowerEnv): void {
  ValidateOrResetCurTrainerTowerRecord(env.state);
  env.warnOnce('ttower_showresults', '[trainer tower] ShowResultsBoard (unused by the scripts) draws no window');
  env.state.setVar('VAR_TEMP_1', 0);
}

/** CloseResultsBoard (`ttower_closeresults`, unused): nothing was drawn. */
function CloseResultsBoard(env: TrainerTowerEnv): void {
  env.warnOnce('ttower_closeresults', '[trainer tower] CloseResultsBoard (unused by the scripts) has no window to close');
}

/** GetMonsStateToDoubles (battle_setup.c): PLAYER_HAS_ONE_MON, else whether two can fight. */
export function GetMonsStateToDoubles(state: GameState): number {
  const d = state.defines;
  const party = state.party;
  if (party.length === 1) return d.require('PLAYER_HAS_ONE_MON');
  const alive = party.filter((m) => !m.isEgg && m.hp !== 0 && m.species !== 0).length;
  return d.require(alive > 1 ? 'PLAYER_HAS_TWO_USABLE_MONS' : 'PLAYER_HAS_ONE_USABLE_MON');
}

/** TrainerTowerGetDoublesEligiblity */
function TrainerTowerGetDoublesEligiblity(state: GameState): void {
  setResult(state, GetMonsStateToDoubles(state));
}

/**
 * TrainerTowerGetNumFloors: an e-Reader set with fewer floors than 8 names its count (STR_VAR_1, VAR_RESULT TRUE);
 * the local sets (numFloors 8 = floors[0].floorIdx) give FALSE.
 */
function TrainerTowerGetNumFloors(state: GameState): void {
  const s = tt();
  if (s.data.numFloors !== s.data.floors[0].floorIdx) {
    state.stringVars[0] = ConvertIntToDecimalStringN(s.data.numFloors, STR_CONV_MODE_LEFT_ALIGN, 1);
    setResult(state, 1);
  } else {
    setResult(state, 0);
  }
}

/** ShouldWarpToCounter: dummied out, always FALSE (TRUE would warp the player back to the lobby's counter). */
function ShouldWarpToCounter(state: GameState): void {
  setResult(state, 0);
}

/**
 * PlayTrainerTowerEncounterMusic: VAR_TEMP_1's trainer's encounter music. The C looks the trainer's *trainer* class
 * (gFacilityClassToTrainerClass) up in a table of *facility* classes, so the song is often not the class's own; kept.
 */
function PlayTrainerTowerEncounterMusic(state: GameState): void {
  const data = trainerTowerData();
  const idx = varGet(state, 'VAR_TEMP_1');
  const facilityClass = currFloor().trainers[idx].facilityClass;
  const trainerClass = data.facilityClassToTrainerClass[facilityClass];
  const entry = data.trainerEncounterMusicLUT.find((e) => e.facilityClass === trainerClass);
  PlayNewMapMusic(data.encounterMusic[entry ? entry.musicId : 0]);
}

/** HasSpokenToOwner (the receptionist's thanks) */
function HasSpokenToOwner(state: GameState): void {
  setResult(state, currentTrainerTowerRecord(state).spokeToOwner ? 1 : 0);
}
