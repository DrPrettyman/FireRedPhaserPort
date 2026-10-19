// battle_message.c: picking the string for a STRINGID and expanding its battle placeholders
// (BufferStringBattle / BattleStringExpandPlaceholders / ExpandBattleTextBuffPlaceholders).
// Strings are kept as raw decomp text in strings.json and encoded through the charmap on demand.

import { EOS, EXT_CTRL_CODE_BEGIN, PLACEHOLDER_BEGIN } from '../text/charmap';
import { expandPlaceholders } from '../text/placeholders';
import { K } from './constants';
import type { BattleMsgData } from './controllers';
import { bdata, charmap, g, gBattleMoves, pokemon, state, textStrings } from './env';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from './stringUtil';
import { getBattlerAtPosition, getBattlerSide, setBattleStringEncoder } from './util';
import { GetTrainerTowerOpponentClass, GetTrainerTowerOpponentLoseText, GetTrainerTowerOpponentName, GetTrainerTowerOpponentWinText } from '../world/trainerTower';

const encoded = new Map<string, number[]>();

/** A C string symbol from battle_message.c / battle_main.c, encoded (EOS-terminated). */
export function encodeBattleText(sym: string): number[] {
  let e = encoded.get(sym);
  if (!e) {
    const raw = bdata.strings.strings[sym] ?? textStrings[sym];
    if (raw === undefined) console.warn(`[battle] missing string ${sym}`);
    e = charmap.encode(raw ?? '$');
    encoded.set(sym, e);
  }
  return e;
}

function encodeRaw(raw: string | null | undefined): number[] {
  return charmap.encode(raw ?? '$');
}

export function initBattleMessages(): void {
  encoded.clear();
  setBattleStringEncoder((raw) => charmap.encode(raw));
}

/** sBattlerAbilities */
const sBattlerAbilities = new Uint8Array(4);
/** sBattleMsgDataPtr */
let msgData: BattleMsgData;

/** EOS-terminated copy of a byte buffer (StringCopy source). */
function cstr(src: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length && src[i] !== EOS; i++) out.push(src[i]);
  out.push(EOS);
  return out;
}

function stringIdSym(stringId: number): string | undefined {
  return bdata.strings.battleStrings[stringId];
}

/** gBattleStringsTable[stringId - BATTLESTRINGS_TABLE_START], encoded */
export function gBattleStringsTable(stringId: number): number[] {
  return encodeBattleText(stringIdSym(stringId) ?? '');
}

/** gMoveNames[move] */
export function moveName(move: number): number[] {
  return charmap.encode(gBattleMoves[move]?.name ?? '$');
}

/** gTypeNames[type] */
export function typeName(type: number): number[] {
  return encodeRaw(bdata.strings.typeNames[type]);
}

function aTypeMove(): number[] {
  return encodeBattleText(bdata.strings.pointerTables.sATypeMove_Table[g.battleStruct.stringMoveType] ?? '');
}

