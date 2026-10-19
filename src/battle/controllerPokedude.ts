// battle_controller_pokedude.c: Teachy TV's battles. The Pokédude's controller runs both sides (InitBattleControllers
// gives every battler SetControllerToPokedude) with scripted inputs: sInputScripts_ChooseAction / _ChooseMove press
// the menus on a timer, and before a battle command listed in the option's sPokedudeTextScripts the screen darkens
// for the Pokédude's voiceover (B_WIN_OAK_OLD_MAN), which waits for A. The bag (InitPokedudeBag,
// menus/itemMenu.ts) and the party menu (Pokedude_OpenPartyMenuInBattle, menus/partyMenu.ts) run scripted too.
// The option is gSpecialVar_0x8004 (TTVSCR_BATTLE / _STATUS / _MATCHUPS / _CATCHING, set by TeachyTvPrepBattle);
// InitPokedudePartyAndOpponent builds both parties from sPokedudeBattlePartyPointers.
//
// The C reads its scripts past their ends in places (sInputScripts_ChooseAction_Status / _Matchups / _Catching have
// no terminator, sPokedudeTextScripts_* none at all): the ROM's tables follow each other, so each kind is one array
// here, in the C's order, with each option's start in it.

import { IsDma3ManagerBusyWithBgCopy } from '../gba/bg';
import { gfx16 } from '../gba/gfx';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, PALETTES_ALL, RGB_BLACK } from '../gba/hw';
import { gMain, JOY_NEW, A_BUTTON } from '../gba/main';
import { BeginFastPaletteFade, BeginNormalPaletteFade, gPaletteFade, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  AllocSpritePalette,
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  GetSpriteTileStartByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  SpriteCallbackDummy,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
} from '../gba/sprite';
import { FadeOutMapMusic, PlayBGM, PlayCry_Normal, PlayFanfare, PlaySE, PlaySE12WithPanning } from '../gba/sound';
import { CreateTask, DestroyTask, gTasks, TaskDummy } from '../gba/task';
import { FreeAllWindowBuffers, IsTextPrinterActive } from '../gba/window';
import { InitPokedudeBag } from '../menus/itemMenu';
import { SpecialVar } from '../menus/itemMenuState';
import { gPartyMenuUseExitCallback, gSelectedMonPartyId, Pokedude_OpenPartyMenuInBattle } from '../menus/partyMenu';
import type { Pokemon } from '../pokemon/Pokemon';
import { DoMoveAnim, SetMoveAnimGlobalsFromBuffer } from './anim/battleAnim';
import { anim } from './anim/state';
import { BattleMainCB2 } from './battleCallbacks';
import { CreatePartyStatusSummarySprites, SetBattleBarStruct, SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible, Task_HidePartyStatusSummary, UpdateHealthboxAttribute, UpdateHpTextInHealthbox } from './battleInterface';
import { HandleIntroSlide } from './battleIntro';
import { BattlePutTextOnWindow } from './battleWindow';
import { K } from './constants';
import { handleGetMonData, handleSetMonData, healthbarStep, hitAnimBlinkStep, startExpTask } from './controllerCommon';
import { BtlCtrl_DrawVoiceoverMessageFrame, BtlCtrl_RemoveVoiceoverMessageFrame, DoFreeHealthboxPalsForLevelUp, DoLoadHealthboxPalsForLevelUp } from './controllerOakOldMan';
import {
  ActionSelectionCreateCursorAt,
  ActionSelectionDestroyCursorAt,
  drawActionMenu,
  InitMoveSelectionsVarsAndStrings,
  MoveSelectionCreateCursorAt,
  MoveSelectionDestroyCursorAt,
  SpriteCB_FreePlayerSpriteLoadMonSprite,
  Task_PlayerController_RestoreBgmAfterCry,
  TryShinyAnimation,
} from './controllerPlayer';
import { emitChosenMonReturnValue, emitOneReturnValue, emitTwoReturnValues } from './controllers';
import { bdata, g, pokemon, state } from './env';
import { bit } from './globals';
import {
  BattleLoadOpponentMonSpriteGfx,
  BattleLoadPlayerMonSpriteGfx,
  BattleStopLowHpSound,
  ClearTemporarySpeciesSpriteData,
  CopyAllBattleSpritesInvisibilities,
  CopyBattleSpriteInvisibility,
  CreateInvisibleSpriteWithCallback,
  DecompressTrainerBackPalette,
  DecompressTrainerFrontPic,
  DoBounceEffect,
  DoHitAnimHealthboxEffect,
  DoPokeballSendOutAnimation,
  EndBounceEffect,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  gMultiuseSpriteTemplate,
  HandleLowHpMusicChange,
  InitAndLaunchChosenStatusAnimation,
  InitAndLaunchSpecialAnimation,
  IsBattleSEPlaying,
  IsMoveWithoutAnimation,
  LoadBattleBarGfx,
  SetBattlerShadowSpriteCallback,
  SetBattlerSpriteAffineMode,
  SetMultiuseSpriteTemplateToPokemon,
  SetMultiuseSpriteTemplateToTrainerBack,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  SpriteCB_FaintOpponentMon,
  SpriteCB_FaintSlideAnim,
  SpriteCB_TrainerSlideIn,
  SpriteCB_WaitForBattlerBallReleaseAnim,
  StartAnimLinearTranslation,
  StartHealthboxSlideIn,
  TryHandleLaunchBattleTableAnimation,
  TrySetBehindSubstituteSpriteBit,
} from './gfx';
import { battleStringExpandPlaceholdersToDisplayedString, battleStringShouldBeColored, bufferStringBattle, encodeBattleText } from './message';
import { setMonMoveSlot } from './pokemonBattle';
import type { HpAndStatus } from './structs';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const bufA = () => g.battleBufferA[g.activeBattler];
const sbd = () => g.battleSpritesDataPtr;
const sim = () => g.battleStruct.simulatedInputState;
const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;
/** The battler's party: gPlayerParty or gEnemyParty by side (the C's `if (GetBattlerSide(...) == B_SIDE_PLAYER)`). */
const sideParty = (battler: number) => (getBattlerSide(battler) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty);
const playerMonOf = (battler: number) => g.playerParty[g.battlerPartyIndexes[battler]]!;
const enemyMonOf = (battler: number) => g.enemyParty[g.battlerPartyIndexes[battler]]!;

// gBattleStruct->simulatedInputState
const pdHealthboxPal1 = 0;
const pdHealthboxPal2 = 1;
const pdScriptNum = 2;
const pdMessageNo = 3;

/** struct PokedudeBattlerState (all u8) */
interface PokedudeBattlerState {
  action_idx: number;
  move_idx: number;
  timer: number;
  msg_idx: number;
  saved_bg0y: number;
}

/** gPokedudeBattlerStates: AllocateBattleResources allocates them for a BATTLE_TYPE_POKEDUDE battle. */
export const gPokedudeBattlerStates: (PokedudeBattlerState | null)[] = [null, null, null, null];
const pd = (battler = g.activeBattler) => gPokedudeBattlerStates[battler]!;

