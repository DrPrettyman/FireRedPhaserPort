import { afterEach, describe, expect, test, vi } from 'vitest';
import { ScriptEngine, type ScriptsData } from '../../src/script/ScriptEngine';
import { brailleCursorProbe, SpriteCB_TextCursor, type FieldTextCursor } from '../../src/script/postgameSpecials';
import { Font, FONT_BRAILLE, FONT_NORMAL, type FontInfoData, type Fonts, type FontsData } from '../../src/text/Font';
import { stringWidth } from '../../src/text/stringWidth';
import { newGame, readGen } from './gameData';

// FONT_BRAILLE (braille_text.c, new_menu_helpers.c gFontInfos), the braille strings (tools/preproc's ReadBraille),
// ScrCmd_braillemessage / ScrCmd_getbraillestringwidth (scrcmd.c) and BrailleCursorToggle (field_specials.c).

const fontsData = readGen<FontsData>('text/fonts.json');
const strings = readGen<Record<string, string>>('text/strings.json');
const scripts = readGen<ScriptsData>('scripts/scripts.json');

/** The extracted fonts without their glyph sheets (widths only: no canvas in Node). */
function fontsStub(): Fonts {
  const fonts = new Map<number, Font>();
  for (const [id, info] of Object.entries(fontsData.fonts)) {
    fonts.set(Number(id), Object.assign(Object.create(Font.prototype) as Font, { id: Number(id), info }));
  }
  return { get: (id: number) => fonts.get(id) ?? fonts.get(FONT_NORMAL)!, keypadIcons: fontsData.keypadIcons, windowPalette: fontsData.windowPalette } as unknown as Fonts;
}

describe('FONT_BRAILLE', () => {
  test("gFontInfos[FONT_BRAILLE]: 8 wide (the cursor's), 16 high, line spacing 2, dark gray on white; every glyph 16 px", () => {
    const info = fontsData.fonts[FONT_BRAILLE] as FontInfoData;
    expect(info).toMatchObject({ image: 'braille', maxLetterWidth: 8, maxLetterHeight: 16, letterSpacing: 0, lineSpacing: 2, fgColor: 2, bgColor: 1, shadowColor: 3 });
    const font = fontsStub().get(FONT_BRAILLE);
    for (const c of [0x00, 0x01, 0x3b, 0xff, 0x1ff]) expect(font.width(c)).toBe(16); // GetGlyphWidth_Braille
  });

  test('the braille strings are encoded as preproc does (BRAILLE_CHAR_* from include/characters.h)', () => {
    const { charmap } = newGame();
    // A 0x01, B 0x05, C 0x03; '$' is EOS
    expect(charmap.encode(strings.Braille_Text_ABC)).toEqual([0x01, 0x05, 0x03, 0xff]);
    // "USE POWER.": U 0x31, S 0x16, E 0x09, space 0x00, P 0x17, O 0x19, W 0x2E, E, R 0x1D, '.' 0x2C
    expect(charmap.encode(strings.Braille_Text_UsePower)).toEqual([0x31, 0x16, 0x09, 0x00, 0x17, 0x19, 0x2e, 0x09, 0x1d, 0x2c, 0xff]);
    expect(charmap.encode(strings.Braille_Text_Comma)).toEqual([0x04, 0xff]);
  });

  test('GetStringWidth(FONT_BRAILLE, ...): 16 px a cell, the longest line', () => {
    const { charmap } = newGame();
    const fonts = fontsStub();
    expect(stringWidth(fonts, FONT_BRAILLE, charmap.encode(strings.Braille_Text_Everything), -1)).toBe(10 * 16);
    expect(stringWidth(fonts, FONT_BRAILLE, charmap.encode(strings.Braille_Text_HasMeaning1), -1)).toBe(11 * 16);
    expect(stringWidth(fonts, FONT_BRAILLE, [0x01, 0x05, 0xfe, 0x01, 0xff], -1)).toBe(32);
    // `fontId != FONT_BRAILLE && isJapanese`: no letter spacing after {JPN} in braille (the font has none anyway)
    expect(stringWidth(fonts, FONT_BRAILLE, [0xfc, 0x15, 0x01, 0x05, 0xff], 3)).toBe(32);
    expect(stringWidth(fonts, FONT_NORMAL, [0xfc, 0x15, 0xbb, 0xff], 3)).toBe(fonts.get(FONT_NORMAL).width(0xbb) + 3);
  });
});

