// quest_log_events.c's per-event codecs for QL_EVENT_* 30-40 (QUEST_LOG_PLAN.md QL3b): the battle events (gym
// leader, wild mons, Elite Four, champion, trainer), the field moves, the shops and the story items. Like QL3a's
// (questLogEventCodecs.ts): RecordEvent_* writes the event's data in the u16 stream as the C lays it out, LoadEvent_*
// (playback) expands its line into gStringVar4. questLogEvents.ts registers them (registerQuestLogEventCodecs2).
// DEPARTED (35) and ARRIVED (42) are QL1's; SCENE_END (39) and WAIT (41) are actions. quest_log_battle.c, which sends
// the battle events, is questLogBattle.ts.
//
// Two events don't use RecordEventHeader: DEFEATED_WILD_MON keeps one record per scene that later wild battles count
// into (gQuestLogDefeatedWildMonRecord), and DEFEATED_CHAMPION writes a fixed repeat count of 2 so the playback shows
// its three lines (QL_SkipCommand ignores the count).

import { K } from '../battle/constants';
import { bdata, state } from '../battle/env';
import { ConvertIntToDecimalStringN, encodeRaw, EOS, gStringVar1, gStringVar2, gStringVar3, ItemId_GetName, STR_CONV_MODE_LEFT_ALIGN, text } from '../menus/common';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from '../menus/dynamicPlaceholderText';
import { gQL, QL_IsRoomToSaveEvent, type ScriptPtr } from './questLog';
import {
  advance,
  d,
  dynamicExpandToStringVar4,
  expandToStringVar4,
  getByte,
  GetMapNameGeneric,
  putByte,
  QuestLog_GetSpeciesName,
  setWord,
  word,
} from './questLogEventCodecs';
import {
  gQuestLogRepeatEventTracker,
  gTrainerClass,
  LoadEvent,
  QL_DisableRecordingSteps,
  QL_DisableRecordingStepsUntilDepart,
  QL_EventCmdSize,
  RecordEventHeader,
  registerQuestLogEvent,
  type QuestLogEventData,
} from './questLogEvents';

// ------------------------------------------------------------------ the events' data (include/quest_log.h)

/** struct QuestLogEvent_TrainerBattle (gym leader, Elite Four, champion, trainer). hpFractionId: 0-2, how much HP the
 *  player's side kept (sDefeatedOpponentFlavorTexts / sDefeatedChampionFlavorTexts). */
export interface QuestLogEventTrainerBattle {
  trainerId: number;
  speciesOpponent: number;
  speciesPlayer: number;
  hpFractionId: number;
  mapSec: number;
}
/** struct QuestLogEvent_WildBattle (one of the species is SPECIES_NONE: defeated or caught) */
export interface QuestLogEventWildBattle {
  defeatedSpecies: number;
  caughtSpecies: number;
  mapSec: number;
}
/** struct QuestLogEvent_FieldMove (fieldMove: FIELD_MOVE_*; mapSec 0xFF for none) */
export interface QuestLogEventFieldMove {
  species: number;
  fieldMove: number;
  mapSec: number;
}
/** struct QuestLogEvent_Shop (shop.c's RecordTransactionForQuestLog fills it: QL4) */
export interface QuestLogEventShop {
  totalMoney: number;
  lastItemId: number;
  itemQuantity: number;
  mapSec: number;
  hasMultipleTransactions: boolean | number;
  logEventId?: number;
}
/** struct QuestLogEvent_StoryItem */
export interface QuestLogEventStoryItem {
  itemId: number;
  mapSec: number;
}

// ------------------------------------------------------------------ helpers

/** sDefeatedOpponentFlavorTexts[hpFractionId] */
function defeatedOpponentFlavorText(id: number): number[] {
  return text(['gText_QuestLog_Handily', 'gText_QuestLog_Tenaciously', 'gText_QuestLog_Somehow'][id] ?? 'gText_QuestLog_Handily');
}

