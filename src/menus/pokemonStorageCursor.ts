// pokemon_storage_system_data.c: the box screen's hand cursor, the mon it carries (picking up, placing,
// shifting, depositing, releasing), the mon shown on the left (SetDisplayMonData), the input handlers for
// each cursor area and the action menus. MON_DATA_SANITY_IS_BAD_EGG reads as FALSE (no bad eggs).

import { K } from '../battle/constants';
import { animTable } from '../battle/gfx';
import { pokemon, state } from '../battle/env';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, JOY_HELD, JOY_NEW, JOY_REPT, L_BUTTON, R_BUTTON, SELECT_BUTTON, START_BUTTON } from '../gba/main';
import { ClearStdWindowAndFrameToTransparent, DrawStdFrameWithCustomTileAndPalette, MENU_B_PRESSED, MENU_NOTHING_CHOSEN, Menu_GetCursorPos, Menu_InitCursor, Menu_MoveCursor, ScheduleBgCopyTilemapToVram } from '../gba/menu';
import { PlaySE } from '../gba/sound';
import {
  CreateSprite,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  type Sprite,
} from '../gba/sprite';
import { gfx, gfx16 } from '../gba/gfx';
import { AddTextPrinterParameterized, AddWindow, ClearWindowTilemap, COPYWIN_GFX, CopyWindowToVram, RemoveWindow, TEXT_SKIP_DRAW } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { boxMonRestorePP, boxMonToMon, type BoxPokemon } from '../state/PokemonStorage';
import { ConvertIntToDecimalStringN, EOS, ItemId_GetName, strBody, STR_CONV_MODE_LEFT_ALIGN, text } from './common';
import {
  CountPartyAliveNonEggMonsExcept,
  CountPartyMons,
  DisplayMonPalette,
  gPlayerParty,
  gStorage,
  InPartyMenu,
  SpeciesOrEgg,
  StoragePartyCount,
  ZeroedMon,
} from './pokemonStorage';
import {
  AnimateBoxScrollArrows,
  CreateBoxMonIconAtPos,
  CreateMovingMonIcon,
  DestroyMovingMonIcon,
  DestroyPartyMonIcon,
  DestroyReleaseMonIcon,
  DoReleaseMonAnim,
  SetMovingMonPriority,
  SetMovingMonSprite,
  SetPlacedMonSprite,
  SetShiftMonSpritePtr,
  ShiftMons,
  TryHideReleaseMonSprite,
} from './pokemonStorageGraphics';
import { IsActiveItemMoving, IsItemIconAnimActive, MultiMove_CanPlaceSelection, MultiMove_GetOriginPosition, MultiMove_TryMoveGroup, TryHideItemIconAtPos, TryLoadItemIconAtPos } from './pokemonStorageMisc';
import { GetLastViewedMonIndex } from './summaryScreen';

let sMonBeingCarried: Pokemon = null as unknown as Pokemon; // set before it's read (SaveMovingMon)
let sCursorArea = 0;
let sCursorPosition = 0;
let sIsMonBeingMoved = false;
let sMovingMonOrigBoxId = 0;
let sMovingMonOrigBoxPos = 0;
let sInMultiMoveMode = false;
let sSavedCursorPosition = 0;

// Modes for selecting and moving Pokémon in the box: Select changes the cursor, then holding A while moving
// selects a rectangle (MOVE_MODE_MULTIPLE_SELECTING), which is picked up as one (MOVE_MODE_MULTIPLE_MOVING).
const MOVE_MODE_NORMAL = 0;
const MOVE_MODE_MULTIPLE_SELECTING = 1;
const MOVE_MODE_MULTIPLE_MOVING = 2;

const s8 = (v: number) => (v << 24) >> 24;

/** struct Pokemon copy (`*dst = *src`) */
function copyMon(mon: Pokemon): Pokemon {
  return structuredClone(mon);
}

/** InitCursor */
export function InitCursor(): void {
  sCursorArea = gStorage.boxOption !== K.OPTION_DEPOSIT ? K.CURSOR_AREA_IN_BOX : K.CURSOR_AREA_IN_PARTY;
  sCursorPosition = 0;
  sIsMonBeingMoved = false;
  sMovingMonOrigBoxId = 0;
  sMovingMonOrigBoxPos = 0;
  sInMultiMoveMode = false;
  ClearSavedCursorPos();
  CreateCursorSprites();
  gStorage.cursorPrevPartyPos = 1;
  gStorage.inBoxMovingMode = MOVE_MODE_NORMAL;
  TrySetDisplayMonData();
}

/** InitCursorOnReopen */
export function InitCursorOnReopen(): void {
  CreateCursorSprites();
  ReshowDisplayMon();
  gStorage.cursorPrevPartyPos = 1;
  gStorage.inBoxMovingMode = MOVE_MODE_NORMAL;
  if (sIsMonBeingMoved) {
    gStorage.movingMon = copyMon(sMonBeingCarried);
    CreateMovingMonIcon();
  }
}

function GetCursorCoordsByPos(cursorArea: number, cursorPosition: number): { x: number; y: number } {
  switch (cursorArea) {
    case K.CURSOR_AREA_IN_BOX:
      return { x: (cursorPosition % K.IN_BOX_COLUMNS) * 24 + 100, y: Math.trunc(cursorPosition / K.IN_BOX_COLUMNS) * 24 + 32 };
    case K.CURSOR_AREA_IN_PARTY:
      if (cursorPosition === 0) return { x: 104, y: 52 };
      if (cursorPosition === K.PARTY_SIZE) return { x: 152, y: 132 };
      return { x: 152, y: (cursorPosition - 1) * 24 + 4 };
    case K.CURSOR_AREA_BOX_TITLE:
      return { x: 162, y: 12 };
    case K.CURSOR_AREA_BUTTONS:
      return { x: cursorPosition * 88 + 120, y: sIsMonBeingMoved ? 8 : 14 };
    case 4:
      return { x: 160, y: 96 };
  }
  return { x: 0, y: 0 };
}

function GetSpeciesAtCursorPosition(): number {
  switch (sCursorArea) {
    case K.CURSOR_AREA_IN_PARTY:
      return gPlayerParty[sCursorPosition]?.species ?? K.SPECIES_NONE;
    case K.CURSOR_AREA_IN_BOX:
      return state.storage.getCurrentBoxMonData(sCursorPosition, 'species') || K.SPECIES_NONE;
    default:
      return K.SPECIES_NONE;
  }
}

/** UpdateCursorPos: TRUE while the cursor is still moving. */
export function UpdateCursorPos(): boolean {
  const c = gStorage.cursorSprite;
  if (gStorage.cursorMoveSteps === 0) {
    if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return false;
    return IsItemIconAnimActive();
  } else if (--gStorage.cursorMoveSteps !== 0) {
    // Update position toward target
    gStorage.cursorNewX += gStorage.cursorSpeedX;
    gStorage.cursorNewY += gStorage.cursorSpeedY;
    c.x = (gStorage.cursorNewX >> 8) << 16 >> 16;
    c.y = (gStorage.cursorNewY >> 8) << 16 >> 16;

    // Limit cursor on right
    if (c.x > DISPLAY_WIDTH + 16) c.x = c.x - (DISPLAY_WIDTH + 16) + 64;
    // Limit cursor on left
    if (c.x < 64) c.x = DISPLAY_WIDTH + 16 - (64 - c.x);
    // Limit cursor on bottom
    if (c.y > DISPLAY_HEIGHT + 16) c.y = c.y - (DISPLAY_HEIGHT + 16) - 16;
    // Limit cursor on top
    if (c.y < -16) c.y = DISPLAY_HEIGHT + 16 - (-16 - c.y);

    // Cursor flips vertically when moving on/off the top buttons
    if (gStorage.cursorFlipTimer && --gStorage.cursorFlipTimer === 0) c.vFlip = !c.vFlip;
  } else {
    // Time is up for cursor movement, make sure it's exactly at target
    c.x = gStorage.cursorTargetX;
    c.y = gStorage.cursorTargetY;
    DoCursorNewPosUpdate();
  }
  return true;
}

function InitNewCursorPos(newCursorArea: number, newCursorPosition: number): void {
  const { x, y } = GetCursorCoordsByPos(newCursorArea, newCursorPosition);
  gStorage.newCursorArea = newCursorArea;
  gStorage.newCursorPosition = newCursorPosition;
  gStorage.cursorTargetX = x;
  gStorage.cursorTargetY = y;
}

