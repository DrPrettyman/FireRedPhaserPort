// renewable_hidden_items.c: the hidden items that come back. On fifteen maps (Berry Forest, Treasure Beach, the
// Underground Paths, ...) some hidden items are grouped as rare / uncommon / common. Every step counts
// VAR_RENEWABLE_ITEM_STEP_COUNTER up to 1500 (IncrementRenewableHiddenItemStepCounter, next to GAME_STAT_STEPS in
// OverworldScene's ProcessPlayerFieldInput); the next map load onto one of those maps (TryRegenerateRenewableHiddenItems,
// after the ON_TRANSITION script as in LoadMapFromWarp / LoadMapFromCameraTransition) resets it, hides every renewable
// item (SetAllRenewableItemFlags) and puts one group per map back (SampleRenewableItemFlags: 10% rare, 30% uncommon,
// 60% common). A new game starts with every renewable item hidden (NewGameInitData, in GameState's constructor).
// The table is sRenewableHiddenItems, extracted into constants.json (tools/extract.py); Assets.init hands it over.

import type { GameState } from '../state/GameState';
import { random } from '../util/random';

/** sRenewableHiddenItems' struct RenewableHiddenItemData: MAX_HIDDEN_ITEMS_PER_GROUP hidden ids per group. */
export interface RenewableHiddenItemData {
  /** mapGroup / mapNum, as the map's MAP_* id */
  map: string;
  /** HIDDEN_ID(flag) = flag - FLAG_HIDDEN_ITEMS_START; NO_ITEM (0xFF) for none */
  rare: number[];
  uncommon: number[];
  common: number[];
}

const NO_ITEM = 0xff;
/** The step count at which the items come back (IncrementRenewableHiddenItemStepCounter's cap) */
const RENEWABLE_ITEM_STEPS = 1500;

let sRenewableHiddenItems: RenewableHiddenItemData[] = [];

/** Assets.init (and the unit tests' newGame), before any GameState: constants.json's renewableHiddenItems. */
export function initRenewableHiddenItems(table: RenewableHiddenItemData[] | undefined): void {
  sRenewableHiddenItems = table ?? [];
}

function setHiddenFlags(state: GameState, ids: number[], value: boolean): void {
  const start = state.defines.require('FLAG_HIDDEN_ITEMS_START');
  for (const id of ids) if (id !== NO_ITEM) state.setFlag(start + id, value);
}

/** SetAllRenewableItemFlags: every renewable item picked up (hidden). */
export function SetAllRenewableItemFlags(state: GameState): void {
  for (const entry of sRenewableHiddenItems) {
    setHiddenFlags(state, entry.rare, true);
    setHiddenFlags(state, entry.uncommon, true);
    setHiddenFlags(state, entry.common, true);
  }
}

/** IncrementRenewableHiddenItemStepCounter: once per step, up to 1500. */
export function IncrementRenewableHiddenItemStepCounter(state: GameState): void {
  const v = state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER');
  if (v < RENEWABLE_ITEM_STEPS) state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', v + 1);
}

/** TryRegenerateRenewableHiddenItems: on a map load onto a map in the table, once the counter is at 1500. */
export function TryRegenerateRenewableHiddenItems(state: GameState): void {
  // gSaveBlock1Ptr->location (the map just loaded)
  if (!sRenewableHiddenItems.some((entry) => entry.map === state.currentMapId)) return;
  if (state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER') >= RENEWABLE_ITEM_STEPS) {
    state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', 0);
    SetAllRenewableItemFlags(state);
    SampleRenewableItemFlags(state);
  }
}

/** SampleRenewableItemFlags: one Random() per map in the table picks the group that comes back. */
function SampleRenewableItemFlags(state: GameState): void {
  for (const entry of sRenewableHiddenItems) {
    const rval = random() % 100;
    const flags = rval >= 90 ? entry.rare : rval >= 60 ? entry.uncommon : entry.common;
    setHiddenFlags(state, flags, false);
  }
}
