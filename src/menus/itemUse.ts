// item_use.c: what Use does for each item, from the bag (tasks' data[3] == 0) and in battle. The
// functions are looked up by the names in the item table (fieldUseFunc / battleUseFunc). Uses that
// need overworld systems that don't exist yet (Itemfinder, VS Seeker, Fame Checker, Teachy TV, mail,
// TM case, berry pouch) aren't in the tables; the bag logs them.

import { K } from '../battle/constants';
import { g, state } from '../battle/env';
import { Battle_PrintStatBoosterEffectMessage, ExecuteTableBasedItemEffect } from '../battle/items';
import type { MainCallback } from '../gba/main';
import { A_BUTTON, B_BUTTON, JOY_NEW } from '../gba/main';
import { IsSEPlaying, PlayFanfareByFanfareNum, PlaySE, WaitFanfare } from '../gba/sound';
import { gTasks, type TaskFunc } from '../gba/task';
import {
  CalculatePlayerPartyCount,
  ConvertIntToDecimalStringN,
  CopyItemName,
  ExpandToStringVar4,
  gStringVar1,
  gStringVar2,
  gStringVar4,
  GetPocketByItemId,
  ItemId_GetHoldEffectParam,
  ItemId_GetPocket,
  ItemId_GetSecondaryId,
  ItemId_GetType,
  RemoveBagItem,
  STR_CONV_MODE_LEFT_ALIGN,
  text,
} from './common';
import { CB2_ReturnToField, gFieldCallback, type FieldCallbackHost } from './fieldCallbacks';
import { GetOnOffBike, IsBikingDisallowedByPlayer } from '../world/bike';
import { avatarField, ClearPlayerHeldMovement, PLAYER_AVATAR_FLAG } from '../world/playerAvatar';
import {
  Bag_BeginCloseWin0Animation,
  CB2_BagMenuFromStartMenu,
  DisplayItemMessageInBag,
  ItemMenu_SetExitCallback,
  ItemMenu_StartFadeToExitCallback,
  Pocket_CalculateNItemsAndMaxShowed,
  PocketCalculateInitialCursorPosAndItemsAbove,
  Task_ReturnToBagFromContextMenu,
} from './itemMenu';
import { SpecialVar } from './itemMenuState';
import { InitRegionMapWithExitCB, REGIONMAP_TYPE_NORMAL } from './regionMap';
import {
  CB2_ShowPartyMenuForItemUse,
  EnterPartyFromItemMenuInBattle,
  GetItemEffectType,
  ItemUseCB_EvolutionStone,
  ItemUseCB_Medicine,
  ItemUseCB_MedicineStep,
  ItemUseCB_PPUp,
  ItemUseCB_RareCandy,
  ItemUseCB_SacredAsh,
  ItemUseCB_TryRestorePP,
  setItemUseCB,
} from './partyMenu';

/** sExitCallbackByItemType[ITEM_TYPE_* - 1] */
function sExitCallbackByItemType(itemType: number): MainCallback | null {
  if (itemType === K.ITEM_TYPE_PARTY_MENU - 1) return CB2_ShowPartyMenuForItemUse;
  if (itemType === K.ITEM_TYPE_FIELD - 1) return CB2_ReturnToField;
  return null;
}

function SetUpItemUseCallback(taskId: number): void {
  let itemType: number;
  if (SpecialVar.ItemId === K.ITEM_ENIGMA_BERRY) itemType = gTasks[taskId].data[4] - 1;
  else itemType = ItemId_GetType(SpecialVar.ItemId) - 1;
  if (GetPocketByItemId(SpecialVar.ItemId) === K.POCKET_BERRY_POUCH) {
    console.warn('[item_use] the berry pouch is not implemented');
    Task_ReturnToBagFromContextMenu(taskId);
    return;
  }
  ItemMenu_SetExitCallback(sExitCallbackByItemType(itemType));
  if (itemType === K.ITEM_TYPE_FIELD - 1) Bag_BeginCloseWin0Animation();
  ItemMenu_StartFadeToExitCallback(taskId);
}

