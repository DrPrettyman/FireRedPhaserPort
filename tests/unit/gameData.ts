// Builds the game's data-backed objects (Defines, Charmap, PokemonData, GameState, the battle env) in Node
// from the extracted JSON in public/gen, the same way BootScene/OverworldScene do in the browser.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadBattleData } from '../../src/battle/data';
import { initBattleEnv } from '../../src/battle/env';
import type { Constants, ItemInfo, MoveInfo, PokemonTables, SpeciesInfo } from '../../src/data/types';
import { PokemonData, readPokemonConstants } from '../../src/pokemon/Pokemon';
import { Defines } from '../../src/script/Defines';
import { GameState } from '../../src/state/GameState';
import { Charmap, type CharmapData } from '../../src/text/charmap';

const PUBLIC = resolve(__dirname, '../../public');

if (!existsSync(resolve(PUBLIC, 'gen/constants.json'))) {
  throw new Error('public/gen is missing: run `npm run extract` before the unit tests.');
}

/** Read a file under public/gen as JSON. */
export function readGen<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(PUBLIC, 'gen', path), 'utf8')) as T;
}

interface GameData {
  defines: Record<string, number>;
  constants: Constants;
  charmap: CharmapData;
  species: SpeciesInfo[];
  moves: MoveInfo[];
  items: ItemInfo[];
  tables: PokemonTables;
  strings: Record<string, string>;
}

let data: GameData | undefined;

function gameData(): GameData {
  data ??= {
    defines: readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines,
    constants: readGen('constants.json'),
    charmap: readGen('text/charmap.json'),
    species: readGen('pokemon/species.json'),
    moves: readGen('pokemon/moves.json'),
    items: readGen('pokemon/items.json'),
    tables: readGen('pokemon/tables.json'),
    strings: readGen('text/strings.json'),
  };
  return data;
}

export interface TestGame {
  defines: Defines;
  /** Constant by name (throws on a typo). */
  d(name: string): number;
  charmap: Charmap;
  pokemon: PokemonData;
  state: GameState;
}

/** A fresh new-game state, as OverworldScene.init builds it. */
export function newGame(): TestGame {
  const gd = gameData();
  const defines = new Defines(gd.defines);
  const charmap = new Charmap(gd.charmap);
  const pokemon = new PokemonData(readPokemonConstants(defines), gd.species, gd.moves, gd.items, gd.tables, charmap);
  const state = new GameState(defines, gd.constants.newGameFlags, pokemon, gd.strings);
  return { defines, d: (name) => defines.require(name), charmap, pokemon, state };
}

/**
 * newGame() plus the battle engine's globals (initBattleEnv), with the battle JSON read from disk.
 * loadBattleData fetches relative URLs, so fetch is pointed at public/ while it runs.
 */
export async function newBattleEnv(): Promise<TestGame> {
  const game = newGame();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    const battle = await loadBattleData('gen');
    initBattleEnv(battle, gameData().defines, game.pokemon, game.state, game.charmap);
  } finally {
    globalThis.fetch = realFetch;
  }
  return game;
}
