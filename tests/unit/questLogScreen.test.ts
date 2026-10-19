// The quest log's playback screen (world/questLogScreen.ts, QUEST_LOG_PLAN.md QL2b): palette.c's tints as the C
// computes them (TintPalette_GrayScale / _SepiaTone, CopyPaletteInvertedTint, SlightlyDarkenPalsInWeather's blend),
// GetQuestLogTextDisplayDuration on gStringVar4, and the DEPARTED / ARRIVED events' lines (LoadEvent_DepartedLocation
// with the gym's badge check, LoadEvent_ArrivedInLocation).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { setTextStrings } from '../../src/battle/env';
import { gStringVar4 } from '../../src/menus/common';
import { loadMenusData } from '../../src/menus/data';
import { decodeQuestLogScript, gQL, initQuestLogData, ResetQuestLog, setQuestLogHost, type QuestLogData, type ScriptPtr } from '../../src/world/questLog';
import { QL_LoadEvent, QL_ResetRepeatEventTracker, SetQuestLogEvent } from '../../src/world/questLogEvents';
import { GetQuestLogTextDisplayDuration } from '../../src/world/questLogPlayback';
import { BlendToBlack3, CopyPaletteInvertedTint, mapJascColors, TintPalette_GrayScale, TintPalette_SepiaTone } from '../../src/world/questLogScreen';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let t: TestGame;
let d: (name: string) => number;
let strings: Record<string, string>;
const PUBLIC = resolve(__dirname, '../../public');

