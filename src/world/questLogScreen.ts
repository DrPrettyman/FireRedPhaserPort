// quest_log.c's playback screen (QUEST_LOG_PLAN.md QL2b): what fills questLogPlayback.ts' `questLogScreen` seams.
// - The tints: gGlobalFieldTintMode (QL_TINT_GRAYSCALE for each scene, BACKUP_GRAYSCALE for the final one, NONE at
//   the end) and palette.c's TintPalette_GrayScale / _SepiaTone, which fieldmap.c's ApplyGlobalTintToPaletteEntries
//   and field_effect.c's ApplyGlobalFieldPaletteTint apply on the field's palette loads (the host: the map's BG
//   palettes through world/TilesetVram.ts, the object and field effect sheets through world/weatherTextures.ts);
//   QuestLog_BackUpPalette's sPalettesBackup in BACKUP_GRAYSCALE; Task_EndQuestLog's QL_SlightlyDarkenSomePals, then
//   RestoreScreenAfterPlayback's 16 frames of CopyPaletteInvertedTint (grey back to colour), then the backup back into
//   gPlttBufferUnfaded.
// - The windows (ui/QuestLogWindows.ts): DrawPreviouslyOnQuestHeader, CommitQuestLogWindow1, DrawSceneDescription,
//   QuestLog_CloseTextWindow, Task_QuestLogScene_SavedGame's "saved the game at", the bars scrolling off.
// - The music: gDisableMapMusicChangeOnMapLoad (MUSIC_DISABLE_STOP from Task_BeginQuestLogPlayback: the scenes' map
//   loads stop the music, PlaySE is quiet) and Task_EndQuestLog's Overworld_PlaySpecialMapMusic.
//
// No Phaser here: OverworldScene implements QuestLogScreenHost.

import { K } from '../battle/constants';
import { Overworld_PlaySpecialMapMusic } from '../gba/overworldMusic';
import { MUSIC_DISABLE_OFF, MUSIC_DISABLE_STOP, SetDisableMapMusicChangeOnMapLoad } from '../gba/sound';
import {
  concat,
  ConvertIntToDecimalStringN,
  EOS,
  gStringVar1,
  gStringVar4,
  setStringVar4,
  STR_CONV_MODE_LEFT_ALIGN,
  StringExpandPlaceholders,
  text,
} from '../menus/common';
import { CHAR_NEWLINE } from '../text/charmap';
import { questLogHost } from './questLog';
import { questLogScreen } from './questLogPlayback';
import { GetMapName } from './regionMap';
import { WeatherSlightlyDarkensPals } from './weather';

// ------------------------------------------------------------------ palette.c's tints (BGR555 colours)

const GET_R = (c: number) => c & 31;
const GET_G = (c: number) => (c >> 5) & 31;
const GET_B = (c: number) => (c >> 10) & 31;
const RGB2 = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);

/** (r * Q_8_8(0.3) + g * Q_8_8(0.59) + b * Q_8_8(0.1133)) >> 8 */
function grayOf(c: number): number {
  return (GET_R(c) * 76 + GET_G(c) * 151 + GET_B(c) * 29) >> 8;
}

/** TintPalette_GrayScale on one colour */
export function TintPalette_GrayScale(c: number): number {
  const gray = grayOf(c);
  return RGB2(gray, gray, gray);
}

/** TintPalette_SepiaTone on one colour */
export function TintPalette_SepiaTone(c: number): number {
  const gray = grayOf(c);
  const r = Math.min(31, ((307 * gray) & 0xffff) >> 8); // Q_8_8(1.2)
  const g = ((256 * gray) & 0xffff) >> 8; // Q_8_8(1.0)
  const b = ((240 * gray) & 0xffff) >> 8; // Q_8_8(0.94)
  return RGB2(r, g, b);
}

