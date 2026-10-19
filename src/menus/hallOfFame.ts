// hall_of_fame.c on the GBA layer: the Hall of Fame screen after the Champion (CB2_DoHallOfFameScreen: the party's
// record is saved with the game, the mons come on one by one, "Welcome to the HALL OF FAME!" with confetti, then
// the player and the trainer info window) and the Hall of Fame PC (CB2_InitHofPC: the saved teams, newest first).
// Plus post_battle_event_funcs.c's EnterHallOfFame, which sets up the screen, and hof_pc.c's return to the PC menu.
//
// The screen runs on whichever GBA host is up (FieldMenuScene 'hallOfFame' / 'hallOfFamePc'); `hofEnv` is what it
// needs from outside: saving, and where it goes when it's done (SetWarpsToRollCredits' warp, ReturnFromHallOfFamePC).
// The sounds are the C's through gba/sound.ts: MUS_HALL_OF_FAME, SE_SAVE, the cries (no wait on them: the per-mon
// timers run alongside), SE_APPLAUSE, FadeOutBGM(4) and the credits warp's DoWarp music fade and wait.

import { K } from '../battle/constants';
import { bdata, pokemon, state } from '../battle/env';
import { monPalSymbols, monPicSymbol } from '../battle/gfx';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEADING_ZEROS, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import { gSineTable } from '../battle/trig';
import { testEvent } from '../dev/testHooks';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect_Palette0,
  HideBg,
  InitBgsFromTemplates,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  UnsetBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT2_ALL,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  PALETTES_ALL,
  PALETTES_OBJECTS,
  pltt,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  RGB,
  RGB_BLACK,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import {
  AddTextPrinterParameterized2,
  ClearDialogWindowAndFrame,
  DecompressAndCopyTileDataToVram,
  DrawDialogueFrame,
  DrawStdFrameWithCustomTileAndPalette,
  FreeTempTileDataBuffersIfPossible,
  InitStandardTextBoxWindows,
  InitTextBoxGfxAndPrinters,
  LoadStdWindowGfx,
  ResetTempTileDataBuffers,
  TEXT_COLOR_DARK_GRAY,
  TEXT_COLOR_LIGHT_GRAY,
  TEXT_COLOR_WHITE,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, BlendPalettesUnfaded, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import {
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadCompressedSpritePalette,
  LoadCompressedSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetOamRange,
  ResetSpriteData,
  SetReservedSpritePaletteCount,
  SPRITE_SHAPE,
  StartSpriteAnim,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  CopyWindowToVram,
  COPYWIN_FULL,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  FONTATTR_LETTER_SPACING,
  PIXEL_FILL,
  PutWindowTilemap,
  RunTextPrinters,
  type WindowTemplate,
} from '../gba/window';
import type { GameState } from '../state/GameState';
import { ClearHofBuffer, emptyHofTeam, gHofBuffer, HALL_OF_FAME_MAX_TEAMS, LoadHallOfFameSave, type HallofFameMon, type HallofFameTeam } from '../state/hallOfFame';
import { SAVE_HALL_OF_FAME, SAVE_STATUS_OK, SetContinueGameWarpStatus } from '../state/save';
import { random } from '../util/random';
import { charmap } from '../battle/env';
import { FONT_NORMAL } from '../text/Font';
import { EOS, GetMonNickname, gStringVar1, speciesName, StringExpandPlaceholders, text } from './common';
import { CreateMonPicSprite_HandleDeoxys, CreateTrainerPicSprite, FreeAndDestroyMonPicSprite, FreeAndDestroyTrainerPicSprite, PlayerGenderToFrontTrainerPicId, ResetAllPicSprites } from './picSprites';
import { BeginPCScreenEffect_TurnOff, BeginPCScreenEffect_TurnOn, IsPCScreenEffectRunning_TurnOff, IsPCScreenEffectRunning_TurnOn } from './pcScreenEffect';
import { CreateTopBarWindowLoadPalette, DestroyTopBarWindow, TopBarWindowPrintString, TopBarWindowPrintTwoStrings } from '../gba/topBarWindow';
import { gMPlayInfo_BGM, m4aMPlayVolumeControl } from '../audio/m4a';
import { TRACKS_ALL } from '../audio/m4aInternal';
import {
  BGMusicStopped,
  FadeOutBGM,
  IsCryPlayingOrClearCrySongs,
  MUSIC_DISABLE_KEEP,
  PlayBGM,
  PlayCry_Normal,
  PlaySE,
  SetDisableMapMusicChangeOnMapLoad,
  StopCryAndClearCrySongs,
} from '../gba/sound';
import { TryFadeOutOldMapMusic, type MapMusicHeader } from '../gba/overworldMusic';

const PARTY_SIZE = 6;
const HALL_OF_FAME_BG_PAL = RGB(22, 24, 29);
const TAG_CONFETTI = 1001;
const KANTO_SPECIES_END = 151;

/** What the Hall of Fame screens need from outside hall_of_fame.c. */
export const hofEnv = {
  /** TrySavingData(saveType): the field has stored the player's location already. Returns SAVE_STATUS_*. */
  trySavingData: (_saveType: number): number => SAVE_STATUS_OK,
  /** SetWarpDestination(mapId, warpId, x, y) + DoWarp + ResetInitialPlayerAvatarState: off the GBA layer into the map. */
  doWarp: (_mapId: string, _warpId: number, _x: number, _y: number): void => {},
  /** GetDestinationWarpMapHeader for DoWarp's TryFadeOutOldMapMusic (loaded: the port's map headers aren't in ROM). */
  loadMapHeader: (_mapId: string): Promise<MapMusicHeader | undefined> => Promise.resolve(undefined),
  /** ReturnFromHallOfFamePC: CB2_ReturnToField with gFieldCallback = ReshowPCMenuAfterHallOfFamePC. */
  returnFromHallOfFamePC: (): void => {},
};

// ------------------------------------------------------------------ EWRAM

/** sSelectedPaletteIndices */
let sSelectedPaletteIndices = 0;
/** sHofMonPtr: the team being shown (CB2_DoHallOfFameScreen) or every saved team (the PC). */
let sHofMonPtr: HallofFameTeam[] | null = null;
/** sHofGfxPtr */
let sHofGfxPtr: { state: number; tilemap1: Uint16Array; tilemap2: Uint16Array } | null = null;

// ------------------------------------------------------------------ data

const sHof_BgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

const sWindowTemplate: WindowTemplate = { bg: 0, tilemapLeft: 2, tilemapTop: 2, width: 17, height: 6, paletteNum: 13, baseBlock: 0x001 };

const sTextColors = [
  [0, 1, 2],
  [0, 2, 3],
  [4, 5, 0],
];

/** sHallOfFame_MonFullTeamPositions: [srcX, srcY, dstX, dstY] */
const sHallOfFame_MonFullTeamPositions = [
  [120, 210, 120, 40],
  [326, 220, 56, 40],
  [-86, 220, 184, 40],
  [120, -62, 120, 88],
  [-70, -92, 200, 88],
  [310, -92, 40, 88],
];

const sHallOfFame_MonHalfTeamPositions = [
  [120, 234, 120, 64],
  [326, 244, 56, 64],
  [-86, 244, 184, 64],
];

/** sSpriteTemplate_Confetti: 17 one-frame anims (sAnimCmd_Frame00..16), each tile of the sheet. */
const sSpriteTemplate_Confetti = (): SpriteTemplate => {
  const [shape, size] = SPRITE_SHAPE['8x8'];
  return {
    tileTag: TAG_CONFETTI,
    paletteTag: TAG_CONFETTI,
    oam: oam({ shape, size }),
    anims: Array.from({ length: 17 }, (_, i) => [ANIMCMD_FRAME(i, 30), ANIMCMD_END]),
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_Confetti,
  };
};

/** The graphics the Hall of Fame screens draw (preload before CB2_DoHallOfFameScreen / CB2_InitHofPC). */
export function hallOfFameGfxSymbols(teams: HallofFameTeam[], playerGender: number): string[] {
  const syms = new Set(['sHallOfFame_Pal', 'sHallOfFame_Gfx', 'gFile_graphics_misc_confetti_sheet', 'gFile_graphics_misc_confetti_palette']);
  for (const team of teams) {
    for (const mon of team) {
      if (!mon.species) continue;
      syms.add(monPicSymbol(true, mon.species, mon.personality));
      for (const p of monPalSymbols(mon.species)) syms.add(p);
    }
  }
  const pic = PlayerGenderToFrontTrainerPicId(playerGender);
  syms.add(bdata.anims.trainerFrontPics[pic]!.pic);
  syms.add(bdata.anims.trainerFrontPalettes[pic]!);
  return [...syms];
}

/** The party as Task_Hof_InitMonData records it (for preloading its pics). */
export function partyHallOfFameTeam(gs: GameState): HallofFameTeam {
  const team = emptyHofTeam();
  gs.party.forEach((mon, i) => {
    if (i >= PARTY_SIZE || !mon.species) return;
    const nick = GetMonNickname(mon);
    team[i] = {
      species: mon.isEgg ? K.SPECIES_EGG : mon.species, // MON_DATA_SPECIES_OR_EGG
      tid: mon.otId >>> 0,
      personality: mon.personality >>> 0,
      lvl: mon.level & 0x7f,
      nick: nick.slice(0, 10),
    };
  });
  return team;
}

// PlayerGenderToFrontTrainerPicId is trainer_pokemon_sprites.c's (menus/picSprites.ts).
export { PlayerGenderToFrontTrainerPicId };

function playerGender(): number {
  return state.playerGender === 'female' ? K.FEMALE : K.MALE;
}

// ------------------------------------------------------------------ post_battle_event_funcs.c

/**
 * EnterHallOfFame (special): heal the party, FLAG_SYS_GAME_CLEAR (gHasHallOfFameRecords says whether it was set
 * already), the first entry's play time, and CONTINUE from Pallet Town from now on. The Champion Ribbons aren't
 * given (the port's mons have no ribbons; REVISION 0 gives no event tickets either). The caller then runs
 * CB2_DoHallOfFameScreen. `palletTown` is gHealLocations[HEAL_LOCATION_PALLET_TOWN - 1].
 */
export function EnterHallOfFame(gs: GameState, palletTown: { map: string; x: number; y: number }, healPlayerParty: () => void): void {
  healPlayerParty();
  gHasHallOfFameRecords = gs.getFlag('FLAG_SYS_GAME_CLEAR');
  if (!gHasHallOfFameRecords) gs.setFlag('FLAG_SYS_GAME_CLEAR', true);
  const firstHofPlayTime = gs.defines.require('GAME_STAT_FIRST_HOF_PLAY_TIME');
  if (gs.getGameStat(firstHofPlayTime) === 0) {
    const t = gs.playTime;
    gs.setGameStat(firstHofPlayTime, (t.hours << 16) | (t.minutes << 8) | t.seconds);
  }
  SetContinueGameWarpStatus(gs);
  // SetContinueGameWarpToHealLocation(HEAL_LOCATION_PALLET_TOWN)
  gs.continueGameWarp = { mapId: palletTown.map, warpId: -1, x: palletTown.x, y: palletTown.y };
}

/** gHasHallOfFameRecords (credits.c): FLAG_SYS_GAME_CLEAR was already set when EnterHallOfFame ran. */
export let gHasHallOfFameRecords = false;

// ------------------------------------------------------------------ the screen

function VBlankCB_HofIdle(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_HofIdle(): void {
  RunTasks();
  RunTextPrinters();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function InitHallOfFameScreen(): boolean {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      ClearVramOamPltt_LoadHofPal();
      sHofGfxPtr = { state: 0, tilemap1: new Uint16Array(0x800), tilemap2: new Uint16Array(0x800) };
      gMain.state = 1;
      break;
    case 1:
      HofInit_ResetGpuBuffersAndLoadConfettiGfx();
      gMain.state++;
      break;
    case 2:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 7));
      SetGpuReg(REG_OFFSET_BLDY, 0);
      Hof_InitBgs();
      sHofGfxPtr!.state = 0;
      gMain.state++;
      break;
    case 3:
      if (!DrawHofBackground()) {
        SetVBlankCallback(VBlankCB_HofIdle);
        BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
        gMain.state++;
      }
      break;
    case 4:
      UpdatePaletteFade();
      if (!gPaletteFade.active) {
        SetMainCallback2(CB2_HofIdle);
        PlayBGM(K.MUS_HALL_OF_FAME);
        return false;
      }
      break;
  }
  return true;
}

