// battle_controller_safari.c: the player's controller in Safari Zone battles (BALL / BAIT / ROCK / RUN,
// the player's back pic instead of a mon, SAFARI BALLS on the healthbox).

import { IsDma3ManagerBusyWithBgCopy } from '../gba/bg';
import { DISPLAY_WIDTH, PALETTES_ALL, RGB_BLACK } from '../gba/hw';
import { gMain } from '../gba/main';
import { BeginFastPaletteFade, BeginNormalPaletteFade, gPaletteFade } from '../gba/palette';
import { FadeOutMapMusic, PlayCry_Normal, PlayFanfare, PlaySE, PlaySE12WithPanning } from '../gba/sound';
import { CreateSprite, gSprites, SpriteCallbackDummy } from '../gba/sprite';
import { IsTextPrinterActive } from '../gba/window';
import { SpecialVar } from '../menus/itemMenuState';
import { BattleMainCB2 } from './battleCallbacks';
import { SetHealthboxSpriteVisible, UpdateHealthboxAttribute } from './battleInterface';
import { HandleIntroSlide } from './battleIntro';
import { ui } from './battleUi';
import { BattlePutTextOnWindow } from './battleWindow';
import { K } from './constants';
import { ActionSelectionCreateCursorAt, ActionSelectionDestroyCursorAt, playerBackPic } from './controllerPlayer';
import { emitOneReturnValue, emitTwoReturnValues } from './controllers';
import { bdata, g } from './env';
import { bit } from './globals';
import {
  DecompressTrainerBackPalette,
  gMultiuseSpriteTemplate,
  InitAndLaunchSpecialAnimation,
  SetMultiuseSpriteTemplateToTrainerBack,
  SpriteCB_TrainerSlideIn,
  StartHealthboxSlideIn,
  TryHandleLaunchBattleTableAnimation,
} from './gfx';
import { battleStringExpandPlaceholders, battleStringShouldBeColored, bufferStringBattle, encodeBattleText } from './message';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const bufA = () => g.battleBufferA[g.activeBattler];
const sbd = () => g.battleSpritesDataPtr;
const playerMon = () => g.playerParty[g.battlerPartyIndexes[ab()]]!;

export function SetControllerToSafari(): void {
  g.battlerControllerFuncs[ab()] = SafariBufferRunCommand;
}

function SafariBufferRunCommand(): void {
  if (g.battleControllerExecFlags & bit(ab())) {
    const cmd = sSafariBufferCommands()[bufA()[0]];
    if (cmd) cmd();
    else SafariBufferExecCompleted();
  }
}

/** SafariBufferExecCompleted (link battles aren't supported) */
function SafariBufferExecCompleted(): void {
  g.battlerControllerFuncs[ab()] = SafariBufferRunCommand;
  g.battleControllerExecFlags = (g.battleControllerExecFlags & ~bit(ab())) >>> 0;
}

const SAFARI_ACTIONS = () => [K.B_ACTION_SAFARI_BALL, K.B_ACTION_SAFARI_BAIT, K.B_ACTION_SAFARI_GO_NEAR, K.B_ACTION_SAFARI_RUN];

function HandleInputChooseAction(): void {
  const a = ab();
  const cursor = g.actionSelectionCursor[a];
  // Left/right flip bit 0, up/down bit 1, each only towards the other column/row
  const move = (mask: number, toSet: boolean) => {
    if (!!(cursor & mask) === toSet) return;
    PlaySE(K.SE_SELECT);
    ActionSelectionDestroyCursorAt(cursor);
    g.actionSelectionCursor[a] ^= mask;
    ActionSelectionCreateCursorAt(g.actionSelectionCursor[a], 0);
  };
  if (ui.joyNew('A')) {
    PlaySE(K.SE_SELECT);
    emitTwoReturnValues(K.BUFFER_B, SAFARI_ACTIONS()[cursor], 0);
    SafariBufferExecCompleted();
  } else if (ui.joyNew('LEFT')) {
    move(1, false);
  } else if (ui.joyNew('RIGHT')) {
    move(1, true);
  } else if (ui.joyNew('UP')) {
    move(2, false);
  } else if (ui.joyNew('DOWN')) {
    move(2, true);
  }
}

function CompleteOnBattlerSpriteCallbackDummy(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) SafariBufferExecCompleted();
}

function CompleteOnInactiveTextPrinter(): void {
  if (!IsTextPrinterActive(0)) SafariBufferExecCompleted();
}

function CompleteOnHealthboxSpriteCallbackDummy(): void {
  if (gSprites[g.healthboxSpriteIds[ab()]].callback === SpriteCallbackDummy) SafariBufferExecCompleted();
}