/** AllocateBattleResources' part (battle_util2.c) */
export function AllocPokedudeBattlerStates(): void {
  for (let i = 0; i < 4; i++) gPokedudeBattlerStates[i] = { action_idx: 0, move_idx: 0, timer: 0, msg_idx: 0, saved_bg0y: 0 };
}

/** FreeBattleResources' part */
export function FreePokedudeBattlerStates(): void {
  gPokedudeBattlerStates.fill(null);
}

const PokedudeDummy = (): void => {};

/** SetControllerToPokedude */
export function SetControllerToPokedude(): void {
  g.battlerControllerFuncs[ab()] = PokedudeBufferRunCommand;
  sim()[pdScriptNum] = state.getVar('VAR_0x8004');
  sim()[pdMessageNo] = 0;
}

function PokedudeBufferRunCommand(): void {
  if (g.battleControllerExecFlags & bit(ab())) {
    const cmd = sPokedudeBufferCommands()[bufA()[0]];
    if (cmd) {
      if (!HandlePokedudeVoiceoverEtc()) cmd();
    } else {
      PokedudeBufferExecCompleted();
    }
  }
}

function HandleInputChooseAction(): void {
  PokedudeSimulateInputChooseAction();
}

function CompleteOnBattlerSpriteCallbackDummy(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) PokedudeBufferExecCompleted();
}

/** CompleteOnBattlerSpritePosX_0: PokedudeHandleLoadMonSprite sets it and completes in the same call, so it never runs. */
function CompleteOnBattlerSpritePosX_0(): void {
  const a = ab();
  const s = gSprites[g.battlerSpriteIds[a]];
  const h = sbd().healthBoxesData[a];
  if (s.animEnded && s.x2 === 0) {
    if (!h.triedShinyMonAnim) {
      TryShinyAnimation(a); // &gEnemyParty[gBattlerPartyIndexes[gActiveBattler]]
    } else if (h.finishedShinyMonAnim) {
      h.triedShinyMonAnim = h.finishedShinyMonAnim = 0;
      FreeSpriteTilesByTag(K.ANIM_TAG_GOLD_STARS);
      FreeSpritePaletteByTag(K.ANIM_TAG_GOLD_STARS);
      PokedudeBufferExecCompleted();
    }
  }
}

function CompleteOnInactiveTextPrinter(): void {
  if (!IsTextPrinterActive(0)) PokedudeBufferExecCompleted();
}

/** Pokedude_SetBattleEndCallbacks: only for a link battle's non-master (PokedudeHandleCmd55), so never. */
function Pokedude_SetBattleEndCallbacks(): void {
  if (!gPaletteFade.active) {
    gMain.inBattle = false;
    g.onBattleEnd?.(g.battleOutcome); // gMain.callback1 = gPreBattleCallback1; SetMainCallback2(gMain.savedCallback)
  }
}

function SwitchIn_HandleSoundAndEnd(): void {
  const a = ab();
  if (!sbd().healthBoxesData[a].specialAnimActive) {
    CreateTask(Task_PlayerController_RestoreBgmAfterCry, 10);
    HandleLowHpMusicChange(playerMonOf(a), a);
    PokedudeBufferExecCompleted();
  }
}

function SwitchIn_CleanShinyAnimShowSubstitute(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy && h.finishedShinyMonAnim) {
    h.triedShinyMonAnim = h.finishedShinyMonAnim = 0;
    FreeSpriteTilesByTag(K.ANIM_TAG_GOLD_STARS);
    FreeSpritePaletteByTag(K.ANIM_TAG_GOLD_STARS);
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
    g.battlerControllerFuncs[a] = SwitchIn_HandleSoundAndEnd;
  }
}

function SwitchIn_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (!h.triedShinyMonAnim && !h.ballAnimActive) TryShinyAnimation(a);
  if (gSprites[g.battleControllerData[a]].callback === SpriteCallbackDummy && !h.ballAnimActive) {
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], playerMonOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    CopyBattleSpriteInvisibility(a);
    g.battlerControllerFuncs[a] = SwitchIn_CleanShinyAnimShowSubstitute;
  }
}

function CompleteOnSpecialAnimDone(): void {
  if (!g.doingBattleAnim) PokedudeBufferExecCompleted();
}

function Intro_DelayAndEnd(): void {
  const h = sbd().healthBoxesData[ab()];
  h.introEndDelay = (h.introEndDelay - 1) & 0xff;
  if (h.introEndDelay === 0xff) {
    h.introEndDelay = 0;
    PokedudeBufferExecCompleted();
  }
}

function PokedudeHandleInputChooseMove(): void {
  PokedudeSimulateInputChooseMove();
}

function OpenPartyMenuToChooseMon(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = WaitForMonSelection;
    DestroyTask(g.battleControllerData[ab()]);
    FreeAllWindowBuffers();
    Pokedude_OpenPartyMenuInBattle();
  }
}

function WaitForMonSelection(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    if (gPartyMenuUseExitCallback === true) emitChosenMonReturnValue(K.BUFFER_B, gSelectedMonPartyId, g.battlePartyCurrentOrder);
    else emitChosenMonReturnValue(K.BUFFER_B, K.PARTY_SIZE, [0, 0, 0]);
    PokedudeBufferExecCompleted();
  }
}

function OpenBagAndChooseItem(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = CompleteWhenChoseItem;
    // ReshowBattleScreenDummy
    FreeAllWindowBuffers();
    // TTVSCR_STATUS (and default) / TTVSCR_CATCHING
    const callbackId = state.getVar('VAR_0x8004') === 3 ? K.ITEMMENULOCATION_TTVSCR_CATCHING : K.ITEMMENULOCATION_TTVSCR_STATUS;
    InitPokedudeBag(callbackId);
  }
}

function CompleteWhenChoseItem(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    emitOneReturnValue(K.BUFFER_B, SpecialVar.ItemId);
    PokedudeBufferExecCompleted();
  }
}

function Intro_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const b = a ^ K.BIT_FLANK;
  const h = sbd().healthBoxesData;
  if (!h[a].triedShinyMonAnim && !h[a].ballAnimActive) TryShinyAnimation(a);
  if (!h[b].triedShinyMonAnim && !h[b].ballAnimActive) TryShinyAnimation(b);
  if (!h[a].ballAnimActive && !h[b].ballAnimActive) {
    if (isDoubleBattle() && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
      DestroySprite(gSprites[g.battleControllerData[b]]);
      UpdateHealthboxAttribute(g.healthboxSpriteIds[b], playerMonOf(b), K.HEALTHBOX_ALL);
      StartHealthboxSlideIn(b);
      SetHealthboxSpriteVisible(g.healthboxSpriteIds[b]);
    }
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], playerMonOf(a), K.HEALTHBOX_ALL);
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
    CreateTask(Task_PlayerController_RestoreBgmAfterCry, 10);
    HandleLowHpMusicChange(playerMonOf(a), a);
    g.battlerControllerFuncs[a] = Intro_DelayAndEnd;
  }
}

