// Eggs and the Four Island daycare (world/daycare.ts, script/daycareSpecials.ts), against cases worked by hand
// from daycare.c and the decomp's data: the evolution table (egg species), egg_moves.h, tmhm_learnsets.h,
// level_up_learnsets.h, species_info.h's egg groups and gender ratios.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { setTextStrings } from '../../src/battle/env';
import { gStringVar4 } from '../../src/menus/common';
import { loadMenusData } from '../../src/menus/data';
import { gPartyMenu } from '../../src/menus/partyMenu';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import { SPECIALS, type SpecialEnv } from '../../src/script/specials';
import { boxMonFromMon, type BoxPokemon } from '../../src/state/PokemonStorage';
import { random, seedRng } from '../../src/util/random';
import {
  alterEggSpeciesWithIncenseItem,
  appendGenderSymbol,
  buildEggMoveset,
  determineEggSpeciesAndParentSlots,
  getDaycareCompatibilityScore,
  getEggMoves,
  getEggSpecies,
  giveEggFromDaycare,
  inheritIVs,
  nameHasGenderSymbol,
  scriptGiveEgg,
  shouldEggHatch,
} from '../../src/world/daycare';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let t: TestGame;
const PUBLIC = resolve(__dirname, '../../public');

beforeAll(async () => {
  t = await newBattleEnv();
  setTextStrings(readGen('text/strings.json'));
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

const sp = (name: string) => t.d(`SPECIES_${name}`);
const mv = (name: string) => t.d(`MOVE_${name}`);
/** Personality low byte 0xFF is male and 0x00 female for every species with a gender ratio in between. */
const MALE = 0xff;
const FEMALE = 0x00;

const make = (species: string, opts: { personality?: number; otId?: number; moves?: string[]; item?: string; level?: number } = {}): Pokemon => {
  const mon = t.pokemon.createMon(sp(species), opts.level ?? 30, {
    personality: opts.personality ?? MALE,
    otId: opts.otId ?? 12345,
    otName: 'RED',
    otGender: 'male',
    metLocation: 'MAPSEC_PALLET_TOWN',
  });
  if (opts.moves) {
    mon.moves = [0, 1, 2, 3].map((i) => (opts.moves![i] ? mv(opts.moves![i]) : 0));
    mon.pp = mon.moves.map((m) => (m ? t.pokemon.moves[m].pp : 0));
  }
  if (opts.item) mon.heldItem = t.d(`ITEM_${opts.item}`);
  return mon;
};
const box = (mon: Pokemon): BoxPokemon => boxMonFromMon(mon);
const leave = (...mons: (Pokemon | null)[]) => {
  t.state.daycare = { mons: mons.map((m) => ({ mon: m && box(m), steps: 0 })), offspringPersonality: 0, stepCounter: 0 };
};
const str = (i: number) => t.charmap.decodePlain(t.state.stringVars[i]);
const run = (name: string) => SPECIALS[name]({ state: t.state, showFieldMessage: () => () => true } as unknown as SpecialEnv);

beforeEach(() => {
  t.state.party = [make('PIDGEY'), make('RATTATA')];
  leave(null, null);
  t.state.trainerId = 12345;
  t.state.playerName = 'RED';
  t.state.currentMapSection = 'MAPSEC_FOUR_ISLAND';
  t.state.setFlag('FLAG_PENDING_DAYCARE_EGG', false);
});

test('GetEggSpecies: back to the first stage', () => {
  expect(getEggSpecies(t.state, sp('CHARIZARD'))).toBe(sp('CHARMANDER'));
  expect(getEggSpecies(t.state, sp('CHARMANDER'))).toBe(sp('CHARMANDER'));
  expect(getEggSpecies(t.state, sp('RAICHU'))).toBe(sp('PICHU')); // Pichu → Pikachu → Raichu
  expect(getEggSpecies(t.state, sp('NIDOKING'))).toBe(sp('NIDORAN_M'));
  expect(getEggSpecies(t.state, sp('NIDOQUEEN'))).toBe(sp('NIDORAN_F'));
  expect(getEggSpecies(t.state, sp('WOBBUFFET'))).toBe(sp('WYNAUT'));
  expect(getEggSpecies(t.state, sp('MARILL'))).toBe(sp('AZURILL'));
  expect(getEggSpecies(t.state, sp('DITTO'))).toBe(sp('DITTO'));
});

test('the egg species: the mother\'s first stage; a male egg makes Nidoran♂ / Volbeat', () => {
  leave(make('NIDOKING', { personality: MALE }), make('NIDOQUEEN', { personality: FEMALE }));
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)).toEqual([sp('NIDORAN_F'), [1, 0]]);
  t.state.daycare.offspringPersonality = 0x8001; // EGG_GENDER_MALE
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)[0]).toBe(sp('NIDORAN_M'));

  leave(make('ILLUMISE', { personality: FEMALE }), make('VOLBEAT', { personality: MALE }));
  t.state.daycare.offspringPersonality = 0x1234;
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)).toEqual([sp('ILLUMISE'), [0, 1]]);
  t.state.daycare.offspringPersonality = 0x9234;
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)[0]).toBe(sp('VOLBEAT'));
});