/** BufferStringBattle */
export function bufferStringBattle(stringId: number): void {
  msgData = g.battleBufferAObj[g.activeBattler] as BattleMsgData;
  g.lastUsedItem = msgData.lastItem;
  g.lastUsedAbility = msgData.lastAbility;
  g.battleScripting.battler = msgData.scrActive;
  g.battleStruct.scriptPartyIdx = msgData.bakScriptPartyIdx;
  g.battleStruct.hpScale = msgData.hpScale;
  g.potentialItemEffectBattler = msgData.itemEffectBattler;
  g.battleStruct.stringMoveType = msgData.moveType;
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) sBattlerAbilities[i] = msgData.abilities[i];
  for (let i = 0; i < K.TEXT_BUFF_ARRAY_COUNT; i++) {
    g.battleTextBuff1[i] = msgData.textBuffs[0][i];
    g.battleTextBuff2[i] = msgData.textBuffs[1][i];
    g.battleTextBuff3[i] = msgData.textBuffs[2][i];
  }
  const f = g.battleTypeFlags;
  let stringPtr: number[];
  switch (stringId) {
    case K.STRINGID_INTROMSG: // first battle msg
      if (f & K.BATTLE_TYPE_TRAINER) {
        stringPtr = encodeBattleText('sText_Trainer1WantsToBattle'); // link variants unsupported
      } else if (f & K.BATTLE_TYPE_GHOST) {
        stringPtr = encodeBattleText(f & K.BATTLE_TYPE_GHOST_UNVEILED ? 'sText_TheGhostAppeared' : 'sText_GhostAppearedCantId');
      } else if (f & K.BATTLE_TYPE_LEGENDARY) stringPtr = encodeBattleText('sText_WildPkmnAppeared2');
      else if (f & K.BATTLE_TYPE_DOUBLE) stringPtr = encodeBattleText('sText_TwoWildPkmnAppeared');
      else if (f & K.BATTLE_TYPE_OLD_MAN_TUTORIAL) stringPtr = encodeBattleText('sText_WildPkmnAppearedPause');
      else stringPtr = encodeBattleText('sText_WildPkmnAppeared');
      break;
    case K.STRINGID_INTROSENDOUT: // poke first send-out
      if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER) {
        stringPtr = encodeBattleText(f & K.BATTLE_TYPE_DOUBLE ? (f & K.BATTLE_TYPE_MULTI ? 'sText_LinkPartnerSentOutPkmnGoPkmn' : 'sText_GoTwoPkmn') : 'sText_GoPkmn');
      } else if (f & K.BATTLE_TYPE_DOUBLE) {
        stringPtr = encodeBattleText(f & K.BATTLE_TYPE_MULTI ? 'sText_TwoLinkTrainersSentOutPkmn' : f & K.BATTLE_TYPE_LINK ? 'sText_LinkTrainerSentOutTwoPkmn' : 'sText_Trainer1SentOutTwoPkmn');
      } else {
        stringPtr = encodeBattleText('sText_Trainer1SentOutPkmn');
      }
      break;
    case K.STRINGID_RETURNMON: // sending poke to ball msg
      if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER) {
        const hs = g.battleStruct.hpScale;
        if (hs === 0) stringPtr = encodeBattleText('sText_PkmnThatsEnough');
        else if (hs === 1 || f & K.BATTLE_TYPE_DOUBLE) stringPtr = encodeBattleText('sText_PkmnComeBack');
        else if (hs === 2) stringPtr = encodeBattleText('sText_PkmnOkComeBack');
        else stringPtr = encodeBattleText('sText_PkmnGoodComeBack');
      } else {
        stringPtr = encodeBattleText('sText_Trainer1WithdrewPkmn');
      }
      break;
    case K.STRINGID_SWITCHINMON: // switch-in msg
      if (getBattlerSide(g.battleScripting.battler) === K.B_SIDE_PLAYER) {
        const hs = g.battleStruct.hpScale;
        if (hs === 0 || f & K.BATTLE_TYPE_DOUBLE) stringPtr = encodeBattleText('sText_GoPkmn2');
        else if (hs === 1) stringPtr = encodeBattleText('sText_DoItPkmn');
        else if (hs === 2) stringPtr = encodeBattleText('sText_GoForItPkmn');
        else stringPtr = encodeBattleText('sText_YourFoesWeakGetEmPkmn');
      } else {
        stringPtr = encodeBattleText('sText_Trainer1SentOutPkmn2');
      }
      break;
    case K.STRINGID_USEDMOVE: {
      // pokemon used a move msg
      chooseMoveUsedParticle(g.battleTextBuff1); // buff1 doesn't appear in the string, leftover from japanese move names
      const name = msgData.currentMove >= K.MOVES_COUNT ? aTypeMove() : moveName(msgData.currentMove);
      const withMark = chooseTypeOfMoveUsedString(name);
      for (let i = 0; i < K.TEXT_BUFF_ARRAY_COUNT; i++) g.battleTextBuff2[i] = withMark[i] ?? 0; // overflows into buff3 on the GBA
      stringPtr = encodeBattleText('sText_AttackerUsedX');
      break;
    }
    case K.STRINGID_BATTLEEND: // battle end (link only)
      stringPtr = [EOS];
      break;
    default: {
      // load a string from the table
      const sym = stringIdSym(stringId);
      if (stringId >= K.BATTLESTRINGS_COUNT || !sym) {
        g.displayedStringBattle = [EOS];
        return;
      }
      stringPtr = encodeBattleText(sym);
      break;
    }
  }
  g.displayedStringBattle = battleStringExpandPlaceholders(stringPtr);
}

/** BattleStringExpandPlaceholdersToDisplayedString */
export function battleStringExpandPlaceholdersToDisplayedString(src: number[]): void {
  g.displayedStringBattle = battleStringExpandPlaceholders(src);
}

