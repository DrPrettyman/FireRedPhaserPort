// sprite.c: the sprite system (gSprites, anims/affine anims, OBJ tile and palette allocation,
// subsprites) and BuildOamBuffer, which produces the OAM the PPU draws.

import { DISPLAY_HEIGHT, DISPLAY_WIDTH, OBJ_VRAM0, vram } from './hw';
import { LoadPalette, OBJ_PLTT_OFFSET, PLTT_ID, PLTT_SIZE_4BPP } from './palette';

export const MAX_SPRITES = 64;
export const TAG_NONE = 0xffff;
export const TILE_SIZE_4BPP = 32;
export const TOTAL_OBJ_TILE_COUNT = 1024;
const OAM_MATRIX_COUNT = 32;
const MAX_SPRITE_COPY_REQUESTS = 64;

export const ST_OAM_AFFINE_OFF = 0;
export const ST_OAM_AFFINE_NORMAL = 1;
export const ST_OAM_AFFINE_ERASE = 2;
export const ST_OAM_AFFINE_DOUBLE = 3;
export const ST_OAM_AFFINE_ON_MASK = 1;
export const ST_OAM_AFFINE_DOUBLE_MASK = 2;
/** matrixNum bits that flip a non-affine sprite */
export const ST_OAM_HFLIP = 0x08;
export const ST_OAM_VFLIP = 0x10;
export const ST_OAM_OBJ_NORMAL = 0;
export const ST_OAM_OBJ_BLEND = 1;
export const ST_OAM_OBJ_WINDOW = 2;
export const ST_OAM_4BPP = 0;
export const ST_OAM_8BPP = 1;
export const ST_OAM_SQUARE = 0;
export const ST_OAM_H_RECTANGLE = 1;
export const ST_OAM_V_RECTANGLE = 2;
export const SPRITE_SHAPE = {
  '8x8': [0, 0], '16x16': [0, 1], '32x32': [0, 2], '64x64': [0, 3],
  '16x8': [1, 0], '32x8': [1, 1], '32x16': [1, 2], '64x32': [1, 3],
  '8x16': [2, 0], '8x32': [2, 1], '16x32': [2, 2], '32x64': [2, 3],
} as const;

export const SUBSPRITES_OFF = 0;
export const SUBSPRITES_ON = 1;
export const SUBSPRITES_IGNORE_PRIORITY = 2;

export interface OamData {
  y: number;
  affineMode: number;
  objMode: number;
  mosaic: number;
  bpp: number;
  shape: number;
  x: number;
  /** matrixNum for affine sprites; bits 3/4 are h/v flip otherwise */
  matrixNum: number;
  size: number;
  tileNum: number;
  priority: number;
  paletteNum: number;
  /** Not drawn; battle_interface.c keeps a sprite id here (sHealthboxOtherSpriteId). */
  affineParam: number;
}

export function oam(p: Partial<OamData>): OamData {
  return { y: 0, affineMode: 0, objMode: 0, mosaic: 0, bpp: 0, shape: 0, x: 0, matrixNum: 0, size: 0, tileNum: 0, priority: 0, paletteNum: 0, affineParam: 0, ...p };
}

export const gDummyOamData: OamData = oam({ y: 160, x: 304, priority: 3 });

// AnimCmd: `type` overlays frame.imageValue in the C union.
export interface AnimCmd {
  type: number;
  imageValue?: number;
  duration?: number;
  hFlip?: boolean;
  vFlip?: boolean;
  count?: number;
  target?: number;
}
export const ANIMCMD_FRAME = (imageValue: number, duration: number, hFlip = false, vFlip = false): AnimCmd => ({ type: imageValue, imageValue, duration, hFlip, vFlip });
export const ANIMCMD_LOOP = (count: number): AnimCmd => ({ type: -3, count });
export const ANIMCMD_JUMP = (target: number): AnimCmd => ({ type: -2, target });
export const ANIMCMD_END: AnimCmd = { type: -1 };

export interface AffineAnimCmd {
  type: number;
  xScale?: number;
  yScale?: number;
  rotation?: number;
  duration?: number;
  count?: number;
  target?: number;
}
export const AFFINEANIMCMD_FRAME = (xScale: number, yScale: number, rotation: number, duration: number): AffineAnimCmd => ({
  type: xScale,
  xScale,
  yScale,
  rotation,
  duration,
});
export const AFFINEANIMCMD_LOOP = (count: number): AffineAnimCmd => ({ type: 0x7ffd, count });
export const AFFINEANIMCMD_JUMP = (target: number): AffineAnimCmd => ({ type: 0x7ffe, target });
export const AFFINEANIMCMD_END: AffineAnimCmd = { type: 0x7fff };

export interface SpriteFrameImage {
  data: Uint8Array;
  size: number;
}

export interface Subsprite {
  x: number;
  y: number;
  shape: number;
  size: number;
  tileOffset: number;
  priority: number;
}

export interface SubspriteTable {
  subspriteCount: number;
  subsprites: Subsprite[] | null;
}

export type SpriteCallback = (sprite: Sprite) => void;

export interface SpriteTemplate {
  tileTag: number;
  paletteTag: number;
  oam: OamData;
  anims: AnimCmd[][];
  images: SpriteFrameImage[] | null;
  affineAnims: AffineAnimCmd[][];
  callback: SpriteCallback;
}