test('the egg species with Ditto: its partner\'s first stage; Ditto is the "mother" of a male or genderless mon', () => {
  leave(make('DITTO'), make('CHARIZARD', { personality: MALE }));
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)).toEqual([sp('CHARMANDER'), [0, 1]]);
  leave(make('CHARMELEON', { personality: FEMALE }), make('DITTO'));
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)).toEqual([sp('CHARMANDER'), [0, 1]]);
  leave(make('STARMIE'), make('DITTO')); // genderless
  expect(determineEggSpeciesAndParentSlots(t.state, t.state.daycare)).toEqual([sp('STARYU'), [1, 0]]);
});

test('incense: Wynaut / Azurill only when a parent holds Lax / Sea Incense', () => {
  leave(make('WOBBUFFET'), make('DITTO'));
  expect(alterEggSpeciesWithIncenseItem(t.state, sp('WYNAUT'), t.state.daycare)).toBe(sp('WOBBUFFET'));
  leave(make('WOBBUFFET'), make('DITTO', { item: 'LAX_INCENSE' }));
  expect(alterEggSpeciesWithIncenseItem(t.state, sp('WYNAUT'), t.state.daycare)).toBe(sp('WYNAUT'));
  leave(make('MARILL', { item: 'LAX_INCENSE' }), make('DITTO'));
  expect(alterEggSpeciesWithIncenseItem(t.state, sp('AZURILL'), t.state.daycare)).toBe(sp('MARILL'));
  leave(make('MARILL', { item: 'SEA_INCENSE' }), make('DITTO'));
  expect(alterEggSpeciesWithIncenseItem(t.state, sp('AZURILL'), t.state.daycare)).toBe(sp('AZURILL'));
  expect(alterEggSpeciesWithIncenseItem(t.state, sp('CHARMANDER'), t.state.daycare)).toBe(sp('CHARMANDER'));
});

