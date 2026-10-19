// quest_log_events.c's codecs for QL_EVENT_* 3-29 (world/questLogEventCodecs.ts): each event recorded into a
// scene's stream as the C lays it out and loaded back (QL_LoadEvent / QL_TryRepeatEvent) to its line of text in
// gStringVar4, compared against the decomp's string with the buffers filled as the C fills them.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { setTextStrings } from '../../src/battle/env';
import { gStringVar4 } from '../../src/menus/common';
import { loadMenusData } from '../../src/menus/data';
import { decodeQuestLogScript, gQL, initQuestLogData, ResetQuestLog, setQuestLogHost, type QuestLogData, type ScriptPtr } from '../../src/world/questLog';
import { TranslateLinkPartnersName } from '../../src/world/questLogEventCodecs';
import {
  QL_LoadEvent,
  QL_ResetRepeatEventTracker,
  QL_TryRepeatEvent,
  questLogEventsDebugState,
  QuestLog_StartRecordingInputsAfterDeferredEvent,
  SetQuestLogEvent,
} from '../../src/world/questLogEvents';
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
  // the party / item events count only after the Hall of Fame and once linking with R/S is allowed
  // (ShouldRegisterEvent_HandlePartyActions)
  t.state.setFlag('FLAG_SYS_GAME_CLEAR', true);
  t.state.setFlag('FLAG_SYS_CAN_LINK_WITH_RS', true);
  t.state.playerName = 'RED';
});

const sp = (name: string) => d(`SPECIES_${name}`);
const it = (name: string) => d(`ITEM_${name}`);
const scene = () => t.state.questLog[0];
/** gQuestLogCurActionIdx (a scene starts with the player's face and an empty input) */
const idx = () => gQL.curActionIdx;
/** The recorded commands of the first scene (up to the cursor while it records). */
const commands = () => decodeQuestLogScript(scene().script, gQL.recordingPointer?.scene === 0 ? gQL.recordingPointer.pos : undefined);
/** Where the first `eventId` command of the first scene starts. */
function eventPtr(eventId: string): ScriptPtr {
  let pos = 0;
  for (const c of commands()) {
    if (c.id === d(eventId)) return { scene: 0, pos };
    pos += c.words.length;
  }
  throw new Error(`no ${eventId} in the scene`);
}
const eventWords = (eventId: string) => commands().find((c) => c.id === d(eventId))!.words;
/** QL_LoadEvent at the event (the playback reached its action index), and the line it printed. */
function load(eventId: string): string {
  QL_ResetRepeatEventTracker();
  expect(QL_LoadEvent(eventPtr(eventId), 0xffff)).toBe(true);
  return line();
}
const line = () => t.charmap.decodePlain(gStringVar4);
/** The decomp's string with its placeholders filled the way the C fills them (STR_VAR_n / DYNAMIC n / PLAYER). */
function fill(symbol: string, vars: Record<string, string>): string {
  return strings[symbol]
    .replace(/\$$/, '')
    .replace(/'/g, '’') // the charmap's ' is ’
    .replace(/\{(STR_VAR_\d|DYNAMIC 0x0\d|PLAYER)\}/g, (_, k: string) => {
      const key = k === 'PLAYER' ? 'PLAYER' : k.startsWith('DYNAMIC') ? `D${Number(k.slice(8))}` : k;
      if (key === 'PLAYER') return 'RED';
      if (!(key in vars)) throw new Error(`${symbol}: ${key} not given`);
      return vars[key];
    });
}
const name = (s: string) => [...t.charmap.encodePlain(s)];
const departed = () => SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });

describe('the party and item events', () => {
  test('SWITCHED_PARTY_ORDER: [species1, species2]', () => {
    SetQuestLogEvent(d('QL_EVENT_SWITCHED_PARTY_ORDER'), { species1: sp('BULBASAUR'), species2: sp('PIKACHU') });
    expect(eventWords('QL_EVENT_SWITCHED_PARTY_ORDER')).toEqual([d('QL_EVENT_SWITCHED_PARTY_ORDER'), idx(), sp('BULBASAUR'), sp('PIKACHU')]);
    expect(load('QL_EVENT_SWITCHED_PARTY_ORDER')).toBe(fill('gText_QuestLog_SwitchMon1WithMon2', { STR_VAR_1: 'BULBASAUR', STR_VAR_2: 'PIKACHU' }));
    expect(line()).toBe('RED switched the POKéMON\\nBULBASAUR with PIKACHU.');
  });

  test('SWITCHED_PARTY_ORDER before the Hall of Fame is not recorded', () => {
    t.state.setFlag('FLAG_SYS_GAME_CLEAR', false);
    SetQuestLogEvent(d('QL_EVENT_SWITCHED_PARTY_ORDER'), { species1: 1, species2: 2 });
    expect(scene().startType).toBe(0);
  });

  test('USED_ITEM: an item on a Pokémon, an item on nothing, a key item, an egg', () => {
    SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), { itemId: it('POTION'), species: sp('CHARMANDER'), itemParam: 0xffff });
    expect(eventWords('QL_EVENT_USED_ITEM')).toEqual([d('QL_EVENT_USED_ITEM'), idx(), it('POTION'), sp('CHARMANDER'), 0xffff]);
    expect(load('QL_EVENT_USED_ITEM')).toBe(fill('gText_QuestLog_UsedItemOnMonAtThisLocation', { STR_VAR_1: 'POTION', STR_VAR_2: 'CHARMANDER' }));

    for (const [data, expected] of [
      [{ itemId: it('REPEL'), species: 0xffff, itemParam: 0xffff }, fill('gText_QuestLog_UsedTheItem', { STR_VAR_1: 'REPEL' })],
      [{ itemId: it('BICYCLE'), species: 0xffff, itemParam: 0xffff }, fill('gText_QuestLog_UsedTheKeyItem', { STR_VAR_1: 'BICYCLE' })],
      [{ itemId: it('POTION'), species: sp('EGG'), itemParam: 0xffff }, fill('gText_QuestLog_UsedItemOnMonAtThisLocation', { STR_VAR_1: 'POTION', STR_VAR_2: 'EGG' })],
    ] as const) {
      ResetQuestLog(t.state);
      SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), data);
      expect(load('QL_EVENT_USED_ITEM')).toBe(expected);
    }
  });

  test('USED_ITEM: a TM learned, an HM replacing a move', () => {
    SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), { itemId: it('TM01'), species: sp('MANKEY'), itemParam: 0xffff });
    expect(load('QL_EVENT_USED_ITEM')).toBe(fill('gText_QuestLog_MonLearnedMoveFromTM', { STR_VAR_1: 'MANKEY', STR_VAR_2: 'FOCUS PUNCH' }));
    ResetQuestLog(t.state);
    SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), { itemId: it('HM01'), species: sp('BULBASAUR'), itemParam: d('MOVE_TACKLE') });
    expect(load('QL_EVENT_USED_ITEM')).toBe(fill('gText_QuestLog_MonReplacedMoveWithHM', { STR_VAR_1: 'BULBASAUR', STR_VAR_2: 'CUT', STR_VAR_3: 'TACKLE' }));
  });

  test("USED_ITEM: an Escape Rope names the map section and ends the scene until the next departure", () => {
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), { itemId: it('ESCAPE_ROPE'), species: 0xffff, itemParam: d('MAPSEC_MT_MOON') });
    expect(questLogEventsDebugState().stepRecordingMode).toBe(2); // STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_STOPPED')); // QL_FinishRecordingScene
    expect(commands().map((c) => c.id)).toContain(d('QL_EVENT_SCENE_END'));
    expect(load('QL_EVENT_USED_ITEM')).toBe(fill('gText_QuestLog_UsedEscapeRope', { STR_VAR_1: 'ESCAPE ROPE', STR_VAR_2: 'MT. MOON' }));
  });

  test('the held items: gave (party / bag / PC), took, swapped (bag / PC)', () => {
    const cases: [string, Record<string, number>, string, Record<string, string>][] = [
      ['QL_EVENT_GAVE_HELD_ITEM', { itemId: it('LEFTOVERS'), species: sp('SNORLAX') }, 'gText_QuestLog_GaveMonHeldItem', { STR_VAR_1: 'SNORLAX', STR_VAR_2: 'LEFTOVERS' }],
      ['QL_EVENT_GAVE_HELD_ITEM_BAG', { itemId: it('LEFTOVERS'), species: sp('SNORLAX') }, 'gText_QuestLog_GaveMonHeldItem2', { STR_VAR_1: 'SNORLAX', STR_VAR_2: 'LEFTOVERS' }],
      ['QL_EVENT_GAVE_HELD_ITEM_PC', { itemId: it('LEFTOVERS'), species: sp('SNORLAX') }, 'gText_QuestLog_GaveMonHeldItemFromPC', { STR_VAR_1: 'LEFTOVERS', STR_VAR_2: 'SNORLAX' }],
      ['QL_EVENT_TOOK_HELD_ITEM', { itemId: it('LEFTOVERS'), species: sp('SNORLAX') }, 'gText_QuestLog_TookHeldItemFromMon', { STR_VAR_1: 'SNORLAX', STR_VAR_2: 'LEFTOVERS' }],
      [
        'QL_EVENT_SWAPPED_HELD_ITEM',
        { takenItemId: it('LEFTOVERS'), givenItemId: it('MIRACLE_SEED'), species: sp('ODDISH') },
        'gText_QuestLog_SwappedHeldItemsOnMon',
        { STR_VAR_1: 'ODDISH', STR_VAR_2: 'LEFTOVERS', STR_VAR_3: 'MIRACLE SEED' },
      ],
      [
        'QL_EVENT_SWAPPED_HELD_ITEM_PC',
        { takenItemId: it('LEFTOVERS'), givenItemId: it('MIRACLE_SEED'), species: sp('ODDISH') },
        'gText_QuestLog_SwappedHeldItemFromPC',
        { STR_VAR_1: 'MIRACLE SEED', STR_VAR_2: 'ODDISH', STR_VAR_3: 'LEFTOVERS' },
      ],
    ];
    for (const [event, data, symbol, vars] of cases) {
      ResetQuestLog(t.state);
      SetQuestLogEvent(d(event), data);
      const words = event.includes('SWAPPED') ? [data.takenItemId, data.givenItemId, data.species] : [data.itemId, data.species];
      expect(eventWords(event), event).toEqual([d(event), idx(), ...words]);
      expect(load(event), event).toBe(fill(symbol, vars));
    }
  });

  test('USED_PKMN_CENTER: only inside a scene, header only; a second heal at the same action writes nothing', () => {
    SetQuestLogEvent(d('QL_EVENT_USED_PKMN_CENTER'), null);
    expect(scene().startType).toBe(0); // never starts a scene
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_PKMN_CENTER'), null);
    SetQuestLogEvent(d('QL_EVENT_USED_PKMN_CENTER'), null);
    expect(commands().filter((c) => c.id === d('QL_EVENT_USED_PKMN_CENTER')).map((c) => c.words)).toEqual([[d('QL_EVENT_USED_PKMN_CENTER'), gQL.curActionIdx]]);
    expect(load('QL_EVENT_USED_PKMN_CENTER')).toBe(fill('gText_QuestLog_MonsWereFullyRestoredAtCenter', {}));
  });
});

