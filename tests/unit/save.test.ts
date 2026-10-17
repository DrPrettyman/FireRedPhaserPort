import { beforeEach, describe, expect, test } from 'vitest';
import {
  CONTINUE_GAME_WARP,
  ClearContinueGameWarpStatus,
  gSave,
  LoadGameSave,
  SAVE_HALL_OF_FAME,
  SAVE_NORMAL,
  SAVE_OVERWRITE_DIFFERENT_FILE,
  SAVE_STATUS_EMPTY,
  SAVE_STATUS_ERROR,
  SAVE_STATUS_INVALID,
  SAVE_STATUS_OK,
  SetContinueGameWarpStatusToDynamicWarp,
  TrySavingData,
  UseContinueGameWarp,
} from '../../src/state/save';
import { fromSaveData, readSave, SAVE_STORAGE_KEY, SAVE_VERSION, toSaveData } from '../../src/state/saveData';
import { ClearHofBuffer, emptyHofTeam, gHofBuffer, HOF_STORAGE_KEY, LoadHallOfFameSave } from '../../src/state/hallOfFame';
import { countBadges, GetKantoPokedexCount, GetNationalPokedexCount, saveDataView, SaveStatToString } from '../../src/ui/saveMenuUtil';
import { newGame, type TestGame } from './gameData';

let t: TestGame;
beforeEach(() => {
  t = newGame();
});

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

test("save.c's constants match the decomp's", () => {
  expect(SAVE_STATUS_EMPTY).toBe(t.d('SAVE_STATUS_EMPTY'));
  expect(SAVE_STATUS_OK).toBe(t.d('SAVE_STATUS_OK'));
  expect(SAVE_STATUS_INVALID).toBe(t.d('SAVE_STATUS_INVALID'));
  expect(SAVE_STATUS_ERROR).toBe(t.d('SAVE_STATUS_ERROR'));
  expect(SAVE_NORMAL).toBe(t.d('SAVE_NORMAL'));
  expect(SAVE_OVERWRITE_DIFFERENT_FILE).toBe(t.d('SAVE_OVERWRITE_DIFFERENT_FILE'));
  expect(SAVE_HALL_OF_FAME).toBe(t.d('SAVE_HALL_OF_FAME'));
  expect(CONTINUE_GAME_WARP).toBe(t.d('CONTINUE_GAME_WARP'));
});

describe('LoadGameSave / TrySavingData', () => {
  test('empty, then OK once saved; something unreadable is INVALID', () => {
    const storage = memoryStorage();
    expect(LoadGameSave(storage)).toBeUndefined();
    expect(gSave.fileStatus).toBe(SAVE_STATUS_EMPTY);

    t.state.money = 4321;
    expect(TrySavingData(SAVE_NORMAL, t.state, storage)).toBe(SAVE_STATUS_OK);
    expect(gSave.attemptStatus).toBe(SAVE_STATUS_OK);
    expect(LoadGameSave(storage)?.money).toBe(4321);
    expect(gSave.fileStatus).toBe(SAVE_STATUS_OK);

    storage.setItem(SAVE_STORAGE_KEY, '{"version":0}');
    expect(LoadGameSave(storage)).toBeUndefined();
    expect(gSave.fileStatus).toBe(SAVE_STATUS_INVALID);
  });

  test('a failed write is SAVE_STATUS_ERROR', () => {
    const full: Storage = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(TrySavingData(SAVE_NORMAL, t.state, full)).toBe(SAVE_STATUS_ERROR);
    expect(gSave.attemptStatus).toBe(SAVE_STATUS_ERROR);
  });
});

test('the continue-game warp flag (load_save.c)', () => {
  const s = t.state;
  expect(UseContinueGameWarp(s)).toBe(false);
  s.dynamicWarp = { mapId: 'MAP_SILPH_CO_1F', warpId: 2, x: 3, y: 4 };
  SetContinueGameWarpStatusToDynamicWarp(s);
  expect(UseContinueGameWarp(s)).toBe(true);
  expect(s.continueGameWarp).toEqual(s.dynamicWarp);
  ClearContinueGameWarpStatus(s);
  expect(UseContinueGameWarp(s)).toBe(false);
});

describe('save stats (save_menu_util.c, pokedex.c)', () => {
  test('Pokédex counts: Kanto counts #1-151, national #1-386', () => {
    const s = t.state;
    for (const n of [1, 25, 151, 152, 386]) s.setDexFlags(n, true, true);
    s.setDexFlags(4, true, false);
    const caught = t.d('FLAG_GET_CAUGHT');
    const seen = t.d('FLAG_GET_SEEN');
    expect(GetKantoPokedexCount(s, caught)).toBe(3);
    expect(GetKantoPokedexCount(s, seen)).toBe(4);
    expect(GetNationalPokedexCount(s, caught)).toBe(5);
  });

  test('SaveStatToString: colour prefix, then the name, time, badges and Pokédex count', () => {
    const s = t.state;
    const d = (n: string) => t.d(n);
    const prefix = (color: number) => [d('EXT_CTRL_CODE_BEGIN'), d('EXT_CTRL_CODE_COLOR'), color, d('EXT_CTRL_CODE_BEGIN'), d('EXT_CTRL_CODE_SHADOW'), color + 1];
    const enc = (str: string) => t.charmap.encode(`${str}$`);
    s.playerName = 'RED';
    Object.assign(s.playTime, { hours: 7, minutes: 5, seconds: 59, vblanks: 0 });
    s.setFlag('FLAG_BADGE01_GET');
    s.setFlag('FLAG_BADGE03_GET');
    s.setDexFlags(1, true, true);
    s.setDexFlags(200, true, true);
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_NAME'), 2)).toEqual([...prefix(2), ...enc('RED')]);
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_TIME'), 2)).toEqual([...prefix(2), ...enc('7:05')]);
    // nBadges + CHAR_0, then 'こ' (10)
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_BADGES'), 2)).toEqual([...prefix(2), d('CHAR_0') + 2, 10, 0xff]);
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_POKEDEX'), 2)).toEqual([...prefix(2), ...enc('1')]);
    s.nationalDexEnabled = true;
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_POKEDEX'), 2)).toEqual([...prefix(2), ...enc('2')]);
    expect(SaveStatToString(s, t.charmap, d('SAVE_STAT_LOCATION'), 8, () => enc('ROUTE 1'))).toEqual([...prefix(8), ...enc('ROUTE 1')]);
  });

  test('a save file reads the same as the state it came from', () => {
    const s = t.state;
    s.playerName = 'LEAF';
    s.playerGender = 'female';
    s.setFlag('FLAG_BADGE08_GET');
    s.setDexFlags(150, true, true);
    const view = saveDataView(toSaveData(s), t.defines);
    expect(countBadges(view)).toBe(1);
    expect(view.playerGender).toBe('female');
    for (const id of ['SAVE_STAT_NAME', 'SAVE_STAT_TIME', 'SAVE_STAT_BADGES', 'SAVE_STAT_POKEDEX']) {
      expect(SaveStatToString(view, t.charmap, t.d(id), 2)).toEqual(SaveStatToString(s, t.charmap, t.d(id), 2));
    }
  });
});