function DisplayItemMessageInCurrentContext(taskId: number, inField: boolean, fontId: number, str: number[]): void {
  ExpandToStringVar4(str);
  if (!inField) DisplayItemMessageInBag(taskId, fontId, gStringVar4, Task_ReturnToBagFromContextMenu);
  else console.warn('[item_use] using registered items from the field is not implemented');
}

function PrintNotTheTimeToUseThat(taskId: number, inField: boolean): void {
  DisplayItemMessageInCurrentContext(taskId, inField, K.FONT_MALE, text('gText_OakForbidsUseOfItemHere'));
}

/** CheckIfItemIsTMHMOrEvolutionStone: 1 = TM/HM, 2 = evolution stone. */
export function CheckIfItemIsTMHMOrEvolutionStone(itemId: number): number {
  if (ItemId_GetPocket(itemId) === K.POCKET_TM_CASE) return 1;
  if (ItemIdFieldFuncIs(itemId, 'FieldUseFunc_EvoItem')) return 2;
  return 0;
}

function ItemIdFieldFuncIs(itemId: number, name: string): boolean {
  return state.pokemon.items[itemId]?.fieldUseFunc === name;
}

const inField = (taskId: number) => gTasks[taskId].data[3] !== 0;

/** sItemUseOnFieldCB: what an item does once the bag has closed and the field is back. */
let sItemUseOnFieldCB: (taskId: number) => void = () => {};

/**
 * SetUpItemUseOnFieldCallback: from the bag, close it (CB2_ReturnToField) with gFieldCallback set to
 * FieldCB_FadeInFromBlack. (Registered items used with SELECT, data[3] == 1, aren't ported.)
 */
function SetUpItemUseOnFieldCallback(taskId: number): void {
  gFieldCallback.fn = FieldCB_FadeInFromBlack;
  SetUpItemUseCallback(taskId);
}

/** FieldCB_FadeInFromBlack + Task_WaitFadeIn_CallItemUseOnFieldCB */
function FieldCB_FadeInFromBlack(field: FieldCallbackHost): () => boolean {
  const faded = field.fadeInFromBlack();
  return () => {
    if (!faded()) return false;
    sItemUseOnFieldCB(0);
    return true;
  };
}

/**
 * FieldUseFunc_Bike: not on Cycling Road, and only where biking is allowed. (Its checks of the player's
 * tile for rails are MetatileBehavior_Is*Rail, all FALSE in FRLG.)
 */
function FieldUseFunc_Bike(taskId: number): void {
  if (state.getFlag('FLAG_SYS_ON_CYCLING_ROAD')) {
    DisplayItemMessageInCurrentContext(taskId, inField(taskId), K.FONT_NORMAL, text('gText_CantDismountBike'));
  } else if (avatarField().allowCycling() && !IsBikingDisallowedByPlayer()) {
    sItemUseOnFieldCB = ItemUseOnFieldCB_Bicycle;
    SetUpItemUseOnFieldCallback(taskId);
  } else {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  }
}

/** ItemUseOnFieldCB_Bicycle (SE_BIKE_BELL: no audio). The field's overlay ends with it (UnlockPlayerFieldControls). */
function ItemUseOnFieldCB_Bicycle(_taskId: number): void {
  GetOnOffBike(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE);
  ClearPlayerHeldMovement(); // ClearPlayerHeldMovementAndUnfreezeObjectEvents
}

/**
 * The field side of the rods and the Escape Rope (world/fishing.ts, world/fieldMoves.ts, world/fieldItems.ts),
 * registered at boot (registerFieldItems) like the party menu's field moves, so the bag doesn't import the
 * field's Phaser code.
 */
