// Easy Chat's data (public/gen/easyChat.json, tools/extract_easy_chat.py: src/data/easy_chat/*.h and the tables of
// easy_chat.c / easy_chat_2.c) and the new-game part of easy_chat.c (InitEasyChatPhrases, InitQuestionnaireWords).
// This module imports nothing at runtime so GameState can run those two from its constructor (NewGameInitData);
// the rest of easy_chat.c is menus/easyChat.ts.
//
// The data is set once at boot (Assets.init → initEasyChatData) before any GameState is created; the unit tests'
// gameData.ts does the same.

import type { GameState } from '../state/GameState';

/** struct EasyChatWordInfo: the word's raw decomp text (no EOS), its alphabetical index in the group, enabled. */
export interface EasyChatWordInfo {
  text: string;
  alphabeticalOrder: number;
  enabled: boolean;
}

/** struct EasyChatGroup: `values` for the POKEMON / POKEMON_2 / MOVE_1 / MOVE_2 groups (species / move ids), else `words`. */
export interface EasyChatGroup {
  numWords: number;
  numEnabledWords: number;
  values?: number[];
  words?: EasyChatWordInfo[];
}

/** struct EasyChatScreenTemplate (easy_chat_2.c); the texts are src/strings.c labels, null where the C leaves them NULL. */
export interface EasyChatScreenTemplate {
  type: number;
  numColumns: number;
  numRows: number;
  frameId: number;
  titleText: string | null;
  instructionsText1: string | null;
  instructionsText2: string | null;
  confirmText1: string | null;
  confirmText2: string | null;
}

export interface EasyChatConstants {
  EC_GROUP_POKEMON: number;
  EC_GROUP_POKEMON_2: number;
  EC_GROUP_TRAINER: number;
  EC_GROUP_LIFESTYLE: number;
  EC_GROUP_HOBBIES: number;
  EC_GROUP_ADJECTIVES: number;
  EC_GROUP_EVENTS: number;
  EC_GROUP_MOVE_1: number;
  EC_GROUP_MOVE_2: number;
  EC_GROUP_TRENDY_SAYING: number;
  EC_NUM_GROUPS: number;
  EC_WORD_UNDEFINED: number;
  NUM_ADDITIONAL_PHRASES: number;
  NUM_ADDITIONAL_PHRASE_BYTES: number;
  NUM_QUESTIONNAIRE_WORDS: number;
  EASY_CHAT_BATTLE_WORDS_COUNT: number;
  MAIL_WORDS_COUNT: number;
  NUM_ALPHABET_ROWS: number;
  NUM_ALPHABET_COLUMNS: number;
  [name: string]: number;
}

/** public/gen/easyChat.json */
export interface EasyChatData {
  constants: EasyChatConstants;
  /** sEasyChatGroups by EC_GROUP_* */
  groups: EasyChatGroup[];
  /**
   * sEasyChatWordsByLetterPointers: others, A-Z. `words` as the C has them: EC words, and before a species name in
   * both POKéMON groups the marker EC_WORD_UNDEFINED followed by the count (2) of words that share the entry.
   */
  wordsByLetter: { words: number[]; numWords: number }[];
  /** sEasyChatGroupNamePointers by EC_GROUP_*: the src/strings.c label and its raw text. */
  groupNames: { label: string; text: string }[];
  /** sDefaultProfileWords */
  defaultProfileWords: number[];
  /** sDefaultBattleStartWords */
  defaultBattleStartWords: number[];
  /** sDeoxysValue */
  deoxys: number[];
  /** gText_ThreeQuestionMarks's raw text */
  threeQuestionMarks: string;
  /** sEasyChatScreenTemplates (easy_chat_2.c) */
  screenTemplates: EasyChatScreenTemplate[];
  /** sECPhrase_MysteryEventIsExciting / sECPhrase_LinkTogetherWithAll (easy_chat_2.c), by name */
  passphrases: Record<string, number[]>;
}

let sData: EasyChatData | undefined;

/** Set the extracted data (once at boot). */
export function initEasyChatData(data: EasyChatData): void {
  sData = data;
}

/** The extracted data; throws if initEasyChatData hasn't run. */
export function easyChatData(): EasyChatData {
  if (!sData) throw new Error('[easy chat] easyChat.json not loaded');
  return sData;
}

