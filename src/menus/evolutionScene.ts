// evolution_scene.c: the evolution screen (EvolutionScene / BeginEvolutionScene), run on the GBA layer
// by whichever host started it: the battle after it ends (TryEvolvePokemon) or the field's party menu
// (Rare Candy, evolution stones). It draws on the battle's BG/window layout, then hands back through
// gCB2_AfterEvolution. TradeEvolutionScene isn't ported (no FRLG in-game trade evolves).
//
// The sounds are evolution_scene.c's, through gba/sound.ts: m4aMPlayAllStop on entry, the cries (IsCryFinished holds
// the scene), MUS_EVOLUTION_INTRO on an SE player (!IsSEPlaying), MUS_EVOLUTION as the map music, SE_EXP (stopped
// with everything else by m4aMPlayAllStop the frame after it starts), MUS_EVOLVED, MUS_LEVEL_UP, and the map music
// again at the end (StopMapMusic + Overworld_PlaySpecialMapMusic). The sparkles' SEs are evolutionGraphics.ts's.

import { gBattleBgTemplates, InitBattleBgsVideo, LoadBattleTextboxAndBackground } from '../battle/battleBg';
import { K } from '../battle/constants';
import { bdata, g, pokemon, state } from '../battle/env';
import { AllocateMonSpritesGfx, DecompressPicFromTable, FreeMonSpritesGfx, gMonSpritesGfxPtr, gMultiuseSpriteTemplate, GetMonSpritePalStructFromOtIdPersonality, SetMultiuseSpriteTemplateToPokemon, SpriteCallbackDummy_2 } from '../battle/gfx';
import { BattleCreateYesNoCursorAt, BattleDestroyYesNoCursorAt, BattlePutTextOnWindow, HandleBattleWindow } from '../battle/battleWindow';
import { bufferMoveToLearnIntoBattleTextBuff2, isHMMove2 } from '../battle/bsCommands3';
import { battleStringExpandPlaceholdersToDisplayedString, encodeBattleText, gBattleStringsTable } from '../battle/message';
import { calculateMonStats, handleSetPokedexFlag, monTryLearningNewMove, removeMonPPBonus, setMonMoveSlot, speciesToNationalPokedexNum } from '../battle/pokemonBattle';
import { prepareMoveBuffer } from '../battle/textBuffers';
import { Cos, Sin } from '../battle/trig';
import { BG_ATTR_PRIORITY, CopyBgTilemapBufferToVram, CopyToBgTilemapBuffer, LoadBgTiles, SetBgAttribute, ShowBg } from '../gba/bg';
import { testEvent } from '../dev/testHooks';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_BG2,
  DISPCNT_BG0_ON,
  DISPCNT_BG1_ON,
  DISPCNT_BG2_ON,
  DISPCNT_BG3_ON,
  DISPCNT_BG_ALL_ON,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  PALETTES_ALL,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, gMain, JOY_NEW, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { BeginNormalPaletteFade, BG_PLTT_ID, FillPalette, gPaletteFade, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_InitHBlankDmaTransfer, ScanlineEffect_Stop } from '../gba/scanline';
import { IsCryFinished, IsSEPlaying, m4aMPlayAllStop, PlayBGM, PlayCry_Normal, PlayFanfare, PlayNewMapMusic, PlaySE, StopMapMusic } from '../gba/sound';
import { hasOverworldMusicHost, Overworld_PlaySpecialMapMusic } from '../gba/overworldMusic';
import { AnimateSprites, BuildOamBuffer, CreateSprite, FreeAllSpritePalettes, gDummySpriteAffineAnimTable, gSprites, ProcessSpriteCopyRequests, ResetSpriteData, SetReservedSpritePaletteCount } from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, FuncIsActiveTask, gTasks, ResetTasks, RunTasks, TASK_NONE } from '../gba/task';
import { FreeAllWindowBuffers, IsTextPrinterActive, RunTextPrinters } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { EOS, ExpandToStringVar4, GetMonNickname, gStringVar1, gStringVar2, gStringVar4 } from './common';
import { menusData } from './data';
import { IsNationalPokedexEnabled } from '../state/nationalDex';
import {
  CycleEvolutionMonSprite,
  EVO_GRAPHICS_TASK_EVO_STOP,
  EVOLUTION_SPARKLE_GFX,
  EvolutionSparkles_ArcDown,
  EvolutionSparkles_CircleInward,
  EvolutionSparkles_SpiralUpward,
  EvolutionSparkles_SprayAndFlash,
  LoadEvoSparkleSpriteAndPal,
} from './evolutionGraphics';
import { GetMoveSlotToReplace, ShowSelectMovePokemonSummaryScreen } from './summaryScreen';

/** The C symbols the scene loads besides the battle textbox/terrain and the mon pics (for preloading). */
export const EVOLUTION_SCENE_GFX = ['sMovingBackgroundTiles', 'sMovingBackgroundMap1', 'sMovingBackgroundMap2', 'sBlackPalette', 'sBgAnim_Pal', ...EVOLUTION_SPARKLE_GFX];

/** Every species a party mon can evolve into (incl. Shedinja), whose pics the scene may draw. */
export function evolutionTargetSpecies(party: Pokemon[]): number[] {
  const out = new Set<number>();
  for (const mon of party) {
    if (mon.isEgg) continue;
    for (const [, , target] of menusData.evolutions[mon.species] ?? []) out.add(target);
  }
  return [...out];
}

