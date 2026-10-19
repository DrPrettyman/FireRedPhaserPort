// The National Dex's checks outside the Pokédex (state/nationalDex.ts): event_data.c's IsNationalPokedexEnabled (the
// magic, VAR_NATIONAL_DEX and FLAG_SYS_NATIONAL_DEX), pokemon.c's SpeciesToPokedexNum and GetEvolutionTargetSpecies's
// EVO_MODE_TRADE limit, against the decomp's rules and evolution table.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { GetEvolutionTargetSpecies } from '../../src/battle/items';
import { loadMenusData } from '../../src/menus/data';
import { IsNationalPokedexEnabled, SpeciesToPokedexNum } from '../../src/state/nationalDex';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;
const PUBLIC = resolve(__dirname, '../../public');

beforeAll(async () => {
  t = await newBattleEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    await loadMenusData('gen');
  } finally {
    globalThis.fetch = realFetch;
  }
});

/** DisableNationalPokedex (event_data.c): the battle env's state is shared, so every test starts without it. */
beforeEach(() => {
  t.state.nationalDexEnabled = false;
  t.state.setVar('VAR_NATIONAL_DEX', 0);
  t.state.setFlag('FLAG_SYS_NATIONAL_DEX', false);
});

/** EnableNationalPokedex (event_data.c) */
function enable() {
  t.state.nationalDexEnabled = true;
  t.state.setVar('VAR_NATIONAL_DEX', 0x6258);
  t.state.setFlag('FLAG_SYS_NATIONAL_DEX', true);
}

const sp = (name: string) => t.d(`SPECIES_${name}`);

test('IsNationalPokedexEnabled wants all three of the magic, VAR_NATIONAL_DEX = 0x6258 and FLAG_SYS_NATIONAL_DEX', () => {
  const s = t.state;
  expect(IsNationalPokedexEnabled(s)).toBe(false);
  s.nationalDexEnabled = true;
  expect(IsNationalPokedexEnabled(s)).toBe(false);
  s.setVar('VAR_NATIONAL_DEX', 0x6258);
  expect(IsNationalPokedexEnabled(s)).toBe(false);
  s.setFlag('FLAG_SYS_NATIONAL_DEX', true);
  expect(IsNationalPokedexEnabled(s)).toBe(true);
  s.setVar('VAR_NATIONAL_DEX', 0x6259);
  expect(IsNationalPokedexEnabled(s)).toBe(false);
});

test('SpeciesToPokedexNum: 0xFFFF past Kanto without the National Dex (the summary screen\'s "No. ???")', () => {
  // Kanto species keep their number; Chikorita (152) and the Hoenn species (stored after the gap) don't
  expect(SpeciesToPokedexNum(t.state, sp('MEW'))).toBe(151);
  expect(SpeciesToPokedexNum(t.state, sp('CHIKORITA'))).toBe(0xffff);
  expect(SpeciesToPokedexNum(t.state, sp('TREECKO'))).toBe(0xffff);
  enable();
  expect(SpeciesToPokedexNum(t.state, sp('CHIKORITA'))).toBe(152);
  expect(SpeciesToPokedexNum(t.state, sp('TREECKO'))).toBe(252);
  expect(SpeciesToPokedexNum(t.state, sp('DEOXYS'))).toBe(386);
});

test('a trade evolution into a non-Kanto species keeps its item without the National Dex (GetEvolutionTargetSpecies)', () => {
  const metalCoat = t.d('ITEM_METAL_COAT');
  const onix = () => {
    const mon = t.pokemon.createMon(sp('ONIX'), 30, { personality: 0, otId: 1, otName: 'RED' });
    mon.heldItem = metalCoat;
    return mon;
  };
  // EVO_TRADE_ITEM: targetSpecies is set before the check, so the target is Steelix either way; only the item's
  // removal waits for the National Dex (and evolution_scene.c's Task_TradeEvolutionScene cancels past SPECIES_MEW).
  let mon = onix();
  expect(GetEvolutionTargetSpecies(mon, t.d('EVO_MODE_TRADE'), 0)).toBe(sp('STEELIX'));
  expect(mon.heldItem).toBe(metalCoat);
  enable();
  mon = onix();
  expect(GetEvolutionTargetSpecies(mon, t.d('EVO_MODE_TRADE'), 0)).toBe(sp('STEELIX'));
  expect(mon.heldItem).toBe(t.d('ITEM_NONE'));
  // A Kanto target (Kadabra, EVO_TRADE) is never held back
  expect(GetEvolutionTargetSpecies(t.pokemon.createMon(sp('KADABRA'), 30, { personality: 0, otId: 1, otName: 'RED' }), t.d('EVO_MODE_TRADE'), 0)).toBe(sp('ALAKAZAM'));
});

test('an evolution stone\'s target past Kanto (Gloom + Sun Stone → Bellossom) is what party_menu.c\'s MonCanEvolve compares', () => {
  const gloom = t.pokemon.createMon(sp('GLOOM'), 30, { personality: 0, otId: 1, otName: 'RED' });
  const target = GetEvolutionTargetSpecies(gloom, t.d('EVO_MODE_ITEM_USE'), t.d('ITEM_SUN_STONE'));
  expect(target).toBe(sp('BELLOSSOM'));
  expect(target).toBeGreaterThan(t.d('KANTO_DEX_COUNT'));
  expect(GetEvolutionTargetSpecies(gloom, t.d('EVO_MODE_ITEM_USE'), t.d('ITEM_LEAF_STONE'))).toBe(sp('VILEPLUME'));
});
