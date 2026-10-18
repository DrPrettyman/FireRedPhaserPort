// easy_chat.c: Easy Chat words (lookup, text, which groups and words are unlocked), the field's easy chat message
// (ShowEasyChatMessage), the trendy sayings (additionalPhrases), and the word selection lists the Easy Chat screen
// shows (InitEasyChatSelection ...). The data and InitEasyChatPhrases / InitQuestionnaireWords are
// menus/easyChatData.ts.
//
// Words are u16s: EC_WORD(group, index). The POKEMON / POKEMON_2 groups' index is a species id, the MOVE_1 / MOVE_2
// groups' a move id (their valueList holds the ids that are words); other groups index their EasyChatWordInfo
// list. Strings are encoded bytes: CopyEasyChatWord returns the word without EOS, ConvertEasyChatWordsToString
// a whole message with EOS. Functions that read the save or the Pokédex take the GameState; functions that roll
// take an optional `rand` (default Random()).

import type { GameState } from '../state/GameState';
import { isNationalDexEnabled } from '../script/specials';
import { CHAR_NEWLINE, EOS } from '../text/charmap';
import { random } from '../util/random';
import { EC, EC_GROUP, EC_INDEX, EC_WORD, easyChatData } from './easyChatData';
import { FLAG_GET_SEEN, GetNationalPokedexCount, GetSetPokedexFlag } from './pokedex';

const CHAR_SPACE = 0x00;

/** The groups whose words are species / move ids (valueList) rather than EasyChatWordInfo. */
function isValueListGroup(groupId: number): boolean {
  const c = EC();
  return groupId === c.EC_GROUP_POKEMON || groupId === c.EC_GROUP_POKEMON_2 || groupId === c.EC_GROUP_MOVE_1 || groupId === c.EC_GROUP_MOVE_2;
}

/** EC_IsNationalPokedexEnabled */
function EC_IsNationalPokedexEnabled(state: GameState): boolean {
  return isNationalDexEnabled(state);
}

/** IsECGroupUnlocked */
export function IsECGroupUnlocked(state: GameState, groupId: number): boolean {
  const c = EC();
  switch (groupId) {
    case c.EC_GROUP_TRENDY_SAYING:
      return false;
    case c.EC_GROUP_EVENTS:
    case c.EC_GROUP_MOVE_1:
    case c.EC_GROUP_MOVE_2:
      return state.getFlag('FLAG_SYS_GAME_CLEAR');
    case c.EC_GROUP_POKEMON:
      return EC_IsNationalPokedexEnabled(state);
    default:
      return true;
  }
}

/** EasyChat_GetNumWordsInGroup */
export function EasyChat_GetNumWordsInGroup(state: GameState, groupId: number): number {
  if (groupId === EC().EC_GROUP_POKEMON) return GetNationalPokedexCount(state, FLAG_GET_SEEN);
  if (IsECGroupUnlocked(state, groupId)) return easyChatData().groups[groupId].numEnabledWords;
  return 0;
}

/** IsECWordInvalid: EC_WORD_UNDEFINED is valid (an empty slot). */
export function IsECWordInvalid(easyChatWord: number): boolean {
  const c = EC();
  if (easyChatWord === c.EC_WORD_UNDEFINED) return false;
  const groupId = EC_GROUP(easyChatWord);
  const index = EC_INDEX(easyChatWord);
  if (groupId >= c.EC_NUM_GROUPS) return true;
  const group = easyChatData().groups[groupId];
  if (isValueListGroup(groupId)) {
    for (let i = 0; i < group.numWords; i++) if (index === group.values![i]) return false;
    return true;
  }
  return index >= group.numWords;
}

const wordTexts = new Map<number, number[]>();

/** GetEasyChatWord: the word's text (gSpeciesNames / gMoveNames for the value-list groups), without EOS. */
function GetEasyChatWord(state: GameState, groupId: number, index: number): number[] {
  const c = EC();
  switch (groupId) {
    case c.EC_GROUP_POKEMON:
    case c.EC_GROUP_POKEMON_2:
      return state.pokemon.speciesName(index);
    case c.EC_GROUP_MOVE_1:
    case c.EC_GROUP_MOVE_2:
      return state.pokemon.encodeName(state.pokemon.moves[index]?.name ?? '$');
    default: {
      const word = EC_WORD(groupId, index);
      let text = wordTexts.get(word);
      if (!text) {
        text = state.pokemon.encodeName(easyChatData().groups[groupId].words![index].text);
        wordTexts.set(word, text);
      }
      return text;
    }
  }
}

