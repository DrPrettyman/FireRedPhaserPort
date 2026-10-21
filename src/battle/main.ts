// battle_main.c: the battle's main state machine (gBattleMainFunc), turn order, action handlers and
// the end of battle; plus SetUpBattleVars / InitBattleControllers / SetBattlePartyIds from
// battle_controllers.c and AllocateBattleResources from battle_util2.c.

import type { Pokemon } from '../pokemon/Pokemon';
import { random, random32 } from '../util/random';
import { setRoamerInactive, updateRoamerHPStatus } from '../world/roamer';
import { FreeTrainerTowerBattleStruct, InitTrainerTowerBattleStruct } from '../world/trainerTower';
import { battleAI_HandleItemUseBeforeAISetup, recordAbilityBattle } from './ai';
import { BeginFastPaletteFade, gPaletteFade } from '../gba/palette';
import { gMain } from '../gba/main';
import { FadeOutMapMusic, PlayBGM, PlaySE } from '../gba/sound';
import { m4aSongNumStop } from '../audio/m4a';
import { ResetSpriteData } from '../gba/sprite';
import { FreeAllWindowBuffers } from '../gba/window';
import { EvolutionScene, setCB2_AfterEvolution } from '../menus/evolutionScene';
import { SetBgTilemapBuffer } from '../gba/bg';
import { ClearBattleAnimationVars } from './anim/battleAnim';
import { gBattleAnimBgTileBuffer, gBattleAnimBgTilemapBuffer } from './anim/state';
import { BattleMainCB2 } from './battleCallbacks';
import { GetEvolutionTargetSpecies } from './items';
import { K } from './constants';
import {
  emitChooseAction,
  emitChooseItem,
  emitChooseMove,
  emitChoosePokemon,
  emitDrawPartyStatusSummary,
  emitDrawTrainerPic,
  emitEndBounceEffect,
  emitGetMonData,
  emitIntroSlide,
  emitIntroTrainerBallThrow,
  emitLinkStandbyMsg,
  emitLoadMonSprite,
  markBattlerForControllerExec,
} from './controllers';
import { setControllerToOakOrOldMan } from './controllerOakOldMan';
import { setControllerToOpponent } from './controllerOpponent';
import { AllocPokedudeBattlerStates, SetControllerToPokedude } from './controllerPokedude';
import { SetControllerToSafari } from './controllerSafari';
import { battleControllerDummy, setControllerToPlayer } from './controllerPlayer';
import { bdata, g, gBattleMoves, gSpeciesInfo, itemHoldEffect, itemHoldEffectParam, mem, pokemon, state } from './env';
import { bit } from './globals';
import { BattleStopLowHpSound, clearBattleMonForms, FreeMonSpritesGfx } from './gfx';
import { bufferBattlePartyCurrentOrderBySide, getPartyIdFromBattlePartyId, switchPartyMonSlots } from './partyOrder';
import {
  adjustFriendship,
  calculatePPWithBonus,
  getAbilityBySpecies,
  handleSetPokedexFlag,
  speciesOrEgg,
  speciesToNationalPokedexNum,
} from './pokemonBattle';
import { gBattleScriptingCommandsTable } from './scriptCommands';
import { BattleResources, BattleStruct, DisableStruct, ProtectStruct, SpecialStatus, SideTimer, WishFutureKnock } from './structs';
import type { HpAndStatus } from './structs';
import { prepareMonNickBuffer, prepareStatBuffer, prepareStringBuffer } from './textBuffers';
import {
  abilityBattleEffects,
  areAllMovesUnusable,
  battleScriptExecute,
  bs,
  cancelMultiTurnMoves,
  clearFuryCutterDestinyBondGrudge,
  doBattlerEndTurnEffects,
  doFieldEndTurnEffects,
  getBattlerAtPosition,
  getBattlerPosition,
  getBattlerSide,
  getMoveTarget,
  handleFaintedMonActions,
  handleWishPerishSongOnTurnEnd,
  isBattlerOfType,
  isGhostWithScope,
  isGhostWithoutScope,
  itemBattleEffects,
  prepareStringBattle,
  resetSentPokesToOpponentValue,
  tryClearRageStatuses,
  trySetCantSelectMoveBattleScript,
  weatherHasEffect,
} from './util';
import { getBattlerTurnOrderNum } from './bsCommands1';
import { TrySetQuestLogBattleEvent } from '../world/questLogBattle';

/** gBattleScriptsForMoveEffects[effect] */
function moveEffectScript(move: number): number {
  return mem.u32(mem.label('gBattleScriptsForMoveEffects') + gBattleMoves[move].effect * 4);
}

/** The controller-busy mask the selection states wait on (link bits included, like the C). */
function battlerBusy(battler: number): boolean {
  const b = bit(battler);
  return (g.battleControllerExecFlags & (b | 0xf0000000 | (b << 4) | (b << 8) | (b << 12))) !== 0;
}

// ------------------------------------------------------------------ setup

/** AllocateBattleResources (battle_util2.c): fresh zeroed structs. */
export function allocateBattleResources(): void {
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) InitTrainerTowerBattleStruct(state);
  if (g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE) AllocPokedudeBattlerStates();
  g.battleStruct = new BattleStruct();
  g.battleResources = new BattleResources();
  gBattleAnimBgTileBuffer.fill(0);
  gBattleAnimBgTilemapBuffer.fill(0);
  // InitBattleBgsVideo's InitBgsFromTemplates clears these again, as on the GBA.
  SetBgTilemapBuffer(1, gBattleAnimBgTilemapBuffer);
  SetBgTilemapBuffer(2, gBattleAnimBgTilemapBuffer);
}

/** SetUpBattleVars (battle_controllers.c) */
export function setUpBattleVars(): void {
  g.battleMainFunc = beginBattleIntroDummy;
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    g.battlerControllerFuncs[i] = battleControllerDummy;
    g.battlerPositions[i] = 0xff;
    g.actionSelectionCursor[i] = 0;
    g.moveSelectionCursor[i] = 0;
  }
  g.battleControllerExecFlags = 0;
  ClearBattleAnimationVars();
  clearBattleMonForms();
  battleAI_HandleItemUseBeforeAISetup();
}

/** InitBattleControllers / InitSinglePlayerBtlControllers (link battles aren't supported). */
export function initBattleControllers(): void {
  const f = g.battleTypeFlags;
  g.battleMainFunc = beginBattleIntro;
  if (f & K.BATTLE_TYPE_POKEDUDE) {
    // Teachy TV: the Pokédude's controller on every battler
    g.battlersCount = f & K.BATTLE_TYPE_DOUBLE ? K.MAX_BATTLERS_COUNT : 2;
    for (let i = 0; i < g.battlersCount; i++) {
      g.battlerControllerFuncs[i] = SetControllerToPokedude;
      g.battlerPositions[i] = [K.B_POSITION_PLAYER_LEFT, K.B_POSITION_OPPONENT_LEFT, K.B_POSITION_PLAYER_RIGHT, K.B_POSITION_OPPONENT_RIGHT][i];
    }
  } else if (!(f & K.BATTLE_TYPE_DOUBLE)) {
    if (f & K.BATTLE_TYPE_SAFARI) g.battlerControllerFuncs[0] = SetControllerToSafari;
    else if (f & (K.BATTLE_TYPE_OLD_MAN_TUTORIAL | K.BATTLE_TYPE_FIRST_BATTLE)) g.battlerControllerFuncs[0] = setControllerToOakOrOldMan;
    else g.battlerControllerFuncs[0] = setControllerToPlayer;
    g.battlerPositions[0] = K.B_POSITION_PLAYER_LEFT;
    g.battlerControllerFuncs[1] = setControllerToOpponent;
    g.battlerPositions[1] = K.B_POSITION_OPPONENT_LEFT;
    g.battlersCount = 2;
  } else {
    g.battlerControllerFuncs[0] = setControllerToPlayer;
    g.battlerPositions[0] = K.B_POSITION_PLAYER_LEFT;
    g.battlerControllerFuncs[1] = setControllerToOpponent;
    g.battlerPositions[1] = K.B_POSITION_OPPONENT_LEFT;
    g.battlerControllerFuncs[2] = setControllerToPlayer;
    g.battlerPositions[2] = K.B_POSITION_PLAYER_RIGHT;
    g.battlerControllerFuncs[3] = setControllerToOpponent;
    g.battlerPositions[3] = K.B_POSITION_OPPONENT_RIGHT;
    g.battlersCount = K.MAX_BATTLERS_COUNT;
  }
  setBattlePartyIds();
  for (let i = 0; i < g.battlersCount; i++) bufferBattlePartyCurrentOrderBySide(i, 0);
}

function canSendOut(mon: Pokemon | undefined): boolean {
  return !!mon && mon.hp !== 0 && speciesOrEgg(mon) !== K.SPECIES_NONE && speciesOrEgg(mon) !== K.SPECIES_EGG && !mon.isEgg;
}

/** SetBattlePartyIds */
function setBattlePartyIds(): void {
  for (let i = 0; i < g.battlersCount; i++) {
    const party = (g.battlerPositions[i] & K.BIT_SIDE) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
    for (let j = 0; j < K.PARTY_SIZE; j++) {
      if (canSendOut(party[j]) && (i < 2 || g.battlerPartyIndexes[i - 2] !== j)) {
        g.battlerPartyIndexes[i] = j;
        break;
      }
    }
  }
}

/** CreateNPCTrainerParty */
export function createNPCTrainerParty(trainerNum: number): number {
  const trainer = bdata.tables.trainers[trainerNum];
  if (!trainer || trainerNum === K.TRAINER_SECRET_BASE) return 0;
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER && !(g.battleTypeFlags & (K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_TRAINER_TOWER))) {
    g.enemyParty = new Array(K.PARTY_SIZE).fill(undefined);
    let nameHash = 0; // never reset between party members, like the original
    const trainerName = pokemon.encodeName(trainer.trainerName);
    trainer.party.forEach((data, i) => {
      let personalityValue: number;
      if (trainer.doubleBattle === 1) personalityValue = 0x80;
      else if (trainer.encounterMusicGender & K.F_TRAINER_FEMALE) personalityValue = 0x78; // more likely to result in a female Pokémon
      else personalityValue = 0x88; // more likely to result in a male Pokémon
      for (const c of trainerName) nameHash += c;
      for (const c of pokemon.speciesName(data.species)) nameHash += c;
      personalityValue = (personalityValue + (nameHash << 8)) >>> 0;
      const fixedIV = Math.trunc((data.iv * K.MAX_PER_STAT_IVS) / 255);
      // OT_ID_RANDOM_NO_SHINY
      let otId: number;
      do {
        otId = random32();
      } while ((((otId >>> 16) ^ (otId & 0xffff) ^ (personalityValue >>> 16) ^ (personalityValue & 0xffff)) & 0xffff) < K.SHINY_ODDS);
      const mon = pokemon.createMon(data.species, data.lvl, {
        fixedIV,
        personality: personalityValue,
        otId,
        otName: '',
        otGender: 'male',
        metLocation: state.currentMapSection,
      });
      if (trainer.partyFlags & K.F_TRAINER_PARTY_HELD_ITEM) mon.heldItem = data.heldItem ?? 0;
      if (trainer.partyFlags & K.F_TRAINER_PARTY_CUSTOM_MOVESET) {
        for (let j = 0; j < K.MAX_MON_MOVES; j++) {
          mon.moves[j] = data.moves?.[j] ?? 0;
          mon.pp[j] = gBattleMoves[mon.moves[j]].pp;
        }
      }
      g.enemyParty[i] = mon;
    });
    g.battleTypeFlags |= trainer.doubleBattle;
  }
  return trainer.party.length;
}