interface EvoInfo {
  preEvoSpriteId: number;
  postEvoSpriteId: number;
  evoTaskId: number;
  /** u8 */
  delayTimer: number;
  savedPalette: Uint16Array;
}

let sEvoStructPtr: EvoInfo | null = null;
let sBgAnimPal: Uint16Array | null = null;

/** gCB2_AfterEvolution */
export let gCB2_AfterEvolution: MainCallback | null = null;
export function setCB2_AfterEvolution(cb: MainCallback | null): void {
  gCB2_AfterEvolution = cb;
}

const evo = () => sEvoStructPtr!;

// sEvoCursorPos (when learning a new move) and sEvoGraphicsTaskId live in gBattleCommunication.
const EVO_CURSOR_POS = 1;
const EVO_GRAPHICS_TASK_ID = 2;
const evoGraphicsTask = () => gTasks[g.battleCommunication[EVO_GRAPHICS_TASK_ID]];

// The below table is used by Task_UpdateBgPalette to control the speed at which the bg color updates.
// The first two values are indexes into sBgAnim_PalIndexes (indirectly, via sBgAnimPal), and are
// the start and end of the range of colors in sBgAnim_PalIndexes it will move through incrementally
// before starting over. It will repeat this cycle x number of times, where x = the 3rd value,
// delaying each increment by y, where y = the 4th value.
// Once it has cycled x number of times, it will move to the next array in this table.
const sBgAnim_PaletteControl = [
  [0, 12, 1, 6],
  [13, 36, 5, 2],
  [13, 24, 1, 2],
  [37, 49, 1, 6],
];

// Indexes into sBgAnim_Pal, 0 is black, transitioning to a bright light blue (172, 213, 255) at 13
const sBgAnim_PalIndexes = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0],
  [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0],
  [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0],
  [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 11, 0, 0],
  [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 0],
  [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 0, 0],
  [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 0, 0],
  [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 0, 0],
  [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 0, 0],
  [0, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 0, 0],
  [0, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 0, 0],
  [0, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 6, 0, 0],
  [0, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 6, 5, 0, 0],
  [0, 10, 11, 12, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 0, 0],
  [0, 11, 12, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 0, 0],
  [0, 12, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 0, 0],
  [0, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0],
  [0, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 0, 0],
  [0, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 0, 0],
  [0, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 0, 0],
  [0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 0, 0],
  [0, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 0, 0],
  [0, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 0, 0],
  [0, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0],
  [0, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0],
  [0, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0],
  [0, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 0],
  [0, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 0],
  [0, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0],
  [0, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0],
  [0, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0],
  [0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0],
  [0, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0],
  [0, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 6, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 5, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

function CB2_BeginEvolutionScene(): void {
  UpdatePaletteFade();
  RunTasks();
}

// Task data
const tState = 0;
const tPreEvoSpecies = 1;
const tPostEvoSpecies = 2;
const tCanStop = 3;
const tBits = 3;
const tLearnsFirstMove = 4;
const tLearnMoveState = 6;
const tLearnMoveYesState = 7;
const tLearnMoveNoState = 8;
const tEvoWasStopped = 9;
const tPartyId = 10;

const TASK_BIT_CAN_STOP = 1 << 0;
const TASK_BIT_LEARN_MOVE = 1 << 7;

function Task_BeginEvolutionScene(taskId: number): void {
  const d = gTasks[taskId].data;
  switch (d[tState]) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
      d[tState]++;
      break;
    case 1:
      if (!gPaletteFade.active) {
        const mon = state.party[d[tPartyId]];
        const postEvoSpecies = d[tPostEvoSpecies];
        const canStopEvo = d[tCanStop];
        const partyId = d[tPartyId];
        DestroyTask(taskId);
        EvolutionScene(mon, postEvoSpecies, canStopEvo, partyId);
      }
      break;
  }
}

/** BeginEvolutionScene: fade out whatever is on screen, then EvolutionScene. */
export function BeginEvolutionScene(_mon: Pokemon, postEvoSpecies: number, canStopEvo: number, partyId: number): void {
  const taskId = CreateTask(Task_BeginEvolutionScene, 0);
  const d = gTasks[taskId].data;
  d[tState] = 0;
  d[tPostEvoSpecies] = postEvoSpecies;
  d[tCanStop] = canStopEvo;
  d[tPartyId] = partyId;
  SetMainCallback2(CB2_BeginEvolutionScene);
}

/** The part of EvolutionScene / CB2_EvolutionSceneLoadGraphics that resets the screen. */
function resetScreenForEvolution(): void {
  SetHBlankCallback(null);
  SetVBlankCallback(null);
  vram.fill(0); // CpuFill32(0, (void *)(VRAM), VRAM_SIZE)

  SetGpuReg(REG_OFFSET_MOSAIC, 0);
  SetGpuReg(REG_OFFSET_WIN0H, 0);
  SetGpuReg(REG_OFFSET_WIN0V, 0);
  SetGpuReg(REG_OFFSET_WIN1H, 0);
  SetGpuReg(REG_OFFSET_WIN1V, 0);
  SetGpuReg(REG_OFFSET_WININ, 0);
  SetGpuReg(REG_OFFSET_WINOUT, 0);

  ResetPaletteFade();

  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  g.battle_BG2_X = 0;
  g.battle_BG2_Y = 0;
  g.battle_BG3_X = 256;
  g.battle_BG3_Y = 0;

  g.battleTerrain = K.BATTLE_TERRAIN_PLAIN;

  InitBattleBgsVideo();
  LoadBattleTextboxAndBackground();
  ResetSpriteData();
}

