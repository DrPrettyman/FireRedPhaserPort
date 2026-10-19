// reshow_battle_screen.c: rebuild the battle screen (backgrounds, windows, battler and healthbox
// sprites) after the bag or party menu has replaced it, then hand back to BattleMainCB2.
// battle_controller_player.c's SetCB2ToReshowScreenAfterMenu(2) live here too.

import { SetBgAttribute, BG_ATTR_CHARBASEINDEX, ShowBg } from '../gba/bg';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, DISPCNT_OBJWIN_ON, DISPCNT_WIN0_ON, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, REG_OFFSET_BLDY, REG_OFFSET_DISPCNT, REG_OFFSET_MOSAIC, REG_OFFSET_WIN0H, REG_OFFSET_WIN0V, REG_OFFSET_WIN1H, REG_OFFSET_WIN1V, REG_OFFSET_WININ, REG_OFFSET_WINOUT, SetGpuReg, SetGpuRegBits, vram } from '../gba/hw';
import { SetHBlankCallback, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { BeginHardwarePaletteFade, gPaletteFade, ResetPaletteFade } from '../gba/palette';
import { ScanlineEffect_Clear } from '../gba/scanline';
import { CreateSprite, FreeAllSpritePalettes, gSprites, ResetSpriteData, SetReservedSpritePaletteCount, SpriteCallbackDummy, StartSpriteAnim } from '../gba/sprite';
import { BattleInitBgsAndWindows, LoadBattleTextboxAndBackground } from './battleBg';
import { BattleMainCB2, VBlankCB_Battle } from './battleCallbacks';
import { CreateBattlerHealthboxSprites, CreateSafariPlayerHealthboxSprites, InitBattlerHealthboxCoords, SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible, UpdateHealthboxAttribute } from './battleInterface';
import { K } from './constants';
import { SetHelpContextForBattle } from '../ui/helpSystemContext';
import { ActionSelectionCreateCursorAt } from './controllerPlayer';
import { bdata, g, state } from './env';
import {
  BattleInterfaceSetWindowPals,
  BattleLoadAllHealthBoxesGfx,
  BattleLoadOpponentMonSpriteGfx,
  DecompressGhostFrontPic,
  BattleLoadPlayerMonSpriteGfx,
  BattleLoadSubstituteOrMonSpriteGfx,
  ClearSpritesHealthboxAnimData,
  DecompressTrainerBackPalette,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetGhostSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  GetSubstituteSpriteDefault_Y,
  gMultiuseSpriteTemplate,
  LoadAndCreateEnemyShadowSprites,
  SetBattlerShadowSpriteCallback,
  SetMultiuseSpriteTemplateToPokemon,
  SetMultiuseSpriteTemplateToTrainerBack,
} from './gfx';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide, isGhostWithoutScope } from './util';

const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;

/** ReshowBattleScreenDummy */
export function ReshowBattleScreenDummy(): void {}

/** SetCB2ToReshowScreenAfterMenu (battle_controller_player.c) */
export function SetCB2ToReshowScreenAfterMenu(): void {
  SetMainCallback2(ReshowBattleScreenAfterMenu);
}

/** SetCB2ToReshowScreenAfterMenu2 (battle_controller_player.c) */
export function SetCB2ToReshowScreenAfterMenu2(): void {
  SetMainCallback2(ReshowBattleScreenAfterMenu);
}

export function ReshowBattleScreenAfterMenu(): void {
  gPaletteFade.bufferTransferDisabled = true;
  SetHBlankCallback(null);
  SetGpuReg(REG_OFFSET_MOSAIC, 0);
  g.battleScripting.reshowMainState = 0;
  g.battleScripting.reshowHelperState = 0;
  SetHelpContextForBattle(g.battleTypeFlags);
  SetMainCallback2(CB2_ReshowBattleScreenAfterMenu);
}