export interface ItemUseFieldFuncs {
  CanFish(): boolean;
  StartFishing(rod: number): void;
  CanUseEscapeRopeOnCurrMap(): boolean;
  LockPlayerFieldControls(): void;
  Overworld_ResetStateAfterDigEscRope(): void;
  /** DisplayItemMessageOnField(taskId, FONT_NORMAL, str, callback) */
  DisplayItemMessageOnField(str: number[], callback: () => void): void;
  Task_UseDigEscapeRopeOnField(): void;
}

let sFieldFuncs: ItemUseFieldFuncs | undefined;

export function registerItemUseFieldFuncs(funcs: ItemUseFieldFuncs): void {
  sFieldFuncs = funcs;
}

function fieldFuncs(): ItemUseFieldFuncs {
  if (!sFieldFuncs) throw new Error('[item_use] the field items are not registered');
  return sFieldFuncs;
}

/** FieldUseFunc_Rod: only facing water you can fish in (CanFish, world/fishing.ts). */
function FieldUseFunc_Rod(taskId: number): void {
  if (fieldFuncs().CanFish()) {
    sItemUseOnFieldCB = ItemUseOnFieldCB_Rod;
    SetUpItemUseOnFieldCallback(taskId);
  } else {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  }
}

/** ItemUseOnFieldCB_Rod: Task_Fishing takes over the field (world/fishing.ts). */
function ItemUseOnFieldCB_Rod(_taskId: number): void {
  fieldFuncs().StartFishing(ItemId_GetSecondaryId(SpecialVar.ItemId));
}

/**
 * ItemUseOutOfBattle_EscapeRope: only where gMapHeader.allowEscaping. (ItemUse_SetQuestLogEvent: no quest
 * log.)
 */
function ItemUseOutOfBattle_EscapeRope(taskId: number): void {
  if (fieldFuncs().CanUseEscapeRopeOnCurrMap()) {
    sItemUseOnFieldCB = ItemUseOnFieldCB_EscapeRope;
    SetUpItemUseOnFieldCallback(taskId);
  } else {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  }
}

/** ItemUseOnFieldCB_EscapeRope: "{PLAYER} used the ESCAPE ROPE.", then Dig's escape (Task_UseDigEscapeRopeOnField). */
function ItemUseOnFieldCB_EscapeRope(_taskId: number): void {
  // The start menu's LockPlayerFieldControls is still held on the GBA (the bag doesn't release it); here the
  // field's overlay held the controls until now, so the message takes the lock itself.
  const f = fieldFuncs();
  f.LockPlayerFieldControls();
  f.Overworld_ResetStateAfterDigEscRope();
  RemoveUsedItem();
  f.DisplayItemMessageOnField(gStringVar4.slice(), f.Task_UseDigEscapeRopeOnField);
}

/**
 * FieldUseFunc_TownMap: from the bag, the region map, which returns to the bag. (Its registered-item branch,
 * Task_UseTownMapFromField, waits for SELECT on the field, which the port doesn't have yet.)
 */
function FieldUseFunc_TownMap(taskId: number): void {
  ItemMenu_SetExitCallback(UseTownMapFromBag);
  ItemMenu_StartFadeToExitCallback(taskId);
}

/** UseTownMapFromBag */
function UseTownMapFromBag(): void {
  InitRegionMapWithExitCB(REGIONMAP_TYPE_NORMAL, CB2_BagMenuFromStartMenu);
}

function FieldUseFunc_CoinCase(taskId: number): void {
  gStringVar1.set(ConvertIntToDecimalStringN(state.coins, STR_CONV_MODE_LEFT_ALIGN, 4)); // GetCoins
  ExpandToStringVar4(text('gText_CoinCase'));
  if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
}

function FieldUseFunc_PowderJar(taskId: number): void {
  // GetBerryPowder: berry powder isn't tracked yet (it comes from Berry Crush)
  gStringVar1.set(ConvertIntToDecimalStringN(0, STR_CONV_MODE_LEFT_ALIGN, 5));
  ExpandToStringVar4(text('gText_PowderQty'));
  if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
}