/** sDefeatedChampionFlavorTexts[hpFractionId] */
function defeatedChampionFlavorText(id: number): number[] {
  return text(['gText_QuestLog_Coolly', 'gText_QuestLog_Somehow', 'gText_QuestLog_Barely'][id] ?? 'gText_QuestLog_Coolly');
}

/** gTrainers[trainerId].trainerName */
function trainerName(trainerId: number): number[] {
  return encodeRaw(bdata.tables.trainers[trainerId]?.trainerName ?? '');
}

/** gSaveBlock2Ptr->playerName */
const playerName = (): number[] => [...state.pokemon.encodeName(state.playerName), EOS];
/** gSaveBlock1Ptr->rivalName (GetExpandedPlaceholder(PLACEHOLDER_ID_RIVAL)) */
const rivalName = (): number[] => [...state.pokemon.encodeName(state.rivalName), EOS];

/** GetMapNameGeneric(gStringVar1, mapSec) and the string */
function mapNameToStringVar1(mapSec: number): number[] {
  gStringVar1.set(GetMapNameGeneric(mapSec));
  return [...gStringVar1.get(), EOS];
}
const stringVar = (v: typeof gStringVar1): number[] => [...v.get(), EOS];

// ------------------------------------------------------------------ the trainer battles

// record: [speciesOpponent, speciesPlayer, trainerId, mapSec | hpFractionId << 8]

/** RecordEvent_DefeatedTrainer */
function RecordEvent_DefeatedTrainer(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(eventId, dest);
  if (record === null) return null;
  const e = d<QuestLogEventTrainerBattle>(data);
  setWord(record, 0, e.speciesOpponent);
  setWord(record, 1, e.speciesPlayer);
  setWord(record, 2, e.trainerId);
  putByte(record, 6, e.mapSec);
  putByte(record, 7, e.hpFractionId);
  return advance(record, 4);
}

function RecordEvent_DefeatedGymLeader(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  QL_DisableRecordingSteps();
  return RecordEvent_DefeatedTrainer(K.QL_EVENT_DEFEATED_GYM_LEADER, dest, data);
}

function LoadEvent_DefeatedGymLeader(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_DEFEATED_GYM_LEADER, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, mapNameToStringVar1(getByte(record, 6)));
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, trainerName(word(record, 2)));
  QuestLog_GetSpeciesName(word(record, 0), null, 2);
  QuestLog_GetSpeciesName(word(record, 1), null, 3);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(4, defeatedOpponentFlavorText(getByte(record, 7)));
  dynamicExpandToStringVar4('gText_QuestLog_TookOnGymLeadersMonWithMonAndWon');
  return advance(record, 4);
}

function RecordEvent_DefeatedEliteFourMember(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  QL_DisableRecordingSteps();
  return RecordEvent_DefeatedTrainer(K.QL_EVENT_DEFEATED_E4_MEMBER, dest, data);
}

function LoadEvent_DefeatedEliteFourMember(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_DEFEATED_E4_MEMBER, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, trainerName(word(record, 2)));
  QuestLog_GetSpeciesName(word(record, 0), null, 1);
  QuestLog_GetSpeciesName(word(record, 1), null, 2);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(3, defeatedOpponentFlavorText(getByte(record, 7)));
  dynamicExpandToStringVar4('gText_QuestLog_TookOnEliteFoursMonWithMonAndWon');
  return advance(record, 4);
}

function RecordEvent_DefeatedNormalTrainer(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  QL_DisableRecordingSteps();
  return RecordEvent_DefeatedTrainer(K.QL_EVENT_DEFEATED_TRAINER, dest, data);
}