/**
 * CB2_InitBattleInternal (the parts that aren't video setup): reset scroll, set up vars and the
 * enemy party, league-battle friendship. The scene loads graphics and runs CB2_HandleStartBattle.
 */
export function initBattleInternal(): void {
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  g.battle_BG1_X = g.battle_BG1_Y = 0;
  g.battle_BG2_X = g.battle_BG2_Y = 0;
  g.battle_BG3_X = g.battle_BG3_Y = 0;
  setUpBattleVars();
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_LINK)) {
    createNPCTrainerParty(g.trainerBattleOpponent_A);
    setWildMonHeldItem();
  }
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = g.playerParty[i];
    if (mon) adjustFriendship(mon, K.FRIENDSHIP_EVENT_LEAGUE_BATTLE);
  }
  g.battleCommunication[K.MULTIUSE_STATE] = 0;
}

/** SetWildMonHeldItem (pokemon.c): gEnemyParty[0] holds its species' common item 50%, rare item 5%. */
function setWildMonHeldItem(): void {
  if (g.battleTypeFlags & (K.BATTLE_TYPE_POKEDUDE | K.BATTLE_TYPE_LEGENDARY | K.BATTLE_TYPE_TRAINER)) return;
  const mon = g.enemyParty[0];
  if (!mon) return;
  const rnd = random() % 100;
  const info = gSpeciesInfo[mon.species];
  if (info.itemCommon === info.itemRare) {
    // Both held items are the same, 100% chance to hold item
    mon.heldItem = info.itemCommon;
    return;
  }
  if (rnd > 44) {
    if (rnd <= 94) mon.heldItem = info.itemCommon;
    else mon.heldItem = info.itemRare;
  }
}

// ------------------------------------------------------------------ main loop

export function beginBattleIntroDummy(): void {}

/** BeginBattleIntro */
export function beginBattleIntro(): void {
  battleStartClearSetData();
  g.battleCommunication[1] = 0;
  g.battleMainFunc = battleIntroGetMonsData;
}

/** BattleMainCB1 */
export function battleMainCB1(): void {
  g.battleMainFunc();
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) g.battlerControllerFuncs[g.activeBattler]();
}

/** BattleStartClearSetData */
function battleStartClearSetData(): void {
  turnValuesCleanUp(false);
  specialStatusesClear();
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    g.statuses3[i] = 0;
    g.disableStructs[i] = new DisableStruct();
    g.disableStructs[i].isFirstTurn = 2;
    g.lastMoves[i] = K.MOVE_NONE;
    g.lastLandedMoves[i] = K.MOVE_NONE;
    g.lastHitByType[i] = 0;
    g.lastResultingMoves[i] = K.MOVE_NONE;
    g.lastHitBy[i] = 0xff;
    g.lockedMoves[i] = K.MOVE_NONE;
    g.lastPrintedMoves[i] = K.MOVE_NONE;
    g.battleResources.flags[i] = 0;
  }
  for (let i = 0; i < 2; i++) {
    g.sideStatuses[i] = 0;
    g.sideTimers[i] = new SideTimer();
  }
  g.battlerAttacker = 0;
  g.battlerTarget = 0;
  g.battleWeather = 0;
  g.wishFutureKnock = new WishFutureKnock();
  g.hitMarker = 0;
  if (!(g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_POKEDUDE)) && state.battleSceneOff) g.hitMarker |= K.HITMARKER_NO_ANIMATIONS;
  g.battleScripting.battleStyle = state.battleStyleSet ? 1 : 0;
  g.multiHitCounter = 0;
  g.battleOutcome = 0;
  g.battleControllerExecFlags = 0;
  g.paydayMoney = 0;
  g.battleResources.battleScriptsStack.size = 0;
  g.battleResources.battleCallbackStack.size = 0;
  for (let i = 0; i < K.BATTLE_COMMUNICATION_ENTRIES_COUNT; i++) g.battleCommunication[i] = 0;
  g.pauseCounterBattle = 0;
  g.battleMoveDamage = 0;
  g.introSlideFlags = 0;
  g.battleScripting.animTurn = 0;
  g.battleScripting.animTargetsHit = 0;
  g.leveledUpInBattle = 0;
  g.absentBattlerFlags = 0;
  const bst = g.battleStruct;
  bst.runTries = 0;
  bst.safariRockThrowCounter = 0;
  bst.safariBaitThrowCounter = 0;
  const enemySpecies = g.enemyParty[0]?.species ?? 0;
  bst.safariCatchFactor = Math.trunc((gSpeciesInfo[enemySpecies].catchRate * 100) / 1275) & 0xff;
  bst.safariEscapeFactor = Math.trunc(((gSpeciesInfo[enemySpecies] as unknown as { safariZoneFleeRate: number }).safariZoneFleeRate * 100) / 1275) & 0xff;
  if (bst.safariEscapeFactor <= 1) bst.safariEscapeFactor = 2;
  bst.wildVictorySong = 0;
  bst.moneyMultiplier = 1;
  bst.lastTakenMove.fill(0);
  bst.usedHeldItems.fill(0);
  bst.choicedMove.fill(0);
  bst.changedItems.fill(0);
  bst.lastTakenMoveFrom.forEach((row) => row.fill(0));
  bst.AI_monToSwitchIntoId[0] = K.PARTY_SIZE;
  bst.AI_monToSwitchIntoId[1] = K.PARTY_SIZE;
  bst.givenExpMons = 0;
  const r = g.battleResults;
  r.catchAttempts.fill(0);
  r.battleTurnCounter = 0;
  r.playerFaintCounter = 0;
  r.opponentFaintCounter = 0;
  r.playerSwitchesCounter = 0;
  r.numHealingItemsUsed = 0;
  r.numRevivesUsed = 0;
  r.playerMonWasDamaged = 0;
  r.usedMasterBall = 0;
  r.lastOpponentSpecies = K.SPECIES_NONE;
  r.lastUsedMovePlayer = K.MOVE_NONE;
  r.lastUsedMoveOpponent = K.MOVE_NONE;
  r.playerMon1Species = K.SPECIES_NONE;
  r.playerMon2Species = K.SPECIES_NONE;
  r.caughtMonSpecies = K.SPECIES_NONE;
  r.playerMon1Name = [];
  r.playerMon2Name = [];
  r.caughtMonNick = [];
}

/** SwitchInClearSetData */
export function switchInClearSetData(): void {
  const ab = g.activeBattler;
  const disableStructCopy = g.disableStructs[ab];
  const m = g.battleMons[ab];
  const batonPass = gBattleMoves[g.currentMove].effect === K.EFFECT_BATON_PASS;
  if (!batonPass) {
    for (let i = 0; i < K.NUM_BATTLE_STATS; i++) m.statStages[i] = K.DEFAULT_STAT_STAGE;
    for (let i = 0; i < g.battlersCount; i++) {
      if (g.battleMons[i].status2 & K.STATUS2_ESCAPE_PREVENTION && g.disableStructs[i].battlerPreventingEscape === ab) g.battleMons[i].status2 &= ~K.STATUS2_ESCAPE_PREVENTION;
      if (g.statuses3[i] & K.STATUS3_ALWAYS_HITS && g.disableStructs[i].battlerWithSureHit === ab) {
        g.statuses3[i] &= ~K.STATUS3_ALWAYS_HITS;
        g.disableStructs[i].battlerWithSureHit = 0;
      }
    }
  }
  if (batonPass) {
    m.status2 &= K.STATUS2_CONFUSION | K.STATUS2_FOCUS_ENERGY | K.STATUS2_SUBSTITUTE | K.STATUS2_ESCAPE_PREVENTION | K.STATUS2_CURSED;
    g.statuses3[ab] &=
      K.STATUS3_LEECHSEED_BATTLER | K.STATUS3_LEECHSEED | K.STATUS3_ALWAYS_HITS | K.STATUS3_PERISH_SONG | K.STATUS3_ROOTED | K.STATUS3_MUDSPORT | K.STATUS3_WATERSPORT;
    for (let i = 0; i < g.battlersCount; i++) {
      if (getBattlerSide(ab) !== getBattlerSide(i) && g.statuses3[i] & K.STATUS3_ALWAYS_HITS && g.disableStructs[i].battlerWithSureHit === ab) {
        g.statuses3[i] &= ~K.STATUS3_ALWAYS_HITS;
        g.statuses3[i] |= (2 << 3) & K.STATUS3_ALWAYS_HITS; // STATUS3_ALWAYS_HITS_TURN(2)
      }
    }
  } else {
    m.status2 = 0;
    g.statuses3[ab] = 0;
  }
  for (let i = 0; i < g.battlersCount; i++) {
    const infatuatedWith = bit(ab) << 16;
    if (g.battleMons[i].status2 & infatuatedWith) g.battleMons[i].status2 &= ~infatuatedWith;
    if (g.battleMons[i].status2 & K.STATUS2_WRAPPED && g.battleStruct.wrappedBy[i] === ab) g.battleMons[i].status2 &= ~K.STATUS2_WRAPPED;
  }
  g.actionSelectionCursor[ab] = 0;
  g.moveSelectionCursor[ab] = 0;
  g.disableStructs[ab] = new DisableStruct();
  const d = g.disableStructs[ab];
  if (batonPass) {
    d.substituteHP = disableStructCopy.substituteHP;
    d.battlerWithSureHit = disableStructCopy.battlerWithSureHit;
    d.perishSongTimer = disableStructCopy.perishSongTimer;
    d.perishSongTimerStartValue = disableStructCopy.perishSongTimerStartValue;
    d.battlerPreventingEscape = disableStructCopy.battlerPreventingEscape;
  }
  g.moveResultFlags = 0;
  d.isFirstTurn = 2;
  clearLastMoveData(ab);
  g.battleResources.flags[ab] = 0;
  g.currentMove = K.MOVE_NONE;
}

/** The lastMoves/lastTakenMove bookkeeping shared by SwitchInClearSetData and FaintClearSetData. */
function clearLastMoveData(ab: number): void {
  g.lastMoves[ab] = K.MOVE_NONE;
  g.lastLandedMoves[ab] = K.MOVE_NONE;
  g.lastHitByType[ab] = 0;
  g.lastResultingMoves[ab] = K.MOVE_NONE;
  g.lastPrintedMoves[ab] = K.MOVE_NONE;
  g.lastHitBy[ab] = 0xff;
  const bst = g.battleStruct;
  bst.lastTakenMove[ab] = K.MOVE_NONE;
  bst.lastTakenMoveFrom[ab].fill(0);
  for (let i = 0; i < g.battlersCount; i++) {
    if (i !== ab) bst.lastTakenMove[i] = K.MOVE_NONE;
    bst.lastTakenMoveFrom[i][ab] = 0;
  }
  bst.choicedMove[ab] = K.MOVE_NONE;
}

