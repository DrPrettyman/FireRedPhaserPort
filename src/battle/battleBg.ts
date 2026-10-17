// battle_bg.c: battle BG/window templates, the textbox and terrain graphics, plus the
// text_window.c / new_menu_helpers.c loaders they use. Link VS screens aren't supported.

import { BG_CHAR_ADDR, BG_SCREEN_ADDR, CopyBgTilemapBufferToVram, CopyToBgTilemapBuffer, InitBgsFromTemplates, LoadBgTiles, LZDecompressVram, ResetBgsAndClearDma3BusyFlags, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_OBJWIN_ON,
  DISPCNT_WIN0_ON,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  RGB,
  SetGpuReg,
} from '../gba/hw';
import { BG_PLTT_ID, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, LoadPalette, PLTT_SIZE_4BPP } from '../gba/palette';
import { GetWindowAttribute, InitWindows, type WindowTemplate } from '../gba/window';
import { K } from './constants';
import { bdata, g, state } from './env';

/** gBattleBgTemplates */
export const gBattleBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 24, screenSize: 2, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 28, screenSize: 2, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 1, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 2, mapBaseIndex: 26, screenSize: 1, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

const win = (bg: number, tilemapLeft: number, tilemapTop: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate => ({
  bg,
  tilemapLeft,
  tilemapTop,
  width,
  height,
  paletteNum,
  baseBlock,
});

/** sStandardBattleWindowTemplates, indexed by B_WIN_* */
const sStandardBattleWindowTemplates = (): WindowTemplate[] => {
  const t: WindowTemplate[] = [];
  t[K.B_WIN_MSG] = win(0, 1, 15, 28, 4, 0, 0x090);
  t[K.B_WIN_ACTION_PROMPT] = win(0, 1, 35, 14, 4, 0, 0x1c0);
  t[K.B_WIN_ACTION_MENU] = win(0, 17, 35, 12, 4, 5, 0x190);
  t[K.B_WIN_MOVE_NAME_1] = win(0, 2, 55, 8, 2, 5, 0x300);
  t[K.B_WIN_MOVE_NAME_2] = win(0, 11, 55, 8, 2, 5, 0x310);
  t[K.B_WIN_MOVE_NAME_3] = win(0, 2, 57, 8, 2, 5, 0x320);
  t[K.B_WIN_MOVE_NAME_4] = win(0, 11, 57, 8, 2, 5, 0x330);
  t[K.B_WIN_PP] = win(0, 21, 55, 3, 2, 5, 0x290);
  t[K.B_WIN_MOVE_TYPE] = win(0, 21, 57, 8, 2, 5, 0x296);
  t[K.B_WIN_PP_REMAINING] = win(0, 24, 55, 5, 2, 5, 0x2a6);
  t[K.B_WIN_DUMMY] = win(0, 25, 57, 0, 0, 5, 0x2b0);
  t[K.B_WIN_SWITCH_PROMPT] = win(0, 21, 55, 8, 4, 5, 0x2b0);
  t[K.B_WIN_LEVEL_UP_BOX] = win(1, 19, 8, 10, 11, 5, 0x100);
  t[K.B_WIN_LEVEL_UP_BANNER] = win(2, 18, 0, 12, 3, 6, 0x16e);
  t[K.B_WIN_YESNO] = win(0, 25, 9, 4, 4, 5, 0x100);
  t[K.B_WIN_VS_PLAYER] = win(1, 2, 3, 7, 2, 5, 0x020);
  t[K.B_WIN_VS_OPPONENT] = win(2, 2, 3, 7, 2, 5, 0x040);
  t[K.B_WIN_VS_MULTI_PLAYER_1] = win(1, 2, 2, 7, 2, 5, 0x020);
  t[K.B_WIN_VS_MULTI_PLAYER_2] = win(2, 2, 2, 7, 2, 5, 0x040);
  t[K.B_WIN_VS_MULTI_PLAYER_3] = win(1, 2, 6, 7, 2, 5, 0x060);
  t[K.B_WIN_VS_MULTI_PLAYER_4] = win(2, 2, 6, 7, 2, 5, 0x080);
  t[K.B_WIN_VS_OUTCOME_DRAW] = win(0, 11, 2, 8, 2, 0, 0x0a0);
  t[K.B_WIN_VS_OUTCOME_LEFT] = win(0, 4, 2, 8, 2, 0, 0x0a0);
  t[K.B_WIN_VS_OUTCOME_RIGHT] = win(0, 19, 2, 8, 2, 0, 0x0b0);
  t[K.B_WIN_OAK_OLD_MAN] = win(0, 2, 15, 26, 4, 7, 0x090);
  t.push(win(0xff, 0, 0, 0, 0, 0, 0)); // DUMMY_WIN_TEMPLATE
  return t;
};

interface BattleBackground {
  tileset: string;
  tilemap: string;
  entryTileset: string;
  entryTilemap: string;
  palette: string;
}

const terrain = (name: string, palette = name, entry = name): BattleBackground => ({
  tileset: `sBattleTerrainTiles_${name}`,
  tilemap: `sBattleTerrainTilemap_${name}`,
  entryTileset: `sBattleTerrainAnimTiles_${entry}`,
  entryTilemap: `sBattleTerrainAnimTilemap_${entry}`,
  palette: `sBattleTerrainPalette_${palette}`,
});

/** sBattleTerrainTable */
const sBattleTerrainTable = (): BattleBackground[] => {
  const t: BattleBackground[] = [];
  t[K.BATTLE_TERRAIN_GRASS] = terrain('Grass');
  t[K.BATTLE_TERRAIN_LONG_GRASS] = terrain('LongGrass');
  t[K.BATTLE_TERRAIN_SAND] = terrain('Sand');
  t[K.BATTLE_TERRAIN_UNDERWATER] = terrain('Underwater');
  t[K.BATTLE_TERRAIN_WATER] = terrain('Water');
  t[K.BATTLE_TERRAIN_POND] = terrain('Pond');
  t[K.BATTLE_TERRAIN_MOUNTAIN] = terrain('Mountain');
  t[K.BATTLE_TERRAIN_CAVE] = terrain('Cave');
  t[K.BATTLE_TERRAIN_BUILDING] = terrain('Building');
  t[K.BATTLE_TERRAIN_PLAIN] = terrain('Building', 'Plain');
  t[K.BATTLE_TERRAIN_LINK] = terrain('Building', 'Link');
  t[K.BATTLE_TERRAIN_GYM] = terrain('Building', 'Gym');
  t[K.BATTLE_TERRAIN_LEADER] = terrain('Building', 'Leader');
  t[K.BATTLE_TERRAIN_INDOOR_2] = { ...terrain('Indoor', 'Indoor2'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_INDOOR_1] = { ...terrain('Indoor', 'Indoor1'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_LORELEI] = { ...terrain('Indoor', 'Lorelei'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_BRUNO] = { ...terrain('Indoor', 'Bruno'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_AGATHA] = { ...terrain('Indoor', 'Agatha'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_LANCE] = { ...terrain('Indoor', 'Lance'), ...entryOf('Building') };
  t[K.BATTLE_TERRAIN_CHAMPION] = { ...terrain('Indoor', 'Champion'), ...entryOf('Building') };
  return t;
};
const entryOf = (name: string) => ({ entryTileset: `sBattleTerrainAnimTiles_${name}`, entryTilemap: `sBattleTerrainAnimTilemap_${name}` });

let terrainTable: BattleBackground[] | undefined;
const terrains = () => (terrainTable ??= sBattleTerrainTable());

/** The graphics symbols a battle can load (for preloading). */
export function battleBgGfxSymbols(): string[] {
  const syms = new Set<string>([
    'gBattleInterface_Textbox_Gfx',
    'gBattleInterface_Textbox_Tilemap',
    'gBattleInterface_Textbox_Pal',
    'gStandardMenuPalette',
    'gMenuMessageWindow_Gfx',
    'gTextWindowPalettes',
    'sDownArrowTiles',
  ]);
  for (let i = 1; i <= 10; i++) {
    syms.add(`sUserFrame_Type${i}_Gfx`);
    syms.add(`sUserFrame_Type${i}_Pal`);
  }
  for (const t of terrains()) if (t) for (const s of Object.values(t)) syms.add(s);
  return [...syms];
}

/** sMapBattleSceneMapping / GetBattleTerrainByMapScene */
function GetBattleTerrainByMapScene(mapBattleScene: number): number {
  const mapping: [string, string][] = [
    ['MAP_BATTLE_SCENE_GYM', 'BATTLE_TERRAIN_GYM'],
    ['MAP_BATTLE_SCENE_INDOOR_1', 'BATTLE_TERRAIN_INDOOR_1'],
    ['MAP_BATTLE_SCENE_INDOOR_2', 'BATTLE_TERRAIN_INDOOR_2'],
    ['MAP_BATTLE_SCENE_LORELEI', 'BATTLE_TERRAIN_LORELEI'],
    ['MAP_BATTLE_SCENE_BRUNO', 'BATTLE_TERRAIN_BRUNO'],
    ['MAP_BATTLE_SCENE_AGATHA', 'BATTLE_TERRAIN_AGATHA'],
    ['MAP_BATTLE_SCENE_LANCE', 'BATTLE_TERRAIN_LANCE'],
    ['MAP_BATTLE_SCENE_LINK', 'BATTLE_TERRAIN_LINK'],
  ];
  for (const [scene, terrainId] of mapping) if (mapBattleScene === K[scene]) return K[terrainId];
  return K.BATTLE_TERRAIN_PLAIN;
}

function LoadBattleTerrainGfx(terrainId: number): void {
  const t = terrains();
  if (terrainId >= t.length) terrainId = K.BATTLE_TERRAIN_PLAIN;
  // Copy to bg3
  LZDecompressVram(gfx(t[terrainId].tileset), BG_CHAR_ADDR(2));
  LZDecompressVram(gfx(t[terrainId].tilemap), BG_SCREEN_ADDR(26));
  LoadCompressedPalette(gfx16(t[terrainId].palette), BG_PLTT_ID(2), 3 * PLTT_SIZE_4BPP);
}

function LoadBattleTerrainEntryGfx(terrainId: number): void {
  const t = terrains();
  if (terrainId >= t.length) terrainId = K.BATTLE_TERRAIN_PLAIN;
  // Copy to bg1
  LZDecompressVram(gfx(t[terrainId].entryTileset), BG_CHAR_ADDR(1));
  LZDecompressVram(gfx(t[terrainId].entryTilemap), BG_SCREEN_ADDR(28));
}

/** BattleInitBgsAndWindows */
export function BattleInitBgsAndWindows(): void {
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, gBattleBgTemplates);
  InitWindows(sStandardBattleWindowTemplates());
}

/** InitBattleBgsVideo */
export function InitBattleBgsVideo(): void {
  BattleInitBgsAndWindows();
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON | DISPCNT_OBJWIN_ON);
}

/** LoadUserWindowGfx / LoadUserWindowGfxByFrame (gUserFrames) */
export function LoadUserWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  const n = state.optionsWindowFrameType + 1; // gSaveBlock2Ptr->optionsWindowFrameType
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx(`sUserFrame_Type${n}_Gfx`), 0x120, destOffset);
  LoadPalette(gfx16(`sUserFrame_Type${n}_Pal`), palOffset, PLTT_SIZE_4BPP);
}

/** GetTextWindowPalette (gTextWindowPalettes[id]) */
export function GetTextWindowPalette(id: number): Uint16Array {
  return gfx16('gTextWindowPalettes').subarray(id * 16, id * 16 + 16);
}

/** LoadMenuMessageWindowGfx */
export function LoadMenuMessageWindowGfx(windowId: number, destOffset: number, palOffset: number): void {
  LoadBgTiles(GetWindowAttribute(windowId, 'bg'), gfx('gMenuMessageWindow_Gfx'), 0x280, destOffset);
  LoadPalette(GetTextWindowPalette(0), palOffset, PLTT_SIZE_4BPP);
}

/** Menu_LoadStdPalAt */
export function Menu_LoadStdPalAt(offset: number): void {
  LoadPalette(gfx16('gStandardMenuPalette'), offset, 2 * 10);
}

/** LoadBattleMenuWindowGfx */
export function LoadBattleMenuWindowGfx(): void {
  LoadUserWindowGfx(2, 0x012, BG_PLTT_ID(1));
  LoadUserWindowGfx(2, 0x022, BG_PLTT_ID(1));
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 12] = RGB(9, 9, 9);
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 13] = RGB(9, 9, 9);
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 14] = RGB(31, 31, 31);
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 15] = RGB(26, 26, 25);
  for (let i = 12; i < 16; i++) gPlttBufferFaded[BG_PLTT_ID(5) + i] = gPlttBufferUnfaded[BG_PLTT_ID(5) + i];
  if (g.battleTypeFlags & (K.BATTLE_TYPE_FIRST_BATTLE | K.BATTLE_TYPE_POKEDUDE)) {
    Menu_LoadStdPalAt(BG_PLTT_ID(7));
    LoadMenuMessageWindowGfx(0, 0x030, BG_PLTT_ID(7));
    gPlttBufferUnfaded[BG_PLTT_ID(7) + 6] = RGB(0, 0, 0);
    gPlttBufferFaded[BG_PLTT_ID(7) + 6] = gPlttBufferUnfaded[BG_PLTT_ID(7) + 6];
  }
}