// task data
const tDontSaveData = 0;
const tDisplayedMonId = 1;
const tMonNumber = 2;
const tFrameCount = 3;
const tPlayerSpriteId = 4;
const tMonSpriteId = (i: number) => 5 + i;

/** CB2_DoHallOfFameScreen */
export function CB2_DoHallOfFameScreen(): void {
  if (!InitHallOfFameScreen()) {
    const taskId = CreateTask(Task_Hof_InitMonData, 0);
    gTasks[taskId].data[tDontSaveData] = 0;
    sHofMonPtr = [emptyHofTeam()];
  }
}

/** CB2_DoHallOfFameScreenDontSaveData (gGameContinueCallback after a failed save; DoSaveFailedScreen isn't ported) */
export function CB2_DoHallOfFameScreenDontSaveData(): void {
  if (!InitHallOfFameScreen()) {
    const taskId = CreateTask(Task_Hof_InitMonData, 0);
    gTasks[taskId].data[tDontSaveData] = 1;
    sHofMonPtr ??= [emptyHofTeam()];
  }
}

function Task_Hof_InitMonData(taskId: number): void {
  const d = gTasks[taskId].data;
  d[tMonNumber] = 0;
  const team = partyHallOfFameTeam(state);
  for (let i = 0; i < PARTY_SIZE; i++) {
    sHofMonPtr![0][i] = team[i];
    if (team[i].species !== K.SPECIES_NONE) d[tMonNumber]++;
  }
  sSelectedPaletteIndices = 0;
  d[tDisplayedMonId] = 0;
  d[tPlayerSpriteId] = 0xff;
  for (let i = 0; i < PARTY_SIZE; i++) d[tMonSpriteId(i)] = 0xff;
  gTasks[taskId].func = d[tDontSaveData] ? Task_Hof_StartDisplayingMons : Task_Hof_InitTeamSaveData;
}