/** FaintClearSetData */
export function faintClearSetData(): void {
  const ab = g.activeBattler;
  const m = g.battleMons[ab];
  for (let i = 0; i < K.NUM_BATTLE_STATS; i++) m.statStages[i] = K.DEFAULT_STAT_STAGE;
  m.status2 = 0;
  g.statuses3[ab] = 0;
  for (let i = 0; i < g.battlersCount; i++) {
    const o = g.battleMons[i];
    if (o.status2 & K.STATUS2_ESCAPE_PREVENTION && g.disableStructs[i].battlerPreventingEscape === ab) o.status2 &= ~K.STATUS2_ESCAPE_PREVENTION;
    const infatuatedWith = bit(ab) << 16;
    if (o.status2 & infatuatedWith) o.status2 &= ~infatuatedWith;
    if (o.status2 & K.STATUS2_WRAPPED && g.battleStruct.wrappedBy[i] === ab) o.status2 &= ~K.STATUS2_WRAPPED;
  }
  g.actionSelectionCursor[ab] = 0;
  g.moveSelectionCursor[ab] = 0;
  g.disableStructs[ab] = new DisableStruct();
  const p = g.protectStructs[ab];
  p.protected = p.endured = p.noValidMoves = p.helpingHand = p.bounceMove = p.stealMove = p.flag0Unknown = p.prlzImmobility = 0;
  p.confusionSelfDmg = p.targetNotAffected = p.chargingTurn = p.fleeType = p.usedImprisonedMove = p.loveImmobility = p.usedDisabledMove = 0;
  p.usedTauntedMove = p.flag2Unknown = p.flinchImmobility = p.notFirstStrike = 0;
  g.disableStructs[ab].isFirstTurn = 2;
  g.lastMoves[ab] = K.MOVE_NONE;
  g.lastLandedMoves[ab] = K.MOVE_NONE;
  g.lastHitByType[ab] = 0;
  g.lastResultingMoves[ab] = K.MOVE_NONE;
  g.lastPrintedMoves[ab] = K.MOVE_NONE;
  g.lastHitBy[ab] = 0xff;
  const bst = g.battleStruct;
  bst.choicedMove[ab] = K.MOVE_NONE;
  bst.lastTakenMove[ab] = K.MOVE_NONE;
  bst.lastTakenMoveFrom[ab].fill(0);
  for (let i = 0; i < g.battlersCount; i++) {
    if (i !== ab) bst.lastTakenMove[i] = K.MOVE_NONE;
    bst.lastTakenMoveFrom[i][ab] = 0;
  }
  g.battleResources.flags[ab] = 0;
  m.type1 = gSpeciesInfo[m.species].types[0];
  m.type2 = gSpeciesInfo[m.species].types[1];
}

// ------------------------------------------------------------------ intro

const NOT_SEEN_FLAGS = () =>
  K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_POKEDUDE | K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_GHOST | K.BATTLE_TYPE_OLD_MAN_TUTORIAL | K.BATTLE_TYPE_LEGENDARY;

function setSeen(battler: number): void {
  handleSetPokedexFlag(speciesToNationalPokedexNum(g.battleMons[battler].species), K.FLAG_SET_SEEN);
}

function battleIntroGetMonsData(): void {
  const mc = g.battleCommunication;
  switch (mc[K.MULTIUSE_STATE]) {
    case 0:
      g.activeBattler = mc[1];
      emitGetMonData(K.BUFFER_A, K.REQUEST_ALL_BATTLE, 0);
      markBattlerForControllerExec(g.activeBattler);
      mc[K.MULTIUSE_STATE]++;
      break;
    case 1:
      if (g.battleControllerExecFlags === 0) {
        mc[1]++;
        if (mc[1] === g.battlersCount) g.battleMainFunc = battleIntroPrepareBackgroundSlide;
        else mc[K.MULTIUSE_STATE] = 0;
      }
      break;
  }
}

function battleIntroPrepareBackgroundSlide(): void {
  if (g.battleControllerExecFlags === 0) {
    g.activeBattler = getBattlerAtPosition(0);
    emitIntroSlide(K.BUFFER_A, g.battleTerrain);
    markBattlerForControllerExec(g.activeBattler);
    g.battleMainFunc = battleIntroDrawTrainersOrMonsSprites;
    g.battleCommunication[K.MULTIUSE_STATE] = 0;
    g.battleCommunication[K.SPRITES_INIT_STATE1] = 0;
  }
}

function battleIntroDrawTrainersOrMonsSprites(): void {
  if (g.battleControllerExecFlags) return;
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
    const ab = g.activeBattler;
    if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI && getBattlerSide(ab) === K.B_SIDE_PLAYER) {
      g.battleMons[ab] = new (g.battleMons[ab].constructor as new () => typeof g.battleMons[0])();
    } else {
      const m = (g.battleMons[ab] = (g.battleBufferBObj[ab] as typeof g.battleMons[0]).clone());
      m.type1 = gSpeciesInfo[m.species].types[0];
      m.type2 = gSpeciesInfo[m.species].types[1];
      m.ability = getAbilityBySpecies(m.species, m.abilityNum);
      g.battleStruct.hpOnSwitchout[getBattlerSide(ab)] = m.hp;
      for (let i = 0; i < K.NUM_BATTLE_STATS; i++) m.statStages[i] = K.DEFAULT_STAT_STAGE;
      m.status2 = 0;
    }
    if (getBattlerPosition(ab) === K.B_POSITION_PLAYER_LEFT) {
      emitDrawTrainerPic(K.BUFFER_A);
      markBattlerForControllerExec(ab);
    }
    if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
      if (getBattlerPosition(ab) === K.B_POSITION_OPPONENT_LEFT) {
        emitDrawTrainerPic(K.BUFFER_A);
        markBattlerForControllerExec(ab);
      }
      if (getBattlerSide(ab) === K.B_SIDE_OPPONENT && !(g.battleTypeFlags & NOT_SEEN_FLAGS())) setSeen(ab);
    } else if (getBattlerSide(ab) === K.B_SIDE_OPPONENT) {
      if (g.battleTypeFlags & (K.BATTLE_TYPE_GHOST | K.BATTLE_TYPE_GHOST_UNVEILED)) {
        if (!isGhostWithoutScope(g.battleTypeFlags)) setSeen(ab);
      } else if (!(g.battleTypeFlags & NOT_SEEN_FLAGS())) {
        setSeen(ab);
      }
      emitLoadMonSprite(K.BUFFER_A);
      markBattlerForControllerExec(ab);
    }
  }
  g.battleMainFunc = battleIntroDrawPartySummaryScreens;
}

function partyHpStatus(party: (Pokemon | undefined)[]): HpAndStatus[] {
  const out: HpAndStatus[] = [];
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const sp = speciesOrEgg(party[i]);
    if (sp === K.SPECIES_NONE || sp === K.SPECIES_EGG) out.push({ hp: K.HP_EMPTY_SLOT, status: 0 });
    else out.push({ hp: party[i]!.hp, status: party[i]!.status });
  }
  return out;
}

function battleIntroDrawPartySummaryScreens(): void {
  if (g.battleControllerExecFlags) return;
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
    g.activeBattler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    emitDrawPartyStatusSummary(K.BUFFER_A, partyHpStatus(g.enemyParty), K.PARTY_SUMM_SKIP_DRAW_DELAY);
    markBattlerForControllerExec(g.activeBattler);
    g.activeBattler = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    emitDrawPartyStatusSummary(K.BUFFER_A, partyHpStatus(g.playerParty), K.PARTY_SUMM_SKIP_DRAW_DELAY);
    markBattlerForControllerExec(g.activeBattler);
    g.battleMainFunc = battleIntroPrintTrainerWantsToBattle;
  } else {
    // The struct gets set here, but nothing is ever done with it since wild battles don't show the summary.
    g.battleMainFunc = battleIntroPrintWildMonAttacked;
  }
}

function battleIntroPrintTrainerWantsToBattle(): void {
  if (g.battleControllerExecFlags === 0) {
    g.activeBattler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    prepareStringBattle(K.STRINGID_INTROMSG, g.activeBattler);
    g.battleMainFunc = battleIntroPrintOpponentSendsOut;
  }
}

function battleIntroPrintWildMonAttacked(): void {
  if (g.battleControllerExecFlags === 0) {
    g.battleMainFunc = battleIntroPrintPlayerSendsOut;
    prepareStringBattle(K.STRINGID_INTROMSG, 0);
    if (isGhostWithScope(g.battleTypeFlags)) {
      g.battleScripting.battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      battleScriptExecute(bs('BattleScript_SilphScopeUnveiled'));
    }
  }
}

function battleIntroPrintOpponentSendsOut(): void {
  if (g.battleControllerExecFlags === 0) {
    prepareStringBattle(K.STRINGID_INTROSENDOUT, getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT));
    g.battleMainFunc = battleIntroOpponentSendsOutMonAnimation;
  }
}

function battleIntroOpponentSendsOutMonAnimation(): void {
  if (g.battleControllerExecFlags === 0) {
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
      const pos = getBattlerPosition(g.activeBattler);
      if (pos === K.B_POSITION_OPPONENT_LEFT || (g.battleTypeFlags & K.BATTLE_TYPE_MULTI && pos === K.B_POSITION_OPPONENT_RIGHT)) {
        emitIntroTrainerBallThrow(K.BUFFER_A);
        markBattlerForControllerExec(g.activeBattler);
      }
    }
    g.battleMainFunc = battleIntroRecordMonsToDex;
  }
}

function battleIntroRecordMonsToDex(): void {
  if (g.battleControllerExecFlags === 0) {
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++)
      if (getBattlerSide(g.activeBattler) === K.B_SIDE_OPPONENT && !(g.battleTypeFlags & NOT_SEEN_FLAGS())) setSeen(g.activeBattler);
    g.battleMainFunc = battleIntroPrintPlayerSendsOut;
  }
}

function battleIntroPrintPlayerSendsOut(): void {
  if (g.battleControllerExecFlags === 0) {
    if (!(g.battleTypeFlags & K.BATTLE_TYPE_SAFARI)) prepareStringBattle(K.STRINGID_INTROSENDOUT, getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT));
    g.battleMainFunc = battleIntroPlayerSendsOutMonAnimation;
  }
}

function battleIntroPlayerSendsOutMonAnimation(): void {
  if (g.battleControllerExecFlags) return;
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
    const pos = getBattlerPosition(g.activeBattler);
    if (pos === K.B_POSITION_PLAYER_LEFT || (g.battleTypeFlags & K.BATTLE_TYPE_MULTI && pos === K.B_POSITION_PLAYER_RIGHT)) {
      emitIntroTrainerBallThrow(K.BUFFER_A);
      markBattlerForControllerExec(g.activeBattler);
    }
  }
  g.battleStruct.switchInAbilitiesCounter = 0;
  g.battleStruct.switchInItemsCounter = 0;
  g.battleStruct.overworldWeatherDone = 0;
  g.battleMainFunc = tryDoEventsBeforeFirstTurn;
}

function tryDoEventsBeforeFirstTurn(): void {
  let effect = 0;
  const bst = g.battleStruct;
  if (g.battleControllerExecFlags) return;
  if (bst.switchInAbilitiesCounter === 0) {
    for (let i = 0; i < g.battlersCount; i++) g.battlerByTurnOrder[i] = i;
    for (let i = 0; i < g.battlersCount - 1; i++)
      for (let j = i + 1; j < g.battlersCount; j++) if (getWhoStrikesFirst(g.battlerByTurnOrder[i], g.battlerByTurnOrder[j], true) !== 0) swapTurnOrder(i, j);
  }
  if (!bst.overworldWeatherDone && abilityBattleEffects(0, 0, 0, K.ABILITYEFFECT_SWITCH_IN_WEATHER, 0) !== 0) {
    bst.overworldWeatherDone = 1;
    return;
  }
  // Check all switch in abilities happening from the fastest mon to slowest.
  while (bst.switchInAbilitiesCounter < g.battlersCount) {
    if (abilityBattleEffects(K.ABILITYEFFECT_ON_SWITCHIN, g.battlerByTurnOrder[bst.switchInAbilitiesCounter], 0, 0, 0) !== 0) effect++;
    ++bst.switchInAbilitiesCounter;
    if (effect !== 0) return;
  }
  if (abilityBattleEffects(K.ABILITYEFFECT_INTIMIDATE1, 0, 0, 0, 0) !== 0) return;
  if (abilityBattleEffects(K.ABILITYEFFECT_TRACE, 0, 0, 0, 0) !== 0) return;
  // Check all switch in items having effect from the fastest mon to slowest.
  while (bst.switchInItemsCounter < g.battlersCount) {
    if (itemBattleEffects(K.ITEMEFFECT_ON_SWITCH_IN, g.battlerByTurnOrder[bst.switchInItemsCounter], false)) effect++;
    ++bst.switchInItemsCounter;
    if (effect !== 0) return;
  }
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    bst.monToSwitchIntoId[i] = K.PARTY_SIZE;
    g.chosenActionByBattler[i] = K.B_ACTION_NONE;
    g.chosenMoveByBattler[i] = K.MOVE_NONE;
  }
  turnValuesCleanUp(false);
  specialStatusesClear();
  bst.absentBattlerFlags = g.absentBattlerFlags;
  g.battleMainFunc = handleTurnActionSelectionState;
  resetSentPokesToOpponentValue();
  for (let i = 0; i < K.BATTLE_COMMUNICATION_ENTRIES_COUNT; i++) g.battleCommunication[i] = 0;
  for (let i = 0; i < g.battlersCount; i++) g.battleMons[i].status2 &= ~K.STATUS2_FLINCHED;
  bst.turnEffectsTracker = 0;
  bst.turnEffectsBattlerId = 0;
  bst.wishPerishSongState = 0;
  bst.wishPerishSongBattlerId = 0;
  g.battleScripting.moveendState = 0;
  bst.faintedActionsState = 0;
  bst.turnCountersTracker = 0;
  g.moveResultFlags = 0;
  g.randomTurnNumber = random();
}

