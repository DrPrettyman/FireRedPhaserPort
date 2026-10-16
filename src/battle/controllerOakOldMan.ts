// battle_controller_oak_old_man.c: the player's controller in the first (rival) battle, where Oak
// narrates, and in the Old Man's catching tutorial (simulated input).
//
// The bag and party screens don't exist yet: the bag returns no item and the party screen
// auto-picks like the player controller (see controllerPlayer.ts).

import { FillBgTilemapBufferRect, BG_TILE_V_FLIP, IsDma3ManagerBusyWithBgCopy } from '../gba/bg';
import { gfx16 } from '../gba/gfx';
import { PALETTES_ALL, RGB_BLACK } from '../gba/hw';
import { BeginFastPaletteFade, BeginNormalPaletteFade, gPaletteFade, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import { AllocSpritePalette, CreateSprite, DestroySprite, FreeOamMatrix, FreeSpriteOamMatrix, FreeSpritePaletteByTag, FreeSpriteTilesByTag, gSprites, IndexOfSpritePaletteTag, SpriteCallbackDummy, StartSpriteAnim, StoreSpriteCallbackInData6 } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import { FreeAllWindowBuffers, IsTextPrinterActive } from '../gba/window';
import { gMain } from '../gba/main';
import { CB2_BagMenuFromBattle, InitOldManBag } from '../menus/itemMenu';
import { SpecialVar } from '../menus/itemMenuState';
import { gPartyMenuUseExitCallback, gSelectedMonPartyId, OpenPartyMenuInTutorialBattle } from '../menus/partyMenu';
import { DoMoveAnim, SetMoveAnimGlobalsFromBuffer } from './anim/battleAnim';
import { anim } from './anim/state';
import { BattleMainCB2 } from './battleCallbacks';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { CreatePartyStatusSummarySprites, SetBattleBarStruct, SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible, Task_HidePartyStatusSummary, UpdateHealthboxAttribute, UpdateHpTextInHealthbox } from './battleInterface';
import { HandleIntroSlide } from './battleIntro';
import { ui } from './battleUi';
import { BattlePutTextOnWindow } from './battleWindow';
import { K } from './constants';
import { handleGetMonData, handleSetMonData, healthbarStep, hitAnimBlinkStep, startExpTask } from './controllerCommon';
import { OpponentBufferExecCompleted } from './controllerOpponent';
import {
  ActionSelectionCreateCursorAt,
  ActionSelectionDestroyCursorAt,
  BattleControllerDummy,
  drawActionMenu,
  handleChoosePokemon,
  HandleInputChooseMove,
  InitMoveSelectionsVarsAndStrings,
  makeHandleInputChooseAction,
  playerBackPic,
  setOakOldManHandleInputChooseMove,
  SpriteCB_FreePlayerSpriteLoadMonSprite,
  TryShinyAnimation,
} from './controllerPlayer';
import { emitChosenMonReturnValue, emitOneReturnValue, emitTwoReturnValues } from './controllers';
import { bdata, g } from './env';
import { bit } from './globals';
import {
  CopyAllBattleSpritesInvisibilities,
  CreateInvisibleSpriteWithCallback,
  DecompressTrainerBackPalette,
  DoHitAnimHealthboxEffect,
  DoPokeballSendOutAnimation,
  EndBounceEffect,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  gMultiuseSpriteTemplate,
  HandleLowHpMusicChange,
  InitAndLaunchSpecialAnimation,
  IsMoveWithoutAnimation,
  LoadBattleBarGfx,
  SetBattlerSpriteAffineMode,
  SetMultiuseSpriteTemplateToPokemon,
  SetMultiuseSpriteTemplateToTrainerBack,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  SpriteCB_FaintSlideAnim,
  SpriteCB_TrainerSlideIn,
  SpriteCB_WaitForBattlerBallReleaseAnim,
  StartAnimLinearTranslation,
  StartHealthboxSlideIn,
  TryHandleLaunchBattleTableAnimation,
  TrySetBehindSubstituteSpriteBit,
} from './gfx';
import { battleStringExpandPlaceholdersToDisplayedString, battleStringShouldBeColored, bufferStringBattle, encodeBattleText } from './message';
import type { HpAndStatus } from './structs';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const bufA = () => g.battleBufferA[g.activeBattler];
const party = () => g.playerParty;
const monOf = (battler: number) => g.playerParty[g.battlerPartyIndexes[battler]]!;
const sbd = () => g.battleSpritesDataPtr;
const sim = () => g.battleStruct.simulatedInputState;
const isFirstBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) !== 0;

const OakOldManDummy = (): void => {};

export function SetControllerToOakOrOldMan(): void {
  g.battlerControllerFuncs[ab()] = OakOldManBufferRunCommand;
  sim().fill(0);
  setOakOldManHandleInputChooseMove(OakOldManHandleInputChooseMove);
}
export const setControllerToOakOrOldMan = SetControllerToOakOrOldMan;

function OakOldManBufferRunCommand(): void {
  if (g.battleControllerExecFlags & bit(ab())) {
    const cmd = sOakOldManBufferCommands()[bufA()[0]];
    if (cmd) cmd();
    else OakOldManBufferExecCompleted();
  }
}