function FreeMonSpriteAfterFaintAnim(): void {
  const a = ab();
  const s = gSprites[g.battlerSpriteIds[a]];
  if (getBattlerSide(a) === K.B_SIDE_PLAYER) {
    if (s.y + s.y2 > DISPLAY_HEIGHT) {
      FreeOamMatrix(s.oam.matrixNum);
      DestroySprite(s);
      SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
      PokedudeBufferExecCompleted();
    }
  } else if (!s.inUse) {
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    PokedudeBufferExecCompleted();
  }
}

/** CompleteOnHealthbarDone: the low HP check reads gPlayerParty for either side, as the C does. */
function CompleteOnHealthbarDone(): void {
  if (healthbarStep(g.playerParty)) PokedudeBufferExecCompleted();
}

function CompleteOnInactiveTextPrinter2(): void {
  if (!IsTextPrinterActive(0)) PokedudeBufferExecCompleted();
}

function DoHitAnimBlinkSpriteEffect(): void {
  if (hitAnimBlinkStep()) PokedudeBufferExecCompleted();
}

function DoSwitchOutAnimation(): void {
  const a = ab();
  if (!sbd().healthBoxesData[a].specialAnimActive) {
    const s = gSprites[g.battlerSpriteIds[a]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    PokedudeBufferExecCompleted();
  }
}

function CompleteOnBattlerSpriteCallbackDummy2(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) PokedudeBufferExecCompleted();
}

function CompleteOnFinishedBattleAnimation(): void {
  if (!sbd().healthBoxesData[ab()].animFromTableActive) PokedudeBufferExecCompleted();
}

function CompleteOnFinishedStatusAnimation(): void {
  if (!sbd().healthBoxesData[ab()].statusAnimActive) PokedudeBufferExecCompleted();
}

function PokedudeBufferExecCompleted(): void {
  g.battlerControllerFuncs[ab()] = PokedudeBufferRunCommand;
  // BATTLE_TYPE_LINK: PrepareBufferDataTransferLink (no link play)
  g.battleControllerExecFlags = (g.battleControllerExecFlags & ~bit(ab())) >>> 0;
}

// ---------------------------------------------------------------- handlers

function PokedudeHandleGetMonData(): void {
  handleGetMonData(sideParty(ab())); // CopyPokedudeMonData
  PokedudeBufferExecCompleted();
}

/** PokedudeHandleSetMonData: SetPokedudeMonData ends with HandleLowHpMusicChange on gPlayerParty, per mon set. */
function PokedudeHandleSetMonData(): void {
  const a = ab();
  handleSetMonData(sideParty(a));
  const monToCheck = bufA()[2];
  const sets = monToCheck === 0 ? 1 : [0, 1, 2, 3, 4, 5].filter((i) => monToCheck & (1 << i)).length;
  for (let i = 0; i < sets; i++) HandleLowHpMusicChange(playerMonOf(a), a);
  PokedudeBufferExecCompleted();
}

function PokedudeHandleLoadMonSprite(): void {
  const a = ab();
  const mon = enemyMonOf(a);
  const species = mon.species;
  BattleLoadOpponentMonSpriteGfx(mon, a);
  const y = GetBattlerSpriteDefault_Y(a);
  SetMultiuseSpriteTemplateToPokemon(species, getBattlerPosition(a));
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(a, K.BATTLER_COORD_X_2), y, GetBattlerSpriteSubpriority(a)));
  const s = gSprites[id];
  s.x2 = -DISPLAY_WIDTH;
  s.data[0] = a;
  s.data[2] = species;
  s.oam.paletteNum = a;
  StartSpriteAnim(s, g.battleMonForms[a]);
  SetBattlerShadowSpriteCallback(a, species);
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpritePosX_0;
  PokedudeBufferExecCompleted();
}

function PokedudeHandleSwitchInAnim(): void {
  const a = ab();
  ClearTemporarySpeciesSpriteData(a, bufA()[2]);
  g.battlerPartyIndexes[a] = bufA()[1];
  BattleLoadPlayerMonSpriteGfx(playerMonOf(a), a);
  g.actionSelectionCursor[a] = 0;
  g.moveSelectionCursor[a] = 0;
  StartSendOutAnim(a);
  g.battlerControllerFuncs[a] = SwitchIn_TryShinyAnimShowHealthbox;
}

function PokedudeHandleReturnMonToBall(): void {
  const a = ab();
  if (bufA()[1] === 0) {
    InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SWITCH_OUT_PLAYER_MON);
    g.battlerControllerFuncs[a] = DoSwitchOutAnimation;
  } else {
    const s = gSprites[g.battlerSpriteIds[a]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    PokedudeBufferExecCompleted();
  }
}

const pokedudeBackY = () => (8 - (bdata.tables.coords.trainerBack[K.TRAINER_BACK_PIC_POKEDUDE]?.[0] ?? 8)) * 4 + 80;

function PokedudeHandleDrawTrainerPic(): void {
  const a = ab();
  if (getBattlerSide(a) === K.B_SIDE_PLAYER) {
    DecompressTrainerBackPalette(K.TRAINER_BACK_PIC_POKEDUDE, a);
    SetMultiuseSpriteTemplateToTrainerBack(K.TRAINER_BACK_PIC_POKEDUDE, getBattlerPosition(a));
    const s = gSprites[(g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 80, pokedudeBackY(), 30))];
    s.x2 = DISPLAY_WIDTH;
    s.data[0] = -2;
    s.oam.paletteNum = a;
    s.callback = SpriteCB_TrainerSlideIn;
  } else {
    // Oak's front pic: only for a trainer battle, which the Pokédude's aren't
    const trainerPicId = K.TRAINER_PIC_PROFESSOR_OAK;
    DecompressTrainerFrontPic(trainerPicId, a);
    SetMultiuseSpriteTemplateToTrainerBack(trainerPicId, getBattlerPosition(a));
    const y = (8 - (bdata.tables.coords.trainerFront[trainerPicId]?.[0] ?? 8)) * 4 + 40;
    const s = gSprites[(g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 176, y, GetBattlerSpriteSubpriority(a)))];
    s.x2 = -DISPLAY_WIDTH;
    s.data[0] = 2;
    s.oam.paletteNum = IndexOfSpritePaletteTag(trainerPicId); // gTrainerFrontPicPaletteTable[id].tag is the pic id
    s.data[5] = s.oam.tileNum;
    s.oam.tileNum = GetSpriteTileStartByTag(trainerPicId);
    s.oam.affineParam = trainerPicId;
    s.callback = SpriteCB_TrainerSlideIn;
  }
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpriteCallbackDummy;
}

function PokedudeHandleTrainerSlide(): void {
  const a = ab();
  DecompressTrainerBackPalette(K.TRAINER_BACK_PIC_POKEDUDE, a);
  SetMultiuseSpriteTemplateToTrainerBack(K.TRAINER_BACK_PIC_POKEDUDE, getBattlerPosition(a));
  const s = gSprites[(g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 80, pokedudeBackY(), 30))];
  s.oam.paletteNum = a;
  s.x2 = -96;
  s.data[0] = 2;
  s.callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpriteCallbackDummy2;
}

function PokedudeHandleFaintAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (h.animationState === 0) {
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
    ++h.animationState;
  } else if (!h.specialAnimActive) {
    h.animationState = 0;
    const s = gSprites[g.battlerSpriteIds[a]];
    if (getBattlerSide(a) === K.B_SIDE_PLAYER) {
      HandleLowHpMusicChange(playerMonOf(a), a);
      PlaySE12WithPanning(K.SE_FAINT, K.SOUND_PAN_ATTACKER);
      s.data[1] = 0;
      s.data[2] = 5;
      s.callback = SpriteCB_FaintSlideAnim;
    } else {
      PlaySE12WithPanning(K.SE_FAINT, K.SOUND_PAN_TARGET);
      s.callback = SpriteCB_FaintOpponentMon;
    }
    g.battlerControllerFuncs[a] = FreeMonSpriteAfterFaintAnim;
  }
}

/** PokedudeHandleSuccessBallThrowAnim / PokedudeHandleBallThrowAnim: B_ANIM_BALL_THROW (no trainer sprite) */
function ballThrowAnim(caseId: number): void {
  sbd().animationData.ballThrowCaseId = caseId;
  g.doingBattleAnim = true;
  InitAndLaunchSpecialAnimation(ab(), ab(), getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT), K.B_ANIM_BALL_THROW);
  g.battlerControllerFuncs[ab()] = CompleteOnSpecialAnimDone;
}

function PokedudeHandleMoveAnimation(): void {
  const move = bufA()[1] | (bufA()[2] << 8);
  SetMoveAnimGlobalsFromBuffer(ab());
  if (IsMoveWithoutAnimation(move, bufA()[3])) {
    PokedudeBufferExecCompleted();
  } else {
    sbd().healthBoxesData[ab()].animationState = 0;
    g.battlerControllerFuncs[ab()] = PokedudeDoMoveAnimation;
  }
}

function PokedudeDoMoveAnimation(): void {
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
        SetBattlerSpriteAffineMode(0); // ST_OAM_AFFINE_OFF
        DoMoveAnim(bufA()[1] | (bufA()[2] << 8));
        h.animationState = 2;
      }
      break;
    case 2:
      anim.scriptCallback();
      if (!anim.scriptActive) {
        SetBattlerSpriteAffineMode(1); // ST_OAM_AFFINE_NORMAL
        if (bd.behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
        h.animationState = 3;
      }
      break;
    case 3:
      if (!h.specialAnimActive) {
        CopyAllBattleSpritesInvisibilities();
        TrySetBehindSubstituteSpriteBit(a, bufA()[1] | (bufA()[2] << 8));
        h.animationState = 0;
        PokedudeBufferExecCompleted();
      }
      break;
  }
}

function PokedudeHandlePrintString(): void {
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  const stringId = bufA()[2] | (bufA()[3] << 8);
  bufferStringBattle(stringId);
  BattlePutTextOnWindow(g.displayedStringBattle, battleStringShouldBeColored(stringId) ? K.B_WIN_MSG | K.B_TEXT_FLAG_NPC_CONTEXT_FONT : K.B_WIN_MSG);
  g.battlerControllerFuncs[ab()] = CompleteOnInactiveTextPrinter;
}

function PokedudeHandlePrintSelectionString(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) PokedudeHandlePrintString();
  else PokedudeBufferExecCompleted();
}

function HandleChooseActionAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 160;
    g.battlerControllerFuncs[ab()] = HandleInputChooseAction;
  }
}

function PokedudeHandleChooseAction(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) {
    g.battlerControllerFuncs[ab()] = HandleChooseActionAfterDma3;
    drawActionMenu('gText_WhatWillPkmnDo');
  } else {
    g.battlerControllerFuncs[ab()] = HandleInputChooseAction;
  }
}

function PokedudeHandleChooseMoveAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 320;
    g.battlerControllerFuncs[ab()] = PokedudeHandleInputChooseMove;
  }
}

function PokedudeHandleChooseMove(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) {
    InitMoveSelectionsVarsAndStrings();
    g.battlerControllerFuncs[ab()] = PokedudeHandleChooseMoveAfterDma3;
  } else {
    g.battlerControllerFuncs[ab()] = PokedudeHandleInputChooseMove;
  }
}

function PokedudeHandleChooseItem(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[ab()] = OpenBagAndChooseItem;
  g.battlerInMenuId = ab();
  for (let i = 0; i < 3; ++i) g.battlePartyCurrentOrder[i] = bufA()[i + 1];
}

function PokedudeHandleChoosePokemon(): void {
  const a = ab();
  g.battleControllerData[a] = CreateTask(TaskDummy, 0xff);
  gTasks[g.battleControllerData[a]].data[0] = bufA()[1] & 0xf;
  g.battleStruct.battlerPreventingSwitchout = bufA()[1] >> 4;
  g.battleStruct.playerPartyIdx = bufA()[2];
  g.battleStruct.abilityPreventingSwitchout = bufA()[3];
  for (let i = 0; i < 3; ++i) g.battlePartyCurrentOrder[i] = bufA()[4 + i];
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[a] = OpenPartyMenuToChooseMon;
  g.battlerInMenuId = a;
}

function PokedudeHandleHealthBarUpdate(): void {
  const a = ab();
  const mon = sideParty(a)[g.battlerPartyIndexes[a]]!;
  LoadBattleBarGfx(0);
  const hpVal = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
  if (hpVal !== K.INSTANT_HP_BAR_DROP) {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, mon.hp, hpVal);
  } else {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, 0, hpVal);
    UpdateHpTextInHealthbox(g.healthboxSpriteIds[a], 0, K.HP_CURRENT);
  }
  g.battlerControllerFuncs[a] = CompleteOnHealthbarDone;
}

function PokedudeHandleExpUpdate(): void {
  const monId = bufA()[1];
  if (g.playerParty[monId]!.level >= K.MAX_LEVEL) {
    PokedudeBufferExecCompleted();
  } else {
    LoadBattleBarGfx(1);
    const expPointsToGive = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
    startExpTask(monId, expPointsToGive, ab(), (b) => (g.battlerControllerFuncs[b] = CompleteOnInactiveTextPrinter2), false);
    g.battlerControllerFuncs[ab()] = PokedudeDummy;
  }
}

function PokedudeHandleStatusIconUpdate(): void {
  const a = ab();
  if (IsBattleSEPlaying(a)) return;
  UpdateHealthboxAttribute(g.healthboxSpriteIds[a], sideParty(a)[g.battlerPartyIndexes[a]]!, K.HEALTHBOX_STATUS_ICON);
  sbd().healthBoxesData[a].statusAnimActive = 0;
  g.battlerControllerFuncs[a] = CompleteOnFinishedStatusAnimation;
}

function PokedudeHandleStatusAnimation(): void {
  if (IsBattleSEPlaying(ab())) return;
  const b = bufA();
  InitAndLaunchChosenStatusAnimation(!!b[1], (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0);
  g.battlerControllerFuncs[ab()] = CompleteOnFinishedStatusAnimation;
}

function PokedudeHandleStatusXor(): void {
  const mon = sideParty(ab())[g.battlerPartyIndexes[ab()]]!;
  mon.status = (mon.status ^ bufA()[1]) & 0xff; // the C stores it via a u8
  PokedudeBufferExecCompleted();
}

function PokedudeHandleHitAnimation(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.invisible) {
    PokedudeBufferExecCompleted();
  } else {
    g.doingBattleAnim = true;
    s.data[1] = 0;
    DoHitAnimHealthboxEffect(ab());
    g.battlerControllerFuncs[ab()] = DoHitAnimBlinkSpriteEffect;
  }
}

