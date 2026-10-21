// shop.c's quest log half: the shopping session's transaction history (sHistory), which the buy menu
// (BuyMenuTryMakePurchase) and the SELL paths (item_menu.c's Task_FinalizeSaleToShop, tm_case.c's Task_DoSaleOfTMs,
// berry_pouch.c's Task_SellBerries_PlaySfxAndRemoveBerries) add to with RecordItemTransaction, and the shop menu's
// SEE YA! (Task_HandleShopMenuQuit) hands to the quest log with RecordTransactionForQuestLog. Kept out of shop.ts so
// the bag, the TM case and the berry pouch can call it without importing the buy menu (which imports the bag).

import { K } from '../battle/constants';
import { questLogHost } from '../world/questLog';
import type { QuestLogEventShop } from '../world/questLogEventCodecs2';
import { SetQuestLogEvent } from '../world/questLogEvents';
import { ItemId_GetPrice } from './common';

/** struct QuestLogEvent_Shop; logEventId: 0 (empty), 1 (bought) or 2 (sold), as QL_EVENT_*_ITEM - QL_EVENT_USED_POKEMART */
interface ShopHistory extends QuestLogEventShop {
  logEventId: number;
  hasMultipleTransactions: boolean;
}

const emptyHistory = (mapSec = 0): ShopHistory => ({
  totalMoney: 0,
  lastItemId: 0, // ITEM_NONE (K is filled after the module loads)
  itemQuantity: 0,
  mapSec,
  hasMultipleTransactions: false,
  logEventId: 0,
});

/** EWRAM_DATA struct QuestLogEvent_Shop sHistory[2] */
const sHistory: [ShopHistory, ShopHistory] = [emptyHistory(), emptyHistory()];

/** CreatePokemartMenu's memset(&sHistory, 0, ...) and the map section of both entries (gMapHeader.regionMapSectionId) */
export function ResetShopHistory(): void {
  const mapSec = questLogHost()?.mapSec() ?? 0;
  sHistory[0] = emptyHistory(mapSec);
  sHistory[1] = emptyHistory(mapSec);
}

/**
 * RecordItemTransaction: a purchase (logEventId QL_EVENT_BOUGHT_ITEM - QL_EVENT_USED_POKEMART) or a sale
 * (QL_EVENT_SOLD_ITEM - QL_EVENT_USED_POKEMART) in this shopping session, one entry per kind.
 */
export function RecordItemTransaction(itemId: number, quantity: number, logEventId: number): void {
  let history: ShopHistory;
  // There should only be a single entry for buying/selling respectively,
  // so if one has already been created then get it first.
  if (sHistory[0].logEventId === logEventId) {
    history = sHistory[0];
  } else if (sHistory[1].logEventId === logEventId) {
    history = sHistory[1];
  } else {
    // First transaction of this type, save it in an empty slot
    history = sHistory[0].logEventId === 0 ? sHistory[0] : sHistory[1];
    history.logEventId = logEventId;
  }
  // Set flag if this isn't the first time we've bought/sold in this session
  if (history.lastItemId !== K.ITEM_NONE) history.hasMultipleTransactions = true;
  history.lastItemId = itemId;
  // Add to number of items bought/sold (u16)
  if (history.itemQuantity < 999) {
    history.itemQuantity = (history.itemQuantity + quantity) & 0xffff;
    if (history.itemQuantity > 999) history.itemQuantity = 999;
  }
  // Add to amount of money spent buying or earned selling: the full price for buying, half for selling
  if (history.totalMoney < 999999) {
    history.totalMoney += (ItemId_GetPrice(itemId) >> (logEventId - 1)) * quantity;
    if (history.totalMoney > 999999) history.totalMoney = 999999;
  }
}

/** RecordTransactionForQuestLog: QL_EVENT_BOUGHT_ITEM and/or QL_EVENT_SOLD_ITEM, or nothing. */
export function RecordTransactionForQuestLog(): void {
  for (const history of sHistory) {
    const eventId = history.logEventId;
    if (eventId !== 0) SetQuestLogEvent(eventId + K.QL_EVENT_USED_POKEMART, { ...history });
  }
}

/** For tests: the session's two entries. */
export function shopHistoryDebugState(): ShopHistory[] {
  return sHistory.map((h) => ({ ...h }));
}
