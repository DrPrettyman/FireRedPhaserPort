// quest_log_events.c's per-event codecs for QL_EVENT_* 3-29 (QUEST_LOG_PLAN.md QL3a): the party, item, held item,
// Pokémon Center, link, box and item PC events. Each has a RecordEvent_* (writes the event's data after
// RecordEventHeader, in the u16 stream as the C lays it out) and a LoadEvent_* (playback: reads the data of the
// repeat the tracker is on and expands the event's line into gStringVar4, as the C does, for the playback's
// description window). questLogEvents.ts registers them (registerQuestLogEventCodecs from ensureEventTables).
//
// Bytes go into the u16s little-endian (the C's u8 casts of the u16 record). The link events (12-19) write their own
// header and never repeat; nothing records them until link play. The menus' call sites are QL4a / QL4b.

import { K } from '../battle/constants';
import { moveName } from '../battle/message';
import { state } from '../battle/env';
import {
  CopyItemName,
  EOS,
  gStringVar1,
  gStringVar2,
  gStringVar3,
  ItemId_GetName,
  ItemId_GetPocket,
  setStringVar4,
  speciesName,
  StringExpandPlaceholders,
  text,
} from '../menus/common';
import { menusData } from '../menus/data';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from '../menus/dynamicPlaceholderText';
import { gQL, QL_IsRoomToSaveEvent, scriptOf, type ScriptPtr } from './questLog';
import {
  gQuestLogRepeatEventTracker,
  LoadEvent,
  QL_DisableRecordingStepsUntilDepart,
  QL_EventCmdSize,
  RecordEventHeader,
  registerQuestLogEvent,
  type QuestLogEventData,
} from './questLogEvents';
import { GetMapName } from './regionMap';

// ------------------------------------------------------------------ the events' data (include/quest_log.h)

/** struct QuestLogEvent_SwitchedPartyOrder */
export interface QuestLogEventSwitchedPartyOrder {
  species1: number;
  species2: number;
}
/** struct QuestLogEvent_Item (used item, gave / took held item, the item PC). itemParam: the Escape Rope's map
 *  section or a TM's forgotten move, 0xFFFF for none; species 0xFFFF for an item used on no Pokémon. */
export interface QuestLogEventItem {
  itemId: number;
  species?: number;
  itemParam?: number;
}
/** struct QuestLogEvent_SwappedHeldItem */
export interface QuestLogEventSwappedHeldItem {
  takenItemId: number;
  givenItemId: number;
  species: number;
}
/** struct QuestLogEvent_Traded (partnerName: the encoded name, PLAYER_NAME_LENGTH bytes) */
export interface QuestLogEventTraded {
  speciesSent: number;
  speciesReceived: number;
  partnerName: number[];
}
/** struct QuestLogEvent_LinkBattle (outcome: gBattleOutcome - 1, 0 won / 1 lost / 2 drew; playerNames: the partner, then the two opponents) */
export interface QuestLogEventLinkBattle {
  outcome: number;
  playerNames: number[][];
}
/** struct QuestLogEvent_MovedBoxMon (box TOTAL_BOXES_COUNT is the party) */
export interface QuestLogEventMovedBoxMon {
  species1: number;
  species2?: number;
  box1: number;
  box2?: number;
}

// ------------------------------------------------------------------ helpers

export const advance = (p: ScriptPtr, n: number): ScriptPtr => ({ scene: p.scene, pos: p.pos + n });

/** *((u8 *)record + offset) = value */
export function putByte(record: ScriptPtr, offset: number, value: number): void {
  const script = scriptOf(record);
  const pos = record.pos + (offset >> 1);
  const v = value & 0xff;
  script[pos] = offset & 1 ? (script[pos] & 0x00ff) | (v << 8) : (script[pos] & 0xff00) | v;
}

/** *((const u8 *)record + offset) */
export function getByte(record: ScriptPtr, offset: number): number {
  const w = scriptOf(record)[record.pos + (offset >> 1)] ?? 0;
  return offset & 1 ? (w >> 8) & 0xff : w & 0xff;
}

export const word = (record: ScriptPtr, i: number): number => scriptOf(record)[record.pos + i] ?? 0;
export const setWord = (record: ScriptPtr, i: number, v: number | undefined): void => {
  scriptOf(record)[record.pos + i] = Number(v ?? 0) & 0xffff;
};

/** memcpy(record + offset, name, PLAYER_NAME_LENGTH) */
function putName(record: ScriptPtr, offset: number, name: readonly number[] | undefined): void {
  for (let i = 0; i < K.PLAYER_NAME_LENGTH; i++) putByte(record, offset + i, name?.[i] ?? EOS);
}