// ------------------------------------------------------------------ turns

function handleEndTurn_ContinueBattle(): void {
  if (g.battleControllerExecFlags === 0) {
    g.battleMainFunc = battleTurnPassed;
    for (let i = 0; i < K.BATTLE_COMMUNICATION_ENTRIES_COUNT; i++) g.battleCommunication[i] = 0;
    for (let i = 0; i < g.battlersCount; i++) {
      g.battleMons[i].status2 &= ~K.STATUS2_FLINCHED;
      if (g.battleMons[i].status1 & K.STATUS1_SLEEP && g.battleMons[i].status2 & K.STATUS2_MULTIPLETURNS) cancelMultiTurnMoves(i);
    }
    const bst = g.battleStruct;
    bst.turnEffectsTracker = 0;
    bst.turnEffectsBattlerId = 0;
    bst.wishPerishSongState = 0;
    bst.wishPerishSongBattlerId = 0;
    bst.turnCountersTracker = 0;
    g.moveResultFlags = 0;
  }
}

/** BattleTurnPassed */
export function battleTurnPassed(): void {
  turnValuesCleanUp(true);
  if (g.battleOutcome === 0) {
    if (doFieldEndTurnEffects()) return;
    if (doBattlerEndTurnEffects()) return;
  }
  if (handleFaintedMonActions()) return;
  g.battleStruct.faintedActionsState = 0;
  if (handleWishPerishSongOnTurnEnd()) return;
  turnValuesCleanUp(false);
  g.hitMarker &= ~K.HITMARKER_NO_ATTACKSTRING;
  g.hitMarker &= ~K.HITMARKER_UNABLE_TO_USE_MOVE;
  g.hitMarker &= ~K.HITMARKER_PLAYER_FAINTED;
  g.hitMarker &= ~K.HITMARKER_PASSIVE_DAMAGE;
  g.battleScripting.animTurn = 0;
  g.battleScripting.animTargetsHit = 0;
  g.battleScripting.moveendState = 0;
  g.battleMoveDamage = 0;
  g.moveResultFlags = 0;
  for (let i = 0; i < 5; i++) g.battleCommunication[i] = 0;
  if (g.battleOutcome !== 0) {
    g.currentActionFuncId = K.B_ACTION_FINISHED;
    g.battleMainFunc = runTurnActionsFunctions;
    return;
  }
  if (g.battleResults.battleTurnCounter < 0xff) ++g.battleResults.battleTurnCounter;
  for (let i = 0; i < g.battlersCount; i++) {
    g.chosenActionByBattler[i] = K.B_ACTION_NONE;
    g.chosenMoveByBattler[i] = K.MOVE_NONE;
  }
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) g.battleStruct.monToSwitchIntoId[i] = K.PARTY_SIZE;
  g.battleStruct.absentBattlerFlags = g.absentBattlerFlags;
  g.battleMainFunc = handleTurnActionSelectionState;
  g.randomTurnNumber = random();
}

/** IsRunningFromBattleImpossible */
export function isRunningFromBattleImpossible(): number {
  const ab = g.activeBattler;
  const m = g.battleMons[ab];
  const holdEffect = m.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[ab].holdEffect : itemHoldEffect(m.item);
  g.potentialItemEffectBattler = ab;
  if (holdEffect === K.HOLD_EFFECT_CAN_ALWAYS_RUN || g.battleTypeFlags & K.BATTLE_TYPE_LINK || m.ability === K.ABILITY_RUN_AWAY) return K.BATTLE_RUN_SUCCESS;
  const side = getBattlerSide(ab);
  for (let i = 0; i < g.battlersCount; i++) {
    if (side !== getBattlerSide(i) && g.battleMons[i].ability === K.ABILITY_SHADOW_TAG) {
      g.battleScripting.battler = i;
      g.lastUsedAbility = g.battleMons[i].ability;
      g.battleCommunication[K.MULTISTRING_CHOOSER] = 2;
      return K.BATTLE_RUN_FAILURE;
    }
    if (side !== getBattlerSide(i) && m.ability !== K.ABILITY_LEVITATE && !isBattlerOfType(ab, K.TYPE_FLYING) && g.battleMons[i].ability === K.ABILITY_ARENA_TRAP) {
      g.battleScripting.battler = i;
      g.lastUsedAbility = g.battleMons[i].ability;
      g.battleCommunication[K.MULTISTRING_CHOOSER] = 2;
      return K.BATTLE_RUN_FAILURE;
    }
  }
  const i = abilityBattleEffects(K.ABILITYEFFECT_CHECK_FIELD_EXCEPT_BATTLER, ab, K.ABILITY_MAGNET_PULL, 0, 0);
  if (i !== 0 && isBattlerOfType(ab, K.TYPE_STEEL)) {
    g.battleScripting.battler = i - 1;
    g.lastUsedAbility = g.battleMons[i - 1].ability;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = 2;
    return K.BATTLE_RUN_FAILURE;
  }
  if (m.status2 & (K.STATUS2_ESCAPE_PREVENTION | K.STATUS2_WRAPPED) || g.statuses3[ab] & K.STATUS3_ROOTED) {
    g.battleCommunication[K.MULTISTRING_CHOOSER] = 0;
    return K.BATTLE_RUN_FORBIDDEN;
  }
  if (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) {
    g.battleCommunication[K.MULTISTRING_CHOOSER] = 1;
    return K.BATTLE_RUN_FORBIDDEN;
  }
  return K.BATTLE_RUN_SUCCESS;
}

/** UpdatePartyOwnerOnSwitch_NonMulti */
export function updatePartyOwnerOnSwitch_NonMulti(battler: number): void {
  const orders = g.battleStruct.battlerPartyOrders;
  for (let i = 0; i < 3; i++) g.battlePartyCurrentOrder[i] = orders[battler][i];
  const r4 = getPartyIdFromBattlePartyId(g.battlerPartyIndexes[battler]);
  const r1 = getPartyIdFromBattlePartyId(g.battleStruct.monToSwitchIntoId[battler]);
  switchPartyMonSlots(r4, r1);
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    for (let i = 0; i < 3; i++) {
      orders[battler][i] = g.battlePartyCurrentOrder[i];
      orders[battler ^ 2][i] = g.battlePartyCurrentOrder[i];
    }
  } else {
    for (let i = 0; i < 3; i++) orders[battler][i] = g.battlePartyCurrentOrder[i];
  }
}

const STATE_BEFORE_ACTION_CHOSEN = 0,
  STATE_WAIT_ACTION_CHOSEN = 1,
  STATE_WAIT_ACTION_CASE_CHOSEN = 2,
  STATE_WAIT_ACTION_CONFIRMED_STANDBY = 3,
  STATE_WAIT_ACTION_CONFIRMED = 4,
  STATE_SELECTION_SCRIPT = 5,
  STATE_WAIT_SET_BEFORE_ACTION = 6;

