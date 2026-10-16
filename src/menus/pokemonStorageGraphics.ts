// pokemon_storage_system_graphics.c: the box screen's mon icons (box, party and the carried mon, with their
// scroll, compact, shift and release animations), the wallpapers on BG2, the box title sprites and the box
// scroll arrows. Icons share a 40-slot tile area at the start of OBJ VRAM (gReservedSpriteTileCount 0x280),
// one slot per species (TryLoadMonIconTiles), so they show the icon's first frame only, as on the GBA.

import { K } from '../battle/constants';
import { animTable, affineAnimTable } from '../battle/gfx';
import { state } from '../battle/env';
import { gSineTable } from '../battle/trig';
import { CopyBgTilemapBufferToVram, CopyRectToBgTilemapBufferRect, FillBgTilemapBufferRect, LoadBgTiles, SetBgTilemapBuffer, ShowBg } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPLAY_WIDTH, OBJ_VRAM0, REG_OFFSET_BG2CNT, RGB, RGB_WHITE, SetGpuReg, vram } from '../gba/hw';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, UpdatePaletteFade } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  InitSpriteAffineAnim,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_OBJ_BLEND,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks } from '../gba/task';
import { GetStringWidth } from '../gba/window';
import { strBody } from './common';
import { menusData } from './data';
import { GetIconSpecies, GetMonIconTiles, LoadMonIconPalettes } from './pokemonIcon';
import { gPlayerParty, gStorage, SpeciesOrEgg, WALLPAPER_NAMES, type SpriteSlot } from './pokemonStorage';
import { IsCursorInBox, IsCursorOnBoxTitle } from './pokemonStorageCursor';
import { DrawTextWindowAndBufferTiles } from './pokemonStorageMenu';

/** MAX_MON_ICONS */
const MAX_MON_ICONS = 40;

const sOamData_MonIcon = oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 0 });

function sSpriteTemplate_MonIcon(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_MON_ICON,
    paletteTag: K.PALTAG_MON_ICON_0,
    oam: sOamData_MonIcon,
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

/** sBoxTitleColors: shadow color, text color (the same for every wallpaper) */
const sBoxTitleColors = (_wallpaperId: number): [number, number] => [RGB(7, 7, 7), RGB_WHITE];

/** RGB_WHITEALPHA */
const RGB_WHITEALPHA = RGB_WHITE | 0x8000;

const sOamData_BoxTitle = oam({ shape: SPRITE_SHAPE['32x16'][0], size: SPRITE_SHAPE['32x16'][1], priority: 2 });
const sOamData_BoxScrollArrow = oam({ shape: SPRITE_SHAPE['8x16'][0], size: SPRITE_SHAPE['8x16'][1], priority: 2 });

function sSpriteTemplate_BoxTitle(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_BOX_TITLE,
    paletteTag: K.PALTAG_BOX_TITLE,
    oam: sOamData_BoxTitle,
    anims: animTable('pokemon_storage_system_graphics.c', 'sAnims_BoxTitle'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
}

function sSpriteTemplate_BoxScrollArrow(): SpriteTemplate {
  return {
    tileTag: K.GFXTAG_BOX_SCROLL_ARROW,
    paletteTag: K.PALTAG_MISC_2,
    oam: sOamData_BoxScrollArrow,
    anims: animTable('pokemon_storage_system_graphics.c', 'sAnims_BoxScrollArrow'),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_BoxScrollArrow,
  };
}

/** InitMonIconFields */
export function InitMonIconFields(): void {
  LoadMonIconPalettes();
  gStorage.numIconsPerSpecies = Array(MAX_MON_ICONS).fill(0);
  gStorage.iconSpeciesList = Array(MAX_MON_ICONS).fill(K.SPECIES_NONE);
  gStorage.partySprites = Array(K.PARTY_SIZE).fill(null);
  gStorage.boxMonsSprites = Array(K.IN_BOX_COUNT).fill(null);
  gStorage.movingMonSprite = null;
}

function GetMonIconPriorityByCursorArea(): number {
  return IsCursorInBox() ? 2 : 1;
}

/** CreateMovingMonIcon */
export function CreateMovingMonIcon(): void {
  const personality = gStorage.movingMon.personality;
  const species = SpeciesOrEgg(gStorage.movingMon);
  const priority = GetMonIconPriorityByCursorArea();
  gStorage.movingMonSprite = CreateMonIconSprite(species, personality, 0, 0, priority, 7);
  gStorage.movingMonSprite!.callback = SpriteCB_HeldMon;
}

function BoxMonAt(boxId: number, pos: number) {
  return state.storage.getBoxedMon(boxId, pos);
}

function InitBoxMonSprites(boxId: number): void {
  let count = 0;
  let boxPosition = 0;
  for (let i = 0; i < K.IN_BOX_ROWS; i++) {
    for (let j = 0; j < K.IN_BOX_COLUMNS; j++) {
      const mon = BoxMonAt(boxId, boxPosition);
      const species = SpeciesOrEgg(mon);
      if (species !== K.SPECIES_NONE) gStorage.boxMonsSprites[count] = CreateMonIconSprite(species, mon!.personality, 8 * (3 * j) + 100, 8 * (3 * i) + 44, 2, 19 - j);
      else gStorage.boxMonsSprites[count] = null;
      boxPosition++;
      count++;
    }
  }

  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    for (boxPosition = 0; boxPosition < K.IN_BOX_COUNT; boxPosition++) {
      // (the C sets this on a NULL sprite for an empty slot too)
      if (!BoxMonAt(boxId, boxPosition)?.heldItem && gStorage.boxMonsSprites[boxPosition]) gStorage.boxMonsSprites[boxPosition]!.oam.objMode = ST_OAM_OBJ_BLEND;
    }
  }
}

/** CreateBoxMonIconAtPos */
export function CreateBoxMonIconAtPos(boxPosition: number): void {
  const mon = BoxMonAt(state.storage.getCurrentBox(), boxPosition);
  const species = SpeciesOrEgg(mon);
  if (species !== K.SPECIES_NONE) {
    const x = 8 * (3 * (boxPosition % K.IN_BOX_COLUMNS)) + 100;
    const y = 8 * (3 * Math.trunc(boxPosition / K.IN_BOX_COLUMNS)) + 44;
    gStorage.boxMonsSprites[boxPosition] = CreateMonIconSprite(species, mon!.personality, x, y, 2, 19 - (boxPosition % K.IN_BOX_COLUMNS));
    if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) gStorage.boxMonsSprites[boxPosition]!.oam.objMode = ST_OAM_OBJ_BLEND;
  }
}