function OakOldManBufferExecCompleted(): void {
  g.battlerControllerFuncs[ab()] = OakOldManBufferRunCommand;
  g.battleControllerExecFlags = (g.battleControllerExecFlags & ~bit(ab())) >>> 0;
}

/** HandleInputChooseAction: like the player's, for the rival battle in Oak's Lab */
const HandleInputChooseAction = makeHandleInputChooseAction(OakOldManBufferExecCompleted);

/** SimulateInputChooseAction (Old Man) */
function SimulateInputChooseAction(): void {
  const s = sim();
  switch (s[0]) {
    case 0:
      s[2] = 64;
      ++s[0];
    // fall through
    case 1:
      if (--s[2] === 0) {
        // Move cursor to BAG
        ui.playSE(K.SE_SELECT);
        ActionSelectionDestroyCursorAt(0);
        ActionSelectionCreateCursorAt(1, 0);
        s[2] = 64;
        ++s[0];
      }
      break;
    case 2:
      if (--s[2] === 0) {
        // Open bag
        ui.playSE(K.SE_SELECT);
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_USE_ITEM, 0);
        OakOldManBufferExecCompleted();
      }
      break;
  }
}

function CompleteOnBattlerSpriteCallbackDummy(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) OakOldManBufferExecCompleted();
}

function CompleteOnInactiveTextPrinter(): void {
  if (!IsTextPrinterActive(0)) OakOldManBufferExecCompleted();
}

function CompleteOnSpecialAnimDone(): void {
  if (!g.doingBattleAnim) OakOldManBufferExecCompleted();
}

/** OakOldManHandleInputChooseMove */
export function OakOldManHandleInputChooseMove(): void {
  HandleInputChooseMove();
  if (!(g.battleControllerExecFlags & bit(ab()))) OakOldManBufferExecCompleted();
}

function OpenPartyMenuToChooseMon(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = WaitForMonSelection;
    const caseId = gTasks[g.battleControllerData[ab()]].data[0];
    DestroyTask(g.battleControllerData[ab()]);
    FreeAllWindowBuffers();
    OpenPartyMenuInTutorialBattle(caseId);
  }
}

function WaitForMonSelection(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    if (gPartyMenuUseExitCallback === true) emitChosenMonReturnValue(K.BUFFER_B, gSelectedMonPartyId, g.battlePartyCurrentOrder);
    else emitChosenMonReturnValue(K.BUFFER_B, K.PARTY_SIZE, [0, 0, 0]);
    OakOldManBufferExecCompleted();
  }
}

function OpenBagAndChooseItem(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = CompleteWhenChoseItem;
    // ReshowBattleScreenDummy
    FreeAllWindowBuffers();
    if (isFirstBattle()) CB2_BagMenuFromBattle();
    else InitOldManBag();
  }
}

function CompleteWhenChoseItem(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    if (!btlCtrlOakOldManTestState2Flag(K.FIRST_BATTLE_MSG_FLAG_HP_RESTORE) && SpecialVar.ItemId === K.ITEM_POTION && isFirstBattle()) {
      BtlCtrl_OakOldMan_SetState2Flag(K.FIRST_BATTLE_MSG_FLAG_HP_RESTORE);
      g.battlerControllerFuncs[ab()] = PrintOakText_KeepAnEyeOnHP;
    } else {
      emitOneReturnValue(K.BUFFER_B, SpecialVar.ItemId);
      OakOldManBufferExecCompleted();
    }
  }
}

function Intro_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const b = a ^ K.BIT_FLANK;
  const h = sbd().healthBoxesData;
  if (!h[a].triedShinyMonAnim && !h[a].ballAnimActive) TryShinyAnimation(a);
  if (!h[b].triedShinyMonAnim && !h[b].ballAnimActive) TryShinyAnimation(b);
  if (!h[a].ballAnimActive && !h[b].ballAnimActive) {
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
      DestroySprite(gSprites[g.battleControllerData[b]]);
      UpdateHealthboxAttribute(g.healthboxSpriteIds[b], monOf(b), K.HEALTHBOX_ALL);
      StartHealthboxSlideIn(b);
      SetHealthboxSpriteVisible(g.healthboxSpriteIds[b]);
    }
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], monOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    sbd().animationData.introAnimActive = 0;
    g.battlerControllerFuncs[a] = Intro_WaitForShinyAnimAndHealthbox;
  }
}

function Intro_WaitForShinyAnimAndHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData;
  if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy && h[a].finishedShinyMonAnim && h[a ^ K.BIT_FLANK].finishedShinyMonAnim) {
    h[a].triedShinyMonAnim = h[a].finishedShinyMonAnim = 0;
    h[a ^ K.BIT_FLANK].triedShinyMonAnim = h[a ^ K.BIT_FLANK].finishedShinyMonAnim = 0;
    FreeSpriteTilesByTag(K.ANIM_TAG_GOLD_STARS);
    FreeSpritePaletteByTag(K.ANIM_TAG_GOLD_STARS);
    // CreateTask(Task_PlayerController_RestoreBgmAfterCry, 10): no audio
    HandleLowHpMusicChange(monOf(a), a);
    g.battlerControllerFuncs[a] = PrintOakText_ForPetesSake;
  }
}

function FreeMonSpriteAfterFaintAnim(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.y + s.y2 > DISPLAY_HEIGHT) {
    FreeOamMatrix(s.oam.matrixNum);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    OakOldManBufferExecCompleted();
  }
}