/** DecompressPicFromTable + the palette and sprite for one of the two mon sprites (pre/post-evo). */
function createEvoMonSprite(mon: Pokemon, species: number, position: number, paletteNum: number): number {
  DecompressPicFromTable(bdata.anims.monFrontPics[species]!, gMonSpritesGfxPtr!.sprites[position]);
  const pokePal = GetMonSpritePalStructFromOtIdPersonality(species, mon.otId, mon.personality);
  LoadPalette(pokePal.data, OBJ_PLTT_ID(paletteNum), PLTT_SIZE_4BPP);

  SetMultiuseSpriteTemplateToPokemon(species, position);
  gMultiuseSpriteTemplate.affineAnims = gDummySpriteAffineAnimTable;
  const id = CreateSprite(gMultiuseSpriteTemplate, 120, 64, 30);
  gSprites[id].callback = SpriteCallbackDummy_2;
  gSprites[id].oam.paletteNum = paletteNum;
  return id;
}

/** EvolutionScene */
export function EvolutionScene(mon: Pokemon, postEvoSpecies: number, canStopEvo: number, partyId: number): void {
  resetScreenForEvolution();
  ScanlineEffect_Stop();
  ResetTasks();
  FreeAllSpritePalettes();

  SetReservedSpritePaletteCount(4);

  sEvoStructPtr = { preEvoSpriteId: 0, postEvoSpriteId: 0, evoTaskId: 0, delayTimer: 0, savedPalette: new Uint16Array(48) };
  AllocateMonSpritesGfx();

  gStringVar1.set(GetMonNickname(mon)); // StringCopy_Nickname
  gStringVar2.set(pokemon.speciesName(postEvoSpecies));

  // preEvo sprite
  const currSpecies = mon.species;
  let id = createEvoMonSprite(mon, currSpecies, K.B_POSITION_OPPONENT_LEFT, 1);
  evo().preEvoSpriteId = id;
  gSprites[id].invisible = true;

  // postEvo sprite
  id = createEvoMonSprite(mon, postEvoSpecies, K.B_POSITION_OPPONENT_RIGHT, 2);
  evo().postEvoSpriteId = id;
  gSprites[id].invisible = true;

  LoadEvoSparkleSpriteAndPal();

  id = evo().evoTaskId = CreateTask(Task_EvolutionScene, 0);
  const d = gTasks[id].data;
  d[tState] = 0;
  d[tPreEvoSpecies] = currSpecies;
  d[tPostEvoSpecies] = postEvoSpecies;
  d[tCanStop] = canStopEvo;
  d[tLearnsFirstMove] = 1;
  d[tEvoWasStopped] = 0;
  d[tPartyId] = partyId;

  evo().savedPalette.set(gPlttBufferUnfaded.subarray(BG_PLTT_ID(2), BG_PLTT_ID(2) + 48));

  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_BG_ALL_ON | DISPCNT_OBJ_1D_MAP);

  SetHBlankCallback(EvoDummyFunc);
  SetVBlankCallback(VBlankCB_EvolutionScene);
  m4aMPlayAllStop();
  // HelpSystem_Disable: no help system
  SetMainCallback2(CB2_EvolutionSceneUpdate);
}

/** CB2_EvolutionSceneLoadGraphics: back from the summary screen (choosing a move to forget). */
function CB2_EvolutionSceneLoadGraphics(): void {
  const d = gTasks[evo().evoTaskId].data;
  const mon = state.party[d[tPartyId]];
  const postEvoSpecies = d[tPostEvoSpecies];

  resetScreenForEvolution();
  FreeAllSpritePalettes();
  SetReservedSpritePaletteCount(4);

  evo().postEvoSpriteId = createEvoMonSprite(mon, postEvoSpecies, K.B_POSITION_OPPONENT_RIGHT, 2);

  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_BG_ALL_ON | DISPCNT_OBJ_1D_MAP);

  SetHBlankCallback(EvoDummyFunc);
  SetVBlankCallback(VBlankCB_EvolutionScene);
  SetMainCallback2(CB2_EvolutionSceneUpdate);

  BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, RGB_BLACK);

  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
}

function CB2_EvolutionSceneUpdate(): void {
  AnimateSprites();
  BuildOamBuffer();
  RunTextPrinters();
  UpdatePaletteFade();
  RunTasks();
}

/** CreateShedinja: Nincada leaves a Shedinja behind if there's room in the party. */
function CreateShedinja(preEvoSpecies: number, mon: Pokemon): void {
  const evos = menusData.evolutions[preEvoSpecies];
  if (evos?.[0]?.[0] === K.EVO_LEVEL_NINJASK && state.party.length < K.PARTY_SIZE) {
    const target = evos[1][2];
    const shedinja: Pokemon = structuredClone(mon); // CopyMon
    shedinja.species = target;
    shedinja.nickname = [...pokemon.speciesName(target)];
    shedinja.heldItem = 0;
    // MON_DATA_MARKINGS, ribbons and mail aren't modelled
    shedinja.status = 0;
    calculateMonStats(shedinja);
    state.party.push(shedinja); // CalculatePlayerPartyCount

    handleSetPokedexFlag(speciesToNationalPokedexNum(target), K.FLAG_SET_SEEN);
    handleSetPokedexFlag(speciesToNationalPokedexNum(target), K.FLAG_SET_CAUGHT);
    // The Japanese-language Shedinja name: every mon here is English
  }
}

