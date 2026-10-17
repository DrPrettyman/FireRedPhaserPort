// wild_pokemon_area.c (GetSpeciesPokedexAreaMarkers) and pokedex_area_markers.c (the markers' sprite), checked
// against facts from the decomp: which maps' encounter tables list a species (src/data/wild_encounters.json)
// and where sAreaMarkers puts each DEX_AREA_*.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { WildEncounterData } from '../../src/data/types';
import { loadGfx, setGfxBase } from '../../src/gba/gfx';
import { oamBuffer, BuildOamBuffer, gSprites, ResetSpriteData, ST_OAM_OBJ_WINDOW, type Subsprite } from '../../src/gba/sprite';
import { ResetTasks, RunTasks } from '../../src/gba/task';
import { loadMenusData } from '../../src/menus/data';
import { CreatePokedexAreaMarkers, DestroyPokedexAreaMarkers, GetNumPokedexAreaMarkers, pokedexAreaMarkerGfxSymbols } from '../../src/menus/pokedexArea';
import { GetSpeciesPokedexAreaMarkers, initWildPokemonArea } from '../../src/menus/wildPokemonArea';
import { GetUnlockedSeviiAreas } from '../../src/world/regionMap';
import { initRoamer, initRoamerTables, roamerLocation, setRoamerInactive } from '../../src/world/roamer';
import { seedRng } from '../../src/util/random';
import { newBattleEnv, readGen, type TestGame } from './gameData';

const PUBLIC = resolve(__dirname, '../../public');

/** Runs `fn` with fetch reading files under public/ (loadMenusData / loadGfx fetch relative URLs). */
async function withLocalFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url).replace(/^\//, ''));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

let game: TestGame;
const wild = readGen<WildEncounterData>('wild_encounters.json');

beforeAll(async () => {
  await withLocalFetch(async () => {
    await loadMenusData('gen');
    setGfxBase('gen');
    await loadGfx(pokedexAreaMarkerGfxSymbols);
  });
  initWildPokemonArea(wild);
  initRoamerTables(wild);
});

beforeEach(async () => {
  game = await newBattleEnv();
});

const ISLANDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];

function unlock(...islands: number[]): void {
  for (const i of islands) game.state.setFlag(`FLAG_WORLD_MAP_${ISLANDS[i - 1]}_ISLAND`);
}

function markers(speciesName: string): Subsprite[] {
  const subsprites: Subsprite[] = [];
  const n = GetSpeciesPokedexAreaMarkers(game.d(speciesName), subsprites);
  expect(subsprites.length).toBe(n);
  return subsprites;
}

// [x, y] of a marker (sAreaMarkers' position) and its shape: [SPRITE_SHAPE, SPRITE_SIZE, tileOffset]
const pos = (s: Subsprite) => [s.x, s.y];
// sAreaMarkers entries written out from pokedex_area_markers.c
const ROUTE_1 = [54, 32]; // MARKER_SMALL_V
const PALLET_TOWN = [54, 44]; // MARKER_CIRCULAR
const MT_EMBER = [14, 1];
const BERRY_FOREST = [5, 52];
const BOND_BRIDGE = [2, 52];
const FIVE_ISLE_MEADOW = [48, 80];
const ALTERING_CAVE = [69, 73];

describe('GetUnlockedSeviiAreas', () => {
  test('one bit per FLAG_WORLD_MAP_*_ISLAND', () => {
    expect(GetUnlockedSeviiAreas()).toBe(0);
    unlock(1, 3);
    expect(GetUnlockedSeviiAreas()).toBe(0b101);
    unlock(7);
    expect(GetUnlockedSeviiAreas()).toBe(0b1000101);
  });
});