// ---------------------------------------------------------------- Oak's narration

/** DoLoadHealthboxPalsForLevelUp (battle_anim_special.c): give a healthbox its own palettes. */
export function DoLoadHealthboxPalsForLevelUp(battler: number): [number, number] {
  const healthBoxSpriteId = g.healthboxSpriteIds[battler];
  const spriteId1 = gSprites[healthBoxSpriteId].oam.affineParam;
  const spriteId2 = gSprites[healthBoxSpriteId].data[5];
  const paletteId1 = AllocSpritePalette(K.TAG_HEALTHBOX_PALS_1);
  const paletteId2 = AllocSpritePalette(K.TAG_HEALTHBOX_PALS_2);
  const offset1 = OBJ_PLTT_ID(gSprites[healthBoxSpriteId].oam.paletteNum);
  const offset2 = OBJ_PLTT_ID(gSprites[spriteId2].oam.paletteNum);
  LoadPalette(gPlttBufferUnfaded.slice(offset1, offset1 + 16), OBJ_PLTT_ID(paletteId1), PLTT_SIZE_4BPP);
  LoadPalette(gPlttBufferUnfaded.slice(offset2, offset2 + 16), OBJ_PLTT_ID(paletteId2), PLTT_SIZE_4BPP);
  gSprites[healthBoxSpriteId].oam.paletteNum = paletteId1;
  gSprites[spriteId1].oam.paletteNum = paletteId1;
  gSprites[spriteId2].oam.paletteNum = paletteId2;
  return [paletteId1, paletteId2];
}

/** DoFreeHealthboxPalsForLevelUp (battle_anim_special.c) */
export function DoFreeHealthboxPalsForLevelUp(battler: number): void {
  const healthBoxSpriteId = g.healthboxSpriteIds[battler];
  const spriteId1 = gSprites[healthBoxSpriteId].oam.affineParam;
  const spriteId2 = gSprites[healthBoxSpriteId].data[5];
  FreeSpritePaletteByTag(K.TAG_HEALTHBOX_PALS_1);
  FreeSpritePaletteByTag(K.TAG_HEALTHBOX_PALS_2);
  const paletteId1 = IndexOfSpritePaletteTag(K.TAG_HEALTHBOX_PAL);
  const paletteId2 = IndexOfSpritePaletteTag(K.TAG_HEALTHBAR_PAL);
  gSprites[healthBoxSpriteId].oam.paletteNum = paletteId1;
  gSprites[spriteId1].oam.paletteNum = paletteId1;
  gSprites[spriteId2].oam.paletteNum = paletteId2;
}

function loadHealthboxPals(battler: number): void {
  const [p1, p2] = DoLoadHealthboxPalsForLevelUp(battler);
  sim()[1] = p1;
  sim()[3] = p2;
}

const healthboxPalMask = () => ((bit(sim()[1]) | bit(sim()[3])) << 16) >>> 0;

function oakSays(sym: string): void {
  battleStringExpandPlaceholdersToDisplayedString(encodeBattleText(sym));
  BattlePutTextOnWindow(g.displayedStringBattle, K.B_WIN_OAK_OLD_MAN);
}

function PrintOakText_ForPetesSake(): void {
  const s = sim();
  switch (s[0]) {
    case 0:
      if (!gPaletteFade.active) {
        loadHealthboxPals(getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT));
        BeginNormalPaletteFade(0xffffff7e, 4, 0, 8, RGB_BLACK);
        ++s[0];
      }
      break;
    case 1:
      if (!gPaletteFade.active) {
        BtlCtrl_DrawVoiceoverMessageFrame();
        ++s[0];
      }
      break;
    case 2:
      oakSays('gText_ForPetesSake');
      ++s[0];
      break;
    case 3:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN)) {
        BeginNormalPaletteFade(healthboxPalMask(), 4, 8, 0, RGB_BLACK);
        ++s[0];
      }
      break;
    case 4:
      if (!gPaletteFade.active) {
        oakSays('gText_TheTrainerThat');
        ++s[0];
      }
      break;
    case 5:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN)) {
        BeginNormalPaletteFade(healthboxPalMask(), 4, 0, 8, RGB_BLACK);
        ++s[0];
      }
      break;
    case 6:
      if (!gPaletteFade.active) {
        oakSays('gText_TryBattling');
        ++s[0];
      }
      break;
    case 7:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN)) {
        BeginNormalPaletteFade(0xffffff7e, 4, 8, 0, RGB_BLACK);
        ++s[0];
      }
      break;
    case 8:
      if (!gPaletteFade.active) {
        DoFreeHealthboxPalsForLevelUp(getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT));
        BtlCtrl_RemoveVoiceoverMessageFrame();
        s[0] = 0;
        OakOldManBufferExecCompleted();
      }
      break;
  }
}

export const PrintOakText_InflictingDamageIsKey = (): void => PrintOakTextWithMainBgDarkened('gText_InflictingDamageIsKey', 1);
const PrintOakText_LoweringStats = (): void => PrintOakTextWithMainBgDarkened('gText_LoweringStats', 64);
export const PrintOakText_OakNoRunningFromATrainer = (): void => PrintOakTextWithMainBgDarkened('gText_OakNoRunningFromATrainer', 1);
const PrintOakText_WinEarnsPrizeMoney = (): void => PrintOakTextWithMainBgDarkened('gText_WinEarnsPrizeMoney', 64);
export const PrintOakText_HowDisappointing = (): void => PrintOakTextWithMainBgDarkened('gText_HowDissapointing', 64);