/** TryGetStatusString: battle_util copies the Japanese status names into buff1; swap in English. */
function tryGetStatusString(src: ArrayLike<number>): number[] | undefined {
  const status = [EOS, EOS, EOS, EOS, EOS, EOS, EOS, EOS];
  for (let i = 0; i < 8 && src[i] !== EOS; i++) status[i] = src[i];
  for (const [jpn, eng] of bdata.strings.statusConditionStrings) {
    const j = encodeBattleText(jpn);
    let same = true;
    for (let i = 0; i < 8; i++) if ((j[i] ?? EOS) !== status[i]) same = false;
    if (same) return encodeBattleText(eng);
  }
  return undefined;
}

function nickname(mon: { nickname: number[] } | undefined): number[] {
  return mon ? [...mon.nickname, EOS] : [EOS]; // GetMonData(MON_DATA_NICKNAME) + StringGet_Nickname
}

/** HANDLE_NICKNAME_STRING_CASE */
function nicknameWithPrefix(battler: number, monIndex: number, dst: number[]): number[] {
  if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) {
    const prefix = encodeBattleText(g.battleTypeFlags & K.BATTLE_TYPE_TRAINER ? 'sText_FoePkmnPrefix' : 'sText_WildPkmnPrefix');
    for (const c of prefix) if (c !== EOS) dst.push(c);
    else break;
    return nickname(g.enemyParty[monIndex]);
  }
  return nickname(g.playerParty[monIndex]);
}

function playerOrFoe(battler: number, ally: string, foe: string): number[] {
  return encodeBattleText(getBattlerSide(battler) === K.B_SIDE_PLAYER ? ally : foe);
}

function abilityName(ability: number): number[] {
  return encodeRaw(bdata.strings.abilityNames[ability]);
}

function trainer() {
  return bdata.tables.trainers[g.trainerBattleOpponent_A]!;
}