function CompleteOnSpecialAnimDone(): void {
  if (!g.doingBattleAnim || !sbd().healthBoxesData[ab()].specialAnimActive) SafariBufferExecCompleted();
}

function SafariOpenPokeblockCase(): void {
  if (!gPaletteFade.active) g.battlerControllerFuncs[ab()] = CompleteWhenChosePokeblock;
}

/** Pokéblocks don't exist in FRLG; BAIT never opens this (kept from the RSE controller). */
function CompleteWhenChosePokeblock(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    emitOneReturnValue(K.BUFFER_B, SpecialVar.ItemId);
    SafariBufferExecCompleted();
  }
}

function CompleteOnFinishedBattleAnimation(): void {
  if (!sbd().healthBoxesData[ab()].animFromTableActive) SafariBufferExecCompleted();
}

// ---------------------------------------------------------------- handlers

function SafariHandleDrawTrainerPic(): void {
  const a = ab();
  const picId = playerBackPic(); // gSaveBlock2Ptr->playerGender
  DecompressTrainerBackPalette(picId, a);
  SetMultiuseSpriteTemplateToTrainerBack(picId, getBattlerPosition(a));
  const y = (8 - (bdata.tables.coords.trainerBack[picId]?.[0] ?? 8)) * 4 + 80;
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 80, y, 30));
  const s = gSprites[id];
  s.oam.paletteNum = a;
  s.x2 = DISPLAY_WIDTH;
  s.data[0] = -2;
  s.callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpriteCallbackDummy;
}

function ballThrowAnim(caseId: number): void {
  sbd().animationData.ballThrowCaseId = caseId;
  g.doingBattleAnim = true;
  InitAndLaunchSpecialAnimation(ab(), ab(), getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT), K.B_ANIM_BALL_THROW_WITH_TRAINER);
  g.battlerControllerFuncs[ab()] = CompleteOnSpecialAnimDone;
}

function SafariHandlePrintString(): void {
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  const stringId = bufA()[2] | (bufA()[3] << 8);
  bufferStringBattle(stringId);
  BattlePutTextOnWindow(g.displayedStringBattle, battleStringShouldBeColored(stringId) ? K.B_WIN_MSG | K.B_TEXT_FLAG_NPC_CONTEXT_FONT : K.B_WIN_MSG);
  g.battlerControllerFuncs[ab()] = CompleteOnInactiveTextPrinter;
}

function SafariHandlePrintSelectionString(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) SafariHandlePrintString();
  else SafariBufferExecCompleted();
}

function HandleChooseActionAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 160;
    g.battlerControllerFuncs[ab()] = HandleInputChooseAction;
  }
}

function SafariHandleChooseAction(): void {
  g.battlerControllerFuncs[ab()] = HandleChooseActionAfterDma3;
  BattlePutTextOnWindow(encodeBattleText('gText_EmptyString3'), K.B_WIN_MSG);
  BattlePutTextOnWindow(encodeBattleText('gText_SafariZoneMenu'), K.B_WIN_ACTION_MENU);
  for (let i = 0; i < 4; ++i) ActionSelectionDestroyCursorAt(i);
  ActionSelectionCreateCursorAt(g.actionSelectionCursor[ab()], 0);
  g.displayedStringBattle = battleStringExpandPlaceholders(encodeBattleText('gText_WhatWillPlayerThrow'));
  BattlePutTextOnWindow(g.displayedStringBattle, K.B_WIN_ACTION_PROMPT);
}

function SafariHandleChooseItem(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[ab()] = SafariOpenPokeblockCase;
  g.battlerInMenuId = ab();
}

function SafariHandleStatusIconUpdate(): void {
  UpdateHealthboxAttribute(g.healthboxSpriteIds[ab()], playerMon(), K.HEALTHBOX_SAFARI_BALLS_TEXT);
  SafariBufferExecCompleted();
}

function SafariHandleIntroTrainerBallThrow(): void {
  const a = ab();
  UpdateHealthboxAttribute(g.healthboxSpriteIds[a], playerMon(), K.HEALTHBOX_SAFARI_ALL_TEXT);
  StartHealthboxSlideIn(a);
  SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
  g.battlerControllerFuncs[a] = CompleteOnHealthboxSpriteCallbackDummy;
}

function SafariHandleBattleAnimation(): void {
  const animationId = bufA()[1];
  const argument = bufA()[2] | (bufA()[3] << 8);
  if (TryHandleLaunchBattleTableAnimation(ab(), ab(), ab(), animationId, argument)) SafariBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = CompleteOnFinishedBattleAnimation;
}