function PokedudeHandleFaintingCry(): void {
  const mon = sideParty(ab())[g.battlerPartyIndexes[ab()]]!;
  PlayCry_Normal(mon.species, 25);
  PokedudeBufferExecCompleted();
}

function PokedudeHandleIntroTrainerBallThrow(): void {
  const a = ab();
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
  LoadPalette(gfx16(bdata.anims.trainerBackPalettes[K.TRAINER_BACK_PIC_POKEDUDE]), OBJ_PLTT_ID(paletteNum), PLTT_SIZE_4BPP);
  s.oam.paletteNum = paletteNum;
  const taskId = CreateTask(Task_StartSendOutAnim, 5);
  gTasks[taskId].data[0] = a;
  if (sbd().healthBoxesData[a].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[a]].func = Task_HidePartyStatusSummary;
  sbd().animationData.introAnimActive = 1;
  g.battlerControllerFuncs[a] = PokedudeDummy;
}

/** StartSendOutAnim: always from gPlayerParty (only the player's side sends out). */
function StartSendOutAnim(battlerId: number): void {
  sbd().battlerData[battlerId].transformSpecies = K.SPECIES_NONE;
  g.battlerPartyIndexes[battlerId] = g.battleBufferA[battlerId][1];
  const species = playerMonOf(battlerId).species;
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

function PokedudeHandleDrawPartyStatusSummary(): void {
  const a = ab();
  if (bufA()[1] !== 0 && getBattlerSide(a) === K.B_SIDE_PLAYER) {
    PokedudeBufferExecCompleted();
  } else {
    sbd().healthBoxesData[a].partyStatusSummaryShown = 1;
    g.battlerStatusSummaryTaskId[a] = CreatePartyStatusSummarySprites(a, g.battleBufferAObj[a] as HpAndStatus[], !!bufA()[1], !!bufA()[2]);
    PokedudeBufferExecCompleted();
  }
}

function PokedudeHandleEndBounceEffect(): void {
  EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
  EndBounceEffect(ab(), K.BOUNCE_MON);
  PokedudeBufferExecCompleted();
}

function PokedudeHandleBattleAnimation(): void {
  const animationId = bufA()[1];
  const argument = bufA()[2] | (bufA()[3] << 8);
  if (TryHandleLaunchBattleTableAnimation(ab(), ab(), ab(), animationId, argument)) PokedudeBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = CompleteOnFinishedBattleAnimation;
}

function PokedudeHandleLinkStandbyMsg(): void {
  switch (bufA()[1]) {
    case 0:
    case 1:
      EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
      EndBounceEffect(ab(), K.BOUNCE_MON);
      break;
  }
  PokedudeBufferExecCompleted();
}

function PokedudeHandleCmd55(): void {
  g.battleOutcome = bufA()[1];
  FadeOutMapMusic(5);
  BeginFastPaletteFade(3); // FAST_FADE_OUT_TO_BLACK
  PokedudeBufferExecCompleted();
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_IS_MASTER) && g.battleTypeFlags & K.BATTLE_TYPE_LINK) g.battlerControllerFuncs[ab()] = Pokedude_SetBattleEndCallbacks;
}

const complete = PokedudeBufferExecCompleted;

let commands: Record<number, () => void> | undefined;
function sPokedudeBufferCommands(): Record<number, () => void> {
  return (commands ??= {
    [K.CONTROLLER_GETMONDATA]: PokedudeHandleGetMonData,
    [K.CONTROLLER_GETRAWMONDATA]: complete, // PlayerHandleGetRawMonData: raw struct reads aren't used by FRLG battle scripts
    [K.CONTROLLER_SETMONDATA]: PokedudeHandleSetMonData,
    [K.CONTROLLER_SETRAWMONDATA]: complete,
    [K.CONTROLLER_LOADMONSPRITE]: PokedudeHandleLoadMonSprite,
    [K.CONTROLLER_SWITCHINANIM]: PokedudeHandleSwitchInAnim,
    [K.CONTROLLER_RETURNMONTOBALL]: PokedudeHandleReturnMonToBall,
    [K.CONTROLLER_DRAWTRAINERPIC]: PokedudeHandleDrawTrainerPic,
    [K.CONTROLLER_TRAINERSLIDE]: PokedudeHandleTrainerSlide,
    [K.CONTROLLER_TRAINERSLIDEBACK]: complete,
    [K.CONTROLLER_FAINTANIMATION]: PokedudeHandleFaintAnimation,
    [K.CONTROLLER_PALETTEFADE]: complete,
    [K.CONTROLLER_SUCCESSBALLTHROWANIM]: () => ballThrowAnim(K.BALL_3_SHAKES_SUCCESS),
    [K.CONTROLLER_BALLTHROWANIM]: () => ballThrowAnim(bufA()[1]),
    [K.CONTROLLER_PAUSE]: complete,
    [K.CONTROLLER_MOVEANIMATION]: PokedudeHandleMoveAnimation,
    [K.CONTROLLER_PRINTSTRING]: PokedudeHandlePrintString,
    [K.CONTROLLER_PRINTSTRINGPLAYERONLY]: PokedudeHandlePrintSelectionString,
    [K.CONTROLLER_CHOOSEACTION]: PokedudeHandleChooseAction,
    [K.CONTROLLER_UNKNOWNYESNOBOX]: complete,
    [K.CONTROLLER_CHOOSEMOVE]: PokedudeHandleChooseMove,
    [K.CONTROLLER_OPENBAG]: PokedudeHandleChooseItem,
    [K.CONTROLLER_CHOOSEPOKEMON]: PokedudeHandleChoosePokemon,
    [K.CONTROLLER_23]: complete,
    [K.CONTROLLER_HEALTHBARUPDATE]: PokedudeHandleHealthBarUpdate,
    [K.CONTROLLER_EXPUPDATE]: PokedudeHandleExpUpdate,
    [K.CONTROLLER_STATUSICONUPDATE]: PokedudeHandleStatusIconUpdate,
    [K.CONTROLLER_STATUSANIMATION]: PokedudeHandleStatusAnimation,
    [K.CONTROLLER_STATUSXOR]: PokedudeHandleStatusXor,
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
    [K.CONTROLLER_HITANIMATION]: PokedudeHandleHitAnimation,
    [K.CONTROLLER_CANTSWITCH]: complete,
    [K.CONTROLLER_PLAYSE]: () => {
      PlaySE(bufA()[1] | (bufA()[2] << 8)); // PokedudeHandlePlaySE: no panning
      complete();
    },
    [K.CONTROLLER_PLAYFANFARE]: () => {
      PlayFanfare(bufA()[1] | (bufA()[2] << 8));
      complete();
    },
    [K.CONTROLLER_FAINTINGCRY]: PokedudeHandleFaintingCry,
    [K.CONTROLLER_INTROSLIDE]: () => {
      HandleIntroSlide(bufA()[1]);
      g.introSlideFlags |= 1;
      complete();
    },
    [K.CONTROLLER_INTROTRAINERBALLTHROW]: PokedudeHandleIntroTrainerBallThrow,
    [K.CONTROLLER_DRAWPARTYSTATUSSUMMARY]: PokedudeHandleDrawPartyStatusSummary,
    [K.CONTROLLER_HIDEPARTYSTATUSSUMMARY]: complete,
    [K.CONTROLLER_ENDBOUNCE]: PokedudeHandleEndBounceEffect,
    [K.CONTROLLER_SPRITEINVISIBILITY]: complete,
    [K.CONTROLLER_BATTLEANIMATION]: PokedudeHandleBattleAnimation,
    [K.CONTROLLER_LINKSTANDBYMSG]: PokedudeHandleLinkStandbyMsg,
    [K.CONTROLLER_RESETACTIONMOVESELECTION]: complete,
    [K.CONTROLLER_ENDLINKBATTLE]: PokedudeHandleCmd55,
    [K.CONTROLLER_TERMINATOR_NOP]: () => {}, // PokedudeCmdEnd
  });
}