/** LoadEvent_DefeatedTrainer: the rival (and the champion's class) by the player's name for them */
function LoadEvent_DefeatedTrainer(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_DEFEATED_TRAINER, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, mapNameToStringVar1(getByte(record, 6)));
  const trainerId = word(record, 2);
  const trainerClass = gTrainerClass(trainerId);
  if (trainerClass === K.TRAINER_CLASS_RIVAL_EARLY || trainerClass === K.TRAINER_CLASS_RIVAL_LATE || trainerClass === K.TRAINER_CLASS_CHAMPION) {
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, rivalName());
  } else {
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, trainerName(trainerId));
  }
  QuestLog_GetSpeciesName(word(record, 0), null, 2);
  QuestLog_GetSpeciesName(word(record, 1), null, 3);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(4, defeatedOpponentFlavorText(getByte(record, 7)));
  dynamicExpandToStringVar4('gText_QuestLog_TookOnTrainersMonWithMonAndWon');
  return advance(record, 4);
}

// ------------------------------------------------------------------ QL_EVENT_DEFEATED_CHAMPION

// [id | 2 << 12, gQuestLogCurActionIdx, speciesOpponent, speciesPlayer, hpFractionId]

function RecordEvent_DefeatedChampion(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  if (!QL_IsRoomToSaveEvent(dest, QL_EventCmdSize(K.QL_EVENT_DEFEATED_CHAMPION))) return null;
  const e = d<QuestLogEventTrainerBattle>(data);
  // Event will run two additional times, for each state in LoadEvent_DefeatedChampion
  setWord(dest!, 0, K.QL_EVENT_DEFEATED_CHAMPION | (2 << 12));
  setWord(dest!, 1, gQL.curActionIdx);
  setWord(dest!, 2, e.speciesOpponent);
  setWord(dest!, 3, e.speciesPlayer);
  putByte(dest!, 8, e.hpFractionId);
  QL_DisableRecordingSteps();
  return advance(dest!, 5);
}

/** LoadEvent_DefeatedChampion: three lines, one per repeat (gQuestLogRepeatEventTracker.counter) */
function LoadEvent_DefeatedChampion(a0: ScriptPtr): ScriptPtr | null {
  if (!QL_IsRoomToSaveEvent(a0, QL_EventCmdSize(K.QL_EVENT_DEFEATED_CHAMPION))) return null;
  DynamicPlaceholderTextUtil_Reset();
  switch (gQuestLogRepeatEventTracker.counter) {
    case 0:
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, playerName());
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, rivalName());
      dynamicExpandToStringVar4('gText_QuestLog_PlayerBattledChampionRival');
      break;
    case 1:
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, rivalName());
      QuestLog_GetSpeciesName(word(a0, 2), null, 1);
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, playerName());
      QuestLog_GetSpeciesName(word(a0, 3), null, 3);
      dynamicExpandToStringVar4('gText_QuestLog_PlayerSentOutMon1RivalSentOutMon2');
      break;
    case 2:
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, defeatedChampionFlavorText(getByte(a0, 8)));
      dynamicExpandToStringVar4('gText_QuestLog_WonTheMatchAsAResult');
      break;
  }
  return advance(a0, 5);
}

// ------------------------------------------------------------------ QL_EVENT_DEFEATED_WILD_MON

// [id, gQuestLogCurActionIdx, defeatedSpecies, caughtSpecies, numDefeated | numCaught << 8, mapSec]: the counts and
// the map section go after sizeof(struct QuestLogEvent_WildBattle), which agbcc pads to 8 bytes (a struct's size is a
// multiple of 4 there), so at byte 8 of the command.
const WILD_FOOTER = 8;

/**
 * RecordEvent_DefeatedWildMon: `dest` is gQuestLogDefeatedWildMonRecord, the scene's one wild battle record, which
 * the header is written into only the first time (both counts zero); later wild battles update the species (the
 * last defeated / caught one is named) and count up to 255.
 */
