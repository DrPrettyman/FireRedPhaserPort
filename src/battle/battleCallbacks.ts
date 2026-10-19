// battle_main.c's main callbacks: CB2_InitBattle / CB2_InitBattleInternal, CB2_HandleStartBattle,
// BattleMainCB2 and VBlankCB_Battle. They run through gMain like on the GBA, so the bag and party
// menu can replace them and reshow_battle_screen.c can put them back.

import { IsDma3ManagerBusyWithBgCopy, ShowBg } from '../gba/bg';
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  resetHardware,
  SetGpuReg,
  WIN_RANGE,
} from '../gba/hw';
import { gMain, SetHBlankCallback, SetMainCallback1, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { gScanlineEffectRegBuffers, ScanlineEffect_Clear, ScanlineEffect_InitHBlankDmaTransfer, ScanlineEffect_SetParams, SCANLINE_EFFECT_DMACNT_16BIT } from '../gba/scanline';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData, SetReservedSpritePaletteCount } from '../gba/sprite';
import { ResetTasks, RunTasks } from '../gba/task';
import { RunTextPrinters } from '../gba/window';
import { random } from '../util/random';
import { DrawBattleEntryBackground, InitBattleBgsVideo, LoadBattleTextboxAndBackground } from './battleBg';
import { K } from './constants';
import { g } from './env';
import { SetHelpContextForBattle } from '../ui/helpSystemContext';
import { AllocateMonSpritesGfx, BattleInitAllSprites, BattleInterfaceSetWindowPals } from './gfx';
import { allocateBattleResources, battleMainCB1, initBattleControllers, initBattleInternal } from './main';

const spritesInit = { state: 0, battlerId: 0 };

/**
 * CB2_InitBattle + CB2_InitBattleInternal (link/multi battles aren't supported). `afterSetUp` runs
 * after CreateNPCTrainerParty (the battle test page swaps in its own parties there).
 */
export function CB2_InitBattle(terrain: number, afterSetUp: () => void = () => {}): void {
  allocateBattleResources();
  // AllocateBattleSpritesData: a fresh BattleSpriteData comes with the new globals
  AllocateMonSpritesGfx();

  // CB2_InitBattleInternal
  SetHBlankCallback(null);
  SetVBlankCallback(null);
  resetHardware(); // CpuFill32(0, VRAM, VRAM_SIZE)
  SetGpuReg(REG_OFFSET_MOSAIC, 0);
  SetGpuReg(REG_OFFSET_WIN0H, DISPLAY_WIDTH);
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(DISPLAY_HEIGHT / 2, DISPLAY_HEIGHT / 2 + 1));
  SetGpuReg(REG_OFFSET_WININ, 0);
  SetGpuReg(REG_OFFSET_WINOUT, 0);
  g.battle_WIN0H = DISPLAY_WIDTH;
  g.battle_WIN0V = WIN_RANGE(DISPLAY_HEIGHT / 2, DISPLAY_HEIGHT / 2 + 1);
  ScanlineEffect_Clear();
  for (let i = 0; i < 160; ++i) {
    const v = i < 80 ? 0xf0 : 0xff10;
    gScanlineEffectRegBuffers[0][i] = v;
    gScanlineEffectRegBuffers[1][i] = v;
  }
  // sIntroScanlineParams16Bit
  ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_BG3HOFS, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  ResetPaletteFade();
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  g.battle_BG1_X = g.battle_BG1_Y = 0;
  g.battle_BG2_X = g.battle_BG2_Y = 0;
  g.battle_BG3_X = g.battle_BG3_Y = 0;
  g.battleTerrain = terrain;
  InitBattleBgsVideo();
  LoadBattleTextboxAndBackground();
  ResetSpriteData();
  ResetTasks();
  DrawBattleEntryBackground();
  FreeAllSpritePalettes();
  SetReservedSpritePaletteCount(4);
  SetVBlankCallback(VBlankCB_Battle);
  // SetUpBattleVars, CreateNPCTrainerParty, AdjustFriendship(FRIENDSHIP_EVENT_LEAGUE_BATTLE)
  initBattleInternal();
  afterSetUp();
  SetMainCallback2(CB2_HandleStartBattle);
  gMain.inBattle = true;
  SetHelpContextForBattle(g.battleTypeFlags);
}

/** CB2_HandleStartBattle (single-player path) */
function CB2_HandleStartBattle(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  const comm = g.battleCommunication;
  switch (comm[K.MULTIUSE_STATE]) {
    case 0:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        ShowBg(0);
        ShowBg(1);
        ShowBg(2);
        ShowBg(3);
        BattleInterfaceSetWindowPals();
        comm[K.MULTIUSE_STATE] = 1;
      }
      break;
    case 1:
      g.battleTypeFlags |= K.BATTLE_TYPE_IS_MASTER;
      comm[K.MULTIUSE_STATE] = 15;
      // SetAllPlayersBerryData: no Enigma Berry
      break;
    case 15:
      initBattleControllers();
      comm[K.MULTIUSE_STATE]++;
      spritesInit.state = 0;
      spritesInit.battlerId = 0;
      break;
    case 16:
      if (BattleInitAllSprites(spritesInit)) {
        SetMainCallback1(battleMainCB1);
        SetMainCallback2(BattleMainCB2);
      }
      break;
  }
}

/** BattleMainCB2 */
export function BattleMainCB2(): void {
  AnimateSprites();
  BuildOamBuffer();
  RunTextPrinters();
  UpdatePaletteFade();
  RunTasks();
}

/** VBlankCB_Battle */
export function VBlankCB_Battle(): void {
  random(); // Change gRngSeed every vblank.
  SetGpuReg(REG_OFFSET_BG0HOFS, g.battle_BG0_X);
  SetGpuReg(REG_OFFSET_BG0VOFS, g.battle_BG0_Y);
  SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
  SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
  SetGpuReg(REG_OFFSET_BG2HOFS, g.battle_BG2_X);
  SetGpuReg(REG_OFFSET_BG2VOFS, g.battle_BG2_Y);
  SetGpuReg(REG_OFFSET_BG3HOFS, g.battle_BG3_X);
  SetGpuReg(REG_OFFSET_BG3VOFS, g.battle_BG3_Y);
  SetGpuReg(REG_OFFSET_WIN0H, g.battle_WIN0H);
  SetGpuReg(REG_OFFSET_WIN0V, g.battle_WIN0V);
  SetGpuReg(REG_OFFSET_WIN1H, g.battle_WIN1H);
  SetGpuReg(REG_OFFSET_WIN1V, g.battle_WIN1V);
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  ScanlineEffect_InitHBlankDmaTransfer();
}