function SafariHandleCmd55(): void {
  g.battleOutcome = bufA()[1];
  FadeOutMapMusic(5);
  BeginFastPaletteFade(3);
  SafariBufferExecCompleted();
}

let commands: Record<number, () => void> | undefined;

function sSafariBufferCommands(): Record<number, () => void> {
  const complete = SafariBufferExecCompleted;
  return (commands ??= {
    [K.CONTROLLER_GETMONDATA]: complete,
    [K.CONTROLLER_GETRAWMONDATA]: complete,
    [K.CONTROLLER_SETMONDATA]: complete,
    [K.CONTROLLER_SETRAWMONDATA]: complete,
    [K.CONTROLLER_LOADMONSPRITE]: complete,
    [K.CONTROLLER_SWITCHINANIM]: complete,
    [K.CONTROLLER_RETURNMONTOBALL]: complete,
    [K.CONTROLLER_DRAWTRAINERPIC]: SafariHandleDrawTrainerPic,
    [K.CONTROLLER_TRAINERSLIDE]: complete,
    [K.CONTROLLER_TRAINERSLIDEBACK]: complete,
    [K.CONTROLLER_FAINTANIMATION]: complete,
    [K.CONTROLLER_PALETTEFADE]: complete,
    [K.CONTROLLER_SUCCESSBALLTHROWANIM]: () => ballThrowAnim(K.BALL_3_SHAKES_SUCCESS),
    [K.CONTROLLER_BALLTHROWANIM]: () => ballThrowAnim(bufA()[1]),
    [K.CONTROLLER_PAUSE]: complete,
    [K.CONTROLLER_MOVEANIMATION]: complete,
    [K.CONTROLLER_PRINTSTRING]: SafariHandlePrintString,
    [K.CONTROLLER_PRINTSTRINGPLAYERONLY]: SafariHandlePrintSelectionString,
    [K.CONTROLLER_CHOOSEACTION]: SafariHandleChooseAction,
    [K.CONTROLLER_UNKNOWNYESNOBOX]: complete,
    [K.CONTROLLER_CHOOSEMOVE]: complete,
    [K.CONTROLLER_OPENBAG]: SafariHandleChooseItem,
    [K.CONTROLLER_CHOOSEPOKEMON]: complete,
    [K.CONTROLLER_23]: complete,
    [K.CONTROLLER_HEALTHBARUPDATE]: complete,
    [K.CONTROLLER_EXPUPDATE]: complete,
    [K.CONTROLLER_STATUSICONUPDATE]: SafariHandleStatusIconUpdate,
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
    [K.CONTROLLER_HITANIMATION]: complete,
    [K.CONTROLLER_CANTSWITCH]: complete,
    [K.CONTROLLER_PLAYSE]: () => {
      // SafariHandlePlaySE
      const pan = getBattlerSide(ab()) === K.B_SIDE_PLAYER ? K.SOUND_PAN_ATTACKER : K.SOUND_PAN_TARGET;
      PlaySE12WithPanning(bufA()[1] | (bufA()[2] << 8), pan);
      complete();
    },
    [K.CONTROLLER_PLAYFANFARE]: () => {
      PlayFanfare(bufA()[1] | (bufA()[2] << 8)); // SafariHandlePlayFanfareOrBGM
      complete();
    },
    [K.CONTROLLER_FAINTINGCRY]: () => {
      PlayCry_Normal(playerMon().species, 25); // SafariHandleFaintingCry
      complete();
    },
    [K.CONTROLLER_INTROSLIDE]: () => {
      HandleIntroSlide(bufA()[1]);
      g.introSlideFlags |= 1;
      complete();
    },
    [K.CONTROLLER_INTROTRAINERBALLTHROW]: SafariHandleIntroTrainerBallThrow,
    [K.CONTROLLER_DRAWPARTYSTATUSSUMMARY]: complete,
    [K.CONTROLLER_HIDEPARTYSTATUSSUMMARY]: complete,
    [K.CONTROLLER_ENDBOUNCE]: complete,
    [K.CONTROLLER_SPRITEINVISIBILITY]: complete,
    [K.CONTROLLER_BATTLEANIMATION]: SafariHandleBattleAnimation,
    [K.CONTROLLER_LINKSTANDBYMSG]: complete,
    [K.CONTROLLER_RESETACTIONMOVESELECTION]: complete,
    [K.CONTROLLER_ENDLINKBATTLE]: SafariHandleCmd55,
    [K.CONTROLLER_TERMINATOR_NOP]: () => {},
  });
}