// Sprite data for the box mon icon scroll
const sDistance = 1;
const sSpeed = 2;
const sDestX = 3;
const sDelay = 4;
const sPosX = 5;

function StartBoxMonIconsScrollOut(speed: number): void {
  for (let i = 0; i < K.IN_BOX_COUNT; i++) {
    const s = gStorage.boxMonsSprites[i];
    if (s) {
      s.data[sSpeed] = speed;
      s.data[sDelay] = 1;
      s.callback = SpriteCB_BoxMonIconScrollOut;
    }
  }
}

function SpriteCB_BoxMonIconScrollIn(sprite: Sprite): void {
  if (sprite.data[sDistance] !== 0) {
    sprite.data[sDistance]--;
    sprite.x += sprite.data[sSpeed];
  } else {
    gStorage.iconScrollNumIncoming--;
    sprite.x = sprite.data[sDestX];
    sprite.callback = SpriteCallbackDummy;
  }
}

function SpriteCB_BoxMonIconScrollOut(sprite: Sprite): void {
  if (sprite.data[sDelay] !== 0) {
    sprite.data[sDelay]--;
  } else {
    sprite.x += sprite.data[sSpeed];
    sprite.data[sPosX] = sprite.x + sprite.x2;
    // Check if mon icon has scrolled out of view of the box area
    if (sprite.data[sPosX] <= 68 || sprite.data[sPosX] >= 252) sprite.callback = SpriteCallbackDummy;
  }
}

function DestroyAllIconsInColumn(column: number): void {
  let boxPosition = column;
  for (let row = 0; row < K.IN_BOX_ROWS; row++) {
    const s = gStorage.boxMonsSprites[boxPosition];
    if (s) {
      DestroyBoxMonIcon(s);
      gStorage.boxMonsSprites[boxPosition] = null;
    }
    boxPosition += K.IN_BOX_COLUMNS;
  }
}

function CreateBoxMonIconsInColumn(column: number, distance: number, speed: number): number {
  let y = 44;
  const xDest = 8 * (3 * column) + 100;
  const x = (xDest - (distance + 1) * speed) & 0xffff;
  const subpriority = 19 - column;
  let count = 0;
  let boxPosition = column;
  for (let i = 0; i < K.IN_BOX_ROWS; i++) {
    if (gStorage.boxSpecies[boxPosition] !== K.SPECIES_NONE) {
      const s = CreateMonIconSprite(gStorage.boxSpecies[boxPosition], gStorage.boxPersonalities[boxPosition], (x << 16) >> 16, y, 2, subpriority);
      gStorage.boxMonsSprites[boxPosition] = s;
      if (s) {
        s.data[sDistance] = distance;
        s.data[sSpeed] = speed;
        s.data[sDestX] = xDest;
        s.callback = SpriteCB_BoxMonIconScrollIn;
        if (gStorage.boxOption === K.OPTION_MOVE_ITEMS && !BoxMonAt(gStorage.incomingBoxId, boxPosition)?.heldItem) s.oam.objMode = ST_OAM_OBJ_BLEND;
        count++;
      }
    }
    boxPosition += K.IN_BOX_COLUMNS;
    y += 24;
  }
  return count;
}

function InitBoxMonIconScroll(boxId: number, direction: number): void {
  gStorage.iconScrollState = 0;
  gStorage.iconScrollDirection = direction;
  gStorage.iconScrollDistance = 32;
  gStorage.iconScrollSpeed = -(6 * direction);
  gStorage.iconScrollNumIncoming = 0;
  SetBoxSpeciesAndPersonalities(boxId);
  gStorage.iconScrollCurColumn = direction > 0 ? 0 : K.IN_BOX_COLUMNS - 1;
  gStorage.iconScrollPos = 24 * gStorage.iconScrollCurColumn + 100;
  StartBoxMonIconsScrollOut(gStorage.iconScrollSpeed);
}