describe('the repeat counter', () => {
  test('the same event at the same action index: one command, each copy loaded in turn', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPOSITED_ITEM_PC'), { itemId: it('POTION') });
    SetQuestLogEvent(d('QL_EVENT_DEPOSITED_ITEM_PC'), { itemId: it('ANTIDOTE') });
    SetQuestLogEvent(d('QL_EVENT_DEPOSITED_ITEM_PC'), { itemId: it('REPEL') });
    const ev = d('QL_EVENT_DEPOSITED_ITEM_PC');
    expect(eventWords('QL_EVENT_DEPOSITED_ITEM_PC')).toEqual([ev | (2 << 12), idx(), it('POTION'), it('ANTIDOTE'), it('REPEL')]);
    const ptr = eventPtr('QL_EVENT_DEPOSITED_ITEM_PC');
    expect(load('QL_EVENT_DEPOSITED_ITEM_PC')).toBe(fill('gText_QuestLog_StoredItemInPC', { STR_VAR_1: 'POTION' }));
    expect(QL_TryRepeatEvent(ptr)).toBe(true);
    expect(line()).toBe(fill('gText_QuestLog_StoredItemInPC', { STR_VAR_1: 'ANTIDOTE' }));
    expect(QL_TryRepeatEvent(ptr)).toBe(true);
    expect(line()).toBe(fill('gText_QuestLog_StoredItemInPC', { STR_VAR_1: 'REPEL' }));
    expect(QL_TryRepeatEvent(ptr)).toBe(false); // the tracker was reset after the last copy
  });

  test('a repeated held item event with two words of data', () => {
    SetQuestLogEvent(d('QL_EVENT_TOOK_HELD_ITEM'), { itemId: it('LEFTOVERS'), species: sp('SNORLAX') });
    SetQuestLogEvent(d('QL_EVENT_TOOK_HELD_ITEM'), { itemId: it('MIRACLE_SEED'), species: sp('ODDISH') });
    const ptr = eventPtr('QL_EVENT_TOOK_HELD_ITEM');
    expect(eventWords('QL_EVENT_TOOK_HELD_ITEM')).toEqual([d('QL_EVENT_TOOK_HELD_ITEM') | (1 << 12), idx(), it('LEFTOVERS'), sp('SNORLAX'), it('MIRACLE_SEED'), sp('ODDISH')]);
    load('QL_EVENT_TOOK_HELD_ITEM');
    QL_TryRepeatEvent(ptr);
    expect(line()).toBe(fill('gText_QuestLog_TookHeldItemFromMon', { STR_VAR_1: 'ODDISH', STR_VAR_2: 'MIRACLE SEED' }));
  });
});