/** memset(dest, EOS, PLAYER_NAME_LENGTH + 1); memcpy(dest, record + offset, PLAYER_NAME_LENGTH) */
function getName(record: ScriptPtr, offset: number): number[] {
  const dest = Array<number>(K.PLAYER_NAME_LENGTH + 1).fill(EOS);
  for (let i = 0; i < K.PLAYER_NAME_LENGTH; i++) dest[i] = getByte(record, offset + i);
  return dest;
}

/** StringCopy_PlayerName: up to PLAYER_NAME_LENGTH chars, then EOS */
function copyPlayerName(src: number[]): number[] {
  const dest: number[] = [];
  for (let i = 0; i < K.PLAYER_NAME_LENGTH && src[i] !== EOS; i++) dest.push(src[i]);
  dest.push(EOS);
  return dest;
}

/** TranslateLinkPartnersName: a Japanese partner's name ({JPN} ...) gets its {ENG} back after at most five chars. */
export function TranslateLinkPartnersName(dest: number[]): number[] {
  let i = 0;
  if (dest[i++] === K.EXT_CTRL_CODE_BEGIN && dest[i++] === K.EXT_CTRL_CODE_JPN) {
    for (let n = 0; n < 5; n++) {
      if (dest[i] === K.EXT_CTRL_CODE_BEGIN) break;
      i++;
    }
    dest[i++] = K.EXT_CTRL_CODE_BEGIN;
    dest[i++] = K.EXT_CTRL_CODE_ENG;
    dest[i++] = EOS;
  }
  return dest;
}

type StringVar = typeof gStringVar1;

/**
 * QuestLog_GetSpeciesName: the species' name (or the egg's) into a string var, or, with `dest` null, as the
 * {DYNAMIC stringVarId} placeholder.
 */
export function QuestLog_GetSpeciesName(species: number, dest: StringVar | null, stringVarId: number): void {
  const name = species !== K.SPECIES_EGG ? speciesName(species) : text('gText_EggNickname');
  if (dest !== null) dest.set(name);
  else DynamicPlaceholderTextUtil_SetPlaceholderPtr(stringVarId, name);
}

/** GetBoxNamePtr (NULL past the last box: the placeholder prints nothing) */
function GetBoxNamePtr(boxId: number): number[] {
  return state.storage.getBoxName(boxId) ?? [];
}

/** GetMapNameGeneric */
export function GetMapNameGeneric(mapSec: number): number[] {
  return GetMapName(mapSec, 0);
}

/** gMoveNames[ItemIdToBattleMoveId(itemId)] */
function tmhmMoveName(itemId: number): number[] {
  return moveName(menusData.tmhmMoves[itemId - K.ITEM_TM01_FOCUS_PUNCH]);
}

/** StringExpandPlaceholders(gStringVar4, gText_QuestLog_*) */
export function expandToStringVar4(symbol: string): void {
  setStringVar4(StringExpandPlaceholders(text(symbol)));
}

/** DynamicPlaceholderTextUtil_ExpandPlaceholders(gStringVar4, gText_QuestLog_*) */
export function dynamicExpandToStringVar4(symbol: string): void {
  setStringVar4(DynamicPlaceholderTextUtil_ExpandPlaceholders(text(symbol)));
}

/** sBattleOutcomeTexts[outcome] (the event's outcome is gBattleOutcome - 1: 0 won, 1 lost, 2 drew) */
function battleOutcomeText(outcome: number): number[] {
  const names = ['gText_QuestLog_Win', 'gText_QuestLog_Loss', 'gText_QuestLog_Draw'];
  return text(names[outcome] ?? names[0]);
}

/** The link events' header: [id, gQuestLogCurActionIdx] with no repeat count. */
function linkHeader(eventId: number, dest: ScriptPtr): void {
  setWord(dest, 0, eventId);
  setWord(dest, 1, gQL.curActionIdx);
}

export const d = <T>(data: QuestLogEventData) => data as unknown as T;

// ------------------------------------------------------------------ QL_EVENT_SWITCHED_PARTY_ORDER

function RecordEvent_SwitchedPartyOrder(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const r2 = RecordEventHeader(K.QL_EVENT_SWITCHED_PARTY_ORDER, dest);
  if (r2 === null) return null;
  const e = d<QuestLogEventSwitchedPartyOrder>(data);
  setWord(r2, 0, e.species1);
  setWord(r2, 1, e.species2);
  return advance(r2, 2);
}

function LoadEvent_SwitchedPartyOrder(eventData: ScriptPtr): ScriptPtr {
  const r4 = LoadEvent(K.QL_EVENT_SWITCHED_PARTY_ORDER, eventData);
  QuestLog_GetSpeciesName(word(r4, 0), gStringVar1, 0);
  QuestLog_GetSpeciesName(word(r4, 1), gStringVar2, 0);
  expandToStringVar4('gText_QuestLog_SwitchMon1WithMon2');
  return advance(r4, 2);
}

