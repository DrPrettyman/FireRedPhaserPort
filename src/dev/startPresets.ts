import type { BattleTablesData } from '../battle/data';
import type { Pokemon } from '../pokemon/Pokemon';
import type { HealLocation } from '../script/ScriptEngine';
import { healPlayerParty } from '../script/specials';
import type { GameState } from '../state/GameState';
import type { OverworldStart } from '../scenes/OverworldScene';

/**
 * Dev-only start states (`?start=after-rival`), so a playtest can begin later in the story. Story presets
 * apply what the game's own scripts would have left behind, step by step, citing them; after-rival was
 * checked against the state of a real headless playthrough. Test-bed presets (`evolution`) build on one
 * and then set up a party and bag that no playthrough would have.
 */

/** Starter choice as PLAYER_STARTER_NUM (PalletTown_ProfessorOaksLab_EventScript_Choose*). */
export const STARTERS = ['bulbasaur', 'squirtle', 'charmander'] as const;
export type Starter = (typeof STARTERS)[number];

/** Player's species, then the rival's counter-pick (the setvars before each confirmation). */
const STARTER_SPECIES: Record<Starter, { player: string; rival: string }> = {
  bulbasaur: { player: 'BULBASAUR', rival: 'CHARMANDER' },
  squirtle: { player: 'SQUIRTLE', rival: 'BULBASAUR' },
  charmander: { player: 'CHARMANDER', rival: 'SQUIRTLE' },
};

export const PRESETS = ['after-rival', 'evolution'] as const;

export interface StartPreset {
  name: (typeof PRESETS)[number];
  starter: Starter;
}

/** Where the rival battle leaves the player: on the middle trigger tile, having watched the rival leave. */
export const AFTER_RIVAL_START: OverworldStart = { map: 'PalletTown_ProfessorOaksLab', x: 6, y: 8, facing: 'down' };

/** Viridian Forest, six tiles left of Bug Catcher Rick (sight 5): one step right and he spots you. */
export const EVOLUTION_START: OverworldStart = { map: 'ViridianForest', x: 41, y: 45, facing: 'right' };

/** Where a preset starts when the URL gives no ?map=&x=&y=. */
export function presetStart(preset: StartPreset): OverworldStart {
  return preset.name === 'evolution' ? EVOLUTION_START : AFTER_RIVAL_START;
}

/** Apply a preset to a fresh new-game state, before the first map loads. */
export async function applyStartPreset(state: GameState, preset: StartPreset, healLocations: HealLocation[]): Promise<void> {
  const tables: BattleTablesData = await (await fetch('gen/battle/tables.json')).json();
  applyAfterRival(state, preset.starter, tables, healLocations);
  if (preset.name === 'evolution') applyEvolutionTestBed(state);
}

/**
 * Not a story state: after-rival, then a party with an evolution ready each way.
 * - The starter at Lv. 15, one exp point short of 16 (all three starters evolve at 16): beat Rick to evolve it.
 * - Caterpie at Lv. 6 and a Rare Candy: Lv. 7 evolves it into Metapod, which then learns Harden.
 * - Pikachu and a Thunder Stone.
 */
function applyEvolutionTestBed(state: GameState): void {
  const d = state.defines;
  const data = state.pokemon;
  const create = (name: string, level: number) => {
    const species = d.require(`SPECIES_${name}`);
    state.setDexFlags(data.nationalDex(species), true, true);
    return data.createMon(species, level, { otId: state.trainerId, otName: state.playerName, otGender: state.playerGender, metLocation: 'MAPSEC_VIRIDIAN_FOREST' });
  };

  const starter = state.party[0];
  const lead = create(data.species[starter.species].id.replace('SPECIES_', ''), 15);
  lead.personality = starter.personality; // same mon, just trained up
  lead.exp = data.tables.experience[data.species[lead.species].growthRate][16] - 1;
  data.calculateStats(lead);
  lead.hp = lead.maxHP;

  state.party = [lead, create('CATERPIE', 6), create('PIKACHU', 10)];
  state.bag.add(d.require('ITEM_RARE_CANDY'), 1);
  state.bag.add(d.require('ITEM_THUNDER_STONE'), 1);
}

/**
 * New game → Oak's lab after the first rival battle, won. Battle effects (exp, EVs, level-up friendship,
 * prize money, Pokédex) follow Cmd_getexp / MonGainEVs / AdjustFriendship / Cmd_getmoneyreward for a
 * single level-5 opponent beaten by the starter.
 */