function InitCursorMove(): void {
  const c = gStorage.cursorSprite;
  gStorage.cursorMoveSteps = gStorage.cursorVerticalWrap !== 0 || gStorage.cursorHorizontalWrap !== 0 ? 12 : 6;
  if (gStorage.cursorFlipTimer) gStorage.cursorFlipTimer = gStorage.cursorMoveSteps >> 1;

  let yDistance: number;
  switch (gStorage.cursorVerticalWrap) {
    default:
      yDistance = gStorage.cursorTargetY - c.y;
      break;
    case -1:
      yDistance = gStorage.cursorTargetY - 192 - c.y;
      break;
    case 1:
      yDistance = gStorage.cursorTargetY + 192 - c.y;
      break;
  }
  let xDistance: number;
  switch (gStorage.cursorHorizontalWrap) {
    default:
      xDistance = gStorage.cursorTargetX - c.x;
      break;
    case -1:
      xDistance = gStorage.cursorTargetX - 192 - c.x;
      break;
    case 1:
      xDistance = gStorage.cursorTargetX + 192 - c.x;
      break;
  }
  yDistance <<= 8;
  xDistance <<= 8;
  // cursorSpeedX/Y are u32: the division is signed (int / u16), then stored
  gStorage.cursorSpeedX = Math.trunc(xDistance / gStorage.cursorMoveSteps);
  gStorage.cursorSpeedY = Math.trunc(yDistance / gStorage.cursorMoveSteps);
  gStorage.cursorNewX = c.x << 8;
  gStorage.cursorNewY = c.y << 8;
}

function SetCursorPosition(newCursorArea: number, newCursorPosition: number): void {
  InitNewCursorPos(newCursorArea, newCursorPosition);
  InitCursorMove();
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
    if (gStorage.inBoxMovingMode === MOVE_MODE_NORMAL && !sIsMonBeingMoved) StartSpriteAnim(gStorage.cursorSprite, 1);
  } else if (!IsActiveItemMoving()) {
    StartSpriteAnim(gStorage.cursorSprite, 1);
  }

  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    if (sCursorArea === K.CURSOR_AREA_IN_BOX) TryHideItemIconAtPos(K.CURSOR_AREA_IN_BOX, sCursorPosition);
    else if (sCursorArea === K.CURSOR_AREA_IN_PARTY) TryHideItemIconAtPos(K.CURSOR_AREA_IN_PARTY, sCursorPosition);

    if (newCursorArea === K.CURSOR_AREA_IN_BOX) TryLoadItemIconAtPos(newCursorArea, newCursorPosition);
    else if (newCursorArea === K.CURSOR_AREA_IN_PARTY) TryLoadItemIconAtPos(newCursorArea, newCursorPosition);
  }

  if (newCursorArea === K.CURSOR_AREA_IN_PARTY && sCursorArea !== K.CURSOR_AREA_IN_PARTY) {
    gStorage.cursorPrevPartyPos = 1;
    gStorage.cursorShadowSprite.invisible = true;
  }

  switch (newCursorArea) {
    case K.CURSOR_AREA_IN_PARTY:
    case K.CURSOR_AREA_BOX_TITLE:
    case K.CURSOR_AREA_BUTTONS:
      gStorage.cursorSprite.oam.priority = 1;
      gStorage.cursorShadowSprite.invisible = true;
      gStorage.cursorShadowSprite.oam.priority = 1;
      break;
    case K.CURSOR_AREA_IN_BOX:
      if (gStorage.inBoxMovingMode !== MOVE_MODE_NORMAL) {
        gStorage.cursorSprite.oam.priority = 0;
        gStorage.cursorShadowSprite.invisible = true;
      } else {
        gStorage.cursorSprite.oam.priority = 2;
        if (sCursorArea === K.CURSOR_AREA_IN_BOX && sIsMonBeingMoved) SetMovingMonPriority(2);
      }
      break;
  }
}

function DoCursorNewPosUpdate(): void {
  sCursorArea = gStorage.newCursorArea;
  sCursorPosition = gStorage.newCursorPosition;
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) {
    if (gStorage.inBoxMovingMode === MOVE_MODE_NORMAL && !sIsMonBeingMoved) StartSpriteAnim(gStorage.cursorSprite, 1);
  } else if (!IsActiveItemMoving()) {
    StartSpriteAnim(gStorage.cursorSprite, 1);
  }

  TrySetDisplayMonData();
  switch (sCursorArea) {
    case K.CURSOR_AREA_BUTTONS:
      SetMovingMonPriority(1);
      break;
    case K.CURSOR_AREA_BOX_TITLE:
      AnimateBoxScrollArrows(true);
      break;
    case K.CURSOR_AREA_IN_PARTY:
      gStorage.cursorShadowSprite.subpriority = 13;
      SetMovingMonPriority(1);
      break;
    case K.CURSOR_AREA_IN_BOX:
      if (gStorage.inBoxMovingMode === MOVE_MODE_NORMAL) {
        gStorage.cursorSprite.oam.priority = 1;
        gStorage.cursorShadowSprite.oam.priority = 2;
        gStorage.cursorShadowSprite.subpriority = 21;
        gStorage.cursorShadowSprite.invisible = false;
        SetMovingMonPriority(2);
      }
      break;
  }
}

/** SetCursorInParty */
export function SetCursorInParty(): void {
  let partyCount: number;
  if (!sIsMonBeingMoved) {
    partyCount = 0;
  } else {
    partyCount = StoragePartyCount();
    if (partyCount >= K.PARTY_SIZE) partyCount = K.PARTY_SIZE - 1;
  }
  if (gStorage.cursorSprite.vFlip) gStorage.cursorFlipTimer = 1;
  SetCursorPosition(K.CURSOR_AREA_IN_PARTY, partyCount);
}

export function SetCursorBoxPosition(cursorBoxPosition: number): void {
  SetCursorPosition(K.CURSOR_AREA_IN_BOX, cursorBoxPosition);
}

export function ClearSavedCursorPos(): void {
  sSavedCursorPosition = 0;
}

export function SaveCursorPos(): void {
  sSavedCursorPosition = sCursorPosition;
}

export function GetSavedCursorPos(): number {
  return sSavedCursorPosition;
}

/** InitMonPlaceChange */
export function InitMonPlaceChange(type: number): void {
  const placeChangeFuncs = [MonPlaceChange_Grab, MonPlaceChange_Place, MonPlaceChange_Shift];
  gStorage.monPlaceChangeFunc = placeChangeFuncs[type];
  gStorage.monPlaceChangeState = 0;
}

/** InitMultiMonPlaceChange */
export function InitMultiMonPlaceChange(moveCursorUp: boolean): void {
  gStorage.monPlaceChangeFunc = moveCursorUp ? MonPlaceChange_DoMoveCursorUp : MonPlaceChange_DoMoveCursorDown;
  gStorage.monPlaceChangeState = 0;
}

export function DoMonPlaceChange(): boolean {
  return gStorage.monPlaceChangeFunc();
}

function MonPlaceChange_Grab(): boolean {
  switch (gStorage.monPlaceChangeState) {
    case 0:
      if (sIsMonBeingMoved) return false;
      StartSpriteAnim(gStorage.cursorSprite, 2);
      gStorage.monPlaceChangeState++;
      break;
    case 1:
      if (!MonPlaceChange_MoveCursorDown()) {
        StartSpriteAnim(gStorage.cursorSprite, 3);
        MoveMon();
        gStorage.monPlaceChangeState++;
      }
      break;
    case 2:
      if (!MonPlaceChange_MoveCursorUp()) gStorage.monPlaceChangeState++;
      break;
    case 3:
      return false;
  }
  return true;
}

function MonPlaceChange_Place(): boolean {
  switch (gStorage.monPlaceChangeState) {
    case 0:
      if (!MonPlaceChange_MoveCursorDown()) {
        StartSpriteAnim(gStorage.cursorSprite, 2);
        PlaceMon();
        gStorage.monPlaceChangeState++;
      }
      break;
    case 1:
      if (!MonPlaceChange_MoveCursorUp()) {
        StartSpriteAnim(gStorage.cursorSprite, 0);
        gStorage.monPlaceChangeState++;
      }
      break;
    case 2:
      return false;
  }
  return true;
}

