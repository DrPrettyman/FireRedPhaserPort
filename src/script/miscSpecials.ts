// Small side specials a player meets before the Hall of Fame (SIDE_PLAN.md W-misc): Daisy's grooming
// (PalletTown_RivalsHouse), the Route 12 fishing guru's Magikarp size record (pokemon_size_record.c's specials;
// the record itself is pokemonSizeRecord.ts),
// SetSeenMon, BufferBigGuyOrBigGirlString, the Celadon game designer's diploma (CeladonCity_Condominiums_3F) and
// the Saffron Pokémon Trainer Fan Club (trainer_fan_club.c).
// MISC_SPECIALS is spread into SPECIALS. The fall warp's DoFallWarp is world/fallWarp.ts (registered with the
// field moves).

import { charmap } from '../battle/env';
import { adjustFriendship } from '../battle/pokemonBattle';
import { random } from '../util/random';
import { SetMainCallback2 } from '../gba/main';
import { CB2_ShowDiploma, DIPLOMA_GFX } from '../menus/diploma';
import { FLAG_SET_SEEN, GetSetPokedexFlag, HasAllKantoMons } from '../menus/pokedex';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import { CompareMonSize, GetMonSizeRecordInfo, withPokedexData } from './pokemonSizeRecord';
import type { Special } from './specials';

// ------------------------------------------------------------------ field_specials.c

/** GetLeadMonIndex: the first party mon that isn't an egg, else slot 0. */
function GetLeadMonIndex(party: Pokemon[]): number {
  const i = party.findIndex((m) => !m.isEgg);
  return i < 0 ? 0 : i;
}

/** GetLeadMonFriendship: the lead mon's friendship as a rating 0..6 (Daisy, the Water Labyrinth). */
export function GetLeadMonFriendship(state: GameState): number {
  const friendship = state.party[GetLeadMonIndex(state.party)]?.friendship ?? 0;
  if (friendship === 255) return 6;
  if (friendship >= 200) return 5;
  if (friendship >= 150) return 4;
  if (friendship >= 100) return 3;
  if (friendship >= 50) return 2;
  if (friendship > 0) return 1;
  return 0;
}

/** RunMassageCooldownStepCounter (ProcessPlayerFieldInput, on every step): counts up to 500. */
export function RunMassageCooldownStepCounter(state: GameState): void {
  const count = state.getVar('VAR_MASSAGE_COOLDOWN_STEP_COUNTER');
  if (count < 500) state.setVar('VAR_MASSAGE_COOLDOWN_STEP_COUNTER', count + 1);
}

// ------------------------------------------------------------------ trainer_fan_club.c

/**
 * struct TrainerFanClub, kept in VAR_FANCLUB_FAN_COUNTER as the GBA lays it out: bits 0-6 the timer, bit 7
 * gotInitialFans, bits 8-15 fanFlags (one per FANCLUB_MEMBER*). The loss timer is VAR_FANCLUB_LOSE_FAN_TIMER.
 */
export class TrainerFanClub {
  constructor(private readonly state: GameState) {}
  private get raw(): number {
    return this.state.getVar('VAR_FANCLUB_FAN_COUNTER');
  }
  private set raw(v: number) {
    this.state.setVar('VAR_FANCLUB_FAN_COUNTER', v & 0xffff);
  }
  get timer(): number {
    return this.raw & 0x7f;
  }
  set timer(v: number) {
    this.raw = (this.raw & ~0x7f) | (v & 0x7f);
  }
  get gotInitialFans(): boolean {
    return (this.raw & 0x80) !== 0;
  }
  set gotInitialFans(v: boolean) {
    this.raw = v ? this.raw | 0x80 : this.raw & ~0x80;
  }
  get fanFlags(): number {
    return this.raw >> 8;
  }
  set fanFlags(v: number) {
    this.raw = (this.raw & 0xff) | ((v & 0xff) << 8);
  }
  flag(member: number): boolean {
    return ((this.fanFlags >> member) & 1) !== 0;
  }
  setFlag(member: number): void {
    this.fanFlags |= 1 << member;
  }
  flipFlag(member: number): void {
    this.fanFlags ^= 1 << member;
  }
}