/** PrintOakTextWithMainBgDarkened: if delay is 0, it's treated as 256. */
function PrintOakTextWithMainBgDarkened(text: string, delay: number): void {
  const s = sim();
  switch (s[0]) {
    case 0:
      if (!IsTextPrinterActive(0)) {
        s[3] = delay;
        ++s[0];
      }
      break;
    case 1:
      if (--s[3] === 0) {
        BeginNormalPaletteFade(0xffffff7e, 4, 0, 8, RGB_BLACK);
        ++s[0];
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        BtlCtrl_DrawVoiceoverMessageFrame();
        ++s[0];
      }
      break;
    case 3:
      oakSays(text);
      ++s[0];
      break;
    case 4:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN)) {
        BeginNormalPaletteFade(0xffffff7e, 4, 8, 0, RGB_BLACK);
        ++s[0];
      }
      break;
    case 5:
      if (!gPaletteFade.active) {
        BtlCtrl_RemoveVoiceoverMessageFrame();
        if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) OakOldManBufferExecCompleted();
        else OpponentBufferExecCompleted();
        g.battleCommunication[K.MSG_DISPLAY] = 0;
        s[0] = 0;
      }
      break;
  }
}

function PrintOakText_KeepAnEyeOnHP(): void {
  const s = sim();
  switch (s[0]) {
    case 0:
      if (!gPaletteFade.active) {
        loadHealthboxPals(ab());
        BeginNormalPaletteFade(0xffffff7e, 4, 0, 8, RGB_BLACK);
        ++s[0];
      }
      break;
    case 1:
      if (!gPaletteFade.active) {
        BeginNormalPaletteFade(healthboxPalMask(), 4, 8, 0, RGB_BLACK);
        ++s[0];
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        BtlCtrl_DrawVoiceoverMessageFrame();
        ++s[0];
      }
      break;
    case 3:
      oakSays('gText_KeepAnEyeOnHP');
      ++s[0];
      break;
    case 4:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN)) {
        BeginNormalPaletteFade(healthboxPalMask(), 4, 0, 8, RGB_BLACK);
        ++s[0];
      }
      break;
    case 5:
      if (!gPaletteFade.active) {
        BeginNormalPaletteFade(0xffffff7e, 4, 8, 0, RGB_BLACK);
        ++s[0];
      }
      break;
    case 6:
      if (!gPaletteFade.active) {
        BtlCtrl_RemoveVoiceoverMessageFrame();
        emitOneReturnValue(K.BUFFER_B, SpecialVar.ItemId);
        OakOldManBufferExecCompleted();
        s[0] = 0;
      }
      break;
  }
}

function CompleteOnHealthbarDone(): void {
  if (healthbarStep(party())) OakOldManBufferExecCompleted();
}

function CompleteOnInactiveTextPrinter2(): void {
  if (!IsTextPrinterActive(0)) OakOldManBufferExecCompleted();
}

function DoHitAnimBlinkSpriteEffect(): void {
  if (hitAnimBlinkStep()) OakOldManBufferExecCompleted();
}

function DoSwitchOutAnimation(): void {
  if (!sbd().healthBoxesData[ab()].specialAnimActive) {
    const s = gSprites[g.battlerSpriteIds[ab()]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    OakOldManBufferExecCompleted();
  }
}

function CompleteOnFinishedBattleAnimation(): void {
  if (!sbd().healthBoxesData[ab()].animFromTableActive) OakOldManBufferExecCompleted();
}

// ---------------------------------------------------------------- handlers

function OakOldManHandleGetMonData(): void {
  handleGetMonData(party());
  OakOldManBufferExecCompleted();
}

function OakOldManHandleSetMonData(): void {
  handleSetMonData(party());
  OakOldManBufferExecCompleted();
}

function OakOldManHandleReturnMonToBall(): void {
  const a = ab();
  if (bufA()[1] === 0) {
    InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SWITCH_OUT_PLAYER_MON);
    g.battlerControllerFuncs[a] = DoSwitchOutAnimation;
  } else {
    const s = gSprites[g.battlerSpriteIds[a]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    OakOldManBufferExecCompleted();
  }
}

function backPicId(): number {
  return isFirstBattle() ? playerBackPic() : K.TRAINER_BACK_PIC_OLD_MAN;
}

function createBackPicSprite(): number {
  const a = ab();
  const picId = backPicId();
  DecompressTrainerBackPalette(picId, a);
  SetMultiuseSpriteTemplateToTrainerBack(picId, getBattlerPosition(a));
  const y = (8 - (bdata.tables.coords.trainerBack[picId]?.[0] ?? 8)) * 4 + 80;
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 80, y, 30));
  gSprites[id].oam.paletteNum = a;
  return id;
}

function OakOldManHandleDrawTrainerPic(): void {
  const s = gSprites[createBackPicSprite()];
  s.x2 = DISPLAY_WIDTH;
  s.data[0] = -2;
  s.callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[ab()] = CompleteOnBattlerSpriteCallbackDummy;
}