export const SpriteCallbackDummy: SpriteCallback = () => {};
export const gDummySpriteAnimTable: AnimCmd[][] = [[ANIMCMD_END]];
export const gDummySpriteAffineAnimTable: AffineAnimCmd[][] = [[AFFINEANIMCMD_END]];
export const gDummySpriteTemplate: SpriteTemplate = {
  tileTag: 0,
  paletteTag: TAG_NONE,
  oam: gDummyOamData,
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

export class Sprite {
  oam: OamData = { ...gDummyOamData };
  anims: AnimCmd[][] = gDummySpriteAnimTable;
  images: SpriteFrameImage[] | null = null;
  affineAnims: AffineAnimCmd[][] = gDummySpriteAffineAnimTable;
  template: SpriteTemplate = gDummySpriteTemplate;
  subspriteTables: SubspriteTable[] | null = null;
  callback: SpriteCallback = SpriteCallbackDummy;
  x = DISPLAY_WIDTH + 64;
  y = DISPLAY_HEIGHT;
  x2 = 0;
  y2 = 0;
  centerToCornerVecX = 0;
  centerToCornerVecY = 0;
  animNum = 0;
  animCmdIndex = 0;
  animDelayCounter = 0;
  animPaused = false;
  affineAnimPaused = false;
  animLoopCounter = 0;
  readonly data = new Int16Array(8);
  inUse = false;
  coordOffsetEnabled = false;
  invisible = false;
  flags_3 = false;
  flags_4 = false;
  flags_5 = false;
  flags_6 = false;
  flags_7 = false;
  hFlip = false;
  vFlip = false;
  animBeginning = false;
  affineAnimBeginning = false;
  animEnded = false;
  affineAnimEnded = false;
  usingSheet = false;
  anchored = false;
  sheetTileStart = 0;
  subspriteTableNum = 0;
  subspriteMode = 0;
  subpriority = 0xff;
  /** StoreSpriteCallbackInData6 keeps a function pointer in data[6..7]; JS keeps it here. */
  storedCallback: SpriteCallback = SpriteCallbackDummy;
  /** Some callers stash a sprite pointer or similar in data; JS keeps object refs here. */
  ref: unknown = undefined;

  reset(): void {
    Object.assign(this, new Sprite());
  }
}

/** `gSprites[dst] = gSprites[src]`: a struct copy (oam and data copied, not shared). */
export function CopySprite(dst: Sprite, src: Sprite): void {
  const data = dst.data;
  Object.assign(dst, src, { oam: { ...src.oam } });
  (dst as { data: Int16Array }).data = data;
  data.set(src.data);
}

export const gSprites: Sprite[] = Array.from({ length: MAX_SPRITES + 1 }, () => new Sprite());
const gSpritePriorities = new Uint16Array(MAX_SPRITES);
const gSpriteOrder = new Uint8Array(MAX_SPRITES).map((_, i) => i);
let gShouldProcessSpriteCopyRequests = false;
const gSpriteCopyRequests: { src: Uint8Array; dest: number; size: number }[] = [];
let gOamLimit = 64;
let gReservedSpriteTileCount = 0;
const gSpriteTileAllocBitmap = new Uint8Array(128);
export let gSpriteCoordOffsetX = 0;
export let gSpriteCoordOffsetY = 0;
export function setSpriteCoordOffset(x: number, y: number): void {
  gSpriteCoordOffsetX = x;
  gSpriteCoordOffsetY = y;
}
export const gOamMatrices = Array.from({ length: OAM_MATRIX_COUNT }, () => ({ a: 0x100, b: 0, c: 0, d: 0x100 }));
let gAffineAnimsDisabled = false;
let gOamMatrixAllocBitmap = 0;
let gReservedSpritePaletteCount = 0;
const sSpriteTileRangeTags = new Uint16Array(MAX_SPRITES).fill(TAG_NONE);
const sSpriteTileRanges = new Uint16Array(MAX_SPRITES * 2);
const sSpritePaletteTags = new Uint16Array(16).fill(TAG_NONE);

class AffineAnimState {
  animNum = 0;
  animCmdIndex = 0;
  delayCounter = 0;
  loopCounter = 0;
  xScale = 0x100;
  yScale = 0x100;
  rotation = 0;
}
const sAffineAnimStates = Array.from({ length: OAM_MATRIX_COUNT }, () => new AffineAnimState());

/** gMain.oamBuffer after BuildOamBuffer: what the PPU draws, in OAM order. */
export const oamBuffer: OamData[] = Array.from({ length: 128 }, () => ({ ...gDummyOamData }));
/** OAM affine parameter groups (CopyMatricesToOamBuffer). */
export const oamMatrices = Array.from({ length: OAM_MATRIX_COUNT }, () => ({ a: 0x100, b: 0, c: 0, d: 0x100 }));

const sCenterToCornerVecTable = [
  [[-4, -4], [-8, -8], [-16, -16], [-32, -32]],
  [[-8, -4], [-16, -4], [-16, -8], [-32, -16]],
  [[-4, -8], [-4, -16], [-8, -16], [-16, -32]],
];

export const sOamDimensions = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

const s16 = (v: number) => (v << 16) >> 16;

export function ResetSpriteData(): void {
  ResetOamRange(0, 128);
  ResetAllSprites();
  ClearSpriteCopyRequests();
  ResetAffineAnimData();
  FreeSpriteTileRanges();
  gOamLimit = 64;
  gReservedSpriteTileCount = 0;
  AllocSpriteTiles(0);
  gSpriteCoordOffsetX = 0;
  gSpriteCoordOffsetY = 0;
}

export function AnimateSprites(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    const sprite = gSprites[i];
    if (sprite.inUse) {
      sprite.callback(sprite);
      if (sprite.inUse) AnimateSprite(sprite);
    }
  }
}