const NUM_TRAINER_FAN_CLUB_MEMBERS = 8;
// FANCLUB_MEMBER1..8 are 0..7 (constants/trainer_fan_club.h)
const sCounterIncrements = [2, 1, 2, 1];
const sGainOrder = [1, 3, 5, 0, 7, 6, 4, 2]; // PlayerGainRandomTrainerFan's sFanClubMemberIds
const sLoseOrder = [5, 6, 3, 7, 4, 1, 0, 2]; // PlayerLoseRandomTrainerFan's sFanClubMemberIds

/** UpdateTrainerFanClubGameClear: the first three fans and the members who move in, once. */
export function UpdateTrainerFanClubGameClear(state: GameState): void {
  const fanClub = new TrainerFanClub(state);
  if (fanClub.gotInitialFans) return;
  fanClub.gotInitialFans = true; // SetPlayerGotFirstFans
  // SetInitialFansOfPlayer: FANCLUB_MEMBER1..3
  fanClub.setFlag(0);
  fanClub.setFlag(1);
  fanClub.setFlag(2);
  state.setVar('VAR_FANCLUB_LOSE_FAN_TIMER', state.playTime.hours);
  for (const f of ['BLACK_BELT', 'ROCKER', 'WOMAN', 'BEAUTY']) state.setFlag(`FLAG_HIDE_SAFFRON_FAN_CLUB_${f}`, false);
  state.setVar('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB', 1);
}

/** TryGainNewFanFromCounter: after the fan club's scene 2, a new fan every 20 counts (2 or 1 per event). */
export function TryGainNewFanFromCounter(state: GameState, which: number): number {
  const fanClub = new TrainerFanClub(state);
  if (state.getVar('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB') === 2) {
    if (fanClub.timer + sCounterIncrements[which] >= 20) {
      if (GetNumFansOfPlayerInTrainerFanClub(state) < 3) {
        PlayerGainRandomTrainerFan(fanClub);
        fanClub.timer = 0;
      } else {
        fanClub.timer = 20;
      }
    } else {
      fanClub.timer += sCounterIncrements[which];
    }
  }
  return fanClub.timer;
}

/** PlayerGainRandomTrainerFan: walk the order, taking each non-fan with a coin flip; else the last non-fan. */
function PlayerGainRandomTrainerFan(fanClub: TrainerFanClub): number {
  let idx = 0;
  for (let i = 0; i < NUM_TRAINER_FAN_CLUB_MEMBERS; i++) {
    if (!fanClub.flag(sGainOrder[i])) {
      idx = i;
      if (random() % 2) {
        fanClub.setFlag(sGainOrder[i]);
        return sGainOrder[i];
      }
    }
  }
  fanClub.setFlag(sGainOrder[idx]);
  return sGainOrder[idx];
}

/** PlayerLoseRandomTrainerFan: the last fan always stays. */
function PlayerLoseRandomTrainerFan(fanClub: TrainerFanClub, state: GameState): number {
  if (GetNumFansOfPlayerInTrainerFanClub(state) === 1) return 0;
  let idx = 0;
  for (let i = 0; i < NUM_TRAINER_FAN_CLUB_MEMBERS; i++) {
    if (fanClub.flag(sLoseOrder[i])) {
      idx = i;
      if (random() % 2) {
        fanClub.flipFlag(sLoseOrder[i]);
        return sLoseOrder[i];
      }
    }
  }
  if (fanClub.flag(sLoseOrder[idx])) fanClub.flipFlag(sLoseOrder[idx]);
  return sLoseOrder[idx];
}