/** CopyEasyChatWord: the word's text without EOS; "???" for an invalid word, nothing for EC_WORD_UNDEFINED. */
export function CopyEasyChatWord(state: GameState, easyChatWord: number): number[] {
  if (IsECWordInvalid(easyChatWord)) return state.pokemon.encodeName(easyChatData().threeQuestionMarks);
  if (easyChatWord !== EC().EC_WORD_UNDEFINED) return [...GetEasyChatWord(state, EC_GROUP(easyChatWord), EC_INDEX(easyChatWord))];
  return [];
}

/**
 * ConvertEasyChatWordsToString: `rows` lines of `columns` words from `src`, a space after each word but the last of
 * a line (none after an EC_WORD_UNDEFINED), lines joined by CHAR_NEWLINE; ends with EOS.
 */
export function ConvertEasyChatWordsToString(state: GameState, src: readonly number[], columns: number, rows: number): number[] {
  const dest: number[] = [];
  const numColumns = columns - 1;
  let s = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < numColumns; j++) {
      dest.push(...CopyEasyChatWord(state, src[s]));
      if (src[s] !== EC().EC_WORD_UNDEFINED) dest.push(CHAR_SPACE);
      s++;
    }
    dest.push(...CopyEasyChatWord(state, src[s++]));
    dest.push(CHAR_NEWLINE);
  }
  // dest--; *dest = EOS: the last newline becomes the terminator
  dest[dest.length - 1] = EOS;
  return dest;
}

/** GetEasyChatWordStringLength */
function GetEasyChatWordStringLength(state: GameState, easyChatWord: number): number {
  if (easyChatWord === EC().EC_WORD_UNDEFINED) return 0;
  if (IsECWordInvalid(easyChatWord)) return state.pokemon.encodeName(easyChatData().threeQuestionMarks).length;
  return GetEasyChatWord(state, EC_GROUP(easyChatWord), EC_INDEX(easyChatWord)).length;
}

/**
 * EC_DoesEasyChatStringFitOnLine: despite the name, TRUE when a row of `columns` words (plus a space between each)
 * is longer than `maxLength` characters, i.e. when it doesn't fit.
 */
export function EC_DoesEasyChatStringFitOnLine(state: GameState, easyChatWords: readonly number[], columns: number, rows: number, maxLength: number): boolean {
  let w = 0;
  for (let i = 0; i < rows; i++) {
    let totalLength = columns - 1;
    for (let j = 0; j < columns; j++) totalLength += GetEasyChatWordStringLength(state, easyChatWords[w++]);
    if (totalLength > maxLength) return true;
  }
  return false;
}

/** GetRandomWordFromGroup */
function GetRandomWordFromGroup(groupId: number, rand: () => number): number {
  const group = easyChatData().groups[groupId];
  let index = rand() % group.numWords;
  if (isValueListGroup(groupId)) index = group.values![index];
  return EC_WORD(groupId, index);
}

/** GetRandomWordFromAnyGroup */
function GetRandomWordFromAnyGroup(state: GameState, groupId: number, rand: () => number): number {
  if (!IsECGroupUnlocked(state, groupId)) return EC().EC_WORD_UNDEFINED;
  if (groupId === EC().EC_GROUP_POKEMON) return GetRandomECPokemon(state, rand);
  return GetRandomWordFromGroup(groupId, rand);
}

/**
 * ShowEasyChatMessage's text: gSaveBlock1's words for VAR_0x8004 (0 profile 2x2, 1 battle start 3x2 or 2x3 when a
 * row of 3 is too long for 18 characters, 2 won / 3 lost 3x2) as ConvertEasyChatWordsToString leaves gStringVar4;
 * undefined for another VAR_0x8004 (the C returns without a message).
 */