function OakOldManHandleTrainerSlide(): void {
  const s = gSprites[createBackPicSprite()];
  s.x2 = -96;
  s.data[0] = 2;
  s.callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[ab()] = CompleteOnBattlerSpriteCallbackDummy; // CompleteOnBattlerSpriteCallbackDummy2
}

function OakOldManHandleFaintAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (h.animationState === 0) {
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
    ++h.animationState;
  } else if (!h.specialAnimActive) {
    h.animationState = 0;
    HandleLowHpMusicChange(monOf(a), a);
    ui.playSE(K.SE_FAINT);
    const s = gSprites[g.battlerSpriteIds[a]];
    s.data[1] = 0;
    s.data[2] = 5;
    s.callback = SpriteCB_FaintSlideAnim;
    g.battlerControllerFuncs[a] = FreeMonSpriteAfterFaintAnim;
  }
}

function ballThrowAnim(caseId: number): void {
  sbd().animationData.ballThrowCaseId = caseId;
  g.doingBattleAnim = true;
  InitAndLaunchSpecialAnimation(ab(), ab(), getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT), K.B_ANIM_BALL_THROW_WITH_TRAINER);
  g.battlerControllerFuncs[ab()] = CompleteOnSpecialAnimDone;
}

function OakOldManHandleMoveAnimation(): void {
  const move = bufA()[1] | (bufA()[2] << 8);
  SetMoveAnimGlobalsFromBuffer(ab());
  if (IsMoveWithoutAnimation(move, bufA()[3])) {
    OakOldManBufferExecCompleted();
  } else {
    sbd().healthBoxesData[ab()].animationState = 0;
    g.battlerControllerFuncs[ab()] = OakOldManDoMoveAnimation;
  }
}

/** OakOldManDoMoveAnimation: unlike the other controllers, ignores flag_x8 and multihit. */
function OakOldManDoMoveAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  const bd = sbd().battlerData[a];
  switch (h.animationState) {
    case 0:
      if (bd.behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
      h.animationState = 1;
      break;
    case 1:
      if (!h.specialAnimActive) {
        SetBattlerSpriteAffineMode(0);
        DoMoveAnim(bufA()[1] | (bufA()[2] << 8));
        h.animationState = 2;
      }
      break;
    case 2:
      anim.scriptCallback();
      if (!anim.scriptActive) {
        SetBattlerSpriteAffineMode(1);
        if (bd.behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
        h.animationState = 3;
      }
      break;
    case 3:
      if (!h.specialAnimActive) {
        CopyAllBattleSpritesInvisibilities();
        TrySetBehindSubstituteSpriteBit(a, bufA()[1] | (bufA()[2] << 8));
        h.animationState = 0;
        OakOldManBufferExecCompleted();
      }
      break;
  }
}

function OakOldManHandlePrintString(): void {
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  const stringId = bufA()[2] | (bufA()[3] << 8);
  if (g.battleTypeFlags & K.BATTLE_TYPE_OLD_MAN_TUTORIAL && stringId === 1) {
    OakOldManBufferExecCompleted();
    return;
  }
  bufferStringBattle(stringId);
  BattlePutTextOnWindow(g.displayedStringBattle, battleStringShouldBeColored(stringId) ? K.B_WIN_MSG | K.B_TEXT_FLAG_NPC_CONTEXT_FONT : K.B_WIN_MSG);
  if (isFirstBattle()) {
    switch (stringId) {
      case K.STRINGID_DEFENDERSSTATFELL:
        if (!btlCtrlOakOldManTestState2Flag(K.FIRST_BATTLE_MSG_FLAG_STAT_CHG)) {
          BtlCtrl_OakOldMan_SetState2Flag(K.FIRST_BATTLE_MSG_FLAG_STAT_CHG);
          g.battlerControllerFuncs[ab()] = PrintOakText_LoweringStats;
          return;
        }
        break;
      case K.STRINGID_PLAYERGOTMONEY:
        g.battlerControllerFuncs[ab()] = PrintOakText_WinEarnsPrizeMoney;
        return;
      case K.STRINGID_TRAINER1WINTEXT:
        g.battlerControllerFuncs[ab()] = PrintOakText_HowDisappointing;
        return;
      case K.STRINGID_DONTLEAVEBIRCH:
        g.battlerControllerFuncs[ab()] = PrintOakText_OakNoRunningFromATrainer;
        return;
    }
  }
  g.battlerControllerFuncs[ab()] = CompleteOnInactiveTextPrinter;
}

function OakOldManHandlePrintSelectionString(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) OakOldManHandlePrintString();
  else OakOldManBufferExecCompleted();
}

function HandleChooseActionAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 160;
    g.battlerControllerFuncs[ab()] = isFirstBattle() ? HandleInputChooseAction : SimulateInputChooseAction;
  }
}

function OakOldManHandleChooseAction(): void {
  g.battlerControllerFuncs[ab()] = HandleChooseActionAfterDma3;
  drawActionMenu(isFirstBattle() ? 'gText_WhatWillPkmnDo' : 'gText_WhatWillOldManDo');
}

function OakHandleChooseMove_WaitDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 320;
    g.battlerControllerFuncs[ab()] = OakOldManHandleInputChooseMove;
  }
}