// ------------------------------------------------------------------ QL_EVENT_USED_ITEM

// record: [itemId, species, itemParam]
function RecordEvent_UsedItem(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_USED_ITEM, dest);
  if (record === null) return null;
  const e = d<QuestLogEventItem>(data);
  setWord(record, 0, e.itemId);
  setWord(record, 1, e.species);
  setWord(record, 2, e.itemParam);
  if (e.itemId === K.ITEM_ESCAPE_ROPE) QL_DisableRecordingStepsUntilDepart();
  return advance(record, 3);
}

function LoadEvent_UsedItem(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_USED_ITEM, eventData);
  const itemId = word(record, 0);
  const species = word(record, 1);
  const itemParam = word(record, 2);
  switch (ItemId_GetPocket(itemId)) {
    case K.POCKET_ITEMS:
    case K.POCKET_POKE_BALLS:
    case K.POCKET_BERRY_POUCH:
      gStringVar1.set(ItemId_GetName(itemId));
      if (itemId === K.ITEM_ESCAPE_ROPE) {
        gStringVar2.set(GetMapNameGeneric(itemParam & 0xff));
        expandToStringVar4('gText_QuestLog_UsedEscapeRope');
      } else if (species !== 0xffff) {
        QuestLog_GetSpeciesName(species, gStringVar2, 0);
        expandToStringVar4('gText_QuestLog_UsedItemOnMonAtThisLocation');
      } else {
        expandToStringVar4('gText_QuestLog_UsedTheItem');
      }
      break;
    case K.POCKET_KEY_ITEMS:
      gStringVar1.set(ItemId_GetName(itemId));
      expandToStringVar4('gText_QuestLog_UsedTheKeyItem');
      break;
    case K.POCKET_TM_CASE:
      QuestLog_GetSpeciesName(species, gStringVar1, 0);
      gStringVar2.set(tmhmMoveName(itemId));
      if (itemParam !== 0xffff) {
        gStringVar3.set(moveName(itemParam));
        expandToStringVar4(itemId >= K.ITEM_HM01 ? 'gText_QuestLog_MonReplacedMoveWithHM' : 'gText_QuestLog_MonReplacedMoveWithTM');
      } else {
        expandToStringVar4(itemId >= K.ITEM_HM01 ? 'gText_QuestLog_MonLearnedMoveFromHM' : 'gText_QuestLog_MonLearnedMoveFromTM');
      }
      break;
  }
  return advance(record, 3);
}

// ------------------------------------------------------------------ QL_EVENT_GAVE_HELD_ITEM(_BAG / _PC), TOOK_HELD_ITEM

/** RecordEvent_GiveTakeHeldItem: [itemId, species] */
function RecordEvent_GiveTakeHeldItem(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(eventId, dest);
  if (record === null) return null;
  const e = d<QuestLogEventItem>(data);
  setWord(record, 0, e.itemId);
  setWord(record, 1, e.species);
  return advance(record, 2);
}

/** The held item loaders: the species and the item into two string vars, then the text. */
function loadGiveTakeHeldItem(eventId: number, eventData: ScriptPtr, speciesVar: StringVar, itemVar: StringVar, symbol: string): ScriptPtr {
  const record = LoadEvent(eventId, eventData);
  QuestLog_GetSpeciesName(word(record, 1), speciesVar, 0);
  itemVar.set(ItemId_GetName(word(record, 0)));
  expandToStringVar4(symbol);
  return advance(record, 2);
}

const RecordEvent_GaveHeldItemFromPartyMenu = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_GiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM, dest, data);
const LoadEvent_GaveHeldItemFromPartyMenu = (eventData: ScriptPtr) =>
  loadGiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM, eventData, gStringVar1, gStringVar2, 'gText_QuestLog_GaveMonHeldItem');

const RecordEvent_GaveHeldItemFromBagMenu = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_GiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM_BAG, dest, data);
const LoadEvent_GaveHeldItemFromBagMenu = (eventData: ScriptPtr) =>
  loadGiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM_BAG, eventData, gStringVar1, gStringVar2, 'gText_QuestLog_GaveMonHeldItem2');

const RecordEvent_GaveHeldItemFromPC = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_GiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM_PC, dest, data);
// (the species goes in STR_VAR_2 and the item in STR_VAR_1 here)
const LoadEvent_GaveHeldItemFromPC = (eventData: ScriptPtr) =>
  loadGiveTakeHeldItem(K.QL_EVENT_GAVE_HELD_ITEM_PC, eventData, gStringVar2, gStringVar1, 'gText_QuestLog_GaveMonHeldItemFromPC');