describe('the box events', () => {
  const box = (n: number) => `BOX${n + 1}`;
  test('every box event: its bytes and its line', () => {
    const cases: [string, Record<string, number>, number[], string, Record<string, string>][] = [
      [
        'QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES',
        { species1: sp('PIDGEY'), species2: sp('RATTATA'), box1: 0, box2: 3 },
        [sp('PIDGEY'), sp('RATTATA'), 0 | (3 << 8)],
        'gText_QuestLog_SwitchedMonsBetweenBoxes',
        { D0: box(0), D1: 'PIDGEY', D2: box(3), D3: 'RATTATA' },
      ],
      [
        'QL_EVENT_SWITCHED_MONS_WITHIN_BOX',
        { species1: sp('PIDGEY'), species2: sp('RATTATA'), box1: 2, box2: 2 },
        [sp('PIDGEY'), sp('RATTATA'), 2],
        'gText_QuestLog_SwitchedMonsWithinBox',
        { D0: box(2), D1: 'PIDGEY', D2: 'RATTATA' },
      ],
      [
        'QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON',
        { species1: sp('PIDGEY'), species2: sp('RATTATA'), box1: 5, box2: 14 },
        [sp('PIDGEY'), sp('RATTATA'), 5],
        'gText_QuestLog_SwitchedPartyMonForPCMon',
        { D0: box(5), D1: 'PIDGEY', D2: 'RATTATA' },
      ],
      [
        'QL_EVENT_MOVED_MON_BETWEEN_BOXES',
        { species1: sp('ZUBAT'), box1: 1, box2: 7 },
        [sp('ZUBAT'), 1 | (7 << 8)],
        'gText_QuestLog_MovedMonToNewBox',
        { D0: box(1), D1: 'ZUBAT', D2: box(7) },
      ],
      ['QL_EVENT_MOVED_MON_WITHIN_BOX', { species1: sp('ZUBAT'), box1: 4 }, [sp('ZUBAT'), 4], 'gText_QuestLog_MovedMonWithinBox', { D0: box(4), D1: 'ZUBAT' }],
      ['QL_EVENT_WITHDREW_MON_PC', { species1: sp('ZUBAT'), box1: 4 }, [sp('ZUBAT'), 4], 'gText_QuestLog_WithdrewMonFromPC', { D0: box(4), D1: 'ZUBAT' }],
      ['QL_EVENT_DEPOSITED_MON_PC', { species1: sp('EGG'), box1: 13 }, [sp('EGG'), 13], 'gText_QuestLog_DepositedMonInPC', { D0: 'EGG', D1: box(13) }],
      ['QL_EVENT_SWITCHED_MULTIPLE_MONS', { box1: 0, box2: 9 }, [0 | (9 << 8)], 'gText_QuestLog_SwitchedMultipleMons', { D0: box(0), D1: box(9) }],
    ];
    for (const [event, data, words, symbol, vars] of cases) {
      ResetQuestLog(t.state);
      SetQuestLogEvent(d(event), data);
      expect(eventWords(event), event).toEqual([d(event), idx(), ...words]);
      expect(load(event), event).toBe(fill(symbol, vars));
    }
  });

  test('a party mon put in the box first is swapped round; the same box twice is "a different spot"', () => {
    SetQuestLogEvent(d('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON'), { species1: sp('PIDGEY'), species2: sp('RATTATA'), box1: d('TOTAL_BOXES_COUNT'), box2: 6 });
    expect(eventWords('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON')).toEqual([d('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON'), idx(), sp('RATTATA'), sp('PIDGEY'), 6]);
    expect(load('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON')).toBe(fill('gText_QuestLog_SwitchedPartyMonForPCMon', { D0: box(6), D1: 'RATTATA', D2: 'PIDGEY' }));
    ResetQuestLog(t.state);
    SetQuestLogEvent(d('QL_EVENT_SWITCHED_MULTIPLE_MONS'), { box1: 3, box2: 3 });
    expect(load('QL_EVENT_SWITCHED_MULTIPLE_MONS')).toBe(fill('gText_QuestLog_SwitchedMultipleMons', { D0: box(3), D1: fill('gText_QuestLog_ADifferentSpot', {}) }));
  });

  test("a renamed box's name is what the line prints", () => {
    t.state.storage.boxNames[2] = name('BERRIES');
    SetQuestLogEvent(d('QL_EVENT_WITHDREW_MON_PC'), { species1: sp('ODDISH'), box1: 2 });
    expect(load('QL_EVENT_WITHDREW_MON_PC')).toBe(fill('gText_QuestLog_WithdrewMonFromPC', { D0: 'BERRIES', D1: 'ODDISH' }));
    t.state.storage.boxNames[2] = name('BOX3');
  });
});