export function EasyChatMessageText(state: GameState, which: number): number[] | undefined {
  let words: number[];
  let columns: number;
  let rows: number;
  switch (which) {
    case 0:
      words = state.easyChatProfile;
      columns = 2;
      rows = 2;
      break;
    case 1:
      words = state.easyChatBattleStart;
      if (EC_DoesEasyChatStringFitOnLine(state, state.easyChatBattleStart, 3, 2, 18)) {
        columns = 2;
        rows = 3;
      } else {
        columns = 3;
        rows = 2;
      }
      break;
    case 2:
      words = state.easyChatBattleWon;
      columns = 3;
      rows = 2;
      break;
    case 3:
      words = state.easyChatBattleLost;
      columns = 3;
      rows = 2;
      break;
    default:
      return undefined;
  }
  return ConvertEasyChatWordsToString(state, words, columns, rows);
}

/** BufferRandomHobbyOrLifestyleString: gStringVar2 = a random HOBBIES or LIFESTYLE word. */
export function BufferRandomHobbyOrLifestyleString(state: GameState, rand: () => number = random): void {
  const c = EC();
  const groupId = rand() & 1 ? c.EC_GROUP_HOBBIES : c.EC_GROUP_LIFESTYLE;
  state.stringVars[1] = CopyEasyChatWord(state, GetRandomWordFromAnyGroup(state, groupId, rand));
}

// ------------------------------------------------------------------ trendy sayings (additionalPhrases)

/** IsTrendySayingUnlocked */
export function IsTrendySayingUnlocked(state: GameState, additionalPhraseId: number): boolean {
  return ((state.additionalPhrases[additionalPhraseId >> 3] >> (additionalPhraseId & 7)) & 1) !== 0;
}

/** EnableRareWord (the mystery event script's `enableRareWord`): ids from NUM_ADDITIONAL_PHRASES on are ignored. */
export function EnableRareWord(state: GameState, additionalPhraseId: number): void {
  if (additionalPhraseId < EC().NUM_ADDITIONAL_PHRASES) {
    state.additionalPhrases[additionalPhraseId >> 3] |= 1 << (additionalPhraseId & 7);
  }
}

/** GetNumUnlockedTrendySayings */
export function GetNumUnlockedTrendySayings(state: GameState): number {
  let n = 0;
  for (let i = 0; i < EC().NUM_ADDITIONAL_PHRASES; i++) if (IsTrendySayingUnlocked(state, i)) n++;
  return n;
}

/** UnlockRandomTrendySaying (unused in FRLG): unlocks one of the locked sayings and returns its word. */
export function UnlockRandomTrendySaying(state: GameState, rand: () => number = random): number {
  const c = EC();
  const unlocked = GetNumUnlockedTrendySayings(state);
  if (unlocked === c.NUM_ADDITIONAL_PHRASES) return c.EC_WORD_UNDEFINED;
  let id = (rand() % (c.NUM_ADDITIONAL_PHRASES - unlocked)) & 0xffff;
  for (let i = 0; i < c.NUM_ADDITIONAL_PHRASES; i++) {
    if (IsTrendySayingUnlocked(state, i)) continue;
    if (id) id--;
    else {
      EnableRareWord(state, i);
      return EC_WORD(c.EC_GROUP_TRENDY_SAYING, i);
    }
  }
  return c.EC_WORD_UNDEFINED;
}

/** GetRandomUnlockedTrendySaying (unused in FRLG) */
export function GetRandomUnlockedTrendySaying(state: GameState, rand: () => number = random): number {
  const c = EC();
  let id = GetNumUnlockedTrendySayings(state);
  if (id === 0) return c.EC_WORD_UNDEFINED;
  id = rand() % id;
  for (let i = 0; i < c.NUM_ADDITIONAL_PHRASES; i++) {
    if (!IsTrendySayingUnlocked(state, i)) continue;
    if (id) id--;
    else return EC_WORD(c.EC_GROUP_TRENDY_SAYING, i);
  }
  return c.EC_WORD_UNDEFINED;
}

/**
 * GetRandomECPokemon: a random species from the POKEMON_2 group's list that the player has seen. The roll is out of
 * the group's numEnabledWords (202), not of the seen ones, so it often finds none (EC_WORD_UNDEFINED).
 */