function FieldUseFunc_PokeFlute(taskId: number): void {
  let wokeSomeoneUp = false;
  for (let i = 0; i < CalculatePlayerPartyCount(); i++) {
    if (!ExecuteTableBasedItemEffect(state.party[i], K.ITEM_AWAKENING, i, 0)) wokeSomeoneUp = true;
  }
  if (wokeSomeoneUp) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PlayedPokeFlute'), Task_PlayPokeFlute);
  else DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PlayedPokeFluteCatchy'), Task_ReturnToBagFromContextMenu);
}

function Task_PlayPokeFlute(taskId: number): void {
  PlayFanfareByFanfareNum(K.FANFARE_POKE_FLUTE);
  gTasks[taskId].func = Task_DisplayPokeFluteMessage;
}

function Task_DisplayPokeFluteMessage(taskId: number): void {
  if (WaitFanfare(false)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PokeFluteAwakenedMon'), Task_ReturnToBagFromContextMenu);
}

function FieldUseFunc_Medicine(taskId: number): void {
  setItemUseCB(ItemUseCB_Medicine);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_Ether(taskId: number): void {
  setItemUseCB(ItemUseCB_TryRestorePP);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_PpUp(taskId: number): void {
  setItemUseCB(ItemUseCB_PPUp);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_RareCandy(taskId: number): void {
  setItemUseCB(ItemUseCB_RareCandy);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_EvoItem(taskId: number): void {
  setItemUseCB(ItemUseCB_EvolutionStone);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_SacredAsh(taskId: number): void {
  setItemUseCB(ItemUseCB_SacredAsh);
  SetUpItemUseCallback(taskId);
}

function FieldUseFunc_Repel(taskId: number): void {
  if (state.getVar('VAR_REPEL_STEP_COUNT') === 0) {
    PlaySE(K.SE_REPEL);
    gTasks[taskId].func = Task_UseRepel;
  } else {
    // An earlier repel is still in effect
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_RepelEffectsLingered'), Task_ReturnToBagFromContextMenu);
  }
}

function Task_UseRepel(taskId: number): void {
  if (!IsSEPlaying()) {
    state.setVar('VAR_REPEL_STEP_COUNT', ItemId_GetHoldEffectParam(SpecialVar.ItemId));
    RemoveUsedItem();
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
  }
}

function RemoveUsedItem(): void {
  RemoveBagItem(SpecialVar.ItemId, 1);
  Pocket_CalculateNItemsAndMaxShowed(ItemId_GetPocket(SpecialVar.ItemId));
  PocketCalculateInitialCursorPosAndItemsAbove(ItemId_GetPocket(SpecialVar.ItemId));
  gStringVar2.set(CopyItemName(SpecialVar.ItemId));
  ExpandToStringVar4(text('gText_PlayerUsedVar2'));
}

function FieldUseFunc_BlackWhiteFlute(taskId: number): void {
  if (SpecialVar.ItemId === K.ITEM_WHITE_FLUTE) {
    state.setFlag('FLAG_SYS_WHITE_FLUTE_ACTIVE', true);
    state.setFlag('FLAG_SYS_BLACK_FLUTE_ACTIVE', false);
    gStringVar2.set(CopyItemName(SpecialVar.ItemId));
    ExpandToStringVar4(text('gText_UsedVar2WildLured'));
    gTasks[taskId].func = Task_UsedBlackWhiteFlute;
    gTasks[taskId].data[8] = 0;
  } else if (SpecialVar.ItemId === K.ITEM_BLACK_FLUTE) {
    state.setFlag('FLAG_SYS_BLACK_FLUTE_ACTIVE', true);
    state.setFlag('FLAG_SYS_WHITE_FLUTE_ACTIVE', false);
    gStringVar2.set(CopyItemName(SpecialVar.ItemId));
    ExpandToStringVar4(text('gText_UsedVar2WildRepelled'));
    gTasks[taskId].func = Task_UsedBlackWhiteFlute;
    gTasks[taskId].data[8] = 0;
  }
}

function Task_UsedBlackWhiteFlute(taskId: number): void {
  if (++gTasks[taskId].data[8] > 7) {
    PlaySE(K.SE_GLASS_FLUTE);
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
  }
}

/** IsPlayerPartyAndPokemonStorageFull (pokemon.c) */
function IsPlayerPartyAndPokemonStorageFull(): boolean {
  return state.isPlayerPartyAndPokemonStorageFull();
}

function BattleUseFunc_PokeBallEtc(taskId: number): void {
  if (!IsPlayerPartyAndPokemonStorageFull()) {
    RemoveBagItem(SpecialVar.ItemId, 1);
    Bag_BeginCloseWin0Animation();
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_BoxFull'), Task_ReturnToBagFromContextMenu);
  }
}

function BattleUseFunc_PokeFlute(taskId: number): void {
  Bag_BeginCloseWin0Animation();
  ItemMenu_StartFadeToExitCallback(taskId);
}

function BattleUseFunc_StatBooster(taskId: number): void {
  const partyIndex = g.battlerPartyIndexes[g.battlerInMenuId];
  if (ExecuteTableBasedItemEffect(state.party[partyIndex], SpecialVar.ItemId, partyIndex, 0)) {
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_WontHaveEffect'), Task_ReturnToBagFromContextMenu);
  } else {
    gTasks[taskId].data[8] = 0;
    gTasks[taskId].func = Task_BattleUse_StatBooster_DelayAndPrint;
  }
}

function Task_BattleUse_StatBooster_DelayAndPrint(taskId: number): void {
  const data = gTasks[taskId].data;
  if (++data[8] > 7) {
    const itemId = SpecialVar.ItemId;
    PlaySE(K.SE_USE_ITEM);
    RemoveBagItem(itemId, 1);
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, Battle_PrintStatBoosterEffectMessage(itemId), Task_BattleUse_StatBooster_WaitButton_ReturnToBattle);
  }
}

function Task_BattleUse_StatBooster_WaitButton_ReturnToBattle(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    Bag_BeginCloseWin0Animation();
    ItemMenu_StartFadeToExitCallback(taskId);
  }
}

function ItemUse_SwitchToPartyMenuInBattle(taskId: number): void {
  if (GetPocketByItemId(SpecialVar.ItemId) === K.POCKET_BERRY_POUCH) {
    console.warn('[item_use] the berry pouch is not implemented');
    Task_ReturnToBagFromContextMenu(taskId);
    return;
  }
  ItemMenu_SetExitCallback(EnterPartyFromItemMenuInBattle);
  ItemMenu_StartFadeToExitCallback(taskId);
}

function BattleUseFunc_Medicine(taskId: number): void {
  setItemUseCB(ItemUseCB_MedicineStep);
  ItemUse_SwitchToPartyMenuInBattle(taskId);
}

function BattleUseFunc_Ether(taskId: number): void {
  setItemUseCB(ItemUseCB_TryRestorePP);
  ItemUse_SwitchToPartyMenuInBattle(taskId);
}

function BattleUseFunc_PokeDoll(taskId: number): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_TRAINER)) {
    RemoveUsedItem();
    DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, ItemMenu_StartFadeToExitCallback);
  } else {
    PrintNotTheTimeToUseThat(taskId, false);
  }
}

