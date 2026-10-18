// easy_chat.c (menus/easyChat.ts, menus/easyChatData.ts) against cases worked by hand from the C and the word
// tables in src/data/easy_chat/.

import { beforeEach, describe, expect, test } from 'vitest';
import {
  BufferRandomHobbyOrLifestyleString,
  ConvertEasyChatWordsToString,
  CopyEasyChatWord,
  CopyEasyChatWordPadded,
  EC_DoesEasyChatStringFitOnLine,
  EasyChatMessageText,
  EasyChat_GetNumWordsInGroup,
  EnableRareWord,
  GetDisplayedWordByIndex,
  GetEasyChatWordGroupName,
  GetNumDisplayableGroups,
  GetNumDisplayedWords,
  GetNumUnlockedTrendySayings,
  GetRandomUnlockedTrendySaying,
  GetSelectedGroupByIndex,
  GetUnlockedECWords,
  InitEasyChatSelection,
  IsECGroupUnlocked,
  IsECWordInvalid,
  IsTrendySayingUnlocked,
  UnlockRandomTrendySaying,
} from '../../src/menus/easyChat';
import { EC_WORD, easyChatData } from '../../src/menus/easyChatData';
import { SPECIALS, type SpecialEnv } from '../../src/script/specials';
import { newGame, type TestGame } from './gameData';

let t: TestGame;
const UNDEF = 0xffff;
const EOS = 0xff;
const NEWLINE = 0xfe;

beforeEach(() => {
  t = newGame();
});

/** Encoded text, as the decomp writes it, without EOS. */
const enc = (s: string) => t.charmap.encodePlain(s);
/** Lines joined by CHAR_NEWLINE, with EOS. */
const lines = (...ls: string[]) => [...ls.flatMap((l, i) => (i ? [NEWLINE, ...enc(l)] : enc(l))), EOS];
const w = (name: string) => t.d(name);
const species = (name: string) => t.d(`SPECIES_${name}`);
/** A sequence of Random() results. */
const rolls = (...values: number[]) => () => {
  const v = values.shift();
  if (v === undefined) throw new Error('out of rolls');
  return v;
};
const seeDex = (...names: string[]) => names.forEach((n) => t.state.setDexFlags(t.pokemon.nationalDex(species(n)), true, false));
const enableNationalDex = () => {
  t.state.nationalDexEnabled = true;
  t.state.setVar('VAR_NATIONAL_DEX', 0x6258);
  t.state.setFlag('FLAG_SYS_NATIONAL_DEX');
};

describe('easyChat.json (src/data/easy_chat)', () => {
  test('the groups, by EC_GROUP_*', () => {
    const { groups } = easyChatData();
    expect(groups).toHaveLength(22);
    // EC_GROUP_POKEMON_2 (0) holds sEasyChatGroup_Pokemon, the 202 of the Hoenn list; EC_GROUP_POKEMON (21) sEasyChatGroup_Pokemon2, 251
    expect(groups[w('EC_GROUP_POKEMON_2')]).toMatchObject({ numWords: 202, numEnabledWords: 202 });
    expect(groups[w('EC_GROUP_POKEMON_2')].values![0]).toBe(species('ABRA'));
    expect(groups[w('EC_GROUP_POKEMON')]).toMatchObject({ numWords: 251, numEnabledWords: 251 });
    expect(groups[w('EC_GROUP_TRAINER')]).toMatchObject({ numWords: 26, numEnabledWords: 25 });
    expect(groups[w('EC_GROUP_TRAINER')].words![0]).toEqual({ text: 'I CHOOSE YOU', alphabeticalOrder: 21, enabled: true });
    expect(groups[w('EC_GROUP_TRENDY_SAYING')]).toMatchObject({ numWords: 33, numEnabledWords: 0 });
    expect(groups[w('EC_GROUP_MOVE_1')].values![0]).toBe(w('MOVE_ABSORB'));
  });

  test('the words by letter keep the doubled-species markers', () => {
    const { wordsByLetter } = easyChatData();
    expect(wordsByLetter).toHaveLength(27);
    expect(wordsByLetter[0].words).toEqual(
      ['EXCL', 'EXCL_EXCL', 'DASH', 'DASH_DASH_DASH', 'ELLIPSIS', 'ELLIPSIS_EXCL', 'ELLIPSIS_ELLIPSIS_ELLIPSIS', '1_HIT_KO_EXCL', 'QUES', 'QUES_EXCL'].map((n) => w(`EC_WORD_${n}`)),
    );
    // A: ..., EC_WORD_ABOVE, -1, 2, EC_POKEMON2(ABRA), EC_POKEMON(ABRA), EC_WORD_ABSENT
    const a = wordsByLetter[1].words;
    const i = a.indexOf(w('EC_WORD_ABOVE'));
    expect(a.slice(i + 1, i + 6)).toEqual([UNDEF, 2, EC_WORD(w('EC_GROUP_POKEMON_2'), species('ABRA')), EC_WORD(w('EC_GROUP_POKEMON'), species('ABRA')), w('EC_WORD_ABSENT')]);
    expect(wordsByLetter[1].numWords).toBe(a.length);
  });
});

