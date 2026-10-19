// daycare.c's hatching half (FRLG took it over from RSE's egg_hatch.c): `special EggHatch` from
// EventScript_EggHatch (ShouldEggHatch in world/daycare.ts found the party egg in VAR_0x8004), the hatch scene
// (CB2_EggHatch_0 / CB2_EggHatch_1: the egg's wobbles, the shards, the white flash, "X hatched from the EGG!", the
// nickname YES/NO and the naming screen) and CreatedHatchedMon / AddHatchedMonToParty / ScriptHatchMon.
// The daycare's storage and egg making are world/daycare.ts.
//
// The sounds are daycare.c's, through gba/sound.ts: Task_EggHatchPlayBGM (the map music stopped, MUS_EVOLUTION_INTRO,
// MUS_EVOLUTION 61 frames later), SE_BALL on the wobbles, SE_EGG_HATCH, the cry (IsCryFinished holds the scene) and
// the MUS_EVOLVED fanfare, which holds "X hatched from the EGG!" for its sFanfares count (Task_Fanfare). The map
// music comes back on the field (FieldCB_ContinueScriptHandleMusic: OverworldScene.runScreenFromScript).

import { K } from '../battle/constants';
import { bdata, pokemon as pokemonData, state as battleState } from '../battle/env';
import { AllocateMonSpritesGfx, FreeMonSpritesGfx, GetMonSpritePalStructFromOtIdPersonality, gMonSpritesGfxPtr, gMultiuseSpriteTemplate, LoadSpecialPokePic, monPalSymbols, monPicSymbol, SetMultiuseSpriteTemplateToPokemon } from '../battle/gfx';
import { Sin } from '../battle/trig';
import { BG_ATTR_PRIORITY, ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, CopyToBgTilemapBuffer, InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgAttribute, SetBgTilemapBuffer, ShowBg, UnsetBgTilemapBuffer, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, PALETTES_ALL, REG_OFFSET_DISPCNT, RGB_BLACK, RGB_WHITE, SetGpuReg } from '../gba/hw';
import { gMain, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { CreateYesNoMenu, LoadUserWindowGfx, GetTextWindowPalette, Menu_ProcessInputNoWrapClearOnChoose, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { GetCurrentMapMusic, IsCryFinished, IsFanfareTaskInactive, PlayBGM, PlayCry_Normal, PlayFanfare, PlaySE, StopMapMusic } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import { AddTextPrinterParameterized4, COPYWIN_FULL, CopyWindowToVram, DeactivateAllTextPrinters, DUMMY_WIN_TEMPLATE, FillWindowPixelBuffer, InitWindows, IsTextPrinterActive, PutWindowTilemap, RemoveWindow, RunTextPrinters, type WindowTemplate } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import type { Special } from '../script/specials';
import type { GameState } from '../state/GameState';
import { random } from '../util/random';
import { EOS, GetMonNickname, gStringVar1, gStringVar3, StringExpandPlaceholders, text } from './common';
import { CB2_ReturnToField } from './fieldCallbacks';
import { DoNamingScreen, NAMING_SCREEN_NICKNAME, namingScreenGfxSymbols } from './namingScreen';

// ------------------------------------------------------------------ the hatched mon

/**
 * CreatedHatchedMon: a fresh level-5 (EGG_HATCH_LEVEL) mon of the egg's species with the egg's personality, moves,
 * IVs, markings and Pokérus, the player as OT (CreateMon's OT_ID_PLAYER_ID) and friendship 120; it replaces the egg.
 * (Language, met game and the fateful encounter bit aren't modelled.)
 */
function CreatedHatchedMon(state: GameState, egg: Pokemon): Pokemon {
  const data = state.pokemon;
  const temp = data.createMon(egg.species, state.defines.require('EGG_HATCH_LEVEL'), {
    personality: egg.personality, // USE_RANDOM_IVS: CreateMon still rolls IVs, which the egg's then replace
    otId: state.trainerId,
    otName: state.playerName,
    otGender: state.playerGender,
    metLocation: state.currentMapSection,
  });
  temp.moves = [...egg.moves];
  temp.ivs = { ...egg.ivs };
  if (egg.markings !== undefined) temp.markings = egg.markings;
  temp.friendship = 120;
  if (egg.pokerus !== undefined) temp.pokerus = egg.pokerus;
  return temp;
}

/**
 * AddHatchedMonToParty: hatch party slot `id` in place. The nickname is reset to the species name, the Pokédex
 * marks it seen and caught, gStringVar1 = its name, Poké Ball, met level 0 (the summary's "hatched" memo) at the
 * current map section, PP restored and stats recalculated.
 */
export function AddHatchedMonToParty(state: GameState, id: number): void {
  const data = state.pokemon;
  const mon = CreatedHatchedMon(state, state.party[id]);
  state.party[id] = mon;
  mon.isEgg = false; // SetMonData(mon, MON_DATA_IS_EGG, 0x46): the 1-bit field keeps bit 0, FALSE

  mon.nickname = [...data.speciesName(mon.species)]; // GetSpeciesName

  const dexNum = data.nationalDex(mon.species); // SpeciesToNationalPokedexNum
  state.setDexFlags(dexNum, true, false); // GetSetPokedexFlag(FLAG_SET_SEEN)
  state.setDexFlags(dexNum, false, true); // GetSetPokedexFlag(FLAG_SET_CAUGHT)

  state.stringVars[0] = DayCare_GetMonNickname(mon); // DayCare_GetMonNickname(mon, gStringVar1)

  mon.pokeball = state.defines.require('ITEM_POKE_BALL');
  mon.metLevel = 0;
  mon.metLocation = state.currentMapSection; // GetCurrentRegionMapSectionId

  // MonRestorePP
  for (let i = 0; i < data.c.MAX_MON_MOVES; i++) mon.pp[i] = mon.moves[i] ? data.ppWithBonus(mon.moves[i], mon.ppBonuses, i) : 0;
  data.calculateStats(mon); // CalculateMonStats
}

/** DayCare_GetMonNickname: the nickname (StringGet_Nickname: at most POKEMON_NAME_LENGTH chars), no EOS. */
function DayCare_GetMonNickname(mon: Pokemon): number[] {
  return GetMonNickname(mon).slice(0, -1);
}

/** ScriptHatchMon: hatch party slot VAR_0x8004 without the scene (no FRLG script calls it). */
export function ScriptHatchMon(state: GameState): void {
  AddHatchedMonToParty(state, state.getVar('VAR_0x8004'));
}

// ------------------------------------------------------------------ the scene's data

interface EggHatchData {
  eggSpriteID: number;
  pokeSpriteID: number;
  CB2_state: number;
  /** u8 */
  CB2_PalCounter: number;
  eggPartyID: number;
  eggShardVelocityID: number;
  windowId: number;
  species: number;
  textColor: number[];
}

let sEggHatchData: EggHatchData | null = null;
const E = (): EggHatchData => sEggHatchData!;

/** The nickname the naming screen writes (gStringVar3 in the C). */
let sNicknameBuffer: number[] = [EOS];

const TAG_EGG_HATCH_TILES = 12345;
const TAG_EGG_SHARD_TILES = 23456;
const TAG_EGG_PAL = 54321;

/** sSpriteTemplate_EggHatch: the egg (32x32; anims 0-3 = more and more cracked) */
const sSpriteTemplate_EggHatch: SpriteTemplate = {
  tileTag: TAG_EGG_HATCH_TILES,
  paletteTag: TAG_EGG_PAL,
  oam: oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 1 }),
  anims: [
    [ANIMCMD_FRAME(0, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(16, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(32, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(48, 5), ANIMCMD_END],
  ],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sSpriteTemplate_EggShard (8x8; anims 0-3 = the four shard shapes) */
const sSpriteTemplate_EggShard: SpriteTemplate = {
  tileTag: TAG_EGG_SHARD_TILES,
  paletteTag: TAG_EGG_PAL,
  oam: oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], priority: 2 }),
  anims: [
    [ANIMCMD_FRAME(0, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(1, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(2, 5), ANIMCMD_END],
    [ANIMCMD_FRAME(3, 5), ANIMCMD_END],
  ],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_EggShard,
};

const sBgTemplates_EggHatch: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 24, screenSize: 3, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 8, screenSize: 1, paletteMode: 0, priority: 2, baseTile: 0 },
];

const sWinTemplates_EggHatch: WindowTemplate[] = [{ bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 0, baseBlock: 64 }, DUMMY_WIN_TEMPLATE];

const sYesNoWinTemplate: WindowTemplate = { bg: 0, tilemapLeft: 21, tilemapTop: 9, width: 6, height: 4, paletteNum: 15, baseBlock: 424 };

const Q_8_8 = (n: number): number => Math.trunc(n * 256);

/** sEggShardVelocities: [x, y] starting velocities (Q8.8), one per shard in the order they fly */
const sEggShardVelocities: [number, number][] = [
  [Q_8_8(-1.5), Q_8_8(-3.75)],
  [Q_8_8(-5), Q_8_8(-3)],
  [Q_8_8(3.5), Q_8_8(-3)],
  [Q_8_8(-4), Q_8_8(-3.75)],
  [Q_8_8(2), Q_8_8(-1.5)],
  [Q_8_8(-0.5), Q_8_8(-6.75)],
  [Q_8_8(5), Q_8_8(-2.25)],
  [Q_8_8(-1.5), Q_8_8(-3.75)],
  [Q_8_8(4.5), Q_8_8(-1.5)],
  [Q_8_8(-1), Q_8_8(-6.75)],
  [Q_8_8(4), Q_8_8(-2.25)],
  [Q_8_8(-3.5), Q_8_8(-3.75)],
  [Q_8_8(1), Q_8_8(-1.5)],
  [Q_8_8(-3.515625), Q_8_8(-6.75)],
  [Q_8_8(4.5), Q_8_8(-2.25)],
  [Q_8_8(-0.5), Q_8_8(-7.5)],
  [Q_8_8(1), Q_8_8(-4.5)],
  [Q_8_8(-2.5), Q_8_8(-2.25)],
  [Q_8_8(2.5), Q_8_8(-7.5)],
];

/** The graphics the scene draws beyond what prepareMenus loads, for the egg in party slot `slot` (preloading). */
export function eggHatchGfxSymbols(state: GameState, slot: number): string[] {
  const egg = state.party[slot];
  const species = egg?.species ?? 0;
  const personality = egg?.personality ?? 0;
  return [
    'gBattleInterface_Textbox_Gfx',
    'gBattleInterface_Textbox_Tilemap',
    'gBattleInterface_Textbox_Pal',
    'sEggHatchTiles',
    'sEggShardTiles',
    'sEggPalette',
    'gTradeGba2_Pal',
    'gTradeGba_Gfx',
    'gTradeOrHatchMonShadowTilemap',
    'gTextWindowPalettes',
    monPicSymbol(true, species, personality),
    ...monPalSymbols(species),
    ...namingScreenGfxSymbols(NAMING_SCREEN_NICKNAME, species, personality),
  ];
}

// ------------------------------------------------------------------ the scene

/**
 * EggHatch's Task_EggHatch, once the field has faded to black (the special in this file's EGG_HATCH_SPECIALS does
 * LockPlayerFieldControls and the fade): CB2_EggHatch_0. gFieldCallback = FieldCB_ContinueScriptHandleMusic is the
 * field's default return (fade in, the script's `waitstate` ends).
 */
export function StartEggHatch(): void {
  // The YES/NO's text uses BG palette 15 (sYesNoWinTemplate), which the scene never loads: on the GBA it still holds
  // the field's message box palette (LoadStdWindowFrameGfx → LoadMenuMessageWindowGfx: GetTextWindowPalette(0) at
  // DLG_WINDOW_PALETTE_NUM). The overworld isn't on the GBA layer, so load it here.
  LoadPalette(GetTextWindowPalette(0), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  SetMainCallback2(CB2_EggHatch_0);
}

/** EggHatchCreateMonSprite(0, switchID, pokeID, &species): the hatched mon's front pic, on battler position 1's buffer. */
function EggHatchCreateMonSprite(switchID: number, pokeID: number): number {
  const mon = battleState.party[pokeID];
  const position = K.B_POSITION_OPPONENT_LEFT; // r4 = 1 for a0 == 0
  let spriteID = 0;
  switch (switchID) {
    case 0: {
      const species = mon.species;
      LoadSpecialPokePic(true, species, mon.personality, gMonSpritesGfxPtr!.sprites[position]); // HandleLoadSpecialPokePic
      LoadSpritePalette(GetMonSpritePalStructFromOtIdPersonality(species, mon.otId, mon.personality)); // LoadCompressedSpritePalette(GetMonSpritePalStruct(mon))
      E().species = species;
      break;
    }
    case 1:
      SetMultiuseSpriteTemplateToPokemon(GetMonSpritePalStructFromOtIdPersonality(mon.species, mon.otId, mon.personality).tag, position);
      spriteID = CreateSprite(gMultiuseSpriteTemplate, 120, 70, 6);
      gSprites[spriteID].invisible = true;
      gSprites[spriteID].callback = SpriteCallbackDummy;
      break;
  }
  return spriteID;
}

function VBlankCB_EggHatch(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_EggHatch_0(): void {
  switch (gMain.state) {
    case 0:
      SetGpuReg(REG_OFFSET_DISPCNT, 0);
      sEggHatchData = { eggSpriteID: 0, pokeSpriteID: 0, CB2_state: 0, CB2_PalCounter: 0, eggPartyID: 0, eggShardVelocityID: 0, windowId: 0, species: 0, textColor: [0, 0, 0] };
      AllocateMonSpritesGfx();
      E().eggPartyID = battleState.getVar('VAR_0x8004');
      E().eggShardVelocityID = 0;

      SetVBlankCallback(VBlankCB_EggHatch);
      battleState.setVar('VAR_0x8005', GetCurrentMapMusic()); // gSpecialVar_0x8005 (EventScript_EggHatch doesn't read it)

      ResetTempTileDataBuffers();
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates_EggHatch, sBgTemplates_EggHatch.length);

      ChangeBgX(1, 0, 0);
      ChangeBgY(1, 0, 0);
      ChangeBgX(0, 0, 0);
      ChangeBgY(0, 0, 0);

      SetBgAttribute(1, BG_ATTR_PRIORITY, 2);
      SetBgTilemapBuffer(1, new Uint16Array(0x1000 / 2));
      SetBgTilemapBuffer(0, new Uint16Array(0x2000 / 2));

      DeactivateAllTextPrinters();
      ResetPaletteFade();
      FreeAllSpritePalettes();
      ResetSpriteData();
      ResetTasks();
      ScanlineEffect_Stop();
      // m4aSoundVSyncOn: returns at once, the sound was never turned off (only m4aSoundVSyncOff does that)
      gMain.state++;
      break;
    case 1:
      InitWindows(sWinTemplates_EggHatch);
      E().windowId = 0;
      gMain.state++;
      break;
    case 2: {
      const tiles = gfx('gBattleInterface_Textbox_Gfx'); // DecompressAndLoadBgGfxUsingHeap
      LoadBgTiles(0, tiles, tiles.length, 0);
      CopyToBgTilemapBuffer(0, gfx16('gBattleInterface_Textbox_Tilemap'), 0, 0);
      LoadPalette(gfx16('gBattleInterface_Textbox_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP); // LoadCompressedPalette
      gMain.state++;
      break;
    }
    case 3:
      LoadSpriteSheet({ data: gfx('sEggHatchTiles'), size: 2048, tag: TAG_EGG_HATCH_TILES }); // sEggHatch_Sheet
      LoadSpriteSheet({ data: gfx('sEggShardTiles'), size: 128, tag: TAG_EGG_SHARD_TILES }); // sEggShards_Sheet
      LoadSpritePalette({ data: gfx16('sEggPalette'), tag: TAG_EGG_PAL }); // sEgg_SpritePalette
      gMain.state++;
      break;
    case 4:
      CopyBgTilemapBufferToVram(0);
      AddHatchedMonToParty(battleState, E().eggPartyID);
      gMain.state++;
      break;
    case 5:
      EggHatchCreateMonSprite(0, E().eggPartyID);
      gMain.state++;
      break;
    case 6:
      E().pokeSpriteID = EggHatchCreateMonSprite(1, E().eggPartyID);
      gMain.state++;
      break;
    case 7: {
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_OBJ_1D_MAP);
      // LoadPalette(gTradeGba2_Pal, BG_PLTT_ID(1), 5 * PLTT_SIZE_4BPP): the file has three palettes; the C reads two
      // more from whatever follows it in ROM (gTradeGba_Gfx), which the shadow's tilemap (palettes 0 and 3) never uses.
      LoadPalette(gfx16('gTradeGba2_Pal'), BG_PLTT_ID(1), 3 * PLTT_SIZE_4BPP);
      const tiles = gfx('gTradeGba_Gfx'); // LoadBgTiles(1, gTradeGba_Gfx, 0x1420, 0): 0x1400 bytes in the file
      LoadBgTiles(1, tiles, tiles.length, 0);
      CopyToBgTilemapBuffer(1, gfx16('gTradeOrHatchMonShadowTilemap'), 0x1000, 0);
      CopyBgTilemapBufferToVram(1);
      gMain.state++;
      break;
    }
    case 8:
      SetMainCallback2(CB2_EggHatch_1);
      E().CB2_state = 0;
      break;
  }
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** EggHatchSetMonNickname: the naming screen's return. */
function EggHatchSetMonNickname(): void {
  const mon = battleState.party[battleState.getVar('VAR_0x8004')];
  gStringVar3.set(sNicknameBuffer);
  mon.nickname = gStringVar3.get().slice(); // SetMonData(MON_DATA_NICKNAME, gStringVar3)
  FreeMonSpritesGfx();
  sEggHatchData = null;
  // HelpSystem_Enable: no help system
  SetMainCallback2(CB2_ReturnToField);
}

/** Task_EggHatchPlayBGM: the map music stopped, then MUS_EVOLUTION_INTRO, and MUS_EVOLUTION from frame 61. */
function Task_EggHatchPlayBGM(taskID: number): void {
  const d = gTasks[taskID].data;
  if (d[0] === 0) StopMapMusic();
  if (d[0] === 1) PlayBGM(K.MUS_EVOLUTION_INTRO);
  if (d[0] > 60) {
    PlayBGM(K.MUS_EVOLUTION);
    DestroyTask(taskID);
  }
  d[0]++;
}

function CB2_EggHatch_1(): void {
  const e = E();
  switch (e.CB2_state) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, RGB_BLACK);
      e.eggSpriteID = CreateSprite(sSpriteTemplate_EggHatch, 120, 75, 5);
      ShowBg(0);
      ShowBg(1);
      e.CB2_state++;
      CreateTask(Task_EggHatchPlayBGM, 5);
      break;
    case 1:
      if (!gPaletteFade.active) {
        FillWindowPixelBuffer(e.windowId, 0x00);
        e.CB2_PalCounter = 0;
        e.CB2_state++;
      }
      break;
    case 2:
      e.CB2_PalCounter = (e.CB2_PalCounter + 1) & 0xff;
      if (e.CB2_PalCounter > 30) {
        e.CB2_state++;
        gSprites[e.eggSpriteID].callback = SpriteCB_Egg_0;
      }
      break;
    case 3:
      if (gSprites[e.eggSpriteID].callback === SpriteCallbackDummy) {
        PlayCry_Normal(e.species, 0);
        e.CB2_state++;
      }
      break;
    case 4:
      if (IsCryFinished()) e.CB2_state++;
      break;
    case 5:
      gStringVar1.set(DayCare_GetMonNickname(battleState.party[e.eggPartyID]));
      EggHatchPrintMessage(e.windowId, StringExpandPlaceholders(text('gText_HatchedFromEgg')), 0, 3, 0xff);
      PlayFanfare(K.MUS_EVOLVED);
      e.CB2_state++;
      PutWindowTilemap(e.windowId);
      CopyWindowToVram(e.windowId, COPYWIN_FULL);
      break;
    case 6:
      if (IsFanfareTaskInactive()) e.CB2_state++;
      break;
    case 7:
      if (IsFanfareTaskInactive()) e.CB2_state++;
      break;
    case 8:
      gStringVar1.set(DayCare_GetMonNickname(battleState.party[e.eggPartyID]));
      EggHatchPrintMessage(e.windowId, StringExpandPlaceholders(text('gText_NickHatchPrompt')), 0, 2, 1);
      e.CB2_state++;
      break;
    case 9:
      if (!IsTextPrinterActive(e.windowId)) {
        LoadUserWindowGfx(e.windowId, 0x140, BG_PLTT_ID(14)); // LoadUserWindowGfx2
        CreateYesNoMenu(sYesNoWinTemplate, K.FONT_NORMAL_COPY_2, 0, 2, 0x140, 14, 0);
        e.CB2_state++;
      }
      break;
    case 10:
      switch (Menu_ProcessInputNoWrapClearOnChoose()) {
        case 0: {
          const mon = battleState.party[e.eggPartyID];
          sNicknameBuffer = [...DayCare_GetMonNickname(mon), EOS]; // DayCare_GetMonNickname(mon, gStringVar3)
          gStringVar3.set(sNicknameBuffer);
          DoNamingScreen(NAMING_SCREEN_NICKNAME, sNicknameBuffer, mon.species, pokemonData.gender(mon), mon.personality, EggHatchSetMonNickname);
          break;
        }
        case 1:
        case -1:
          e.CB2_state++;
      }
      break;
    case 11:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
      e.CB2_state++;
      break;
    case 12:
      if (!gPaletteFade.active) {
        RemoveWindow(e.windowId);
        UnsetBgTilemapBuffer(0);
        UnsetBgTilemapBuffer(1);
        FreeMonSpritesGfx(); // (the C leaves the mon sprite buffers allocated on this path)
        sEggHatchData = null;
        SetMainCallback2(CB2_ReturnToField);
        // HelpSystem_Enable: no help system
      }
      break;
  }
  if (!sEggHatchData) return; // the naming screen / the field took over
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** SpriteCB_Egg_0: 20 frames of small wobbles; the first crack and a shard at frame 15. */
function SpriteCB_Egg_0(sprite: Sprite): void {
  if (++sprite.data[0] > 20) {
    sprite.callback = SpriteCB_Egg_1;
    sprite.data[0] = 0;
  } else {
    sprite.data[1] = (sprite.data[1] + 20) & 0xff;
    sprite.x2 = Sin(sprite.data[1], 1);
    if (sprite.data[0] === 15) {
      PlaySE(K.SE_BALL);
      StartSpriteAnim(sprite, 1);
      CreateRandomEggShardSprite();
    }
  }
}

/** SpriteCB_Egg_1: a 30-frame pause, then 20 frames of bigger wobbles; a bigger crack at frame 15. */
function SpriteCB_Egg_1(sprite: Sprite): void {
  if (++sprite.data[2] > 30) {
    if (++sprite.data[0] > 20) {
      sprite.callback = SpriteCB_Egg_2;
      sprite.data[0] = 0;
      sprite.data[2] = 0;
    } else {
      sprite.data[1] = (sprite.data[1] + 20) & 0xff;
      sprite.x2 = Sin(sprite.data[1], 2);
      if (sprite.data[0] === 15) {
        PlaySE(K.SE_BALL);
        StartSpriteAnim(sprite, 2);
      }
    }
  }
}

/** SpriteCB_Egg_2: a 30-frame pause, then 38 frames of wobbles; two shards at frame 15; the mon pic is placed. */
function SpriteCB_Egg_2(sprite: Sprite): void {
  if (++sprite.data[2] > 30) {
    if (++sprite.data[0] > 38) {
      sprite.callback = SpriteCB_Egg_3;
      sprite.data[0] = 0;
      const species = battleState.party[E().eggPartyID].species;
      gSprites[E().pokeSpriteID].x2 = 0;
      gSprites[E().pokeSpriteID].y2 = bdata.tables.coords.monFront[species]?.[1] ?? 0; // gMonFrontPicCoords[species].y_offset
    } else {
      sprite.data[1] = (sprite.data[1] + 20) & 0xff;
      sprite.x2 = Sin(sprite.data[1], 2);
      if (sprite.data[0] === 15) {
        PlaySE(K.SE_BALL);
        StartSpriteAnim(sprite, 2);
        CreateRandomEggShardSprite();
        CreateRandomEggShardSprite();
      }
      if (sprite.data[0] === 30) PlaySE(K.SE_BALL);
    }
  }
}

/** SpriteCB_Egg_3: 50 frames still. */
function SpriteCB_Egg_3(sprite: Sprite): void {
  if (++sprite.data[0] > 50) {
    sprite.callback = SpriteCB_Egg_4;
    sprite.data[0] = 0;
  }
}

/** SpriteCB_Egg_4: the fade to white, 16 shards over its first 4 frames; the egg is gone once it's white. */
function SpriteCB_Egg_4(sprite: Sprite): void {
  if (sprite.data[0] === 0) BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 0x10, RGB_WHITE);
  if ((sprite.data[0] & 0xffff) < 4) {
    for (let i = 0; i <= 3; i++) CreateRandomEggShardSprite();
  }
  sprite.data[0]++;
  if (!gPaletteFade.active) {
    PlaySE(K.SE_EGG_HATCH);
    sprite.invisible = true;
    sprite.callback = SpriteCB_Egg_5;
    sprite.data[0] = 0;
  }
}

/** SpriteCB_Egg_5: the mon shows (growing in), rises 10 px, and the screen fades back from white. */
function SpriteCB_Egg_5(sprite: Sprite): void {
  const poke = gSprites[E().pokeSpriteID];
  if (sprite.data[0] === 0) {
    poke.invisible = false;
    StartSpriteAffineAnim(poke, 1); // BATTLER_AFFINE_EMERGE
  }
  if (sprite.data[0] === 8) BeginNormalPaletteFade(PALETTES_ALL, -1, 0x10, 0, RGB_WHITE);
  if (sprite.data[0] <= 9) poke.y -= 1;
  if (sprite.data[0] > 40) sprite.callback = SpriteCallbackDummy;
  sprite.data[0]++;
}

/** SpriteCB_EggShard: flies along its velocity (Q8.8) under gravity data[3]; gone once 20 px below its start on the way down. */
function SpriteCB_EggShard(sprite: Sprite): void {
  sprite.data[4] += sprite.data[1];
  sprite.data[5] += sprite.data[2];

  sprite.x2 = Math.trunc(sprite.data[4] / 256);
  sprite.y2 = Math.trunc(sprite.data[5] / 256);

  sprite.data[2] += sprite.data[3];

  if (sprite.y + sprite.y2 > sprite.y + 20 && sprite.data[2] > 0) DestroySprite(sprite);
}

function CreateRandomEggShardSprite(): void {
  const [velocity1, velocity2] = sEggShardVelocities[E().eggShardVelocityID];
  E().eggShardVelocityID++;
  const spriteAnimIndex = random() % 4;
  CreateEggShardSprite(120, 60, velocity1, velocity2, 100, spriteAnimIndex);
}

function CreateEggShardSprite(x: number, y: number, data1: number, data2: number, data3: number, spriteAnimIndex: number): void {
  const spriteID = CreateSprite(sSpriteTemplate_EggShard, x, y, 4);
  gSprites[spriteID].data[1] = data1;
  gSprites[spriteID].data[2] = data2;
  gSprites[spriteID].data[3] = data3;
  StartSpriteAnim(gSprites[spriteID], spriteAnimIndex);
}

function EggHatchPrintMessage(windowId: number, str: number[], x: number, y: number, speed: number): void {
  FillWindowPixelBuffer(windowId, 0xff);
  E().textColor = [0, 5, 6];
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL_COPY_2, x, y, 1, 1, E().textColor, speed, str);
}

/** For tests: where the scene is (undefined when it isn't up). */
export function eggHatchProbe(): { state: number; eggAnim: number; eggInvisible: boolean; monInvisible: boolean; shardsLeft: number; shardsMade: number } | undefined {
  const e = sEggHatchData;
  if (!e) return undefined;
  const egg = gSprites[e.eggSpriteID];
  return {
    state: e.CB2_state,
    eggAnim: egg.animNum,
    eggInvisible: egg.invisible,
    monInvisible: gSprites[e.pokeSpriteID].invisible,
    shardsLeft: gSprites.filter((s) => s.inUse && s.callback === SpriteCB_EggShard).length,
    shardsMade: e.eggShardVelocityID,
  };
}

// ------------------------------------------------------------------ the specials

/** daycare.c's hatching specials; SPECIALS (script/specials.ts) spreads them in. */
export const EGG_HATCH_SPECIALS: Record<string, Special> = {
  /**
   * EggHatch: LockPlayerFieldControls (the script's `lockall` already did), fade to black, then Task_EggHatch
   * hands over to CB2_EggHatch_0 for the egg in VAR_0x8004. Back through CB2_ReturnToField; the field's fade in
   * ends the `waitstate`.
   */
  EggHatch({ state, host, setWaitState }) {
    const fade = host.fadeScreen(state.defines.require('FADE_TO_BLACK')); // BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK)
    // HelpSystem_Disable: no help system
    let screen: (() => boolean) | undefined;
    setWaitState(() => {
      if (!screen) {
        if (!fade()) return false;
        screen = host.runScreenFromScript(StartEggHatch, eggHatchGfxSymbols(state, state.getVar('VAR_0x8004')));
      }
      return screen();
    });
  },

  ScriptHatchMon({ state }) {
    ScriptHatchMon(state);
  },
};