describe('GetSpeciesPokedexAreaMarkers', () => {
  test('Pidgey: one marker per Kanto route it lives on', () => {
    const m = markers('SPECIES_PIDGEY');
    // Routes 1, 2, 3, 5, 6, 7, 8, 12, 13, 14, 15, 24, 25 (FireRed's land tables)
    expect(m).toHaveLength(13);
    const route1 = m.find((s) => s.x === ROUTE_1[0] && s.y === ROUTE_1[1])!;
    // MARKER_SMALL_V: SPRITE_SHAPE(8x16) = V_RECTANGLE, size 0, tileOffset 3, priority 1
    expect(route1).toEqual({ x: 54, y: 32, shape: 2, size: 0, tileOffset: 3, priority: 1 });
    // Route 25 is MARKER_MED_H at (90, -2): SPRITE_SHAPE(32x16) = H_RECTANGLE, size 2, tileOffset 5
    expect(m).toContainEqual({ x: 90, y: -2, shape: 1, size: 2, tileOffset: 5, priority: 1 });
  });

  test('Pidgey: the Sevii areas count once their islands are unlocked', () => {
    unlock(3);
    let m = markers('SPECIES_PIDGEY').map(pos);
    expect(m).toHaveLength(15);
    expect(m).toContainEqual(BERRY_FOREST);
    expect(m).toContainEqual(BOND_BRIDGE);
    expect(m).not.toContainEqual(FIVE_ISLE_MEADOW);
    unlock(5);
    m = markers('SPECIES_PIDGEY').map(pos);
    expect(m).toHaveLength(16);
    expect(m).toContainEqual(FIVE_ISLE_MEADOW);
  });

  test('Magikarp: found by fishing only', () => {
    const m = markers('SPECIES_MAGIKARP').map(pos);
    expect(m).toContainEqual(PALLET_TOWN); // Pallet Town's only table is fishing
    expect(m).not.toContainEqual(ROUTE_1);
  });

  test('a mon with no wild encounters has no markers', () => {
    expect(markers('SPECIES_BULBASAUR')).toHaveLength(0);
    expect(markers('SPECIES_MEW')).toHaveLength(0);
  });

  test('Slugma lives only on Mt. Ember: nothing until One Island is unlocked, then one marker per map', () => {
    expect(markers('SPECIES_SLUGMA')).toHaveLength(0);
    unlock(1);
    const m = markers('SPECIES_SLUGMA').map(pos);
    // Ruby Path B1F, B1F stairs, B2F, B2F stairs, B3F (land and Rock Smash: still one header)
    expect(m).toEqual([MT_EMBER, MT_EMBER, MT_EMBER, MT_EMBER, MT_EMBER]);
  });

  test('Altering Cave only counts the table VAR_ALTERING_CAVE_WILD_SET picks', () => {
    unlock(6);
    expect(markers('SPECIES_ZUBAT').map(pos)).toContainEqual(ALTERING_CAVE);
    expect(markers('SPECIES_MAREEP')).toHaveLength(0);
    game.state.setVar('VAR_ALTERING_CAVE_WILD_SET', 1);
    expect(markers('SPECIES_MAREEP').map(pos)).toEqual([ALTERING_CAVE]);
    expect(markers('SPECIES_ZUBAT').map(pos)).not.toContainEqual(ALTERING_CAVE);
    // Out of range: set 0 (Zubat) again
    game.state.setVar('VAR_ALTERING_CAVE_WILD_SET', 99);
    expect(markers('SPECIES_MAREEP')).toHaveLength(0);
  });

  test('a roamer: one marker where it is, only for the roamer paired with the starter', () => {
    game.state.setVar('VAR_STARTER_MON', 0); // sStarterSpecies[0] = Bulbasaur → Entei roams
    expect(markers('SPECIES_ENTEI')).toHaveLength(0); // not roaming yet (ROAMER->active is FALSE)
    seedRng(7);
    initRoamer(game.state);
    const at = roamerLocation();
    const route = /^MAP_ROUTE(\d+)/.exec(at);
    expect(route, at).not.toBeNull();
    const area = game.d(`DEX_AREA_ROUTE_${route![1]}`);
    const m = markers('SPECIES_ENTEI');
    expect(m).toHaveLength(1);
    const [, x, y] = readGen<{ pokedexArea: { areaMarkers: number[][] } }>('menus.json').pokedexArea.areaMarkers[area];
    expect(pos(m[0])).toEqual([x, y]);
    // The other roamers never show, even though Raikou is the default roamer species
    expect(markers('SPECIES_SUICUNE')).toHaveLength(0);
    expect(markers('SPECIES_RAIKOU')).toHaveLength(0);
    setRoamerInactive(game.state); // caught or defeated
    expect(markers('SPECIES_ENTEI')).toHaveLength(0);
  });
});

describe('CreatePokedexAreaMarkers', () => {
  test('one OBJ-window sprite whose subsprites are the markers, shown from the task’s first run', () => {
    ResetSpriteData();
    ResetTasks();
    const taskId = CreatePokedexAreaMarkers(game.d('SPECIES_PIDGEY'), 2001, 3, 4 * 8);
    expect(GetNumPokedexAreaMarkers(taskId)).toBe(13);
    BuildOamBuffer();
    expect(oamBuffer.filter((o) => o.objMode === ST_OAM_OBJ_WINDOW)).toHaveLength(0); // invisible until the task runs
    RunTasks();
    BuildOamBuffer();
    const objs = oamBuffer.filter((o) => o.objMode === ST_OAM_OBJ_WINDOW);
    expect(objs).toHaveLength(13);
    // Placed relative to (104, y + 32): Route 1's marker at (54, 32) → (158, 96)
    expect(objs).toContainEqual(expect.objectContaining({ x: 158, y: 96, shape: 2, size: 0, paletteNum: 3, priority: 1 }));
    DestroyPokedexAreaMarkers(taskId);
    expect(gSprites.some((s) => s.inUse && s.subspriteTables)).toBe(false);
  });
});