/** GetNumFansOfPlayerInTrainerFanClub */
export function GetNumFansOfPlayerInTrainerFanClub(state: GameState): number {
  const fanClub = new TrainerFanClub(state);
  let count = 0;
  for (let i = 0; i < NUM_TRAINER_FAN_CLUB_MEMBERS; i++) if (fanClub.flag(i)) count++;
  return count;
}

/** TryLoseFansFromPlayTime: with 5 or more fans, one leaves per 12 hours played since the timer. */
export function TryLoseFansFromPlayTime(state: GameState): void {
  const fanClub = new TrainerFanClub(state);
  const hours = state.playTime.hours;
  if (hours >= 999) return;
  for (let i = 0; ; i++) {
    if (GetNumFansOfPlayerInTrainerFanClub(state) < 5) {
      state.setVar('VAR_FANCLUB_LOSE_FAN_TIMER', hours);
      break;
    }
    if (i === NUM_TRAINER_FAN_CLUB_MEMBERS) break;
    if (hours - state.getVar('VAR_FANCLUB_LOSE_FAN_TIMER') < 12) break;
    PlayerLoseRandomTrainerFan(fanClub, state);
    state.setVar('VAR_FANCLUB_LOSE_FAN_TIMER', state.getVar('VAR_FANCLUB_LOSE_FAN_TIMER') + 12);
  }
}

/**
 * BufferFanClubTrainerName: STR_VAR_1 = the trainer member VAR_0x8004 is a fan of. With no link battle records
 * (the port has no link play) that is the rival, LT. SURGE or KOGA.
 */
export function BufferFanClubTrainerName(state: GameState, encodeText: (label: string) => number[]): void {
  const member = state.getVar('VAR_0x8004');
  const whichNPCTrainer = member === 4 ? 1 : member === 6 ? 2 : 0; // FANCLUB_MEMBER5: Surge, FANCLUB_MEMBER7: Koga
  if (whichNPCTrainer === 1) state.stringVars[0] = encodeText('gText_LtSurge');
  else if (whichNPCTrainer === 2) state.stringVars[0] = encodeText('gText_Koga');
  else state.stringVars[0] = charmap.encodePlain(state.rivalName); // gSaveBlock1Ptr->rivalName
}

// ------------------------------------------------------------------ the table

/** sMartMaps (field_specials.c): each Poké Mart and its clerk's local id. */
const sMartMaps: [string, number][] = [
  ['MAP_VIRIDIAN_CITY_MART', 1],
  ['MAP_PEWTER_CITY_MART', 3],
  ['MAP_CERULEAN_CITY_MART', 1],
  ['MAP_LAVENDER_TOWN_MART', 1],
  ['MAP_VERMILION_CITY_MART', 1],
  ['MAP_FUCHSIA_CITY_MART', 1],
  ['MAP_CINNABAR_ISLAND_MART', 1],
  ['MAP_SAFFRON_CITY_MART', 1],
  ['MAP_THREE_ISLAND_MART', 1],
  ['MAP_FOUR_ISLAND_MART', 1],
  ['MAP_SEVEN_ISLAND_MART', 1],
  ['MAP_SIX_ISLAND_MART', 1],
];

/** GetMartClerkObjectId: the current mart's clerk (sMartMaps), else 1. Only EventScript_Questionnaire asks. */
export function GetMartClerkObjectId(mapId: string): number {
  return sMartMaps.find(([map]) => map === mapId)?.[1] ?? 1;
}

