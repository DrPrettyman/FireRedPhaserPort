import { beforeEach, describe, expect, test } from 'vitest';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import { clearSave, fromSaveData, hasSave, readSave, SAVE_STORAGE_KEY, SAVE_VERSION, toSaveData, writeSave } from '../../src/state/saveData';
import { boxMonFromMon as boxMon } from '../../src/state/PokemonStorage';
import { newGame, type TestGame } from './gameData';
import { emptyQuestLogObjectEvent } from '../../src/world/questLogObjects';

let t: TestGame;
const mon = (name: string, level: number): Pokemon =>
  t.pokemon.createMon(t.d(`SPECIES_${name}`), level, { otId: t.state.trainerId, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_ROUTE_1' });

/** A state far from a new game: something in every field the save holds. */
function playedState(): TestGame['state'] {
  const s = t.state;
  s.playerName = 'RED';
  s.rivalName = 'BLUE';
  s.playerGender = 'female';
  s.trainerId = 0xfedcba98;
  Object.assign(s.playTime, { hours: 12, minutes: 34, seconds: 56, vblanks: 7 });
  s.textSpeed = 'fast';
  s.optionsWindowFrameType = 5;
  s.optionsButtonMode = 2;
  s.optionsSound = 1;
  s.battleStyleSet = true;
  s.battleSceneOff = true;
  s.setDexFlags(1, true, true);
  s.setDexFlags(150, true, false);
  s.nationalDexEnabled = true;
  s.specialSaveWarpFlags = 1 | (1 << 7); // CONTINUE_GAME_WARP | CHAMPION_SAVEWARP
  s.gcnLinkFlags = 0x803f; // SetUnlockedPokedexFlags + SetPostgameFlags
  s.location = { mapId: 'MAP_VIRIDIAN_CITY', x: 21, y: 9, facing: 'left', avatarFlags: t.d('PLAYER_AVATAR_FLAG_MACH_BIKE') };
  s.continueGameWarp = { mapId: 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F', warpId: 255, x: 7, y: 4 };
  s.dynamicWarp = { mapId: 'MAP_CELADON_CITY_DEPARTMENT_STORE_2F', warpId: 2, x: 1, y: 2 };
  s.lastHealLocation = { map: 'MAP_VIRIDIAN_CITY', x: 26, y: 27 };
  s.escapeWarp = { mapId: 'MAP_ROUTE2', warpId: 255, x: 3, y: 4 };
  // SaveObjectEvents / the current map's templates / SaveMapView (version 14)
  s.objectEvents = [
    { ...emptyQuestLogObjectEvent(), active: 1, localId: 2, mapGroup: 3, mapNum: 1, x: 30, y: 16, facingDirection: 3, movementType: 7, invisible: 1 },
    { ...emptyQuestLogObjectEvent(), active: 1, localId: 5, mapGroup: 3, mapNum: 1, x: 12, y: 20, facingDirection: 1, facingDirectionLocked: 1 },
  ];
  s.objectEventTemplates = [
    { local_id: 'LOCALID_X', type: 'object', graphics_id: 'OBJ_EVENT_GFX_BOY', x: 23, y: -1, elevation: 3, movement_type: 'MOVEMENT_TYPE_WANDER_AROUND', movement_range_x: 1, movement_range_y: 2, trainer_type: 'TRAINER_TYPE_NONE', trainer_sight_or_berry_tree_id: '0', flag: '0' },
  ];
  s.mapView = Array.from({ length: 15 * 14 }, (_, i) => (i * 37) & 0xffff);
  const pidgey = mon('PIDGEY', 12);
  pidgey.hp = 3;
  pidgey.status = t.d('STATUS1_PARALYSIS');
  pidgey.heldItem = t.d('ITEM_ORAN_BERRY');
  pidgey.pokerus = 0x13;
  pidgey.evs.speed = 40;
  pidgey.ppBonuses = 0b11;
  pidgey.nickname = t.charmap.encodePlain('BIRDY');
  s.party = [mon('BULBASAUR', 16), pidgey, { ...mon('RATTATA', 3), isEgg: true }];
  s.money = 123456;
  s.coins = 789;
  s.registeredItem = t.d('ITEM_BICYCLE');
  s.flashLevel = 4;
  s.savedMusic = s.defines.require('MUS_CYCLING');
  s.weather = s.defines.require('WEATHER_SHADE');
  s.towerChallengeId = 2;
  Object.assign(s.trainerTower[2], { timer: 4321, bestTime: 9000, floorsCleared: 3, unk9: 1, spokeToOwner: true, validated: true });
  s.pcItems[0] = { itemId: t.d('ITEM_POTION'), quantity: 1 };
  s.bag.add(t.d('ITEM_POTION'), 5);
  s.bag.add(t.d('ITEM_ANTIDOTE'), 2);
  s.bag.add(t.d('ITEM_POKE_BALL'), 10);
  s.bag.add(t.d('ITEM_TM01'), 1);
  s.bag.add(t.d('ITEM_ORAN_BERRY'), 3);
  s.bag.remove(t.d('ITEM_POTION'), 5); // leaves a gap before the Antidote
  s.trainerRematchStepCounter = 0x1234;
  s.trainerRematches = [0, 1, 0, 1];
  s.setFlag('FLAG_SYS_POKEDEX_GET');
  s.setFlag('FLAG_BADGE01_GET');
  s.setVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB', 3);
  s.setVar('VAR_TEMP_1', 9); // a temp var is still in gSaveBlock1Ptr->vars
  s.daycare.stepCounter = 77;
  s.daycare.mons[1] = { mon: boxMon(mon('DITTO', 30)), steps: 0x12345 };
  s.daycare.offspringPersonality = 0xbeef;
  s.route5DayCareMon = { mon: boxMon({ ...mon('ODDISH', 20), nickname: t.charmap.encodePlain('ODDY') }), steps: 4321 };
  s.roamer = { ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 }, personality: 0x89abcdef, species: t.d('SPECIES_ENTEI'), hp: 100, level: 50, status: 0, active: true };
  s.easyChatProfile = [t.d('EC_WORD_MYSTERY'), t.d('EC_WORD_EVENT'), t.d('EC_WORD_IS'), t.d('EC_WORD_EXCITING'), 0, 0];
  s.easyChatBattleWon[2] = t.d('EC_WORD_EXCL');
  s.questionnaireWords = [t.d('EC_WORD_LINK'), t.d('EC_WORD_TOGETHER'), t.d('EC_WORD_WITH'), t.d('EC_WORD_ALL')];
  s.additionalPhrases[4] = 0x01; // trendy saying 32
  const st = s.storage;
  st.setCurrentBox(3);
  st.setBoxMonAt(0, 0, mon('CATERPIE', 4));
  st.setBoxMonAt(3, 29, mon('MEWTWO', 70));
  st.setBoxMonAt(13, 15, { ...mon('PIKACHU', 9), pokerus: 0x20 });
  st.setBoxName(3, t.charmap.encodePlain('LEGENDS'));
  st.setBoxWallpaper(13, 15);
  return s;
}

beforeEach(() => {
  t = newGame();
});

describe('save data (save.c / load_save.c)', () => {
  test('round trip: save → JSON → load into a new game → save gives the same file', () => {
    const before = toSaveData(playedState());
    const json = JSON.stringify(before);
    const loaded = fromSaveData(JSON.parse(json), newGame().state);
    expect(JSON.stringify(toSaveData(loaded))).toBe(json);
  });

  test('a loaded state matches the one saved', () => {
    const s = playedState();
    const fresh = newGame().state;
    const loaded = fromSaveData(JSON.parse(JSON.stringify(toSaveData(s))), fresh);
    expect(loaded.party).toEqual(s.party);
    expect(loaded.storage.boxes).toEqual(s.storage.boxes);
    expect(loaded.storage.getCurrentBox()).toBe(3);
    expect(loaded.storage.boxNames).toEqual(s.storage.boxNames);
    expect(loaded.storage.boxWallpapers).toEqual(s.storage.boxWallpapers);
    expect(loaded.bag.pockets).toEqual(s.bag.pockets);
    expect(loaded.pcItems).toEqual(s.pcItems);
    expect(loaded.flagIds()).toEqual(s.flagIds());
    expect(loaded.getVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB')).toBe(3);
    expect(loaded.getVar('VAR_TEMP_1')).toBe(9);
    expect([...loaded.dexSeen].sort()).toEqual([1, 150]);
    expect([...loaded.dexCaught]).toEqual([1]);
    expect(loaded).toMatchObject({
      playerName: 'RED',
      rivalName: 'BLUE',
      playerGender: 'female',
      trainerId: 0xfedcba98,
      playTime: s.playTime,
      textSpeed: 'fast',
      optionsWindowFrameType: 5,
      optionsButtonMode: 2,
      optionsSound: 1,
      battleStyleSet: true,
      battleSceneOff: true,
      nationalDexEnabled: true,
      specialSaveWarpFlags: 0x81,
      gcnLinkFlags: 0x803f,
      location: s.location,
      continueGameWarp: s.continueGameWarp,
      dynamicWarp: s.dynamicWarp,
      lastHealLocation: s.lastHealLocation,
      escapeWarp: s.escapeWarp,
      objectEvents: s.objectEvents,
      objectEventTemplates: s.objectEventTemplates,
      mapView: s.mapView,
      money: 123456,
      coins: 789,
      registeredItem: s.registeredItem,
      flashLevel: 4,
      savedMusic: s.savedMusic,
      weather: s.weather,
      trainerRematchStepCounter: 0x1234,
      trainerRematches: [0, 1, 0, 1],
      daycare: s.daycare,
      route5DayCareMon: s.route5DayCareMon,
      roamer: s.roamer,
      easyChatProfile: s.easyChatProfile,
      easyChatBattleStart: s.easyChatBattleStart,
      easyChatBattleWon: s.easyChatBattleWon,
      easyChatBattleLost: s.easyChatBattleLost,
      questionnaireWords: s.questionnaireWords,
      additionalPhrases: [0, 0, 0, 0, 1],
      towerChallengeId: 2,
      trainerTower: s.trainerTower,
    });
    // The loaded state shares nothing with the save it came from.
    loaded.party[0].moves[0] = 0;
    expect(s.party[0].moves[0]).not.toBe(0);
  });

  test('a new game round-trips too, and the new-game flags are replaced, not merged', () => {
    const blank = toSaveData(t.state);
    expect(blank).not.toHaveProperty('location');
    const s = playedState();
    s.setFlag('FLAG_HIDE_OAK_IN_HIS_LAB', false);
    const loaded = fromSaveData(toSaveData(s), newGame().state);
    expect(loaded.getFlag('FLAG_HIDE_OAK_IN_HIS_LAB')).toBe(false);
    expect(JSON.stringify(toSaveData(fromSaveData(JSON.parse(JSON.stringify(blank)), newGame().state)))).toBe(JSON.stringify(blank));
  });

  test("special vars and special flags aren't saved (they're EWRAM on the GBA)", () => {
    const s = t.state;
    s.setVar('VAR_0x8004', 5);
    s.setVar('VAR_RESULT', 1);
    s.setFlag(t.d('SPECIAL_FLAGS_START'));
    const data = toSaveData(s);
    expect(data.vars.every(([v]) => v >= t.d('VARS_START') && v <= t.d('VARS_END'))).toBe(true);
    expect(data.flags.every((f) => f < t.d('SPECIAL_FLAGS_START'))).toBe(true);
    const loaded = fromSaveData(data, newGame().state);
    expect(loaded.getVar('VAR_0x8004')).toBe(0);
  });

  test("a version 13 save (no objects, templates or map view) loads without them: CONTINUE spawns from the header", () => {
    const { objectEvents: _o, objectEventTemplates: _t, mapView: _v, ...v13 } = { ...toSaveData(playedState()), version: 13 };
    const loaded = fromSaveData(v13, newGame().state);
    expect(loaded.objectEvents).toBeUndefined();
    expect(loaded.objectEventTemplates).toBeUndefined();
    expect(loaded.mapView).toBeUndefined();
    expect(loaded.location).toEqual(t.state.location);
    expect(toSaveData(loaded)).not.toHaveProperty('objectEvents');
  });

  test('the saved objects, templates and map view are copies', () => {
    const s = playedState();
    const data = toSaveData(s);
    s.objectEvents![0].x = 99;
    s.objectEventTemplates![0].x = 99;
    s.mapView![0] = 99;
    expect([data.objectEvents![0].x, data.objectEventTemplates![0].x, data.mapView![0]]).toEqual([30, 23, 0]);
    const loaded = fromSaveData(data, newGame().state);
    data.objectEvents![1].y = 1;
    expect(loaded.objectEvents![1].y).toBe(20);
  });

  test('a version 8 save (no gcnLinkFlags) loads with none set', () => {
    const { gcnLinkFlags: _gcn, ...v8 } = { ...toSaveData(playedState()), version: 8 };
    const loaded = fromSaveData(v8 as ReturnType<typeof toSaveData>, newGame().state);
    expect(loaded.gcnLinkFlags).toBe(0);
    expect(loaded.specialSaveWarpFlags).toBe(0x81);
    expect(loaded.money).toBe(123456);
  });

  test('a version 7 save (no Trainer Tower records) loads with the new-game records', () => {
    const { trainerTower: _tower, ...v7 } = { ...toSaveData(playedState()), version: 7 };
    const loaded = fromSaveData(v7, newGame().state);
    expect(loaded.towerChallengeId).toBe(0);
    expect(loaded.trainerTower).toEqual(newGame().state.trainerTower);
    expect(loaded.trainerTower.every((r) => r.bestTime === t.d('TRAINER_TOWER_MAX_TIME'))).toBe(true);
    expect(loaded.money).toBe(123456);
  });

  test('a version-6 save (no saved weather) loads with WEATHER_NONE', () => {
    const { weather: _weather, ...v6 } = { ...toSaveData(t.state), version: 6 };
    const loaded = fromSaveData(v6 as ReturnType<typeof toSaveData>, newGame().state);
    expect(loaded.weather).toBe(t.d('WEATHER_NONE'));
    expect(loaded.savedMusic).toBe(t.state.savedMusic);
  });

  test('a save of another version is refused', () => {
    const data = { ...toSaveData(t.state), version: SAVE_VERSION + 1 };
    expect(() => fromSaveData(data, newGame().state)).toThrow(/version/);
  });
});

describe('the save slot (localStorage)', () => {
  /** A Storage backed by a Map. */
  const memoryStorage = (): Storage => {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, String(v)),
    };
  };

  test('write, read, has and clear', () => {
    const storage = memoryStorage();
    expect(hasSave(storage)).toBe(false);
    expect(readSave(storage)).toBeUndefined();
    const data = toSaveData(playedState());
    expect(writeSave(data, storage)).toBe(true);
    expect(hasSave(storage)).toBe(true);
    expect(readSave(storage)).toEqual(JSON.parse(JSON.stringify(data)));
    clearSave(storage);
    expect(hasSave(storage)).toBe(false);
  });

  test('an unreadable or other-version save reads as none; no storage fails the write', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_STORAGE_KEY, '{not json');
    expect(readSave(storage)).toBeUndefined();
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify({ version: 0 }));
    expect(hasSave(storage)).toBe(false);
    expect(writeSave(toSaveData(t.state), undefined)).toBe(false);
  });
});
