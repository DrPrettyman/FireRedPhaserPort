// Encodes decomp string literals into GBA bytes exactly as tools/preproc does, using charmap.txt.

export const EOS = 0xff;
export const CHAR_PROMPT_SCROLL = 0xfa; // \l
export const CHAR_PROMPT_CLEAR = 0xfb; // \p
export const EXT_CTRL_CODE_BEGIN = 0xfc;
export const PLACEHOLDER_BEGIN = 0xfd;
export const CHAR_NEWLINE = 0xfe;

export interface CharmapData {
  chars: Record<string, number[]>;
  names: Record<string, number[]>;
}

export class Charmap {
  private maxCharLen: number;

  constructor(private data: CharmapData) {
    this.maxCharLen = Math.max(...Object.keys(data.chars).map((k) => k.length));
  }

  /** Encode a raw `.string` literal (escapes and {BRACES} intact). Always terminated with EOS. */
  encode(raw: string): number[] {
    const out: number[] = [];
    let i = 0;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '{') {
        const end = raw.indexOf('}', i);
        if (end < 0) throw new Error(`Unterminated brace in "${raw}"`);
        for (const tok of raw.slice(i + 1, end).trim().split(/\s+/)) out.push(...this.encodeToken(tok));
        i = end + 1;
        continue;
      }
      // Longest match first so escapes like "\p" or multi-char entries win over single chars.
      let matched = false;
      for (let len = Math.min(this.maxCharLen, raw.length - i); len > 0; len--) {
        const bytes = this.data.chars[raw.slice(i, i + len)];
        if (bytes) {
          out.push(...bytes);
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        console.warn(`[charmap] no mapping for "${ch}" in "${raw}"`);
        i++;
      }
    }
    if (out[out.length - 1] !== EOS) out.push(EOS);
    return out;
  }

  /** Encode plain runtime text (e.g. a player name); same rules as encode(). */
  encodePlain(s: string): number[] {
    return this.encode(s).slice(0, -1);
  }

  private decodeTable?: Map<number, string>;

  /**
   * Plain runtime text back from bytes (up to EOS): the inverse of encodePlain for single-byte characters (e.g. a
   * name from the naming screen). Each byte becomes the shortest charmap entry that encodes to it.
   */
  decodePlain(bytes: ArrayLike<number>): string {
    if (!this.decodeTable) {
      this.decodeTable = new Map();
      for (const [ch, b] of Object.entries(this.data.chars)) {
        if (b.length !== 1) continue;
        const prev = this.decodeTable.get(b[0]);
        if (prev === undefined || ch.length < prev.length) this.decodeTable.set(b[0], ch);
      }
    }
    let out = '';
    for (let i = 0; i < bytes.length && bytes[i] !== EOS; i++) out += this.decodeTable.get(bytes[i]) ?? '';
    return out;
  }

  private encodeToken(tok: string): number[] {
    const named = this.data.names[tok];
    if (named) return named;
    const n = Number(tok);
    if (Number.isInteger(n)) return [n & 0xff];
    console.warn(`[charmap] unknown brace token {${tok}}`);
    return [];
  }
}