function Task_Hof_InitTeamSaveData(taskId: number): void {
  // SaveQuestLogData: no quest log
  if (!gHasHallOfFameRecords) ClearHofBuffer();
  else if (LoadHallOfFameSave() !== SAVE_STATUS_OK) ClearHofBuffer();

  const teams = gHofBuffer.teams;
  let i = 0;
  for (; i < HALL_OF_FAME_MAX_TEAMS; i++) if (teams[i][0].species === K.SPECIES_NONE) break;
  if (i >= HALL_OF_FAME_MAX_TEAMS) {
    // full: drop the oldest team
    for (let j = 0; j < HALL_OF_FAME_MAX_TEAMS - 1; j++) teams[j] = teams[j + 1];
    i = HALL_OF_FAME_MAX_TEAMS - 1;
  }
  teams[i] = sHofMonPtr![0].map((m) => ({ ...m, nick: [...m.nick] }));

  DrawDialogueFrame(0, false);
  AddTextPrinterParameterized2(0, FONT_NORMAL, text('gText_SavingDontTurnOffThePower2'), 0, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(0, COPYWIN_FULL);
  gTasks[taskId].func = Task_Hof_TrySaveData;
}

function Task_Hof_TrySaveData(taskId: number): void {
  // gGameContinueCallback = CB2_DoHallOfFameScreenDontSaveData (for DoSaveFailedScreen, not ported)
  const status = hofEnv.trySavingData(SAVE_HALL_OF_FAME);
  testEvent('hallOfFameSaved', { status });
  PlaySE(K.SE_SAVE);
  gTasks[taskId].func = Task_Hof_DelayAfterSave;
  gTasks[taskId].data[tFrameCount] = 32;
}

function Task_Hof_DelayAfterSave(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[tFrameCount] !== 0) d[tFrameCount]--;
  else gTasks[taskId].func = Task_Hof_StartDisplayingMons;
}

function Task_Hof_StartDisplayingMons(taskId: number): void {
  gTasks[taskId].func = Task_Hof_DisplayMon;
}

function Task_Hof_DisplayMon(taskId: number): void {
  const d = gTasks[taskId].data;
  const currMonId = d[tDisplayedMonId];
  const currMon = sHofMonPtr![0][currMonId];
  const pos = d[tMonNumber] > 3 ? sHallOfFame_MonFullTeamPositions[currMonId] : sHallOfFame_MonHalfTeamPositions[currMonId];
  const [srcX, srcY, dstX, dstY] = pos;
  const spriteId = CreateMonPicSprite_HandleDeoxys(currMon.species, currMon.tid, currMon.personality, true, srcX, srcY, currMonId, 0xffff);
  const s = gSprites[spriteId];
  s.data[1] = dstX;
  s.data[2] = dstY;
  s.data[0] = 0;
  s.callback = SpriteCB_GetOnScreen;
  d[tMonSpriteId(currMonId)] = spriteId;
  ClearDialogWindowAndFrame(0, true);
  gTasks[taskId].func = Task_Hof_PlayMonCryAndPrintInfo;
}