const RecordEvent_TookHeldItem = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_GiveTakeHeldItem(K.QL_EVENT_TOOK_HELD_ITEM, dest, data);
const LoadEvent_TookHeldItem = (eventData: ScriptPtr) =>
  loadGiveTakeHeldItem(K.QL_EVENT_TOOK_HELD_ITEM, eventData, gStringVar1, gStringVar2, 'gText_QuestLog_TookHeldItemFromMon');

// ------------------------------------------------------------------ QL_EVENT_SWAPPED_HELD_ITEM(_PC)

/** RecordEvent_SwappedHeldItem: [takenItemId, givenItemId, species] */
function RecordEvent_SwappedHeldItem(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(eventId, dest);
  if (record === null) return null;
  const e = d<QuestLogEventSwappedHeldItem>(data);
  setWord(record, 0, e.takenItemId);
  setWord(record, 1, e.givenItemId);
  setWord(record, 2, e.species);
  return advance(record, 3);
}

const RecordEvent_SwappedHeldItemFromBag = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_SwappedHeldItem(K.QL_EVENT_SWAPPED_HELD_ITEM, dest, data);

function LoadEvent_SwappedHeldItem(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_SWAPPED_HELD_ITEM, eventData);
  QuestLog_GetSpeciesName(word(record, 2), gStringVar1, 0);
  gStringVar2.set(ItemId_GetName(word(record, 0)));
  gStringVar3.set(ItemId_GetName(word(record, 1)));
  expandToStringVar4('gText_QuestLog_SwappedHeldItemsOnMon');
  return advance(record, 3);
}

const RecordEvent_SwappedHeldItemFromPC = (dest: ScriptPtr | null, data: QuestLogEventData) => RecordEvent_SwappedHeldItem(K.QL_EVENT_SWAPPED_HELD_ITEM_PC, dest, data);

function LoadEvent_SwappedHeldItemFromPC(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_SWAPPED_HELD_ITEM_PC, eventData);
  QuestLog_GetSpeciesName(word(record, 2), gStringVar2, 0);
  gStringVar3.set(ItemId_GetName(word(record, 0)));
  gStringVar1.set(ItemId_GetName(word(record, 1)));
  expandToStringVar4('gText_QuestLog_SwappedHeldItemFromPC');
  return advance(record, 3);
}

// ------------------------------------------------------------------ QL_EVENT_USED_PKMN_CENTER

/** RecordEvent_UsedPkmnCenter: just the header; a second visit at the same action index writes nothing. */
function RecordEvent_UsedPkmnCenter(dest: ScriptPtr | null, _data: QuestLogEventData): ScriptPtr | null {
  if (gQuestLogRepeatEventTracker.id === K.QL_EVENT_USED_PKMN_CENTER && gQuestLogRepeatEventTracker.numRepeats !== 0) return dest;
  if (!QL_IsRoomToSaveEvent(dest, QL_EventCmdSize(K.QL_EVENT_USED_PKMN_CENTER))) return null;
  linkHeader(K.QL_EVENT_USED_PKMN_CENTER, dest!);
  return advance(dest!, 2);
}

function LoadEvent_UsedPkmnCenter(eventData: ScriptPtr): ScriptPtr {
  expandToStringVar4('gText_QuestLog_MonsWereFullyRestoredAtCenter');
  return advance(eventData, 2);
}

// ------------------------------------------------------------------ the link events (12-19)

/** RecordEvent_LinkTraded(UnionRoom): [id, idx, speciesSent, speciesReceived] + the partner's name (7 bytes in 8) */
function recordLinkTraded(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  if (dest === null) return null;
  const e = d<QuestLogEventTraded>(data);
  linkHeader(eventId, dest);
  setWord(dest, 2, e.speciesSent);
  setWord(dest, 3, e.speciesReceived);
  putName(dest, 8, e.partnerName);
  return advance(dest, 8);
}

function loadLinkTraded(eventData: ScriptPtr, symbol: string): ScriptPtr {
  gStringVar1.set(TranslateLinkPartnersName(getName(eventData, 8)));
  QuestLog_GetSpeciesName(word(eventData, 3), gStringVar2, 0); // Mon received
  QuestLog_GetSpeciesName(word(eventData, 2), gStringVar3, 0); // Mon sent
  expandToStringVar4(symbol);
  return advance(eventData, 8);
}

const RecordEvent_LinkTraded = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkTraded(K.QL_EVENT_LINK_TRADED, dest, data);
const LoadEvent_LinkTraded = (eventData: ScriptPtr) => loadLinkTraded(eventData, 'gText_QuestLog_TradedMon1ForPersonsMon2');
const RecordEvent_LinkTradedUnionRoom = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkTraded(K.QL_EVENT_LINK_TRADED_UNION, dest, data);
const LoadEvent_LinkTradedUnionRoom = (eventData: ScriptPtr) => loadLinkTraded(eventData, 'gText_QuestLog_TradedMon1ForTrainersMon2');