test('GetDaycareCompatibilityScore and SetDaycareCompatibilityString', () => {
  const score = (a: Pokemon, b: Pokemon) => {
    leave(a, b);
    return getDaycareCompatibilityScore(t.state, t.state.daycare);
  };
  const other = 54321;
  // same species: different trainers 70, same trainer 50
  expect(score(make('RATTATA', { personality: MALE, otId: other }), make('RATTATA', { personality: FEMALE }))).toBe(70);
  expect(score(make('RATTATA', { personality: MALE }), make('RATTATA', { personality: FEMALE }))).toBe(50);
  // different species sharing the Field group: different trainers 50, same trainer 20
  expect(score(make('RATTATA', { personality: MALE, otId: other }), make('PIKACHU', { personality: FEMALE }))).toBe(50);
  expect(score(make('RATTATA', { personality: MALE }), make('PIKACHU', { personality: FEMALE }))).toBe(20);
  // same gender, no shared group, an Undiscovered baby, two genderless mons: 0
  expect(score(make('RATTATA', { personality: MALE }), make('RATTATA', { personality: MALE }))).toBe(0);
  expect(score(make('RATTATA', { personality: MALE }), make('PIDGEY', { personality: FEMALE }))).toBe(0);
  expect(score(make('PICHU', { personality: MALE }), make('PIKACHU', { personality: FEMALE }))).toBe(0);
  expect(score(make('MAGNEMITE'), make('VOLTORB'))).toBe(0);
  // Ditto: same trainer 20, different 50 (genderless partners too); two Ditto 0; Ditto with a legendary 0
  expect(score(make('DITTO'), make('MAGNEMITE'))).toBe(20);
  expect(score(make('DITTO', { otId: other }), make('PIDGEY'))).toBe(50);
  expect(score(make('DITTO'), make('DITTO', { otId: other }))).toBe(0);
  expect(score(make('DITTO'), make('MEWTWO'))).toBe(0);

  const strings = readGen<Record<string, string>>('text/strings.json');
  const message = (label: string) => expect(gStringVar4).toEqual(t.charmap.encode(strings[label]));
  leave(make('RATTATA', { personality: MALE, otId: other }), make('RATTATA', { personality: FEMALE }));
  run('SetDaycareCompatibilityString');
  message('gDaycareText_GetAlongVeryWell'); // 70
  leave(make('RATTATA', { personality: MALE }), make('RATTATA', { personality: FEMALE }));
  run('SetDaycareCompatibilityString');
  message('gDaycareText_GetAlong'); // 50
  leave(make('RATTATA', { personality: MALE }), make('PIKACHU', { personality: FEMALE }));
  run('SetDaycareCompatibilityString');
  message('gDaycareText_DontLikeOther'); // 20
  leave(make('RATTATA', { personality: MALE }), make('PIDGEY', { personality: FEMALE }));
  run('SetDaycareCompatibilityString');
  message('gDaycareText_PlayOther'); // 0
});

test('InheritIVs, seeded: three picks (the C\'s RemoveIVIndexFromList can pick a stat twice), each from a random parent', () => {
  const ivs = (base: number) => ({ hp: base, attack: base + 1, defense: base + 2, speed: base + 3, spAttack: base + 4, spDefense: base + 5 });
  const mother = make('RATTATA', { personality: FEMALE });
  mother.ivs = ivs(10);
  const father = make('RATTATA', { personality: MALE });
  father.ivs = ivs(20);
  leave(mother, father);
  const egg = make('RATTATA');
  egg.ivs = ivs(0);

  // Seed 1234: Random() = 3558, 7498, 45192 (picks), 36097, 23984, 7916 (parents).
  // 3558 % 6 = 0 → HP; the list is [1, 2, 3, 4, 5, 5]. 7498 % 5 = 3 → stat 4 (Sp. Atk), but entry 4 is cleared:
  // still [1, 2, 3, 4, 5, 5]. 45192 % 4 = 0 → stat 1 (Attack). Parents: 1, 0, 0.
  seedRng(1234);
  inheritIVs(t.state, egg, t.state.daycare);
  expect(egg.ivs).toEqual({ hp: 20, attack: 11, defense: 2, speed: 3, spAttack: 14, spDefense: 5 });

  // Seed 29: Random() = 29559, 62953, 57519, 10349, 16263, 58050. 29559 % 6 = 3 → Speed; [0, 1, 2, 4, 5, 5].
  // 62953 % 5 = 3 → Sp. Atk (4); entry 4 cleared: [0, 1, 2, 4, 5, 5]. 57519 % 4 = 3 → Sp. Atk again.
  // Parents 1, 1, 0: Speed from the father, Sp. Atk from the father then the mother.
  egg.ivs = ivs(0);
  seedRng(29);
  inheritIVs(t.state, egg, t.state.daycare);
  expect(egg.ivs).toEqual({ hp: 0, attack: 1, defense: 2, speed: 23, spAttack: 14, spDefense: 5 });
});