/** CopyPaletteInvertedTint on one colour: `tone` sixteenths of the way from it to its grey (0: as is). */
export function CopyPaletteInvertedTint(c: number, tone: number): number {
  if (!tone) return c;
  const gray = grayOf(c);
  const r = GET_R(c) + ((tone * (gray - GET_R(c))) >> 4);
  const g = GET_G(c) + ((tone * (gray - GET_G(c))) >> 4);
  const b = GET_B(c) + ((tone * (gray - GET_B(c))) >> 4);
  return RGB2(r, g, b);
}

/** SlightlyDarkenPalsInWeather's BlendPalettesAt(palbuf, RGB_BLACK, 3, size) on one colour */
export function BlendToBlack3(c: number): number {
  const ch = (v: number) => v + ((-v * 3) >> 4);
  return RGB2(ch(GET_R(c)), ch(GET_G(c)), ch(GET_B(c)));
}

/** A palette as the field holds it (palettes.json's JASC [r, g, b] x 16, flat) through a BGR555 colour map. */
export function mapJascColors(colors: number[], f: (c: number) => number): number[] {
  const out = colors.slice();
  for (let i = 0; i + 2 < colors.length; i += 3) {
    const v = f(RGB2(colors[i] >> 3, colors[i + 1] >> 3, colors[i + 2] >> 3));
    out[i] = Math.floor((GET_R(v) * 255) / 31);
    out[i + 1] = Math.floor((GET_G(v) * 255) / 31);
    out[i + 2] = Math.floor((GET_B(v) * 255) / 31);
  }
  return out;
}

// ------------------------------------------------------------------ gGlobalFieldTintMode

/** gGlobalFieldTintMode (fieldmap.c's EWRAM): QL_TINT_* */
let gGlobalFieldTintMode = 0;

export function globalFieldTintMode(): number {
  return gGlobalFieldTintMode;
}

/** The tint ApplyGlobalTintToPaletteEntries / ApplyGlobalFieldPaletteTint apply in a mode (undefined: none). */
export function tintForMode(mode: number): ((c: number) => number) | undefined {
  if (mode === K.QL_TINT_GRAYSCALE || mode === K.QL_TINT_BACKUP_GRAYSCALE) return TintPalette_GrayScale;
  if (mode === K.QL_TINT_SEPIA) return TintPalette_SepiaTone;
  return undefined;
}

// ------------------------------------------------------------------ the host

/** The kinds of OBJ palette slot QL_SlightlyDarkenSomePals tells apart (weatherTextures.ts' sheet types). */
export type ObjPaletteKind = 'normal' | 'alt' | 'none';

/** What the playback's screen asks of the field. OverworldScene implements it. */
export interface QuestLogScreenHost {
  /**
   * gGlobalFieldTintMode's tint on the field's palette loads from now on (`tint` a BGR555 colour map; undefined: none),
   * backing up the untinted colours if `backup` (QuestLog_BackUpPalette). The map's palettes take it at their next load
   * (LoadMapTilesetPalettes), the sprite sheets at once (they're the OBJ palettes as loaded).
   */
  setFieldPaletteTint(tint: ((c: number) => number) | undefined, backup: boolean): void;
  /**
   * gPlttBufferUnfaded = sPalettesBackup through `bg` for the map's BG palettes 0-12 and `obj` for the OBJ palettes
   * (by slot kind); undefined: the backup as it is (Task_EndQuestLog's CpuCopy16), which also ends the backup.
   */
  setFieldPalettesUnfadedFromBackup(map?: { bg: (c: number) => number; obj: (kind: ObjPaletteKind, c: number) => number }): void;
  /** gPlttBufferFaded = `f`(gPlttBufferUnfaded) for the map's BG palettes 0-13 and every OBJ palette. */
  setFieldPalettesFaded(f: (c: number) => number): void;
  windows: {
    addWindow(id: number): void;
    fillRect(id: number, color: number, x: number, y: number, w: number, h: number): void;
    setTilemap(id: number, shown: boolean): void;
    copyDescriptionWindowTiles(): void;
    print(id: number, text: number[], x: number, y: number, lineSpacing: number): void;
    removeWindow(id: number): void;
  };
}