/** EvolutionRenameMon: a mon still named after its species takes the new species' name. */
function EvolutionRenameMon(mon: Pokemon, oldSpecies: number, newSpecies: number): void {
  // language == GAME_LANGUAGE: every mon here is English
  const oldName = pokemon.speciesName(oldSpecies);
  const name = mon.nickname;
  if (name.length === oldName.length && name.every((c, i) => c === oldName[i])) mon.nickname = [...pokemon.speciesName(newSpecies)];
}

/** BattlePutTextOnWindow(gBattleStringsTable[stringId - BATTLESTRINGS_TABLE_START]) after expanding it */
function putBattleString(stringId: number): void {
  battleStringExpandPlaceholdersToDisplayedString(gBattleStringsTable(stringId));
  BattlePutTextOnWindow(g.displayedStringBattle, K.B_WIN_MSG);
}

// States for the main switch in Task_EvolutionScene
const EVOSTATE_FADE_IN = 0;
const EVOSTATE_INTRO_MSG = 1;
const EVOSTATE_INTRO_MON_ANIM = 2;
const EVOSTATE_INTRO_SOUND = 3;
const EVOSTATE_START_MUSIC = 4;
const EVOSTATE_START_BG_AND_SPARKLE_SPIRAL = 5;
const EVOSTATE_SPARKLE_ARC = 6;
const EVOSTATE_CYCLE_MON_SPRITE = 7;
const EVOSTATE_WAIT_CYCLE_MON_SPRITE = 8;
const EVOSTATE_SPARKLE_CIRCLE = 9;
const EVOSTATE_SPARKLE_SPRAY = 10;
const EVOSTATE_EVO_SOUND = 11;
const EVOSTATE_RESTORE_SCREEN = 12;
const EVOSTATE_EVO_MON_ANIM = 13;
const EVOSTATE_SET_MON_EVOLVED = 14;
const EVOSTATE_TRY_LEARN_MOVE = 15;
const EVOSTATE_END = 16;
const EVOSTATE_CANCEL = 17;
const EVOSTATE_CANCEL_MON_ANIM = 18;
const EVOSTATE_CANCEL_MSG = 19;
const EVOSTATE_LEARNED_MOVE = 20;
const EVOSTATE_TRY_LEARN_ANOTHER_MOVE = 21;
const EVOSTATE_REPLACE_MOVE = 22;

// States for the switch in EVOSTATE_REPLACE_MOVE
const MVSTATE_INTRO_MSG_1 = 0;
const MVSTATE_INTRO_MSG_2 = 1;
const MVSTATE_INTRO_MSG_3 = 2;
const MVSTATE_PRINT_YES_NO = 3;
const MVSTATE_HANDLE_YES_NO = 4;
const MVSTATE_SHOW_MOVE_SELECT = 5;
const MVSTATE_HANDLE_MOVE_SELECT = 6;
const MVSTATE_FORGET_MSG_1 = 7;
const MVSTATE_FORGET_MSG_2 = 8;
const MVSTATE_LEARNED_MOVE = 9;
const MVSTATE_ASK_CANCEL = 10;
const MVSTATE_CANCEL = 11;
const MVSTATE_RETRY_AFTER_HM = 12;

const WINDOW_CLEAR = 1;

/** Overworld_PlaySpecialMapMusic. battle-test.html has no field, so there the map music just stays stopped. */
function playSpecialMapMusic(): void {
  if (hasOverworldMusicHost()) Overworld_PlaySpecialMapMusic();
}