// record (bytes, after the header): rOutcome, then rBattler1Name (and rBattler2Name / rBattler3Name for a multi)
const B_OUTCOME = 4;
const B_NAME = (n: number) => B_OUTCOME + 1 + K.PLAYER_NAME_LENGTH * n;

/** RecordEvent_LinkBattledSingle / _Double / _UnionRoom: the outcome and the opponent's name (8 bytes) */
function recordLinkBattle(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData, names: number): ScriptPtr | null {
  if (dest === null) return null;
  const e = d<QuestLogEventLinkBattle>(data);
  linkHeader(eventId, dest);
  putByte(dest, B_OUTCOME, e.outcome);
  for (let n = 0; n < names; n++) putName(dest, B_NAME(n), e.playerNames?.[n]);
  return advance(dest, 2 + (1 + K.PLAYER_NAME_LENGTH * names) / 2);
}

function loadLinkBattle(eventData: ScriptPtr, symbol: string): ScriptPtr {
  DynamicPlaceholderTextUtil_Reset();
  const name = TranslateLinkPartnersName(getName(eventData, B_NAME(0)));
  gStringVar1.set(name);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, name);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, battleOutcomeText(getByte(eventData, B_OUTCOME)));
  dynamicExpandToStringVar4(symbol);
  return advance(eventData, 6);
}

const RecordEvent_LinkBattledSingle = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkBattle(K.QL_EVENT_LINK_BATTLED_SINGLE, dest, data, 1);
const LoadEvent_LinkBattledSingle = (eventData: ScriptPtr) => loadLinkBattle(eventData, 'gText_QuestLog_SingleBattleWithPersonResultedInOutcome');
const RecordEvent_LinkBattledDouble = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkBattle(K.QL_EVENT_LINK_BATTLED_DOUBLE, dest, data, 1);
const LoadEvent_LinkBattledDouble = (eventData: ScriptPtr) => loadLinkBattle(eventData, 'gText_QuestLog_DoubleBattleWithPersonResultedInOutcome');
const RecordEvent_LinkBattledMulti = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkBattle(K.QL_EVENT_LINK_BATTLED_MULTI, dest, data, 3);
const RecordEvent_LinkBattledUnionRoom = (dest: ScriptPtr | null, data: QuestLogEventData) => recordLinkBattle(K.QL_EVENT_LINK_BATTLED_UNION, dest, data, 1);

function LoadEvent_LinkBattledMulti(eventData: ScriptPtr): ScriptPtr {
  DynamicPlaceholderTextUtil_Reset();
  const names = [0, 1, 2].map((n) => TranslateLinkPartnersName(copyPlayerName(getName(eventData, B_NAME(n)))));
  gStringVar1.set(names[0]);
  gStringVar2.set(names[1]);
  gStringVar3.set(names[2]);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, [...state.pokemon.encodeName(state.playerName), EOS]); // gSaveBlock2Ptr->playerName
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, names[0]); // partner
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, names[1]); // opponent 1
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(3, names[2]); // opponent 2
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(4, battleOutcomeText(getByte(eventData, B_OUTCOME)));
  dynamicExpandToStringVar4('gText_QuestLog_MultiBattleWithPeopleResultedInOutcome');
  return advance(eventData, 2 + (1 + K.PLAYER_NAME_LENGTH * 3) / 2);
}

function LoadEvent_LinkBattledUnionRoom(eventData: ScriptPtr): ScriptPtr {
  gStringVar1.set(TranslateLinkPartnersName(getName(eventData, B_NAME(0))));
  gStringVar2.set(battleOutcomeText(getByte(eventData, B_OUTCOME)));
  expandToStringVar4('gText_QuestLog_BattledTrainerEndedInOutcome');
  return advance(eventData, 6);
}

/** RecordEvent_UsedUnionRoom(Chat): just the header (no data) */
function recordHeaderOnly(eventId: number, dest: ScriptPtr | null): ScriptPtr | null {
  if (dest === null) return null;
  linkHeader(eventId, dest);
  return advance(dest, 2);
}

const RecordEvent_UsedUnionRoom = (dest: ScriptPtr | null) => recordHeaderOnly(K.QL_EVENT_USED_UNION_ROOM, dest);
const RecordEvent_UsedUnionRoomChat = (dest: ScriptPtr | null) => recordHeaderOnly(K.QL_EVENT_USED_UNION_ROOM_CHAT, dest);
function LoadEvent_UsedUnionRoom(eventData: ScriptPtr): ScriptPtr {
  expandToStringVar4('gText_QuestLog_MingledInUnionRoom');
  return advance(eventData, 2);
}
function LoadEvent_UsedUnionRoomChat(eventData: ScriptPtr): ScriptPtr {
  expandToStringVar4('gText_QuestLog_ChattedWithManyTrainers');
  return advance(eventData, 2);
}