function applyAfterRival(state: GameState, starter: Starter, tables: BattleTablesData, healLocations: HealLocation[]): void {
  const d = state.defines;
  const { player, rival } = STARTER_SPECIES[starter];
  const playerSpecies = d.require(`SPECIES_${player}`);

  // PalletTown_PlayersHouse_2F: OnTransition's setrespawn HEAL_LOCATION_PALLET_TOWN, then FirstWarpIn
  const { map, x, y } = healLocations[d.require('HEAL_LOCATION_PALLET_TOWN') - 1];
  state.lastHealLocation = { map, x, y };
  state.setVar('VAR_MAP_SCENE_PALLET_TOWN_PLAYERS_HOUSE_2F', 1);
  // PalletTown_OnTransition
  state.setFlag('FLAG_WORLD_MAP_PALLET_TOWN', true);
  // Leaving the house starts a quest log scene (QL_EVENT_DEPARTED): QL_StartRecordingAction's BackUpMapLayout
  state.setVar('VAR_QLBAK_MAP_LAYOUT', d.require('LAYOUT_PALLET_TOWN'));

  // PalletTown_EventScript_OakTrigger (FLAG_DONT_TRANSITION_MUSIC is set there and cleared in the lab)
  state.setVar('VAR_MAP_SCENE_PALLET_TOWN_OAK', 1);
  state.setFlag('FLAG_HIDE_OAK_IN_PALLET_TOWN', true);
  state.setFlag('FLAG_HIDE_OAK_IN_HIS_LAB', false);

  // PalletTown_ProfessorOaksLab_OnTransition
  state.setFlag('FLAG_VISITED_OAKS_LAB', true);

  // PalletTown_ProfessorOaksLab_EventScript_GiveStarter: flags, givemon, removeobject VAR_LAST_TALKED
  state.setFlag('FLAG_SYS_POKEMON_GET', true);
  state.setFlag('FLAG_PALLET_LADY_NOT_BLOCKING_SIGN', true);
  const mon = state.pokemon.createMon(playerSpecies, 5, {
    otId: state.trainerId,
    otName: state.playerName,
    otGender: state.playerGender,
    metLocation: 'MAPSEC_PALLET_TOWN',
  });
  state.giveMon(mon);
  state.setDexFlags(state.pokemon.nationalDex(playerSpecies), true, true);
  state.setVar('VAR_STARTER_MON', STARTERS.indexOf(starter)); // copyvar VAR_STARTER_MON, PLAYER_STARTER_NUM
  state.setFlag(`FLAG_HIDE_${player}_BALL`, true);

  // PalletTown_ProfessorOaksLab_EventScript_RivalTakesStarter: removeobject RIVAL_STARTER_ID
  // (VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY is only set here if the start menu was opened, which it hasn't been.)
  state.setFlag(`FLAG_HIDE_${rival}_BALL`, true);

  // trainerbattle_earlyrival TRAINER_RIVAL_OAKS_LAB_<rival's species>, won
  const trainerId = d.require(`TRAINER_RIVAL_OAKS_LAB_${rival}`);
  const trainer = tables.trainers[trainerId]!;
  const foe = trainer.party[trainer.party.length - 1];
  state.setFlag(d.require('TRAINER_FLAGS_START') + trainerId, true);
  state.setDexFlags(state.pokemon.nationalDex(foe.species), true, false); // seen in battle
  gainBattleExp(state, mon, foe.species, foe.lvl, tables);
  // Cmd_getmoneyreward: 4 * last mon's level * gTrainerMoneyTable[class] (single battle, multiplier 1)
  const classMoney = tables.trainerMoney.find(([cls]) => cls === trainer.trainerClass || cls === 0xff)![1];
  state.addMoney(4 * foe.lvl * classMoney);

  // PalletTown_ProfessorOaksLab_EventScript_EndRivalBattle
  healPlayerParty(state);
  state.setFlag('FLAG_HIDE_RIVAL_IN_LAB', true); // removeobject LOCALID_OAKS_LAB_RIVAL
  state.setVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB', 4);
  state.setFlag('FLAG_BEAT_RIVAL_IN_OAKS_LAB', true);
}

/** The starter alone beats one trainer mon: MonGainEVs, then Cmd_getexp's exp and the level-ups it causes. */
function gainBattleExp(state: GameState, mon: Pokemon, foeSpecies: number, foeLevel: number, tables: BattleTablesData): void {
  const data = state.pokemon;
  const d = state.defines;
  const foe = data.species[foeSpecies] as unknown as Record<string, number>;
  const yields = ['evYield_HP', 'evYield_Attack', 'evYield_Defense', 'evYield_Speed', 'evYield_SpAttack', 'evYield_SpDefense'];
  (['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const).forEach((stat, i) => (mon.evs[stat] += foe[yields[i]] ?? 0));

  // calculatedExp = expYield * level / 7, then * 150 / 100 for a trainer battle
  const exp = Math.trunc((Math.trunc((foe.expYield * foeLevel) / 7) * 150) / 100);
  mon.exp += exp;
  const deltas = (tables.mech as Record<string, number[]>).sFriendshipEventDeltas;
  const growLevel = d.require('FRIENDSHIP_EVENT_GROW_LEVEL');
  while (data.levelFromExp(mon) > mon.level) {
    mon.level++; // TryIncrementMonLevel → CalculateMonStats
    data.calculateStats(mon);
    for (const [level, move] of data.species[mon.species].learnset) if (level === mon.level) data.giveMove(mon, move); // MonTryLearningNewMove
    // AdjustFriendship(FRIENDSHIP_EVENT_GROW_LEVEL): +1 more when met here (Pallet Town)
    const tier = (mon.friendship >= 100 ? 1 : 0) + (mon.friendship >= 200 ? 1 : 0);
    mon.friendship = Math.min(mon.friendship + deltas[growLevel * 3 + tier] + 1, d.require('MAX_FRIENDSHIP'));
  }
}

/** `?start=after-rival|evolution[&starter=squirtle]`, dev builds only. */
export function presetFromUrl(q: URLSearchParams): StartPreset | undefined {
  const name = PRESETS.find((p) => p === q.get('start'));
  if (!import.meta.env.DEV || !name) return undefined;
  const s = q.get('starter')?.toLowerCase();
  return { name, starter: STARTERS.find((x) => x === s) ?? 'bulbasaur' };
}
