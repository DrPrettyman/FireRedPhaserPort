// item.c's TrySetObtainedItemQuestLogEvent: a story key item given by a script (ScrCmd_additem, so `giveitem` and
// the other macros over `additem`) records QL_EVENT_OBTAINED_STORY_ITEM. The items are questLog.json's storyItems
// (tools/extract_quest_log.py reads them from the C's condition).

import { K } from '../battle/constants';
import { questLogData, questLogHost } from './questLog';
import type { QuestLogEventStoryItem } from './questLogEventCodecs2';
import { SetQuestLogEvent } from './questLogEvents';

/** TrySetObtainedItemQuestLogEvent: only some key items trigger this event; the Town Map only in the rival's house. */
export function TrySetObtainedItemQuestLogEvent(itemId: number): void {
  const host = questLogHost();
  if (!host) return;
  if (!questLogData().storyItems.some((name) => K[name] === itemId)) return;
  if (itemId === K.ITEM_TOWN_MAP && host.location().mapId !== 'MAP_PALLET_TOWN_RIVALS_HOUSE') return;
  const data: QuestLogEventStoryItem = { itemId, mapSec: host.mapSec() }; // gMapHeader.regionMapSectionId
  SetQuestLogEvent(K.QL_EVENT_OBTAINED_STORY_ITEM, data as unknown as Record<string, unknown>);
}
