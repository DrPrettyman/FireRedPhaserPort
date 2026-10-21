// item_use.c: what Use does for each item, from the bag (tasks' data[3] == 0), from the field with SELECT
// (a registered key item: UseRegisteredKeyItemOnField in menus/registeredItem.ts runs the field func as a task
// with data[3] == 1) and in battle. The functions are looked up by the names in the item table (fieldUseFunc /
// battleUseFunc). A use missing from the tables is logged by the bag.
// Berries used from the berry pouch run these with the pouch's task, and hand
// back to the pouch instead of the bag.

import { K } from '../battle/constants';
import { g, state } from '../battle/env';
import { Battle_PrintStatBoosterEffectMessage, ExecuteTableBasedItemEffect } from '../battle/items';
import type { MainCallback } from '../gba/main';
import { A_BUTTON, B_BUTTON, JOY_NEW } from '../gba/main';
import { IsSEPlaying, PlayFanfareByFanfareNum, PlaySE, WaitFanfare } from '../gba/sound';
import { DestroyTask, gTasks, TASK_NONE, type TaskFunc } from '../gba/task';
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
import { CB2_ReturnToField, gFieldCallback, gFieldCallback2, type FieldCallbackHost } from './fieldCallbacks';
import { GetOnOffBike, IsBikingDisallowedByPlayer } from '../world/bike';
import { avatarField, ClearPlayerHeldMovement, PLAYER_AVATAR_FLAG, TestPlayerAvatarFlags } from '../world/playerAvatar';
import { StopPokemonLeagueLightingEffectTask } from '../world/leagueLighting';
import {
  Bag_BeginCloseWin0Animation,
  CB2_BagMenuFromBattle,
  CB2_BagMenuFromStartMenu,
  DisplayItemMessageInBag,
  ItemMenu_SetExitCallback,
  ItemMenu_StartFadeToExitCallback,
  Pocket_CalculateNItemsAndMaxShowed,
  PocketCalculateInitialCursorPosAndItemsAbove,
  Task_ReturnToBagFromContextMenu,
} from './itemMenu';
import { SpecialVar } from './itemMenuState';
import { ReadMail } from './mail';
import { questLogHost } from '../world/questLog';
import { ItemUse_SetQuestLogEvent } from '../world/questLogEvents';
import { newMail } from '../world/mail';
import { InitRegionMapWithExitCB, REGIONMAP_TYPE_NORMAL, regionMapGfxSymbols } from './regionMap';
import { InitTMCase, TMCASE_FIELD } from './tmCase';
import { UseFameChecker } from './fameChecker';
import { InitTeachyTvController } from './teachyTv';
import {
  BERRYPOUCH_FROMBATTLE,
  BERRYPOUCH_FROMFIELD,
  BerryPouch_SetExitCallback,
  BerryPouch_StartFadeToExitCallback,
  DisplayItemMessageInBerryPouch,
  InitBerryPouch,
  Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu,
} from './berryPouch';
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
import { setExitStairsMovementDisabled } from '../world/stairWarp';

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
    BerryPouch_SetExitCallback(sExitCallbackByItemType(itemType));
    BerryPouch_StartFadeToExitCallback(taskId);
    return;
  }
  ItemMenu_SetExitCallback(sExitCallbackByItemType(itemType));
  if (itemType === K.ITEM_TYPE_FIELD - 1) Bag_BeginCloseWin0Animation();
  ItemMenu_StartFadeToExitCallback(taskId);
}