function Task_Hof_PlayMonCryAndPrintInfo(taskId: number): void {
  const d = gTasks[taskId].data;
  const currMonId = d[tDisplayedMonId];
  const currMon = sHofMonPtr![0][currMonId];
  if (gSprites[d[tMonSpriteId(currMonId)]].data[0]) {
    if (currMon.species !== K.SPECIES_EGG) PlayCry_Normal(currMon.species, 0);
    HallOfFame_PrintMonInfo(currMon);
    testEvent('hallOfFameMon', { slot: currMonId, species: currMon.species });
    d[tFrameCount] = 120;
    gTasks[taskId].func = Task_Hof_TryDisplayAnotherMon;
  }
}

function Task_Hof_TryDisplayAnotherMon(taskId: number): void {
  const d = gTasks[taskId].data;
  const currPokeId = d[tDisplayedMonId];
  if (d[tFrameCount] !== 0) {
    d[tFrameCount]--;
    return;
  }
  const sprite = gSprites[d[tMonSpriteId(currPokeId)]];
  sSelectedPaletteIndices = (sSelectedPaletteIndices | (0x10000 << sprite.oam.paletteNum)) >>> 0;
  const next = sHofMonPtr![0][currPokeId + 1];
  if (currPokeId < PARTY_SIZE - 1 && next.species !== K.SPECIES_NONE) {
    // there is another pokemon to display
    d[tDisplayedMonId]++;
    BeginNormalPaletteFade(sSelectedPaletteIndices, 0, 12, 12, HALL_OF_FAME_BG_PAL);
    sprite.oam.priority = 1;
    gTasks[taskId].func = Task_Hof_DisplayMon;
  } else {
    gTasks[taskId].func = Task_Hof_PaletteFadeAndPrintWelcomeText;
  }
}

function Task_Hof_PaletteFadeAndPrintWelcomeText(taskId: number): void {
  const d = gTasks[taskId].data;
  BeginNormalPaletteFade(PALETTES_OBJECTS, 0, 0, 0, RGB_BLACK);
  for (let i = 0; i < PARTY_SIZE; i++) if (d[tMonSpriteId(i)] !== 0xff) gSprites[d[tMonSpriteId(i)]].oam.priority = 0;
  HallOfFame_PrintWelcomeText();
  testEvent('hallOfFameWelcome');
  PlaySE(K.SE_APPLAUSE);
  d[tFrameCount] = 400;
  gTasks[taskId].func = Task_Hof_ApplauseAndConfetti;
}

function Task_Hof_ApplauseAndConfetti(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[tFrameCount] !== 0) {
    d[tFrameCount]--;
    if ((d[tFrameCount] & 3) === 0 && d[tFrameCount] > 110) Hof_SpawnConfetti();
  } else {
    for (let i = 0; i < PARTY_SIZE; i++) if (d[tMonSpriteId(i)] !== 0xff) gSprites[d[tMonSpriteId(i)]].oam.priority = 1;
    BeginNormalPaletteFade(sSelectedPaletteIndices, 0, 12, 12, HALL_OF_FAME_BG_PAL);
    FillWindowPixelBuffer(0, PIXEL_FILL(0));
    CopyWindowToVram(0, COPYWIN_FULL);
    d[tFrameCount] = 7;
    gTasks[taskId].func = Task_Hof_WaitBorderFadeAway;
  }
}

function Task_Hof_WaitBorderFadeAway(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[tFrameCount] > 15) {
    gTasks[taskId].func = Task_Hof_SpawnPlayerPic;
  } else {
    d[tFrameCount]++;
    SetGpuReg(REG_OFFSET_BLDALPHA, 256 * d[tFrameCount]);
  }
}

function Task_Hof_SpawnPlayerPic(taskId: number): void {
  const d = gTasks[taskId].data;
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  ShowBg(0);
  ShowBg(1);
  ShowBg(3);
  d[tPlayerSpriteId] = CreateTrainerPicSprite(PlayerGenderToFrontTrainerPicId(playerGender()), true, 0x78, 0x48, 6, 0xffff);
  AddWindow(sWindowTemplate);
  LoadStdWindowGfx(1, 0x21d, BG_PLTT_ID(13));
  d[tFrameCount] = 120;
  gTasks[taskId].func = Task_Hof_WaitAndPrintPlayerInfo;
}

function Task_Hof_WaitAndPrintPlayerInfo(taskId: number): void {
  const d = gTasks[taskId].data;
  const player = gSprites[d[tPlayerSpriteId]];
  if (d[tFrameCount] !== 0) {
    d[tFrameCount]--;
  } else if (player.x !== 192) {
    player.x++;
  } else {
    FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 0x20, 0x20);
    HallOfFame_PrintPlayerInfo();
    DrawDialogueFrame(0, false);
    AddTextPrinterParameterized2(0, FONT_NORMAL, text('gText_LeagueChamp'), 0, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
    CopyWindowToVram(0, COPYWIN_FULL);
    testEvent('hallOfFamePlayerInfo');
    gTasks[taskId].func = Task_Hof_ExitOnKeyPressed;
  }
}

function Task_Hof_ExitOnKeyPressed(taskId: number): void {
  if (JOY_NEW(A_BUTTON)) {
    FadeOutBGM(4);
    gTasks[taskId].func = Task_Hof_HandlePaletteOnExit;
  }
}