export const MISC_SPECIALS: Record<string, Special> = {
  GetMartClerkObjectId({ state }) {
    return GetMartClerkObjectId(state.currentMapId);
  },

  /** DaisyMassageServices: AdjustFriendship(party slot VAR_0x8004, FRIENDSHIP_EVENT_MASSAGE); the cooldown restarts. */
  DaisyMassageServices({ state }) {
    const mon = state.party[state.getVar('VAR_0x8004')];
    if (mon) adjustFriendship(mon, state.defines.require('FRIENDSHIP_EVENT_MASSAGE'));
    state.setVar('VAR_MASSAGE_COOLDOWN_STEP_COUNTER', 0);
  },

  GetLeadMonFriendship({ state }) {
    return GetLeadMonFriendship(state);
  },

  /** SetSeenMon: GetSetPokedexFlag(SpeciesToNationalPokedexNum(VAR_0x8004), FLAG_SET_SEEN). */
  SetSeenMon({ state }) {
    GetSetPokedexFlag(state, state.pokemon.nationalDex(state.getVar('VAR_0x8004')), FLAG_SET_SEEN);
  },

  /** DoesPlayerPartyContainSpecies: a party mon (MON_DATA_SPECIES_OR_EGG) of species VAR_0x8004. */
  DoesPlayerPartyContainSpecies({ state }) {
    const species = state.getVar('VAR_0x8004');
    const egg = state.defines.require('SPECIES_EGG');
    return state.party.some((m) => (m.isEgg ? egg : m.species) === species) ? 1 : 0;
  },

  /** BufferBigGuyOrBigGirlString: STR_VAR_1 = "Big guy" / "Big girl" by the player's gender. */
  BufferBigGuyOrBigGirlString({ state, encodeText }) {
    state.stringVars[0] = encodeText(state.playerGender === 'female' ? 'gText_BigGirl' : 'gText_BigGuy');
  },

  /** GetMagikarpSizeRecordInfo (VAR_MAGIKARP_SIZE_RECORD) */
  GetMagikarpSizeRecordInfo(env) {
    const { state, encodeText } = env;
    withPokedexData(env, () => GetMonSizeRecordInfo(state, state.defines.require('SPECIES_MAGIKARP'), 'VAR_MAGIKARP_SIZE_RECORD', encodeText('gText_DecimalPoint')));
  },

  /** CompareMagikarpSize: gSpecialVar_Result = CompareMonSize(SPECIES_MAGIKARP, VAR_MAGIKARP_SIZE_RECORD). */
  CompareMagikarpSize(env) {
    const { state, encodeText } = env;
    withPokedexData(env, () => state.setVar('VAR_RESULT', CompareMonSize(state, state.defines.require('SPECIES_MAGIKARP'), 'VAR_MAGIKARP_SIZE_RECORD', encodeText('gText_DecimalPoint'))));
  },

  /** HasAllKantoMons (pokedex.c): every Kanto mon but Mew caught. */
  HasAllKantoMons({ state }) {
    return HasAllKantoMons(state) ? 1 : 0;
  },

  /**
   * ShowDiploma: SetMainCallback2(CB2_ShowDiploma) (menus/diploma.ts). It returns through
   * CB2_ReturnToFieldFromDiploma (the field fades in from black); the script's `waitstate` ends then.
   */
  ShowDiploma({ host, setWaitState }) {
    setWaitState(host.runScreenFromScript(() => SetMainCallback2(CB2_ShowDiploma), DIPLOMA_GFX));
  },

  // trainer_fan_club.c (SaffronCity_PokemonTrainerFanClub; the game-clear and Lance's counter from the league)
  Script_UpdateTrainerFanClubGameClear({ state }) {
    UpdateTrainerFanClubGameClear(state);
  },
  Script_TryGainNewFanFromCounter({ state }) {
    return TryGainNewFanFromCounter(state, state.getVar('VAR_0x8004'));
  },
  Script_GetNumFansOfPlayerInTrainerFanClub({ state }) {
    return GetNumFansOfPlayerInTrainerFanClub(state);
  },
  Script_TryLoseFansFromPlayTime({ state }) {
    TryLoseFansFromPlayTime(state);
  },
  /** IsFanClubMemberFanOfPlayer: member VAR_0x8004's fan flag. */
  Script_IsFanClubMemberFanOfPlayer({ state }) {
    return new TrainerFanClub(state).flag(state.getVar('VAR_0x8004')) ? 1 : 0;
  },
  Script_BufferFanClubTrainerName({ state, encodeText }) {
    BufferFanClubTrainerName(state, encodeText);
  },
};