function MonPlaceChange_Shift(): boolean {
  switch (gStorage.monPlaceChangeState) {
    case 0:
      switch (sCursorArea) {
        case K.CURSOR_AREA_IN_PARTY:
          gStorage.shiftBoxId = K.TOTAL_BOXES_COUNT;
          break;
        case K.CURSOR_AREA_IN_BOX:
          gStorage.shiftBoxId = state.storage.getCurrentBox();
          break;
        default:
          return false;
      }
      StartSpriteAnim(gStorage.cursorSprite, 2);
      SetShiftMonSpritePtr(gStorage.shiftBoxId, sCursorPosition);
      gStorage.monPlaceChangeState++;
      break;
    case 1:
      if (!ShiftMons()) {
        StartSpriteAnim(gStorage.cursorSprite, 3);
        SetShiftedMonData(gStorage.shiftBoxId, sCursorPosition);
        gStorage.monPlaceChangeState++;
      }
      break;
    case 2:
      return false;
  }
  return true;
}

function MonPlaceChange_DoMoveCursorDown(): boolean {
  return MonPlaceChange_MoveCursorDown();
}

function MonPlaceChange_DoMoveCursorUp(): boolean {
  return MonPlaceChange_MoveCursorUp();
}

function MonPlaceChange_MoveCursorDown(): boolean {
  if (gStorage.cursorSprite.y2 === 8) return false; // Cursor has reached bottom
  gStorage.cursorSprite.y2++;
  return true;
}

function MonPlaceChange_MoveCursorUp(): boolean {
  if (gStorage.cursorSprite.y2 === 0) return false; // Cursor has reached top
  gStorage.cursorSprite.y2--;
  return true;
}

function MoveMon(): void {
  switch (sCursorArea) {
    case K.CURSOR_AREA_IN_PARTY:
      SetMovedMonData(K.TOTAL_BOXES_COUNT, sCursorPosition);
      SetMovingMonSprite(K.MODE_PARTY, sCursorPosition);
      break;
    case K.CURSOR_AREA_IN_BOX:
      if (gStorage.inBoxMovingMode === MOVE_MODE_NORMAL) {
        SetMovedMonData(state.storage.getCurrentBox(), sCursorPosition);
        SetMovingMonSprite(K.MODE_BOX, sCursorPosition);
      }
      break;
    default:
      return;
  }
  sIsMonBeingMoved = true;
}

function PlaceMon(): void {
  switch (sCursorArea) {
    case K.CURSOR_AREA_IN_PARTY:
      SetPlacedMonData(K.TOTAL_BOXES_COUNT, sCursorPosition);
      SetPlacedMonSprite(K.TOTAL_BOXES_COUNT, sCursorPosition);
      break;
    case K.CURSOR_AREA_IN_BOX: {
      const boxId = state.storage.getCurrentBox();
      SetPlacedMonData(boxId, sCursorPosition);
      SetPlacedMonSprite(boxId, sCursorPosition);
      break;
    }
    default:
      return;
  }
  sIsMonBeingMoved = false;
}

export function DoTrySetDisplayMonData(): void {
  TrySetDisplayMonData();
}

/** BoxMonAtToMon (pokemon_storage_system.c) */
function BoxMonAtToMon(boxId: number, position: number): Pokemon {
  return state.storage.boxMonAtToMon(pokemon, boxId, position) ?? ZeroedMon();
}

function SetMovedMonData(boxId: number, position: number): void {
  if (boxId === K.TOTAL_BOXES_COUNT) gStorage.movingMon = copyMon(gPlayerParty[sCursorPosition] ?? ZeroedMon());
  else gStorage.movingMon = BoxMonAtToMon(boxId, position);
  PurgeMonOrBoxMon(boxId, position);
  sMovingMonOrigBoxId = boxId;
  sMovingMonOrigBoxPos = position;
}

function SetPlacedMonData(boxId: number, position: number): void {
  if (boxId === K.TOTAL_BOXES_COUNT) {
    gPlayerParty[position] = copyMon(gStorage.movingMon);
  } else {
    boxMonRestorePP(pokemon, gStorage.movingMon);
    state.storage.setBoxMonAt(boxId, position, gStorage.movingMon);
  }
}

function PurgeMonOrBoxMon(boxId: number, position: number): void {
  if (boxId === K.TOTAL_BOXES_COUNT) gPlayerParty[position] = null;
  else state.storage.zeroBoxMonAt(boxId, position);
}

function SetShiftedMonData(boxId: number, position: number): void {
  if (boxId === K.TOTAL_BOXES_COUNT) gStorage.tempMon = copyMon(gPlayerParty[position] ?? ZeroedMon());
  else gStorage.tempMon = BoxMonAtToMon(boxId, position);
  SetPlacedMonData(boxId, position);
  gStorage.movingMon = gStorage.tempMon;
  SetDisplayMonData(gStorage.movingMon, K.MODE_PARTY);
  sMovingMonOrigBoxId = boxId;
  sMovingMonOrigBoxPos = position;
}

/** TryStorePartyMonInBox */
export function TryStorePartyMonInBox(boxId: number): boolean {
  const boxPosition = state.storage.getFirstFreeBoxSpot(boxId);
  if (boxPosition === -1) return false;

  if (sIsMonBeingMoved) {
    SetPlacedMonData(boxId, boxPosition);
    DestroyMovingMonIcon();
    sIsMonBeingMoved = false;
  } else {
    SetMovedMonData(K.TOTAL_BOXES_COUNT, sCursorPosition);
    SetPlacedMonData(boxId, boxPosition);
    DestroyPartyMonIcon(sCursorPosition);
  }

  if (boxId === state.storage.getCurrentBox()) CreateBoxMonIconAtPos(boxPosition);

  StartSpriteAnim(gStorage.cursorSprite, 1);
  return true;
}

export function ResetSelectionAfterDeposit(): void {
  StartSpriteAnim(gStorage.cursorSprite, 0);
  TrySetDisplayMonData();
}

export function InitReleaseMon(): void {
  let mode: number;
  if (sIsMonBeingMoved) mode = K.MODE_MOVE;
  else if (sCursorArea === K.CURSOR_AREA_IN_PARTY) mode = K.MODE_PARTY;
  else mode = K.MODE_BOX;
  DoReleaseMonAnim(mode, sCursorPosition);
  gStorage.releaseMonName = [...gStorage.displayMonNickname];
}

export function TryHideReleaseMon(): boolean {
  if (!TryHideReleaseMonSprite()) {
    StartSpriteAnim(gStorage.cursorSprite, 0);
    return false;
  }
  return true;
}

export function ReleaseMon(): void {
  DestroyReleaseMonIcon();
  if (sIsMonBeingMoved) {
    sIsMonBeingMoved = false;
  } else {
    const boxId = sCursorArea === K.CURSOR_AREA_IN_PARTY ? K.TOTAL_BOXES_COUNT : state.storage.getCurrentBox();
    PurgeMonOrBoxMon(boxId, sCursorPosition);
  }
  TrySetDisplayMonData();
}

export function TrySetCursorFistAnim(): void {
  if (sIsMonBeingMoved) StartSpriteAnim(gStorage.cursorSprite, 3);
}

/** GetMonData(mon, MON_DATA_KNOWN_MOVES, list): bit i is set if the mon knows list[i] (list ends at MOVES_COUNT). */
function KnownMoves(mon: { species: number; moves: number[] } | null, list: number[]): number {
  if (!mon || !mon.species) return 0;
  let flags = 0;
  for (let i = 0; list[i] !== K.MOVES_COUNT; i++) if (mon.moves.includes(list[i])) flags |= 1 << i;
  return flags;
}

export function InitCanReleaseMonVars(): void {
  if (sIsMonBeingMoved) {
    gStorage.tempMon = copyMon(gStorage.movingMon);
    gStorage.releaseBoxId = -1;
    gStorage.releaseBoxPos = -1;
  } else {
    if (sCursorArea === K.CURSOR_AREA_IN_PARTY) {
      gStorage.tempMon = copyMon(gPlayerParty[sCursorPosition] ?? ZeroedMon());
      gStorage.releaseBoxId = K.TOTAL_BOXES_COUNT;
    } else {
      gStorage.tempMon = BoxMonAtToMon(state.storage.getCurrentBox(), sCursorPosition);
      gStorage.releaseBoxId = state.storage.getCurrentBox();
    }
    gStorage.releaseBoxPos = sCursorPosition;
  }

  gStorage.isSurfMon = false;
  gStorage.isDiveMon = false;
  gStorage.restrictedMoveList = [K.MOVE_SURF, K.MOVE_DIVE, K.MOVES_COUNT];
  const knownMoveFlags = KnownMoves(gStorage.tempMon, gStorage.restrictedMoveList);
  gStorage.isSurfMon = (knownMoveFlags & 1) !== 0;
  gStorage.isDiveMon = ((knownMoveFlags >> 1) & 1) !== 0;
  if (gStorage.isSurfMon || gStorage.isDiveMon) {
    gStorage.releaseMonStatusResolved = false;
  } else {
    gStorage.releaseMonStatusResolved = true;
    gStorage.releaseMonStatus = K.RELEASE_MON_ALLOWED;
  }
  gStorage.releaseCheckState = 0;
}