function ItemUseOutOfBattle_EnigmaBerry(taskId: number): void {
  switch (GetItemEffectType(SpecialVar.ItemId)) {
    case K.ITEM_EFFECT_HEAL_HP:
    case K.ITEM_EFFECT_CURE_POISON:
    case K.ITEM_EFFECT_CURE_SLEEP:
    case K.ITEM_EFFECT_CURE_BURN:
    case K.ITEM_EFFECT_CURE_FREEZE:
    case K.ITEM_EFFECT_CURE_PARALYSIS:
    case K.ITEM_EFFECT_CURE_ALL_STATUS:
    case K.ITEM_EFFECT_ATK_EV:
    case K.ITEM_EFFECT_HP_EV:
    case K.ITEM_EFFECT_SPATK_EV:
    case K.ITEM_EFFECT_SPDEF_EV:
    case K.ITEM_EFFECT_SPEED_EV:
    case K.ITEM_EFFECT_DEF_EV:
      gTasks[taskId].data[4] = 1;
      FieldUseFunc_Medicine(taskId);
      break;
    case K.ITEM_EFFECT_SACRED_ASH:
      gTasks[taskId].data[4] = 1;
      FieldUseFunc_SacredAsh(taskId);
      break;
    case K.ITEM_EFFECT_RAISE_LEVEL:
      gTasks[taskId].data[4] = 1;
      FieldUseFunc_RareCandy(taskId);
      break;
    case K.ITEM_EFFECT_PP_UP:
    case K.ITEM_EFFECT_PP_MAX:
      gTasks[taskId].data[4] = 1;
      FieldUseFunc_PpUp(taskId);
      break;
    case K.ITEM_EFFECT_HEAL_PP:
      gTasks[taskId].data[4] = 1;
      FieldUseFunc_Ether(taskId);
      break;
    default:
      gTasks[taskId].data[4] = 4;
      FieldUseFunc_OakStopsYou(taskId);
  }
}