describe('the item PC', () => {
  test('WITHDREW_ITEM_PC: [itemId]', () => {
    SetQuestLogEvent(d('QL_EVENT_WITHDREW_ITEM_PC'), { itemId: it('MAX_POTION') });
    expect(eventWords('QL_EVENT_WITHDREW_ITEM_PC')).toEqual([d('QL_EVENT_WITHDREW_ITEM_PC'), idx(), it('MAX_POTION')]);
    expect(load('QL_EVENT_WITHDREW_ITEM_PC')).toBe(fill('gText_QuestLog_WithdrewItemFromPC', { STR_VAR_1: 'MAX POTION' }));
  });
});

describe('the link events (deferred to QuestLog_StartRecordingInputsAfterDeferredEvent)', () => {
  /** SetQuestLogEvent defers a link event; the cable club's return to the field records it in a new scene. */
  const linkEvent = (event: string, data: Record<string, unknown> | null) => {
    SetQuestLogEvent(d(event), data);
    expect(scene().startType).toBe(0);
    QuestLog_StartRecordingInputsAfterDeferredEvent();
  };

  test('LINK_TRADED / LINK_TRADED_UNION: the species and the partner name in 8 bytes', () => {
    linkEvent('QL_EVENT_LINK_TRADED', { speciesSent: sp('ABRA'), speciesReceived: sp('MACHOP'), partnerName: name('GREEN') });
    const words = eventWords('QL_EVENT_LINK_TRADED');
    expect(words.slice(0, 4)).toEqual([d('QL_EVENT_LINK_TRADED'), idx(), sp('ABRA'), sp('MACHOP')]);
    const nameBytes = words.slice(4).flatMap((w) => [w & 0xff, w >> 8]).slice(0, 7);
    expect(nameBytes).toEqual([...name('GREEN'), 0xff, 0xff]);
    expect(load('QL_EVENT_LINK_TRADED')).toBe(fill('gText_QuestLog_TradedMon1ForPersonsMon2', { STR_VAR_1: 'GREEN', STR_VAR_2: 'MACHOP', STR_VAR_3: 'ABRA' }));
    ResetQuestLog(t.state);
    linkEvent('QL_EVENT_LINK_TRADED_UNION', { speciesSent: sp('ABRA'), speciesReceived: sp('MACHOP'), partnerName: name('GREEN') });
    expect(load('QL_EVENT_LINK_TRADED_UNION')).toBe(fill('gText_QuestLog_TradedMon1ForTrainersMon2', { STR_VAR_1: 'GREEN', STR_VAR_2: 'MACHOP', STR_VAR_3: 'ABRA' }));
  });

  test('the link battles: single, double, union room, multi', () => {
    const outcome = (o: string) => fill(`gText_QuestLog_${o}`, {});
    linkEvent('QL_EVENT_LINK_BATTLED_SINGLE', { outcome: d('B_OUTCOME_WON'), playerNames: [name('BLUE')] });
    const words = eventWords('QL_EVENT_LINK_BATTLED_SINGLE');
    expect(words.length).toBe(6);
    expect(words[2]).toBe(d('B_OUTCOME_WON') | (name('BLUE')[0] << 8)); // rOutcome, then the name's first byte
    expect(load('QL_EVENT_LINK_BATTLED_SINGLE')).toBe(fill('gText_QuestLog_SingleBattleWithPersonResultedInOutcome', { D0: 'BLUE', D1: outcome('Win') }));
    ResetQuestLog(t.state);
    linkEvent('QL_EVENT_LINK_BATTLED_DOUBLE', { outcome: d('B_OUTCOME_LOST'), playerNames: [name('BLUE')] });
    expect(load('QL_EVENT_LINK_BATTLED_DOUBLE')).toBe(fill('gText_QuestLog_DoubleBattleWithPersonResultedInOutcome', { D0: 'BLUE', D1: outcome('Loss') }));
    ResetQuestLog(t.state);
    linkEvent('QL_EVENT_LINK_BATTLED_UNION', { outcome: d('B_OUTCOME_DREW'), playerNames: [name('BLUE')] });
    expect(load('QL_EVENT_LINK_BATTLED_UNION')).toBe(fill('gText_QuestLog_BattledTrainerEndedInOutcome', { STR_VAR_1: 'BLUE', STR_VAR_2: outcome('Draw') }));
    ResetQuestLog(t.state);
    linkEvent('QL_EVENT_LINK_BATTLED_MULTI', { outcome: d('B_OUTCOME_WON'), playerNames: [name('LEAF'), name('BLUE'), name('GARYMAX')] });
    expect(eventWords('QL_EVENT_LINK_BATTLED_MULTI').length).toBe(13);
    expect(load('QL_EVENT_LINK_BATTLED_MULTI')).toBe(
      fill('gText_QuestLog_MultiBattleWithPeopleResultedInOutcome', { D0: 'RED', D1: 'LEAF', D2: 'BLUE', D3: 'GARYMAX', D4: outcome('Win') }),
    );
  });

  test('the union room: header only', () => {
    linkEvent('QL_EVENT_USED_UNION_ROOM', null);
    expect(eventWords('QL_EVENT_USED_UNION_ROOM')).toEqual([d('QL_EVENT_USED_UNION_ROOM'), idx()]);
    expect(load('QL_EVENT_USED_UNION_ROOM')).toBe(fill('gText_QuestLog_MingledInUnionRoom', {}));
    ResetQuestLog(t.state);
    linkEvent('QL_EVENT_USED_UNION_ROOM_CHAT', null);
    expect(load('QL_EVENT_USED_UNION_ROOM_CHAT')).toBe(fill('gText_QuestLog_ChattedWithManyTrainers', {}));
  });

  test("TranslateLinkPartnersName: a Japanese name's {JPN} gets an {ENG} and an end after it", () => {
    const BEGIN = d('EXT_CTRL_CODE_BEGIN');
    const jpn = [BEGIN, d('EXT_CTRL_CODE_JPN'), 1, 2, 3, 0xff, 0xff, 0xff];
    expect(TranslateLinkPartnersName([...jpn])).toEqual([BEGIN, d('EXT_CTRL_CODE_JPN'), 1, 2, 3, 0xff, 0xff, BEGIN, d('EXT_CTRL_CODE_ENG'), 0xff]);
    expect(TranslateLinkPartnersName(name('GREEN'))).toEqual(name('GREEN'));
  });
});