/** RunCanReleaseMon: whether another mon still knows Surf / Dive (checked a few box slots per call). */
export function RunCanReleaseMon(): number {
  if (gStorage.releaseMonStatusResolved) return gStorage.releaseMonStatus;

  switch (gStorage.releaseCheckState) {
    case 0:
      for (let i = 0; i < K.PARTY_SIZE; i++) {
        if (gStorage.releaseBoxId !== K.TOTAL_BOXES_COUNT || gStorage.releaseBoxPos !== i) {
          const knownMoveFlags = KnownMoves(gPlayerParty[i], gStorage.restrictedMoveList);
          if (knownMoveFlags & 1) gStorage.isSurfMon = false;
          if (knownMoveFlags & 2) gStorage.isDiveMon = false;
        }
      }
      if (!(gStorage.isSurfMon || gStorage.isDiveMon)) {
        gStorage.releaseMonStatusResolved = true;
        gStorage.releaseMonStatus = K.RELEASE_MON_ALLOWED;
      } else {
        gStorage.releaseCheckBoxId = 0;
        gStorage.releaseCheckBoxPos = 0;
        gStorage.releaseCheckState++;
      }
      break;
    case 1:
      // for some reason, check only 5 mons in box each time this function is called
      for (let i = 0; i < 5; i++) {
        const knownMoveFlags = KnownMoves(state.storage.getBoxedMon(gStorage.releaseCheckBoxId, gStorage.releaseCheckBoxPos), gStorage.restrictedMoveList);
        if (knownMoveFlags !== 0 && !(gStorage.releaseBoxId === gStorage.releaseCheckBoxId && gStorage.releaseBoxPos === gStorage.releaseCheckBoxPos)) {
          if (knownMoveFlags & 1) gStorage.isSurfMon = false;
          if (knownMoveFlags & 2) gStorage.isDiveMon = false;
        }
        if (++gStorage.releaseCheckBoxPos >= K.IN_BOX_COUNT) {
          gStorage.releaseCheckBoxPos = 0;
          if (++gStorage.releaseCheckBoxId >= K.TOTAL_BOXES_COUNT) {
            gStorage.releaseMonStatusResolved = true;
            gStorage.releaseMonStatus = K.RELEASE_MON_NOT_ALLOWED;
            break;
          }
        }
      }
      if (!(gStorage.isSurfMon || gStorage.isDiveMon)) {
        gStorage.releaseMonStatusResolved = true;
        gStorage.releaseMonStatus = K.RELEASE_MON_ALLOWED;
      }
      break;
  }
  return K.RELEASE_MON_UNDETERMINED;
}

export function SaveMovingMon(): void {
  if (sIsMonBeingMoved) sMonBeingCarried = copyMon(gStorage.movingMon);
}

export function LoadSavedMovingMon(): void {
  if (sIsMonBeingMoved) {
    if (sMovingMonOrigBoxId === K.TOTAL_BOXES_COUNT) gStorage.movingMon = copyMon(sMonBeingCarried);
    else gStorage.movingMon = boxMonToMon(pokemon, sMonBeingCarried); // movingMon.box = sMonBeingCarried.box
  }
}

/** InitSummaryScreenData */
export function InitSummaryScreenData(): void {
  if (sIsMonBeingMoved) {
    SaveMovingMon();
    gStorage.summaryMons = [sMonBeingCarried];
    gStorage.summaryCursorPos = 0;
    gStorage.summaryLastIndex = 0;
    gStorage.summaryScreenMode = K.PSS_MODE_NORMAL;
  } else if (sCursorArea === K.CURSOR_AREA_IN_PARTY) {
    // gPlayerParty: written back (compacted) before the summary screen opens
    gStorage.summaryMons = state.party;
    gStorage.summaryCursorPos = sCursorPosition;
    gStorage.summaryLastIndex = CountPartyMons() - 1;
    gStorage.summaryScreenMode = K.PSS_MODE_NORMAL;
  } else {
    gStorage.summaryMons = state.storage.boxes[state.storage.getCurrentBox()];
    gStorage.summaryCursorPos = sCursorPosition;
    gStorage.summaryLastIndex = K.IN_BOX_COUNT - 1;
    gStorage.summaryScreenMode = K.PSS_MODE_BOX;
  }
}

/** SetSelectionAfterSummaryScreen */
export function SetSelectionAfterSummaryScreen(): void {
  if (sIsMonBeingMoved) LoadSavedMovingMon();
  else sCursorPosition = GetLastViewedMonIndex();
}

/** CompactPartySlots: the first empty slot before compacting, or -1. */
export function CompactPartySlots(): number {
  let retVal = -1;
  let last = 0;
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = gPlayerParty[i];
    if (mon && mon.species !== K.SPECIES_NONE) {
      if (i !== last) gPlayerParty[last] = mon;
      last++;
    } else if (retVal === -1) {
      retVal = i;
    }
  }
  for (; last < K.PARTY_SIZE; last++) gPlayerParty[last] = null;
  return retVal;
}

/** SetMonMarkings */
export function SetMonMarkings(markings: number): void {
  gStorage.displayMonMarkings = markings;
  if (sIsMonBeingMoved) {
    gStorage.movingMon.markings = markings;
  } else {
    if (sCursorArea === K.CURSOR_AREA_IN_PARTY) {
      const mon = gPlayerParty[sCursorPosition];
      if (mon) mon.markings = markings;
    }
    if (sCursorArea === K.CURSOR_AREA_IN_BOX) state.storage.setCurrentBoxMonData(sCursorPosition, 'markings', markings);
  }
}

export function CanMovePartyMon(): boolean {
  return sCursorArea === K.CURSOR_AREA_IN_PARTY && !sIsMonBeingMoved && CountPartyAliveNonEggMonsExcept(sCursorPosition) === 0;
}

export function CanShiftMon(): boolean {
  if (sIsMonBeingMoved) {
    if (sCursorArea === K.CURSOR_AREA_IN_PARTY && CountPartyAliveNonEggMonsExcept(sCursorPosition) === 0) {
      if (gStorage.displayMonIsEgg || gStorage.movingMon.hp === 0) return false;
    }
    return true;
  }
  return false;
}

export function IsMonBeingMoved(): boolean {
  return sIsMonBeingMoved;
}

export function IsCursorOnBoxTitle(): boolean {
  return sCursorArea === K.CURSOR_AREA_BOX_TITLE;
}

export function IsCursorOnCloseBox(): boolean {
  return sCursorArea === K.CURSOR_AREA_BUTTONS && sCursorPosition === 1;
}

export function IsCursorInBox(): boolean {
  return sCursorArea === K.CURSOR_AREA_IN_BOX;
}

function TrySetDisplayMonData(): void {
  gStorage.setMosaic = !sIsMonBeingMoved;
  if (!sIsMonBeingMoved) {
    switch (sCursorArea) {
      case K.CURSOR_AREA_IN_PARTY:
        if (sCursorPosition < K.PARTY_SIZE) {
          SetDisplayMonData(gPlayerParty[sCursorPosition], K.MODE_PARTY);
          break;
        }
      // fallthrough
      case K.CURSOR_AREA_BUTTONS:
      case K.CURSOR_AREA_BOX_TITLE:
        SetDisplayMonData(null, K.MODE_MOVE);
        break;
      case K.CURSOR_AREA_IN_BOX:
        SetDisplayMonData(state.storage.getBoxedMon(state.storage.getCurrentBox(), sCursorPosition), K.MODE_BOX);
        break;
    }
  }
}

function ReshowDisplayMon(): void {
  if (sIsMonBeingMoved) SetDisplayMonData(sMonBeingCarried, K.MODE_PARTY);
  else TrySetDisplayMonData();
}