/** BattleStringExpandPlaceholders */
export function battleStringExpandPlaceholders(src: number[]): number[] {
  const dst: number[] = [];
  let i = 0;
  while (src[i] !== EOS && i < src.length) {
    if (src[i] === PLACEHOLDER_BEGIN) {
      i++;
      let toCpy: number[] = [EOS];
      switch (src[i]) {
        case K.B_TXT_BUFF1:
          if (g.battleTextBuff1[0] === K.B_BUFF_PLACEHOLDER_BEGIN) {
            state.stringVars[0] = expandBattleTextBuffPlaceholders(g.battleTextBuff1);
            toCpy = [...state.stringVars[0], EOS];
          } else {
            toCpy = tryGetStatusString(g.battleTextBuff1) ?? cstr(g.battleTextBuff1);
          }
          break;
        case K.B_TXT_BUFF2:
          if (g.battleTextBuff2[0] === K.B_BUFF_PLACEHOLDER_BEGIN) {
            state.stringVars[1] = expandBattleTextBuffPlaceholders(g.battleTextBuff2);
            toCpy = [...state.stringVars[1], EOS];
          } else {
            // sText_AttackerUsedX's buff2 may run past 16 bytes on the GBA; keep the full name.
            toCpy = cstr([...g.battleTextBuff2, ...g.battleTextBuff3]);
          }
          break;
        case K.B_TXT_BUFF3:
          if (g.battleTextBuff3[0] === K.B_BUFF_PLACEHOLDER_BEGIN) {
            state.stringVars[2] = expandBattleTextBuffPlaceholders(g.battleTextBuff3);
            toCpy = [...state.stringVars[2], EOS];
          } else toCpy = cstr(g.battleTextBuff3);
          break;
        case K.B_TXT_COPY_VAR_1:
        case K.B_TXT_COPY_VAR_2:
        case K.B_TXT_COPY_VAR_3:
          toCpy = [...state.stringVars[src[i] - K.B_TXT_COPY_VAR_1], EOS];
          break;
        case K.B_TXT_PLAYER_MON1_NAME:
          toCpy = nickname(g.playerParty[g.battlerPartyIndexes[getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)]]);
          break;
        case K.B_TXT_OPPONENT_MON1_NAME:
          toCpy = nickname(g.enemyParty[g.battlerPartyIndexes[getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT)]]);
          break;
        case K.B_TXT_PLAYER_MON2_NAME:
          toCpy = nickname(g.playerParty[g.battlerPartyIndexes[getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT)]]);
          break;
        case K.B_TXT_OPPONENT_MON2_NAME:
          toCpy = nickname(g.enemyParty[g.battlerPartyIndexes[getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT)]]);
          break;
        case K.B_TXT_ATK_NAME_WITH_PREFIX_MON1:
          toCpy = nicknameWithPrefix(g.battlerAttacker, g.battlerPartyIndexes[getBattlerAtPosition(getBattlerSide(g.battlerAttacker))], dst);
          break;
        case K.B_TXT_ATK_PARTNER_NAME: {
          const party = getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
          toCpy = nickname(party[g.battlerPartyIndexes[getBattlerAtPosition(getBattlerSide(g.battlerAttacker)) + 2]]);
          break;
        }
        case K.B_TXT_ATK_NAME_WITH_PREFIX:
          toCpy = nicknameWithPrefix(g.battlerAttacker, g.battlerPartyIndexes[g.battlerAttacker], dst);
          break;
        case K.B_TXT_DEF_NAME_WITH_PREFIX:
          toCpy = nicknameWithPrefix(g.battlerTarget, g.battlerPartyIndexes[g.battlerTarget], dst);
          break;
        case K.B_TXT_EFF_NAME_WITH_PREFIX:
          toCpy = nicknameWithPrefix(g.effectBattler, g.battlerPartyIndexes[g.effectBattler], dst);
          break;
        case K.B_TXT_ACTIVE_NAME_WITH_PREFIX:
          toCpy = nicknameWithPrefix(g.activeBattler, g.battlerPartyIndexes[g.activeBattler], dst);
          break;
        case K.B_TXT_SCR_ACTIVE_NAME_WITH_PREFIX:
          toCpy = nicknameWithPrefix(g.battleScripting.battler, g.battlerPartyIndexes[g.battleScripting.battler], dst);
          break;
        case K.B_TXT_CURRENT_MOVE:
          toCpy = msgData.currentMove >= K.MOVES_COUNT ? aTypeMove() : moveName(msgData.currentMove);
          break;
        case K.B_TXT_LAST_MOVE:
          toCpy = msgData.originallyUsedMove >= K.MOVES_COUNT ? aTypeMove() : moveName(msgData.originallyUsedMove);
          break;
        case K.B_TXT_LAST_ITEM:
          toCpy = [...pokemon.itemName(g.lastUsedItem), EOS]; // CopyItemName
          break;
        case K.B_TXT_LAST_ABILITY:
          toCpy = abilityName(g.lastUsedAbility);
          break;
        case K.B_TXT_ATK_ABILITY:
          toCpy = abilityName(sBattlerAbilities[g.battlerAttacker]);
          break;
        case K.B_TXT_DEF_ABILITY:
          toCpy = abilityName(sBattlerAbilities[g.battlerTarget]);
          break;
        case K.B_TXT_SCR_ACTIVE_ABILITY:
          toCpy = abilityName(sBattlerAbilities[g.battleScripting.battler]);
          break;
        case K.B_TXT_EFF_ABILITY:
          toCpy = abilityName(sBattlerAbilities[g.effectBattler]);
          break;
        case K.B_TXT_TRAINER1_CLASS:
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) toCpy = encodeRaw(bdata.strings.trainerClassNames[GetTrainerTowerOpponentClass()]);
          else toCpy = encodeRaw(bdata.strings.trainerClassNames[trainer().trainerClass]);
          break;
        case K.B_TXT_TRAINER1_NAME: {
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) {
            toCpy = encodeRaw(GetTrainerTowerOpponentName());
            break;
          }
          const c = trainer().trainerClass;
          if (c === K.TRAINER_CLASS_RIVAL_EARLY || c === K.TRAINER_CLASS_RIVAL_LATE || c === K.TRAINER_CLASS_CHAMPION)
            toCpy = [...charmap.encodePlain(state.rivalName), EOS]; // GetExpandedPlaceholder(PLACEHOLDER_ID_RIVAL)
          else toCpy = encodeRaw(trainer().trainerName);
          break;
        }
        case K.B_TXT_PLAYER_NAME:
          toCpy = [...charmap.encodePlain(state.playerName), EOS];
          break;
        case K.B_TXT_TRAINER1_LOSE_TEXT:
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) toCpy = GetTrainerTowerOpponentLoseText(state, 0); // gStringVar4
          else toCpy = expandPlaceholders(g.trainerADefeatSpeech ?? [EOS], charmap, state); // GetTrainerALoseText
          break;
        case K.B_TXT_TRAINER1_WIN_TEXT:
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER) toCpy = GetTrainerTowerOpponentWinText(state, 0); // gStringVar4
          else toCpy = expandPlaceholders(g.trainerVictorySpeech ?? [EOS], charmap, state); // GetTrainerWonSpeech
          break;
        case K.B_TXT_TRAINER2_LOSE_TEXT: // only the Trainer Tower's doubles reach these
          toCpy = GetTrainerTowerOpponentLoseText(state, 1);
          break;
        case K.B_TXT_TRAINER2_WIN_TEXT:
          toCpy = GetTrainerTowerOpponentWinText(state, 1);
          break;
        case K.B_TXT_26:
          toCpy = nicknameWithPrefix(g.battleScripting.battler, g.battleStruct.scriptPartyIdx, dst);
          break;
        case K.B_TXT_PC_CREATOR_NAME:
          toCpy = encodeBattleText(state.getFlag('FLAG_SYS_NOT_SOMEONES_PC') ? 'sText_Bills' : 'sText_Someones');
          break;
        case K.B_TXT_ATK_PREFIX2:
          toCpy = playerOrFoe(g.battlerAttacker, 'sText_AllyPkmnPrefix2', 'sText_FoePkmnPrefix3');
          break;
        case K.B_TXT_DEF_PREFIX2:
          toCpy = playerOrFoe(g.battlerTarget, 'sText_AllyPkmnPrefix2', 'sText_FoePkmnPrefix3');
          break;
        case K.B_TXT_ATK_PREFIX1:
          toCpy = playerOrFoe(g.battlerAttacker, 'sText_AllyPkmnPrefix', 'sText_FoePkmnPrefix2');
          break;
        case K.B_TXT_DEF_PREFIX1:
          toCpy = playerOrFoe(g.battlerTarget, 'sText_AllyPkmnPrefix', 'sText_FoePkmnPrefix2');
          break;
        case K.B_TXT_ATK_PREFIX3:
          toCpy = playerOrFoe(g.battlerAttacker, 'sText_AllyPkmnPrefix3', 'sText_FoePkmnPrefix4');
          break;
        case K.B_TXT_DEF_PREFIX3:
          toCpy = playerOrFoe(g.battlerTarget, 'sText_AllyPkmnPrefix3', 'sText_FoePkmnPrefix4');
          break;
        default:
          console.warn(`[battle] unsupported battle placeholder 0x${src[i].toString(16)}`);
      }
      for (const c of toCpy) {
        if (c === EOS) break;
        dst.push(c);
      }
      const p = src[i];
      if (p === K.B_TXT_TRAINER1_LOSE_TEXT || p === K.B_TXT_TRAINER1_WIN_TEXT || p === K.B_TXT_TRAINER2_LOSE_TEXT || p === K.B_TXT_TRAINER2_WIN_TEXT)
        dst.push(EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_PAUSE_UNTIL_PRESS);
    } else {
      dst.push(src[i]);
    }
    i++;
  }
  dst.push(EOS);
  return dst;
}

