// quest_log_battle.c: the battle's end tells the quest log what happened. TrySetQuestLogBattleEvent (battle_main.c's
// HandleEndTurn_FinishBattle) sends a won trainer battle as QL_EVENT_DEFEATED_GYM_LEADER / _E4_MEMBER / _CHAMPION /
// _TRAINER by the opponent's trainer class (SetQuestLogEvent defers it to QuestLogEvents_HandleEndTrainerBattle, at
// CB2_EndTrainerBattle), and a won or caught wild battle as QL_EVENT_DEFEATED_WILD_MON (counted into the scene's one
// wild battle record). TrySetQuestLogLinkBattleEvent sends the link battles (no callers until link play).
//
// battle/main.ts's HandleEndTurn_FinishBattle calls TrySetQuestLogBattleEvent (QL4b); questLogEventCodecs2.ts has the
// events' codecs.

import { K } from '../battle/constants';
import { bdata, g } from '../battle/env';
import { getBattlerAtPosition, getBattlerSide } from '../battle/util';
import { questLogHost } from './questLog';
import type { QuestLogEventLinkBattle } from './questLogEventCodecs';
import type { QuestLogEventTrainerBattle, QuestLogEventWildBattle } from './questLogEventCodecs2';
import { SetQuestLogEvent } from './questLogEvents';

/** GetCurrentRegionMapSectionId */
function currentMapSec(): number {
  return questLogHost()?.mapSec() ?? K.MAPSEC_NONE;
}

/** The trainer battle's QL_EVENT_* by gTrainers[gTrainerBattleOpponent_A].trainerClass */
export function questLogTrainerBattleEventId(trainerId: number): number {
  switch (bdata.tables.trainers[trainerId]?.trainerClass) {
    case K.TRAINER_CLASS_LEADER:
      return K.QL_EVENT_DEFEATED_GYM_LEADER;
    case K.TRAINER_CLASS_CHAMPION:
      return K.QL_EVENT_DEFEATED_CHAMPION;
    case K.TRAINER_CLASS_ELITE_FOUR:
      return K.QL_EVENT_DEFEATED_E4_MEMBER;
    default:
      return K.QL_EVENT_DEFEATED_TRAINER;
  }
}

/**
 * TrySetQuestLogBattleEvent: after a won (or caught) battle that isn't a link, the old man's tutorial or the
 * Pokédude's. The trainer battle's event names the opponent's last mon and the player's mon that beat it, and how
 * much HP the player's side kept (hpFractionId 0: at least two thirds, 1: at least a third, 2: less).
 */
export function TrySetQuestLogBattleEvent(): void {
  if (g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_OLD_MAN_TUTORIAL | K.BATTLE_TYPE_POKEDUDE)) return;
  if (g.battleOutcome !== K.B_OUTCOME_WON && g.battleOutcome !== K.B_OUTCOME_CAUGHT) return;

  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
    const eventId = questLogTrainerBattleEventId(g.trainerBattleOpponent_A);
    const left = g.battleMons[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)];
    let speciesPlayer: number;
    let playerEndingHP: number;
    let playerMaxHP: number;
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
      const right = g.battleMons[getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT)];
      // Decide which of the pokemon on the player's side to mention as the victor
      const lastAttacker = g.battleStruct.lastAttackerToFaintOpponent;
      if (getBattlerSide(lastAttacker) === K.B_SIDE_PLAYER) speciesPlayer = g.battleMons[lastAttacker].species;
      else if (left.hp !== 0) speciesPlayer = left.species;
      else speciesPlayer = right.species;
      // (u16 sums, as the C keeps them)
      playerEndingHP = (left.hp + right.hp) & 0xffff;
      playerMaxHP = (left.maxHP + right.maxHP) & 0xffff;
    } else {
      speciesPlayer = left.species;
      playerEndingHP = left.hp;
      playerMaxHP = left.maxHP;
    }
    // Calculate fractional HP loss (determines flavor text, e.g. "handily" vs "somehow" defeated trainer)
    let hpFractionId = 0;
    if (playerEndingHP < Math.floor(playerMaxHP / 3) * 2) hpFractionId++;
    if (playerEndingHP < Math.floor(playerMaxHP / 3)) hpFractionId++;
    const trainerData: QuestLogEventTrainerBattle = {
      trainerId: g.trainerBattleOpponent_A,
      speciesOpponent: g.battleResults.lastOpponentSpecies,
      speciesPlayer,
      hpFractionId,
      mapSec: currentMapSec(),
    };
    SetQuestLogEvent(eventId, trainerData as unknown as Record<string, unknown>);
  } else {
    // GetMonData(gEnemyParty, MON_DATA_SPECIES): the first enemy mon
    const species = g.enemyParty[0]?.species ?? K.SPECIES_NONE;
    const wildData: QuestLogEventWildBattle =
      g.battleOutcome === K.B_OUTCOME_WON
        ? { defeatedSpecies: species, caughtSpecies: K.SPECIES_NONE, mapSec: currentMapSec() }
        : { defeatedSpecies: K.SPECIES_NONE, caughtSpecies: species, mapSec: currentMapSec() };
    SetQuestLogEvent(K.QL_EVENT_DEFEATED_WILD_MON, wildData as unknown as Record<string, unknown>);
  }
}

/** gLinkPlayers[i] as quest_log_battle.c reads it */
export interface QuestLogLinkPlayer {
  id: number;
  name: number[];
}

/**
 * TrySetQuestLogLinkBattleEvent (battle_main.c, the link battle's end): the outcome and the partner's / opponents'
 * names. The port has no link play: the caller passes gLinkPlayers, gBattleStruct->multiplayerId and InUnionRoom().
 */
export function TrySetQuestLogLinkBattleEvent(linkPlayers: QuestLogLinkPlayer[], multiplayerId: number, inUnionRoom: boolean): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_LINK)) return;
  const name = (i: number) => linkPlayers[i]?.name.slice(0, K.PLAYER_NAME_LENGTH) ?? [];
  const data: QuestLogEventLinkBattle = { outcome: g.battleOutcome - 1, playerNames: [] }; // 0 = won, 1 = lost, 2 = drew
  let eventId: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_MULTI) {
    eventId = K.QL_EVENT_LINK_BATTLED_MULTI;
    const { partnerIdx, opponentIdxs } = GetLinkMultiBattlePlayerIndexes(linkPlayers, multiplayerId);
    data.playerNames = [name(partnerIdx), name(opponentIdxs[0]), name(opponentIdxs[1])];
  } else {
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) eventId = K.QL_EVENT_LINK_BATTLED_DOUBLE;
    else eventId = inUnionRoom ? K.QL_EVENT_LINK_BATTLED_UNION : K.QL_EVENT_LINK_BATTLED_SINGLE;
    data.playerNames = [name(multiplayerId ^ 1)];
  }
  SetQuestLogEvent(eventId, data as unknown as Record<string, unknown>);
}

/** GetLinkMultiBattlePlayerIndexes: the partner (id ^ 2) and the two opponents */
function GetLinkMultiBattlePlayerIndexes(linkPlayers: QuestLogLinkPlayer[], multiplayerId: number): { partnerIdx: number; opponentIdxs: number[] } {
  let partnerIdx = 0;
  const opponentIdxs: number[] = [];
  const partnerId = (linkPlayers[multiplayerId]?.id ?? 0) ^ 2;
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    if (partnerId === linkPlayers[i]?.id) partnerIdx = i;
    else if (i !== multiplayerId) opponentIdxs.push(i);
  }
  return { partnerIdx, opponentIdxs };
}