function Task_EvolutionScene(taskId: number): void {
  const d = gTasks[taskId].data;
  const mon = state.party[d[tPartyId]];
  const mc = g.battleCommunication;

  // Automatically cancel if the Pokemon would evolve into a species you have not
  // yet unlocked, such as Crobat.
  if (!IsNationalPokedexEnabled(state) && d[tState] === EVOSTATE_WAIT_CYCLE_MON_SPRITE && d[tPostEvoSpecies] > K.SPECIES_MEW) {
    d[tState] = EVOSTATE_CANCEL;
    d[tEvoWasStopped] = 1;
    evoGraphicsTask().data[EVO_GRAPHICS_TASK_EVO_STOP] = 1;
    StopBgAnimation();
    return;
  }

  // check if B Button was held, so the evolution gets stopped
  if (gMain.heldKeys === B_BUTTON && d[tState] === EVOSTATE_WAIT_CYCLE_MON_SPRITE && evoGraphicsTask().isActive && d[tBits] & TASK_BIT_CAN_STOP) {
    d[tState] = EVOSTATE_CANCEL;
    evoGraphicsTask().data[EVO_GRAPHICS_TASK_EVO_STOP] = 1;
    StopBgAnimation();
    return;
  }

  switch (d[tState]) {
    case EVOSTATE_FADE_IN:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, RGB_BLACK);
      gSprites[evo().preEvoSpriteId].invisible = false;
      d[tState]++;
      ShowBg(0);
      ShowBg(1);
      ShowBg(2);
      ShowBg(3);
      break;
    case EVOSTATE_INTRO_MSG:
      if (!gPaletteFade.active) {
        ExpandToStringVar4(encodeBattleText('gText_PkmnIsEvolving'));
        BattlePutTextOnWindow(gStringVar4, K.B_WIN_MSG);
        d[tState]++;
      }
      break;
    case EVOSTATE_INTRO_MON_ANIM:
      if (!IsTextPrinterActive(0)) {
        PlayCry_Normal(d[tPreEvoSpecies], 0);
        d[tState]++;
      }
      break;
    case EVOSTATE_INTRO_SOUND:
      if (IsCryFinished()) {
        // wait for animation, play tu du SE
        PlaySE(K.MUS_EVOLUTION_INTRO);
        d[tState]++;
      }
      break;
    case EVOSTATE_START_MUSIC:
      if (!IsSEPlaying()) {
        // Start music, fade background to black
        PlayNewMapMusic(K.MUS_EVOLUTION);
        d[tState]++;
        BeginNormalPaletteFade(0x1c, 4, 0, 0x10, RGB_BLACK);
      }
      break;
    case EVOSTATE_START_BG_AND_SPARKLE_SPIRAL:
      if (!gPaletteFade.active) {
        StartBgAnimation(false);
        mc[EVO_GRAPHICS_TASK_ID] = EvolutionSparkles_SpiralUpward(17);
        d[tState]++;
      }
      break;
    case EVOSTATE_SPARKLE_ARC:
      if (!evoGraphicsTask().isActive) {
        d[tState]++;
        evo().delayTimer = 1;
        mc[EVO_GRAPHICS_TASK_ID] = EvolutionSparkles_ArcDown();
      }
      break;
    case EVOSTATE_CYCLE_MON_SPRITE:
      if (!evoGraphicsTask().isActive) {
        mc[EVO_GRAPHICS_TASK_ID] = CycleEvolutionMonSprite(evo().preEvoSpriteId, evo().postEvoSpriteId);
        d[tState]++;
      }
      break;
    case EVOSTATE_WAIT_CYCLE_MON_SPRITE:
      evo().delayTimer = (evo().delayTimer - 1) & 0xff;
      if (evo().delayTimer === 0) {
        evo().delayTimer = 3;
        if (!evoGraphicsTask().isActive) d[tState]++;
      }
      break;
    case EVOSTATE_SPARKLE_CIRCLE:
      mc[EVO_GRAPHICS_TASK_ID] = EvolutionSparkles_CircleInward();
      d[tState]++;
      break;
    case EVOSTATE_SPARKLE_SPRAY:
      if (!evoGraphicsTask().isActive) {
        mc[EVO_GRAPHICS_TASK_ID] = EvolutionSparkles_SprayAndFlash(d[tPostEvoSpecies]);
        d[tState]++;
      }
      break;
    case EVOSTATE_EVO_SOUND:
      if (!evoGraphicsTask().isActive) {
        PlaySE(K.SE_EXP);
        d[tState]++;
      }
      break;
    case EVOSTATE_RESTORE_SCREEN:
      // SE_EXP's first tick is the end of the frame it was started in, so this holds from the frame after it on
      if (IsSEPlaying()) {
        m4aMPlayAllStop();
        gPlttBufferUnfaded.set(evo().savedPalette, BG_PLTT_ID(2));
        RestoreBgAfterAnim();
        BeginNormalPaletteFade(0x1c, 0, 0x10, 0, RGB_BLACK);
        d[tState]++;
      }
      break;
    case EVOSTATE_EVO_MON_ANIM:
      if (!gPaletteFade.active) {
        PlayCry_Normal(d[tPostEvoSpecies], 0);
        d[tState]++;
      }
      break;
    case EVOSTATE_SET_MON_EVOLVED:
      if (IsCryFinished()) {
        ExpandToStringVar4(encodeBattleText('gText_CongratsPkmnEvolved'));
        BattlePutTextOnWindow(gStringVar4, K.B_WIN_MSG);
        PlayBGM(K.MUS_EVOLVED);
        d[tState]++;
        mon.species = d[tPostEvoSpecies];
        calculateMonStats(mon);
        EvolutionRenameMon(mon, d[tPreEvoSpecies], d[tPostEvoSpecies]);
        handleSetPokedexFlag(speciesToNationalPokedexNum(d[tPostEvoSpecies]), K.FLAG_SET_SEEN);
        handleSetPokedexFlag(speciesToNationalPokedexNum(d[tPostEvoSpecies]), K.FLAG_SET_CAUGHT);
        // IncrementGameStat(GAME_STAT_EVOLVED_POKEMON): game stats aren't tracked yet
        testEvent('evolution', { from: d[tPreEvoSpecies], to: d[tPostEvoSpecies], stopped: false });
      }
      break;
    case EVOSTATE_TRY_LEARN_MOVE:
      if (!IsTextPrinterActive(0)) {
        // HelpSystem_Enable
        const learn = monTryLearningNewMove(mon, !!d[tLearnsFirstMove]);
        if (learn !== K.MOVE_NONE && !d[tEvoWasStopped]) {
          StopMapMusic();
          playSpecialMapMusic();
          d[tBits] |= TASK_BIT_LEARN_MOVE;
          d[tLearnsFirstMove] = 0;
          d[tLearnMoveState] = MVSTATE_INTRO_MSG_1;
          setBattleTextBuff1Nickname(mon);

          if (learn === K.MON_HAS_MAX_MOVES) d[tState] = EVOSTATE_REPLACE_MOVE;
          else if (learn === K.MON_ALREADY_KNOWS_MOVE) break;
          else d[tState] = EVOSTATE_LEARNED_MOVE;
        } else {
          // no move to learn, or evolution was canceled
          BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
          d[tState]++;
        }
      }
      break;
    case EVOSTATE_END:
      if (!gPaletteFade.active) {
        if (!(d[tBits] & TASK_BIT_LEARN_MOVE)) {
          StopMapMusic();
          playSpecialMapMusic();
        }
        if (!d[tEvoWasStopped]) CreateShedinja(d[tPreEvoSpecies], mon);

        DestroyTask(taskId);
        FreeMonSpritesGfx();
        sEvoStructPtr = null;
        FreeAllWindowBuffers();
        SetMainCallback2(gCB2_AfterEvolution);
      }
      break;
    case EVOSTATE_CANCEL:
      if (!evoGraphicsTask().isActive) {
        m4aMPlayAllStop();
        BeginNormalPaletteFade(0x6001c, 0, 0x10, 0, RGB_WHITE);
        d[tState]++;
      }
      break;
    case EVOSTATE_CANCEL_MON_ANIM:
      if (!gPaletteFade.active) {
        PlayCry_Normal(d[tPreEvoSpecies], 0);
        d[tState]++;
      }
      break;
    case EVOSTATE_CANCEL_MSG:
      if (IsCryFinished()) {
        if (d[tEvoWasStopped]) ExpandToStringVar4(encodeBattleText('gText_EllipsisQuestionMark'));
        else ExpandToStringVar4(encodeBattleText('gText_PkmnStoppedEvolving'));

        BattlePutTextOnWindow(gStringVar4, K.B_WIN_MSG);
        testEvent('evolution', { from: d[tPreEvoSpecies], to: d[tPostEvoSpecies], stopped: true });
        d[tEvoWasStopped] = 1;
        d[tState] = EVOSTATE_TRY_LEARN_MOVE;
      }
      break;
    case EVOSTATE_LEARNED_MOVE:
      if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
        bufferMoveToLearnIntoBattleTextBuff2();
        PlayFanfare(K.MUS_LEVEL_UP);
        putBattleString(K.STRINGID_PKMNLEARNEDMOVE);
        d[tLearnsFirstMove] = 0x40; // re-used as a counter
        d[tState]++;
      }
      break;
    case EVOSTATE_TRY_LEARN_ANOTHER_MOVE:
      if (!IsTextPrinterActive(0) && !IsSEPlaying() && --d[tLearnsFirstMove] === 0) d[tState] = EVOSTATE_TRY_LEARN_MOVE;
      break;
    case EVOSTATE_REPLACE_MOVE:
      switch (d[tLearnMoveState]) {
        case MVSTATE_INTRO_MSG_1:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            // "{mon} is trying to learn {move}"
            bufferMoveToLearnIntoBattleTextBuff2();
            putBattleString(K.STRINGID_TRYTOLEARNMOVE1);
            d[tLearnMoveState]++;
          }
          break;
        case MVSTATE_INTRO_MSG_2:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            // "But, {mon} can't learn more than four moves"
            putBattleString(K.STRINGID_TRYTOLEARNMOVE2);
            d[tLearnMoveState]++;
          }
          break;
        case MVSTATE_INTRO_MSG_3:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            // "Delete a move to make room for {move}?"
            putBattleString(K.STRINGID_TRYTOLEARNMOVE3);
            d[tLearnMoveYesState] = MVSTATE_SHOW_MOVE_SELECT;
            d[tLearnMoveNoState] = MVSTATE_ASK_CANCEL;
            d[tLearnMoveState]++;
          }
        // fallthrough (no break in the C)
        case MVSTATE_PRINT_YES_NO:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            HandleBattleWindow(23, 8, 29, 13, 0);
            BattlePutTextOnWindow(encodeBattleText('gText_BattleYesNoChoice'), K.B_WIN_YESNO);
            d[tLearnMoveState]++;
            mc[EVO_CURSOR_POS] = 0;
            BattleCreateYesNoCursorAt(mc[EVO_CURSOR_POS]);
          }
          break;
        case MVSTATE_HANDLE_YES_NO:
          // This Yes/No is used for both the initial "delete move?" prompt
          // and for the "stop learning move?" prompt
          // What Yes/No do next is determined by tLearnMoveYesState / tLearnMoveNoState
          if (JOY_NEW(DPAD_UP) && mc[EVO_CURSOR_POS] !== 0) {
            // Moved onto YES
            PlaySE(K.SE_SELECT);
            BattleDestroyYesNoCursorAt(mc[EVO_CURSOR_POS]);
            mc[EVO_CURSOR_POS] = 0;
            BattleCreateYesNoCursorAt(mc[EVO_CURSOR_POS]);
          }
          if (JOY_NEW(DPAD_DOWN) && mc[EVO_CURSOR_POS] === 0) {
            // Moved onto NO
            PlaySE(K.SE_SELECT);
            BattleDestroyYesNoCursorAt(mc[EVO_CURSOR_POS]);
            mc[EVO_CURSOR_POS] = 1;
            BattleCreateYesNoCursorAt(mc[EVO_CURSOR_POS]);
          }
          if (JOY_NEW(A_BUTTON)) {
            HandleBattleWindow(0x17, 8, 0x1d, 0xd, WINDOW_CLEAR);
            PlaySE(K.SE_SELECT);

            if (mc[EVO_CURSOR_POS] !== 0) {
              // NO
              d[tLearnMoveState] = d[tLearnMoveNoState];
            } else {
              // YES
              d[tLearnMoveState] = d[tLearnMoveYesState];
              if (d[tLearnMoveState] === MVSTATE_SHOW_MOVE_SELECT) BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
            }
          }
          if (JOY_NEW(B_BUTTON)) {
            // Equivalent to selecting NO
            HandleBattleWindow(0x17, 8, 0x1d, 0xd, WINDOW_CLEAR);
            PlaySE(K.SE_SELECT);
            d[tLearnMoveState] = d[tLearnMoveNoState];
          }
          break;
        case MVSTATE_SHOW_MOVE_SELECT:
          if (!gPaletteFade.active) {
            FreeAllWindowBuffers();
            ShowSelectMovePokemonSummaryScreen(state.party, d[tPartyId], state.party.length - 1, CB2_EvolutionSceneLoadGraphics, g.moveToLearn);
            d[tLearnMoveState]++;
          }
          break;
        case MVSTATE_HANDLE_MOVE_SELECT:
          if (!gPaletteFade.active && gMain.callback2 === CB2_EvolutionSceneUpdate) {
            const slot = GetMoveSlotToReplace();
            if (slot === K.MAX_MON_MOVES) {
              // Didn't select move slot
              d[tLearnMoveState] = MVSTATE_ASK_CANCEL;
            } else {
              // Selected move to forget
              const move = mon.moves[slot];
              if (isHMMove2(move)) {
                // Can't forget HMs
                putBattleString(K.STRINGID_HMMOVESCANTBEFORGOTTEN);
                d[tLearnMoveState] = MVSTATE_RETRY_AFTER_HM;
              } else {
                // Forget move
                prepareMoveBuffer(g.battleTextBuff2, move);

                removeMonPPBonus(mon, slot);
                setMonMoveSlot(mon, g.moveToLearn, slot);
                d[tLearnMoveState]++;
              }
            }
          }
          break;
        case MVSTATE_FORGET_MSG_1:
          putBattleString(K.STRINGID_123POOF);
          d[tLearnMoveState]++;
          break;
        case MVSTATE_FORGET_MSG_2:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            putBattleString(K.STRINGID_PKMNFORGOTMOVE);
            d[tLearnMoveState]++;
          }
          break;
        case MVSTATE_LEARNED_MOVE:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) {
            putBattleString(K.STRINGID_ANDELLIPSIS);
            d[tState] = EVOSTATE_LEARNED_MOVE;
          }
          break;
        case MVSTATE_ASK_CANCEL:
          putBattleString(K.STRINGID_STOPLEARNINGMOVE);
          d[tLearnMoveYesState] = MVSTATE_CANCEL;
          d[tLearnMoveNoState] = MVSTATE_INTRO_MSG_1;
          d[tLearnMoveState] = MVSTATE_PRINT_YES_NO;
          break;
        case MVSTATE_CANCEL:
          putBattleString(K.STRINGID_DIDNOTLEARNMOVE);
          d[tState] = EVOSTATE_TRY_LEARN_MOVE;
          break;
        case MVSTATE_RETRY_AFTER_HM:
          if (!IsTextPrinterActive(0) && !IsSEPlaying()) d[tLearnMoveState] = MVSTATE_SHOW_MOVE_SELECT;
          break;
      }
      break;
  }
}