export function BuildOamBuffer(): void {
  UpdateOamCoords();
  BuildSpritePriorities();
  SortSprites();
  AddSpritesToOamBuffer();
  CopyMatricesToOamBuffer();
  gShouldProcessSpriteCopyRequests = true;
}

function UpdateOamCoords(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    const s = gSprites[i];
    if (s.inUse && !s.invisible) {
      const ox = s.coordOffsetEnabled ? gSpriteCoordOffsetX : 0;
      const oy = s.coordOffsetEnabled ? gSpriteCoordOffsetY : 0;
      s.oam.x = (s.x + s.x2 + s.centerToCornerVecX + ox) & 0x1ff;
      s.oam.y = (s.y + s.y2 + s.centerToCornerVecY + oy) & 0xff;
    }
  }
}

function BuildSpritePriorities(): void {
  for (let i = 0; i < MAX_SPRITES; i++) gSpritePriorities[i] = (gSprites[i].subpriority & 0xff) | (gSprites[i].oam.priority << 8);
}

function sortY(s: Sprite): number {
  let y = s.oam.y;
  if (y >= DISPLAY_HEIGHT) y -= 256;
  if (s.oam.affineMode === ST_OAM_AFFINE_DOUBLE && s.oam.size === 3 && (s.oam.shape === ST_OAM_SQUARE || s.oam.shape === ST_OAM_V_RECTANGLE) && y > 128) y -= 256;
  return y;
}

function SortSprites(): void {
  for (let i = 1; i < MAX_SPRITES; i++) {
    let j = i;
    for (;;) {
      if (j <= 0) break;
      const a = gSpriteOrder[j - 1];
      const b = gSpriteOrder[j];
      const pa = gSpritePriorities[a];
      const pb = gSpritePriorities[b];
      if (!(pa > pb || (pa === pb && sortY(gSprites[a]) < sortY(gSprites[b])))) break;
      gSpriteOrder[j] = a;
      gSpriteOrder[j - 1] = b;
      j--;
    }
  }
}

function CopyMatricesToOamBuffer(): void {
  for (let i = 0; i < OAM_MATRIX_COUNT; i++) Object.assign(oamMatrices[i], gOamMatrices[i]);
}

function AddSpritesToOamBuffer(): void {
  const idx = { v: 0 };
  for (let i = 0; i < MAX_SPRITES; i++) {
    const s = gSprites[gSpriteOrder[i]];
    if (s.inUse && !s.invisible && AddSpriteToOamBuffer(s, idx)) return;
  }
  while (idx.v < gOamLimit) oamBuffer[idx.v++] = { ...gDummyOamData };
}

export function CreateSprite(template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  for (let i = 0; i < MAX_SPRITES; i++) if (!gSprites[i].inUse) return CreateSpriteAt(i, template, x, y, subpriority);
  return MAX_SPRITES;
}

export function CreateSpriteAtEnd(template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  for (let i = MAX_SPRITES - 1; i > -1; i--) if (!gSprites[i].inUse) return CreateSpriteAt(i, template, x, y, subpriority);
  return MAX_SPRITES;
}

export function CreateInvisibleSprite(callback: SpriteCallback): number {
  const index = CreateSprite(gDummySpriteTemplate, 0, 0, 31);
  if (index === MAX_SPRITES) return MAX_SPRITES;
  gSprites[index].invisible = true;
  gSprites[index].callback = callback;
  return index;
}

function CreateSpriteAt(index: number, template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  const sprite = gSprites[index];
  sprite.reset();
  sprite.inUse = true;
  sprite.animBeginning = true;
  sprite.affineAnimBeginning = true;
  sprite.usingSheet = true;
  sprite.subpriority = subpriority & 0xff;
  sprite.oam = { ...template.oam };
  sprite.anims = template.anims;
  sprite.affineAnims = template.affineAnims;
  sprite.template = template;
  sprite.callback = template.callback;
  sprite.x = s16(x);
  sprite.y = s16(y);
  CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
  if (template.tileTag === TAG_NONE) {
    sprite.images = template.images;
    const tileNum = AllocSpriteTiles((sprite.images![0].size / TILE_SIZE_4BPP) & 0xff);
    if (tileNum === -1) {
      sprite.reset();
      return MAX_SPRITES;
    }
    sprite.oam.tileNum = tileNum;
    sprite.usingSheet = false;
    sprite.sheetTileStart = 0;
  } else {
    sprite.sheetTileStart = GetSpriteTileStartByTag(template.tileTag);
    SetSpriteSheetFrameTileNum(sprite);
  }
  if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) InitSpriteAffineAnim(sprite);
  if (template.paletteTag !== TAG_NONE) sprite.oam.paletteNum = IndexOfSpritePaletteTag(template.paletteTag);
  return index;
}