function handleTurnActionSelectionState(): void {
  const mc = g.battleCommunication;
  const bst = g.battleStruct;
  mc[K.ACTIONS_CONFIRMED_COUNT] = 0;
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
    const ab = g.activeBattler;
    const position = getBattlerPosition(ab);
    const bufB = g.battleBufferB[ab];
    switch (mc[ab]) {
      case STATE_BEFORE_ACTION_CHOSEN: {
        // Choose an action.
        bst.monToSwitchIntoId[ab] = K.PARTY_SIZE;
        const partner = getBattlerAtPosition(position ^ 2);
        if (
          g.battleTypeFlags & K.BATTLE_TYPE_MULTI ||
          (position & K.BIT_FLANK) === K.B_FLANK_LEFT ||
          bst.absentBattlerFlags & bit(partner) ||
          mc[partner] === STATE_WAIT_ACTION_CONFIRMED
        ) {
          if (bst.absentBattlerFlags & bit(ab)) {
            g.chosenActionByBattler[ab] = K.B_ACTION_NOTHING_FAINTED;
            mc[ab] = !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI) ? STATE_WAIT_ACTION_CONFIRMED : STATE_WAIT_ACTION_CONFIRMED_STANDBY;
          } else if (g.battleMons[ab].status2 & K.STATUS2_MULTIPLETURNS || g.battleMons[ab].status2 & K.STATUS2_RECHARGE) {
            g.chosenActionByBattler[ab] = K.B_ACTION_USE_MOVE;
            mc[ab] = STATE_WAIT_ACTION_CONFIRMED_STANDBY;
          } else {
            emitChooseAction(K.BUFFER_A, g.chosenActionByBattler[0], g.battleBufferB[0][1] | (g.battleBufferB[0][2] << 8));
            markBattlerForControllerExec(ab);
            mc[ab]++;
          }
        }
        break;
      }
      case STATE_WAIT_ACTION_CHOSEN: // Try to perform an action.
        if (!battlerBusy(ab)) {
          g.chosenActionByBattler[ab] = bufB[1];
          switch (bufB[1]) {
            case K.B_ACTION_USE_MOVE:
              if (areAllMovesUnusable()) {
                mc[ab] = STATE_SELECTION_SCRIPT;
                bst.selectionScriptFinished[ab] = 0;
                bst.stateIdAfterSelScript[ab] = STATE_WAIT_ACTION_CONFIRMED_STANDBY;
                bst.moveTarget[ab] = bufB[3];
                return;
              } else if (g.disableStructs[ab].encoredMove !== K.MOVE_NONE) {
                g.chosenMoveByBattler[ab] = g.disableStructs[ab].encoredMove;
                bst.chosenMovePositions[ab] = g.disableStructs[ab].encoredMovePos;
                mc[ab] = STATE_WAIT_ACTION_CONFIRMED_STANDBY;
                return;
              } else {
                const m = g.battleMons[ab];
                const moveInfo = {
                  species: m.species,
                  monType1: m.type1,
                  monType2: m.type2,
                  moves: Array.from(m.moves),
                  currentPp: Array.from(m.pp),
                  maxPp: Array.from(m.moves).map((mv, i) => calculatePPWithBonus(mv, m.ppBonuses, i)),
                };
                emitChooseMove(K.BUFFER_A, (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0, false, moveInfo);
                markBattlerForControllerExec(ab);
              }
              break;
            case K.B_ACTION_USE_ITEM:
              if (g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_EREADER_TRAINER)) {
                g.selectionBattleScripts[ab] = bs('BattleScript_ActionSelectionItemsCantBeUsed');
                mc[ab] = STATE_SELECTION_SCRIPT;
                bst.selectionScriptFinished[ab] = 0;
                bst.stateIdAfterSelScript[ab] = STATE_BEFORE_ACTION_CHOSEN;
                return;
              }
              emitChooseItem(K.BUFFER_A, bst.battlerPartyOrders[ab]);
              markBattlerForControllerExec(ab);
              break;
            case K.B_ACTION_SWITCH: {
              bst.battlerPartyIndexes[ab] = g.battlerPartyIndexes[ab];
              let i: number;
              if (g.battleMons[ab].status2 & (K.STATUS2_WRAPPED | K.STATUS2_ESCAPE_PREVENTION) || g.statuses3[ab] & K.STATUS3_ROOTED) {
                emitChoosePokemon(K.BUFFER_A, K.PARTY_ACTION_CANT_SWITCH, 6, K.ABILITY_NONE, bst.battlerPartyOrders[ab]);
              } else if (
                (i = abilityBattleEffects(K.ABILITYEFFECT_CHECK_OTHER_SIDE, ab, K.ABILITY_SHADOW_TAG, 0, 0)) ||
                ((i = abilityBattleEffects(K.ABILITYEFFECT_CHECK_OTHER_SIDE, ab, K.ABILITY_ARENA_TRAP, 0, 0)) &&
                  !isBattlerOfType(ab, K.TYPE_FLYING) &&
                  g.battleMons[ab].ability !== K.ABILITY_LEVITATE) ||
                ((i = abilityBattleEffects(K.ABILITYEFFECT_CHECK_FIELD_EXCEPT_BATTLER, ab, K.ABILITY_MAGNET_PULL, 0, 0)) && isBattlerOfType(ab, K.TYPE_STEEL))
              ) {
                emitChoosePokemon(K.BUFFER_A, ((i - 1) << 4) | K.PARTY_ACTION_ABILITY_PREVENTS, 6, g.lastUsedAbility, bst.battlerPartyOrders[ab]);
              } else if (ab === 2 && g.chosenActionByBattler[0] === K.B_ACTION_SWITCH) {
                emitChoosePokemon(K.BUFFER_A, K.PARTY_ACTION_CHOOSE_MON, bst.monToSwitchIntoId[0], K.ABILITY_NONE, bst.battlerPartyOrders[ab]);
              } else if (ab === 3 && g.chosenActionByBattler[1] === K.B_ACTION_SWITCH) {
                emitChoosePokemon(K.BUFFER_A, K.PARTY_ACTION_CHOOSE_MON, bst.monToSwitchIntoId[1], K.ABILITY_NONE, bst.battlerPartyOrders[ab]);
              } else {
                emitChoosePokemon(K.BUFFER_A, K.PARTY_ACTION_CHOOSE_MON, 6, K.ABILITY_NONE, bst.battlerPartyOrders[ab]);
              }
              markBattlerForControllerExec(ab);
              break;
            }
            case K.B_ACTION_SAFARI_BALL:
              if (state.isPlayerPartyAndPokemonStorageFull()) {
                g.selectionBattleScripts[ab] = bs('BattleScript_PrintFullBox');
                mc[ab] = STATE_SELECTION_SCRIPT;
                bst.selectionScriptFinished[ab] = 0;
                bst.stateIdAfterSelScript[ab] = STATE_BEFORE_ACTION_CHOSEN;
                return;
              }
              break;
            case K.B_ACTION_CANCEL_PARTNER:
              mc[ab] = STATE_WAIT_SET_BEFORE_ACTION;
              mc[getBattlerAtPosition(getBattlerPosition(ab) ^ 2)] = STATE_BEFORE_ACTION_CHOSEN;
              emitEndBounceEffect(K.BUFFER_A);
              markBattlerForControllerExec(ab);
              return;
          }
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER && !(g.battleTypeFlags & K.BATTLE_TYPE_LINK) && bufB[1] === K.B_ACTION_RUN) {
            battleScriptExecute(bs('BattleScript_PrintCantRunFromTrainer'));
            mc[ab] = STATE_BEFORE_ACTION_CHOSEN;
          } else if (isRunningFromBattleImpossible() !== K.BATTLE_RUN_SUCCESS && bufB[1] === K.B_ACTION_RUN) {
            g.selectionBattleScripts[ab] = bs('BattleScript_PrintCantEscapeFromBattle');
            mc[ab] = STATE_SELECTION_SCRIPT;
            bst.selectionScriptFinished[ab] = 0;
            bst.stateIdAfterSelScript[ab] = STATE_BEFORE_ACTION_CHOSEN;
            return;
          } else {
            mc[ab]++;
          }
        }
        break;
      case STATE_WAIT_ACTION_CASE_CHOSEN:
        if (!battlerBusy(ab)) {
          switch (g.chosenActionByBattler[ab]) {
            case K.B_ACTION_USE_MOVE:
              if (bufB[1] >= 3 && bufB[1] <= 9) {
                g.chosenActionByBattler[ab] = bufB[1];
                return;
              }
              if ((bufB[2] | (bufB[3] << 8)) === 0xffff) {
                mc[ab] = STATE_BEFORE_ACTION_CHOSEN;
              } else if (trySetCantSelectMoveBattleScript()) {
                mc[ab] = STATE_SELECTION_SCRIPT;
                bst.selectionScriptFinished[ab] = 0;
                bufB[1] = 0;
                bst.stateIdAfterSelScript[ab] = STATE_WAIT_ACTION_CHOSEN;
                return;
              } else {
                bst.chosenMovePositions[ab] = bufB[2];
                g.chosenMoveByBattler[ab] = g.battleMons[ab].moves[bst.chosenMovePositions[ab]];
                bst.moveTarget[ab] = bufB[3];
                mc[ab]++;
              }
              break;
            case K.B_ACTION_USE_ITEM:
              if ((bufB[1] | (bufB[2] << 8)) === 0) {
                mc[ab] = STATE_BEFORE_ACTION_CHOSEN;
              } else {
                g.lastUsedItem = bufB[1] | (bufB[2] << 8);
                mc[ab]++;
              }
              break;
            case K.B_ACTION_SWITCH:
              if (bufB[1] === K.PARTY_SIZE) {
                mc[ab] = STATE_BEFORE_ACTION_CHOSEN;
              } else {
                bst.monToSwitchIntoId[ab] = bufB[1];
                mc[ab]++;
              }
              break;
            case K.B_ACTION_RUN:
              g.hitMarker |= K.HITMARKER_RUN;
              mc[ab]++;
              break;
            case K.B_ACTION_SAFARI_WATCH_CAREFULLY:
            case K.B_ACTION_SAFARI_BALL:
            case K.B_ACTION_SAFARI_BAIT:
            case K.B_ACTION_SAFARI_GO_NEAR:
            case K.B_ACTION_OLDMAN_THROW:
              mc[ab]++;
              break;
            case K.B_ACTION_SAFARI_RUN:
              g.hitMarker |= K.HITMARKER_RUN;
              mc[ab]++;
              break;
          }
        }
        break;
      case STATE_WAIT_ACTION_CONFIRMED_STANDBY:
        if (!battlerBusy(ab)) {
          if (
            (g.battleTypeFlags & (K.BATTLE_TYPE_MULTI | K.BATTLE_TYPE_DOUBLE)) !== K.BATTLE_TYPE_DOUBLE ||
            (position & K.BIT_FLANK) !== K.B_FLANK_LEFT ||
            bst.absentBattlerFlags & bit(getBattlerAtPosition(position ^ K.BIT_FLANK))
          )
            emitLinkStandbyMsg(K.BUFFER_A, K.LINK_STANDBY_MSG_STOP_BOUNCE);
          else emitLinkStandbyMsg(K.BUFFER_A, K.LINK_STANDBY_STOP_BOUNCE_ONLY);
          markBattlerForControllerExec(ab);
          mc[ab]++;
        }
        break;
      case STATE_WAIT_ACTION_CONFIRMED:
        if (!battlerBusy(ab)) ++mc[K.ACTIONS_CONFIRMED_COUNT];
        break;
      case STATE_SELECTION_SCRIPT:
        if (bst.selectionScriptFinished[ab]) {
          mc[ab] = bst.stateIdAfterSelScript[ab];
        } else {
          g.battlerAttacker = ab;
          g.battlescriptCurrInstr = g.selectionBattleScripts[ab];
          if (!battlerBusy(ab)) gBattleScriptingCommandsTable[mem.u8(g.battlescriptCurrInstr)]();
          g.selectionBattleScripts[ab] = g.battlescriptCurrInstr;
        }
        break;
      case STATE_WAIT_SET_BEFORE_ACTION:
        if (!battlerBusy(ab)) mc[ab] = STATE_BEFORE_ACTION_CHOSEN;
        break;
    }
  }
  // Check if everyone chose actions.
  if (mc[K.ACTIONS_CONFIRMED_COUNT] === g.battlersCount) g.battleMainFunc = setActionsAndBattlersTurnOrder;
}

/** SwapTurnOrder */
export function swapTurnOrder(id1: number, id2: number): void {
  let t = g.actionsByTurnOrder[id1];
  g.actionsByTurnOrder[id1] = g.actionsByTurnOrder[id2];
  g.actionsByTurnOrder[id2] = t;
  t = g.battlerByTurnOrder[id1];
  g.battlerByTurnOrder[id1] = g.battlerByTurnOrder[id2];
  g.battlerByTurnOrder[id2] = t;
}

function battlerSpeed(battler: number, ignoreSpeedMultiplierWeather: boolean): number {
  const m = g.battleMons[battler];
  let mult = 1;
  if (!ignoreSpeedMultiplierWeather) {
    if ((m.ability === K.ABILITY_SWIFT_SWIM && g.battleWeather & K.B_WEATHER_RAIN) || (m.ability === K.ABILITY_CHLOROPHYLL && g.battleWeather & K.B_WEATHER_SUN)) mult = 2;
  }
  const r = bdata.tables.statStageRatios[m.statStages[K.STAT_SPEED]];
  let speed = Math.trunc((m.speed * mult * r[0]) / r[1]) >>> 0;
  const holdEffect = m.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[battler].holdEffect : itemHoldEffect(m.item);
  const holdEffectParam = m.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[battler].holdEffectParam : itemHoldEffectParam(m.item);
  // badge boost
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_LINK) && state.getFlag('FLAG_BADGE03_GET') && getBattlerSide(battler) === K.B_SIDE_PLAYER) speed = Math.trunc((speed * 110) / 100);
  if (holdEffect === K.HOLD_EFFECT_MACHO_BRACE) speed = Math.trunc(speed / 2);
  if (m.status1 & K.STATUS1_PARALYSIS) speed = Math.trunc(speed / 4);
  if (holdEffect === K.HOLD_EFFECT_QUICK_CLAW && g.randomTurnNumber < Math.trunc((0xffff * holdEffectParam) / 100)) speed = 0xffffffff; // UINT_MAX
  return speed;
}

/** GetWhoStrikesFirst */
export function getWhoStrikesFirst(battler1: number, battler2: number, ignoreChosenMoves: boolean): number {
  let strikesFirst = 0;
  const weather = weatherHasEffect();
  const speed1 = battlerSpeed(battler1, !weather);
  const speed2 = battlerSpeed(battler2, !weather);
  let move1 = K.MOVE_NONE;
  let move2 = K.MOVE_NONE;
  if (!ignoreChosenMoves) {
    const chosen = (b: number) =>
      g.chosenActionByBattler[b] === K.B_ACTION_USE_MOVE
        ? g.protectStructs[b].noValidMoves
          ? K.MOVE_STRUGGLE
          : g.battleMons[b].moves[g.battleStruct.chosenMovePositions[b]]
        : K.MOVE_NONE;
    move1 = chosen(battler1);
    move2 = chosen(battler2);
  }
  const p1 = gBattleMoves[move1].priority;
  const p2 = gBattleMoves[move2].priority;
  if (p1 !== 0 || p2 !== 0) {
    if (p1 === p2) {
      if (speed1 === speed2 && random() & 1) strikesFirst = 2; // same speeds, same priorities
      else if (speed1 < speed2) strikesFirst = 1; // battler2 has more speed
    } else if (p1 < p2) {
      strikesFirst = 1; // battler2's move has greater priority
    }
  } else {
    if (speed1 === speed2 && random() & 1) strikesFirst = 2;
    else if (speed1 < speed2) strikesFirst = 1;
  }
  return strikesFirst;
}