function RecordEvent_DefeatedWildMon(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  if (!QL_IsRoomToSaveEvent(dest, QL_EventCmdSize(K.QL_EVENT_DEFEATED_WILD_MON))) return null;
  const body = dest!;
  const e = d<QuestLogEventWildBattle>(data);
  if (getByte(body, WILD_FOOTER) === 0 && getByte(body, WILD_FOOTER + 1) === 0) {
    setWord(body, 0, K.QL_EVENT_DEFEATED_WILD_MON);
    setWord(body, 1, gQL.curActionIdx);
  }
  if (e.defeatedSpecies !== K.SPECIES_NONE) setWord(body, 2, e.defeatedSpecies);
  if (e.caughtSpecies !== K.SPECIES_NONE) setWord(body, 3, e.caughtSpecies);
  if (e.defeatedSpecies !== K.SPECIES_NONE && getByte(body, WILD_FOOTER) !== 0xff) putByte(body, WILD_FOOTER, getByte(body, WILD_FOOTER) + 1);
  if (e.caughtSpecies !== K.SPECIES_NONE && getByte(body, WILD_FOOTER + 1) !== 0xff) putByte(body, WILD_FOOTER + 1, getByte(body, WILD_FOOTER + 1) + 1);
  putByte(body, WILD_FOOTER + 2, e.mapSec);
  return advance(body, (WILD_FOOTER + 4) / 2);
}

function LoadEvent_DefeatedWildMon(a0: ScriptPtr): ScriptPtr | null {
  if (!QL_IsRoomToSaveEvent(a0, QL_EventCmdSize(K.QL_EVENT_DEFEATED_WILD_MON))) return null;
  const numDefeated = getByte(a0, WILD_FOOTER);
  const numCaught = getByte(a0, WILD_FOOTER + 1);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, mapNameToStringVar1(getByte(a0, WILD_FOOTER + 2)));
  QuestLog_GetSpeciesName(word(a0, 2), null, 1);
  gStringVar2.set(ConvertIntToDecimalStringN(numDefeated, STR_CONV_MODE_LEFT_ALIGN, 3));
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, stringVar(gStringVar2));
  QuestLog_GetSpeciesName(word(a0, 3), null, 3);
  gStringVar3.set(ConvertIntToDecimalStringN(numCaught, STR_CONV_MODE_LEFT_ALIGN, 3));
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(4, stringVar(gStringVar3));
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(5, playerName());
  let symbol: string;
  if (numDefeated === 0) symbol = numCaught === 1 ? 'gText_QuestLog_CaughtWildMon' : 'gText_QuestLog_CaughtWildMons';
  else if (numCaught === 0) symbol = numDefeated === 1 ? 'gText_QuestLog_DefeatedWildMon' : 'gText_QuestLog_DefeatedWildMons';
  else if (numDefeated === 1) symbol = numCaught === 1 ? 'gText_QuestLog_DefeatedWildMonAndCaughtWildMon' : 'gText_QuestLog_DefeatedWildMonAndCaughtWildMons';
  else symbol = numCaught === 1 ? 'gText_QuestLog_DefeatedWildMonsAndCaughtWildMon' : 'gText_QuestLog_DefeatedWildMonsAndCaughtWildMons';
  dynamicExpandToStringVar4(symbol);
  return advance(a0, (WILD_FOOTER + 4) / 2);
}

// ------------------------------------------------------------------ QL_EVENT_USED_FIELD_MOVE

// [species, fieldMove | mapSec << 8]

/** sUsedFieldMoveTexts[FIELD_MOVE_*] */
const sUsedFieldMoveTexts = [
  'gText_QuestLog_UsedFlash',
  'gText_QuestLog_UsedCut',
  'gText_QuestLog_UsedFly',
  'gText_QuestLog_UsedStrength',
  'gText_QuestLog_UsedSurf',
  'gText_QuestLog_UsedRockSmash',
  'gText_QuestLog_UsedWaterfall',
  'gText_QuestLog_UsedTeleportToLocation',
  'gText_QuestLog_UsedDigInLocation',
  'gText_QuestLog_UsedMilkDrink',
  'gText_QuestLog_UsedSoftboiled',
  'gText_QuestLog_UsedSweetScent',
];