function UpdateBoxMonIconScroll(): boolean {
  if (gStorage.iconScrollDistance !== 0) gStorage.iconScrollDistance--;

  switch (gStorage.iconScrollState) {
    case 0:
      gStorage.iconScrollPos += gStorage.iconScrollSpeed;
      if (gStorage.iconScrollPos <= 64 || gStorage.iconScrollPos >= 252) {
        // A column of icons has gone offscreen, destroy them
        DestroyAllIconsInColumn(gStorage.iconScrollCurColumn);
        gStorage.iconScrollPos += gStorage.iconScrollDirection * 24;
        gStorage.iconScrollState++;
      }
      break;
    case 1:
      // Create the new incoming column of icons
      gStorage.iconScrollPos += gStorage.iconScrollSpeed;
      gStorage.iconScrollNumIncoming += CreateBoxMonIconsInColumn(gStorage.iconScrollCurColumn, gStorage.iconScrollDistance, gStorage.iconScrollSpeed);
      if ((gStorage.iconScrollDirection > 0 && gStorage.iconScrollCurColumn === K.IN_BOX_COLUMNS - 1) || (gStorage.iconScrollDirection < 0 && gStorage.iconScrollCurColumn === 0)) {
        // Scroll has reached final column
        gStorage.iconScrollState++;
      } else {
        // Continue scrolling
        gStorage.iconScrollCurColumn += gStorage.iconScrollDirection;
        gStorage.iconScrollState = 0;
      }
      break;
    case 2:
      // Wait to make sure all icons have arrived
      if (gStorage.iconScrollNumIncoming === 0) {
        gStorage.iconScrollDistance++;
        return false;
      }
      break;
    default:
      return false;
  }
  return true;
}

function SetBoxSpeciesAndPersonalities(boxId: number): void {
  for (let boxPosition = 0; boxPosition < K.IN_BOX_COUNT; boxPosition++) {
    const mon = BoxMonAt(boxId, boxPosition);
    gStorage.boxSpecies[boxPosition] = SpeciesOrEgg(mon);
    if (gStorage.boxSpecies[boxPosition] !== K.SPECIES_NONE) gStorage.boxPersonalities[boxPosition] = mon!.personality;
  }
  gStorage.incomingBoxId = boxId;
}

export function DestroyBoxMonIconAtPosition(boxPosition: number): void {
  const s = gStorage.boxMonsSprites[boxPosition];
  if (s) {
    DestroyBoxMonIcon(s);
    gStorage.boxMonsSprites[boxPosition] = null;
  }
}

export function SetBoxMonIconObjMode(boxPosition: number, objMode: number): void {
  const s = gStorage.boxMonsSprites[boxPosition];
  if (s) s.oam.objMode = objMode;
}

/** CreatePartyMonsSprites */
export function CreatePartyMonsSprites(visible: boolean): void {
  let species = SpeciesOrEgg(gPlayerParty[0]);
  let personality = gPlayerParty[0]?.personality ?? 0;
  gStorage.partySprites[0] = CreateMonIconSprite(species, personality, 104, 64, 1, 12);
  let count = 1;
  for (let i = 1; i < K.PARTY_SIZE; i++) {
    species = SpeciesOrEgg(gPlayerParty[i]);
    if (species !== K.SPECIES_NONE) {
      personality = gPlayerParty[i]!.personality;
      gStorage.partySprites[i] = CreateMonIconSprite(species, personality, 152, 8 * (3 * (i - 1)) + 16, 1, 12);
      count++;
    } else {
      gStorage.partySprites[i] = null;
    }
  }

  if (!visible) {
    for (let i = 0; i < count; i++) {
      const s = gStorage.partySprites[i];
      if (!s) continue;
      s.y -= 160;
      s.invisible = true;
    }
  }

  if (gStorage.boxOption === K.OPTION_MOVE_ITEMS) {
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      const s = gStorage.partySprites[i];
      if (s && !gPlayerParty[i]?.heldItem) s.oam.objMode = ST_OAM_OBJ_BLEND;
    }
  }
}

/** CompactPartySprites */
export function CompactPartySprites(): void {
  gStorage.numPartySpritesToCompact = 0;
  for (let i = 0, targetPartyId = 0; i < K.PARTY_SIZE; i++) {
    const s = gStorage.partySprites[i];
    if (s) {
      if (i !== targetPartyId) {
        MovePartySpriteToNextSlot(s, targetPartyId);
        gStorage.partySprites[i] = null;
        gStorage.numPartySpritesToCompact++;
      }
      targetPartyId++;
    }
  }
}

export function GetNumPartySpritesCompacting(): number {
  return gStorage.numPartySpritesToCompact;
}

const sPartyId = 1;
const sMonX = 2;
const sMonY = 3;
const sSpeedX = 4;
const sSpeedY = 5;
const sMoveSteps = 6;

function MovePartySpriteToNextSlot(sprite: Sprite, partyId: number): void {
  let x: number;
  let y: number;
  sprite.data[sPartyId] = partyId;
  if (partyId === 0) {
    x = 104;
    y = 64;
  } else {
    x = 152;
    y = 8 * (3 * (partyId - 1)) + 16;
  }
  sprite.data[sMonX] = (sprite.x & 0xffff) * 8;
  sprite.data[sMonY] = (sprite.y & 0xffff) * 8;
  sprite.data[sSpeedX] = Math.trunc((x * 8 - sprite.data[sMonX]) / 8);
  sprite.data[sSpeedY] = Math.trunc((y * 8 - sprite.data[sMonY]) / 8);
  sprite.data[sMoveSteps] = 8;
  sprite.callback = SpriteCB_MovePartySpriteToNextSlot;
}

