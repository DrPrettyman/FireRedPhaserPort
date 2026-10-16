// tilemap_util.c: the three tilemaps the Pokémon Storage System pans around on BG1 (the "PKMN DATA" header,
// the party box and the CLOSE BOX button). Each holds several states stacked in one tilemap; a rectangle
// picks which part is copied into the BG's tilemap buffer. The unused saved-tilemap path isn't ported.

import { BG_ATTR_BGTYPE, BG_ATTR_SCREENSIZE, CopyToBgTilemapBufferRect, GetBgAttribute } from '../gba/bg';

interface RectData {
  x: number;
  y: number;
  width: number;
  height: number;
  destX: number;
  destY: number;
}

interface TilemapUtil {
  cur: RectData;
  tilemap: ArrayLike<number>;
  width: number;
  height: number;
  /** u16 entries per tile: 1 for affine BGs (u8 entries) isn't modelled; text BGs only. */
  bg: number;
}

let sTilemapUtil: TilemapUtil[] = [];

const s16 = (v: number) => (v << 16) >> 16;
const u16 = (v: number) => v & 0xffff;

/** TilemapUtil_Init */
export function TilemapUtil_Init(numTilemapIds: number): void {
  sTilemapUtil = Array.from({ length: numTilemapIds }, () => ({
    cur: { x: 0, y: 0, width: 0, height: 0, destX: 0, destY: 0 },
    tilemap: [],
    width: 0,
    height: 0,
    bg: 0,
  }));
}

/** TilemapUtil_Free */
export function TilemapUtil_Free(): void {
  sTilemapUtil = [];
}

/** TilemapUtil_SetTilemap: `tilemap` is width x height u16 entries. */
export function TilemapUtil_SetTilemap(tilemapId: number, bg: number, tilemap: ArrayLike<number>, width: number, height: number): void {
  const t = sTilemapUtil[tilemapId];
  if (!t) return;
  t.tilemap = tilemap;
  t.bg = bg;
  t.width = width;
  t.height = height;
  // altWidth/altHeight/tileSize: only text BGs (u16 entries) are used by the storage system
  void GetBgAttribute(bg, BG_ATTR_SCREENSIZE);
  if (GetBgAttribute(bg, BG_ATTR_BGTYPE) !== 0) console.warn('[tilemapUtil] affine BGs are not supported');
  t.cur = { x: 0, y: 0, width, height, destX: 0, destY: 0 };
}

/** TilemapUtil_SetPos */
export function TilemapUtil_SetPos(tilemapId: number, destX: number, destY: number): void {
  const t = sTilemapUtil[tilemapId];
  if (!t) return;
  t.cur.destX = s16(destX);
  t.cur.destY = s16(destY);
}

/** TilemapUtil_SetRect */
export function TilemapUtil_SetRect(tilemapId: number, x: number, y: number, width: number, height: number): void {
  const t = sTilemapUtil[tilemapId];
  if (!t) return;
  t.cur.x = s16(x);
  t.cur.y = s16(y);
  t.cur.width = u16(width);
  t.cur.height = u16(height);
}

/** TilemapUtil_Move: mode 3 (the only one used) slides the source rect up while growing it. */
export function TilemapUtil_Move(tilemapId: number, mode: number, param: number): void {
  const t = sTilemapUtil[tilemapId];
  if (!t) return;
  const c = t.cur;
  switch (mode) {
    case 0:
      c.destX = s16(c.destX + param);
      c.width = u16(c.width - param);
      break;
    case 1:
      c.x = s16(c.x + param);
      c.width = u16(c.width + param);
      break;
    case 2:
      c.destY = s16(c.destY + param);
      c.height = u16(c.height - param);
      break;
    case 3:
      c.y = s16(c.y - param);
      c.height = u16(c.height + param);
      break;
    case 4:
      c.destX = s16(c.destX + param);
      break;
    case 5:
      c.destY = s16(c.destY + param);
      break;
  }
}

/** TilemapUtil_Update (TilemapUtil_Draw) */
export function TilemapUtil_Update(tilemapId: number): void {
  const t = sTilemapUtil[tilemapId];
  if (!t) return;
  const c = t.cur;
  let offset = t.width * c.y + c.x;
  for (let i = 0; i < c.height; i++) {
    const row = Array.from({ length: c.width }, (_, j) => t.tilemap[offset + j] ?? 0);
    CopyToBgTilemapBufferRect(t.bg, row, c.destX, c.destY + i, c.width, 1);
    offset += t.width;
  }
}