/** RecordEvent_UsedFieldMove: Teleport and Dig end the scene until the next departure, the others end it now */
function RecordEvent_UsedFieldMove(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_USED_FIELD_MOVE, dest);
  if (record === null) return null;
  const e = d<QuestLogEventFieldMove>(data);
  setWord(record, 0, e.species);
  putByte(record, 2, e.fieldMove);
  putByte(record, 3, e.mapSec);
  const fieldMove = e.fieldMove & 0xff;
  if (fieldMove === K.FIELD_MOVE_TELEPORT || fieldMove === K.FIELD_MOVE_DIG) QL_DisableRecordingStepsUntilDepart();
  else QL_DisableRecordingSteps();
  return advance(record, 2);
}

function LoadEvent_UsedFieldMove(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_USED_FIELD_MOVE, eventData);
  const fieldMove = getByte(record, 2);
  const mapSec = getByte(record, 3);
  QuestLog_GetSpeciesName(word(record, 0), gStringVar1, 0);
  if (mapSec !== 0xff) gStringVar2.set(GetMapNameGeneric(mapSec));
  // If used Teleport, get name of destination
  if (fieldMove === K.FIELD_MOVE_TELEPORT) {
    gStringVar3.set(text(mapSec === K.MAPSEC_PALLET_TOWN ? 'gText_QuestLog_Home' : 'gText_PokemonCenter'));
  }
  expandToStringVar4(sUsedFieldMoveTexts[fieldMove]);
  return advance(record, 2);
}

// ------------------------------------------------------------------ QL_EVENT_BOUGHT_ITEM, QL_EVENT_SOLD_ITEM

// [lastItemId, itemQuantity, totalMoney >> 16, totalMoney & 0xFFFF, mapSec | hasMultipleTransactions << 8]

function recordShop(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData, hasMultipleTransactions: number): ScriptPtr | null {
  const record = RecordEventHeader(eventId, dest);
  if (record === null) return null;
  const e = d<QuestLogEventShop>(data);
  setWord(record, 0, e.lastItemId);
  setWord(record, 1, e.itemQuantity);
  setWord(record, 2, (e.totalMoney >>> 16) & 0xffff);
  setWord(record, 3, e.totalMoney & 0xffff);
  putByte(record, 8, e.mapSec);
  putByte(record, 9, hasMultipleTransactions);
  return advance(record, 5);
}

/** RecordEvent_BoughtItem (hasMultipleTransactions is always written TRUE: the loader goes by the quantity) */
const RecordEvent_BoughtItem = (dest: ScriptPtr | null, data: QuestLogEventData) => recordShop(K.QL_EVENT_BOUGHT_ITEM, dest, data, 1);
const RecordEvent_SoldItem = (dest: ScriptPtr | null, data: QuestLogEventData) =>
  recordShop(K.QL_EVENT_SOLD_ITEM, dest, data, Number(d<QuestLogEventShop>(data).hasMultipleTransactions ?? 0));

/** (r4[2] << 16) + r4[3] */
const totalMoney = (record: ScriptPtr): number => word(record, 2) * 0x10000 + word(record, 3);

function LoadEvent_BoughtItem(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_BOUGHT_ITEM, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, mapNameToStringVar1(getByte(record, 8)));
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, ItemId_GetName(word(record, 0)));
  if (word(record, 1) < 2) {
    dynamicExpandToStringVar4('gText_QuestLog_BoughtItem');
  } else {
    gStringVar2.set(ConvertIntToDecimalStringN(totalMoney(record), STR_CONV_MODE_LEFT_ALIGN, 6));
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, stringVar(gStringVar2));
    dynamicExpandToStringVar4('gText_QuestLog_BoughtItemsIncludingItem');
  }
  return advance(record, 5);
}