/** StringCopyPadded: src, then `c` up to n characters (with EOS). */
function StringCopyPadded(src: number[], c: number, n: number): number[] {
  const out = strBody(src);
  while (out.length < n) out.push(c);
  return [...out, EOS];
}

/** StringFill */
function StringFill(c: number, n: number): number[] {
  return [...Array<number>(n).fill(c), EOS];
}

function SetDisplayMonData(mon: Pokemon | BoxPokemon | null, mode: number): void {
  let gender = K.MON_MALE;
  const sanityIsBadEgg = false; // MON_DATA_SANITY_IS_BAD_EGG
  gStorage.displayMonItemId = K.ITEM_NONE;
  if ((mode === K.MODE_PARTY || mode === K.MODE_BOX) && mon && mon.species) {
    gStorage.displayMonSpecies = SpeciesOrEgg(mon);
    gStorage.displayMonIsEgg = sanityIsBadEgg || mon.isEgg;
    gStorage.displayMonNickname = [...strBody(mon.nickname).slice(0, K.POKEMON_NAME_LENGTH), EOS]; // StringGet_Nickname
    gStorage.displayMonLevel = mode === K.MODE_PARTY ? (mon as Pokemon).level : pokemon.levelFromExp(mon as Pokemon); // GetLevelFromBoxMonExp
    gStorage.displayMonMarkings = mon.markings ?? 0;
    gStorage.displayMonPersonality = mon.personality;
    // GetMonFrontSpritePal / GetMonSpritePalFromSpeciesAndPersonality
    gStorage.displayMonPalette = DisplayMonPalette(gStorage.displayMonSpecies, mon.otId, mon.personality);
    gender = pokemon.genderFromPersonality(gStorage.displayMonSpecies === K.SPECIES_EGG ? mon.species : gStorage.displayMonSpecies, mon.personality);
    gStorage.displayMonItemId = mon.heldItem;
  } else {
    gStorage.displayMonSpecies = K.SPECIES_NONE;
    gStorage.displayMonItemId = K.ITEM_NONE;
  }

  const t = gStorage.displayMonTexts;
  if (gStorage.displayMonSpecies === K.SPECIES_NONE) {
    gStorage.displayMonNickname = StringFill(K.CHAR_SPACE, 5);
    t[0] = StringFill(K.CHAR_SPACE, 8);
    t[1] = StringFill(K.CHAR_SPACE, 8);
    t[2] = StringFill(K.CHAR_SPACE, 8);
    t[3] = StringFill(K.CHAR_SPACE, 8);
  } else if (gStorage.displayMonIsEgg) {
    if (sanityIsBadEgg) t[0] = StringCopyPadded(gStorage.displayMonNickname, K.CHAR_SPACE, 5);
    else t[0] = StringCopyPadded(text('gText_EggNickname'), K.CHAR_SPACE, 8);
    t[1] = StringFill(K.CHAR_SPACE, 8);
    t[2] = StringFill(K.CHAR_SPACE, 8);
    t[3] = StringFill(K.CHAR_SPACE, 8);
  } else {
    if (gStorage.displayMonSpecies === K.SPECIES_NIDORAN_F || gStorage.displayMonSpecies === K.SPECIES_NIDORAN_M) gender = K.MON_GENDERLESS;

    // Buffer nickname
    t[0] = StringCopyPadded(gStorage.displayMonNickname, K.CHAR_SPACE, 5);

    // Buffer species name
    t[1] = [K.CHAR_SLASH, ...StringCopyPadded(pokemon.speciesName(gStorage.displayMonSpecies), K.CHAR_SPACE, 5)];

    // Buffer gender and level
    const g: number[] = [K.EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_COLOR_HIGHLIGHT_SHADOW];
    switch (gender) {
      case K.MON_MALE:
        g.push(K.TEXT_COLOR_RED, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_LIGHT_RED, K.CHAR_MALE);
        break;
      case K.MON_FEMALE:
        g.push(K.TEXT_COLOR_GREEN, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_LIGHT_GREEN, K.CHAR_FEMALE);
        break;
      default:
        g.push(K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_LIGHT_GRAY, K.CHAR_SPACE);
        break;
    }
    g.push(K.EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_COLOR_HIGHLIGHT_SHADOW, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_LIGHT_GRAY);
    g.push(K.CHAR_SPACE, K.CHAR_EXTRA_SYMBOL, K.CHAR_LV_2);
    g.push(...strBody(ConvertIntToDecimalStringN(gStorage.displayMonLevel, STR_CONV_MODE_LEFT_ALIGN, 3)));
    g.push(K.CHAR_SPACE, EOS);
    t[2] = g;

    // Buffer item name
    if (gStorage.displayMonItemId !== K.ITEM_NONE) t[3] = StringCopyPadded(ItemId_GetName(gStorage.displayMonItemId), K.CHAR_SPACE, 8);
    else t[3] = StringFill(K.CHAR_SPACE, 8);
  }
}

/** SetDisplayMonData for the shifted mon (exported for SetShiftedMonData's MODE_PARTY call in other files). */
export { SetDisplayMonData };

function HandleInput_InBox(): number {
  switch (gStorage.inBoxMovingMode) {
    case MOVE_MODE_NORMAL:
    default:
      return HandleInput_InBox_Normal();
    case MOVE_MODE_MULTIPLE_SELECTING:
      return HandleInput_InBox_GrabbingMultiple();
    case MOVE_MODE_MULTIPLE_MOVING:
      return HandleInput_InBox_MovingMultiple();
  }
}

/** The input for a single-press action from the first menu entry (multi-move mode, MOVE POKéMON aside). */
function InputForFirstMenuItem(): number | undefined {
  switch (GetMenuItemTextId(0)) {
    case K.MENU_TEXT_STORE:
      return K.INPUT_DEPOSIT;
    case K.MENU_TEXT_WITHDRAW:
      return K.INPUT_WITHDRAW;
    case K.MENU_TEXT_MOVE:
      return K.INPUT_MOVE_MON;
    case K.MENU_TEXT_SHIFT:
      return K.INPUT_SHIFT_MON;
    case K.MENU_TEXT_PLACE:
      return K.INPUT_PLACE_MON;
    case K.MENU_TEXT_TAKE:
      return K.INPUT_TAKE_ITEM;
    case K.MENU_TEXT_GIVE:
      return K.INPUT_GIVE_ITEM;
    case K.MENU_TEXT_SWITCH:
      return K.INPUT_SWITCH_ITEMS;
  }
  return undefined;
}

function HandleInput_InBox_Normal(): number {
  let input: number;
  let cursorArea = sCursorArea;
  let cursorPosition = sCursorPosition;
  do {
    gStorage.cursorVerticalWrap = 0;
    gStorage.cursorHorizontalWrap = 0;
    gStorage.cursorFlipTimer = 0;
    if (JOY_REPT(DPAD_UP)) {
      input = K.INPUT_MOVE_CURSOR;
      if (sCursorPosition >= K.IN_BOX_COLUMNS) {
        cursorPosition -= K.IN_BOX_COLUMNS;
      } else {
        cursorArea = K.CURSOR_AREA_BOX_TITLE;
        cursorPosition = 0;
      }
      break;
    } else if (JOY_REPT(DPAD_DOWN)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorPosition += K.IN_BOX_COLUMNS;
      if (cursorPosition >= K.IN_BOX_COUNT) {
        cursorArea = K.CURSOR_AREA_BUTTONS;
        cursorPosition -= K.IN_BOX_COUNT;
        cursorPosition = Math.trunc(cursorPosition / 3);
        gStorage.cursorVerticalWrap = 1;
        gStorage.cursorFlipTimer = 1;
      }
      break;
    } else if (JOY_REPT(DPAD_LEFT)) {
      input = K.INPUT_MOVE_CURSOR;
      if (sCursorPosition % K.IN_BOX_COLUMNS !== 0) {
        cursorPosition--;
      } else {
        gStorage.cursorHorizontalWrap = -1;
        cursorPosition += K.IN_BOX_COLUMNS - 1;
      }
      break;
    } else if (JOY_REPT(DPAD_RIGHT)) {
      input = K.INPUT_MOVE_CURSOR;
      if ((sCursorPosition + 1) % K.IN_BOX_COLUMNS !== 0) {
        cursorPosition++;
      } else {
        gStorage.cursorHorizontalWrap = 1;
        cursorPosition -= K.IN_BOX_COLUMNS - 1;
      }
      break;
    } else if (JOY_NEW(START_BUTTON)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorArea = K.CURSOR_AREA_BOX_TITLE;
      cursorPosition = 0;
      break;
    }

    if (JOY_NEW(A_BUTTON) && SetSelectionMenuTexts()) {
      if (!sInMultiMoveMode) return K.INPUT_IN_MENU;
      if (gStorage.boxOption !== K.OPTION_MOVE_MONS || sIsMonBeingMoved) {
        const quick = InputForFirstMenuItem();
        if (quick !== undefined) return quick;
      } else {
        gStorage.inBoxMovingMode = MOVE_MODE_MULTIPLE_SELECTING;
        return K.INPUT_MULTIMOVE_START;
      }
    }

    if (JOY_NEW(B_BUTTON)) return K.INPUT_PRESSED_B;

    if (state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_LR) {
      if (JOY_HELD(L_BUTTON)) return K.INPUT_SCROLL_LEFT;
      if (JOY_HELD(R_BUTTON)) return K.INPUT_SCROLL_RIGHT;
    }

    if (JOY_NEW(SELECT_BUTTON)) {
      ToggleCursorMultiMoveMode();
      return K.INPUT_NONE;
    }

    input = K.INPUT_NONE;
  } while (false);

  if (input !== K.INPUT_NONE) SetCursorPosition(cursorArea, s8(cursorPosition));
  return input;
}