const u16At = (s: ArrayLike<number>, i: number) => s[i] | (s[i + 1] << 8);

/** ExpandBattleTextBuffPlaceholders: returns the expansion without the terminator. */
function expandBattleTextBuffPlaceholders(src: ArrayLike<number>): number[] {
  const dst: number[] = [];
  const append = (s: number[]) => {
    for (const c of s) {
      if (c === EOS) break;
      dst.push(c);
    }
  };
  let srcId = 1;
  while (src[srcId] !== K.B_BUFF_EOS && srcId < src.length) {
    switch (src[srcId]) {
      case K.B_BUFF_STRING: // battle string
        append(encodeBattleText(stringIdSym(u16At(src, srcId + 1)) ?? ''));
        srcId += 3;
        break;
      case K.B_BUFF_NUMBER: {
        // int to string
        let value = 0;
        switch (src[srcId + 1]) {
          case 1:
            value = src[srcId + 3];
            break;
          case 2:
            value = u16At(src, srcId + 3);
            break;
          case 4:
            value = (u16At(src, srcId + 3) | (u16At(src, srcId + 5) << 16)) >>> 0;
            break;
        }
        append(ConvertIntToDecimalStringN(value, STR_CONV_MODE_LEFT_ALIGN, src[srcId + 2]));
        srcId += src[srcId + 1] + 3;
        break;
      }
      case K.B_BUFF_MOVE: // move name
        append(moveName(u16At(src, srcId + 1)));
        srcId += 3;
        break;
      case K.B_BUFF_TYPE: // type name
        append(encodeRaw(bdata.strings.typeNames[src[srcId + 1]]));
        srcId += 2;
        break;
      case K.B_BUFF_MON_NICK_WITH_PREFIX: // poke nick with prefix
        if (getBattlerSide(src[srcId + 1]) === K.B_SIDE_PLAYER) {
          append(nickname(g.playerParty[src[srcId + 2]]));
        } else {
          append(encodeBattleText(g.battleTypeFlags & K.BATTLE_TYPE_TRAINER ? 'sText_FoePkmnPrefix' : 'sText_WildPkmnPrefix'));
          append(nickname(g.enemyParty[src[srcId + 2]]));
        }
        srcId += 3;
        break;
      case K.B_BUFF_STAT: // stats
        append(encodeBattleText(bdata.strings.pointerTables.gStatNamesTable[src[srcId + 1]] ?? ''));
        srcId += 2;
        break;
      case K.B_BUFF_SPECIES: // species name (GetSpeciesName overwrites dst)
        dst.length = 0;
        append(pokemon.speciesName(u16At(src, srcId + 1)));
        srcId += 3;
        break;
      case K.B_BUFF_MON_NICK: // poke nick without prefix (GetMonData overwrites dst)
        dst.length = 0;
        append(nickname((getBattlerSide(src[srcId + 1]) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty)[src[srcId + 2]]));
        srcId += 3;
        break;
      case K.B_BUFF_NEGATIVE_FLAVOR: // flavor table
        append(encodeBattleText(bdata.strings.pointerTables.gPokeblockWasTooXStringTable[src[srcId + 1]] ?? ''));
        srcId += 2;
        break;
      case K.B_BUFF_ABILITY: // ability names
        append(abilityName(src[srcId + 1]));
        srcId += 2;
        break;
      case K.B_BUFF_ITEM: // item name (CopyItemName overwrites dst)
        dst.length = 0;
        append(pokemon.itemName(u16At(src, srcId + 1)));
        srcId += 3;
        break;
      default:
        console.warn(`[battle] bad text buff placeholder ${src[srcId]}`);
        return dst;
    }
  }
  return dst;
}