function SpriteCB_MovePartySpriteToNextSlot(sprite: Sprite): void {
  if (sprite.data[sMoveSteps] !== 0) {
    sprite.data[sMonX] += sprite.data[sSpeedX];
    sprite.data[sMonY] += sprite.data[sSpeedY];
    // (s16 / 8u: an unsigned division of the value as a u32)
    sprite.x = Math.trunc((sprite.data[sMonX] >>> 0) / 8) << 16 >> 16;
    sprite.y = Math.trunc((sprite.data[sMonY] >>> 0) / 8) << 16 >> 16;
    sprite.data[sMoveSteps]--;
  } else {
    if (sprite.data[sPartyId] === 0) {
      sprite.x = 104;
      sprite.y = 64;
    } else {
      sprite.x = 152;
      sprite.y = 8 * (3 * (sprite.data[sPartyId] - 1)) + 16;
    }
    sprite.callback = SpriteCallbackDummy;
    gStorage.partySprites[sprite.data[sPartyId]] = sprite;
    gStorage.numPartySpritesToCompact--;
  }
}

export function DestroyMovingMonIcon(): void {
  if (gStorage.movingMonSprite) {
    DestroyBoxMonIcon(gStorage.movingMonSprite);
    gStorage.movingMonSprite = null;
  }
}

/** MovePartySprites */
export function MovePartySprites(yDelta: number): void {
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const s = gStorage.partySprites[i];
    if (s) {
      s.y += yDelta;
      let posY = (s.y + s.y2 + s.centerToCornerVecY) & 0xffff;
      posY = (posY + 16) & 0xffff;
      s.invisible = posY > 192;
    }
  }
}

export function DestroyPartyMonIcon(partyId: number): void {
  const s = gStorage.partySprites[partyId];
  if (s) {
    DestroyBoxMonIcon(s);
    gStorage.partySprites[partyId] = null;
  }
}

export function DestroyAllPartyMonIcons(): void {
  for (let i = 0; i < K.PARTY_SIZE; i++) DestroyPartyMonIcon(i);
}

export function SetPartyMonIconObjMode(partyId: number, objMode: number): void {
  const s = gStorage.partySprites[partyId];
  if (s) s.oam.objMode = objMode;
}

/** SetMovingMonSprite */
export function SetMovingMonSprite(mode: number, id: number): void {
  if (mode === K.MODE_PARTY) {
    gStorage.movingMonSprite = gStorage.partySprites[id];
    gStorage.partySprites[id] = null;
  } else if (mode === K.MODE_BOX) {
    gStorage.movingMonSprite = gStorage.boxMonsSprites[id];
    gStorage.boxMonsSprites[id] = null;
  } else {
    return;
  }
  const s = gStorage.movingMonSprite!;
  s.callback = SpriteCB_HeldMon;
  s.oam.priority = GetMonIconPriorityByCursorArea();
  s.subpriority = 7;
}

/** SetPlacedMonSprite */
export function SetPlacedMonSprite(boxId: number, position: number): void {
  const s = gStorage.movingMonSprite!;
  if (boxId === K.TOTAL_BOXES_COUNT) {
    // party mon
    gStorage.partySprites[position] = s;
    s.oam.priority = 1;
    s.subpriority = 12;
  } else {
    gStorage.boxMonsSprites[position] = s;
    s.oam.priority = 2;
    s.subpriority = 19 - (position % K.IN_BOX_COLUMNS);
  }
  s.callback = SpriteCallbackDummy;
  gStorage.movingMonSprite = null;
}

function slot(list: (Sprite | null)[], index: number): SpriteSlot {
  return { get: () => list[index], set: (sprite) => (list[index] = sprite) };
}

const movingMonSlot: SpriteSlot = { get: () => gStorage.movingMonSprite, set: (sprite) => (gStorage.movingMonSprite = sprite) };

/** SetShiftMonSpritePtr */
export function SetShiftMonSpritePtr(boxId: number, position: number): void {
  if (boxId === K.TOTAL_BOXES_COUNT) gStorage.shiftMonSpritePtr = slot(gStorage.partySprites, position);
  else gStorage.shiftMonSpritePtr = slot(gStorage.boxMonsSprites, position);
  gStorage.movingMonSprite!.callback = SpriteCallbackDummy;
  gStorage.shiftTimer = 0;
}

/** ShiftMons */
export function ShiftMons(): boolean {
  if (gStorage.shiftTimer === 16) return false;
  const ptr = gStorage.shiftMonSpritePtr!;
  const shift = ptr.get()!;
  const moving = gStorage.movingMonSprite!;

  gStorage.shiftTimer++;
  if (gStorage.shiftTimer & 1) {
    shift.y--;
    moving.y++;
  }

  shift.x2 = Math.trunc(gSineTable(gStorage.shiftTimer * 8) / 16);
  moving.x2 = -Math.trunc(gSineTable(gStorage.shiftTimer * 8) / 16);
  if (gStorage.shiftTimer === 8) {
    moving.oam.priority = shift.oam.priority;
    moving.subpriority = shift.subpriority;
    shift.oam.priority = GetMonIconPriorityByCursorArea();
    shift.subpriority = 7;
  }

  if (gStorage.shiftTimer === 16) {
    gStorage.movingMonSprite = shift;
    ptr.set(moving);
    gStorage.movingMonSprite.callback = SpriteCB_HeldMon;
    moving.callback = SpriteCallbackDummy;
  }
  return true;
}