function HandleInput_InBox_GrabbingMultiple(): number {
  if (JOY_HELD(A_BUTTON)) {
    if (JOY_REPT(DPAD_UP)) {
      if (Math.trunc(sCursorPosition / K.IN_BOX_COLUMNS) !== 0) {
        SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition - K.IN_BOX_COLUMNS);
        return K.INPUT_MULTIMOVE_CHANGE_SELECTION;
      }
      return K.INPUT_MULTIMOVE_UNABLE;
    } else if (JOY_REPT(DPAD_DOWN)) {
      if (sCursorPosition + K.IN_BOX_COLUMNS < K.IN_BOX_COUNT) {
        SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition + K.IN_BOX_COLUMNS);
        return K.INPUT_MULTIMOVE_CHANGE_SELECTION;
      }
      return K.INPUT_MULTIMOVE_UNABLE;
    } else if (JOY_REPT(DPAD_LEFT)) {
      if (sCursorPosition % K.IN_BOX_COLUMNS !== 0) {
        SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition - 1);
        return K.INPUT_MULTIMOVE_CHANGE_SELECTION;
      }
      return K.INPUT_MULTIMOVE_UNABLE;
    } else if (JOY_REPT(DPAD_RIGHT)) {
      if ((sCursorPosition + 1) % K.IN_BOX_COLUMNS !== 0) {
        SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition + 1);
        return K.INPUT_MULTIMOVE_CHANGE_SELECTION;
      }
      return K.INPUT_MULTIMOVE_UNABLE;
    }
    return K.INPUT_NONE;
  }
  if (MultiMove_GetOriginPosition() === sCursorPosition) {
    gStorage.inBoxMovingMode = MOVE_MODE_NORMAL;
    gStorage.cursorShadowSprite.invisible = false;
    return K.INPUT_MULTIMOVE_SINGLE;
  }
  sIsMonBeingMoved = gStorage.displayMonSpecies !== K.SPECIES_NONE;
  gStorage.inBoxMovingMode = MOVE_MODE_MULTIPLE_MOVING;
  sMovingMonOrigBoxId = state.storage.getCurrentBox();
  return K.INPUT_MULTIMOVE_GRAB_SELECTION;
}

function HandleInput_InBox_MovingMultiple(): number {
  if (JOY_REPT(DPAD_UP)) {
    if (MultiMove_TryMoveGroup(0)) {
      SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition - K.IN_BOX_COLUMNS);
      return K.INPUT_MULTIMOVE_MOVE_MONS;
    }
    return K.INPUT_MULTIMOVE_UNABLE;
  } else if (JOY_REPT(DPAD_DOWN)) {
    if (MultiMove_TryMoveGroup(1)) {
      SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition + K.IN_BOX_COLUMNS);
      return K.INPUT_MULTIMOVE_MOVE_MONS;
    }
    return K.INPUT_MULTIMOVE_UNABLE;
  } else if (JOY_REPT(DPAD_LEFT)) {
    if (MultiMove_TryMoveGroup(2)) {
      SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition - 1);
      return K.INPUT_MULTIMOVE_MOVE_MONS;
    }
    return K.INPUT_SCROLL_LEFT;
  } else if (JOY_REPT(DPAD_RIGHT)) {
    if (MultiMove_TryMoveGroup(3)) {
      SetCursorPosition(K.CURSOR_AREA_IN_BOX, sCursorPosition + 1);
      return K.INPUT_MULTIMOVE_MOVE_MONS;
    }
    return K.INPUT_SCROLL_RIGHT;
  } else if (JOY_NEW(A_BUTTON)) {
    if (MultiMove_CanPlaceSelection()) {
      sIsMonBeingMoved = false;
      gStorage.inBoxMovingMode = MOVE_MODE_NORMAL;
      return K.INPUT_MULTIMOVE_PLACE_MONS;
    }
    return K.INPUT_MULTIMOVE_UNABLE;
  } else if (JOY_NEW(B_BUTTON)) {
    return K.INPUT_MULTIMOVE_UNABLE;
  }
  if (state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_LR) {
    if (JOY_HELD(L_BUTTON)) return K.INPUT_SCROLL_LEFT;
    if (JOY_HELD(R_BUTTON)) return K.INPUT_SCROLL_RIGHT;
  }
  return K.INPUT_NONE;
}

function HandleInput_InParty(): number {
  let input = K.INPUT_NONE;
  let cursorArea = sCursorArea;
  let cursorPosition = sCursorPosition;
  let gotoBox = false;
  do {
    gStorage.cursorHorizontalWrap = 0;
    gStorage.cursorVerticalWrap = 0;
    gStorage.cursorFlipTimer = 0;

    if (JOY_REPT(DPAD_UP)) {
      if (--cursorPosition < 0) cursorPosition = K.PARTY_SIZE;
      if (cursorPosition !== sCursorPosition) input = K.INPUT_MOVE_CURSOR;
      break;
    } else if (JOY_REPT(DPAD_DOWN)) {
      if (++cursorPosition > K.PARTY_SIZE) cursorPosition = 0;
      if (cursorPosition !== sCursorPosition) input = K.INPUT_MOVE_CURSOR;
      break;
    } else if (JOY_REPT(DPAD_LEFT) && sCursorPosition !== 0) {
      input = K.INPUT_MOVE_CURSOR;
      gStorage.cursorPrevPartyPos = sCursorPosition;
      cursorPosition = 0;
      break;
    } else if (JOY_REPT(DPAD_RIGHT)) {
      if (sCursorPosition === 0) {
        input = K.INPUT_MOVE_CURSOR;
        cursorPosition = gStorage.cursorPrevPartyPos;
      } else {
        input = K.INPUT_HIDE_PARTY;
        cursorArea = K.CURSOR_AREA_IN_BOX;
        cursorPosition = 0;
      }
      break;
    }

    if (JOY_NEW(A_BUTTON)) {
      if (sCursorPosition === K.PARTY_SIZE) {
        if (gStorage.boxOption === K.OPTION_DEPOSIT) return K.INPUT_CLOSE_BOX;
        gotoBox = true;
      } else if (SetSelectionMenuTexts()) {
        if (!sInMultiMoveMode) return K.INPUT_IN_MENU;
        const quick = InputForFirstMenuItem();
        if (quick !== undefined) return quick;
      }
    }

    if (JOY_NEW(B_BUTTON)) {
      if (gStorage.boxOption === K.OPTION_DEPOSIT) return K.INPUT_PRESSED_B;
      gotoBox = true;
    }

    if (gotoBox) {
      input = K.INPUT_HIDE_PARTY;
      cursorArea = K.CURSOR_AREA_IN_BOX;
      cursorPosition = 0;
    } else if (JOY_NEW(SELECT_BUTTON)) {
      ToggleCursorMultiMoveMode();
      return K.INPUT_NONE;
    }
  } while (false);

  if (input !== K.INPUT_NONE && input !== K.INPUT_HIDE_PARTY) SetCursorPosition(cursorArea, cursorPosition);
  return input;
}

