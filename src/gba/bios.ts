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