export function CreateSpriteAndAnimate(template: SpriteTemplate, x: number, y: number, subpriority: number): number {
  for (let i = 0; i < MAX_SPRITES; i++) {
    if (!gSprites[i].inUse) {
      const index = CreateSpriteAt(i, template, x, y, subpriority);
      if (index === MAX_SPRITES) return MAX_SPRITES;
      gSprites[i].callback(gSprites[i]);
      if (gSprites[i].inUse) AnimateSprite(gSprites[i]);
      return index;
    }
  }
  return MAX_SPRITES;
}

export function DestroySprite(sprite: Sprite): void {
  if (!sprite.inUse) return;
  if (!sprite.usingSheet) {
    const tileEnd = sprite.images![0].size / TILE_SIZE_4BPP + sprite.oam.tileNum;
    for (let i = sprite.oam.tileNum; i < tileEnd; i++) freeTile(i);
  }
  sprite.reset();
}

export function ResetOamRange(a: number, b: number): void {
  for (let i = a; i < b; i++) oamBuffer[i] = { ...gDummyOamData };
}

function ClearSpriteCopyRequests(): void {
  gShouldProcessSpriteCopyRequests = false;
  gSpriteCopyRequests.length = 0;
}

function ResetOamMatrices(): void {
  for (const m of gOamMatrices) Object.assign(m, { a: 0x100, b: 0, c: 0, d: 0x100 });
}

export function SetOamMatrix(matrixNum: number, a: number, b: number, c: number, d: number): void {
  Object.assign(gOamMatrices[matrixNum], { a: s16(a), b: s16(b), c: s16(c), d: s16(d) });
}

export function CalcCenterToCornerVec(sprite: Sprite, shape: number, size: number, affineMode: number): void {
  let [x, y] = sCenterToCornerVecTable[shape][size];
  if (affineMode & ST_OAM_AFFINE_DOUBLE_MASK) {
    x *= 2;
    y *= 2;
  }
  sprite.centerToCornerVecX = x;
  sprite.centerToCornerVecY = y;
}

const tileAllocated = (n: number) => (gSpriteTileAllocBitmap[n >> 3] >> (n & 7)) & 1;
const allocTile = (n: number) => (gSpriteTileAllocBitmap[n >> 3] |= 1 << (n & 7));
const freeTile = (n: number) => (gSpriteTileAllocBitmap[n >> 3] &= ~(1 << (n & 7)));

export function AllocSpriteTiles(tileCount: number): number {
  if (tileCount === 0) {
    // Free all unreserved tiles if the tile count is 0.
    for (let i = gReservedSpriteTileCount; i < TOTAL_OBJ_TILE_COUNT; i++) freeTile(i);
    return 0;
  }
  let i = gReservedSpriteTileCount;
  let start: number;
  for (;;) {
    while (tileAllocated(i)) {
      i++;
      if (i === TOTAL_OBJ_TILE_COUNT) return -1;
    }
    start = i;
    let numTilesFound = 1;
    while (numTilesFound !== tileCount) {
      i++;
      if (i === TOTAL_OBJ_TILE_COUNT) return -1;
      if (!tileAllocated(i)) numTilesFound++;
      else break;
    }
    if (numTilesFound === tileCount) break;
  }
  for (let t = start; t < tileCount + start; t++) allocTile(t);
  return start;
}

export function FreeSpriteTilesIfNotUsingSheet(sprite: Sprite): void {
  if (!sprite.usingSheet) {
    const end = sprite.images![0].size / TILE_SIZE_4BPP + sprite.oam.tileNum;
    for (let i = sprite.oam.tileNum; i < end; i++) freeTile(i);
  }
}

/** ProcessSpriteCopyRequests (VBlank) */
export function ProcessSpriteCopyRequests(): void {
  if (!gShouldProcessSpriteCopyRequests) return;
  for (const r of gSpriteCopyRequests) vram.set(r.src.subarray(0, r.size), r.dest);
  gSpriteCopyRequests.length = 0;
  gShouldProcessSpriteCopyRequests = false;
}

function RequestSpriteFrameImageCopy(index: number, tileNum: number, images: SpriteFrameImage[]): void {
  if (gSpriteCopyRequests.length < MAX_SPRITE_COPY_REQUESTS) {
    const img = images[index];
    gSpriteCopyRequests.push({ src: img.data, dest: OBJ_VRAM0 + TILE_SIZE_4BPP * tileNum, size: img.size });
  }
}

export function RequestSpriteCopy(src: Uint8Array, dest: number, size: number): void {
  if (gSpriteCopyRequests.length < MAX_SPRITE_COPY_REQUESTS) gSpriteCopyRequests.push({ src, dest, size });
}

function ResetAllSprites(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    gSprites[i].reset();
    gSpriteOrder[i] = i;
  }
  gSprites[MAX_SPRITES].reset();
}

export function FreeSpriteTiles(sprite: Sprite): void {
  if (sprite.template.tileTag !== TAG_NONE) FreeSpriteTilesByTag(sprite.template.tileTag);
}

export function FreeSpritePalette(sprite: Sprite): void {
  FreeSpritePaletteByTag(sprite.template.paletteTag);
}

export function FreeSpriteOamMatrix(sprite: Sprite): void {
  if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK) {
    FreeOamMatrix(sprite.oam.matrixNum);
    sprite.oam.affineMode = ST_OAM_AFFINE_OFF;
  }
}

