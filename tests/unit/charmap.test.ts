import { beforeAll, describe, expect, test } from 'vitest';
import { CHAR_NEWLINE, CHAR_PROMPT_CLEAR, CHAR_PROMPT_SCROLL, EOS, PLACEHOLDER_BEGIN } from '../../src/text/charmap';
import { newGame, type TestGame } from './gameData';

let t: TestGame;

beforeAll(() => {
  t = newGame();
});

// Byte values from charmap.txt (the Gen III western character set).
describe('Charmap.encode (as tools/preproc)', () => {
  test('letters, digits and spaces', () => {
    expect(t.charmap.encode('Az 09')).toEqual([0xbb, 0xee, 0x00, 0xa1, 0xaa, EOS]);
  });

  test('always ends with exactly one EOS', () => {
    expect(t.charmap.encode('HI$')).toEqual([0xc2, 0xc3, EOS]);
    expect(t.charmap.encode('')).toEqual([EOS]);
  });

  test('escapes', () => {
    expect(t.charmap.encode('A\\nB\\lC\\pD')).toEqual([0xbb, CHAR_NEWLINE, 0xbc, CHAR_PROMPT_SCROLL, 0xbd, CHAR_PROMPT_CLEAR, 0xbe, EOS]);
  });

  test('brace names and numbers', () => {
    expect(t.charmap.encode('{PLAYER}')).toEqual([PLACEHOLDER_BEGIN, 0x01, EOS]);
    expect(t.charmap.encode('{0x42}{7}')).toEqual([0x42, 0x07, EOS]);
  });

  test('multi-character entries win over single characters', () => {
    expect(t.charmap.encode('POKé')).toEqual([0xca, 0xc9, 0xc5, 0x1b, EOS]);
  });

  test('encodePlain drops the terminator', () => {
    expect(t.charmap.encodePlain('RED')).toEqual([0xcc, 0xbf, 0xbe]);
  });
});

describe('Charmap.decodePlain (names from the naming screen back to text)', () => {
  test('bytes from charmap.txt decode to their characters, up to EOS', () => {
    expect(t.charmap.decodePlain([0xbb, 0xee, 0x00, 0xa1, 0xaa, EOS, 0xbb])).toBe('Az 09');
  });

  test('round-trips every character the naming screen can enter', () => {
    const name = 'Ab9 .-!?♂♀/,é';
    expect(t.charmap.decodePlain(t.charmap.encode(name))).toBe(name);
    for (const s of ['RED', 'GREEN', 'Gary', 'A.B-C']) expect(t.charmap.encodePlain(t.charmap.decodePlain(t.charmap.encode(s)))).toEqual(t.charmap.encodePlain(s));
  });
});