function HandleInput_BoxTitle(): number {
  let input: number;
  let cursorArea = 0;
  let cursorPosition = 0;
  do {
    gStorage.cursorHorizontalWrap = 0;
    gStorage.cursorVerticalWrap = 0;
    gStorage.cursorFlipTimer = 0;

    if (JOY_REPT(DPAD_UP)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorArea = K.CURSOR_AREA_BUTTONS;
      cursorPosition = 0;
      gStorage.cursorFlipTimer = 1;
      break;
    } else if (JOY_REPT(DPAD_DOWN)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorArea = K.CURSOR_AREA_IN_BOX;
      cursorPosition = 2;
      break;
    }

    if (JOY_HELD(DPAD_LEFT)) return K.INPUT_SCROLL_LEFT;
    if (JOY_HELD(DPAD_RIGHT)) return K.INPUT_SCROLL_RIGHT;

    if (state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_LR) {
      if (JOY_HELD(L_BUTTON)) return K.INPUT_SCROLL_LEFT;
      if (JOY_HELD(R_BUTTON)) return K.INPUT_SCROLL_RIGHT;
    }

    if (JOY_NEW(A_BUTTON)) {
      AnimateBoxScrollArrows(false);
      AddBoxMenu();
      return K.INPUT_BOX_OPTIONS;
    }

    if (JOY_NEW(B_BUTTON)) return K.INPUT_PRESSED_B;

    if (JOY_NEW(SELECT_BUTTON)) {
      ToggleCursorMultiMoveMode();
      return K.INPUT_NONE;
    }

    input = K.INPUT_NONE;
  } while (false);

  if (input !== K.INPUT_NONE) {
    if (cursorArea !== K.CURSOR_AREA_BOX_TITLE) AnimateBoxScrollArrows(false);
    SetCursorPosition(cursorArea, cursorPosition);
  }
  return input;
}

function HandleInput_OnButtons(): number {
  let input: number;
  let cursorArea = sCursorArea;
  let cursorPosition = sCursorPosition;
  do {
    gStorage.cursorHorizontalWrap = 0;
    gStorage.cursorVerticalWrap = 0;
    gStorage.cursorFlipTimer = 0;

    if (JOY_REPT(DPAD_UP)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorArea = K.CURSOR_AREA_IN_BOX;
      gStorage.cursorVerticalWrap = -1;
      cursorPosition = sCursorPosition === 0 ? K.IN_BOX_COUNT - 1 - 5 : K.IN_BOX_COUNT - 1;
      gStorage.cursorFlipTimer = 1;
      break;
    } else if (JOY_REPT(DPAD_DOWN | START_BUTTON)) {
      input = K.INPUT_MOVE_CURSOR;
      cursorArea = K.CURSOR_AREA_BOX_TITLE;
      cursorPosition = 0;
      gStorage.cursorFlipTimer = 1;
      break;
    }

    if (JOY_REPT(DPAD_LEFT)) {
      input = K.INPUT_MOVE_CURSOR;
      if (--cursorPosition < 0) cursorPosition = 1;
      break;
    } else if (JOY_REPT(DPAD_RIGHT)) {
      input = K.INPUT_MOVE_CURSOR;
      if (++cursorPosition > 1) cursorPosition = 0;
      break;
    }

    if (JOY_NEW(A_BUTTON)) return cursorPosition === 0 ? K.INPUT_SHOW_PARTY : K.INPUT_CLOSE_BOX;
    if (JOY_NEW(B_BUTTON)) return K.INPUT_PRESSED_B;
    if (JOY_NEW(SELECT_BUTTON)) {
      ToggleCursorMultiMoveMode();
      return K.INPUT_NONE;
    }
    input = K.INPUT_NONE;
  } while (false);

  if (input !== K.INPUT_NONE) SetCursorPosition(cursorArea, cursorPosition);
  return input;
}

/** HandleInput: the input handler for the cursor's area. */
export function HandleInput(): number {
  switch (sCursorArea) {
    case K.CURSOR_AREA_IN_BOX:
      return HandleInput_InBox();
    case K.CURSOR_AREA_IN_PARTY:
      return HandleInput_InParty();
    case K.CURSOR_AREA_BOX_TITLE:
      return HandleInput_BoxTitle();
    case K.CURSOR_AREA_BUTTONS:
      return HandleInput_OnButtons();
  }
  return K.INPUT_NONE;
}

function AddBoxMenu(): void {
  InitMenu();
  SetMenuText(K.MENU_TEXT_JUMP);
  SetMenuText(K.MENU_TEXT_WALLPAPER);
  SetMenuText(K.MENU_TEXT_NAME);
  SetMenuText(K.MENU_TEXT_CANCEL);
}

function SetSelectionMenuTexts(): boolean {
  InitMenu();
  if (gStorage.boxOption !== K.OPTION_MOVE_ITEMS) return SetMenuTextsForMon();
  return SetMenuTextsForItem();
}

function SetMenuTextsForMon(): boolean {
  const species = GetSpeciesAtCursorPosition();
  switch (gStorage.boxOption) {
    case K.OPTION_DEPOSIT:
      if (species !== K.SPECIES_NONE) SetMenuText(K.MENU_TEXT_STORE);
      else return false;
      break;
    case K.OPTION_WITHDRAW:
      if (species !== K.SPECIES_NONE) SetMenuText(K.MENU_TEXT_WITHDRAW);
      else return false;
      break;
    case K.OPTION_MOVE_MONS:
      if (sIsMonBeingMoved) {
        if (species !== K.SPECIES_NONE) SetMenuText(K.MENU_TEXT_SHIFT);
        else SetMenuText(K.MENU_TEXT_PLACE);
      } else {
        if (species !== K.SPECIES_NONE) SetMenuText(K.MENU_TEXT_MOVE);
        else return false;
      }
      break;
    case K.OPTION_MOVE_ITEMS:
    default:
      return false;
  }

  SetMenuText(K.MENU_TEXT_SUMMARY);
  if (gStorage.boxOption === K.OPTION_MOVE_MONS) {
    if (!sCursorArea) SetMenuText(K.MENU_TEXT_WITHDRAW);
    else SetMenuText(K.MENU_TEXT_STORE);
  }
  SetMenuText(K.MENU_TEXT_MARK);
  SetMenuText(K.MENU_TEXT_RELEASE);
  SetMenuText(K.MENU_TEXT_CANCEL);
  return true;
}

function SetMenuTextsForItem(): boolean {
  if (gStorage.displayMonSpecies === K.SPECIES_EGG) return false;

  if (!IsActiveItemMoving()) {
    if (gStorage.displayMonItemId === K.ITEM_NONE) {
      if (gStorage.displayMonSpecies === K.SPECIES_NONE) return false;
      SetMenuText(K.MENU_TEXT_GIVE2);
    } else {
      if (!ItemIsMailId(gStorage.displayMonItemId)) {
        SetMenuText(K.MENU_TEXT_TAKE);
        SetMenuText(K.MENU_TEXT_BAG);
      }
      SetMenuText(K.MENU_TEXT_INFO);
    }
  } else {
    if (gStorage.displayMonItemId === K.ITEM_NONE) {
      if (gStorage.displayMonSpecies === K.SPECIES_NONE) return false;
      SetMenuText(K.MENU_TEXT_GIVE);
    } else {
      if (ItemIsMailId(gStorage.displayMonItemId)) return false;
      SetMenuText(K.MENU_TEXT_SWITCH);
    }
  }
  SetMenuText(K.MENU_TEXT_CANCEL);
  return true;
}

function ItemIsMailId(itemId: number): boolean {
  return itemId >= K.ITEM_ORANGE_MAIL && itemId <= K.ITEM_RETRO_MAIL;
}

function SpriteCB_CursorShadow(sprite: Sprite): void {
  sprite.x = gStorage.cursorSprite.x;
  sprite.y = gStorage.cursorSprite.y + 20;
}