function setActionsAndBattlersTurnOrder(): void {
  let turnOrderId = 0;
  if (g.battleTypeFlags & K.BATTLE_TYPE_SAFARI) {
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
      g.actionsByTurnOrder[turnOrderId] = g.chosenActionByBattler[g.activeBattler];
      g.battlerByTurnOrder[turnOrderId] = g.activeBattler;
      turnOrderId++;
    }
  } else {
    if (g.chosenActionByBattler[0] === K.B_ACTION_RUN) {
      g.activeBattler = 0;
      turnOrderId = 5;
    }
    if (turnOrderId === 5) {
      // One of battlers wants to run.
      g.actionsByTurnOrder[0] = g.chosenActionByBattler[g.activeBattler];
      g.battlerByTurnOrder[0] = g.activeBattler;
      turnOrderId = 1;
      for (let i = 0; i < g.battlersCount; i++) {
        if (i !== g.activeBattler) {
          g.actionsByTurnOrder[turnOrderId] = g.chosenActionByBattler[i];
          g.battlerByTurnOrder[turnOrderId] = i;
          turnOrderId++;
        }
      }
      g.battleMainFunc = checkFocusPunch_ClearVarsBeforeTurnStarts;
      g.battleStruct.focusPunchBattlerId = 0;
      return;
    }
    const isItemOrSwitch = (a: number) => a === K.B_ACTION_USE_ITEM || a === K.B_ACTION_SWITCH;
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
      if (isItemOrSwitch(g.chosenActionByBattler[g.activeBattler])) {
        g.actionsByTurnOrder[turnOrderId] = g.chosenActionByBattler[g.activeBattler];
        g.battlerByTurnOrder[turnOrderId] = g.activeBattler;
        turnOrderId++;
      }
    }
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
      if (!isItemOrSwitch(g.chosenActionByBattler[g.activeBattler])) {
        g.actionsByTurnOrder[turnOrderId] = g.chosenActionByBattler[g.activeBattler];
        g.battlerByTurnOrder[turnOrderId] = g.activeBattler;
        turnOrderId++;
      }
    }
    for (let i = 0; i < g.battlersCount - 1; i++) {
      for (let j = i + 1; j < g.battlersCount; j++) {
        const b1 = g.battlerByTurnOrder[i];
        const b2 = g.battlerByTurnOrder[j];
        if (!isItemOrSwitch(g.actionsByTurnOrder[i]) && !isItemOrSwitch(g.actionsByTurnOrder[j])) if (getWhoStrikesFirst(b1, b2, false)) swapTurnOrder(i, j);
      }
    }
  }
  g.battleMainFunc = checkFocusPunch_ClearVarsBeforeTurnStarts;
  g.battleStruct.focusPunchBattlerId = 0;
}

/** TurnValuesCleanUp */
function turnValuesCleanUp(var0: boolean): void {
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
    const ab = g.activeBattler;
    if (var0) {
      g.protectStructs[ab].protected = 0;
      g.protectStructs[ab].endured = 0;
    } else {
      g.protectStructs[ab] = new ProtectStruct();
      const d = g.disableStructs[ab];
      if (d.isFirstTurn) --d.isFirstTurn;
      if (d.rechargeTimer) {
        --d.rechargeTimer;
        if (d.rechargeTimer === 0) g.battleMons[ab].status2 &= ~K.STATUS2_RECHARGE;
      }
    }
    if (g.disableStructs[ab].substituteHP === 0) g.battleMons[ab].status2 &= ~K.STATUS2_SUBSTITUTE;
  }
  g.sideTimers[0].followmeTimer = 0;
  g.sideTimers[1].followmeTimer = 0;
}

/** SpecialStatusesClear */
function specialStatusesClear(): void {
  for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) g.specialStatuses[g.activeBattler] = new SpecialStatus();
}

function checkFocusPunch_ClearVarsBeforeTurnStarts(): void {
  const bst = g.battleStruct;
  if (!(g.hitMarker & K.HITMARKER_RUN)) {
    while (bst.focusPunchBattlerId < g.battlersCount) {
      g.activeBattler = g.battlerAttacker = bst.focusPunchBattlerId;
      ++bst.focusPunchBattlerId;
      const ab = g.activeBattler;
      if (
        g.chosenMoveByBattler[ab] === K.MOVE_FOCUS_PUNCH &&
        !(g.battleMons[ab].status1 & K.STATUS1_SLEEP) &&
        !g.disableStructs[g.battlerAttacker].truantCounter &&
        !g.protectStructs[ab].noValidMoves
      ) {
        battleScriptExecute(bs('BattleScript_FocusPunchSetUp'));
        return;
      }
    }
  }
  tryClearRageStatuses();
  g.currentTurnActionNumber = 0;
  g.currentActionFuncId = g.actionsByTurnOrder[0];
  g.dynamicBasePower = 0;
  bst.dynamicMoveType = 0;
  g.battleMainFunc = runTurnActionsFunctions;
  g.battleCommunication[3] = 0;
  g.battleCommunication[4] = 0;
  g.battleScripting.multihitMoveEffect = 0;
  g.battleResources.battleScriptsStack.size = 0;
}

const sTurnActionsFuncsTable = (): Record<number, () => void> => ({
  [K.B_ACTION_USE_MOVE]: handleAction_UseMove,
  [K.B_ACTION_USE_ITEM]: handleAction_UseItem,
  [K.B_ACTION_SWITCH]: handleAction_Switch,
  [K.B_ACTION_RUN]: handleAction_Run,
  [K.B_ACTION_SAFARI_WATCH_CAREFULLY]: handleAction_WatchesCarefully,
  [K.B_ACTION_SAFARI_BALL]: handleAction_SafariZoneBallThrow,
  [K.B_ACTION_SAFARI_BAIT]: handleAction_ThrowBait,
  [K.B_ACTION_SAFARI_GO_NEAR]: handleAction_ThrowRock,
  [K.B_ACTION_SAFARI_RUN]: handleAction_SafariZoneRun,
  [K.B_ACTION_OLDMAN_THROW]: handleAction_OldManBallThrow,
  [K.B_ACTION_EXEC_SCRIPT]: handleAction_RunBattleScript,
  [K.B_ACTION_TRY_FINISH]: handleAction_TryFinish,
  [K.B_ACTION_FINISHED]: handleAction_ActionFinished,
  [K.B_ACTION_NOTHING_FAINTED]: handleAction_NothingIsFainted,
});

const sEndTurnFuncsTable = (): Record<number, () => void> => ({
  0: handleEndTurn_ContinueBattle,
  [K.B_OUTCOME_WON]: handleEndTurn_BattleWon,
  [K.B_OUTCOME_LOST]: handleEndTurn_BattleLost,
  [K.B_OUTCOME_DREW]: handleEndTurn_BattleLost,
  [K.B_OUTCOME_RAN]: handleEndTurn_RanFromBattle,
  [K.B_OUTCOME_PLAYER_TELEPORTED]: handleEndTurn_FinishBattle,
  [K.B_OUTCOME_MON_FLED]: handleEndTurn_MonFled,
  [K.B_OUTCOME_CAUGHT]: handleEndTurn_FinishBattle,
  [K.B_OUTCOME_NO_SAFARI_BALLS]: handleEndTurn_FinishBattle,
});

let turnActions: Record<number, () => void> | undefined;
let endTurn: Record<number, () => void> | undefined;

function runTurnActionsFunctions(): void {
  turnActions ??= sTurnActionsFuncsTable();
  endTurn ??= sEndTurnFuncsTable();
  if (g.battleOutcome !== 0) g.currentActionFuncId = K.B_ACTION_FINISHED;
  g.battleStruct.savedTurnActionNumber = g.currentTurnActionNumber;
  turnActions[g.currentActionFuncId]();
  if (g.currentTurnActionNumber >= g.battlersCount) {
    // everyone did their actions, turn finished
    g.hitMarker &= ~K.HITMARKER_PASSIVE_DAMAGE;
    g.battleMainFunc = endTurn[g.battleOutcome & 0x7f];
  } else if (g.battleStruct.savedTurnActionNumber !== g.currentTurnActionNumber) {
    // action turn has been done, clear hitmarker bits for another battlerId
    g.hitMarker &= ~K.HITMARKER_NO_ATTACKSTRING;
    g.hitMarker &= ~K.HITMARKER_UNABLE_TO_USE_MOVE;
  }
}

function handleEndTurn_BattleWon(): void {
  g.currentActionFuncId = 0;
  if (g.battleTypeFlags & (K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_BATTLE_TOWER)) {
    BattleStopLowHpSound();
    PlayBGM(K.MUS_VICTORY_TRAINER);
    g.battlescriptCurrInstr = bs('BattleScript_BattleTowerTrainerBattleWon');
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER && !(g.battleTypeFlags & K.BATTLE_TYPE_LINK)) {
    BattleStopLowHpSound();
    g.battlescriptCurrInstr = bs('BattleScript_LocalTrainerBattleWon');
    switch (bdata.tables.trainers[g.trainerBattleOpponent_A]!.trainerClass) {
      case K.TRAINER_CLASS_LEADER:
      case K.TRAINER_CLASS_CHAMPION:
        PlayBGM(K.MUS_VICTORY_GYM_LEADER);
        break;
      default: // BOSS, TEAM_ROCKET, COOLTRAINER, ELITE_FOUR, GENTLEMAN, ...
        PlayBGM(K.MUS_VICTORY_TRAINER);
        break;
    }
  } else {
    g.battlescriptCurrInstr = bs('BattleScript_PayDayMoneyAndPickUpItems');
  }
  g.battleMainFunc = handleEndTurn_FinishBattle;
}

function handleEndTurn_BattleLost(): void {
  g.currentActionFuncId = 0;
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER && g.trainerBattleMode === K.TRAINER_BATTLE_EARLY_RIVAL) {
    // Dont do / do white out text
    g.battleCommunication[K.MULTISTRING_CHOOSER] = g.rivalBattleFlags & K.RIVAL_BATTLE_HEAL_AFTER ? 1 : 2;
    g.battlerAttacker = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  } else {
    g.battleCommunication[K.MULTISTRING_CHOOSER] = 0;
  }
  g.battlescriptCurrInstr = bs('BattleScript_LocalBattleLost');
  g.battleMainFunc = handleEndTurn_FinishBattle;
}

function handleEndTurn_RanFromBattle(): void {
  g.currentActionFuncId = 0;
  switch (g.protectStructs[g.battlerAttacker].fleeType) {
    case 1:
      g.battlescriptCurrInstr = bs('BattleScript_SmokeBallEscape');
      break;
    case 2:
      g.battlescriptCurrInstr = bs('BattleScript_RanAwayUsingMonAbility');
      break;
    default:
      g.battlescriptCurrInstr = bs('BattleScript_GotAwaySafely');
      break;
  }
  g.battleMainFunc = handleEndTurn_FinishBattle;
}

function handleEndTurn_MonFled(): void {
  g.currentActionFuncId = 0;
  prepareMonNickBuffer(g.battleTextBuff1, g.battlerAttacker, g.battlerPartyIndexes[g.battlerAttacker]);
  g.battlescriptCurrInstr = bs('BattleScript_WildMonFled');
  g.battleMainFunc = handleEndTurn_FinishBattle;
}