/** DoReleaseMonAnim */
export function DoReleaseMonAnim(mode: number, position: number): void {
  switch (mode) {
    case K.MODE_PARTY:
      gStorage.releaseMonSpritePtr = slot(gStorage.partySprites, position);
      break;
    case K.MODE_BOX:
      gStorage.releaseMonSpritePtr = slot(gStorage.boxMonsSprites, position);
      break;
    case K.MODE_MOVE:
      gStorage.releaseMonSpritePtr = movingMonSlot;
      break;
    default:
      return;
  }
  const s = gStorage.releaseMonSpritePtr.get();
  if (s) {
    InitSpriteAffineAnim(s);
    s.oam.affineMode = ST_OAM_AFFINE_NORMAL;
    s.affineAnims = affineAnimTable('pokemon_storage_system_graphics.c', 'sAffineAnims_ReleaseMon');
    StartSpriteAffineAnim(s, K.RELEASE_ANIM_RELEASE);
  }
}

export function TryHideReleaseMonSprite(): boolean {
  const s = gStorage.releaseMonSpritePtr!.get();
  if (s === null || s.invisible) return false;
  if (s.affineAnimEnded) s.invisible = true;
  return true;
}

export function DestroyReleaseMonIcon(): void {
  const ptr = gStorage.releaseMonSpritePtr!;
  const s = ptr.get();
  if (s) {
    FreeOamMatrix(s.oam.matrixNum);
    DestroyBoxMonIcon(s);
    ptr.set(null);
  }
}

export function DoReleaseMonComeBackAnim(): void {
  const s = gStorage.releaseMonSpritePtr!.get();
  if (s) {
    s.invisible = false;
    StartSpriteAffineAnim(s, K.RELEASE_ANIM_COME_BACK);
  }
}

export function ResetReleaseMonSpritePtr(): boolean {
  if (gStorage.releaseMonSpritePtr === null) return false;
  if (gStorage.releaseMonSpritePtr.get()!.affineAnimEnded) gStorage.releaseMonSpritePtr = null;
  return true;
}

/** SetMovingMonPriority (the C dereferences movingMonSprite even when nothing is carried) */
export function SetMovingMonPriority(priority: number): void {
  if (gStorage.movingMonSprite) gStorage.movingMonSprite.oam.priority = priority;
}

function SpriteCB_HeldMon(sprite: Sprite): void {
  sprite.x = gStorage.cursorSprite.x;
  sprite.y = gStorage.cursorSprite.y + gStorage.cursorSprite.y2 + 4;
}

function TryLoadMonIconTiles(species: number): number {
  // Find the currently-allocated slot
  let i = gStorage.iconSpeciesList.indexOf(species);
  if (i === -1) {
    // Find the first empty slot
    i = gStorage.iconSpeciesList.indexOf(K.SPECIES_NONE);
    if (i === -1) return 0xffff;
  }
  gStorage.iconSpeciesList[i] = species;
  gStorage.numIconsPerSpecies[i]++;
  const offset = 16 * i;
  vram.set(GetMonIconTiles(species, true).subarray(0, 0x200), OBJ_VRAM0 + offset * 32);
  return offset;
}

function RemoveSpeciesFromIconList(species: number): void {
  const i = gStorage.iconSpeciesList.indexOf(species);
  if (i !== -1 && --gStorage.numIconsPerSpecies[i] === 0) gStorage.iconSpeciesList[i] = K.SPECIES_NONE;
}

/** CreateMonIconSprite (the storage system's own, not pokemon_icon.c's) */
export function CreateMonIconSprite(species: number, personality: number, x: number, y: number, oamPriority: number, subpriority: number): Sprite | null {
  const template = sSpriteTemplate_MonIcon();
  species = GetIconSpecies(species, personality);
  template.paletteTag = K.PALTAG_MON_ICON_0 + (menusData.monIconPaletteIndices[species] ?? 0);
  const tileNum = TryLoadMonIconTiles(species);
  if (tileNum === 0xffff) return null;

  const spriteId = CreateSprite(template, x, y, subpriority);
  if (spriteId === MAX_SPRITES) {
    RemoveSpeciesFromIconList(species);
    return null;
  }
  const s = gSprites[spriteId];
  s.oam.tileNum = tileNum;
  s.oam.priority = oamPriority;
  s.data[0] = species;
  return s;
}

function DestroyBoxMonIcon(sprite: Sprite): void {
  RemoveSpeciesFromIconList(sprite.data[0]);
  DestroySprite(sprite);
}

const tState = 0;
const tBoxId = 2;

export function CreateInitBoxTask(boxId: number): void {
  const taskId = CreateTask(Task_InitBox, 2);
  gTasks[taskId].data[tBoxId] = boxId;
}

export function IsInitBoxActive(): boolean {
  return FuncIsActiveTask(Task_InitBox);
}

function Task_InitBox(taskId: number): void {
  const task = gTasks[taskId];
  switch (task.data[tState]) {
    case 0:
      gStorage.wallpaperOffset = 0;
      gStorage.bg2_X = 0;
      gStorage.wallpaperBgTilemapBuffer.fill(0); // RequestDma3Fill
      break;
    case 1:
      SetBgTilemapBuffer(2, gStorage.wallpaperBgTilemapBuffer);
      ShowBg(2);
      break;
    case 2:
      LoadWallpaperGfx(task.data[tBoxId], 0);
      break;
    case 3:
      InitBoxTitle(task.data[tBoxId]);
      CreateBoxScrollArrows();
      InitBoxMonSprites(task.data[tBoxId]);
      SetGpuReg(REG_OFFSET_BG2CNT, 2 | (2 << 2) | (27 << 8) | 0x4000); // BGCNT_PRIORITY(2) | BGCNT_CHARBASE(2) | BGCNT_SCREENBASE(27) | BGCNT_TXT512x256
      break;
    case 4:
      DestroyTask(taskId);
      return;
    default:
      task.data[tState] = 0;
      return;
  }
  task.data[tState]++;
}