// ---------------------------------------------------------------- the scripts

/** struct PokedudeInputScript: cursorPos 0-3 to choose, 4 (action) / 255 (move) to start over; per battler. */
interface PokedudeInputScript {
  cursorPos: [number, number];
  delay: [number, number];
}
const S = (cursorPos: [number, number], delay: [number, number]): PokedudeInputScript => ({ cursorPos, delay });

// sInputScripts_ChooseAction_Battle, _Status, _Matchups, _Catching, one after the other as in the ROM
const sInputScripts_ChooseAction: PokedudeInputScript[] = [
  S([0, 0], [64, 0]), S([4, 4], [0, 0]),
  S([0, 0], [64, 0]), S([1, 0], [64, 0]), S([0, 0], [64, 0]),
  S([0, 0], [64, 0]), S([2, 0], [64, 0]), S([0, 0], [64, 0]),
  S([0, 0], [64, 0]), S([0, 0], [64, 0]), S([1, 0], [64, 0]),
];
/** sInputScripts_ChooseAction[TTVSCR_*]: each option's first entry */
const sInputScripts_ChooseAction_Start = [0, 2, 5, 8];

// sInputScripts_ChooseMove_Battle, _Status, _Matchups, _Catching
const sInputScripts_ChooseMove: PokedudeInputScript[] = [
  S([2, 2], [64, 0]), S([255, 255], [0, 0]),
  S([2, 2], [64, 0]), S([2, 0], [64, 0]), S([2, 0], [64, 0]), S([255, 255], [0, 0]),
  S([2, 0], [64, 0]), S([0, 0], [64, 0]), S([0, 0], [64, 0]), S([255, 255], [0, 0]),
  S([0, 2], [64, 0]), S([2, 2], [64, 0]), S([255, 255], [0, 0]),
];
const sInputScripts_ChooseMove_Start = [0, 2, 6, 10];

/**
 * The input script entry `idx` of the option's table, read past its end into the next one as the C does. Past the
 * last table (sInputScripts_ChooseAction_Catching's third action checks its next entry for the restart marker) the
 * ROM has the pointer table sInputScripts_ChooseAction, whose bytes aren't modelled: they aren't 4 there.
 */
function inputScript(table: PokedudeInputScript[], start: number[], idx: number): PokedudeInputScript {
  const entry = table[start[sim()[pdScriptNum]] + idx];
  if (entry) return entry;
  console.warn(`[pokedude] input script ${sim()[pdScriptNum]} read past the ROM's tables (${idx})`);
  return S([0xff, 0xff], [0, 0]);
}

/** Whether the entry after the one just used restarts the script (cursorPos 4 / 255). */
function inputScriptRestarts(table: PokedudeInputScript[], start: number[], idx: number, marker: number): boolean {
  const entry = table[start[sim()[pdScriptNum]] + idx];
  return entry !== undefined && entry.cursorPos[ab()] === marker;
}

/** struct PokedudeTextScriptHeader */
interface PokedudeTextScriptHeader {
  btlcmd: number;
  side: number;
  stringid: number;
  callback: (() => void) | null;
}

let headers: PokedudeTextScriptHeader[] | undefined;
/** sPokedudeTextScripts_Battle, _Status, _Matchups, _Catching, one after the other */
function sPokedudeTextScripts(): PokedudeTextScriptHeader[] {
  const H = (btlcmd: number, side: number, stringid: number, callback: (() => void) | null): PokedudeTextScriptHeader => ({ btlcmd, side, stringid, callback });
  const P = K.B_SIDE_PLAYER;
  const O = K.B_SIDE_OPPONENT;
  const V = PokedudeAction_PrintVoiceoverMessage;
  return (headers ??= [
    // _Battle
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, O, K.STRINGID_USEDMOVE, V),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, P, K.STRINGID_PKMNGAINEDEXP, V),
    // _Status
    H(K.CONTROLLER_CHOOSEACTION, P, 0, null),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, PokedudeAction_PrintMessageWithHealthboxPals),
    H(K.CONTROLLER_OPENBAG, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, O, K.STRINGID_USEDMOVE, V),
    H(K.CONTROLLER_PRINTSTRING, P, K.STRINGID_PKMNGAINEDEXP, V),
    // _Matchups
    H(K.CONTROLLER_PRINTSTRING, O, K.STRINGID_USEDMOVE, V),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_CHOOSEPOKEMON, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, O, K.STRINGID_USEDMOVE, V),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_CHOOSEMOVE, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, P, K.STRINGID_PKMNGAINEDEXP, V),
    // _Catching
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, null),
    H(K.CONTROLLER_CHOOSEACTION, P, 0, V),
    H(K.CONTROLLER_PRINTSTRING, O, K.STRINGID_PKMNFASTASLEEP, V),
    H(K.CONTROLLER_OPENBAG, P, 0, V),
    H(K.CONTROLLER_ENDLINKBATTLE, P, 0, V),
  ]);
}
const sPokedudeTextScripts_Start = [0, 4, 9, 16];

/** The header the option's message number points at; past the last one, none (the ROM's next data isn't modelled). */
function textScriptHeader(): PokedudeTextScriptHeader | undefined {
  return sPokedudeTextScripts()[sPokedudeTextScripts_Start[sim()[pdScriptNum]] + sim()[pdMessageNo]];
}