function CreateCursorSprites(): void {
  LoadSpriteSheet({ data: gfx('sHandCursorTiles'), size: 0x800, tag: K.GFXTAG_CURSOR });
  LoadSpriteSheet({ data: gfx('sHandCursorShadowTiles'), size: 0x80, tag: K.GFXTAG_CURSOR_SHADOW });
  LoadSpritePalette({ data: gfx16('sPokeStorageMisc1Pal'), tag: K.PALTAG_MISC_1 });
  gStorage.cursorPalNums[0] = IndexOfSpritePaletteTag(K.PALTAG_MISC_2);
  gStorage.cursorPalNums[1] = IndexOfSpritePaletteTag(K.PALTAG_MISC_1);

  const { x, y } = GetCursorCoordsByPos(sCursorArea, sCursorPosition);
  let spriteId = CreateSprite(
    {
      tileTag: K.GFXTAG_CURSOR,
      paletteTag: K.PALTAG_MISC_2,
      oam: oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 }),
      anims: animTable('pokemon_storage_system_data.c', 'sAnims_Cursor'),
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCallbackDummy,
    },
    x,
    y,
    6,
  );
  if (spriteId !== MAX_SPRITES) {
    gStorage.cursorSprite = gSprites[spriteId];
    gStorage.cursorSprite.oam.paletteNum = gStorage.cursorPalNums[sInMultiMoveMode ? 1 : 0];
    gStorage.cursorSprite.oam.priority = 1;
    if (sIsMonBeingMoved) StartSpriteAnim(gStorage.cursorSprite, 3);
  }

  let subpriority: number;
  let priority: number;
  if (sCursorArea === K.CURSOR_AREA_IN_PARTY) {
    subpriority = 13;
    priority = 1;
  } else {
    subpriority = 21;
    priority = 2;
  }

  spriteId = CreateSprite(
    {
      tileTag: K.GFXTAG_CURSOR_SHADOW,
      paletteTag: K.PALTAG_MISC_2,
      oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1 }),
      anims: gDummySpriteAnimTable,
      images: null,
      affineAnims: gDummySpriteAffineAnimTable,
      callback: SpriteCB_CursorShadow,
    },
    0,
    0,
    subpriority,
  );
  if (spriteId !== MAX_SPRITES) {
    gStorage.cursorShadowSprite = gSprites[spriteId];
    gStorage.cursorShadowSprite.oam.priority = priority;
    if (sCursorArea) gStorage.cursorShadowSprite.invisible = true;
  }
}

function ToggleCursorMultiMoveMode(): void {
  sInMultiMoveMode = !sInMultiMoveMode;
  gStorage.cursorSprite.oam.paletteNum = gStorage.cursorPalNums[sInMultiMoveMode ? 1 : 0];
}

export function GetBoxCursorPosition(): number {
  return sCursorPosition;
}

/** GetCursorBoxColumnAndRow */
export function GetCursorBoxColumnAndRow(): { column: number; row: number } {
  if (sCursorArea === K.CURSOR_AREA_IN_BOX) return { column: sCursorPosition % K.IN_BOX_COLUMNS, row: Math.trunc(sCursorPosition / K.IN_BOX_COLUMNS) };
  return { column: 0, row: 0 };
}

export function StartCursorAnim(animNum: number): void {
  StartSpriteAnim(gStorage.cursorSprite, animNum);
}

export function GetMovingMonOriginalBoxId(): number {
  return sMovingMonOrigBoxId;
}

export function SetCursorPriorityTo1(): void {
  gStorage.cursorSprite.oam.priority = 1;
}

export function TryHideItemAtCursor(): void {
  if (sCursorArea === K.CURSOR_AREA_IN_BOX) TryHideItemIconAtPos(K.CURSOR_AREA_IN_BOX, sCursorPosition);
}

export function TryShowItemAtCursor(): void {
  if (sCursorArea === K.CURSOR_AREA_IN_BOX) TryLoadItemIconAtPos(K.CURSOR_AREA_IN_BOX, sCursorPosition);
}

/** sMenuTexts, by MENU_TEXT_* */
const sMenuTexts = [
  'gPCText_Cancel',
  'gPCText_Store',
  'gPCText_Withdraw',
  'gPCText_Move',
  'gPCText_Shift',
  'gPCText_Place',
  'gPCText_Summary',
  'gPCText_Release',
  'gPCText_Mark',
  'gPCText_Jump',
  'gPCText_Wallpaper',
  'gPCText_Name',
  'gPCText_Take',
  'gPCText_Give',
  'gPCText_Give',
  'gPCText_Switch',
  'gPCText_Bag',
  'gPCText_Info',
  'gPCText_Scenery1',
  'gPCText_Scenery2',
  'gPCText_Scenery3',
  'gPCText_Etcetera',
  'gPCText_Forest',
  'gPCText_City',
  'gPCText_Desert',
  'gPCText_Savanna',
  'gPCText_Crag',
  'gPCText_Volcano',
  'gPCText_Snow',
  'gPCText_Cave',
  'gPCText_Beach',
  'gPCText_Seafloor',
  'gPCText_River',
  'gPCText_Sky',
  'gPCText_PolkaDot',
  'gPCText_Pokecenter',
  'gPCText_Machine',
  'gPCText_Simple',
];

export function InitMenu(): void {
  gStorage.menuItemsCount = 0;
  gStorage.menuWidth = 0;
  gStorage.menuWindow.bg = 0;
  gStorage.menuWindow.paletteNum = 15;
  gStorage.menuWindow.baseBlock = 92;
}

export function SetMenuText(textId: number): void {
  if (gStorage.menuItemsCount < 7) {
    const str = text(sMenuTexts[textId]);
    gStorage.menuItems[gStorage.menuItemsCount] = { text: str, textId };
    const len = strBody(str).length; // StringLength
    if (len > gStorage.menuWidth) gStorage.menuWidth = len;
    gStorage.menuItemsCount++;
  }
}

export function GetMenuItemTextId(menuIndex: number): number {
  if (menuIndex >= gStorage.menuItemsCount) return MENU_B_PRESSED;
  return gStorage.menuItems[menuIndex].textId;
}

export function AddMenu(): void {
  const w = gStorage.menuWindow;
  w.width = gStorage.menuWidth + 2;
  w.height = 2 * gStorage.menuItemsCount;
  w.tilemapLeft = 29 - w.width;
  w.tilemapTop = 15 - w.height;
  gStorage.menuWindowId = AddWindow(w);
  ClearWindowTilemap(gStorage.menuWindowId);
  DrawStdFrameWithCustomTileAndPalette(gStorage.menuWindowId, false, 11, 14);
  // PrintTextArray(menuWindowId, FONT_NORMAL_COPY_1, 8, 2, 16, menuItemsCount, menuItems)
  for (let i = 0; i < gStorage.menuItemsCount; i++) AddTextPrinterParameterized(gStorage.menuWindowId, K.FONT_NORMAL_COPY_1, gStorage.menuItems[i].text, 8, 16 * i + 2, TEXT_SKIP_DRAW);
  CopyWindowToVram(gStorage.menuWindowId, COPYWIN_GFX);
  Menu_InitCursor(gStorage.menuWindowId, K.FONT_NORMAL_COPY_1, 0, 2, 16, gStorage.menuItemsCount, 0);
  ScheduleBgCopyTilemapToVram(0);
}

export function IsMenuLoading(): boolean {
  // Possibly stubbed out debug code?
  return false;
}

/** HandleMenuInput: the chosen MENU_TEXT_*, MENU_B_PRESSED or MENU_NOTHING_CHOSEN. */
export function HandleMenuInput(): number {
  let input = MENU_NOTHING_CHOSEN;
  do {
    if (JOY_NEW(A_BUTTON)) {
      input = Menu_GetCursorPos();
      break;
    } else if (JOY_NEW(B_BUTTON)) {
      PlaySE(K.SE_SELECT);
      input = MENU_B_PRESSED;
    }
    if (JOY_NEW(DPAD_UP)) {
      PlaySE(K.SE_SELECT);
      Menu_MoveCursor(-1);
    } else if (JOY_NEW(DPAD_DOWN)) {
      PlaySE(K.SE_SELECT);
      Menu_MoveCursor(1);
    }
  } while (false);

  if (input !== MENU_NOTHING_CHOSEN) RemoveMenu();
  if (input >= 0) input = gStorage.menuItems[input].textId;
  return input;
}

export function RemoveMenu(): void {
  ClearStdWindowAndFrameToTransparent(gStorage.menuWindowId, true);
  RemoveWindow(gStorage.menuWindowId);
}

/** The cursor's area and position (test probe). */
export function StorageCursor(): { area: number; position: number; holding: boolean } {
  return { area: sCursorArea, position: sCursorPosition, holding: sIsMonBeingMoved };
}

void sMovingMonOrigBoxPos;
void InPartyMenu;