test('GetEggMoves reads gEggMoves', () => {
  expect(getEggMoves(t.state, sp('BULBASAUR'))).toEqual(
    ['LIGHT_SCREEN', 'SKULL_BASH', 'SAFEGUARD', 'CHARM', 'PETAL_DANCE', 'MAGICAL_LEAF', 'GRASS_WHISTLE', 'CURSE'].map(mv),
  );
  expect(getEggMoves(t.state, sp('CHIMECHO'))).toEqual(['DISABLE', 'CURSE', 'HYPNOSIS', 'DREAM_EATER'].map(mv)); // the last block
  expect(getEggMoves(t.state, sp('IVYSAUR'))).toEqual([]);
  expect(getEggMoves(t.state, sp('DITTO'))).toEqual([]);
});

test('BuildEggMoveset: the father\'s egg moves, then his TM/HM moves, then level-up moves both parents know', () => {
  // A level-5 Charmander knows Scratch and Growl. Father: Bite (egg move), Dragon Claw (TM02), Flamethrower
  // (TM35), Slash (level up); the mother knows Slash too.
  const egg = make('CHARMANDER', { level: 5 });
  expect(egg.moves).toEqual(['SCRATCH', 'GROWL'].map(mv).concat([0, 0]));
  const father = box(make('CHARIZARD', { moves: ['BITE', 'DRAGON_CLAW', 'FLAMETHROWER', 'SLASH'] }));
  const mother = box(make('CHARMELEON', { personality: FEMALE, moves: ['EMBER', 'SLASH'] }));
  buildEggMoveset(t.state, egg, father, mother);
  // Bite and Dragon Claw fill the slots, Flamethrower pushes Scratch out, Slash pushes Growl out.
  expect(egg.moves).toEqual(['BITE', 'DRAGON_CLAW', 'FLAMETHROWER', 'SLASH'].map(mv));
  expect(egg.pp).toEqual(egg.moves.map((m) => t.pokemon.moves[m].pp));

  // A move only the mother knows, and a TM the species can't learn (Surf), aren't passed on.
  const egg2 = make('CHARMANDER', { level: 5 });
  buildEggMoveset(t.state, egg2, box(make('CHARIZARD', { moves: ['SURF', 'EMBER'] })), box(make('CHARMELEON', { personality: FEMALE, moves: ['BITE'] })));
  expect(egg2.moves).toEqual(['SCRATCH', 'GROWL'].map(mv).concat([0, 0]));
});

test('GiveEggFromDaycare: the egg joins the party and the pending egg is cleared', () => {
  leave(make('CHARIZARD', { personality: MALE, moves: ['BITE'] }), make('CHARMELEON', { personality: FEMALE }));
  t.state.daycare.offspringPersonality = 0x1234;
  t.state.daycare.stepCounter = 99;
  seedRng(7);
  const r0 = random();
  seedRng(7);
  run('GiveEggFromDaycare');
  expect(t.state.party).toHaveLength(3);
  const egg = t.state.party[2];
  expect(egg).toMatchObject({ species: sp('CHARMANDER'), isEgg: true, metLevel: 0, pokeball: t.d('ITEM_POKE_BALL'), otId: 12345, otName: 'RED' });
  expect(egg.personality).toBe((0x1234 | (r0 << 16)) >>> 0); // SetInitialEggData
  expect(egg.friendship).toBe(t.pokemon.species[sp('CHARMANDER')].eggCycles);
  expect(egg.nickname).toEqual(t.charmap.encodePlain('タマゴ')); // sJapaneseEggNickname
  expect(egg.metLocation).toBe('MAPSEC_FOUR_ISLAND');
  expect(egg.moves).toEqual(['SCRATCH', 'GROWL', 'BITE'].map(mv).concat([0]));
  expect(t.state.daycare).toMatchObject({ offspringPersonality: 0, stepCounter: 0 });
  expect(t.state.daycare.mons.every((m) => m.mon !== null)).toBe(true);
});

