// QL4b: the quest log calls that run without a screen: shop.c's transaction history (menus/shopQuestLog.ts:
// RecordItemTransaction's one entry per kind, the caps, half the price for a sale; RecordTransactionForQuestLog's
// BOUGHT then SOLD) and item.c's TrySetObtainedItemQuestLogEvent (world/questLogStoryItem.ts: the story items, the
// Town Map only in the rival's house).

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { setTextStrings } from '../../src/battle/env';
import { ItemId_GetPrice } from '../../src/menus/common';
import { RecordItemTransaction, RecordTransactionForQuestLog, ResetShopHistory, shopHistoryDebugState } from '../../src/menus/shopQuestLog';
import { decodeQuestLogScript, gQL, initQuestLogData, ResetQuestLog, setQuestLogHost, type QuestLogData } from '../../src/world/questLog';
import { TrySetObtainedItemQuestLogEvent } from '../../src/world/questLogStoryItem';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let t: TestGame;
let d: (name: string) => number;
let mapId = 'MAP_VIRIDIAN_CITY_MART';

beforeAll(async () => {
  t = await newBattleEnv();
  d = t.d;
  setTextStrings(readGen('text/strings.json'));
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
});

beforeEach(() => {
  mapId = 'MAP_VIRIDIAN_CITY_MART';
  setQuestLogHost({
    state: t.state,
    location: () => ({ mapId, warpId: 0, x: 3, y: 4 }),
    mapSec: () => d('MAPSEC_VIRIDIAN_CITY'),
    playerFacing: () => 'down',
    fieldControlsLocked: () => false,
    objectEvents: () => [],
    objectEventTemplates: () => [],
  });
  ResetQuestLog(t.state);
});

/** Every event command recorded so far (scene 0) */
const commands = () =>
  decodeQuestLogScript(t.state.questLog[0].script, gQL.recordingPointer?.scene === 0 ? gQL.recordingPointer.pos : undefined).filter(
    (c) => c.id >= d('QL_EVENT_SWITCHED_PARTY_ORDER') && c.id <= d('QL_EVENT_ARRIVED'),
  );

const BOUGHT = () => d('QL_EVENT_BOUGHT_ITEM') - d('QL_EVENT_USED_POKEMART');
const SOLD = () => d('QL_EVENT_SOLD_ITEM') - d('QL_EVENT_USED_POKEMART');

describe('RecordItemTransaction / RecordTransactionForQuestLog', () => {
  test('one entry per kind: the last item, the quantity, the money (half for a sale), several transactions flagged', () => {
    ResetShopHistory();
    RecordItemTransaction(d('ITEM_POTION'), 3, BOUGHT());
    RecordItemTransaction(d('ITEM_ANTIDOTE'), 1, SOLD());
    RecordItemTransaction(d('ITEM_POKE_BALL'), 2, BOUGHT());
    const [bought, sold] = shopHistoryDebugState();
    expect(bought).toEqual({
      logEventId: BOUGHT(),
      lastItemId: d('ITEM_POKE_BALL'),
      itemQuantity: 5,
      totalMoney: ItemId_GetPrice(d('ITEM_POTION')) * 3 + ItemId_GetPrice(d('ITEM_POKE_BALL')) * 2,
      mapSec: d('MAPSEC_VIRIDIAN_CITY'),
      hasMultipleTransactions: true,
    });
    expect(sold).toMatchObject({ logEventId: SOLD(), lastItemId: d('ITEM_ANTIDOTE'), itemQuantity: 1, hasMultipleTransactions: false });
    expect(sold.totalMoney).toBe(ItemId_GetPrice(d('ITEM_ANTIDOTE')) >> 1);
  });

  test('the quantity stops at 999 and the money at 999999', () => {
    ResetShopHistory();
    RecordItemTransaction(d('ITEM_MAX_REVIVE'), 990, BOUGHT());
    RecordItemTransaction(d('ITEM_MAX_REVIVE'), 20, BOUGHT());
    expect(shopHistoryDebugState()[0]).toMatchObject({ itemQuantity: 999, totalMoney: 999999 });
  });

  test("leaving the shop records the session's BOUGHT and SOLD events in the order they happened; nothing for none", () => {
    ResetShopHistory();
    RecordTransactionForQuestLog();
    expect(commands()).toEqual([]);
    RecordItemTransaction(d('ITEM_ANTIDOTE'), 2, SOLD());
    RecordItemTransaction(d('ITEM_POTION'), 1, BOUGHT());
    RecordTransactionForQuestLog();
    const mapSec = d('MAPSEC_VIRIDIAN_CITY');
    const price = ItemId_GetPrice(d('ITEM_ANTIDOTE'));
    expect(commands().map((c) => [c.id, ...c.words.slice(2)])).toEqual([
      [d('QL_EVENT_SOLD_ITEM'), d('ITEM_ANTIDOTE'), 2, 0, price, mapSec],
      // RecordEvent_BoughtItem writes hasMultipleTransactions TRUE regardless
      [d('QL_EVENT_BOUGHT_ITEM'), d('ITEM_POTION'), 1, 0, ItemId_GetPrice(d('ITEM_POTION')), mapSec | (1 << 8)],
    ]);
  });
});

describe('TrySetObtainedItemQuestLogEvent', () => {
  test('a story item starts a scene with OBTAINED_STORY_ITEM; other items record nothing', () => {
    TrySetObtainedItemQuestLogEvent(d('ITEM_POTION'));
    TrySetObtainedItemQuestLogEvent(d('ITEM_BICYCLE'));
    expect(commands().map((c) => [c.id, ...c.words.slice(2)])).toEqual([[d('QL_EVENT_OBTAINED_STORY_ITEM'), d('ITEM_BICYCLE'), d('MAPSEC_VIRIDIAN_CITY')]]);
  });

  test('the Town Map counts only in the rival\'s house', () => {
    TrySetObtainedItemQuestLogEvent(d('ITEM_TOWN_MAP'));
    expect(commands()).toEqual([]);
    mapId = 'MAP_PALLET_TOWN_RIVALS_HOUSE';
    TrySetObtainedItemQuestLogEvent(d('ITEM_TOWN_MAP'));
    expect(commands().map((c) => c.words[2])).toEqual([d('ITEM_TOWN_MAP')]);
  });
});