/** StringCopy_Nickname(gBattleTextBuff1, nickname) */
function setBattleTextBuff1Nickname(mon: Pokemon): void {
  const buf = g.battleTextBuff1;
  buf.fill(EOS);
  buf.set(GetMonNickname(mon).slice(0, buf.length));
}

function EvoDummyFunc(): void {}

function VBlankCB_EvolutionScene(): void {
  SetGpuReg(REG_OFFSET_BG0HOFS, g.battle_BG0_X);
  SetGpuReg(REG_OFFSET_BG0VOFS, g.battle_BG0_Y);
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  SetGpuReg(REG_OFFSET_BG2HOFS, g.battle_BG2_X);
  SetGpuReg(REG_OFFSET_BG2VOFS, g.battle_BG2_Y);
  SetGpuReg(REG_OFFSET_BG3HOFS, g.battle_BG3_X);
  SetGpuReg(REG_OFFSET_BG3VOFS, g.battle_BG3_Y);

  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  ScanlineEffect_InitHBlankDmaTransfer();
}

// Task data for Task_UpdateBgPalette
const tCycleTimer = 0;
const tPalStage = 1;
const tControlStage = 2;
const tNumCycles = 3;
const tStartTimer = 5;
const tPaused = 6;

// Cycles the background through a set range of palettes in a series
// of stages, each stage having a different palette range and timing
function Task_UpdateBgPalette(taskId: number): void {
  const data = gTasks[taskId].data;
  // See comments above sBgAnim_PaletteControl. Past the last stage these read past the end of the
  // table in the C (the task is destroyed right after), which gives 0 here.
  const control = () => sBgAnim_PaletteControl[data[tControlStage]] ?? [0, 0, 0, 0];

  if (data[tPaused]) return;
  if (data[tStartTimer]++ < 20) return;

  if (data[tCycleTimer]++ > control()[3]) {
    if (control()[1] === data[tPalStage]) {
      // Reached final palette in current stage, completed a 'cycle'
      // If this is the final cycle for this stage, move to the next stage
      data[tNumCycles]++;
      if (data[tNumCycles] === control()[2]) {
        data[tNumCycles] = 0;
        data[tControlStage]++;
      }
      data[tPalStage] = control()[0];
    } else {
      // Haven't reached final palette in current stage, load the current palette
      LoadPalette(sBgAnimPal!.subarray(data[tPalStage] * 16, data[tPalStage] * 16 + 16), BG_PLTT_ID(10), PLTT_SIZE_4BPP);
      data[tCycleTimer] = 0;
      data[tPalStage]++;
    }
  }

  if (data[tControlStage] === sBgAnim_PaletteControl[0].length) DestroyTask(taskId);
}