function OakOldManHandleChooseMove(): void {
  if (isFirstBattle()) {
    InitMoveSelectionsVarsAndStrings();
    g.battlerControllerFuncs[ab()] = OakHandleChooseMove_WaitDma3;
    return;
  }
  const s = sim();
  switch (s[1]) {
    case 0:
      InitMoveSelectionsVarsAndStrings();
      ++s[1];
      s[3] = 80;
    // fall through
    case 1:
      if (--s[3] === 0) {
        ui.playSE(K.SE_SELECT);
        emitTwoReturnValues(K.BUFFER_B, 10, 0x100);
        OakOldManBufferExecCompleted();
      }
      break;
  }
}

function OakOldManHandleChooseItem(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[ab()] = OpenBagAndChooseItem;
  g.battlerInMenuId = ab();
  for (let i = 0; i < 3; ++i) g.battlePartyCurrentOrder[i] = bufA()[i + 1];
}

function OakOldManHandleChoosePokemon(): void {
  handleChoosePokemon(OpenPartyMenuToChooseMon);
}

function OakOldManHandleHealthBarUpdate(): void {
  const a = ab();
  LoadBattleBarGfx(0);
  const hpVal = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
  const mon = monOf(a);
  if (hpVal !== K.INSTANT_HP_BAR_DROP) {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, mon.hp, hpVal);
  } else {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, 0, hpVal);
    UpdateHpTextInHealthbox(g.healthboxSpriteIds[a], 0, K.HP_CURRENT);
  }
  g.battlerControllerFuncs[a] = CompleteOnHealthbarDone;
}

function OakOldManHandleExpUpdate(): void {
  const monId = bufA()[1];
  if (g.playerParty[monId]!.level >= K.MAX_LEVEL) {
    OakOldManBufferExecCompleted();
  } else {
    LoadBattleBarGfx(1);
    const expPointsToGive = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
    startExpTask(monId, expPointsToGive, ab(), (b) => (g.battlerControllerFuncs[b] = CompleteOnInactiveTextPrinter2), false);
    g.battlerControllerFuncs[ab()] = OakOldManDummy;
  }
}

function OakOldManHandleHitAnimation(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.invisible) {
    OakOldManBufferExecCompleted();
  } else {
    g.doingBattleAnim = true;
    s.data[1] = 0;
    DoHitAnimHealthboxEffect(ab());
    g.battlerControllerFuncs[ab()] = DoHitAnimBlinkSpriteEffect;
  }
}

function OakOldManHandleIntroTrainerBallThrow(): void {
  const a = ab();
  if (isFirstBattle()) {
    const s = gSprites[g.battlerSpriteIds[a]];
    SetSpritePrimaryCoordsFromSecondaryCoords(s);
    s.data[0] = 50;
    s.data[2] = -40;
    s.data[4] = s.y;
    s.callback = StartAnimLinearTranslation;
    s.data[5] = a;
    StoreSpriteCallbackInData6(s, SpriteCB_FreePlayerSpriteLoadMonSprite);
    StartSpriteAnim(s, 1);
    const paletteNum = AllocSpritePalette(0xd6f8);
    LoadPalette(gfx16(bdata.anims.trainerBackPalettes[playerBackPic()]), OBJ_PLTT_ID(paletteNum), PLTT_SIZE_4BPP);
    s.oam.paletteNum = paletteNum;
    const taskId = CreateTask(Task_StartSendOutAnim, 5);
    gTasks[taskId].data[0] = a;
    if (sbd().healthBoxesData[a].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[a]].func = Task_HidePartyStatusSummary;
    sbd().animationData.introAnimActive = 1;
    g.battlerControllerFuncs[a] = BattleControllerDummy;
  } else {
    if (sbd().healthBoxesData[a].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[a]].func = Task_HidePartyStatusSummary;
    OakOldManBufferExecCompleted();
  }
}

function StartSendOutAnim(battlerId: number): void {
  sbd().battlerData[battlerId].transformSpecies = K.SPECIES_NONE;
  g.battlerPartyIndexes[battlerId] = g.battleBufferA[battlerId][1];
  const species = monOf(battlerId).species;
  g.battleControllerData[battlerId] = CreateInvisibleSpriteWithCallback(SpriteCB_WaitForBattlerBallReleaseAnim);
  SetMultiuseSpriteTemplateToPokemon(species, getBattlerPosition(battlerId));
  const id = (g.battlerSpriteIds[battlerId] = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2), GetBattlerSpriteDefault_Y(battlerId), GetBattlerSpriteSubpriority(battlerId)));
  gSprites[g.battleControllerData[battlerId]].data[1] = id;
  const s = gSprites[id];
  s.data[0] = battlerId;
  s.data[2] = species;
  s.oam.paletteNum = battlerId;
  StartSpriteAnim(s, g.battleMonForms[battlerId]);
  s.invisible = true;
  s.callback = SpriteCallbackDummy;
  gSprites[g.battleControllerData[battlerId]].data[0] = DoPokeballSendOutAnimation(0, K.POKEBALL_PLAYER_SENDOUT);
}