function GetRandomECPokemon(state: GameState, rand: () => number): number {
  const c = EC();
  let index = EasyChat_GetNumWordsInGroup(state, c.EC_GROUP_POKEMON_2);
  if (index === 0) return c.EC_WORD_UNDEFINED;
  index = rand() % index;
  const group = easyChatData().groups[c.EC_GROUP_POKEMON_2];
  for (let i = 0; i < group.numWords; i++) {
    const species = group.values![i];
    if (GetSetPokedexFlag(state, state.pokemon.nationalDex(species), FLAG_GET_SEEN)) {
      if (index) index--;
      else return EC_WORD(c.EC_GROUP_POKEMON_2, species);
    }
  }
  return c.EC_WORD_UNDEFINED;
}

// ------------------------------------------------------------------ the selection lists (the Easy Chat screen)

/** struct Unk203A120 (sEasyChatSelectionData): the groups and alphabetical lists the screen offers. */
interface EasyChatSelectionData {
  state: GameState;
  numGroups: number;
  groups: number[];
  /** the number of unlocked words per letter */
  alphabeticalGroups: number[];
  alphabeticalWordsByGroup: number[][];
  /** the words GetUnlockedECWords put on display */
  allWords: number[];
  totalWords: number;
}

let sEasyChatSelectionData: EasyChatSelectionData | null = null;

function sel(): EasyChatSelectionData {
  if (!sEasyChatSelectionData) throw new Error('[easy chat] no selection data (InitEasyChatSelection)');
  return sEasyChatSelectionData;
}

/** InitEasyChatSelection: the selectable groups and the unlocked words by letter, for `state`. */
export function InitEasyChatSelection(state: GameState): boolean {
  sEasyChatSelectionData = { state, numGroups: 0, groups: [], alphabeticalGroups: [], alphabeticalWordsByGroup: [], allWords: [], totalWords: 0 };
  PopulateECGroups();
  PopulateAlphabeticalGroups();
  return true;
}

/** DestroyEasyChatSelectionData */
export function DestroyEasyChatSelectionData(): void {
  sEasyChatSelectionData = null;
}

/**
 * PopulateECGroups: POKéMON (the 251 of the Kanto/Johto list) once any mon is seen, TRAINER to ADJECTIVES, EVENTS /
 * MOVE 1 / MOVE 2 after the Hall of Fame, POKéMON2 (the Hoenn list) with the National Dex. TRENDY SAYING never.
 */
function PopulateECGroups(): void {
  const d = sel();
  const c = EC();
  d.numGroups = 0;
  d.groups = [];
  const add = (g: number) => (d.groups[d.numGroups++] = g);
  if (GetNationalPokedexCount(d.state, FLAG_GET_SEEN)) add(c.EC_GROUP_POKEMON);
  for (let i = c.EC_GROUP_TRAINER; i <= c.EC_GROUP_ADJECTIVES; i++) add(i);
  if (d.state.getFlag('FLAG_SYS_GAME_CLEAR')) {
    add(c.EC_GROUP_EVENTS);
    add(c.EC_GROUP_MOVE_1);
    add(c.EC_GROUP_MOVE_2);
  }
  if (isNationalDexEnabled(d.state)) add(c.EC_GROUP_POKEMON_2);
}

/** GetNumDisplayableGroups */
export function GetNumDisplayableGroups(): number {
  return sel().numGroups;
}

/** GetSelectedGroupByIndex: EC_NUM_GROUPS past the end. */
export function GetSelectedGroupByIndex(index: number): number {
  const d = sel();
  return index >= d.numGroups ? EC().EC_NUM_GROUPS : d.groups[index];
}

/** GetEasyChatWordGroupName: the group's name (gEasyChatGroupName_*), encoded without EOS. */
export function GetEasyChatWordGroupName(state: GameState, groupId: number): number[] {
  return state.pokemon.encodeName(easyChatData().groupNames[groupId].text);
}

/** CopyEasyChatWordPadded: the word, padded with spaces to `totalChars` (without EOS). */
export function CopyEasyChatWordPadded(state: GameState, easyChatWord: number, totalChars: number): number[] {
  const str = CopyEasyChatWord(state, easyChatWord);
  while (str.length < totalChars) str.push(CHAR_SPACE);
  return str;
}

/**
 * PopulateAlphabeticalGroups: for each letter, the unlocked words in sEasyChatWordsByLetter's order. A species
 * name that is in both POKéMON groups (the `-1, 2` entries) is listed once, as the first of the two that is
 * unlocked.
 */