/** LoadEvent_SoldItem: one transaction names the quantity ("just one" / the number), several the money */
function LoadEvent_SoldItem(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_SOLD_ITEM, eventData);
  DynamicPlaceholderTextUtil_Reset();
  const mapName = mapNameToStringVar1(getByte(record, 8));
  const quantity = word(record, 1);
  if (getByte(record, 9) === 0) {
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, playerName());
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, mapName);
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, ItemId_GetName(word(record, 0)));
    if (quantity === 1) {
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(3, text('gText_QuestLog_JustOne'));
    } else {
      gStringVar2.set(ConvertIntToDecimalStringN(quantity, STR_CONV_MODE_LEFT_ALIGN, 3));
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(4, stringVar(gStringVar2));
      gStringVar3.set(DynamicPlaceholderTextUtil_ExpandPlaceholders(text('gText_QuestLog_Num')));
      DynamicPlaceholderTextUtil_SetPlaceholderPtr(3, stringVar(gStringVar3));
    }
    dynamicExpandToStringVar4('gText_QuestLog_SoldNumOfItem');
  } else {
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, mapName);
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, ItemId_GetName(word(record, 0)));
    gStringVar2.set(ConvertIntToDecimalStringN(totalMoney(record), STR_CONV_MODE_LEFT_ALIGN, 6));
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, stringVar(gStringVar2));
    dynamicExpandToStringVar4('gText_QuestLog_SoldItemsIncludingItem');
  }
  return advance(record, 5);
}

// ------------------------------------------------------------------ QL_EVENT_OBTAINED_STORY_ITEM

// [itemId, mapSec]

function RecordEvent_ObtainedStoryItem(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_OBTAINED_STORY_ITEM, dest);
  if (record === null) return null;
  const e = d<QuestLogEventStoryItem>(data);
  setWord(record, 0, e.itemId);
  putByte(record, 2, e.mapSec);
  return advance(record, 2);
}

function LoadEvent_ObtainedStoryItem(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_OBTAINED_STORY_ITEM, eventData);
  gStringVar1.set(GetMapNameGeneric(getByte(record, 2)));
  gStringVar2.set(ItemId_GetName(word(record, 0)));
  expandToStringVar4('gText_QuestLog_ObtainedItemInLocation');
  return advance(record, 2);
}

// ------------------------------------------------------------------ the table

/** sRecordEventFuncs / sLoadEventFuncs for QL_EVENT_DEFEATED_GYM_LEADER .. QL_EVENT_OBTAINED_STORY_ITEM */
export function registerQuestLogEventCodecs2(): void {
  const table: [string, (dest: ScriptPtr | null, data: QuestLogEventData) => ScriptPtr | null, (eventData: ScriptPtr) => ScriptPtr | null][] = [
    ['QL_EVENT_DEFEATED_GYM_LEADER', RecordEvent_DefeatedGymLeader, LoadEvent_DefeatedGymLeader],
    ['QL_EVENT_DEFEATED_WILD_MON', RecordEvent_DefeatedWildMon, LoadEvent_DefeatedWildMon],
    ['QL_EVENT_DEFEATED_E4_MEMBER', RecordEvent_DefeatedEliteFourMember, LoadEvent_DefeatedEliteFourMember],
    ['QL_EVENT_DEFEATED_CHAMPION', RecordEvent_DefeatedChampion, LoadEvent_DefeatedChampion],
    ['QL_EVENT_DEFEATED_TRAINER', RecordEvent_DefeatedNormalTrainer, LoadEvent_DefeatedTrainer],
    ['QL_EVENT_USED_FIELD_MOVE', RecordEvent_UsedFieldMove, LoadEvent_UsedFieldMove],
    ['QL_EVENT_BOUGHT_ITEM', RecordEvent_BoughtItem, LoadEvent_BoughtItem],
    ['QL_EVENT_SOLD_ITEM', RecordEvent_SoldItem, LoadEvent_SoldItem],
    ['QL_EVENT_OBTAINED_STORY_ITEM', RecordEvent_ObtainedStoryItem, LoadEvent_ObtainedStoryItem],
  ];
  for (const [name, record, load] of table) registerQuestLogEvent(K[name], record, load);
}