beforeAll(async () => {
  t = await newBattleEnv();
  d = t.d;
  strings = readGen('text/strings.json');
  setTextStrings(strings);
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
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

beforeEach(() => {
  setQuestLogHost({
    state: t.state,
    location: () => ({ mapId: 'MAP_PALLET_TOWN', warpId: 0, x: 6, y: 8 }),
    mapSec: () => d('MAPSEC_PALLET_TOWN'),
    playerFacing: () => 'down',
    fieldControlsLocked: () => false,
    objectEvents: () => [],
    objectEventTemplates: () => [],
  });
  ResetQuestLog(t.state);
  t.state.playerName = 'RED';
});

const RGB = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);

describe("palette.c's tints", () => {
  test('TintPalette_GrayScale: (r * 76 + g * 151 + b * 29) >> 8 on each channel', () => {
    expect(TintPalette_GrayScale(RGB(31, 0, 0))).toBe(RGB(9, 9, 9));
    expect(TintPalette_GrayScale(RGB(0, 31, 0))).toBe(RGB(18, 18, 18));
    expect(TintPalette_GrayScale(RGB(0, 0, 31))).toBe(RGB(3, 3, 3));
    expect(TintPalette_GrayScale(RGB(31, 31, 31))).toBe(RGB(31, 31, 31)); // (76 + 151 + 29 = 256)
    expect(TintPalette_GrayScale(0)).toBe(0);
  });

  test('TintPalette_SepiaTone: the grey times 1.2 / 1.0 / 0.94, red capped at 31', () => {
    expect(TintPalette_SepiaTone(RGB(31, 31, 31))).toBe(RGB(31, 31, 29));
    expect(TintPalette_SepiaTone(RGB(0, 31, 0))).toBe(RGB(21, 18, 16));
  });

  test('CopyPaletteInvertedTint: tone sixteenths toward the grey, arithmetic shifts as in the C', () => {
    const c = RGB(31, 0, 0); // grey 9
    expect(CopyPaletteInvertedTint(c, 0)).toBe(c);
    expect(CopyPaletteInvertedTint(c, 15)).toBe(RGB(31 + ((15 * -22) >> 4), (15 * 9) >> 4, (15 * 9) >> 4));
    expect(CopyPaletteInvertedTint(c, 15)).toBe(RGB(10, 8, 8));
    expect(CopyPaletteInvertedTint(c, 8)).toBe(RGB(20, 4, 4));
  });

  test("SlightlyDarkenPalsInWeather's BlendPalettesAt(RGB_BLACK, 3)", () => {
    expect(BlendToBlack3(RGB(31, 16, 1))).toBe(RGB(31 - 6, 16 - 3, 0));
  });

  test('mapJascColors: JASC [r, g, b] (8-bit, as palettes.json) through a BGR555 map and back', () => {
    expect(mapJascColors([255, 0, 0, 98, 98, 98], TintPalette_GrayScale)).toEqual([74, 74, 74, 98, 98, 98]); // (9 → floor(9 * 255 / 31))
  });
});

describe('GetQuestLogTextDisplayDuration', () => {
  test("by gStringVar4's length, line breaks not counted", () => {
    const str = (n: number, breaks = 0) => [...Array(n).fill(0xbb), ...Array(breaks).fill(0xfe), 0xff];
    expect(GetQuestLogTextDisplayDuration(str(19))).toBe(0x5f);
    expect(GetQuestLogTextDisplayDuration(str(19, 3))).toBe(0x5f);
    expect(GetQuestLogTextDisplayDuration(str(20))).toBe(0x7f);
    expect(GetQuestLogTextDisplayDuration(str(36))).toBe(0xbf);
    expect(GetQuestLogTextDisplayDuration(str(46))).toBe(0xff);
  });
});

describe('the DEPARTED and ARRIVED lines', () => {
  function eventPtr(eventId: string): ScriptPtr {
    let pos = 0;
    for (const c of decodeQuestLogScript(t.state.questLog[0].script, gQL.recordingPointer?.scene === 0 ? gQL.recordingPointer.pos : undefined)) {
      if (c.id === d(eventId)) return { scene: 0, pos };
      pos += c.words.length;
    }
    throw new Error(`no ${eventId} in the scene`);
  }
  function load(eventId: string): string {
    QL_ResetRepeatEventTracker();
    expect(QL_LoadEvent(eventPtr(eventId), 0xffff)).toBe(true);
    return t.charmap.decodePlain(gStringVar4);
  }
  const fill = (symbol: string, vars: Record<string, string> = {}) =>
    strings[symbol].replace(/\$$/, '').replace(/\{(STR_VAR_\d|PLAYER)\}/g, (_, k: string) => (k === 'PLAYER' ? 'RED' : vars[k]));

  test('leaving home: sLocationToDepartedTextId (QL_DEPARTED_HOME)', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
    expect(load('QL_EVENT_DEPARTED')).toBe(fill('gText_QuestLog_RestedAtHome'));
    expect(load('QL_EVENT_DEPARTED')).toBe('RED rested comfortably at home.');
  });

  test("a town's building: the town (STR_VAR_1) and the place (STR_VAR_2, sLocationNameTexts)", () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_CERULEAN_CITY'), locationId: d('QL_LOCATION_BIKE_SHOP') });
    const place = t.charmap.decodePlain([...t.charmap.encodePlain(strings.gText_QuestLog_BikeShop.replace(/\$$/, ''))]);
    expect(load('QL_EVENT_DEPARTED')).toBe(fill('gText_QuestLog_DepartedPlaceInTownForNextDestination', { STR_VAR_1: 'CERULEAN CITY', STR_VAR_2: place }));
  });

  test("a gym: full of tough trainers before its badge, departed after (sGymCityMapSecs)", () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PEWTER_CITY'), locationId: d('QL_LOCATION_PEWTER_GYM') });
    t.state.setFlag('FLAG_BADGE01_GET', false);
    expect(load('QL_EVENT_DEPARTED')).toBe(fill('gText_QuestLog_GymWasFullOfToughTrainers', { STR_VAR_1: 'PEWTER CITY', STR_VAR_2: 'GYM' }));
    t.state.setFlag('FLAG_BADGE01_GET', true);
    expect(load('QL_EVENT_DEPARTED')).toBe(fill('gText_QuestLog_DepartedGym', { STR_VAR_1: 'PEWTER CITY' }));
  });

  test('ARRIVED: the map name in gText_QuestLog_ArrivedInLocation', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
    SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: d('MAPSEC_VIRIDIAN_CITY') });
    expect(load('QL_EVENT_ARRIVED')).toBe('Arrived in VIRIDIAN CITY.');
  });
});