// ------------------------------------------------------------------ the box events (20-27)

// record: [species1, species2, box1 | box2 << 8] (the C reads the data as struct QuestLogEvent_MovedBoxMon's bytes)

function RecordEvent_SwitchedMonsBetweenBoxes(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES, dest);
  if (record === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  setWord(record, 0, e.species1);
  setWord(record, 1, e.species2);
  putByte(record, 4, e.box1);
  putByte(record, 5, e.box2 ?? 0);
  return advance(record, 3);
}

function LoadEvent_SwitchedMonsBetweenBoxes(eventData: ScriptPtr): ScriptPtr {
  const r0 = LoadEvent(K.QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, GetBoxNamePtr(getByte(r0, 4)));
  QuestLog_GetSpeciesName(word(r0, 0), null, 1);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, GetBoxNamePtr(getByte(r0, 5)));
  QuestLog_GetSpeciesName(word(r0, 1), null, 3);
  dynamicExpandToStringVar4('gText_QuestLog_SwitchedMonsBetweenBoxes');
  return advance(r0, 3);
}

function RecordEvent_SwitchedMonsWithinBox(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_SWITCHED_MONS_WITHIN_BOX, dest);
  if (record === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  setWord(record, 0, e.species1);
  setWord(record, 1, e.species2);
  putByte(record, 4, e.box1);
  return advance(record, 3);
}

/** The box loaders with the box in placeholder 0 and two species in 1 and 2. */
function loadBoxAndTwoSpecies(eventId: number, eventData: ScriptPtr, symbol: string): ScriptPtr {
  const record = LoadEvent(eventId, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, GetBoxNamePtr(getByte(record, 4)));
  QuestLog_GetSpeciesName(word(record, 0), null, 1);
  QuestLog_GetSpeciesName(word(record, 1), null, 2);
  dynamicExpandToStringVar4(symbol);
  return advance(record, 3);
}

const LoadEvent_SwitchedMonsWithinBox = (eventData: ScriptPtr) => loadBoxAndTwoSpecies(K.QL_EVENT_SWITCHED_MONS_WITHIN_BOX, eventData, 'gText_QuestLog_SwitchedMonsWithinBox');

