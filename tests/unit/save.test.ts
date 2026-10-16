import { beforeEach, describe, expect, test } from 'vitest';
import {
  CONTINUE_GAME_WARP,
  ClearContinueGameWarpStatus,
  gSave,
  LoadGameSave,
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
import { SAVE_STORAGE_KEY, toSaveData } from '../../src/state/saveData';
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