function ItemUseInBattle_EnigmaBerry(taskId: number): void {
  switch (GetItemEffectType(SpecialVar.ItemId)) {
    case K.ITEM_EFFECT_X_ITEM:
      BattleUseFunc_StatBooster(taskId);
      break;
    case K.ITEM_EFFECT_HEAL_HP:
    case K.ITEM_EFFECT_CURE_POISON:
    case K.ITEM_EFFECT_CURE_SLEEP:
    case K.ITEM_EFFECT_CURE_BURN:
    case K.ITEM_EFFECT_CURE_FREEZE:
    case K.ITEM_EFFECT_CURE_PARALYSIS:
    case K.ITEM_EFFECT_CURE_CONFUSION:
    case K.ITEM_EFFECT_CURE_INFATUATION:
    case K.ITEM_EFFECT_CURE_ALL_STATUS:
      BattleUseFunc_Medicine(taskId);
      break;
    case K.ITEM_EFFECT_HEAL_PP:
      BattleUseFunc_Ether(taskId);
      break;
    default:
      FieldUseFunc_OakStopsYou(taskId);
  }
}

function FieldUseFunc_OakStopsYou(taskId: number): void {
  if (GetPocketByItemId(SpecialVar.ItemId) === K.POCKET_BERRY_POUCH) {
    console.warn('[item_use] the berry pouch is not implemented');
    Task_ReturnToBagFromContextMenu(taskId);
  } else {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  }
}

/** Field use functions by name (ItemId_GetFieldFunc) */
export const FIELD_USE_FUNCS: Record<string, TaskFunc> = {
  FieldUseFunc_Bike,
  FieldUseFunc_Rod,
  ItemUseOutOfBattle_EscapeRope,
  FieldUseFunc_TownMap,
  FieldUseFunc_CoinCase,
  FieldUseFunc_PowderJar,
  FieldUseFunc_PokeFlute,
  FieldUseFunc_Medicine,
  FieldUseFunc_Ether,
  FieldUseFunc_PpUp,
  FieldUseFunc_RareCandy,
  FieldUseFunc_EvoItem,
  FieldUseFunc_SacredAsh,
  FieldUseFunc_Repel,
  FieldUseFunc_BlackWhiteFlute,
  ItemUseOutOfBattle_EnigmaBerry,
  FieldUseFunc_OakStopsYou,
};

/** Battle use functions by name (ItemId_GetBattleFunc) */
export const BATTLE_USE_FUNCS: Record<string, TaskFunc> = {
  BattleUseFunc_PokeBallEtc,
  BattleUseFunc_PokeFlute,
  BattleUseFunc_StatBooster,
  BattleUseFunc_Medicine,
  BattleUseFunc_Ether,
  BattleUseFunc_PokeDoll,
  ItemUseInBattle_EnigmaBerry,
};