/** RecordEvent_SwitchedPartyMonForPCMon: the box mon first (the data's two are swapped when box1 is the party). */
function RecordEvent_SwitchedPartyMonForPCMon(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const r2 = RecordEventHeader(K.QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON, dest);
  if (r2 === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  if (e.box1 === K.TOTAL_BOXES_COUNT) {
    setWord(r2, 0, e.species2);
    setWord(r2, 1, e.species1);
    putByte(r2, 4, e.box2 ?? 0);
  } else {
    setWord(r2, 0, e.species1);
    setWord(r2, 1, e.species2);
    putByte(r2, 4, e.box1);
  }
  return advance(r2, 3);
}

const LoadEvent_SwitchedPartyMonForPCMon = (eventData: ScriptPtr) =>
  loadBoxAndTwoSpecies(K.QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON, eventData, 'gText_QuestLog_SwitchedPartyMonForPCMon');

function RecordEvent_MovedMonBetweenBoxes(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const r2 = RecordEventHeader(K.QL_EVENT_MOVED_MON_BETWEEN_BOXES, dest);
  if (r2 === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  setWord(r2, 0, e.species1);
  putByte(r2, 2, e.box1);
  putByte(r2, 3, e.box2 ?? 0);
  return advance(r2, 2);
}

function LoadEvent_MovedMonBetweenBoxes(eventData: ScriptPtr): ScriptPtr {
  const record = LoadEvent(K.QL_EVENT_MOVED_MON_BETWEEN_BOXES, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, GetBoxNamePtr(getByte(record, 2)));
  QuestLog_GetSpeciesName(word(record, 0), null, 1);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(2, GetBoxNamePtr(getByte(record, 3)));
  dynamicExpandToStringVar4('gText_QuestLog_MovedMonToNewBox');
  return advance(record, 2);
}

/** RecordEvent_MovedMonWithinBox / WithdrewMonFromPC / DepositedMonInPC: [species1, box1] */
function recordMonAndBox(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const r2 = RecordEventHeader(eventId, dest);
  if (r2 === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  setWord(r2, 0, e.species1);
  putByte(r2, 2, e.box1);
  return advance(r2, 2);
}

/** The box in placeholder 0 and the species in 1 (DepositedMonInPC: the other way round). */
function loadMonAndBox(eventId: number, eventData: ScriptPtr, symbol: string, speciesFirst = false): ScriptPtr {
  const record = LoadEvent(eventId, eventData);
  DynamicPlaceholderTextUtil_Reset();
  if (speciesFirst) {
    QuestLog_GetSpeciesName(word(record, 0), null, 0);
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, GetBoxNamePtr(getByte(record, 2)));
  } else {
    DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, GetBoxNamePtr(getByte(record, 2)));
    QuestLog_GetSpeciesName(word(record, 0), null, 1);
  }
  dynamicExpandToStringVar4(symbol);
  return advance(record, 2);
}

const RecordEvent_MovedMonWithinBox = (dest: ScriptPtr | null, data: QuestLogEventData) => recordMonAndBox(K.QL_EVENT_MOVED_MON_WITHIN_BOX, dest, data);
const LoadEvent_MovedMonWithinBox = (eventData: ScriptPtr) => loadMonAndBox(K.QL_EVENT_MOVED_MON_WITHIN_BOX, eventData, 'gText_QuestLog_MovedMonWithinBox');
const RecordEvent_WithdrewMonFromPC = (dest: ScriptPtr | null, data: QuestLogEventData) => recordMonAndBox(K.QL_EVENT_WITHDREW_MON_PC, dest, data);
const LoadEvent_WithdrewMonFromPC = (eventData: ScriptPtr) => loadMonAndBox(K.QL_EVENT_WITHDREW_MON_PC, eventData, 'gText_QuestLog_WithdrewMonFromPC');
const RecordEvent_DepositedMonInPC = (dest: ScriptPtr | null, data: QuestLogEventData) => recordMonAndBox(K.QL_EVENT_DEPOSITED_MON_PC, dest, data);
const LoadEvent_DepositedMonInPC = (eventData: ScriptPtr) => loadMonAndBox(K.QL_EVENT_DEPOSITED_MON_PC, eventData, 'gText_QuestLog_DepositedMonInPC', true);

/** RecordEvent_SwitchedMultipleMons: [box1 | box2 << 8] */
function RecordEvent_SwitchedMultipleMons(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const r2 = RecordEventHeader(K.QL_EVENT_SWITCHED_MULTIPLE_MONS, dest);
  if (r2 === null) return null;
  const e = d<QuestLogEventMovedBoxMon>(data);
  putByte(r2, 0, e.box1);
  putByte(r2, 1, e.box2 ?? 0);
  return advance(r2, 1);
}

function LoadEvent_SwitchedMultipleMons(eventData: ScriptPtr): ScriptPtr {
  const r4 = LoadEvent(K.QL_EVENT_SWITCHED_MULTIPLE_MONS, eventData);
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, GetBoxNamePtr(getByte(r4, 0)));
  if (getByte(r4, 0) === getByte(r4, 1)) DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, text('gText_QuestLog_ADifferentSpot'));
  else DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, GetBoxNamePtr(getByte(r4, 1)));
  dynamicExpandToStringVar4('gText_QuestLog_SwitchedMultipleMons');
  return advance(r4, 1);
}

// ------------------------------------------------------------------ QL_EVENT_DEPOSITED_ITEM_PC, WITHDREW_ITEM_PC

/** [itemId] */
function recordItemPC(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(eventId, dest);
  if (record === null) return null;
  setWord(record, 0, d<QuestLogEventItem>(data).itemId);
  return advance(record, 1);
}

function loadItemPC(eventId: number, eventData: ScriptPtr, symbol: string): ScriptPtr {
  const record = LoadEvent(eventId, eventData);
  gStringVar1.set(CopyItemName(word(record, 0)));
  expandToStringVar4(symbol);
  return advance(record, 1);
}

const RecordEvent_DepositedItemInPC = (dest: ScriptPtr | null, data: QuestLogEventData) => recordItemPC(K.QL_EVENT_DEPOSITED_ITEM_PC, dest, data);
const LoadEvent_DepositedItemInPC = (eventData: ScriptPtr) => loadItemPC(K.QL_EVENT_DEPOSITED_ITEM_PC, eventData, 'gText_QuestLog_StoredItemInPC');
const RecordEvent_WithdrewItemFromPC = (dest: ScriptPtr | null, data: QuestLogEventData) => recordItemPC(K.QL_EVENT_WITHDREW_ITEM_PC, dest, data);
const LoadEvent_WithdrewItemFromPC = (eventData: ScriptPtr) => loadItemPC(K.QL_EVENT_WITHDREW_ITEM_PC, eventData, 'gText_QuestLog_WithdrewItemFromPC');

// ------------------------------------------------------------------ the table