function Task_Hof_HandlePaletteOnExit(taskId: number): void {
  gPlttBufferUnfaded.set(gPlttBufferFaded);
  BeginNormalPaletteFade(PALETTES_ALL, 8, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_Hof_HandleExit;
}

function Task_Hof_HandleExit(taskId: number): void {
  if (gPaletteFade.active) return;
  const d = gTasks[taskId].data;
  for (let i = 0; i < PARTY_SIZE; i++) {
    const spriteId = d[tMonSpriteId(i)];
    if (spriteId !== 0xff) FreeAndDestroyMonPicSprite(spriteId);
  }
  FreeAndDestroyTrainerPicSprite(d[tPlayerSpriteId]);
  HideBg(0);
  HideBg(1);
  HideBg(3);
  FreeAllWindowBuffers();
  UnsetBgTilemapBuffer(1);
  UnsetBgTilemapBuffer(3);
  ResetBgsAndClearDma3BusyFlags(false);
  DestroyTask(taskId);
  sHofGfxPtr = null;
  sHofMonPtr = null;
  testEvent('hallOfFameExit');
  SetWarpsToRollCredits();
}

/** SetWarpsToRollCredits: into Indigo Plateau, where IndigoPlateau_Exterior_EventScript_Credits rolls the credits. */
function SetWarpsToRollCredits(): void {
  state.setVar('VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR', 1);
  state.setFlag('FLAG_DONT_SHOW_MAP_NAME_POPUP', true);
  SetDisableMapMusicChangeOnMapLoad(MUSIC_DISABLE_KEEP); // gDisableMapMusicChangeOnMapLoad = 2
  DoWarp('MAP_INDIGO_PLATEAU_EXTERIOR', -1, 11, 6);
}

/**
 * DoWarp (field_fadetransition.c) as it runs under the Hall of Fame's CB2: TryFadeOutOldMapMusic, WarpFadeOutScreen
 * (the screen is black already), PlaySE(SE_EXIT) (skipped: gDisableMapMusicChangeOnMapLoad is set), then
 * Task_Teleport2Warp waits for the fade and BGMusicStopped before WarpIntoMap (`hofEnv.doWarp`). The destination's
 * header loads first (one or two frames; on the GBA it's in ROM).
 */
function DoWarp(mapId: string, warpId: number, x: number, y: number): void {
  let header: MapMusicHeader | undefined | null = null;
  void hofEnv.loadMapHeader(mapId).then((h) => {
    header = h;
  });
  const taskId = CreateTask(Task_Teleport2Warp, 10);
  const d = gTasks[taskId].data;
  d[0] = 0;
  // the task's arguments (sWarpDestination)
  warpDest = { mapId, warpId, x, y, header: () => header };
}

let warpDest: { mapId: string; warpId: number; x: number; y: number; header: () => MapMusicHeader | undefined | null } | null = null;

/** Task_Teleport2Warp, after DoWarp's music fade (the header's load stands in for its synchronous lookup). */
function Task_Teleport2Warp(taskId: number): void {
  const d = gTasks[taskId].data;
  const w = warpDest!;
  switch (d[0]) {
    case 0: {
      const header = w.header();
      if (header === null) return; // still loading
      if (header) TryFadeOutOldMapMusic(header);
      PlaySE(K.SE_EXIT);
      d[0]++;
      break;
    }
    case 1: // FreezeObjectEvents; LockPlayerFieldControls
      d[0]++;
      break;
    case 2:
      if (!gPaletteFade.active && BGMusicStopped()) d[0]++;
      break;
    case 3:
      DestroyTask(taskId);
      warpDest = null;
      hofEnv.doWarp(w.mapId, w.warpId, w.x, w.y);
      break;
  }
}

// ------------------------------------------------------------------ the Hall of Fame PC

/** CB2_InitHofPC */
export function CB2_InitHofPC(): void {
  switch (gMain.state) {
    default:
    case 0:
      SetVBlankCallback(null);
      ClearVramOamPltt_LoadHofPal();
      sHofGfxPtr = { state: 0, tilemap1: new Uint16Array(0x800), tilemap2: new Uint16Array(0x800) };
      gMain.state = 1;
      break;
    case 1:
      HofInit_ResetGpuBuffersAndLoadConfettiGfx();
      gMain.state++;
      break;
    case 2:
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      Hof_InitBgs();
      gMain.state++;
      break;
    case 3:
      if (!DrawHofBackground()) {
        BeginPCScreenEffect_TurnOn(0, 0, 0);
        SetVBlankCallback(VBlankCB_HofIdle);
        gMain.state++;
      }
      break;
    case 4:
      RunTasks();
      AnimateSprites();
      BuildOamBuffer();
      UpdatePaletteFade();
      if (!IsPCScreenEffectRunning_TurnOn()) gMain.state++;
      break;
    case 5:
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG1 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
      SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(16, 7));
      SetGpuReg(REG_OFFSET_BLDY, 0);
      CreateTask(Task_HofPC_CopySaveData, 0);
      sHofMonPtr = [];
      SetMainCallback2(CB2_HofIdle);
      break;
  }
}

// task data (the PC)
const tCurrTeamNo = 0;
const tCurrPageNo = 1;
const tCurrMonId = 2;
const tMonNo = 4;

function Task_HofPC_CopySaveData(taskId: number): void {
  const d = gTasks[taskId].data;
  CreateTopBarWindowLoadPalette(0, 30, 0, 0x0c, 0x226);
  if (LoadHallOfFameSave() !== SAVE_STATUS_OK) {
    gTasks[taskId].func = Task_HofPC_PrintDataIsCorrupted;
    return;
  }
  sHofMonPtr = gHofBuffer.teams.map((t) => t.map((m) => ({ ...m, nick: [...m.nick] })));
  let i = 0;
  for (; i < HALL_OF_FAME_MAX_TEAMS; i++) if (sHofMonPtr[i][0].species === K.SPECIES_NONE) break;
  d[tCurrTeamNo] = i < HALL_OF_FAME_MAX_TEAMS ? i - 1 : HALL_OF_FAME_MAX_TEAMS - 1;
  d[tCurrPageNo] = state.getGameStat(K.GAME_STAT_ENTERED_HOF);
  gTasks[taskId].func = Task_HofPC_DrawSpritesPrintText;
}