function Task_StartSendOutAnim(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[1] < 31) {
    ++d[1];
    return;
  }
  const saved = g.activeBattler;
  g.activeBattler = d[0];
  g.battleBufferA[g.activeBattler][1] = g.battlerPartyIndexes[g.activeBattler];
  StartSendOutAnim(g.activeBattler);
  g.battlerControllerFuncs[g.activeBattler] = Intro_TryShinyAnimShowHealthbox;
  g.activeBattler = saved;
  DestroyTask(taskId);
}

function OakOldManHandleDrawPartyStatusSummary(): void {
  const a = ab();
  if (bufA()[1] !== 0 && getBattlerSide(a) === K.B_SIDE_PLAYER) {
    OakOldManBufferExecCompleted();
  } else {
    sbd().healthBoxesData[a].partyStatusSummaryShown = 1;
    g.battlerStatusSummaryTaskId[a] = CreatePartyStatusSummarySprites(a, g.battleBufferAObj[a] as HpAndStatus[], !!bufA()[1], !!bufA()[2]);
    OakOldManBufferExecCompleted();
  }
}

function OakOldManHandleEndBounceEffect(): void {
  EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
  EndBounceEffect(ab(), K.BOUNCE_MON);
  OakOldManBufferExecCompleted();
}

function OakOldManHandleBattleAnimation(): void {
  const animationId = bufA()[1];
  const argument = bufA()[2] | (bufA()[3] << 8);
  if (TryHandleLaunchBattleTableAnimation(ab(), ab(), ab(), animationId, argument)) OakOldManBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = CompleteOnFinishedBattleAnimation;
}

function OakOldManHandleLinkStandbyMsg(): void {
  switch (bufA()[1]) {
    case 0:
    case 1:
      EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
      EndBounceEffect(ab(), K.BOUNCE_MON);
      break;
  }
  OakOldManBufferExecCompleted();
}

function OakOldManHandleCmd55(): void {
  g.battleOutcome = bufA()[1];
  // FadeOutMapMusic(5): no audio
  BeginFastPaletteFade(3);
  OakOldManBufferExecCompleted();
}

/** BtlCtrl_OakOldMan_TestState2Flag */
export function btlCtrlOakOldManTestState2Flag(mask: number): boolean {
  return (g.battleStruct.simulatedInputState[2] & mask) !== 0;
}

/** BtlCtrl_OakOldMan_SetState2Flag */
export function BtlCtrl_OakOldMan_SetState2Flag(mask: number): void {
  g.battleStruct.simulatedInputState[2] |= mask;
}

/** BtlCtrl_DrawVoiceoverMessageFrame */
export function BtlCtrl_DrawVoiceoverMessageFrame(): void {
  const width = 0x1a;
  const pal = 7;
  const V = BG_TILE_V_FLIP;
  const f = (tile: number, x: number, y: number, w = 1) => FillBgTilemapBufferRect(0, tile, x, y, w, 1, pal);
  f(0x30, 0, 0xe);
  f(0x31, 1, 0xe);
  f(0x32, 2, 0xe, width);
  f(0x33, 0x1c, 0xe);
  f(0x34, 0x1d, 0xe);
  f(0x35, 0, 0xf);
  f(0x36, 1, 0xf);
  f(0x38, 0x1c, 0xf);
  f(0x39, 0x1d, 0xf);
  f(0x3a, 0, 0x10);
  f(0x3b, 1, 0x10);
  f(0x3c, 0x1c, 0x10);
  f(0x3d, 0x1d, 0x10);
  f(V(0x3a), 0, 0x11);
  f(V(0x3b), 1, 0x11);
  f(V(0x3c), 0x1c, 0x11);
  f(V(0x3d), 0x1d, 0x11);
  f(V(0x35), 0, 0x12);
  f(V(0x36), 1, 0x12);
  f(V(0x38), 0x1c, 0x12);
  f(V(0x39), 0x1d, 0x12);
  f(V(0x30), 0, 0x13);
  f(V(0x31), 1, 0x13);
  f(V(0x32), 2, 0x13, width);
  f(V(0x33), 0x1c, 0x13);
  f(V(0x34), 0x1d, 0x13);
}

/** BtlCtrl_RemoveVoiceoverMessageFrame */
export function BtlCtrl_RemoveVoiceoverMessageFrame(): void {
  const pal = 0;
  const width = 0x1a;
  const height = 4;
  const f = (tile: number, x: number, y: number, w: number, h: number) => FillBgTilemapBufferRect(0, tile, x, y, w, h, pal);
  f(3, 0, 0xe, 1, 1);
  f(4, 1, 0xe, 1, 1);
  f(5, 2, 0xe, width, 1);
  f(6, 0x1c, 0xe, 1, 1);
  f(7, 0x1d, 0xe, 1, 1);
  f(8, 0, 0xf, 1, height);
  f(9, 1, 0xf, 1, height);
  f(0xa, 2, 0xf, width, height);
  f(0xb, 0x1c, 0xf, 1, height);
  f(0xc, 0x1d, 0xf, 1, height);
  f(0xd, 0, 0x13, 1, 1);
  f(0xe, 1, 0x13, 1, 1);
  f(0xf, 2, 0x13, width, 1);
  f(0x10, 0x1c, 0x13, 1, 1);
  f(0x11, 0x1d, 0x13, 1, 1);
}

const complete = OakOldManBufferExecCompleted;