const tIsLink = 2;

function CreateBgAnimTask(isLink: boolean): void {
  const taskId = CreateTask(Task_AnimateBg, 7);
  gTasks[taskId].data[tIsLink] = isLink ? 1 : 0;
}

function Task_AnimateBg(taskId: number): void {
  const d = gTasks[taskId].data;
  // inner: BG1; outer: BG2 (BG3 for a link trade)
  const setOuter = d[tIsLink]
    ? (x: number, y: number) => {
        g.battle_BG3_X = x;
        g.battle_BG3_Y = y;
      }
    : (x: number, y: number) => {
        g.battle_BG2_X = x;
        g.battle_BG2_Y = y;
      };

  d[0] = (d[0] + 5) & 0xff;
  d[1] = (d[0] + 0x80) & 0xff;

  g.battle_BG1_X = Cos(d[0], 4) + 8;
  g.battle_BG1_Y = Sin(d[0], 4) + 16;

  setOuter(Cos(d[1], 4) + 8, Sin(d[1], 4) + 16);

  if (!FuncIsActiveTask(Task_UpdateBgPalette)) {
    DestroyTask(taskId);

    g.battle_BG1_X = 0;
    g.battle_BG1_Y = 0;

    setOuter(256, 0);
  }
}

function InitMovingBgPalette(palette: Uint16Array): void {
  const pal = gfx16('sBgAnim_Pal');
  for (let i = 0; i < sBgAnim_PalIndexes.length; i++) {
    for (let j = 0; j < 16; j++) palette[i * 16 + j] = pal[sBgAnim_PalIndexes[i][j]];
  }
}