function Task_HofPC_DrawSpritesPrintText(taskId: number): void {
  const d = gTasks[taskId].data;
  const savedTeam = sHofMonPtr![d[tCurrTeamNo]];
  sSelectedPaletteIndices = 0;
  d[tCurrMonId] = 0;
  d[tMonNo] = 0;
  for (let i = 0; i < PARTY_SIZE; i++) if (savedTeam[i].species !== K.SPECIES_NONE) d[tMonNo]++;
  for (let i = 0; i < PARTY_SIZE; i++) {
    const currMon = savedTeam[i];
    if (currMon.species !== K.SPECIES_NONE) {
      const pos = d[tMonNo] > 3 ? sHallOfFame_MonFullTeamPositions[i] : sHallOfFame_MonHalfTeamPositions[i];
      const spriteId = CreateMonPicSprite_HandleDeoxys(currMon.species, currMon.tid, currMon.personality, true, pos[2], pos[3], i, 0xffff);
      gSprites[spriteId].oam.priority = 1;
      d[tMonSpriteId(i)] = spriteId;
    } else {
      d[tMonSpriteId(i)] = 0xff;
    }
  }
  BlendPalettes(0xffff0000, 0xc, HALL_OF_FAME_BG_PAL);

  // ConvertIntToDecimalStringN(gStringVar1, page, STR_CONV_MODE_LEFT_ALIGN, 3) + StringExpandPlaceholders(gText_HOFNumber)
  gStringVar1.set(ConvertIntToDecimalStringN(d[tCurrPageNo], STR_CONV_MODE_LEFT_ALIGN, 3));
  const title = StringExpandPlaceholders(text('gText_HOFNumber'));
  if (d[tCurrTeamNo] <= 0) TopBarWindowPrintTwoStrings(title, text('gText_UPDOWNPick_ABUTTONBBUTTONCancel'), false, 0, true);
  else TopBarWindowPrintTwoStrings(title, text('gText_UPDOWNPick_ABUTTONNext_BBUTTONBack'), false, 0, true);
  gTasks[taskId].func = Task_HofPC_PrintMonInfo;
}

function Task_HofPC_PrintMonInfo(taskId: number): void {
  const d = gTasks[taskId].data;
  const savedTeam = sHofMonPtr![d[tCurrTeamNo]];
  for (let i = 0; i < PARTY_SIZE; i++) {
    const spriteId = d[tMonSpriteId(i)];
    if (spriteId !== 0xff) gSprites[spriteId].oam.priority = 1;
  }
  const currMonSprite = gSprites[d[tMonSpriteId(d[tCurrMonId])]];
  currMonSprite.oam.priority = 0;
  sSelectedPaletteIndices = ((0x10000 << currMonSprite.oam.paletteNum) ^ 0xffff0000) >>> 0;
  BlendPalettesUnfaded(sSelectedPaletteIndices, 0xc, HALL_OF_FAME_BG_PAL);
  const currMon = savedTeam[d[tCurrMonId]];
  if (currMon.species !== K.SPECIES_EGG) {
    StopCryAndClearCrySongs();
    PlayCry_Normal(currMon.species, 0);
  }
  HallOfFame_PrintMonInfo(currMon);
  testEvent('hallOfFamePcMon', { team: d[tCurrTeamNo], page: d[tCurrPageNo], slot: d[tCurrMonId], species: currMon.species });
  gTasks[taskId].func = Task_HofPC_HandleInput;
}

function Task_HofPC_HandleInput(taskId: number): void {
  const d = gTasks[taskId].data;
  if (JOY_NEW(A_BUTTON)) {
    if (d[tCurrTeamNo] !== 0) {
      // prepare another team to view
      d[tCurrTeamNo]--;
      for (let i = 0; i < PARTY_SIZE; i++) {
        const spriteId = d[tMonSpriteId(i)];
        if (spriteId !== 0xff) FreeAndDestroyMonPicSprite(spriteId);
      }
      if (d[tCurrPageNo] !== 0) d[tCurrPageNo]--;
      gTasks[taskId].func = Task_HofPC_DrawSpritesPrintText;
    } else {
      // no more teams to view, turn off hall of fame PC
      if (IsCryPlayingOrClearCrySongs()) {
        StopCryAndClearCrySongs();
        m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 0x100);
      }
      gTasks[taskId].func = Task_HofPC_HandlePaletteOnExit;
    }
  } else if (JOY_NEW(B_BUTTON)) {
    // turn off hall of fame PC
    if (IsCryPlayingOrClearCrySongs()) {
      StopCryAndClearCrySongs();
      m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 0x100);
    }
    gTasks[taskId].func = Task_HofPC_HandlePaletteOnExit;
  } else if (JOY_NEW(DPAD_UP) && d[tCurrMonId] !== 0) {
    d[tCurrMonId]--;
    gTasks[taskId].func = Task_HofPC_PrintMonInfo;
  } else if (JOY_NEW(DPAD_DOWN) && d[tCurrMonId] < d[tMonNo] - 1) {
    d[tCurrMonId]++;
    gTasks[taskId].func = Task_HofPC_PrintMonInfo;
  }
}

function Task_HofPC_HandlePaletteOnExit(taskId: number): void {
  gPlttBufferUnfaded.set(gPlttBufferFaded);
  BeginPCScreenEffect_TurnOff(0, 0, 0);
  gTasks[taskId].func = Task_HofPC_HandleExit;
}