describe('Hall of Fame records (SAVE_HALL_OF_FAME)', () => {
  const team = (species: number, lvl: number) => {
    const out = emptyHofTeam();
    out[0] = { tid: 0x1234abcd, personality: 0xdeadbeef, species, lvl, nick: [0xbb, 0xbc, 0xff] };
    return out;
  };

  test('never written: SAVE_STATUS_EMPTY; another version: INVALID', () => {
    const storage = memoryStorage();
    expect(LoadHallOfFameSave(storage)).toBe(SAVE_STATUS_EMPTY);
    storage.setItem(HOF_STORAGE_KEY, '{"version":99,"teams":[]}');
    expect(LoadHallOfFameSave(storage)).toBe(SAVE_STATUS_INVALID);
  });

  test('TrySavingData(SAVE_HALL_OF_FAME) writes the records and the game, counting GAME_STAT_ENTERED_HOF', () => {
    const storage = memoryStorage();
    const stat = t.d('GAME_STAT_ENTERED_HOF');
    ClearHofBuffer();
    gHofBuffer.teams[0] = team(150, 70);
    gHofBuffer.teams[1] = team(25, 42);
    expect(TrySavingData(SAVE_HALL_OF_FAME, t.state, storage)).toBe(SAVE_STATUS_OK);
    expect(t.state.getGameStat(stat)).toBe(1);
    expect(LoadGameSave(storage)?.gameStats[stat]).toBe(1);

    ClearHofBuffer();
    expect(LoadHallOfFameSave(storage)).toBe(SAVE_STATUS_OK);
    expect(gHofBuffer.teams).toHaveLength(50);
    expect(gHofBuffer.teams[0][0]).toEqual({ tid: 0x1234abcd, personality: 0xdeadbeef, species: 150, lvl: 70, nick: [0xbb, 0xbc, 0xff] });
    expect(gHofBuffer.teams[1][0].species).toBe(25);
    expect(gHofBuffer.teams[2][0].species).toBe(0); // the end of the list

    // a normal save leaves them alone; saving over another game's file erases them
    TrySavingData(SAVE_NORMAL, t.state, storage);
    expect(LoadHallOfFameSave(storage)).toBe(SAVE_STATUS_OK);
    TrySavingData(SAVE_OVERWRITE_DIFFERENT_FILE, t.state, storage);
    expect(LoadHallOfFameSave(storage)).toBe(SAVE_STATUS_EMPTY);
  });

  test('GAME_STAT_ENTERED_HOF stops at 999', () => {
    const stat = t.d('GAME_STAT_ENTERED_HOF');
    t.state.setGameStat(stat, 999);
    TrySavingData(SAVE_HALL_OF_FAME, t.state, memoryStorage());
    expect(t.state.getGameStat(stat)).toBe(999);
  });
});

test('game stats round-trip, and a version 1 save (no gameStats) still loads', () => {
  const storage = memoryStorage();
  t.state.setGameStat(t.d('GAME_STAT_FIRST_HOF_PLAY_TIME'), 0x010203);
  const data = toSaveData(t.state);
  expect(data.version).toBe(SAVE_VERSION);
  const back = fromSaveData(structuredClone(data), newGame().state);
  expect(back.getGameStat(t.d('GAME_STAT_FIRST_HOF_PLAY_TIME'))).toBe(0x010203);

  const v1 = { ...structuredClone(data), version: 1 } as Partial<typeof data>;
  delete v1.gameStats;
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v1));
  const read = readSave(storage);
  expect(read?.version).toBe(SAVE_VERSION);
  expect(fromSaveData(read!, newGame().state).getGameStat(t.d('GAME_STAT_FIRST_HOF_PLAY_TIME'))).toBe(0);
});

test('a version 2 save (no sound option) loads with MONO', () => {
  const storage = memoryStorage();
  t.state.optionsSound = 1;
  const data = toSaveData(t.state);
  expect(fromSaveData(structuredClone(data), newGame().state).optionsSound).toBe(1);
  const v2 = { ...structuredClone(data), version: 2 };
  delete (v2.options as Partial<typeof data.options>).sound;
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v2));
  const read = readSave(storage);
  expect(read?.version).toBe(SAVE_VERSION);
  expect(fromSaveData(read!, newGame().state).optionsSound).toBe(t.d('OPTIONS_SOUND_MONO'));
});