let commands: Record<number, () => void> | undefined;
function sOakOldManBufferCommands(): Record<number, () => void> {
  return (commands ??= {
    [K.CONTROLLER_GETMONDATA]: OakOldManHandleGetMonData,
    [K.CONTROLLER_GETRAWMONDATA]: complete,
    [K.CONTROLLER_SETMONDATA]: OakOldManHandleSetMonData,
    [K.CONTROLLER_SETRAWMONDATA]: complete,
    [K.CONTROLLER_LOADMONSPRITE]: complete,
    [K.CONTROLLER_SWITCHINANIM]: complete,
    [K.CONTROLLER_RETURNMONTOBALL]: OakOldManHandleReturnMonToBall,
    [K.CONTROLLER_DRAWTRAINERPIC]: OakOldManHandleDrawTrainerPic,
    [K.CONTROLLER_TRAINERSLIDE]: OakOldManHandleTrainerSlide,
    [K.CONTROLLER_TRAINERSLIDEBACK]: complete,
    [K.CONTROLLER_FAINTANIMATION]: OakOldManHandleFaintAnimation,
    [K.CONTROLLER_PALETTEFADE]: complete,
    [K.CONTROLLER_SUCCESSBALLTHROWANIM]: () => ballThrowAnim(K.BALL_3_SHAKES_SUCCESS),
    [K.CONTROLLER_BALLTHROWANIM]: () => ballThrowAnim(bufA()[1]),
    [K.CONTROLLER_PAUSE]: complete,
    [K.CONTROLLER_MOVEANIMATION]: OakOldManHandleMoveAnimation,
    [K.CONTROLLER_PRINTSTRING]: OakOldManHandlePrintString,
    [K.CONTROLLER_PRINTSTRINGPLAYERONLY]: OakOldManHandlePrintSelectionString,
    [K.CONTROLLER_CHOOSEACTION]: OakOldManHandleChooseAction,
    [K.CONTROLLER_UNKNOWNYESNOBOX]: complete,
    [K.CONTROLLER_CHOOSEMOVE]: OakOldManHandleChooseMove,
    [K.CONTROLLER_OPENBAG]: OakOldManHandleChooseItem,
    [K.CONTROLLER_CHOOSEPOKEMON]: OakOldManHandleChoosePokemon,
    [K.CONTROLLER_23]: complete,
    [K.CONTROLLER_HEALTHBARUPDATE]: OakOldManHandleHealthBarUpdate,
    [K.CONTROLLER_EXPUPDATE]: OakOldManHandleExpUpdate,
    [K.CONTROLLER_STATUSICONUPDATE]: complete,
    [K.CONTROLLER_STATUSANIMATION]: complete,
    [K.CONTROLLER_STATUSXOR]: complete,
    [K.CONTROLLER_DATATRANSFER]: complete,
    [K.CONTROLLER_DMA3TRANSFER]: complete,
    [K.CONTROLLER_PLAYBGM]: complete,
    [K.CONTROLLER_32]: complete,
    [K.CONTROLLER_TWORETURNVALUES]: complete,
    [K.CONTROLLER_CHOSENMONRETURNVALUE]: complete,
    [K.CONTROLLER_ONERETURNVALUE]: complete,
    [K.CONTROLLER_ONERETURNVALUE_DUPLICATE]: complete,
    [K.CONTROLLER_CLEARUNKVAR]: complete,
    [K.CONTROLLER_SETUNKVAR]: complete,
    [K.CONTROLLER_CLEARUNKFLAG]: complete,
    [K.CONTROLLER_TOGGLEUNKFLAG]: complete,
    [K.CONTROLLER_HITANIMATION]: OakOldManHandleHitAnimation,
    [K.CONTROLLER_CANTSWITCH]: complete,
    [K.CONTROLLER_PLAYSE]: () => {
      ui.playSE(bufA()[1] | (bufA()[2] << 8));
      complete();
    },
    [K.CONTROLLER_PLAYFANFARE]: () => {
      ui.playFanfare(bufA()[1] | (bufA()[2] << 8));
      complete();
    },
    [K.CONTROLLER_FAINTINGCRY]: () => {
      ui.playCry(monOf(ab()).species);
      complete();
    },
    [K.CONTROLLER_INTROSLIDE]: () => {
      HandleIntroSlide(bufA()[1]);
      g.introSlideFlags |= 1;
      complete();
    },
    [K.CONTROLLER_INTROTRAINERBALLTHROW]: OakOldManHandleIntroTrainerBallThrow,
    [K.CONTROLLER_DRAWPARTYSTATUSSUMMARY]: OakOldManHandleDrawPartyStatusSummary,
    [K.CONTROLLER_HIDEPARTYSTATUSSUMMARY]: complete,
    [K.CONTROLLER_ENDBOUNCE]: OakOldManHandleEndBounceEffect,
    [K.CONTROLLER_SPRITEINVISIBILITY]: complete,
    [K.CONTROLLER_BATTLEANIMATION]: OakOldManHandleBattleAnimation,
    [K.CONTROLLER_LINKSTANDBYMSG]: OakOldManHandleLinkStandbyMsg,
    [K.CONTROLLER_RESETACTIONMOVESELECTION]: complete,
    [K.CONTROLLER_ENDLINKBATTLE]: OakOldManHandleCmd55,
    [K.CONTROLLER_TERMINATOR_NOP]: () => {},
  });
}