/** sRecordEventFuncs / sLoadEventFuncs for QL_EVENT_SWITCHED_PARTY_ORDER .. QL_EVENT_WITHDREW_ITEM_PC */
export function registerQuestLogEventCodecs(): void {
  const table: [string, (dest: ScriptPtr | null, data: QuestLogEventData) => ScriptPtr | null, (eventData: ScriptPtr) => ScriptPtr][] = [
    ['QL_EVENT_SWITCHED_PARTY_ORDER', RecordEvent_SwitchedPartyOrder, LoadEvent_SwitchedPartyOrder],
    ['QL_EVENT_USED_ITEM', RecordEvent_UsedItem, LoadEvent_UsedItem],
    ['QL_EVENT_GAVE_HELD_ITEM', RecordEvent_GaveHeldItemFromPartyMenu, LoadEvent_GaveHeldItemFromPartyMenu],
    ['QL_EVENT_GAVE_HELD_ITEM_BAG', RecordEvent_GaveHeldItemFromBagMenu, LoadEvent_GaveHeldItemFromBagMenu],
    ['QL_EVENT_GAVE_HELD_ITEM_PC', RecordEvent_GaveHeldItemFromPC, LoadEvent_GaveHeldItemFromPC],
    ['QL_EVENT_TOOK_HELD_ITEM', RecordEvent_TookHeldItem, LoadEvent_TookHeldItem],
    ['QL_EVENT_SWAPPED_HELD_ITEM', RecordEvent_SwappedHeldItemFromBag, LoadEvent_SwappedHeldItem],
    ['QL_EVENT_SWAPPED_HELD_ITEM_PC', RecordEvent_SwappedHeldItemFromPC, LoadEvent_SwappedHeldItemFromPC],
    ['QL_EVENT_USED_PKMN_CENTER', RecordEvent_UsedPkmnCenter, LoadEvent_UsedPkmnCenter],
    ['QL_EVENT_LINK_TRADED', RecordEvent_LinkTraded, LoadEvent_LinkTraded],
    ['QL_EVENT_LINK_BATTLED_SINGLE', RecordEvent_LinkBattledSingle, LoadEvent_LinkBattledSingle],
    ['QL_EVENT_LINK_BATTLED_DOUBLE', RecordEvent_LinkBattledDouble, LoadEvent_LinkBattledDouble],
    ['QL_EVENT_LINK_BATTLED_MULTI', RecordEvent_LinkBattledMulti, LoadEvent_LinkBattledMulti],
    ['QL_EVENT_USED_UNION_ROOM', RecordEvent_UsedUnionRoom, LoadEvent_UsedUnionRoom],
    ['QL_EVENT_USED_UNION_ROOM_CHAT', RecordEvent_UsedUnionRoomChat, LoadEvent_UsedUnionRoomChat],
    ['QL_EVENT_LINK_TRADED_UNION', RecordEvent_LinkTradedUnionRoom, LoadEvent_LinkTradedUnionRoom],
    ['QL_EVENT_LINK_BATTLED_UNION', RecordEvent_LinkBattledUnionRoom, LoadEvent_LinkBattledUnionRoom],
    ['QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES', RecordEvent_SwitchedMonsBetweenBoxes, LoadEvent_SwitchedMonsBetweenBoxes],
    ['QL_EVENT_SWITCHED_MONS_WITHIN_BOX', RecordEvent_SwitchedMonsWithinBox, LoadEvent_SwitchedMonsWithinBox],
    ['QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON', RecordEvent_SwitchedPartyMonForPCMon, LoadEvent_SwitchedPartyMonForPCMon],
    ['QL_EVENT_MOVED_MON_BETWEEN_BOXES', RecordEvent_MovedMonBetweenBoxes, LoadEvent_MovedMonBetweenBoxes],
    ['QL_EVENT_MOVED_MON_WITHIN_BOX', RecordEvent_MovedMonWithinBox, LoadEvent_MovedMonWithinBox],
    ['QL_EVENT_WITHDREW_MON_PC', RecordEvent_WithdrewMonFromPC, LoadEvent_WithdrewMonFromPC],
    ['QL_EVENT_DEPOSITED_MON_PC', RecordEvent_DepositedMonInPC, LoadEvent_DepositedMonInPC],
    ['QL_EVENT_SWITCHED_MULTIPLE_MONS', RecordEvent_SwitchedMultipleMons, LoadEvent_SwitchedMultipleMons],
    ['QL_EVENT_DEPOSITED_ITEM_PC', RecordEvent_DepositedItemInPC, LoadEvent_DepositedItemInPC],
    ['QL_EVENT_WITHDREW_ITEM_PC', RecordEvent_WithdrewItemFromPC, LoadEvent_WithdrewItemFromPC],
  ];
  for (const [name, record, load] of table) registerQuestLogEvent(K[name], record, load);
}