export function DestroySpriteAndFreeResources(sprite: Sprite): void {
  FreeSpriteTiles(sprite);
  FreeSpritePalette(sprite);
  FreeSpriteOamMatrix(sprite);
  DestroySprite(sprite);
}

export function AnimateSprite(sprite: Sprite): void {
  if (sprite.animBeginning) BeginAnim(sprite);
  else ContinueAnim(sprite);
  if (!gAffineAnimsDisabled) {
    if (sprite.affineAnimBeginning) BeginAffineAnim(sprite);
    else ContinueAffineAnim(sprite);
  }
}

function frameCmd(sprite: Sprite): AnimCmd {
  return sprite.anims[sprite.animNum][sprite.animCmdIndex];
}

function applyFrame(sprite: Sprite, cmd: AnimCmd): void {
  let duration = (cmd.duration ?? 0) & 0x3f;
  if (duration) duration--;
  sprite.animDelayCounter = duration;
  if (!(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) SetSpriteOamFlipBits(sprite, !!cmd.hFlip, !!cmd.vFlip);
  if (sprite.usingSheet) sprite.oam.tileNum = (sprite.sheetTileStart + (cmd.imageValue ?? 0)) & 0x3ff;
  else RequestSpriteFrameImageCopy(cmd.imageValue ?? 0, sprite.oam.tileNum, sprite.images!);
}

function BeginAnim(sprite: Sprite): void {
  sprite.animCmdIndex = 0;
  sprite.animEnded = false;
  sprite.animLoopCounter = 0;
  const cmd = frameCmd(sprite);
  if (cmd.type !== -1) {
    sprite.animBeginning = false;
    applyFrame(sprite, cmd);
  }
}

function ContinueAnim(sprite: Sprite): void {
  if (sprite.animDelayCounter) {
    if (!sprite.animPaused) sprite.animDelayCounter--;
    const cmd = frameCmd(sprite);
    if (!(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) SetSpriteOamFlipBits(sprite, !!cmd.hFlip, !!cmd.vFlip);
  } else if (!sprite.animPaused) {
    sprite.animCmdIndex++;
    const type = frameCmd(sprite).type;
    switch (type < 0 ? type + 3 : 3) {
      case 0: // loop
        if (sprite.animLoopCounter) {
          sprite.animLoopCounter--;
        } else {
          sprite.animLoopCounter = frameCmd(sprite).count ?? 0;
        }
        JumpToTopOfAnimLoop(sprite);
        ContinueAnim(sprite);
        break;
      case 1: // jump
        sprite.animCmdIndex = frameCmd(sprite).target ?? 0;
        applyFrame(sprite, frameCmd(sprite));
        break;
      case 2: // end
        sprite.animCmdIndex--;
        sprite.animEnded = true;
        break;
      default:
        applyFrame(sprite, frameCmd(sprite));
    }
  }
}

function JumpToTopOfAnimLoop(sprite: Sprite): void {
  if (sprite.animLoopCounter) {
    sprite.animCmdIndex--;
    while (sprite.anims[sprite.animNum][sprite.animCmdIndex - 1]?.type !== -3) {
      if (sprite.animCmdIndex === 0) break;
      sprite.animCmdIndex--;
    }
    sprite.animCmdIndex--;
  }
}

function GetSpriteMatrixNum(sprite: Sprite): number {
  return sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK ? sprite.oam.matrixNum & 0x1f : 0;
}

function affineCmd(sprite: Sprite, matrixNum: number): AffineAnimCmd {
  const st = sAffineAnimStates[matrixNum];
  return sprite.affineAnims[st.animNum][st.animCmdIndex];
}

function BeginAffineAnim(sprite: Sprite): void {
  if (sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK && sprite.affineAnims[0][0].type !== 0x7fff) {
    const matrixNum = GetSpriteMatrixNum(sprite);
    const st = sAffineAnimStates[matrixNum];
    st.animCmdIndex = 0;
    st.delayCounter = 0;
    st.loopCounter = 0;
    const cmd = { ...affineCmd(sprite, matrixNum) };
    sprite.affineAnimBeginning = false;
    sprite.affineAnimEnded = false;
    ApplyAffineAnimFrame(matrixNum, cmd);
    st.delayCounter = cmd.duration ?? 0;
    if (sprite.anchored) UpdateSpriteMatrixAnchorPos(sprite, sprite.data[6], sprite.data[7]);
  }
}

function ContinueAffineAnim(sprite: Sprite): void {
  if (!(sprite.oam.affineMode & ST_OAM_AFFINE_ON_MASK)) return;
  const matrixNum = GetSpriteMatrixNum(sprite);
  const st = sAffineAnimStates[matrixNum];
  if (st.delayCounter) {
    if (!sprite.affineAnimPaused) --st.delayCounter;
    if (!sprite.affineAnimPaused) ApplyAffineAnimFrameRelativeAndUpdateMatrix(matrixNum, affineCmd(sprite, matrixNum));
  } else if (sprite.affineAnimPaused) {
    return;
  } else {
    st.animCmdIndex++;
    const type = affineCmd(sprite, matrixNum).type;
    switch (type >= 0x7ffd ? type - 0x7ffd : 3) {
      case 0: // loop
        if (st.loopCounter) st.loopCounter--;
        else st.loopCounter = affineCmd(sprite, matrixNum).count ?? 0;
        JumpToTopOfAffineAnimLoop(matrixNum, sprite);
        ContinueAffineAnim(sprite);
        break;
      case 1: {
        // jump
        st.animCmdIndex = affineCmd(sprite, matrixNum).target ?? 0;
        const cmd = { ...affineCmd(sprite, matrixNum) };
        ApplyAffineAnimFrame(matrixNum, cmd);
        st.delayCounter = cmd.duration ?? 0;
        break;
      }
      case 2: // end
        sprite.affineAnimEnded = true;
        st.animCmdIndex--;
        ApplyAffineAnimFrameRelativeAndUpdateMatrix(matrixNum, { type: 0, xScale: 0, yScale: 0, rotation: 0, duration: 0 });
        break;
      default: {
        const cmd = { ...affineCmd(sprite, matrixNum) };
        ApplyAffineAnimFrame(matrixNum, cmd);
        st.delayCounter = cmd.duration ?? 0;
      }
    }
  }
  if (sprite.anchored) UpdateSpriteMatrixAnchorPos(sprite, sprite.data[6], sprite.data[7]);
}

function JumpToTopOfAffineAnimLoop(matrixNum: number, sprite: Sprite): void {
  const st = sAffineAnimStates[matrixNum];
  if (st.loopCounter) {
    st.animCmdIndex--;
    while (sprite.affineAnims[st.animNum][st.animCmdIndex - 1]?.type !== 0x7ffd) {
      if (st.animCmdIndex === 0) break;
      st.animCmdIndex--;
    }
    st.animCmdIndex--;
  }
}

export const NO_ANCHOR = 0x7fff;

export function SetSpriteMatrixAnchor(sprite: Sprite, x: number, y: number): void {
  sprite.data[6] = x;
  sprite.data[7] = y;
  sprite.anchored = true;
}

function GetAnchorCoord(baseDim: number, xformed: number, modifier: number): number {
  const sub = xformed - baseDim;
  const shift = sub < 0 ? -sub >> 9 : -(sub >> 9);
  return modifier - (Math.trunc(((modifier * xformed) >>> 0) / (baseDim >>> 0)) + shift);
}

function UpdateSpriteMatrixAnchorPos(sprite: Sprite, x: number, y: number): void {
  const m = gOamMatrices[sprite.oam.matrixNum & 0x1f];
  if (x !== NO_ANCHOR) {
    const dim = sOamDimensions[sprite.oam.shape][sprite.oam.size][0];
    sprite.x2 = GetAnchorCoord(dim << 8, Math.trunc((dim << 16) / m.a), x);
  }
  if (y !== NO_ANCHOR) {
    const dim = sOamDimensions[sprite.oam.shape][sprite.oam.size][1];
    sprite.y2 = GetAnchorCoord(dim << 8, Math.trunc((dim << 16) / m.d), y);
  }
}

function SetSpriteOamFlipBits(sprite: Sprite, hFlip: boolean, vFlip: boolean): void {
  sprite.oam.matrixNum &= 0x7;
  sprite.oam.matrixNum |= ((+hFlip ^ +sprite.hFlip) & 1) << 3;
  sprite.oam.matrixNum |= ((+vFlip ^ +sprite.vFlip) & 1) << 4;
}

function AffineAnimStateReset(matrixNum: number): void {
  Object.assign(sAffineAnimStates[matrixNum], new AffineAnimState());
}

function ApplyAffineAnimFrameRelativeAndUpdateMatrix(matrixNum: number, cmd: AffineAnimCmd): void {
  const st = sAffineAnimStates[matrixNum];
  st.xScale = s16(st.xScale + (cmd.xScale ?? 0));
  st.yScale = s16(st.yScale + (cmd.yScale ?? 0));
  st.rotation = (st.rotation + ((cmd.rotation ?? 0) << 8)) & ~0xff & 0xffff;
  const m = ObjAffineSet(ConvertScaleParam(st.xScale), ConvertScaleParam(st.yScale), st.rotation);
  Object.assign(gOamMatrices[matrixNum], m);
}

function ConvertScaleParam(scale: number): number {
  return scale === 0 ? 0 : s16(Math.trunc(0x10000 / scale));
}

function ApplyAffineAnimFrame(matrixNum: number, cmd: AffineAnimCmd): void {
  if (cmd.duration) {
    cmd.duration--;
    ApplyAffineAnimFrameRelativeAndUpdateMatrix(matrixNum, cmd);
  } else {
    const st = sAffineAnimStates[matrixNum];
    st.xScale = cmd.xScale ?? 0;
    st.yScale = cmd.yScale ?? 0;
    st.rotation = ((cmd.rotation ?? 0) << 8) & 0xffff;
    ApplyAffineAnimFrameRelativeAndUpdateMatrix(matrixNum, { type: 0, xScale: 0, yScale: 0, rotation: 0, duration: 0 });
  }
}

const SIN_TABLE = Array.from({ length: 256 }, (_, i) => Math.round(Math.sin((i * Math.PI * 2) / 256) * 0x4000));

/** ObjAffineSet (BIOS): 8.8 scales, rotation's high byte is the angle (256 steps). */
export function ObjAffineSet(xScale: number, yScale: number, rotation: number): { a: number; b: number; c: number; d: number } {
  const angle = (rotation >> 8) & 0xff;
  const sin = SIN_TABLE[angle];
  const cos = SIN_TABLE[(angle + 64) & 0xff];
  return { a: s16((xScale * cos) >> 14), b: s16(-(xScale * sin) >> 14), c: s16((yScale * sin) >> 14), d: s16((yScale * cos) >> 14) };
}

export function StartSpriteAnim(sprite: Sprite, animNum: number): void {
  sprite.animNum = animNum;
  sprite.animBeginning = true;
  sprite.animEnded = false;
}

export function StartSpriteAnimIfDifferent(sprite: Sprite, animNum: number): void {
  if (sprite.animNum !== animNum) StartSpriteAnim(sprite, animNum);
}

export function SeekSpriteAnim(sprite: Sprite, animCmdIndex: number): void {
  const temp = sprite.animPaused;
  sprite.animCmdIndex = animCmdIndex - 1;
  sprite.animDelayCounter = 0;
  sprite.animBeginning = false;
  sprite.animEnded = false;
  sprite.animPaused = false;
  ContinueAnim(sprite);
  if (sprite.animDelayCounter) sprite.animDelayCounter++;
  sprite.animPaused = temp;
}

export function StartSpriteAffineAnim(sprite: Sprite, animNum: number): void {
  const st = sAffineAnimStates[GetSpriteMatrixNum(sprite)];
  Object.assign(st, new AffineAnimState(), { animNum });
  sprite.affineAnimBeginning = true;
  sprite.affineAnimEnded = false;
}

export function StartSpriteAffineAnimIfDifferent(sprite: Sprite, animNum: number): void {
  if (sAffineAnimStates[GetSpriteMatrixNum(sprite)].animNum !== animNum) StartSpriteAffineAnim(sprite, animNum);
}

export function ChangeSpriteAffineAnim(sprite: Sprite, animNum: number): void {
  sAffineAnimStates[GetSpriteMatrixNum(sprite)].animNum = animNum;
  sprite.affineAnimBeginning = true;
  sprite.affineAnimEnded = false;
}

export function SetSpriteSheetFrameTileNum(sprite: Sprite): void {
  if (sprite.usingSheet) {
    let tileOffset = sprite.anims[sprite.animNum][sprite.animCmdIndex].imageValue ?? 0;
    if (tileOffset < 0) tileOffset = 0;
    sprite.oam.tileNum = (sprite.sheetTileStart + tileOffset) & 0x3ff;
  }
}

export function ResetAffineAnimData(): void {
  gAffineAnimsDisabled = false;
  gOamMatrixAllocBitmap = 0;
  ResetOamMatrices();
  for (let i = 0; i < OAM_MATRIX_COUNT; i++) AffineAnimStateReset(i);
}

export function setAffineAnimsDisabled(v: boolean): void {
  gAffineAnimsDisabled = v;
}

export function AllocOamMatrix(): number {
  for (let i = 0; i < OAM_MATRIX_COUNT; i++) {
    if (!(gOamMatrixAllocBitmap & (1 << i))) {
      gOamMatrixAllocBitmap |= 1 << i;
      return i;
    }
  }
  return 0xff;
}

export function FreeOamMatrix(matrixNum: number): void {
  gOamMatrixAllocBitmap &= ~(1 << (matrixNum & 0x1f));
  SetOamMatrix(matrixNum & 0x1f, 0x100, 0, 0, 0x100);
}

export function InitSpriteAffineAnim(sprite: Sprite): void {
  const matrixNum = AllocOamMatrix();
  if (matrixNum !== 0xff) {
    CalcCenterToCornerVec(sprite, sprite.oam.shape, sprite.oam.size, sprite.oam.affineMode);
    sprite.oam.matrixNum = matrixNum;
    sprite.affineAnimBeginning = true;
    AffineAnimStateReset(matrixNum);
  }
}

export function SetOamMatrixRotationScaling(matrixNum: number, xScale: number, yScale: number, rotation: number): void {
  Object.assign(gOamMatrices[matrixNum], ObjAffineSet(ConvertScaleParam(xScale), ConvertScaleParam(yScale), rotation));
}

export interface SpriteSheet {
  data: Uint8Array;
  size: number;
  tag: number;
}

export function LoadSpriteSheet(sheet: SpriteSheet): number {
  const tileStart = AllocSpriteTiles(sheet.size / TILE_SIZE_4BPP);
  if (tileStart < 0) return 0;
  AllocSpriteTileRange(sheet.tag, tileStart, sheet.size / TILE_SIZE_4BPP);
  vram.set(sheet.data.subarray(0, sheet.size), OBJ_VRAM0 + TILE_SIZE_4BPP * tileStart);
  return tileStart;
}

/** LoadCompressedSpriteSheet: our data is stored decompressed. */
export const LoadCompressedSpriteSheet = LoadSpriteSheet;

export function FreeSpriteTilesByTag(tag: number): void {
  const index = IndexOfSpriteTileTag(tag);
  if (index !== 0xff) {
    const start = sSpriteTileRanges[index * 2];
    const count = sSpriteTileRanges[index * 2 + 1];
    for (let i = start; i < start + count; i++) freeTile(i);
    sSpriteTileRangeTags[index] = TAG_NONE;
  }
}

export function FreeSpriteTileRanges(): void {
  sSpriteTileRangeTags.fill(TAG_NONE);
  sSpriteTileRanges.fill(0);
}

export function GetSpriteTileStartByTag(tag: number): number {
  const index = IndexOfSpriteTileTag(tag);
  return index === 0xff ? TAG_NONE : sSpriteTileRanges[index * 2];
}

function IndexOfSpriteTileTag(tag: number): number {
  for (let i = 0; i < MAX_SPRITES; i++) if (sSpriteTileRangeTags[i] === tag) return i;
  return 0xff;
}

function AllocSpriteTileRange(tag: number, start: number, count: number): void {
  const freeIndex = IndexOfSpriteTileTag(TAG_NONE);
  sSpriteTileRangeTags[freeIndex] = tag;
  sSpriteTileRanges[freeIndex * 2] = start;
  sSpriteTileRanges[freeIndex * 2 + 1] = count;
}

/** gReservedSpritePaletteCount = n */
export function SetReservedSpritePaletteCount(n: number): void {
  gReservedSpritePaletteCount = n;
}

export function FreeAllSpritePalettes(): void {
  gReservedSpritePaletteCount = 0;
  sSpritePaletteTags.fill(TAG_NONE);
}

export interface SpritePalette {
  data: ArrayLike<number>;
  tag: number;
}

export function LoadSpritePalette(palette: SpritePalette): number {
  let index = IndexOfSpritePaletteTag(palette.tag);
  if (index !== 0xff) return index;
  index = IndexOfSpritePaletteTag(TAG_NONE);
  if (index === 0xff) return 0xff;
  sSpritePaletteTags[index] = palette.tag;
  LoadPalette(palette.data, PLTT_ID(index) + OBJ_PLTT_OFFSET, PLTT_SIZE_4BPP);
  return index;
}

/** LoadCompressedSpritePalette */
export const LoadCompressedSpritePalette = LoadSpritePalette;

export function AllocSpritePalette(tag: number): number {
  const index = IndexOfSpritePaletteTag(TAG_NONE);
  if (index === 0xff) return 0xff;
  sSpritePaletteTags[index] = tag;
  return index;
}

export function IndexOfSpritePaletteTag(tag: number): number {
  for (let i = gReservedSpritePaletteCount; i < 16; i++) if (sSpritePaletteTags[i] === tag) return i;
  return 0xff;
}

export function GetSpritePaletteTagByPaletteNum(paletteNum: number): number {
  return sSpritePaletteTags[paletteNum];
}

export function FreeSpritePaletteByTag(tag: number): void {
  const index = IndexOfSpritePaletteTag(tag);
  if (index !== 0xff) sSpritePaletteTags[index] = TAG_NONE;
}

export function SetSubspriteTables(sprite: Sprite, subspriteTables: SubspriteTable[]): void {
  sprite.subspriteTables = subspriteTables;
  sprite.subspriteTableNum = 0;
  sprite.subspriteMode = SUBSPRITES_ON;
}

function AddSpriteToOamBuffer(sprite: Sprite, idx: { v: number }): boolean {
  if (idx.v >= gOamLimit) return true;
  if (!sprite.subspriteTables || sprite.subspriteMode === SUBSPRITES_OFF) {
    oamBuffer[idx.v++] = { ...sprite.oam };
    return false;
  }
  return AddSubspritesToOamBuffer(sprite, idx);
}

function AddSubspritesToOamBuffer(sprite: Sprite, idx: { v: number }): boolean {
  if (idx.v >= gOamLimit) return true;
  const table = sprite.subspriteTables![sprite.subspriteTableNum];
  const o = sprite.oam;
  if (!table || !table.subsprites) {
    oamBuffer[idx.v++] = { ...o };
    return false;
  }
  const hFlip = (o.matrixNum >> 3) & 1;
  const vFlip = (o.matrixNum >> 4) & 1;
  const baseX = (o.x - sprite.centerToCornerVecX) & 0xffff;
  const baseY = (o.y - sprite.centerToCornerVecY) & 0xffff;
  for (let i = 0; i < table.subspriteCount; i++, idx.v++) {
    if (idx.v >= gOamLimit) return true;
    const sub = table.subsprites[i];
    let x = sub.x & 0xffff;
    let y = sub.y & 0xffff;
    if (hFlip) x = (~(s16(sub.x) + sOamDimensions[sub.shape][sub.size][0]) + 1) & 0xffff;
    if (vFlip) y = (~(s16(sub.y) + sOamDimensions[sub.shape][sub.size][1]) + 1) & 0xffff;
    const d = { ...o };
    d.shape = sub.shape;
    d.size = sub.size;
    d.x = (s16(baseX) + s16(x)) & 0x1ff;
    d.y = (baseY + y) & 0xff;
    d.tileNum = (o.tileNum + sub.tileOffset) & 0x3ff;
    if (sprite.subspriteMode !== SUBSPRITES_IGNORE_PRIORITY) d.priority = sub.priority;
    oamBuffer[idx.v] = d;
  }
  return false;
}

/** StoreSpriteCallbackInData6 / SetCallbackToStoredInData6 (util.c) */
export function StoreSpriteCallbackInData6(sprite: Sprite, callback: SpriteCallback): void {
  sprite.storedCallback = callback;
}

export function SetCallbackToStoredInData6(sprite: Sprite): void {
  sprite.callback = sprite.storedCallback;
}