test('steps: an egg comes when the second mon\'s steps reach 0xFF (mod 256) and the roll is under the score', () => {
  // Incompatible: never.
  leave(make('RATTATA', { personality: MALE }), make('PIDGEY', { personality: FEMALE }));
  for (let i = 0; i < 1024; i++) shouldEggHatch(t.state);
  expect(t.state.daycare.offspringPersonality).toBe(0);
  expect(t.state.daycare.mons[1].steps).toBe(1024);

  // The roll: TriggerPendingDaycareEgg when score > Random() * 100 / 0xFFFF. Seed 2: Random() = 33676 (roll 51),
  // then 28355 (the personality: 28355 % 0xFFFE + 1 = 28356). Seed 3: 50515 (roll 77).
  const steps = (score: 'max' | 'med', seed: number) => {
    leave(make('RATTATA', { personality: MALE, otId: score === 'max' ? 1 : 12345 }), make('RATTATA', { personality: FEMALE }));
    t.state.daycare.mons[1].steps = 253;
    t.state.setFlag('FLAG_PENDING_DAYCARE_EGG', false);
    seedRng(seed);
    shouldEggHatch(t.state); // 254: no roll
    expect(random()).toBe(seedRandom(seed)); // nothing was drawn
    seedRng(seed);
    t.state.daycare.mons[1].steps = 254;
    shouldEggHatch(t.state); // 255: the roll
    return t.state.daycare.offspringPersonality;
  };
  expect(steps('max', 2)).toBe(28356);
  expect(t.state.getFlag('FLAG_PENDING_DAYCARE_EGG')).toBe(true);
  expect(run('GetDaycareState')).toBe(t.d('DAYCARE_EGG_WAITING'));
  expect(steps('med', 2)).toBe(0); // 50 > 51 fails
  expect(t.state.getFlag('FLAG_PENDING_DAYCARE_EGG')).toBe(false);
  expect(steps('max', 3)).toBe(0); // 70 > 77 fails
  // A pending egg stops further rolls.
  t.state.daycare.offspringPersonality = 5;
  t.state.daycare.mons[1].steps = 254;
  seedRng(2);
  shouldEggHatch(t.state);
  expect(t.state.daycare.offspringPersonality).toBe(5);
});

/** The first Random() after seedRng(seed). */
function seedRandom(seed: number): number {
  return ((Math.imul(1103515245, seed) + 24691) >>> 0) >>> 16;
}

test('the Four Island specials: store, state, nicknames, levels, cost, take back', () => {
  const rattata = make('RATTATA', { personality: MALE, level: 5 });
  rattata.nickname = t.charmap.encodePlain('RATTY');
  t.state.party = [make('PIDGEY'), rattata, make('SPEAROW', { personality: FEMALE, level: 5 })];
  expect(run('GetDaycareState')).toBe(t.d('DAYCARE_NO_MONS'));
  gPartyMenu.slotId = 1;
  run('StoreSelectedPokemonInDaycare');
  expect(run('GetDaycareState')).toBe(t.d('DAYCARE_ONE_MON'));
  expect(run('GetDaycarePokemonCount')).toBe(1);
  gPartyMenu.slotId = 1; // SPEAROW moved up
  run('StoreSelectedPokemonInDaycare');
  expect(run('GetDaycareState')).toBe(t.d('DAYCARE_TWO_MONS'));
  expect(t.state.party.map((m) => m.species)).toEqual([sp('PIDGEY')]);
  run('GetDaycareMonNicknames');
  expect([str(0), str(1), str(2)]).toEqual(['RATTY', 'SPEAROW', 'RED']);

  // Rattata (medium fast, 125 exp) with 91 steps: 216 = level 6. Spearow (medium fast too) with 10: none.
  t.state.daycare.mons[0].steps = 91;
  t.state.daycare.mons[1].steps = 10;
  t.state.setVar('VAR_0x8004', 0);
  expect(run('GetNumLevelsGainedFromDaycare')).toBe(1);
  expect([str(0), str(1)]).toEqual(['RATTY', '1']);
  run('GetDaycareCost');
  expect(t.state.getVar('VAR_0x8005')).toBe(200);
  expect(str(1)).toBe('200');
  t.state.setVar('VAR_0x8004', 1);
  expect(run('GetNumLevelsGainedFromDaycare')).toBe(0);
  run('GetDaycareCost');
  expect(t.state.getVar('VAR_0x8005')).toBe(100);

  // Take the first back: the second moves up to slot 0 with its steps.
  t.state.setVar('VAR_0x8004', 0);
  expect(run('TakePokemonFromDaycare')).toBe(sp('RATTATA'));
  expect(t.state.party.map((m) => [m.species, m.level])).toEqual([[sp('PIDGEY'), 30], [sp('RATTATA'), 6]]);
  expect(t.state.daycare.mons.map((m) => [m.mon?.species ?? 0, m.steps])).toEqual([[sp('SPEAROW'), 10], [0, 0]]);
  expect(run('GetDaycareState')).toBe(t.d('DAYCARE_ONE_MON'));
});