function Task_HofPC_HandleExit(taskId: number): void {
  if (IsPCScreenEffectRunning_TurnOff()) return;
  HideBg(0);
  HideBg(1);
  HideBg(3);
  DestroyTopBarWindow();
  FreeAllWindowBuffers();
  UnsetBgTilemapBuffer(1);
  UnsetBgTilemapBuffer(3);
  ResetBgsAndClearDma3BusyFlags(false);
  DestroyTask(taskId);
  sHofGfxPtr = null;
  sHofMonPtr = null;
  testEvent('hallOfFamePcExit');
  hofEnv.returnFromHallOfFamePC();
}

function Task_HofPC_PrintDataIsCorrupted(taskId: number): void {
  TopBarWindowPrintString(text('gText_ABUTTONExit'), 8, true);
  DrawDialogueFrame(0, false);
  AddTextPrinterParameterized2(0, FONT_NORMAL, text('gText_HOFCorrupted'), 0, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(0, COPYWIN_FULL);
  testEvent('hallOfFamePcCorrupted');
  gTasks[taskId].func = Task_HofPC_ExitOnButtonPress;
}

function Task_HofPC_ExitOnButtonPress(taskId: number): void {
  if (JOY_NEW(A_BUTTON)) gTasks[taskId].func = Task_HofPC_HandlePaletteOnExit;
}

// ------------------------------------------------------------------ printing

function HallOfFame_PrintWelcomeText(): void {
  const welcome = text('gText_WelcomeToHOF');
  const x = Math.trunc((0xd0 - GetStringWidth(FONT_NORMAL, welcome, 0)) / 2) & 0xff;
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  PutWindowTilemap(0);
  AddTextPrinterParameterized3(0, FONT_NORMAL, x, 1, sTextColors[0], 0, welcome);
  CopyWindowToVram(0, COPYWIN_FULL);
}

/** SpeciesToPokedexNum: 0xFFFF past Kanto without the National Pokédex. */
function SpeciesToPokedexNum(species: number): number {
  const n = pokemon.nationalDex(species);
  if (!state.nationalDexEnabled && n > KANTO_SPECIES_END) return 0xffff;
  return n;
}

function HallOfFame_PrintMonInfo(currMon: HallofFameMon): void {
  const CHAR_0 = K.CHAR_0;
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  PutWindowTilemap(0);

  // dex number
  if (currMon.species !== K.SPECIES_EGG) {
    const text2 = text('gText_Number').slice(0, -1);
    const dexNumber = SpeciesToPokedexNum(currMon.species);
    if (dexNumber !== 0xffff) text2.push(Math.trunc(dexNumber / 100) + CHAR_0, Math.trunc((dexNumber % 100) / 10) + CHAR_0, (dexNumber % 10) + CHAR_0);
    else text2.push(K.CHAR_QUESTION_MARK, K.CHAR_QUESTION_MARK, K.CHAR_QUESTION_MARK);
    text2.push(EOS);
    AddTextPrinterParameterized3(0, FONT_NORMAL, 16, 1, sTextColors[0], 0, text2);
  }

  // nick, species names, gender and lvl
  const nick: number[] = [];
  for (let i = 0; i < 10 && i < currMon.nick.length && currMon.nick[i] !== EOS; i++) nick.push(currMon.nick[i]);
  nick.push(EOS);
  const width = GetStringWidth(FONT_NORMAL, nick, GetFontAttribute(FONT_NORMAL, FONTATTR_LETTER_SPACING));
  const x = currMon.species === K.SPECIES_EGG ? 0x80 - Math.trunc(width / 2) : 0x80 - width;
  AddTextPrinterParameterized3(0, FONT_NORMAL, x & 0xff, 1, sTextColors[0], 0, nick);
  if (currMon.species !== K.SPECIES_EGG) {
    const name = [K.CHAR_SLASH, ...speciesName(currMon.species).filter((c) => c !== EOS)];
    const gender =
      currMon.species === K.SPECIES_NIDORAN_M || currMon.species === K.SPECIES_NIDORAN_F
        ? K.MON_GENDERLESS
        : pokemon.genderFromPersonality(currMon.species, currMon.personality);
    if (gender === K.MON_MALE) name.push(K.CHAR_MALE);
    else if (gender === K.MON_FEMALE) name.push(K.CHAR_FEMALE);
    else name.push(K.CHAR_SPACE);
    name.push(EOS);
    AddTextPrinterParameterized3(0, FONT_NORMAL, 0x80, 1, sTextColors[0], 0, name);

    const lvl = [...text('gText_Level').slice(0, -1), ...ConvertIntToDecimalStringN(currMon.lvl, STR_CONV_MODE_LEFT_ALIGN, 3)];
    AddTextPrinterParameterized3(0, FONT_NORMAL, 0x20, 0x11, sTextColors[0], 0, lvl);
    const id = [...text('gText_IDNumber').slice(0, -1), ...ConvertIntToDecimalStringN(currMon.tid & 0xffff, STR_CONV_MODE_LEADING_ZEROS, 5)];
    AddTextPrinterParameterized3(0, FONT_NORMAL, 0x60, 0x11, sTextColors[0], 0, id);
  }
  CopyWindowToVram(0, COPYWIN_FULL);
}

function HallOfFame_PrintPlayerInfo(): void {
  const CHAR_0 = K.CHAR_0;
  const textWidth = sWindowTemplate.width * 8 - 6;
  FillWindowPixelBuffer(1, PIXEL_FILL(1));
  PutWindowTilemap(1);
  DrawStdFrameWithCustomTileAndPalette(1, false, 0x21d, 13);
  AddTextPrinterParameterized4(1, FONT_NORMAL, 4, 3, 0, 0, sTextColors[1], 0, text('gText_Name'));
  const playerName = [...charmap.encodePlain(state.playerName), EOS];
  AddTextPrinterParameterized3(1, FONT_NORMAL, (textWidth - GetStringWidth(FONT_NORMAL, playerName, 0)) & 0xff, 3, sTextColors[1], 0, playerName);

  const trainerId = state.trainerId & 0xffff;
  AddTextPrinterParameterized3(1, FONT_NORMAL, 4, 18, sTextColors[1], 0, text('gText_IDNumber'));
  const id = [
    Math.trunc((trainerId % 100000) / 10000) + CHAR_0,
    Math.trunc((trainerId % 10000) / 1000) + CHAR_0,
    Math.trunc((trainerId % 1000) / 100) + CHAR_0,
    Math.trunc((trainerId % 100) / 10) + CHAR_0,
    (trainerId % 10) + CHAR_0,
    EOS,
  ];
  AddTextPrinterParameterized3(1, FONT_NORMAL, textWidth - 30, 18, sTextColors[1], 0, id);

  AddTextPrinterParameterized3(1, FONT_NORMAL, 4, 32, sTextColors[1], 0, text('gText_MainMenuTime'));
  const { hours, minutes } = state.playTime;
  const time = [Math.trunc(hours / 100) + CHAR_0, Math.trunc((hours % 100) / 10) + CHAR_0, (hours % 10) + CHAR_0];
  if (time[0] === CHAR_0) time[0] = K.CHAR_SPACE;
  if (time[0] === K.CHAR_SPACE && time[1] === CHAR_0) time[1] = K.CHAR_SPACE;
  time.push(K.CHAR_COLON, Math.trunc((minutes % 100) / 10) + CHAR_0, (minutes % 10) + CHAR_0, EOS);
  AddTextPrinterParameterized3(1, FONT_NORMAL, textWidth - 36, 32, sTextColors[1], 0, time);
  CopyWindowToVram(1, COPYWIN_FULL);
}

// ------------------------------------------------------------------ graphics

function ClearVramOamPltt_LoadHofPal(): void {
  vram.fill(0);
  ResetOamRange(0, 128);
  pltt.fill(0);
  ResetPaletteFade();
  const pal = gfx16('sHallOfFame_Pal');
  LoadPalette(pal, BG_PLTT_ID(0), pal.length * 2);
}

function HofInit_ResetGpuBuffersAndLoadConfettiGfx(): void {
  ScanlineEffect_Stop();
  ResetTasks();
  ResetSpriteData();
  ResetTempTileDataBuffers();
  ResetAllPicSprites();
  FreeAllSpritePalettes();
  SetReservedSpritePaletteCount(8);
  LoadCompressedSpriteSheet({ data: gfx('gFile_graphics_misc_confetti_sheet'), size: 0x220, tag: TAG_CONFETTI });
  LoadCompressedSpritePalette({ data: gfx16('gFile_graphics_misc_confetti_palette'), tag: TAG_CONFETTI });
}

function Hof_InitBgs(): void {
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sHof_BgTemplates, sHof_BgTemplates.length);
  SetBgTilemapBuffer(1, sHofGfxPtr!.tilemap1);
  SetBgTilemapBuffer(3, sHofGfxPtr!.tilemap2);
  for (const bg of [0, 1, 3]) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
}