/** ChooseMoveUsedParticle: functionally unused (buff1 isn't read by sText_AttackerUsedX). */
function chooseMoveUsedParticle(textBuff: Uint8Array): void {
  const counter = grammarCounter();
  const s = counter <= 2 ? encodeBattleText('sText_SpaceIs') : encodeBattleText('sText_ApostropheS');
  for (let i = 0; i < s.length && i < textBuff.length; i++) textBuff[i] = s[i];
}

function grammarCounter(): number {
  const table = bdata.strings.grammarMoveUsed;
  let counter = 0;
  let i = 0;
  while (counter !== K.MAX_MON_MOVES) {
    if (table[i] === K.MOVE_NONE) counter++;
    if (table[i++] === msgData.currentMove) break;
  }
  return counter;
}

/** ChooseTypeOfMoveUsedString: appends the "!" variant; returns the full EOS-terminated buffer. */
function chooseTypeOfMoveUsedString(name: number[]): number[] {
  const base = name.slice(0, name.indexOf(EOS) < 0 ? name.length : name.indexOf(EOS));
  const marks = ['sText_ExclamationMark', 'sText_ExclamationMark2', 'sText_ExclamationMark3', 'sText_ExclamationMark4', 'sText_ExclamationMark5'];
  return [...base, ...encodeBattleText(marks[grammarCounter()])];
}

/** BattleStringShouldBeColored */
export function battleStringShouldBeColored(stringId: number): boolean {
  return (
    stringId === K.STRINGID_TRAINER1LOSETEXT ||
    stringId === K.STRINGID_TRAINER2LOSETEXT ||
    stringId === K.STRINGID_TRAINER1WINTEXT ||
    stringId === K.STRINGID_TRAINER2WINTEXT
  );
}

/** GetCurrentPpToMaxPpState */
export function getCurrentPpToMaxPpState(currentPp: number, maxPp: number): number {
  if (maxPp === currentPp) return 3;
  if (maxPp <= 2) return currentPp > 1 ? 3 : 2 - currentPp;
  if (maxPp <= 7) return currentPp > 2 ? 3 : 2 - currentPp;
  if (currentPp === 0) return 2;
  if (currentPp <= Math.trunc(maxPp / 4)) return 1;
  if (currentPp > Math.trunc(maxPp / 2)) return 3;
  return 0;
}
