// GBA BIOS calls not covered elsewhere (ObjAffineSet lives in sprite.ts).


function arcTan(i: number): number {
  const a = -((i * i) >> 14);
  let b = ((0xa9 * a) >> 14) + 0x390;
  b = ((b * a) >> 14) + 0x91c;
  b = ((b * a) >> 14) + 0xfb6;
  b = ((b * a) >> 14) + 0x16aa;
  b = ((b * a) >> 14) + 0x2081;
  b = ((b * a) >> 14) + 0x3651;
  b = ((b * a) >> 14) + 0xa2f9;
  return (i * b) >> 16;
}

/** ArcTan2 (SWI 0x0A): the angle of (x, y) as a u16 (0x10000 = full turn), like mGBA's HLE BIOS. */
export function ArcTan2(x: number, y: number): number {
  x = (x << 16) >> 16;
  y = (y << 16) >> 16;
  const div = (n: number, d: number) => Math.trunc(n / d);
  let r: number;
  if (!y) r = x >= 0 ? 0 : 0x8000;
  else if (!x) r = y >= 0 ? 0x4000 : 0xc000;
  else if (y >= 0) {
    if (x >= 0) r = x >= y ? arcTan(div(y << 14, x)) : 0x4000 - arcTan(div(x << 14, y));
    else r = -x >= y ? arcTan(div(y << 14, x)) + 0x8000 : 0x4000 - arcTan(div(x << 14, y));
  } else if (x <= 0) r = -x > -y ? arcTan(div(y << 14, x)) + 0x8000 : 0xc000 - arcTan(div(x << 14, y));
  else r = x >= -y ? arcTan(div(y << 14, x)) + 0x10000 : 0xc000 - arcTan(div(x << 14, y));
  return r & 0xffff;
}

export interface BgAffineSrcData {
  /** texX, texY: the source centre, 19.8 fixed point */
  texX: number;
  texY: number;
  /** scrX, scrY: where on screen the centre goes */
  scrX: number;
  scrY: number;
  /** sx, sy: scale, 8.8 fixed point */
  sx: number;
  sy: number;
  /** alpha: rotation angle (0x10000 = full turn; the BIOS uses the upper 8 bits) */
  alpha: number;
}

export interface BgAffineDstData {
  pa: number;
  pb: number;
  pc: number;
  pd: number;
  dx: number;
  dy: number;
}

/** BgAffineSet (SWI 0x0E) for one entry, computed like mGBA's HLE BIOS (in floating point, truncated). */
export function BgAffineSet(src: BgAffineSrcData): BgAffineDstData {
  const s16 = (v: number) => (v << 16) >> 16;
  const ox = (src.texX | 0) / 256;
  const oy = (src.texY | 0) / 256;
  const cx = s16(src.scrX);
  const cy = s16(src.scrY);
  const sx = s16(src.sx) / 256;
  const sy = s16(src.sy) / 256;
  const theta = (((src.alpha >> 8) & 0xff) / 128) * Math.PI;
  const a = Math.fround(Math.cos(theta)) * sx;
  const b = Math.fround(Math.sin(theta)) * -sx;
  const c = Math.fround(Math.sin(theta)) * sy;
  const d = Math.fround(Math.cos(theta)) * sy;
  const rx = ox - (a * cx + b * cy);
  const ry = oy - (c * cx + d * cy);
  return { pa: Math.trunc(a * 256) & 0xffff, pb: Math.trunc(b * 256) & 0xffff, pc: Math.trunc(c * 256) & 0xffff, pd: Math.trunc(d * 256) & 0xffff, dx: Math.trunc(rx * 256) | 0, dy: Math.trunc(ry * 256) | 0 };
}