const WIN_TOP_BAR = 0;
const WIN_BOTTOM_BAR = 1;
const WIN_DESCRIPTION = 2;
const WIN_COUNT = 3;
/** sWindowTemplates' sizes in pixels */
const WIN_W = 30 * 8;
const WIN_H = [2 * 8, 2 * 8, 6 * 8];
/** sQuestLogTextLineYCoords: the description's y by its number of line breaks */
const sQuestLogTextLineYCoords = [17, 10, 3];

let sHost: QuestLogScreenHost | undefined;

// ------------------------------------------------------------------ the seams

/**
 * Fill questLogPlayback.ts' `questLogScreen` seams with the screen (OverworldScene's create). Without a host (unit
 * tests) they stay as they were.
 */
export function installQuestLogScreen(host: QuestLogScreenHost): void {
  sHost = host;
  Object.assign(questLogScreen, {
    setGlobalFieldTintMode,
    drawPreviouslyOnQuestHeader: DrawPreviouslyOnQuestHeader,
    drawSceneDescription: DrawSceneDescription,
    closeTextWindow: QuestLog_CloseTextWindow,
    drawSavedGameText,
    beginEnd,
    restoreScreenAfterPlayback: RestoreScreenAfterPlayback,
    removeWindows,
    finishEnd,
    disableMapMusicChange,
    reset: resetQuestLogScreen,
  });
}

/** gGlobalFieldTintMode = mode: the field's palette loads take its tint from now on. */
function setGlobalFieldTintMode(mode: number): void {
  gGlobalFieldTintMode = mode;
  sHost?.setFieldPaletteTint(tintForMode(mode), mode === K.QL_TINT_BACKUP_GRAYSCALE);
}

/** DrawPreviouslyOnQuestHeader: the three windows filled dark, "Previously on your quest…" and the scene number (not 0). */
function DrawPreviouslyOnQuestHeader(sceneNum: number): void {
  const w = sHost?.windows;
  if (!w) return;
  for (let i = 0; i < WIN_COUNT; i++) {
    w.addWindow(i);
    w.fillRect(i, 15, 0, 0, WIN_W, WIN_H[i]);
  }
  let header = StringExpandPlaceholders(text('gText_QuestLog_PreviouslyOnYourQuest'));
  // Scene numbers count from 4 to 0, 0 being where the player saved
  if (sceneNum !== 0) header = concat(header, ConvertIntToDecimalStringN(sceneNum, STR_CONV_MODE_LEFT_ALIGN, 1));
  setStringVar4(header);
  w.print(WIN_TOP_BAR, gStringVar4, 2, 2, 2);
  w.setTilemap(WIN_TOP_BAR, true);
  w.setTilemap(WIN_BOTTOM_BAR, true);
}

/** CommitQuestLogWindow1: the bottom bar's tilemap put back (new_menu_helpers.c's ClearDialogWindowAndFrame in
 *  playback, after the field message box's frame cleared BG0's rows 14-19: text/MessageBox.ts' hide). */
export function CommitQuestLogWindow1(): void {
  sHost?.windows.setTilemap(WIN_BOTTOM_BAR, true);
}

/**
 * The field message box's DrawDialogueFrame in playback: its frame's tilemap (BG0 rows 14-19, every column) goes
 * over the bottom bar's and the description window's, which share BG0 with it. The port's windows are separate
 * images, so the box's frame hides theirs (text/MessageBox.ts' show / open).
 */
export function QL_DialogueFrameDrawn(): void {
  sHost?.windows.setTilemap(WIN_BOTTOM_BAR, false);
  sHost?.windows.setTilemap(WIN_DESCRIPTION, false);
}

/** DrawSceneDescription: gStringVar4 on the description window, lower the fewer its lines. */
function DrawSceneDescription(): void {
  const w = sHost?.windows;
  if (!w) return;
  let numLines = 0;
  for (let i = 0; i < 0x100 && i < gStringVar4.length && gStringVar4[i] !== EOS; i++) if (gStringVar4[i] === CHAR_NEWLINE) numLines++;
  w.setTilemap(WIN_DESCRIPTION, true);
  w.copyDescriptionWindowTiles();
  w.print(WIN_DESCRIPTION, gStringVar4, 2, sQuestLogTextLineYCoords[numLines] ?? 3, 0);
}