describe('new game (InitEasyChatPhrases, InitQuestionnaireWords)', () => {
  test('the default profile and battle start, nothing else', () => {
    const s = t.state;
    expect(s.easyChatProfile).toEqual([...['EC_WORD_I_AM', 'EC_WORD_A', 'EC_WORD_POKEMON', 'EC_WORD_FRIEND'].map(w), 0, 0]);
    expect(s.easyChatBattleStart).toEqual(['ARE', 'YOU', 'READY', 'QUES', 'HERE_I_COME', 'EXCL'].map((n) => w(`EC_WORD_${n}`)));
    expect(s.easyChatBattleWon).toEqual(new Array(6).fill(UNDEF));
    expect(s.easyChatBattleLost).toEqual(new Array(6).fill(UNDEF));
    expect(s.questionnaireWords).toEqual(new Array(4).fill(UNDEF));
    expect(s.additionalPhrases).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('words (CopyEasyChatWord, IsECWordInvalid)', () => {
  test('text by group: word lists, species and move names', () => {
    expect(CopyEasyChatWord(t.state, w('EC_WORD_I_AM'))).toEqual(enc('I AM'));
    expect(CopyEasyChatWord(t.state, w('EC_WORD_POKEMON'))).toEqual(enc('POKéMON'));
    expect(CopyEasyChatWord(t.state, EC_WORD(w('EC_GROUP_POKEMON'), species('BULBASAUR')))).toEqual(enc('BULBASAUR'));
    expect(CopyEasyChatWord(t.state, EC_WORD(w('EC_GROUP_POKEMON_2'), species('PIKACHU')))).toEqual(enc('PIKACHU'));
    expect(CopyEasyChatWord(t.state, EC_WORD(w('EC_GROUP_MOVE_1'), w('MOVE_ABSORB')))).toEqual(enc('ABSORB'));
    expect(CopyEasyChatWord(t.state, UNDEF)).toEqual([]);
  });

  test('invalid words read "???"', () => {
    const trainer = w('EC_GROUP_TRAINER');
    expect(IsECWordInvalid(UNDEF)).toBe(false);
    expect(IsECWordInvalid(EC_WORD(trainer, 25))).toBe(false);
    expect(IsECWordInvalid(EC_WORD(trainer, 26))).toBe(true); // numWords = 26
    expect(IsECWordInvalid(EC_WORD(22, 0))).toBe(true); // >= EC_NUM_GROUPS
    // Bulbasaur isn't on the Hoenn list; Acid is a MOVE 2 word, not MOVE 1
    expect(IsECWordInvalid(EC_WORD(w('EC_GROUP_POKEMON_2'), species('BULBASAUR')))).toBe(true);
    expect(IsECWordInvalid(EC_WORD(w('EC_GROUP_MOVE_1'), w('MOVE_ACID')))).toBe(true);
    expect(IsECWordInvalid(EC_WORD(w('EC_GROUP_MOVE_2'), w('MOVE_ACID')))).toBe(false);
    expect(CopyEasyChatWord(t.state, EC_WORD(trainer, 26))).toEqual(enc('???'));
  });

  test('CopyEasyChatWordPadded and the group names', () => {
    expect(CopyEasyChatWordPadded(t.state, w('EC_WORD_I_AM'), 7)).toEqual(enc('I AM   '));
    expect(GetEasyChatWordGroupName(t.state, w('EC_GROUP_POKEMON'))).toEqual(enc('POKéMON'));
    expect(GetEasyChatWordGroupName(t.state, w('EC_GROUP_POKEMON_2'))).toEqual(enc('POKéMON2'));
    expect(GetEasyChatWordGroupName(t.state, w('EC_GROUP_MISC'))).toEqual(enc('MISC.'));
  });
});

describe('messages (ConvertEasyChatWordsToString, EC_DoesEasyChatStringFitOnLine, ShowEasyChatMessage)', () => {
  test('the new-game profile, 2x2', () => {
    expect(ConvertEasyChatWordsToString(t.state, t.state.easyChatProfile, 2, 2)).toEqual(lines('I AM A', 'POKéMON FRIEND'));
  });

  test('an empty word adds no space, but the word before it keeps its own', () => {
    const words = [w('EC_WORD_HELLO'), UNDEF, UNDEF, w('EC_WORD_EXCL')];
    // row 1: "HELLO" + " " + "" ; row 2: "" + "!"
    expect(ConvertEasyChatWordsToString(t.state, words, 2, 2)).toEqual(lines('HELLO ', '!'));
  });

  test('the battle start: 3x2 when each row of 3 fits in 18 characters, else 2x3', () => {
    const s = t.state;
    // ARE YOU READY = 3+3+5+2 = 13; ? HERE I COME ! = 1+11+1+2 = 15
    expect(EC_DoesEasyChatStringFitOnLine(s, s.easyChatBattleStart, 3, 2, 18)).toBe(false);
    expect(EasyChatMessageText(s, 1)).toEqual(lines('ARE YOU READY', '? HERE I COME !'));
    // HERE I COME x3 = 33+2 = 35 > 18
    s.easyChatBattleStart = new Array(6).fill(w('EC_WORD_HERE_I_COME'));
    expect(EC_DoesEasyChatStringFitOnLine(s, s.easyChatBattleStart, 3, 2, 18)).toBe(true);
    expect(EasyChatMessageText(s, 1)).toEqual(lines('HERE I COME HERE I COME', 'HERE I COME HERE I COME', 'HERE I COME HERE I COME'));
    // I CHOOSE YOU YES ! = 12+3+1+2 = 18 fits; with !! it's 19
    expect(EC_DoesEasyChatStringFitOnLine(s, [w('EC_WORD_I_CHOOSE_YOU'), w('EC_WORD_YES'), w('EC_WORD_EXCL')], 3, 1, 18)).toBe(false);
    expect(EC_DoesEasyChatStringFitOnLine(s, [w('EC_WORD_I_CHOOSE_YOU'), w('EC_WORD_YES'), w('EC_WORD_EXCL_EXCL')], 3, 1, 18)).toBe(true);
  });

  test('won / lost are 3x2; another VAR_0x8004 shows nothing', () => {
    t.state.easyChatBattleLost = [w('EC_WORD_SORRY'), UNDEF, UNDEF, UNDEF, UNDEF, w('EC_WORD_EXCL')];
    expect(EasyChatMessageText(t.state, 3)).toEqual(lines('SORRY ', '!'));
    expect(EasyChatMessageText(t.state, 4)).toBeUndefined();
  });

  test('special ShowEasyChatMessage shows the profile in the field message box', () => {
    let shown: string | number[] | undefined;
    const env = { state: t.state, showFieldMessage: (s: string | number[]) => ((shown = s), () => true) } as unknown as SpecialEnv;
    t.state.setVar('VAR_0x8004', 0);
    SPECIALS.ShowEasyChatMessage(env);
    expect(shown).toEqual(lines('I AM A', 'POKéMON FRIEND'));
    shown = undefined;
    t.state.setVar('VAR_0x8004', 7);
    SPECIALS.ShowEasyChatMessage(env);
    expect(shown).toBeUndefined();
  });
});

describe('random words', () => {
  test('BufferRandomHobbyOrLifestyleString: odd roll = HOBBIES, then Random() % numWords', () => {
    BufferRandomHobbyOrLifestyleString(t.state, rolls(1, 54 + 3)); // HOBBIES has 54 words: index 3
    expect(t.state.stringVars[1]).toEqual(enc('MOVIE')); // IDOL, ANIME, SONG, MOVIE
    BufferRandomHobbyOrLifestyleString(t.state, rolls(2, 45 + 1)); // LIFESTYLE has 45 words: index 1
    expect(t.state.stringVars[1]).toEqual(enc('HOME')); // CHORES, HOME
  });
});

describe('trendy sayings (additionalPhrases)', () => {
  test('EnableRareWord sets one bit; ids from 33 on are ignored', () => {
    EnableRareWord(t.state, 9);
    expect(t.state.additionalPhrases).toEqual([0, 2, 0, 0, 0]);
    EnableRareWord(t.state, 32);
    EnableRareWord(t.state, 33);
    expect(t.state.additionalPhrases).toEqual([0, 2, 0, 0, 1]);
    expect(IsTrendySayingUnlocked(t.state, 9)).toBe(true);
    expect(IsTrendySayingUnlocked(t.state, 8)).toBe(false);
    expect(GetNumUnlockedTrendySayings(t.state)).toBe(2);
  });

  test('UnlockRandomTrendySaying counts through the locked ones; GetRandomUnlockedTrendySaying through the unlocked', () => {
    EnableRareWord(t.state, 9);
    // 1 unlocked: 5 % 32 = 5 → the 6th locked one, 5
    expect(UnlockRandomTrendySaying(t.state, rolls(5))).toBe(w('EC_WORD_YEEHAW_EXCL'));
    // {5, 9}: 9 % 31 = 9 → skips the 9 locked ones 0-4, 6-8 and 10, unlocks 11
    expect(UnlockRandomTrendySaying(t.state, rolls(9))).toBe(w('EC_WORD_FLATTEN')); // saying 11
    expect(IsTrendySayingUnlocked(t.state, 11)).toBe(true);
    // {5, 9, 11}: 4 % 3 = 1 → the second, 9
    expect(GetRandomUnlockedTrendySaying(t.state, rolls(4))).toBe(w('EC_WORD_CANCEL'));
    for (let i = 0; i < 33; i++) EnableRareWord(t.state, i);
    expect(UnlockRandomTrendySaying(t.state, rolls())).toBe(UNDEF);
  });

  test('the TRENDY SAYING group is never unlocked in FRLG', () => {
    for (let i = 0; i < 33; i++) EnableRareWord(t.state, i);
    expect(IsECGroupUnlocked(t.state, w('EC_GROUP_TRENDY_SAYING'))).toBe(false);
    expect(EasyChat_GetNumWordsInGroup(t.state, w('EC_GROUP_TRENDY_SAYING'))).toBe(0);
  });
});

describe('the selection lists (InitEasyChatSelection)', () => {
  const groups = () => Array.from({ length: GetNumDisplayableGroups() }, (_, i) => GetSelectedGroupByIndex(i));
  const displayed = () => Array.from({ length: GetNumDisplayedWords() }, (_, i) => GetDisplayedWordByIndex(i));

  test('groups: POKéMON once one is seen, EVENTS / MOVE 1 / MOVE 2 after the Hall of Fame, POKéMON2 with the National Dex', () => {
    const middle = Array.from({ length: 16 }, (_, i) => i + 1); // TRAINER (1) .. ADJECTIVES (16)
    InitEasyChatSelection(t.state);
    expect(groups()).toEqual(middle);
    expect(GetSelectedGroupByIndex(16)).toBe(w('EC_NUM_GROUPS'));
    seeDex('BULBASAUR');
    t.state.setFlag('FLAG_SYS_GAME_CLEAR');
    enableNationalDex();
    InitEasyChatSelection(t.state);
    expect(groups()).toEqual([w('EC_GROUP_POKEMON'), ...middle, ...['EVENTS', 'MOVE_1', 'MOVE_2', 'POKEMON_2'].map((g) => w(`EC_GROUP_${g}`))]);
  });

  test('a word group lists its enabled words alphabetically (TRAINER without POKéNAV)', () => {
    InitEasyChatSelection(t.state);
    GetUnlockedECWords(false, w('EC_GROUP_TRAINER'));
    const texts = displayed().map((word) => CopyEasyChatWord(t.state, word));
    const expected = ['BAG', 'CENTER', 'EGG', 'ENCYCLOPEDIA', 'EVOLVE', 'FLAME', 'GET', 'GOLD', 'GOTCHA', 'GREEN', 'I CHOOSE YOU', 'LEAF', 'LEVEL', 'LINK',
      'NATURE', 'POKéDEX', 'POKéMON', 'RED', 'RUBY', 'SAPPHIRE', 'SILVER', 'SP. ABILITY', 'TRADE', 'TRAINER', 'VERSION'];
    expect(texts).toEqual(expected.map(enc));
    expect(GetDisplayedWordByIndex(25)).toBe(UNDEF);
  });

  test('the POKéMON group lists the seen species in its list order', () => {
    seeDex('PIKACHU', 'BULBASAUR');
    InitEasyChatSelection(t.state);
    GetUnlockedECWords(false, w('EC_GROUP_POKEMON'));
    expect(displayed()).toEqual([EC_WORD(w('EC_GROUP_POKEMON'), species('BULBASAUR')), EC_WORD(w('EC_GROUP_POKEMON'), species('PIKACHU'))]);
    expect(EasyChat_GetNumWordsInGroup(t.state, w('EC_GROUP_POKEMON'))).toBe(2);
  });

  test('POKéMON2 has every species but an unseen Deoxys', () => {
    enableNationalDex();
    InitEasyChatSelection(t.state);
    GetUnlockedECWords(false, w('EC_GROUP_POKEMON_2'));
    const all = easyChatData().groups[w('EC_GROUP_POKEMON_2')].values!;
    expect(all).toContain(species('DEOXYS'));
    expect(GetNumDisplayedWords()).toBe(all.length - 1);
    seeDex('DEOXYS');
    InitEasyChatSelection(t.state);
    GetUnlockedECWords(false, w('EC_GROUP_POKEMON_2'));
    expect(GetNumDisplayedWords()).toBe(all.length);
  });

  test('alphabetical: "others" without the trendy 1-HIT KO!', () => {
    InitEasyChatSelection(t.state);
    GetUnlockedECWords(true, 0);
    expect(displayed()).toEqual(['EXCL', 'EXCL_EXCL', 'DASH', 'DASH_DASH_DASH', 'ELLIPSIS', 'ELLIPSIS_EXCL', 'ELLIPSIS_ELLIPSIS_ELLIPSIS', 'QUES', 'QUES_EXCL'].map((n) => w(`EC_WORD_${n}`)));
  });

  test('alphabetical: a species in both POKéMON groups is listed once, from the first unlocked group', () => {
    const pokemon = EC_WORD(w('EC_GROUP_POKEMON'), species('ABRA'));
    const pokemon2 = EC_WORD(w('EC_GROUP_POKEMON_2'), species('ABRA'));
    const letterA = () => {
      InitEasyChatSelection(t.state);
      GetUnlockedECWords(true, 1);
      return displayed();
    };
    let a = letterA();
    expect(a).not.toContain(pokemon);
    expect(a).not.toContain(pokemon2);
    expect(a).not.toContain(EC_WORD(w('EC_GROUP_MOVE_1'), w('MOVE_ABSORB'))); // no MOVE groups before the Hall of Fame
    expect(a.slice(a.indexOf(w('EC_WORD_ABOVE')), a.indexOf(w('EC_WORD_ABOVE')) + 2)).toEqual([w('EC_WORD_ABOVE'), w('EC_WORD_ABSENT')]);
    seeDex('ABRA');
    a = letterA();
    expect(a.filter((x) => x === pokemon || x === pokemon2)).toEqual([pokemon]);
    enableNationalDex();
    a = letterA();
    expect(a.filter((x) => x === pokemon || x === pokemon2)).toEqual([pokemon2]); // EC_POKEMON2(ABRA) comes first
  });
});