function PopulateAlphabeticalGroups(): void {
  const d = sel();
  const UNDEFINED = EC().EC_WORD_UNDEFINED;
  easyChatData().wordsByLetter.forEach(({ words, numWords }, i) => {
    const list: number[] = [];
    let w = 0;
    for (let j = 0; j < numWords; ) {
      let numToProcess: number;
      if (words[w] === UNDEFINED) {
        w++;
        numToProcess = words[w++];
        j += 2;
      } else {
        numToProcess = 1;
      }
      for (let k = 0; k < numToProcess; k++) {
        if (IsWordUnlocked(words[w + k])) {
          list.push(words[w + k]);
          break;
        }
      }
      w += numToProcess;
      j += numToProcess;
    }
    d.alphabeticalWordsByGroup[i] = list;
    d.alphabeticalGroups[i] = list.length;
  });
}

/** GetUnlockedECWords: put a group's unlocked words (or a letter's, in alphabetical mode) on display. */
export function GetUnlockedECWords(isAlphabetical: boolean, groupId: number): void {
  sel().totalWords = isAlphabetical ? GetUnlockedWordsInAlphabeticalGroup(groupId) : GetUnlockedWordsInECGroup(groupId);
}

/** GetDisplayedWordByIndex: EC_WORD_UNDEFINED past the end. */
export function GetDisplayedWordByIndex(index: number): number {
  const d = sel();
  return index >= d.totalWords ? EC().EC_WORD_UNDEFINED : d.allWords[index];
}

/** GetNumDisplayedWords */
export function GetNumDisplayedWords(): number {
  return sel().totalWords;
}

/**
 * GetUnlockedWordsInECGroup: a value-list group's unlocked ids in list order; another group's enabled words in
 * alphabetical order (its i-th word alphabetically is the word with index wordInfo[i].alphabeticalOrder).
 */
function GetUnlockedWordsInECGroup(groupId: number): number {
  const d = sel();
  const group = easyChatData().groups[groupId];
  let totalWords = 0;
  for (let i = 0; i < group.numWords; i++) {
    const index = isValueListGroup(groupId) ? group.values![i] : group.words![i].alphabeticalOrder;
    if (UnlockedECMonOrMove(index, groupId)) d.allWords[totalWords++] = EC_WORD(groupId, index);
  }
  return totalWords;
}

/** GetUnlockedWordsInAlphabeticalGroup */
function GetUnlockedWordsInAlphabeticalGroup(alphabeticalGroup: number): number {
  const d = sel();
  let totalWords = 0;
  for (let i = 0; i < d.alphabeticalGroups[alphabeticalGroup]; i++) d.allWords[totalWords++] = d.alphabeticalWordsByGroup[alphabeticalGroup][i];
  return totalWords;
}

/** IsGroupSelectable */
function IsGroupSelectable(groupId: number): boolean {
  const d = sel();
  for (let i = 0; i < d.numGroups; i++) if (d.groups[i] === groupId) return true;
  return false;
}

/** UnlockedECMonOrMove: POKéMON words need the mon seen (in POKéMON2 only Deoxys does); others their `enabled`. */
function UnlockedECMonOrMove(wordIndex: number, groupId: number): boolean {
  const { state } = sel();
  const c = EC();
  switch (groupId) {
    case c.EC_GROUP_POKEMON:
      return GetSetPokedexFlag(state, state.pokemon.nationalDex(wordIndex), FLAG_GET_SEEN);
    case c.EC_GROUP_POKEMON_2:
      if (EC_IsDeoxys(wordIndex)) return GetSetPokedexFlag(state, state.pokemon.nationalDex(wordIndex), FLAG_GET_SEEN);
      return true;
    case c.EC_GROUP_MOVE_1:
    case c.EC_GROUP_MOVE_2:
      return true;
    default:
      return easyChatData().groups[groupId].words![wordIndex].enabled;
  }
}

/** EC_IsDeoxys */
function EC_IsDeoxys(species: number): boolean {
  return easyChatData().deoxys.includes(species);
}

/** IsWordUnlocked: the word's group is on the screen and the word is unlocked in it. */
function IsWordUnlocked(easyChatWord: number): boolean {
  const groupId = EC_GROUP(easyChatWord);
  if (!IsGroupSelectable(groupId)) return false;
  return UnlockedECMonOrMove(EC_INDEX(easyChatWord), groupId);
}