function handleEndTurn_FinishBattle(): void {
  if (g.currentActionFuncId === K.B_ACTION_TRY_FINISH || g.currentActionFuncId === K.B_ACTION_FINISHED) {
    if (
      !(
        g.battleTypeFlags &
        (K.BATTLE_TYPE_TRAINER_TOWER |
          K.BATTLE_TYPE_EREADER_TRAINER |
          K.BATTLE_TYPE_OLD_MAN_TUTORIAL |
          K.BATTLE_TYPE_BATTLE_TOWER |
          K.BATTLE_TYPE_SAFARI |
          K.BATTLE_TYPE_FIRST_BATTLE |
          K.BATTLE_TYPE_LINK)
      )
    ) {
      for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
        if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER) {
          const m = g.battleMons[g.activeBattler];
          if (g.battleResults.playerMon1Species === K.SPECIES_NONE) {
            g.battleResults.playerMon1Species = m.species;
            g.battleResults.playerMon1Name = [...m.nickname];
          } else {
            g.battleResults.playerMon2Species = m.species;
            g.battleResults.playerMon2Name = [...m.nickname];
          }
        }
      }
    }
    TrySetQuestLogBattleEvent();
    // ClearRematchStateByTrainerId: ScriptEngine.runTrainerBattle's host.clearRematchStateByTrainerId
    BeginFastPaletteFade(3);
    FadeOutMapMusic(5);
    g.battleMainFunc = freeResetData_ReturnToOvOrDoEvolutions;
    setCB2_AfterEvolution(BattleMainCB2);
  } else if (g.battleControllerExecFlags === 0) {
    gBattleScriptingCommandsTable[mem.u8(g.battlescriptCurrInstr)]();
  }
}

function freeResetData_ReturnToOvOrDoEvolutions(): void {
  if (!gPaletteFade.active) {
    ResetSpriteData();
    if (g.leveledUpInBattle === 0 || g.battleOutcome !== K.B_OUTCOME_WON) g.battleMainFunc = returnFromBattleToOverworld;
    else g.battleMainFunc = tryEvolvePokemon;
    FreeAllWindowBuffers();
    // !(gBattleTypeFlags & BATTLE_TYPE_LINK): FreeMonSpritesGfx / FreeBattleSpritesData / FreeBattleResources
    FreeMonSpritesGfx();
    if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) FreeTrainerTowerBattleStruct(); // FreeBattleResources
  }
}

/** TryEvolvePokemon: each mon that leveled up gets a chance to evolve, one evolution scene at a time. */
function tryEvolvePokemon(): void {
  while (g.leveledUpInBattle !== 0) {
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      if (g.leveledUpInBattle & bit(i)) {
        const levelUpBits = g.leveledUpInBattle & ~bit(i);
        g.leveledUpInBattle = levelUpBits;

        const species = GetEvolutionTargetSpecies(g.playerParty[i]!, K.EVO_MODE_NORMAL, levelUpBits);
        if (species !== K.SPECIES_NONE) {
          g.battleMainFunc = waitForEvoSceneToFinish;
          EvolutionScene(g.playerParty[i]!, species, 0x81, i);
          return;
        }
      }
    }
  }
  g.battleMainFunc = returnFromBattleToOverworld;
}

/** WaitForEvoSceneToFinish */
function waitForEvoSceneToFinish(): void {
  if (gMain.callback2 === BattleMainCB2) g.battleMainFunc = tryEvolvePokemon;
}

/** ReturnFromBattleToOverworld */
function returnFromBattleToOverworld(): void {
  // RandomlyGivePartyPokerus / PartySpreadPokerus are stubbed in FRLG
  state.setVar('VAR_RESULT', g.battleOutcome);
  if (g.battleTypeFlags & K.BATTLE_TYPE_ROAMER) {
    updateRoamerHPStatus(state, g.enemyParty[0]!);
    // REVISION 0's check: a roamer that Roars the player away (B_OUTCOME_PLAYER_TELEPORTED = 5) also
    // matches `& B_OUTCOME_WON` and is gone for good (fixed in REVISION 0xA)
    if (g.battleOutcome & K.B_OUTCOME_WON || g.battleOutcome === K.B_OUTCOME_CAUGHT) setRoamerInactive(state);
  }
  m4aSongNumStop(K.SE_LOW_HEALTH);
  g.battleMainFunc = () => {};
  g.onBattleEnd?.(g.battleOutcome);
}

/** RunBattleScriptCommands_PopCallbacksStack */
export function runBattleScriptCommands_PopCallbacksStack(): void {
  if (g.currentActionFuncId === K.B_ACTION_TRY_FINISH || g.currentActionFuncId === K.B_ACTION_FINISHED) {
    const cb = g.battleResources.battleCallbackStack;
    if (cb.size !== 0) cb.size--;
    g.battleMainFunc = cb.function[cb.size];
  } else if (g.battleControllerExecFlags === 0) {
    gBattleScriptingCommandsTable[mem.u8(g.battlescriptCurrInstr)]();
  }
}

/** RunBattleScriptCommands */
export function runBattleScriptCommands(): void {
  if (g.battleControllerExecFlags === 0) gBattleScriptingCommandsTable[mem.u8(g.battlescriptCurrInstr)]();
}

/** HandleAction_RunBattleScript (battle_util.c): identical to RunBattleScriptCommands */
function handleAction_RunBattleScript(): void {
  if (g.battleControllerExecFlags === 0) gBattleScriptingCommandsTable[mem.u8(g.battlescriptCurrInstr)]();
}

function retargetIfAbsent(): void {
  if (g.absentBattlerFlags & bit(g.battlerTarget)) {
    if (getBattlerSide(g.battlerAttacker) !== getBattlerSide(g.battlerTarget)) {
      g.battlerTarget = getBattlerAtPosition(getBattlerPosition(g.battlerTarget) ^ K.BIT_FLANK);
    } else {
      g.battlerTarget = getBattlerAtPosition(getBattlerPosition(g.battlerAttacker) ^ K.BIT_SIDE);
      if (g.absentBattlerFlags & bit(g.battlerTarget)) g.battlerTarget = getBattlerAtPosition(getBattlerPosition(g.battlerTarget) ^ K.BIT_FLANK);
    }
  }
}

function randomFoe(): number {
  if (getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER) return getBattlerAtPosition(random() & 1 ? K.B_POSITION_OPPONENT_LEFT : K.B_POSITION_OPPONENT_RIGHT);
  return getBattlerAtPosition(random() & 1 ? K.B_POSITION_PLAYER_LEFT : K.B_POSITION_PLAYER_RIGHT);
}

function handleAction_UseMove(): void {
  let v = 4;
  const bst = g.battleStruct;
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  const atk = g.battlerAttacker;
  if (bst.absentBattlerFlags & bit(atk)) {
    g.currentActionFuncId = K.B_ACTION_FINISHED;
    return;
  }
  g.critMultiplier = 1;
  g.battleScripting.dmgMultiplier = 1;
  bst.atkCancellerTracker = 0;
  g.moveResultFlags = 0;
  g.multiHitCounter = 0;
  g.battleCommunication[K.MISS_TYPE] = 0;
  g.currMovePos = g.chosenMovePos = bst.chosenMovePositions[atk];
  const m = g.battleMons[atk];
  const d = g.disableStructs[atk];
  // choose move
  if (g.protectStructs[atk].noValidMoves) {
    g.protectStructs[atk].noValidMoves = 0;
    g.currentMove = g.chosenMove = K.MOVE_STRUGGLE;
    g.hitMarker |= K.HITMARKER_NO_PPDEDUCT;
    bst.moveTarget[atk] = getMoveTarget(K.MOVE_STRUGGLE, K.NO_TARGET_OVERRIDE);
  } else if (m.status2 & K.STATUS2_MULTIPLETURNS || m.status2 & K.STATUS2_RECHARGE) {
    g.currentMove = g.chosenMove = g.lockedMoves[atk];
  } else if (d.encoredMove !== K.MOVE_NONE && d.encoredMove === m.moves[d.encoredMovePos]) {
    // encore forces you to use the same move
    g.currentMove = g.chosenMove = d.encoredMove;
    g.currMovePos = g.chosenMovePos = d.encoredMovePos;
    bst.moveTarget[atk] = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
  } else if (d.encoredMove !== K.MOVE_NONE && d.encoredMove !== m.moves[d.encoredMovePos]) {
    // check if the encored move wasn't overwritten
    g.currMovePos = g.chosenMovePos = d.encoredMovePos;
    g.currentMove = g.chosenMove = m.moves[g.currMovePos];
    d.encoredMove = K.MOVE_NONE;
    d.encoredMovePos = 0;
    d.encoreTimer = 0;
    bst.moveTarget[atk] = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
  } else if (m.moves[g.currMovePos] !== g.chosenMoveByBattler[atk]) {
    g.currentMove = g.chosenMove = m.moves[g.currMovePos];
    bst.moveTarget[atk] = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
  } else {
    g.currentMove = g.chosenMove = m.moves[g.currMovePos];
  }
  if (getBattlerSide(atk) === K.B_SIDE_PLAYER) g.battleResults.lastUsedMovePlayer = g.currentMove;
  else g.battleResults.lastUsedMoveOpponent = g.currentMove;

  // choose target
  let side = getBattlerSide(atk) ^ K.BIT_SIDE;
  const st = g.sideTimers[side];
  const mv = gBattleMoves[g.currentMove];
  if (st.followmeTimer !== 0 && mv.target === K.MOVE_TARGET_SELECTED && getBattlerSide(atk) !== getBattlerSide(st.followmeTarget) && g.battleMons[st.followmeTarget].hp !== 0) {
    g.battlerTarget = st.followmeTarget;
  } else if (
    g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE &&
    st.followmeTimer === 0 &&
    (mv.power !== 0 || mv.target !== K.MOVE_TARGET_USER) &&
    g.battleMons[bst.moveTarget[atk]].ability !== K.ABILITY_LIGHTNING_ROD &&
    mv.type === K.TYPE_ELECTRIC
  ) {
    side = getBattlerSide(atk);
    for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++)
      if (
        side !== getBattlerSide(g.activeBattler) &&
        bst.moveTarget[atk] !== g.activeBattler &&
        g.battleMons[g.activeBattler].ability === K.ABILITY_LIGHTNING_ROD &&
        getBattlerTurnOrderNum(g.activeBattler) < v
      )
        v = getBattlerTurnOrderNum(g.activeBattler);
    if (v === 4) {
      if (gBattleMoves[g.chosenMove].target & K.MOVE_TARGET_RANDOM) g.battlerTarget = randomFoe();
      else g.battlerTarget = bst.moveTarget[atk];
      retargetIfAbsent();
    } else {
      g.activeBattler = g.battlerByTurnOrder[v];
      recordAbilityBattle(g.activeBattler, g.battleMons[g.activeBattler].ability);
      g.specialStatuses[g.activeBattler].lightningRodRedirected = 1;
      g.battlerTarget = g.activeBattler;
    }
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && gBattleMoves[g.chosenMove].target & K.MOVE_TARGET_RANDOM) {
    g.battlerTarget = randomFoe();
    if (g.absentBattlerFlags & bit(g.battlerTarget) && getBattlerSide(atk) !== getBattlerSide(g.battlerTarget))
      g.battlerTarget = getBattlerAtPosition(getBattlerPosition(g.battlerTarget) ^ K.BIT_FLANK);
  } else {
    g.battlerTarget = bst.moveTarget[atk];
    retargetIfAbsent();
  }
  g.battlescriptCurrInstr = moveEffectScript(g.currentMove);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

