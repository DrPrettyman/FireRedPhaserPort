// QL4a: the menus' quest log calls that run without a screen: item_use.c's ItemUse_SetQuestLogEvent (the
// QuestLogEvent_Item it records) and pokemon_storage_system_tasks.c's SetPokeStorageQuestLogEvent's choice of
// QL_EVENT_* and data (menus/pokemonStorageQuestLog.ts).

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { setTextStrings } from '../../src/battle/env';
import { pokeStorageQuestLogEvent, type PokeStorageQuestLogInputs } from '../../src/menus/pokemonStorageQuestLog';
import { decodeQuestLogScript, gQL, initQuestLogData, ResetQuestLog, setQuestLogHost, type QuestLogData } from '../../src/world/questLog';
import { ItemUse_SetQuestLogEvent } from '../../src/world/questLogEvents';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let t: TestGame;
let d: (name: string) => number;

beforeAll(async () => {
  t = await newBattleEnv();
  d = t.d;
  setTextStrings(readGen('text/strings.json'));
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
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
  t.state.setFlag('FLAG_SYS_GAME_CLEAR', true);
  t.state.setFlag('FLAG_SYS_CAN_LINK_WITH_RS', true);
});

const sp = (name: string) => d(`SPECIES_${name}`);
const commands = () =>
  decodeQuestLogScript(t.state.questLog[0].script, gQL.recordingPointer?.scene === 0 ? gQL.recordingPointer.pos : undefined);

describe('ItemUse_SetQuestLogEvent', () => {
  test('species 0xFFFF for no Pokémon, SPECIES_EGG for an egg, the param as given', () => {
    ItemUse_SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), null, d('ITEM_REPEL'), 0xffff);
    ItemUse_SetQuestLogEvent(d('QL_EVENT_GAVE_HELD_ITEM'), { species: sp('PIKACHU'), isEgg: true }, d('ITEM_ORAN_BERRY'), 0xffff);
    ItemUse_SetQuestLogEvent(d('QL_EVENT_USED_ITEM'), { species: sp('MANKEY'), isEgg: false }, d('ITEM_HM01'), d('MOVE_TACKLE'));
    const words = commands().filter((c) => c.id === d('QL_EVENT_USED_ITEM') || c.id === d('QL_EVENT_GAVE_HELD_ITEM')).map((c) => c.words.slice(2));
    expect(words).toEqual([
      [d('ITEM_REPEL'), 0xffff, 0xffff],
      [d('ITEM_ORAN_BERRY'), sp('EGG')],
      [d('ITEM_HM01'), sp('MANKEY'), d('MOVE_TACKLE')],
    ]);
  });
});

describe('SetPokeStorageQuestLogEvent', () => {
  const PARTY = () => d('TOTAL_BOXES_COUNT');
  const base = (o: Partial<PokeStorageQuestLogInputs>): PokeStorageQuestLogInputs => ({
    box1: 0,
    species1: 25,
    inPartyMenu: false,
    box2: 0,
    species2: 1,
    depositBoxId: 0,
    ...o,
  });
  const ev = (action: number, o: Partial<PokeStorageQuestLogInputs>) => {
    const r = pokeStorageQuestLogEvent(action, base(o));
    return r && { event: r.eventId, ...r.data };
  };

  test('shift: within a box, between boxes, party for PC mon (both ways), none party to party', () => {
    expect(ev(0, { box1: 2, box2: 2 })).toEqual({ event: d('QL_EVENT_SWITCHED_MONS_WITHIN_BOX'), species1: 25, species2: 1, box1: 2, box2: 2 });
    expect(ev(0, { box1: 2, box2: 5 })?.event).toBe(d('QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES'));
    expect(ev(0, { box1: PARTY(), box2: 5 })?.event).toBe(d('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON'));
    expect(ev(0, { inPartyMenu: true, box1: 3, box2: PARTY() })).toEqual({
      event: d('QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON'),
      species1: 25,
      species2: 1,
      box1: 3,
      box2: PARTY(),
    });
    expect(ev(0, { inPartyMenu: true, box1: PARTY(), box2: PARTY() })).toBeNull();
  });

  test('place: withdrawn, deposited (the box in box1), moved between boxes, within a box, none party to party', () => {
    expect(ev(1, { inPartyMenu: true, box1: 4, box2: PARTY() })).toEqual({
      event: d('QL_EVENT_WITHDREW_MON_PC'),
      species1: 25,
      species2: d('SPECIES_NONE'),
      box1: 4,
      box2: 0xff,
    });
    expect(ev(1, { box1: PARTY(), box2: 6 })).toEqual({ event: d('QL_EVENT_DEPOSITED_MON_PC'), species1: 25, species2: 0, box1: 6, box2: 0xff });
    expect(ev(1, { box1: 1, box2: 6 })).toEqual({ event: d('QL_EVENT_MOVED_MON_BETWEEN_BOXES'), species1: 25, species2: 0, box1: 1, box2: 6 });
    expect(ev(1, { box1: 6, box2: 6 })).toEqual({ event: d('QL_EVENT_MOVED_MON_WITHIN_BOX'), species1: 25, species2: 0, box1: 6, box2: 0xff });
    expect(ev(1, { inPartyMenu: true, box1: PARTY(), box2: PARTY() })).toBeNull();
  });

  test('deposit (the chosen box), the multi-move, an unknown action', () => {
    expect(ev(2, { inPartyMenu: true, box1: PARTY(), depositBoxId: 7 })).toEqual({
      event: d('QL_EVENT_DEPOSITED_MON_PC'),
      species1: 25,
      species2: 0,
      box1: 7,
      box2: 0xff,
    });
    expect(ev(3, { box1: 2, box2: 3 })).toEqual({ event: d('QL_EVENT_SWITCHED_MULTIPLE_MONS'), species1: 0, species2: 0, box1: 2, box2: 3 });
    expect(ev(4, {})).toBeNull();
  });
});