function DrawHofBackground(): boolean {
  const g = sHofGfxPtr!;
  switch (g.state) {
    case 0:
      DecompressAndCopyTileDataToVram(1, gfx('sHallOfFame_Gfx'), 0, 0, 0);
      break;
    case 1:
      if (FreeTempTileDataBuffersIfPossible()) return true;
      break;
    case 2:
      FillBgTilemapBufferRect_Palette0(1, 1, 0, 0, 0x20, 2);
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 3, 0x20, 0xb);
      FillBgTilemapBufferRect_Palette0(1, 1, 0, 0xe, 0x20, 6);
      FillBgTilemapBufferRect_Palette0(3, 2, 0, 0, 0x20, 0x20);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(3);
      break;
    case 3:
      InitStandardTextBoxWindows();
      InitTextBoxGfxAndPrinters();
      break;
    case 4:
      SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
      ShowBg(0);
      ShowBg(1);
      ShowBg(3);
      g.state = 0;
      return false;
  }
  g.state++;
  return true;
}

function SpriteCB_EndGetOnScreen(_sprite: Sprite): void {}

function SpriteCB_GetOnScreen(sprite: Sprite): void {
  if (sprite.x !== sprite.data[1] || sprite.y !== sprite.data[2]) {
    if (sprite.x < sprite.data[1]) sprite.x += 15;
    if (sprite.x > sprite.data[1]) sprite.x -= 15;
    if (sprite.y < sprite.data[2]) sprite.y += 10;
    if (sprite.y > sprite.data[2]) sprite.y -= 10;
  } else {
    sprite.data[0] = 1;
    sprite.callback = SpriteCB_EndGetOnScreen;
  }
}

function SpriteCB_Confetti(sprite: Sprite): void {
  if (sprite.y2 > 120) {
    DestroySprite(sprite);
    return;
  }
  sprite.y2++;
  sprite.y2 += sprite.data[1];
  const tableID = sprite.data[0] & 0xff;
  const rand = (random() % 4) + 8;
  sprite.x2 = Math.trunc((rand * gSineTable(tableID)) / 256);
  sprite.data[0] += 4;
}

function Hof_SpawnConfetti(): boolean {
  const posX = random() % 240;
  const posY = -(random() % 8);
  const spriteId = CreateSprite(sSpriteTemplate_Confetti(), posX, posY, 0);
  const sprite = gSprites[spriteId];
  StartSpriteAnim(sprite, random() % 17);
  sprite.data[1] = random() & 3 ? 0 : 1;
  return false;
}

/** Dev: the screen's task and what it's showing. */
export function hallOfFameProbe(): { task: string; data: number[]; teams: number } | undefined {
  const task = gTasks.find((t) => t.isActive && t.func.name.startsWith('Task_Hof'));
  if (!task) return undefined;
  return { task: task.func.name, data: [...task.data], teams: sHofMonPtr?.length ?? 0 };
}