function handleAction_Switch(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  g.actionSelectionCursor[g.battlerAttacker] = 0;
  g.moveSelectionCursor[g.battlerAttacker] = 0;
  prepareMonNickBuffer(g.battleTextBuff1, g.battlerAttacker, g.battleStruct.battlerPartyIndexes[g.battlerAttacker]);
  g.battleScripting.battler = g.battlerAttacker;
  g.battlescriptCurrInstr = bs('BattleScript_ActionSwitch');
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
  if (g.battleResults.playerSwitchesCounter < 255) ++g.battleResults.playerSwitchesCounter;
}

function handleAction_UseItem(): void {
  g.battlerAttacker = g.battlerTarget = g.battlerByTurnOrder[g.currentTurnActionNumber];
  const atk = g.battlerAttacker;
  const bst = g.battleStruct;
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  clearFuryCutterDestinyBondGrudge(atk);
  g.lastUsedItem = g.battleBufferB[atk][1] | (g.battleBufferB[atk][2] << 8);
  const table = (name: string, i: number) => mem.u32(mem.label(name) + i * 4);
  if (g.lastUsedItem <= K.ITEM_PREMIER_BALL) {
    // is ball
    g.battlescriptCurrInstr = table('gBattlescriptsForBallThrow', g.lastUsedItem);
  } else if (g.lastUsedItem === K.ITEM_POKE_DOLL || g.lastUsedItem === K.ITEM_FLUFFY_TAIL) {
    g.battlescriptCurrInstr = table('gBattlescriptsForRunningByItem', 0);
  } else if (g.lastUsedItem === K.ITEM_POKE_FLUTE) {
    g.battlescriptCurrInstr = table('gBattlescriptsForRunningByItem', 1);
  } else if (getBattlerSide(atk) === K.B_SIDE_PLAYER) {
    g.battlescriptCurrInstr = table('gBattlescriptsForUsingItem', 0);
  } else {
    g.battleScripting.battler = atk;
    const half = atk >> 1;
    const mc = g.battleCommunication;
    switch (bst.AI_itemType[half]) {
      case K.AI_ITEM_FULL_RESTORE:
      case K.AI_ITEM_HEAL_HP:
        break;
      case K.AI_ITEM_CURE_CONDITION:
        mc[K.MULTISTRING_CHOOSER] = 0;
        if (bst.AI_itemFlags[half] & 1) {
          if (bst.AI_itemFlags[half] & 0x3e) mc[K.MULTISTRING_CHOOSER] = 5;
        } else {
          while (!(bst.AI_itemFlags[half] & 1)) {
            bst.AI_itemFlags[half] >>= 1;
            mc[K.MULTISTRING_CHOOSER]++;
          }
        }
        break;
      case K.AI_ITEM_X_STAT:
        mc[K.MULTISTRING_CHOOSER] = 4;
        if (bst.AI_itemFlags[half] & 0x80) {
          mc[K.MULTISTRING_CHOOSER] = 5;
        } else {
          prepareStatBuffer(g.battleTextBuff1, K.STAT_ATK);
          prepareStringBuffer(g.battleTextBuff2, K.CHAR_X);
          while (!(bst.AI_itemFlags[half] & 1)) {
            bst.AI_itemFlags[half] >>= 1;
            ++g.battleTextBuff1[2];
          }
          g.battleScripting.animArg1 = g.battleTextBuff1[2] + 14;
          g.battleScripting.animArg2 = 0;
        }
        break;
      case K.AI_ITEM_GUARD_SPECS:
        mc[K.MULTISTRING_CHOOSER] = g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE ? 2 : 0;
        break;
    }
    g.battlescriptCurrInstr = table('gBattlescriptsForUsingItem', bst.AI_itemType[half]);
  }
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

/** TryRunFromBattle */
export function tryRunFromBattle(battler: number): boolean {
  let effect = false;
  const m = g.battleMons[battler];
  const holdEffect = m.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[battler].holdEffect : itemHoldEffect(m.item);
  g.potentialItemEffectBattler = battler;
  if (holdEffect === K.HOLD_EFFECT_CAN_ALWAYS_RUN) {
    g.lastUsedItem = m.item;
    g.protectStructs[battler].fleeType = K.FLEE_ITEM;
    effect = true;
  } else if (m.ability === K.ABILITY_RUN_AWAY) {
    g.lastUsedAbility = K.ABILITY_RUN_AWAY;
    g.protectStructs[battler].fleeType = K.FLEE_ABILITY;
    effect = true;
  } else if (isGhostWithoutScope(g.battleTypeFlags)) {
    if (getBattlerSide(battler) === K.B_SIDE_PLAYER) effect = true;
  } else {
    if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
      const opp = g.battleMons[battler ^ 1];
      if (m.speed < opp.speed) {
        const speedVar = (Math.trunc((m.speed * 128) / opp.speed) + g.battleStruct.runTries * 30) & 0xff;
        if (speedVar > (random() & 0xff)) effect = true;
      } else {
        effect = true; // same speed or faster
      }
    }
    ++g.battleStruct.runTries;
  }
  if (effect) {
    g.currentTurnActionNumber = g.battlersCount;
    g.battleOutcome = K.B_OUTCOME_RAN;
  }
  return effect;
}

function handleAction_Run(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  const atk = g.battlerAttacker;
  if (getBattlerSide(atk) === K.B_SIDE_PLAYER) {
    if (!tryRunFromBattle(atk)) {
      // failed to run away
      clearFuryCutterDestinyBondGrudge(atk);
      g.battleCommunication[K.MULTISTRING_CHOOSER] = 3;
      g.battlescriptCurrInstr = bs('BattleScript_PrintFailedToRunString');
      g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
    }
  } else if (g.battleMons[atk].status2 & (K.STATUS2_WRAPPED | K.STATUS2_ESCAPE_PREVENTION)) {
    g.battleCommunication[K.MULTISTRING_CHOOSER] = 4;
    g.battlescriptCurrInstr = bs('BattleScript_PrintFailedToRunString');
    g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
  } else {
    g.currentTurnActionNumber = g.battlersCount;
    g.battleOutcome = K.B_OUTCOME_MON_FLED;
  }
}

function safariScript(i: number): number {
  return mem.u32(mem.label('gBattlescriptsForSafariActions') + i * 4);
}

function handleAction_WatchesCarefully(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  const bst = g.battleStruct;
  const mc = g.battleCommunication;
  if (bst.safariRockThrowCounter !== 0) {
    --bst.safariRockThrowCounter;
    if (bst.safariRockThrowCounter === 0) {
      bst.safariCatchFactor = Math.trunc((gSpeciesInfo[g.enemyParty[0]!.species].catchRate * 100) / 1275) & 0xff;
      mc[K.MULTISTRING_CHOOSER] = K.B_MSG_MON_WATCHING;
    } else {
      mc[K.MULTISTRING_CHOOSER] = K.B_MSG_MON_ANGRY;
    }
  } else if (bst.safariBaitThrowCounter !== 0) {
    --bst.safariBaitThrowCounter;
    mc[K.MULTISTRING_CHOOSER] = bst.safariBaitThrowCounter === 0 ? K.B_MSG_MON_WATCHING : K.B_MSG_MON_EATING;
  } else {
    mc[K.MULTISTRING_CHOOSER] = K.B_MSG_MON_WATCHING;
  }
  g.battlescriptCurrInstr = safariScript(0);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

function handleAction_SafariZoneBallThrow(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  g.numSafariBalls--;
  g.lastUsedItem = K.ITEM_SAFARI_BALL;
  g.battlescriptCurrInstr = mem.u32(mem.label('gBattlescriptsForBallThrow') + K.ITEM_SAFARI_BALL * 4);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

function handleAction_ThrowBait(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  const bst = g.battleStruct;
  bst.safariBaitThrowCounter += (random() % 5) + 2;
  if (bst.safariBaitThrowCounter > 6) bst.safariBaitThrowCounter = 6;
  bst.safariRockThrowCounter = 0;
  bst.safariCatchFactor >>= 1;
  if (bst.safariCatchFactor <= 2) bst.safariCatchFactor = 3;
  g.battlescriptCurrInstr = safariScript(2);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

function handleAction_ThrowRock(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  const bst = g.battleStruct;
  bst.safariRockThrowCounter += (random() % 5) + 2;
  if (bst.safariRockThrowCounter > 6) bst.safariRockThrowCounter = 6;
  bst.safariBaitThrowCounter = 0;
  bst.safariCatchFactor = (bst.safariCatchFactor << 1) & 0xff;
  if (bst.safariCatchFactor > 20) bst.safariCatchFactor = 20;
  g.battlescriptCurrInstr = safariScript(1);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
}

function handleAction_SafariZoneRun(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  PlaySE(K.SE_FLEE);
  g.currentTurnActionNumber = g.battlersCount;
  g.battleOutcome = K.B_OUTCOME_RAN;
}

function handleAction_OldManBallThrow(): void {
  g.battlerAttacker = g.battlerByTurnOrder[g.currentTurnActionNumber];
  g.battle_BG0_X = g.battle_BG0_Y = 0;
  prepareMonNickBuffer(g.battleTextBuff1, g.battlerAttacker, g.battlerPartyIndexes[g.battlerAttacker]);
  g.battlescriptCurrInstr = safariScript(3);
  g.currentActionFuncId = K.B_ACTION_EXEC_SCRIPT;
  g.actionsByTurnOrder[1] = K.B_ACTION_FINISHED;
}

function handleAction_TryFinish(): void {
  if (!handleFaintedMonActions()) {
    g.battleStruct.faintedActionsState = 0;
    g.currentActionFuncId = K.B_ACTION_FINISHED;
  }
}

function clearActionHitmarkers(): void {
  g.hitMarker &= ~(
    K.HITMARKER_DESTINYBOND |
    K.HITMARKER_IGNORE_SUBSTITUTE |
    K.HITMARKER_ATTACKSTRING_PRINTED |
    K.HITMARKER_NO_PPDEDUCT |
    K.HITMARKER_STATUS_ABILITY_EFFECT |
    K.HITMARKER_IGNORE_ON_AIR |
    K.HITMARKER_IGNORE_UNDERGROUND |
    K.HITMARKER_IGNORE_UNDERWATER |
    K.HITMARKER_PASSIVE_DAMAGE |
    K.HITMARKER_OBEYS |
    K.HITMARKER_WAKE_UP_CLEAR |
    K.HITMARKER_SYNCHRONISE_EFFECT |
    K.HITMARKER_CHARGING |
    K.HITMARKER_NEVER_SET
  );
}

function handleAction_NothingIsFainted(): void {
  ++g.currentTurnActionNumber;
  g.currentActionFuncId = g.actionsByTurnOrder[g.currentTurnActionNumber];
  clearActionHitmarkers();
}

function handleAction_ActionFinished(): void {
  ++g.currentTurnActionNumber;
  g.currentActionFuncId = g.actionsByTurnOrder[g.currentTurnActionNumber];
  specialStatusesClear();
  clearActionHitmarkers();
  g.currentMove = K.MOVE_NONE;
  g.battleMoveDamage = 0;
  g.moveResultFlags = 0;
  g.battleScripting.animTurn = 0;
  g.battleScripting.animTargetsHit = 0;
  g.lastLandedMoves[g.battlerAttacker] = 0;
  g.lastHitByType[g.battlerAttacker] = 0;
  g.battleStruct.dynamicMoveType = 0;
  g.dynamicBasePower = 0;
  g.battleScripting.moveendState = 0;
  g.battleCommunication[K.MOVE_EFFECT_BYTE] = 0;
  g.battleCommunication[K.ACTIONS_CONFIRMED_COUNT] = 0;
  g.battleScripting.multihitMoveEffect = 0;
  g.battleResources.battleScriptsStack.size = 0;
}