test('RejectEggFromDayCare clears the pending egg and the step counter', () => {
  t.state.daycare.offspringPersonality = 77;
  t.state.daycare.stepCounter = 12;
  run('RejectEggFromDayCare');
  expect(t.state.daycare).toMatchObject({ offspringPersonality: 0, stepCounter: 0 });
});

test('NameHasGenderSymbol / AppendGenderSymbol', () => {
  const enc = (s: string) => t.charmap.encodePlain(s);
  const MALE_ = t.d('MON_MALE');
  const FEMALE_ = t.d('MON_FEMALE');
  expect(nameHasGenderSymbol(t.state, enc('NIDORAN♂'), MALE_)).toBe(true);
  expect(nameHasGenderSymbol(t.state, enc('NIDORAN♂'), FEMALE_)).toBe(false);
  expect(nameHasGenderSymbol(t.state, enc('A♂♀'), MALE_)).toBe(false);
  expect(t.charmap.decodePlain(appendGenderSymbol(t.state, enc('PIDGEY'), MALE_))).toBe('PIDGEY♂');
  expect(t.charmap.decodePlain(appendGenderSymbol(t.state, enc('PIDGEY'), FEMALE_))).toBe('PIDGEY♀');
  // A name that already has its symbol gets gText_GenderlessSymbol (nothing), as does a genderless mon.
  expect(t.charmap.decodePlain(appendGenderSymbol(t.state, enc('NIDORAN♀'), FEMALE_))).toBe('NIDORAN♀');
  expect(t.charmap.decodePlain(appendGenderSymbol(t.state, enc('STARYU'), t.d('MON_GENDERLESS')))).toBe('STARYU');
});

test('ScriptGiveEgg: an egg met as a gift, to the party or the PC', () => {
  expect(scriptGiveEgg(t.state, sp('TOGEPI'))).toBe(t.d('MON_GIVEN_TO_PARTY'));
  const egg = t.state.party[2];
  expect(egg).toMatchObject({ species: sp('TOGEPI'), isEgg: true, metLevel: 0, level: 5, metLocation: 'METLOC_SPECIAL_EGG', otId: 12345 });
  expect(egg.friendship).toBe(t.pokemon.species[sp('TOGEPI')].eggCycles);
  expect(egg.moves).toEqual(['GROWL', 'CHARM', 'METRONOME'].map(mv).concat([0])); // level 5: Metronome comes at 4
  while (t.state.party.length < 6) t.state.party.push(make('PIDGEY'));
  expect(scriptGiveEgg(t.state, sp('TOGEPI'))).toBe(t.d('MON_GIVEN_TO_PC'));
});
