/** Resolves decomp constant names (FLAG_*, VAR_*, MSGBOX_*, ITEM_*, ...) to numbers. */
export class Defines {
  constructor(private table: Record<string, number>) {
    this.table = { TRUE: 1, FALSE: 0, ...table };
  }

  /** Number for a name or numeric literal; undefined if unknown. */
  get(token: string | number): number | undefined {
    if (typeof token === 'number') return token;
    const t = token.trim();
    if (/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) return Number(t);
    return this.table[t] ?? this.expression(t);
  }

  /**
   * A constant expression GAS would fold, e.g. the nurse's `multichoice ..., FALSE | (TRUE << 1)` or
   * `(MAX_COINS + 1) - 20`: names and numbers with + - * / % << >> & | ^ ~ and parentheses.
   */
  private expression(t: string): number | undefined {
    if (!/[-+*/%<>&|^~()]/.test(t)) return undefined;
    let unknown = false;
    const expr = t.replace(/\b(0x[0-9a-f]+|\d+|[A-Za-z_]\w*)\b/gi, (tok) => {
      const v = /^(0x[0-9a-f]+|\d+)$/i.test(tok) ? Number(tok) : this.table[tok];
      if (v === undefined) unknown = true;
      return String(v);
    });
    if (unknown || !/^[\d\s+\-*/%<>&|^~()]+$/.test(expr)) return undefined;
    const v = new Function(`return (${expr});`)() as unknown;
    return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
  }

  require(token: string | number): number {
    const v = this.get(token);
    if (v === undefined) throw new Error(`Unknown constant ${token}`);
    return v;
  }
}

// include/constants/vars.h & flags.h
export const VARS_START = 0x4000;
export const TEMP_VARS_START = 0x4000;
export const TEMP_VARS_END = 0x400f;
export const SPECIAL_VARS_START = 0x8000;
