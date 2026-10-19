import { FONT_BRAILLE, type Fonts } from './Font';

/**
 * GetStringWidth (text.c) with a given font set (the field's or the GBA layer's). Latin glyphs don't add
 * letter spacing (only Japanese text does), so `letterSpacing` only matters after an {JPN} code.
 */
export function stringWidth(fonts: Fonts, fontId: number, str: number[], letterSpacing: number, stringVar: (n: number) => number[] = () => []): number {
  let font = fonts.get(fontId);
  let spacing = letterSpacing === -1 ? font.info.letterSpacing : letterSpacing;
  let isJapanese = false;
  let minGlyphWidth = 0;
  let width = 0;
  let lineWidth = 0;
  // (only a plain glyph checks the font: `fontId != FONT_BRAILLE && isJapanese`, the call's font, not a {FONT})
  const glyph = (c: number, plain = false) => {
    let w = font.width(c);
    if (minGlyphWidth > 0) w = Math.max(w, minGlyphWidth);
    else if (isJapanese && !(plain && fontId === FONT_BRAILLE)) w += spacing;
    lineWidth += w;
  };
  for (let i = 0; i < str.length && str[i] !== 0xff; i++) {
    const c = str[i];
    switch (c) {
      case 0xfe: // CHAR_NEWLINE
        if (lineWidth > width) width = lineWidth;
        lineWidth = 0;
        break;
      case 0xfd: {
        // PLACEHOLDER_BEGIN: STR_VAR_1..3 (ids 2..4)
        const id = str[++i];
        if (id < 2 || id > 4) return 0;
        for (const b of stringVar(id - 2)) {
          if (b === 0xff) break;
          glyph(b);
        }
        break;
      }
      case 0xfa: // CHAR_PROMPT_SCROLL
      case 0xfb: // CHAR_PROMPT_CLEAR
        break;
      case 0xf8: // CHAR_KEYPAD_ICON: GetKeypadIconWidth
      case 0xf9: {
        // CHAR_EXTRA_SYMBOL
        let w = c === 0xf9 ? font.width(str[++i] | 0x100) : (fonts.keypadIcons[str[++i]]?.[1] ?? 0);
        if (minGlyphWidth > 0) w = Math.max(w, minGlyphWidth);
        else if (isJapanese) w += spacing;
        lineWidth += w;
        break;
      }
      case 0xfc: // EXT_CTRL_CODE_BEGIN
        switch (str[++i]) {
          case 0x04: // COLOR_HIGHLIGHT_SHADOW
            i += 3;
            break;
          case 0x0b: // PLAY_BGM
          case 0x10: // PLAY_SE
            i += 2;
            break;
          case 0x01: // COLOR
          case 0x02: // HIGHLIGHT
          case 0x03: // SHADOW
          case 0x05: // PALETTE
          case 0x08: // PAUSE
          case 0x0c: // ESCAPE
          case 0x0d: // SHIFT_RIGHT
          case 0x0e: // SHIFT_DOWN
            i++;
            break;
          case 0x06: // FONT
            font = fonts.get(str[++i]);
            if (letterSpacing === -1) spacing = font.info.letterSpacing;
            break;
          case 0x11: // CLEAR
            lineWidth += str[++i];
            break;
          case 0x12: // SKIP
            lineWidth = str[++i];
            break;
          case 0x13: // CLEAR_TO
            if (str[++i] > lineWidth) lineWidth = str[i];
            break;
          case 0x14: // MIN_LETTER_SPACING
            minGlyphWidth = str[++i];
            break;
          case 0x15: // JPN
            isJapanese = true;
            break;
          case 0x16: // ENG
            isJapanese = false;
            break;
        }
        break;
      default:
        glyph(c, true);
    }
  }
  return lineWidth > width ? lineWidth : width;
}