/** SetUpScrollToBox */
export function SetUpScrollToBox(boxId: number): void {
  const direction = DetermineBoxScrollDirection(boxId);
  gStorage.scrollSpeed = direction > 0 ? 6 : -6;
  gStorage.scrollTimer = 32;
  gStorage.scrollToBoxId = boxId;
  gStorage.scrollDirection = direction;
  gStorage.scrollState = 0;
}

/** ScrollToBox: TRUE while the scroll runs. */
export function ScrollToBox(): boolean {
  switch (gStorage.scrollState) {
    case 0:
      LoadWallpaperGfx(gStorage.scrollToBoxId, gStorage.scrollDirection);
      gStorage.scrollState++;
    // fallthrough
    case 1:
      // WaitForWallpaperGfxLoad: DMA is instant
      InitBoxMonIconScroll(gStorage.scrollToBoxId, gStorage.scrollDirection);
      CreateIncomingBoxTitle(gStorage.scrollToBoxId, gStorage.scrollDirection);
      StartBoxScrollArrowsSlide(gStorage.scrollDirection);
      break;
    case 2: {
      const isStillScrolling = UpdateBoxMonIconScroll();
      if (gStorage.scrollTimer !== 0) {
        gStorage.bg2_X = (gStorage.bg2_X + gStorage.scrollSpeed) & 0xffff;
        if (--gStorage.scrollTimer !== 0) return true;
        CycleBoxTitleSprites();
        StopBoxScrollArrowsSlide();
      }
      return isStillScrolling;
    }
  }
  gStorage.scrollState++;
  return true;
}

function DetermineBoxScrollDirection(boxId: number): number {
  let currentBox = state.storage.getCurrentBox();
  let i = 0;
  for (; currentBox !== boxId; i++) {
    currentBox++;
    if (currentBox >= K.TOTAL_BOXES_COUNT) currentBox = 0;
  }
  return i < K.TOTAL_BOXES_COUNT / 2 ? 1 : -1;
}

export function SetWallpaperForCurrentBox(wallpaperId: number): void {
  state.storage.setBoxWallpaper(state.storage.getCurrentBox(), wallpaperId);
  gStorage.wallpaperChangeState = 0;
}

/** DoWallpaperGfxChange: TRUE while the wallpaper fades out, changes and fades back in. */
export function DoWallpaperGfxChange(): boolean {
  switch (gStorage.wallpaperChangeState) {
    case 0:
      BeginNormalPaletteFade(gStorage.wallpaperPalBits, 1, 0, 16, RGB_WHITEALPHA);
      gStorage.wallpaperChangeState++;
      break;
    case 1:
      if (!UpdatePaletteFade()) {
        LoadWallpaperGfx(state.storage.getCurrentBox(), 0);
        gStorage.wallpaperChangeState++;
      }
      break;
    case 2:
      // WaitForWallpaperGfxLoad
      CycleBoxTitleColor();
      BeginNormalPaletteFade(gStorage.wallpaperPalBits, 1, 16, 0, RGB_WHITEALPHA);
      gStorage.wallpaperChangeState++;
      break;
    case 3:
      if (!UpdatePaletteFade()) gStorage.wallpaperChangeState++;
      break;
    case 4:
      return false;
  }
  return true;
}

function LoadWallpaperGfx(boxId: number, direction: number): void {
  gStorage.wallpaperLoadBoxId = boxId;
  gStorage.wallpaperLoadDir = direction;
  if (gStorage.wallpaperLoadDir !== 0) {
    gStorage.wallpaperOffset = gStorage.wallpaperOffset ? 0 : 1;
    TrimOldWallpaper(gStorage.wallpaperBgTilemapBuffer);
  }

  const wallpaperId = state.storage.getBoxWallpaper(gStorage.wallpaperLoadBoxId);
  const name = WALLPAPER_NAMES[wallpaperId];
  gStorage.wallpaperTilemap.set(gfx16(`sWallpaperTilemap_${name}`).subarray(0, 360));
  DrawWallpaper(gStorage.wallpaperTilemap, gStorage.wallpaperLoadDir, gStorage.wallpaperOffset);

  const palettes = gfx16(`sWallpaperPalettes_${name}`);
  const palOffset = BG_PLTT_ID(4) + BG_PLTT_ID(gStorage.wallpaperOffset * 2);
  if (gStorage.wallpaperLoadDir !== 0) LoadPalette(palettes, palOffset, 2 * PLTT_SIZE_4BPP);
  else gPlttBufferUnfaded.set(palettes.subarray(0, 32), palOffset); // CpuCopy16 into the unfaded buffer only

  const tiles = gfx(`sWallpaperTiles_${name}`); // DecompressAndLoadBgGfxUsingHeap
  LoadBgTiles(2, tiles, tiles.length, 256 * gStorage.wallpaperOffset);
  CopyBgTilemapBufferToVram(2);
}