function CB2_ReshowBattleScreenAfterMenu(): void {
  const s = g.battleScripting;
  switch (s.reshowMainState) {
    case 0:
      ResetSpriteData();
      break;
    case 1:
      SetVBlankCallback(null);
      ScanlineEffect_Clear();
      BattleInitBgsAndWindows();
      SetBgAttribute(1, BG_ATTR_CHARBASEINDEX, 0);
      SetBgAttribute(2, BG_ATTR_CHARBASEINDEX, 0);
      ShowBg(0);
      ShowBg(1);
      ShowBg(2);
      ShowBg(3);
      ResetPaletteFade();
      g.battle_BG0_X = 0;
      g.battle_BG0_Y = 0;
      g.battle_BG1_X = 0;
      g.battle_BG1_Y = 0;
      g.battle_BG2_X = 0;
      g.battle_BG2_Y = 0;
      g.battle_BG3_X = 0;
      g.battle_BG3_Y = 0;
      break;
    case 2:
      vram.fill(0);
      break;
    case 3:
      LoadBattleTextboxAndBackground();
      break;
    case 4:
      FreeAllSpritePalettes();
      SetReservedSpritePaletteCount(4);
      break;
    case 5:
      ClearSpritesHealthboxAnimData();
      break;
    case 6:
      if (BattleLoadAllHealthBoxesGfx(s.reshowHelperState)) {
        s.reshowHelperState = 0;
      } else {
        ++s.reshowHelperState;
        --s.reshowMainState;
      }
      break;
    case 7:
    case 8:
    case 9:
    case 10:
      if (!LoadBattlerSpriteGfx(s.reshowMainState - 7)) --s.reshowMainState;
      break;
    case 11:
    case 12:
    case 13:
    case 14:
      CreateBattlerSprite(s.reshowMainState - 11);
      break;
    case 15:
    case 16:
    case 17:
    case 18:
      CreateHealthboxSprite(s.reshowMainState - 15);
      break;
    case 19: {
      LoadAndCreateEnemyShadowSprites();
      let opponentBattler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      SetBattlerShadowSpriteCallback(opponentBattler, g.enemyParty[g.battlerPartyIndexes[opponentBattler]]!.species);
      if (isDoubleBattle()) {
        opponentBattler = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
        SetBattlerShadowSpriteCallback(opponentBattler, g.enemyParty[g.battlerPartyIndexes[opponentBattler]]!.species);
      }
      ActionSelectionCreateCursorAt(g.actionSelectionCursor[g.battlerInMenuId], 0);
      break;
    }
    case 20:
      SetVBlankCallback(VBlankCB_Battle);
      ReshowBattleScreen_TurnOnDisplay();
      BeginHardwarePaletteFade(0xff, 0, 0x10, 0, 1);
      gPaletteFade.bufferTransferDisabled = false;
      SetMainCallback2(BattleMainCB2);
      BattleInterfaceSetWindowPals();
      break;
  }
  ++s.reshowMainState;
}

function ReshowBattleScreen_TurnOnDisplay(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_WININ, 0x3f);
  SetGpuReg(REG_OFFSET_WINOUT, 0x3f);
  SetGpuReg(REG_OFFSET_WIN0H, 0);
  SetGpuReg(REG_OFFSET_WIN0V, 0);
  SetGpuReg(REG_OFFSET_WIN1H, 0);
  SetGpuReg(REG_OFFSET_WIN1V, 0);
  SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON | DISPCNT_OBJWIN_ON);
}

function LoadBattlerSpriteGfx(battler: number): boolean {
  if (battler < g.battlersCount) {
    const sbd = g.battleSpritesDataPtr;
    if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) {
      if (isGhostWithoutScope(g.battleTypeFlags)) DecompressGhostFrontPic(g.enemyParty[g.battlerPartyIndexes[battler]]!, battler);
      else if (!sbd.battlerData[battler].behindSubstitute) BattleLoadOpponentMonSpriteGfx(g.enemyParty[g.battlerPartyIndexes[battler]]!, battler);
      else BattleLoadSubstituteOrMonSpriteGfx(battler, false);
    } else if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI && battler === K.B_POSITION_PLAYER_LEFT) {
      // Should be checking position, not battler.
      DecompressTrainerBackPalette(state.playerGender === 'female' ? K.FEMALE : K.MALE, battler);
    } else if (g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL && battler === K.B_POSITION_PLAYER_LEFT) {
      DecompressTrainerBackPalette(K.TRAINER_BACK_PIC_OLD_MAN, battler);
    } else if (!sbd.battlerData[battler].behindSubstitute) {
      BattleLoadPlayerMonSpriteGfx(g.playerParty[g.battlerPartyIndexes[battler]]!, battler);
    } else {
      BattleLoadSubstituteOrMonSpriteGfx(battler, false);
    }
    g.battleScripting.reshowHelperState = 0;
  }
  return true;
}