/** The constants of constants/easy_chat.h (and easy_chat.h / global.h) the easy chat code reads. */
export function EC(): EasyChatConstants {
  return easyChatData().constants;
}

/** EC_GROUP(word) */
export function EC_GROUP(word: number): number {
  return word >> 9;
}

/** EC_INDEX(word) */
export function EC_INDEX(word: number): number {
  return word & 0x1ff;
}

/** EC_WORD(groupId, index) */
export function EC_WORD(groupId: number, index: number): number {
  return ((groupId & 0x7f) << 9) | (index & 0x1ff);
}

/** The Easy Chat fields of gSaveBlock1 (GameState holds them; saved by state/saveData.ts). */
export interface EasyChatSaveFields {
  /** gSaveBlock1Ptr->easyChatProfile (EASY_CHAT_BATTLE_WORDS_COUNT words; the profile uses the first 4) */
  easyChatProfile: number[];
  /** gSaveBlock1Ptr->easyChatBattleStart */
  easyChatBattleStart: number[];
  /** gSaveBlock1Ptr->easyChatBattleWon */
  easyChatBattleWon: number[];
  /** gSaveBlock1Ptr->easyChatBattleLost */
  easyChatBattleLost: number[];
  /** gSaveBlock1Ptr->mysteryGift.questionnaireWords (GetQuestionnaireWordsPtr) */
  questionnaireWords: number[];
  /** gSaveBlock1Ptr->additionalPhrases: one bit per trendy saying (IsTrendySayingUnlocked / EnableRareWord) */
  additionalPhrases: number[];
}

/**
 * InitEasyChatPhrases (NewGameInitData): the default profile and battle-start words, empty win / loss words, no
 * trendy sayings. The mail words it also clears aren't modelled (no mail). Without UBFIX the C clears 64 bytes
 * from additionalPhrases on (into the Mauville old man's data, re-initialized right after); the port clears the
 * array.
 */
export function InitEasyChatPhrases(state: EasyChatSaveFields): void {
  const d = easyChatData();
  const { EASY_CHAT_BATTLE_WORDS_COUNT, EC_WORD_UNDEFINED, NUM_ADDITIONAL_PHRASE_BYTES } = d.constants;
  const words = (init: number[]) => Array.from({ length: EASY_CHAT_BATTLE_WORDS_COUNT }, (_, i) => init[i] ?? EC_WORD_UNDEFINED);
  // The C writes 4 profile words and leaves the other 2 of the array as they were (zeroed save block).
  state.easyChatProfile = Array.from({ length: EASY_CHAT_BATTLE_WORDS_COUNT }, (_, i) => d.defaultProfileWords[i] ?? 0);
  state.easyChatBattleStart = words(d.defaultBattleStartWords);
  state.easyChatBattleWon = words([]);
  state.easyChatBattleLost = words([]);
  state.additionalPhrases = new Array<number>(NUM_ADDITIONAL_PHRASE_BYTES).fill(0);
}

/** InitQuestionnaireWords (ClearMysteryGift, at new game): every word EC_WORD_UNDEFINED. */
export function InitQuestionnaireWords(state: EasyChatSaveFields): void {
  const { NUM_QUESTIONNAIRE_WORDS, EC_WORD_UNDEFINED } = EC();
  state.questionnaireWords = new Array<number>(NUM_QUESTIONNAIRE_WORDS).fill(EC_WORD_UNDEFINED);
}

/** ShowEasyChatScreen / ShowEasyChatMessage's word arrays by EASY_CHAT_TYPE_* (undefined for other types; mail isn't modelled). */
export function easyChatWordsForType(state: GameState, type: number): number[] | undefined {
  const c = EC();
  switch (type) {
    case c.EASY_CHAT_TYPE_PROFILE:
      return state.easyChatProfile;
    case c.EASY_CHAT_TYPE_BATTLE_START:
      return state.easyChatBattleStart;
    case c.EASY_CHAT_TYPE_BATTLE_WON:
      return state.easyChatBattleWon;
    case c.EASY_CHAT_TYPE_BATTLE_LOST:
      return state.easyChatBattleLost;
    case c.EASY_CHAT_TYPE_QUESTIONNAIRE:
      return state.questionnaireWords;
    default:
      return undefined;
  }
}