function DrawWallpaper(tilemap: Uint16Array, direction: number, offset: number): void {
  const paletteNum = offset * 2 + 3;
  let x = ((gStorage.bg2_X >> 3) + 10 + direction * 24) & 0x3f;

  CopyRectToBgTilemapBufferRect(2, tilemap, 0, 0, 20, 18, x, 2, 20, 18, 17, offset << 8, paletteNum);

  if (direction === 0) return;
  else if (direction > 0) x += 20;
  else x -= 4;

  FillBgTilemapBufferRect(2, 0, x, 2, 4, 18, 17);
}

function TrimOldWallpaper(tilemapBuffer: Uint16Array): void {
  let right = ((gStorage.bg2_X >> 3) + 10 + 20) & 0x3f;
  let dest = right < 32 ? right + 0x260 : right + 0x640;
  for (let i = 0; i < 44; i++) {
    tilemapBuffer[dest++] = 0;
    right = (right + 1) & 0x3f;
    if (right === 0) dest -= 0x420;
    if (right === 32) dest += 0x3e0;
  }
}

function InitBoxTitle(boxId: number): void {
  const wallpaperId = state.storage.getBoxWallpaper(boxId);
  const [shadow, color] = sBoxTitleColors(wallpaperId);
  gStorage.boxTitlePal[14] = shadow;
  gStorage.boxTitlePal[15] = color;
  LoadSpritePalette({ data: gStorage.boxTitlePal, tag: K.PALTAG_BOX_TITLE });
  gStorage.wallpaperPalBits = 0x3f0;

  let tagIndex = IndexOfSpritePaletteTag(K.PALTAG_BOX_TITLE);
  gStorage.boxTitlePalOffset = OBJ_PLTT_ID(tagIndex) + 14;
  gStorage.wallpaperPalBits = (gStorage.wallpaperPalBits | ((1 << 16) << tagIndex)) >>> 0;

  tagIndex = IndexOfSpritePaletteTag(K.PALTAG_BOX_TITLE);
  gStorage.boxTitleAltPalOffset = OBJ_PLTT_ID(tagIndex) + 14;
  gStorage.wallpaperPalBits = (gStorage.wallpaperPalBits | ((1 << 16) << tagIndex)) >>> 0;

  gStorage.boxTitleText = StringCopyPadded0(state.storage.getBoxName(boxId) ?? [], 8);
  DrawTextWindowAndBufferTiles(gStorage.boxTitleText, gStorage.boxTitleTiles, 0, 0, 2);
  LoadSpriteSheet({ data: gStorage.boxTitleTiles, size: 0x200, tag: K.GFXTAG_BOX_TITLE });
  const x = GetBoxTitleBaseX(state.storage.getBoxName(boxId) ?? []);

  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_BoxTitle(), x + i * 32, 28, 24);
    gStorage.curBoxTitleSprites[i] = gSprites[spriteId];
    StartSpriteAnim(gSprites[spriteId], i);
  }
  gStorage.boxTitleCycleId = 0;
}

/** StringCopyPadded(dest, src, 0, n): CHAR_SPACE (0) padding. */
function StringCopyPadded0(src: number[], n: number): number[] {
  const out = strBody(src);
  while (out.length < n) out.push(0);
  return [...out, 0xff];
}

function CreateIncomingBoxTitle(boxId: number, direction: number): void {
  const template = sSpriteTemplate_BoxTitle();
  let tag: number;
  gStorage.boxTitleCycleId = gStorage.boxTitleCycleId ? 0 : 1;
  const palOffset = gStorage.boxTitlePalOffset;
  if (gStorage.boxTitleCycleId === 0) {
    tag = K.GFXTAG_BOX_TITLE;
  } else {
    tag = K.GFXTAG_BOX_TITLE_ALT;
    template.tileTag = K.GFXTAG_BOX_TITLE_ALT;
    template.paletteTag = K.PALTAG_BOX_TITLE;
  }

  gStorage.boxTitleText = StringCopyPadded0(state.storage.getBoxName(boxId) ?? [], K.BOX_NAME_LENGTH);
  DrawTextWindowAndBufferTiles(gStorage.boxTitleText, gStorage.boxTitleTiles, 0, 0, 2);
  LoadSpriteSheet({ data: gStorage.boxTitleTiles, size: 0x200, tag });
  LoadPalette(sBoxTitleColors(state.storage.getBoxWallpaper(boxId)), palOffset, 4);
  const x = GetBoxTitleBaseX(state.storage.getBoxName(boxId) ?? []);
  const adjustedX = x + direction * 192;

  // Title is split across two sprites
  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(template, i * 32 + adjustedX, 28, 24);
    const next = gSprites[spriteId];
    gStorage.nextBoxTitleSprites[i] = next;
    next.data[0] = -direction * 6;
    next.data[1] = i * 32 + x;
    next.data[2] = 0;
    next.callback = SpriteCB_IncomingBoxTitle;
    StartSpriteAnim(next, i);

    const cur = gStorage.curBoxTitleSprites[i]!;
    cur.data[0] = -direction * 6;
    cur.data[1] = 1;
    cur.callback = SpriteCB_OutgoingBoxTitle;
  }
}

function CycleBoxTitleSprites(): void {
  if (gStorage.boxTitleCycleId === 0) FreeSpriteTilesByTag(K.GFXTAG_BOX_TITLE_ALT);
  else FreeSpriteTilesByTag(K.GFXTAG_BOX_TITLE);
  gStorage.curBoxTitleSprites[0] = gStorage.nextBoxTitleSprites[0];
  gStorage.curBoxTitleSprites[1] = gStorage.nextBoxTitleSprites[1];
}