function StartBgAnimation(isLink: boolean): void {
  sBgAnimPal = new Uint16Array(0x640 / 2);
  InitMovingBgPalette(sBgAnimPal);

  const innerBgId = 1;
  const outerBgId = isLink ? 3 : 2;

  LoadPalette(gfx16('sBlackPalette'), BG_PLTT_ID(10), PLTT_SIZE_4BPP);

  const tiles = gfx('sMovingBackgroundTiles');
  LoadBgTiles(1, tiles, tiles.length, 0); // DecompressAndLoadBgGfxUsingHeap
  CopyToBgTilemapBuffer(1, gfx16('sMovingBackgroundMap1'), 0, 0);
  CopyToBgTilemapBuffer(outerBgId, gfx16('sMovingBackgroundMap2'), 0, 0);
  CopyBgTilemapBufferToVram(1);
  CopyBgTilemapBufferToVram(outerBgId);

  if (!isLink) {
    SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG2);
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(8, 8));
    SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_BG2_ON | DISPCNT_BG1_ON | DISPCNT_BG0_ON | DISPCNT_OBJ_1D_MAP);

    SetBgAttribute(innerBgId, BG_ATTR_PRIORITY, 2);
    SetBgAttribute(outerBgId, BG_ATTR_PRIORITY, 2);

    ShowBg(1);
    ShowBg(2);
  }
  // (the link-trade branch, BLDCNT_TGT2_BG3 / BG3 on, isn't used: no trading)

  CreateTask(Task_UpdateBgPalette, 5);
  CreateBgAnimTask(isLink);
}

/** IsMovingBackgroundTaskRunning: despite the name, pauses the bg palette cycling and blacks it out. */
export function IsMovingBackgroundTaskRunning(): void {
  const taskId = FindTaskIdByFunc(Task_UpdateBgPalette);
  if (taskId !== TASK_NONE) gTasks[taskId].data[tPaused] = 1;
  FillPalette(RGB_BLACK, BG_PLTT_ID(10), PLTT_SIZE_4BPP);
}

function StopBgAnimation(): void {
  let taskId: number;
  if ((taskId = FindTaskIdByFunc(Task_UpdateBgPalette)) !== TASK_NONE) DestroyTask(taskId);
  if ((taskId = FindTaskIdByFunc(Task_AnimateBg)) !== TASK_NONE) DestroyTask(taskId);

  FillPalette(RGB_BLACK, BG_PLTT_ID(10), PLTT_SIZE_4BPP);
  RestoreBgAfterAnim();
}

function RestoreBgAfterAnim(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  g.battle_BG1_X = 0;
  g.battle_BG1_Y = 0;
  g.battle_BG2_X = 0;
  SetBgAttribute(1, BG_ATTR_PRIORITY, gBattleBgTemplates[1].priority); // GetBattleBgTemplateData(1, 5)
  SetBgAttribute(2, BG_ATTR_PRIORITY, gBattleBgTemplates[2].priority);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_BG3_ON | DISPCNT_BG0_ON | DISPCNT_OBJ_1D_MAP);
  sBgAnimPal = null; // Free
}