// sPokedudeTexts_Battle, _Status, _TypeMatchup, _Catching
const sPokedudeTexts: string[][] = [
  ['Pokedude_Text_SpeedierBattlerGoesFirst', 'Pokedude_Text_MyRattataFasterThanPidgey', 'Pokedude_Text_BattlersTakeTurnsAttacking', 'Pokedude_Text_MyRattataWonGetsEXP'],
  ['Pokedude_Text_UhOhRattataPoisoned', 'Pokedude_Text_UhOhRattataPoisoned', 'Pokedude_Text_HealStatusRightAway', 'Pokedude_Text_UsingItemTakesTurn', 'Pokedude_Text_YayWeManagedToWin'],
  [
    'Pokedude_Text_WaterNotVeryEffectiveAgainstGrass',
    'Pokedude_Text_GrassEffectiveAgainstWater',
    'Pokedude_Text_LetsTryShiftingMons',
    'Pokedude_Text_ShiftingUsesTurn',
    'Pokedude_Text_ButterfreeDoubleResistsGrass',
    'Pokedude_Text_ButterfreeGoodAgainstOddish',
    'Pokedude_Text_YeahWeWon',
  ],
  [
    'Pokedude_Text_WeakenMonBeforeCatching',
    'Pokedude_Text_WeakenMonBeforeCatching',
    'Pokedude_Text_BestIfTargetStatused',
    'Pokedude_Text_CantDoubleUpOnStatus',
    'Pokedude_Text_LetMeThrowBall',
    'Pokedude_Text_PickBestKindOfBall',
  ],
];

/** struct PokedudeBattlePartyInfo */
interface PokedudeBattlePartyInfo {
  side: number;
  level: number;
  species: string;
  moves: string[];
  nature: string;
}

// sParties_Battle, _Status, _Matchups, _Catching (every mon MALE)
const sPokedudeBattlePartyPointers: PokedudeBattlePartyInfo[][] = [
  [
    { side: 0, level: 15, species: 'RATTATA', moves: ['TACKLE', 'TAIL_WHIP', 'HYPER_FANG', 'QUICK_ATTACK'], nature: 'LONELY' },
    { side: 1, level: 18, species: 'PIDGEY', moves: ['TACKLE', 'SAND_ATTACK', 'GUST', 'QUICK_ATTACK'], nature: 'NAUGHTY' },
  ],
  [
    { side: 0, level: 15, species: 'RATTATA', moves: ['TACKLE', 'TAIL_WHIP', 'HYPER_FANG', 'QUICK_ATTACK'], nature: 'LONELY' },
    { side: 1, level: 14, species: 'ODDISH', moves: ['ABSORB', 'SWEET_SCENT', 'POISON_POWDER'], nature: 'RASH' },
  ],
  [
    { side: 0, level: 15, species: 'POLIWAG', moves: ['WATER_GUN', 'HYPNOSIS', 'BUBBLE'], nature: 'RASH' },
    { side: 0, level: 15, species: 'BUTTERFREE', moves: ['CONFUSION', 'POISON_POWDER', 'STUN_SPORE', 'SLEEP_POWDER'], nature: 'RASH' },
    { side: 1, level: 14, species: 'ODDISH', moves: ['ABSORB', 'SWEET_SCENT', 'POISON_POWDER'], nature: 'RASH' },
  ],
  [
    { side: 0, level: 15, species: 'BUTTERFREE', moves: ['CONFUSION', 'POISON_POWDER', 'SLEEP_POWDER', 'STUN_SPORE'], nature: 'RASH' },
    { side: 1, level: 11, species: 'JIGGLYPUFF', moves: ['SING', 'DEFENSE_CURL', 'POUND'], nature: 'CAREFUL' },
  ],
];

const partyMoves = (info: PokedudeBattlePartyInfo) => [0, 1, 2, 3].map((j) => (info.moves[j] ? K[`MOVE_${info.moves[j]}`] : K.MOVE_NONE));

/** The mons and moves of every demo (the battle's graphics are preloaded with Teachy TV's). */
export function pokedudeBattleMons(): { side: number; species: number; personality: number; moves: number[] }[] {
  return sPokedudeBattlePartyPointers.flat().map((info) => ({ side: info.side, species: K[`SPECIES_${info.species}`], personality: 0, moves: partyMoves(info) }));
}

/** gPokedudeBattlerStates[...]->msg_idx etc. are u8 */
const u8 = (v: number) => v & 0xff;

function PokedudeSimulateInputChooseAction(): void {
  const a = ab();
  const st = pd();
  if (getBattlerSide(a) === K.B_SIDE_PLAYER) {
    DoBounceEffect(a, K.BOUNCE_HEALTHBOX, 7, 1);
    DoBounceEffect(a, K.BOUNCE_MON, 7, 1);
  }
  const script = inputScript(sInputScripts_ChooseAction, sInputScripts_ChooseAction_Start, st.action_idx);
  if (script.delay[a] === st.timer) {
    if (getBattlerSide(a) === K.B_SIDE_PLAYER) PlaySE(K.SE_SELECT);
    st.timer = 0;
    switch (script.cursorPos[a]) {
      case 0:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_USE_MOVE, 0);
        break;
      case 1:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_USE_ITEM, 0);
        break;
      case 2:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_SWITCH, 0);
        break;
      case 3:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_RUN, 0);
        break;
    }
    PokedudeBufferExecCompleted();
    st.action_idx = u8(st.action_idx + 1);
    if (inputScriptRestarts(sInputScripts_ChooseAction, sInputScripts_ChooseAction_Start, st.action_idx, 4)) st.action_idx = 0;
  } else {
    if (g.actionSelectionCursor[a] !== script.cursorPos[a] && Math.trunc(script.delay[a] / 2) === st.timer) {
      PlaySE(K.SE_SELECT);
      ActionSelectionDestroyCursorAt(g.actionSelectionCursor[a]);
      g.actionSelectionCursor[a] = script.cursorPos[a];
      ActionSelectionCreateCursorAt(g.actionSelectionCursor[a], 0);
    }
    st.timer = u8(st.timer + 1);
  }
}

function PokedudeSimulateInputChooseMove(): void {
  const a = ab();
  const st = pd();
  const script = inputScript(sInputScripts_ChooseMove, sInputScripts_ChooseMove_Start, st.move_idx);
  if (script.delay[a] === st.timer) {
    if (getBattlerSide(a) === K.B_SIDE_PLAYER) PlaySE(K.SE_SELECT);
    st.timer = 0;
    emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_EXEC_SCRIPT, script.cursorPos[a] | ((a ^ K.BIT_SIDE) << 8));
    PokedudeBufferExecCompleted();
    st.move_idx = u8(st.move_idx + 1);
    if (inputScriptRestarts(sInputScripts_ChooseMove, sInputScripts_ChooseMove_Start, st.move_idx, 255)) st.move_idx = 0;
  } else {
    if (script.cursorPos[a] !== g.moveSelectionCursor[a] && Math.trunc(script.delay[a] / 2) === st.timer) {
      PlaySE(K.SE_SELECT);
      MoveSelectionDestroyCursorAt(g.moveSelectionCursor[a]);
      g.moveSelectionCursor[a] = script.cursorPos[a];
      MoveSelectionCreateCursorAt(g.moveSelectionCursor[a], 0);
    }
    st.timer = u8(st.timer + 1);
  }
}

/** HandlePokedudeVoiceoverEtc: before the command the option's next header names, its voiceover (or just the count). */
function HandlePokedudeVoiceoverEtc(): boolean {
  const header = textScriptHeader();
  if (!header) return false;
  const cmd = bufA()[0];
  if (cmd !== header.btlcmd) return false;
  if (ab() !== header.side) return false;
  if (cmd === K.CONTROLLER_PRINTSTRING && header.stringid !== (bufA()[2] | (bufA()[3] << 8))) return false;
  if (header.callback === null) {
    sim()[pdMessageNo]++;
    return false;
  }
  g.battlerControllerFuncs[ab()] = header.callback;
  pd().timer = 0;
  pd().msg_idx = u8(header.stringid);
  sim()[pdMessageNo]++;
  return true;
}