describe('the braille script commands and BrailleCursorToggle', () => {
  afterEach(() => vi.restoreAllMocks());

  function engine(code: string[][]) {
    const game = newGame();
    const data = { ...scripts, code, labels: { Test: 0 } };
    const show = vi.fn();
    const messageBox = { show, fonts: fontsStub(), isPrinting: false };
    const tasks: { tick(): boolean }[] = [];
    const host = { startFieldTask: (t: { tick(): boolean }) => tasks.push(t), listMenuHost: () => undefined };
    const eng = new ScriptEngine(data as unknown as ScriptsData, game.defines, game.state, strings, game.charmap, messageBox as never, {} as never, host as never);
    return { eng, state: game.state, show, tasks, game };
  }

  test('braillemessage prints at once in FONT_BRAILLE in the dialogue frame; getbraillestringwidth sets VAR_0x8004', () => {
    const { eng, state, show, game } = engine([
      ['braillemessage', 'Braille_Text_Everything'],
      ['getbraillestringwidth', 'Braille_Text_Everything'],
      ['end'],
    ]);
    eng.start('Test');
    eng.tick();
    expect(eng.running).toBe(false);
    // show(bytes, color, signpost, instant, font): LoadStdWindowFrameGfx (not the signpost frame), speed 0
    expect(show).toHaveBeenCalledWith(game.charmap.encode(strings.Braille_Text_Everything), 'neutral', false, true, FONT_BRAILLE);
    expect(state.getVar('VAR_0x8004')).toBe(160);
  });

  test("braillemessage_wait's cursor: (VAR_0x8004 + 27 + 3, VAR_0x8005 + 4), bobbing, gone on VAR_0x8006 1", () => {
    // MtEmber_RubyPath_B5F_EventScript_BrailleMessage's first braillemessage_wait, up to the waitbuttonpress
    const { eng, tasks } = engine([
      ['setvar', 'VAR_0x8005', '130'],
      ['setvar', 'VAR_0x8006', '0'],
      ['braillemessage', 'Braille_Text_Everything'],
      ['getbraillestringwidth', 'Braille_Text_Everything'],
      ['special', 'BrailleCursorToggle'],
      ['end'],
    ]);
    eng.start('Test');
    eng.tick();
    expect(brailleCursorProbe()).toEqual({ x: 160 + 27 + 3, y: 134, y2: 0 });
    expect(tasks.length).toBe(1);
    // SpriteCB_TextCursor once a frame: sDelay starts at CURSOR_DELAY (8)
    const y2s: number[] = [];
    for (let i = 0; i < 45; i++) {
      tasks[0].tick();
      y2s.push(brailleCursorProbe()!.y2);
    }
    // the 9th frame takes state 0 (y2 0), then a step every 9 frames: 1, 2, 1, 0
    expect(y2s.slice(0, 17)).toEqual(Array(17).fill(0));
    expect(y2s.slice(17, 26)).toEqual(Array(9).fill(1));
    expect(y2s.slice(26, 35)).toEqual(Array(9).fill(2));
    expect(y2s.slice(35, 44)).toEqual(Array(9).fill(1));
    expect(y2s[44]).toBe(0);

    const off = engine([['setvar', 'VAR_0x8006', '1'], ['special', 'BrailleCursorToggle'], ['end']]);
    off.eng.start('Test');
    off.eng.tick();
    expect(brailleCursorProbe()).toBeUndefined();
    expect(tasks[0].tick()).toBe(true); // the sprite is gone, its callback with it
  });

  test('SpriteCB_TextCursor (text.c): 0, 1, 2, 1, then 0 again', () => {
    const s: FieldTextCursor = { x: 0, y: 0, y2: 0, sDelay: 0, sState: 0, destroyed: false };
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      SpriteCB_TextCursor(s);
      seen.push(s.y2);
      s.sDelay = 0;
    }
    expect(seen).toEqual([0, 1, 2, 1, 0]);
  });
});