/** QuestLog_CloseTextWindow: the description window cleared and hidden, the bottom bar shown again. */
function QuestLog_CloseTextWindow(): void {
  const w = sHost?.windows;
  if (!w) return;
  w.setTilemap(WIN_DESCRIPTION, false);
  w.fillRect(WIN_DESCRIPTION, 15, 0, 0, 0xf0, 0x30);
  w.setTilemap(WIN_BOTTOM_BAR, true);
}

/** Task_QuestLogScene_SavedGame's text: "<player> saved the game at this location: <map>." */
function drawSavedGameText(): void {
  gStringVar1.set(GetMapName(questLogHost()?.mapSec() ?? 0, 0)); // GetMapNameGeneric(gMapHeader.regionMapSectionId)
  setStringVar4(StringExpandPlaceholders(text('gText_QuestLog_SavedGameAtLocation')));
  DrawSceneDescription();
}

/** Task_EndQuestLog's state 0: the map music back, QL_SlightlyDarkenSomePals, the header's text cleared. */
function beginEnd(): void {
  SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_OFF);
  Overworld_PlaySpecialMapMusic();
  QL_SlightlyDarkenSomePals();
  sHost?.windows.fillRect(WIN_TOP_BAR, 0xf, 0, 0, WIN_W, WIN_H[WIN_TOP_BAR]);
}

/**
 * QL_SlightlyDarkenSomePals: gPlttBufferUnfaded = sPalettesBackup, in a darkening weather (rain, snow, shade) with
 * BG 0-12 and OBJ 1, 6-9 and 11-15 (the reflections and field effects) 3/16 toward black.
 */
function QL_SlightlyDarkenSomePals(): void {
  const darken = WeatherSlightlyDarkensPals();
  const same = (c: number) => c;
  sHost?.setFieldPalettesUnfadedFromBackup({
    bg: darken ? BlendToBlack3 : same,
    obj: (kind, c) => (darken && kind !== 'alt' ? BlendToBlack3(c) : c),
  });
}

/**
 * RestoreScreenAfterPlayback's frame `timer` (0-15): the field's palettes 15 - timer sixteenths grey
 * (CopyPaletteInvertedTint from gPlttBufferUnfaded), a row of each bar cleared (the top bar's from its bottom up,
 * the bottom bar's from its top down).
 */
function RestoreScreenAfterPlayback(timer: number): void {
  if (!sHost) return;
  const tone = 15 - timer;
  sHost.setFieldPalettesFaded((c) => CopyPaletteInvertedTint(c, tone));
  sHost.windows.fillRect(WIN_TOP_BAR, 0, 0, WIN_H[WIN_TOP_BAR] - 1 - timer, WIN_W, 1);
  sHost.windows.fillRect(WIN_BOTTOM_BAR, 0, 0, timer, WIN_W, 1);
}

/** Task_EndQuestLog's case 1 once the bars are off: ClearWindowTilemap and RemoveWindow for each window. */
function removeWindows(): void {
  for (let i = 0; i < WIN_COUNT; i++) {
    sHost?.windows.setTilemap(i, false);
    sHost?.windows.removeWindow(i);
  }
}

/** Task_EndQuestLog's last state: CpuCopy16(sPalettesBackup, gPlttBufferUnfaded) (what shows stays). */
function finishEnd(): void {
  sHost?.setFieldPalettesUnfadedFromBackup(undefined);
}

/** Task_BeginQuestLogPlayback: gDisableMapMusicChangeOnMapLoad = MUSIC_DISABLE_STOP. */
function disableMapMusicChange(): void {
  SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_STOP);
}

/** A new game or a soft reset (EWRAM): no tint, no windows. */
function resetQuestLogScreen(): void {
  if (gGlobalFieldTintMode !== K.QL_TINT_NONE) setGlobalFieldTintMode(K.QL_TINT_NONE);
  for (let i = 0; i < WIN_COUNT; i++) sHost?.windows.removeWindow(i);
}