function DisplayItemMessageInCurrentContext(taskId: number, inField: boolean, fontId: number, str: number[]): void {
  ExpandToStringVar4(str);
  if (!inField) DisplayItemMessageInBag(taskId, fontId, gStringVar4, Task_ReturnToBagFromContextMenu);
  else DisplayItemMessageOnField(taskId, fontId, gStringVar4, Task_ItemUse_CloseMessageBoxAndReturnToField);
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

/**
 * sItemUseOnFieldCB: what an item does on the field, once the bag has closed and the field is back, or at once
 * for a registered item. Its taskId is the item's task with SELECT; after the bag it's TASK_NONE (the port's
 * FieldCB_FadeInFromBlack runs it from the field's overlay, not from a Task_WaitFadeIn_CallItemUseOnFieldCB task).
 */
let sItemUseOnFieldCB: (taskId: number) => void = () => {};

/**
 * SetUpItemUseOnFieldCallback: from the bag, close it (CB2_ReturnToField) with gFieldCallback set to
 * FieldCB_FadeInFromBlack; with SELECT (data[3] == 1), run sItemUseOnFieldCB at once.
 */
function SetUpItemUseOnFieldCallback(taskId: number): void {
  if (gTasks[taskId].data[3] !== 1) {
    gFieldCallback.fn = FieldCB_FadeInFromBlack;
    SetUpItemUseCallback(taskId);
  } else {
    sItemUseOnFieldCB(taskId);
  }
}

/** FieldCB_FadeInFromBlack + Task_WaitFadeIn_CallItemUseOnFieldCB */
function FieldCB_FadeInFromBlack(field: FieldCallbackHost): () => boolean {
  const faded = field.fadeInFromBlack();
  return () => {
    if (!faded()) return false;
    sItemUseOnFieldCB(TASK_NONE);
    return true;
  };
}

/** DestroyTask for an sItemUseOnFieldCB's task (TASK_NONE after the bag: there is none). */
function DestroyItemUseTask(taskId: number): void {
  if (taskId !== TASK_NONE) DestroyTask(taskId);
}

/**
 * DisplayItemMessageOnField (new_menu_helpers.c) for an item's task: the field's message box (window 0, the
 * dialogue frame) at the player's text speed; once it has printed, `callback` becomes the task's func
 * (Task_ContinueTaskAfterMessagePrints).
 */
function DisplayItemMessageOnField(taskId: number, fontId: number, str: number[], callback: TaskFunc): void {
  gTasks[taskId].func = Task_ContinueTaskAfterMessagePrints;
  fieldFuncs().DisplayItemMessageOnField(str.slice(), () => {
    if (gTasks[taskId].isActive && gTasks[taskId].func === Task_ContinueTaskAfterMessagePrints) gTasks[taskId].func = callback;
  }, fontId);
}

/** Task_ContinueTaskAfterMessagePrints: the field's DisplayItemMessageOnField (world/fieldItems.ts) watches the printer. */
function Task_ContinueTaskAfterMessagePrints(_taskId: number): void {}

/** Task_ItemUse_CloseMessageBoxAndReturnToField */
export function Task_ItemUse_CloseMessageBoxAndReturnToField(taskId: number): void {
  const f = fieldFuncs();
  f.ClearDialogWindowAndFrame();
  DestroyTask(taskId);
  ClearPlayerHeldMovementAndUnfreezeObjectEvents();
  f.UnlockPlayerFieldControls();
}

/** ClearPlayerHeldMovementAndUnfreezeObjectEvents (event_object_movement.c) */
function ClearPlayerHeldMovementAndUnfreezeObjectEvents(): void {
  ClearPlayerHeldMovement();
  avatarField().unfreezeObjectEvents();
}

/** SetFieldCallback2ForItemUse: the field callback for coming back from a screen an item opened from the field. */
function SetFieldCallback2ForItemUse(): void {
  gFieldCallback2.fn = FieldCB2_UseItemFromField;
}

/**
 * FieldCB2_UseItemFromField + Task_ItemUseWaitForFade: freeze the objects and hold the controls while the field
 * fades in from black, then give both back; gExitStairsMovementDisabled = FALSE.
 */
function FieldCB2_UseItemFromField(field: FieldCallbackHost): () => boolean {
  const f = fieldFuncs();
  avatarField().freezeObjectEvents(); // FreezeObjectEvents
  f.LockPlayerFieldControls();
  const faded = field.fadeInFromBlack(); // FadeInFromBlack; the wait is IsWeatherNotFadingIn
  setExitStairsMovementDisabled(false);
  return () => {
    if (!faded()) return false;
    avatarField().unfreezeObjectEvents(); // UnfreezeObjectEvents
    f.UnlockPlayerFieldControls();
    return true;
  };
}

/**
 * The from-the-field branch of FieldUseFunc_TownMap / _TmCase / _BerryPouch (a registered item with SELECT):
 * StopPokemonLeagueLightingEffectTask, FadeScreen(FADE_TO_BLACK, 0), then `task` waits for the fade.
 */
function FadeToScreenFromField(taskId: number, task: TaskFunc): void {
  StopPokemonLeagueLightingEffectTask();
  fieldFuncs().FadeScreen(K.FADE_TO_BLACK, 0);
  gTasks[taskId].func = task;
}

/**
 * Task_UseTownMapFromField / Task_InitTMCaseFromField / Task_InitBerryPouchFromField: once the fade is done,
 * CleanupOverworldWindowsAndTilemaps, SetFieldCallback2ForItemUse and the screen (`init`), which comes back to the
 * field with CB2_ReturnToField.
 */
function OpenScreenFromFieldOnceFaded(taskId: number, init: () => void, gfxSymbols: string[]): void {
  const f = fieldFuncs();
  if (!f.IsFieldPaletteFadeActive()) {
    SetFieldCallback2ForItemUse();
    f.OpenScreenFromField(init, gfxSymbols); // CleanupOverworldWindowsAndTilemaps + init
    DestroyTask(taskId);
  }
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

/**
 * ItemUseOnFieldCB_Bicycle. After the bag, the field's overlay holds the controls until this has run (the
 * UnlockPlayerFieldControls here then has nothing to release); with SELECT, it gives back the lock
 * UseRegisteredKeyItemOnField took.
 */
function ItemUseOnFieldCB_Bicycle(taskId: number): void {
  if (!TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE)) PlaySE(K.SE_BIKE_BELL);
  GetOnOffBike(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE);
  ClearPlayerHeldMovementAndUnfreezeObjectEvents();
  fieldFuncs().UnlockPlayerFieldControls();
  DestroyItemUseTask(taskId);
}

/**
 * The field side of the rods, the Escape Rope, the VS Seeker and the Itemfinder (world/fishing.ts,
 * world/fieldMoves.ts, world/fieldItems.ts, world/vsSeeker.ts, world/itemfinder.ts), registered at boot
 * (registerFieldItems, registerVsSeeker, registerItemfinder) like the
 * party menu's field moves, so the bag doesn't import the field's Phaser code. Each registers its part.
 */
export interface ItemUseFieldFuncs {
  CanFish(): boolean;
  StartFishing(rod: number): void;
  CanUseEscapeRopeOnCurrMap(): boolean;
  LockPlayerFieldControls(): void;
  UnlockPlayerFieldControls(): void;
  Overworld_ResetStateAfterDigEscRope(): void;
  /** DisplayItemMessageOnField(taskId, fontId (default FONT_NORMAL), str, callback) */
  DisplayItemMessageOnField(str: number[], callback: () => void, fontId?: number): void;
  /** ClearDialogWindowAndFrame(0, TRUE): the field's message box */
  ClearDialogWindowAndFrame(): void;
  /** DismissMapNamePopup */
  DismissMapNamePopup(): void;
  /** ScriptContext_SetupScript */
  ScriptContext_SetupScript(label: string): void;
  Task_UseDigEscapeRopeOnField(): void;
  /** gMapHeader.mapType */
  GetCurrentMapType(): number;
  /** gSaveBlock1Ptr->location as its MAP_* id */
  GetCurrentMapId(): string;
  /** vs_seeker.c's Task_VsSeeker_0 */
  Task_VsSeeker_0(): void;
  /** itemfinder.c's ItemUseOnFieldCB_Itemfinder */
  ItemUseOnFieldCB_Itemfinder(): void;
  /** FadeScreen (field_screen_effect.c) */
  FadeScreen(mode: number, delay: number): void;
  /** gPaletteFade.active on the field */
  IsFieldPaletteFadeActive(): boolean;
  /**
   * CleanupOverworldWindowsAndTilemaps, then the GBA screen `init` starts (it sets the main callback), from the
   * black field; `gfxSymbols` are the graphics it needs beyond the bag's.
   */
  OpenScreenFromField(init: () => void, gfxSymbols: string[]): void;
}

const sFieldFuncs: Partial<ItemUseFieldFuncs> = {};

export function registerItemUseFieldFuncs(funcs: Partial<ItemUseFieldFuncs>): void {
  Object.assign(sFieldFuncs, funcs);
}

export function fieldFuncs(): ItemUseFieldFuncs {
  if (!sFieldFuncs.CanFish || !sFieldFuncs.Task_VsSeeker_0 || !sFieldFuncs.ItemUseOnFieldCB_Itemfinder) throw new Error('[item_use] the field items are not registered');
  return sFieldFuncs as ItemUseFieldFuncs;
}

/** FieldUseFunc_Mail: CHECK on a mail item shows a blank mail of its type (CB2_CheckMail), back to the bag. */
function FieldUseFunc_Mail(taskId: number): void {
  ItemMenu_SetExitCallback(CB2_CheckMail);
  ItemMenu_StartFadeToExitCallback(taskId);
}

/**
 * CB2_CheckMail: the C's struct Mail is an uninitialised local with only itemId set; no message is shown, and its
 * species is taken as SPECIES_NONE (so Bead / Dream Mail show no icon).
 */
function CB2_CheckMail(): void {
  const mail = { ...newMail(state.defines), species: K.SPECIES_NONE, itemId: SpecialVar.ItemId };
  ReadMail(mail, CB2_BagMenuFromStartMenu, false);
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
function ItemUseOnFieldCB_Rod(taskId: number): void {
  fieldFuncs().StartFishing(ItemId_GetSecondaryId(SpecialVar.ItemId));
  DestroyItemUseTask(taskId);
}

/** ItemUseOutOfBattle_EscapeRope: only where gMapHeader.allowEscaping; the quest log keeps the map section. */
function ItemUseOutOfBattle_EscapeRope(taskId: number): void {
  if (fieldFuncs().CanUseEscapeRopeOnCurrMap()) {
    ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, questLogHost()?.mapSec() ?? K.MAPSEC_NONE);
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
 * FieldUseFunc_VsSeeker: only on routes, in towns and cities, and not in the forests that are routes (Viridian
 * Forest, Mt. Ember's exterior, Berry Forest, Pattern Bush).
 */
function FieldUseFunc_VsSeeker(taskId: number): void {
  const f = fieldFuncs();
  const mapType = f.GetCurrentMapType();
  if (
    (mapType !== K.MAP_TYPE_ROUTE && mapType !== K.MAP_TYPE_TOWN && mapType !== K.MAP_TYPE_CITY) ||
    ['MAP_VIRIDIAN_FOREST', 'MAP_MT_EMBER_EXTERIOR', 'MAP_THREE_ISLAND_BERRY_FOREST', 'MAP_SIX_ISLAND_PATTERN_BUSH'].includes(f.GetCurrentMapId())
  ) {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  } else {
    // Task_VsSeeker_0 is the item's task on the GBA (it goes on as Task_VsSeeker_1..3); world/vsSeeker.ts runs
    // its own field task, so the item's task ends here.
    sItemUseOnFieldCB = (id) => {
      f.Task_VsSeeker_0();
      DestroyItemUseTask(id);
    };
    SetUpItemUseOnFieldCallback(taskId);
  }
}

/** ItemUseOutOfBattle_Itemfinder (IncrementGameStat(GAME_STAT_USED_ITEMFINDER): game stats aren't tracked yet) */
function ItemUseOutOfBattle_Itemfinder(taskId: number): void {
  const f = fieldFuncs();
  // (world/itemfinder.ts runs its own field task, as for the VS Seeker)
  sItemUseOnFieldCB = (id) => {
    f.ItemUseOnFieldCB_Itemfinder();
    DestroyItemUseTask(id);
  };
  SetUpItemUseOnFieldCallback(taskId);
}

/**
 * FieldUseFunc_TownMap: from the bag, the region map, which returns to the bag; with SELECT, the region map from
 * the field (Task_UseTownMapFromField), back to the field.
 */
function FieldUseFunc_TownMap(taskId: number): void {
  if (gTasks[taskId].data[3] === 0) {
    ItemMenu_SetExitCallback(UseTownMapFromBag);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    FadeToScreenFromField(taskId, Task_UseTownMapFromField);
  }
}

/** Task_UseTownMapFromField (the dungeon previews' graphics too: the Town Map is in the bag) */
function Task_UseTownMapFromField(taskId: number): void {
  OpenScreenFromFieldOnceFaded(taskId, () => InitRegionMapWithExitCB(REGIONMAP_TYPE_NORMAL, CB2_ReturnToField), regionMapGfxSymbols(true));
}

/** UseTownMapFromBag */
function UseTownMapFromBag(): void {
  InitRegionMapWithExitCB(REGIONMAP_TYPE_NORMAL, CB2_BagMenuFromStartMenu);
}

/**
 * FieldUseFunc_TmCase: from the bag, the TM case, which returns to the bag; with SELECT, the TM case from the field
 * (Task_InitTMCaseFromField), which SELECT closes too and which returns to the field. Its USE / GIVE go through the
 * party menu and back to the TM case (CB2_ReturnToTMCaseMenu keeps the exit callback) as from the bag.
 */
function FieldUseFunc_TmCase(taskId: number): void {
  if (!inField(taskId)) {
    ItemMenu_SetExitCallback(InitTMCaseFromBag);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    FadeToScreenFromField(taskId, Task_InitTMCaseFromField);
  }
}

/** Task_InitTMCaseFromField (its graphics are preloaded with the bag's: menuGfxSymbols) */
function Task_InitTMCaseFromField(taskId: number): void {
  OpenScreenFromFieldOnceFaded(taskId, () => InitTMCase(TMCASE_FIELD, CB2_ReturnToField, true), []);
}

/** InitTMCaseFromBag */
function InitTMCaseFromBag(): void {
  InitTMCase(TMCASE_FIELD, CB2_BagMenuFromStartMenu, false);
}

/**
 * FieldUseFunc_BerryPouch: from the bag, the berry pouch, which returns to the bag; with SELECT, the berry pouch
 * from the field (Task_InitBerryPouchFromField), which SELECT closes too and which returns to the field. A berry's
 * USE goes through the party menu and back to the pouch (CB2_ReturnToBerryPouchMenu) as from the bag.
 */
function FieldUseFunc_BerryPouch(taskId: number): void {
  if (gTasks[taskId].data[3] === 0) {
    ItemMenu_SetExitCallback(InitBerryPouchFromBag);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    FadeToScreenFromField(taskId, Task_InitBerryPouchFromField);
  }
}

/** Task_InitBerryPouchFromField (its graphics are preloaded with the bag's: menuGfxSymbols) */
function Task_InitBerryPouchFromField(taskId: number): void {
  OpenScreenFromFieldOnceFaded(taskId, () => InitBerryPouch(BERRYPOUCH_FROMFIELD, CB2_ReturnToField, 1), []);
}

/** InitBerryPouchFromBag */
function InitBerryPouchFromBag(): void {
  InitBerryPouch(BERRYPOUCH_FROMFIELD, CB2_BagMenuFromStartMenu, 0);
}

/**
 * FieldUseFunc_TeachyTv: from the bag, Teachy TV, which returns to the bag; with SELECT, Teachy TV from the field
 * (Task_InitTeachyTvFromField), which SELECT closes too and which returns to the field. Its graphics (and Route 1's
 * layout) are loaded with the bag's when the bag has it (prepareTeachyTv).
 */
function FieldUseFunc_TeachyTv(taskId: number): void {
  ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
  if (!inField(taskId)) {
    ItemMenu_SetExitCallback(InitTeachyTvFromBag);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    FadeToScreenFromField(taskId, Task_InitTeachyTvFromField);
  }
}

/** InitTeachyTvFromBag */
function InitTeachyTvFromBag(): void {
  InitTeachyTvController(0, CB2_BagMenuFromStartMenu);
}

/** Task_InitTeachyTvFromField */
function Task_InitTeachyTvFromField(taskId: number): void {
  OpenScreenFromFieldOnceFaded(taskId, () => InitTeachyTvController(0, CB2_ReturnToField), []);
}

/** BattleUseFunc_BerryPouch: the battle bag's OPEN, back to the battle bag. */
function BattleUseFunc_BerryPouch(taskId: number): void {
  ItemMenu_SetExitCallback(InitBerryPouchFromBattle);
  ItemMenu_StartFadeToExitCallback(taskId);
}

/** InitBerryPouchFromBattle */
function InitBerryPouchFromBattle(): void {
  InitBerryPouch(BERRYPOUCH_FROMBATTLE, CB2_BagMenuFromBattle, 0);
}

/**
 * FieldUseFunc_FameChecker: from the bag, the Fame Checker, which returns to the bag; with SELECT, the Fame Checker
 * from the field (Task_UseFameCheckerFromField), which SELECT closes too and which returns to the field.
 */
function FieldUseFunc_FameChecker(taskId: number): void {
  ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
  if (gTasks[taskId].data[3] === 0) {
    ItemMenu_SetExitCallback(UseFameCheckerFromBag);
    ItemMenu_StartFadeToExitCallback(taskId);
  } else {
    FadeToScreenFromField(taskId, Task_UseFameCheckerFromField);
  }
}

/** UseFameCheckerFromBag (its graphics are preloaded with the bag's when the bag has the Fame Checker) */
function UseFameCheckerFromBag(): void {
  UseFameChecker(CB2_BagMenuFromStartMenu);
}

/** Task_UseFameCheckerFromField (FieldMenuScene preloads its graphics for the registered Fame Checker) */
function Task_UseFameCheckerFromField(taskId: number): void {
  OpenScreenFromFieldOnceFaded(taskId, () => UseFameChecker(CB2_ReturnToField), []);
}

function FieldUseFunc_CoinCase(taskId: number): void {
  gStringVar1.set(ConvertIntToDecimalStringN(state.coins, STR_CONV_MODE_LEFT_ALIGN, 4)); // GetCoins
  ExpandToStringVar4(text('gText_CoinCase'));
  ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
  if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
  else DisplayItemMessageOnField(taskId, K.FONT_NORMAL, gStringVar4, Task_ItemUse_CloseMessageBoxAndReturnToField);
}

function FieldUseFunc_PowderJar(taskId: number): void {
  // GetBerryPowder: berry powder isn't tracked yet (it comes from Berry Crush)
  gStringVar1.set(ConvertIntToDecimalStringN(0, STR_CONV_MODE_LEFT_ALIGN, 5));
  ExpandToStringVar4(text('gText_PowderQty'));
  ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
  if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, gStringVar4, Task_ReturnToBagFromContextMenu);
  else DisplayItemMessageOnField(taskId, K.FONT_NORMAL, gStringVar4, Task_ItemUse_CloseMessageBoxAndReturnToField);
}

function FieldUseFunc_PokeFlute(taskId: number): void {
  let wokeSomeoneUp = false;
  for (let i = 0; i < CalculatePlayerPartyCount(); i++) {
    if (!ExecuteTableBasedItemEffect(state.party[i], K.ITEM_AWAKENING, i, 0)) wokeSomeoneUp = true;
  }
  if (wokeSomeoneUp) {
    ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
    if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PlayedPokeFlute'), Task_PlayPokeFlute);
    else DisplayItemMessageOnField(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_PlayedPokeFlute')), Task_PlayPokeFlute);
  } else {
    if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PlayedPokeFluteCatchy'), Task_ReturnToBagFromContextMenu);
    else DisplayItemMessageOnField(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_PlayedPokeFluteCatchy')), Task_ItemUse_CloseMessageBoxAndReturnToField);
  }
}

function Task_PlayPokeFlute(taskId: number): void {
  PlayFanfareByFanfareNum(K.FANFARE_POKE_FLUTE);
  gTasks[taskId].func = Task_DisplayPokeFluteMessage;
}

function Task_DisplayPokeFluteMessage(taskId: number): void {
  if (WaitFanfare(false)) {
    if (!inField(taskId)) DisplayItemMessageInBag(taskId, K.FONT_NORMAL, text('gText_PokeFluteAwakenedMon'), Task_ReturnToBagFromContextMenu);
    else DisplayItemMessageOnField(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_PokeFluteAwakenedMon')), Task_ItemUse_CloseMessageBoxAndReturnToField);
  }
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
    ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
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
  ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
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
    BerryPouch_SetExitCallback(EnterPartyFromItemMenuInBattle);
    BerryPouch_StartFadeToExitCallback(taskId);
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
    ItemUse_SetQuestLogEvent(K.QL_EVENT_USED_ITEM, null, SpecialVar.ItemId, 0xffff);
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
    DisplayItemMessageInBerryPouch(taskId, K.FONT_MALE, ExpandToStringVar4(text('gText_OakForbidsUseOfItemHere')), Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu);
  } else {
    PrintNotTheTimeToUseThat(taskId, inField(taskId));
  }
}

/** Field use functions by name (ItemId_GetFieldFunc) */
export const FIELD_USE_FUNCS: Record<string, TaskFunc> = {
  FieldUseFunc_Bike,
  FieldUseFunc_Mail,
  FieldUseFunc_Rod,
  ItemUseOutOfBattle_EscapeRope,
  FieldUseFunc_VsSeeker,
  ItemUseOutOfBattle_Itemfinder,
  FieldUseFunc_TownMap,
  FieldUseFunc_TmCase,
  FieldUseFunc_BerryPouch,
  FieldUseFunc_FameChecker,
  FieldUseFunc_TeachyTv,
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
  BattleUseFunc_BerryPouch,
};