function SpriteCB_IncomingBoxTitle(sprite: Sprite): void {
  if (sprite.data[2] !== 0) sprite.data[2]--;
  else if ((sprite.x += sprite.data[0]) === sprite.data[1]) sprite.callback = SpriteCallbackDummy;
}

function SpriteCB_OutgoingBoxTitle(sprite: Sprite): void {
  if (sprite.data[1] !== 0) {
    sprite.data[1]--;
  } else {
    sprite.x += sprite.data[0];
    sprite.data[2] = sprite.x + sprite.x2;
    if (sprite.data[2] < 0x40 || sprite.data[2] > 0x100) DestroySprite(sprite);
  }
}

function CycleBoxTitleColor(): void {
  const wallpaperId = state.storage.getBoxWallpaper(state.storage.getCurrentBox());
  const offset = gStorage.boxTitleCycleId === 0 ? gStorage.boxTitlePalOffset : gStorage.boxTitleAltPalOffset;
  gPlttBufferUnfaded.set(sBoxTitleColors(wallpaperId), offset);
}

function GetBoxTitleBaseX(str: number[]): number {
  return DISPLAY_WIDTH - 64 - (GetStringWidth(K.FONT_NORMAL_COPY_1, [...strBody(str), 0xff], 0) >> 1);
}

// Sprite data for box scroll arrows
const sState = 0;
const sTimer = 1;
const sArrowSpeed = 3;

function CreateBoxScrollArrows(): void {
  LoadSpriteSheet({ data: gfx('sBoxScrollArrow_Gfx'), size: 0x0080, tag: K.GFXTAG_BOX_SCROLL_ARROW });
  for (let i = 0; i < 2; i++) {
    const spriteId = CreateSprite(sSpriteTemplate_BoxScrollArrow(), 92 + i * 136, 28, 22);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gSprites[spriteId];
      StartSpriteAnim(sprite, i);
      sprite.data[sArrowSpeed] = i === 0 ? -1 : 1;
      gStorage.arrowSprites[i] = sprite;
    }
  }
  if (IsCursorOnBoxTitle()) AnimateBoxScrollArrows(true);
}

// Slide box scroll arrows horizontally for box change
function StartBoxScrollArrowsSlide(direction: number): void {
  const [a0, a1] = gStorage.arrowSprites as Sprite[];
  for (const a of [a0, a1]) {
    a.x2 = 0;
    a.data[sState] = 2;
  }
  if (direction < 0) {
    a0.data[sTimer] = 29;
    a1.data[sTimer] = 5;
    a0.data[2] = 72;
    a1.data[2] = 72;
  } else {
    a0.data[sTimer] = 5;
    a1.data[sTimer] = 29;
    a0.data[2] = DISPLAY_WIDTH + 8;
    a1.data[2] = DISPLAY_WIDTH + 8;
  }
  a0.data[7] = 0;
  a1.data[7] = 1;
}

// New box's scroll arrows have entered, stop sliding and set their position
function StopBoxScrollArrowsSlide(): void {
  for (let i = 0; i < 2; i++) {
    const a = gStorage.arrowSprites[i]!;
    a.x = 136 * i + 92;
    a.x2 = 0;
    a.invisible = false;
  }
  AnimateBoxScrollArrows(true);
}

/** AnimateBoxScrollArrows: bounce the scroll arrows while the title is selected. */
export function AnimateBoxScrollArrows(animate: boolean): void {
  for (let i = 0; i < 2; i++) {
    const a = gStorage.arrowSprites[i];
    if (!a) continue;
    if (animate) {
      // Start arrows moving
      a.data[sState] = 1;
      a.data[sTimer] = 0;
      a.data[2] = 0;
      a.data[4] = 0;
    } else {
      // Stop arrows moving
      a.data[sState] = 0;
    }
  }
}

function SpriteCB_BoxScrollArrow(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      sprite.x2 = 0;
      break;
    case 1:
      if (++sprite.data[sTimer] > 3) {
        sprite.data[sTimer] = 0;
        sprite.x2 += sprite.data[sArrowSpeed];
        if (++sprite.data[2] > 5) {
          sprite.data[2] = 0;
          sprite.x2 = 0;
        }
      }
      break;
    case 2:
      sprite.data[sState] = 3;
      break;
    case 3:
      sprite.x -= gStorage.scrollSpeed;
      if (sprite.x <= 72 || sprite.x >= DISPLAY_WIDTH + 8) sprite.invisible = true;
      if (--sprite.data[sTimer] === 0) {
        sprite.x = sprite.data[2];
        sprite.invisible = false;
        sprite.data[sState] = 4;
      }
      break;
    case 4:
      sprite.x -= gStorage.scrollSpeed;
      break;
  }
}

/** CreateChooseBoxArrows: the arrows of the Deposit / Jump box popup. */
export function CreateChooseBoxArrows(x: number, y: number, animId: number, priority: number, subpriority: number): Sprite | null {
  const spriteId = CreateSprite(sSpriteTemplate_BoxScrollArrow(), x, y, subpriority);
  if (spriteId === MAX_SPRITES) return null;
  StartSpriteAnim(gSprites[spriteId], animId % 2);
  gSprites[spriteId].oam.priority = priority;
  gSprites[spriteId].callback = SpriteCallbackDummy;
  return gSprites[spriteId];
}
