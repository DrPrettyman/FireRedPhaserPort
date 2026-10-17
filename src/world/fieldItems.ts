// What the bag's field items (item_use.c's ItemUseOnFieldCB_* and the field systems they start: fishing,
// the VS Seeker, the Itemfinder) and the registered items used with SELECT need from the field: the field
// message box (window 0), the map name popup, the wild encounter tables, and the object event anim tables.
// OverworldScene sets the host.

import type { AnimCmd } from '../entities/FieldEffects';
import { FONT_NORMAL } from '../text/Font';
import { CreateTask } from './fieldMoves';

export interface FieldItemsHost {
  /** LoadMessageBoxAndFrameGfx(0, TRUE): the dialogue frame around an empty window. */
  openMessageBox(): void;
  /**
   * AddTextPrinterParameterized(2) on window 0 (FONT_NORMAL, dark gray on white) at `x` px, `speed` frames a
   * character; `fill` is FillWindowPixelBuffer(0, PIXEL_FILL(1)) first.
   */
  printMessage(str: number[], x: number, speed: number, fill: boolean): void;
  /**
   * DisplayItemMessageOnField's message: window 0 in the dialogue frame, dark gray in `fontId` (FONT_NORMAL, or
   * FONT_MALE for Oak's "This isn't the time to use that!") at the player's text speed.
   */
  showMessage(str: number[], fontId?: number): void;
  /** IsTextPrinterActive(0) / RunTextPrintersAndIsPrinter0Active */
  messagePrinting(): boolean;
  /** ClearDialogWindowAndFrame(0, TRUE) */
  clearMessageBox(): void;
  /** DismissMapNamePopup */
  dismissMapNamePopup(): void;
  /** JOY_NEW(A_BUTTON) this frame */
  aButtonNew(): boolean;
  /** An object event anim table (sAnimTable_*, field_effects/objects.json) by name. */
  objectEventAnims(table: string): AnimCmd[][] | undefined;
  /** wild_encounter.c (world/WildEncounters.ts) */
  doesCurrentMapHaveFishingMons(): boolean;
  /** FishingWildEncounter: generates the mon and starts the wild battle. */
  fishingWildEncounter(rod: number): void;
}

let host: FieldItemsHost | undefined;

export function setFieldItemsHost(h: FieldItemsHost): void {
  host = h;
}

export function fieldItemsHost(): FieldItemsHost {
  if (!host) throw new Error('[field items] no field host');
  return host;
}

/**
 * DisplayItemMessageOnField + Task_ContinueTaskAfterMessagePrints: print `str` (already expanded, e.g.
 * gStringVar4) in the field's message box, then run `callback` once it has printed (incl. its
 * {PAUSE_UNTIL_PRESS}).
 */
export function DisplayItemMessageOnField(str: number[], callback: () => void, fontId = FONT_NORMAL): void {
  const h = fieldItemsHost();
  h.showMessage(str, fontId);
  CreateTask(() => {
    if (h.messagePrinting()) return false;
    callback();
    return true;
  });
}

/** ClearDialogWindowAndFrame(0, TRUE) on the field's message box */
export function ClearDialogWindowAndFrame(): void {
  fieldItemsHost().clearMessageBox();
}

/** DismissMapNamePopup */
export function DismissMapNamePopup(): void {
  fieldItemsHost().dismissMapNamePopup();
}