function ReturnFromPokedudeAction(): void {
  pd().timer = 0;
  g.battlerControllerFuncs[ab()] = PokedudeBufferRunCommand;
}

/** The voiceover's text: the option's text for the header just passed (pdMessageNo - 1). */
function GetPokedudeText(): number[] {
  const texts = sPokedudeTexts[sim()[pdScriptNum]] ?? sPokedudeTexts[0]; // TTVSCR_BATTLE and default
  return encodeBattleText(texts[sim()[pdMessageNo] - 1]);
}

/** For the probe: the voiceover text printed last. */
let sLastText: string | undefined;

function pokedudeSays(): void {
  sLastText = (sPokedudeTexts[sim()[pdScriptNum]] ?? sPokedudeTexts[0])[sim()[pdMessageNo] - 1];
  battleStringExpandPlaceholdersToDisplayedString(GetPokedudeText());
  BattlePutTextOnWindow(g.displayedStringBattle, K.B_WIN_OAK_OLD_MAN);
}

/** PokedudeAction_PrintVoiceoverMessage: everything but the healthboxes (palette 7) darkens, the text waits for A. */
function PokedudeAction_PrintVoiceoverMessage(): void {
  const st = pd();
  switch (st.timer) {
    case 0:
      if (!gPaletteFade.active) {
        BeginNormalPaletteFade(0xffffff7f, 4, 0, 8, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 1:
      if (!gPaletteFade.active) {
        st.saved_bg0y = u8(g.battle_BG0_Y);
        BtlCtrl_DrawVoiceoverMessageFrame();
        ++st.timer;
      }
      break;
    case 2:
      g.battle_BG0_Y = 0;
      pokedudeSays();
      ++st.timer;
      break;
    case 3:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN) && JOY_NEW(A_BUTTON)) {
        PlaySE(K.SE_SELECT);
        BeginNormalPaletteFade(0xffffff7f, 4, 8, 0, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 4:
      if (!gPaletteFade.active) {
        if (st.msg_idx === K.STRINGID_PKMNGAINEDEXP) {
          BattleStopLowHpSound();
          PlayBGM(K.MUS_VICTORY_WILD);
        }
        g.battle_BG0_Y = st.saved_bg0y;
        BtlCtrl_RemoveVoiceoverMessageFrame();
        ReturnFromPokedudeAction();
      }
      break;
  }
}

/** PokedudeAction_PrintMessageWithHealthboxPals: the player's healthbox gets its own palettes and stays lit. */
function PokedudeAction_PrintMessageWithHealthboxPals(): void {
  const st = pd();
  const s = sim();
  const healthboxPalMask = () => ((bit(s[pdHealthboxPal2]) | bit(s[pdHealthboxPal1])) << 16) >>> 0;
  switch (st.timer) {
    case 0:
      if (!gPaletteFade.active) {
        // DoLoadHealthboxPalsForLevelUp(&pdHealthboxPal2, &pdHealthboxPal1, ...)
        const [paletteId1, paletteId2] = DoLoadHealthboxPalsForLevelUp(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT));
        s[pdHealthboxPal2] = paletteId1;
        s[pdHealthboxPal1] = paletteId2;
        BeginNormalPaletteFade(0xffffff7f, 4, 0, 8, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 1:
      if (!gPaletteFade.active) {
        BeginNormalPaletteFade(healthboxPalMask(), 4, 8, 0, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        BtlCtrl_DrawVoiceoverMessageFrame();
        ++st.timer;
      }
      break;
    case 3:
      pokedudeSays();
      ++st.timer;
      break;
    case 4:
      if (!IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN) && JOY_NEW(A_BUTTON)) {
        PlaySE(K.SE_SELECT);
        BeginNormalPaletteFade(healthboxPalMask(), 4, 0, 8, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 5:
      if (!gPaletteFade.active) {
        BeginNormalPaletteFade(0xffffff7f, 4, 8, 0, RGB_BLACK);
        ++st.timer;
      }
      break;
    case 6:
      if (!gPaletteFade.active) {
        if (st.msg_idx === K.STRINGID_PKMNGAINEDEXP) {
          BattleStopLowHpSound();
          PlayBGM(K.MUS_VICTORY_WILD);
        }
        DoFreeHealthboxPalsForLevelUp(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT));
        BtlCtrl_RemoveVoiceoverMessageFrame();
        ReturnFromPokedudeAction();
      }
      break;
  }
}

/**
 * InitPokedudePartyAndOpponent: BATTLE_TYPE_POKEDUDE, and both parties from the option's table (CreateMonWithGenderNatureLetter:
 * fixed IVs 0, the player's OT; then the four move slots).
 */
export function InitPokedudePartyAndOpponent(): void {
  g.battleTypeFlags = K.BATTLE_TYPE_POKEDUDE;
  state.party.length = 0; // ZeroPlayerPartyMons
  const enemy: Pokemon[] = []; // ZeroEnemyPartyMons
  for (const info of sPokedudeBattlePartyPointers[state.getVar('VAR_0x8004')]) {
    const mon = pokemon.createMonWithGenderNatureLetter(K[`SPECIES_${info.species}`], info.level, 0, K.MON_MALE, K[`NATURE_${info.nature}`], {
      otId: state.trainerId,
      otName: state.playerName,
      otGender: state.playerGender,
      metLocation: state.currentMapSection,
    });
    partyMoves(info).forEach((move, j) => setMonMoveSlot(mon, move, j));
    (info.side === K.B_SIDE_PLAYER ? state.party : enemy).push(mon);
  }
  g.playerParty = state.party;
  g.enemyParty = Array.from({ length: K.PARTY_SIZE }, (_, i) => enemy[i]);
}

let sSavedPlayerParty: Pokemon[] | null = null;

/**
 * SavePlayerParty (load_save.c): the party into the save block, where it waits out the Pokédude's battle. GameState's
 * party is both gPlayerParty and the save block's copy here, so it's kept aside.
 */
export function SavePlayerParty(): void {
  sSavedPlayerParty = [...state.party];
}

/** LoadPlayerParty (load_save.c): the party back from the save block. */
export function LoadPlayerParty(): void {
  if (!sSavedPlayerParty) return;
  state.party.length = 0;
  state.party.push(...sSavedPlayerParty);
  sSavedPlayerParty = null;
}

/** The Pokédude's voiceover state, for __test.battle(). */
export function pokedudeProbe() {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE)) return undefined;
  return {
    scriptNum: sim()[pdScriptNum],
    messageNo: sim()[pdMessageNo],
    states: gPokedudeBattlerStates.slice(0, 2).map((s) => (s ? { ...s } : null)),
    /** the voiceover's text (Pokedude_Text_*) printed last, and whether its printer runs */
    text: sLastText,
    textActive: IsTextPrinterActive(K.B_WIN_OAK_OLD_MAN),
  };
}