function CreateBattlerSprite(battler: number): void {
  if (battler >= g.battlersCount) return;
  const sbd = g.battleSpritesDataPtr;
  let posY: number;
  if (isGhostWithoutScope(g.battleTypeFlags)) {
    posY = GetGhostSpriteDefault_Y(battler);
  } else if (sbd.battlerData[battler].behindSubstitute) {
    posY = GetSubstituteSpriteDefault_Y(battler);
  } else {
    posY = GetBattlerSpriteDefault_Y(battler);
  }
  const playerGender = state.playerGender === 'female' ? K.FEMALE : K.MALE;
  const backCoordsY = (picId: number) => (8 - (bdata.tables.coords.trainerBack[picId]?.[0] ?? 8)) * 4 + 80;
  let spriteId: number;
  if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) {
    const mon = g.enemyParty[g.battlerPartyIndexes[battler]]!;
    if (mon.hp === 0) return;
    SetMultiuseSpriteTemplateToPokemon(mon.species, getBattlerPosition(battler));
    spriteId = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2), posY, GetBattlerSpriteSubpriority(battler));
    g.battlerSpriteIds[battler] = spriteId;
    gSprites[spriteId].oam.paletteNum = battler;
    gSprites[spriteId].callback = SpriteCallbackDummy;
    gSprites[spriteId].data[0] = battler;
    gSprites[spriteId].data[2] = mon.species;
    StartSpriteAnim(gSprites[spriteId], g.battleMonForms[battler]);
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI && battler === K.B_POSITION_PLAYER_LEFT) {
    SetMultiuseSpriteTemplateToTrainerBack(playerGender, getBattlerPosition(K.B_POSITION_PLAYER_LEFT));
    spriteId = CreateSprite(gMultiuseSpriteTemplate, 0x50, backCoordsY(playerGender), GetBattlerSpriteSubpriority(0));
    g.battlerSpriteIds[battler] = spriteId;
    gSprites[spriteId].oam.paletteNum = battler;
    gSprites[spriteId].callback = SpriteCallbackDummy;
    gSprites[spriteId].data[0] = battler;
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL && battler === K.B_POSITION_PLAYER_LEFT) {
    SetMultiuseSpriteTemplateToTrainerBack(K.TRAINER_BACK_PIC_OLD_MAN, getBattlerPosition(0));
    spriteId = CreateSprite(gMultiuseSpriteTemplate, 0x50, backCoordsY(K.TRAINER_BACK_PIC_OLD_MAN), GetBattlerSpriteSubpriority(0));
    g.battlerSpriteIds[battler] = spriteId;
    gSprites[spriteId].oam.paletteNum = battler;
    gSprites[spriteId].callback = SpriteCallbackDummy;
    gSprites[spriteId].data[0] = battler;
  } else {
    const mon = g.playerParty[g.battlerPartyIndexes[battler]]!;
    if (mon.hp === 0) return;
    SetMultiuseSpriteTemplateToPokemon(mon.species, getBattlerPosition(battler));
    spriteId = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2), posY, GetBattlerSpriteSubpriority(battler));
    g.battlerSpriteIds[battler] = spriteId;
    gSprites[spriteId].oam.paletteNum = battler;
    gSprites[spriteId].callback = SpriteCallbackDummy;
    gSprites[spriteId].data[0] = battler;
    gSprites[spriteId].data[2] = mon.species;
    StartSpriteAnim(gSprites[spriteId], g.battleMonForms[battler]);
  }
  gSprites[g.battlerSpriteIds[battler]].invisible = !!sbd.battlerData[battler].invisible;
}

function CreateHealthboxSprite(battler: number): void {
  if (battler >= g.battlersCount) return;
  let healthboxSpriteId: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI && battler === K.B_POSITION_PLAYER_LEFT) healthboxSpriteId = CreateSafariPlayerHealthboxSprites();
  else if (g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL && battler === K.B_POSITION_PLAYER_LEFT) return;
  else healthboxSpriteId = CreateBattlerHealthboxSprites(battler);
  g.healthboxSpriteIds[battler] = healthboxSpriteId;
  InitBattlerHealthboxCoords(battler);
  SetHealthboxSpriteVisible(healthboxSpriteId);
  if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) UpdateHealthboxAttribute(g.healthboxSpriteIds[battler], g.enemyParty[g.battlerPartyIndexes[battler]]!, K.HEALTHBOX_ALL);
  else if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) UpdateHealthboxAttribute(g.healthboxSpriteIds[battler], g.playerParty[g.battlerPartyIndexes[battler]]!, K.HEALTHBOX_SAFARI_ALL_TEXT);
  else UpdateHealthboxAttribute(g.healthboxSpriteIds[battler], g.playerParty[g.battlerPartyIndexes[battler]]!, K.HEALTHBOX_ALL);
  // DummyBattleInterfaceFunc: does nothing
  if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) {
    if (g.enemyParty[g.battlerPartyIndexes[battler]]!.hp === 0) SetHealthboxSpriteInvisible(healthboxSpriteId);
  } else if (!(g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) && g.playerParty[g.battlerPartyIndexes[battler]]!.hp === 0) {
    SetHealthboxSpriteInvisible(healthboxSpriteId);
  }
}