/** DrawMainBattleBackground */
export function DrawMainBattleBackground(): void {
  LoadBattleTerrainGfx(GetBattleTerrainOverride());
}

/** LoadBattleTextboxAndBackground */
export function LoadBattleTextboxAndBackground(): void {
  LZDecompressVram(gfx('gBattleInterface_Textbox_Gfx'), BG_CHAR_ADDR(0));
  CopyToBgTilemapBuffer(0, gfx16('gBattleInterface_Textbox_Tilemap'), 0, 0x000);
  CopyBgTilemapBufferToVram(0);
  LoadCompressedPalette(gfx16('gBattleInterface_Textbox_Pal'), BG_PLTT_ID(0), 2 * PLTT_SIZE_4BPP);
  LoadBattleMenuWindowGfx();
  DrawMainBattleBackground();
}

function trainerClass(): number {
  return bdata.tables.trainers[g.trainerBattleOpponent_A]?.trainerClass ?? 0;
}

/** DrawBattleEntryBackground (link VS screen not supported) */
export function DrawBattleEntryBackground(): void {
  const f = g.battleTypeFlags;
  if (f & K.BATTLE_TYPE_LINK) {
    console.warn('[battle] link VS screen not supported');
    LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_BUILDING);
  } else if (f & K.BATTLE_TYPE_POKEDUDE) {
    LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_GRASS);
  } else if (f & (K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_EREADER_TRAINER)) {
    LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_BUILDING);
  } else if (f & K.BATTLE_TYPE_KYOGRE_GROUDON) {
    LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_CAVE); // gGameVersion == VERSION_FIRE_RED
  } else {
    if (f & K.BATTLE_TYPE_TRAINER) {
      const c = trainerClass();
      if (c === K.TRAINER_CLASS_LEADER || c === K.TRAINER_CLASS_CHAMPION) {
        LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_BUILDING);
        return;
      }
    }
    if (g.mapBattleScene === K.MAP_BATTLE_SCENE_NORMAL) LoadBattleTerrainEntryGfx(g.battleTerrain);
    else LoadBattleTerrainEntryGfx(K.BATTLE_TERRAIN_BUILDING);
  }
}

/** GetBattleTerrainOverride */
export function GetBattleTerrainOverride(): number {
  const f = g.battleTypeFlags;
  if (f & (K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_EREADER_TRAINER)) return K.BATTLE_TERRAIN_LINK;
  if (f & K.BATTLE_TYPE_POKEDUDE) {
    g.battleTerrain = K.BATTLE_TERRAIN_GRASS;
    return K.BATTLE_TERRAIN_GRASS;
  }
  if (f & K.BATTLE_TYPE_TRAINER) {
    if (trainerClass() === K.TRAINER_CLASS_LEADER) return K.BATTLE_TERRAIN_LEADER;
    if (trainerClass() === K.TRAINER_CLASS_CHAMPION) return K.BATTLE_TERRAIN_CHAMPION;
  }
  if (g.mapBattleScene === K.MAP_BATTLE_SCENE_NORMAL) return g.battleTerrain;
  return GetBattleTerrainByMapScene(g.mapBattleScene);
}
